//! Stable, platform-independent 64-bit hashing (FNV-1a over a word stream,
//! finished with a splitmix64 avalanche). Used for `hash(x)` and for state
//! hashes in determinism tests. Never use `std`'s `DefaultHasher` for anything
//! observable: it is randomly seeded.

#[derive(Clone, Debug)]
pub struct StableHasher {
    state: u64,
}

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

impl Default for StableHasher {
    fn default() -> Self {
        Self::new()
    }
}

impl StableHasher {
    pub fn new() -> Self {
        StableHasher { state: FNV_OFFSET }
    }
    #[inline]
    pub fn write_u8(&mut self, b: u8) {
        self.state ^= b as u64;
        self.state = self.state.wrapping_mul(FNV_PRIME);
    }
    #[inline]
    pub fn write_u64(&mut self, v: u64) {
        // Mix a whole word at a time (faster than byte-wise FNV, still stable).
        self.state ^= v;
        self.state = self.state.wrapping_mul(FNV_PRIME).rotate_left(29);
    }
    #[inline]
    pub fn write_str(&mut self, s: &str) {
        self.write_u64(s.len() as u64);
        for b in s.bytes() {
            self.write_u8(b);
        }
    }
    #[inline]
    pub fn finish(&self) -> u64 {
        splitmix64(self.state)
    }
}

#[inline]
pub fn splitmix64(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9e37_79b9_7f4a_7c15);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

/// Maps a 64-bit hash to a float in `[0, 1)` (53 bits of precision).
#[inline]
pub fn unit_f64(h: u64) -> f64 {
    (h >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
}
