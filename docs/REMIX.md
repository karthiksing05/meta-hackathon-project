# Remixing

A remix takes a published game and makes a **new game** from it: a new id, `lineage.remix_of` pointing at the
original, and the person's change applied. The original is never edited.

## What a remix keeps and what it changes

A remix never changes the essential goal of the game. A trivia game stays a trivia game; a runner stays a runner.

| Locked (kept from the original) | Free (changed when the person asks) |
|---|---|
| The formula and genre | Content: questions, topics, words, levels |
| What the player is trying to do (the core loop) | Characters and sprites: main and side sprites are repainted by Muse Image |
| How a run ends: win, lose, timeout (`objectives`) | The answering format (multiple choice, type-in, swipe, tap-the-picture), as long as the loop stays the same |
| The score exists and points the same way (higher or lower is better) | Visual style, palette and backdrop |
| `group_play` and the Group or Event scope | Special effects and juice (added or removed), sound, copy, theme, title |

Anything the person didn't ask to change stays as it was, including the art: a rules-only change paints nothing.

## The flow

1. **App.** The Remix or Studio screen sends `POST /v1/generate {baseGameId, change}` (`GameGeneratorLive.start(revision:)`).
2. **Backend** (`backend/internal/api/generate.go`). `reviseBase` checks the base is a microgame and turns `change`,
   `look` or `nextLevel` into the request. `runJob` reads the base's stored manifest and posts
   `{request, base, remixOf}` to the generator. A remix gets no harness plan.
3. **Generator** (`backend/generator/src/composer.mjs`, `src/remix.mjs`):
   - **No authoring source?** Hand-built and older games may lack `content.authoring_json`. The generator then
     describes the published game (title, rule, brief, `game_json` without pictures) as a request and rebuilds it
     as a new game with the change (event `remix_rebuilt`).
   - **Remix rules.** Every remix's compose prompt says what is locked and what is free. A request to change the
     genre ("turn this trivia game into a runner") is declined with an event (`remix_declined`) and the rest of it
     is applied.
   - **Art plan.** If the request touches the look, one small Muse call (`remix_plan`) decides which of the base's
     sprites are repainted and what each now shows, plus a new backdrop if the setting changes. When that call
     fails, a word match picks the main character ("main character X") and the side characters ("side characters
     Y"). A rules-only change makes no call.
   - **Painting.** The repainted sprites are painted in one Muse Image sheet under their **old ids**, so every figure
     that drew the old picture draws the new one. The palette and style words come from the base, with the old
     cast's names removed, so the new pictures match the kept ones. Unchanged sprites keep their base paintings.
   - **Compose** runs the full pipeline (validate, repair, five-bot gate, quality, layout verifier) on the base's
     authoring source with the change, and the verifier runs again after the pictures go in.
   - **Checks.** `loopCheck` compares the remix with the base. If the formula changed or the score is gone or
     flipped, the job fails. Changed end states raise an event (`remix_loop_changed`). If a repaint didn't land, the
     generator sends `remix_art_failed`. A result that is byte for byte the original sends `remix_unchanged`.
     `stats.remix` records the plan, what was repainted, what was kept and the loop check.
4. **Backend** stores the result as a draft game with `remixOf`; the app publishes it.

## Limits

- The art plan and repaint only run on the image-first art path (the default). With `GENERATOR_IMAGE_FIRST=0` a
  remix keeps the base's art.
- A rebuilt remix (no authoring source) is a fresh build of the same idea. Its art is newly painted, not the
  original's, and the loop check can't compare end states.
- Sprite poses are not repainted separately: a repainted character is one picture.
- One sheet holds up to 16 repaints. At most 4 image calls run per build.
- The loop check reads `objectives` and `score`; it can't tell whether two different fragment sets play alike.

## Goals

- A remix changes exactly what was asked and keeps the rest.
- Swapping a sprite or character repaints it, in the original's style.
- Every game can be remixed, including hand-built ones.
- Failures show up as a job error or an event, never as a silent copy of the original.
- The full verifier gates every remix, like every new game.
