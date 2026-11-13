# Failure classes: what a published game must never show

The one list of visual and play failures we always check for, each with a verifier code. A class is
added here first (preregistered), then checked, then fixed at the source. The verifier is
`authoring/verify/` (`verifyAndFix`): blocking codes stop a publish or trigger the fix; warnings are
reported. Codes are listed in full in `authoring/verify/README.md`.

To add a class: give it the next free id in its group, its code or codes, block or warn, the fix,
and a real game that showed it. Other agents add their own groups (for example motion, below).

## Text

| Id | Class | Definition | Code | Block | Fix | Example |
|---|---|---|---|---|---|---|
| FC-01 | Unreadable text | Text under 4.5:1 (small) or 3:1 (large: 22+, or bold 18.5+) in the worst 10 % of the pixels behind it on any sampled frame, or small text on a busy background with no outline | `S_READABILITY` (pixels, no Chrome), `L_LOW_CONTRAST` (Chrome) | yes (`L_LOW_CONTRAST` under 3:1) | `kit/readability.mjs`: palette ink (following a state-coloured key), soft plate, solid plate, outline for display text | Nike Cop vs Bots "STOCK 0%" at 1.00:1 |
| FC-02 | Unreadable HUD readout | A timer, score, lives or other HUD readout in the top or bottom band under **4.5:1 at any size** on any frame, values that change included. A HUD number is read in a glance mid-play, so the large-text allowance doesn't apply | `S_HUD_READABILITY` | yes | the readability fixer held to 4.5:1: palette ink, plate, solid plate; the UI kit's HUD bar by construction | Fog Over the Bay: the "60s" timer in cream over the moon, 1.04:1 |
| FC-03 | Word broken across lines | The engine cuts a word longer than its line (0.6 em a character, hair spaces counted), or letter-spaced text wraps | `L_WORD_BREAK` | yes | `layout-fix.mjs` `keepWords`: drop the letter spacing, shrink to the minimum (11), shorten HUD words (SCORE → PTS), widen the box; the look kit spaces letters only on one-line text | Wrath of Zeus "SCOR / E", "QUES / TION" |
| FC-04 | Text too big for its place | Text past its tile or button, or past the canvas edge | `L_TEXT_OVERFLOW`, `L_TEXT_CLIPPED` | yes | `fitText` (size by length, in the font's own width from `kit/font-data.mjs`), `fontAwareFit`, solver shrink and wrap | Burrito Beat "BURRITO COMPLETE!" in Monoton, 11 units over |
| FC-05 | Text over text | Two text boxes overlap | `L_OVERLAP_TEXT` | yes | solver slot; `rowsToColumns` | Spotify Wrapped: the hint over the instructions |
| FC-06 | Text crossed by a sprite | A text box crossed by a sprite it isn't written on (a moving sprite over a label, a label half on a picture) | `L_TEXT_ON_SPRITE` | yes | `plateLabels`: a badge for moving text, a plate for still text, drawn over the sprites; the story still as a kit picture | Leia: Death Star Escape, the scene picture over the story text |
| FC-07 | Label off its tile | A cell label anchored on its tile's edge | `L_TEXT_OFFCENTER` | yes | `fitText` centres it | Grid board cells |
| FC-08 | Text too small | Under 11 units (about 12 pt) | `L_TEXT_SMALL` | warn | `fitText` | – |
| FC-09 | Off the look | Fonts outside the game's pairing, sizes off its scale, literal or glowing text colours | `S_FONT_FAMILIES`, `S_TYPE_SCALE`, `S_TEXT_COLORS`, `S_NEON_TEXT` | yes (with `art.type`) | `kit/look.mjs` `lookFix` | games made before the look kit |

## Shapes and labels

| Id | Class | Definition | Code | Block | Fix | Example |
|---|---|---|---|---|---|---|
| FC-10 | Stray or mismatched shape | A still, filled or outlined box (not the backdrop, a tap target, a moving sprite, a full-width band or a board cell) that is **empty** in every frame it's drawn, or a large opaque panel painted in a **literal colour far from the look's surfaces**, or one a quarter or more **off the canvas** | `S_STRAY_SHAPE` | yes | `layout-fix.mjs` `fixShapes`, before the readability stage: an empty box is hidden; an off-look panel takes `$surface` (and `$line`), so its words are re-inked against it | Fog Over the Bay: a cream end card in a dark teal game, its text in its own colour, so it read as an empty open box |
| FC-11 | Blank key or tile | A key or tile with no visible label while its siblings have one | `L_EMPTY_LABEL` | yes | content | Krillion: the blank space key |
| FC-12 | Empty plate or bar | A plate whose text is empty, or a HUD bar left behind when its row moves | (FC-10 when drawn) | yes | plates show only with words on them; a moved HUD row takes its bar | Tung Tung Subway Chase, round 2 |

## Tap targets

| Id | Class | Definition | Code | Block | Fix | Example |
|---|---|---|---|---|---|---|
| FC-20 | Small target | A tap target under 40 units (44 pt) | `L_TARGET_SMALL` | yes | solver grows the cell or button; `insetCells` | Krillion and Spotify Wrapped keyboards, 31-unit keys |
| FC-21 | Crowded targets | Targets closer than 7 units (8 pt), or partly overlapping | `L_TARGET_GAP`, `L_OVERLAP_TARGETS` | yes | `spaceTargets`, solver gap and gating | Windowsill Defense seed bank |
| FC-22 | Tap through an overlay | A tap on a panel with no handler reaches a live target under it and changes the game | `L_TAP_THROUGH` | yes | solver gates the covered target | Alley Cat Gang |
| FC-23 | Target off screen | A tap target mostly off the canvas | `L_OFFSCREEN` | yes | – | – |

## Play area and HUD

| Id | Class | Definition | Code | Block | Fix | Example |
|---|---|---|---|---|---|---|
| FC-30 | Sprite over the HUD | A moving sprite and the HUD overlap | `L_OVERLAP_HUD` | yes | HUD panel, `hudToTop`, `clampPickups` | Crocodilo vs Pineapples |
| FC-31 | Content under the phone's bars | Text or a target in a bleed band | `F_KEY_IN_BLEED` | yes | `nudgeIntoSafe`; the tall canvas | Wrath of Zeus HUD at y 108 |
| FC-32 | Gaps and short backdrops | The background doesn't fill the canvas | `F_BG_GAP`, `F_BACKDROP_SHORT` | yes | the fill fix; the lift to the tall canvas | 640 games on a 780 phone |
| FC-33 | Two score readouts | The score shown twice | `F_DOUBLE_HUD` | yes | the fill fix | – |
| FC-34 | HUD out of its band, no score, wrong aspect | | `F_HUD_OUT_OF_BAND`, `F_SCORE_HIDDEN`, `F_ASPECT` | warn | the fill fix | – |

## Republishing

| Id | Class | Definition | Check | Block |
|---|---|---|---|---|
| FC-40 | Rules changed by a visual fix | A fix that changes anything outside the presentation, a handler or the feedback block, or a bot replay that ends in a different state | `verify/prove.mjs` (`rules`, `replays`), and `testbed/rebuild.mjs` `rulesHash` against the game on Prod | yes: the fix is reverted, and a game whose hash differs from Prod is never republished (seeded runs and Daily boards must still verify) |

## Motion

Reserved for the motion checks (shake, text jitter, pops, overlap mid-transition, transition
consistency) on the `motion-verify` branch.
