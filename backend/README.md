# Bubbles backend

Go + Chi API, a small static server for published game packages, MongoDB 8 for metadata and social data.
Production runs on one Vultr server behind a Cloudflare Tunnel: the API is at https://api.ol4ol.com and the
published games are at https://games.ol4ol.com. Setup steps: [docs/HACKATHON_DEPLOY.md](docs/HACKATHON_DEPLOY.md)
(copy and paste) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (the longer version).
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
| `POST /v1/feed/events` | optional | batch of `view/play/finish/quit/skip/replay/like/unlike/share/remix` (anonymous needs `deviceId`) |
| `GET /v1/games/{id}` | optional | one game |
| `PUT/DELETE /v1/games/{id}/like` | bearer | like or unlike (a "save"; idempotent) |
| `GET /v1/games/{id}/leaderboard`, `POST /v1/games/{id}/scores` | none / bearer | best score per user |
| `POST /v1/creations` | bearer | upload a package zip (`Content-Type: application/zip`) |
| `GET /v1/creations`, `GET /v1/creations/{id}`, `GET /v1/creations/{id}/source` | bearer | the caller's games; private editable source as a zip |

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

## Notes and limits

- The feed is newest-first. The recommender (Kevin's work) can replace `Store.Feed` ordering later;
  events are already stored for it.
- If a package publishes but the metadata insert then fails, the files stay unreferenced on disk (immutable,
  unreachable through the API). A sweep of unreferenced ids can reclaim them.
- `STORE=memory` is for development only.
