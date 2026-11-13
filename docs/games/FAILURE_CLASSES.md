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
| FC-04 | Text too big for its place | Text past its tile or button, or past the canvas edge | `L_TEXT_OVERFLOW`, `L_TEXT_CLIPPED`, `L_TEXT_FIT` (longest content, 12-unit canvas margin) | yes | `fitText` (size by length, in the font's own width from `kit/font-data.mjs`), `fontAwareFit`, solver shrink and wrap | Burrito Beat "BURRITO COMPLETE!" in Monoton, 11 units over |
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
| FC-40 | Rules changed by a visual fix | A fix that changes anything outside the presentation, a handler or the feedback block's sounds and haptics (the motion fixes may trim its shakes, toasts and particles), or a bot replay that ends in a different state | `verify/prove.mjs` (`rules`, `replays`), and `testbed/rebuild.mjs` `rulesHash` against the game on Prod | yes: the fix is reverted, and a game whose hash differs from Prod is never republished (seeded runs and Daily boards must still verify) |

## Motion

How a game changes between states, judged over a contiguous replay of the bot runs (a frame every
50 ms, nothing dropped, plus 1.2 s after the end) with per-node position, scale, opacity and text
tracks from the engine's ops (`verify/motion-track.mjs`). The rules are in `verify/motion.mjs`
(thresholds in `MOTION`), the check is `verify/checks/motion.mjs`, and the fixes are
`verify/motion-fix.mjs` (the motion stage of `verifyAndFix`, before the look stage). Fixes are
presentation only: feedback shakes, particles, `animate_on`, transitions and HUD text widths. The rules
hash never changes. The shell holds the same limits for every Curio
(`bubble-kit-microgame.js`, docs/BUBBLES.md 7.11, "Toasts, shake and pulses"), so a game that breaks
them still plays calmly on the phone.

| Id | Class | Definition | Code | Block | Fix | Example |
|---|---|---|---|---|---|---|
| FC-50 | Excess shake | A feedback shake over 3 units or 150 ms (blocks over 4 or 250 ms, or at any size on a non-fail moment such as a right answer, a tap or a round start); a second shake on one moment (the same event, or one it emits); shakes on more than half of a run's inputs; an `animate_on` x, y or rotation swing (2+ reversals) on text, the HUD or a button | `M_SHAKE` | yes (an art-only swing warns) | keep one shake on the fail moment that causes the rest (`pickShakeKeeper`), at 3 units and 150 ms; drop every other; drop swings on text and buttons. Shell: one 3-unit, 150 ms shake per moment, art only, only after the player's input | Guess the Decade: three shakes on a wrong answer (5/160, 6/200, 6/220) jitter the whole screen 6 units |
| FC-51 | Text instability | Readable text that moves more than 1.5 units while its words stay the same (a HUD row re-centring when a neighbour grows, a slide, a jump), or pulses past 1.08×. Text that moves in over 30 % of its frames rides a sprite and isn't judged | `M_TEXT_UNSTABLE` | yes | fixed HUD slots (each text in the row gets its widest words' width plus two characters, centred); x/y animations dropped from text; pulses capped at 1.08×. Shell: text drawn at no more than 1.08× | Guess the Decade: "Round 1 of 10" jumps 11 units when the score reaches 100; "Score" pulses to 1.25× |
| FC-52 | Icon over-pulse | A non-text node pulsing past 1.15× | `M_PULSE` | yes | scale keys capped at 1.15× | Guess the Decade: the life icon at 1.6× then 0.7× |
| FC-53 | Popping or flicker | New words (or a text) at full opacity in their first frame with no fade; a panel of 6 % of the screen or more appearing at once; words shown for 100 ms or less between frames without them. Counters (only small number steps, tallies, clocks), HUD readouts and text whose words change more than 1.5 times a second are not judged | `M_POP` | yes | a fade in the look's length (160 ms ease-out, pixel 100 ms linear) on the events that change the words or show the panel (rules writing the state its text and `visible` read, through functions; `status` → `win`, `lose`). Where the node already animates on that event, the fade goes on a group wrapped around it | Guess the Decade: the four answers swap at once; the end card appears in one frame |
| FC-54 | Mid-transition overlap | The next state's labels on the last state's colours (a fill, stroke or colour transition still running when a label inside it changes); particles over readable text for more than 300 ms in a row. Old toasts crossing the screen are the shell's (fixed there) | `M_TRANSITION_OVERLAP` | yes | drop that colour transition, so the reveal clears before the next labels show; bursts at most 300 ms and 14 particles | Guess the Decade: the next round's answers in the last round's cyan and red for 100 ms; 72 win particles over the final score |
| FC-55 | Transition consistency | One event's fades (or pulses) with lengths more than 1.5× apart or different eases; a text fade or pulse over 400 ms; opacity transitions more than 3× apart. A long many-key opacity animation (fade in, hold, fade out, 1 s or more) is a caption's life, not a fade | `M_TRANSITION_STYLE` | yes | every fade in the look's length and ease; an event's pulses in their median length (120 to 240 ms), ease-out | Car Showdown: 'pick' pulses in 240 and 220 ms, linear and ease-out |
| FC-56 | Too short to read | Words on screen for less than 300 ms + 220 ms a word (2 s at most) while play goes on | `M_TEXT_HOLD` | warn | a rules change (the reveal's length), for unseeded games at generation | Guess the Decade: the decade hint, up 700 ms (`after: 700ms`), needs about 1.2 s |

Results on Kevin's 45 builds (2026-11-13, two random-play runs and an idle run each): blocking motion
findings 411 → 34 after the fixes (`M_POP` 170 → 31, `M_TEXT_UNSTABLE` 106 → 2, `M_SHAKE` 68 → 0,
`M_PULSE` 26 → 0, `M_TRANSITION_OVERLAP` 26 → 1, `M_TRANSITION_STYLE` 15 → 0). Games passing went from
0 to 25 of 45. All 45 keep their rules hash and pass the proof. What's left is mostly words changed by
timer or tick rules, with no event a fade can follow (a generation-time fix), and short flashes the
rules time. On the testbed six (round 5): 35 → 4, passing 0 → 3, the same 4 kinds.
