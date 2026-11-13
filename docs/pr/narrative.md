# Narrative: the one source for the slides, the Devpost page and the video

*Karthik's eight points (2026-11-13, 02:35 PST, via Claude for Karthik), each with the claims we make, the numbers and where they come from. Change a claim here first, then in the slides (`slides/`), `devpost.md` and the video script. Numbers in [brackets] are entries in [sources.md](sources.md); D-numbers are rows in [09-evidence.md](09-evidence.md). "Simulated" means simulated people, and we say so every time.*

**Name:** "Whims", for now. Ask Karthik before the final export.

## 1. The next form of short-form content

Interactive mini-experiences keep people in their apps, and the industry is moving that way.

| Claim | Number | Source |
|---|---|---|
| LinkedIn's daily games bring people back | "86% of players returning the next day and 82% still playing after seven" (company-reported) | [79] |
| NYT Games is a habit at scale | Puzzles played over 11.2 billion times in 2025 | [82] |
| The NYT is moving to play *together* | A friends tab "to encourage communal play"; its first 2-player game (Jan 2026) | [84], [82] |
| One puzzle for the whole world fades | Wordle: 5.3B plays in 2024 → 4.2B in 2025 | [83] |
| Meta is already moving to interactive formats | Instagram has 3B monthly users; Meta is building games into Threads chats | [115], [116] |
| Social mini-games work at huge scale | WeChat Mini Games passed 500M monthly users | [91] |

*Open:* a cited stat for Instagram's interactive formats (polls, quizzes, stickers) specifically. Bayan's literature review may have one.

## 2. Anyone can make one

The friction is gone: everyone can make and share a game, not just developers.

- A game was made on the live server in **63 s**. Muse agreed how it works in **7 s**, and **5 bots** played it before anyone saw it.
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

*Numbers to add:* commits, agents, branches, handoffs (count from git and Slack before the final export).

## 5. The engine (emphasize)

Every game is JSON, assets included. Our Rust engine, compiled to WebAssembly, parses it at runtime and turns it straight into the finished game. There's no build step and no code to install.

- Muse writes real rules, not reskins: 255 to 1,845 characters of game logic per game in 10 real runs (D31).
- Deterministic: the same input log replays to the same score, which is how the server verifies scores.
- Small: the engine adds about 1.5 MB, and 8 to 15 ms to the first microgame (03-what-we-built).
- Expressive: 9 of 10 hard test ideas (Wordle-style, Connections, Queens, a crossword…) fit the format (D32).

## 6. Ranking subplot

Games are a new signal for the feed, like any other media engagement: what you play, finish, replay and share shapes what you see next.

- The ranker runs on the server, unchanged from Kevin's JS. In simulation it beat today's feed in **70.3%** of sessions (68–72%). *Simulated.*
- **Group Blend:** games every member enjoys went from **8.7% to 32%**. *Simulated.*
- It ties into Facebook: Groups, Search ("Make it with Muse" when nothing matches) and the infinite-scroll feed.

## 7. Collaboration

- **Best of 5** ("the five-game showdown") every time you meet someone new: wired in the app.
- **Challenges** to your Groups and friends, **Group weekly boards**, **quiz nights** and **making a game together**: built on the server. *The app still shows "Not available yet" for these; say so if asked.*
- **Remix:** the server records `remixOf`. Say plainly which steps aren't in the app yet.
- **Sounds:** pick a sound to play behind a game, like Reels audio (CC-BY library with credit).

## 8. The broad goal

This isn't about one prompt. It's about making Facebook cool again, togetherness, a reason to log on again and again, and rituals that fit into people's schedules.

- People come back for rituals, and the ones that last are shared (LinkedIn [79]; the NYT friends tab [84]).
- Interactivity creates value between creators and viewers: creators get something to show, and viewers get something to give back (a score, a remix, a challenge).

## Careful with

- "Changing a game" (revise) failed on Prod before `279283a`, and one revise took 221 s. Don't claim "about 18 seconds for each refinement" until it's checked on Prod.
- Messenger, Feed posts, Stories and Reels in the app still run on mock data.
- Generated games have no covers. The Daily isn't built. The live DB is nearly empty, so the demo needs seeded games.
- Lock-screen push isn't verified (no APNs key yet). The notifications inbox works.
