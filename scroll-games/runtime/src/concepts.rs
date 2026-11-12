//! Implemented concept systems and the registry that builds them from a manifest.

use crate::catalog::Catalog;
use crate::game::{Game, Outcome, TICK_US};
use crate::types::{ConceptRef, Event};
use serde_json::{json, Map, Value};

/// Concept params with catalog defaults applied.
pub struct Params(Map<String, Value>);

impl Params {
    pub fn build(cat: &Catalog, r: &ConceptRef) -> Params {
        let mut m = Map::new();
        if let Some(spec) = cat.concept(&r.id) {
            for (k, p) in &spec.params {
                m.insert(k.clone(), p.default.clone());
            }
        }
        for (k, v) in &r.params {
            m.insert(k.clone(), v.clone());
        }
        Params(m)
    }

    pub(crate) fn int(&self, k: &str) -> i64 {
        self.0.get(k).and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64))).unwrap_or(0)
    }

    pub(crate) fn has(&self, k: &str) -> bool {
        self.0.get(k).map_or(false, |v| v.is_number())
    }

    pub(crate) fn float(&self, k: &str) -> f64 {
        self.0.get(k).and_then(Value::as_f64).unwrap_or(0.0)
    }

    pub(crate) fn bool(&self, k: &str) -> bool {
        self.0.get(k).and_then(Value::as_bool).unwrap_or(false)
    }

    pub(crate) fn string(&self, k: &str) -> String {
        self.0.get(k).and_then(Value::as_str).unwrap_or("").to_string()
    }
}

/// A runtime system backing one implemented concept.
pub trait System {
    fn id(&self) -> &'static str;
    fn init(&mut self, _g: &mut Game) {}
    fn on_event(&mut self, ev: &Event, g: &mut Game);
}

/// Instantiate systems for the manifest's concepts. Stubs are skipped with a warning.
pub fn build(cat: &Catalog, refs: &[ConceptRef], g: &mut Game) -> Vec<Box<dyn System>> {
    let mut out: Vec<Box<dyn System>> = Vec::new();
    for r in refs {
        let p = Params::build(cat, r);
        let sys: Option<Box<dyn System>> = match r.id.as_str() {
            "input.tap_choice" => Some(Box::new(InputTapChoice)),
            "space.choice_board" => Some(Box::new(SpaceChoiceBoard { layout: p.string("layout") })),
            "flow.session" => Some(Box::new(FlowSession { max_duration_ms: p.int("max_duration_ms") })),
            "flow.rounds" => Some(Box::new(FlowRounds { rounds: p.int("rounds"), reveal_ms: p.int("reveal_ms") })),
            "flow.countdown_start" => Some(Box::new(FlowCountdown { seconds: p.int("seconds") })),
            "rule.round_timer" => Some(Box::new(RoundTimer { round_ms: p.int("round_ms") })),
            "rule.single_answer" => Some(Box::new(SingleAnswer { allow_retry: p.bool("allow_retry") })),
            "score.points" => Some(Box::new(ScorePoints { per_correct: p.int("per_correct") })),
            "score.time_bonus" => Some(Box::new(TimeBonus { max_bonus: p.int("max_bonus") })),
            "score.streak_multiplier" => Some(Box::new(StreakMultiplier {
                every: p.int("every").max(1),
                step: p.int("step"),
                max: p.int("max").max(1),
            })),
            "feedback.flash" => Some(Box::new(FeedbackFlash {
                correct: p.string("correct_color"),
                wrong: p.string("wrong_color"),
            })),
            "feedback.haptic" => Some(Box::new(FeedbackHaptic { correct: p.string("correct"), wrong: p.string("wrong") })),
            "feedback.confetti" => Some(Box::new(FeedbackConfetti { min_streak: p.int("min_streak") })),
            "content.question_bank" => Some(Box::new(QuestionBank { max_items: p.int("max_items") })),
            "content.photo_prompt" => Some(Box::new(PhotoPrompt { fit: p.string("fit") })),
            "share.score_card" => Some(Box::new(ScoreCard { headline: p.string("headline") })),
            "social.beat_them" => Some(Box::new(BeatThem { label: p.string("label") })),
            "feel.theme" => Some(Box::new(FeelTheme {
                palette: p.string("palette"),
                mood: p.string("mood"),
                emoji: p.string("emoji"),
            })),
            "accessibility.large_text" => Some(Box::new(LargeText)),
            "meta.seeded_random" => Some(Box::new(SeededRandom {
                items: p.bool("shuffle_items"),
                choices: p.bool("shuffle_choices"),
            })),
            other => crate::ext_play::build(other, &p).or_else(|| crate::ext_meta::build(other, &p)),
        };
        match sys {
            Some(mut s) => {
                s.init(g);
                out.push(s);
            }
            None => g.warn(format!("concept '{}' is a stub and is inert at runtime", r.id)),
        }
    }
    out
}

// ---------------------------------------------------------------- input / space

struct InputTapChoice;
impl System for InputTapChoice {
    fn id(&self) -> &'static str {
        "input.tap_choice"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "input.raw" || ev.data["type"] != "choice" {
            return;
        }
        let Some(idx) = ev.data["index"].as_i64() else { return };
        if g.round.active && !g.round.locked && idx >= 0 && (idx as usize) < g.round.choices.len() {
            g.emit("input.choice", json!({ "index": idx }));
        }
    }
}

struct SpaceChoiceBoard {
    layout: String,
}
impl System for SpaceChoiceBoard {
    fn id(&self) -> &'static str {
        "space.choice_board"
    }
    fn init(&mut self, g: &mut Game) {
        g.layout = self.layout.clone();
    }
    fn on_event(&mut self, _ev: &Event, _g: &mut Game) {}
}

// ---------------------------------------------------------------- flow

struct FlowSession {
    max_duration_ms: i64,
}
impl System for FlowSession {
    fn id(&self) -> &'static str {
        "flow.session"
    }
    fn init(&mut self, g: &mut Game) {
        g.max_duration_us = self.max_duration_ms * 1000;
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "game.over" {
            g.end_requested = true;
        }
    }
}

struct FlowRounds {
    rounds: i64,
    reveal_ms: i64,
}

impl FlowRounds {
    fn start_round(&self, g: &mut Game) {
        g.round_no += 1;
        g.round = Default::default();
        g.round.active = true;
        g.banner.clear();
        g.round_points = 0;
        let n = g.round_no;
        g.emit("round.started", json!({ "round": n }));
    }

    fn end_round(&self, g: &mut Game) {
        g.round.active = false;
        for (i, s) in g.round.states.iter_mut().enumerate() {
            if i == g.round.correct {
                *s = "correct";
            } else if *s != "wrong" {
                *s = "dim";
            }
        }
        g.reveal_us = Some(self.reveal_ms * 1000);
        let n = g.round_no;
        g.emit("round.ended", json!({ "round": n }));
    }
}

impl System for FlowRounds {
    fn id(&self) -> &'static str {
        "flow.rounds"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.countdown" | "session.started" => {
                g.total_rounds = self.rounds.min(g.order.len() as i64);
                if ev.name == "session.started" {
                    self.start_round(g);
                }
            }
            "answer.correct" | "answer.wrong" | "timer.expired" => {
                if g.round.active && g.round.locked {
                    self.end_round(g);
                }
            }
            "tick" => {
                if let Some(left) = g.reveal_us {
                    let left = left - TICK_US;
                    if left > 0 {
                        g.reveal_us = Some(left);
                    } else {
                        g.reveal_us = None;
                        if g.round_no >= g.total_rounds {
                            let score = g.score;
                            g.emit("game.over", json!({ "score": score }));
                        } else {
                            self.start_round(g);
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

struct FlowCountdown {
    seconds: i64,
}
impl System for FlowCountdown {
    fn id(&self) -> &'static str {
        "flow.countdown_start"
    }
    fn init(&mut self, g: &mut Game) {
        g.countdown_total_us = self.seconds * 1_000_000;
    }
    fn on_event(&mut self, _ev: &Event, _g: &mut Game) {}
}

// ---------------------------------------------------------------- rules

struct RoundTimer {
    round_ms: i64,
}
impl System for RoundTimer {
    fn id(&self) -> &'static str {
        "rule.round_timer"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "round.started" => {
                g.round.time_total_us = self.round_ms * 1000;
                g.round.time_left_us = g.round.time_total_us;
            }
            "tick" => {
                if g.round.active && !g.round.locked && g.round.time_total_us > 0 {
                    g.round.time_left_us -= TICK_US;
                    if g.round.time_left_us <= 0 {
                        g.round.time_left_us = 0;
                        g.round.locked = true;
                        g.round.outcome = Outcome::Timeout;
                        let n = g.round_no;
                        g.emit("timer.expired", json!({ "round": n }));
                    }
                }
            }
            _ => {}
        }
    }
}

struct SingleAnswer {
    allow_retry: bool,
}
impl System for SingleAnswer {
    fn id(&self) -> &'static str {
        "rule.single_answer"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "input.choice" || !g.round.active || g.round.locked {
            return;
        }
        let Some(idx) = ev.data["index"].as_i64().filter(|i| *i >= 0) else { return };
        let idx = idx as usize;
        if idx >= g.round.choices.len() || g.round.states[idx] != "idle" {
            return;
        }
        let round = g.round_no;
        if idx == g.round.correct {
            g.round.outcome = Outcome::Correct;
            g.round.locked = true;
            g.round.states[idx] = "correct";
            let ms = g.round.elapsed_us / 1000;
            g.emit("answer.correct", json!({ "round": round, "ms": ms }));
        } else {
            if g.round.outcome != Outcome::Correct {
                g.round.outcome = Outcome::Wrong;
            }
            g.round.states[idx] = "wrong";
            g.round.locked = !self.allow_retry;
            g.emit("answer.wrong", json!({ "round": round, "index": idx }));
        }
    }
}

// ---------------------------------------------------------------- score

struct ScorePoints {
    per_correct: i64,
}
impl System for ScorePoints {
    fn id(&self) -> &'static str {
        "score.points"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "answer.correct" {
            let d = self.per_correct * g.multiplier;
            g.add_score(d);
        }
    }
}

struct TimeBonus {
    max_bonus: i64,
}
impl System for TimeBonus {
    fn id(&self) -> &'static str {
        "score.time_bonus"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "answer.correct" && g.round.time_total_us > 0 {
            let d = self.max_bonus * g.round.time_left_us / g.round.time_total_us * g.multiplier;
            g.add_score(d);
        }
    }
}

struct StreakMultiplier {
    every: i64,
    step: i64,
    max: i64,
}
impl System for StreakMultiplier {
    fn id(&self) -> &'static str {
        "score.streak_multiplier"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "round.ended" {
            return;
        }
        let before = g.streak;
        g.streak = if g.round.outcome == Outcome::Correct { g.streak + 1 } else { 0 };
        g.multiplier = (1 + g.streak / self.every * self.step).min(self.max);
        if g.streak != before {
            let s = g.streak;
            g.emit("streak.changed", json!({ "streak": s }));
        }
    }
}

// ---------------------------------------------------------------- feedback

struct FeedbackFlash {
    correct: String,
    wrong: String,
}
impl System for FeedbackFlash {
    fn id(&self) -> &'static str {
        "feedback.flash"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        let color = match ev.name.as_str() {
            "answer.correct" => &self.correct,
            "answer.wrong" | "timer.expired" => &self.wrong,
            _ => return,
        };
        g.emit("feedback.flash", json!({ "color": color }));
    }
}

struct FeedbackHaptic {
    correct: String,
    wrong: String,
}
impl System for FeedbackHaptic {
    fn id(&self) -> &'static str {
        "feedback.haptic"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        let style = match ev.name.as_str() {
            "answer.correct" => self.correct.as_str(),
            "answer.wrong" => self.wrong.as_str(),
            "timer.expired" => "warning",
            _ => return,
        };
        g.emit("feedback.haptic", json!({ "style": style }));
    }
}

struct FeedbackConfetti {
    min_streak: i64,
}
impl System for FeedbackConfetti {
    fn id(&self) -> &'static str {
        "feedback.confetti"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "game.over" if g.score > 0 => g.emit("feedback.confetti", json!({})),
            "streak.changed" if self.min_streak > 0 && ev.data["streak"].as_i64().unwrap_or(0) >= self.min_streak => {
                g.emit("feedback.confetti", json!({}))
            }
            _ => {}
        }
    }
}

// ---------------------------------------------------------------- content

struct QuestionBank {
    max_items: i64,
}
impl System for QuestionBank {
    fn id(&self) -> &'static str {
        "content.question_bank"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.loaded" => {
                let mut order: Vec<usize> = g
                    .items
                    .iter()
                    .enumerate()
                    .filter(|(_, it)| it.kind == "question" || it.kind.is_empty())
                    .map(|(i, _)| i)
                    .collect();
                if g.shuffle_items {
                    g.rng.shuffle(&mut order);
                }
                if self.max_items > 0 {
                    order.truncate(self.max_items as usize);
                }
                g.order = order;
            }
            "round.started" => {
                let Some(item) = g.current_item().cloned() else { return };
                let mut idxs: Vec<usize> = (0..item.choices.len()).collect();
                if g.shuffle_choices {
                    g.rng.shuffle(&mut idxs);
                }
                let answer = item.answer.unwrap_or(0).max(0) as usize;
                g.round.correct = idxs.iter().position(|i| *i == answer).unwrap_or(0);
                g.round.choices = idxs.iter().map(|i| item.choices[*i].clone()).collect();
                g.round.states = vec!["idle"; idxs.len()];
                g.round.prompt = item.prompt.clone();
                g.round.clue = item.clue.clone();
            }
            _ => {}
        }
    }
}

struct PhotoPrompt {
    fit: String,
}
impl System for PhotoPrompt {
    fn id(&self) -> &'static str {
        "content.photo_prompt"
    }
    fn init(&mut self, g: &mut Game) {
        g.media_fit = self.fit.clone();
        g.show_clue = true;
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "round.started" {
            g.round.media_url = g.current_item().and_then(|i| i.media_url.clone());
        }
    }
}

// ---------------------------------------------------------------- share / social / feel / a11y / meta

struct ScoreCard {
    headline: String,
}
impl System for ScoreCard {
    fn id(&self) -> &'static str {
        "share.score_card"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "game.over" {
            g.ui_share_card = true;
            g.share_headline = self.headline.clone();
        }
    }
}

struct BeatThem {
    label: String,
}
impl System for BeatThem {
    fn id(&self) -> &'static str {
        "social.beat_them"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "game.over" {
            g.ui_beat_them = true;
            g.beat_label = self.label.clone();
        }
    }
}

struct FeelTheme {
    palette: String,
    mood: String,
    emoji: String,
}
impl System for FeelTheme {
    fn id(&self) -> &'static str {
        "feel.theme"
    }
    fn init(&mut self, g: &mut Game) {
        let mut m = match g.theme.take() {
            Value::Object(m) => m,
            _ => Map::new(),
        };
        m.entry("palette").or_insert_with(|| json!(self.palette));
        m.entry("mood").or_insert_with(|| json!(self.mood));
        if !self.emoji.is_empty() {
            m.entry("emoji").or_insert_with(|| json!(self.emoji));
        }
        g.theme = Value::Object(m);
    }
    fn on_event(&mut self, _ev: &Event, _g: &mut Game) {}
}

struct LargeText;
impl System for LargeText {
    fn id(&self) -> &'static str {
        "accessibility.large_text"
    }
    fn init(&mut self, g: &mut Game) {
        g.large_text = true;
    }
    fn on_event(&mut self, _ev: &Event, _g: &mut Game) {}
}

struct SeededRandom {
    items: bool,
    choices: bool,
}
impl System for SeededRandom {
    fn id(&self) -> &'static str {
        "meta.seeded_random"
    }
    fn init(&mut self, g: &mut Game) {
        g.shuffle_items = self.items;
        g.shuffle_choices = self.choices;
    }
    fn on_event(&mut self, _ev: &Event, _g: &mut Game) {}
}
