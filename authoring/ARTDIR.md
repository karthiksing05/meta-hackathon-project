# Art direction: making a Curio look like one picture

Every Curio should look like one illustrator made it for a phone: full-bleed art to every edge, one
style for the background, the pieces, the panels and the type, nothing overlapping, every word readable
at a glance, calm motion, and a clear focal point. This pipeline gets a game there in at most **5 image
calls** (frame, wordmark, backdrop, sprites, UI kit) and leaves the rest to the agent's eye. Three gold games were rebuilt with it and are the
references: Pop Mart Labubu Blind Box (`s3`), Fog Over the Bay and Guess the Decade (`k20`, seeded).

Code: `authoring/artdir/` and `authoring/tools/art-direct.mjs`. Tests: `node authoring/artdir/test-artdir.mjs`.

**Provenance.** The image art comes from Muse's image model (`muse-image-1.0`). The code, layout and
direction are written by the agent (Opus) with this harness, never by a Muse text model. Never label a
rebuilt game "made with Muse"; record it in the backup folder's `notes.json`
(`{"builtBy": "harness+opus", "imageArt": "muse-image-1.0"}`), and in the manifest's `art_record`
(`builtBy`, `imageArt`), which the build step writes.

## The bar

1. Fills the phone (iPhone 14 Pro: 393 × 852 points, the tall 360 × 780 canvas at 1.09×): full-bleed art,
   no bands, no stretching; HUD and taps in the safe area, y 110 to 684.
2. One art direction: everything comes from the same style frame. No flat default rectangles next to
   painted art.
3. Nothing overlaps at any frame, transitions included. No stray or empty boxes.
4. Every word reads at a glance (HUD at least 4.5:1), no broken words, nothing clipped. Little text, big art.
5. Calm motion: eased tweens, at most one subtle shake on a miss, still text, no pops or flicker.
6. One focal point, 2 or 3 HUD items, generous spacing, taps at least 44.
7. Glitch-free: understood in 3 seconds, feedback on every action, an end card in the same style, bots can play it.

## Setup

```sh
git worktree add --detach <wt> origin/harness-v2 && cd <wt>
export MG_ENGINE_DIR=<an engine dir with web/pkg/microgame.wasm>
ENV=<repo>/.env        # MUSE_API_KEY is read from here into memory; never MuseConfig.json, never printed
C="--cache <dir>/cache --ledger <dir>/ledger.jsonl --max-calls 20 --env $ENV"
```

`--cache` keeps every image reply by prompt hash: rerunning a step costs nothing and gives the same
bytes. `--ledger` is an append-only list of fresh calls shared by every game in a batch, and
`--max-calls` refuses a step that would pass the budget. Make no Muse text calls.

## Step by step

### 0. Read the game and decide what it is allowed to change

Download the Prod manifest (`GET /v1/games/{id}` gives `manifestUrl`). Dump its presentation tree and
rules. Decide:

- **Seeded** (it has Daily, Group or board runs on Prod: grep its id in `game-backups/demo-world` and
  `team-world` state files)? **New pictures are allowed** (policy since 2026-11-13: images don't change
  the simulation). Give it a backdrop, sprites, a UI kit and a wordmark like any game, but keep every
  rule, input, handler and the tap targets' order **and their boxes** (the server replays raw input
  logs, so a tap must land on the same target at the same spot). Set `"seeded": true` in the direction
  (or pass `--seeded`). The proof, run by `finish.mjs`:
  - the **logic hash** (`finish.logicHash`: everything except `presentation` and `assets`) must not move;
  - the **seeded run logs still replay**: the demo-seed bots (`tools/demo-seed/bots.mjs`, the same runs
    the seed tools posted) play the Prod game, and each raw log is verified on the new game text
    (`MicrogameEngine.verify`, what the server does) to the same phase and score
    (`record.seededLogs`, `--seed-runs n`, default 6).
  The rules hash (with assets) is still recorded but no longer gates. `presentationOnly: true` (shapes
  only, no new pictures) is still accepted for a game you want to leave byte-identical in assets.
- **Unseeded**: new assets and a new presentation; rules only if they are broken, and the replay proof
  below must still hold.

Keep every handler (`on_tap`, `on_drag`, ...) byte for byte, and keep the **order** of tap targets in
the tree: the proofs move each recorded tap to the target with the same index.

### 1. The direction file (you write it)

`authoring/artdir/gold/<key>.direction.json`. Fields: `title`, `gameId`, `words` (picks the vibe),
`vibe` and `pairing` (optional: a look-kit vibe from `kit/vibes.mjs`), `style` (one sentence of art
style used by every prompt), `palette` (hex hints), `frame` (`scene`, `focal`, `hud`, `controls`),
`backdrop` (`scene`, `calm`), `sprites` (`items: [{id, text}]`, `key` chroma colour, `set` sentence,
`px`, `despill: "hard"` for art with no colour of the key's family), `ui` (`material`, `button`,
`key`, `corner`). `directionErrors` checks it. Pick the chroma `key` so no item is that colour
(pastel pink and lilac sets: `green`; white clouds: `magenta`).

### 2. Style frame (1 call)

```sh
node authoring/tools/art-direct.mjs frame --direction d.json --out run/<key> $C
```

One picture of the playing screen as it should look, tall like a phone, with calm zones behind the HUD
and the play area (`prompts.framePrompt`). Look at `run/<key>/frame.png`. If it isn't the game you
want, fix the direction and spend one more call; everything downstream follows this picture.

### 2b. Wordmark (1 call)

```sh
node authoring/tools/art-direct.mjs wordmark --direction d.json --out run/<key> $C
```

The title lettered in the game's own style (`prompts.wordmarkPrompt`, the one prompt that asks for
letters: exactly the title, nothing else) on a flat chroma key (`wordmark.key`, default green; pick
magenta for green lettering), keyed, despilled, trimmed, specks far from the letters dropped
(`sheets.finishWordmark`), fitted to 720 px: `wordmark.png` + `wordmark.json`. Optional direction fields:
`wordmark.text` (lettering, defaults to the title), `wordmark.lettering` (a sentence on the letterforms),
`wordmark.layout`, `wordmark.px`. Check the spelling in the picture; a misspelt wordmark is redrawn
(one more call) or dropped for the kit's display face. Use it on the intro and the end card with
`build.wordmark(art, cx, cy, maxW, maxH)`; `artAssets` adds it as the `wordmark` asset.

### 3. Kit from the frame (0 calls)

```sh
node authoring/tools/art-direct.mjs kit --direction d.json --out run/<key>
```

`kit.json`: the palette from the frame's pixels (`palette.mjs`: median cut, colourful swatches with
distinct hues, ink pushed to 7:1 on bg and surface, on-colours to 4.5:1; deterministic), the look-kit
type (vibe, pairing, fonts and type scale from `kit/look.mjs`), the shape language (radius, stroke,
shadow per vibe family) and how calm the frame is in each band.

### 4. Art (at most 3 calls; none for a presentation-only game)

```sh
node authoring/tools/art-direct.mjs art --direction d.json --out run/<key> $C [--only backdrop,sprites,ui]
```

- **Backdrop**: an *edit* of the style frame (the frame is the reference picture) with every UI piece
  and character removed, so it matches the frame exactly. `backdrop.jpg` at 720 × 1560.
- **Sprite sheet**: every item in one call on a flat chroma key, in a fixed grid (`gridFor`). Sliced on
  the grid when every cell's content keeps clear of its edges, otherwise as connected regions in
  reading order, with specks (a sparkle over a ripple) joined to the nearest subject; keyed, despilled,
  trimmed. `sprites/<id>.png` and `sprites-preview.png`.
- **UI kit sheet**: four empty frames (panel, button, badge, banner) in a 2 × 2 grid. Each one's
  9-slice insets are measured (`nineInsets`: where the rim meets the flat middle, at least the corner
  rounding) and the frame is scaled so its corners come out at `ui.corner` pixels.
  `ui/<piece>.png`, `ui.json`, `ui-preview.png`.

Open both previews. A sprite cut in half, a fringe, or a missing piece is fixed by re-slicing
(free, from the cache) or, last, one more call.

### 5. Build the game (0 calls)

Write `authoring/artdir/gold/<key>.mjs` exporting `build(prodGame, art)` that returns the new game
(see the three gold builders). Helpers in `artdir/build.mjs`:

- `frame(art, piece, x, y, w, h, props)`: the kit's frame at that box as **one image**, the 9-slice
  baked at build time into an asset `ui_<piece>_<w>x<h>`. Text written on it then sits on one sprite
  (the verifier's `L_TEXT_ON_SPRITE` is happy) and any engine draws it. For a box sized by expressions
  pass `live: true`: a 9-slice group of nine pre-cut piece assets (`nine.mjs`; crops mode needs engine
  v0.2.2, which older servers refuse, so pieces are the default).
- `text(art, step, value, props)`: a text node on the kit's type scale (`caption`, `label`, `body`,
  `title`, `display`, `hero`; `numerals: true` for scores).
- `artAssets(art)`: backdrop, sprites and the baked frames as `game.assets`. Call it last.
- Draw several sprites from one node with an asset expression: `"asset": "= 'f' + str(idx)"`.
- `wordmark(art, cx, cy, maxW, maxH)`: the title wordmark fitted into a box (intro, end card).
- `appHooks(art)`: the manifest's `presentation.app` for the app (docs/BUBBLES.md 7.11, "App hooks":
  `cover`, `wordmark`, `palette`, `fonts`). The build step writes it on the manifest (never inside
  game_json: the engine refuses unknown presentation keys); a builder may export `app(art, game)` to
  override it.
- `nine.skinRects(game, kit)` swaps plain panel and button rects for frames in a game you don't
  rewrite by hand.

Then:

```sh
node authoring/tools/art-direct.mjs build --prod prod.json --builder authoring/artdir/gold/<key>.mjs \
  --direction d.json --out run/<key> [--profile trivia]
```

`finish.mjs` runs the five-bot gate, the verifier's full fix flow (look, readability, layout fixes,
solver) and two proofs against Prod: the rules hash (refused for a seeded game if it moves) and
replays (every Prod gate run plays the same on the new game: taps go to the same target, taps on
nothing stay on nothing unless an input reads raw pointer positions). `finish.json` holds the record;
`ok: true` needs gate pass, 0 blocking findings and equal replays.

### 5b. Loop critic (0 calls)

```sh
node authoring/tools/loop-critic.mjs run/<key>/manifest.json [--profile trivia] [--json] [--out run/<key>/loop.json]
```

Runs the five-bot gate, replays each run with a frame every 50 ms, and grades the loop against the bar,
`ok` or `WARN` per line (JSON with `--json`: `pass`, `warnings`, `issues`, `checks`, per-bot numbers):
goal (first meaningful input within 3 s), cadence (median and p90 seconds between inputs that change
the game within 250 ms, and between feedback moments; median at most 3 s), feedback (90 % of those
inputs answered within 0.3 s by something drawn differently, a sound, toast, haptic, shake or score
change), fair end, dead time (no stretch over 6 s without either), run length (45 to 120 s, regular
bots), skill spread (new player ≤ regular ≤ pro, scores differ), escalation (score, feedback or input
rate, or pace state such as speed, level, round, spawn rising 15 % from the first third to the last, or
interval, delay, cooldown falling) and restart (engine, under 2 s). Quiz bots answer at once, so a
quiz's run is shorter than a person's; read its run length with that in mind. Tests:
`node authoring/tools/test-loop-critic.mjs`.

### 6. See and fix (0 calls)

```sh
node authoring/tools/art-direct.mjs see --manifest run/<key>/manifest.json --out run/<key>/see \
  --frame run/<key>/frame.png --name <key>
```

`<key>-see.png`: the style frame, then the intro, a tween 150 ms after the first input, four play
frames, the last play frame and the end, all at phone size. Compare against the frame and the bar;
change the builder; build again. Things the verifier's fixes do that you should design away instead:

- a band rect behind the HUD (the layout fix for a moving sprite reaching the HUD): move the HUD to a
  band the sprite can't reach (Fog: the bottom band, since the rules keep the fog above y 643);
- text outlines and white plates (readability): put text on a frame, or pick the frame's ink.

Also watch for: sprites drawn at the wrong aspect (`w`/`h` must keep the sprite's own ratio), world
mismatches (Fog's glints spawn at y 170 to 500: the backdrop was redrawn with a high horizon and
anchored so the water starts above y 200), text over moving pieces at the end (hide the play layer
when `status != 'playing'`), and duplicate feedback (Guess the Decade shook three times on a miss).

### 7. Back up and republish

Back up the Prod manifest and the new one with `notes.json` (provenance, rules hashes, record), then
republish keeping the id with `game-backups/published-2026-11-13-image-art/replace2.mjs`
(`PLAN='{"<key>":"/abs/manifest.json"}'`), only when the rules-hash rule allows it. replace2 writes into
its own `<key>/` folder, so copy that folder aside first. A game whose owner has no stored credentials
(Fog Over the Bay is owned by a test account) can't be replaced: leave it backed up and say so.

## The gold games

| Game | Key | Direction | Calls | What changed |
|---|---|---|---|---|
| Pop Mart Labubu Blind Box Set | s3 | glossy pastel vinyl-toy shop, Baloo 2 / M PLUS Rounded | 4 | backdrop, 12 sprites (9 Labubus, box, slot, token), candy frames; box then figure on the counter, collection book of figure silhouettes, one HUD plaque |
| Fog Over the Bay | (unpublished key) | moonlit gouache bay, DM Serif / Work Sans | 5 | backdrop (redrawn once with a high horizon), fog, glint, puff, lamp, sea-glass frames; HUD in the bottom band, calm lines dropped |
| Guess the Decade | k20 | synthwave sunset, Righteous / Josefin / Teko | 1 | presentation only (seeded): sky, striped sun, mountains and grid as shapes, neon answer pills, one shake on a miss |

## Gold v2 (art direction v2, 2026-11-13)

Every v2 game carries a lettered wordmark (intro handoff via `presentation.app`, and the end card), the
look kit's characterful display face, and sprites for every figure. Builders in `artdir/gold/`.

| Game | Key | Builder | New calls | Loop | Proof |
|---|---|---|---|---|---|
| Guess the Decade | k20 (seeded) | `k20v2.mjs` | 4 (wordmark, backdrop edit, 8 sprites, UI kit) | unchanged (seeded) | logic hash same, 6/6 seeded run logs replay, replays equal |
| Duolingo: Unhinged Owl Streak Sprint | s5 | `s5.mjs` | 5 (frame, wordmark, backdrop, Duo in 4 moods + flame + heart, UI kit) | typed answers on a 31-point keyboard → tap-the-translation cards, 5 hearts, shrinking clock, easy→hard tiers | `--new-rules`: own gate runs replay on the verified build |
| Pop Mart Labubu Blind Box Set | s3 | `s3v2.mjs` | 1 (wordmark) | one box tapped 14 times (luck) → shelf hunt: peek tags, golden secret only in mystery boxes, 4-token trades | `--new-rules`; skill spread in the gate (86 vs 97) |
| Fog Over the Bay | fog (unpublished key) | `fogv2.mjs` | 1 (wordmark) | unchanged | logic hash same, replays equal |
