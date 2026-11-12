//! Resolved, type-checked intermediate representation. `mg-lang` produces it;
//! `mg-runtime` and `mg-scene` execute it.
//!
//! Invariants that a successfully lowered `Program` guarantees (so the runtime
//! can skip checks or treat violations as internal errors):
//! * Every id is in range.
//! * Binary operands have the same kind (int/int, float/float, ivec2/ivec2,
//!   vec2/vec2, string/string) except `vec * scalar`, `scalar * vec` and
//!   `vec / scalar`. Int→float widening is explicit via `Expr::ToFloat`.
//!   `==`/`!=` compare any two values of the same type structurally.
//! * `Expr::Lambda` only appears as a builtin argument at `Builtin::lambda_arg`.
//! * Random builtins only appear in state init and rule effects (not in `when`).
//! * There is no recursion through `Expr::Call`.
//!
//! ## Locals
//! Each *root* (a rule, a function, a state init, the objectives, an input
//! guard, an input source, the presentation) has its own frame of `n_locals`
//! slots. Lowering assigns every `let`, lambda parameter, `for_each` variable
//! and node-local variable a distinct slot in its root's frame (slots are not
//! reused). Function parameters are slots `0..params.len()`. Unassigned slots
//! read as `Value::None`.

use std::rc::Rc;

use crate::ast::{BinOp, UnOp};
use crate::builtins::Builtin;
use crate::scene::Presentation;
use crate::types::Type;
use crate::value::Value;

pub type StateId = u16;
pub type FnId = u16;
pub type InputId = u16;
pub type EventId = u16;
pub type TimerId = u16;
pub type Slot = u16;
pub type RuleId = u16;
pub type FieldIdx = u16;
pub type AssetId = u16;
pub type BodyGroupId = u16;

#[derive(Clone, Debug)]
pub struct Program {
    pub meta: Meta,
    pub state: Vec<StateVar>,
    pub functions: Vec<Function>,
    /// Custom events (spec A8), in declaration order.
    pub events: Vec<EventDef>,
    pub inputs: Vec<InputDef>,
    /// In file order.
    pub rules: Vec<Rule>,
    /// Rule ids per trigger, each list in file order.
    pub dispatch: Dispatch,
    /// Named timers used by `after ... id` and `cancel`. Index = `TimerId`.
    pub timer_names: Vec<Rc<str>>,
    pub objectives: Objectives,
    pub presentation: Presentation,
    /// v0.2: assets, in declaration order. Index = `AssetId`.
    pub assets: Vec<Asset>,
    /// v0.2: optional arcade physics.
    pub physics: Option<Physics>,
    /// v0.2: present iff some input has a `text` source. Tells the shell to
    /// show a text field. From the first text source in file order, with
    /// placement from `presentation.text_field`.
    pub text_input: Option<TextInputSpec>,
}

// ── v0.2: assets ────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct Asset {
    pub name: Rc<str>,
    pub kind: AssetKind,
}

#[derive(Clone, Debug)]
pub enum AssetKind {
    Image {
        src: AssetSrc,
        /// Size of one frame, canvas units.
        w: f64,
        h: f64,
        /// >= 1
        frames: u16,
        /// >= 1, frames per row in the sheet.
        cols: u16,
        /// Default animation speed; 0 = static frame 0.
        fps: f64,
    },
    Sound { src: AssetSrc },
}

#[derive(Clone, Debug, PartialEq)]
pub enum AssetSrc {
    /// Inline SVG markup.
    Svg(Rc<str>),
    /// `https://` URL or `data:` URI.
    Url(Rc<str>),
}

impl AssetSrc {
    pub fn as_str(&self) -> &str {
        match self {
            AssetSrc::Svg(s) | AssetSrc::Url(s) => s,
        }
    }
}

// ── v0.2: text input ────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
pub struct TextInputSpec {
    pub placeholder: Rc<str>,
    pub max_len: u32,
    /// Placement in canvas units; `None` = shell default (bar at the bottom).
    pub rect: Option<(f64, f64, f64, f64)>,
    /// Font size in canvas units; `None` = shell default.
    pub size: Option<f64>,
}

// ── v0.2: physics ───────────────────────────────────────────────────────────

/// See `engine/SPEC-v0.2.md` §5 for the exact step semantics.
#[derive(Clone, Debug)]
pub struct Physics {
    /// px/s².
    pub gravity: (f64, f64),
    /// `(x, y, w, h)`.
    pub bounds: Option<(f64, f64, f64, f64)>,
    /// In declaration order. Index = `BodyGroupId`.
    pub bodies: Vec<BodyGroup>,
    /// In file order.
    pub collisions: Vec<CollisionRule>,
    /// In file order.
    pub on_bounds: Vec<BoundsRule>,
}

#[derive(Clone, Debug)]
pub struct BodyGroup {
    pub name: Rc<str>,
    pub state: StateId,
    /// The state var is `list<Record>` (true) or a single `Record` (false).
    pub is_list: bool,
    /// Field indices into the (name-sorted) record type. All are `float`.
    pub x: FieldIdx,
    pub y: FieldIdx,
    pub vx: Option<FieldIdx>,
    pub vy: Option<FieldIdx>,
    pub shape: BodyShape,
    pub gravity_scale: f64,
    pub is_static: bool,
    pub bounded: bool,
    pub bounce: f64,
    pub max_speed: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BodyShape {
    /// Field holding the radius.
    Circle { r: FieldIdx },
    /// Fields holding the full width and height (box centered at x, y).
    Rect { w: FieldIdx, h: FieldIdx },
}

#[derive(Clone, Debug)]
pub struct CollisionRule {
    pub a: BodyGroupId,
    pub b: BodyGroupId,
    pub solid: bool,
    pub bounce: f64,
    pub emit: Option<PhysicsEmit>,
}

#[derive(Clone, Debug)]
pub struct BoundsRule {
    pub body: BodyGroupId,
    /// Payload fields allowed: `A` (body index), `Nx`, `Ny`.
    pub emit: PhysicsEmit,
}

/// A custom event emitted by physics, with its payload built from contact data.
#[derive(Clone, Debug)]
pub struct PhysicsEmit {
    pub event: EventId,
    /// One entry per declared payload field of the event, in payload order.
    pub fields: Vec<ContactField>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContactField {
    /// `int`: index of the body in group a (0 for a single record).
    A,
    /// `int`: index of the body in group b.
    B,
    /// `float`: contact normal, pointing from b toward a.
    Nx,
    Ny,
}

#[derive(Clone, Debug)]
pub struct Meta {
    pub title: Rc<str>,
    pub instructions: Rc<str>,
    pub duration_s: Option<f64>,
    pub seed: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct StateVar {
    pub name: Rc<str>,
    pub ty: Type,
    pub init: Expr,
    pub n_locals: u16,
}

#[derive(Clone, Debug)]
pub struct Function {
    pub name: Rc<str>,
    pub params: Vec<(Rc<str>, Type)>,
    pub ret: Type,
    pub body: Expr,
    /// Includes the parameters (slots `0..params.len()`).
    pub n_locals: u16,
}

#[derive(Clone, Debug)]
pub struct EventDef {
    pub name: Rc<str>,
    /// Payload fields in declaration order. `Expr::Event(i)` reads field `i`.
    pub payload: Vec<(Rc<str>, Type)>,
}

#[derive(Clone, Debug)]
pub struct InputDef {
    pub name: Rc<str>,
    /// Declared payload fields in declaration order, **followed by `t`**
    /// (`int`, game time in ms when the input is processed), which the
    /// runtime appends. So `payload.len() == declared + 1`.
    pub payload: Vec<(Rc<str>, Type)>,
    /// Input guard: the input is dropped when this is false at processing
    /// time. Evaluated with the payload as `event`.
    pub guard: Option<Expr>,
    pub guard_n_locals: u16,
    /// Keyboard / swipe / pointer / text sources.
    pub sources: Vec<InputSource>,
}

#[derive(Clone, Debug)]
pub struct InputSource {
    pub trigger: SourceTrigger,
    /// One expression per **declared** payload field (excluding `t`), in
    /// payload order. Slot 0 holds the source record (fields name-sorted):
    /// key: `{char: string, code: string}`; swipe: `{dir: ivec2}`;
    /// pointer: `{x: float, y: float}` (world coords); text: `{value: string}`.
    pub with: Vec<Expr>,
    pub n_locals: u16,
}

#[derive(Clone, Debug, PartialEq)]
pub enum SourceTrigger {
    /// `{"key": "ArrowUp"}` / `{"key": "any"}` (→ `code: None`), with
    /// `"on": "up"` → `up: true`. A specific code is matched against the
    /// browser `KeyboardEvent.code` **or** `KeyboardEvent.key` the shell passes.
    Key { code: Option<Rc<str>>, up: bool },
    /// `{"swipe": "any"}` → `None`; `{"swipe": "left"}` → `Some((-1, 0))`.
    Swipe(Option<(i32, i32)>),
    /// v0.2 `{"pointer": "down" | "up" | "move"}`: pointer anywhere that no
    /// `on_tap`/`on_drag`/`on_press`/`on_release` node took. `move` only while the pointer is down.
    Pointer(PointerPhase),
    /// v0.2 `{"text": "submit" | "change"}`.
    Text(TextPhase),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PointerPhase {
    Down,
    Move,
    Up,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TextPhase {
    Submit,
    Change,
}

#[derive(Clone, Debug)]
pub struct Rule {
    pub id: Rc<str>,
    /// JSON Pointer to the rule, e.g. `/rules/2`, for runtime diagnostics.
    pub at: Rc<str>,
    pub trigger: Trigger,
    pub when: Option<Expr>,
    pub body: Vec<Effect>,
    pub n_locals: u16,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Trigger {
    Start,
    /// Every step. `event.dt` (float ms) is payload field 0.
    Tick,
    /// Repeating timer; first fire `period_ms` after start.
    Every { period_ms: i64 },
    Input(InputId),
    Event(EventId),
}

#[derive(Clone, Debug, Default)]
pub struct Dispatch {
    pub start: Vec<RuleId>,
    pub tick: Vec<RuleId>,
    /// `(rule, period_ms)` for every `{"every": ...}` rule, in file order.
    /// Each is its own independent repeating timer.
    pub every: Vec<(RuleId, i64)>,
    /// Indexed by `InputId`.
    pub input: Vec<Vec<RuleId>>,
    /// Indexed by `EventId`.
    pub event: Vec<Vec<RuleId>>,
}

#[derive(Clone, Debug)]
pub struct Objectives {
    pub win: Option<Expr>,
    pub lose: Option<Expr>,
    pub score: Option<Expr>,
    pub time_limit_ms: Option<i64>,
    pub on_timeout: Outcome,
    /// One frame shared by `win`, `lose` and `score`.
    pub n_locals: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Outcome {
    Win,
    Lose,
}

#[derive(Clone, Debug)]
pub enum Effect {
    /// Also the lowering of `incr`/`decr` (value = place ± by), `push`
    /// (value = `concat(place, [x])`) and `remove ... where`
    /// (value = `filter(place, x => not pred)`).
    Set { place: Place, value: Expr },
    Let { slot: Slot, value: Expr },
    If { cond: Expr, then: Vec<Effect>, els: Vec<Effect> },
    /// Iterates a `list<T>` or `set<T>` (ascending). The collection is
    /// evaluated once, before the first iteration.
    ForEach { slot: Slot, collection: Expr, body: Vec<Effect> },
    /// Custom event, appended to the step's queue. One expr per payload field.
    Emit { event: EventId, args: Vec<Expr> },
    /// Schedules a custom event `delay_ms` from now. If `timer` is set and a
    /// timer with that id is already pending, it is replaced.
    After { delay: Expr, event: EventId, args: Vec<Expr>, timer: Option<TimerId> },
    /// Cancels a pending named timer. No-op if none is pending.
    Cancel { timer: TimerId },
    /// Commits the current rule and ends the game.
    End(Outcome),
}

/// An assignable location: a state variable followed by `.field` / `[index]`.
#[derive(Clone, Debug)]
pub struct Place {
    pub state: StateId,
    pub path: Vec<PathStep>,
}

#[derive(Clone, Debug)]
pub enum PathStep {
    Field(FieldIdx),
    /// List (int), grid (ivec2) or map (key; inserting a new key is allowed).
    Index(Expr),
}

#[derive(Clone, Debug)]
pub enum Expr {
    Const(Value),
    Local(Slot),
    State(StateId),
    /// Field of the current event's payload.
    Event(FieldIdx),
    /// `now`: game time in ms, `int`.
    Now,
    /// `status` (presentation only): `'playing' | 'won' | 'lost'`.
    Status,
    /// Record field by index into the name-sorted `RecordType`.
    Field(Box<Expr>, FieldIdx),
    /// `.x` / `.y` on `ivec2` (→ int) or `vec2` (→ float). 0 = x, 1 = y.
    VecComponent(Box<Expr>, u8),
    /// List `[int]`, grid `[ivec2]`, map `[key]`. Out of range / missing → error.
    Index(Box<Expr>, Box<Expr>),
    Unary(UnOp, Box<Expr>),
    /// `And`/`Or` short-circuit.
    Binary(BinOp, Box<Expr>, Box<Expr>),
    /// Int → float widening inserted by the checker.
    ToFloat(Box<Expr>),
    If(Box<Expr>, Box<Expr>, Box<Expr>),
    Let(Slot, Box<Expr>, Box<Expr>),
    /// Call to a user function: args are evaluated in the caller's frame and
    /// become slots `0..n` of a fresh frame of `Function::n_locals`.
    Call(FnId, Box<[Expr]>),
    Builtin(Builtin, Box<[Expr]>),
    /// Only as a builtin argument. `params` are slots in the current frame.
    Lambda { params: Box<[Slot]>, body: Box<Expr> },
    List(Box<[Expr]>),
    /// Fields in name-sorted order.
    Record(Box<[Expr]>),
    /// `{...base, f: v}`: copy of `base` with the given fields replaced.
    RecordUpdate(Box<Expr>, Box<[(FieldIdx, Expr)]>),
}

impl Program {
    pub fn state_index(&self, name: &str) -> Option<StateId> {
        self.state.iter().position(|s| &*s.name == name).map(|i| i as StateId)
    }
    pub fn input_index(&self, name: &str) -> Option<InputId> {
        self.inputs.iter().position(|s| &*s.name == name).map(|i| i as InputId)
    }
    pub fn event_index(&self, name: &str) -> Option<EventId> {
        self.events.iter().position(|s| &*s.name == name).map(|i| i as EventId)
    }

    /// Named JSON view of a state vector (records get field names).
    pub fn state_to_json(&self, state: &[Value]) -> serde_json::Value {
        let mut m = serde_json::Map::new();
        for (var, v) in self.state.iter().zip(state) {
            m.insert(var.name.to_string(), value_to_json_typed(v, &var.ty));
        }
        serde_json::Value::Object(m)
    }
}

/// Like `Value::to_json`, but uses the type to name record fields.
pub fn value_to_json_typed(v: &Value, ty: &Type) -> serde_json::Value {
    use serde_json::Value as J;
    match (v, ty) {
        (Value::Record(fields), Type::Record(rt)) => {
            let mut m = serde_json::Map::new();
            for ((name, fty), fv) in rt.fields.iter().zip(fields.iter()) {
                m.insert(name.to_string(), value_to_json_typed(fv, fty));
            }
            J::Object(m)
        }
        (Value::List(items), Type::List(t)) => J::Array(items.iter().map(|x| value_to_json_typed(x, t)).collect()),
        (Value::Grid(g), Type::Grid(t)) => serde_json::json!({
            "w": g.w, "h": g.h,
            "cells": g.cells.iter().map(|x| value_to_json_typed(x, t)).collect::<Vec<_>>(),
        }),
        (v, Type::Option(t)) if !v.is_none() => value_to_json_typed(v, t),
        _ => v.to_json(),
    }
}
