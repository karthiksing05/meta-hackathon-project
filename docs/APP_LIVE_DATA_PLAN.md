# Plan: make the app run on live backend data only

Written by Claude (for Max) for Karthik's agent. **Not applied:** the machine this was written on has no Xcode or Swift, so none of
it is compiled. Do it on `backend-api` (Max's branch; others merge it later), on a Mac, one stage per commit, building after each.

**Rule (Max):** no hardcoded mock data in any part of the app or its viewers. Every person, game, score, friend, Group, challenge and
feed item comes from `https://api.ol4ol.com`. Demo content may be added to the *database* later, never to app code. The app does no
ranking, generating or game-data computing; it calls endpoints and draws replies. If an endpoint is missing, add a request in
Slack for Claude (for Max) and the Agent Logistics canvas (see CLAUDE.md); do not fake it in the app.

Contract: `backend/README.md`. Client: `FacebookClone/Bubbles/API/GamesAPILive.swift` (feed, game, publish, scores, submitScore,
setSaved, sendEvents, auth, generation jobs). Today **no screen calls it**: `GamesAPIFactory` is unused, so everything below is local.

## Stage 0: sign-in and the client

- `GamesAPIFactory.current` returns `GamesAPILive.shared` always. Remove `GamesAPIMode`, `FB_API`, and the `mock` default
  (`GamesAPI.swift`, the `FB_API` line in `App/DebugLaunch.swift`). Keep `FB_API_URL`.
- Sign in once at launch (`signInAsDevice()` exists) or on a real login screen; hold the user in one observable object. All later stages need a token.
- Delete `GamesAPIMock.swift`, `GameGeneratorMock.swift`, `API/Fixtures/generate-replay-postcard-pairs.json`, and the `FB_GENERATE`
  mock cases in `GameGeneratorFactory` (`GameGenerator.swift`); the factory returns `GameGeneratorLive.shared`. Update `docs/BUBBLES.md` mentions.
- `GamesAPIModels.swift` "Mock-only features": `ChallengeRequest`, `Challenge`, `GroupBlendSummary`. Keep only what stages 3 and 4 need; delete the rest.

## Stage 1: games and the feed (biggest)

| Today (local) | Becomes |
|---|---|
| `Store/BubbleFeedRoster.swift` (511 lines of hardcoded games, bot-run scores), `BubbleFeedSource.swift`, `BubbleOpponentRuns.swift` | `GET /v1/feed?limit=&sessionID=&exclude=` for pages; `GET /v1/games/{id}`; `GET /v1/games/{id}/leaderboard` for scores. Delete the roster; `BubbleStore` holds fetched games only. |
| `Recommend/StoreRecommendations.swift`, `Recommend/*` ranking in Swift, `Recommend/game-recs.js` use on device | Delete device ranking. The feed order is the server's. Report what happened with `POST /v1/feed/events` (page events and moments; shapes in README "Ranking"). The JS file stays in the repo: the server reads it. |
| Search | `GET /v1/search?q=&tag=` |
| Save/like | `PUT`/`DELETE /v1/games/{id}/like` |
| Score submit | `POST /v1/games/{id}/scores` |

Note the runtime still plays games on the phone (`bubble-runtime.js`, kits, Artem's engine); the manifest comes from the game's
`manifest.json` URL in the API reply. That is playing, not data, and stays.

## Stage 2: people, friends, Groups

| Today | Becomes |
|---|---|
| `Store/BubbleSocialCast.swift` (rival "Maya", `friendIDs`, `newInSFCrew`/`picnicPlanners` chats), `BubbleSocialHub.swift` | `GET /v1/me/friends`, `PUT`/`DELETE /v1/me/friends/{id}`, `GET /v1/users/{id}`. Delete the cast and `install(...)` in `BubbleSurfaceHooks.swift`. |
| `ChallengeCenter.swift` (uses `rival`, `groupMembers`, hardcoded win/loss patterns), `GroupGamesStore.swift`, `LearnProgressStore.swift`, `GroupsSearchScreens.swift` | Groups: `GET /v1/groups?kind=&mine=1`, `GET /v1/groups/{id}`, `PUT`/`DELETE .../members/me`, `GET /v1/groups/{id}/games`. Remove every `BubbleSocialCast.*` use. |
| Blend | `POST /v1/groups/{id}/blend` (server reads members' data); `GET .../blend-inputs`. Delete `Recommend/GroupBlend.swift` logic. |

## Stage 3: making games

- `Studio/StudioDemoWorld.swift`, `OfflineComposer.swift`, `BubbleStudioFactory.swift` (`StudioDemoWorld.load()`), and the demo-world JSON resource: delete.
- Create = `POST /v1/generate` `{request, brief}`, poll `GET /v1/generate/{id}` (`GameGeneratorLive` already does). `StudioModel.swift` lines ~1373 and ~1414-1430 drop the `StudioMicrogameBridge`/on-device branch.
- Remove the app's Muse calls: `MuseStudioService.swift`, `MuseComposeSession.swift`, `MuseConfig`/`MuseConfig.json`, `scripts/sync-muse-config.sh`
  use, `GameAnatomyMuse.swift` and the other direct callers (grep `MuseConfig`, `api.meta.ai`). The app must not hold the Muse key.
  Anatomy needs an endpoint: **request to Claude (for Max)**. Until then show "not available" instead of calling Muse.

## Stage 4: needs backend work first (requests to Claude for Max)

Challenges (send/list "beat my 34"), the moments inbox, leaderboard `friends` and `group` scopes (the board is global today), the
anatomy endpoint, and posts, comments and Events for the wider Facebook screens. Max's backend will add these in that order unless Karthik says otherwise. Until then these screens show an empty or "not available" state, not fake rows.

## Stage 5: the rest of the Facebook clone

`Data/MockData.swift` and `Data/MockContent.swift` (about 2,600 lines of people, posts, Groups, Events) and `AppStore`, `PreviewSupport`
fixtures are hardcoded content. The backend has no posts endpoint yet. Decide with Max: request posts/Events endpoints (then load that
content into the database), or scope the rule to the Bubbles feature for the demo. Do not leave a half-state.

## Definition of done

- `grep -rn "Mock\|StudioDemoWorld\|OfflineComposer\|BubbleSocialCast\|BubbleFeedRoster\|MuseConfig" FacebookClone` finds nothing outside docs.
- The app builds; with airplane mode on, screens show loading or error states, never content.
- `node tools/runtime-tests/run-node.js`, `tools/runtime-tests/run-jsc.sh`, `tools/kits-tests/run-all.sh` still pass.
- `docs/BUBBLES.md`, `docs/LIVE_DATA_AUDIT.md` updated in the same commits.
