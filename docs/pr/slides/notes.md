# Speaker notes and timing (draft 10)

*Three acts: why, how, what it does for people. Thesis: people don't grow close by watching the same thing; they grow close by doing something together, or against each other. Blue = competing, violet = collaborating. The budget is 280 s (185 s of talk and 95 s of demo), leaving 20 s of slack. Demo 1 starts on slide 1 and pays off after slide 7, at about 2:10. The video voice-over reads these and ends on the tagline. Claims follow [../narrative.md](../narrative.md); words follow [../STYLE.md](../STYLE.md).*

| Slide | Act | Talk | Demo | Running total |
|---|---|---|---|---|
| 1 Curio | Why | 15 s | Demo 1 starts | 0:15 |
| 2 Together / against → closer | Why | 20 s | | 0:35 |
| 3 The tension | Why | 10 s | | 0:45 |
| 4 Three Reels | Why | 15 s | | 1:00 |
| 5 NYT Games: shared games last | Why | 15 s | | 1:15 |
| 6 Anyone can make one | How | 10 s | (Demo 1 still building) | 1:25 |
| 7 The whole stack | How | 35 s | | 2:00 |
| — | How | | **Demo 1, 40 s:** the finished Curio, play it, post it to a Group | 2:40 |
| 8 Compete → collaborate | What it does | 15 s | **Demo 3, 30 s:** a Group's weekly board → Add friend → best of 5 | 3:25 |
| 9 Play becomes a signal | What it does | 15 s | **Demo 2, 25 s:** scroll the feed, a Curio plays inline with a sound | 4:05 |
| 10 Our AI workflow | Execution | 20 s | | 4:25 |
| 11 The tagline | Close | 15 s | | 4:40 |

**Pre-show checklist (the morning of the demo, on the presenting phone):**
1. Signed in as the presenter's own account, member of the demo Group.
2. Make "dodge the fog over Twin Peaks" once and post it to the demo Group. It's the Demo 1 fallback (after slide 7), so "one I made this morning" is true.
3. The demo Group has a weekly board with at least one person you aren't friends with yet (Demo 3, slide 8).
4. The feed has a Curio with a sound behind it (Demo 2, slide 9).
5. Demo 1 option B (photo → story quiz): one timed dry run on the phone, signed in as `karthik_s` (not a guest). Only use B if it finishes inside 1:50; otherwise use A.
6. Phone awake, Do Not Disturb on, brightness up, cabled to the presenting Mac. Live Video goes on slide 1 (Demo 1 starts), after slide 7 (Demo 1 payoff), on slide 8 (Demo 3, phone frame) and slide 9 (Demo 2).

**Demo 1, option A (default):** say "dodge the fog over Twin Peaks", tap Make, agree the plan.
**Demo 1, option B (only after a timed dry run):** Curios tab → Make → "Add photos or video" (next to "Add sound"; up to 8 photos, 1 video) → optionally "Restyle my photos into the game's look" → type "a Kahoot-style story quiz about this photo" → Make. Uses a photo of the team or the venue; that's slide 4's Reel format, made live. Risks: needs a signed-in account, media builds take noticeably longer, not yet rehearsed.
**Naming:** The Podium and Purr Earth are hand-made story quizzes; call them "the story-quiz format", never "made by Muse".

**Demo 1 fallback:** before the talk, make the same game once ("dodge the fog over Twin Peaks") and post it to the demo Group. If the live build isn't done at 1:50, say "it's still being playtested by the bots, so here's one I made this morning", and open that one. Go back to the live one at the end if there's time.## 1
## 1
People have always gathered around small, strange, delightful things: curios. Muse Curios is a new feature in Facebook that turns a piece of the world into something you can play and share. *(Start Demo 1.)*

## 2
Here's what we believe. People don't grow close by watching the same thing. They grow close by doing something together, or against each other. In one trial, groups of three on a weekly leaderboard walked more than people given support or teamwork: 920 extra steps a day.

## 3
Facebook has the people, but it's lost the reason: teen use fell from 71% to 32%. Meanwhile almost everyone plays games, and few call themselves gamers.

## 4
Short-form is already becoming something you play: a Reel you pause perfectly, a quiz you play along with, a speed test. All three end with "tell me your score" in the comments. A Curio turns that into a real, comparable Group score.

## 5
And the games that last are shared. NYT puzzles went from about 4 billion solves to over 11 billion in three years, and 46 Wordle scores are shared every second. The Times answered with friends leaderboards and a two-player game.

## 6
Here's the new part: anyone can make one. One sentence, and about a minute after you agree the plan, your friends can play it. Mine is building now.

## 7
Here's the whole stack. On the phone: the Make screen and our Rust engine. Everything else is on our server, including the Muse key. Spark reads the idea, we ground it in 1,280 game types, Ember writes the brief, Wonder writes the game, up to three repairs, and five bots play it before anyone else. When you play, the server replays your inputs and keeps only verified scores, because competition only brings people together if it's fair. And what you play teaches the ranker what to show next. Here's mine. *(Demo 1, 40 s.)*

## 8
This is where it brings people closer. A Group's weekly board. "How did you get 44?" Add friend. Settle it in a best of 5. Then make one together. Boards only show Groups you share, seeds are fair, and everything is opt-in. *(Demo 3, 30 s.)*

## 9
And play becomes a signal for the feed: finished runs, rematches, friends added. In simulation, our ranker beat today's feed in 70% of sessions, and Group Blend found games a whole Group enjoys four times as often. *(Demo 2, 25 s.)*

## 10
We built this the way it works: five people, each with our own AI agents, in one channel. The agents fact-checked each other, kept each other in sync, and handed work off when someone was overloaded. 624 commits in 35 hours; the decisions stayed ours.

## 11
Endless loops lose people. A ritual you share brings them back. *(Pause.)* When the world is your muse, how will you create the content of tomorrow? Thank you.
