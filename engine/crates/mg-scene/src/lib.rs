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
//! binding reads it) changed, a tween / animation is running, animation
//! events are pending, particles are alive, or an auto-animated image is due
//! to change frame. Otherwise it returns the cached ops. The camera and music
//! are bindings like any other, so they follow the same rule.
//!
//! ## Camera and layers (v0.2)
//! Ops are laid out in world units, then non-`fixed` ops are shifted by
//! `-camera`. The frame paints all world ops (tree order), then particles,
//! then all `fixed` ops (tree order), so the HUD is always on top. Hit
//! records follow the same order and are kept in canvas coordinates; a world
//! target's `pointer` value is `canvas + camera`, a fixed target's is the
//! raw canvas point.
//!
//! ## Pointer routing (v0.2)
//! Down goes to the topmost target (a node with `on_tap`, `on_drag`,
//! `on_press` or `on_release`); if none is hit it goes to the
//! `{"pointer": "down"}` sources in world coordinates. Move and Up go to the
//! captured drag if there is one; otherwise to the pointer sources (Move only
//! while a pointer that no node took is down; Up unless a node took the
//! matching Down).
//!
//! ## Press and release (v0.2.1)
//! On Down the hit node sends, in order, `on_press`, `on_tap` and `on_drag`.
//! A node with `on_release` is captured: the next Up sends its `on_release`
//! wherever the pointer is (after the drag's last `on_drag`), with the node
//! locals saved at the Down and `pointer` at the Up. A second Down before
//! the Up, or a restart, releases it first; on restart the release goes to
//! the ending game, so the new game never sees it (and verified logs, which
//! start at the restart, replay the same).

use std::rc::Rc;

use mg_core::frame::Frame;
use mg_core::ir::{PointerPhase, TextPhase};
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

/// An `on_drag` / `on_release` target captured by a pointer-down.
#[derive(Clone)]
struct Capture {
    node: u32,
    saved: Vec<(u16, Value)>,
    fixed: bool,
}

/// Who took the current pointer-down.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Press {
    None,
    /// An `on_tap` / `on_drag` node.
    Node,
    /// Nothing was hit: the pointer sources.
    Source,
}

/// CONTRACT. A game plus its presentation: what the shell talks to.
/// `Clone` forks the whole session (game + scene), e.g. for bot look-ahead.
#[derive(Clone)]
pub struct Player {
    pub game: Game,
    scene: Scene,
    fired: Vec<Fired>,
    drag: Option<Capture>,
    /// v0.2.1: a pressed node waiting for the pointer to come up.
    release: Option<Capture>,
    /// Last pointer position (canvas units), for a release cancelled by restart.
    last_pointer: (f64, f64),
    press: Press,
}

fn view(game: &Game) -> View<'_> {
    View { state: game.state(), now_ms: game.now_ms(), phase: game.phase() }
}

impl Player {
    pub fn new(program: Rc<Program>, seed: u64) -> Player {
        let game = Game::new(program.clone(), seed);
        let scene = Scene::new(program);
        let mut p = Player {
            game,
            scene,
            fired: Vec::new(),
            drag: None,
            release: None,
            last_pointer: (0.0, 0.0),
            press: Press::None,
        };
        p.consume_fired();
        p.build();
        p
    }

    /// Pointer in canvas units. Down hit-tests `on_tap`/`on_drag`/`on_press`/
    /// `on_release` targets (topmost first, untransformed boxes, fixed
    /// targets above world ones); Move/Up drive an active drag, and Up sends
    /// a pending `on_release`. Pointer events no node took go to the game's
    /// `pointer` input sources in world coordinates.
    pub fn pointer(&mut self, kind: PointerKind, x: f64, y: f64) {
        if !x.is_finite() || !y.is_finite() {
            return;
        }
        self.last_pointer = (x, y);
        match kind {
            PointerKind::Down => {
                if let Some(cap) = self.release.take() {
                    self.send_release(cap, x, y);
                }
                if !self.scene.built {
                    self.build();
                }
                let Some(hit) = self.scene.hit_at(x, y) else {
                    self.press = Press::Source;
                    let (wx, wy) = self.world(x, y);
                    self.game.pointer_source(PointerPhase::Down, wx, wy);
                    return;
                };
                self.press = Press::Node;
                let node = hit.node;
                let fixed = hit.fixed;
                let (s0, s1) = hit.saved;
                let saved: Vec<(u16, Value)> = self.scene.saved[s0 as usize..s1 as usize].to_vec();
                let tpl = self.scene.tpl.clone();
                let n = &tpl.nodes[node as usize];
                let (px, py) = if fixed { (x, y) } else { self.world(x, y) };
                if let Some(b) = &n.on_press {
                    self.dispatch(node, b, &saved, px, py);
                }
                if let Some(b) = &n.on_tap {
                    self.dispatch(node, b, &saved, px, py);
                }
                if let Some(b) = &n.on_drag {
                    self.dispatch(node, b, &saved, px, py);
                    self.drag = Some(Capture { node, saved: saved.clone(), fixed });
                }
                if n.on_release.is_some() {
                    self.release = Some(Capture { node, saved, fixed });
                }
            }
            PointerKind::Move | PointerKind::Up => {
                let release = if kind == PointerKind::Up { self.release.take() } else { None };
                if let Some(cap) = self.drag.take() {
                    let tpl = self.scene.tpl.clone();
                    let (px, py) = if cap.fixed { (x, y) } else { self.world(x, y) };
                    if let Some(b) = &tpl.nodes[cap.node as usize].on_drag {
                        self.dispatch(cap.node, b, &cap.saved, px, py);
                    }
                    if kind == PointerKind::Move {
                        self.drag = Some(cap);
                    } else {
                        self.press = Press::None;
                    }
                } else {
                    let press = self.press;
                    if kind == PointerKind::Up {
                        self.press = Press::None;
                    }
                    let phase = match kind {
                        PointerKind::Move if press == Press::Source => Some(PointerPhase::Move),
                        PointerKind::Up if press != Press::Node => Some(PointerPhase::Up),
                        _ => None,
                    };
                    if let Some(phase) = phase {
                        let (wx, wy) = self.world(x, y);
                        self.game.pointer_source(phase, wx, wy);
                    }
                }
                if let Some(cap) = release {
                    self.send_release(cap, x, y);
                }
            }
        }
    }

    /// Sends a captured node's `on_release` with the pointer at canvas `(x, y)`.
    fn send_release(&mut self, cap: Capture, x: f64, y: f64) {
        let tpl = self.scene.tpl.clone();
        let (px, py) = if cap.fixed { (x, y) } else { self.world(x, y) };
        if let Some(b) = &tpl.nodes[cap.node as usize].on_release {
            self.dispatch(cap.node, b, &cap.saved, px, py);
        }
    }

    /// Canvas point to world coordinates with the last built camera.
    fn world(&self, x: f64, y: f64) -> (f64, f64) {
        (x + self.scene.camera.0, y + self.scene.camera.1)
    }

    fn dispatch(&mut self, node: u32, b: &mg_core::scene::InputBinding, saved: &[(u16, Value)], x: f64, y: f64) {
        let v = view(&self.game);
        if let Some(payload) = self.scene.eval_binding(node, b, saved, x, y, v) {
            self.game.input(b.input, payload);
        }
    }

    /// Full keyboard event: `code` is `KeyboardEvent.code` or `.key`, `ch`
    /// the printable character or `""`. Returns true if any source matched.
    pub fn key_event(&mut self, code: &str, ch: &str, down: bool) -> bool {
        self.game.key_event(code, ch, down)
    }

    /// Typed text: submitted (Enter / Done) or changed.
    pub fn text(&mut self, phase: TextPhase, value: &str) -> bool {
        self.game.text(phase, value)
    }

    /// Camera of the last built frame (world = canvas + camera).
    pub fn camera(&self) -> (f64, f64) {
        self.scene.camera
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
        // A held press is cancelled: its release goes to the ending game.
        if let Some(cap) = self.release.take() {
            let (x, y) = self.last_pointer;
            self.send_release(cap, x, y);
        }
        self.game.restart(seed);
        self.scene.reset();
        self.drag = None;
        self.release = None;
        self.press = Press::None;
        self.consume_fired();
        self.build();
    }

    /// Current hit targets in canvas coordinates (camera applied), for the
    /// simulator's random taps and for tests.
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
