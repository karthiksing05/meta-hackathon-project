//! Small PCG32 generator. Deterministic across native and wasm.

#[derive(Clone, Copy, Debug)]
pub struct Rng {
    state: u64,
    inc: u64,
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        let mut r = Rng { state: 0, inc: (54u64 << 1) | 1 };
        r.next_u32();
        r.state = r.state.wrapping_add(seed as u64);
        r.next_u32();
        r
    }

    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(6364136223846793005).wrapping_add(self.inc);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        xorshifted.rotate_right(rot)
    }

    /// Uniform in `0..n` (rejection sampling, no modulo bias).
    pub fn below(&mut self, n: u32) -> u32 {
        if n <= 1 {
            return 0;
        }
        let threshold = n.wrapping_neg() % n;
        loop {
            let r = self.next_u32();
            if r >= threshold {
                return r % n;
            }
        }
    }

    /// Uniform in `lo..=hi`.
    pub fn range_inclusive(&mut self, lo: i64, hi: i64) -> i64 {
        if hi <= lo {
            return lo;
        }
        let span = ((hi as i128 - lo as i128 + 1).min(u32::MAX as i128)) as u32;
        lo + self.below(span) as i64
    }

    /// Fisher-Yates shuffle.
    pub fn shuffle<T>(&mut self, v: &mut [T]) {
        for i in (1..v.len()).rev() {
            let j = self.below(i as u32 + 1) as usize;
            v.swap(i, j);
        }
    }
}
