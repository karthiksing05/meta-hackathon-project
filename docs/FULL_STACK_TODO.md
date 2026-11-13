# Full-stack TODO: what must be built or verified for the app to work end to end

Written by Claude (for Max), 2026-11-12, after a real run against the live server. Status words: **verified** (run for real
on https://api.ol4ol.com), **built** (in the code and tested, not run for real), **missing** (not built), **decide** (a
person has to choose). The app build itself is Karthik's to verify (no Xcode on Max's machine).

## What was actually run on the live server (test account `test@test.com`)

- Register: works. Anatomy (`POST /v1/anatomy`, real Muse, fast model): **verified**, 7 s.
- Game generation (`POST /v1/generate`, real Muse): **verified**. "Fog Over the Bay", 63 s, first draft valid, bots passed
  (5 bots scored 11–17, all lost), quality 85. It appears in `/v1/feed`; its `manifest.json` loads from the games host
  (135 KB game script, authoring source present).
- Change a game (`baseGameId` + `change`): **failed live**. The generator rejected the stored manifest (135 KB) because its body
  limit was 64 KB. **Fixed in `279283a` on `backend-api`, not yet on `Prod`.** Re-run after deploying.

## 1. Accounts and identity (the app has no login or sign-up screen)

- [ ] **missing (app):** a real sign-up and sign-in screen. Today the app signs in silently as an auto-created *device account*
  (`GamesAccount`, password in the Keychain). The "Log out" screen in `RootView.swift` is local only and has no password fields.
  The server has `register`, `login`, `refresh`, `logout`, `me`; the screens that call them don't exist.
- [ ] **decide:** one identity. The app's signed-in person is a profile from the Facebook-clone data (`AppStore`), while the
  server sees a device account with a random username. Who is the server user? Name, photo and bio must come from the server account.
- [ ] **decide:** what happens to the device account's games, scores and friends when someone signs in to a real account
  (merge, or start fresh)? Nothing links them today.
- [ ] **missing (server):** change display name, bio and photo (`PATCH /v1/me`); photo upload. Profiles have no avatar field.
- [ ] **missing (server):** password reset and email verification (no email is sent). Decide if the demo needs them.
- [ ] **verify:** access tokens last 15 min and refresh tokens rotate on use; confirm the app recovers from an expired or revoked
  token (a screen, not a silent failure) and that two launches don't spend the same refresh token.
- [ ] **verify:** the sign-in rate limit is 10 attempts a minute per IP. A demo room on one Wi-Fi (shared IP) can hit it.

## 2. Making games, start to finish

- [ ] **verify live (after deploy):** change a game (tweak, new look, next level, remix), anatomy revise, and a change that takes
  a while (Artem measured 221 s for a revise on real Muse). The app's request timeout is 8 s; confirm it polls and never waits on one call.
- [x] **built:** cancel a job, `DELETE /v1/generate/{id}`.
- [ ] **verify (app):** the "Muse at work" screen shows each step from `GET /v1/generate/{id}`, the queued, failed and cap
  messages (1 active job per person, 6 an hour), and a finished game opens and plays.
- [ ] **verify:** the web player at `https://games.ol4ol.com/play/?game=<id>` plays a real generated game (the engine WASM
  loading in a browser). Not yet opened on a Muse-made game.
- [ ] **decide:** bots flagged some games (gate pass 92% to 75% with Artem's new prompts). Flagged games still ship. Show a badge,
  retry once more, or hide?
- [ ] **missing (server):** covers (`coverUrl` is never set for generated games); thumbnails for the feed and share cards.
- [ ] **missing (server):** several variants of one request ("A/B"); tap-to-edit one part of a game (needs a hit-test hook in the engine).
- [ ] **verify:** Muse key handling. The key is a GitHub secret written to `/etc/game-platform/generator.env`; confirm it survives
  a redeploy, set a spend or usage cap on the Muse side, and decide what the app shows when Muse is down (503).
- [ ] **decide:** keep the generator and the engine in one container, or split the engine out (Max prefers separate).

## 3. Feed, ranking and an empty database

- [ ] **decide and build:** the database is empty by design, so the feed says "No Whims yet". Karthik's idea: official studio
  accounts that post generated games. Needs a way to generate N games as a studio account on a schedule (server work), and the
  accounts themselves in the database, not in app code.
- [x] **fixed:** a feed page never shows the same game twice.
- [ ] **verify:** the app sends page events to `POST /v1/feed/events` and the server's per-person model learns (check
  `GET /v1/me/recs` before and after playing); `sessionID` stays the same across pages and changes per visit.
- [ ] **verify:** scores, saves and the leaderboard from two accounts on two phones; friends' scores show as "from your people".
- [ ] **verify:** Blend for a Group of real members. For people the server has not seen play it falls back to demo profiles
  inside `game-recs.js` (a small leftover of mock data); decide whether to switch that off.

## 4. People, friends, Groups

- [x] **built:** find people, `GET /v1/users?q=`. The front end still has to use it.
- [ ] **decide:** friending is mutual and instant today (no request and accept). A real friend-request flow needs new endpoints.
- [ ] **missing:** Group invites, removing a member, transferring ownership; Event fields (date, place, RSVP) on `/v1/groups?kind=event`.
- [ ] **built, app not wired:** challenges, moments inbox, friends and Group leaderboards, saves from both sides. Wire the
  screens, then test two accounts end to end (send a challenge, see it arrive, beat it, see it update for the sender).
- [ ] **missing:** push notifications (APNs). The moments inbox is pull only; the app has to poll it.
- [ ] **missing:** shared sessions for Together and quiz night; replays and `replayUrl` on boards; streaks; a Group weekly board.

## 5. The rest of the Facebook clone (Stage 5)

- [ ] **missing (server):** posts and the Home feed, comments and reactions, stories, reels, Messenger (conversations, messages),
  Marketplace, notifications. The app still reads `MockData.swift`, `MockContent.swift`, `AppStore` and `bubble-demo-world.json`.
  Karthik to send the fields each screen reads; Max's agent builds the endpoints and an importer that loads the content into
  the database.

## 6. Safety and cleanup

- [ ] **missing (server):** report a game, block a person; Muse-made content has no moderation step beyond the bots.
- [x] **built:** delete a game (`DELETE /v1/creations/{id}`). Still missing: delete an account.
- [ ] **missing (server):** The test account `test@test.com` and the game "Fog Over the Bay" now on the
  live server cannot be removed through the API; they have to be removed in the database before the demo.
- [ ] **verify:** private fields. Email is returned only to its owner; check that no other endpoint leaks it.

## 7. Operations

- [ ] **verify:** `Prod` runs `279283a` or later (the revise fix), `deploy.sh status` is healthy, and `rollback` works.
- [ ] **fix:** `TestRankedFeed` failed once in the deploy run and passed on rerun (a flaky test in the recommender's repeat window).
- [ ] **verify:** database backups run (`deploy/backup.sh`) and one restore has been tried; the hackathon setup has no Mongo password.
- [ ] **verify:** Cloudflare forces HTTPS on `api.ol4ol.com` and `games.ol4ol.com` (the app's default URL is https).
- [ ] **missing:** alerting. Nothing tells anyone when the generator or the API is down.
- [ ] **verify:** load. Two jobs run at once; a room of people generating together will queue. Check what the app shows while queued.

## 8. The app (Karthik)

- [ ] Build on device against `Prod` with airplane mode on and off: loading and error states, never fake content.
- [ ] `grep -rn "Mock\|StudioDemoWorld\|OfflineComposer\|BubbleSocialCast\|BubbleFeedRoster\|MuseConfig" FacebookClone` finds
  nothing outside Stage 5 files and docs; no Muse key in the app bundle (`scripts/sync-muse-config.sh` must not run for app builds).
- [ ] Runtime, kit and recs tests still pass; free-account installs expire 2026-11-19.
