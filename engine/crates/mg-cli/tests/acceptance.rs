//! Engine v0.1 definition of done (spec B7), end to end.
//!
//! Run in release for speed: `cargo test --release -p mg-cli`.

use std::collections::VecDeque;
use std::process::Command;
use std::rc::Rc;

use mg_cli::replay::{parse_script, replay};
use mg_cli::sim::{simulate, SimOptions};
use mg_core::value::Value;
use mg_core::{Code, Diagnostic, Program};
use mg_runtime::Phase;
use mg_scene::{Player, PointerKind};
use serde_json::{json, Value as J};

const FIXTURES: [&str; 3] = ["lights_out", "snake", "number_merge"];

fn fixture(name: &str) -> String {
    let path = format!("{}/../../fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn compile(src: &str) -> Rc<Program> {
    match mg_cli::compile(src) {
        Ok((p, _)) => p,
        Err(d) => panic!("game does not compile:\n{}", pretty(&d)),
    }
}

fn pretty(d: &[Diagnostic]) -> String {
    d.iter().map(|d| mg_cli::report::format_diag(d, None)).collect::<Vec<_>>().join("\n")
}

/// A state variable's current value, by name.
fn get(p: &Player, name: &str) -> Value {
    let id = p.game.program().state_index(name).unwrap_or_else(|| panic!("no state '{name}'"));
    p.game.state()[id as usize].clone()
}

fn ivec(v: &Value) -> (i32, i32) {
    match v {
        Value::IVec2(x, y) => (*x, *y),
        other => panic!("expected ivec2, got {other:?}"),
    }
}

fn errors(d: &[Diagnostic]) -> Vec<&Diagnostic> {
    d.iter().filter(|d| d.is_error()).collect()
}

// ------------------------------------------------------------ validate ----

#[test]
fn fixtures_validate_with_zero_errors() {
    for name in FIXTURES {
        let d = mg_lang::validate(&fixture(name));
        assert!(errors(&d).is_empty(), "{name} has errors:\n{}", pretty(&d));
    }
}

// ------------------------------------------------------------ simulate ----

fn fifty_by_thousand(name: &str) {
    let p = compile(&fixture(name));
    let opts = SimOptions { seed: 1, seeds: 50, inputs: 1000, dt: 16.0, restart_on_end: true };
    let reports = simulate(&p, &opts);
    assert_eq!(reports.len(), 50);
    let mut failures = Vec::new();
    for r in &reports {
        if let Some(panic) = &r.panic {
            failures.push(format!("seed {}: PANIC {panic}", r.seed));
        }
        for d in errors(&r.errors).into_iter().take(3) {
            failures.push(format!("seed {}: {}", r.seed, mg_cli::report::format_diag(d, None)));
        }
    }
    assert!(failures.is_empty(), "{name}: runtime errors:\n{}", failures.join("\n"));
}

#[test]
fn simulate_lights_out_50_seeds_1000_inputs() {
    fifty_by_thousand("lights_out");
}

#[test]
fn simulate_snake_50_seeds_1000_inputs() {
    fifty_by_thousand("snake");
}

#[test]
fn simulate_number_merge_50_seeds_1000_inputs() {
    fifty_by_thousand("number_merge");
}

// --------------------------------------------------------- determinism ----

#[test]
fn same_file_seed_and_script_give_the_same_hash() {
    let cases = [
        ("snake", json!([{"t": 100, "key": "ArrowDown"}, {"t": 700, "swipe": "right"}, {"t": 1000, "key": "ArrowUp"}, {"t": 2500}])),
        ("number_merge", json!([{"t": 0, "key": "ArrowLeft"}, {"t": 50, "swipe": "down"}, {"t": 90, "key": "ArrowRight"}, {"t": 140, "swipe": "up"}])),
        ("lights_out", json!([{"t": 0, "input": "tap_cell", "with": {"cell": [2, 2]}}, {"t": 40, "tap": [180, 320]}, {"t": 80, "input": "tap_cell", "with": {"cell": [0, 4]}}])),
    ];
    for (name, script) in cases {
        let src = fixture(name);
        let a = compile(&src);
        let b = compile(&src); // compile again: hashes must not depend on the compile either
        let script_a = parse_script(&script.to_string(), &a).unwrap();
        let script_b = parse_script(&script.to_string(), &b).unwrap();
        let ra = replay(&a, 7, &script_a, 16.0, 16.0);
        let rb = replay(&b, 7, &script_b, 16.0, 16.0);
        assert!(ra.panic.is_none(), "{name}: {:?}", ra.panic);
        assert_eq!(ra.hash, rb.hash, "{name}: replay hashes differ");
        assert_eq!(ra.state, rb.state, "{name}: replay states differ");
        assert_eq!(ra.status, rb.status, "{name}");
    }
    // Random simulations are deterministic too, and the seed matters.
    for name in FIXTURES {
        let p = compile(&fixture(name));
        let opts = SimOptions { seed: 11, seeds: 3, inputs: 200, ..Default::default() };
        let h1: Vec<u64> = simulate(&p, &opts).iter().map(|r| r.final_hash).collect();
        let h2: Vec<u64> = simulate(&p, &opts).iter().map(|r| r.final_hash).collect();
        assert_eq!(h1, h2, "{name}: simulation hashes differ between runs");
    }
    let p = compile(&fixture("number_merge"));
    let h = |seed| Player::new(p.clone(), seed).game.state_hash();
    assert_ne!(h(1), h(2), "number_merge: different seeds should give different boards");
}

// ----------------------------------------------------- broken games ----

fn edit(name: &str, f: impl FnOnce(&mut J)) -> String {
    let mut doc: J = serde_json::from_str(&fixture(name)).unwrap();
    f(&mut doc);
    doc.to_string()
}

fn rename_key(obj: &mut J, from: &str, to: &str) {
    let m = obj.as_object_mut().unwrap();
    let old = std::mem::take(m);
    for (k, v) in old {
        m.insert(if k == from { to.to_string() } else { k }, v);
    }
}

fn find<'a>(d: &'a [Diagnostic], code: Code, at: &str) -> Option<&'a Diagnostic> {
    d.iter().find(|x| x.code == code && x.at == at)
}

#[test]
fn renamed_state_var_reports_unknown_name_at_each_use() {
    // Lights Out: `moves` → `move_count` in `state` only.
    let src = edit("lights_out", |d| rename_key(&mut d["state"], "moves", "move_count"));
    let d = mg_lang::validate(&src);
    let all = pretty(&d);
    let score = find(&d, Code::UnknownName, "/objectives/score").unwrap_or_else(|| panic!("no E_UNKNOWN_NAME at /objectives/score:\n{all}"));
    assert_eq!(score.span, Some((14, 19)), "span of 'moves' in 'max(0, 1000 - moves * 20)':\n{all}");
    assert!(
        find(&d, Code::UnknownName, "/presentation/root/children/2/text").is_some(),
        "no E_UNKNOWN_NAME at /presentation/root/children/2/text:\n{all}"
    );
    assert!(d.iter().any(|x| x.is_error() && x.at == "/rules/1/do/1/incr"), "no error at /rules/1/do/1/incr:\n{all}");
    for x in errors(&d) {
        assert!(
            ["/objectives/score", "/presentation/root/children/2/text", "/rules/1/do/1/incr"].contains(&x.at.as_str()),
            "unexpected error:\n{}",
            mg_cli::report::format_diag(x, None)
        );
    }

    // Snake: `next_dir` → `next_dirs`. One edit away, so expect a hint.
    let src = edit("snake", |d| rename_key(&mut d["state"], "next_dir", "next_dirs"));
    let d = mg_lang::validate(&src);
    let all = pretty(&d);
    let to = find(&d, Code::UnknownName, "/rules/1/do/0/to").unwrap_or_else(|| panic!("no E_UNKNOWN_NAME at /rules/1/do/0/to:\n{all}"));
    assert_eq!(to.span, Some((0, 8)), "{all}");
    assert!(to.hint.as_deref().unwrap_or("").contains("next_dirs"), "expected a 'did you mean next_dirs' hint:\n{all}");
    assert!(d.iter().any(|x| x.is_error() && x.at == "/rules/0/do/0/set"), "no error at /rules/0/do/0/set:\n{all}");
}

#[test]
fn bool_where_int_expected_reports_type_mismatch() {
    // Number Merge: `incr score by r.gained` → `by true`.
    let src = edit("number_merge", |d| d["rules"][2]["do"][1]["do"][2]["by"] = json!("true"));
    let d = mg_lang::validate(&src);
    let all = pretty(&d);
    let x = find(&d, Code::TypeMismatch, "/rules/2/do/1/do/2/by")
        .unwrap_or_else(|| panic!("no E_TYPE_MISMATCH at /rules/2/do/1/do/2/by:\n{all}"));
    assert_eq!(x.span, Some((0, 4)), "{all}");
    assert_eq!(errors(&d).len(), 1, "expected exactly one error:\n{all}");

    // Lights Out: `moves` initialised with a bool.
    let src = edit("lights_out", |d| d["state"]["moves"]["init"] = json!("false"));
    let d = mg_lang::validate(&src);
    let all = pretty(&d);
    assert!(find(&d, Code::TypeMismatch, "/state/moves/init").is_some(), "no E_TYPE_MISMATCH at /state/moves/init:\n{all}");
}

// ------------------------------------------------- win and lose paths ----

/// Solves Lights Out over GF(2): which cells to press to clear `on`.
fn solve_lights_out(on: &[bool], w: usize, h: usize) -> Vec<usize> {
    let n = w * h;
    // Row i: which presses toggle cell i, plus the target bit at column n.
    let mut rows: Vec<Vec<bool>> = (0..n)
        .map(|i| {
            let (x, y) = ((i % w) as i32, (i / w) as i32);
            let mut r = vec![false; n + 1];
            for (dx, dy) in [(0, 0), (0, -1), (1, 0), (0, 1), (-1, 0)] {
                let (nx, ny) = (x + dx, y + dy);
                if nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h {
                    r[ny as usize * w + nx as usize] = true;
                }
            }
            r[n] = on[i];
            r
        })
        .collect();
    let mut pivots = Vec::new();
    let mut row = 0;
    for col in 0..n {
        let Some(p) = (row..n).find(|&r| rows[r][col]) else { continue };
        rows.swap(row, p);
        for r in 0..n {
            if r != row && rows[r][col] {
                let src = rows[row].clone();
                for (a, b) in rows[r].iter_mut().zip(src) {
                    *a ^= b;
                }
            }
        }
        pivots.push((row, col));
        row += 1;
    }
    assert!(rows[row..].iter().all(|r| !r[n]), "board is not solvable");
    pivots.into_iter().filter(|&(r, _)| rows[r][n]).map(|(_, c)| c).collect()
}

#[test]
fn lights_out_win_by_solving_with_taps() {
    let p = compile(&fixture("lights_out"));
    for seed in [1u64, 2, 3] {
        let mut player = Player::new(p.clone(), seed);
        player.frame();
        let (w, h, on) = match get(&player, "board") {
            Value::Grid(g) => (g.w as usize, g.h as usize, g.cells.iter().map(|c| c.as_bool().unwrap()).collect::<Vec<_>>()),
            other => panic!("board is not a grid: {other:?}"),
        };
        assert!(on.iter().any(|&b| b), "seed {seed}: the scramble left the board empty");
        let presses = solve_lights_out(&on, w, h);
        // Tap targets: the 25 cells, ordered row-major by position.
        let mut targets = player.hit_targets();
        assert_eq!(targets.len(), w * h, "seed {seed}: expected one tap target per cell");
        targets.sort_by(|a, b| (a.y, a.x).partial_cmp(&(b.y, b.x)).unwrap());
        for (k, cell) in presses.iter().enumerate() {
            let t = &targets[*cell];
            let (x, y) = (t.x + t.w / 2.0, t.y + t.h / 2.0);
            player.pointer(PointerKind::Down, x, y);
            player.pointer(PointerKind::Up, x, y);
            player.step(16.0);
            player.frame();
            let want = if k + 1 == presses.len() { Phase::Won } else { Phase::Playing };
            assert_eq!(player.game.phase(), want, "seed {seed}: after press {} of {}", k + 1, presses.len());
        }
        assert_eq!(get(&player, "moves"), Value::Int(presses.len() as i64));
        let st = player.status();
        assert_eq!(st.score, Some((1000 - 20 * presses.len() as i64).max(0) as f64));
    }
}

#[test]
fn lights_out_lose_by_timeout() {
    let p = compile(&fixture("lights_out"));
    let mut player = Player::new(p, 1);
    for _ in 0..(91_000 / 16) {
        player.step(16.0);
    }
    let st = player.status();
    assert_eq!(st.phase, Phase::Lost);
    assert!((90_000..=90_016).contains(&st.time_ms), "clock should stop at the 90 s limit, got {}", st.time_ms);
}

#[test]
fn snake_lose_by_running_into_the_wall() {
    let p = compile(&fixture("snake"));
    let script = parse_script(r#"[{"t": 3000}]"#, &p).unwrap();
    let r = replay(&p, 1, &script, 16.0, 0.0);
    assert!(r.panic.is_none(), "{:?}", r.panic);
    assert_eq!(r.status.phase, Phase::Lost);
    // Head starts at x=4 moving right; move k (at 150k ms) puts it at 4+k, so it leaves the 15-wide board on move 11.
    assert!((1650..=1666).contains(&r.status.time_ms), "lost at {} ms", r.status.time_ms);
    // The first apple sits at (10, 7), on the way to the wall.
    assert_eq!(r.state["score"], json!(1));
}

#[test]
fn snake_win_by_steering_to_ten_apples() {
    let p = compile(&fixture("snake"));
    let mut player = Player::new(p, 3);
    let n = 15;
    for _ in 0..3000 {
        if player.game.phase() != Phase::Playing {
            break;
        }
        let snake: Vec<(i32, i32)> = match get(&player, "snake") {
            Value::List(l) => l.iter().map(ivec).collect(),
            other => panic!("{other:?}"),
        };
        let food = ivec(&get(&player, "food"));
        let dir = ivec(&get(&player, "dir"));
        let head = snake[0];
        // Cells blocked next tick: the body minus the tail (it moves away).
        let blocked = |c: (i32, i32)| c.0 < 0 || c.1 < 0 || c.0 >= n || c.1 >= n || snake[..snake.len() - 1].contains(&c);
        let dirs = [(0, -1), (1, 0), (0, 1), (-1, 0)];
        // BFS from head to food.
        let mut prev = vec![None; (n * n) as usize];
        let mut q = VecDeque::from([head]);
        let idx = |c: (i32, i32)| (c.1 * n + c.0) as usize;
        prev[idx(head)] = Some(head);
        while let Some(c) = q.pop_front() {
            if c == food {
                break;
            }
            for d in dirs {
                let nc = (c.0 + d.0, c.1 + d.1);
                if !blocked(nc) && prev[idx(nc)].is_none() {
                    prev[idx(nc)] = Some(c);
                    q.push_back(nc);
                }
            }
        }
        let mut step = None;
        if prev[idx(food)].is_some() {
            let mut c = food;
            while let Some(pc) = prev[idx(c)] {
                if pc == head {
                    break;
                }
                c = pc;
            }
            step = Some((c.0 - head.0, c.1 - head.1));
        }
        let step = step
            .filter(|d| (d.0 + dir.0, d.1 + dir.1) != (0, 0))
            .or_else(|| dirs.into_iter().find(|d| (d.0 + dir.0, d.1 + dir.1) != (0, 0) && !blocked((head.0 + d.0, head.1 + d.1))))
            .unwrap_or(dir);
        let key = match step {
            (0, -1) => "ArrowUp",
            (1, 0) => "ArrowRight",
            (0, 1) => "ArrowDown",
            _ => "ArrowLeft",
        };
        assert!(player.key(key), "{key} should map to steer");
        player.step(150.0); // exactly one move per step
        player.frame();
    }
    let st = player.status();
    assert_eq!(st.phase, Phase::Won, "snake bot did not win: {:?}, score {:?}", st.phase, get(&player, "score"));
    assert_eq!(get(&player, "score"), Value::Int(10));
}

#[test]
fn number_merge_win_and_lose_are_reachable() {
    let p = compile(&fixture("number_merge"));
    let keys = ["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"];
    // Win: corner strategy (prefer down, then left, right, up).
    let mut won = None;
    for seed in 1..=30u64 {
        let mut player = Player::new(p.clone(), seed);
        'game: for _ in 0..5000 {
            for k in keys {
                let before = get(&player, "board");
                player.key(k);
                player.step(16.0);
                if player.game.phase() != Phase::Playing {
                    break 'game;
                }
                if get(&player, "board") != before {
                    continue 'game;
                }
            }
        }
        if player.game.phase() == Phase::Won {
            won = Some(seed);
            break;
        }
    }
    assert!(won.is_some(), "no seed in 1..=30 reached 128 with the corner strategy");

    // Lose: random moves until the board locks (before the time limit).
    let mut lost = None;
    for seed in 1..=100u64 {
        let mut player = Player::new(p.clone(), seed);
        let mut rng = mg_core::rng::Rng::new(seed);
        while player.game.phase() == Phase::Playing && player.game.now_ms() < 170_000 {
            let (dx, dy) = [(0, 1), (0, -1), (1, 0), (-1, 0)][rng.below(4) as usize];
            player.swipe(dx, dy);
            player.step(16.0);
        }
        let st = player.status();
        if st.phase == Phase::Lost && st.time_ms < 170_000 {
            lost = Some(seed);
            break;
        }
    }
    assert!(lost.is_some(), "no seed in 1..=100 lost by locking the board");
}

// ----------------------------------------------------------------- CLI ----

fn cli(args: &[&str]) -> (i32, String, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_microgame")).args(args).output().unwrap();
    (out.status.code().unwrap_or(-1), String::from_utf8_lossy(&out.stdout).into(), String::from_utf8_lossy(&out.stderr).into())
}

#[test]
fn cli_exit_codes_and_output() {
    let dir = std::env::temp_dir().join(format!("mg-cli-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let fx = format!("{}/../../fixtures", env!("CARGO_MANIFEST_DIR"));

    let (code, out, err) = cli(&["validate", &format!("{fx}/snake.json")]);
    assert_eq!(code, 0, "{out}{err}");

    let broken = dir.join("broken.json");
    std::fs::write(&broken, edit("number_merge", |d| d["rules"][2]["do"][1]["do"][2]["by"] = json!("true"))).unwrap();
    let (code, out, err) = cli(&["validate", broken.to_str().unwrap()]);
    assert_eq!(code, 1, "{out}{err}");
    assert!(err.contains("E_TYPE_MISMATCH"), "{err}");
    let (code, out, _) = cli(&["validate", broken.to_str().unwrap(), "--json"]);
    assert_eq!(code, 1);
    let diags: J = serde_json::from_str(&out).unwrap();
    assert_eq!(diags[0]["at"], "/rules/2/do/1/do/2/by");

    assert_eq!(cli(&["validate", "/nonexistent/game.json"]).0, 2);
    assert_eq!(cli(&["validate"]).0, 2);
    assert_eq!(cli(&["simulate", &format!("{fx}/snake.json"), "--bogus"]).0, 2);
    assert_eq!(cli(&["frobnicate"]).0, 2);

    let (code, out, err) = cli(&["simulate", &format!("{fx}/snake.json"), "--seed", "1", "--random-inputs", "200", "--seeds", "3"]);
    assert_eq!(code, 0, "{out}{err}");
    assert!(out.contains("summary: 0 runtime errors"), "{out}");

    let script = dir.join("script.json");
    std::fs::write(&script, r#"[{"t": 0, "key": "ArrowDown"}, {"t": 3000}]"#).unwrap();
    let run = || cli(&["replay", &format!("{fx}/snake.json"), "--seed", "4", "--script", script.to_str().unwrap(), "--json"]);
    let (code, out, err) = run();
    assert_eq!(code, 0, "{out}{err}");
    let a: J = serde_json::from_str(&out).unwrap();
    assert_eq!(a["phase"], "lost");
    let b: J = serde_json::from_str(&run().1).unwrap();
    assert_eq!(a["hash"], b["hash"]);

    let (code, out, err) = cli(&["bench", &format!("{fx}/lights_out.json"), "--steps", "200"]);
    assert_eq!(code, 0, "{out}{err}");
    assert!(out.contains("steps/s"), "{out}");
    let _ = std::fs::remove_dir_all(&dir);
}
