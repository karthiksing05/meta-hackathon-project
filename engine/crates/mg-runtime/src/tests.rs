//! Unit tests with hand-built IR (no dependency on mg-lang).

use std::rc::Rc;

use mg_core::ast::{BinOp, UnOp};
use mg_core::builtins::Builtin as B;
use mg_core::ir::*;
use mg_core::rng::Rng;
use mg_core::scene::{Canvas, Node, NodeKind, Presentation, Prop};
use mg_core::types::Type;
use mg_core::{Code, Value};

use crate::eval::{eval, eval_pure, Cx, Locals, PureEnv};
use crate::{Fired, Game, Phase};
use mg_core::scene::EventRef;

// ───────────────────────────── builders ─────────────────────────────

fn empty_program() -> Program {
    let root = Node {
        kind: NodeKind::Group { children: vec![] },
        at: Rc::from("/presentation/root"),
        id: None,
        x: None,
        y: None,
        anchor: Default::default(),
        rotation: None,
        scale: None,
        opacity: None,
        visible: None,
        fill: None,
        stroke: None,
        stroke_width: None,
        on_tap: None,
        on_drag: None,
        transitions: vec![],
        animate_on: vec![],
    };
    Program {
        meta: Meta { title: Rc::from("t"), instructions: Rc::from(""), duration_s: None, seed: None },
        state: vec![],
        functions: vec![],
        events: vec![],
        inputs: vec![],
        rules: vec![],
        dispatch: Dispatch::default(),
        timer_names: vec![],
        objectives: Objectives {
            win: None,
            lose: None,
            score: None,
            time_limit_ms: None,
            on_timeout: Outcome::Lose,
            n_locals: 0,
        },
        presentation: Presentation {
            canvas: Canvas { w: 360.0, h: 640.0, background: Prop::Const(Value::str("#000")) },
            root,
            feedback: vec![],
            n_locals: 0,
            pointer_slot: 0,
        },
    }
}

struct P(Program);

impl P {
    fn new() -> P {
        P(empty_program())
    }
    fn state(&mut self, name: &str, ty: Type, init: Expr) -> StateId {
        self.0.state.push(StateVar { name: Rc::from(name), ty, init, n_locals: 4 });
        (self.0.state.len() - 1) as StateId
    }
    fn func(&mut self, name: &str, nparams: usize, body: Expr, n_locals: u16) -> FnId {
        self.0.functions.push(Function {
            name: Rc::from(name),
            params: (0..nparams).map(|i| (Rc::from(format!("p{i}")), Type::Int)).collect(),
            ret: Type::Int,
            body,
            n_locals,
        });
        (self.0.functions.len() - 1) as FnId
    }
    fn event(&mut self, name: &str, nfields: usize) -> EventId {
        self.0.events.push(EventDef {
            name: Rc::from(name),
            payload: (0..nfields).map(|i| (Rc::from(format!("f{i}")), Type::Int)).collect(),
        });
        self.0.dispatch.event.push(vec![]);
        (self.0.events.len() - 1) as EventId
    }
    fn input(&mut self, name: &str, nfields: usize, guard: Option<Expr>) -> InputId {
        let mut payload: Vec<(Rc<str>, Type)> =
            (0..nfields).map(|i| (Rc::from(format!("f{i}")), Type::IVec2)).collect();
        payload.push((Rc::from("t"), Type::Int));
        self.0.inputs.push(InputDef { name: Rc::from(name), payload, guard, guard_n_locals: 4, sources: vec![] });
        self.0.dispatch.input.push(vec![]);
        (self.0.inputs.len() - 1) as InputId
    }
    fn source(&mut self, input: InputId, trigger: SourceTrigger, with: Vec<Expr>) {
        self.0.inputs[input as usize].sources.push(InputSource { trigger, with, n_locals: 2 });
    }
    fn timer(&mut self, name: &str) -> TimerId {
        self.0.timer_names.push(Rc::from(name));
        (self.0.timer_names.len() - 1) as TimerId
    }
    fn rule(&mut self, id: &str, trigger: Trigger, when: Option<Expr>, body: Vec<Effect>) -> RuleId {
        let rid = self.0.rules.len() as RuleId;
        let d = &mut self.0.dispatch;
        match &trigger {
            Trigger::Start => d.start.push(rid),
            Trigger::Tick => d.tick.push(rid),
            Trigger::Every { period_ms } => d.every.push((rid, *period_ms)),
            Trigger::Input(i) => d.input[*i as usize].push(rid),
            Trigger::Event(e) => d.event[*e as usize].push(rid),
        }
        self.0.rules.push(Rule {
            id: Rc::from(id),
            at: Rc::from(format!("/rules/{rid}")),
            trigger,
            when,
            body,
            n_locals: 8,
        });
        rid
    }
    fn game(self, seed: u64) -> Game {
        Game::new(Rc::new(self.0), seed)
    }
}

fn int(i: i64) -> Expr {
    Expr::Const(Value::Int(i))
}
fn flt(f: f64) -> Expr {
    Expr::Const(Value::Float(f))
}
fn s(x: &str) -> Expr {
    Expr::Const(Value::str(x))
}
fn bo(b: bool) -> Expr {
    Expr::Const(Value::Bool(b))
}
fn iv(x: i32, y: i32) -> Expr {
    Expr::Const(Value::IVec2(x, y))
}
fn st(i: StateId) -> Expr {
    Expr::State(i)
}
fn loc(i: Slot) -> Expr {
    Expr::Local(i)
}
fn bin(op: BinOp, a: Expr, b: Expr) -> Expr {
    Expr::Binary(op, Box::new(a), Box::new(b))
}
fn call(b: B, args: Vec<Expr>) -> Expr {
    Expr::Builtin(b, args.into_boxed_slice())
}
fn lam(params: &[Slot], body: Expr) -> Expr {
    Expr::Lambda { params: params.to_vec().into_boxed_slice(), body: Box::new(body) }
}
fn list(items: Vec<Expr>) -> Expr {
    Expr::List(items.into_boxed_slice())
}
fn ints(xs: &[i64]) -> Expr {
    Expr::Const(Value::list(xs.iter().map(|&i| Value::Int(i)).collect()))
}
fn vints(xs: &[i64]) -> Value {
    Value::list(xs.iter().map(|&i| Value::Int(i)).collect())
}
fn set(sid: StateId, value: Expr) -> Effect {
    Effect::Set { place: Place { state: sid, path: vec![] }, value }
}
fn set_path(sid: StateId, path: Vec<PathStep>, value: Expr) -> Effect {
    Effect::Set { place: Place { state: sid, path }, value }
}
fn incr(sid: StateId) -> Effect {
    set(sid, bin(BinOp::Add, st(sid), int(1)))
}
fn push(sid: StateId, v: Expr) -> Effect {
    set(sid, call(B::Concat, vec![st(sid), list(vec![v])]))
}

/// Evaluates a pure expression with no state; 8 local slots.
fn ev(e: Expr) -> Result<Value, String> {
    let p = empty_program();
    let env = PureEnv { program: &p, state: &[], now_ms: 0, phase: Phase::Playing, event: &[] };
    let mut l = Locals::new();
    l.reset(8);
    eval_pure(&env, &mut l, &e).map_err(|e| e.message)
}

fn ok(e: Expr) -> Value {
    match ev(e) {
        Ok(v) => v,
        Err(m) => panic!("unexpected error: {m}"),
    }
}

fn err(e: Expr) -> String {
    match ev(e) {
        Ok(v) => panic!("expected an error, got {v}"),
        Err(m) => m,
    }
}

/// Evaluates with an RNG (effect context).
fn ev_rng(e: &Expr, rng: &mut Rng) -> Result<Value, String> {
    let p = empty_program();
    let env = PureEnv { program: &p, state: &[], now_ms: 0, phase: Phase::Playing, event: &[] };
    let mut stack = vec![Value::None; 8];
    let mut cx = Cx { stack: &mut stack, base: 0, rng: Some(rng), steps_left: 2_000_000 };
    eval(&env, &mut cx, e).map_err(|e| e.msg)
}

fn i(v: i64) -> Value {
    Value::Int(v)
}
fn f(v: f64) -> Value {
    Value::Float(v)
}

// ───────────────────────────── operators ─────────────────────────────

#[test]
fn arithmetic() {
    assert_eq!(ok(bin(BinOp::Div, int(7), int(2))), i(3));
    assert_eq!(ok(bin(BinOp::Div, int(-7), int(2))), i(-3));
    assert_eq!(ok(bin(BinOp::Mod, int(-7), int(3))), i(-1));
    assert!(err(bin(BinOp::Div, int(1), int(0))).contains("division by zero"));
    assert!(err(bin(BinOp::Mod, int(1), int(0))).contains("modulo by zero"));
    assert!(err(bin(BinOp::Div, flt(1.0), flt(0.0))).contains("division by zero"));
    assert_eq!(ok(bin(BinOp::Add, int(i64::MAX), int(1))), i(i64::MIN));
    assert_eq!(ok(bin(BinOp::Mul, int(i64::MAX), int(2))), i(-2));
    assert_eq!(ok(bin(BinOp::Div, int(i64::MIN), int(-1))), i(i64::MIN));
    assert_eq!(ok(Expr::Unary(UnOp::Neg, Box::new(int(i64::MIN)))), i(i64::MIN));
    assert_eq!(ok(bin(BinOp::Add, iv(1, 2), iv(3, 4))), Value::IVec2(4, 6));
    assert_eq!(ok(bin(BinOp::Mul, iv(1, 2), int(3))), Value::IVec2(3, 6));
    assert_eq!(ok(bin(BinOp::Mul, int(3), iv(1, 2))), Value::IVec2(3, 6));
    assert_eq!(ok(bin(BinOp::Mul, flt(0.5), iv(2, 4))), Value::Vec2(1.0, 2.0));
    assert_eq!(ok(bin(BinOp::Div, iv(7, -7), int(2))), Value::IVec2(3, -3));
    assert_eq!(ok(bin(BinOp::Add, s("ab"), s("cd"))), Value::str("abcd"));
    assert_eq!(ok(bin(BinOp::Add, int(1), flt(0.5))), f(1.5));
    assert_eq!(ok(bin(BinOp::Lt, flt(f64::NAN), flt(1.0))), Value::Bool(false));
    assert_eq!(ok(bin(BinOp::Eq, ints(&[1, 2]), ints(&[1, 2]))), Value::Bool(true));
    assert_eq!(ok(bin(BinOp::Lt, s("a"), s("b"))), Value::Bool(true));
    assert_eq!(ok(Expr::ToFloat(Box::new(int(3)))), f(3.0));
    assert_eq!(ok(Expr::VecComponent(Box::new(iv(3, 4)), 1)), i(4));
}

#[test]
fn short_circuit() {
    // false and <error> → false; true or <error> → true.
    let boom = bin(BinOp::Div, int(1), int(0));
    let boom_b = bin(BinOp::Eq, boom.clone(), int(1));
    assert_eq!(ok(bin(BinOp::And, bo(false), boom_b.clone())), Value::Bool(false));
    assert_eq!(ok(bin(BinOp::Or, bo(true), boom_b.clone())), Value::Bool(true));
    assert!(ev(bin(BinOp::And, bo(true), boom_b)).is_err());
}

#[test]
fn index_errors_and_records() {
    assert!(err(Expr::Index(Box::new(ints(&[1, 2])), Box::new(int(2)))).contains("out of range"));
    assert!(err(Expr::Index(Box::new(ints(&[1, 2])), Box::new(int(-1)))).contains("out of range"));
    let m = call(B::MapOf, vec![list(vec![list(vec![s("a"), int(1)])])]);
    assert_eq!(ok(Expr::Index(Box::new(m.clone()), Box::new(s("a")))), i(1));
    assert!(err(Expr::Index(Box::new(m), Box::new(s("b")))).contains("not in the map"));
    let g = call(B::Grid, vec![int(2), int(2), int(0)]);
    assert!(err(Expr::Index(Box::new(g), Box::new(iv(2, 0)))).contains("outside"));
    let rec = Expr::Record(vec![int(1), int(2)].into_boxed_slice());
    let upd = Expr::RecordUpdate(Box::new(rec), vec![(1, int(9))].into_boxed_slice());
    assert_eq!(ok(Expr::Field(Box::new(upd.clone()), 1)), i(9));
    assert_eq!(ok(Expr::Field(Box::new(upd), 0)), i(1));
    // let + lambda slots
    assert_eq!(ok(Expr::Let(0, Box::new(int(5)), Box::new(bin(BinOp::Mul, loc(0), loc(0))))), i(25));
}

#[test]
fn user_functions_get_their_own_frame() {
    let mut p = P::new();
    // sq(x) = let y = x * x in y ; f(a, b) = sq(a) + sq(b) with a local
    let sq = p.func("sq", 1, Expr::Let(1, Box::new(bin(BinOp::Mul, loc(0), loc(0))), Box::new(loc(1))), 2);
    let body = bin(
        BinOp::Add,
        Expr::Call(sq, vec![loc(0)].into_boxed_slice()),
        Expr::Call(sq, vec![loc(1)].into_boxed_slice()),
    );
    let ff = p.func("f", 2, body, 2);
    let boom = p.func("boom", 1, Expr::Index(Box::new(ints(&[1])), Box::new(loc(0))), 1);
    let prog = p.0;
    let env = PureEnv { program: &prog, state: &[], now_ms: 0, phase: Phase::Playing, event: &[] };
    let mut l = Locals::new();
    l.reset(3);
    l.set(0, i(100)); // caller's slot 0 must survive the call
    let e = Expr::Call(ff, vec![int(3), int(4)].into_boxed_slice());
    assert_eq!(eval_pure(&env, &mut l, &e).unwrap(), i(25));
    assert_eq!(l.stack.len(), 3);
    assert_eq!(l.stack[0], i(100));
    let e = Expr::Call(boom, vec![int(5)].into_boxed_slice());
    let m = eval_pure(&env, &mut l, &e).unwrap_err().message;
    assert!(m.contains("in function 'boom'") && m.contains("out of range"), "{m}");
    assert_eq!(l.stack.len(), 3);
}

// ───────────────────────────── builtins ─────────────────────────────

#[test]
fn math_builtins() {
    assert_eq!(ok(call(B::Abs, vec![int(-3)])), i(3));
    assert_eq!(ok(call(B::Abs, vec![flt(-1.5)])), f(1.5));
    assert_eq!(ok(call(B::Min, vec![int(3), int(1), int(2)])), i(1));
    assert_eq!(ok(call(B::Max, vec![int(3), flt(4.5)])), f(4.5));
    assert_eq!(ok(call(B::Max, vec![int(3), flt(1.5)])), f(3.0));
    assert_eq!(ok(call(B::Clamp, vec![int(15), int(0), int(10)])), i(10));
    assert_eq!(ok(call(B::Clamp, vec![int(-5), int(0), int(10)])), i(0));
    assert_eq!(ok(call(B::Floor, vec![flt(-1.5)])), i(-2));
    assert_eq!(ok(call(B::Floor, vec![int(7)])), i(7));
    assert_eq!(ok(call(B::Ceil, vec![flt(1.2)])), i(2));
    assert_eq!(ok(call(B::Round, vec![flt(2.5)])), i(3));
    assert_eq!(ok(call(B::Round, vec![flt(-2.5)])), i(-3));
    assert_eq!(ok(call(B::Round, vec![flt(2.4999)])), i(2));
    assert!(err(call(B::Floor, vec![flt(f64::NAN)])).contains("cannot convert"));
    assert!(err(call(B::Round, vec![flt(f64::INFINITY)])).contains("cannot convert"));
    assert_eq!(ok(call(B::Sqrt, vec![int(9)])), f(3.0));
    assert!(matches!(ok(call(B::Sqrt, vec![flt(-1.0)])), Value::Float(x) if x.is_nan()));
    assert_eq!(ok(call(B::Log2, vec![int(0)])), f(f64::NEG_INFINITY));
    assert_eq!(ok(call(B::Log2, vec![int(1024)])), f(10.0));
    assert_eq!(ok(call(B::Sin, vec![flt(0.0)])), f(0.0));
    assert_eq!(ok(call(B::Cos, vec![flt(0.0)])), f(1.0));
    assert_eq!(ok(call(B::Lerp, vec![flt(0.0), flt(10.0), flt(0.25)])), f(2.5));
    assert_eq!(
        ok(call(B::Lerp, vec![Expr::Const(Value::Vec2(0.0, 0.0)), Expr::Const(Value::Vec2(2.0, 4.0)), flt(0.5)])),
        Value::Vec2(1.0, 2.0)
    );
    let h1 = ok(call(B::Hash, vec![iv(3, 4)]));
    let h2 = ok(call(B::Hash, vec![iv(3, 4)]));
    let h3 = ok(call(B::Hash, vec![iv(4, 3)]));
    assert_eq!(h1, h2);
    assert_ne!(h1, h3);
    let Value::Float(h) = h1 else { panic!() };
    assert!((0.0..1.0).contains(&h));
}

#[test]
fn list_builtins() {
    assert_eq!(ok(call(B::Len, vec![s("héllo")])), i(5));
    assert_eq!(ok(call(B::Len, vec![ints(&[1, 2, 3])])), i(3));
    assert_eq!(ok(call(B::First, vec![ints(&[4, 5])])), i(4));
    assert_eq!(ok(call(B::Last, vec![ints(&[4, 5])])), i(5));
    assert!(err(call(B::First, vec![ints(&[])])).contains("empty"));
    assert!(err(call(B::Last, vec![ints(&[])])).contains("empty"));
    assert_eq!(ok(call(B::GetOr, vec![ints(&[1]), int(5), int(-1)])), i(-1));
    assert_eq!(ok(call(B::GetOr, vec![ints(&[1]), int(0), int(-1)])), i(1));
    assert_eq!(ok(call(B::GetOr, vec![ints(&[1]), int(-1), int(-1)])), i(-1));
    let g = call(B::Grid, vec![int(2), int(2), int(7)]);
    assert_eq!(ok(call(B::GetOr, vec![g.clone(), iv(1, 1), int(0)])), i(7));
    assert_eq!(ok(call(B::GetOr, vec![g, iv(2, 1), int(0)])), i(0));
    let l = ints(&[0, 1, 2, 3, 4]);
    assert_eq!(ok(call(B::Slice, vec![l.clone(), int(1), int(3)])), vints(&[1, 2]));
    assert_eq!(ok(call(B::Slice, vec![l.clone(), int(-5), int(99)])), vints(&[0, 1, 2, 3, 4]));
    assert_eq!(ok(call(B::Slice, vec![l.clone(), int(3), int(1)])), vints(&[]));
    assert_eq!(ok(call(B::Take, vec![l.clone(), int(2)])), vints(&[0, 1]));
    assert_eq!(ok(call(B::Take, vec![l.clone(), int(-2)])), vints(&[]));
    assert_eq!(ok(call(B::Take, vec![l.clone(), int(99)])), vints(&[0, 1, 2, 3, 4]));
    assert_eq!(ok(call(B::Drop, vec![l.clone(), int(3)])), vints(&[3, 4]));
    assert_eq!(ok(call(B::Drop, vec![l.clone(), int(99)])), vints(&[]));
    assert_eq!(ok(call(B::Concat, vec![ints(&[1]), ints(&[]), ints(&[2, 3])])), vints(&[1, 2, 3]));
    assert_eq!(ok(call(B::Concat, vec![s("a"), s("b"), s("c")])), Value::str("abc"));
    assert_eq!(ok(call(B::Push, vec![ints(&[1]), int(2)])), vints(&[1, 2]));
    assert_eq!(ok(call(B::SetAt, vec![ints(&[1, 2]), int(1), int(9)])), vints(&[1, 9]));
    assert!(err(call(B::SetAt, vec![ints(&[1, 2]), int(2), int(9)])).contains("out of range"));
    assert_eq!(ok(call(B::InsertAt, vec![ints(&[1, 2]), int(2), int(9)])), vints(&[1, 2, 9]));
    assert_eq!(ok(call(B::InsertAt, vec![ints(&[1, 2]), int(0), int(9)])), vints(&[9, 1, 2]));
    assert!(err(call(B::InsertAt, vec![ints(&[1, 2]), int(3), int(9)])).contains("out of range"));
    assert_eq!(ok(call(B::RemoveAt, vec![ints(&[1, 2, 3]), int(1)])), vints(&[1, 3]));
    assert!(err(call(B::RemoveAt, vec![ints(&[1]), int(1)])).contains("out of range"));
    assert_eq!(ok(call(B::Reverse, vec![ints(&[1, 2, 3])])), vints(&[3, 2, 1]));
    assert_eq!(ok(call(B::Reverse, vec![s("abc")])), Value::str("cba"));
    assert_eq!(ok(call(B::Repeat, vec![int(0), int(3)])), vints(&[0, 0, 0]));
    assert_eq!(ok(call(B::Repeat, vec![int(0), int(-3)])), vints(&[]));
    assert_eq!(ok(call(B::Range, vec![int(4)])), vints(&[0, 1, 2, 3]));
    assert_eq!(ok(call(B::Range, vec![int(2), int(5)])), vints(&[2, 3, 4]));
    assert_eq!(ok(call(B::Range, vec![int(5), int(2)])), vints(&[]));
    assert_eq!(ok(call(B::Range, vec![int(-3)])), vints(&[]));
    assert_eq!(ok(call(B::IndexOf, vec![ints(&[5, 6, 6]), int(6)])), i(1));
    assert_eq!(ok(call(B::IndexOf, vec![ints(&[5, 6]), int(7)])), i(-1));
    assert_eq!(ok(call(B::Contains, vec![ints(&[5, 6]), int(6)])), Value::Bool(true));
    assert_eq!(ok(call(B::Contains, vec![s("hello"), s("ell")])), Value::Bool(true));
    assert_eq!(ok(call(B::Contains, vec![s("hello"), s("xyz")])), Value::Bool(false));
    let set = call(B::SetOf, vec![ints(&[3, 1])]);
    assert_eq!(ok(call(B::Contains, vec![set, int(3)])), Value::Bool(true));
}

#[test]
fn higher_order_builtins() {
    // map with and without index; slots 0 and 1 are lambda params.
    let l = ints(&[10, 20, 30]);
    assert_eq!(ok(call(B::Map, vec![l.clone(), lam(&[0], bin(BinOp::Add, loc(0), int(1)))])), vints(&[11, 21, 31]));
    assert_eq!(ok(call(B::Map, vec![l.clone(), lam(&[0, 1], loc(1))])), vints(&[0, 1, 2]));
    // map over a fresh (uniquely owned) list takes the in-place path
    assert_eq!(ok(call(B::Map, vec![call(B::Range, vec![int(3)]), lam(&[0], bin(BinOp::Mul, loc(0), int(2)))])), vints(&[0, 2, 4]));
    assert_eq!(ok(call(B::Filter, vec![l.clone(), lam(&[0], bin(BinOp::Gt, loc(0), int(15)))])), vints(&[20, 30]));
    assert_eq!(ok(call(B::Filter, vec![l.clone(), lam(&[0, 1], bin(BinOp::Ne, loc(1), int(1)))])), vints(&[10, 30]));
    assert_eq!(ok(call(B::Fold, vec![l.clone(), int(0), lam(&[0, 1], bin(BinOp::Add, loc(0), loc(1)))])), i(60));
    // fold is left to right: acc * 10 + x
    let digits = call(B::Fold, vec![ints(&[1, 2, 3]), int(0), lam(&[0, 1], bin(BinOp::Add, bin(BinOp::Mul, loc(0), int(10)), loc(1)))]);
    assert_eq!(ok(digits), i(123));
    let gt = |n| lam(&[0], bin(BinOp::Gt, loc(0), int(n)));
    assert_eq!(ok(call(B::Any, vec![l.clone(), gt(25)])), Value::Bool(true));
    assert_eq!(ok(call(B::Any, vec![ints(&[]), gt(25)])), Value::Bool(false));
    assert_eq!(ok(call(B::All, vec![l.clone(), gt(5)])), Value::Bool(true));
    assert_eq!(ok(call(B::All, vec![l.clone(), gt(15)])), Value::Bool(false));
    assert_eq!(ok(call(B::All, vec![ints(&[]), gt(25)])), Value::Bool(true));
    // any short-circuits: the error after the match is never reached.
    let crash = lam(&[0], bin(BinOp::Eq, bin(BinOp::Div, int(10), loc(0)), int(1)));
    assert_eq!(ok(call(B::Any, vec![ints(&[10, 0]), crash])), Value::Bool(true));
    assert_eq!(ok(call(B::Count, vec![l.clone(), gt(15)])), i(2));
    assert_eq!(ok(call(B::Find, vec![l.clone(), gt(15)])), i(20));
    assert_eq!(ok(call(B::Find, vec![l.clone(), gt(99)])), Value::None);
    // sort_by is stable: sort pairs by first element only.
    let pairs = list(vec![ints(&[2, 0]), ints(&[1, 1]), ints(&[2, 2]), ints(&[1, 3])]);
    let sorted = ok(call(B::SortBy, vec![pairs, lam(&[0], Expr::Index(Box::new(loc(0)), Box::new(int(0))))]));
    assert_eq!(sorted, Value::list(vec![vints(&[1, 1]), vints(&[1, 3]), vints(&[2, 0]), vints(&[2, 2])]));
    assert_eq!(ok(call(B::Sum, vec![ints(&[])])), i(0));
    assert_eq!(ok(call(B::Sum, vec![ints(&[1, 2, 3])])), i(6));
    assert_eq!(ok(call(B::Sum, vec![list(vec![flt(0.5), flt(0.25)])])), f(0.75));
    let z = ok(call(B::Zip, vec![ints(&[1, 2, 3]), list(vec![s("a"), s("b")])]));
    assert_eq!(
        z,
        Value::list(vec![Value::record(vec![i(1), Value::str("a")]), Value::record(vec![i(2), Value::str("b")])])
    );
}

#[test]
fn set_and_map_builtins() {
    let set = call(B::SetOf, vec![ints(&[3, 1, 3, 2])]);
    assert_eq!(ok(call(B::Len, vec![set.clone()])), i(3));
    assert_eq!(ok(call(B::Str, vec![set.clone()])), Value::str("{1, 2, 3}"));
    assert_eq!(ok(call(B::Has, vec![call(B::Add, vec![set.clone(), int(9)]), int(9)])), Value::Bool(true));
    assert_eq!(ok(call(B::Has, vec![call(B::Remove, vec![set.clone(), int(1)]), int(1)])), Value::Bool(false));
    assert_eq!(ok(call(B::Len, vec![call(B::Remove, vec![set, int(99)])])), i(3));
    let m = call(B::MapOf, vec![list(vec![
        list(vec![s("b"), int(1)]),
        list(vec![s("a"), int(2)]),
        list(vec![s("b"), int(3)]),
    ])]);
    assert_eq!(ok(Expr::Index(Box::new(m.clone()), Box::new(s("b")))), i(3)); // later pairs win
    assert_eq!(ok(call(B::Keys, vec![m.clone()])), Value::list(vec![Value::str("a"), Value::str("b")]));
    assert_eq!(ok(call(B::Values, vec![m.clone()])), vints(&[2, 3]));
    let m2 = call(B::Put, vec![m.clone(), s("c"), int(7)]);
    assert_eq!(ok(call(B::Has, vec![m2.clone(), s("c")])), Value::Bool(true));
    assert_eq!(ok(call(B::Len, vec![call(B::Remove, vec![m2, s("a")])])), i(2));
    let g = call(B::GridMap, vec![call(B::Grid, vec![int(2), int(2), int(0)]), lam(&[0, 1], Expr::VecComponent(Box::new(loc(1)), 0))]);
    assert_eq!(ok(call(B::Values, vec![g])), vints(&[0, 1, 0, 1]));
}

#[test]
fn grid_builtins() {
    assert!(err(call(B::Grid, vec![int(-1), int(2), int(0)])).contains("negative"));
    assert!(err(call(B::Grid, vec![int(101), int(100), int(0)])).contains("more than"));
    assert!(ev(call(B::Grid, vec![int(100), int(100), int(0)])).is_ok());
    let g = call(B::Grid, vec![int(3), int(2), bo(false)]);
    assert_eq!(ok(call(B::Width, vec![g.clone()])), i(3));
    assert_eq!(ok(call(B::Height, vec![g.clone()])), i(2));
    let cells = ok(call(B::Cells, vec![g.clone()]));
    assert_eq!(
        cells,
        Value::list(vec![
            Value::IVec2(0, 0),
            Value::IVec2(1, 0),
            Value::IVec2(2, 0),
            Value::IVec2(0, 1),
            Value::IVec2(1, 1),
            Value::IVec2(2, 1)
        ])
    );
    assert_eq!(ok(call(B::Coords, vec![int(3), int(2)])), cells);
    assert_eq!(ok(call(B::InGrid, vec![g.clone(), iv(2, 1)])), Value::Bool(true));
    assert_eq!(ok(call(B::InGrid, vec![g.clone(), iv(3, 1)])), Value::Bool(false));
    assert_eq!(ok(call(B::InGrid, vec![g.clone(), iv(-1, 0)])), Value::Bool(false));
    // grid_map with only the value
    let gm = call(B::GridMap, vec![g.clone(), lam(&[0], Expr::Unary(UnOp::Not, Box::new(loc(0))))]);
    assert_eq!(ok(call(B::Values, vec![gm])), Value::list(vec![Value::Bool(true); 6]));
    let ivs = |v: &[(i32, i32)]| Value::list(v.iter().map(|&(x, y)| Value::IVec2(x, y)).collect());
    assert_eq!(ok(call(B::Neighbors4, vec![iv(0, 0)])), ivs(&[(0, -1), (1, 0), (0, 1), (-1, 0)]));
    assert_eq!(
        ok(call(B::Neighbors8, vec![iv(5, 5)])),
        ivs(&[(5, 4), (6, 4), (6, 5), (6, 6), (5, 6), (4, 6), (4, 5), (4, 4)])
    );
    // lines on a 3x2 grid
    let lines = |d| ok(call(B::Lines, vec![g.clone(), d]));
    assert_eq!(
        lines(iv(-1, 0)),
        Value::list(vec![ivs(&[(0, 0), (1, 0), (2, 0)]), ivs(&[(0, 1), (1, 1), (2, 1)])])
    );
    assert_eq!(
        lines(iv(1, 0)),
        Value::list(vec![ivs(&[(2, 0), (1, 0), (0, 0)]), ivs(&[(2, 1), (1, 1), (0, 1)])])
    );
    assert_eq!(
        lines(iv(0, -1)),
        Value::list(vec![ivs(&[(0, 0), (0, 1)]), ivs(&[(1, 0), (1, 1)]), ivs(&[(2, 0), (2, 1)])])
    );
    assert_eq!(
        lines(iv(0, 1)),
        Value::list(vec![ivs(&[(0, 1), (0, 0)]), ivs(&[(1, 1), (1, 0)]), ivs(&[(2, 1), (2, 0)])])
    );
    assert!(err(call(B::Lines, vec![g.clone(), iv(1, 1)])).contains("direction"));
    let gi = call(B::Grid, vec![int(2), int(2), int(0)]);
    let w = call(B::WriteLine, vec![gi.clone(), Expr::Const(ivs(&[(1, 0), (0, 1)])), ints(&[5, 6])]);
    assert_eq!(ok(call(B::Values, vec![w])), vints(&[0, 5, 6, 0]));
    assert!(err(call(B::WriteLine, vec![gi.clone(), Expr::Const(ivs(&[(1, 0)])), ints(&[5, 6])])).contains("1 coords but 2"));
    assert!(err(call(B::WriteLine, vec![gi, Expr::Const(ivs(&[(2, 0)])), ints(&[5])])).contains("outside"));
}

#[test]
fn space_builtins() {
    assert_eq!(ok(call(B::Vec, vec![int(3), int(7)])), Value::IVec2(3, 7));
    assert_eq!(ok(call(B::Vec, vec![int(3), flt(0.5)])), Value::Vec2(3.0, 0.5));
    assert!(err(call(B::Vec, vec![int(1 << 40), int(0)])).contains("range"));
    assert_eq!(ok(call(B::Length, vec![iv(3, 4)])), f(5.0));
    assert_eq!(ok(call(B::Dist, vec![iv(0, 0), iv(3, 4)])), f(5.0));
    assert_eq!(ok(call(B::Normalize, vec![iv(0, 0)])), Value::Vec2(0.0, 0.0));
    assert_eq!(ok(call(B::Normalize, vec![iv(0, 5)])), Value::Vec2(0.0, 1.0));
    assert_eq!(ok(call(B::InBounds, vec![iv(14, 0), int(15), int(15)])), Value::Bool(true));
    assert_eq!(ok(call(B::InBounds, vec![iv(15, 0), int(15), int(15)])), Value::Bool(false));
    assert_eq!(ok(call(B::InBounds, vec![iv(0, -1), int(15), int(15)])), Value::Bool(false));
    assert_eq!(ok(call(B::InBounds, vec![Expr::Const(Value::Vec2(14.5, 0.0)), int(15), flt(1.0)])), Value::Bool(true));
    assert_eq!(ok(call(B::Coords, vec![int(0), int(5)])), vints(&[]));
    let v2 = |x, y| Expr::Const(Value::Vec2(x, y));
    assert_eq!(ok(call(B::OverlapsCircle, vec![v2(0.0, 0.0), flt(1.0), v2(1.5, 0.0), flt(1.0)])), Value::Bool(true));
    assert_eq!(ok(call(B::OverlapsCircle, vec![v2(0.0, 0.0), flt(1.0), v2(2.0, 0.0), flt(1.0)])), Value::Bool(false));
    let r = |a, b, c, d| ok(call(B::OverlapsRect, vec![v2(a, b), v2(10.0, 10.0), v2(c, d), v2(10.0, 10.0)]));
    assert_eq!(r(0.0, 0.0, 5.0, 5.0), Value::Bool(true));
    assert_eq!(r(0.0, 0.0, 10.0, 0.0), Value::Bool(false)); // touching edges
    assert_eq!(r(0.0, 0.0, 20.0, 0.0), Value::Bool(false));
    assert_eq!(ok(call(B::OverlapsRect, vec![v2(0.0, 0.0), v2(0.0, 5.0), v2(-1.0, -1.0), v2(10.0, 10.0)])), Value::Bool(false));
}

#[test]
fn text_and_option_builtins() {
    assert_eq!(ok(call(B::Chars, vec![s("hé")])), Value::list(vec![Value::str("h"), Value::str("é")]));
    assert_eq!(ok(call(B::Upper, vec![s("abC")])), Value::str("ABC"));
    assert_eq!(ok(call(B::Lower, vec![s("AbC")])), Value::str("abc"));
    assert_eq!(ok(call(B::Join, vec![list(vec![s("a"), s("b")]), s("-")])), Value::str("a-b"));
    assert_eq!(ok(call(B::Str, vec![flt(2.0)])), Value::str("2"));
    assert_eq!(ok(call(B::Str, vec![flt(1.5)])), Value::str("1.5"));
    assert_eq!(ok(call(B::Str, vec![iv(3, 7)])), Value::str("(3, 7)"));
    assert_eq!(ok(call(B::Str, vec![ints(&[1, 2])])), Value::str("[1, 2]"));
    assert_eq!(ok(call(B::Str, vec![Expr::Const(Value::None)])), Value::str("none"));
    assert_eq!(ok(call(B::Str, vec![s("hi")])), Value::str("hi"));
    for (w, want) in [("cat", true), ("CAT", true), ("Tree", true), ("xqzv", false), ("a", false), ("cat!", false), ("", false)] {
        assert_eq!(ok(call(B::InDictionary, vec![s(w)])), Value::Bool(want), "{w}");
    }
    let words = crate::words::WORDS;
    assert!(words.len() > 2500);
    assert!(words.windows(2).all(|w| w[0] < w[1]), "word list must be sorted and unique");
    assert!(words.iter().all(|w| (2..=8).contains(&w.len()) && w.bytes().all(|c| c.is_ascii_lowercase())));
    assert_eq!(ok(call(B::IsNone, vec![Expr::Const(Value::None)])), Value::Bool(true));
    assert_eq!(ok(call(B::IsNone, vec![int(0)])), Value::Bool(false));
    assert_eq!(ok(call(B::OrElse, vec![Expr::Const(Value::None), int(5)])), i(5));
    // or_else is lazy in its default
    assert_eq!(ok(call(B::OrElse, vec![int(1), bin(BinOp::Div, int(1), int(0))])), i(1));
}

#[test]
fn random_builtins() {
    // Forbidden in pure evaluation.
    for e in [
        call(B::RandomInt, vec![int(0), int(3)]),
        call(B::RandomFloat, vec![int(0), int(3)]),
        call(B::Pick, vec![ints(&[1])]),
        call(B::Shuffle, vec![ints(&[1, 2])]),
        call(B::Weighted, vec![ints(&[1]), ints(&[1])]),
    ] {
        assert!(err(e).contains("randomness"));
    }
    let mut rng = Rng::new(7);
    let mut seen = [false; 4];
    for _ in 0..400 {
        let Value::Int(v) = ev_rng(&call(B::RandomInt, vec![int(0), int(3)]), &mut rng).unwrap() else { panic!() };
        seen[v as usize] = true;
        let Value::Float(x) = ev_rng(&call(B::RandomFloat, vec![flt(2.0), flt(3.0)]), &mut rng).unwrap() else { panic!() };
        assert!((2.0..3.0).contains(&x));
    }
    assert_eq!(seen, [true; 4], "random_int is inclusive of both ends");
    assert!(ev_rng(&call(B::Pick, vec![ints(&[])]), &mut rng).unwrap_err().contains("empty"));
    // Shuffle: a permutation, Fisher-Yates from the last index down.
    let sh = ev_rng(&call(B::Shuffle, vec![call(B::Range, vec![int(10)])]), &mut Rng::new(3)).unwrap();
    let mut r = Rng::new(3);
    let mut want: Vec<i64> = (0..10).collect();
    for k in (1..10).rev() {
        let j = r.below(k as u64 + 1) as usize;
        want.swap(k, j);
    }
    assert_eq!(sh, vints(&want));
    // Weighted: zero weight is never picked; errors on bad input.
    let mut rng = Rng::new(11);
    let mut counts = [0; 3];
    for _ in 0..1000 {
        let v = ev_rng(&call(B::Weighted, vec![ints(&[0, 1, 2]), ints(&[9, 0, 1])]), &mut rng).unwrap();
        counts[v.as_int().unwrap() as usize] += 1;
    }
    assert_eq!(counts[1], 0);
    assert!(counts[0] > 800 && counts[2] > 50, "{counts:?}");
    let mut r = Rng::new(1);
    assert!(ev_rng(&call(B::Weighted, vec![ints(&[0, 1]), ints(&[1])]), &mut r).unwrap_err().contains("weights"));
    assert!(ev_rng(&call(B::Weighted, vec![ints(&[0, 1]), ints(&[0, 0])]), &mut r).unwrap_err().contains("positive"));
    assert!(ev_rng(&call(B::Weighted, vec![ints(&[0, 1]), ints(&[1, -1])]), &mut r).unwrap_err().contains(">= 0"));
    // weighted draws exactly one next_f64
    let mut a = Rng::new(5);
    let mut b = Rng::new(5);
    ev_rng(&call(B::Weighted, vec![ints(&[0, 1]), ints(&[1, 1])]), &mut a).unwrap();
    b.next_f64();
    assert_eq!(a, b);
}

#[test]
fn collection_and_eval_limits() {
    assert!(err(call(B::Range, vec![int(10_001)])).contains("limit"));
    assert!(ev(call(B::Range, vec![int(10_000)])).is_ok());
    assert!(err(call(B::Repeat, vec![int(0), int(20_000)])).contains("limit"));
    assert!(err(call(B::Concat, vec![call(B::Range, vec![int(6000)]), call(B::Range, vec![int(6000)])])).contains("limit"));
    assert!(err(call(B::Coords, vec![int(200), int(200)])).contains("limit"));
    // nested loops: 3000 * 3000 lambda calls > the 2M budget
    let inner = call(B::Count, vec![call(B::Range, vec![int(3000)]), lam(&[1], bo(true))]);
    let outer = call(B::Map, vec![call(B::Range, vec![int(3000)]), lam(&[0], inner)]);
    assert!(err(outer).contains("budget"));
}

// ───────────────────────────── game / scheduler ─────────────────────────────

fn fired(g: &mut Game) -> Vec<Fired> {
    let mut v = Vec::new();
    g.drain_fired(&mut v);
    v
}

#[test]
fn rollback_on_error() {
    let mut p = P::new();
    let x = p.state("x", Type::Int, int(0));
    let y = p.state("y", Type::Int, int(0));
    let go = p.input("go", 0, None);
    let ev_e = p.event("e", 0);
    p.rule(
        "bad",
        Trigger::Input(go),
        None,
        vec![
            set(x, int(1)),
            Effect::Emit { event: ev_e, args: vec![] },
            set(y, call(B::RandomInt, vec![int(0), int(100)])),
            set(y, Expr::Index(Box::new(ints(&[1])), Box::new(int(5)))),
        ],
    );
    p.rule("good", Trigger::Input(go), None, vec![incr(y)]);
    let mut g = p.game(1);
    let h0 = g.state_hash();
    let v0 = g.version();
    g.input(go, vec![]);
    g.step(0.0);
    assert_eq!(g.state(), &[i(0), i(1)]);
    let d = g.take_diagnostics();
    assert_eq!(d.len(), 1);
    assert_eq!(d[0].code, Code::Runtime);
    assert_eq!(d[0].at, "/rules/0");
    assert!(d[0].message.contains("rule 'bad'") && d[0].message.contains("index 5"), "{}", d[0].message);
    // The emit was rolled back too: only the input fired.
    let f = fired(&mut g);
    assert_eq!(f.len(), 1);
    assert_eq!(f[0].on, EventRef::Input(go));
    assert!(g.version() > v0);
    // RNG was rolled back: same hash as a game where only `good` ran.
    let _ = h0;
    let mut p2 = P::new();
    let _x = p2.state("x", Type::Int, int(0));
    let y2 = p2.state("y", Type::Int, int(0));
    let go2 = p2.input("go", 0, None);
    p2.event("e", 0);
    p2.rule("good", Trigger::Input(go2), None, vec![incr(y2)]);
    let mut g2 = p2.game(1);
    g2.input(go2, vec![]);
    g2.step(0.0);
    assert_eq!(g.state_hash(), g2.state_hash());
}

#[test]
fn when_sees_earlier_rules() {
    let mut p = P::new();
    let x = p.state("x", Type::Int, int(0));
    let y = p.state("y", Type::Int, int(0));
    let go = p.input("go", 0, None);
    p.rule("a", Trigger::Input(go), Some(bin(BinOp::Eq, st(x), int(0))), vec![set(x, int(1))]);
    p.rule("b", Trigger::Input(go), Some(bin(BinOp::Eq, st(x), int(1))), vec![set(y, int(7))]);
    p.rule("c", Trigger::Input(go), Some(bin(BinOp::Eq, st(x), int(0))), vec![set(y, int(99))]);
    let mut g = p.game(1);
    g.input(go, vec![]);
    g.step(16.0);
    assert_eq!(g.state(), &[i(1), i(7)]);
}

#[test]
fn effects_see_earlier_writes_and_paths() {
    let mut p = P::new();
    let l = p.state("l", Type::list(Type::Int), ints(&[1, 2, 3]));
    let g_ = p.state("g", Type::grid(Type::Int), call(B::Grid, vec![int(2), int(2), int(0)]));
    let m = p.state("m", Type::map(Type::Str, Type::Int), call(B::MapOf, vec![list(vec![])]));
    let r = p.state("r", Type::Unknown, Expr::Record(vec![int(0), Expr::Record(vec![int(1), int(2)].into_boxed_slice())].into_boxed_slice()));
    let out = p.state("out", Type::Int, int(0));
    p.rule(
        "s",
        Trigger::Start,
        None,
        vec![
            set_path(l, vec![PathStep::Index(int(1))], int(20)),
            set_path(l, vec![PathStep::Index(int(2))], bin(BinOp::Add, Expr::Index(Box::new(st(l)), Box::new(int(1))), int(1))),
            set_path(g_, vec![PathStep::Index(iv(1, 0))], int(5)),
            set_path(m, vec![PathStep::Index(s("k"))], int(3)),
            set_path(m, vec![PathStep::Index(s("k"))], int(4)),
            set_path(r, vec![PathStep::Field(1), PathStep::Field(0)], int(9)),
            Effect::Let { slot: 0, value: call(B::Sum, vec![st(l)]) },
            set(out, loc(0)),
        ],
    );
    let g = p.game(1);
    assert_eq!(g.state()[l as usize], vints(&[1, 20, 21]));
    assert_eq!(ok(call(B::Values, vec![Expr::Const(g.state()[g_ as usize].clone())])), vints(&[0, 5, 0, 0]));
    assert_eq!(ok(call(B::Keys, vec![Expr::Const(g.state()[m as usize].clone())])), Value::list(vec![Value::str("k")]));
    assert_eq!(g.state()[r as usize], Value::record(vec![i(0), Value::record(vec![i(9), i(2)])]));
    assert_eq!(g.state()[out as usize], i(42));
    assert!(g.clone_diags_empty());
}

impl Game {
    fn clone_diags_empty(&self) -> bool {
        self.diags.is_empty()
    }
}

#[test]
fn set_errors_roll_back() {
    let mut p = P::new();
    let l = p.state("l", Type::list(Type::Int), ints(&[1]));
    let m = p.state("m", Type::Unknown, call(B::MapOf, vec![list(vec![])]));
    p.rule("a", Trigger::Start, None, vec![set_path(l, vec![PathStep::Index(int(0))], int(5)), set_path(l, vec![PathStep::Index(int(3))], int(1))]);
    p.rule("b", Trigger::Start, None, vec![set_path(m, vec![PathStep::Index(s("x")), PathStep::Index(s("y"))], int(1))]);
    let mut g = p.game(1);
    assert_eq!(g.state()[l as usize], vints(&[1]));
    let d = g.take_diagnostics();
    assert_eq!(d.len(), 2);
    assert!(d[0].message.contains("index 3 is out of range"), "{}", d[0].message);
    assert!(d[1].message.contains("not in the map"), "{}", d[1].message);
}

#[test]
fn emit_ordering_and_fired() {
    let mut p = P::new();
    let log = p.state("log", Type::list(Type::Int), ints(&[]));
    let go = p.input("go", 0, None);
    let a = p.event("a", 1);
    let b = p.event("b", 0);
    let c = p.event("c", 0);
    p.rule("in", Trigger::Input(go), None, vec![
        push(log, int(0)),
        Effect::Emit { event: a, args: vec![int(42)] },
        Effect::Emit { event: b, args: vec![] },
    ]);
    p.rule("a", Trigger::Event(a), None, vec![push(log, Expr::Event(0)), Effect::Emit { event: c, args: vec![] }]);
    p.rule("b", Trigger::Event(b), None, vec![push(log, int(2))]);
    p.rule("c", Trigger::Event(c), None, vec![push(log, int(3))]);
    p.rule("tick", Trigger::Tick, None, vec![push(log, int(9))]);
    let mut g = p.game(1);
    g.input(go, vec![]);
    g.input(go, vec![]);
    g.step(10.0);
    // Each input's emit cascade (FIFO) completes before the next input; tick last.
    assert_eq!(g.state()[log as usize], vints(&[0, 42, 2, 3, 0, 42, 2, 3, 9]));
    let f = fired(&mut g);
    let ons: Vec<EventRef> = f.iter().map(|x| x.on).collect();
    use EventRef::*;
    assert_eq!(ons, vec![Input(go), Event(a), Event(b), Event(c), Input(go), Event(a), Event(b), Event(c)]);
    assert_eq!(&*f[0].payload, &[i(10)]); // input payload gets `t`
    assert_eq!(&*f[1].payload, &[i(42)]);
}

#[test]
fn guard_drops_inputs() {
    let mut p = P::new();
    let n = p.state("n", Type::Int, int(0));
    let tap = p.input("tap", 1, Some(bin(BinOp::Lt, st(n), int(2))));
    p.rule("t", Trigger::Input(tap), None, vec![incr(n)]);
    let mut g = p.game(1);
    for _ in 0..4 {
        g.input(tap, vec![Value::IVec2(0, 0)]);
    }
    g.input(tap, vec![]); // wrong payload length: dropped with a diagnostic
    g.step(5.0);
    assert_eq!(g.state()[n as usize], i(2));
    let f = fired(&mut g);
    assert_eq!(f.len(), 2, "guard-dropped inputs are not reported");
    let d = g.take_diagnostics();
    assert_eq!(d.len(), 1);
    assert_eq!(d[0].code, Code::BadPayload);
}

#[test]
fn timers_order_replace_cancel() {
    let mut p = P::new();
    let log = p.state("log", Type::list(Type::Int), ints(&[]));
    let e = p.event("e", 1);
    let go = p.input("go", 0, None);
    let cancel_in = p.input("cancel", 0, None);
    let hide = p.timer("hide");
    let after = |ms: i64, v: i64, t: Option<TimerId>| Effect::After { delay: int(ms), event: e, args: vec![int(v)], timer: t };
    p.rule("s", Trigger::Start, None, vec![
        after(100, 1, None),
        after(50, 2, None),
        after(100, 3, None),        // same due as #1: creation order
        after(80, 4, Some(hide)),
        after(60, 5, Some(hide)),   // replaces #4
    ]);
    p.rule("in", Trigger::Input(go), None, vec![after(10, 6, Some(hide))]);
    p.rule("cx", Trigger::Input(cancel_in), None, vec![Effect::Cancel { timer: hide }]);
    p.rule("log", Trigger::Event(e), None, vec![push(log, Expr::Event(0))]);
    let mut g = p.game(1);
    g.step(55.0);
    assert_eq!(g.state()[log as usize], vints(&[2]));
    g.step(10.0); // t=65: #5 fired
    assert_eq!(g.state()[log as usize], vints(&[2, 5]));
    g.input(go, vec![]); // schedules #6 at 75 under "hide"
    g.step(5.0); // t=70
    g.input(cancel_in, vec![]);
    g.step(100.0); // cancel processed before timers: #6 never fires
    assert_eq!(g.state()[log as usize], vints(&[2, 5, 1, 3]));
    // timer events are reported as custom events
    let f = fired(&mut g);
    assert!(f.iter().any(|x| x.on == EventRef::Event(e) && *x.payload == [i(5)]));
}

#[test]
fn timer_cancelled_in_same_step_does_not_fire() {
    let mut p = P::new();
    let n = p.state("n", Type::Int, int(0));
    let e = p.event("e", 0);
    let go = p.input("go", 0, None);
    let t = p.timer("t");
    p.rule("s", Trigger::Start, None, vec![Effect::After { delay: int(100), event: e, args: vec![], timer: Some(t) }]);
    p.rule("c", Trigger::Input(go), None, vec![Effect::Cancel { timer: t }]);
    p.rule("e", Trigger::Event(e), None, vec![incr(n)]);
    let mut g = p.game(1);
    g.input(go, vec![]);
    g.step(500.0);
    assert_eq!(g.state()[n as usize], i(0));
}

#[test]
fn every_timers_catch_up() {
    let mut p = P::new();
    let log = p.state("log", Type::list(Type::Int), ints(&[]));
    p.rule("a", Trigger::Every { period_ms: 150 }, None, vec![push(log, int(1))]);
    p.rule("b", Trigger::Every { period_ms: 100 }, None, vec![push(log, int(2))]);
    let mut g = p.game(1);
    g.step(149.0);
    assert_eq!(g.state()[log as usize], vints(&[2]));
    g.step(1.0); // 150
    assert_eq!(g.state()[log as usize], vints(&[2, 1]));
    g.step(250.0); // 400: due 200(b), 300(a), 300(b), 400(b) → a was created first
    assert_eq!(g.state()[log as usize], vints(&[2, 1, 2, 1, 2, 2]));
}

#[test]
fn clock_and_tick_dt() {
    let mut p = P::new();
    let dt = p.state("dt", Type::Float, flt(0.0));
    let now = p.state("now", Type::Int, int(0));
    p.rule("t", Trigger::Tick, None, vec![set(dt, Expr::Event(0)), set(now, Expr::Now)]);
    let mut g = p.game(1);
    g.step(16.6667);
    assert_eq!(g.now_us(), 16_667);
    assert_eq!(g.state()[dt as usize], f(16.667));
    assert_eq!(g.state()[now as usize], i(16));
    g.step(-5.0);
    g.step(f64::NAN);
    assert_eq!(g.now_us(), 16_667);
    assert_eq!(g.state()[dt as usize], f(0.0));
}

#[test]
fn time_limit_and_end() {
    let mut p = P::new();
    let n = p.state("n", Type::Int, int(0));
    p.rule("t", Trigger::Tick, None, vec![incr(n)]);
    p.0.objectives.time_limit_ms = Some(1000);
    p.0.objectives.on_timeout = Outcome::Win;
    p.0.objectives.score = Some(bin(BinOp::Mul, st(n), int(10)));
    let mut g = p.game(1);
    g.step(600.0);
    assert_eq!(g.phase(), Phase::Playing);
    g.step(600.0);
    assert_eq!(g.phase(), Phase::Won);
    assert_eq!(g.now_ms(), 1000, "clock clamps at the time limit");
    let st_ = g.status();
    assert_eq!(st_.score, Some(20.0));
    let v = g.version();
    g.step(100.0);
    g.input(0, vec![]);
    assert_eq!(g.now_ms(), 1000);
    assert_eq!(g.version(), v);
    assert_eq!(g.state()[n as usize], i(2));
    let f = fired(&mut g);
    assert_eq!(f.last().unwrap().on, EventRef::Win);
}

#[test]
fn end_effect_commits_and_stops() {
    let mut p = P::new();
    let n = p.state("n", Type::Int, int(0));
    let go = p.input("go", 0, None);
    let e = p.event("e", 0);
    p.rule("a", Trigger::Input(go), None, vec![
        incr(n),
        Effect::Emit { event: e, args: vec![] },
        Effect::If { cond: bo(true), then: vec![Effect::End(Outcome::Lose)], els: vec![] },
        incr(n),
    ]);
    p.rule("b", Trigger::Input(go), None, vec![incr(n)]);
    p.rule("c", Trigger::Event(e), None, vec![incr(n)]);
    let mut g = p.game(1);
    g.input(go, vec![]);
    g.input(go, vec![]);
    g.step(10.0);
    assert_eq!(g.phase(), Phase::Lost);
    assert_eq!(g.state()[n as usize], i(1));
    let f = fired(&mut g);
    assert_eq!(f.iter().map(|x| x.on).collect::<Vec<_>>(), vec![EventRef::Input(go), EventRef::Lose]);
    assert_eq!(g.now_ms(), 10);
    g.step(10.0);
    assert_eq!(g.now_ms(), 10);
}

#[test]
fn objectives_win_before_lose_and_after_each_event() {
    let mut p = P::new();
    let n = p.state("n", Type::Int, int(0));
    let go = p.input("go", 0, None);
    p.rule("a", Trigger::Input(go), None, vec![incr(n)]);
    p.0.objectives.win = Some(bin(BinOp::Ge, st(n), int(2)));
    p.0.objectives.lose = Some(bin(BinOp::Ge, st(n), int(2)));
    let mut g = p.game(1);
    for _ in 0..5 {
        g.input(go, vec![]);
    }
    g.step(1.0);
    assert_eq!(g.phase(), Phase::Won);
    assert_eq!(g.state()[n as usize], i(2), "the game ended after the 2nd input");
}

#[test]
fn objectives_reading_now() {
    let mut p = P::new();
    p.state("n", Type::Int, int(0));
    p.0.objectives.lose = Some(bin(BinOp::Ge, Expr::Now, int(500)));
    let mut g = p.game(1);
    g.step(499.0);
    assert_eq!(g.phase(), Phase::Playing);
    g.step(1.0);
    assert_eq!(g.phase(), Phase::Lost);
}

#[test]
fn event_limit() {
    let mut p = P::new();
    let n = p.state("n", Type::Int, int(0));
    let e = p.event("e", 0);
    p.rule("s", Trigger::Start, None, vec![Effect::Emit { event: e, args: vec![] }]);
    p.rule("loop", Trigger::Event(e), None, vec![incr(n), Effect::Emit { event: e, args: vec![] }]);
    let mut g = p.game(1);
    // start + 255 emitted events
    assert_eq!(g.state()[n as usize], i(255));
    let d = g.take_diagnostics();
    assert_eq!(d.len(), 1);
    assert_eq!(d[0].code, Code::Limit);
    g.step(1.0);
    assert_eq!(g.state()[n as usize], i(255), "the rest were dropped");
}

#[test]
fn effect_and_timer_limits() {
    let mut p = P::new();
    let n = p.state("n", Type::Int, int(0));
    let go = p.input("go", 0, None);
    let go2 = p.input("go2", 0, None);
    let e = p.event("e", 0);
    // 10_000 iterations * 2 effects > MAX_EFFECTS_PER_EVENT
    p.rule("many", Trigger::Input(go), None, vec![Effect::ForEach {
        slot: 0,
        collection: call(B::Range, vec![int(10_000)]),
        body: vec![incr(n), incr(n)],
    }]);
    p.rule("timers", Trigger::Input(go2), None, vec![Effect::ForEach {
        slot: 0,
        collection: call(B::Range, vec![int(129)]),
        body: vec![Effect::After { delay: int(10), event: e, args: vec![], timer: None }],
    }]);
    let mut g = p.game(1);
    g.input(go, vec![]);
    g.input(go2, vec![]);
    g.step(1.0);
    assert_eq!(g.state()[n as usize], i(0));
    let d = g.take_diagnostics();
    assert_eq!(d.len(), 2, "{d:?}");
    assert!(d.iter().all(|x| x.code == Code::Limit));
    assert!(d[0].message.contains("effects"));
    assert!(d[1].message.contains("timers"));
    assert!(g.timers.is_empty());
}

#[test]
fn keys_and_swipes() {
    let mut p = P::new();
    let dir = p.state("dir", Type::IVec2, iv(0, 0));
    let code = p.state("code", Type::Str, s(""));
    let steer = p.input("steer", 1, None);
    p.source(steer, SourceTrigger::Swipe(None), vec![Expr::Field(Box::new(loc(0)), 0)]);
    p.source(steer, SourceTrigger::Key(Rc::from("ArrowUp")), vec![iv(0, -1)]);
    let only_left = p.input("left", 1, None);
    p.source(only_left, SourceTrigger::Swipe(Some((-1, 0))), vec![iv(-9, -9)]);
    let named = p.input("named", 1, None);
    p.source(named, SourceTrigger::Key(Rc::from("KeyA")), vec![iv(1, 1)]);
    p.rule("s", Trigger::Input(steer), None, vec![set(dir, Expr::Event(0))]);
    p.rule("l", Trigger::Input(only_left), None, vec![set(dir, Expr::Event(0))]);
    p.rule("n", Trigger::Input(named), None, vec![set(code, s("A"))]);
    let mut g = p.game(1);
    assert!(g.swipe(1, 0));
    g.step(1.0);
    assert_eq!(g.state()[dir as usize], Value::IVec2(1, 0));
    assert!(g.swipe(-1, 0)); // matches steer (any) then left
    g.step(1.0);
    assert_eq!(g.state()[dir as usize], Value::IVec2(-9, -9));
    assert!(g.key("ArrowUp"));
    g.step(1.0);
    assert_eq!(g.state()[dir as usize], Value::IVec2(0, -1));
    assert!(!g.key("ArrowDown"));
    assert!(g.key("KeyA"));
    g.step(1.0);
    assert_eq!(g.state()[code as usize], Value::str("A"));
}

#[test]
fn state_init_sees_earlier_vars_and_restart() {
    let mut p = P::new();
    let a = p.state("a", Type::Int, call(B::RandomInt, vec![int(0), int(1_000_000)]));
    let b = p.state("b", Type::Int, bin(BinOp::Add, st(a), int(1)));
    let bad = p.state("bad", Type::Int, Expr::Index(Box::new(ints(&[])), Box::new(int(0))));
    let mut g = p.game(5);
    let av = g.state()[a as usize].as_int().unwrap();
    assert_eq!(g.state()[b as usize], i(av + 1));
    assert_eq!(g.state()[bad as usize], i(0));
    let d = g.take_diagnostics();
    assert_eq!(d[0].at, "/state/bad/init");
    let h = g.state_hash();
    let v = g.version();
    g.restart(5);
    assert_eq!(g.state_hash(), h);
    assert!(g.version() > v);
    g.restart(6);
    assert_ne!(g.state_hash(), h);
}

#[test]
fn determinism_hash() {
    let mk = || {
        let mut p = P::new();
        let l = p.state("l", Type::list(Type::Int), ints(&[]));
        let go = p.input("go", 0, None);
        p.rule("r", Trigger::Input(go), None, vec![push(l, call(B::RandomInt, vec![int(0), int(9)]))]);
        p.rule("e", Trigger::Every { period_ms: 30 }, None, vec![push(l, call(B::RandomInt, vec![int(10), int(19)]))]);
        p
    };
    let run = |seed| {
        let mut g = mk().game(seed);
        for k in 0..50 {
            if k % 3 == 0 {
                g.input(0, vec![]);
            }
            g.step(16.0 + (k % 5) as f64);
        }
        g.state_hash()
    };
    assert_eq!(run(1), run(1));
    assert_ne!(run(1), run(2));
}

/// Snake (spec C2) built by hand, so the runtime can be tested and
/// benchmarked without the compiler.
fn hand_snake() -> (Program, InputId) {
    let mut p = P::new();
    let ivl = |v: &[(i32, i32)]| Expr::Const(Value::list(v.iter().map(|&(x, y)| Value::IVec2(x, y)).collect()));
    let snake = p.state("snake", Type::list(Type::IVec2), ivl(&[(4, 7), (3, 7), (2, 7)]));
    let dir = p.state("dir", Type::IVec2, iv(1, 0));
    let next = p.state("next_dir", Type::IVec2, iv(1, 0));
    let food = p.state("food", Type::IVec2, iv(10, 7));
    let score = p.state("score", Type::Int, int(0));
    let steer = p.input("steer", 1, None);
    p.source(steer, SourceTrigger::Swipe(None), vec![Expr::Field(Box::new(loc(0)), 0)]);
    for (k, d) in [("ArrowUp", (0, -1)), ("ArrowDown", (0, 1)), ("ArrowLeft", (-1, 0)), ("ArrowRight", (1, 0))] {
        p.source(steer, SourceTrigger::Key(Rc::from(k)), vec![iv(d.0, d.1)]);
    }
    p.rule(
        "steer",
        Trigger::Input(steer),
        Some(bin(BinOp::Ne, bin(BinOp::Add, Expr::Event(0), st(dir)), iv(0, 0))),
        vec![set(next, Expr::Event(0))],
    );
    let head = loc(0);
    let body_minus_tail = call(B::Take, vec![st(snake), bin(BinOp::Sub, call(B::Len, vec![st(snake)]), int(1))]);
    p.rule(
        "move",
        Trigger::Every { period_ms: 150 },
        None,
        vec![
            set(dir, st(next)),
            Effect::Let { slot: 0, value: bin(BinOp::Add, Expr::Index(Box::new(st(snake)), Box::new(int(0))), st(dir)) },
            Effect::If {
                cond: bin(
                    BinOp::Or,
                    Expr::Unary(UnOp::Not, Box::new(call(B::InBounds, vec![head.clone(), int(15), int(15)]))),
                    call(B::Contains, vec![body_minus_tail.clone(), head.clone()]),
                ),
                then: vec![Effect::End(Outcome::Lose)],
                els: vec![],
            },
            Effect::If {
                cond: bin(BinOp::Eq, head.clone(), st(food)),
                then: vec![
                    set(snake, call(B::Concat, vec![list(vec![head.clone()]), st(snake)])),
                    incr(score),
                    set(
                        food,
                        call(B::Pick, vec![call(B::Filter, vec![
                            call(B::Coords, vec![int(15), int(15)]),
                            lam(&[1], Expr::Unary(UnOp::Not, Box::new(call(B::Contains, vec![st(snake), loc(1)])))),
                        ])]),
                    ),
                ],
                els: vec![set(snake, call(B::Concat, vec![list(vec![head]), body_minus_tail]))],
            },
        ],
    );
    p.0.objectives.win = Some(bin(BinOp::Ge, st(score), int(10)));
    p.0.objectives.score = Some(st(score));
    p.0.objectives.time_limit_ms = Some(120_000);
    (p.0, steer)
}

#[test]
fn hand_built_snake() {
    let (prog, _) = hand_snake();
    let mut g = Game::new(Rc::new(prog), 7);
    let head = |g: &Game| g.state()[0].as_list().unwrap()[0].clone();
    g.step(150.0);
    assert_eq!(head(&g), Value::IVec2(5, 7));
    for _ in 0..5 {
        g.step(150.0);
    }
    assert_eq!(head(&g), Value::IVec2(10, 7));
    assert_eq!(g.state()[0].as_list().unwrap().len(), 4);
    assert_eq!(g.state()[4], i(1));
    // up then left in one tick: left is rejected (guard compares with `dir`)
    g.key("ArrowUp");
    g.key("ArrowLeft");
    g.step(150.0);
    assert_eq!(head(&g), Value::IVec2(10, 6));
    for _ in 0..7 {
        g.step(150.0);
    }
    assert_eq!(g.phase(), Phase::Lost);
    assert!(g.take_diagnostics().is_empty());
}

/// `cargo test -p mg-runtime --release --lib -- --ignored --nocapture bench_hand_snake`
#[test]
#[ignore]
fn bench_hand_snake() {
    let (prog, _) = hand_snake();
    let prog = Rc::new(prog);
    let mut rng = Rng::new(1);
    let keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    let mut steps = 0u64;
    let t = std::time::Instant::now();
    while t.elapsed().as_secs_f64() < 2.0 {
        let mut g = Game::new(prog.clone(), rng.next_u64());
        while g.phase() == Phase::Playing {
            if rng.below(8) == 0 {
                g.key(keys[rng.below(4) as usize]);
            }
            g.step(16.0);
            steps += 1;
        }
    }
    let s = t.elapsed().as_secs_f64();
    eprintln!("hand snake: {:.0} steps/s, {:.3} µs/step", steps as f64 / s, s * 1e6 / steps as f64);
}
