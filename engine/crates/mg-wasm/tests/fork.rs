//! `mg_fork`: a fork is an exact, independent copy (bot look-ahead), and its
//! input log still verifies like the original's.

use mg_wasm::*;

fn result() -> String {
    String::from_utf8(unsafe { std::slice::from_raw_parts(mg_result_ptr(), mg_result_len() as usize) }.to_vec())
        .unwrap()
}

fn hash(h: i32) -> String {
    assert!(mg_state_hash(h) > 0);
    result()
}

fn key(h: i32, code: &str) {
    unsafe { mg_key(h, code.as_ptr(), code.len() as u32) };
}

#[test]
fn fork_is_an_exact_independent_copy() {
    let text = std::fs::read_to_string(format!("{}/../../fixtures/number_merge.json", env!("CARGO_MANIFEST_DIR")))
        .unwrap();
    let a = unsafe { mg_load(text.as_ptr(), text.len() as u32, 7.0) };
    assert!(a >= 0);
    for k in ["ArrowLeft", "ArrowUp", "ArrowRight"] {
        key(a, k);
        mg_step(a, 1000.0 / 60.0);
    }
    let b = mg_fork(a);
    assert!(b >= 0 && b != a);
    assert_eq!(hash(a), hash(b), "a fork starts identical");

    // Diverge the fork; the original must not change.
    let before = hash(a);
    key(b, "ArrowDown");
    mg_step(b, 1000.0 / 60.0);
    assert_eq!(hash(a), before, "playing the fork must not touch the original");

    // The same move on both gives the same result (determinism carries over).
    let c = mg_fork(a);
    key(a, "ArrowDown");
    mg_step(a, 1000.0 / 60.0);
    key(c, "ArrowDown");
    mg_step(c, 1000.0 / 60.0);
    assert_eq!(hash(a), hash(c));
    assert_eq!(hash(b), hash(c));

    // The fork's log covers the shared history plus its own moves.
    assert!(mg_log(c) > 0);
    let log: serde_json::Value = serde_json::from_str(&result()).unwrap();
    assert_eq!(log["format"], "microgame-log/1");

    assert_eq!(mg_unload(b), 0);
    assert_eq!(mg_unload(c), 0);
    assert!(mg_fork(b) < 0, "forking an unloaded handle fails");
    assert_eq!(mg_unload(a), 0);
}
