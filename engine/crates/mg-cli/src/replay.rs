//! Scripted replays (spec B5 `replay`).
//!
//! A script is a JSON array (or `{"inputs": [...]}`) of entries sorted by `t`
//! (game time in ms):
//!
//! ```json
//! [ {"t": 0,   "key": "ArrowUp"},
//!   {"t": 300, "swipe": "left"},
//!   {"t": 450, "tap": [120, 300]},
//!   {"t": 500, "down": [10, 10]}, {"t": 520, "move": [40, 10]}, {"t": 540, "up": [40, 10]},
//!   {"t": 600, "input": "tap_cell", "with": {"cell": [2, 3]}},
//!   {"t": 3000} ]
//! ```
//!
//! The game is stepped to each `t` in `dt` (16 ms) increments, a frame is
//! built after every step (as the shell does), and then the entry is applied.
//! An entry with only `t` just advances time. After the last entry the game
//! is stepped `tail_ms` more so the last input is processed.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::rc::Rc;

use mg_core::ir::InputId;
use mg_core::value::Value;
use mg_core::{Diagnostic, Program};
use mg_runtime::Status;
use mg_scene::{Player, PointerKind};
use serde_json::Value as J;

use crate::value_json::json_to_value;

#[derive(Clone, Debug)]
pub enum Action {
    Wait,
    Key(String),
    Swipe(i32, i32),
    Tap(f64, f64),
    Pointer(PointerKind, f64, f64),
    Input(InputId, Vec<Value>),
}

#[derive(Clone, Debug)]
pub struct Entry {
    pub t: f64,
    pub action: Action,
}

pub fn parse_script(text: &str, program: &Program) -> Result<Vec<Entry>, String> {
    let doc: J = serde_json::from_str(text).map_err(|e| format!("script is not valid JSON: {e}"))?;
    let items = match &doc {
        J::Array(a) => a,
        J::Object(o) => o.get("inputs").and_then(J::as_array).ok_or("script must be an array of entries")?,
        _ => return Err("script must be an array of entries".into()),
    };
    let mut out = Vec::with_capacity(items.len());
    let mut last_t = 0.0;
    for (i, it) in items.iter().enumerate() {
        let err = |m: String| format!("script entry {i}: {m}");
        let o = it.as_object().ok_or_else(|| err("must be an object".into()))?;
        let t = o.get("t").and_then(J::as_f64).ok_or_else(|| err("needs a numeric \"t\" (ms)".into()))?;
        if t.is_nan() || t < last_t {
            return Err(err(format!("t = {t} is before the previous entry ({last_t})")));
        }
        last_t = t;
        let action = parse_action(o, program).map_err(err)?;
        out.push(Entry { t, action });
    }
    Ok(out)
}

fn xy(j: &J) -> Result<(f64, f64), String> {
    match j.as_array().map(|a| a.as_slice()) {
        Some([x, y]) => Ok((x.as_f64().ok_or("x must be a number")?, y.as_f64().ok_or("y must be a number")?)),
        _ => Err(format!("expected [x, y], found {j}")),
    }
}

fn parse_action(o: &serde_json::Map<String, J>, program: &Program) -> Result<Action, String> {
    if let Some(k) = o.get("key") {
        return Ok(Action::Key(k.as_str().ok_or("\"key\" must be a string")?.to_string()));
    }
    if let Some(s) = o.get("swipe") {
        let (dx, dy) = match s {
            J::String(d) => match d.as_str() {
                "left" => (-1, 0),
                "right" => (1, 0),
                "up" => (0, -1),
                "down" => (0, 1),
                other => return Err(format!("unknown swipe '{other}' (left, right, up, down)")),
            },
            other => {
                let (x, y) = xy(other)?;
                (x.signum() as i32, y.signum() as i32)
            }
        };
        return Ok(Action::Swipe(dx, dy));
    }
    if let Some(p) = o.get("tap") {
        let (x, y) = xy(p)?;
        return Ok(Action::Tap(x, y));
    }
    for (name, kind) in [("down", PointerKind::Down), ("move", PointerKind::Move), ("up", PointerKind::Up)] {
        if let Some(p) = o.get(name) {
            let (x, y) = xy(p)?;
            return Ok(Action::Pointer(kind, x, y));
        }
    }
    if let Some(name) = o.get("input") {
        let name = name.as_str().ok_or("\"input\" must be a string")?;
        let id = program.input_index(name).ok_or_else(|| {
            let names: Vec<&str> = program.inputs.iter().map(|i| &*i.name).collect();
            format!("unknown input '{name}' (inputs: {})", names.join(", "))
        })?;
        let def = &program.inputs[id as usize];
        let with = o.get("with").cloned().unwrap_or(J::Object(Default::default()));
        let with = with.as_object().ok_or("\"with\" must be an object")?;
        let declared = &def.payload[..def.payload.len().saturating_sub(1)]; // the last field is `t`
        let mut payload = Vec::with_capacity(declared.len());
        for (field, ty) in declared {
            let v = with.get(&**field).ok_or_else(|| format!("input '{name}' needs \"with\": {{\"{field}\": ...}}"))?;
            payload.push(json_to_value(v, ty).map_err(|e| format!("with.{field}: {e}"))?);
        }
        for k in with.keys() {
            if !declared.iter().any(|(f, _)| &**f == k) {
                return Err(format!("input '{name}' has no field '{k}'"));
            }
        }
        return Ok(Action::Input(id, payload));
    }
    if o.len() == 1 {
        return Ok(Action::Wait);
    }
    Err("unknown entry: use key, swipe, tap, down/move/up, input, or only t".into())
}

#[derive(Clone, Debug)]
pub struct ReplayResult {
    pub status: Status,
    pub hash: u64,
    pub state: J,
    /// Indexes of `key`/`swipe` entries that matched no input source.
    pub unmatched: Vec<usize>,
    pub errors: Vec<Diagnostic>,
    pub panic: Option<String>,
    pub steps: u64,
}

pub fn replay(program: &Rc<Program>, seed: u64, script: &[Entry], dt: f64, tail_ms: f64) -> ReplayResult {
    let mut res = ReplayResult {
        status: Status { phase: mg_runtime::Phase::Playing, score: None, time_ms: 0 },
        hash: 0,
        state: J::Null,
        unmatched: Vec::new(),
        errors: Vec::new(),
        panic: None,
        steps: 0,
    };
    let r = catch_unwind(AssertUnwindSafe(|| run(program, seed, script, dt, tail_ms, &mut res)));
    if let Err(p) = r {
        res.panic = Some(crate::panic_message(&*p));
    }
    res
}

fn run(program: &Rc<Program>, seed: u64, script: &[Entry], dt: f64, tail_ms: f64, res: &mut ReplayResult) {
    let dt = if dt > 0.0 { dt } else { 16.0 };
    let mut player = Player::new(program.clone(), seed);
    player.frame();
    let mut now = 0.0f64;
    let mut diags = mg_wasm::RuntimeDiags::default();
    let mut advance = |player: &mut Player, to: f64, res: &mut ReplayResult, diags: &mut mg_wasm::RuntimeDiags| {
        while now < to - 1e-9 {
            let d = dt.min(to - now);
            player.step(d);
            now += d;
            res.steps += 1;
            player.frame();
            res.errors.extend(diags.take(player));
        }
    };
    for (i, e) in script.iter().enumerate() {
        advance(&mut player, e.t, res, &mut diags);
        match &e.action {
            Action::Wait => {}
            Action::Key(k) => {
                if !player.key(k) {
                    res.unmatched.push(i);
                }
            }
            Action::Swipe(dx, dy) => {
                if !player.swipe(*dx, *dy) {
                    res.unmatched.push(i);
                }
            }
            Action::Tap(x, y) => {
                player.pointer(PointerKind::Down, *x, *y);
                player.pointer(PointerKind::Up, *x, *y);
            }
            Action::Pointer(k, x, y) => player.pointer(*k, *x, *y),
            Action::Input(id, payload) => player.game.input(*id, payload.clone()),
        }
    }
    let end = script.last().map_or(0.0, |e| e.t) + tail_ms.max(0.0);
    advance(&mut player, end, res, &mut diags);
    res.errors.extend(diags.take(&mut player));
    res.status = player.status();
    res.hash = player.game.state_hash();
    res.state = player.game.program().state_to_json(player.game.state());
}
