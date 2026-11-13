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

// fdlibm/musl `log` (natural), same reduction as `log2` above.
const LN2_HI: f64 = 6.931_471_803_691_238_164_90e-01;
const LN2_LO: f64 = 1.908_214_929_270_587_700_02e-10;

/// musl `log`. `log(0) = -inf`, negative → NaN.
pub fn log(x: f64) -> f64 {
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
    let dk = k as f64;
    s * (hfsq + r) + dk * LN2_LO - hfsq + f + dk * LN2_HI
}

/// musl `scalbn`: `y * 2^n`, exact except for over/underflow.
fn scalbn(mut y: f64, mut n: i32) -> f64 {
    let p1023 = f64::from_bits(0x7fe0_0000_0000_0000); // 2^1023
    let pm969 = f64::from_bits(0x0360_0000_0000_0000); // 2^-1022 * 2^53
    if n > 1023 {
        y *= p1023;
        n -= 1023;
        if n > 1023 {
            y *= p1023;
            n -= 1023;
            if n > 1023 {
                n = 1023;
            }
        }
    } else if n < -1022 {
        y *= pm969;
        n += 1022 - 53;
        if n < -1022 {
            y *= pm969;
            n += 1022 - 53;
            if n < -1022 {
                n = -1022;
            }
        }
    }
    y * f64::from_bits(((0x3ff + n) as u64) << 52)
}

const INVLN2: f64 = std::f64::consts::LOG2_E;
const EP1: f64 = 1.666_666_666_666_660_190_37e-01;
const EP2: f64 = -2.777_777_777_701_559_338_42e-03;
const EP3: f64 = 6.613_756_321_437_934_361_17e-05;
const EP4: f64 = -1.653_390_220_546_525_153_90e-06;
const EP5: f64 = 4.138_136_797_057_238_460_39e-08;

/// musl `exp`.
pub fn exp(mut x: f64) -> f64 {
    let top = (x.to_bits() >> 32) as u32;
    let sign = (top >> 31) as i32;
    let hx = top & 0x7fff_ffff;
    if hx >= 0x4086_232b {
        if x.is_nan() {
            return x;
        }
        if x > 709.782_712_893_383_973_096 {
            return f64::INFINITY;
        }
        if x < -745.133_219_101_941_108_42 {
            return 0.0;
        }
    }
    let (hi, lo, k): (f64, f64, i32);
    if hx > 0x3fd6_2e42 {
        k = if hx >= 0x3ff0_a2b2 {
            (INVLN2 * x + if sign == 0 { 0.5 } else { -0.5 }) as i32
        } else {
            1 - sign - sign
        };
        hi = x - k as f64 * LN2_HI;
        lo = k as f64 * LN2_LO;
        x = hi - lo;
    } else if hx > 0x3e30_0000 {
        k = 0;
        hi = x;
        lo = 0.0;
    } else {
        return 1.0 + x;
    }
    let xx = x * x;
    let c = x - xx * (EP1 + xx * (EP2 + xx * (EP3 + xx * (EP4 + xx * EP5))));
    let y = 1.0 + (x * c / (2.0 - c) - lo + hi);
    if k == 0 {
        y
    } else {
        scalbn(y, k)
    }
}

fn is_int(y: f64) -> bool {
    y.is_finite() && y == y.trunc()
}

fn is_odd_int(y: f64) -> bool {
    // Every float >= 2^53 is even.
    is_int(y) && y.abs() < 9_007_199_254_740_992.0 && (y as i64) & 1 == 1
}

/// Deterministic `pow`. Integer exponents up to 64 use exact-as-possible
/// repeated squaring (`pow(3, 2) == 9`), `y == 0.5` is `sqrt`, and the rest
/// is `exp(y * log(|x|))`: relative error about `|y * ln x| + 2` ulp. C99
/// special cases.
pub fn pow(x: f64, y: f64) -> f64 {
    if y == 0.0 || x == 1.0 {
        return 1.0;
    }
    if x.is_nan() || y.is_nan() {
        return f64::NAN;
    }
    if is_int(y) && y.abs() <= 64.0 {
        let mut n = y.abs() as u32;
        let mut b = x;
        let mut r = 1.0;
        loop {
            if n & 1 == 1 {
                r *= b;
            }
            n >>= 1;
            if n == 0 {
                break;
            }
            b *= b;
        }
        return if y < 0.0 { 1.0 / r } else { r };
    }
    if y.is_infinite() {
        let ax = x.abs();
        return if ax == 1.0 {
            1.0
        } else if (ax < 1.0) == (y > 0.0) {
            0.0
        } else {
            f64::INFINITY
        };
    }
    if x == 0.0 || x.is_infinite() {
        // |x| is 0 or inf; y is finite and not a small integer.
        let big = (x == 0.0) == (y < 0.0);
        let neg = x.is_sign_negative() && is_odd_int(y);
        return match (big, neg) {
            (true, false) => f64::INFINITY,
            (true, true) => f64::NEG_INFINITY,
            (false, false) => 0.0,
            (false, true) => -0.0,
        };
    }
    if x < 0.0 {
        if !is_int(y) {
            return f64::NAN;
        }
        let r = exp(y * log(-x));
        return if is_odd_int(y) { -r } else { r };
    }
    if y == 0.5 {
        return x.sqrt();
    }
    exp(y * log(x))
}

const ATANHI: [f64; 4] = [
    4.636_476_090_008_060_935_15e-01,
    std::f64::consts::FRAC_PI_4,
    9.827_937_232_473_290_540_82e-01,
    std::f64::consts::FRAC_PI_2,
];
const ATANLO: [f64; 4] = [
    2.269_877_745_296_168_709_24e-17,
    3.061_616_997_868_383_017_93e-17,
    1.390_331_103_123_099_845_16e-17,
    6.123_233_995_736_766_035_87e-17,
];
const AT: [f64; 11] = [
    3.333_333_333_333_293_180_27e-01,
    -1.999_999_999_987_648_324_76e-01,
    1.428_571_427_250_346_637_11e-01,
    -1.111_111_040_546_235_578_80e-01,
    9.090_887_133_436_506_561_96e-02,
    -7.691_876_205_044_829_994_95e-02,
    6.661_073_137_387_531_206_69e-02,
    -5.833_570_133_790_573_486_45e-02,
    4.976_877_994_615_932_360_17e-02,
    -3.653_157_274_421_691_552_70e-02,
    1.628_582_011_536_578_236_23e-02,
];

/// fdlibm `atan`.
pub fn atan(x: f64) -> f64 {
    let top = (x.to_bits() >> 32) as u32;
    let neg = top >> 31 != 0;
    let ix = top & 0x7fff_ffff;
    if ix >= 0x4410_0000 {
        if x.is_nan() {
            return x;
        }
        let z = ATANHI[3] + ATANLO[3];
        return if neg { -z } else { z };
    }
    let id: i32;
    let mut x = x;
    if ix < 0x3fdc_0000 {
        if ix < 0x3e40_0000 {
            return x;
        }
        id = -1;
    } else {
        x = x.abs();
        if ix < 0x3ff3_0000 {
            if ix < 0x3fe6_0000 {
                id = 0;
                x = (2.0 * x - 1.0) / (2.0 + x);
            } else {
                id = 1;
                x = (x - 1.0) / (x + 1.0);
            }
        } else if ix < 0x4003_8000 {
            id = 2;
            x = (x - 1.5) / (1.0 + 1.5 * x);
        } else {
            id = 3;
            x = -1.0 / x;
        }
    }
    let z = x * x;
    let w = z * z;
    let s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
    let s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
    if id < 0 {
        return x - x * (s1 + s2);
    }
    let i = id as usize;
    let z = ATANHI[i] - ((x * (s1 + s2) - ATANLO[i]) - x);
    if neg {
        -z
    } else {
        z
    }
}

const PI: f64 = std::f64::consts::PI;
const PI_LO: f64 = 1.224_646_799_147_353_177_2e-16;

/// fdlibm `atan2(y, x)`, in `[-pi, pi]`.
pub fn atan2(y: f64, x: f64) -> f64 {
    if x.is_nan() || y.is_nan() {
        return x + y;
    }
    if x == 1.0 {
        return atan(y);
    }
    let y_neg = y.is_sign_negative();
    let x_neg = x.is_sign_negative();
    if y == 0.0 {
        return match (x_neg, y_neg) {
            (false, _) => y,
            (true, false) => PI,
            (true, true) => -PI,
        };
    }
    let half_pi = if y_neg { -PI / 2.0 } else { PI / 2.0 };
    if x == 0.0 {
        return half_pi;
    }
    if x.is_infinite() {
        let z = if y.is_infinite() {
            if x_neg { 3.0 * PI / 4.0 } else { PI / 4.0 }
        } else if x_neg {
            PI
        } else {
            0.0
        };
        return if y_neg { -z } else { z };
    }
    let ix = ((x.to_bits() >> 32) as u32) & 0x7fff_ffff;
    let iy = ((y.to_bits() >> 32) as u32) & 0x7fff_ffff;
    if ix.wrapping_add(64 << 20) < iy || y.is_infinite() {
        return half_pi;
    }
    let z = if x_neg && ix > iy.wrapping_add(64 << 20) { 0.0 } else { atan((y / x).abs()) };
    match (x_neg, y_neg) {
        (false, false) => z,
        (false, true) => -z,
        (true, false) => PI - (z - PI_LO),
        (true, true) => (z - PI_LO) - PI,
    }
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

    fn close(a: f64, b: f64, rel: f64) -> bool {
        a == b || (a - b).abs() <= rel * b.abs().max(f64::MIN_POSITIVE)
    }

    #[test]
    fn exp_log_pow_atan_close_to_std() {
        let mut x = -30.0;
        while x < 30.0 {
            assert!(close(atan(x), x.atan(), 5e-16), "atan({x}) {} vs {}", atan(x), x.atan());
            assert!(close(exp(x), x.exp(), 5e-16), "exp({x}) {} vs {}", exp(x), x.exp());
            for yy in [-3.7, -1.0, -0.3, 0.0, 0.25, 1.0, 2.5, 7.0] {
                assert!(close(atan2(yy, x), yy.atan2(x), 5e-16), "atan2({yy}, {x})");
                assert!(close(atan2(x, yy), x.atan2(yy), 5e-16), "atan2({x}, {yy})");
            }
            x += 0.0731;
        }
        for i in 1..3000 {
            let x = i as f64 * 0.0731;
            assert!(close(log(x), x.ln(), 5e-16), "log({x})");
            for y in [-2.5, -0.5, 0.3, 0.5, 1.5, 3.3, 10.7, 100.0, -70.0] {
                assert!(close(pow(x, y), x.powf(y), (y * x.ln()).abs().max(4.0) * 4e-16), "pow({x}, {y}) = {} vs {}", pow(x, y), x.powf(y));
            }
        }
        assert_eq!(exp(0.0), 1.0);
        assert_eq!(exp(f64::INFINITY), f64::INFINITY);
        assert_eq!(exp(f64::NEG_INFINITY), 0.0);
        assert_eq!(exp(1000.0), f64::INFINITY);
        assert!(close(exp(-740.0), (-740f64).exp(), 1e-3));
        assert_eq!(log(1.0), 0.0);
        assert_eq!(log(0.0), f64::NEG_INFINITY);
        assert!(log(-1.0).is_nan());
        assert_eq!(pow(3.0, 2.0), 9.0);
        assert_eq!(pow(2.0, 10.0), 1024.0);
        assert_eq!(pow(2.0, -2.0), 0.25);
        assert_eq!(pow(-2.0, 3.0), -8.0);
        assert_eq!(pow(9.0, 0.5), 3.0);
        assert_eq!(pow(0.0, 0.0), 1.0);
        assert_eq!(pow(0.0, -1.0), f64::INFINITY);
        assert_eq!(pow(0.0, 2.5), 0.0);
        assert_eq!(pow(0.0, -2.5), f64::INFINITY);
        assert!(pow(-8.0, 1.0 / 3.0).is_nan());
        assert!(close(pow(-2.0, 101.0), -(2f64.powi(101)), 1e-13));
        assert!(close(pow(-2.0, 100.0), 2f64.powi(100), 1e-13));
        assert_eq!(pow(0.5, f64::INFINITY), 0.0);
        assert_eq!(pow(2.0, f64::INFINITY), f64::INFINITY);
        assert_eq!(pow(-1.0, f64::INFINITY), 1.0);
        assert_eq!(pow(f64::INFINITY, -0.5), 0.0);
        assert_eq!(pow(f64::NEG_INFINITY, 3.5), f64::INFINITY);
        assert_eq!(pow(f64::NEG_INFINITY, 101.0), f64::NEG_INFINITY);
        assert_eq!(atan2(0.0, -1.0), PI);
        assert_eq!(atan2(-0.0, -1.0), -PI);
        assert_eq!(atan2(1.0, 0.0), PI / 2.0);
        assert_eq!(atan2(0.0, 0.0), 0.0);
        assert_eq!(atan2(1.0, 1.0), std::f64::consts::FRAC_PI_4);
        assert_eq!(atan2(f64::INFINITY, f64::NEG_INFINITY), 3.0 * PI / 4.0);
    }
}
