# Style kit: any style a player asks for, applied consistently

Players can ask for any look ("film noir", "LEGO bricks", "ukiyo-e"). Asking Muse to hand-draw
that look in every SVG gives sets that don't match, plus lines, shadows and textures that break
down at play size. The kit splits the work:

| Step | Who | Output |
|---|---|---|
| 1. Style director | Muse | A style spec: palette roles, the light, and one option per treatment from a fixed vocabulary, plus drawing rules |
| 2. Illustrator | Muse | Flat shapes only, colored with palette role names (`accent`, `accent-dark`, `sky-light`…); the backdrop as top-level `<g>` depth layers |
| 3. Compile | code (`compile.mjs`) | One SVG filter stack built from the spec, applied the same way to every sprite and backdrop layer |
| 4. Lint | code (`lint.mjs`) | Off-palette colors snapped to roles; viewBox, bytes and stroke checks; padding, contrast at play size, quiet zones |
| 5. Render | code (`render.mjs`, headless Chrome) | The art in a real gameplay frame plus stand-ins for what the renderer draws, then measured |
| 6. Critique, once | Muse with the image | Redraws only the roles that need it |

The vocabulary (`vocabulary.mjs`) covers six treatments, which Muse combines freely:

- **edge:** clean, rough, wobble or pixel;
- **shading:** none, cel, soft or clay;
- **highlight:** none, rim, gloss or soft;
- **texture:** grain, paper, canvas, scanline, halftone or hatch;
- **outline:** solid, double, glow or inner;
- **shadow:** offset, drop, long, glow or contact.

Sizes are in screen pixels at play size. The director prompt shows no example styles, so Muse
builds each spec from the player's words and the vocabulary alone.

**Rule: all art comes from Muse or the engine.** Nothing in this folder is drawn or styled by hand.
Every sprite, backdrop and style spec in a test or demo is Muse output; the compiler and renderer
are the only code-made parts.

## Run it

```sh
# One Muse-drawn pack compiled under every Muse-written spec in a run folder: how much the compiler carries
node authoring/harness/style/run.mjs restyle <out dir> <muse run dir> [pack json]

# The full loop on real Muse (reads MUSE_API_KEY from .env; capped by STYLE_BUDGET_USD, default 2)
node authoring/harness/style/run.mjs muse <out dir> "moody film noir, rainy night" "LEGO bricks" --critique

# Blind test judged by a person (judge.html) and by Muse's pairwise judge. Arms: kit, freeform,
# rubric, freedraw (Muse draws finished SVG with no vocabulary). --muse-styles N lets Muse pick the styles.
node authoring/harness/style/experiment.mjs <out dir> --muse-styles 5 --arms kit,rubric,freedraw
node authoring/harness/style/experiment.mjs <out dir> --tally <human results json>
```

Chrome is expected at the default macOS path; set `CHROME` to use another binary. There are no
npm packages.

## First results (2026-11-12, muse-wonder-1.0, Cable Car Catch)

- **Compiler range (retracted as evidence of Muse quality):** an early sheet compiled one plain
  drawing into eight styles. That drawing was made by an agent, not Muse, so it only shows what the
  compiler can do. It has been removed; `run.mjs restyle` now does the same with a Muse-drawn pack.
  Compiled assets were 1.4–3.6 KB, and all 24 passed the app's `sanitizeSvg`.
- **Real Muse, five runs across two rounds:**
  - Prompts: noir, LEGO and ukiyo-e, then noir and ukiyo-e again after fixes.
  - Cost: $0.79 in total, about $0.13–0.18 per style including the critique.
  - Time: director 10–13 s, illustrator 23–28 s, critique 10–23 s.
  - Image input on Chat Completions worked for the critique.
- **What the critique fixed:**
  - LEGO: it removed HUD boxes that Muse had drawn into the backdrop.
  - Ukiyo-e: it moved a sun out from behind the score.
  - Noir: it cleared clouds out of the HUD band.
  - All runs: it pulled sprites back inside their gutters.
- **What it didn't fix in one round:**
  - The noir lantern is dark on a dark scene.
  - Some sprites still touch their 4-unit gutter after the outline is added.
- **Removed:** `posterize`. It turned grain into rainbow speckle and pushed palette colors off the
  palette. Hard cel bands and the fixed palette already give a print feel.

## Known gaps

- **Not checked on iOS.** The filters (feTurbulence, feDisplacementMap, feMorphology,
  feSpecularLighting) are unverified in WKWebView and in the engine's image path. Compile time and
  draw cost on a phone are unmeasured. If they're slow, the server can rasterize to PNG once.
- **The renderer must pick text and button colors by contrast.** The stand-ins here do. Without
  that, a dark style like noir hides the HUD, and the critique wrongly "fixes" the backdrop
  instead.
- **Only one game so far.** The Cable Car fixture is the only test bed. Other games need their roles,
  zones and placements in the same shape (`fixtures/cable-car.mjs`).
- **The contrast and zone thresholds (1.8:1, 2.2:1, 0.11) are first guesses.** They were tuned on
  these sheets only.
