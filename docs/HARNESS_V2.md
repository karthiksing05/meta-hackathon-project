# Harness v2: open-ended game making

Owner: Karthik (and Claude for Karthik). Branch: `harness-v2`, off `backend-api` `75d3a02` plus Artem's `typed-answers`.
Status: plan, 2026-11-12 ~20:30 PST. Where the Go code sits is confirmed with Claude (for Max) before it merges.

## The problem

Today the harness knows one fixed menu: 34 fragments, 4 looks and 16 gold games, pasted into a ~91k-character
prompt. Muse tends to force each request onto the closest item, so:

- "make krillion" became a krill-catching game, and "a krillion style trivia game" became multiple choice
  (Artem's handoff, 19:42). Muse didn't know the game, and the menu had no typed-answer piece.
- New kinds of play (a rare-answer guess, a lane runner, a tilt game) don't arrive as new rules. They arrive as a
  reskin of whatever is on the menu. Karthik's 16:30 note: the harness takes a person's style but not their function.

The fix is to make the menu effectively open: a large catalog of **game types** and **game tools** the harness
*searches*, a web lookup for whatever the catalog doesn't know, and a planner that composes from what it found.

## What we checked first (2026-11-12, real Muse API)

- Muse has **no embeddings endpoint** (`/v1/embeddings` returns 404 for every model name tried) and **no built-in web
  search** (`tools: [{type: web_search}]` returns 400). Models: muse-wonder-1.0, muse-ember-1.0, muse-spark-1.1/1.2/1.3,
  muse-image-1.0, sam-3.1, muse-voice-transcribe-1.0.
- So semantic search and web lookup run on **our server**, with Muse as the reasoning step, not the index.
- The Go API (`backend/`) already runs shared JS inside Go with goja (`internal/recs`). The generator that calls Muse
  is Node today (`backend/generator`, running `MicrogameStudio.compose` from the shared Studio bundle).

## Shape

```
request ──► 1 understand ──► 2 retrieve ──► (3 look up, only if needed) ──► 4 plan ──► 5 compose ──► 6 check
            Muse Spark,       Go, catalog     Go: Wikipedia + the named       Muse Wonder:   existing     gate with
            JSON: refs,       in Mongo:        site's own page; Muse          anatomy +      pipeline,    the type's
            verbs, inputs,    BM25F +          Spark turns it into a          design that    prompt now   gate profile
            family, theme     trigram +        catalog entry (cached,         cites type     holds only   + quality
                              tag overlap,     marked "learned")              and tool ids   what was     + polish
                              fused (RRF)                                                    retrieved
```

Steps 1–4 are new and live in Go (`backend/internal/harness/`). Steps 5–6 are today's pipeline. They take a smaller,
targeted context pack instead of the whole menu, which also makes the prompt shorter and faster.

### 1. Understand the request (Muse Spark, about 1–2 s)

One JSON call turns free text into fields the index can match. It uses the catalog's own controlled vocabulary
(families, verbs, inputs), so this is where "semantic" comes from without embeddings:

```json
{"named_refs": ["Krillion"], "verbs": ["type", "guess"], "inputs": ["type"], "families": ["trivia", "word"],
 "theme": ["Harry Potter"], "keywords": ["rare answer", "obscure", "daily"], "players": "solo",
 "unknown_refs": ["Krillion"]}
```

`unknown_refs` is Muse saying "I don't know this name". It is one of the triggers for step 3.

### 2. Retrieve (Go, in-process, < 20 ms)

- **Index:** every `game_types` and `game_tools` document, built into an in-memory index at start-up and on change.
  A few thousand documents fit easily.
- **Scorers**, fused with reciprocal-rank fusion:
  - BM25F over fields: name and aliases ×3, example prompts ×2, summary, verbs, tags;
  - character trigrams on names and aliases, so "krilion" and "wordel" still hit;
  - exact overlap with the understood `verbs`, `inputs` and `families`.
- **Output:** the top 6 types, every tool those types need, and the top 6 tools matched directly. Each comes with a
  score and the reason it matched.
- **Interface:** an `Embedder` interface is left in place. If we later add vectors (a small local model, or Muse adds
  embeddings), they become a fourth scorer in the same fusion, with no other change.
- **Eval:** `backend/internal/harness/testdata/retrieval_eval.json` holds 300+ requests with expected type ids, and the
  Go test reports recall@5 and MRR. The target is recall@5 ≥ 0.9 before the planner uses it.

### 3. Look it up (Go, only when needed, budget 8 s)

Triggers: an `unknown_refs` name with no alias hit, or a top fused score below the threshold.

- **Sources** (no new keys): the Wikipedia search and summary REST APIs, plus a direct fetch of a named site's home
  page when the name looks like a domain or a product, with the text extracted.
- **No search API and no new key** (Max, 20:55).
- **Fetcher rules** (Max):
  - http(s) only;
  - refuse private, loopback and link-local addresses, checked after DNS resolution and on every redirect;
  - a few seconds and about 1 MB per page;
  - no cookies, and never the Muse key;
  - page text is data, never instructions.
- Muse Spark turns what came back into a **candidate `game_types` entry**. It records the mechanic only, never copied
  prompts, art or levels, and cites its source URLs.
  - The entry is used for this job right away.
  - It is saved with `status: "learned"`, so the next person who asks for the same game gets an instant catalog hit.
  - A learned entry is promoted to `reviewed` only after an eval pass or a teammate checks it.
- **On failure:** if the lookup fails or runs out of time, the job continues with step 2's results. The Studio step
  text says so honestly.

### 4. Plan (Muse Wonder)

The planner gets the request and compact cards for the retrieved types and tools, about 300–600 characters each, not
whole manifests. It writes the existing `game-anatomy/0.1` and the design block, plus:

- `type_ids`: which types it is using, and how it blends them ("rare-answer scoring from `rare_answer_trivia`, the
  timer from `speed_round`");
- `tool_ids`: the building blocks each rule uses;
- `gaps`: tools with status `planned` or `gap` that the idea needs. Each gap gets the approximation it will use
  instead (the existing familiarity field: `known`, `approximate` or `new to Muse`).

### Clarification checklists

Each family has a checklist of what must be settled before a game of that kind can be made
(`authoring/catalog/checklists/<family>.json`, format in `authoring/catalog/README.md`). A type can have its own
checklist, which replaces the family default. Retrieval sends the checklist of each retrieved type with its card.

The planner works through the slots:

- **Fill from the request.** It fills each slot from the request and the context (`extrapolate_from`), and says
  what it guessed.
- **Default.** A slot nothing speaks to takes its `default`.
- **Ask.** It asks only when `ask_when` holds for a `required` slot, using the slot's `ask` and `choices`.
  **At most 2 questions per game.** Everything else is a visible guess the person can change.

The results go into the anatomy (`game-anatomy/0.1`, docs/BUBBLES.md 7.13):

- a slot read from the request is `source: you`;
- a guessed or defaulted slot is `source: guess`;
- an asked slot carries `question` and `options` from the slot.

The values then steer content, rules, art, difficulty and social settings, as each slot's `affects` lists.

### The game spec: every part named, decided and checked (Karthik, 21:45)

Muse does best when it never has to invent the structure of a game, only fill it in. So the planner's output is a
**`game-spec/1`**: a fixed set of parts, each with its own small schema, its own guidance, and its own check.
Compose builds from the spec, not from the request. The anatomy (7.13) stays the person-facing view of the same
parts.

| Part | What it pins down | Checked by |
|---|---|---|
| `theme` | the world, named things (real franchise names when asked), tone, the look family | the words players see contain the theme terms (quality.mjs) |
| `goal` | one sentence on what the player is trying to do, and the *measurable* target ("clear 20 orders", "survive", "find the rarest answer") | it is measurable, and `score` measures it |
| `loop` | the core action loop: the verb, what the player sees, the input, the feedback, and how long one cycle takes | a bot can complete one cycle; the input is in the tool list |
| `pieces` | the entities and content: roles, how many, where content comes from (answer bank, word list, levels) | every piece a rule names exists; content is big enough for the length |
| `constraints` | limits and pressure: time, lives, moves, accuracy, rate | each one is enforced by a rule and can be seen in the HUD |
| `progression` | the difficulty arc: what ramps and when (3 steps), plus `difficulty_levers` | bot scores rise with skill; the ramp is visible |
| `end` | win, lose, and how a run ends (time out, lives gone, target reached, all prompts done) | every run ends within `session_seconds` |
| `score` | the score model below | the score check below |
| `social` | group play: how friends play it together (same seed, each on their own turn, compared after), what a result is (score, ending, picks) and how results compare (score, ending, agreement), the round length and the line posted back to the thread | same seed always; an agreement result is unranked; an ending result names its endings and the share line spoils none; the round fits the run; see "Group play" below |
| `feel` | the juice moments, sound set and the look (Bayan's style kit takes over from here) | Bayan's art checks |

- **The planner fills the parts in order.** Theme, goal, loop and pieces come first; then constraints, progression
  and end; score last, because the score has to measure the goal under the constraints. Each part sees the earlier
  ones.
- **Per-part guidance:** the catalog types carry part-level hints. Kevin's game survey (`docs/research/`) becomes
  per-family guidance on each part ("what goes wrong when it's made badly").
- **Repairs are per part.** A failed check names its part, and the repair prompt sends Muse only that part plus the
  parts it depends on, not the whole game. Faster and less drift.

### Scores you can rank

Today every leaderboard keeps the highest score and sorts highest first (`$max`, descending, in
`internal/store`). Max's work splits boards by *scope* (everyone, friends, Group, Event, weekly). But a time trial
("make 20 sandwiches as fast as you can") ranks the slowest player first. So `score` is a model, not one number:

```json
"score": {
  "kind": "points | time_to_complete | count_in_time | survival_time | accuracy | distance | tiered_points | streak",
  "measures": "orders completed before the timer ends",
  "unit": "orders",
  "direction": "higher | lower",
  "counts_when": "finished | any",
  "aggregate": "best | latest | sum_week",
  "tie_break": "less time | earlier",
  "format": "{n} orders | m:ss.t | {n}%",
  "bounds": { "min": 0, "max": 60, "max_rate_per_s": 2 },
  "events": ["order_done"]
}
```

| Kind | What ranks | Direction | Counts when |
|---|---|---|---|
| `points` | points | higher | any |
| `time_to_complete` | ms to finish | lower | finished only |
| `count_in_time` | how many in N s | higher | any |
| `survival_time` | ms alive | higher | any |
| `accuracy` | whole percent correct (0–100) | higher | finished only |
| `tiered_points` | rarity-tier points (Krillion) | higher | any |
| `streak` | best run of correct | higher | any |

Notes on the fields (contract agreed with Max, 2026-11-12):
- **Where it lives:** a top-level `score` in the published `manifest.json`, next to `formula` and `brief`
  (`wrap.mjs` puts it there). Never in `game.json`: the engine's game file is strict. No block means
  points, higher, best, every run counts.
- **Units: every score is an integer.** `time_to_complete` and `survival_time` are whole milliseconds (the
  engine's `time_ms` for the run); `accuracy` is a whole percent, 0–100; the others are counts or points.
  `bounds` use the same units. `format` time patterns (`m:ss.t`, `m:ss`, `s.t`) read milliseconds.
- `tie_break` is `less time` or `earlier`. `aggregate` is `best`, `latest` or `sum_week` (Max does
  `sum_week` later).
- **Replays:** the server requires the replay log for games with a score block and reads `phase` and
  `time_ms` from the engine replay, so a finished run is one that replays to `won`. The score check
  replays every bot run and fails a game whose replay doesn't give the reported phase, time and score.
- `counts_when: finished` means a run that times out doesn't go on the board. Without it, a time trial would reward
  quitting early.
- `bounds` come from the bots, not from Muse. The gate records the range the bots actually reached, plus headroom.
  The server then rejects impossible scores even before replay verification.
- `format` is how the app and share text show the score, so "1:23.4" is never shown as "83400".

### Score verification (a step of its own, after the gate)

Muse states its score reasoning. A separate check, half code and half Muse, makes sure the score is fair, rankable
and measures the goal.

**1. Muse review** (muse-wonder-1.0, high effort; the one place we spend thinking). It receives the goal,
constraints, end and score parts plus the bot runs, and answers:
- does the score measure the goal, or something easier to farm?
- is the direction right?
- can a player raise it without playing well (idling, spamming one input, quitting early)?
- are ties likely, and does the tie-break resolve them?
- does the `format` read naturally?

It returns `{ok, issues: [{part, problem, fix}]}`.

**2. Code checks from the bots**, deterministic and run in the gate:
- **Skill order:** pro beats regular beats new player, in the score's direction.
- **The idle bot scores worst.**
- **No farming:** a spam bot that repeats one input doesn't beat the regular bot, and no bot exceeds
  `max_rate_per_s`.
- **Finish rule:** `finished`-only kinds have at least one finished bot run, and unfinished runs are excluded.
- **Score is replay-verifiable:** the score re-derived from the replay log equals the reported score
  (`MicrogameEngine.verify`).
- **Score events:** the score changes only on the `events` listed.

**3. A failed check repairs only the `score` part**, plus `goal` if the review says the goal itself isn't
measurable. At most one round. If it still fails, the game ships with an honest "unranked" board.

**Built (2026-11-12):** `authoring/expander/score.mjs` (model), `authoring/playtest/score-check.mjs` (code
checks), `authoring/expander/score-step.mjs` (review, one repair, unranked fallback), on by default for
games with a score block. Measured on real Muse (muse-wonder-1.0): a review at high effort is about 1,000
prompt tokens and 1,500–6,600 completion tokens (almost all reasoning), 15–75 s; a score repair at medium
effort about 500–650 prompt and 2,000–2,900 completion tokens, 21–27 s.

**Server side (Max):** the game record stores `score` (direction, aggregate, counts_when, format, bounds). Boards
sort and aggregate by it (`$min` for `lower`), reject out-of-bounds or unfinished runs as the model says, and send
`format` to the app.

### Group play (Karthik, 2026-11-12; docs/harness-gaps/group-play.md)

There is no live multiplayer. Every game is a single-player run that people play on the **same seed**, each on their
own turn, in a chat thread or a Group, and the results are compared after: head-to-head (`same_seed_async`), a best
of 3 or 5 (`series`), everyone in the chat or Group ranked (`group_round`), the Group's week (`weekly_board`), or,
for games with no right answer, how closely people agree (`opinion_compare`).

- **The result** (`social.result`): `score` compares by the score model; `ending` (story games) by the ending's place
  in `endings`, then the score; `picks` + `agreement` (ratings, tier lists, this-or-that) by the share of picks that
  match a friend's or the group's, with `score.ranked: false`; `creation` + `none` side by side. `state` names the game
  state that holds the result at the end, so the server can read it from the replay.
- **Defaults** (Go, `social.go`): series for skill families, a Group round for quiz, word, daily and party families,
  head-to-head otherwise; an opinion request ("rate", "tier list", "favourite", "vs everyone") or a consensus type
  compares agreement; story games compare the ending. Muse moves off the default only with `social.reason`.
- **Checks:** `same_seed` is always true; `round_seconds` (30–90 s) fits inside `end.session_seconds`, and a run that
  can't end within 180 s is flagged; `share_line` is one line with `{result}`, never naming an answer or an ending.
- **Compose** (`group-play.mjs`): every random draw comes from the run seed, nothing from the device, clock, locale or
  name; one clear result line; the manifest gets `group_play` next to `score`.
- **Request checks** (need the request, run after the spec checks): a goal that copies a schema example, a capped
  goal ("in 10 choices or less") scored per use, and an opinion request scored like a quiz are problems for the
  repair round. Request words that name an unbuilt tool's alias get a gap entry, never dropped silently.

### 5–6. Compose and check (today's pipeline, with a smaller prompt)

- `prompts.system` takes the plan's types and tools in place of the full fragment catalog. Gold examples are still
  picked, but by type id first and by words second.
- **The gate profile** comes from the type (`gate_profile`), with these values:

  | Profile | What the gate checks |
  |---|---|
  | `arcade` | today's checks |
  | `puzzle` | solvable and not trivial |
  | `calm` | no-fail is allowed |
  | `trivia` | answers are reachable and scoring follows the tiers |
  | `runner` | skill shows in the scores |

  This is the genre-aware gate that blocked 4 of 11 anatomy-run games. That layer is Bayan's, in
  `authoring/playtest/`; we agree the profile names with him.

## The catalog

Two Mongo collections, seeded from JSON in the repo (`authoring/catalog/`), loaded by `cmd/dbinit`, and editable later
without a deploy.

### `game_types`: target 2,000+ at launch

```json
{
  "id": "rare_answer_trivia",
  "name": "Rare-answer trivia",
  "aliases": ["Krillion", "rarest answer", "obscure answer game", "Pointless-style"],
  "family": "trivia",
  "subfamily": "open answer",
  "summary": "A category prompt; type one correct answer; rarer correct answers score more.",
  "core_loop": "read prompt → type an answer before the timer → see its rarity tier and points → next prompt",
  "verbs": ["type", "recall", "guess"],
  "inputs": ["type"],
  "pieces": ["prompt", "answer list with rarity tiers", "timer", "score"],
  "rules": ["an answer counts if it fuzzy-matches an accepted answer", "points by tier: common 10 … rarest 100"],
  "win": "highest total after N prompts", "lose": "none; score attack",
  "scoring": "tiered points per answer",
  "session_seconds": [60, 180],
  "players": ["solo", "async_friends", "group_daily"],
  "social_hooks": ["compare rarest answers with friends", "a Group's daily set"],
  "content_needs": ["prompts", "accepted answers with tiers and aliases"],
  "difficulty_levers": ["timer length", "prompt breadth", "tier thresholds"],
  "tools": ["typed_answer", "keyboard", "fuzzy_match", "rarity_tiers", "timer_bar", "rounds", "score", "daily_seed"],
  "engine_gaps": [],
  "gate_profile": "trivia",
  "example_prompts": ["a harry potter krillion", "trivia where obscure answers win", "name the rarest pokemon"],
  "status": "reviewed",
  "source": "seed",
  "refs": ["https://krillion.io"]
}
```

### `game_tools`: target 300+ at launch

Each tool is a building block the composer can use, kind by kind:

| Kind | What it is |
|---|---|
| `fragment` | the 34 today |
| `builtin` | runtime functions |
| `runtime_tool` | a new runtime capability, such as `fuzzy_match` or text input |
| `content_tool` | a server-side content generator, such as an answer bank with tiers, a question bank with difficulty, or a level list |
| `look` | a visual style |
| `server_tool` | a step like the web lookup |

```json
{
  "id": "fuzzy_match",
  "kind": "runtime_tool",
  "summary": "Does a typed answer match an accepted one? Tolerates case, accents, plurals, typos and word order, and knows aliases.",
  "when_to_use": "any typed or open answer: trivia, naming, spelling with tolerance",
  "api": "fuzzy.match(input, accepted[], {threshold}) -> {ok, best, score, tier}",
  "events": [], "params": {"threshold": "0..1, default 0.82"},
  "status": "building",
  "gaps_it_closes": [],
  "example_types": ["rare_answer_trivia", "name_all_x", "guess_the_character"]
}
```

`status` is one of `shipped`, `building`, `planned` or `gap`. The planner can see a `gap` tool and plan around it
honestly, so the catalog doubles as the engine roadmap.

### How 2,000 types get written (brute force, with checks)

1. **Families first.** We use about 40 families: the game-taxonomy canvas (`F0CGYLR71CN`) plus app-store, board-game
   and party-game genres. Each family gets a packet: its definition, 3 reviewed example entries, and the schema.
2. **Fan-out.**
   - Claude (for Kevin) and our subagents each take families and write about 50 entries per family. Each entry is a
     distinct mechanic, with the well-known games that use it as `aliases`.
   - The aliases are what make "make krillion" or "like Subway Surfers" match. The entries describe mechanics; the
     names are only for matching.
3. **Checks** (`node authoring/catalog/check.mjs`):
   - schema validation;
   - every tool id exists;
   - near-duplicate detection (trigram Jaccard on name, summary and core loop);
   - at least 3 example prompts each;
   - no copied text from any source.
4. **Retrieval eval.** Each packet also adds 5 natural requests with expected type ids to the eval set, so coverage and
   retrieval are measured together.

### Families and who writes them (about 50 types each)

File layout: one file per family, `authoring/catalog/types/<family>.json`, holding a JSON array of `game_types`
entries. One writer per file, so nobody conflicts.

| Writer | Families |
|---|---|
| **Claude for Kevin** (28) | `word`, `trivia`, `knowledge_quiz`, `logic_puzzle`, `number_math`, `spatial_puzzle`, `tile_matching`, `deduction`, `memory`, `reaction`, `rhythm_music`, `runner`, `platformer`, `arcade_shooter`, `dodge_survive`, `sports`, `racing`, `physics_toy`, `stack_balance`, `aim_throw`, `catch_collect`, `idle_incremental`, `management_sim`, `cooking_crafting`, `nurture_pet`, `card`, `board`, `dice_luck` |
| **Claude for Karthik** (14) | `story_choice`, `mystery_narrative`, `adventure_rpg`, `strategy_tactics`, `tower_defense`, `duel_battle`, `party_social`, `guess_your_friends`, `drawing_creative`, `music_making`, `daily_puzzle`, `learning`, `calm_cozy`, `horror_tension` |

Tools go in `authoring/catalog/tools/*.json`, written by Claude for Karthik. Any tool id a type needs that doesn't exist
yet goes in that type's `tools` as written, and the checker lists it as *missing*. Those are the next tools to define.
Use existing fragment ids where they fit (`ls authoring/fragments`).

## Runtime tools to build now

- **`fuzzy_match`** in the game runtime, so it runs on the phone and in the bots alike. It does these, in order:
  1. normalizes the input: case, accents, punctuation and articles;
  2. checks aliases;
  3. takes a Damerau-Levenshtein ratio;
  4. takes a token-set ratio, so word order doesn't matter;
  5. folds plurals and simple stems;
  6. optionally checks a phonetic key.

  It is deterministic and needs no LLM, which keeps replays verifiable. "Near-semantic" comes from the answer bank,
  which carries `aliases` and `also_accept` lists written by Muse at build time.
- **`typed_answer`** (Artem, merged here) switches to `fuzzy_match`, with tiers from the answer bank.
- **A native text field** in the runtime, `bubble-kit-microgame.js`, so typing has spaces, numbers and autocorrect, and
  replays record the text.

## Measure every change

- **Retrieval:** recall@5 and MRR on the eval set (Go test).
- **Generation:** `tools/harness-eval` `compare.mjs` before and after on the 12 starter requests, plus Kevin's and
  Artem's ground truth.
  - Two new requests are added: "make krillion" and "a harry potter krillion".
  - The baseline is Artem's 3b4536a numbers: first draft valid 83%, gate pass 75%, must-haves 96%.

## Who does what

| Work | Who |
|---|---|
| Plan, catalog schema and checks, seed entries from fragments and gold, retrieval in Go, web lookup in Go, planner wiring, fuzzy match | Claude for Karthik (subagents) |
| Bulk catalog entries by family | Claude for Kevin (with our subagents) |
| The generator's `POST /internal/muse/json` route and the `context` input to `compose` | Claude for Max |
| Genre gate profiles; visuals (style kit, art direction) | Codex for Bayan: we agree the profile names and leave visuals to him |
| Engine gaps the catalog surfaces (tilt, share grid) | Artem, once he's back on engine work |

## Decided with Max (2026-11-12, 20:55)

1. **Steps 1–4 run in Go.** Go owns understand, retrieve, lookup and plan, in `backend/internal/harness/`: new files
   plus one route hook. The generator keeps Muse's compose loop and the engine, and takes `context` in place of the
   full menu. The engine stays separate from the Muse side.
2. **Catalog collections.** `game_types` and `game_tools` live in Mongo:
   - indexes go in `internal/store/indexes.go`;
   - `cmd/dbinit` seeds them from `authoring/catalog/`;
   - seeding is idempotent, because `dbinit` runs on every deploy;
   - learned entries are never overwritten by the seed.
3. **Go calls Muse through the generator.** The route is
   `POST /internal/muse/json {model, system, user, maxTokens?, effort?, timeoutSeconds?} -> {content, model}`, on the
   private network. The API never reads the key. The steps call it with:

   | Step | Model | `maxTokens` | `timeoutSeconds` | `effort` |
   |---|---|---|---|---|
   | understand | `muse-spark-1.3` | 4000 | 25 | `minimal` |
   | plan | `muse-wonder-1.0` | 12000 | 90 | `low` |
   | lookup summary | `muse-spark-1.3` | 4000 | 25 | `minimal` |

   All three ask for one JSON object. `effort` is `minimal`, `low`, `medium` or `high`. Measured 2026-11-12:
   spark-1.3 at `low` takes 7–18 s even on a one-line prompt, and at `minimal` about 5–12 s.

   Errors:
   - 400: bad input;
   - 429: busy, retried once after 2 s;
   - 502: `muse_failed`;
   - 503: `muse_not_configured`; understanding then falls back to keywords.
4. **Web lookup.** Wikipedia plus a page the person named, with the fetcher rules in step 3 above. There is no search
   key.
5. **Merging.** `harness-v2` stays ours. Max merges nothing from it into `backend-api` until we say it's ready and the
   tests pass. Branch base: `Prod` `47c2867`, merged into `harness-v2`.

## The `context` the generator receives

The job gains an optional `context`. With it, `compose` builds the menu section of the system prompt from:
- `context.tools`: the generator expands fragment ids to their full fragment specs from `authoring/fragments/`;
- `context.types`, as "what this game is".

It does this instead of pasting the whole catalog. Gold examples are picked by `gold_ids` first. Without `context`,
nothing changes.

**Built in the Studio bundle (API version 3, 2026-11-12).** `MicrogameStudio.compose({request, brief, base?, context})`
passes `context` to `prompts.system`: with `tools` or `types`, the "Fragments" section holds only the planned
fragments' full specs (other tools listed with their summary and API, the rest of the library named in one
line), followed by "What this game is" (the types) and "The spec to follow" (`plan.spec`, `plan.anatomy`,
`plan.gaps`, and an instruction to copy `spec.score` into the manifest's `score`). Gold examples come from
`gold_ids` first, then by words. `gate_profile` goes to the gate's options. A manifest without a score block
adopts `plan.spec.score` (events the game lacks are dropped) for the score check. Measured on three sample
contexts built from the catalog (same gold examples, so the difference is the menu): 136,944 characters before;
114,465 (trivia, 9 tools), 108,068 (dodge, 7) and 105,608 (puzzle, 4) after. The fragment menu goes from
36,581 to 3,700–12,500 characters; the gold examples (about 90,000) are now the bulk.
The generator should pass `context` into `studio.compose` and stop appending its own "Planned for this
request" section when `MicrogameStudio.version >= 3`, or the types and plan go in twice.

```json
{
  "context": {
    "version": "harness-context/1",
    "understanding": {"named_refs": ["Krillion"], "verbs": ["type", "recall"], "inputs": ["type"],
                      "families": ["trivia"], "theme": ["Harry Potter"], "keywords": ["rare answer"], "players": "solo"},
    "types": [
      {"id": "rare_answer_trivia", "name": "Rare-answer trivia", "family": "trivia", "summary": "…", "core_loop": "…",
       "rules": ["…"], "win": "…", "lose": "…", "scoring": "…", "pieces": ["…"], "content_needs": ["…"],
       "difficulty_levers": ["…"], "tools": ["typed_answer", "fuzzy_match"], "gate_profile": "trivia",
       "status": "reviewed", "source": "seed", "refs": [], "match": {"score": 0.91, "reasons": ["alias: Krillion"]}}
    ],
    "tools": [
      {"id": "typed_answer", "kind": "fragment", "status": "shipped", "summary": "…", "when_to_use": "…",
       "api": "…", "params": {}, "events": []}
    ],
    "plan": {
      "anatomy": {"anatomy": "game-anatomy/0.1", "title": "…", "genre": "word", "parts": {"…": "…"}},
      "spec": {
        "spec": "game-spec/1",
        "theme": {"world": "…", "named": ["Harry Potter"], "tone": "…", "look": "…", "terms": ["…"]},
        "goal": {"text": "…", "target": "find the rarest answer in each of 5 prompts", "measure": "rarity points"},
        "loop": {"verb": "type", "sees": "…", "input": "type", "feedback": "…", "cycle_seconds": 12},
        "pieces": {"items": [{"name": "prompt", "role": "…", "count": "5", "content": "answer bank with tiers"}]},
        "constraints": {"items": [{"kind": "time", "value": "10 s", "enforced_by": "…", "hud": "timer bar"}]},
        "progression": {"steps": [{"at": "prompt 1", "change": "…"}, {"at": "…", "change": "…"}, {"at": "…", "change": "…"}], "levers": ["…"]},
        "end": {"win": "…", "lose": "", "ends_when": ["all_prompts_done"], "session_seconds": [60, 120]},
        "score": {"kind": "tiered_points", "measures": "rarity points per answer", "unit": "points", "direction": "higher",
                  "counts_when": "any", "aggregate": "best", "tie_break": "less time", "format": "{n} points", "events": ["answer_scored"]},
        "social": {"mode": "group_round", "modes": ["same_seed_async", "series", "group_round", "weekly_board"], "round_seconds": 90,
                   "result": {"kind": "score", "compare": "score", "display": "{score}"}, "share_line": "{name}: {result} on {title}. Your turn.",
                   "board": "…", "same_seed": true},
        "feel": {"juice": ["…"], "sounds": "…", "look": "…"}
      },
      "design": {"pitch": "…", "theme": ["…"], "verb": "…", "twist": "…", "arc": ["…"]},
      "type_ids": ["rare_answer_trivia"],
      "blend": "rare-answer scoring from rare_answer_trivia",
      "tool_ids": ["typed_answer", "keyboard", "fuzzy_match", "rarity_tiers", "timer_bar"],
      "gaps": [{"tool": "rarity_tiers", "status": "planned", "approximation": "tiers written into content as answer lists", "familiarity": "approximate"}],
      "clarify": [{"slot": "theme", "value": "Harry Potter", "guessed": false},
                  {"slot": "audience", "value": "friends", "guessed": true, "question": "Who plays?", "choices": ["friends", "anyone"]}],
      "spec_issues": [],
      "notes": ["…what Go corrected…"]
    },
    "gold_ids": ["gold_who_posted"],
    "gate_profile": "trivia",
    "learned": [],
    "notes": ["lookup skipped: catalog alias hit"]
  }
}
```

Limits: at most 6 types and 24 tools. The `context` is at most 48 KB of JSON, and Go trims long fields before
sending.

**How the spec is checked.** The spec's parts and validator are in `backend/internal/harness/spec.go`:
- **Each part:** required fields and enums; the goal must be measurable, and `score.measures` must use the goal's
  measure words.
- **Fixed by Go:**
  - `score.direction` and `counts_when` follow the kind's row in the table;
  - every score is an integer: the ms kinds have unit `ms` and format `m:ss.t`, and accuracy is a whole `%`;
  - `tie_break` is `less time` or `earlier`;
  - `bounds` is always cleared, because the gate sets it from the bots.
- **Score default:** the kind comes from the type's `scoring` text, else its family. Muse may override it only with
  a `reason`; otherwise Go puts the default back.
- **Repair:** parts that still fail get one repair round. Anything left goes in `spec_issues`.
- **Clarify:** slots borrowed from a type the plan didn't choose are defaults only, never questions; the planner never
  asks who plays (the send sheet picks the chat or Group) or a theme for unthemed content.
- **Which understander ran** is in the context's notes, `understanding.by` and `timings.understood_by` (`muse`, `given`,
  or `keywords (muse failed: …)`).

**On by default since 2026-11-12 (Karthik). `HARNESS_CONTEXT=0` or `off` is the kill switch:**
- the API runs steps 1–4 for each new game (100 s budget) and sets `Job.Context`; any failure sends no context;
- `POST /v1/harness/plan {request}` returns `{plan, clarify, spec, types, timings}`, so the app can ask the 0–2
  questions before the build.

## Open questions

- **Bayan:** which gate profile names do you already have?
