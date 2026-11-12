//! Deterministic transcendental functions.
//!
//! `f64::sin`, `cos` and `log2` call the platform's libm, whose last-bit
//! results differ between macOS, Linux and WASM. Game state must hash the
//! same everywhere, so these are ports of the fdlibm/musl kernels that use
//! only IEEE-754 `+ - * /` (correctly rounded on every platform). No FMA.

#![allow(clippy::excessive_precision)]

// fdlibm __kernel_sin coefficients.
const S1: f64 = -1.666_666_666_666_663_243_48e-01;
const S2: f64 = 8.333_333_333_322_489_461_24e-03;
const S3: f64 = -1.984_126_982_985_794_931_34e-04;
const S4: f64 = 2.755_731_370_707_006_767_89e-06;
const S5: f64 = -2.505_076_025_340_686_341_95e-08;
const S6: f64 = 1.589_690_995_211_550_102_21e-10;

// fdlibm __kernel_cos coefficients.
const C1: f64 = 4.166_666_666_666_660_190_37e-02;
const C2: f64 = -1.388_888_888_887_410_957_49e-03;
const C3: f64 = 2.480_158_728_947_672_941_78e-05;
const C4: f64 = -2.755_731_435_139_066_330_35e-07;
const C5: f64 = 2.087_572_321_298_174_827_90e-09;
const C6: f64 = -1.135_964_755_778_819_482_65e-11;

// Cody-Waite split of pi/2 (fdlibm __rem_pio2, medium case).
const INV_PIO2: f64 = std::f64::consts::FRAC_2_PI;
const PIO2_1: f64 = 1.570_796_326_734_125_614_17e+00;
const PIO2_2: f64 = 6.077_100_506_303_965_976_60e-11;
const PIO2_2T: f64 = 2.022_266_248_795_950_631_54e-21;

#[inline]
fn k_sin(x: f64, y: f64, iy: bool) -> f64 {
    let z = x * x;
    let w = z * z;
    let r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
    let v = z * x;
    if !iy {
        x + v * (S1 + z * r)
    } else {
        x - ((z * (0.5 * y - v * r) - y) - v * S1)
    }
}

#[inline]
fn k_cos(x: f64, y: f64) -> f64 {
    let z = x * x;
    let w = z * z;
    let r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
    let hz = 0.5 * z;
    let w = 1.0 - hz;
    w + (((1.0 - w) - hz) + (z * r - x * y))
}

/// Returns `(n mod 4, y0, y1)` with `x ≈ n·π/2 + y0 + y1`, `|y0| <= π/4`.
/// Accurate for the argument range games use (|x| up to ~1e6); beyond that
/// it stays deterministic but loses precision.
#[inline]
fn rem_pio2(x: f64) -> (u8, f64, f64) {
    let t = x.abs();
    let fnum = (t * INV_PIO2 + 0.5).floor();
    let r0 = t - fnum * PIO2_1;
    let w0 = fnum * PIO2_2;
    let r = r0 - w0;
    let w = fnum * PIO2_2T - ((r0 - r) - w0);
    let y0 = r - w;
    let y1 = (r - y0) - w;
    // `fnum` is non-negative and finite here; `as u64` saturates for huge values.
    let n = ((fnum as u64) & 3) as u8;
    if x < 0.0 {
        ((4 - n) & 3, -y0, -y1)
    } else {
        (n, y0, y1)
    }
}

pub fn sin(x: f64) -> f64 {
    if !x.is_finite() {
        return f64::NAN;
    }
    if x.abs() <= std::f64::consts::FRAC_PI_4 {
        if x.abs() < 7.450_580_596_923_828e-9 {
            return x;
        }
        return k_sin(x, 0.0, false);
    }
    let (n, y0, y1) = rem_pio2(x);
    match n {
        0 => k_sin(y0, y1, true),
        1 => k_cos(y0, y1),
        2 => -k_sin(y0, y1, true),
        _ => -k_cos(y0, y1),
    }
}

pub fn cos(x: f64) -> f64 {
    if !x.is_finite() {
        return f64::NAN;
    }
    if x.abs() <= std::f64::consts::FRAC_PI_4 {
        if x.abs() < 7.450_580_596_923_828e-9 {
            return 1.0;
        }
        return k_cos(x, 0.0);
    }
    let (n, y0, y1) = rem_pio2(x);
    match n {
        0 => k_cos(y0, y1),
        1 => -k_sin(y0, y1, true),
        2 => -k_cos(y0, y1),
        _ => k_sin(y0, y1, true),
    }
}

const IVLN2HI: f64 = 1.442_695_040_721_446_275_71e+00;
const IVLN2LO: f64 = 1.675_171_316_488_651_183_53e-10;
const LG1: f64 = 6.666_666_666_666_735_130e-01;
const LG2: f64 = 3.999_999_999_940_941_908e-01;
const LG3: f64 = 2.857_142_874_366_239_149e-01;
const LG4: f64 = 2.222_219_843_214_978_396e-01;
const LG5: f64 = 1.818_357_216_161_805_012e-01;
const LG6: f64 = 1.531_383_769_920_937_332e-01;
const LG7: f64 = 1.479_819_860_511_658_591e-01;

/// musl `log2`. Exact for powers of two; `log2(0) = -inf`, negative → NaN.
pub fn log2(x: f64) -> f64 {
    let mut ui = x.to_bits();
    let mut hx = (ui >> 32) as u32;
    let mut k: i32 = 0;
    if hx < 0x0010_0000 || (hx >> 31) != 0 {
        if ui << 1 == 0 {
            return f64::NEG_INFINITY;
        }
        if hx >> 31 != 0 {
            return f64::NAN;
        }
        // Subnormal: scale up.
        k -= 54;
        ui = (x * 18_014_398_509_481_984.0).to_bits();
        hx = (ui >> 32) as u32;
    } else if hx >= 0x7ff0_0000 {
        return x;
    } else if hx == 0x3ff0_0000 && ui << 32 == 0 {
        return 0.0;
    }
    hx = hx.wrapping_add(0x3ff0_0000 - 0x3fe6_a09e);
    k += (hx >> 20) as i32 - 0x3ff;
    hx = (hx & 0x000f_ffff) + 0x3fe6_a09e;
    ui = ((hx as u64) << 32) | (ui & 0xffff_ffff);
    let x = f64::from_bits(ui);

    let f = x - 1.0;
    let hfsq = 0.5 * f * f;
    let s = f / (2.0 + f);
    let z = s * s;
    let w = z * z;
    let t1 = w * (LG2 + w * (LG4 + w * LG6));
    let t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
    let r = t2 + t1;

    let hi = f64::from_bits((f - hfsq).to_bits() & 0xffff_ffff_0000_0000);
    let lo = f - hi - hfsq + s * (hfsq + r);
    let val_hi = hi * IVLN2HI;
    let mut val_lo = (lo + hi) * IVLN2LO + lo * IVLN2HI;
    let y = k as f64;
    let w = y + val_hi;
    val_lo += (y - w) + val_hi;
    val_lo + w
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_to_std() {
        let mut x = -50.0;
        while x < 50.0 {
            assert!((sin(x) - x.sin()).abs() < 1e-15, "sin({x})");
            assert!((cos(x) - x.cos()).abs() < 1e-15, "cos({x}) = {} vs {}", cos(x), x.cos());
            x += 0.0137;
        }
        for i in 1..2000 {
            let x = i as f64 * 0.731;
            assert!((log2(x) - x.log2()).abs() < 1e-14, "log2({x})");
        }
        for k in -1022..1024 {
            assert_eq!(log2(2f64.powi(k)), k as f64);
        }
        assert_eq!(log2(f64::from_bits(1)), -1074.0);
        assert_eq!(log2(0.0), f64::NEG_INFINITY);
        assert!(log2(-1.0).is_nan());
        assert_eq!(sin(0.0), 0.0);
        assert_eq!(cos(0.0), 1.0);
        assert!(sin(f64::INFINITY).is_nan());
    }
}
