//! Builtin implementations. The doc comment on each `mg_core::builtins::Builtin`
//! variant is the contract; this file follows it exactly.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

use mg_core::builtins::Builtin;
use mg_core::hash::{unit_f64, StableHasher};
use mg_core::ir::{Expr, Slot};
use mg_core::rng::Rng;
use mg_core::value::GridVal;
use mg_core::Value;

use crate::eval::{check_len, eval, kind, rt_err, vec_f, Cx, PureEnv, RtErr, R};
use crate::mathx;

macro_rules! bail {
    ($($t:tt)*) => { return Err(rt_err(format!($($t)*))) };
}

#[cold]
#[inline(never)]
fn type_err(b: Builtin, what: &str, v: &Value) -> Box<RtErr> {
    rt_err(format!("{}: expected {what}, found {}", b.name(), kind(v)))
}

#[inline]
fn arg(env: &PureEnv, cx: &mut Cx, args: &[Expr], i: usize, b: Builtin) -> R<Value> {
    match args.get(i) {
        Some(e) => eval(env, cx, e),
        None => Err(rt_err(format!("{}: missing argument {}", b.name(), i + 1))),
    }
}

#[inline]
fn lambda(args: &[Expr], i: usize, b: Builtin) -> R<(&[Slot], &Expr)> {
    match args.get(i) {
        Some(Expr::Lambda { params, body }) if !params.is_empty() => Ok((params, body)),
        _ => Err(rt_err(format!("{}: argument {} must be a lambda", b.name(), i + 1))),
    }
}

#[inline]
fn int(b: Builtin, v: &Value) -> R<i64> {
    match v {
        Value::Int(i) => Ok(*i),
        _ => Err(type_err(b, "int", v)),
    }
}

#[inline]
fn num(b: Builtin, v: &Value) -> R<f64> {
    match v {
        Value::Int(i) => Ok(*i as f64),
        Value::Float(f) => Ok(*f),
        _ => Err(type_err(b, "number", v)),
    }
}

#[inline]
fn list(b: Builtin, v: Value) -> R<Rc<Vec<Value>>> {
    match v {
        Value::List(l) => Ok(l),
        v => Err(type_err(b, "list", &v)),
    }
}

/// Lists, and sets (ascending) for robustness.
#[inline]
fn seq(b: Builtin, v: Value) -> R<Rc<Vec<Value>>> {
    match v {
        Value::List(l) => Ok(l),
        Value::Set(s) => Ok(Rc::new(s.iter().cloned().collect())),
        v => Err(type_err(b, "list", &v)),
    }
}

#[inline]
fn grid(b: Builtin, v: Value) -> R<Rc<GridVal>> {
    match v {
        Value::Grid(g) => Ok(g),
        v => Err(type_err(b, "grid", &v)),
    }
}

#[inline]
fn ivec(b: Builtin, v: &Value) -> R<(i32, i32)> {
    match v {
        Value::IVec2(x, y) => Ok((*x, *y)),
        _ => Err(type_err(b, "ivec2", v)),
    }
}

#[inline]
fn vecf(b: Builtin, v: &Value) -> R<(f64, f64)> {
    match v {
        Value::IVec2(..) | Value::Vec2(..) => Ok(vec_f(v)),
        _ => Err(type_err(b, "vector", v)),
    }
}

#[inline]
fn string(b: Builtin, v: Value) -> R<Rc<str>> {
    match v {
        Value::Str(s) => Ok(s),
        v => Err(type_err(b, "string", &v)),
    }
}

/// Cost of linear work that does not go through a lambda (1 step per 16 items).
#[inline]
fn lin(cx: &mut Cx, n: usize) -> R<()> {
    cx.charge((n >> 4) as u64)
}

#[inline]
fn apply1(env: &PureEnv, cx: &mut Cx, params: &[Slot], body: &Expr, a: Value) -> R<Value> {
    cx.charge(1)?;
    cx.set_local(params[0], a)?;
    eval(env, cx, body)
}

#[inline]
fn apply2(env: &PureEnv, cx: &mut Cx, params: &[Slot], body: &Expr, a: Value, b: Value) -> R<Value> {
    cx.charge(1)?;
    cx.set_local(params[0], a)?;
    if let Some(p) = params.get(1) {
        cx.set_local(*p, b)?;
    }
    eval(env, cx, body)
}

/// Item callback with an optional index parameter (`x => ..` or `(x, i) => ..`).
#[inline]
fn apply_item(env: &PureEnv, cx: &mut Cx, params: &[Slot], body: &Expr, x: Value, i: usize) -> R<Value> {
    if params.len() >= 2 {
        apply2(env, cx, params, body, x, Value::Int(i as i64))
    } else {
        apply1(env, cx, params, body, x)
    }
}

#[inline]
fn pred(b: Builtin, v: Value) -> R<bool> {
    match v {
        Value::Bool(x) => Ok(x),
        v => Err(type_err(b, "the lambda to return bool", &v)),
    }
}

#[inline]
fn rng<'a>(cx: &'a mut Cx, b: Builtin) -> R<&'a mut Rng> {
    match cx.rng.as_deref_mut() {
        Some(r) => Ok(r),
        None => Err(rt_err(format!(
            "{}() uses randomness, which is only allowed in state init and rule effects; use hash(x) for a stable random-looking value",
            b.name()
        ))),
    }
}

/// `l[lo..hi]` as a list, reusing the allocation when possible.
fn sub_list(l: Rc<Vec<Value>>, lo: usize, hi: usize) -> Value {
    if lo == 0 && hi == l.len() {
        return Value::List(l);
    }
    if hi <= lo {
        return Value::List(Rc::new(Vec::new()));
    }
    match Rc::try_unwrap(l) {
        Ok(mut v) => {
            v.truncate(hi);
            v.drain(..lo);
            Value::List(Rc::new(v))
        }
        Err(l) => Value::List(Rc::new(l[lo..hi].to_vec())),
    }
}

#[inline]
fn clamp_idx(i: i64, len: usize) -> usize {
    i.clamp(0, len as i64) as usize
}

/// Numeric min/max with mixed int/float widening. Non-numbers use the
/// structural order.
fn min_max(b: Builtin, x: Value, y: Value, want_max: bool) -> R<Value> {
    let pick_y = |o: Ordering| if want_max { o == Ordering::Less } else { o == Ordering::Greater };
    match (&x, &y) {
        (Value::Int(a), Value::Int(c)) => Ok(if pick_y(a.cmp(c)) { y } else { x }),
        (Value::Int(_) | Value::Float(_), Value::Int(_) | Value::Float(_)) => {
            let a = num(b, &x)?;
            let c = num(b, &y)?;
            // NaN propagates deterministically: pick the NaN.
            if a.is_nan() {
                return Ok(Value::Float(a));
            }
            if c.is_nan() {
                return Ok(Value::Float(c));
            }
            let o = a.partial_cmp(&c).unwrap_or(Ordering::Equal);
            Ok(Value::Float(if pick_y(o) { c } else { a }))
        }
        _ => Ok(if pick_y(x.cmp(&y)) { y } else { x }),
    }
}

fn to_int(b: Builtin, v: Value, f: fn(f64) -> f64) -> R<Value> {
    match v {
        Value::Int(i) => Ok(Value::Int(i)),
        Value::Float(x) => {
            if !x.is_finite() {
                bail!("{}: cannot convert {} to int", b.name(), mg_core::value::format_float(x));
            }
            // `as` saturates at the i64 range; it never panics.
            Ok(Value::Int(f(x) as i64))
        }
        v => Err(type_err(b, "number", &v)),
    }
}

fn coords_list(w: i64, h: i64, what: &str) -> R<Value> {
    if w <= 0 || h <= 0 {
        return Ok(Value::List(Rc::new(Vec::new())));
    }
    let n = (w as i128 * h as i128).min(usize::MAX as i128) as usize;
    check_len(n, what)?;
    let mut out = Vec::with_capacity(n);
    for y in 0..h as i32 {
        for x in 0..w as i32 {
            out.push(Value::IVec2(x, y));
        }
    }
    Ok(Value::List(Rc::new(out)))
}

fn contains(b: Builtin, c: &Value, x: &Value) -> R<bool> {
    Ok(match (c, x) {
        (Value::List(l), x) => l.iter().any(|v| v == x),
        (Value::Set(s), x) => s.contains(x),
        (Value::Map(m), x) => m.contains_key(x),
        (Value::Str(s), Value::Str(t)) => s.contains(&**t),
        (c, _) => return Err(type_err(b, "list, set or string", c)),
    })
}

fn coll_len(c: &Value) -> usize {
    match c {
        Value::List(l) => l.len(),
        Value::Set(s) => s.len(),
        Value::Map(m) => m.len(),
        Value::Str(s) => s.len(),
        Value::Grid(g) => g.cells.len(),
        _ => 0,
    }
}

fn in_dictionary(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() < 2 || bytes.len() > 8 {
        return false;
    }
    let mut buf = [0u8; 8];
    for (i, &c) in bytes.iter().enumerate() {
        if !c.is_ascii_alphabetic() {
            return false;
        }
        buf[i] = c.to_ascii_lowercase();
    }
    let w = &buf[..bytes.len()];
    crate::words::WORDS.binary_search_by(|x| x.as_bytes().cmp(w)).is_ok()
}

pub(crate) fn call(env: &PureEnv, cx: &mut Cx, b: Builtin, args: &[Expr]) -> R<Value> {
    use Builtin as B;
    use Value as V;
    macro_rules! a {
        ($i:expr) => {
            arg(env, cx, args, $i, b)?
        };
    }
    let out = match b {
        // ── v0.2: text ────────────────────────────────────────────────
        B::Split => {
            let s = string(b, a!(0))?;
            let sep = string(b, a!(1))?;
            let mut buf = [0u8; 4];
            let parts: Vec<Value> = if sep.is_empty() {
                s.chars().map(|c| V::Str(Rc::from(&*c.encode_utf8(&mut buf)))).collect()
            } else {
                s.split(&*sep).map(V::str).collect()
            };
            check_len(parts.len(), "split result")?;
            lin(cx, parts.len())?;
            V::List(Rc::new(parts))
        }
        B::Trim => {
            let s = string(b, a!(0))?;
            let t = s.trim();
            if t.len() == s.len() {
                V::Str(s)
            } else {
                V::str(t)
            }
        }
        B::Substr => {
            let s = string(b, a!(0))?;
            let st = int(b, &a!(1))?;
            let en = int(b, &a!(2))?;
            let n = s.chars().count();
            let (lo, hi) = (clamp_idx(st, n), clamp_idx(en, n));
            if hi <= lo {
                V::str("")
            } else if lo == 0 && hi == n {
                V::Str(s)
            } else {
                V::Str(Rc::from(s.chars().skip(lo).take(hi - lo).collect::<String>()))
            }
        }
        B::StartsWith | B::EndsWith => {
            let s = string(b, a!(0))?;
            let p = string(b, a!(1))?;
            V::Bool(if b == B::StartsWith { s.starts_with(&*p) } else { s.ends_with(&*p) })
        }
        B::Replace => {
            let s = string(b, a!(0))?;
            let from = string(b, a!(1))?;
            let to = string(b, a!(2))?;
            if from.is_empty() || !s.contains(&*from) {
                V::Str(s)
            } else {
                let hits = s.matches(&*from).count();
                let len = s.len() - hits * from.len() + hits * to.len();
                check_len(len, "replace result")?;
                lin(cx, len)?;
                V::Str(Rc::from(s.replace(&*from, &to)))
            }
        }
        B::ParseInt => {
            let s = string(b, a!(0))?;
            // `i64::from_str`: optional `+`/`-`, then ASCII digits; anything else or overflow → none.
            s.trim().parse::<i64>().map_or(V::None, V::Int)
        }

        // ── v0.2: math and space ──────────────────────────────────────
        B::Atan2 => {
            let y = num(b, &a!(0))?;
            let x = num(b, &a!(1))?;
            V::Float(mathx::atan2(y, x))
        }
        B::Sign => match a!(0) {
            V::Int(i) => V::Int(i.signum()),
            // NaN → 0.0 so the result is always -1, 0 or 1.
            V::Float(x) => V::Float(if x > 0.0 {
                1.0
            } else if x < 0.0 {
                -1.0
            } else {
                0.0
            }),
            v => return Err(type_err(b, "number", &v)),
        },
        B::Pow => {
            let x = num(b, &a!(0))?;
            let y = num(b, &a!(1))?;
            V::Float(mathx::pow(x, y))
        }
        B::Fmod => {
            let x = num(b, &a!(0))?;
            let y = num(b, &a!(1))?;
            if y == 0.0 {
                bail!("fmod: division by zero");
            }
            // IEEE remainder-by-truncation: exact, so the same on every platform.
            V::Float(x % y)
        }
        B::Angle => {
            let (x, y) = vecf(b, &a!(0))?;
            V::Float(mathx::atan2(y, x))
        }
        B::FromAngle => {
            let t = num(b, &a!(0))?;
            V::Vec2(mathx::cos(t), mathx::sin(t))
        }
        B::Rotate => {
            let (x, y) = vecf(b, &a!(0))?;
            let t = num(b, &a!(1))?;
            let (c, sn) = (mathx::cos(t), mathx::sin(t));
            V::Vec2(x * c - y * sn, x * sn + y * c)
        }
        B::MinOf | B::MaxOf => {
            let l = seq(b, a!(0))?;
            let Some(first) = l.first() else { bail!("{}() of an empty list", b.name()) };
            lin(cx, l.len())?;
            let want_max = b == B::MaxOf;
            let mut acc = first.clone();
            num(b, &acc)?;
            for x in l[1..].iter() {
                num(b, x)?;
                acc = min_max(b, acc, x.clone(), want_max)?;
            }
            acc
        }
        // ── Math ──────────────────────────────────────────────────────
        B::Abs => match a!(0) {
            V::Int(i) => V::Int(i.wrapping_abs()),
            V::Float(f) => V::Float(f.abs()),
            v => return Err(type_err(b, "number", &v)),
        },
        B::Min | B::Max => {
            let want_max = b == B::Max;
            if args.len() == 1 {
                // Tolerated: min(list) / max(list).
                let l = list(b, a!(0))?;
                let Some(first) = l.first() else { bail!("{}: empty list", b.name()) };
                let mut acc = first.clone();
                for x in l[1..].iter() {
                    acc = min_max(b, acc, x.clone(), want_max)?;
                }
                acc
            } else {
                let mut acc = a!(0);
                for i in 1..args.len() {
                    let x = a!(i);
                    acc = min_max(b, acc, x, want_max)?;
                }
                acc
            }
        }
        B::Clamp => {
            let x = a!(0);
            let lo = a!(1);
            let hi = a!(2);
            let m = min_max(b, x, lo, true)?;
            min_max(b, m, hi, false)?
        }
        B::Floor => to_int(b, a!(0), f64::floor)?,
        B::Ceil => to_int(b, a!(0), f64::ceil)?,
        B::Round => to_int(b, a!(0), f64::round)?, // half away from zero
        B::Sqrt => V::Float(num(b, &a!(0))?.sqrt()),
        B::Log2 => V::Float(mathx::log2(num(b, &a!(0))?)),
        B::Sin => V::Float(mathx::sin(num(b, &a!(0))?)),
        B::Cos => V::Float(mathx::cos(num(b, &a!(0))?)),
        B::Lerp => {
            let x = a!(0);
            let y = a!(1);
            let t = num(b, &a!(2))?;
            match (&x, &y) {
                (V::IVec2(..) | V::Vec2(..), V::IVec2(..) | V::Vec2(..)) => {
                    let (ax, ay) = vec_f(&x);
                    let (bx, by) = vec_f(&y);
                    V::Vec2(ax + (bx - ax) * t, ay + (by - ay) * t)
                }
                _ => {
                    let p = num(b, &x)?;
                    let q = num(b, &y)?;
                    V::Float(p + (q - p) * t)
                }
            }
        }
        B::Hash => {
            let v = a!(0);
            let mut h = StableHasher::new();
            v.stable_hash(&mut h);
            V::Float(unit_f64(h.finish()))
        }

        // ── Lists ─────────────────────────────────────────────────────
        B::Len => match a!(0) {
            V::Str(s) => V::Int(s.chars().count() as i64),
            v @ (V::List(_) | V::Set(_) | V::Map(_) | V::Grid(_)) => V::Int(coll_len(&v) as i64),
            v => return Err(type_err(b, "list, set, map or string", &v)),
        },
        B::First | B::Last => {
            let l = list(b, a!(0))?;
            let x = if b == B::First { l.first() } else { l.last() };
            match x {
                Some(v) => v.clone(),
                None => bail!("{}() of an empty list", b.name()),
            }
        }
        B::GetOr => {
            let c = a!(0);
            let k = a!(1);
            let d = a!(2);
            match (&c, &k) {
                (V::List(l), V::Int(i)) => {
                    if *i >= 0 && (*i as u64) < l.len() as u64 {
                        l[*i as usize].clone()
                    } else {
                        d
                    }
                }
                (V::Grid(g), V::IVec2(x, y)) => g.get(*x, *y).cloned().unwrap_or(d),
                (V::Map(m), k) => m.get(k).cloned().unwrap_or(d),
                _ => bail!("get_or: cannot look up a {} in a {}", kind(&k), kind(&c)),
            }
        }
        B::Slice => {
            let l = list(b, a!(0))?;
            let s = int(b, &a!(1))?;
            let e = int(b, &a!(2))?;
            let n = l.len();
            lin(cx, n)?;
            sub_list(l, clamp_idx(s, n), clamp_idx(e, n))
        }
        B::Take => {
            let l = list(b, a!(0))?;
            let k = clamp_idx(int(b, &a!(1))?, l.len());
            lin(cx, k)?;
            sub_list(l, 0, k)
        }
        B::Drop => {
            let l = list(b, a!(0))?;
            let n = l.len();
            let k = clamp_idx(int(b, &a!(1))?, n);
            lin(cx, n - k)?;
            sub_list(l, k, n)
        }
        B::Concat => match a!(0) {
            V::Str(s0) => {
                let mut s = String::from(&*s0);
                for i in 1..args.len() {
                    let t = string(b, a!(i))?;
                    s.push_str(&t);
                }
                check_len(s.len(), "concat result")?;
                V::Str(Rc::from(s))
            }
            V::List(mut l) => {
                for i in 1..args.len() {
                    let m = list(b, a!(i))?;
                    if m.is_empty() {
                        continue;
                    }
                    check_len(l.len() + m.len(), "concat result")?;
                    lin(cx, l.len() + m.len())?;
                    if l.is_empty() {
                        l = m;
                    } else {
                        Rc::make_mut(&mut l).extend_from_slice(&m);
                    }
                }
                V::List(l)
            }
            v => return Err(type_err(b, "list or string", &v)),
        },
        B::Push => {
            let mut l = list(b, a!(0))?;
            let x = a!(1);
            check_len(l.len() + 1, "push result")?;
            Rc::make_mut(&mut l).push(x);
            V::List(l)
        }
        B::SetAt | B::InsertAt => {
            let mut l = list(b, a!(0))?;
            let i = int(b, &a!(1))?;
            let x = a!(2);
            let n = l.len() as i64;
            let ok = if b == B::SetAt { i >= 0 && i < n } else { i >= 0 && i <= n };
            if !ok {
                bail!("{}: index {i} is out of range for a list of length {n}", b.name());
            }
            if b == B::SetAt {
                Rc::make_mut(&mut l)[i as usize] = x;
            } else {
                check_len(l.len() + 1, "insert_at result")?;
                lin(cx, l.len())?;
                Rc::make_mut(&mut l).insert(i as usize, x);
            }
            V::List(l)
        }
        B::RemoveAt => {
            let mut l = list(b, a!(0))?;
            let i = int(b, &a!(1))?;
            let n = l.len() as i64;
            if i < 0 || i >= n {
                bail!("remove_at: index {i} is out of range for a list of length {n}");
            }
            lin(cx, l.len())?;
            Rc::make_mut(&mut l).remove(i as usize);
            V::List(l)
        }
        B::Reverse => match a!(0) {
            V::List(mut l) => {
                lin(cx, l.len())?;
                Rc::make_mut(&mut l).reverse();
                V::List(l)
            }
            V::Str(s) => V::Str(Rc::from(s.chars().rev().collect::<String>())),
            v => return Err(type_err(b, "list or string", &v)),
        },
        B::Repeat => {
            let v = a!(0);
            let n = int(b, &a!(1))?;
            if n <= 0 {
                V::List(Rc::new(Vec::new()))
            } else {
                check_len((n as u64).min(usize::MAX as u64) as usize, "repeat result")?;
                lin(cx, n as usize)?;
                V::List(Rc::new(vec![v; n as usize]))
            }
        }
        B::Range => {
            let (lo, hi) = if args.len() >= 2 { (int(b, &a!(0))?, int(b, &a!(1))?) } else { (0, int(b, &a!(0))?) };
            let n = (hi as i128 - lo as i128).max(0);
            check_len(n.min(usize::MAX as i128) as usize, "range")?;
            lin(cx, n as usize)?;
            V::List(Rc::new((lo..hi).map(V::Int).collect()))
        }
        B::IndexOf => match a!(0) {
            V::Str(s) => {
                let t = string(b, a!(1))?;
                lin(cx, s.len())?;
                V::Int(s.find(&*t).map_or(-1, |p| s[..p].chars().count() as i64))
            }
            c => {
                let l = list(b, c)?;
                let x = a!(1);
                lin(cx, l.len())?;
                V::Int(l.iter().position(|v| *v == x).map_or(-1, |p| p as i64))
            }
        },
        B::Contains => {
            let c = a!(0);
            let x = a!(1);
            lin(cx, coll_len(&c))?;
            V::Bool(contains(b, &c, &x)?)
        }

        // ── Higher-order ──────────────────────────────────────────────
        B::Map => {
            let l = seq(b, a!(0))?;
            let (p, body) = lambda(args, 1, b)?;
            match Rc::try_unwrap(l) {
                Ok(mut v) => {
                    for (i, x) in v.iter_mut().enumerate() {
                        let item = std::mem::take(x);
                        *x = apply_item(env, cx, p, body, item, i)?;
                    }
                    V::List(Rc::new(v))
                }
                Err(l) => {
                    let mut out = Vec::with_capacity(l.len());
                    for (i, x) in l.iter().enumerate() {
                        out.push(apply_item(env, cx, p, body, x.clone(), i)?);
                    }
                    V::List(Rc::new(out))
                }
            }
        }
        B::Filter => {
            let l = seq(b, a!(0))?;
            let (p, body) = lambda(args, 1, b)?;
            let mut out = Vec::new();
            for (i, x) in l.iter().enumerate() {
                if pred(b, apply_item(env, cx, p, body, x.clone(), i)?)? {
                    out.push(x.clone());
                }
            }
            if out.len() == l.len() {
                V::List(l)
            } else {
                V::List(Rc::new(out))
            }
        }
        B::Fold => {
            let l = seq(b, a!(0))?;
            let mut acc = a!(1);
            let (p, body) = lambda(args, 2, b)?;
            if p.len() < 2 {
                bail!("fold: the lambda needs two parameters (acc, item)");
            }
            for x in l.iter() {
                acc = apply2(env, cx, p, body, acc, x.clone())?;
            }
            acc
        }
        B::Any | B::All => {
            let l = seq(b, a!(0))?;
            let (p, body) = lambda(args, 1, b)?;
            let want = b == B::Any;
            let mut res = !want;
            for (i, x) in l.iter().enumerate() {
                if pred(b, apply_item(env, cx, p, body, x.clone(), i)?)? == want {
                    res = want;
                    break;
                }
            }
            V::Bool(res)
        }
        B::Count => {
            let l = seq(b, a!(0))?;
            let (p, body) = lambda(args, 1, b)?;
            let mut n = 0i64;
            for (i, x) in l.iter().enumerate() {
                if pred(b, apply_item(env, cx, p, body, x.clone(), i)?)? {
                    n += 1;
                }
            }
            V::Int(n)
        }
        B::Find => {
            let l = seq(b, a!(0))?;
            let (p, body) = lambda(args, 1, b)?;
            let mut found = V::None;
            for (i, x) in l.iter().enumerate() {
                if pred(b, apply_item(env, cx, p, body, x.clone(), i)?)? {
                    found = x.clone();
                    break;
                }
            }
            found
        }
        B::SortBy => {
            let l = seq(b, a!(0))?;
            let (p, body) = lambda(args, 1, b)?;
            let mut keyed = Vec::with_capacity(l.len());
            for (i, x) in l.iter().enumerate() {
                keyed.push((apply_item(env, cx, p, body, x.clone(), i)?, i));
            }
            lin(cx, l.len() * 4)?;
            keyed.sort_by(|x, y| x.0.cmp(&y.0)); // stable
            V::List(Rc::new(keyed.into_iter().map(|(_, i)| l[i].clone()).collect()))
        }
        B::Sum => {
            let l = seq(b, a!(0))?;
            lin(cx, l.len())?;
            let mut si: i64 = 0;
            let mut sf: f64 = 0.0;
            let mut is_float = false;
            for x in l.iter() {
                match x {
                    V::Int(i) => {
                        si = si.wrapping_add(*i);
                    }
                    V::Float(f) => {
                        is_float = true;
                        sf += *f;
                    }
                    v => return Err(type_err(b, "a list of numbers", v)),
                }
            }
            if is_float {
                V::Float(sf + si as f64)
            } else {
                V::Int(si)
            }
        }
        B::Zip => {
            let x = list(b, a!(0))?;
            let y = list(b, a!(1))?;
            let n = x.len().min(y.len());
            lin(cx, n)?;
            V::List(Rc::new(
                x.iter().zip(y.iter()).map(|(p, q)| V::Record(Rc::new(vec![p.clone(), q.clone()]))).collect(),
            ))
        }

        // ── Sets and maps ─────────────────────────────────────────────
        B::SetOf => match a!(0) {
            V::List(l) => {
                lin(cx, l.len() * 2)?;
                V::Set(Rc::new(l.iter().cloned().collect::<BTreeSet<_>>()))
            }
            s @ V::Set(_) => s,
            v => return Err(type_err(b, "list", &v)),
        },
        B::Add => match a!(0) {
            V::Set(mut s) => {
                let x = a!(1);
                if !s.contains(&x) {
                    check_len(s.len() + 1, "set")?;
                    Rc::make_mut(&mut s).insert(x);
                }
                V::Set(s)
            }
            v => return Err(type_err(b, "set", &v)),
        },
        B::Remove => {
            let c = a!(0);
            let k = a!(1);
            match c {
                V::Set(mut s) => {
                    if s.contains(&k) {
                        Rc::make_mut(&mut s).remove(&k);
                    }
                    V::Set(s)
                }
                V::Map(mut m) => {
                    if m.contains_key(&k) {
                        Rc::make_mut(&mut m).remove(&k);
                    }
                    V::Map(m)
                }
                v => return Err(type_err(b, "set or map", &v)),
            }
        }
        B::Has => {
            let c = a!(0);
            let k = a!(1);
            match &c {
                V::Set(s) => V::Bool(s.contains(&k)),
                V::Map(m) => V::Bool(m.contains_key(&k)),
                v => return Err(type_err(b, "set or map", v)),
            }
        }
        B::MapOf => {
            let l = list(b, a!(0))?;
            lin(cx, l.len() * 2)?;
            let mut m = BTreeMap::new();
            for pair in l.iter() {
                match pair {
                    V::List(p) | V::Record(p) if p.len() == 2 => {
                        m.insert(p[0].clone(), p[1].clone());
                    }
                    v => bail!("map_of: each item must be a [key, value] pair, found {}", kind(v)),
                }
            }
            V::Map(Rc::new(m))
        }
        B::Put => match a!(0) {
            V::Map(mut m) => {
                let k = a!(1);
                let v = a!(2);
                if !m.contains_key(&k) {
                    check_len(m.len() + 1, "map")?;
                }
                Rc::make_mut(&mut m).insert(k, v);
                V::Map(m)
            }
            v => return Err(type_err(b, "map", &v)),
        },
        B::Keys => match a!(0) {
            V::Map(m) => {
                lin(cx, m.len())?;
                V::List(Rc::new(m.keys().cloned().collect()))
            }
            V::Set(s) => V::List(Rc::new(s.iter().cloned().collect())),
            v => return Err(type_err(b, "map", &v)),
        },
        B::Values => match a!(0) {
            V::Map(m) => {
                lin(cx, m.len())?;
                V::List(Rc::new(m.values().cloned().collect()))
            }
            V::Grid(g) => {
                lin(cx, g.cells.len())?;
                match Rc::try_unwrap(g) {
                    Ok(g) => V::List(Rc::new(g.cells)),
                    Err(g) => V::List(Rc::new(g.cells.clone())),
                }
            }
            v => return Err(type_err(b, "map or grid", &v)),
        },

        // ── Grids ─────────────────────────────────────────────────────
        B::Grid => {
            let w = int(b, &a!(0))?;
            let h = int(b, &a!(1))?;
            let v = a!(2);
            if w < 0 || h < 0 {
                bail!("grid: size {w}x{h} is negative");
            }
            let n = w as i128 * h as i128;
            if n > mg_core::limits::MAX_COLLECTION_LEN as i128 || w > i32::MAX as i64 || h > i32::MAX as i64 {
                return Err(crate::eval::limit_err(format!(
                    "grid: {w}x{h} has more than {} cells",
                    mg_core::limits::MAX_COLLECTION_LEN
                )));
            }
            lin(cx, n as usize)?;
            V::Grid(Rc::new(GridVal { w: w as i32, h: h as i32, cells: vec![v; n as usize] }))
        }
        B::Width => V::Int(grid(b, a!(0))?.w as i64),
        B::Height => V::Int(grid(b, a!(0))?.h as i64),
        B::Cells => {
            let g = grid(b, a!(0))?;
            lin(cx, g.cells.len())?;
            coords_list(g.w as i64, g.h as i64, "cells")?
        }
        B::InGrid => {
            let g = grid(b, a!(0))?;
            let (x, y) = ivec(b, &a!(1))?;
            V::Bool(g.index(x, y).is_some())
        }
        B::GridMap => {
            let g = grid(b, a!(0))?;
            let (p, body) = lambda(args, 1, b)?;
            let two = p.len() >= 2;
            let w = g.w.max(1);
            let mut g = match Rc::try_unwrap(g) {
                Ok(g) => g,
                Err(g) => (*g).clone(),
            };
            for (i, cell) in g.cells.iter_mut().enumerate() {
                let item = std::mem::take(cell);
                *cell = if two {
                    let c = V::IVec2(i as i32 % w, i as i32 / w);
                    apply2(env, cx, p, body, item, c)?
                } else {
                    apply1(env, cx, p, body, item)?
                };
            }
            V::Grid(Rc::new(g))
        }
        B::Neighbors4 => {
            let (x, y) = ivec(b, &a!(0))?;
            V::List(Rc::new(vec![
                V::IVec2(x, y.wrapping_sub(1)),
                V::IVec2(x.wrapping_add(1), y),
                V::IVec2(x, y.wrapping_add(1)),
                V::IVec2(x.wrapping_sub(1), y),
            ]))
        }
        B::Neighbors8 => {
            let (x, y) = ivec(b, &a!(0))?;
            let (l, r, u, d) = (x.wrapping_sub(1), x.wrapping_add(1), y.wrapping_sub(1), y.wrapping_add(1));
            V::List(Rc::new(vec![
                V::IVec2(x, u),
                V::IVec2(r, u),
                V::IVec2(r, y),
                V::IVec2(r, d),
                V::IVec2(x, d),
                V::IVec2(l, d),
                V::IVec2(l, y),
                V::IVec2(l, u),
            ]))
        }
        B::Lines => {
            let g = grid(b, a!(0))?;
            let d = ivec(b, &a!(1))?;
            let (w, h) = (g.w, g.h);
            lin(cx, g.cells.len())?;
            let mut out = Vec::new();
            match d {
                (-1, 0) | (1, 0) => {
                    out.reserve(h as usize);
                    for y in 0..h {
                        let row: Vec<Value> = if d.0 < 0 {
                            (0..w).map(|x| V::IVec2(x, y)).collect()
                        } else {
                            (0..w).rev().map(|x| V::IVec2(x, y)).collect()
                        };
                        out.push(V::List(Rc::new(row)));
                    }
                }
                (0, -1) | (0, 1) => {
                    out.reserve(w as usize);
                    for x in 0..w {
                        let col: Vec<Value> = if d.1 < 0 {
                            (0..h).map(|y| V::IVec2(x, y)).collect()
                        } else {
                            (0..h).rev().map(|y| V::IVec2(x, y)).collect()
                        };
                        out.push(V::List(Rc::new(col)));
                    }
                }
                (dx, dy) => bail!("lines: direction ({dx}, {dy}) must be up, down, left or right"),
            }
            V::List(Rc::new(out))
        }
        B::WriteLine => {
            let mut g = grid(b, a!(0))?;
            let cs = list(b, a!(1))?;
            let vs = list(b, a!(2))?;
            if cs.len() != vs.len() {
                bail!("write_line: {} coords but {} values", cs.len(), vs.len());
            }
            lin(cx, cs.len())?;
            // Validate first so a shared grid is not copied on error.
            let mut idx = Vec::with_capacity(cs.len());
            for c in cs.iter() {
                let (x, y) = ivec(b, c)?;
                match g.index(x, y) {
                    Some(i) => idx.push(i),
                    None => bail!("write_line: cell ({x}, {y}) is outside the {}x{} grid", g.w, g.h),
                }
            }
            let gm = Rc::make_mut(&mut g);
            for (i, v) in idx.into_iter().zip(vs.iter()) {
                gm.cells[i] = v.clone();
            }
            V::Grid(g)
        }

        // ── Space ─────────────────────────────────────────────────────
        B::Vec => {
            let x = a!(0);
            let y = a!(1);
            match (&x, &y) {
                (V::Int(p), V::Int(q)) => match (i32::try_from(*p), i32::try_from(*q)) {
                    (Ok(p), Ok(q)) => V::IVec2(p, q),
                    _ => bail!("vec: ({p}, {q}) is outside the ivec2 range"),
                },
                _ => V::Vec2(num(b, &x)?, num(b, &y)?),
            }
        }
        B::Length => {
            let (x, y) = vecf(b, &a!(0))?;
            V::Float((x * x + y * y).sqrt())
        }
        B::Dist => {
            let (ax, ay) = vecf(b, &a!(0))?;
            let (bx, by) = vecf(b, &a!(1))?;
            let (dx, dy) = (ax - bx, ay - by);
            V::Float((dx * dx + dy * dy).sqrt())
        }
        B::Normalize => {
            let (x, y) = vecf(b, &a!(0))?;
            let l = (x * x + y * y).sqrt();
            if l == 0.0 {
                V::Vec2(0.0, 0.0)
            } else {
                V::Vec2(x / l, y / l)
            }
        }
        B::InBounds => {
            let p = a!(0);
            let w = a!(1);
            let h = a!(2);
            match (&p, &w, &h) {
                (V::IVec2(x, y), V::Int(w), V::Int(h)) => {
                    let (x, y) = (*x as i64, *y as i64);
                    V::Bool(x >= 0 && y >= 0 && x < *w && y < *h)
                }
                _ => {
                    let (x, y) = vecf(b, &p)?;
                    let w = num(b, &w)?;
                    let h = num(b, &h)?;
                    V::Bool(x >= 0.0 && y >= 0.0 && x < w && y < h)
                }
            }
        }
        B::Coords => {
            let w = int(b, &a!(0))?;
            let h = int(b, &a!(1))?;
            lin(cx, (w.max(0) as usize).saturating_mul(h.max(0) as usize))?;
            coords_list(w, h, "coords")?
        }
        B::OverlapsCircle => {
            let (ax, ay) = vecf(b, &a!(0))?;
            let r1 = num(b, &a!(1))?;
            let (bx, by) = vecf(b, &a!(2))?;
            let r2 = num(b, &a!(3))?;
            let (dx, dy) = (ax - bx, ay - by);
            V::Bool((dx * dx + dy * dy).sqrt() < r1 + r2)
        }
        B::OverlapsRect => {
            let (ax, ay) = vecf(b, &a!(0))?;
            let (aw, ah) = vecf(b, &a!(1))?;
            let (bx, by) = vecf(b, &a!(2))?;
            let (bw, bh) = vecf(b, &a!(3))?;
            let ox = (ax + aw).min(bx + bw) - ax.max(bx);
            let oy = (ay + ah).min(by + bh) - ay.max(by);
            V::Bool(ox > 0.0 && oy > 0.0)
        }

        // ── Text ──────────────────────────────────────────────────────
        B::Chars => {
            let s = string(b, a!(0))?;
            let n = s.chars().count();
            check_len(n, "chars result")?;
            lin(cx, n)?;
            let mut buf = [0u8; 4];
            V::List(Rc::new(s.chars().map(|c| V::Str(Rc::from(&*c.encode_utf8(&mut buf)))).collect()))
        }
        B::Upper => V::Str(Rc::from(string(b, a!(0))?.to_uppercase())),
        B::Lower => V::Str(Rc::from(string(b, a!(0))?.to_lowercase())),
        B::Join => {
            let l = list(b, a!(0))?;
            let sep = string(b, a!(1))?;
            lin(cx, l.len())?;
            let mut s = String::new();
            for (i, x) in l.iter().enumerate() {
                if i > 0 {
                    s.push_str(&sep);
                }
                match x {
                    V::Str(t) => s.push_str(t),
                    other => {
                        use std::fmt::Write;
                        let _ = write!(s, "{other}");
                    }
                }
            }
            V::Str(Rc::from(s))
        }
        B::Str => match a!(0) {
            s @ V::Str(_) => s,
            v => V::Str(Rc::from(v.to_string())),
        },
        B::InDictionary => {
            let s = string(b, a!(0))?;
            V::Bool(in_dictionary(&s))
        }

        // ── Options ───────────────────────────────────────────────────
        B::IsNone => V::Bool(a!(0).is_none()),
        B::OrElse => match a!(0) {
            V::None => a!(1),
            v => v,
        },

        // ── Random ────────────────────────────────────────────────────
        B::RandomInt => {
            let lo = int(b, &a!(0))?;
            let hi = int(b, &a!(1))?;
            V::Int(rng(cx, b)?.range_inclusive(lo, hi))
        }
        B::RandomFloat => {
            let lo = num(b, &a!(0))?;
            let hi = num(b, &a!(1))?;
            let u = rng(cx, b)?.next_f64();
            V::Float(lo + u * (hi - lo))
        }
        B::Pick => {
            let l = seq(b, a!(0))?;
            if l.is_empty() {
                bail!("pick() of an empty list");
            }
            let i = rng(cx, b)?.below(l.len() as u64) as usize;
            l[i].clone()
        }
        B::Shuffle => {
            let mut l = list(b, a!(0))?;
            lin(cx, l.len())?;
            let n = l.len();
            if n > 1 {
                let r = rng(cx, b)?;
                let v = Rc::make_mut(&mut l);
                for i in (1..n).rev() {
                    let j = r.below(i as u64 + 1) as usize;
                    v.swap(i, j);
                }
            } else {
                rng(cx, b)?; // still reject in pure contexts
            }
            V::List(l)
        }
        B::Chance => {
            let p = num(b, &a!(0))?;
            V::Bool(rng(cx, b)?.next_f64() < p)
        }
        B::Weighted => {
            let vs = list(b, a!(0))?;
            let ws = list(b, a!(1))?;
            if vs.len() != ws.len() {
                bail!("weighted: {} values but {} weights", vs.len(), ws.len());
            }
            lin(cx, ws.len())?;
            let mut total = 0.0;
            for w in ws.iter() {
                let w = num(b, w)?;
                if w.is_nan() || w < 0.0 || w.is_infinite() {
                    bail!("weighted: weight {} must be a finite number >= 0", mg_core::value::format_float(w));
                }
                total += w;
            }
            if total <= 0.0 || total.is_nan() || total.is_infinite() {
                bail!("weighted: the weights must add up to a positive number");
            }
            let r = rng(cx, b)?.next_f64() * total;
            let mut acc = 0.0;
            let mut chosen = None;
            let mut last_pos = 0;
            for (i, w) in ws.iter().enumerate() {
                let w = num(b, w)?;
                if w > 0.0 {
                    last_pos = i;
                }
                acc += w;
                if r < acc {
                    chosen = Some(i);
                    break;
                }
            }
            // Rounding can leave r == total: fall back to the last positive weight.
            vs[chosen.unwrap_or(last_pos)].clone()
        }
    };
    Ok(out)
}
