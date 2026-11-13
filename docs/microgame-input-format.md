# Microgame Input Format v0.1: Engine Handoff

**What this is:** the format of the `game.json` file that the AI generates and the Rust engine runs. Treat it as the contract between the two of us:

- **Authoring side** makes the AI produce valid files in this format.
- **Engine side** parses, validates and runs any file in this format, then hands a draw list to the browser.

Read in this order: **Part A** (the format), **Part B** (what the engine has to do with it), **Part C** (three complete games to use as test fixtures).

> In the spec sections, `// comments` are there to explain things. Real game files are plain JSON with no comments. The files in Part C are real.

---

# Part A: The format

## A1. Top level

```
{
  "format":       "microgame/0.1",
  "meta":         { ... },   // title, instructions, duration
  "types":        { ... },   // named record types (optional)
  "state":        { ... },   // all game data, typed, with initial values
  "functions":    { ... },   // reusable pure helpers (optional)
  "events":       { ... },   // custom events the game emits (optional)
  "inputs":       { ... },   // what the player can do + keyboard/swipe controls
  "rules":        [ ... ],   // on EVENT, when CONDITION, do EFFECTS
  "objectives":   { ... },   // win / lose / score / time limit
  "presentation": { ... }    // how it looks, sounds and animates
}
```

Everything from `state` to `objectives` is the **game**. `presentation` is the **look**. Replacing `presentation` must never change how the game plays.

## A2. Structure is JSON, calculations are expression strings

The file uses JSON for **structure**: which rules exist and which effects run. Calculations are **expression strings** written in a small language:

```json
{ "set": "score", "to": "score + r.gained * 2" }
```

Why strings: `"not board[c]"` is easy for the AI to write, while the same thing as a JSON tree is about 10 nested objects. The engine parses the strings into an AST anyway, so diagnostics can still point at exact character positions.

- In the game sections, any field marked *(expr)* is always an expression.
- In `presentation`, style props are **literals** unless they start with `=`:
  `"fill": "#222"` is a literal, while `"fill": "= if value then $on else $off"` is an expression bound to state.

## A3. `meta`

```json
"meta": {
  "title": "Lights Out",
  "instructions": "Tap a tile to flip it and its neighbors. Turn every light off.",
  "duration_s": 90,
  "seed": 42            // optional; engine picks one if absent
}
```

## A4. Types

| Type | Literal | Notes |
|---|---|---|
| `bool` | `true` | |
| `int` | `3` | 64-bit |
| `float` | `0.5` | 64-bit. An int becomes a float automatically when needed; going from float to int needs `floor`, `ceil` or `round` |
| `string` | `'hello'` | single quotes inside expressions |
| `ivec2` / `vec2` | `vec(3, 7)` | `.x`, `.y`. `+` and `-` work between vectors, `*` multiplies by a scalar. `vec` of two ints gives `ivec2` |
| `list<T>` | `[1, 2, 3]` | ordered |
| `set<T>` | `set_of(['key'])` | |
| `map<K,V>` | `map_of([['butler', 0]])` | |
| `grid<T>` | `grid(5, 5, false)` | indexed by `ivec2`: `board[c]` |
| `T?` | `none` | optional value: `is_none(x)`, `or_else(x, default)` |
| enum | `'ready'` | declared as `{ "enum": ["waiting", "ready"] }`. Written as strings; the validator checks membership |
| record | `{x: 1, hp: 3}` | structural; names in `types` are aliases |

- **Durations** are ints in milliseconds: `150ms` → `150`, `2s` → `2000`.
- **Coordinates:** `(0,0)` is the top-left, x grows right, y grows down. `up = vec(0,-1)`, `down = vec(0,1)`, `left = vec(-1,0)`, `right = vec(1,0)`.
- **Equality** (`==`, `!=`) is structural for every type, including lists, grids and records.
- **Values are immutable.** Functions like `push` and `set_at` return a new value.

```json
"types": {
  "Card":   { "symbol": "int", "revealed": "bool", "matched": "bool" },
  "Meteor": { "x": "float", "y": "float", "r": "float", "speed": "float" }
}
```

## A5. `state`

Every piece of game data, with its type and its initial value *(expr)*:

```json
"state": {
  "board":   { "type": "grid<bool>", "init": "grid(5, 5, false)" },
  "moves":   { "type": "int", "init": "0" },
  "phase":   { "type": { "enum": ["waiting", "ready"] }, "init": "'waiting'" },
  "meteors": { "type": "list<Meteor>", "init": "[]" }
}
```

State is the **only** source of truth. Presentation reads it and never writes to it.

## A6. Expression language

```
literals    1  1.5  true  'text'  none  150ms  [a, b]  {x: 1, y: 2}  {...rec, y: 3}
refs        score   player.x   board[c]   list[0]   event.cell   $token (presentation only)
operators   + - * / %    == != < <= > >=    and or not
control     if C then A else B          let x = A in B
lambdas     x => x + 1                  (acc, v) => acc + v
calls       len(snake)   merge_line(row)
```

Grammar sketch, from lowest to highest precedence:

```
expr    := lambda | 'let' IDENT '=' expr 'in' expr | 'if' expr 'then' expr 'else' expr | or
or      := and ('or' and)*
and     := not ('and' not)*
not     := 'not' not | cmp
cmp     := sum (('=='|'!='|'<'|'<='|'>'|'>=') sum)?
sum     := prod (('+'|'-') prod)*
prod    := unary (('*'|'/'|'%') unary)*
unary   := '-' unary | postfix
postfix := atom ('.' IDENT | '[' expr ']' | '(' args ')')*
atom    := NUMBER | DURATION | STRING | 'true' | 'false' | 'none' | '$' IDENT | IDENT
         | '[' args ']' | '{' fields '}' | '(' expr ')'
lambda  := IDENT '=>' expr | '(' IDENT (',' IDENT)* ')' '=>' expr
fields  := (IDENT ':' expr | '...' expr) (',' ...)*
```

- **Name lookup order:** locals (`let`, lambda params, `for_each` variables), then `event`, then state, then functions and builtins, then constants (`up`, `down`, `left`, `right`, `now`). A local that shadows a state name is a validation error.
- **Lambdas** may only appear as arguments to calls. They can't be stored in state or returned.
- **Integer division** `int / int` gives an int, truncated. `%` is only for ints.

### Builtins (v0.1)

| Group | Functions |
|---|---|
| Math | `abs min max clamp floor ceil round sqrt log2 sin cos lerp hash(x)→float in 0..1` |
| List | `len first last get_or slice take drop concat push set_at insert_at remove_at reverse repeat(v, n) range(n) index_of contains` |
| Higher-order | `map filter fold(list, init, (acc, x) => ..) any all count find sort_by sum zip` |
| Set / Map | `set_of add remove has map_of put keys values` |
| Grid | `grid(w, h, v) width height cells(g)→list<ivec2> values(g) in_grid(g, c) grid_map(g, (v, c) => ..) neighbors4(c) neighbors8(c) lines(g, dir) write_line(g, coords, values)` |
| Space | `vec(x, y) length dist normalize in_bounds(p, w, h) coords(w, h)→list<ivec2> overlaps_circle(p1, r1, p2, r2) overlaps_rect(p1, s1, p2, s2)` |
| Text | `chars upper lower join str in_dictionary(word)` |
| Random | `random_int(a, b) random_float(a, b) pick(list) shuffle(list) weighted(values, weights)` |

Precise semantics for the less obvious builtins:

- `cells(g)` and `coords(w, h)` return cells in row-major order: y outer, x inner.
- `neighbors4(c)` returns `[c+up, c+right, c+down, c+left]`. It does **not** filter out cells outside the grid.
- `lines(g, dir)` returns every row (for left/right) or column (for up/down) as a `list<ivec2>`, **starting from the edge you're pushing toward**. For `left`, each row goes x = 0 → w-1. For `right`, it goes x = w-1 → 0. For `up`, each column goes y = 0 → h-1. For `down`, it goes y = h-1 → 0. This is the general primitive that makes sliding-tile games work without a special "merge" op.
- `write_line(g, coords, values)` returns a new grid with `g[coords[i]] = values[i]`. The two lists must be the same length.

**Runtime errors:** reading outside a grid or list, `pick([])`, or division by zero. Any of these rolls back the current rule and produces a diagnostic.

**Randomness** comes from the seeded RNG. It's allowed only in `state.init` and in effect expressions. It's forbidden in `when`, `objectives`, `functions` and `presentation`; use `hash(x)` there when you want a stable value that looks random.

## A7. `functions`

Pure and typed. They can be called from rules, objectives and presentation.

```json
"functions": {
  "press": {
    "params": { "b": "grid<bool>", "c": "ivec2" },
    "returns": "grid<bool>",
    "body": "grid_map(b, (v, p) => if p == c or contains(neighbors4(p), c) then not v else v)"
  }
}
```

Functions can't call themselves, directly or through other functions; the validator rejects call cycles. Every loop runs over a finite collection, so every function terminates.

## A8. `events`

Custom events the game emits for itself, such as timers, phase changes, or messages for the presentation:

```json
"events": {
  "signal":     {},
  "spawn_tile": {},
  "message":    { "text": "string" }
}
```

## A9. `inputs`

What the player can do, with typed payloads. Keyboard and swipe sources are declared here. **Taps and drags on specific objects are wired in `presentation`**, because only the presentation knows where things are on screen.

```json
"inputs": {
  "tap_cell": { "payload": { "cell": "ivec2" } },
  "steer": {
    "payload": { "dir": "ivec2" },
    "from": [
      { "swipe": "any",      "with": { "dir": "swipe.dir" } },
      { "key": "ArrowUp",    "with": { "dir": "up" } },
      { "key": "ArrowDown",  "with": { "dir": "down" } },
      { "key": "ArrowLeft",  "with": { "dir": "left" } },
      { "key": "ArrowRight", "with": { "dir": "right" } }
    ]
  },
  "flip": {
    "payload": { "index": "int" },
    "when": "len(selected) < 2"          // input guard: the input is dropped while this is false
  }
}
```

The `with` values are expressions. In a `from` source, `swipe.dir` (an ivec2) and `key.code` (a string) are in scope.

## A10. `rules`

```json
{ "id": "tap", "on": "tap_cell", "when": "<expr, optional>", "do": [ <effects> ] }
```

**`on`** can be any of these:

| Value | Fires | `event.*` available |
|---|---|---|
| `"start"` | once, when the game starts | — |
| `"tick"` | every engine step | `event.dt` (ms, float) |
| `{ "every": "150ms" }` | repeating timer, first fire 150ms after start | — |
| `"<input name>"` | player input | payload fields, plus `event.t` |
| `"<event name>"` | custom event | payload fields |

### Effects

| Effect | Example |
|---|---|
| set | `{ "set": "board[event.cell]", "to": "true" }`. The target is a state name followed by any chain of `.field` / `[index]` |
| incr / decr | `{ "incr": "score", "by": "10" }` (`by` defaults to 1) |
| let | `{ "let": { "head": "snake[0] + dir" } }`. Visible for the rest of the enclosing `do` list |
| if | `{ "if": "head == food", "then": [...], "else": [...] }` |
| for_each | `{ "for_each": "lines(board, event.dir)", "as": "line", "do": [...] }` |
| emit | `{ "emit": "message", "with": { "text": "'A torn letter.'" } }` |
| after | `{ "after": "700ms", "emit": "hide_pair", "with": {...}, "id": "hide" }` |
| cancel | `{ "cancel": "hide" }` |
| end | `{ "end": "win" }` / `{ "end": "lose" }` |

Shorthand: `push` and `remove` (`{ "remove": "meteors", "where": "m => m.y > 700" }`). These are sugar for `set` with `concat` or `filter`.

**`for_each` gives you values, not references.** To update every item in a list, use `set` with `map`:
`{ "set": "meteors", "to": "map(meteors, m => {...m, y: m.y + m.speed * event.dt / 1000})" }`

### Execution semantics (the engine must follow these exactly)

1. Each `step(dt)` advances the game clock by `dt` and then processes, in this order:
   1. queued inputs, in arrival order;
   2. timers that are due, ordered by due time and then creation order;
   3. one `tick`.
2. For each event, the rules that match run **in file order**. A rule's `when` is evaluated against the state as it is when that rule runs, so it sees changes made by earlier rules.
3. Inside a rule, effects run in order on a working copy, and later effects **see** earlier writes. The rule commits atomically at the end. A runtime error rolls the rule back and records a diagnostic.
4. `emit` adds the event to the end of the queue, and it's processed within the same step. There's a cap on how many events a step can process.
5. After each event, `objectives` are checked. `end` commits the current rule and stops all further processing.
6. `now` is game time in ms since start. The clock stops when the game ends.

## A11. `objectives`

```json
"objectives": {
  "win":  "all(values(board), v => not v)",   // checked after each event
  "lose": "moves > 40",                       // optional
  "score": "max(0, 1000 - moves * 20)",       // optional; shown on the end screen
  "time_limit": "90s",                        // optional
  "on_timeout": "lose"                        // use "win" for survival games
}
```

`win` is checked before `lose`. At least one way to end the game (`win`, `lose`, `time_limit`, or an `end` effect) is required.

## A12. `presentation`

```json
"presentation": {
  "canvas": { "w": 360, "h": 640, "background": "$bg" },
  "tokens": { "bg": "#F4F1EA", "on": "#E4572E", "tiles": ["#CDC1B4", "#EEE4DA"] },
  "root":   { <node> },
  "feedback": [ ... ]
}
```

- All positions are in canvas units, and the shell scales the canvas to fit the screen. Pointer coordinates use the same units.
- Tokens are colors, numbers, strings, or lists of those. You refer to them as `$name`, and list tokens can be indexed: `$tiles[2]`.
- **What `=` expressions can see:** state, `now`, `status` (`'playing' | 'won' | 'lost'`), tokens, functions, and the node-local variables listed below. They can't change anything and can't use randomness.

### Nodes (v0.1)

| Node | Specific props | Local vars |
|---|---|---|
| `group` | `children`; children are positioned freely relative to the group's origin | |
| `stack` | `dir: row\|column`, `gap`, `align: start\|center\|end`, `children` | |
| `grid` | `source` (a grid in state) **or** `cols`/`rows`; `cell_size`, `gap`, `cell` (template node, whose origin is the cell's top-left) | `cell` (ivec2), plus `value` when there's a `source` |
| `repeat` | `source` (a list), `as`, `key` (stable identity, used by animations), `node` | the `as` name, `index` |
| `rect` | `w`, `h`, `radius` | |
| `circle` | `r` (positioned by its center) | |
| `text` | `text`, `size`, `font`, `weight`, `color`, optional box `w`/`h` with `align: left\|center\|right` and `valign: top\|middle\|bottom` | |

- **Common props:** `id x y anchor rotation scale opacity visible fill stroke stroke_width`. `anchor` is either `top_left` (the default) or `center`.
- **Sizes:** a grid is `cols*cell_size + (cols-1)*gap` wide, and similarly for its height. A stack's size comes from its children.

**Interaction props:**

```json
"on_tap":  { "input": "tap_cell", "with": { "cell": "cell" } },
"on_drag": { "input": "move",     "with": { "x": "pointer.x" } }
```

**Motion props:**

```json
"transition": { "fill": { "ms": 120, "ease": "out" } },   // auto-tween when a bound value changes
"animate_on": {
  "tap_cell": { "when": "event.cell == cell", "prop": "scale", "keys": [1, 1.15, 1], "ms": 150 }
}
```

**Global feedback** reacts to inputs, emitted events, `win` and `lose`:

```json
"feedback": [
  { "on": "tap_cell", "do": [ { "sound": { "wave": "square", "note": "C5", "ms": 60 } } ] },
  { "on": "message",  "do": [ { "toast": { "text": "= event.text", "ms": 1500 } } ] },
  { "on": "lose",     "do": [ { "shake": { "px": 8, "ms": 300 } } ] }
]
```

By default the shell draws the start and end screens: title, instructions, score, and a restart button.

---

# Part B: What the engine has to do

## B1. Pipeline

```
game.json
  → serde: deserialize into raw structs (expression fields are still strings)
  → parse every expression string → Expr AST (keep spans for diagnostics)
  → resolve names (locals / event / state / functions / builtins / constants)
  → type check (bidirectional: [] and none take their type from context)
  → static checks (no recursion, randomness only where allowed, inputs/events exist, ≥1 way to end)
  → IR (names → numeric ids)
  → Runtime
```

Every check produces **diagnostics** instead of panicking. The validator must keep going after the first error and report as many errors as it can.

## B2. Diagnostics format

```json
{
  "code": "E_TYPE_MISMATCH",
  "at": "/rules/1/do/0/to",
  "span": [6, 11],
  "message": "expected int, found bool",
  "hint": "did you mean 'len(snake)'?"
}
```

- `at` is a JSON Pointer to the field.
- `span` is the character range inside the expression string.
- `hint` is optional. "Did you mean" suggestions based on edit distance help the AI repair its output a lot.

Starter codes: `E_PARSE`, `E_UNKNOWN_NAME`, `E_TYPE_MISMATCH`, `E_NOT_ASSIGNABLE`, `E_RANDOM_IN_PURE`, `E_RECURSION`, `E_UNKNOWN_INPUT`, `E_UNKNOWN_EVENT`, `E_BAD_PAYLOAD`, `E_SHADOWS_STATE`, `E_NO_END_CONDITION`, `E_RUNTIME` (from simulation), `W_UNREACHABLE_RULE`, `W_UNUSED_STATE`.

## B3. Suggested Rust shape

These are suggestions, not requirements.

```rust
enum Type  { Bool, Int, Float, Str, IVec2, Vec2, List(Box<Type>), Set(Box<Type>),
             Map(Box<Type>, Box<Type>), Grid(Box<Type>), Option(Box<Type>),
             Enum(Vec<String>), Record(Vec<(Sym, Type)>) }

enum Value { Bool(bool), Int(i64), Float(f64), Str(Rc<str>), IVec2(i32, i32), Vec2(f64, f64),
             List(Rc<Vec<Value>>), Set(Rc<BTreeSet<Value>>), Map(Rc<BTreeMap<Value, Value>>),
             Grid { w: u32, h: u32, cells: Rc<Vec<Value>> }, Record(Rc<Vec<Value>>), None }
             // Rc + make_mut = cheap copy-on-write for "set board = write_line(...)"

enum Expr   { Lit(Value), Local(u32), State(u32), Event(u32), Field(Box<Expr>, u32),
              Index(Box<Expr>, Box<Expr>), Unary(..), Binary(..), If(..), Let(..),
              Lambda(..), Call(FnId, Vec<Expr>), List(Vec<Expr>), Record(..) }

enum Effect { Set(Place, Expr), Incr(Place, Expr), Let(u32, Expr), If(Expr, Vec<Effect>, Vec<Effect>),
              ForEach(u32, Expr, Vec<Effect>), Emit(EventId, Vec<Expr>),
              After(Expr, EventId, Vec<Expr>, Option<TimerId>), Cancel(TimerId), End(Outcome) }
```

Suggested crates: `language` (schema, parser, typecheck, IR), `runtime` (state, eval, scheduler, scene eval), `wasm` (bindings), `cli` (validate and simulate).

## B4. Engine API (WASM ↔ browser shell)

```text
validate(json)            -> Diagnostic[]
load(json, seed?)         -> Game | Diagnostic[]
game.pointer(kind, x, y)  // kind: down | move | up. The engine does hit-testing against on_tap/on_drag
game.key(code)            // the engine maps keys to inputs using inputs[*].from
game.swipe(dir)           // the shell detects swipe gestures; the engine maps them to inputs
game.step(dt_ms)          // runs the A10 execution order; advances tweens
game.frame()              -> Frame
game.status()             -> { phase: playing|won|lost, score, time_ms }
game.restart()
```

The shell has no game logic: it forwards raw events and draws whatever `frame()` returns.

```json
{
  "ops": [
    { "op": "rect",   "x": 8, "y": 120, "w": 56, "h": 56, "radius": 6, "fill": "#E4572E",
      "stroke": null, "stroke_width": 0, "rotation": 0, "scale": 1.12, "opacity": 1 },
    { "op": "circle", "x": 180, "y": 600, "r": 14, "fill": "#00F5FF" },
    { "op": "text",   "x": 180, "y": 60, "text": "LIGHTS OUT", "size": 40, "font": "Inter",
      "weight": 700, "color": "#1A1A1A", "align": "center", "valign": "middle" }
  ],
  "audio":  [ { "wave": "sine", "note": "E5", "ms": 60 } ],
  "toasts": [ { "text": "A torn letter.", "ms": 1500 } ],
  "shake":  { "px": 0 }
}
```

`ops` are in paint order. `audio` and `toasts` contain only what was triggered since the previous `frame()`. Sending JSON every frame is fine for v0.1; switch to a compact buffer later if profiling shows it matters.

## B5. CLI (the authoring side needs this early for the repair loop)

```bash
microgame validate game.json
```

```bash
microgame simulate game.json --seed 1 --random-inputs 1000
```

```bash
microgame replay game.json --seed 1 --script inputs.json
```

`simulate` sends random valid inputs, such as taps on tappable nodes and random keys and swipes. It reports runtime errors and whether the game ever reaches an end state.

## B6. Engine limits (enforced by the engine, never written in the file)

| Limit | v0.1 |
|---|---|
| Effects executed per event | 10,000 |
| Events processed per step | 256 |
| Active timers | 128 |
| Size of any list or grid | 10,000 items |
| Render ops per frame | 2,000 |

Going over a limit counts as a runtime error, and the rule is rolled back.

## B7. Definition of done for engine v0.1

- [ ] The three games in Part C pass `validate` with zero errors.
- [ ] Each game runs 50 seeds × 1,000 random inputs in the headless simulator with zero runtime errors.
- [ ] Determinism: the same file, seed and input script always produce an identical final state hash.
- [ ] Each game is playable in the browser shell, and win and lose are both reachable by hand.
- [ ] Breaking a game on purpose (renaming a state variable, passing a bool where an int is expected) produces the right diagnostic code and a correct `at` pointer.

---

# Part C: Test fixtures (complete games)

## C1. Lights Out: grids, neighbors, functions

```json
{
  "format": "microgame/0.1",
  "meta": {
    "title": "Lights Out",
    "instructions": "Tap a tile to flip it and its neighbors. Turn every light off.",
    "duration_s": 90
  },
  "state": {
    "board": { "type": "grid<bool>", "init": "grid(5, 5, false)" },
    "moves": { "type": "int", "init": "0" }
  },
  "functions": {
    "press": {
      "params": { "b": "grid<bool>", "c": "ivec2" },
      "returns": "grid<bool>",
      "body": "grid_map(b, (v, p) => if p == c or contains(neighbors4(p), c) then not v else v)"
    }
  },
  "inputs": {
    "tap_cell": { "payload": { "cell": "ivec2" } }
  },
  "rules": [
    {
      "id": "scramble",
      "on": "start",
      "do": [
        { "for_each": "range(8)", "as": "i", "do": [
          { "set": "board", "to": "press(board, pick(cells(board)))" }
        ] }
      ]
    },
    {
      "id": "tap",
      "on": "tap_cell",
      "do": [
        { "set": "board", "to": "press(board, event.cell)" },
        { "incr": "moves" }
      ]
    }
  ],
  "objectives": {
    "win": "all(values(board), v => not v)",
    "score": "max(0, 1000 - moves * 20)",
    "time_limit": "90s",
    "on_timeout": "lose"
  },
  "presentation": {
    "canvas": { "w": 360, "h": 640, "background": "$bg" },
    "tokens": { "bg": "#F4F1EA", "ink": "#1A1A1A", "on": "#E4572E", "off": "#2B2B2B" },
    "root": {
      "node": "stack", "dir": "column", "gap": 32, "align": "center",
      "x": 180, "y": 320, "anchor": "center",
      "children": [
        { "node": "text", "text": "LIGHTS OUT", "size": 40, "weight": 700, "color": "$ink" },
        {
          "node": "grid", "source": "board", "cell_size": 56, "gap": 6,
          "cell": {
            "node": "rect", "w": 56, "h": 56, "radius": 6,
            "fill": "= if value then $on else $off",
            "transition": { "fill": { "ms": 120, "ease": "out" } },
            "on_tap": { "input": "tap_cell", "with": { "cell": "cell" } },
            "animate_on": {
              "tap_cell": { "when": "event.cell == cell", "prop": "scale", "keys": [1, 1.12, 1], "ms": 150 }
            }
          }
        },
        { "node": "text", "text": "= 'Moves: ' + str(moves)", "size": 18, "color": "$ink" }
      ]
    },
    "feedback": [
      { "on": "tap_cell", "do": [ { "sound": { "wave": "sine", "note": "E5", "ms": 60 } } ] },
      { "on": "win", "do": [ { "sound": { "wave": "triangle", "note": "C6", "ms": 300 } } ] }
    ]
  }
}
```

## C2. Snake: timers, ordered lists, keyboard and swipe, input guards

```json
{
  "format": "microgame/0.1",
  "meta": {
    "title": "Snake",
    "instructions": "Swipe or use the arrow keys to steer. Eat 10 apples. Don't hit the walls or yourself.",
    "duration_s": 120
  },
  "state": {
    "snake":    { "type": "list<ivec2>", "init": "[vec(4, 7), vec(3, 7), vec(2, 7)]" },
    "dir":      { "type": "ivec2", "init": "right" },
    "next_dir": { "type": "ivec2", "init": "right" },
    "food":     { "type": "ivec2", "init": "vec(10, 7)" },
    "score":    { "type": "int", "init": "0" }
  },
  "inputs": {
    "steer": {
      "payload": { "dir": "ivec2" },
      "from": [
        { "swipe": "any",      "with": { "dir": "swipe.dir" } },
        { "key": "ArrowUp",    "with": { "dir": "up" } },
        { "key": "ArrowDown",  "with": { "dir": "down" } },
        { "key": "ArrowLeft",  "with": { "dir": "left" } },
        { "key": "ArrowRight", "with": { "dir": "right" } }
      ]
    }
  },
  "rules": [
    {
      "id": "steer",
      "on": "steer",
      "when": "event.dir + dir != vec(0, 0)",
      "do": [ { "set": "next_dir", "to": "event.dir" } ]
    },
    {
      "id": "move",
      "on": { "every": "150ms" },
      "do": [
        { "set": "dir", "to": "next_dir" },
        { "let": { "head": "snake[0] + dir" } },
        { "if": "not in_bounds(head, 15, 15) or contains(take(snake, len(snake) - 1), head)",
          "then": [ { "end": "lose" } ] },
        { "if": "head == food",
          "then": [
            { "set": "snake", "to": "concat([head], snake)" },
            { "incr": "score" },
            { "set": "food", "to": "pick(filter(coords(15, 15), c => not contains(snake, c)))" }
          ],
          "else": [
            { "set": "snake", "to": "concat([head], take(snake, len(snake) - 1))" }
          ] }
      ]
    }
  ],
  "objectives": {
    "win": "score >= 10",
    "score": "score",
    "time_limit": "120s",
    "on_timeout": "lose"
  },
  "presentation": {
    "canvas": { "w": 360, "h": 640, "background": "$bg" },
    "tokens": {
      "bg": "#0F1A12", "empty": "#16261A", "body": "#7BD389", "head": "#C6F6CF",
      "food": "#FF5D5D", "ink": "#E8F5EA"
    },
    "root": {
      "node": "stack", "dir": "column", "gap": 20, "align": "center",
      "x": 180, "y": 320, "anchor": "center",
      "children": [
        { "node": "text", "text": "= 'Apples: ' + str(score) + ' / 10'", "size": 22, "weight": 600, "color": "$ink" },
        {
          "node": "grid", "cols": 15, "rows": 15, "cell_size": 22, "gap": 1,
          "cell": {
            "node": "rect", "w": 22, "h": 22, "radius": 4,
            "fill": "= if cell == food then $food else if cell == snake[0] then $head else if contains(snake, cell) then $body else $empty"
          }
        }
      ]
    },
    "feedback": [
      { "on": "lose", "do": [ { "shake": { "px": 8, "ms": 300 } }, { "sound": { "wave": "square", "note": "C3", "ms": 250 } } ] },
      { "on": "win",  "do": [ { "sound": { "wave": "triangle", "note": "C6", "ms": 300 } } ] }
    ]
  }
}
```

Notes for the engine:
- The steer guard compares against `dir`, the direction already committed at the last move, and not against `next_dir`. Two quick presses inside one tick therefore can't reverse the snake into itself.
- The self-collision check leaves out the tail, because the tail moves away on this tick. When the snake eats, the tail stays and the snake grows, but the head is landing on food, so it can't be on the tail anyway.

## C3. Number Merge: fold, ordered line transforms, custom events, weighted randomness

```json
{
  "format": "microgame/0.1",
  "meta": {
    "title": "Number Merge",
    "instructions": "Swipe or use the arrow keys to slide tiles. Equal tiles merge. Reach 128.",
    "duration_s": 180
  },
  "types": {
    "MergeResult": { "cells": "list<int>", "gained": "int" }
  },
  "state": {
    "board": { "type": "grid<int>", "init": "grid(4, 4, 0)" },
    "score": { "type": "int", "init": "0" }
  },
  "functions": {
    "merge_line": {
      "params": { "line": "list<int>" },
      "returns": "MergeResult",
      "body": "let packed = fold(filter(line, v => v != 0), {out: [], locked: true, gained: 0}, (acc, v) => if not acc.locked and last(acc.out) == v then {out: set_at(acc.out, len(acc.out) - 1, v * 2), locked: true, gained: acc.gained + v * 2} else {out: push(acc.out, v), locked: false, gained: acc.gained}) in {cells: concat(packed.out, repeat(0, len(line) - len(packed.out))), gained: packed.gained}"
    },
    "can_move": {
      "params": { "b": "grid<int>" },
      "returns": "bool",
      "body": "any([up, down, left, right], d => any(lines(b, d), l => merge_line(map(l, c => b[c])).cells != map(l, c => b[c])))"
    }
  },
  "events": {
    "spawn_tile": {}
  },
  "inputs": {
    "slide": {
      "payload": { "dir": "ivec2" },
      "from": [
        { "swipe": "any",      "with": { "dir": "swipe.dir" } },
        { "key": "ArrowUp",    "with": { "dir": "up" } },
        { "key": "ArrowDown",  "with": { "dir": "down" } },
        { "key": "ArrowLeft",  "with": { "dir": "left" } },
        { "key": "ArrowRight", "with": { "dir": "right" } }
      ]
    }
  },
  "rules": [
    {
      "id": "setup",
      "on": "start",
      "do": [ { "emit": "spawn_tile" }, { "emit": "spawn_tile" } ]
    },
    {
      "id": "spawn",
      "on": "spawn_tile",
      "do": [
        { "let": { "spot": "pick(filter(cells(board), c => board[c] == 0))" } },
        { "set": "board[spot]", "to": "weighted([2, 4], [9, 1])" }
      ]
    },
    {
      "id": "slide",
      "on": "slide",
      "do": [
        { "let": { "before": "board" } },
        { "for_each": "lines(board, event.dir)", "as": "line", "do": [
          { "let": { "r": "merge_line(map(line, c => board[c]))" } },
          { "set": "board", "to": "write_line(board, line, r.cells)" },
          { "incr": "score", "by": "r.gained" }
        ] },
        { "if": "board != before", "then": [ { "emit": "spawn_tile" } ] }
      ]
    }
  ],
  "objectives": {
    "win": "any(values(board), v => v >= 128)",
    "lose": "not can_move(board)",
    "score": "score",
    "time_limit": "180s",
    "on_timeout": "lose"
  },
  "presentation": {
    "canvas": { "w": 360, "h": 640, "background": "$bg" },
    "tokens": {
      "bg": "#FAF8EF", "board": "#BBADA0", "dark": "#776E65", "light": "#F9F6F2",
      "tiles": ["#CDC1B4", "#EEE4DA", "#EDE0C8", "#F2B179", "#F59563", "#F67C5F", "#F65E3B", "#EDCF72"]
    },
    "root": {
      "node": "stack", "dir": "column", "gap": 24, "align": "center",
      "x": 180, "y": 320, "anchor": "center",
      "children": [
        { "node": "text", "text": "= 'Score: ' + str(score)", "size": 26, "weight": 700, "color": "$dark" },
        {
          "node": "group",
          "children": [
            { "node": "rect", "x": -8, "y": -8, "w": 344, "h": 344, "radius": 10, "fill": "$board" },
            {
              "node": "grid", "source": "board", "cell_size": 76, "gap": 8,
              "cell": {
                "node": "group",
                "children": [
                  {
                    "node": "rect", "w": 76, "h": 76, "radius": 6,
                    "fill": "= get_or($tiles, round(log2(max(value, 1))), '#3C3A32')",
                    "transition": { "fill": { "ms": 100, "ease": "out" } },
                    "animate_on": {
                      "spawn_tile": { "when": "value != 0", "prop": "scale", "keys": [0.9, 1.05, 1], "ms": 120 }
                    }
                  },
                  {
                    "node": "text", "w": 76, "h": 76, "align": "center", "valign": "middle",
                    "text": "= if value == 0 then '' else str(value)",
                    "size": "= if value >= 100 then 28 else 34", "weight": 700,
                    "color": "= if value <= 4 then $dark else $light"
                  }
                ]
              }
            }
          ]
        }
      ]
    },
    "feedback": [
      { "on": "slide", "do": [ { "sound": { "wave": "sine", "note": "A4", "ms": 40 } } ] },
      { "on": "win",   "do": [ { "sound": { "wave": "triangle", "note": "C6", "ms": 300 } } ] }
    ]
  }
}
```

Notes for the engine:
- **How `merge_line` works:** it folds over the non-zero tiles. A tile merges into the previous one only when the two are equal and the previous one isn't `locked`. `locked` starts out `true`, so the first tile has nothing to merge with, and it's set back to `true` after each merge, so a tile can merge at most once per move. Example: `[2,2,2,2]` → `[4,4,0,0]`, not `[8,0,0,0]`.
- The `spawn_tile` event can never hit `pick([])`. If a slide changed the board, either two tiles merged (which freed a cell) or a tile moved into an empty cell, so an empty cell always exists.
- `animate_on.spawn_tile` with `when: value != 0` makes every non-empty tile pulse. It's a known v0.1 limitation, because the presentation can't yet tell which cell was spawned. A fix would be to add `spot` to the event payload; see the open questions.

---

# Part D: Open questions to decide together

1. **Empty literals:** `[]` and `none` take their type from context, so the type checker must be bidirectional. Is that acceptable for v0.1?
2. **Collisions:** do we want collision *events* later (`on: collision(a, b)`), or should collisions stay as expressions inside `tick` rules?
3. **Event payloads for presentation:** should `spawn_tile` carry `{ spot }`, so that only the new tile animates? This is cheap to add.
4. **Images/sprites:** should an `image` node with asset references come in v0.2, or wait until we have generated assets?
5. **Separate file for presentation:** should `presentation` live in its own file, so the look can be regenerated without touching the game?
6. **Hit-testing transforms:** should taps respect `rotation` and `scale` on nodes, or only the untransformed box? Proposal: v0.1 uses the untransformed box.
