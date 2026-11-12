//! Frame encoders: the B4 JSON shape and the compact binary format described
//! in `engine/web/FRAME_FORMAT.md`. Both are plain functions over
//! `mg_core::frame::Frame`, so the CLI can benchmark them natively.

use std::collections::HashMap;
use std::rc::Rc;

use mg_core::color::{to_hex, Rgba};
use mg_core::frame::{DrawOp, Frame, Wave};
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
                out.push(b'}');
            }
        }
    }
    out.extend_from_slice(b"],\"audio\":[");
    for (i, s) in f.audio.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        out.extend_from_slice(b"{\"wave\":\"");
        out.extend_from_slice(s.wave.name().as_bytes());
        out.extend_from_slice(b"\",\"freq\":");
        num(out, s.freq_hz);
        field_num(out, "ms", s.ms);
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
    out.extend_from_slice(b"],\"shake\":{\"px\":");
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

pub const MAGIC: u32 = 0x3146_474D; // "MGF1" little-endian
pub const FLAG_RESET_STRINGS: u32 = 1;
pub const OP_RECT: u32 = 1;
pub const OP_CIRCLE: u32 = 2;
pub const OP_TEXT: u32 = 3;
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
                    put_u32(&mut body, OP_TEXT);
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
                }
            }
        }
        for s in &f.audio {
            let wave = match s.wave {
                Wave::Sine => 0,
                Wave::Square => 1,
                Wave::Triangle => 2,
                Wave::Sawtooth => 3,
            };
            put_u32(&mut body, wave);
            put_f32(&mut body, s.freq_hz);
            put_f32(&mut body, s.ms);
        }
        for t in &f.toasts {
            let id = self.intern(&t.text);
            put_u32(&mut body, id);
            put_f32(&mut body, t.ms);
        }

        out.reserve(40 + self.strs.len() + body.len());
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
    use mg_core::frame::{CircleOp, RectOp, Sound, TextOp, Toast};

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
                    size: 18.0,
                    font: Rc::from("Inter"),
                    weight: 700,
                    color: 0x1A1A_1AFF,
                    align: TextAlign::Right,
                    valign: TextValign::Bottom,
                    rotation: 0.0,
                    scale: 1.0,
                    opacity: 1.0,
                }),
            ],
            audio: vec![Sound { wave: Wave::Triangle, freq_hz: 440.0, ms: 60.0 }],
            toasts: vec![Toast { text: Rc::from("hi \"there\"\n"), ms: 1500.0 }],
            shake_px: 0.0,
        }
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
        assert_eq!(v["audio"][0]["wave"], "triangle");
        assert_eq!(v["shake"]["px"], 0);
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
        let mut b = Vec::new();
        enc.encode(&sample("Moves: 3"), &mut b);
        assert_eq!(word(&b, 1), 0);
        assert_eq!(word(&b, 6), 0);
        // header + ops (12 + 9 + 13 words) + audio (3) + toast (2)
        assert_eq!(b.len(), 4 * (10 + 12 + 9 + 13 + 3 + 2));
        let mut c = Vec::new();
        enc.encode(&sample("Moves: 4"), &mut c);
        assert_eq!(word(&c, 6), 1);
        assert_eq!(word(&c, 10), 3); // new id
        assert_eq!(word(&c, 11), 8); // byte length
    }
}
