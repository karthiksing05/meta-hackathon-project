# Gameplay-frame art experiment

Two original player prompts go through the backend Studio composer. The existing
runtime renders each game with sprite-sized placeholder blocks. Muse Image paints
two backgrounds for each draft, one from text and one with that rough frame as
an additional input. The generated sprite cutouts and the HUD are shared across
the pair. Both variants expand and run in the existing game engine.

This is a pilot for background composition. The two prompts use the same
catch-and-dodge mechanic. The script names the asset roles and supplies the art
direction for those two drafts. A production pipeline would derive those from
the draft. Sprite extraction uses a flat green background and chroma keying.
It does not exercise semantic segmentation or animation generation.

Run from this checkout with Node 22+, Google Chrome and ffmpeg with libwebp.
Pass the path to the existing Muse credential file and an absolute output
directory. The scripts also accept MUSE_API_KEY from the environment.

```sh
mkdir -p "$output"
node authoring/harness/layout-experiment/draft.mjs "$PWD" "$muse_env" "$output"
node authoring/harness/layout-experiment/layout-experiment.mjs "$PWD" "$muse_env" "$output"
node authoring/harness/layout-experiment/gallery.mjs "$output"
```

Open index.html in the output directory. The second script accepts an optional
phase argument of prepare, images, or assemble. Successful image outputs are
reused across runs. Inspect the usage and result JSON files for timings and
fallbacks.

In the pilot, both guided backgrounds left a quieter central playfield. The
paper scene still had poor contrast behind the HUD. In the lunch scene the
guided version put a shelf directly behind the main caption. Both backgrounds
preserved gameplay within each pair. The paper game reused its draft lantern
and moth art because their image requests failed. All three main lunch sprites
were extracted successfully.

## HUD comparison

The HUD pass operates on the expanded game in this experiment. It preserves
the fragment counters, their state bindings, and the game's controls. The
intro card uses a solid surface, and optional opening reminders fade out.
Muse Wonder picks a supported position and suggests colors. The harness
checks text and warning contrast, rejects placements that overflow during
the sampled run, and uses a top bar when a proposed layout fails. Muse Image
gets a marked frame showing the areas to keep quiet in the new background.

Add the tile game, then generate the comparison:

```sh
node authoring/harness/layout-experiment/draft.mjs "$PWD" "$muse_env" "$output" tide
node authoring/harness/layout-experiment/layout-experiment.mjs "$PWD" "$muse_env" "$output" hud
node authoring/harness/layout-experiment/hud-gallery.mjs "$output"
```

Open `hud.html` to compare the original HUD, a contrast panel at the original
positions, Muse's HUD, and a version that softens the existing art under the
HUD. A repainted background appears when Muse Image returns one. Use
`hud-local` to rerender from cached HUD decisions without requesting images.
The gallery uses the expanded manifests.
Re-expanding the original authoring JSON by itself does not apply this pass.

Muse chose split counters for Lantern Moth Catch and Tide Pool Pairs and a
single bar for Dumpling Dash Tray. All three passed the bot gate and Chrome
touch smoke test with the Muse HUD. The lunch repaint respected the quiet HUD
area but painted copies of active game pieces into the background. The two
other repaint requests failed. Softening the existing art preserved the
playfield in all three comparisons.
