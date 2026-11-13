# Speaker notes and timing (draft 7, Karthik's restructure)

*One idea per slide; everything that isn't on screen is here. The budget is 275 s (180 s of talk and 95 s of demo), leaving 25 s of slack for slide changes and a slow phone. Demo 1 starts on slide 1, so the Curio builds while we talk; planning takes 30–60 s plus the tap to agree, then about a minute to build, so it pays off after slide 6, at about 1:55. The video voice-over reads these and ends on the tagline. Keep claims in step with [../narrative.md](../narrative.md) and words with [../STYLE.md](../STYLE.md).*

| Slide | Rubric | Talk | Demo | Running total |
|---|---|---|---|---|
| 1 Definition | — | 15 s | Demo 1 starts: say the sentence, tap Make, agree the plan | 0:15 |
| 2 Formats | Impact | 20 s | | 0:35 |
| 3 98% | Impact | 10 s | | 0:45 |
| 4 Anyone can make one | Originality | 15 s | (Demo 1 still building) | 1:00 |
| 5 Four models | AI | 25 s | | 1:25 |
| 6 The engine | AI | 20 s | | 1:45 |
| — | Execution | | **Demo 1, 40 s:** the finished Curio, play it, post it to a Group | 2:25 |
| 7 How we built it | Execution | 10 s | | 2:35 |
| 8 70.3% | Impact | 20 s | **Demo 2, 25 s:** scroll the feed, a Curio plays inline with a sound; search shows "Make it with Muse" | 3:20 |
| 9 Meet on the board | Originality | 20 s | **Demo 3, 30 s:** a Group's weekly board → Add friend → start a best of 5 | 4:10 |
| 10 3% | Impact | 15 s | | 4:25 |
| 11 Tagline | — | 10 s | | 4:35 |

**Pre-show checklist (the morning of the demo, on the presenting phone):**
1. Signed in as the presenter's own account, member of the demo Group.
2. Make "dodge the fog over Twin Peaks" once and post it to the demo Group. It's the Demo 1 fallback (after slide 6), so "one I made this morning" is true.
3. The demo Group has a weekly board with at least one person you aren't friends with yet (Demo 3, slide 9).
4. The feed has a Curio with a sound behind it (Demo 2, slide 8).
5. Phone awake, Do Not Disturb on, brightness up, cabled to the presenting Mac. Live Video goes on slide 1 (Demo 1 starts), after slide 6 (Demo 1 payoff), and on slides 8 and 9 (Demos 2 and 3; slide 9 has a phone frame for it).

**Demo 1 fallback:** before the talk, make the same game once ("dodge the fog over Twin Peaks") and post it to the demo Group. If the live build isn't done at 1:55, say "it's still being playtested by the bots, so here's one I made this morning", and open that one. Go back to the live one at the end if there's time.
## 1
A curio is something novel, rare or a little bizarre. We built Muse Curios: tiny games anyone makes with Muse, and plays with their people, right inside Facebook. *(Say "dodge the fog over Twin Peaks", tap Make, agree the plan.)*

## 2
Short-form is becoming something you play. Reels that pause for you to guess. LinkedIn's daily games, where 86% of players come back the next day. NYT puzzles, 11 billion plays last year, now with a friends tab.

## 3
And almost everyone plays: 98% of young Americans. But only 9% of young women call themselves gamers. We build for everyone else.

## 4
Here's the new part: anyone can make one. One sentence; Muse agrees with you how it plays, five bots test it, and about a minute later your friends can play it. Mine is still building.

## 5
Under the hood, four Muse models. Spark reads the request and grounds it in 1,280 game types. Ember writes the brief. Wonder writes the game and repairs it. Image paints the art. Then five bots play every Curio before anyone else does; about three in four pass.

## 6
And every Curio is just JSON. Our Rust engine, compiled to WebAssembly, reads it at runtime: no build step, about a megabyte, the same score on every replay, so the server checks every score. Here's the one I started. *(Demo 1, 40 s.)*

## 7
Five of us built this in two days, each running our own AI agents, all synced through one Slack channel and one CLAUDE.md. The decisions stayed ours.

## 8
Playing is also a new signal for the feed: finished runs, replays, rematches, friends added. In simulation, our ranker beat today's feed in 70% of sessions. *(Demo 2, 25 s.)*

## 9
And it brings people together. Meet someone on your Group's weekly board, add them, and settle it in a best of 5. Challenges and remix are on the server and coming next. *(Demo 3, 30 s.)*

## 10
Why it lasts: endless loops lose people. Only 3% are still playing a month later. A ritual you share, a weekly board, a rematch, keeps them coming back to Facebook.

## 11
When the world is your muse, how will you create the content of tomorrow? Thank you.
