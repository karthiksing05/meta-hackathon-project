//! The draw list the engine hands to the browser shell (spec B4).
//! `mg-scene` builds it; `mg-wasm` encodes it (JSON or compact binary).
//!
//! Coordinates are canvas units; the shell scales the canvas to fit.
//! Rotation is in degrees, clockwise. `rotation` and `scale` apply around the
//! op's center.

use std::rc::Rc;

use crate::color::Rgba;

#[derive(Clone, Debug, Default)]
pub struct Frame {
    pub width: f64,
    pub height: f64,
    pub background: Rgba,
    /// Paint order.
    pub ops: Vec<DrawOp>,
    /// Sounds triggered since the previous frame.
    pub audio: Vec<Sound>,
    /// Toasts triggered since the previous frame.
    pub toasts: Vec<Toast>,
    /// Current shake amplitude in canvas units (0 = none). The engine decays
    /// it; the shell offsets the whole canvas by a random vector this long.
    pub shake_px: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum DrawOp {
    Rect(RectOp),
    Circle(CircleOp),
    Text(TextOp),
}

#[derive(Clone, Debug, PartialEq)]
pub struct RectOp {
    /// Top-left.
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub radius: f64,
    pub fill: Option<Rgba>,
    pub stroke: Option<Rgba>,
    pub stroke_width: f64,
    pub rotation: f64,
    pub scale: f64,
    pub opacity: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CircleOp {
    /// Center.
    pub x: f64,
    pub y: f64,
    pub r: f64,
    pub fill: Option<Rgba>,
    pub stroke: Option<Rgba>,
    pub stroke_width: f64,
    pub scale: f64,
    pub opacity: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TextOp {
    /// Top-left of the text box.
    pub x: f64,
    pub y: f64,
    /// Box size (explicit or measured).
    pub w: f64,
    pub h: f64,
    pub text: Rc<str>,
    pub size: f64,
    pub font: Rc<str>,
    pub weight: u16,
    pub color: Rgba,
    pub align: crate::scene::TextAlign,
    pub valign: crate::scene::TextValign,
    pub rotation: f64,
    pub scale: f64,
    pub opacity: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Wave {
    Sine,
    Square,
    Triangle,
    Sawtooth,
}

impl Wave {
    pub fn from_name(s: &str) -> Option<Wave> {
        Some(match s {
            "sine" => Wave::Sine,
            "square" => Wave::Square,
            "triangle" => Wave::Triangle,
            "sawtooth" | "saw" => Wave::Sawtooth,
            _ => return None,
        })
    }
    pub fn name(self) -> &'static str {
        match self {
            Wave::Sine => "sine",
            Wave::Square => "square",
            Wave::Triangle => "triangle",
            Wave::Sawtooth => "sawtooth",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Sound {
    pub wave: Wave,
    pub freq_hz: f64,
    pub ms: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Toast {
    pub text: Rc<str>,
    pub ms: f64,
}

/// Note name (`C5`, `F#4`, `Bb3`) to Hz with A4 = 440. Returns `None` if the
/// string isn't a note name. Plain numbers are treated as Hz.
pub fn note_to_hz(s: &str) -> Option<f64> {
    if let Ok(hz) = s.trim().parse::<f64>() {
        return Some(hz);
    }
    let mut chars = s.trim().chars().peekable();
    let base = match chars.next()?.to_ascii_uppercase() {
        'C' => 0,
        'D' => 2,
        'E' => 4,
        'F' => 5,
        'G' => 7,
        'A' => 9,
        'B' => 11,
        _ => return None,
    };
    let mut semis: i32 = base;
    match chars.peek() {
        Some('#') => {
            semis += 1;
            chars.next();
        }
        Some('b') => {
            semis -= 1;
            chars.next();
        }
        _ => {}
    }
    let octave: i32 = chars.collect::<String>().parse().ok()?;
    let midi = (octave + 1) * 12 + semis;
    Some(440.0 * 2f64.powf((midi as f64 - 69.0) / 12.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notes() {
        assert!((note_to_hz("A4").unwrap() - 440.0).abs() < 1e-9);
        assert!((note_to_hz("C5").unwrap() - 523.2511).abs() < 1e-3);
        assert!((note_to_hz("Bb3").unwrap() - 233.0819).abs() < 1e-3);
        assert_eq!(note_to_hz("H2"), None);
    }
}
