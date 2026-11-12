//! End-to-end tests on the Part C fixtures: compile with mg-lang, run with
//! mg-runtime, render with `Player`.
//!
//! Benchmark (release): `cargo test -p mg-scene --release --test fixtures -- --ignored --nocapture bench`

use std::rc::Rc;
use std::time::Instant;

use mg_core::frame::{DrawOp, Frame, RectOp, TextOp};
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
    assert!((f.audio[0].freq_hz - 659.255).abs() < 0.01);
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
}
