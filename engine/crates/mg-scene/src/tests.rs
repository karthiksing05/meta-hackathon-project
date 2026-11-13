//! Unit tests on hand-built presentations. They drive `Scene` directly with
//! constant state, so they don't need a running `Game`. Expressions used here
//! are limited to the fast-path ones (`Const`, `Local`, `State`).

use std::rc::Rc;

use mg_core::frame::{DrawOp, SoundKind, Wave};
use mg_core::ir::{Asset, Dispatch, Expr, Meta, Objectives, Outcome, Program};
use mg_core::limits::MAX_RENDER_OPS;
use mg_core::scene::*;
use mg_core::Value;
use mg_runtime::{Fired, Phase};

use crate::build::{Scene, View};

fn c(v: f64) -> Prop {
    Prop::Const(Value::Float(v))
}
fn cs(s: &str) -> Prop {
    Prop::Const(Value::str(s))
}

fn node(kind: NodeKind) -> Node {
    Node {
        kind,
        at: Rc::from("/presentation/root"),
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
    }
}

fn rect(w: f64, h: f64) -> Node {
    node(NodeKind::Rect { w: c(w), h: c(h), radius: None })
}

fn at(mut n: Node, x: f64, y: f64) -> Node {
    n.x = Some(c(x));
    n.y = Some(c(y));
    n
}

fn program(root: Node, feedback: Vec<Feedback>, n_locals: u16) -> Rc<Program> {
    program_with(root, feedback, n_locals, Vec::new(), None, None)
}

fn program_with(
    root: Node,
    feedback: Vec<Feedback>,
    n_locals: u16,
    assets: Vec<Asset>,
    camera: Option<Camera>,
    music: Option<Music>,
) -> Rc<Program> {
    Rc::new(Program {
        meta: Meta { title: Rc::from("t"), instructions: Rc::from(""), duration_s: None, seed: None },
        state: Vec::new(),
        functions: Vec::new(),
        events: Vec::new(),
        inputs: Vec::new(),
        rules: Vec::new(),
        dispatch: Dispatch::default(),
        timer_names: Vec::new(),
        objectives: Objectives {
            win: None,
            lose: None,
            score: None,
            time_limit_ms: None,
            on_timeout: Outcome::Lose,
            n_locals: 0,
        },
        presentation: Presentation {
            canvas: Canvas { w: 360.0, h: 640.0, background: cs("#F4F1EA") },
            root,
            feedback,
            n_locals,
            pointer_slot: n_locals.saturating_sub(1),
            camera,
            music,
        },
        assets,
        physics: None,
        text_input: None,
    })
}

/// A synth sound action with mg-lang's defaults.
fn synth(wave: &str, note: Prop, ms: f64) -> FeedbackAction {
    FeedbackAction::Sound(SoundAction {
        asset: None,
        wave: cs(wave),
        note,
        notes: None,
        step_ms: c(80.0),
        slide: None,
        ms: c(ms),
        volume: c(0.6),
        rate: c(1.0),
    })
}

fn synth_of(s: &mg_core::frame::Sound) -> (Wave, &[f64], f64, Option<f64>) {
    match &s.kind {
        SoundKind::Synth { wave, freqs, step_ms, slide_to_hz } => (*wave, &freqs[..], *step_ms, *slide_to_hz),
        k => panic!("not a synth: {k:?}"),
    }
}

fn view(state: &[Value]) -> View<'_> {
    View { state, now_ms: 0, phase: Phase::Playing }
}

fn rects(s: &Scene) -> Vec<(f64, f64, f64, f64)> {
    s.frame
        .ops
        .iter()
        .filter_map(|o| match o {
            DrawOp::Rect(r) => Some((r.x, r.y, r.w, r.h)),
            _ => None,
        })
        .collect()
}

fn rect_op(s: &Scene, i: usize) -> &mg_core::frame::RectOp {
    match &s.frame.ops[i] {
        DrawOp::Rect(r) => r,
        o => panic!("not a rect: {o:?}"),
    }
}

fn built(root: Node) -> Scene {
    let mut s = Scene::new(program(root, Vec::new(), 4));
    s.build(view(&[]), 1);
    s
}

#[test]
fn stack_column_centered_with_anchor_center() {
    let mut root = node(NodeKind::Stack {
        dir: Dir::Column,
        gap: 10.0,
        align: Align::Center,
        children: vec![rect(100.0, 50.0), rect(200.0, 20.0)],
    });
    root.anchor = Anchor::Center;
    let root = at(root, 180.0, 320.0);
    let s = built(root);
    // Size 200 x 80, centered at (180, 320) → top-left (80, 280).
    assert_eq!(rects(&s), vec![(130.0, 280.0, 100.0, 50.0), (80.0, 340.0, 200.0, 20.0)]);
    assert!(s.diags.list.is_empty(), "{:?}", s.diags.list);
}

#[test]
fn stack_row_alignment_and_child_offsets() {
    for (align, ys) in [(Align::Start, [0.0, 0.0]), (Align::Center, [15.0, 0.0]), (Align::End, [30.0, 0.0])] {
        let root = node(NodeKind::Stack {
            dir: Dir::Row,
            gap: 5.0,
            align,
            children: vec![rect(10.0, 10.0), rect(20.0, 40.0)],
        });
        let s = built(root);
        assert_eq!(rects(&s), vec![(0.0, ys[0], 10.0, 10.0), (15.0, ys[1], 20.0, 40.0)], "{align:?}");
    }
    // A child's x/y is an offset from its slot.
    let root = node(NodeKind::Stack {
        dir: Dir::Column,
        gap: 0.0,
        align: Align::Start,
        children: vec![rect(10.0, 10.0), at(rect(10.0, 10.0), 3.0, 4.0)],
    });
    assert_eq!(rects(&built(root))[1], (3.0, 14.0, 10.0, 10.0));
}

#[test]
fn circle_is_a_2r_box_in_stacks_and_centered_freely() {
    let circle = |r: f64| node(NodeKind::Circle { r: c(r) });
    let root = node(NodeKind::Stack {
        dir: Dir::Row,
        gap: 0.0,
        align: Align::Center,
        children: vec![rect(10.0, 20.0), circle(5.0)],
    });
    let s = built(root);
    match &s.frame.ops[1] {
        DrawOp::Circle(ci) => assert_eq!((ci.x, ci.y, ci.r), (15.0, 10.0, 5.0)),
        o => panic!("{o:?}"),
    }
    let s = built(at(circle(7.0), 50.0, 60.0));
    match &s.frame.ops[0] {
        DrawOp::Circle(ci) => assert_eq!((ci.x, ci.y), (50.0, 60.0)),
        o => panic!("{o:?}"),
    }
}

#[test]
fn anchor_center_on_rect() {
    let mut r = at(rect(20.0, 10.0), 50.0, 50.0);
    r.anchor = Anchor::Center;
    assert_eq!(rects(&built(r)), vec![(40.0, 45.0, 20.0, 10.0)]);
}

fn grid(cols: f64, rows: f64, cell_size: f64, gap: f64, cell: Node) -> Node {
    node(NodeKind::Grid {
        source: None,
        cols: Some(c(cols)),
        rows: Some(c(rows)),
        cell_size,
        gap,
        cell: Box::new(cell),
        cell_slot: 0,
        value_slot: None,
    })
}

#[test]
fn grid_size_and_cell_positions_row_major() {
    let g = grid(3.0, 2.0, 10.0, 2.0, rect(10.0, 10.0));
    let root = node(NodeKind::Stack { dir: Dir::Column, gap: 0.0, align: Align::Center, children: vec![g, rect(50.0, 1.0)] });
    let s = built(root);
    let r = rects(&s);
    assert_eq!(r.len(), 7);
    // Grid is 3*10+2*2 = 34 wide, 2*10+1*2 = 22 tall; centered in the 50-wide stack.
    assert_eq!(r[0], (8.0, 0.0, 10.0, 10.0));
    assert_eq!(r[1], (20.0, 0.0, 10.0, 10.0));
    assert_eq!(r[5], (32.0, 12.0, 10.0, 10.0));
    assert_eq!(r[6], (0.0, 22.0, 50.0, 1.0));
}

#[test]
fn grid_from_source_binds_cell_and_value() {
    // Cell fill = value (a color string) via Expr::Local(value_slot).
    let mut cell = rect(5.0, 5.0);
    cell.fill = Some(Prop::Expr(Expr::Local(1)));
    let g = node(NodeKind::Grid {
        source: Some(Expr::State(0)),
        cols: None,
        rows: None,
        cell_size: 5.0,
        gap: 1.0,
        cell: Box::new(cell),
        cell_slot: 0,
        value_slot: Some(1),
    });
    let mut s = Scene::new(program(g, Vec::new(), 4));
    let st = [Value::grid(2, 1, vec![Value::str("#FF0000"), Value::str("#00FF00")])];
    s.build(view(&st), 1);
    assert_eq!(rect_op(&s, 0).fill, Some(0xFF00_00FF));
    assert_eq!(rect_op(&s, 1).fill, Some(0x00FF_00FF));
    assert_eq!(rect_op(&s, 1).x, 6.0);
}

#[test]
fn group_with_negative_child_in_stack() {
    // Number Merge's board: a group whose backdrop starts at (-8, -8).
    let group = node(NodeKind::group(vec![at(rect(44.0, 44.0), -8.0, -8.0), rect(28.0, 28.0)]));
    let root = node(NodeKind::Stack { dir: Dir::Column, gap: 0.0, align: Align::Center, children: vec![rect(100.0, 10.0), group] });
    let r = rects(&built(root));
    // Group bounds 44 wide → centered at x = 28; backdrop there, inner rect 8 further in.
    assert_eq!(r[1], (28.0, 10.0, 44.0, 44.0));
    assert_eq!(r[2], (36.0, 18.0, 28.0, 28.0));
}

#[test]
fn text_defaults_measurement_and_box() {
    let t = node(NodeKind::Text {
        text: cs("LIGHTS OUT"),
        size: c(40.0),
        font: None,
        weight: Some(c(700.0)),
        color: None,
        w: None,
        h: None,
        align: TextAlign::Center,
        valign: TextValign::Middle,
        wrap: false,
    });
    let mut t = t;
    t.anchor = Anchor::Center;
    let s = built(at(t, 180.0, 60.0));
    match &s.frame.ops[0] {
        DrawOp::Text(op) => {
            assert!((op.w - 252.0).abs() < 1e-9);
            assert_eq!(op.h, 50.0);
            assert!((op.x - 54.0).abs() < 1e-9);
            assert_eq!(op.y, 35.0);
            assert_eq!(op.color, 0x0000_00FF);
            assert_eq!(&*op.font, "Inter, system-ui, sans-serif");
            assert_eq!(op.weight, 700);
        }
        o => panic!("{o:?}"),
    }
    let boxed = node(NodeKind::Text {
        text: Prop::Const(Value::Int(128)),
        size: c(28.0),
        font: None,
        weight: None,
        color: Some(cs("#3D3566")),
        w: Some(c(76.0)),
        h: Some(c(76.0)),
        align: TextAlign::Center,
        valign: TextValign::Middle,
        wrap: false,
    });
    match &built(boxed).frame.ops[0] {
        DrawOp::Text(op) => {
            assert_eq!((op.w, op.h, op.weight, op.size), (76.0, 76.0, 400, 28.0));
            assert_eq!(&*op.text, "128");
            assert_eq!(op.color, 0x3D35_66FF);
        }
        o => panic!("{o:?}"),
    }
}

#[test]
fn defaults_visibility_and_opacity() {
    let mut hidden = rect(5.0, 5.0);
    hidden.visible = Some(Prop::Const(Value::Bool(false)));
    let mut stroked = rect(5.0, 5.0);
    stroked.stroke = Some(cs("#fff"));
    let mut child = rect(5.0, 5.0);
    child.opacity = Some(c(0.5));
    let mut group = node(NodeKind::group(vec![hidden, stroked, child]));
    group.opacity = Some(c(0.5));
    let s = built(group);
    assert_eq!(s.frame.ops.len(), 2);
    let a = rect_op(&s, 0);
    assert_eq!((a.fill, a.stroke, a.stroke_width, a.opacity), (None, Some(0xFFFF_FFFF), 1.0, 0.5));
    let b = rect_op(&s, 1);
    assert_eq!((b.fill, b.opacity, b.scale, b.rotation), (Some(0x0000_00FF), 0.25, 1.0, 0.0));
    assert_eq!(s.frame.background, 0xF4F1_EAFF);
}

#[test]
fn hidden_child_takes_no_space_in_stack() {
    let mut hidden = rect(50.0, 50.0);
    hidden.visible = Some(Prop::Const(Value::Bool(false)));
    let root = node(NodeKind::Stack { dir: Dir::Column, gap: 10.0, align: Align::Start, children: vec![hidden, rect(5.0, 5.0)] });
    assert_eq!(rects(&built(root)), vec![(0.0, 0.0, 5.0, 5.0)]);
}

fn tap(input: u16, with: Vec<Expr>) -> Option<InputBinding> {
    Some(InputBinding { input, with })
}

#[test]
fn hit_targets_topmost_wins_and_with_uses_saved_locals() {
    let mut cell = rect(10.0, 10.0);
    cell.on_tap = tap(0, vec![Expr::Local(0), Expr::Local(3)]);
    let g = grid(2.0, 2.0, 10.0, 0.0, cell);
    // An overlapping rect painted later covers cell (1, 1).
    let mut cover = at(rect(10.0, 10.0), 10.0, 10.0);
    cover.on_tap = tap(1, vec![]);
    let mut s = Scene::new(program(node(NodeKind::group(vec![g, cover])), Vec::new(), 4));
    s.build(view(&[]), 1);
    assert_eq!(s.hits.len(), 5);
    let h = s.hit_at(15.0, 5.0).unwrap().clone();
    assert_eq!((h.x, h.y, h.w, h.h), (10.0, 0.0, 10.0, 10.0));
    let saved = s.saved[h.saved.0 as usize..h.saved.1 as usize].to_vec();
    let tpl = s.tpl.clone();
    let b = tpl.nodes[h.node as usize].on_tap.as_ref().unwrap();
    let payload = s.eval_binding(h.node, b, &saved, 15.0, 5.0, view(&[])).unwrap();
    assert_eq!(payload, vec![Value::IVec2(1, 0), Value::Vec2(15.0, 5.0)]);
    // Topmost: the cover, not cell (1, 1).
    let top = s.hit_at(15.0, 15.0).unwrap();
    assert_eq!(tpl.nodes[top.node as usize].on_tap.as_ref().unwrap().input, 1);
    assert!(s.hit_at(25.0, 5.0).is_none());
}

#[test]
fn container_target_is_below_child_targets() {
    let mut child = rect(10.0, 10.0);
    child.on_tap = tap(1, vec![]);
    let mut group = node(NodeKind::group(vec![rect(30.0, 30.0), child]));
    group.on_drag = tap(0, vec![]);
    let s = built(group);
    let tpl = s.tpl.clone();
    assert_eq!(s.hits.len(), 2);
    assert_eq!(tpl.nodes[s.hit_at(5.0, 5.0).unwrap().node as usize].on_tap.as_ref().unwrap().input, 1);
    assert!(tpl.nodes[s.hit_at(20.0, 20.0).unwrap().node as usize].on_drag.is_some());
    assert_eq!(s.hit_at(20.0, 20.0).unwrap().w, 30.0);
}

#[test]
fn fill_transition_tweens_and_first_appearance_does_not() {
    let mut r = rect(10.0, 10.0);
    r.fill = Some(Prop::Expr(Expr::State(0)));
    r.transitions = vec![Transition { prop: PropName::Fill, ms: 100.0, ease: Ease::Linear }];
    let mut s = Scene::new(program(r, Vec::new(), 2));
    let black = [Value::str("#000000")];
    let white = [Value::str("#FFFFFF")];
    s.build(view(&black), 1);
    assert_eq!(rect_op(&s, 0).fill, Some(0x0000_00FF));
    assert!(!s.needs_build(view(&black), 1));
    // Equal state under a new version (e.g. time moved): still cached.
    assert!(!s.needs_build(view(&black), 2));
    assert!(s.needs_build(view(&white), 3));
    s.build(view(&white), 3);
    assert_eq!(rect_op(&s, 0).fill, Some(0x0000_00FF));
    s.advance(50.0);
    assert!(s.needs_build(view(&white), 3));
    s.build(view(&white), 3);
    assert_eq!(rect_op(&s, 0).fill, Some(0x8080_80FF));
    s.advance(60.0);
    s.build(view(&white), 3);
    assert_eq!(rect_op(&s, 0).fill, Some(0xFFFF_FFFF));
    // Finished: one more advance doesn't require a rebuild.
    s.advance(16.0);
    assert!(!s.needs_build(view(&white), 3));
}

fn fired(on: EventRef, payload: Vec<Value>) -> Fired {
    Fired { on, payload: Rc::from(payload) }
}

#[test]
fn animate_on_keyframes_override_while_running() {
    let mut r = rect(10.0, 10.0);
    r.animate_on = vec![
        AnimateOn {
            on: EventRef::Input(0),
            when: None,
            prop: PropName::Scale,
            keys: vec![Value::Float(1.0), Value::Float(2.0), Value::Float(1.0)],
            ms: 100.0,
            ease: Ease::Linear,
        },
        AnimateOn {
            on: EventRef::Input(1),
            when: Some(Expr::Const(Value::Bool(false))),
            prop: PropName::Fill,
            keys: vec![Value::str("#fff"), Value::str("#000")],
            ms: 100.0,
            ease: Ease::Linear,
        },
    ];
    let mut s = Scene::new(program(r, Vec::new(), 2));
    s.build(view(&[]), 1);
    assert_eq!(rect_op(&s, 0).scale, 1.0);
    // Events from two steps accumulate before the next build.
    s.on_fired(&[fired(EventRef::Input(1), vec![Value::Int(0)])], view(&[]));
    s.advance(10.0);
    s.on_fired(&[fired(EventRef::Input(0), vec![Value::Int(10)])], view(&[]));
    assert!(s.needs_build(view(&[]), 1));
    s.advance(25.0);
    s.build(view(&[]), 1);
    // Fired at clock 10, now 35 → p = 0.25 → 1.5.
    assert!((rect_op(&s, 0).scale - 1.5).abs() < 1e-9);
    assert_eq!(rect_op(&s, 0).fill, Some(0x0000_00FF), "`when` false: no fill animation");
    s.advance(25.0);
    assert!(s.needs_build(view(&[]), 1));
    s.build(view(&[]), 1);
    assert!((rect_op(&s, 0).scale - 2.0).abs() < 1e-9);
    s.advance(100.0);
    s.build(view(&[]), 1);
    assert_eq!(rect_op(&s, 0).scale, 1.0);
    s.advance(16.0);
    assert!(!s.needs_build(view(&[]), 1));
}

#[test]
fn animate_on_is_per_instance_in_grids() {
    let mut cell = rect(10.0, 10.0);
    cell.animate_on = vec![AnimateOn {
        on: EventRef::Event(0),
        when: Some(Expr::Local(1)), // value (bool)
        prop: PropName::Opacity,
        keys: vec![Value::Float(0.0), Value::Float(0.0)],
        ms: 50.0,
        ease: Ease::Linear,
    }];
    let g = node(NodeKind::Grid {
        source: Some(Expr::State(0)),
        cols: None,
        rows: None,
        cell_size: 10.0,
        gap: 0.0,
        cell: Box::new(cell),
        cell_slot: 0,
        value_slot: Some(1),
    });
    let mut s = Scene::new(program(g, Vec::new(), 3));
    let st = [Value::grid(3, 1, vec![Value::Bool(false), Value::Bool(true), Value::Bool(false)])];
    s.build(view(&st), 1);
    s.on_fired(&[fired(EventRef::Event(0), vec![])], view(&st));
    s.build(view(&st), 1);
    let op: Vec<f64> = (0..3).map(|i| rect_op(&s, i).opacity).collect();
    assert_eq!(op, vec![1.0, 0.0, 1.0]);
}

#[test]
fn feedback_queues_and_drains_per_frame() {
    let fb = vec![
        Feedback {
            when: None,
            on: EventRef::Input(0),
            actions: vec![
                synth("square", cs("A4"), 60.0),
                FeedbackAction::Toast { text: Prop::Expr(Expr::Const(Value::str("hi"))), ms: c(1500.0) },
            ],
        },
        Feedback { when: None, on: EventRef::Lose, actions: vec![FeedbackAction::Shake { px: c(8.0), ms: c(100.0) }] },
        Feedback {
            when: None,
            on: EventRef::Win,
            actions: vec![synth("kazoo", Prop::Const(Value::Int(220)), 10.0)],
        },
    ];
    let mut s = Scene::new(program(rect(1.0, 1.0), fb, 2));
    s.on_fired(&[fired(EventRef::Input(0), vec![]), fired(EventRef::Input(0), vec![])], view(&[]));
    s.finish_frame();
    assert_eq!(s.frame.audio.len(), 2);
    let (wave, freqs, step, slide) = synth_of(&s.frame.audio[0]);
    assert_eq!((wave, freqs, step, slide), (Wave::Square, &[440.0][..], 60.0, None));
    assert_eq!((s.frame.audio[0].ms, s.frame.audio[0].volume), (60.0, 0.6));
    assert_eq!(s.frame.toasts.len(), 2);
    assert_eq!(&*s.frame.toasts[0].text, "hi");
    s.finish_frame();
    assert!(s.frame.audio.is_empty() && s.frame.toasts.is_empty());

    s.on_fired(&[fired(EventRef::Lose, vec![])], view(&[]));
    s.finish_frame();
    assert_eq!(s.frame.shake_px, 8.0);
    s.advance(50.0);
    s.finish_frame();
    assert!((s.frame.shake_px - 4.0).abs() < 1e-9);
    s.advance(60.0);
    s.finish_frame();
    assert_eq!(s.frame.shake_px, 0.0);

    // Bad wave name: falls back to sine, reports once.
    s.on_fired(&[fired(EventRef::Win, vec![]), fired(EventRef::Win, vec![])], view(&[]));
    s.finish_frame();
    assert_eq!(s.frame.audio.len(), 2);
    let (wave, freqs, _, _) = synth_of(&s.frame.audio[0]);
    assert_eq!((wave, freqs), (Wave::Sine, &[220.0][..]));
    assert_eq!(s.diags.list.len(), 1, "{:?}", s.diags.list);
}

#[test]
fn eval_errors_fall_back_and_report_once() {
    // State 5 doesn't exist → error on every build, one diagnostic.
    let mut r = rect(10.0, 10.0);
    r.fill = Some(Prop::Expr(Expr::State(5)));
    r.x = Some(Prop::Expr(Expr::Local(0))); // None → not a number
    let mut s = Scene::new(program(r, Vec::new(), 2));
    s.build(view(&[]), 1);
    s.build(view(&[]), 2);
    assert_eq!(s.frame.ops.len(), 1);
    assert_eq!(rect_op(&s, 0).fill, None);
    assert_eq!(rect_op(&s, 0).x, 0.0);
    assert_eq!(s.diags.list.len(), 2, "{:?}", s.diags.list);
    assert_eq!(s.diags.list[0].at, "/presentation/root/x");
    // Bad constant color is a load-time diagnostic.
    let mut bad = rect(1.0, 1.0);
    bad.fill = Some(cs("#zz"));
    let s = Scene::new(program(bad, Vec::new(), 1));
    assert_eq!(s.diags.list.len(), 1);
}

#[test]
fn render_ops_are_capped() {
    let s = built(grid(50.0, 50.0, 1.0, 0.0, rect(1.0, 1.0)));
    assert_eq!(s.frame.ops.len(), MAX_RENDER_OPS);
    assert_eq!(s.diags.list.len(), 1);
}

#[test]
fn repeat_instances_keyed_for_tweens() {
    // Each item is a color; key = the item; x = index (tweened).
    let mut r = rect(10.0, 10.0);
    r.fill = Some(Prop::Expr(Expr::Local(0)));
    r.x = Some(Prop::Expr(Expr::Local(1)));
    r.transitions = vec![Transition { prop: PropName::X, ms: 100.0, ease: Ease::Linear }];
    let rep = node(NodeKind::Repeat {
        source: Expr::State(0),
        item_slot: 0,
        index_slot: 1,
        key: Some(Expr::Local(0)),
        node: Box::new(r),
    });
    let mut s = Scene::new(program(rep, Vec::new(), 4));
    let a = [Value::list(vec![Value::str("#f00"), Value::str("#0f0")])];
    s.build(view(&a), 1);
    assert_eq!(rects(&s).iter().map(|r| r.0).collect::<Vec<_>>(), vec![0.0, 1.0]);
    // Swap order: keyed instances tween from their old x.
    let b = [Value::list(vec![Value::str("#0f0"), Value::str("#f00")])];
    s.advance(10.0);
    s.build(view(&b), 2);
    assert_eq!(rect_op(&s, 0).fill, Some(0x00FF_00FF));
    assert_eq!(rect_op(&s, 0).x, 1.0, "green starts where it was");
    s.advance(50.0);
    s.build(view(&b), 2);
    assert!((rect_op(&s, 0).x - 0.5).abs() < 1e-9);
    assert!((rect_op(&s, 1).x - 0.5).abs() < 1e-9);
}

// ── v0.2 ────────────────────────────────────────────────────────────────────

use mg_core::frame::Haptic;
use mg_core::ir::{AssetKind, AssetSrc};
use mg_core::limits::{MAX_PARTICLES, MAX_PARTICLES_PER_BURST, MAX_POLY_POINTS};
use mg_core::Code;

fn image_asset(name: &str, w: f64, h: f64, frames: u16, fps: f64) -> Asset {
    Asset {
        name: Rc::from(name),
        kind: AssetKind::Image { src: AssetSrc::Svg(Rc::from("<svg/>")), w, h, frames, cols: frames, fps },
    }
}

fn sound_asset(name: &str) -> Asset {
    Asset { name: Rc::from(name), kind: AssetKind::Sound { src: AssetSrc::Url(Rc::from("https://x/y.wav")) } }
}

/// hero (image 32x24, 6 frames at 10 fps) = 0, flap (sound) = 1, theme (sound) = 2.
fn assets() -> Vec<Asset> {
    vec![image_asset("hero", 32.0, 24.0, 6, 10.0), sound_asset("flap"), sound_asset("theme")]
}

fn image(asset: &str) -> Node {
    node(NodeKind::Image { asset: cs(asset), w: None, h: None, frame: None, flip_x: None, flip_y: None, src_x: None, src_y: None, src_w: None, src_h: None })
}

fn scene_with(root: Node, feedback: Vec<Feedback>, camera: Option<Camera>, music: Option<Music>) -> Scene {
    Scene::new(program_with(root, feedback, 4, assets(), camera, music))
}

fn image_op(s: &Scene, i: usize) -> &mg_core::frame::ImageOp {
    match &s.frame.ops[i] {
        DrawOp::Image(r) => r,
        o => panic!("not an image: {o:?}"),
    }
}

#[test]
fn image_resolves_asset_defaults_size_and_animates_frames() {
    let mut s = scene_with(at(image("hero"), 10.0, 20.0), Vec::new(), None, None);
    s.build(view(&[]), 1);
    let op = image_op(&s, 0).clone();
    assert_eq!((op.x, op.y, op.w, op.h, op.asset, op.frame), (10.0, 20.0, 32.0, 24.0, 0, 0));
    assert_eq!((op.flip_x, op.flip_y, op.rotation, op.scale, op.opacity), (false, false, 0.0, 1.0, 1.0));
    // 10 fps: frame = floor(clock / 100) % 6 on the presentation clock.
    s.advance(50.0);
    assert!(!s.needs_build(view(&[]), 1), "same frame: cached");
    s.advance(100.0);
    assert!(s.needs_build(view(&[]), 1));
    s.build(view(&[]), 1);
    assert_eq!(image_op(&s, 0).frame, 1);
    s.advance(460.0); // 610 → frame 6 % 6 = 0
    s.build(view(&[]), 1);
    assert_eq!(image_op(&s, 0).frame, 0);
    assert!(s.diags.list.is_empty(), "{:?}", s.diags.list);

    // Explicit frame (modulo frames), size, flips.
    for (f, want) in [(7.0, 1), (-1.0, 5), (2.9, 2)] {
        let mut n = image("hero");
        if let NodeKind::Image { frame, w, flip_x, .. } = &mut n.kind {
            *frame = Some(c(f));
            *w = Some(c(64.0));
            *flip_x = Some(Prop::Const(Value::Bool(true)));
        }
        let mut s = scene_with(n, Vec::new(), None, None);
        s.build(view(&[]), 1);
        let op = image_op(&s, 0);
        assert_eq!((op.frame, op.w, op.h, op.flip_x), (want, 64.0, 24.0, true), "frame {f}");
        s.advance(1000.0);
        assert!(!s.needs_build(view(&[]), 1), "explicit frame doesn't animate");
    }
}

#[test]
fn image_unknown_or_sound_asset_is_skipped_with_a_diagnostic() {
    let root = node(NodeKind::group(vec![image("nope"), image("flap"), image("hero")]));
    let mut s = scene_with(root, Vec::new(), None, None);
    s.build(view(&[]), 1);
    assert_eq!(s.frame.ops.len(), 1);
    assert_eq!(s.diags.list.len(), 2, "{:?}", s.diags.list);
    assert!(s.diags.list.iter().all(|d| d.code == Code::Asset));
    // A computed name resolves each build.
    let mut n = image("x");
    if let NodeKind::Image { asset, .. } = &mut n.kind {
        *asset = Prop::Expr(Expr::State(0));
    }
    let mut s = scene_with(n, Vec::new(), None, None);
    s.build(view(&[Value::str("hero")]), 1);
    assert_eq!(image_op(&s, 0).asset, 0);
    s.build(view(&[Value::str("theme")]), 2);
    assert!(s.frame.ops.is_empty());
    assert_eq!(s.diags.list.len(), 1, "{:?}", s.diags.list);
}

#[test]
fn image_box_in_stack_and_w_transition() {
    let mut img = image("hero");
    if let NodeKind::Image { w, .. } = &mut img.kind {
        *w = Some(Prop::Expr(Expr::State(0)));
    }
    img.transitions = vec![Transition { prop: PropName::W, ms: 100.0, ease: Ease::Linear }];
    let root = node(NodeKind::Stack { dir: Dir::Row, gap: 4.0, align: Align::Center, children: vec![img, rect(10.0, 40.0)] });
    let mut s = scene_with(root, Vec::new(), None, None);
    s.build(view(&[Value::Float(32.0)]), 1);
    let op = image_op(&s, 0);
    assert_eq!((op.x, op.y, op.w, op.h), (0.0, 8.0, 32.0, 24.0));
    assert_eq!(rect_op(&s, 1).x, 36.0);
    s.build(view(&[Value::Float(64.0)]), 2);
    s.advance(50.0);
    s.build(view(&[Value::Float(64.0)]), 2);
    assert_eq!(image_op(&s, 0).w, 48.0);
    assert_eq!(rect_op(&s, 1).x, 52.0);
}

fn line(x1: f64, y1: f64, x2: f64, y2: f64) -> Node {
    node(NodeKind::Line { x1: c(x1), y1: c(y1), x2: c(x2), y2: c(y2) })
}

fn vec2s(pts: &[(f64, f64)]) -> Prop {
    Prop::Const(Value::list(pts.iter().map(|&(x, y)| Value::Vec2(x, y)).collect()))
}

#[test]
fn line_defaults_and_box() {
    let s = built(at(line(-10.0, 0.0, 10.0, 5.0), 100.0, 100.0));
    match &s.frame.ops[0] {
        DrawOp::Line(l) => {
            assert_eq!((l.x1, l.y1, l.x2, l.y2), (90.0, 100.0, 110.0, 105.0));
            assert_eq!((l.stroke, l.stroke_width, l.opacity), (0x0000_00FF, 2.0, 1.0));
        }
        o => panic!("{o:?}"),
    }
    // In a column stack the box (-10,0)-(10,5) goes to the slot.
    let mut l = line(-10.0, 0.0, 10.0, 5.0);
    l.stroke = Some(cs("#f00"));
    l.stroke_width = Some(c(3.0));
    let root = node(NodeKind::Stack { dir: Dir::Column, gap: 0.0, align: Align::Start, children: vec![rect(10.0, 10.0), l, rect(1.0, 1.0)] });
    let s = built(root);
    match &s.frame.ops[1] {
        DrawOp::Line(l) => assert_eq!((l.x1, l.y1, l.x2, l.y2, l.stroke, l.stroke_width), (0.0, 10.0, 20.0, 15.0, 0xFF00_00FF, 3.0)),
        o => panic!("{o:?}"),
    }
    assert_eq!(rect_op(&s, 2).y, 15.0);
}

#[test]
fn poly_points_box_paint_and_cap() {
    let mut p = node(NodeKind::Poly { points: vec2s(&[(0.0, 0.0), (10.0, 0.0), (5.0, -8.0)]), closed: true, hit_shape: false });
    p.anchor = Anchor::Center;
    let s = built(at(p, 50.0, 50.0));
    match &s.frame.ops[0] {
        DrawOp::Poly(op) => {
            // Box (0,-8)-(10,0), centered on (50, 50).
            assert_eq!(op.points, vec![(45.0, 54.0), (55.0, 54.0), (50.0, 46.0)]);
            assert_eq!((op.closed, op.fill, op.stroke, op.stroke_width), (true, Some(0x0000_00FF), None, 0.0));
        }
        o => panic!("{o:?}"),
    }
    // ivec2 points from state, open, stroked.
    let mut p = node(NodeKind::Poly { points: Prop::Expr(Expr::State(0)), closed: false, hit_shape: false });
    p.stroke = Some(cs("#fff"));
    let mut s = Scene::new(program(p, Vec::new(), 2));
    s.build(view(&[Value::list(vec![Value::IVec2(1, 2), Value::IVec2(3, 4)])]), 1);
    match &s.frame.ops[0] {
        DrawOp::Poly(op) => assert_eq!((&op.points[..], op.closed, op.fill, op.stroke_width), (&[(1.0, 2.0), (3.0, 4.0)][..], false, None, 1.0)),
        o => panic!("{o:?}"),
    }
    // Too many points: capped, one diagnostic.
    let many: Vec<(f64, f64)> = (0..300).map(|i| (i as f64, 0.0)).collect();
    let s = built(node(NodeKind::Poly { points: vec2s(&many), closed: true, hit_shape: false }));
    match &s.frame.ops[0] {
        DrawOp::Poly(op) => assert_eq!(op.points.len(), MAX_POLY_POINTS),
        o => panic!("{o:?}"),
    }
    assert_eq!(s.diags.list.len(), 1);
    assert_eq!(s.diags.list[0].code, Code::Limit);
}

fn camera_x_from_state() -> Option<Camera> {
    Some(Camera { x: Prop::Expr(Expr::State(0)), y: c(10.0) })
}

/// HUD group (fixed) first in tree order, then a world rect.
fn hud_scene() -> Scene {
    let mut hud_btn = rect(40.0, 40.0);
    hud_btn.on_tap = tap(1, vec![Expr::Local(3)]);
    let mut hud = node(NodeKind::group(vec![hud_btn]));
    hud.fixed = true;
    let mut world = at(rect(50.0, 50.0), 160.0, 10.0);
    world.on_tap = tap(0, vec![Expr::Local(3)]);
    let root = node(NodeKind::group(vec![hud, world]));
    scene_with(root, Vec::new(), camera_x_from_state(), None)
}

#[test]
fn camera_shifts_world_nodes_and_fixed_hud_stays_on_top() {
    let mut s = hud_scene();
    s.build(view(&[Value::Float(150.0)]), 1);
    assert_eq!(s.camera, (150.0, 10.0));
    // World op first (shifted), HUD last (unshifted) despite tree order.
    assert_eq!(rects(&s), vec![(10.0, 0.0, 50.0, 50.0), (0.0, 0.0, 40.0, 40.0)]);
    // Hits are in canvas coordinates; the fixed one is on top.
    assert_eq!(s.hits.len(), 2);
    assert!(!s.hits[0].fixed && s.hits[1].fixed);
    assert_eq!((s.hits[0].x, s.hits[0].y), (10.0, 0.0));
    let tpl = s.tpl.clone();
    let input = |s: &Scene, x, y| s.hit_at(x, y).map(|h| tpl.nodes[h.node as usize].on_tap.as_ref().unwrap().input);
    assert_eq!(input(&s, 20.0, 20.0), Some(1), "overlap: HUD wins");
    assert_eq!(input(&s, 50.0, 45.0), Some(0));
    assert_eq!(input(&s, 70.0, 20.0), None);
    // The camera is a binding: a state change moves it, equal state stays cached.
    assert!(!s.needs_build(view(&[Value::Float(150.0)]), 2));
    assert!(s.needs_build(view(&[Value::Float(0.0)]), 3));
    s.build(view(&[Value::Float(0.0)]), 3);
    assert_eq!(rects(&s), vec![(160.0, 0.0, 50.0, 50.0), (0.0, 0.0, 40.0, 40.0)]);
    assert_eq!(input(&s, 170.0, 5.0), Some(0));
    assert!(s.diags.list.is_empty(), "{:?}", s.diags.list);
}

#[test]
fn fixed_is_inherited_by_the_subtree_in_stacks_and_repeats() {
    let mut inner = rect(5.0, 5.0);
    inner.fixed = false; // can't opt back in to the camera
    let rep = node(NodeKind::Repeat {
        source: Expr::Const(Value::list(vec![Value::Int(0), Value::Int(1)])),
        item_slot: 0,
        index_slot: 1,
        key: None,
        node: Box::new(inner),
    });
    let mut hud = node(NodeKind::Stack { dir: Dir::Row, gap: 1.0, align: Align::Start, children: vec![rep, rect(2.0, 2.0)] });
    hud.fixed = true;
    let root = node(NodeKind::group(vec![hud, at(rect(1.0, 1.0), 100.0, 100.0)]));
    let mut s = scene_with(root, Vec::new(), Some(Camera { x: c(50.0), y: c(50.0) }), None);
    s.build(view(&[]), 1);
    assert_eq!(rects(&s), vec![(50.0, 50.0, 1.0, 1.0), (0.0, 0.0, 5.0, 5.0), (0.0, 0.0, 5.0, 5.0), (6.0, 0.0, 2.0, 2.0)]);
}

fn particles_fb(count: f64, spread: f64, gravity: f64) -> Vec<Feedback> {
    vec![Feedback {
        when: None,
        on: EventRef::Input(0),
        actions: vec![FeedbackAction::Particles(ParticlesAction {
            x: c(100.0),
            y: c(200.0),
            count: c(count),
            color: cs("#FFD166"),
            speed: c(100.0),
            size: c(4.0),
            ms: c(500.0),
            gravity: c(gravity),
            spread: c(spread),
        })],
    }]
}

fn circles(s: &Scene) -> Vec<mg_core::frame::CircleOp> {
    s.frame.ops.iter().filter_map(|o| if let DrawOp::Circle(c) = o { Some(c.clone()) } else { None }).collect()
}

#[test]
fn particles_burst_fly_fade_and_expire() {
    let mut hud = rect(10.0, 10.0);
    hud.fixed = true;
    let root = node(NodeKind::group(vec![hud, rect(5.0, 5.0)]));
    let cam = Some(Camera { x: c(50.0), y: c(0.0) });
    let mut s = scene_with(root, particles_fb(16.0, 360.0, 0.0), cam, None);
    s.build(view(&[]), 1);
    s.on_fired(&[fired(EventRef::Input(0), vec![])], view(&[]));
    assert_eq!(s.particle_count(), 16);
    assert!(s.needs_build(view(&[]), 1), "new particles");
    s.build(view(&[]), 1);
    // World rect, 16 particles, then the fixed rect.
    assert_eq!(s.frame.ops.len(), 18);
    assert!(matches!(s.frame.ops[0], DrawOp::Rect(_)) && matches!(s.frame.ops[17], DrawOp::Rect(_)));
    let p0 = circles(&s);
    assert!(p0.iter().all(|p| (p.x, p.y, p.r, p.opacity, p.fill) == (50.0, 200.0, 2.0, 1.0, Some(0xFFD1_66FF))));
    s.advance(250.0);
    assert!(s.needs_build(view(&[]), 1));
    s.build(view(&[]), 1);
    let p1 = circles(&s);
    assert_eq!(p1.len(), 16);
    let mut angles = Vec::new();
    for p in &p1 {
        assert!((p.opacity - 0.5).abs() < 1e-9);
        let d = ((p.x - 50.0).powi(2) + (p.y - 200.0).powi(2)).sqrt();
        assert!((12.5 - 1e-9..=25.0 + 1e-9).contains(&d), "distance {d}");
        angles.push((p.y - 200.0).atan2(p.x - 50.0));
    }
    // Spread 360: not all in one direction.
    assert!(angles.iter().any(|a| *a > 0.5) && angles.iter().any(|a| *a < -0.5), "{angles:?}");
    s.advance(250.0);
    assert_eq!(s.particle_count(), 0);
    assert!(s.needs_build(view(&[]), 1), "one more build clears them");
    s.build(view(&[]), 1);
    assert!(circles(&s).is_empty());
    s.advance(16.0);
    assert!(!s.needs_build(view(&[]), 1), "cached again");
}

#[test]
fn particles_spread_centered_on_up_with_gravity() {
    let mut s = scene_with(rect(1.0, 1.0), particles_fb(8.0, 0.0, 600.0), None, None);
    s.on_fired(&[fired(EventRef::Input(0), vec![])], view(&[]));
    s.advance(100.0);
    s.build(view(&[]), 1);
    for p in circles(&s) {
        assert!((p.x - 100.0).abs() < 1e-9, "spread 0: straight up");
        // y = 200 - v t + g t² / 2 with v in [50, 100], t = 0.1 s.
        let v = (200.0 + 3.0 - p.y) / 0.1;
        assert!((50.0 - 1e-6..=100.0 + 1e-6).contains(&v), "v {v}");
    }
}

#[test]
fn particles_are_deterministic_per_event_and_capped() {
    let run = |events: usize| {
        let mut s = scene_with(rect(1.0, 1.0), particles_fb(12.0, 360.0, 300.0), None, None);
        for _ in 0..events {
            s.on_fired(&[fired(EventRef::Input(0), vec![])], view(&[]));
        }
        s.advance(120.0);
        s.build(view(&[]), 1);
        circles(&s)
    };
    let a = run(1);
    assert_eq!(a, run(1), "same event sequence, same burst");
    let b = run(2);
    assert_eq!(b.len(), 24);
    assert_eq!(&b[..12], &a[..], "first burst unchanged");
    assert_ne!(&b[12..], &a[..], "second burst differs");
    // Restart resets the sequence.
    let mut s = scene_with(rect(1.0, 1.0), particles_fb(12.0, 360.0, 300.0), None, None);
    s.on_fired(&[fired(EventRef::Input(0), vec![])], view(&[]));
    s.reset();
    s.on_fired(&[fired(EventRef::Input(0), vec![])], view(&[]));
    s.advance(120.0);
    s.build(view(&[]), 1);
    assert_eq!(circles(&s), a);
    // Caps: per burst and alive at once.
    let mut s = scene_with(rect(1.0, 1.0), particles_fb(1000.0, 360.0, 0.0), None, None);
    s.on_fired(&[fired(EventRef::Input(0), vec![])], view(&[]));
    assert_eq!(s.particle_count(), MAX_PARTICLES_PER_BURST);
    for _ in 0..10 {
        s.on_fired(&[fired(EventRef::Input(0), vec![])], view(&[]));
    }
    assert_eq!(s.particle_count(), MAX_PARTICLES);
}

fn sound(f: impl FnOnce(&mut SoundAction)) -> FeedbackAction {
    let FeedbackAction::Sound(mut a) = synth("square", cs("C5"), 90.0) else { unreachable!() };
    f(&mut a);
    FeedbackAction::Sound(a)
}

#[test]
fn sound_forms_sample_jingle_slide() {
    let fb = vec![Feedback {
        when: None,
        on: EventRef::Input(0),
        actions: vec![
            sound(|a| {
                a.asset = Some(cs("flap"));
                a.rate = c(2.0);
                a.volume = c(1.5);
            }),
            sound(|a| {
                a.notes = Some(Prop::Const(Value::list(vec![Value::str("C5"), Value::str("E5"), Value::Int(880)])));
                a.step_ms = c(70.0);
                a.wave = cs("triangle");
            }),
            sound(|a| a.slide = Some(cs("C6"))),
            sound(|a| a.asset = Some(cs("hero"))), // an image: skipped
            sound(|a| a.volume = c(-1.0)),
        ],
    }];
    let mut s = scene_with(rect(1.0, 1.0), fb, None, None);
    s.on_fired(&[fired(EventRef::Input(0), vec![])], view(&[]));
    s.finish_frame();
    let a = &s.frame.audio;
    assert_eq!(a.len(), 4);
    assert_eq!(a[0].kind, SoundKind::Sample { asset: 1, rate: 2.0 });
    assert_eq!(a[0].volume, 1.0);
    let (wave, freqs, step, slide) = synth_of(&a[1]);
    assert_eq!((wave, freqs.len(), step, slide, a[1].ms), (Wave::Triangle, 3, 70.0, None, 210.0));
    assert!((freqs[0] - 523.2511).abs() < 1e-3 && (freqs[1] - 659.2551).abs() < 1e-3 && freqs[2] == 880.0);
    let (wave, freqs, step, slide) = synth_of(&a[2]);
    assert_eq!((wave, freqs.len(), step, a[2].ms), (Wave::Square, 1, 90.0, 90.0));
    assert!((slide.unwrap() - 1046.502).abs() < 1e-3);
    assert_eq!(a[3].volume, 0.0);
    assert_eq!(s.diags.list.len(), 1, "{:?}", s.diags.list);
    assert_eq!(s.diags.list[0].code, Code::Asset);
}

#[test]
fn haptics_drain_per_frame() {
    let fb = vec![Feedback {
        when: None,
        on: EventRef::Input(0),
        actions: vec![FeedbackAction::Haptic(cs("light")), FeedbackAction::Haptic(cs("buzz"))],
    }];
    let mut s = scene_with(rect(1.0, 1.0), fb, None, None);
    s.on_fired(&[fired(EventRef::Input(0), vec![]), fired(EventRef::Input(0), vec![])], view(&[]));
    s.finish_frame();
    assert_eq!(s.frame.haptics, vec![Haptic::Light, Haptic::Light]);
    s.finish_frame();
    assert!(s.frame.haptics.is_empty());
    assert_eq!(s.diags.list.len(), 1, "bad name reported once");
}

#[test]
fn music_state_follows_status_and_bindings() {
    let m = |playing: Option<Prop>, asset: &str| Some(Music { asset: cs(asset), volume: c(0.4), playing });
    let mut s = scene_with(rect(1.0, 1.0), Vec::new(), None, m(None, "theme"));
    s.build(view(&[]), 1);
    assert_eq!(s.frame.music, Some(mg_core::frame::MusicState { asset: 2, volume: 0.4, playing: true }));
    // Default `playing` is `status == 'playing'`; a phase change rebuilds.
    let won = View { state: &[], now_ms: 0, phase: Phase::Won };
    assert!(s.needs_build(won, 2));
    s.build(won, 2);
    assert!(!s.frame.music.as_ref().unwrap().playing);
    // Explicit binding.
    let mut s = scene_with(rect(1.0, 1.0), Vec::new(), None, m(Some(Prop::Expr(Expr::State(0))), "theme"));
    s.build(view(&[Value::Bool(false)]), 1);
    assert!(!s.frame.music.as_ref().unwrap().playing);
    s.build(view(&[Value::Bool(true)]), 2);
    assert!(s.frame.music.as_ref().unwrap().playing);
    // An image asset isn't music.
    let mut s = scene_with(rect(1.0, 1.0), Vec::new(), None, m(None, "hero"));
    s.build(view(&[]), 1);
    assert_eq!(s.frame.music, None);
    assert_eq!(s.diags.list.len(), 1);
    // No music section: none.
    assert_eq!(built(rect(1.0, 1.0)).frame.music, None);
}

// ── v0.2.2: clipping groups, image crops, shape hits ───────────────────────

use crate::build::point_in_poly;
use mg_core::frame::ClipOp;

fn clip_group(w: f64, h: f64, children: Vec<Node>) -> Node {
    node(NodeKind::Group { children, w: Some(c(w)), h: Some(c(h)), clip: true })
}

fn clip_of(op: &DrawOp) -> &ClipOp {
    match op {
        DrawOp::Clip(c) => c,
        o => panic!("not a clip: {o:?}"),
    }
}

#[test]
fn clip_group_wraps_child_ops_and_has_a_fixed_box() {
    let mut big = at(rect(200.0, 200.0), -20.0, -20.0);
    big.on_tap = tap(0, vec![]);
    let g = at(clip_group(100.0, 50.0, vec![big]), 10.0, 20.0);
    // In a row stack, the next child goes after the group's box (100 wide), not the child's (200).
    let root = node(NodeKind::Stack { dir: Dir::Row, gap: 0.0, align: Align::Start, children: vec![g, rect(5.0, 5.0)] });
    let s = built(root);
    assert_eq!(s.frame.ops.len(), 4);
    assert_eq!(clip_of(&s.frame.ops[0]), &ClipOp { x: 10.0, y: 20.0, w: 100.0, h: 50.0 });
    assert_eq!((rect_op(&s, 1).x, rect_op(&s, 1).y), (-10.0, 0.0));
    assert_eq!(s.frame.ops[2], DrawOp::Unclip);
    assert_eq!(rect_op(&s, 3).x, 100.0);
    // The child's hit box is cut to the group's box.
    assert_eq!(s.hits.len(), 1);
    let h = &s.hits[0];
    assert_eq!((h.x, h.y, h.w, h.h), (10.0, 20.0, 100.0, 50.0));
    assert!(s.hit_at(5.0, 5.0).is_none(), "drawn-over but clipped away");
    assert!(s.hit_at(150.0, 30.0).is_none());
    assert!(s.hit_at(50.0, 40.0).is_some());
    assert!(s.diags.list.is_empty(), "{:?}", s.diags.list);
}

#[test]
fn clip_drops_hidden_targets_and_empty_clips() {
    let mut inside = at(rect(10.0, 10.0), 5.0, 5.0);
    inside.on_tap = tap(0, vec![]);
    let mut outside = at(rect(10.0, 10.0), 60.0, 5.0);
    outside.on_tap = tap(1, vec![]);
    let s = built(clip_group(50.0, 50.0, vec![inside, outside]));
    assert_eq!(s.hits.len(), 1);
    assert!(s.hit_at(65.0, 10.0).is_none());
    let tpl = s.tpl.clone();
    assert_eq!(tpl.nodes[s.hit_at(8.0, 8.0).unwrap().node as usize].on_tap.as_ref().unwrap().input, 0);
    // A clip with nothing drawn inside emits no ops; a group target keeps its box.
    let mut hidden = rect(10.0, 10.0);
    hidden.visible = Some(Prop::Const(Value::Bool(false)));
    let mut g = at(clip_group(30.0, 40.0, vec![hidden]), 7.0, 0.0);
    g.on_tap = tap(2, vec![]);
    let s = built(g);
    assert!(s.frame.ops.is_empty(), "{:?}", s.frame.ops);
    assert_eq!((s.hits[0].x, s.hits[0].w, s.hits[0].h), (7.0, 30.0, 40.0));
    // A box without clip: no clip ops, children not cut.
    let mut child = at(rect(10.0, 10.0), 60.0, 0.0);
    child.on_tap = tap(0, vec![]);
    let s = built(node(NodeKind::Group { children: vec![child], w: Some(c(20.0)), h: Some(c(20.0)), clip: false }));
    assert_eq!(s.frame.ops.len(), 1);
    assert!(s.hit_at(65.0, 5.0).is_some());
}

#[test]
fn nested_clips_intersect_hits_and_follow_the_camera() {
    let mut r = at(rect(100.0, 100.0), 0.0, 0.0);
    r.on_tap = tap(0, vec![]);
    let inner = at(clip_group(40.0, 40.0, vec![r]), 30.0, 0.0);
    let outer = at(clip_group(50.0, 50.0, vec![inner]), 100.0, 100.0);
    let mut s = scene_with(outer, Vec::new(), camera_x_from_state(), None);
    s.build(view(&[Value::Float(20.0)]), 1);
    // Camera (20, 10) applied to every op.
    assert_eq!(clip_of(&s.frame.ops[0]), &ClipOp { x: 80.0, y: 90.0, w: 50.0, h: 50.0 });
    assert_eq!(clip_of(&s.frame.ops[1]), &ClipOp { x: 110.0, y: 90.0, w: 40.0, h: 40.0 });
    assert_eq!(s.frame.ops[3], DrawOp::Unclip);
    assert_eq!(s.frame.ops[4], DrawOp::Unclip);
    // Hit = rect ∩ inner ∩ outer = x 110..130, y 90..130 (screen).
    let h = &s.hits[0];
    assert_eq!((h.x, h.y, h.w, h.h), (110.0, 90.0, 20.0, 40.0));
    assert!(s.hit_at(135.0, 100.0).is_none());
    assert!(s.hit_at(120.0, 100.0).is_some());
}

#[test]
fn fixed_children_of_a_world_clip_are_not_clipped() {
    let mut hud = at(rect(20.0, 20.0), 200.0, 0.0);
    hud.fixed = true;
    hud.on_tap = tap(1, vec![]);
    let world = rect(100.0, 100.0);
    let mut s = scene_with(clip_group(50.0, 50.0, vec![world, hud]), Vec::new(), camera_x_from_state(), None);
    s.build(view(&[Value::Float(0.0)]), 1);
    // World layer: clip, rect, unclip; then the HUD rect, unclipped.
    assert!(matches!(s.frame.ops[0], DrawOp::Clip(_)));
    assert_eq!(s.frame.ops[2], DrawOp::Unclip);
    assert_eq!((rect_op(&s, 3).x, rect_op(&s, 3).y), (200.0, 0.0));
    assert!(s.hit_at(210.0, 10.0).is_some());
}

#[test]
fn clips_stay_balanced_at_the_op_cap() {
    let many: Vec<Node> = (0..MAX_RENDER_OPS + 50).map(|_| rect(1.0, 1.0)).collect();
    let inner = clip_group(10.0, 10.0, vec![clip_group(5.0, 5.0, many)]);
    let s = built(node(NodeKind::group(vec![rect(1.0, 1.0), inner, rect(2.0, 2.0)])));
    let ops = &s.frame.ops;
    assert!(ops.len() <= MAX_RENDER_OPS, "{}", ops.len());
    let clips = ops.iter().filter(|o| matches!(o, DrawOp::Clip(_))).count();
    let unclips = ops.iter().filter(|o| matches!(o, DrawOp::Unclip)).count();
    assert_eq!((clips, unclips), (2, 2));
    assert_eq!(ops[ops.len() - 1], DrawOp::Unclip);
    assert!(s.diags.list.iter().any(|d| d.code == Code::Limit));
}

#[test]
fn image_src_rect_defaults_and_errors() {
    let with_src = |sx: Option<Prop>, sy: Option<Prop>, sw: Option<Prop>, sh: Option<Prop>| {
        let mut n = image("hero");
        if let NodeKind::Image { src_x, src_y, src_w, src_h, w, h, .. } = &mut n.kind {
            (*src_x, *src_y, *src_w, *src_h) = (sx, sy, sw, sh);
            (*w, *h) = (Some(c(200.0)), Some(c(150.0)));
        }
        n
    };
    // No src props: no source rect in the op (old frames unchanged).
    let mut s = scene_with(image("hero"), Vec::new(), None, None);
    s.build(view(&[]), 1);
    assert_eq!(image_op(&s, 0).src, None);
    // Explicit crop of the 32x24 frame, stretched to the 200x150 box.
    let mut s = scene_with(with_src(Some(c(8.0)), Some(c(6.0)), Some(c(16.0)), Some(c(12.0))), Vec::new(), None, None);
    s.build(view(&[]), 1);
    let op = image_op(&s, 0);
    assert_eq!((op.w, op.h, op.src), (200.0, 150.0, Some([8.0, 6.0, 16.0, 12.0])));
    // Only src_x / src_y: the size defaults to the rest of the frame.
    let mut s = scene_with(with_src(Some(c(8.0)), Some(c(4.0)), None, None), Vec::new(), None, None);
    s.build(view(&[]), 1);
    assert_eq!(image_op(&s, 0).src, Some([8.0, 4.0, 24.0, 20.0]));
    // A bound size <= 0: nothing drawn, one diagnostic, the box still takes taps.
    let mut n = with_src(None, None, Some(Prop::Expr(Expr::State(0))), None);
    n.on_tap = tap(0, vec![]);
    let mut s = scene_with(n, Vec::new(), None, None);
    s.build(view(&[Value::Float(0.0)]), 1);
    assert!(s.frame.ops.is_empty());
    assert_eq!(s.diags.list.len(), 1, "{:?}", s.diags.list);
    assert!(s.diags.list[0].message.contains("`src_w` must be greater than 0"), "{}", s.diags.list[0].message);
    assert!(s.diags.list[0].at.ends_with("/src_w"));
    assert!(s.hit_at(100.0, 100.0).is_some());
    s.build(view(&[Value::Float(4.0)]), 2);
    assert_eq!(image_op(&s, 0).src, Some([0.0, 0.0, 4.0, 24.0]));
}

#[test]
fn point_in_poly_nonzero_winding() {
    let tri = [(0.0, 0.0), (20.0, 0.0), (10.0, 20.0)];
    assert!(point_in_poly(&tri, 10.0, 5.0));
    assert!(!point_in_poly(&tri, 2.0, 15.0), "inside the box, outside the triangle");
    assert!(!point_in_poly(&tri, 30.0, 5.0));
    // Either orientation.
    let rev = [(10.0, 20.0), (20.0, 0.0), (0.0, 0.0)];
    assert!(point_in_poly(&rev, 10.0, 5.0) && !point_in_poly(&rev, 2.0, 15.0));
    // A self-crossing star: nonzero fills the middle (even-odd would not).
    let star: Vec<(f64, f64)> = (0..5)
        .map(|i| {
            let a = (i as f64 * 144.0 - 90.0).to_radians();
            (50.0 + 40.0 * a.cos(), 50.0 + 40.0 * a.sin())
        })
        .collect();
    assert!(point_in_poly(&star, 50.0, 50.0));
    assert!(point_in_poly(&star, 50.0, 15.0), "a point of the star");
    assert!(!point_in_poly(&star, 20.0, 85.0), "between two points");
    // Fewer than 3 points have no inside.
    assert!(!point_in_poly(&[(0.0, 0.0), (10.0, 10.0)], 5.0, 5.0));
}

#[test]
fn poly_hit_shape_only_inside_the_polygon() {
    let tri = || vec2s(&[(0.0, 0.0), (20.0, 0.0), (10.0, 20.0)]);
    let mut shaped = node(NodeKind::Poly { points: tri(), closed: true, hit_shape: true });
    shaped.on_tap = tap(0, vec![]);
    let mut boxed = node(NodeKind::Poly { points: tri(), closed: true, hit_shape: false });
    boxed.on_tap = tap(1, vec![]);
    // Shaped poly placed by a stack (shifted) under a camera.
    let root = node(NodeKind::Stack {
        dir: Dir::Row,
        gap: 0.0,
        align: Align::Start,
        children: vec![rect(100.0, 1.0), shaped, at(boxed, 50.0, 0.0)],
    });
    let mut s = scene_with(at(root, 0.0, 10.0), Vec::new(), camera_x_from_state(), None);
    s.build(view(&[Value::Float(-5.0)]), 1);
    // Camera (-5, 10): the shaped triangle's origin is at screen (105, 0).
    let tpl = s.tpl.clone();
    let input = |h: Option<&crate::build::HitRec>| h.map(|h| tpl.nodes[h.node as usize].on_tap.as_ref().unwrap().input);
    assert_eq!(input(s.hit_at(115.0, 5.0)), Some(0), "inside");
    assert_eq!(input(s.hit_at(107.0, 15.0)), None, "in the box, outside the triangle");
    assert_eq!(input(s.hit_at(124.0, 1.0)), Some(0));
    // The box poly (origin at screen 175, 0) still hits its whole box.
    assert_eq!(input(s.hit_at(177.0, 15.0)), Some(1));
    // In a clip, a shape hit is the polygon ∩ the clip.
    let mut p = node(NodeKind::Poly { points: tri(), closed: true, hit_shape: true });
    p.on_tap = tap(0, vec![]);
    let s = built(clip_group(20.0, 8.0, vec![p]));
    assert!(s.hit_at(10.0, 5.0).is_some());
    assert!(s.hit_at(10.0, 12.0).is_none(), "inside the triangle but clipped");
    assert!(s.hit_at(1.0, 6.0).is_none(), "inside the clip but outside the triangle");
}
