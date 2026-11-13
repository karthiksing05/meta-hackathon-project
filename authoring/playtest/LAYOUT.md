# Layout lint, layout fixes and the visual critique

Three pieces against Muse's "intersection" problem (text overflowing tiles, sprites over the HUD,
dark text on dark art, blank keys). All presentation only: rules, state and inputs never change,
so seeds and replays still verify.

| File | What it does |
|---|---|
| `playtest/layout-check.mjs` | The dynamic lint. Plays the game for 2 seeds plus an idle run, captures intro, mid, end and every 1.5 s, and checks the engine's draw list. `L_*` codes. |
| `playtest/frame-render.mjs` | Draws frames in headless Chrome with the engine's own `render.js`: real text widths, backdrop pixels under each text, PNGs. |
| `expander/layout-fix.mjs` | Code fixes, no Muse: fit, center, gap, shrink, HUD panel, contrast. |
| `playtest/visual-critique.mjs` | The vision judge, a fixed checklist (`V_*`), one layout-only repair per round, at most 2 rounds. |
| `playtest/test-layout.mjs` | Tests (35). Needs `MG_ENGINE_DIR`; pixel checks need Chrome. |

```sh
MG_ENGINE_DIR=<engine dir> node authoring/playtest/layout-check.mjs <manifest-or-game.json>... [--no-pixels] [--json]
MG_ENGINE_DIR=<engine dir> node authoring/playtest/test-layout.mjs
```

## How ops map to nodes

Frame ops carry no node ids, so the lint loads an instrumented copy in which each drawable node's
`rotation` (circles: `r`) is nudged by id × 1e-5 (at most 0.05°, ignored by hit-testing). Findings
name the node by JSON pointer (`/presentation/root/children/1/children/0/cell/children/2`).
Roles: `backdrop` (≥ 70 % of the canvas), `hud` (a counter text and its small group, in the top 20 %
or bottom 12 %), `target` (has `on_tap`/`on_press`/`on_drag`), `actor` (moves between frames),
`label`, `shape`.

## Codes

| Code | Severity | Meaning | Static twin in the kit's `style-check.mjs` |
|---|---|---|---|
| `L_TEXT_OVERFLOW` | error | text sticks out of the tile/button it sits on (measured width) | – |
| `L_TEXT_OFFCENTER` | error | a cell label anchored on its tile's edge | – |
| `L_TEXT_CLIPPED` | error | text runs off the canvas | – |
| `L_TEXT_SMALL` | warn | size under 11 units (≈ 12 pt) at play size | `S_*` type scale |
| `L_OVERLAP_TEXT` | error | text over text | – |
| `L_OVERLAP_HUD` | error/warn | a moving sprite drawn over the HUD (error) or under it with no panel (warn) | – |
| `L_OVERLAP_CONTROL` | warn | a moving sprite covers a button | – |
| `L_OVERLAP_SPRITES` | warn | sprites overlap at the start | – |
| `L_OVERLAP_TARGETS` | error | two tap targets overlap | – |
| `L_TARGET_GAP` | warn | under 4 units between targets | – |
| `L_TARGET_SMALL` | warn | a target under 40 units (44 pt) | `S_*` target size |
| `L_LOW_CONTRAST` | error < 2:1, else warn | text against the pixels actually behind it (20th percentile, outline-aware), AA 4.5 / 3 for large | `S_*` contrast (token pairs) |
| `L_OFFSCREEN` | warn | a target mostly off the canvas | – |
| `L_EMPTY_LABEL` | error | a key or tile with no visible label while its siblings have one | – |
| `L_INCONSISTENT` | warn | instances of one repeated button/tile drawn with different sizes, radii or fonts | – |

The `S_*` codes check tokens and the tree before anything runs; the `L_*` codes check what is drawn.
Where both exist, the `L_*` one is the measured result (contrast against real art, target size after
layout), so a game can pass `S_*` and still fail `L_*`.

## Code fixes are the fallback

`layout-fix.mjs` is for games that don't use the UI kit's components. The kit's text-fit tiles, HUD
bar and buttons do the same jobs by construction; when a game uses them, these fixes find nothing to
do. Order: fit and center (tree), gap (tree), shrink (from findings, 2 rounds), HUD panel (from
findings; a solid `$bg` panel, then the HUD drawn last), contrast (recolor to the palette color that
reads best on an even backdrop, else a solid plate, else an outline). Each step is validated with
the engine and dropped if the game stops loading.

## Critique loop

`critiqueLoop(game, {judge, repair, request, style})`. `museVision({key})` gives a Muse judge and
repairer (`muse-wonder-1.0` with image input). Checklist: `V_OVERLAP`, `V_LEGIBLE`, `V_HIERARCHY`,
`V_SUBJECT`, `V_STYLE`, `V_CONSISTENT` (the same component looks the same in every frame). The repair
may set only layout props (`LAYOUT_KEYS`) and insert plain rects; a round is kept only if the lint's
errors don't rise and the judge's failures fall.
