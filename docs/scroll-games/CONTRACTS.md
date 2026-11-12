# Scroll Games — implementation contracts

Source of truth for the three parallel workstreams. If you change a contract, update this file.

Decisions taken for the open questions (orchestrator calls):
- **Engine**: no Bevy/Macroquad. A small pure-Rust core (`sg_runtime`) holds all game logic; the JS player only renders a JSON *view model* the runtime produces. Smallest wasm, fastest build, the event/registry model is ours anyway.
- **Glue language**: Rhai (pure Rust, compiles to wasm with no C toolchain). Wonder writes glue (it plans the manifest, glue is part of the plan).
- **iOS shell**: native SwiftUI tab hosting the wasm game in a `WKWebView`.
- **Test game**: "Trip Trivia" — a timed photo quiz built from a synthetic group's photos (Ember writes questions from captions), with one glue mechanic ("final round is worth double").
- **Feed order**: challenges addressed to me → my own items from the last 24h (published games, scores, challenges I sent; band `you`) → friends' new games/scores → followed creators → everything else; recency within each band.
- **Default creator level**: Remix (start from a formula). Compose and Free are accepted by the API.
- **Backend**: Go server (stdlib `net/http`, Go 1.22+ routing patterns), JSON-file storage under `scroll-games/server/data/` (gitignored), port **8787**. Validation and score replay call the native Rust CLI `sgtool` (built from the same crate) via `exec`, so the Rust core is the single source of truth.
- **Name**: feature and tab are "Games" in the tab bar, "Scroll Games" as the product name.
- Suggestions A–E are all adopted (seeded fixed-timestep runtime with server replay checks, browser-playable challenge links, brief shown/editable, mood fixed at creation, synthetic demo data + opt-in step).

## Repo layout

```
scroll-games/
  spec/            concepts.json (catalog, 179 concepts, 20 implemented), events.json, schemas (*.schema.json)
  runtime/         Rust crate sg_runtime (rlib + cdylib) + wasm-bindgen API
  player/          index.html, player.js, player.css (static, served by server at /player/)
  server/          Go module (module name `scrollgames/server`), main in cmd/server
  runtime/target/release/sgtool   native CLI used by the server
  scripts/         build-runtime.sh, e2e-test-game.mjs
FacebookClone/Features/ScrollGames/   SwiftUI screens
```
`scroll-games/player/pkg/` holds the `--target web` build. Build script: `scroll-games/scripts/build-runtime.sh` (runs wasm-pack `--target web` → player/pkg with release + wasm-opt -Oz, and `cargo build --release --bin sgtool`).

## Concept contract (`spec/concepts.json`)

Array of ~150 entries across 14 kinds: input, space, entity, behavior, rule, feedback, score, flow, content, social, share, feel, meta, accessibility.
```json
{
  "id": "score.points",            // "<kind>.<name>", unique
  "kind": "score",
  "summary": "Adds points when an answer is correct.",
  "status": "implemented",         // "implemented" | "stub"  (stub = contract only)
  "params": { "per_correct": { "type": "int", "default": 100, "min": 0, "max": 10000, "doc": "..." } },
  "consumes": ["answer.correct"],
  "emits": ["score.changed"],
  "requires": ["flow.rounds"],     // concept ids that must also be present
  "conflicts": ["score.time_attack"],
  "content": null                  // or the content item shape it needs, e.g. "question"
}
```
Param types: int, float, bool, string, enum (with `values`), color, duration_ms.
Implemented for the test game (minimum): `input.tap_choice`, `space.choice_board`, `flow.session`, `flow.rounds`, `flow.countdown_start`, `rule.round_timer`, `rule.single_answer`, `score.points`, `score.time_bonus`, `score.streak_multiplier`, `feedback.flash`, `feedback.haptic`, `feedback.confetti`, `content.question_bank`, `content.photo_prompt`, `share.score_card`, `social.beat_them`, `feel.theme`, `accessibility.large_text`, `meta.seeded_random` (deterministic shuffle of question/choice order). Every other entry is `status: "stub"`.

## Shared events (`spec/events.json`)
`session.loaded, session.countdown, session.started, session.paused, session.resumed, session.ended, tick, input.choice{index}, input.tap{x,y}, round.started{round}, round.ended{round}, answer.correct{round,ms}, answer.wrong{round,index}, timer.expired{round}, score.changed{score,delta}, streak.changed{streak}, feedback.flash{color}, feedback.haptic{style}, feedback.confetti, game.over{score}`, plus `glue.*` custom events. Event payloads are JSON objects.

Session state machine: `Loading → Ready → Countdown → Playing ⇄ Paused → Ended`.

## Manifest (`sg.manifest/1`)
```json
{
  "schema": "sg.manifest/1",
  "title": "Lisbon Trip Trivia",
  "description": "How well do you remember our trip?",
  "level": "remix",
  "template": "quiz",
  "seed_scope": "per_challenge",       // per_challenge | daily (UTC date) | per_play
  "concepts": [ { "id": "score.points", "params": { "per_correct": 100 } } ],
  "glue": [ { "id": "double_final_round", "on": ["round.started", "answer.correct"], "script": "<rhai>" } ],
  "theme": { "palette": "sunset", "mood": "playful", "emoji": "🌍" }
}
```
## Content (`sg.content/1`)
```json
{ "schema": "sg.content/1",
  "items": [ { "id": "q1", "kind": "question", "prompt": "Where was this sunset?", "media_id": "m3",
               "media_url": "https://picsum.photos/seed/sg-m3/600/400",
               "choices": ["Lisbon", "Porto", "Sintra", "Cascais"], "answer": 0, "clue": "..." } ],
  "copy": { "intro": "...", "win": "...", "lose": "..." } }
```

## Glue API (Rhai)
Each glue entry's script defines `fn on_event(ev)`; `ev` is a map `{name, data}`. Scripts may call:
`emit(name, data_map)`, `get(key)`, `set(key, value)` (game vars; reserved keys: `score`, `round`, `total_rounds`, `streak`, `multiplier`, `time_left_ms`), `rand_int(lo, hi)` (seeded), `log(msg)`.
Limits: max 50_000 operations per event dispatch, max expression depth 32, string max 1KB, array max 256, no `eval`, no module import. A script error disables that glue entry for the session and records a warning; the game keeps running.

## Native CLI `sgtool` (used by the Go server)
Reads one JSON request on stdin, writes one JSON response on stdout, exit 0 (errors are JSON `{ok:false,error}`).
- `sgtool validate` stdin `{manifest, content}` → same JSON as `validate()` below
- `sgtool replay` stdin `{manifest, content, seed, inputs}` → `{score, ticks}`
- `sgtool catalog` → concepts.json
Must run in < 20 ms for the test game.

## Runtime wasm API (wasm-bindgen, `--target web`)
```
class Session
  constructor(manifest_json: string, content_json: string, seed: number /* u32 */)  // throws on invalid
  start(): void                         // Ready -> Countdown
  step(dt_ms: number): void             // fixed 60 Hz accumulator; real time never affects results except via ticks
  input(json: string): void             // {"type":"choice","index":2} | {"type":"pause"} | {"type":"resume"}
  view(): string                        // JSON view model (below)
  drain_events(): string                // JSON array of events since last drain
  result(): string                      // JSON {score, seed, ticks, inputs:[{tick, input}], stats:{correct, wrong, best_streak}}
validate(manifest_json, content_json): string   // JSON {ok, errors:[{path,msg}], warnings:[...]}; dry-runs glue in sandbox
replay(manifest_json, content_json, seed, inputs_json): string  // JSON {score, ticks} — server score check
catalog(): string                       // concepts.json embedded at compile time
```
Inputs are recorded with the tick they were applied on, so `replay` is exact.

View model:
```json
{ "state": "playing", "title": "...", "round": 2, "total_rounds": 8, "time_left_ms": 6400, "round_time_ms": 10000,
  "countdown": null, "score": 340, "streak": 2, "multiplier": 1, "banner": "Final round — double points!",
  "prompt": "...", "media_url": "...", "choices": [{"label": "Lisbon", "state": "idle|correct|wrong|dim"}],
  "feedback": {"flash": "green", "confetti": false}, "theme": {...}, "large_text": false, "copy": {...} }
```

## Player (`/player/index.html`)
Query: `?game=<id>&seed=<u32>&challenge=<id>&embed=ios`. It fetches `/api/games/<id>` (relative origin), constructs the Session, runs a rAF loop calling `step`, renders the view model in DOM, and on `game.over`:
- in iOS (`window.webkit.messageHandlers.scrollGames` exists): `postMessage({type:"result", result, game_id, challenge_id})`; also posts `{type:"ready"}`, `{type:"haptic", style}`, `{type:"error", message}`.
- in a browser: POSTs to `/api/games/<id>/plays` itself and shows the score card with a "Get Scroll Games" link and the beat/lost line.
Native may also call `window.SG.load({manifest, content, seed})` to play an unsaved preview.

## Server HTTP API (port 8787, JSON, CORS open)
Identity: header `X-User: u_me` (default `u_me`). Synthetic users/groups/media seeded on first start.
| Method | Path | Body → Response |
|---|---|---|
| GET | /api/health | `{ok, muse:{configured}}` |
| GET | /api/me, /api/users | users `{id,name,avatar_url,is_creator,follows[],friends[]}` |
| GET | /api/media?group= | `[{id,url,caption,group_id,owner_id,taken_at}]` (synthetic, picsum seeded URLs) |
| GET | /api/groups | `[{id,name,member_ids,media_ids}]` |
| POST | /api/briefs | `{prompt, media_ids[], level, opt_in_personal_media:bool}` → `{brief, ms, cached, source:"muse"\|"fallback"}` |
| POST | /api/games/generate | `{prompt, brief, media_ids[]}` → **SSE** (`text/event-stream`): `event: stage` `{stage, status:"start"\|"done", ms}` for stages `plan, content, glue, validate, repair, save`; final `event: done` `{game}` or `event: error` `{message}`. `?stream=0` returns final JSON instead. |
| GET | /api/games/:id | `{game}` where game = `{id, title, description, creator_id, status:"draft"\|"published", manifest, content, brief, created_at, gen:{ms, stages, source, cost_usd}, stats:{plays, best}}` |
| POST | /api/games/:id/publish | → `{game, feed_item}` (moderation stub runs here: always passes, sets `moderation:"stub-pass"`) |
| GET | /api/daily | `{date, game, seed, resets_at, my_play?, my_streak, leaderboard_top:[{rank,user,user_id,score}], friends_played, my_rank_among_friends?}` (see Daily game) |
| GET | /api/feed | `[{id, type:"game"\|"score"\|"challenge"\|"daily", actor, game, play?, challenge?, text, created_at, band}]` |
| POST | /api/games/:id/plays | `{seed, inputs, score, ticks, challenge_id?, daily?, date?}` → `{play, verified, rank, beat:{user,score,won}?, daily?:{date,counted,practice,streak,rank_among_friends}}` (server re-runs `replay`; verified = scores match) |
| GET | /api/games/:id/leaderboard | top plays |
| POST | /api/challenges | `{game_id, play_id, to_user_ids?}` → `{challenge, url:"http://<host>:8787/c/<id>", text:"Bayan scored 840 on Lisbon Trip Trivia. Beat them?"}` |
| GET | /api/challenges/:id | `{challenge, game}` |
| GET | /c/:id | 302 → `/player/index.html?game=..&seed=..&challenge=..` |
| GET | /api/usage | `{spent_usd, cap_usd: 15, calls:[...], by_model}` |
| GET | /player/* | static player |

## Generation pipeline & latency budget
1. **Brief** (Ember, `reasoning_effort: minimal`, ~1.2 s). Shape = `spec/brief.schema.json` (below). Shown to creator, editable. Cached by hash(prompt, media_ids, level). As soon as a brief is returned the server **speculatively starts generation** for it, keyed by hash(normalized brief, media ids); `generate` with the same (unedited) brief joins that job and replays its stage events, so the creator's review time hides most of the plan latency. An edited brief simply starts a new job.
2. On generate, run **in parallel** (goroutines): Wonder (`reasoning_effort: minimal`) → manifest+glue (one call, structured JSON) and Ember (`minimal`) → content (needs only the brief + media captions). Then validate (`sgtool validate`, <30ms). On failure: one repair call with the validator errors (retry limit 1), then fall back to the pre-baked template manifest. The plan prompt lists only *implemented* concepts (compact catalog from `spec/concepts.json`), the hard validator rules, the glue API and the quiz template as worked example.
3. Hard timeouts: brief 12s, plan 25s, content 25s, repair 20s → template fallback. Every successful (source `muse`) result is cached on disk by input hash (`gen2:`/`brief2:` keys).
4. Spend: every Muse call is metered; requests are refused (fallback used) once `spent_usd >= cap` (default 15).
Target: generate end-to-end p50 under ~10 s with live Muse, under 100 ms on cache hit.

## Server implementation notes (added by the Go backend)
- **Spend guard**: the cap is a dev/eval guard, configurable via env `SG_SPEND_CAP_USD` (default 15); `/api/usage` returns `cap_usd` from config plus `capabilities` (per-model reasoning_effort/response_format accepted/rejected). Usage persists in `server/data/usage.json`.
- **Sources**: brief `source` and game `gen.source` are `muse | cache | fallback | fallback-budget` (`seed` for seeded games).
- **Brief shape** (`POST /api/briefs`, `POST /api/games/generate` `brief`): exactly `spec/brief.schema.json`: `{intent, audience, mood, energy(1-5), competition:"solo"|"versus"|"daily", content_source:{media_ids[], group_id}, limits:{duration_s, rounds}, title_idea, template:"quiz", level, glue_ideas[]}` plus optional `tone, difficulty, palette, emoji`. The server fills `template`, `level`, `content_source` and clamps `limits.rounds` to 3-10 (`duration_s` default rounds*10). The server tolerates numbers sent as strings (the iOS editor), dropping unusable ones. `round_ms` for `rule.round_timer` is derived as `duration_s*1000/rounds`; `competition:"daily"` selects `seed_scope:"daily"`, otherwise `per_challenge`. `mood` is free text; the planner maps it onto the `feel.theme` enums (palette `sunset|ocean|forest|midnight|candy|mono`, mood `playful|calm|intense|cozy|mysterious`).
- **Spec files used by the server**: `concepts.json` (compact catalog digest of implemented concepts only), `brief.schema.json` (structured-output schema; `template/level/content_source` stripped), `templates/quiz.manifest.json` (plan example and fallback manifest, customised with title, description, rounds, round_ms, theme, seed_scope) and `templates/trip-trivia.content.json` (fallback content when fewer than 3 photos). Embedded copies exist only as a last resort when the spec directory is unreadable; a Go test keeps them identical to the files.
- **Content from Ember** is normalized to `sg.content/1`: `kind:"question"`, ids `q1..`, exactly 4 distinct choices, `answer` in 0-3, `media_url` filled from the server's media table whenever `media_id` is known (empty strings otherwise), capped at `limits.rounds` items, at least 3 valid items or the template content is used.
- **Generation `gen` object** now also carries `notes[]` (validator summaries when a plan needed repair, Muse errors) and `stages` in ms. Joining a speculative job reports the job's stage timings; `gen.ms` is the wall time of the generate request itself.
- **Generate SSE**: first event is sent immediately; stages `plan, glue, content` start together, then `validate`, optional `repair`, then `save`. Cache hits emit all stages with `ms:0`.
- **Cost**: Wonder ~$0.02-0.03 and Ember ~$0.001 per game; a speculative job that is never used costs the same.
- **Tunables (env)**: `SG_PLAN_REASONING` (default `minimal`; `low` measured ~3 s slower with the same validity), `SG_BRIEF_MODEL` (`ember` | `wonder`), `SG_SPECULATE=0`.
- **Player**: served at `/player/` with `application/wasm` for `pkg/*.wasm`; `?game=<id>` works for drafts and published games; the browser POSTs `/plays` itself (verified via `sgtool replay`). `scripts/e2e-test-game.mjs` and `scripts/browser-play-check.mjs` cover the full path.
- **SSE stage event** may carry `count` (glue entries) on `glue` done. Cache hits emit all stages with `ms:0`.
- **sgtool missing**: generation cannot validate, so it uses the template manifest (source `fallback`); plays are stored with `verified:false`.
- **Config**: server flags/env `-addr/SG_ADDR`, `-data/SG_DATA`, `-player/SG_PLAYER`, `-spec/SG_SPEC`, `-sgtool/SG_SGTOOL`, `-muse-url/MUSE_BASE_URL`; key from env or nearest `.env` (`MUSE_API_KEY`).
- `GET /api/feed` items: `game` is trimmed (no manifest/content); `band` is `challenge|you|friends|creators|discover`.

## Runtime addenda (implemented in `scroll-games/runtime`, additive to the contracts above)
- **Events**: `spec/events.json` is `{events:[{name, builtin, payload, doc}]}`. Built-in (runtime-emitted) events: `session.*`, `tick`, `input.raw` (`{type:"choice",index}` from the host), `input.tap`. `input.choice` is emitted by `input.tap_choice`; `answer.correct|wrong` by `rule.single_answer`; `round.*` and `game.over` by `flow.rounds`. Extra events exist for stub concepts (`input.swipe`, `entity.*`, `lives.changed`, ...).
- **Validator wiring**: every event a manifest concept consumes must be built-in or emitted by another concept in the manifest (`glue.*` is accepted when the manifest has glue). `flow.session` is mandatory. Report shape: `{ok, errors:[{path,msg}], warnings:[{path,msg}]}`; stubs produce a warning.
- **Glue**: dispatch order is concepts first, then glue, per event (breadth-first queue, max 2000 events per dispatch). Extra reserved vars: `banner` (string shown in the view, cleared each round), `round_points` (points earned this round, read-only). `set("score", n)` and `set("streak", n)` announce `score.changed` / `streak.changed` automatically; `round`, `total_rounds`, `time_left_ms`, `round_points` are read-only. `emit` accepts only `glue.*` and `feedback.*` names. Validator dry-runs every entry for each `on` event with synthetic data in round 1/8 and 8/8; any script error, including the op limit, is a validation error.
- **View model extras**: `clue` (shown after a round ends), `layout` (`grid|stack`), `media_fit`, `ui:{share_card,beat_them,share_headline,beat_label}`; `feedback.flash` is the current flash color name or null.
- **Result extras**: `result()` also returns `warnings[]` and `logs[]`. Inputs accepted by `input()`: `choice`, `tap`, `pause`, `resume`.
- **Replay**: `sgtool replay` request `inputs` is the `inputs` array from `result()`; error responses are `{ok:false,error}`.
- **Player**: `?local=1` loads `../spec/templates/quiz.manifest.json` + `trip-trivia.content.json`; `?api=<origin>` overrides the API origin.

## Daily game (return loop)
- **One game per UTC day**, pinned in the store (`daily` map date -> game id) on first request so later publishes don't change it mid-day. Candidates: published games whose manifest has `seed_scope:"daily"`; if none, all published games. Sorted by id, rotated by day index (days since epoch).
- **Seed**: `FNV-1a32("daily:" + "YYYY-MM-DD")`, the same for everyone. The runtime itself never reads `seed_scope` (it only validates the enum); the host passes the seed, and the server enforces it for daily plays.
- **`GET /api/daily`** (viewer from `X-User`): `{date, game (trimmed), seed, resets_at (next UTC midnight, RFC 3339), my_play?, my_streak, leaderboard_top (top 5 counted plays), friends_played, my_rank_among_friends?}`.
- **Daily plays**: `POST /api/games/:id/plays` with `daily:true` and `date` (defaults to today). 400 if `date` is not today (UTC), the game is not today's daily, or `seed` differs from the day's seed. The first *verified* daily play per user per day is the counted attempt; further daily plays are stored with `practice:true` and are excluded from the daily leaderboard, rank and streak. Response gets `daily:{date, counted, practice, streak, rank_among_friends}`.
- **Streak**: consecutive UTC days ending today (or yesterday if today is unplayed) with a counted daily play; derived from stored plays. A missed full day resets it to 0.
- **Feed**: a synthesized pinned item `type:"daily"`, `band:"daily"`, always first (before challenges), `game` trimmed, `play` set once played. Text: `Today's daily: <title> — N friends played. Keep your K-day streak.` (or `Start a streak.`); after playing: `You scored N on today's daily (#R among friends)`. Clients that don't know the type should skip it.
- **Demo data**: friends get synthetic counted plays for today (created lazily, deterministic by date); a store with no daily history gives `u_me` a 3-day streak ending yesterday.
- **Player**: `?daily=YYYY-MM-DD` shows a "Daily · Nov 12" chip in the HUD (the `embed-ios` 52px left padding is unchanged), fetches the seed from `/api/daily` if `seed` is absent, adds `daily`/`date` to the `result` message and to the browser's plays POST, shows the streak line, and keeps the daily seed on Play again (a practice run).
- The server clock is injectable (`App.now`) for tests.

## Follows and demo photos

- `POST /api/users/{id}/follow` and `DELETE /api/users/{id}/follow` (caller from `X-User`) add or remove `{id}` in the caller's `follows` and return the updated user. Idempotent; 404 for an unknown user, 400 for following yourself. `GET /api/me` reflects it and the feed "creators" band reads it.
- Demo photos live in `server/static/media/<media_id>.jpg` (generated once with `go run ./cmd/genphotos`, Muse Image, ~$0.01 each) and are served at `GET /media/<file>` with `Cache-Control: public, max-age=86400`. Stored media URLs are relative (`/media/m1.jpg`); every `/api/*` response (JSON and SSE) rewrites them to absolute `scheme://host/media/...`, so `media_url` in game content and `GET /api/media` are directly loadable. Media without a generated file keep their picsum URL.
