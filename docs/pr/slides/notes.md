# Speaker notes and timing (draft 10)

*Story (Karthik, 04:55): people open an app for a reason, a need or a ritual; Facebook has the people but has lost the reason; play is already the icebreaker (LinkedIn, NYT, Reels); a Curio turns "tell me your score" into a real Group score; then how we built it, what it does together, who else it's for, and how we worked. Blue = competing, violet = collaborating. The budget is 275 s (180 s of talk and 95 s of demo), leaving 25 s of slack. Demo 1 starts on slide 1 and pays off after slide 7, at about 2:00. The video voice-over reads these notes.*

| Slide | Act | Talk | Demo | Running total |
|---|---|---|---|---|
| 1 Curio | Why | 15 s | Demo 1 starts | 0:15 |
| 2 A need or a ritual | Why | 15 s | | 0:30 |
| 3 Facebook lost the reason | Why | 15 s | | 0:45 |
| 4 Play became the icebreaker (LinkedIn, NYT) | Why | 15 s | | 1:00 |
| 5 Reels you play | Why | 15 s | | 1:15 |
| 6 Our answer: a real Group score | Our answer | 15 s | (Demo 1 still building) | 1:30 |
| 7 The whole stack | How | 30 s | | 2:00 |
| — | How | | **Demo 1, 40 s:** the finished Curio, play it, post it to a Group. **Demo 2, 25 s:** scroll the feed, a Curio plays inline with a sound | 3:05 |
| 8 Collaboration | What it does | 15 s | **Demo 3, 30 s:** a Group's weekly board → Add friend → best of 5 | 3:50 |
| 9 Creators and brands | Who it's for | 20 s | | 4:10 |
| 10 Our AI workflow | Execution | 15 s | | 4:25 |
| 11 The tagline | Close | 10 s | | 4:35 |

**Pre-show checklist (the morning of the demo, on the presenting phone):**
1. Signed in as the presenter's own account, member of the demo Group.
2. Make "dodge the fog over Twin Peaks" once and post it to the demo Group. It's the Demo 1 fallback (after slide 7), so "one I made this morning" is true.
3. The demo Group has a weekly board with at least one person you aren't friends with yet (Demo 3, slide 8).
4. The feed has a Curio with a sound behind it (Demo 2, right after Demo 1, after slide 7).
5. Demo 1 option B (photo → story quiz): one timed dry run on the phone, signed in as `karthik_s` (not a guest). Only use B if it finishes inside 1:50; otherwise use A.
6. Phone awake, Do Not Disturb on, brightness up, cabled to the presenting Mac. Live Video goes on slide 1 (Demo 1 starts), on a phone-only slide after slide 7 (Demo 1 payoff, then Demo 2), and in the phone frame on slide 8 (Demo 3).

**Demo 1, option A (default):** say "dodge the fog over Twin Peaks", tap Make, agree the plan.
**Demo 1, option B (only after a timed dry run):** Curios tab → Make → "Add photos or video" (next to "Add sound"; up to 8 photos, 1 video) → optionally "Restyle my photos into the game's look" → type "a Kahoot-style story quiz about this photo" → Make. Uses a photo of the team or the venue; that's slide 5's Reel format, made live. Risks: needs a signed-in account, media builds take noticeably longer, not yet rehearsed.
**Naming:** The Podium and Purr Earth are hand-made story quizzes; call them "the story-quiz format", never "made by Muse".

**Demo 1 fallback:** before the talk, make the same game once ("dodge the fog over Twin Peaks") and post it to the demo Group. If the live build isn't done at 1:50, say "it's still being playtested by the bots, so here's one I made this morning", and open that one. Go back to the live one at the end if there's time.

## 1
People have always gathered around small, strange, delightful things: curios. Muse Curios is a new feature in Facebook: an interactive short-form experience with infinite possibility, meant to breed collaboration through friendly competitiveness. *(Start Demo 1: say the sentence, tap Make, agree the plan.)*

## 2
Why do people open an app? For a reason: a need, something you have to do, or a ritual, something you do every day with others watching. Apps spread when they give you one of these again and again. The ones that last give you both, with friends.

## 3
Facebook has the people, but it's lost that reason for people our age: teen use fell from 71% to 32%. And the need is still there: 19-to-29-year-olds are the loneliest age group, and a quarter of 18-to-24s moved last year.

## 4
Play is already filling that gap. At work, LinkedIn's daily puzzles rank you against your colleagues, and they became a conversation starter; 86% come back the next day. NYT Games went from about 4 billion puzzles a year to over 11 billion, and added a friends-only leaderboard.

## 5
And on Reels, short-form is becoming something you play: pause it perfectly, play along, find where you break. Millions of views each, and every one ends the same way: "tell me your score" in the comments.

## 6
So here's our answer. A Curio turns "tell me your score" into a real Group score. It's a ritual you share: same Curio, same seed, one board. It meets a need: a stranger's score next to yours is an introduction. And anyone can make one from a sentence. Mine is building now.

## 7
Under the hood: on the phone, you type an idea, maybe add photos. On our server, which holds the Muse key and all the data, Muse Spark reads it, we ground it in 1,280 game types, Ember writes the brief, Wonder writes the game, up to three repair rounds, and five bots play it before anyone else does. The Rust engine plays the same JSON the same way for everyone, so the server replays every score: competition only brings people together if it's fair. And what you play, finish and rematch joins Facebook's own signals in ranking what you see next. *(Demo 1, 40 s, then Demo 2, 25 s.)*

## 8
This is where it brings people closer. Against: best of 5 when you meet someone, a weekly Group board with Add friend, challenges, quiz nights. Together: Group Blend, sounds, making one together, remixing with credit. Boards only show Groups you share, seeds are fair, everything is opt-in. *(Demo 3, 30 s.)*

## 9
It works for creators and brands too. A creator turns their persona into a Curio their audience plays and ranks on, and "tell me your score" becomes a real board. A brand gets a sponsored Curio in the feed, which is in the app today; a brand challenge a Group plays together is next.

## 10
Here's the part we didn't plan: our agents ended up working the way we want people to, together, and keeping each other honest. One agent reviewed every slide draft against the code and caught our own mistakes. Two sessions answered each other's questions in minutes. And when one of us was swamped, the work moved through one handoff thread and came back ten drafts later. 624 commits in 35 hours, and the decisions stayed ours.

## 11
*(Pause.)* When the world is your muse, how will you create the content of tomorrow? Thank you.
