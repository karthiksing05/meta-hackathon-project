//! # mg-lang: the front end
//!
//! `game.json` → serde (raw JSON) → parse expression strings (`ast`) →
//! resolve names → bidirectional type check → static checks → lower to
//! `mg_core::ir::Program`.
//!
//! Every check produces `Diagnostic`s and keeps going.
//!
//! PUBLIC API: the signatures in this file are a contract used by mg-runtime
//! tests, mg-scene, mg-wasm and mg-cli. Keep them.
//!
//! Module map:
//! * `lexer`, `parser`: expression strings → `ast::Expr` with char spans.
//! * `typarse`: type strings and the `types` section.
//! * `check`: name resolution + type checking + lowering of expressions.
//! * `builtin_check`: typing of each builtin per `mg_core::builtins`.
//! * `program`: the JSON walk over every section, rules, objectives, and
//!   the whole-program static checks.
//! * `effects`: rule effects (A10).
//! * `present`: presentation (A12) → `mg_core::scene`.

use std::borrow::Cow;

use mg_core::{Diagnostic, Program};
use serde_json::Value as J;

mod builtin_check;
mod check;
mod dupjson;
mod effects;
mod lexer;
pub mod parser;
mod present;
mod program;
mod typarse;

/// Result of compiling a game file.
pub struct Compiled {
    pub program: Program,
    /// Warnings only (no errors), e.g. `W_UNUSED_STATE`.
    pub warnings: Vec<Diagnostic>,
}

/// Full pipeline. `Err` holds every diagnostic found (errors and warnings),
/// sorted by `at` then span, and contains at least one error.
pub fn compile(json: &str) -> Result<Compiled, Vec<Diagnostic>> {
    match program::compile_program(json) {
        (Some(program), warnings) => Ok(Compiled { program, warnings }),
        (None, diags) => Err(diags),
    }
}

/// Runs every check and returns all diagnostics (errors and warnings).
/// Empty means the game is valid and has no warnings.
pub fn validate(json: &str) -> Vec<Diagnostic> {
    match compile(json) {
        Ok(c) => c.warnings,
        Err(d) => d,
    }
}

/// Appends one JSON Pointer segment (RFC 6901 escaping).
pub(crate) fn ptr(base: &str, seg: &str) -> String {
    let mut s = String::with_capacity(base.len() + seg.len() + 1);
    s.push_str(base);
    s.push('/');
    for c in seg.chars() {
        match c {
            '~' => s.push_str("~0"),
            '/' => s.push_str("~1"),
            c => s.push(c),
        }
    }
    s
}

pub(crate) fn json_kind(v: &J) -> &'static str {
    match v {
        J::Null => "null",
        J::Bool(_) => "a boolean",
        J::Number(_) => "a number",
        J::String(_) => "a string",
        J::Array(_) => "a list",
        J::Object(_) => "an object",
    }
}

/// Expression source text of a JSON field. Numbers and booleans are accepted
/// as literal expressions.
pub(crate) fn src_of(v: &J) -> Option<Cow<'_, str>> {
    match v {
        J::String(s) => Some(Cow::Borrowed(s.as_str())),
        J::Number(n) => Some(Cow::Owned(n.to_string())),
        J::Bool(b) => Some(Cow::Borrowed(if *b { "true" } else { "false" })),
        _ => None,
    }
}

pub(crate) fn is_ident(s: &str) -> bool {
    let mut cs = s.chars();
    matches!(cs.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && cs.all(|c| c.is_ascii_alphanumeric() || c == '_')
        && lexer::keyword(s).is_none()
}

#[cfg(test)]
mod tests;
