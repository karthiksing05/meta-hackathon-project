//! wasm-bindgen surface (enabled with the `wasm` feature).

use crate::session::Session;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = Session)]
pub struct WasmSession(Session);

#[wasm_bindgen(js_class = Session)]
impl WasmSession {
    #[wasm_bindgen(constructor)]
    pub fn new(manifest_json: &str, content_json: &str, seed: u32) -> Result<WasmSession, JsError> {
        Session::new(manifest_json, content_json, seed).map(WasmSession).map_err(|e| JsError::new(&e))
    }

    pub fn start(&mut self) {
        self.0.start();
    }

    pub fn step(&mut self, dt_ms: f64) {
        self.0.step(dt_ms);
    }

    pub fn input(&mut self, json: &str) -> Result<(), JsError> {
        self.0.input(json).map_err(|e| JsError::new(&e))
    }

    pub fn view(&self) -> String {
        self.0.view().to_string()
    }

    pub fn drain_events(&mut self) -> String {
        self.0.drain_events().to_string()
    }

    pub fn result(&self) -> String {
        self.0.result().to_string()
    }
}

#[wasm_bindgen(js_name = validate)]
pub fn validate_js(manifest_json: &str, content_json: &str) -> String {
    crate::validate(manifest_json, content_json)
}

#[wasm_bindgen(js_name = replay)]
pub fn replay_js(manifest_json: &str, content_json: &str, seed: u32, inputs_json: &str) -> String {
    crate::replay(manifest_json, content_json, seed, inputs_json)
}

#[wasm_bindgen(js_name = catalog)]
pub fn catalog_js() -> String {
    crate::catalog()
}
