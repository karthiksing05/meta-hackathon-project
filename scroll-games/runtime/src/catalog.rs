//! Embedded concept and event catalogs.

use crate::types::{ConceptSpec, EventSpec};

pub const CONCEPTS_JSON: &str = include_str!("../../spec/concepts.json");
pub const EVENTS_JSON: &str = include_str!("../../spec/events.json");

pub struct Catalog {
    pub concepts: Vec<ConceptSpec>,
    pub events: Vec<EventSpec>,
}

impl Catalog {
    pub fn load() -> Catalog {
        Catalog {
            concepts: serde_json::from_str(CONCEPTS_JSON).expect("embedded concepts.json is valid"),
            events: serde_json::from_str::<serde_json::Value>(EVENTS_JSON)
                .ok()
                .and_then(|v| serde_json::from_value(v["events"].clone()).ok())
                .expect("embedded events.json is valid"),
        }
    }

    pub fn concept(&self, id: &str) -> Option<&ConceptSpec> {
        self.concepts.iter().find(|c| c.id == id)
    }

    pub fn is_known_event(&self, name: &str) -> bool {
        name.starts_with("glue.") || self.events.iter().any(|e| e.name == name)
    }

    pub fn is_builtin_event(&self, name: &str) -> bool {
        self.events.iter().any(|e| e.name == name && e.builtin)
    }
}
