//! Headless simulation with random valid inputs (spec B5 `simulate`).

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::rc::Rc;

use mg_core::hash::splitmix64;
use mg_core::ir::{SourceTrigger, TextPhase};
use mg_core::rng::Rng;
use mg_core::{Diagnostic, Program};
use mg_runtime::Phase;
use mg_scene::{Player, PointerKind};

use crate::panic_message;

/// What a random player can do in a game.
#[derive(Clone, Debug, Default)]
pub struct Controls {
    /// Every `{"key": ...}` source code (down or up), deduplicated, in declaration order.
    pub keys: Vec<Rc<str>>,
    /// Some input has a `{"key": "any"}` source.
    pub any_key: bool,
    /// True if any input has a swipe source.
    pub swipe: bool,
    /// Some input has a `{"pointer": ...}` source.
    pub pointer: bool,
    /// Some input has a `{"text": ...}` source.
    pub text: bool,
    pub canvas: (f64, f64),
}

/// Words the random player types (plus random strings).
pub const WORDS: &[&str] = &[
    "cat", "dog", "apple", "house", "tree", "sun", "moon", "star", "game", "play", "hello", "world", "yes", "no",
    "Paris", "ok", "42", "7", "-3", "0", "", "  spaced  ", "ÜBER", "naïve", "😀", "a b c",
];

/// Characters for random key presses on `any` sources and random strings.
const CHARS: &[char] = &[
    'a', 'b', 'e', 'k', 'q', 'z', 'A', 'M', 'Z', '0', '1', '9', ' ', '.', ',', '!', '?', '-', '\'', 'é', 'ß', '中',
];

/// Non-printable keys sent to `any` sources (empty char).
const SPECIAL_KEYS: &[&str] = &["Enter", "Backspace", "ArrowLeft", "ArrowUp", "Escape", "Tab", "ShiftLeft"];

/// The browser `KeyboardEvent.code` for a printable char (`'a'` → `KeyA`).
pub fn code_for_char(c: char) -> String {
    match c {
        'a'..='z' => format!("Key{}", c.to_ascii_uppercase()),
        'A'..='Z' => format!("Key{c}"),
        '0'..='9' => format!("Digit{c}"),
        ' ' => "Space".into(),
        '.' => "Period".into(),
        ',' => "Comma".into(),
        '-' => "Minus".into(),
        '\'' => "Quote".into(),
        _ => String::new(),
    }
}

/// The printable char a key code types (`KeyA` → `a`, `Space` → ` `), or `""`.
/// A single-character code is its own char.
pub fn char_for_code(code: &str) -> String {
    let mut it = code.chars();
    if let (Some(c), None) = (it.next(), it.next()) {
        return c.to_string();
    }
    if let Some(rest) = code.strip_prefix("Key").or_else(|| code.strip_prefix("Digit")) {
        if rest.len() == 1 {
            return rest.to_ascii_lowercase();
        }
    }
    match code {
        "Space" => " ".into(),
        "Period" => ".".into(),
        "Comma" => ",".into(),
        "Minus" => "-".into(),
        _ => String::new(),
    }
}

impl Controls {
    pub fn of(p: &Program) -> Controls {
        let mut c = Controls { canvas: (p.presentation.canvas.w, p.presentation.canvas.h), ..Default::default() };
        for input in &p.inputs {
            for s in &input.sources {
                match &s.trigger {
                    SourceTrigger::Key { code: Some(k), .. } => {
                        if !c.keys.contains(k) {
                            c.keys.push(k.clone());
                        }
                    }
                    SourceTrigger::Key { code: None, .. } => c.any_key = true,
                    SourceTrigger::Swipe(_) => c.swipe = true,
                    SourceTrigger::Pointer(_) => c.pointer = true,
                    SourceTrigger::Text(_) => c.text = true,
                }
            }
        }
        c
    }
}

pub const SWIPES: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

/// Sends random valid inputs: taps at random points inside the current hit
/// targets (and drags for draggable ones), key down/up pairs for every key
/// source (random printable and special keys for `any`), swipes in 4
/// directions, pointer down/move/up anywhere (for pointer sources), typed text
/// (changes, then a submit) and the odd tap that misses everything.
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

    fn point(&mut self) -> (f64, f64) {
        (self.unit() * self.controls.canvas.0, self.unit() * self.controls.canvas.1)
    }

    /// Steps the game 0–`max` times (inputs held across steps).
    fn pause(&mut self, player: &mut Player, max: u64) {
        for _ in 0..self.rng.below(max + 1) {
            player.step(self.dt);
        }
    }

    /// A random key: a declared code, or (for `any`) a printable or special key.
    fn random_key(&mut self) -> (String, String) {
        let n_declared = self.controls.keys.len() as u64;
        let pick_declared = n_declared > 0 && (!self.controls.any_key || self.rng.below(2) == 0);
        if pick_declared {
            let k = self.controls.keys[self.rng.below(n_declared) as usize].to_string();
            let ch = char_for_code(&k);
            return (k, ch);
        }
        if self.rng.below(4) == 0 {
            let k = SPECIAL_KEYS[self.rng.below(SPECIAL_KEYS.len() as u64) as usize];
            return (k.to_string(), String::new());
        }
        let c = CHARS[self.rng.below(CHARS.len() as u64) as usize];
        (code_for_char(c), c.to_string())
    }

    fn random_text(&mut self) -> String {
        if self.rng.below(3) > 0 {
            return WORDS[self.rng.below(WORDS.len() as u64) as usize].to_string();
        }
        let len = self.rng.below(48);
        (0..len).map(|_| CHARS[self.rng.below(CHARS.len() as u64) as usize]).collect()
    }

    /// Applies one random input. Drags, held keys and typing step the game
    /// between events.
    pub fn act(&mut self, player: &mut Player) {
        let targets = player.hit_targets();
        let w_tap = if targets.is_empty() { 0 } else { 6 };
        let w_key = if self.controls.keys.is_empty() && !self.controls.any_key { 0 } else { 4 };
        let w_swipe = if self.controls.swipe { 4 } else { 0 };
        let w_miss = 1;
        let w_pointer = if self.controls.pointer { 4 } else { 0 };
        let w_text = if self.controls.text { 4 } else { 0 };
        let total = w_tap + w_key + w_swipe + w_miss + w_pointer + w_text;
        let roll = self.rng.below(total as u64) as i32;
        if roll < w_tap {
            let t = &targets[self.rng.below(targets.len() as u64) as usize];
            let x = t.x + t.w * (0.05 + 0.9 * self.unit());
            let y = t.y + t.h * (0.05 + 0.9 * self.unit());
            player.pointer(PointerKind::Down, x, y);
            if t.drag {
                let moves = 1 + self.rng.below(4);
                for _ in 0..moves {
                    player.step(self.dt);
                    let (mx, my) = self.point();
                    player.pointer(PointerKind::Move, mx, my);
                }
                let (ux, uy) = self.point();
                player.pointer(PointerKind::Up, ux, uy);
            } else {
                player.pointer(PointerKind::Up, x, y);
            }
        } else if roll < w_tap + w_key {
            let (code, ch) = self.random_key();
            player.key_event(&code, &ch, true);
            self.pause(player, 3);
            player.key_event(&code, &ch, false);
        } else if roll < w_tap + w_key + w_swipe {
            let (dx, dy) = SWIPES[self.rng.below(4) as usize];
            player.swipe(dx, dy);
        } else if roll < w_tap + w_key + w_swipe + w_pointer {
            let (x, y) = self.point();
            player.pointer(PointerKind::Down, x, y);
            for _ in 0..self.rng.below(4) {
                player.step(self.dt);
                let (mx, my) = self.point();
                player.pointer(PointerKind::Move, mx, my);
            }
            let (ux, uy) = self.point();
            player.pointer(PointerKind::Up, ux, uy);
        } else if roll < w_tap + w_key + w_swipe + w_pointer + w_text {
            let text = self.random_text();
            // Type it: a change per prefix (at most 8), then submit; the field clears.
            let chars: Vec<char> = text.chars().collect();
            let stride = chars.len().div_ceil(8).max(1);
            let mut n = 0;
            while n < chars.len() {
                n = (n + stride).min(chars.len());
                let prefix: String = chars[..n].iter().collect();
                player.text(TextPhase::Change, &prefix);
                self.pause(player, 1);
            }
            player.text(TextPhase::Submit, &text);
            player.text(TextPhase::Change, "");
        } else {
            let (x, y) = self.point();
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
