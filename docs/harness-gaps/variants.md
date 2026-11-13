# Harness gap: versions to choose from (A/B)

Owner: Claude (for Karthik), branch `vis-ab` → `harness-v2`. 2026-11-13.

Karthik's note: "have multiple options for games". From one request, Muse makes 2 or 3 versions of the game. The
person sees them side by side, plays either, and keeps one. The pick feeds the next plan.

## What varies

The plan (`harness-context/1`) is shared. Every version keeps the spec's `goal`, `score` and `social` (group play),
so the versions are the same game in the ways that matter for a board, and differ on **one axis** each:

| Axis | What changes | Open when (`pickAxes`) |
|---|---|---|
| `look` | the art style: `spec.theme.look`, `spec.feel.look`, and a note to draw every sprite that way | the request names no art style (0.75), or the plan guessed it (0.9) |
| `twist` | the custom rule: `design.twist`, carried on `spec.loop.twist` (compose shows the spec, not the design) | a vague request (5 content words or fewer, or no mechanic cue such as "where", "but", "before") and a twist that shares little with it (0.8) |
| `arc` | the difficulty ramp: `spec.progression.steps` (levers kept) | nobody said how hard (0.45), or the plan guessed the difficulty (0.6) |
| `type` | the game type: the other of the two best-matched types | the two top types score within 0.05, the plan builds one of them, and they play differently (another family, or tools that barely overlap) (0.85) |

A request that names a style, a difficulty or a precise rule closes that axis (score 0.1–0.2). A pick on an axis
settles it for that person (score × 0.3), so the next round explores another one.

On Kevin's 32 plans the first axis comes out as: look 15, type 7, twist 7, arc 3. Type picks look right: #15 F1
(`top_down_racer` vs `car_lane_dodger`), #20 decade melody (`sound_effect_guess` vs `music_quiz_tempo`), #28 spot the
difference (`spot_difference` vs `what_changed_room`). The same mechanic under two names (#4 `rare_answer_daily` vs
`rare_answer_trivia`, #22 the two Connections types) is not offered.

The alternatives come from one small Muse call (`muse-spark-1.3`, minimal effort): a 2–4 word label for the current
value and for each alternative, plus the value. If it fails, built-in alternatives stand in (the four shipped looks;
a gentle and a steep arc; the runner-up type needs no Muse). An axis with nothing to offer hands over to the next.

## Two ways to make a version

- **Separate:** a full compose per version, all in parallel. Wall time is the slowest version, not the sum. Cost is N
  composes.
- **Shared:** one full compose (version a, the plan as written), then a cheap pass per other version:
  - `look`: a **restyle**. Muse redraws only the `art` section (palette, font, backdrop, sprites) and picks the look; the
    rules are untouched, so the game is expanded, validated and gated again, and keeps a's score model and group play.
    If the new drawings don't validate, the new palette, font and look go over the old drawings.
  - `twist`, `arc`: a **revision** of a (`compose` with `base`), the same path Studio's "change it" uses.
  - `type` is always separate.

`mode: 'auto'` (the default) restyles for `look` and composes separately for the rest; the numbers below are why.

## Measured (real Muse, 2026-11-13, 2 versions each)

Prompts #4, #13, #22 (arc forced with `--axes arc`; auto would pick look) and S1, each with the plan from last
night's Stage A. Version a is composed once and reused by both ways. Wall time counts from the moment the
alternatives are ready (that call took 2.9–4.8 s and about 0.8k tokens). Tokens are prompt + completion; every
Muse call is counted, including composes that failed.

| Prompt | Axis | Versions | a: compose | b: full compose | b: cheap pass | Wall, separate | Wall, shared |
|---|---|---|---|---|---|---|---|
| #13 Fruit Ninja spam | look | Neon Night Inbox / Gritty Paper Shred | 136 s, 33k + 8k, pass | **failed** after 145 s (never validated), ~150k + 31k | restyle 28 s, 2.1k + 3.1k, pass | 145 s, 1 version | 164 s, 2 versions |
| S1 HeyTea foam tea | look | Flat Cute Smiles / Cozy Watercolor Shop | 96 s, 31k + 10k, pass | 157 s, 67k + 20k, pass | restyle 27 s, 1.7k + 3.6k, pass | 157 s | 123 s |
| #4 Krillion, Greek myths | twist | Obscure Rewards / Timed Sacrifice | 223 s, 136k + 16k, pass | 193 s, 89k + 11k, pass | revision 134 s, 52k + 9k, pass | 224 s | 357 s |
| #22 Connections | arc | Quick Spot Finish / Slow Reveal Climb | 209 s, 63k + 13k, pass | 277 s, 65k + 19k, **gate failed** | revision 137 s, 67k + 12k, pass (unranked) | 277 s, 1 version | 346 s, 2 versions |

What this says:
- **Look: restyle.** A restyle costs about 5k tokens and 27–28 s, against 65–150k tokens and 145–157 s for a full
  compose: about **95% cheaper per extra version**. It also can't break the game: the rules are a's, so it passed
  2 of 2, while one of the two full composes for a look never validated. Wall time is a + 28 s (123–164 s here).
  A 3-version look request costs about 1.1–1.3× a single game.
- **Twist and arc: separate, in parallel.** A revision still sends the full system prompt, so it costs 52–67k prompt
  tokens, 60–100% of a fresh compose, and it can only start after a, so wall time is a + 134–137 s (346–357 s) against
  224–277 s in parallel. Revisions passed 2 of 2 and the full composes 1 of 2; with 3 versions the parallel wall time
  stays at the slowest one. A 2-version twist request costs about 2× a single game.
- **Type** always needs its own compose.
- So `mode: 'auto'` restyles for look and composes in parallel for the rest. The gate drops what fails; on these
  four, auto would have delivered 2, 2, 2 and 1 versions (#22's full compose for the slower arc failed the gate).

Contact sheets (a, b full compose, b cheap pass): `sheet-k4.png`, `sheet-k13.png`, `sheet-k22.png`, `sheet-s1.png` in
the lead session's scratch folder (`vis-ab/`). The restyles read as the same game in a new medium (#13 neon inbox → paper
office, S1 flat → watercolor); the twist versions show the new rule on screen (#4 "Sacrifice 5s for 2×"); the arc
versions differ in play, not in the poster (#22 the slower reveal opens 8 of 16 tiles first).
Both posters of #4 show the prompt line running off the screen: the overlap problem, not a variants one.

## Built

- `authoring/expander/variants.mjs`: `pickAxes`, `planVariants`, `variantBrief`, `makeVariants`, `restyle`,
  `pickEvent`, `applyPick`, `withPreferences`. Pure, like `pipeline.mjs`: it calls the Studio's `compose`, `expand`,
  `gate` and `wrap`, and changes no pipeline file.
- `makeVariants({request, brief, context, n, axes?, mode}, studio, {ask, onEvent})` returns
  `{variants: [{id, axis, label, value, manifest, poster, gate, quality, score, how, stats}], recommended, dropped, axes, stats}`.
  Only versions that built and passed the gate are kept; `dropped` says why the others went. `recommended` is the
  version that passed with the best quality score (ties go to a, the plan). Each manifest gets
  `variant: {id, axis, label, of}`. Events: `variants_planned`, `variant_ready`, `variant_dropped`, and every compose
  event tagged with `variant`.
- `poster` is what the picker card needs before anyone plays: title, line, label, axis, emoji, colors, font, look, the
  art style sentence and the twist.
- `authoring/tools/variants-muse.mjs`: the CLI on real Muse, `--mode both` measures separate and shared on one plan,
  `--posters` renders each poster, `--pick b` writes the pick event and the next plan's context.
- `authoring/tools/test-variants.mjs`: 54 checks, no network.

## Learning from the pick

When the person keeps one, the app sends a `variant_pick` event:

```json
{"kind": "variant_pick", "group": "mg-spam-slash-x1y2+mg-spam-slash-b7k",
 "axis": "look",
 "chosen":   {"id": "b", "game_id": "mg-spam-slash-b7k", "label": "Gritty Paper Shred", "value": "…"},
 "rejected": [{"id": "a", "game_id": "mg-spam-slash-x1y2", "label": "Neon Night Inbox", "value": "…"}],
 "played": ["a", "b"], "at": "2026-11-13T01:02:03Z"}
```

`applyPick(context, event)` folds it into the person's next plan context as `preferences: [{axis, chosen, rejected, at}]`
and a line in `notes` ("preference (look): the person chose "Gritty Paper Shred" over "Neon Night Inbox"; lean that
way."). A later pick on the same axis replaces the earlier one. On the next request, `withPreferences` puts every
preference in the brief's notes (compose reads those), and a `look` preference also sets the spec's look unless the
new request names a style of its own. Twist and arc picks belong to one game, so they only lean.

## Requests

### Max: a job that returns versions, and a pick route

1. **`POST /v1/generate` takes `variants: 2 | 3`** (absent or 1: today's single game). With it, the generator runs
   `makeVariants({request, brief, context, n: variants, mode: 'auto'}, studio, {ask, onEvent})` from
   `authoring/expander/variants.mjs` in place of `studio.compose`, with the same `ask` (it honours
   `{model, effort, max_tokens}`: the alternatives call is `muse-spark-1.3` minimal, the restyle `muse-wonder-1.0` low).
   The job's result becomes:
   ```json
   {"variants": [{"id": "a", "axis": "look", "label": "Neon Night Inbox", "game_id": "mg-…", "poster": {…},
                  "gate": {"passed": true}, "quality": {"score": 82}, "how": "compose"}, …],
    "recommended": "a", "dropped": [{"id": "c", "axis": "look", "label": "…", "reason": "…"}]}
   ```
   Each version is stored as its own unpublished game (its manifest carries `variant: {id, axis, label, of}`), all
   sharing a `variant_group` id. Progress events carry `variant` (`a`, `b`, `c`), plus `variants_planned`,
   `variant_ready` and `variant_dropped` with a `summary` line. Budget: the job's wall cap applies to the whole step;
   look versions add about one restyle call after version a, other axes run in parallel.
2. **`POST /v1/games/{id}/pick {played?: ["a","b"]}`** (id = the kept version's game id): publishes that game, deletes
   (or hides) the other versions in its `variant_group`, logs the `variant_pick` event (shape in
   docs/harness-gaps/variants.md) to the event log, and stores `{axis, chosen, rejected, at}` on the person's profile
   as `preferences` (one per axis, the latest wins). Returns `{game, pick}`.
3. **The next plan reads it:** `/v1/harness/plan` and the generate job put the person's `preferences` into
   `context.preferences` (and the line from `preferenceNote` into `context.notes`) before compose, so
   `withPreferences` and `pickAxes` see them.

### Artem: the picker in Studio's Try step

Where: Studio's Try step, when the job returned more than one version. New files plus a hooks patch you approve; the
data is the job result above (and the mock behind `GamesAPI` until Max lands it).

States:
1. **Making.** One card per planned version as soon as `variants_planned` arrives: the label ("Neon Night Inbox"),
   the axis as a small caption ("Look", "Twist", "Difficulty", "Game type"), and that version's latest `summary` line
   under a shimmer. A version that sends `variant_dropped` greys out with "Didn't make it" and its card collapses
   after 1 s. With look versions, b and c start after a finishes (they say "Waiting for the first version").
2. **Ready to compare.** Two or three posters side by side (two: 50/50; three: a horizontal pager, one and a bit
   visible), each the runtime's poster mode at card size, with the label under it. The `recommended` one has a
   small "Our pick" tag. Only versions in `variants` are shown; if just one passed, skip the picker and go straight to
   today's Try step with a one-line note "We made 1 of 2 versions".
3. **Playing one.** Tap a poster: it opens in the normal Try player (full screen), with a top bar "Version b of 2 ·
   Neon Night Inbox" and two buttons, "Back to versions" and "Keep this one". Its score from this run shows on its
   card when it comes back ("You: 1,240").
4. **Keeping.** "Keep this one" (on a card, or in the player) asks nothing more: it calls
   `POST /v1/games/{id}/pick {played}` with the ids played in this session, shows the kept card growing to full
   width while the others slide away, then continues to today's Publish step with that game.
5. **Leaving without a pick.** Closing Studio keeps all versions as drafts in the same group; reopening the draft
   returns to state 2.
6. **Errors.** A pick that fails keeps state 2 and shows "Couldn't save your pick. Try again." A job where no
   version passed shows today's failure screen.

Accessibility: each card reads as "Version b, Neon Night Inbox, look. Our pick." Buttons are at least 44 pt.
Copy uses no brand word; the axis captions are the only new strings besides those above.

### Integrator: pipeline hooks

1. **`prompts.mjs` planMenu:** when `context.preferences` is non-empty, add a short section after the spec: "The person's
   earlier picks: …" with one line per preference (`preferenceNote` from variants.mjs). Today they reach compose only
   through `brief.notes` (via `withPreferences`), and `context.notes` is not shown to Muse at all.
2. **`studio.mjs`:** expose `variants(argsJSON, ask, onEvent)` in the Studio bundle, a thin wrapper over
   `makeVariants` with the same local studio object `compose` builds (so the app and the server use one copy), and add
   `variants.mjs` to `make-studio-bundle.mjs`. Bump `STUDIO_API_VERSION` to 5.
3. **`prompts.mjs` planMenu:** `spec.loop.twist` (set by a twist version) should be called out as "This version's
   twist" so Muse treats it as a rule, not a note.
4. **Go planner prompt:** read `context.preferences` (from Max's profile store) when filling the spec: a look
   preference fills `theme.look` when the request names no style, and the checklist slot it settles is
   `source: you`, not a guess.
5. **When Bayan's style kit (`authoring/harness/style/`) is wired into compose,** point `restyle` at it (style director
   plus illustrator for the new direction) instead of the one-call redraw; `restyle`'s signature stays.
