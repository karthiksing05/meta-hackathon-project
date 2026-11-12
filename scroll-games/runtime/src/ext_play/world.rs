//! Spatial world shared by gameplay concepts: entities, geometry, integration, collision, view model.
//! Determinism: only + - * / and sqrt are used (no sin/cos/pow), so native and wasm agree bit for bit.

use crate::rng::Rng;
use crate::types::Event;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub const W: f64 = 360.0;
pub const H: f64 = 600.0;
pub const DT: f64 = 1.0 / 60.0;
pub const GSCALE: f64 = 30.0;
pub const MAX_ENTS: usize = 120;
const MARGIN: f64 = 50.0;

/// Roles that move under `integrate`.
const MOBILE: [&str; 7] = ["falling", "obstacle", "collectible", "enemy", "projectile", "ball", "particle"];

#[derive(Clone, Debug, Default)]
pub struct Ent {
    pub id: u32,
    pub role: &'static str,
    pub kind: String,
    pub label: String,
    pub img: Option<String>,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub r: f64,
    pub hw: f64,
    pub hh: f64,
    pub value: i64,
    pub dmg: i64,
    pub hp: i64,
    pub tag: i64,
    pub lane: i64,
    pub cell: i64,
    pub slot: i64,
    pub state: &'static str,
    pub timer: i64,
    pub ttl: i64,
    pub age: i64,
    pub ox: f64,
    pub oy: f64,
    pub dir: f64,
    pub phys: bool,
    pub speed: f64,
}

impl Ent {
    pub fn new(role: &'static str, label: &str, x: f64, y: f64, r: f64) -> Ent {
        Ent { role, label: label.to_string(), x, y, ox: x, oy: y, r, hw: r, hh: r, cell: -1, slot: -1, dir: 1.0, state: "idle", ..Default::default() }
    }
}

/// Recipe for a spawnable entity.
#[derive(Clone, Debug)]
pub struct Tmpl {
    pub role: &'static str,
    pub kind: String,
    pub label: String,
    pub speed: f64,
    pub r: f64,
    pub value: i64,
    pub dmg: i64,
    pub hp: i64,
    pub life_ms: i64,
    pub weight: u32,
}

#[derive(Clone, Debug)]
pub struct Freeze {
    pub kind: &'static str,
    pub text: String,
    pub remaining_us: i64,
    pub needs_ack: bool,
    pub ack_ready_us: i64,
}

#[derive(Clone, Debug)]
pub struct World {
    pub space: String,
    pub cols: i64,
    pub rows: i64,
    pub lanes: i64,
    pub slots: i64,
    pub word_len: i64,
    pub ents: Vec<Ent>,
    next_id: u32,
    pub flags: BTreeSet<String>,
    pub flow: (f64, f64),
    pub base_speed: f64,
    pub scroll_speed: f64,
    pub scroll_off: f64,
    pub gravity: f64,
    pub wrap: bool,
    pub axis_xy: bool,
    pub shared_collision: bool,
    pub circle: bool,
    pub rate: f64,
    pub difficulty: f64,
    pub level: i64,
    pub levels: i64,
    pub levels_on: bool,
    pub endless: bool,
    pub absorb: bool,
    pub finger: Option<(f64, f64)>,
    pub tilt: f64,
    pub hit_slop: f64,
    pub bg: String,
    pub photo: Option<String>,
    pub fit: String,
    pub drift: f64,
    pub zoom: i64,
    pub strokes: Vec<Value>,
    pub hud: BTreeMap<String, Value>,
    pub toast: (String, i64),
    pub freeze: Option<Freeze>,
    pub input: Map<String, Value>,
    pub templates: Vec<Tmpl>,
    pub zones: Vec<(f64, f64, f64)>,
    pub extra: Map<String, Value>,
    /// Hidden state shared between systems (never sent to the renderer).
    pub secret: Map<String, Value>,
}

impl World {
    pub fn new() -> World {
        World {
            space: String::new(),
            cols: 0,
            rows: 0,
            lanes: 0,
            slots: 0,
            word_len: 5,
            ents: Vec::new(),
            next_id: 1,
            flags: BTreeSet::new(),
            flow: (0.0, 1.0),
            base_speed: 160.0,
            scroll_speed: 0.0,
            scroll_off: 0.0,
            gravity: 0.0,
            wrap: false,
            axis_xy: false,
            shared_collision: false,
            circle: true,
            rate: 1.0,
            difficulty: 0.0,
            level: 1,
            levels: 0,
            levels_on: false,
            endless: false,
            absorb: false,
            finger: None,
            tilt: 0.0,
            hit_slop: 8.0,
            bg: "#101018".into(),
            photo: None,
            fit: "cover".into(),
            drift: 0.0,
            zoom: 3,
            strokes: Vec::new(),
            hud: BTreeMap::new(),
            toast: (String::new(), 0),
            freeze: None,
            input: Map::new(),
            templates: Vec::new(),
            zones: Vec::new(),
            extra: Map::new(),
            secret: Map::new(),
        }
    }

    pub fn has(&self, f: &str) -> bool {
        self.flags.contains(f)
    }

    pub fn flag(&mut self, f: &str) {
        self.flags.insert(f.to_string());
    }

    pub fn add(&mut self, mut e: Ent) -> u32 {
        e.id = self.next_id;
        self.next_id += 1;
        let id = e.id;
        self.ents.push(e);
        id
    }

    pub fn get(&self, id: u32) -> Option<&Ent> {
        self.ents.iter().find(|e| e.id == id)
    }

    pub fn get_mut(&mut self, id: u32) -> Option<&mut Ent> {
        self.ents.iter_mut().find(|e| e.id == id)
    }

    pub fn remove(&mut self, id: u32) {
        self.ents.retain(|e| e.id != id);
    }

    pub fn clear_role(&mut self, role: &str) {
        self.ents.retain(|e| e.role != role);
    }

    pub fn ids(&self, role: &str) -> Vec<u32> {
        self.ents.iter().filter(|e| e.role == role).map(|e| e.id).collect()
    }

    pub fn first(&self, role: &str) -> Option<&Ent> {
        self.ents.iter().find(|e| e.role == role)
    }

    pub fn first_mut(&mut self, role: &str) -> Option<&mut Ent> {
        self.ents.iter_mut().find(|e| e.role == role)
    }

    pub fn count(&self, role: &str) -> usize {
        self.ents.iter().filter(|e| e.role == role).count()
    }

    pub fn at(&self, role: &str, x: f64, y: f64, slop: f64) -> Option<u32> {
        self.ents
            .iter()
            .rev()
            .find(|e| e.role == role && e.state != "gone" && (x - e.x).abs() <= e.hw + slop && (y - e.y).abs() <= e.hh + slop)
            .map(|e| e.id)
    }

    /// Cell grid geometry: (origin x, origin y, cell size).
    pub fn grid_geom(&self) -> (f64, f64, f64) {
        let cols = self.cols.max(1) as f64;
        let rows = self.rows.max(1) as f64;
        let s = ((W - 20.0) / cols).min((H - 160.0) / rows).floor();
        ((W - s * cols) / 2.0, (H - s * rows) / 2.0 - 10.0, s)
    }

    pub fn cell_center(&self, col: i64, row: i64) -> (f64, f64) {
        let (ox, oy, s) = self.grid_geom();
        (ox + (col as f64 + 0.5) * s, oy + (row as f64 + 0.5) * s)
    }

    pub fn cell_of(&self, x: f64, y: f64) -> Option<(i64, i64)> {
        let (ox, oy, s) = self.grid_geom();
        let c = ((x - ox) / s).floor() as i64;
        let r = ((y - oy) / s).floor() as i64;
        (c >= 0 && r >= 0 && c < self.cols && r < self.rows).then_some((c, r))
    }

    pub fn lane_x(&self, i: i64) -> f64 {
        let n = self.lanes.max(1) as f64;
        (i.clamp(0, self.lanes.max(1) - 1) as f64 + 0.5) * W / n
    }

    pub fn spawn_rate(&self) -> f64 {
        (self.rate * (1.0 + self.difficulty * 0.35)).max(0.1)
    }

    pub fn speed_mult(&self) -> f64 {
        1.0 + self.difficulty * 0.5
    }

    pub fn toast(&mut self, text: &str) {
        self.toast = (text.to_string(), 90);
    }

    pub fn clear_board(&mut self) {
        self.ents.clear();
        self.zones.clear();
        self.extra.clear();
        self.strokes.clear();
    }

    /// Move mobile entities one tick; cull or wrap those that leave the field.
    pub fn integrate(&mut self) -> Vec<Event> {
        let mut evs = Vec::new();
        if self.scroll_speed > 0.0 {
            self.scroll_off = (self.scroll_off + self.scroll_speed * DT) % 1000.0;
        }
        if let Some((_, left)) = Some(&mut self.toast) {
            if *left > 0 {
                *left -= 1;
            }
        }
        let g = self.gravity * GSCALE * DT;
        let wrap = self.wrap;
        let down = self.flow.1 > 0.0;
        let mut dead: Vec<(u32, &'static str, String, &'static str)> = Vec::new();
        for e in self.ents.iter_mut() {
            e.age += 1;
            if e.timer > 0 {
                e.timer -= 1;
            }
            if !MOBILE.contains(&e.role) {
                continue;
            }
            if e.phys && g > 0.0 && e.role != "projectile" {
                e.vy += g;
            }
            e.x += e.vx * DT;
            e.y += e.vy * DT;
            if e.ttl > 0 {
                e.ttl -= 1;
                if e.ttl == 0 {
                    dead.push((e.id, e.role, e.kind.clone(), "expired"));
                    continue;
                }
            }
            if e.role == "ball" {
                continue;
            }
            if e.role == "enemy" && down && e.y > H - 40.0 {
                let d = json!({ "a": "enemy", "b": "base", "ida": e.id, "damage": e.dmg.max(1), "harm": true });
                evs.push(Event::new("collision.hit", d));
                dead.push((e.id, e.role, e.kind.clone(), "landed"));
                continue;
            }
            let off = e.x < -MARGIN || e.x > W + MARGIN || e.y < -MARGIN || e.y > H + MARGIN;
            if off && e.cell < 0 {
                if wrap && e.role != "projectile" && e.role != "particle" {
                    if e.x < -MARGIN {
                        e.x = W + MARGIN - 1.0;
                    } else if e.x > W + MARGIN {
                        e.x = -MARGIN + 1.0;
                    }
                    if e.y < -MARGIN {
                        e.y = H + MARGIN - 1.0;
                    } else if e.y > H + MARGIN {
                        e.y = -MARGIN + 1.0;
                    }
                } else {
                    dead.push((e.id, e.role, e.kind.clone(), "offscreen"));
                }
            }
        }
        for (id, role, kind, reason) in dead {
            self.remove(id);
            if role != "particle" && role != "projectile" {
                evs.push(Event::new("entity.destroyed", json!({ "kind": kind, "role": role, "reason": reason })));
            }
        }
        evs
    }

    /// Overlap events for the standard role pairs.
    pub fn detect(&self, circle: bool) -> Vec<Event> {
        const PAIRS: [(&str, &str); 10] = [
            ("avatar", "obstacle"),
            ("avatar", "collectible"),
            ("avatar", "enemy"),
            ("avatar", "falling"),
            ("projectile", "enemy"),
            ("projectile", "obstacle"),
            ("ball", "paddle"),
            ("ball", "obstacle"),
            ("ball", "enemy"),
            ("ball", "avatar"),
        ];
        let mut out = Vec::new();
        for (ra, rb) in PAIRS {
            for a in self.ents.iter().filter(|e| e.role == ra) {
                for b in self.ents.iter().filter(|e| e.role == rb && e.state != "gone") {
                    let hit = if circle && ra != "paddle" && rb != "paddle" {
                        let (dx, dy, rr) = (a.x - b.x, a.y - b.y, a.r + b.r);
                        dx * dx + dy * dy < rr * rr
                    } else {
                        (a.x - b.x).abs() < a.hw + b.hw && (a.y - b.y).abs() < a.hh + b.hh
                    };
                    if hit {
                        let harm = ra == "avatar" && (rb == "obstacle" || rb == "enemy" || rb == "falling" && b.dmg > 0);
                        let d = json!({ "a": ra, "b": rb, "ida": a.id, "idb": b.id, "kind": b.kind,
                                        "damage": b.dmg.max(if harm { 1 } else { 0 }), "value": b.value, "harm": harm });
                        out.push(Event::new("collision.hit", d));
                    }
                }
            }
        }
        out
    }

    /// Create one entity from a template at the field edge (or a free cell on a grid).
    pub fn spawn(&mut self, rng: &mut Rng, t: &Tmpl) -> Option<u32> {
        if self.ents.len() >= MAX_ENTS {
            return None;
        }
        let mut e = Ent::new(t.role, &t.label, 0.0, 0.0, t.r);
        e.kind = t.kind.clone();
        e.value = t.value;
        e.dmg = t.dmg;
        e.hp = t.hp.max(1);
        e.phys = true;
        e.speed = t.speed;
        if self.space == "grid" || self.space == "cards" {
            let total = self.cols.max(1) * self.rows.max(1);
            let busy: Vec<i64> = self.ents.iter().filter(|x| x.cell >= 0 && MOBILE.contains(&x.role)).map(|x| x.cell).collect();
            let free: Vec<i64> = (0..total).filter(|c| !busy.contains(c)).collect();
            if free.is_empty() {
                return None;
            }
            let c = free[rng.below(free.len() as u32) as usize];
            let (x, y) = self.cell_center(c % self.cols, c / self.cols);
            let (_, _, s) = self.grid_geom();
            e.x = x;
            e.y = y;
            e.ox = x;
            e.oy = y;
            e.cell = c;
            e.r = e.r.min(s / 2.0 - 2.0).max(8.0);
            e.hw = e.r;
            e.hh = e.r;
            let life = if t.life_ms > 0 { t.life_ms } else { 1400 };
            let life = (life as f64 / (1.0 + self.difficulty * 0.4)) as i64;
            e.ttl = (life * 60 / 1000).max(20);
            e.phys = false;
            return Some(self.add(e));
        }
        let sp = t.speed.max(0.0) * self.speed_mult();
        let (fx, fy) = self.flow;
        if fx != 0.0 {
            e.x = if fx < 0.0 { W + t.r + 10.0 } else { -t.r - 10.0 };
            e.y = 60.0 + rng.below((H - 120.0) as u32) as f64;
        } else {
            e.x = if self.lanes > 0 {
                let l = rng.below(self.lanes as u32) as i64;
                e.lane = l;
                self.lane_x(l)
            } else {
                20.0 + rng.below((W - 40.0) as u32) as f64
            };
            e.y = if fy > 0.0 { -t.r - 10.0 } else { H + t.r + 10.0 };
        }
        e.ox = e.x;
        e.oy = e.y;
        e.vx = fx * sp;
        e.vy = fy * sp;
        if t.life_ms > 0 {
            e.ttl = (t.life_ms * 60 / 1000).max(1);
        }
        Some(self.add(e))
    }

    /// View model for the renderer.
    pub fn view(&self) -> Value {
        let ents: Vec<Value> = self
            .ents
            .iter()
            .filter(|e| e.state != "gone")
            .map(|e| {
                let hidden = e.role == "card" && e.state == "down";
                let (dx, dy) = if self.drift > 0.0 && e.role != "avatar" {
                    let t = (e.age * 3 + e.id as i64 * 37) % 240;
                    let tri = |p: i64| ((p % 120) as f64 - 60.0).abs() / 30.0 - 1.0;
                    (tri(t) * self.drift, tri(t + 60) * self.drift)
                } else {
                    (0.0, 0.0)
                };
                json!({ "id": e.id, "role": e.role, "label": if hidden { "" } else { e.label.as_str() },
                        "img": if hidden { Value::Null } else { json!(e.img) },
                        "x": round1(e.x + dx), "y": round1(e.y + dy), "r": round1(e.r), "hw": round1(e.hw), "hh": round1(e.hh),
                        "state": e.state, "tag": if e.role == "pad" || e.role == "tile" { e.tag } else { -1 } })
            })
            .collect();
        let toast = if self.toast.1 > 0 { json!(self.toast.0) } else { Value::Null };
        let overlay = self.freeze.as_ref().map(|f| {
            let ready = !f.needs_ack || f.ack_ready_us <= 0;
            json!({ "kind": f.kind, "text": f.text, "button": f.needs_ack && ready })
        });
        json!({
            "space": self.space, "w": W, "h": H, "bg": self.bg, "scroll": round1(self.scroll_off),
            "flow": [self.flow.0, self.flow.1],
            "cols": self.cols, "rows": self.rows, "lanes": self.lanes, "slots": self.slots,
            "grid": if self.cols > 0 && (self.space == "grid" || self.space == "cards") {
                let (ox, oy, s) = self.grid_geom(); json!({ "ox": ox, "oy": oy, "s": s })
            } else { Value::Null },
            "photo": self.photo, "fit": self.fit, "zoom": self.zoom,
            "ents": ents, "zones": self.zones.iter().map(|z| json!([round1(z.0), round1(z.1), round1(z.2)])).collect::<Vec<_>>(),
            "hud": self.hud, "toast": toast, "overlay": overlay,
            "input": self.input, "strokes": self.strokes, "extra": self.extra, "level": self.level,
        })
    }
}

pub fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

pub fn dist(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    ((ax - bx) * (ax - bx) + (ay - by) * (ay - by)).sqrt()
}
