# Runtime tests

Checks for the Bubble runtime in `FacebookClone/Bubbles/Runtime/web/` (docs/BUBBLES.md 4.3, 4.6
and 4.8, plus LOOKS.md). No npm packages: Node, the system JavaScriptCore shell and Chrome are
enough.

## Run

```sh
node tools/runtime-tests/run-node.js            # full run (Node, CPU-time budgets)
node tools/runtime-tests/run-node.js --quick    # fewer bot runs
tools/runtime-tests/run-jsc.sh                  # the same checks inside JavaScriptCore
node tools/runtime-tests/run-node.js --web DIR --seeds DIR   # test another copy (a kits workspace)
```

Both exit non-zero on a failure. `run-jsc.sh` uses
`/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc` (override with `JSC=`)
and loads the files in `BubbleJSRuntime.orderedScriptNames` order, with no DOM, like the app.

## What they check

| File | Role |
|---|---|
| `load.js` | Loads the runtime in a fresh Node `vm` context with no DOM, in the app's file order |
| `checks.js` | The shared suite (`BubbleRuntimeChecks.run(env)`), run by both engines |
| `run-node.js` | Node-only checks (load order, no DOM, host page script list), then `checks.js` |
| `run-jsc.sh`, `jsc-main.js` | `checks.js` inside JavaScriptCore |
| `microgame-verify.js` | Every `mg-*` seed's bot runs pass `MicrogameEngine.verify`; raised scores don't |
| `microgame-text.js` | Typed text (the native text field, docs/BUBBLES.md 7.11) through the real runtime on `mg-ferry-call`: score, `text` log entries, replays, verify, bots |
| `microgame-chrome.mjs` | Plays `mg-*` seeds in `bubble-host.html` in headless Chrome, including typing into the text field |

`checks.js` covers:

- **Catalog**: formulas, concepts, param metadata, `looks`, `fonts`, `motifs`, `color_roles`, `poster_ticks`.
- **Seeds**: every seed whose formula is loaded validates; the six engine seeds keep `_seed`,
  form `chain-hill-hopper` (level 2 harder), use the demo world's words and picnic guests, and each
  has its own look, font, motif, readable custom colors and a cover prompt.
- **Bot runs** at skills 0.2, 0.5 and 0.9: sane outcomes, runs end, skill helps, share text.
- **Determinism**: same options give the same run; replays reproduce score, ticks and events.
- **Looks**: example colors validate with 4.5:1 ink; unknown look is a `style` error; bad hex
  and low contrast are `style_contrast` warnings; a run is identical in every look.
- **Posters**: `Bubble.posterRun` stops at the kit's poster moment (picnic: first fact with all
  portraits, nobody picked; Fog Words: a guess half typed) and is deterministic.
- **Negative cases**: unknown concepts and formulas (with "Did you mean"), bad params, wiring,
  requires and conflicts, structure, glue sandbox errors, throwing or endless glue.
- **Speed**: catalog, validate, createSession and a 90 s run. Budgets only apply on the CPU clock
  (Node), because wall time on a busy machine mostly measures the neighbors.

## Look at it

Open in Chrome (over `file://` start Chrome with `--allow-file-access-from-files`):

- `preview.html?seed=hill-hopper&mode=demo`: boots a seed in the real host. Params are listed at
  the top of the file: `mode` (play, demo, replay, poster), `look`, `palette`, `font`, `motif`,
  `colors=example`, insets `top/bottom/left/right`, `poster=1` (the `BubbleHost.poster()` image at
  full size), `guides=1` (shades the insets), `images=stand-in`, `debug=1` (message log).
- `primitives.html`: every `g` primitive in every look, light and dark.

Headless screenshot (sequential runs only; parallel runs sharing a profile drop shots):

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --allow-file-access-from-files --force-device-scale-factor=2 --window-size=390,844 \
  --virtual-time-budget=5000 --screenshot=out.png \
  "file://$PWD/tools/runtime-tests/preview.html?seed=hill-hopper-2&mode=demo"
```
