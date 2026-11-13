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
| `GET /v1/feed?cursor=&limit=` | optional | newest-first games, keyset pagination |
| `GET /v1/search?q=&tag=&cursor=&limit=` | optional | full-text and tag search |
| `POST /v1/feed/events` | optional | batch of up to 100 events: feed pages, off-feed moments, or the older `view/play/finish/...` types (anonymous needs `deviceId`); see [Event log](#event-log-and-recommender-support) |
| `GET /v1/games/stats?since=` | none | per-game roll-up of the event log, plus creator, Group and creation day |
| `GET /v1/experiments/interleave?since=` | none | formula-vs-control interleaving summary across everyone's sessions |
| `GET /v1/events/export?since=&limit=` | bearer | the event log as JSON Lines, for offline benchmarking |
| `GET /v1/games/{id}` | optional | one game; `{id}` may also be the slug from its manifest |
| `PUT/DELETE /v1/games/{id}/like` | bearer | like or unlike (a "save"; idempotent) |
| `GET /v1/games/{id}/leaderboard`, `POST /v1/games/{id}/scores` | none / bearer | best score per user |
| `POST /v1/me/feed` | bearer | the next pages ranked for me: `{count, sessionID?}`; see [Ranking](#ranking-the-recommender-runs-here) |
| `GET /v1/me/recs` | bearer | my model's summary and taste profile |
| `POST /v1/blend` | bearer | games and a game spec for a set of people: `{group, members, count}` |
| `POST /v1/generate` | bearer | make a game: `{request, brief}` -> 202 `{jobId}`; see [Making games](#making-games-muse-lives-here) |
| `GET /v1/generate/{id}`, `GET /v1/generate` | bearer | a job's status, steps and finished game; my recent jobs |
| `POST /v1/creations` | bearer | upload a package zip (`Content-Type: application/zip`) |
| `GET /v1/creations`, `GET /v1/creations/{id}`, `GET /v1/creations/{id}/source` | bearer | the caller's games; private editable source as a zip |

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
loopback), which does what the app's `MicrogameComposer` used to: Muse writes an authoring manifest (`api.meta.ai/v1`, model
`muse-wonder-1.0`), the expander and engine check it, up to 3 repair rounds, five bots playtest it, then `wrap`. It runs the committed
`microgame-studio.js` and `bubble-kit-microgame-engine.js` bundles from `backend/generator/vendor` (copied from `main`; refresh them
when the engine or authoring layer changes). The API then publishes the result like any upload, so it appears in `/v1/feed`
and under the owner's `/v1/creations`. Not built yet: revising a game, Muse-made covers, and the classic (non-microgame) formulas.

## Ranking (the recommender runs here)

Kevin's recommender (`game-recs.js`, vendored in `internal/recs`; `SOURCE_COMMIT` says which commit) runs **unchanged**
inside the API, on a pure-Go JavaScript engine (goja). The app does no ranking: it asks the server what to show and
reports what happened. Each signed-in person's model (posteriors, taste, bait lean, calibration history) is kept in
Mongo (`recs_state`); the pages shown this session are kept with it.

- `POST /v1/me/feed` `{count (1-30, default 10), sessionID?}` -> `{items: [{feedItemID, game, reason, why, score, hook, unproven, team?}], bait}`.
  Candidates are the newest 300 games: "new" ones get a small push, "popular" ones a push that grows with plays and saves.
  A new `sessionID`, or 30 minutes idle, starts a new page list (so the repeat window and calibration restart).
  The app should send `feedItemID` and the game's `id` back in its page events.
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
- To update the recommender, copy the new `game-recs.js` over `internal/recs/game-recs.js`, set `SOURCE_COMMIT`, regenerate
  `internal/recs/testdata/golden.json` with `node internal/recs/testdata/gen_golden.mjs`, and run `go test ./internal/recs`.
  The golden test replays a fixed call sequence made by Node and fails if the Go engine's answers differ.
- Games carry what the recommender describes them by (`mood`, `energy`, `competition`, `look`, `scope`, `isDaily`, and the
  playtest bots' runs for generated games), read from the manifest when a game is published.

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

Not built yet: the social-moments inbox (`/v1/me/moments`) and Group Blend inputs (`/v1/groups/{id}/blend-inputs`),
which need the challenge, session and Group data first, and the optional re-rank proxy, recs-state backup and
generation queue. After deploying a release that adds indexes, run `deploy/dbinit.sh` once.

## Notes and limits

- The feed is newest-first. The recommender (Kevin's work) can replace `Store.Feed` ordering later;
  events are already stored for it.
- If a package publishes but the metadata insert then fails, the files stay unreferenced on disk (immutable,
  unreachable through the API). A sweep of unreferenced ids can reclaim them.
- `STORE=memory` is for development only.
