# Scroll Games: MVP product spec

Status key: **built** exists in the repo; **not built** deliberately out of MVP. Technical contracts are in `CONTRACTS.md`.

## Creation flow (built)

Four steps in `SGCreateFlowView.swift`, from the Games tab "Make a game" button.

1. Request: free-text prompt ("What kind of game?"), creator level (default Remix; Compose and Free are accepted by the API), optional photos (see opt-in rules). Continue is disabled while the prompt is empty. Button: "Review brief".
2. Brief review: `POST /api/briefs` returns an editable brief (intent, audience, mood, energy, competition solo/versus/daily, rounds and duration, title idea, glue ideas), labeled "From Muse", "Fallback brief" or "Offline sample". Copy: "This is the plan Wonder will build from. Change anything before you generate." Mood is fixed at creation. Server starts generating speculatively as soon as the brief returns; editing the brief starts a new job.
3. Generating and preview: `POST /api/games/generate` over SSE. Stage list: plan, content, glue, validate, repair (only if it runs), save, with per-stage ms and "Done in N s". The close gesture is disabled while generating. The preview plays the game with a random seed and shows "Preview score".
4. Publish: creates a feed item and sets `moderation: "stub-pass"`. The screen says "Moderation: stub (always passes in this demo)".

## Play flow and result screen (built)

- Tapping Play on a feed card opens the game in a `WKWebView` (pooled and pre-warmed) running the wasm runtime. State machine: Loading, Ready, Countdown, Playing, Paused, Ended.
- Quiz template: rounds of 3-10, per-round timer, four choices, points, time bonus, streak multiplier, flash, haptic and confetti feedback, large-text option, glue banners.
- On game over the app posts the recorded inputs to `POST /api/games/:id/plays`. The server replays them with `sgtool`; the play is `verified` if scores match.
- Result screen (`SGResultView.swift`): score, correct, wrong, best streak, rank, and, for challenge plays, "You beat X's N!" or "X still has you beat with N." Actions: "Challenge friends", "Play again", "Done". If saving fails: "Score not saved: <error>".

## Challenge flow (built)

- After a play, "Challenge friends" calls `POST /api/challenges` with the game, play and optional recipients. With no recipients it goes to all of the sender's friends.
- Text on the card and share sheet: "<Name> scored <score> on <title>. Beat them?" Button on the card: "Beat them".
- Who sees it: recipients get a feed item in the top band, "Challenges for you". Others do not see it in that band.
- Accepting: the challenge carries the sender's seed, so the recipient plays the same questions and order. The result screen compares scores and returns `beat {user, score, won}`.
- Link `http://<host>:8787/c/<id>` redirects to the player at that seed and opens in any browser. The browser player posts the play itself and shows the score card with a "Get Scroll Games" link.

## Creator profiles and feed bands (built, with limits)

- Tapping a creator opens a profile (`SGCreatorProfileView.swift`) with their games and a Follow button. Follow calls `POST /api/users/{id}/follow` (and `DELETE` to unfollow), so follows are saved on the server and the feed `creators` band reads them. The server seeds one followed creator for `u_me` (`u_nova`).
- Feed order, band then newest first: `challenge` (addressed to me), `you` (my items from the last 24 h), `friends`, `creators` (followed), `discover`. Each item carries its `band`.

## Return loop (built)

Daily game: one game per UTC day, the same for everyone, from `GET /api/daily`. The seed is FNV-1a32 of `"daily:" + date`. The first verified play per user per day counts; later plays that day are practice and do not touch the daily leaderboard, rank or streak. The streak is the number of consecutive UTC days with a counted play.

- Games tab: a pinned "Today's daily" hero card at the top with the date, title, friends played, flame streak, reset countdown and a "Keep streak" button.
- Player HUD: a "Daily · Nov 12" chip.
- Result screen: "Streak: 4 days" and "#3 among friends on today's daily".
- Verified in the iOS simulator: the streak went from 3 to 4 and the score was verified by server replay. Details in `CONTRACTS.md`, "Daily game".

## Seed and scope rules

| `seed_scope` | Meaning | Status |
|---|---|---|
| `per_challenge` | The challenge fixes the seed; everyone who accepts plays the identical game. Default | Built |
| `daily` | Seed derived from the UTC date, same for everyone | Selected by the brief. Built: FNV-1a32 of `"daily:"+date`, enforced by the server for daily plays |
| `per_play` | A fresh random seed every play | Accepted by the validator. Without a challenge the player already uses a random seed |

Question and choice order are shuffled by `meta.seeded_random`, so the same seed gives the same game. The server replays with the seed the client reports.

## Opt-in rules for personal media (built)

- Off by default. Copy: "Off by default. Photos are only sent if you turn this on."
- Nothing is sent to the server for generation unless on; the brief request carries `opt_in_personal_media`.
- At most 8 photos are selected; only captions inform Ember's questions.
- Not built: consent from other people in a photo, per-photo visibility rules.

## Moderation stub (built as a stub)

Publish always passes and records `moderation: "stub-pass"`. The UI says it is a stub. We say: "Moderation is a placeholder in this prototype. Generated games are not reviewed. A real product needs classification before publish, reporting and takedown." No reports, blocking or review queue exist.

## Synthetic demo data (built)

Seeded on first server start: users (`u_me`, friends Ana, Ben, Chloe, Dev, Eli; creators Nova Plays and Pixel Pete), groups, captioned photos, games, plays, challenges. Banner text "Demo photos from synthetic groups." marks it in the picker. Twelve photos (m1-m12, both synthetic groups) were generated with muse-image-1.0 from the synthetic captions by `scroll-games/server/cmd/genphotos` (about $0.12 total, about 17 s per image). They show no identifiable faces (crowds from behind) and are served from `/media/*`; a missing file falls back to its picsum URL. Verified in the simulator: the Pena Palace, Santa Justa Lift and pastéis de nata photos match their questions.

## Loading, error and empty states (built)

- Feed: loading spinner; failed with the error and "Try again"; empty "No games yet. Make the first one from your photos." with a "Make a game" button.
- Offline: banner "Offline: showing sample games. Can't reach <host>."; the picker shows "Offline: sample photos"; briefs are labeled "Offline sample".
- Create: generate error shown inline with the stage marked "Stopped"; publish error shown under Publish.
- Muse fallback: sources `fallback` and `fallback-budget` produce a valid template game, labeled as such.
- Result: "Score not saved" and "Couldn't create the challenge: ..." messages.

## Identity (built, fake)

No sign-in. The app sends `X-User` (default `u_me`, "You"); the server trusts it. Users are synthetic. Do not present this as authentication.
