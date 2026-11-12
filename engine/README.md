# Microgame engine

A Rust engine for `microgame/0.1` games: small JSON game files that an AI
writes and the engine validates, runs deterministically and draws in the
browser. The file format and the engine contract are in
[`docs/microgame-input-format.md`](../docs/microgame-input-format.md).
Three complete games live in [`fixtures/`](fixtures).

## How it fits together

```text
game.json ──mg-lang──▶ ir::Program ──mg-runtime──▶ Game (state, rules, timers)
                            │                         │
                            └────────mg-scene─────────┴──▶ Frame (draw ops, sound, toasts, shake)
                                                              │
                         mg-wasm (C ABI) ──▶ web/microgame.js ──▶ web/shell.js (canvas 2D)
                         mg-cli: validate / simulate / replay / bench
```

| Crate | What it does |
|---|---|
| `mg-core` | Shared types: AST, types, IR, values, diagnostics, frames, RNG, stable hashing, limits |
| `mg-lang` | Parses the JSON and the expression strings, resolves names, type checks, lowers to IR. Reports diagnostics with JSON Pointer `at` and character `span` |
| `mg-runtime` | Runs the rules exactly as spec A10 says: inputs, then due timers, then one tick per step. Seeded RNG, state hash |
| `mg-scene` | Presentation: layout, bindings, tweens, `animate_on`, hit-testing for taps and drags, feedback. Builds the `Frame` |
| `mg-wasm` | Browser bindings with a plain C ABI (no wasm-bindgen), plus the JSON and binary frame encoders |
| `mg-cli` | The `microgame` command line tool and the end-to-end acceptance tests |

The browser shell has no game logic. It forwards pointer, key and swipe
events, steps the engine once per animation frame and draws what the frame
says.

## Build and test

Needs Rust with the `wasm32-unknown-unknown` target, and Node 18+ for the
smoke test.

```sh
cd engine
cargo test --release                  # all crates, including the B7 acceptance tests
./build-wasm.sh                       # → web/pkg/microgame.wasm, copies fixtures to web/games/
node web/test-node.mjs                # loads the wasm through microgame.js and checks frames
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

They also pass in debug builds, just more slowly.

## Command line

```sh
cargo run --release -p mg-cli -- <command> ...    # or target/release/microgame
```

| Command | What it does |
|---|---|
| `validate <game.json> [--json]` | Prints every diagnostic, with the expression and a caret under the span. `--json` prints the raw array. Exit 0 if there are no errors, 1 if there are, 2 for usage or IO problems |
| `simulate <game.json> [--seed N] [--random-inputs N] [--seeds K] [--dt 16] [--no-restart] [--json]` | Plays K seeds with N random inputs each: taps at random points inside the current tap targets (drags for draggable ones), every declared key, swipes in 4 directions, and the odd miss. Steps 1–6 times between inputs and restarts a game when it ends. Reports runtime errors, when the first game ended, won/lost counts and the final state hash. Exit 1 on any runtime error |
| `replay <game.json> --script inputs.json [--seed N] [--dt 16] [--tail 16] [--state] [--json]` | Plays a timed script and prints phase, score, time and hash (and the state with `--state`) |
| `bench <game.json> [--seed N] [--steps 20000] [--dt 16] [--json]` | Compile time, steps per second, and µs per step, frame build, JSON encode and binary encode |

Replay script entries, sorted by `t` (game ms). The game is stepped to each
`t` in `--dt` increments, then the entry is applied:

```json
[
  {"t": 0,    "key": "ArrowUp"},
  {"t": 300,  "swipe": "left"},
  {"t": 450,  "tap": [120, 300]},
  {"t": 500,  "down": [10, 10]}, {"t": 520, "move": [40, 10]}, {"t": 540, "up": [40, 10]},
  {"t": 600,  "input": "tap_cell", "with": {"cell": [2, 3]}},
  {"t": 3000}
]
```

`{"t": ms}` on its own just waits. `--seed` defaults to `meta.seed`, then to
`0x5EED` (also the WASM default).

## Browser shell

```sh
./build-wasm.sh
cd web && python3 -m http.server 8000     # open http://localhost:8000
```

- `?game=snake` opens a fixture directly; add `&play=1` to skip the start
  screen.
- Pick one of the three fixtures, paste a `game.json`, open one, or drop one
  on the page. Invalid games show their diagnostics with the expression and
  the span highlighted.
- All fixtures are loaded up front, so switching between them is instant.
- Input: pointer events mapped to canvas units, keyboard (`code`, then
  `key`), and swipes (24 px or more, dominant axis).
- Output: canvas 2D with rounded and stroked rects, circles and text boxes,
  rotation and scale around the center, opacity; sizes to the viewport at the
  device pixel ratio. WebAudio beeps, toasts and screen shake.
- The shell draws the start screen (title, instructions, Play) and the end
  screen (result, score, time, Play again). Enter or Space also works on
  both screens. The loop caps `dt` at 100 ms.

## WASM API

`web/microgame.js` wraps the module:

```js
import { Microgame } from './microgame.js';
const engine = await Microgame.init('pkg/microgame.wasm');
engine.validate(json);               // Diagnostic[]
const game = engine.load(json, seed); // throws MicrogameLoadError (with .diagnostics) if invalid
game.pointer('down', x, y);           // 'down' | 'move' | 'up', canvas units
game.key(e.code, e.key);              // true if it matched an input
game.swipe('left');                   // or game.swipe(dx, dy)
game.step(16);                        // → 'playing' | 'won' | 'lost'
game.frame();                         // decoded binary frame (fast path); frameJSON() for the B4 JSON
game.status();                        // { phase, score, time_ms }
game.restart(seed); game.state(); game.stateHash(); game.diagnostics(); game.meta; game.dispose();
```

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
| `mg_step(h, dt_ms)`, `mg_phase(h)` | phase: 0 playing, 1 won, 2 lost |
| `mg_frame_json(h)`, `mg_frame_bin(h)`, `mg_frame_bin_reset(h)` | frame bytes ([binary format](web/FRAME_FORMAT.md)) |
| `mg_status(h)`, `mg_meta(h)`, `mg_state_json(h)`, `mg_diagnostics(h)` | JSON |
| `mg_state_hash(h)` | 16 hex digits |
| `mg_restart(h, seed_f64)` | `NaN` keeps the current seed |
| `mg_panic_message()`, `mg_live_games()` | debugging |

## Performance

Measured on an Apple Silicon Mac, release build, `microgame bench --steps 20000`
(random input every 8 steps). "Frame build" reuses the previous frame when
nothing changed, as the shell does.

| | Lights Out | Snake | Number Merge |
|---|---|---|---|
| compile (`mg_lang::compile`) | 34 µs | 46 µs | 67 µs |
| step | 0.27 µs | 0.10 µs | 0.99 µs |
| frame build | 2.2 µs | 3.6 µs | 3.7 µs |
| ops per frame | 27 | 226 | 34 |
| JSON encode | 2.7 µs, 4.1 KB | 19.9 µs, 32 KB | 4.5 µs, 6.1 KB |
| binary encode | 0.18 µs, 1.3 KB | 0.96 µs, 10.9 KB | 0.58 µs, 1.7 KB |

In WASM (Node 26), step plus binary frame with input every 8 steps costs
10–15 µs per frame, and loading a game takes 0.2–0.6 ms. That is about 0.1% of
a 16 ms frame.

`web/pkg/microgame.wasm` is 874 KiB (313 KiB gzipped) at the profile's
opt-level 3. Nearly all of it is the compiler, runtime and scene code; the
bindings and encoders add about 30 KB. `MG_WASM_OPT=z ./build-wasm.sh` gives
676 KiB (251 KiB gzipped) and runs about 1.5–2× slower, which is still well
under budget. `wasm-opt` is applied automatically when it is installed.

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
   scale don't pass down to children.

`examples/meteor_dodge.json` is a fourth test game. It covers what the three fixtures
don't: drag, `repeat`, `tick`, circles, records, enums, `after`, `push` and `remove`.
