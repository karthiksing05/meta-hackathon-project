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

## App side: still mock or local (for Karthik's agent; backend requests are in Slack)

These are in the app and must go; where the server cannot yet serve the data, the request is listed.

| App code | Problem | Server replacement |
|---|---|---|
| `Bubbles/API/GamesAPIMock.swift`, `GameGeneratorMock.swift`, `FB_API` default `mock` | Mock is the default; screens do not use `GamesAPIFactory` | Live only; delete the mocks |
| `Data/MockData.swift`, `Data/MockContent.swift` (2,600 lines) | Hardcoded people, posts, Groups | `/v1/users`, `/v1/groups`, `/v1/me/friends` (posts/Events: request to backend) |
| `Bubbles/Store/BubbleSocialCast.swift`, `BubbleFeedRoster.swift`, `BubbleOpponentRuns.swift` | Hardcoded friends, rival "Maya", chats, opponent runs | Friends/Groups/scores endpoints; challenges and moments inbox are requests to backend |
| `Studio/StudioDemoWorld.swift`, `OfflineComposer.swift` | Fake world and offline game composer | `/v1/generate`; delete |
| `Studio/MuseStudioService.swift`, `MuseComposeSession.swift`, `GameAnatomyMuse.swift` etc. (~13 files) | App calls Muse directly | Server only; anatomy endpoint is a request to backend |
| `Bubbles/Recommend/*` ranking in Swift | App-side ranking | `/v1/feed` |

## Not verified

A real Muse generation end to end (needs the key on the server), and the live server runs the older image until `Prod` is pushed.
