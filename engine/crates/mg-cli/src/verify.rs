//! `microgame verify`: replays a `microgame-log/1` input log (recorded by the
//! WASM build, `mg_log`) natively and checks its claimed result.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::rc::Rc;

use mg_core::Program;
use mg_scene::Player;
use mg_wasm::log::{final_json, game_hash, parse_log, replay_calls};
use serde_json::{json, Value as J};

#[derive(Clone, Debug)]
pub struct Verdict {
    pub ok: bool,
    /// What the replay produced: `{state_hash, phase, score, time_ms}`.
    pub recomputed: J,
    /// What the log claims (`final`).
    pub claimed: J,
    pub game_hash_ok: bool,
    pub steps: u64,
    /// Every reason it failed (empty when ok).
    pub problems: Vec<String>,
}

impl Verdict {
    pub fn to_json(&self) -> J {
        json!({
            "ok": self.ok, "game_hash_ok": self.game_hash_ok, "steps": self.steps,
            "recomputed": self.recomputed, "claimed": self.claimed, "problems": self.problems,
        })
    }
}

/// `game_text` must be the exact game file the log was recorded with.
pub fn verify(game_text: &str, program: &Rc<Program>, log_text: &str) -> Result<Verdict, String> {
    let log = parse_log(log_text)?;
    let mut problems = Vec::new();
    let want_hash = crate::hex64(game_hash(game_text));
    let game_hash_ok = log.game_hash == want_hash;
    if !game_hash_ok {
        problems.push(format!("game_hash {} doesn't match this game file ({want_hash})", log.game_hash));
    }
    let run = catch_unwind(AssertUnwindSafe(|| {
        let mut player = Player::new(program.clone(), log.seed);
        let r = replay_calls(&mut player, &log.calls);
        (r, final_json(&player))
    }));
    let (steps, recomputed) = match run {
        Ok((Ok(steps), fin)) => (steps, fin),
        Ok((Err(e), fin)) => {
            problems.push(e);
            (0, fin)
        }
        Err(p) => {
            problems.push(format!("engine panic: {}", crate::panic_message(&*p)));
            (0, J::Null)
        }
    };
    for key in ["state_hash", "phase", "score", "time_ms"] {
        let (a, b) = (&log.final_[key], &recomputed[key]);
        if !same(a, b) {
            problems.push(format!("final.{key}: log says {a}, replay gives {b}"));
        }
    }
    Ok(Verdict { ok: problems.is_empty(), recomputed, claimed: log.final_, game_hash_ok, steps, problems })
}

/// JSON equality, with numbers compared as f64 (so `900` == `900.0`).
fn same(a: &J, b: &J) -> bool {
    match (a.as_f64(), b.as_f64()) {
        (Some(x), Some(y)) => x == y,
        _ => a == b,
    }
}
