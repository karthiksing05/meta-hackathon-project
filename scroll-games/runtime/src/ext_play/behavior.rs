//! Behavior concepts: rules of motion and spawning applied to world entities.

use super::world::{dist, DT, H, W};
use super::num;
use crate::concepts::{Params, System};
use crate::game::{Game, TICK_US};
use crate::types::Event;
use serde_json::json;

pub struct Gravity {
    pub strength: f64,
}
impl System for Gravity {
    fn id(&self) -> &'static str {
        "behavior.gravity"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.gravity = self.strength;
        g.world.flag("gravity");
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "tick" {
            g.world.gravity = self.strength * g.world.speed_mult().min(2.0);
        }
    }
}

pub struct Patrol {
    pub range: f64,
}
impl System for Patrol {
    fn id(&self) -> &'static str {
        "behavior.patrol"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "tick" {
            return;
        }
        let range = self.range;
        for e in g.world.ents.iter_mut().filter(|e| (e.role == "enemy" || e.role == "obstacle") && e.cell < 0) {
            e.x += e.dir * 50.0 * DT;
            if (e.x - e.ox - (e.vx * e.age as f64 * DT)).abs() > range {
                e.dir = -e.dir;
            }
            e.x = e.x.clamp(e.r, W - e.r);
        }
    }
}

pub struct Homing {
    pub turn: f64,
}
impl System for Homing {
    fn id(&self) -> &'static str {
        "behavior.homing"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "tick" {
            return;
        }
        let Some((ax, ay)) = g.world.first("avatar").map(|a| (a.x, a.y)) else { return };
        let k = (self.turn * DT).min(1.0);
        for e in g.world.ents.iter_mut().filter(|e| (e.role == "enemy" || e.role == "obstacle") && e.cell < 0 && e.age > 20) {
            let d = dist(ax, ay, e.x, e.y).max(1.0);
            let sp = if e.speed > 0.0 { e.speed } else { 120.0 };
            e.vx += ((ax - e.x) / d * sp - e.vx) * k;
            e.vy += ((ay - e.y) / d * sp - e.vy) * k;
        }
    }
}

pub struct SpawnWave {
    pub every_us: i64,
    acc: i64,
}
impl System for SpawnWave {
    fn id(&self) -> &'static str {
        "behavior.spawn_wave"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.flag("spawn_wave");
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "tick" || g.world.templates.is_empty() {
            return;
        }
        self.acc += (TICK_US as f64 * g.world.spawn_rate()) as i64;
        if self.acc >= self.every_us {
            self.acc -= self.every_us;
            let total: u32 = g.world.templates.iter().map(|t| t.weight.max(1)).sum();
            let mut pick = g.rng.below(total);
            let mut chosen = g.world.templates[0].clone();
            for t in &g.world.templates {
                if pick < t.weight.max(1) {
                    chosen = t.clone();
                    break;
                }
                pick -= t.weight.max(1);
            }
            super::entity::spawn_one(g, &chosen);
        }
    }
}

pub struct SpawnRateRamp {
    pub per_tick: f64,
    announced: i64,
}
impl System for SpawnRateRamp {
    fn id(&self) -> &'static str {
        "behavior.spawn_rate_ramp"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "tick" {
            return;
        }
        g.world.rate += self.per_tick;
        let step = (g.world.rate * 4.0) as i64;
        if step > self.announced {
            self.announced = step;
            let d = g.world.rate;
            g.emit("difficulty.changed", json!({ "difficulty": d }));
        }
    }
}

pub struct Bounce {
    pub damping: f64,
}
impl System for Bounce {
    fn id(&self) -> &'static str {
        "behavior.bounce"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "tick" => {
                let d = self.damping;
                for e in g.world.ents.iter_mut().filter(|e| matches!(e.role, "enemy" | "obstacle" | "falling" | "collectible") && e.cell < 0) {
                    if e.x < e.r && e.vx < 0.0 || e.x > W - e.r && e.vx > 0.0 {
                        e.vx = -e.vx * d;
                    }
                }
            }
            "collision.hit" if ev.data["a"] == "ball" && matches!(ev.data["b"].as_str(), Some("obstacle") | Some("enemy")) => {
                let d = self.damping;
                if let Some(b) = g.world.first_mut("ball") {
                    b.vy = -b.vy * d;
                }
            }
            _ => {}
        }
    }
}

pub struct Magnet {
    pub radius: f64,
}
impl System for Magnet {
    fn id(&self) -> &'static str {
        "behavior.magnet"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "tick" {
            return;
        }
        let Some((ax, ay)) = g.world.first("avatar").map(|a| (a.x, a.y)) else { return };
        let r = self.radius;
        for e in g.world.ents.iter_mut().filter(|e| e.role == "collectible" && e.cell < 0) {
            let d = dist(ax, ay, e.x, e.y);
            if d < r && d > 1.0 {
                let step = (240.0 * DT).min(d);
                e.x += (ax - e.x) / d * step;
                e.y += (ay - e.y) / d * step;
            }
        }
    }
}

pub struct WrapEdges;
impl System for WrapEdges {
    fn id(&self) -> &'static str {
        "behavior.wrap_edges"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.wrap = true;
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "tick" {
            if let Some(a) = g.world.first_mut("avatar") {
                if a.x < 0.0 {
                    a.x += W;
                } else if a.x > W {
                    a.x -= W;
                }
                if a.y < 0.0 {
                    a.y += H;
                } else if a.y > H {
                    a.y -= H;
                }
            }
        }
    }
}

pub struct FollowFinger {
    pub smoothing: f64,
}
impl System for FollowFinger {
    fn id(&self) -> &'static str {
        "behavior.follow_finger"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.flag("follow_finger");
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "input.drag" => {
                if raw_phase_ok(ev) {
                    g.world.finger = Some((num(&ev.data["x"]), num(&ev.data["y"])));
                }
            }
            "tick" => {
                let Some((fx, fy)) = g.world.finger else { return };
                let k = (1.0 - self.smoothing).clamp(0.02, 1.0);
                let xy = g.world.axis_xy;
                let lanes = g.world.space == "lanes";
                for e in g.world.ents.iter_mut().filter(|e| e.role == "avatar" || e.role == "paddle") {
                    if lanes && e.role == "avatar" {
                        continue;
                    }
                    e.x += (fx.clamp(e.hw.max(e.r), W - e.hw.max(e.r)) - e.x) * k;
                    if xy && e.role == "avatar" {
                        e.y += (fy.clamp(e.r, H - e.r) - e.y) * k;
                    }
                }
            }
            _ => {}
        }
    }
}

fn raw_phase_ok(ev: &Event) -> bool {
    ev.data["phase"] != "dial"
}

pub struct Drift {
    pub amount: f64,
}
impl System for Drift {
    fn id(&self) -> &'static str {
        "behavior.drift"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.drift = self.amount;
    }
    fn on_event(&mut self, _ev: &Event, _g: &mut Game) {}
}

pub fn build(id: &str, p: &Params) -> Option<Box<dyn System>> {
    Some(match id {
        "behavior.gravity" => Box::new(Gravity { strength: p.float("strength") }),
        "behavior.patrol" => Box::new(Patrol { range: p.float("range") }),
        "behavior.homing" => Box::new(Homing { turn: p.float("turn_rate") }),
        "behavior.spawn_wave" => Box::new(SpawnWave { every_us: p.int("every_ms") * 1000, acc: 0 }),
        "behavior.spawn_rate_ramp" => Box::new(SpawnRateRamp { per_tick: p.float("ramp_per_min") / 3600.0, announced: 4 }),
        "behavior.bounce" => Box::new(Bounce { damping: p.float("damping") }),
        "behavior.magnet" => Box::new(Magnet { radius: p.float("radius") }),
        "behavior.wrap_edges" => Box::new(WrapEdges),
        "behavior.follow_finger" => Box::new(FollowFinger { smoothing: p.float("smoothing") }),
        "behavior.drift" => Box::new(Drift { amount: p.float("amount") }),
        _ => return super::board::build_behavior(id, p),
    })
}

