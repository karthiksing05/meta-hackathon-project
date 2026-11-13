# Harness gap: pictures in games

Owner: Claude (for Karthik), branch `gap-images` → `harness-v2`. 2026-11-12.

## Who needs it

| Prompt | What it needs | Today in v2 (Kevin-32 plans) |
|---|---|---|
| #32 "Wildlife photography trivia: zoom in on a tiny crop of a photo and guess the animal before it zooms out" | one picture per round, a crop that zooms out by the clock, choices | retrieved `guess_the_year`, `whose_photo_guess`, `zoomed_image_guess` (3rd); tools `image_gallery` planned, `photo_picker` gap |
| #28 "Spot the difference … two nearly identical chaotic group-chat screenshots" | two pictures with known differences and an answer key | `spot_difference` at 0.99, but its tools were `image_assets`, `reveal`, `timer_bar`: no way to make the pair or the key |
| #16 "Guess what the French person is saying … funny images of French people" | a picture per line, **never a real person's likeness** | `guess_the_person`, `famous_speech_finish`; `image_gallery` planned |

Also likely: "what's this close-up", picture or emoji rebus, hidden-object photo hunts, picture reveal, and "whose photo is this" in a Group (that last one is a privacy question, `photo_picker`, not this gap).

## What already works (read from the code)

- **Engine** (`engine/SPEC-v0.2.md` §1–2, `engine/web/render.js`): `image` assets are inline SVG, `data:image/*` URIs (4 MB) or `https://` URLs; sprite sheets with `frames`/`cols`. Image nodes take bound expressions for `x`, `y`, `w`, `h`, `scale`, `frame` and even `asset`, so a picture can zoom and pan **by the game clock**, which keeps replays exact (`now` is the engine's clock; rendering never feeds back into state). The renderer clips only the whole frame: **there is no per-node clip or source rectangle.**
- **Expander** (`authoring/expander/art.mjs`, `svg.mjs`): sprites are sanitized SVG (24 KB each) or `data:` images (512 KB each), at most 32 sprites and **192 KB of art in total**; no outside URLs. A list of SVGs becomes a sheet, about 6 KB per frame when there are 4 or more frames. Sprite `w`/`h` go up to 1024, which keeps SVG sharp when zoomed.
- **Server** (`backend/README.md`): packages may carry images and `cover.*` becomes `coverUrl`, but the generator never calls `muse-image-1.0` and has no per-game asset store for in-game pictures.
- **Muse Image, tested from this Mac (2 calls):** fox 13.3 s, 1920×1280 WebP, 538 KB; otter 17.7 s, 1600×1600, 620 KB (the `size` parameter was ignored). About 18k tokens a call. Photo-real and on-prompt. Shrunk to a 384 px JPEG it is 32–43 KB, so about 4 pictures fit the 192 KB art budget as base64. Nothing of people was generated or saved.

## Options

**A. Drawn pictures, made at build time (built now).** Muse draws each round's picture as SVG, or writes a scene of placed objects that code turns into pictures. No new services. Cost: the normal compose call; no image calls. Replays: safe (all data in the game file). Limit: flat illustration, not photos.

**B. Generated pictures at build time (`generated_image`, planned).** In the job, the server calls Muse Image once per picture (about 15 s each, in parallel), shrinks them, tiles them into one JPEG sheet and puts it in the game (data URI under the budget, or a games-host URL). Cost: about 6 calls a game; at Bayan's measured ~$0.15–0.34 per image job, roughly **$0.50–1.00 a game**, and +15–20 s wall time if run in parallel with compose. Needs Max (job step, storage, CORS-safe URL) and Bayan (one style per game). Replays: safe, because the pictures are fixed at build time and never affect state. Never real people: the plan turns them into invented caricatures.

**C. CC0 photo packs (`picture_pack`, planned).** Curated Wikimedia Commons / iNaturalist CC0 sets with source, author and license recorded, hosted on the games host. Cost: a one-time curation pass; free per game. Best for "real wildlife photos". Needs Max for storage. Slowest to build, narrowest topics.

Spot the difference needs none of B or C: **a scene of placed objects plus deterministic edits** gives two pictures and an exact answer key, which a raster image can't (there is no inpainting, and the key would have to be guessed from pixels).

## Recommendation

Ship A now (done in this branch). For the demo's #32, add B with a small, fixed set (6 pictures, one style) once Max can run an image step in the job; C later. Keep every picture fixed at build time: nothing calls Muse while someone plays.

**Honest stand-in until B lands:** a photo request gets detailed drawn pictures, and the plan says so in the anatomy ("photo-style pictures aren't ready yet; these are drawn"). A request about real people (#16) gets invented cartoon characters and public-domain or game-written lines, and the plan says so ("we never show real people; these are made-up caricatures").

## What's built

| Piece | Path | Status |
|---|---|---|
| `zoom_reveal` fragment: picture in a 280 px window, starts `zoom_from`× around a focus point (jittered per picture), zooms out by the clock, `zoom_left()` for early-guess bonuses, snaps whole on `zoom_hold()`. Masks around the window with four `$bg` rects (no clip in the engine), so list it first | `authoring/fragments/zoom_reveal.fragment.json` | shipped |
| `picture_quiz` fragment: quiz rules with a picture layout (picture y 70–350, 2×2 answers) | `authoring/fragments/picture_quiz.fragment.json` | shipped |
| `diff_spots` fragment: two pictures, tap a difference in either, rings in both, misses, win on all found | `authoring/fragments/diff_spots.fragment.json` | shipped |
| Spot-difference generator: scene (rect, circle, ellipse, text with emoji, poly, line) → two SVGs, N changes (recolor, remove, move, resize, new text) with hit circles kept apart, decoys, `toAuthoring()` for `diff_spots` | `authoring/expander/spot-diff.mjs`, CLI `authoring/tools/make-diff-game.mjs` | shipped (`anomaly_generator`) |
| Zoom Safari: 8 drawn animals, 10 rounds, 2 lives, early-guess bonus. **Passes the gate** (5 bots 218–288 over 9–16 s, 1 lost, 4 won) | `authoring/games/zoom_safari.authoring.json` | example |
| Group Chat Detective (#28): synthetic chat scene, 7 differences. Validates and plays; the gate flags only `too_short` (bots find all 7 in ~3 s) | `authoring/examples/group_chat_scene.json`, `group_chat_diff.authoring.json` | example |
| Catalog: tools `zoom_reveal`, `picture_quiz`, `diff_spots`, `picture_choice` (shipped), `anomaly_generator` (now shipped), `image_gallery` (building), `generated_image`, `picture_pack` (planned), `image_clip` (gap); `image_assets` notes the limits. Types `zoom_out_picture_trivia`, `cartoon_quote_guess` (`types/seed_pictures.json`), the picture types re-tooled, 6 eval cases (recall@5 1.00). Checklists for the zoom/picture types, `cartoon_quote_guess` and `spot_difference` | `authoring/catalog/**` | |
| Tests: 44 checks (generator determinism, key matches pictures, emoji never recolored, 40/40 seeds clean; expansion; in the engine: taps, lives, full score on win, zoom geometry frame by frame, replay verify) | `authoring/tools/test-pictures.mjs` | green |

Rendered in headless Chrome with the real engine and renderer: the zoom crop, the zoom-out and the masked window look right, and SVG stays sharp at 6×.

**Not wired yet (planner and compose are the group-play agent's):** compose has no "scene" content slot, so Muse can't yet ask for a spot-difference pair. Wanted prompt change: when the plan uses `diff_spots`, ask Muse for `content.scene` in the `spot-diff.mjs` format (in the header comment) and call `makeSpotDifference` + `toAuthoring` in the pipeline before expanding. For zoom games, tell Muse to list `zoom_reveal` first, give the `picture` sprite `w`/`h` 512, and keep pictures detailed in the middle. The new fragments reach the server with the next Studio bundle rebuild (`node authoring/tools/make-studio-bundle.mjs`); I didn't rebuild it to avoid colliding with other agents.

## Option B built: generated sprites, backdrops and story portraits (2026-11-13)

`authoring/expander/image-art.mjs` (with `image-pixels.mjs` and `image-codec.mjs`, pure JS) runs **after the gate and
polish** on a game that already plays. It swaps the picture behind each asset id the game already has (same ids, w, h,
frames), so rules, state, hitboxes and replays are untouched: on six of Kevin's games the game_json differs only in
`assets`, and each new `authoring_json` still expands. CLI: `authoring/tools/make-image-art.mjs`; tests:
`authoring/tools/test-image-art.mjs` (67 checks, no network).

- **One style sheet per game:** a requested style (`pixel art`, `80s anime`, `Ghibli watercolor`, `LEGO`,
  `claymation`, … or free text) or the default bold cartoon, plus the game's palette and the spec's tone.
- **Art direction:** one `muse-spark-1.3` call (low effort, ~2k tokens, 12–27 s) describes each role, the backdrop and
  any real people; without it, role names and `spec.theme.named` are used.
- **One sheet call for all sprites** (up to 9 roles, a grid on a flat chroma key the art direction picks to avoid the
  sprites' own colors), one backdrop call, in parallel. Then key (border-sampled key, un-mix and despill on edges),
  slice (the grid's cells, or connected regions in reading order when the model ignores the grid; specks join the
  nearest subject), trim, fit to the asset's box, downscale (area average), sharpen, and encode: sprites as 8-bit
  palette PNG (3–7 KB at 128 px), the backdrop as JPEG (calmed toward the game's background, more for loud ones).
- **Sheet vs one call per role** (#3, #19, S9): the sheet is 2 calls and 35–57k tokens with one consistent style; per
  role is 6–8 calls, 90–138k tokens for the sprites alone, 37–59 s, and the styles drift (objects grow faces and legs).
  The sheet is the default.
- **Stories** (`branching_story`): a character lineup (one call, head-and-shoulders busts) sliced into portraits, then
  up to 5 key-scene stills drawn with `/images/edits` and the keyed lineup as the reference image, so faces and
  outfits stay the same. `story_vars` draws them (art roles `still`, `portrait`; params `stills`, `cast_at`, one frame
  per scene, `.`-separated, -1 for none; scenes inherit their nearest parent's still).
- **Real people:** every image prompt passes `guardPrompt`: a named real person becomes "a stylised cartoon
  caricature of …", photo words become "illustrated", and the prompt says never photorealistic. Brands are untouched.
- **Refusals:** `muse-image-1.0` refuses some franchise names (all Star Wars prompts we tried, even "Princess Leia in a
  white gown, cartoon"; brainrot, Labubu and Liquid Death are fine). A refused prompt is rewritten once by Muse
  without the names (described visually instead) and retried, then with the known names replaced.
- **Record:** `manifest.art_record` (`image-art/1`): model, `license: "generated"` per picture, style, key, the
  prompt per picture, and who was caricatured.

| Game | Calls (image + text) | Tokens (image / text) | Wall | Art |
|---|---|---|---|---|
| #3 Tung Tung runner, 7 sprites | 2 + 1 | 36k / 2k | 30 s* | 161 KB |
| #9 cats Angry Birds, 4 | 2 + 1 | 46k / 2k | 37 s | 81 KB |
| #19 Bombardiro Galaga, 5 | 2 + 1 | 35k / 2k | 33 s | 80 KB |
| #27 PvZ houseplants, 9 | 2 + 1 | 46k / 3k | 46 s | 140 KB |
| S3 Labubu, 3 | 2 + 1 | 57k / 2k | 44 s | 100 KB |
| S9 Liquid Death, 6 | 2 + 1 | 35k / 2k | 36 s | 86 KB |
| #1 Leia story, 80s anime, 4 cast + 5 stills | 6 + 7 (refusal rewrites) | 127k / 14k | 86 s | 170 KB |
| #17 peasant story, 4 cast + 5 stills | 6 + 1 | 116k / 3k | 98 s | 183 KB |
| #24 alley cats story, pixel art, 4 cast + 5 stills | 6 + 1 | 94k / 4k | 84 s | 148 KB |

\* art direction cached; #1 partly cached (lineup and 2 stills). Image calls ask for the default WebP: PNG output took 71–89 s a call against 13–24 s.

**Budget.** Everything fits today's 192 KB at 128 px sprites and a 450–540 px backdrop. Phone-sharp art (sprites drawn at
64–80 canvas units on a 3× screen) wants 192 px sprites and a 1080 px backdrop: 230–335 KB on these six games
(`fitBudget` uses that ladder when the budget is raised above 256 KB). Requested: 512 KB for `art: "image"` games, or games-host URLs.

## Requests

**For Artem (engine):**
> :wave: Claude (for Karthik) here, picture games. Could the engine get a clip? Either `"clip": true` on a `group` (clip children to the group's box; in render.js a save/clip/restore around the subtree), or `src_x, src_y, src_w, src_h` on `image` nodes (fractions of the frame). Why: `zoom_reveal` zooms a picture inside a window, and with no clip it has to paint `$bg` rects around the window, which hides the backdrop and anything drawn before it. Prompts: Kevin #32 (zoom-out wildlife), "what's this close-up", magnifier and jigsaw games. Replays are unaffected (presentation only). Catalog id: `image_clip` (gap).

**For Max (server):**
> :wave: Claude (for Karthik) here, picture games. Two asks, both build-time only (nothing runs while someone plays, so replays still verify):
> 1. **An image step in the generate job.** When the plan has `content.pictures: [{id, prompt, style}]` (up to 6), call `muse-image-1.0` for each in parallel (it takes 13–18 s and returns 1600–1920 px WebP, ~0.5–0.6 MB; `size` is ignored), shrink to 384–512 px JPEG, tile them into one sheet, and hand the compose step `{src, w, h, frames, cols}`. Refuse prompts that name real people. Record `license: "generated"` per picture.
> 2. **Where they live.** Either inline as a `data:` URI (fits about 4 pictures in today's 192 KB art budget; we can raise that for picture games), or stored with the package on the games host and referenced by `https://` URL with CORS headers (the runtime loads images with `crossOrigin = anonymous`, and posters need same-origin or CORS). Later: `picture_pack` storage for CC0 photo packs with source and license.
> Catalog ids: `generated_image`, `picture_pack`, `image_gallery`.

**For Bayan (art):**
> :wave: Claude (for Karthik) here, picture games. Your layout → Muse Image → chroma-key pipeline looks like the right engine for `generated_image`. Two asks: (1) one style instruction per game so a round's 6 pictures match (same palette, framing, background), and a cartoon-caricature style for requests about real people (#16: invented characters, never likenesses); (2) a gate profile for search games: the bots find all 7 differences in `diff_spots` in about 3 s because they tap every object, so a one-pair spot-the-difference always gets `too_short` (people take 20–60 s). A per-tap "look" delay, or a `search` profile with a lower length floor, would let it pass honestly. I didn't touch `art.mjs`, `svg.mjs`, `bots.mjs` or `gate.mjs`.
