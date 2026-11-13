# Speaker notes (draft)

*One block per slide, about 25 s each, so the talk fits 5 minutes with the demo beats. The video voice-over reads these. Keep claims in step with [../narrative.md](../narrative.md).*

## 1
Hi, we're Whims. Make a game on a whim, and play it together, right inside Facebook.

## 2
Short-form is changing. It's becoming something you play, not just watch. LinkedIn says 86% of its daily players come back the next day. NYT puzzles were played over 11 billion times last year, and the Times added a friends tab to make it communal.

## 3
And almost everyone plays: 98% of young Americans play some kind of game. But only a third of young men, and fewer than one in ten young women, call themselves gamers. We're building for everyone else.

## 4
Here's the part that's new: anyone can make one. You say one sentence. Muse agrees with you how it plays, in about 7 seconds. Five bots play it before anyone sees it. On our live server, that took 63 seconds from the sentence to a game your friends can play. Let me show you. [Demo 1]

## 5
Under the hood, four Muse models. Spark understands the request, and we search 1,280 game types to ground it. Ember writes the brief, Wonder writes and builds the game and repairs it, and Image paints the art. Then a five-bot gate decides if it ships. All of it runs on our server; the phone just plays.

## 6
Every game is just JSON, art included. Our Rust engine, compiled to WebAssembly, reads it at runtime and turns it into the game. No build step. And it's deterministic, so the server replays every score to check it.

## 7
We built this as five people, each running our own AI agents, all synced through one Slack channel, a shared board and one CLAUDE.md file. 489 commits in two days. The agents moved fast; the decisions stayed ours.

## 8
Games are also a new signal for the feed. In simulation, our ranker beat today's feed in 70% of sessions, and Group Blend took games everyone in a Group enjoys from under 9% to 32%. [Demo 2]

## 9
And it brings people closer. Meet someone new in a Group? A best of 5 settles it. Put a song behind your game. Challenges and remixes are built on the server and coming to the app next. [Demo 3]

## 10
The point isn't one more endless loop; those keep about 3% of players after a month. It's a ritual you share: a daily game with your Group, a rematch with a friend. A reason to come back to Facebook, together.

## 11
Anyone can make a game. Everyone can play it together. Thank you.
