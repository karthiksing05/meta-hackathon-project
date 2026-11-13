# Speaker notes and timing (draft 13)

*Shape follows the organizers' guidance (2026-11-13): the problem (30–45 s), the demo as one complete journey (about 2.5 min), how Muse powers it (about 45 s), how we built it with AI (about 60 s). Thesis (Karthik): there's no better way to connect than playing a game. Slide numbers match the Keynote deck (29 slides; the live phones are on slides 10 and 11).*

| Slides | Section | Talk | Running total |
|---|---|---|---|
| 1–7 | 01 The problem, ending on the thesis | 55 s | 0:55 |
| 8–12 | 02 The demo, live on Karthik's iPhone (Bayan's phone joins on 11) | 2:30 | 3:25 |
| 13–21 | 03 The AI stack: make, check, rank, learn, and where it lives in Facebook | 2:20 | 5:45 |
| 22–27 | 04 Our process, ending on what the harness taught us | 1:30 | 7:15 |
| 28–29 | Call to action and tagline | 10 s | 7:25 |

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
Curio: something small and delightful. Muse Curios is a new feature in Facebook: tiny games anyone can make, built to bring people together.

## 2
*(Section header: "The problem". Click straight on.)*

## 3
There's no better way to connect than playing a game. It's how families keep up, how strangers break the ice, and how a big, mixed group finds common ground over Monopoly or a deck of cards.

## 4
Facebook still has the people, but young adults have lost their reason to open it: teen use fell from 71% to 31%. And they're the loneliest age group.

## 5
Play is filling that gap: LinkedIn puzzles at work, 11 billion NYT puzzles a year, and new hits like Krillion, made by one person.

## 6
And on Reels, every game ends with "tell me your score" in the comments, where it scrolls away among strangers.

## 7
So here's our thesis. People connect best by playing together. Facebook still has the people, but lost the reason to come back. And play is already everywhere, but the score goes nowhere. So: put the game inside Facebook, played with the people you know and the ones you're about to meet, and let anyone make one with Muse. And a Curio asks so little of you: "beat my score?" needs no catch-up and no small talk. It's the simplest way to spark a connection. Other services are feature-first; Curios are fun-first, and the connection comes with the play.

## 8
*(Section header: "The demo". Click straight on.)*

## 9
A Curio turns that into a real Group score. Here's the journey.

## 10
*(Live, about 1:40.)* I open Facebook and go to Curios: my friends' Curios come first, with their scores. *(Scroll; one plays with its sound.)* I'll make one: "dodge the fog over Twin Peaks". Muse shows me its plan, I agree, and it builds while I keep going. Max challenged our Harry Potter fans Group to beat his 44. *(Play it.)* Here's our weekly board, and someone I haven't met yet, so: Add friend.

## 11
*(Live, about 40 s; Bayan's phone joins.)* And when you meet someone, a best of 5 settles it. Bayan and I play the same Curios on the same seeds, so it's fair. *(Round 1.)* Every Curio is better with someone else.

## 12
*(10 s.)* Brands and creators get one too: this sponsored Curio is in the feed today. *(Back on the phone: the Curio Muse just made is ready; post it to the Group.)*

## 13
*(Section header: "The AI stack".)* How does it all work? Not just Muse making a game: a whole AI stack, built into Facebook.

## 14
Here's the whole stack. Facebook already has the people: friends, Groups, chats. Our stack does four things, all on our server. Make: four Muse models turn one sentence into a Curio, grounded in our catalog of 1,305 game types. Check: code, not an LLM grading itself. Five bots play every Curio, and every frame and every score is replayed before it ships. Rank: Kevin's recommender orders every feed page, and picks Curios a whole Group will enjoy. Learn: every play, replay, challenge and Add friend goes back into the ranker, and a new Curio's bot playtest sets where it starts. And it lives where people already are: the feed, Groups, Messenger, friend requests, notifications, Search, and sponsored Curios for brands.

## 15
First, make. The design problem: your creativity on one side, the format a Group needs on the other. Muse Spark reads the idea, we ground it in 1,300 game types, Muse Wonder plans it with your words as requirements, Muse Image paints it. Personalization nothing else can do.

## 16
Here's one real request, traced: "Brainrot trivia game with Mr. Beast as the host". That's all Kevin typed. Muse Spark reads it: trivia, tap to answer, Mr. Beast, brainrot. Code grounds it in our catalog of 1,305 game types: multiple-choice trivia, with a quiz, a timer bar and a question bank. Muse Wonder plans it: a loud studio game show for a pile of fake cash, points with a speed bonus, and the same 10 of 30 questions for everyone on the same seed. Then Muse Wonder writes 30 original questions. Then code proves it, and the first draft failed: all five bots won in under 17 seconds, so it couldn't be lost. Muse repaired it: the last one to answer loses the cash, three strikes and you're out. Draft 2: two bots lost, three won, scores from 320 to 1,390, and all six score checks passed. 143 seconds in total.

## 17
Then code checks it. Is it playable? Five bots play every game to the end, from a new player to a pro. Each game has a profile, like arcade, puzzle or story, that decides what counts as broken: a bot winning in under 15 seconds, controls that do nothing, a story that never ends. A speed-reading game was built three times on our server and blocked three times, because a bot could win instantly. It never reached anyone's feed. And the Mr. Beast trivia first draft was blocked because nobody could lose; Muse fixed it, and the next draft passed.

## 18
Does it feel right? Difficulty you can feel means skill has to show in the score: the pro beats the regular, who beats the new player, and a bot that does nothing ranks last. If the new player beats the pro, the score measures luck, and the game is blocked. Mashing a button can't win, scores can't be impossible, and every run replays to the same score; the server replays real players too. In Mr. Beast trivia, the pro scored 1,390, the regular 1,200, the new player 320; doing nothing scored 0, and mashing one answer topped out at 480. That spread is what makes you want a rematch.

## 19
Does it look right? Every bot run is replayed and checked every tenth of a second against 29 failure classes. Real cases: a "Wave 1 of 5" banner at 1.48 to 1 contrast, "SCORE" split into "SCOR / E", a timer lost against the moon. Fixes may only change how it looks, then they're proven again. On 45 real builds, unreadable text went from 178 to 2.

## 20
Third, rank. Anyone can make a Curio, so there will be far more Curios than anyone can play, and the feed decides which ones you see. A feed tuned for clicks fills with bait. Ours asks two questions of every page: did it grab you, and did it pay off? Did you finish, replay, save, challenge, add a friend? Pay-off counts two and a half times as much as grab. It learns your taste from 24 features of each Curio's plan, starts a new Curio from its bot playtest instead of from zero, and guards against slop and bait. For a Group, Group Blend scores the chance that everyone enjoys a Curio, and drops any one member would hate. It runs on our server for every feed page. In simulation, with synthetic people, it won 70% of sessions against today's feed, and Group picks that every member enjoys went from 8.7 to 32 percent.

## 21
And fourth, learn. Every Curio is a sensor. A post tells Facebook you looked. A Curio tells it whether you enjoyed it, how good you are and who you played with. In a play: you started it or skipped it, finished, replayed, quit halfway. Between people: a challenge sent, accepted or won, a game played together in a chat, a Curio made together, a remix, and the strongest signal of all, adding a friend from a board. And all of it is scoped: boards only show Groups you share, challenges go to friends only, and everything is opt-in.

## 22
*(Section header: "Our process".)* And how we built it.

## 23
We started with two hours away from Claude: whiteboards and arguments, so the ideas could grow first. Then we treated agents as teammates, with rules: one channel, a canvas where they claim work, CLAUDE.md that every agent reads first. People decide; agents ask. Every draft gets checked by another agent. And we say it as it is.

## 24
Here's what that looks like. Kevin asked for a sound library at 1:26 in the morning, and his agent posted the bid. With Artem's go-ahead, Artem's agent claimed it, researched 178 trending sounds, refused to copy the commercial ones, and asked my agent to merge. I said OK. About 45 minutes of agent work, and 103 credited tracks were live in the app. Three people touched it; agents did the rest.

## 25
The real trick wasn't any one agent. It was keeping five people's agents in sync. Each of us ran our own agents, on our own machines, and they all worked from one shared context: a Slack channel, a canvas that says who's working on what, and a CLAUDE.md file every agent reads first. Every agent reads before it starts, claims its work, posts when it starts and finishes, and asks the owner's agent before touching someone else's code. That's what let the work run in parallel: 462 posts and replies, 478 commits from all five of us, and every one of us pulled in 30 or more times. Nobody, human or agent, lost the thread.

## 26
AI fell short when Muse guessed from one giant prompt, when Muse Image refused franchise names, and when agents stated wrong facts confidently. So we built the harness, retries and budgets, and let code check our work.

## 27
And the harness itself taught us the most. One giant prompt of 137,000 characters missed what people asked for, so now we search the catalog first and send Muse only what the plan picked: must-haves met went from 94 to 98 percent. Muse Image refused franchise names, so we retry once with a plain description, then fall back to drawn art. Muse's own art step undid the verifier's layout fixes, so we keep the verified layout and check again. Wikipedia timed out, so we waited longer and built without it if needed. Parallel steps took a build from 197 to 161 seconds. And people missed unreadable text, so code checks every frame.

## 28
Through Curios, we'll end the awkward first conversation, with someone new or an old friend, create a new kind of short-form media you play, and make everyone a creator. Sending one is its own love language: "I played this and thought of you." So tonight: make a Curio, and send it to someone you want to know better.

## 29
*(Pause.)* When the world is your muse, how will you create the content of tomorrow? Thank you.
