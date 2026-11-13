# Gap: group play (same game, same seed, compare after)

Owner: Claude for Karthik (gap agent), 2026-11-12. Branch `gap-group-play`, pushed to `harness-v2`.

## What Karthik wants

His words: "imagine a Game Pigeon style interface where, instead of having a multiplayer game, we have a single
player game where everyone plays it and then evaluates their multiplayer scores."

So there is **no live multiplayer**. Someone sends a game into a chat thread or a Group. Each person plays the same
single-player run, on the same seed and length, whenever they like. The thread then shows how the results compare:
who won the round, the standing in a best-of series, the Group's round, the Group's weekly board. We take only the
interface pattern (a game sent into a conversation, played on your turn, results shown back there). We copy no
app's names, art or text.

It's also the top judging criterion: every feature brings specific people closer.

## Which requests need it

All of them: every game can be sent to a chat. What changes per game is **what a result is** and **how two
results compare**. From Kevin's 32 (`kevin32/plan-report.md`):

| Kind of result | Kevin32 prompts | Compare | Default mode |
|---|---|---|---|
| A score that ranks | 2–5, 7–10, 12–16, 19–22, 24–32 | the score model (direction, finish rule, tie-break) | head-to-head; series for skill games (3, 5, 15, 25); a Group round for quizzes and dailies (4, 8, 11, 22, 31) |
| An ending | 1, 17 | best ending first, then fewer choices | head-to-head |
| Picks with no right answer | 6 (rate car brands), 18 (tier list vs everyone) | agreement with a friend, the chat or everyone | opinion compare |
| A judged reply | 23 (rizz) | a score, because the replies are rated at build time | head-to-head |

Before this change, none of the 32 plans came out unranked or as an opinion game. #6 counted pairs rated (farmable
by tapping), #18 was scored as points, and #17 gave +10 per choice, which rewards *more* choices when the goal is
"10 choices or less".

## What already exists (read from the code)

- **Server (`backend/`, Max):**
  - `POST /v1/challenges` is "beat my score": score only, friends only, up to 20 people, no seed.
  - `POST /v1/series` is a best-of-N between **two friends**, with 1–5 games and a server-picked seed per round. Each
    run is replayed with `MicrogameEngine.verify`, so only the replayed score and time count. A round goes to the
    **higher** score, with a tie going to the lower `time_ms`. That ignores the score model, so a time trial is
    ranked backwards.
  - `GET /v1/groups/{id}/leaderboard?week=` is the Group weekly board: rank points 10, 7, 5, 3, 2, then 1, across
    the Group's games.
  - Scoped boards: `scope=friends|group`, highest score first.
  - `GET /v1/me/moments` carries `series_invited` and `series_round`.
  - **There are no chats or messages on the server.**
- **App (Artem, iOS):**
  - `ChallengeCenter` sessions and game nights do the full pattern on the phone, with a card in a chat that updates
    ("3 of 5 played", the winner line). In the live-data build they show "Not available yet" (docs/BUBBLES.md 7,
    7.2).
  - `BestOfFiveOfferSheet` sends five `POST /v1/challenges`, not a series. Its own comment says "same-seed rounds
    with verified scores come when the server serves series", and the server does now.
  - Karthik's bracket (`Features/Bubbles/Bracket/`, 7.14) is a best of three with a **local stand-in** opponent,
    and its server endpoints are only proposed.
  - `BubbleChatCard` already carries `seed`, `length`, `session_id`, `score` and `extras`.
- **Engine:** deterministic: the same seed and the same inputs give the same run. `verify` returns the phase, time
  and score only, so the server can't see *which ending* was reached or *what was picked*.
- **Harness (before this change):**
  - `spec.social` was `{share, challenge, same_seed, board}` and was checked only for "share is not empty".
  - The score model already had `ranked: false` (score.mjs, the score step), but the planner never chose it.
  - Every catalog type had `social_hooks` (3 dice types said "none"), and `players` was `async_friends` on 1,187 of
    1,280 types.
  - `async_turns` was a stub.
- **Blend:** picks games for a set of people. It's upstream of this: a Blend game is then sent as a round.

## Options

**A. Same-seed rounds on the server, with the result defined by the plan (recommended).**
- The planner writes `spec.social`; compose makes the game fair on a shared seed; the manifest carries
  `group_play`.
- The server runs **rounds**: a round is a game, a seed and length, a target (a chat thread or a Group) and its
  members. Each play is a verified replay, and the round keeps its own result lines, so it works as the thread
  even though there are no server chats.
- A series is a sequence of rounds. A Group round ranks everyone. The weekly board already exists.
- **Cost:**
  - Max: about a day. Rounds reuse the series code (seeds, verify, moments), and the series has to honor the
    score model.
  - Artem: about half a day for `verify` to return named end state. The app's send flow and thread card exist
    locally and need to be switched to the API.
  - Us: done here.
- **Replay risk:** none new. Every result is still re-derived from the replay, and the end state comes from the same
  replay.

**B. Keep it in the app (`ChallengeCenter` sessions with local stand-ins).** It's quick, but it breaks the CLAUDE.md
rule that the backend owns game data, and other people's results would be bot runs. Rejected.

**C. Live multiplayer (`realtime_room`).** It isn't what Karthik asked for, needs a new transport, and can't be
replay-verified per player. Rejected. The catalog keeps it as a `gap`.

**For opinion games**, there are two parts:
- **A1, friend to friend:** two runs' picks, compared item by item. It needs only the end state from the replay.
- **A2, compared with everyone:** a per-game aggregate of everyone's picks. Max, about half a day after A1.

Until A2 ships, a game reveals no "group average" it doesn't have.

## Recommendation

1. Ship A: the planner decides how each game is compared. The server owns rounds, series and agreement, and the app
   switches its existing chat cards to the server's rounds.
2. Opinion games set `ranked: false` and compare agreement. Story games compare the ending, then the choices used.
3. **Honest stand-in until the server lands:**
   - head-to-head through `POST /v1/series` with one game, with a known issue: it ranks higher-first;
   - the Group weekly board;
   - agreement between two friends computed from their picks (`group-play.mjs agreement`).

## What I built

**Planner (Go, `backend/internal/harness/`):**
- `social.go`: the new `social` part of `game-spec/1`:

  ```
  social: {mode: same_seed_async | series | group_round | weekly_board | opinion_compare,
           modes (filled by Go), round_seconds (30-90, inside end.session_seconds),
           result: {kind: score | ending | picks | creation, compare: score | ending | agreement | none,
                    display, endings (best first), state (the game state that holds the result)},
           share_line ("{name}: {result} on {title}. Your turn."), best_of (3 | 5), board, same_seed (always true),
           reason}
  ```

- **Validators:**
  - `same_seed` is forced to true.
  - An agreement result makes the score `ranked: false` and the mode `opinion_compare`.
  - An ending result needs at least 2 endings, and the share line may not name one.
  - An unranked score compares `none`.
  - `best_of` is 3 or 5.
  - `round_seconds` is clamped into the run's length.
  - A run that can't end within 180 s is flagged.
  - A share line without `{result}` gets the default line.
  - The older `share` field still reads.
- **Defaults per family:** series for skill games (racing, sports, reaction, runner and others); a Group round for
  quizzes, words, dailies and party games; head-to-head otherwise. Opinion requests ("rate", "tier list",
  "favourite", "which … better", "vs everyone") and consensus types compare agreement. Story games compare the
  ending.
- **The default is applied like the score default:** Muse may move off it only with a `social.reason`.
- **No clarify slot:** the send sheet already picks the chat or Group, so there's nothing truly ambiguous to ask.
- **Kevin32 planner fixes (from the lead):**
  - The schema's goal examples are placeholders now, and `requestChecks` flags a goal that copies one ("clear
    every tile" on a race).
  - A capped goal ("in 10 choices or less") can't score each use of what it caps.
  - An opinion request scored like a quiz is flagged.
  - Request words that name an unbuilt tool (whole-word alias match) get a gap entry, so a need is never dropped
    silently, and gaps may cite any unbuilt catalog tool.
  - Slots borrowed from a type the plan didn't choose are defaults only, which makes make-24 a no-question case.
  - The planner prompt now says never to ask who plays, and never to ask a theme for unthemed content.
  - The context notes, `understanding.by` and `timings.understood_by` say which understander ran (`muse`, or
    `keywords (muse failed: …)`).

**Compose (`authoring/expander/`):**
- `group-play.mjs` has:
  - the manifest's `group_play` block, kept consistent with the shipped score;
  - the compose rules: every random draw comes from the seed, nothing from the device, clock, locale or name; a
    round of about `round_seconds`; one result line; the ending or picks kept in named state; no spoilers in the
    share line;
  - `fillLine`;
  - `agreement(a, b)`, the two-player stand-in.
- `prompts.mjs` puts the rules into the plan menu, and `pipeline.mjs` puts `group_play` on the manifest.
- The Studio bundle is rebuilt.

**Catalog:**
- New tools:
  - `chat_round`, `group_round` and `opinion_aggregate`: `planned`;
  - `series_best_of` and `weekly_group_board`: `shipped`;
  - `run_result_state`: `planned`, an engine change.
- `async_turns` is filled in (api, params, events, when to use; still `planned`).
- The 3 dice types' "none" hooks are replaced.
- The daily-puzzle `audience` slot is now `nice`, so it's never asked.

**Tests:**
- Go: 6 new tests (`social_test.go`); the full `go test ./...` is green. Retrieval is unchanged: recall@5 0.94, MRR
  0.86 on 523 cases.
- Node: `test-group-play.mjs` 14/14; `test-context` 50, `test-score` 79 and `test-fuzzy` 90, all passing;
  `test-studio-bundle` passes; `check.mjs` reports 0 errors.

**Real Muse** (6 of Kevin's prompts, about 13 calls):

| # | Prompt | Result |
|---|---|---|
| 6 | car ratings | `opinion_compare`, picks/agreement, `ranked: false`, gap `opinion_aggregate` |
| 18 | tier list | `opinion_compare`, agreement, `ranked: false`, gaps `opinion_aggregate` and `group_round` |
| 17 | king in ≤10 choices | ending compare (King, Secret, Good, Bad), scored on "choices left", after one social repair |
| 15 | F1 | series, best of 3, `time_to_complete` |
| 31 | make 24 | Group round, **0 questions** (it asked 2 before) |
| 11 | Finish the Saying | Group round, no leaked goal |

None of the six goals copied an example. #11 still has no map gap, because no `map` tool is in the catalog yet;
when the other gap agents add `map_pin`, the alias check flags it.

## Requests

**For Max (server), ready to paste:**

> Claude (for Karthik) → Max: group play, the way Karthik wants it. Everyone plays the same single-player game on
> the same seed, whenever they like, in a chat or a Group, and the results compare after. There's no live
> multiplayer. Four asks, in order:
>
> 1. **Store `group_play` from the manifest**, like `score`: `{mode, modes, round_seconds, result: {kind, compare,
>    display, endings?, state?}, share_line, best_of?, same_seed}`. Return it on the game, so the app knows what
>    sending this game starts.
> 2. **Rounds, a same-seed round in a thread or a Group.** The round keeps its own result lines, so it works without
>    server chats:
>    - `POST /v1/rounds {gameId, target: {kind: "chat"|"group", id}, members?: [userId], mode, bestOf?}` →
>      `{round: {id, gameId, seed, length, members, mode, plays: {userId: {score, timeMs, result}}, lines: [{userId,
>      text, at}], winnerId, closesAt, finished}}`. The seed is picked by the server, like series.
>    - `POST /v1/rounds/{id}/plays {log}`: verify the replay like series, keep the replayed score and time, plus
>      `result` (the end state named in `group_play.result.state`, once Artem's verify returns it), and append the
>      line `share_line` filled with `{name}`, `{title}` and `{result}`.
>    - `GET /v1/rounds/{id}` and `GET /v1/rounds?target=…`.
>    - Rank with the game's score model: direction, `counts_when`, `tie_break`. For `compare: "ending"`, rank by the
>      ending's position in `endings`, then the score. For `compare: "agreement"`, there's no winner: return the
>      agreement per pair.
>    - Close when everyone has played, or at `closesAt` (24 h). Moments: `round_started`, `round_played`,
>      `round_finished`.
>    - A series is rounds with `bestOf: 3|5`: a fresh seed per round, and `standing`.
> 3. **Series honors the score model:** `roundOutcome` compares `Score > Score` today, so time trials rank
>    backwards. Use `direction` and `counts_when` from the game's `score`.
> 4. **Agreement for opinion games** (`group_play.result.compare: "agreement"`, `score.ranked: false`):
>    - `GET /v1/games/{id}/agreement?with=<userId>|scope=friends|group&groupId=` →
>      `{agreement: 0-100, items: [{item, mine, group, share}]}`;
>    - built from each player's latest verified picks;
>    - two friends need no aggregate; "vs everyone" needs the per-item tally.
>
> Why: Kevin32 #6 (rate car brands) and #18 (tier list vs everyone) have no right answer. #1 and #17 compare
> endings. Every other game is a score round. The app's sessions, game nights, brackets and best-of-5 all become
> these rounds. Doc: `docs/harness-gaps/group-play.md`.

**For Artem (engine and app), ready to paste:**

> Claude (for Karthik) → Artem: group play. Two asks:
>
> 1. **Engine:** `MicrogameEngine.verify(game, log)` also returns `result: {<name>: value}`, the end values of the
>    state variables named in the manifest's `group_play.result.state`, for example `ending`, `choices_used`,
>    `picks`. The server needs it to compare story endings and opinion picks from the replay, never from the phone's
>    claim. It's deterministic, so there's no replay risk. Catalog id: `run_result_state`.
> 2. **App:** a **send-to-chat-or-Group flow** on the result sheet and the game page.
>    - Read `group_play.mode` to choose what Send starts: a head-to-head, a best of `best_of`, a Group round, or an
>      opinion compare.
>    - Create a server round (Max's `POST /v1/rounds`), and play from the card with the round's seed and length
>      (`BubblePlayRequest` already does this).
>    - Draw the round's `lines` in the thread as the results come in: "Ana: 1:02.4 on Toast Pong. Your turn."
>    - Series: show the standing.
>    - Opinion games: show "% in sync" per friend, never a winner.
>
>    `ChallengeCenter` sessions, game nights, `BestOfFiveOfferSheet` (which uses challenges today) and the bracket
>    (local stand-in) can all move onto rounds and series. Until rounds land, the app can use
>    `POST /v1/series` for one-game head-to-heads.

**For Bayan (gate), ready to paste:**

> Claude (for Karthik) → Bayan: an **`opinion` gate profile** for games whose `group_play.result.compare` is
> `agreement` (rate, rank, tier list):
> - no skill order is expected;
> - bots must finish the run;
> - every prompt must leave a pick in the named state;
> - two bots with different input seeds must not always produce the same picks (otherwise there's nothing to
>   compare).
>
> The score step already skips games with `ranked: false`.

## What's left

- Server rounds, the agreement endpoints and series direction (Max); `verify` returning result state and the send
  flow (Artem); the opinion gate profile (Bayan).
- Once those land: a gold example of an opinion game (picks in state, `ranked: false`) that passes the gate. Today's
  gate expects skill order, so I didn't add one.
- Planner edits other gap agents ask for come to me through the lead.
