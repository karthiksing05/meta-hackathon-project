//! The JSON walk: every top-level section, rules, objectives, and the
//! whole-program static checks.

use std::rc::Rc;

use mg_core::diag::{Code, Diagnostic};
use mg_core::ir::{
    self, Dispatch, EventDef, Expr as IR, Function, InputDef, InputSource, Meta, Objectives, Outcome, Rule,
    PointerPhase, SourceTrigger, StateVar, TextInputSpec, TextPhase, Trigger,
};
use mg_core::limits::MAX_TEXT_INPUT_LEN;
use mg_core::types::Type;
use mg_core::value::Value;
use serde_json::{Map, Value as J};

use crate::check::{dym, placeholder, Checker, EventCtx, FnInfo, Payload, Root, StateInfo};
use crate::{is_ident, json_kind, ptr, src_of};

const TOP_KEYS: &[&str] = &[
    "format", "meta", "assets", "types", "state", "functions", "events", "inputs", "rules", "objectives", "physics",
    "presentation",
];
/// Accepted `format` tags. v0.2 is additive, so both compile the same way.
const FORMATS: &[&str] = &["microgame/0.1", "microgame/0.2"];
const SOURCE_KINDS: &[&str] = &["key", "swipe", "pointer", "text"];
const RESERVED: &[&str] = &["start", "tick", "win", "lose", "event"];

type Obj = Map<String, J>;

impl Checker {
    // ── Small JSON helpers ─────────────────────────────────────────────

    /// Reports keys not in `allowed` (keys starting with `_` are comments).
    /// Returns the allowed keys that a misspelled key was matched to, so the
    /// caller can skip the matching "missing field" error.
    pub fn check_keys(&mut self, m: &Obj, allowed: &[&'static str], at: &str, what: &str) -> Vec<&'static str> {
        let mut suggested = Vec::new();
        for k in m.keys() {
            if k.starts_with('_') || allowed.contains(&k.as_str()) {
                continue;
            }
            let lower = k.to_ascii_lowercase();
            let s = allowed
                .iter()
                .find(|a| **a == lower)
                .copied()
                .or_else(|| mg_core::diag::suggest(k, allowed.iter().copied()));
            let hint = match s {
                Some(s) => {
                    suggested.push(s);
                    Some(format!("did you mean '{s}'?"))
                }
                None => Some(format!("allowed keys: {}", allowed.join(", "))),
            };
            self.err_at(Code::BadField, &ptr(at, k), format!("unknown key '{k}' in {what}"), hint);
        }
        suggested
    }

    pub fn require<'v>(&mut self, m: &'v Obj, key: &str, at: &str, what: &str, suggested: &[&str]) -> Option<&'v J> {
        let v = m.get(key);
        if v.is_none() && !suggested.contains(&key) {
            self.err_at(Code::BadField, at, format!("{what} is missing '{key}'"), None);
        }
        v
    }

    pub fn obj<'v>(&mut self, v: &'v J, at: &str, what: &str) -> Option<&'v Obj> {
        match v {
            J::Object(m) => Some(m),
            other => {
                self.err_at(Code::Parse, at, format!("{what} must be an object, found {}", json_kind(other)), None);
                None
            }
        }
    }

    pub fn string<'v>(&mut self, v: &'v J, at: &str, what: &str) -> Option<&'v str> {
        match v {
            J::String(s) => Some(s),
            other => {
                self.err_at(Code::Parse, at, format!("{what} must be a string, found {}", json_kind(other)), None);
                None
            }
        }
    }

    /// Checks a JSON field holding an expression.
    pub fn expr_at(&mut self, v: &J, at: &str, exp: Option<&Type>) -> (IR, Type) {
        match src_of(v) {
            // A leading '=' can't start an expression, so it's tolerated
            // everywhere (presentation style uses it to mark expressions).
            Some(src) if src.trim_start().starts_with('=') => self.expr_src(&src.replacen('=', " ", 1), at, exp),
            Some(src) => self.expr_src(&src, at, exp),
            None => {
                self.err_at(Code::Parse, at, format!("expected an expression string, found {}", json_kind(v)), None);
                (placeholder(), exp.cloned().unwrap_or(Type::Unknown))
            }
        }
    }

    fn check_name(&mut self, name: &str, at: &str, what: &str) -> bool {
        if !is_ident(name) {
            self.err_at(
                Code::Parse,
                at,
                format!("{what} name '{name}' is not a valid name"),
                Some("names use letters, digits and '_', start with a letter, and aren't keywords".into()),
            );
            return false;
        }
        true
    }

    /// Payload declaration: `{ field: type }` in order.
    fn payload_decl(&mut self, v: &J, at: &str) -> Vec<(Rc<str>, Type)> {
        let Some(m) = self.obj(v, at, "a payload") else { return Vec::new() };
        let mut out = Vec::with_capacity(m.len());
        for (k, tv) in m {
            let fat = ptr(at, k);
            self.check_name(k, &fat, "payload field");
            let t = self.resolve_type(tv, &fat);
            out.push((Rc::from(k.as_str()), t));
        }
        out
    }

    /// Payload arguments for `emit`/`after`/input sources/`on_tap`: the
    /// `with` object must provide exactly the declared fields. Returns one
    /// expression per field, in declaration order.
    pub fn payload_args(
        &mut self,
        fields: &[(Rc<str>, Type)],
        with: Option<&J>,
        at: &str,
        target: &str,
        fallback_at: &str,
    ) -> Vec<IR> {
        let wat = ptr(at, "with");
        let empty = Map::new();
        let m = match with {
            None => &empty,
            Some(J::Object(m)) => m,
            Some(other) => {
                self.err_at(Code::Parse, &wat, format!("'with' must be an object, found {}", json_kind(other)), None);
                return fields.iter().map(|_| placeholder()).collect();
            }
        };
        for k in m.keys() {
            if !fields.iter().any(|(n, _)| **n == **k) {
                let msg = if fields.is_empty() {
                    format!("{target} has no payload, so '{k}' isn't allowed")
                } else {
                    format!("{target} has no payload field '{k}'")
                };
                let hint = dym(k, fields.iter().map(|(n, _)| &**n));
                self.err_at(Code::BadPayload, &ptr(&wat, k), msg, hint);
            }
        }
        let mut out = Vec::with_capacity(fields.len());
        for (n, t) in fields {
            match m.get(&**n) {
                Some(v) => out.push(self.expr_at(v, &ptr(&wat, n), Some(t)).0),
                None => {
                    let a = if with.is_some() { wat.clone() } else { fallback_at.to_string() };
                    self.err_at(
                        Code::BadPayload,
                        &a,
                        format!("missing payload field '{n}' ({t}) for {target}"),
                        Some(format!("add \"with\": {{\"{n}\": ...}}")),
                    );
                    out.push(placeholder());
                }
            }
        }
        out
    }

    /// Resolves a trigger name used by rule `on`, `animate_on` keys and
    /// feedback `on`. Reports `E_UNKNOWN_INPUT` / `E_UNKNOWN_EVENT`.
    pub fn unknown_trigger(&mut self, name: &str, at: &str, extra: &[&str]) {
        let mut cands: Vec<&str> = extra.to_vec();
        cands.extend(self.inputs.iter().map(|(n, _)| &**n));
        cands.extend(self.events.iter().map(|(n, _)| &**n));
        let s = mg_core::diag::suggest(name, cands.iter().copied());
        let is_event = s.is_some_and(|s| self.event_idx.contains_key(s));
        let (code, what) = if is_event { (Code::UnknownEvent, "event") } else { (Code::UnknownInput, "input or event") };
        let hint = match s {
            Some(s) => Some(format!("did you mean '{s}'?")),
            None => Some("declare it under \"inputs\" (player actions) or \"events\" (custom events)".to_string()),
        };
        self.err_at(code, at, format!("unknown {what} '{name}'"), hint);
    }

    pub fn timer_id(&mut self, name: &str) -> u16 {
        if let Some(i) = self.timer_names.iter().position(|n| &**n == name) {
            return i as u16;
        }
        self.timer_names.push(Rc::from(name));
        self.timer_has_after.push(false);
        (self.timer_names.len() - 1) as u16
    }

    // ── Sections ───────────────────────────────────────────────────────

    fn meta(&mut self, v: Option<&J>) -> Meta {
        let mut meta = Meta { title: Rc::from(""), instructions: Rc::from(""), duration_s: None, seed: None };
        let Some(v) = v else {
            self.err_at(Code::BadField, "", "the game file is missing 'meta'", Some("add \"meta\": {\"title\": ...}".into()));
            return meta;
        };
        let Some(m) = self.obj(v, "/meta", "meta") else { return meta };
        let sug = self.check_keys(m, &["title", "instructions", "duration_s", "seed"], "/meta", "meta");
        if let Some(t) = self.require(m, "title", "/meta", "meta", &sug) {
            if let Some(s) = self.string(t, "/meta/title", "title") {
                meta.title = Rc::from(s);
            }
        }
        if let Some(t) = m.get("instructions") {
            if let Some(s) = self.string(t, "/meta/instructions", "instructions") {
                meta.instructions = Rc::from(s);
            }
        }
        if let Some(d) = m.get("duration_s") {
            match d.as_f64() {
                Some(x) if x > 0.0 => meta.duration_s = Some(x),
                _ => self.err_at(Code::TypeMismatch, "/meta/duration_s", "duration_s must be a positive number of seconds", None),
            }
        }
        if let Some(s) = m.get("seed") {
            match s.as_u64() {
                Some(x) => meta.seed = Some(x),
                None => self.err_at(Code::TypeMismatch, "/meta/seed", "seed must be a non-negative integer", None),
            }
        }
        meta
    }

    fn declare_types(&mut self, v: Option<&J>) {
        let Some(v) = v else { return };
        let Some(m) = self.obj(v, "/types", "types") else { return };
        for (k, tv) in m {
            let at = ptr("/types", k);
            if !self.check_name(k, &at, "type") {
                continue;
            }
            if matches!(k.as_str(), "bool" | "int" | "float" | "string" | "ivec2" | "vec2" | "list" | "set" | "map" | "grid") {
                self.err_at(Code::Duplicate, &at, format!("'{k}' is a built-in type name"), None);
                continue;
            }
            let name: Rc<str> = Rc::from(k.as_str());
            self.raw_types.insert(name.clone(), (tv.clone(), at));
            self.type_names.push(name);
        }
        for name in self.type_names.clone() {
            let at = self.raw_types[&name].1.clone();
            self.named_type(&name, &at, None);
        }
    }

    fn declare_events(&mut self, v: Option<&J>) {
        let Some(v) = v else { return };
        let Some(m) = self.obj(v, "/events", "events") else { return };
        for (k, ev) in m {
            let at = ptr("/events", k);
            if !self.check_name(k, &at, "event") {
                continue;
            }
            if RESERVED.contains(&k.as_str()) {
                self.err_at(Code::Duplicate, &at, format!("'{k}' is reserved and can't be an event name"), None);
                continue;
            }
            // Accept `{"payload": {...}}` like inputs, as well as `{field: type}`.
            let payload = match ev {
                J::Object(o) if o.len() == 1 && matches!(o.get("payload"), Some(J::Object(_))) => {
                    self.payload_decl(&o["payload"], &ptr(&at, "payload"))
                }
                _ => self.payload_decl(ev, &at),
            };
            let id = self.events.len() as u16;
            self.event_idx.insert(Rc::from(k.as_str()), id);
            self.events.push((Rc::from(k.as_str()), Rc::from(payload)));
            self.emitted.push(false);
        }
    }

    fn declare_inputs(&mut self, v: Option<&J>) {
        let Some(v) = v else { return };
        let Some(m) = self.obj(v, "/inputs", "inputs") else { return };
        for (k, iv) in m {
            let at = ptr("/inputs", k);
            if !self.check_name(k, &at, "input") {
                continue;
            }
            if RESERVED.contains(&k.as_str()) {
                self.err_at(Code::Duplicate, &at, format!("'{k}' is reserved and can't be an input name"), None);
                continue;
            }
            if self.event_idx.contains_key(k.as_str()) {
                self.err_at(
                    Code::Duplicate,
                    &at,
                    format!("'{k}' is declared both as an input and as an event"),
                    Some("rename one of them".into()),
                );
                continue;
            }
            let mut payload = Vec::new();
            if let Some(o) = self.obj(iv, &at, "an input") {
                let o = o.clone();
                self.check_keys(&o, &["payload", "from", "when"], &at, &format!("input '{k}'"));
                if let Some(p) = o.get("payload") {
                    let pat = ptr(&at, "payload");
                    payload = self.payload_decl(p, &pat);
                    if payload.iter().any(|(n, _)| &**n == "t") {
                        self.err_at(
                            Code::Duplicate,
                            &ptr(&pat, "t"),
                            "payload field 't' is reserved: the engine adds event.t (the input time in ms)",
                            None,
                        );
                    }
                }
            }
            payload.push((Rc::from("t"), Type::Int));
            let id = self.inputs.len() as u16;
            self.input_idx.insert(Rc::from(k.as_str()), id);
            self.inputs.push((Rc::from(k.as_str()), Rc::from(payload)));
        }
    }

    fn declare_state(&mut self, v: Option<&J>) {
        let Some(v) = v else {
            self.err_at(Code::BadField, "", "the game file is missing 'state'", None);
            return;
        };
        let Some(m) = self.obj(v, "/state", "state") else { return };
        for (k, sv) in m {
            let at = ptr("/state", k);
            if !self.check_name(k, &at, "state") {
                continue;
            }
            if k == "event" {
                self.err_at(Code::Duplicate, &at, "'event' is reserved and can't be a state name", None);
                continue;
            }
            let mut ty = Type::Unknown;
            if let Some(o) = self.obj(sv, &at, "a state variable") {
                let sug = self.check_keys(o, &["type", "init"], &at, &format!("state '{k}'"));
                if let Some(t) = self.require(o, "type", &at, &format!("state '{k}'"), &sug) {
                    ty = self.resolve_type(t, &ptr(&at, "type"));
                }
                self.require(o, "init", &at, &format!("state '{k}'"), &sug);
            }
            let id = self.state.len() as u16;
            self.state_idx.insert(Rc::from(k.as_str()), id);
            self.state.push(StateInfo { name: Rc::from(k.as_str()), ty });
            self.state_read.push(false);
        }
    }

    fn declare_functions(&mut self, v: Option<&J>) {
        let Some(v) = v else { return };
        let Some(m) = self.obj(v, "/functions", "functions") else { return };
        for (k, fv) in m {
            let at = ptr("/functions", k);
            if !self.check_name(k, &at, "function") {
                continue;
            }
            let mut params = Vec::new();
            let mut ret = Type::Unknown;
            if let Some(o) = self.obj(fv, &at, "a function") {
                let what = format!("function '{k}'");
                let sug = self.check_keys(o, &["params", "returns", "body"], &at, &what);
                if let Some(p) = o.get("params") {
                    params = self.payload_decl(p, &ptr(&at, "params"));
                }
                if let Some(r) = self.require(o, "returns", &at, &what, &sug) {
                    ret = self.resolve_type(r, &ptr(&at, "returns"));
                }
                self.require(o, "body", &at, &what, &sug);
            }
            let id = self.funcs.len() as u16;
            self.fn_idx.insert(Rc::from(k.as_str()), id);
            self.funcs.push(FnInfo { name: Rc::from(k.as_str()), params: Rc::from(params), ret });
            self.calls.push(Vec::new());
        }
    }

    // ── Bodies ─────────────────────────────────────────────────────────

    fn state_inits(&mut self, v: Option<&J>) -> Vec<StateVar> {
        let mut out = Vec::with_capacity(self.state.len());
        let m = match v {
            Some(J::Object(m)) => m,
            _ => return out,
        };
        let mut i = 0usize;
        for (k, sv) in m {
            let Some(&id) = self.state_idx.get(k.as_str()) else { continue };
            if id as usize != i {
                continue;
            }
            i += 1;
            let ty = self.state[id as usize].ty.clone();
            let mut root = Root::new(EventCtx::None("state init runs before the game starts"), true, "");
            root.state_visible = id as usize;
            self.begin(root);
            let init = match sv.get("init") {
                Some(iv) => self.expr_at(iv, &ptr(&ptr("/state", k), "init"), Some(&ty)).0,
                None => placeholder(),
            };
            let n = self.end();
            out.push(StateVar { name: Rc::from(k.as_str()), ty, init, n_locals: n });
        }
        out
    }

    fn function_bodies(&mut self, v: Option<&J>) -> Vec<Function> {
        let mut out = Vec::with_capacity(self.funcs.len());
        let m = match v {
            Some(J::Object(m)) => m,
            _ => return out,
        };
        for (k, fv) in m {
            let Some(&id) = self.fn_idx.get(k.as_str()) else { continue };
            if id as usize != out.len() {
                continue;
            }
            let at = ptr("/functions", k);
            let params = self.funcs[id as usize].params.clone();
            let ret = self.funcs[id as usize].ret.clone();
            let mut root = Root::new(
                EventCtx::None("functions only see their parameters"),
                false,
                "in functions (functions must be pure)",
            );
            root.cur_fn = Some(id);
            self.begin(root);
            for (pn, pt) in params.iter() {
                let pat = ptr(&ptr(&at, "params"), pn);
                self.bind(pn.clone(), pt.clone(), None, Some(&pat));
            }
            let body = match fv.get("body") {
                Some(b) => self.expr_at(b, &ptr(&at, "body"), Some(&ret)).0,
                None => placeholder(),
            };
            let n = self.end();
            out.push(Function { name: Rc::from(k.as_str()), params: params.to_vec(), ret, body, n_locals: n });
        }
        out
    }

    fn input_defs(&mut self, v: Option<&J>) -> Vec<InputDef> {
        let mut out = Vec::with_capacity(self.inputs.len());
        let m = match v {
            Some(J::Object(m)) => m,
            _ => return out,
        };
        for (k, iv) in m {
            let Some(&id) = self.input_idx.get(k.as_str()) else { continue };
            if id as usize != out.len() {
                continue;
            }
            let at = ptr("/inputs", k);
            let payload: Payload = self.inputs[id as usize].1.clone();
            let declared: Vec<(Rc<str>, Type)> = payload[..payload.len() - 1].to_vec();
            let mut def = InputDef {
                name: Rc::from(k.as_str()),
                payload: payload.to_vec(),
                guard: None,
                guard_n_locals: 0,
                sources: Vec::new(),
            };
            if let Some(g) = iv.get("when") {
                self.begin(Root::new(EventCtx::Fields(payload.clone()), false, "in input guards"));
                def.guard = Some(self.expr_at(g, &ptr(&at, "when"), Some(&Type::Bool)).0);
                def.guard_n_locals = self.end();
            }
            if let Some(from) = iv.get("from") {
                let fat = ptr(&at, "from");
                match from {
                    J::Array(items) => {
                        for (i, src) in items.iter().enumerate() {
                            let sat = ptr(&fat, &i.to_string());
                            if let Some(s) = self.input_source(src, &sat, &declared, k) {
                                def.sources.push(s);
                            }
                        }
                    }
                    other => self.err_at(Code::Parse, &fat, format!("'from' must be a list, found {}", json_kind(other)), None),
                }
            }
            out.push(def);
        }
        out
    }

    fn input_source(&mut self, v: &J, at: &str, declared: &[(Rc<str>, Type)], input: &str) -> Option<InputSource> {
        let m = self.obj(v, at, "an input source")?;
        let kinds: Vec<&str> = SOURCE_KINDS.iter().copied().filter(|k| m.contains_key(*k)).collect();
        let kind = match kinds.as_slice() {
            [k] => *k,
            [] => {
                // Unknown source kind: point at the offending key.
                let unknown = m.keys().find(|k| !k.starts_with('_') && !matches!(k.as_str(), "with" | "on" | "placeholder" | "max_len"));
                match unknown {
                    Some(k) => {
                        let lower = k.to_ascii_lowercase();
                        let hint = dym(&lower, SOURCE_KINDS.iter().copied())
                            .or_else(|| match lower.as_str() {
                                "keys" | "keyboard" | "keydown" | "keyup" => Some("did you mean 'key'?".into()),
                                "tap" | "click" | "touch" | "mouse" | "drag" => Some(
                                    "taps on objects are wired with on_tap in presentation; for a pointer anywhere use {\"pointer\": \"down\"}".into(),
                                ),
                                _ => None,
                            })
                            .or_else(|| Some("sources: key, swipe, pointer, text".into()));
                        self.err_at(Code::BadField, &ptr(at, k), format!("unknown input source '{k}'"), hint);
                    }
                    None => self.err_at(
                        Code::BadField,
                        at,
                        "an input source needs one of \"key\", \"swipe\", \"pointer\" or \"text\"",
                        Some("like {\"key\": \"ArrowUp\", \"with\": {...}}".into()),
                    ),
                }
                return None;
            }
            [first, second, ..] => {
                self.err_at(
                    Code::BadField,
                    &ptr(at, second),
                    format!("an input source has exactly one of key, swipe, pointer or text; found both '{first}' and '{second}'"),
                    Some("put each one in its own entry of \"from\"".into()),
                );
                return None;
            }
        };
        let allowed: &[&'static str] = match kind {
            "key" => &["key", "on", "with"],
            "text" => &["text", "placeholder", "max_len", "with"],
            "swipe" => &["swipe", "with"],
            _ => &["pointer", "with"],
        };
        self.check_keys(m, allowed, at, &format!("a {kind} source"));
        let kat = ptr(at, kind);
        let word = |ck: &mut Self, options: &[&str], what: &str| -> Option<String> {
            let s = ck.string(&m[kind], &kat, kind)?;
            if options.contains(&s) {
                return Some(s.to_string());
            }
            let hint = dym(s, options.iter().copied());
            ck.err_at(Code::BadField, &kat, format!("{what} must be {}, found '{s}'", options.join(", ")), hint);
            None
        };
        let rec = |fields: &[(&str, Type)]| Type::record(fields.iter().map(|(n, t)| (Rc::from(*n), t.clone())).collect());
        let (trigger, lty) = match kind {
            "swipe" => {
                let s = word(self, &["any", "up", "down", "left", "right"], "swipe")?;
                let dir = match s.as_str() {
                    "up" => Some((0, -1)),
                    "down" => Some((0, 1)),
                    "left" => Some((-1, 0)),
                    "right" => Some((1, 0)),
                    _ => None,
                };
                (SourceTrigger::Swipe(dir), rec(&[("dir", Type::IVec2)]))
            }
            "key" => {
                let code = self.string(&m["key"], &kat, "key")?;
                if code.is_empty() {
                    self.err_at(Code::BadField, &kat, "key can't be empty", Some("use a key code like \"Space\" or \"ArrowUp\", or \"any\"".into()));
                    return None;
                }
                let code = if code == "any" { None } else { Some(Rc::from(code)) };
                let up = match m.get("on") {
                    None => false,
                    Some(J::String(s)) if s == "down" => false,
                    Some(J::String(s)) if s == "up" => true,
                    Some(other) => {
                        let hint = other.as_str().and_then(|s| dym(s, ["down", "up"]));
                        self.err_at(Code::BadField, &ptr(at, "on"), format!("'on' must be \"down\" or \"up\", found {other}"), hint);
                        false
                    }
                };
                (SourceTrigger::Key { code, up }, rec(&[("char", Type::Str), ("code", Type::Str)]))
            }
            "pointer" => {
                let s = word(self, &["down", "up", "move"], "pointer")?;
                let phase = match s.as_str() {
                    "down" => PointerPhase::Down,
                    "up" => PointerPhase::Up,
                    _ => PointerPhase::Move,
                };
                (SourceTrigger::Pointer(phase), rec(&[("x", Type::Float), ("y", Type::Float)]))
            }
            _ => {
                let s = word(self, &["submit", "change"], "text");
                let placeholder = match m.get("placeholder") {
                    None => None,
                    Some(J::String(p)) => Some(Rc::from(p.as_str())),
                    Some(other) => {
                        self.err_at(Code::TypeMismatch, &ptr(at, "placeholder"), format!("placeholder must be a string, found {}", json_kind(other)), None);
                        None
                    }
                };
                let max_len = match m.get("max_len") {
                    None => None,
                    Some(J::Number(n)) if n.as_u64().is_some_and(|x| x >= 1) => {
                        let x = n.as_u64().unwrap();
                        if x as usize > MAX_TEXT_INPUT_LEN {
                            self.err_at(
                                Code::Limit,
                                &ptr(at, "max_len"),
                                format!("max_len is {x}; the limit is {MAX_TEXT_INPUT_LEN}"),
                                None,
                            );
                        }
                        Some(x.min(MAX_TEXT_INPUT_LEN as u64) as u32)
                    }
                    Some(other) => {
                        self.err_at(Code::TypeMismatch, &ptr(at, "max_len"), format!("max_len must be a whole number >= 1, found {other}"), None);
                        None
                    }
                };
                match &self.text_input {
                    None => {
                        self.text_input = Some(TextInputSpec {
                            placeholder: placeholder.unwrap_or_else(|| Rc::from("Type here")),
                            max_len: max_len.unwrap_or(32),
                            rect: None,
                            size: None,
                        });
                    }
                    Some(first) => {
                        let differs = placeholder.is_some_and(|p| p != first.placeholder) || max_len.is_some_and(|n| n != first.max_len);
                        if differs {
                            self.err_at(
                                Code::Lint,
                                at,
                                "there is one text field: only the first text source's placeholder and max_len are used",
                                Some("set placeholder and max_len on the first text source only".into()),
                            );
                        }
                    }
                }
                let phase = if s? == "submit" { TextPhase::Submit } else { TextPhase::Change };
                (SourceTrigger::Text(phase), rec(&[("value", Type::Str)]))
            }
        };
        let mut root = Root::new(
            EventCtx::None("input sources build the payload from the source record (key, swipe, pointer or text)"),
            false,
            "in input sources",
        );
        root.next_slot = 0;
        self.begin(root);
        self.bind_slot(Rc::from(kind), lty, 0);
        self.root().next_slot = 1;
        let with = self.payload_args(declared, m.get("with"), at, &format!("input '{input}'"), at);
        let n = self.end();
        Some(InputSource { trigger, with, n_locals: n })
    }

    // ── Rules ──────────────────────────────────────────────────────────

    fn trigger(&mut self, v: &J, at: &str) -> (Option<Trigger>, EventCtx) {
        match v {
            J::String(s) => match s.as_str() {
                "start" => (Some(Trigger::Start), EventCtx::None("'start' rules have no event")),
                "tick" => {
                    let p: Payload = Rc::from(vec![(Rc::from("dt"), Type::Float)]);
                    (Some(Trigger::Tick), EventCtx::Fields(p))
                }
                name => {
                    if let Some(&id) = self.input_idx.get(name) {
                        return (Some(Trigger::Input(id)), EventCtx::Fields(self.inputs[id as usize].1.clone()));
                    }
                    if let Some(&id) = self.event_idx.get(name) {
                        return (Some(Trigger::Event(id)), EventCtx::Fields(self.events[id as usize].1.clone()));
                    }
                    if name == "win" || name == "lose" {
                        self.err_at(
                            Code::UnknownEvent,
                            at,
                            format!("rules can't run on '{name}'; the game is over by then"),
                            Some("use presentation feedback for win/lose effects".into()),
                        );
                    } else {
                        self.unknown_trigger(name, at, &["start", "tick"]);
                    }
                    (None, EventCtx::Any)
                }
            },
            J::Object(o) if o.contains_key("every") => {
                self.check_keys(o, &["every"], at, "a trigger");
                let eat = ptr(at, "every");
                let period = self.const_duration(&o["every"], &eat);
                (period.map(|p| Trigger::Every { period_ms: p }), EventCtx::None("'every' rules have no event"))
            }
            _ => {
                self.err_at(
                    Code::Parse,
                    at,
                    "'on' must be \"start\", \"tick\", an input or event name, or {\"every\": \"150ms\"}",
                    None,
                );
                (None, EventCtx::Any)
            }
        }
    }

    /// A duration expression that must fold to a positive constant (ms).
    pub fn const_duration(&mut self, v: &J, at: &str) -> Option<i64> {
        self.begin(Root::new(EventCtx::None("durations are constants"), false, "in durations"));
        let errs = self.error_count();
        let (ir, _) = self.expr_at(v, at, Some(&Type::Int));
        self.end();
        if self.error_count() > errs {
            return None;
        }
        match fold_int(&ir) {
            Some(ms) if ms > 0 => Some(ms),
            Some(ms) => {
                self.err_at(Code::TypeMismatch, at, format!("duration must be positive, found {ms}ms"), None);
                None
            }
            None => {
                self.err_at(Code::TypeMismatch, at, "duration must be a constant, like \"150ms\" or \"2s\"", None);
                None
            }
        }
    }

    fn rules(&mut self, v: Option<&J>) -> (Vec<Rule>, Dispatch) {
        let mut dispatch = Dispatch {
            input: vec![Vec::new(); self.inputs.len()],
            event: vec![Vec::new(); self.events.len()],
            ..Default::default()
        };
        let mut rules = Vec::new();
        let Some(v) = v else {
            self.err_at(Code::BadField, "", "the game file is missing 'rules'", None);
            return (rules, dispatch);
        };
        let J::Array(items) = v else {
            self.err_at(Code::Parse, "/rules", format!("rules must be a list, found {}", json_kind(v)), None);
            return (rules, dispatch);
        };
        let mut ids: Vec<Rc<str>> = Vec::new();
        for (i, rv) in items.iter().enumerate() {
            let at = ptr("/rules", &i.to_string());
            let Some(m) = self.obj(rv, &at, "a rule") else { continue };
            let sug = self.check_keys(m, &["id", "on", "when", "do"], &at, "a rule");
            let id: Rc<str> = match m.get("id") {
                Some(J::String(s)) => {
                    if ids.iter().any(|x| **x == **s) {
                        self.err_at(Code::Duplicate, &ptr(&at, "id"), format!("rule id '{s}' is used twice"), None);
                    }
                    Rc::from(s.as_str())
                }
                Some(other) => {
                    self.err_at(Code::Parse, &ptr(&at, "id"), format!("rule id must be a string, found {}", json_kind(other)), None);
                    Rc::from(format!("rule{i}"))
                }
                None => Rc::from(format!("rule{i}")),
            };
            ids.push(id.clone());
            let (trigger, ectx) = match self.require(m, "on", &at, "a rule", &sug) {
                Some(on) => self.trigger(on, &ptr(&at, "on")),
                None => (None, EventCtx::Any),
            };
            self.begin(Root::new(ectx, false, "in 'when' (conditions must not change the game)"));
            let when = m.get("when").map(|w| {
                let wat = ptr(&at, "when");
                if matches!(w, J::String(s) if s.trim() == "false") || matches!(w, J::Bool(false)) {
                    self.err_at(Code::UnreachableRule, &wat, format!("rule '{id}' never runs: its 'when' is false"), None);
                }
                self.expr_at(w, &wat, Some(&Type::Bool)).0
            });
            self.root().random_ok = true;
            self.root().pure_where = "here";
            let mut body = Vec::new();
            if let Some(d) = self.require(m, "do", &at, "a rule", &sug) {
                self.effects(d, &ptr(&at, "do"), &mut body);
            }
            let n = self.end();
            let rid = rules.len() as u16;
            let trig = trigger.clone().unwrap_or(Trigger::Start);
            if trigger.is_some() {
                match &trig {
                    Trigger::Start => dispatch.start.push(rid),
                    Trigger::Tick => dispatch.tick.push(rid),
                    Trigger::Every { period_ms } => dispatch.every.push((rid, *period_ms)),
                    Trigger::Input(x) => dispatch.input[*x as usize].push(rid),
                    Trigger::Event(x) => dispatch.event[*x as usize].push(rid),
                }
            }
            rules.push(Rule { id, at: Rc::from(at.as_str()), trigger: trig, when, body, n_locals: n });
        }
        (rules, dispatch)
    }

    // ── Objectives ─────────────────────────────────────────────────────

    fn objectives(&mut self, v: Option<&J>) -> Objectives {
        let mut o = Objectives { win: None, lose: None, score: None, time_limit_ms: None, on_timeout: Outcome::Lose, n_locals: 0 };
        let Some(v) = v else { return o };
        let Some(m) = self.obj(v, "/objectives", "objectives") else { return o };
        self.check_keys(m, &["win", "lose", "score", "time_limit", "on_timeout"], "/objectives", "objectives");
        self.begin(Root::new(
            EventCtx::None("objectives are checked after every event and don't see it"),
            false,
            "in objectives",
        ));
        if let Some(w) = m.get("win") {
            o.win = Some(self.expr_at(w, "/objectives/win", Some(&Type::Bool)).0);
        }
        if let Some(l) = m.get("lose") {
            o.lose = Some(self.expr_at(l, "/objectives/lose", Some(&Type::Bool)).0);
        }
        if let Some(s) = m.get("score") {
            let (ir, t) = self.expr_at(s, "/objectives/score", None);
            if !matches!(t, Type::Int | Type::Float | Type::Unknown) {
                self.err_at(
                    Code::TypeMismatch,
                    "/objectives/score",
                    format!("score must be a number, found {t}"),
                    None,
                );
            }
            o.score = Some(ir);
        }
        o.n_locals = self.end();
        if let Some(t) = m.get("time_limit") {
            if let J::Number(_) = t {
                self.err_at(
                    Code::TypeMismatch,
                    "/objectives/time_limit",
                    "time_limit must be a duration string",
                    Some("write it with a unit, like \"90s\"".into()),
                );
            } else {
                o.time_limit_ms = self.const_duration(t, "/objectives/time_limit");
            }
        }
        if let Some(t) = m.get("on_timeout") {
            match t.as_str() {
                Some("win") => o.on_timeout = Outcome::Win,
                Some("lose") => o.on_timeout = Outcome::Lose,
                _ => self.err_at(Code::TypeMismatch, "/objectives/on_timeout", "on_timeout must be \"win\" or \"lose\"", None),
            }
        }
        o
    }

    // ── Whole-program checks ───────────────────────────────────────────

    fn recursion(&mut self) {
        let n = self.funcs.len();
        // 0 = unvisited, 1 = on stack, 2 = done
        let mut color = vec![0u8; n];
        let mut reported: Vec<Vec<u16>> = Vec::new();
        for start in 0..n {
            if color[start] != 0 {
                continue;
            }
            // Iterative DFS with an explicit path.
            let mut stack: Vec<(u16, usize)> = vec![(start as u16, 0)];
            color[start] = 1;
            while let Some(&mut (f, ref mut next)) = stack.last_mut() {
                if *next < self.calls[f as usize].len() {
                    let site_idx = *next;
                    *next += 1;
                    let callee = self.calls[f as usize][site_idx].callee;
                    match color[callee as usize] {
                        0 => {
                            color[callee as usize] = 1;
                            stack.push((callee, 0));
                        }
                        1 => {
                            let pos = stack.iter().position(|(g, _)| *g == callee).unwrap();
                            let mut cyc: Vec<u16> = stack[pos..].iter().map(|(g, _)| *g).collect();
                            let mut key = cyc.clone();
                            key.sort_unstable();
                            if !reported.contains(&key) {
                                reported.push(key);
                                cyc.push(callee);
                                let path =
                                    cyc.iter().map(|g| &*self.funcs[*g as usize].name).collect::<Vec<_>>().join(" → ");
                                let site = &self.calls[f as usize][site_idx];
                                let msg = if cyc.len() == 2 {
                                    format!("function '{}' calls itself", self.funcs[callee as usize].name)
                                } else {
                                    format!("functions call each other in a cycle: {path}")
                                };
                                let d = Diagnostic::new(Code::Recursion, &*site.at, msg)
                                    .with_span(site.span)
                                    .with_hint("functions can't recurse; loop over a collection with map, fold or filter instead");
                                self.push_diag(d);
                            }
                        }
                        _ => {}
                    }
                } else {
                    color[f as usize] = 2;
                    stack.pop();
                }
            }
        }
    }

    fn final_checks(&mut self, top: &Obj, rules: &[Rule], objectives: &Objectives) {
        self.recursion();
        // Rules on events nobody emits.
        for (i, r) in rules.iter().enumerate() {
            if let Trigger::Event(e) = r.trigger {
                if !self.emitted[e as usize] {
                    let name = self.events[e as usize].0.clone();
                    self.err_at(
                        Code::UnreachableRule,
                        &ptr(&ptr("/rules", &i.to_string()), "on"),
                        format!("rule '{}' never runs: no effect emits '{name}'", r.id),
                        Some(format!("add {{\"emit\": \"{name}\"}} somewhere, or remove the rule")),
                    );
                }
            }
        }
        for (i, s) in self.state.iter().enumerate() {
            if !self.state_read[i] {
                let d = Diagnostic::new(
                    Code::UnusedState,
                    ptr("/state", &s.name),
                    format!("state '{}' is never read (not by rules, objectives or presentation)", s.name),
                )
                .with_hint("remove it, or show it in the presentation");
                if self.mute == 0 {
                    self.diags.push(d);
                }
            }
        }
        if objectives.win.is_none()
            && objectives.lose.is_none()
            && objectives.time_limit_ms.is_none()
            && !self.has_end_effect
            && !top.get("objectives").is_some_and(|o| o.get("time_limit").is_some())
        {
            let at = if top.contains_key("objectives") { "/objectives" } else { "" };
            self.err_at(
                Code::NoEndCondition,
                at,
                "the game can never end",
                Some("add objectives.win, objectives.lose, objectives.time_limit, or an {\"end\": \"win\"} effect".into()),
            );
        }
        for (id, at) in std::mem::take(&mut self.cancel_sites) {
            if !self.timer_has_after[id as usize] {
                let name = self.timer_names[id as usize].clone();
                let cands: Vec<&str> = self
                    .timer_names
                    .iter()
                    .zip(&self.timer_has_after)
                    .filter(|(_, h)| **h)
                    .map(|(n, _)| &**n)
                    .collect();
                let hint = dym(&name, cands);
                self.err_at(Code::UnknownName, &at, format!("no 'after' effect has id '{name}'"), hint);
            }
        }
    }
}

/// Constant-folds simple int expressions (durations like `2 * 60s`).
pub(crate) fn fold_int(e: &IR) -> Option<i64> {
    use mg_core::ast::{BinOp, UnOp};
    match e {
        IR::Const(Value::Int(n)) => Some(*n),
        IR::Unary(UnOp::Neg, x) => fold_int(x).map(|v| -v),
        IR::Binary(op, a, b) => {
            let (a, b) = (fold_int(a)?, fold_int(b)?);
            match op {
                BinOp::Add => a.checked_add(b),
                BinOp::Sub => a.checked_sub(b),
                BinOp::Mul => a.checked_mul(b),
                BinOp::Div if b != 0 => a.checked_div(b),
                _ => None,
            }
        }
        _ => None,
    }
}

pub fn compile_program(src: &str) -> (Option<ir::Program>, Vec<Diagnostic>) {
    let mut ck = Checker::default();
    let root: J = match crate::dupjson::parse(src) {
        Ok((v, dups)) => {
            for at in dups {
                let key = at.rsplit('/').next().unwrap_or("").replace("~1", "/").replace("~0", "~");
                ck.err_at(
                    Code::Duplicate,
                    &at,
                    format!("key '{key}' appears twice in the same object; only the last one would be used"),
                    Some("remove or rename one of them".into()),
                );
            }
            v
        }
        Err(e) => {
            let d = Diagnostic::new(Code::Parse, "", format!("invalid JSON: {e}"));
            return (None, vec![d]);
        }
    };
    let J::Object(top) = &root else {
        let d = Diagnostic::new(Code::Parse, "", format!("the game file must be a JSON object, found {}", json_kind(&root)));
        ck.diags.push(d);
        return (None, ck.diags);
    };
    ck.check_keys(top, TOP_KEYS, "", "the game file");
    let latest = FORMATS[FORMATS.len() - 1];
    match top.get("format") {
        None => ck.err_at(Code::Format, "/format", format!("missing \"format\": \"{latest}\""), None),
        Some(J::String(s)) if FORMATS.contains(&s.as_str()) => {}
        Some(other) => ck.err_at(
            Code::Format,
            "/format",
            format!("unsupported format {other}; expected \"{latest}\" (or \"microgame/0.1\")"),
            None,
        ),
    }
    let meta = ck.meta(top.get("meta"));
    let assets = ck.assets(top.get("assets"));
    ck.declare_types(top.get("types"));
    ck.declare_events(top.get("events"));
    ck.declare_inputs(top.get("inputs"));
    ck.declare_state(top.get("state"));
    ck.declare_functions(top.get("functions"));

    let state = ck.state_inits(top.get("state"));
    let functions = ck.function_bodies(top.get("functions"));
    let inputs = ck.input_defs(top.get("inputs"));
    let (rules, dispatch) = ck.rules(top.get("rules"));
    let objectives = ck.objectives(top.get("objectives"));
    let presentation = ck.presentation(top.get("presentation"));
    let physics = ck.physics(top.get("physics"), (presentation.canvas.w, presentation.canvas.h));
    let text_input = match (ck.text_input.take(), ck.text_field.take()) {
        (Some(mut t), Some((rect, size))) => {
            t.rect = rect;
            t.size = size;
            Some(t)
        }
        (Some(t), None) => Some(t),
        (None, Some(_)) => {
            ck.err_at(
                Code::Lint,
                "/presentation/text_field",
                "text_field is set, but no input has a text source, so no text field is shown",
                Some("add {\"text\": \"submit\", \"with\": {...}} to an input's \"from\"".into()),
            );
            None
        }
        (None, None) => None,
    };
    ck.final_checks(top, &rules, &objectives);

    let mut diags = std::mem::take(&mut ck.diags);
    diags.sort_by(|a, b| a.at.cmp(&b.at).then(a.span.cmp(&b.span)));
    diags.dedup();
    if diags.iter().any(|d| d.is_error()) {
        return (None, diags);
    }
    let events =
        ck.events.iter().map(|(n, p)| EventDef { name: n.clone(), payload: p.to_vec() }).collect::<Vec<_>>();
    let program = ir::Program {
        meta,
        state,
        functions,
        events,
        inputs,
        rules,
        dispatch,
        timer_names: std::mem::take(&mut ck.timer_names),
        objectives,
        presentation,
        assets,
        physics,
        text_input,
    };
    (Some(program), diags)
}
