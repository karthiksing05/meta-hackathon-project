//! Scroll Games runtime. Pure-Rust core; the JS player only renders `Session::view()`.

pub mod catalog;
pub mod concepts;
pub mod ext_meta;
pub mod ext_play;
pub mod game;
pub mod glue;
pub mod rng;
pub mod session;
pub mod types;
pub mod validate;

#[cfg(feature = "wasm")]
mod wasm;

pub use session::Session;
pub use types::RecordedInput;

/// Embedded concept catalog (spec/concepts.json).
pub fn catalog() -> String {
    catalog::CONCEPTS_JSON.to_string()
}

/// Validate manifest + content; returns the report JSON.
pub fn validate(manifest_json: &str, content_json: &str) -> String {
    validate::validate(manifest_json, content_json).to_json()
}

/// Replay recorded inputs; returns `{score, ticks}` or `{ok:false,error}` JSON.
pub fn replay(manifest_json: &str, content_json: &str, seed: u32, inputs_json: &str) -> String {
    let result = serde_json::from_str::<Vec<RecordedInput>>(inputs_json)
        .map_err(|e| format!("bad inputs JSON: {e}"))
        .and_then(|inputs| session::replay(manifest_json, content_json, seed, &inputs));
    match result {
        Ok((score, ticks)) => serde_json::json!({ "score": score, "ticks": ticks }).to_string(),
        Err(error) => serde_json::json!({ "ok": false, "error": error }).to_string(),
    }
}
