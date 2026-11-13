# Narrative: the one source for the slides, the Devpost page and the video

*Karthik's eight points (2026-11-13, 02:35 PST, via Claude for Karthik), each with the claims we make, the numbers and where they come from. Change a claim here first, then in the slides (`slides/`), `devpost.md` and the video script. Numbers in [brackets] are entries in [sources.md](sources.md); D-numbers are rows in [09-evidence.md](09-evidence.md). "Simulated" means simulated people, and we say so every time.*

**Name:** "Muse Curios"; one game is "a Curio" (Karthik's decision, 2026-11-13). **Tagline:** "When the world is your muse, how will you create the content of tomorrow?" Rules in [STYLE.md](STYLE.md).

## Story arc (Karthik, 2026-11-13, ~04:55 PST; replaces the 04:15 arc)

**Definition (sense 2, Karthik's words):** "an interactive short-form experience with infinite possibility, meant to breed collaboration through friendly competitiveness".

**The logic:** people open an app for a reason, a need or a ritual; virality comes from doing something ritualistically and consistently, or from a real need. Facebook has the people but has lost that reason for young adults. Play is already answering it: LinkedIn's games became a conversation starter at work, NYT Games grew by sharing, and Reels end with "tell me your score". A Curio turns that comment into a real, comparable Group score: a ritual you share and a need it meets (meeting people). The intro paints that picture; the rest shows how we built it.

**Visual motif:** blue = competing (boards, best of 5, challenges, quiz nights); violet = collaborating (Group Blend, sounds, making together, remix).

- **Why.** 1 Curio (definition + wordmark). 2 A need or a ritual (Duolingo 7-day streak 3.6× [114]; Wordle revived a family chat [88]). 3 Facebook has the people, but has lost the reason: teens 71% → 32% [54]; the need: 19–29 the loneliest at 27% [60], 26.6% of 18–24s moved [63]. 4 At work, play became the icebreaker: LinkedIn ranks you against connections, colleagues and alumni [81] (Fortune 2024), 86% next day [79]; NYT ~4B → 8B+ → 11.2B+ puzzles, 46 Wordle scores shared a second, a friends-only leaderboard. 5 Reels A/B/C all end with "tell me your score".
- **Our answer.** 6 A Curio turns "tell me your score" into a real Group score; anyone can make one (every Instant Game was made by a developer [34][35]).
- **How.** 7 The whole stack, phone vs server (Make / Play / Learn); same seed + server replay = fair competition; Curio signals plus Facebook signals feed the ranker (70.3%, simulated). Demo 1, then Demo 2.
- **What it does.** 8 Collaboration: against (best of 5, weekly board + Add friend, challenges, quiz nights) and together (Group Blend, sounds, make together, remix), each with its status. Demo 3. 9 Creators and brands: a sponsored Curio card is in the app (`main` 584ea69); brand challenges in Groups, creator payouts and ad targeting are proposals.
- **How we worked.** 10 Five people, their AI agents, one channel: three agent-to-agent case studies; 624 commits in 35 hours, 87% co-written.
- **Close.** 11 The tagline, alone.

## 1. The next form of short-form content

Interactive mini-experiences keep people in their apps, and the industry is moving that way.

| Claim | Number | Source |
|---|---|---|
| LinkedIn's daily games bring people back | "86% of players returning the next day and 82% still playing after seven" (company-reported) | [79] (LinkedIn Newsroom, 2026-06-08). **We use this pair everywhere.** Bayan's review quotes an earlier 84% / 80% (Nicholas Pezarro); [79] is the newer primary source |
| NYT Games is a habit at scale | Puzzles played over 11.2 billion times in 2025 | [82] |
| The NYT is moving to play *together* | A friends tab "to encourage communal play"; its first 2-player game (Jan 2026) | [84], [82] |
| One puzzle for the whole world fades | Wordle: 5.3B plays in 2024 → 4.2B in 2025 | [83] |
| Meta is already moving to interactive formats | Instagram has 3B monthly users | [115]. Slide 2 shows our drawings (not screenshots) of the two Reel formats Karthik named: "guess what they say" (the video pauses, four answers, then the reveal) and "place your finger here". No stat on those formats themselves yet; cite one only if a solid source turns up. Threads games [116] is backup for Q&A |
| Social mini-games work at huge scale | WeChat Mini Games passed 500M monthly users | [91] |

*Open:* a cited stat for Instagram's interactive formats (polls, quizzes, stickers). Bayan's review doesn't have one.

**Don't claim spillover.** The review finds games build a daily habit and retention, but not that they send people to the rest of the app (NYT news reading went 15.3% → 22.4% → 16% around a first NYT Games visit; Datos). We pitch coming back (point 8), not traffic. How *making* a game affects engagement is an open question in the research, and that's exactly our new part.

**Reference pack (Karthik's lead session, 2026-11-13):**
- NYT Games: 11.2B+ puzzles solved in 2025, up from ~4B in 2022 and 8B+ in 2023 [135][82]; 46 Wordle scores shared every second (2025 average) and the top Connections puzzle shared 3M times [135]; 10M+ daily players [136]; subscribers spend more time in Games than in the news app (YipitData, via AP [82]); a friends-only leaderboard (up to 100 friends, no global board) [137] and the first 2-player game, Crossplay [82]. Jonathan Knight: "We're not trying to get you in the app all day." [82]. Don't use "more than half of weekly users play more than one puzzle a day" (search summary only).
- Three Reels [138]: A "Pause it perfectly" (@veefriends, 7.5 s, 4.2M views, one timed tap); B a "play along" quiz (@thefictionexpert, ~640K likes; don't describe its mechanics); C "At what speed will you break?" (@neravik.games, 137 s, 2.29M views, a speed-reading ramp). All three end with "tell me your score" in the comments. **Line:** "A Curio turns 'tell me your score' in the comments into a real, comparable Group score."
- Story quiz: The Podium and Purr Earth are hand-made with the story-quiz fragment; never "made by Muse". Root Words is made by Muse.

**The same formats, made by Muse** (slide 5; on Prod, owned by `brainy_studio`, made through the real `POST /v1/generate` pipeline with no hand edits): Golden S'more (`aceba181c0fd7fa0b19e60c1`, Reel A's timed tap) and Biscuit's First Day as a Waiter (`ed793361a7b4f6fce5a0c5b7`, Reel B's play-along quiz). Reel C (a "report your breaking point" ramp) could not be built: all 3 Muse runs failed because our bot gate can't test a self-reported score. Never claim a Muse Curio for C. The Podium, Purr Earth, First Things First and One Move are hand-made, and other new Prod games were built by Opus in our harness with Muse Image art; none of those are "made by Muse". Root Words is Muse-made.

## 2. Anyone can make one

The friction is gone: everyone can make and share a game, not just developers.

- **Everyone plays; few call themselves gamers** (Bayan's review, `research/short-games-lit-review.md`): 98% of US 13–39-year-olds play some kind of game (YPulse, 2026); 75% of Gen Z play on mobile (GWI, 2026); 79% of Gen Z play with friends (ESA, 2025); only 33% of young men and 9% of young women say "gamer" describes them (Pew, 2015).

- **About a minute to build once the plan is agreed**, with **5 bots** playing it before anyone sees it. (A run on the live server took 63 s, and Muse agreed how it works in 7 s, but that was before harness v2 planning was on by default; planning adds about 30–60 s. Re-time one live run before quoting seconds. The demo shows the real time on stage.)
- Facebook's Instant Games proved no-install games work at Facebook's scale: over 20 billion sessions by December 2018 [34]. But every one of those games was made by a developer (nearly 200 titles at the 2018 opening [35]). Muse removes that bottleneck.
- You make it by describing it in one sentence. Muse shows you how it will work, part by part, before it builds.

## 3. The AI stack, and how we built it

| Model | What it does |
|---|---|
| Muse Spark | Understands the request |
| Muse Ember | Writes the brief: mood, energy, competitiveness, audience, in about 2 s (D4) |
| Muse Wonder | Writes the game spec, composes the game with tool calls, writes its content and repairs failed drafts |
| Muse Image | Paints the art (7 of Kevin's games on Prod have Muse Image art) |

**The harness**, the part that took the most work: Spark understands the request → retrieval over **1,280 game types** (top-5 recall **0.94** on 523 test requests) → lookup → Wonder writes the spec → compose → up to **3 repair rounds** → a **5-bot gate** → a score check. The gate passes about 75% of games; we don't hide the rest.

**Server and client:** the server owns Muse and all the data: making a game, playtesting, ranking, scores, saves, challenges and Groups. The Muse key never leaves the server. The app only shows screens, runs the engine and calls the API. Scores are verified: the server replays each input log, and only the replayed score counts. Everyone gets the same seed.

## 4. How we worked with AI

Our agents (several per person, Claude and Codex) stayed in sync through one Slack channel, a shared canvas of who's working on what, and a `CLAUDE.md` every agent reads first, all under one design philosophy. We still relied on our own judgment and our own memory of how things work.

- **624** commits on `main` in 35 hours (Wed 6 pm to Fri 4 am PST), **541** of them credit Claude or Codex (87%); slide 10 charts commits per hour. Counted from git at 04:30 PST on 2026-11-13; recount before the final export.

## 5. The engine (emphasize)

Every game is JSON, assets included. Our Rust engine, compiled to WebAssembly, parses it at runtime and turns it straight into the finished game. There's no build step and no code to install.

- Muse writes real rules, not reskins: 255 to 1,845 characters of game logic per game in 10 real runs (D31).
- Deterministic: the same input log replays to the same score, which is how the server verifies scores.
- Small: 1,092 KiB of WebAssembly, 389 KiB gzipped (`engine/README.md`). Say "about 1 MB".
- Expressive: 9 of 10 hard test ideas (Wordle-style, Connections, Queens, a crossword…) fit the format (D32).

## 6. Ranking subplot

Games are a new signal for the feed, like any other media engagement: what you play, finish, replay and share shapes what you see next. The new data: finished runs, replays, rematches, challenges sent, friends added from a board. Where it shows up: Groups, Search and the feed.

- The ranker runs on the server, unchanged from Kevin's JS. In simulation it beat today's feed in **70.3%** of sessions (68–72%). *Simulated.*
- **Group Blend:** games every member enjoys went from **8.7% to 32%**. *Simulated.*
- It ties into Facebook: Groups, Search ("Make it with Muse" when nothing matches) and the infinite-scroll feed.

## 7. Collaboration

- **Best of 5** ("the five-game showdown") every time you meet someone new: wired in the app.
- **Group weekly boards:** in the app (`GroupWeeklyBoardView`), with Add friend next to people you don't know.
- **Challenges** to your Groups and friends, **quiz nights** and **making a game together**: built on the server. Group play is async: everyone plays the same seed in their own time, then compares. Never say "live". *The app still shows "Not available yet" for these; say so if asked.*
- **Remix:** the server records `remixOf`. Say plainly which steps aren't in the app yet.
- **Sounds:** pick a sound to play behind a game, like Reels audio (CC-BY library with credit).

## 8. The broad goal

This isn't about one prompt. It's about making Facebook cool again, togetherness, a reason to log on again and again, and rituals that fit into people's schedules.

- People come back for rituals, and the ones that last are shared (LinkedIn [79]; the NYT friends tab [84]).
- Endless loops lose people: hyper-casual games keep about 3% of players at day 30, against 8–11% for sports, racing and tabletop (Appodeal, 2025). Wordle's one-a-day limit is what made it a habit.
- Games are social: 89% of Gen Z say games can help them make new friends (ESA, 2025). Comparing scores predicts continued play (Esteves et al., 2021).
- Interactivity creates value between creators and viewers: creators get something to show, and viewers get something to give back (a score, a remix, a challenge). Karthik's words were "viewers can donate to creators"; tipping isn't built, so it's his call whether to add it as a labeled "next".

## Careful with

- "Changing a game" (revise) failed on Prod before `279283a`, and one revise took 221 s. Don't claim "about 18 seconds for each refinement" until it's checked on Prod.
- Messenger, Feed posts, Stories and Reels in the app still run on mock data.
- Generated games have no covers. The Daily isn't built, so the close says "a weekly board with your Group", not "a daily game". The live DB is nearly empty, so the demo needs seeded games.
- Lock-screen push isn't verified (no APNs key yet). The notifications inbox works.
