//! Library behind the `microgame` CLI (spec B5, SPEC-v0.2). The binary in `main.rs` is a
//! thin layer over these modules; the acceptance tests call them directly.

pub mod args;
pub mod bench;
pub mod catalog;
pub mod report;
pub mod replay;
pub mod sim;
pub mod value_json;
pub mod verify;

use std::rc::Rc;

use mg_core::{Diagnostic, Program};

/// Compiles a game file. `Err` holds every diagnostic (at least one error).
pub fn compile(json: &str) -> Result<(Rc<Program>, Vec<Diagnostic>), Vec<Diagnostic>> {
    mg_lang::compile(json).map(|c| (Rc::new(c.program), c.warnings))
}

/// Seed used when neither `--seed` nor `meta.seed` gives one. Same as the WASM build.
pub const DEFAULT_SEED: u64 = mg_wasm::DEFAULT_SEED;

/// Message of a caught panic payload.
pub fn panic_message(p: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = p.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = p.downcast_ref::<String>() {
        s.clone()
    } else {
        "panic".to_string()
    }
}

pub fn hex64(v: u64) -> String {
    mg_wasm::hex64(v)
}
