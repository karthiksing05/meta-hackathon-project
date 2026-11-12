//! `microgame`: validate, simulate, replay and benchmark game files (spec B5).
//!
//! Exit codes: 0 ok, 1 the game has errors (validation or runtime), 2 usage
//! or IO problems.

use std::process::ExitCode;
use std::rc::Rc;

use mg_cli::args::{self, Args};
use mg_cli::sim::{simulate, SimOptions};
use mg_cli::{bench, hex64, replay, report};
use mg_core::{Diagnostic, Program};
use serde_json::json;

const USAGE: &str = "\
microgame: check and run microgame/0.1 game files

usage:
  microgame validate <game.json> [--json]
  microgame simulate <game.json> [--seed N] [--random-inputs N] [--seeds K] [--dt MS] [--no-restart] [--json]
  microgame replay   <game.json> --script <inputs.json> [--seed N] [--dt MS] [--tail MS] [--state] [--json]
  microgame bench    <game.json> [--seed N] [--steps N] [--dt MS] [--json]

validate   Prints every diagnostic. Exit 0 if there are no errors, 1 if there are.
simulate   Plays K seeds (default 1) starting at N (default 1) with N random inputs
           (default 1000): taps on tappable nodes, keys, swipes. Steps 1-6 times
           (dt 16 ms) between inputs and restarts a game when it ends. Reports
           runtime errors, wins and losses, and the final state hash.
replay     Plays a script of timed inputs and prints the final status and hash.
           Entries: {\"t\": ms, \"key\": \"ArrowUp\"}, {\"t\": ms, \"swipe\": \"left\"},
           {\"t\": ms, \"tap\": [x, y]}, {\"t\": ms, \"input\": \"name\", \"with\": {...}},
           {\"t\": ms} (wait). --tail (default 16) steps on after the last entry.
bench      Steps per second, and microseconds per step, frame build and encode.

Seeds default to meta.seed when the file has one.";

enum Fail {
    Usage(String),
    Io(String),
    Invalid,
}

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = argv.first() else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    let rest = &argv[1..];
    let r = match cmd.as_str() {
        "validate" => cmd_validate(rest),
        "simulate" | "sim" => cmd_simulate(rest),
        "replay" => cmd_replay(rest),
        "bench" => cmd_bench(rest),
        "help" | "--help" | "-h" => {
            println!("{USAGE}");
            Ok(0)
        }
        other => Err(Fail::Usage(format!("unknown command '{other}'"))),
    };
    match r {
        Ok(code) => ExitCode::from(code),
        Err(Fail::Usage(m)) => {
            eprintln!("microgame: {m}\n\n{USAGE}");
            ExitCode::from(2)
        }
        Err(Fail::Io(m)) => {
            eprintln!("microgame: {m}");
            ExitCode::from(2)
        }
        Err(Fail::Invalid) => ExitCode::from(1),
    }
}

fn parse(rest: &[String], with_value: &[&str], switches: &[&str]) -> Result<Args, Fail> {
    let a = args::parse(rest, with_value, switches).map_err(Fail::Usage)?;
    if a.pos.len() != 1 {
        return Err(Fail::Usage(if a.pos.is_empty() {
            "missing <game.json>".into()
        } else {
            format!("unexpected argument '{}'", a.pos[1])
        }));
    }
    Ok(a)
}

fn get<T: std::str::FromStr>(a: &Args, name: &str) -> Result<Option<T>, Fail> {
    a.get(name).map_err(Fail::Usage)
}

fn read(path: &str) -> Result<String, Fail> {
    std::fs::read_to_string(path).map_err(|e| Fail::Io(format!("cannot read {path}: {e}")))
}

fn print_diags(diags: &[Diagnostic], source: &str) {
    let doc: Option<serde_json::Value> = serde_json::from_str(source).ok();
    for d in diags {
        eprintln!("{}", report::format_diag(d, doc.as_ref()));
    }
}

/// Reads and compiles; prints diagnostics and fails if the game is invalid.
fn load(path: &str, json_out: bool) -> Result<(String, Rc<Program>), Fail> {
    let source = read(path)?;
    match mg_cli::compile(&source) {
        Ok((p, _warnings)) => Ok((source, p)),
        Err(diags) => {
            if json_out {
                println!("{}", json!({ "ok": false, "diagnostics": diags }));
            } else {
                print_diags(&diags, &source);
                eprintln!("{path}: invalid game ({})", report::summary(&diags));
            }
            Err(Fail::Invalid)
        }
    }
}

fn seed_for(a: &Args, p: &Program) -> Result<u64, Fail> {
    Ok(get::<u64>(a, "seed")?.or(p.meta.seed).unwrap_or(mg_cli::DEFAULT_SEED))
}

fn cmd_validate(rest: &[String]) -> Result<u8, Fail> {
    let a = parse(rest, &[], &["json"])?;
    let path = &a.pos[0];
    let source = read(path)?;
    let diags = mg_lang::validate(&source);
    let errors = diags.iter().filter(|d| d.is_error()).count();
    if a.has("json") {
        println!("{}", serde_json::to_string_pretty(&diags).unwrap_or_default());
    } else {
        print_diags(&diags, &source);
        if errors == 0 {
            println!("{path}: ok ({})", report::summary(&diags));
        } else {
            eprintln!("{path}: invalid ({})", report::summary(&diags));
        }
    }
    Ok(if errors == 0 { 0 } else { 1 })
}

fn cmd_simulate(rest: &[String]) -> Result<u8, Fail> {
    let a = parse(rest, &["seed", "random-inputs", "inputs", "seeds", "dt"], &["json", "no-restart"])?;
    let json_out = a.has("json");
    let (_, program) = load(&a.pos[0], json_out)?;
    let opts = SimOptions {
        seed: seed_for(&a, &program)?,
        seeds: get(&a, "seeds")?.unwrap_or(1),
        inputs: get(&a, "random-inputs")?.or(get(&a, "inputs")?).unwrap_or(1000),
        dt: get(&a, "dt")?.unwrap_or(16.0),
        restart_on_end: !a.has("no-restart"),
    };
    if opts.dt.is_nan() || opts.dt <= 0.0 {
        return Err(Fail::Usage("--dt must be > 0".into()));
    }
    let reports = simulate(&program, &opts);
    let errors: usize = reports.iter().map(|r| r.error_count()).sum();
    let won: u32 = reports.iter().map(|r| r.won).sum();
    let lost: u32 = reports.iter().map(|r| r.lost).sum();
    let ended = reports.iter().filter(|r| r.first_end.is_some()).count();

    if json_out {
        let seeds: Vec<_> = reports
            .iter()
            .map(|r| {
                json!({
                    "seed": r.seed,
                    "first_end": r.first_end.as_ref().map(|e| json!({
                        "phase": e.phase.as_str(), "time_ms": e.time_ms, "after_inputs": e.after_inputs })),
                    "won": r.won, "lost": r.lost, "steps": r.steps,
                    "errors": r.errors, "panic": r.panic,
                    "final_hash": hex64(r.final_hash),
                })
            })
            .collect();
        let out = json!({
            "ok": errors == 0,
            "seeds": seeds,
            "summary": { "seeds": reports.len(), "inputs_per_seed": opts.inputs, "runtime_errors": errors,
                         "won": won, "lost": lost, "seeds_reaching_end": ended },
        });
        println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
    } else {
        println!(
            "simulate {}: {} seed(s) from {}, {} random inputs each, dt {} ms",
            a.pos[0],
            reports.len(),
            opts.seed,
            opts.inputs,
            opts.dt
        );
        let verbose = reports.len() <= 10;
        for r in &reports {
            if !verbose && r.error_count() == 0 {
                continue;
            }
            let end = match &r.first_end {
                Some(e) => format!("{} at {:.1}s (after {} inputs)", e.phase.as_str(), e.time_ms as f64 / 1000.0, e.after_inputs),
                None => "no end".into(),
            };
            println!(
                "  seed {}: {end}; ended games: {} won, {} lost; {} runtime errors; hash {}",
                r.seed,
                r.won,
                r.lost,
                r.error_count(),
                hex64(r.final_hash)
            );
            if let Some(p) = &r.panic {
                println!("    PANIC: {p}");
            }
            let mut seen = std::collections::BTreeSet::new();
            for d in &r.errors {
                if seen.insert((d.code.as_str(), d.at.clone(), d.message.clone())) && seen.len() <= 5 {
                    println!("    {}", report::format_diag(d, None).replace('\n', "\n    "));
                }
            }
        }
        println!(
            "summary: {} runtime errors; first game ended in {}/{} seeds; ended games: {} won, {} lost",
            errors,
            ended,
            reports.len(),
            won,
            lost
        );
        if reports.len() == 1 {
            println!("final state hash: {}", hex64(reports[0].final_hash));
        }
    }
    Ok(if errors == 0 { 0 } else { 1 })
}

fn cmd_replay(rest: &[String]) -> Result<u8, Fail> {
    let a = parse(rest, &["seed", "script", "dt", "tail"], &["state", "json"])?;
    let json_out = a.has("json");
    let script_path: String = get(&a, "script")?.ok_or_else(|| Fail::Usage("replay needs --script <inputs.json>".into()))?;
    let (_, program) = load(&a.pos[0], json_out)?;
    let script_src = read(&script_path)?;
    let script = replay::parse_script(&script_src, &program).map_err(|e| Fail::Io(format!("{script_path}: {e}")))?;
    let seed = seed_for(&a, &program)?;
    let dt = get(&a, "dt")?.unwrap_or(16.0);
    let tail = get(&a, "tail")?.unwrap_or(16.0);
    let r = replay::replay(&program, seed, &script, dt, tail);
    let errors = r.errors.iter().filter(|d| d.is_error()).count() + r.panic.is_some() as usize;
    if json_out {
        let mut out = json!({
            "ok": errors == 0,
            "phase": r.status.phase.as_str(), "score": r.status.score, "time_ms": r.status.time_ms,
            "hash": hex64(r.hash), "seed": seed, "steps": r.steps,
            "unmatched_entries": r.unmatched, "errors": r.errors, "panic": r.panic,
        });
        if a.has("state") {
            out["state"] = r.state.clone();
        }
        println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
    } else {
        println!("phase: {}", r.status.phase.as_str());
        println!("score: {}", r.status.score.map_or("none".to_string(), |s| s.to_string()));
        println!("time_ms: {}", r.status.time_ms);
        println!("hash: {}", hex64(r.hash));
        if !r.unmatched.is_empty() {
            println!("warning: entries {:?} matched no input source", r.unmatched);
        }
        if let Some(p) = &r.panic {
            println!("PANIC: {p}");
        }
        for d in &r.errors {
            println!("{}", report::format_diag(d, None));
        }
        if a.has("state") {
            println!("{}", serde_json::to_string_pretty(&r.state).unwrap_or_default());
        }
    }
    Ok(if errors == 0 { 0 } else { 1 })
}

fn cmd_bench(rest: &[String]) -> Result<u8, Fail> {
    let a = parse(rest, &["seed", "steps", "dt"], &["json"])?;
    let json_out = a.has("json");
    let (source, program) = load(&a.pos[0], json_out)?;
    let seed = seed_for(&a, &program)?;
    let steps: u64 = get(&a, "steps")?.unwrap_or(20_000);
    let dt = get(&a, "dt")?.unwrap_or(16.0);
    let b = bench::bench(&source, &program, seed, steps, dt);
    if json_out {
        println!(
            "{}",
            json!({
                "compile_us": b.compile_us, "steps": b.steps, "steps_per_sec": b.steps_per_sec,
                "step_us": b.step_us, "frame_us": b.frame_us, "json_encode_us": b.json_us,
                "bin_encode_us": b.bin_us, "avg_ops": b.avg_ops, "avg_json_bytes": b.avg_json_bytes,
                "avg_bin_bytes": b.avg_bin_bytes, "games": b.games,
            })
        );
    } else {
        println!("bench {}: {} steps of {} ms, {} game(s)", a.pos[0], b.steps, dt, b.games);
        println!("  compile        {:>9.1} µs", b.compile_us);
        println!("  step           {:>9.2} µs   ({:.0} steps/s)", b.step_us, b.steps_per_sec);
        println!("  frame build    {:>9.2} µs   ({:.0} ops/frame)", b.frame_us, b.avg_ops);
        println!("  JSON encode    {:>9.2} µs   ({:.0} bytes/frame)", b.json_us, b.avg_json_bytes);
        println!("  binary encode  {:>9.2} µs   ({:.0} bytes/frame)", b.bin_us, b.avg_bin_bytes);
    }
    Ok(0)
}
