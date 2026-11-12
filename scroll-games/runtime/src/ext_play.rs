//! Gameplay concepts (input, space, entity, behavior, rule, flow) beyond the quiz set.
//! Shared state lives in `Game::world` (see `world.rs`); systems here read and write it.

pub mod behavior;
pub mod board;
pub mod entity;
pub mod flow;
pub mod input;
pub mod rule;
pub mod space;
pub mod world;

use crate::concepts::{Params, System};
use crate::game::Game;
use crate::types::Event;
use serde_json::{json, Value};

/// Build a system for `id`, or None if this module does not implement it.
pub fn build(id: &str, p: &Params) -> Option<Box<dyn System>> {
    match id.split('.').next() {
        Some("input") => input::build(id, p),
        Some("space") => space::build(id, p),
        Some("entity") => entity::build(id, p),
        Some("behavior") => behavior::build(id, p),
        Some("rule") => rule::build(id, p),
        Some("flow") => flow::build(id, p),
        _ => None,
    }
}

/// The payload of an `input.raw` event of the given host input type.
pub(crate) fn raw<'a>(ev: &'a Event, ty: &str) -> Option<&'a Value> {
    (ev.name == "input.raw" && ev.data["type"] == ty).then_some(&ev.data)
}

pub(crate) fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0)
}

/// Generic success / failure signals so score, lives and feedback concepts work for every genre.
pub(crate) fn good(g: &mut Game) {
    let round = g.round_no.max(g.world.level);
    g.emit("answer.correct", json!({ "round": round, "ms": 0 }));
}

pub(crate) fn bad(g: &mut Game, index: i64) {
    let round = g.round_no.max(g.world.level);
    g.emit("answer.wrong", json!({ "round": round, "index": index }));
}

/// Pick a content item of `kind` (seeded). Without `rule.no_repeat` the pool refills when exhausted.
pub(crate) fn pick_item(g: &mut Game, kind: &str, accept: impl Fn(&crate::types::Item) -> bool) -> Option<usize> {
    let used: Vec<String> = g.world.secret.get("used").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    let all: Vec<usize> = g.items.iter().enumerate().filter(|(_, it)| it.kind == kind && accept(it)).map(|(i, _)| i).collect();
    let mut pool: Vec<usize> = all.iter().copied().filter(|i| !used.contains(&g.items[*i].id)).collect();
    if pool.is_empty() {
        if g.world.has("no_repeat") {
            return None;
        }
        g.world.secret.insert("used".into(), json!([]));
        pool = all;
    }
    if pool.is_empty() {
        return None;
    }
    let pick = pool[g.rng.below(pool.len() as u32) as usize];
    let mut used: Vec<String> = g.world.secret.get("used").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    used.push(g.items[pick].id.clone());
    g.world.secret.insert("used".into(), json!(used));
    Some(pick)
}

/// Reveal help for the current play surface (used by entity.hint_giver).
pub(crate) fn apply_hint(g: &mut Game) {
    if g.round.active && !g.round.locked && !g.round.choices.is_empty() {
        let wrong: Vec<usize> = (0..g.round.choices.len()).filter(|i| *i != g.round.correct && g.round.states[*i] == "idle").collect();
        if !wrong.is_empty() {
            let i = wrong[g.rng.below(wrong.len() as u32) as usize];
            g.round.states[i] = "dim";
        }
        return;
    }
    match g.world.space.as_str() {
        "cards" => board::peek_pair(g),
        "words" => board::word_hint(g),
        _ => g.world.toast("Look closely..."),
    }
}
