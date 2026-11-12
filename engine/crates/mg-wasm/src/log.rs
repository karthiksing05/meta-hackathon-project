//! Input logs for verifiable replays ("challenges").
//!
//! Every call that can affect a game (`step`, pointer, key, key event, swipe,
//! text) is recorded in order from load or restart, plus the frame builds
//! that happen between steps (hit-testing and the camera use the layout of
//! the last built frame, so they matter for pointer input). Replaying the
//! log through the same `Player` API from the same seed gives the same state
//! hash, phase, score and time.
//!
//! Cost while playing: one compare and an increment per step, one `Vec` push
//! per input, and a flag check per frame.
//!
//! JSON (`microgame-log/1`), see `engine/README.md`:
//! ```json
//! {"format": "microgame-log/1", "seed": 7, "game_hash": "…16 hex…",
//!  "calls": [["S", 16.666666666666668, 120], ["p", 120, 0, 180.5, 320], …],
//!  "final": {"state_hash": "…", "phase": "won", "score": 900, "time_ms": 2000}}
//! ```
//! Calls (`step` = how many steps ran before the call):
//! * `["s", dt, n]`: `n` steps of `dt` ms; `["S", dt, n]`: `n` × (step, frame).
//! * `["f"]`: a frame build.
//! * `["p", step, kind, x, y]`: pointer, kind 0 down, 1 move, 2 up.
//! * `["k", step, code]`: `mg_key`.
//! * `["K", step, code, char, down]`: `mg_key_event`, `down` 1 or 0.
//! * `["w", step, dx, dy]`: swipe.
//! * `["t", step, kind, value]`: text, kind 0 submit, 1 change.

use mg_core::hash::StableHasher;
use mg_core::ir::TextPhase;
use mg_scene::{Player, PointerKind};
use serde_json::{json, Value as J};

pub const LOG_FORMAT: &str = "microgame-log/1";

#[derive(Clone, Debug, PartialEq)]
pub enum Call {
    /// `n` steps of `dt`; with `framed`, each step is followed by a frame build.
    Steps { dt: f64, n: u32, framed: bool },
    Frame,
    Pointer { step: u64, kind: u8, x: f64, y: f64 },
    Key { step: u64, code: Box<str> },
    KeyEvent { step: u64, code: Box<str>, ch: Box<str>, down: bool },
    Swipe { step: u64, dx: i32, dy: i32 },
    Text { step: u64, kind: u8, value: Box<str> },
}

#[derive(Clone, Debug, Default)]
pub struct InputLog {
    pub calls: Vec<Call>,
    /// Steps so far.
    pub steps: u64,
    /// A step ran since the last recorded frame.
    dirty: bool,
}

/// Stable hash of a game file's exact text (16 hex digits in logs).
pub fn game_hash(text: &str) -> u64 {
    let mut h = StableHasher::new();
    h.write_str(text);
    h.finish()
}

impl InputLog {
    pub fn clear(&mut self) {
        self.calls.clear();
        self.steps = 0;
        self.dirty = false;
    }

    #[inline]
    pub fn step(&mut self, dt: f64) {
        self.steps += 1;
        self.dirty = true;
        if let Some(Call::Steps { dt: d, n, framed: false }) = self.calls.last_mut() {
            if d.to_bits() == dt.to_bits() {
                *n += 1;
                return;
            }
        }
        self.calls.push(Call::Steps { dt, n: 1, framed: false });
    }

    /// A frame build. Only recorded when a step ran since the last one (a
    /// second build without a step in between changes nothing).
    #[inline]
    pub fn frame(&mut self) {
        if !self.dirty {
            return;
        }
        self.dirty = false;
        match self.calls.last_mut() {
            Some(Call::Steps { dt, n, framed: false }) => {
                let dt = *dt;
                if *n > 1 {
                    *n -= 1;
                } else {
                    self.calls.pop();
                    if let Some(Call::Steps { dt: d, n, framed: true }) = self.calls.last_mut() {
                        if d.to_bits() == dt.to_bits() {
                            *n += 1;
                            return;
                        }
                    }
                }
                self.calls.push(Call::Steps { dt, n: 1, framed: true });
            }
            _ => self.calls.push(Call::Frame),
        }
    }

    pub fn pointer(&mut self, kind: u8, x: f64, y: f64) {
        self.calls.push(Call::Pointer { step: self.steps, kind, x, y });
    }
    pub fn key(&mut self, code: &str) {
        self.calls.push(Call::Key { step: self.steps, code: code.into() });
    }
    pub fn key_event(&mut self, code: &str, ch: &str, down: bool) {
        self.calls.push(Call::KeyEvent { step: self.steps, code: code.into(), ch: ch.into(), down });
    }
    pub fn swipe(&mut self, dx: i32, dy: i32) {
        self.calls.push(Call::Swipe { step: self.steps, dx, dy });
    }
    pub fn text(&mut self, kind: u8, value: &str) {
        self.calls.push(Call::Text { step: self.steps, kind, value: value.into() });
    }

    /// The whole log as JSON, with `final` taken from `player` now.
    pub fn to_json(&self, seed: u64, game_hash: u64, player: &Player) -> J {
        json!({
            "format": LOG_FORMAT,
            "seed": seed_json(seed),
            "game_hash": crate::hex64(game_hash),
            "calls": self.calls.iter().map(call_json).collect::<Vec<_>>(),
            "final": final_json(player),
        })
    }
}

pub fn seed_json(seed: u64) -> J {
    if seed <= (1u64 << 53) {
        J::from(seed)
    } else {
        J::from(seed.to_string())
    }
}

/// `{state_hash, phase, score, time_ms}` of a player now.
pub fn final_json(player: &Player) -> J {
    let s = player.status();
    json!({
        "state_hash": crate::hex64(player.game.state_hash()),
        "phase": s.phase.as_str(),
        "score": s.score,
        "time_ms": s.time_ms,
    })
}

fn num(v: f64) -> J {
    // Integral floats print as integers (smaller logs); they parse back exactly.
    if v == v.trunc() && v.abs() < 9e15 {
        J::from(v as i64)
    } else {
        J::from(v)
    }
}

fn call_json(c: &Call) -> J {
    match c {
        Call::Steps { dt, n, framed } => json!([if *framed { "S" } else { "s" }, num(*dt), n]),
        Call::Frame => json!(["f"]),
        Call::Pointer { step, kind, x, y } => json!(["p", step, kind, num(*x), num(*y)]),
        Call::Key { step, code } => json!(["k", step, &**code]),
        Call::KeyEvent { step, code, ch, down } => json!(["K", step, &**code, &**ch, *down as u8]),
        Call::Swipe { step, dx, dy } => json!(["w", step, dx, dy]),
        Call::Text { step, kind, value } => json!(["t", step, kind, &**value]),
    }
}

/// A parsed log file.
#[derive(Clone, Debug)]
pub struct Log {
    pub seed: u64,
    pub game_hash: String,
    pub calls: Vec<Call>,
    /// The claimed result (`final`), as written.
    pub final_: J,
}

pub fn parse_log(text: &str) -> Result<Log, String> {
    let doc: J = serde_json::from_str(text).map_err(|e| format!("log is not valid JSON: {e}"))?;
    let o = doc.as_object().ok_or("log must be a JSON object")?;
    match o.get("format").and_then(J::as_str) {
        Some(LOG_FORMAT) => {}
        other => return Err(format!("log format must be \"{LOG_FORMAT}\", found {other:?}")),
    }
    let seed = match o.get("seed") {
        Some(J::Number(n)) => n.as_u64().ok_or("seed must be a non-negative integer")?,
        Some(J::String(s)) => s.parse().map_err(|_| "seed string must be an integer")?,
        _ => return Err("log needs a \"seed\"".into()),
    };
    let game_hash = o.get("game_hash").and_then(J::as_str).ok_or("log needs a \"game_hash\" string")?.to_string();
    let final_ = o.get("final").cloned().ok_or("log needs a \"final\" object")?;
    let items = o.get("calls").and_then(J::as_array).ok_or("log needs a \"calls\" array")?;
    let mut calls = Vec::with_capacity(items.len());
    for (i, it) in items.iter().enumerate() {
        calls.push(parse_call(it).map_err(|e| format!("calls[{i}]: {e}"))?);
    }
    Ok(Log { seed, game_hash, calls, final_ })
}

fn parse_call(v: &J) -> Result<Call, String> {
    let a = v.as_array().ok_or("each call must be an array")?;
    let tag = a.first().and_then(J::as_str).ok_or("a call starts with a tag string")?;
    let f = |i: usize| a.get(i).and_then(J::as_f64).ok_or_else(|| format!("'{tag}' needs a number at {i}"));
    let u = |i: usize| a.get(i).and_then(J::as_u64).ok_or_else(|| format!("'{tag}' needs an integer at {i}"));
    let s = |i: usize| a.get(i).and_then(J::as_str).ok_or_else(|| format!("'{tag}' needs a string at {i}"));
    let want = |n: usize| if a.len() == n { Ok(()) } else { Err(format!("'{tag}' takes {} values", n - 1)) };
    Ok(match tag {
        "s" | "S" => {
            want(3)?;
            Call::Steps { dt: f(1)?, n: u(2)?.try_into().map_err(|_| "step count too big")?, framed: tag == "S" }
        }
        "f" => {
            want(1)?;
            Call::Frame
        }
        "p" => {
            want(5)?;
            let kind = u(2)?;
            if kind > 2 {
                return Err("pointer kind must be 0, 1 or 2".into());
            }
            Call::Pointer { step: u(1)?, kind: kind as u8, x: f(3)?, y: f(4)? }
        }
        "k" => {
            want(3)?;
            Call::Key { step: u(1)?, code: s(2)?.into() }
        }
        "K" => {
            want(5)?;
            Call::KeyEvent { step: u(1)?, code: s(2)?.into(), ch: s(3)?.into(), down: u(4)? != 0 }
        }
        "w" => {
            want(4)?;
            let d = |i: usize| a.get(i).and_then(J::as_i64).ok_or_else(|| format!("'w' needs an integer at {i}"));
            Call::Swipe { step: u(1)?, dx: d(2)?.signum() as i32, dy: d(3)?.signum() as i32 }
        }
        "t" => {
            want(4)?;
            let kind = u(2)?;
            if kind > 1 {
                return Err("text kind must be 0 or 1".into());
            }
            Call::Text { step: u(1)?, kind: kind as u8, value: s(3)?.into() }
        }
        other => return Err(format!("unknown call tag '{other}'")),
    })
}

pub fn pointer_kind(k: u8) -> PointerKind {
    match k {
        0 => PointerKind::Down,
        1 => PointerKind::Move,
        _ => PointerKind::Up,
    }
}

pub fn text_phase(k: u8) -> TextPhase {
    if k == 0 {
        TextPhase::Submit
    } else {
        TextPhase::Change
    }
}

/// Applies `calls` to `player` exactly as the shell made them. Fails if a
/// call's step index doesn't match the steps replayed so far.
pub fn replay_calls(player: &mut Player, calls: &[Call]) -> Result<u64, String> {
    let mut steps = 0u64;
    let at = |i: usize, want: u64, have: u64| {
        if want == have {
            Ok(())
        } else {
            Err(format!("calls[{i}] says step {want}, but {have} steps ran before it"))
        }
    };
    for (i, c) in calls.iter().enumerate() {
        match c {
            Call::Steps { dt, n, framed } => {
                for _ in 0..*n {
                    player.step(*dt);
                    if *framed {
                        player.frame();
                    }
                }
                steps += *n as u64;
            }
            Call::Frame => {
                player.frame();
            }
            Call::Pointer { step, kind, x, y } => {
                at(i, *step, steps)?;
                player.pointer(pointer_kind(*kind), *x, *y);
            }
            Call::Key { step, code } => {
                at(i, *step, steps)?;
                player.key(code);
            }
            Call::KeyEvent { step, code, ch, down } => {
                at(i, *step, steps)?;
                player.key_event(code, ch, *down);
            }
            Call::Swipe { step, dx, dy } => {
                at(i, *step, steps)?;
                player.swipe(*dx, *dy);
            }
            Call::Text { step, kind, value } => {
                at(i, *step, steps)?;
                player.text(text_phase(*kind), value);
            }
        }
    }
    Ok(steps)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_and_frames_run_length_encode() {
        let mut l = InputLog::default();
        for _ in 0..100 {
            l.step(16.0);
            l.frame();
            l.frame(); // no step in between: not recorded
        }
        l.step(16.0);
        l.step(16.0);
        l.frame();
        l.pointer(0, 1.0, 2.0);
        l.frame();
        l.step(8.0);
        assert_eq!(
            l.calls,
            vec![
                Call::Steps { dt: 16.0, n: 100, framed: true },
                Call::Steps { dt: 16.0, n: 1, framed: false },
                Call::Steps { dt: 16.0, n: 1, framed: true },
                Call::Pointer { step: 102, kind: 0, x: 1.0, y: 2.0 },
                Call::Steps { dt: 8.0, n: 1, framed: false },
            ]
        );
        let mut l2 = InputLog::default();
        l2.step(16.0);
        l2.step(16.0);
        l2.step(16.0);
        l2.frame();
        assert_eq!(
            l2.calls,
            vec![Call::Steps { dt: 16.0, n: 2, framed: false }, Call::Steps { dt: 16.0, n: 1, framed: true }]
        );
    }

    #[test]
    fn calls_json_round_trip() {
        let calls = vec![
            Call::Steps { dt: 1000.0 / 60.0, n: 3, framed: true },
            Call::Frame,
            Call::Pointer { step: 3, kind: 2, x: 0.1, y: 300.0 },
            Call::Key { step: 3, code: "ArrowUp".into() },
            Call::KeyEvent { step: 3, code: "KeyA".into(), ch: "a".into(), down: true },
            Call::Swipe { step: 3, dx: -1, dy: 0 },
            Call::Text { step: 3, kind: 0, value: "hé \"x\"".into() },
        ];
        for c in &calls {
            assert_eq!(&parse_call(&call_json(c)).unwrap(), c);
        }
    }
}
