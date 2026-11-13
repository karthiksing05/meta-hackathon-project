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

/// Width of one character in canvas units.
#[inline]
pub fn char_width(size: f64, weight: u16) -> f64 {
    size * CHAR_WIDTH_EM * if weight >= 600 { BOLD_FACTOR } else { 1.0 }
}

/// v0.2.1 `wrap: true`: breaks `text` into lines no wider than `w` with the
/// same approximation. Each `\n` starts a new line; within a line, words
/// (split at spaces) are placed greedily. Spaces inside a line are kept, the
/// spaces at a break are dropped. A word longer than a whole line is split
/// at the line width. Returns the lines joined with `\n` and the line count.
pub fn wrap_text(text: &str, w: f64, size: f64, weight: u16) -> (String, usize) {
    let cw = char_width(size, weight);
    let max = if cw > 0.0 && w.is_finite() { (w / cw + 1e-9).floor().max(1.0) as usize } else { usize::MAX };
    let mut out = String::with_capacity(text.len() + 8);
    let mut lines = 0usize;
    for para in text.split('\n') {
        if lines > 0 {
            out.push('\n');
        }
        lines += 1;
        let mut len = 0usize; // chars on the current line
        let mut started = false; // the current line holds a word
        let mut spaces = 0usize; // extra spaces before the next word
        for word in para.split(' ') {
            if word.is_empty() {
                spaces += 1;
                continue;
            }
            let mut n = word.chars().count();
            // Spaces before the word: the separator plus any extra ones (or
            // the paragraph's indentation).
            let sep = if started { spaces + 1 } else { spaces };
            spaces = 0;
            if len + sep + n <= max {
                for _ in 0..sep {
                    out.push(' ');
                }
                out.push_str(word);
                len += sep + n;
                started = true;
                continue;
            }
            if started {
                out.push('\n');
                lines += 1;
            }
            // Hard-split a word longer than a line.
            let mut rest = word;
            while n > max {
                let cut = rest.char_indices().nth(max).map_or(rest.len(), |(i, _)| i);
                out.push_str(&rest[..cut]);
                out.push('\n');
                lines += 1;
                rest = &rest[cut..];
                n -= max;
            }
            out.push_str(rest);
            len = n;
            started = true;
        }
    }
    (out, lines)
}

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

    #[test]
    fn wraps_at_spaces_honors_newlines_and_splits_long_words() {
        // size 10, weight 400: 6 units per char; w 60 → 10 chars per line.
        let (t, n) = wrap_text("the quick brown fox jumps", 60.0, 10.0, 400);
        assert_eq!(t, "the quick\nbrown fox\njumps");
        assert_eq!(n, 3);
        // Spaces inside a line (and indentation) stay; spaces at a break go.
        let (t, n) = wrap_text("  a  b\n\nccc", 60.0, 10.0, 400);
        assert_eq!(t, "  a  b\n\nccc");
        assert_eq!(n, 3);
        assert_eq!(wrap_text("1.  abcdef   ghij ", 60.0, 10.0, 400).0, "1.  abcdef\nghij");
        let (t, n) = wrap_text("abcdefghijklmnopqrstuvwxyz ok", 60.0, 10.0, 400);
        assert_eq!(t, "abcdefghij\nklmnopqrst\nuvwxyz ok");
        assert_eq!(n, 3);
        // Exactly 10 chars fit; bold text is wider (6.3 per char → 9).
        assert_eq!(wrap_text("abcde fghi", 60.0, 10.0, 400).1, 1);
        assert_eq!(wrap_text("abcde fghi", 60.0, 10.0, 700).1, 2);
        assert_eq!(wrap_text("", 60.0, 10.0, 400), (String::new(), 1));
        // Multi-byte characters split on char boundaries.
        assert_eq!(wrap_text("ééééé", 18.0, 10.0, 400).0, "ééé\néé");
    }
}
