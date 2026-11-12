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
use mg_core::frame::Haptic;
use mg_core::limits::{MAX_PARTICLES_PER_BURST, MAX_POLY_POINTS};
use mg_core::scene::{
    Align, Anchor, AnimateOn, Camera, Canvas, Dir, Ease, EventRef, Feedback, FeedbackAction, InputBinding, Music, Node,
    NodeKind, ParticlesAction, Presentation, Prop, PropName, SoundAction, TextAlign, TextValign, Transition,
};
use mg_core::types::Type;
use mg_core::value::Value;
use serde_json::{Map, Value as J};

use crate::assets::AssetUse;
use crate::check::{dym, placeholder, tyname, Checker, EventCtx, Payload, Root};
use crate::{is_ident, json_kind, ptr};

type Obj = Map<String, J>;

const COMMON: &[&str] = &[
    "node", "id", "x", "y", "anchor", "rotation", "scale", "opacity", "visible", "fill", "stroke", "stroke_width", "on_tap",
    "on_drag", "on_press", "on_release", "transition", "animate_on", "fixed",
];
/// Keys of one `feedback` entry.
const FEEDBACK_KEYS: &[&str] = &["on", "when", "do"];
const KINDS: &[&str] = &["group", "stack", "grid", "repeat", "rect", "circle", "text", "image", "line", "poly"];
const ACTIONS: &[&str] = &["sound", "toast", "shake", "particles", "haptic"];
const WAVES: &[&str] = &["sine", "square", "triangle", "sawtooth"];
const HAPTICS: &[&str] = &["light", "medium", "heavy", "success", "warning", "error"];
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
        "text" => &["text", "size", "font", "weight", "color", "w", "h", "align", "valign", "wrap"],
        "image" => &["asset", "w", "h", "frame", "flip_x", "flip_y"],
        "line" => &["x1", "y1", "x2", "y2"],
        "poly" => &["points", "closed"],
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
            on_press: None,
            on_release: None,
            transitions: Vec::new(),
            animate_on: Vec::new(),
            fixed: false,
        };
        let mut p = Presentation {
            canvas: Canvas { w: 360.0, h: 640.0, background: Prop::Const(Value::str("#FFFFFF")) },
            root: empty_node("/presentation/root"),
            feedback: Vec::new(),
            n_locals: 0,
            pointer_slot,
            camera: None,
            music: None,
        };
        let m = match v {
            None => {
                self.err_at(Code::BadField, "", "the game file is missing 'presentation'", None);
                None
            }
            Some(v) => self.obj(v, "/presentation", "presentation"),
        };
        if let Some(m) = m {
            self.check_keys(
                m,
                &["canvas", "tokens", "root", "feedback", "camera", "music", "text_field"],
                "/presentation",
                "presentation",
            );
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
            if let Some(c) = m.get("camera") {
                p.camera = self.camera(c);
            }
            if let Some(mu) = m.get("music") {
                p.music = self.music(mu);
            }
            if let Some(t) = m.get("text_field") {
                self.text_field(t);
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
            on_press: None,
            on_release: None,
            transitions: Vec::new(),
            animate_on: Vec::new(),
            fixed: false,
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
                self.pres_err(at, format!("a node needs \"node\": one of {}", KINDS.join(", ")), None);
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
        let outer_fixed = self.pres_fixed;
        match m.get("fixed") {
            None => {}
            Some(J::Bool(b)) => self.pres_fixed |= *b,
            Some(other) => self.pres_err(
                &ptr(at, "fixed"),
                format!("'fixed' must be true or false, found {}", json_kind(other)),
                Some("\"fixed\": true keeps a node (and its children) in place when the camera moves".into()),
            ),
        }
        node.fixed = self.pres_fixed;

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
                let wrap = match m.get("wrap") {
                    None => false,
                    Some(J::Bool(b)) => *b,
                    Some(other) => {
                        self.pres_err(&ptr(at, "wrap"), format!("'wrap' must be true or false, found {}", json_kind(other)), None);
                        false
                    }
                };
                if wrap && w.is_none() {
                    self.pres_err(
                        &ptr(at, "wrap"),
                        "'wrap' needs a box width 'w' to wrap to",
                        Some("like {\"node\": \"text\", \"w\": 280, \"wrap\": true, ...}".into()),
                    );
                }
                NodeKind::Text { text, size, font, weight, color, w, h, align, valign, wrap }
            }
            "image" => {
                let asset = match m.get("asset") {
                    Some(a) => self.asset_prop(a, &ptr(at, "asset"), AssetUse::Image),
                    None => {
                        self.pres_err(at, "an image node is missing 'asset'", Some("like {\"node\": \"image\", \"asset\": \"hero\"}".into()));
                        Prop::Const(Value::None)
                    }
                };
                NodeKind::Image {
                    asset,
                    w: self.opt_prop(m, "w", at, PK::Num),
                    h: self.opt_prop(m, "h", at, PK::Num),
                    frame: self.opt_prop(m, "frame", at, PK::Int),
                    flip_x: self.opt_prop(m, "flip_x", at, PK::Bool),
                    flip_y: self.opt_prop(m, "flip_y", at, PK::Bool),
                }
            }
            "line" => {
                // The start defaults to the node's origin; the end is required.
                let zero = || Prop::Const(Value::Float(0.0));
                let x1 = self.opt_prop(m, "x1", at, PK::Num).unwrap_or_else(zero);
                let y1 = self.opt_prop(m, "y1", at, PK::Num).unwrap_or_else(zero);
                let x2 = self.required_prop(m, "x2", at, PK::Num);
                let y2 = self.required_prop(m, "y2", at, PK::Num);
                if node.stroke_width.is_none() {
                    node.stroke_width = Some(Prop::Const(Value::Float(2.0)));
                }
                NodeKind::Line { x1, y1, x2, y2 }
            }
            "poly" => {
                let points = match m.get("points") {
                    Some(pv) => self.points_prop(pv, &ptr(at, "points")),
                    None => {
                        self.pres_err(at, "this node is missing 'points'", Some("like \"points\": [[0, 0], [20, 0], [10, 16]]".into()));
                        Prop::Const(Value::None)
                    }
                };
                let closed = match m.get("closed") {
                    None => true,
                    Some(J::Bool(b)) => *b,
                    Some(other) => {
                        self.pres_err(&ptr(at, "closed"), format!("'closed' must be true or false, found {}", json_kind(other)), None);
                        true
                    }
                };
                NodeKind::Poly { points, closed }
            }
            _ => unreachable!(),
        };
        self.scope_reset(mark);
        self.pres_fixed = outer_fixed;

        if let Some(t) = m.get("on_tap") {
            node.on_tap = self.binding(t, &ptr(at, "on_tap"));
        }
        if let Some(t) = m.get("on_drag") {
            node.on_drag = self.binding(t, &ptr(at, "on_drag"));
        }
        if let Some(t) = m.get("on_press") {
            node.on_press = self.binding(t, &ptr(at, "on_press"));
        }
        if let Some(t) = m.get("on_release") {
            node.on_release = self.binding(t, &ptr(at, "on_release"));
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
        self.pres_keys(m, FEEDBACK_KEYS, at, "a feedback entry");
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
        let when = m.get("when").map(|w| self.pres_expr(w, &ptr(at, "when"), Some(&Type::Bool)).0);
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
            _ => self.pres_err(at, "feedback needs \"do\": a list of sound, toast, shake, particles or haptic actions", None),
        }
        self.root().event = saved;
        Some(Feedback { on, when, actions })
    }

    fn action(&mut self, v: &J, at: &str) -> Option<FeedbackAction> {
        let m = self.obj(v, at, "a feedback action")?;
        let Some(kind) = ACTIONS.iter().copied().find(|k| m.contains_key(*k)) else {
            let key = m.keys().next().cloned().unwrap_or_default();
            self.pres_err(
                &ptr(at, &key),
                format!("unknown feedback action '{key}'"),
                dym(&key, ACTIONS.iter().copied()).or_else(|| Some(format!("actions: {}", ACTIONS.join(", ")))),
            );
            return None;
        };
        self.pres_keys(m, &[kind], at, "a feedback action");
        let kat = ptr(at, kind);
        if kind == "haptic" {
            let p = self.prop(&m[kind], &kat, PK::Str);
            if let Prop::Const(Value::Str(s)) = &p {
                if Haptic::from_name(s).is_none() {
                    let hint = dym(s, HAPTICS.iter().copied()).or_else(|| Some(format!("haptics: {}", HAPTICS.join(", "))));
                    self.pres_err(&kat, format!("unknown haptic '{s}'"), hint);
                }
            }
            return Some(FeedbackAction::Haptic(p));
        }
        let am = self.obj(&m[kind], &kat, kind)?;
        Some(match kind {
            "sound" => FeedbackAction::Sound(self.sound(am, &kat)),
            "particles" => FeedbackAction::Particles(self.particles(am, &kat)),
            "toast" => {
                self.pres_keys(am, &["text", "ms"], &kat, "toast");
                let text = match am.get("text") {
                    Some(t) => self.prop(t, &ptr(&kat, "text"), PK::Str),
                    None => {
                        self.pres_err(&kat, "toast needs \"text\"", None);
                        Prop::Const(Value::str(""))
                    }
                };
                let ms = self.num_prop(am, "ms", &kat, 1500.0);
                FeedbackAction::Toast { text, ms }
            }
            _ => {
                self.pres_keys(am, &["px", "ms"], &kat, "shake");
                let px = self.num_prop(am, "px", &kat, 8.0);
                let ms = self.num_prop(am, "ms", &kat, 300.0);
                FeedbackAction::Shake { px, ms }
            }
        })
    }

    /// An optional numeric prop with a default.
    fn num_prop(&mut self, m: &Obj, key: &str, at: &str, default: f64) -> Prop {
        self.opt_prop(m, key, at, PK::Num).unwrap_or(Prop::Const(Value::Float(default)))
    }

    /// Reports a constant numeric prop outside `[lo, hi]`.
    fn check_range(&mut self, p: &Prop, at: &str, lo: f64, hi: f64, what: &str) {
        if let Prop::Const(v) = p {
            if let Some(x) = v.as_f64() {
                if !(x >= lo && x <= hi) {
                    self.pres_err(at, format!("expected {what}, found {}", mg_core::value::format_float(x)), None);
                }
            }
        }
    }

    /// SPEC-v0.2 §6: sample (`asset`), jingle (`notes`) or synth note.
    fn sound(&mut self, am: &Obj, at: &str) -> SoundAction {
        const ALL: &[&str] = &["asset", "wave", "note", "notes", "step_ms", "slide", "ms", "volume", "rate"];
        let (form, allowed): (&str, &[&str]) = if am.contains_key("asset") {
            ("sample", &["asset", "volume", "rate"])
        } else if am.contains_key("notes") {
            ("jingle", &["wave", "notes", "step_ms", "slide", "volume"])
        } else {
            ("synth", &["wave", "note", "ms", "slide", "volume"])
        };
        for k in am.keys() {
            if k.starts_with('_') || allowed.contains(&k.as_str()) {
                continue;
            }
            let kat = ptr(at, k);
            if ALL.contains(&k.as_str()) {
                let hint = match (form, k.as_str()) {
                    ("sample", _) => format!("a sample sound (\"asset\") only takes volume and rate; remove '{k}', or remove \"asset\" for a synth sound"),
                    ("jingle", "note") => "use \"note\" for one note or \"notes\" for a jingle, not both".to_string(),
                    ("jingle", "ms") => "each jingle note lasts \"step_ms\"".to_string(),
                    ("synth", "step_ms") => "step_ms only applies to jingles (\"notes\": [...])".to_string(),
                    (_, "rate") => "rate only applies to samples (\"asset\": ...)".to_string(),
                    _ => format!("a {form} sound takes: {}", allowed.join(", ")),
                };
                self.pres_err(&kat, format!("'{k}' doesn't apply to a {form} sound"), Some(hint));
            } else {
                let hint = dym(k, ALL.iter().copied()).or_else(|| Some(format!("a {form} sound takes: {}", allowed.join(", "))));
                self.pres_err(&kat, format!("unknown property '{k}' on sound"), hint);
            }
        }
        let asset = am.get("asset").map(|a| self.asset_prop(a, &ptr(at, "asset"), AssetUse::Sound));
        let wave = self.opt_prop(am, "wave", at, PK::Str).unwrap_or(Prop::Const(Value::str("sine")));
        if let Prop::Const(Value::Str(w)) = &wave {
            if Wave::from_name(w).is_none() {
                let hint = dym(w, WAVES.iter().copied()).or_else(|| Some(format!("waves: {}", WAVES.join(", "))));
                self.pres_err(&ptr(at, "wave"), format!("unknown wave '{w}'"), hint);
            }
        }
        let note = match am.get("note") {
            Some(n) => self.note_prop(n, &ptr(at, "note")),
            None => Prop::Const(Value::str("A4")),
        };
        let notes = am.get("notes").map(|n| self.notes_prop(n, &ptr(at, "notes")));
        let slide = am.get("slide").map(|n| self.note_prop(n, &ptr(at, "slide")));
        let ms = self.num_prop(am, "ms", at, 100.0);
        self.check_range(&ms, &ptr(at, "ms"), f64::MIN_POSITIVE, f64::MAX, "a positive number of ms");
        let step_ms = self.num_prop(am, "step_ms", at, 80.0);
        self.check_range(&step_ms, &ptr(at, "step_ms"), f64::MIN_POSITIVE, f64::MAX, "a positive number of ms");
        let volume = self.num_prop(am, "volume", at, 0.6);
        self.check_range(&volume, &ptr(at, "volume"), 0.0, 1.0, "a volume from 0 to 1");
        let rate = self.num_prop(am, "rate", at, 1.0);
        self.check_range(&rate, &ptr(at, "rate"), f64::MIN_POSITIVE, 16.0, "a playback rate above 0 (1 = normal speed)");
        SoundAction { asset, wave, note, notes, step_ms, slide, ms, volume, rate }
    }

    fn check_note(&mut self, s: &str, at: &str) {
        if note_to_hz(s).is_none_or(|hz| !(hz > 0.0 && hz.is_finite())) {
            self.pres_err(at, format!("'{s}' is not a note"), Some("use a note name like C5, F#4 or Bb3, or a number in Hz".into()));
        }
    }

    /// A note: a name (`C5`), a number in Hz, or an expression giving either.
    fn note_prop(&mut self, v: &J, at: &str) -> Prop {
        match v {
            J::Number(n) => {
                let hz = n.as_f64().unwrap_or(0.0);
                if hz <= 0.0 {
                    self.pres_err(at, format!("a frequency must be positive, found {n}"), None);
                }
                Prop::Const(Value::Float(hz))
            }
            J::String(s) if s.trim_start().starts_with('=') => {
                let src = s.replacen('=', " ", 1);
                let (ir, t) = self.expr_src(&src, at, None);
                let ir = match t {
                    Type::Int => crate::check::to_float(ir),
                    Type::Float | Type::Str | Type::Enum(_) | Type::Unknown => ir,
                    t => {
                        self.err_at(
                            Code::TypeMismatch,
                            at,
                            format!("a note must be a note name (string) or a number in Hz, found {}", tyname(&t)),
                            None,
                        );
                        ir
                    }
                };
                match ir {
                    IR::Const(v) => {
                        if let Value::Str(s) = &v {
                            self.check_note(s, at);
                        }
                        Prop::Const(v)
                    }
                    e => Prop::Expr(e),
                }
            }
            _ => {
                let p = self.prop(v, at, PK::Str);
                if let Prop::Const(Value::Str(s)) = &p {
                    self.check_note(s, at);
                }
                p
            }
        }
    }

    /// Jingle notes: a literal list of note names / Hz numbers (lowered to a
    /// list of strings), or an expression / token giving `list<string>`.
    fn notes_prop(&mut self, v: &J, at: &str) -> Prop {
        let check_list = |ck: &mut Self, items: &[Value]| {
            if items.is_empty() {
                ck.pres_err(at, "a jingle needs at least one note", Some("like \"notes\": [\"C5\", \"E5\", \"G5\"]".into()));
            }
            for (i, it) in items.iter().enumerate() {
                if let Value::Str(s) = it {
                    ck.check_note(s, &ptr(at, &i.to_string()));
                }
            }
        };
        match v {
            J::Array(items) => {
                let mut out = Vec::with_capacity(items.len());
                for (i, it) in items.iter().enumerate() {
                    match it {
                        J::String(s) => out.push(Value::str(s)),
                        J::Number(n) => out.push(Value::str(&n.to_string())),
                        other => self.pres_err(
                            &ptr(at, &i.to_string()),
                            format!("a note must be a note name or a number in Hz, found {}", json_kind(other)),
                            None,
                        ),
                    }
                }
                check_list(self, &out);
                Prop::Const(Value::list(out))
            }
            // A string is always an expression here (a leading '=' is tolerated).
            J::String(s) => {
                let src = if s.trim_start().starts_with('=') { s.replacen('=', " ", 1) } else { s.clone() };
                let (ir, _) = self.expr_src(&src, at, Some(&Type::list(Type::Str)));
                match ir {
                    IR::Const(v) => {
                        if let Some(items) = v.as_list() {
                            let items = items.clone();
                            check_list(self, &items);
                        }
                        Prop::Const(v)
                    }
                    e => Prop::Expr(e),
                }
            }
            other => {
                self.pres_err(at, format!("notes must be a list of notes, found {}", json_kind(other)), Some("like \"notes\": [\"C5\", \"E5\", \"G5\"]".into()));
                Prop::Const(Value::None)
            }
        }
    }

    /// SPEC-v0.2 §7.
    fn particles(&mut self, am: &Obj, at: &str) -> ParticlesAction {
        self.pres_keys(am, &["x", "y", "count", "color", "speed", "size", "ms", "gravity", "spread"], at, "particles");
        let xy = |ck: &mut Self, key: &str| match ck.opt_prop(am, key, at, PK::Num) {
            Some(p) => p,
            None => {
                ck.pres_err(
                    at,
                    format!("particles needs '{key}' (world coordinates)"),
                    Some(format!("like \"{key}\": \"= event.{key}\" or a number")),
                );
                Prop::Const(Value::Float(0.0))
            }
        };
        let x = xy(self, "x");
        let y = xy(self, "y");
        let count = self.opt_prop(am, "count", at, PK::Int).unwrap_or(Prop::Const(Value::Int(12)));
        if let Prop::Const(Value::Int(n)) = &count {
            let cat = ptr(at, "count");
            if *n < 1 {
                self.pres_err(&cat, format!("count must be at least 1, found {n}"), None);
            } else if *n as usize > MAX_PARTICLES_PER_BURST {
                self.err_at(Code::Limit, &cat, format!("count is {n}; the limit is {MAX_PARTICLES_PER_BURST} particles per burst"), None);
            }
        }
        let color = self.opt_prop(am, "color", at, PK::Color).unwrap_or(Prop::Const(Value::str("#FFFFFF")));
        let speed = self.num_prop(am, "speed", at, 200.0);
        self.check_range(&speed, &ptr(at, "speed"), 0.0, f64::MAX, "a speed >= 0");
        let size = self.num_prop(am, "size", at, 4.0);
        self.check_range(&size, &ptr(at, "size"), f64::MIN_POSITIVE, f64::MAX, "a positive size");
        let ms = self.num_prop(am, "ms", at, 500.0);
        self.check_range(&ms, &ptr(at, "ms"), f64::MIN_POSITIVE, f64::MAX, "a positive number of ms");
        let gravity = self.num_prop(am, "gravity", at, 0.0);
        let spread = self.num_prop(am, "spread", at, 360.0);
        self.check_range(&spread, &ptr(at, "spread"), 0.0, 360.0, "an angle from 0 to 360 degrees");
        ParticlesAction { x, y, count, color, speed, size, ms, gravity, spread }
    }

    /// An asset name prop (literal, token or `= expression` giving a string).
    /// Constant names are checked against the declared assets.
    fn asset_prop(&mut self, v: &J, at: &str, want: AssetUse) -> Prop {
        let p = self.prop(v, at, PK::Str);
        if let Prop::Const(Value::Str(s)) = &p {
            self.check_asset_name(s, at, want);
        }
        p
    }

    /// Poly `points`: a literal list of `[x, y]` pairs (lowered to `vec2`s) or
    /// an expression giving `list<vec2>` or `list<ivec2>`.
    fn points_prop(&mut self, v: &J, at: &str) -> Prop {
        let count_check = |ck: &mut Self, n: usize| {
            if n > MAX_POLY_POINTS {
                ck.err_at(Code::Limit, at, format!("{n} points; the limit is {MAX_POLY_POINTS} per poly"), None);
            } else if n < 2 {
                ck.pres_err(at, format!("a poly needs at least 2 points, found {n}"), None);
            }
        };
        match v {
            J::Array(items) => {
                count_check(self, items.len());
                let mut out = Vec::with_capacity(items.len());
                for (i, it) in items.iter().enumerate() {
                    match it.as_array().map(|p| p.as_slice()) {
                        Some([J::Number(x), J::Number(y)]) => {
                            out.push(Value::Vec2(x.as_f64().unwrap_or(0.0), y.as_f64().unwrap_or(0.0)))
                        }
                        _ => self.pres_err(
                            &ptr(at, &i.to_string()),
                            format!("a point must be [x, y] (two numbers), found {it}"),
                            None,
                        ),
                    }
                }
                Prop::Const(Value::list(out))
            }
            // A string is always an expression here (a leading '=' is tolerated).
            J::String(s) => {
                let src = if s.trim_start().starts_with('=') { s.replacen('=', " ", 1) } else { s.clone() };
                let (ir, t) = self.expr_src(&src, at, None);
                let ok = match &t {
                    Type::List(e) => matches!(**e, Type::Vec2 | Type::IVec2 | Type::Unknown),
                    Type::Unknown => true,
                    _ => false,
                };
                if !ok {
                    self.err_at(
                        Code::TypeMismatch,
                        at,
                        format!("points must be list<vec2> or list<ivec2>, found {}", tyname(&t)),
                        Some("like \"= [vec(0, 0), vec(20, 0), vec(10, 16)]\"".into()),
                    );
                }
                match ir {
                    IR::Const(v) => {
                        if let Some(items) = v.as_list() {
                            count_check(self, items.len());
                        }
                        Prop::Const(v)
                    }
                    // A list literal (`[vec(0, 0), ...]`) has a known length.
                    e => {
                        if let IR::List(items) = &e {
                            count_check(self, items.len());
                        }
                        Prop::Expr(e)
                    }
                }
            }
            other => {
                self.pres_err(
                    at,
                    format!("points must be a list of [x, y] pairs or an '=' expression, found {}", json_kind(other)),
                    Some("like \"points\": [[0, 0], [20, 0], [10, 16]]".into()),
                );
                Prop::Const(Value::None)
            }
        }
    }

    fn camera(&mut self, v: &J) -> Option<Camera> {
        let at = "/presentation/camera";
        let m = self.obj(v, at, "camera")?;
        self.pres_keys(m, &["x", "y"], at, "camera");
        // Camera coordinates are always expressions ("0" and "= p.x" both work).
        let coord = |ck: &mut Self, key: &str| match m.get(key) {
            None => Prop::Const(Value::Float(0.0)),
            Some(v) => match ck.pres_expr(v, &ptr(at, key), Some(&Type::Float)).0 {
                IR::Const(c) => Prop::Const(c),
                e => Prop::Expr(e),
            },
        };
        let x = coord(self, "x");
        let y = coord(self, "y");
        Some(Camera { x, y })
    }

    fn music(&mut self, v: &J) -> Option<Music> {
        let at = "/presentation/music";
        let m = self.obj(v, at, "music")?;
        self.pres_keys(m, &["asset", "volume", "playing"], at, "music");
        let asset = match m.get("asset") {
            Some(a) => self.asset_prop(a, &ptr(at, "asset"), AssetUse::Sound),
            None => {
                self.pres_err(at, "music needs 'asset': a sound asset to loop", Some("like \"music\": {\"asset\": \"theme\", \"volume\": 0.4}".into()));
                return None;
            }
        };
        let volume = self.num_prop(m, "volume", at, 0.6);
        self.check_range(&volume, &ptr(at, "volume"), 0.0, 1.0, "a volume from 0 to 1");
        let playing = self.opt_prop(m, "playing", at, PK::Bool);
        Some(Music { asset, volume, playing })
    }

    fn text_field(&mut self, v: &J) {
        let at = "/presentation/text_field";
        let Some(m) = self.obj(v, at, "text_field") else { return };
        self.pres_keys(m, &["x", "y", "w", "h", "size"], at, "text_field");
        let get = |ck: &mut Self, key: &str, positive: bool| -> Option<f64> {
            let x = ck.num_lit(m, key, at, Some(f64::NAN));
            if x.is_nan() {
                return None;
            }
            if positive && x <= 0.0 {
                ck.pres_err(&ptr(at, key), format!("'{key}' must be positive, found {}", mg_core::value::format_float(x)), None);
            }
            Some(x)
        };
        let parts = [get(self, "x", false), get(self, "y", false), get(self, "w", true), get(self, "h", true)];
        let size = get(self, "size", true);
        let given = ["x", "y", "w", "h"].iter().filter(|k| m.contains_key(**k)).count();
        let rect = match parts {
            [Some(x), Some(y), Some(w), Some(h)] => Some((x, y, w, h)),
            _ => {
                if given > 0 {
                    let missing: Vec<&str> = ["x", "y", "w", "h"].into_iter().filter(|k| !m.contains_key(*k)).collect();
                    if !missing.is_empty() {
                        self.pres_err(
                            at,
                            format!("text_field is missing {}", missing.iter().map(|k| format!("'{k}'")).collect::<Vec<_>>().join(", ")),
                            Some("give all of x, y, w and h (canvas units), or none for the default bar at the bottom".into()),
                        );
                    }
                }
                None
            }
        };
        self.text_field = Some((rect, size));
    }
}
