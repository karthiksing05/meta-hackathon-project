//! v0.2 front-end tests (engine/SPEC-v0.2.md): assets, nodes, camera, input
//! sources, physics, audio, particles, haptics, builtins.

use mg_core::ir::{AssetKind, AssetSrc, BodyShape, ContactField, PointerPhase, SourceTrigger, TextPhase};
use mg_core::scene::{FeedbackAction, NodeKind, Prop};
use mg_core::value::Value;
use mg_core::{Code, Diagnostic, Program};
use serde_json::{json, Value as J};

use crate::{compile, validate};

fn show(d: &[Diagnostic]) -> String {
    d.iter()
        .map(|d| format!("{} {} {:?} {} | {:?}", d.code.as_str(), d.at, d.span, d.message, d.hint))
        .collect::<Vec<_>>()
        .join("\n")
}

fn find<'a>(d: &'a [Diagnostic], code: Code, at: &str) -> &'a Diagnostic {
    d.iter().find(|x| x.code == code && x.at == at).unwrap_or_else(|| panic!("no {} at {at} in:\n{}", code.as_str(), show(d)))
}

fn errors(d: &[Diagnostic]) -> Vec<&Diagnostic> {
    d.iter().filter(|d| d.is_error()).collect()
}

/// A small valid v0.2 game. Top-level keys of `extra` replace the defaults;
/// keys of `extra.presentation` are merged into the presentation.
fn game(extra: J) -> J {
    let mut g = json!({
        "format": "microgame/0.2",
        "meta": { "title": "T", "instructions": "" },
        "assets": {
            "bird": { "svg": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 34 24'></svg>", "w": 34, "h": 24 },
            "hero": { "image": "data:image/png;base64,AAAA", "w": 32, "h": 32, "frames": 6, "cols": 3, "fps": 10 },
            "flap": { "sound": "data:audio/wav;base64,AAAA" },
            "theme": { "sound": "https://example.com/loop.mp3" }
        },
        "state": { "score": { "type": "int", "init": "0" } },
        "events": { "ping": {} },
        "inputs": { "go": {} },
        "rules": [ { "on": "go", "do": [ { "incr": "score" } ] } ],
        "objectives": { "time_limit": "10s" },
        "presentation": {
            "canvas": { "w": 360, "h": 640, "background": "#000" },
            "root": { "node": "group", "children": [ { "node": "text", "text": "= str(score)" } ] }
        }
    });
    for (k, v) in extra.as_object().unwrap() {
        if k == "presentation" {
            for (pk, pv) in v.as_object().unwrap() {
                g["presentation"][pk] = pv.clone();
            }
        } else {
            g[k] = v.clone();
        }
    }
    g
}

fn compile_ok(g: &J) -> Program {
    match compile(&g.to_string()) {
        Ok(c) => c.program,
        Err(d) => panic!("{}", show(&d)),
    }
}

fn diags(g: &J) -> Vec<Diagnostic> {
    validate(&g.to_string())
}

fn root_children(p: &Program) -> &[mg_core::scene::Node] {
    let NodeKind::Group { children, .. } = &p.presentation.root.kind else { panic!() };
    children
}

fn cf(x: f64) -> Prop {
    Prop::Const(Value::Float(x))
}

fn is_const(p: &Prop, v: Value) -> bool {
    matches!(p, Prop::Const(x) if *x == v)
}

// ── Format ────────────────────────────────────────────────────────────

#[test]
fn both_formats_accepted() {
    compile_ok(&game(json!({})));
    compile_ok(&game(json!({ "format": "microgame/0.1" })));
    let d = diags(&game(json!({ "format": "microgame/0.3" })));
    let e = find(&d, Code::Format, "/format");
    assert!(e.message.contains("microgame/0.2"), "{}", e.message);
}

// ── Assets ────────────────────────────────────────────────────────────

#[test]
fn assets_lowering() {
    let p = compile_ok(&game(json!({})));
    let names: Vec<&str> = p.assets.iter().map(|a| &*a.name).collect();
    assert_eq!(names, ["bird", "hero", "flap", "theme"]);
    let AssetKind::Image { src: AssetSrc::Svg(svg), w, h, frames, cols, fps } = &p.assets[0].kind else { panic!() };
    assert!(svg.starts_with("<svg"));
    assert_eq!((*w, *h, *frames, *cols, *fps), (34.0, 24.0, 1, 1, 0.0));
    let AssetKind::Image { src: AssetSrc::Url(_), frames, cols, fps, .. } = &p.assets[1].kind else { panic!() };
    assert_eq!((*frames, *cols, *fps), (6, 3, 10.0));
    assert!(matches!(&p.assets[3].kind, AssetKind::Sound { src: AssetSrc::Url(u) } if u.starts_with("https://")));
    // cols defaults to frames.
    let mut g = game(json!({}));
    g["assets"]["hero"].as_object_mut().unwrap().remove("cols");
    let p = compile_ok(&g);
    assert!(matches!(&p.assets[1].kind, AssetKind::Image { frames: 6, cols: 6, .. }));
}

#[test]
fn asset_errors() {
    let mut g = game(json!({}));
    g["assets"] = json!({
        "a": { "svg": "<?xml version='1.0'?><svg></svg>", "w": 10, "h": 10 },
        "b": { "image": "http://example.com/x.png", "w": 10, "h": 10 },
        "c": { "image": "data:audio/wav;base64,AA", "w": 10, "h": 10 },
        "d": { "svg": "<svg></svg>", "w": 10 },
        "e": { "svg": "<svg></svg>", "sound": "https://x.com/a.mp3" },
        "f": { "sound": "https://x.com/a.mp3", "w": 3 },
        "g": { "svg": "<svg></svg>", "w": 10, "h": -1, "frames": 0, "fpz": 3 },
        "h": {},
        "flap": { "sound": "https://x.com/f.mp3" }
    });
    let d = diags(&g);
    find(&d, Code::Asset, "/assets/a/svg");
    let e = find(&d, Code::Asset, "/assets/b/image");
    assert!(e.hint.as_deref().unwrap().contains("https://"), "{e:?}");
    find(&d, Code::Asset, "/assets/c/image");
    let e = find(&d, Code::Asset, "/assets/d");
    assert_eq!(e.message, "image asset 'd' is missing 'h'");
    find(&d, Code::Asset, "/assets/e/sound");
    find(&d, Code::Asset, "/assets/f/w");
    find(&d, Code::Asset, "/assets/g/h");
    find(&d, Code::Asset, "/assets/g/frames");
    let e = find(&d, Code::Asset, "/assets/g/fpz");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'fps'?"));
    find(&d, Code::Asset, "/assets/h");
    assert!(errors(&d).iter().all(|x| x.code == Code::Asset), "{}", show(&d));

    // Too big.
    let mut g = game(json!({}));
    g["assets"]["bird"]["svg"] = J::String(format!("<svg>{}</svg>", "x".repeat(mg_core::limits::MAX_SVG_BYTES)));
    let d = diags(&g);
    let e = find(&d, Code::Asset, "/assets/bird/svg");
    assert!(e.message.contains("256 KB"), "{}", e.message);
}

#[test]
fn asset_references() {
    let g = game(json!({ "presentation": {
        "music": { "asset": "hero" },
        "root": { "node": "group", "children": [
            { "node": "image", "asset": "berd" },
            { "node": "image", "asset": "flap" },
            { "node": "image", "asset": "= if score > 0 then 'bird' else 'hero'" },
            { "node": "image", "asset": "= score" },
            { "node": "image", "asset": "= 'nope'" },
            { "node": "text", "text": "= str(score)" }
        ] },
        "feedback": [ { "on": "go", "do": [ { "sound": { "asset": "flep" } }, { "sound": { "asset": "bird" } } ] } ]
    } }));
    let d = diags(&g);
    let e = find(&d, Code::Asset, "/presentation/root/children/0/asset");
    assert_eq!(e.message, "unknown asset 'berd'");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'bird'?"));
    let e = find(&d, Code::Asset, "/presentation/root/children/1/asset");
    assert_eq!(e.message, "asset 'flap' is a sound, not an image");
    assert_eq!(e.hint.as_deref(), Some("image assets: bird, hero"));
    find(&d, Code::TypeMismatch, "/presentation/root/children/3/asset");
    find(&d, Code::Asset, "/presentation/root/children/4/asset");
    find(&d, Code::Asset, "/presentation/music/asset");
    let e = find(&d, Code::Asset, "/presentation/feedback/0/do/0/sound/asset");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'flap'?"));
    find(&d, Code::Asset, "/presentation/feedback/0/do/1/sound/asset");
    assert_eq!(errors(&d).len(), 7, "{}", show(&d));
}

// ── Nodes, camera, fixed ──────────────────────────────────────────────

#[test]
fn new_nodes_camera_and_fixed() {
    let g = game(json!({ "presentation": {
        "camera": { "x": "= max(0, score * 10 - 120)" },
        "music": { "asset": "theme", "volume": 0.4 },
        "root": { "node": "group", "children": [
            { "node": "image", "asset": "hero", "w": 64, "frame": "= score % 6", "flip_x": true },
            { "node": "line", "x2": 100, "y2": "= score * 2", "stroke": "#fff" },
            { "node": "poly", "points": [[0, 0], [20, 0], [10, 16.5]], "closed": false, "fill": "#f00" },
            { "node": "poly", "points": "= map(range(score + 3), i => vec(i, i * 2))" },
            { "node": "group", "fixed": true, "children": [
                { "node": "stack", "children": [ { "node": "text", "text": "= str(score)" } ] }
            ] }
        ] }
    } }));
    let p = compile_ok(&g);
    let cam = p.presentation.camera.as_ref().unwrap();
    assert!(matches!(cam.x, Prop::Expr(_)));
    assert!(matches!(cam.y, Prop::Const(Value::Float(y)) if y == 0.0));
    let music = p.presentation.music.as_ref().unwrap();
    assert!(is_const(&music.asset, Value::str("theme")) && is_const(&music.volume, Value::Float(0.4)) && music.playing.is_none());
    let c = root_children(&p);
    let NodeKind::Image { asset, w, h, frame, flip_x, flip_y, .. } = &c[0].kind else { panic!() };
    assert!(is_const(asset, Value::str("hero")) && h.is_none() && flip_y.is_none());
    assert!(matches!(w, Some(Prop::Const(Value::Float(64.0)))));
    assert!(matches!(frame, Some(Prop::Expr(_))) && matches!(flip_x, Some(Prop::Const(Value::Bool(true)))));
    let NodeKind::Line { x1, y2, .. } = &c[1].kind else { panic!() };
    assert!(is_const(x1, Value::Float(0.0)) && matches!(y2, Prop::Expr(_)));
    // Lines default to stroke_width 2.
    assert!(matches!(&c[1].stroke_width, Some(p) if matches!(p, Prop::Const(Value::Float(w)) if *w == 2.0)));
    let NodeKind::Poly { points, closed, .. } = &c[2].kind else { panic!() };
    assert!(!closed);
    assert!(is_const(points, Value::list(vec![Value::Vec2(0.0, 0.0), Value::Vec2(20.0, 0.0), Value::Vec2(10.0, 16.5)])));
    let NodeKind::Poly { points, closed, .. } = &c[3].kind else { panic!() };
    assert!(*closed && matches!(points, Prop::Expr(_)));
    // `fixed` is inherited by the whole subtree.
    assert!(!c[0].fixed && c[4].fixed);
    let NodeKind::Group { children, .. } = &c[4].kind else { panic!() };
    let NodeKind::Stack { children: sc, .. } = &children[0].kind else { panic!() };
    assert!(children[0].fixed && sc[0].fixed);
    let _ = cf(0.0);
}

#[test]
fn node_errors() {
    let many: Vec<J> = (0..300).map(|i| json!([i, 0])).collect();
    let g = game(json!({ "presentation": {
        "camera": { "x": "= 'a'", "z": 1 },
        "root": { "node": "group", "children": [
            { "node": "line", "x1": 0 },
            { "node": "poly", "points": [[0, 0], [1]] },
            { "node": "poly", "points": "= [1, 2]" },
            { "node": "poly", "points": many },
            { "node": "image" },
            { "node": "rect", "w": 1, "h": 1, "fixed": "yes" },
            { "node": "imag", "asset": "bird" },
            { "node": "image", "asset": "bird", "flipx": true },
            { "node": "poly", "points": "[vec(0, 0), vec(1, 1)]" }
        ] }
    } }));
    let d = diags(&g);
    find(&d, Code::TypeMismatch, "/presentation/camera/x");
    find(&d, Code::Presentation, "/presentation/camera/z");
    let e = find(&d, Code::Presentation, "/presentation/root/children/0");
    assert_eq!(e.message, "this node is missing 'x2'");
    find(&d, Code::Presentation, "/presentation/root/children/1/points/1");
    find(&d, Code::TypeMismatch, "/presentation/root/children/2/points");
    find(&d, Code::Limit, "/presentation/root/children/3/points");
    find(&d, Code::Presentation, "/presentation/root/children/4");
    find(&d, Code::Presentation, "/presentation/root/children/5/fixed");
    let e = find(&d, Code::Presentation, "/presentation/root/children/6/node");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'image'?"));
    let e = find(&d, Code::Presentation, "/presentation/root/children/7/flipx");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'flip_x'?"));
    // `points` strings are always expressions, with or without '='.
    assert!(!d.iter().any(|x| x.at.starts_with("/presentation/root/children/8")), "{}", show(&d));
}

// ── Input sources ─────────────────────────────────────────────────────

#[test]
fn input_sources() {
    let g = game(json!({
        "state": {
            "score": { "type": "int", "init": "0" },
            "word": { "type": "string", "init": "''" },
            "at": { "type": "vec2", "init": "vec(0.0, 0.0)" }
        },
        "inputs": {
            "go": {},
            "typed": { "payload": { "c": "string", "code": "string" }, "from": [
                { "key": "any", "with": { "c": "key.char", "code": "key.code" } },
                { "key": "Space", "on": "up", "with": { "c": "' '", "code": "key.code" } }
            ] },
            "aim": { "payload": { "p": "vec2" }, "from": [
                { "pointer": "down", "with": { "p": "vec(pointer.x, pointer.y)" } },
                { "pointer": "move", "with": { "p": "vec(pointer.x, pointer.y)" } },
                { "pointer": "up", "with": { "p": "vec(pointer.x, pointer.y)" } }
            ] },
            "guess": { "payload": { "w": "string" }, "from": [
                { "text": "submit", "placeholder": "Your guess", "max_len": 12, "with": { "w": "upper(trim(text.value))" } },
                { "text": "change", "with": { "w": "text.value" } }
            ] }
        },
        "rules": [
            { "on": "go", "do": [ { "incr": "score" } ] },
            { "on": "typed", "do": [ { "set": "word", "to": "word + event.c" } ] },
            { "on": "aim", "do": [ { "set": "at", "to": "event.p" } ] },
            { "on": "guess", "do": [ { "set": "word", "to": "event.w" } ] }
        ],
        "presentation": {
            "text_field": { "x": 20, "y": 560, "w": 320, "h": 44, "size": 20 },
            "root": { "node": "text", "text": "= word + str(score) + str(at.x)" }
        }
    }));
    let p = compile_ok(&g);
    let typed = &p.inputs[1].sources;
    assert_eq!(typed[0].trigger, SourceTrigger::Key { code: None, up: false });
    assert_eq!(typed[1].trigger, SourceTrigger::Key { code: Some("Space".into()), up: true });
    let aim = &p.inputs[2].sources;
    let phases: Vec<_> = aim.iter().map(|s| s.trigger.clone()).collect();
    assert_eq!(
        phases,
        [PointerPhase::Down, PointerPhase::Move, PointerPhase::Up].map(SourceTrigger::Pointer).to_vec()
    );
    let guess = &p.inputs[3].sources;
    assert_eq!(guess[0].trigger, SourceTrigger::Text(TextPhase::Submit));
    assert_eq!(guess[1].trigger, SourceTrigger::Text(TextPhase::Change));
    assert!(guess.iter().all(|s| s.n_locals >= 1 && s.with.len() == 1));
    let t = p.text_input.as_ref().unwrap();
    assert_eq!((&*t.placeholder, t.max_len, t.rect, t.size), ("Your guess", 12, Some((20.0, 560.0, 320.0, 44.0)), Some(20.0)));

    // Defaults; no text source → no text input.
    let mut g2 = g.clone();
    g2["inputs"]["guess"]["from"] = json!([{ "text": "submit", "with": { "w": "text.value" } }]);
    g2["presentation"].as_object_mut().unwrap().remove("text_field");
    let t = compile_ok(&g2).text_input.unwrap();
    assert_eq!((&*t.placeholder, t.max_len, t.rect, t.size), ("Type here", 32, None, None));
    assert!(compile_ok(&game(json!({}))).text_input.is_none());
}

#[test]
fn input_source_errors() {
    let g = game(json!({
        "inputs": {
            "go": { "payload": { "n": "int" }, "from": [
                { "pointr": "down", "with": { "n": "1" } },
                { "tap": "x", "with": { "n": "1" } },
                { "key": "a", "on": "upp", "with": { "n": "1" } },
                { "pointer": "drag", "with": { "n": "1" } },
                { "text": "submit", "max_len": 500, "with": { "n": "text.value" } },
                { "key": "a", "swipe": "up", "with": { "n": "1" } },
                { "pointer": "down", "with": { "n": "pointer.x" } },
                { "key": "a", "placeholder": "x", "with": { "n": "1" } }
            ] }
        },
        "rules": [ { "on": "go", "do": [ { "incr": "score", "by": "event.n" } ] } ]
    }));
    let d = diags(&g);
    let e = find(&d, Code::BadField, "/inputs/go/from/0/pointr");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'pointer'?"));
    let e = find(&d, Code::BadField, "/inputs/go/from/1/tap");
    assert!(e.hint.as_deref().unwrap().contains("on_tap"), "{e:?}");
    let e = find(&d, Code::BadField, "/inputs/go/from/2/on");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'up'?"));
    find(&d, Code::BadField, "/inputs/go/from/3/pointer");
    find(&d, Code::Limit, "/inputs/go/from/4/max_len");
    let e = find(&d, Code::TypeMismatch, "/inputs/go/from/4/with/n");
    assert_eq!(e.message, "expected int, found string");
    find(&d, Code::BadField, "/inputs/go/from/5/swipe");
    let e = find(&d, Code::TypeMismatch, "/inputs/go/from/6/with/n");
    assert_eq!(e.message, "expected int, found float");
    find(&d, Code::BadField, "/inputs/go/from/7/placeholder");
    assert_eq!(errors(&d).len(), 9, "{}", show(&d));

    // text_field without a text source is a warning.
    let d = diags(&game(json!({ "presentation": { "text_field": { "size": 18 } } })));
    find(&d, Code::Lint, "/presentation/text_field");
    assert!(errors(&d).is_empty());
}

// ── Physics ───────────────────────────────────────────────────────────

fn physics_game(physics: J) -> J {
    game(json!({
        "types": { "Pipe": { "x": "float", "y": "float", "vx": "float", "w": "float", "h": "float", "scored": "bool" } },
        "state": {
            "score": { "type": "int", "init": "0" },
            "bird": { "type": "{x: float, y: float, vy: float, r: float}", "init": "{x: 80.0, y: 300.0, vy: 0.0, r: 12.0}" },
            "pipes": { "type": "list<Pipe>", "init": "[]" },
            "ground": { "type": "{x: float, y: float, w: float, h: float}", "init": "{x: 180.0, y: 630.0, w: 360.0, h: 20.0}" },
            "lives": { "type": "int", "init": "3" }
        },
        "events": {
            "crash": { "a": "int", "b": "int" },
            "land": { "ny": "float", "nx": "float", "a": "int" },
            "wall": { "a": "int", "ny": "float" },
            "ping": {}
        },
        "rules": [
            { "on": "go", "do": [ { "set": "bird", "to": "{...bird, vy: -400.0}" } ] },
            { "on": "crash", "do": [ { "decr": "lives" } ] },
            { "on": "land", "do": [ { "incr": "score" } ] },
            { "on": "wall", "do": [ { "incr": "score" } ] }
        ],
        "objectives": { "lose": "lives <= 0", "score": "score" },
        "physics": physics
    }))
}

#[test]
fn physics_lowering() {
    let p = compile_ok(&physics_game(json!({
        "gravity": [0, 1500],
        "bounds": [0, 0, 360, 640],
        "bodies": {
            "bird": { "state": "bird", "bounded": true, "bounce": 0.5, "max_speed": 900 },
            "pipes": { "state": "pipes" },
            "ground": { "state": "ground", "static": true }
        },
        "collisions": [
            { "a": "bird", "b": "pipes", "emit": "crash" },
            { "a": "bird", "b": "ground", "solid": true, "bounce": 0.2, "emit": "land" }
        ],
        "on_bounds": [ { "body": "bird", "emit": "wall" } ]
    })));
    let ph = p.physics.as_ref().unwrap();
    assert_eq!(ph.gravity, (0.0, 1500.0));
    assert_eq!(ph.bounds, Some((0.0, 0.0, 360.0, 640.0)));
    let bird = &ph.bodies[0];
    // {r, vy, x, y} sorted by name.
    assert_eq!((bird.x, bird.y, bird.vx, bird.vy), (2, 3, None, Some(1)));
    assert_eq!(bird.shape, BodyShape::Circle { r: 0 });
    assert_eq!((bird.gravity_scale, bird.bounded, bird.bounce, bird.max_speed, bird.is_list), (1.0, true, 0.5, Some(900.0), false));
    let pipes = &ph.bodies[1];
    // Pipe: {h, scored, vx, w, x, y}.
    assert!(pipes.is_list);
    assert_eq!(pipes.shape, BodyShape::Rect { w: 3, h: 0 });
    assert_eq!((pipes.vx, pipes.vy, pipes.gravity_scale), (Some(2), None, 0.0));
    assert!(ph.bodies[2].is_static && ph.bodies[2].state == p.state_index("ground").unwrap());
    let c0 = &ph.collisions[0];
    assert_eq!((c0.a, c0.b, c0.solid, c0.bounce), (0, 1, false, 0.5));
    let e0 = c0.emit.as_ref().unwrap();
    assert_eq!((e0.event, e0.fields.clone()), (p.event_index("crash").unwrap(), vec![ContactField::A, ContactField::B]));
    let c1 = &ph.collisions[1];
    assert!(c1.solid && c1.bounce == 0.2);
    assert_eq!(c1.emit.as_ref().unwrap().fields, vec![ContactField::Ny, ContactField::Nx, ContactField::A]);
    assert_eq!(ph.on_bounds[0].emit.fields, vec![ContactField::A, ContactField::Ny]);
    assert!(p.physics.is_some() && compile(&physics_game(json!({ "bodies": {} })).to_string()).is_ok());
}

#[test]
fn physics_events_count_as_emitted() {
    // 'land' is only emitted by physics: no W_UNREACHABLE_RULE for its rule.
    let g = physics_game(json!({
        "bodies": { "bird": { "state": "bird" }, "ground": { "state": "ground", "static": true } },
        "collisions": [ { "a": "bird", "b": "ground", "solid": true, "emit": "land" } ]
    }));
    let d = diags(&g);
    assert!(!d.iter().any(|x| x.code == Code::UnreachableRule && x.at == "/rules/2/on"), "{}", show(&d));
    find(&d, Code::UnreachableRule, "/rules/1/on");
    // Physics reads its state, so it isn't W_UNUSED_STATE.
    assert!(!d.iter().any(|x| x.code == Code::UnusedState && x.at == "/state/ground"), "{}", show(&d));
}

#[test]
fn physics_errors() {
    let d = diags(&physics_game(json!({
        "gravity": [0],
        "bodies": {
            "a": { "state": "bord" },
            "b": { "state": "score" },
            "c": { "state": "lives", "bounded": true },
            "bird": { "state": "bird", "bounded": true, "bounce": 2, "gravty": 1 },
            "pipes": { "state": "pipes" }
        },
        "collisions": [
            { "a": "bird", "b": "pipez", "emit": "crash" },
            { "a": "bird", "b": "pipes", "emit": "land2" },
            { "a": "bird", "b": "pipes", "emit": "go" }
        ],
        "on_bounds": [ { "body": "bird", "emit": "crash" } ]
    })));
    find(&d, Code::Physics, "/physics/gravity");
    let e = find(&d, Code::Physics, "/physics/bodies/a/state");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'bird'?"));
    let e = find(&d, Code::Physics, "/physics/bodies/b/state");
    assert!(e.message.contains("state 'score' is int"), "{}", e.message);
    find(&d, Code::Physics, "/physics/bodies/bird/bounded");
    find(&d, Code::Physics, "/physics/bodies/bird/bounce");
    let e = find(&d, Code::Physics, "/physics/bodies/bird/gravty");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'gravity'?"));
    let e = find(&d, Code::Physics, "/physics/collisions/0/b");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'pipes'?"));
    find(&d, Code::UnknownEvent, "/physics/collisions/1/emit");
    find(&d, Code::UnknownEvent, "/physics/collisions/2/emit");
    find(&d, Code::Physics, "/physics/on_bounds");
    // on_bounds events can't carry 'b'.
    let e = find(&d, Code::BadPayload, "/physics/on_bounds/0/emit");
    assert!(e.message.contains("'b'"), "{}", e.message);

    // Field types, shapes and payload fields.
    let mut g = physics_game(json!({
        "bodies": { "bird": { "state": "bird" }, "pipes": { "state": "pipes" } },
        "collisions": [ { "a": "bird", "b": "pipes", "emit": "hit" } ]
    }));
    g["state"]["bird"] = json!({ "type": "{x: int, y: float}", "init": "{x: 1, y: 2.0}" });
    g["types"]["Pipe"] = json!({ "x": "float", "y": "float", "w": "float" });
    g["events"]["hit"] = json!({ "a": "float", "who": "string" });
    let d = diags(&g);
    let bird: Vec<&Diagnostic> = d.iter().filter(|x| x.at == "/physics/bodies/bird/state").collect();
    assert!(bird.iter().any(|x| x.message.contains("field 'x' of state 'bird' must be float")), "{}", show(&d));
    assert!(bird.iter().any(|x| x.message.contains("no shape")), "{}", show(&d));
    let e = find(&d, Code::Physics, "/physics/bodies/pipes/state");
    assert!(e.message.contains("no field 'h'"), "{}", e.message);
    let hit: Vec<&Diagnostic> = d.iter().filter(|x| x.code == Code::BadPayload && x.at == "/physics/collisions/0/emit").collect();
    assert_eq!(hit.len(), 2, "{}", show(&d));
}

// ── Audio, particles, haptics ─────────────────────────────────────────

fn feedback_game(actions: J) -> J {
    game(json!({ "presentation": { "feedback": [ { "on": "go", "do": actions } ] } }))
}

#[test]
fn sounds_particles_haptics() {
    let p = compile_ok(&feedback_game(json!([
        { "sound": { "asset": "flap", "volume": 0.8 } },
        { "sound": { "wave": "square", "note": "C5", "ms": 90, "volume": 0.5, "slide": "C6" } },
        { "sound": { "wave": "triangle", "notes": ["C5", "E5", 784], "step_ms": 70 } },
        { "sound": { "note": "= 220 + score" } },
        { "particles": { "x": "= score * 2", "y": 100, "color": "#FFD166", "count": 16 } },
        { "haptic": "light" },
        { "haptic": "= if score > 3 then 'heavy' else 'light'" }
    ])));
    let a = &p.presentation.feedback[0].actions;
    let FeedbackAction::Sound(s) = &a[0] else { panic!() };
    assert!(is_const(s.asset.as_ref().unwrap(), Value::str("flap")) && is_const(&s.volume, Value::Float(0.8)));
    assert!(is_const(&s.rate, Value::Float(1.0)) && s.notes.is_none() && s.slide.is_none());
    let FeedbackAction::Sound(s) = &a[1] else { panic!() };
    assert!(s.asset.is_none() && is_const(&s.wave, Value::str("square")) && is_const(&s.note, Value::str("C5")));
    assert!(is_const(s.slide.as_ref().unwrap(), Value::str("C6")) && is_const(&s.ms, Value::Float(90.0)));
    let FeedbackAction::Sound(s) = &a[2] else { panic!() };
    let notes = Value::list(vec![Value::str("C5"), Value::str("E5"), Value::str("784")]);
    assert!(is_const(s.notes.as_ref().unwrap(), notes));
    assert!(is_const(&s.step_ms, Value::Float(70.0)) && is_const(&s.volume, Value::Float(0.6)) && is_const(&s.ms, Value::Float(100.0)));
    let FeedbackAction::Sound(s) = &a[3] else { panic!() };
    assert!(matches!(s.note, Prop::Expr(mg_core::ir::Expr::ToFloat(_))));
    let FeedbackAction::Particles(pa) = &a[4] else { panic!() };
    assert!(matches!(pa.x, Prop::Expr(_)) && is_const(&pa.count, Value::Int(16)) && is_const(&pa.speed, Value::Float(200.0)));
    assert!(is_const(&pa.size, Value::Float(4.0)) && is_const(&pa.ms, Value::Float(500.0)));
    assert!(is_const(&pa.gravity, Value::Float(0.0)) && is_const(&pa.spread, Value::Float(360.0)));
    assert!(matches!(&a[5], FeedbackAction::Haptic(h) if is_const(h, Value::str("light"))));
    assert!(matches!(&a[6], FeedbackAction::Haptic(Prop::Expr(_))));
}

#[test]
fn feedback_errors() {
    let d = diags(&feedback_game(json!([
        { "sound": { "asset": "flap", "wave": "sine" } },
        { "sound": { "notes": ["C5", "Q9"], "note": "C5" } },
        { "sound": { "wave": "sqaure", "step_ms": 50, "volume": 3 } },
        { "sound": { "notes": [] } },
        { "particles": { "x": 0, "count": 100, "spread": 400 } },
        { "haptic": "ligt" },
        { "confetti": {} }
    ])));
    let e = find(&d, Code::Presentation, "/presentation/feedback/0/do/0/sound/wave");
    assert_eq!(e.message, "'wave' doesn't apply to a sample sound");
    find(&d, Code::Presentation, "/presentation/feedback/0/do/1/sound/notes/1");
    find(&d, Code::Presentation, "/presentation/feedback/0/do/1/sound/note");
    let e = find(&d, Code::Presentation, "/presentation/feedback/0/do/2/sound/wave");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'square'?"));
    find(&d, Code::Presentation, "/presentation/feedback/0/do/2/sound/step_ms");
    find(&d, Code::Presentation, "/presentation/feedback/0/do/2/sound/volume");
    find(&d, Code::Presentation, "/presentation/feedback/0/do/3/sound/notes");
    let e = find(&d, Code::Presentation, "/presentation/feedback/0/do/4/particles");
    assert_eq!(e.message, "particles needs 'y' (world coordinates)");
    find(&d, Code::Limit, "/presentation/feedback/0/do/4/particles/count");
    find(&d, Code::Presentation, "/presentation/feedback/0/do/4/particles/spread");
    let e = find(&d, Code::Presentation, "/presentation/feedback/0/do/5/haptic");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'light'?"));
    find(&d, Code::Presentation, "/presentation/feedback/0/do/6/confetti");
    assert_eq!(errors(&d).len(), 12, "{}", show(&d));
}

// ── Builtins ──────────────────────────────────────────────────────────

fn init_errs(ty: &str, init: &str) -> Vec<Diagnostic> {
    let g = game(json!({ "state": {
        "score": { "type": "int", "init": "0" },
        "res": { "type": ty, "init": init }
    } }));
    diags(&g).into_iter().filter(|d| d.is_error()).collect()
}

fn ok(ty: &str, init: &str) {
    let e = init_errs(ty, init);
    assert!(e.is_empty(), "{ty} = {init}:\n{}", show(&e));
}

fn bad(ty: &str, init: &str, code: Code) -> Diagnostic {
    let e = init_errs(ty, init);
    assert!(e.iter().any(|d| d.code == code), "{ty} = {init}: expected {}, got:\n{}", code.as_str(), show(&e));
    e.into_iter().find(|d| d.code == code).unwrap()
}

#[test]
fn v02_builtins() {
    ok("list<string>", "split('a,b', ',')");
    ok("string", "trim('  a ') + substr('hello', 1, 3) + replace('aXa', 'X', 'b')");
    ok("bool", "starts_with('abc', 'a') and ends_with('abc', 'c')");
    ok("int?", "parse_int(' 42 ')");
    ok("int", "or_else(parse_int('x'), 0) + index_of('hello', 'l') + index_of([1, 2], 2)");
    ok("float", "atan2(1, 2) + pow(2, 3) + fmod(5.5, 2) + angle(vec(1, 1)) + pi");
    ok("int", "sign(-3)");
    ok("float", "sign(-3.5)");
    ok("vec2", "from_angle(pi / 2) + rotate(vec(1, 0), 1) + rotate(vec(1.0, 0.0), pi)");
    ok("int", "min_of([3, 1, 2]) + max_of([1])");
    ok("float", "max_of([1.5, 2])");
    ok("bool", "chance(0.5)");
    let e = bad("string", "trim(3)", Code::TypeMismatch);
    assert_eq!(e.message, "trim expects a string as argument 1, found int");
    bad("int", "substr('abc', 1)", Code::TypeMismatch);
    bad("int", "index_of('abc', 1)", Code::TypeMismatch);
    bad("int", "min_of(['a'])", Code::TypeMismatch);
    bad("float", "angle(3)", Code::TypeMismatch);
    bad("int", "sign('a')", Code::TypeMismatch);
    bad("int", "parse_int('3')", Code::TypeMismatch);
    // chance is random: forbidden in pure contexts.
    let g = game(json!({ "rules": [ { "on": "go", "when": "chance(0.5)", "do": [ { "incr": "score" } ] } ] }));
    let e = find(&diags(&g), Code::RandomInPure, "/rules/0/when").clone();
    assert_eq!(e.span, Some((0, 6)));
    let g = game(json!({ "rules": [ { "on": "go", "do": [ { "if": "chance(0.5)", "then": [ { "incr": "score" } ] } ] } ] }));
    assert!(errors(&diags(&g)).is_empty());
}

// ── Examples ──────────────────────────────────────────────────────────

#[test]
fn examples_compile_clean() {
    let dir = format!("{}/../../examples", env!("CARGO_MANIFEST_DIR"));
    let mut n = 0;
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        // `*.replay.json` files are input scripts, not games.
        if !name.ends_with(".json") || name.ends_with(".replay.json") {
            continue;
        }
        let src = std::fs::read_to_string(&path).unwrap();
        let d = validate(&src);
        let e = errors(&d);
        assert!(e.is_empty(), "{}:\n{}", path.display(), show(&d));
        if !d.is_empty() {
            println!("{} warnings:\n{}", path.display(), show(&d));
        }
        n += 1;
    }
    assert!(n >= 1);
}

#[test]
#[ignore]
fn compile_speed_v02() {
    let mut srcs: Vec<(String, String)> = vec![("v02_physics".into(), physics_game(json!({
        "gravity": [0, 1500], "bounds": [0, 0, 360, 640],
        "bodies": { "bird": { "state": "bird", "bounded": true }, "pipes": { "state": "pipes" } },
        "collisions": [ { "a": "bird", "b": "pipes", "emit": "crash" } ]
    })).to_string())];
    let dir = format!("{}/../../examples", env!("CARGO_MANIFEST_DIR"));
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            srcs.push((path.file_name().unwrap().to_string_lossy().into(), std::fs::read_to_string(&path).unwrap()));
        }
    }
    for (name, src) in srcs {
        if compile(&src).is_err() {
            println!("{name}: has errors, skipped");
            continue;
        }
        for _ in 0..50 {
            compile(&src).ok().unwrap();
        }
        let n = 2000;
        let t = std::time::Instant::now();
        for _ in 0..n {
            std::hint::black_box(compile(std::hint::black_box(&src)).ok().unwrap());
        }
        println!("{name}: {:.1} µs per compile", t.elapsed().as_secs_f64() / n as f64 * 1e6);
    }
}

// ── v0.2.1 additions ──────────────────────────────────────────────────

#[test]
fn press_and_release_bindings() {
    let g = game(json!({
        "inputs": { "go": {}, "hold": { "payload": { "on": "bool", "at": "vec2" } } },
        "presentation": { "root": { "node": "group", "children": [
            { "node": "circle", "r": 30, "fixed": true,
              "on_press": { "input": "hold", "with": { "on": "true", "at": "pointer" } },
              "on_release": { "input": "hold", "with": { "on": "false", "at": "pointer" } },
              "on_tap": { "input": "go" } }
        ] } }
    }));
    let p = compile_ok(&g);
    let n = &root_children(&p)[0];
    let (press, release) = (n.on_press.as_ref().unwrap(), n.on_release.as_ref().unwrap());
    assert_eq!((press.input, release.input), (1, 1));
    assert_eq!((press.with.len(), release.with.len()), (2, 2));
    assert!(n.on_tap.is_some() && n.on_drag.is_none());

    // Same checks as on_tap: unknown inputs, missing fields, wrong types.
    let g = game(json!({
        "inputs": { "go": {}, "hold": { "payload": { "on": "bool" } } },
        "presentation": { "root": { "node": "group", "children": [
            { "node": "rect", "w": 10, "h": 10, "on_press": { "input": "holdd", "with": { "on": "true" } } },
            { "node": "rect", "w": 10, "h": 10, "on_release": { "input": "hold", "with": { "on": "1" } } },
            { "node": "rect", "w": 10, "h": 10, "on_release": { "input": "hold" } }
        ] } }
    }));
    let d = diags(&g);
    let e = find(&d, Code::UnknownInput, "/presentation/root/children/0/on_press/input");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'hold'?"));
    find(&d, Code::TypeMismatch, "/presentation/root/children/1/on_release/with/on");
    assert!(d.iter().any(|x| x.is_error() && x.at.starts_with("/presentation/root/children/2/on_release")), "{}", show(&d));
}

#[test]
fn text_wrap_validation() {
    let g = game(json!({ "presentation": { "root": { "node": "group", "children": [
        { "node": "text", "text": "a long line", "w": 120, "wrap": true, "stroke": "#000", "stroke_width": 3 },
        { "node": "text", "text": "plain" }
    ] } } }));
    let p = compile_ok(&g);
    let NodeKind::Text { wrap, .. } = &root_children(&p)[0].kind else { panic!() };
    assert!(*wrap);
    let NodeKind::Text { wrap, .. } = &root_children(&p)[1].kind else { panic!() };
    assert!(!*wrap);
    let g = game(json!({ "presentation": { "root": { "node": "group", "children": [
        { "node": "text", "text": "no box", "wrap": true },
        { "node": "text", "text": "x", "w": 50, "wrap": "yes" },
        { "node": "rect", "w": 5, "h": 5, "wrap": true }
    ] } } }));
    let d = diags(&g);
    let e = find(&d, Code::Presentation, "/presentation/root/children/0/wrap");
    assert_eq!(e.message, "'wrap' needs a box width 'w' to wrap to");
    find(&d, Code::Presentation, "/presentation/root/children/1/wrap");
    find(&d, Code::Presentation, "/presentation/root/children/2/wrap");
    assert_eq!(errors(&d).len(), 3, "{}", show(&d));
}

#[test]
fn feedback_when_is_a_pure_bool_with_event_and_state() {
    let g = game(json!({
        "events": { "ping": {}, "hit": { "payload": { "power": "int" } } },
        "presentation": { "feedback": [
            { "on": "hit", "when": "event.power > 2 and score < 10", "do": [ { "haptic": "heavy" } ] },
            { "on": "go", "do": [ { "haptic": "light" } ] }
        ] }
    }));
    let p = compile_ok(&g);
    assert!(p.presentation.feedback[0].when.is_some());
    assert!(p.presentation.feedback[1].when.is_none());
    let g = game(json!({
        "events": { "ping": {}, "hit": { "payload": { "power": "int" } } },
        "presentation": { "feedback": [
            { "on": "hit", "when": "event.power", "do": [] },
            { "on": "hit", "when": "chance(0.5)", "do": [] },
            { "on": "hit", "when": "event.nope", "do": [] },
            { "on": "go", "if": "true", "do": [] }
        ] }
    }));
    let d = diags(&g);
    find(&d, Code::TypeMismatch, "/presentation/feedback/0/when");
    find(&d, Code::RandomInPure, "/presentation/feedback/1/when");
    assert!(d.iter().any(|x| x.is_error() && x.at == "/presentation/feedback/2/when"), "{}", show(&d));
    let e = find(&d, Code::Presentation, "/presentation/feedback/3/if");
    assert!(e.hint.as_deref().unwrap_or("").contains("when"), "{}", show(&d));
}

#[test]
fn poly_list_literal_over_the_limit_fails_validation() {
    let pts = |n: usize| (0..n).map(|i| format!("vec({i}, 0)")).collect::<Vec<_>>().join(", ");
    let poly = |src: String| {
        game(json!({ "presentation": { "root": { "node": "group", "children": [ { "node": "poly", "points": src } ] } } }))
    };
    let d = diags(&poly(format!("= [{}]", pts(300))));
    let e = find(&d, Code::Limit, "/presentation/root/children/0/points");
    assert_eq!(e.message, "300 points; the limit is 256 per poly");
    assert!(errors(&diags(&poly(format!("= [{}]", pts(256))))).is_empty());
    // A one-point list literal is caught too; computed lists are checked per frame.
    find(&diags(&poly("= [vec(score, 0)]".into())), Code::Presentation, "/presentation/root/children/0/points");
    assert!(errors(&diags(&poly("= map(range(0, 300), i => vec(i, 0))".into()))).is_empty());
}

// ── v0.2.2: clipping groups, image crops, shape hits ─────────────────

#[test]
fn clip_crop_and_shape_hit_compile() {
    let g = game(json!({ "presentation": {
        "root": { "node": "group", "children": [
            { "node": "group", "x": 20, "y": 40, "w": 200, "h": "= 100 + score", "clip": true, "children": [
                { "node": "image", "asset": "hero", "w": 200, "h": 200,
                  "src_x": 8, "src_y": "= score", "src_w": 16, "src_h": 16 }
            ] },
            { "node": "group", "w": 10, "h": 10, "children": [] },
            { "node": "poly", "points": [[0, 0], [20, 0], [10, 16]], "hit": "shape",
              "on_tap": { "input": "go" } },
            { "node": "poly", "points": [[0, 0], [20, 0], [10, 16]], "hit": "box" }
        ] }
    } }));
    let p = compile_ok(&g);
    let c = root_children(&p);
    let NodeKind::Group { children, w, h, clip } = &c[0].kind else { panic!() };
    assert!(*clip && matches!(w, Some(Prop::Const(Value::Float(200.0)))) && matches!(h, Some(Prop::Expr(_))));
    let NodeKind::Image { src_x, src_y, src_w, src_h, .. } = &children[0].kind else { panic!() };
    assert!(matches!(src_x, Some(Prop::Const(Value::Float(8.0)))) && matches!(src_y, Some(Prop::Expr(_))));
    assert!(matches!(src_w, Some(Prop::Const(Value::Float(16.0)))) && src_h.is_some());
    let NodeKind::Group { clip, w, .. } = &c[1].kind else { panic!() };
    assert!(!clip && w.is_some());
    let NodeKind::Poly { hit_shape, .. } = &c[2].kind else { panic!() };
    assert!(*hit_shape);
    let NodeKind::Poly { hit_shape, .. } = &c[3].kind else { panic!() };
    assert!(!hit_shape);
    // Old nodes are unchanged: a plain image has no source rect, a plain group no box.
    let p = compile_ok(&game(json!({ "presentation": { "root": { "node": "group", "children": [
        { "node": "image", "asset": "hero" } ] } } })));
    let NodeKind::Group { w: None, h: None, clip: false, .. } = &p.presentation.root.kind else { panic!() };
    let NodeKind::Image { src_x: None, src_y: None, src_w: None, src_h: None, .. } = &root_children(&p)[0].kind else {
        panic!()
    };
}

#[test]
fn clip_crop_and_shape_hit_errors() {
    let g = game(json!({ "presentation": {
        "root": { "node": "group", "children": [
            { "node": "group", "clip": true, "children": [] },
            { "node": "group", "w": 10, "children": [] },
            { "node": "group", "h": 10, "w": 5, "clip": "yes" },
            { "node": "image", "asset": "hero", "src_w": 0, "src_h": -4 },
            { "node": "image", "asset": "hero", "src_x": "left" },
            { "node": "poly", "points": [[0, 0], [1, 1]], "hit": "circle" },
            { "node": "rect", "w": 1, "h": 1, "clip": true },
            { "node": "rect", "w": 1, "h": 1, "hit": "shape" },
            { "node": "image", "asset": "hero", "src_w": "= score - 2" }
        ] }
    } }));
    let d = diags(&g);
    let at = |i: usize, k: &str| {
        if k.is_empty() {
            format!("/presentation/root/children/{i}")
        } else {
            format!("/presentation/root/children/{i}/{k}")
        }
    };
    assert!(find(&d, Code::Presentation, &at(0, "clip")).message.contains("needs the group's box"));
    assert!(find(&d, Code::Presentation, &at(1, "")).message.contains("also needs 'h'"));
    assert!(find(&d, Code::Presentation, &at(2, "clip")).message.contains("true or false"));
    let m = &find(&d, Code::Presentation, &at(3, "src_w")).message;
    assert!(m.contains("greater than 0") && m.contains("found 0"), "{m}");
    assert!(find(&d, Code::Presentation, &at(3, "src_h")).message.contains("found -4"));
    find(&d, Code::Presentation, &at(4, "src_x"));
    let hit = find(&d, Code::Presentation, &at(5, "hit"));
    assert!(hit.message.contains("box, shape"), "{}", hit.message);
    assert!(find(&d, Code::Presentation, &at(6, "clip")).message.contains("unknown property 'clip' on a rect node"));
    find(&d, Code::Presentation, &at(7, "hit"));
    // A bound value is checked each frame, not here.
    assert!(!d.iter().any(|x| x.at == at(8, "src_w")), "{}", show(&d));
    assert_eq!(errors(&d).len(), 9, "{}", show(&d));
}
