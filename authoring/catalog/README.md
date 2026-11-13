# Game catalog

The searchable menu for harness v2 (`docs/HARNESS_V2.md`): **game types** (mechanics the harness retrieves and plans
from) and **game tools** (building blocks the composer can use). The JSON here seeds the Mongo collections
`game_types` and `game_tools`. Entries describe mechanics. Real game names go only in `aliases` and `refs`, for
matching; never copy another game's prompts, levels, art or text.

## Layout

```
authoring/catalog/
  schema/game_type.schema.json   the game_type contract (JSON Schema)
  schema/game_tool.schema.json   the game_tool contract
  schema/eval.schema.json        one retrieval eval case
  types/<family>.json            JSON array of game_type, every entry's family == <family>; one writer per file
  types/seed_*.json, learned_*.json   mixed-family files (seed_gold.json: one type per gold game)
  tools/*.json                   JSON array of game_tool:
                                   fragments.json  one per authoring/fragments/*.fragment.json (kind fragment)
                                   builtins.json   expression builtins from engine/crates/mg-core/src/builtins.rs
                                   engine.json     engine features rules can use (physics, camera, timers, input sources)
                                   looks.json      the look presets in authoring/looks/
                                   server.json     backend features games plug into (leaderboard, challenges, Groups)
                                   planned.json    tools being built or planned, and engine gaps (status gap)
  eval/<family>.json             JSON array of eval cases for that family's types (seed_gold.json for gold)
  sample/                        a tiny valid catalog to copy from (not loaded)
  check.mjs                      the checker
```

Every file is a JSON array. Ids are unique across **all** files, types and tools together.

## `game_type`

Required unless marked optional.

| Field | Type | Notes |
|---|---|---|
| `id` | string | snake_case (`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`), ≤ 64 chars, unique across the catalog |
| `name` | string | 2–80 chars, a plain mechanic name ("Rare-answer trivia") |
| `aliases` | string[] | may be empty; real game names and common phrasings that should hit this type ("Krillion", "Pointless-style") |
| `family` | enum | one of the 42 families below |
| `subfamily` | string | optional, free text ("open answer") |
| `summary` | string | 20–400 chars, what the player does and why it's fun |
| `core_loop` | string | 10–400 chars, the loop with arrows ("read prompt → type an answer → see tier → next") |
| `verbs` | string[] | ≥ 1, lowercase words ("type", "recall", "guess") |
| `inputs` | enum[] | ≥ 1, from the inputs list below |
| `pieces` | string[] | optional, things on screen or in play |
| `rules` | string[] | ≥ 1, the rules that make this mechanic distinct |
| `win` | string | how a run is won (or "none; score attack") |
| `lose` | string | optional, how a run is lost |
| `scoring` | string | how points work |
| `session_seconds` | [int, int] | optional, [min, max] seconds per run, each 5–3600, min ≤ max |
| `players` | enum[] | ≥ 1, from the players list below |
| `social_hooks` | string[] | optional, how it brings specific people together on Facebook |
| `content_needs` | string[] | optional, content the server must generate (prompts, answer banks, levels) |
| `difficulty_levers` | string[] | optional |
| `tools` | string[] | ≥ 1, game_tool ids. Ids not defined yet are allowed and reported as **missing tools** (warning) |
| `engine_gaps` | string[] | optional, tool ids with status `gap` this mechanic needs; unknown ids are reported as missing too |
| `gate_profile` | enum | `arcade`, `puzzle`, `calm`, `trivia`, `runner` |
| `example_prompts` | string[] | ≥ 3, natural requests a person would type (franchise themes fine) |
| `status` | enum | `seed`, `reviewed`, `learned` |
| `source` | string | who or what wrote it: `seed`, `gold`, `family_packet`, `lookup`, … |
| `refs` | string[] | optional, source URLs |
| `variant_of` | string | optional, the id of a type this is a deliberate variant of (same family): turns a ≥ 0.8 duplicate error into a warning |
| `notes` | string | optional, for reviewers |

No other fields are allowed.

## `game_tool`

| Field | Type | Notes |
|---|---|---|
| `id` | string | snake_case, unique across the catalog. Fragment tools use the fragment id |
| `kind` | enum | `fragment`, `builtin`, `runtime_tool`, `content_tool`, `look`, `server_tool` |
| `name` | string | optional, display name |
| `aliases` | string[] | optional, other words for it |
| `summary` | string | 10–600 chars, what it does |
| `when_to_use` | string | 5–600 chars |
| `api` | string | optional, how a game calls or wires it (signature, required functions, state it exposes) |
| `events` | string[] | optional, events it emits |
| `params` | object of string | optional, param name → "type, default, range" |
| `status` | enum | `shipped`, `building`, `planned`, `gap` |
| `gaps_it_closes` | string[] | optional, gap ids or plain descriptions this tool removes |
| `example_types` | string[] | optional, game_type ids that use it (may name types not written yet) |
| `path` | string | optional, the file that implements it (`authoring/fragments/x.fragment.json`) |
| `refs` | string[] | optional |
| `notes` | string | optional |

## Eval case (`eval/*.json`)

`{"request": string (3–300 chars), "expect": [type id, …] (≥ 1, each must exist), "notes"?: string}`. `expect` lists
the types a good retrieval returns in its top 5. Each family packet adds about 5.

## Enums

- **family** (42): `word`, `trivia`, `knowledge_quiz`, `logic_puzzle`, `number_math`, `spatial_puzzle`,
  `tile_matching`, `deduction`, `memory`, `reaction`, `rhythm_music`, `runner`, `platformer`, `arcade_shooter`,
  `dodge_survive`, `sports`, `racing`, `physics_toy`, `stack_balance`, `aim_throw`, `catch_collect`,
  `idle_incremental`, `management_sim`, `cooking_crafting`, `nurture_pet`, `card`, `board`, `dice_luck`,
  `story_choice`, `mystery_narrative`, `adventure_rpg`, `strategy_tactics`, `tower_defense`, `duel_battle`,
  `party_social`, `guess_your_friends`, `drawing_creative`, `music_making`, `daily_puzzle`, `learning`, `calm_cozy`,
  `horror_tension`
- **inputs**: `tap`, `drag`, `swipe`, `hold`, `type`, `tilt`, `draw`, `voice`, `multi_touch`
- **players**: `solo`, `pass_and_play`, `async_friends`, `group_daily`, `live`
- **gate_profile**: `arcade`, `puzzle`, `calm`, `trivia`, `runner`
- **type status**: `seed`, `reviewed`, `learned`
- **tool status**: `shipped`, `building`, `planned`, `gap`
- **tool kind**: `fragment`, `builtin`, `runtime_tool`, `content_tool`, `look`, `server_tool`

The schemas in `schema/` are the source of truth; if this page and a schema disagree, the schema wins.

## Running the check

```sh
node authoring/catalog/check.mjs                  # whole catalog
node authoring/catalog/check.mjs --family trivia  # only that family's types, evals and duplicate pairs
node authoring/catalog/check.mjs --json           # machine-readable report
node authoring/catalog/check.mjs --root authoring/catalog/sample   # check another folder
```

Node 18+, no npm packages. Exit 1 on any error.

**Errors:** invalid JSON or not an array; a schema violation (missing field, wrong type, bad enum, unknown field,
fewer than 3 example prompts); an id that isn't snake_case or is used twice anywhere; an entry in
`types/<family>.json` with another family; an eval `expect` id that isn't a type; a type id used in `tools`; a
`variant_of` that doesn't resolve; near-duplicates at trigram Jaccard ≥ 0.8 (unless same family and one is
`variant_of` the other).

**Warnings:** tool ids in `tools`/`engine_gaps` not defined yet (one line per missing tool, ranked by how many types
want it); near-duplicates at ≥ 0.6; a repeated example prompt; a types file that isn't a family name, `seed_*` or
`learned_*`.

Near-duplicates use character trigrams of `name + summary + core_loop` (lowercased, accents and punctuation removed).

**Summary line:** types per family, total types, tools by status, missing tools ranked by demand, eval cases,
duplicate pairs, error and warning counts.
