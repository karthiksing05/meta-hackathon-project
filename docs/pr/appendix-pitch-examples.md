# Appendix: every pitch example

*Every example gathered for the pitch, each linked to its value proposition. Part of the pitch docs; start at [README.md](README.md).*

## Appendix: every pitch example

Every example we collected for the pitch (section 5), one per row, with what it proves, the value proposition it supports and where it came from. Duplicates reported by several sources are merged into one row with all sources. **(K)** marks something Karthik raised himself. Teammates' and judges' words are paraphrased. Sources use short names: *Slack* (#meta-closer-together-26, with PST time), *Build tracker*, *Agent Logistics*, *Problem canvas*, *Brainstorm canvas*, *Taxonomy canvas* and *Concept library canvas* (the team's Slack canvases), *Brief* (Meta's official brief) and repo paths. Numbers carry the labels used in section 8.

### A.1 The people and the need

| Example | What it proves | VP | Source |
|---|---|---|---|
| The brief's own words: young adults face new cities, new friends, first jobs, side hustles, and plans that never leave the group chat. | We answer the brief in its own language | VP-02, VP-26 | Brief |
| Meta's challenge: build the AI-powered Facebook feature you wish existed, one that makes Facebook genuinely valuable for young adults. | Open the pitch against it | VP-26 | Brief; Problem canvas |
| The problem line: many changes at once, and Facebook helps with none of them in a way that feels like it's for them. | Frames our need as one of those changes | VP-08 | Problem canvas |
| Our need: making friends in a new city. You moved, you know nobody, and meet-people apps feel awkward. One of Meta's four named needs. | A real, named young-adult need | VP-02, VP-03 | Brief; Problem canvas; Build tracker; proposed by Bayan, Slack Nov 11 20:51, adopted Nov 12 07:37 |
| A Group full of strangers is awkward and nobody posts. | The precise problem we fix | VP-02 | docs/BUBBLES.md §1 |
| Alex, who just moved to SF; New in SF (2,814 members); the newcomers' picnic in Dolores Park in two days (46 going, 128 interested). All synthetic. | The demo world | VP-02, VP-03 (D25) | docs/BUBBLES.md §4.7; bubble-demo-world.json |
| The cast: ten newcomers with intros and three facts each. Maya (from Austin, runs Lands End on Saturdays, cat named Biscuit), Diego (Chicago, bakes too much sourdough), Priya (Toronto nurse on nights), Lena (from Berlin last week, cold-water swimmer), Chloe (San Diego, her Thursday trivia team needs two more), plus Sam, Jordan, Aiko, Omar and Theo. All synthetic. | Games are about real-feeling people | VP-01 | bubble-demo-world.json |
| Your Group's intros become the games: Diego's sourdough becomes Sourdough Stack, Chloe's team gets Trivia Thursday: SF, and Maya runs every Saturday, so she's the one to beat. | The content is the people, which only Facebook has | VP-01 | Seeds; BubbleFeedRoster.swift |
| **(K)** Why Facebook isn't seen as cool: a weak algorithm, an older crowd, and Instagram feels more low-key. | Why young adults drifted; handle gently | VP-26 | Brainstorm canvas |
| Hypothesis: young adults have no reason to open Facebook, so the feature must give them one. | Our problem statement | VP-06, VP-26 | Problem canvas |
| Teen Facebook use fell from 71% (2014-15) to 32% (2024) [54]. A daily-use figure in our notes is unverified. | Scale of the gap. Teens, not our 18-to-29 users; Whims is adults-only | VP-26 | Problem canvas; [54] |
| 64% of teens already use AI chatbots (Pew, via a secondary site). | Young people already make things with AI. Unverified; check Pew's own page or drop | VP-34 | Problem canvas |
| Meta's other needs we touch: finding your scene (Groups) and turning group-chat plans into real plans (game night, icebreakers, challenges). | Breadth without losing focus | VP-11, VP-15, VP-19 | Problem canvas |
| Why this need: the earlier concept, Trip Rewind, served existing roommates, which none of Meta's four needs cover. | Answer to "why this need?" | VP-02 | Slack, Nov 11 20:51 (Bayan); Bayan's review |
| **(K)** How we got here: Scroll Games (Reels-style interactive games), SideQuests (travel), a campus hook, Drops, "finding purpose in the age of AI", then one named need. | Answer to "what else did you consider?" | VP-39, VP-06 | Brainstorm canvas; Problem canvas; Slack, Nov 11 20:36 |
| Scroll Games had a strong reason to come back but needed a tie to a real need; the new-city need gives it one. | Why the concept is cohesive | VP-06, VP-02 | Problem canvas "Directions" |
| The need was picked on Nov 12 after a teammate's review. | Credit line if the team story comes up | VP-02 | Team notes |

### A.2 Closer together (top priority)

This comes first because a judge asked us to focus on closer together and the social network, and Karthik made it the top priority at 11:45 on Nov 12.

| Example | What it proves | VP | Source |
|---|---|---|---|
| **(K)** People are brought closer together through friendly competition. | The headline | VP-04, VP-16 | Slack, Nov 12 11:36 |
| Three ways people come closer: friendly competition, shared stories and self-expression, through Facebook's own surfaces. | The pitch's spine | VP-04, VP-09, VP-14 | Slack, Nov 12 11:49; Agent Logistics Priority 1 |
| Rule: for every feature, say who it brings closer (friends, a Group, a group chat, people you just met at an Event). | Each demo moment names its people | VP-25 | Slack, Nov 12 11:49 |
| The social version of every screen: friends' scores, who played, who made or remixed it, and one tap to challenge, invite, send to the chat or add a friend. | Social by default | VP-25, VP-04 | Slack, Nov 12 11:49 |
| **Competition (K): Challenge Me.** "Beat my 34 in Hill Drift" sent to a friend's chat or a Group; a head-to-head "You 41, Maya 34"; Challenge back. Not built. | The core friendly-competition moment | VP-14, VP-16 | Slack, Nov 12 10:56, 11:20 |
| **Competition:** from rival to friend. Every board row for someone you don't know has Watch Burst and Add friend, so whoever beat you is one tap from a friend request. Live. | Competition turns strangers into friends | VP-04 | BubbleBoardView.swift |
| **Competition:** board with Group, Friends and Everyone tabs, a podium, your row pinned and a badge on verified runs. Live. | Fair, social ranking | VP-04, VP-16 | BubbleBoardView.swift; Bubble.swift |
| **Competition:** fair by construction. A challenge or group-chat session is the same game plus the same seed. | Friendly stays friendly | VP-16 | Slack, Nov 12 07:37, 11:52 |
| **Competition:** "Most improved" on the weekly Group leaderboard, so it isn't only for the best player. Not built. | Inclusive competition | VP-19 | Feature spec, Nov 12 11:58 |
| **Competition:** warm words: "your move", "beat my 34", "rematch", "You and Maya: 12 games together". | Rivalry framed as friendship | VP-04, VP-14 | Brand ideas, Nov 12 11:52 |
| **Blends (K, new):** like Spotify's Blend. From two people's play history, Muse makes a game for the two of them to get to know each other, play and see who wins. Kevin's recommender work supplies the taste profiles, the matching and the blending. Not built; design and request sent. | Competition as a way to get to know someone | VP-40 | Karthik, Nov 12; [125] |
| **Brackets (K, new):** when you meet several new people, for example at an Event, Blends become a tournament bracket for all of them. Not built. | Keeps an Event's new connections going | VP-40, VP-03 | Karthik, Nov 12 |
| **Group chat (K):** some way to play games in group chats is probably necessary, most likely built around challenges. Not built. | Plans start in the chat | VP-15 | Slack, Nov 12 11:35 |
| Make the group-chat card the signature moment, rather than the feed. | Fits the judge's note better than a solo feed | VP-15 | Brand ideas, Nov 12 11:52 |
| Shared sessions: several people play the same seed at different times. Live multiplayer was cut. | Async play suits group chats | VP-15, VP-16 | Slack, Nov 11 20:13 (Bayan); Agent Logistics |
| **Stories (K):** tell stories with games, and lean into it directly. | One of the three pillars | VP-09 | Slack, Nov 12 11:35 |
| **Stories (K):** interactivity gives people a new lens to tell their stories. | Games as storytelling | VP-09 | Slack, Nov 12 11:36 |
| **Stories:** Moving Day, Alex's funny game about his move to SF: float your box past Stairs, Couch, Mattress and the 4th floor. A hand-made seed. | Your own story as a game | VP-09 | bubble-seed-moving-day.json |
| **Stories (K):** choose-your-own-adventure games; after an ending, see which endings friends found ("Maya took the ferry"). Not built. | Shared stories | VP-09, VP-37 | Slack, Nov 12 10:36; session notes |
| **Stories:** Wordle's grid tells the story of your attempt without the answer. Our share cards do the same. | Shares as small stories | VP-13 | Taxonomy canvas §2, §7 |
| **Self-expression (K):** a space where people express themselves and share that expression with others through Facebook. | The creative side of closer | VP-09, VP-23 | Slack, Nov 12 11:35 |
| **Self-expression:** Games about me: "How well do you know me?", "My first month in SF", "Guess my favorite spot". Friends' results show who knows you best. Not built. | Profiles that invite friends in | VP-09 | Feature spec, Nov 12 11:52 and 11:58 |
| **Co-making:** make a game together. Friends add a question, word list or level as cards in the chat or Group; Muse stitches them; credits say "Made by Maya, Leo and you". Not built. | Collaboration, not just competition | VP-38 | Feature spec; Agent Logistics |
| **Remix (K):** remix with credit. "Remix of Hill Drift by Leo"; the maker is notified ("Priya remixed your Whim."); "Send it back" goes to their chat; a remix count and a remix tree with friends highlighted. Each remix records what changed. Lineage and the notification are Live; the rest is not built. | Remixing as conversation | VP-17, VP-23 | Slack, Nov 12 11:35; StudioModel.swift; feature spec |
| **(K)** Remix, share, leaderboards, and close integration with Groups and Search as the ways people connect. | Karthik's list of levers | VP-17, VP-04, VP-11 | Slack, Nov 12 11:35 |
| A "supportive, together" mood leads to a co-op pool, relays and reactions instead of rankings. Calm moods lean to co-op, competitive moods to leaderboards and challenge links, silly moods to funny-fail clips. | Closer together isn't only competition | VP-38, VP-19 | Concept library canvas §7 |
| Social shapes as an identity knob: solo, async against friends, co-op shared score, live versus, relay. | Covers competition and collaboration | VP-14, VP-38 | Taxonomy canvas §9 part 3 |
| Social twists: re-scope (one puzzle per Group), hand off (a friend sets it), socialize (a Gartic Phone-style relay). | Any game can become a closer-together game | VP-18, VP-38 | Taxonomy canvas §9 part 4 |
| Social pieces designed: leaderboard, ghost race, challenge link, co-op pool, live versus, relay, setter, reactions. Share pieces: spoiler-free grid, score card, Reels-sized clip, post to a Group, send in Messenger. | Building blocks for social play | VP-13, VP-14 | Concept library canvas §5 |
| Two-phase reveal: answer now, see results once the Group has answered (powers Read the Room). | Group-wide shared moments | VP-02 | Concept library canvas §4-5 |
| **(K)** Quiz night: a Kahoot-style party game of funny clips where you guess what they say next, built with original animated scenes and no real clips. Not built. | A party game for a Group or chat | VP-15, VP-37 | Slack, Nov 12 10:47 |
| **(K)** Learn: Muse turns a topic or notes into a lesson game, and a Group learns together, with a Group mastery meter and friends' streaks. Illustrative copy: "New in SF knows 82% of the hills" (not measured). Not built beyond the answer formula. | Learning as a shared activity | VP-12 | Slack, Nov 12 10:42; feature spec |
| Social signals recorded: challenge sent, accepted, won and rematch; group-chat play; remix; co-making; Add friend from a game. Each posts a `bubbleSocialSignal` event. Designed. | The system learns from connection | VP-10 | Slack, Nov 12 11:49 |
| The feed ranks for friendships made: Add friend weighs highest, a float to a Group next; an Add friend on a board still counts for the game that led there. | Ranking aligned with the mission | VP-10 | Slack, Nov 12 11:37 (Kevin's agent) |
| Brand ideas for a "together" layer: the gradient is the space between two people (blue is you, violet is them); a glyph of two shapes meeting; a "made together" byline with stacked faces; remixes as chapters; a name that works in social sentences ("Send me a ___"); a "Closer together" ideas board. | The brand carries the message | VP-38, VP-23 | Brand ideas, Nov 12 11:52; Agent Logistics brand round 3 |
| An earlier judge (Nov 11, paraphrased) told us collaboration mattered less; the Nov 12 judge said the opposite. We follow the newer note. | Why the pitch changed | VP-38, VP-14 | Brainstorm canvas; Slack, Nov 12 11:34 |

### A.3 Why Facebook

| Example | What it proves | VP | Source |
|---|---|---|---|
| Judge (paraphrased): focus hard on closer together and the social network, and make the idea fit Facebook and its ideals so it makes the most sense there. | The question we must answer | VP-01, VP-25 | Slack, Nov 12 11:34 (Karthik relaying) |
| **(K)** Integrate deeply with Facebook's own features: Groups (which he called a big one), friends, chats, Search, and especially a Challenge Me. | Karthik's integration priority | VP-02, VP-14, VP-11 | Slack, Nov 12 10:56 and 11:36 |
| **(K)** Expected question: why Facebook, and why can't another network do this as well? Answer with data, integrations or value to Facebook. | Drives the Q&A answer | VP-01 (sections 3 and 7) | Karthik, Nov 12 11:44 |
| The open slot: no viral game uses who you are or who your friends are as content. Wordle uses a word list, Flappy Bird random pipes. | Only Facebook has the content | VP-01 | Taxonomy canvas §5, §8; Slack, Nov 11 19:42 |
| A standalone app has no Groups, Events, friend graph, Stories, Reels or Messenger. | The "works as well as its own app?" test | VP-08, VP-28 | docs/BUBBLES.md §1; Problem canvas "Tests" |
| The share lives on Facebook: results post to the Group or feed, and challenges would travel through Messenger. | Facebook is the distribution | VP-13 | Taxonomy canvas §8 |
| **Groups:** a Daily Whim card at the top of each Group (cover, rule, Pop in, today's top 3, your standing, your streak). Live. | A Group-native ritual | VP-02, VP-06 | BubbleGroupSection.swift |
| **Groups:** a Games section, a weekly leaderboard with Most improved, game night and Challenge the Group. In the collaboration batch; not built. | Groups as the home for play | VP-19 | Slack, Nov 12 11:20; feature spec Nov 12 11:58 |
| **Events:** "Who's coming Saturday? Learn a few names before you go." on the picnic Event page, and "Make an icebreaker" on any Event you're going to. Live. | Events get people talking before they meet | VP-03 | BubbleEventSection.swift |
| **Events (new):** a bracket for everyone you met at the Event, from their Blends. Not built. | Play continues after the Event | VP-40 | Karthik, Nov 12 |
| **Messenger (K):** group-chat play as a playable card where everyone plays the same seed: "3 of 5 played", a mini leaderboard, a "your turn" nudge, rematch. Not wired at `0a3e8f7`. | Where plans start | VP-15 | Slack, Nov 12 11:35; feature spec Nov 12 11:58 |
| **Search (K):** find games by title, creator, category or Group; people results show that person's games; no match offers "Make it with Muse" with the query filled in. Not in `0a3e8f7` (only the Library has search). | AI where a search box falls short | VP-11 | Slack, Nov 12 11:20; feature spec |
| **Friends:** Add friend on every board row for someone you don't know yet (Confirm if they already asked); a Challenge button on friends' profiles (not built). | Play becomes friendship | VP-04 | BubbleBoardView.swift; Slack, Nov 12 11:20 |
| **Friends (new):** "Blend with" on a friend's profile or a board row makes a game from both of your play histories. Not built. | A game for two specific people | VP-40 | Karthik, Nov 12 |
| **Profiles:** a Whims tab with that person's Whims, best scores and chains; the Library holds yours, Groups', friends', chains, saved and popular. Live. | Self-expression on your profile | VP-09, VP-23 | BubbleProfileSection.swift; BubbleLibraryView.swift |
| **Feed:** friends' posts carry playable games. Diego: "Floated Hill Hopper to New in SF. Nobody has cleared Lombard yet." Chloe: "Got today's Fog Words in four. The fog was not helping." Maya: "Scored 27 in Sourdough Stack. Beat it?" (synthetic demo posts) | Games travel through posts | VP-13, VP-25 | BubbleFeedSurface.swift |
| **Reels and Video tab:** Bursts. Maya: "42 on Hill Hopper. Come beat it" (5.4K views, synthetic). Sam: "Caught the cable car by a hair". Lena: "Bay Bubbles, one more merge". Theo: "Drifting through the fog". | Games as watchable short video | VP-13, VP-39 | BubbleReelsSurface.swift |
| **Stories:** share a Burst ("Beat my 42 in Fog Words"); it plays muted for the run's length (6 to 12 s); Pop in opens the same game. | Stories carry play | VP-13 | BubbleStoriesSurface.swift |
| **Notifications:** "Today's Daily Whim in New in SF is ready. Pop in before the fog lifts." / "Diego beat your score in Hill Hopper. Take it back?" / "Priya remixed your Whim." / "Jordan played your Whim." / "You passed Maya in Fog Words." | Pull-back loops on Facebook's own channel | VP-06, VP-17 | BubbleNotificationsSurface.swift |
| **The "New" badge (K, new):** a small "New" badge next to the feature wherever it appears in Facebook, so it calls itself out at once. Not built. Demo note in section 5.3. | The feature is easy to find on every surface | VP-08, VP-13 | Karthik, Nov 12 |
| Whims show up all over Facebook, not in a separate app: feed posts, Reels, the Video tab, Stories, Group and Event pages, profiles, notifications, the Whims tab, the Whim page, the Library and Chains (6 distribution surfaces and 3 entry points, D19). | Integrated, not bolted on | VP-08 | Slack, Nov 12 08:48; Build tracker |
| Meta's suggested starting areas we cover: Groups, Events, Gaming, Messenger (in progress), Feed, Reels and Profile, plus Search. The brief describes Gaming as playing, watching and building community around games. | We build on surfaces Meta itself named | VP-08 (section 10.3) | Brief; Problem canvas |
| In the clone today: Gaming is a "Coming Soon" page in the Menu; Marketplace moved into the Menu shortcuts to make room for the Whims tab. | An honest map of surfaces | VP-08 | docs/BUBBLES.md §2; FEATURE_PARITY.md |
| Facebook stays Facebook: the tab bar, headers and sheets are Facebook's; only the Whims screens carry their own brand. | Fits Facebook's ideals | VP-08 | docs/BUBBLES.md §2 |
| It sits inside a working Facebook clone: 161 features done, 16 partial, 35 marked not in the demo, across 13 areas. | Not a mockup | VP-24 | docs/FEATURE_PARITY.md |
| The Problem canvas's four tests: a real need, belongs on Facebook, AI does real work, a reason to come back. Each fails if we have to convince them, if it works as well as its own app, if Muse only adds polish, or if it's useful once and then done. | Our pitch passes all four | VP-02, VP-01, VP-34, VP-06 | Problem canvas |

### A.4 AI does real work

| Example | What it proves | VP | Source |
|---|---|---|---|
| The brief: "If your feature would work just as well without AI, keep pushing." Our answer: remove Muse and no game, brief, daily content or cover exists, and nobody could hand-write a daily game for every Group. | AI is essential | VP-34 | Brief; docs/BUBBLES.md §1 |
| The brief's four kinds of AI work, mapped. **Understand:** Ember reads a sentence back as an editable brief. **Match:** icebreakers, boards with Add friend, the recommender and Blends. **Coordinate:** challenges, group-chat sessions, game night, brackets, a Daily made for each Group each day. **Create:** Studio makes a game with you. | Covers every verb the brief lists | VP-34 (section 10.4) | Brief; Problem canvas |
| Model roles: **Wonder** plans and composes by calling 8 Studio tools and writes the content (9 of 10 bench runs); **Ember** writes the brief (and once a word list); **Image** paints the cover while Wonder works; **Spark 1.3** is the fallback planner, never needed in the bench. | Muse powers the core, as required | VP-35 (D1, D4) | docs/BUBBLES.md §1, §3; StudioTools.swift; MuseComposeSession.swift |
| Ember (released Nov 9, 2026) is built to pair with a bigger model: the big model plans, Ember runs the fast steps. That is our split. | We use Muse as designed | VP-35 [29] | Slack, Nov 11 20:36; Problem canvas |
| Wonder, Ember, Spark 1.3 and Image all work on our key, and tool calls work on the text models. | Real integration | VP-35 | Slack, Nov 12 07:37 |
| Muse reads your idea back before it builds: "I read this as chill and social, for your new running club in San Francisco." You can change anything first ("Here's my plan. Change anything before I start."). | Understanding, with the maker in charge | VP-34 | hill-run.timeline.txt; StudioBriefStep.swift |
| What you want picks the game; the mood sets the feel. The brief covers intent, audience, occasion, mood, energy, competitiveness, content sources and limits. | Understanding beyond keywords | VP-34 | Concept library canvas §7 |
| The live timeline shows the work. Logged CLI run (25.0 s): "Wonder is reading the library of 6 formulas and 55 concepts", "Picked dodge: one-touch float fits chill running club hills", Wonder wrote 8 obstacle labels, "Wiring checks out: 14 concepts, every event wired", "Painted the cover in 19 s while Muse composed". The earlier, unlogged 58.5 s run showed Ember writing 12 SF hill names (Twin Peaks, Nob Hill, Bernal Heights and more). Two different runs (D10, D11). | AI visibly doing real work | VP-34, VP-35 | hill-run.timeline.txt; Slack, Nov 12 08:48 |
| Muse catches and fixes its own game: in the 25.0 s run the playtest flagged that a typical player was still going after 150 s; after one repair the test bot lasted 46 s and scored 35. | An agentic loop, not one-shot generation | VP-34 | hill-run.timeline.txt |
| 3 of the 5 logged CLI runs needed a repair, and all 5 shipped valid. Hill Drift was too easy; the night edit was too short and too hard, then too hard (2 rounds); First Hellos broke a structure rule. Picnic Pals and Hill Drift 2 passed first time. In the 10-run bench, 9 of 10 passed first time (D5). | Validation catches real problems | VP-34, VP-18 (D5, D10) | tools/bubble-studio/samples |
| Muse works as an agent with tools: request, brief, compose, glue, moderated content, validate (wiring, headless run, guardrails, bots), repair (with a retry limit), render, learn. | Plays to Muse's tool use | VP-34 | Concept library canvas §2 |
| **(K)** Muse composes games from pre-registered concepts and writes small code only where needed, so each game fits the request and mood. | The modular design behind "unlimited" | VP-34 | Slack, Nov 11 20:19; Concept library canvas |
| The library today: 6 game types, 55 building blocks in 11 kinds, 8 looks, 6 fonts, 8 background motifs. The design calls for about 150 concepts in 14 kinds. | Real scope, honestly stated | VP-34 (D22) | Whim.catalogJSON() at `0a3e8f7`; Concept library canvas |
| The whole catalog fits in Muse's long context, and each piece has a plain-language description written for Muse, so no search step is needed. | Uses Wonder's long context | VP-35 | Concept library canvas §2-3 |
| Pieces of the right size: whole templates repeat the same games, and raw physics makes Muse write everything; medium pieces let Muse spend effort on what's new. | Answer to "why not let AI write the code?" | VP-34 | Concept library canvas §1 |
| Glue Muse writes: a bonus point for skimming a peak (Hill Hopper: Twin Peaks), up to 60 bonus points for a quick pick (picnic icebreaker), fog banks rising and falling in a slow wave (Fog Drift). Design examples: how many days off a guess is, obstacles shaped like a skyline, points for answers nobody else in your Group gave, a course made from a photo. | Small, sandboxed, tested custom code | VP-34 | Seeds; docs/BUBBLES.md §4.2; Concept library canvas §6 |
| In the Trip Rewind design, Muse needed only one 10-line glue function. | How little custom code a game needs | VP-34 | Slack, Nov 11 20:24 |
| Muse picks one of 8 looks from the brief (paper for cozy, pixel for retro, neon for night, ink for whimsical, clay for cute, riso for zine, chalk for brainy, glow for dreamy) plus colors, font and background, and paints the cover in that look. With no hints, it used all 8 looks across 10 games (D6). | Creative work, not just logic | VP-37, VP-39 | docs/BUBBLES.md §4.10; MusePrompts.swift |
| Daily Whim from opted-in posts: "Used 5 of 5 opted-in posts: Maya, Diego, Priya, Sam and Lena. Nothing else was read." The finished game lists the posts it drew on. | AI does work nobody could do by hand, privately | VP-01, VP-18, VP-21 (D8) | newinsf-daily timeline; MuseComposeSession.swift |
| Icebreaker rules: help people learn first names and one thing about each person, never invent facts. Muse never invents vote counts, statistics or quotes. | Trustworthy content | VP-03, VP-21 | MusePrompts.swift |
| "Use our names": Studio gives Muse the audience's first names and opted-in posts; Studio adds the portraits. | Personal content at scale | VP-01 | MusePrompts.swift; StudioTryStep.swift |
| Twist roll: when a maker is stuck, Muse suggests "invert the scoring" or "make it weekly for your Group". Designed. | AI as a creative partner | VP-05 | Taxonomy canvas §9 part 4 |
| The library grows: glue that keeps showing up in finished, shared games gets reviewed and promoted into the library. Designed. | The system improves with use | VP-34 | Concept library canvas §6 |
| Makers choose identity knobs (what the game is); simulated players set tuning knobs (how it feels). Every tuning knob has a safe range. | Easy and safe creation | VP-05, VP-34 | Taxonomy canvas §9; Concept library canvas §3 |
| **(K)** Edit with more than text: sketch input read by Muse Spark (vision), and play insights (where people tap, fail and quit) that feed the next version. Karthik considers turning screen and control usage into feedback very important. Planned. | A deeper AI loop | VP-34, VP-23 | Karthik, Nov 12 09:55; Build tracker "Next steps" |
| Two unused Muse models fit edits beyond text: voice transcription for spoken requests and SAM 3.1 for a circled area. SAM could also cut objects from a Group photo into game pieces. Both are listed on our key. | Room to deepen AI integration | VP-35 | Session, Nov 12 10:40; Concept library canvas §5; bench setup |
| AI inputs and judging (design): voice, camera and location as inputs; Muse judging a drawing, photo or free answer (like Quick, Draw!). | "Make" games become possible | VP-34 | Concept library canvas §5 |
| Muse in ranking (planned, deferred): Ember re-ranks the next games with a one-line "why"; Image paints cover variants for a bandit to choose from. `FB_RECS_LOG=1` already prints why each page was picked. | AI in discovery, explainable | VP-10, VP-35 | Slack, Nov 12 10:38, 11:10, 11:37 (Kevin's agent) |
| **Blends (new):** taste profiles from play history, matching two people and blending their tastes into one brief, which Muse then builds. Kevin's recommender work supplies the profiles. Not built. | AI that matches people, not only content | VP-40, VP-34 | Karthik, Nov 12 |
| AI-repair diagnostics: engine errors carry a code, a JSON pointer and a did-you-mean hint, with an 80-builtin catalog, so a model can repair its own game file. Bayan's layer uses validate and simulate as a repair loop. Not in the app. | Repair designed for models | VP-34 | Slack, Nov 12 11:09, 11:41, 11:52 (Artem's and Bayan's agents) |
| **(K)** Find out what Muse is good at and lean on it: tool use, long context, a fast small model and images. | Our use matches Muse's strengths | VP-35 | Brainstorm canvas |
| **(K)** AI means interactive, personalized experiences plus new personalization algorithms. | Two AI roles: making and ranking | VP-34, VP-10 | Brainstorm canvas |
| Meta's Muse Spark launch advertises "custom websites and mini-games straight from a prompt" that people can share with friends [2]. | Our feature is Meta's stated direction | VP-24 | [2] (resolves an uncited canvas note) |

### A.5 Game formats and concrete games

**Real Muse runs.** Use only logged runs for "made with Muse" claims. Besides the 10 benchmark games (D1 to D9), these were made by Muse:

| Game | Prompt or job | Time | What happened | VP | Source |
|---|---|---|---|---|---|
| Hill Drift (first run) | "a chill game for my new running club about SF hills" | 58.5 s (teammate-reported, not logged; about 08:33 PST) | Ember wrote 12 SF hill names; Wonder assembled 15 pieces that passed validation; 4 bots playtested it (runs 6 to 57 s, scores 2 to 34, bot-run); Image painted the cover in parallel | VP-05, VP-34 (D11) | Slack, Nov 12 08:48 |
| Hill Drift (logged run) | The same sentence | 25.0 s (measured; 09:21 PST) | Ember brief in 1.1 s; Wonder picked dodge from 6 formulas and 55 concepts and wrote 8 obstacle labels; 14 concepts validated; a "too easy" draft was repaired in one round; 5 bots playtested it; cover painted in parallel in 18.7 s; glow look. Rule: "Hold to float over hills. Let go to drift down." | VP-05, VP-34 (D10) | hill-run.json; hill-run.timeline.txt |
| Hill Drift, night edit | "make it harder and night themed" | 40.6 s (measured) | Redrawn in neon at night; failed the playtest twice, passed after the second repair (test bot lasted 25 s) | VP-23, VP-34 (D10) | hill-run-night.timeline.txt |
| Hill Drift 2 | Next level | 25.4 s (measured) | Same neon look, faster, tighter gaps, 10 new hill names (Mount Davidson, Corona Heights, Tank Hill and more); the playtest confirmed it's harder (test bot lasted 20 s) | VP-23 (D10) | hill-run-level-2.json |
| First Hellos | New in SF Daily Whim from five intros | 39.4 s (measured) | "Guess today's word from a newcomer's post." Words: AUSTIN, CHICAGO, TORONTO, BERLIN, BERNAL. Clay look. Used 5 of 5 opted-in posts; one repair | VP-01, VP-02, VP-18 (D10) | newinsf-daily-2026-11-13.json |
| Picnic Pals | Picnic icebreaker from seven attendees' posts | 33.0 s (measured) | "Read a fact and tap the picnic pal it belongs to." Wonder's reason: who-style guessing teaches names and facts. Paper look, 7 rounds, 7 of 7 opted-in posts | VP-03 (D10) | picnic-icebreaker.json |
| Send It | "a game for my new climbing gym friends about bouldering in SF", made in the app | First make not logged | Holds like Crimp Wall, Sloper and Dyno. Clay look | VP-05 | Slack, Nov 12 09:48 |
| Send It, restyle and tweak | "Make it a little slower"; clay to pixel | 15.8 s (measured, restyle) | Published with a cover | VP-23 (D26) | In-app run record send-it-wucr.json |
| Send It 2 | Level 2 | 28.4 s (measured) | Published with a cover. This is the "28 s" reported in Slack. The whole Send It sequence took about 2 minutes | VP-23 (D26) | In-app run record send-it-2-fvpy.json; Slack, Nov 12 09:48 |

Count: 17 logged Muse games (10 bench, 5 CLI samples, 2 in-app records), plus the unlogged first Hill Drift and first Send It. A new game took a median of 28.0 s in the bench (15.7 to 40.9 s, D2); the restyle took 15.8 s. None of these were in the app build at `0a3e8f7`, so import the ones we demo (First Hellos, Picnic Pals, Hill Drift, Send It). The CLI tool made the samples and never prints the key.

**Seed Whims in the app (13, hand-written by build agents, not Muse output).** All 13 validate and cover all 6 game types, each in its own look.

| Seed | Rule or hook | Proves | VP |
|---|---|---|---|
| Fog Words (New in SF Daily Whim) | "Guess today's San Francisco word in six tries." Ink look, 15 SF words with clues (DOLORES: "The park where Saturday's newcomers' picnic is"). One run a day | The daily ritual | VP-02, VP-06 |
| Who's coming Saturday? (picnic icebreaker) | "Read a fact, pick the newcomer it belongs to. Quick picks score more." Paper look, 7 attendees, facts like "Has a cat named Biscuit" | Event icebreaker | VP-03 |
| This or That: Picnic | "Pick your side, then see who's with you." Rounds: sourdough and cheese or fruit salad; tacos, ice cream, open mic or nap | Finding your people | VP-03 |
| Fog or Sun? | "Guess what most of New in SF picked." Rounds from opted-in polls: Ocean Beach or Dolores Park, best way up a hill, burrito order, sunset spot | Read the Group | VP-01, VP-02 |
| Trivia Thursday: SF | "Pop the right answer before the bar runs out." Neon. Warms up Chloe's trivia team, which needs two more | A game that recruits people | VP-19 |
| Hill Hopper and Hill Hopper: Twin Peaks | "Tap to float over the hills. Don't touch the fog." Level 1 paper; level 2 neon at night with wind and a peak-skim bonus | Chains | VP-23 |
| Moving Day | "Float your box up past the clutter." Clay. Alex's own game | Your story as a game | VP-09 |
| Sourdough Stack | "Drop each loaf right on top. Overhangs get trimmed." Clay, by Diego | A Group member's hobby | VP-01, VP-23 |
| Fog Drift | "Hold your breath and drift between the fog banks." Glue makes fog rise and fall | Custom glue | VP-34 |
| Cable Car Catch | "Tap when the cable car lines up with the stop." Pixel, Powell St to Fisherman's Wharf | Timing game | VP-39 |
| Sort the City | "Sort each bubble: neighborhood, food or landmark." (Mission, Dim sum, Coit Tower) | Sort game | VP-39 |
| Bay Bubbles | "Let bubbles float up. Two of a kind merge." Bubble to drop, shell, crab, fish, seal, whale | Merge game | VP-39 |

**Formats, design examples and creation tools.**

| Example | What it proves | VP | Source |
|---|---|---|---|
| 6 game types in the app: dodge, guess, sort, answer, timing, merge. The taxonomy names 7 formulas (adds "make", which has no runtime kit). | Range from one engine | VP-39 (D22) | Slack, Nov 12 10:11; Taxonomy canvas §9 |
| Each game type ships with an example Muse starts from: Hill or Flat? (sort), Brunch or Bust? (guess the crowd), Ferry Hop (timing), Snack Stack (merge). | Grounded drafts | VP-34 | bubble-kit-*.js |
| **(K)** New categories: choose-your-own-adventure, Learn (education), and guess what they say next. Not built. | Range beyond arcade | VP-09, VP-12, VP-37 | Slack, Nov 12 10:36, 10:42, 10:47 |
| **Blends (K, new):** a game made from two people's play histories, with a bracket for several. Not built. | A new format made for two | VP-40 | Karthik, Nov 12 |
| **(K)** Endless and finite games as a primitive: every game honors one length setting (endless, rounds, timed or lives), with a Customize panel in Studio. Bayan's authoring layer uses the same names. Not built. | Lots of customizability | VP-10, VP-16 | Slack, Nov 12 10:43, 11:49 |
| Read the Room: give the answer most of your Group will give. Krillion inverted, scoped to a Group, AI writes the prompts. Share: "matched the Group on 5 of 7". Results unlock once everyone answers. Design. | How well you know your people | VP-02, VP-01 | Taxonomy canvas §9 part 8 |
| Daily Photo Course: a Flappy-style course built from a Group photo; beat friends' ghosts; share a ghost replay plus a challenge link. Design. | Group content as a level | VP-01, VP-14 | Taxonomy canvas §9 part 8 |
| Group Week Word: guess the word that sums up your Group's week, with feedback on closeness in meaning; weekly; AI picks the word. Design. | A Group's week as a puzzle | VP-18 | Taxonomy canvas §9 part 8 |
| All three worked examples need AI to make content for each Group. | AI is load-bearing | VP-34 | Taxonomy canvas §9 part 8 |
| Trip Rewind: "Make something chill for my roommates about our Japan trip" becomes "Guess which day of the trip each photo is from". Serves existing friends; for our story, use a newcomers' Group's photos. | Brief to game in one example | VP-05 | Concept library canvas §8 |
| Starter prompts by audience. Group: "A daily word game for New in SF", "Guess who wrote each intro", "Sort SF neighborhoods by vibe". Event: "Icebreaker for the newcomers' picnic", "Match fun facts to who's coming", "A quick game for the picnic blanket". Everyone: "A chill game about SF hills for my running club", "Catch cable cars before they roll away", "Guess the SF neighborhood from three clues". | An easy start | VP-05 | StudioModel.swift |
| "Surprise me" prompts: "Dodge the fog rolling over Twin Peaks", "Sort taquerias, bakeries and coffee spots by neighborhood", "Stack picnic snacks without tipping the blanket", "Pop the right bubble before the tide comes in at Ocean Beach", "A cozy guessing game about my first week in SF", "Merge little bubbles into one giant Dolores Park bubble". | Zero-effort creation | VP-05 | StudioModel.swift |
| One-tap chips. Tweak: "A little slower", "Make it harder", "Calmer colors", "Use our names". Remix: "Make it about Ocean Beach", "Twice as fast", "Use our group's inside jokes". Next level: "Faster, with more fog", "Add a twist at the end", "Same idea, bigger hills". | Iteration in one tap | VP-05, VP-17 | StudioTryStep.swift; StudioModel.swift |
| Muse Studio flow: Ask (Describe), Brief, Compose, Try it, Float it. Five modes: create, edit, remix, next level, daily. Game type and look default to "Muse picks". | A complete creation tool | VP-05 | StudioModel.swift; StudioContracts.swift; docs/BUBBLES.md §4.4 |
| **(K)** Makers keep updating their games: edits, a new look, level 2. Edits keep their history ("Earlier versions stay in its history. Plays and the board carry over."). | Games evolve | VP-23 | Brainstorm canvas; StudioFloatStep.swift |
| Chains: each level is its own Whim; Muse makes the next harder but fair (10 to 120 s for a typical player); levels unlock in order. Level 2 check: the test bot lasted 20 s, down from 25 s. | Progression | VP-23 | docs/BUBBLES.md §2; hill-run-level-2 timeline |
| Three maker levels: Remix (change content or one knob), Compose (what kind, about what, for whom, what twist), Free (describe anything). Default level still open. | Creation for everyone | VP-05 | Taxonomy canvas §9 part 5 |
| Creation loop: seed, mutate, fill, tune, check, then ship and fork. A seed can be "something about our dorm". | Forking is built in | VP-17 | Taxonomy canvas §9 part 6 |
| Constrain the result, not the ingredients. | Freedom with quality | VP-34 | Taxonomy canvas §9 |
| Guardrails: a one-sentence rule; first input within about 5 s; a daily under about 5 min; an endless run under about 1 min with one-tap retry. | Short-form by design | VP-10 | Taxonomy canvas §9 part 7 |
| Two schedules, endless runs and daily shared puzzles; any mechanic runs on either. A Flappy-style course that's the same for everyone today makes runs comparable. | Same-seed competition | VP-16, VP-06 | Taxonomy canvas §3, §9 part 1 |
| Share cards that don't spoil: "This or That: Picnic, 461 points, 6/6 with the crowd" with hearts; "Bay Bubbles, made a whale"; "Cable Car Catch, 12/12 caught, 11 perfect". | Spoiler-free sharing | VP-13 | Runtime share.emoji_grid; kit tests |
| Named result tiers make shares fun, like Krillion's run from "Plankton" to "One in a Krillion". | A small idea for share cards | VP-13 | Concept library canvas §5 |
| Grounding: games can use today's weather, local events or location, as Hill Drift uses SF's hills. | Games about your new city | VP-08 | Concept library canvas §5 |
| Accessibility pieces: high contrast, reduced motion, one-handed play, screen-reader labels. Designed. | Inclusive design | VP-08 | Concept library canvas §5 |
| Engine v0.2 (Artem): arcade, typing, flappy-style, platformer and breakout-style games, inline SVG images, sound, physics, camera, particles, haptics. In progress, not in the app. | Future range | VP-37 | Slack, Nov 12 11:54 |
| The result sheet: the score counts up, a new best bursts bubbles, your rank with rows around you, a streak flame on Daily Whims, then play again, float, share to Story or next level. | A polished end to every game | VP-10, VP-13 | BubbleResultSheet.swift |
| Every game follows the same flow: intro, play, result, share, then retry, or locked until tomorrow. | A consistent frame | VP-39 | Concept library canvas §4 |
| Design rules: a one-sentence rule, a fast start, depth from tuning not systems, one throttle, daily means shared content, shares don't spoil, failure is readable, theme kept apart from rules. Combinations that don't work: daily with different content per player, endless with a spoiler-free grid, two core verbs at launch. | Why the games feel short-form | VP-39 | Taxonomy canvas §7 |

### A.6 Analogies and comparisons

| Analogy | What it proves | VP | Source |
|---|---|---|---|
| **(K)** LinkedIn's games have a thriving community despite LinkedIn's social stigma. | Games bring people back to a platform they'd skip | VP-06 [79][81] | Brainstorm canvas; Slack, Nov 12 11:36 |
| **(K)** NYT Games drive interest toward the broader NYT. | Games as the on-ramp; ours lead into Groups, Events, Messenger and friends | VP-06 [85] | Brainstorm canvas; Slack, Nov 12 11:36 |
| **(K)** As much variety as Reels, with AI keeping creation unlimited. | Variety at feed scale | VP-39 | Slack, Nov 12 11:36 |
| **(K)** Scrolling games feels like scrolling videos (Reels, TikTok). | Instant switching | VP-39 | Engine chat; docs/BUBBLES.md §4.8 |
| **(K)** A TikTok-style feed of short, interactive games that loads extremely fast and is versatile: a similar style, light graphics, each game unique. | The feed concept | VP-39 | Engine chat, Nov 12 07:25 |
| **(K)** Like TikTok: every video looks different, but the frame never changes. | One look per Whim, one Whim frame | VP-37, VP-39 | Build tracker; docs/BUBBLES.md §2 |
| **(K)** Saves are the likes. | The right engagement signal for games | VP-10 | Slack, Nov 12 11:01 |
| **(K)** Spotify's Blend: two people's tastes merged into one shared thing, with a taste match. For us, a game. | Basis for Blends | VP-40 [125] | Karthik, Nov 12 |
| **(K)** "Drops": random moments that unite a lot of people, like the BeReal effect. Lives on as the Daily Whim. | A shared daily moment | VP-06 | Brainstorm canvas; Problem canvas |
| **(K)** Reference set: LinkedIn, Krillion, Wordle and NYT-type games, built on information retrieval or reaction time; arcade games too. | What makes a game | VP-39 | Brainstorm canvas "What makes a game?" |
| Wordle went from fewer than 100 players to more than two million in under three months [87]. (Our notes had a Smithsonian figure of 90 players to 2 million in about two months; we use the cited one.) | Sharing spreads a shared puzzle | VP-13 | Taxonomy canvas §2; [87] |
| Flappy Bird sat unnoticed for about 8 months, and at one point over a third of new App Store games were Flappy clones. Unverified. | Timing matters; reskins are easy, so remixing works | VP-17 | Taxonomy canvas §2 |
| Games spread through what people share (a score, a spoiler-free grid, a clip) more than through the mechanic. | Our share card and Bursts do that job | VP-13 | Taxonomy canvas summary, §2 |
| No tutorial needed: you get it by watching five seconds of someone playing. | Bursts teach before you play | VP-13 | Taxonomy canvas §2 |
| Every viral short game: one verb, one sentence, seconds from opening to playing, a built-in share artifact. | Our design rules | VP-39 | Taxonomy canvas summary |
| Krillion (2026) flips trivia: rare answers score up to 10 times more (7 prompts, 25 s each, daily). Its inversion, Noillirk, rewards the obvious answer. | Basis for Read the Room | VP-02 | Taxonomy canvas §1, §9 |
| Wordle becomes Heardle with a two-field change; one small data object describes a whole game. | How compact Muse's game spec is | VP-34 | Taxonomy canvas §6; Slack, Nov 11 19:42 |
| 8 reference viral games (Pac-Man through Krillion) share 10 traits and fall into 4 families. | Research behind the framework | VP-01 | Slack, Nov 11 19:40 |
| 11 operators: Wordle to Heardle (reskin), Semantle and Globle (new feedback), Krillion to Noillirk (invert), Quordle (multiply), Crosswordle (fuse), hard mode (constrain), Gartic Phone (socialize), HQ Trivia (re-time), one puzzle per Group (re-scope), a friend or AI sets it (hand off), Pokemon Go (ground). | Variety without copying | VP-37 | Taxonomy canvas §9 part 4 |
| A Kahoot of funny clips. | Quiz night format | VP-15 | Slack, Nov 12 10:47 |
| Quick, Draw! (an AI guesses your doodle). | AI-judged "make" games | VP-34 | Concept library canvas §5 |
| A Connections-style puzzle made from a Group's recent posts and inside jokes. | What the Daily Whim can be | VP-18 | Taxonomy canvas §8 |
| Unlike Netflix, our games are meant to be hooky, so each person gets a learned "bait appetite" (7 pieces of Netflix research reviewed). | Engagement without flooding | VP-10 | Slack, Nov 12 10:38, 11:10 (Kevin's agent) |
| Prior art: PuzzleScript and VGDL already describe small games as data. What's new is AI-made content scoped to your Group and friends. | An honest originality claim | VP-01, VP-37 | Taxonomy canvas §9 part 9 |
| Familiar genres (Flappy, Crossy Road, Wordle, Connections, Krillion, Suika), but every game is original. | Genre mechanics, no clones | VP-37 | Concept library canvas §5; Build tracker |
| Monetization in reference games: ads between runs, cosmetics, subscription bundles (NYT Games), paid archives and themed packs (Krillion); Crossy Road reportedly made $1M from video ads (unverified). | Answer to the business question | VP-31 | Taxonomy canvas §4-5 |

### A.7 Craft and proof points

| Proof point | What it proves | VP | Source |
|---|---|---|---|
| Every score is verifiable: a run is a seed plus an input log, re-simulated in about 4.06 ms of CPU in Node (D14, bot-run); 390 of 390 bot runs reproduced exactly (D12). The board marks verified runs. | Fair leaderboards and challenges | VP-16 | docs/BUBBLES.md §4.8; section 8.3 |
| Deterministic engine: a fixed 60 steps per second and all randomness from a recorded seed, so seed plus touches reproduces a run exactly, in every look. Seeding gives four things free: the same content for a Group, ghost replays, repeatable bot tests and cheat checks. | Replays, takeovers, fair boards | VP-16, VP-13 | docs/BUBBLES.md §4.6, §4.8; Concept library canvas §2 |
| Switching to the next game: about 3.6 ms median (1.9 to 9.7 ms) against a 50 ms target, on the simulator. | Feels like scrolling video | VP-39 (D18, teammate-reported) | Build tracker "Speed targets" |
| 17 to 27 ms to start a game once the engine is warm (target: under 1 s from tap to playable). True cold start not measured separately. | Fast play | VP-39 (D18, teammate-reported) | Build tracker |
| 57 to 60 fps against a 60 fps target. The memory target (under 150 MB) is not measured yet. Simulator. | Smooth play | VP-39 (D18, teammate-reported) | Build tracker; docs/BUBBLES.md §4.8 |
| One engine stays loaded and plays each new game as a small data file; the next games load in the background; only the visible game runs. | A new game is data, not a download | VP-39 | docs/BUBBLES.md §4.8 |
| Compiled at publish, trusted at play: Studio checks structure, settings, wiring and glue, playtests, fills defaults and pins the engine version; phones only load and play. | Reliability | VP-36 | docs/BUBBLES.md §4.8 |
| Every game gets 5 bot runs before it ships (weak, typical, strong, plus typical on two more seeds). A good Whim lasts 10 to 120 s, can be lost and can score. At most 2 repair rounds. | A quality gate | VP-05, VP-18 (D5) | StudioPlaytest.swift; docs/BUBBLES.md §3 |
| 156 bot runs take about 1 s; posters render in 20 to 130 ms; a 90-second game simulates in about 8.5 ms in JavaScriptCore (D14). | Playtests are almost instant | VP-36 | Feed agent report (teammate-reported); kit tests |
| Skill shows in scores (bots): Sourdough Stack's weakest bot median about 880 against about 4,970 for the strongest; Sort the City cleared 7% against 100%. Median score rose with skill on 12 of 13 games (D16). | Games reward skill | VP-16 | Kit tests |
| Tests, rerun at `0a3e8f7`: the Node runner reports 318 passed, 0 failed, and the JavaScriptCore runner 308 passed, 0 failed; kit tests pass in both engines with 23 fingerprinted runs identical, and 11 of 11 manifests validate (D17). | Execution quality | VP-24 | tools/runtime-tests; tools/kits-tests |
| Bots playtest every game, make demo Bursts and generate realistic friend scores. Demo friend scores are bot-made (Maya plays at skill 0.9). | Honest about synthetic data | VP-16 (D25) | Build tracker; BubbleFeedRoster.swift |
| Bots can't measure fun: only real plays, finishes, saves and shares show that, and those feed the recommender. | Honest limits | VP-10 | Concept library canvas §10 |
| Recommender simulation: 5 synthetic worlds, 90 people each, 14 days, about 20% clickbait. Bait-averse people: 7.2 pages per session against 5.9 today, clickbait down from 36% to 14%. Bait lovers: 10.2 against 6.8, 80% hooky. Ranking on clicks alone leaves bait-averse people at 49% clickbait. | The feed doesn't fill with junk | VP-10 (D21, simulated, teammate-reported) | Slack, Nov 12 11:28 (Kevin's agent) |
| Simulated users on the real seed games, after 4 sessions: a bait lover's next 12 pages are 10 of 12 hooky, a bait-averse person's are 0 of 12 (Daily Whim, icebreakers, Trivia Thursday, Group games). 42 of 42 recommender checks pass. | Personalization works on our content | VP-10 (simulated, teammate-reported) | Slack, Nov 12 11:37 |
| The recommender's reward counts takeovers, finished runs, replays, saves (weighted like likes), floats to a Group and Add friend; quick skips and quitting count against. New games are explored by Thompson sampling with priors from bot playtests; a calibration re-rank balances formula and mood; cold start leans on the manifest. `FB_RECS` switches stages. Kevin's branch, not in the app. The same taste model is what Blends would use. | Rewards connection, gives new games a fair shot | VP-10, VP-31, VP-40 | Slack, Nov 12 11:10 |
| A Reels-style feed that says why each page is there: a friend's run, a Group member's run, today's Daily Whim, an Event icebreaker, new near you, a later level, yours, or popular. Never the same Whim twice in a row. | An explainable feed | VP-10, VP-25 (D20) | BubbleFeedSource.swift; BubblesTabView.swift |
| No blank frames: pages not playing show an exact still from the game's own demo run and turn into the live game without a jump. | Polish | VP-39 | docs/BUBBLES.md §4.6, §4.8 |
| "Made with Muse in 41 s · Wonder, Ember, Image" and "Cover art by Muse" on a Whim's page; offline games say "Made with Muse Studio". | Provenance shown to people | VP-35, VP-37 | BubbleStore+Screens.swift; BubbleGlow.swift |
| Offline composer: the same request becomes a valid, playtested game with no network, marked as offline. A crash during play shows "This bubble popped" instead of a blank screen. | The demo never breaks | VP-05 (D7) | docs/BUBBLES.md §3, §4.6; OfflineComposer.swift |
| Glue runs in a sandbox: no network, page, timers, eval or storage; code that throws is switched off for the run. Family-friendly by default, no jokes at anyone's expense. | Safety | VP-21 | MusePrompts.swift; docs/BUBBLES.md §4.6 |
| Original games only: no other game's name, characters, art or levels; nothing resembling Wordle, Flappy Bird, 2048, Suika or Connections; no real people, celebrities or brands. Number Merge's 2048-like palette was replaced with an original blue-to-violet one. | Originality | VP-37 | MusePrompts.swift; Slack, Nov 12 11:37, 11:41 |
| Group content kept apart from game logic in its own content block, so it can be moderated in one place (Bayan's authoring layer). Not in the app. | Moderation by design | VP-21 | Slack, Nov 12 11:52 |
| Moderation is required in every game by design; the first build used a placeholder. Be honest about what runs in the demo. | Honest status | VP-21 | Concept library canvas §5, §9 |
| Why our own engine, in JavaScript: replays and Bursts need a fixed clock we control; Studio runs the same code headless; games are light; WKWebView compiles JavaScript fast; Muse writes JavaScript reliably; WebGPU isn't on iOS 18. The draw API is the boundary for a later move to native or Wasm. | Engineering judgment | VP-16, VP-36 | Build tracker; docs/BUBBLES.md §3, §4.8 |
| Artem's Rust/WASM engine (not in the app): 6 crates, about 18,500 lines, 124 tests, about 2 µs per step plus frame, validation in 34 to 67 µs, 50 seeds times 1,000 random inputs with 0 runtime errors, identical state hashes native and WASM, 873 KB (313 KB gzipped), preloads several games. | A future path. Don't overclaim | VP-37 (D24, teammate-reported) | Slack, Nov 12 11:41 |
| Backend asks for the collaboration features: challenges, group-chat sessions, remix lineage, games with several makers and Group leaderboards (asked of Max's backend); same-seed runs, shared sessions and verifiable replays (asked of Artem's engine); taste profiles and blending for Blends (asked of Kevin's recommender). Bayan's reusable pieces (lives, score, countdown, spawn waves) keep a Group's own words in one content block. All local, not merged. | The social features have a production path | VP-14, VP-15, VP-38, VP-40 | Agent Logistics "Requests"; Slack, Nov 12 11:49, 11:52 |
| Max's backend (not deployed): a Go and Chi API (auth, feed, search, feed events, games with likes and leaderboards, creations), a static game server, MongoDB, Docker Compose, a tunnel and a CI deploy. Go tests pass; untested against real Mongo and Docker. | A production path exists | VP-36 | Slack, Nov 12 11:28, 11:39 |
| Scale path (Karthik's engine chat): MongoDB holds metadata and editable definitions; a build step validates and compiles packages; a CDN serves immutable packages; the client caches and runs them. Gameplay never calls the server. | It scales | VP-36 | Engine chat, Nov 12 07:25; docs/BUBBLES.md §4.8 |
| Muse latency on our key: listing models 0.6 to 1.2 s and small JSON replies 2 to 4 s (teammate-reported); Ember brief median 1.9 s (1.3 to 2.7 s); Wonder median 18.35 s per game; a game end to end median 28.0 s (15.7 to 40.9 s); a cover median 20.2 s while composing, in parallel (one standalone cover call took about 11 s, not logged). All text models reason first, so every request allows 4,000 or more output tokens (with less, the reply can come back empty). | Real measured numbers; what was hard | VP-35, VP-36 (D2 to D4) | muse-bench.json; Build tracker; Slack, Nov 12 07:37 |
| Runs on four team iPhones (iOS 18 and 26), not just the simulator. | A real app | VP-24 (D23, teammate-reported) | Slack, Nov 12 10:40 |
| The iOS 18 Home feed "creep" bug: the loading shimmer replayed a layout change every 1.3 s, 3,635 changes in 78 s, found from the phone's logs and fixed on a real phone. | Execution care | VP-24 | Slack, Nov 12 11:01 |
| Built fast: about 21,000 lines of Swift and 12,000 of engine JavaScript, CSS and HTML for Whims (about 53,000 Swift lines in the whole app); Whims landed as 10 feature commits on Nov 12 (an earlier Slack post counted 11; recount before quoting). | Execution speed | VP-24 (D22) | git at `0a3e8f7` |
| About 10 AI coding agents built in parallel (6 Opus, 4 Sonnet), each owning its own files, coordinated through a shared spec and Slack canvases; everything merged with no conflicts. CLAUDE.md shows the process. | How a small team built this. A judgment call whether to mention it | VP-24 | Slack, Nov 12 07:37, 10:11; CLAUDE.md |
| Muse Studio runs on the command line (tools/bubble-studio) as the same Studio code; it made the 5 CLI samples and the 10-run benchmark. | Reproducible AI runs | VP-34 | tools/bubble-studio |
| Launch shortcuts (`FB_TAB`, `FB_OPEN`, `FB_SKIP_SPLASH`, `FB_STUDIO_*`) open any demo screen directly. | Reliable demo and recording | VP-24 | FacebookClone/App/DebugLaunch.swift |
| Screenshots of every stage in light and dark, plus four phone shots of a real in-app Muse run (reading the request, Send It in clay, making level 2, Send It in pixel). | Slides and fallback assets | VP-24 | Slack, Nov 12 10:02; in-app run captures |
| Copy voice: warm, short, specific, sentence case. Titles 1 to 3 words, rules one sentence of 70 characters or less, briefs start "I read this as". | A cohesive product voice | VP-37 | MusePrompts.swift |

### A.8 The reason to come back

| Example | What it proves | VP | Source |
|---|---|---|---|
| **(K)** A reason to clock in. | The goal of the whole feature | VP-06 | Slack, Nov 12 11:36 |
| Daily Whim: one 30 to 90 s game per Group per day, the same for everyone, one run each with no instant retry, a streak for days in a row. | A daily ritual | VP-06, VP-02 | MusePrompts.swift; flow.daily_gate; BubbleStore+World.swift |
| For daily puzzles the cap is the point: you can't binge, so you come back tomorrow. The hooks are streaks and comparing with friends. | Healthy return, not compulsion | VP-06, VP-10 | Taxonomy canvas §3B |
| Short-round games in the feed plus one pinned daily game per Group. | Endless feed and daily ritual coexist | VP-06, VP-39 | Slack, Nov 11 20:13 (Bayan) |
| Tomorrow's Daily Whim, streaks, friends beating your score, weekly Group leaderboards, game nights. | Many small pulls back | VP-06, VP-19 | Build tracker; posts agent report |
| Notifications: "Diego beat your score in Hill Hopper. Take it back?", "You passed Maya in Fog Words." | Social triggers | VP-04, VP-06 | BubbleNotificationsSurface.swift |
| Rivalries as friendship: "You and Maya: 12 games together". | A relationship that grows | VP-14 | Brand ideas |
| A Blend waiting from someone you met, and a bracket round due tonight. Not built. | A reason to come back that is a person | VP-40 | Karthik, Nov 12 |
| Rituals a name can own: "Today's ___" for the Group daily, a weekly Group cup, game nights. | Brandable habits | VP-06, VP-19 | Brand ideas |
| Challenges waiting: a friend's "Beat my 34" in the group chat with "your move". Not built. | A pending social obligation | VP-14, VP-15 | Feature spec |
| Chains: the next level unlocks after you finish this one. | Progression | VP-23 | BubbleChainView.swift |
| Makers update their games (edits, new looks, level 2), so there's always something new from friends. | Fresh content from people you know | VP-23, VP-25 | Brainstorm canvas; Slack, Nov 12 08:48 |
| A feed that learns what you like, and how much hooky content you want. | Personal return | VP-10 | Slack, Nov 12 11:10 |
| **(K)** "Drops" like BeReal: one shared moment for the whole Group. | The daily game as a drop | VP-06 | Brainstorm canvas |
| Problem canvas test: fails if useful once, then done. | The bar we clear | VP-06 | Problem canvas |

### A.9 Where it started: Karthik's original asks

| Example | What it proves | VP | Source |
|---|---|---|---|
| **(K)** Kickoff feature list: make games, infinite scroll, clips from games, games on Stories and profiles, leaderboards, editing, linked levels and a game library. Built as Muse Studio, the Whims feed, Bursts in Reels, Whim Stories, profile Whims, boards, edit, remix and next level, Chains and the Library. | Everything Karthik asked for exists | VP-05, VP-13, VP-23, VP-39 | Session, Nov 11 22:16 |
| **(K)** Agentic creation: a compositional harness on top of a Muse agent. Built as Muse Studio (Wonder plans with tool calls and writes, Ember briefs, Image paints, a validator and bot playtests, a repair loop, an offline composer). | The AI design came from the start | VP-34 | Session, Nov 11 22:16; Build tracker |
| **(K)** A general framework anyone can use to make short-form games: 7 formulas (6 in the runtime), identity and tuning knobs, 11 operators, 3 maker levels. | Creation for everyone | VP-05 | Slack, Nov 11 20:08 to 20:10; Taxonomy canvas §9 |
| **(K)** Scroll Games notes: built for the phone; a branded style that still leaves room for creativity; templated internals and game flow; easy for different makers to update. | Today's shared frame plus a look per game | VP-37, VP-23 | Brainstorm canvas "Scroll Games" |
| **(K)** The first part of a game is a video that leads into play, and we should think consciously about how the Reels-style scroll feels. This became Bursts: watch a run, tap to take over. | Origin of Bursts | VP-13 | Brainstorm canvas "Scroll Games" |
| **(K)** Engine brief: a TikTok-style feed of short games that loads extremely fast and is versatile. Targets: cold start under 1 s, warm switch under 50 ms, 60 fps, under 150 MB. | Origin of the speed targets | VP-39 | Engine-design chat, Nov 12 07:25 |
| **(K, new)** Blends: a game from two people's play histories, with a bracket for several new people at an Event. | Today's addition | VP-40 | Karthik, Nov 12 |
| **(K, new)** A "New" badge next to the feature wherever it appears in Facebook. | Today's addition | VP-08, VP-13 | Karthik, Nov 12 |

### A.10 Rules, rubric and brand

| Item | Why it matters | VP | Source |
|---|---|---|---|
| Format: a 5-minute demo plus 3 minutes of Q&A (the brainstorm assumed 8 minutes; superseded). Submit a project page, a public GitHub repo and an optional demo video. The core AI must be Muse Spark, Wonder or Ember. | Hard constraints | VP-35 | Brief; Problem canvas |
| Meta's kickoff notes (paraphrased): isolate one problem clearly, build on a surface that mimics real Facebook features, have Muse power the core AI, show clear AI use in the live demo, and set up the project page early. | What Meta told us to do | VP-34, VP-08 | Brainstorm canvas "Notes from Meta" |
| No unnecessary mockups: the surface can look like Facebook, but request, brief, generation, play and share must really run. Evidence: Hill Drift, First Hellos, Picnic Pals, Send It and the 10 bench games were real Muse runs. Anything not built is shown only as a labeled "Coming" frame. | Execution criterion | VP-24 | Brief; Slack, Nov 11 20:51 (Bayan's agent) |
| Rubric wording to map against. AI: does real work and feels like a natural part of the product, not a cosmetic add-on. Product: solves a clear young-adult need, fits naturally on Facebook, gives people a reason to come back. Execution: a working, polished demo with no unnecessary mockups. Originality and cohesion: every part supports solving the user problem. | Each beat should hit one of these | VP-34, VP-02, VP-24 (section 10.1) | Brief |
| Muse lineup: Spark (multimodal, tool use), Wonder (frontier reasoning, long context; Meta pitches it for building "everything from a game to an app" [28]), Ember (smallest and fastest, launched Nov 9, 2026 [29]). Meta suggests the big model plans and Ember runs fast, repeated steps [29]. | We use Muse as designed | VP-35 | Problem canvas "The Muse models"; [28][29] |
| **(K)** "Bubbles" (the working name before Whims) works because it is unlike what the games are about. Themed names (Postcards, Charms, Rounds) felt too narrow; the name should feel like anyone can create and share for any purpose, as general as Muse or Bubbles. The name chosen for now is Whims. | How to judge the final name | VP-37 | Session, Nov 12 09:53 |
| **(K)** "Bubbles" is gender-neutral, clean, concise and flexible, but "blowing" has the wrong connotation, so no "blow" verb. Round 3 looks for a name like that, maybe playing off games as storytelling, that works in social sentences ("Send me a ___"). | A copy rule | VP-37 | Session, Nov 12 11:03; Brand ideas |
| **(K)** Brand color: Facebook blue to purple (#0866FF to #8A3FFC), pastel and blue-led, no pink, rose or coral; a little unique while blending with Facebook. | Visual identity | VP-08 | Session, Nov 12 09:40 to 11:03; Build tracker "Decisions" |
| **(K)** Original style request (Nov 11): pastel, bubbly and glowing, based on the Muse brand. Replaced on Nov 12 by a look per game in a shared frame; glow survives as one of the 8 looks. | How the look evolved | VP-37 | Session, Nov 11 22:16 and Nov 12 08:34 |
| **(K)** A consistent brand with names that work with Facebook. Vocabulary as first set (Nov 11): a game is a Bubble; pop in (play); float (share to a Group); Daily Bubble; Icebreaker; Bubble Board (leaderboard); Burst (replay clip); Bubble Chain (linked levels); Library; Muse Studio; Remix; and now Blend. Today (Whims): a game is a Whim, Daily Whim, the board, Chains, and Share replaces Float in Studio. | Consistent pitch wording | VP-08 | Session, Nov 11 22:16; docs/BUBBLES.md §2 |
