//! # mg-scene: presentation runtime and the `Player` facade
//!
//! Evaluates `mg_core::scene::Presentation` against a `Game` and produces a
//! `mg_core::frame::Frame`: layout, bindings, transitions, `animate_on`
//! keyframes, hit-testing for `on_tap` / `on_drag`, and global feedback.
//!
//! PUBLIC API: `Player` and `PointerKind` are used by mg-wasm and mg-cli. Keep
//! the signatures; add freely.
//!
//! Layout rules and v0.1 simplifications are documented in `build.rs`; text
//! measurement in `text.rs`; easing and keyframes in `motion.rs`.
//!
//! ## Timing
//! Tweens, keyframes and shake run on a presentation clock advanced by
//! `step(dt)`. It keeps running after the game ends so end-of-game motion
//! finishes. `animate_on` events are queued by `step` and matched against node
//! instances at the next frame build (with the state at that time), starting
//! at the clock time the event fired.
//!
//! ## Caching
//! `frame()` re-evaluates bindings only when the state, phase (or `now`, if a
//! binding reads it) changed, a tween / animation is running, or animation
//! events are pending. Otherwise it returns the cached ops.

use std::rc::Rc;

use mg_core::frame::Frame;
use mg_core::{Diagnostic, Program, Value};
use mg_runtime::{Fired, Game, Status};

mod build;
pub mod motion;
mod template;
pub mod text;
mod util;

use build::{Scene, View};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PointerKind {
    Down,
    Move,
    Up,
}

/// A tappable or draggable region, from the last laid-out frame.
#[derive(Clone, Debug, PartialEq)]
pub struct HitTarget {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub drag: bool,
}

/// An `on_drag` target captured by a pointer-down.
struct DragCapture {
    node: u32,
    saved: Vec<(u16, Value)>,
}

/// CONTRACT. A game plus its presentation: what the shell talks to.
pub struct Player {
    pub game: Game,
    scene: Scene,
    fired: Vec<Fired>,
    drag: Option<DragCapture>,
}

fn view(game: &Game) -> View<'_> {
    View { state: game.state(), now_ms: game.now_ms(), phase: game.phase() }
}

impl Player {
    pub fn new(program: Rc<Program>, seed: u64) -> Player {
        let game = Game::new(program.clone(), seed);
        let scene = Scene::new(program);
        let mut p = Player { game, scene, fired: Vec::new(), drag: None };
        p.consume_fired();
        p.build();
        p
    }

    /// Pointer in canvas units. Down hit-tests `on_tap`/`on_drag` targets
    /// (topmost first, untransformed boxes); Move/Up drive an active drag.
    pub fn pointer(&mut self, kind: PointerKind, x: f64, y: f64) {
        if !x.is_finite() || !y.is_finite() {
            return;
        }
        match kind {
            PointerKind::Down => {
                if !self.scene.built {
                    self.build();
                }
                let Some(hit) = self.scene.hit_at(x, y) else {
                    return;
                };
                let node = hit.node;
                let (s0, s1) = hit.saved;
                let saved: Vec<(u16, Value)> = self.scene.saved[s0 as usize..s1 as usize].to_vec();
                let tpl = self.scene.tpl.clone();
                let n = &tpl.nodes[node as usize];
                if let Some(b) = &n.on_tap {
                    self.dispatch(node, b, &saved, x, y);
                }
                if let Some(b) = &n.on_drag {
                    self.dispatch(node, b, &saved, x, y);
                    self.drag = Some(DragCapture { node, saved });
                }
            }
            PointerKind::Move | PointerKind::Up => {
                let Some(cap) = self.drag.take() else { return };
                let tpl = self.scene.tpl.clone();
                if let Some(b) = &tpl.nodes[cap.node as usize].on_drag {
                    self.dispatch(cap.node, b, &cap.saved, x, y);
                }
                if kind == PointerKind::Move {
                    self.drag = Some(cap);
                }
            }
        }
    }

    fn dispatch(&mut self, node: u32, b: &mg_core::scene::InputBinding, saved: &[(u16, Value)], x: f64, y: f64) {
        let v = view(&self.game);
        if let Some(payload) = self.scene.eval_binding(node, b, saved, x, y, v) {
            self.game.input(b.input, payload);
        }
    }

    pub fn key(&mut self, code: &str) -> bool {
        self.game.key(code)
    }

    pub fn swipe(&mut self, dx: i32, dy: i32) -> bool {
        self.game.swipe(dx, dy)
    }

    /// Steps the game, then consumes fired events into animations/feedback
    /// and advances tweens.
    pub fn step(&mut self, dt_ms: f64) {
        self.game.step(dt_ms);
        self.scene.advance(dt_ms);
        self.consume_fired();
    }

    fn consume_fired(&mut self) {
        self.fired.clear();
        self.game.drain_fired(&mut self.fired);
        if !self.fired.is_empty() {
            let v = view(&self.game);
            self.scene.on_fired(&self.fired, v);
        }
    }

    fn build(&mut self) {
        let version = self.game.version();
        self.scene.build(view(&self.game), version);
    }

    fn build_if_needed(&mut self) {
        let version = self.game.version();
        if self.scene.needs_build(view(&self.game), version) {
            self.scene.build(view(&self.game), version);
        }
    }

    /// Builds (or reuses) the current frame. `audio`/`toasts` hold only what
    /// fired since the previous call.
    pub fn frame(&mut self) -> &Frame {
        self.build_if_needed();
        self.scene.finish_frame();
        &self.scene.frame
    }

    /// Forces a full re-evaluation and layout (benchmarks, debugging).
    pub fn rebuild(&mut self) -> &Frame {
        self.build();
        &self.scene.frame
    }

    pub fn status(&self) -> Status {
        self.game.status()
    }

    pub fn restart(&mut self, seed: u64) {
        self.game.restart(seed);
        self.scene.reset();
        self.drag = None;
        self.consume_fired();
        self.build();
    }

    /// Current hit targets (for the simulator's random taps and for tests).
    /// Rebuilds first if the state changed since the last frame.
    pub fn hit_targets(&mut self) -> Vec<HitTarget> {
        self.build_if_needed();
        let tpl = &self.scene.tpl;
        self.scene
            .hits
            .iter()
            .map(|h| HitTarget { x: h.x, y: h.y, w: h.w, h: h.h, drag: tpl.nodes[h.node as usize].on_drag.is_some() })
            .collect()
    }

    /// Presentation problems: load-time (bad constant props) and the first
    /// evaluation error per prop. Evaluation errors never crash a frame.
    pub fn diagnostics(&self) -> &[Diagnostic] {
        &self.scene.diags.list
    }

    /// Number of full scene builds so far (cache effectiveness).
    pub fn build_count(&self) -> u64 {
        self.scene.builds
    }
}

#[cfg(test)]
mod tests;
