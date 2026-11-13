//! End-to-end tests on the Part C fixtures: compile with mg-lang, run with
//! mg-runtime, render with `Player`.
//!
//! Benchmark (release): `cargo test -p mg-scene --release --test fixtures -- --ignored --nocapture bench`

use std::rc::Rc;
use std::time::Instant;

use mg_core::frame::{DrawOp, Frame, RectOp, SoundKind, TextOp};
use mg_core::Value;
use mg_runtime::Phase;
use mg_scene::{Player, PointerKind};

fn load(name: &str) -> Player {
    let path = format!("{}/../../fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let json = std::fs::read_to_string(&path).unwrap();
    let compiled = match mg_lang::compile(&json) {
        Ok(c) => c,
        Err(d) => panic!("{name} failed to compile: {d:#?}"),
    };
    Player::new(Rc::new(compiled.program), 7)
}

fn rects(f: &Frame) -> Vec<&RectOp> {
    f.ops.iter().filter_map(|o| if let DrawOp::Rect(r) = o { Some(r) } else { None }).collect()
}

fn texts(f: &Frame) -> Vec<&TextOp> {
    f.ops.iter().filter_map(|o| if let DrawOp::Text(t) = o { Some(t) } else { None }).collect()
}

/// Bounds of all ops (unscaled).
fn op_bounds(f: &Frame) -> (f64, f64, f64, f64) {
    let mut b = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for o in &f.ops {
        let (x0, y0, x1, y1) = match o {
            DrawOp::Rect(r) => (r.x, r.y, r.x + r.w, r.y + r.h),
            DrawOp::Text(t) => (t.x, t.y, t.x + t.w, t.y + t.h),
            DrawOp::Circle(c) => (c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r),
            DrawOp::Image(i) => (i.x, i.y, i.x + i.w, i.y + i.h),
            DrawOp::Line(l) => (l.x1.min(l.x2), l.y1.min(l.y2), l.x1.max(l.x2), l.y1.max(l.y2)),
            DrawOp::Poly(p) => p.points.iter().fold(
                (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY),
                |b, &(x, y)| (b.0.min(x), b.1.min(y), b.2.max(x), b.3.max(y)),
            ),
        };
        b = (b.0.min(x0), b.1.min(y0), b.2.max(x1), b.3.max(y1));
    }
    b
}

fn state(p: &Player, name: &str) -> Value {
    let i = p.game.program().state_index(name).unwrap();
    p.game.state()[i as usize].clone()
}

fn grid_cell(v: &Value, x: i32, y: i32) -> Value {
    match v {
        Value::Grid(g) => g.get(x, y).unwrap().clone(),
        v => panic!("not a grid: {v}"),
    }
}

const ON: u32 = 0xE457_2EFF;
const OFF: u32 = 0x2B2B_2BFF;

#[test]
fn lights_out_layout_colors_and_tap() {
    let mut p = load("lights_out");
    let f = p.frame().clone();
    assert_eq!((f.width, f.height, f.background), (360.0, 640.0, 0xF4F1_EAFF));
    assert_eq!(f.ops.len(), 27);
    let (x0, y0, x1, y1) = op_bounds(&f);
    assert!(((x0 + x1) / 2.0 - 180.0).abs() < 1e-6, "{x0} {x1}");
    assert!(((y0 + y1) / 2.0 - 320.0).abs() < 1e-6, "{y0} {y1}");
    let cells = rects(&f);
    assert_eq!(cells.len(), 25);
    let board = state(&p, "board");
    for (i, r) in cells.iter().enumerate() {
        assert_eq!((r.w, r.h, r.radius), (56.0, 56.0, 6.0));
        let lit = grid_cell(&board, i as i32 % 5, i as i32 / 5).as_bool().unwrap();
        assert_eq!(r.fill, Some(if lit { ON } else { OFF }), "cell {i}");
    }
    // Grid is 5*56 + 4*6 = 304 wide, centered on 180.
    assert!((cells[0].x - 28.0).abs() < 1e-9);
    assert!((cells[1].x - cells[0].x - 62.0).abs() < 1e-9);
    assert_eq!(&*texts(&f)[0].text, "LIGHTS OUT");
    assert_eq!(&*texts(&f)[1].text, "Moves: 0");

    let targets = p.hit_targets();
    assert_eq!(targets.len(), 25);
    // Tap the center of cell (2, 1).
    let c = cells[5 + 2];
    let before = grid_cell(&board, 2, 1).as_bool().unwrap();
    p.pointer(PointerKind::Down, c.x + 28.0, c.y + 28.0);
    p.pointer(PointerKind::Up, c.x + 28.0, c.y + 28.0);
    p.step(16.0);
    let board2 = state(&p, "board");
    assert_eq!(grid_cell(&board2, 2, 1).as_bool().unwrap(), !before);
    assert_eq!(state(&p, "moves"), Value::Int(1));
    let f = p.frame().clone();
    assert_eq!(f.audio.len(), 1, "tap sound");
    match &f.audio[0].kind {
        SoundKind::Synth { freqs, .. } => assert!((freqs[0] - 659.255).abs() < 0.01, "{freqs:?}"),
        k => panic!("{k:?}"),
    }
    assert_eq!(&*texts(&f)[1].text, "Moves: 1");
    // Fill tween started from the old color; the tapped cell pulses.
    let r = rects(&f)[7].clone();
    assert_eq!(r.fill, Some(if before { ON } else { OFF }));
    p.step(60.0);
    let f = p.frame().clone();
    assert!(f.audio.is_empty(), "audio drains");
    let r = rects(&f)[7].clone();
    assert!(r.scale > 1.0 && r.scale < 1.12 + 1e-9, "scale {}", r.scale);
    assert!(r.fill != Some(ON) && r.fill != Some(OFF), "mid-tween fill {:?}", r.fill);
    assert_eq!(rects(&f)[0].scale, 1.0, "other cells don't pulse");
    p.step(200.0);
    let f = p.frame().clone();
    let r = rects(&f)[7];
    assert_eq!(r.scale, 1.0);
    assert_eq!(r.fill, Some(if before { OFF } else { ON }));
    assert!(p.diagnostics().is_empty(), "{:?}", p.diagnostics());
}

#[test]
fn lights_out_frame_is_cached_when_idle() {
    let mut p = load("lights_out");
    p.frame();
    p.step(16.0);
    p.frame();
    let n = p.build_count();
    for _ in 0..10 {
        p.step(16.0);
        p.frame();
    }
    assert_eq!(p.build_count(), n, "idle frames must not rebuild");
}

#[test]
fn number_merge_tiles_have_rect_and_text() {
    let mut p = load("number_merge");
    let f = p.frame().clone();
    // Score text + board backdrop + 16 × (rect + text).
    assert_eq!(f.ops.len(), 34);
    assert_eq!(rects(&f).len(), 17);
    let t = texts(&f);
    assert_eq!(t.len(), 17);
    assert!(t[0].text.starts_with("Score: "));
    let board = state(&p, "board");
    let mut nonzero = 0;
    for i in 0..16 {
        let v = grid_cell(&board, i % 4, i / 4).as_int().unwrap();
        let (r, tx) = (rects(&f)[1 + i as usize], t[1 + i as usize]);
        assert_eq!((r.w, r.h), (76.0, 76.0));
        assert_eq!((tx.x, tx.y, tx.w, tx.h), (r.x, r.y, 76.0, 76.0));
        if v == 0 {
            assert_eq!(&*tx.text, "");
        } else {
            nonzero += 1;
            assert_eq!(&*tx.text, v.to_string());
        }
    }
    assert_eq!(nonzero, 2);
    // Backdrop is 8 units outside the grid.
    let back = rects(&f)[0];
    assert_eq!(back.w, 344.0);
    assert!((rects(&f)[1].x - back.x - 8.0).abs() < 1e-9);
    assert!(((back.x + back.w / 2.0) - 180.0).abs() < 1e-9);
    // Slide: board changes, a sound plays.
    for k in ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"] {
        assert!(p.key(k));
        p.step(16.0);
    }
    let f = p.frame();
    assert!(!f.audio.is_empty());
    assert!(p.diagnostics().is_empty(), "{:?}", p.diagnostics());
}

#[test]
fn snake_renders_225_cells_and_shakes_on_lose() {
    let mut p = load("snake");
    let f = p.frame().clone();
    assert_eq!(rects(&f).len(), 225);
    assert_eq!(f.ops.len(), 226);
    assert_eq!(&*texts(&f)[0].text, "Apples: 0 / 10");
    let head = 0xC6F6_CFFF;
    let food = 0xFF5D_5DFF;
    assert_eq!(rects(&f)[7 * 15 + 4].fill, Some(head));
    assert_eq!(rects(&f)[7 * 15 + 10].fill, Some(food));
    // Run into the right wall.
    let mut shook = false;
    for _ in 0..200 {
        p.step(16.0);
        let f = p.frame();
        shook |= f.shake_px > 0.0;
        if p.status().phase != Phase::Playing {
            break;
        }
    }
    assert_eq!(p.status().phase, Phase::Lost);
    p.step(16.0);
    let f = p.frame();
    shook |= f.shake_px > 0.0;
    assert!(shook);
    p.restart(3);
    let f = p.frame();
    assert_eq!(f.shake_px, 0.0);
    assert_eq!(rects(f).len(), 225);
    assert!(p.diagnostics().is_empty(), "{:?}", p.diagnostics());
}

#[test]
fn drag_captures_on_down_and_releases_on_up() {
    let json = r##"{
      "format": "microgame/0.1",
      "meta": { "title": "Drag", "instructions": "Drag the box." },
      "state": { "px": { "type": "float", "init": "0.0" }, "n": { "type": "int", "init": "0" } },
      "inputs": { "move": { "payload": { "x": "float" } } },
      "rules": [ { "id": "m", "on": "move", "do": [ { "set": "px", "to": "event.x" }, { "incr": "n" } ] } ],
      "objectives": { "win": "n >= 100" },
      "presentation": {
        "canvas": { "w": 100, "h": 100, "background": "#000" },
        "root": { "node": "rect", "x": "= px", "y": 10, "w": 20, "h": 20, "fill": "#fff",
                  "on_drag": { "input": "move", "with": { "x": "pointer.x" } } }
      }
    }"##;
    let compiled = match mg_lang::compile(json) {
        Ok(c) => c,
        Err(d) => panic!("{d:#?}"),
    };
    let mut p = Player::new(Rc::new(compiled.program), 1);
    assert_eq!(p.hit_targets(), vec![mg_scene::HitTarget { x: 0.0, y: 10.0, w: 20.0, h: 20.0, drag: true }]);
    p.pointer(PointerKind::Move, 5.0, 15.0); // no capture yet: ignored
    p.pointer(PointerKind::Down, 50.0, 15.0); // miss
    p.pointer(PointerKind::Down, 5.0, 15.0);
    p.pointer(PointerKind::Move, 50.0, 80.0); // captured: outside the box still drags
    p.pointer(PointerKind::Up, 60.0, 80.0);
    p.pointer(PointerKind::Move, 70.0, 80.0); // released
    p.step(16.0);
    assert_eq!(state(&p, "n"), Value::Int(3));
    assert_eq!(state(&p, "px"), Value::Float(60.0));
    let f = p.frame();
    assert_eq!(rects(f)[0].x, 60.0);
    assert!(p.diagnostics().is_empty(), "{:?}", p.diagnostics());
}

#[test]
fn v2_key_event_and_text_passthrough() {
    let json = r##"{
      "format": "microgame/0.2",
      "meta": { "title": "Type", "instructions": "Type." },
      "state": { "log": { "type": "list<string>", "init": "[]" } },
      "inputs": {
        "k": { "payload": { "c": "string" }, "from": [ { "key": "any", "on": "up", "with": { "c": "key.char" } } ] },
        "t": { "payload": { "v": "string" }, "from": [ { "text": "submit", "with": { "v": "text.value" } } ] }
      },
      "rules": [
        { "id": "k", "on": "k", "do": [ { "push": "log", "value": "'key ' + event.c" } ] },
        { "id": "t", "on": "t", "do": [ { "push": "log", "value": "'text ' + event.v" } ] }
      ],
      "objectives": { "win": "len(log) >= 100" },
      "presentation": { "canvas": { "w": 100, "h": 100, "background": "#000" },
                        "root": { "node": "rect", "w": 1, "h": 1 } }
    }"##;
    let mut p = compile(json);
    assert!(!p.key_event("KeyA", "a", true), "down doesn't match an `up` source");
    assert!(p.key_event("KeyA", "a", false));
    assert!(p.text(mg_core::ir::TextPhase::Submit, "hello"));
    assert!(!p.text(mg_core::ir::TextPhase::Change, "hello"));
    p.step(16.0);
    assert_eq!(log(&p), vec!["key a", "text hello"]);
}

/// 100 sprites in a repeat (animated, camera applied) plus 200 live particles.
const SPRITES: &str = r##"{
  "format": "microgame/0.2",
  "meta": { "title": "Sprites", "instructions": "Bench." },
  "assets": { "hero": { "svg": "<svg xmlns='http://www.w3.org/2000/svg'></svg>", "w": 32, "h": 32, "frames": 6, "fps": 10 } },
  "state": { "items": { "type": "list<int>", "init": "range(100)" }, "n": { "type": "int", "init": "0" } },
  "inputs": { "burst": { "payload": {}, "from": [ { "key": "Space" } ] } },
  "rules": [ { "id": "b", "on": "burst", "do": [ { "incr": "n" } ] } ],
  "objectives": { "win": "n >= 1000" },
  "presentation": {
    "canvas": { "w": 360, "h": 640, "background": "#000" },
    "camera": { "x": 20, "y": 0 },
    "root": { "node": "repeat", "source": "= items", "as": "i", "template":
      { "node": "image", "asset": "hero", "x": "= (i % 10) * 36", "y": "= (i / 10) * 36", "opacity": 0.9 } },
    "feedback": [ { "on": "burst", "do": [ { "particles": { "x": 180, "y": 320, "count": 50, "gravity": 300 } } ] } ]
  }
}"##;

#[test]
fn v2_sprites_bench_scene_renders() {
    let mut p = compile(SPRITES);
    for _ in 0..4 {
        assert!(p.key("Space"));
    }
    p.step(1.0);
    let f = p.frame();
    assert_eq!(f.ops.iter().filter(|o| matches!(o, DrawOp::Image(_))).count(), 100);
    assert_eq!(f.ops.iter().filter(|o| matches!(o, DrawOp::Circle(_))).count(), 200);
    assert!(matches!(&f.ops[11], DrawOp::Image(i) if (i.x, i.y) == (16.0, 36.0)));
    assert!(p.diagnostics().is_empty(), "{:?}", p.diagnostics());
}

#[test]
#[ignore]
fn bench_frames() {
    for name in ["lights_out", "snake", "number_merge"] {
        let mut p = load(name);
        p.frame();
        let n = 2000;
        let t = Instant::now();
        for _ in 0..n {
            std::hint::black_box(p.rebuild().ops.len());
        }
        let rebuild = t.elapsed().as_secs_f64() * 1e6 / n as f64;
        let t = Instant::now();
        for _ in 0..n * 10 {
            std::hint::black_box(p.frame().ops.len());
        }
        let cached = t.elapsed().as_secs_f64() * 1e6 / (n * 10) as f64;
        println!("{name:>13}: rebuild {rebuild:7.2} µs/frame, cached {cached:6.3} µs/frame, {} ops", p.frame().ops.len());
    }
    // v0.2: 100 animated sprites in a repeat + 200 live particles. Every
    // frame rebuilds while particles are alive, so `frame()` = rebuild here.
    let mut p = compile(SPRITES);
    for _ in 0..4 {
        p.key("Space");
    }
    p.step(1.0);
    p.frame();
    let n = 2000;
    let t = Instant::now();
    for _ in 0..n {
        std::hint::black_box(p.rebuild().ops.len());
    }
    let rebuild = t.elapsed().as_secs_f64() * 1e6 / n as f64;
    println!("{:>13}: rebuild {rebuild:7.2} µs/frame, {} ops", "sprites+fx", p.frame().ops.len());
}

// ── v0.2 end to end ─────────────────────────────────────────────────────────

fn compile(json: &str) -> Player {
    match mg_lang::compile(json) {
        Ok(c) => Player::new(Rc::new(c.program), 1),
        Err(d) => panic!("{d:#?}"),
    }
}

const SCROLLER: &str = r##"{
  "format": "microgame/0.2",
  "meta": { "title": "Scroller", "instructions": "Tap around." },
  "assets": {
    "hero":  { "svg": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 24'></svg>", "w": 32, "h": 24, "frames": 4, "fps": 8 },
    "flap":  { "sound": "data:audio/wav;base64,AAAA" },
    "theme": { "sound": "https://example.com/loop.mp3" }
  },
  "state": {
    "cam": { "type": "float", "init": "100.0" },
    "wx": { "type": "float", "init": "0.0" },
    "hx": { "type": "float", "init": "0.0" },
    "log": { "type": "list<string>", "init": "[]" }
  },
  "inputs": {
    "tap_world": { "payload": { "x": "float" } },
    "tap_hud": { "payload": { "x": "float" } },
    "press": { "payload": { "x": "float", "y": "float" },
               "from": [ { "pointer": "down", "with": { "x": "pointer.x", "y": "pointer.y" } } ] },
    "drag": { "payload": { "x": "float" }, "from": [ { "pointer": "move", "with": { "x": "pointer.x" } } ] },
    "release": { "payload": { "x": "float" }, "from": [ { "pointer": "up", "with": { "x": "pointer.x" } } ] },
    "scroll": { "payload": {}, "from": [ { "key": "ArrowRight" } ] }
  },
  "rules": [
    { "id": "w", "on": "tap_world", "do": [ { "set": "wx", "to": "event.x" } ] },
    { "id": "h", "on": "tap_hud", "do": [ { "set": "hx", "to": "event.x" } ] },
    { "id": "p", "on": "press", "do": [ { "push": "log", "value": "'down ' + str(event.x) + ' ' + str(event.y)" } ] },
    { "id": "d", "on": "drag", "do": [ { "push": "log", "value": "'move ' + str(event.x)" } ] },
    { "id": "r", "on": "release", "do": [ { "push": "log", "value": "'up ' + str(event.x)" } ] },
    { "id": "s", "on": "scroll", "do": [ { "set": "cam", "to": "cam + 50.0" } ] }
  ],
  "objectives": { "win": "len(log) >= 100" },
  "presentation": {
    "canvas": { "w": 360, "h": 640, "background": "#000" },
    "camera": { "x": "= cam", "y": 0 },
    "music": { "asset": "theme", "volume": 0.4 },
    "root": { "node": "group", "children": [
      { "node": "group", "fixed": true, "children": [
        { "node": "rect", "x": 0, "y": 0, "w": 40, "h": 40, "fill": "#fff",
          "on_tap": { "input": "tap_hud", "with": { "x": "pointer.x" } } } ] },
      { "node": "rect", "x": 200, "y": 100, "w": 50, "h": 50, "fill": "#f00",
        "on_tap": { "input": "tap_world", "with": { "x": "pointer.x" } } },
      { "node": "image", "asset": "hero", "x": 300, "y": 300 },
      { "node": "line", "x": 100, "y": 0, "x1": 0, "y1": 0, "x2": 0, "y2": 640 },
      { "node": "poly", "x": 100, "y": 0, "points": "= [vec(0.0, 0.0), vec(10.0, 0.0), vec(5.0, 8.0)]", "fill": "#0f0" }
    ] },
    "feedback": [
      { "on": "press", "do": [
        { "particles": { "x": "= event.x", "y": "= event.y", "count": 8 } },
        { "haptic": "light" },
        { "sound": { "asset": "flap", "volume": 0.8 } } ] },
      { "on": "release", "do": [ { "sound": { "wave": "triangle", "notes": ["C5", "E5", "G5"], "step_ms": 70 } } ] }
    ]
  }
}"##;

fn log(p: &Player) -> Vec<String> {
    match state(p, "log") {
        Value::List(l) => l.iter().map(|v| v.as_str().unwrap().to_string()).collect(),
        v => panic!("{v}"),
    }
}

#[test]
fn v2_camera_fixed_hud_and_world_pointer_values() {
    let mut p = compile(SCROLLER);
    let f = p.frame().clone();
    // World ops shifted by the camera (100, 0); the HUD painted last, unshifted.
    assert_eq!(f.ops.len(), 5);
    assert!(matches!(&f.ops[0], DrawOp::Rect(r) if (r.x, r.y) == (100.0, 100.0)));
    assert!(matches!(&f.ops[1], DrawOp::Image(i) if (i.x, i.y, i.w, i.h, i.asset) == (200.0, 300.0, 32.0, 24.0, 0)));
    assert!(matches!(&f.ops[2], DrawOp::Line(l) if (l.x1, l.y2, l.stroke_width) == (0.0, 640.0, 2.0)));
    assert!(matches!(&f.ops[3], DrawOp::Poly(q) if q.points[1] == (10.0, 0.0)));
    assert!(matches!(&f.ops[4], DrawOp::Rect(r) if (r.x, r.y, r.w) == (0.0, 0.0, 40.0)));
    assert_eq!(f.music, Some(mg_core::frame::MusicState { asset: 2, volume: 0.4, playing: true }));
    // Targets in canvas coordinates; pointer values in world units for world nodes.
    p.pointer(PointerKind::Down, 110.0, 110.0);
    p.pointer(PointerKind::Up, 110.0, 110.0);
    p.pointer(PointerKind::Down, 10.0, 10.0);
    p.pointer(PointerKind::Up, 10.0, 10.0);
    p.step(16.0);
    assert_eq!(state(&p, "wx"), Value::Float(210.0));
    assert_eq!(state(&p, "hx"), Value::Float(10.0));
    assert!(log(&p).is_empty(), "taps taken by nodes don't reach pointer sources: {:?}", log(&p));
    // Scroll: the camera follows state; the HUD target stays put.
    assert!(p.key("ArrowRight"));
    p.step(16.0);
    let f = p.frame().clone();
    assert!(matches!(&f.ops[0], DrawOp::Rect(r) if r.x == 50.0));
    assert_eq!(p.camera(), (150.0, 0.0));
    p.pointer(PointerKind::Down, 60.0, 110.0);
    p.pointer(PointerKind::Up, 60.0, 110.0);
    p.step(16.0);
    assert_eq!(state(&p, "wx"), Value::Float(210.0));
    assert!(p.diagnostics().is_empty(), "{:?}", p.diagnostics());
}

#[test]
fn v2_pointer_sources_fallback_and_feedback() {
    let mut p = compile(SCROLLER);
    p.frame();
    p.pointer(PointerKind::Move, 300.0, 500.0); // not down: nothing
    p.pointer(PointerKind::Down, 300.0, 500.0); // misses every target
    p.pointer(PointerKind::Move, 310.0, 500.0);
    p.pointer(PointerKind::Up, 320.0, 500.0);
    p.pointer(PointerKind::Move, 330.0, 500.0); // released: nothing
    p.step(16.0);
    assert_eq!(log(&p), vec!["down 400 500", "move 410", "up 420"]);
    let f = p.frame().clone();
    // Particles at the press point, camera applied, below the HUD.
    let circles: Vec<_> = f.ops.iter().filter_map(|o| if let DrawOp::Circle(c) = o { Some(c) } else { None }).collect();
    assert_eq!(circles.len(), 8);
    assert!(circles.iter().all(|c| (c.x, c.y, c.opacity) == (300.0, 500.0, 1.0)));
    assert!(matches!(f.ops.last(), Some(DrawOp::Rect(r)) if r.w == 40.0));
    assert_eq!(f.haptics, vec![mg_core::frame::Haptic::Light]);
    assert_eq!(f.audio.len(), 2);
    assert_eq!(f.audio[0].kind, SoundKind::Sample { asset: 1, rate: 1.0 });
    assert_eq!(f.audio[0].volume, 0.8);
    assert!(matches!(&f.audio[1].kind, SoundKind::Synth { freqs, step_ms, .. } if freqs.len() == 3 && *step_ms == 70.0));
    assert_eq!(f.audio[1].ms, 210.0);
    // Particles keep the frame live until they fade, then it caches again.
    let n = p.build_count();
    p.step(100.0);
    p.frame();
    assert_eq!(p.build_count(), n + 1);
    for _ in 0..10 {
        p.step(100.0);
        p.frame();
    }
    assert!(!p.frame().ops.iter().any(|o| matches!(o, DrawOp::Circle(_))));
    assert!(p.diagnostics().is_empty(), "{:?}", p.diagnostics());
}

#[test]
fn v2_sprite_frames_follow_the_presentation_clock() {
    let mut p = compile(SCROLLER);
    let frame_of = |p: &mut Player| match p.frame().ops[1] {
        DrawOp::Image(ref i) => i.frame,
        ref o => panic!("{o:?}"),
    };
    assert_eq!(frame_of(&mut p), 0);
    p.step(100.0);
    assert_eq!(frame_of(&mut p), 0);
    p.step(30.0);
    assert_eq!(frame_of(&mut p), 1);
    let n = p.build_count();
    p.step(50.0);
    assert_eq!(frame_of(&mut p), 1);
    assert_eq!(p.build_count(), n, "no rebuild until the next sprite frame");
    p.step(400.0); // 580 ms → frame 4 % 4 = 0
    assert_eq!(frame_of(&mut p), 0);
}

// ── v0.2.1 end to end ───────────────────────────────────────────────────────

const HOLDER: &str = r##"{
  "format": "microgame/0.2",
  "meta": { "title": "Holder", "instructions": "Hold the buttons." },
  "state": {
    "cam": { "type": "float", "init": "100.0" },
    "log": { "type": "list<string>", "init": "[]" }
  },
  "inputs": {
    "hold": { "payload": { "on": "bool", "x": "float" } },
    "tapped": { "payload": {} },
    "rel": { "payload": { "x": "float" } },
    "pup": { "payload": {}, "from": [ { "pointer": "up" } ] }
  },
  "rules": [
    { "id": "h", "on": "hold", "do": [ { "push": "log", "value": "'hold ' + str(event.on) + ' ' + str(event.x)" } ] },
    { "id": "t", "on": "tapped", "do": [ { "push": "log", "value": "'tap'" } ] },
    { "id": "r", "on": "rel", "do": [ { "push": "log", "value": "'rel ' + str(event.x)" } ] },
    { "id": "p", "on": "pup", "do": [ { "push": "log", "value": "'pup'" } ] }
  ],
  "objectives": { "win": "len(log) >= 100" },
  "presentation": {
    "canvas": { "w": 360, "h": 640, "background": "#000" },
    "camera": { "x": "= cam", "y": 0 },
    "root": { "node": "group", "children": [
      { "node": "rect", "x": 200, "y": 100, "w": 50, "h": 50,
        "on_release": { "input": "rel", "with": { "x": "pointer.x" } } },
      { "node": "group", "fixed": true, "children": [
        { "node": "rect", "x": 0, "y": 0, "w": 40, "h": 40,
          "on_press": { "input": "hold", "with": { "on": "true", "x": "pointer.x" } },
          "on_release": { "input": "hold", "with": { "on": "false", "x": "pointer.x" } },
          "on_tap": { "input": "tapped" } },
        { "node": "text", "x": 0, "y": 300, "w": 60, "size": 10, "wrap": true, "align": "left",
          "text": "the quick brown fox jumps", "color": "#fff", "stroke": "#000" },
        { "node": "text", "x": 0, "y": 400, "w": 60, "h": 20, "size": 10, "wrap": true,
          "text": "= 'n' + str(len(log))", "stroke": "#f00", "stroke_width": 4 },
        { "node": "text", "x": 0, "y": 500, "size": 10, "text": "plain\nlines" }
      ] }
    ] },
    "feedback": [
      { "on": "hold", "when": "event.on", "do": [ { "haptic": "light" } ] },
      { "on": "hold", "when": "not event.on and len(log) > 0", "do": [ { "haptic": "heavy" } ] },
      { "on": "hold", "when": "len(log) > 50", "do": [ { "toast": { "text": "never" } } ] },
      { "on": "rel", "do": [ { "haptic": "success" } ] }
    ]
  }
}"##;

#[test]
fn v21_press_and_release_hold_buttons() {
    use mg_core::frame::Haptic;
    let mut p = compile(HOLDER);
    p.frame();
    // A fixed button: press (and tap) on down, release on up wherever it is.
    p.pointer(PointerKind::Down, 10.0, 10.0);
    p.step(16.0);
    assert_eq!(log(&p), vec!["hold true 10", "tap"]);
    p.pointer(PointerKind::Move, 300.0, 500.0);
    p.pointer(PointerKind::Up, 300.0, 500.0);
    p.step(16.0);
    assert_eq!(log(&p), vec!["hold true 10", "tap", "hold false 300"], "the up is not a pointer source");
    // Feedback `when` sees event and state: light on press, heavy on release.
    assert_eq!(p.frame().haptics, vec![Haptic::Light, Haptic::Heavy]);
    assert!(p.frame().toasts.is_empty());

    // A world node with only on_release: pointer in world units at the up.
    p.pointer(PointerKind::Down, 110.0, 110.0);
    p.pointer(PointerKind::Up, 5.0, 600.0);
    p.step(16.0);
    assert_eq!(log(&p)[3..], ["rel 105"]);
    assert_eq!(p.frame().haptics, vec![Haptic::Success]);

    // A second down before the up releases the first press there.
    p.pointer(PointerKind::Down, 10.0, 10.0);
    p.pointer(PointerKind::Down, 110.0, 110.0);
    p.pointer(PointerKind::Up, 120.0, 110.0);
    p.step(16.0);
    assert_eq!(log(&p)[4..], ["hold true 10", "tap", "hold false 110", "rel 220"]);

    // Hit targets include press/release-only nodes.
    assert_eq!(p.hit_targets().len(), 2);

    // A restart cancels the press: the new game never sees the release.
    p.pointer(PointerKind::Down, 10.0, 10.0);
    p.step(16.0);
    p.restart(1);
    p.step(16.0);
    assert!(log(&p).is_empty());
    p.pointer(PointerKind::Up, 10.0, 10.0);
    p.step(16.0);
    assert_eq!(log(&p), vec!["pup"], "after a restart the up is a plain pointer up");
    assert!(p.diagnostics().is_empty(), "{:?}", p.diagnostics());
}

#[test]
fn v21_text_wrap_and_stroke_reach_the_frame() {
    let mut p = compile(HOLDER);
    let f = p.frame().clone();
    let t = texts(&f);
    assert_eq!(t.len(), 3);
    // Wrapped at spaces to 10 chars (size 10 → 6 units per char, w 60).
    assert_eq!(&*t[0].text, "the quick\nbrown fox\njumps");
    assert_eq!((t[0].w, t[0].h, t[0].line_height), (60.0, 37.5, 12.5));
    assert_eq!((t[0].stroke, t[0].stroke_width), (Some(0x0000_00FF), 2.0));
    // An explicit h wins; stroke_width is used as given.
    assert_eq!((&*t[1].text, t[1].h, t[1].stroke, t[1].stroke_width), ("n0", 20.0, Some(0xFF00_00FF), 4.0));
    // No wrap: `\n` still breaks lines; no stroke.
    assert_eq!((&*t[2].text, t[2].h, t[2].stroke, t[2].stroke_width), ("plain\nlines", 25.0, None, 0.0));
    // Bound text re-wraps when state changes.
    p.pointer(PointerKind::Down, 10.0, 10.0);
    p.step(16.0);
    assert_eq!(&*texts(p.frame())[1].text, "n2");
    assert!(p.diagnostics().is_empty(), "{:?}", p.diagnostics());
}
