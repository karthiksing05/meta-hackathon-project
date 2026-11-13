//! Expression checker: name resolution, bidirectional type checking and
//! lowering to `ir::Expr`, all in one pass over the AST.
//!
//! Error recovery: every failure reports one diagnostic and returns
//! `Type::Unknown`, which is compatible with everything, so follow-on errors
//! are suppressed.

use std::collections::HashMap;
use std::rc::Rc;

use mg_core::ast::{self, BinOp, ExprKind, RecordItem, Span, UnOp};
use mg_core::builtins::{Builtin, CONSTANTS};
use mg_core::diag::{suggest, Code, Diagnostic};
use mg_core::ir::{Expr as IR, FieldIdx, Slot};
use mg_core::types::{RecordType, Type};
use mg_core::value::Value;

use crate::parser;

pub(crate) type Payload = Rc<[(Rc<str>, Type)]>;

/// `presentation.text_field`: optional rect and font size.
pub(crate) type TextField = (Option<(f64, f64, f64, f64)>, Option<f64>);

pub(crate) struct Local {
    pub name: Rc<str>,
    pub slot: Slot,
    pub ty: Type,
}

/// What `event` means in the current root.
#[derive(Clone)]
pub(crate) enum EventCtx {
    /// No event here; the string explains why (used in the error message).
    None(&'static str),
    Fields(Payload),
    /// The trigger itself is broken; anything goes (avoids cascades).
    Any,
}

pub(crate) struct Root {
    pub next_slot: u32,
    pub scope: Vec<Local>,
    pub event: EventCtx,
    pub random_ok: bool,
    /// For `E_RANDOM_IN_PURE` messages: "in 'when'", "in functions", ...
    pub pure_where: &'static str,
    pub presentation: bool,
    pub cur_fn: Option<u16>,
    /// State variables with index `< state_visible` can be read (state init
    /// can only read earlier state).
    pub state_visible: usize,
}

impl Root {
    pub fn new(event: EventCtx, random_ok: bool, pure_where: &'static str) -> Root {
        Root {
            next_slot: 0,
            scope: Vec::new(),
            event,
            random_ok,
            pure_where,
            presentation: false,
            cur_fn: None,
            state_visible: usize::MAX,
        }
    }
}

pub(crate) struct StateInfo {
    pub name: Rc<str>,
    pub ty: Type,
}

pub(crate) struct FnInfo {
    pub name: Rc<str>,
    pub params: Rc<[(Rc<str>, Type)]>,
    pub ret: Type,
}

pub(crate) struct CallSite {
    pub callee: u16,
    pub at: Rc<str>,
    pub span: Span,
}

#[derive(Default)]
pub(crate) struct Checker {
    pub diags: Vec<Diagnostic>,
    pub mute: u32,
    pub at: Rc<str>,

    pub raw_types: HashMap<Rc<str>, (serde_json::Value, String)>,
    pub types: HashMap<Rc<str>, Type>,
    pub type_names: Vec<Rc<str>>,
    pub resolving: Vec<Rc<str>>,

    pub state: Vec<StateInfo>,
    pub state_idx: HashMap<Rc<str>, u16>,
    pub funcs: Vec<FnInfo>,
    pub fn_idx: HashMap<Rc<str>, u16>,
    pub events: Vec<(Rc<str>, Payload)>,
    pub event_idx: HashMap<Rc<str>, u16>,
    /// Payload includes the trailing `t: int`.
    pub inputs: Vec<(Rc<str>, Payload)>,
    pub input_idx: HashMap<Rc<str>, u16>,
    pub tokens: HashMap<Rc<str>, (Value, Type)>,

    pub state_read: Vec<bool>,
    pub calls: Vec<Vec<CallSite>>,
    pub emitted: Vec<bool>,
    pub has_end_effect: bool,
    pub timer_names: Vec<Rc<str>>,
    pub timer_has_after: Vec<bool>,
    pub cancel_sites: Vec<(u16, String)>,

    /// v0.2 assets: name and kind (`None` when the asset itself is broken,
    /// so references to it don't cascade).
    pub assets: Vec<(Rc<str>, Option<crate::assets::AssetUse>)>,
    pub asset_idx: HashMap<Rc<str>, u16>,
    /// v0.2: inside a `fixed` subtree (inherited by children).
    pub pres_fixed: bool,
    /// v0.2: from the first text source; `rect`/`size` are filled from
    /// `presentation.text_field` at the end.
    pub text_input: Option<mg_core::ir::TextInputSpec>,
    /// v0.2: `presentation.text_field` placement and its pointer.
    pub text_field: Option<TextField>,

    pub root: Option<Root>,
}

pub(crate) fn placeholder() -> IR {
    IR::Const(Value::None)
}

pub(crate) fn dym<'a, I: IntoIterator<Item = &'a str>>(name: &str, cands: I) -> Option<String> {
    suggest(name, cands).map(|s| format!("did you mean '{s}'?"))
}

pub(crate) fn to_float(e: IR) -> IR {
    match e {
        IR::Const(Value::Int(n)) => IR::Const(Value::Float(n as f64)),
        e => IR::ToFloat(Box::new(e)),
    }
}

pub(crate) fn is_str(t: &Type) -> bool {
    matches!(t, Type::Str | Type::Enum(_))
}

fn same_enum(a: &[Rc<str>], b: &[Rc<str>]) -> bool {
    a.len() == b.len() && a.iter().all(|x| b.contains(x))
}

/// Can a value of type `a` be used where `e` is expected, without conversion?
/// `Unknown` matches anything; `T` fits `T?`; enums fit `string`.
pub(crate) fn fits(a: &Type, e: &Type) -> bool {
    use Type::*;
    match (a, e) {
        (Unknown, _) | (_, Unknown) => true,
        (Option(x), Option(y)) => fits(x, y),
        (x, Option(y)) => fits(x, y),
        (List(x), List(y)) | (Set(x), Set(y)) | (Grid(x), Grid(y)) => fits(x, y),
        (Map(k1, v1), Map(k2, v2)) => fits(k1, k2) && fits(v1, v2),
        (Record(r1), Record(r2)) => {
            r1.fields.len() == r2.fields.len()
                && r1.fields.iter().zip(&r2.fields).all(|((n1, t1), (n2, t2))| n1 == n2 && fits(t1, t2))
        }
        (Enum(_), Str) => true,
        (Enum(x), Enum(y)) => same_enum(x, y),
        (x, y) => x == y,
    }
}

/// Least common type of two types, for `if` branches, list items, `==`.
pub(crate) fn join(a: &Type, b: &Type) -> Option<Type> {
    use Type::*;
    Some(match (a, b) {
        (Unknown, x) | (x, Unknown) => x.clone(),
        (Int, Float) | (Float, Int) => Float,
        (Option(x), Option(y)) => Type::option(join(x, y)?),
        (Option(x), y) | (y, Option(x)) => Type::option(join(x, y)?),
        (List(x), List(y)) => Type::list(join(x, y)?),
        (Set(x), Set(y)) => Type::set(join(x, y)?),
        (Grid(x), Grid(y)) => Type::grid(join(x, y)?),
        (Map(k1, v1), Map(k2, v2)) => Type::map(join(k1, k2)?, join(v1, v2)?),
        (Record(r1), Record(r2)) => {
            if r1.fields.len() != r2.fields.len() {
                return None;
            }
            let mut fields = Vec::with_capacity(r1.fields.len());
            for ((n1, t1), (n2, t2)) in r1.fields.iter().zip(&r2.fields) {
                if n1 != n2 {
                    return None;
                }
                fields.push((n1.clone(), join(t1, t2)?));
            }
            Type::Record(Rc::new(RecordType { fields }))
        }
        (Enum(x), Enum(y)) if same_enum(x, y) => a.clone(),
        (Enum(_), Str) | (Str, Enum(_)) => Str,
        (x, y) if x == y => x.clone(),
        _ => return None,
    })
}

fn mismatch_hint(actual: &Type, exp: &Type) -> Option<String> {
    use Type::*;
    match (actual, exp) {
        (Option(_), _) => Some("use or_else(x, default) to get a value out of an optional".into()),
        (Float, Int) => Some("use floor(x), ceil(x) or round(x) to get an int".into()),
        (List(_), Set(_)) => Some("use set_of([...]) to build a set".into()),
        (List(_), Map(..)) => Some("use map_of([[key, value], ...]) to build a map".into()),
        (_, Str) if !matches!(actual, Unknown) => Some("use str(x) to turn a value into a string".into()),
        (IVec2, Vec2) => Some("vec(x, y) of two ints is an ivec2; use floats, like vec(1.0, 2.0), for a vec2".into()),
        (Int, Bool) => Some("compare it, like x > 0".into()),
        _ => None,
    }
}

/// Human-readable type name for messages.
pub(crate) fn tyname(t: &Type) -> String {
    match t {
        Type::Option(x) if x.is_unknown() => "none".into(),
        Type::List(x) if x.is_unknown() => "empty list".into(),
        _ => t.to_string(),
    }
}

impl Checker {
    pub fn root(&mut self) -> &mut Root {
        self.root.as_mut().expect("no root")
    }
    pub fn r(&self) -> &Root {
        self.root.as_ref().expect("no root")
    }

    // ── Diagnostics ────────────────────────────────────────────────────

    pub fn push_diag(&mut self, d: Diagnostic) {
        if self.mute == 0 {
            self.diags.push(d);
        }
    }
    pub fn err(&mut self, code: Code, span: Span, msg: impl Into<String>) {
        let d = Diagnostic::new(code, &*self.at, msg).with_span(span);
        self.push_diag(d);
    }
    pub fn err_h(&mut self, code: Code, span: Span, msg: impl Into<String>, hint: Option<String>) {
        let mut d = Diagnostic::new(code, &*self.at, msg).with_span(span);
        d.hint = hint;
        self.push_diag(d);
    }
    pub fn err_at(&mut self, code: Code, at: &str, msg: impl Into<String>, hint: Option<String>) {
        let mut d = Diagnostic::new(code, at, msg);
        d.hint = hint;
        self.push_diag(d);
    }
    pub fn error_count(&self) -> usize {
        self.diags.iter().filter(|d| d.is_error()).count()
    }

    // ── Roots, slots, scope ────────────────────────────────────────────

    pub fn begin(&mut self, root: Root) {
        self.root = Some(root);
    }
    /// Ends the current root and returns its `n_locals`.
    pub fn end(&mut self) -> u16 {
        let r = self.root.take().expect("no root");
        r.next_slot.min(u16::MAX as u32) as u16
    }

    pub fn alloc(&mut self) -> Slot {
        let r = self.root();
        let s = r.next_slot;
        r.next_slot += 1;
        if s == u16::MAX as u32 {
            let at = self.at.clone();
            self.err_at(Code::Limit, &at, "too many local variables in one place", None);
        }
        s.min(u16::MAX as u32 - 1) as Slot
    }

    /// Reports `E_SHADOWS_STATE` when a local would hide a state variable.
    pub fn check_shadow(&mut self, name: &str, span: Option<Span>, at: Option<&str>) {
        if self.state_idx.contains_key(name) {
            let msg = format!("local '{name}' has the same name as state variable '{name}'");
            let hint = Some("rename the local so it doesn't hide the state variable".to_string());
            match (span, at) {
                (Some(s), None) => self.err_h(Code::ShadowsState, s, msg, hint),
                (_, Some(a)) => {
                    let mut d = Diagnostic::new(Code::ShadowsState, a, msg);
                    d.span = span;
                    d.hint = hint;
                    self.push_diag(d);
                }
                (None, None) => {
                    let at = self.at.clone();
                    self.err_at(Code::ShadowsState, &at, msg, hint)
                }
            }
        }
    }

    /// Allocates a slot for a new local, checks shadowing, and pushes it.
    pub fn bind(&mut self, name: Rc<str>, ty: Type, span: Option<Span>, at: Option<&str>) -> Slot {
        self.check_shadow(&name, span, at);
        let slot = self.alloc();
        self.root().scope.push(Local { name, slot, ty });
        slot
    }

    pub fn bind_slot(&mut self, name: Rc<str>, ty: Type, slot: Slot) {
        self.root().scope.push(Local { name, slot, ty });
    }

    pub fn scope_mark(&self) -> usize {
        self.r().scope.len()
    }
    pub fn scope_reset(&mut self, mark: usize) {
        self.root().scope.truncate(mark);
    }

    fn lookup_local(&self, name: &str) -> Option<(Slot, Type)> {
        self.r().scope.iter().rev().find(|l| &*l.name == name).map(|l| (l.slot, l.ty.clone()))
    }

    // ── Entry points ───────────────────────────────────────────────────

    /// Parses `src` and reports a parse error at `at`.
    pub fn parse(&mut self, src: &str, at: &str) -> Option<ast::Expr> {
        self.at = Rc::from(at);
        match parser::parse_expr(src) {
            Ok(e) => Some(e),
            Err(pe) => {
                let mut d = Diagnostic::new(Code::Parse, at, pe.message).with_span(pe.span);
                d.hint = pe.hint;
                self.push_diag(d);
                None
            }
        }
    }

    /// Parses and checks one expression string at JSON pointer `at`.
    pub fn expr_src(&mut self, src: &str, at: &str, exp: Option<&Type>) -> (IR, Type) {
        match self.parse(src, at) {
            Some(e) => self.check(&e, exp),
            None => (placeholder(), exp.cloned().unwrap_or(Type::Unknown)),
        }
    }

    /// Checks `e` against an optional expected type, inserting widening.
    pub fn check(&mut self, e: &ast::Expr, exp: Option<&Type>) -> (IR, Type) {
        let (ir, t) = self.infer(e, exp);
        match exp {
            Some(x) => self.coerce(ir, t, x, e.span),
            None => (ir, t),
        }
    }

    /// Converts `ir: actual` to `exp`, reporting a mismatch if impossible.
    pub fn coerce(&mut self, ir: IR, actual: Type, exp: &Type, span: Span) -> (IR, Type) {
        if actual == *exp {
            return (ir, actual);
        }
        if actual.is_unknown() {
            return (ir, exp.clone());
        }
        if exp.is_unknown() {
            return (ir, actual);
        }
        let inner = match exp {
            Type::Option(t) => &**t,
            t => t,
        };
        if actual == Type::Int && *inner == Type::Float {
            return (to_float(ir), exp.clone());
        }
        if let (Type::Option(a), false) = (&actual, matches!(exp, Type::Option(_))) {
            let msg = format!("expected {}, found {} (an optional value)", tyname(exp), tyname(&actual));
            let _ = a;
            self.err_h(Code::TypeMismatch, span, msg, Some("use or_else(x, default) to get a value out of an optional".into()));
            return (ir, exp.clone());
        }
        if fits(&actual, exp) {
            let t = join(&actual, exp).unwrap_or_else(|| exp.clone());
            return (ir, t);
        }
        let msg = format!("expected {}, found {}", tyname(exp), tyname(&actual));
        self.err_h(Code::TypeMismatch, span, msg, mismatch_hint(&actual, exp));
        (ir, exp.clone())
    }

    /// Checks several expressions that must share one type (list items,
    /// `if` branches, `concat` arguments) and widens them to the joined type.
    pub fn unify(&mut self, es: &[&ast::Expr], exp: Option<&Type>, what: &str) -> (Vec<IR>, Type) {
        let mut irs = Vec::with_capacity(es.len());
        let mut tys = Vec::with_capacity(es.len());
        for e in es {
            let (i, t) = self.check(e, exp);
            irs.push(i);
            tys.push(t);
        }
        let mut j = Type::Unknown;
        let mut bad = false;
        for (k, t) in tys.iter().enumerate() {
            match join(&j, t) {
                Some(x) => j = x,
                None => {
                    if !bad {
                        let msg = format!("{what} have different types: {} and {}", tyname(&j), tyname(t));
                        self.err(Code::TypeMismatch, es[k].span, msg);
                    }
                    bad = true;
                }
            }
        }
        if bad {
            return (irs, exp.cloned().unwrap_or(Type::Unknown));
        }
        for k in 0..es.len() {
            if tys[k] != j && !tys[k].is_unknown() {
                // Re-check with the joined type so nested literals widen.
                self.mute += 1;
                let (i, _) = self.check(es[k], Some(&j));
                self.mute -= 1;
                irs[k] = i;
            }
        }
        (irs, j)
    }

    // ── Inference ──────────────────────────────────────────────────────

    pub fn infer(&mut self, e: &ast::Expr, exp: Option<&Type>) -> (IR, Type) {
        let exp_inner = match exp {
            Some(Type::Option(t)) => Some(&**t),
            x => x,
        };
        match &e.kind {
            ExprKind::Int(n) => {
                if exp_inner == Some(&Type::Float) {
                    (IR::Const(Value::Float(*n as f64)), Type::Float)
                } else {
                    (IR::Const(Value::Int(*n)), Type::Int)
                }
            }
            ExprKind::Float(f) => (IR::Const(Value::Float(*f)), Type::Float),
            ExprKind::Duration(d) => (IR::Const(Value::Int(*d)), Type::Int),
            ExprKind::Bool(b) => (IR::Const(Value::Bool(*b)), Type::Bool),
            ExprKind::Str(s) => {
                if let Some(Type::Enum(members)) = exp_inner {
                    if !members.iter().any(|m| m == s) {
                        let list = members.iter().map(|m| format!("'{m}'")).collect::<Vec<_>>().join(", ");
                        let hint = dym(s, members.iter().map(|m| &**m));
                        self.err_h(Code::TypeMismatch, e.span, format!("'{s}' is not one of {list}"), hint);
                    }
                    return (IR::Const(Value::Str(s.clone())), exp_inner.unwrap().clone());
                }
                (IR::Const(Value::Str(s.clone())), Type::Str)
            }
            ExprKind::None => match exp {
                Some(t @ Type::Option(_)) => (IR::Const(Value::None), t.clone()),
                Some(t) if !t.is_unknown() => {
                    let msg = format!("expected {}, found none", tyname(t));
                    let hint = format!("declare the type as '{t}?' to allow none");
                    self.err_h(Code::TypeMismatch, e.span, msg, Some(hint));
                    (IR::Const(Value::None), t.clone())
                }
                _ => (IR::Const(Value::None), Type::option(Type::Unknown)),
            },
            ExprKind::Ident(name) => self.ident(name, e.span),
            ExprKind::Token(name) => self.token(name, e.span),
            ExprKind::Field(base, name, nspan) => self.field(base, name, *nspan),
            ExprKind::Index(base, idx) => self.index(base, idx),
            ExprKind::Call(name, nspan, args) => self.call(name, *nspan, args, exp, e.span),
            ExprKind::Unary(UnOp::Not, x) => {
                let (i, _) = self.check(x, Some(&Type::Bool));
                (IR::Unary(UnOp::Not, Box::new(i)), Type::Bool)
            }
            ExprKind::Unary(UnOp::Neg, x) => {
                let (i, t) = self.check(x, exp);
                match t {
                    Type::Int | Type::Float | Type::IVec2 | Type::Vec2 | Type::Unknown => {}
                    _ => self.err(Code::TypeMismatch, x.span, format!("can't negate {}", tyname(&t))),
                }
                (IR::Unary(UnOp::Neg, Box::new(i)), t)
            }
            ExprKind::Binary(op, l, r) => self.binary(*op, l, r, e.span),
            ExprKind::If(c, a, b) => {
                let (ci, _) = self.check(c, Some(&Type::Bool));
                let (irs, t) = self.unify(&[&**a, &**b], exp, "the then and else branches");
                let mut it = irs.into_iter();
                let ai = it.next().unwrap();
                let bi = it.next().unwrap();
                (IR::If(Box::new(ci), Box::new(ai), Box::new(bi)), t)
            }
            ExprKind::Let(name, nspan, v, body) => {
                let (vi, vt) = self.check(v, None);
                let mark = self.scope_mark();
                let slot = self.bind(name.clone(), vt, Some(*nspan), None);
                let (bi, bt) = self.check(body, exp);
                self.scope_reset(mark);
                (IR::Let(slot, Box::new(vi), Box::new(bi)), bt)
            }
            ExprKind::Lambda(..) => {
                self.err_h(
                    Code::BadLambda,
                    e.span,
                    "a lambda can only be passed directly to map, filter, fold, any, all, count, find, sort_by or grid_map",
                    None,
                );
                (placeholder(), Type::Unknown)
            }
            ExprKind::List(items) => {
                let elem_exp = match exp_inner {
                    Some(Type::List(t)) => Some(&**t),
                    _ => None,
                };
                let refs: Vec<&ast::Expr> = items.iter().collect();
                let (irs, t) = self.unify(&refs, elem_exp, "list items");
                let ty = Type::list(t);
                if irs.iter().all(|i| matches!(i, IR::Const(_))) {
                    let vals = irs.into_iter().map(|i| if let IR::Const(v) = i { v } else { unreachable!() }).collect();
                    return (IR::Const(Value::list(vals)), ty);
                }
                (IR::List(irs.into_boxed_slice()), ty)
            }
            ExprKind::Record(items) => self.record(items, exp_inner, e.span),
        }
    }

    /// `Ok(None)` means "unknown event, accept anything".
    fn event_payload(&self) -> Result<Option<Payload>, &'static str> {
        match &self.r().event {
            EventCtx::Fields(p) => Ok(Some(p.clone())),
            EventCtx::None(why) => Err(why),
            EventCtx::Any => Ok(None),
        }
    }

    fn ident(&mut self, name: &Rc<str>, span: Span) -> (IR, Type) {
        if let Some((slot, ty)) = self.lookup_local(name) {
            return (IR::Local(slot), ty);
        }
        if &**name == "event" {
            match self.event_payload() {
                Ok(None) => return (placeholder(), Type::Unknown),
                Ok(Some(p)) => {
                    let rt = RecordType::new(p.iter().cloned().collect());
                    let fields: Vec<IR> = rt
                        .fields
                        .iter()
                        .map(|(n, _)| IR::Event(p.iter().position(|(m, _)| m == n).unwrap() as FieldIdx))
                        .collect();
                    return (IR::Record(fields.into_boxed_slice()), Type::Record(Rc::new(rt)));
                }
                Err(why) => {
                    self.err(Code::UnknownName, span, format!("there is no 'event' here: {why}"));
                    return (placeholder(), Type::Unknown);
                }
            }
        }
        if let Some(&id) = self.state_idx.get(name) {
            let vis = self.r().state_visible;
            if (id as usize) >= vis {
                let cur = self.state[vis].name.clone();
                self.err_h(
                    Code::UnknownName,
                    span,
                    format!("state '{name}' is declared after '{cur}'; an init can only read state declared before it"),
                    Some("move this state variable above, or compute the value directly".into()),
                );
                return (placeholder(), self.state[id as usize].ty.clone());
            }
            self.state_read[id as usize] = true;
            return (IR::State(id), self.state[id as usize].ty.clone());
        }
        if self.fn_idx.contains_key(name) || Builtin::from_name(name).is_some() {
            self.err_h(
                Code::TypeMismatch,
                span,
                format!("'{name}' is a function, not a value"),
                Some(format!("call it, like {name}(...)")),
            );
            return (placeholder(), Type::Unknown);
        }
        match &**name {
            "up" => return (IR::Const(Value::IVec2(0, -1)), Type::IVec2),
            "down" => return (IR::Const(Value::IVec2(0, 1)), Type::IVec2),
            "left" => return (IR::Const(Value::IVec2(-1, 0)), Type::IVec2),
            "right" => return (IR::Const(Value::IVec2(1, 0)), Type::IVec2),
            "now" => return (IR::Now, Type::Int),
            "pi" => return (IR::Const(Value::Float(std::f64::consts::PI)), Type::Float),
            "status" if self.r().presentation => {
                let members: Rc<[Rc<str>]> = Rc::from(vec![Rc::from("playing"), Rc::from("won"), Rc::from("lost")]);
                return (IR::Status, Type::Enum(members));
            }
            _ => {}
        }
        // Unknown name: suggest from everything visible.
        let mut cands: Vec<Rc<str>> = self.r().scope.iter().map(|l| l.name.clone()).collect();
        if !matches!(self.r().event, EventCtx::None(_)) {
            cands.push(Rc::from("event"));
        }
        let vis = self.r().state_visible.min(self.state.len());
        cands.extend(self.state[..vis].iter().map(|s| s.name.clone()));
        cands.extend(CONSTANTS.iter().map(|c| Rc::from(*c)));
        if self.r().presentation {
            cands.push(Rc::from("status"));
        }
        let hint = dym(name, cands.iter().map(|c| &**c));
        let msg = if &**name == "status" {
            "'status' can only be used in presentation".to_string()
        } else {
            format!("unknown name '{name}'")
        };
        self.err_h(Code::UnknownName, span, msg, hint);
        (placeholder(), Type::Unknown)
    }

    fn token(&mut self, name: &Rc<str>, span: Span) -> (IR, Type) {
        if !self.r().presentation {
            self.err(
                Code::UnknownName,
                span,
                format!("tokens like '${name}' can only be used in presentation"),
            );
            return (placeholder(), Type::Unknown);
        }
        match self.tokens.get(name) {
            Some((v, t)) => (IR::Const(v.clone()), t.clone()),
            None => {
                let hint = suggest(name, self.tokens.keys().map(|k| &**k)).map(|s| format!("did you mean '${s}'?"));
                self.err_h(Code::UnknownName, span, format!("unknown token '${name}'"), hint);
                (placeholder(), Type::Unknown)
            }
        }
    }

    fn field(&mut self, base: &ast::Expr, name: &Rc<str>, nspan: Span) -> (IR, Type) {
        if let ExprKind::Ident(b) = &base.kind {
            if &**b == "event" && self.lookup_local("event").is_none() {
                match self.event_payload() {
                    Ok(None) => return (placeholder(), Type::Unknown),
                    Ok(Some(p)) => {
                        if let Some(i) = p.iter().position(|(n, _)| n == name) {
                            return (IR::Event(i as FieldIdx), p[i].1.clone());
                        }
                        let msg = if p.is_empty() {
                            format!("this event has no payload, so there is no 'event.{name}'")
                        } else {
                            let fields = p.iter().map(|(n, _)| &**n).collect::<Vec<_>>().join(", ");
                            format!("event has no field '{name}' (it has: {fields})")
                        };
                        let hint = dym(name, p.iter().map(|(n, _)| &**n));
                        self.err_h(Code::UnknownName, nspan, msg, hint);
                        return (placeholder(), Type::Unknown);
                    }
                    Err(why) => {
                        self.err(Code::UnknownName, base.span, format!("there is no 'event' here: {why}"));
                        return (placeholder(), Type::Unknown);
                    }
                }
            }
        }
        let (bi, bt) = self.check(base, None);
        match &bt {
            Type::IVec2 | Type::Vec2 => {
                let comp = match &**name {
                    "x" => 0,
                    "y" => 1,
                    _ => {
                        self.err_h(
                            Code::UnknownName,
                            nspan,
                            format!("{bt} has no field '{name}'; vectors only have .x and .y"),
                            dym(name, ["x", "y"]),
                        );
                        return (placeholder(), Type::Unknown);
                    }
                };
                let t = if bt == Type::IVec2 { Type::Int } else { Type::Float };
                (IR::VecComponent(Box::new(bi), comp), t)
            }
            Type::Record(rt) => match rt.index_of(name) {
                Some(i) => (IR::Field(Box::new(bi), i as FieldIdx), rt.fields[i].1.clone()),
                None => {
                    let hint = dym(name, rt.fields.iter().map(|(n, _)| &**n));
                    self.err_h(Code::UnknownName, nspan, format!("no field '{name}' in {bt}"), hint);
                    (placeholder(), Type::Unknown)
                }
            },
            Type::Unknown => (placeholder(), Type::Unknown),
            Type::Option(_) => {
                self.err_h(
                    Code::TypeMismatch,
                    nspan,
                    format!("can't read '.{name}' of an optional value ({bt})"),
                    Some("use or_else(x, default) first".into()),
                );
                (placeholder(), Type::Unknown)
            }
            _ => {
                let hint = match &**name {
                    "length" | "len" | "size" | "count" => Some("use len(x)".to_string()),
                    "width" | "w" if matches!(bt, Type::Grid(_)) => Some("use width(g)".to_string()),
                    "height" | "h" if matches!(bt, Type::Grid(_)) => Some("use height(g)".to_string()),
                    _ => None,
                };
                self.err_h(Code::TypeMismatch, nspan, format!("{} has no field '{name}'", tyname(&bt)), hint);
                (placeholder(), Type::Unknown)
            }
        }
    }

    fn index(&mut self, base: &ast::Expr, idx: &ast::Expr) -> (IR, Type) {
        let (bi, bt) = self.check(base, None);
        let (ii, t) = match &bt {
            Type::List(t) => {
                let (ii, _) = self.check(idx, Some(&Type::Int));
                (ii, (**t).clone())
            }
            Type::Grid(t) => {
                let (ii, _) = self.check(idx, Some(&Type::IVec2));
                (ii, (**t).clone())
            }
            Type::Map(k, v) => {
                let (ii, _) = self.check(idx, Some(k));
                (ii, (**v).clone())
            }
            Type::Unknown => {
                let (ii, _) = self.check(idx, None);
                (ii, Type::Unknown)
            }
            Type::Option(_) => {
                self.check(idx, None);
                self.err_h(
                    Code::TypeMismatch,
                    base.span,
                    format!("can't index an optional value ({bt})"),
                    Some("use or_else(x, default) first".into()),
                );
                return (placeholder(), Type::Unknown);
            }
            _ => {
                self.check(idx, None);
                let hint = if is_str(&bt) { Some("use chars(s)[i] to get one character".to_string()) } else { None };
                self.err_h(Code::TypeMismatch, base.span, format!("can't index {} with [...]", tyname(&bt)), hint);
                return (placeholder(), Type::Unknown);
            }
        };
        // Fold constant list indexing (tokens like $tiles[2]).
        if let (IR::Const(Value::List(items)), IR::Const(Value::Int(i))) = (&bi, &ii) {
            if *i >= 0 && (*i as usize) < items.len() {
                return (IR::Const(items[*i as usize].clone()), t);
            }
            if self.r().presentation {
                self.err(Code::Presentation, idx.span, format!("index {i} is out of range for a list of {}", items.len()));
                return (placeholder(), t);
            }
        }
        (IR::Index(Box::new(bi), Box::new(ii)), t)
    }

    fn record(&mut self, items: &[RecordItem], exp: Option<&Type>, span: Span) -> (IR, Type) {
        // Spread form: {...base, f: v}
        if let Some(RecordItem::Spread(base)) = items.first() {
            let (bi, bt) = self.check(base, exp.filter(|t| matches!(t, Type::Record(_))));
            let rt = match &bt {
                Type::Record(rt) => Some(rt.clone()),
                Type::Unknown => None,
                _ => {
                    self.err(Code::TypeMismatch, base.span, format!("can only spread a record, found {}", tyname(&bt)));
                    None
                }
            };
            let mut ups: Vec<(FieldIdx, IR)> = Vec::new();
            for item in &items[1..] {
                match item {
                    RecordItem::Spread(e) => {
                        self.err(Code::TypeMismatch, e.span, "only one ...spread is allowed, at the start of the record");
                    }
                    RecordItem::Field(n, ns, e) => {
                        let Some(rt) = &rt else {
                            self.check(e, None);
                            continue;
                        };
                        match rt.index_of(n) {
                            Some(i) => {
                                if ups.iter().any(|(j, _)| *j as usize == i) {
                                    self.err(Code::Duplicate, *ns, format!("field '{n}' is set twice"));
                                }
                                let ft = rt.fields[i].1.clone();
                                let (vi, _) = self.check(e, Some(&ft));
                                ups.push((i as FieldIdx, vi));
                            }
                            None => {
                                self.check(e, None);
                                let hint = dym(n, rt.fields.iter().map(|(f, _)| &**f));
                                self.err_h(
                                    Code::UnknownName,
                                    *ns,
                                    format!("no field '{n}' in {bt}; a spread update can only replace existing fields"),
                                    hint,
                                );
                            }
                        }
                    }
                }
            }
            if ups.is_empty() {
                return (bi, bt);
            }
            ups.sort_by_key(|(i, _)| *i);
            return (IR::RecordUpdate(Box::new(bi), ups.into_boxed_slice()), bt);
        }

        let exp_rt = match exp {
            Some(Type::Record(rt)) => Some(rt.clone()),
            _ => None,
        };
        let mut fields: Vec<(Rc<str>, Type, IR)> = Vec::with_capacity(items.len());
        let mut field_errors = false;
        for item in items {
            match item {
                RecordItem::Spread(e) => {
                    self.check(e, None);
                    self.err(Code::TypeMismatch, e.span, "a ...spread must come first in the record");
                    field_errors = true;
                }
                RecordItem::Field(n, ns, e) => {
                    if fields.iter().any(|(m, _, _)| m == n) {
                        self.err(Code::Duplicate, *ns, format!("field '{n}' appears twice"));
                        field_errors = true;
                        continue;
                    }
                    let fexp = match &exp_rt {
                        Some(rt) => match rt.field(n) {
                            Some(t) => Some(t.clone()),
                            None => {
                                let hint = dym(n, rt.fields.iter().map(|(f, _)| &**f));
                                let msg = format!("unexpected field '{n}': expected {}", Type::Record(rt.clone()));
                                self.err_h(Code::TypeMismatch, *ns, msg, hint);
                                field_errors = true;
                                None
                            }
                        },
                        None => None,
                    };
                    let (vi, vt) = self.check(e, fexp.as_ref());
                    fields.push((n.clone(), vt, vi));
                }
            }
        }
        if let Some(rt) = &exp_rt {
            let missing: Vec<&str> =
                rt.fields.iter().filter(|(n, _)| !fields.iter().any(|(m, _, _)| m == n)).map(|(n, _)| &**n).collect();
            if !missing.is_empty() {
                let msg = format!(
                    "missing field{} {} for {}",
                    if missing.len() > 1 { "s" } else { "" },
                    missing.iter().map(|m| format!("'{m}'")).collect::<Vec<_>>().join(", "),
                    Type::Record(rt.clone())
                );
                self.err(Code::TypeMismatch, span, msg);
                field_errors = true;
            }
        }
        fields.sort_by(|a, b| a.0.cmp(&b.0));
        let ty = if field_errors {
            exp.cloned().unwrap_or(Type::Unknown)
        } else {
            Type::Record(Rc::new(RecordType { fields: fields.iter().map(|(n, t, _)| (n.clone(), t.clone())).collect() }))
        };
        let irs: Vec<IR> = fields.into_iter().map(|(_, _, i)| i).collect();
        if irs.iter().all(|i| matches!(i, IR::Const(_))) {
            let vals = irs.into_iter().map(|i| if let IR::Const(v) = i { v } else { unreachable!() }).collect();
            return (IR::Const(Value::record(vals)), ty);
        }
        (IR::Record(irs.into_boxed_slice()), ty)
    }

    fn binary(&mut self, op: BinOp, l: &ast::Expr, r: &ast::Expr, span: Span) -> (IR, Type) {
        use Type::*;
        match op {
            BinOp::And | BinOp::Or => {
                let (a, _) = self.check(l, Some(&Bool));
                let (b, _) = self.check(r, Some(&Bool));
                (IR::Binary(op, Box::new(a), Box::new(b)), Bool)
            }
            BinOp::Eq | BinOp::Ne => {
                let l_lit = matches!(l.kind, ExprKind::Str(_) | ExprKind::None);
                let r_lit = matches!(r.kind, ExprKind::Str(_) | ExprKind::None);
                let (a, ta, b, tb) = if l_lit && !r_lit {
                    let (b, tb) = self.check(r, None);
                    let (a, ta) = self.infer(l, Some(&tb));
                    (a, ta, b, tb)
                } else {
                    let (a, ta) = self.check(l, None);
                    let (b, tb) = self.infer(r, Some(&ta));
                    (a, ta, b, tb)
                };
                let (a, b) = match join(&ta, &tb) {
                    Some(j) => {
                        let jn = match &j {
                            Option(t) => (**t).clone(),
                            t => t.clone(),
                        };
                        let widen = |x: IR, t: &Type| if jn == Float && *t == Int { to_float(x) } else { x };
                        let a = widen(a, &ta);
                        let b = widen(b, &tb);
                        // Nested widening isn't possible: list<int> == list<float>.
                        if !fits(&ta, &j) && !(ta == Int && jn == Float) || !fits(&tb, &j) && !(tb == Int && jn == Float) {
                            self.err(Code::TypeMismatch, span, format!("can't compare {} with {}", tyname(&ta), tyname(&tb)));
                        }
                        (a, b)
                    }
                    None => {
                        self.err(Code::TypeMismatch, span, format!("can't compare {} with {}", tyname(&ta), tyname(&tb)));
                        (a, b)
                    }
                };
                (IR::Binary(op, Box::new(a), Box::new(b)), Bool)
            }
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                let (a, ta) = self.check(l, None);
                let (b, tb) = self.check(r, None);
                let (a, b) = match (&ta, &tb) {
                    (Unknown, _) | (_, Unknown) => (a, b),
                    (Int, Int) | (Float, Float) => (a, b),
                    (Int, Float) => (to_float(a), b),
                    (Float, Int) => (a, to_float(b)),
                    (x, y) if is_str(x) && is_str(y) => (a, b),
                    _ => {
                        let hint = if matches!(ta, Option(_)) || matches!(tb, Option(_)) {
                            Some("use or_else(x, default) first".to_string())
                        } else {
                            None
                        };
                        let msg = format!("can't compare {} with {} using '{}'", tyname(&ta), tyname(&tb), op.symbol());
                        self.err_h(Code::TypeMismatch, span, msg, hint);
                        (a, b)
                    }
                };
                (IR::Binary(op, Box::new(a), Box::new(b)), Bool)
            }
            BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Mod => {
                let (a, ta) = self.check(l, None);
                let (b, tb) = self.check(r, None);
                let mk = |a: IR, b: IR| IR::Binary(op, Box::new(a), Box::new(b));
                if ta.is_unknown() || tb.is_unknown() {
                    let t = match (&ta, &tb) {
                        (Unknown, Float) | (Float, Unknown) => Float,
                        _ => Unknown,
                    };
                    return (mk(a, b), t);
                }
                let o = op;
                let num = |t: &Type| matches!(t, Int | Float);
                let res: std::option::Option<(IR, Type)> = match (&ta, &tb) {
                    (Int, Int) => Some((mk(a, b), Int)),
                    _ if o == BinOp::Mod => {
                        let msg = format!("'%' only works on ints, found {} and {}", tyname(&ta), tyname(&tb));
                        self.err_h(Code::TypeMismatch, span, msg, Some("use floor(x) to get an int first".into()));
                        return (placeholder(), Int);
                    }
                    (x, y) if num(x) && num(y) => {
                        let a = if *x == Int { to_float(a) } else { a };
                        let b = if *y == Int { to_float(b) } else { b };
                        Some((mk(a, b), Float))
                    }
                    (IVec2, IVec2) if matches!(o, BinOp::Add | BinOp::Sub) => Some((mk(a, b), IVec2)),
                    (Vec2, Vec2) if matches!(o, BinOp::Add | BinOp::Sub) => Some((mk(a, b), Vec2)),
                    (IVec2, Int) if matches!(o, BinOp::Mul | BinOp::Div) => Some((mk(a, b), IVec2)),
                    (Int, IVec2) if o == BinOp::Mul => Some((mk(a, b), IVec2)),
                    (Vec2, x) if num(x) && matches!(o, BinOp::Mul | BinOp::Div) => {
                        let b = if *x == Int { to_float(b) } else { b };
                        Some((mk(a, b), Vec2))
                    }
                    (x, Vec2) if num(x) && o == BinOp::Mul => {
                        let a = if *x == Int { to_float(a) } else { a };
                        Some((mk(a, b), Vec2))
                    }
                    (x, y) if o == BinOp::Add && is_str(x) && is_str(y) => Some((mk(a, b), Str)),
                    _ => None,
                };
                match res {
                    Some(r) => r,
                    None => {
                        let hint = if o == BinOp::Add && (is_str(&ta) || is_str(&tb)) {
                            Some("use str(x) to turn a value into a string".to_string())
                        } else if matches!(ta, Option(_)) || matches!(tb, Option(_)) {
                            Some("use or_else(x, default) first".to_string())
                        } else if matches!((&ta, &tb), (IVec2, Vec2) | (Vec2, IVec2) | (IVec2, Float) | (Float, IVec2)) {
                            Some("ivec2 can't be mixed with floats; build a vec2 with float parts, like vec(p.x * 1.0, p.y * 1.0)".to_string())
                        } else {
                            None
                        };
                        let msg = format!("can't apply '{}' to {} and {}", o.symbol(), tyname(&ta), tyname(&tb));
                        self.err_h(Code::TypeMismatch, span, msg, hint);
                        (placeholder(), Unknown)
                    }
                }
            }
        }
    }

    fn call(&mut self, name: &Rc<str>, nspan: Span, args: &[ast::Expr], exp: Option<&Type>, span: Span) -> (IR, Type) {
        if self.lookup_local(name).is_some() {
            for a in args {
                self.check(a, None);
            }
            self.err(Code::TypeMismatch, nspan, format!("'{name}' is a local variable, not a function"));
            return (placeholder(), Type::Unknown);
        }
        if let Some(&id) = self.fn_idx.get(name) {
            return self.user_call(id, nspan, args);
        }
        if let Some(b) = Builtin::from_name(name) {
            if b.is_random() && !self.r().random_ok {
                let w = self.r().pure_where;
                self.err_h(
                    Code::RandomInPure,
                    nspan,
                    format!("random builtin '{name}' can't be used {w}"),
                    Some("randomness is only allowed in state init and rule effects; use hash(x) for a stable pseudo-random value".into()),
                );
            }
            return self.builtin(b, nspan, args, exp, span);
        }
        for a in args {
            if !matches!(a.kind, ExprKind::Lambda(..)) {
                self.check(a, None);
            }
        }
        let cands: Vec<&str> =
            self.funcs.iter().map(|f| &*f.name).chain(Builtin::ALL.iter().map(|b| b.name())).collect();
        let hint = dym(name, cands);
        let msg = if self.state_idx.contains_key(name) {
            format!("'{name}' is a state variable, not a function")
        } else {
            format!("unknown function '{name}'")
        };
        self.err_h(Code::UnknownName, nspan, msg, hint);
        (placeholder(), Type::Unknown)
    }

    fn user_call(&mut self, id: u16, nspan: Span, args: &[ast::Expr]) -> (IR, Type) {
        let params = self.funcs[id as usize].params.clone();
        let ret = self.funcs[id as usize].ret.clone();
        let name = self.funcs[id as usize].name.clone();
        if let Some(caller) = self.r().cur_fn {
            let at = self.at.clone();
            let sites = &mut self.calls[caller as usize];
            if !sites.iter().any(|s| s.callee == id) {
                sites.push(CallSite { callee: id, at, span: nspan });
            }
        }
        if args.len() != params.len() {
            let sig = params.iter().map(|(n, t)| format!("{n}: {t}")).collect::<Vec<_>>().join(", ");
            self.err(
                Code::TypeMismatch,
                nspan,
                format!(
                    "{name} takes {} argument{} ({sig}), found {}",
                    params.len(),
                    if params.len() == 1 { "" } else { "s" },
                    args.len()
                ),
            );
        }
        let mut irs = Vec::with_capacity(args.len());
        for (i, a) in args.iter().enumerate() {
            let (ai, _) = self.check(a, params.get(i).map(|p| &p.1));
            irs.push(ai);
        }
        (IR::Call(id, irs.into_boxed_slice()), ret)
    }

    /// Checks a lambda argument. `params` are the parameter types; `alt` is
    /// an alternative arity (e.g. `(item, index)`). Returns the lambda IR
    /// and the body type.
    pub fn lambda(
        &mut self,
        e: &ast::Expr,
        params: &[Type],
        alt: Option<&[Type]>,
        ret: Option<&Type>,
        fname: &str,
    ) -> (IR, Type) {
        let ExprKind::Lambda(ps, body) = &e.kind else {
            let is_fn = matches!(&e.kind, ExprKind::Ident(n) if self.fn_idx.contains_key(n) || Builtin::from_name(n).is_some());
            if let (true, ExprKind::Ident(n)) = (is_fn, &e.kind) {
                let p = if params.len() == 2 { "(a, b)" } else { "x" };
                self.err_h(
                    Code::BadLambda,
                    e.span,
                    format!("{fname} needs a lambda here, not the function name '{n}'"),
                    Some(format!("write {p} => {n}({})", p.trim_matches(|c| c == '(' || c == ')'))),
                );
                return (placeholder(), Type::Unknown);
            }
            self.check(e, None);
            let example = match params.len() {
                2 => "(a, b) => ...",
                _ => "x => ...",
            };
            self.err(Code::BadLambda, e.span, format!("{fname} needs a lambda here, like {example}"));
            return (placeholder(), Type::Unknown);
        };
        let tys: Vec<Type> = if ps.len() == params.len() {
            params.to_vec()
        } else if let Some(a) = alt.filter(|a| a.len() == ps.len()) {
            a.to_vec()
        } else {
            let mut want = format!("{}", params.len());
            if let Some(a) = alt {
                want = format!("{} or {}", params.len().min(a.len()), params.len().max(a.len()));
            }
            self.err(
                Code::BadLambda,
                e.span,
                format!("the lambda for {fname} takes {want} parameter(s), found {}", ps.len()),
            );
            vec![Type::Unknown; ps.len()]
        };
        let mark = self.scope_mark();
        let mut slots = Vec::with_capacity(ps.len());
        for ((n, s), t) in ps.iter().zip(tys) {
            slots.push(self.bind(n.clone(), t, Some(*s), None));
        }
        let (bi, bt) = self.check(body, ret);
        self.scope_reset(mark);
        (IR::Lambda { params: slots.into_boxed_slice(), body: Box::new(bi) }, bt)
    }
}
