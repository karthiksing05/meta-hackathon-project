//! v0.2 unit tests with hand-built IR: builtins, input sources, physics.

use super::*;

const PI: f64 = std::f64::consts::PI;

fn strs(xs: &[&str]) -> Value {
    Value::list(xs.iter().map(|x| Value::str(x)).collect())
}

fn approx(v: &Value, want: f64) -> bool {
    matches!(v, Value::Float(x) if (x - want).abs() < 1e-9)
}

// ───────────────────────────── builtins ─────────────────────────────

#[test]
fn text_builtins_v02() {
    assert_eq!(ok(call(B::Split, vec![s("a,b,,c"), s(",")])), strs(&["a", "b", "", "c"]));
    assert_eq!(ok(call(B::Split, vec![s("hé!"), s("")])), strs(&["h", "é", "!"]));
    assert_eq!(ok(call(B::Split, vec![s(""), s(",")])), strs(&[""]));
    assert_eq!(ok(call(B::Split, vec![s(""), s("")])), strs(&[]));
    assert_eq!(ok(call(B::Split, vec![s("a--b"), s("--")])), strs(&["a", "b"]));

    assert_eq!(ok(call(B::Trim, vec![s(" \t hi there\n ")])), Value::str("hi there"));
    assert_eq!(ok(call(B::Trim, vec![s("\u{3000}x\u{a0}")])), Value::str("x"));
    assert_eq!(ok(call(B::Trim, vec![s("")])), Value::str(""));

    assert_eq!(ok(call(B::Substr, vec![s("héllo"), int(1), int(3)])), Value::str("él"));
    assert_eq!(ok(call(B::Substr, vec![s("abc"), int(-5), int(99)])), Value::str("abc"));
    assert_eq!(ok(call(B::Substr, vec![s("abc"), int(2), int(1)])), Value::str(""));
    assert_eq!(ok(call(B::Substr, vec![s("abc"), int(3), int(3)])), Value::str(""));

    assert_eq!(ok(call(B::StartsWith, vec![s("hello"), s("he")])), Value::Bool(true));
    assert_eq!(ok(call(B::StartsWith, vec![s("hello"), s("")])), Value::Bool(true));
    assert_eq!(ok(call(B::StartsWith, vec![s("he"), s("hello")])), Value::Bool(false));
    assert_eq!(ok(call(B::EndsWith, vec![s("hello"), s("llo")])), Value::Bool(true));
    assert_eq!(ok(call(B::EndsWith, vec![s("hello"), s("he")])), Value::Bool(false));

    assert_eq!(ok(call(B::Replace, vec![s("a-b-c"), s("-"), s("+")])), Value::str("a+b+c"));
    assert_eq!(ok(call(B::Replace, vec![s("aaa"), s("aa"), s("b")])), Value::str("ba"));
    assert_eq!(ok(call(B::Replace, vec![s("abc"), s(""), s("x")])), Value::str("abc"));
    assert_eq!(ok(call(B::Replace, vec![s("abc"), s("b"), s("")])), Value::str("ac"));

    for (src, want) in [
        (" 42 ", Some(42)),
        ("-7", Some(-7)),
        ("+3", Some(3)),
        ("007", Some(7)),
        ("-9223372036854775808", Some(i64::MIN)),
        ("9223372036854775808", None),
        ("4.5", None),
        ("", None),
        ("  ", None),
        ("-", None),
        ("1e3", None),
        ("1 2", None),
        ("٣", None),
    ] {
        let v = ok(call(B::ParseInt, vec![s(src)]));
        assert_eq!(v, want.map_or(Value::None, Value::Int), "parse_int({src:?})");
    }

    assert_eq!(ok(call(B::IndexOf, vec![s("héllo"), s("llo")])), i(2));
    assert_eq!(ok(call(B::IndexOf, vec![s("abcabc"), s("c")])), i(2));
    assert_eq!(ok(call(B::IndexOf, vec![s("abc"), s("z")])), i(-1));
    assert_eq!(ok(call(B::IndexOf, vec![s("abc"), s("")])), i(0));
    assert_eq!(ok(call(B::IndexOf, vec![ints(&[5, 6, 7]), int(7)])), i(2));
    assert_eq!(ok(call(B::IndexOf, vec![ints(&[5, 6, 7]), int(9)])), i(-1));
}

#[test]
fn math_builtins_v02() {
    assert_eq!(ok(call(B::Atan2, vec![flt(1.0), flt(1.0)])), f(PI / 4.0));
    assert_eq!(ok(call(B::Atan2, vec![int(0), int(-1)])), f(PI));
    assert_eq!(ok(call(B::Atan2, vec![flt(0.0), flt(0.0)])), f(0.0));
    assert_eq!(ok(call(B::Atan2, vec![flt(-1.0), flt(0.0)])), f(-PI / 2.0));

    assert_eq!(ok(call(B::Sign, vec![int(-5)])), i(-1));
    assert_eq!(ok(call(B::Sign, vec![int(0)])), i(0));
    assert_eq!(ok(call(B::Sign, vec![int(i64::MIN)])), i(-1));
    assert_eq!(ok(call(B::Sign, vec![flt(2.5)])), f(1.0));
    assert_eq!(ok(call(B::Sign, vec![flt(-0.1)])), f(-1.0));
    match ok(call(B::Sign, vec![flt(-0.0)])) {
        Value::Float(x) => assert!(x == 0.0 && x.is_sign_positive()),
        v => panic!("{v}"),
    }
    assert_eq!(ok(call(B::Sign, vec![flt(f64::NAN)])), f(0.0));

    assert_eq!(ok(call(B::Pow, vec![int(2), int(10)])), f(1024.0));
    assert_eq!(ok(call(B::Pow, vec![flt(3.0), flt(2.0)])), f(9.0));
    assert_eq!(ok(call(B::Pow, vec![flt(2.0), flt(-1.0)])), f(0.5));
    assert_eq!(ok(call(B::Pow, vec![flt(16.0), flt(0.5)])), f(4.0));
    assert!(approx(&ok(call(B::Pow, vec![flt(2.0), flt(0.25)])), 2f64.powf(0.25)));
    assert!(matches!(ok(call(B::Pow, vec![flt(-8.0), flt(0.5)])), Value::Float(x) if x.is_nan()));

    assert_eq!(ok(call(B::Fmod, vec![flt(7.5), flt(2.0)])), f(1.5));
    assert_eq!(ok(call(B::Fmod, vec![flt(-7.5), flt(2.0)])), f(-1.5));
    assert_eq!(ok(call(B::Fmod, vec![flt(7.5), flt(-2.0)])), f(1.5));
    assert_eq!(ok(call(B::Fmod, vec![int(7), int(3)])), f(1.0));
    assert!(err(call(B::Fmod, vec![flt(1.0), flt(0.0)])).contains("division by zero"));

    assert_eq!(ok(call(B::Angle, vec![iv(0, 1)])), f(PI / 2.0));
    assert_eq!(ok(call(B::Angle, vec![iv(-1, 0)])), f(PI));
    assert_eq!(ok(call(B::Angle, vec![Expr::Const(Value::Vec2(1.0, 1.0))])), f(PI / 4.0));
    assert_eq!(ok(call(B::FromAngle, vec![int(0)])), Value::Vec2(1.0, 0.0));
    match ok(call(B::FromAngle, vec![flt(PI / 2.0)])) {
        Value::Vec2(x, y) => assert!(x.abs() < 1e-15 && y == 1.0),
        v => panic!("{v}"),
    }
    match ok(call(B::Rotate, vec![iv(1, 0), flt(PI / 2.0)])) {
        Value::Vec2(x, y) => assert!(x.abs() < 1e-15 && (y - 1.0).abs() < 1e-15),
        v => panic!("{v}"),
    }
    assert_eq!(ok(call(B::Rotate, vec![Expr::Const(Value::Vec2(3.0, -2.0)), int(0)])), Value::Vec2(3.0, -2.0));
    match ok(call(B::Rotate, vec![Expr::Const(Value::Vec2(2.0, 0.0)), flt(PI)])) {
        Value::Vec2(x, y) => assert!((x + 2.0).abs() < 1e-15 && y.abs() < 1e-15),
        v => panic!("{v}"),
    }

    assert_eq!(ok(call(B::MinOf, vec![ints(&[3, 1, 2])])), i(1));
    assert_eq!(ok(call(B::MaxOf, vec![ints(&[3, 1, 2])])), i(3));
    assert_eq!(ok(call(B::MaxOf, vec![ints(&[-4])])), i(-4));
    let fl = Expr::Const(Value::list(vec![f(1.5), f(-2.0), f(0.5)]));
    assert_eq!(ok(call(B::MinOf, vec![fl.clone()])), f(-2.0));
    assert_eq!(ok(call(B::MaxOf, vec![fl])), f(1.5));
    assert!(err(call(B::MinOf, vec![ints(&[])])).contains("empty"));
    assert!(err(call(B::MaxOf, vec![ints(&[])])).contains("empty"));
    assert!(err(call(B::MaxOf, vec![Expr::Const(strs(&["a"]))])).contains("number"));
}

#[test]
fn chance_uses_one_draw() {
    for seed in 0..50u64 {
        for p in [0.0, 0.25, 0.5, 0.9, 1.0] {
            let mut r1 = Rng::new(seed);
            let mut r2 = Rng::new(seed);
            let v = ev_rng(&call(B::Chance, vec![flt(p)]), &mut r1).unwrap();
            let want = r2.next_f64() < p;
            assert_eq!(v, Value::Bool(want));
            assert_eq!(r1.next_u64(), r2.next_u64(), "exactly one draw");
            if p == 0.0 {
                assert_eq!(v, Value::Bool(false));
            }
            if p == 1.0 {
                assert_eq!(v, Value::Bool(true));
            }
        }
    }
    // Int argument is fine at runtime too.
    let mut r = Rng::new(3);
    assert_eq!(ev_rng(&call(B::Chance, vec![int(1)]), &mut r).unwrap(), Value::Bool(true));
    // Random: not allowed in pure contexts.
    assert!(err(call(B::Chance, vec![flt(0.5)])).contains("randomness"));
}

// ───────────────────────────── input sources ─────────────────────────────

fn key_rec_char() -> Expr {
    Expr::Field(Box::new(loc(0)), 0)
}
fn key_rec_code() -> Expr {
    Expr::Field(Box::new(loc(0)), 1)
}

#[test]
fn key_any_up_and_char() {
    let mut p = P::new();
    let last = p.state("last", Type::Str, s(""));
    let ups = p.state("ups", Type::Int, int(0));
    let jumps = p.state("jumps", Type::Int, int(0));
    // `typed`: any key down → "code/char".
    let typed = p.input("typed", 2, None);
    p.source(typed, SourceTrigger::Key { code: None, up: false }, vec![key_rec_code(), key_rec_char()]);
    // `release`: Space up only.
    let release = p.input("release", 0, None);
    p.source(release, SourceTrigger::Key { code: Some(Rc::from("Space")), up: true }, vec![]);
    // `jump`: matched by `KeyboardEvent.key` ("w") as well as code.
    let jump = p.input("jump", 0, None);
    p.source(jump, SourceTrigger::Key { code: Some(Rc::from("w")), up: false }, vec![]);
    p.rule(
        "t",
        Trigger::Input(typed),
        None,
        vec![set(last, call(B::Concat, vec![Expr::Event(0), s("/"), Expr::Event(1)]))],
    );
    p.rule("r", Trigger::Input(release), None, vec![incr(ups)]);
    p.rule("j", Trigger::Input(jump), None, vec![incr(jumps)]);
    let mut g = p.game(1);
    let get = |g: &Game, sid: StateId| g.state()[sid as usize].clone();

    assert!(g.key_event("KeyA", "A", true));
    g.step(1.0);
    assert_eq!(get(&g, last), Value::str("KeyA/A"));

    // Space down: only `typed` (release wants up).
    assert!(g.key_event("Space", " ", true));
    g.step(1.0);
    assert_eq!(get(&g, last), Value::str("Space/ "));
    assert_eq!(get(&g, ups), i(0));

    // Space up: only `release` (any-key source is a down source).
    assert!(g.key_event("Space", " ", false));
    g.step(1.0);
    assert_eq!(get(&g, ups), i(1));
    assert_eq!(get(&g, last), Value::str("Space/ "));

    // An up event with no up source matches nothing.
    assert!(!g.key_event("KeyA", "a", false));

    // `w` by char; `KeyW` alone (no char) does not match `jump` but matches `typed`.
    assert!(g.key_event("KeyW", "w", true));
    g.step(1.0);
    assert_eq!(get(&g, jumps), i(1));
    assert!(g.key("KeyW"));
    g.step(1.0);
    assert_eq!(get(&g, jumps), i(1));
    assert_eq!(get(&g, last), Value::str("KeyW/"));
    // Legacy `key(name)`: a down event with an empty char; `key("w")` matches by code.
    assert!(g.key("w"));
    g.step(1.0);
    assert_eq!(get(&g, jumps), i(2));
    assert!(g.take_diagnostics().is_empty());
}

#[test]
fn pointer_and_text_sources() {
    let mut p = P::new();
    let px = p.state("px", Type::Float, flt(0.0));
    let py = p.state("py", Type::Float, flt(0.0));
    let moves = p.state("moves", Type::Int, int(0));
    let word = p.state("word", Type::Str, s(""));
    let draft = p.state("draft", Type::Str, s(""));
    let tap = p.input("tap", 2, None);
    p.source(tap, SourceTrigger::Pointer(PointerPhase::Down), vec![
        Expr::Field(Box::new(loc(0)), 0),
        Expr::Field(Box::new(loc(0)), 1),
    ]);
    let drag = p.input("drag", 0, None);
    p.source(drag, SourceTrigger::Pointer(PointerPhase::Move), vec![]);
    let submit = p.input("submit", 1, None);
    p.source(submit, SourceTrigger::Text(TextPhase::Submit), vec![Expr::Field(Box::new(loc(0)), 0)]);
    let change = p.input("change", 1, None);
    p.source(change, SourceTrigger::Text(TextPhase::Change), vec![Expr::Field(Box::new(loc(0)), 0)]);
    p.rule("tap", Trigger::Input(tap), None, vec![set(px, Expr::Event(0)), set(py, Expr::Event(1))]);
    p.rule("drag", Trigger::Input(drag), None, vec![incr(moves)]);
    p.rule("submit", Trigger::Input(submit), None, vec![set(word, Expr::Event(0))]);
    p.rule("change", Trigger::Input(change), None, vec![set(draft, Expr::Event(0))]);
    let prog = Rc::new(p.0);
    let mut g = Game::new(prog.clone(), 1);
    let get = |g: &Game, sid: StateId| g.state()[sid as usize].clone();

    assert!(g.has_pointer_sources());
    assert!(g.has_source(|t| matches!(t, SourceTrigger::Text(TextPhase::Change))));
    assert!(!g.has_source(|t| matches!(t, SourceTrigger::Swipe(_))));

    assert!(g.pointer_source(PointerPhase::Down, 10.5, -3.25));
    assert!(!g.pointer_source(PointerPhase::Up, 1.0, 1.0));
    assert!(g.pointer_source(PointerPhase::Move, 1.0, 1.0));
    assert!(g.pointer_source(PointerPhase::Move, 2.0, 1.0));
    g.step(1.0);
    assert_eq!(get(&g, px), f(10.5));
    assert_eq!(get(&g, py), f(-3.25));
    assert_eq!(get(&g, moves), i(2));

    assert!(g.text(TextPhase::Change, "he"));
    assert!(g.text(TextPhase::Submit, "  héllo "));
    g.step(1.0);
    assert_eq!(get(&g, draft), Value::str("he"));
    assert_eq!(get(&g, word), Value::str("  héllo "));

    // No text_input spec: capped at MAX_TEXT_INPUT_LEN chars.
    let long: String = "é".repeat(300);
    assert!(g.text(TextPhase::Submit, &long));
    g.step(1.0);
    assert_eq!(get(&g, word), Value::str(&"é".repeat(mg_core::limits::MAX_TEXT_INPUT_LEN)));

    // With a spec, its max_len applies.
    let mut prog2 = (*prog).clone();
    prog2.text_input =
        Some(TextInputSpec { placeholder: Rc::from("Type"), max_len: 5, rect: None, size: None });
    let mut g = Game::new(Rc::new(prog2), 1);
    assert!(g.text(TextPhase::Submit, "abcdefgh"));
    assert!(g.text(TextPhase::Change, "abc"));
    g.step(1.0);
    assert_eq!(get(&g, word), Value::str("abcde"));
    assert_eq!(get(&g, draft), Value::str("abc"));
    assert!(g.take_diagnostics().is_empty());

    // A game without pointer sources says so.
    let g = P::new().game(1);
    assert!(!g.has_pointer_sources());
}

// ───────────────────────────── physics ─────────────────────────────

fn body_ty(names: &[&str]) -> Type {
    Type::record(names.iter().map(|n| (Rc::from(*n), Type::Float)).collect())
}

fn body(pairs: &[(&str, f64)]) -> Value {
    let mut v = pairs.to_vec();
    v.sort_by(|a, b| a.0.cmp(b.0));
    Value::record(v.into_iter().map(|(_, x)| Value::Float(x)).collect())
}

fn names<'a>(pairs: &[(&'a str, f64)]) -> Vec<&'a str> {
    pairs.iter().map(|(n, _)| *n).collect()
}

impl P {
    /// One record body.
    fn body(&mut self, name: &str, fields: &[(&str, f64)]) -> StateId {
        self.state(name, body_ty(&names(fields)), Expr::Const(body(fields)))
    }
    /// A list of bodies with the same fields.
    fn bodies(&mut self, name: &str, items: &[&[(&str, f64)]]) -> StateId {
        let ty = Type::list(body_ty(&names(items[0])));
        self.state(name, ty, Expr::Const(Value::list(items.iter().map(|f| body(f)).collect())))
    }
    fn physics(&mut self, gravity: (f64, f64), bounds: Option<(f64, f64, f64, f64)>) {
        self.0.physics = Some(Physics { gravity, bounds, bodies: vec![], collisions: vec![], on_bounds: vec![] });
    }
    fn group(&mut self, name: &str, state: StateId, opts: impl FnOnce(&mut BodyGroup)) -> BodyGroupId {
        let (rt, is_list) = match &self.0.state[state as usize].ty {
            Type::Record(r) => (r.clone(), false),
            Type::List(t) => match &**t {
                Type::Record(r) => (r.clone(), true),
                _ => panic!(),
            },
            _ => panic!(),
        };
        let idx = |n: &str| rt.index_of(n).map(|i| i as FieldIdx);
        let shape = match idx("r") {
            Some(r) => BodyShape::Circle { r },
            None => BodyShape::Rect { w: idx("w").unwrap(), h: idx("h").unwrap() },
        };
        let mut g = BodyGroup {
            name: Rc::from(name),
            state,
            is_list,
            x: idx("x").unwrap(),
            y: idx("y").unwrap(),
            vx: idx("vx"),
            vy: idx("vy"),
            shape,
            gravity_scale: if idx("vy").is_some() { 1.0 } else { 0.0 },
            is_static: false,
            bounded: false,
            bounce: 0.0,
            max_speed: None,
        };
        opts(&mut g);
        let ph = self.0.physics.as_mut().unwrap();
        ph.bodies.push(g);
        (ph.bodies.len() - 1) as BodyGroupId
    }
    fn collide(&mut self, a: BodyGroupId, b: BodyGroupId, solid: bool, bounce: f64, emit: Option<(EventId, Vec<ContactField>)>) {
        let emit = emit.map(|(event, fields)| PhysicsEmit { event, fields });
        self.0.physics.as_mut().unwrap().collisions.push(CollisionRule { a, b, solid, bounce, emit });
    }
    fn on_bounds(&mut self, body: BodyGroupId, event: EventId, fields: Vec<ContactField>) {
        self.0.physics.as_mut().unwrap().on_bounds.push(BoundsRule { body, emit: PhysicsEmit { event, fields } });
    }
}

/// Field `name` of the record (or list item `idx`) in state `sid`.
fn fld(g: &Game, sid: StateId, idx: Option<usize>, name: &str) -> f64 {
    let ty = &g.program().state[sid as usize].ty;
    let rt = match ty {
        Type::Record(r) => r,
        Type::List(t) => match &**t {
            Type::Record(r) => r,
            _ => panic!(),
        },
        _ => panic!(),
    };
    let fi = rt.index_of(name).unwrap();
    let rec = match (&g.state()[sid as usize], idx) {
        (Value::List(l), Some(k)) => l[k].clone(),
        (r, None) => r.clone(),
        _ => panic!(),
    };
    match rec {
        Value::Record(fs) => fs[fi].as_f64().unwrap(),
        _ => panic!(),
    }
}

fn events_of(f: &[Fired], ev: EventId) -> Vec<Vec<Value>> {
    f.iter().filter(|x| x.on == EventRef::Event(ev)).map(|x| x.payload.to_vec()).collect()
}

use ContactField::{Nx, Ny, A as CA, B as CB};

#[test]
fn falling_ball_hits_bounds() {
    let mut p = P::new();
    let ball = p.body("ball", &[("x", 180.0), ("y", 100.0), ("vx", 0.0), ("vy", 0.0), ("r", 10.0)]);
    let floor = p.event("floor", 3);
    let hits = p.state("hits", Type::Int, int(0));
    p.rule("f", Trigger::Event(floor), None, vec![incr(hits)]);
    p.physics((0.0, 1000.0), Some((0.0, 0.0, 360.0, 640.0)));
    let gb = p.group("ball", ball, |g| g.bounded = true);
    p.on_bounds(gb, floor, vec![CA, Nx, Ny]);
    let mut g = p.game(1);
    let mut first_hit = None;
    for step in 1..=120 {
        g.step(16.0);
        let y = fld(&g, ball, None, "y");
        assert!(y <= 630.0, "ball left the bounds: {y}");
        let fs = fired(&mut g);
        let ev = events_of(&fs, floor);
        if !ev.is_empty() && first_hit.is_none() {
            first_hit = Some(step);
            assert_eq!(ev, vec![vec![i(0), f(0.0), f(-1.0)]]);
        }
    }
    // Free fall of 520 px at 1000 px/s² takes about 1.02 s ≈ 64 steps.
    let s = first_hit.expect("ball never hit the floor");
    assert!((60..=70).contains(&s), "hit at step {s}");
    // Resting: clamped to the floor with vy reset (bounce 0) after each step.
    assert_eq!(fld(&g, ball, None, "y"), 630.0);
    assert_eq!(fld(&g, ball, None, "vy"), 0.0);
    assert_eq!(fld(&g, ball, None, "x"), 180.0);
    // The event fires every step while it rests (gravity pushes it into the edge).
    assert_eq!(g.state()[hits as usize], i(120 - s as i64 + 1));
    assert!(g.take_diagnostics().is_empty());
}

#[test]
fn solid_landing_on_static_platform() {
    let mut p = P::new();
    let player = p.body("player", &[("x", 200.0), ("y", 100.0), ("vx", 0.0), ("vy", 0.0), ("w", 20.0), ("h", 30.0)]);
    let plats = p.bodies(
        "platforms",
        &[
            &[("x", 50.0), ("y", 300.0), ("w", 80.0), ("h", 10.0)],
            &[("x", 200.0), ("y", 300.0), ("w", 100.0), ("h", 10.0)],
        ],
    );
    let land = p.event("land", 4);
    let landed = p.state("landed", Type::Int, int(0));
    p.rule("l", Trigger::Event(land), None, vec![incr(landed)]);
    p.physics((0.0, 1500.0), None);
    let gp = p.group("player", player, |_| {});
    let gs = p.group("platforms", plats, |g| g.is_static = true);
    p.collide(gp, gs, true, 0.0, Some((land, vec![CA, CB, Nx, Ny])));
    let mut g = p.game(1);
    let mut first = None;
    for step in 0..60 {
        g.step(16.0);
        let fs = fired(&mut g);
        let ev = events_of(&fs, land);
        if !ev.is_empty() {
            assert_eq!(ev, vec![vec![i(0), i(1), f(0.0), f(-1.0)]]);
            first.get_or_insert(step);
        }
    }
    assert!(first.is_some(), "never landed");
    // Standing on platform 1: bottom edge = platform top, vy reset.
    let y = fld(&g, player, None, "y");
    assert!((y + 15.0 - 295.0).abs() < 1e-9, "y = {y}");
    assert_eq!(fld(&g, player, None, "vy"), 0.0);
    assert_eq!(fld(&g, player, None, "x"), 200.0);
    // Static platforms never move.
    assert_eq!(fld(&g, plats, Some(1), "y"), 300.0);
    assert!(g.take_diagnostics().is_empty());
}

#[test]
fn bounce_off_bounds_and_solids() {
    // Bounds bounce: 2 sub-steps (travel 16 px, radius 10).
    let mut p = P::new();
    let ball = p.body("ball", &[("x", 50.0), ("y", 625.0), ("vx", 0.0), ("vy", 1000.0), ("r", 10.0)]);
    p.physics((0.0, 0.0), Some((0.0, 0.0, 360.0, 640.0)));
    p.group("ball", ball, |g| {
        g.bounded = true;
        g.bounce = 0.5;
    });
    let mut g = p.game(1);
    g.step(16.0);
    assert_eq!(fld(&g, ball, None, "vy"), -500.0);
    assert!((fld(&g, ball, None, "y") - 626.0).abs() < 1e-9);

    // Solid rule bounce 1: velocity into the contact is reversed.
    let mut p = P::new();
    let ball = p.body("ball", &[("x", 0.0), ("y", 0.0), ("vx", 30.0), ("vy", 100.0), ("r", 5.0)]);
    let wall = p.body("wall", &[("x", 0.0), ("y", 10.0), ("w", 100.0), ("h", 10.0)]);
    p.physics((0.0, 0.0), None);
    let gb = p.group("ball", ball, |_| {});
    let gw = p.group("wall", wall, |g| g.is_static = true);
    p.collide(gb, gw, true, 1.0, None);
    let mut g = p.game(1);
    g.step(16.0);
    assert_eq!(fld(&g, ball, None, "vy"), -100.0);
    assert_eq!(fld(&g, ball, None, "vx"), 30.0); // tangential velocity kept
    assert!(fld(&g, ball, None, "y") <= 0.0 + 1e-9);

    // The rule's bounce applies (mg-lang defaults it to the larger group bounce).
    let mut p = P::new();
    let ball = p.body("ball", &[("x", 0.0), ("y", 0.0), ("vx", 0.0), ("vy", 100.0), ("r", 5.0)]);
    let wall = p.body("wall", &[("x", 0.0), ("y", 10.0), ("w", 100.0), ("h", 10.0)]);
    p.physics((0.0, 0.0), None);
    let gb = p.group("ball", ball, |g| g.bounce = 0.9);
    let gw = p.group("wall", wall, |g| g.is_static = true);
    p.collide(gb, gw, true, 0.5, None);
    let mut g = p.game(1);
    g.step(16.0);
    assert_eq!(fld(&g, ball, None, "vy"), -50.0);

    // Two dynamic bodies split the push.
    let mut p = P::new();
    let a = p.body("a", &[("x", 0.0), ("y", 0.0), ("vx", 0.0), ("w", 10.0), ("h", 10.0)]);
    let b = p.body("b", &[("x", 6.0), ("y", 0.0), ("vx", 0.0), ("w", 10.0), ("h", 10.0)]);
    p.physics((0.0, 0.0), None);
    let ga = p.group("a", a, |_| {});
    let gb = p.group("b", b, |_| {});
    p.collide(ga, gb, true, 0.0, None);
    let mut g = p.game(1);
    g.step(16.0);
    assert_eq!(fld(&g, a, None, "x"), -2.0);
    assert_eq!(fld(&g, b, None, "x"), 8.0);
}

#[test]
fn overlap_emit_order() {
    let mut p = P::new();
    let player = p.body("player", &[("x", 100.0), ("y", 100.0), ("r", 10.0)]);
    let coins = p.bodies(
        "coins",
        &[
            &[("x", 105.0), ("y", 100.0), ("r", 5.0)],
            &[("x", 300.0), ("y", 100.0), ("r", 5.0)],
            &[("x", 100.0), ("y", 112.0), ("r", 5.0)],
        ],
    );
    let balls = p.bodies(
        "balls",
        &[
            &[("x", 0.0), ("y", 0.0), ("vx", 0.0), ("w", 10.0), ("h", 10.0)],
            &[("x", 500.0), ("y", 0.0), ("vx", 0.0), ("w", 10.0), ("h", 10.0)],
            &[("x", 504.0), ("y", 4.0), ("vx", 0.0), ("w", 10.0), ("h", 10.0)],
            &[("x", 5.0), ("y", 5.0), ("vx", 0.0), ("w", 10.0), ("h", 10.0)],
        ],
    );
    let got = p.event("got", 2);
    let touch = p.event("touch", 2);
    let edge = p.event("edge", 3);
    p.physics((0.0, 0.0), Some((-1000.0, -1000.0, 2000.0, 2000.0)));
    let gp = p.group("player", player, |_| {});
    let gc = p.group("coins", coins, |g| g.is_static = true);
    let gb = p.group("balls", balls, |g| g.bounded = true);
    // Declared first, but bounds events come before collision events.
    p.collide(gp, gc, false, 0.0, Some((got, vec![CA, CB])));
    p.collide(gb, gb, false, 0.0, Some((touch, vec![CA, CB])));
    p.on_bounds(gb, edge, vec![CA, Nx, Ny]);
    // Make ball 3 stick out of the left edge after the start.
    let mut g = p.game(1);
    let mut items = match &g.state()[balls as usize] {
        Value::List(l) => (**l).clone(),
        _ => panic!(),
    };
    items[3] = body(&[("x", -998.0), ("y", 5.0), ("vx", 0.0), ("w", 10.0), ("h", 10.0)]);
    items.push(body(&[("x", 3.0), ("y", -3.0), ("vx", 0.0), ("w", 10.0), ("h", 10.0)]));
    g.set_state_var(balls, Value::list(items));
    g.step(16.0);
    let fs = fired(&mut g);
    let seq: Vec<(EventRef, Vec<Value>)> = fs.iter().map(|x| (x.on, x.payload.to_vec())).collect();
    assert_eq!(
        seq,
        vec![
            (EventRef::Event(edge), vec![i(3), f(1.0), f(0.0)]),
            (EventRef::Event(got), vec![i(0), i(0)]),
            (EventRef::Event(got), vec![i(0), i(2)]),
            (EventRef::Event(touch), vec![i(0), i(4)]),
            (EventRef::Event(touch), vec![i(1), i(2)]),
        ]
    );
    // Ball 3 was clamped to the edge.
    assert_eq!(fld(&g, balls, Some(3), "x"), -995.0);
    // The same overlaps fire again next step, in the same order.
    g.step(16.0);
    let f2 = fired(&mut g);
    let seq2: Vec<(EventRef, Vec<Value>)> = f2.iter().map(|x| (x.on, x.payload.to_vec())).collect();
    assert_eq!(seq2[..], seq[1..]);
}

#[test]
fn list_group_with_removal_between_steps() {
    let mut p = P::new();
    let bullets = p.bodies(
        "bullets",
        &[
            &[("x", 0.0), ("y", 0.0), ("vx", 100.0), ("r", 1.0)],
            &[("x", 0.0), ("y", 10.0), ("vx", 200.0), ("r", 1.0)],
            &[("x", 0.0), ("y", 20.0), ("vx", 300.0), ("r", 1.0)],
        ],
    );
    let coins = p.bodies(
        "coins",
        &[&[("x", 50.0), ("y", 50.0), ("r", 5.0)], &[("x", 70.0), ("y", 50.0), ("r", 5.0)], &[("x", 90.0), ("y", 50.0), ("r", 5.0)]],
    );
    let picker = p.body("picker", &[("x", 50.0), ("y", 50.0), ("vx", 0.0), ("r", 2.0)]);
    let got = p.event("got", 1);
    // remove_at(coins, event.b)
    p.rule(
        "take",
        Trigger::Event(got),
        None,
        vec![set(coins, call(B::RemoveAt, vec![st(coins), Expr::Event(0)]))],
    );
    p.physics((0.0, 0.0), None);
    p.group("bullets", bullets, |_| {});
    let gc = p.group("coins", coins, |g| g.is_static = true);
    let gk = p.group("picker", picker, |_| {});
    p.collide(gk, gc, false, 0.0, Some((got, vec![CB])));
    let mut g = p.game(1);
    let len = |g: &Game, sid: StateId| match &g.state()[sid as usize] {
        Value::List(l) => l.len(),
        _ => panic!(),
    };

    g.step(10.0);
    assert_eq!(len(&g, coins), 2, "coin 0 taken");
    assert!((fld(&g, bullets, Some(1), "x") - 2.0).abs() < 1e-12);

    // Remove bullet 1 between steps; the others keep integrating.
    let mut items = match &g.state()[bullets as usize] {
        Value::List(l) => (**l).clone(),
        _ => panic!(),
    };
    items.remove(1);
    g.set_state_var(bullets, Value::list(items));
    g.step(10.0);
    assert_eq!(len(&g, bullets), 2);
    assert!((fld(&g, bullets, Some(0), "x") - 2.0).abs() < 1e-12);
    assert!((fld(&g, bullets, Some(1), "x") - 6.0).abs() < 1e-12);
    assert_eq!(fld(&g, bullets, Some(1), "y"), 20.0);

    // Move the picker onto what is now coin index 1 (x = 90).
    g.set_state_var(picker, body(&[("x", 90.0), ("y", 50.0), ("vx", 0.0), ("r", 2.0)]));
    g.step(10.0);
    assert_eq!(len(&g, coins), 1);
    assert_eq!(fld(&g, coins, Some(0), "x"), 70.0);
    // Empty list is fine.
    g.set_state_var(coins, Value::list(vec![]));
    g.set_state_var(bullets, Value::list(vec![]));
    g.step(10.0);
    assert!(g.take_diagnostics().is_empty());
}

#[test]
fn substeps_stop_tunnelling() {
    // Trigger: a 4000 px/s bullet (r = 4) against a 2 px wall. One 64 px
    // jump would skip it (45 → 109); 8 sub-steps of 8 px land on 101.
    let build = |vx: f64, x0: f64, solid: bool| {
        let mut p = P::new();
        let bullet = p.body("bullet", &[("x", x0), ("y", 0.0), ("vx", vx), ("r", 4.0)]);
        let wall = p.body("wall", &[("x", 100.0), ("y", 0.0), ("w", 2.0), ("h", 200.0)]);
        let hit = p.event("hit", 2);
        let hits = p.state("hits", Type::Int, int(0));
        p.rule("h", Trigger::Event(hit), None, vec![incr(hits)]);
        p.physics((0.0, 0.0), None);
        let gb = p.group("bullet", bullet, |_| {});
        let gw = p.group("wall", wall, |g| g.is_static = true);
        p.collide(gb, gw, solid, 0.0, Some((hit, vec![Nx, Ny])));
        (p.game(1), bullet, hits)
    };
    let (mut g, bullet, hits) = build(4000.0, 45.0, false);
    g.step(16.0);
    assert_eq!(g.state()[hits as usize], i(1), "bullet tunnelled");
    assert!((fld(&g, bullet, None, "x") - 109.0).abs() < 1e-9);

    // Solid: 2000 px/s = 32 px per step, 8 sub-steps of 4 px. One jump
    // (70 → 102) would push it out of the far side; sub-steps stop it in front.
    let (mut g, bullet, hits) = build(2000.0, 70.0, true);
    g.step(16.0);
    assert_eq!(g.state()[hits as usize], i(1));
    assert!((fld(&g, bullet, None, "x") - 95.0).abs() < 1e-9, "x = {}", fld(&g, bullet, None, "x"));
    assert_eq!(fld(&g, bullet, None, "vx"), 0.0);
    let fs = fired(&mut g);
    let hit = g.program().event_index("hit").unwrap();
    assert_eq!(events_of(&fs, hit), vec![vec![f(-1.0), f(0.0)]]);
}

#[test]
fn physics_max_speed_gravity_scale_and_static() {
    let mut p = P::new();
    let rock = p.body("rock", &[("x", 0.0), ("y", 0.0), ("vx", 300.0), ("vy", 0.0), ("r", 50.0)]);
    let feather = p.body("feather", &[("x", 0.0), ("y", 0.0), ("vx", 0.0), ("vy", 0.0), ("r", 50.0)]);
    let pin = p.body("pin", &[("x", 0.0), ("y", 0.0), ("vx", 5.0), ("vy", 0.0), ("r", 1.0)]);
    p.physics((0.0, 1000.0), None);
    p.group("rock", rock, |g| g.max_speed = Some(500.0));
    p.group("feather", feather, |g| g.gravity_scale = 0.1);
    p.group("pin", pin, |g| g.is_static = true);
    let mut g = p.game(1);
    for _ in 0..100 {
        g.step(16.0);
    }
    let (vx, vy) = (fld(&g, rock, None, "vx"), fld(&g, rock, None, "vy"));
    assert!(((vx * vx + vy * vy).sqrt() - 500.0).abs() < 1e-9);
    assert!((fld(&g, feather, None, "vy") - 160.0).abs() < 1e-9);
    assert_eq!(fld(&g, pin, None, "x"), 0.0);
    assert_eq!(fld(&g, pin, None, "vx"), 5.0);
}

#[test]
fn physics_errors_roll_back() {
    let mut p = P::new();
    let a = p.body("a", &[("x", 0.0), ("y", 0.0), ("vx", 10.0), ("r", 1.0)]);
    let b = p.body("b", &[("x", 0.0), ("y", 0.0), ("vx", 10.0), ("r", 1.0)]);
    p.physics((0.0, 0.0), None);
    p.group("a", a, |_| {});
    p.group("b", b, |_| {});
    let mut g = p.game(1);
    g.set_state_var(b, body(&[("x", f64::NAN), ("y", 0.0), ("vx", 10.0), ("r", 1.0)]));
    let h = g.state_hash();
    g.step(100.0);
    let d = g.take_diagnostics();
    assert_eq!(d.len(), 1, "{d:?}");
    assert_eq!(d[0].code, Code::Runtime);
    assert_eq!(d[0].at, "/physics");
    assert!(d[0].message.contains("body b: field 'x'"), "{}", d[0].message);
    // Group a was not moved either: the pseudo-rule is atomic.
    assert_eq!(fld(&g, a, None, "x"), 0.0);
    assert_ne!(g.state_hash(), h); // the clock moved
    // dt == 0: physics does not run.
    g.set_state_var(b, body(&[("x", 0.0), ("y", 0.0), ("vx", 10.0), ("r", 1.0)]));
    g.step(0.0);
    assert_eq!(fld(&g, a, None, "x"), 0.0);
    g.step(100.0);
    assert!((fld(&g, a, None, "x") - 1.0).abs() < 1e-12);
    assert!(g.take_diagnostics().is_empty());
}

/// A scene with random starting bodies, gravity, bounds, a solid self
/// collision and emits that change the score.
fn bouncy_scene(n: i64, solid: bool) -> (Program, StateId) {
    let mut p = P::new();
    let item_ty = body_ty(&["x", "y", "vx", "vy", "r"]);
    // fields sorted: r, vx, vy, x, y
    let mk = Expr::Record(
        vec![
            flt(6.0),
            call(B::RandomFloat, vec![flt(-200.0), flt(200.0)]),
            call(B::RandomFloat, vec![flt(-200.0), flt(200.0)]),
            call(B::RandomFloat, vec![flt(10.0), flt(350.0)]),
            call(B::RandomFloat, vec![flt(10.0), flt(630.0)]),
        ]
        .into_boxed_slice(),
    );
    let balls = p.state(
        "balls",
        Type::list(item_ty),
        call(B::Map, vec![call(B::Range, vec![int(n)]), lam(&[0], mk)]),
    );
    let score = p.state("score", Type::Int, int(0));
    let bump = p.event("bump", 2);
    let wall = p.event("wall", 1);
    p.rule("b", Trigger::Event(bump), None, vec![incr(score)]);
    // On a wall hit, kick the ball randomly (uses the RNG).
    p.rule(
        "w",
        Trigger::Event(wall),
        None,
        vec![set_path(
            balls,
            vec![PathStep::Index(Expr::Event(0)), PathStep::Field(1)],
            call(B::RandomFloat, vec![flt(-300.0), flt(300.0)]),
        )],
    );
    p.physics((0.0, 900.0), Some((0.0, 0.0, 360.0, 640.0)));
    let gb = p.group("balls", balls, |g| {
        g.bounded = true;
        g.bounce = 0.7;
        g.max_speed = Some(1200.0);
    });
    p.collide(gb, gb, solid, 0.3, Some((bump, vec![CA, CB])));
    p.on_bounds(gb, wall, vec![CA]);
    (p.0, score)
}

fn run_hashes(prog: &Rc<Program>, seed: u64, steps: usize) -> Vec<u64> {
    let mut g = Game::new(prog.clone(), seed);
    let mut out = Vec::new();
    for _ in 0..steps {
        g.step(16.0);
        out.push(g.state_hash());
    }
    assert!(g.take_diagnostics().iter().all(|d| d.code == Code::Limit), "unexpected diagnostics");
    out
}

#[test]
fn physics_is_deterministic() {
    let (prog, score) = bouncy_scene(60, true);
    let prog = Rc::new(prog);
    let a = run_hashes(&prog, 7, 200);
    let b = run_hashes(&prog, 7, 200);
    assert_eq!(a, b);
    let c = run_hashes(&prog, 8, 200);
    assert_ne!(a.last(), c.last());
    // Something actually happened.
    let mut g = Game::new(prog.clone(), 7);
    for _ in 0..200 {
        g.step(16.0);
    }
    assert!(matches!(g.state()[score as usize], Value::Int(n) if n > 0));
}

#[test]
fn sweep_matches_brute_force() {
    // > 32 bodies uses sort-and-sweep; the emit order must equal index-pair
    // order, the same as for a small group checked pair by pair.
    let (prog, _) = bouncy_scene(80, true);
    let prog = Rc::new(prog);
    let mut g = Game::new(prog.clone(), 3);
    for _ in 0..30 {
        g.step(16.0);
        let fs = fired(&mut g);
        let bump = prog.event_index("bump").unwrap();
        let pairs: Vec<(i64, i64)> = events_of(&fs, bump)
            .iter()
            .map(|p| (p[0].as_int().unwrap(), p[1].as_int().unwrap()))
            .collect();
        let mut sorted = pairs.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(pairs, sorted);
        assert!(pairs.iter().all(|(a, b)| a < b));
    }
    // Without solid pushes, the sweep finds exactly the brute-force pairs.
    let (prog, _) = bouncy_scene(120, false);
    let prog = Rc::new(prog);
    let sweep = run_hashes(&prog, 5, 100);
    crate::physics::FORCE_BRUTE.with(|f| f.set(true));
    let brute = run_hashes(&prog, 5, 100);
    crate::physics::FORCE_BRUTE.with(|f| f.set(false));
    assert_eq!(sweep, brute);
}

/// `cargo test -p mg-runtime --release --lib -- --ignored --nocapture bench_physics`
#[test]
#[ignore]
fn bench_physics() {
    for (n, solid, emits) in [(200i64, true, true), (200, false, true), (200, true, false), (200, false, false), (1000, true, false)] {
        let (mut prog, _) = bouncy_scene(n, solid);
        if !emits {
            let ph = prog.physics.as_mut().unwrap();
            ph.on_bounds.clear();
            ph.collisions[0].emit = None;
        }
        let prog = Rc::new(prog);
        let mut steps = 0u64;
        let t = std::time::Instant::now();
        let mut seed = 0;
        while t.elapsed().as_secs_f64() < 2.0 {
            let mut g = Game::new(prog.clone(), seed);
            seed += 1;
            for _ in 0..300 {
                g.step(16.0);
                steps += 1;
            }
        }
        let s = t.elapsed().as_secs_f64();
        eprintln!("{n}-body scene (solid: {solid}, emits: {emits}): {:.2} µs/step", s * 1e6 / steps as f64);
    }
}
