# Handoff: Muse harness work

## 0. Status on 2026-11-13 (read this first)

Pushed as a **reference branch, not for merging**: `codex/muse-harness`, still on its original base
(`6a0cc9b`, just after main `6b1cc85`). Karthik is taking over the visuals; this is Bayan's handoff.

What is already on `main` (through `bayan/harness-explore`, merged as `2b77467`), so ignore it here:
the flap jump, `gap_walls`, the `dead_inputs` gate check, `grid_board` centring, the style kit and
art experiments in `authoring/harness/style/`, the layout experiment, and the server visual stage
(`spec.visual`, `backend/generator/src/art.mjs`, which paints over the game's real layout).

What is only on this branch:
1. **The on-device art pass** (`FacebookClone/Bubbles/Studio/MicrogameArtPass.swift` plus hooks in
   `MicrogameComposer.swift`, `MicrogameStudio.swift`, `StudioMicrogameBridge.swift` and
   `tools/bubble-studio/microgame.swift`). **Superseded:** `main` `b8b166f` moved game making to the
   server and deleted `MicrogameComposer.swift`, and the server's `art.mjs` does the same job. Keep it
   only as a reference for the prompt and the "keep the game's own art on any failure" behaviour.
2. **Genre-convention prompt rules** in `MicrogamePrompts.swift` (flappy = 1 life + `gravity_jump`
   flap + `gap_walls`; runner, pairs, quiz, snake and merge conventions; "draw and collide with the same
   numbers"). Not on `main` in any form. **Worth porting** into `authoring/expander/prompts.mjs`.
3. **Bot planner experiments** for gap games (section 2): not wired in, not finished.
4. **Prompt Arcade** (`playtests/prompt-arcade/`): a local page that plays 11 Muse games before and
   after the art pass (`node playtests/prompt-arcade/serve.mjs`, then open http://127.0.0.1:8787).
   `muse/results.json` has each game's gate summary before and after.

The rest of this file is the original working notes from 2026-11-12. Paths into scratch folders in
them are local to Bayan's Mac.

Not pushed: `scroll-games/` (about 900 MB, mostly Rust build output; not part of this work).

## 1. Where things stood on 2026-11-12

- Branch: `codex/muse-harness`, based on main `6b1cc85`. Everything was uncommitted then.

## 2. The bot work (my part)

Goal: make the gate's bots able to fly through gaps, so a 1-life flappy game passes the gate. **Not finished. The bots are back to their original behaviour.**

What I tried (all in `bots.mjs` / `gate.mjs` / `gate-async.mjs`, then reverted):
- A shared `chooseAction`. When the 45-step look-ahead ties "wait" with "act", it searches further ahead.
- Search versions tried, in order: a lazy reflex rollout, a depth-first search, a beam search, random shooting, and finally an evolutionary plan search (12 plans, 6 generations, 120 steps ahead, plans judged "as planned" and "a beat late").
- A "focus" mode: after a critical moment the bot decides twice as often for one second, and its random lapses are scaled to match.
- The last version is saved as `authoring/harness/bots-planner-experiment.mjs`. It is NOT wired in. The timing script is `authoring/harness/gate-async-timing-experiment.mjs`. It uses absolute paths from my scratch folder, so edit them before use.

What I learned:
- The bots die at the 2nd or 3rd wall (4 to 8 s). The planner helped (the pro bot sometimes reached 12 walls in 26 s) but results are noisy.
- Two causes. (1) The planner hugs the edge of the gap, so any stray flap kills. (2) Bot "lapses" (30% random picks for a regular, 5% for the pro) pick a random key, and 2 of 3 keys are flaps. In a 1-life game a lapse at the wrong moment ends the run.
- The final slip-aware version was too slow: 12 s for one game, 89 s for another, on this Mac. Too slow for the 150 s app limit.
- Best configs found passed only some game variants (for example gravity 900, jump 300, speed 100, gap 280 to 240). None was stable.
- Idea not yet tried: make a "regular" lapse mean a noop or a nearby action instead of a uniformly random key. Another idea: reward plans that stay near the middle of the safe region.

Timing baseline with the original bots (async gate, this Mac, all 37 games): total 67 s, slowest game `hangout_words` 19.6 s, next `fog_dodge` 6.0 s. Node `run.mjs` (replay-based) total 739 s, slowest `number_merge` 141 s and `gold_goblin_snack_run` 140 s. All 37 games pass. Baseline table is in scratchpad `before.txt` / `report.before.json`. It is not in the repo.

Checks after the revert:
- `node authoring/playtest/test-dead-inputs.mjs`: 10 passed, 0 failed.
- Five games rerun with the async gate (bullseye_relay, firefly_note, fog_dodge, flap_gaps, meadow_hop): same pass/fail and same per-bot results as the baseline.
- NOT re-run after the revert: the full `run.mjs` over all games, and the broken owl game at `.../scratchpad/owl-art/authoring-before.json`. The `dead_inputs` code was not touched, so it should still block it, but I did not check.
- `authoring/playtest/report.json` is gitignored. I restored the copy I saved before starting.

Two things changed that you should know about:
- `authoring/fragments/gap_walls.fragment.json`: the top wall part now collides up to y = -100000 (it was -60). Before, a bird flying off the top of the screen passed every wall, and the bots found that exploit. The describe text was updated. This is a real fix and is kept.
- `authoring/games/flap_gaps.authoring.json` is unchanged: still lives 3 and very easy (gravity 700, jump 300, speed 90, gap 300 to 260). It still passes the gate. It has NOT been set to lives 1, because that fails with `too_short`.

Task 2 (Studio bundle): NOT done. `make-studio-bundle.mjs` was not run, and `test-studio-bundle.mjs` was not run. I did not read `studio.mjs` or the Swift gate decoding. Do this after the rebase (step 4).

To resume:
```
export PATH=$HOME/.cargo/bin:$PATH
export MG_ENGINE_DIR=/private/tmp/claude-501/mgbuild/engine   # or the scratchpad mg/engine
node authoring/playtest/run.mjs            # about 12 min
node authoring/playtest/test-dead-inputs.mjs
node authoring/tools/make-studio-bundle.mjs
node authoring/tools/test-studio-bundle.mjs
node authoring/tools/make-studio-bundle.mjs --check
```

## 3. Earlier work in the same change set (from the coordinator)

- `gravity_jump` got a `flap` param. New `gap_walls` fragment. New example `authoring/games/flap_gaps.authoring.json`. SPEC 1.7 row. README count 34.
- Gate `dead_inputs` check (`bots.mjs` isDeadInput/probeDeadInputs, `gate.mjs`, `gate-async.mjs`, `test-dead-inputs.mjs`): a key/swipe mash probe. It needs at least 20 inputs. Warn at 50% dead, block at 75%. The owl game is blocked (61 of 74). Warnings on Fog Dodge, Meadow Hop and Rooftop Courier. The margin is thin: 71% games vs the 75% line.
- Genre-convention bullets added to `FacebookClone/Bubbles/Studio/MicrogamePrompts.swift` (flappy: 1 life, `gravity_jump` flap:true + `gap_walls`; prefer fragments; draw and collide with the same numbers). The server copy `backend/generator/src/prompts.mjs` is not changed.
- Art pass in the app: new `FacebookClone/Bubbles/Studio/MicrogameArtPass.swift`, with hooks in `MicrogameComposer.swift` (drawArt step, .drawingArt event), `MicrogameStudio.run(script:)`, `StudioMicrogameBridge.swift` and `tools/bubble-studio/microgame.swift`. Off with `FB_STUDIO_ART_PASS=0`. Known bug: the layout poster comes back nil in the app even when leasing a host, so Muse draws without the layout image.
- Art experiments in `authoring/harness/style/`: `mockup-experiment.mjs` (muse-image mockup to Wonder SVG), `raster-experiment.mjs` (muse-image backdrop, one call per sprite on green, sam-3.1 boxes via /v1/responses, chroma key, WebP; 64 to 73 KB per game, 25 to 35 s), `image-gallery.mjs` (`--styles`). The sam-3.1 mask encoding is undocumented and not decoded; boxes work.

## 4. Conflict to resolve first

Artem pushed beta-version/main `3b4536a` at 18:54. `MicrogamePrompts.swift` there reads its text from the Studio bundle (`authoring/expander/prompts.mjs`, `quality.mjs`, `pipeline.mjs` with a polish step). This branch is on `6b1cc85`, so the Swift prompt edit and any rebuilt bundle will conflict. After rebasing, move the genre rules into `authoring/expander/prompts.mjs`. Artem asked that the art pass run after his polish step. His agent has claimed these files. Slack heads-ups are in his thread (no reply yet).

## 5. Next steps, in order

1. Rebase on `3b4536a` and resolve the prompt move.
2. Rebuild the bundle and run its tests (commands above). Check `studio.mjs` passes `dead_inputs` through, and that `MicrogameStudio.swift` decodes the gate report with new fields.
3. Finish the bots for gap games so 1-life flappy games pass. See section 2 for ideas. Keep the slowest game well under 150 s in the app. Then set `flap_gaps` to lives 1 and tune it.
4. Rebuild the app. Xcode is at `/Applications/Xcode.app`. Use the iOS 26.2 iPhone 17 Pro simulator `845CF8EE-6FD9-4CC9-82F4-5C993450CD09` (iOS 18.5 crashes on libswiftWebKit).
5. Remake "a tap-to-flap game where a little robot owl flies through gaps between neon pipes over a rainy cyberpunk city at night" with `FB_STUDIO_AUTOPILOT=build`. Check it uses flap + `gap_walls` + 1 life and passes.
6. Fix the art-pass layout poster.
7. Add layout and overlap checks (text vs text, text over busy art).
8. Raster art for backdrops.
9. Matched-set consistency test.
