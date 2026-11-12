//! Native CLI used by the Go server. One JSON request on stdin, one JSON response on stdout.

use serde_json::{json, Value};
use std::io::{Read, Write};

fn main() {
    let cmd = std::env::args().nth(1).unwrap_or_default();
    let out = match run(&cmd) {
        Ok(s) => s,
        Err(e) => json!({ "ok": false, "error": e }).to_string(),
    };
    let mut so = std::io::stdout();
    let _ = so.write_all(out.as_bytes());
    let _ = so.write_all(b"\n");
}

fn run(cmd: &str) -> Result<String, String> {
    if cmd == "catalog" {
        return Ok(sg_runtime::catalog());
    }
    if cmd != "validate" && cmd != "replay" {
        return Err(format!("unknown command '{cmd}' (expected validate | replay | catalog)"));
    }
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).map_err(|e| format!("reading stdin: {e}"))?;
    let req: Value = serde_json::from_str(&input).map_err(|e| format!("bad request JSON: {e}"))?;
    let manifest = req["manifest"].to_string();
    let content = req["content"].to_string();
    if cmd == "validate" {
        return Ok(sg_runtime::validate(&manifest, &content));
    }
    let seed = req["seed"].as_u64().ok_or("seed must be a non-negative integer")? as u32;
    let inputs = req["inputs"].to_string();
    Ok(sg_runtime::replay(&manifest, &content, seed, &inputs))
}
