//! Seeded deterministic RNG (xoshiro256**, seeded via splitmix64).
//! The only source of randomness in the engine. Same seed + same inputs =
//! same game, on every platform.

use crate::hash::splitmix64;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rng {
    s: [u64; 4],
}

impl Rng {
    pub fn new(seed: u64) -> Rng {
        let mut x = seed;
        let mut s = [0u64; 4];
        for slot in s.iter_mut() {
            x = x.wrapping_add(0x9e37_79b9_7f4a_7c15);
            *slot = splitmix64(x);
        }
        if s == [0; 4] {
            s[0] = 1;
        }
        Rng { s }
    }

    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        let result = self.s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);
        result
    }

    /// Uniform float in `[0, 1)`.
    #[inline]
    pub fn next_f64(&mut self) -> f64 {
        crate::hash::unit_f64(self.next_u64())
    }

    /// Uniform integer in `[0, n)`. `n` must be > 0. Unbiased (Lemire).
    #[inline]
    pub fn below(&mut self, n: u64) -> u64 {
        debug_assert!(n > 0);
        let mut m = (self.next_u64() as u128) * (n as u128);
        let mut lo = m as u64;
        if lo < n {
            let threshold = n.wrapping_neg() % n;
            while lo < threshold {
                m = (self.next_u64() as u128) * (n as u128);
                lo = m as u64;
            }
        }
        (m >> 64) as u64
    }

    /// Uniform integer in `[a, b]` (inclusive). If `b < a` the bounds are swapped.
    pub fn range_inclusive(&mut self, a: i64, b: i64) -> i64 {
        let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
        let span = (hi as i128 - lo as i128 + 1) as u128;
        if span > u64::MAX as u128 {
            return self.next_u64() as i64;
        }
        lo.wrapping_add(self.below(span as u64) as i64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deterministic() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..100 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
        let mut r = Rng::new(1);
        for _ in 0..1000 {
            let v = r.range_inclusive(-3, 3);
            assert!((-3..=3).contains(&v));
        }
    }
}
