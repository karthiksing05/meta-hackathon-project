use serde_json::{json, Value};
use sg_runtime::session::State;
use sg_runtime::Session;

const MANIFEST: &str = include_str!("../../spec/templates/quiz.manifest.json");
const CONTENT: &str = include_str!("../../spec/templates/trip-trivia.content.json");

fn manifest() -> Value {
    serde_json::from_str(MANIFEST).unwrap()
}

fn report(m: &Value) -> Value {
    serde_json::from_str(&sg_runtime::validate(&m.to_string(), CONTENT)).unwrap()
}

fn errors_text(r: &Value) -> String {
    r["errors"].to_string()
}

/// Plays every round, answering correctly (or wrongly) after `think_ms`. Returns the finished session.
fn play(manifest: &Value, seed: u32, correct: bool, think_ms: f64) -> Session {
    let content: Value = serde_json::from_str(CONTENT).unwrap();
    let mut s = Session::new(&manifest.to_string(), CONTENT, seed).expect("valid");
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
        if idle && waited >= think_ms {
            let item = content["items"].as_array().unwrap().iter().find(|i| i["prompt"] == v["prompt"]).unwrap();
            let right = item["choices"][item["answer"].as_u64().unwrap() as usize].clone();
            let labels: Vec<Value> = v["choices"].as_array().unwrap().iter().map(|c| c["label"].clone()).collect();
            let right_idx = labels.iter().position(|l| *l == right).unwrap();
            let idx = if correct { right_idx } else { (right_idx + 1) % labels.len() };
            s.input(&json!({ "type": "choice", "index": idx }).to_string()).unwrap();
        }
    }
    assert_eq!(s.state(), State::Ended, "session should finish");
    s
}

#[test]
fn template_validates_cleanly() {
    let r = report(&manifest());
    assert_eq!(r["ok"], true, "{}", errors_text(&r));
}

#[test]
fn replay_is_deterministic() {
    let m = manifest();
    let a = play(&m, 42, true, 700.0);
    let b = play(&m, 42, true, 700.0);
    assert_eq!(a.score(), b.score());
    assert!(a.score() > 0);
    let res = a.result();
    let replayed: Value =
        serde_json::from_str(&sg_runtime::replay(&m.to_string(), CONTENT, 42, &res["inputs"].to_string())).unwrap();
    assert_eq!(replayed["score"], res["score"]);
    assert_eq!(replayed["ticks"], res["ticks"]);
}

#[test]
fn replay_matches_with_mixed_answers_and_pause() {
    let m = manifest();
    let mut s = Session::new(&m.to_string(), CONTENT, 7).unwrap();
    s.start();
    for i in 0..5000 {
        s.step(16.7);
        if i == 300 {
            s.input(r#"{"type":"pause"}"#).unwrap();
            s.step(500.0);
            s.input(r#"{"type":"resume"}"#).unwrap();
        }
        if i % 97 == 0 {
            s.input(&json!({ "type": "choice", "index": (i / 97) % 4 }).to_string()).unwrap();
        }
        if s.state() == State::Ended {
            break;
        }
    }
    let res = s.result();
    let r: Value = serde_json::from_str(&sg_runtime::replay(&m.to_string(), CONTENT, 7, &res["inputs"].to_string())).unwrap();
    assert_eq!(r["score"], res["score"]);
}

#[test]
fn seed_changes_order() {
    let m = manifest();
    let prompt = |seed| {
        let mut s = Session::new(&m.to_string(), CONTENT, seed).unwrap();
        s.start();
        for _ in 0..400 {
            s.step(16.7);
        }
        s.view()["prompt"].to_string()
    };
    let prompts: Vec<String> = (1..6).map(prompt).collect();
    assert!(prompts.iter().any(|p| *p != prompts[0]), "seeds should shuffle the first question");
}

#[test]
fn validator_catches_unknown_concept() {
    let mut m = manifest();
    m["concepts"].as_array_mut().unwrap().push(json!({ "id": "score.does_not_exist" }));
    let r = report(&m);
    assert_eq!(r["ok"], false);
    assert!(errors_text(&r).contains("unknown concept"));
}

#[test]
fn validator_catches_bad_param() {
    let mut m = manifest();
    m["concepts"][2]["params"]["rounds"] = json!(500);
    let r = report(&m);
    assert!(errors_text(&r).contains("above the maximum"), "{}", errors_text(&r));
    m["concepts"][2]["params"]["rounds"] = json!("eight");
    assert!(errors_text(&report(&m)).contains("expected an integer"));
    m["concepts"][2]["params"] = json!({ "nope": 1 });
    assert!(errors_text(&report(&m)).contains("no param"));
}

#[test]
fn validator_catches_conflict_and_missing_requirement() {
    let mut m = manifest();
    m["concepts"].as_array_mut().unwrap().push(json!({ "id": "score.time_attack" }));
    assert!(errors_text(&report(&m)).contains("conflicts with"));

    let mut m = manifest();
    let cs = m["concepts"].as_array_mut().unwrap();
    cs.retain(|c| c["id"] != "rule.round_timer");
    assert!(errors_text(&report(&m)).contains("requires 'rule.round_timer'"));
}

#[test]
fn validator_catches_unwired_events() {
    let mut m = manifest();
    m["concepts"].as_array_mut().unwrap().retain(|c| c["id"] != "rule.single_answer");
    let e = errors_text(&report(&m));
    assert!(e.contains("consumes 'answer.correct' but no concept"), "{e}");
}

#[test]
fn validator_catches_broken_glue() {
    let mut m = manifest();
    m["glue"][0]["script"] = json!("fn on_event(ev) { let x = ; }");
    assert!(errors_text(&report(&m)).contains("compile error"));

    m["glue"][0]["script"] = json!("fn on_event(ev) { loop { } }");
    let e = errors_text(&report(&m));
    assert!(e.contains("dry-run"), "{e}");

    m["glue"][0]["script"] = json!("fn something_else(ev) { }");
    assert!(errors_text(&report(&m)).contains("on_event"));

    m["glue"][0]["script"] = json!("fn on_event(ev) { eval(\"1\"); }");
    assert!(errors_text(&report(&m)).contains("dry-run") || errors_text(&report(&m)).contains("compile"));

    m["glue"][0]["on"] = json!(["not.an.event"]);
    assert!(errors_text(&report(&m)).contains("unknown event"));
}

#[test]
fn validator_checks_content_shape() {
    let mut c: Value = serde_json::from_str(CONTENT).unwrap();
    c["items"][0]["answer"] = json!(9);
    let r: Value = serde_json::from_str(&sg_runtime::validate(MANIFEST, &c.to_string())).unwrap();
    assert!(errors_text(&r).contains("index into choices"));
    c["items"] = json!([]);
    let r: Value = serde_json::from_str(&sg_runtime::validate(MANIFEST, &c.to_string())).unwrap();
    assert_eq!(r["ok"], false);
}

#[test]
fn unknown_concepts_are_rejected() {
    let mut m = manifest();
    m["concepts"].as_array_mut().unwrap().push(json!({ "id": "feedback.not_a_concept" }));
    let r = report(&m);
    assert_eq!(r["ok"], false);
    assert!(errors_text(&r).contains("unknown concept"));
    assert!(Session::new(&m.to_string(), CONTENT, 1).is_err());
}

/// Plays all rounds correctly on a fixed tick cadence. Returns (final score, points earned in the last round, saw banner).
fn play_fixed_cadence(manifest: &Value, seed: u32) -> (i64, i64, bool) {
    let content: Value = serde_json::from_str(CONTENT).unwrap();
    let mut s = Session::new(&manifest.to_string(), CONTENT, seed).unwrap();
    s.start();
    let (mut round, mut round_points, mut banner) = (0, 0, false);
    for _ in 0..100_000 {
        if s.state() == State::Ended {
            break;
        }
        s.step(1000.0 / 60.0);
        for ev in s.drain_events().as_array().unwrap() {
            if ev["name"] == "round.started" {
                round_points = 0;
            }
            if ev["name"] == "score.changed" {
                round_points += ev["data"]["delta"].as_i64().unwrap();
            }
        }
        let v = s.view();
        if v["state"] != "playing" {
            continue;
        }
        round = v["round"].as_i64().unwrap();
        banner |= round == v["total_rounds"].as_i64().unwrap() && v["banner"].as_str().unwrap_or("").contains("double");
        let idle = v["choices"].as_array().unwrap().iter().all(|c| c["state"] == "idle");
        if idle && s.tick_count() % 42 == 0 {
            let item = content["items"].as_array().unwrap().iter().find(|i| i["prompt"] == v["prompt"]).unwrap();
            let right = item["choices"][item["answer"].as_u64().unwrap() as usize].clone();
            let idx = v["choices"].as_array().unwrap().iter().position(|c| c["label"] == right).unwrap();
            s.input(&json!({ "type": "choice", "index": idx }).to_string()).unwrap();
        }
    }
    assert_eq!(round, 8);
    (s.score(), round_points, banner)
}

#[test]
fn glue_doubles_points_in_final_round() {
    let mut without = manifest();
    without["glue"] = json!([]);
    let (plain_score, plain_final, plain_banner) = play_fixed_cadence(&without, 5);
    let (glued_score, glued_final, glued_banner) = play_fixed_cadence(&manifest(), 5);
    assert!(plain_final > 0);
    assert!(!plain_banner && glued_banner, "banner only with glue");
    assert_eq!(glued_score, plain_score + plain_final, "final round is worth double");
    assert_eq!(glued_final, plain_final * 2);
}

#[test]
fn glue_infinite_loop_is_stopped_without_killing_session() {
    let mut m = manifest();
    m["glue"] = json!([{
        "id": "spin",
        "on": ["round.started"],
        "script": "fn on_event(ev) { if get(\"round\") == 3 { loop { } } }"
    }, {
        "id": "also_runs",
        "on": ["game.over"],
        "script": "fn on_event(ev) { emit(\"glue.finished\", #{ score: get(\"score\") }); }"
    }]);
    let r = report(&m);
    assert_eq!(r["ok"], true, "{}", errors_text(&r));
    let mut s = play(&m, 3, true, 700.0);
    let res = s.result();
    assert!(res["score"].as_i64().unwrap() > 0);
    assert!(res["warnings"].to_string().contains("glue 'spin' disabled"), "{}", res["warnings"]);
    let events = s.drain_events();
    assert!(events.to_string().contains("glue.finished"), "other glue keeps running");
}

#[test]
fn glue_cannot_emit_core_events() {
    let mut m = manifest();
    m["glue"] = json!([{
        "id": "evil",
        "on": ["round.started"],
        "script": "fn on_event(ev) { emit(\"game.over\", #{}); set(\"round\", 99); }"
    }]);
    let s = play(&m, 3, true, 700.0);
    assert_eq!(s.result()["stats"]["correct"], 8);
    assert!(s.warnings().iter().any(|w| w.contains("may only emit")));
}

#[test]
fn catalog_is_consistent() {
    let cat: Vec<Value> = serde_json::from_str(&sg_runtime::catalog()).unwrap();
    assert!(cat.len() >= 150, "catalog has {} concepts", cat.len());
    let implemented = cat.iter().filter(|c| c["status"] == "implemented").count();
    assert_eq!(implemented, cat.len(), "every catalog concept has a runtime system");
    let kinds: std::collections::BTreeSet<&str> = cat.iter().map(|c| c["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds.len(), 14);
    for c in &cat {
        let id = c["id"].as_str().unwrap();
        assert!(id.starts_with(&format!("{}.", c["kind"].as_str().unwrap())), "{id}");
    }
}

#[test]
fn bad_input_json_is_an_error_not_a_panic() {
    let mut s = Session::new(MANIFEST, CONTENT, 1).unwrap();
    assert!(s.input("not json").is_err());
    let r: Value = serde_json::from_str(&sg_runtime::replay(MANIFEST, CONTENT, 1, "oops")).unwrap();
    assert_eq!(r["ok"], false);
}

fn bare_glue(script: &str, on: &[&str]) -> Value {
    let mut m = manifest();
    m["glue"] = json!([{ "id": "bare", "on": on, "script": script }]);
    m
}

#[test]
fn glue_bare_variables_read_and_write() {
    let mut without = manifest();
    without["glue"] = json!([]);
    let plain = play(&without, 5, true, 700.0).score();

    let script = "fn bonus(n) { n * 2 }\nfn on_event(ev) {\n  // bare vars\n  let streak = 0;\n  score += 10;\n  banner = \"nice \\\"one\\\" {\";\n  multiplier = multiplier + 1;\n  let combo = get(\"combo\"); if combo == () { combo = 0; }\n  set(\"combo\", combo + bonus(1));\n}";
    let m = bare_glue(script, &["answer.correct"]);
    let r = report(&m);
    assert_eq!(r["ok"], true, "{}", errors_text(&r));

    let a = play(&m, 5, true, 700.0);
    let b = play(&m, 5, true, 700.0);
    assert_eq!(a.score(), b.score(), "deterministic");
    assert!(a.score() >= plain + 80, "score += 10 per correct answer: {} vs {} {:?}", a.score(), plain, a.warnings());
    assert_eq!(a.result()["stats"]["best_streak"], 8, "shadowing `let streak` must not write back");
    assert!(a.warnings().is_empty(), "{:?}", a.warnings());
}

#[test]
fn glue_bare_custom_variable_persists_between_events() {
    let mut m = manifest();
    m["glue"] = json!([{
        "id": "setter",
        "on": ["round.started"],
        "script": "fn on_event(ev) { set(\"n\", 5); }"
    }, {
        "id": "reader",
        "on": ["answer.correct"],
        "script": "fn on_event(ev) { if is_def_var(\"n\") { n += 1; set(\"m\", n); score += n; } }"
    }]);
    let r = report(&m);
    assert_eq!(r["ok"], true, "{}", errors_text(&r));
    let mut without = manifest();
    without["glue"] = json!([]);
    let plain = play(&without, 5, true, 700.0).score();
    let s = play(&m, 5, true, 700.0);
    assert!(s.warnings().is_empty(), "{:?}", s.warnings());
    assert!(s.score() >= plain + 8 * 6, "n is 6 on every answer: {} vs {}", s.score(), plain);
}

#[test]
fn glue_bare_write_to_read_only_var_warns() {
    let m = bare_glue("fn on_event(ev) { round = 99; }", &["round.started"]);
    let s = play(&m, 3, true, 700.0);
    assert_eq!(s.result()["stats"]["correct"], 8);
    assert!(s.warnings().iter().any(|w| w.contains("read-only var 'round'")), "{:?}", s.warnings());
}

#[test]
fn glue_bare_failure_is_caught_by_dry_run() {
    let m = bare_glue("fn on_event(ev) { banner = nope + 1; }", &["round.started"]);
    let r = report(&m);
    assert_eq!(r["ok"], false);
    assert!(errors_text(&r).contains("nope"), "{}", errors_text(&r));
}

#[test]
fn glue_infinite_loop_with_bare_vars_is_stopped() {
    let m = bare_glue("fn on_event(ev) { while score >= 0 { score += 1; } }", &["round.started"]);
    let r = report(&m);
    assert_eq!(r["ok"], false, "dry-run catches the runaway loop");
}
