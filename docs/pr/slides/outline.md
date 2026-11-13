# Deck outline (draft 13, 29 slides)

Generated from `deck.html` and `notes.md`; the notes column is the start of each slide's speaker notes. Live phones: slide 10 (Karthik's iPhone) and slide 11 (Karthik's and Bayan's).

| # | Section | Title | Notes start |
|---|---|---|---|
| 1 |  |  | Curio: something small and delightful. Muse Curios is a new feature in Facebook: tiny games anyone can make, built to bring people together. |
| 2 | Section header | The problem | *(Section header: "The problem". Click straight on.)* |
| 3 | 01 · The problem | There's no better way to connect than playing a game. | There's no better way to connect than playing a game. It's how families keep up, how strangers break the ice, and how a big, mixed group… |
| 4 | 01 · The problem | Facebook has the people, but has lost the reason. | Facebook still has the people, but young adults have lost their reason to open it: teen use fell from 71% to 31%. And they're the lonelie… |
| 5 | 01 · The problem | At work, play became the icebreaker. | Play is filling that gap: LinkedIn puzzles at work, 11 billion NYT puzzles a year, and new hits like Krillion, made by one person. |
| 6 | 01 · The problem | Short-form is becoming something you play. | And on Reels, every game ends with "tell me your score" in the comments, where it scrolls away among strangers. |
| 7 | 01 · The problem · our thesis |  | So here's our thesis. People connect best by playing together. Facebook still has the people, but lost the reason to come back. And play… |
| 8 | Section header | The demo | *(Section header: "The demo". Click straight on.)* |
| 9 | 02 · The demo · our answer | A Curio turns "tell me your score" into a real Group score. | A Curio turns that into a real Group score. Here's the journey. |
| 10 | 02 · The demo | Demo | *(Live, about 1:40.)* I open Facebook and go to Curios: my friends' Curios come first, with their scores. *(Scroll; one plays with its so… |
| 11 | 02 · The demo · best of 5 | Every Curio is better with someone else. | *(Live, about 40 s; Bayan's phone joins.)* And when you meet someone, a best of 5 settles it. Bayan and I play the same Curios on the sam… |
| 12 | 02 · The demo · creators and brands | Creators and brands get a Curio, too. | *(10 s.)* Brands and creators get one too: this sponsored Curio is in the feed today. *(Back on the phone: the Curio Muse just made is re… |
| 13 | Section header | The AI stack | *(Section header: "The AI stack".)* How does it all work? Not just Muse making a game: a whole AI stack, built into Facebook. |
| 14 | 03 · The AI stack | One AI stack, built into Facebook. | Here's the whole stack. Facebook already has the people: friends, Groups, chats. Our stack does four things, all on our server. Make: fou… |
| 15 | 03 · The AI stack · make | Distilling Virality into a Harness | First, make. The design problem: your creativity on one side, the format a Group needs on the other. Muse Spark reads the idea, we ground… |
| 16 | 03 · The AI stack · make: one request, traced | One request, traced through the harness | Here's one real request, traced: "Brainrot trivia game with Mr. Beast as the host". That's all Kevin typed. Muse Spark reads it: trivia,… |
| 17 | 03 · The AI stack · check: is it playable? | Is it playable? Five bots play every game to the end. | Then code checks it. Is it playable? Five bots play every game to the end, from a new player to a pro. Each game has a profile, like arca… |
| 18 | 03 · The AI stack · check: does it feel right? | Does it feel right? Real difficulty, fair scores. | Does it feel right? Difficulty you can feel means skill has to show in the score: the pro beats the regular, who beats the new player, an… |
| 19 | 03 · The AI stack · check: does it look right? | Does it look right? Every frame, every run. | Does it look right? Every bot run is replayed and checked every tenth of a second against 29 failure classes. Real cases: a "Wave 1 of 5"… |
| 20 | 03 · The AI stack · rank | Rank: a feed that learns what paid off, not what grabbed. | Third, rank. Anyone can make a Curio, so there will be far more Curios than anyone can play, and the feed decides which ones you see. A f… |
| 21 | 03 · The AI stack · learn | Every Curio is a sensor. | And fourth, learn. Every Curio is a sensor. A post tells Facebook you looked. A Curio tells it whether you enjoyed it, how good you are a… |
| 22 | Section header | Our process | *(Section header: "Our process".)* And how we built it. |
| 23 | 04 · How we built it · how we work with agents | How we work with agents | We started with two hours away from Claude: whiteboards and arguments, so the ideas could grow first. Then we treated agents as teammates… |
| 24 | 04 · How we built it · agents doing, people deciding | A feature, start to finish, between agents. | Here's what that looks like. Kevin asked for a sound library at 1:26 in the morning, and his agent posted the bid. With Artem's go-ahead,… |
| 25 | 04 · Our process · one shared context | Five people, each with their own agents, working from one shared context. | The real trick wasn't any one agent. It was keeping five people's agents in sync. Each of us ran our own agents, on our own machines, and… |
| 26 | 04 · How we built it · what we learned | Where AI helped most, where it fell short, and how we adapted. | AI fell short when Muse guessed from one giant prompt, when Muse Image refused franchise names, and when agents stated wrong facts confid… |
| 27 | 04 · Our process · what the harness taught us | Where the harness struggled, and what we changed | And the harness itself taught us the most. One giant prompt of 137,000 characters missed what people asked for, so now we search the cata… |
| 28 | Why it matters | Through Curios, we will: | Through Curios, we'll end the awkward first conversation, with someone new or an old friend, create a new kind of short-form media you pl… |
| 29 |  | When the world is your muse, how will you create the content of tomorrow? | *(Pause.)* When the world is your muse, how will you create the content of tomorrow? Thank you. |
