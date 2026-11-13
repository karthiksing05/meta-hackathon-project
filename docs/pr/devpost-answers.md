# Muse Curios: answers to the five Devpost form questions

*Draft for review by Artem and Kevin, written 2026-11-13 by Bayan Bro (Claude, AI agent for Bayan) at Artem's request. Built from `pitch` `eb30ffe`: claims follow [narrative.md](narrative.md), words follow [STYLE.md](STYLE.md), and the facts come from [devpost.md](devpost.md) (Kevin-approved), the deck notes ([slides/notes.md](slides/notes.md)) and [demo/FEATURES.md](demo/FEATURES.md). `devpost.md` is unchanged. Q5 was filled in from `git log`, the Agent Logistics canvas and the channel; each paragraph says **needs OK** until that person approves their own.*

---

## 1. What problem are you solving for young adults, and why is it important to them?

**Young adults are lonely, and the app that holds their friends has lost its reason to be opened.**

Adults aged 19 to 29 report feeling lonely more than any other age group: 27% say they feel very or fairly lonely (Gallup and Meta). Many have just moved: 26.6% of 18-to-24-year-olds moved in a single year, so they're starting over in a new city where they don't know anyone. And the hardest part of connecting is the first step. Texting a friend you haven't talked to in years, or walking up to someone new, feels heavy, and people underestimate how much others would appreciate hearing from them.

Facebook still has the people: friends, Groups and Events, under real names. But it no longer gives young adults a reason to open it. The share of US teens who ever use Facebook fell from 71% in 2014–15 to 31% in 2025 (Pew Research Center).

Meanwhile, play is already doing the job. There's no better way to connect than playing a game: it's how families keep up, how strangers break the ice, and how a big, mixed group finds common ground. Wordle spread through the grid of squares in every group chat. LinkedIn's daily games rank you against your connections and became a conversation starter at work, with 86% of players back the next day and 82% still playing after seven (LinkedIn, company-reported). New York Times puzzles were solved over 11.2 billion times in 2025, and the NYT added a friends tab "to encourage communal play". Almost every young adult plays (98% of Americans aged 13 to 39, YPulse 2026), but only 33% of young men and 9% of young women call themselves gamers. On Instagram, Reels you pause, play along with or race already end with "tell me your score" in the comments, where the score scrolls away among strangers.

So the problem is this: young adults need a low-pressure way to reach the people they know and the people they're about to meet, and Facebook needs a reason for them to come back. A small, shared, slightly competitive game is both.

## 2. Describe your solution/product, and how it solves the problem.

**Muse Curios is a new feature in Facebook: tiny games anyone can make with Meta's Muse from one sentence, built to be played with your friends, Groups and Events.** One game is a Curio.

- **Make.** Type one sentence ("dodge the fog over Twin Peaks"). Muse shows its plan, "How the game works", and asks only about the parts it isn't sure of. You agree, and it builds in the background while you keep scrolling, then tells you your Curio is ready to post. You can also make one from today's photos, or remix someone else's Curio in a sentence, with automatic credit to the original.
- **Play.** The Curios feed is full-screen and snaps like Reels: tap to play, with your friends' Curios and scores first. Everyone who plays a Curio gets the same seed, and the server replays every score's input log, so only fair scores count.
- **Compete, to get closer.** Every Curio has boards for everyone, your friends and your Groups, plus a weekly Group board that resets every week. Next to anyone you don't know yet is **Add friend**, because "how did you get 214?" is an easier first message than "want to be friends?" A new friendship starts with a **best of 5** on the same Curios and seeds. **Challenges** send "beat my 44" to a friend or a whole Group.
- **Play together.** Group rounds and quiz nights (everyone plays the same run in their own time, then compares), **make one together** (a Group adds ideas and Muse builds one Curio that credits every name), sounds from a credited library, and **Group Blend**, which picks Curios the whole Group is likely to enjoy (8.7% → 32% of picks every member enjoyed, *simulated*).
- **Share.** Send a Curio in Messenger, post it to the feed or a Group, or put it on your profile.

**How it solves the problem.** A Curio asks so little of you: "beat my score?" needs no catch-up, no small talk and no right thing to say. That makes it the simplest way to reach an old friend or break the ice with someone new. Most social tools are feature-first and hope the fun follows; Curios are fun-first, and the connection comes with the play. It belongs on Facebook because a game is only as good as the people you play it with, and Facebook is where your friends, Groups and Events already are. Because anyone can make one, the people playing are also the people creating, so there's always a new Curio from someone you know, a friend who just passed your score, and a new week on your Group's board: a reason to come back.

## 3. How does Muse play a key role in your solution?

**Take Muse out and there are no games.** Muse is the creator, not a feature on top. Every Curio a person makes in the app is made by Muse on our server, from a sentence nobody wrote a template for, and Muse writes real rules, not reskins (255 to 1,845 characters of game logic per game in 10 real runs).

Four Muse models share the work, inside a harness we built around them:

1. **Muse Spark** reads the idea: the genre, the controls, the theme and the names the person used.
2. Our code grounds it in a catalog of about 1,300 game types, so Muse gets only what fits instead of one giant prompt.
3. **Muse Wonder** plans the game with the person's words as requirements, shows that plan to the maker for agreement, then writes it from tested building blocks plus rules of its own, and repairs drafts that fail.
4. **Muse Image** paints the art. **Muse Ember** handles quick steps, like a short brief of mood, energy and audience in about 2 s.

Then code proves it before anyone sees it, with three checks: **is it playable** (five bots, from a new player to a pro, play every game to the end), **does it feel right** (skill has to show in the score, and mashing or idling can't win), and **does it look right** (every bot run is replayed and checked every tenth of a second against 29 kinds of visual problem; on 45 real builds, unreadable text went from 178 cases to 2).

**One real request, traced.** Kevin typed "Brainrot trivia game with Mr. Beast as the host." Muse Spark picked out trivia, tap to answer, Mr. Beast and brainrot; the catalog grounded it as multiple-choice trivia with a timer bar and a question bank; Muse Wonder planned a loud studio game show and wrote 30 original questions. The first draft failed, because all five bots won in under 17 seconds. Muse repaired it (the last to answer loses the cash; three strikes and you're out), and the second draft passed, with scores from 320 for the new player to 1,390 for the pro, in 143 seconds start to finish.

Muse also powers the social side: it builds one Curio from a whole Group's ideas, remixes a Curio in a sentence, and makes a Curio about what two people have in common. That's personalization a template can't do, and it's why anyone, not just developers, can make something their friends will play.

## 4. Walk us through your build process and how you leveraged AI in your workflow. Where did AI tools help most, where did it fall short, and how did you adapt?

**Identifying the problem.** We started with research, not code. Bayan's literature review on short games, plus sources we checked as a team, gave us the numbers behind the problem: young adults are the loneliest age group, teen Facebook use fell from 71% to 31%, and shared daily games (Wordle, LinkedIn, NYT Games) bring people back. Agents helped find and summarize sources; we checked every number we kept and list them in one file.

**Brainstorming.** We spent the first two hours away from the agents, on whiteboards, so the ideas could grow before anything got built. The thesis came out of that: there's no better way to connect than playing a game. We kept the decisions human: the name, the tagline, what to cut and what to demo.

**Design.** We designed around one question: who does this bring closer, and through which Facebook surface? That gave us boards scoped to Groups you share, Add friend next to strangers' scores, best of 5 for new friends, async Group play on the same seed, and challenges capped at 20 friends. Agents drafted options and wrote down the decisions and the ideas we rejected (like a global board and auto friend requests).

**Architecture.** Three parts with one contract between them. The **app** is a SwiftUI recreation of the Facebook iPhone app that only shows screens and calls our API. The **server** is a Go API on MongoDB that owns Muse, the Muse key, scores, friends, Groups, challenges and the feed. The **engine**, written in Rust and compiled to about 1 MB of WebAssembly, turns a game's JSON into the finished game at runtime and replays the same seed and inputs to the same score, which is how the server verifies scores.

**Implementation.** Each of us ran our own Claude and Codex agents, and they stayed in sync the way a team does: one Slack channel for updates and handoffs, a shared canvas of who's working on what, and a `CLAUDE.md` file every agent reads first (claim work before you start, hand off in writing, ask the owner before touching their code, never push to `main` without an OK). People decided; agents asked; every draft was checked by another agent. That let the work run in parallel: 462 Slack posts and replies, 478 commits from all five of us. One example: Kevin asked for a sound library at 1:26 a.m., Artem's agent claimed it, researched 178 trending sounds, refused to copy the commercial ones, and asked Karthik's agent to merge; about 45 minutes later, 103 credited tracks were in the app.

**Where AI helped most.** Speed and breadth: a full Facebook-style app, a Go backend, a Rust engine, a catalog of about 1,300 game types with retrieval tests, and a recommender with simulators, all in a weekend. Inside the product, Muse's creativity: it writes rules of its own, so a pun or an inside joke can become a game.

**Where it fell short, and how we adapted.**
- *One giant prompt.* Muse guessed from 137,000 characters and missed what people asked for. We now search the catalog first and send only what the plan picked; must-haves met went from 94% to 98%.
- *Games that passed but weren't fun.* Some drafts could be won by doing nothing. We built the five-bot gate, genre profiles that define "broken" per kind of game, and score checks where skill has to show.
- *Unreadable text.* People and Muse both missed it, so code now checks every frame: 178 cases down to 2 on 45 builds.
- *Muse Image refused some franchise names.* We retry once with a plain description, then fall back to drawn art. Muse's art step also sometimes undid the verifier's layout fixes, so we keep the verified layout and check again.
- *Slow or failing lookups.* Wikipedia lookups timed out, so we wait longer and build without them if needed; running steps in parallel took one build from 197 to 161 seconds.
- *AI judging taste.* In a small blind test of game art with one human judge, Muse's own judge agreed with the person only 44% of the time, so people stay in the loop on what "good" looks like.
- *Agents stating wrong facts confidently.* We made every claim trace to a source or a commit, and had another agent check each draft.

## 5. What were the Individual Contributions and focus areas for each team member?

*From `git log` (on `main` and `pitch`), the Agent Logistics canvas and the channel. Each person: please edit or OK your own paragraph.*

**Karthik Singaravadivelan: product lead, iOS front end, the harness and the pitch.** *(needs OK)* Owns the repo and set the direction: the thesis, the name and tagline, the story arc and the demo. Built most of the app with his agents: the SwiftUI Facebook recreation, the Curios feed and its Reels-style paging, Studio (plan, agree, build in the background, post), remix with credit, make one together, quiz nights and Group rounds, and the friend world the demo runs on. Led harness v2: the catalog search and planner, the verifier and its layout solver, the look kit, and proof that a visual fix leaves the rules and replays unchanged. Wrote the narrative, the demo plan and FEATURES.md, and coordinated the team's agents through the canvas and `CLAUDE.md`.

**Max: backend and Muse on the server.** *(needs OK)* Built and runs the Go API on MongoDB at api.ol4ol.com, including deploys and CI. Put Muse on the server behind the generator, so the key never touches a phone. Built the social backend: scoped leaderboards, the Group weekly board, challenges, best-of-N series with engine-checked scores, rounds and agreement for Group play, user search, saves, notifications with an inbox and APNs sender, sponsored games, and the sound library's server side. Removed the invented demo world from the server so the app reads real data, and audited every route the app calls against what the recommender uses.

**Kevin Harvey: ranking, the game catalog and the Devpost.** *(needs OK)* Built the recommender (`game-recs.js`) and its simulators: it weighs "were you glad you played it" over "did it grab you", beat a standard feed in 70.3% of sessions with a clear winner (*simulated*), and its sibling Group Blend raised picks every member enjoyed from 8.7% to 32% (*simulated*). Wrote 28 families of game types for the ~1,300-type catalog the harness searches, each with retrieval tests. Built the app's notification client and inbox. Wrote and owns the Devpost page.

**Bayan Mardon: authoring layer, playtest gate, research and social features.** *(needs OK)* Wrote the literature review on short games that grounds the problem numbers. Designed the microgame authoring format: fragments (tested building blocks for boards, words, movement, story and social play), the expander that turns them into engine games, and the first authored games. Built the bot playtest gate and its genre profiles (arcade, runner, puzzle, calm, trivia, search, story, opinion) that decide what counts as broken. Ran the Muse art experiments: the style kit, a visual stage that art-directs each game, and the blind test of Muse's art judge. In the app: live Messenger across phones, the Share sheet that sends Curios to friends, chats and Groups, and fixes to the social flows found by testing them end to end.

**Artem Kim: engine, Studio integration, sounds and the pitch.** *(needs OK)* Wrote the game engine in Rust, compiled to WebAssembly: assets, physics, typing, audio and verifiable replays, so the same seed and inputs always give the same score. Brought it into the app and Studio (microgames running on the engine, a gold set of 16 hand-made examples for Muse, verifying runs in WebAssembly). Wired the app to the live server: sign-in, challenges, best of 5, boards, saves and search. Curated the 103-track credited sound library. Built the pitch deck through draft 12, the video storyboard and script, and the two-phone runbook for the live best of 5.

*Slide 22's one-liners, for comparison: Karthik: front end, pitch; Max: backend, Muse; Kevin: ranking, Devpost; Bayan: authoring, Messenger; Artem: engine, Studio.*
