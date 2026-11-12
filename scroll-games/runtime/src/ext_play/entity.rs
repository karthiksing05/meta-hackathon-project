//! Entity concepts: things that exist in the world.

use super::world::{Ent, Tmpl, H, W};
use super::{apply_hint, num};
use crate::concepts::{Params, System};
use crate::game::{Game, TICK_US};
use crate::rng::Rng;
use crate::types::Event;
use serde_json::json;

/// Spawns its own template when no `behavior.spawn_wave` drives the field.
struct SelfSpawn {
    tmpl: Tmpl,
    every_us: i64,
    acc: i64,
}
impl SelfSpawn {
    fn new(tmpl: Tmpl, every_ms: i64) -> Self {
        SelfSpawn { tmpl, every_us: every_ms * 1000, acc: 0 }
    }
    fn tick(&mut self, g: &mut Game) {
        if g.world.has("spawn_wave") || g.world.space.is_empty() || g.world.space == "choice" {
            return;
        }
        self.acc += (TICK_US as f64 * g.world.spawn_rate()) as i64;
        if self.acc >= self.every_us {
            self.acc -= self.every_us;
            spawn_one(g, &self.tmpl.clone());
        }
    }
}

pub fn spawn_one(g: &mut Game, t: &Tmpl) {
    let mut rng = g.rng;
    let id = g.world.spawn(&mut rng, t);
    g.rng = rng;
    if let Some(id) = id {
        g.emit("entity.spawned", json!({ "kind": t.kind, "role": t.role, "id": id }));
    }
}

fn tmpl(role: &'static str, kind: &str, label: String, speed: f64, r: f64, weight: u32) -> Tmpl {
    Tmpl { role, kind: kind.to_string(), label, speed, r, value: 0, dmg: 0, hp: 1, life_ms: 0, weight }
}

pub struct PlayerAvatar {
    pub emoji: String,
    pub size: f64,
}
impl PlayerAvatar {
    fn place(&self, g: &mut Game) {
        g.world.clear_role("avatar");
        let w = &g.world;
        let (x, y) = match w.space.as_str() {
            "lanes" => (w.lane_x(w.lanes / 2), H - 90.0),
            "scroll" if w.flow.0 != 0.0 => (70.0, H / 2.0),
            "grid" => w.cell_center(w.cols / 2, w.rows / 2),
            _ => (W / 2.0, H - 100.0),
        };
        let mut e = Ent::new("avatar", &self.emoji, x, y, self.size / 2.0 * 0.8);
        e.lane = if w.space == "lanes" { w.lanes / 2 } else { 0 };
        if w.space == "grid" {
            e.cell = w.cols / 2 + (w.rows / 2) * w.cols;
        }
        g.world.add(e);
    }
}
impl System for PlayerAvatar {
    fn id(&self) -> &'static str {
        "entity.player_avatar"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.loaded" => self.place(g),
            "tick" if g.world.space == "lanes" => {
                let Some((lane, x)) = g.world.first("avatar").map(|e| (e.lane, e.x)) else { return };
                let tx = g.world.lane_x(lane);
                if let Some(e) = g.world.first_mut("avatar") {
                    e.x = if (tx - x).abs() < 1.0 { tx } else { x + (tx - x) * 0.35 };
                }
            }
            "input.swipe" => {
                let dir = ev.data["dir"].as_str().unwrap_or("").to_string();
                if g.world.space == "lanes" {
                    let d = match dir.as_str() {
                        "left" => -1,
                        "right" => 1,
                        _ => return,
                    };
                    let n = g.world.lanes;
                    if let Some(e) = g.world.first_mut("avatar") {
                        e.lane = (e.lane + d).clamp(0, n - 1);
                    }
                } else if g.world.space == "grid" && !g.world.has("slide") && !g.world.has("tiles") {
                    super::board::grid_move(g, &dir, false);
                }
            }
            "input.tap" => {
                let x = num(&ev.data["x"]);
                if g.world.space == "lanes" && !g.world.input.contains_key("swipe") {
                    let n = g.world.lanes;
                    let ax = g.world.first("avatar").map(|e| e.x).unwrap_or(x);
                    if let Some(e) = g.world.first_mut("avatar") {
                        e.lane = (e.lane + if x < ax { -1 } else { 1 }).clamp(0, n - 1);
                    }
                } else if !g.world.has("projectile") && !g.world.has("follow_finger") && g.world.space != "lanes" && g.world.space != "grid" && g.world.space != "words" {
                    let xy = g.world.axis_xy;
                    let y = num(&ev.data["y"]);
                    if let Some(e) = g.world.first_mut("avatar") {
                        e.x = x.clamp(e.r, W - e.r);
                        if xy {
                            e.y = y.clamp(e.r, H - e.r);
                        }
                    }
                }
            }
            "input.drag" => {
                if g.world.has("follow_finger") || g.world.space == "lanes" {
                    return;
                }
                let x = num(&ev.data["x"]);
                let y = num(&ev.data["y"]);
                let xy = g.world.axis_xy;
                if let Some(e) = g.world.first_mut("avatar") {
                    e.x = x.clamp(e.r, W - e.r);
                    if xy {
                        e.y = y.clamp(e.r, H - e.r);
                    }
                }
            }
            _ => {}
        }
    }
}

pub struct FallingObject {
    spawn: SelfSpawn,
}
impl System for FallingObject {
    fn id(&self) -> &'static str {
        "entity.falling_object"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.templates.push(self.spawn.tmpl.clone());
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "tick" => self.spawn.tick(g),
            "collision.hit" if ev.data["b"] == "falling" && ev.data["a"] == "avatar" => {
                let id = ev.data["idb"].as_u64().unwrap_or(0) as u32;
                if let Some(e) = g.world.get(id).cloned() {
                    g.world.remove(id);
                    if e.dmg == 0 {
                        let v = e.value * g.multiplier;
                        g.add_score(v);
                        g.emit("entity.collected", json!({ "kind": e.kind, "value": e.value }));
                    }
                }
            }
            _ => {}
        }
    }
}

pub struct Obstacle {
    spawn: SelfSpawn,
    damage: i64,
}
impl System for Obstacle {
    fn id(&self) -> &'static str {
        "entity.obstacle"
    }
    fn init(&mut self, g: &mut Game) {
        self.spawn.tmpl.dmg = self.damage;
        g.world.templates.push(self.spawn.tmpl.clone());
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "tick" => self.spawn.tick(g),
            "collision.hit" if ev.data["b"] == "obstacle" => {
                let id = ev.data["idb"].as_u64().unwrap_or(0) as u32;
                if let Some(e) = g.world.get_mut(id) {
                    e.hp -= 1;
                    if e.hp <= 0 {
                        g.world.remove(id);
                        g.emit("entity.destroyed", json!({ "kind": "obstacle", "role": "obstacle", "reason": "hit" }));
                    }
                }
            }
            "input.tap" if g.world.space == "grid" => {
                let (x, y) = (num(&ev.data["x"]), num(&ev.data["y"]));
                let slop = g.world.hit_slop;
                if let Some(id) = g.world.at("obstacle", x, y, slop) {
                    let dmg = g.world.get(id).map(|e| e.dmg).unwrap_or(1);
                    g.world.remove(id);
                    g.emit("collision.hit", json!({ "a": "tap", "b": "obstacle", "idb": id, "damage": dmg, "harm": true }));
                }
            }
            _ => {}
        }
    }
}

pub struct Collectible {
    spawn: SelfSpawn,
    value: i64,
}
impl Collectible {
    fn pickup(&self, g: &mut Game, id: u32) {
        if let Some(e) = g.world.get(id).cloned() {
            g.world.remove(id);
            let v = e.value * g.multiplier;
            g.add_score(v);
            g.emit("entity.collected", json!({ "kind": e.kind, "value": e.value }));
            let n = g.custom.get("collected").and_then(|v| v.as_i64()).unwrap_or(0) + 1;
            g.hud_set("collected", json!(n));
        }
    }
}
impl System for Collectible {
    fn id(&self) -> &'static str {
        "entity.collectible"
    }
    fn init(&mut self, g: &mut Game) {
        self.spawn.tmpl.value = self.value;
        g.world.templates.push(self.spawn.tmpl.clone());
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "tick" => self.spawn.tick(g),
            "collision.hit" if ev.data["b"] == "collectible" && ev.data["a"] == "avatar" => {
                self.pickup(g, ev.data["idb"].as_u64().unwrap_or(0) as u32)
            }
            "input.tap" if g.world.space == "grid" => {
                let (x, y) = (num(&ev.data["x"]), num(&ev.data["y"]));
                let slop = g.world.hit_slop;
                if let Some(id) = g.world.at("collectible", x, y, slop) {
                    self.pickup(g, id);
                }
            }
            _ => {}
        }
    }
}

pub struct EnemyWave {
    size: i64,
    label: String,
    value: i64,
    speed: f64,
    gap_us: i64,
    wait_us: i64,
    wave: i64,
}
impl EnemyWave {
    fn spawn_wave(&mut self, g: &mut Game) {
        self.wave += 1;
        g.hud_set("wave", json!(self.wave));
        let (fx, fy) = g.world.flow;
        let sp = self.speed * g.world.speed_mult();
        for k in 0..self.size {
            let (col, row) = ((k % 6) as f64, (k / 6) as f64);
            let mut e = Ent::new("enemy", &self.label, 0.0, 0.0, 15.0);
            e.kind = "enemy".into();
            e.hp = 1;
            e.dmg = 1;
            e.value = self.value;
            e.speed = sp;
            if fx == 0.0 {
                e.x = 40.0 + col * (W - 80.0) / 5.0;
                e.y = if fy > 0.0 { -20.0 - row * 40.0 } else { H + 20.0 + row * 40.0 };
            } else {
                e.y = 60.0 + col * (H - 120.0) / 5.0;
                e.x = if fx < 0.0 { W + 20.0 + row * 40.0 } else { -20.0 - row * 40.0 };
            }
            e.ox = e.x;
            e.vx = fx * sp;
            e.vy = fy * sp;
            let id = g.world.add(e);
            g.emit("entity.spawned", json!({ "kind": "enemy", "role": "enemy", "id": id }));
        }
    }
}
impl System for EnemyWave {
    fn id(&self) -> &'static str {
        "entity.enemy_wave"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "tick" => {
                if g.world.count("enemy") == 0 {
                    self.wait_us += TICK_US;
                    if self.wait_us >= self.gap_us {
                        self.wait_us = 0;
                        self.spawn_wave(g);
                    }
                }
            }
            "collision.hit" if ev.data["b"] == "enemy" => {
                let id = ev.data["idb"].as_u64().unwrap_or(0) as u32;
                let by_avatar = ev.data["a"] == "avatar";
                let Some(e) = g.world.get_mut(id) else { return };
                if !by_avatar {
                    e.hp -= 1;
                }
                if by_avatar || e.hp <= 0 {
                    let value = e.value;
                    g.world.remove(id);
                    if !by_avatar {
                        let v = value * g.multiplier;
                        g.add_score(v);
                    }
                    g.emit("entity.destroyed", json!({ "kind": "enemy", "role": "enemy", "reason": if by_avatar { "rammed" } else { "shot" } }));
                }
            }
            _ => {}
        }
    }
}

pub struct BouncingBall {
    pub radius: f64,
    pub elasticity: f64,
    pub label: String,
}
impl BouncingBall {
    fn serve(&self, g: &mut Game) {
        g.world.clear_role("ball");
        let sign = if g.rng.below(2) == 0 { -1.0 } else { 1.0 };
        let mut e = Ent::new("ball", &self.label, W / 2.0, H * 0.45, self.radius);
        e.vx = sign * (90.0 + g.rng.below(60) as f64);
        e.vy = -200.0;
        e.phys = true;
        e.kind = "ball".into();
        let id = g.world.add(e);
        g.emit("entity.spawned", json!({ "kind": "ball", "role": "ball", "id": id }));
    }
}
impl System for BouncingBall {
    fn id(&self) -> &'static str {
        "entity.bouncing_ball"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.loaded" => self.serve(g),
            "tick" => {
                let paddle = g.world.count("paddle") > 0;
                let el = self.elasticity;
                let mut lost = false;
                let mut walls = false;
                if let Some(b) = g.world.first_mut("ball") {
                    let r = b.r;
                    if b.x < r {
                        b.x = r;
                        b.vx = b.vx.abs() * el;
                        walls = true;
                    } else if b.x > W - r {
                        b.x = W - r;
                        b.vx = -b.vx.abs() * el;
                        walls = true;
                    }
                    if b.y < r {
                        b.y = r;
                        b.vy = b.vy.abs() * el;
                        walls = true;
                    }
                    if b.y > H - r {
                        if paddle {
                            lost = b.y > H + r;
                        } else {
                            b.y = H - r;
                            b.vy = -b.vy.abs() * el;
                            walls = true;
                        }
                    }
                }
                if walls {
                    g.emit("collision.hit", json!({ "a": "ball", "b": "wall", "harm": false }));
                }
                if lost {
                    g.emit("collision.hit", json!({ "a": "ball", "b": "floor", "damage": 1, "harm": true }));
                    self.serve(g);
                }
            }
            "collision.hit" if ev.data["a"] == "ball" && ev.data["b"] == "paddle" => {
                let el = self.elasticity;
                let Some(p) = g.world.first("paddle").cloned() else { return };
                if let Some(b) = g.world.first_mut("ball") {
                    if b.vy > 0.0 {
                        b.vy = -(b.vy.abs() * el * 1.03).clamp(200.0, 520.0);
                        b.vx = (b.vx + (b.x - p.x) / p.hw * 140.0).clamp(-320.0, 320.0);
                        b.y = p.y - p.hh - b.r;
                    }
                }
            }
            _ => {}
        }
    }
}

pub struct ParticleEmitter {
    pub rate: i64,
    acc: i64,
    rng: Rng,
}
impl System for ParticleEmitter {
    fn id(&self) -> &'static str {
        "entity.particle_emitter"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "tick" {
            return;
        }
        self.acc += self.rate;
        if self.acc < 60 || g.world.count("particle") >= 60 {
            return;
        }
        self.acc -= 60;
        let (x, y) = g.world.first("avatar").map(|e| (e.x, e.y + e.r)).unwrap_or((W / 2.0, H - 30.0));
        let mut e = Ent::new("particle", "✦", x, y, 3.0);
        e.vx = self.rng.below(80) as f64 - 40.0;
        e.vy = 30.0 + self.rng.below(60) as f64;
        e.ttl = 28;
        g.world.add(e);
    }
}

pub struct HintGiver {
    pub emoji: String,
}
impl System for HintGiver {
    fn id(&self) -> &'static str {
        "entity.hint_giver"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.loaded" => {
                g.world.clear_role("hint");
                let mut e = Ent::new("hint", &self.emoji, W - 34.0, H - 34.0, 22.0);
                e.kind = "hint".into();
                g.world.add(e);
            }
            "hint.used" => apply_hint(g),
            _ => {}
        }
    }
}

pub struct Projectile {
    pub speed: f64,
    pub label: String,
}
impl System for Projectile {
    fn id(&self) -> &'static str {
        "entity.projectile"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.flag("projectile");
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "input.tap" => {
                if g.world.count("projectile") >= 8 {
                    return;
                }
                let Some(a) = g.world.first("avatar").cloned() else { return };
                let (fx, fy) = g.world.flow;
                let (dx, dy) = if fx == 0.0 { (0.0, -fy.signum()) } else { (-fx.signum(), 0.0) };
                let mut e = Ent::new("projectile", &self.label, a.x + dx * a.r, a.y + dy * a.r, 7.0);
                e.vx = dx * self.speed;
                e.vy = dy * self.speed;
                e.kind = "projectile".into();
                let id = g.world.add(e);
                g.emit("entity.spawned", json!({ "kind": "projectile", "role": "projectile", "id": id }));
            }
            "collision.hit" if ev.data["a"] == "projectile" => {
                let id = ev.data["ida"].as_u64().unwrap_or(0) as u32;
                g.world.remove(id);
            }
            _ => {}
        }
    }
}

pub struct Paddle {
    pub width: f64,
}
impl System for Paddle {
    fn id(&self) -> &'static str {
        "entity.paddle"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.loaded" => {
                g.world.clear_role("paddle");
                let mut e = Ent::new("paddle", "", W / 2.0, H - 60.0, self.width / 2.0);
                e.hw = self.width / 2.0;
                e.hh = 9.0;
                e.kind = "paddle".into();
                g.world.add(e);
            }
            "input.drag" if !g.world.has("follow_finger") => {
                let x = num(&ev.data["x"]);
                if let Some(p) = g.world.first_mut("paddle") {
                    p.x = x.clamp(p.hw, W - p.hw);
                }
            }
            _ => {}
        }
    }
}

pub fn build(id: &str, p: &Params) -> Option<Box<dyn System>> {
    Some(match id {
        "entity.player_avatar" => Box::new(PlayerAvatar { emoji: p.string("emoji"), size: p.float("size") }),
        "entity.falling_object" => {
            let mut t = tmpl("falling", &p.string("kind"), p.string("emoji"), p.float("fall_speed"), 15.0, 2);
            t.value = 10;
            Box::new(FallingObject { spawn: SelfSpawn::new(t, 1300) })
        }
        "entity.obstacle" => Box::new(Obstacle {
            spawn: SelfSpawn::new(
                {
                    let mut t = tmpl("obstacle", "obstacle", p.string("emoji"), 170.0, 18.0, 2);
                    t.life_ms = p.int("lifetime_ms");
                    t
                },
                1600,
            ),
            damage: p.int("damage"),
        }),
        "entity.collectible" => Box::new(Collectible {
            spawn: SelfSpawn::new(
                {
                    let mut t = tmpl("collectible", "collectible", p.string("emoji"), 150.0, 16.0, 3);
                    t.life_ms = p.int("lifetime_ms");
                    t
                },
                1000,
            ),
            value: p.int("value"),
        }),
        "entity.enemy_wave" => Box::new(EnemyWave {
            size: p.int("wave_size"),
            label: p.string("emoji"),
            value: p.int("value"),
            speed: p.float("speed"),
            gap_us: p.int("gap_ms") * 1000,
            wait_us: p.int("gap_ms") * 1000 - 500_000,
            wave: 0,
        }),
        "entity.bouncing_ball" => Box::new(BouncingBall { radius: p.float("radius"), elasticity: p.float("elasticity"), label: "🔵".into() }),
        "entity.particle_emitter" => Box::new(ParticleEmitter { rate: p.int("rate"), acc: 0, rng: Rng::new(0x5eed) }),
        "entity.hint_giver" => Box::new(HintGiver { emoji: p.string("emoji") }),
        "entity.projectile" => Box::new(Projectile { speed: p.float("speed"), label: p.string("emoji") }),
        "entity.paddle" => Box::new(Paddle { width: p.float("width") }),
        _ => return super::board::build_entity(id, p),
    })
}

