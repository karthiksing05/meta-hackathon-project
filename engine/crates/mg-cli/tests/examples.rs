//! The example games in `engine/examples/`, end to end.
//!
//! For every `examples/*.json` game:
//! * it validates with zero errors;
//! * 20 seeds × 1,000 random inputs give zero runtime errors (game and
//!   presentation) and no engine panics;
//! * every `examples/<game>*.replay.json` script reaches its `expect`ed
//!   outcome (`won` or `lost`) with zero errors.
//!
//! Replay files are ordinary `microgame replay --script` files with two extra
//! keys the CLI ignores: `{"seed": 1, "expect": "won", "inputs": [...]}`.
//! Most are recorded by the bots at the bottom of this file. When a game or
//! the engine changes, re-record them with
//! `cargo test --release -p mg-cli --test examples -- --ignored record_replays`.
//!
//! Run in release for speed: `cargo test --release -p mg-cli --test examples`.

use std::path::{Path, PathBuf};
use std::rc::Rc;

use mg_cli::replay::{parse_script, replay, Action};
use mg_cli::sim::{simulate, SimOptions};
use mg_core::{Diagnostic, Program};
use mg_runtime::Phase;
use mg_scene::{Player, PointerKind};
use serde_json::{json, Value as J};

const DT: f64 = 16.0;

fn examples_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples")
}

/// Game files: `examples/*.json` minus the replay scripts.
fn games() -> Vec<(String, PathBuf)> {
    let mut out: Vec<(String, PathBuf)> = std::fs::read_dir(examples_dir())
        .expect("examples dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            let n = p.file_name().unwrap().to_string_lossy();
            n.ends_with(".json") && !n.ends_with(".replay.json")
        })
        .map(|p| (p.file_stem().unwrap().to_string_lossy().into_owned(), p))
        .collect();
    out.sort();
    assert!(out.len() >= 7, "expected the example games, found {:?}", out.iter().map(|g| &g.0).collect::<Vec<_>>());
    out
}

fn replay_files() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = std::fs::read_dir(examples_dir())
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.file_name().unwrap().to_string_lossy().ends_with(".replay.json"))
        .collect();
    out.sort();
    out
}

fn read(p: &Path) -> String {
    std::fs::read_to_string(p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

fn pretty(d: &[Diagnostic]) -> String {
    d.iter().map(|d| mg_cli::report::format_diag(d, None)).collect::<Vec<_>>().join("\n")
}

fn compile(name: &str, src: &str) -> Rc<Program> {
    match mg_cli::compile(src) {
        Ok((p, _)) => p,
        Err(d) => panic!("{name} does not compile:\n{}", pretty(&d)),
    }
}

fn game_program(name: &str) -> Rc<Program> {
    compile(name, &read(&examples_dir().join(format!("{name}.json"))))
}

// ------------------------------------------------------------ validate ----

#[test]
fn examples_validate_with_zero_errors() {
    let mut failures = Vec::new();
    for (name, path) in games() {
        let d = mg_lang::validate(&read(&path));
        let errs: Vec<Diagnostic> = d.into_iter().filter(|d| d.is_error()).collect();
        if !errs.is_empty() {
            failures.push(format!("{name}:\n{}", pretty(&errs)));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}

// ------------------------------------------------------------ simulate ----

#[test]
fn examples_simulate_20_seeds_1000_inputs() {
    let mut failures = Vec::new();
    for (name, path) in games() {
        let p = compile(&name, &read(&path));
        let opts = SimOptions { seed: 1, seeds: 20, inputs: 1000, dt: DT, restart_on_end: true };
        for r in simulate(&p, &opts) {
            if let Some(panic) = &r.panic {
                failures.push(format!("{name} seed {}: PANIC {panic}", r.seed));
            }
            for d in r.errors.iter().filter(|d| d.is_error()).take(3) {
                failures.push(format!("{name} seed {}: {}", r.seed, mg_cli::report::format_diag(d, None)));
            }
        }
    }
    assert!(failures.is_empty(), "runtime errors:\n{}", failures.join("\n"));
}

// -------------------------------------------------------------- replay ----

fn phase_name(p: Phase) -> &'static str {
    p.as_str()
}

#[test]
fn replays_reach_expected_outcomes() {
    let files = replay_files();
    let mut covered: Vec<(String, String)> = Vec::new();
    let mut failures = Vec::new();
    for path in &files {
        let fname = path.file_name().unwrap().to_string_lossy().into_owned();
        let game = fname.split('.').next().unwrap().to_string();
        let doc: J = serde_json::from_str(&read(path)).unwrap_or_else(|e| panic!("{fname}: {e}"));
        let expect = doc["expect"].as_str().unwrap_or_else(|| panic!("{fname}: needs \"expect\"")).to_string();
        let seed = doc["seed"].as_u64().unwrap_or(1);
        let p = game_program(&game);
        let script = parse_script(&doc.to_string(), &p).unwrap_or_else(|e| panic!("{fname}: {e}"));
        let r = replay(&p, seed, &script, DT, DT);
        let errs: Vec<Diagnostic> = r.errors.iter().filter(|d| d.is_error()).cloned().collect();
        let got = phase_name(r.status.phase);
        if r.panic.is_some() || !errs.is_empty() || got != expect {
            failures.push(format!(
                "{fname}: expected {expect}, got {got} at {} ms (score {:?}); panic {:?}\n{}",
                r.status.time_ms,
                r.status.score,
                r.panic,
                pretty(&errs)
            ));
        }
        if let Some(min) = doc["min_score"].as_f64() {
            let s = r.status.score.unwrap_or(f64::NAN);
            #[allow(clippy::neg_cmp_op_on_partial_ord)] // also catches NaN scores
            if !(s >= min) {
                failures.push(format!("{fname}: score {s} < min_score {min}"));
            }
        }
        covered.push((game, expect));
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
    // Every game but the v0.1 example proves both a win and a loss.
    for (name, _) in games() {
        if name == "meteor_dodge" {
            continue;
        }
        for want in ["won", "lost"] {
            assert!(
                covered.iter().any(|(g, e)| g == &name && e == want),
                "{name}: no replay script reaches '{want}'"
            );
        }
    }
}

/// Same file, seed and script give the same state hash, for every replay.
#[test]
fn replays_are_deterministic() {
    for path in replay_files() {
        let fname = path.file_name().unwrap().to_string_lossy().into_owned();
        let game = fname.split('.').next().unwrap().to_string();
        let doc: J = serde_json::from_str(&read(&path)).unwrap();
        let seed = doc["seed"].as_u64().unwrap_or(1);
        let a = game_program(&game);
        let b = game_program(&game);
        let sa = parse_script(&doc.to_string(), &a).unwrap();
        let sb = parse_script(&doc.to_string(), &b).unwrap();
        let ra = replay(&a, seed, &sa, DT, DT);
        let rb = replay(&b, seed, &sb, DT, DT);
        assert_eq!(ra.hash, rb.hash, "{fname}: hashes differ");
        assert_eq!(ra.status, rb.status, "{fname}");
    }
}

// ============================================================ recorder ====
//
// Bots that play the games through a `Player` and write what they did as a
// replay script. Each action is parsed and applied exactly as
// `mg_cli::replay` does, at the same times, so the script replays to the
// same state.

struct Rec {
    p: Rc<Program>,
    player: Player,
    now: f64,
    entries: Vec<J>,
}

impl Rec {
    fn new(game: &str, seed: u64) -> Rec {
        let p = game_program(game);
        let mut player = Player::new(p.clone(), seed);
        player.frame();
        Rec { p, player, now: 0.0, entries: Vec::new() }
    }

    fn state(&self) -> J {
        self.player.game.program().state_to_json(self.player.game.state())
    }

    fn phase(&self) -> Phase {
        self.player.game.phase()
    }

    /// Records one entry (without `t`) and applies it now.
    fn act(&mut self, mut e: J) {
        e["t"] = json!(self.now);
        let script = parse_script(&J::Array(vec![e.clone()]).to_string(), &self.p).unwrap();
        apply(&mut self.player, &script[0].action);
        self.entries.push(e);
    }

    fn step(&mut self) {
        self.player.step(DT);
        self.now += DT;
        self.player.frame();
    }

    fn save(mut self, file: &str, seed: u64, expect: &str, note: &str) {
        // Let the last effects play out, then stop the script there.
        for _ in 0..4 {
            self.step();
        }
        self.entries.push(json!({ "t": self.now }));
        let mut text = String::from("{\n");
        text += &format!("  \"note\": {},\n  \"seed\": {seed},\n  \"expect\": \"{expect}\",\n  \"inputs\": [\n", json!(note));
        let n = self.entries.len();
        for (i, e) in self.entries.iter().enumerate() {
            text += &format!("    {}{}\n", e, if i + 1 < n { "," } else { "" });
        }
        text += "  ]\n}\n";
        std::fs::write(examples_dir().join(file), text).unwrap();
        let st = self.player.status();
        eprintln!("{file}: {} entries, {} at {} ms, score {:?}", n, phase_name(st.phase), st.time_ms, st.score);
    }
}

fn apply(player: &mut Player, a: &Action) {
    match a {
        Action::Wait => {}
        Action::Key(code, ch, down) => {
            player.key_event(code, ch, *down);
        }
        Action::Char(code, ch) => {
            player.key_event(code, ch, true);
            player.key_event(code, ch, false);
        }
        Action::Text(phase, value) => {
            player.text(*phase, value);
        }
        Action::Swipe(dx, dy) => {
            player.swipe(*dx, *dy);
        }
        Action::Tap(x, y) => {
            player.pointer(PointerKind::Down, *x, *y);
            player.pointer(PointerKind::Up, *x, *y);
        }
        Action::Pointer(k, x, y) => player.pointer(*k, *x, *y),
        Action::Input(id, payload) => player.game.input(*id, payload.clone()),
    }
}

fn f(j: &J) -> f64 {
    j.as_f64().unwrap_or_else(|| panic!("not a number: {j}"))
}

const MAX_STEPS: usize = 20_000;

fn record_gust_glider() {
    // Win: flap whenever the glider sinks below the middle of the next gap.
    let mut r = Rec::new("gust_glider", 1);
    r.act(json!({ "key": "Space" }));
    let mut last_flap = 0.0;
    for _ in 0..MAX_STEPS {
        if r.phase() != Phase::Playing {
            break;
        }
        let s = r.state();
        let g = &s["glider"];
        let (gx, gy, vy) = (f(&g["x"]), f(&g["y"]), f(&g["vy"]));
        let reeds = s["reeds"].as_array().unwrap();
        // The next bottom reed the glider hasn't passed, and its top twin.
        let target = reeds
            .iter()
            .filter(|p| !p["top"].as_bool().unwrap() && f(&p["x"]) + f(&p["w"]) / 2.0 > gx - 14.0)
            .min_by(|a, b| f(&a["x"]).partial_cmp(&f(&b["x"])).unwrap())
            .map(|b| {
                let bot_start = f(&b["y"]) - f(&b["h"]) / 2.0;
                bot_start - 42.0
            })
            .unwrap_or(330.0);
        if gy > target && vy > -60.0 && r.now - last_flap >= 120.0 {
            // Alternate the flap sources: Space, ArrowUp and a pointer tap.
            let k = (r.now / 16.0) as i64 % 3;
            match k {
                0 => r.act(json!({ "key": "Space" })),
                1 => r.act(json!({ "key": "ArrowUp" })),
                _ => {
                    r.act(json!({ "pointer": "down", "at": [200, 400] }));
                    r.act(json!({ "pointer": "up", "at": [200, 400] }));
                }
            }
            last_flap = r.now;
        }
        r.step();
    }
    r.save("gust_glider.replay.json", 1, "won", "Bot: flaps whenever the glider sinks 42 px above the next gap's lower reed.");

    // Lose: one flap, then fall onto the ground.
    let mut r = Rec::new("gust_glider", 1);
    r.act(json!({ "key": "Space" }));
    while r.phase() == Phase::Playing && r.now < 5000.0 {
        r.step();
    }
    r.save("gust_glider.lose.replay.json", 1, "lost", "One flap, then the glider drops onto the ground.");
}

fn record_word_rain() {
    // Win: type the lowest word letter by letter (change events), then submit.
    let mut r = Rec::new("word_rain", 1);
    let mut busy_until = 0.0;
    let mut wrong_done = false;
    for _ in 0..MAX_STEPS {
        if r.phase() != Phase::Playing {
            break;
        }
        if r.now >= busy_until {
            let s = r.state();
            let drops = s["drops"].as_array().unwrap();
            if let Some(d) = drops.iter().max_by(|a, b| f(&a["y"]).partial_cmp(&f(&b["y"])).unwrap()) {
                let w = d["text"].as_str().unwrap().to_string();
                if !wrong_done {
                    // One typo first: it costs the streak, not a life.
                    r.act(json!({ "text": "submit", "value": "zzz" }));
                    wrong_done = true;
                }
                for k in 1..=w.chars().count().min(3) {
                    let prefix: String = w.chars().take(k).collect();
                    r.act(json!({ "text": "change", "value": prefix }));
                }
                // Messy input: spaces and capitals are cleaned up by the game.
                r.act(json!({ "text": "submit", "value": format!("  {} ", w.to_uppercase()) }));
                busy_until = r.now + 450.0;
            }
        }
        r.step();
    }
    r.save("word_rain.replay.json", 1, "won", "Bot: types the lowest word (change events for a prefix, then submit), one typo first.");

    // Lose: never type; three words reach the puddle.
    let mut r = Rec::new("word_rain", 1);
    while r.phase() == Phase::Playing && r.now < 60_000.0 {
        r.step();
    }
    r.save("word_rain.lose.replay.json", 1, "lost", "Nobody types: three words reach the puddle.");
}

fn record_lantern_ridge() {
    // Win: hold right; jump when grounded and a gap or thorns are just ahead.
    let mut r = Rec::new("lantern_ridge", 1);
    // The fixed HUD buttons hold to move (on_press / on_release): hold left
    // briefly, then hold right for the whole run, released off the button.
    r.act(json!({ "down": [52, 584] }));
    for _ in 0..12 {
        r.step();
    }
    r.act(json!({ "up": [52, 584] }));
    r.step();
    r.act(json!({ "down": [132, 584] }));
    let mut space_down = false;
    for _ in 0..MAX_STEPS {
        if r.phase() != Phase::Playing {
            break;
        }
        let s = r.state();
        if space_down {
            r.act(json!({ "key": "Space", "up": true }));
            space_down = false;
        }
        let hero = &s["hero"];
        let (hx, hy) = (f(&hero["x"]), f(&hero["y"]));
        let now = r.now;
        let grounded = now - f(&s["landed_at"]) <= 60.0;
        let over_ground = |x: f64| {
            s["ground"].as_array().unwrap().iter().any(|g| (f(&g["x"]) - x).abs() <= f(&g["w"]) / 2.0)
                || s["ledges"].as_array().unwrap().iter().any(|l| {
                    (f(&l["x"]) - x).abs() <= f(&l["w"]) / 2.0 && (f(&l["y"]) - (hy + 17.0)).abs() < 14.0
                })
        };
        let gap_ahead = (1..=4).any(|k| !over_ground(hx + 14.0 + k as f64 * 12.0));
        let thorns_ahead = s["thorns"].as_array().unwrap().iter().any(|t| {
            let left = f(&t["x"]) - f(&t["w"]) / 2.0;
            left - hx > 0.0 && left - hx < 70.0
        });
        if grounded && (gap_ahead || thorns_ahead) {
            r.act(json!({ "key": "Space" }));
            space_down = true;
        }
        r.step();
    }
    r.act(json!({ "up": [200, 400] }));
    r.save("lantern_ridge.replay.json", 1, "won", "Bot: holds the HUD arrows (left, then right) and jumps at gaps and thorns.");

    // Lose: run right without jumping into the first gap.
    let mut r = Rec::new("lantern_ridge", 1);
    r.act(json!({ "key": "KeyD" }));
    while r.phase() == Phase::Playing && r.now < 10_000.0 {
        r.step();
    }
    r.save("lantern_ridge.lose.replay.json", 1, "lost", "Hold D and never jump: fall into the first gap.");
}

fn record_prism_breaker() {
    // Win: drag the paddle under the falling orb, angled toward the crystals.
    let mut r = Rec::new("prism_breaker", 1);
    r.act(json!({ "down": [180, 600] }));
    let mut k = 0u64;
    for _ in 0..MAX_STEPS {
        if r.phase() != Phase::Playing {
            break;
        }
        k += 1;
        let s = r.state();
        let orb = &s["orb"];
        let (ox, oy, vx, vy) = (f(&orb["x"]), f(&orb["y"]), f(&orb["vx"]), f(&orb["vy"]));
        let bricks: Vec<&J> = s["bricks"].as_array().unwrap().iter().filter(|b| b["hp"].as_i64().unwrap() > 0).collect();
        if k.is_multiple_of(2) && vy > 0.0 && !bricks.is_empty() {
            // Where the orb will cross the paddle line, folding wall bounces.
            let t = (568.0 - oy) / vy;
            let mut x = ox + vx * t;
            for _ in 0..4 {
                if x < 8.0 {
                    x = 16.0 - x;
                }
                if x > 352.0 {
                    x = 704.0 - x;
                }
            }
            let cx = bricks.iter().map(|b| f(&b["x"])).sum::<f64>() / bricks.len() as f64;
            let wobble = ((k / 90) as f64 * 1.7).sin() * 0.35;
            let off = ((cx - x) / 160.0 + wobble).clamp(-0.75, 0.75);
            let px = (x - off * 42.0).clamp(42.0, 318.0);
            r.act(json!({ "move": [px.round(), 600] }));
        }
        r.step();
    }
    r.act(json!({ "up": [180, 600] }));
    r.save("prism_breaker.replay.json", 1, "won", "Bot: drags the paddle to where the orb will land, aiming at the crystals.");

    // Lose: keep the paddle parked in the far corner.
    let mut r = Rec::new("prism_breaker", 1);
    for _ in 0..12 {
        r.act(json!({ "key": "ArrowLeft" }));
    }
    while r.phase() == Phase::Playing && r.now < 60_000.0 {
        r.step();
    }
    r.save("prism_breaker.lose.replay.json", 1, "lost", "Park the paddle at the left wall and let every orb through.");
}

fn record_orbit_warden() {
    // Win: auto-fire at the nearest mite with any key, plus some aimed taps.
    let mut r = Rec::new("orbit_warden", 1);
    let mut k = 0u64;
    for _ in 0..MAX_STEPS {
        if r.phase() != Phase::Playing {
            break;
        }
        k += 1;
        if k.is_multiple_of(11) {
            let s = r.state();
            let mites = s["mites"].as_array().unwrap();
            if !mites.is_empty() {
                if k.is_multiple_of(77) {
                    // An aimed tap at the nearest mite, through the pointer source.
                    let m = mites
                        .iter()
                        .min_by(|a, b| {
                            let da = (f(&a["x"]) - 180.0).hypot(f(&a["y"]) - 330.0);
                            let db = (f(&b["x"]) - 180.0).hypot(f(&b["y"]) - 330.0);
                            da.partial_cmp(&db).unwrap()
                        })
                        .unwrap();
                    let at = json!([f(&m["x"]).round(), f(&m["y"]).round()]);
                    r.act(json!({ "pointer": "down", "at": at }));
                    r.act(json!({ "pointer": "up", "at": at }));
                } else {
                    r.act(json!({ "char": if k.is_multiple_of(2) { "f" } else { "j" } }));
                }
            }
        }
        r.step();
    }
    r.save("orbit_warden.replay.json", 1, "won", "Bot: presses a letter key (auto-aim) every 176 ms and taps a mite now and then.");

    // Lose: never fire.
    let mut r = Rec::new("orbit_warden", 1);
    while r.phase() == Phase::Playing && r.now < 46_000.0 {
        r.step();
    }
    r.save("orbit_warden.lose.replay.json", 1, "lost", "Never fire: the mites wear the shield down.");
}

fn record_gull_rock() {
    // The story is fixed, so these scripts are short: skip each page's
    // typewriter with Space or a tap on the page, then choose.
    let tap = |i: usize| json!([180, 523 + 56 * i]);
    let mut r = Rec::new("gull_rock", 1);
    let plan: Vec<J> = vec![
        json!({ "key": "Space" }),
        json!({ "key": "Digit1" }), // climb to the lamp room
        json!({ "tap": [180, 300] }),
        json!({ "tap": tap(1) }), // cellar
        json!({ "key": "Enter" }),
        json!({ "key": "Digit1" }), // red-striped cask, +3 oil
        json!({ "key": "Space" }),
        json!({ "tap": tap(0) }), // light the lamp
        json!({ "key": "Space" }),
        json!({ "key": "Digit1" }), // keep watch: dawn
    ];
    for e in plan {
        for _ in 0..10 {
            r.step();
        }
        r.act(e);
    }
    while r.phase() == Phase::Playing && r.now < 30_000.0 {
        r.step();
    }
    r.save("gull_rock.replay.json", 1, "won", "Climb, fetch the red-striped cask, light the lamp, keep watch until dawn.");

    let mut r = Rec::new("gull_rock", 1);
    let plan: Vec<J> = vec![
        json!({ "key": "Space" }),
        json!({ "key": "Digit2" }), // signal with the hand lantern (oil 2 -> 1)
        json!({ "key": "Space" }),
        json!({ "key": "Digit2" }), // run up to the lamp room
        json!({ "key": "Space" }),
        json!({ "key": "Digit1" }), // pour 2 oil: not enough, nothing happens
        json!({ "key": "Digit2" }), // cellar
        json!({ "key": "Space" }),
        json!({ "key": "Digit2" }), // unmarked cask: sea water
        json!({ "key": "Space" }),
        json!({ "key": "Digit1" }), // back to the cellar
    ];
    for e in plan {
        for _ in 0..10 {
            r.step();
        }
        r.act(e);
    }
    // Then dither until the night runs out (time limit).
    while r.phase() == Phase::Playing && r.now < 200_000.0 {
        r.step();
    }
    r.save("gull_rock.lose.replay.json", 1, "lost", "Waste oil, take the sea-water cask, then wait in the cellar until the night runs out.");

    let mut r = Rec::new("gull_rock", 1);
    for e in [
        json!({ "key": "Space" }),
        json!({ "key": "Digit2" }), // signal
        json!({ "key": "Space" }),
        json!({ "key": "Digit1" }), // wave them north
        json!({ "key": "Space" }),
        json!({ "key": "Digit2" }), // row out: adrift
    ] {
        for _ in 0..10 {
            r.step();
        }
        r.act(e);
    }
    while r.phase() == Phase::Playing && r.now < 30_000.0 {
        r.step();
    }
    r.save("gull_rock.adrift.replay.json", 1, "lost", "Signal, wave them north, row out: lost at sea.");
}

/// Re-records the bot replay scripts in `examples/`.
#[test]
#[ignore]
fn record_replays() {
    let only = std::env::var("MG_RECORD").unwrap_or_default();
    let all: [(&str, fn()); 6] = [
        ("gust_glider", record_gust_glider),
        ("word_rain", record_word_rain),
        ("lantern_ridge", record_lantern_ridge),
        ("prism_breaker", record_prism_breaker),
        ("orbit_warden", record_orbit_warden),
        ("gull_rock", record_gull_rock),
    ];
    for (name, f) in all {
        if only.is_empty() || only.split(',').any(|o| o == name) {
            f();
        }
    }
}

/// Debugging aid: plays `MG_REPLAY` (a replay file in `examples/`) and prints
/// the frame JSON at each time in `MG_TIMES` (ms, comma separated), plus
/// every sound, toast and haptic with its time.
/// `MG_REPLAY=gust_glider.replay.json MG_TIMES=1000 cargo test --release -p mg-cli --test examples -- --ignored dump_frames --nocapture`
#[test]
#[ignore]
fn dump_frames() {
    let Ok(file) = std::env::var("MG_REPLAY") else { return };
    let times: Vec<f64> = std::env::var("MG_TIMES").unwrap_or_default().split(',').filter_map(|t| t.trim().parse().ok()).collect();
    // `MG_GAME` (a path) overrides the game named by the replay file.
    let (doc, p) = match std::env::var("MG_GAME") {
        Ok(g) => (serde_json::from_str::<J>(&read(Path::new(&file))).unwrap(), compile(&g, &read(Path::new(&g)))),
        Err(_) => {
            let game = file.split('.').next().unwrap().to_string();
            (serde_json::from_str::<J>(&read(&examples_dir().join(&file))).unwrap(), game_program(&game))
        }
    };
    let script = parse_script(&doc.to_string(), &p).unwrap();
    let mut player = Player::new(p.clone(), doc["seed"].as_u64().unwrap_or(1));
    let mut now = 0.0;
    let mut next = 0;
    let end = script.last().map_or(0.0, |e| e.t);
    let mut out = Vec::new();
    loop {
        while next < script.len() && script[next].t <= now + 1e-9 {
            apply(&mut player, &script[next].action);
            next += 1;
        }
        let fr = player.frame();
        for a in &fr.audio {
            eprintln!("{now:>7} audio {a:?}");
        }
        for t in &fr.toasts {
            eprintln!("{now:>7} toast {t:?}");
        }
        for h in &fr.haptics {
            eprintln!("{now:>7} haptic {h:?}");
        }
        if times.iter().any(|t| (t - now).abs() < DT / 2.0) {
            out.clear();
            mg_wasm::encode::frame_json(fr, &mut out);
            eprintln!("{now:>7} FRAME {}", String::from_utf8_lossy(&out));
            eprintln!("{now:>7} camera {:?} diags {}", player.camera(), pretty(player.diagnostics()));
        }
        if now > end + 100.0 {
            break;
        }
        player.step(DT);
        now += DT;
    }
}

/// Debugging aid: prints each game's assets and text input metadata.
#[test]
#[ignore]
fn dump_meta() {
    for (name, _) in games() {
        let p = game_program(&name);
        let mut assets = mg_wasm::assets_json(&p);
        for a in assets.as_array_mut().into_iter().flatten() {
            if let Some(s) = a.get("src").and_then(J::as_str) {
                a["src"] = json!(format!("{}... ({} bytes)", &s[..s.len().min(40)], s.len()));
            }
        }
        eprintln!("{name}: text_input {} assets {}", mg_wasm::text_input_json(&p), assets);
    }
}
