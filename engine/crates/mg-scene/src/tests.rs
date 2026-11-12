//! Unit tests on hand-built presentations. They drive `Scene` directly with
//! constant state, so they don't need a running `Game`. Expressions used here
//! are limited to the fast-path ones (`Const`, `Local`, `State`).

use std::rc::Rc;

use mg_core::frame::{DrawOp, Wave};
use mg_core::ir::{Dispatch, Expr, Meta, Objectives, Outcome, Program};
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
        transitions: Vec::new(),
        animate_on: Vec::new(),
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
        },
    })
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
    let group = node(NodeKind::Group { children: vec![at(rect(44.0, 44.0), -8.0, -8.0), rect(28.0, 28.0)] });
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
    let mut group = node(NodeKind::Group { children: vec![hidden, stroked, child] });
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
    let mut s = Scene::new(program(node(NodeKind::Group { children: vec![g, cover] }), Vec::new(), 4));
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
    let mut group = node(NodeKind::Group { children: vec![rect(30.0, 30.0), child] });
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
            on: EventRef::Input(0),
            actions: vec![
                FeedbackAction::Sound { wave: cs("square"), note: cs("A4"), ms: c(60.0) },
                FeedbackAction::Toast { text: Prop::Expr(Expr::Const(Value::str("hi"))), ms: c(1500.0) },
            ],
        },
        Feedback { on: EventRef::Lose, actions: vec![FeedbackAction::Shake { px: c(8.0), ms: c(100.0) }] },
        Feedback {
            on: EventRef::Win,
            actions: vec![FeedbackAction::Sound { wave: cs("kazoo"), note: Prop::Const(Value::Int(220)), ms: c(10.0) }],
        },
    ];
    let mut s = Scene::new(program(rect(1.0, 1.0), fb, 2));
    s.on_fired(&[fired(EventRef::Input(0), vec![]), fired(EventRef::Input(0), vec![])], view(&[]));
    s.finish_frame();
    assert_eq!(s.frame.audio.len(), 2);
    assert_eq!(s.frame.audio[0].wave, Wave::Square);
    assert!((s.frame.audio[0].freq_hz - 440.0).abs() < 1e-9);
    assert_eq!(s.frame.audio[0].ms, 60.0);
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
    assert_eq!(s.frame.audio[0].wave, Wave::Sine);
    assert_eq!(s.frame.audio[0].freq_hz, 220.0);
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
