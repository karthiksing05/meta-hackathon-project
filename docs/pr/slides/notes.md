# Speaker notes and timing (draft 6)

*One block per slide. The budget is 295 s (200 s of talk and 95 s of demo), leaving 5 s of slack for slide changes and a slow phone. Demo 1 starts on slide 1 so the game builds while we talk. Planning takes 30–60 s plus the tap to agree, and the build about a minute after that, so it should be ready around 1:40–2:10. It pays off after slide 6, at about 2:00. The video voice-over reads these. Keep claims in step with [../narrative.md](../narrative.md).*

| Slide | Talk | Demo | Running total |
|---|---|---|---|
| 1 | 15 s | Demo 1 starts: say the sentence, tap Make, agree the plan when it appears | 0:15 |
| 2 | 10 s | (the definition) | 0:25 |
| 3 | 25 s | | 0:50 |
| 4 | 20 s | (Demo 1 still building) | 1:10 |
| 5 | 25 s | | 1:35 |
| 6 | 25 s | | 2:00 |
| — | | **Demo 1, 40 s:** the finished Curio, play it, post it to a Group | 2:40 |
| 7 | 20 s | | 3:00 |
| 8 | 20 s | **Demo 2, 25 s:** scroll the feed, a Curio plays inline with a sound; search shows "Make it with Muse" | 3:45 |
| 9 | 20 s | **Demo 3, 30 s:** a Group's weekly board → Add friend → start a best of 5 | 4:35 |
| 10 | 20 s | | 4:55 |

**Pre-show checklist (the morning of the demo, on the presenting phone):**
1. Signed in as the presenter's own account, member of the demo Group.
2. Make "dodge the fog over Twin Peaks" once and post it to the demo Group. It's the Demo 1 fallback, so "one I made this morning" is true.
3. The demo Group has a weekly board with at least one person you aren't friends with yet (Demo 3).
4. The feed has a game with a sound behind it (Demo 2).
5. Phone awake, Do Not Disturb on, brightness up, cabled to the presenting Mac.

**Demo 1 fallback:** before the talk, make the same game once ("dodge the fog over Twin Peaks") and post it to the demo Group. If the live build isn't done at 2:00, say "it's still being playtested by the bots, so here's one I made this morning", and open that one. Go back to the live one at the end if there's time.

## 1
Hi, we're Muse Curios: tiny games anyone makes from an idea with Muse, played with your people, right inside Facebook. *(Say "dodge the fog over Twin Peaks", tap Make, agree the plan.)*

## 2
A curio is something small, rare or curious. A Muse Curio is a tiny game anyone makes from an idea, and plays with their people.

## 3
Short-form is becoming something you play. LinkedIn's daily players come back the next day 86% of the time; NYT puzzles were played 11 billion times last year. And nearly everyone plays, but almost nobody calls themselves a gamer. We build for everyone else.

## 4
What's new: anyone can make one. One sentence; Muse agrees with you how it plays, five bots test it, and about a minute later your friends can play it. Mine is building right now; we'll come back to it.

## 5
Four Muse models. Spark understands the request, grounded in 1,280 game types. Ember writes the brief, Wonder writes, builds and repairs the game, Image paints the art. A five-bot gate decides if it ships. It all runs on our server; the phone just plays.

## 6
Every game is just JSON, art included. Our Rust engine, compiled to WebAssembly, reads it at runtime and turns it into the game: no build step, about one megabyte. It's deterministic, so the server replays every score to check it. And here's the game I started. *(Demo 1, 40 s.)*

## 7
Five of us built this, each running our own AI agents, all synced through one Slack channel, a shared board and one CLAUDE.md. 489 commits in two days. The agents moved fast; the decisions stayed ours.

## 8
Games are a new signal for the feed: finished runs, replays, rematches, friends added from a board. In simulation, our ranker beat today's feed in 70% of sessions, and Group Blend took games everyone in a Group enjoys from under 9% to 32%. *(Demo 2, 25 s.)*

## 9
And it brings people closer. Every Group gets a weekly board; meet someone new on it, and a best of 5 settles it. Challenges, quiz nights and remixes are built on the server and coming to the app next. *(Demo 3, 30 s.)*

## 10
Endless loops lose people: about 3% are still playing a month later. A shared ritual is different: a weekly board with your Group, a rematch with a friend. Anyone can make a Curio. Everyone can play it together. So: When the world is your muse, how will you create the content of tomorrow? Thank you.
