//! Manifest + content validator.

use crate::catalog::Catalog;
use crate::glue::GlueHost;
use crate::types::{Content, Manifest};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Serialize, Clone, Debug)]
pub struct Issue {
    pub path: String,
    pub msg: String,
}

#[derive(Serialize, Default, Debug)]
pub struct Report {
    pub ok: bool,
    pub errors: Vec<Issue>,
    pub warnings: Vec<Issue>,
}

impl Report {
    fn err(&mut self, path: impl Into<String>, msg: impl Into<String>) {
        self.errors.push(Issue { path: path.into(), msg: msg.into() });
    }

    fn warn(&mut self, path: impl Into<String>, msg: impl Into<String>) {
        self.warnings.push(Issue { path: path.into(), msg: msg.into() });
    }

    pub fn summary(&self) -> String {
        self.errors.iter().map(|e| format!("{}: {}", e.path, e.msg)).collect::<Vec<_>>().join("; ")
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{\"ok\":false,\"errors\":[],\"warnings\":[]}".into())
    }
}

const LEVELS: [&str; 3] = ["remix", "compose", "free"];
const SEED_SCOPES: [&str; 3] = ["per_challenge", "daily", "per_play"];
const MAX_SCRIPT_LEN: usize = 8000;

pub fn validate(manifest_json: &str, content_json: &str) -> Report {
    let mut r = Report::default();
    let cat = Catalog::load();

    let mv: Option<Value> = serde_json::from_str(manifest_json).map_err(|e| r.err("manifest", format!("invalid JSON: {e}"))).ok();
    let cv: Option<Value> = serde_json::from_str(content_json).map_err(|e| r.err("content", format!("invalid JSON: {e}"))).ok();

    let mut needed_content: Vec<(String, bool)> = Vec::new();
    if let Some(mv) = &mv {
        if let Some(m) = check_manifest(&mut r, &cat, mv) {
            needed_content = concept_content_needs(&cat, &m);
        }
    }
    if let Some(cv) = &cv {
        check_content(&mut r, &cat, cv, mv.as_ref(), &needed_content);
    }
    r.ok = r.errors.is_empty();
    r
}

/// Content kinds required by the manifest's concepts, with whether the concept is implemented.
fn concept_content_needs(cat: &Catalog, m: &Manifest) -> Vec<(String, bool)> {
    let mut out: Vec<(String, bool)> = Vec::new();
    for c in &m.concepts {
        if let Some(spec) = cat.concept(&c.id) {
            if let Some(kind) = &spec.content {
                out.push((kind.clone(), spec.status == "implemented"));
            }
        }
    }
    out
}

fn check_manifest(r: &mut Report, cat: &Catalog, mv: &Value) -> Option<Manifest> {
    if !mv.is_object() {
        r.err("manifest", "must be a JSON object");
        return None;
    }
    if mv["schema"] != "sg.manifest/1" {
        r.err("manifest.schema", "must be \"sg.manifest/1\"");
    }
    match mv["title"].as_str() {
        Some(t) if !t.trim().is_empty() && t.chars().count() <= 80 => {}
        _ => r.err("manifest.title", "must be a non-empty string of at most 80 characters"),
    }
    if let Some(l) = mv.get("level").and_then(Value::as_str) {
        if !LEVELS.contains(&l) {
            r.err("manifest.level", format!("must be one of {LEVELS:?}"));
        }
    }
    if let Some(s) = mv.get("seed_scope").and_then(Value::as_str) {
        if !SEED_SCOPES.contains(&s) {
            r.err("manifest.seed_scope", format!("must be one of {SEED_SCOPES:?}"));
        }
    }
    if !mv["concepts"].is_array() {
        r.err("manifest.concepts", "must be an array");
        return None;
    }
    let m: Manifest = match serde_json::from_value(mv.clone()) {
        Ok(m) => m,
        Err(e) => {
            r.err("manifest", format!("wrong shape: {e}"));
            return None;
        }
    };

    let mut seen: HashSet<&str> = HashSet::new();
    // input.tap is built in for glue, but as a consumed event it must come from an input concept.
    let mut emitted: HashSet<String> =
        cat.events.iter().filter(|e| e.builtin && e.name != "input.tap").map(|e| e.name.clone()).collect();
    for (i, c) in m.concepts.iter().enumerate() {
        let path = format!("manifest.concepts[{i}]");
        if !seen.insert(c.id.as_str()) {
            r.err(format!("{path}.id"), format!("duplicate concept '{}'", c.id));
        }
        let Some(spec) = cat.concept(&c.id) else {
            r.err(format!("{path}.id"), format!("unknown concept '{}'", c.id));
            continue;
        };
        emitted.extend(spec.emits.iter().cloned());
        for (k, v) in &c.params {
            let Some(ps) = spec.params.get(k) else {
                r.err(format!("{path}.params.{k}"), format!("'{}' has no param '{k}'", c.id));
                continue;
            };
            if let Err(msg) = check_param(ps, v) {
                r.err(format!("{path}.params.{k}"), msg);
            }
        }
    }
    let ids: HashSet<&str> = m.concepts.iter().map(|c| c.id.as_str()).collect();
    if !ids.contains("flow.session") {
        r.err("manifest.concepts", "must include flow.session");
    }
    let has_glue = !m.glue.is_empty();
    let spaces: Vec<&str> = ids.iter().copied().filter(|i| i.starts_with("space.")).collect();
    let has_canvas_space = spaces.iter().any(|i| *i != "space.choice_board");
    if spaces.len() > 1 {
        r.err("manifest.concepts", format!("use exactly one space.* concept, found {}", spaces.len()));
    }
    for (i, c) in m.concepts.iter().enumerate() {
        let Some(spec) = cat.concept(&c.id) else { continue };
        let path = format!("manifest.concepts[{i}]");
        for req in &spec.requires {
            if !ids.contains(req.as_str()) {
                r.err(&path, format!("'{}' requires '{req}'", c.id));
            }
        }
        for con in &spec.conflicts {
            if ids.contains(con.as_str()) {
                r.err(&path, format!("'{}' conflicts with '{con}'", c.id));
            }
        }
        let available = |ev: &String| emitted.contains(ev) || (ev.starts_with("glue.") && has_glue);
        if spec.consumes_any {
            if !spec.consumes.is_empty() && !spec.consumes.iter().any(available) {
                r.err(&path, format!("'{}' needs at least one of {:?} to be emitted by another concept", c.id, spec.consumes));
            }
        } else {
            for ev in &spec.consumes {
                if !available(ev) {
                    r.err(&path, format!("'{}' consumes '{ev}' but no concept in the manifest emits it", c.id));
                }
            }
        }
        if (c.id.starts_with("entity.") || c.id.starts_with("behavior.")) && c.id != "entity.hint_giver" && !has_canvas_space {
            r.err(&path, format!("'{}' needs a play space: add one of the space.* concepts (not space.choice_board)", c.id));
        }
        if spec.status != "implemented" {
            r.warn(&path, format!("'{}' is a stub; it is accepted but inert at runtime", c.id));
        }
    }

    check_glue(r, cat, &m);
    Some(m)
}

fn check_glue(r: &mut Report, cat: &Catalog, m: &Manifest) {
    let mut ok = true;
    let mut seen: HashSet<&str> = HashSet::new();
    for (i, g) in m.glue.iter().enumerate() {
        let path = format!("manifest.glue[{i}]");
        if g.id.trim().is_empty() || !seen.insert(g.id.as_str()) {
            r.err(format!("{path}.id"), "must be a unique non-empty string");
            ok = false;
        }
        if g.on.is_empty() {
            r.err(format!("{path}.on"), "must list at least one event");
            ok = false;
        }
        for ev in &g.on {
            if !cat.is_known_event(ev) {
                r.err(format!("{path}.on"), format!("unknown event '{ev}'"));
                ok = false;
            }
        }
        if g.script.len() > MAX_SCRIPT_LEN {
            r.err(format!("{path}.script"), format!("longer than {MAX_SCRIPT_LEN} characters"));
            ok = false;
        }
    }
    if !ok || m.glue.is_empty() {
        return;
    }
    match GlueHost::new(&m.glue) {
        Err(errs) => {
            for (i, msg) in errs {
                r.err(format!("manifest.glue[{i}].script"), msg);
            }
        }
        Ok(mut host) => {
            for (i, msg) in host.dry_run() {
                r.err(format!("manifest.glue[{i}].script"), msg);
            }
        }
    }
}

fn check_param(ps: &crate::types::ParamSpec, v: &Value) -> Result<(), String> {
    let range = |n: f64| -> Result<(), String> {
        if let Some(min) = ps.min {
            if n < min {
                return Err(format!("{n} is below the minimum {min}"));
            }
        }
        if let Some(max) = ps.max {
            if n > max {
                return Err(format!("{n} is above the maximum {max}"));
            }
        }
        Ok(())
    };
    match ps.ty.as_str() {
        "int" | "duration_ms" => match v.as_i64() {
            Some(n) => range(n as f64),
            None => Err(format!("expected an integer, got {v}")),
        },
        "float" => match v.as_f64() {
            Some(n) => range(n),
            None => Err(format!("expected a number, got {v}")),
        },
        "bool" => v.is_boolean().then_some(()).ok_or_else(|| format!("expected a boolean, got {v}")),
        "string" => match v.as_str() {
            Some(s) if s.len() <= 200 => Ok(()),
            Some(_) => Err("string longer than 200 characters".into()),
            None => Err(format!("expected a string, got {v}")),
        },
        "enum" => match v.as_str() {
            Some(s) if ps.values.as_ref().map_or(false, |vals| vals.iter().any(|x| x == s)) => Ok(()),
            _ => Err(format!("expected one of {:?}, got {v}", ps.values.clone().unwrap_or_default())),
        },
        "color" => match v.as_str() {
            Some(s) if is_color(s) => Ok(()),
            _ => Err(format!("expected a color (#rgb, #rrggbb, #rrggbbaa or a name), got {v}")),
        },
        other => Err(format!("catalog param has unknown type '{other}'")),
    }
}

fn is_color(s: &str) -> bool {
    if let Some(hex) = s.strip_prefix('#') {
        return matches!(hex.len(), 3 | 6 | 8) && hex.chars().all(|c| c.is_ascii_hexdigit());
    }
    !s.is_empty() && s.len() <= 24 && s.chars().all(|c| c.is_ascii_alphabetic())
}

fn check_content(r: &mut Report, _cat: &Catalog, cv: &Value, mv: Option<&Value>, needs: &[(String, bool)]) {
    if !cv.is_object() {
        r.err("content", "must be a JSON object");
        return;
    }
    if cv["schema"] != "sg.content/1" {
        r.err("content.schema", "must be \"sg.content/1\"");
    }
    let c: Content = match serde_json::from_value(cv.clone()) {
        Ok(c) => c,
        Err(e) => {
            r.err("content", format!("wrong shape: {e}"));
            return;
        }
    };
    if c.items.is_empty() {
        r.err("content.items", "must contain at least one item");
    }
    let mut ids: HashSet<&str> = HashSet::new();
    let mut questions = 0usize;
    let mut missing_media = false;
    for (i, it) in c.items.iter().enumerate() {
        let path = format!("content.items[{i}]");
        if it.id.is_empty() || !ids.insert(it.id.as_str()) {
            r.err(format!("{path}.id"), "must be a unique non-empty string");
        }
        if it.kind != "question" && !it.kind.is_empty() {
            continue;
        }
        questions += 1;
        if it.prompt.trim().is_empty() {
            r.err(format!("{path}.prompt"), "must be non-empty");
        }
        if it.choices.len() < 2 || it.choices.len() > 6 || it.choices.iter().any(|c| c.trim().is_empty()) {
            r.err(format!("{path}.choices"), "needs 2-6 non-empty choices");
        }
        match it.answer {
            Some(a) if a >= 0 && (a as usize) < it.choices.len() => {}
            _ => r.err(format!("{path}.answer"), "must be an index into choices"),
        }
        if it.media_url.is_none() {
            missing_media = true;
        }
    }
    for (kind, implemented) in needs {
        let have = c.items.iter().any(|it| it.kind == *kind || (kind == "question" && it.kind.is_empty()));
        if !have {
            let msg = format!("concepts need '{kind}' items but content has none");
            if *implemented {
                r.err("content.items", msg);
            } else {
                r.warn("content.items", msg);
            }
        }
    }
    let uses_photos = mv
        .and_then(|m| m["concepts"].as_array())
        .map_or(false, |cs| cs.iter().any(|x| x["id"] == "content.photo_prompt"));
    if uses_photos && missing_media {
        r.warn("content.items", "content.photo_prompt is enabled but some questions have no media_url");
    }
    let rounds = mv
        .and_then(|m| m["concepts"].as_array())
        .and_then(|cs| cs.iter().find(|x| x["id"] == "flow.rounds"))
        .map(|x| x["params"]["rounds"].as_i64().unwrap_or(8));
    if let Some(n) = rounds {
        if (questions as i64) < n {
            r.warn("content.items", format!("flow.rounds asks for {n} rounds but only {questions} questions exist"));
        }
    }
}
