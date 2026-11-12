# Microgame authoring layer

This folder turns what Muse writes, an authoring manifest, into a `microgame/0.1` `game.json` for Artem's
Rust/WASM engine, checks it, and has bots play it before it ships. `SPEC.md` defines the formats.

| Folder | What's in it |
|---|---|
| `fragments/` | 33 reusable game pieces. Core: lives, score, countdown. Movement: player_drag, lanes, gravity_jump, collide, pickups. Action: spawn_wave, speed_ramp, combo, timer_bar. Pacing: rounds (finite play), endless (endless play), waves, difficulty_curve, checkpoint, daily_seed. Boards and words: grid_board, match_pairs, hint, keyboard, word_check, tile_slide, sequence_memory, sort_bins, quiz. Story: choice_story, reveal. Social: ghost_score, beat_target, turns, shared_progress |
| `looks/` | Look presets: tokens, a font and the slot layout |
| `games/` | 20 authoring manifests: the three engine fixtures (Number Merge now on `tile_slide`) and 17 originals. Action: Fog Dodge, Golden Hour, Tide Taps, Lantern Lane, Meadow Hop, Snail Patrol. Puzzle and words: Lantern Letters, Hangout Words, Postcard Pairs, Daily Garden Pairs, Chime Circle, Picnic Packers, Quiz Night. Story: Kite Day Detour, Firefly Note. Social: Friend Dash (a friend's ghost and target), Bullseye Relay (pass-and-play with a Group total) |
| `expander/` | The expander, the source map, the engine loader and a command-line tool. `studio.mjs` is the API the app's Studio uses; `stable.mjs` makes games survive key-sorted JSON (Swift) |
| `playtest/` | The bot playtest gate, a port of beta's `StudioPlaytest`: `gate.mjs` (Node worker threads), `gate-async.mjs` (one thread, `fork()` look-ahead, for the app), shared bots and analysis in `bots.mjs` |
| `tools/` | `make-seeds.mjs` (the `mg-*` seed Bubbles), `make-studio-bundle.mjs` (the app's Studio bundle) and `test-studio-bundle.mjs` |
| `examples/snake/` | The hand expansion that checked the format against Artem's Snake |

## Running it

The tools need a built engine. Until `engine/` is on this branch, build it from Artem's `rust-engine` branch:

```sh
mkdir -p /tmp/mg && git archive origin/rust-engine engine | tar -x -C /tmp/mg
(cd /tmp/mg/engine && ./build-wasm.sh)          # needs rustup and the wasm32-unknown-unknown target
export MG_ENGINE_DIR=/tmp/mg/engine
```

Then:

```sh
node authoring/expander/cli.mjs authoring/games/snake.authoring.json -o snake.json   # expand + validate
node authoring/playtest/run.mjs                                                      # every game: expand, validate, playtest
```

Engine and authoring diagnostics come back mapped to the manifest. Ones that land inside a fragment or a
look are marked `library`: they're our bugs, not the model's.

## Art, sound and feel

A manifest can carry the game's own `art` (palette, font, backdrop and SVG sprites), `sound` (a sound
set, per-moment overrides, volume and music) and `feel` (particles, shake, haptics on or off): SPEC.md
2.8–2.10, with a block for Muse's prompt in 2.11. Fragments draw the game's sprite for each role they
declare (SPEC 1.7) and fall back to plain shapes, and they give feedback by default (1.8). The code is
in `expander/art.mjs`, `expander/sound.mjs` (sound sets, presets and the music synth) and
`expander/svg.mjs` (the SVG sanitizer), all pure JS with no Node imports. Fog Dodge, Friend Dash,
Postcard Pairs, Number Merge and Kite Day Detour have hand-made art and sound; the other games use the
fallbacks.

```sh
node authoring/expander/test-art-sound.mjs      # sanitizer, art, sound and fallback unit tests
```

## In the app's Studio

Muse Studio runs this layer in a hidden web view (docs/BUBBLES.md 7.12). `tools/make-studio-bundle.mjs`
packs `expander/studio.mjs` and everything it imports into one classic script,
`FacebookClone/Bubbles/Studio/web/microgame-studio.js` (committed), with the fragments, looks, the
engine's `catalog --json`, the model-facing parts of `SPEC.md` and three example games as data. Rebuild
it after changing fragments, looks, the expander, the gate, `SPEC.md` or the engine:

```sh
node authoring/tools/make-studio-bundle.mjs      # needs cargo (runs the engine's catalog); --check: is it current?
node authoring/tools/test-studio-bundle.mjs      # loads the bundle in a Node vm, expands, validates and gates
                                                 # 3 games and compares with the Node gate; --all for all 20
```

