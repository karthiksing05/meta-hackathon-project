//! Space concepts: the play surface (grid, lanes, cards, words, timeline, photo, rhythm, map, canvas).

use super::board::{timeline_reset, word_reset};
use super::world::{dist, Ent, DT, H, W};
use super::{bad, good, num, pick_item};
use crate::concepts::{Params, System};
use crate::game::Game;
use crate::types::Event;
use serde_json::{json, Value};

fn later_level(ev: &Event) -> bool {
    ev.name == "level.started" && ev.data["level"].as_i64().unwrap_or(1) > 1
}

/// Space that only configures the world.
pub struct Plain {
    id: &'static str,
    space: &'static str,
    cols: i64,
    rows: i64,
    lanes: i64,
    gravity: f64,
    scroll: f64,
    flow: (f64, f64),
    xy: bool,
    bg: String,
}
impl System for Plain {
    fn id(&self) -> &'static str {
        self.id
    }
    fn init(&mut self, g: &mut Game) {
        let w = &mut g.world;
        w.space = self.space.into();
        w.cols = self.cols;
        w.rows = self.rows;
        w.lanes = self.lanes;
        w.gravity = w.gravity.max(self.gravity);
        if self.scroll > 0.0 {
            w.scroll_speed = self.scroll;
            w.base_speed = self.scroll;
        }
        w.flow = self.flow;
        w.axis_xy = self.xy;
        if !self.bg.is_empty() {
            w.bg = self.bg.clone();
        }
    }
    fn on_event(&mut self, _ev: &Event, _g: &mut Game) {}
}

pub struct FreeCanvas {
    trace: bool,
    bg: String,
    strokes_used: i64,
}
impl FreeCanvas {
    fn new_shape(&mut self, g: &mut Game) {
        g.world.strokes.clear();
        self.strokes_used = 0;
        let Some(i) = pick_item(g, "shape", |_| true) else { return };
        let it = g.items[i].clone();
        let pts: Vec<Value> = it
            .choices
            .iter()
            .filter_map(|c| {
                let (a, b) = c.split_once(',')?;
                Some(json!([a.trim().parse::<f64>().ok()? / 100.0 * W, b.trim().parse::<f64>().ok()? / 100.0 * (H - 120.0) + 60.0]))
            })
            .collect();
        g.world.extra.insert("trace".into(), json!({ "name": it.prompt, "points": pts, "coverage": 0 }));
    }
}
impl System for FreeCanvas {
    fn id(&self) -> &'static str {
        "space.free_canvas"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.space = "canvas".into();
        g.world.bg = self.bg.clone();
        g.world.axis_xy = true;
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if !self.trace {
            return;
        }
        if ev.name == "session.loaded" || later_level(ev) {
            self.new_shape(g);
        } else if ev.name == "input.draw" {
            self.strokes_used += 1;
            let pts: Vec<(f64, f64)> = g
                .world
                .strokes
                .iter()
                .filter_map(|s| s["points"].as_array())
                .flatten()
                .filter_map(|p| Some((p[0].as_f64()?, p[1].as_f64()?)))
                .collect();
            let targets: Vec<(f64, f64)> = g.world.extra["trace"]["points"]
                .as_array()
                .map(|a| a.iter().filter_map(|p| Some((p[0].as_f64()?, p[1].as_f64()?))).collect())
                .unwrap_or_default();
            if targets.is_empty() {
                return;
            }
            let hit = targets.iter().filter(|t| pts.iter().any(|p| dist(p.0, p.1, t.0, t.1) < 34.0)).count();
            let cov = hit * 100 / targets.len();
            if let Some(t) = g.world.extra.get_mut("trace") {
                t["coverage"] = json!(cov);
            }
            g.hud_set("coverage", json!(format!("{cov}%")));
            if cov >= 75 {
                good(g);
                g.finish(true);
            } else if self.strokes_used >= 6 {
                bad(g, -1);
                g.world.toast("Try again");
                g.world.strokes.clear();
                self.strokes_used = 0;
            }
        }
    }
}

pub struct WordGrid {
    pub len: i64,
}
impl System for WordGrid {
    fn id(&self) -> &'static str {
        "space.word_grid"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.space = "words".into();
        g.world.word_len = self.len;
        let dict: Vec<String> = g.items.iter().filter(|i| i.kind == "word").map(|i| i.prompt.trim().to_uppercase()).collect();
        g.world.secret.insert("dict".into(), json!(dict));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "session.loaded" || later_level(ev) {
            word_reset(g);
        }
    }
}

pub struct TimelineStrip {
    pub slots: i64,
}
impl System for TimelineStrip {
    fn id(&self) -> &'static str {
        "space.timeline_strip"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.space = "timeline".into();
        g.world.slots = self.slots;
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "session.loaded" || later_level(ev) {
            timeline_reset(g);
        }
    }
}

pub struct PhotoStage {
    pub fit: String,
}
impl PhotoStage {
    fn build(&self, g: &mut Game) {
        g.world.clear_role("hotspot");
        let items: Vec<_> = g.items.iter().filter(|i| i.kind == "hotspot").cloned().collect();
        g.world.photo = items.iter().find_map(|i| i.media_url.clone());
        for it in &items {
            let x: f64 = it.choices.first().and_then(|c| c.trim().parse().ok()).unwrap_or(50.0);
            let y: f64 = it.choices.get(1).and_then(|c| c.trim().parse().ok()).unwrap_or(50.0);
            let mut e = Ent::new("hotspot", &it.prompt, x / 100.0 * W, y / 100.0 * H, 30.0);
            e.state = "hidden";
            e.kind = it.prompt.clone();
            g.world.add(e);
        }
        self.publish(g);
    }
    fn publish(&self, g: &mut Game) {
        let list: Vec<Value> = g.world.ents.iter().filter(|e| e.role == "hotspot").map(|e| json!({ "label": e.label, "found": e.state == "found" })).collect();
        let found = list.iter().filter(|l| l["found"] == true).count();
        g.hud_set("found", json!(format!("{found}/{}", list.len())));
        g.world.extra.insert("find".into(), json!(list));
    }
}
impl System for PhotoStage {
    fn id(&self) -> &'static str {
        "space.photo_stage"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.space = "photo".into();
        g.world.fit = self.fit.clone();
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "session.loaded" || later_level(ev) {
            self.build(g);
        } else if ev.name == "input.tap" {
            let (x, y) = (num(&ev.data["x"]), num(&ev.data["y"]));
            let slop = g.world.hit_slop;
            let hit = g.world.ents.iter().find(|e| e.role == "hotspot" && e.state == "hidden" && dist(x, y, e.x, e.y) <= e.r + slop).map(|e| e.id);
            match hit {
                Some(id) => {
                    let label = g.world.get(id).map(|e| e.label.clone()).unwrap_or_default();
                    if let Some(e) = g.world.get_mut(id) {
                        e.state = "found";
                    }
                    g.emit("entity.collected", json!({ "kind": label, "value": 1 }));
                    good(g);
                    self.publish(g);
                    if !g.world.ents.iter().any(|e| e.role == "hotspot" && e.state == "hidden") {
                        g.finish(true);
                    }
                }
                None => {
                    bad(g, -1);
                    g.world.toast("Nothing there");
                }
            }
        }
    }
}

const HIT_Y: f64 = H - 110.0;
const TRAVEL_S: f64 = 1.6;

pub struct RhythmTrack {
    pub bpm: i64,
    pub beats: i64,
    spawned: i64,
    resolved: i64,
    acc_us: i64,
    combo: i64,
}
impl RhythmTrack {
    fn speed() -> f64 {
        (HIT_Y + 20.0) / TRAVEL_S
    }
}
impl System for RhythmTrack {
    fn id(&self) -> &'static str {
        "space.rhythm_track"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.space = "rhythm".into();
        g.world.lanes = 4;
        g.world.extra.insert("hit_y".into(), json!(HIT_Y));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        let beat_us = 60_000_000 / self.bpm.max(1);
        match ev.name.as_str() {
            "session.started" => self.acc_us = beat_us,
            "tick" => {
                let sp = Self::speed();
                let mut passed = Vec::new();
                for n in g.world.ents.iter_mut().filter(|e| e.role == "note") {
                    n.y += sp * DT;
                    if n.y > HIT_Y + sp * 0.16 {
                        passed.push(n.id);
                    }
                }
                for id in passed {
                    g.world.remove(id);
                    self.resolved += 1;
                    self.combo = 0;
                    g.hud_set("combo", json!(0));
                    g.emit("beat.hit", json!({ "grade": "miss" }));
                    bad(g, -1);
                }
                if self.spawned < self.beats {
                    self.acc_us += crate::game::TICK_US;
                    if self.acc_us >= beat_us {
                        self.acc_us -= beat_us;
                        let lane = g.rng.below(4) as i64;
                        let mut e = Ent::new("note", "●", g.world.lane_x(lane), -20.0, 22.0);
                        e.lane = lane;
                        g.world.add(e);
                        self.spawned += 1;
                    }
                }
                if self.spawned >= self.beats && self.resolved >= self.beats {
                    self.resolved = i64::MIN / 2;
                    g.finish(true);
                }
            }
            "input.tap" => {
                let (x, _) = (num(&ev.data["x"]), 0);
                let lane = ((x / (W / 4.0)).floor() as i64).clamp(0, 3);
                let sp = Self::speed();
                let best = g
                    .world
                    .ents
                    .iter()
                    .filter(|e| e.role == "note" && e.lane == lane && (e.y - HIT_Y).abs() <= sp * 0.16 + 4.0)
                    .min_by(|a, b| (a.y - HIT_Y).abs().partial_cmp(&(b.y - HIT_Y).abs()).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|e| (e.id, (e.y - HIT_Y).abs()));
                if let Some((id, off)) = best {
                    g.world.remove(id);
                    self.resolved += 1;
                    self.combo += 1;
                    g.hud_set("combo", json!(self.combo));
                    let grade = if off <= sp * 0.06 { "perfect" } else { "good" };
                    g.emit("beat.hit", json!({ "grade": grade }));
                    good(g);
                    if grade == "perfect" {
                        good(g);
                    }
                    g.world.toast(grade);
                }
            }
            _ => {}
        }
    }
}

pub struct MapView {
    pub zoom: i64,
}
impl MapView {
    fn build(&self, g: &mut Game) {
        g.world.clear_role("pin");
        let items: Vec<_> = g.items.iter().filter(|i| i.kind == "place").take(5).cloned().collect();
        let mut targets = Vec::new();
        for (k, it) in items.iter().enumerate() {
            let tx: f64 = it.choices.first().and_then(|c| c.trim().parse().ok()).unwrap_or(50.0);
            let ty: f64 = it.choices.get(1).and_then(|c| c.trim().parse().ok()).unwrap_or(50.0);
            targets.push(json!([tx / 100.0 * W, 60.0 + ty / 100.0 * (H - 220.0)]));
            let n = items.len() as f64;
            let mut e = Ent::new("pin", &it.prompt, 8.0 + (W - 16.0) * (k as f64 + 0.5) / n, H - 70.0, 20.0);
            e.hw = ((W - 16.0) / n / 2.0).min(60.0);
            e.hh = 22.0;
            e.tag = k as i64;
            e.kind = it.prompt.clone();
            g.world.add(e);
        }
        g.world.secret.insert("targets".into(), Value::Array(targets));
        g.hud_set("pinned", json!(format!("0/{}", items.len())));
    }
}
impl System for MapView {
    fn id(&self) -> &'static str {
        "space.map_view"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.space = "map".into();
        g.world.zoom = self.zoom;
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "session.loaded" || later_level(ev) {
            self.build(g);
        } else if ev.name == "input.drag" && ev.data["phase"] == "end" {
            let Some(id) = ev.data["id"].as_u64().map(|i| i as u32) else { return };
            let Some(pin) = g.world.get(id).filter(|e| e.role == "pin").cloned() else { return };
            let t = g.world.secret["targets"][pin.tag as usize].clone();
            let (tx, ty) = (num(&t[0]), num(&t[1]));
            let tol = (150.0 / self.zoom.max(1) as f64).max(32.0);
            if dist(num(&ev.data["x"]), num(&ev.data["y"]), tx, ty) <= tol {
                if let Some(e) = g.world.get_mut(id) {
                    e.x = tx;
                    e.y = ty;
                    e.state = "locked";
                }
                good(g);
                let n = g.world.ents.iter().filter(|e| e.role == "pin").count();
                let done = g.world.ents.iter().filter(|e| e.role == "pin" && e.state == "locked").count();
                g.hud_set("pinned", json!(format!("{done}/{n}")));
                if done == n {
                    g.finish(true);
                }
            } else {
                if let Some(e) = g.world.get_mut(id) {
                    e.x = e.ox;
                    e.y = e.oy;
                }
                bad(g, -1);
                g.world.toast("Not quite there");
            }
        }
    }
}

pub fn build(id: &str, p: &Params) -> Option<Box<dyn System>> {
    let plain = |id: &'static str, space: &'static str| Plain {
        id,
        space,
        cols: 0,
        rows: 0,
        lanes: 0,
        gravity: 0.0,
        scroll: 0.0,
        flow: (0.0, 1.0),
        xy: false,
        bg: String::new(),
    };
    Some(match id {
        "space.grid_board" => Box::new(Plain { cols: p.int("cols"), rows: p.int("rows"), ..plain("space.grid_board", "grid") }),
        "space.lanes" => Box::new(Plain { lanes: p.int("lane_count"), ..plain("space.lanes", "lanes") }),
        "space.scrolling_world" => {
            let flow = match p.string("direction").as_str() {
                "up" => (0.0, -1.0),
                "down" => (0.0, 1.0),
                _ => (-1.0, 0.0),
            };
            Box::new(Plain { scroll: p.float("speed"), flow, xy: true, ..plain("space.scrolling_world", "scroll") })
        }
        "space.card_table" => Box::new(Plain { cols: p.int("cols"), ..plain("space.card_table", "cards") }),
        "space.physics_world" => Box::new(Plain { gravity: p.float("gravity"), xy: true, ..plain("space.physics_world", "physics") }),
        "space.free_canvas" => Box::new(FreeCanvas { trace: p.string("goal") == "trace", bg: p.string("background"), strokes_used: 0 }),
        "space.word_grid" => Box::new(WordGrid { len: p.int("word_length") }),
        "space.timeline_strip" => Box::new(TimelineStrip { slots: p.int("slots") }),
        "space.photo_stage" => Box::new(PhotoStage { fit: p.string("fit") }),
        "space.rhythm_track" => Box::new(RhythmTrack { bpm: p.int("bpm"), beats: p.int("beats"), spawned: 0, resolved: 0, acc_us: 0, combo: 0 }),
        "space.map_view" => Box::new(MapView { zoom: p.int("zoom") }),
        _ => return None,
    })
}

