//! Engine limits (spec B6). Enforced by the engine, never written in the file.
//! Exceeding one is a runtime error: the current rule is rolled back.

/// Effects executed while processing one event (all rules for that event).
pub const MAX_EFFECTS_PER_EVENT: u32 = 10_000;
/// Events (inputs + timers + emitted + tick) processed per `step`.
pub const MAX_EVENTS_PER_STEP: u32 = 256;
/// Timers (`after`) alive at once. `every` timers do not count.
pub const MAX_ACTIVE_TIMERS: usize = 128;
/// Items in any list, set, map or grid.
pub const MAX_COLLECTION_LEN: usize = 10_000;
/// Draw ops in one frame. Further ops are dropped and a warning recorded.
pub const MAX_RENDER_OPS: usize = 2_000;
/// Builtin evaluation budget per event, to stop runaway pure code
/// (e.g. nested maps over large ranges). Counted per element visited by
/// higher-order builtins and per user function call.
pub const MAX_EVAL_STEPS_PER_EVENT: u64 = 2_000_000;
/// Inputs waiting in the queue; extra inputs are dropped.
pub const MAX_QUEUED_INPUTS: usize = 64;

// ── v0.2 ────────────────────────────────────────────────────────────────
/// Assets per game.
pub const MAX_ASSETS: usize = 256;
/// Bytes of one inline `svg` asset.
pub const MAX_SVG_BYTES: usize = 256 * 1024;
/// Bytes of one `data:` URI asset.
pub const MAX_DATA_URI_BYTES: usize = 4 * 1024 * 1024;
/// Points in one `poly` node.
pub const MAX_POLY_POINTS: usize = 256;
/// Particles alive at once (presentation only).
pub const MAX_PARTICLES: usize = 512;
/// Particles per burst.
pub const MAX_PARTICLES_PER_BURST: usize = 64;
/// Physics sub-steps per step.
pub const MAX_PHYSICS_SUBSTEPS: u32 = 8;
/// Characters in a text input value.
pub const MAX_TEXT_INPUT_LEN: usize = 200;
