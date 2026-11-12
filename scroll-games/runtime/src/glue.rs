//! Rhai glue host: sandboxed scripts that react to events.

use crate::game::Game;
use crate::rng::Rng;
use crate::types::{Event, GlueEntry};
use rhai::{Dynamic, Engine, Map as RMap, Scope, AST, INT};
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

pub const MAX_OPERATIONS: u64 = 50_000;

#[derive(Default)]
struct Ctx {
    vars: BTreeMap<String, Value>,
    writes: Vec<(String, Value)>,
    emits: Vec<Event>,
    logs: Vec<String>,
    rng: Option<Rng>,
}

struct Entry {
    id: String,
    on: Vec<String>,
    ast: AST,
    /// Name the script gave the event parameter of `on_event`.
    param: String,
    disabled: bool,
}

pub struct GlueHost {
    engine: Engine,
    ctx: Rc<RefCell<Ctx>>,
    entries: Vec<Entry>,
}

fn dyn_to_value(d: &Dynamic) -> Value {
    if d.is_unit() {
        Value::Null
    } else if let Ok(b) = d.as_bool() {
        Value::Bool(b)
    } else if let Ok(i) = d.as_int() {
        json!(i)
    } else if let Ok(f) = d.as_float() {
        serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
    } else if d.is_string() {
        Value::String(d.clone().into_string().unwrap_or_default())
    } else if d.is_array() {
        let arr = d.clone().into_array().unwrap_or_default();
        Value::Array(arr.iter().map(dyn_to_value).collect())
    } else if d.is_map() {
        let map = d.clone().try_cast::<RMap>().unwrap_or_default();
        Value::Object(map.iter().map(|(k, v)| (k.to_string(), dyn_to_value(v))).collect())
    } else {
        Value::Null
    }
}

fn value_to_dyn(v: &Value) -> Dynamic {
    match v {
        Value::Null => Dynamic::UNIT,
        Value::Bool(b) => Dynamic::from(*b),
        Value::Number(n) => match n.as_i64() {
            Some(i) => Dynamic::from(i as INT),
            None => Dynamic::from(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => Dynamic::from(s.clone()),
        Value::Array(a) => Dynamic::from(a.iter().map(value_to_dyn).collect::<Vec<_>>()),
        Value::Object(o) => {
            let mut m = RMap::new();
            for (k, x) in o {
                m.insert(k.as_str().into(), value_to_dyn(x));
            }
            Dynamic::from(m)
        }
    }
}

fn build_engine(ctx: Rc<RefCell<Ctx>>) -> Engine {
    let mut engine = Engine::new();
    engine.set_max_operations(MAX_OPERATIONS);
    engine.set_max_expr_depths(32, 32);
    engine.set_max_string_size(1024);
    engine.set_max_array_size(256);
    engine.set_max_map_size(64);
    engine.set_max_call_levels(16);
    engine.disable_symbol("eval");

    let c = ctx.clone();
    engine.register_fn("emit", move |name: &str, data: RMap| {
        c.borrow_mut().emits.push(Event::new(name, dyn_to_value(&Dynamic::from(data))));
    });
    let c = ctx.clone();
    engine.register_fn("emit", move |name: &str| {
        c.borrow_mut().emits.push(Event::new(name, json!({})));
    });
    let c = ctx.clone();
    engine.register_fn("get", move |key: &str| -> Dynamic {
        c.borrow().vars.get(key).map(value_to_dyn).unwrap_or(Dynamic::UNIT)
    });
    let c = ctx.clone();
    engine.register_fn("set", move |key: &str, val: Dynamic| {
        let v = dyn_to_value(&val);
        let mut cx = c.borrow_mut();
        cx.vars.insert(key.to_string(), v.clone());
        cx.writes.push((key.to_string(), v));
    });
    let c = ctx.clone();
    engine.register_fn("rand_int", move |lo: INT, hi: INT| -> INT {
        let mut cx = c.borrow_mut();
        match cx.rng.as_mut() {
            Some(r) => r.range_inclusive(lo, hi),
            None => lo,
        }
    });
    let c = ctx;
    engine.register_fn("log", move |msg: Dynamic| {
        c.borrow_mut().logs.push(msg.to_string());
    });
    engine
}

impl GlueHost {
    /// Compile all glue entries. Errors are `(entry index, message)`.
    pub fn new(glue: &[GlueEntry]) -> Result<GlueHost, Vec<(usize, String)>> {
        let ctx = Rc::new(RefCell::new(Ctx::default()));
        let engine = build_engine(ctx.clone());
        let mut entries = Vec::new();
        let mut errors = Vec::new();
        for (i, g) in glue.iter().enumerate() {
            let Some((param, source)) = split_on_event(&g.script) else {
                errors.push((i, "script must define fn on_event(ev)".to_string()));
                continue;
            };
            match engine.compile(&source) {
                Ok(ast) => entries.push(Entry { id: g.id.clone(), on: g.on.clone(), ast, param, disabled: false }),
                Err(e) => errors.push((i, format!("compile error: {e}"))),
            }
        }
        if errors.is_empty() {
            Ok(GlueHost { engine, ctx, entries })
        } else {
            Err(errors)
        }
    }

    /// Run every subscribed entry for `ev`. A failing entry is disabled for the session.
    pub fn dispatch(&mut self, g: &mut Game, ev: &Event) {
        for i in 0..self.entries.len() {
            if self.entries[i].disabled || !self.entries[i].on.iter().any(|n| n == &ev.name) {
                continue;
            }
            if let Err(msg) = self.run_entry(i, g, ev) {
                self.entries[i].disabled = true;
                let id = self.entries[i].id.clone();
                g.warn(format!("glue '{id}' disabled: {msg}"));
            }
        }
    }

    /// Execute one entry; apply its effects to `g` only if it succeeds.
    fn run_entry(&mut self, i: usize, g: &mut Game, ev: &Event) -> Result<(), String> {
        {
            let mut cx = self.ctx.borrow_mut();
            *cx = Ctx { vars: g.snapshot(), rng: Some(g.rng), ..Ctx::default() };
        }
        let mut arg = RMap::new();
        arg.insert("name".into(), Dynamic::from(ev.name.clone()));
        arg.insert("data".into(), value_to_dyn(&ev.data));
        let initial = g.snapshot();
        let mut scope = Scope::new();
        for (k, v) in &initial {
            if is_ident(k) {
                scope.push_dynamic(k.as_str(), value_to_dyn(v));
            }
        }
        let base = scope.len();
        scope.push_dynamic(self.entries[i].param.as_str(), Dynamic::from(arg));
        let res = self.engine.run_ast_with_scope(&mut scope, &self.entries[i].ast);
        let cx = std::mem::take(&mut *self.ctx.borrow_mut());
        if let Err(e) = res {
            return Err(e.to_string());
        }
        if let Some(r) = cx.rng {
            g.rng = r;
        }
        // Bare-variable assignments (`score += 10`) land in the scope; shadowing `let`s sit past `base`.
        for (name, _, val) in scope.iter().take(base) {
            let now = dyn_to_value(&val);
            if initial.get(name) != Some(&now) {
                g.set_var(name, now);
            }
        }
        for (k, v) in cx.writes {
            g.set_var(&k, v);
        }
        for e in cx.emits {
            if e.name.starts_with("glue.") || e.name.starts_with("feedback.") {
                g.pending.push(e);
            } else {
                g.warn(format!("glue '{}' may only emit glue.* or feedback.* events, not '{}'", self.entries[i].id, e.name));
            }
        }
        for l in cx.logs {
            g.log(format!("[{}] {}", self.entries[i].id, l));
        }
        Ok(())
    }

    /// Validation dry-run: returns `(entry index, message)` for every failure.
    pub fn dry_run(&mut self) -> Vec<(usize, String)> {
        let mut errors = Vec::new();
        for (round, total) in [(1, 8), (8, 8)] {
            for i in 0..self.entries.len() {
                let events = self.entries[i].on.clone();
                for name in events {
                    let mut g = Game::synthetic(round, total);
                    let ev = Event::new(&name, synthetic_data(&name, round));
                    if let Err(m) = self.run_entry(i, &mut g, &ev) {
                        errors.push((i, format!("dry-run on '{name}' failed: {m}")));
                    }
                }
            }
        }
        errors.dedup();
        errors
    }
}

fn is_ident(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Skip a string, char literal or comment starting at `i`; returns the index after it, or `i` if none starts here.
fn skip_literal(b: &[u8], i: usize) -> usize {
    let n = b.len();
    match b[i] {
        b'"' | b'\'' => {
            let q = b[i];
            let mut j = i + 1;
            while j < n && b[j] != q {
                j += if b[j] == b'\\' { 2 } else { 1 };
            }
            (j + 1).min(n)
        }
        b'`' => {
            let mut j = i + 1;
            while j < n && b[j] != b'`' {
                j += 1;
            }
            (j + 1).min(n)
        }
        b'/' if i + 1 < n && b[i + 1] == b'/' => {
            let mut j = i;
            while j < n && b[j] != b'\n' {
                j += 1;
            }
            j
        }
        b'/' if i + 1 < n && b[i + 1] == b'*' => {
            let (mut j, mut depth) = (i + 2, 1);
            while j < n && depth > 0 {
                if b[j] == b'/' && j + 1 < n && b[j + 1] == b'*' {
                    depth += 1;
                    j += 2;
                } else if b[j] == b'*' && j + 1 < n && b[j + 1] == b'/' {
                    depth -= 1;
                    j += 2;
                } else {
                    j += 1;
                }
            }
            j
        }
        _ => i,
    }
}

fn skip_ws(b: &[u8], mut i: usize) -> usize {
    while i < b.len() && b[i].is_ascii_whitespace() {
        i += 1;
    }
    i
}

/// Rhai functions cannot see scope variables, so the body of `fn on_event(ev) { .. }` is lifted to
/// top-level statements (run with a scope holding the game vars and the event). Returns the event
/// parameter name and the rewritten script: other functions first, then the body.
fn split_on_event(src: &str) -> Option<(String, String)> {
    let b = src.as_bytes();
    let n = b.len();
    let mut depth = 0i32;
    let mut i = 0;
    while i < n {
        let j = skip_literal(b, i);
        if j != i {
            i = j;
            continue;
        }
        match b[i] {
            b'{' => depth += 1,
            b'}' => depth -= 1,
            b'f' if depth == 0
                && src[i..].starts_with("fn")
                && (i == 0 || !(b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_')) =>
            {
                if let Some(found) = parse_on_event(src, i) {
                    return Some(found);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn parse_on_event(src: &str, at: usize) -> Option<(String, String)> {
    let b = src.as_bytes();
    let mut i = skip_ws(b, at + 2);
    let rest = &src[i..];
    if !rest.starts_with("on_event") {
        return None;
    }
    i = skip_ws(b, i + "on_event".len());
    if b.get(i) != Some(&b'(') {
        return None;
    }
    i = skip_ws(b, i + 1);
    let start = i;
    while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') {
        i += 1;
    }
    let param = &src[start..i];
    if !is_ident(param) {
        return None;
    }
    i = skip_ws(b, i);
    if b.get(i) != Some(&b')') {
        return None;
    }
    i = skip_ws(b, i + 1);
    if b.get(i) != Some(&b'{') {
        return None;
    }
    let open = i;
    let mut depth = 0i32;
    while i < b.len() {
        let j = skip_literal(b, i);
        if j != i {
            i = j;
            continue;
        }
        match b[i] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    let body = &src[open + 1..i];
                    let script = format!("{}\n{}\n{}", &src[..at], &src[i + 1..], body);
                    return Some((param.to_string(), script));
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn synthetic_data(name: &str, round: i64) -> Value {
    let mut m = Map::new();
    match name {
        "round.started" | "round.ended" | "timer.expired" => {
            m.insert("round".into(), json!(round));
        }
        "answer.correct" => {
            m.insert("round".into(), json!(round));
            m.insert("ms".into(), json!(1500));
        }
        "answer.wrong" => {
            m.insert("round".into(), json!(round));
            m.insert("index".into(), json!(1));
        }
        "input.choice" => {
            m.insert("index".into(), json!(0));
        }
        "score.changed" => {
            m.insert("score".into(), json!(100));
            m.insert("delta".into(), json!(100));
        }
        "streak.changed" => {
            m.insert("streak".into(), json!(2));
        }
        "game.over" => {
            m.insert("score".into(), json!(800));
        }
        "feedback.flash" => {
            m.insert("color".into(), json!("green"));
        }
        "feedback.haptic" => {
            m.insert("style".into(), json!("success"));
        }
        _ => {}
    }
    Value::Object(m)
}
