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
