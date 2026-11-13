# Live-data audit (Claude for Max, backend)

**Rule (Max):** no hardcoded mock data anywhere in the app or any viewer. Everything a screen shows is pulled from the backend
(`https://api.ol4ol.com`). Sample data may be loaded into the *database* later for demos; it never lives in app code, bundles or fixtures
that screens read. The app makes API calls and draws results; it does not rank, generate, or compute game data.

## Backend side: done

| Area | State |
|---|---|
| Games, covers, manifests, scores, saves, events | Mongo + package store; no seed data in the repo |
| Feed, search | One `/v1/feed` (and `/v1/search`) ranked by Kevin's `game-recs.js`, run unchanged in Go (goja), golden-tested against Node |
| Recommender candidates | Built from real friends, Groups and scores |
| Friends, Groups, Blend | Server endpoints and data |
| Game generation | `/v1/generate` -> generator service (Muse -> Artem's engine/Studio bundles -> bot playtest) |
| Web player | `/play/` runs the app's own runtime and the engine WASM; lists games from `/v1/feed` |

## Redundancy removed (one copy each, in the app's folders)

| File | Single copy | Used by |
|---|---|---|
| `game-recs.js` | `FacebookClone/Bubbles/Recommend/` | app, API image (`/app/game-recs.js`), tests |
| Runtime, kits, engine bundle, CSS | `FacebookClone/Bubbles/Runtime/web/` | app, web player (`/app/player/runtime`) |
| `bubble-kit-microgame-engine.js`, `microgame-studio.js` | Runtime/web, Studio/web | app, generator image (`/app/vendor`) |

Deleted from `backend/`: `internal/recs/game-recs.js`, `internal/staticsrv/player/runtime/`, `generator/vendor/`.
The web player is the only browser viewer the backend serves.

## App side: done (Karthik's agent, branch `backend-api`, staged as in `docs/APP_LIVE_DATA_PLAN.md`)

| Stage | What changed |
|---|---|
| 2 People, friends, Groups | Deleted `BubbleSocialCast.swift`, `BubbleFeedRoster.swift` (cast, skills, synthetic scores), `BubbleOpponentRuns.swift` (`simulateRun`) and every use: Challenge, Together, quiz night, Learn, Story, Saves, Remix, Groups-and-Search, Studio. People are server accounts (`resolvePerson` → `GET /v1/users/{id}`), friends `/v1/me/friends`, Groups and members `/v1/groups`, a Group's games `/v1/groups/{id}/games`, Studio's Group picker uses your server Groups. Removed all made-up chats, notifications, replies, rivalry history, weekly-board history, savers and streaks. Challenges, sessions, quiz nights, the weekly board and friends' paths show "Not available yet". |
| 1 Games and feed | `BubbleStore` holds fetched games only: the feed is `GET /v1/feed` pages, a game is its server object plus its manifest and cover, boards are `/leaderboard`, runs go to `POST /scores`, saves to `/like`, Search's games to `/v1/search`, the Library loads `/v1/creations`. Deleted: the seed games (moved to `tools/game-fixtures/` for tests), bot-run scores, synthetic scores, the feed generator, the local archive and streak, `GameRecommender.swift`, `StoreRecommendations.swift`, `GroupBlend.swift` (Blend is `POST /v1/groups/{id}/blend`), and the launch-time game posts, stories, reels and notifications. `FeedEventReporter` sends page events and moments to `POST /v1/feed/events`. |
| 0 Client | `GamesAPIFactory.current` is always `GamesAPILive.shared` (no `FB_API`, no mock). `GamesAccount` signs in once at launch with the device account. The client covers feed, search, game, leaderboard, scores, saves, feed events, users, friends, Groups, Group games, Blend and creations. `GamesAPIMock.swift`, `GameGeneratorMock.swift` and `API/Fixtures/` are deleted; `GameGeneratorFactory.current` is always the server. |

## App side: still mock or local

These are in the app and must go; where the server cannot yet serve the data, the request is listed.

| App code | Problem | Server replacement |
|---|---|---|
| `Data/MockData.swift`, `Data/MockContent.swift` (2,600 lines) | Hardcoded people, posts, Groups | `/v1/users`, `/v1/groups`, `/v1/me/friends` (posts/Events: request to backend) |
| `Studio/StudioDemoWorld.swift`, `OfflineComposer.swift` | Fake world and offline game composer | `/v1/generate`; delete |
| `Studio/MuseStudioService.swift`, `MuseComposeSession.swift`, `GameAnatomyMuse.swift` etc. (~13 files) | App calls Muse directly | Server only; anatomy endpoint is a request to backend |

## Not verified

A real Muse generation end to end (needs the key on the server), and the live server runs the older image until `Prod` is pushed.
