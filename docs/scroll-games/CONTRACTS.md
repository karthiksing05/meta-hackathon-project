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
  spec/            concepts.json (catalog, 179 concepts, all implemented), events.json, schemas (*.schema.json)
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
`emit(name, data_map)`, `get(key)`, `set(key, value)` (game vars; reserved keys: `score`, `round`, `total_rounds`, `streak`, `multiplier`, `time_left_ms`), `rand_int(lo, hi)` (seeded), `log(msg)`. The reserved vars and any custom vars already set are also plain scope variables inside `on_event`: `score += 10; banner = "Nice"; multiplier = 2;` work without `get`/`set`. Changed values are written back after the script succeeds (same rules as `set`: read-only vars warn, `score`/`streak` announce changes); a `let` that shadows a game var is local and never written back. Custom vars that were never set are not defined (use `get`, or `is_def_var("n")`). The validator dry-run uses the same scope.
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
| POST | /api/games/generate | `{prompt, brief, media_ids[]}` → **SSE** (`text/event-stream`): `event: stage` `{stage, status:"start"\|"done", ms}` for stages `plan, content, glue, validate, moderate, repair, save`; final `event: done` `{game}` or `event: error` `{message}`. `?stream=0` returns final JSON instead. |
| GET | /api/games/:id | `{game}` where game = `{id, title, description, creator_id, status:"draft"\|"published", manifest, content, brief, created_at, gen:{ms, stages, source, cost_usd}, stats:{plays, best}}` |
| POST | /api/games/:id/publish | → 200 `{game, feed_item, moderation}` (pass or flagged) or **422** `{error, moderation:{decision:"blocked", reasons[]}}` with the game left `draft` (see Moderation) |
| POST | /api/games/:id/moderate | creator only; re-checks the game and returns `{moderation}` |
| POST | /api/games/:id/report | `{reason}` from any user → `{ok, reports, hidden}` |
| GET | /api/moderation/queue | `[{game (trimmed), reports[], hidden}]` for flagged or reported games |
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

## Moderation

- **Stored on the game** as `moderation:{decision, reasons[{category,severity:"low"|"high",reason,where?,source:"precheck"|"muse"}], checker, input_hash, ms, cost_usd, notes[], checked_at}`. `decision` is `pass`, `pass-precheck-only` (Muse failed or timed out; only the free checks ran), `flagged` (any low) or `blocked` (any high). Older stores with `moderation:"stub-pass"` load as `pass` with `checker:"legacy-stub"`; seeded games have `checker:"seed"`.
- **Pre-checks** (`moderation.go`, no network): regex blocklists for slurs, sexual content, self-harm, violent threats, emails, phone numbers, street addresses, spam wording and links; a small real-person list flagged only next to an insult cue; length limits (title 80, description 400, any text 400, total 20000); glue scripts that try to emit core events are recorded in `notes` (the runtime already ignores them).
- **Model check**: one `muse-ember-1.0` call (`reasoning_effort:"minimal"`, `response_format` json_schema `moderation`, 5 s timeout, budget-guarded) over title, description, all content strings, glue string literals and the captions of photos the content uses. It returns severity `none|low|high` plus a reason for each of `hate, harassment, sexual, violence, self_harm, personal_info, spam`. A missing category is treated as a failed call. The verdict is cached by the hash of the checked text.
- **Pipeline**: stage `moderate` starts the moment `content` finishes and runs while the Wonder plan is still in flight (content text only). When the plan arrives only the free pre-checks run over its strings (title, description, glue literals) and merge with the content verdict; a second Muse call happens only for a long plan text (over 300 characters) that the pre-checks did not settle. Repaired or fallback content is re-moderated. The merged verdict is cached under the hash of the full text and saved on the draft, so publish reuses it. A cached generation also emits `moderate`.
- **Publish**: blocked gives 422 and the game stays `draft`; flagged publishes but the game is visible only to its creator (feed, daily) with a banner; pass publishes normally.
- **Reports**: `POST /api/games/:id/report` stores one report per user per game (a repeat updates it). At 2 distinct reporters the game is hidden from everyone but its creator pending review. `GET /api/moderation/queue` has no auth in this prototype.
- **iOS**: the generating checklist shows "Checking content"; the publish step shows the verdict ("Checked by Muse: passed" / flagged / blocked with reasons and "Edit brief"). A Report action in the game card menu is not built (needs `ScrollGamesHomeView`).


## Meta concepts

Non-spatial concepts (`runtime/src/ext_meta.rs`, rendered by `player/ext.js`). All write into `view.ext.<group>.<key>`; they are deterministic (tick counters and `g.rng` only). Server- or host-supplied runtime data (leaderboards, ghost series, invite links) comes in as content `copy`: `copy.social`, `copy.share`, `copy.meta`, `copy.locales`. List order matters in two places: content concepts that claim rounds (`caption`, `blank`, `audio`, `riddle`, `pin`, `shape` items) append their items to the round order at `session.loaded`, so list them after `content.question_bank` (or omit it). `result()` has no extension data; final values (`share.*`, `social.*`, `meta.analytics`) are read from `view().ext` after `session.ended`.

Float params: `Params` has only integer accessors, so a float override is honoured when its integer part differs from the catalog default (catalog defaults otherwise). Adding `Params::float` to `concepts.rs` makes these exact.

Host hooks (CustomEvents on `window`, not yet wired by `player.js`): `sg:social` `{type: reaction|comment|follow|rematch|qr|story|replay_clip, ...}` and `sg:input` `{type:"text", text}` (riddle answers; the session would forward them as `input.text`).

| Concept | Behavior | `view.ext` keys |
|---|---|---|
| feedback.sound_cue | cue + counter on correct/wrong/timeout | `sound.{cue,n,volume}` |
| feedback.screen_shake | 400 ms shake on wrong (skipped under reduced motion) | `fx.shake.{intensity,n,active}` |
| feedback.floating_score | last 6 score deltas with a fade `life` 0..1 | `fx.floaters[{id,delta,life}]` |
| feedback.pulse_timer | pulse rate rises once time left is under the threshold | `fx.timer_pulse.{active,hz}` |
| feedback.color_wash | hue shift grows with streak (full at streak 5) | `fx.color_wash.{hue,streak}` |
| feedback.emoji_burst | emoji rain on correct | `fx.emoji_burst.{emoji,n,count}` |
| feedback.voice_cheer | TTS phrase on correct and at game over | `voice.{text,voice,n}` |
| feedback.slowmo | slow-motion when answered with 25% or less time left | `fx.slowmo.{active,factor}` |
| feedback.vignette_low_time | red vignette strength 0..1 under the threshold | `fx.vignette` |
| feedback.toast | toasts for streak >= 2 and `level.started` | `fx.toasts[{id,text}]` |
| score.time_attack | at `session.ended` score becomes elapsed play time (lower is better) | `score.{mode,lower_is_better,unit}` |
| score.distance | `per_meter` x `custom.distance` (or `custom.speed` x seconds, default 1 m/s) | `score.distance_m` |
| score.combo_chain | hits inside `window_ms` chain; bonus 10 x (combo-1); wrong or timeout breaks it; emits `combo.changed` | `score.combo` |
| score.accuracy_percent | score tracks round(100 x correct / answered) | `score.accuracy` |
| score.lives_bonus | at `game.over` `per_life` x lives (from `lives.changed` or `custom.lives`) | `score.lives_bonus` |
| score.par_target | `bonus` at `game.over` if score >= par; live par gap | `score.par.{par,bonus,hit,gap}` |
| score.perfect_bonus | `bonus` at `game.over` when no wrong answers and at least one correct | `score.perfect` |
| score.collect_count | `per_item` per `entity.collected` | `score.collected` |
| score.word_length | `per_letter` x letters of each valid `word.submitted` | `score.words` |
| score.rhythm_accuracy | `perfect`/`good` points per `beat.hit` grade, miss = 0 | `score.rhythm.{perfect,good,miss}` |
| score.drawing_similarity | on `input.draw` compares to `custom.reference_shape`; >= threshold scores round(sim x 100); resolves the round (`answer.correct`/`answer.wrong`) | `score.drawing_similarity` |
| content.word_list | `word` items filtered by length, deduped, optional seeded shuffle; also `custom.words` | `content.{words,word_hints}` |
| content.emoji_set | `emoji` items (prompt tokens or choices) flattened, first `count` | `content.emoji` |
| content.caption_guess | `caption` items become choice rounds (photo + captions as choices) | none |
| content.fill_blank | `blank` items become choice rounds (prompt holds the `___`) | none |
| content.audio_clip | `audio` items become choice rounds; `media_url` is the clip | `content.audio.{url,clip_ms,round}` |
| content.pair_deck | `pair` items (prompt = face A, `choices[0]` or clue = face B), seeded-shuffled deck of 2 x `pairs` cards | `content.deck.{pairs,cards[{pair,face,media_url}]}` |
| content.image_sequence | first `length` `sequence` items are the chronological answer; shown order is seeded-shuffled and never equal | `content.sequence.{shown,answer}` |
| content.riddle_set | `riddle` items: `choices` are accepted answers, `clue` the hint; `input.text` (normalised) resolves the round, 3 attempts | `content.riddle.{active,hint,letters,attempts_left,answer}` |
| content.trivia_category | keeps question items whose id starts `<category>:` or `<category>/` (`general` keeps all) | `content.category` |
| content.user_media_pool | `media` items (max `max_media`); rounds without a photo get one from the pool | `content.media[{id,url,caption}]` |
| content.map_pins | `pin` items: `choices` = `[x, y, radius?]` in 0..1 map coords; `input.tap` within radius is correct, one try | `content.pin.{name,radius,target}` (target only after the round) |
| content.reference_drawing | `shape` items: `choices` = `"x,y"` points; sets `custom.reference_shape` and the prompt | `content.shape.{name,points}` |
| content.beatmap | `beat` items: `choices` = note times in ms; `input.tap` is graded perfect (80 ms) / good (160 ms), passed notes are misses; emits `beat.hit` | `content.beats.{t_ms,total,upcoming,perfect,good,miss}` |
| social.challenge_friend | at `game.over` emits `challenge.sent` | `social.challenge.{ready,max_recipients,score}` |
| social.friends_leaderboard | `copy.social.friends` + the player (`copy.social.me.name`), top N plus the player's own row | `social.friends_leaderboard.{rows,you_rank,total,final}` |
| social.ghost_replay | `copy.social.ghost` = `{name, series:[[t_ms,score]]}` (or `score`); emits `ghost.updated` on change | `social.ghost.{name,opacity,score,delta,ahead}` |
| social.async_versus | `copy.social.opponent`; status pending, win, lose, tie, waiting; emits `challenge.sent` | `social.versus.{opponent,you,status,same_seed}` |
| social.coop_score | `copy.social.coop` members pooled with the player | `social.coop.{mine,others,pool,members}` |
| social.reaction_stickers | stickers unlock at `game.over`; counts from `copy.social.reactions` | `social.reactions.{available,enabled,counts}` |
| social.comment_on_result | thread unlocks at `game.over`; items from `copy.social.comments` | `social.comments.{enabled,max_len,items}` |
| social.tag_friend_in_photo | `copy.social.tags[media_id]` people, revealed at `round.ended` | `social.tags.{media_id,count,people}` |
| social.group_scoreboard | like the leaderboard over `copy.social.group` (or `friends`) | `social.group_scoreboard.{rows,you_rank,total,final,scope}` |
| social.rematch | same-seed rematch offer at game over; emits `challenge.sent` | `social.rematch.{available,same_seed,score}` |
| social.spectate | state frame every 6 ticks for the host to stream | `social.spectate.{seq,t_ms,score,round,total_rounds,streak,time_left_ms}` |
| social.follow_creator | follow prompt at game over; `copy.social.creator` | `social.follow.{show,creator}` |
| share.replay_clip | window of the last `max_seconds` of ticks (re-play inputs from `start_tick`); emits `share.requested` | `share.replay_clip.{max_seconds,start_tick,end_tick,total_ticks}` |
| share.daily_streak | `copy.share.daily_streak = {days, played_today}`; +1 at game over | `share.daily_streak.{days,text}` |
| share.result_emoji_grid | one cell per round, rows of 5 | `share.emoji_grid.{grid,rows}` |
| share.invite_link | `copy.share.invite_url` + challenge line | `share.invite.{url,text}` |
| share.story_export | 1080x1920 or 1080x1080 card fields | `share.story.{aspect,width,height,title,score,headline,emoji,palette}` |
| share.copy_result_text | text summary (+ emoji grid when present) | `share.text` |
| share.qr_challenge | `copy.share.challenge_url` + `beat=<score>` (or `sg://challenge?beat=`) | `share.qr.payload` |
| feel.sound_pack | pack for cues (`arcade` `soft` `retro` `none`) | `sound.pack` |
| feel.music_loop | plays while the session is running | `sound.music.{track,volume,playing}` |
| feel.palette_cycle | hue 0..360 over `period_s` | `style.palette_cycle.{hue,period_s}` |
| feel.retro_pixel / paper_texture / neon_glow | style intensity | `style.pixel_size` / `style.paper_grain` / `style.neon_glow` |
| feel.juice_level | global effects amount | `style.juice` |
| feel.camera_zoom | zoom pulse on correct | `fx.zoom.{amount,n}` |
| feel.font_pack / dark_light | typeface; light or dark | `style.font` / `style.appearance` |
| feel.cozy_mode | warm filter; sets `theme.mood = "cozy"` | `style.cozy` |
| meta.daily_seed | flag; the host derives the seed (`seed_scope: daily`); date from `copy.meta.date` | `meta.daily_seed.{enabled,date}` |
| meta.adaptive_difficulty | level 0..1 moves by 0.1 x aggressiveness per round; next round timer x (1.25 - 0.5 x level); emits `difficulty.changed` | `meta.difficulty` |
| meta.analytics_events | event counts and result summary at game over (no ids) | `meta.analytics` |
| meta.ab_variant | `g.rng` draw at load; also `custom.ab_variant` for glue | `meta.ab_variant` |
| meta.debug_overlay | last 8 events and counters | `meta.debug.{tick,recent,score,round,warnings}` |
| meta.content_moderation_hint | flags contact info, links and abusive words in items; adds a warning | `meta.moderation.{count,flags[{item,reason}]}` |
| meta.input_recorder | counts `input.raw` (the session records inputs regardless) | `meta.input_recorder.{recording,count}` |
| meta.cheat_guard | answers faster than `min_answer_ms` lose that round's points and add a warning | `meta.cheat_guard.{rejected,min_answer_ms}` |
| meta.locale | built-in en/es/fr/de/pt strings, overridable by `copy.locales[locale]` | `meta.locale.{locale,dir,strings}` |
| meta.schema_version | pins the version, warns when not 1 | `meta.schema_version` |
| meta.hot_seat | player = (round-1) mod players; banner "Player N's turn"; per-player score deltas | `meta.hot_seat.{players,current,scores,winner}` |
| accessibility.reduced_motion | flag; suppresses confetti, shake, zoom, burst, slowmo | `a11y.reduced_motion` |
| accessibility.high_contrast | black/white/yellow palette applied as CSS vars | `a11y.{high_contrast,palette}` |
| accessibility.colorblind_palette | Okabe-Ito good/bad colors; the flash color is replaced in the runtime; checkmark/cross glyphs | `a11y.colorblind.{mode,good,bad,symbols}` |
| accessibility.screen_reader_labels | status line, prompt, per-choice labels, live announcements | `a11y.labels.{status,prompt,choices,announce,announce_n}` |
| accessibility.extended_time | round timer x multiplier on the first tick of each round | `a11y.time_multiplier` |
| accessibility.one_handed | layout shifted to one side | `a11y.one_handed` (`left` or `right`) |
| accessibility.haptics_off | player stops `navigator.vibrate`; hosts must ignore `feedback.haptic` | `a11y.haptics_off` |
| accessibility.captions | text captions for audio cues for 2.5 s | `a11y.captions[{id,text}]` |
| accessibility.dyslexia_font / big_targets / pause_anytime | font; min touch target px (>= 44); pinned pause button | `a11y.dyslexia_font` / `a11y.min_target_px` / `a11y.pause_anytime` |

## Gameplay concepts

The 73 input / space / entity / behavior / rule / flow concepts beyond the quiz set live in `runtime/src/ext_play/` (`input.rs`, `space.rs`, `entity.rs`, `behavior.rs`, `rule.rs`, `flow.rs`, `board.rs`, shared `world.rs`). All state is in `Game::world` (a 360 x 600 logical field); the player only draws `view.world` and sends inputs. Determinism: fixed 60 Hz ticks, the one seeded `g.rng` (cosmetic particles use their own fixed-seed RNG), only `+ - * /` and `sqrt` in the simulation (no sin/cos/pow, so native `sgtool` and wasm agree bit for bit; verified by `scripts/play-templates.mjs`).

**Runtime behavior shared by all genres**
- Tick order: `world.integrate()` (move, cull, expire) -> default circle collision (unless `rule.collision` takes over) -> `tick` event (spawners, behaviors, rules). Entities live in `world.ents`; geometry helpers: grid cell, lane x, timeline zones.
- Generic outcome events: board and goal concepts also emit `answer.correct` / `answer.wrong`, so `score.points`, `rule.wrong_penalty`, `rule.lives`, `flow.sudden_death`, `feedback.*` and the meta concepts work in every genre. `Game::finish(won)` ends a stage: it emits `level.ended` when `flow.levels` / `flow.endless` is present, else `game.over`.
- Dispatch order: `rule.streak_shield` first; `flow.session` then the interceptors (`flow.levels`, `flow.endless`, `flow.retry_once`, `flow.best_of_n`, `flow.practice_mode`, `flow.intermission`, `rule.difficulty_ramp`, `rule.no_repeat`, `rule.elimination`, `rule.win_target`) last. `retry_once` and `best_of_n` rebuild the systems and continue the RNG stream (`Session::restart_run`).
- Freeze: `flow.lobby_wait` and `flow.tutorial` freeze the sim (`view.world.overlay`); only `ack`, `pause`, `resume` are accepted. During a freeze the runtime dispatches `freeze.tick` instead of `tick`.
- New host input messages (all recorded and replayed): `{type:"tap",x,y}` (now delivered as `input.raw`; `input.tap` comes from `input.tap_target` / `input.double_tap`), `swipe {dx,dy,x,y}`, `drag {phase:start|move|end,x,y}`, `press`, `release`, `text {text}`, `voice {text}`, `draw {points:[[x,y]..]}`, `tilt {x:-1..1}`, `select {index}`, `submit`, `dial {step}`, `ack`. Coordinates are logical field units.
- Validator additions: `input.tap` is no longer "built in" for wiring (an input concept must emit it); `entity.*` / `behavior.*` need exactly one non-quiz `space.*`; at most one space; `consumes_any` catalog flag (rule.lives, flow.sudden_death, feedback.flash/haptic) means one of the consumed events is enough; space concepts declare the content kind they need (`card`, `word`, `event`, `place`, `hotspot`).
- Catalog edits made for coherent wiring: extra params (`emoji`, `lifetime_ms`, `rivals`, `level_ms`, `beats`, `pairs`, `goal`, ...), `requires`, the added `emits` (`answer.*`, `game.over`, `level.ended`, `score.changed`, ...), `score.points` no longer requires `flow.rounds`.

| Concept | System |
|---|---|
| input.swipe_direction | `raw swipe` -> `input.swipe{dir,dx,dy,x,y}`; `min_distance`, `directions` filter |
| input.tap_target | `raw tap` -> `input.tap{x,y}`; `hit_slop` widens hit tests |
| input.drag_drop | pick up draggable events/pins, snap to zones within `snap_radius`, emit `input.drag{x,y,phase,id,slot}` for every phase |
| input.hold_release | counts ticks between `press`/`release`, auto-release at `max_hold_ms`, emits `input.hold{ms}` |
| input.text_entry / voice_answer | `raw text` / `voice` -> `input.text{text}` (max chars, case); player shows a text box / mic |
| input.draw_stroke | `raw draw` -> stored strokes (`view.world.strokes`) + `input.draw{points}` |
| input.tilt_steer | `raw tilt` -> integrates a steering x, emits `input.drag` while tilted |
| input.double_tap | two taps within `window_ms` -> `input.tap{double:true}` |
| input.multi_select | `select` toggles up to `max_selected` (state `selected`), `submit` emits one `input.choice{index,indices}` |
| input.rotary_dial | `dial` -> value mod `steps`, `view.world.extra.dial`, `input.drag{phase:"dial"}` |
| space.grid_board / card_table | grid geometry (`world.grid`), cols x rows; card table sizes rows from the card count |
| space.lanes / scrolling_world | lane count and lane x; scrolling background, entity flow direction (left/up/down) and base speed |
| space.free_canvas | blank canvas; `goal: trace` scores stroke coverage of a `shape` item (>= 75% solves) |
| space.word_grid | 6-row guess grid, hidden target and dictionary from `word` items, per-level reset (`extra.word`) |
| space.timeline_strip | zones for `slots` and the shuffled `event` pool, ranks from `answer` |
| space.physics_world | gravity (px/s^2 = gravity x 30) and free two-axis motion |
| space.photo_stage | full-bleed photo plus hidden `hotspot` items found by tapping (`extra.find`) |
| space.rhythm_track | 4 lanes, a note every beat at `bpm`, tap judging (perfect/good/miss) -> `beat.hit`, `answer.*`; `beats` notes then `finish(true)` |
| space.map_view | draggable `place` pins, tolerance shrinks with `zoom`; lock on target |
| entity.player_avatar | the player glyph: lane steering by swipe/tap, grid walking, follows drags |
| entity.falling_object / obstacle / collectible | spawn templates (own timers, or driven by `behavior.spawn_wave`); catch = points, obstacle = `collision.hit{harm}`, `lifetime_ms` for grid whack play |
| entity.enemy_wave | waves of `wave_size` enemies after `gap_ms`; shot -> `value` points, landing -> harm hit |
| entity.card / tile / word_tile | memory cards from `card` items; match tiles / 2048 tiles; on-screen keyboard emitting `input.text` |
| entity.bouncing_ball / paddle / projectile | ball with wall and paddle bounces (`collision.hit`); paddle follows drags; shots fired on tap |
| entity.particle_emitter / hint_giver | cosmetic trail (own RNG); hint button that dims a wrong choice / peeks a pair / reveals a letter |
| behavior.gravity / patrol / homing / bounce / magnet / wrap_edges / drift | world gravity; sideways sway; steering toward the avatar; wall and brick bounces; pull of collectibles; wrap instead of cull; render-only ambient wobble |
| behavior.spawn_wave / spawn_rate_ramp | seeded weighted spawning every `every_ms`; rate grows `ramp_per_min`, announces `difficulty.changed` |
| behavior.follow_finger | eases avatar/paddle to the last drag position (`smoothing`) |
| behavior.shuffle_tiles / merge_adjacent / slide_to_wall | solvable shuffle; 2048 merge (`merge_to`) with `match.made`; avatar slides to the wall (`collision.hit`) |
| rule.lives / hint_budget / wrong_penalty / win_target / total_time_limit | lives (`lives.changed`, `game.over`); tap the hint entity (`hint.used`); score penalty; end at target; whole-game clock (`hud.clock_ms`) |
| rule.collision / no_repeat / difficulty_ramp / streak_shield / elimination | box or circle overlap events; dedupes items; difficulty per round (shorter timers); a full streak absorbs a mistake; simulated rivals, lowest cut per round |
| rule.match_pair / match_three / word_valid / order_sequence / sequence_memory | memory pairs; swap + cascade + refill; Wordle grading against the dictionary; drag-order check (`sequence.step`); Simon pad sequence |
| flow.levels / endless | level counter, `level_ms` or goal driven, difficulty +0.25; stage after stage until failure |
| flow.sudden_death / retry_once / best_of_n / practice_mode | first mistake ends; one free restart after a loss; best run of n; result score 0 |
| flow.intermission / lobby_wait / tutorial / daily_puzzle | extra delay after a round; simulated friends joining; overlay with "Got it"; `extra.daily_puzzle` hides Play again |

**View model additions** (`view.world`, always present): `space` (`""` = quiz), `w`, `h`, `bg`, `scroll`, `flow`, `cols`, `rows`, `lanes`, `slots`, `grid {ox,oy,s}`, `photo`, `fit`, `zoom`, `ents[{id,role,label,img,x,y,r,hw,hh,state,tag}]` (`tag` only for tiles and pads; face-down card labels are blank), `zones`, `hud {lives,hints,level,found,pairs,combo,clock_ms,clock_total_ms,...}` (the same keys are readable by glue via `get`), `toast`, `overlay {kind,text,button}`, `input {swipe,tap,drag,hold,text,voice,draw,tilt,select,dial}` (which inputs the player must wire), `strokes`, `extra {word, find, trace, dial, hold, hit_y, daily_puzzle, practice}`, `level`. `result()` now also carries `ext` (the meta view data).

**Genre templates** (`spec/templates/<genre>.manifest.json` + `<genre>.content.json`, `?local=1&template=<genre>` in the player): lane_runner, memory_match, word_guess, daily_word, rhythm_tap, paddle_rally, star_catcher, star_shooter, match3, swipe_merge, timeline_sort, photo_hunt, whack_mole, simon_says, map_pins, trace_draw (plus the quiz). Content kinds: `card` (prompt, media_url), `word` (prompt, clue), `event` (prompt, answer = order), `place` / `hotspot` (prompt, choices = [x%, y%]), `shape` (choices = "x,y" points); see `spec/content.schema.json`.

**Server**: the brief's `template` (or genre keywords in intent/title) selects the genre; `templateManifest` / `templateContent` serve the genre fallback (personalized with photos for memory_match and timeline_sort); the planner gets the genre manifest as its EXAMPLE and a GENRE note; Ember writes the genre's content kind (`planGenreContent`) with the template as fallback. The plan catalog digest lists only concepts used by a template.

**Checks**: `cargo test` (`tests/gameplay.rs`: every template validates, a scripted bot wins each genre and the run replays exactly; per-concept tests), `node scripts/play-templates.mjs` (wasm play + wasm and native replay agree), `node scripts/browser-templates-check.mjs [--shots dir]` (headless Chrome, no page errors, canvas painted).
