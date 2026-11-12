//! Session: state machine, fixed-timestep loop, input recording, view model.

use crate::catalog::Catalog;
use crate::concepts::{self, System};
use crate::game::{Game, CONFETTI_US, FLASH_US, TICK_US};
use crate::glue::GlueHost;
use crate::types::{Content, Event, Manifest, RecordedInput};
use crate::validate;
use serde_json::{json, Value};
use std::collections::VecDeque;

const MAX_EVENTS_PER_DISPATCH: usize = 2000;
const MAX_STEP_MS: f64 = 250.0;
/// Dispatch order: rules that veto (shield) first, game-flow interceptors after `flow.session`.
fn order_systems(systems: &mut [Box<dyn System>]) {
    fn priority(id: &str) -> i32 {
        match id {
            "rule.streak_shield" => -1,
            "flow.session" => 1,
            "flow.levels" | "flow.endless" | "flow.retry_once" | "flow.best_of_n" | "flow.practice_mode" | "flow.intermission"
            | "rule.difficulty_ramp" | "rule.no_repeat" | "rule.elimination" | "rule.win_target" => 2,
            _ => 0,
        }
    }
    systems.sort_by_key(|s| priority(s.id()));
}

const REPLAY_TICK_CAP: u64 = 60 * 600;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum State {
    Loading,
    Ready,
    Countdown,
    Playing,
    Paused,
    Ended,
}

impl State {
    fn as_str(self) -> &'static str {
        match self {
            State::Loading => "loading",
            State::Ready => "ready",
            State::Countdown => "countdown",
            State::Playing => "playing",
            State::Paused => "paused",
            State::Ended => "ended",
        }
    }

    fn is_active(self) -> bool {
        matches!(self, State::Countdown | State::Playing)
    }
}

pub struct Session {
    manifest: Manifest,
    content: Content,
    g: Game,
    systems: Vec<Box<dyn System>>,
    glue: GlueHost,
    state: State,
    paused_from: State,
    seed: u32,
    tick: u64,
    playing_us: i64,
    countdown_us: i64,
    acc_us: i64,
    inputs: Vec<RecordedInput>,
    log: Vec<Event>,
}

impl Session {
    /// Validates, then builds the session. `Err` carries the validator's error summary.
    pub fn new(manifest_json: &str, content_json: &str, seed: u32) -> Result<Session, String> {
        let report = validate::validate(manifest_json, content_json);
        if !report.ok {
            return Err(report.summary());
        }
        let manifest: Manifest = serde_json::from_str(manifest_json).map_err(|e| e.to_string())?;
        let content: Content = serde_json::from_str(content_json).map_err(|e| e.to_string())?;
        let cat = Catalog::load();

        let mut g = Game::new(&manifest.title, content.items.clone(), content.copy.clone(), manifest.theme.clone(), seed);
        let mut systems = concepts::build(&cat, &manifest.concepts, &mut g);
        order_systems(&mut systems);
        let glue = GlueHost::new(&manifest.glue).map_err(|e| format!("glue: {e:?}"))?;

        let mut s = Session {
            manifest,
            content,
            g,
            systems,
            glue,
            state: State::Loading,
            paused_from: State::Playing,
            seed,
            tick: 0,
            playing_us: 0,
            countdown_us: 0,
            acc_us: 0,
            inputs: Vec::new(),
            log: Vec::new(),
        };
        s.dispatch(Event::new("session.loaded", json!({})));
        s.state = State::Ready;
        Ok(s)
    }

    pub fn state(&self) -> State {
        self.state
    }

    pub fn tick_count(&self) -> u64 {
        self.tick
    }

    pub fn score(&self) -> i64 {
        self.g.score
    }

    pub fn warnings(&self) -> &[String] {
        &self.g.warnings
    }

    pub fn start(&mut self) {
        if self.state != State::Ready {
            return;
        }
        if self.g.countdown_total_us > 0 {
            self.state = State::Countdown;
            self.countdown_us = self.g.countdown_total_us;
            let secs = self.g.countdown_total_us / 1_000_000;
            self.dispatch(Event::new("session.countdown", json!({ "seconds": secs })));
        } else {
            self.state = State::Playing;
            self.dispatch(Event::new("session.started", json!({})));
        }
    }

    /// Advance by real elapsed time; only whole fixed ticks affect the simulation.
    pub fn step(&mut self, dt_ms: f64) {
        if !self.state.is_active() {
            self.acc_us = 0;
            return;
        }
        let dt = if dt_ms.is_finite() { dt_ms.clamp(0.0, MAX_STEP_MS) } else { 0.0 };
        self.acc_us += (dt * 1000.0) as i64;
        while self.acc_us >= TICK_US && self.state.is_active() {
            self.acc_us -= TICK_US;
            self.tick_once();
        }
    }

    fn tick_once(&mut self) {
        match self.state {
            State::Countdown => {
                self.tick += 1;
                self.countdown_us -= TICK_US;
                if self.countdown_us <= 0 {
                    self.countdown_us = 0;
                    self.state = State::Playing;
                    self.dispatch(Event::new("session.started", json!({})));
                }
            }
            State::Playing => {
                self.tick += 1;
                self.playing_us += TICK_US;
                self.decay_feedback();
                if self.g.round.active && !self.g.round.locked {
                    self.g.round.elapsed_us += TICK_US;
                }
                if self.g.world.freeze.is_some() {
                    self.dispatch(Event::new("freeze.tick", json!({})));
                } else {
                    let evs = self.g.world.integrate();
                    self.g.pending.extend(evs);
                    if !self.g.world.shared_collision {
                        let evs = self.g.world.detect(true);
                        self.g.pending.extend(evs);
                    }
                    self.dispatch(Event::new("tick", json!({ "tick": self.tick })));
                }
                if self.state == State::Playing && self.g.max_duration_us > 0 && self.playing_us >= self.g.max_duration_us {
                    let score = self.g.score;
                    self.g.warn("session hit its maximum duration");
                    self.dispatch(Event::new("game.over", json!({ "score": score })));
                }
            }
            _ => {}
        }
    }

    fn decay_feedback(&mut self) {
        if let Some((_, left)) = self.g.flash.as_mut() {
            *left -= TICK_US;
            if *left <= 0 {
                self.g.flash = None;
            }
        }
        self.g.confetti_us = (self.g.confetti_us - TICK_US).max(0);
    }

    /// Record and apply one input: `{"type":"choice","index":n}`, `pause`, `resume`, `tap`.
    pub fn input(&mut self, json_str: &str) -> Result<(), String> {
        let v: Value = serde_json::from_str(json_str).map_err(|e| format!("bad input JSON: {e}"))?;
        self.inputs.push(RecordedInput { tick: self.tick, input: v.clone() });
        self.apply_input(&v);
        Ok(())
    }

    fn apply_input(&mut self, v: &Value) {
        match v["type"].as_str().unwrap_or("") {
            "choice" if self.state == State::Playing && self.g.world.freeze.is_none() => {
                let data = json!({ "type": "choice", "index": v["index"] });
                self.dispatch(Event::new("input.raw", data));
            }
            "ack" if self.state == State::Playing => self.dispatch(Event::new("input.raw", v.clone())),
            "tap" | "swipe" | "drag" | "press" | "release" | "text" | "draw" | "tilt" | "select" | "submit" | "voice" | "dial"
                if self.state == State::Playing && self.g.world.freeze.is_none() =>
            {
                self.dispatch(Event::new("input.raw", v.clone()));
            }
            "pause" if self.state.is_active() => {
                self.paused_from = self.state;
                self.state = State::Paused;
                self.dispatch(Event::new("session.paused", json!({})));
            }
            "resume" if self.state == State::Paused => {
                self.state = self.paused_from;
                self.dispatch(Event::new("session.resumed", json!({})));
            }
            _ => {}
        }
    }

    fn dispatch(&mut self, first: Event) {
        self.run_queue(first);
        if self.g.restart_req {
            self.g.restart_req = false;
            self.restart_run();
        }
        if self.g.end_requested {
            self.g.end_requested = false;
            self.state = State::Ended;
            let score = self.g.score;
            self.run_queue(Event::new("session.ended", json!({ "score": score })));
        }
    }

    /// Start a fresh run (retry_once, best_of_n): systems and state are rebuilt, the RNG stream and carry values continue.
    fn restart_run(&mut self) {
        let cat = Catalog::load();
        let mut g = Game::new(&self.manifest.title, self.content.items.clone(), self.content.copy.clone(), self.manifest.theme.clone(), 0);
        g.rng = self.g.rng;
        g.stats = self.g.stats.clone();
        g.carry = self.g.carry.clone();
        g.warnings = self.g.warnings.clone();
        g.logs = self.g.logs.clone();
        let mut systems = concepts::build(&cat, &self.manifest.concepts, &mut g);
        order_systems(&mut systems);
        let post = g.carry.remove("post_restart");
        self.g = g;
        self.systems = systems;
        self.paused_from = State::Playing;
        self.run_queue(Event::new("session.loaded", json!({})));
        self.run_queue(Event::new("session.started", json!({})));
        if let Some(p) = post {
            let name = p["name"].as_str().unwrap_or("level.started").to_string();
            self.run_queue(Event::new(&name, p["data"].clone()));
        }
    }

    fn run_queue(&mut self, first: Event) {
        let mut queue = VecDeque::new();
        queue.push_back(first);
        let mut handled = 0;
        while let Some(ev) = queue.pop_front() {
            handled += 1;
            if handled > MAX_EVENTS_PER_DISPATCH {
                self.g.warn("event storm: dispatch aborted");
                self.g.pending.clear();
                break;
            }
            self.observe(&ev);
            for s in self.systems.iter_mut() {
                s.on_event(&ev, &mut self.g);
            }
            self.g.world.absorb = false;
            self.glue.dispatch(&mut self.g, &ev);
            queue.extend(self.g.pending.drain(..));
        }
    }

    fn observe(&mut self, ev: &Event) {
        match ev.name.as_str() {
            "answer.correct" => self.g.stats.correct += 1,
            "answer.wrong" | "timer.expired" => self.g.stats.wrong += 1,
            "streak.changed" => {
                let s = ev.data["streak"].as_i64().unwrap_or(0);
                self.g.stats.best_streak = self.g.stats.best_streak.max(s);
            }
            "feedback.flash" => {
                let color = ev.data["color"].as_str().unwrap_or("white").to_string();
                self.g.flash = Some((color, FLASH_US));
            }
            "feedback.confetti" => self.g.confetti_us = CONFETTI_US,
            _ => {}
        }
        if ev.name != "tick" && ev.name != "input.raw" && ev.name != "freeze.tick" {
            self.log.push(ev.clone());
        }
    }

    pub fn view(&self) -> Value {
        let g = &self.g;
        let countdown = if self.state == State::Countdown {
            json!((self.countdown_us + 999_999) / 1_000_000)
        } else {
            Value::Null
        };
        let revealed = !g.round.active && !g.round.choices.is_empty();
        json!({
            "state": self.state.as_str(),
            "title": g.title,
            "round": g.round_no,
            "total_rounds": g.total_rounds,
            "time_left_ms": g.time_left_ms(),
            "round_time_ms": g.round.time_total_us / 1000,
            "countdown": countdown,
            "score": g.score,
            "streak": g.streak,
            "multiplier": g.multiplier,
            "banner": g.banner,
            "prompt": g.round.prompt,
            "media_url": g.round.media_url,
            "clue": if revealed && g.show_clue { json!(g.round.clue) } else { Value::Null },
            "choices": g.view_choices(),
            "feedback": g.feedback_json(),
            "theme": g.theme,
            "large_text": g.large_text,
            "layout": g.layout,
            "media_fit": g.media_fit,
            "ui": { "share_card": g.ui_share_card, "beat_them": g.ui_beat_them,
                    "share_headline": g.share_headline, "beat_label": g.beat_label },
            "copy": g.copy,
            "ext": g.ext_view,
            "world": g.world.view(),
        })
    }

    pub fn drain_events(&mut self) -> Value {
        let out: Vec<Value> = self.log.drain(..).map(|e| e.to_json()).collect();
        Value::Array(out)
    }

    pub fn result(&self) -> Value {
        json!({
            "score": self.g.score,
            "seed": self.seed,
            "ticks": self.tick,
            "inputs": self.inputs,
            "stats": { "correct": self.g.stats.correct, "wrong": self.g.stats.wrong,
                       "best_streak": self.g.stats.best_streak },
            "warnings": self.g.warnings_json(),
            "logs": self.g.logs,
            "ext": self.g.ext_view,
        })
    }
}

/// Re-run a recorded play and return `(score, ticks)`.
pub fn replay(manifest_json: &str, content_json: &str, seed: u32, inputs: &[RecordedInput]) -> Result<(i64, u64), String> {
    let mut s = Session::new(manifest_json, content_json, seed)?;
    s.start();
    let mut next = 0;
    loop {
        while next < inputs.len() && inputs[next].tick <= s.tick {
            s.apply_input(&inputs[next].input);
            next += 1;
        }
        if s.state == State::Ended || s.tick >= REPLAY_TICK_CAP {
            break;
        }
        if s.state == State::Paused && (next >= inputs.len() || inputs[next].tick > s.tick) {
            break;
        }
        s.tick_once();
    }
    Ok((s.g.score, s.tick))
}
