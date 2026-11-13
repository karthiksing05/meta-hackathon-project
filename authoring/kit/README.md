# Look kit: each game's own fonts and type scale

There is no house style: standardized fonts made every game look the same. Each game gets a
**look** from its own vibe instead: its theme, era, genre and style words pick a vibe, and the
game id picks one of that vibe's pairings and a modular scale. Two games with the same vibe can
still differ.

| File | What it does |
|---|---|
| `vibes.mjs` | The vibe table: 27 vibes, each with match words, a system fallback stack and 2–3 pairings. |
| `look.mjs` | `chooseLook`, `lookFromChoice`, `applyLook`, `lookCheck`, `lookFix`, `lookForBuilt` (pure JS; the Studio bundle packs it). |
| `font-data.mjs` | Generated facts per bundled font (family, role, kind, weights, average advance). |
| `make-fonts.mjs` | Writes `font-data.mjs` and the app's `game-fonts.css` from `authoring/fonts/`. `--check` reports stale files. |
| `look-sheets.mjs` | Before/after contact sheets, the proof and verifier counts, and the same-vibe twin sheet. |
| `test-look.mjs` | Tests (library, licences, table, choosing, applying, checks, expander, regions). |

The font library itself (licences, sources, metrics, how the files were subset) is in
`authoring/fonts/README.md`: 52 families, 72 files, 1.1 MB of woff2 in
`FacebookClone/Bubbles/Runtime/web/gamefont-*.woff2`.

## A pairing

`display` (hero, display and, when `title: 'display'`, title text), `text` (body, labels,
captions), optional `numerals` (scores, timers, counters), case rules (`display` and `label`:
`upper` or `asis`), tracking (recorded; the engine draws no letter spacing yet), weight rules
(which of the text font's two weights labels and titles use), a treatment (`none`, `outline`,
`heavy`: an engine text stroke under display text in the ground colour that contrasts most), a
ratio range and a body-size range.

## The scale

Six steps around the body size `b` with the ratio `r`: caption `b·r^-1.25`, label `b·r^-0.5`, body
`b`, title `b·r^1.5`, display `b·r^3`, hero `b·r^4.5`, each scaled by the font's width (its
average advance against the 0.56 em the kit's boxes assume, so wide faces like Press Start are set
smaller) and kept near the kit's own steps. A game's existing sizes map onto steps by bands
(≥ 40 hero, ≥ 26 display, ≥ 19 title, ≥ 16 body, ≥ 14 label).

## In the pipeline

- **At generation:** the plan's words go to `chooseLook(words, gameId)`; its compact form
  `lookChoice(spec)` = `{kit: 'look/1', vibe, pairing, seed}` goes in the manifest as `art.type`.
  The expander applies it (`expand.mjs`, after the presentation is built), and `art.font` may name
  any bundled family.
- **On a built game:** `verify/checks/look.mjs` runs the `S_*` look checks against `art.type`, or
  against the look its words and id pick when it has none. `lookFix(game, spec)` sets the game on
  its look: fonts, weights, sizes (literals and the numbers an `if … then … else` picks), text case,
  literal text colours snapped to the nearest palette token (lightness weighted, so contrast stays),
  a softer tone of the palette colour for big neon text, and the display outline. Presentation only:
  `prove.mjs` holds on every game tried.

## Codes

Severities hold for a game with `art.type`. A game without one (built before the kit) gets every
finding as a warning, since its look is only inferred.

| Code | Severity | Finding |
|---|---|---|
| `S_FONT_FAMILIES` | block | more than 2 families (3 with numerals), or one from outside the pairing |
| `S_TYPE_SCALE` | block | a size off the game's own scale |
| `S_TEXT_COLORS` | block | a literal text colour instead of a palette token |
| `S_NEON_TEXT` | block | big (≥ 22) or long text in a fully saturated, bright colour |
| `S_WEIGHT_MIX` | warn | more than two weights of one family |
| `S_ALIGNMENT` | warn | static text on too many edges and centres |
| `S_PALETTE_CLASH` | warn | primary and accent both off the backdrop's hues |
| `S_THEME_MISMATCH` | warn | the headline font isn't one of the vibe's fonts (games without `art.type`) |

## Fonts on the phone and in Chrome

- `bubble-host.html` links `game-fonts.css`. `bubble-kit-microgame.js` starts loading every face when
  the host page loads, and a game whose fonts aren't in yet draws its first frames without text for
  at most 1.2 s (drawing only; the engine steps the same).
- Each `@font-face` lists `local()` system faces of the same kind after the woff2, so a font that
  can't load falls back to the nearest iPhone face (`SYSTEM_STACKS` in `make-fonts.mjs`).
- `playtest/frame-render.mjs` (the verifier's and the sheets' Chrome) declares the same faces by
  absolute path and waits for the game's fonts before it measures or draws.

## Regions

`kitRegions(canvas)` in `expander/ui-style.mjs`: on the tall 360 × 780 canvas the HUD band is
y 114–162, the play area y 174–496 and the control band y 508–660 (152 tall), all inside the safe
area y 110–684.
