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
    /// v0.2: haptics triggered since the previous frame.
    pub haptics: Vec<Haptic>,
    /// v0.2: background music state (`None` if the game has no music).
    pub music: Option<MusicState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Haptic {
    Light,
    Medium,
    Heavy,
    Success,
    Warning,
    Error,
}

impl Haptic {
    pub fn from_name(s: &str) -> Option<Haptic> {
        Some(match s {
            "light" => Haptic::Light,
            "medium" => Haptic::Medium,
            "heavy" => Haptic::Heavy,
            "success" => Haptic::Success,
            "warning" => Haptic::Warning,
            "error" => Haptic::Error,
            _ => return None,
        })
    }
    pub fn name(self) -> &'static str {
        match self {
            Haptic::Light => "light",
            Haptic::Medium => "medium",
            Haptic::Heavy => "heavy",
            Haptic::Success => "success",
            Haptic::Warning => "warning",
            Haptic::Error => "error",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MusicState {
    pub asset: u16,
    pub volume: f64,
    pub playing: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum DrawOp {
    Rect(RectOp),
    Circle(CircleOp),
    Text(TextOp),
    /// v0.2
    Image(ImageOp),
    /// v0.2
    Line(LineOp),
    /// v0.2
    Poly(PolyOp),
}

/// v0.2. Draws frame `frame` of asset `asset` into the box.
#[derive(Clone, Debug, PartialEq)]
pub struct ImageOp {
    /// Top-left (screen/canvas units, camera already applied).
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub asset: u16,
    pub frame: u16,
    pub flip_x: bool,
    pub flip_y: bool,
    pub rotation: f64,
    pub scale: f64,
    pub opacity: f64,
}

/// v0.2. Absolute endpoints (camera applied).
#[derive(Clone, Debug, PartialEq)]
pub struct LineOp {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    pub stroke: Rgba,
    pub stroke_width: f64,
    pub opacity: f64,
}

/// v0.2. Absolute points (camera applied).
#[derive(Clone, Debug, PartialEq)]
pub struct PolyOp {
    pub points: Vec<(f64, f64)>,
    pub closed: bool,
    pub fill: Option<Rgba>,
    pub stroke: Option<Rgba>,
    pub stroke_width: f64,
    pub opacity: f64,
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
    /// Lines joined with `\n` (v0.2.1: already wrapped when the node has
    /// `wrap: true`). The shell draws each line `line_height` apart and
    /// places the block in the box with `align` / `valign`.
    pub text: Rc<str>,
    /// v0.2.1: distance between baselines (`size * 1.25`).
    pub line_height: f64,
    pub size: f64,
    pub font: Rc<str>,
    pub weight: u16,
    pub color: Rgba,
    /// v0.2.1: outline drawn under the fill (`None` = no outline).
    pub stroke: Option<Rgba>,
    pub stroke_width: f64,
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
    pub kind: SoundKind,
    /// 0..1
    pub volume: f64,
    /// Total duration (synth: per note × notes for jingles).
    pub ms: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum SoundKind {
    /// One note (`freqs.len() == 1`) or a jingle (each note `step_ms`).
    /// `slide_to_hz`: glide the (last) note's pitch to this over its duration.
    Synth { wave: Wave, freqs: Vec<f64>, step_ms: f64, slide_to_hz: Option<f64> },
    /// v0.2: play a `sound` asset at playback `rate`.
    Sample { asset: u16, rate: f64 },
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
