//! `bench`: how fast a game steps, builds frames, and encodes them.
//! Plays with the random driver (one input every 8 steps) and restarts when
//! a game ends, so the numbers reflect a game in progress.

use std::rc::Rc;
use std::time::{Duration, Instant};

use mg_core::hash::splitmix64;
use mg_core::Program;
use mg_runtime::Phase;
use mg_scene::Player;
use mg_wasm::encode::{frame_json, BinEncoder};

use crate::sim::RandomDriver;

#[derive(Clone, Debug)]
pub struct BenchResult {
    pub compile_us: f64,
    pub steps: u64,
    pub step_us: f64,
    pub steps_per_sec: f64,
    pub frame_us: f64,
    pub json_us: f64,
    pub bin_us: f64,
    pub avg_ops: f64,
    pub avg_json_bytes: f64,
    pub avg_bin_bytes: f64,
    pub games: u64,
}

pub fn bench(source: &str, program: &Rc<Program>, seed: u64, steps: u64, dt: f64) -> BenchResult {
    // Compile time: best of a few runs.
    let mut compile = Duration::MAX;
    for _ in 0..5 {
        let t = Instant::now();
        let _ = mg_lang::compile(source);
        compile = compile.min(t.elapsed());
    }

    let mut player = Player::new(program.clone(), seed);
    let mut driver = RandomDriver::new(program, seed, dt);
    let mut enc = BinEncoder::new();
    let mut buf = Vec::with_capacity(1 << 16);
    let (mut t_step, mut t_frame, mut t_json, mut t_bin) = (Duration::ZERO, Duration::ZERO, Duration::ZERO, Duration::ZERO);
    let (mut ops, mut json_bytes, mut bin_bytes) = (0u64, 0u64, 0u64);
    let mut games = 1u64;
    let mut diags = mg_wasm::RuntimeDiags::default();
    player.frame();
    for i in 0..steps {
        if i % 8 == 0 {
            driver.act(&mut player);
        }
        let t = Instant::now();
        player.step(dt);
        t_step += t.elapsed();

        let t = Instant::now();
        let f = player.frame();
        t_frame += t.elapsed();
        ops += f.ops.len() as u64;

        buf.clear();
        let t = Instant::now();
        frame_json(f, &mut buf);
        t_json += t.elapsed();
        json_bytes += buf.len() as u64;

        buf.clear();
        let t = Instant::now();
        enc.encode(f, &mut buf);
        t_bin += t.elapsed();
        bin_bytes += buf.len() as u64;

        let _ = diags.take(&mut player);
        if player.game.phase() != Phase::Playing {
            player.restart(splitmix64(seed.wrapping_add(games)));
            games += 1;
        }
    }
    let n = steps.max(1) as f64;
    let us = |d: Duration| d.as_secs_f64() * 1e6 / n;
    BenchResult {
        compile_us: compile.as_secs_f64() * 1e6,
        steps,
        step_us: us(t_step),
        steps_per_sec: n / t_step.as_secs_f64().max(1e-12),
        frame_us: us(t_frame),
        json_us: us(t_json),
        bin_us: us(t_bin),
        avg_ops: ops as f64 / n,
        avg_json_bytes: json_bytes as f64 / n,
        avg_bin_bytes: bin_bytes as f64 / n,
        games,
    }
}
