# Speaker notes and timing (draft 3)

*One block per slide. The budget is 300 s: 205 s of talk and 95 s of demo. Demo 1 starts on slide 1, so the game builds while we talk, and it pays off on slide 3. The video voice-over reads these. Keep claims in step with [../narrative.md](../narrative.md).*

| Slide | Talk | Demo | Running total |
|---|---|---|---|
| 1 | 20 s | Demo 1 starts: type the sentence, tap Make | 0:20 |
| 2 | 30 s | | 0:50 |
| 3 | 20 s | **Demo 1, 40 s:** the plan, the game, play it, post it to a Group | 1:50 |
| 4 | 30 s | | 2:20 |
| 5 | 25 s | | 2:45 |
| 6 | 20 s | | 3:05 |
| 7 | 20 s | **Demo 2, 25 s:** scroll the feed, a game plays inline with a sound; search shows "Make it with Muse" | 3:50 |
| 8 | 20 s | **Demo 3, 30 s:** a Group's weekly board → Add friend → start a best of 5 | 4:40 |
| 9 | 20 s | | 5:00 |

## 1
Hi, we're Whims. Make a game on a whim, and play it together, right inside Facebook. *(Type "dodge the fog over Twin Peaks" and tap Make. It builds while we talk.)*

## 2
Short-form is changing: it's becoming something you play. LinkedIn says 86% of its daily players come back the next day; NYT puzzles were played over 11 billion times last year, and the Times added a friends tab. And 98% of young Americans play some kind of game, but only a third of young men, and fewer than one in ten young women, call themselves gamers. We're building for everyone else.

## 3
What's new is that anyone can make one. You say one sentence. Muse agrees with you how it plays, five bots play it, and about a minute later your friends can play it. Here's the one I started a minute ago. *(Demo 1, 40 s.)*

## 4
Under the hood, four Muse models. Spark understands the request, and we search 1,280 game types to ground it. Ember writes the brief, Wonder writes and builds the game and repairs it, and Image paints the art. Then a five-bot gate decides if it ships. All of it runs on our server; the phone just plays.

## 5
Every game is just JSON, art included. Our Rust engine, compiled to WebAssembly, reads it at runtime and turns it into the game. No build step, about one megabyte. And it's deterministic, so the server replays every score to check it.

## 6
Five of us built this, each running our own AI agents, all synced through one Slack channel, a shared board and one CLAUDE.md. 489 commits in two days. The agents moved fast; the decisions stayed ours.

## 7
Games are a new signal for the feed: finished runs, replays, rematches, friends added from a board. In simulation, our ranker beat today's feed in 70% of sessions, and Group Blend took games everyone in a Group enjoys from under 9% to 32%. *(Demo 2, 25 s.)*

## 8
And it brings people closer. Every Group gets a weekly board; meet someone new on it, and a best of 5 settles it. Challenges, quiz nights and remixes are built on the server and coming to the app next. *(Demo 3, 30 s.)*

## 9
It's not a loop to grind; it's a ritual you share. A daily game with your Group, a rematch with a friend. Anyone can make a game. Everyone can play it together. Thank you.
