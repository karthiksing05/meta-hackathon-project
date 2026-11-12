//! Serde types for manifests, content and events.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Manifest {
    pub schema: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub template: String,
    #[serde(default = "default_seed_scope")]
    pub seed_scope: String,
    #[serde(default)]
    pub concepts: Vec<ConceptRef>,
    #[serde(default)]
    pub glue: Vec<GlueEntry>,
    #[serde(default)]
    pub theme: Value,
}

fn default_seed_scope() -> String {
    "per_challenge".into()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ConceptRef {
    pub id: String,
    #[serde(default)]
    pub params: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GlueEntry {
    pub id: String,
    #[serde(default)]
    pub on: Vec<String>,
    pub script: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Content {
    pub schema: String,
    #[serde(default)]
    pub items: Vec<Item>,
    #[serde(default)]
    pub copy: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
pub struct Item {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub media_id: Option<String>,
    #[serde(default)]
    pub media_url: Option<String>,
    #[serde(default)]
    pub choices: Vec<String>,
    #[serde(default)]
    pub answer: Option<i64>,
    #[serde(default)]
    pub clue: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Event {
    pub name: String,
    pub data: Value,
}

impl Event {
    pub fn new(name: &str, data: Value) -> Self {
        Event { name: name.to_string(), data }
    }

    pub fn to_json(&self) -> Value {
        json!({ "name": self.name, "data": self.data })
    }
}

/// One recorded input, applied on `tick`.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RecordedInput {
    pub tick: u64,
    pub input: Value,
}

// ---- concept catalog types ----

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
pub struct ParamSpec {
    #[serde(rename = "type")]
    pub ty: String,
    #[serde(default)]
    pub default: Value,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
    #[serde(default)]
    pub values: Option<Vec<String>>,
    #[serde(default)]
    pub doc: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ConceptSpec {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub summary: String,
    pub status: String,
    #[serde(default)]
    pub params: std::collections::BTreeMap<String, ParamSpec>,
    #[serde(default)]
    pub consumes: Vec<String>,
    #[serde(default)]
    pub emits: Vec<String>,
    #[serde(default)]
    pub requires: Vec<String>,
    #[serde(default)]
    pub conflicts: Vec<String>,
    #[serde(default)]
    pub content: Option<String>,
    /// When true, only one of `consumes` has to be available (e.g. `rule.lives`).
    #[serde(default)]
    pub consumes_any: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct EventSpec {
    pub name: String,
    #[serde(default)]
    pub builtin: bool,
}
