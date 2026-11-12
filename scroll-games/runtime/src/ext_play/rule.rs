//! Rule concepts: lives, hints, collisions, time limits, targets and scoring modifiers.

use super::num;
use crate::concepts::{Params, System};
use crate::game::{Game, TICK_US};
use crate::types::Event;
use serde_json::json;

pub struct Lives {
    lives: i64,
    over: bool,
}
impl Lives {
    fn lose(&mut self, g: &mut Game, n: i64) {
        if self.over || n <= 0 {
            return;
        }
        self.lives = (self.lives - n).max(0);
        g.hud_set("lives", json!(self.lives));
        let l = self.lives;
        g.emit("lives.changed", json!({ "lives": l }));
        if self.lives == 0 {
            self.over = true;
            g.finish(false);
        }
    }
}
impl System for Lives {
    fn id(&self) -> &'static str {
        "rule.lives"
    }
    fn init(&mut self, g: &mut Game) {
        g.hud_set("lives", json!(self.lives));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "answer.wrong" | "timer.expired" if !g.world.absorb => self.lose(g, 1),
            "collision.hit" if ev.data["harm"] == true => {
                let n = ev.data["damage"].as_i64().unwrap_or(1);
                self.lose(g, n);
            }
            _ => {}
        }
    }
}

pub struct HintBudget {
    remaining: i64,
}
impl System for HintBudget {
    fn id(&self) -> &'static str {
        "rule.hint_budget"
    }
    fn init(&mut self, g: &mut Game) {
        g.hud_set("hints", json!(self.remaining));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "input.tap" {
            return;
        }
        let (x, y) = (num(&ev.data["x"]), num(&ev.data["y"]));
        let slop = g.world.hit_slop;
        if g.world.at("hint", x, y, slop).is_none() {
            return;
        }
        if self.remaining <= 0 {
            g.world.toast("No hints left");
            return;
        }
        self.remaining -= 1;
        g.hud_set("hints", json!(self.remaining));
        let r = self.remaining;
        g.emit("hint.used", json!({ "remaining": r }));
    }
}

pub struct NoRepeat;
impl System for NoRepeat {
    fn id(&self) -> &'static str {
        "rule.no_repeat"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.flag("no_repeat");
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "session.loaded" {
            let mut seen = Vec::new();
            let items = g.items.clone();
            g.order.retain(|i| {
                let key = items.get(*i).map(|it| it.prompt.clone()).unwrap_or_default();
                if seen.contains(&key) {
                    false
                } else {
                    seen.push(key);
                    true
                }
            });
        }
    }
}

pub struct Collision {
    pub circle: bool,
}
impl System for Collision {
    fn id(&self) -> &'static str {
        "rule.collision"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.shared_collision = true;
        g.world.circle = self.circle;
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "tick" {
            let evs = g.world.detect(self.circle);
            g.pending.extend(evs);
        }
    }
}

pub struct TotalTimeLimit {
    total_us: i64,
    left_us: i64,
    done: bool,
}
impl System for TotalTimeLimit {
    fn id(&self) -> &'static str {
        "rule.total_time_limit"
    }
    fn init(&mut self, g: &mut Game) {
        g.hud_set("clock_total_ms", json!(self.total_us / 1000));
        g.hud_set("clock_ms", json!(self.total_us / 1000));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "tick" || self.done {
            return;
        }
        self.left_us -= TICK_US;
        g.world.hud.insert("clock_ms".into(), json!(self.left_us.max(0) / 1000));
        if self.left_us <= 0 {
            self.done = true;
            let score = g.score;
            g.emit("game.over", json!({ "score": score }));
        }
    }
}

pub struct WrongPenalty {
    pub penalty: i64,
}
impl System for WrongPenalty {
    fn id(&self) -> &'static str {
        "rule.wrong_penalty"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "answer.wrong" && !g.world.absorb {
            let d = self.penalty.min(g.score.max(0));
            g.add_score(-d);
        }
    }
}

pub struct WinTarget {
    pub target: i64,
    done: bool,
}
impl System for WinTarget {
    fn id(&self) -> &'static str {
        "rule.win_target"
    }
    fn init(&mut self, g: &mut Game) {
        g.hud_set("target", json!(self.target));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "score.changed" && !self.done && g.score >= self.target {
            self.done = true;
            g.won = true;
            let score = g.score;
            g.emit("game.over", json!({ "score": score }));
        }
    }
}

pub struct DifficultyRamp {
    pub step: f64,
    base_us: i64,
}
impl System for DifficultyRamp {
    fn id(&self) -> &'static str {
        "rule.difficulty_ramp"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "round.ended" => {
                g.world.difficulty += self.step;
                let d = g.world.difficulty;
                g.hud_set("difficulty", json!((d * 100.0).round() / 100.0));
                g.emit("difficulty.changed", json!({ "difficulty": d }));
            }
            "round.started" if g.round.time_total_us > 0 => {
                if self.base_us == 0 {
                    self.base_us = g.round.time_total_us;
                }
                g.round.time_total_us = (self.base_us as f64 / (1.0 + g.world.difficulty * 0.5)) as i64;
                g.round.time_left_us = g.round.time_total_us;
            }
            _ => {}
        }
    }
}

pub struct StreakShield {
    pub needed: i64,
    armed: bool,
}
impl System for StreakShield {
    fn id(&self) -> &'static str {
        "rule.streak_shield"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "streak.changed" => {
                if !self.armed && ev.data["streak"].as_i64().unwrap_or(0) >= self.needed {
                    self.armed = true;
                    g.hud_set("shield", json!(1));
                    g.world.toast("Shield ready");
                }
            }
            "answer.wrong" if self.armed => {
                self.armed = false;
                g.world.absorb = true;
                g.hud_set("shield", json!(0));
                g.world.toast("Shield absorbed the mistake");
            }
            _ => {}
        }
    }
}

pub struct Elimination {
    cut: i64,
    bots: Vec<i64>,
    alive: Vec<bool>,
    me_alive: bool,
}
impl System for Elimination {
    fn id(&self) -> &'static str {
        "rule.elimination"
    }
    fn init(&mut self, g: &mut Game) {
        g.hud_set("alive", json!(self.bots.len() + 1));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "round.ended" || !self.me_alive {
            return;
        }
        for i in 0..self.bots.len() {
            if self.alive[i] {
                let gain = g.rng.range_inclusive(30, 130);
                self.bots[i] += gain;
            }
        }
        for _ in 0..self.cut {
            // lowest scorer leaves; the player wins ties
            let lowest_bot = (0..self.bots.len()).filter(|i| self.alive[*i]).min_by_key(|i| self.bots[*i]);
            match lowest_bot {
                Some(i) if self.bots[i] <= g.score => self.alive[i] = false,
                None => break,
                _ => {
                    self.me_alive = false;
                    break;
                }
            }
        }
        let alive = self.alive.iter().filter(|a| **a).count() as i64 + i64::from(self.me_alive);
        g.hud_set("alive", json!(alive));
        if !self.me_alive {
            g.world.toast("You were eliminated");
            let score = g.score;
            g.emit("game.over", json!({ "score": score }));
        } else if alive == 1 {
            g.won = true;
            let score = g.score;
            g.emit("game.over", json!({ "score": score }));
        }
    }
}

pub fn build(id: &str, p: &Params) -> Option<Box<dyn System>> {
    Some(match id {
        "rule.lives" => Box::new(Lives { lives: p.int("lives"), over: false }),
        "rule.hint_budget" => Box::new(HintBudget { remaining: p.int("hints") }),
        "rule.no_repeat" => Box::new(NoRepeat),
        "rule.collision" => Box::new(Collision { circle: p.string("precision") == "circle" }),
        "rule.total_time_limit" => Box::new(TotalTimeLimit { total_us: p.int("limit_ms") * 1000, left_us: p.int("limit_ms") * 1000, done: false }),
        "rule.wrong_penalty" => Box::new(WrongPenalty { penalty: p.int("penalty") }),
        "rule.win_target" => Box::new(WinTarget { target: p.int("target"), done: false }),
        "rule.difficulty_ramp" => Box::new(DifficultyRamp { step: p.float("step"), base_us: 0 }),
        "rule.streak_shield" => Box::new(StreakShield { needed: p.int("streak_needed"), armed: false }),
        "rule.elimination" => {
            let n = p.int("rivals").max(1) as usize;
            Box::new(Elimination { cut: p.int("cut_per_round").max(1), bots: vec![0; n], alive: vec![true; n], me_alive: true })
        }
        _ => return super::board::build_rule(id, p),
    })
}
