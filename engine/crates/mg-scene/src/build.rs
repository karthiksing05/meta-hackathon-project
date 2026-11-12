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
//! children; stack its packed size; grid `cols*cell+(cols-1)*gap` square.
//!
//! v0.1 limits: `rotation` and `scale` apply to the op that carries them
//! (around its center) and do not propagate from a group to its children;
//! `fill` / `stroke` on containers are ignored; hit boxes ignore rotation and
//! scale.

use std::collections::HashSet;
use std::rc::Rc;

use mg_core::color::Rgba;
use mg_core::frame::{note_to_hz, CircleOp, DrawOp, Frame, RectOp, Sound, TextOp, Toast, Wave};
use mg_core::ir::{Expr, Program, Slot};
use mg_core::limits::{MAX_COLLECTION_LEN, MAX_RENDER_OPS};
use mg_core::scene::{Align, Anchor, Dir, FeedbackAction, InputBinding, Prop, PropName};
use mg_core::{Code, Diagnostic, Value};
use mg_runtime::eval::{eval_pure, EvalError, Locals, PureEnv};
use mg_runtime::{Fired, Phase};

use crate::motion::{sample_keys, Anim, Tween, PV};
use crate::template::{Color, FromValue, TKind, TNode, Template, Weight, BLACK, DEFAULT_FONT, P};
use crate::text::measure_text;
use crate::util::{cell_local, child_ctx, mix, prop_bit, prop_key, value_hash, Bounds, KeyMap};

/// Most diagnostics kept (first error per prop).
const MAX_DIAGS: usize = 256;
/// Most `animate_on` events waiting for the next build.
const MAX_PENDING_EVENTS: usize = 512;

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
pub struct Scene {
    pub tpl: Rc<Template>,
    pub program: Rc<Program>,
    pub locals: Locals,
    pub frame: Frame,
    pub hits: Vec<HitRec>,
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
        self.audio.clear();
        self.toasts.clear();
        self.shake_px = 0.0;
        self.clock = 0.0;
        self.anim_until = f64::NEG_INFINITY;
        self.built = false;
        self.built_state.clear();
        self.locals.reset(self.tpl.n_locals.max(self.tpl.pointer_slot.saturating_add(1)));
    }

    /// Whether the cached ops are stale.
    pub fn needs_build(&mut self, view: View, version: u64) -> bool {
        if !self.built || !self.pending.is_empty() {
            return true;
        }
        if self.anim_until > self.built_clock && self.clock > self.built_clock {
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
    }

    // ── Fired events: animation queue + feedback ────────────────────────────

    pub fn on_fired(&mut self, fired: &[Fired], view: View) {
        let tpl = self.tpl.clone();
        for f in fired {
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
                for (ai, act) in fb.actions.iter().enumerate() {
                    self.feedback_action(fi, ai, act, &f.payload, view);
                }
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

    fn feedback_action(&mut self, fi: usize, ai: usize, act: &FeedbackAction, event: &[Value], view: View) {
        match act {
            FeedbackAction::Sound { wave, note, ms } => {
                let wave = match self.fb_eval(fi, ai, "wave", wave, event, view) {
                    Some(v) => match v.as_str().and_then(Wave::from_name) {
                        Some(w) => w,
                        None => {
                            self.fb_bad(fi, ai, "wave", "sine | square | triangle | sawtooth", &v);
                            Wave::Sine
                        }
                    },
                    None => Wave::Sine,
                };
                let Some(nv) = self.fb_eval(fi, ai, "note", note, event, view) else { return };
                let hz = match &nv {
                    Value::Str(s) => note_to_hz(s),
                    v => v.as_f64(),
                };
                let Some(hz) = hz.filter(|h| h.is_finite() && *h > 0.0) else {
                    self.fb_bad(fi, ai, "note", "a note name or Hz", &nv);
                    return;
                };
                let ms = self.fb_num(fi, ai, "ms", ms, event, view).unwrap_or(100.0).max(0.0);
                self.audio.push(Sound { wave, freq_hz: hz, ms });
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
        }
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
        std::mem::swap(&mut self.frame.audio, &mut self.audio);
        std::mem::swap(&mut self.frame.toasts, &mut self.toasts);
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
        self.hits.clear();
        self.saved.clear();
        self.scope.clear();
        self.scratch.clear();
        self.frame.width = tpl.canvas_w;
        self.frame.height = tpl.canvas_h;

        let mut b = Builder { t: &tpl, program: &program, view, s: self, live_tweens: 0, live_anims: 0 };
        let bg = match &tpl.background {
            Some(p) => b.get(p, u32::MAX, "background").map(|c| c.0).unwrap_or(0xFFFF_FFFF),
            None => 0xFFFF_FFFF,
        };
        b.place_free(0, 1.0, 0, 0.0, 0.0);
        let (live_tweens, live_anims) = (b.live_tweens, b.live_anims);
        self.frame.background = bg;

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
        let at = if id == u32::MAX { Rc::from("/presentation/canvas") } else { self.node(id).at.clone() };
        self.s.diags.report(name_key(id as u64, name), Code::Runtime, || format!("{at}/{name}"), || msg);
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

    fn push_op(&mut self, op: DrawOp) {
        if !self.ops_full() {
            self.s.frame.ops.push(op);
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
            }
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
                self.push_op(DrawOp::Rect(RectOp {
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
                self.push_op(DrawOp::Circle(CircleOp { x: 0.0, y: 0.0, r, fill, stroke, stroke_width, scale, opacity }));
                Bounds::new(-r, -r, r, r)
            }
            TKind::Text { text, size, font, weight, color, w, h, align, valign } => {
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
                let (w, h) = match (bw, bh) {
                    (Some(w), Some(h)) => (w, h),
                    _ => {
                        let (mw, mh) = measure_text(&text, size, weight);
                        (bw.unwrap_or(mw), bh.unwrap_or(mh))
                    }
                };
                let rotation = self.num_m(n.rotation.as_ref(), id, ctx, PropName::Rotation, "rotation", 0.0);
                let scale = self.num_m(n.scale.as_ref(), id, ctx, PropName::Scale, "scale", 1.0);
                self.push_op(DrawOp::Text(TextOp {
                    x: 0.0,
                    y: 0.0,
                    w,
                    h,
                    text,
                    size,
                    font,
                    weight,
                    color,
                    align: *align,
                    valign: *valign,
                    rotation,
                    scale,
                    opacity,
                }));
                Bounds::new(0.0, 0.0, w.max(0.0), h.max(0.0))
            }
        };

        if (n.on_tap.is_some() || n.on_drag.is_some()) && !b.is_empty() {
            let s0 = self.s.saved.len() as u32;
            self.s.saved.extend(self.s.scope.iter().cloned());
            let rec = HitRec { x: b.x0, y: b.y0, w: b.w(), h: b.h(), node: id, saved: (s0, self.s.saved.len() as u32) };
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
