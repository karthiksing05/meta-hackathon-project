//! Runs the Part C fixtures through `mg_lang::compile` and the runtime.
//!
//! Benchmark (release):
//! `cargo test -p mg-runtime --release --test fixtures -- --ignored --nocapture bench`

use std::rc::Rc;
use std::time::Instant;

use mg_core::ir::{Expr, Program};
use mg_core::rng::Rng;
use mg_core::scene::EventRef;
use mg_core::Value;
use mg_runtime::eval::{eval_pure, Locals, PureEnv};
use mg_runtime::{Fired, Game, Phase};

fn load(name: &str) -> Rc<Program> {
    let path = format!("{}/../../fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let json = std::fs::read_to_string(&path).unwrap();
    match mg_lang::compile(&json) {
        Ok(c) => Rc::new(c.program),
        Err(d) => panic!("{name} failed to compile: {d:#?}"),
    }
}

fn sid(g: &Game, name: &str) -> usize {
    g.program().state_index(name).unwrap_or_else(|| panic!("no state {name}")) as usize
}

fn get(g: &Game, name: &str) -> Value {
    g.state()[sid(g, name)].clone()
}

fn grid_cells(v: &Value) -> (i32, i32, Vec<Value>) {
    match v {
        Value::Grid(g) => (g.w, g.h, g.cells.clone()),
        _ => panic!("not a grid: {v}"),
    }
}

fn no_diags(g: &mut Game) {
    let d = g.take_diagnostics();
    assert!(d.is_empty(), "unexpected diagnostics: {d:#?}");
}

// ───────────────────────────── Lights Out ─────────────────────────────

fn lights(g: &Game) -> u32 {
    let (w, _, cells) = grid_cells(&get(g, "board"));
    assert_eq!(w, 5);
    cells.iter().enumerate().fold(0, |m, (i, v)| if *v == Value::Bool(true) { m | 1 << i } else { m })
}

fn press_mask(x: i32, y: i32) -> u32 {
    let mut m = 0;
    for (dx, dy) in [(0, 0), (0, -1), (1, 0), (0, 1), (-1, 0)] {
        let (cx, cy) = (x + dx, y + dy);
        if (0..5).contains(&cx) && (0..5).contains(&cy) {
            m |= 1 << (cy * 5 + cx);
        }
    }
    m
}

/// Solves Lights Out over GF(2): which cells to press to clear `board`.
fn solve(board: u32) -> Vec<(i32, i32)> {
    // Rows: equation per cell; columns 0..25 = presses, bit 25 = target.
    let mut rows: Vec<u64> = (0..25)
        .map(|cell| {
            let mut r = 0u64;
            for p in 0..25 {
                if press_mask(p % 5, p / 5) >> cell & 1 == 1 {
                    r |= 1 << p;
                }
            }
            r | ((board as u64 >> cell & 1) << 25)
        })
        .collect();
    let mut pivots = vec![];
    let mut r = 0;
    for c in 0..25 {
        let Some(p) = (r..25).find(|&i| rows[i] >> c & 1 == 1) else { continue };
        rows.swap(r, p);
        for i in 0..25 {
            if i != r && rows[i] >> c & 1 == 1 {
                rows[i] ^= rows[r];
            }
        }
        pivots.push(c);
        r += 1;
    }
    for row in &rows[r..] {
        assert_eq!(row >> 25 & 1, 0, "unsolvable board");
    }
    let mut out = vec![];
    for (i, &c) in pivots.iter().enumerate() {
        if rows[i] >> 25 & 1 == 1 {
            out.push((c % 5, c / 5));
        }
    }
    out
}

#[test]
fn lights_out() {
    let prog = load("lights_out");
    let tap = prog.input_index("tap_cell").unwrap();
    let mut g = Game::new(prog.clone(), 42);
    no_diags(&mut g);
    let b0 = lights(&g);
    assert_ne!(b0, 0, "the scramble turned some lights on");
    assert_eq!(get(&g, "moves"), Value::Int(0));

    // Same seed → same scramble; different seeds → different scrambles.
    assert_eq!(lights(&Game::new(prog.clone(), 42)), b0);
    let others: Vec<u32> = (1..6).map(|s| lights(&Game::new(prog.clone(), s))).collect();
    assert!(others.iter().any(|&b| b != b0));

    // A tap toggles the plus shape (clipped at the edge).
    g.input(tap, vec![Value::IVec2(0, 0)]);
    g.step(16.0);
    assert_eq!(lights(&g), b0 ^ press_mask(0, 0));
    g.input(tap, vec![Value::IVec2(2, 3)]);
    g.step(16.0);
    assert_eq!(lights(&g), b0 ^ press_mask(0, 0) ^ press_mask(2, 3));
    assert_eq!(get(&g, "moves"), Value::Int(2));
    let mut f: Vec<Fired> = vec![];
    g.drain_fired(&mut f);
    assert_eq!(f.len(), 2);
    assert_eq!(f[0].on, EventRef::Input(tap));
    assert_eq!(&*f[0].payload, &[Value::IVec2(0, 0), Value::Int(16)]);

    // Solve it → win, with the score from `max(0, 1000 - moves * 20)`.
    let presses = solve(lights(&g));
    for &(x, y) in &presses {
        g.input(tap, vec![Value::IVec2(x, y)]);
    }
    g.step(16.0);
    assert_eq!(lights(&g), 0);
    assert_eq!(g.phase(), Phase::Won);
    let moves = 2 + presses.len() as i64;
    assert_eq!(g.status().score, Some((1000 - moves * 20).max(0) as f64));
    g.drain_fired(&mut f);
    assert_eq!(f.last().unwrap().on, EventRef::Win);
    no_diags(&mut g);
}

#[test]
fn lights_out_timeout() {
    let prog = load("lights_out");
    let mut g = Game::new(prog, 1);
    for _ in 0..90 {
        g.step(1000.0);
    }
    assert_eq!(g.phase(), Phase::Lost);
    assert_eq!(g.now_ms(), 90_000);
}

// ───────────────────────────── Snake ─────────────────────────────

fn snake(g: &Game) -> Vec<(i32, i32)> {
    match get(g, "snake") {
        Value::List(l) => l
            .iter()
            .map(|v| match v {
                Value::IVec2(x, y) => (*x, *y),
                _ => panic!(),
            })
            .collect(),
        v => panic!("{v}"),
    }
}

#[test]
fn snake_moves_eats_and_dies() {
    let prog = load("snake");
    let mut g = Game::new(prog.clone(), 7);
    no_diags(&mut g);
    assert_eq!(snake(&g), vec![(4, 7), (3, 7), (2, 7)]);
    g.step(149.0);
    assert_eq!(snake(&g), vec![(4, 7), (3, 7), (2, 7)]);
    g.step(1.0);
    assert_eq!(snake(&g), vec![(5, 7), (4, 7), (3, 7)], "moves every 150 ms");

    // Food at (10, 7): five more moves right to eat it.
    for _ in 0..5 {
        g.step(150.0);
    }
    assert_eq!(snake(&g)[0], (10, 7));
    assert_eq!(snake(&g).len(), 4, "grew");
    assert_eq!(get(&g, "score"), Value::Int(1));
    let food = get(&g, "food");
    assert!(!snake(&g).iter().any(|&(x, y)| Value::IVec2(x, y) == food), "new food is off the snake");
    assert_eq!(g.status().score, Some(1.0));

    // Two quick steers inside one tick can't reverse: up is taken, then left
    // is rejected because the guard compares with the committed `dir` (right).
    assert!(g.key("ArrowUp"));
    assert!(g.key("ArrowLeft"));
    g.step(1.0);
    assert_eq!(get(&g, "next_dir"), Value::IVec2(0, -1));
    g.step(149.0);
    assert_eq!(snake(&g)[0], (10, 6));
    assert_eq!(get(&g, "dir"), Value::IVec2(0, -1));

    // Keep going up into the wall: y 6 → 0 then out.
    for _ in 0..6 {
        g.step(150.0);
    }
    assert_eq!(snake(&g)[0], (10, 0));
    assert_eq!(g.phase(), Phase::Playing);
    let before = snake(&g);
    g.step(150.0);
    assert_eq!(g.phase(), Phase::Lost);
    assert_eq!(snake(&g), before, "`end` stopped the rule before the move");
    let mut f = vec![];
    g.drain_fired(&mut f);
    assert_eq!(f.last().unwrap().on, EventRef::Lose);
    no_diags(&mut g);

    // Swipes map through `swipe.dir`.
    let mut g = Game::new(prog, 7);
    assert!(g.swipe(0, 1));
    g.step(150.0);
    assert_eq!(snake(&g)[0], (4, 8));
}

// ───────────────────────────── Number Merge ─────────────────────────────

fn board(g: &Game) -> Vec<i64> {
    grid_cells(&get(g, "board")).2.iter().map(|v| v.as_int().unwrap()).collect()
}

fn set_board(g: &mut Game, cells: &[i64]) {
    let id = sid(g, "board") as u16;
    g.set_state_var(id, Value::grid(4, 4, cells.iter().map(|&v| Value::Int(v)).collect()));
}

#[test]
fn number_merge_rules() {
    let prog = load("number_merge");
    let slide = prog.input_index("slide").unwrap();
    let spawn = prog.event_index("spawn_tile").unwrap();
    let mut g = Game::new(prog.clone(), 3);
    no_diags(&mut g);
    let b = board(&g);
    assert_eq!(b.iter().filter(|&&v| v != 0).count(), 2, "two tiles at start");
    assert!(b.iter().all(|&v| v == 0 || v == 2 || v == 4));

    // merge_line([2,2,2,2]) == {cells: [4,4,0,0], gained: 8}
    let f = prog.functions.iter().position(|f| &*f.name == "merge_line").unwrap() as u16;
    let env = PureEnv { program: &prog, state: g.state(), now_ms: 0, phase: Phase::Playing, event: &[] };
    let mut l = Locals::new();
    let call = |l: &mut Locals, xs: &[i64]| {
        let arg = Expr::Const(Value::list(xs.iter().map(|&v| Value::Int(v)).collect()));
        eval_pure(&env, l, &Expr::Call(f, vec![arg].into_boxed_slice())).unwrap()
    };
    // MergeResult fields sorted by name: cells = 0, gained = 1.
    let r = call(&mut l, &[2, 2, 2, 2]);
    assert_eq!(r, Value::record(vec![Value::list(vec![4, 4, 0, 0].into_iter().map(Value::Int).collect()), Value::Int(8)]));
    let r = call(&mut l, &[0, 4, 4, 8]);
    assert_eq!(r, Value::record(vec![Value::list(vec![8, 8, 0, 0].into_iter().map(Value::Int).collect()), Value::Int(8)]));

    // Slide left on [2,2,2,2] row → [4,4,0,0], +8 score, then one spawn.
    set_board(&mut g, &[2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    let mut fired = vec![];
    g.drain_fired(&mut fired);
    assert_eq!(fired.iter().filter(|f| f.on == EventRef::Event(spawn)).count(), 2, "two spawns at start");
    fired.clear();
    assert!(g.key("ArrowLeft"));
    g.step(16.0);
    let b = board(&g);
    assert_eq!(&b[..2], &[4, 4]);
    assert_eq!(get(&g, "score"), Value::Int(8));
    assert_eq!(b.iter().filter(|&&v| v != 0).count(), 3, "one tile spawned after the slide");
    let sum: i64 = b.iter().sum();
    assert!(sum == 10 || sum == 12, "the spawn adds a 2 or a 4: {b:?}");
    g.drain_fired(&mut fired);
    let ons: Vec<EventRef> = fired.iter().map(|f| f.on).collect();
    assert_eq!(ons, vec![EventRef::Input(slide), EventRef::Event(spawn)]);

    // A slide that changes nothing does not spawn.
    set_board(&mut g, &[2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    g.key("ArrowLeft");
    g.step(16.0);
    assert_eq!(board(&g), vec![2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    // Lose once no moves are left (after the spawn fills the last hole).
    #[rustfmt::skip]
    set_board(&mut g, &[
        2, 4, 2, 4,
        4, 2, 4, 2,
        16, 4, 2, 4,
        8, 16, 8, 0,
    ]);
    g.key("ArrowRight");
    g.step(16.0);
    let b = board(&g);
    assert_eq!(&b[12..], &[b[12], 8, 16, 8]);
    assert!(b[12] == 2 || b[12] == 4);
    assert_eq!(g.phase(), Phase::Lost);
    no_diags(&mut g);
}

#[test]
fn number_merge_win() {
    let prog = load("number_merge");
    let mut g = Game::new(prog, 3);
    set_board(&mut g, &[64, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    g.key("ArrowLeft");
    g.step(16.0);
    assert_eq!(g.phase(), Phase::Won);
}

// ───────────────────────────── random play ─────────────────────────────

const KEYS: [&str; 4] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

/// One random input (or none) and one ~frame step.
fn random_turn(g: &mut Game, rng: &mut Rng, tap: Option<u16>) {
    match rng.below(4) {
        0 => {
            g.key(KEYS[rng.below(4) as usize]);
        }
        1 => {
            let d = [(0, -1), (0, 1), (-1, 0), (1, 0)][rng.below(4) as usize];
            g.swipe(d.0, d.1);
        }
        2 => {
            if let Some(t) = tap {
                g.input(t, vec![Value::IVec2(rng.below(5) as i32, rng.below(5) as i32)]);
            }
        }
        _ => {}
    }
    g.step(16.0 + rng.below(20) as f64);
}

fn hash_run(prog: &Rc<Program>, seed: u64, turns: usize) -> (u64, Phase) {
    let tap = prog.input_index("tap_cell");
    let mut g = Game::new(prog.clone(), seed);
    let mut rng = Rng::new(seed ^ 0xabcdef);
    for _ in 0..turns {
        random_turn(&mut g, &mut rng, tap);
        if g.phase() != Phase::Playing {
            break;
        }
    }
    let d = g.take_diagnostics();
    assert!(d.is_empty(), "seed {seed}: {d:#?}");
    (g.state_hash(), g.phase())
}

#[test]
fn random_play_has_no_runtime_errors_and_is_deterministic() {
    for name in ["lights_out", "snake", "number_merge"] {
        let prog = load(name);
        let mut ended = 0;
        for seed in 0..50 {
            let (h, phase) = hash_run(&prog, seed, 1000);
            assert_eq!(hash_run(&prog, seed, 1000).0, h, "{name} seed {seed} is not deterministic");
            if phase != Phase::Playing {
                ended += 1;
            }
        }
        eprintln!("{name}: {ended}/50 random games ended within 1000 turns");
    }
}

// ───────────────────────────── benchmark ─────────────────────────────

fn bench_game(name: &str) {
    let prog = load(name);
    let tap = prog.input_index("tap_cell");
    let mut rng = Rng::new(99);
    let mut steps = 0u64;
    let mut inputs = 0u64;
    let mut games = 0u64;
    let mut worst = 0f64;
    let mut busy = (0u64, 0f64); // steps that changed state, and their time
    let start = Instant::now();
    while start.elapsed().as_secs_f64() < 2.0 {
        let mut g = Game::new(prog.clone(), rng.next_u64());
        games += 1;
        for _ in 0..2000 {
            if rng.below(8) == 0 {
                let d = [(0, -1), (0, 1), (-1, 0), (1, 0)][rng.below(4) as usize];
                if let Some(t) = tap {
                    g.input(t, vec![Value::IVec2(d.0.max(0) * 2, d.1.max(0) * 3)]);
                } else {
                    g.swipe(d.0, d.1);
                }
                inputs += 1;
            }
            let rev = g.state().to_vec();
            let t0 = Instant::now();
            g.step(16.0);
            let dt = t0.elapsed().as_secs_f64();
            if g.state() != rev.as_slice() {
                busy.0 += 1;
                busy.1 += dt;
            }
            if dt > worst {
                worst = dt;
            }
            steps += 1;
            if g.phase() != Phase::Playing {
                break;
            }
        }
    }
    let secs = start.elapsed().as_secs_f64();
    eprintln!(
        "{name:>13}: {:>9.0} steps/s, {:>5.2} µs/step avg (incl. setup), {:>5.2} µs per state-changing step ({} of them), worst {:>5.1} µs; {games} games, {inputs} inputs",
        steps as f64 / secs,
        secs * 1e6 / steps as f64,
        busy.1 * 1e6 / busy.0.max(1) as f64,
        busy.0,
        worst * 1e6
    );
}

#[test]
#[ignore]
fn bench() {
    for name in ["snake", "number_merge", "lights_out"] {
        bench_game(name);
    }
}
