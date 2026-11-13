//! Color parsing. Colors are packed as `0xRRGGBBAA`.

pub type Rgba = u32;

/// Parses `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`, `transparent`, and a few
/// CSS names (`black white red green blue yellow orange purple gray grey`).
/// Returns `None` for anything else.
pub fn parse_color(s: &str) -> Option<Rgba> {
    let s = s.trim();
    if let Some(hex) = s.strip_prefix('#') {
        let digits: Option<Vec<u32>> = hex.chars().map(|c| c.to_digit(16)).collect();
        let d = digits?;
        return match d.len() {
            3 => Some(((d[0] * 17) << 24) | ((d[1] * 17) << 16) | ((d[2] * 17) << 8) | 0xff),
            4 => Some(((d[0] * 17) << 24) | ((d[1] * 17) << 16) | ((d[2] * 17) << 8) | (d[3] * 17)),
            6 => Some((((d[0] << 20) | (d[1] << 16) | (d[2] << 12) | (d[3] << 8) | (d[4] << 4) | d[5]) << 8) | 0xff),
            8 => Some(d.iter().fold(0u32, |acc, v| (acc << 4) | v)),
            _ => None,
        };
    }
    Some(match s.to_ascii_lowercase().as_str() {
        "transparent" | "none" => 0x0000_0000,
        "black" => 0x0000_00ff,
        "white" => 0xffff_ffff,
        "red" => 0xff00_00ff,
        "green" => 0x0080_00ff,
        "blue" => 0x0000_ffff,
        "yellow" => 0xffff_00ff,
        "orange" => 0xffa5_00ff,
        "purple" => 0x8000_80ff,
        "gray" | "grey" => 0x8080_80ff,
        _ => return None,
    })
}

/// `#RRGGBB` when opaque, `#RRGGBBAA` otherwise.
pub fn to_hex(c: Rgba) -> String {
    if c & 0xff == 0xff {
        format!("#{:06X}", c >> 8)
    } else {
        format!("#{:08X}", c)
    }
}

/// Linear interpolation in RGBA space, `t` in `[0, 1]`.
pub fn lerp(a: Rgba, b: Rgba, t: f64) -> Rgba {
    let t = t.clamp(0.0, 1.0);
    let mut out = 0u32;
    for shift in [24, 16, 8, 0] {
        let ca = ((a >> shift) & 0xff) as f64;
        let cb = ((b >> shift) & 0xff) as f64;
        let c = (ca + (cb - ca) * t).round().clamp(0.0, 255.0) as u32;
        out |= c << shift;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses() {
        assert_eq!(parse_color("#E4572E"), Some(0xE457_2EFF));
        assert_eq!(parse_color("#fff"), Some(0xFFFF_FFFF));
        assert_eq!(to_hex(0xE457_2EFF), "#E4572E");
        assert_eq!(parse_color("nope"), None);
    }
}
