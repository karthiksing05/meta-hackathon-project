//! `microgame catalog`: everything an author (or an LLM prompt generator) can
//! use in a `microgame/0.2` file, as JSON. Builtins, constants and limits are
//! read from the mg-core sources (`include_str!`), so their names, docs and
//! values can't drift. The rest is a table checked against the parser's
//! keyword lists by `tests::catalog_matches_the_parser`.

use serde_json::{json, Value as J};

use mg_core::builtins::{Builtin, CONSTANTS};

const BUILTINS_SRC: &str = include_str!("../../mg-core/src/builtins.rs");
const LIMITS_SRC: &str = include_str!("../../mg-core/src/limits.rs");

/// `(category, name, doc)` for every builtin, in catalog order.
pub fn builtin_docs() -> Vec<(String, String, String)> {
    let start = BUILTINS_SRC.find("builtins! {").unwrap_or(0);
    let mut out = Vec::new();
    let mut category = String::new();
    let mut doc: Vec<String> = Vec::new();
    for line in BUILTINS_SRC[start..].lines().skip(1) {
        let t = line.trim();
        if t == "}" {
            break;
        }
        if let Some(c) = t.strip_prefix("// ──") {
            // `// ── v0.2: text ─────`
            category = c.trim_matches(|ch: char| ch == '─' || ch.is_whitespace()).to_string();
            if let Some(rest) = category.strip_prefix("v0.2: ") {
                category = rest.to_string();
            }
            category = category.split(' ').next().unwrap_or("").to_lowercase();
        } else if let Some(d) = t.strip_prefix("///") {
            doc.push(d.trim().to_string());
        } else if let Some((_, rest)) = t.split_once("= \"") {
            let name = rest.split('"').next().unwrap_or("").to_string();
            out.push((category.clone(), name, doc.join(" ")));
            doc.clear();
        } else if t.is_empty() {
            doc.clear();
        }
    }
    out
}

/// `(name, value, doc)` for every limit in `mg-core/src/limits.rs`.
pub fn limit_docs() -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    let mut doc: Vec<String> = Vec::new();
    for line in LIMITS_SRC.lines() {
        let t = line.trim();
        if let Some(d) = t.strip_prefix("///") {
            doc.push(d.trim().to_string());
        } else if let Some(rest) = t.strip_prefix("pub const ") {
            let name = rest.split(':').next().unwrap_or("").trim().to_string();
            let value = rest.split('=').nth(1).unwrap_or("").trim().trim_end_matches(';').trim().to_string();
            out.push((name, value, doc.join(" ")));
            doc.clear();
        } else if !t.starts_with("//") {
            doc.clear();
        }
    }
    out
}

/// Evaluates a limit's value text (`10_000`, `256 * 1024`) to a number.
fn limit_value(v: &str) -> J {
    let mut product: u64 = 1;
    for part in v.split('*') {
        match part.trim().replace('_', "").parse::<u64>() {
            Ok(n) => product = product.saturating_mul(n),
            Err(_) => return J::String(v.to_string()),
        }
    }
    J::from(product)
}

fn diag_codes() -> J {
    // (code, meaning). `tests` checks this covers every code in mg-core.
    let codes: &[(&str, &str)] = &[
        ("E_PARSE", "Malformed JSON, wrong JSON shape, or an expression that doesn't parse"),
        ("E_FORMAT", "Missing or wrong \"format\" (use \"microgame/0.1\" or \"microgame/0.2\")"),
        ("E_UNKNOWN_NAME", "A name that isn't a local, event field, state var, function, builtin, constant or token"),
        ("E_TYPE_MISMATCH", "A value of the wrong type"),
        ("E_NOT_ASSIGNABLE", "The target of set/incr/push/remove isn't a state var path"),
        ("E_RANDOM_IN_PURE", "A random builtin in when, objectives, functions, input guards or presentation"),
        ("E_RECURSION", "Functions calling themselves, directly or through others"),
        ("E_UNKNOWN_INPUT", "A rule, binding or animation names an input that isn't declared"),
        ("E_UNKNOWN_EVENT", "A rule, emit, after or feedback names an event that isn't declared"),
        ("E_BAD_PAYLOAD", "Missing, extra or mistyped payload fields (also physics emit payloads)"),
        ("E_SHADOWS_STATE", "A local variable has the same name as a state var"),
        ("E_NO_END_CONDITION", "No win, lose, time_limit or end effect"),
        ("E_BAD_FIELD", "A required field is missing, or an unknown field appears"),
        ("E_BAD_LAMBDA", "A lambda outside a call argument, or with the wrong number of parameters"),
        ("E_DUPLICATE", "A name declared twice"),
        ("E_PRESENTATION", "Bad node kind, prop, token, color or feedback action"),
        ("E_ASSET", "Bad asset: source, missing w/h, a sound used as an image, an unknown asset id, or too big"),
        ("E_PHYSICS", "Bad physics: group, missing or non-float field, no shape, or an unknown group"),
        ("E_RUNTIME", "Error while running (out of range, division by zero, ...); the rule is rolled back"),
        ("E_LIMIT", "An engine limit was exceeded; the rule is rolled back"),
        ("W_UNREACHABLE_RULE", "Warning: a rule can never fire"),
        ("W_UNUSED_STATE", "Warning: a state var is never read"),
        ("W_LINT", "Any other warning"),
    ];
    J::Array(
        codes
            .iter()
            .map(|(c, m)| json!({ "code": c, "severity": if c.starts_with("W_") { "warning" } else { "error" }, "meaning": m }))
            .collect(),
    )
}

fn nodes() -> J {
    json!({
        "common_props": {
            "id": "string",
            "x": "num (default 0), relative to the parent",
            "y": "num (default 0)",
            "anchor": "top_left (default) | center",
            "rotation": "degrees clockwise, around the center",
            "scale": "num (default 1), around the center",
            "opacity": "0..1 (default 1)",
            "visible": "bool (default true)",
            "fill": "color", "stroke": "color", "stroke_width": "num",
            "on_tap": "{input, with: {field: expr}}; with can read node locals and pointer (vec2)",
            "on_drag": "{input, with}; sent on down, every move and up",
            "on_press": "{input, with} (v0.2.1): sent on pointer down over the node",
            "on_release": "{input, with} (v0.2.1): sent when the pointer that pressed the node comes up, wherever it is, \
or when a restart cancels the press; pointer is the up position. With on_press: hold-to-move buttons",
            "transition": "{prop: {ms, ease}}: tween when a bound value changes",
            "animate_on": "{input|event|win|lose: {when, prop, keys: [...], ms, ease}}",
            "fixed": "bool (v0.2): ignores the camera, for the HUD; inherited by children",
        },
        "prop_values": "Literals unless they start with '=' (an expression bound to state). Tokens: $name, $list[i]",
        "colors": "#RGB, #RRGGBB, #RRGGBBAA or a token",
        "animatable_props": ["x", "y", "w", "h", "r", "radius", "rotation", "scale", "opacity", "fill", "stroke",
                             "stroke_width", "color", "size"],
        "eases": ["linear", "in", "out", "in_out", "spring"],
        "kinds": [
            { "node": "group", "props": {"children": "list of nodes, positioned relative to the group",
                "w": "num (v0.2.2, with h): an explicit box (0, 0, w, h) instead of the children's union",
                "h": "num (v0.2.2, with w)",
                "clip": "bool (v0.2.2, default false; needs w and h): children are drawn and hit-tested only inside the box"},
              "notes": "clip + an image with src_*: a zoomed crop; fixed children of a non-fixed group aren't clipped" },
            { "node": "stack", "props": {"dir": "row | column (default)", "gap": "num (default 0)",
                "align": "start | center (default) | end", "children": "list of nodes"},
              "notes": "size comes from the children" },
            { "node": "grid", "props": {"source": "= a grid in state (binds `value`)", "cols": "int (without source)",
                "rows": "int (without source)", "cell_size": "num (required)", "gap": "num (default 0)",
                "cell": "template node; origin = the cell's top-left"},
              "locals": ["cell (ivec2)", "value (with source)"],
              "notes": "size = cols*cell_size + (cols-1)*gap by rows*cell_size + (rows-1)*gap" },
            { "node": "repeat", "props": {"source": "= a list", "as": "item variable name",
                "key": "= stable identity for animations (default index)", "template": "node (alias: item)"},
              "locals": ["<as name>", "index (int)"] },
            { "node": "rect", "props": {"w": "num (required)", "h": "num (required)", "radius": "num"} },
            { "node": "circle", "props": {"r": "num (required)"}, "notes": "positioned by its center" },
            { "node": "text", "props": {"text": "string (required)", "size": "num (default 16)", "font": "string",
                "weight": "num | bold | normal", "color": "color", "w": "box width (optional)", "h": "box height (optional)",
                "align": "left | center (default) | right", "valign": "top | middle (default) | bottom",
                "wrap": "bool (v0.2.1, default false): break lines at spaces to fit w (required); h defaults to the wrapped height"},
              "notes": "stroke and stroke_width (default 2 with a stroke) draw an outline under the fill; \n starts a new line" },
            { "node": "image", "since": "0.2", "props": {"asset": "asset id (literal or = string expression)",
                "w": "num (default: the asset's w)", "h": "num (default: the asset's h)",
                "frame": "int (default floor(t * fps / 1000) % frames on the presentation clock)",
                "flip_x": "bool", "flip_y": "bool",
                "src_x": "num (v0.2.2, default 0): left of the drawn part of the frame, in the asset's w/h units",
                "src_y": "num (v0.2.2, default 0): top of the drawn part",
                "src_w": "num > 0 (v0.2.2, default the rest of the frame): width of the drawn part",
                "src_h": "num > 0 (v0.2.2, default the rest of the frame): height of the drawn part"},
              "notes": "src_* crops the frame and stretches the crop to w x h (a zoom); parts outside the frame are transparent" },
            { "node": "line", "since": "0.2", "props": {"x1": "num (default 0)", "y1": "num (default 0)",
                "x2": "num (required)", "y2": "num (required)"},
              "notes": "ends relative to the node's origin; uses stroke and stroke_width (default 2)" },
            { "node": "poly", "since": "0.2", "props": {"points": "list<vec2|ivec2> relative to the node's origin (max 256)",
                "closed": "bool (default true)",
                "hit": "box (default) | shape (v0.2.2): taps hit only inside the polygon (nonzero winding, like the fill)"},
              "notes": "uses fill, stroke, stroke_width; a literal list over the limit is an E_LIMIT at validation" },
        ],
    })
}

fn effects() -> J {
    json!([
        { "effect": "set", "form": {"set": "<place>", "to": "<expr>"}, "notes": "place = state var then .field / [index] chain" },
        { "effect": "incr", "form": {"incr": "<place>", "by": "<expr, default 1>"} },
        { "effect": "decr", "form": {"decr": "<place>", "by": "<expr, default 1>"} },
        { "effect": "let", "form": {"let": {"name": "<expr>"}}, "notes": "visible for the rest of the enclosing do list" },
        { "effect": "if", "form": {"if": "<expr>", "then": ["<effects>"], "else": ["<effects>"]} },
        { "effect": "for_each", "form": {"for_each": "<list or set expr>", "as": "name", "do": ["<effects>"]},
          "notes": "gives values, not references; update lists with set + map" },
        { "effect": "emit", "form": {"emit": "<event>", "with": {"field": "<expr>"}}, "notes": "processed in the same step" },
        { "effect": "after", "form": {"after": "<ms expr>", "emit": "<event>", "with": {}, "id": "<timer name, optional>"},
          "notes": "a pending timer with the same id is replaced" },
        { "effect": "cancel", "form": {"cancel": "<timer id>"} },
        { "effect": "end", "form": {"end": "win | lose"} },
        { "effect": "push", "form": {"push": "<list place>", "value": "<expr> (alias: item)"} },
        { "effect": "remove", "form": {"remove": "<place>", "where": "<lambda x => bool>"},
          "notes": "or \"value\": <expr> to remove an item from a set/map" },
    ])
}

fn input_sources() -> J {
    json!([
        { "source": {"key": "<KeyboardEvent.code or .key>"}, "fires": "key down",
          "record": "key: {code: string, char: string}" },
        { "source": {"key": "<code>", "on": "up"}, "since": "0.2", "fires": "key up", "record": "key: {code, char}" },
        { "source": {"key": "any"}, "since": "0.2", "fires": "every key down (with \"on\": \"up\", every key up)",
          "record": "key: {code, char}; char is the printable character or ''" },
        { "source": {"swipe": "any | left | right | up | down"}, "fires": "a swipe", "record": "swipe: {dir: ivec2}" },
        { "source": {"pointer": "down | move | up"}, "since": "0.2",
          "fires": "a pointer anywhere on the canvas that no on_tap/on_drag/on_press/on_release node took; move only while down",
          "record": "pointer: {x: float, y: float} in world coordinates" },
        { "source": {"text": "submit"}, "since": "0.2", "fires": "the player submits typed text (Enter or Done)",
          "record": "text: {value: string}", "options": {"placeholder": "default \"Type here\"", "max_len": "default 32, max 200"} },
        { "source": {"text": "change"}, "since": "0.2", "fires": "every edit of the text field",
          "record": "text: {value: string}", "options": {"placeholder": "string", "max_len": "int"} },
    ])
}

fn feedback() -> J {
    json!({
        "triggers": "an input name, a custom event name, win or lose",
        "entry": {"on": "trigger (required)", "when": "bool expression (v0.2.1, optional): sees event and state; \
pure (no random); the actions run only when true", "do": "list of actions"},
        "actions": [
            { "action": "sound", "forms": [
                { "form": "synth", "keys": {"wave": "sine (default) | square | triangle | sawtooth", "note": "C5, F#4, Bb3 or Hz (default A4)",
                  "ms": "default 100", "slide": "note to glide to over ms", "volume": "0..1, default 0.6"} },
                { "form": "jingle", "keys": {"wave": "...", "notes": "list of notes", "step_ms": "per note, default 80",
                  "slide": "glide on the last note", "volume": "0..1, default 0.6"} },
                { "form": "sample", "since": "0.2", "keys": {"asset": "a sound asset id", "volume": "0..1, default 0.6",
                  "rate": "playback rate, default 1"} },
              ], "notes": "any field may be an = expression" },
            { "action": "toast", "keys": {"text": "string", "ms": "num"} },
            { "action": "shake", "keys": {"px": "num", "ms": "num"} },
            { "action": "particles", "since": "0.2", "keys": {"x": "world x (required)", "y": "world y (required)",
                "count": "default 12, max 64", "color": "default #FFFFFF",
                "speed": "default 200; each particle gets 50-100% of it", "size": "diameter, default 4",
                "ms": "default 500", "gravity": "default 0", "spread": "degrees centered on up, default 360"},
              "notes": "seeded from the event, so replays look the same; at most 512 alive" },
            { "action": "haptic", "since": "0.2", "values": ["light", "medium", "heavy", "success", "warning", "error"] },
        ],
    })
}

fn physics() -> J {
    json!({
        "since": "0.2",
        "section": {"gravity": "[x, y] px/s²", "bounds": "[x, y, w, h]", "bodies": "{group: options}",
                    "collisions": "list of collision rules", "on_bounds": "list of {body, emit}"},
        "body_records": "a state var holding one record or a list of records with float fields: x, y (center, required), \
vx, vy (optional; without them the body never moves on its own), r (circle) or w, h (box). Extra fields are ignored",
        "group_options": [
            {"option": "state", "meaning": "the state var (required)"},
            {"option": "gravity", "default": "1 if the record has vy, else 0", "meaning": "gravity scale"},
            {"option": "static", "default": false, "meaning": "never moved by physics"},
            {"option": "bounded", "default": false, "meaning": "kept inside bounds; velocity on the hit axis *= -bounce"},
            {"option": "bounce", "default": 0, "meaning": "restitution 0..1"},
            {"option": "max_speed", "default": null, "meaning": "clamps the speed after gravity"},
        ],
        "collision_options": [
            {"option": "a", "meaning": "body group (required)"},
            {"option": "b", "meaning": "body group (required); a == b checks pairs i < j"},
            {"option": "solid", "default": false, "meaning": "push apart along the minimum-translation axis"},
            {"option": "bounce", "default": "the larger of the two groups' bounce",
             "meaning": "velocity into the contact becomes -bounce * itself"},
            {"option": "emit", "meaning": "event to queue; its payload may declare a: int, b: int, nx: float, ny: float"},
        ],
        "on_bounds": {"body": "body group", "emit": "event; payload may declare a, nx, ny; the normal points inward"},
        "order": "once per step, after timers and before tick; normal (nx, ny) points from b toward a. Indices a and b \
refer to the lists as they were at physics time: mark items in the event rule and remove them in tick. tick runs once \
per step even when the event budget overflows",
    })
}

/// The whole catalog.
pub fn catalog() -> J {
    let builtins: Vec<J> = builtin_docs()
        .into_iter()
        .map(|(category, name, doc)| {
            let b = Builtin::from_name(&name);
            json!({
                "name": name, "category": category, "doc": doc,
                "random": b.is_some_and(|b| b.is_random()),
                "lambda_arg": b.and_then(|b| b.lambda_arg()),
            })
        })
        .collect();
    let limits: Vec<J> = limit_docs()
        .into_iter()
        .map(|(name, value, doc)| json!({"name": name.to_lowercase(), "value": limit_value(&value), "doc": doc}))
        .collect();
    let constants: Vec<J> = CONSTANTS
        .iter()
        .map(|c| {
            let (ty, doc) = match *c {
                "up" => ("ivec2", "vec(0, -1)"),
                "down" => ("ivec2", "vec(0, 1)"),
                "left" => ("ivec2", "vec(-1, 0)"),
                "right" => ("ivec2", "vec(1, 0)"),
                "now" => ("int", "game time in ms"),
                "pi" => ("float", "3.14159... (v0.2)"),
                _ => ("", ""),
            };
            json!({"name": c, "type": ty, "doc": doc})
        })
        .collect();
    json!({
        "format": ["microgame/0.1", "microgame/0.2"],
        "spec": ["docs/microgame-input-format.md", "engine/SPEC-v0.2.md"],
        "engine_version": env!("CARGO_PKG_VERSION"),
        "top_level": ["format", "meta", "types", "state", "functions", "events", "inputs", "rules", "objectives",
                      "presentation", "assets", "physics"],
        "types": ["bool", "int", "float", "string", "ivec2", "vec2", "list<T>", "set<T>", "map<K,V>", "grid<T>", "T?",
                  "{\"enum\": [...]}", "record {field: type} or a name from types"],
        "operators": ["+", "-", "*", "/", "%", "==", "!=", "<", "<=", ">", ">=", "and", "or", "not",
                      "if C then A else B", "let x = A in B", "x => expr", "(a, b) => expr", "{...rec, f: v}"],
        "constants": constants,
        "builtins": builtins,
        "rule_triggers": [
            {"on": "start", "event": "none"},
            {"on": "tick", "event": "event.dt (float ms)"},
            {"on": {"every": "150ms"}, "event": "none"},
            {"on": "<input name>", "event": "payload fields plus event.t"},
            {"on": "<custom event name>", "event": "payload fields"},
        ],
        "effects": effects(),
        "input_sources": input_sources(),
        "objectives": {"win": "bool expr", "lose": "bool expr", "score": "num expr", "time_limit": "duration",
                        "on_timeout": "lose (default) | win"},
        "assets": {
            "since": "0.2",
            "fields": {"svg": "inline SVG markup starting with <svg", "image": "https:// URL or data:image/... URI",
                       "sound": "https:// URL or data:audio/... URI", "w": "frame width (required for images)",
                       "h": "frame height (required for images)", "frames": "sprite sheet frame count (default 1)",
                       "cols": "frames per row (default frames)", "fps": "default animation speed (default 0)"},
            "rule": "exactly one of svg, image or sound per asset; ids follow identifier rules",
        },
        "presentation": {
            "sections": {"canvas": "{w, h, background}", "tokens": "{name: value}", "root": "node", "feedback": "list",
                         "camera": "{x, y} world top-left of the view (v0.2)",
                         "music": "{asset, volume (default 0.6), playing (default status == 'playing')} (v0.2)",
                         "text_field": "{x, y, w, h, size} placement of the text field (v0.2)"},
            "expression_scope": "state, now, status ('playing' | 'won' | 'lost'), tokens, functions, node locals; no randomness",
        },
        "nodes": nodes(),
        "feedback": feedback(),
        "physics": physics(),
        "limits": limits,
        "diagnostic_codes": diag_codes(),
    })
}

/// A short human-readable summary for the terminal.
pub fn summary(c: &J) -> String {
    let names = |key: &str, field: &str| -> String {
        c[key].as_array().map(|a| a.iter().filter_map(|x| x[field].as_str()).collect::<Vec<_>>().join(" ")).unwrap_or_default()
    };
    let mut s = String::new();
    s.push_str(&format!("formats: {}\n", c["format"]));
    s.push_str(&format!("builtins ({}): {}\n", c["builtins"].as_array().map_or(0, |a| a.len()), names("builtins", "name")));
    s.push_str(&format!("constants: {}\n", names("constants", "name")));
    s.push_str(&format!("effects: {}\n", names("effects", "effect")));
    let kinds = c["nodes"]["kinds"].as_array().map(|a| a.iter().filter_map(|k| k["node"].as_str()).collect::<Vec<_>>().join(" "));
    s.push_str(&format!("nodes: {}\n", kinds.unwrap_or_default()));
    let actions = c["feedback"]["actions"].as_array().map(|a| a.iter().filter_map(|k| k["action"].as_str()).collect::<Vec<_>>().join(" "));
    s.push_str(&format!("feedback: {}\n", actions.unwrap_or_default()));
    s.push_str("input sources: key, key on up, key any, swipe, pointer down/move/up, text submit/change\n");
    s.push_str(&format!("limits: {}\n", names("limits", "name")));
    s.push_str(&format!("diagnostic codes: {}\n", names("diagnostic_codes", "code")));
    s.push_str("use --json for the full catalog with docs");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `const NAME: &[&str] = &[...]` list from a source file.
    fn const_list(src: &str, name: &str) -> Vec<String> {
        let i = src.find(&format!("const {name}: &[&str]")).unwrap_or_else(|| panic!("{name} not found"));
        let body = &src[i..];
        let open = body.find("= &[").unwrap() + 4;
        let close = body[open..].find(']').unwrap() + open;
        body[open..close].split(',').map(|s| s.trim().trim_matches('"').to_string()).filter(|s| !s.is_empty()).collect()
    }

    #[test]
    fn every_builtin_is_documented_once() {
        let docs = builtin_docs();
        assert_eq!(docs.len(), Builtin::ALL.len());
        for b in Builtin::ALL {
            let d = docs.iter().find(|(_, n, _)| n == b.name()).unwrap_or_else(|| panic!("{} missing", b.name()));
            assert!(!d.2.is_empty(), "{} has no doc", b.name());
            assert!(!d.0.is_empty(), "{} has no category", b.name());
        }
        let cats: std::collections::BTreeSet<_> = docs.iter().map(|d| d.0.as_str()).collect();
        for c in ["math", "lists", "higher-order", "sets", "grids", "space", "text", "options", "random"] {
            assert!(cats.contains(c), "category {c} missing from {cats:?}");
        }
    }

    #[test]
    fn limits_parse() {
        let l = limit_docs();
        assert!(l.iter().any(|(n, v, _)| n == "MAX_EVENTS_PER_STEP" && limit_value(v) == json!(256)));
        assert!(l.iter().any(|(n, v, _)| n == "MAX_SVG_BYTES" && limit_value(v) == json!(262144)));
        assert!(l.iter().all(|(_, v, d)| limit_value(v).is_u64() && !d.is_empty()));
    }

    #[test]
    fn catalog_has_the_v021_additions() {
        let c = catalog();
        let common = &c["nodes"]["common_props"];
        assert!(common["on_press"].as_str().unwrap().contains("pointer down"));
        assert!(common["on_release"].as_str().unwrap().contains("wherever"));
        let text = c["nodes"]["kinds"].as_array().unwrap().iter().find(|k| k["node"] == "text").unwrap();
        assert!(text["props"]["wrap"].as_str().unwrap().contains("default false"));
        assert!(text["notes"].as_str().unwrap().contains("outline"));
        assert!(c["feedback"]["entry"]["when"].as_str().unwrap().contains("pure"));
        let bounce = c["physics"]["collision_options"].as_array().unwrap().iter().find(|o| o["option"] == "bounce").unwrap();
        assert!(bounce["default"].as_str().unwrap().contains("larger"));
    }

    #[test]
    fn catalog_has_the_v022_additions() {
        let c = catalog();
        let kind = |k: &str| c["nodes"]["kinds"].as_array().unwrap().iter().find(|n| n["node"] == k).unwrap().clone();
        assert!(kind("group")["props"]["clip"].as_str().unwrap().contains("needs w and h"));
        assert!(kind("image")["props"]["src_w"].as_str().unwrap().contains("> 0"));
        assert!(kind("poly")["props"]["hit"].as_str().unwrap().contains("nonzero"));
    }

    #[test]
    fn catalog_matches_the_parser() {
        let c = catalog();
        let present = include_str!("../../mg-lang/src/present.rs");
        let effects_src = include_str!("../../mg-lang/src/effects.rs");
        let program = include_str!("../../mg-lang/src/program.rs");
        let physics_src = include_str!("../../mg-lang/src/physics.rs");
        let diag = include_str!("../../mg-core/src/diag.rs");

        let kinds: Vec<String> =
            c["nodes"]["kinds"].as_array().unwrap().iter().map(|k| k["node"].as_str().unwrap().to_string()).collect();
        assert_eq!(kinds, const_list(present, "KINDS"));
        // Every kind's props match `kind_keys` (repeat's `item` is an alias of `template`).
        for k in c["nodes"]["kinds"].as_array().unwrap() {
            let kind = k["node"].as_str().unwrap();
            let arm = format!("\"{kind}\" => &[");
            let i = present.find(&arm).unwrap() + arm.len();
            let parser: Vec<&str> =
                present[i..i + present[i..].find(']').unwrap()].split(',').map(|s| s.trim().trim_matches('"')).collect();
            let ours: Vec<&str> = k["props"].as_object().unwrap().keys().map(|s| s.as_str()).collect();
            for p in &parser {
                assert!(ours.contains(p) || (kind == "repeat" && *p == "item"), "{kind}.{p} missing from the catalog");
            }
            for p in &ours {
                assert!(parser.contains(p), "{kind}.{p} is not accepted by the parser");
            }
        }
        let common: Vec<&str> = c["nodes"]["common_props"].as_object().unwrap().keys().map(|s| s.as_str()).collect();
        for p in const_list(present, "COMMON") {
            assert!(p == "node" || common.contains(&p.as_str()), "common prop {p} missing");
        }
        let actions: Vec<String> = c["feedback"]["actions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["action"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(actions, const_list(present, "ACTIONS"));
        let entry: Vec<String> = c["feedback"]["entry"].as_object().unwrap().keys().cloned().collect();
        assert_eq!(entry, const_list(present, "FEEDBACK_KEYS"), "feedback entry keys");
        let mut effects: Vec<String> =
            c["effects"].as_array().unwrap().iter().map(|e| e["effect"].as_str().unwrap().to_string()).collect();
        let mut heads = const_list(effects_src, "HEADS");
        effects.sort();
        heads.sort();
        assert_eq!(effects, heads);
        for kind in const_list(program, "SOURCE_KINDS") {
            assert!(
                c["input_sources"].as_array().unwrap().iter().any(|s| s["source"].get(&kind).is_some()),
                "source {kind} missing"
            );
        }
        let group_opts: Vec<&str> = c["physics"]["group_options"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o["option"].as_str().unwrap())
            .collect();
        assert_eq!(group_opts, const_list(physics_src, "GROUP_KEYS"));
        let coll_opts: Vec<&str> = c["physics"]["collision_options"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o["option"].as_str().unwrap())
            .collect();
        assert_eq!(coll_opts, const_list(physics_src, "COLLISION_KEYS"));
        let sections: Vec<&str> = c["physics"]["section"].as_object().unwrap().keys().map(|s| s.as_str()).collect();
        for k in const_list(physics_src, "PHYSICS_KEYS") {
            assert!(sections.contains(&k.as_str()), "physics.{k} missing");
        }
        for f in const_list(program, "FORMATS") {
            assert!(c["format"].as_array().unwrap().contains(&json!(f)));
        }
        // Every diagnostic code in mg-core is listed.
        let codes: Vec<&str> =
            c["diagnostic_codes"].as_array().unwrap().iter().map(|d| d["code"].as_str().unwrap()).collect();
        let mut n = 0;
        for line in diag.lines() {
            if let Some((_, rest)) = line.split_once("=> \"") {
                let code = rest.split('"').next().unwrap();
                if code.starts_with("E_") || code.starts_with("W_") {
                    assert!(codes.contains(&code), "diagnostic {code} missing");
                    n += 1;
                }
            }
        }
        assert_eq!(n, codes.len());
        assert_eq!(c["constants"].as_array().unwrap().len(), CONSTANTS.len());
    }
}
