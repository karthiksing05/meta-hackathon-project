//! Text measurement without a font engine.
//!
//! The engine has no access to real font metrics (it runs headless and in
//! WASM), so unboxed text is measured with a fixed approximation that is good
//! enough for centering titles and labels in stacks:
//!
//! * width  ≈ chars × size × 0.6, × 1.05 when weight ≥ 600 (widest line);
//! * height ≈ lines × size × 1.25.
//!
//! The shell draws the text inside this box using `align` / `valign`, so a
//! small error only shifts where the box sits, not how the glyphs align.

pub const CHAR_WIDTH_EM: f64 = 0.6;
pub const BOLD_FACTOR: f64 = 1.05;
pub const LINE_HEIGHT_EM: f64 = 1.25;

/// Returns `(w, h)` of the measured text box.
pub fn measure_text(text: &str, size: f64, weight: u16) -> (f64, f64) {
    let mut lines = 0usize;
    let mut widest = 0usize;
    for line in text.split('\n') {
        lines += 1;
        widest = widest.max(line.chars().count());
    }
    let mut w = widest as f64 * size * CHAR_WIDTH_EM;
    if weight >= 600 {
        w *= BOLD_FACTOR;
    }
    (w, lines as f64 * size * LINE_HEIGHT_EM)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn measures() {
        let (w, h) = measure_text("LIGHTS OUT", 40.0, 700);
        assert!((w - 10.0 * 40.0 * 0.6 * 1.05).abs() < 1e-9);
        assert!((h - 50.0).abs() < 1e-9);
        let (w, h) = measure_text("ab\nabcd", 10.0, 400);
        assert!((w - 24.0).abs() < 1e-9);
        assert!((h - 25.0).abs() < 1e-9);
        assert_eq!(measure_text("", 16.0, 400).0, 0.0);
    }
}
