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
            match engine.compile(&g.script) {
                Ok(ast) => {
                    if !ast.iter_functions().any(|f| f.name == "on_event" && f.params.len() == 1) {
                        errors.push((i, "script must define fn on_event(ev)".to_string()));
                        continue;
                    }
                    entries.push(Entry { id: g.id.clone(), on: g.on.clone(), ast, disabled: false });
                }
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
        let mut scope = Scope::new();
        let res = self.engine.call_fn::<Dynamic>(&mut scope, &self.entries[i].ast, "on_event", (arg,));
        let cx = std::mem::take(&mut *self.ctx.borrow_mut());
        if let Err(e) = res {
            return Err(e.to_string());
        }
        if let Some(r) = cx.rng {
            g.rng = r;
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
