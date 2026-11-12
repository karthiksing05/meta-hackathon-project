//! Headless simulation with random valid inputs (spec B5 `simulate`).

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::rc::Rc;

use mg_core::hash::splitmix64;
use mg_core::ir::SourceTrigger;
use mg_core::rng::Rng;
use mg_core::{Diagnostic, Program};
use mg_runtime::Phase;
use mg_scene::{Player, PointerKind};

use crate::panic_message;

/// What a random player can do in a game.
#[derive(Clone, Debug, Default)]
pub struct Controls {
    /// Every `{"key": ...}` source, deduplicated, in declaration order.
    pub keys: Vec<Rc<str>>,
    /// True if any input has a swipe source.
    pub swipe: bool,
    pub canvas: (f64, f64),
}

impl Controls {
    pub fn of(p: &Program) -> Controls {
        let mut c = Controls { canvas: (p.presentation.canvas.w, p.presentation.canvas.h), ..Default::default() };
        for input in &p.inputs {
            for s in &input.sources {
                match &s.trigger {
                    SourceTrigger::Key(k) => {
                        if !c.keys.contains(k) {
                            c.keys.push(k.clone());
                        }
                    }
                    SourceTrigger::Swipe(_) => c.swipe = true,
                }
            }
        }
        c
    }
}

pub const SWIPES: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

/// Sends random valid inputs: taps at random points inside the current hit
/// targets (and drags for draggable ones), keys from every key source,
/// swipes in 4 directions, and the odd tap that misses everything.
pub struct RandomDriver {
    pub rng: Rng,
    pub controls: Controls,
    pub dt: f64,
}

impl RandomDriver {
    pub fn new(program: &Program, seed: u64, dt: f64) -> RandomDriver {
        RandomDriver { rng: Rng::new(splitmix64(seed ^ 0x1D_C0DE)), controls: Controls::of(program), dt }
    }

    fn unit(&mut self) -> f64 {
        self.rng.next_f64()
    }

    /// Applies one random input. Drags step the game between pointer events.
    pub fn act(&mut self, player: &mut Player) {
        let targets = player.hit_targets();
        let w_tap = if targets.is_empty() { 0 } else { 6 };
        let w_key = if self.controls.keys.is_empty() { 0 } else { 4 };
        let w_swipe = if self.controls.swipe { 4 } else { 0 };
        let w_miss = 1;
        let roll = self.rng.below((w_tap + w_key + w_swipe + w_miss) as u64) as i32;
        if roll < w_tap {
            let t = &targets[self.rng.below(targets.len() as u64) as usize];
            let x = t.x + t.w * (0.05 + 0.9 * self.unit());
            let y = t.y + t.h * (0.05 + 0.9 * self.unit());
            player.pointer(PointerKind::Down, x, y);
            if t.drag {
                let moves = 1 + self.rng.below(4);
                for _ in 0..moves {
                    player.step(self.dt);
                    let (mx, my) = (self.unit() * self.controls.canvas.0, self.unit() * self.controls.canvas.1);
                    player.pointer(PointerKind::Move, mx, my);
                }
                let (ux, uy) = (self.unit() * self.controls.canvas.0, self.unit() * self.controls.canvas.1);
                player.pointer(PointerKind::Up, ux, uy);
            } else {
                player.pointer(PointerKind::Up, x, y);
            }
        } else if roll < w_tap + w_key {
            let k = self.controls.keys[self.rng.below(self.controls.keys.len() as u64) as usize].clone();
            player.key(&k);
        } else if roll < w_tap + w_key + w_swipe {
            let (dx, dy) = SWIPES[self.rng.below(4) as usize];
            player.swipe(dx, dy);
        } else {
            let (x, y) = (self.unit() * self.controls.canvas.0, self.unit() * self.controls.canvas.1);
            player.pointer(PointerKind::Down, x, y);
            player.pointer(PointerKind::Up, x, y);
        }
    }
}

#[derive(Clone, Debug)]
pub struct SimOptions {
    pub seed: u64,
    pub seeds: u32,
    pub inputs: u32,
    pub dt: f64,
    /// Restart (with a derived seed) when a game ends, so every input is used.
    pub restart_on_end: bool,
}

impl Default for SimOptions {
    fn default() -> Self {
        SimOptions { seed: 1, seeds: 1, inputs: 1000, dt: 16.0, restart_on_end: true }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct EndInfo {
    pub phase: Phase,
    pub time_ms: i64,
    /// Inputs sent before the end.
    pub after_inputs: u32,
}

#[derive(Clone, Debug)]
pub struct SeedReport {
    pub seed: u64,
    /// The first game's end (the one started with `seed`).
    pub first_end: Option<EndInfo>,
    /// Games that ended, including restarts.
    pub won: u32,
    pub lost: u32,
    pub steps: u64,
    pub errors: Vec<Diagnostic>,
    /// An engine panic (a bug in the engine, not in the game).
    pub panic: Option<String>,
    pub final_hash: u64,
}

impl SeedReport {
    pub fn error_count(&self) -> usize {
        self.errors.iter().filter(|d| d.is_error()).count() + self.panic.is_some() as usize
    }
}

/// Runs one seed. Never panics: engine panics are caught and reported.
pub fn simulate_seed(program: &Rc<Program>, seed: u64, opts: &SimOptions) -> SeedReport {
    let mut rep = SeedReport {
        seed,
        first_end: None,
        won: 0,
        lost: 0,
        steps: 0,
        errors: Vec::new(),
        panic: None,
        final_hash: 0,
    };
    let r = catch_unwind(AssertUnwindSafe(|| run_seed(program, seed, opts, &mut rep)));
    if let Err(p) = r {
        rep.panic = Some(panic_message(&*p));
    }
    rep
}

fn run_seed(program: &Rc<Program>, seed: u64, opts: &SimOptions, rep: &mut SeedReport) {
    let mut player = Player::new(program.clone(), seed);
    let mut driver = RandomDriver::new(program, seed, opts.dt);
    let mut games = 1u64;
    let mut diags = mg_wasm::RuntimeDiags::default();
    player.frame();
    rep.errors.extend(diags.take(&mut player));
    for i in 0..opts.inputs {
        if player.game.phase() == Phase::Playing {
            driver.act(&mut player);
        }
        let n = 1 + driver.rng.below(6);
        for _ in 0..n {
            player.step(opts.dt);
            rep.steps += 1;
            if player.game.phase() != Phase::Playing {
                break;
            }
        }
        player.frame();
        rep.errors.extend(diags.take(&mut player));
        let st = player.status();
        if st.phase != Phase::Playing {
            match st.phase {
                Phase::Won => rep.won += 1,
                _ => rep.lost += 1,
            }
            if rep.first_end.is_none() {
                rep.first_end = Some(EndInfo { phase: st.phase, time_ms: st.time_ms, after_inputs: i + 1 });
            }
            if !opts.restart_on_end {
                break;
            }
            player.restart(splitmix64(seed.wrapping_add(games)));
            games += 1;
            player.frame();
            rep.errors.extend(diags.take(&mut player));
        }
    }
    rep.final_hash = player.game.state_hash();
}

pub fn simulate(program: &Rc<Program>, opts: &SimOptions) -> Vec<SeedReport> {
    (0..opts.seeds.max(1)).map(|k| simulate_seed(program, opts.seed.wrapping_add(k as u64), opts)).collect()
}
