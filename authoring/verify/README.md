# Verifier

One runner for every check on a built game, one report, and a fix flow that makes overlap
impossible to ship. No Muse calls: everything here is code.

| File | What it does |
|---|---|
| `verify.mjs` | The runner (module and CLI): `verify(game)` → report; `verifyAndFix(game)` → fixed game, report, proof. |
| `registry.mjs` | Checks and codes. Loads every module in `checks/`. |
| `frames.mjs` | Dense frames: replays the bot runs, a frame every 100 ms, plus intro, every end state and an idle run. |
| `scene.mjs` | Maps drawn ops to nodes and roles, and hit targets to the nodes that own them. |
| `checks/layout.mjs` | Text and overlap codes on every frame (the `L_*` lint at the blocking policy, plus `L_TEXT_ON_SPRITE`). |
| `checks/targets.mjs` | Tap targets: size, spacing, overlap, off-screen, tap-through. |
| `checks/style.mjs` | Adapter for the UI kit's `style-check.mjs` (`S_*`). |
| `checks/textfit.mjs` | `L_TEXT_FIT`: text fit with the longest content (every pool filled with its widest entry), the 12-unit canvas margin, panels and other text; `textFitFix`. The runtime draws through the same rule (`engine/web/render.js` `fitText`). |
| `checks/readability.mjs` | `S_READABILITY`: each word against the pixels behind it (10th-percentile contrast), composited in JS so it needs no Chrome (`authoring/kit/readability.mjs`). |
| `checks/look.mjs` | The look checks (`S_FONT_FAMILIES`, `S_TYPE_SCALE`, …): the game against its own fonts, scale and palette (`authoring/kit/README.md`). |
| `checks/requirements.mjs` | Adapter for `requirements-check.mjs` (`R_*`), when requirements are passed. |
| `checks/fill.mjs` | Adapter for `playtest/fill-check.mjs` (`F_*`): aspect, background coverage, HUD band, bleed bands, score owner. |
| `solve.mjs` | The layout solver, the last resort. |
| `prove.mjs` | Proof that a fix is presentation only: same rules, same replay state hashes. |
| `motion-track.mjs` | Motion sampling: a frame every 50 ms of each bot run (none dropped), per-node tracks, and the old shell's toasts and shake. |
| `motion.mjs`, `motion-fix.mjs`, `checks/motion.mjs` | The motion classes (`M_*`), their fixes and the check. |
| `motion-strips.mjs` | 50 ms strips around transitions, drawn as the old (`--shell old`) or current (`--shell new`) shell shows them. |
| `test-motion.mjs` | Motion tests on the Guess the Decade fixture (33). Needs `MG_ENGINE_DIR`. |
| `test-verify.mjs` | Tests (28). Needs `MG_ENGINE_DIR`. |

```sh
MG_ENGINE_DIR=<engine dir> node authoring/verify/verify.mjs <manifest-or-game.json>... [--fix] [--out=<dir>] [--runs=<runs.json>] [--json] [--no-pixels]
MG_ENGINE_DIR=<engine dir> node authoring/verify/test-verify.mjs
```

The CLI exits 1 when any game still has a blocking finding.

## The report

```js
{
  pass: true | false,            // no blocking findings
  score: 0..100,                 // 100 − 10 per blocking − 2 per warning
  blocking, warnings,
  findings: [{ code, severity: 'block' | 'warn', node /* JSON pointer */, frame /* "regular:play@12.4s" */,
               message, hint, frames /* how many frames showed it */, box?, other?, ... }],
  byCode: { L_OVERLAP_TEXT: { block, warn }, ... },
  coverage: { captured, unique, pixelFrames, endStates: { won, lost, timeout }, runs, tagged },
  checks: { ran: [...], skipped: [{ id, why }] },
}
```

## Frames: every frame, not samples

`frames.mjs` replays each bot run (the gate's runs when the caller has them, else two random-play
runs) with the same seed and inputs, and captures every 6th step (100 ms), the intro, the frame
where the run ends (won or lost) or the last frame (timeout), and an idle run that plays out the
clock. Exact repeats are checked once and counted. Text widths are measured in Chrome for every
text op of every frame; backdrop pixels (for contrast) for up to 160 frames: every intro and end
frame and the rest spread evenly. Other frames use the shapes-only contrast estimate, which skips
text over images.

When a fix moved a button, the replay remaps each tap to the same hit target (the same index in the
engine's topmost-first list, at the same relative spot), so the bots play the same game.

## Codes

Every code belongs to a failure class in `docs/games/FAILURE_CLASSES.md`, the one list of what a game must never show.

`block` stops the publish (or triggers repair); `warn` is reported only.

| Code | Severity | Meaning | Fix (in order) |
|---|---|---|---|
| `L_OVERLAP_TEXT` | block | text over text | solver slot |
| `L_TEXT_ON_SPRITE` | block | a text box crosses a sprite it isn't written on (a moving sprite crossing a label, a label half on a picture) | solver slot |
| `L_OVERLAP_HUD` | block | a moving sprite and the HUD overlap (either drawn on top) | code: HUD panel; solver slot for the HUD |
| `L_TEXT_FIT` | block | with the **longest** string of every content pool (a worst-case copy of the game) and as played: text past the canvas less 12 units, past its panel or button, or over other text (`checks/textfit.mjs`, Chrome-free font-average widths) | `textFitFix`, the text-fit stage of `verifyAndFix`: shrink on the game's scale (to 70 %, 11 min), then a `w` and `wrap` in the room |
| `L_TEXT_OVERFLOW` | block | text sticks out of its tile or button (measured width) | code: fit, shrink; solver: shrink to the measured room, wrap |
| `L_TEXT_CLIPPED` | block | text runs off the canvas | code: shrink; solver: shrink, wrap, then slot |
| `L_WORD_BREAK` | block | a word split across lines (the engine cuts a word longer than the line), or letter-spaced text that wraps | code: drop tracking, shrink to the role minimum, abbreviate HUD words, widen the box |
| `L_TEXT_OFFCENTER` | block | a cell label anchored on its tile's edge | code: center |
| `L_LOW_CONTRAST` | block under 3:1, warn under 4.5:1 for small text | text against the pixels behind it | code: recolor, plate, outline; solver: outline far from the text's color |
| `L_EMPTY_LABEL` | block | a key or tile with no visible label while its siblings have one | none (content) |
| `L_TARGET_SMALL` | block | a tap target under 40 units (44 pt) | solver: grow the grid cell or the button |
| `L_TARGET_GAP` | block | tap targets closer than 7 units (8 pt) | code: gap; solver: stack or grid gap |
| `L_OVERLAP_TARGETS` | block | two tap targets partly overlap | solver: gate the covered one |
| `L_OFFSCREEN` | block | a tap target mostly off the canvas | none yet |
| `L_TAP_THROUGH` | block | a tap on an overlay or end panel (no handler of its own) reaches a live target underneath. The engine sends a tap to the topmost *target*, so a plain panel doesn't stop it. Only counted when the tap would change the game's state at that frame | solver: the covered target's `visible` gets `and not (<overlay shown>)` |
| `L_TEXT_SMALL` | warn | text under 11 units (≈ 12 pt) | code: fit |
| `L_OVERLAP_CONTROL` | warn | a moving sprite covers a button | – |
| `L_OVERLAP_SPRITES` | warn | sprites overlap at the start | – |
| `L_INCONSISTENT` | warn | one repeated component drawn differently | – |
| `S_*` | as the style check says (`error` → block) | tokens and tree, before play | the UI kit |
| `S_FONT_FAMILIES`, `S_TYPE_SCALE`, `S_TEXT_COLORS`, `S_NEON_TEXT` | block | the game off its own look: families outside its pairing, sizes off its scale, literal or glowing text colours | `kit/look.mjs` `lookFix` |
| `S_READABILITY` | block | text under 4.5:1 (small) or 3:1 (large) in the worst 10 % of the pixels behind it, or small text on a busy background, on any sampled frame | `kit/readability.mjs` `readabilityFix`: palette colour, outline or soft plate, solid plate |
| `S_HUD_READABILITY` | block | a timer, score or other HUD readout (HUD-tagged text in the top or bottom band) under 4.5:1 at any size on any frame (`checks/hud.mjs`, FC-02) | the readability fixer held to 4.5:1 |
| `S_STRAY_SHAPE` | block | a still box that is empty in every frame, a large opaque panel in a literal colour far from the look's surfaces, or one a quarter off the canvas (`checks/shapes.mjs`, FC-10) | `layout-fix.mjs` `fixShapes` before the readability stage: hide an empty box, repaint an off-look panel `$surface` |
| `S_WEIGHT_MIX`, `S_ALIGNMENT`, `S_PALETTE_CLASH`, `S_THEME_MISMATCH` | warn | weights, ragged edges, palette vs backdrop, fonts vs the vibe | `lookFix` (fonts and weights) |
| `R_*` | a failed must blocks; others warn | the person's requirements | `requirements.mjs` repair |
| `F_BG_GAP`, `F_BACKDROP_SHORT`, `F_KEY_IN_BLEED`, `F_DOUBLE_HUD` | block | fill (`fill-check.mjs`): background gaps, key content under the phone's bars, two score HUDs | the fill fix |
| `F_ASPECT`, `F_HUD_OUT_OF_BAND`, `F_SCORE_HIDDEN` | warn | fill: canvas aspect, HUD outside its band, no score shown | the fill fix |
| `M_SHAKE`, `M_TEXT_UNSTABLE`, `M_PULSE`, `M_POP`, `M_TRANSITION_OVERLAP`, `M_TRANSITION_STYLE` | block | motion over contiguous frames (`checks/motion.mjs`, `motion.mjs`): excess or stacked shake, text that jumps, slides or over-pulses, icon over-pulse, pops and flicker, next labels on the last state's colours or particles over text, inconsistent fades (docs/games/FAILURE_CLASSES.md FC-50 to FC-55) | `motion-fix.mjs`, the motion stage of `verifyAndFix`: one 3-unit shake on the fail moment, fixed HUD slots, pulses capped, the look's fade on the events that change words, reveal transitions dropped, short bursts |
| `M_TEXT_HOLD` | warn | words up for less time than reading them takes (FC-56) | – (rules) |
| `V_SPRITE_DUP` | reserved (drop `checks/sprite-dup.mjs`) | two different things drawn with one sprite | (the sprite-distinctness check) |

Units: the canvas is 360 units wide and drawn about 390 pt wide, so 1 unit ≈ 1.08 pt.

## The fix order

`verifyAndFix(game, opts)`:

0. **Motion** (`motion-fix.mjs`, up to 2 rounds, before the look and readability stages): the `M_*` fixes.
0b. **Text fit** (`checks/textfit.mjs` `textFitFix`, after the look and readability stages, up to 2 rounds, each kept only if `L_TEXT_FIT` findings fall): shrink on the scale, then wrap, for the longest content.
1. **Verify** the built game.
2. **Code fixes** (`expander/layout-fix.mjs`): fit and center labels, target gaps, shrink, HUD panel,
   contrast. Kept only if blocking findings don't rise.
3. **Verify** again.
4. **Solver** (`solve.mjs`), up to 3 rounds, each kept only if blocking findings fall:
   - gate targets that taps reach through an overlay;
   - shrink and wrap text that doesn't fit;
   - **slots**: the screen has three fixed bands: the top HUD band, the play area and the bottom
     control band. On a 360 × 780 canvas they sit inside the safe area (`fill-check.mjs` `bands`),
     so nothing moves into the bleed bands; on a 360 × 640 canvas they are the top and bottom 14 %. An occupancy map marks every box anything covers in any frame (moving
     sprites leave their whole path; the backdrop and big plain panels don't count). Each UI node in
     an overlap finding (moved as a unit: itself, or the stack that lays it out; never a board or
     list item) gets the free slot of its size nearest where it was, in its own band first; its text
     shrinks (to 11 at the least) when nothing fits at full size;
   - outlines for text still under 3:1;
   - grow small targets and widen gaps where the canvas has room.
5. **Prove** (`prove.mjs`): everything outside `presentation`, every handler and the feedback block's sounds and haptics (shakes, toasts and particles may change)
   are identical; every bot run and an idle run replay to the same state hash after every input and
   at the end. If the proof fails, the original game ships with its findings (`reverted: true`).
   One exception is reported, not failed: a recorded tap that reached a target the fix hides under
   an overlay (`blockedTaps`), because blocking that tap is the fix.

The solver moves and shrinks presentation props only: `x`, `y`, `size`, `w`, `wrap`, `gap`,
`cell_size`, `stroke`, `stroke_width`, `visible`.

## Adding a check

Drop a module into `checks/` that exports `check` (or `checks`, a list):

```js
import { finding } from '../registry.mjs';
export const check = {
  id: 'sprite-dup',              // unique
  family: 'V',                   // your code prefix (see FAMILIES in registry.mjs)
  needs: ['frames'],             // any of: frames, game, built, requirements
  codes: { V_SPRITE_DUP: { severity: 'warn', title: 'two different things share one sprite', hint: 'draw …' } },
  async run(ctx) {               // ctx: {game, built, sample, measures, engine, probeTap, requirements}
    return [finding('V_SPRITE_DUP', { node: null, frame: ctx.sample.frames[0].key, message: '…' })];
  },
};
```

- `ctx.sample.frames`: `[{key, label ('intro' | 'play' | 'end-won' | 'end-lost' | 'end-timeout'), frame (the engine's frameJSON), targets (hit targets), run, step}]`; `ctx.sample.nodes` maps rotation tags to nodes.
- `scene.mjs`'s `analyze(ctx.sample, ctx.game, ctx.measures)` gives each frame's ops with node pointer, role and box, and hit targets with their owning node.
- A code belongs to one check; registering it twice throws. Severity is `block` or `warn`.
- Add the code to the table above, and a test to `test-verify.mjs`.

## Results on the 45 test builds (2026-11-13)

Kevin's 31 and 14 of the sponsored builds, from their built manifests, with the gate's bot runs
(60 s cap) plus an idle run. Blocking findings, one per code and node:

| Code | Built | After code fixes | After solver |
|---|---|---|---|
| L_LOW_CONTRAST | 137 | 40 | 2 |
| L_TEXT_CLIPPED | 55 | 24 | 12 |
| L_OVERLAP_TEXT | 52 | 48 | 19 |
| L_TEXT_ON_SPRITE | 45 | 50 | 28 |
| L_EMPTY_LABEL | 32 | 9 | 3 |
| L_TEXT_OVERFLOW | 30 | 16 | 18 |
| L_TARGET_GAP | 26 | 26 | 19 |
| L_TARGET_SMALL | 23 | 23 | 18 |
| L_OVERLAP_HUD | 14 | 4 | 5 |
| L_TEXT_OFFCENTER | 10 | 5 | 6 |
| L_OVERLAP_TARGETS | 4 | 4 | 6 |
| L_TAP_THROUGH | 4 | 4 | 0 |
| **Total** | **432** | **253** | **136** |
| Games passing | 0 | 2 | 9 |

All 45 fixed games pass the proof (rules identical, every replay hash identical; one bot tap that
went through an overlay is blocked by design). Hand-checking 12 flagged frames: 10 real (83 %);
both false ones were `L_EMPTY_LABEL` on rhythm lanes, now excluded.

What the solver can't fix yet, and why:
- **Boards and keyboards too dense for 44 pt** (about 25: `L_TARGET_SMALL`/`L_TARGET_GAP` on grid
  cells). A 10-key row or a 9 × 9 board can't have 40-unit cells and 7-unit gaps in 360 units.
  Needs a different control (a picker, zoom, fewer columns): a generation-time rule, not a fix.
- **Labels that belong to game pieces** (about 35: `+10` popups, a star on a moving cat, captions in
  board cells). The solver never moves board or list items: they move every instance.
- **Static labels in a busy playfield** (about 15: lane names under moving logs). No free slot on
  the screen at 11 units or more.
- **Dense option lists** (about 14, mostly s12): growing every chip to 44 pt pushes the panel off
  the screen, so the move is rejected.
- **Others** (about 47): row-stack HUDs whose column version trades one finding for another,
  overlapping targets with no visibility condition to gate on, and missing key labels (content).
