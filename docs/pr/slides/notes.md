# Speaker notes and timing (draft 4)

*One block per slide. The budget is 285 s (190 s of talk and 95 s of demo), leaving 15 s of slack for slide changes and a slow phone. Demo 1 starts on slide 1 so the game builds while we talk. Planning takes 30–60 s plus the tap to agree, and the build about a minute after that, so it should be ready around 1:40–2:10. It pays off after slide 5, at about 1:50. The video voice-over reads these. Keep claims in step with [../narrative.md](../narrative.md).*

| Slide | Talk | Demo | Running total |
|---|---|---|---|
| 1 | 15 s | Demo 1 starts: say the sentence, tap Make, agree the plan when it appears | 0:15 |
| 2 | 25 s | | 0:40 |
| 3 | 20 s | (Demo 1 still building) | 1:00 |
| 4 | 25 s | | 1:25 |
| 5 | 25 s | | 1:50 |
| — | | **Demo 1, 40 s:** the finished game, play it, post it to a Group | 2:30 |
| 6 | 20 s | | 2:50 |
| 7 | 20 s | **Demo 2, 25 s:** scroll the feed, a game plays inline with a sound; search shows "Make it with Muse" | 3:35 |
| 8 | 20 s | **Demo 3, 30 s:** a Group's weekly board → Add friend → start a best of 5 | 4:25 |
| 9 | 20 s | | 4:45 |

**Demo 1 fallback:** before the talk, make the same game once ("dodge the fog over Twin Peaks") and post it to the demo Group. If the live build isn't done at 1:50, say "it's still being playtested by the bots, so here's one I made this morning", and open that one. Go back to the live one at the end if there's time.

## 1
Hi, we're Whims. Make a game on a whim, and play it together, right inside Facebook. *(Say "dodge the fog over Twin Peaks", tap Make, agree the plan.)*

## 2
Short-form is becoming something you play. LinkedIn's daily players come back the next day 86% of the time; NYT puzzles were played 11 billion times last year. And nearly everyone plays, but almost nobody calls themselves a gamer. We build for everyone else.

## 3
What's new: anyone can make one. One sentence; Muse agrees with you how it plays, five bots test it, and about a minute later your friends can play it. Mine is building right now; we'll come back to it.

## 4
Four Muse models. Spark understands the request, grounded in 1,280 game types. Ember writes the brief, Wonder writes, builds and repairs the game, Image paints the art. A five-bot gate decides if it ships. It all runs on our server; the phone just plays.

## 5
Every game is just JSON, art included. Our Rust engine, compiled to WebAssembly, reads it at runtime and turns it into the game: no build step, about one megabyte. It's deterministic, so the server replays every score to check it. And here's the game I started. *(Demo 1, 40 s.)*

## 6
Five of us built this, each running our own AI agents, all synced through one Slack channel, a shared board and one CLAUDE.md. 489 commits in two days. The agents moved fast; the decisions stayed ours.

## 7
Games are a new signal for the feed: finished runs, replays, rematches, friends added from a board. In simulation, our ranker beat today's feed in 70% of sessions, and Group Blend took games everyone in a Group enjoys from under 9% to 32%. *(Demo 2, 25 s.)*

## 8
And it brings people closer. Every Group gets a weekly board; meet someone new on it, and a best of 5 settles it. Challenges, quiz nights and remixes are built on the server and coming to the app next. *(Demo 3, 30 s.)*

## 9
Endless loops lose people: about 3% are still playing a month later. A shared ritual is different: a weekly board with your Group, a rematch with a friend. Anyone can make a game. Everyone can play it together. Thank you.
