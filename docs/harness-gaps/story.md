# Harness gap: branching stories and light RPGs

Owner: Claude (for Karthik), branch `gap-story` into `harness-v2`. Status: built and tested on 2026-11-12. Not yet
called by the pipeline (see Requests).

## Who needs it

Kevin's prompts:

| # | Prompt | What v2 did on 2026-11-12 (kevin32 run) |
|---|---|---|
| 1 | Star Wars choose your own adventure as Princess Leia escaping the Death Star | Made with `choice_story`, but the board went **unranked**: the score changed on a curtain timer, not on `ending_reached`. |
| 17 | A medieval peasant becoming king in 10 choices or less | Made, **unranked**: always tapping one button scored more than a regular bot (210 vs 160). Nothing checked the 10-choice limit. |
| 24 | A retro RPG: a stray cat building a gang to take over the alley | Retrieval picked a deck-building dungeon and a grid crawler, so no story. **Unranked**: no bot finished. |
| 29 | Office survival on Friday at 4:59 pm, dodging the manager | Planned as an arcade dodge game (`player_drag`). That's a fair reading. A story version is now in the catalog too. |

Other likely requests: a mystery to solve, a dating sim, "survive the week", "go from intern to CEO in 8 choices", and
a choose-your-path story starring our Group.

## What exists today (read from the code)

- **Engine plus `choice_story` fragment.** Up to 60 scenes, 4 text lines of about 30 characters, and 3 buttons.
  Scenes are encoded in four aligned string lists (`story_lines`, `story_labels`, `story_next`, `story_ends`). The
  fragment emits `choice_made` and `ending_reached`. It has no stats, conditions or choice limit, and a wrong list
  length silently does nothing.
- **What a game's own rules can do.** `gold_stormglass_affair` (43 KB) shows that conditions, effects, routes and
  callbacks run on today's engine. Its rules parse content strings (`split`, `parse_int`, `fold`) and rebuild the
  label and next lists after every choice. So engine work isn't needed: it only takes discipline, and Muse can't be
  trusted to keep four aligned encoded lists consistent.
- **The older JS story kit** (`bubble-kit-story.js`, docs/BUBBLES.md 7.6). It has a validator: no loops, depth ≤ 12,
  2–6 endings, flags only, no stats. It also has a share tag (`ending=…;path=…`) and the endings screen with friends'
  paths. The server only makes `microgame` formulas, so harness v2 never reaches this kit.
- **Gate and score check.** The generic bots tap whatever looks best 0.75 s ahead. For a story, that doesn't measure
  skill, so the skill-order and spam checks come out noisy (both unranked results above).
- **Group play** (group-play agent, `d479fa1`). `social.result` kind `ending` compares the ending first and then the
  score, with the ending in state `ending` and the count in `choices_used`.

## Options

| | What | Cost | Needs | Replay risk |
|---|---|---|---|---|
| **A. Story graph compiled on today's engine** (built) | Muse writes `story-graph/1` data. Our deterministic checker walks every path. Our compiler emits `choice_story` + a new `story_vars` fragment, a score model and story bots. | Done today. About 1 day to wire into the pipeline. | Lead/pipeline: one branch in compose. Bayan: nothing required. | None: everything is engine rules and content, and replays verified for 5 stories. |
| B. Route stories to the old JS story kit | Use the kit's validator, share tag and endings screen. | 2–3 days | Max (the generator makes non-microgame formulas), Artem (kit upkeep) | The kit is outside replay verification today. No stats. |
| C. A native story node in the engine | A `story` section with typed conditions and effects. No string parsing, and smaller games. | 3–5 days of Artem's time | Artem | Low, but it's a new engine contract |

**Recommendation: A, now.** Option A is built and gated on today's engine, the score ranks endings first, and its
results already fit the group-play `ending` shape. C can come later as an optimization: the same `story-graph/1` would
compile to the native node instead. B isn't worth reviving. Until compose is wired, the honest stand-in is today's
`choice_story` path, with the plan's `gaps` naming `branching_story` (status `building`).

## What we built

- **`story-graph/1` schema plus validator** (`authoring/expander/story-graph.mjs`). Nodes hold text (wrapped to
  4 × 30), a place, `enter` effects, 1–3 choices (`if`, `do`, ordered `routes`, `note`) or an ending (`tone`, `rank`,
  `share`). The graph can have up to 8 variables: stats (shown, range ≤ 20), items (shown in the bag) and hidden flags.
  It also takes `max_choices` and `on_limit`.
  - **How the check works.** It walks every reachable (scene, values, choices used) state, exactly as the engine
    does.
  - **Errors (they block):**
    - an unreachable scene or ending, with the reason (no link, or the conditions never hold);
    - a dead end, with the path that leads to it;
    - a path that never ends, or one that runs over the limit;
    - a best ending that the limit makes impossible;
    - text, label and share lengths;
    - unknown variables, bad targets, and the size limit (40 KB).
  - **Warnings:**
    - rare and dominant endings, from the exact odds for a random reader;
    - a best ending that's too hard (< 2%) or too easy (> 50%);
    - "doomed" stretches, where a run can't win any more but goes on for 3 or more choices;
    - always tapping the same button beating a typical run;
    - duplicate choices;
    - a story that's too linear.
  - **Stats it reports:** min and max choices to each ending, path counts, `p_win`, and content bytes.
  - **Button order.** Buttons are shuffled deterministically, because Muse puts the best choice first.
- **Compiler** (`compileStoryGraph`). Produces an authoring manifest with `choice_story` + `story_vars` and a score
  model:
  - points: ending tier × 1000, + 25 per unused choice on a good ending, + weighted stats;
  - changes only on `ending_reached`;
  - `{n} pts`.

  It also returns `groupResult` = `{kind: ending, compare: ending, endings: [best first], state: [ending,
  choices_used]}`, and adds a playtest progress hint (distance to the best ending) for the generic bots.
- **`story_vars` fragment** (`authoring/fragments/story_vars.fragment.json`). It shows only the choices that are
  open, applies effects, takes routes after effects, and enforces the limit. It holds the ending on screen for 3.5 s,
  then wins or loses. It sets `ending`, `choices_used`, `sg_share_line` and `sg_path`, and draws a HUD stats line, a
  bag line, a place label or note, and an ending card ("Ending 2 of 6", the title, "I became king in 6 choices").
- **Story bots** (`authoring/playtest/story-bots.mjs`). They play through the real engine and check every move
  against the graph: scene, values, phase, score, `ending` and `choices_used`. The bots are:
  - random ×3;
  - shortest (to the best ending);
  - longest;
  - worst;
  - one route to every other ending.

  `asScoreRuns` feeds them to `checkScore` (shortest = pro, random = regular, worst = new player).
- **Muse prompt** (`authoring/expander/story-prompt.mjs`) and a **CLI** (`authoring/tools/story-muse.mjs`):
  draft, then check, then repair from the checker's errors, then compile, engine-validate and run the story gate.
- **Catalog:**
  - tools (`tools/story.json`): `branching_story`, `story_vars`, `stat_block` and `story_bots` (building), and
    `story_share_line` (gap);
  - `inventory` updated;
  - new types: `choice_limit_quest`, `survive_the_day_story`, `group_cast_story` and `gang_recruit_story_rpg`;
  - `branching_story` added to every story-family type that uses `choice_story`;
  - 4 eval cases;
  - checklists for `story_choice`, `adventure_rpg` and `mystery_narrative`.
- **Examples** (`authoring/stories/`):
  - `peasant_crown`, hand-written, compiled into `authoring/games/story_peasant_crown.authoring.json`, which passes
    the generic gate;
  - four real-Muse graphs for #1, #17, #24 and #29.

### Measured (real Muse, muse-wonder-1.0 at effort low, 6 calls)

| # | Draft | After 1 repair | Scenes / endings | Best ending in | Random reaches best | Story gate | Score check (story bots) |
|---|---|---|---|---|---|---|---|
| 17 | best ending unreachable | valid | 17 / 6, limit 10 | 7 choices | 0.1% (warned) | PASS, 6/6 endings | ok (spam warn) |
| 1 | valid | — | 20 / 6 | 6 | 27% | PASS, 6/6 | ok (spam warn) |
| 24 | valid | — | 20 / 6 | 7 | 2.2% | PASS, 6/6 | spam fail |
| 29 | 1 error | valid | 19 / 5 | 4 | 45% (warned) | PASS, 5/5 | spam fail |

- **Muse calls:** drafts took 41–68 s and 4.6–6.8k completion tokens; repairs took 22–30 s.
- **Engine against graph:** across all 5 stories and 44 bot runs, the engine matched the graph on every move.
- **Tests:** `node authoring/tools/test-story.mjs` has 74 checks, 0 failed. It covers:
  - the grammar;
  - every checker error, on small broken graphs;
  - the stories;
  - deterministic compiles;
  - the engine;
  - the generic gate;
  - the score check.

## Requests

**For the lead / group-play agent (pipeline.mjs, prompts.mjs, owners of compose):**
> Story graphs are ready on `harness-v2` (`authoring/expander/story-graph.mjs`, `story-prompt.mjs`,
> `playtest/story-bots.mjs`). Ask: when the plan's types include `branching_story` (every story-family type that used
> `choice_story` now does), compose should do these steps instead of the normal compose:
> 1. Ask Muse with `STORY_GRAPH_SYSTEM` + `storyGraphUser(request, {spec, group})`.
> 2. `validateStoryGraph`; on errors, one `storyRepairUser` round (it fixed 2 of 2 invalid drafts).
> 3. `compileStoryGraph` gives the manifest and the score; put `groupResult` into `social.result`.
> 4. Gate with `storyGate`, and feed `asScoreRuns(gate.runs)` to the score check.
>
> Art and look still go through the normal polish step on the compiled manifest. Also, `story_vars` needs the Studio
> bundle regenerated. Spend: 1–2 Muse calls, about 45–100 s.

**For whoever owns `playtest/score-check.mjs` (lead):**
> For story games the spam check compares "repeat one tap" with a single "regular" bot. In a story, tapping the same
> button is a real (if lazy) reading, and one random reader is noisy: 2 of 4 Muse stories failed it while the story
> bots' skill order passed. Ask: when runs come from `story-bots` (or `gate_profile: calm` with `ending_reached` in
> `score.events`), compare spam with the median of the random readers and make a tie or a small win a warning. The
> validator already warns when always tapping one button beats a typical run (`S_SAME_BUTTON`).

**For Artem (runtime kit, `bubble-kit-microgame.js`):**
> A story game keeps its result line in state `sg_share_line` ("I became king in 6 choices"), the ending id in
> `ending`, the choice count in `choices_used` and the path in `sg_path` (button indices, dot-separated). Ask: when a
> run ends and the game state has a non-empty `sg_share_line`, use it as `share().score_text` instead of "6125 points".
> Also add `ending=<ending>;choices=<choices_used>;path=<sg_path>` to the result tag, as the old story kit did. Same
> ask as group play's: `MicrogameEngine.verify` returning the end value of `group_play.result.state`. Prompts: #1,
> #17, #24, #29.

**For Max (server):**
> For games whose `group_play.result.compare` is `ending`, store the run's `ending` and `choices_used` from the
> verified replay. Boards and Group results then group by ending, in the order of `result.endings` (best first),
> then by score. The score already counts unused choices, so "king in 5" beats "king in 7". No new endpoint.

**For Bayan:** nothing blocking. Story games draw no sprites unless the look adds a `scene` picture or a `button`
skin (both `choice_story` art roles, unchanged).

## What's left

- Wire the compose branch, and regenerate the Studio bundle with `story_vars` (the first request above).
- Group cast: `storyGraphUser` takes `group` (names and safe details only), but nothing passes it yet.
- The share line on the result screen and in the tag (Artem), and ending-grouped boards (Max).
- Optional later: compile `story-graph/1` to a native engine story node (option C) to cut the string parsing. Games
  are about 20 KB without music.
