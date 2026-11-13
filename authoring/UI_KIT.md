# Game UI kit and style contract (`game-style/1`)

Muse's games looked amateur because Muse placed every rect, text and sprite itself, at x/y it
invented, in sizes and colours it invented. The result overlapped, overflowed and clashed. Games
Claude makes look good because they follow a small design system. This kit takes the design
decisions away from Muse and makes them deterministic, in code:

| Piece | File | What it does |
|---|---|---|
| Tokens | `expander/ui-style.mjs` | The 4 pt grid, 5 type steps, palette roles with on-colours (WCAG AA computed), radii, strokes, elevation, motion. Muse picks only a theme and a few knobs. |
| Text fitting | `expander/ui-text.mjs` | Shrink one type step at a time to the minimum, then wrap, then ellipsize. Never overflow. A port of the engine's own text measure. |
| Components and layout | `expander/ui-kit.mjs` | Components that take content and roles, not coordinates; the layout pass that gives every game the same regions; the HUD bar. |
| Hardware check | `expander/style-check.mjs` | A static check of the manifest's own nodes against the contract, with deterministic auto-fixes (`S_*` codes). |

Credits: the HUD bar follows Bayan's HUD-panel findings (`harness/layout-experiment/hud.mjs`: a
solid panel behind the counters, 4.5:1 text, small HUD type, no big scale pulses), and the
palette roles and families build on his style-kit vocabulary (`harness/style/`).

## 1. Tokens

Muse writes one small block. Everything else is derived.

```json
"ui": { "kit": "game-style/1", "theme": "night", "base": "#00E5FF", "accent": "#FFD23F", "family": "rounded", "density": "regular" }
```

| Knob | Values | Default |
|---|---|---|
| `theme` | `bright soft paper mono retro` (light), `night neon dusk` (dark) | `bright` |
| `base` | the subject's colour, `#RRGGBB`: the primary hue | `#4A6CF7` |
| `accent` | optional second colour; otherwise a hue shift set by the theme | |
| `family` | `rounded soft sharp pixel storybook`: radii, strokes, elevation, fallback font | `rounded` |
| `density` | `roomy regular compact`: control height 56/52/48, gaps | `regular` |
| `palette` | instead of `base`: adopt an existing palette (hues kept, lightness moved until AA passes). The style check writes this when it migrates an old game. | |

Derived:

- **Grid:** 4 pt. Spacing steps `xs 4, s 8, m 12, l 16, xl 24, xxl 32`.
- **Type:** `display 32/800, title 22/700, body 17/500, label 15/700, caption 13/600`. Nothing under
  13 at play size.
- **Palette roles** (engine tokens): `bg surface surface_2 ink ink_muted primary secondary accent
  danger success line scrim shadow`, plus `on_<role>` (text on a filled role, ≥ 4.5:1) and
  `<role>_ink` (a role colour safe for small text on `bg`/`surface`, ≥ 4.5:1). `ink` is ≥ 7:1 on
  `bg` and ≥ 4.5:1 on both surfaces; colour roles are ≥ 3:1 on `bg` and `surface` (UI parts and big
  text).
- **Radii/strokes** by family, **elevation** as an offset `$shadow` rect, **motion**
  `fast 120 / base 180 / slow 280 / pop 170 (spring)`.
- **Touch:** every tap target ≥ 44 × 44.

With a `ui` block the kit owns the seven standard roles (it overrides `art.palette`). Without one,
the game's own roles stay as written and the kit only adds its tokens, with on-colours computed
against the game's real fills, so every existing game keeps working.

## 2. Components

A component is a node with a `ui` key instead of `node`, in any slot. It takes content and
roles; the kit places and sizes it.

| `ui` | Region | Props |
|---|---|---|
| `stat` | HUD | `label`, `value` (expr), `color`. Up to 3 in `hud_top`: the kit makes them a bar of equal chips. |
| `text` | top | `text`, `step` (display…caption), `lines`, `tone`, `align` |
| `question_card` | top | `text`, `eyebrow`, `lines` (3), `timer` (0..1 expr), `timer_warn` (bool expr) |
| `dialog` | top | `text`, `speaker`, `portrait` (sprite), `portrait_frame`, `lines` (4) |
| `meter` | top | `value` (0..1 expr), `label`, `tone`, `warn` |
| `picture` | playfield | `sprite`, `frame`, `aspect` (h ÷ w), `max_h` |
| `frame` | playfield | `tone`: a framed panel filling the playfield |
| `board` | playfield | `cols`, `rows`, `text`/`fill` (expr of `cell`), `on_tap` (with `cell`), `sprite` |
| `lanes` | playfield | `count` |
| `answer_grid` | controls | `count`, `cols` (1–2), `as` (`k`), `text`, `state` (`'good'`/`'bad'`/`''`), `on_tap`, `sprite`, `visible_item`, `dim` |
| `choice_list` | controls | as `answer_grid`, one column |
| `button` | controls | `text`, `variant` (primary, secondary, ghost, danger), `on_tap` |
| `keyboard` | controls | `letters`, `cols`, `on_tap` (with `letter`), `key_state` (expr of `letter`: 0, 1 good, 2 bad) |
| `toast`, `banner` | overlay | `text`, `tone`, `visible` |
| `intro_card` | overlay | `title`, `body`, `button`, `on_tap`, `visible` |
| `result_card` | overlay | `eyebrow`, `title`, `score` (expr), `line`, `visible` (default `status != 'playing'`) |
| `spacer` | top | `h` (grid units) |

Every component also passes through `id`, `visible`, `opacity`, `animate_on`, `transition`, and
takes `region` (to move it) and `order` (to sort within a region).

**Fragments rebuilt on the kit** (params, names and inputs unchanged, so every existing game still
expands and validates): `quiz`, `picture_quiz`, `choice_story`, `keyboard`, `story_vars`, `play_clip` (a kit
button with `enabled` and `progress`), and the HUD counters of `score rounds lives combo countdown endless waves ghost_score match_pairs
diff_spots`. Layout params that the kit now decides (`keyboard.x/y/key_size/gap`,
`choice_story.text_y/button_y/picture_y`, `story_vars.place_y/card_y`) are accepted and ignored.

## 3. Layout regions

The canvas size is one constant, `CANVAS` in `expander/ui-style.mjs` (360 × 640 today; a look or the
game can pass its own, e.g. 360 × 780 for 19.5:9 phones). `bands(canvas)` turns it into fixed
rectangles, and the layout pass (`applyUiKit`, called by `expand.mjs` with the look's canvas) stacks
components into them:

| Region | Where (any canvas height `h`) |
|---|---|
| HUD band | y 24–72: a solid `surface` bar 12 from the edges; chips in equal columns, text fitted to one line |
| top | from y 84, components stacked with 12 between |
| controls | stacked upward from `h − 24`, or from 12 above the bottom strip |
| bottom strip | `h − 40` to `h − 4`, only when something is in `hud_bottom` |
| playfield | what's left between top and controls; `frame`, `board`, `picture`, `lanes` fill it |
| overlay | toasts at the top of the playfield, cards centred over a `scrim` |

The bands never overlap, by construction: every component's box is cut from one band, and a taller
canvas only makes the playfield taller (`applyUiKit(...).regions` and `.bands` return the rectangles).
The HUD bar is opaque and drawn over the playfield, so moving actors pass under it rather than
through the numbers. Game nodes with their own x/y are the one way to break this; the style check
blocks static ones that enter a HUD band (`S_HUD_BAND`, an error), and the rendered-frame lint
catches moving ones.

## 4. The style check (hardware check)

```js
import { styleCheck, styleFix } from './expander/style-check.mjs';
const { findings, counts } = styleCheck(manifest, { library });          // report
const { manifest: fixed, after } = styleFix(manifest, { library });      // auto-fix, then re-check
```

| Code | Severity | Finding | Auto-fix |
|---|---|---|---|
| `S_OFF_GRID` | warning | a literal x, y, w, h (or circle diameter) off the 4 pt grid | snap |
| `S_FONT_SCALE` | warning | a size not on the scale, or under 13 | nearest step |
| `S_COLOR_ROLE` | warning | a literal colour (also inside expressions) that isn't a role | nearest role token; translucent darks → `$scrim`/`$shadow` |
| `S_TEXT_UNBOXED` | warning | text with no box, outside a kit component | a box from its anchor and the screen edges, fitted |
| `S_TEXT_OVERFLOW` | error | text that doesn't fit its box | static: shrink, wrap, ellipsize; run-time: a size that steps down with length and a "…" cut |
| `S_TEXT_OVERLAP` | error | two static text boxes overlap | same line: split the line |
| `S_CONTRAST` | error | text under 4.5:1 on what it sits on; a palette whose ink fails | `<role>_ink` variant, else the best of ink/on-colours; adopt the palette into `ui` |
| `S_TOUCH_TARGET` | error | a tap target under 44 × 44 | grow it around its centre (not inside repeats) |
| `S_RADIUS`, `S_STROKE` | warning | not the family's values | snap |
| `S_HUD_BAND` | error | a static playfield node in the top HUD band or the bottom strip | report (Muse repairs) |
| `S_TOO_MANY_SIZES`, `S_TOO_MANY_COLORS` | warning | over 5 sizes / 12 colours | report |
| `S_UI_KNOB` | warning | an unknown `ui` value | the default |

It checks the game's own nodes only (fragments and kit components are ours, built on the
contract). It is deterministic: the same manifest gives the same findings in the same order; the
fix gives byte-identical output on every run, and a second fix pass changes nothing. The fixes only
touch presentation and the `ui` block, so rules, state and objectives are unchanged and replays
still verify.

### As a verifier module

`style-check.mjs` exports `styleVerifier` for the unified verifier (`authoring/verify/`):

```js
import { styleVerifier } from '../expander/style-check.mjs';
styleVerifier.id      // 'style'; stage 'manifest'; codes: { S_*: 'error' | 'warning' }
styleVerifier.run(manifest, { library, canvas })  // → { findings, blocking, counts }
styleVerifier.fix(manifest, { library, canvas })  // → { manifest, findings, blocking } after the auto-fix
```

`blocking` is the error-severity findings: anything that intersects (`S_HUD_BAND`, `S_TEXT_OVERLAP`,
`S_TEXT_OVERFLOW`), fails AA (`S_CONTRAST`) or can't be tapped (`S_TOUCH_TARGET`).

### Note for the layout-lint agent (`playtest/layout-check.mjs`)

This check is static, on the manifest; yours is dynamic, on rendered frames. To avoid
duplicate codes: `S_*` is this file's prefix, please keep `L_*` for findings that need frames
(moving actors entering the HUD band, text measured wider than its box at run time, overlaps
between dynamic nodes, sprites crossing the score). Where the two overlap in meaning (your codes from `playtest/LAYOUT.md`): `S_HUD_BAND` ↔
`L_OVERLAP_HUD`, `S_TEXT_OVERFLOW` ↔ `L_TEXT_OVERFLOW`, `S_TEXT_OVERLAP` ↔ `L_OVERLAP_TEXT`,
`S_TOUCH_TARGET` ↔ `L_TARGET_SMALL`, `S_CONTRAST` ↔ `L_LOW_CONTRAST`, `S_FONT_SCALE` ↔
`L_TEXT_SMALL`. Order in the pipeline: style fix on the manifest first, then expand, then your
lint and `layout-fix.mjs` on frames. With the kit's HUD bar in place, your HUD-panel fix should find
nothing to do (the bar is a solid `$surface` panel drawn over the playfield). The kit's regions
are exported by `applyUiKit(...).regions` (hud, top, playfield, controls, hud_bottom) if you want
to check frames against the same bands.

## 5. Results on last night's Muse games

Across the 45 Muse games built last night (kevin32 #1–31 and s15 S1–S15 except S7; #32 and S7 have no build; the style check run on each game's own
manifest):

- 1,599 findings before, 173 of them blocking errors. The most common: `S_OFF_GRID` 500, `S_TEXT_UNBOXED` 374,
  `S_FONT_SCALE` 262, `S_COLOR_ROLE` 199, `S_CONTRAST` 112, `S_RADIUS` 62, `S_TEXT_OVERFLOW` 30.
- 39 left after the auto-fix, all blocking, for Muse to repair: `S_HUD_BAND` 13, `S_CONTRAST` 10 (colours chosen by
  expressions), `S_TOUCH_TARGET` 10 (inside repeats), `S_TEXT_OVERLAP` 6.
- Every fix is deterministic and idempotent, and every fixed game still expands and validates.
- Logic unchanged: for 17 games, every bot run of the old build replays on the kit build with the
  same state hash after every step, and the same phase, score and time. Taps are mapped to the
  target that does the same thing in the new layout. The gate verdict is the same for each game.
