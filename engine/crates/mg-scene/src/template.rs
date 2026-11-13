//! Load-time compilation of `scene::Presentation` into a flat node arena with
//! constant props pre-converted (colors parsed, numbers widened), so a frame
//! build never re-parses a literal.

use std::collections::HashMap;
use std::rc::Rc;

use mg_core::color::{parse_color, Rgba};
use mg_core::ir::{AssetId, AssetKind, Expr, Program, Slot};
use mg_core::limits::MAX_POLY_POINTS;
use mg_core::scene::{
    Align, Anchor, AnimateOn, Dir, Ease, EventRef, Feedback, InputBinding, Node, NodeKind, Presentation, Prop,
    PropName, TextAlign, TextValign, Transition,
};
use mg_core::{Code, Diagnostic, Value};

use crate::motion::PV;
use crate::util::prop_bit;

/// A prop: pre-converted constant or an expression evaluated each build.
#[derive(Clone, Debug)]
pub enum P<T> {
    C(T),
    E(Expr),
}

/// Conversion of a runtime value into a typed prop value.
pub trait FromValue: Sized + Clone {
    const WHAT: &'static str;
    fn from_value(v: &Value) -> Option<Self>;
}

impl FromValue for f64 {
    const WHAT: &'static str = "a number";
    #[inline]
    fn from_value(v: &Value) -> Option<f64> {
        v.as_f64().filter(|f| !f.is_nan())
    }
}

impl FromValue for bool {
    const WHAT: &'static str = "a bool";
    #[inline]
    fn from_value(v: &Value) -> Option<bool> {
        v.as_bool()
    }
}

/// Colors are `Value::Str` parsed with `parse_color`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Color(pub Rgba);

impl FromValue for Color {
    const WHAT: &'static str = "a color string";
    #[inline]
    fn from_value(v: &Value) -> Option<Color> {
        v.as_str().and_then(parse_color).map(Color)
    }
}

/// Text content: strings as-is, anything else formatted like `str()`.
impl FromValue for Rc<str> {
    const WHAT: &'static str = "a string";
    fn from_value(v: &Value) -> Option<Rc<str>> {
        match v {
            Value::Str(s) => Some(s.clone()),
            Value::None => Some(Rc::from("")),
            other => Some(Rc::from(other.to_string())),
        }
    }
}

/// Font weight: a number (100..=900) or `normal` / `bold`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Weight(pub u16);

impl FromValue for Weight {
    const WHAT: &'static str = "a font weight";
    fn from_value(v: &Value) -> Option<Weight> {
        match v {
            Value::Str(s) => match &**s {
                "normal" | "regular" => Some(Weight(400)),
                "bold" => Some(Weight(700)),
                s => s.parse::<f64>().ok().map(|f| Weight(f.clamp(1.0, 1000.0) as u16)),
            },
            v => v.as_f64().map(|f| Weight(f.clamp(1.0, 1000.0) as u16)),
        }
    }
}

/// `poly` points (`list<vec2|ivec2>`), relative to the node origin.
#[derive(Clone, Debug, PartialEq)]
pub struct Points(pub Rc<[(f64, f64)]>);

impl FromValue for Points {
    const WHAT: &'static str = "a list of vec2";
    fn from_value(v: &Value) -> Option<Points> {
        let Value::List(items) = v else { return None };
        let mut out = Vec::with_capacity(items.len());
        for it in items.iter() {
            match it {
                Value::Vec2(x, y) if x.is_finite() && y.is_finite() => out.push((*x, *y)),
                Value::IVec2(x, y) => out.push((*x as f64, *y as f64)),
                _ => return None,
            }
        }
        Some(Points(out.into()))
    }
}

/// An asset reference: resolved at load time when the name is a literal.
#[derive(Clone, Debug)]
pub enum AssetRef {
    Id(AssetId),
    /// Name expression, resolved each build.
    Expr(Expr),
    /// Bad literal (reported at load time); the node / music is skipped.
    Bad,
}

#[derive(Clone, Debug)]
pub struct TMusic {
    pub asset: AssetRef,
    pub volume: P<f64>,
    pub playing: Option<P<bool>>,
}

#[derive(Clone, Debug)]
pub struct TAnim {
    pub on: EventRef,
    pub when: Option<Expr>,
    pub prop: PropName,
    pub keys: Vec<PV>,
    pub ms: f64,
    pub ease: Ease,
}

#[derive(Clone, Debug)]
pub enum TKind {
    /// v0.2.2: `w`/`h` set together (an explicit box); `clip` implies them.
    Group { children: Vec<u32>, w: Option<P<f64>>, h: Option<P<f64>>, clip: bool },
    Stack { dir: Dir, gap: f64, align: Align, children: Vec<u32> },
    Grid {
        source: Option<Expr>,
        cols: Option<P<f64>>,
        rows: Option<P<f64>>,
        cell_size: f64,
        gap: f64,
        cell: u32,
        cell_slot: Slot,
        value_slot: Option<Slot>,
    },
    Repeat { source: Expr, item_slot: Slot, index_slot: Slot, key: Option<Expr>, node: u32 },
    Rect { w: P<f64>, h: P<f64>, radius: Option<P<f64>> },
    Circle { r: P<f64> },
    Text {
        text: P<Rc<str>>,
        size: P<f64>,
        font: Option<P<Rc<str>>>,
        weight: Option<P<Weight>>,
        color: Option<P<Color>>,
        w: Option<P<f64>>,
        h: Option<P<f64>>,
        align: TextAlign,
        valign: TextValign,
        wrap: bool,
    },
    Image {
        asset: AssetRef,
        w: Option<P<f64>>,
        h: Option<P<f64>>,
        frame: Option<P<f64>>,
        flip_x: Option<P<bool>>,
        flip_y: Option<P<bool>>,
        /// v0.2.2: `[src_x, src_y, src_w, src_h]`; `None` when none is set.
        src: Option<Box<[Option<P<f64>>; 4]>>,
    },
    Line { x1: P<f64>, y1: P<f64>, x2: P<f64>, y2: P<f64> },
    Poly { points: P<Points>, closed: bool, hit_shape: bool },
}

#[derive(Clone, Debug)]
pub struct TNode {
    pub at: Rc<str>,
    pub kind: TKind,
    pub x: Option<P<f64>>,
    pub y: Option<P<f64>>,
    pub anchor: Anchor,
    pub rotation: Option<P<f64>>,
    pub scale: Option<P<f64>>,
    pub opacity: Option<P<f64>>,
    pub visible: Option<P<bool>>,
    pub fill: Option<P<Color>>,
    pub stroke: Option<P<Color>>,
    pub stroke_width: Option<P<f64>>,
    pub on_tap: Option<InputBinding>,
    pub on_drag: Option<InputBinding>,
    pub on_press: Option<InputBinding>,
    pub on_release: Option<InputBinding>,
    pub transitions: Vec<Transition>,
    pub animate_on: Vec<TAnim>,
    /// Bit per `PropName` with a transition / animation (fast skip).
    pub trans_mask: u16,
    pub anim_mask: u16,
    /// Ignores the camera: the node's own `fixed` or an ancestor's.
    pub fixed: bool,
}

impl TNode {
    /// Takes pointer downs: has `on_tap`, `on_drag`, `on_press` or `on_release`.
    #[inline]
    pub fn is_target(&self) -> bool {
        self.on_tap.is_some() || self.on_drag.is_some() || self.on_press.is_some() || self.on_release.is_some()
    }
    #[inline]
    pub fn has_motion(&self, p: PropName) -> bool {
        (self.trans_mask | self.anim_mask) & prop_bit(p) != 0
    }
}

pub struct Template {
    pub canvas_w: f64,
    pub canvas_h: f64,
    pub background: Option<P<Color>>,
    /// Arena; `nodes[0]` is the root (pre-order ids).
    pub nodes: Vec<TNode>,
    pub feedback: Vec<Feedback>,
    pub n_locals: u16,
    pub pointer_slot: Slot,
    /// Events some `animate_on` listens to.
    pub anim_events: Vec<EventRef>,
    /// Longest `animate_on` duration (pending events older than this are dropped).
    pub max_anim_ms: f64,
    /// Whether any presentation expression can read `now`.
    pub uses_now: bool,
    /// Asset name → id, for names computed at run time.
    pub asset_ids: HashMap<Rc<str>, AssetId>,
    pub camera: Option<(P<f64>, P<f64>)>,
    pub music: Option<TMusic>,
    /// Some node is `fixed` (so ops need sorting into layers).
    pub any_fixed: bool,
}

/// Resolves an asset name, checking its kind. `Err` is a message.
pub fn resolve_asset(
    program: &Program,
    ids: &HashMap<Rc<str>, AssetId>,
    name: &str,
    want_image: bool,
) -> Result<AssetId, String> {
    let Some(&id) = ids.get(name) else {
        return Err(format!("unknown asset `{name}`"));
    };
    match (&program.assets[id as usize].kind, want_image) {
        (AssetKind::Image { .. }, true) | (AssetKind::Sound { .. }, false) => Ok(id),
        (AssetKind::Sound { .. }, true) => Err(format!("asset `{name}` is a sound, not an image")),
        (AssetKind::Image { .. }, false) => Err(format!("asset `{name}` is an image, not a sound")),
    }
}

pub const DEFAULT_FONT: &str = "Inter, system-ui, sans-serif";
pub const BLACK: Rgba = 0x0000_00FF;

struct Compiler<'a> {
    program: &'a Program,
    asset_ids: &'a HashMap<Rc<str>, AssetId>,
    nodes: Vec<TNode>,
    diags: &'a mut Vec<Diagnostic>,
}

impl Compiler<'_> {
    fn asset(&mut self, p: &Prop, at: &str, image: bool) -> AssetRef {
        match p {
            Prop::Expr(Expr::Const(v)) | Prop::Const(v) => {
                let r = match v.as_str() {
                    Some(name) => resolve_asset(self.program, self.asset_ids, name, image),
                    None => Err(format!("`asset` must be an asset id string, got `{v}`")),
                };
                match r {
                    Ok(id) => AssetRef::Id(id),
                    Err(msg) => {
                        self.diags.push(Diagnostic::new(Code::Asset, format!("{at}/asset"), msg));
                        AssetRef::Bad
                    }
                }
            }
            Prop::Expr(e) => AssetRef::Expr(e.clone()),
        }
    }

    fn prop<T: FromValue>(&mut self, p: &Prop, at: &str, name: &str) -> Option<P<T>> {
        match p {
            Prop::Expr(Expr::Const(v)) | Prop::Const(v) => match T::from_value(v) {
                Some(t) => Some(P::C(t)),
                None => {
                    self.diags.push(Diagnostic::new(
                        Code::Presentation,
                        format!("{at}/{name}"),
                        format!("`{name}` must be {}, got `{v}`", T::WHAT),
                    ));
                    None
                }
            },
            Prop::Expr(e) => Some(P::E(e.clone())),
        }
    }
    fn opt<T: FromValue>(&mut self, p: &Option<Prop>, at: &str, name: &str) -> Option<P<T>> {
        p.as_ref().and_then(|p| self.prop(p, at, name))
    }
    fn req<T: FromValue>(&mut self, p: &Prop, at: &str, name: &str, default: T) -> P<T> {
        self.prop(p, at, name).unwrap_or(P::C(default))
    }

    fn node(&mut self, n: &Node, parent_fixed: bool) -> u32 {
        let id = self.nodes.len() as u32;
        let at: &str = &n.at;
        let fixed = parent_fixed || n.fixed;
        // Placeholder so children get later ids (pre-order).
        self.nodes.push(TNode {
            at: n.at.clone(),
            kind: TKind::Group { children: Vec::new(), w: None, h: None, clip: false },
            x: None,
            y: None,
            anchor: n.anchor,
            rotation: None,
            scale: None,
            opacity: None,
            visible: None,
            fill: None,
            stroke: None,
            stroke_width: None,
            on_tap: n.on_tap.clone(),
            on_drag: n.on_drag.clone(),
            on_press: n.on_press.clone(),
            on_release: n.on_release.clone(),
            transitions: n.transitions.clone(),
            animate_on: Vec::new(),
            trans_mask: 0,
            anim_mask: 0,
            fixed,
        });
        let x = self.opt(&n.x, at, "x");
        let y = self.opt(&n.y, at, "y");
        let rotation = self.opt(&n.rotation, at, "rotation");
        let scale = self.opt(&n.scale, at, "scale");
        let opacity = self.opt(&n.opacity, at, "opacity");
        let visible = self.opt(&n.visible, at, "visible");
        let fill = self.opt(&n.fill, at, "fill");
        let stroke = self.opt(&n.stroke, at, "stroke");
        let stroke_width = self.opt(&n.stroke_width, at, "stroke_width");
        let kind = match &n.kind {
            NodeKind::Group { children, w, h, clip } => {
                let w = self.opt(w, at, "w");
                let h = self.opt(h, at, "h");
                // Both or neither (mg-lang reports a lone one).
                let (w, h) = if w.is_some() && h.is_some() { (w, h) } else { (None, None) };
                TKind::Group {
                    clip: *clip && w.is_some(),
                    w,
                    h,
                    children: children.iter().map(|c| self.node(c, fixed)).collect(),
                }
            }
            NodeKind::Stack { dir, gap, align, children } => TKind::Stack {
                dir: *dir,
                gap: *gap,
                align: *align,
                children: children.iter().map(|c| self.node(c, fixed)).collect(),
            },
            NodeKind::Grid { source, cols, rows, cell_size, gap, cell, cell_slot, value_slot } => {
                let cols = self.opt(cols, at, "cols");
                let rows = self.opt(rows, at, "rows");
                TKind::Grid {
                    source: source.clone(),
                    cols,
                    rows,
                    cell_size: *cell_size,
                    gap: *gap,
                    cell: self.node(cell, fixed),
                    cell_slot: *cell_slot,
                    value_slot: *value_slot,
                }
            }
            NodeKind::Repeat { source, item_slot, index_slot, key, node } => TKind::Repeat {
                source: source.clone(),
                item_slot: *item_slot,
                index_slot: *index_slot,
                key: key.clone(),
                node: self.node(node, fixed),
            },
            NodeKind::Rect { w, h, radius } => TKind::Rect {
                w: self.req(w, at, "w", 0.0),
                h: self.req(h, at, "h", 0.0),
                radius: self.opt(radius, at, "radius"),
            },
            NodeKind::Circle { r } => TKind::Circle { r: self.req(r, at, "r", 0.0) },
            NodeKind::Text { text, size, font, weight, color, w, h, align, valign, wrap } => TKind::Text {
                text: self.req(text, at, "text", Rc::from("")),
                size: self.req(size, at, "size", 16.0),
                font: self.opt(font, at, "font"),
                weight: self.opt(weight, at, "weight"),
                color: self.opt(color, at, "color"),
                w: self.opt(w, at, "w"),
                h: self.opt(h, at, "h"),
                align: *align,
                valign: *valign,
                wrap: *wrap,
            },
            NodeKind::Image { asset, w, h, frame, flip_x, flip_y, src_x, src_y, src_w, src_h } => {
                let any_src = src_x.is_some() || src_y.is_some() || src_w.is_some() || src_h.is_some();
                let src = any_src.then(|| {
                    Box::new([
                        self.opt(src_x, at, "src_x"),
                        self.opt(src_y, at, "src_y"),
                        self.opt(src_w, at, "src_w"),
                        self.opt(src_h, at, "src_h"),
                    ])
                });
                TKind::Image {
                    asset: self.asset(asset, at, true),
                    w: self.opt(w, at, "w"),
                    h: self.opt(h, at, "h"),
                    frame: self.opt(frame, at, "frame"),
                    flip_x: self.opt(flip_x, at, "flip_x"),
                    flip_y: self.opt(flip_y, at, "flip_y"),
                    src,
                }
            }
            NodeKind::Line { x1, y1, x2, y2 } => TKind::Line {
                x1: self.req(x1, at, "x1", 0.0),
                y1: self.req(y1, at, "y1", 0.0),
                x2: self.req(x2, at, "x2", 0.0),
                y2: self.req(y2, at, "y2", 0.0),
            },
            NodeKind::Poly { points, closed, hit_shape } => {
                let mut points = self.req(points, at, "points", Points(Rc::from(Vec::new())));
                if let P::C(Points(pts)) = &mut points {
                    if pts.len() > MAX_POLY_POINTS {
                        self.diags.push(Diagnostic::new(
                            Code::Limit,
                            format!("{at}/points"),
                            format!("{} points; only the first {MAX_POLY_POINTS} are drawn", pts.len()),
                        ));
                        *pts = Rc::from(&pts[..MAX_POLY_POINTS]);
                    }
                }
                TKind::Poly { points, closed: *closed, hit_shape: *hit_shape }
            }
        };
        let mut animate_on = Vec::with_capacity(n.animate_on.len());
        for (i, a) in n.animate_on.iter().enumerate() {
            if let Some(t) = self.anim(a, at, i) {
                animate_on.push(t);
            }
        }
        let trans_mask = n.transitions.iter().fold(0, |m, t| m | prop_bit(t.prop));
        let anim_mask = animate_on.iter().fold(0, |m, a| m | prop_bit(a.prop));
        let t = &mut self.nodes[id as usize];
        t.kind = kind;
        t.x = x;
        t.y = y;
        t.rotation = rotation;
        t.scale = scale;
        t.opacity = opacity;
        t.visible = visible;
        t.fill = fill;
        t.stroke = stroke;
        t.stroke_width = stroke_width;
        t.animate_on = animate_on;
        t.trans_mask = trans_mask;
        t.anim_mask = anim_mask;
        id
    }

    fn anim(&mut self, a: &AnimateOn, at: &str, i: usize) -> Option<TAnim> {
        let mut keys = Vec::with_capacity(a.keys.len());
        for k in &a.keys {
            let pv = if a.prop.is_color() {
                k.as_str().and_then(parse_color).map(PV::C)
            } else {
                k.as_f64().map(PV::N)
            };
            match pv {
                Some(pv) => keys.push(pv),
                None => {
                    self.diags.push(Diagnostic::new(
                        Code::Presentation,
                        format!("{at}/animate_on/{i}/keys"),
                        format!("bad keyframe `{k}` for `{:?}`", a.prop),
                    ));
                    return None;
                }
            }
        }
        if keys.is_empty() {
            return None;
        }
        Some(TAnim { on: a.on, when: a.when.clone(), prop: a.prop, keys, ms: a.ms.max(0.0), ease: a.ease })
    }
}

impl Template {
    pub fn compile(program: &Program, diags: &mut Vec<Diagnostic>) -> Template {
        let p: &Presentation = &program.presentation;
        let mut asset_ids = HashMap::with_capacity(program.assets.len());
        for (i, a) in program.assets.iter().enumerate() {
            asset_ids.entry(a.name.clone()).or_insert(i as AssetId);
        }
        let mut c = Compiler { program, asset_ids: &asset_ids, nodes: Vec::new(), diags };
        let background = c.prop(&p.canvas.background, "/presentation/canvas", "background");
        let camera = p.camera.as_ref().map(|cam| {
            (c.req(&cam.x, "/presentation/camera", "x", 0.0), c.req(&cam.y, "/presentation/camera", "y", 0.0))
        });
        let music = p.music.as_ref().map(|m| TMusic {
            asset: c.asset(&m.asset, "/presentation/music", false),
            volume: c.req(&m.volume, "/presentation/music", "volume", 0.6),
            playing: c.opt(&m.playing, "/presentation/music", "playing"),
        });
        c.node(&p.root, false);
        let nodes = c.nodes;
        let any_fixed = nodes.iter().any(|n| n.fixed);
        let mut anim_events = Vec::new();
        let mut max_anim_ms: f64 = 0.0;
        for n in &nodes {
            for a in &n.animate_on {
                if !anim_events.contains(&a.on) {
                    anim_events.push(a.on);
                }
                max_anim_ms = max_anim_ms.max(a.ms);
            }
        }
        let uses_now = presentation_uses_now(program, &nodes, camera.as_ref(), music.as_ref());
        Template {
            canvas_w: p.canvas.w,
            canvas_h: p.canvas.h,
            background,
            nodes,
            feedback: p.feedback.clone(),
            n_locals: p.n_locals,
            pointer_slot: p.pointer_slot,
            anim_events,
            max_anim_ms,
            uses_now,
            asset_ids,
            camera,
            music,
            any_fixed,
        }
    }
}

// ── `now` detection ─────────────────────────────────────────────────────────
// Bindings are only re-evaluated when something they can read changed. State
// and phase are compared directly; `now` only matters if an expression (or a
// function it calls) reads it.

fn presentation_uses_now(
    program: &Program,
    nodes: &[TNode],
    camera: Option<&(P<f64>, P<f64>)>,
    music: Option<&TMusic>,
) -> bool {
    let mut w = NowWalker { program, visited: vec![false; program.functions.len()] };
    let mut any = false;
    let mut check = |e: &Expr| any |= w.expr(e);
    fn p<T>(o: &Option<P<T>>, f: &mut dyn FnMut(&Expr)) {
        if let Some(P::E(e)) = o {
            f(e)
        }
    }
    for n in nodes {
        for o in [&n.x, &n.y, &n.rotation, &n.scale, &n.opacity, &n.stroke_width] {
            p(o, &mut check);
        }
        p(&n.visible, &mut check);
        p(&n.fill, &mut check);
        p(&n.stroke, &mut check);
        match &n.kind {
            TKind::Group { w, h, .. } => {
                p(w, &mut check);
                p(h, &mut check);
            }
            TKind::Stack { .. } => {}
            TKind::Grid { source, cols, rows, .. } => {
                if let Some(s) = source {
                    check(s);
                }
                p(cols, &mut check);
                p(rows, &mut check);
            }
            TKind::Repeat { source, key, .. } => {
                check(source);
                if let Some(k) = key {
                    check(k);
                }
            }
            TKind::Rect { w, h, radius } => {
                p(&Some(w.clone()), &mut check);
                p(&Some(h.clone()), &mut check);
                p(radius, &mut check);
            }
            TKind::Circle { r } => p(&Some(r.clone()), &mut check),
            TKind::Text { text, size, font, weight, color, w, h, .. } => {
                if let P::E(e) = text {
                    check(e);
                }
                if let P::E(e) = size {
                    check(e);
                }
                p(font, &mut check);
                p(weight, &mut check);
                p(color, &mut check);
                p(w, &mut check);
                p(h, &mut check);
            }
            TKind::Image { asset, w, h, frame, flip_x, flip_y, src } => {
                if let AssetRef::Expr(e) = asset {
                    check(e);
                }
                if let Some(src) = src {
                    for q in src.iter() {
                        p(q, &mut check);
                    }
                }
                p(w, &mut check);
                p(h, &mut check);
                p(frame, &mut check);
                p(flip_x, &mut check);
                p(flip_y, &mut check);
            }
            TKind::Line { x1, y1, x2, y2 } => {
                for q in [x1, y1, x2, y2] {
                    if let P::E(e) = q {
                        check(e);
                    }
                }
            }
            TKind::Poly { points, .. } => {
                if let P::E(e) = points {
                    check(e);
                }
            }
        }
    }
    if let Some((x, y)) = camera {
        for q in [x, y] {
            if let P::E(e) = q {
                check(e);
            }
        }
    }
    if let Some(m) = music {
        if let AssetRef::Expr(e) = &m.asset {
            check(e);
        }
        if let P::E(e) = &m.volume {
            check(e);
        }
        p(&m.playing, &mut check);
    }
    if let Prop::Expr(e) = &program.presentation.canvas.background {
        any |= w.expr(e);
    }
    any
}

struct NowWalker<'a> {
    program: &'a Program,
    visited: Vec<bool>,
}

impl NowWalker<'_> {
    fn all(&mut self, es: &[Expr]) -> bool {
        es.iter().any(|e| self.expr(e))
    }
    fn expr(&mut self, e: &Expr) -> bool {
        match e {
            Expr::Now => true,
            Expr::Const(_) | Expr::Local(_) | Expr::State(_) | Expr::Event(_) | Expr::Status => false,
            Expr::Field(a, _) | Expr::VecComponent(a, _) | Expr::Unary(_, a) | Expr::ToFloat(a) => self.expr(a),
            Expr::Index(a, b) | Expr::Binary(_, a, b) | Expr::Let(_, a, b) => self.expr(a) || self.expr(b),
            Expr::If(a, b, c) => self.expr(a) || self.expr(b) || self.expr(c),
            Expr::Call(f, args) => {
                if self.all(args) {
                    return true;
                }
                let i = *f as usize;
                match self.visited.get(i) {
                    Some(false) => {
                        self.visited[i] = true;
                        let body = &self.program.functions[i].body;
                        self.expr(body)
                    }
                    // Already checked (and found false) or out of range.
                    _ => false,
                }
            }
            Expr::Builtin(_, args) | Expr::List(args) | Expr::Record(args) => self.all(args),
            Expr::Lambda { body, .. } => self.expr(body),
            Expr::RecordUpdate(b, fields) => self.expr(b) || fields.iter().any(|(_, e)| self.expr(e)),
        }
    }
}
