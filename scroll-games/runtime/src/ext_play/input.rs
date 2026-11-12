//! Input concepts: turn raw host input into semantic events.

use super::world::{DT, H, W};
use super::{num, raw};
use crate::concepts::{Params, System};
use crate::game::{Game, TICK_US};
use crate::types::Event;
use serde_json::{json, Value};

pub struct SwipeDirection {
    pub min: f64,
    pub dirs: String,
}
impl System for SwipeDirection {
    fn id(&self) -> &'static str {
        "input.swipe_direction"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.input.insert("swipe".into(), json!({ "min": self.min }));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        let Some(v) = raw(ev, "swipe") else { return };
        let (dx, dy) = (num(&v["dx"]), num(&v["dy"]));
        if (dx * dx + dy * dy).sqrt() < self.min {
            return;
        }
        let horizontal = dx.abs() >= dy.abs();
        match self.dirs.as_str() {
            "two_horizontal" if !horizontal => return,
            "two_vertical" if horizontal => return,
            _ => {}
        }
        let dir = if horizontal {
            if dx < 0.0 { "left" } else { "right" }
        } else if dy < 0.0 {
            "up"
        } else {
            "down"
        };
        g.emit("input.swipe", json!({ "dir": dir, "dx": dx, "dy": dy, "x": num(&v["x"]), "y": num(&v["y"]) }));
    }
}

pub struct TapTarget {
    pub slop: f64,
}
impl System for TapTarget {
    fn id(&self) -> &'static str {
        "input.tap_target"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.hit_slop = self.slop;
        g.world.input.insert("tap".into(), json!(true));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if let Some(v) = raw(ev, "tap") {
            g.emit("input.tap", json!({ "x": num(&v["x"]).clamp(0.0, W), "y": num(&v["y"]).clamp(0.0, H) }));
        }
    }
}

pub struct DoubleTap {
    pub window_ticks: i64,
    ticks: i64,
    last: Option<i64>,
}
impl DoubleTap {
    pub fn new(window_ms: i64) -> Self {
        DoubleTap { window_ticks: (window_ms * 60 / 1000).max(1), ticks: 0, last: None }
    }
}
impl System for DoubleTap {
    fn id(&self) -> &'static str {
        "input.double_tap"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.input.insert("tap".into(), json!(true));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "tick" {
            self.ticks += 1;
            return;
        }
        let Some(v) = raw(ev, "tap") else { return };
        match self.last {
            Some(t) if self.ticks - t <= self.window_ticks => {
                self.last = None;
                g.emit("input.tap", json!({ "x": num(&v["x"]).clamp(0.0, W), "y": num(&v["y"]).clamp(0.0, H), "double": true }));
            }
            _ => self.last = Some(self.ticks),
        }
    }
}

const DRAGGABLE: [&str; 3] = ["event", "pin", "token"];

pub struct DragDrop {
    pub snap: f64,
    held: Option<u32>,
}
impl DragDrop {
    pub fn new(snap: f64) -> Self {
        DragDrop { snap, held: None }
    }
}
impl System for DragDrop {
    fn id(&self) -> &'static str {
        "input.drag_drop"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.input.insert("drag".into(), json!(true));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        let Some(v) = raw(ev, "drag") else { return };
        let (x, y) = (num(&v["x"]).clamp(0.0, W), num(&v["y"]).clamp(0.0, H));
        let phase = v["phase"].as_str().unwrap_or("move").to_string();
        let mut slot = -1i64;
        match phase.as_str() {
            "start" => {
                self.held = g
                    .world
                    .ents
                    .iter()
                    .rev()
                    .find(|e| DRAGGABLE.contains(&e.role) && e.state != "locked" && (x - e.x).abs() <= e.hw + 8.0 && (y - e.y).abs() <= e.hh + 8.0)
                    .map(|e| e.id);
                if let Some(e) = self.held.and_then(|id| g.world.get_mut(id)) {
                    e.ox = e.x;
                    e.oy = e.y;
                    e.slot = -1;
                    e.state = "drag";
                }
            }
            "move" => {
                if let Some(e) = self.held.and_then(|id| g.world.get_mut(id)) {
                    e.x = x;
                    e.y = y;
                }
            }
            "end" => {
                if let Some(id) = self.held.take() {
                    let zone = g
                        .world
                        .zones
                        .iter()
                        .enumerate()
                        .map(|(i, z)| (i, ((x - z.0).powi(2) + (y - z.1).powi(2)).sqrt(), *z))
                        .filter(|(_, d, z)| *d <= z.2 + self.snap)
                        .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
                    if let Some(e) = g.world.get_mut(id) {
                        e.state = "idle";
                        if let Some((i, _, z)) = zone {
                            e.x = z.0;
                            e.y = z.1;
                            e.slot = i as i64;
                            slot = i as i64;
                        } else {
                            e.x = e.ox;
                            e.y = e.oy;
                        }
                    }
                    g.world.extra.insert("dropped".into(), json!(id));
                }
            }
            _ => return,
        }
        let id = if phase == "end" { g.world.extra.get("dropped").cloned().unwrap_or(Value::Null) } else { json!(self.held) };
        g.emit("input.drag", json!({ "x": x, "y": y, "phase": phase, "id": id, "slot": slot }));
    }
}

pub struct HoldRelease {
    pub max_ticks: i64,
    held: Option<i64>,
}
impl HoldRelease {
    pub fn new(max_ms: i64) -> Self {
        HoldRelease { max_ticks: (max_ms * 60 / 1000).max(1), held: None }
    }
    fn release(&mut self, g: &mut Game) {
        if let Some(t) = self.held.take() {
            g.world.extra.remove("hold");
            g.emit("input.hold", json!({ "ms": t * TICK_US / 1000 }));
        }
    }
}
impl System for HoldRelease {
    fn id(&self) -> &'static str {
        "input.hold_release"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.input.insert("hold".into(), json!({ "max_ms": self.max_ticks * TICK_US / 1000 }));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "tick" {
            if let Some(t) = self.held.as_mut() {
                *t += 1;
                let ms = *t * TICK_US / 1000;
                g.world.extra.insert("hold".into(), json!({ "ms": ms, "max": self.max_ticks * TICK_US / 1000 }));
                if *t >= self.max_ticks {
                    self.release(g);
                }
            }
        } else if raw(ev, "press").is_some() {
            if self.held.is_none() {
                self.held = Some(0);
            }
        } else if raw(ev, "release").is_some() {
            self.release(g);
        }
    }
}

pub struct TextEntry {
    pub max_chars: usize,
    pub case_sensitive: bool,
}
fn clean_text(v: &Value, max: usize, case: bool) -> Option<String> {
    let t: String = v["text"].as_str()?.trim().chars().take(max).collect();
    if t.is_empty() {
        return None;
    }
    Some(if case { t } else { t.to_lowercase() })
}
impl System for TextEntry {
    fn id(&self) -> &'static str {
        "input.text_entry"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.input.insert("text".into(), json!({ "max_chars": self.max_chars }));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if let Some(t) = raw(ev, "text").and_then(|v| clean_text(v, self.max_chars, self.case_sensitive)) {
            g.emit("input.text", json!({ "text": t }));
        }
    }
}

pub struct VoiceAnswer {
    pub language: String,
}
impl System for VoiceAnswer {
    fn id(&self) -> &'static str {
        "input.voice_answer"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.input.insert("voice".into(), json!({ "language": self.language }));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if let Some(t) = raw(ev, "voice").and_then(|v| clean_text(v, 80, false)) {
            g.emit("input.text", json!({ "text": t, "voice": true }));
        }
    }
}

pub struct DrawStroke {
    pub brush: i64,
    pub color: String,
}
impl System for DrawStroke {
    fn id(&self) -> &'static str {
        "input.draw_stroke"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.input.insert("draw".into(), json!({ "brush": self.brush, "color": self.color }));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        let Some(v) = raw(ev, "draw") else { return };
        let Some(arr) = v["points"].as_array() else { return };
        let pts: Vec<Value> = arr
            .iter()
            .filter_map(|p| {
                let a = p.as_array()?;
                Some(json!([num(a.first()?).clamp(0.0, W).round(), num(a.get(1)?).clamp(0.0, H).round()]))
            })
            .take(160)
            .collect();
        if pts.len() < 2 {
            return;
        }
        if g.world.strokes.len() >= 48 {
            g.world.strokes.remove(0);
        }
        g.world.strokes.push(json!({ "points": pts, "brush": self.brush, "color": self.color }));
        g.emit("input.draw", json!({ "points": pts }));
    }
}

pub struct TiltSteer {
    pub sens: f64,
    x: f64,
}
impl TiltSteer {
    pub fn new(sens: f64) -> Self {
        TiltSteer { sens, x: W / 2.0 }
    }
}
impl System for TiltSteer {
    fn id(&self) -> &'static str {
        "input.tilt_steer"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.input.insert("tilt".into(), json!({ "sensitivity": self.sens }));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if let Some(v) = raw(ev, "tilt") {
            g.world.tilt = num(&v["x"]).clamp(-1.0, 1.0);
        } else if ev.name == "tick" && g.world.tilt.abs() > 0.05 {
            let nx = (self.x + g.world.tilt * self.sens * 240.0 * DT).clamp(0.0, W);
            if nx != self.x {
                self.x = nx;
                let y = g.world.first("avatar").map(|e| e.y).unwrap_or(H - 90.0);
                g.emit("input.drag", json!({ "x": nx, "y": y, "phase": "move", "id": Value::Null, "slot": -1 }));
            }
        }
    }
}

pub struct MultiSelect {
    pub max: usize,
    selected: Vec<usize>,
}
impl MultiSelect {
    pub fn new(max: usize) -> Self {
        MultiSelect { max, selected: Vec::new() }
    }
    fn paint(&self, g: &mut Game) {
        for (i, s) in g.round.states.iter_mut().enumerate() {
            if *s == "idle" || *s == "selected" {
                *s = if self.selected.contains(&i) { "selected" } else { "idle" };
            }
        }
    }
}
impl System for MultiSelect {
    fn id(&self) -> &'static str {
        "input.multi_select"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.input.insert("select".into(), json!({ "max": self.max }));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "round.started" {
            self.selected.clear();
            return;
        }
        if !g.round.active || g.round.locked {
            return;
        }
        if let Some(v) = raw(ev, "select") {
            let Some(i) = v["index"].as_u64().map(|i| i as usize).filter(|i| *i < g.round.choices.len()) else { return };
            if let Some(pos) = self.selected.iter().position(|s| *s == i) {
                self.selected.remove(pos);
            } else if self.selected.len() < self.max {
                self.selected.push(i);
            } else {
                g.world.toast("Selection is full");
            }
            self.paint(g);
        } else if raw(ev, "submit").is_some() && !self.selected.is_empty() {
            let mut picked = std::mem::take(&mut self.selected);
            picked.sort();
            self.paint(g);
            g.emit("input.choice", json!({ "index": picked[0], "indices": picked }));
        }
    }
}

pub struct RotaryDial {
    pub steps: i64,
}
impl System for RotaryDial {
    fn id(&self) -> &'static str {
        "input.rotary_dial"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.input.insert("dial".into(), json!({ "steps": self.steps }));
        g.world.extra.insert("dial".into(), json!({ "steps": self.steps, "value": 0 }));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        let Some(v) = raw(ev, "dial") else { return };
        let value = (num(&v["step"]) as i64).rem_euclid(self.steps);
        g.world.extra.insert("dial".into(), json!({ "steps": self.steps, "value": value }));
        g.emit("input.drag", json!({ "x": value, "y": self.steps, "phase": "dial", "id": Value::Null, "slot": -1 }));
    }
}

pub fn build(id: &str, p: &Params) -> Option<Box<dyn System>> {
    Some(match id {
        "input.swipe_direction" => Box::new(SwipeDirection { min: p.float("min_distance"), dirs: p.string("directions") }),
        "input.tap_target" => Box::new(TapTarget { slop: p.float("hit_slop") }),
        "input.drag_drop" => Box::new(DragDrop::new(p.float("snap_radius"))),
        "input.hold_release" => Box::new(HoldRelease::new(p.int("max_hold_ms"))),
        "input.text_entry" => Box::new(TextEntry { max_chars: p.int("max_chars").max(1) as usize, case_sensitive: p.bool("case_sensitive") }),
        "input.draw_stroke" => Box::new(DrawStroke { brush: p.int("brush_size"), color: p.string("color") }),
        "input.tilt_steer" => Box::new(TiltSteer::new(p.float("sensitivity"))),
        "input.double_tap" => Box::new(DoubleTap::new(p.int("window_ms"))),
        "input.multi_select" => Box::new(MultiSelect::new(p.int("max_selected").max(1) as usize)),
        "input.voice_answer" => Box::new(VoiceAnswer { language: p.string("language") }),
        "input.rotary_dial" => Box::new(RotaryDial { steps: p.int("steps").max(2) }),
        _ => return None,
    })
}
