//! Frame encoders: the B4 JSON shape and the compact binary format described
//! in `engine/web/FRAME_FORMAT.md`. Both are plain functions over
//! `mg_core::frame::Frame`, so the CLI can benchmark them natively.

use std::collections::HashMap;
use std::rc::Rc;

use mg_core::color::{to_hex, Rgba};
use mg_core::frame::{DrawOp, Frame, Haptic, SoundKind, Wave};
use mg_core::scene::{TextAlign, TextValign};

// ---------------------------------------------------------------- JSON ----

/// Appends the B4 JSON frame to `out`. Colors are hex strings (`to_hex`),
/// missing fill/stroke is `null`.
pub fn frame_json(f: &Frame, out: &mut Vec<u8>) {
    out.extend_from_slice(b"{\"width\":");
    num(out, f.width);
    out.extend_from_slice(b",\"height\":");
    num(out, f.height);
    out.extend_from_slice(b",\"background\":");
    color(out, Some(f.background));
    out.extend_from_slice(b",\"ops\":[");
    for (i, op) in f.ops.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        match op {
            DrawOp::Image(m) => {
                out.extend_from_slice(b"{\"op\":\"image\",\"x\":");
                num(out, m.x);
                field_num(out, "y", m.y);
                field_num(out, "w", m.w);
                field_num(out, "h", m.h);
                field_num(out, "asset", m.asset as f64);
                field_num(out, "frame", m.frame as f64);
                field_bool(out, "flip_x", m.flip_x);
                field_bool(out, "flip_y", m.flip_y);
                field_num(out, "rotation", m.rotation);
                field_num(out, "scale", m.scale);
                field_num(out, "opacity", m.opacity);
                if let Some([sx, sy, sw, sh]) = m.src {
                    field_num(out, "src_x", sx);
                    field_num(out, "src_y", sy);
                    field_num(out, "src_w", sw);
                    field_num(out, "src_h", sh);
                }
                out.push(b'}');
            }
            DrawOp::Clip(c) => {
                out.extend_from_slice(b"{\"op\":\"clip\",\"x\":");
                num(out, c.x);
                field_num(out, "y", c.y);
                field_num(out, "w", c.w);
                field_num(out, "h", c.h);
                out.push(b'}');
            }
            DrawOp::Unclip => out.extend_from_slice(b"{\"op\":\"unclip\"}"),
            DrawOp::Line(l) => {
                out.extend_from_slice(b"{\"op\":\"line\",\"x1\":");
                num(out, l.x1);
                field_num(out, "y1", l.y1);
                field_num(out, "x2", l.x2);
                field_num(out, "y2", l.y2);
                field_color(out, "stroke", Some(l.stroke));
                field_num(out, "stroke_width", l.stroke_width);
                field_num(out, "opacity", l.opacity);
                out.push(b'}');
            }
            DrawOp::Poly(p) => {
                out.extend_from_slice(b"{\"op\":\"poly\",\"points\":[");
                for (k, &(x, y)) in p.points.iter().enumerate() {
                    if k > 0 {
                        out.push(b',');
                    }
                    out.push(b'[');
                    num(out, x);
                    out.push(b',');
                    num(out, y);
                    out.push(b']');
                }
                out.push(b']');
                field_bool(out, "closed", p.closed);
                field_color(out, "fill", p.fill);
                field_color(out, "stroke", p.stroke);
                field_num(out, "stroke_width", p.stroke_width);
                field_num(out, "opacity", p.opacity);
                out.push(b'}');
            }
            DrawOp::Rect(r) => {
                out.extend_from_slice(b"{\"op\":\"rect\",\"x\":");
                num(out, r.x);
                field_num(out, "y", r.y);
                field_num(out, "w", r.w);
                field_num(out, "h", r.h);
                field_num(out, "radius", r.radius);
                field_color(out, "fill", r.fill);
                field_color(out, "stroke", r.stroke);
                field_num(out, "stroke_width", r.stroke_width);
                field_num(out, "rotation", r.rotation);
                field_num(out, "scale", r.scale);
                field_num(out, "opacity", r.opacity);
                out.push(b'}');
            }
            DrawOp::Circle(c) => {
                out.extend_from_slice(b"{\"op\":\"circle\",\"x\":");
                num(out, c.x);
                field_num(out, "y", c.y);
                field_num(out, "r", c.r);
                field_color(out, "fill", c.fill);
                field_color(out, "stroke", c.stroke);
                field_num(out, "stroke_width", c.stroke_width);
                field_num(out, "scale", c.scale);
                field_num(out, "opacity", c.opacity);
                out.push(b'}');
            }
            DrawOp::Text(t) => {
                out.extend_from_slice(b"{\"op\":\"text\",\"x\":");
                num(out, t.x);
                field_num(out, "y", t.y);
                field_num(out, "w", t.w);
                field_num(out, "h", t.h);
                out.extend_from_slice(b",\"text\":");
                string(out, &t.text);
                field_num(out, "size", t.size);
                out.extend_from_slice(b",\"font\":");
                string(out, &t.font);
                field_num(out, "weight", t.weight as f64);
                field_color(out, "color", Some(t.color));
                out.extend_from_slice(b",\"align\":\"");
                out.extend_from_slice(align_name(t.align).as_bytes());
                out.extend_from_slice(b"\",\"valign\":\"");
                out.extend_from_slice(valign_name(t.valign).as_bytes());
                out.push(b'"');
                field_num(out, "rotation", t.rotation);
                field_num(out, "scale", t.scale);
                field_num(out, "opacity", t.opacity);
                field_num(out, "line_height", t.line_height);
                field_color(out, "stroke", t.stroke);
                field_num(out, "stroke_width", t.stroke_width);
                out.push(b'}');
            }
        }
    }
    out.extend_from_slice(b"],\"audio\":[");
    for (i, s) in f.audio.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        match &s.kind {
            SoundKind::Synth { wave, freqs, step_ms, slide_to_hz } => {
                out.extend_from_slice(b"{\"kind\":\"synth\",\"wave\":\"");
                out.extend_from_slice(wave.name().as_bytes());
                out.extend_from_slice(b"\",\"freqs\":[");
                for (k, f) in freqs.iter().enumerate() {
                    if k > 0 {
                        out.push(b',');
                    }
                    num(out, *f);
                }
                out.push(b']');
                field_num(out, "step_ms", *step_ms);
                out.extend_from_slice(b",\"slide_hz\":");
                match slide_to_hz {
                    Some(hz) => num(out, *hz),
                    None => out.extend_from_slice(b"null"),
                }
            }
            SoundKind::Sample { asset, rate } => {
                out.extend_from_slice(b"{\"kind\":\"sample\",\"asset\":");
                num(out, *asset as f64);
                field_num(out, "rate", *rate);
            }
        }
        field_num(out, "ms", s.ms);
        field_num(out, "volume", s.volume);
        out.push(b'}');
    }
    out.extend_from_slice(b"],\"toasts\":[");
    for (i, t) in f.toasts.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        out.extend_from_slice(b"{\"text\":");
        string(out, &t.text);
        field_num(out, "ms", t.ms);
        out.push(b'}');
    }
    out.extend_from_slice(b"],\"haptics\":[");
    for (i, h) in f.haptics.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        out.push(b'"');
        out.extend_from_slice(h.name().as_bytes());
        out.push(b'"');
    }
    out.extend_from_slice(b"],\"music\":");
    match &f.music {
        Some(m) => {
            out.extend_from_slice(b"{\"asset\":");
            num(out, m.asset as f64);
            field_num(out, "volume", m.volume);
            field_bool(out, "playing", m.playing);
            out.push(b'}');
        }
        None => out.extend_from_slice(b"null"),
    }
    out.extend_from_slice(b",\"shake\":{\"px\":");
    num(out, f.shake_px);
    out.extend_from_slice(b"}}");
}

pub fn align_name(a: TextAlign) -> &'static str {
    match a {
        TextAlign::Left => "left",
        TextAlign::Center => "center",
        TextAlign::Right => "right",
    }
}

pub fn valign_name(a: TextValign) -> &'static str {
    match a {
        TextValign::Top => "top",
        TextValign::Middle => "middle",
        TextValign::Bottom => "bottom",
    }
}

fn field_num(out: &mut Vec<u8>, name: &str, v: f64) {
    out.push(b',');
    out.push(b'"');
    out.extend_from_slice(name.as_bytes());
    out.extend_from_slice(b"\":");
    num(out, v);
}

fn field_bool(out: &mut Vec<u8>, name: &str, v: bool) {
    out.push(b',');
    out.push(b'"');
    out.extend_from_slice(name.as_bytes());
    out.extend_from_slice(if v { b"\":true" } else { b"\":false" });
}

fn field_color(out: &mut Vec<u8>, name: &str, c: Option<Rgba>) {
    out.push(b',');
    out.push(b'"');
    out.extend_from_slice(name.as_bytes());
    out.extend_from_slice(b"\":");
    color(out, c);
}

fn color(out: &mut Vec<u8>, c: Option<Rgba>) {
    match c {
        Some(c) => {
            out.push(b'"');
            out.extend_from_slice(to_hex(c).as_bytes());
            out.push(b'"');
        }
        None => out.extend_from_slice(b"null"),
    }
}

/// Integral values print without a decimal point; non-finite values are `null`.
fn num(out: &mut Vec<u8>, v: f64) {
    if !v.is_finite() {
        out.extend_from_slice(b"null");
    } else if v == v.trunc() && v.abs() < 1e15 {
        int(out, v as i64);
    } else {
        // serde_json uses ryu: shortest round-trip form.
        let _ = serde_json::to_writer(&mut *out, &v);
    }
}

fn int(out: &mut Vec<u8>, v: i64) {
    if v == 0 {
        out.push(b'0');
        return;
    }
    let mut buf = [0u8; 20];
    let mut i = buf.len();
    let neg = v < 0;
    let mut n = v.unsigned_abs();
    while n > 0 {
        i -= 1;
        buf[i] = b'0' + (n % 10) as u8;
        n /= 10;
    }
    if neg {
        out.push(b'-');
    }
    out.extend_from_slice(&buf[i..]);
}

fn string(out: &mut Vec<u8>, s: &str) {
    out.push(b'"');
    for c in s.chars() {
        match c {
            '"' => out.extend_from_slice(b"\\\""),
            '\\' => out.extend_from_slice(b"\\\\"),
            '\n' => out.extend_from_slice(b"\\n"),
            '\r' => out.extend_from_slice(b"\\r"),
            '\t' => out.extend_from_slice(b"\\t"),
            c if (c as u32) < 0x20 => {
                const HEX: &[u8; 16] = b"0123456789abcdef";
                out.extend_from_slice(b"\\u00");
                out.push(HEX[(c as usize) >> 4]);
                out.push(HEX[(c as usize) & 15]);
            }
            c => {
                let mut b = [0u8; 4];
                out.extend_from_slice(c.encode_utf8(&mut b).as_bytes());
            }
        }
    }
    out.push(b'"');
}

// -------------------------------------------------------------- binary ----

/// `"MGF2"` little-endian. v0.2 frames (v0.1 was `"MGF1"`, a 10-word header).
pub const MAGIC: u32 = 0x3246_474D;
/// Header size in 4-byte words.
pub const HEADER_WORDS: usize = 13;
pub const FLAG_RESET_STRINGS: u32 = 1;
pub const OP_RECT: u32 = 1;
pub const OP_CIRCLE: u32 = 2;
pub const OP_TEXT: u32 = 3;
pub const OP_IMAGE: u32 = 4;
pub const OP_LINE: u32 = 5;
pub const OP_POLY: u32 = 6;
/// v0.2.2: start clipping to a rectangle (5 words).
pub const OP_CLIP: u32 = 7;
/// v0.2.2: end the innermost clip (1 word).
pub const OP_UNCLIP: u32 = 8;
/// Image head flags.
pub const IMAGE_FLIP_X: u32 = 1 << 8;
pub const IMAGE_FLIP_Y: u32 = 1 << 9;
/// v0.2.2: 4 more words, the source rectangle `src_x, src_y, src_w, src_h`.
pub const IMAGE_SRC: u32 = 1 << 10;
/// v0.2.1 text head flags: an outline follows (`u32 stroke, f32 stroke_width`).
pub const TEXT_STROKE: u32 = 1 << 8;
/// v0.2.1 text head flag: several lines; `f32 line_height` follows.
pub const TEXT_LINES: u32 = 1 << 9;
pub const AUDIO_SYNTH: u32 = 0;
pub const AUDIO_SAMPLE: u32 = 1;
/// Header word 11 when the game has no music.
pub const NO_MUSIC: u32 = 0xFFFF_FFFF;

pub fn wave_code(w: Wave) -> u32 {
    match w {
        Wave::Sine => 0,
        Wave::Square => 1,
        Wave::Triangle => 2,
        Wave::Sawtooth => 3,
    }
}

pub fn haptic_code(h: Haptic) -> u32 {
    match h {
        Haptic::Light => 0,
        Haptic::Medium => 1,
        Haptic::Heavy => 2,
        Haptic::Success => 3,
        Haptic::Warning => 4,
        Haptic::Error => 5,
    }
}
/// When the string table grows past this, it is cleared and the next frame
/// re-sends every string it uses (flag `FLAG_RESET_STRINGS`).
pub const MAX_STRINGS: usize = 4096;

/// Stateful binary encoder: one per game, because the decoder on the other
/// side keeps a matching string table.
#[derive(Default)]
pub struct BinEncoder {
    table: HashMap<Rc<str>, u32>,
    reset_pending: bool,
    strs: Vec<u8>,
    n_new: u32,
    body: Vec<u8>,
}

impl BinEncoder {
    pub fn new() -> Self {
        BinEncoder { reset_pending: true, ..Default::default() }
    }

    /// Forgets every string; the next frame re-sends them with the reset flag.
    pub fn reset(&mut self) {
        self.table.clear();
        self.reset_pending = true;
    }

    /// Number of strings the decoder currently knows.
    pub fn table_len(&self) -> usize {
        self.table.len()
    }

    fn intern(&mut self, s: &Rc<str>) -> u32 {
        if let Some(&id) = self.table.get(&**s) {
            return id;
        }
        let id = self.table.len() as u32;
        self.table.insert(s.clone(), id);
        self.n_new += 1;
        put_u32(&mut self.strs, id);
        put_u32(&mut self.strs, s.len() as u32);
        self.strs.extend_from_slice(s.as_bytes());
        while !self.strs.len().is_multiple_of(4) {
            self.strs.push(0);
        }
        id
    }

    /// Appends one encoded frame to `out`.
    pub fn encode(&mut self, f: &Frame, out: &mut Vec<u8>) {
        if self.table.len() > MAX_STRINGS {
            self.reset();
        }
        let mut flags = 0;
        if self.reset_pending {
            flags |= FLAG_RESET_STRINGS;
            self.reset_pending = false;
        }
        self.strs.clear();
        self.body.clear();
        self.n_new = 0;
        let mut body = std::mem::take(&mut self.body);
        for op in &f.ops {
            match op {
                DrawOp::Image(m) => {
                    let mut head = OP_IMAGE;
                    if m.flip_x {
                        head |= IMAGE_FLIP_X;
                    }
                    if m.flip_y {
                        head |= IMAGE_FLIP_Y;
                    }
                    if m.src.is_some() {
                        head |= IMAGE_SRC;
                    }
                    put_u32(&mut body, head);
                    put_f32(&mut body, m.x);
                    put_f32(&mut body, m.y);
                    put_f32(&mut body, m.w);
                    put_f32(&mut body, m.h);
                    put_u32(&mut body, m.asset as u32 | (m.frame as u32) << 16);
                    put_f32(&mut body, m.rotation);
                    put_f32(&mut body, m.scale);
                    put_f32(&mut body, m.opacity);
                    if let Some(src) = m.src {
                        for v in src {
                            put_f32(&mut body, v);
                        }
                    }
                }
                DrawOp::Clip(c) => {
                    put_u32(&mut body, OP_CLIP);
                    put_f32(&mut body, c.x);
                    put_f32(&mut body, c.y);
                    put_f32(&mut body, c.w);
                    put_f32(&mut body, c.h);
                }
                DrawOp::Unclip => put_u32(&mut body, OP_UNCLIP),
                DrawOp::Line(l) => {
                    put_u32(&mut body, OP_LINE);
                    put_f32(&mut body, l.x1);
                    put_f32(&mut body, l.y1);
                    put_f32(&mut body, l.x2);
                    put_f32(&mut body, l.y2);
                    put_u32(&mut body, l.stroke);
                    put_f32(&mut body, l.stroke_width);
                    put_f32(&mut body, l.opacity);
                }
                DrawOp::Poly(p) => {
                    put_u32(&mut body, OP_POLY | (p.closed as u32) << 8);
                    put_u32(&mut body, p.points.len() as u32);
                    put_u32(&mut body, p.fill.unwrap_or(0));
                    put_u32(&mut body, p.stroke.unwrap_or(0));
                    put_f32(&mut body, p.stroke_width);
                    put_f32(&mut body, p.opacity);
                    for &(x, y) in &p.points {
                        put_f32(&mut body, x);
                        put_f32(&mut body, y);
                    }
                }
                DrawOp::Rect(r) => {
                    put_u32(&mut body, OP_RECT);
                    put_f32(&mut body, r.x);
                    put_f32(&mut body, r.y);
                    put_f32(&mut body, r.w);
                    put_f32(&mut body, r.h);
                    put_f32(&mut body, r.radius);
                    put_u32(&mut body, r.fill.unwrap_or(0));
                    put_u32(&mut body, r.stroke.unwrap_or(0));
                    put_f32(&mut body, r.stroke_width);
                    put_f32(&mut body, r.rotation);
                    put_f32(&mut body, r.scale);
                    put_f32(&mut body, r.opacity);
                }
                DrawOp::Circle(c) => {
                    put_u32(&mut body, OP_CIRCLE);
                    put_f32(&mut body, c.x);
                    put_f32(&mut body, c.y);
                    put_f32(&mut body, c.r);
                    put_u32(&mut body, c.fill.unwrap_or(0));
                    put_u32(&mut body, c.stroke.unwrap_or(0));
                    put_f32(&mut body, c.stroke_width);
                    put_f32(&mut body, c.scale);
                    put_f32(&mut body, c.opacity);
                }
                DrawOp::Text(t) => {
                    let text = self.intern(&t.text);
                    let font = self.intern(&t.font);
                    let stroke = t.stroke.filter(|_| t.stroke_width > 0.0);
                    let lines = t.text.contains('\n');
                    let mut head = OP_TEXT;
                    if stroke.is_some() {
                        head |= TEXT_STROKE;
                    }
                    if lines {
                        head |= TEXT_LINES;
                    }
                    put_u32(&mut body, head);
                    put_f32(&mut body, t.x);
                    put_f32(&mut body, t.y);
                    put_f32(&mut body, t.w);
                    put_f32(&mut body, t.h);
                    put_u32(&mut body, text);
                    put_f32(&mut body, t.size);
                    put_u32(&mut body, font);
                    let align = match t.align {
                        TextAlign::Left => 0,
                        TextAlign::Center => 1,
                        TextAlign::Right => 2,
                    };
                    let valign = match t.valign {
                        TextValign::Top => 0,
                        TextValign::Middle => 1,
                        TextValign::Bottom => 2,
                    };
                    put_u32(&mut body, t.weight as u32 | (align << 16) | (valign << 24));
                    put_u32(&mut body, t.color);
                    put_f32(&mut body, t.rotation);
                    put_f32(&mut body, t.scale);
                    put_f32(&mut body, t.opacity);
                    if let Some(c) = stroke {
                        put_u32(&mut body, c);
                        put_f32(&mut body, t.stroke_width);
                    }
                    if lines {
                        put_f32(&mut body, t.line_height);
                    }
                }
            }
        }
        for s in &f.audio {
            match &s.kind {
                SoundKind::Synth { wave, freqs, step_ms, slide_to_hz } => {
                    let n = freqs.len().min(0xFFFF);
                    put_u32(&mut body, AUDIO_SYNTH | wave_code(*wave) << 8 | (n as u32) << 16);
                    put_f32(&mut body, s.volume);
                    put_f32(&mut body, s.ms);
                    put_f32(&mut body, *step_ms);
                    put_f32(&mut body, slide_to_hz.unwrap_or(0.0));
                    for f in &freqs[..n] {
                        put_f32(&mut body, *f);
                    }
                }
                SoundKind::Sample { asset, rate } => {
                    put_u32(&mut body, AUDIO_SAMPLE | (*asset as u32) << 16);
                    put_f32(&mut body, s.volume);
                    put_f32(&mut body, s.ms);
                    put_f32(&mut body, *rate);
                }
            }
        }
        for t in &f.toasts {
            let id = self.intern(&t.text);
            put_u32(&mut body, id);
            put_f32(&mut body, t.ms);
        }
        for h in &f.haptics {
            put_u32(&mut body, haptic_code(*h));
        }

        out.reserve(4 * HEADER_WORDS + self.strs.len() + body.len());
        put_u32(out, MAGIC);
        put_u32(out, flags);
        put_f32(out, f.width);
        put_f32(out, f.height);
        put_u32(out, f.background);
        put_f32(out, f.shake_px);
        put_u32(out, self.n_new);
        put_u32(out, f.ops.len() as u32);
        put_u32(out, f.audio.len() as u32);
        put_u32(out, f.toasts.len() as u32);
        put_u32(out, f.haptics.len() as u32);
        match &f.music {
            Some(m) => {
                put_u32(out, m.asset as u32 | (m.playing as u32) << 16);
                put_f32(out, m.volume);
            }
            None => {
                put_u32(out, NO_MUSIC);
                put_f32(out, 0.0);
            }
        }
        out.extend_from_slice(&self.strs);
        out.extend_from_slice(&body);
        self.body = body;
    }
}

#[inline]
fn put_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

#[inline]
fn put_f32(out: &mut Vec<u8>, v: f64) {
    out.extend_from_slice(&(v as f32).to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use mg_core::frame::{CircleOp, ClipOp, ImageOp, LineOp, MusicState, PolyOp, RectOp, Sound, TextOp, Toast};

    fn sample(text: &str) -> Frame {
        Frame {
            width: 360.0,
            height: 640.0,
            background: 0xF4F1_EAFF,
            ops: vec![
                DrawOp::Rect(RectOp {
                    x: 8.0,
                    y: 120.5,
                    w: 56.0,
                    h: 56.0,
                    radius: 6.0,
                    fill: Some(0xE457_2EFF),
                    stroke: None,
                    stroke_width: 0.0,
                    rotation: 0.0,
                    scale: 1.12,
                    opacity: 1.0,
                }),
                DrawOp::Circle(CircleOp {
                    x: 1.0,
                    y: 2.0,
                    r: 3.0,
                    fill: Some(0x00F5_FF80),
                    stroke: None,
                    stroke_width: 0.0,
                    scale: 1.0,
                    opacity: 0.5,
                }),
                DrawOp::Text(TextOp {
                    x: 0.0,
                    y: 0.0,
                    w: 100.0,
                    h: 20.0,
                    text: Rc::from(text),
                    line_height: 22.5,
                    size: 18.0,
                    font: Rc::from("Inter"),
                    weight: 700,
                    color: 0x1A1A_1AFF,
                    stroke: None,
                    stroke_width: 0.0,
                    align: TextAlign::Right,
                    valign: TextValign::Bottom,
                    rotation: 0.0,
                    scale: 1.0,
                    opacity: 1.0,
                }),
            ],
            audio: vec![synth(Wave::Triangle, vec![440.0], None)],
            toasts: vec![Toast { text: Rc::from("hi \"there\"\n"), ms: 1500.0 }],
            shake_px: 0.0,
            haptics: vec![],
            music: None,
        }
    }

    fn synth(wave: Wave, freqs: Vec<f64>, slide: Option<f64>) -> Sound {
        Sound { kind: SoundKind::Synth { wave, freqs, step_ms: 80.0, slide_to_hz: slide }, volume: 0.6, ms: 60.0 }
    }

    /// A frame with every v0.2 addition.
    fn sample_v2() -> Frame {
        let mut f = sample("Score: 12");
        f.ops.push(DrawOp::Image(ImageOp {
            x: 10.0,
            y: 20.25,
            w: 34.0,
            h: 24.0,
            asset: 3,
            frame: 5,
            flip_x: true,
            flip_y: false,
            rotation: 15.0,
            scale: 1.5,
            opacity: 0.75,
            src: None,
        }));
        f.ops.push(DrawOp::Line(LineOp {
            x1: 0.0,
            y1: 1.0,
            x2: 100.5,
            y2: -20.0,
            stroke: 0x1122_33FF,
            stroke_width: 3.0,
            opacity: 1.0,
        }));
        f.ops.push(DrawOp::Poly(PolyOp {
            points: vec![(0.0, 0.0), (10.0, 0.0), (5.0, 8.5)],
            closed: true,
            fill: Some(0xFFD1_66FF),
            stroke: None,
            stroke_width: 2.0,
            opacity: 0.5,
        }));
        f.ops.push(DrawOp::Poly(PolyOp {
            points: vec![],
            closed: false,
            fill: None,
            stroke: Some(0x0000_00FF),
            stroke_width: 1.0,
            opacity: 1.0,
        }));
        f.audio = vec![
            synth(Wave::Square, vec![523.25, 659.25, 783.99, 1046.5], None),
            synth(Wave::Sawtooth, vec![261.63], Some(523.25)),
            Sound { kind: SoundKind::Sample { asset: 7, rate: 1.25 }, volume: 0.8, ms: 0.0 },
        ];
        f.haptics = vec![Haptic::Light, Haptic::Error];
        f.music = Some(MusicState { asset: 2, volume: 0.4, playing: true });
        f
    }

    // ---- a test decoder that mirrors `decodeFrame` in web/microgame.js ----

    struct Rd<'a> {
        b: &'a [u8],
        o: usize,
    }
    impl Rd<'_> {
        fn u32(&mut self) -> u32 {
            let v = u32::from_le_bytes(self.b[self.o..self.o + 4].try_into().unwrap());
            self.o += 4;
            v
        }
        fn f32(&mut self) -> f64 {
            let v = f32::from_le_bytes(self.b[self.o..self.o + 4].try_into().unwrap());
            self.o += 4;
            v as f64
        }
    }

    fn opt(c: u32) -> Option<u32> {
        (c != 0).then_some(c)
    }
    fn f32r(v: f64) -> f64 {
        v as f32 as f64
    }

    /// Decodes a binary frame back into a `Frame` (values rounded to f32).
    fn decode(b: &[u8], strings: &mut Vec<String>) -> Frame {
        let mut r = Rd { b, o: 0 };
        assert_eq!(r.u32(), MAGIC);
        let flags = r.u32();
        let (width, height, background, shake_px) = (r.f32(), r.f32(), r.u32(), r.f32());
        let (n_str, n_ops, n_audio, n_toasts, n_haptics) = (r.u32(), r.u32(), r.u32(), r.u32(), r.u32());
        let music_word = r.u32();
        let music_vol = r.f32();
        if flags & FLAG_RESET_STRINGS != 0 {
            strings.clear();
        }
        for _ in 0..n_str {
            let id = r.u32() as usize;
            let len = r.u32() as usize;
            let s = std::str::from_utf8(&b[r.o..r.o + len]).unwrap().to_string();
            r.o += (len + 3) & !3;
            if strings.len() <= id {
                strings.resize(id + 1, String::new());
            }
            strings[id] = s;
        }
        let mut ops = Vec::new();
        for _ in 0..n_ops {
            let head = r.u32();
            let op = match head & 0xff {
                OP_RECT => DrawOp::Rect(RectOp {
                    x: r.f32(),
                    y: r.f32(),
                    w: r.f32(),
                    h: r.f32(),
                    radius: r.f32(),
                    fill: opt(r.u32()),
                    stroke: opt(r.u32()),
                    stroke_width: r.f32(),
                    rotation: r.f32(),
                    scale: r.f32(),
                    opacity: r.f32(),
                }),
                OP_CIRCLE => DrawOp::Circle(CircleOp {
                    x: r.f32(),
                    y: r.f32(),
                    r: r.f32(),
                    fill: opt(r.u32()),
                    stroke: opt(r.u32()),
                    stroke_width: r.f32(),
                    scale: r.f32(),
                    opacity: r.f32(),
                }),
                OP_TEXT => {
                    let (x, y, w, h) = (r.f32(), r.f32(), r.f32(), r.f32());
                    let text = Rc::from(strings[r.u32() as usize].as_str());
                    let size = r.f32();
                    let font = Rc::from(strings[r.u32() as usize].as_str());
                    let packed = r.u32();
                    let align = [TextAlign::Left, TextAlign::Center, TextAlign::Right][((packed >> 16) & 0xff) as usize];
                    let valign = [TextValign::Top, TextValign::Middle, TextValign::Bottom][(packed >> 24) as usize];
                    let (color, rotation, scale, opacity) = (r.u32(), r.f32(), r.f32(), r.f32());
                    let (stroke, stroke_width) =
                        if head & TEXT_STROKE != 0 { (Some(r.u32()), r.f32()) } else { (None, 0.0) };
                    // Single-line ops leave the line height to the decoder.
                    let line_height = if head & TEXT_LINES != 0 { r.f32() } else { size * 1.25 };
                    DrawOp::Text(TextOp {
                        x,
                        y,
                        w,
                        h,
                        text,
                        line_height,
                        size,
                        font,
                        weight: (packed & 0xffff) as u16,
                        align,
                        valign,
                        color,
                        stroke,
                        stroke_width,
                        rotation,
                        scale,
                        opacity,
                    })
                }
                OP_IMAGE => {
                    let (x, y, w, h) = (r.f32(), r.f32(), r.f32(), r.f32());
                    let af = r.u32();
                    let (rotation, scale, opacity) = (r.f32(), r.f32(), r.f32());
                    let src = (head & IMAGE_SRC != 0).then(|| [r.f32(), r.f32(), r.f32(), r.f32()]);
                    DrawOp::Image(ImageOp {
                        x,
                        y,
                        w,
                        h,
                        asset: (af & 0xffff) as u16,
                        frame: (af >> 16) as u16,
                        flip_x: head & IMAGE_FLIP_X != 0,
                        flip_y: head & IMAGE_FLIP_Y != 0,
                        rotation,
                        scale,
                        opacity,
                        src,
                    })
                }
                OP_CLIP => DrawOp::Clip(ClipOp { x: r.f32(), y: r.f32(), w: r.f32(), h: r.f32() }),
                OP_UNCLIP => DrawOp::Unclip,
                OP_LINE => DrawOp::Line(LineOp {
                    x1: r.f32(),
                    y1: r.f32(),
                    x2: r.f32(),
                    y2: r.f32(),
                    stroke: r.u32(),
                    stroke_width: r.f32(),
                    opacity: r.f32(),
                }),
                OP_POLY => {
                    let n = r.u32();
                    let (fill, stroke, stroke_width, opacity) = (opt(r.u32()), opt(r.u32()), r.f32(), r.f32());
                    let points = (0..n).map(|_| (r.f32(), r.f32())).collect();
                    DrawOp::Poly(PolyOp { points, closed: head & (1 << 8) != 0, fill, stroke, stroke_width, opacity })
                }
                t => panic!("bad tag {t}"),
            };
            ops.push(op);
        }
        let waves = [Wave::Sine, Wave::Square, Wave::Triangle, Wave::Sawtooth];
        let mut audio = Vec::new();
        for _ in 0..n_audio {
            let head = r.u32();
            let (volume, ms) = (r.f32(), r.f32());
            let kind = match head & 0xff {
                AUDIO_SYNTH => {
                    let step_ms = r.f32();
                    let slide = r.f32();
                    let freqs = (0..head >> 16).map(|_| r.f32()).collect();
                    SoundKind::Synth {
                        wave: waves[((head >> 8) & 0xff) as usize],
                        freqs,
                        step_ms,
                        slide_to_hz: (slide != 0.0).then_some(slide),
                    }
                }
                AUDIO_SAMPLE => SoundKind::Sample { asset: (head >> 16) as u16, rate: r.f32() },
                k => panic!("bad audio kind {k}"),
            };
            audio.push(Sound { kind, volume, ms });
        }
        let toasts =
            (0..n_toasts).map(|_| Toast { text: Rc::from(strings[r.u32() as usize].as_str()), ms: r.f32() }).collect();
        let hs = [Haptic::Light, Haptic::Medium, Haptic::Heavy, Haptic::Success, Haptic::Warning, Haptic::Error];
        let haptics = (0..n_haptics).map(|_| hs[r.u32() as usize]).collect();
        assert_eq!(r.o, b.len(), "trailing bytes");
        let music = (music_word != NO_MUSIC).then_some(MusicState {
            asset: (music_word & 0xffff) as u16,
            volume: music_vol,
            playing: music_word & (1 << 16) != 0,
        });
        Frame { width, height, background, ops, audio, toasts, shake_px, haptics, music }
    }

    /// `f` with every float rounded to f32, as the binary format carries it.
    fn rounded(f: &Frame) -> Frame {
        let mut g = f.clone();
        g.width = f32r(g.width);
        g.height = f32r(g.height);
        g.shake_px = f32r(g.shake_px);
        for op in &mut g.ops {
            match op {
                DrawOp::Rect(r) => {
                    for v in [&mut r.x, &mut r.y, &mut r.w, &mut r.h, &mut r.radius, &mut r.stroke_width] {
                        *v = f32r(*v);
                    }
                    for v in [&mut r.rotation, &mut r.scale, &mut r.opacity] {
                        *v = f32r(*v);
                    }
                }
                DrawOp::Circle(c) => {
                    for v in [&mut c.x, &mut c.y, &mut c.r, &mut c.stroke_width, &mut c.scale, &mut c.opacity] {
                        *v = f32r(*v);
                    }
                }
                DrawOp::Text(t) => {
                    for v in [&mut t.x, &mut t.y, &mut t.w, &mut t.h, &mut t.size, &mut t.rotation, &mut t.scale] {
                        *v = f32r(*v);
                    }
                    t.opacity = f32r(t.opacity);
                    t.stroke_width = f32r(t.stroke_width);
                    t.line_height = if t.text.contains('\n') { f32r(t.line_height) } else { t.size * 1.25 };
                }
                DrawOp::Image(m) => {
                    for v in [&mut m.x, &mut m.y, &mut m.w, &mut m.h, &mut m.rotation, &mut m.scale, &mut m.opacity] {
                        *v = f32r(*v);
                    }
                    if let Some(src) = &mut m.src {
                        for v in src {
                            *v = f32r(*v);
                        }
                    }
                }
                DrawOp::Clip(c) => {
                    for v in [&mut c.x, &mut c.y, &mut c.w, &mut c.h] {
                        *v = f32r(*v);
                    }
                }
                DrawOp::Unclip => {}
                DrawOp::Line(l) => {
                    for v in [&mut l.x1, &mut l.y1, &mut l.x2, &mut l.y2, &mut l.stroke_width, &mut l.opacity] {
                        *v = f32r(*v);
                    }
                }
                DrawOp::Poly(p) => {
                    p.stroke_width = f32r(p.stroke_width);
                    p.opacity = f32r(p.opacity);
                    for (x, y) in &mut p.points {
                        *x = f32r(*x);
                        *y = f32r(*y);
                    }
                }
            }
        }
        for s in &mut g.audio {
            s.volume = f32r(s.volume);
            s.ms = f32r(s.ms);
            match &mut s.kind {
                SoundKind::Synth { freqs, step_ms, slide_to_hz, .. } => {
                    *step_ms = f32r(*step_ms);
                    *slide_to_hz = slide_to_hz.map(f32r);
                    for f in freqs {
                        *f = f32r(*f);
                    }
                }
                SoundKind::Sample { rate, .. } => *rate = f32r(*rate),
            }
        }
        for t in &mut g.toasts {
            t.ms = f32r(t.ms);
        }
        if let Some(m) = &mut g.music {
            m.volume = f32r(m.volume);
        }
        g
    }

    #[test]
    fn json_shape() {
        let mut out = Vec::new();
        frame_json(&sample("Moves: 3"), &mut out);
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["ops"][0]["fill"], "#E4572E");
        assert_eq!(v["ops"][0]["stroke"], serde_json::Value::Null);
        assert_eq!(v["ops"][0]["y"], 120.5);
        assert_eq!(v["ops"][1]["fill"], "#00F5FF80");
        assert_eq!(v["ops"][2]["align"], "right");
        assert_eq!(v["ops"][2]["weight"], 700);
        assert_eq!(v["toasts"][0]["text"], "hi \"there\"\n");
        assert_eq!(v["audio"][0]["kind"], "synth");
        assert_eq!(v["audio"][0]["wave"], "triangle");
        assert_eq!(v["audio"][0]["freqs"], serde_json::json!([440]));
        assert_eq!(v["audio"][0]["slide_hz"], serde_json::Value::Null);
        assert_eq!(v["haptics"], serde_json::json!([]));
        assert_eq!(v["music"], serde_json::Value::Null);
        assert_eq!(v["shake"]["px"], 0);
    }

    #[test]
    fn json_v2_ops_audio_haptics_music() {
        let mut out = Vec::new();
        frame_json(&sample_v2(), &mut out);
        let v: serde_json::Value = serde_json::from_slice(&out).expect("valid JSON");
        let ops = v["ops"].as_array().unwrap();
        assert_eq!(ops.len(), 7);
        assert_eq!(
            ops[3],
            serde_json::json!({"op": "image", "x": 10, "y": 20.25, "w": 34, "h": 24, "asset": 3, "frame": 5,
                "flip_x": true, "flip_y": false, "rotation": 15, "scale": 1.5, "opacity": 0.75})
        );
        assert_eq!(
            ops[4],
            serde_json::json!({"op": "line", "x1": 0, "y1": 1, "x2": 100.5, "y2": -20, "stroke": "#112233",
                "stroke_width": 3, "opacity": 1})
        );
        assert_eq!(ops[5]["points"], serde_json::json!([[0, 0], [10, 0], [5, 8.5]]));
        assert_eq!(ops[5]["closed"], true);
        assert_eq!(ops[5]["stroke"], serde_json::Value::Null);
        assert_eq!(ops[6]["points"], serde_json::json!([]));
        assert_eq!(ops[6]["fill"], serde_json::Value::Null);
        assert_eq!(
            v["audio"][0],
            serde_json::json!({"kind": "synth", "wave": "square", "freqs": [523.25, 659.25, 783.99, 1046.5],
                "step_ms": 80, "slide_hz": null, "ms": 60, "volume": 0.6})
        );
        assert_eq!(v["audio"][1]["slide_hz"], 523.25);
        assert_eq!(
            v["audio"][2],
            serde_json::json!({"kind": "sample", "asset": 7, "rate": 1.25, "ms": 0, "volume": 0.8})
        );
        assert_eq!(v["haptics"], serde_json::json!(["light", "error"]));
        assert_eq!(v["music"], serde_json::json!({"asset": 2, "volume": 0.4, "playing": true}));
    }

    #[test]
    fn binary_round_trip_v2() {
        let mut enc = BinEncoder::new();
        let mut strings = Vec::new();
        for f in [sample("a"), sample_v2(), sample_v2(), sample("b")] {
            let mut out = Vec::new();
            enc.encode(&f, &mut out);
            assert_eq!(out.len() % 4, 0);
            let back = decode(&out, &mut strings);
            assert_eq!(back.ops, rounded(&f).ops);
            assert_eq!(back.audio, rounded(&f).audio);
            assert_eq!(back.toasts, f.toasts);
            assert_eq!(back.haptics, f.haptics);
            assert_eq!(back.music, rounded(&f).music);
            assert_eq!(back.background, f.background);
        }
        // Sizes: image 9 words, line 8, poly 6 + 2n, synth 5 + n, sample 4, haptic 1.
        let mut out = Vec::new();
        enc.encode(&sample_v2(), &mut out);
        let words = HEADER_WORDS + (12 + 9 + 13) + 9 + 8 + (6 + 6) + 6 + (5 + 4) + (5 + 1) + 4 + 2 + 2;
        assert_eq!(out.len(), 4 * words);
    }

    /// v0.2.2: a clipped, cropped image.
    fn sample_v22() -> Frame {
        let mut f = sample_v2();
        f.ops.push(DrawOp::Clip(ClipOp { x: 20.0, y: 40.5, w: 200.0, h: 150.25 }));
        f.ops.push(DrawOp::Image(ImageOp {
            x: 20.0,
            y: 40.5,
            w: 200.0,
            h: 200.0,
            asset: 1,
            frame: 0,
            flip_x: false,
            flip_y: true,
            rotation: 0.0,
            scale: 1.0,
            opacity: 1.0,
            src: Some([8.0, 4.5, 16.0, 12.25]),
        }));
        f.ops.push(DrawOp::Unclip);
        f
    }

    #[test]
    fn clip_and_image_src_json() {
        let mut out = Vec::new();
        frame_json(&sample_v22(), &mut out);
        let v: serde_json::Value = serde_json::from_slice(&out).expect("valid JSON");
        let ops = v["ops"].as_array().unwrap();
        assert_eq!(ops.len(), 10);
        // An image without a source rect has no src fields (old frames unchanged).
        assert!(ops[3].get("src_x").is_none());
        assert_eq!(ops[7], serde_json::json!({"op": "clip", "x": 20, "y": 40.5, "w": 200, "h": 150.25}));
        assert_eq!(
            ops[8],
            serde_json::json!({"op": "image", "x": 20, "y": 40.5, "w": 200, "h": 200, "asset": 1, "frame": 0,
                "flip_x": false, "flip_y": true, "rotation": 0, "scale": 1, "opacity": 1,
                "src_x": 8, "src_y": 4.5, "src_w": 16, "src_h": 12.25})
        );
        assert_eq!(ops[9], serde_json::json!({"op": "unclip"}));
    }

    #[test]
    fn clip_and_image_src_binary() {
        let mut enc = BinEncoder::new();
        let mut strings = Vec::new();
        let f = sample_v22();
        let mut out = Vec::new();
        enc.encode(&f, &mut out);
        let back = decode(&out, &mut strings);
        assert_eq!(back.ops, rounded(&f).ops);
        // The v0.2 frame plus clip 5 words, image with src 9 + 4, unclip 1.
        let mut v2 = Vec::new();
        BinEncoder::new().encode(&sample_v2(), &mut v2);
        assert_eq!(out.len(), v2.len() + 4 * (5 + 13 + 1));
        // Just the new ops: clip at word 13, the image head (flip_y and the
        // src flag only) at 18, unclip at 31.
        let only = Frame { ops: f.ops[7..].to_vec(), ..Frame::default() };
        let mut out = Vec::new();
        BinEncoder::new().encode(&only, &mut out);
        let word = |i: usize| u32::from_le_bytes(out[4 * i..4 * i + 4].try_into().unwrap());
        assert_eq!(out.len(), 4 * (HEADER_WORDS + 19));
        assert_eq!(word(HEADER_WORDS), OP_CLIP);
        assert_eq!(word(HEADER_WORDS + 5), OP_IMAGE | IMAGE_FLIP_Y | IMAGE_SRC);
        assert_eq!(word(HEADER_WORDS + 18), OP_UNCLIP);
        assert_eq!(decode(&out, &mut Vec::new()).ops, rounded(&only).ops);
    }

    /// v0.2.1: a wrapped, outlined text op.
    fn outlined(text: &str, stroke: Option<u32>, stroke_width: f64) -> DrawOp {
        DrawOp::Text(TextOp {
            x: 4.0,
            y: 8.0,
            w: 120.0,
            h: 45.0,
            text: Rc::from(text),
            line_height: 22.5,
            size: 18.0,
            font: Rc::from("Inter"),
            weight: 400,
            color: 0xFFFF_FFFF,
            stroke,
            stroke_width,
            align: TextAlign::Left,
            valign: TextValign::Top,
            rotation: 0.0,
            scale: 1.0,
            opacity: 1.0,
        })
    }

    #[test]
    fn text_lines_and_stroke_round_trip() {
        let mut f = sample("x");
        f.ops = vec![
            outlined("two\nlines", Some(0x0000_00FF), 3.0),
            outlined("one line", Some(0x1122_33FF), 2.5),
            outlined("plain\nwrapped", None, 0.0),
            outlined("plain", None, 0.0),
        ];
        // JSON carries all three new fields.
        let mut out = Vec::new();
        frame_json(&f, &mut out);
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["ops"][0]["text"], "two\nlines");
        assert_eq!(v["ops"][0]["line_height"], 22.5);
        assert_eq!(v["ops"][0]["stroke"], "#000000");
        assert_eq!(v["ops"][0]["stroke_width"], 3);
        assert_eq!(v["ops"][3]["stroke"], serde_json::Value::Null);
        // Binary: head flags add 2 words for a stroke and 1 for several lines.
        let mut enc = BinEncoder::new();
        let mut out = Vec::new();
        enc.encode(&f, &mut out);
        let mut strings = Vec::new();
        let back = decode(&out, &mut strings);
        assert_eq!(back.ops, rounded(&f).ops);
        let mut again = Vec::new();
        enc.encode(&f, &mut again);
        let words = HEADER_WORDS + (13 + 2 + 1) + (13 + 2) + (13 + 1) + 13 + 6 + 2;
        assert_eq!(again.len(), 4 * words);
        let word = |i: usize| u32::from_le_bytes(again[i * 4..i * 4 + 4].try_into().unwrap());
        assert_eq!(word(HEADER_WORDS), OP_TEXT | TEXT_STROKE | TEXT_LINES);
    }

    #[test]
    fn binary_strings_sent_once() {
        let mut enc = BinEncoder::new();
        let mut a = Vec::new();
        enc.encode(&sample("Moves: 3"), &mut a);
        let word = |b: &[u8], i: usize| u32::from_le_bytes([b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]]);
        assert_eq!(word(&a, 0), MAGIC);
        assert_eq!(word(&a, 1), FLAG_RESET_STRINGS);
        assert_eq!(word(&a, 6), 3); // "Moves: 3", "Inter", toast text
        assert_eq!(word(&a, 7), 3);
        assert_eq!(word(&a, 11), NO_MUSIC);
        let mut b = Vec::new();
        enc.encode(&sample("Moves: 3"), &mut b);
        assert_eq!(word(&b, 1), 0);
        assert_eq!(word(&b, 6), 0);
        // header + ops (12 + 9 + 13 words) + audio (synth, 1 note: 6) + toast (2)
        assert_eq!(b.len(), 4 * (HEADER_WORDS + 12 + 9 + 13 + 6 + 2));
        let mut c = Vec::new();
        enc.encode(&sample("Moves: 4"), &mut c);
        assert_eq!(word(&c, 6), 1);
        assert_eq!(word(&c, HEADER_WORDS), 3); // new id
        assert_eq!(word(&c, HEADER_WORDS + 1), 8); // byte length
    }
}
