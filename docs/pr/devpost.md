# Muse Curios — Devpost draft (Closer Together '26)

*The project page text for the Devpost submission. Drafted by Claude (AI agent for Kevin), reviewed by Kevin, 2026-11-13. Edited by Claude (AI agent for Artem) on 2026-11-13 to match [narrative.md](narrative.md) and what's on `main`: the four Muse models, the engine, how we worked with AI, and challenges marked as server-side. Name: Muse Curios, and the tagline, are Karthik's (2026-11-13). Follows [STYLE.md](STYLE.md). Updated by Claude (AI agent for Kevin) on 2026-11-13 to match deck draft 12 and Karthik's 07:49 reframe: the play-connects-people thesis, the 71% → 31% problem, the traced harness build and its three checks, the agent numbers, and what fell short. The deck itself is unchanged. Updated again by Claude (AI agent for Kevin) for Karthik's 08:25 review notes: team numbers instead of "643 agents on one Mac", "every game a person makes in the app" instead of every game, "a few minutes" to build, and challenges in the app (`ChallengeInbox` and `ChallengeCenter` on `main`, checked in code, and Claude (for Artem) confirmed friend challenges and Group rounds are live on Prod).*

**Muse Curios**

**Tagline:** When the world is your muse, how will you create the content of tomorrow?

**cu·rio** *(noun)*: 1. something considered novel, rare, or bizarre (Merriam-Webster). 2. *(Muse Curios)* an interactive short-form experience with infinite possibility, meant to breed collaboration through friendly competitiveness.

> Tiny games anyone makes from one sentence with Meta's Muse, made to be played with your friends, Groups and Events, so a score becomes a rematch and a stranger on your Group's board becomes a friend.

## Inspiration

**There's no better way to connect than playing a game.**

It's how families keep up, how strangers break the ice, and how a big, mixed group finds common ground over Monopoly or a deck of cards. People open an app for a reason: a need, something they have to do, or a ritual, something they do every day with others watching. The apps that spread give you one of these again and again, and the ones that last give you both, with friends. Facebook still has the people, but young adults have lost their reason to open it: the share of US teens who ever use Facebook fell from 71% in 2014–15 to 31% in 2025 ([Pew Research Center](https://www.pewresearch.org/wp-content/uploads/sites/20/2025/12/PI_2025.12.09_Teens-Social-Media-AI_REPORT.pdf)).

Think about how Wordle spread. It wasn't the puzzle itself. It was the grid of colored squares that showed up in every group chat each morning, and the quiet competition of seeing who got it in three. LinkedIn saw the same thing when it added daily games that rank you against your connections, colleagues and alumni, which turned them into a conversation starter at work, and reported 86% of players returning the next day and 82% still playing after seven days ([LinkedIn](https://news.linkedin.com/2026/LinkedIn-AnnouncesWend)). The New York Times saw it too: its puzzles were solved over 11.2 billion times in 2025, up from about 4 billion in 2022, and 46 Wordle scores are shared every second, and it added a friends tab "to encourage communal play" ([AP](https://www.news4jax.com/business/2026/01/21/this-just-in-from-the-new-york-times-its-first-2-player-game-and-an-evolving-business-model/)). Short-form is becoming something you play, not just watch. On Instagram, Reels you pause, play along with or race already end with "tell me your score" in the comments; a Curio turns that into a real, comparable Group score. A small, shared, slightly competitive game is one of the most reliable reasons people open an app every day, and it's a reason they keep coming back to with their friends rather than alone.

Facebook already has the thing those games are missing: the people. Your friends, your Groups and your Events are all in one place, under real names, which makes it the natural home for a daily game that's about the people you play it with. It also matters to the people we built this for. Adults aged 19 to 29 report feeling lonely more than any other age group, with 27% saying they feel very or fairly lonely ([Gallup and Meta](https://news.gallup.com/opinion/gallup/512618/almost-quarter-world-feels-lonely.aspx)), and a quick game with someone is one of the lowest-pressure ways to start talking. Almost all of them already play: 98% of Americans aged 13 to 39 play some kind of game (YPulse, 2026), yet only 33% of young men and 9% of young women say "gamer" describes them (Pew Research Center, 2015). Muse Curios is for everyone who plays without calling it a hobby.

So we asked a simple question: **what if short-form content were something you play *with* your friends, made by your friends, and a new one were waiting for you every time you opened Facebook?** That's what a Curio is: a game inside Facebook, played on the same seed with the people you know and the ones you're about to meet, that anyone can make with Muse. Every game becomes a reason to open the app, every score becomes a reason to message someone, and every new game anyone makes adds to a feed that never runs out.

## What it does

Muse Curios is a new feature in Facebook: short-form content created by your friends and designed to be played with your friends. Anyone can turn one sentence into a tiny game with Meta's Muse, whether that's a geography trivia game for their study group or Triple-T getting chased through the streets of Paris, and every game they post lands in a scrolling feed where you play it with a tap instead of just watching it. Each game has its own leaderboards for everyone, your friends and your Groups, so every game you play is also a quiet competition with people you know, and every time a friend beats your score you have a reason to open Facebook and take the spot back.

**A week with Muse Curios.** Artem just joined a boba enthusiasts' Group and doesn't know anyone in it yet. On Tuesday night he types "a game where you catch falling tapioca pearls before they hit the table," tweaks it once so the pearls fall a little faster, and posts it to the Group. By Thursday a dozen members have played it, and someone named Sam sits one spot above him on the Group's board, so Artem taps Add friend and Muse Curios offers the two of them a best-of-5, which Artem takes 3–2. On Saturday the Group meets up at a tea shop, and Artem walks in already knowing someone, with a rematch to settle.

### Compete together

- **Same game, same seed, fair score.** Everyone who plays a game plays the exact same run, and every score is saved as a replay that can be re-run and checked, so a rivalry with your friends is always a fair one.
- **Challenges.** When you finish a game you can send it to a friend with your score attached, or challenge a whole Group to beat it, so they can try to beat you and you all see who came out on top. Challenges and their notifications go through our server, so they reach your friends' phones.
- **Boards at every size.** Every game has a leaderboard for everyone, for your friends and for each of your Groups, and Groups also get a weekly board that resets every week, so there's always a fresh race to win and a reason to come back the next day.

### Get closer

- **A score is an introduction.** On a Group's board, the people you don't know yet have an Add friend button next to their name, because "how did you get 214?" is a much easier first message to send than "want to be friends?"
- **New friend, first rematch.** When you add someone, Muse Curios offers the two of you a best-of-5, so a new friendship starts with something fun to do together instead of an empty chat.
- **Games the whole Group will like.** Group Blend looks at what every member of a Group enjoys and picks games the whole Group is likely to have fun with, rather than whatever the best player wants, and it points out a "taste twin" in the Group you might want to add.
- **A feed ranked for friendships, not minutes.** Our ranking rewards the moments that happen between people, like finishing a friend's game, rematching, sending a challenge or adding a friend, over games that only grab a quick tap and lose you.

### Make anything, with Muse

- **One sentence in, a game out.** Muse doesn't pick from a list of templates; it writes the game's rules itself, so a pun, an inside joke or a half-formed idea can become a game that nobody has ever played before.
- **It agrees the game with you first.** Before it builds anything, Muse lays out "How the game works" (the loop, the rules and how you win or lose) and asks you only about the parts it isn't sure of.
- **Refine it before you post it.** While you're making a game you can keep shaping it in plain words, like "slower" or "make the pearls bigger," and Muse changes just that part. Once a game is posted it stays as it is, and anyone who wants a different version can remix it and post their own.
- **Facebook-quality by default.** Before anyone sees a game, test bots play it, a quality check catches anything unfinished or unfair, and Muse fixes whatever fails, so the feed stays fun without limiting what people can ask for.

## Built for the brief

**AI Integration (30%): take Muse out and there are no games.** Muse is the creator in Muse Curios, not a feature added on top. It turns any idea someone describes into a game with rules of its own, talks through how the game should work with the maker before building it, and then fixes whatever our test bots manage to break. Four Muse models share the work: Muse Spark reads the idea, Muse Wonder plans the game with your words as requirements and then writes and repairs it, Muse Image paints it, and Muse Ember handles the quick steps, like a short brief of mood, energy, how competitive it is and who it's for. That's how someone with no coding experience can go from a sentence to a playable game: a few minutes to build, once Muse and the maker have agreed the plan. A template could reskin an existing game, but it could never turn "catch tapioca pearls before they hit the table" into a game that plays the way the maker imagined. The creativity comes from Muse, and the quality bar comes from us: every game is playtested, checked against known kinds of games and checked for a fair scoreboard before anyone sees it.

**Product Thinking & User Impact (25%): a daily reason to open Facebook, shared with your friends.** Daily games already prove that a small, competitive habit brings people back every morning. Muse Curios makes that habit social and endless: there's always a challenge waiting in your inbox, a friend who just passed your score, a new week starting on your Group's board, and a new game from someone you know at the top of your feed. Because anyone can make a game, the people playing are also the people creating, so the feed keeps growing on its own. It belongs on Facebook because a game is only as good as the people you play it with, and Facebook is the one place where your friends, your Groups and your Events already live together.

**Execution & Demo (25%): it runs on our live server today.** Every game a person makes in the app is made by Muse on our own server, agreeing the plan with the maker first and then taking a few minutes to build the game. Leaderboards, the weekly Group board, friends, the best-of-5, saves and the ranked feed are real server data rather than mockups. Challenges to a friend or a whole Group run through the server too. Quiz nights and making a game together are built on the server, and their app screens are next.

**Originality & Cohesion (20%): short-form you play with people.** Prompt-to-game tools already exist, but the games they make usually travel from one creator to an audience of strangers. Muse Curios makes games for and with the specific people in your life, and then turns the score into something social. Every part of the product serves the same goal: making a game gives your friends something to open, competing gives you a reason to talk, and the leaderboard turns that conversation into a friendship.

**For creators and brands.** A creator can turn their persona into a Curio their audience plays and ranks on, so "tell me your score" in the comments becomes a real board. Brands get a sponsored Curio card in the feed (brand name, a "Sponsored" tag and Play now), which is in the app today. Brand challenges a Group plays together, creator payouts and ad targeting are proposals, not built.

## How we built it

The five of us built Muse Curios around a single API, with each of us working alongside AI coding agents. At a high level, the phone only shows the experience, and everything that needs to be trusted or shared lives on our server.

**How we worked with AI.** Each of us ran our own Claude and Codex agents, and they stayed in sync the way a team does: one Slack channel for updates and handoffs, a shared canvas of who's working on what, and a `CLAUDE.md` file every agent reads before it starts (claim work before you begin, hand off in writing, never push to `main` without an OK). We started with two hours away from the agents, on whiteboards, so the ideas could grow first. After that, people decided and agents asked, and every draft was checked by another agent. That shared context is what let five people's agents work in parallel without losing the thread: 462 Slack posts and replies across 64 threads, 478 commits from all five of us with 63 merges, and every one of us @-mentioned 30 or more times. On one teammate's Mac alone, agents put in about 158 hours of work across 22.5 hours. The agents moved fast, but the design philosophy, the decisions and the memory of how the pieces fit together stayed ours.


- **The app:** a SwiftUI recreation of the Facebook iPhone app, with Muse Curios built into the feed, Groups, profiles and a Studio for making games. It shows screens and calls our API, and nothing else.
- **The server:** a Go API backed by MongoDB that holds friends, Groups, leaderboards, challenges and the feed. Muse runs only on the server, so the key never touches anyone's phone.
- **Making a game (the harness):** the harness balances your creativity on one side against the format a Group needs on the other. Muse Spark reads the idea, our code grounds it in a catalog of about 1,300 game types, Muse Wonder plans it with your words as requirements and writes it from tested building blocks plus rules of its own, and Muse Image paints it. Then code proves it before anyone sees it, with three checks:
    - *Is it playable?* Five bots, from a new player to a pro, play every game to the end. Each game has a profile, like arcade, puzzle or story, that decides what counts as broken, such as a bot winning in seconds or controls that do nothing.
    - *Does it feel right?* Skill has to show in the score: the pro beats the regular, who beats the new player, and mashing a button or doing nothing can't win. If the new player beats the pro, the score measures luck and the game is blocked.
    - *Does it look right?* Every bot run is replayed and checked every tenth of a second against 29 kinds of visual problem, like a banner too faint to read or "SCORE" splitting into "SCOR / E".

  Here's one real request, traced. Kevin typed "Brainrot trivia game with Mr. Beast as the host," and nothing else. Muse Spark picked out trivia, tap to answer, Mr. Beast and brainrot; the catalog grounded it as multiple-choice trivia with a quiz, a timer bar and a question bank; and Muse Wonder planned a loud studio game show for a pile of fake cash and wrote 30 original questions. The first draft failed, because all five bots won in under 17 seconds and nobody could lose. Muse repaired it so the last one to answer loses the cash, with three strikes and you're out, and the second draft passed, with scores from 320 for the new player to 1,390 for the pro, in 143 seconds from start to finish. The harness is where most of our AI work went: it's what turns a creative model into games that reliably work.
- **The engine:** every game is a JSON file, art and sound included. Our engine, written in Rust and compiled to WebAssembly, reads that file at runtime and turns it straight into the finished game, with no build step and nothing to install. The engine is about 1 MB of WebAssembly (389 KB gzipped).
- **Fair play:** the engine runs every game exactly the same way from the same seed, so the server replays every score's input log and only the replayed score counts.
- **Sounds:** like Reels audio, you can put a song behind your game from a library of credited, licensed tracks.
- **The feed:** a ranking model, running on our server, that learns from the moments that happen between people, like finishes, rematches, challenges and new friends, rather than from taps alone. Its sibling, Group Blend, uses the same signals to pick games for an entire Group.

## Challenges we ran into

- **Making competition feel friendly.** A leaderboard full of strangers can feel more like a wall than an invitation, so we designed every part of it to be welcoming. Boards only show people from Groups you share, reaching out always goes through Facebook's normal friend request, every score comes from the same fair run, the weekly board gives everyone a fresh start, and Group Blend favors games where members are evenly matched so nobody gets left behind.
- **Keeping creativity high and quality higher.** We wanted Muse to be free to make anything, but our earliest games often felt unfinished next to the ones we built by hand, and some passed our bots without actually being fun. Instead of limiting what people could ask for, we raised the bar that every game has to clear: a plan agreed with the maker, a check against known kinds of games, bot playtests, a quality check and a fair-scoreboard check.
- **Where AI fell short, and what we changed.** At first Muse guessed from one giant prompt of 137,000 characters and missed what people asked for, so now we search the catalog first and send Muse only what the plan picked. Muse Image refused some franchise names, so we retry once with a plain description and fall back to drawn art. Muse's art step sometimes undid the verifier's layout fixes, so we keep the verified layout and check again. Wikipedia lookups timed out, so we wait longer and build without them if we have to. And people kept missing unreadable text, so now code checks every frame.
- **Making sure Muse builds what was asked for.** Early on, a request themed around a famous movie came back with none of the movie in it, because Muse had quietly dropped the theme. Now Muse writes the request's theme, characters and rules into its plan before building anything, and the finished game is checked against that plan at the end.

## Accomplishments that we're proud of

- **Friends can really play against each other, across phones.** The leaderboards for everyone, friends and Groups, the weekly Group board, Add friend, the best-of-5 and challenges all run on our live server with real accounts, so nothing a judge sees on those screens is mocked.
- **A feed built to bring you back for people, not for clickbait.** Our recommender treats "did this game grab you" and "were you glad you played it" as two separate signals, and it weighs the second one 2.5 times more heavily, counting finishes, rematches, challenges and new friends as the real wins. In a simulation with synthetic users, it beat a standard feed in 70.3% of the sessions that had a clear winner, and the people who dislike clickbait ended up with the longest sessions of anyone. That's a simulation rather than real users, but it shows the feed pulling in the direction we want.
- **Matching games to whole Groups, fairly.** Group Blend picks games by the chance that *everyone* in a Group enjoys them rather than the average, drops any game that one member would hate, and gives a boost to members it has served least without pushing anyone else down. Across 240 simulated Groups, the share of picks that every member enjoyed rose from 8.7% for random picks to 32.0%.
- **Any idea becomes a polished game in a few minutes.** Every game a person makes in the app is built live by Muse on our server from a sentence that no one wrote a template for, and every game clears the same quality bar before anyone plays it: a plan agreed with the maker, bot playtests, a quality check and a fair-scoreboard check.
- **Games that look right, checked by code.** Our frame-by-frame look check catches what people miss, and on 45 real builds it cut unreadable text from 178 cases to 2.
- **Every score is fair by construction.** Our engine runs every game identically from the same seed and saves every run as a replay, so any score on any leaderboard can be re-run and checked, and a high score on Muse Curios actually means something.

## What we learned

- **Friendly competition is one of the best icebreakers there is.** A score sitting next to a stranger's is low stakes, because it's about the game rather than about you, and it gives two people something easy to talk about. Once we saw that, it reshaped the whole product: every game needed a leaderboard, a way to rematch and a way to say hi.
- **The magic happens after the game is made.** Most AI game makers stop at "you made a game." We found that the most exciting part is what happens next between people, like the rematch, the trash talk in the group chat and the friend request that follows, so we built Muse Curios around those moments.
- **Creativity needs a floor, not a fence.** Our first instinct was to limit what people could ask for so that games would come out well, but that only made the games blander. Holding every game to the same quality bar, and letting Muse be as creative as it wanted inside it, gave us games that were both surprising and reliable.
- **People still decide what's fun.** In a small blind test of game art with one human judge, Muse's own judge agreed with the person only 44% of the time, which taught us to keep real people in the loop whenever we decide what "good" looks like.

## What's next for Muse Curios

- **Make it together, play it together.** Friends will be able to each add a level, a question or a scene and have Muse stitch them into one game that credits every maker, and a game posted in a group chat will become a shared session the whole chat plays. Both already work in the app on a single device, and moving them onto the server so they work across phones is next.
- **Get-to-know-you brackets.** When you meet someone at an event, Muse Curios will set up a best-of-3 of quick games for the two of you, so a new connection turns into a friendly rivalry right away.
- **Tap-to-refine while you create.** Today you refine a new game by describing changes in words. Next, while you're still making it, you'll be able to tap a part of the game, like an enemy or the timer, and say "faster" or "make this a dragon" to change just that piece. Once a game is posted it stays as it is, and anyone can remix it into their own version.
- **Real Groups.** We'd like to pilot Muse Curios with real Groups and measure what we actually care about: the share of new Group members who make their first friend there within two weeks.

## Built with

meta, muse-spark, muse-ember, muse-wonder, muse-image, swift, swiftui, ios, go, mongodb, rust, webassembly, javascript, node.js

## Try it

- **Code:** [github.com/karthiksing05/meta-hackathon-project](https://github.com/karthiksing05/meta-hackathon-project)
- **Demo video:** \[TBD\]
