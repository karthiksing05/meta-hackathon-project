//! # mg-core: the shared contract of the microgame engine
//!
//! Every other crate builds against these types. The source of truth for the
//! game format is `docs/microgame-input-format.md` in the repo root.
//!
//! Pipeline and crate ownership:
//!
//! ```text
//! game.json ──mg-lang──▶ ast (spans) ──check──▶ ir::Program ──mg-runtime──▶ Game (logic)
//!                                                     │                      │
//!                                                     └─────mg-scene─────────┴──▶ frame::Frame
//! mg-wasm: browser bindings          mg-cli: validate / simulate / replay / bench
//! ```
//!
//! Design rules that keep the engine fast:
//! * Names are resolved to dense numeric ids at load time. The runtime never
//!   looks a name up in a map.
//! * Values are immutable from the language's point of view, but containers
//!   are `Rc`-shared and mutated in place with `Rc::make_mut` when uniquely
//!   owned (copy-on-write).
//! * Locals live in one flat stack of `Value`s addressed by slot number.
//! * Lambdas are not values: they only appear as builtin arguments and are
//!   evaluated by the builtin by writing parameter slots and evaluating the body.

pub mod ast;
pub mod builtins;
pub mod color;
pub mod diag;
pub mod frame;
pub mod hash;
pub mod ir;
pub mod limits;
pub mod rng;
pub mod scene;
pub mod types;
pub mod value;

pub use diag::{Code, Diagnostic, Severity};
pub use ir::Program;
pub use types::Type;
pub use value::Value;

/// Latest format tag. Game files may carry any tag in `FORMATS`.
pub const FORMAT: &str = "microgame/0.2";
/// Every accepted format tag, oldest first. v0.2 is a superset of v0.1.
pub const FORMATS: &[&str] = &["microgame/0.1", "microgame/0.2"];
