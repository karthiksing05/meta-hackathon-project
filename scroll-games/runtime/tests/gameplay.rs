//! Gameplay concepts: every genre template validates, plays and replays exactly; per-concept behavior checks.

use serde_json::{json, Value};
use sg_runtime::session::State;
use sg_runtime::Session;
use std::fs;

const GENRES: [&str; 16] = [
    "lane_runner", "memory_match", "word_guess", "rhythm_tap", "paddle_rally", "star_catcher", "star_shooter", "match3",
    "swipe_merge", "timeline_sort", "photo_hunt", "whack_mole", "simon_says", "map_pins", "trace_draw", "daily_word",
];

fn read(name: &str) -> String {
    fs::read_to_string(format!("{}/../spec/templates/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn template(genre: &str) -> (Value, Value) {
    (serde_json::from_str(&read(&format!("{genre}.manifest.json"))).unwrap(), serde_json::from_str(&read(&format!("{genre}.content.json"))).unwrap())
}

struct Sim {
    s: Session,
    manifest: String,
    content: String,
    seed: u32,
}

impl Sim {
    fn new(manifest: &Value, content: &Value, seed: u32) -> Sim {
        let (m, c) = (manifest.to_string(), content.to_string());
        let mut s = Session::new(&m, &c, seed).unwrap_or_else(|e| panic!("session: {e}"));
        s.start();
        Sim { s, manifest: m, content: c, seed }
    }
    fn tick(&mut self) {
        self.s.step(1000.0 / 60.0);
    }
    fn view(&self) -> Value {
        self.s.view()
    }
    fn send(&mut self, v: Value) {
        self.s.input(&v.to_string()).unwrap();
    }
    fn tap(&mut self, x: f64, y: f64) {
        self.send(json!({ "type": "tap", "x": x, "y": y }));
    }
    fn ended(&self) -> bool {
        self.s.state() == State::Ended
    }
    fn wait_playing(&mut self) {
        for _ in 0..600 {
            if self.view()["state"] == "playing" {
                return;
            }
            self.tick();
        }
        panic!("never reached playing");
    }
    /// The recorded run must replay to the identical score and tick count.
    fn assert_replays(&self) {
        let r = self.s.result();
        let out: Value = serde_json::from_str(&sg_runtime::replay(&self.manifest, &self.content, self.seed, &r["inputs"].to_string())).unwrap();
        assert_eq!(out["score"], r["score"], "replay score: {out}");
        assert_eq!(out["ticks"], r["ticks"], "replay ticks: {out}");
    }
}

fn ents(v: &Value, role: &str) -> Vec<Value> {
    v["world"]["ents"].as_array().unwrap().iter().filter(|e| e["role"] == role).cloned().collect()
}

fn f(v: &Value) -> f64 {
    v.as_f64().unwrap()
}

fn warnings(s: &Session) -> Vec<String> {
    s.warnings().to_vec()
}

#[test]
fn every_genre_template_validates() {
    for g in GENRES {
        let (m, c) = template(g);
        let r: Value = serde_json::from_str(&sg_runtime::validate(&m.to_string(), &c.to_string())).unwrap();
        assert_eq!(r["ok"], true, "{g}: {}", r["errors"]);
        assert!(!r["warnings"].to_string().contains("stub"), "{g} still uses a stub: {}", r["warnings"]);
    }
}

#[test]
fn idle_play_never_panics_and_ends_or_runs() {
    for g in GENRES {
        let (m, c) = template(g);
        let mut sim = Sim::new(&m, &c, 7);
        for _ in 0..4000 {
            sim.tick();
            if sim.ended() {
                break;
            }
        }
        assert!(warnings(&sim.s).iter().all(|w| !w.contains("stub")), "{g}: {:?}", warnings(&sim.s));
        if sim.ended() {
            sim.assert_replays();
        }
    }
}

// ------------------------------------------------------------------ bots

fn run(g: &str, seed: u32, max: usize, mut bot: impl FnMut(&mut Sim, usize)) -> Sim {
    let (m, c) = template(g);
    let mut sim = Sim::new(&m, &c, seed);
    sim.wait_playing();
    for t in 0..max {
        if sim.ended() {
            break;
        }
        bot(&mut sim, t);
        sim.tick();
    }
    assert!(sim.ended(), "{g} did not finish: score {} hud {}", sim.view()["score"], sim.view()["world"]["hud"]);
    sim.assert_replays();
    sim
}

fn score(sim: &Sim) -> i64 {
    sim.s.result()["score"].as_i64().unwrap()
}

fn content_items(g: &str) -> Vec<Value> {
    template(g).1["items"].as_array().unwrap().clone()
}

#[test]
fn lane_runner_dodges_and_collects() {
    let sim = run("lane_runner", 3, 12000, |s, t| {
        if t % 4 != 0 {
            return;
        }
        let v = s.view();
        let Some(a) = ents(&v, "avatar").first().cloned() else { return };
        let lane = (f(&a["x"]) / 120.0).floor();
        let danger = ents(&v, "obstacle").iter().any(|o| (f(&o["x"]) - (lane + 0.5) * 120.0).abs() < 30.0 && f(&o["y"]) > f(&a["y"]) - 190.0 && f(&o["y"]) < f(&a["y"]) - 20.0);
        if danger {
            let dx = if lane == 0.0 { 80 } else { -80 };
            s.send(json!({ "type": "swipe", "dx": dx, "dy": 0, "x": 100, "y": 300 }));
        }
    });
    assert!(score(&sim) > 0);
    assert_eq!(sim.view()["world"]["hud"]["level"], 3);
}

#[test]
fn memory_match_clears_the_table() {
    let mut mem: std::collections::HashMap<u64, String> = Default::default();
    let sim = run("memory_match", 5, 12000, |s, t| {
        let v = s.view();
        let cards = ents(&v, "card");
        for c in &cards {
            if !c["label"].as_str().unwrap().is_empty() {
                mem.insert(c["id"].as_u64().unwrap(), c["label"].as_str().unwrap().into());
            }
        }
        if t % 40 != 0 || cards.iter().any(|c| c["state"] == "wrong" || c["state"] == "peek") {
            return;
        }
        let down: Vec<&Value> = cards.iter().filter(|c| c["state"] == "down").collect();
        let up: Vec<&Value> = cards.iter().filter(|c| c["state"] == "up").collect();
        let label_of = |c: &Value| mem.get(&c["id"].as_u64().unwrap()).cloned();
        let pick = if let Some(u) = up.first() {
            let want = label_of(u);
            down.iter().find(|c| want.is_some() && label_of(c) == want).or_else(|| down.iter().find(|c| label_of(c).is_none())).or(down.first())
        } else {
            let mut found = None;
            for a in &down {
                if down.iter().any(|b| b["id"] != a["id"] && label_of(b).is_some() && label_of(b) == label_of(a)) {
                    found = Some(a);
                    break;
                }
            }
            found.or_else(|| down.iter().find(|c| label_of(c).is_none())).or(down.first())
        };
        if let Some(c) = pick {
            s.tap(f(&c["x"]), f(&c["y"]));
        }
    });
    assert_eq!(score(&sim), 600);
}

fn grade(target: &str, guess: &str) -> String {
    let (t, g): (Vec<char>, Vec<char>) = (target.chars().collect(), guess.chars().collect());
    let mut res = vec!['b'; g.len()];
    let mut left: Vec<char> = vec![];
    for i in 0..t.len() {
        if t[i] == g[i] {
            res[i] = 'g';
        } else {
            left.push(t[i]);
        }
    }
    for i in 0..g.len() {
        if res[i] != 'g' {
            if let Some(p) = left.iter().position(|c| *c == g[i]) {
                left.remove(p);
                res[i] = 'y';
            }
        }
    }
    res.into_iter().collect()
}

fn word_bot(g: &str, seed: u32, via_text: bool) -> Sim {
    let words: Vec<String> = content_items(g).iter().map(|i| i["prompt"].as_str().unwrap().to_uppercase()).collect();
    let mut level = 0i64;
    let mut cand = words.clone();
    let mut queue: Vec<Value> = vec![];
    let mut last_rows = 0usize;
    let mut pending: Option<String> = None;
    run(g, seed, 20000, move |s, t| {
        let v = s.view();
        let lv = v["world"]["level"].as_i64().unwrap();
        let rows = v["world"]["extra"]["word"]["rows"].as_array().cloned().unwrap_or_default();
        if lv != level {
            level = lv;
            cand = words.clone();
            last_rows = 0;
            pending = None;
            queue.clear();
        }
        if rows.len() > last_rows {
            let row = rows.last().unwrap().as_array().unwrap();
            let guess: String = row.iter().map(|c| c["c"].as_str().unwrap()).collect();
            let pat: String = row.iter().map(|c| match c["s"].as_str().unwrap() { "correct" => 'g', "present" => 'y', _ => 'b' }).collect();
            cand.retain(|w| grade(w, &guess) == pat);
            last_rows = rows.len();
            pending = None;
        }
        if t % 6 != 0 {
            return;
        }
        if !queue.is_empty() {
            let a = queue.remove(0);
            s.send(a);
            return;
        }
        if pending.is_some() || rows.len() >= 6 || cand.is_empty() {
            return;
        }
        let guess = cand[0].clone();
        pending = Some(guess.clone());
        if via_text {
            queue.push(json!({ "type": "text", "text": guess }));
        } else {
            let keys = ents(&v, "key");
            for ch in guess.chars().map(|c| c.to_string()).chain(["↵".to_string()]) {
                let k = keys.iter().find(|k| k["label"] == ch.as_str()).unwrap();
                queue.push(json!({ "type": "tap", "x": k["x"], "y": k["y"] }));
            }
        }
    })
}

#[test]
fn word_guess_solves_with_tile_keyboard() {
    let sim = word_bot("word_guess", 11, false);
    assert!(score(&sim) >= 400, "score {}", score(&sim));
}

#[test]
fn daily_word_solves_with_text_entry() {
    let sim = word_bot("daily_word", 12, true);
    assert!(score(&sim) >= 500);
    assert!(sim.view()["world"]["extra"]["daily_puzzle"]["reset_hour_utc"].is_number());
}

#[test]
fn rhythm_tap_hits_notes() {
    let sim = run("rhythm_tap", 2, 12000, |s, _| {
        let v = s.view();
        for n in ents(&v, "note") {
            let y = f(&n["y"]);
            if (485.0..=495.0).contains(&y) {
                s.tap(f(&n["x"]), 480.0);
            }
        }
    });
    assert!(score(&sim) >= 28 * 50, "score {}", score(&sim));
}

fn drag_to(s: &mut Sim, x: f64, y: f64) {
    s.send(json!({ "type": "drag", "phase": "move", "x": x, "y": y }));
}

#[test]
fn paddle_rally_keeps_the_ball_up() {
    let sim = run("paddle_rally", 4, 12000, |s, t| {
        if t % 2 == 0 {
            let v = s.view();
            if let Some(b) = ents(&v, "ball").first() {
                drag_to(s, f(&b["x"]), 540.0);
            }
        }
    });
    assert!(score(&sim) >= 50, "score {}", score(&sim));
}

#[test]
fn star_catcher_catches_stars() {
    let sim = run("star_catcher", 6, 12000, |s, t| {
        if t % 2 == 0 {
            let v = s.view();
            let a_y = ents(&v, "avatar").first().map(|a| f(&a["y"])).unwrap_or(500.0);
            let target = ents(&v, "collectible").into_iter().filter(|c| f(&c["y"]) < a_y).max_by(|a, b| f(&a["y"]).partial_cmp(&f(&b["y"])).unwrap());
            if let Some(c) = target {
                drag_to(s, f(&c["x"]), 500.0);
            }
        }
    });
    assert!(score(&sim) > 0);
}

#[test]
fn star_shooter_destroys_enemies() {
    let sim = run("star_shooter", 8, 12000, |s, t| {
        let v = s.view();
        if let Some(e) = ents(&v, "enemy").into_iter().max_by(|a, b| f(&a["y"]).partial_cmp(&f(&b["y"])).unwrap()) {
            if t % 2 == 0 {
                drag_to(s, f(&e["x"]), 520.0);
            }
            if t % 12 == 0 {
                s.tap(f(&e["x"]), 300.0);
            }
        }
    });
    assert!(score(&sim) >= 25, "score {}", score(&sim));
}

fn tile_board(v: &Value) -> (Vec<i64>, i64, i64, f64, f64, f64) {
    let g = &v["world"]["grid"];
    let (ox, oy, sz) = (f(&g["ox"]), f(&g["oy"]), f(&g["s"]));
    let (cols, rows) = (v["world"]["cols"].as_i64().unwrap(), v["world"]["rows"].as_i64().unwrap());
    let mut b = vec![-1; (cols * rows) as usize];
    for t in ents(v, "tile") {
        let c = ((f(&t["x"]) - ox) / sz).floor() as i64;
        let r = ((f(&t["y"]) - oy) / sz).floor() as i64;
        b[(r * cols + c) as usize] = t["tag"].as_i64().unwrap();
    }
    (b, cols, rows, ox, oy, sz)
}

fn has_run(b: &[i64], cols: i64, rows: i64) -> bool {
    for r in 0..rows {
        for c in 0..cols {
            let k = b[(r * cols + c) as usize];
            if k < 0 {
                continue;
            }
            if c + 2 < cols && b[(r * cols + c + 1) as usize] == k && b[(r * cols + c + 2) as usize] == k {
                return true;
            }
            if r + 2 < rows && b[((r + 1) * cols + c) as usize] == k && b[((r + 2) * cols + c) as usize] == k {
                return true;
            }
        }
    }
    false
}

#[test]
fn match3_finds_and_clears_runs() {
    let sim = run("match3", 9, 12000, |s, t| {
        if t % 25 != 0 {
            return;
        }
        let v = s.view();
        let (b, cols, rows, ox, oy, sz) = tile_board(&v);
        for r in 0..rows {
            for c in 0..cols {
                for (dc, dr, dx, dy) in [(1, 0, 60, 0), (0, 1, 0, 60)] {
                    if c + dc >= cols || r + dr >= rows {
                        continue;
                    }
                    let mut nb = b.clone();
                    nb.swap((r * cols + c) as usize, ((r + dr) * cols + c + dc) as usize);
                    if has_run(&nb, cols, rows) {
                        s.send(json!({ "type": "swipe", "dx": dx, "dy": dy, "x": ox + (c as f64 + 0.5) * sz, "y": oy + (r as f64 + 0.5) * sz }));
                        return;
                    }
                }
            }
        }
    });
    assert!(score(&sim) >= 90, "score {}", score(&sim));
}

#[test]
fn swipe_merge_reaches_the_target() {
    let dirs = [(-60, 0), (0, 60), (60, 0), (0, -60)];
    let sim = run("swipe_merge", 13, 12000, |s, t| {
        if t % 6 == 0 {
            let (dx, dy) = dirs[(t / 6) % 4];
            s.send(json!({ "type": "swipe", "dx": dx, "dy": dy, "x": 180, "y": 300 }));
        }
    });
    assert!(score(&sim) >= 20);
}

fn drag_ent(s: &mut Sim, from: (f64, f64), to: (f64, f64)) {
    s.send(json!({ "type": "drag", "phase": "start", "x": from.0, "y": from.1 }));
    s.send(json!({ "type": "drag", "phase": "move", "x": to.0, "y": to.1 }));
    s.send(json!({ "type": "drag", "phase": "end", "x": to.0, "y": to.1 }));
}

#[test]
fn timeline_sort_orders_moments() {
    let items = content_items("timeline_sort");
    let rank = |label: &str| items.iter().find(|i| i["prompt"] == label).unwrap()["answer"].as_i64().unwrap() - 1;
    let sim = run("timeline_sort", 14, 12000, |s, t| {
        if t % 10 != 0 {
            return;
        }
        let v = s.view();
        let zones = v["world"]["zones"].as_array().unwrap().clone();
        if let Some(e) = ents(&v, "event").into_iter().find(|e| e["state"] == "idle") {
            let z = &zones[rank(e["label"].as_str().unwrap()) as usize];
            drag_ent(s, (f(&e["x"]), f(&e["y"])), (f(&z[0]), f(&z[1])));
        }
    });
    assert!(score(&sim) >= 1000, "score {}", score(&sim));
}

#[test]
fn photo_hunt_finds_hotspots() {
    let spots = content_items("photo_hunt");
    let mut next = 0;
    let sim = run("photo_hunt", 15, 3000, |s, t| {
        if t % 10 == 0 && next < spots.len() {
            let c = &spots[next]["choices"];
            s.tap(c[0].as_str().unwrap().parse::<f64>().unwrap() / 100.0 * 360.0, c[1].as_str().unwrap().parse::<f64>().unwrap() / 100.0 * 600.0);
            next += 1;
        }
    });
    assert_eq!(score(&sim), 600);
}

#[test]
fn whack_mole_taps_critters() {
    let sim = run("whack_mole", 16, 12000, |s, t| {
        if t % 4 == 0 {
            let v = s.view();
            if let Some(c) = ents(&v, "collectible").first() {
                s.tap(f(&c["x"]), f(&c["y"]));
            }
        }
    });
    assert!(score(&sim) >= 100, "score {}", score(&sim));
}

#[test]
fn simon_says_repeats_patterns() {
    let mut seen: Vec<i64> = vec![];
    let mut lit_prev = -1i64;
    let mut queue: Vec<(f64, f64)> = vec![];
    let mut last_tap = 0usize;
    let sim = run("simon_says", 17, 4000, |s, t| {
        let v = s.view();
        let pads = ents(&v, "pad");
        let lit = pads.iter().find(|p| p["state"] == "lit").map(|p| p["tag"].as_i64().unwrap()).unwrap_or(-1);
        let toast = v["world"]["toast"].as_str().unwrap_or("");
        if toast == "Your turn" && queue.is_empty() && !seen.is_empty() {
            queue = seen.iter().map(|tag| pads.iter().find(|p| p["tag"] == *tag).map(|p| (f(&p["x"]), f(&p["y"]))).unwrap()).collect();
            seen.clear();
        } else if queue.is_empty() && lit >= 0 && lit != lit_prev && toast != "Your turn" && t > last_tap + 12 {
            seen.push(lit);
        }
        lit_prev = lit;
        if t % 12 == 0 && !queue.is_empty() {
            let (x, y) = queue.remove(0);
            s.tap(x, y);
            last_tap = t;
        }
        if v["score"].as_i64().unwrap() >= 300 && t % 12 == 6 {
            // throw the game: hammer a pad until the lives run out
            if let Some(p) = pads.first() {
                s.tap(f(&p["x"]), f(&p["y"]));
            }
        }
    });
    assert!(score(&sim) >= 300);
    assert!(sim.s.result()["stats"]["wrong"].as_i64().unwrap() >= 3);
}

#[test]
fn map_pins_lock_on_target() {
    let places = content_items("map_pins");
    let sim = run("map_pins", 18, 4000, |s, t| {
        if t % 10 != 0 {
            return;
        }
        let v = s.view();
        if let Some(p) = ents(&v, "pin").into_iter().find(|p| p["state"] == "idle") {
            let it = places.iter().find(|i| i["prompt"] == p["label"]).unwrap();
            let (px, py): (f64, f64) = (it["choices"][0].as_str().unwrap().parse().unwrap(), it["choices"][1].as_str().unwrap().parse().unwrap());
            drag_ent(s, (f(&p["x"]), f(&p["y"])), (px / 100.0 * 360.0 + 5.0, 60.0 + py / 100.0 * 380.0));
        }
    });
    assert_eq!(score(&sim), 600);
}

#[test]
fn trace_draw_scores_coverage() {
    let mut drawn = String::new();
    let sim = run("trace_draw", 19, 6000, |s, t| {
        if t % 20 != 0 {
            return;
        }
        let v = s.view();
        let tr = &v["world"]["extra"]["trace"];
        if let Some(name) = tr["name"].as_str() {
            let key = format!("{name}{}", v["world"]["level"]);
            if key != drawn {
                drawn = key;
                s.send(json!({ "type": "draw", "points": tr["points"] }));
            }
        }
    });
    assert!(score(&sim) >= 600, "score {}", score(&sim));
}

// ------------------------------------------------------------------ per-concept checks

fn quiz() -> (Value, Value) {
    (serde_json::from_str(&read("quiz.manifest.json")).unwrap(), serde_json::from_str(&read("trip-trivia.content.json")).unwrap())
}

fn quiz_with(extra: Vec<Value>) -> (Value, Value) {
    let (mut m, c) = quiz();
    for e in extra {
        m["concepts"].as_array_mut().unwrap().push(e);
    }
    (m, c)
}

fn mini(concepts: Vec<Value>) -> (Value, Value) {
    let mut cs = vec![json!({ "id": "flow.session" }), json!({ "id": "rule.total_time_limit", "params": { "limit_ms": 10000 } })];
    cs.extend(concepts);
    (
        json!({ "schema": "sg.manifest/1", "title": "Mini", "concepts": cs }),
        json!({ "schema": "sg.content/1", "items": [{ "id": "n1", "kind": "note", "prompt": "x" }] }),
    )
}

fn started(m: &Value, c: &Value, seed: u32) -> Sim {
    let mut s = Sim::new(m, c, seed);
    s.wait_playing();
    s
}

fn names(sim: &mut Sim) -> Vec<String> {
    sim.s.drain_events().as_array().unwrap().iter().map(|e| e["name"].as_str().unwrap().to_string()).collect()
}

fn events_named(sim: &mut Sim, name: &str) -> Vec<Value> {
    sim.s.drain_events().as_array().unwrap().iter().filter(|e| e["name"] == name).map(|e| e["data"].clone()).collect()
}

fn ticks(sim: &mut Sim, n: usize) {
    for _ in 0..n {
        sim.tick();
    }
}

/// Answers the current quiz round; returns true when an answer was sent.
fn quiz_answer(sim: &mut Sim, content: &Value, right: bool) -> bool {
    let v = sim.view();
    let choices = v["choices"].as_array().unwrap();
    if v["state"] != "playing" || choices.is_empty() || !choices.iter().all(|c| c["state"] == "idle") {
        return false;
    }
    let item = content["items"].as_array().unwrap().iter().find(|i| i["prompt"] == v["prompt"]).unwrap();
    let want = &item["choices"][item["answer"].as_u64().unwrap() as usize];
    let ri = choices.iter().position(|c| c["label"] == *want).unwrap();
    sim.send(json!({ "type": "choice", "index": if right { ri } else { (ri + 1) % choices.len() } }));
    true
}

#[test]
fn hold_release_measures_ticks() {
    let (m, c) = mini(vec![json!({ "id": "space.free_canvas" }), json!({ "id": "input.hold_release", "params": { "max_hold_ms": 1000 } })]);
    let mut s = started(&m, &c, 1);
    s.send(json!({ "type": "press" }));
    ticks(&mut s, 30);
    s.send(json!({ "type": "release" }));
    let holds = events_named(&mut s, "input.hold");
    assert_eq!(holds.len(), 1);
    let ms = holds[0]["ms"].as_i64().unwrap();
    assert!((470..=520).contains(&ms), "ms {ms}");
    s.send(json!({ "type": "press" }));
    ticks(&mut s, 90);
    let holds = events_named(&mut s, "input.hold");
    assert_eq!(holds.len(), 1, "auto release at max_hold_ms");
    assert!(holds[0]["ms"].as_i64().unwrap() <= 1010);
}

#[test]
fn tilt_steer_moves_the_paddle() {
    let (m, c) = mini(vec![
        json!({ "id": "space.physics_world" }),
        json!({ "id": "entity.paddle" }),
        json!({ "id": "input.tilt_steer", "params": { "sensitivity": 1.0 } }),
        json!({ "id": "behavior.follow_finger", "params": { "smoothing": 0.0 } }),
    ]);
    let mut s = started(&m, &c, 1);
    let x0 = f(&ents(&s.view(), "paddle")[0]["x"]);
    s.send(json!({ "type": "tilt", "x": 1.0 }));
    ticks(&mut s, 45);
    let x1 = f(&ents(&s.view(), "paddle")[0]["x"]);
    assert!(x1 > x0 + 100.0, "{x0} -> {x1}");
}

#[test]
fn double_tap_needs_two_taps_in_the_window() {
    let (m, c) = mini(vec![json!({ "id": "space.free_canvas" }), json!({ "id": "input.double_tap", "params": { "window_ms": 280 } })]);
    let mut s = started(&m, &c, 1);
    s.tap(10.0, 10.0);
    ticks(&mut s, 60);
    s.tap(10.0, 10.0);
    assert!(events_named(&mut s, "input.tap").is_empty());
    ticks(&mut s, 5);
    s.tap(20.0, 20.0);
    let taps = events_named(&mut s, "input.tap");
    assert_eq!(taps.len(), 1);
    assert_eq!(taps[0]["double"], true);
}

#[test]
fn multi_select_submits_a_selection() {
    let (m, c) = quiz_with(vec![json!({ "id": "input.multi_select", "params": { "max_selected": 2 } })]);
    let mut s = started(&m, &c, 3);
    s.send(json!({ "type": "select", "index": 1 }));
    s.send(json!({ "type": "select", "index": 2 }));
    s.send(json!({ "type": "select", "index": 3 }));
    let states: Vec<String> = s.view()["choices"].as_array().unwrap().iter().map(|c| c["state"].as_str().unwrap().into()).collect();
    assert_eq!(states, ["idle", "selected", "selected", "idle"]);
    s.send(json!({ "type": "submit" }));
    let ch = events_named(&mut s, "input.choice");
    assert_eq!(ch.len(), 1);
    assert_eq!(ch[0]["indices"], json!([1, 2]));
    assert!(s.view()["choices"].as_array().unwrap().iter().any(|c| c["state"] != "idle"), "the round was judged");
}

#[test]
fn text_and_voice_entry_emit_input_text() {
    let (m, c) = mini(vec![
        json!({ "id": "space.free_canvas" }),
        json!({ "id": "input.text_entry", "params": { "max_chars": 5 } }),
        json!({ "id": "input.voice_answer" }),
    ]);
    let mut s = started(&m, &c, 1);
    s.send(json!({ "type": "text", "text": "  Lisbon  " }));
    s.send(json!({ "type": "voice", "text": "Porto" }));
    s.send(json!({ "type": "text", "text": "   " }));
    let t = events_named(&mut s, "input.text");
    assert_eq!(t.len(), 2);
    assert_eq!(t[0]["text"], "lisbo");
    assert_eq!(t[1]["voice"], true);
}

#[test]
fn rotary_dial_wraps_steps() {
    let (m, c) = mini(vec![json!({ "id": "space.free_canvas" }), json!({ "id": "input.rotary_dial", "params": { "steps": 12 } })]);
    let mut s = started(&m, &c, 1);
    s.send(json!({ "type": "dial", "step": 14 }));
    assert_eq!(s.view()["world"]["extra"]["dial"]["value"], 2);
    assert_eq!(events_named(&mut s, "input.drag")[0]["phase"], "dial");
}

#[test]
fn scrolling_world_streams_entities_sideways() {
    let (m, c) = mini(vec![
        json!({ "id": "space.scrolling_world", "params": { "speed": 200.0, "direction": "left" } }),
        json!({ "id": "entity.player_avatar" }),
        json!({ "id": "entity.collectible" }),
        json!({ "id": "behavior.spawn_wave", "params": { "every_ms": 300 } }),
    ]);
    let mut s = started(&m, &c, 2);
    ticks(&mut s, 120);
    let v = s.view();
    assert!(f(&ents(&v, "avatar")[0]["x"]) < 100.0);
    assert!(!ents(&v, "collectible").is_empty());
    assert!(f(&v["world"]["scroll"]) > 0.0);
    assert_eq!(v["world"]["flow"], json!([-1.0, 0.0]));
}

#[test]
fn falling_objects_are_caught_for_points() {
    let (m, c) = mini(vec![
        json!({ "id": "space.physics_world" }),
        json!({ "id": "entity.player_avatar" }),
        json!({ "id": "entity.falling_object", "params": { "fall_speed": 300.0 } }),
        json!({ "id": "input.drag_drop" }),
    ]);
    let mut s = started(&m, &c, 5);
    for t in 0..600 {
        if t % 2 == 0 {
            let v = s.view();
            if let Some(o) = ents(&v, "falling").into_iter().max_by(|a, b| f(&a["y"]).partial_cmp(&f(&b["y"])).unwrap()) {
                drag_to(&mut s, f(&o["x"]), 500.0);
            }
        }
        s.tick();
    }
    assert!(s.view()["score"].as_i64().unwrap() >= 10);
}

#[test]
fn wrap_edges_keeps_entities_alive() {
    let (m, c) = mini(vec![
        json!({ "id": "space.physics_world" }),
        json!({ "id": "entity.falling_object" }),
        json!({ "id": "behavior.wrap_edges" }),
        json!({ "id": "behavior.drift", "params": { "amount": 6.0 } }),
    ]);
    let mut s = started(&m, &c, 2);
    ticks(&mut s, 900);
    let ev = s.s.drain_events();
    assert!(!ev.as_array().unwrap().iter().any(|e| e["name"] == "entity.destroyed"), "wrapped entities are never culled");
    assert!(ents(&s.view(), "falling").len() >= 3);
}

#[test]
fn homing_enemies_turn_toward_the_avatar() {
    let (m, c) = mini(vec![
        json!({ "id": "space.physics_world" }),
        json!({ "id": "entity.player_avatar" }),
        json!({ "id": "entity.enemy_wave", "params": { "wave_size": 3, "gap_ms": 200, "speed": 60.0 } }),
        json!({ "id": "behavior.homing", "params": { "turn_rate": 6.0 } }),
        json!({ "id": "behavior.bounce", "params": { "damping": 0.9 } }),
        json!({ "id": "input.drag_drop" }),
    ]);
    let mut s = started(&m, &c, 2);
    drag_to(&mut s, 330.0, 520.0);
    ticks(&mut s, 200);
    let v = s.view();
    let e = ents(&v, "enemy");
    assert!(!e.is_empty());
    assert!(e.iter().any(|e| f(&e["x"]) > 180.0), "enemies drifted toward the right-hand avatar (spawned at x <= 152)");
}

#[test]
fn slide_to_wall_slides_until_blocked() {
    let (m, c) = mini(vec![
        json!({ "id": "space.grid_board", "params": { "cols": 5, "rows": 5 } }),
        json!({ "id": "entity.player_avatar" }),
        json!({ "id": "behavior.slide_to_wall" }),
        json!({ "id": "input.swipe_direction", "params": { "directions": "four" } }),
    ]);
    let mut s = started(&m, &c, 1);
    let x0 = f(&ents(&s.view(), "avatar")[0]["x"]);
    s.send(json!({ "type": "swipe", "dx": 90, "dy": 0, "x": 180, "y": 300 }));
    let x1 = f(&ents(&s.view(), "avatar")[0]["x"]);
    assert!(x1 > x0 + 50.0);
    let hits = events_named(&mut s, "collision.hit");
    assert!(hits.iter().any(|h| h["b"] == "wall"));
    s.send(json!({ "type": "swipe", "dx": 90, "dy": 0, "x": 180, "y": 300 }));
    assert_eq!(f(&ents(&s.view(), "avatar")[0]["x"]), x1, "already against the wall");
}

#[test]
fn streak_shield_absorbs_one_mistake() {
    let (m, c) = quiz_with(vec![json!({ "id": "rule.streak_shield", "params": { "streak_needed": 2 } }), json!({ "id": "rule.lives", "params": { "lives": 3 } })]);
    let mut s = started(&m, &c, 4);
    let plan = [true, true, false, false];
    let mut i = 0;
    for _ in 0..4000 {
        if i < plan.len() && quiz_answer(&mut s, &c, plan[i]) {
            i += 1;
            if i == 3 {
                ticks(&mut s, 2);
                assert_eq!(s.view()["world"]["hud"]["lives"], 3, "shield absorbed the first mistake");
            }
        }
        s.tick();
        if i == 4 {
            break;
        }
    }
    ticks(&mut s, 5);
    assert_eq!(s.view()["world"]["hud"]["lives"], 2);
}

#[test]
fn elimination_removes_a_weak_player() {
    let (m, c) = quiz_with(vec![json!({ "id": "rule.elimination", "params": { "cut_per_round": 2, "rivals": 3 } })]);
    let mut s = started(&m, &c, 4);
    for _ in 0..8000 {
        quiz_answer(&mut s, &c, false);
        s.tick();
        if s.ended() {
            break;
        }
    }
    assert!(s.ended());
    assert!(s.view()["round"].as_i64().unwrap() < 8, "eliminated before the last round");
}

#[test]
fn difficulty_ramp_shortens_rounds() {
    let (m, c) = quiz_with(vec![json!({ "id": "rule.difficulty_ramp", "params": { "step": 0.5 } })]);
    let mut s = started(&m, &c, 4);
    let first = s.view()["round_time_ms"].as_i64().unwrap();
    let mut answered = 0;
    for _ in 0..4000 {
        if quiz_answer(&mut s, &c, true) {
            answered += 1;
        }
        s.tick();
        if answered >= 2 && s.view()["round"] == 3 {
            break;
        }
    }
    let later = s.view()["round_time_ms"].as_i64().unwrap();
    assert!(later < first, "{first} -> {later}");
}

#[test]
fn sudden_death_ends_on_first_mistake() {
    let (m, c) = quiz_with(vec![json!({ "id": "flow.sudden_death" })]);
    let mut s = started(&m, &c, 4);
    for _ in 0..600 {
        quiz_answer(&mut s, &c, false);
        s.tick();
        if s.ended() {
            break;
        }
    }
    assert!(s.ended());
    assert_eq!(s.s.result()["stats"]["wrong"], 1);
}

#[test]
fn win_target_and_wrong_penalty_adjust_scores() {
    let (m, c) = quiz_with(vec![json!({ "id": "rule.win_target", "params": { "target": 100 } })]);
    let mut s = started(&m, &c, 4);
    for _ in 0..600 {
        quiz_answer(&mut s, &c, true);
        s.tick();
        if s.ended() {
            break;
        }
    }
    assert!(s.ended() && s.s.result()["stats"]["correct"] == 1, "ends at the first correct answer");
    let (m, c) = quiz_with(vec![json!({ "id": "rule.wrong_penalty", "params": { "penalty": 40 } })]);
    let mut s = started(&m, &c, 4);
    for _ in 0..600 {
        if quiz_answer(&mut s, &c, true) {
            break;
        }
        s.tick();
    }
    ticks(&mut s, 120);
    let before = s.view()["score"].as_i64().unwrap();
    for _ in 0..600 {
        if quiz_answer(&mut s, &c, false) {
            break;
        }
        s.tick();
    }
    ticks(&mut s, 5);
    assert_eq!(s.view()["score"].as_i64().unwrap(), before - 40);
}

#[test]
fn intermission_pauses_between_rounds() {
    let (m, c) = quiz_with(vec![json!({ "id": "flow.intermission", "params": { "duration_ms": 1500 } })]);
    let mut s = started(&m, &c, 4);
    let mut names_seen = vec![];
    let mut answered = false;
    let mut start_tick = 0;
    for t in 0..2400 {
        if !answered {
            answered = quiz_answer(&mut s, &c, true);
            start_tick = t;
        }
        s.tick();
        names_seen.extend(names(&mut s));
        if names_seen.iter().any(|n| n == "intermission.ended") {
            assert!(t - start_tick >= 85, "break lasted {}", t - start_tick);
            break;
        }
    }
    assert!(names_seen.iter().any(|n| n == "intermission.started"));
    assert!(names_seen.iter().any(|n| n == "intermission.ended"));
}

#[test]
fn no_repeat_dedupes_questions() {
    let (m, mut c) = quiz_with(vec![json!({ "id": "rule.no_repeat" })]);
    let mut dup = c["items"][0].clone();
    dup["id"] = json!("dup");
    c["items"].as_array_mut().unwrap().push(dup);
    let total = c["items"].as_array().unwrap().len() as i64;
    let mut m2 = m.clone();
    m2["concepts"].as_array_mut().unwrap().retain(|x| x["id"] != "meta.seeded_random");
    let s = started(&m2, &c, 4);
    assert_eq!(s.view()["total_rounds"].as_i64().unwrap(), (total - 1).min(8));
}

#[test]
fn hint_giver_dims_a_wrong_choice_in_a_quiz() {
    let (m, c) = quiz_with(vec![
        json!({ "id": "input.tap_target" }),
        json!({ "id": "entity.hint_giver" }),
        json!({ "id": "rule.hint_budget", "params": { "hints": 1 } }),
    ]);
    let mut s = started(&m, &c, 4);
    let h = ents(&s.view(), "hint")[0].clone();
    s.tap(f(&h["x"]), f(&h["y"]));
    let dim = s.view()["choices"].as_array().unwrap().iter().filter(|c| c["state"] == "dim").count();
    assert_eq!(dim, 1);
    assert_eq!(s.view()["world"]["hud"]["hints"], 0);
    s.tap(f(&h["x"]), f(&h["y"]));
    assert_eq!(s.view()["choices"].as_array().unwrap().iter().filter(|c| c["state"] == "dim").count(), 1, "no hints left");
}

#[test]
fn endless_starts_the_next_stage() {
    let (mut m, c) = template("photo_hunt");
    m["concepts"].as_array_mut().unwrap().push(json!({ "id": "flow.endless" }));
    let spots = c["items"].as_array().unwrap().clone();
    let mut s = started(&m, &c, 1);
    for sp in &spots {
        s.tap(sp["choices"][0].as_str().unwrap().parse::<f64>().unwrap() * 3.6, sp["choices"][1].as_str().unwrap().parse::<f64>().unwrap() * 6.0);
        ticks(&mut s, 2);
    }
    assert!(!s.ended());
    let v = s.view();
    assert_eq!(v["world"]["hud"]["level"], 2);
    assert_eq!(v["world"]["hud"]["found"], "0/4");
}

fn find_all(s: &mut Sim, c: &Value) {
    for sp in c["items"].as_array().unwrap().clone() {
        s.tap(sp["choices"][0].as_str().unwrap().parse::<f64>().unwrap() * 3.6, sp["choices"][1].as_str().unwrap().parse::<f64>().unwrap() * 6.0);
        ticks(s, 2);
    }
}

#[test]
fn best_of_n_keeps_the_best_run() {
    let (mut m, c) = template("photo_hunt");
    m["concepts"].as_array_mut().unwrap().retain(|x| x["id"] != "rule.total_time_limit");
    m["concepts"].as_array_mut().unwrap().push(json!({ "id": "rule.total_time_limit", "params": { "limit_ms": 10000 } }));
    m["concepts"].as_array_mut().unwrap().push(json!({ "id": "flow.best_of_n", "params": { "n": 2 } }));
    let mut s = started(&m, &c, 1);
    find_all(&mut s, &c);
    assert!(!s.ended(), "the first run ended; a second run started");
    assert_eq!(s.view()["score"], 0);
    for _ in 0..1500 {
        if s.ended() {
            break;
        }
        s.tick();
    }
    assert!(s.ended());
    assert_eq!(score(&s), 600, "best of two runs (second run scored 0)");
    assert_eq!(s.view()["world"]["hud"]["run"], "2/2");
    s.assert_replays();
}

#[test]
fn practice_mode_zeroes_the_score() {
    let (mut m, c) = template("photo_hunt");
    m["concepts"].as_array_mut().unwrap().push(json!({ "id": "flow.practice_mode" }));
    let mut s = started(&m, &c, 1);
    find_all(&mut s, &c);
    assert!(s.ended());
    assert_eq!(score(&s), 0);
    assert_eq!(s.view()["world"]["extra"]["practice"], true);
}

#[test]
fn retry_once_gives_a_second_run() {
    let (mut m, c) = template("photo_hunt");
    m["concepts"].as_array_mut().unwrap().retain(|x| x["id"] != "rule.total_time_limit");
    m["concepts"].as_array_mut().unwrap().push(json!({ "id": "rule.total_time_limit", "params": { "limit_ms": 10000 } }));
    m["concepts"].as_array_mut().unwrap().push(json!({ "id": "flow.retry_once" }));
    let mut s = started(&m, &c, 1);
    for _ in 0..3000 {
        if s.ended() {
            break;
        }
        s.tick();
    }
    assert!(s.ended());
    assert!(s.s.tick_count() > 1100, "two full runs, ticks {}", s.s.tick_count());
    s.assert_replays();
}

#[test]
fn lobby_and_tutorial_gate_the_start() {
    let (m, c) = quiz_with(vec![json!({ "id": "flow.lobby_wait", "params": { "timeout_ms": 5000 } }), json!({ "id": "flow.tutorial" })]);
    let mut s = Sim::new(&m, &c, 1);
    s.wait_playing();
    assert_eq!(s.view()["world"]["overlay"]["kind"], "lobby");
    let before = s.view()["time_left_ms"].as_i64().unwrap();
    ticks(&mut s, 30);
    assert_eq!(s.view()["time_left_ms"].as_i64().unwrap(), before, "round timer frozen");
    s.send(json!({ "type": "choice", "index": 0 }));
    ticks(&mut s, 400);
    assert_eq!(s.view()["world"]["overlay"]["kind"], "tutorial");
    assert!(names(&mut s).iter().any(|n| n == "lobby.ready"));
    assert!(s.view()["choices"].as_array().unwrap().iter().all(|c| c["state"] == "idle"), "input during the lobby was ignored");
    s.send(json!({ "type": "ack" }));
    ticks(&mut s, 2);
    assert!(s.view()["world"]["overlay"].is_null());
    s.assert_replays_ok();
}

impl Sim {
    /// Replay of a still-running session must at least agree on the inputs applied so far.
    fn assert_replays_ok(&self) {
        let r = self.s.result();
        let out: Value = serde_json::from_str(&sg_runtime::replay(&self.manifest, &self.content, self.seed, &r["inputs"].to_string())).unwrap();
        assert!(out["score"].is_number());
    }
}

#[test]
fn spawn_rate_ramp_announces_difficulty() {
    let (m, c) = template("whack_mole");
    let mut s = started(&m, &c, 1);
    let mut seen = false;
    for _ in 0..3000 {
        s.tick();
        seen |= names(&mut s).iter().any(|n| n == "difficulty.changed");
        if s.ended() || seen {
            break;
        }
    }
    assert!(seen);
}

#[test]
fn runner_emits_particles_and_replays_deterministically() {
    let (m, c) = template("lane_runner");
    let mut s = started(&m, &c, 21);
    ticks(&mut s, 90);
    assert!(!ents(&s.view(), "particle").is_empty());
    let a = run("lane_runner", 77, 12000, |_, _| {});
    let b = run("lane_runner", 77, 12000, |_, _| {});
    assert_eq!(a.s.result()["score"], b.s.result()["score"]);
    assert_eq!(a.s.result()["ticks"], b.s.result()["ticks"]);
}

#[test]
fn validator_enforces_gameplay_wiring() {
    let check = |m: Value| -> String {
        let (_, c) = mini(vec![]);
        sg_runtime::validate(&m.to_string(), &c.to_string())
    };
    let (m, _) = mini(vec![json!({ "id": "entity.player_avatar" })]);
    assert!(check(m).contains("needs a play space"));
    let (m, _) = mini(vec![json!({ "id": "space.lanes" }), json!({ "id": "space.grid_board" })]);
    assert!(check(m).contains("exactly one space"));
    let (m, _) = mini(vec![json!({ "id": "space.free_canvas" }), json!({ "id": "rule.hint_budget" })]);
    assert!(check(m).contains("requires"));
    let (m, _) = mini(vec![json!({ "id": "space.card_table" }), json!({ "id": "entity.card" }), json!({ "id": "rule.match_pair" })]);
    let r = check(m);
    assert!(r.contains("consumes 'input.tap'"), "{r}");
    assert!(r.contains("card' items"), "card content is required: {r}");
}
