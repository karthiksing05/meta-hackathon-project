//! v0.2 end to end: JSON games through `mg_lang::compile` and the runtime.
//!
//! Benchmark (release):
//! `cargo test -p mg-runtime --release --test v02 -- --ignored --nocapture bench`

use std::rc::Rc;
use std::time::Instant;

use mg_core::ir::{PointerPhase, Program, SourceTrigger, TextPhase};
use mg_core::rng::Rng;
use mg_core::scene::EventRef;
use mg_core::{Code, Value};
use mg_runtime::{Fired, Game, Phase};

fn compile(game: &str) -> Rc<Program> {
    match mg_lang::compile(game) {
        Ok(c) => Rc::new(c.program),
        Err(d) => panic!("game does not compile: {d:#?}"),
    }
}

/// A minimal game around the given sections (a JSON object body that
/// includes at least `"state"`).
fn game(sections: &str) -> String {
    format!(
        r##"{{
        "format": "microgame/0.2",
        "meta": {{ "title": "t", "instructions": "i" }},
        "objectives": {{ "time_limit": "600s", "on_timeout": "lose" }},
        "presentation": {{
            "canvas": {{ "w": 360, "h": 640, "background": "#000000" }},
            "root": {{ "node": "group", "children": [] }}
        }},
        {sections}
    }}"##
    )
}

fn get(g: &Game, name: &str) -> Value {
    let id = g.program().state_index(name).unwrap_or_else(|| panic!("no state {name}"));
    g.state()[id as usize].clone()
}

fn field(v: &Value, g: &Game, state: &str, name: &str) -> f64 {
    let ty = &g.program().state[g.program().state_index(state).unwrap() as usize].ty;
    let rt = match ty {
        mg_core::types::Type::Record(r) => r.clone(),
        mg_core::types::Type::List(t) => match &**t {
            mg_core::types::Type::Record(r) => r.clone(),
            _ => panic!(),
        },
        _ => panic!(),
    };
    match v {
        Value::Record(f) => f[rt.index_of(name).unwrap()].as_f64().unwrap(),
        _ => panic!("not a record: {v}"),
    }
}

fn fired(g: &mut Game) -> Vec<Fired> {
    let mut v = Vec::new();
    g.drain_fired(&mut v);
    v
}

fn no_diags(g: &mut Game) {
    let d = g.take_diagnostics();
    assert!(d.is_empty(), "unexpected diagnostics: {d:#?}");
}

#[test]
fn builtins_and_pi_from_json() {
    let prog = compile(&game(
        r#"
        "rules": [],
        "state": {
            "words": { "type": "list<string>", "init": "split(' a, b ,c ', ',')" },
            "trimmed": { "type": "list<string>", "init": "map(words, w => trim(w))" },
            "n": { "type": "int?", "init": "parse_int(' -42 ')" },
            "bad": { "type": "int?", "init": "parse_int('4x')" },
            "at": { "type": "int", "init": "index_of('héllo', 'llo')" },
            "sub": { "type": "string", "init": "substr('héllo', 1, 3)" },
            "rep": { "type": "string", "init": "replace('a-b-c', '-', '')" },
            "sw": { "type": "bool", "init": "starts_with('hello', 'he') and ends_with('hello', 'lo')" },
            "ang": { "type": "float", "init": "angle(vec(0, 1))" },
            "half_pi": { "type": "float", "init": "pi / 2" },
            "p": { "type": "float", "init": "pow(2, 10)" },
            "m": { "type": "float", "init": "fmod(-7.5, 2.0)" },
            "sg": { "type": "int", "init": "sign(-3)" },
            "mn": { "type": "int", "init": "min_of([4, 2, 8])" },
            "mx": { "type": "float", "init": "max_of([1.5, 0.5])" },
            "rot": { "type": "vec2", "init": "rotate(vec(2.0, 0.0), 0)" },
            "fa": { "type": "vec2", "init": "from_angle(0)" },
            "at2": { "type": "float", "init": "atan2(1, 1)" },
            "coin": { "type": "bool", "init": "chance(1)" }
        }
    "#,
    ));
    let mut g = Game::new(prog, 1);
    no_diags(&mut g);
    let s = |x: &str| Value::str(x);
    assert_eq!(get(&g, "trimmed"), Value::list(vec![s("a"), s("b"), s("c")]));
    assert_eq!(get(&g, "n"), Value::Int(-42));
    assert_eq!(get(&g, "bad"), Value::None);
    assert_eq!(get(&g, "at"), Value::Int(2));
    assert_eq!(get(&g, "sub"), s("él"));
    assert_eq!(get(&g, "rep"), s("abc"));
    assert_eq!(get(&g, "sw"), Value::Bool(true));
    assert_eq!(get(&g, "ang"), get(&g, "half_pi"));
    assert_eq!(get(&g, "half_pi"), Value::Float(std::f64::consts::FRAC_PI_2));
    assert_eq!(get(&g, "p"), Value::Float(1024.0));
    assert_eq!(get(&g, "m"), Value::Float(-1.5));
    assert_eq!(get(&g, "sg"), Value::Int(-1));
    assert_eq!(get(&g, "mn"), Value::Int(2));
    assert_eq!(get(&g, "mx"), Value::Float(1.5));
    assert_eq!(get(&g, "rot"), Value::Vec2(2.0, 0.0));
    assert_eq!(get(&g, "fa"), Value::Vec2(1.0, 0.0));
    assert_eq!(get(&g, "at2"), Value::Float(std::f64::consts::FRAC_PI_4));
    assert_eq!(get(&g, "coin"), Value::Bool(true));
}

#[test]
fn key_pointer_and_text_from_json() {
    let prog = compile(&game(
        r#"
        "state": {
            "typed": { "type": "string", "init": "''" },
            "held": { "type": "bool", "init": "false" },
            "at": { "type": "vec2", "init": "vec(0.0, 0.0)" },
            "word": { "type": "string", "init": "''" }
        },
        "inputs": {
            "type_key": { "payload": { "c": "string" }, "from": [{ "key": "any", "with": { "c": "key.char" } }] },
            "thrust": { "payload": { "on": "bool" }, "from": [
                { "key": "Space", "with": { "on": "true" } },
                { "key": "Space", "on": "up", "with": { "on": "false" } }
            ] },
            "aim": { "payload": { "p": "vec2" }, "from": [{ "pointer": "down", "with": { "p": "vec(pointer.x, pointer.y)" } }] },
            "guess": { "payload": { "w": "string" }, "from": [{ "text": "submit", "with": { "w": "upper(text.value)" }, "max_len": 4 }] }
        },
        "rules": [
            { "id": "t", "on": "type_key", "do": [{ "set": "typed", "to": "concat(typed, event.c)" }] },
            { "id": "h", "on": "thrust", "do": [{ "set": "held", "to": "event.on" }] },
            { "id": "a", "on": "aim", "do": [{ "set": "at", "to": "event.p" }] },
            { "id": "g", "on": "guess", "do": [{ "set": "word", "to": "event.w" }] }
        ]
    "#,
    ));
    let mut g = Game::new(prog, 1);
    assert!(g.has_pointer_sources());
    assert!(g.has_source(|t| matches!(t, SourceTrigger::Text(_))));
    assert!(g.key_event("KeyH", "h", true));
    assert!(g.key_event("KeyI", "i", true));
    assert!(g.key_event("Space", " ", true));
    g.step(16.0);
    assert_eq!(get(&g, "typed"), Value::str("hi "));
    assert_eq!(get(&g, "held"), Value::Bool(true));
    assert!(g.key_event("Space", " ", false));
    g.step(16.0);
    assert_eq!(get(&g, "held"), Value::Bool(false));
    assert!(g.pointer_source(PointerPhase::Down, 12.5, 40.0));
    assert!(!g.pointer_source(PointerPhase::Move, 1.0, 1.0));
    assert!(g.text(TextPhase::Submit, "crane"));
    assert!(!g.text(TextPhase::Change, "cr"));
    g.step(16.0);
    assert_eq!(get(&g, "at"), Value::Vec2(12.5, 40.0));
    assert_eq!(get(&g, "word"), Value::str("CRAN"), "max_len 4 applies");
    no_diags(&mut g);
}

#[test]
fn physics_landing_from_json() {
    let prog = compile(&game(
        r#"
        "types": {
            "Body": { "x": "float", "y": "float", "vx": "float", "vy": "float", "w": "float", "h": "float" },
            "Box": { "x": "float", "y": "float", "w": "float", "h": "float" }
        },
        "state": {
            "player": { "type": "Body", "init": "{x: 100.0, y: 100.0, vx: 0.0, vy: 0.0, w: 20.0, h: 20.0}" },
            "floor": { "type": "list<Box>", "init": "[{x: 100.0, y: 400.0, w: 200.0, h: 20.0}]" },
            "lands": { "type": "int", "init": "0" },
            "last_ny": { "type": "float", "init": "0.0" }
        },
        "events": { "land": { "a": "int", "b": "int", "nx": "float", "ny": "float" } },
        "rules": [
            { "id": "l", "on": "land", "do": [{ "incr": "lands" }, { "set": "last_ny", "to": "event.ny" }] }
        ],
        "physics": {
            "gravity": [0, 1200],
            "bounds": [0, 0, 360, 640],
            "bodies": {
                "player": { "state": "player", "bounded": true },
                "floor": { "state": "floor", "static": true }
            },
            "collisions": [{ "a": "player", "b": "floor", "solid": true, "emit": "land" }]
        }
    "#,
    ));
    let mut g = Game::new(prog, 1);
    for _ in 0..90 {
        g.step(16.0);
    }
    no_diags(&mut g);
    let p = get(&g, "player");
    assert!((field(&p, &g, "player", "y") - 380.0).abs() < 1e-9);
    assert_eq!(field(&p, &g, "player", "vy"), 0.0);
    assert_eq!(get(&g, "last_ny"), Value::Float(-1.0));
    assert!(matches!(get(&g, "lands"), Value::Int(n) if n > 30));
    let f = fired(&mut g);
    assert!(f.iter().any(|x| matches!(x.on, EventRef::Event(_))));
}

// ───────────────────────── example games (v0.2) ─────────────────────────

const EXAMPLES: [&str; 7] =
    ["gust_glider", "lantern_ridge", "orbit_warden", "prism_breaker", "word_rain", "gull_rock", "meteor_dodge"];

/// Example games are edited by others; a missing or non-compiling one is
/// skipped with a note (mg-cli's tests own their validity).
fn load_example(name: &str) -> Option<Rc<Program>> {
    let path = format!("{}/../../examples/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let src = std::fs::read_to_string(&path).ok()?;
    match mg_lang::compile(&src) {
        Ok(c) => Some(Rc::new(c.program)),
        Err(d) => {
            eprintln!("skipping {name}: does not compile ({} diagnostics)", d.len());
            None
        }
    }
}

/// Random play: every kind of source the game declares, at random.
fn random_turn(g: &mut Game, rng: &mut Rng, keys: &[String]) {
    match rng.below(12) {
        0 if !keys.is_empty() => {
            let k = &keys[rng.below(keys.len() as u64) as usize];
            g.key_event(k, "", true);
        }
        1 if !keys.is_empty() => {
            let k = &keys[rng.below(keys.len() as u64) as usize];
            g.key_event(k, "", false);
        }
        2 => {
            let c = (b'a' + rng.below(26) as u8) as char;
            g.key_event(&format!("Key{}", c.to_ascii_uppercase()), &c.to_string(), true);
        }
        3 | 4 => {
            let (x, y) = (rng.below(360) as f64, rng.below(640) as f64);
            let ph = [PointerPhase::Down, PointerPhase::Move, PointerPhase::Up][rng.below(3) as usize];
            g.pointer_source(ph, x, y);
        }
        5 => {
            let w = ["cat", "rain", "storm", "x", ""][rng.below(5) as usize];
            g.text(if rng.below(2) == 0 { TextPhase::Submit } else { TextPhase::Change }, w);
        }
        _ => {}
    }
    g.step(16.0 + rng.below(4) as f64);
}

fn source_keys(prog: &Program) -> Vec<String> {
    let mut keys: Vec<String> = prog
        .inputs
        .iter()
        .flat_map(|d| d.sources.iter())
        .filter_map(|s| match &s.trigger {
            SourceTrigger::Key { code: Some(c), .. } => Some(c.to_string()),
            _ => None,
        })
        .collect();
    keys.sort();
    keys.dedup();
    keys
}

fn run(prog: &Rc<Program>, seed: u64, steps: usize) -> (u64, Phase, Vec<mg_core::Diagnostic>) {
    let keys = source_keys(prog);
    let mut g = Game::new(prog.clone(), seed);
    let mut rng = Rng::new(seed ^ 0x5eed);
    let mut diags = Vec::new();
    for _ in 0..steps {
        random_turn(&mut g, &mut rng, &keys);
        diags.extend(g.take_diagnostics());
        if g.phase() != Phase::Playing {
            break;
        }
    }
    (g.state_hash(), g.phase(), diags)
}

#[test]
fn examples_random_play_is_clean_and_deterministic() {
    for name in EXAMPLES {
        let Some(prog) = load_example(name) else { continue };
        let mut ended = 0;
        for seed in 0..12 {
            let (h, phase, d) = run(&prog, seed, 1500);
            let bad: Vec<_> = d.iter().filter(|d| d.code == Code::Runtime).collect();
            assert!(bad.is_empty(), "{name} seed {seed}: {bad:#?}");
            assert_eq!(run(&prog, seed, 1500).0, h, "{name} seed {seed} is not deterministic");
            if phase != Phase::Playing {
                ended += 1;
            }
        }
        eprintln!("{name}: {ended}/12 random games ended within 1500 steps");
    }
}

// ───────────────────────────── benchmark ─────────────────────────────

fn bench_example(name: &str, flap_every: u64) {
    let Some(prog) = load_example(name) else { return };
    let keys = source_keys(&prog);
    let mut rng = Rng::new(7);
    let (mut steps, mut games) = (0u64, 0u64);
    let mut worst = 0f64;
    let start = Instant::now();
    while start.elapsed().as_secs_f64() < 2.0 {
        let mut g = Game::new(prog.clone(), rng.next_u64());
        games += 1;
        for k in 0..3000u64 {
            if k % flap_every == 0 {
                if let Some(key) = keys.first() {
                    g.key_event(key, "", true);
                }
                g.pointer_source(PointerPhase::Down, 180.0, 320.0);
            } else if rng.below(16) == 0 {
                random_turn(&mut g, &mut rng, &keys);
                steps += 1;
                continue;
            }
            let t0 = Instant::now();
            g.step(16.0);
            worst = worst.max(t0.elapsed().as_secs_f64());
            steps += 1;
            if g.phase() != Phase::Playing {
                break;
            }
        }
    }
    let secs = start.elapsed().as_secs_f64();
    eprintln!(
        "{name:>14}: {:>6.2} µs/step avg (incl. setup), worst {:>6.1} µs; {steps} steps, {games} games",
        secs * 1e6 / steps as f64,
        worst * 1e6
    );
}

#[test]
#[ignore]
fn bench() {
    bench_example("gust_glider", 24);
    for name in EXAMPLES {
        if name != "gust_glider" {
            bench_example(name, 30);
        }
    }
}

/// Regression: hundreds of physics contact events in one step used to use up
/// the event budget and starve `tick`, and reported the overflow twice with a
/// wrong count. Tick must always run once per step; overflow is reported once.
#[test]
fn physics_event_burst_does_not_starve_tick() {
    let prog = compile(CAP_GAME);
    let mut g = Game::new(prog, 1);
    for _ in 0..10 {
        g.step(16.0);
    }
    assert_eq!(get(&g, "ticks"), Value::Int(10));
    let limits: Vec<_> = g.take_diagnostics().into_iter().filter(|d| d.code == Code::Limit).collect();
    assert!(!limits.is_empty(), "300 resting contacts per step should overflow the 256-event budget");
    assert!(limits.len() <= 10, "at most one E_LIMIT per step, got {}", limits.len());
    assert!(limits.iter().all(|d| !d.message.contains(" 0 queued")), "{:?}", limits[0].message);
}

const CAP_GAME: &str = r#"{
  "format": "microgame/0.2",
  "meta": { "title": "p", "instructions": "", "duration_s": 5 },
  "types": { "B": { "x": "float", "y": "float", "vx": "float", "vy": "float", "r": "float" }, "W": { "x": "float", "y": "float", "w": "float", "h": "float" } },
  "state": {
    "balls": { "type": "list<B>", "init": "map(range(300), i => {x: 5.0 + i, y: 180.0, vx: 0.0, vy: 0.0, r: 2.0})" },
    "floor": { "type": "W", "init": "{x: 200.0, y: 190.0, w: 400.0, h: 20.0}" },
    "lands": { "type": "int", "init": "0" }, "ticks": { "type": "int", "init": "0" }
  },
  "events": { "land": { "a": "int" } },
  "rules": [ { "id": "l", "on": "land", "do": [ { "incr": "lands" } ] }, { "id": "t", "on": "tick", "do": [ { "incr": "ticks" } ] } ],
  "physics": { "gravity": [0, 1000], "bodies": { "balls": { "state": "balls" }, "floor": { "state": "floor", "static": true } },
    "collisions": [ { "a": "balls", "b": "floor", "solid": true, "emit": "land" } ] },
  "objectives": { "time_limit": "2s", "on_timeout": "win" },
  "presentation": { "canvas": { "w": 400, "h": 200 }, "root": { "node": "circle", "x": 0, "y": 0, "r": 1 } }
}"#;
