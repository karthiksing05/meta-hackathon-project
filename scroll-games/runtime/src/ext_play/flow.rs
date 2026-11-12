//! Flow concepts: levels, endless play, retries, series, lobby and tutorial screens.

use super::world::Freeze;
use super::raw;
use crate::concepts::{Params, System};
use crate::game::{Game, TICK_US};
use crate::types::Event;
use serde_json::json;

fn start_level(g: &mut Game, level: i64, bump: f64) {
    g.world.level = level;
    g.world.difficulty += bump;
    g.hud_set("level", json!(level));
    g.emit("level.started", json!({ "level": level }));
}

pub struct Levels {
    levels: i64,
    level_us: i64,
    acc: i64,
}
impl System for Levels {
    fn id(&self) -> &'static str {
        "flow.levels"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.levels_on = true;
        g.world.levels = self.levels;
        g.hud_set("level", json!(1));
        g.hud_set("levels", json!(self.levels));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.started" => start_level(g, 1, 0.0),
            "level.started" => self.acc = 0,
            "level.ended" => {
                if g.world.level < self.levels {
                    let next = g.world.level + 1;
                    start_level(g, next, 0.25);
                }
            }
            "tick" if self.level_us > 0 => {
                self.acc += TICK_US;
                if self.acc >= self.level_us {
                    self.acc = 0;
                    g.finish(true);
                }
            }
            _ => {}
        }
    }
}

pub struct Endless;
impl System for Endless {
    fn id(&self) -> &'static str {
        "flow.endless"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.endless = true;
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "level.ended" {
            let next = g.world.level + 1;
            start_level(g, next, 0.2);
        }
    }
}

pub struct SuddenDeath {
    done: bool,
}
impl System for SuddenDeath {
    fn id(&self) -> &'static str {
        "flow.sudden_death"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        let hit = match ev.name.as_str() {
            "answer.wrong" | "timer.expired" => !g.world.absorb,
            "collision.hit" => ev.data["harm"] == true,
            _ => false,
        };
        if hit && !self.done {
            self.done = true;
            g.finish(false);
        }
    }
}

pub struct DailyPuzzle {
    pub reset_hour: i64,
}
impl System for DailyPuzzle {
    fn id(&self) -> &'static str {
        "flow.daily_puzzle"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "session.loaded" {
            g.world.extra.insert("daily_puzzle".into(), json!({ "reset_hour_utc": self.reset_hour }));
        }
    }
}

pub struct BestOfN {
    n: i64,
}
impl System for BestOfN {
    fn id(&self) -> &'static str {
        "flow.best_of_n"
    }
    fn init(&mut self, g: &mut Game) {
        let run = g.carry.get("bo_runs").and_then(|v| v.as_i64()).unwrap_or(0) + 1;
        g.hud_set("run", json!(format!("{run}/{}", self.n)));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "game.over" {
            return;
        }
        let runs = g.carry.get("bo_runs").and_then(|v| v.as_i64()).unwrap_or(0) + 1;
        let best = g.carry.get("bo_best").and_then(|v| v.as_i64()).unwrap_or(0).max(g.score);
        g.carry.insert("bo_runs".into(), json!(runs));
        g.carry.insert("bo_best".into(), json!(best));
        if runs < self.n {
            g.end_requested = false;
            g.restart_req = true;
            g.carry.insert("post_restart".into(), json!({ "name": "level.started", "data": { "level": runs + 1 } }));
        } else if best > g.score {
            let d = best - g.score;
            g.add_score(d);
        }
    }
}

pub struct PracticeMode;
impl System for PracticeMode {
    fn id(&self) -> &'static str {
        "flow.practice_mode"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.started" => {
                g.world.extra.insert("practice".into(), json!(true));
                g.world.toast("Practice run: score not counted");
            }
            "game.over" => {
                let s = g.score;
                g.custom.insert("practice_score".into(), json!(s));
                g.score = 0;
            }
            _ => {}
        }
    }
}

pub struct Intermission {
    pub duration_us: i64,
    left_us: i64,
}
impl System for Intermission {
    fn id(&self) -> &'static str {
        "flow.intermission"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "round.ended" if g.round_no < g.total_rounds => {
                self.left_us = self.duration_us;
                if let Some(r) = g.reveal_us.as_mut() {
                    *r += self.duration_us;
                }
                g.world.toast("Break time");
                g.emit("intermission.started", json!({ "round": g.round_no }));
            }
            "tick" if self.left_us > 0 => {
                self.left_us -= TICK_US;
                if self.left_us <= 0 {
                    self.left_us = 0;
                    g.emit("intermission.ended", json!({ "round": g.round_no }));
                }
            }
            _ => {}
        }
    }
}

pub struct RetryOnce;
impl System for RetryOnce {
    fn id(&self) -> &'static str {
        "flow.retry_once"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "game.over" && !g.won && g.carry.get("retry_used").is_none() {
            g.carry.insert("retry_used".into(), json!(true));
            g.end_requested = false;
            g.restart_req = true;
        }
    }
}

pub struct LobbyWait {
    timeout_us: i64,
    elapsed_us: i64,
    joins: Vec<i64>,
}
impl System for LobbyWait {
    fn id(&self) -> &'static str {
        "flow.lobby_wait"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.started" => {
                let mut t = 0;
                self.joins.clear();
                for _ in 0..2 {
                    t += 400_000 + g.rng.below(900_000) as i64;
                    self.joins.push(t.min(self.timeout_us));
                }
                self.elapsed_us = 0;
                g.world.freeze = Some(Freeze { kind: "lobby", text: "Waiting for friends 1/3".into(), remaining_us: 0, needs_ack: false, ack_ready_us: 0 });
            }
            "freeze.tick" => {
                let in_lobby = g.world.freeze.as_ref().map_or(false, |f| f.kind == "lobby");
                if !in_lobby {
                    return;
                }
                self.elapsed_us += TICK_US;
                let joined = 1 + self.joins.iter().filter(|j| **j <= self.elapsed_us).count();
                if joined >= 3 || self.elapsed_us >= self.timeout_us {
                    g.world.freeze = None;
                    g.emit("lobby.ready", json!({ "players": joined }));
                } else if let Some(f) = g.world.freeze.as_mut() {
                    f.text = format!("Waiting for friends {joined}/3");
                }
            }
            _ => {}
        }
    }
}

pub struct Tutorial {
    skippable: bool,
    text: String,
    pending: bool,
}
impl Tutorial {
    fn show(&mut self, g: &mut Game) {
        self.pending = false;
        let ready = if self.skippable { 0 } else { 2_000_000 };
        g.world.freeze = Some(Freeze { kind: "tutorial", text: self.text.clone(), remaining_us: 0, needs_ack: true, ack_ready_us: ready });
    }
}
impl System for Tutorial {
    fn id(&self) -> &'static str {
        "flow.tutorial"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.loaded" => {
                if let Some(t) = g.copy["tutorial"].as_str() {
                    self.text = t.to_string();
                }
            }
            "session.started" => {
                if g.world.freeze.is_none() {
                    self.show(g);
                } else {
                    self.pending = true;
                }
            }
            "tick" if self.pending && g.world.freeze.is_none() => self.show(g),
            "freeze.tick" => {
                if let Some(f) = g.world.freeze.as_mut().filter(|f| f.kind == "tutorial") {
                    f.ack_ready_us = (f.ack_ready_us - TICK_US).max(0);
                }
            }
            "input.raw" if raw(ev, "ack").is_some() => {
                if g.world.freeze.as_ref().map_or(false, |f| f.kind == "tutorial" && f.ack_ready_us <= 0) {
                    g.world.freeze = None;
                }
            }
            _ => {}
        }
    }
}

pub fn build(id: &str, p: &Params) -> Option<Box<dyn System>> {
    Some(match id {
        "flow.levels" => Box::new(Levels { levels: p.int("levels"), level_us: p.int("level_ms") * 1000, acc: 0 }),
        "flow.endless" => Box::new(Endless),
        "flow.sudden_death" => Box::new(SuddenDeath { done: false }),
        "flow.daily_puzzle" => Box::new(DailyPuzzle { reset_hour: p.int("reset_hour_utc") }),
        "flow.best_of_n" => Box::new(BestOfN { n: p.int("n") }),
        "flow.practice_mode" => Box::new(PracticeMode),
        "flow.intermission" => Box::new(Intermission { duration_us: p.int("duration_ms") * 1000, left_us: 0 }),
        "flow.retry_once" => Box::new(RetryOnce),
        "flow.lobby_wait" => Box::new(LobbyWait { timeout_us: p.int("timeout_ms") * 1000, elapsed_us: 0, joins: Vec::new() }),
        "flow.tutorial" => Box::new(Tutorial {
            skippable: p.bool("skippable"),
            text: "Tap the right answer before time runs out. Good luck!".into(),
            pending: false,
        }),
        _ => return None,
    })
}
