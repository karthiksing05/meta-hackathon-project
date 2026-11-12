# Microgame authoring layer

This folder turns what Muse writes, an authoring manifest, into a `microgame/0.1` `game.json` for Artem's
Rust/WASM engine, checks it, and has bots play it before it ships. `SPEC.md` defines the formats.

| Folder | What's in it |
|---|---|
| `fragments/` | Reusable game pieces: lives, score, countdown, spawn_wave, speed_ramp |
| `looks/` | Look presets: tokens, a font and the slot layout |
| `games/` | Authoring manifests: the three engine fixtures plus one game each for dodge, timing and guess |
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
