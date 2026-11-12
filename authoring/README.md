# Microgame authoring layer

This folder turns what Muse writes, an authoring manifest, into a `microgame/0.1` `game.json` for Artem's
Rust/WASM engine, checks it, and has bots play it before it ships. `SPEC.md` defines the formats.

| Folder | What's in it |
|---|---|
| `fragments/` | 33 reusable game pieces. Core: lives, score, countdown. Movement: player_drag, lanes, gravity_jump, collide, pickups. Action: spawn_wave, speed_ramp, combo, timer_bar. Pacing: rounds (finite play), endless (endless play), waves, difficulty_curve, checkpoint, daily_seed. Boards and words: grid_board, match_pairs, hint, keyboard, word_check, tile_slide, sequence_memory, sort_bins, quiz. Story: choice_story, reveal. Social: ghost_score, beat_target, turns, shared_progress |
| `looks/` | Look presets: tokens, a font and the slot layout |
| `games/` | 20 authoring manifests: the three engine fixtures (Number Merge now on `tile_slide`) and 17 originals. Action: Fog Dodge, Golden Hour, Tide Taps, Lantern Lane, Meadow Hop, Snail Patrol. Puzzle and words: Lantern Letters, Hangout Words, Postcard Pairs, Daily Garden Pairs, Chime Circle, Picnic Packers, Quiz Night. Story: Kite Day Detour, Firefly Note. Social: Friend Dash (a friend's ghost and target), Bullseye Relay (pass-and-play with a Group total) |
| `expander/` | The expander, the source map, the engine loader and a command-line tool |
| `playtest/` | The bot playtest gate, a port of beta's `StudioPlaytest` |
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
