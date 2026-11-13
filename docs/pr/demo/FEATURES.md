# Features to demo

*What we show on stage and why, ranked by the rubric, with every collaboration feature and the design decisions behind it. Written 2026-11-13 by Claude (AI agent for Karthik) for the team and Karthik's rehearsal. The step-by-step demo is [DEMO_PLAN.md](DEMO_PLAN.md); claims follow [../narrative.md](../narrative.md) and words follow [../STYLE.md](../STYLE.md). App status is read from `origin/main` at `0249943` (05:25 PST) and `backend/README.md` there.*

## What the judges weigh

| Criterion | Weight | What they're looking for |
|---|---|---|
| AI Integration | 30% | "AI does real work and feels like a natural part of the product, not a cosmetic add-on." |
| Product Thinking and User Impact | 25% | "solves a clear young-adult need, fits naturally on Facebook, and gives people a reason to come back." |
| Execution and Demo | 25% | "a working, polished demo... with no unnecessary mockups." |
| Originality and Cohesion | 20% | "a distinct, ambitious idea where every part cohesively supports solving the user problem." |

A judge also told Karthik (2026-11-12, 11:34) to watch the "closer together" and social-network angle: the idea should make the most sense on Facebook. So every feature here answers one question: **who does this bring closer, and through which Facebook surface?**

## The demo features, ranked

Status words: **in the app** (screens on `main`), **on the server** (API only), **proposal** (not built). "In the app" means the code is on `main`; play each one on Karthik's phone before saying it on stage.

| # | Feature | Rubric it hits hardest | Status | Where it shows |
|---|---|---|---|---|
| 1 | **Make a Curio from one sentence** (plan, agree, build, 5-bot check) | AI Integration 30% | in the app | Demo 1 |
| 2 | **Same-seed play, scores replayed on the server** | Execution 25%, Cohesion 20% | in the app | Under every board in Demos 1 and 3 |
| 3 | **Weekly Group board with Add friend** | Product 25% (the need: meeting people) | in the app | Demo 3 |
| 4 | **Best of 5 with a friend** | Product 25% (a reason to come back) | in the app | Demo 3 |
| 5 | **Curios feed that learns from play** and "Make it with Muse" in Search | AI 30%, Product 25% | in the app (ranking numbers simulated) | Demo 2 |
| 6 | **Challenges** (beat my score, friends only) | Product 25% | in the app | Mention in Demo 3 |
| 7 | **Group rounds and quiz nights** (everyone plays the same Curio, results compared) | Cohesion 20% | in the app | Mention in Demo 3 |
| 8 | **Make one together** (a Group adds ideas, Muse builds one Curio) | AI 30%, Originality 20% | in the app | Slide 8; Q&A |
| 9 | **Remix with credit** | Originality 20% | in the app | Slide 8; Q&A |
| 10 | **Group Blend and taste twin** | AI 30% (matching people) | in the app (8.7% → 32% is simulated) | Slide 8 |
| 11 | **Sounds behind a Curio** | Cohesion 20% (fits Reels habits) | in the app | Demo 2, if the feed plays one |
| 12 | **Photos or video in, a Curio about your day out** | AI 30% | in the app (upload needs sign-in) | Demo 1 option B only after a dry run |
| 13 | **Sponsored Curio card** | Product 25% (how Meta earns) | in the app; creator payouts and ad targeting are proposals | Slide 9 |

> **Check before the deck is final:** slide 8 still tags challenges, quiz nights, make one together and remix as "on the server, app next". On `main` these have app screens: rounds and quiz nights since `30b945b` (02:37), make together and named challenge replies since `0abcec3` (03:10), remix since 11-12. Re-tag them "in the app" once each is played through on the phone.

## Each collaboration feature

Blue = competing, violet = collaborating, as on the slides.

### Weekly Group board with Add friend *(blue)*

- **What you see:** your Group's board for the week. Members rank by points across the Group's Curios (10, 7, 5, 3, 2, then 1 per game). Next to anyone you aren't friends with yet is **Add friend**.
- **Who it brings closer:** people who share a Group but haven't met. A stranger's score next to yours is an introduction with a reason.
- **Decisions:** boards only show people in Groups you share, never strangers at large. Research says competition between groups with prizes can divide them, so the board stays scoped and friendly. It resets weekly, so newcomers aren't buried. Only members can see a Group's board.
- **Rejected:** a global board (one-for-everyone puzzles fade, like Wordle's 5.3B → 4.2B plays [83]); friend requests sent automatically after a game.

### Best of 5 *(blue)*

- **What you see:** "Challenge a friend: best of 5". Five quick Curios, the same games and seeds for both of you. You can't see their round score until you've played it.
- **Who it brings closer:** two people who just met. It gives them a reason to message again tomorrow.
- **Decisions:** friends only. Each round is decided by replaying both input logs on the server, so a win can't be faked. A tie goes to the faster run. Hiding the other score until you play keeps it fair.
- **Rejected:** live head-to-head play (see "Async, not live" below).

### Challenges *(blue)*

- **What you see:** "Beat my score", sent to up to 20 friends. Replies come back with names and whether they beat you.
- **Who it brings closer:** friends who drifted. One tap is a low-pressure way to say hi.
- **Decisions:** friends only, capped at 20, and only the person who lost first place hears "someone took first place". That limit is on purpose, after FarmVille's request spam led Facebook to restrict game notifications [39].

### Group rounds and quiz nights *(blue)*

- **What you see:** send a Curio into a chat or a Group. Everyone plays the same run in their own time within 24 hours, and the results line up in the thread ("Dev got the best ending").
- **Who it brings closer:** a whole Group at once, including lurkers, who get an easy role.
- **Decisions:** results can be a score, an **ending** (story Curios), or **agreement** for opinion games, so a Curio with no winner still gives people something to compare ("see how in sync your Group is").

### Make one together *(violet)*

- **What you see:** someone asks a chat or Group for questions, words, scenes or levels. People add entries, and the starter has Muse build one Curio from all of them. Each entry keeps its maker's name.
- **Who it brings closer:** a Group that makes something, not just scores on it. Everyone sees their idea in the game.
- **Decisions:** only the starter presses Make, so a Group can't spam builds. It goes through the same plan, checks and hourly limit as any Curio. Muse is given display names only: no usernames, emails or bios.

### Remix with credit *(violet)*

- **What you see:** **Remix** on a Curio. You change it in a sentence, and the new Curio's caption credits the one it came from.
- **Who it brings closer:** a maker and the people who build on their work, the creator–audience loop from slide 9.
- **Decisions:** a remix is always a new Curio with `remixOf` set, never an edit of someone else's. Credit is automatic, not optional.

### Group Blend and taste twin *(violet)*

- **What you see:** Curios picked so everyone in the Group enjoys them, and a "taste twin": a member of a Group you share who plays what you play, with Add friend.
- **Who it brings closer:** people with the same taste inside a Group you already joined.
- **Decisions:** taste twins come only from shared Groups, the same scope as a board row. It isn't matchmaking, and Dating is out of scope. The 8.7% → 32% gain in Curios every member enjoys is **simulated**.

### Sounds *(violet)*

- **What you see:** a sound playing behind a Curio in the feed, like Reels audio, from a library with credit.
- **Decisions:** a sound never changes a replay or a score. We never copy recorded songs.

### Same seed, replayed scores (under everything)

- **What it is:** everyone plays the same seed, and the server replays each run's input log before a score counts. A Curio a bot can win instantly is stopped at the gate, and one whose score can be gamed ships unranked.
- **Why it matters for closeness:** a stranger's score only starts a conversation if it's fair. Without this, every board above is noise.

## Design decisions that arose

From memory notes, docs and git on `main`. The build tracker's Decisions table on Slack (`F0CHABJV2QL`) timed out, so check it for anything newer.

| When (PST) | Decision | Who | Why |
|---|---|---|---|
| 11-12, 11:45 | **Collaboration first.** Every feature names who it brings closer and through which Facebook surface | Karthik, after judge feedback | Judges score fit with Facebook; a game feature that doesn't bring specific people closer "could be any app" |
| 11-12 | **Real brand, creator and franchise names are kept** as people write them. No photoreal real people, no copied audio | Karthik | People ask for what they love; the line sits at likeness and recordings |
| 11-12, ~22:45 | **Async, not live.** Group play is the same single-player Curio on the same seed, each person in their own time, compared afterwards: head-to-head, best of N, Group round, weekly board or agreement | Karthik | Live multiplayer is an engine gap; same-seed play keeps replays checkable and fits busy schedules |
| 11-12 → 11-13 | **The server owns Muse and every score.** The phone shows screens and plays; replays decide scores | Team (Max, backend) | Fair boards, and the Muse key never leaves the server |
| 11-13, 00:07–03:10 | **Every Curio carries a `group_play` block**: how it's shared and what's compared. Muse plans it with the game | Max (server), Karthik (app) | Even a Curio with no score needs something friends can compare: an ending, picks or agreement |
| 11-13 | **Plan before build.** Muse shows how the Curio will work, part by part; you agree, then it builds | Harness v2 team | The person stays the author; their words are quoted as requirements |
| 11-13, 03:20 | **No viewer donations.** Collaboration between player and creator is remixes, challenges and boards | Karthik | Keeps the feature about people, not payments |
| 11-13, 03:40 | **Name: Muse Curios**, one game is "a Curio"; the app stays Facebook | Karthik | A feature inside Facebook, not a separate app |
| ongoing | **Notifications stay scoped:** challenges to friends only (up to 20), only the former leader hears "you lost first place", a Daily notifies each member once | Team | Facebook's own lesson from game request spam [39] |
| ongoing | **Sponsored Curios only from brand accounts**, which the server decides | Max | A person can't pass their own game off as an ad |

## What not to claim on stage

- **"Live" multiplayer.** Say "same Curio, same seed, in your own time".
- **"Made by Muse"** for anything except Golden S'more, Biscuit's First Day and Root Words. The Podium, Purr Earth, First Things First and One Move are hand-made. Other new Prod games were built by Opus in our harness with Muse Image art.
- **Ranking or Blend numbers without "simulated".** That covers the ranker's 70.3% and Group Blend's 8.7% → 32%.
- **Real-user proof that boards make friends.** We have research direction ([72], [69]) and a pilot plan, not users.
- **Board names.** In the demo world, board rows can be bots playing the real engine. Say so if asked.
- **Lock-screen push.** The inbox works, but push needs an APNs key we haven't verified.
- **Creator payouts, ad targeting, brand challenges in Groups.** These are proposals.
- **"Your people."** Say "your friends", "your Group" or "the people you play with".
