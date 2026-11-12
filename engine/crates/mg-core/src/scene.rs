//! Presentation IR (spec A12): the scene tree with props resolved to constants
//! or IR expressions. Tokens (`$name`, `$list[i]`) are folded into constants
//! by `mg-lang`, so the scene never looks a token up at runtime.
//!
//! All presentation expressions share one frame of `Presentation::n_locals`
//! slots. Node-local variables (`cell`, `value`, a repeat's `as` name and
//! `index`, `pointer`) are pre-assigned slots in that frame and written by
//! `mg-scene` before it evaluates the node's props.

use std::rc::Rc;

use crate::ir::{EventId, Expr, InputId, Slot};
use crate::value::Value;

#[derive(Clone, Debug)]
pub struct Presentation {
    pub canvas: Canvas,
    pub root: Node,
    pub feedback: Vec<Feedback>,
    pub n_locals: u16,
    /// Slot holding `pointer` (`vec2`, canvas units) while an `on_drag` /
    /// `on_tap` `with` expression is evaluated.
    pub pointer_slot: Slot,
    /// v0.2: top-left of the view in world units. `None` = (0, 0).
    pub camera: Option<Camera>,
    /// v0.2: looping background music.
    pub music: Option<Music>,
}

#[derive(Clone, Debug)]
pub struct Camera {
    pub x: Prop,
    pub y: Prop,
}

#[derive(Clone, Debug)]
pub struct Music {
    /// Asset name (`Value::Str`), literal or expression.
    pub asset: Prop,
    pub volume: Prop,
    /// `None` = playing while `status == 'playing'`.
    pub playing: Option<Prop>,
}

#[derive(Clone, Debug)]
pub struct Canvas {
    pub w: f64,
    pub h: f64,
    /// A color string (`Value::Str`) constant or expression.
    pub background: Prop,
}

/// A property value: a literal (already folded, tokens resolved) or an
/// expression bound to state (written with a leading `=` in the file).
#[derive(Clone, Debug)]
pub enum Prop {
    Const(Value),
    Expr(Expr),
}

/// Animatable / transitionable numeric or color props.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PropName {
    X,
    Y,
    W,
    H,
    R,
    Radius,
    Rotation,
    Scale,
    Opacity,
    Fill,
    Stroke,
    StrokeWidth,
    Color,
    Size,
}

impl PropName {
    pub fn from_name(s: &str) -> Option<PropName> {
        Some(match s {
            "x" => PropName::X,
            "y" => PropName::Y,
            "w" => PropName::W,
            "h" => PropName::H,
            "r" => PropName::R,
            "radius" => PropName::Radius,
            "rotation" => PropName::Rotation,
            "scale" => PropName::Scale,
            "opacity" => PropName::Opacity,
            "fill" => PropName::Fill,
            "stroke" => PropName::Stroke,
            "stroke_width" => PropName::StrokeWidth,
            "color" => PropName::Color,
            "size" => PropName::Size,
            _ => return None,
        })
    }
    pub fn is_color(self) -> bool {
        matches!(self, PropName::Fill | PropName::Stroke | PropName::Color)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Anchor {
    #[default]
    TopLeft,
    Center,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Dir {
    Row,
    #[default]
    Column,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Align {
    Start,
    #[default]
    Center,
    End,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum TextAlign {
    Left,
    #[default]
    Center,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum TextValign {
    Top,
    #[default]
    Middle,
    Bottom,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Ease {
    Linear,
    In,
    #[default]
    Out,
    InOut,
    /// Overshoot then settle (back-out).
    Spring,
}

impl Ease {
    pub fn from_name(s: &str) -> Option<Ease> {
        Some(match s {
            "linear" => Ease::Linear,
            "in" | "ease_in" => Ease::In,
            "out" | "ease_out" => Ease::Out,
            "in_out" | "ease_in_out" => Ease::InOut,
            "spring" | "elastic" | "back" => Ease::Spring,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug)]
pub struct Node {
    pub kind: NodeKind,
    /// JSON Pointer to the node, for diagnostics.
    pub at: Rc<str>,
    pub id: Option<Rc<str>>,
    pub x: Option<Prop>,
    pub y: Option<Prop>,
    pub anchor: Anchor,
    pub rotation: Option<Prop>,
    pub scale: Option<Prop>,
    pub opacity: Option<Prop>,
    pub visible: Option<Prop>,
    pub fill: Option<Prop>,
    pub stroke: Option<Prop>,
    pub stroke_width: Option<Prop>,
    pub on_tap: Option<InputBinding>,
    pub on_drag: Option<InputBinding>,
    /// v0.2.1: sent on pointer down over the node.
    pub on_press: Option<InputBinding>,
    /// v0.2.1: sent when the pointer that pressed the node comes up
    /// (anywhere), or when a restart cancels the press.
    pub on_release: Option<InputBinding>,
    pub transitions: Vec<Transition>,
    pub animate_on: Vec<AnimateOn>,
    /// v0.2: ignores the camera (HUD). Inherited by the subtree.
    pub fixed: bool,
}

#[derive(Clone, Debug)]
pub enum NodeKind {
    /// Children positioned freely relative to the group's origin.
    Group { children: Vec<Node> },
    /// Children laid out in a row or column. Size comes from the children.
    Stack { dir: Dir, gap: f64, align: Align, children: Vec<Node> },
    /// `source` (a grid-valued expression; `value` is bound) or `cols`/`rows`.
    /// Size = `cols*cell_size + (cols-1)*gap` by `rows*cell_size + (rows-1)*gap`.
    /// The cell template's origin is the cell's top-left.
    Grid {
        source: Option<Expr>,
        cols: Option<Prop>,
        rows: Option<Prop>,
        cell_size: f64,
        gap: f64,
        cell: Box<Node>,
        cell_slot: Slot,
        /// Present iff `source` is.
        value_slot: Option<Slot>,
    },
    /// One instance of `node` per item of the list `source`.
    Repeat {
        source: Expr,
        item_slot: Slot,
        index_slot: Slot,
        /// Stable identity used to carry tweens/animations across frames.
        /// Defaults to the index.
        key: Option<Expr>,
        node: Box<Node>,
    },
    Rect { w: Prop, h: Prop, radius: Option<Prop> },
    /// Positioned by its center.
    Circle { r: Prop },
    Text {
        text: Prop,
        size: Prop,
        font: Option<Prop>,
        weight: Option<Prop>,
        color: Option<Prop>,
        /// Optional box. Without one, the box is measured from the text.
        w: Option<Prop>,
        h: Option<Prop>,
        align: TextAlign,
        valign: TextValign,
        /// v0.2.1: break lines at spaces to fit the box width `w`.
        wrap: bool,
    },
    /// v0.2. `asset` is an asset name (`Value::Str`). `w`/`h` default to the
    /// asset's frame size. `frame` defaults to animating at the asset's `fps`
    /// on the presentation clock.
    Image {
        asset: Prop,
        w: Option<Prop>,
        h: Option<Prop>,
        frame: Option<Prop>,
        flip_x: Option<Prop>,
        flip_y: Option<Prop>,
    },
    /// v0.2. Ends relative to the node's origin. Uses `stroke`/`stroke_width`.
    Line { x1: Prop, y1: Prop, x2: Prop, y2: Prop },
    /// v0.2. `points`: `list<vec2|ivec2>` relative to the node's origin.
    Poly { points: Prop, closed: bool },
}

/// `on_tap` / `on_drag` / `on_press` / `on_release`: which input to send and how to build its payload.
#[derive(Clone, Debug)]
pub struct InputBinding {
    pub input: InputId,
    /// One expression per declared payload field (excluding `t`), in payload
    /// order. Can read node locals and `pointer`.
    pub with: Vec<Expr>,
}

#[derive(Clone, Debug)]
pub struct Transition {
    pub prop: PropName,
    pub ms: f64,
    pub ease: Ease,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EventRef {
    Input(InputId),
    Event(EventId),
    Win,
    Lose,
}

/// Keyframe animation fired by an event: `keys` are values of `prop` spread
/// evenly over `ms`. For color props the keys are colors (`Value::Str`).
#[derive(Clone, Debug)]
pub struct AnimateOn {
    pub on: EventRef,
    /// Evaluated per node instance with the event's payload as `event`.
    pub when: Option<Expr>,
    pub prop: PropName,
    pub keys: Vec<Value>,
    pub ms: f64,
    pub ease: Ease,
}

#[derive(Clone, Debug)]
pub struct Feedback {
    pub on: EventRef,
    /// v0.2.1: pure guard with `event` and state in scope; the actions run
    /// only when it is true.
    pub when: Option<Expr>,
    pub actions: Vec<FeedbackAction>,
}

#[derive(Clone, Debug)]
pub enum FeedbackAction {
    Sound(SoundAction),
    Toast { text: Prop, ms: Prop },
    Shake { px: Prop, ms: Prop },
    /// v0.2. See SPEC-v0.2 §7.
    Particles(ParticlesAction),
    /// v0.2. `light | medium | heavy | success | warning | error` (`Value::Str`).
    Haptic(Prop),
}

/// SPEC-v0.2 §6. `asset` set → sample; `notes` set → jingle; else a synth note.
/// Defaults are filled in by mg-lang, so every non-`Option` prop is present.
#[derive(Clone, Debug)]
pub struct SoundAction {
    /// Sample: a `sound` asset name.
    pub asset: Option<Prop>,
    /// `sine | square | triangle | sawtooth`.
    pub wave: Prop,
    /// `C5`, `F#4`, `Bb3` or a number in Hz.
    pub note: Prop,
    /// Jingle: a list of notes.
    pub notes: Option<Prop>,
    pub step_ms: Prop,
    /// Glide target note.
    pub slide: Option<Prop>,
    pub ms: Prop,
    pub volume: Prop,
    pub rate: Prop,
}

#[derive(Clone, Debug)]
pub struct ParticlesAction {
    pub x: Prop,
    pub y: Prop,
    pub count: Prop,
    pub color: Prop,
    pub speed: Prop,
    pub size: Prop,
    pub ms: Prop,
    pub gravity: Prop,
    /// Degrees, centered on up.
    pub spread: Prop,
}
