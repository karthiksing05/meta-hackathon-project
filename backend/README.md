# Bubbles backend

Go + Chi API, a small static server for published game packages, MongoDB 8 for metadata and social data.
Production runs on one Vultr server behind a Cloudflare Tunnel: the API is at https://api.ol4ol.com and the
published games are at https://games.ol4ol.com. Setup steps: [docs/HACKATHON_DEPLOY.md](docs/HACKATHON_DEPLOY.md)
(copy and paste) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (the longer version).
**The backend owns Muse and all data; the iOS app only makes API calls to it.** The app never talks to Muse, never
holds the Muse key, and keeps no game data of its own. If the app needs something that isn't here, it asks Claude
(for Max) to add it instead of building it into the app (see `CLAUDE.md`).
**A push or merge to the `Prod` branch deploys to production automatically**, so only do that when the code is
ready. This folder is self-contained; the iOS app does not call the API yet (the front end builds against a
mock first).

```
cmd/api        the API (:8080)            cmd/games    static server for published games (:8081)
cmd/dbinit     create Mongo indexes       internal/    config, auth, api, store, pkgstore, staticsrv
deploy/        Compose, scripts, env examples, systemd timers     Dockerfile   targets: api, games
```

## Run locally (no Docker or MongoDB needed)

```bash
cd backend
cp .env.example .env && set -a && . ./.env && set +a   # STORE=memory by default
go run ./cmd/api &      # :8080, in-memory store
go run ./cmd/games &    # :8081, serves ./data/games/published
go test ./...           # unit and API tests (the Mongo test runs only if MONGO_TEST_URI is set)
```

Against a real MongoDB: `docker run -d -p 127.0.0.1:27018:27017 mongo:8.0`, then
`MONGO_TEST_URI=mongodb://127.0.0.1:27018 go test ./internal/store`.

## API

JSON, camelCase. Auth is `Authorization: Bearer <accessToken>` (15 minute tokens; refresh tokens rotate).
The list below is my reading of the endpoint groups in the brief; the repo has no earlier API doc, so
treat the exact shapes as the first version and change them together with the client.

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /healthz`, `GET /readyz` | none | liveness; readiness (database + storage) |
| `POST /v1/auth/register`, `login`, `refresh`, `logout`; `GET /v1/auth/me` | none / bearer | accounts and tokens |
| `GET /v1/feed?limit=&sessionID=&exclude=` | optional | **the one feed**: the next pages, ranked by the recommender (see [Ranking](#ranking-the-recommender-runs-here)) |
| `GET /v1/search?q=&tag=&cursor=&limit=` | optional | full-text and tag search |
| `POST /v1/feed/events` | optional | batch of up to 100 events: feed pages, off-feed moments, or the older `view/play/finish/...` types (anonymous needs `deviceId`); see [Event log](#event-log-and-recommender-support) |
| `GET /v1/games/stats?since=` | none | per-game roll-up of the event log, plus creator, Group and creation day |
| `GET /v1/experiments/interleave?since=` | none | formula-vs-control interleaving summary across everyone's sessions |
| `GET /v1/events/export?since=&limit=` | bearer | the event log as JSON Lines, for offline benchmarking |
| `GET /v1/games/{id}` | optional | one game; `{id}` may also be the slug from its manifest |
| `PUT/DELETE /v1/games/{id}/like` | bearer | like or unlike (a "save"; idempotent) |
| `GET /v1/games/{id}/leaderboard?scope=everyone\|friends\|group&groupId=`, `POST /v1/games/{id}/scores` (`{score}`, or `{log}` for a game with a score model) | none (friends and group need a bearer; group needs membership) / bearer | best score per user, optionally only among my friends (and me) or a Group's members |
| `GET /v1/me/likes`, `GET /v1/games/{id}/likes` | bearer / optional | the games I saved; how many saved a game and which of my friends did |
| `POST /v1/challenges`, `GET /v1/challenges` | bearer | "beat my score": `{gameId, toUserIds[]}` (friends only, up to 20); the ones I sent and received, with `beaten`/`myScore` or each recipient's `responses` |
| `GET /v1/me/moments` | bearer | what happened with me on other phones: challenges received plus off-feed moment events that name me in `with`; `{moments: [{momentID, kind, gameID, from, at}], cursor}` |
| `GET /v1/me/recs` | bearer | my model's summary and taste profile |
| `GET /v1/users/{id}` | optional | a person's public profile (`isFriend` when signed in) |
| `GET /v1/me/friends`, `PUT`/`DELETE /v1/me/friends/{id}` | bearer | my friends; add or remove one (mutual, immediate) |
| `GET /v1/groups?kind=&mine=1`, `POST /v1/groups` | optional / bearer | Groups and Events; create one: `{kind, name, category?, about?, coverSeed?, private?, id?}`. `id` (optional) is a stable id the app's other surfaces already use, such as the demo world's `group-newinsf` (3 to 48 lowercase letters, digits or dashes, starting with a letter; 409 if taken); without it the server makes one |
| `GET /v1/groups/{id}`, `PUT`/`DELETE /v1/groups/{id}/members/me` | optional / bearer | one with its members; join or leave |
| `GET /v1/groups/{id}/games` | optional | games made for it |
| `GET /v1/groups/{id}/daily?date=YYYY-MM-DD`, `POST /v1/groups/{id}/daily` `{gameId, date?}` | optional / bearer (the Group's owner) | the Group's Daily: one game everyone plays that day. GET returns the Daily for `date` or the latest before it, `{groupId, date, gameId, setBy, createdAt, isToday, game}` (404: none yet); the app sends its own calendar day (default: today in UTC). POST sets or replaces the day's game (a listed game, or your own draft) and sends every other member a `daily_ready` notification; Groups only (422 for an Event) |
| `GET /v1/groups/{id}/leaderboard?week=2026-W46` | bearer (members) | the Group's weekly board: members ranked by rank points across the Group's games (10, 7, 5, 3, 2, then 1 for each game; ties share a place); `{week, items: [{user, points, gamesPlayed, rank, rankChange}]}`; ISO weeks in UTC, default this week |
| `GET /v1/users?q=` | bearer | find people: username prefix or the start of a display-name word, 2 to 40 characters |
| `POST /v1/groups/{id}/blend`, `GET /v1/groups/{id}/blend-inputs` | bearer (members) | Blend for the group's members, taken from the server's data; each member's skill, taste and recent games |
| `POST /v1/blend` | bearer | games and a game spec for a set of people: `{group, members, count}` |
| `POST /v1/generate` | bearer | make a game: `{request, brief}` -> 202 `{jobId}`; or change one: `{baseGameId, change?, look?, nextLevel?, baseManifest?}` (a tweak, a new look, a next level or a remix; always a new game with `remixOf` set, and a draft until published). Also `anatomy` (the agreed anatomy text, up to 16 KB, kept apart from the 2,000 character request) and `draft` (true holds a new game back; false publishes a change at once); see [Making games](#making-games-muse-lives-here) |
| `POST /v1/anatomy`, `POST /v1/anatomy/revise` | bearer | Muse takes an idea apart into its working parts: `{request, audience?}`, then `{anatomy, change, request?, afterPlaying?}`; both return `game-anatomy/0.1` (docs/BUBBLES.md 7.13) |
| `GET /v1/generate/{id}`, `GET /v1/generate`, `DELETE /v1/generate/{id}` | bearer | a job's status, steps and finished game; my recent jobs; cancel a queued or running job (it ends as failed with "Cancelled.") |
| `POST /v1/creations` | bearer | upload a package zip (`Content-Type: application/zip`) |
| `GET /v1/creations`, `GET /v1/creations/{id}`, `GET /v1/creations/{id}/source` | bearer | the caller's games (drafts included, with `unlisted: true`); private editable source as a zip |
| `POST /v1/creations/{id}/publish`, `DELETE /v1/creations/{id}` | bearer (owner) | list a draft in the feed, search and its Group; delete a game with its saves and scores (the files stay on the games host under their unguessable id) |
| `GET /v1/sounds?tab=trending\|for_you\|saved\|recent&q=`, `GET /v1/sounds/{id}`, `GET /v1/sounds/{id}/games?sort=top\|recent`, `PUT\|DELETE /v1/sounds/{id}/save`, `POST /v1/sounds` | optional / bearer | the sound library: loops that play behind games (see [Sounds](#sounds)) |
| `PUT\|DELETE /v1/games/{id}/sound` | bearer (owner) | put a sound behind a game `{soundId, offsetMs?, mix?}`, or take it off |
| `PUT /v1/creations/{id}` | bearer (owner) | a new build of your own game as `application/zip`: keeps the id, likes, plays, scores, sound and sponsor; takes the title, rule, tags, score model, `group_play` and files from the new package (send the same score model or the board re-ranks). The old files stay on the games host, unlinked |
| `GET /v1/me/notifications`, `PUT /v1/me/notifications/{id}/read`, `PUT /v1/me/notifications/read`, `PUT`/`DELETE /v1/me/push-devices/{installationId}`, `POST /v1/groups/{id}/game-shares` | bearer | the notification inbox, push devices and Group game shares (see [Notifications](#notifications)) |
| `POST /v1/rounds`, `GET /v1/rounds`, `GET /v1/rounds/{id}`, `POST /v1/rounds/{id}/plays`, `GET /v1/games/{id}/agreement` | bearer | same-seed rounds in a chat or a Group, and how opinion games compare (see [Rounds](#rounds-same-seed-play-in-a-chat-or-a-group)) |
| `POST /v1/series`, `GET /v1/series`, `GET /v1/series/{id}`, `POST /v1/series/{id}/rounds/{n}` | bearer | best-of-N with a friend on the same games and seeds; scores come from replaying the run's input log in the engine (see [Series](#series)) |

Scores are whole numbers (a fractional score is rejected). A manifest `id` that is a lowercase slug
(`hill-hopper`) is kept as the game's unique `slug`; publishing a second game with the same slug is refused (422).
The manifest's `structure.group_id` / `structure.groupID` / `structure.scope: "group:<id>"` (and the same for events)
are stored as `groupId` and `eventId`.

Game responses carry `packageUrl`, `manifestUrl` and `coverUrl` on the games hostname
(`GAMES_BASE_URL/{id}/...`). Mongo stores only the relative key and paths.

## Game packages

A package is a zip with `manifest.json` at the root (it must be a JSON object with a `title` and a
`one_line_rule`; `formula`, `brief.mood`, `tags` and `lineage.remix_of` feed metadata) plus assets:
json, wasm, js, css, images, audio, fonts, glb, bin, txt. Entries under `source/` are the private editable
source: they are stored outside the public tree and returned only to the owner. `cover.png|webp|jpg` becomes
`coverUrl`.

Publishing is validated and atomic: the upload is spooled to a private temp dir, unpacked with zip-slip,
symlink, hidden-file, extension, count and size (including zip-bomb) checks, then moved into place by a
single rename. The id is server-generated (24 hex), is claimed exclusively so it can never be overwritten, and
clients never supply paths.

## Making games (Muse lives here)

The app sends one request and the backend does the rest. Muse's key is only in the `generator` container
(`/etc/game-platform/generator.env`); the API, the games server and the app never see it.

```
app -> POST /v1/generate {request, brief}  -> 202 {"jobId": "..."}
app -> GET  /v1/generate/{jobId}  (poll every 1-2 s)
        {"status": "queued|running|done|failed", "request": "...", "events": [...], "game": {...}, "error": "...", "stats": {...}}
```

- `brief` is the app's `BubbleBrief`: `intent`, `audience`, `mood: []`, `energy`, `competition`, optional `occasion`,
  `content_sources`, `notes`. Missing fields get defaults; `intent` defaults to `request`. `request` is 1 to 2000 characters.
- `events` are the steps so far, oldest first: `{seq, kind, summary, at, ...}`. `kind` is `drafting`, `expanding`, `repairing`
  (`round`, `issues`), `playtesting` (`bots`), `playtested` (`passed`, `headline`, `blocking`), `done` (`title`) or `failed`
  (`reason`). `summary` is a short sentence for "Muse at work" screens, so the app never words a step itself.
- When `status` is `done`, `game` is the normal game object (`id`, `slug`, `title`, `formula: "microgame"`, `manifestUrl`, ...).
  The manifest at `manifestUrl` is stored exactly as generated: `content.game_json` is byte for byte what passed the playtest.
- `failed` carries a plain-language `error`. Errors on `POST`: 400 bad request, 401 signed out, 429 (one running job per person,
  6 an hour; see `Retry-After`), 503 (generator down, or Muse not set up yet).
- A job survives the app closing: poll it again later. After a server restart, unfinished jobs are marked failed.

How it runs: the Go API stores the job and streams it through the internal `generator` service (Node, no published port beyond
loopback), which runs the Studio bundle's pipeline (`MicrogameStudio.compose`, shared with the app's Studio and written by Artem, so prompts and gold examples live in one place): Muse writes an authoring manifest (`api.meta.ai/v1`, model
`muse-wonder-1.0`), the expander and engine check it, up to 3 repair rounds, five bots playtest it, a quality check and one polish round, then `wrap`. It runs the committed
`microgame-studio.js` and `bubble-kit-microgame-engine.js` bundles from the app's folders (`FacebookClone/Bubbles/Runtime/web/bubble-kit-microgame-engine.js`,
`FacebookClone/Bubbles/Studio/web/microgame-studio.js`); there is one copy of each, and the generator image copies them to `/app/vendor`. The API then publishes the result like any upload, so it appears in `/v1/feed`
and under the owner's `/v1/creations`. Changing a game sends the stored manifest as the base, so the job continues from its authoring source. Not built yet: Muse-made covers and the classic (non-microgame) formulas.

Compose's server-side hooks (`backend/generator/src/hooks.mjs`, docs/HARNESS_V2.md "Picture art" and "Layout"): the layout
fixes run before each gate and the layout lint after (`authoring/expander/layout-fix.mjs`, `authoring/playtest/layout-check.mjs`,
copied into the image; no Chrome, so structural fixes only; `GENERATOR_LAYOUT=0` turns them off). With `GENERATOR_IMAGE_ART=1`,
muse-image-1.0 draws the pictures of an art-heavy plan (`plan.art: "image"`) in place of the older art step; `GENERATOR_IMAGE_ART=0`
turns both off. A finished job's `stats` carries `requirements` (`{must_passed, must_total, note, gaps}`), `layout`
(`{counts, pixels, warnings}`), `layoutFixes` and, when pictures were drawn, `image_art`.

## Sponsored games

A brand's playable game shown in the feed like an ad. The server decides what is sponsored; the app draws a card for any game or feed item that carries `sponsor: {name, avatarUrl?, cta, url?}` (`cta` defaults to "Play now"; no `sponsor` means not sponsored).
`PUT /v1/games/{id}/sponsor {name, avatarUrl?, cta?, url?}` (its owner, and only a **brand account**) marks a game; `DELETE` takes it off; `POST /v1/generate` takes `sponsor` too. Brand accounts are the usernames in `SPONSOR_USERS` (api.env, comma separated;
none by default), so a person can't pass their own game off as an ad. Avatar and link must be http(s). Tapping a card is a feed moment event, `{kind: "sponsor_tap", gameID}`. Demo brands must be fictional (CLAUDE.md); the server doesn't check names.

## Sounds

Loops that play behind games in the feed, like TikTok sounds. A sound is a published package, stored and served like a game (`https://games.<domain>/<soundId>/<file>`): a zip with a `manifest.json`
`{"title": "...", "audio": "loop.m4a", "cover": "cover.png"?, "duration_ms"?, "bpm"?, "kind": "library" | "original"?}`, the audio file (m4a, mp3, ogg or wav) and an optional cover (png, jpg, webp). `POST /v1/sounds` (application/zip, signed in) publishes it.

- **Find them:** `GET /v1/sounds?tab=trending|for_you|saved|recent&q=&limit=` returns `{items: [{id, title, creator, creatorId, kind, durationMs, bpm, audioUrl, coverUrl, useCount, saves, savedByMe, createdAt}]}`.
  `trending` is the most used, then newest. `for_you` ranks like trending until the recommender learns sound affinity. `saved` needs sign-in. `q` matches the start of a word in the title or the creator's name.
- **A sound's page:** `GET /v1/sounds/{id}` and `GET /v1/sounds/{id}/games?sort=top|recent` (`{items: [games], total}`; drafts are left out). `PUT|DELETE /v1/sounds/{id}/save` is idempotent and returns `{saves, savedByMe}`.
- **On a game:** every game and feed item gains `sound: {id, title, creator, audioUrl, coverUrl, offsetMs, mix}` when it has one. `offsetMs` is where in the loop to start; `mix` is 0 (only the game's own sound) to 1 (only the sound), 0.7 by default.
  `POST /v1/generate` takes `soundId`, `offsetMs` and `mix`; a change to a game (`baseGameId`) keeps the original's sound unless it names another. `PUT /v1/games/{id}/sound {soundId, offsetMs?, mix?}` (its owner) sets or changes it; `DELETE` takes it off. Each sound counts the games that use it (`useCount`).
- A sound is presentation only: it never changes a replay or a score check. Not built yet: original sounds made automatically from a game's own music (the server can't render audio), sound events on the feed, and a personal "for you" ranking.

## Score-aware boards

A game's `manifest.json` may carry a top-level `score` (authoring/SPEC.md 2.13): `kind`, `direction`, `counts_when`, `aggregate`, `tie_break`, `format`, `bounds`, `ranked`. The server keeps it on the game record and shows it on every
game as `score {kind, direction, countsWhen, aggregate, tieBreak, format, bounds, ranked}`. A game without one ranks points, higher first, best run, as before.

- **Scores are whole numbers**: time kinds are whole milliseconds, accuracy a whole percent. `format` (`"{n} orders"`, `"{n}%"`, `m:ss.t`, `m:ss`, `s.t`) turns one into text; every board row carries that as `display`, so the app never formats a score.
- **`direction: lower`** ranks the smallest first (a time trial). `tie_break: "less time"` puts the shorter run first on equal scores, `"earlier"` the one set first. This holds for the game board, its friends and Group scopes, the Group weekly board, challenges (`beaten`) and series.
- **Only replayed runs**: `POST /v1/games/{id}/scores {log}`. The server replays the run's input log in the engine and reads the phase, score and time from that, never from the phone. The run must be finished (won or lost). The value is the run time for `time_to_complete` and
  `survival_time` (unless `source: "score"`), otherwise the engine's score. A plain `{score}` is refused (400) for a game with a score model. Reply: the board (`items` with `display`, `ranked`, `direction`, `format`) plus `counted`, `score`, `display`, `finished` and, when not counted, `reason`.
- **`counts_when: finished`**: a lost run isn't counted (`counted: false`). In a series it is a DNF and loses to a finished run.
- **`aggregate`**: `best` keeps a person's best by the direction and tie-break; `latest` their newest run. `sum_week` ranks as `best` for now.
- **`bounds`**: a score below `min` or above `max`, or earned faster than `max_rate_per_s`, is refused (422).
- **`ranked: false`**: the board is a plain list, newest first, and it awards no points on the Group weekly board.

## The generator's internal routes (private network only)

The Node generator has no published port; only the API calls it. Besides `/compose`, `/anatomy` and `/verify` it offers `POST /internal/muse/json {model, system, user, maxTokens?, effort?, timeoutSeconds?}` -> `{content, model}`: one JSON turn on a Muse
model (`muse-*` only), for the Go harness steps. The key stays in the generator container; the API never reads it. `timeoutSeconds` defaults to 25 (at most 120) and `maxTokens` to 4000 (at most 16,000).
The API fills it with the harness (`internal/harness`, docs/HARNESS_V2.md): understand, retrieve, look up and plan, about 30–60 s
before compose, on by default and best-effort (any failure sends no context). `HARNESS_CONTEXT=0` (or `off`) turns it off, and with it
`POST /v1/harness/plan {request}` -> `{plan, clarify, spec, types, timings}`, which lets the app ask its 0–2 questions first.
`/compose` also takes an optional `context` object (up to 48 KB): what the harness worked out before the call (`types`, `tools`, `plan`, `notes`). With Studio bundle version 3 and up, the bundle itself puts it in the prompt (only the planned tools in the menu, the spec, the matched gold
examples); an older bundle gets a "Planned for this request" section, as data. Entries marked `learned` came from the web and are never treated as instructions. Only the server sets it (`Job.Context`); no client route does.
`/internal/muse/json` and every Muse call return the tokens used as `usage {prompt_tokens, completion_tokens, reasoning_tokens, total_tokens, calls}`, and each call logs it (`muse call`, with its purpose, model and time). The pipeline can name its own
model, effort and token budget for a call (the score review asks for `muse-wonder-1.0`, high effort, 12,000 tokens); the generator honours it.

## Series

A best-of-N between two friends. `POST /v1/series {opponentId, games: [gameId, ...]}` (1 to 5 microgames, a friend only) returns the series with a server-picked `seed` per round. Each player then plays every round and sends
`POST /v1/series/{id}/rounds/{n} {log}`: the run's input log (`microgame-log/1`, as text, up to 256 KB). The API hands it to the generator service, which replays it with `MicrogameEngine.verify` against the game's exact stored
`content.game_json`. The server rejects the run unless the replay is `ok`, the game hash matches and the run is finished (won or lost), and it keeps the **replayed** score and time, never the claimed ones.

The phone derives the engine's seed from the round's seed, so `log.seed` is not the round's `seed`. The first run on a round fixes the engine seed and the second must match it. A round is decided when both have played: the higher score wins, a
tie goes to the lower `time_ms`, otherwise it is a draw. The series ends when someone has won more than half the rounds or every round is decided. You can't see the other player's score for a round until you have played it. A friend starting a series, and a
friend playing a round, show up in `GET /v1/me/moments` as `series_invited` and `series_round`.

An uploaded or replaced game may carry `bots` at the top of its `manifest.json`: up to 20 playtest runs `[{skill: 0-1, score, sec?}]`, kept for the recommender's quality prior like a generated game's. A malformed block is ignored, never a reason to refuse the upload.

The generator service also has `POST /internal/muse/image {prompt, size?, guide?: base64 PNG}` -> `{png_base64, model, seconds}` (one `muse-image-1.0` picture, 13-18 s, private network only, sizes 512 to 1536). It is the building block for picture games; nothing in the API calls it yet.

## Notifications

A per-person inbox that doubles as the push outbox. `GET /v1/me/notifications?limit=&cursor=` returns `{items: [{id, kind, title, body, gameId?, groupId?, challengeId?, seriesId?, createdAt, readAt?}], nextCursor?, unreadCount}` (newest first; `nextCursor` is opaque). `PUT /v1/me/notifications/{id}/read {read}` (`read` defaults to true) and `PUT /v1/me/notifications/read` (all) return `{unreadCount}`.

Kinds, and what makes them:
- `group_game`: `POST /v1/groups/{id}/game-shares {gameId, eventId}`. A member shares a game into a Group; every other member is notified. `eventId` is the post's stable id (4 to 100 characters), so a retry makes no second notification. The Group must be a Group (not an Event) and the sender in it.
- `friend_challenge`: a friend sent you `POST /v1/challenges` (`challengeId`) or started `POST /v1/series` with you (`seriesId`).
- `leaderboard_lost`: someone took first place from you on a ranked game. Only the former first place hears it, only when a counted score changes the leader, by the game's direction and tie-break. Own improvements, scores below first, empty boards and unranked games make nothing. Score writes on one game are serialized.
- `daily_ready`: `POST /v1/groups/{id}/daily` by the Group's owner. Every other member hears "Today's Daily in <Group> is ready" (`gameId`, `groupId`). Once per member, date and game, so setting the same Daily again notifies nobody twice.
- `viral_match`: a public game with many distinct players in a window whose description is close to your learned taste (the cosine of `game-recs.js`'s `describe(...).x` and your taste vector). Defaults: 100 players in 24 h, cosine 0.85, at least 5 learned pages, one a day, never your own game or one you played, each game once. Tune with `VIRAL_MIN_PLAYERS`, `VIRAL_WINDOW`, `VIRAL_COSINE`, `VIRAL_MIN_PAGES`, `VIRAL_PER_DAY`, `VIRAL_INTERVAL`; `VIRAL_MATCH=0` turns it off. A person whose taste has dislikes pulls away from a game's vector, so the cosine of 0.85 is a strict bar; expect to calibrate it on real data.

One row per (person, source) at most, so a retried trigger never notifies twice. The inbox works with no push configured.

Push: `PUT /v1/me/push-devices/{installationId} {token, environment: "sandbox"|"production"}` registers a device (the token is the hex APNs token; an installation moves to the account that registered it last); `DELETE` on the same route removes it, and `POST /v1/auth/logout` also takes an optional `installationId` and revokes that installation for the account whose refresh token it is. With APNs configured (`APNS_KEY_P8_B64` or `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` = the app's bundle id; from GitHub: secret `APNS_KEY_P8` and the ids as variables or secrets) each new row with a registered device is pushed as `{aps: {alert: {title, body}, sound: "default", "thread-id": kind}, notificationId, kind, gameId?, groupId?, challengeId?, seriesId?}`. Pushes are leased before sending, retried with a growing delay (up to 6 tries) when Apple or the network fails, and a refused token drops the device. Nothing logs a token or the key. Without APNs the server stores the inbox and sends nothing.

## Rounds: same-seed play in a chat or a Group

Group play has no live multiplayer and no server chats. Someone sends a game into a chat thread or a Group; everyone plays the same single-player run on the server's seed whenever they like; the results compare afterwards. The round keeps its own result lines, so it is the thread.

- A game's `group_play` (the manifest's top-level block) is stored on the game and returned as `group_play` on `GET /v1/games/{id}` and in every game view: `{mode, modes, round_seconds, result: {kind, compare, display, endings?, state?}, share_line, best_of?, same_seed}`. `compare` is `score`, `ending`, `agreement` or `none`. The app reads it to know what Send starts.
- `POST /v1/rounds {gameId, target: {kind: "chat"|"group", id}, members?: [userId], mode?}` starts a round. A chat round needs `members` (friends of yours, up to 20 people with you). A Group round needs you in the Group; with no `members` it is the whole Group. `mode` defaults to the game's. `series` is refused: a best-of is `POST /v1/series`. The server picks the `seed` and sets `length` from `group_play.round_seconds`.
- `POST /v1/rounds/{id}/plays {log}` takes a run's input log (as for a series round). It is replayed in the engine against the game's exact text, so only the replayed score, time and end state count. The first run fixes the engine seed and every later run must match it. A member can play once. The play appends a line to `lines`: the game's `share_line` filled with `{name}`, `{title}`, `{result}`, `{score}`, `{ending}`, `{choices}`, with `{result}` from `group_play.result.display`. Only the end-state variables named in `group_play.result.state` are kept, as `result` on the play.
- `GET /v1/rounds/{id}` (members only; a stranger gets 404) and `GET /v1/rounds?target=chat:<id>|group:<id>` (no `target`: the rounds you are in). A round ends when everyone has played or 24 hours (`closesAt`) after it started; `finished` and `winnerId` are set then. `order` is everyone who played, best first: by the game's score model (direction, `counts_when`, tie-break), or for `compare: "ending"` by the ending's place in `endings` (best first) and then the score. A tie for first has no `winnerId`. An opinion game (`compare: "agreement"`) has no `order` and no winner; each player sees `agreement`, their match with each other player (0 to 100).
- Moments (`GET /v1/me/moments`): `round_started` (someone started one with you), `round_played` (a member played) and `round_finished`.

`GET /v1/games/{id}/agreement` compares picks in an opinion game: `?with=<friendId>`, `?scope=friends` or `?scope=group&groupId=<id>`. It returns `{agreement: 0-100, players, items: [{item, mine, group, share}]}`, built from each person's latest replay-checked `picks` in their rounds. `group` is the most common pick among the others and `share` the share of the others who picked what you did. It answers 409 until you and someone else have each played a round of the game, 422 for a game whose result is not picks.

`POST /v1/generate` also takes `spec` (a game-spec/1 from `POST /v1/harness/plan`: the server uses it as the plan and does not plan again) and `answers` (`{slot: answer}` for the plan's clarifying questions; they replace the planner's guesses). Both are for new games only.
It also takes `preferences` (up to 20 earlier picks between versions, `[{axis, chosen: {label, value?}, rejected?, at?}]`,
docs/harness-gaps/variants.md; `POST /v1/harness/plan` takes them too) and `groupId` (a Group or Event the caller belongs to:
the generator gets `context.group {id, kind}` and scopes the game there, `structure.scope` `group:<id>` or `event:<id>`;
403 for a non-member, 404 for an unknown id). A brand's `sponsor` also goes into the plan's understanding when the request
doesn't name one, so `spec.theme.sponsor` carries the brand's name.

## Ranking (the recommender runs here)

Kevin's recommender (`FacebookClone/Bubbles/Recommend/game-recs.js`, the one copy, which the API image copies to `/app/game-recs.js`) runs **unchanged**
inside the API, on a pure-Go JavaScript engine (goja). The app does no ranking: it asks the server what to show and
reports what happened. Each signed-in person's model (posteriors, taste, bait lean, calibration history) is kept in
Mongo (`recs_state`); the pages shown this session are kept with it.

- **The one feed:** `GET /v1/feed?limit=10&sessionID=...` (limit 1-30) -> `{items: [...]}`. Every item is the game's own
  object plus `feedItemID`, `reason`, `why`, `score`, `hook`, `unproven` (and `team` when interleaving is on). Every page is
  chosen by the recommender. Signed in: it uses that person's model, remembers what it showed them this session (so the next
  call continues, with no repeats nearby), and a new `sessionID`, or 30 minutes idle, starts a new page list. Signed out: the
  recommender's cold-start ranking, nothing remembered, and `exclude=<id,id,...>` skips games the caller already has. When few
  games exist the same game can come back once the repeat window has passed. Only if ranking is switched off on the server
  does it fall back to newest first (`reason: "newest"`). Candidates are the newest 300 games, all offered on equal terms: the
  server has no ranking logic of its own. The app should send `feedItemID` and the game's `id` back in its page events.
- **Learning:** `POST /v1/feed/events` from a signed-in person also teaches their model. A feed page event
  (`gameID`, `feedItemID` or `position`, `dwellSec`, `tookOver`, `runsFinished`, `replays`, `saved`, `liked`, `floated`,
  `openedBoard`, `addedFriend`, `remixed`, `social`, `with`, `quitMidRun`, `endedSession`) becomes `observe`; an off-feed
  moment (`kind`) becomes `signal`. A resent `eventID` teaches nothing twice. Older `type` events are stored but don't teach.
- `POST /v1/blend` `{group: {id, name}, members: [{userID, name, isFriend, skill?, bio?, themes?}], count}`: the signed-in
  person must be a member. Members the server knows (they have played) are blended from what they actually like; others get
  the recommender's demo profile, steered by `bio` and `themes`. Returns `picks` (each with its `game`), a `spec` Studio can
  take (`prompt`), `cohesion` and `twins`.
- `GET /v1/me/recs` shows my model's summary (pages seen, bait lean) and taste profile.
- Settings: `RECS_RUNTIMES` (default 2, `0` turns ranking off), `RECS_INTERLEAVE` (`baseline` or a variant name mixes each feed
  with a control; page events then carry `team`, and `/v1/experiments/interleave` tallies it). The optional Muse re-rank term
  stays off: the backend never turns it on.
- To update the recommender, change `game-recs.js` in the app's folder (nothing to copy), regenerate
  `internal/recs/testdata/golden.json` with `node internal/recs/testdata/gen_golden.mjs`, and run `go test ./internal/recs`.
  The golden test replays a fixed call sequence made by Node and fails if the Go engine's answers differ.
- Games carry what the recommender describes them by (`mood`, `energy`, `competition`, `look`, `scope`, `isDaily`, and the
  playtest bots' runs for generated games), read from the manifest when a game is published.

## People, friends and Groups

All of this is real server data, with no demo or mock records: people are accounts, friendships and Group membership are made by
people through the API, and games come from Muse and uploads. The feed's candidates come from this data (the same reasons the app's
own feed generator used: a friend's best run `friendBurst` 2.2, a Group member's `groupBurst` 1.6, `daily` 3, `icebreaker` 2,
`nearby` 1.8, `nextLevel` 1.2, `yours` 0.6, `popular` 0.8); the order is decided only by the recommender. Group Blend takes its members
and friend flags from the server, and a member's taste from what they have actually played. With no history yet, the recommender falls
back to its own neutral defaults. The server holds no cast, seed games or invented scores.
The demo's New in SF world is made through the public API by `tools/demo-seed/seed.mjs` (synthetic accounts, the Group and
the picnic Event with the app's ids, scoped copies of real Muse games, scores from replayed bot runs and today's Daily).

## Web player (for testing)

The games host serves a small player at **`https://games.<domain>/play/`** (`/play/?game=<24-character id or slug>`). It runs the
app's own game runtime in the browser (read from `FacebookClone/Bubbles/Runtime/web`; the games image copies that folder to `/app/player/runtime`), loads the game's `manifest.json` from the games host, and boots it, so a game looks and plays as it does in the
app. A microgame runs on Artem's Rust engine (WebAssembly) with its game script from `content.game_json`. The page lists the games
from `GET /v1/feed`, can watch a bot play, and logs the runtime's messages. A red **Delete this game** button removes the open game (and its saves and scores) after a confirmation. It is for debugging, so there is no login: it calls `DELETE /v1/debug/games/{id}`, which does nothing (403) unless the server runs with `DEBUG_DELETE=1` in `api.env` (then `deploy.sh restart-api`). While that is on, anyone who can reach the API can delete any game, so turn it on only while cleaning up and remove it afterwards. The API allows the games host's origin for CORS.
Refresh the runtime copy from `main` when the app's runtime changes.

## Event log and recommender support

Built for Kevin's recommender (`docs/RECOMMENDER_BACKEND.md` on the `recommendation` branch). The phone does
the ranking; the server keeps the shared log and the roll-ups one phone can't compute.

`POST /v1/feed/events` takes `{"deviceId": "...", "events": [ ... ]}` (`deviceId` only when not signed in). Each
event is one of:

- a **feed page**: `eventID`, `gameID`, `feedItemID` and/or `position`, plus any of `sessionID`, `day`, `ts`
  (RFC 3339), `reason`, `team`, `score`, `propensity`, `dwellSec`, `tookOver`, `runsFinished`, `replays`, `saved`,
  `liked`, `floated`, `openedBoard`, `addedFriend`, `remixed`, `quitMidRun`, `endedSession`, `social: [kinds]`,
  `with: [ids]`, and an optional `satisfied` boolean;
- an **off-feed moment**: `eventID`, `gameID`, `kind` (any short snake_case name, stored even if the server has
  never seen it), optional `with`, `day`;
- a **legacy** event: `gameId`, `type` (`view`, `play`, `finish`, `quit`, `skip`, `replay`, `like`, `unlike`, `share`,
  `remix`), optional `value`, `at`.

`gameID` is a server id or a slug. Sending the same `eventID` again (for the same person) is a no-op; the reply is
`{"accepted": n, "duplicates": m}`. `team` is `A` (the formula) or `B` (the control); `formula`, `control` and
`baseline` are accepted as aliases. Everything is validated; a bad event rejects the batch with a message naming it.

Roll-ups (all count only events from `since`, RFC 3339 or unix ms, when it is given):

- **stats**: `impressions` = feed pages and `view` events; `takeovers` = pages with `tookOver` and `play` events;
  `finishes` = sum of `runsFinished`; `replays` = sum of `replays`; `socialMoments` = pages with a `social` list plus
  off-feed moments; `satisfied` = pages that earned credit (a finish, replay, save, float, Add friend, remix or social
  moment), or the phone's own `satisfied` flag when it sends one. Games with no events yet are listed with zeros.
  `createdDay` is whole days since 1970-01-01. `quality` is `{botGatePassed: false, fragments: 0, reports: 0}` until
  the manifest carries those fields.
- **interleave**: per session (a person plus `sessionID`) that carried a `team`, each side scores one point per
  credited page (same list as `satisfied`, excluding off-feed moments); more points wins, equal is a tie. The reply is
  `{"baseline": {"sessions", "formulaWins", "controlWins", "ties"}}`.
- **export**: JSON Lines, oldest first, the same field names as above (booleans only when true). `userID` is the
  phone's own `userID` when it sent one, else the account id, else `device:<id>`. The response header `X-Next-Since`
  is the last timestamp; pass it as `since` for the next page (the last event may repeat; dedupe on `eventID`).

Not built yet: shared sessions, replays, streaks and a Group weekly board, and the optional re-rank proxy and recs-state backup. After deploying a release that adds indexes, run `deploy/dbinit.sh` once.

## Notes and limits

- The feed is newest-first. The recommender (Kevin's work) can replace `Store.Feed` ordering later;
  events are already stored for it.
- If a package publishes but the metadata insert then fails, the files stay unreferenced on disk (immutable,
  unreachable through the API). A sweep of unreferenced ids can reclaim them.
- `STORE=memory` is for development only.
