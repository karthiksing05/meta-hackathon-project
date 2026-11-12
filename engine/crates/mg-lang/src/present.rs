//! Presentation (spec A12) → `mg_core::scene`.
//!
//! Prop strings starting with `=` are expressions; strings starting with `$`
//! are token references (folded to constants); everything else is a literal.
//! Grid `source`, repeat `source`/`key`, `on_tap`/`on_drag` `with` values and
//! `animate_on.when` are always expressions.

use std::rc::Rc;

use mg_core::color::parse_color;
use mg_core::diag::Code;
use mg_core::frame::{note_to_hz, Wave};
use mg_core::ir::Expr as IR;
use mg_core::scene::{
    Align, Anchor, AnimateOn, Canvas, Dir, Ease, EventRef, Feedback, FeedbackAction, InputBinding, Node, NodeKind,
    Presentation, Prop, PropName, TextAlign, TextValign, Transition,
};
use mg_core::types::Type;
use mg_core::value::Value;
use serde_json::{Map, Value as J};

use crate::check::{dym, placeholder, tyname, Checker, EventCtx, Payload, Root};
use crate::{is_ident, json_kind, ptr};

type Obj = Map<String, J>;

const COMMON: &[&str] = &[
    "node", "id", "x", "y", "anchor", "rotation", "scale", "opacity", "visible", "fill", "stroke", "stroke_width", "on_tap",
    "on_drag", "transition", "animate_on",
];
const KINDS: &[&str] = &["group", "stack", "grid", "repeat", "rect", "circle", "text"];
const PROP_NAMES: &[&str] =
    &["x", "y", "w", "h", "r", "radius", "rotation", "scale", "opacity", "fill", "stroke", "stroke_width", "color", "size"];
const EASES: &[&str] = &["linear", "in", "out", "in_out", "spring"];

fn kind_keys(kind: &str) -> &'static [&'static str] {
    match kind {
        "group" => &["children"],
        "stack" => &["dir", "gap", "align", "children"],
        "grid" => &["source", "cols", "rows", "cell_size", "gap", "cell"],
        "repeat" => &["source", "as", "key", "template", "item"],
        "rect" => &["w", "h", "radius"],
        "circle" => &["r"],
        "text" => &["text", "size", "font", "weight", "color", "w", "h", "align", "valign"],
        _ => &[],
    }
}

#[derive(Clone, Copy, PartialEq)]
enum PK {
    Num,
    Int,
    Color,
    Str,
    Bool,
}

impl PK {
    fn ty(self) -> Type {
        match self {
            PK::Num => Type::Float,
            PK::Int => Type::Int,
            PK::Color | PK::Str => Type::Str,
            PK::Bool => Type::Bool,
        }
    }
    fn what(self) -> &'static str {
        match self {
            PK::Num => "a number",
            PK::Int => "an integer",
            PK::Color => "a color",
            PK::Str => "a string",
            PK::Bool => "true or false",
        }
    }
}

impl Checker {
    fn pres_err(&mut self, at: &str, msg: impl Into<String>, hint: Option<String>) {
        self.err_at(Code::Presentation, at, msg, hint);
    }

    fn pres_keys(&mut self, m: &Obj, allowed: &[&str], at: &str, what: &str) {
        for k in m.keys() {
            if k.starts_with('_') || allowed.contains(&k.as_str()) {
                continue;
            }
            let hint = dym(k, allowed.iter().copied()).or_else(|| Some(format!("allowed: {}", allowed.join(", "))));
            self.pres_err(&ptr(at, k), format!("unknown property '{k}' on {what}"), hint);
        }
    }

    fn check_color_value(&mut self, v: &Value, at: &str) {
        if let Value::Str(s) = v {
            if parse_color(s).is_none() {
                self.pres_err(
                    at,
                    format!("'{s}' is not a color"),
                    Some("use #RGB, #RRGGBB, #RRGGBBAA, a CSS name like white, or a color token like $bg".into()),
                );
            }
        }
    }

    /// A style prop: literal, `$token`, or `= expression`.
    fn prop(&mut self, v: &J, at: &str, pk: PK) -> Prop {
        match v {
            J::String(s) if s.trim_start().starts_with('=') => {
                let src = s.replacen('=', " ", 1);
                self.prop_expr(&src, at, pk)
            }
            J::String(s) if s.starts_with('$') => self.prop_expr(s, at, pk),
            J::String(s) => match pk {
                PK::Str => Prop::Const(Value::str(s)),
                PK::Color => {
                    let v = Value::str(s);
                    self.check_color_value(&v, at);
                    Prop::Const(v)
                }
                _ => {
                    let hint = if s.trim().parse::<f64>().is_ok() || s == "true" || s == "false" {
                        Some(format!("write {s} without quotes, or start with '=' for an expression"))
                    } else {
                        Some("start with '=' for an expression, like \"= score * 2\"".to_string())
                    };
                    self.pres_err(at, format!("expected {}, found the string '{s}'", pk.what()), hint);
                    Prop::Const(Value::None)
                }
            },
            J::Number(n) => match pk {
                PK::Num => Prop::Const(Value::Float(n.as_f64().unwrap_or(0.0))),
                PK::Int => match n.as_i64() {
                    Some(i) => Prop::Const(Value::Int(i)),
                    None => {
                        self.pres_err(at, format!("expected an integer, found {n}"), None);
                        Prop::Const(Value::None)
                    }
                },
                PK::Str => Prop::Const(Value::str(&n.to_string())),
                _ => {
                    self.pres_err(at, format!("expected {}, found the number {n}", pk.what()), None);
                    Prop::Const(Value::None)
                }
            },
            J::Bool(b) if pk == PK::Bool => Prop::Const(Value::Bool(*b)),
            other => {
                self.pres_err(at, format!("expected {}, found {}", pk.what(), json_kind(other)), None);
                Prop::Const(Value::None)
            }
        }
    }

    fn prop_expr(&mut self, src: &str, at: &str, pk: PK) -> Prop {
        let ty = pk.ty();
        let (ir, _) = self.expr_src(src, at, Some(&ty));
        match ir {
            IR::Const(v) => {
                if pk == PK::Color {
                    self.check_color_value(&v, at);
                }
                Prop::Const(v)
            }
            e => Prop::Expr(e),
        }
    }

    fn opt_prop(&mut self, m: &Obj, key: &str, at: &str, pk: PK) -> Option<Prop> {
        m.get(key).map(|v| self.prop(v, &ptr(at, key), pk))
    }

    /// An expression field that is always an expression (no `=` needed; a
    /// leading `=` is tolerated).
    fn pres_expr(&mut self, v: &J, at: &str, exp: Option<&Type>) -> (IR, Type) {
        match v {
            J::String(s) if s.trim_start().starts_with('=') => {
                let src = s.replacen('=', " ", 1);
                self.expr_src(&src, at, exp)
            }
            _ => self.expr_at(v, at, exp),
        }
    }

    /// A numeric literal (grid `cell_size`/`gap`, stack `gap`, `ms`).
    fn num_lit(&mut self, m: &Obj, key: &str, at: &str, default: Option<f64>) -> f64 {
        match m.get(key) {
            Some(J::Number(n)) => n.as_f64().unwrap_or(0.0),
            Some(other) => {
                self.pres_err(
                    &ptr(at, key),
                    format!("'{key}' must be a number literal, found {}", json_kind(other)),
                    None,
                );
                default.unwrap_or(0.0)
            }
            None => match default {
                Some(d) => d,
                None => {
                    self.pres_err(at, format!("missing '{key}'"), None);
                    0.0
                }
            },
        }
    }

    fn word<'v>(&mut self, m: &'v Obj, key: &str, at: &str, options: &[&str]) -> Option<&'v str> {
        let v = m.get(key)?;
        let kat = ptr(at, key);
        match v.as_str() {
            Some(s) if options.contains(&s) => Some(s),
            _ => {
                let hint = v.as_str().and_then(|s| dym(s, options.iter().copied()));
                self.pres_err(&kat, format!("'{key}' must be one of {}", options.join(", ")), hint);
                None
            }
        }
    }

    fn ease(&mut self, v: Option<&J>, at: &str) -> Ease {
        match v {
            None => Ease::default(),
            Some(J::String(s)) => match Ease::from_name(s) {
                Some(e) => e,
                None => {
                    self.pres_err(at, format!("unknown ease '{s}'"), dym(s, EASES.iter().copied()));
                    Ease::default()
                }
            },
            Some(other) => {
                self.pres_err(at, format!("ease must be a string, found {}", json_kind(other)), None);
                Ease::default()
            }
        }
    }

    fn event_ref(&mut self, name: &str, at: &str) -> Option<(EventRef, EventCtx)> {
        let empty: Payload = Rc::from(Vec::new());
        match name {
            "win" => return Some((EventRef::Win, EventCtx::Fields(empty))),
            "lose" => return Some((EventRef::Lose, EventCtx::Fields(empty))),
            _ => {}
        }
        if let Some(&id) = self.input_idx.get(name) {
            return Some((EventRef::Input(id), EventCtx::Fields(self.inputs[id as usize].1.clone())));
        }
        if let Some(&id) = self.event_idx.get(name) {
            return Some((EventRef::Event(id), EventCtx::Fields(self.events[id as usize].1.clone())));
        }
        self.unknown_trigger(name, at, &["win", "lose"]);
        None
    }

    fn tokens(&mut self, v: &J) {
        let Some(m) = self.obj(v, "/presentation/tokens", "tokens") else { return };
        for (k, tv) in m {
            let at = ptr("/presentation/tokens", k);
            if !is_ident(k) {
                self.pres_err(&at, format!("token name '{k}' is not a valid name"), None);
                continue;
            }
            let r = match tv {
                J::String(s) => Some((Value::str(s), Type::Str)),
                J::Bool(b) => Some((Value::Bool(*b), Type::Bool)),
                J::Number(n) => Some(match n.as_i64() {
                    Some(i) => (Value::Int(i), Type::Int),
                    None => (Value::Float(n.as_f64().unwrap_or(0.0)), Type::Float),
                }),
                J::Array(items) if items.iter().all(|x| x.is_string()) => Some((
                    Value::list(items.iter().map(|x| Value::str(x.as_str().unwrap())).collect()),
                    Type::list(Type::Str),
                )),
                J::Array(items) if items.iter().all(|x| x.is_i64()) => Some((
                    Value::list(items.iter().map(|x| Value::Int(x.as_i64().unwrap())).collect()),
                    Type::list(Type::Int),
                )),
                J::Array(items) if items.iter().all(|x| x.is_number()) => Some((
                    Value::list(items.iter().map(|x| Value::Float(x.as_f64().unwrap())).collect()),
                    Type::list(Type::Float),
                )),
                _ => None,
            };
            match r {
                Some(r) => {
                    self.tokens.insert(Rc::from(k.as_str()), r);
                }
                None => self.pres_err(
                    &at,
                    "a token must be a string, number, boolean, or a list of strings or of numbers",
                    None,
                ),
            }
        }
    }

    pub fn presentation(&mut self, v: Option<&J>) -> Presentation {
        let mut root = Root::new(
            EventCtx::None("presentation only sees an event in animate_on 'when' and in feedback"),
            false,
            "in presentation",
        );
        root.presentation = true;
        self.begin(root);
        let pointer_slot = self.alloc();
        let empty_node = |at: &str| Node {
            kind: NodeKind::Group { children: Vec::new() },
            at: Rc::from(at),
            id: None,
            x: None,
            y: None,
            anchor: Anchor::TopLeft,
            rotation: None,
            scale: None,
            opacity: None,
            visible: None,
            fill: None,
            stroke: None,
            stroke_width: None,
            on_tap: None,
            on_drag: None,
            transitions: Vec::new(),
            animate_on: Vec::new(),
        };
        let mut p = Presentation {
            canvas: Canvas { w: 360.0, h: 640.0, background: Prop::Const(Value::str("#FFFFFF")) },
            root: empty_node("/presentation/root"),
            feedback: Vec::new(),
            n_locals: 0,
            pointer_slot,
        };
        let m = match v {
            None => {
                self.err_at(Code::BadField, "", "the game file is missing 'presentation'", None);
                None
            }
            Some(v) => self.obj(v, "/presentation", "presentation"),
        };
        if let Some(m) = m {
            self.check_keys(m, &["canvas", "tokens", "root", "feedback"], "/presentation", "presentation");
            if let Some(t) = m.get("tokens") {
                self.tokens(t);
            }
            if let Some(c) = m.get("canvas") {
                if let Some(cm) = self.obj(c, "/presentation/canvas", "canvas") {
                    let at = "/presentation/canvas";
                    self.pres_keys(cm, &["w", "h", "background"], at, "canvas");
                    p.canvas.w = self.num_lit(cm, "w", at, Some(360.0));
                    p.canvas.h = self.num_lit(cm, "h", at, Some(640.0));
                    if let Some(b) = cm.get("background") {
                        p.canvas.background = self.prop(b, &ptr(at, "background"), PK::Color);
                    }
                }
            }
            match m.get("root") {
                Some(r) => p.root = self.node(r, "/presentation/root"),
                None => self.err_at(Code::BadField, "/presentation", "presentation is missing 'root'", None),
            }
            if let Some(f) = m.get("feedback") {
                match f {
                    J::Array(items) => {
                        for (i, fv) in items.iter().enumerate() {
                            if let Some(fb) = self.feedback(fv, &ptr("/presentation/feedback", &i.to_string())) {
                                p.feedback.push(fb);
                            }
                        }
                    }
                    other => self.pres_err(
                        "/presentation/feedback",
                        format!("feedback must be a list, found {}", json_kind(other)),
                        None,
                    ),
                }
            }
        }
        p.n_locals = self.end();
        p
    }

    fn node(&mut self, v: &J, at: &str) -> Node {
        let mut node = Node {
            kind: NodeKind::Group { children: Vec::new() },
            at: Rc::from(at),
            id: None,
            x: None,
            y: None,
            anchor: Anchor::TopLeft,
            rotation: None,
            scale: None,
            opacity: None,
            visible: None,
            fill: None,
            stroke: None,
            stroke_width: None,
            on_tap: None,
            on_drag: None,
            transitions: Vec::new(),
            animate_on: Vec::new(),
        };
        let J::Object(m) = v else {
            self.pres_err(at, format!("a node must be an object, found {}", json_kind(v)), None);
            return node;
        };
        let kind = match m.get("node").and_then(|k| k.as_str()) {
            Some(k) if KINDS.contains(&k) => k,
            Some(k) => {
                self.pres_err(
                    &ptr(at, "node"),
                    format!("unknown node kind '{k}'"),
                    dym(k, KINDS.iter().copied()).or_else(|| Some(format!("node kinds: {}", KINDS.join(", ")))),
                );
                return node;
            }
            None => {
                self.pres_err(at, "a node needs \"node\": one of group, stack, grid, repeat, rect, circle, text", None);
                return node;
            }
        };
        let mut allowed: Vec<&str> = COMMON.to_vec();
        allowed.extend_from_slice(kind_keys(kind));
        self.pres_keys(m, &allowed, at, &format!("a {kind} node"));

        // Common props.
        if let Some(id) = m.get("id") {
            match id.as_str() {
                Some(s) => node.id = Some(Rc::from(s)),
                None => self.pres_err(&ptr(at, "id"), "id must be a string", None),
            }
        }
        node.x = self.opt_prop(m, "x", at, PK::Num);
        node.y = self.opt_prop(m, "y", at, PK::Num);
        if let Some(a) = self.word(m, "anchor", at, &["top_left", "center"]) {
            node.anchor = if a == "center" { Anchor::Center } else { Anchor::TopLeft };
        }
        node.rotation = self.opt_prop(m, "rotation", at, PK::Num);
        node.scale = self.opt_prop(m, "scale", at, PK::Num);
        node.opacity = self.opt_prop(m, "opacity", at, PK::Num);
        node.visible = self.opt_prop(m, "visible", at, PK::Bool);
        node.fill = self.opt_prop(m, "fill", at, PK::Color);
        node.stroke = self.opt_prop(m, "stroke", at, PK::Color);
        node.stroke_width = self.opt_prop(m, "stroke_width", at, PK::Num);

        // Kind-specific props. Node locals are bound before the props that
        // can see them; the grid/repeat's own props see only outer locals.
        let mark = self.scope_mark();
        node.kind = match kind {
            "group" => NodeKind::Group { children: self.children(m, at) },
            "stack" => {
                let dir = match self.word(m, "dir", at, &["row", "column"]) {
                    Some("row") => Dir::Row,
                    _ => Dir::Column,
                };
                let align = match self.word(m, "align", at, &["start", "center", "end"]) {
                    Some("start") => Align::Start,
                    Some("end") => Align::End,
                    _ => Align::Center,
                };
                let gap = self.num_lit(m, "gap", at, Some(0.0));
                NodeKind::Stack { dir, gap, align, children: self.children(m, at) }
            }
            "grid" => self.grid_node(m, at),
            "repeat" => self.repeat_node(m, at),
            "rect" => {
                let w = self.required_prop(m, "w", at, PK::Num);
                let h = self.required_prop(m, "h", at, PK::Num);
                NodeKind::Rect { w, h, radius: self.opt_prop(m, "radius", at, PK::Num) }
            }
            "circle" => NodeKind::Circle { r: self.required_prop(m, "r", at, PK::Num) },
            "text" => {
                let text = self.required_prop(m, "text", at, PK::Str);
                let size = self.opt_prop(m, "size", at, PK::Num).unwrap_or(Prop::Const(Value::Float(16.0)));
                let font = self.opt_prop(m, "font", at, PK::Str);
                let weight = m.get("weight").map(|w| {
                    let wat = ptr(at, "weight");
                    match w.as_str() {
                        Some("bold") => Prop::Const(Value::Float(700.0)),
                        Some("normal") => Prop::Const(Value::Float(400.0)),
                        _ => self.prop(w, &wat, PK::Num),
                    }
                });
                let color = self.opt_prop(m, "color", at, PK::Color);
                let w = self.opt_prop(m, "w", at, PK::Num);
                let h = self.opt_prop(m, "h", at, PK::Num);
                let align = match self.word(m, "align", at, &["left", "center", "right"]) {
                    Some("left") => TextAlign::Left,
                    Some("right") => TextAlign::Right,
                    _ => TextAlign::Center,
                };
                let valign = match self.word(m, "valign", at, &["top", "middle", "bottom"]) {
                    Some("top") => TextValign::Top,
                    Some("bottom") => TextValign::Bottom,
                    _ => TextValign::Middle,
                };
                NodeKind::Text { text, size, font, weight, color, w, h, align, valign }
            }
            _ => unreachable!(),
        };
        self.scope_reset(mark);

        if let Some(t) = m.get("on_tap") {
            node.on_tap = self.binding(t, &ptr(at, "on_tap"));
        }
        if let Some(t) = m.get("on_drag") {
            node.on_drag = self.binding(t, &ptr(at, "on_drag"));
        }
        if let Some(t) = m.get("transition") {
            node.transitions = self.transitions(t, &ptr(at, "transition"));
        }
        if let Some(a) = m.get("animate_on") {
            node.animate_on = self.animate_on(a, &ptr(at, "animate_on"));
        }
        node
    }

    fn required_prop(&mut self, m: &Obj, key: &str, at: &str, pk: PK) -> Prop {
        match m.get(key) {
            Some(v) => self.prop(v, &ptr(at, key), pk),
            None => {
                self.pres_err(at, format!("this node is missing '{key}'"), None);
                Prop::Const(Value::None)
            }
        }
    }

    fn children(&mut self, m: &Obj, at: &str) -> Vec<Node> {
        let Some(c) = m.get("children") else { return Vec::new() };
        let cat = ptr(at, "children");
        match c {
            J::Array(items) => items.iter().enumerate().map(|(i, n)| self.node(n, &ptr(&cat, &i.to_string()))).collect(),
            other => {
                self.pres_err(&cat, format!("children must be a list of nodes, found {}", json_kind(other)), None);
                Vec::new()
            }
        }
    }

    /// Binds a node-local variable, reporting `E_SHADOWS_STATE` at `at`.
    fn node_local(&mut self, name: &str, ty: Type, at: &str) -> u16 {
        self.bind(Rc::from(name), ty, None, Some(at))
    }

    fn grid_node(&mut self, m: &Obj, at: &str) -> NodeKind {
        let (source, elem) = match m.get("source") {
            Some(s) => {
                let sat = ptr(at, "source");
                let (ir, t) = self.pres_expr(s, &sat, None);
                let elem = match &t {
                    Type::Grid(e) => (**e).clone(),
                    Type::Unknown => Type::Unknown,
                    t => {
                        self.err_at(Code::TypeMismatch, &sat, format!("grid source must be a grid, found {}", tyname(t)), None);
                        Type::Unknown
                    }
                };
                (Some(ir), Some(elem))
            }
            None => (None, None),
        };
        let cols = self.opt_prop(m, "cols", at, PK::Int);
        let rows = self.opt_prop(m, "rows", at, PK::Int);
        if source.is_none() && (cols.is_none() || rows.is_none()) {
            self.pres_err(at, "a grid needs either 'source' (a grid in state) or both 'cols' and 'rows'", None);
        }
        let cell_size = self.num_lit(m, "cell_size", at, None);
        let gap = self.num_lit(m, "gap", at, Some(0.0));
        let cell_slot = self.node_local("cell", Type::IVec2, at);
        let value_slot = elem.map(|e| self.node_local("value", e, at));
        let cell = match m.get("cell") {
            Some(c) => self.node(c, &ptr(at, "cell")),
            None => {
                self.pres_err(at, "a grid needs a 'cell' template node", None);
                self.node(&J::Null, &ptr(at, "cell"))
            }
        };
        NodeKind::Grid { source, cols, rows, cell_size, gap, cell: Box::new(cell), cell_slot, value_slot }
    }

    fn repeat_node(&mut self, m: &Obj, at: &str) -> NodeKind {
        let sat = ptr(at, "source");
        let (source, elem) = match m.get("source") {
            Some(s) => {
                let (ir, t) = self.pres_expr(s, &sat, None);
                let elem = match &t {
                    Type::List(e) => (**e).clone(),
                    Type::Unknown => Type::Unknown,
                    t => {
                        self.err_at(Code::TypeMismatch, &sat, format!("repeat source must be a list, found {}", tyname(t)), None);
                        Type::Unknown
                    }
                };
                (ir, elem)
            }
            None => {
                self.pres_err(at, "a repeat needs 'source' (a list)", None);
                (placeholder(), Type::Unknown)
            }
        };
        let as_name = match m.get("as") {
            Some(J::String(s)) if is_ident(s) => s.clone(),
            Some(other) => {
                self.pres_err(&ptr(at, "as"), format!("'as' must be a variable name, found {other}"), None);
                "item".to_string()
            }
            None => "item".to_string(),
        };
        let item_slot = self.node_local(&as_name, elem, at);
        let index_slot = self.node_local("index", Type::Int, at);
        let key = m.get("key").map(|k| self.pres_expr(k, &ptr(at, "key"), None).0);
        // Spec A12 calls the template `node`, but `node` already names the node
        // kind, so a JSON object can't carry both. The template lives under
        // `template` (alias `item`).
        let tkey = if m.contains_key("template") { "template" } else { "item" };
        let node = match m.get(tkey) {
            Some(n) if n.is_object() => self.node(n, &ptr(at, tkey)),
            _ => {
                self.pres_err(
                    at,
                    "a repeat needs a 'template' node",
                    Some("write {\"node\": \"repeat\", \"source\": \"meteors\", \"as\": \"m\", \"template\": {\"node\": \"circle\", ...}}".to_string()),
                );
                self.node(&J::Null, &ptr(at, "template"))
            }
        };
        NodeKind::Repeat { source, item_slot, index_slot, key, node: Box::new(node) }
    }

    fn binding(&mut self, v: &J, at: &str) -> Option<InputBinding> {
        let m = self.obj(v, at, "an input binding")?;
        self.pres_keys(m, &["input", "with"], at, "an input binding");
        let iat = ptr(at, "input");
        let name = match m.get("input") {
            Some(J::String(s)) => s.as_str(),
            _ => {
                self.pres_err(at, "missing \"input\": the input to send", None);
                return None;
            }
        };
        let Some(&id) = self.input_idx.get(name) else {
            let hint = dym(name, self.inputs.iter().map(|(n, _)| &**n))
                .or_else(|| Some(format!("declare it under \"inputs\", like \"{name}\": {{\"payload\": {{...}}}}")));
            let msg = if self.event_idx.contains_key(name) {
                format!("'{name}' is a custom event, not an input; taps can only send inputs")
            } else {
                format!("unknown input '{name}'")
            };
            self.err_at(Code::UnknownInput, &iat, msg, hint);
            return None;
        };
        let payload = self.inputs[id as usize].1.clone();
        let declared = &payload[..payload.len() - 1];
        let mark = self.scope_mark();
        // The pointer slot is the first slot of the presentation frame.
        self.bind_slot(Rc::from("pointer"), Type::Vec2, 0);
        let with = self.payload_args(declared, m.get("with"), at, &format!("input '{name}'"), at);
        self.scope_reset(mark);
        Some(InputBinding { input: id, with })
    }

    fn transitions(&mut self, v: &J, at: &str) -> Vec<Transition> {
        let Some(m) = self.obj(v, at, "transition") else { return Vec::new() };
        let mut out = Vec::new();
        for (k, tv) in m {
            let kat = ptr(at, k);
            let Some(prop) = PropName::from_name(k) else {
                self.pres_err(&kat, format!("'{k}' can't be animated"), dym(k, PROP_NAMES.iter().copied()));
                continue;
            };
            match tv {
                J::Number(n) => out.push(Transition { prop, ms: n.as_f64().unwrap_or(0.0), ease: Ease::default() }),
                J::Object(tm) => {
                    self.pres_keys(tm, &["ms", "ease"], &kat, "a transition");
                    let ms = self.num_lit(tm, "ms", &kat, Some(150.0));
                    let ease = self.ease(tm.get("ease"), &ptr(&kat, "ease"));
                    out.push(Transition { prop, ms, ease });
                }
                other => self.pres_err(&kat, format!("a transition must be {{\"ms\": 120, \"ease\": \"out\"}}, found {}", json_kind(other)), None),
            }
        }
        out
    }

    fn animate_on(&mut self, v: &J, at: &str) -> Vec<AnimateOn> {
        let Some(m) = self.obj(v, at, "animate_on") else { return Vec::new() };
        let mut out = Vec::new();
        for (k, av) in m {
            let kat = ptr(at, k);
            let Some((on, ectx)) = self.event_ref(k, &kat) else { continue };
            let Some(am) = self.obj(av, &kat, "an animation") else { continue };
            self.pres_keys(am, &["when", "prop", "keys", "ms", "ease"], &kat, "an animation");
            let prop = match am.get("prop").and_then(|p| p.as_str()) {
                Some(p) => match PropName::from_name(p) {
                    Some(x) => Some(x),
                    None => {
                        self.pres_err(&ptr(&kat, "prop"), format!("'{p}' can't be animated"), dym(p, PROP_NAMES.iter().copied()));
                        None
                    }
                },
                None => {
                    self.pres_err(&kat, "an animation needs \"prop\", like \"scale\"", None);
                    None
                }
            };
            let when = am.get("when").map(|w| {
                let saved = std::mem::replace(&mut self.root().event, ectx.clone());
                let (ir, _) = self.pres_expr(w, &ptr(&kat, "when"), Some(&Type::Bool));
                self.root().event = saved;
                ir
            });
            let pk = match prop {
                Some(p) if p.is_color() => PK::Color,
                _ => PK::Num,
            };
            let mut keys = Vec::new();
            match am.get("keys") {
                Some(J::Array(items)) if !items.is_empty() => {
                    for (i, kv) in items.iter().enumerate() {
                        let iat = ptr(&ptr(&kat, "keys"), &i.to_string());
                        match self.prop(kv, &iat, pk) {
                            Prop::Const(v) => keys.push(v),
                            Prop::Expr(_) => self.pres_err(&iat, "animation keys must be constants (numbers, colors or tokens)", None),
                        }
                    }
                }
                _ => self.pres_err(&kat, "an animation needs \"keys\": a non-empty list of values, like [1, 1.2, 1]", None),
            }
            let ms = self.num_lit(am, "ms", &kat, Some(200.0));
            let ease = self.ease(am.get("ease"), &ptr(&kat, "ease"));
            if let Some(prop) = prop {
                out.push(AnimateOn { on, when, prop, keys, ms, ease });
            }
        }
        out
    }

    fn feedback(&mut self, v: &J, at: &str) -> Option<Feedback> {
        let m = self.obj(v, at, "a feedback entry")?;
        self.pres_keys(m, &["on", "do"], at, "a feedback entry");
        let oat = ptr(at, "on");
        let name = match m.get("on") {
            Some(J::String(s)) => s.as_str(),
            _ => {
                self.pres_err(at, "feedback needs \"on\": an input, event, \"win\" or \"lose\"", None);
                return None;
            }
        };
        let (on, ectx) = self.event_ref(name, &oat)?;
        let saved = std::mem::replace(&mut self.root().event, ectx);
        let mut actions = Vec::new();
        let dat = ptr(at, "do");
        match m.get("do") {
            Some(J::Array(items)) => {
                for (i, a) in items.iter().enumerate() {
                    if let Some(x) = self.action(a, &ptr(&dat, &i.to_string())) {
                        actions.push(x);
                    }
                }
            }
            _ => self.pres_err(at, "feedback needs \"do\": a list of sound, toast or shake actions", None),
        }
        self.root().event = saved;
        Some(Feedback { on, actions })
    }

    fn action(&mut self, v: &J, at: &str) -> Option<FeedbackAction> {
        let m = self.obj(v, at, "a feedback action")?;
        let kinds = ["sound", "toast", "shake"];
        let Some(kind) = kinds.iter().copied().find(|k| m.contains_key(*k)) else {
            let key = m.keys().next().cloned().unwrap_or_default();
            self.pres_err(
                &ptr(at, &key),
                format!("unknown feedback action '{key}'"),
                dym(&key, kinds).or_else(|| Some("actions: sound, toast, shake".into())),
            );
            return None;
        };
        self.pres_keys(m, &[kind], at, "a feedback action");
        let kat = ptr(at, kind);
        let am = self.obj(&m[kind], &kat, kind)?;
        let num = |s: &mut Self, key: &str, default: f64| -> mg_core::scene::Prop {
            s.opt_prop(am, key, &kat, PK::Num).unwrap_or(Prop::Const(Value::Float(default)))
        };
        Some(match kind {
            "sound" => {
                self.pres_keys(am, &["wave", "note", "ms"], &kat, "sound");
                let wave = self.opt_prop(am, "wave", &kat, PK::Str).unwrap_or(Prop::Const(Value::str("sine")));
                if let Prop::Const(Value::Str(w)) = &wave {
                    if Wave::from_name(w).is_none() {
                        self.pres_err(
                            &ptr(&kat, "wave"),
                            format!("unknown wave '{w}'"),
                            dym(w, ["sine", "square", "triangle", "sawtooth"]),
                        );
                    }
                }
                let note = match am.get("note") {
                    Some(J::Number(n)) => Prop::Const(Value::Float(n.as_f64().unwrap_or(440.0))),
                    Some(nv) => {
                        let p = self.prop(nv, &ptr(&kat, "note"), PK::Str);
                        if let Prop::Const(Value::Str(s)) = &p {
                            if note_to_hz(s).is_none() {
                                self.pres_err(
                                    &ptr(&kat, "note"),
                                    format!("'{s}' is not a note"),
                                    Some("use a note name like C5, F#4 or Bb3, or a number in Hz".into()),
                                );
                            }
                        }
                        p
                    }
                    None => Prop::Const(Value::str("A4")),
                };
                let ms = num(self, "ms", 100.0);
                FeedbackAction::Sound { wave, note, ms }
            }
            "toast" => {
                self.pres_keys(am, &["text", "ms"], &kat, "toast");
                let text = match am.get("text") {
                    Some(t) => self.prop(t, &ptr(&kat, "text"), PK::Str),
                    None => {
                        self.pres_err(&kat, "toast needs \"text\"", None);
                        Prop::Const(Value::str(""))
                    }
                };
                let ms = num(self, "ms", 1500.0);
                FeedbackAction::Toast { text, ms }
            }
            _ => {
                self.pres_keys(am, &["px", "ms"], &kat, "shake");
                let px = num(self, "px", 8.0);
                let ms = num(self, "ms", 300.0);
                FeedbackAction::Shake { px, ms }
            }
        })
    }
}
