//! Easing, transitions (tweens) and `animate_on` keyframes.
//!
//! Time is the player's presentation clock in ms (advanced by `Player::step`,
//! independent of game time so end-of-game motion still finishes).

use mg_core::color::{self, Rgba};
use mg_core::scene::Ease;

/// An animatable prop value: a number or an RGBA color.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PV {
    N(f64),
    C(Rgba),
}

impl PV {
    pub fn num(self) -> f64 {
        match self {
            PV::N(v) => v,
            PV::C(c) => c as f64,
        }
    }
    pub fn color(self) -> Rgba {
        match self {
            PV::C(c) => c,
            PV::N(v) => v as Rgba,
        }
    }
}

/// Maps linear progress `t` in `[0, 1]` through an easing curve. Cubic in /
/// out / in-out; `Spring` is back-out (overshoots ~10% then settles).
pub fn ease(e: Ease, t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    match e {
        Ease::Linear => t,
        Ease::In => t * t * t,
        Ease::Out => {
            let u = 1.0 - t;
            1.0 - u * u * u
        }
        Ease::InOut => {
            if t < 0.5 {
                4.0 * t * t * t
            } else {
                let u = -2.0 * t + 2.0;
                1.0 - u * u * u / 2.0
            }
        }
        Ease::Spring => {
            const C1: f64 = 1.70158;
            const C3: f64 = C1 + 1.0;
            let u = t - 1.0;
            1.0 + C3 * u * u * u + C1 * u * u
        }
    }
}

/// Numbers interpolate linearly (overshoot allowed for `Spring`); colors
/// interpolate per RGBA channel (clamped). Mismatched kinds snap at `t >= 1`.
pub fn lerp_pv(a: PV, b: PV, t: f64) -> PV {
    match (a, b) {
        (PV::N(x), PV::N(y)) => PV::N(x + (y - x) * t),
        (PV::C(x), PV::C(y)) => PV::C(color::lerp(x, y, t)),
        _ => {
            if t >= 1.0 {
                b
            } else {
                a
            }
        }
    }
}

/// A transition on one prop of one node instance. Also remembers the last
/// target so a change can be detected.
#[derive(Clone, Debug)]
pub struct Tween {
    pub from: PV,
    pub to: PV,
    pub start: f64,
    pub ms: f64,
    pub ease: Ease,
    /// Build generation that last touched it (for garbage collection).
    pub seen: u32,
}

impl Tween {
    /// First appearance: no tween, just the value.
    pub fn settled(v: PV, seen: u32) -> Tween {
        Tween { from: v, to: v, start: f64::NEG_INFINITY, ms: 0.0, ease: Ease::Linear, seen }
    }

    pub fn end(&self) -> f64 {
        self.start + self.ms
    }

    pub fn value(&self, now: f64) -> PV {
        if self.ms <= 0.0 || now >= self.start + self.ms {
            return self.to;
        }
        let p = ((now - self.start) / self.ms).max(0.0);
        lerp_pv(self.from, self.to, ease(self.ease, p))
    }

    /// Starts a tween from the currently displayed value to `to`.
    pub fn retarget(&mut self, to: PV, now: f64, ms: f64, ease: Ease) {
        self.from = self.value(now);
        self.to = to;
        self.start = now;
        self.ms = ms.max(0.0);
        self.ease = ease;
    }
}

/// A running `animate_on` keyframe animation on one prop of one instance.
#[derive(Clone, Debug)]
pub struct Anim {
    /// Index into the node's `animate_on` list.
    pub idx: u16,
    pub start: f64,
    pub ms: f64,
    pub seen: u32,
}

/// Samples keyframes spread evenly over `[0, 1]` at progress `p`. The ease
/// applies per segment (like CSS keyframes).
pub fn sample_keys(keys: &[PV], e: Ease, p: f64) -> PV {
    match keys.len() {
        0 => PV::N(0.0),
        1 => keys[0],
        n => {
            let p = p.clamp(0.0, 1.0);
            if p >= 1.0 {
                return keys[n - 1];
            }
            let seg = p * (n - 1) as f64;
            let i = (seg.floor() as usize).min(n - 2);
            let local = seg - i as f64;
            lerp_pv(keys[i], keys[i + 1], ease(e, local))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn easing_endpoints_and_shape() {
        for e in [Ease::Linear, Ease::In, Ease::Out, Ease::InOut, Ease::Spring] {
            assert!(close(ease(e, 0.0), 0.0), "{e:?}");
            assert!(close(ease(e, 1.0), 1.0), "{e:?}");
        }
        assert!(close(ease(Ease::Linear, 0.25), 0.25));
        assert!(close(ease(Ease::In, 0.5), 0.125));
        assert!(close(ease(Ease::Out, 0.5), 0.875));
        assert!(close(ease(Ease::InOut, 0.5), 0.5));
        assert!(ease(Ease::InOut, 0.25) < 0.25);
        // Back-out overshoots past 1 before settling.
        assert!((0..100).map(|i| ease(Ease::Spring, i as f64 / 100.0)).any(|v| v > 1.05));
    }

    #[test]
    fn color_lerp_rgba() {
        let a = PV::C(0x0000_00FF);
        let b = PV::C(0xFF80_4000);
        assert_eq!(lerp_pv(a, b, 0.0), a);
        assert_eq!(lerp_pv(a, b, 1.0), b);
        assert_eq!(lerp_pv(a, b, 0.5), PV::C(0x8040_2080));
        // Overshooting ease clamps colors.
        assert_eq!(lerp_pv(a, b, 1.2), b);
    }

    #[test]
    fn tween_interpolates_and_retargets_from_displayed() {
        let mut t = Tween::settled(PV::N(0.0), 0);
        assert_eq!(t.value(5.0), PV::N(0.0));
        t.retarget(PV::N(100.0), 0.0, 100.0, Ease::Linear);
        assert_eq!(t.value(0.0), PV::N(0.0));
        assert_eq!(t.value(25.0), PV::N(25.0));
        assert_eq!(t.value(100.0), PV::N(100.0));
        assert_eq!(t.value(1e9), PV::N(100.0));
        // Retarget mid-flight starts at the displayed value.
        t.retarget(PV::N(0.0), 50.0, 100.0, Ease::Linear);
        assert_eq!(t.from, PV::N(50.0));
        assert_eq!(t.value(100.0), PV::N(25.0));
        // Ease out is ahead of linear at the midpoint.
        let mut c = Tween::settled(PV::C(0x0000_00FF), 0);
        c.retarget(PV::C(0xFFFF_FFFF), 0.0, 120.0, Ease::Out);
        let mid = c.value(60.0).color();
        assert!((mid >> 24) > 0x80, "{mid:08x}");
        assert_eq!(c.value(120.0), PV::C(0xFFFF_FFFF));
    }

    #[test]
    fn keyframe_timing() {
        let keys = [PV::N(1.0), PV::N(1.12), PV::N(1.0)];
        assert_eq!(sample_keys(&keys, Ease::Linear, 0.0), PV::N(1.0));
        assert!(close(sample_keys(&keys, Ease::Linear, 0.5).num(), 1.12));
        assert!(close(sample_keys(&keys, Ease::Linear, 0.25).num(), 1.06));
        assert!(close(sample_keys(&keys, Ease::Linear, 0.75).num(), 1.06));
        assert_eq!(sample_keys(&keys, Ease::Linear, 1.0), PV::N(1.0));
        // Per-segment easing: ease-out reaches most of the way in the first half of a segment.
        assert!(sample_keys(&keys, Ease::Out, 0.25).num() > 1.1);
        let four = [PV::N(0.0), PV::N(3.0), PV::N(6.0), PV::N(9.0)];
        assert!(close(sample_keys(&four, Ease::Linear, 1.0 / 3.0).num(), 3.0));
        assert!(close(sample_keys(&four, Ease::Linear, 0.5).num(), 4.5));
        assert_eq!(sample_keys(&[PV::N(2.0)], Ease::Out, 0.3), PV::N(2.0));
    }
}
