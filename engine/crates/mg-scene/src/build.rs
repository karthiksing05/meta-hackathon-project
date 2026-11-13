//! Scene evaluation: layout, bindings, transitions, `animate_on`, hit records
//! and feedback. Independent of `Game` so it can be unit-tested with a
//! hand-built `Program` and constant state.
//!
//! ## Layout model
//! Each node is laid out with its own origin at (0, 0), emitting ops and hit
//! records in local coordinates and returning its content bounds. The parent
//! then translates that op range into place:
//! * free placement (group / repeat children, grid cells, the root):
//!   `anchor: top_left` puts the node's origin at `(x, y)`; `anchor: center`
//!   puts the center of its bounds at `(x, y)`;
//! * stack placement: the child's bounds' top-left goes to the slot (cross
//!   axis aligned within the widest / tallest child) and the child's own
//!   `x` / `y` are added as an offset.
//!
//! Content bounds: rect `(0,0,w,h)`; circle `(-r,-r,r,r)` (so `x`/`y` is its
//! center either way); text its box; group / repeat the union of their
//! children; stack its packed size; grid `cols*cell+(cols-1)*gap` square;
//! v0.2 image `(0,0,w,h)`, line and poly the bounding box of their points.
//!
//! v0.2: after layout, non-`fixed` ops and hit records are shifted by
//! `-camera`, and the frame is ordered world ops, particles, fixed ops (see
//! `Scene::layers`). Image `frame` defaults to
//! `floor(clock * fps / 1000) % frames`; the cache rebuilds exactly when that
//! changes. Particles are analytic in their age (`p0 + v t + g t²/2`, opacity
//! `1 - age/ms`), seeded by `(fired-event sequence, feedback index)`.
//!
//! v0.1 limits: `rotation` and `scale` apply to the op that carries them
//! (around its center) and do not propagate from a group to its children;
//! `fill` / `stroke` on containers are ignored; hit boxes ignore rotation and
//! scale.

use std::collections::HashSet;
use std::rc::Rc;

use mg_core::color::{parse_color, Rgba};
use mg_core::frame::{
    note_to_hz, CircleOp, DrawOp, Frame, Haptic, ImageOp, LineOp, MusicState, PolyOp, RectOp, Sound, SoundKind,
    TextOp, Toast, Wave,
};
use mg_core::hash::splitmix64;
use mg_core::ir::{AssetId, AssetKind, Expr, Program, Slot};
use mg_core::limits::{MAX_COLLECTION_LEN, MAX_PARTICLES, MAX_PARTICLES_PER_BURST, MAX_POLY_POINTS, MAX_RENDER_OPS};
use mg_core::scene::{Align, Anchor, Dir, FeedbackAction, InputBinding, ParticlesAction, Prop, PropName, SoundAction};
use mg_core::{Code, Diagnostic, Value};
use mg_runtime::eval::{eval_pure, EvalError, Locals, PureEnv};
use mg_runtime::{Fired, Phase};

use crate::motion::{sample_keys, Anim, Tween, PV};
use crate::template::{
    resolve_asset, AssetRef, Color, FromValue, Points, TKind, TNode, Template, Weight, BLACK, DEFAULT_FONT, P,
};
use crate::text::{measure_text, wrap_text, LINE_HEIGHT_EM};
use crate::util::{cell_local, child_ctx, mix, prop_bit, prop_key, value_hash, Bounds, KeyMap};

/// Most diagnostics kept (first error per prop).
const MAX_DIAGS: usize = 256;
/// Most `animate_on` events waiting for the next build.
const MAX_PENDING_EVENTS: usize = 512;
/// Most notes in one jingle.
const MAX_JINGLE_NOTES: usize = 256;

/// Pseudo node ids for diagnostics on presentation-level props.
const CANVAS_ID: u32 = u32::MAX;
const CAMERA_ID: u32 = u32::MAX - 1;
const MUSIC_ID: u32 = u32::MAX - 2;

/// One live particle. Its position is analytic in its age, so replays and
/// frame rates never change the path.
#[derive(Clone, Debug)]
struct Particle {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    gravity: f64,
    r: f64,
    color: Rgba,
    start: f64,
    ms: f64,
}

/// Tiny deterministic RNG for particle bursts (splitmix64 stream).
struct BurstRng(u64);

impl BurstRng {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        (splitmix64(self.0) >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Translates one op.
#[inline]
fn shift_op(op: &mut DrawOp, dx: f64, dy: f64) {
    match op {
        DrawOp::Rect(r) => {
            r.x += dx;
            r.y += dy;
        }
        DrawOp::Circle(c) => {
            c.x += dx;
            c.y += dy;
        }
        DrawOp::Text(t) => {
            t.x += dx;
            t.y += dy;
        }
        DrawOp::Image(i) => {
            i.x += dx;
            i.y += dy;
        }
        DrawOp::Line(l) => {
            l.x1 += dx;
            l.y1 += dy;
            l.x2 += dx;
            l.y2 += dy;
        }
        DrawOp::Poly(p) => {
            for pt in &mut p.points {
                pt.0 += dx;
                pt.1 += dy;
            }
        }
    }
}

/// A tappable / draggable region recorded during layout.
#[derive(Clone, Debug)]
pub struct HitRec {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub node: u32,
    /// Range into `Scene::saved`: node-local slots in scope at the node.
    pub saved: (u32, u32),
    /// A `fixed` (HUD) node: its pointer values are canvas coordinates.
    pub fixed: bool,
}

#[derive(Clone, Copy)]
struct ChildRec {
    op0: u32,
    op1: u32,
    hit0: u32,
    hit1: u32,
    b: Bounds,
    x: f64,
    y: f64,
}

/// Read-only game view for one evaluation pass.
#[derive(Clone, Copy)]
pub struct View<'a> {
    pub state: &'a [Value],
    pub now_ms: i64,
    pub phase: Phase,
}

#[derive(Clone)]
pub struct Diags {
    pub list: Vec<Diagnostic>,
    seen: HashSet<u64>,
}

impl Diags {
    fn new() -> Diags {
        Diags { list: Vec::new(), seen: HashSet::new() }
    }
    fn report(&mut self, key: u64, code: Code, at: impl FnOnce() -> String, msg: impl FnOnce() -> String) {
        if self.list.len() >= MAX_DIAGS || !self.seen.insert(key) {
            return;
        }
        self.list.push(Diagnostic::new(code, at(), msg()));
    }
}

fn name_key(node: u64, name: &str) -> u64 {
    mix(node, value_hash(&Value::str(name)))
}

/// Evaluates with fast paths for the common trivial expressions.
#[inline]
pub fn eval_expr(
    program: &Program,
    view: View,
    event: &[Value],
    locals: &mut Locals,
    e: &Expr,
) -> Result<Value, EvalError> {
    match e {
        Expr::Const(v) => Ok(v.clone()),
        Expr::Local(s) => Ok(locals.stack.get(*s as usize).cloned().unwrap_or_default()),
        Expr::State(i) => view
            .state
            .get(*i as usize)
            .cloned()
            .ok_or_else(|| EvalError { message: format!("state {i} out of range") }),
        Expr::Status => Ok(Value::str(view.phase.as_str())),
        _ => {
            let env = PureEnv { program, state: view.state, now_ms: view.now_ms, phase: view.phase, event };
            eval_pure(&env, locals, e)
        }
    }
}

#[inline]
fn set_local(locals: &mut Locals, slot: Slot, v: Value) {
    if let Some(x) = locals.stack.get_mut(slot as usize) {
        *x = v;
    }
}

/// All presentation state that survives between frames.
#[derive(Clone)]
pub struct Scene {
    pub tpl: Rc<Template>,
    pub program: Rc<Program>,
    pub locals: Locals,
    pub frame: Frame,
    /// Hit records in canvas (screen) coordinates, camera applied, in paint
    /// order (world targets first, then fixed ones).
    pub hits: Vec<HitRec>,
    /// Camera of the last build (world = canvas + camera).
    pub camera: (f64, f64),
    /// Per op of `frame.ops` during layout: drawn by a fixed node.
    op_fixed: Vec<bool>,
    op_scratch: Vec<DrawOp>,
    fixed_ops: Vec<DrawOp>,
    particles: Vec<Particle>,
    /// New particles since the last build.
    particles_dirty: bool,
    /// The last build drew particles.
    built_particles: bool,
    /// Clock time at which some auto-animated image changes frame.
    next_image_change: f64,
    /// Sequence number of the next fired event (seeds particle bursts).
    fired_seq: u64,
    pub saved: Vec<(Slot, Value)>,
    scope: Vec<(Slot, Value)>,
    scratch: Vec<ChildRec>,
    tweens: KeyMap<Tween>,
    anims: KeyMap<Anim>,
    /// Fired events some `animate_on` listens to, with the clock when fired.
    pending: Vec<(Fired, f64)>,
    gen: u32,
    /// Presentation clock (ms), advanced by `Player::step`.
    pub clock: f64,
    /// Latest end time of any running tween / animation.
    anim_until: f64,
    pub diags: Diags,
    font: Rc<str>,
    // Build cache.
    pub built: bool,
    built_clock: f64,
    built_version: u64,
    built_state: Vec<Value>,
    built_now: i64,
    built_phase: Phase,
    // Feedback output.
    audio: Vec<Sound>,
    toasts: Vec<Toast>,
    haptics: Vec<Haptic>,
    shake_px: f64,
    shake_ms: f64,
    shake_start: f64,
    ops_capped: bool,
    pub builds: u64,
}

impl Scene {
    pub fn new(program: Rc<Program>) -> Scene {
        let mut load = Vec::new();
        let tpl = Template::compile(&program, &mut load);
        let mut locals = Locals::new();
        locals.reset(tpl.n_locals.max(tpl.pointer_slot.saturating_add(1)));
        let mut diags = Diags::new();
        diags.list = load;
        Scene {
            tpl: Rc::new(tpl),
            program,
            locals,
            frame: Frame::default(),
            hits: Vec::new(),
            camera: (0.0, 0.0),
            op_fixed: Vec::new(),
            op_scratch: Vec::new(),
            fixed_ops: Vec::new(),
            particles: Vec::new(),
            particles_dirty: false,
            built_particles: false,
            next_image_change: f64::INFINITY,
            fired_seq: 0,
            saved: Vec::new(),
            scope: Vec::new(),
            scratch: Vec::new(),
            tweens: KeyMap::default(),
            anims: KeyMap::default(),
            pending: Vec::new(),
            gen: 0,
            clock: 0.0,
            anim_until: f64::NEG_INFINITY,
            diags,
            font: Rc::from(DEFAULT_FONT),
            built: false,
            built_clock: 0.0,
            built_version: 0,
            built_state: Vec::new(),
            built_now: 0,
            built_phase: Phase::Playing,
            audio: Vec::new(),
            toasts: Vec::new(),
            haptics: Vec::new(),
            shake_px: 0.0,
            shake_ms: 0.0,
            shake_start: 0.0,
            ops_capped: false,
            builds: 0,
        }
    }

    /// Clears all motion, feedback and caches (restart). Diagnostics stay.
    pub fn reset(&mut self) {
        self.tweens.clear();
        self.anims.clear();
        self.pending.clear();
        self.hits.clear();
        self.saved.clear();
        self.frame.ops.clear();
        self.frame.audio.clear();
        self.frame.toasts.clear();
        self.frame.haptics.clear();
        self.frame.music = None;
        self.audio.clear();
        self.toasts.clear();
        self.haptics.clear();
        self.particles.clear();
        self.particles_dirty = false;
        self.built_particles = false;
        self.next_image_change = f64::INFINITY;
        self.fired_seq = 0;
        self.camera = (0.0, 0.0);
        self.shake_px = 0.0;
        self.clock = 0.0;
        self.anim_until = f64::NEG_INFINITY;
        self.built = false;
        self.built_state.clear();
        self.locals.reset(self.tpl.n_locals.max(self.tpl.pointer_slot.saturating_add(1)));
    }

    /// Whether the cached ops are stale.
    pub fn needs_build(&mut self, view: View, version: u64) -> bool {
        if !self.built || !self.pending.is_empty() || self.particles_dirty {
            return true;
        }
        if self.clock > self.built_clock
            && (self.anim_until > self.built_clock
                || self.built_particles
                || !self.particles.is_empty()
                || self.clock >= self.next_image_change)
        {
            return true;
        }
        if version == self.built_version {
            return false;
        }
        // The version also moves with time; only rebuild if something the
        // bindings can read actually changed.
        let changed = view.phase != self.built_phase
            || (self.tpl.uses_now && view.now_ms != self.built_now)
            || view.state.len() != self.built_state.len()
            || view.state.iter().zip(&self.built_state).any(|(a, b)| a != b);
        if !changed {
            self.built_version = version;
        }
        changed
    }

    /// Advances the presentation clock and drops stale pending events.
    pub fn advance(&mut self, dt_ms: f64) {
        if dt_ms.is_finite() && dt_ms > 0.0 {
            self.clock += dt_ms;
        }
        let horizon = self.clock - self.tpl.max_anim_ms;
        if self.pending.first().is_some_and(|(_, t)| *t < horizon) {
            self.pending.retain(|(_, t)| *t >= horizon);
        }
        if !self.particles.is_empty() {
            let now = self.clock;
            self.particles.retain(|p| now - p.start < p.ms);
        }
    }

    /// Particles alive now (tests).
    #[cfg(test)]
    pub fn particle_count(&self) -> usize {
        self.particles.len()
    }

    // ── Fired events: animation queue + feedback ────────────────────────────

    pub fn on_fired(&mut self, fired: &[Fired], view: View) {
        let tpl = self.tpl.clone();
        for f in fired {
            let seq = self.fired_seq;
            self.fired_seq += 1;
            if tpl.anim_events.contains(&f.on) {
                if self.pending.len() >= MAX_PENDING_EVENTS {
                    self.pending.remove(0);
                }
                self.pending.push((f.clone(), self.clock));
            }
            for (fi, fb) in tpl.feedback.iter().enumerate() {
                if fb.on != f.on {
                    continue;
                }
                if let Some(w) = &fb.when {
                    if !self.fb_when(fi, w, &f.payload, view) {
                        continue;
                    }
                }
                for (ai, act) in fb.actions.iter().enumerate() {
                    self.feedback_action(seq, fi, ai, act, &f.payload, view);
                }
            }
        }
    }

    /// v0.2.1: a feedback entry's `when`. An error or a non-bool counts as
    /// false (reported once).
    fn fb_when(&mut self, fi: usize, e: &Expr, event: &[Value], view: View) -> bool {
        let at = || format!("/presentation/feedback/{fi}/when");
        let key = name_key(0xFEED_0000 + ((fi as u64) << 8) + 0xFF, "when");
        match eval_expr(&self.program, view, event, &mut self.locals, e) {
            Ok(Value::Bool(b)) => b,
            Ok(v) => {
                self.diags.report(key, Code::Presentation, at, || format!("`when` must be a bool, got `{v}`"));
                false
            }
            Err(err) => {
                self.diags.report(key, Code::Runtime, at, || err.message.clone());
                false
            }
        }
    }

    fn fb_eval(&mut self, fi: usize, ai: usize, name: &str, p: &Prop, event: &[Value], view: View) -> Option<Value> {
        match p {
            Prop::Const(v) => Some(v.clone()),
            Prop::Expr(e) => match eval_expr(&self.program, view, event, &mut self.locals, e) {
                Ok(v) => Some(v),
                Err(err) => {
                    self.diags.report(
                        name_key(0xFEED_0000 + ((fi as u64) << 8) + ai as u64, name),
                        Code::Runtime,
                        || format!("/presentation/feedback/{fi}/do/{ai}/{name}"),
                        || err.message.clone(),
                    );
                    None
                }
            },
        }
    }

    fn fb_bad(&mut self, fi: usize, ai: usize, name: &str, what: &str, v: &Value) {
        self.diags.report(
            name_key(0xFEED_0000 + ((fi as u64) << 8) + ai as u64, name),
            Code::Presentation,
            || format!("/presentation/feedback/{fi}/do/{ai}/{name}"),
            || format!("`{name}` must be {what}, got `{v}`"),
        );
    }

    fn fb_num(&mut self, fi: usize, ai: usize, name: &str, p: &Prop, event: &[Value], view: View) -> Option<f64> {
        let v = self.fb_eval(fi, ai, name, p, event, view)?;
        let n = v.as_f64();
        if n.is_none() {
            self.fb_bad(fi, ai, name, "a number", &v);
        }
        n
    }

    fn fb_str(&mut self, fi: usize, ai: usize, name: &str, p: &Prop, event: &[Value], view: View) -> Option<Rc<str>> {
        let v = self.fb_eval(fi, ai, name, p, event, view)?;
        match v {
            Value::Str(s) => Some(s),
            v => {
                self.fb_bad(fi, ai, name, "a string", &v);
                None
            }
        }
    }

    /// A note name (`C5`, `F#4`) or a number in Hz.
    fn fb_hz(&mut self, fi: usize, ai: usize, name: &str, v: &Value) -> Option<f64> {
        let hz = match v {
            Value::Str(s) => note_to_hz(s),
            v => v.as_f64(),
        };
        let hz = hz.filter(|h| h.is_finite() && *h > 0.0);
        if hz.is_none() {
            self.fb_bad(fi, ai, name, "a note name or Hz", v);
        }
        hz
    }

    fn fb_asset(&mut self, fi: usize, ai: usize, p: &Prop, event: &[Value], view: View) -> Option<AssetId> {
        let name = self.fb_str(fi, ai, "asset", p, event, view)?;
        match resolve_asset(&self.program, &self.tpl.asset_ids, &name, false) {
            Ok(id) => Some(id),
            Err(msg) => {
                self.diags.report(
                    name_key(0xFEED_0000 + ((fi as u64) << 8) + ai as u64, "asset"),
                    Code::Asset,
                    || format!("/presentation/feedback/{fi}/do/{ai}/asset"),
                    || msg,
                );
                None
            }
        }
    }

    fn feedback_action(&mut self, seq: u64, fi: usize, ai: usize, act: &FeedbackAction, event: &[Value], view: View) {
        match act {
            FeedbackAction::Sound(snd) => {
                if let Some(s) = self.sound(fi, ai, snd, event, view) {
                    self.audio.push(s);
                }
            }
            FeedbackAction::Toast { text, ms } => {
                let Some(t) = self.fb_eval(fi, ai, "text", text, event, view) else { return };
                let text = <Rc<str>>::from_value(&t).unwrap_or_else(|| Rc::from(""));
                let ms = self.fb_num(fi, ai, "ms", ms, event, view).unwrap_or(1500.0).max(0.0);
                self.toasts.push(Toast { text, ms });
            }
            FeedbackAction::Shake { px, ms } => {
                let Some(px) = self.fb_num(fi, ai, "px", px, event, view) else { return };
                let ms = self.fb_num(fi, ai, "ms", ms, event, view).unwrap_or(300.0).max(0.0);
                // A new shake replaces the current one if it's at least as strong.
                if px.abs() >= self.current_shake() {
                    self.shake_px = px.abs();
                    self.shake_ms = ms;
                    self.shake_start = self.clock;
                }
            }
            FeedbackAction::Particles(pa) => self.burst(seq, fi, ai, pa, event, view),
            FeedbackAction::Haptic(p) => {
                let Some(name) = self.fb_str(fi, ai, "haptic", p, event, view) else { return };
                match Haptic::from_name(&name) {
                    Some(h) => self.haptics.push(h),
                    None => self.fb_bad(
                        fi,
                        ai,
                        "haptic",
                        "light | medium | heavy | success | warning | error",
                        &Value::Str(name),
                    ),
                }
            }
        }
    }

    /// Sample (`asset`), jingle (`notes`) or a single synth note (with an
    /// optional `slide`). Volume is clamped to 0..1.
    fn sound(&mut self, fi: usize, ai: usize, a: &SoundAction, event: &[Value], view: View) -> Option<Sound> {
        let volume = self.fb_num(fi, ai, "volume", &a.volume, event, view).unwrap_or(0.6);
        let volume = if volume.is_finite() { volume.clamp(0.0, 1.0) } else { 0.6 };
        if let Some(asset) = &a.asset {
            let asset = self.fb_asset(fi, ai, asset, event, view)?;
            let rate = self.fb_num(fi, ai, "rate", &a.rate, event, view).unwrap_or(1.0);
            let rate = if rate.is_finite() && rate > 0.0 { rate.clamp(0.0625, 16.0) } else { 1.0 };
            // A sample plays to its end; its length isn't known to the engine.
            return Some(Sound { kind: SoundKind::Sample { asset, rate }, volume, ms: 0.0 });
        }
        let wave = match self.fb_eval(fi, ai, "wave", &a.wave, event, view) {
            Some(v) => match v.as_str().and_then(Wave::from_name) {
                Some(w) => w,
                None => {
                    self.fb_bad(fi, ai, "wave", "sine | square | triangle | sawtooth", &v);
                    Wave::Sine
                }
            },
            None => Wave::Sine,
        };
        let slide_to_hz = match &a.slide {
            None => None,
            Some(p) => {
                let v = self.fb_eval(fi, ai, "slide", p, event, view)?;
                Some(self.fb_hz(fi, ai, "slide", &v)?)
            }
        };
        let (freqs, step_ms) = if let Some(notes) = &a.notes {
            let nv = self.fb_eval(fi, ai, "notes", notes, event, view)?;
            let Value::List(items) = &nv else {
                self.fb_bad(fi, ai, "notes", "a list of notes", &nv);
                return None;
            };
            let mut freqs = Vec::with_capacity(items.len().min(MAX_JINGLE_NOTES));
            for it in items.iter().take(MAX_JINGLE_NOTES) {
                freqs.push(self.fb_hz(fi, ai, "notes", it)?);
            }
            if freqs.is_empty() {
                return None;
            }
            let step = self.fb_num(fi, ai, "step_ms", &a.step_ms, event, view).unwrap_or(80.0);
            (freqs, if step.is_finite() { step.max(0.0) } else { 80.0 })
        } else {
            let nv = self.fb_eval(fi, ai, "note", &a.note, event, view)?;
            let hz = self.fb_hz(fi, ai, "note", &nv)?;
            let ms = self.fb_num(fi, ai, "ms", &a.ms, event, view).unwrap_or(100.0);
            (vec![hz], if ms.is_finite() { ms.max(0.0) } else { 100.0 })
        };
        let ms = step_ms * freqs.len() as f64;
        Some(Sound { kind: SoundKind::Synth { wave, freqs, step_ms, slide_to_hz }, volume, ms })
    }

    /// Spawns one particle burst. The burst's shape is seeded from the
    /// fired-event sequence number and the feedback position.
    fn burst(&mut self, seq: u64, fi: usize, ai: usize, pa: &ParticlesAction, event: &[Value], view: View) {
        let Some(x) = self.fb_num(fi, ai, "x", &pa.x, event, view) else { return };
        let Some(y) = self.fb_num(fi, ai, "y", &pa.y, event, view) else { return };
        let num = |s: &mut Scene, name: &str, p: &Prop, d: f64| {
            let v = s.fb_num(fi, ai, name, p, event, view).unwrap_or(d);
            if v.is_finite() { v } else { d }
        };
        let count = num(self, "count", &pa.count, 12.0).floor().clamp(0.0, MAX_PARTICLES_PER_BURST as f64) as usize;
        let speed = num(self, "speed", &pa.speed, 200.0);
        let size = num(self, "size", &pa.size, 4.0).max(0.0);
        let ms = num(self, "ms", &pa.ms, 500.0);
        let gravity = num(self, "gravity", &pa.gravity, 0.0);
        let spread = num(self, "spread", &pa.spread, 360.0).clamp(0.0, 360.0);
        if count == 0 || ms <= 0.0 || !x.is_finite() || !y.is_finite() {
            return;
        }
        let color = match self.fb_eval(fi, ai, "color", &pa.color, event, view) {
            Some(v) => match v.as_str().and_then(parse_color) {
                Some(c) => c,
                None => {
                    self.fb_bad(fi, ai, "color", "a color string", &v);
                    BLACK
                }
            },
            None => BLACK,
        };
        let mut rng = BurstRng(mix(seq, ((fi as u64) << 16) | ai as u64));
        let excess = (self.particles.len() + count).saturating_sub(MAX_PARTICLES);
        if excess > 0 {
            // Oldest first.
            self.particles.drain(..excess.min(self.particles.len()));
        }
        for _ in 0..count {
            // Angle from straight up, within ±spread/2; speed 50–100%.
            let a = (rng.next() - 0.5) * spread.to_radians();
            let sp = speed * (0.5 + 0.5 * rng.next());
            self.particles.push(Particle {
                x,
                y,
                vx: a.sin() * sp,
                vy: -a.cos() * sp,
                gravity,
                r: size / 2.0,
                color,
                start: self.clock,
                ms,
            });
        }
        self.particles_dirty = true;
    }

    /// Shake amplitude now: linear decay from `px` to 0 over `ms`.
    pub fn current_shake(&self) -> f64 {
        if self.shake_px <= 0.0 || self.shake_ms <= 0.0 {
            return 0.0;
        }
        let p = (self.clock - self.shake_start) / self.shake_ms;
        if p >= 1.0 {
            0.0
        } else {
            self.shake_px * (1.0 - p.max(0.0))
        }
    }

    /// Moves queued audio / toasts into the frame (replacing the previous
    /// frame's) and sets the shake amplitude.
    pub fn finish_frame(&mut self) {
        self.frame.audio.clear();
        self.frame.toasts.clear();
        self.frame.haptics.clear();
        std::mem::swap(&mut self.frame.audio, &mut self.audio);
        std::mem::swap(&mut self.frame.toasts, &mut self.toasts);
        std::mem::swap(&mut self.frame.haptics, &mut self.haptics);
        self.frame.shake_px = self.current_shake();
    }

    // ── Build ───────────────────────────────────────────────────────────────

    /// Re-evaluates every binding and lays out the scene into `frame.ops`.
    pub fn build(&mut self, view: View, version: u64) {
        let tpl = self.tpl.clone();
        let program = self.program.clone();
        self.gen = self.gen.wrapping_add(1);
        self.builds += 1;
        self.frame.ops.clear();
        self.op_fixed.clear();
        self.hits.clear();
        self.saved.clear();
        self.scope.clear();
        self.scratch.clear();
        self.frame.width = tpl.canvas_w;
        self.frame.height = tpl.canvas_h;

        let mut b = Builder {
            t: &tpl,
            program: &program,
            view,
            s: self,
            live_tweens: 0,
            live_anims: 0,
            next_image_change: f64::INFINITY,
        };
        let bg = match &tpl.background {
            Some(p) => b.get(p, CANVAS_ID, "background").map(|c| c.0).unwrap_or(0xFFFF_FFFF),
            None => 0xFFFF_FFFF,
        };
        let camera = match &tpl.camera {
            None => (0.0, 0.0),
            Some((x, y)) => {
                let cx = b.num(Some(x), CAMERA_ID, "x", 0.0);
                let cy = b.num(Some(y), CAMERA_ID, "y", 0.0);
                (if cx.is_finite() { cx } else { 0.0 }, if cy.is_finite() { cy } else { 0.0 })
            }
        };
        let music = tpl.music.as_ref().and_then(|m| b.music(m));
        b.place_free(0, 1.0, 0, 0.0, 0.0);
        let (live_tweens, live_anims) = (b.live_tweens, b.live_anims);
        self.next_image_change = b.next_image_change;
        self.frame.background = bg;
        self.frame.music = music;
        self.camera = camera;
        self.layers(camera);

        // Garbage-collect motion for instances that were not laid out.
        let gen = self.gen;
        if live_tweens < self.tweens.len() {
            self.tweens.retain(|_, t| t.seen == gen);
        }
        if live_anims < self.anims.len() {
            let now = self.clock;
            self.anims.retain(|_, a| a.seen == gen && now < a.start + a.ms);
        }
        self.pending.clear();

        self.built = true;
        self.built_clock = self.clock;
        self.built_version = version;
        self.built_now = view.now_ms;
        self.built_phase = view.phase;
        self.built_state.clear();
        self.built_state.extend_from_slice(view.state);
    }

    /// Applies the camera to world ops and hit records, and orders the frame
    /// as world ops, then particles, then fixed (HUD) ops.
    fn layers(&mut self, (cx, cy): (f64, f64)) {
        let n_fixed = if self.tpl.any_fixed { self.op_fixed.iter().filter(|f| **f).count() } else { 0 };
        if n_fixed > 0 {
            std::mem::swap(&mut self.frame.ops, &mut self.op_scratch);
            self.frame.ops.clear();
            self.fixed_ops.clear();
            for (mut op, &f) in self.op_scratch.drain(..).zip(&self.op_fixed) {
                if f {
                    self.fixed_ops.push(op);
                } else {
                    shift_op(&mut op, -cx, -cy);
                    self.frame.ops.push(op);
                }
            }
        } else if cx != 0.0 || cy != 0.0 {
            for op in &mut self.frame.ops {
                shift_op(op, -cx, -cy);
            }
        }
        // Particles, in world coordinates.
        self.built_particles = !self.particles.is_empty();
        self.particles_dirty = false;
        let room = MAX_RENDER_OPS.saturating_sub(self.frame.ops.len() + n_fixed);
        let now = self.clock;
        for p in self.particles.iter().take(room) {
            let age = (now - p.start).max(0.0);
            let opacity = 1.0 - age / p.ms;
            if opacity <= 0.0 {
                continue;
            }
            let t = age / 1000.0;
            self.frame.ops.push(DrawOp::Circle(CircleOp {
                x: p.x + p.vx * t - cx,
                y: p.y + p.vy * t + 0.5 * p.gravity * t * t - cy,
                r: p.r,
                fill: Some(p.color),
                stroke: None,
                stroke_width: 0.0,
                scale: 1.0,
                opacity,
            }));
        }
        if n_fixed > 0 {
            self.frame.ops.append(&mut self.fixed_ops);
        }
        if cx != 0.0 || cy != 0.0 {
            for h in self.hits.iter_mut().filter(|h| !h.fixed) {
                h.x -= cx;
                h.y -= cy;
            }
        }
        if n_fixed > 0 || self.hits.iter().any(|h| h.fixed) {
            // Stable: fixed targets are on top, each layer keeps its order.
            self.hits.sort_by_key(|h| h.fixed);
        }
    }

    /// Topmost hit record containing the point (last in paint order wins).
    pub fn hit_at(&self, x: f64, y: f64) -> Option<&HitRec> {
        self.hits.iter().rev().find(|h| x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h)
    }

    /// Evaluates a binding's `with` against saved node locals + pointer.
    pub fn eval_binding(
        &mut self,
        node: u32,
        binding: &InputBinding,
        saved: &[(Slot, Value)],
        px: f64,
        py: f64,
        view: View,
    ) -> Option<Vec<Value>> {
        for (s, v) in saved {
            set_local(&mut self.locals, *s, v.clone());
        }
        set_local(&mut self.locals, self.tpl.pointer_slot, Value::Vec2(px, py));
        let mut out = Vec::with_capacity(binding.with.len());
        for (i, e) in binding.with.iter().enumerate() {
            match eval_expr(&self.program, view, &[], &mut self.locals, e) {
                Ok(v) => out.push(v),
                Err(err) => {
                    let at = self.tpl.nodes[node as usize].at.clone();
                    self.diags.report(
                        name_key(node as u64, &format!("with{}", i)),
                        Code::Runtime,
                        || format!("{at}/with/{i}"),
                        || err.message.clone(),
                    );
                    return None;
                }
            }
        }
        Some(out)
    }
}

struct Builder<'a> {
    t: &'a Template,
    program: &'a Program,
    view: View<'a>,
    s: &'a mut Scene,
    live_tweens: usize,
    live_anims: usize,
    /// Earliest clock time an auto-animated image changes frame.
    next_image_change: f64,
}

impl Builder<'_> {
    #[inline]
    fn node(&self, id: u32) -> &TNode {
        &self.t.nodes[id as usize]
    }

    fn eval(&mut self, e: &Expr, event: &[Value]) -> Result<Value, EvalError> {
        eval_expr(self.program, self.view, event, &mut self.s.locals, e)
    }

    fn report_eval(&mut self, id: u32, name: &str, msg: String) {
        self.report(id, name, Code::Runtime, msg);
    }

    fn report(&mut self, id: u32, name: &str, code: Code, msg: String) {
        let at: Rc<str> = match id {
            CANVAS_ID => Rc::from("/presentation/canvas"),
            CAMERA_ID => Rc::from("/presentation/camera"),
            MUSIC_ID => Rc::from("/presentation/music"),
            _ => self.node(id).at.clone(),
        };
        self.s.diags.report(name_key(id as u64, name), code, || format!("{at}/{name}"), || msg);
    }

    /// Resolves an asset reference to an id of the wanted kind.
    fn asset(&mut self, r: &AssetRef, id: u32, image: bool) -> Option<AssetId> {
        match r {
            AssetRef::Id(a) => Some(*a),
            AssetRef::Bad => None,
            AssetRef::Expr(e) => {
                let v = match self.eval(e, &[]) {
                    Ok(v) => v,
                    Err(err) => {
                        self.report_eval(id, "asset", err.message);
                        return None;
                    }
                };
                let r = match v.as_str() {
                    Some(name) => resolve_asset(self.program, &self.t.asset_ids, name, image),
                    None => Err(format!("`asset` must be an asset id string, got `{v}`")),
                };
                match r {
                    Ok(a) => Some(a),
                    Err(msg) => {
                        self.report(id, "asset", Code::Asset, msg);
                        None
                    }
                }
            }
        }
    }

    fn music(&mut self, m: &crate::template::TMusic) -> Option<MusicState> {
        let asset = self.asset(&m.asset, MUSIC_ID, false)?;
        let volume = self.num(Some(&m.volume), MUSIC_ID, "volume", 0.6);
        let volume = if volume.is_finite() { volume.clamp(0.0, 1.0) } else { 0.6 };
        let playing = match &m.playing {
            None => self.view.phase == Phase::Playing,
            Some(p) => self.get(p, MUSIC_ID, "playing").unwrap_or(false),
        };
        Some(MusicState { asset, volume, playing })
    }

    /// Evaluates a typed prop. `None` (with a diagnostic) on failure.
    fn get<T: FromValue>(&mut self, p: &P<T>, id: u32, name: &str) -> Option<T> {
        match p {
            P::C(v) => Some(v.clone()),
            P::E(e) => match self.eval(e, &[]) {
                Ok(v) => match T::from_value(&v) {
                    Some(t) => Some(t),
                    None => {
                        self.report_eval(id, name, format!("`{name}` must be {}, got `{v}`", T::WHAT));
                        None
                    }
                },
                Err(err) => {
                    self.report_eval(id, name, err.message);
                    None
                }
            },
        }
    }

    #[inline]
    fn num(&mut self, p: Option<&P<f64>>, id: u32, name: &str, default: f64) -> f64 {
        match p {
            None => default,
            Some(P::C(v)) => *v,
            Some(p) => self.get(p, id, name).unwrap_or(default),
        }
    }

    /// Number prop with transitions / animations applied.
    #[inline]
    fn num_m(&mut self, p: Option<&P<f64>>, id: u32, ctx: u64, prop: PropName, name: &str, default: f64) -> f64 {
        let v = self.num(p, id, name, default);
        if self.node(id).has_motion(prop) {
            self.motion(id, ctx, prop, PV::N(v)).num()
        } else {
            v
        }
    }

    fn color_m(&mut self, p: Option<&P<Color>>, id: u32, ctx: u64, prop: PropName, name: &str) -> Option<Rgba> {
        let c = match p {
            None => None,
            Some(P::C(c)) => Some(c.0),
            Some(p) => self.get(p, id, name).map(|c| c.0),
        };
        match c {
            Some(c) if self.node(id).has_motion(prop) => Some(self.motion(id, ctx, prop, PV::C(c)).color()),
            c => c,
        }
    }

    /// Applies the transition (tween towards `base`) and any running keyframe
    /// animation for one prop of one instance.
    fn motion(&mut self, id: u32, ctx: u64, prop: PropName, base: PV) -> PV {
        let t = self.t;
        let n = &t.nodes[id as usize];
        let bit = prop_bit(prop);
        let key = prop_key(id, ctx, prop);
        let now = self.s.clock;
        let gen = self.s.gen;
        let mut v = base;
        if n.trans_mask & bit != 0 {
            self.live_tweens += 1;
            match self.s.tweens.get_mut(&key) {
                Some(tw) => {
                    tw.seen = gen;
                    if tw.to != base {
                        if let Some(tr) = n.transitions.iter().find(|tr| tr.prop == prop) {
                            tw.retarget(base, now, tr.ms, tr.ease);
                            self.s.anim_until = self.s.anim_until.max(tw.end());
                        }
                    }
                    v = tw.value(now);
                }
                None => {
                    self.s.tweens.insert(key, Tween::settled(base, gen));
                }
            }
        }
        if n.anim_mask & bit != 0 {
            if let Some(a) = self.s.anims.get_mut(&key) {
                if now < a.start + a.ms {
                    self.live_anims += 1;
                    a.seen = gen;
                    let ta = &n.animate_on[a.idx as usize];
                    let p = if a.ms > 0.0 { (now - a.start) / a.ms } else { 1.0 };
                    v = sample_keys(&ta.keys, ta.ease, p);
                }
            }
        }
        v
    }

    /// Starts `animate_on` animations of this instance for pending events.
    fn trigger_anims(&mut self, id: u32, ctx: u64) {
        let t = self.t;
        let n = &t.nodes[id as usize];
        let now = self.s.clock;
        for (ai, a) in n.animate_on.iter().enumerate() {
            for pi in 0..self.s.pending.len() {
                let (on, fired_at) = (self.s.pending[pi].0.on, self.s.pending[pi].1);
                if on != a.on || fired_at + a.ms <= now {
                    continue;
                }
                let ok = match &a.when {
                    None => true,
                    Some(w) => {
                        let payload = self.s.pending[pi].0.payload.clone();
                        match self.eval(w, &payload) {
                            Ok(v) => v.as_bool().unwrap_or(false),
                            Err(err) => {
                                self.report_eval(id, &format!("animate_on/{ai}/when"), err.message);
                                false
                            }
                        }
                    }
                };
                if ok {
                    let key = prop_key(id, ctx, a.prop);
                    self.s.anims.insert(key, Anim { idx: ai as u16, start: fired_at, ms: a.ms, seen: self.s.gen });
                    self.s.anim_until = self.s.anim_until.max(fired_at + a.ms);
                }
            }
        }
    }

    fn push_op(&mut self, id: u32, op: DrawOp) {
        if !self.ops_full() {
            self.s.frame.ops.push(op);
            self.s.op_fixed.push(self.t.nodes[id as usize].fixed);
        }
    }

    /// True (and reported once) when the frame already holds `MAX_RENDER_OPS` ops.
    #[inline]
    fn ops_full(&mut self) -> bool {
        if self.s.frame.ops.len() < MAX_RENDER_OPS {
            return false;
        }
        if !self.s.ops_capped {
            self.s.ops_capped = true;
            self.s.diags.report(
                0x0B5_CA9,
                Code::Limit,
                || "/presentation/root".to_string(),
                || format!("more than {MAX_RENDER_OPS} draw ops in one frame; the rest are dropped"),
            );
        }
        true
    }

    /// Translates ops `[op0, op1)` and hit records `[hit0, hit1)`.
    fn shift(&mut self, op0: usize, op1: usize, hit0: usize, hit1: usize, dx: f64, dy: f64) {
        if dx == 0.0 && dy == 0.0 {
            return;
        }
        for op in &mut self.s.frame.ops[op0..op1] {
            shift_op(op, dx, dy);
        }
        for h in &mut self.s.hits[hit0..hit1] {
            h.x += dx;
            h.y += dy;
        }
    }

    /// Lays out a node and places it freely at `(ox, oy) + (x, y)` using its
    /// anchor. Returns its bounds in the parent's coordinates.
    fn place_free(&mut self, id: u32, opacity: f64, ctx: u64, ox: f64, oy: f64) -> Bounds {
        let op0 = self.s.frame.ops.len();
        let hit0 = self.s.hits.len();
        match self.layout(id, opacity, ctx) {
            None => Bounds::EMPTY,
            Some((b, x, y)) => {
                let (dx, dy) = if self.node(id).anchor == Anchor::Center && !b.is_empty() {
                    (ox + x - (b.x0 + b.x1) / 2.0, oy + y - (b.y0 + b.y1) / 2.0)
                } else {
                    (ox + x, oy + y)
                };
                let (op1, hit1) = (self.s.frame.ops.len(), self.s.hits.len());
                self.shift(op0, op1, hit0, hit1, dx, dy);
                b.shift(dx, dy)
            }
        }
    }

    /// Lays out a node at its own origin. Returns `None` when invisible,
    /// otherwise its content bounds and its (motion-applied) `x`, `y`.
    fn layout(&mut self, id: u32, parent_opacity: f64, ctx: u64) -> Option<(Bounds, f64, f64)> {
        let t = self.t;
        let n = &t.nodes[id as usize];
        if let Some(v) = &n.visible {
            if !self.get(v, id, "visible").unwrap_or(true) {
                return None;
            }
        }
        if n.anim_mask != 0 && !self.s.pending.is_empty() {
            self.trigger_anims(id, ctx);
        }
        let own = self.num_m(n.opacity.as_ref(), id, ctx, PropName::Opacity, "opacity", 1.0);
        let opacity = parent_opacity * own.clamp(0.0, 1.0);
        let x = self.num_m(n.x.as_ref(), id, ctx, PropName::X, "x", 0.0);
        let y = self.num_m(n.y.as_ref(), id, ctx, PropName::Y, "y", 0.0);
        let hit0 = self.s.hits.len();

        let b = match &n.kind {
            TKind::Group { children } => {
                let mut b = Bounds::EMPTY;
                for &c in children {
                    b = b.union(self.place_free(c, opacity, ctx, 0.0, 0.0));
                }
                b
            }
            TKind::Stack { dir, gap, align, children } => self.stack(*dir, *gap, *align, children, opacity, ctx),
            TKind::Grid { source, cols, rows, cell_size, gap, cell, cell_slot, value_slot } => {
                self.grid(id, source.as_ref(), cols.as_ref(), rows.as_ref(), *cell_size, *gap, *cell, *cell_slot, *value_slot, opacity, ctx)
            }
            TKind::Repeat { source, item_slot, index_slot, key, node } => {
                self.repeat(id, source, *item_slot, *index_slot, key.as_ref(), *node, opacity, ctx)
            }
            TKind::Rect { w, h, radius } => {
                let w = self.num_m(Some(w), id, ctx, PropName::W, "w", 0.0);
                let h = self.num_m(Some(h), id, ctx, PropName::H, "h", 0.0);
                let radius = self.num_m(radius.as_ref(), id, ctx, PropName::Radius, "radius", 0.0);
                let (fill, stroke, stroke_width) = self.paint(n, id, ctx);
                let rotation = self.num_m(n.rotation.as_ref(), id, ctx, PropName::Rotation, "rotation", 0.0);
                let scale = self.num_m(n.scale.as_ref(), id, ctx, PropName::Scale, "scale", 1.0);
                self.push_op(id, DrawOp::Rect(RectOp {
                    x: 0.0,
                    y: 0.0,
                    w,
                    h,
                    radius,
                    fill,
                    stroke,
                    stroke_width,
                    rotation,
                    scale,
                    opacity,
                }));
                Bounds::new(0.0, 0.0, w.max(0.0), h.max(0.0))
            }
            TKind::Circle { r } => {
                let r = self.num_m(Some(r), id, ctx, PropName::R, "r", 0.0).max(0.0);
                let (fill, stroke, stroke_width) = self.paint(n, id, ctx);
                let scale = self.num_m(n.scale.as_ref(), id, ctx, PropName::Scale, "scale", 1.0);
                self.push_op(id, DrawOp::Circle(CircleOp { x: 0.0, y: 0.0, r, fill, stroke, stroke_width, scale, opacity }));
                Bounds::new(-r, -r, r, r)
            }
            TKind::Text { text, size, font, weight, color, w, h, align, valign, wrap } => {
                let text = self.get(text, id, "text").unwrap_or_else(|| Rc::from(""));
                let size = self.num_m(Some(size), id, ctx, PropName::Size, "size", 16.0).max(0.0);
                let font = match font {
                    None => self.s.font.clone(),
                    Some(P::C(f)) => f.clone(),
                    Some(p) => self.get(p, id, "font").unwrap_or_else(|| self.s.font.clone()),
                };
                let weight = match weight {
                    None => 400,
                    Some(p) => self.get(p, id, "weight").map(|w: Weight| w.0).unwrap_or(400),
                };
                // `color` falls back to `fill`, then black.
                let color = match color {
                    Some(_) => self.color_m(color.as_ref(), id, ctx, PropName::Color, "color"),
                    None => self.color_m(n.fill.as_ref(), id, ctx, PropName::Fill, "fill"),
                };
                let color = match color {
                    Some(c) => c,
                    None if self.node(id).has_motion(PropName::Color) => {
                        self.motion(id, ctx, PropName::Color, PV::C(BLACK)).color()
                    }
                    None => BLACK,
                };
                let bw = w.as_ref().map(|p| self.num_m(Some(p), id, ctx, PropName::W, "w", 0.0));
                let bh = h.as_ref().map(|p| self.num_m(Some(p), id, ctx, PropName::H, "h", 0.0));
                let line_height = size * LINE_HEIGHT_EM;
                let (text, w, h) = match (bw, bh) {
                    // v0.2.1: wrap to the box width; `h` defaults to the wrapped height.
                    (Some(w), bh) if *wrap => {
                        let (wrapped, lines) = wrap_text(&text, w, size, weight);
                        let text = if *wrapped == *text { text } else { Rc::from(wrapped) };
                        (text, w, bh.unwrap_or(lines as f64 * line_height))
                    }
                    (Some(w), Some(h)) => (text, w, h),
                    _ => {
                        let (mw, mh) = measure_text(&text, size, weight);
                        (text, bw.unwrap_or(mw), bh.unwrap_or(mh))
                    }
                };
                // v0.2.1: an outline under the fill (default width 2).
                let stroke = self.color_m(n.stroke.as_ref(), id, ctx, PropName::Stroke, "stroke");
                let stroke_width = match stroke {
                    Some(_) => self.num_m(n.stroke_width.as_ref(), id, ctx, PropName::StrokeWidth, "stroke_width", 2.0).max(0.0),
                    None => 0.0,
                };
                let stroke = stroke.filter(|_| stroke_width > 0.0);
                let rotation = self.num_m(n.rotation.as_ref(), id, ctx, PropName::Rotation, "rotation", 0.0);
                let scale = self.num_m(n.scale.as_ref(), id, ctx, PropName::Scale, "scale", 1.0);
                self.push_op(id, DrawOp::Text(TextOp {
                    x: 0.0,
                    y: 0.0,
                    w,
                    h,
                    text,
                    line_height,
                    size,
                    font,
                    weight,
                    color,
                    stroke,
                    stroke_width,
                    align: *align,
                    valign: *valign,
                    rotation,
                    scale,
                    opacity,
                }));
                Bounds::new(0.0, 0.0, w.max(0.0), h.max(0.0))
            }
            TKind::Image { asset, w, h, frame, flip_x, flip_y } => {
                let Some(asset) = self.asset(asset, id, true) else { return Some((Bounds::EMPTY, x, y)) };
                let AssetKind::Image { w: aw, h: ah, frames, fps, .. } = self.program.assets[asset as usize].kind else {
                    return Some((Bounds::EMPTY, x, y));
                };
                let w = self.num_m(w.as_ref(), id, ctx, PropName::W, "w", aw);
                let h = self.num_m(h.as_ref(), id, ctx, PropName::H, "h", ah);
                let frames = frames.max(1) as i64;
                let frame = match frame {
                    Some(p) => {
                        let f = self.num(Some(p), id, "frame", 0.0);
                        if f.is_finite() { (f.floor() as i64).rem_euclid(frames) } else { 0 }
                    }
                    None if frames > 1 && fps > 0.0 && fps.is_finite() => {
                        let n = (self.s.clock * fps / 1000.0).floor();
                        self.next_image_change = self.next_image_change.min((n + 1.0) * 1000.0 / fps);
                        (n as i64).rem_euclid(frames)
                    }
                    None => 0,
                };
                let flip_x = flip_x.as_ref().and_then(|p| self.get(p, id, "flip_x")).unwrap_or(false);
                let flip_y = flip_y.as_ref().and_then(|p| self.get(p, id, "flip_y")).unwrap_or(false);
                let rotation = self.num_m(n.rotation.as_ref(), id, ctx, PropName::Rotation, "rotation", 0.0);
                let scale = self.num_m(n.scale.as_ref(), id, ctx, PropName::Scale, "scale", 1.0);
                self.push_op(id, DrawOp::Image(ImageOp {
                    x: 0.0,
                    y: 0.0,
                    w,
                    h,
                    asset,
                    frame: frame as u16,
                    flip_x,
                    flip_y,
                    rotation,
                    scale,
                    opacity,
                }));
                Bounds::new(0.0, 0.0, w.max(0.0), h.max(0.0))
            }
            TKind::Line { x1, y1, x2, y2 } => {
                let x1 = self.num(Some(x1), id, "x1", 0.0);
                let y1 = self.num(Some(y1), id, "y1", 0.0);
                let x2 = self.num(Some(x2), id, "x2", 0.0);
                let y2 = self.num(Some(y2), id, "y2", 0.0);
                let stroke = match n.stroke {
                    None if !n.has_motion(PropName::Stroke) => BLACK,
                    None => self.motion(id, ctx, PropName::Stroke, PV::C(BLACK)).color(),
                    Some(_) => self.color_m(n.stroke.as_ref(), id, ctx, PropName::Stroke, "stroke").unwrap_or(BLACK),
                };
                let sw = self.num_m(n.stroke_width.as_ref(), id, ctx, PropName::StrokeWidth, "stroke_width", 2.0);
                self.push_op(id, DrawOp::Line(LineOp { x1, y1, x2, y2, stroke, stroke_width: sw.max(0.0), opacity }));
                Bounds::new(x1.min(x2), y1.min(y2), x1.max(x2), y1.max(y2))
            }
            TKind::Poly { points, closed } => {
                let pts = match points {
                    P::C(p) => p.0.clone(),
                    p => self.get(p, id, "points").map(|p: Points| p.0).unwrap_or_else(|| Rc::from(Vec::new())),
                };
                let pts = if pts.len() > MAX_POLY_POINTS {
                    self.report(
                        id,
                        "points",
                        Code::Limit,
                        format!("{} points; only the first {MAX_POLY_POINTS} are drawn", pts.len()),
                    );
                    &pts[..MAX_POLY_POINTS]
                } else {
                    &pts[..]
                };
                let mut b = Bounds::EMPTY;
                for &(px, py) in pts {
                    b = b.union(Bounds::new(px, py, px, py));
                }
                let (fill, stroke, stroke_width) = self.paint(n, id, ctx);
                self.push_op(id, DrawOp::Poly(PolyOp { points: pts.to_vec(), closed: *closed, fill, stroke, stroke_width, opacity }));
                b
            }
        };

        if n.is_target() && !b.is_empty() {
            let s0 = self.s.saved.len() as u32;
            self.s.saved.extend(self.s.scope.iter().cloned());
            let rec = HitRec {
                x: b.x0,
                y: b.y0,
                w: b.w(),
                h: b.h(),
                node: id,
                saved: (s0, self.s.saved.len() as u32),
                fixed: n.fixed,
            };
            // Before descendants, so a more specific child target wins.
            self.s.hits.insert(hit0, rec);
        }
        Some((b, x, y))
    }

    /// Fill / stroke / stroke width. Fill defaults to black only when neither
    /// fill nor stroke is given.
    fn paint(&mut self, n: &TNode, id: u32, ctx: u64) -> (Option<Rgba>, Option<Rgba>, f64) {
        let fill = if n.fill.is_some() {
            self.color_m(n.fill.as_ref(), id, ctx, PropName::Fill, "fill")
        } else if n.stroke.is_none() {
            let c = if n.has_motion(PropName::Fill) { self.motion(id, ctx, PropName::Fill, PV::C(BLACK)).color() } else { BLACK };
            Some(c)
        } else {
            None
        };
        let stroke = self.color_m(n.stroke.as_ref(), id, ctx, PropName::Stroke, "stroke");
        let default_sw = if stroke.is_some() { 1.0 } else { 0.0 };
        let sw = self.num_m(n.stroke_width.as_ref(), id, ctx, PropName::StrokeWidth, "stroke_width", default_sw);
        (fill, stroke, sw.max(0.0))
    }

    fn stack(&mut self, dir: Dir, gap: f64, align: Align, children: &[u32], opacity: f64, ctx: u64) -> Bounds {
        let base = self.s.scratch.len();
        for &c in children {
            let op0 = self.s.frame.ops.len() as u32;
            let hit0 = self.s.hits.len() as u32;
            if let Some((b, x, y)) = self.layout(c, opacity, ctx) {
                let op1 = self.s.frame.ops.len() as u32;
                let hit1 = self.s.hits.len() as u32;
                self.s.scratch.push(ChildRec { op0, op1, hit0, hit1, b: b.or_zero(), x, y });
            }
        }
        let count = self.s.scratch.len() - base;
        let row = dir == Dir::Row;
        let mut cross: f64 = 0.0;
        let mut main = 0.0;
        for r in &self.s.scratch[base..] {
            let (m, c) = if row { (r.b.w(), r.b.h()) } else { (r.b.h(), r.b.w()) };
            cross = cross.max(c);
            main += m;
        }
        if count > 1 {
            main += gap * (count - 1) as f64;
        }
        let mut cursor = 0.0;
        for i in base..base + count {
            let r = self.s.scratch[i];
            let (m, c) = if row { (r.b.w(), r.b.h()) } else { (r.b.h(), r.b.w()) };
            let off = match align {
                Align::Start => 0.0,
                Align::Center => (cross - c) / 2.0,
                Align::End => cross - c,
            };
            let (sx, sy) = if row { (cursor, off) } else { (off, cursor) };
            let dx = sx - r.b.x0 + r.x;
            let dy = sy - r.b.y0 + r.y;
            self.shift(r.op0 as usize, r.op1 as usize, r.hit0 as usize, r.hit1 as usize, dx, dy);
            cursor += m + gap;
        }
        self.s.scratch.truncate(base);
        if count == 0 {
            return Bounds::EMPTY;
        }
        if row {
            Bounds::new(0.0, 0.0, main, cross)
        } else {
            Bounds::new(0.0, 0.0, cross, main)
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn grid(
        &mut self,
        id: u32,
        source: Option<&Expr>,
        cols: Option<&P<f64>>,
        rows: Option<&P<f64>>,
        cell_size: f64,
        gap: f64,
        cell: u32,
        cell_slot: Slot,
        value_slot: Option<Slot>,
        opacity: f64,
        ctx: u64,
    ) -> Bounds {
        let (gv, w, h) = match source {
            Some(src) => match self.eval(src, &[]) {
                Ok(Value::Grid(g)) => {
                    let (w, h) = (g.w.max(0), g.h.max(0));
                    (Some(g), w, h)
                }
                Ok(v) => {
                    self.report_eval(id, "source", format!("`source` must be a grid, got `{v}`"));
                    return Bounds::EMPTY;
                }
                Err(e) => {
                    self.report_eval(id, "source", e.message);
                    return Bounds::EMPTY;
                }
            },
            None => {
                let c = self.num(cols, id, "cols", 0.0).max(0.0) as i32;
                let r = self.num(rows, id, "rows", 0.0).max(0.0) as i32;
                if c as i64 * r as i64 > MAX_COLLECTION_LEN as i64 {
                    self.report_eval(id, "cols", format!("grid of {c}x{r} cells is over the {MAX_COLLECTION_LEN} limit"));
                    return Bounds::EMPTY;
                }
                (None, c, r)
            }
        };
        let pitch = cell_size + gap;
        'outer: for y in 0..h {
            for x in 0..w {
                if self.ops_full() {
                    break 'outer;
                }
                let cv = Value::IVec2(x, y);
                set_local(&mut self.s.locals, cell_slot, cv.clone());
                let scope0 = self.s.scope.len();
                self.s.scope.push((cell_slot, cv));
                if let (Some(vs), Some(g)) = (value_slot, &gv) {
                    let v = g.cells[(y * g.w + x) as usize].clone();
                    set_local(&mut self.s.locals, vs, v.clone());
                    self.s.scope.push((vs, v));
                }
                let cctx = child_ctx(ctx, id, cell_local(x, y));
                self.place_free(cell, opacity, cctx, x as f64 * pitch, y as f64 * pitch);
                self.s.scope.truncate(scope0);
            }
        }
        let size = |n: i32| if n > 0 { n as f64 * cell_size + (n - 1) as f64 * gap } else { 0.0 };
        Bounds::new(0.0, 0.0, size(w), size(h))
    }

    #[allow(clippy::too_many_arguments)]
    fn repeat(
        &mut self,
        id: u32,
        source: &Expr,
        item_slot: Slot,
        index_slot: Slot,
        key: Option<&Expr>,
        node: u32,
        opacity: f64,
        ctx: u64,
    ) -> Bounds {
        let items: Rc<Vec<Value>> = match self.eval(source, &[]) {
            Ok(Value::List(l)) => l,
            Ok(Value::Set(s)) => Rc::new(s.iter().cloned().collect()),
            Ok(Value::None) => return Bounds::EMPTY,
            Ok(v) => {
                self.report_eval(id, "source", format!("`source` must be a list, got `{v}`"));
                return Bounds::EMPTY;
            }
            Err(e) => {
                self.report_eval(id, "source", e.message);
                return Bounds::EMPTY;
            }
        };
        let mut b = Bounds::EMPTY;
        for (i, item) in items.iter().enumerate() {
            if self.ops_full() {
                break;
            }
            let idx = Value::Int(i as i64);
            set_local(&mut self.s.locals, item_slot, item.clone());
            set_local(&mut self.s.locals, index_slot, idx.clone());
            let scope0 = self.s.scope.len();
            self.s.scope.push((item_slot, item.clone()));
            self.s.scope.push((index_slot, idx));
            let local = match key {
                None => i as u64,
                Some(k) => match self.eval(k, &[]) {
                    Ok(v) => value_hash(&v),
                    Err(e) => {
                        self.report_eval(id, "key", e.message);
                        i as u64
                    }
                },
            };
            let cctx = child_ctx(ctx, id, local);
            b = b.union(self.place_free(node, opacity, cctx, 0.0, 0.0));
            self.s.scope.truncate(scope0);
        }
        b
    }
}
