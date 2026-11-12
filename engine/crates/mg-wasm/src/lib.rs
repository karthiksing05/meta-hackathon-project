//! # mg-wasm: browser bindings with a plain C ABI (no wasm-bindgen)
//!
//! Memory protocol:
//! * JS copies input bytes (UTF-8 JSON, key names) into memory from
//!   `mg_alloc(len)`, calls the function with `(ptr, len)`, then `mg_free`s.
//! * Functions that return bytes write them into one shared result buffer and
//!   return its length (≥ 0). JS reads `mg_result_ptr()` right after the call.
//!   The buffer is overwritten by the next call that returns bytes.
//! * Negative return values are error codes (`ERR_*`).
//!
//! Several games can be loaded at once (the feed preloads the next ones).
//! A handle packs a slot index and a generation, so a stale handle never
//! reaches a newer game in the same slot.
//!
//! Panics: the `wasm` profile aborts on panic, which traps. Nothing in this
//! file panics on bad input; a panic inside the engine is recorded by the
//! panic hook (`mg_panic_message`) and JS then calls `mg_forget(h)` to drop
//! the broken game without running its destructors. Other games keep running.

#![allow(clippy::missing_safety_doc)]

pub mod encode;
pub mod log;

use std::cell::UnsafeCell;
use std::rc::Rc;

use mg_core::Diagnostic;
use mg_runtime::Phase;
use mg_scene::{Player, PointerKind};

/// Seed used when neither the caller nor `meta.seed` gives one.
pub const DEFAULT_SEED: u64 = 0x5EED;

pub const ERR_INVALID: i32 = -1;
pub const ERR_HANDLE: i32 = -2;
pub const ERR_ARGS: i32 = -3;
pub const ERR_FULL: i32 = -4;

const MAX_GAMES: usize = 1024;

struct Slot {
    player: Player,
    bin: encode::BinEncoder,
    seed: u64,
    warnings: Vec<Diagnostic>,
    diags: RuntimeDiags,
    /// Every call that affects the game since load or restart (`mg_log`).
    log: log::InputLog,
    /// `log::game_hash` of the game file text.
    game_hash: u64,
}

struct State {
    slots: Vec<Option<Box<Slot>>>,
    gens: Vec<u16>,
    free: Vec<usize>,
    result: Vec<u8>,
    panic_msg: String,
}

struct Global(UnsafeCell<State>);
// SAFETY: wasm32-unknown-unknown is single-threaded, and no exported function
// re-enters another, so there is never more than one live `&mut State`.
unsafe impl Sync for Global {}

static STATE: Global = Global(UnsafeCell::new(State {
    slots: Vec::new(),
    gens: Vec::new(),
    free: Vec::new(),
    result: Vec::new(),
    panic_msg: String::new(),
}));

#[allow(clippy::mut_from_ref)]
fn st() -> &'static mut State {
    // SAFETY: see `Global`.
    unsafe { &mut *STATE.0.get() }
}

fn slot(h: i32) -> Option<&'static mut Slot> {
    if h < 0 {
        return None;
    }
    let idx = (h & 0xffff) as usize;
    let gen = (h >> 16) as u16;
    let s = st();
    if s.gens.get(idx).copied() != Some(gen) {
        return None;
    }
    s.slots.get_mut(idx)?.as_deref_mut()
}

fn set_result(bytes: &[u8]) -> i32 {
    let r = &mut st().result;
    r.clear();
    r.extend_from_slice(bytes);
    r.len() as i32
}

fn result_with(f: impl FnOnce(&mut Vec<u8>)) -> i32 {
    let mut r = std::mem::take(&mut st().result);
    r.clear();
    f(&mut r);
    let n = r.len() as i32;
    st().result = r;
    n
}

fn diags_json(d: &[Diagnostic]) -> i32 {
    result_with(|out| {
        let _ = serde_json::to_writer(out, d);
    })
}

unsafe fn input_bytes<'a>(ptr: *const u8, len: u32) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        &[]
    } else {
        // SAFETY: JS passes a region it wrote from `mg_alloc`.
        unsafe { std::slice::from_raw_parts(ptr, len as usize) }
    }
}

unsafe fn input_str<'a>(ptr: *const u8, len: u32) -> Option<&'a str> {
    std::str::from_utf8(unsafe { input_bytes(ptr, len) }).ok()
}

/// `NaN` / infinities → `None`; negative values wrap like `i64 as u64`.
pub fn seed_from_f64(seed: f64) -> Option<u64> {
    if !seed.is_finite() {
        None
    } else if seed >= 0.0 {
        Some(seed as u64)
    } else {
        Some(seed as i64 as u64)
    }
}

fn phase_code(p: Phase) -> i32 {
    match p {
        Phase::Playing => 0,
        Phase::Won => 1,
        Phase::Lost => 2,
    }
}

// ------------------------------------------------------------- exports ----

/// Installs the panic hook. Call once after instantiating.
#[no_mangle]
pub extern "C" fn mg_init() {
    std::panic::set_hook(Box::new(|info| {
        let msg = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "panic".to_string()
        };
        let loc = info.location().map(|l| format!(" at {}:{}", l.file(), l.line())).unwrap_or_default();
        st().panic_msg = format!("{msg}{loc}");
    }));
}

#[no_mangle]
pub extern "C" fn mg_alloc(len: u32) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1) as usize);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub unsafe extern "C" fn mg_free(ptr: *mut u8, len: u32) {
    if !ptr.is_null() {
        // SAFETY: `ptr` came from `mg_alloc(len)`, which allocated exactly
        // `max(len, 1)` bytes of capacity.
        drop(unsafe { Vec::from_raw_parts(ptr, 0, len.max(1) as usize) });
    }
}

#[no_mangle]
pub extern "C" fn mg_result_ptr() -> *const u8 {
    st().result.as_ptr()
}

#[no_mangle]
pub extern "C" fn mg_result_len() -> u32 {
    st().result.len() as u32
}

/// Diagnostics JSON array → result buffer. Returns its length.
#[no_mangle]
pub unsafe extern "C" fn mg_validate(ptr: *const u8, len: u32) -> i32 {
    match unsafe { input_str(ptr, len) } {
        Some(json) => diags_json(&mg_lang::validate(json)),
        None => diags_json(&[Diagnostic::new(mg_core::Code::Parse, "", "game file is not valid UTF-8")]),
    }
}

/// Compiles and starts a game. Returns a handle ≥ 0, or `ERR_INVALID` with
/// the diagnostics JSON array in the result buffer. `seed`: `NaN` means
/// `meta.seed`, or `DEFAULT_SEED` if the file has none.
#[no_mangle]
pub unsafe extern "C" fn mg_load(ptr: *const u8, len: u32, seed: f64) -> i32 {
    let Some(json) = (unsafe { input_str(ptr, len) }) else {
        diags_json(&[Diagnostic::new(mg_core::Code::Parse, "", "game file is not valid UTF-8")]);
        return ERR_INVALID;
    };
    let compiled = match mg_lang::compile(json) {
        Ok(c) => c,
        Err(d) => {
            diags_json(&d);
            return ERR_INVALID;
        }
    };
    let seed = seed_from_f64(seed).or(compiled.program.meta.seed).unwrap_or(DEFAULT_SEED);
    let s = st();
    let idx = match s.free.pop() {
        Some(i) => i,
        None if s.slots.len() < MAX_GAMES => {
            s.slots.push(None);
            s.gens.push(0);
            s.slots.len() - 1
        }
        None => {
            diags_json(&[Diagnostic::new(mg_core::Code::Limit, "", "too many games loaded")]);
            return ERR_FULL;
        }
    };
    // Generation 1..=0x7fff keeps handles positive.
    let gen = (s.gens[idx] % 0x7fff) + 1;
    s.gens[idx] = gen;
    let player = Player::new(Rc::new(compiled.program), seed);
    st().slots[idx] = Some(Box::new(Slot {
        player,
        bin: encode::BinEncoder::new(),
        seed,
        warnings: compiled.warnings,
        diags: RuntimeDiags::default(),
        log: log::InputLog::default(),
        game_hash: log::game_hash(json),
    }));
    ((gen as i32) << 16) | idx as i32
}

/// Forks a loaded game: a new handle with an exact copy of the game, scene
/// and input log, so `mg_log` on the fork still verifies. Cheap: state
/// containers are shared copy-on-write. For bot look-ahead (try a move on a
/// fork, then `mg_unload` it). Returns the new handle, `ERR_HANDLE` or `ERR_FULL`.
#[no_mangle]
pub extern "C" fn mg_fork(h: i32) -> i32 {
    let Some(src) = slot(h) else { return ERR_HANDLE };
    let copy = Slot {
        player: src.player.clone(),
        // The fork gets its own JS-side decoder, so its string table starts fresh.
        bin: encode::BinEncoder::new(),
        seed: src.seed,
        warnings: src.warnings.clone(),
        diags: src.diags.clone(),
        log: src.log.clone(),
        game_hash: src.game_hash,
    };
    let s = st();
    let idx = match s.free.pop() {
        Some(i) => i,
        None if s.slots.len() < MAX_GAMES => {
            s.slots.push(None);
            s.gens.push(0);
            s.slots.len() - 1
        }
        None => return ERR_FULL,
    };
    let gen = (s.gens[idx] % 0x7fff) + 1;
    s.gens[idx] = gen;
    s.slots[idx] = Some(Box::new(copy));
    ((gen as i32) << 16) | idx as i32
}

fn release(h: i32, run_drop: bool) -> i32 {
    if slot(h).is_none() {
        return ERR_HANDLE;
    }
    let idx = (h & 0xffff) as usize;
    let s = st();
    if let Some(b) = s.slots[idx].take() {
        if run_drop {
            drop(b);
        } else {
            std::mem::forget(b);
        }
    }
    s.free.push(idx);
    0
}

#[no_mangle]
pub extern "C" fn mg_unload(h: i32) -> i32 {
    release(h, true)
}

/// Drops a game that trapped, **without** running its destructors (its
/// memory may be inconsistent). Leaks its memory.
#[no_mangle]
pub extern "C" fn mg_forget(h: i32) -> i32 {
    release(h, false)
}

/// `kind`: 0 down, 1 move, 2 up. Coordinates in canvas units.
#[no_mangle]
pub extern "C" fn mg_pointer(h: i32, kind: i32, x: f64, y: f64) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    let kind = match kind {
        0 => PointerKind::Down,
        1 => PointerKind::Move,
        2 => PointerKind::Up,
        _ => return ERR_ARGS,
    };
    if !x.is_finite() || !y.is_finite() {
        return ERR_ARGS;
    }
    g.log.pointer(kind as u8, x, y);
    g.player.pointer(kind, x, y);
    0
}

/// Key name (`KeyboardEvent.code` or `.key`). Returns 1 if it matched an
/// input source, 0 if not.
#[no_mangle]
pub unsafe extern "C" fn mg_key(h: i32, ptr: *const u8, len: u32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    let Some(code) = (unsafe { input_str(ptr, len) }) else { return ERR_ARGS };
    g.log.key(code);
    g.player.key(code) as i32
}

/// v0.2 full keyboard event: `code` (`KeyboardEvent.code`), `char` (the
/// printable `KeyboardEvent.key`, or empty) and `down` (1 down, 0 up).
/// Returns 1 if it matched an input source, 0 if not.
#[no_mangle]
pub unsafe extern "C" fn mg_key_event(
    h: i32,
    code_ptr: *const u8,
    code_len: u32,
    char_ptr: *const u8,
    char_len: u32,
    down: i32,
) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    let Some(code) = (unsafe { input_str(code_ptr, code_len) }) else { return ERR_ARGS };
    let Some(ch) = (unsafe { input_str(char_ptr, char_len) }) else { return ERR_ARGS };
    g.log.key_event(code, ch, down != 0);
    g.player.key_event(code, ch, down != 0) as i32
}

/// v0.2 text field: `kind` 0 submit, 1 change; `value` UTF-8. Returns 1 if it
/// matched an input source, 0 if not.
#[no_mangle]
pub unsafe extern "C" fn mg_text(h: i32, kind: i32, ptr: *const u8, len: u32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    if !(0..=1).contains(&kind) {
        return ERR_ARGS;
    }
    let Some(value) = (unsafe { input_str(ptr, len) }) else { return ERR_ARGS };
    g.log.text(kind as u8, value);
    g.player.text(log::text_phase(kind as u8), value) as i32
}

/// Swipe direction; only the signs matter (dominant axis is chosen by the
/// shell). Returns 1 if it matched an input source.
#[no_mangle]
pub extern "C" fn mg_swipe(h: i32, dx: i32, dy: i32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    let (dx, dy) = if dx.abs() >= dy.abs() { (dx.signum(), 0) } else { (0, dy.signum()) };
    if dx == 0 && dy == 0 {
        return ERR_ARGS;
    }
    g.log.swipe(dx, dy);
    g.player.swipe(dx, dy) as i32
}

/// Advances the game. Returns the phase: 0 playing, 1 won, 2 lost.
#[no_mangle]
pub extern "C" fn mg_step(h: i32, dt_ms: f64) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    let dt = if dt_ms.is_finite() && dt_ms > 0.0 { dt_ms } else { 0.0 };
    g.log.step(dt);
    g.player.step(dt);
    phase_code(g.player.game.phase())
}

#[no_mangle]
pub extern "C" fn mg_phase(h: i32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    phase_code(g.player.game.phase())
}

/// The B4 JSON frame → result buffer.
#[no_mangle]
pub extern "C" fn mg_frame_json(h: i32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    g.log.frame();
    let f = g.player.frame();
    result_with(|out| encode::frame_json(f, out))
}

/// The binary frame (`web/FRAME_FORMAT.md`) → result buffer.
#[no_mangle]
pub extern "C" fn mg_frame_bin(h: i32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    g.log.frame();
    let f = g.player.frame();
    let bin = &mut g.bin;
    result_with(|out| bin.encode(f, out))
}

/// Makes the next binary frame re-send every string (sets the reset flag).
#[no_mangle]
pub extern "C" fn mg_frame_bin_reset(h: i32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    g.bin.reset();
    0
}

/// `{"phase": "playing"|"won"|"lost", "score": number|null, "time_ms": int}`.
#[no_mangle]
pub extern "C" fn mg_status(h: i32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    let s = g.player.status();
    let v = serde_json::json!({ "phase": s.phase.as_str(), "score": s.score, "time_ms": s.time_ms });
    set_result(v.to_string().as_bytes())
}

/// Restarts. `seed`: `NaN` reuses the game's current seed.
#[no_mangle]
pub extern "C" fn mg_restart(h: i32, seed: f64) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    if let Some(s) = seed_from_f64(seed) {
        g.seed = s;
    }
    g.player.restart(g.seed);
    g.log.clear();
    0
}

/// The input log since load or restart (`microgame-log/1` JSON, see
/// `log.rs`), with `final` = the current state hash, phase, score and time.
/// `microgame verify` replays it natively.
#[no_mangle]
pub extern "C" fn mg_log(h: i32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    let v = g.log.to_json(g.seed, g.game_hash, &g.player);
    result_with(|out| {
        let _ = serde_json::to_writer(out, &v);
    })
}

/// v0.2 assets in id order → JSON array
/// `[{id, name, kind: "image"|"sound", src, svg, w, h, frames, cols, fps}]`.
/// `svg` is true when `src` is inline SVG markup. Sounds have `null` sizes.
#[no_mangle]
pub extern "C" fn mg_assets(h: i32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    let v = assets_json(g.player.game.program());
    result_with(|out| {
        let _ = serde_json::to_writer(out, &v);
    })
}

pub fn assets_json(p: &mg_core::Program) -> serde_json::Value {
    use mg_core::ir::{AssetKind, AssetSrc};
    let list: Vec<_> = p
        .assets
        .iter()
        .enumerate()
        .map(|(id, a)| match &a.kind {
            AssetKind::Image { src, w, h, frames, cols, fps } => serde_json::json!({
                "id": id, "name": &*a.name, "kind": "image", "src": src.as_str(),
                "svg": matches!(src, AssetSrc::Svg(_)),
                "w": w, "h": h, "frames": frames, "cols": cols, "fps": fps,
            }),
            AssetKind::Sound { src } => serde_json::json!({
                "id": id, "name": &*a.name, "kind": "sound", "src": src.as_str(),
                "svg": matches!(src, AssetSrc::Svg(_)),
                "w": null, "h": null, "frames": null, "cols": null, "fps": null,
            }),
        })
        .collect();
    serde_json::Value::Array(list)
}

/// `meta.text_input`: `{placeholder, max_len, x, y, w, h, size}` (placement
/// fields `null` = shell default), or `null` when no input has a text source.
pub fn text_input_json(p: &mg_core::Program) -> serde_json::Value {
    match &p.text_input {
        None => serde_json::Value::Null,
        Some(t) => {
            let (x, y, w, h) = match t.rect {
                Some((x, y, w, h)) => (Some(x), Some(y), Some(w), Some(h)),
                None => (None, None, None, None),
            };
            serde_json::json!({
                "placeholder": &*t.placeholder, "max_len": t.max_len,
                "x": x, "y": y, "w": w, "h": h, "size": t.size,
            })
        }
    }
}

/// Named state JSON → result buffer.
#[no_mangle]
pub extern "C" fn mg_state_json(h: i32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    let v = g.player.game.program().state_to_json(g.player.game.state());
    set_result(v.to_string().as_bytes())
}

/// Current tap and drag targets as JSON `[{x, y, w, h, drag}]` (canvas
/// units, topmost first) → result buffer. Builds a frame first if needed.
/// For bots: tap the center of a target.
#[no_mangle]
pub extern "C" fn mg_hit_targets(h: i32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    let targets = g.player.hit_targets();
    result_with(|out| {
        out.push(b'[');
        for (i, t) in targets.iter().enumerate() {
            if i > 0 {
                out.push(b',');
            }
            let _ = std::io::Write::write_fmt(
                out,
                format_args!("{{\"x\":{},\"y\":{},\"w\":{},\"h\":{},\"drag\":{}}}", t.x, t.y, t.w, t.h, t.drag),
            );
        }
        out.push(b']');
    })
}

/// State hash as 16 lowercase hex digits → result buffer.
#[no_mangle]
pub extern "C" fn mg_state_hash(h: i32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    set_result(hex64(g.player.game.state_hash()).as_bytes())
}

/// `{title, instructions, duration_s, seed, file_seed, canvas: {w, h},
/// text_input, assets (count), warnings}` → result buffer.
#[no_mangle]
pub extern "C" fn mg_meta(h: i32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    let p = g.player.game.program();
    let v = serde_json::json!({
        "title": &*p.meta.title,
        "instructions": &*p.meta.instructions,
        "duration_s": p.meta.duration_s,
        "seed": g.seed,
        "file_seed": p.meta.seed,
        "canvas": { "w": p.presentation.canvas.w, "h": p.presentation.canvas.h },
        "text_input": text_input_json(p),
        "assets": p.assets.len(),
        "warnings": &g.warnings,
    });
    set_result(v.to_string().as_bytes())
}

/// Runtime diagnostics (`E_RUNTIME`, `E_LIMIT`) since the last call → JSON array.
#[no_mangle]
pub extern "C" fn mg_diagnostics(h: i32) -> i32 {
    let Some(g) = slot(h) else { return ERR_HANDLE };
    let d = g.diags.take(&mut g.player);
    diags_json(&d)
}

/// The message of the last panic (empty if none) → result buffer.
#[no_mangle]
pub extern "C" fn mg_panic_message() -> i32 {
    let msg = std::mem::take(&mut st().panic_msg);
    set_result(msg.as_bytes())
}

/// Number of games currently loaded.
#[no_mangle]
pub extern "C" fn mg_live_games() -> i32 {
    st().slots.iter().filter(|s| s.is_some()).count() as i32
}

/// Collects runtime diagnostics from the game logic (taken from the `Game`)
/// and from the presentation (`Player::diagnostics`, a cumulative list, so
/// this remembers how much of it was already reported).
#[derive(Default, Clone, Debug)]
pub struct RuntimeDiags {
    scene_seen: usize,
}

impl RuntimeDiags {
    /// Everything new since the last call.
    pub fn take(&mut self, p: &mut Player) -> Vec<Diagnostic> {
        let mut out = p.game.take_diagnostics();
        let scene = p.diagnostics();
        if scene.len() < self.scene_seen {
            self.scene_seen = 0; // the list was cleared (restart)
        }
        out.extend_from_slice(&scene[self.scene_seen..]);
        self.scene_seen = scene.len();
        out
    }
}

pub fn hex64(v: u64) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(16);
    for i in (0..16).rev() {
        s.push(HEX[((v >> (i * 4)) & 15) as usize] as char);
    }
    s
}
