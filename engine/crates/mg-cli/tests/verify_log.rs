//! Challenges: an input log recorded through the WASM C ABI (`mg_*`, called
//! natively here) verifies with `microgame verify`, and tampered logs fail.
//!
//! mg-wasm keeps its games in one global, so everything that calls the C ABI
//! runs inside a single test.

use std::process::Command;

use mg_wasm::*;
use serde_json::Value as J;

fn example(name: &str) -> String {
    let p = format!("{}/../../examples/{name}.json", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{p}: {e}"))
}

fn result() -> Vec<u8> {
    unsafe { std::slice::from_raw_parts(mg_result_ptr(), mg_result_len() as usize) }.to_vec()
}

fn result_json() -> J {
    serde_json::from_slice(&result()).expect("result is JSON")
}

fn load(text: &str, seed: f64) -> i32 {
    let h = unsafe { mg_load(text.as_ptr(), text.len() as u32, seed) };
    assert!(h >= 0, "load failed: {}", String::from_utf8_lossy(&result()));
    h
}

fn key_event(h: i32, code: &str, ch: &str, down: bool) {
    unsafe { mg_key_event(h, code.as_ptr(), code.len() as u32, ch.as_ptr(), ch.len() as u32, down as i32) };
}

fn text(h: i32, kind: i32, v: &str) {
    unsafe { mg_text(h, kind, v.as_ptr(), v.len() as u32) };
}

/// One shell frame: a step at 60 Hz, then a binary frame build.
fn frame(h: i32) {
    mg_step(h, 1000.0 / 60.0);
    mg_frame_bin(h);
}

fn log(h: i32) -> J {
    assert!(mg_log(h) > 0);
    result_json()
}

fn verify(game: &str, log: &J) -> mg_cli::verify::Verdict {
    let (program, _) = mg_cli::compile(game).expect("compiles");
    mg_cli::verify::verify(game, &program, &log.to_string()).expect("log parses")
}

/// Plays Word Rain by typing the lowest falling word (changes, then submit).
fn play_word_rain(h: i32) {
    for i in 0..1500 {
        frame(h);
        if i % 45 == 20 {
            mg_state_json(h);
            let st = result_json();
            if let Some(d) = st["drops"].as_array().and_then(|a| a.iter().max_by(|a, b| {
                a["y"].as_f64().unwrap().total_cmp(&b["y"].as_f64().unwrap())
            })) {
                let w = d["text"].as_str().unwrap().to_string();
                for n in 1..=w.len() {
                    text(h, 1, &w[..n]);
                    frame(h);
                }
                text(h, 0, &w);
                text(h, 1, "");
            }
        }
        if mg_phase(h) != 0 {
            break;
        }
    }
}

#[test]
fn wasm_recorded_logs_verify_natively_and_tampering_fails() {
    mg_init();

    // 1. Word Rain: text input. Must actually score, so the tampering below matters.
    let game = example("word_rain");
    let h = load(&game, 11.0);
    play_word_rain(h);
    let good = log(h);
    assert_eq!(good["format"], "microgame-log/1");
    assert_eq!(good["seed"], 11);
    let score = good["final"]["score"].as_f64().expect("score");
    assert!(score > 0.0, "the bot should score: {}", good["final"]);
    let calls = good["calls"].as_array().unwrap();
    assert!(calls.len() < 2000, "log should be compact, has {} calls", calls.len());
    let v = verify(&game, &good);
    assert!(v.ok, "{:?}", v.problems);

    // Survives a JSON round-trip through a string (as a server would store it).
    let reparsed: J = serde_json::from_str(&good.to_string()).unwrap();
    assert!(verify(&game, &reparsed).ok);

    // Edited score.
    let mut bad = good.clone();
    bad["final"]["score"] = J::from(score + 10.0);
    let v = verify(&game, &bad);
    assert!(!v.ok && v.problems.iter().any(|p| p.contains("final.score")), "{:?}", v.problems);

    // A removed submit (the first one that scored).
    let mut bad = good.clone();
    let i = bad["calls"].as_array().unwrap().iter().position(|c| c[0] == "t" && c[2] == 0).expect("a submit");
    bad["calls"].as_array_mut().unwrap().remove(i);
    let v = verify(&game, &bad);
    assert!(!v.ok, "removing a submit must fail verification");

    // A removed run of steps: later step indices no longer line up.
    let mut bad = good.clone();
    let i = bad["calls"].as_array().unwrap().iter().position(|c| c[0] == "S" || c[0] == "s").unwrap();
    bad["calls"].as_array_mut().unwrap().remove(i);
    assert!(!verify(&game, &bad).ok);

    // A different game file (one byte changed).
    let other = game.replacen("\"Word", "\"word", 1);
    if other != game {
        let v = verify(&other, &good);
        assert!(!v.game_hash_ok && !v.ok);
    }

    // Restart clears the log and keeps the seed.
    mg_restart(h, f64::NAN);
    let fresh = log(h);
    assert_eq!(fresh["calls"], serde_json::json!([]));
    assert!(verify(&game, &fresh).ok);
    mg_unload(h);

    // 2. Orbit Warden: pointer anywhere and `any` keys. 3. Lantern Ridge:
    // camera, key down/up. 4. Gull Rock: digit keys. Random-ish input from a
    // fixed pattern, with frames and occasional extra steps (as at 30 fps).
    for (name, seed) in [("orbit_warden", 3.0), ("lantern_ridge", 4.0), ("gull_rock", 5.0)] {
        let game = example(name);
        let h = load(&game, seed);
        let keys = [("ArrowLeft", ""), ("ArrowRight", ""), ("Space", " "), ("KeyA", "a"), ("Digit1", "1"), ("Digit2", "2")];
        for i in 0..900u32 {
            if i % 7 == 0 {
                mg_step(h, 1000.0 / 60.0); // two steps before this frame
            }
            frame(h);
            match i % 37 {
                3 => {
                    mg_pointer(h, 0, 40.0 + (i % 280) as f64, 100.0 + (i % 400) as f64);
                }
                5 => {
                    mg_pointer(h, 1, 180.5, 300.25);
                }
                9 => {
                    mg_pointer(h, 2, 181.0, 301.0);
                }
                15 | 25 => {
                    let (code, ch) = keys[(i as usize / 37) % keys.len()];
                    key_event(h, code, ch, true);
                }
                21 | 30 => {
                    let (code, ch) = keys[(i as usize / 37) % keys.len()];
                    key_event(h, code, ch, false);
                }
                _ => {}
            }
            if mg_phase(h) != 0 {
                break;
            }
        }
        let good = log(h);
        let v = verify(&game, &good);
        assert!(v.ok, "{name}: {:?}", v.problems);
        let mut bad = good.clone();
        bad["final"]["state_hash"] = J::from("0000000000000000");
        assert!(!verify(&game, &bad).ok, "{name}: edited hash must fail");
        mg_unload(h);
    }
    assert_eq!(mg_live_games(), 0);

    // 5. The CLI: exit 0 for the good log, 1 for a tampered one.
    let dir = std::env::temp_dir().join(format!("mg-verify-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let game_path = format!("{}/../../examples/word_rain.json", env!("CARGO_MANIFEST_DIR"));
    let h = load(&example("word_rain"), 11.0);
    play_word_rain(h);
    let good = log(h);
    mg_unload(h);
    let good_path = dir.join("good.json");
    std::fs::write(&good_path, good.to_string()).unwrap();
    let mut bad = good.clone();
    bad["final"]["phase"] = J::from(if good["final"]["phase"] == "won" { "lost" } else { "won" });
    let bad_path = dir.join("bad.json");
    std::fs::write(&bad_path, bad.to_string()).unwrap();
    let run = |log: &std::path::Path| {
        let out = Command::new(env!("CARGO_BIN_EXE_microgame"))
            .args(["verify", &game_path, "--log", log.to_str().unwrap(), "--json"])
            .output()
            .unwrap();
        let v: J = serde_json::from_slice(&out.stdout).expect("verify --json prints JSON");
        (out.status.code().unwrap(), v)
    };
    let (code, v) = run(&good_path);
    assert_eq!(code, 0, "{v}");
    assert_eq!(v["ok"], true);
    assert_eq!(v["recomputed"]["score"].as_f64(), good["final"]["score"].as_f64());
    let (code, v) = run(&bad_path);
    assert_eq!(code, 1, "{v}");
    assert_eq!(v["ok"], false);
    let _ = std::fs::remove_dir_all(&dir);
}
