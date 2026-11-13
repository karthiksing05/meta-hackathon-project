//! Rule effects (spec A10) → `ir::Effect`.

use std::rc::Rc;

use mg_core::ast::{BinOp, ExprKind, Span, UnOp};
use mg_core::builtins::Builtin;
use mg_core::diag::Code;
use mg_core::ir::{Effect, Expr as IR, FieldIdx, Outcome, PathStep, Place};
use mg_core::types::Type;
use mg_core::value::Value;
use serde_json::Value as J;

use crate::check::{dym, tyname, Checker};
use crate::{is_ident, json_kind, ptr, src_of};

/// Effect kinds, in the order the head key is looked for (`after` first,
/// since it also has an `emit` key).
const HEADS: &[&str] = &["after", "set", "incr", "decr", "let", "if", "for_each", "emit", "cancel", "end", "push", "remove"];

fn allowed(kind: &str) -> &'static [&'static str] {
    match kind {
        "set" => &["set", "to"],
        "incr" => &["incr", "by"],
        "decr" => &["decr", "by"],
        "let" => &["let"],
        "if" => &["if", "then", "else"],
        "for_each" => &["for_each", "as", "do"],
        "emit" => &["emit", "with"],
        "after" => &["after", "emit", "with", "id"],
        "cancel" => &["cancel"],
        "end" => &["end"],
        "push" => &["push", "value", "item"],
        "remove" => &["remove", "where", "value"],
        _ => &[],
    }
}

/// A resolved assignment target.
struct PlaceInfo {
    place: Place,
    ty: Type,
    /// Expression reading the current value of the place.
    read: IR,
}

enum Step<'a> {
    Field(&'a Rc<str>, Span),
    Index(&'a mg_core::ast::Expr),
}

impl Checker {
    /// Lowers a `do` list. `let` bindings stay visible until the end of it.
    pub fn effects(&mut self, v: &J, at: &str, out: &mut Vec<Effect>) {
        let J::Array(items) = v else {
            self.err_at(Code::Parse, at, format!("expected a list of effects, found {}", json_kind(v)), None);
            return;
        };
        let mark = self.scope_mark();
        for (j, e) in items.iter().enumerate() {
            self.effect(e, &ptr(at, &j.to_string()), out);
        }
        self.scope_reset(mark);
    }

    fn effect(&mut self, v: &J, at: &str, out: &mut Vec<Effect>) {
        let Some(m) = self.obj(v, at, "an effect") else { return };
        let Some(kind) = HEADS.iter().copied().find(|h| m.contains_key(*h)) else {
            // Look for a misspelled head key.
            for k in m.keys() {
                if let Some(s) = mg_core::diag::suggest(&k.to_ascii_lowercase(), HEADS.iter().copied()) {
                    self.err_at(
                        Code::BadField,
                        &ptr(at, k),
                        format!("unknown effect '{k}'"),
                        Some(format!("did you mean '{s}'?")),
                    );
                    return;
                }
            }
            self.err_at(
                Code::BadField,
                at,
                "unknown effect: expected one of set, incr, decr, let, if, for_each, emit, after, cancel, end, push, remove",
                None,
            );
            return;
        };
        let what = format!("a '{kind}' effect");
        let sug = self.check_keys(m, allowed(kind), at, &what);
        let head = &m[kind];
        let hat = ptr(at, kind);
        match kind {
            "set" => {
                let p = self.place(head, &hat, out, false);
                let to = self.require(m, "to", at, &what, &sug);
                let (Some(p), Some(to)) = (p, to) else {
                    if let Some(to) = to {
                        self.expr_at(to, &ptr(at, "to"), None);
                    }
                    return;
                };
                let (value, _) = self.expr_at(to, &ptr(at, "to"), Some(&p.ty));
                out.push(Effect::Set { place: p.place, value });
            }
            "incr" | "decr" => {
                let Some(p) = self.place(head, &hat, out, true) else {
                    if let Some(by) = m.get("by") {
                        self.expr_at(by, &ptr(at, "by"), None);
                    }
                    return;
                };
                let numeric = matches!(p.ty, Type::Int | Type::Float | Type::Unknown);
                if !numeric {
                    self.err_at(
                        Code::TypeMismatch,
                        &hat,
                        format!("{kind} needs an int or float, found {}", tyname(&p.ty)),
                        None,
                    );
                }
                let by = match m.get("by") {
                    Some(b) => self.expr_at(b, &ptr(at, "by"), Some(&p.ty)).0,
                    None if p.ty == Type::Float => IR::Const(Value::Float(1.0)),
                    None => IR::Const(Value::Int(1)),
                };
                let op = if kind == "incr" { BinOp::Add } else { BinOp::Sub };
                let value = IR::Binary(op, Box::new(p.read), Box::new(by));
                out.push(Effect::Set { place: p.place, value });
            }
            "let" => {
                let Some(lm) = self.obj(head, &hat, "'let'") else { return };
                if lm.is_empty() {
                    self.err_at(Code::BadField, &hat, "'let' needs at least one name, like {\"let\": {\"x\": \"1\"}}", None);
                }
                for (name, ev) in lm {
                    let lat = ptr(&hat, name);
                    let (value, ty) = self.expr_at(ev, &lat, None);
                    if !is_ident(name) {
                        self.err_at(Code::Parse, &lat, format!("'{name}' is not a valid name"), None);
                        continue;
                    }
                    let slot = self.bind(Rc::from(name.as_str()), ty, None, Some(&lat));
                    out.push(Effect::Let { slot, value });
                }
            }
            "if" => {
                let (cond, _) = self.expr_at(head, &hat, Some(&Type::Bool));
                let mut then = Vec::new();
                if let Some(t) = self.require(m, "then", at, &what, &sug) {
                    self.effects(t, &ptr(at, "then"), &mut then);
                }
                let mut els = Vec::new();
                if let Some(e) = m.get("else") {
                    self.effects(e, &ptr(at, "else"), &mut els);
                }
                out.push(Effect::If { cond, then, els });
            }
            "for_each" => {
                let (collection, ct) = self.expr_at(head, &hat, None);
                let item = match &ct {
                    Type::List(t) | Type::Set(t) => (**t).clone(),
                    Type::Unknown => Type::Unknown,
                    t => {
                        let hint = match t {
                            Type::Grid(_) => Some("loop over cells(g) to get every coordinate".to_string()),
                            Type::Map(..) => Some("loop over keys(m) or values(m)".to_string()),
                            Type::Int => Some("use range(n) to loop n times".to_string()),
                            _ => None,
                        };
                        self.err_at(Code::TypeMismatch, &hat, format!("for_each needs a list or set, found {}", tyname(t)), hint);
                        Type::Unknown
                    }
                };
                let mark = self.scope_mark();
                let aat = ptr(at, "as");
                let slot = match self.require(m, "as", at, &what, &sug) {
                    Some(J::String(name)) if is_ident(name) => self.bind(Rc::from(name.as_str()), item, None, Some(&aat)),
                    Some(other) => {
                        self.err_at(Code::Parse, &aat, format!("'as' must be a variable name, found {other}"), None);
                        self.alloc()
                    }
                    None => self.alloc(),
                };
                let mut body = Vec::new();
                if let Some(d) = self.require(m, "do", at, &what, &sug) {
                    self.effects(d, &ptr(at, "do"), &mut body);
                }
                self.scope_reset(mark);
                out.push(Effect::ForEach { slot, collection, body });
            }
            "emit" => {
                let Some(event) = self.emit_target(head, &hat) else {
                    self.check_with_loose(m.get("with"), at);
                    return;
                };
                let fields = self.events[event as usize].1.clone();
                let target = format!("event '{}'", self.events[event as usize].0);
                let args = self.payload_args(&fields, m.get("with"), at, &target, at);
                out.push(Effect::Emit { event, args });
            }
            "after" => {
                let (delay, _) = self.expr_at(head, &hat, Some(&Type::Int));
                let ev = match self.require(m, "emit", at, &what, &sug) {
                    Some(e) => self.emit_target(e, &ptr(at, "emit")),
                    None => None,
                };
                let timer = match m.get("id") {
                    Some(J::String(s)) => {
                        let id = self.timer_id(s);
                        self.timer_has_after[id as usize] = true;
                        Some(id)
                    }
                    Some(other) => {
                        self.err_at(Code::Parse, &ptr(at, "id"), format!("'id' must be a string, found {}", json_kind(other)), None);
                        None
                    }
                    None => None,
                };
                let Some(event) = ev else {
                    self.check_with_loose(m.get("with"), at);
                    return;
                };
                let fields = self.events[event as usize].1.clone();
                let target = format!("event '{}'", self.events[event as usize].0);
                let args = self.payload_args(&fields, m.get("with"), at, &target, at);
                out.push(Effect::After { delay, event, args, timer });
            }
            "cancel" => {
                let Some(name) = self.string(head, &hat, "'cancel'") else { return };
                let id = self.timer_id(name);
                self.cancel_sites.push((id, hat.clone()));
                out.push(Effect::Cancel { timer: id });
            }
            "end" => {
                self.has_end_effect = true;
                match head.as_str() {
                    Some("win") => out.push(Effect::End(Outcome::Win)),
                    Some("lose") => out.push(Effect::End(Outcome::Lose)),
                    other => {
                        let hint = other.and_then(|s| dym(s, ["win", "lose"]));
                        self.err_at(Code::BadField, &hat, "'end' must be \"win\" or \"lose\"", hint);
                    }
                }
            }
            "push" => {
                let value_key = if m.contains_key("value") { "value" } else { "item" };
                let Some(p) = self.place(head, &hat, out, true) else {
                    if let Some(v) = m.get(value_key) {
                        self.expr_at(v, &ptr(at, value_key), None);
                    }
                    return;
                };
                let Some(v) = m.get(value_key) else {
                    if !sug.contains(&"value") && !sug.contains(&"item") {
                        self.err_at(Code::BadField, at, "'push' is missing 'value'", Some("like {\"push\": \"items\", \"value\": \"x\"}".into()));
                    }
                    return;
                };
                let vat = ptr(at, value_key);
                let value = match &p.ty {
                    Type::List(t) => {
                        let (x, _) = self.expr_at(v, &vat, Some(t));
                        IR::Builtin(Builtin::Concat, vec![p.read, IR::List(vec![x].into_boxed_slice())].into_boxed_slice())
                    }
                    Type::Set(t) => {
                        let (x, _) = self.expr_at(v, &vat, Some(t));
                        IR::Builtin(Builtin::Add, vec![p.read, x].into_boxed_slice())
                    }
                    t => {
                        if !t.is_unknown() {
                            self.err_at(Code::TypeMismatch, &hat, format!("push needs a list or set, found {}", tyname(t)), None);
                        }
                        self.expr_at(v, &vat, None);
                        return;
                    }
                };
                out.push(Effect::Set { place: p.place, value });
            }
            "remove" => self.remove_effect(m, at, &hat, out, &sug),
            _ => unreachable!(),
        }
    }

    /// Checks `with` values when the target event is unknown, for errors.
    fn check_with_loose(&mut self, with: Option<&J>, at: &str) {
        if let Some(J::Object(w)) = with {
            let wat = ptr(at, "with");
            for (k, v) in w {
                self.expr_at(v, &ptr(&wat, k), None);
            }
        }
    }

    fn emit_target(&mut self, v: &J, at: &str) -> Option<u16> {
        let name = self.string(v, at, "the event name")?;
        if let Some(&id) = self.event_idx.get(name) {
            self.emitted[id as usize] = true;
            return Some(id);
        }
        if self.input_idx.contains_key(name) {
            self.err_at(
                Code::UnknownEvent,
                at,
                format!("'{name}' is an input; only custom events (declared under \"events\") can be emitted"),
                Some("declare a custom event under \"events\" and emit that".into()),
            );
            return None;
        }
        let hint = dym(name, self.events.iter().map(|(n, _)| &**n))
            .or_else(|| Some(format!("declare it under \"events\", like \"{name}\": {{}}")));
        self.err_at(Code::UnknownEvent, at, format!("unknown event '{name}'"), hint);
        None
    }

    fn remove_effect(&mut self, m: &serde_json::Map<String, J>, at: &str, hat: &str, out: &mut Vec<Effect>, sug: &[&str]) {
        let Some(p) = self.place(m.get("remove").unwrap(), hat, out, true) else { return };
        if let Some(w) = m.get("where") {
            let wat = ptr(at, "where");
            let Some(src) = src_of(w) else {
                self.err_at(Code::Parse, &wat, "'where' must be a lambda string, like \"m => m.y > 700\"", None);
                return;
            };
            let Some(e) = self.parse(&src, &wat) else { return };
            let elem = match &p.ty {
                Type::List(t) => (**t).clone(),
                Type::Unknown => Type::Unknown,
                t => {
                    let hint = if matches!(t, Type::Set(_) | Type::Map(..)) {
                        Some("for sets and maps use \"value\": the item or key to remove".to_string())
                    } else {
                        None
                    };
                    self.err_at(Code::TypeMismatch, hat, format!("remove ... where needs a list, found {}", tyname(t)), hint);
                    Type::Unknown
                }
            };
            let ExprKind::Lambda(ps, body) = &e.kind else {
                self.err(Code::BadLambda, e.span, "'where' must be a lambda, like \"m => m.y > 700\"");
                return;
            };
            if ps.len() != 1 {
                self.err(Code::BadLambda, e.span, format!("the 'where' lambda takes 1 parameter, found {}", ps.len()));
                return;
            }
            let mark = self.scope_mark();
            let slot = self.bind(ps[0].0.clone(), elem, Some(ps[0].1), None);
            let (pred, _) = self.check(body, Some(&Type::Bool));
            self.scope_reset(mark);
            let keep = IR::Lambda { params: vec![slot].into_boxed_slice(), body: Box::new(IR::Unary(UnOp::Not, Box::new(pred))) };
            let value = IR::Builtin(Builtin::Filter, vec![p.read, keep].into_boxed_slice());
            out.push(Effect::Set { place: p.place, value });
            return;
        }
        if let Some(v) = m.get("value") {
            let vat = ptr(at, "value");
            let value = match &p.ty {
                Type::Set(t) | Type::Map(t, _) => {
                    let (x, _) = self.expr_at(v, &vat, Some(t));
                    IR::Builtin(Builtin::Remove, vec![p.read, x].into_boxed_slice())
                }
                Type::List(t) => {
                    // filter(place, x => x != value), with value evaluated once.
                    let (x, _) = self.expr_at(v, &vat, Some(t));
                    let vslot = self.alloc();
                    out.push(Effect::Let { slot: vslot, value: x });
                    let item = self.alloc();
                    let pred = IR::Binary(BinOp::Ne, Box::new(IR::Local(item)), Box::new(IR::Local(vslot)));
                    let keep = IR::Lambda { params: vec![item].into_boxed_slice(), body: Box::new(pred) };
                    IR::Builtin(Builtin::Filter, vec![p.read, keep].into_boxed_slice())
                }
                t => {
                    if !t.is_unknown() {
                        self.err_at(Code::TypeMismatch, hat, format!("remove needs a list, set or map, found {}", tyname(t)), None);
                    }
                    self.expr_at(v, &vat, None);
                    return;
                }
            };
            out.push(Effect::Set { place: p.place, value });
            return;
        }
        if !sug.contains(&"where") && !sug.contains(&"value") {
            self.err_at(
                Code::BadField,
                at,
                "'remove' needs 'where' (a lambda, for lists) or 'value' (for sets and maps)",
                Some("like {\"remove\": \"meteors\", \"where\": \"m => m.y > 700\"}".into()),
            );
        }
    }

    /// Resolves an assignment target: a state name followed by `.field` /
    /// `[index]`. With `hoist`, index expressions are evaluated once into
    /// `let` slots (the place is both read and written).
    fn place(&mut self, v: &J, at: &str, out: &mut Vec<Effect>, hoist: bool) -> Option<PlaceInfo> {
        let Some(src) = src_of(v) else {
            self.err_at(Code::Parse, at, format!("expected a state name like \"score\" or \"board[c]\", found {}", json_kind(v)), None);
            return None;
        };
        let e = self.parse(&src, at)?;
        let mut steps = Vec::new();
        let mut cur = &e;
        let (base, bspan) = loop {
            match &cur.kind {
                ExprKind::Field(b, n, ns) => {
                    steps.push(Step::Field(n, *ns));
                    cur = b;
                }
                ExprKind::Index(b, i) => {
                    steps.push(Step::Index(i));
                    cur = b;
                }
                ExprKind::Ident(n) => break (n, cur.span),
                _ => {
                    self.err_h(
                        Code::NotAssignable,
                        cur.span,
                        "only a state variable or a part of one can be set",
                        Some("write a state name, optionally followed by .field or [index], like \"board[c]\"".into()),
                    );
                    return None;
                }
            }
        };
        steps.reverse();
        if self.r().scope.iter().any(|l| l.name == *base) || &**base == "event" {
            self.err_h(
                Code::NotAssignable,
                bspan,
                format!("'{base}' is not a state variable; only state can be changed"),
                Some("locals, event fields and constants are read-only".into()),
            );
            return None;
        }
        let Some(&sid) = self.state_idx.get(base) else {
            let hint = dym(base, self.state.iter().map(|s| &*s.name));
            self.err_h(Code::UnknownName, bspan, format!("unknown state variable '{base}'"), hint);
            return None;
        };
        if hoist {
            self.state_read[sid as usize] = true;
        }
        let mut ty = self.state[sid as usize].ty.clone();
        let mut read = IR::State(sid);
        let mut path = Vec::with_capacity(steps.len());
        for step in steps {
            match step {
                Step::Field(n, ns) => match &ty {
                    Type::Record(rt) => match rt.index_of(n) {
                        Some(i) => {
                            path.push(PathStep::Field(i as FieldIdx));
                            read = IR::Field(Box::new(read), i as FieldIdx);
                            ty = rt.fields[i].1.clone();
                        }
                        None => {
                            let hint = dym(n, rt.fields.iter().map(|(f, _)| &**f));
                            self.err_h(Code::UnknownName, ns, format!("no field '{n}' in {ty}"), hint);
                            return None;
                        }
                    },
                    Type::IVec2 | Type::Vec2 => {
                        self.err_h(
                            Code::NotAssignable,
                            ns,
                            format!("can't set .{n} of a vector on its own"),
                            Some("set the whole vector, like \"to\": \"vec(x, pos.y)\"".into()),
                        );
                        return None;
                    }
                    Type::Unknown => return None,
                    t => {
                        let msg = format!("{} has no field '{n}'", tyname(t));
                        self.err_h(Code::NotAssignable, ns, msg, None);
                        return None;
                    }
                },
                Step::Index(ie) => {
                    let key = match &ty {
                        Type::List(_) => Type::Int,
                        Type::Grid(_) => Type::IVec2,
                        Type::Map(k, _) => (**k).clone(),
                        Type::Unknown => return None,
                        t => {
                            let msg = format!("can't index {} with [...]", tyname(t));
                            self.err_h(Code::NotAssignable, ie.span, msg, None);
                            return None;
                        }
                    };
                    let (mut ii, _) = self.check(ie, Some(&key));
                    if hoist && !matches!(ii, IR::Const(_) | IR::Local(_)) {
                        let slot = self.alloc();
                        out.push(Effect::Let { slot, value: ii });
                        ii = IR::Local(slot);
                    }
                    ty = match &ty {
                        Type::List(t) | Type::Grid(t) => (**t).clone(),
                        Type::Map(_, v) => (**v).clone(),
                        _ => unreachable!(),
                    };
                    read = IR::Index(Box::new(read), Box::new(ii.clone()));
                    path.push(PathStep::Index(ii));
                }
            }
        }
        if let Type::Option(_) = &ty {
            // Setting an optional is fine; only reads through it need or_else.
        }
        Some(PlaceInfo { place: Place { state: sid, path }, ty, read })
    }
}
