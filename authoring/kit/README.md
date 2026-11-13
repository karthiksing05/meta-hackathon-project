# Look kit: each game's own fonts and type scale

There is no house style: standardized fonts made every game look the same. Each game gets a
**look** from its own vibe instead: its theme, era, genre and style words pick a vibe, and the
game id picks one of that vibe's pairings and a modular scale. Two games with the same vibe can
still differ.

| File | What it does |
|---|---|
| `vibes.mjs` | The vibe table: 27 vibes, each with match words, a system fallback stack and 2–3 pairings. Plus `BOLD`: 1–3 characterful pairings per vibe (Rye, Creepster, Nosifer, Luckiest Guy, Bagel Fat One, Monoton, Faster One, …) that `chooseLook(words, id, {characterful: true})` and the art pipeline (`artdir/kit.mjs`) pick first; display faces for titles, HUD numbers and big words, always on a readable text face. |
| `look.mjs` | `chooseLook`, `lookFromChoice`, `applyLook`, `lookCheck`, `lookFix`, `lookForBuilt` (pure JS; the Studio bundle packs it). |
| `font-data.mjs` | Generated facts per bundled font (family, role, kind, weights, average advance). |
| `readability.mjs` | `S_READABILITY`: every word against the pixels behind it, and the fix (palette colour → outline or soft plate → solid plate). |
| `raster.mjs`, `jpeg.mjs` | The Chrome-free compositor: engine draw lists, SVG sprites, PNG and baseline JPEG pictures. |
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

## Variation inside a pairing

The game id also varies the pairing's details (`varyPairing` in `look.mjs`), so two games of one
vibe look related but not identical: title case (upper or as written, never for script or
blackletter faces), label weight, tracking (hair spaces, U+200A, between the letters of short
display lines and capital labels, only on text that keeps to one line in its box: the engine draws no letter spacing and would cut a tracked word), the display treatment (one
step to a neighbour: none ↔ outline ↔ heavy), the numerals face (from the vibe's own numerals), and
for sporty vibes (`racing_sport`, `cartoon_action`, `meme_brainrot`, `game_show`) a 2–7° tilt on
short display lines in about half the games.

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

## Readability (`S_READABILITY`, block)

`readability.mjs` composites up to 36 sampled frames per game in JS (`raster.mjs`: rects, circles,
lines, polys, clips, SVG sprites through a small SVG rasterizer, PNG pictures through
`image-codec.mjs`, baseline JPEG backdrops through `jpeg.mjs`), with the text left out. For each text
op it takes the pixels under the ink box and the 10th-percentile WCAG contrast of the text colour
(at its opacity) against them. Small text needs 4.5:1, large text (≥ 22, or bold ≥ 700 at 18.5+)
3:1; small text on a busy background (luminance spread over 0.13) fails without an outline even
when the contrast passes. An outline of 2+ units that contrasts 3:1 with the fill is the ground the
glyphs sit on. Fades (an op fainter than its node's own opacity) are skipped. No Chrome needed, so
it runs on the generator's server; `verify/checks/readability.mjs` registers it.

The fix, in order, presentation only:
1. A text colour from the game's palette that passes on every failing frame (`<role>_ink`, then ink
   and the on-colours, then the grounds; never neon for big text). One choice per (colour, step),
   so a role keeps one colour. Colour expressions get a replacement per token they can pick.
2. The look's treatment: display text, and text with no box, gets an outline in the palette ground
   that contrasts most (3 units for heavy looks and big type, else 2). Body text gets a soft plate:
   a palette ground at 85 % (`$plate`) with the look's corner radius (0 for pixel vibes, 12 for
   cute and cartoon ones, 4 for classic ones, else 8), hugging a literal centred line.
3. A solid plate (`$plate_solid`) when the soft one isn't enough.

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
