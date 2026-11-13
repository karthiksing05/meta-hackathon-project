//! Runtime values.
//!
//! * Containers are `Rc`-shared. Mutate through `Rc::make_mut` so a uniquely
//!   owned container is updated in place and a shared one is copied once.
//! * `Option<T>` values are stored unwrapped; absence is `Value::None`.
//! * Enum values are `Value::Str`.
//! * Equality and ordering are structural and total (floats use `total_cmp`),
//!   so values can live in `BTreeSet` / `BTreeMap` and hash deterministically.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::rc::Rc;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct GridVal {
    pub w: i32,
    pub h: i32,
    /// Row-major: index = y * w + x.
    pub cells: Vec<Value>,
}

impl GridVal {
    #[inline]
    pub fn index(&self, x: i32, y: i32) -> Option<usize> {
        if x >= 0 && y >= 0 && x < self.w && y < self.h {
            Some((y * self.w + x) as usize)
        } else {
            None
        }
    }
    #[inline]
    pub fn get(&self, x: i32, y: i32) -> Option<&Value> {
        self.index(x, y).map(|i| &self.cells[i])
    }
}

#[derive(Clone, Debug, Default)]
pub enum Value {
    #[default]
    None,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(Rc<str>),
    IVec2(i32, i32),
    Vec2(f64, f64),
    List(Rc<Vec<Value>>),
    Set(Rc<BTreeSet<Value>>),
    Map(Rc<BTreeMap<Value, Value>>),
    Grid(Rc<GridVal>),
    /// Fields in the order of the (name-sorted) `RecordType`.
    Record(Rc<Vec<Value>>),
}

impl Value {
    pub fn str(s: &str) -> Value {
        Value::Str(Rc::from(s))
    }
    pub fn list(v: Vec<Value>) -> Value {
        Value::List(Rc::new(v))
    }
    pub fn record(v: Vec<Value>) -> Value {
        Value::Record(Rc::new(v))
    }
    pub fn grid(w: i32, h: i32, cells: Vec<Value>) -> Value {
        Value::Grid(Rc::new(GridVal { w, h, cells }))
    }

    #[inline]
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(b) => Some(*b),
            _ => None,
        }
    }
    #[inline]
    pub fn as_int(&self) -> Option<i64> {
        match self {
            Value::Int(i) => Some(*i),
            _ => None,
        }
    }
    /// Ints widen to floats.
    #[inline]
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Float(f) => Some(*f),
            Value::Int(i) => Some(*i as f64),
            _ => None,
        }
    }
    #[inline]
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }
    #[inline]
    pub fn as_list(&self) -> Option<&Rc<Vec<Value>>> {
        match self {
            Value::List(l) => Some(l),
            _ => None,
        }
    }
    #[inline]
    pub fn is_none(&self) -> bool {
        matches!(self, Value::None)
    }

    fn tag(&self) -> u8 {
        match self {
            Value::None => 0,
            Value::Bool(_) => 1,
            Value::Int(_) => 2,
            Value::Float(_) => 3,
            Value::Str(_) => 4,
            Value::IVec2(..) => 5,
            Value::Vec2(..) => 6,
            Value::List(_) => 7,
            Value::Set(_) => 8,
            Value::Map(_) => 9,
            Value::Grid(_) => 10,
            Value::Record(_) => 11,
        }
    }

    /// Feeds the value into a stable (platform-independent) hasher. Used for
    /// `hash(x)` and for the determinism state hash.
    pub fn stable_hash(&self, h: &mut crate::hash::StableHasher) {
        h.write_u8(self.tag());
        match self {
            Value::None => {}
            Value::Bool(b) => h.write_u8(*b as u8),
            Value::Int(i) => h.write_u64(*i as u64),
            Value::Float(f) => h.write_u64(canonical_f64_bits(*f)),
            Value::Str(s) => h.write_str(s),
            Value::IVec2(x, y) => {
                h.write_u64(*x as u32 as u64);
                h.write_u64(*y as u32 as u64);
            }
            Value::Vec2(x, y) => {
                h.write_u64(canonical_f64_bits(*x));
                h.write_u64(canonical_f64_bits(*y));
            }
            Value::List(l) | Value::Record(l) => {
                h.write_u64(l.len() as u64);
                for v in l.iter() {
                    v.stable_hash(h);
                }
            }
            Value::Set(s) => {
                h.write_u64(s.len() as u64);
                for v in s.iter() {
                    v.stable_hash(h);
                }
            }
            Value::Map(m) => {
                h.write_u64(m.len() as u64);
                for (k, v) in m.iter() {
                    k.stable_hash(h);
                    v.stable_hash(h);
                }
            }
            Value::Grid(g) => {
                h.write_u64(g.w as u64);
                h.write_u64(g.h as u64);
                for v in g.cells.iter() {
                    v.stable_hash(h);
                }
            }
        }
    }

    /// JSON view for debugging, CLI output and the WASM `state()` call.
    /// Records become arrays unless field names are supplied by the caller
    /// (`ir::Program::state_to_json` does that).
    pub fn to_json(&self) -> serde_json::Value {
        use serde_json::Value as J;
        match self {
            Value::None => J::Null,
            Value::Bool(b) => J::Bool(*b),
            Value::Int(i) => J::from(*i),
            Value::Float(f) => serde_json::Number::from_f64(*f).map(J::Number).unwrap_or(J::Null),
            Value::Str(s) => J::String(s.to_string()),
            Value::IVec2(x, y) => serde_json::json!([x, y]),
            Value::Vec2(x, y) => serde_json::json!([x, y]),
            Value::List(l) | Value::Record(l) => J::Array(l.iter().map(Value::to_json).collect()),
            Value::Set(s) => J::Array(s.iter().map(Value::to_json).collect()),
            Value::Map(m) => J::Array(m.iter().map(|(k, v)| J::Array(vec![k.to_json(), v.to_json()])).collect()),
            Value::Grid(g) => serde_json::json!({
                "w": g.w, "h": g.h,
                "cells": g.cells.iter().map(Value::to_json).collect::<Vec<_>>(),
            }),
        }
    }
}

/// Collapses -0.0 to 0.0 and all NaNs to one NaN so hashing is canonical.
#[inline]
fn canonical_f64_bits(f: f64) -> u64 {
    if f == 0.0 {
        0
    } else if f.is_nan() {
        0x7ff8_0000_0000_0000
    } else {
        f.to_bits()
    }
}

impl PartialEq for Value {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for Value {}

impl PartialOrd for Value {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Value {
    fn cmp(&self, other: &Self) -> Ordering {
        use Value::*;
        match (self, other) {
            (None, None) => Ordering::Equal,
            (Bool(a), Bool(b)) => a.cmp(b),
            (Int(a), Int(b)) => a.cmp(b),
            (Float(a), Float(b)) => cmp_f64(*a, *b),
            // Mixed int/float should not happen after type checking, but
            // compare numerically for robustness.
            (Int(a), Float(b)) => cmp_f64(*a as f64, *b),
            (Float(a), Int(b)) => cmp_f64(*a, *b as f64),
            (Str(a), Str(b)) => a.cmp(b),
            (IVec2(ax, ay), IVec2(bx, by)) => (ay, ax).cmp(&(by, bx)),
            (Vec2(ax, ay), Vec2(bx, by)) => cmp_f64(*ay, *by).then(cmp_f64(*ax, *bx)),
            (List(a), List(b)) | (Record(a), Record(b)) => {
                if Rc::ptr_eq(a, b) {
                    Ordering::Equal
                } else {
                    a.as_slice().cmp(b.as_slice())
                }
            }
            (Set(a), Set(b)) => {
                if Rc::ptr_eq(a, b) {
                    Ordering::Equal
                } else {
                    a.iter().cmp(b.iter())
                }
            }
            (Map(a), Map(b)) => {
                if Rc::ptr_eq(a, b) {
                    Ordering::Equal
                } else {
                    a.iter().cmp(b.iter())
                }
            }
            (Grid(a), Grid(b)) => {
                if Rc::ptr_eq(a, b) {
                    Ordering::Equal
                } else {
                    (a.h, a.w).cmp(&(b.h, b.w)).then_with(|| a.cells.as_slice().cmp(b.cells.as_slice()))
                }
            }
            _ => self.tag().cmp(&other.tag()),
        }
    }
}

#[inline]
fn cmp_f64(a: f64, b: f64) -> Ordering {
    // -0.0 == 0.0 for equality purposes.
    if a == b {
        Ordering::Equal
    } else {
        a.total_cmp(&b)
    }
}

impl std::hash::Hash for Value {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        let mut h = crate::hash::StableHasher::new();
        self.stable_hash(&mut h);
        state.write_u64(h.finish());
    }
}

/// Formats a float the way `str()` does: integral values print without a
/// decimal point (`2`), others with the shortest round-trip form (`1.5`).
pub fn format_float(f: f64) -> String {
    if f.is_finite() && f == f.trunc() && f.abs() < 1e15 {
        format!("{}", f as i64)
    } else if f.is_nan() {
        "NaN".to_string()
    } else if f.is_infinite() {
        if f > 0.0 { "Infinity".into() } else { "-Infinity".into() }
    } else {
        format!("{f}")
    }
}

/// `Display` implements the `str()` builtin:
/// `true`, `42`, `1.5`, `hello` (no quotes), `(3, 7)`, `[1, 2]`, `{a, b}` for
/// sets, `{k: v}` for maps, `none`. Grids print as nested rows.
impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::None => write!(f, "none"),
            Value::Bool(b) => write!(f, "{b}"),
            Value::Int(i) => write!(f, "{i}"),
            Value::Float(x) => write!(f, "{}", format_float(*x)),
            Value::Str(s) => write!(f, "{s}"),
            Value::IVec2(x, y) => write!(f, "({x}, {y})"),
            Value::Vec2(x, y) => write!(f, "({}, {})", format_float(*x), format_float(*y)),
            Value::List(l) | Value::Record(l) => {
                write!(f, "[")?;
                for (i, v) in l.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "{v}")?;
                }
                write!(f, "]")
            }
            Value::Set(s) => {
                write!(f, "{{")?;
                for (i, v) in s.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "{v}")?;
                }
                write!(f, "}}")
            }
            Value::Map(m) => {
                write!(f, "{{")?;
                for (i, (k, v)) in m.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "{k}: {v}")?;
                }
                write!(f, "}}")
            }
            Value::Grid(g) => {
                write!(f, "[")?;
                for y in 0..g.h {
                    if y > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "[")?;
                    for x in 0..g.w {
                        if x > 0 {
                            write!(f, ", ")?;
                        }
                        write!(f, "{}", g.cells[(y * g.w + x) as usize])?;
                    }
                    write!(f, "]")?;
                }
                write!(f, "]")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structural_equality_and_order() {
        let a = Value::list(vec![Value::Int(1), Value::Int(2)]);
        let b = Value::list(vec![Value::Int(1), Value::Int(2)]);
        assert_eq!(a, b);
        assert!(Value::Int(1) < Value::Int(2));
        assert_eq!(Value::Float(0.0), Value::Float(-0.0));
        assert_eq!(format!("{}", Value::Float(2.0)), "2");
        assert_eq!(format!("{}", Value::Float(1.5)), "1.5");
        assert_eq!(format!("{}", Value::IVec2(3, 7)), "(3, 7)");
    }
}
