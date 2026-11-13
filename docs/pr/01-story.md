# The story

*The story spine of the pitch, the one-liners and the line bank. Part of the pitch docs; start at [README.md](README.md).*

### 5.1 The one-liner and the line bank

**Lead line (K):** People are brought closer together through friendly competition.

**Product one-liner:** Tiny games your people make with Muse, inside Facebook.

Alternates:

1. **(K)** An interactive platform where anyone can quickly create, build and scroll through games in a feed, powered by the Muse models.
2. **(K)** A space where people express themselves and share that expression with others through Facebook.
3. Describe a game in a sentence and Muse builds it, for a Group, an Event or everyone. (The in-app copy says "Describe a game and Muse makes it in about a minute.")

"Whims" is a working name; swap in the final one when Karthik picks it (5.5).

**The 45-second version.** For the project page, or the opening if the slot is cut short. Read aloud, it runs about 45 seconds.

> Think of a sentence. Any sentence. "A cable car race up Nob Hill where the fog keeps moving the finish line." "Your roommate's cat, running for mayor." "The group chat, as a heist."
>
> Now press one button. About thirty seconds later, that sentence is a game. Nobody has ever played it, because a minute ago it didn't exist. Muse wrote the rules, built the world, sent bots through it to make sure it works, and painted its cover.
>
> Send it to your people. Priya beats your score before you've put your phone down. Theo remixes it so the fog is now lava. By tonight there are four versions and a rivalry.
>
> Every Group wakes up to a new game every morning. Every Event gets its own game night. Every inside joke can become something your friends play. There's no catalog to run out of, because the catalog is everything you and your people can imagine.
>
> Facebook already knows who your people are. Now it can give them something to play together: made from one sentence, any sentence, as many as you want.

*What's real in it.* "About thirty seconds" is measured: a median of 28.0 s over 10 real Muse runs, every game bot-tested before it ships (D2, D5). The Daily Whim and remixing a friend's game are on `beta-version`. Group-chat play, Challenge Me and game nights (VP-14, VP-15, VP-19) are not built yet. The sample sentences, the lava remix and "four versions by tonight" are illustrations, not data. The pitch claims limitless *ideas*; the games still run on the six game types the runtime knows, so in Q&A say "any idea that fits a dodge, timing, merge, guess, sort or answer game, and the list grows with each type we add."

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
| Remove Muse and nothing gets made: no briefs, no games, no daily content, no covers. | AI test | VP-34 | docs/BUBBLES.md §1 |
| A standalone app has none of these: Groups, Events, the friend graph, Stories, Reels, Messenger. | Why Facebook (Messenger is not wired yet) | VP-08, VP-28 | docs/BUBBLES.md §1 |
| A new Daily Whim every day, streaks, and friends beating your score. | Reason to come back | VP-06 | docs/BUBBLES.md §1 |
| Walk into the picnic already knowing three people's names. | Event icebreaker | VP-03 | docs/BUBBLES.md §1 |
| The Group leaderboard puts names to faces before you meet. | Daily Whim and board | VP-04 | docs/BUBBLES.md §1 |
| Muse writes the brief, composes the game from our library, writes the small custom code, playtests it and paints the cover. | AI beat in one sentence | VP-34 | docs/BUBBLES.md §1 |
| Every bubble is playtested before anyone pops in. | Studio loading copy | VP-05, VP-18 | StudioComposeStep.swift |
| The same game for everyone in the group today. | Daily Whim | VP-02, VP-16 | StudioAskStep.swift, StudioFloatStep.swift |
| Replays you can take over. | Bursts | VP-13 | BubbleBurstReelLayer.swift |
| The feed ranks for friendships made, not just time spent. | Recommender | VP-10 | Slack, Nov 12 11:37 (Kevin's agent) |
| A non-designer never has to pick a gravity value. | Creation is easy | VP-05 | Taxonomy canvas §9 part 3 |
| Muse can't set gravity to an unplayable value. | Safe composition | VP-34 | Concept library canvas §3 |
| Most hits are an older game with one twist applied. | Originality | VP-37 | Taxonomy canvas §9 part 4 |
| The library grows from what people actually make. | A system that compounds | VP-34 | Concept library canvas §6 |
| Tomorrow's Daily Whim is the reason to come back. | Close | VP-06 | Build tracker "Demo" step 5 |
| Why this belongs on Facebook and nowhere else. | Framing of this whole document | VP-01 (section 3) | Slack, Nov 12 11:49 |
| Warm competition words: "your move", "beat my 34", "rematch", "You and Maya: 12 games together". | Copy on challenge and board screens | VP-04, VP-14 | Brand ideas, Nov 12 11:52 |
