# The story

*The story spine of the pitch, in Karthik's order, plus the one-liners and the line bank. Part of the pitch docs; start at [README.md](README.md).*

**One line.** Facebook has lost young adults because their friends aren't there, so we built Whims: tiny games anyone makes from one sentence with Meta's Muse models, made to be played together in Groups, Events and chats. Create on a whim, play on a whim.

The spine has seven steps. Each one names the file that backs it. Status is as of commit `6b1cc85` on `main` (see [README.md](README.md#status-at-6b1cc85)).

## 1. The hook: Facebook doesn't appeal to young adults

*The first 15 to 30 seconds, before this, are an opening moment; the options are in [hook.md](hook.md).*

Ask anyone our age why they open Facebook. Most of them don't. Facebook still *reaches* young adults: 69% of US adults aged 18 to 29 use it [52]. But it is the third app in that age group, behind YouTube (95%) and Instagram (79%) [52], and its daily use peaks among people aged 30 to 64 [53]. The next generation is arriving without the habit: teen use fell from 71% in 2014-15 to 32% in 2024 [54].

## 2. Why: our own experience, and the research

**What we see ourselves.** All of our friends are on Instagram. Facebook has no feature that sets it apart for people our age, so there is nothing to pull us back. This is the team's own experience, not data, and we say it that way on stage.

**The network effect, told by a film.** *The Social Network* turns on one idea: people join a network because their friends are on it. (That is our paraphrase of the film's premise, not a quote, and a film is not evidence.) Today the idea runs in reverse for young adults. They don't go to Facebook because their friends aren't there, and their friends aren't there because nobody else is.

**What the research says.**

- **Peers keep people on a network.** In a peer-reviewed survey study of 402 social network users, the number of *peers* on the site was the second-strongest driver of continued use, after enjoyment, and mattered more than the total number of members [131]. (Confidence: high that the finding is as stated, from the abstract; medium on how far it generalizes: one survey, in Taiwan, and the peer effect was significant for women but not for men.)
- **Young adults were the first to step away.** In 2018, 44% of US Facebook users aged 18 to 29 said they had deleted the app from their phone in the past year, against 12% of users 65 and older [132]. (Pew Research Center, a reputable survey; not peer-reviewed. Confidence: high. It is an old figure, from the year of the Cambridge Analytica coverage.)
- **Leaving is rarely clean.** A peer-reviewed CHI 2013 study of Facebook non-use found no clear line between using and not using: people limit, leave and come back, with mixed reasons both for leaving and for keeping some connection [133]. (Confidence: high on the finding, from the abstract and the authors' summary.) That is our opening: young adults keep their accounts, so a reason to come back can work.
- **Facebook knows.** Meta's 10-K says some users, "particularly younger users", use other products "as a substitute" [12], and Meta has announced plans to optimize "the young adult experience" [12].

We do not claim a number we can't source. We have no figure for "share of young adults whose friends are on Facebook".

## 3. So the way back: get everybody on Facebook *together*

Facebook does not need another feed of things to watch. It needs a reason for a whole friend group to show up at once and do the social things that make Facebook *Facebook*: post, comment, join a Group, go to an Event, add a friend. If one person brings their friends, the network effect starts working forward again.

Two ways to seed it (planned, Karthik's decision at 18:00 on Nov 12; nothing below is built):

- **Meta "studio" accounts.** Meta-run accounts that each own one kind of game and post a new one every day: **Daily Word, Party Night, Story Club, Quick Arcade and Group Trivia**. The feed is never empty, and there is always something to play, remix and challenge friends on. The accounts and their games would live in the backend database, not in app code.
- **Games inspired by famous creators.** "What game would MrBeast make?" Real names are allowed (Karthik's call, logged as an exception to our synthetic-people rule for these accounts only). Each game is labeled as *inspired by* the creator ("A Whim inspired by MrBeast"), never as a post *by* them, and its mechanics are original. Starter ideas:
  - MrBeast, "Last One Standing": 100 players, one tap a round, half are out each round; the last one wins a (fake) giant check, and the whole Group sees who lasted.
  - Gordon Ramsay, "Service!": plate 5 dishes before the ticket times out; raw food gets you yelled at.
  - Markiplier, "Don't Look Behind You": a jump-scare survival run with a commentary line every time you flinch.
  - Mark Rober, "Squirrel-Proof": build a 3-part obstacle course, watch a bot squirrel try it, and dare friends to beat your course.
  - More in the team's list (Dude Perfect, Taylor Swift, Bad Bunny, Zach King and others): see [11-roadmap.md](11-roadmap.md#seeding-the-feed-studio-accounts-and-creator-inspired-games).

  The point: a creator's audience plays the game *together*, and that brings them to Facebook. The legal and likeness questions are in [08-qa.md](08-qa.md#creators-names-and-likeness).

## 4. What we designed: short-form content you play *with* people

**This is the part to market hardest: Whims is collaborative.** Short-form video is made to be watched alone. We designed a short-form format made to be shared: a game that takes seconds to start and under a couple of minutes to play, built for people to **collaborate, connect, compete and get excited together**. Every game is played on the same seed by everyone it's sent to, so a score is a fair comparison and a reason to talk. Four ways to play together, each with a named surface:

- **Make together.** Make it together: a chat, a friend or a Group adds a question, words, a scene or a level, and Muse stitches them into one game whose credits name every maker (live on one device).
- **Play together.** One card in a group chat becomes a shared session everyone plays ("3 of 5 played"); a Group's quiz night fills a lobby (live on one device).
- **Compete together.** Challenge Me, Challenge back and a weekly Group board with Most improved (live on one device).
- **Get to know someone new.** Meet someone new, and Whims sets up a **3-game get-to-know-you bracket** for the two of you. *In progress* on branch `fe-qol`, not merged and not built on `main`. The Group Blend's "taste twin" with Add friend is the live first step.

See [06-closer-together-and-engagement.md](06-closer-together-and-engagement.md).

## 5. What we built: Whims

**Low pressure by design. Create on a whim, play on a whim.** Making one takes a sentence. Playing one takes a tap. Losing costs nothing.

- **Meaningful moments, not minutes.** A newcomer in the New in SF Group plays the Group's Daily Whim and lands on the board next to members' names, one tap from Add friend. Guests of the Saturday picnic play an icebreaker made from each other's intros. A run becomes Challenge Me in a group chat. The Group page shows a **Group Blend**: games picked for everyone in it, a Blend game Muse makes for all of them, and a "taste twin" to add as a friend. All of these are in the app on `main`; the other people are synthetic and their runs are bot runs on the same seed. See [03-what-we-built.md](03-what-we-built.md).
- **Our engagement story.** A hand-written, explainable recommender ranks the Whims feed on the phone and on the server. It rewards finished runs, saves, shares and Add friend, and keeps clickbait down for people who don't want it. In a simulation with synthetic people, it won **70.3%** of decided sessions against today's feed (95% CI 68 to 72%) [D27]. That is a simulation, not users, and it *loses* to its own greedy version (47.0%) [D27]. The return loop: a new Daily tomorrow, a friend who passed your score, an Event this weekend, a rematch. See [06](06-closer-together-and-engagement.md#the-engagement-story) and [09-evidence.md](09-evidence.md).

## 6. Why AI is needed: any idea, made playable, made with you

**The bounds are close to limitless, and we can say why.** Muse doesn't pick from a catalog: it writes the game's rules in our engine's rule language (state, inputs, timers, physics, scrolling worlds, typed text, art and sound) and adds custom rules where none exist. In a review of 10 hard test ideas, from a Wordle-style word game to Connections-style grouping, a Queens-style logic puzzle and a crossword, 9 fit the format today (D32). What the engine can't do yet is a short, named list, and it is our roadmap, not a hedge: a game-defined share grid, segment collision, joints, rotated shapes, device sensors (tilt and gyro), live multiplayer and 3D. When a request needs one of those, Muse says so on the anatomy card ("New to Muse") instead of quietly building something else.

A template can reskin a game. It can't turn "a Wordle about our Group" or "dodge the fog over Twin Peaks, but gravity flips every tap" into a game that plays the way the person meant. Muse can:

- **It builds new mechanics.** Muse writes a full game for our Rust/WASM engine, with custom rules (255 to 1,845 characters of game logic per game in 10 real runs [D31]), then validates it, repairs it and has 5 bots play it before anyone sees it.
- **It agrees the game with you first.** Before the build, Muse lays out "How the game works" part by part (loop, rules, how it ends) and marks each part **Known**, **Approximate** or **New to Muse**, so it flags what it hasn't built before. After the build, "Change the game" maps your words onto those parts. A draft takes 4 to 7 s on the fast model [D33].
- **We measure it.** On 12 requests with real Muse, every request produced a game that passed the gate, with 88% of must-haves present, at a median of 99 s per game [D30]. Muse judged its own games, the judge varies by about 10 points, and franchise themes scored 0.5 of 2 in that run. The newer anatomy mode is not scored yet. See [04-why-ai.md](04-why-ai.md).

## 7. Why Facebook is needed: the people and the places

The game is only as good as who you play it with, and only Facebook has that: **Groups** with members and posts, **Events** with guest lists, **friends** under everyday names, **Messenger** group chats and a **feed** where friends already look. Remove Groups and the Daily and the Group Blend go; remove Events and the icebreaker goes; remove the friend graph and Challenge Me has no one to send to. See [05-why-facebook.md](05-why-facebook.md).

---

## One-liners and the line bank

**Lead line (K):** People are brought closer together through friendly competition.

**Product one-liner:** Tiny games your people make with Muse, inside Facebook.

Alternates:

1. **(K)** An interactive platform where anyone can quickly create, build and scroll through games in a feed, powered by the Muse models.
2. **(K)** A space where people express themselves and share that expression with others through Facebook.
3. Describe a game in a sentence and Muse builds it, for a Group, an Event or everyone. (The in-app copy says "Describe a game and Muse makes it in about a minute." That fits neither path: a ready-formula game takes a median of 28 s and a game made from scratch a median of 99 s. See [open-items.md](open-items.md#proposed-app-fixes).)
4. Create on a whim, play on a whim.
5. Facebook lost young adults because their friends left. Whims gives a whole friend group a reason to come back together.

"Whims" is the name for now; check the build tracker before writing new user-facing copy.

**The 45-second version (from the earlier draft; kept).** For the project page, or the opening if the slot is cut short. Read aloud, it runs about 45 seconds.

> Think of a sentence. Any sentence. "A cable car race up Nob Hill where the fog keeps moving the finish line." "Your roommate's cat, running for mayor." "The group chat, as a heist."
>
> Now press one button. About thirty seconds later, that sentence is a game. Nobody has ever played it, because a minute ago it didn't exist. Muse wrote the rules, built the world, sent bots through it to make sure it works, and painted its cover.
>
> Send it to your people. Priya beats your score before you've put your phone down. Theo remixes it so the fog is now lava. By tonight there are four versions and a rivalry.
>
> Every Group wakes up to a new game every morning. Every Event gets its own game night. Every inside joke can become something your friends play. There's no catalog to run out of, because the catalog is everything you and your people can imagine.
>
> Facebook already knows who your people are. Now it can give them something to play together: made from one sentence, any sentence, as many as you want.

*What's real in it, at `6b1cc85`.* "About thirty seconds" is true only for a ready-formula game: a median of 28.0 s over 10 real Muse runs, each bot-tested (D2, D5). A game made from scratch on the microgame engine took a median of 99 s in the harness baseline (D30), so for the cable car or the heist say "a minute or two". Challenge Me, group-chat play, quiz night and remixing are in the app, with synthetic friends whose runs are bots on the same seed; nothing crosses phones yet. "Every Group wakes up to a new game every morning" is the design: the in-app Daily is a hand-made seed, and making a Daily from posts runs only through the CLI or a debug launch. The sample sentences, the lava remix and "four versions by tonight" are illustrations, not data. On "any idea": Muse now writes new mechanics, and 9 of 10 test ideas (Wordle-style, Connections-style and others) fit the format, but none of those 9 has been built and played, and calm or puzzle games are blocked by a gate that expects a run to be losable (D32). Say it big and true: "if you can describe it in 2D, Muse can write it", then name the short list of engine gaps as what's next ([04-why-ai.md](04-why-ai.md#3-what-we-measured-and-how-much-to-trust-it)).

#### Line bank

Every line we have, for slides, voice-over and the project page. Lines are for us to say; where a line came from a teammate, it is a paraphrase.

| Line | Use it for | VP | Source |
|---|---|---|---|
| **(K)** People are brought closer together through friendly competition. | Headline; the board and rematch beats | VP-04, VP-14, VP-16 | Slack, Nov 12 11:36 |
| **(K)** Young adults want a reason to clock in. | Insight | VP-06 | Slack, Nov 12 11:36 |
| **(K)** There's no reason to redo Instagram. | Insight: we add what only Facebook's Groups and Events can do | VP-01 (section 3.3) | Slack, Nov 12 11:36 |
| **(K)** Interactivity gives people a new lens to tell their stories. | Stories beat | VP-09 | Slack, Nov 12 11:36 |
| **(K)** As much variety as Reels, because AI keeps creation unlimited. | "What goes into a game?" | VP-39, VP-34 | Slack, Nov 12 11:36 |
| **(K)** Saves are the likes: people leave a game to save it, but won't leave a game to like it. | Feed signals; Q&A on metrics | VP-10 | Slack, Nov 12 11:01; Build tracker "Decisions" |
| **(K)** Making a game and playing one should both be seamless. | Studio beat | VP-05, VP-13 | Brainstorm canvas, "Scroll Games" |
| **(K)** Scrolling games should feel like scrolling videos. | Feed beat | VP-39 | Engine-design chat, Nov 12 07:25; Build tracker |
| **(K)** Every game looks like itself inside the same frame, like TikTok. | Look and brand | VP-37, VP-39 | Nov 12 08:34; Build tracker |
| If you can say it, your friends can play it. | Slides; the opening | VP-05 | Earlier draft of this doc |
| A game nobody has ever played, in about 30 seconds. | Slides; the Muse beat | VP-05 | Earlier draft of this doc; D2 |
| The only limit is what your group chat can dream up. | Slides; the close | VP-15, VP-38 | Earlier draft of this doc |
| Two people, one game made from both of you. | The Blends beat | VP-40 | New for Blends, Nov 12 |
| That's Facebook bringing people closer together, one tiny game at a time. | Alternate closing line | VP-25, VP-03 | Earlier pitch draft (close) |
| Young adults have no reason to open Facebook, so the feature has to give them one. | Problem framing | VP-26, VP-06 | Problem canvas |
| None of the viral one-off games use your friends as content. Facebook has your friends, Groups and Events. | Why Facebook | VP-01 | Slack, Nov 11 19:42; Taxonomy canvas §5, §8 |
| Remove Muse and nothing gets made: no briefs, no anatomy, no games, no daily content, no covers. | AI test | VP-34 | docs/BUBBLES.md §1 |
| A standalone app has none of these: Groups, Events, the friend graph, Stories, Reels, Messenger. | Why Facebook (chats in the app are the clone's Messenger, with synthetic friends) | VP-08, VP-28 | docs/BUBBLES.md §1 |
| A new Daily Whim every day, streaks, and friends beating your score. | Reason to come back | VP-06 | docs/BUBBLES.md §1 |
| Walk into the picnic already knowing three people's names. | Event icebreaker | VP-03 | docs/BUBBLES.md §1 |
| The Group leaderboard puts names to faces before you meet. | Daily Whim and board | VP-04 | docs/BUBBLES.md §1 |
| Muse writes the brief, composes the game from our library, writes the small custom code, playtests it and paints the cover. | AI beat in one sentence | VP-34 | docs/BUBBLES.md §1 |
| Every bubble is playtested before anyone pops in. | Old Studio loading copy, from before the rename; say "Every Whim is playtested before anyone plays it" | VP-05, VP-18 | StudioComposeStep.swift |
| The same game for everyone in the group today. | Daily Whim | VP-02, VP-16 | StudioAskStep.swift, StudioFloatStep.swift |
| Replays you can take over. | Bursts | VP-13 | BubbleBurstReelLayer.swift |
| The feed ranks for friendships made, not just time spent. | Recommender (in the app on `main`; Add friend and shares are in its reward) | VP-10 | Slack, Nov 12 11:37 (Kevin's agent) |
| A non-designer never has to pick a gravity value. | Creation is easy | VP-05 | Taxonomy canvas §9 part 3 |
| Muse can't set gravity to an unplayable value. | Safe composition | VP-34 | Concept library canvas §3 |
| Most hits are an older game with one twist applied. | Originality | VP-37 | Taxonomy canvas §9 part 4 |
| The library grows from what people actually make. | A system that compounds | VP-34 | Concept library canvas §6 |
| Tomorrow's Daily Whim is the reason to come back. | Close | VP-06 | Build tracker "Demo" step 5 |
| Why this belongs on Facebook and nowhere else. | Framing of this whole document | VP-01 (section 3) | Slack, Nov 12 11:49 |
| Warm competition words: "your move", "beat my 34", "rematch", "You and Maya: 12 games together". | Copy on challenge and board screens | VP-04, VP-14 | Brand ideas, Nov 12 11:52 |
| Create on a whim, play on a whim. | Tagline; the "what we built" beat | VP-05, VP-06 | Karthik, Nov 12 |
| Short-form content you play with people, not just watch. | What we designed | VP-39, VP-25 | Karthik, Nov 12 |
| Muse tells you which parts of your game are new to it. | The AI beat | VP-34 | docs/BUBBLES.md 7.13 |
| What game would MrBeast make? (planned; inspired-by label) | Seeding the feed | VP-41 | Karthik, Nov 12 18:00 |
| If you can describe it, it can be a game: Muse writes the rules, not picks a template. 9 of 10 hard ideas fit today, and the rest is a named list we're building. | The "limitless" beat (why AI) | VP-34, VP-42 | Karthik, Nov 12 (bus notes); D32 |
| Games are better with people, so we made games you make, play and meet people through, together. | Marketing the collaboration | VP-38, VP-15, VP-40 | Karthik, Nov 12 (bus notes) |
