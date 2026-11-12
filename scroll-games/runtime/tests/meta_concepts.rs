//! Tests for the non-spatial concepts in `ext_meta.rs`: one behavior test per concept (driven through a
//! small event rig around `concepts::build`) plus session-level determinism on the quiz template.

use serde_json::{json, Value};
use sg_runtime::catalog::Catalog;
use sg_runtime::concepts::{self, System};
use sg_runtime::game::{Game, FLASH_US};
use sg_runtime::session::State;
use sg_runtime::types::{ConceptRef, Event, Item};
use sg_runtime::Session;
use std::collections::VecDeque;

// ---------------------------------------------------------------- rig

struct Rig {
    g: Game,
    systems: Vec<Box<dyn System>>,
    log: Vec<Event>,
}

fn item(v: Value) -> Item {
    serde_json::from_value(v).unwrap()
}

fn questions() -> Vec<Item> {
    (1..=3)
        .map(|i| {
            item(json!({ "id": format!("q{i}"), "kind": "question", "prompt": format!("Question {i}"),
                "media_id": format!("m{i}"), "media_url": format!("http://x/{i}.jpg"),
                "choices": ["A", "B", "C"], "answer": 1, "clue": "clue" }))
        })
        .collect()
}

fn rig(concepts: &[(&str, Value)]) -> Rig {
    rig_with(concepts, questions(), Value::Null)
}

fn rig_with(concepts: &[(&str, Value)], items: Vec<Item>, copy: Value) -> Rig {
    let refs: Vec<ConceptRef> = concepts
        .iter()
        .map(|(id, p)| ConceptRef { id: id.to_string(), params: p.as_object().cloned().unwrap_or_default() })
        .collect();
    let mut g = Game::new("Rig Game", items, copy, json!({ "emoji": "🌍", "palette": "sunset" }), 7);
    let systems = concepts::build(&Catalog::load(), &refs, &mut g);
    assert!(g.warnings.is_empty(), "stub warnings: {:?}", g.warnings);
    Rig { g, systems, log: Vec::new() }
}

impl Rig {
    fn run(&mut self, first: Option<Event>) {
        let mut q: VecDeque<Event> = VecDeque::new();
        q.extend(first);
        q.extend(self.g.pending.drain(..));
        while let Some(ev) = q.pop_front() {
            match ev.name.as_str() {
                "answer.correct" => self.g.stats.correct += 1,
                "answer.wrong" | "timer.expired" => self.g.stats.wrong += 1,
                "feedback.flash" => self.g.flash = Some((ev.data["color"].as_str().unwrap_or("white").to_string(), FLASH_US)),
                "feedback.confetti" => self.g.confetti_us = 2_500_000,
                _ => {}
            }
            if ev.name != "tick" {
                self.log.push(ev.clone());
            }
            for s in self.systems.iter_mut() {
                s.on_event(&ev, &mut self.g);
            }
            q.extend(self.g.pending.drain(..));
        }
    }

    fn send(&mut self, name: &str, data: Value) {
        self.run(Some(Event::new(name, data)));
    }

    fn load(&mut self) {
        self.send("session.loaded", json!({}));
    }

    fn ticks(&mut self, n: usize) {
        for i in 0..n {
            self.send("tick", json!({ "tick": i }));
        }
    }

    /// Start the next round with an `ms` timer (0 = untimed).
    fn begin_round(&mut self, ms: i64) {
        self.g.round_no += 1;
        self.g.round = Default::default();
        self.g.round.active = true;
        self.g.round.time_total_us = ms * 1000;
        self.g.round.time_left_us = ms * 1000;
        self.g.round_points = 0;
        let n = self.g.round_no;
        self.send("round.started", json!({ "round": n }));
    }

    fn correct(&mut self, ms: i64) {
        self.g.round.locked = true;
        self.g.round.outcome = sg_runtime::game::Outcome::Correct;
        let n = self.g.round_no;
        self.send("answer.correct", json!({ "round": n, "ms": ms }));
    }

    fn wrong(&mut self) {
        self.g.round.locked = true;
        self.g.round.outcome = sg_runtime::game::Outcome::Wrong;
        let n = self.g.round_no;
        self.send("answer.wrong", json!({ "round": n, "index": 0 }));
    }

    fn end_round(&mut self) {
        self.g.round.active = false;
        let n = self.g.round_no;
        self.send("round.ended", json!({ "round": n }));
    }

    fn over(&mut self) {
        let score = self.g.score;
        self.send("game.over", json!({ "score": score }));
        self.send("session.ended", json!({ "score": score }));
    }

    fn add(&mut self, delta: i64) {
        self.g.add_score(delta);
        self.run(None);
    }

    fn ext(&self, group: &str, key: &str) -> Value {
        self.g.ext_view.get(group).and_then(|o| o.get(key)).cloned().unwrap_or(Value::Null)
    }

    fn emitted(&self, name: &str) -> Vec<Value> {
        self.log.iter().filter(|e| e.name == name).map(|e| e.data.clone()).collect()
    }
}

fn no(id: &str) -> (&str, Value) {
    (id, json!({}))
}

// ---------------------------------------------------------------- feedback

#[test]
fn sound_cue_marks_correct_and_wrong() {
    let mut r = rig(&[("feedback.sound_cue", json!({}))]);
    r.begin_round(0);
    r.correct(500);
    assert_eq!(r.ext("sound", "cue"), "correct");
    assert_eq!(r.ext("sound", "n"), 1);
    r.send("timer.expired", json!({ "round": 1 }));
    assert_eq!(r.ext("sound", "cue"), "wrong");
    assert_eq!(r.ext("sound", "n"), 2);
    assert_eq!(r.ext("sound", "volume"), 0.7);
}

#[test]
fn screen_shake_runs_then_stops_and_respects_reduced_motion() {
    let mut r = rig(&[no("feedback.screen_shake")]);
    r.begin_round(0);
    r.wrong();
    assert_eq!(r.ext("fx", "shake")["active"], true);
    r.ticks(30);
    assert_eq!(r.ext("fx", "shake")["active"], false);
    let mut calm = rig(&[no("accessibility.reduced_motion"), no("feedback.screen_shake")]);
    calm.begin_round(0);
    calm.wrong();
    assert_eq!(calm.ext("fx", "shake"), Value::Null);
}

#[test]
fn floating_score_lists_deltas_and_expires() {
    let mut r = rig(&[no("feedback.floating_score")]);
    r.add(120);
    let f = r.ext("fx", "floaters");
    assert_eq!(f.as_array().unwrap().len(), 1);
    assert_eq!(f[0]["delta"], 120);
    r.ticks(60);
    assert_eq!(r.ext("fx", "floaters").as_array().unwrap().len(), 0);
}

#[test]
fn pulse_timer_activates_under_threshold() {
    let mut r = rig(&[no("feedback.pulse_timer")]);
    r.begin_round(10_000);
    r.ticks(1);
    assert_eq!(r.ext("fx", "timer_pulse")["active"], false);
    r.g.round.time_left_us = 1_000_000;
    r.ticks(1);
    let p = r.ext("fx", "timer_pulse");
    assert_eq!(p["active"], true);
    assert!(p["hz"].as_f64().unwrap() > 2.0);
}

#[test]
fn color_wash_shifts_hue_with_streak() {
    let mut r = rig(&[no("feedback.color_wash")]);
    assert_eq!(r.ext("fx", "color_wash")["hue"], 0);
    r.send("streak.changed", json!({ "streak": 5 }));
    assert_eq!(r.ext("fx", "color_wash")["hue"], 120);
    r.send("streak.changed", json!({ "streak": 0 }));
    assert_eq!(r.ext("fx", "color_wash")["hue"], 0);
}

#[test]
fn emoji_burst_fires_on_correct() {
    let mut r = rig(&[("feedback.emoji_burst", json!({ "emoji": "🍕" }))]);
    r.begin_round(0);
    r.correct(400);
    assert_eq!(r.ext("fx", "emoji_burst")["emoji"], "🍕");
    assert_eq!(r.ext("fx", "emoji_burst")["n"], 1);
}

#[test]
fn voice_cheer_speaks_on_correct_and_game_over() {
    let mut r = rig(&[no("feedback.voice_cheer")]);
    r.begin_round(0);
    r.correct(400);
    assert_eq!(r.ext("voice", "n"), 1);
    assert!(!r.ext("voice", "text").as_str().unwrap().is_empty());
    r.add(40);
    r.send("game.over", json!({}));
    assert_eq!(r.ext("voice", "text"), "Game over. You scored 40.");
}

#[test]
fn slowmo_only_on_close_calls() {
    let mut r = rig(&[no("feedback.slowmo")]);
    r.begin_round(10_000);
    r.correct(1000);
    assert_eq!(r.ext("fx", "slowmo"), Value::Null);
    r.begin_round(10_000);
    r.g.round.time_left_us = 1_500_000;
    r.correct(8500);
    assert_eq!(r.ext("fx", "slowmo")["active"], true);
    assert_eq!(r.ext("fx", "slowmo")["factor"], 0.4);
    r.ticks(50);
    assert_eq!(r.ext("fx", "slowmo")["active"], false);
}

#[test]
fn vignette_grows_as_time_runs_out() {
    let mut r = rig(&[no("feedback.vignette_low_time")]);
    r.begin_round(10_000);
    r.ticks(1);
    assert_eq!(r.ext("fx", "vignette"), 0.0);
    r.g.round.time_left_us = 1_000_000;
    r.ticks(1);
    let v = r.ext("fx", "vignette").as_f64().unwrap();
    assert!((v - 0.67).abs() < 0.01, "{v}");
}

#[test]
fn toast_shows_streak_and_level_messages() {
    let mut r = rig(&[("feedback.toast", json!({ "duration_ms": 500 }))]);
    r.send("streak.changed", json!({ "streak": 1 }));
    assert!(r.ext("fx", "toasts").is_null());
    r.send("streak.changed", json!({ "streak": 3 }));
    r.send("level.started", json!({ "level": 2 }));
    let t = r.ext("fx", "toasts");
    assert_eq!(t[0]["text"], "🔥 3 in a row");
    assert_eq!(t[1]["text"], "Level 2");
    r.ticks(40);
    assert_eq!(r.ext("fx", "toasts").as_array().unwrap().len(), 0);
}

// ---------------------------------------------------------------- score

#[test]
fn time_attack_scores_elapsed_time() {
    let mut r = rig(&[no("score.time_attack")]);
    r.ticks(120);
    r.over();
    assert_eq!(r.g.score, 2000);
    assert_eq!(r.ext("score", "lower_is_better"), true);
    let mut s = rig(&[("score.time_attack", json!({ "unit": "s" }))]);
    s.ticks(180);
    s.over();
    assert_eq!(s.g.score, 3);
}

#[test]
fn distance_scores_from_distance_var_or_elapsed() {
    let mut r = rig(&[("score.distance", json!({ "per_meter": 2.0 }))]);
    r.g.custom.insert("distance".into(), json!(10.0));
    r.ticks(1);
    assert_eq!(r.g.score, 20);
    let mut t = rig(&[no("score.distance")]);
    t.ticks(120);
    assert_eq!(t.g.score, 2);
}

#[test]
fn combo_chain_builds_and_breaks() {
    let mut r = rig(&[("score.combo_chain", json!({ "window_ms": 1000 }))]);
    r.begin_round(0);
    r.correct(100);
    r.ticks(30);
    r.correct(100);
    assert_eq!(r.ext("score", "combo"), 2);
    assert_eq!(r.g.score, 10);
    assert_eq!(r.emitted("combo.changed").last().unwrap()["combo"], 2);
    r.ticks(80);
    assert_eq!(r.ext("score", "combo"), 0);
    assert_eq!(r.emitted("combo.changed").last().unwrap()["combo"], 0);
    r.correct(100);
    assert_eq!(r.ext("score", "combo"), 1);
}

#[test]
fn accuracy_percent_tracks_ratio() {
    let mut r = rig(&[no("score.accuracy_percent")]);
    r.begin_round(0);
    r.correct(100);
    assert_eq!(r.g.score, 100);
    r.begin_round(0);
    r.wrong();
    assert_eq!(r.g.score, 50);
    assert_eq!(r.ext("score", "accuracy"), 50);
}

#[test]
fn lives_bonus_pays_per_remaining_life() {
    let mut r = rig(&[no("score.lives_bonus")]);
    r.send("lives.changed", json!({ "lives": 3 }));
    r.send("lives.changed", json!({ "lives": 2 }));
    r.over();
    assert_eq!(r.g.score, 400);
}

#[test]
fn par_target_awards_bonus_only_when_beaten() {
    let mut r = rig(&[("score.par_target", json!({ "par": 500, "bonus": 250 }))]);
    assert_eq!(r.ext("score", "par")["gap"], 500);
    r.add(600);
    assert_eq!(r.ext("score", "par")["hit"], true);
    r.over();
    assert_eq!(r.g.score, 850);
    let mut low = rig(&[no("score.par_target")]);
    low.add(100);
    low.over();
    assert_eq!(low.g.score, 100);
}

#[test]
fn perfect_bonus_needs_a_flawless_game() {
    let mut r = rig(&[no("score.perfect_bonus")]);
    r.begin_round(0);
    r.correct(100);
    r.over();
    assert_eq!(r.g.score, 500);
    let mut f = rig(&[no("score.perfect_bonus")]);
    f.begin_round(0);
    f.correct(100);
    f.begin_round(0);
    f.wrong();
    f.over();
    assert_eq!(f.g.score, 0);
    assert_eq!(f.ext("score", "perfect"), false);
}

#[test]
fn collect_count_scores_each_item() {
    let mut r = rig(&[no("score.collect_count")]);
    for _ in 0..3 {
        r.send("entity.collected", json!({ "kind": "star", "value": 1 }));
    }
    assert_eq!(r.g.score, 30);
    assert_eq!(r.ext("score", "collected"), 3);
}

#[test]
fn word_length_pays_per_letter_for_valid_words() {
    let mut r = rig(&[no("score.word_length")]);
    r.send("word.submitted", json!({ "word": "cheese", "valid": true }));
    r.send("word.submitted", json!({ "word": "zzzz", "valid": false }));
    assert_eq!(r.g.score, 60);
}

#[test]
fn rhythm_accuracy_grades_hits() {
    let mut r = rig(&[no("score.rhythm_accuracy")]);
    r.send("beat.hit", json!({ "grade": "perfect" }));
    r.send("beat.hit", json!({ "grade": "good" }));
    r.send("beat.hit", json!({ "grade": "miss" }));
    assert_eq!(r.g.score, 150);
    assert_eq!(r.ext("score", "rhythm")["miss"], 1);
}

#[test]
fn drawing_similarity_scores_and_resolves_the_round() {
    let square = json!([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
    let mut r = rig(&[no("score.drawing_similarity")]);
    r.g.custom.insert("reference_shape".into(), square);
    r.begin_round(0);
    r.send("input.draw", json!({ "points": [[10, 10], [30, 10], [30, 30], [10, 30], [10, 10]] }));
    assert_eq!(r.ext("score", "drawing_similarity"), 1.0);
    assert_eq!(r.g.score, 100);
    assert_eq!(r.emitted("answer.correct").len(), 1);
    r.begin_round(0);
    r.send("input.draw", json!({ "points": [{ "x": 0, "y": 0 }, { "x": 5, "y": 0 }] }));
    assert!(r.ext("score", "drawing_similarity").as_f64().unwrap() < 0.6);
    assert_eq!(r.g.score, 100);
    assert_eq!(r.emitted("answer.wrong").len(), 1);
}

// ---------------------------------------------------------------- content

fn kind_items(kind: &str, n: usize) -> Vec<Item> {
    (1..=n)
        .map(|i| {
            item(json!({ "id": format!("{kind}{i}"), "kind": kind, "prompt": format!("{kind} prompt {i}"),
                "media_url": format!("http://x/{kind}{i}"), "choices": ["a", "b", "c"], "answer": 2, "clue": "a hint" }))
        })
        .collect()
}

#[test]
fn word_list_filters_by_length_and_dedupes() {
    let items = ["cat", "Cat", "elephant", "tree", "an", "house"]
        .iter()
        .map(|w| item(json!({ "kind": "word", "prompt": w, "clue": format!("hint {w}") })))
        .collect();
    let mut r = rig_with(&[("content.word_list", json!({ "min_len": 3, "max_len": 5 }))], items, Value::Null);
    r.load();
    assert_eq!(r.ext("content", "words"), json!(["cat", "tree", "house"]));
    assert_eq!(r.g.custom["words"], json!(["cat", "tree", "house"]));
    assert_eq!(r.ext("content", "word_hints")["tree"], "hint tree");
}

#[test]
fn emoji_set_flattens_and_limits() {
    let items = vec![
        item(json!({ "kind": "emoji", "prompt": "🍕 🍔 🍟" })),
        item(json!({ "kind": "emoji", "prompt": "x", "choices": ["🍔", "🌮"] })),
    ];
    let mut r = rig_with(&[("content.emoji_set", json!({ "count": 4 }))], items, Value::Null);
    r.load();
    assert_eq!(r.ext("content", "emoji"), json!(["🍕", "🍔", "🍟", "🌮"]));
}

#[test]
fn quiz_kinds_claim_rounds_and_fill_them() {
    for (id, kind) in [("content.caption_guess", "caption"), ("content.fill_blank", "blank"), ("content.audio_clip", "audio")] {
        let mut r = rig_with(&[no(id)], kind_items(kind, 2), Value::Null);
        r.load();
        assert_eq!(r.g.order, vec![0, 1], "{id}");
        r.begin_round(0);
        assert_eq!(r.g.round.choices, vec!["a", "b", "c"], "{id}");
        assert_eq!(r.g.round.correct, 2);
        assert!(r.g.round.prompt.contains(&format!("{kind} prompt 1")), "{id}");
        if kind == "caption" {
            assert_eq!(r.g.round.media_url.as_deref(), Some("http://x/caption1"));
        }
        if kind == "audio" {
            assert_eq!(r.ext("content", "audio")["url"], "http://x/audio1");
            assert_eq!(r.ext("content", "audio")["clip_ms"], 5000);
        }
    }
}

#[test]
fn pair_deck_builds_a_shuffled_deck() {
    let items = (1..=3).map(|i| item(json!({ "kind": "pair", "prompt": format!("A{i}"), "choices": [format!("B{i}")] }))).collect();
    let mut r = rig_with(&[("content.pair_deck", json!({ "pairs": 2 }))], items, Value::Null);
    r.load();
    let deck = r.ext("content", "deck");
    assert_eq!(deck["pairs"], 2);
    let cards = deck["cards"].as_array().unwrap();
    assert_eq!(cards.len(), 4);
    for p in 0..2 {
        assert_eq!(cards.iter().filter(|c| c["pair"] == p).count(), 2);
    }
}

#[test]
fn image_sequence_shuffles_but_keeps_the_answer_order() {
    let mut r = rig_with(&[("content.image_sequence", json!({ "length": 4 }))], kind_items("sequence", 5), Value::Null);
    r.load();
    let s = r.ext("content", "sequence");
    assert_eq!(s["answer"], json!(["sequence1", "sequence2", "sequence3", "sequence4"]));
    let shown: Vec<&str> = s["shown"].as_array().unwrap().iter().map(|v| v["id"].as_str().unwrap()).collect();
    assert_eq!(shown.len(), 4);
    assert_ne!(shown, vec!["sequence1", "sequence2", "sequence3", "sequence4"]);
}

#[test]
fn riddle_set_accepts_normalized_free_text_and_limits_attempts() {
    let riddles = vec![item(json!({ "kind": "riddle", "prompt": "I have keys but no locks", "choices": ["A Piano", "piano"], "clue": "music" }))];
    let mut r = rig_with(&[no("content.riddle_set")], riddles.clone(), Value::Null);
    r.load();
    r.begin_round(0);
    assert_eq!(r.ext("content", "riddle")["hint"], "music");
    assert_eq!(r.ext("content", "riddle")["letters"], 6);
    r.send("input.text", json!({ "text": "guitar" }));
    assert_eq!(r.emitted("answer.wrong").len(), 1);
    assert!(!r.g.round.locked);
    r.send("input.text", json!({ "text": "  a PIANO! " }));
    assert_eq!(r.emitted("answer.correct").len(), 1);
    assert!(r.g.round.locked);
    r.end_round();
    assert_eq!(r.ext("content", "riddle")["answer"], "A Piano");
    let mut f = rig_with(&[no("content.riddle_set")], riddles, Value::Null);
    f.load();
    f.begin_round(0);
    for t in ["a", "b", "c"] {
        f.send("input.text", json!({ "text": t }));
    }
    assert!(f.g.round.locked);
    f.send("input.text", json!({ "text": "piano" }));
    assert!(f.emitted("answer.correct").is_empty());
}

#[test]
fn trivia_category_filters_questions_by_id_prefix() {
    let items: Vec<Item> = ["geo:1", "food:1", "geo:2", "plain"]
        .iter()
        .map(|id| item(json!({ "id": id, "kind": "question", "prompt": id, "choices": ["a", "b"], "answer": 0 })))
        .collect();
    let mut r = rig_with(&[("content.trivia_category", json!({ "category": "geo" }))], items.clone(), Value::Null);
    r.load();
    assert_eq!(r.g.order, vec![0, 2]);
    assert_eq!(r.ext("content", "category"), "geo");
    let mut all = rig_with(&[no("content.trivia_category")], items, Value::Null);
    all.load();
    assert_eq!(all.g.order.len(), 4);
}

#[test]
fn user_media_pool_fills_rounds_without_media() {
    let mut items = kind_items("media", 2);
    items.extend((1..=2).map(|i| item(json!({ "id": format!("q{i}"), "kind": "question", "prompt": "p", "choices": ["a", "b"], "answer": 0 }))));
    let mut r = rig_with(&[("content.user_media_pool", json!({ "max_media": 2 }))], items, Value::Null);
    r.load();
    assert_eq!(r.ext("content", "media").as_array().unwrap().len(), 2);
    r.begin_round(0);
    r.ticks(1);
    assert_eq!(r.g.round.media_url.as_deref(), Some("http://x/media1"));
    r.end_round();
    r.begin_round(0);
    r.ticks(1);
    assert_eq!(r.g.round.media_url.as_deref(), Some("http://x/media2"));
}

#[test]
fn map_pins_judges_taps_against_the_pin() {
    let pins = vec![item(json!({ "kind": "pin", "prompt": "Lisbon", "choices": ["0.30", "0.60", "0.1"] }))];
    let mut r = rig_with(&[no("content.map_pins")], pins.clone(), Value::Null);
    r.load();
    r.begin_round(0);
    assert_eq!(r.g.round.prompt, "Where is Lisbon?");
    assert!(r.ext("content", "pin")["target"].is_null());
    r.send("input.tap", json!({ "x": 0.34, "y": 0.62 }));
    assert_eq!(r.emitted("answer.correct").len(), 1);
    r.end_round();
    assert_eq!(r.ext("content", "pin")["target"]["x"], 0.3);
    let mut w = rig_with(&[no("content.map_pins")], pins, Value::Null);
    w.load();
    w.begin_round(0);
    w.send("input.tap", json!({ "x": 0.9, "y": 0.1 }));
    assert_eq!(w.emitted("answer.wrong").len(), 1);
    assert!(w.g.round.locked);
}

#[test]
fn reference_drawing_publishes_the_shape() {
    let shapes = vec![item(json!({ "kind": "shape", "prompt": "square", "choices": ["0,0", "1,0", "1,1", "0,1", "0,0"] }))];
    let mut r = rig_with(&[no("content.reference_drawing")], shapes, Value::Null);
    r.load();
    r.begin_round(0);
    assert_eq!(r.g.round.prompt, "Draw: square");
    assert_eq!(r.g.custom["reference_shape"].as_array().unwrap().len(), 5);
    assert_eq!(r.ext("content", "shape")["name"], "square");
}

#[test]
fn beatmap_grades_taps_and_misses_passed_notes() {
    let beats = vec![item(json!({ "kind": "beat", "prompt": "song", "choices": ["500", "1000", "1500"] }))];
    let mut r = rig_with(&[no("content.beatmap"), no("score.rhythm_accuracy")], beats, Value::Null);
    r.load();
    assert_eq!(r.ext("content", "beats")["total"], 3);
    r.send("session.started", json!({}));
    r.ticks(30); // ~500ms
    r.send("input.tap", json!({ "x": 0, "y": 0 }));
    assert_eq!(r.emitted("beat.hit")[0]["grade"], "perfect");
    assert_eq!(r.g.score, 100);
    r.ticks(60); // ~1500ms, the 1000ms note went unhit
    assert_eq!(r.emitted("beat.hit")[1]["grade"], "miss");
    r.send("input.tap", json!({ "x": 0, "y": 0 }));
    assert!(r.emitted("beat.hit").len() >= 3);
    assert_eq!(r.ext("content", "beats")["miss"], 1);
    r.send("input.tap", json!({ "x": 0, "y": 0 }));
    let n = r.emitted("beat.hit").len();
    r.send("input.tap", json!({ "x": 0, "y": 0 }));
    assert_eq!(r.emitted("beat.hit").len(), n, "no unjudged note in range, tap ignored");
}

// ---------------------------------------------------------------- social

fn social_copy() -> Value {
    json!({ "social": {
        "me": { "name": "Bayan" },
        "friends": [ { "name": "Ana", "score": 300 }, { "name": "Diego", "score": 900 } ],
        "group": [ { "name": "Crew1", "score": 50 } ],
        "ghost": { "name": "Mina", "series": [[0, 0], [500, 100], [1000, 400]] },
        "opponent": { "name": "Ana", "score": 250 },
        "coop": [ { "name": "Ana", "score": 100 }, { "name": "Mina", "score": 200 } ],
        "reactions": { "🔥": 2 }, "comments": [ { "name": "Ana", "text": "gg" } ],
        "tags": { "m1": ["Ana", "Diego"] }, "creator": { "id": "u9", "name": "Mina" } } })
}

fn social(concepts: &[(&str, Value)]) -> Rig {
    rig_with(concepts, questions(), social_copy())
}

#[test]
fn challenge_friend_emits_challenge_with_score() {
    let mut r = social(&[("social.challenge_friend", json!({ "max_recipients": 3 }))]);
    r.add(120);
    r.over();
    assert_eq!(r.emitted("challenge.sent")[0]["max_recipients"], 3);
    assert_eq!(r.ext("social", "challenge")["score"], 120);
}

#[test]
fn friends_leaderboard_ranks_the_player_among_friends() {
    let mut r = social(&[("social.friends_leaderboard", json!({ "top": 2 }))]);
    r.load();
    assert_eq!(r.ext("social", "friends_leaderboard")["final"], false);
    r.add(500);
    r.over();
    let b = r.ext("social", "friends_leaderboard");
    assert_eq!(b["final"], true);
    assert_eq!(b["you_rank"], 2);
    assert_eq!(b["rows"][0]["name"], "Diego");
    assert_eq!(b["rows"][1]["name"], "Bayan");
    assert_eq!(b["rows"][1]["you"], true);
    let mut low = social(&[("social.friends_leaderboard", json!({ "top": 1 }))]);
    low.over();
    let rows = low.ext("social", "friends_leaderboard")["rows"].clone();
    assert_eq!(rows.as_array().unwrap().len(), 2, "top row plus the player's own row");
    assert_eq!(rows[1]["rank"], 3);
}

#[test]
fn ghost_replay_follows_the_series_and_reports_the_gap() {
    let mut r = social(&[no("social.ghost_replay")]);
    r.ticks(30);
    let g = r.ext("social", "ghost");
    assert_eq!(g["name"], "Mina");
    assert_eq!(g["score"], 100);
    assert_eq!(g["opacity"], 0.5);
    r.add(300);
    assert_eq!(r.ext("social", "ghost")["ahead"], true);
    r.ticks(40);
    assert_eq!(r.ext("social", "ghost")["score"], 400);
    assert!(!r.emitted("ghost.updated").is_empty());
}

#[test]
fn async_versus_compares_with_the_opponent() {
    let mut r = social(&[no("social.async_versus")]);
    r.load();
    assert_eq!(r.ext("social", "versus")["status"], "pending");
    r.add(300);
    r.over();
    assert_eq!(r.ext("social", "versus")["status"], "win");
    assert_eq!(r.ext("social", "versus")["same_seed"], true);
    assert_eq!(r.emitted("challenge.sent")[0]["mode"], "async_versus");
    let mut l = social(&[no("social.async_versus")]);
    l.over();
    assert_eq!(l.ext("social", "versus")["status"], "lose");
}

#[test]
fn coop_score_pools_everyone() {
    let mut r = social(&[no("social.coop_score")]);
    assert_eq!(r.ext("social", "coop")["pool"], 300);
    r.add(50);
    let c = r.ext("social", "coop");
    assert_eq!(c["pool"], 350);
    assert_eq!(c["mine"], 50);
}

#[test]
fn reaction_stickers_unlock_after_the_game() {
    let mut r = social(&[no("social.reaction_stickers")]);
    assert_eq!(r.ext("social", "reactions")["enabled"], false);
    r.over();
    let s = r.ext("social", "reactions");
    assert_eq!(s["enabled"], true);
    assert_eq!(s["counts"]["🔥"], 2);
    assert_eq!(s["available"].as_array().unwrap().len(), 5);
}

#[test]
fn comment_on_result_unlocks_after_the_game() {
    let mut r = social(&[no("social.comment_on_result")]);
    assert_eq!(r.ext("social", "comments")["enabled"], false);
    r.over();
    let c = r.ext("social", "comments");
    assert_eq!(c["enabled"], true);
    assert_eq!(c["items"][0]["text"], "gg");
}

#[test]
fn tag_friend_in_photo_reveals_people_after_the_round() {
    let mut r = social(&[no("social.tag_friend_in_photo")]);
    r.g.order = vec![0, 1, 2];
    r.begin_round(0);
    let t = r.ext("social", "tags");
    assert_eq!(t["count"], 2);
    assert!(t["people"].is_null());
    r.end_round();
    assert_eq!(r.ext("social", "tags")["people"], json!(["Ana", "Diego"]));
}

#[test]
fn group_scoreboard_uses_group_or_friends() {
    let mut g = social(&[no("social.group_scoreboard")]);
    g.add(70);
    g.over();
    let b = g.ext("social", "group_scoreboard");
    assert_eq!(b["scope"], "group");
    assert_eq!(b["rows"][0]["name"], "Bayan");
    let mut f = social(&[("social.group_scoreboard", json!({ "group_scope": "friends" }))]);
    f.over();
    assert_eq!(f.ext("social", "group_scoreboard")["rows"][0]["name"], "Diego");
}

#[test]
fn rematch_offers_the_same_seed() {
    let mut r = social(&[no("social.rematch")]);
    r.add(10);
    r.over();
    assert_eq!(r.ext("social", "rematch")["same_seed"], true);
    assert_eq!(r.emitted("challenge.sent")[0]["mode"], "rematch");
}

#[test]
fn spectate_streams_frames_at_ten_hertz() {
    let mut r = social(&[no("social.spectate")]);
    r.ticks(12);
    let s = r.ext("social", "spectate");
    assert_eq!(s["seq"], 2);
    assert_eq!(s["t_ms"], 200);
}

#[test]
fn follow_creator_appears_after_the_game() {
    let mut r = social(&[no("social.follow_creator")]);
    assert_eq!(r.ext("social", "follow")["show"], false);
    r.over();
    let f = r.ext("social", "follow");
    assert_eq!(f["show"], true);
    assert_eq!(f["creator"]["name"], "Mina");
}

// ---------------------------------------------------------------- share

fn share_rig(ids: &[&str]) -> Rig {
    let copy = json!({ "share": { "invite_url": "https://sg.example/p/abc", "challenge_url": "https://sg.example/c/abc",
        "daily_streak": { "days": 4, "played_today": false } } });
    let c: Vec<(&str, Value)> = ids.iter().map(|i| (*i, json!({}))).collect();
    rig_with(&c, questions(), copy)
}

fn play_two(r: &mut Rig) {
    r.begin_round(0);
    r.correct(500);
    r.add(100);
    r.end_round();
    r.begin_round(0);
    r.wrong();
    r.end_round();
}

#[test]
fn replay_clip_windows_the_last_seconds() {
    let mut r = rig(&[("share.replay_clip", json!({ "max_seconds": 1 }))]);
    r.ticks(100);
    r.over();
    let c = r.ext("share", "replay_clip");
    assert_eq!(c["end_tick"], 100);
    assert_eq!(c["start_tick"], 40);
    assert_eq!(r.emitted("share.requested")[0]["kind"], "replay_clip");
}

#[test]
fn daily_streak_counts_today() {
    let mut r = share_rig(&["share.daily_streak"]);
    r.load();
    assert_eq!(r.ext("share", "daily_streak")["days"], 4);
    r.over();
    assert_eq!(r.ext("share", "daily_streak")["days"], 5);
    assert!(r.ext("share", "daily_streak")["text"].as_str().unwrap().contains("5-day"));
    assert_eq!(r.emitted("share.requested")[0]["kind"], "daily_streak");
}

#[test]
fn result_emoji_grid_is_spoiler_free() {
    let mut r = rig(&[("share.result_emoji_grid", json!({}))]);
    play_two(&mut r);
    r.send("timer.expired", json!({ "round": 3 }));
    assert_eq!(r.ext("share", "emoji_grid")["grid"], "🟩⬛⬛");
    r.over();
    assert_eq!(r.emitted("share.requested")[0]["kind"], "result_emoji_grid");
}

#[test]
fn invite_link_carries_the_url_and_a_challenge_line() {
    let mut r = share_rig(&["share.invite_link"]);
    r.add(420);
    r.over();
    let i = r.ext("share", "invite");
    assert_eq!(i["url"], "https://sg.example/p/abc");
    assert_eq!(i["text"], "Can you beat 420 in Rig Game?");
}

#[test]
fn story_export_describes_the_image() {
    let mut r = rig(&[("share.story_export", json!({ "aspect": "1:1" }))]);
    r.add(5);
    r.over();
    let s = r.ext("share", "story");
    assert_eq!((s["width"].clone(), s["height"].clone()), (json!(1080), json!(1080)));
    assert_eq!(s["emoji"], "🌍");
    let d = rig(&[no("share.story_export")]);
    assert_eq!(d.ext("share", "story"), Value::Null);
    let mut d = d;
    d.over();
    assert_eq!(d.ext("share", "story")["height"], 1920);
}

#[test]
fn copy_result_text_summarises_with_the_grid() {
    let mut r = rig(&[no("share.result_emoji_grid"), no("share.copy_result_text")]);
    play_two(&mut r);
    r.over();
    let t = r.ext("share", "text");
    assert_eq!(t, "Rig Game: 100 pts, 1/2 correct, best streak 0\n🟩⬛");
}

#[test]
fn qr_challenge_encodes_the_score_to_beat() {
    let mut r = share_rig(&["share.qr_challenge"]);
    r.add(77);
    r.over();
    assert_eq!(r.ext("share", "qr")["payload"], "https://sg.example/c/abc?beat=77");
    let mut d = rig(&[no("share.qr_challenge")]);
    d.over();
    assert_eq!(d.ext("share", "qr")["payload"], "sg://challenge?beat=0");
}

// ---------------------------------------------------------------- feel

#[test]
fn sound_pack_and_music_loop_publish_audio_settings() {
    let mut r = rig(&[("feel.sound_pack", json!({ "pack": "retro" })), ("feel.music_loop", json!({ "track": "tense" }))]);
    assert_eq!(r.ext("sound", "pack"), "retro");
    assert_eq!(r.ext("sound", "music")["playing"], false);
    r.send("session.started", json!({}));
    assert_eq!(r.ext("sound", "music")["playing"], true);
    assert_eq!(r.ext("sound", "music")["track"], "tense");
    assert_eq!(r.ext("sound", "music")["volume"], 0.4);
    r.send("session.paused", json!({}));
    assert_eq!(r.ext("sound", "music")["playing"], false);
}

#[test]
fn palette_cycle_rotates_the_hue() {
    let mut r = rig(&[("feel.palette_cycle", json!({ "period_s": 4 }))]);
    r.ticks(60);
    assert_eq!(r.ext("style", "palette_cycle")["hue"], 90);
}

#[test]
fn style_settings_are_published() {
    let r = rig(&[
        ("feel.retro_pixel", json!({ "pixel_size": 4 })),
        no("feel.paper_texture"),
        no("feel.neon_glow"),
        ("feel.juice_level", json!({ "level": "high" })),
        ("feel.font_pack", json!({ "font": "mono" })),
        ("feel.dark_light", json!({ "appearance": "dark" })),
    ]);
    assert_eq!(r.ext("style", "pixel_size"), 4);
    assert_eq!(r.ext("style", "paper_grain"), 0.3);
    assert_eq!(r.ext("style", "neon_glow"), 0.6);
    assert_eq!(r.ext("style", "juice"), "high");
    assert_eq!(r.ext("style", "font"), "mono");
    assert_eq!(r.ext("style", "appearance"), "dark");
}

#[test]
fn camera_zoom_pulses_on_correct() {
    let mut r = rig(&[no("feel.camera_zoom")]);
    r.begin_round(0);
    r.correct(200);
    assert_eq!(r.ext("fx", "zoom")["amount"], 0.04);
    assert_eq!(r.ext("fx", "zoom")["n"], 1);
}

#[test]
fn cozy_mode_warms_the_theme() {
    let r = rig(&[no("feel.cozy_mode")]);
    assert_eq!(r.ext("style", "cozy"), true);
    assert_eq!(r.g.theme["mood"], "cozy");
    assert_eq!(r.g.theme["palette"], "sunset");
}

// ---------------------------------------------------------------- meta

#[test]
fn daily_seed_labels_the_date() {
    let mut r = rig_with(&[no("meta.daily_seed")], questions(), json!({ "meta": { "date": "2026-11-12" } }));
    r.load();
    assert_eq!(r.ext("meta", "daily_seed")["date"], "2026-11-12");
    assert_eq!(r.ext("meta", "daily_seed")["enabled"], true);
}

#[test]
fn adaptive_difficulty_tunes_the_next_timer() {
    let mut r = rig(&[("meta.adaptive_difficulty", json!({ "aggressiveness": 1 }))]);
    r.begin_round(10_000);
    r.ticks(1);
    assert_eq!(r.g.round.time_total_us, 10_000_000, "starts at medium difficulty");
    r.correct(500);
    r.end_round();
    assert_eq!(r.emitted("difficulty.changed")[0]["level"], 0.6);
    r.begin_round(10_000);
    r.ticks(1);
    assert_eq!(r.g.round.time_total_us, 9_500_000);
    r.wrong();
    r.end_round();
    r.wrong();
    r.end_round();
    assert_eq!(r.ext("meta", "difficulty"), 0.4);
}

#[test]
fn analytics_events_summarises_at_game_over() {
    let mut r = rig(&[no("meta.analytics_events")]);
    r.begin_round(0);
    r.correct(200);
    r.ticks(5);
    r.over();
    let a = r.ext("meta", "analytics");
    assert_eq!(a["counts"]["answer.correct"], 1);
    assert_eq!(a["counts"]["round.started"], 1);
    assert!(a["counts"].get("tick").is_none());
    assert_eq!(a["correct"], 1);
}

#[test]
fn ab_variant_is_seeded_and_in_range() {
    let a = {
        let mut r = rig(&[("meta.ab_variant", json!({ "variants": 3 }))]);
        r.load();
        r.ext("meta", "ab_variant").as_i64().unwrap()
    };
    let b = {
        let mut r = rig(&[("meta.ab_variant", json!({ "variants": 3 }))]);
        r.load();
        r.g.custom["ab_variant"].as_i64().unwrap()
    };
    assert!((0..3).contains(&a));
    assert_eq!(a, b, "same seed, same variant");
}

#[test]
fn debug_overlay_lists_recent_events() {
    let mut r = rig(&[no("meta.debug_overlay")]);
    r.begin_round(0);
    r.ticks(6);
    let d = r.ext("meta", "debug");
    assert_eq!(d["tick"], 6);
    assert_eq!(d["recent"], json!(["round.started"]));
}

#[test]
fn moderation_hint_flags_contact_info_links_and_abuse() {
    let items = vec![
        item(json!({ "id": "ok", "kind": "question", "prompt": "Where did we eat?", "choices": ["Lisbon", "Porto"], "answer": 0 })),
        item(json!({ "id": "bad1", "kind": "question", "prompt": "Mail me at ana@example.com", "choices": ["a", "b"], "answer": 0 })),
        item(json!({ "id": "bad2", "kind": "question", "prompt": "see https://spam.example", "choices": ["call 555 123 4567", "b"], "answer": 0 })),
        item(json!({ "id": "bad3", "kind": "question", "prompt": "Diego is such an idiot", "choices": ["a", "b"], "answer": 0 })),
    ];
    let mut r = rig_with(&[no("meta.content_moderation_hint")], items, Value::Null);
    r.load();
    let m = r.ext("meta", "moderation");
    assert_eq!(m["count"], 4);
    let reasons: Vec<(String, String)> = m["flags"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| (f["item"].as_str().unwrap().to_string(), f["reason"].as_str().unwrap().to_string()))
        .collect();
    assert!(reasons.contains(&("bad1".into(), "contact_info".into())));
    assert!(reasons.contains(&("bad2".into(), "link".into())));
    assert!(reasons.contains(&("bad2".into(), "contact_info".into())));
    assert!(reasons.contains(&("bad3".into(), "abusive_language".into())));
    assert!(!reasons.iter().any(|(i, _)| i == "ok"));
    assert!(!r.g.warnings.is_empty());
}

#[test]
fn input_recorder_counts_inputs() {
    let mut r = rig(&[no("meta.input_recorder")]);
    r.send("input.raw", json!({ "type": "choice", "index": 1 }));
    r.send("input.raw", json!({ "type": "choice", "index": 2 }));
    assert_eq!(r.ext("meta", "input_recorder")["count"], 2);
    assert_eq!(r.ext("meta", "input_recorder")["recording"], true);
}

#[test]
fn cheat_guard_revokes_points_for_implausible_answers() {
    let mut r = rig(&[no("meta.cheat_guard")]);
    r.begin_round(0);
    r.correct(100);
    r.add(100);
    r.end_round();
    assert_eq!(r.g.score, 0);
    assert_eq!(r.ext("meta", "cheat_guard")["rejected"], 1);
    assert!(r.g.warnings.iter().any(|w| w.contains("implausible")));
    r.begin_round(0);
    r.correct(900);
    r.add(100);
    r.end_round();
    assert_eq!(r.g.score, 100);
}

#[test]
fn locale_provides_strings_and_copy_overrides() {
    let r = rig(&[("meta.locale", json!({ "locale": "es" }))]);
    assert_eq!(r.ext("meta", "locale")["strings"]["correct"], "¡Correcto!");
    assert_eq!(r.ext("meta", "locale")["dir"], "ltr");
    let mut o = rig_with(
        &[("meta.locale", json!({ "locale": "ar" }))],
        questions(),
        json!({ "locales": { "ar": { "correct": "صحيح" } } }),
    );
    o.load();
    assert_eq!(o.ext("meta", "locale")["strings"]["correct"], "صحيح");
    assert_eq!(o.ext("meta", "locale")["strings"]["wrong"], "Wrong");
    assert_eq!(o.ext("meta", "locale")["dir"], "rtl");
}

#[test]
fn schema_version_is_pinned_and_checked() {
    let ok = rig(&[no("meta.schema_version")]);
    assert_eq!(ok.ext("meta", "schema_version"), 1);
    let refs = vec![ConceptRef { id: "meta.schema_version".into(), params: json!({ "version": 2 }).as_object().cloned().unwrap() }];
    let mut g = Game::new("t", questions(), Value::Null, Value::Null, 1);
    concepts::build(&Catalog::load(), &refs, &mut g);
    assert!(g.warnings.iter().any(|w| w.contains("unsupported schema version")));
}

#[test]
fn hot_seat_rotates_players_and_names_a_winner() {
    let mut r = rig(&[no("meta.hot_seat")]);
    for (i, pts) in [100, 0, 50].into_iter().enumerate() {
        r.begin_round(0);
        assert_eq!(r.g.banner, format!("Player {}'s turn", i % 2 + 1));
        r.add(pts);
        r.end_round();
    }
    assert_eq!(r.ext("meta", "hot_seat")["scores"], json!([150, 0]));
    r.over();
    assert_eq!(r.ext("meta", "hot_seat")["winner"], 0);
}

// ---------------------------------------------------------------- accessibility

#[test]
fn reduced_motion_flags_and_suppresses_confetti() {
    let mut r = rig(&[no("accessibility.reduced_motion"), no("feedback.confetti")]);
    assert_eq!(r.ext("a11y", "reduced_motion"), true);
    r.send("feedback.confetti", json!({}));
    assert_eq!(r.g.confetti_us, 0);
}

#[test]
fn high_contrast_supplies_a_palette() {
    let r = rig(&[no("accessibility.high_contrast")]);
    assert_eq!(r.ext("a11y", "high_contrast"), true);
    assert_eq!(r.ext("a11y", "palette")["bg"], "#000000");
    assert_eq!(r.ext("a11y", "palette")["fg"], "#ffffff");
}

#[test]
fn colorblind_palette_recolors_the_flash() {
    let mut r = rig(&[no("accessibility.colorblind_palette")]);
    assert_eq!(r.ext("a11y", "colorblind")["good"], "#0072b2");
    r.begin_round(0);
    r.correct(300);
    r.send("feedback.flash", json!({ "color": "green" }));
    assert_eq!(r.g.flash.as_ref().unwrap().0, "#0072b2");
    r.send("answer.wrong", json!({ "round": 1, "index": 0 }));
    r.send("feedback.flash", json!({ "color": "red" }));
    assert_eq!(r.g.flash.as_ref().unwrap().0, "#e69f00");
    let t = rig(&[("accessibility.colorblind_palette", json!({ "mode": "tritanopia" }))]);
    assert_eq!(t.ext("a11y", "colorblind")["good"], "#009e73");
}

#[test]
fn screen_reader_labels_describe_the_round_and_announce_results() {
    let mut r = rig(&[no("accessibility.screen_reader_labels")]);
    r.begin_round(10_000);
    r.g.round.choices = vec!["A".into(), "B".into()];
    r.g.round.states = vec!["idle", "correct"];
    r.g.round.prompt = "Pick one".into();
    r.ticks(1);
    let l = r.ext("a11y", "labels");
    assert_eq!(l["choices"][0], "Choice 1 of 2: A");
    assert_eq!(l["choices"][1], "Choice 2 of 2: B. Correct answer");
    assert!(l["status"].as_str().unwrap().starts_with("Round 1 of 0. Score 0."));
    assert!(l["status"].as_str().unwrap().contains("10 seconds left"));
    r.correct(100);
    assert_eq!(r.ext("a11y", "labels")["announce"], "Correct.");
}

#[test]
fn extended_time_scales_round_timers() {
    let mut r = rig(&[no("accessibility.extended_time")]);
    assert_eq!(r.ext("a11y", "time_multiplier"), 1.5);
    r.begin_round(10_000);
    r.ticks(1);
    assert_eq!(r.g.round.time_total_us, 15_000_000);
    r.ticks(5);
    assert_eq!(r.g.round.time_total_us, 15_000_000, "scaled once per round");
    let mut d = rig(&[("accessibility.extended_time", json!({ "multiplier": 2.0 }))]);
    d.begin_round(10_000);
    d.ticks(1);
    assert_eq!(d.g.round.time_total_us, 20_000_000);
}

#[test]
fn one_handed_haptics_off_dyslexia_pause_and_targets_flags() {
    let r = rig(&[
        ("accessibility.one_handed", json!({ "side": "left" })),
        no("accessibility.haptics_off"),
        no("accessibility.dyslexia_font"),
        no("accessibility.pause_anytime"),
        ("accessibility.big_targets", json!({ "min_size": 64 })),
    ]);
    assert_eq!(r.ext("a11y", "one_handed"), "left");
    assert_eq!(r.ext("a11y", "haptics_off"), true);
    assert_eq!(r.ext("a11y", "dyslexia_font"), true);
    assert_eq!(r.ext("a11y", "pause_anytime"), true);
    assert_eq!(r.ext("a11y", "min_target_px"), 64);
    assert_eq!(rig(&[no("accessibility.big_targets")]).ext("a11y", "min_target_px"), 56);
}

#[test]
fn captions_describe_audio_cues_then_fade() {
    let mut r = rig(&[no("accessibility.captions")]);
    r.begin_round(0);
    r.correct(100);
    assert_eq!(r.ext("a11y", "captions")[0]["text"], "[chime] Correct answer");
    r.send("answer.wrong", json!({ "round": 1, "index": 0 }));
    assert_eq!(r.ext("a11y", "captions")[1]["text"], "[buzz] Wrong answer");
    r.ticks(160);
    assert_eq!(r.ext("a11y", "captions").as_array().unwrap().len(), 0);
}

// ---------------------------------------------------------------- catalog + session level

const MANIFEST: &str = include_str!("../../spec/templates/quiz.manifest.json");
const CONTENT: &str = include_str!("../../spec/templates/trip-trivia.content.json");

const MY_KINDS: [&str; 8] = ["feedback", "score", "content", "social", "share", "feel", "meta", "accessibility"];

#[test]
fn every_concept_of_these_kinds_is_implemented_and_buildable() {
    let cat = Catalog::load();
    let mut n = 0;
    for c in cat.concepts.iter().filter(|c| MY_KINDS.contains(&c.kind.as_str())) {
        assert_eq!(c.status, "implemented", "{}", c.id);
        let mut g = Game::new("t", Vec::new(), Value::Null, Value::Null, 1);
        let refs = vec![ConceptRef { id: c.id.clone(), params: Default::default() }];
        let built = concepts::build(&cat, &refs, &mut g);
        assert_eq!(built.len(), 1, "{} did not build", c.id);
        assert_eq!(built[0].id(), c.id);
        n += 1;
    }
    assert!(n >= 86, "{n}");
}

fn manifest_with(extra: &[(&str, Value)]) -> Value {
    let mut m: Value = serde_json::from_str(MANIFEST).unwrap();
    for (id, p) in extra {
        m["concepts"].as_array_mut().unwrap().push(json!({ "id": id, "params": p }));
    }
    m
}

fn content_with_copy() -> Value {
    let mut c: Value = serde_json::from_str(CONTENT).unwrap();
    let mut copy = c["copy"].as_object().cloned().unwrap_or_default();
    copy.extend(social_copy().as_object().unwrap().clone());
    copy.insert("share".into(), json!({ "invite_url": "https://sg.example/p/1", "daily_streak": { "days": 2, "played_today": false } }));
    copy.insert("meta".into(), json!({ "date": "2026-11-12" }));
    c["copy"] = Value::Object(copy);
    c
}

/// Plays every round to the end; `correct_every` answers wrong on every nth round when non-zero.
fn play(manifest: &Value, content: &Value, seed: u32, wrong_every: usize) -> Session {
    let mut s = Session::new(&manifest.to_string(), &content.to_string(), seed).expect("valid");
    s.start();
    let mut waited = 0.0;
    let mut round = -1;
    for _ in 0..200_000 {
        if s.state() == State::Ended {
            break;
        }
        s.step(1000.0 / 60.0);
        let v = s.view();
        if v["state"] != "playing" {
            continue;
        }
        let r = v["round"].as_i64().unwrap();
        if r != round {
            round = r;
            waited = 0.0;
        }
        waited += 1000.0 / 60.0;
        let idle = v["choices"].as_array().unwrap().iter().all(|c| c["state"] == "idle");
        if idle && waited >= 700.0 {
            let item = content["items"].as_array().unwrap().iter().find(|i| i["prompt"] == v["prompt"]).unwrap();
            let right = item["choices"][item["answer"].as_u64().unwrap() as usize].clone();
            let labels: Vec<Value> = v["choices"].as_array().unwrap().iter().map(|c| c["label"].clone()).collect();
            let right_idx = labels.iter().position(|l| *l == right).unwrap();
            let idx = if wrong_every > 0 && (r as usize) % wrong_every == 0 { (right_idx + 1) % labels.len() } else { right_idx };
            s.input(&json!({ "type": "choice", "index": idx }).to_string()).unwrap();
        }
    }
    assert_eq!(s.state(), State::Ended, "session should finish");
    s
}

fn big_manifest() -> Value {
    manifest_with(&[
        ("feedback.sound_cue", json!({})),
        ("feedback.screen_shake", json!({})),
        ("feedback.floating_score", json!({})),
        ("feedback.pulse_timer", json!({})),
        ("feedback.color_wash", json!({})),
        ("feedback.emoji_burst", json!({})),
        ("feedback.voice_cheer", json!({})),
        ("feedback.slowmo", json!({})),
        ("feedback.vignette_low_time", json!({})),
        ("feedback.toast", json!({})),
        ("score.combo_chain", json!({ "window_ms": 5000 })),
        ("score.accuracy_percent", json!({})),
        ("score.par_target", json!({ "par": 300, "bonus": 111 })),
        ("score.perfect_bonus", json!({})),
        ("social.challenge_friend", json!({})),
        ("social.friends_leaderboard", json!({})),
        ("social.ghost_replay", json!({})),
        ("social.async_versus", json!({})),
        ("social.coop_score", json!({})),
        ("social.group_scoreboard", json!({})),
        ("social.spectate", json!({})),
        ("social.follow_creator", json!({})),
        ("share.replay_clip", json!({})),
        ("share.daily_streak", json!({})),
        ("share.result_emoji_grid", json!({})),
        ("share.invite_link", json!({})),
        ("share.copy_result_text", json!({})),
        ("feel.palette_cycle", json!({})),
        ("feel.camera_zoom", json!({})),
        ("meta.adaptive_difficulty", json!({})),
        ("meta.analytics_events", json!({})),
        ("meta.ab_variant", json!({ "variants": 4 })),
        ("meta.debug_overlay", json!({})),
        ("meta.cheat_guard", json!({})),
        ("meta.hot_seat", json!({ "players": 2 })),
        ("meta.locale", json!({ "locale": "fr" })),
        ("accessibility.extended_time", json!({ "multiplier": 2.0 })),
        ("accessibility.captions", json!({})),
        ("accessibility.screen_reader_labels", json!({})),
        ("accessibility.colorblind_palette", json!({})),
    ])
}

#[test]
fn quiz_with_many_meta_concepts_validates_and_replays_deterministically() {
    let m = big_manifest();
    let c = content_with_copy();
    let report: Value = serde_json::from_str(&sg_runtime::validate(&m.to_string(), &c.to_string())).unwrap();
    assert_eq!(report["ok"], true, "{}", report["errors"]);

    let a = play(&m, &c, 42, 4);
    let b = play(&m, &c, 42, 4);
    assert_eq!(a.view()["ext"], b.view()["ext"]);
    assert_eq!(a.result()["score"], b.result()["score"]);
    assert_eq!(a.result()["ticks"], b.result()["ticks"]);
    assert!(a.result()["warnings"].as_array().unwrap().iter().all(|w| !w.as_str().unwrap().contains("stub")));

    let res = a.result();
    let replayed: Value =
        serde_json::from_str(&sg_runtime::replay(&m.to_string(), &c.to_string(), 42, &res["inputs"].to_string())).unwrap();
    assert_eq!(replayed["score"], res["score"]);
    assert_eq!(replayed["ticks"], res["ticks"]);

    let ext = a.view()["ext"].clone();
    assert_eq!(ext["share"]["emoji_grid"]["rows"].as_array().unwrap().len(), 2);
    assert_eq!(ext["social"]["friends_leaderboard"]["final"], true);
    assert_eq!(ext["social"]["versus"]["status"], "win");
    assert!(ext["meta"]["analytics"]["counts"]["answer.correct"].as_i64().unwrap() > 0);
    assert_eq!(ext["meta"]["locale"]["strings"]["correct"], "Correct !");
    assert_eq!(ext["a11y"]["time_multiplier"], 2.0);
    assert_eq!(ext["meta"]["hot_seat"]["players"], 2);
    assert!(ext["share"]["text"].as_str().unwrap().contains("pts"));
}

#[test]
fn extended_time_doubles_the_round_timer_in_a_session() {
    let m = manifest_with(&[("accessibility.extended_time", json!({ "multiplier": 2.0 }))]);
    let mut s = Session::new(&m.to_string(), CONTENT, 1).unwrap();
    s.start();
    for _ in 0..400 {
        s.step(1000.0 / 60.0);
    }
    let v = s.view();
    assert_eq!(v["state"], "playing");
    assert_eq!(v["round_time_ms"], 20_000);
    assert!(v["time_left_ms"].as_i64().unwrap() > 10_000);
}

#[test]
fn par_target_and_perfect_bonus_adjust_the_final_score() {
    let plain = play(&manifest_with(&[]), &serde_json::from_str(CONTENT).unwrap(), 5, 0);
    let m = manifest_with(&[("score.par_target", json!({ "par": 100, "bonus": 250 })), ("score.perfect_bonus", json!({ "bonus": 500 }))]);
    let bonus = play(&m, &serde_json::from_str(CONTENT).unwrap(), 5, 0);
    assert_eq!(bonus.score(), plain.score() + 750);
    let flawed = play(&m, &serde_json::from_str(CONTENT).unwrap(), 5, 3);
    let flawed_plain = play(&manifest_with(&[]), &serde_json::from_str(CONTENT).unwrap(), 5, 3);
    assert_eq!(flawed.score(), flawed_plain.score() + 250);
}

#[test]
fn content_concepts_validate_with_matching_items() {
    let mut c: Value = serde_json::from_str(CONTENT).unwrap();
    for i in 0..3 {
        c["items"].as_array_mut().unwrap().push(json!({ "id": format!("pool{i}"), "kind": "media", "prompt": "pic",
            "media_url": format!("https://picsum.photos/seed/pool{i}/600/400") }));
    }
    let m = manifest_with(&[("content.user_media_pool", json!({ "max_media": 2 })), ("content.trivia_category", json!({}))]);
    let report: Value = serde_json::from_str(&sg_runtime::validate(&m.to_string(), &c.to_string())).unwrap();
    assert_eq!(report["ok"], true, "{}", report["errors"]);
    let s = play(&m, &c, 3, 0);
    assert!(s.score() > 0);
    assert_eq!(s.view()["ext"]["content"]["media"].as_array().unwrap().len(), 2);
    // without matching items the validator rejects the implemented concept
    let missing: Value = serde_json::from_str(&sg_runtime::validate(&m.to_string(), CONTENT)).unwrap();
    assert_eq!(missing["ok"], false);
}
