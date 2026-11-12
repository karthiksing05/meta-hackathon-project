//! Shared mutable game state that concept systems and glue operate on.

use crate::rng::Rng;
use crate::types::{Event, Item};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// Fixed simulation step: 60 Hz, in microseconds.
pub const TICK_US: i64 = 16_667;
pub const FLASH_US: i64 = 450_000;
pub const CONFETTI_US: i64 = 2_500_000;
const MAX_LOGS: usize = 64;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Outcome {
    Pending,
    Correct,
    Wrong,
    Timeout,
}

#[derive(Clone, Debug)]
pub struct Round {
    pub active: bool,
    pub locked: bool,
    pub prompt: String,
    pub media_url: Option<String>,
    pub clue: Option<String>,
    pub choices: Vec<String>,
    pub states: Vec<&'static str>,
    pub correct: usize,
    pub outcome: Outcome,
    pub elapsed_us: i64,
    pub time_left_us: i64,
    pub time_total_us: i64,
}

impl Default for Round {
    fn default() -> Self {
        Round {
            active: false,
            locked: false,
            prompt: String::new(),
            media_url: None,
            clue: None,
            choices: Vec::new(),
            states: Vec::new(),
            correct: 0,
            outcome: Outcome::Pending,
            elapsed_us: 0,
            time_left_us: 0,
            time_total_us: 0,
        }
    }
}

#[derive(Default, Clone, Debug)]
pub struct Stats {
    pub correct: i64,
    pub wrong: i64,
    pub best_streak: i64,
}

#[derive(Clone, Debug)]
pub struct Game {
    // reserved game vars (glue-visible)
    pub score: i64,
    pub round_no: i64,
    pub total_rounds: i64,
    pub streak: i64,
    pub multiplier: i64,
    pub banner: String,
    pub round_points: i64,
    pub custom: BTreeMap<String, Value>,

    pub round: Round,
    pub reveal_us: Option<i64>,
    pub rng: Rng,
    pub pending: Vec<Event>,
    pub warnings: Vec<String>,
    pub logs: Vec<String>,
    pub stats: Stats,

    // content
    pub items: Vec<Item>,
    pub order: Vec<usize>,
    pub copy: Value,
    pub title: String,

    // configuration set by concept systems
    pub shuffle_items: bool,
    pub shuffle_choices: bool,
    pub countdown_total_us: i64,
    pub max_duration_us: i64,
    pub theme: Value,
    pub large_text: bool,
    pub layout: String,
    pub media_fit: String,
    pub ui_share_card: bool,
    pub ui_beat_them: bool,
    pub share_headline: String,
    pub beat_label: String,
    pub show_clue: bool,

    // transient output state
    pub flash: Option<(String, i64)>,
    pub confetti_us: i64,
    pub end_requested: bool,
}

impl Game {
    pub fn new(title: &str, items: Vec<Item>, copy: Value, theme: Value, seed: u32) -> Game {
        Game {
            score: 0,
            round_no: 0,
            total_rounds: 0,
            streak: 0,
            multiplier: 1,
            banner: String::new(),
            round_points: 0,
            custom: BTreeMap::new(),
            round: Round::default(),
            reveal_us: None,
            rng: Rng::new(seed),
            pending: Vec::new(),
            warnings: Vec::new(),
            logs: Vec::new(),
            stats: Stats::default(),
            items,
            order: Vec::new(),
            copy,
            title: title.to_string(),
            shuffle_items: false,
            shuffle_choices: false,
            countdown_total_us: 0,
            max_duration_us: 0,
            theme,
            large_text: false,
            layout: "grid".into(),
            media_fit: "cover".into(),
            ui_share_card: false,
            ui_beat_them: false,
            share_headline: String::new(),
            beat_label: String::new(),
            show_clue: false,
            flash: None,
            confetti_us: 0,
            end_requested: false,
        }
    }

    /// Throwaway state used to dry-run glue during validation.
    pub fn synthetic(round: i64, total: i64) -> Game {
        let mut g = Game::new("dry-run", Vec::new(), Value::Null, Value::Null, 1);
        g.round_no = round;
        g.total_rounds = total;
        g.round_points = 100;
        g.score = 100 * (round - 1).max(0);
        g.round.time_left_us = 5_000_000;
        g.round.time_total_us = 10_000_000;
        g
    }

    pub fn emit(&mut self, name: &str, data: Value) {
        self.pending.push(Event::new(name, data));
    }

    pub fn warn(&mut self, msg: impl Into<String>) {
        let msg = msg.into();
        if !self.warnings.contains(&msg) && self.warnings.len() < 64 {
            self.warnings.push(msg);
        }
    }

    pub fn log(&mut self, msg: String) {
        if self.logs.len() < MAX_LOGS {
            self.logs.push(msg);
        }
    }

    pub fn current_item(&self) -> Option<&Item> {
        let idx = *self.order.get((self.round_no - 1).max(0) as usize)?;
        self.items.get(idx)
    }

    pub fn time_left_ms(&self) -> i64 {
        self.round.time_left_us / 1000
    }

    /// Apply a score change and announce it.
    pub fn add_score(&mut self, delta: i64) {
        if delta == 0 {
            return;
        }
        self.score = self.score.saturating_add(delta);
        self.round_points = self.round_points.saturating_add(delta);
        let ev = json!({ "score": self.score, "delta": delta });
        self.emit("score.changed", ev);
    }

    /// Reserved + custom variables as seen by glue.
    pub fn snapshot(&self) -> BTreeMap<String, Value> {
        let mut m = self.custom.clone();
        m.insert("score".into(), json!(self.score));
        m.insert("round".into(), json!(self.round_no));
        m.insert("total_rounds".into(), json!(self.total_rounds));
        m.insert("streak".into(), json!(self.streak));
        m.insert("multiplier".into(), json!(self.multiplier));
        m.insert("time_left_ms".into(), json!(self.time_left_ms()));
        m.insert("banner".into(), json!(self.banner));
        m.insert("round_points".into(), json!(self.round_points));
        m
    }

    /// Glue write. Read-only reserved keys are rejected with a warning.
    pub fn set_var(&mut self, key: &str, val: Value) {
        match key {
            "score" => {
                if let Some(n) = as_int(&val) {
                    let delta = n.saturating_sub(self.score);
                    if delta != 0 {
                        self.score = n;
                        let ev = json!({ "score": n, "delta": delta });
                        self.emit("score.changed", ev);
                    }
                }
            }
            "streak" => {
                if let Some(n) = as_int(&val) {
                    let n = n.max(0);
                    if n != self.streak {
                        self.streak = n;
                        self.emit("streak.changed", json!({ "streak": n }));
                    }
                }
            }
            "multiplier" => {
                if let Some(n) = as_int(&val) {
                    self.multiplier = n.clamp(0, 100);
                }
            }
            "banner" => {
                self.banner = match val {
                    Value::String(s) => s,
                    other => other.to_string(),
                }
            }
            "round" | "total_rounds" | "time_left_ms" | "round_points" => {
                self.warn(format!("glue tried to set read-only var '{key}'"));
            }
            _ => {
                self.custom.insert(key.to_string(), val);
            }
        }
    }

    pub fn view_choices(&self) -> Value {
        let list: Vec<Value> = self
            .round
            .choices
            .iter()
            .enumerate()
            .map(|(i, label)| {
                json!({ "label": label, "state": self.round.states.get(i).copied().unwrap_or("idle") })
            })
            .collect();
        Value::Array(list)
    }

    pub fn warnings_json(&self) -> Value {
        Value::Array(self.warnings.iter().map(|w| Value::String(w.clone())).collect())
    }

    pub fn feedback_json(&self) -> Value {
        let mut m = Map::new();
        m.insert("flash".into(), self.flash.as_ref().map(|f| json!(f.0)).unwrap_or(Value::Null));
        m.insert("confetti".into(), json!(self.confetti_us > 0));
        Value::Object(m)
    }
}

pub fn as_int(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_f64().map(|f| f as i64))
}
