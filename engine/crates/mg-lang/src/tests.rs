//! Front-end tests: fixtures, broken games (spec B7), static checks.

use mg_core::ir::{Effect, Expr as IR};
use mg_core::{Code, Diagnostic};
use serde_json::{json, Value as J};

use crate::{compile, validate};

fn fixture(name: &str) -> String {
    let path = format!("{}/../../fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn show(d: &[Diagnostic]) -> String {
    d.iter()
        .map(|d| format!("{} {} {:?} {} | {:?}", d.code.as_str(), d.at, d.span, d.message, d.hint))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn fixtures_compile_clean() {
    for name in ["lights_out", "snake", "number_merge"] {
        let d = validate(&fixture(name));
        assert!(d.is_empty(), "{name}:\n{}", show(&d));
        assert!(compile(&fixture(name)).is_ok());
    }
}


fn errors(d: &[Diagnostic]) -> Vec<&Diagnostic> {
    d.iter().filter(|d| d.is_error()).collect()
}

/// Applies `f` to a parsed fixture and validates the result.
fn mutate(name: &str, f: impl FnOnce(&mut J)) -> Vec<Diagnostic> {
    let mut v: J = serde_json::from_str(&fixture(name)).unwrap();
    f(&mut v);
    validate(&v.to_string())
}

fn set(v: &mut J, pointer: &str, x: J) {
    *v.pointer_mut(pointer).unwrap_or_else(|| panic!("no {pointer}")) = x;
}

fn find<'a>(d: &'a [Diagnostic], code: Code, at: &str) -> &'a Diagnostic {
    d.iter().find(|x| x.code == code && x.at == at).unwrap_or_else(|| panic!("no {} at {at} in:\n{}", code.as_str(), show(d)))
}

/// A small valid game; `state`, `rules` and `extra` top-level keys are merged in.
fn game(state: J, rules: J, extra: J) -> String {
    let mut g = json!({
        "format": "microgame/0.1",
        "meta": { "title": "T", "instructions": "", "duration_s": 10 },
        "state": state,
        "events": { "ping": {}, "msg": { "text": "string" } },
        "inputs": { "tap": { "payload": { "cell": "ivec2" } } },
        "rules": rules,
        "objectives": { "time_limit": "10s" },
        "presentation": {
            "canvas": { "w": 100, "h": 100, "background": "#000" },
            "root": { "node": "group", "children": [] }
        }
    });
    for (k, v) in extra.as_object().unwrap() {
        g[k] = v.clone();
    }
    g.to_string()
}

/// One state variable `x: ty` initialized with `init`; returns errors.
fn init_errs(ty: &str, init: &str) -> Vec<Diagnostic> {
    let d = validate(&game(json!({ "res": { "type": ty, "init": init } }), json!([]), json!({})));
    d.into_iter().filter(|d| d.is_error()).collect()
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

// ── Spec B7: broken games ─────────────────────────────────────────────

#[test]
fn renamed_state_variable() {
    let d = mutate("lights_out", |v| {
        let s = v["state"].as_object_mut().unwrap();
        let board = s.remove("board").unwrap();
        s.insert("boards".into(), board);
    });
    let e = find(&d, Code::UnknownName, "/rules/1/do/0/to");
    assert_eq!(e.span, Some((6, 11)));
    assert_eq!(e.message, "unknown name 'board'");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'boards'?"));
    // Both uses in one expression are reported, plus every other place.
    let n = d.iter().filter(|x| x.at == "/rules/0/do/0/do/0/to").count();
    assert_eq!(n, 2, "{}", show(&d));
    find(&d, Code::UnknownName, "/rules/0/do/0/do/0/set");
    find(&d, Code::UnknownName, "/objectives/win");
    find(&d, Code::UnknownName, "/presentation/root/children/1/source");
    // Sorted by pointer, then span.
    let mut sorted = d.clone();
    sorted.sort_by(|a, b| a.at.cmp(&b.at).then(a.span.cmp(&b.span)));
    assert_eq!(sorted, d);
}

#[test]
fn bool_where_int_expected() {
    let d = mutate("lights_out", |v| set(v, "/rules/1/do/1", json!({ "incr": "moves", "by": "true" })));
    let e = find(&d, Code::TypeMismatch, "/rules/1/do/1/by");
    assert_eq!(e.span, Some((0, 4)));
    assert_eq!(e.message, "expected int, found bool");
    assert_eq!(errors(&d).len(), 1, "{}", show(&d));

    let d = mutate("snake", |v| set(v, "/rules/1/do/3/then/2/to", json!("pick(filter(coords(15, 15), c => true and 3))")));
    let e = find(&d, Code::TypeMismatch, "/rules/1/do/3/then/2/to");
    assert_eq!(e.span, Some((42, 43)));
    assert_eq!(e.message, "expected bool, found int");
}

#[test]
fn random_in_pure_contexts() {
    let d = mutate("snake", |v| set(v, "/rules/0/when", json!("random_int(0, 1) == 0")));
    let e = find(&d, Code::RandomInPure, "/rules/0/when");
    assert_eq!(e.span, Some((0, 10)));
    // Effects may use randomness (the fixtures do); objectives, functions,
    // input guards and presentation may not.
    let d = mutate("lights_out", |v| {
        set(v, "/objectives/score", json!("random_int(0, moves)"));
        set(v, "/functions/press/body", json!("shuffle([b])[0]"));
        set(v, "/presentation/root/children/2/text", json!("= str(random_float(0, 1))"));
        v["inputs"]["tap_cell"]["when"] = json!("pick([true, false])");
    });
    find(&d, Code::RandomInPure, "/objectives/score");
    find(&d, Code::RandomInPure, "/functions/press/body");
    find(&d, Code::RandomInPure, "/presentation/root/children/2/text");
    find(&d, Code::RandomInPure, "/inputs/tap_cell/when");
}

#[test]
fn recursion_is_reported() {
    let d = mutate("number_merge", |v| set(v, "/functions/merge_line/body", json!("if can_move(grid(1, 1, 0)) then merge_line(line) else merge_line(line)")));
    let e = d.iter().find(|x| x.code == Code::Recursion).unwrap_or_else(|| panic!("{}", show(&d)));
    // merge_line → can_move → merge_line, and merge_line → merge_line.
    assert!(d.iter().filter(|x| x.code == Code::Recursion).count() == 2, "{}", show(&d));
    assert!(e.span.is_some());
    assert!(d.iter().any(|x| x.message.contains("merge_line → can_move → merge_line")), "{}", show(&d));
}

#[test]
fn unknown_input_in_on_tap() {
    let d = mutate("lights_out", |v| set(v, "/presentation/root/children/1/cell/on_tap/input", json!("tap_cel")));
    let e = find(&d, Code::UnknownInput, "/presentation/root/children/1/cell/on_tap/input");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'tap_cell'?"));
}

#[test]
fn bad_emit_payload() {
    let d = mutate("number_merge", |v| set(v, "/rules/0/do/0", json!({ "emit": "spawn_tile", "with": { "spot": "vec(0, 0)" } })));
    let e = find(&d, Code::BadPayload, "/rules/0/do/0/with/spot");
    assert!(e.message.contains("no payload"), "{}", e.message);
    let d = validate(&game(json!({}), json!([{ "on": "start", "do": [{ "emit": "msg", "with": { "txt": "'hi'" } }] }]), json!({})));
    let e = find(&d, Code::BadPayload, "/rules/0/do/0/with/txt");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'text'?"));
    find(&d, Code::BadPayload, "/rules/0/do/0/with");
    let d = validate(&game(json!({}), json!([{ "on": "start", "do": [{ "emit": "msg", "with": { "text": "3" } }] }]), json!({})));
    find(&d, Code::TypeMismatch, "/rules/0/do/0/with/text");
}

#[test]
fn no_end_condition() {
    let d = mutate("lights_out", |v| {
        let o = v["objectives"].as_object_mut().unwrap();
        o.remove("win");
        o.remove("time_limit");
    });
    find(&d, Code::NoEndCondition, "/objectives");
    // An `end` effect is enough.
    let d = mutate("lights_out", |v| {
        let o = v["objectives"].as_object_mut().unwrap();
        o.remove("win");
        o.remove("time_limit");
        set(v, "/rules/1/do/1", json!({ "end": "win" }));
    });
    assert!(errors(&d).is_empty(), "{}", show(&d));
}

#[test]
fn many_errors_in_one_file() {
    let d = mutate("snake", |v| {
        set(v, "/rules/0/do/0", json!({ "set": "next_dir", "tO": "event.dir" }));
        set(v, "/rules/1/do/1", json!({ "let": { "head": "snake[0] + dirr" } }));
        set(v, "/objectives/win", json!("score >= '10'"));
        set(v, "/presentation/root/children/1/cell/fill", json!("= if cell == food then $fod else $empty"));
        set(v, "/format", json!("microgame/9"));
    });
    let e = find(&d, Code::BadField, "/rules/0/do/0/tO");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'to'?"));
    let e = find(&d, Code::UnknownName, "/rules/1/do/1/let/head");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'dir'?"));
    assert_eq!(e.span, Some((11, 15)));
    find(&d, Code::TypeMismatch, "/objectives/win");
    let e = find(&d, Code::UnknownName, "/presentation/root/children/1/cell/fill");
    assert_eq!(e.hint.as_deref(), Some("did you mean '$food'?"));
    find(&d, Code::Format, "/format");
    // No cascades: `head` is still typed after the error (as unknown), and
    // the misspelled 'to' doesn't also produce "missing 'to'".
    assert_eq!(errors(&d).len(), 5, "{}", show(&d));
}

// ── Static checks ─────────────────────────────────────────────────────

#[test]
fn unreachable_and_unused() {
    let g = game(
        json!({ "a": { "type": "int", "init": "0" }, "b": { "type": "int", "init": "0" } }),
        json!([
            { "id": "r0", "on": "ping", "do": [{ "set": "b", "to": "a + 1" }] },
            { "id": "r1", "on": "tap", "when": "false", "do": [] }
        ]),
        json!({}),
    );
    let d = validate(&g);
    assert!(errors(&d).is_empty(), "{}", show(&d));
    find(&d, Code::UnreachableRule, "/rules/0/on");
    find(&d, Code::UnreachableRule, "/rules/1/when");
    find(&d, Code::UnusedState, "/state/b");
    assert!(!d.iter().any(|x| x.at == "/state/a"));
    // Warnings alone still compile.
    assert!(compile(&g).is_ok());
}

#[test]
fn shadowing_and_assignability() {
    let rules = json!([{ "on": "tap", "do": [
        { "let": { "score": "1" } },
        { "set": "len(xs)", "to": "1" },
        { "set": "event.cell", "to": "vec(0, 0)" },
        { "set": "p.x", "to": "1" },
        { "set": "nope", "to": "1" },
        { "set": "xs[0]", "to": "map(xs, score => score)[0]" }
    ] }]);
    let state = json!({ "score": { "type": "int", "init": "0" }, "xs": { "type": "list<int>", "init": "[]" }, "p": { "type": "ivec2", "init": "vec(0, 0)" } });
    let d = validate(&game(state, rules, json!({})));
    find(&d, Code::ShadowsState, "/rules/0/do/0/let/score");
    find(&d, Code::NotAssignable, "/rules/0/do/1/set");
    find(&d, Code::NotAssignable, "/rules/0/do/2/set");
    find(&d, Code::NotAssignable, "/rules/0/do/3/set");
    find(&d, Code::UnknownName, "/rules/0/do/4/set");
    find(&d, Code::ShadowsState, "/rules/0/do/5/to");
}

#[test]
fn unknown_triggers_and_events() {
    let rules = json!([
        { "on": "tapp", "do": [] },
        { "on": "pingg", "do": [] },
        { "on": "start", "do": [{ "emit": "tap" }, { "emit": "pong" }, { "after": "1s", "emit": "ping", "id": "t" }, { "cancel": "u" }] }
    ]);
    let d = validate(&game(json!({}), rules, json!({})));
    let e = find(&d, Code::UnknownInput, "/rules/0/on");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'tap'?"));
    find(&d, Code::UnknownEvent, "/rules/1/on");
    find(&d, Code::UnknownEvent, "/rules/2/do/0/emit");
    find(&d, Code::UnknownEvent, "/rules/2/do/1/emit");
    let e = find(&d, Code::UnknownName, "/rules/2/do/3/cancel");
    assert_eq!(e.hint.as_deref(), Some("did you mean 't'?"));
}

#[test]
fn bad_fields_and_duplicates() {
    let d = validate(&game(
        json!({ "x": { "type": "int", "init": "0", "intt": 1 } }),
        json!([{ "on": "tap", "doo": [] }, { "on": "tap", "do": [{ "incr": "x", "byy": "2" }, { "sett": "x" }, { "end": "won" }] }]),
        json!({ "events": { "tap": {} }, "objectives": { "time_limit": "10s", "loose": "x > 3" } }),
    ));
    find(&d, Code::BadField, "/state/x/intt");
    find(&d, Code::BadField, "/rules/0/doo");
    find(&d, Code::BadField, "/rules/1/do/0/byy");
    let e = find(&d, Code::BadField, "/rules/1/do/1/sett");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'set'?"));
    find(&d, Code::BadField, "/rules/1/do/2/end");
    find(&d, Code::BadField, "/objectives/loose");
    find(&d, Code::Duplicate, "/inputs/tap");
}

#[test]
fn duplicate_json_keys() {
    let src = game(json!({ "score": { "type": "int", "init": "0" } }), json!([]), json!({}))
        .replacen("\"score\":{", "\"score\":{\"type\":\"int\",\"init\":\"1\"},\"score\":{", 1);
    let d = validate(&src);
    let e = find(&d, Code::Duplicate, "/state/score");
    assert!(e.message.contains("appears twice"));
}

#[test]
fn function_name_instead_of_lambda() {
    let d = mutate("lights_out", |v| set(v, "/objectives/win", json!("all(values(board), press)")));
    let e = find(&d, Code::BadLambda, "/objectives/win");
    assert_eq!(e.hint.as_deref(), Some("write x => press(x)"));
    assert_eq!(errors(&d).len(), 1, "{}", show(&d));
}

#[test]
fn format_and_json_errors() {
    let d = validate("{ not json");
    assert_eq!(d[0].code, Code::Parse);
    let d = validate("[1]");
    assert_eq!(d[0].code, Code::Parse);
    let mut v: J = serde_json::from_str(&game(json!({}), json!([]), json!({}))).unwrap();
    v.as_object_mut().unwrap().remove("format");
    let d = validate(&v.to_string());
    find(&d, Code::Format, "/format");
}

// ── Typing ────────────────────────────────────────────────────────────

#[test]
fn typing_basics() {
    ok("int", "1 + 2 * 3 - 7 / 2 % 2");
    ok("float", "1 + 2");
    ok("float", "1 / 2.0");
    ok("bool", "not 1 == 2 and 'a' < 'b'");
    ok("string", "'a' + str(1)");
    ok("ivec2", "vec(1, 2) + up * 2 - right");
    ok("vec2", "vec(1, 2.5) * 2");
    ok("vec2", "vec(1, 2)");
    ok("float", "vec(1, 2).x + vec(1.0, 2.0).y");
    ok("list<int>", "[]");
    ok("list<float>", "[1, 2.5]");
    ok("int?", "none");
    ok("int?", "3");
    ok("int?", "if true then 1 else none");
    ok("set<string>", "set_of([])");
    ok("map<string, int>", "map_of([['a', 0], ['b', 1]])");
    ok("map<string, int>", "put(map_of([]), 'a', 1)");
    ok("{x: int, y: float}", "{y: 1, x: 2}");
    ok("{x: int, y: float}", "let r = {x: 1, y: 2.0} in {...r, y: 3}");
    ok("int", "let a = 1 in let b = a + 1 in b * 2");
    ok("float", "fold([1, 2], 0, (acc, v) => acc + v * 0.5)");
    ok("list<int>", "map(range(3), (v, i) => v + i)");
    ok("grid<int>", "grid_map(grid(2, 2, false), (v, c) => if v then c.x else c.y)");
    ok("grid<bool>", "grid_map(grid(2, 2, false), v => not v)");
    ok("int", "min(1, 2, 3) + max(1, 2) + len('abc') + len([1]) + len(set_of([1]))");
    ok("float", "max(1, 2.5)");
    ok("list<int>", "concat([1], [], [2])");
    ok("string", "concat('a', 'b')");
    ok("string", "reverse('abc')");
    ok("int", "or_else(find([1, 2], x => x > 1), 0)");
    ok("int", "get_or([1, 2], 5, 0) + get_or(map_of([['a', 1]]), 'b', 0) + get_or(grid(1, 1, 0), vec(3, 3), 0)");
    ok("list<{a: int, b: string}>", "zip([1], ['x'])");
    ok("list<int>", "range(2, 5)");
    ok("int", "random_int(1, 6)");
    ok("int", "weighted([2, 4], [9, 1])");
    ok("list<list<ivec2>>", "lines(grid(4, 4, 0), left)");
    ok("int", "now");
}

#[test]
fn typing_errors() {
    let e = bad("int", "1.5", Code::TypeMismatch);
    assert_eq!(e.hint.as_deref(), Some("use floor(x), ceil(x) or round(x) to get an int"));
    let e = bad("int", "find([1], x => x > 0)", Code::TypeMismatch);
    assert!(e.hint.as_deref().unwrap().contains("or_else"), "{e:?}");
    bad("int", "none", Code::TypeMismatch);
    bad("float", "1.5 % 2", Code::TypeMismatch);
    bad("string", "'a' + 1", Code::TypeMismatch);
    bad("ivec2", "vec(1, 2) + vec(1.5, 2)", Code::TypeMismatch);
    bad("int", "if true then 1 else 'a'", Code::TypeMismatch);
    bad("list<int>", "[1, 'a']", Code::TypeMismatch);
    bad("bool", "1 == 'a'", Code::TypeMismatch);
    bad("int", "len(5)", Code::TypeMismatch);
    bad("int", "len()", Code::TypeMismatch);
    bad("int", "map([1], x => x)", Code::TypeMismatch);
    bad("list<int>", "map([1], (a, b, c) => a)", Code::BadLambda);
    bad("list<int>", "[x => x]", Code::BadLambda);
    bad("int", "len(x => x)", Code::BadLambda);
    bad("list<int>", "map([1], 3)", Code::BadLambda);
    bad("int", "fold([1], 0, x => x)", Code::BadLambda);
    bad("int", "event.cell", Code::UnknownName);
    bad("int", "x", Code::UnknownName);
    bad("int", "nope(1)", Code::UnknownName);
    bad("int", "len", Code::TypeMismatch);
    bad("int", "$bg", Code::UnknownName);
    bad("int", "status", Code::UnknownName);
    bad("{x: int}", "{x: 1, y: 2}", Code::TypeMismatch);
    bad("{x: int, y: int}", "{x: 1}", Code::TypeMismatch);
    bad("{x: int}", "{x: 1, x: 2}", Code::Duplicate);
    bad("int", "vec(1, 2).z", Code::UnknownName);
    bad("int", "let r = {a: 1} in r.b", Code::UnknownName);
    bad("int", "1 +", Code::Parse);
    bad("lisst<int>", "[]", Code::UnknownName);
    bad("list<int", "[]", Code::Parse);
    bad("int??", "1", Code::Parse);
    bad("set<int>", "[]", Code::TypeMismatch);
    bad("int", "'a' < 1", Code::TypeMismatch);
}

#[test]
fn enums() {
    let t = r#"{"enum": ["waiting", "ready"]}"#;
    let ty: J = serde_json::from_str(t).unwrap();
    let mk = |init: &str, rules: J| {
        validate(&game(json!({ "phase": { "type": ty.clone(), "init": init } }), rules, json!({})))
            .into_iter()
            .filter(|d| d.is_error())
            .collect::<Vec<_>>()
    };
    assert!(mk("'ready'", json!([])).is_empty());
    let e = mk("'reddy'", json!([]));
    assert_eq!(e[0].hint.as_deref(), Some("did you mean 'ready'?"), "{}", show(&e));
    let e = mk("'ready'", json!([{ "on": "tap", "when": "phase == 'wating'", "do": [{ "set": "phase", "to": "if phase == 'ready' then 'waiting' else 'ready'" }] }]));
    assert_eq!(e.len(), 1, "{}", show(&e));
    assert_eq!(e[0].at, "/rules/0/when");
    assert_eq!(e[0].span, Some((9, 17)));
}

#[test]
fn widening_inserts_to_float() {
    let g = game(
        json!({ "a": { "type": "int", "init": "1" }, "b": { "type": "float", "init": "a" }, "c": { "type": "float", "init": "a * 0.5" } }),
        json!([{ "on": "tap", "do": [{ "incr": "b", "by": "a" }, { "set": "c", "to": "c + b" }] }]),
        json!({}),
    );
    let p = compile(&g).unwrap_or_else(|d| panic!("{}", show(&d))).program;
    assert!(matches!(&p.state[1].init, IR::ToFloat(x) if matches!(**x, IR::State(0))));
    assert!(matches!(&p.state[2].init, IR::Binary(_, l, _) if matches!(**l, IR::ToFloat(_))));
    let Effect::Set { value: IR::Binary(_, _, by), .. } = &p.rules[0].body[0] else { panic!() };
    assert!(matches!(**by, IR::ToFloat(_)));
}

#[test]
fn state_init_order_and_events() {
    let d = validate(&game(
        json!({ "a": { "type": "int", "init": "b" }, "b": { "type": "int", "init": "a + 1" } }),
        json!([
            { "on": "start", "do": [{ "set": "a", "to": "event.x" }] },
            { "on": "tick", "do": [{ "set": "a", "to": "floor(event.dt)" }] },
            { "on": "tap", "do": [{ "set": "a", "to": "event.t + event.cell.x" }, { "emit": "msg", "with": { "text": "str(event.cel)" } }] },
            { "on": "msg", "do": [{ "set": "a", "to": "len(event.text)" }] }
        ]),
        json!({}),
    ));
    let e = errors(&d);
    let ats: Vec<&str> = e.iter().map(|d| d.at.as_str()).collect();
    assert_eq!(ats, ["/rules/0/do/0/to", "/rules/2/do/1/with/text", "/state/a/init"], "{}", show(&d));
    assert_eq!(e[1].hint.as_deref(), Some("did you mean 'cell'?"));
}

#[test]
fn effects_lowering() {
    let g = game(
        json!({
            "xs": { "type": "list<{y: float}>", "init": "[]" },
            "s": { "type": "set<int>", "init": "set_of([])" },
            "g": { "type": "grid<int>", "init": "grid(3, 3, 0)" },
            "n": { "type": "int", "init": "0" }
        }),
        json!([{ "on": "tap", "do": [
            { "push": "xs", "value": "{y: 1}" },
            { "push": "s", "item": "2" },
            { "remove": "xs", "where": "m => m.y > 700" },
            { "remove": "s", "value": "2" },
            { "incr": "g[event.cell]", "by": "2" },
            { "for_each": "s", "as": "v", "do": [{ "incr": "n", "by": "v" }] },
            { "if": "n > 3", "then": [{ "let": { "k": "n", "j": "k + 1" } }, { "set": "n", "to": "j" }], "else": [{ "decr": "n" }] },
            { "after": "150ms", "emit": "ping", "id": "p" },
            { "cancel": "p" }
        ] }, { "on": "ping", "do": [] }]),
        json!({}),
    );
    let c = compile(&g).unwrap_or_else(|d| panic!("{}", show(&d)));
    let p = c.program;
    assert_eq!(p.timer_names.len(), 1);
    let body = &p.rules[0].body;
    // incr g[event.cell] hoists the index into a let.
    assert!(matches!(body[4], Effect::Let { .. }));
    assert!(matches!(&body[5], Effect::Set { value: IR::Binary(mg_core::ast::BinOp::Add, l, _), .. } if matches!(**l, IR::Index(_, ref i) if matches!(**i, IR::Local(_)))));
    assert!(matches!(body[2], Effect::Set { value: IR::Builtin(mg_core::builtins::Builtin::Filter, _), .. }));
    assert_eq!(p.dispatch.input[0], vec![0]);
    assert_eq!(p.dispatch.event[0], vec![1]);
    // Every slot is below n_locals.
    assert_eq!(p.rules[0].n_locals, 5);
}

#[test]
fn presentation_checks() {
    let d = mutate("number_merge", |v| {
        set(v, "/presentation/root/children/0/color", json!("#12"));
        set(v, "/presentation/root/children/1/node", json!("groop"));
        set(v, "/presentation/canvas/background", json!("$bgg"));
        set(v, "/presentation/root/children/0/size", json!("26"));
        set(v, "/presentation/root/children/0/weight", json!("= len(board)"));
        set(v, "/presentation/feedback/0/on", json!("slid"));
        set(v, "/presentation/feedback/1/do/0", json!({ "sound": { "wave": "sqare", "note": "Z9", "ms": 10 } }));
        set(v, "/presentation/root/gap", json!("= 3"));
        set(v, "/presentation/root/dir", json!("rows"));
    });
    find(&d, Code::Presentation, "/presentation/root/children/0/color");
    let e = find(&d, Code::Presentation, "/presentation/root/children/1/node");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'group'?"));
    let e = find(&d, Code::UnknownName, "/presentation/canvas/background");
    assert_eq!(e.hint.as_deref(), Some("did you mean '$bg'?"));
    find(&d, Code::Presentation, "/presentation/root/children/0/size");
    find(&d, Code::TypeMismatch, "/presentation/root/children/0/weight");
    let e = find(&d, Code::UnknownInput, "/presentation/feedback/0/on");
    assert_eq!(e.hint.as_deref(), Some("did you mean 'slide'?"));
    find(&d, Code::Presentation, "/presentation/feedback/1/do/0/sound/wave");
    find(&d, Code::Presentation, "/presentation/feedback/1/do/0/sound/note");
    find(&d, Code::Presentation, "/presentation/root/gap");
    find(&d, Code::Presentation, "/presentation/root/dir");

    let d = mutate("lights_out", |v| {
        set(v, "/presentation/root/children/1/cell/animate_on", json!({ "tap_cell": { "when": "event.cel == cell", "prop": "scael", "keys": [1, 2], "ms": 10 }, "nope": {} }));
        set(v, "/presentation/root/children/1/cell/transition", json!({ "fil": { "ms": 1 } }));
        set(v, "/presentation/root/children/1/cell/on_tap/with", json!({ "cell": "value" }));
    });
    find(&d, Code::UnknownName, "/presentation/root/children/1/cell/animate_on/tap_cell/when");
    find(&d, Code::Presentation, "/presentation/root/children/1/cell/animate_on/tap_cell/prop");
    find(&d, Code::UnknownInput, "/presentation/root/children/1/cell/animate_on/nope");
    find(&d, Code::Presentation, "/presentation/root/children/1/cell/transition/fil");
    find(&d, Code::TypeMismatch, "/presentation/root/children/1/cell/on_tap/with/cell");
}

#[test]
fn presentation_lowering() {
    use mg_core::scene::{NodeKind, Prop};
    use mg_core::value::Value;
    let p = compile(&fixture("number_merge")).ok().unwrap().program;
    let pres = &p.presentation;
    assert!(matches!(&pres.canvas.background, Prop::Const(Value::Str(s)) if &**s == "#F3F1FA"));
    let NodeKind::Stack { children, gap, .. } = &pres.root.kind else { panic!() };
    assert_eq!(*gap, 24.0);
    let NodeKind::Group { children: g } = &children[1].kind else { panic!() };
    let NodeKind::Grid { cell, cell_slot, value_slot, cell_size, .. } = &g[1].kind else { panic!() };
    assert_eq!(*cell_size, 76.0);
    assert!(value_slot.is_some() && *cell_slot != pres.pointer_slot);
    let NodeKind::Group { children: cc } = &cell.kind else { panic!() };
    // `fill` with $tiles stays an expression; the token list is a constant.
    assert!(matches!(&cc[0].fill, Some(Prop::Expr(_))));
    assert_eq!(cc[0].animate_on.len(), 1);
    assert_eq!(cc[0].transitions.len(), 1);
    let NodeKind::Text { size, .. } = &cc[1].kind else { panic!() };
    assert!(matches!(size, Prop::Expr(_)));
    // Token folding: "$tiles[2]" as a literal prop.
    let d = mutate("number_merge", |v| set(v, "/presentation/root/children/1/children/0/fill", json!("$tiles[2]")));
    assert!(errors(&d).is_empty(), "{}", show(&d));
    let d = mutate("number_merge", |v| set(v, "/presentation/root/children/1/children/0/fill", json!("$tiles[20]")));
    find(&d, Code::Presentation, "/presentation/root/children/1/children/0/fill");
}

// ── Speed ─────────────────────────────────────────────────────────────

#[test]
#[ignore]
fn compile_speed() {
    for name in ["lights_out", "snake", "number_merge"] {
        let src = fixture(name);
        for _ in 0..50 {
            compile(&src).ok().unwrap();
        }
        let n = 2000;
        let t = std::time::Instant::now();
        for _ in 0..n {
            std::hint::black_box(compile(std::hint::black_box(&src)).ok().unwrap());
        }
        let per = t.elapsed().as_secs_f64() / n as f64 * 1e6;
        println!("{name}: {per:.1} µs per compile");
    }
}

