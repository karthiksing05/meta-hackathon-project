# Microgame engine

A Rust engine for `microgame/0.1` and `microgame/0.2` games: small JSON game
files that an AI writes and the engine validates, runs deterministically and
draws in the browser. The file format and the engine contract are in
[`docs/microgame-input-format.md`](../docs/microgame-input-format.md) (v0.1)
and [`SPEC-v0.2.md`](SPEC-v0.2.md) (v0.2 additions: assets, image/line/poly
nodes, camera, typed text, key up and any key, pointer anywhere, physics,
samples and music, particles and haptics; v0.2.1: hold buttons with
`on_press`/`on_release`, text `wrap` and outlines, feedback `when`; v0.2.2:
clipping groups, image crops with `src_*`, and `"hit": "shape"` polys). Three v0.1 games live in
[`fixtures/`](fixtures) and v0.2 examples in [`examples/`](examples).
`microgame catalog --json` lists everything a game file can use.

## How it fits together

```text
game.json ──mg-lang──▶ ir::Program ──mg-runtime──▶ Game (state, rules, timers)
                            │                         │
                            └────────mg-scene─────────┴──▶ Frame (draw ops, sound, music, haptics, toasts, shake)
                                                              │
                         mg-wasm (C ABI) ──▶ web/microgame.js ──▶ web/shell.js (canvas 2D, WebAudio)
                         mg-cli: validate / simulate / replay / bench / verify / catalog
```

| Crate | What it does |
|---|---|
| `mg-core` | Shared types: AST, types, IR, values, diagnostics, frames, RNG, stable hashing, limits |
| `mg-lang` | Parses the JSON and the expression strings, resolves names, type checks, lowers to IR. Reports diagnostics with JSON Pointer `at` and character `span` |
| `mg-runtime` | Runs the rules exactly as spec A10 says: inputs, then due timers, then one tick per step. Seeded RNG, state hash |
| `mg-scene` | Presentation: layout, text wrapping, bindings, tweens, `animate_on`, hit-testing for taps, drags, presses and releases, feedback. Builds the `Frame` |
| `mg-wasm` | Browser bindings with a plain C ABI (no wasm-bindgen), the JSON and binary frame encoders, and the input log for verifiable replays |
| `mg-cli` | The `microgame` command line tool and the end-to-end acceptance tests |

The browser shell has no game logic. It forwards pointer, key, swipe and text
events, steps the engine at a fixed 60 Hz and draws what the frame says.

## Build and test

Needs Rust with the `wasm32-unknown-unknown` target, and Node 18+ for the
smoke test.

```sh
cd engine
cargo test --release                  # all crates, including the B7 acceptance tests
./build-wasm.sh                       # → web/pkg/microgame.wasm, copies fixtures and examples to web/games/
node web/test-node.mjs                # loads the wasm through microgame.js, checks frames, verifies logs natively
```

The acceptance tests are in `crates/mg-cli/tests/acceptance.rs`:

- the three fixtures validate with zero errors;
- 50 seeds × 1,000 random inputs per fixture with zero runtime errors;
- the same file, seed and script give the same state hash;
- a renamed state variable gives `E_UNKNOWN_NAME` and a bool where an int is
  expected gives `E_TYPE_MISMATCH`, each with the right `at` and `span`;
- win and lose are reachable in every fixture: Lights Out is solved with taps
  from a GF(2) solver and lost on the timer, Snake wins with a pathfinding bot
  and loses into the wall, Number Merge wins with a corner strategy and loses
  by random play;
- the CLI's exit codes and output.

`crates/mg-cli/tests/verify_log.rs` records input logs through the WASM C ABI
(text, pointer, key down/up, camera and music games) and checks that they
verify natively and that tampered logs fail. `web/test-node.mjs` plays four
v0.2 examples as twin games (binary vs JSON frames, including image, line and
poly ops, wrapped and outlined text, synth sounds and music, and Lantern
Ridge's hold-to-move HUD buttons) and verifies their logs with the release CLI.

They also pass in debug builds, just more slowly.

## Command line

```sh
cargo run --release -p mg-cli -- <command> ...    # or target/release/microgame
```

| Command | What it does |
|---|---|
| `validate <game.json> [--json]` | Prints every diagnostic, with the expression and a caret under the span. `--json` prints the raw array. Exit 0 if there are no errors, 1 if there are, 2 for usage or IO problems |
| `simulate <game.json> [--seed N] [--random-inputs N] [--seeds K] [--dt 16] [--no-restart] [--json]` | Plays K seeds with N random inputs each: taps at random points inside the current tap targets (drags for draggable ones), key down/up pairs for every declared key (random printable and special keys for `"any"`), swipes in 4 directions, pointer down/move/up at random canvas points (for pointer sources), typed text (a few `change`s, then a `submit` of a word from a small list or a random string, up to 47 chars), and the odd miss. Steps 1–6 times between inputs and restarts a game when it ends. Reports runtime errors, when the first game ended, won/lost counts and the final state hash. Exit 1 on any runtime error |
| `replay <game.json> --script inputs.json [--seed N] [--dt 16] [--tail 16] [--state] [--json]` | Plays a timed script and prints phase, score, time and hash (and the state with `--state`) |
| `bench <game.json> [--seed N] [--steps 20000] [--dt 16] [--json]` | Compile time, steps per second, and µs per step, frame build, JSON encode and binary encode |
| `verify <game.json> --log log.json [--json]` | Replays an input log recorded in the browser and checks the claimed result. See [Challenges and verifiable replays](#challenges-and-verifiable-replays) |
| `catalog [--json]` | Everything a game file can use, for prompt generators: every builtin with its doc string, category, randomness and lambda argument (read from `mg-core/src/builtins.rs`), constants, types, operators, rule triggers, effects, input sources, objectives, assets, presentation sections, node kinds with their props and defaults, feedback actions, physics options, limits with values (read from `mg-core/src/limits.rs`) and diagnostic codes. A test checks it against the parser's keyword lists, so it can't drift silently |

Replay script entries, sorted by `t` (game ms). The game is stepped to each
`t` in `--dt` increments, then the entry is applied:

```json
[
  {"t": 0,    "key": "ArrowUp"},
  {"t": 300,  "swipe": "left"},
  {"t": 450,  "tap": [120, 300]},
  {"t": 500,  "down": [10, 10]}, {"t": 520, "move": [40, 10]}, {"t": 540, "up": [40, 10]},
  {"t": 600,  "input": "tap_cell", "with": {"cell": [2, 3]}},
  {"t": 700,  "key": "Space", "up": true},
  {"t": 710,  "char": "a"},
  {"t": 720,  "pointer": "down", "at": [100, 200]},
  {"t": 800,  "text": "submit", "value": "hello"},
  {"t": 3000}
]
```

`key` is a key down (`"up": true` for a key up); its char is `"char"` if the
entry has one, else derived from the code (`KeyA` → `a`, `Space` → space).
`char` types one character (a down and an up, code derived: `a` → `KeyA`).
`pointer` (`down`, `move`, `up`) hit-tests like a tap and falls back to the
pointer sources. `text` is `submit` or `change`. `{"t": ms}` on its own just waits. `--seed` defaults to `meta.seed`, then to
`0x5EED` (also the WASM default).

## Browser shell

```sh
./build-wasm.sh
cd web && python3 -m http.server 8000     # open http://localhost:8000
```

- `?game=word_rain` opens a fixture or example directly; add `&play=1` to
  skip the start screen (it waits for the assets).
- Pick one of the fixtures or examples, paste a `game.json`, open one, or
  drop one on the page. Invalid games show their diagnostics with the
  expression and the span highlighted.
- All games are compiled up front, so switching between them is instant.
- **Assets** load right after `load` (`game.assets()`): inline SVG becomes a
  Blob URL image (given an intrinsic size from `w`/`h` if it has none), URLs
  and data URIs load as images, and sounds are decoded into WebAudio
  `AudioBuffer`s. The Play button shows `Loading assets… n/m` until they are
  in (or 15 s pass). A missing or failed image draws a grey box with a cross;
  a missing sound is silent. Nothing crashes.
- **Input:** pointer down/move/up always go to `mg_pointer` (the engine hit-
  tests nodes, then falls back to pointer sources). Keyboard down and up go
  to `mg_key_event` with `KeyboardEvent.code` and the printable `key`. Swipes
  are 24 px or more on the dominant axis.
- **Text field:** when `meta.text_input` is set, an `<input>` sits over the
  canvas at `presentation.text_field` (or a bar at the bottom), with the
  game's placeholder and `max_len`. Every edit sends `change`; Enter sends
  `submit`, clears the field and sends `change ""`. While the field has focus,
  only Enter also reaches the game as a key. Clicking the canvas keeps focus
  in the field.
- **Output:** canvas 2D with rounded and stroked rects, circles, multi-line
  text boxes (with an optional outline under the fill),
  images (sprite-sheet frames, flips, rotation and scale around the center,
  opacity), lines and polygons; sizes to the viewport at the device pixel
  ratio. WebAudio synth notes, slides and jingles with volume, samples with
  playback rate, and music (one looping `AudioBufferSource` started and
  stopped from `frame.music`). Audio unlocks on the first click, tap or key.
  Haptics go to `navigator.vibrate` where it exists. Toasts and screen shake.
- The shell draws the start screen (title, instructions, Play) and the end
  screen (result, score, time, Play again). Enter or Space also works on
  both screens. The game steps at a fixed 60 Hz whatever the display rate
  (at most 6 steps per animation frame).
- `window.microgameShell.game()` is the current `Game` (for example
  `.log()` for its input log).

## WASM API

`web/microgame.js` wraps the module:

```js
import { Microgame } from './microgame.js';
const engine = await Microgame.init('pkg/microgame.wasm');
engine.validate(json);               // Diagnostic[]
const game = engine.load(json, seed); // throws MicrogameLoadError (with .diagnostics) if invalid
game.pointer('down', x, y);           // 'down' | 'move' | 'up', canvas units
game.keyEvent(e.code, e.key, true);   // v0.2 key down (false: up); true if it matched an input
game.key(e.code, e.key);              // v0.1: key down, tries each name in turn
game.text('submit', 'hello');         // v0.2: 'submit' | 'change'
game.assets();                        // v0.2: [{id, name, kind, src, svg, w, h, frames, cols, fps}]
game.swipe('left');                   // or game.swipe(dx, dy)
game.step(16);                        // → 'playing' | 'won' | 'lost'
game.frame();                         // decoded binary frame (fast path); frameJSON() for the B4 JSON
game.status();                        // { phase, score, time_ms }
game.log();                           // input log since load/restart (microgame-log/1)
game.restart(seed); game.state(); game.stateHash(); game.diagnostics(); game.meta; game.dispose();
```

`game.meta` is `{title, instructions, duration_s, seed, file_seed, canvas: {w,
h}, text_input, assets, warnings}`. `text_input` is `{placeholder, max_len, x,
y, w, h, size}` (placement `null` = the shell's default bar) or `null`.

Several games can be loaded at once. If the engine traps inside one game, that
game is dropped (`MicrogameCrash`) and the others keep running.

The raw exports use a plain C ABI. Inputs are UTF-8 bytes copied into memory
from `mg_alloc`. Outputs go to a shared result buffer read with
`mg_result_ptr()` / `mg_result_len()`. Negative returns are errors: `-1`
invalid game (diagnostics in the result buffer), `-2` bad handle, `-3` bad
arguments, `-4` too many games.

| Export | Returns |
|---|---|
| `mg_init()` | installs the panic hook (call once) |
| `mg_alloc(len)`, `mg_free(ptr, len)` | memory for inputs |
| `mg_validate(ptr, len)` | diagnostics JSON |
| `mg_load(ptr, len, seed_f64)` | handle ≥ 0, or -1 with diagnostics. `NaN` seed: `meta.seed`, else `0x5EED` |
| `mg_unload(h)`, `mg_forget(h)` | frees a game (`forget` skips destructors, for trapped games) |
| `mg_pointer(h, kind, x, y)` | kind 0 down, 1 move, 2 up |
| `mg_key(h, ptr, len)`, `mg_swipe(h, dx, dy)` | 1 if matched, else 0 |
| `mg_key_event(h, code_ptr, code_len, char_ptr, char_len, down)` | v0.2 key down (`down` 1) or up (0) with `KeyboardEvent.code` and the printable char (or empty). 1 if matched |
| `mg_text(h, kind, ptr, len)` | v0.2 typed text, kind 0 submit, 1 change. 1 if matched |
| `mg_assets(h)` | v0.2 JSON `[{id, name, kind: "image"\|"sound", src, svg, w, h, frames, cols, fps}]` in id order (sounds have `null` sizes) |
| `mg_log(h)` | the input log JSON (see below) |
| `mg_fork(h)` | new handle with an exact, independent copy of the game, scene and input log (`game.fork()`); cheap, for bot look-ahead. Unload it when done |
| `mg_step(h, dt_ms)`, `mg_phase(h)` | phase: 0 playing, 1 won, 2 lost |
| `mg_frame_json(h)`, `mg_frame_bin(h)`, `mg_frame_bin_reset(h)` | frame bytes ([binary format](web/FRAME_FORMAT.md)) |
| `mg_status(h)`, `mg_meta(h)`, `mg_state_json(h)`, `mg_diagnostics(h)` | JSON |
| `mg_state_hash(h)` | 16 hex digits |
| `mg_restart(h, seed_f64)` | `NaN` keeps the current seed |
| `mg_verify(ptr, len)` | replays a log against a game: `{ok, recomputed, problems, …}` (below) |
| `mg_panic_message()`, `mg_live_games()` | debugging |

## Challenges and verifiable replays

Shared sessions ("everyone plays seed 42 today") need every score to be
checkable. mg-wasm records every call that can change a game, from `mg_load`
or `mg_restart` on: `mg_step` dts, pointer, key, key events, swipes and text,
in order, each input with the number of steps that ran before it. It also
notes the frame builds between steps, because hit-testing and the camera use
the layout of the last built frame. The cost while playing is one compare
and an increment per step, one small `Vec` push per input, and a flag check
per frame.

`mg_log(h)` (`game.log()`) returns:

```json
{
  "format": "microgame-log/1",
  "seed": 42,
  "game_hash": "9c1f0e4b2d7a6358",
  "calls": [["S", 16.666666666666668, 240], ["K", 240, "Space", " ", 1], ["s", 16.666666666666668, 2],
            ["S", 16.666666666666668, 1], ["t", 243, 0, "hello"], ["p", 243, 0, 180.5, 320]],
  "final": {"state_hash": "4be0c1d29a7f3e15", "phase": "won", "score": 900, "time_ms": 4067}
}
```

- `game_hash` is the stable hash of the exact game file text, so a log only
  verifies against the file it was played on.
- `seed` is a number (a string if it's above 2^53).
- Calls: `["s", dt, n]` is `n` steps; `["S", dt, n]` is `n` × (step, then a
  frame build), which is what a 60 Hz shell produces, so a minute of play
  without input is one entry. `["f"]` is a lone frame build. Inputs:
  `["p", step, kind, x, y]` (kind 0 down, 1 move, 2 up), `["k", step, code]`,
  `["K", step, code, char, down]`, `["w", step, dx, dy]`,
  `["t", step, kind, value]` (kind 0 submit, 1 change).
- `final` is taken when `mg_log` is called.

In `web/test-node.mjs`, 10 s of Word Rain with a word typed every third of a
second logs 1.8 KB, and 10 s of Orbit Warden with frequent pointer and key
input logs 5 KB.

`microgame verify game.json --log log.json [--json]` replays the calls
through the same `Player` API from the same seed and recomputes the state
hash, phase, score and time. It exits 0 only if the game hash and all four
match `final`, and 1 otherwise, listing each mismatch (an edited score, a
removed input or step, a different game file). A call whose step index
doesn't match the steps replayed so far is reported too. `--json` prints
`{ok, game_hash_ok, steps, recomputed, claimed, problems}`.

The same check runs in WebAssembly: `mg_verify(ptr, len)` takes UTF-8 JSON
`{"game": <exact game file text>, "log": <log text or object>, "state"?: [names]}`
and returns the same `{ok, game_hash_ok, steps, recomputed, claimed, problems}`
plus `result`: the end values of the game's state after the replay. With
`state` (the manifest's `group_play.result.state`, e.g. `["ending",
"choices_used"]`) it holds just those names (unknown ones are `null`);
without it, every state variable. A server compares story endings and opinion
picks from this, never from the phone. In JS it is
`engine.verify(gameText, log, state?)` (or `Microgame.verify`), and in the app's
bundle `MicrogameEngine.verify(game_json, log, state?)`. So a Node server that loads
the engine bundle (the games generator already does) can verify a submitted
run without the native CLI. `mg_hit_targets` also counts as a frame build in
the log, since it builds the layout the next tap hits; the app's runtime calls
it before every tap.

A server can treat the log as the score submission: store it, run
`verify`, and rank by the recomputed score.

## Performance

Measured on an Apple Silicon Mac, release build, `microgame bench --steps 20000`
(random input every 8 steps, including the v0.2 sources). "Frame build" reuses
the previous frame when nothing changed, as the shell does.

| | Lights Out | Snake | Number Merge | Lantern Ridge | Orbit Warden | Word Rain |
|---|---|---|---|---|---|---|
| compile (`mg_lang::compile`) | 37 µs | 48 µs | 79 µs | 230 µs | 157 µs | 156 µs |
| step | 0.28 µs | 0.09 µs | 0.64 µs | 1.2 µs | 0.99 µs | 0.67 µs |
| frame build | 2.3 µs | 4.0 µs | 3.8 µs | 20.6 µs | 15.2 µs | 4.9 µs |
| ops per frame | 27 | 226 | 34 | 98 | 76 | 43 |
| JSON encode | 2.7 µs, 4.1 KB | 20.7 µs, 32 KB | 4.5 µs, 6.1 KB | 11.9 µs, 16.7 KB | 10.9 µs, 13.4 KB | 5.6 µs, 7.4 KB |
| binary encode | 0.18 µs, 1.4 KB | 0.97 µs, 10.9 KB | 0.54 µs, 1.8 KB | 0.45 µs, 4.5 KB | 0.36 µs, 3.0 KB | 0.44 µs, 2.1 KB |

Lantern Ridge (camera, physics, SVG sprites) and Orbit Warden (physics,
lines, polys, particles) rebuild most frames because things move every step.

In WASM (Node 26), step plus binary frame with a key event and a tap every 8
steps costs 14–18 µs per frame for Snake and Word Rain and 31–49 µs for Orbit
Warden and Lantern Ridge, and loading a game takes 0.4–1 ms. That is at most
0.3% of a 16 ms frame.

`web/pkg/microgame.wasm` is 1,092 KiB (389 KiB gzipped) at the profile's
opt-level 3, up from 874 KiB in v0.1 (the v0.2 parser, physics, particles and
scene code). Nearly all of it is the compiler, runtime and scene code.
`MG_WASM_OPT=z ./build-wasm.sh` makes it smaller and about 1.5–2× slower,
which is still well under budget. `wasm-opt` is applied automatically when it
is installed.

## Where the engine differs from or fills gaps in the spec

These are decisions taken while building v0.1. They belong in the next revision of
`docs/microgame-input-format.md`.

1. **`repeat` template key.** A12 calls the template `node`, but `node` already names the
   node kind, so JSON can't hold both. The template goes under `template` (alias `item`):
   `{"node": "repeat", "source": "meteors", "as": "m", "template": {"node": "circle", ...}}`.
2. **Objectives after `start`.** They're checked once, after the whole start cascade (start
   rules and everything they emit), not after each event in it. Otherwise Number Merge
   would lose at 0 ms, before its two `spawn_tile` events fill the empty board.
3. **Emit cascades.** Each input, timer or tick runs its whole chain of emitted events before
   the next input, timer or tick, so two slides in one step each get their own spawn.
4. **Timers** are taken one at a time, so a timer cancelled or replaced earlier in the same
   step doesn't fire.
5. **Limits** report `E_LIMIT` (not `E_RUNTIME`) and roll back the rule.
6. **Float division by zero** is a runtime error, like integer division by zero.
7. **Setting a vector component** (`set p.x`) isn't supported; set the whole vector.
8. **Hit-testing** uses untransformed boxes (Part D, question 6), and group rotation and
   scale don't pass down to children. v0.2.2: a `clip` group cuts its children's boxes to its
   own, and a `"hit": "shape"` poly also needs the point inside the polygon (nonzero winding,
   plain `+ - *` arithmetic, so replays hit-test the same everywhere).

`examples/meteor_dodge.json` is a fourth test game. It covers what the three fixtures
don't: drag, `repeat`, `tick`, circles, records, enums, `after`, `push` and `remove`.

## In the iOS app

The app runs microgames through its Bubble runtime (docs/BUBBLES.md 7.11). `web/render.js` is the
frame renderer shared by the browser shell and the app. `tools/make-app-bundle.mjs` packs
`web/microgame.js`, `web/render.js` and the WASM (base64) into one classic script,
`FacebookClone/Bubbles/Runtime/web/bubble-kit-microgame-engine.js`, which is committed. After any engine
change: `./build-wasm.sh && node tools/make-app-bundle.mjs` (`--check` tells you if it's stale).
`Microgame.initSync(bytes)` compiles synchronously for hosts with synchronous APIs, and
`game.hitTargets()` (`mg_hit_targets`) lists tap and drag targets for bots.
