//! Expression evaluator. Also used by mg-scene for presentation bindings.
//!
//! Tree-walking over resolved IR: no name lookups. Locals live in one flat
//! stack (`Locals::stack`); the current frame starts at `Cx::base`. A user
//! function call pushes a frame of `Function::n_locals` slots above the
//! current top, with the arguments in slots `0..n`.
//!
//! Errors carry a `String` message that is only built on the error path.

use std::rc::Rc;

use mg_core::ast::{BinOp, UnOp};
use mg_core::ir::{Expr, Program, Slot};
use mg_core::limits::{MAX_COLLECTION_LEN, MAX_EVAL_STEPS_PER_EVENT};
use mg_core::rng::Rng;
use mg_core::{Code, Value};

use crate::Phase;

/// CONTRACT. Read-only environment for pure evaluation (no RNG).
pub struct PureEnv<'a> {
    pub program: &'a Program,
    pub state: &'a [Value],
    pub now_ms: i64,
    pub phase: Phase,
    /// Payload of the current event (`Expr::Event(i)` reads `event[i]`).
    pub event: &'a [Value],
}

/// CONTRACT. Flat local-variable stack. Root frame slots start at 0.
#[derive(Default, Debug)]
pub struct Locals {
    pub stack: Vec<Value>,
}

impl Locals {
    pub fn new() -> Self {
        Locals { stack: Vec::new() }
    }
    /// Clears and sizes the root frame to `n` slots of `Value::None`.
    pub fn reset(&mut self, n: u16) {
        self.stack.clear();
        self.stack.resize(n as usize, Value::None);
    }
    #[inline]
    pub fn set(&mut self, slot: Slot, v: Value) {
        self.stack[slot as usize] = v;
    }
}

/// CONTRACT. Evaluation failure (becomes an `E_RUNTIME` diagnostic).
#[derive(Clone, Debug, PartialEq)]
pub struct EvalError {
    pub message: String,
}

impl std::fmt::Display for EvalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// CONTRACT. Evaluates a pure expression (random builtins are an error here).
/// Each call gets a fresh `MAX_EVAL_STEPS_PER_EVENT` budget. `locals` must
/// hold the root frame (`Locals::reset(n_locals)`); function frames are pushed
/// above it and popped again, so its length is unchanged afterwards.
pub fn eval_pure(env: &PureEnv, locals: &mut Locals, expr: &Expr) -> Result<Value, EvalError> {
    let mut cx = Cx { stack: &mut locals.stack, base: 0, rng: None, steps_left: MAX_EVAL_STEPS_PER_EVENT };
    let root_len = cx.stack.len();
    let r = eval(env, &mut cx, expr);
    cx.stack.truncate(root_len);
    r.map_err(|e| EvalError { message: e.msg })
}

// ───────────────────────────── internals ─────────────────────────────

/// Internal error: a diagnostic code (`Runtime` or `Limit`) and a message.
#[derive(Debug)]
pub(crate) struct RtErr {
    pub code: Code,
    pub msg: String,
}

/// Boxed so `R<Value>` stays as small as `Value`.
pub(crate) type R<T> = Result<T, Box<RtErr>>;

#[cold]
#[inline(never)]
pub(crate) fn rt_err(msg: String) -> Box<RtErr> {
    Box::new(RtErr { code: Code::Runtime, msg })
}

#[cold]
#[inline(never)]
pub(crate) fn limit_err(msg: String) -> Box<RtErr> {
    Box::new(RtErr { code: Code::Limit, msg })
}

/// Mutable evaluation context.
pub(crate) struct Cx<'s> {
    pub stack: &'s mut Vec<Value>,
    /// Start of the current frame in `stack`.
    pub base: usize,
    /// `None` in pure contexts: random builtins are an error.
    pub rng: Option<&'s mut Rng>,
    /// Remaining evaluation budget (`MAX_EVAL_STEPS_PER_EVENT`).
    pub steps_left: u64,
}

impl Cx<'_> {
    #[inline]
    pub fn charge(&mut self, n: u64) -> R<()> {
        if self.steps_left >= n {
            self.steps_left -= n;
            Ok(())
        } else {
            self.steps_left = 0;
            Err(limit_err(format!(
                "evaluation budget exceeded ({MAX_EVAL_STEPS_PER_EVENT} steps per event); \
                 nested loops over large collections are too slow"
            )))
        }
    }

    #[inline]
    pub fn set_local(&mut self, slot: Slot, v: Value) -> R<()> {
        match self.stack.get_mut(self.base + slot as usize) {
            Some(s) => {
                *s = v;
                Ok(())
            }
            None => Err(rt_err(format!("internal: local slot {slot} is outside the frame"))),
        }
    }

    #[inline]
    pub fn local(&self, slot: Slot) -> R<&Value> {
        match self.stack.get(self.base + slot as usize) {
            Some(v) => Ok(v),
            None => Err(rt_err(format!("internal: local slot {slot} is outside the frame"))),
        }
    }
}

/// Short type description for error messages.
pub(crate) fn kind(v: &Value) -> &'static str {
    match v {
        Value::None => "none",
        Value::Bool(_) => "bool",
        Value::Int(_) => "int",
        Value::Float(_) => "float",
        Value::Str(_) => "string",
        Value::IVec2(..) => "ivec2",
        Value::Vec2(..) => "vec2",
        Value::List(_) => "list",
        Value::Set(_) => "set",
        Value::Map(_) => "map",
        Value::Grid(_) => "grid",
        Value::Record(_) => "record",
    }
}

#[inline]
pub(crate) fn check_len(n: usize, what: &str) -> R<()> {
    if n <= MAX_COLLECTION_LEN {
        Ok(())
    } else {
        Err(limit_err(format!("{what} would have {n} items; the limit is {MAX_COLLECTION_LEN}")))
    }
}

thread_local! {
    static STATUS_STRS: [Value; 3] = [Value::str("playing"), Value::str("won"), Value::str("lost")];
}

fn status_value(p: Phase) -> Value {
    STATUS_STRS.with(|s| {
        s[match p {
            Phase::Playing => 0,
            Phase::Won => 1,
            Phase::Lost => 2,
        }]
        .clone()
    })
}

/// True for expressions that can be borrowed without evaluation side effects.
#[inline]
fn is_simple(e: &Expr) -> bool {
    match e {
        Expr::Local(_) | Expr::State(_) | Expr::Event(_) | Expr::Const(_) => true,
        Expr::Field(b, _) => is_simple(b),
        _ => false,
    }
}

/// Borrows the value of a simple expression (see `is_simple`). `None` means
/// "evaluate it normally" (which also produces the proper error).
#[inline]
fn borrow<'v>(state: &'v [Value], event: &'v [Value], frame: &'v [Value], e: &'v Expr) -> Option<&'v Value> {
    match e {
        Expr::Local(s) => frame.get(*s as usize),
        Expr::State(s) => state.get(*s as usize),
        Expr::Event(i) => event.get(*i as usize),
        Expr::Const(v) => Some(v),
        Expr::Field(b, i) => match borrow(state, event, frame, b)? {
            Value::Record(r) => r.get(*i as usize),
            _ => None,
        },
        _ => None,
    }
}

pub(crate) fn eval_bool(env: &PureEnv, cx: &mut Cx, e: &Expr) -> R<bool> {
    match eval(env, cx, e)? {
        Value::Bool(b) => Ok(b),
        v => Err(rt_err(format!("expected bool, found {}", kind(&v)))),
    }
}

pub(crate) fn eval(env: &PureEnv, cx: &mut Cx, e: &Expr) -> R<Value> {
    match e {
        Expr::Const(v) => Ok(v.clone()),
        Expr::Local(s) => cx.local(*s).cloned(),
        Expr::State(s) => match env.state.get(*s as usize) {
            Some(v) => Ok(v.clone()),
            None => Err(rt_err(format!("internal: state id {s} out of range"))),
        },
        Expr::Event(i) => match env.event.get(*i as usize) {
            Some(v) => Ok(v.clone()),
            None => Err(rt_err(format!("this event has no payload field #{i}"))),
        },
        Expr::Now => Ok(Value::Int(env.now_ms)),
        Expr::Status => Ok(status_value(env.phase)),
        Expr::Field(b, i) => {
            if is_simple(b) {
                if let Some(v) = borrow(env.state, env.event, &cx.stack[cx.base..], b) {
                    return field(v, *i);
                }
            }
            let v = eval(env, cx, b)?;
            field(&v, *i)
        }
        Expr::VecComponent(b, c) => {
            let v = eval(env, cx, b)?;
            match (v, c) {
                (Value::IVec2(x, _), 0) => Ok(Value::Int(x as i64)),
                (Value::IVec2(_, y), _) => Ok(Value::Int(y as i64)),
                (Value::Vec2(x, _), 0) => Ok(Value::Float(x)),
                (Value::Vec2(_, y), _) => Ok(Value::Float(y)),
                (v, _) => Err(rt_err(format!(".{} needs a vector, found {}", if *c == 0 { "x" } else { "y" }, kind(&v)))),
            }
        }
        Expr::Index(b, i) => {
            if is_simple(b) {
                let key = eval(env, cx, i)?;
                if let Some(v) = borrow(env.state, env.event, &cx.stack[cx.base..], b) {
                    return index(v, &key);
                }
                let base = eval(env, cx, b)?;
                return index(&base, &key);
            }
            let base = eval(env, cx, b)?;
            let key = eval(env, cx, i)?;
            index(&base, &key)
        }
        Expr::Unary(op, a) => {
            let v = eval(env, cx, a)?;
            unary(*op, v)
        }
        Expr::Binary(op, a, b) => match op {
            BinOp::And => {
                if !eval_bool(env, cx, a)? {
                    return Ok(Value::Bool(false));
                }
                Ok(Value::Bool(eval_bool(env, cx, b)?))
            }
            BinOp::Or => {
                if eval_bool(env, cx, a)? {
                    return Ok(Value::Bool(true));
                }
                Ok(Value::Bool(eval_bool(env, cx, b)?))
            }
            _ => {
                let x = eval(env, cx, a)?;
                let y = eval(env, cx, b)?;
                binary(*op, x, y)
            }
        },
        Expr::ToFloat(a) => match eval(env, cx, a)? {
            Value::Int(i) => Ok(Value::Float(i as f64)),
            v @ Value::Float(_) => Ok(v),
            Value::IVec2(x, y) => Ok(Value::Vec2(x as f64, y as f64)),
            v => Err(rt_err(format!("cannot convert {} to float", kind(&v)))),
        },
        Expr::If(c, a, b) => {
            if eval_bool(env, cx, c)? {
                eval(env, cx, a)
            } else {
                eval(env, cx, b)
            }
        }
        Expr::Let(slot, v, body) => {
            let v = eval(env, cx, v)?;
            cx.set_local(*slot, v)?;
            eval(env, cx, body)
        }
        Expr::Call(f, args) => call_function(env, cx, *f, args),
        Expr::Builtin(b, args) => crate::builtins::call(env, cx, *b, args),
        Expr::Lambda { .. } => Err(rt_err("internal: a lambda can only be a builtin argument".into())),
        Expr::List(items) => {
            check_len(items.len(), "list literal")?;
            let mut out = Vec::with_capacity(items.len());
            for it in items.iter() {
                out.push(eval(env, cx, it)?);
            }
            Ok(Value::List(Rc::new(out)))
        }
        Expr::Record(fields) => {
            let mut out = Vec::with_capacity(fields.len());
            for f in fields.iter() {
                out.push(eval(env, cx, f)?);
            }
            Ok(Value::Record(Rc::new(out)))
        }
        Expr::RecordUpdate(b, ups) => {
            let mut base = eval(env, cx, b)?;
            for (i, ue) in ups.iter() {
                let v = eval(env, cx, ue)?;
                match &mut base {
                    Value::Record(r) => match Rc::make_mut(r).get_mut(*i as usize) {
                        Some(slot) => *slot = v,
                        None => return Err(rt_err(format!("internal: record has no field #{i}"))),
                    },
                    other => return Err(rt_err(format!("spread needs a record, found {}", kind(other)))),
                }
            }
            Ok(base)
        }
    }
}

fn call_function(env: &PureEnv, cx: &mut Cx, f: u16, args: &[Expr]) -> R<Value> {
    let Some(func) = env.program.functions.get(f as usize) else {
        return Err(rt_err(format!("internal: function id {f} out of range")));
    };
    cx.charge(1)?;
    let new_base = cx.stack.len();
    for a in args {
        match eval(env, cx, a) {
            Ok(v) => cx.stack.push(v),
            Err(e) => {
                cx.stack.truncate(new_base);
                return Err(e);
            }
        }
    }
    let frame = (func.n_locals as usize).max(args.len());
    cx.stack.resize(new_base + frame, Value::None);
    let old_base = cx.base;
    cx.base = new_base;
    let r = eval(env, cx, &func.body);
    cx.base = old_base;
    cx.stack.truncate(new_base);
    match r {
        Ok(v) => Ok(v),
        Err(mut e) => {
            let name = &func.name;
            if !e.msg.starts_with("in function") {
                e.msg = format!("in function '{name}': {}", e.msg);
            }
            Err(e)
        }
    }
}

#[inline]
fn field(v: &Value, i: u16) -> R<Value> {
    match v {
        Value::Record(r) => match r.get(i as usize) {
            Some(x) => Ok(x.clone()),
            None => Err(rt_err(format!("internal: record has no field #{i}"))),
        },
        other => Err(rt_err(format!("field access needs a record, found {}", kind(other)))),
    }
}

/// `base[key]` for lists (int), grids (ivec2) and maps (any key).
#[inline]
pub(crate) fn index(base: &Value, key: &Value) -> R<Value> {
    match (base, key) {
        (Value::List(l), Value::Int(i)) => {
            if *i >= 0 && (*i as u64) < l.len() as u64 {
                Ok(l[*i as usize].clone())
            } else {
                Err(rt_err(format!("index {i} is out of range for a list of length {}", l.len())))
            }
        }
        (Value::Grid(g), Value::IVec2(x, y)) => match g.get(*x, *y) {
            Some(v) => Ok(v.clone()),
            None => Err(rt_err(format!("cell ({x}, {y}) is outside the {}x{} grid", g.w, g.h))),
        },
        (Value::Map(m), k) => match m.get(k) {
            Some(v) => Ok(v.clone()),
            None => Err(rt_err(format!("key {k} is not in the map"))),
        },
        (b, k) => Err(rt_err(format!("cannot index a {} with a {}", kind(b), kind(k)))),
    }
}

fn unary(op: UnOp, v: Value) -> R<Value> {
    match (op, v) {
        (UnOp::Not, Value::Bool(b)) => Ok(Value::Bool(!b)),
        (UnOp::Neg, Value::Int(i)) => Ok(Value::Int(i.wrapping_neg())),
        (UnOp::Neg, Value::Float(f)) => Ok(Value::Float(-f)),
        (UnOp::Neg, Value::IVec2(x, y)) => Ok(Value::IVec2(x.wrapping_neg(), y.wrapping_neg())),
        (UnOp::Neg, Value::Vec2(x, y)) => Ok(Value::Vec2(-x, -y)),
        (op, v) => Err(rt_err(format!(
            "'{}' cannot be applied to {}",
            if op == UnOp::Not { "not" } else { "-" },
            kind(&v)
        ))),
    }
}

#[cold]
#[inline(never)]
fn bad_operands(op: BinOp, a: &Value, b: &Value) -> Box<RtErr> {
    rt_err(format!("'{}' cannot be applied to {} and {}", op.symbol(), kind(a), kind(b)))
}

#[cold]
#[inline(never)]
fn div_zero(op: BinOp) -> Box<RtErr> {
    rt_err(format!("{} by zero", if op == BinOp::Mod { "modulo" } else { "division" }))
}

/// Narrows an i64 scalar product back into an ivec2 component (wrapping).
#[inline]
fn wrap32(v: i64) -> i32 {
    v as i32
}

pub(crate) fn binary(op: BinOp, a: Value, b: Value) -> R<Value> {
    use Value::*;
    // Fast path: int/int.
    if let (Int(x), Int(y)) = (&a, &b) {
        let (x, y) = (*x, *y);
        return Ok(match op {
            BinOp::Add => Int(x.wrapping_add(y)),
            BinOp::Sub => Int(x.wrapping_sub(y)),
            BinOp::Mul => Int(x.wrapping_mul(y)),
            BinOp::Div => {
                if y == 0 {
                    return Err(div_zero(op));
                }
                Int(x.wrapping_div(y))
            }
            BinOp::Mod => {
                if y == 0 {
                    return Err(div_zero(op));
                }
                Int(x.wrapping_rem(y))
            }
            BinOp::Eq => Bool(x == y),
            BinOp::Ne => Bool(x != y),
            BinOp::Lt => Bool(x < y),
            BinOp::Le => Bool(x <= y),
            BinOp::Gt => Bool(x > y),
            BinOp::Ge => Bool(x >= y),
            BinOp::And | BinOp::Or => return Err(bad_operands(op, &a, &b)),
        });
    }
    match op {
        BinOp::Eq => return Ok(Bool(a == b)),
        BinOp::Ne => return Ok(Bool(a != b)),
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
            // Numbers compare numerically (mixed int/float widens); everything
            // else uses the structural total order.
            let ord = match (&a, &b) {
                (Float(x), Float(y)) => num_cmp(*x, *y),
                (Int(x), Float(y)) => num_cmp(*x as f64, *y),
                (Float(x), Int(y)) => num_cmp(*x, *y as f64),
                _ => Some(a.cmp(&b)),
            };
            let Some(ord) = ord else { return Ok(Bool(false)) }; // NaN: every ordering is false
            use std::cmp::Ordering::*;
            return Ok(Bool(match op {
                BinOp::Lt => ord == Less,
                BinOp::Le => ord != Greater,
                BinOp::Gt => ord == Greater,
                _ => ord != Less,
            }));
        }
        _ => {}
    }
    let r = match (op, &a, &b) {
        // Floats (and mixed int/float, for robustness).
        (_, Float(_) | Int(_), Float(_) | Int(_)) => {
            let x = a.as_f64().unwrap_or(0.0);
            let y = b.as_f64().unwrap_or(0.0);
            match op {
                BinOp::Add => Float(x + y),
                BinOp::Sub => Float(x - y),
                BinOp::Mul => Float(x * y),
                BinOp::Div => {
                    if y == 0.0 {
                        return Err(div_zero(op));
                    }
                    Float(x / y)
                }
                BinOp::Mod => {
                    if y == 0.0 {
                        return Err(div_zero(op));
                    }
                    Float(x % y)
                }
                _ => return Err(bad_operands(op, &a, &b)),
            }
        }
        (BinOp::Add, Str(x), Str(y)) => {
            let mut s = String::with_capacity(x.len() + y.len());
            s.push_str(x);
            s.push_str(y);
            Str(Rc::from(s))
        }
        (BinOp::Add, IVec2(ax, ay), IVec2(bx, by)) => IVec2(ax.wrapping_add(*bx), ay.wrapping_add(*by)),
        (BinOp::Sub, IVec2(ax, ay), IVec2(bx, by)) => IVec2(ax.wrapping_sub(*bx), ay.wrapping_sub(*by)),
        (BinOp::Add, Vec2(ax, ay), Vec2(bx, by)) => Vec2(ax + bx, ay + by),
        (BinOp::Sub, Vec2(ax, ay), Vec2(bx, by)) => Vec2(ax - bx, ay - by),
        // Mixed ivec2/vec2 widens (robustness; the checker normally prevents it).
        (BinOp::Add | BinOp::Sub, IVec2(..) | Vec2(..), IVec2(..) | Vec2(..)) => {
            let (ax, ay) = vec_f(&a);
            let (bx, by) = vec_f(&b);
            if op == BinOp::Add {
                Vec2(ax + bx, ay + by)
            } else {
                Vec2(ax - bx, ay - by)
            }
        }
        (BinOp::Mul, IVec2(x, y), Int(s)) | (BinOp::Mul, Int(s), IVec2(x, y)) => {
            IVec2(wrap32((*x as i64).wrapping_mul(*s)), wrap32((*y as i64).wrapping_mul(*s)))
        }
        (BinOp::Mul, IVec2(..) | Vec2(..), Float(_) | Int(_)) => {
            let (x, y) = vec_f(&a);
            let s = b.as_f64().unwrap_or(0.0);
            Vec2(x * s, y * s)
        }
        (BinOp::Mul, Float(_) | Int(_), IVec2(..) | Vec2(..)) => {
            let (x, y) = vec_f(&b);
            let s = a.as_f64().unwrap_or(0.0);
            Vec2(x * s, y * s)
        }
        (BinOp::Div, IVec2(x, y), Int(s)) => {
            if *s == 0 {
                return Err(div_zero(op));
            }
            IVec2(wrap32((*x as i64).wrapping_div(*s)), wrap32((*y as i64).wrapping_div(*s)))
        }
        (BinOp::Div, IVec2(..) | Vec2(..), Float(_) | Int(_)) => {
            let (x, y) = vec_f(&a);
            let s = b.as_f64().unwrap_or(0.0);
            if s == 0.0 {
                return Err(div_zero(op));
            }
            Vec2(x / s, y / s)
        }
        _ => return Err(bad_operands(op, &a, &b)),
    };
    Ok(r)
}

#[inline]
fn num_cmp(x: f64, y: f64) -> Option<std::cmp::Ordering> {
    x.partial_cmp(&y)
}

#[inline]
pub(crate) fn vec_f(v: &Value) -> (f64, f64) {
    match v {
        Value::IVec2(x, y) => (*x as f64, *y as f64),
        Value::Vec2(x, y) => (*x, *y),
        _ => (0.0, 0.0),
    }
}
