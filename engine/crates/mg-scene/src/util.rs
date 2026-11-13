//! Small helpers: instance keys, a no-op hasher for pre-mixed `u64` keys,
//! and axis-aligned bounds.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

use mg_core::hash::{splitmix64, StableHasher};
use mg_core::scene::PropName;
use mg_core::Value;

/// Hasher for keys that are already well mixed (`splitmix64` output).
#[derive(Default, Clone, Copy)]
pub struct IdHasher(u64);

impl Hasher for IdHasher {
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = self.0.rotate_left(8) ^ b as u64;
        }
    }
    #[inline]
    fn write_u64(&mut self, v: u64) {
        self.0 = v;
    }
}

pub type KeyMap<V> = HashMap<u64, V, BuildHasherDefault<IdHasher>>;

#[inline]
pub fn mix(a: u64, b: u64) -> u64 {
    splitmix64(a ^ splitmix64(b))
}

/// Instance context of a grid cell / repeat item nested in `ctx`.
#[inline]
pub fn child_ctx(ctx: u64, node: u32, local: u64) -> u64 {
    mix(mix(ctx, node as u64 + 1), local)
}

#[inline]
pub fn cell_local(x: i32, y: i32) -> u64 {
    ((x as u32 as u64) << 32) | (y as u32 as u64)
}

pub fn value_hash(v: &Value) -> u64 {
    let mut h = StableHasher::new();
    v.stable_hash(&mut h);
    h.finish()
}

/// Key of one prop of one node instance (tween / animation maps).
#[inline]
pub fn prop_key(node: u32, ctx: u64, prop: PropName) -> u64 {
    mix(ctx, ((node as u64) << 8) | prop as u64)
}

#[inline]
pub fn prop_bit(p: PropName) -> u16 {
    1u16 << (p as u16)
}

/// Axis-aligned box `[x0, x1] x [y0, y1]`. Empty when `x0 > x1`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl Bounds {
    pub const EMPTY: Bounds = Bounds { x0: f64::INFINITY, y0: f64::INFINITY, x1: f64::NEG_INFINITY, y1: f64::NEG_INFINITY };

    pub fn new(x0: f64, y0: f64, x1: f64, y1: f64) -> Bounds {
        Bounds { x0, y0, x1, y1 }
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        !(self.x0 <= self.x1 && self.y0 <= self.y1)
    }
    pub fn union(self, o: Bounds) -> Bounds {
        if o.is_empty() {
            return self;
        }
        if self.is_empty() {
            return o;
        }
        Bounds { x0: self.x0.min(o.x0), y0: self.y0.min(o.y0), x1: self.x1.max(o.x1), y1: self.y1.max(o.y1) }
    }
    pub fn shift(self, dx: f64, dy: f64) -> Bounds {
        if self.is_empty() {
            return self;
        }
        Bounds { x0: self.x0 + dx, y0: self.y0 + dy, x1: self.x1 + dx, y1: self.y1 + dy }
    }
    /// Empty bounds become a zero-size box at the origin (for stack layout).
    pub fn or_zero(self) -> Bounds {
        if self.is_empty() {
            Bounds::new(0.0, 0.0, 0.0, 0.0)
        } else {
            self
        }
    }
    pub fn w(&self) -> f64 {
        if self.is_empty() { 0.0 } else { self.x1 - self.x0 }
    }
    pub fn h(&self) -> f64 {
        if self.is_empty() { 0.0 } else { self.y1 - self.y0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_union_and_empty() {
        let a = Bounds::new(0.0, 0.0, 10.0, 5.0);
        assert!(Bounds::EMPTY.is_empty());
        assert_eq!(Bounds::EMPTY.union(a), a);
        assert_eq!(a.union(Bounds::new(-8.0, -8.0, 2.0, 2.0)), Bounds::new(-8.0, -8.0, 10.0, 5.0));
        assert_eq!(a.shift(1.0, 2.0), Bounds::new(1.0, 2.0, 11.0, 7.0));
        assert_eq!(Bounds::EMPTY.or_zero().w(), 0.0);
    }
    #[test]
    fn keys_differ() {
        let a = prop_key(1, child_ctx(0, 2, cell_local(0, 1)), PropName::Fill);
        let b = prop_key(1, child_ctx(0, 2, cell_local(1, 0)), PropName::Fill);
        let c = prop_key(1, child_ctx(0, 2, cell_local(0, 1)), PropName::Scale);
        assert_ne!(a, b);
        assert_ne!(a, c);
    }
}
