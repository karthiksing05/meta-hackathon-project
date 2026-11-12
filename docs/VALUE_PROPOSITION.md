# Bubbles: Value Proposition

**Why tiny games made with Muse belong on Facebook, and why no other platform can do this as well**

*Last updated 2026-11-12. "Bubbles" is a working name; a rename is under review.*

## 1. Thesis

**Facebook Groups have members but no shared moment. Bubbles gives every Group and Event a daily shared moment that Muse writes from the community itself, played on one seed, so a score next to a stranger becomes an introduction.**

Bubbles is about bringing people closer together, which is the mission Facebook has stated since 2017: to "build community and bring the world closer together" [12][50]. It does that in three ways:

- **Play together.** Everyone in a Group or at an Event gets the same game.
- **Compete together.** Same-seed scores are fair, so a board row next to a stranger is a reason to say hello.
- **Make together.** Friends and Groups make games for and about each other.

Anyone can describe a tiny game in one sentence. Meta's Muse models write a brief, build the game, test it with bots and paint its cover, in a median of 28 seconds in our benchmark. The games are made from things only Facebook holds: a Group's opted-in posts, an Event's guest list and a person's friends. They are played where those people already are: Groups, Events, the feed, Stories, Reels, profiles and notifications today, with Messenger and Search being built.

For a young adult new to a city, that means three things:

- a low-stakes first move in a Group of strangers;
- arriving at a meetup already knowing a few names;
- turning a leaderboard row into a friend request.

After a judge's feedback that the closer-together and social-network parts matter most, the team made collaboration features its current build priority: Challenge Me in Messenger, group-chat play, Games in Groups and Make it together (section 6.6).

Prompt-to-game generation is no longer rare (YouTube, Roblox and Meta's own Pocket all do it), so our case does not rest on the generator. It rests on the social context, and only Facebook has all of it in one place.

The pitch itself, from the one-liner to the 5-minute story and the Q&A, is section 5.

### How to read this document

- Section 2 shows how Bubbles brings people closer, step by step. Section 3 is the short answer to "why Facebook". Section 4 lists every value proposition in one table. Section 5 is the pitch: the one-liner, the 5-minute story, the demo script, the Q&A and open items. Section 6 details each value proposition.
- The appendix "Every pitch example" collects every example we gathered for the pitch, each linked to its value proposition.
- The value propositions are in tiers. The **five core** ones are the pitch. **Supporting** ones add to it. **Value to Meta** and **Muse** explain why Meta would fund it. The **roadmap** holds what is being built and can't be shown yet.
- Value proposition IDs are kept from earlier drafts so references stay stable. Six IDs were merged into others; the appendix on what we dropped lists them.
- Numbers in square brackets, such as [14], are public sources listed in section 12. IDs such as D7 point to our own data in section 8.
- Our own data is always labeled:
  - **measured** in the prototype;
  - **bot-run** (bots played the games);
  - **simulated** (synthetic users);
  - **teammate-reported** (a teammate's number we have not reproduced);
  - **estimate** (a judgment or calculation).
- Every person, Group, Event and score in the demo is synthetic. We have no real-user data yet. Where a claim is a hypothesis, we say so and name the metric that would test it.
- Status uses three values, at commit `0a3e8f7` on `beta-version`:
  - **Live**: you can see it in the demo app through the normal UI;
  - **Debug/CLI only**: it works, but only through our command-line tool or a debug launch;
  - **Not built**: designed, or being built by a teammate, but not on that branch.

### Terms a judge may not know

| Term | Meaning |
|---|---|
| Bubble | One tiny game, described by a small JSON file (a manifest). |
| Formula | A game type the runtime knows how to run. Six ship today: dodge, timing, merge, guess, sort and answer. A seventh, "make" (create something, then friends judge it), is designed but not in the runtime. |
| Concept and kit | Concepts are the 55 tested building blocks a game is assembled from (for example a daily gate, a seeded deck, a scoring rule). A kit is the code that runs one formula's concepts. Muse composes games from these blocks rather than writing free-form code, which is why its games validate. |
| Look | One of 8 visual styles (glow, paper, pixel, neon, ink, clay, riso, chalk) that Muse picks per game. |
| Seed plus input log | Every run starts from a random seed and records the player's inputs with timestamps. Replaying the same inputs on the same seed reproduces the exact score. That makes scores checkable and lets two people play the identical game. |
| Burst | A short replay of a real run, rendered from its input log (not a video). Tap it to "take over" and play the same game yourself. |
| Daily Bubble | One game per Group per day, the same for every member, with one scored run each. |
| Bubble Board | A leaderboard with Group, Friends and Everyone scopes. Rows for people you are not friends with have an Add friend button. |
| Float | Sharing your result (with its Burst) to your feed or a Group: "I got 42. Beat it?" |
| Muse Studio | The maker tool: one sentence in, a validated, bot-tested game with a cover out. |

## 2. How Bubbles brings people closer together

Each step of the ladder is a value proposition. Each one names the relationship it builds.

| Step | What happens | Relationship | VP | Status |
|---|---|---|---|---|
| 1. Stranger in a Group | She joined New in SF two weeks ago and hasn't posted. | You and your Group | (the need) | Starting point |
| 2. Shared Daily | She plays the Group's Daily, made from members' opted-in intros. It is a first move that isn't a post. | You and your Group | VP-02, VP-01 | Live (Daily generation: Debug/CLI only) |
| 3. Board neighbor | Her score lands next to members' names on a fair, same-seed board. | You and a stranger | VP-04, VP-16 | Live |
| 4. Add friend | She watches the Burst of the person just above her, then taps Add friend. | You and a stranger | VP-04 | Live |
| 5. Icebreaker before meeting | She RSVPs to the picnic and plays a game made from other guests' intros. | You and a stranger | VP-03 | Live |
| 6. Meeting at the Event | She arrives knowing a few names and facts. | You and a stranger | VP-03 | (offline) |
| 7. Rematch in Messenger | A same-seed challenge with her new friend, or one card the whole group chat plays. | You and a friend | VP-14, VP-15 | Not built |
| 8. Make a game together | She and her new friends make next week's game for the Group, with credit for every maker. | You, your friends and your Group | VP-38 | Not built |
| 9. Blend and bracket | After the picnic, Muse makes a game from her and a new friend's play history, and a bracket for everyone she met there. | You and the people you just met | VP-40 | Not built |

**Why games build friendship, not just engagement.** Three findings support the ladder:

- In a study whose adult sample had just moved, playing video games and watching movies together went with closeness, while time together at work or school did not [66]. Friendship takes about 50 hours to casual friend, 90 to friend and more than 200 to close friend [65].
- In lab studies of strangers, cooperation and interdependence each increased closeness, and interdependence worked entirely through more conversation [72]. The same work found that "cooperation is not necessary to form social bonds in games" [72], so competitive formats such as boards can build ties too.
- In a CHI PLAY 2016 experiment with 52 pairs of strangers, "a social game can be more effective than a social task at fostering interpersonal trust" [72].

These are small or lab studies, so we use them as direction, not proof. Section 9 describes how we would measure the ladder in a pilot.

## 3. The short answer: why Facebook

### 3.1 Why Facebook: only Facebook has these objects

1. **The content only exists on Facebook.** A Group's posts and an Event's RSVP list are Facebook objects.
   - Muse used 7 of 7 attendees' opted-in posts to make a picnic icebreaker, and 5 of 5 opted-in Group posts to make a Group's Daily (D8).
   - The Daily's answers were each tied to a member's intro, for example "BERLIN: Lena arrived from here just last week" and "AUSTIN: Maya moved from here three weeks ago for a lab job" (D8).
   - No rival with a standing community also has everyday names, Events with guest lists and feed distribution (section 7).
2. **Groups and Events are the moat for a newcomer.** Someone new in a city has few or no local friends, so friend-graph features (the Friends board, mutual friends) do little for her at first. Mutual-friend counts in our demo are synthetic placeholders; for a real newcomer we expect them to be near zero (estimate). That is why the Group board and the Event icebreaker come first: they give her a shared, chosen context with people she doesn't know yet.
   - Almost 1.8 billion people use Facebook Groups every month, across 25 million monthly active public groups (2024) [14].
   - Meta's own 2024 guide for people in their 20s points movers to "thousands of Facebook Groups that can help you meet new people in your city" [15].
   - Meta tested a Local tab pulling together Marketplace, Groups and Events in 10 US cities, including San Francisco (2024) [14].
   - Older figures show the scale but are likely stale: more than 70 million people helped run Groups (2020, latest public figure) [16], and more than 700 million people used Events monthly (2017, latest public figure) [17].
3. **The strongest identity baseline among major social networks.** Facebook asks people to use "the name that your friends call you in everyday life" [30], and opt-in Facebook Verified badges launched on Profiles and Groups in July 2026 [21]. That is a norm, not a guarantee: Meta estimated that in Q4 2024 "less than 3% of our worldwide DAP consisted solely of violating accounts" (bots and spam among them; family-wide, not Facebook alone) [12]. Bubbles adds its own layers: board rows only appear for people in a Group or Event you both joined, and contact goes through Facebook's normal friend-request flow (VP-07).
4. **The friend graph is the moat for the second persona.** The mover's hometown and college friends are already on Facebook. Keeping in touch with a community you used to live in is a known benefit of Facebook ("maintained social capital") [71], and same-seed challenges give those friends a reason to reach out (VP-14).
5. **Young adults are already there, and newcomers' life moments live here.**
   - 69% of US adults aged 18 to 29 use Facebook (Pew, 2026) [52], and 49% of all 18-to-29-year-olds use it daily (Pew, Feb to Mar 2025) [53].
   - Meta reported more than 40 million young-adult daily users in the US and Canada in 2024 [13].
   - Meta says young adults arrive at life moments, "moving, going to college, getting their first job or apartment" [13]. One in three young adults on Facebook in the US uses Marketplace daily (2026) [22].
6. **Distribution in one app.** Bubbles runs on 6 distribution surfaces (feed, Stories, Reels and Video, Groups, Events, profiles) plus 3 entry points (the Bubbles tab, Notifications and the Library in the Menu) (D19). A Wordle grid had to leave the game for Twitter; a Burst lands where friends can tap and play.

### 3.2 Why Meta can build it: strategy and models

These reasons apply to any Meta app, not only Facebook. They explain why Meta would fund this, not why Facebook is the home.

- **First-party models.** Muse is Meta's model family, and a Group's game is made without its data leaving Meta, which matches Meta's own "Zero Permissions" standard for games [32].
- **It is Meta's stated strategy.** On the Q4 2025 call, Zuckerberg described this loop: create a game "easily through a prompt" and "share that with people who they care about and you see it in your feed and you can jump right into it" [1]. Meta says Muse Spark makes "mini-games straight from a prompt" you can "share ... with friends", and that Muse is coming to "places like search bars, group chats, posts, and more" [2].
- **Meta has the pieces but not the social layer.** Per Business Insider (as reported by Digital Trends), Pocket has no direct messages and Meta has no plans to integrate it with its other apps [44] (secondary source). Horizon Create puts creator games in feeds [42]. None of them puts a game inside a Group, an Event or a chat (VP-28).
- **A lesson from Facebook's games history, not an advantage.** FarmVille reached 32 million daily players through the graph [38], then lost players when Facebook limited spammy notifications [39]. Instant Games reached 20 billion sessions [34] but needed studios. Bubbles keeps the graph and drops the spam and the studio bottleneck (VP-29).

### 3.3 Why Facebook, not Instagram

This is the first question a Meta director will ask. Instagram is Meta's too, reaches more US 18-to-29-year-olds (79% against 69% [52]), and has DMs, Stories, Reels and Meta's in-chat games work [116].

**What Instagram lacks are the objects a newcomer needs.**

- Groups with membership and posts are what the Daily is made from and what the board is scoped to.
- Events with RSVP lists are what the icebreaker is made from.
- Marketplace and the local layer are on Facebook: one in three US young adults on Facebook uses Marketplace daily [22], and Meta tested the Local tab on Facebook [14].
- Meta's stated plans for young adults and "OG Facebook" are about Facebook [7][12][13].

A game about "who's coming Saturday" needs an Event, and a Daily about "our Group" needs a Group. Instagram has neither.

**Instagram is a channel, not a rival.** We propose that Bursts can be shared to Instagram Stories and challenges sent into WhatsApp chats (proposal, not built). The family of apps then becomes the distribution channel, and Facebook is the home because the community lives there.

**Does this pull usage from Instagram?** We expect it to be complementary, not a substitute. The sessions Bubbles adds start from a Group or an Event, which Instagram doesn't host. This is a hypothesis: a pilot would track Instagram time for Bubbles players against matched non-players.

**What breaks without Facebook.** Each feature depends on a Facebook primitive.

| Remove this | And you lose |
|---|---|
| Groups (membership and posts) | The Daily Bubble, the Group board scope, games made from members' intros, weekly boards and game night |
| Events (RSVP list) | The icebreaker, "who's coming", and Add friend between attendees |
| The everyday-name friend graph | The Friends board, friends' Bursts first in the feed, rivalries, Games about me, hometown challenges |
| Feed, Stories, Reels | Floats, story shares, and Bursts as playable clips |
| Messenger | Challenge Me and group-chat play (not built) |
| Notifications and profiles | "Someone beat your score", "remixed your Bubble", and a maker's body of work |
| Search | Finding games and "Make it with Muse" (not built) |

**Where Facebook is not the strongest, stated plainly.**

- Facebook is the third most used app among US 18-to-29-year-olds, behind YouTube (95%) and Instagram (79%) [52], and its daily use peaks among people aged 30 to 64 [53].
- YouTube [101] and Roblox [96] have stronger AI game-creation tools.
- Reddit already runs games inside community posts [109].
- Discord comes closest on community play (section 7).

Our claim is the combination, not any single feature.

## 4. At a glance

Each value proposition has two evidence ratings, because whether a mechanism works and whether it helps people are different questions.

- **Mechanism.** Does the thing work as built?
  - **Measured**: we measured it in the prototype or with real Muse runs.
  - **Bot-run**: bots exercised it.
  - **Built**: the code exists but nothing is measured.
  - **Public data**: company or survey figures for a similar product.
  - **None**: nothing built.
- **Helps people.** Does it bring people closer, or help Meta?
  - **Literature**: published research on a similar mechanism.
  - **Public data**: results reported for comparable products.
  - **Hypothesis**: no evidence yet.

No value proposition has real-user evidence, because we have no real users.

### Core: the pitch

| ID | Value proposition | Relationship | Why only Facebook | Mechanism | Helps people | Status |
|---|---|---|---|---|---|---|
| VP-02 | A first move in a Group that isn't a post | You and your Group | Needs Group membership and members' posts | Built; bot-run timings | Literature | Live (Daily generation: Debug/CLI only) |
| VP-03 | Arrive at the Event already knowing names | You and a stranger | Needs an RSVP list tied to real profiles | Measured (real Muse) | Literature (small study) | Live |
| VP-04 | A leaderboard that works as an introduction | You and a stranger | Shared Group or Event plus everyday names | Built | Literature | Live (rows are synthetic people) |
| VP-01 | Muse makes the game from your community | You and your Group | Group posts and RSVPs are Facebook objects | Measured (real Muse) | Hypothesis | Debug/CLI only (Daily); icebreaker Live |
| VP-16 | Fair competition between people who just met | You and a stranger | Verified scores plus a strong identity baseline | Bot-run | Literature | Live |

### Supporting: for people and friends

| ID | Value proposition | Relationship | Why only Facebook | Mechanism | Helps people | Status |
|---|---|---|---|---|---|---|
| VP-05 | Make a game for your people in about 30 seconds | You and your people | The game is made for a named Group, Event or friends, and lands in front of them | Measured | Literature | Live |
| VP-06 | A daily reason to clock in that is about your people | You and your Groups | One game per Group, and only Facebook has the Groups | Built | Public data | Live |
| VP-07 | Meet strangers on an everyday-name network | You and a stranger | Everyday-name norm, opt-in Verified, shared Groups | Built (rows); None (badges) | Hypothesis | Live (rows); Not built (badges) |
| VP-08 | Everything a newcomer needs, in one app | You and your city | Groups, Events, Marketplace and Dating already live here | Built | Hypothesis | Live |
| VP-09 | A new way to tell your own story | You and your friends | "Who knows you best" needs real friends | Built (profile tab) | Literature | Live (profile); Not built (Games about me) |
| VP-10 | Play that ends, ranked for connection | You and your people | Facebook can rank on connection outcomes it can observe | Built; simulated (teammate-reported) | Hypothesis | Live (weights); Not built (recommender) |
| VP-13 | A friend's replay is an invitation | You and a friend | Bursts land in the feed, Stories and Reels where friends look | Bot-run | Public data | Live |
| VP-17 | Remix as a reply to a person | You and a friend | Remixes travel between people who know each other | Built | Hypothesis | Live (lineage); Not built (send it back) |
| VP-39 | A playable feed as varied as Reels | You and your feed | Facebook's feed and Reels habit, filled by members | Measured (variety); teammate-reported (speed) | Hypothesis | Live |

### Supporting: for Group hosts and creators

| ID | Value proposition | Relationship | Why only Facebook | Mechanism | Helps people | Status |
|---|---|---|---|---|---|---|
| VP-18 | A fresh daily ritual admins don't have to write | Your Group | Tens of millions of Groups, each with its own members and posts | Measured (real Muse) | Hypothesis | Debug/CLI only |
| VP-21 | You decide which of your posts can become a game | You and your Group | Facebook's per-post audience controls | Built | Hypothesis | Live, with named gaps |
| VP-23 | Credit and an audience you already know | You and your people | Profiles, notifications and a creator program that rewards originals | Built | Hypothesis | Live (profile, lineage); Not built (credits everywhere) |

### Value to Meta

| ID | Value proposition | Who benefits | Why only Facebook | Mechanism | Helps Meta | Status |
|---|---|---|---|---|---|---|
| VP-24 | A working version of what Meta's CEO described | Meta strategy | Meta's quote, Meta's models, Facebook's feed | Measured (loop runs end to end) | Public data (strategic fit only) | Live |
| VP-25 | Bringing friends back into Facebook time | Facebook's "OG Facebook" agenda | Needs the friend graph | Built | Hypothesis | Live |
| VP-26 | Fits Meta's young-adult priority | Meta's young-adult strategy | Reach already exists; habit is the gap | Built | Hypothesis | Live |
| VP-28 | The social layer Meta's AI-game products lack | Meta's product portfolio | Groups, Events and Messenger live here | Built | Hypothesis | Live |
| VP-29 | Facebook's games history, without its old mistakes | Meta | Only Facebook has run social games at this scale | Design rule | Public data | Design rule |
| VP-31 | Further upside for Meta: generations, ranking signals, revenue | Mixed-age Groups, recommendations, ads | Facebook's age reach, structured manifests, Pages | Built (manifests) | Hypothesis | Partly Live; revenue Not built |

### Muse and the AI ecosystem

| ID | Value proposition | Who benefits | Why only Facebook | Mechanism | Helps people or Meta | Status |
|---|---|---|---|---|---|---|
| VP-34 | The AI does the core work | Makers, judges (AI Integration), Meta's AI org | Muse's value comes from Facebook context | Measured (against a template baseline) | Hypothesis | Live |
| VP-35 | A showcase for the whole Muse family | Meta Superintelligence Labs | First-party models on a first-party surface | Measured | Public data (strategic fit) | Live |
| VP-36 | Cheap and predictable to run per Group per day | Meta infrastructure and finance | First-party models with no third-party margin | Measured (calls, output tokens) | Hypothesis | Live (cost not priced) |
| VP-37 | AI content made by and about real people | Feed and Reels, Meta's content strategy | Every Bubble carries a real maker and a social context | Measured (variety) | Hypothesis | Live |

### Roadmap: being built, not yet demonstrable

| ID | Value proposition | Relationship | Why only Facebook | Mechanism | Helps people | Status |
|---|---|---|---|---|---|---|
| VP-14 | Stay close to hometown friends after you move | You and a friend | Facebook holds both the old friends and the new Groups | Public data (format); same-seed primitive bot-run | Literature | Not built |
| VP-15 | One card the whole group chat plays | You and your friends | Messenger chats next to Groups and Events | Public data (format) | Public data | Not built |
| VP-19 | Weekly boards and game night that reward newcomers | You and your Group | Needs Groups and Events together | None | Literature | Not built |
| VP-38 | Make a game together, for and with your people | You, your friends and your Group | The friend graph and Group membership decide who co-makes; credits go to real profiles | None | Literature | Not built |
| VP-40 | Blends: a game made from two people, and a bracket for everyone you just met | You and someone you just met; everyone at an Event | Friendships and Event guest lists scope who you blend with | None (same-seed primitive bot-run) | Literature | Not built (design and request sent) |
| VP-11 | Find your scene through what you want to play | You and a new Group | A game in Search links to the Group that plays it | None | Hypothesis | Not built |
| VP-12 | Learn together, with friends' streaks | You and your friends | Group mastery needs a Group; friends' streaks need friends | Built (answer formula) | Public data | Not built |

## 5. The pitch

This section is what we say and show in the 5-minute slot and the 3 minutes of Q&A. It holds the one-liner and every pitch line (5.1), the story (5.2), the demo script with fallbacks (5.3), the Q&A (5.4) and what is still open (5.5). Every example we collected for the pitch, each linked to its value proposition, is in the appendix "Every pitch example". It draws on the team Slack channel, the team canvases, Karthik's notes and the repo at commit `0a3e8f7`.

Two rules shape it. The pitch should feel limitless, because the ideas are: anything a person can say in a sentence can become a game for their people. And every claim stays true: each on-screen moment is either running in the app or clearly marked as coming. **(K)** marks something Karthik asked for himself; those are must-haves.

The rubric sets the time split: AI Integration 30%, Product Thinking and User Impact 25%, Execution and Demo 25%, Originality and Cohesion 20%. Since a judge's note on Nov 12, "closer together" and the social network are the top priority, so every beat names who it brings closer.

### 5.1 The one-liner and the line bank

**Lead line (K):** People are brought closer together through friendly competition.

**Product one-liner:** Tiny games your people make with Muse, inside Facebook.

Alternates:

1. **(K)** An interactive platform where anyone can quickly create, build and scroll through games in a feed, powered by the Muse models.
2. **(K)** A space where people express themselves and share that expression with others through Facebook.
3. Describe a game in a sentence and Muse builds it, for a Group, an Event or everyone. (The in-app copy says "Describe a game and Muse makes it in about a minute.")

"Bubbles" is a working name; swap in the final one when Karthik picks it (5.5).

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

*What's real in it.* "About thirty seconds" is measured: a median of 28.0 s over 10 real Muse runs, every game bot-tested before it ships (D2, D5). The Daily Bubble and remixing a friend's game are on `beta-version`. Group-chat play, Challenge Me and game nights (VP-14, VP-15, VP-19) are not built yet. The sample sentences, the lava remix and "four versions by tonight" are illustrations, not data. The pitch claims limitless *ideas*; the games still run on the six game types the runtime knows, so in Q&A say "any idea that fits a dodge, timing, merge, guess, sort or answer game, and the list grows with each type we add."

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
| A new Daily Bubble every day, streaks, and friends beating your score. | Reason to come back | VP-06 | docs/BUBBLES.md §1 |
| Walk into the picnic already knowing three people's names. | Event icebreaker | VP-03 | docs/BUBBLES.md §1 |
| The Group leaderboard puts names to faces before you meet. | Daily Bubble and board | VP-04 | docs/BUBBLES.md §1 |
| Muse writes the brief, composes the game from our library, writes the small custom code, playtests it and paints the cover. | AI beat in one sentence | VP-34 | docs/BUBBLES.md §1 |
| Every bubble is playtested before anyone pops in. | Studio loading copy | VP-05, VP-18 | StudioComposeStep.swift |
| The same game for everyone in the group today. | Daily Bubble | VP-02, VP-16 | StudioAskStep.swift, StudioFloatStep.swift |
| Replays you can take over. | Bursts | VP-13 | BubbleBurstReelLayer.swift |
| The feed ranks for friendships made, not just time spent. | Recommender | VP-10 | Slack, Nov 12 11:37 (Kevin's agent) |
| A non-designer never has to pick a gravity value. | Creation is easy | VP-05 | Taxonomy canvas §9 part 3 |
| Muse can't set gravity to an unplayable value. | Safe composition | VP-34 | Concept library canvas §3 |
| Most hits are an older game with one twist applied. | Originality | VP-37 | Taxonomy canvas §9 part 4 |
| The library grows from what people actually make. | A system that compounds | VP-34 | Concept library canvas §6 |
| Tomorrow's Daily Bubble is the reason to come back. | Close | VP-06 | Build tracker "Demo" step 5 |
| Why this belongs on Facebook and nowhere else. | Framing of this whole document | VP-01 (section 3) | Slack, Nov 12 11:49 |
| Warm competition words: "your move", "beat my 34", "rematch", "You and Maya: 12 games together". | Copy on challenge and board screens | VP-04, VP-14 | Brand ideas, Nov 12 11:52 |

### 5.2 The story: from one sentence to everyone you met tonight (5 minutes)

The story opens on wonder and keeps widening. One sentence becomes a game. Then a game for a whole Group, then one for strangers before a picnic, then a rematch in the group chat, a story friends play through, a game blended from two people, and a bracket for everyone you met tonight. It lands on the point of all of it: people come closer through friendly competition, shared stories and self-expression.

It should feel like there is no ceiling. It must never claim what isn't there. The **Status** column says what is running in the app (Live), what runs only through our command-line tool or a debug launch (Debug/CLI only), and what is coming (Not built). On stage, anything Not built appears as a design frame with a visible "Coming" label, never as a working screen.

Nine beats, 300 seconds (30 + 35 + 45 + 35 + 25 + 30 + 30 + 35 + 35). About 75 s are on Muse at work and Muse writes the content of two more beats (AI Integration, 30%). About 60 s are on the need and on why Facebook (Product, 25%). The demo runs live throughout (Execution, 25%), and every beat names who it brings closer (Cohesion, 20%).

| Time | Beat | On screen | What we say | Brings closer | VP | Status |
|---|---|---|---|---|---|---|
| 0:00 to 0:30 (30 s) | **1. Any sentence** | Muse Studio on the demo phone. We type "a chill game for my new running club about SF hills". Ember's read-back appears in about 2 s: "I read this as chill and social, for your new running club in San Francisco." | "Think of a sentence. Any sentence. A cable car race where the fog keeps moving the finish line. Your roommate's cat, running for mayor. The group chat, as a heist. Here's mine. In about half a minute it becomes a game nobody has ever played, because a minute ago it didn't exist." | You and the people you make it for | VP-05, VP-34 | Live (real Muse). The three sample sentences are spoken, not built |
| 0:30 to 1:05 (35 s) | **2. Who it's for** | While Muse works: Alex's Facebook. The New in SF Group, quiet. The newcomers' picnic Event. (Member and Going counts are synthetic.) | "While Muse builds, meet Alex. He just moved to San Francisco. He joined New in SF and RSVP'd to a picnic, and he knows nobody there. People aged 19 to 29 are the loneliest age group in the world. Facebook already holds what Alex needs: his Groups, his Events, his friends. What it hasn't given him is a reason to show up." | A newcomer and a Group of strangers | VP-02, VP-08, VP-26 | Live |
| 1:05 to 1:50 (45 s) | **3. Muse at work** | Back to the Studio timeline: brief, "Picked dodge", content written, wiring checked, 5-bot playtest (and a repair if one is needed), cover painted in parallel, "Ready to play". Play it for about 10 s. | "Ember read what I meant. Wonder chose the kind of game, wrote the hills and built it from a library of 55 tested pieces. Five bots played it before any person did, and when a draft is too easy, Muse fixes it. Image painted the cover at the same time. Our median is 28 seconds. Take Muse away and there is no game." | The maker and the running club | VP-34, VP-35, VP-05 | Live (real Muse). A repair happens only when a draft fails, so narrate what the timeline shows |
| 1:50 to 2:25 (35 s) | **4. A game from your Group's week** | The New in SF Daily Bubble card. Play First Hellos, the Daily Muse made from five newcomers' opted-in intros. Open the Bubble Board, tap Watch Burst on Maya's row, then Add friend; the row changes to Requested. | "Now make it bigger. Every Group can wake up to its own game, written from its own week. This one was made from five newcomers' intros and nothing else. Everyone in the Group gets the same game on the same seed. Maya is just above Alex on the board, and she's one tap from a friend request." | Strangers in one Group, through a shared score | VP-01, VP-02, VP-04, VP-16, VP-18 | Board and Add friend Live. First Hellos is a real Muse game, but generating a Daily is Debug/CLI only; import it before the demo, or play the hand-made Fog Words seed and don't call it Muse-made |
| 2:25 to 2:50 (25 s) | **5. An icebreaker for strangers** | The picnic Event: "Who's coming Saturday? Learn a few names before you go." Play Picnic Pals, made by Muse from seven guests' opted-in intros, for about 15 s. | "Before the picnic, the guests get a game made from each other. Alex walks in already knowing that Lena swims in cold water and Diego bakes too much sourdough." | People who are about to meet | VP-03 | Live (Picnic Pals must be imported; otherwise use the seed icebreaker) |
| 2:50 to 3:20 (30 s) | **6. A rematch in the group chat** | If it lands: Challenge Me in a group chat, "Beat my 34 in Hill Drift", "3 of 5 played", a head-to-head "You 41, Maya 34", Challenge back. If not: a design frame labeled "Coming: Challenge Me", then the live Friends board. | "Then the game leaves the Group. A rematch lands in the group chat: same game, same seed, so it's fair, and every score can be replayed and checked. This is what we're building right now." | A group chat; a new friend | VP-14, VP-15, VP-16 | Not built (being built). Same-seed play and verification are Live |
| 3:20 to 3:50 (30 s) | **7. A story your friends play through** | Live: Alex's Moving Day game on his profile; a remix with lineage and the "remixed your Bubble" notification. Coming, as labeled frames: a choose-your-own-adventure where friends see each other's endings ("Maya took the ferry"), "How well do you know me?", and "Made by Maya, Leo and you". | "A game can be a story. Alex turned his move into one. Friends remix it and their names travel with it. Next: a story your friends play through, where you see who took the ferry and who took the hill, and a quiz that shows who knows you best." | Friends who know you; co-makers | VP-09, VP-17, VP-23, VP-38 | Moving Day (a hand-made seed), remix lineage and the notification Live. Story games, Games about me and co-making Not built |
| 3:50 to 4:25 (35 s) | **8. A blend, then a bracket** | Coming, as labeled frames: "A game for Alex and Maya", blended from both play histories, with what they have in common; then a picnic bracket of everyone Alex met. | "Here's where it goes. Two people, two play histories, and Muse blends them into a game for those two alone: play it, learn about each other, see who wins. Met eight people at the picnic? Tonight there's a bracket for all of you. There's no catalog here. Every game is made from you and your people." | Two people getting to know each other; everyone at an Event | VP-40 | Not built (design and request sent) |
| 4:25 to 5:00 (35 s) | **9. Closer together** | The Bubbles tab: friends' Bursts, each tagged with why it is there, and the "New" badge on the entry point. Then the notification "Today's Daily Bubble in New in SF is ready." | "Friendly competition. Shared stories. A new way to say who you are. That's how people come closer, and it works best where your people already are. Facebook knows who your people are. Now it can give them something to play together, made from one sentence. Tomorrow's game is already waiting." | The Group, the Event, the friends | VP-06, VP-13, VP-25 | Live (the "New" badge only if built; otherwise don't mention it) |

**Notes on the story.**

- **Start the live Muse run in beat 1.** A run takes a median of 28.0 s and up to 40.9 s in our benchmark (D2), so typing at 0:00 means the game is ready when beat 3 starts. If it isn't, narrate the timeline: it is the show.
- **Fantastical, not false.** The spoken sentences in beat 1, "Lena swims in cold water" and the picnic bracket are demo-world details or illustrations; the demo world is synthetic (D25). Don't say "any game"; say "any idea that fits the six game types we run today".
- **Order alternatives.** Bayan suggested opening on the Group's Daily, where Muse is load-bearing, and then revealing the creation engine. Bayan's five steps were problem, request, brief (a judge edits it), Muse builds and a judge plays, and the result posts to the Group with the opt-in shown. The Build tracker's original five beats predate the collaboration features. The table above is the closer-together rework.
- **Staging (K).** Hand a judge the phone, do a short skit, and run it like a keynote with a seamless walkthrough. Bayan also suggested letting a judge edit the brief on stage.
- **Meta's kickoff notes (paraphrased).** Isolate one problem clearly, build on surfaces that mimic real Facebook, have Muse power the core AI, and make the AI visible in the live demo: show the Muse timeline, not only finished games.
- **Meta's other named needs.** The story touches "finding your scene" (Groups) and "turning group-chat plans into real plans" (icebreakers, group-chat rematches, brackets) without leaving our one need.
- **Karthik's outline (K)** is all in the story: (1) a reason to clock in, as LinkedIn and NYT games show, plus a new lens for stories (beats 2 and 7); (2) anyone can create, build and scroll games in a feed, powered by Muse (beats 1, 3 and 9); (3) what goes into a game: modular design, as varied as Reels, with AI keeping creation unlimited (beat 3); (4) integration with Search, the feed, friends and Groups (beats 4 to 9; Search is not built).

### 5.3 The demo script, with fallbacks

Launch states use the debug variables in `FacebookClone/App/DebugLaunch.swift` (`FB_TAB`, `FB_OPEN`, `FB_SKIP_SPLASH`). IDs are placeholders until the script is locked.

| Step (beat) | Action | Launch state | Risk | Fallback |
|---|---|---|---|---|
| 0. Setup | Demo phone on the latest build, signed in as Alex, splash skipped, laptop mirror ready | `FB_SKIP_SPLASH=1` | The free-account install expires (Nov 19), or a build for another phone blocks it; repeated install retries once left the app unable to open | Rebuild for the demo phone early, never minutes before; keep a second team phone installed; the laptop phone page as a last resort |
| 1. Any sentence (1, 3) | Studio: type the prompt, show the brief, edit it, narrate the timeline, play; optionally Make level 2 | `FB_OPEN=studio:<prompt>` | Muse latency (median 28.0 s, up to 40.9 s in the bench, D2); venue network | Start the run at 0:00 and return in beat 3; the offline composer makes a valid game with no network, marked offline; pre-made real Muse games (Hill Drift, Send It) ready in the Library; screenshots of a real in-app run |
| 2. Who it's for (2) | New in SF Group and the picnic Event | Group page | None | Screenshot slide |
| 3. Daily and board (4) | Play First Hellos or Fog Words; open the board; Watch Burst; Add friend on Maya | `FB_OPEN=daily:<groupID>`, then `board:<id>` | Losing fast on stage | Fine either way: the board still shows Maya above you. Play 20 s at most |
| 4. Icebreaker (5) | Play the picnic icebreaker; tap a guest's name to open the profile | `FB_OPEN=event:<id>` | None | Seed icebreaker |
| 5. Rematch (6) | Challenge Me to the group chat: card, head-to-head, Challenge back | Group chat (needs the collaboration batch) | Messenger is not wired at `0a3e8f7` | Show the "Coming" frame, then challenge from the board or a friend's profile if built; otherwise the Friends board. Drop the Messenger claim |
| 6. Stories (7) | Moving Day on the profile; a remix with lineage; share a Burst to Story | `FB_OPEN=story:<userID>`; profile tab | Collaboration features not landed | Show remix lineage and the Story share, both built; the rest as labeled frames |
| 7. Blend and bracket (8) | Two labeled design frames | Slides | Not built | It is a frame either way; say "coming" |
| 8. Close (9) | Bubbles tab with Bursts; Daily notification | `FB_TAB=bubbles`; Notifications | Feed stutter | Pages show posters, so the feed still looks live; swipe again |

**The "New" badge.** A small "New" badge next to the feature wherever it appears in Facebook (the Bubbles tab, the Daily card on Groups, the Event icebreaker, feed posts with a game, the Library in the Menu), so a first-time viewer sees at once what is new. Demo note: if it is built, point at it once in beat 9 ("every place you see 'New' is where your people can play"); it also helps judges spot the feature in quick cuts. If it isn't built, don't mention it. It is a UI marker, not a value proposition; it supports VP-08 and VP-13 by making the feature easy to find. Status: not built.

**Before the demo.**

- Pre-generate the Daily and the icebreaker on real Muse (First Hellos, Picnic Pals) and import them, so beats 4 and 5 never wait on Muse.
- Script around whatever Muse makes live. The same sentence made Hill Drift (glow look) live, but the bundled seed is Hill Hopper (paper look).
- Point every "made with Muse" claim at real, logged Muse runs (the 10 bench games, the 5 CLI samples and the 2 in-app Send It records), never at the 13 hand-made seeds.
- Claim the demo phone on the Agent Logistics canvas.
- Option (K): hand a judge the phone to play, or to edit the brief. The interactive laptop phone page Karthik asked for could double as a backup (the "Beta Phone" bench is half built).
- Make the frames for beats 6 to 8 and label each "Coming".
- Record the optional demo video with the launch shortcuts.

### 5.4 Q&A prep and hard questions

The Q&A is 3 minutes, so the first answer to each question is short; the rest is backup. Questions are in rough order of likelihood. Each question appears once.

**"Why Facebook? Why can't another network do this as well?" (K)** The content is your people: a Group's posts, an Event's guest list, your friends. No viral game has ever used your friends as content. The games live where those people already are (Groups, Events, the feed, Reels, Stories, profiles, and chats once built), and every share lands back on Facebook. LinkedIn and the NYT show that games pull people into a bigger platform; here they pull people into Groups and friendships. Full answer: sections 3 and 7.

**"Why Facebook and not Instagram?"** Instagram reaches more young adults, but it has no Groups, no Events with RSVP lists and no Marketplace or local layer, and those are what the games are made from and played around. We would use Instagram Stories and WhatsApp as sharing channels (proposal, not built), and the sessions we add start from a Group, which Instagram doesn't host. See section 3.3.

**"Would this work without AI?"** No. Muse writes the brief, picks and composes the game, writes the content, playtests and repairs it, and paints the cover. With the same prompts, our template composer made valid games but 6 of 10 were off-topic (D7). And nobody can hand-write a daily game for every Group (VP-34).

**"Were those games really made by Muse?"** Yes, and the runs are logged. Our 10-run benchmark made 10 of 10 valid, bot-tested games with a median of 28.0 s (D1, D2). Earlier logged runs made Hill Drift (25.0 s), its night edit (40.6 s) and level 2 (25.4 s), First Hellos (39.4 s), Picnic Pals (33.0 s) (D10), and in the app a Send It restyle (15.8 s) and Send It 2 (28.4 s) (D26). The 13 seed games in the app are hand-made demo content, and we make one live on stage.

**"Muse takes half a minute. Won't people wait?"** The median is 28.0 s, and the game itself is ready at 21.0 s, before its cover (D2, D3). Studio shows each step live while the cover paints in parallel. Most people only play, and switching games takes about 3.6 ms on the simulator (D18, teammate-reported). Dailies are made ahead, and an offline composer covers outages.

**"Why a game at all? Admin AI could just write a welcome post or a 'meet who's coming' summary."** Meta already has Admin AI drafting posts in Forum [26], and a text summary is cheaper. A game does three things a text post can't:

- It gives a reason to return every day.
- It gives strangers a shared score, which is an excuse to introduce yourself.
- It gives lurkers a low-pressure role.

Lab work found "a social game can be more effective than a social task at fostering interpersonal trust" [72], which points the same way but is not proof. Section 11 proposes a direct test of a game icebreaker against an AI text icebreaker, measuring name recall and Add friend rate.

**"Does this bring people closer, or keep them on their phones?"** Every feature names who it brings closer: Add friend on board rows, icebreakers before the picnic, rematches in the group chat, games made together, Blends between two people. The feed ranks Add friend highest. The goal is walking into the picnic knowing three names. The pilot's north star is new friendships and first Events, not minutes (section 9).

**"Isn't an endless game feed another engagement machine?"** A fair tension our design review raised. Daily play is capped at one scored run, the result sheet ends in a person, and ranking rewards connection outcomes such as Add friend and floats to a Group, while quick skips count against (VP-10). In a teammate's simulation of synthetic users, bait-averse people saw clickbait fall from 36% to 14%, against 49% when ranking on clicks alone (D21; simulated, teammate-reported). We would measure social actions, not minutes.

**"Games built from my posts? I didn't agree to be a puzzle answer."** Only posts their authors marked for Bubbles are read, the maker can drop any, and the timeline names what was used and says nothing else was read (VP-21). Muse is told never to invent facts about people, and the data stays with Meta's own models. Two gaps are real and named: there is no opt-in toggle in the post composer yet (opt-ins are set in demo data), and no separate moderation step.

**"Can someone make a game to mock a person?"** Yes, unless the design stops it, and integrity matters as much as privacy here. Our design rules:

- Games about a named person must be made by that person, or need that person's consent (not built).
- Anyone in a game gets a "remove me from this game" action (not built).
- Group admins review Group-sourced games before they run (not built).
- Meta's existing bullying and harassment classifiers would apply to briefs and content (not built).

What exists today: only opted-in posts are read, prompts tell Muse to keep content kind and never invent facts, and the maker can drop any source. Until the rest is built, games about people stay limited to opted-in intros in the demo world.

**"Isn't this AI slop? Who moderates?"** Every Bubble has a human maker, a named audience and remix credits (VP-37). Games must validate and pass a 5-bot playtest before anyone sees them (D5). Prompts forbid invented facts and require kind content. A moderation step and admin approval for Group Dailies are required before launch, and we list them as not built.

**"What if Muse makes a broken game?"** It never ships. Every draft is validated and played by 5 bots in the real engine, with up to 2 repairs. In the benchmark 9 of 10 first drafts passed and the tenth was fixed in one turn (D5); 3 of the 5 earlier CLI runs were caught and fixed (D10). A crash during play shows "This bubble popped" instead of a blank screen.

**"Who makes all these Dailies? Most people don't create. Will people actually make games?"** They don't have to. The supply is Muse: an admin turns on the Daily once, Muse generates it each day from opted-in posts, and the admin can preview and veto (VP-18; admin opt-in not built). Event icebreakers are made the same way. Members' creations are a bonus, and making one takes a sentence, with starter prompts and "Surprise me". Admin opt-in is the key hypothesis, and the pilot measures it.

**"Can't people cheat the leaderboard?"** Every run is a seed plus an input log. Re-simulating it checks the score; that costs about 4.06 ms of CPU per run in Node, and 390 of 390 bot runs reproduced exactly (D12, D14; bot-run). The board marks verified runs, and challenges use the same seed, so they're fair by construction. Verification proves the inputs produce the score, not that a human entered them; bot-input detection is a later server-side layer (VP-16).

**"Facebook already tried games. Why will this work?"** Earlier attempts were studio catalogs bolted on: FarmVille's request spam led to notification limits [39], Instant Games left Messenger on iOS in 2019 [36], and the Gaming app closed in 2022 [37]. Meta still says hundreds of millions of people play games and join gaming Groups in the main app each month [37]. Bubbles is made by members, about the Group, inside Groups and Events, with scoped invites only and no mass requests. It is also the format Meta's CEO says is next [1].

**"Isn't this just Pocket, or YouTube Playables?"** Those make games for a feed of strangers or a creator's audience [43][101]. Bubbles makes games from and for a specific Group, Event or set of friends, using data rivals don't have (VP-28).

**"Isn't this just Wordle or Flappy Bird?"** The mechanics are familiar on purpose; the content is your people. Wordle is one global puzzle, and its plays fell from 5.3 billion in 2024 to 4.2 billion in 2025 [83]; Bubbles is a new daily game per community, made from that community. Muse is told never to copy a game's name, art or levels. Prior art such as PuzzleScript and VGDL already describes small games as data; what's new is AI-made content scoped to your Group.

**"Isn't Facebook for older people?"** 69% of US adults aged 18 to 29 use Facebook (2026) [52], and 49% of all 18-to-29-year-olds use it daily (2025) [53]. We don't claim it is their favorite app: YouTube and Instagram reach more [52]. Our claim is that the reach exists and the gap is a daily reason to come back. LinkedIn shows daily games can work on a network young people don't open for fun [79][81].

**"A newcomer has no friends there. Doesn't the friend graph do nothing for her?"** Mostly true at first, and we say so (section 3.1). For her, the moat is Groups and Events: a chosen, shared context plus everyday names. The friend graph matters for her hometown friends (VP-14), and it grows as she adds people from boards and Blends.

**"Blends sounds like matchmaking. Is it?"** No. A Blend is a game for two people who have already met, or a bracket for people at the same Event, made from what each has played. It never suggests strangers to each other, and it stays within the friend and Event scopes the board already uses (VP-40). Dating is out of scope (section 10.3).

**"What does a game cost, and how does it scale?"** 4 to 6 Muse calls and a median of about 3,400 text output tokens (D9); verification is milliseconds (D14). A Daily is one game per Group, not per person. A game is a small JSON file, checked once at publish, then cached and played on the phone, so gameplay never calls a server. We have not logged input tokens, so we state no dollar figure.

**"What about cold start: an empty Group, few opt-ins, empty boards?"** A Daily needed only 5 opted-in posts (D8). If there are none, members can still make games from a sentence, and the offline composer means a game always comes out. The Daily card invites the first player to be first on the board. In production, empty boards would show "be first", never fake people.

**"Is there a backend? Are those scores real?"** The demo runs on the phone, with other people's activity simulated, but the Muse calls are real. Board rows come from bots playing the real engine (Maya plays at skill 0.9), so each score has a replay, and they are labeled as synthetic. Today's Daily in the app is a hand-made seed or made with Studio's daily mode; in production it would be made automatically each day. A teammate (Max) drafted a Go and MongoDB backend; it isn't deployed.

**"How does Meta make money?"** Not built, and the honest answer is indirect: return visits and Group activity on surfaces that already carry ads. Options from the games we studied: ads between runs, cosmetics, a games subscription like NYT's, themed packs; sponsored Bubbles for Groups and Events are a possible later format (VP-31).

**"Can an iOS app even run these games?"** App Store guideline 4.7 allows HTML5 and JavaScript mini games inside apps, with content filtering, reporting, blocking, an index of the software and an age gate [124]. Bubbles are manifests run by a fixed, built-in runtime, so they fall under that rule. Reporting, the index and the age gate are not built.

**"Why build your own engine? Why JavaScript?"** Replays, Bursts and score checks need a fixed clock we control, and Studio runs the same code headless to playtest. The games are light, WKWebView compiles JavaScript fast, and Muse writes JavaScript reliably. A teammate's Rust/WASM engine is a future path (D24, not in the app).

**"What about teens?"** Bubbles is designed for adults. Meta limits Muse to people 18 and over [6], and its 2026 settlement with 52 attorneys general on teen mental health [6] argues for adults-first, opt-in, finite-by-default design.

**Also ready if asked.**

- **How did a small team build this much?** About 10 AI coding agents in parallel, each owning its own files, with a shared spec and Slack canvases. CLAUDE.md shows the process. Whether to mention it is open (5.5).
- **What was hard about Muse?** The text models reason first, so a request needs room for 4,000 or more output tokens or the reply comes back empty.
- **What's next?** Pick from: automatic daily generation on a server with replay-checked boards; Blends and brackets; photos in requests via Spark; spoken requests via Muse voice transcription; sketch input and play insights; new mechanics as sandboxed plugins; Ember re-ranking the feed with a one-line "why".
- **Why this need?** Our first concept served existing roommates, which none of Meta's four needs cover. A new city is where Groups and Events matter most.
- **Accessibility?** High contrast, reduced motion, one-handed play and screen-reader labels are in the design, not yet audited.

### 5.5 Open items

**Numbers we reconciled.** Each of these numbers is used the same way, with its label, everywhere in this document.

| Number | What it is | Label |
|---|---|---|
| Hill Drift 58.5 s | The first real end-to-end Muse game, about 08:33 PST on Nov 12, reported in Slack at 08:48: Ember wrote 12 SF hill names, Wonder assembled 15 pieces, 4 bots playtested it | Teammate-reported (not logged) (D11) |
| Hill Drift 25.0 s | A later, logged CLI run of the same sentence at 09:21 PST: Ember brief in 1.1 s, Wonder wrote 8 obstacle labels and composed 14 concepts, a "too easy" draft was repaired, glow look | Measured (D10) |
| Send It 28 s | The level-2 run, Send It 2, logged at 28.4 s. The restyle to pixel took 15.8 s. The first make of Send It was not logged | Measured (D26) |
| Muse time per game | Median 28.0 s, range 15.7 to 40.9 s, over 10 benchmark runs. Replaces "25 to 59 s" and "about a minute" in our notes | Measured (D2) |
| Cover time | Median 20.2 s (9.1 to 34.9 s) while a game is composing, in parallel, adding a median 3.35 s to the total. The "about 11 s alone" in Slack was one standalone call and was not logged | Measured (D3); the 11 s is teammate-reported |
| Runtime tests | Node runner: 318 passed, 0 failed (its main suite prints 310, which is the "310" in Slack). JavaScriptCore runner: 308 passed, 0 failed. Kit tests pass in both engines with 23 fingerprinted runs identical, and 11 of 11 manifests validate. The tracker's 212 and 202 were an earlier count, and the kit runner prints no test count, so "318 kit tests" is dropped | Measured, rerun today at `0a3e8f7` (D17) |
| Score verification | About 4.06 ms of CPU per run in Node. Replaces "about 24 ms" from the Build tracker | Bot-run (D14) |

**Unfinished notes from Karthik (ask him).**

- A Slack note at 10:56 on Nov 12 about the pitch showing specialization breaks off mid-sentence; probably "for Facebook", but that's a guess. Open on Agent Logistics.
- The sketch-input request at 09:55 on Nov 12 also breaks off. Open on Agent Logistics.
- A Brainstorm canvas note about using it as a personal agent (the word is cut off). Does a personal-agent angle belong in the pitch?
- The "What goes into a game?" stack, which Karthik was still working out.
- Brainstorm questions: a campus hook, and finding purpose in the age of AI. In or out?

**Decisions pending.**

- **The name.** "Bubbles" stays until Karthik picks from brand round 3 (pastel blue to violet, no "blow", maybe a storytelling feel). The Group card still says "Blow a bubble for this group", and the tracker calls Studio "Blow your own"; both conflict with the no-"blow" direction.
- **The one moment judges remember.** Candidates: the Add friend tap on the board, the live Muse build, a rematch landing in the group chat, or the Blend.
- **Story order:** open on wonder (5.2) or on the Group's Daily (Bayan).
- **Whether to mention the AI-agent build story,** since judges score Muse use.
- **What to promise as "what's next"**, including whether Blends appears as a frame in beat 8.
- **Default creator level:** Remix, Compose or Free.
- **Who exactly is the user:** just moved, first job or freshman? The demo assumes someone new in SF.
- **The monetization answer.**

**Must land before the pitch, or drop the claim.**

- Messenger group-chat play and Challenge Me (not wired at `0a3e8f7`).
- Import the real Muse games we demo (First Hellos, Picnic Pals, Hill Drift, Send It); none were in the build at `0a3e8f7`.
- Bubbles in Facebook Search and "Make it with Muse".
- The collaboration batch: Games in Groups, making games together, Games about me, story games, Learn, quiz night, length settings and the Customize panel.
- The "New" badge, or drop it from beat 9.
- Labeled "Coming" frames for Challenge Me, story games and Blends.
- Rework the tracker's demo around closer together (still open on the tracker).
- An opt-in switch on posts, or a clear answer for how authors opt in.
- The blue-to-purple rebrand in the app (code and BUBBLES.md §2 still show lilac, pink and peach).
- The public README and docs: the README doesn't mention Bubbles, lists a Marketplace tab and says the code has never been compiled; FEATURE_PARITY.md shows the old tab bar; the BUBBLES.md seed table leaves out This or That: Picnic and Trivia Thursday: SF.
- Confirm the backups exist: offline composer, pre-made real Muse games, the paused seed library.
- Don't claim Muse reads photos: Spark 1.3 is listed for photos, but photo input isn't built.
- Fix or stop citing the seeds' "Made with Muse" stamps and invented times (some dated Nov 10).

**Numbers still to get.**

- Cold start from tapping the tab, and memory: unmeasured. Measure on the demo phone (section 11).
- Usage for ages 18 to 25: we have Pew figures for 18 to 29 [52][53] and for teens [54], nothing narrower.
- The teen chatbot figure (64%) and the teen daily-use figure in our notes: check against Pew's own pages or drop them.
- Flappy Bird figures from the Taxonomy canvas: fact-check or drop.
- The submission deadline: it isn't in the brief.

## 6. Each value proposition in detail

Every entry uses the same eight fields. Our own data IDs (D1 to D26) are explained in section 8.

### 6.1 Core: the pitch

#### VP-02. A first move in a Group that isn't a post

- **Claim.** A newcomer, or a member who has never posted, can take part on day one by playing the Group's Daily Bubble. They land on the Group board next to members' names without writing an intro.
- **Why Facebook.** The Daily needs a Group: a membership list that scopes the board, members' posts as content, and a Group page to pin it to. Almost 1.8 billion people use Groups monthly [14], and Meta's own guide for people in their 20s points movers to "thousands of Facebook Groups that can help you meet new people in your city" [15].
- **Rationale.** Posting to strangers is a high-stakes act; playing a 15-second game is not.
  - For adults who had just moved, playing video games together went with closeness, while time at work or school did not [66].
  - Days with more interactions with weak ties (acquaintances) go with more happiness and belonging [67].
  - People underestimate how much new acquaintances like them, which "can hinder our ability to develop new relationships" [68].
- **Evidence.**
  - 26.6% of Gen Z aged 18 to 24 moved in the past year (2023, any change of address, including local moves) [63].
  - Ages 19 to 29 are the loneliest age group worldwide: 27% very or fairly lonely, against 17% of those 65 and over [60].
  - In the US, 24% of adults under 30 felt lonely "a lot of the day yesterday" in early 2023 [119], and 20% of all adults did in 2024 [61].
  - 22% of adults under 50 say they often feel lonely or isolated, against 9% of those 50 and older; 16% of all adults feel that way all or most of the time [58].
  - In-person time with friends for ages 15 to 24 fell from about 150 to 40 minutes a day between 2003 and 2020 [59].
  - The Group Daily "Fog Words" had a median bot run of 13.5 s (D15, bot-run; people will be slower).
- **How Bubbles delivers it.**
  - Live: a Daily card pinned on the Group page, with today's top 3, your rank, a Group streak and copy inviting you to be first on the board; a Daily Bubbles strip on the Groups tab; a Daily-ready notification; float your result to the Group.
  - The Daily shown in the app today is a hand-made seed game. Generating it from members' posts is Debug/CLI only (VP-18).
  - Not built: the "Most improved" award (VP-19).
- **Demo.** Narrate the persona: she joined New in SF two weeks ago and hasn't posted. She plays the Daily, sees three members' names around hers, and floats "I got 42. Beat it?" to the Group with one tap.
- **Metric.** Share of new members whose first action in the Group is a Daily play; share of those who comment or post within 7 days, against members who didn't play; share of Daily players who had never posted before.
- **Risk and answer.** "Lurkers stay lurkers, and shy people may not want to be ranked." The goal is a first step, not the whole path; Add friend and the profile are one tap away. Boards have a Friends scope, and finite, private-by-default options are being built. This is a hypothesis with a test, not a finding.

#### VP-03. Arrive at the Event already knowing a few names

- **Claim.** Before a meetup, guests play a short game made from other guests' opted-in intros, so they walk in with names and something to talk about.
- **Why Facebook.** It needs an RSVP list tied to real profiles, plus guests' own posts. Facebook Events has both, inside a standing Group. One-off invite apps such as Partiful [122] and Apple Invites [121] have guest lists but no standing community, and TikTok's US Local Feed shows nearby events with no guest list [104]. The claim is not that only Facebook has guest lists; it is that only Facebook has the Group around the Event.
- **Rationale.** Walking into a picnic of strangers is the hardest moment for a newcomer.
  - In a CHI PLAY 2016 experiment with 52 pairs of strangers, "a social game can be more effective than a social task at fostering interpersonal trust" [72].
  - Cooperation and interdependence each increased closeness between strangers; interdependence worked entirely through more conversation [72].
  - Friendship is built from time together: about 50 hours to casual friend, 90 to friend and more than 200 to close friend, in a study whose adult sample had just moved [65].
- **Evidence.**
  - Real Muse made the picnic icebreaker from 7 of 7 attendees' opted-in posts in 40.9 s (bench) and 33.0 s (committed sample), and explained its choice: "Who-style guessing fits learning names and facts" (D8, D10).
  - Each round pairs a guest's name with facts from their intro, such as "Arrived from Berlin last week" (D8).
  - The median bot run of the icebreaker was 13.6 s (D15).
  - Older figures for Events: more than 700 million people used Events monthly in 2017 [17], and more than 100 million a day used Events in 2016 "to discover things they can do with their friends" [18]. These are the latest public figures and are likely stale.
- **How Bubbles delivers it.**
  - Live: an Event section, "Who's coming? Learn a few names before you go", with avatars of who is going and who has played; "Make an icebreaker" for guests marked Going; a This or That picnic game.
  - Not built: a post-event rematch and game night.
- **Demo.** Open the picnic Event, play the who-is-it round in about 15 s, then tap a guest's name on the board to open their profile.
- **Metric.** Icebreaker plays per Going guest before the Event; Add friend requests between attendees within 7 days; a post-event survey item, "I knew someone's name when I arrived".
- **Risk and answer.** "The trust study was small, online and about teamwork; a quiz about guests might feel like surveillance." We cite the study as direction, not proof, and section 11 proposes a hallway test. Content comes only from posts guests opted in, and Studio shows exactly which posts it used.

#### VP-04. A leaderboard that works as an introduction

- **Claim.** Every Bubble Board row for someone you don't know yet has their name, a profile link, Watch Burst and Add friend, so playing the same game becomes a reason to connect.
- **Why Facebook.** For a newcomer, the board's value comes from shared context, not the friend graph: rows appear for people in a Group or Event you both chose to join, under everyday names [30]. Other networks handle this differently:
  - LinkedIn's game leaderboards group players by their connections and company [81].
  - Discord and Reddit are pseudonymous.
  - On Roblox, unfiltered chat between teens and adults requires a verified real-world connection [97].
- **Rationale.**
  - People underestimate how much others appreciate being contacted (more than 5,900 participants) [69]. A shared score is a concrete, low-risk reason to send a request.
  - Close friendships mostly start in shared, repeated settings: 54% of Americans with close friends met one at work, and only 8% made a close friend online [64]. A Group board is a shared, repeated setting.
  - For adults who had just moved, playing video games together went with closeness [66].
  - Facebook use is most strongly tied to "bridging" social capital, the weak ties that bring new information and people [71].
- **Evidence.**
  - Context, not evidence for this mechanism: in ESA's 2025 survey (YouGov, n=5,000 US adults), 70% of Gen Z players and 61% of Millennial players said they have met people through games they otherwise wouldn't have [76] (industry survey; about online games generally, not leaderboards).
  - Context: 61% of US adults say close friends are extremely or very important for a fulfilling life, more than marriage (23%) or money (24%) [57].
  - Built: board rows show Add friend with Requested and Confirm states. In the demo, rows are bot runs by synthetic people.
- **How Bubbles delivers it.**
  - Live: Bubble Board with Group, Friends and Everyone scopes; Add friend on non-friend rows; verified-run badge; Watch Burst; notifications when someone beats your score or you pass someone.
  - Not built: a teammate's recommender that weights Add friend highest in its reward.
- **Demo.** After the Daily, open the Group board, tap Watch Burst on the row just above you, then Add friend. The row changes to Requested.
- **Metric.** Add friend taps per board view; acceptance within 7 days against Facebook's usual suggestion baseline; share of new friendships within a Group that started from a board.
- **Risk and answer.** "Strangers adding you because you scored near them could feel spammy or unsafe." Rows only appear for people in a Group or Event you both chose to join, requests go through Facebook's normal friend flow and limits, and there is no open message channel and no mass invite.

#### VP-01. Muse makes the game from your community

- **Claim.** Muse turns a Group's opted-in posts and an Event's guest list into games, so the content of the game is the community itself.
- **Why Facebook.** The inputs are Facebook objects: Group membership and posts, Event RSVPs, and everyday-name profiles [30]. TikTok and YouTube have interest graphs built on handles, Reddit and Discord are pseudonymous, and LinkedIn's graph is professional. No other network holds all of these together under everyday names.
- **Rationale.** Our team's review of 8 well-known short games (Wordle, 2048, Flappy Bird and others) found that all of them use generic content: word lists, procedural courses, trivia (internal synthesis, 2026-11-11). The open slot is content about who your people are. Game mechanics can be copied; a quiz about who is coming to Saturday's picnic cannot, because only the host platform knows who is coming.
- **Evidence.**
  - Real Muse runs used 7 of 7 attendees' opted-in posts for the picnic icebreaker and 5 of 5 opted-in Group posts for the Daily, and the Studio timeline says "Nothing else was read" (D8).
  - Every answer in the New in SF Daily was tied to a named member's intro, such as "TORONTO: Priya, a new nurse in town, arrived from here" (D8).
  - Committed sample runs: the "First Hellos" Daily from 5 posts in 39.4 s and the "Picnic Pals" icebreaker from 7 posts in 33.0 s (D10).
- **How Bubbles delivers it.**
  - Live: the Event icebreaker; "Blow a bubble for this group" in Studio with opted-in sources; the guess formula's who-is-it portrait rounds; the answer formula scored against what the Group picked.
  - Debug/CLI only: generating a Group's Daily from opted-in posts works on real Muse through the command-line tool and through Studio's daily mode, which only a debug launch reaches. The Daily shown in the app today is a hand-made seed game. We recommend wiring Daily generation into the normal Group UI before demo day, because it is the core thesis.
  - Not built: Games about me.
- **Demo.** In the New in SF Group, tap "Blow a bubble for this group", show the source list and the "Nothing else was read" line, generate, and play a round that asks which newcomer said what.
- **Metric.** Share of plays on games built from Group or Event context against generic games; completion and Add friend rate per play for each type.
- **Risk and answer.**
  - "Any app can ask people to type in names and facts." Asking people to re-enter their community is the cold-start problem. Facebook already has the community, the consent surface (per-post settings) and the identity, and the people in the game are one tap from Add friend.
  - "Any frontier model given the same posts would make an on-topic game." True. The moat is the posts and the surfaces, not the model. We have not yet measured what the context adds; section 11 proposes the test.

#### VP-16. Fair competition between people who just met

- **Claim.** Every run is a seed plus an input log that can be re-simulated, so scores on Group boards and in challenges are checkable, and head-to-heads are on identical games.
- **Why Facebook.** Verification itself is not Facebook-specific. Pairing verified scores with everyday-name people, some with opt-in Facebook Verified badges [21], gives a "real person, real score" board that pseudonymous networks lack.
- **Rationale.** Competition only brings people closer if it feels fair. Toxicity is a strong negative predictor of friendships formed in games [72], and cheating is a form of toxicity. One engineering choice powers same-seed challenges, verified badges, Bursts and bot playtests.
- **Evidence.**
  - 390 of 390 bot runs (13 games, 3 skill levels, 10 seeds) re-simulated to the identical score (D12).
  - Verifying a run costs about 4.06 ms of CPU in Node (D14).
  - Median score rose with bot skill on 12 of 13 games, so boards reward skill (D16).
  - All bot-run.
- **How Bubbles delivers it.**
  - Live: verification in the runtime; verified badges on board rows; the same seed for everyone in a Group's Daily.
  - Not built: same-seed Challenge Me; endless and finite play as a shared primitive, so a challenge can fix a fair mode (for example, everyone gets 3 lives or 60 seconds); server-side verification and boards in a teammate's Go backend.
- **Demo.** Tap a verified row's Watch Burst: "every score here is a 600-byte log we can replay".
- **Metric.** Share of board runs verified; disputed scores per 10,000 runs; rematch rate after a verified loss.
- **Risk and answer.** "Verification proves the inputs produce the score, not that a human entered them." Correct, and we say so. It stops forged scores. Bot-input detection is a later server-side layer, and small, scoped boards lower the payoff for cheating.

### 6.2 Supporting: for people and friends

#### VP-05. Make a game for your people in about 30 seconds

*Now includes former VP-22 (anyone can make games for the long tail of communities).*

- **Claim.** Anyone can describe a game for their running club, book club or Group in one sentence, and Muse returns a playable, bot-tested game with a cover in a median of 28.0 s. One sentence replaces a game studio, so members become makers for communities no studio would serve.
- **Why Facebook.** Prompt-to-game also exists on YouTube [101] and in Meta's standalone Pocket [43]. On Facebook, the game is made for a named audience (this Group, this Event's guests, these friends) and lands in front of them in one tap. Facebook's Instant Games proved no-install games work at its scale, with more than 20 billion sessions and over 6,000 games by December 2018 [34]. But every one of those games was made by a developer (nearly 200 titles when the platform opened in 2018 [35]). Muse removes that bottleneck.
- **Rationale.**
  - Making something for people you care about is a social gesture.
  - People value what they make, but only when it is finished (the IKEA effect) [75]. Validation and bot playtests make sure every game finishes.
  - Cheap creation plus social distribution produces hits from small teams. Roblox's "Steal a Brainrot", launched in 4 months by a group of young developers, peaked at 25 million concurrent users [94], and press reports that two games made almost entirely with AI reached Roblox's top 20 in Q3 2026 [95].
- **Evidence.**
  - Benchmark of 10 real Muse runs: 10 of 10 valid and bot-tested, median 28.0 s (range 15.7 to 40.9 s), and 43 Muse calls with 0 failures (D1, D2, measured).
  - The game itself is ready at a median 21.0 s, before its cover; the app does not show it until the cover is done (D3).
  - Each game takes 4 to 6 Muse calls (D9).
- **How Bubbles delivers it.**
  - Live: Muse Studio from the Bubbles tab, Groups, Events and profiles; edit, new look and next level; 6 formulas and 8 looks; remix lineage; an offline fallback so a game always comes out.
  - Not built: playing the game as soon as it passes its checks, with the cover fading in later (section 11); "Make it with Muse" from Search.
- **Demo.** Live: type "a chill game for my new running club about SF hills", show the Studio timeline (brief, formula, validate, playtest, cover), play it and float it to the Group. Keep a recorded backup run in case of venue-network latency.
- **Metric.** Share of games made for a named audience (Group, Event or friends); plays per game by that audience; makers who make a second game within 7 days; share of Groups with a member-made game within 30 days.
- **Risk and answer.**
  - "Generation is not a moat." We agree. Our value is where the game goes and who plays it (VP-01, VP-28).
  - "28 seconds is a long wait in a live demo." It is under half a minute, and the game is ready at 21 s. Showing it at that point is a planned change, not yet shipped.
  - "Just because a chatbot can make a game doesn't mean anyone will enjoy playing it" (Engadget on YouTube's builder [101]). Our games are composed from tested formulas and must pass validation and a bot playtest. Fun for people is unmeasured.

#### VP-06. A daily reason to clock in that is about your people

- **Claim.** One short, same-for-everyone game per Group per day gives young adults a reason to open Facebook daily, rooted in their communities rather than in endless content. Every Group you join adds another small reason.
- **Why Facebook.** LinkedIn and the NYT each run a handful of global puzzles. Facebook can run a daily game per community because it has the communities (25 million monthly active public groups [14]), and Muse makes a per-Group daily affordable.
- **Rationale.** Young adults want an underlying reason to check in.
  - Daily games work even on a network people don't open for fun. LinkedIn has its own image problem with young adults, yet says games "provide a way to build these network ties" [81]. Facebook faces a similar perception, and the same lever applies.
  - A capped daily (one scored run, one notification) builds the habit without nagging, the stance the NYT's head of games describes: "We're not nagging you to come back in" [82].
  - Games also feed the main product: the NYT says subscribers on its bundle "engage more, stay longer, and pay more over time" [85].
- **Evidence.**
  - LinkedIn (company-reported), word for word: "86% of players returning the next day and 82% still playing after seven" [79]. LinkedIn does not define the base; we read it as returning players, not a new-user cohort. Its 2024 Tango release gave 80% next day and 76% a week later [80].
  - NYT puzzles were played over 11.2 billion times in 2025 [82].
  - 49% of all US 18-to-29-year-olds use Facebook daily (TikTok 47%, YouTube 66%) [53].
  - Bot runs of Group and Event games had medians of 13.5 to 23.1 s (D15).
- **How Bubbles delivers it.**
  - Live: a daily gate (one scored run a day, same seed for the whole Group); Group and personal streaks; a Daily-ready notification; the Bubbles tab opens with your Group's Daily near the top.
  - Not built: a weekly leaderboard (VP-19).
- **Demo.** Open the Groups tab, show the Daily strip across your Groups, play today's game in about 20 s, and show your rank and the Group streak.
- **Metric.** Next-day and 7-day return among Daily players (all players who played on a given day, with the base stated); days per week a member opens at least one of their Groups, against control Groups.
- **Risk and answer.** "No user data; another daily notification is exactly what people mute." True; it is a hypothesis for a pilot. We send one notification per day, only for Groups you're in. Facebook's own 2010 notification limits are the lesson [39].

#### VP-07. Meet strangers on an everyday-name network, not a pseudonymous one

- **Claim.** Because players use everyday names and share a Group or Event, moving from a game to a friend request feels safer than on handle-based platforms.
- **Why Facebook.** Facebook's everyday-name norm [30], plus opt-in Facebook Verified, which checks a video selfie against existing profile photos to confirm "there is a real person on the other side of a profile" [21]. Rivals are adding identity after the fact: Discord moved to teen-default settings with face or ID checks in 2026 [99], and X said Communities were "used by less than 0.4% of users" yet "contributed to 80% of spam reports, financial scams, and malware" [100].
- **Rationale.** Bubbles asks people to add, and later meet, strangers. The trust layer matters as much as the game. Research on friendships formed in games found toxicity a strong negative predictor of in-game social capital [72].
- **Evidence.**
  - Facebook asks for "the name that your friends call you in everyday life" [30].
  - Meta estimated that "less than 3% of our worldwide DAP consisted solely of violating accounts" in Q4 2024 (family-wide) [12].
  - Verified badges launched on Profiles and Groups in July 2026 [21].
- **How Bubbles delivers it.**
  - Live: profile links and Add friend on rows; a verified-run badge.
  - Not built: showing Facebook Verified badges on board rows and icebreakers.
- **Demo.** On a board row, show the profile with the shared Group before tapping Add friend.
- **Metric.** Acceptance rate of board-originated friend requests; block and report rate per 1,000 such requests, against other suggestion sources.
- **Risk and answer.** "An everyday-name norm doesn't make every account real." Agreed; we claim the strongest identity baseline among major social networks, not perfection. Verified badges, Group scoping and requests rather than open messages add layers, and the metric would show whether board contact is safe.

#### VP-08. Everything a newcomer needs, already in one app

- **Claim.** Bubbles ties the surfaces a newcomer already uses on Facebook (Groups, Events, Marketplace, Dating) to a shared activity, with no new app or network.
- **Why Facebook.**
  - Meta says young adults arrive at life moments, "moving, going to college, getting their first job or apartment" [13].
  - One in three young adults on Facebook in the US uses Marketplace daily (2026) [22]. An earlier figure, on a different base, was one in four young-adult daily users in the US and Canada (2025) [23].
  - Meta tested a Local tab pulling together Marketplace, Groups and Events in 10 US cities, including San Francisco [14].
  - The standalone Gaming app closed in 2022, with its features moved into Facebook [37]. Meta's first Groups app closed in 2017, and its 2026 Groups app, Forum, syncs with Facebook Groups [25][49].
- **Rationale.** The newcomer's to-do list (furnish, find work, find people, find things to do) already lives on Facebook. What is missing is the step that turns finding a Group or Event into taking part.
- **Evidence.** Bubbles runs on 6 distribution surfaces and 3 entry points today (D19). Young-adult matches on Facebook Dating were up 10% a year in 2025 [51].
- **How Bubbles delivers it.**
  - Live: Bubbles in Groups, Events, the Home feed, Stories, Reels and Video, Notifications, profiles, the Library in the Menu and the Bubbles tab.
  - Not built: Search and Messenger.
- **Demo.** The newcomer path in 60 seconds: join New in SF, play the Daily, RSVP to the picnic, play the icebreaker and add a friend from the board.
- **Metric.** Share of Bubbles players who also RSVP to an Event or join a second Group within 14 days.
- **Risk and answer.** "Young adults are on Instagram and TikTok." Facebook still reaches 69% of US 18-to-29-year-olds [52], and 49% of all 18-to-29-year-olds use it daily [53]. The gap is a reason to come back, not reach. Section 3.3 covers Instagram.

#### VP-09. A new way to tell your own story

- **Claim.** Making games, "How well do you know me?" quizzes and choose-your-own-adventure stories from your life gives people an interactive way to express themselves on their profile. It also creates a social loop: friends play, and the profile shows who knows you best.
- **Why Facebook.** "Who knows you best" only means something when the players are your actual friends under everyday names. Profiles already carry identity and creator activity (Professional Mode passed 100 million daily users within 18 months [13]).
- **Rationale.** Interactivity gives people a new lens to tell their stories.
  - Talking about yourself is rewarding in itself: in lab studies, people gave up about 17% (Study 2) and about 25% (Study 4) of potential earnings to do it [74].
  - A quiz about you turns that disclosure into something friends do with you, and rewards them for paying attention.
  - The ranked "who knows you best" list gives each friend a reason to come back and climb it, and a reason to talk to you about what they got wrong.
- **Evidence.**
  - Self-disclosure is intrinsically rewarding [74].
  - Muse used all 8 looks across 10 games with no hints, so games look like their makers' ideas (D6).
- **How Bubbles delivers it.**
  - Live: a profile Bubbles tab with games you made, best scores and chains; "Blow a bubble" on your own profile.
  - Not built: Games about me with a ranked "who knows you best" list; choose-your-own-adventure stories with friends' endings and stories made from your own life.
- **Demo.** Open a profile's Bubbles tab: games made, best scores and a three-level chain. If it has shipped, show "How well do you know me?" with its ranked friends.
- **Metric.** Share of profile visitors who play a Games-about-me game; friend comments per game; repeat creation; friends who replay to improve their rank.
- **Risk and answer.** "Quizzes about yourself are old." True. Muse makes them playable, scored and replayable in seconds, which is why most people never made one by hand. Games about a person are made by that person, which also limits abuse (section 5.4).

#### VP-10. Play that ends, ranked for connection, not clicks

*Now includes former VP-30 (ranking for connection, not clicks).*

- **Claim.** Finite daily play, and ranking by whether games lead to friends and Group activity rather than clicks, give a feed that respects people's time.
- **Why Facebook.** Facebook can rank on connection outcomes (Add friend, a float to a Group) because it owns the graph where they happen.
- **Rationale.**
  - The US Surgeon General asks tech companies to "intentionally design technology that fosters healthy dialogue and relationships" and calls for "pro-connection technology" [59].
  - Facebook's own research found that composed comments from close friends go with better well-being, while one-click likes do not [70].
  - Zuckerberg testified that Meta changed its approach from time-based goals (Reuters) [48].
- **Evidence.**
  - Shipped feed weights rank relationships first (D20).
  - A teammate's simulation (5 synthetic worlds of 90 people for 14 days) found that ranking on clicks alone showed bait-averse users 49% clickbait, against 36% for today's feed and 14% for a reward built on finished runs, saves, floats and Add friend. The social reward also raised their pages per session from 5.9 to 7.2 (D21; simulated, teammate-reported, not reproduced by us).
- **How Bubbles delivers it.**
  - Live: a daily gate; a relationship-weighted feed with a reason tag on each page; a result sheet that offers "challenge a friend" and "see the Group board".
  - Not built: the recommender; saves as the main like signal, with an in-game save (people leave a game to save it, not to like it); endless and finite modes.
- **Demo.** After a Daily run, show that the result sheet ends in a person (challenge, board, Add friend), not another autoplay. Read the reason tags on the first five feed pages aloud.
- **Metric.** Share of sessions that end in a social action (friend request, float, challenge, RSVP); friend adds and Group floats per 100 pages; saves per play; session length distribution, aiming for short, social sessions.
- **Risk and answer.**
  - "The Bubbles tab is still an endless vertical feed." A fair tension that our own design review raised. The feed opens with your Group's Daily and friends' runs and ranks by relationships; we would measure social outcomes, not minutes.
  - "Simulated people prove nothing." Agreed; we use the simulation to choose an objective, not as evidence of impact.

#### VP-13. A friend's replay is an invitation, not just a clip

*Now includes former VP-27 (no-install distribution).*

- **Claim.** Bursts (replays rendered from a run's input log) appear in the feed, Stories and Reels, and one tap turns watching a friend's run into playing the same game, with no install.
- **Why Facebook.** Wordle's shared grids had to leave the game for Twitter. On Facebook, the share lands in the feed, a Group, a Story or Reels, inside the same app where friends already look, and it is playable in place. A standalone game app would have to rebuild this distribution; Facebook has more than 2 billion daily actives [1].
- **Rationale.**
  - Shareable results drove Wordle's growth: an emoji grid that players invented and its creator then built in, so you could share "how you did without ruining the game for others" [87]. Wordle went from fewer than 100 players to more than two million in under three months [87].
  - Its creator watched it revive a quiet family group chat: "Wordle reinvigorated it somehow" [88].
  - Meta's own data says removing loading blockers from Instant Games gave "~2x as many players successfully passing the loading step" [32].
- **Evidence.**
  - A Burst's input log is 600 bytes at the median (D13, bot-run).
  - Bubbles runs on 6 distribution surfaces plus 3 entry points (D19).
  - Facebook Reels time spent reached all-time highs in Q3 2026 [5].
- **How Bubbles delivers it.**
  - Live: Bursts in the Bubbles tab, feed posts, Stories, Reels and the Video tab; takeover plays the same seed; share to Story from the result sheet; float to feed or Group.
  - Not built: Messenger and Search.
- **Demo.** In Reels, a friend's Burst plays. Tap to take over, play the same seed, finish and share your result to your Story. Two surfaces, no installs.
- **Metric.** Takeover rate on friends' Bursts against strangers'; Burst view to takeover to finished run; new players per shared result.
- **Risk and answer.** "Feeds full of game replays could feel like Canvas-era game spam." Bursts come from friends and Groups, not mass requests, and the feed ranks relationships first (D20). "Distribution" is also unproven in a single-user prototype: nobody but the maker has seen a share yet.

#### VP-17. Remix as a reply to a person

- **Claim.** Remixing a friend's game credits and notifies them, and "send it back" returns the new version to its maker, so making becomes a conversation.
- **Why Facebook.** Remix trees on TikTok connect strangers by interest. On Facebook, a remix travels between people who know each other, through notifications, Messenger and profiles.
- **Rationale.** A remix sent back is targeted interaction with someone you know, the kind linked to well-being [70]. Zuckerberg describes AI making it "easier to create and remix content" [9].
- **Evidence.** Facebook's research links composed, targeted interaction with close ties to well-being [70]. Private sharing on Facebook was growing at over 80% a year in 2024 [13].
- **How Bubbles delivers it.**
  - Live: remix in Studio, with lineage recorded in the manifest; a "remixed your Bubble" notification.
  - Not built: credits everywhere, remix trees, send it back.
- **Demo.** Remix a friend's hill game into a night version, then show the notification the original maker receives.
- **Metric.** Share of remixes sent back; maker replies or counter-remixes within 48 hours.
- **Risk and answer.** "Most people won't remix." True, so this is a supporting value; each remix still pulls a second person back in.

#### VP-39. A playable feed as varied as Reels

- **Claim.** The Bubbles tab is a vertical feed of playable games that switches games in milliseconds, with games that vary in formula, look and content, so scrolling games feels as fresh as scrolling Reels.
- **Why Facebook.** Facebook already has the vertical-video habit and Reels at all-time highs in time spent (Q3 2026) [5]. Bubbles fills that habit with games made by members for their own Groups, not studio catalogs.
- **Rationale.** People come back to feeds for variety. Zuckerberg predicted "content in our feeds that you can interact with and it'll interact back" [8].
- **Evidence.**
  - Muse used all 6 formulas and all 8 looks across 10 prompts with no hints (D6, measured).
  - Warm switch to the next game: about 3.6 ms at the median on the simulator (D18, teammate-reported, not yet on a phone).
- **How Bubbles delivers it.**
  - Live: the Bubbles tab feed with a warm runtime, 8 looks with look memory, Bursts and takeover.
  - Not built: a Customize panel; endless and finite play modes.
- **Demo.** Swipe through four Bubbles with different looks and formulas, each tagged with why it is in your feed.
- **Metric.** Swipes to first play; plays per session; "see less" rate.
- **Risk and answer.** "That is an engagement machine." The feed opens with your Group's Daily and friends' runs, and is ranked for connection (VP-10).

### 6.3 Supporting: for Group hosts and creators

#### VP-18. A fresh daily ritual admins don't have to write

*Now includes former VP-20 (fresh games every day, so the habit doesn't wear out).*

- **Claim.** Muse can make a fresh Daily game for each Group from members' opted-in posts, so admins of quiet Groups get a recurring shared activity at no writing cost, and members aren't stuck with a single global puzzle that grows stale.
- **Why Facebook.** Facebook has "tens of millions of active communities" and more than 70 million people running Groups (2020, latest public figure) [16]. Only Facebook has each Group's members and posts. Meta's current Group AI (Forum's Ask tab and Admin AI) answers questions, triages posts and drafts posts [25][26]; it does not create shared activities.
- **Rationale.**
  - A new local Group is a list of strangers where nobody posts. A small daily ritual brings people back (VP-06), and a game made from the Group's own content gives members a reason to open that Group.
  - Single daily games fade: Wordle fell from 5.3 billion plays in 2024 to 4.2 billion in 2025 [83]. The NYT then added a "friends" tab "to encourage communal play" [84].
- **Evidence.**
  - Real Muse made a Group Daily from 5 of 5 opted-in posts in 28.8 s, with one automatic repair (D5, D8).
  - The Daily's five answers were each tied to a named member's intro (D8).
- **How Bubbles delivers it.**
  - Live: a Daily per Group (a hand-made seed game in the app today), sources limited to opted-in posts with the maker able to drop any, the Daily card and streak, 6 formulas and 8 looks with look memory so consecutive games vary.
  - Debug/CLI only: generating the Daily from posts (command line and Studio's daily mode).
  - Not built: admin opt-in with preview and veto; a Games section, weekly leaderboard and game night (VP-19).
- **Supply model.** An admin turns on "Daily" once. Muse then generates each day's game from opted-in posts, and the admin gets a preview and can veto it. Members' own creations are a bonus, not the supply. We expect admin opt-in to be the limiting step; it is a hypothesis with a metric below.
- **Demo.** Show Studio in daily mode: "Used 5 of 5 opted-in posts ... Nothing else was read", then the Daily pinned on the Group. Say plainly that this path is a debug launch today.
- **Metric.** Admin opt-in rate and 4-week retention of the feature; weekly active members per Group before and after the Daily; new members' first-week participation; Daily completion over weeks 1 to 8 against a fixed puzzle.
- **Risk and answer.** "Admins don't want AI posting into their community, and a bad game reflects on them." The Daily is an admin opt-in with preview and veto (not built). Every game is validated and bot-playtested first: 9 of 10 first drafts passed, and the tenth was repaired automatically (D5). Fun for people is still unmeasured. A moderation step is a named gap we would close before launch.

#### VP-21. You decide which of your posts can become a game

- **Claim.** Muse reads only posts their authors marked for Bubbles, and every game shows which posts it used and that nothing else was read.
- **Why Facebook.** Facebook's per-post audience controls are the natural home for a "use in Bubbles" opt-in. Meta's standard for games is social play while "limiting data sharing outside of Meta" [32]; a first-party feature meets that by design.
- **Rationale.** Games made from people's intros are only welcome if people agreed. Visible provenance makes consent checkable.
- **Evidence.**
  - Built: posts carry an `allowsBubbles` flag; Studio lists only opted-in posts; the timeline reads "Used 7 of 7 opted-in posts ... Nothing else was read" (D8).
  - Muse is instructed to use only the first names it is given, never to invent facts or vote counts, and to keep content kind.
  - Game glue code runs sandboxed, with no network, page access, timers or eval.
- **How Bubbles delivers it.**
  - Live: opt-in-only sources, the maker can drop any, a provenance line, the sandbox.
  - Not built: an opt-in toggle in the post composer (opt-ins are set in demo data today), a separate moderation step, and a "remove me from this game" action.
- **Demo.** In Studio's sources list, uncheck one post and show the timeline confirming which posts were used.
- **Metric.** Opt-in rate on Group posts; removal requests per 1,000 games; survey: "I'm comfortable with games made from my posts".
- **Risk and answer.** "Opt-in will be low, and AI may still misrepresent people." A Daily needs only a handful of posts (5 in our run). Prompts forbid invented facts, and a moderation step plus a "remove me" action are the first gaps we would close. Section 5.4 covers games made to mock someone.

#### VP-23. Credit and an audience you already know

- **Claim.** Each game a person makes, with its look, level series and remixes, becomes visible creative identity on their profile, and its first audience is people they know.
- **Why Facebook.** Facebook paid creators nearly $3 billion in 2025 and is putting "greater emphasis on rewarding original content creators" [27]. A credited game maker is an original creator by construction.
- **Rationale.** Credits make creation a conversation between people rather than anonymous AI output. Meta's anonymous AI video feed, Vibes, was headlined as "AI slop" [45]. People value what they make when they finish it [75].
- **Evidence.** Facebook's creator payouts and originals policy [27]; the Vibes reception [45]; Muse used all 6 formulas and all 8 looks across 10 prompts with no hints (D6).
- **How Bubbles delivers it.**
  - Live: a profile Bubbles tab, Chains (level series), next level, remix lineage and a "remixed your Bubble" notification.
  - Not built: credits everywhere, remix trees, send it back. A path to creator payouts is an idea, not a plan.
- **Demo.** Open a maker's profile: their games, a three-level chain and a friend's remix with lineage.
- **Metric.** Makers with 2 or more games in 30 days; remixes per game; profile visits from game credits.
- **Risk and answer.** "If Muse does the work, is the maker creating anything?" The maker chooses the idea, the audience, the sources, edits, look and levels. Whether makers feel ownership is untested.

### 6.4 Value to Meta

#### VP-24. A working version of a product Meta's CEO has described

- **Claim.** Bubbles is a working, mobile, friends-first 2D build of the loop Zuckerberg described: make a game from a prompt, share it with people you care about, and play it from your feed.
- **Why Facebook.** The statement is Meta's, the models are Meta's and the surfaces are Facebook's. On the Q4 2025 call (2026-01-28), he said: "you can imagine people being able to, easily through a prompt, create a world or create a game and be able to share that with people who they care about and you see it in your feed and you can jump right into it". He added: "Our feeds will become more interactive overall" [1].
- **Rationale.** A product lead funds work that de-risks a stated company bet.
  - Meta's Muse Spark launch advertises "custom websites and mini-games straight from a prompt" that you can "share ... with friends" [2].
  - The same launch says Muse will reach people "in places like search bars, group chats, posts, and more", and offers answers "grounded in what your group is discussing" [2]. Bubbles in Search and in group chats (being built) are exactly those placements.
  - On the Q1 2026 call, Zuckerberg listed "creating games" among Spark's leading areas [3]. On the Q3 2026 call, he said Muse should not be "a kind of single player game" but should let "your Muses ... work with your friends and your families" [5].
- **Evidence.** The quotes above [1][2][3][5]. Our benchmark shows the loop working end to end with real Muse latency (D1, D2).
- **How Bubbles delivers it.**
  - Live: Studio; the Bubbles tab feed; floats; Bursts in Reels and Stories you can take over.
  - Not built: Make it together (VP-38).
- **Demo.** Open with the quote on screen, then do it: prompt, wait about 28 s, float to the Group, then play a friend's Burst from the feed.
- **Metric.** Steps of the quote demonstrated live: prompt, share, see in feed, jump in (all four today). In a pilot, share of created games shared to a person or Group within 24 hours.
- **Risk and answer.** "If Meta already plans this, a hackathon team adds nothing." Meta's shipped versions (Pocket, Horizon Create) are standalone or creator-to-audience. Bubbles shows the community version and answers the hard parts: consent from Group posts, fair same-seed competition, a per-Group daily and a playtest gate.

#### VP-25. Bringing friends back into Facebook time

- **Claim.** Bubbles makes friend-to-friend interaction the content: beat my score, rematch, remix, play my Burst.
- **Why Facebook.** Meta has publicly committed to this. On the Q4 2024 call: "I'm excited this year to get back to some OG Facebook" [7]. In March 2025: "the magic of friends has fallen away" and "Social media should feel social", with a promise of "more fun, simple experiences to help you connect" [20].
- **Rationale.**
  - Zuckerberg testified in 2025 that "The friend part has gone down quite a bit" [46].
  - A slide in Meta's opening presentation at the FTC trial showed friends' content falling from 22% (2023) to 17% (2025) of Facebook time, as reported by The Keyword [47] (medium confidence; not for slides).
  - Facebook needs formats that need a friend to finish. Games are entertainment that is better with friends: Roblox reports co-play sessions are typically 1.9 times longer than solo sessions [93].
  - Bubbles uses AI to bring you to people, not to replace them.
- **Evidence.**
  - Meta's own statements [7][20][46], the trial slide [47] and Roblox's co-play figure [93].
  - Shipped feed weights rank your Group's Daily (3.0), a friend's Burst (2.2) and an Event icebreaker (2.0) above popular games (0.8) (D20).
- **How Bubbles delivers it.**
  - Live: friends' Bursts in the feed and Stories; the Friends board scope; each feed page tagged with its social reason.
  - Not built: Challenge Me, rivalries on profiles, send it back.
- **Demo.** Open the Bubbles tab: the first page is a friend's run, tagged with why it is there. Take over, beat it, and float "Beat it?" to the Group.
- **Metric.** Share of Bubble sessions where the maker, the Group or a board neighbor is a friend or Group member; friend-to-friend interactions per session.
- **Risk and answer.** "Friend content declined because people prefer entertainment." We are not asking people to choose friends over fun; games are fun that needs friends.

#### VP-26. Fits Meta's young-adult priority

- **Claim.** Young adults already have Facebook accounts but not a daily habit. Bubbles targets the gap Meta discloses as a long-term focus and a competitive risk.
- **Why Facebook.**
  - Reach already exists: 69% of US 18-to-29-year-olds use Facebook [52].
  - Meta's FY2024 10-K says it has "announced plans to focus product decisions on optimizing the young adult experience in the long term". It also says: "We believe that some users, particularly younger users, are aware of and actively engaging with other products and services similar to, or as a substitute for, our products and services" [12]. We could not check whether the FY2025 10-K keeps both sentences.
  - Its Head of Facebook says "Generative AI creates even more opportunities for social discovery on Facebook" [13].
- **Rationale.** Facebook's daily use peaks among adults aged 30 to 64 (58% of 30-to-49-year-olds) [53]; the job is giving young adults a reason to open it daily.
- **Evidence.**
  - More than 40 million US and Canada young-adult daily users in May 2024, "the highest in three years" (latest public figure) [13].
  - In October 2024, Meta still reported "positive trends with young adults, especially in the US" [10].
  - 49% of all US 18-to-29-year-olds use Facebook daily [53].
- **How Bubbles delivers it.**
  - Live: the New in SF Group and picnic Event demo world; the Daily and boards.
  - Not built: Challenge Me.
- **Demo.** Frame the 5 minutes as one newcomer's week: on Monday she joins the Group and plays the Daily, on Thursday she plays the icebreaker, on Saturday she goes to the picnic, and on Sunday she has a rematch with a new friend.
- **Metric.** Daily return of 18-to-29-year-old Bubbles users against matched non-users; share of 18-to-29 Group joins followed by a Bubble play.
- **Risk and answer.** "Teen use of Facebook has collapsed (32% in 2024, down from 71% in 2014-15 [54])." Bubbles is designed for adults (Meta limits Muse to 18 and over [6]), and young adults are the stated target.

#### VP-28. The social layer Meta's AI-game products lack

- **Claim.** Meta has prompt-to-game generators but no place where those games bring a Group, an Event or a chat together. Bubbles is that layer and could host games from any Meta generator.
- **Why Facebook.**
  - Pocket, Meta's standalone app for prompt-made "gizmos", rolled out across the US in August 2026 [43]. Per Business Insider (as reported by Digital Trends), Pocket runs on Muse Spark, has no direct messages, and Meta has no plans to integrate it with its other apps [44] (secondary source).
  - Horizon Create and Horizon Studio games run in Facebook and Instagram feeds for creators [42]; the announcement does not mention Groups, Events or Messenger.
- **Rationale.** AI media with no social anchor draws backlash (Vibes [45]). Positioning Bubbles as the complement turns the likely objection "isn't this Pocket?" into a strength.
- **Evidence.** Pocket's US launch [43], its reported limits [44], Horizon's creator focus [42] and the Vibes reception [45].
- **How Bubbles delivers it.**
  - Live: Group Daily, Event icebreaker, boards, remix lineage.
  - Not built: Challenge Me, group-chat play, games in Groups and Search.
- **Demo.** One Q&A slide: Pocket makes games for a feed; Horizon gives creators a tool; Bubbles is where your Group, your Event and your chat play together.
- **Metric.** Share of Bubble plays that happen inside a Group, Event or chat.
- **Risk and answer.** "Meta could add Groups to Pocket in a sprint." That would validate the thesis. It would still need what we built: opt-in sourcing, same-seed fair boards, per-Group dailies and icebreakers.

#### VP-29. Facebook's games history, without its old mistakes

- **Claim.** Facebook proved social games spread through its graph and learned what goes wrong. Bubbles keeps the reach and drops request spam, studio dependence and separate apps.
- **Why Facebook.**
  - No other Western network has run social games at this scale. FarmVille had 32 million players a day in 2010 [38], Zynga was 12% of Facebook's 2011 revenue [40], and more than 250 million people played games on Facebook.com monthly in 2013 [41].
  - Games still live in the main app: when Meta closed the standalone Gaming app in 2022, a spokesperson said the main app is where "hundreds of millions of people play games, watch gaming video, and connect in gaming Groups each month" [37].
- **Rationale.**
  - After Facebook limited app notifications in March 2010 to be "less spammy", FarmVille fell from 82.8 million to 78.4 million monthly users in about four weeks [39].
  - Instant Games needed studios [34], and stopped being playable inside Messenger on iOS in 2019 [36].
  - The standalone Gaming app closed in 2022, with Meta saying its features "have found a home in the main Facebook App" [37]. Legacy Web Games sunset on 2026-09-30 [32].
- **Evidence.**
  - FarmVille's notification drop (82.8 million to 78.4 million monthly users) [39].
  - The Gaming app's features moved into the main app [37].
  - Telegram's Hamster Kombat shows paid virality churns: from more than 300 million claimed players to under 44 million monthly [113].
- **How Bubbles delivers it.**
  - Design rules: scoped invites only (one friend, a Group board, a chat card); no mass requests; no cash or token rewards; inside core surfaces.
  - Not built: saves as the quality signal.
- **Demo.** Q&A only: "FarmVille showed the graph spreads games; we keep that and drop the spam."
- **Metric.** Invite acceptance rate; mute or unsubscribe rate on Bubble notifications.
- **Risk and answer.** "Games failed on Facebook twice." Earlier tries were catalogs bolted on. Bubbles is made by members, about the Group, inside Groups and Events.

#### VP-31. Further upside for Meta: generations, ranking signals and revenue

*Now includes former VP-32 (ranking signals) and VP-33 (revenue paths). These are hypotheses for Q&A, not part of the pitch.*

- **Claim.** Beyond young adults, Bubbles offers three kinds of upside. A Group's game can include long-time locals and travel across languages. Structured manifests give ranking cold-start signals. Sponsored Bubbles are a possible future ad format.
- **Why Facebook.**
  - Facebook reaches 69% of 18-to-29-year-olds, 78% of 30-to-49, 71% of 50-to-64 and 59% of 65 and over. Instagram reaches 41% of 50-to-64 and 21% of 65 and over [52].
  - About 90% of Facebook's daily users were outside the US and Canada at the last regional breakdown (our arithmetic: 1,905 million of 2,110 million, December 2023) [11].
  - Meta says generative retrieval surfaces new posts "before they've accumulated significant engagement", and that moving content understanding to Muse cut per-unit processing costs by more than 80% [5].
  - Nearly 10 million advertisers used at least one of Meta's AI creative tools in Q3 2026 [5].
- **Rationale.**
  - Long-time locals are a newcomer's best guides to a city. 49% of adult players say games helped them stay connected to friends and family [76].
  - Bot playtest results (score spread, run length) act as quality priors for new Bubbles.
  - A product lead will ask how this makes money. The honest answer is indirect (engagement on existing ad-supported surfaces), with a speculative direct path. We found no Meta playable-ad roadmap.
- **Evidence.** The reach and ranking figures above [52][11][5]; the ESA survey [76]; manifests and playtest outputs are shipped. Nothing ad-related is built.
- **How Bubbles delivers it.**
  - Live: Group Daily and looks that need little text; manifests, lineage and bot playtests.
  - Not built: a recommender with playtest priors; sponsored Bubbles.
- **Demo.** Not a demo moment. Use one line each in Q&A.
- **Metric.** Age spread of players per Group board; completion of brand-new Bubbles with and without playtest priors; sponsored-Bubble completion in a test.
- **Risk and answer.**
  - "The demo is US-only and English." Agreed; this is headroom, not a tested claim.
  - "Ads in games about your friends feel invasive." We would keep sponsorship opt-in for Groups and Events, never in personal games, and use game data for content ranking only, never ads.

### 6.5 Muse and the AI ecosystem

#### VP-34. The AI does the core work: without Muse there is no game about your people

- **Claim.** Muse does the core work: Ember writes the brief; Wonder composes the game with tool calls, writes its content and repairs failed drafts; bots tune difficulty; and Muse Image paints the cover. Without an LLM, the same prompts give valid but mostly off-topic games.
- **Why Facebook.** The AI's value comes from Facebook context (posts, RSVPs, Group identity).
  - Any frontier model given the same posts would also make on-topic games, so the template comparison below proves the AI is essential, not that Facebook is.
  - The Facebook-specific claim is that the context and the surfaces only exist here. We have not yet measured what the context adds; section 11 proposes the test.
  - Meta says Facebook was "the second largest driver of Meta AI engagement" in 2025 [8]. Bubbles gives people a frequent, social reason to use Muse there.
- **Rationale.** The brief says: "If your feature would work just as well without AI, keep pushing." We tested exactly that by running the same 10 prompts through our offline composer, which picks a formula by keyword and fills a template.
- **Evidence.** The template baseline is D7; relevance was judged by one agent, not by users.
  - Offline composer: 10 of 10 valid in a median 0.068 s, but only 2 on-topic, 2 partly and 6 off-topic, with the paper look 7 times in 10.
  - Muse: 10 of 10 on-topic, with 8 different looks.
  - Examples from the offline side: a brunch poll for "a quiz about the city's neighborhoods", and template San Francisco words for "learn Spanish words".
  - Keyword matching picked the same formula as Muse on 8 of 10 prompts, so Muse's added value is content, context and look, not the choice of game type.
  - The repair loop is real AI work: 9 of 10 first drafts passed, and Wonder fixed the tenth in one 12.4 s turn (D5).
- **How Bubbles delivers it.** Live:
  - Ember writes the brief (10 of 10 runs; median 1.9 s).
  - Wonder composes with 8 tools (list_formulas, get_formula, get_concepts, write_content, paint_cover, validate_manifest, playtest, finalize) and writes the content (9 of 10 runs). Ember wrote content once, a word list in run 02.
  - A 5-bot playtest runs, with up to 2 repair rounds.
  - Muse Image paints the cover.
- **Demo.** Run Studio live with the timeline visible. Then show one slide with the offline result for the neighborhoods prompt next to Muse's San Francisco quiz.
- **Metric.** Human-rated on-topic rate, Muse against offline; first-draft pass rate; share of created games played by others; in the context test, "mentions real members or facts" and "would you play this with this Group".
- **Risk and answer.** "Relevance was judged by one agent on 10 prompts." True; a blind human rating is the first item in section 11.

#### VP-35. A showcase for the whole Muse family

- **Claim.** Every game uses Wonder to plan with tools and write content, Ember for briefs (and one word list), and Muse Image for covers, with Spark 1.3 as the backup planner: Meta's model family used the way Meta recommends.
- **Why Facebook.** First-party models on a first-party surface. Meta describes Muse Wonder as for people "building everything from a game to an app" [28]. TechCrunch reports Meta's line "Muse Wonder plans, Muse Ember handles the volume" [29].
- **Rationale.** Meta needs frequent, social reasons to use Muse.
  - Its CFO lists creativity among the top 3 Muse categories, and more than 10 million people in the US and Canada set up Muse personal agents in about a month and a half [5].
  - People interacting with Meta AI daily rose 60% after the Muse Spark rebuild [4].
  - Facebook is the second-largest driver of Meta AI engagement [8].
- **Evidence.** Every benchmark run used muse-ember-1.0, muse-wonder-1.0 and muse-image-1.0. muse-spark-1.3 was configured as a fallback and never needed (D4). The brief requires Spark, Wonder or Ember; Wonder and Ember power every game.
- **How Bubbles delivers it.** Live: the Studio pipeline, with the model named on each timeline step; edit, new look and level 2. Debug/CLI only: daily mode.
- **Demo.** Point at the timeline: Ember's brief at about 2 s, Wonder picks a formula at about 7 s, Image paints in parallel, and the game is ready at about 21 s.
- **Metric.** Muse calls per game and failure rate (0 of 43 in the bench); weekly Muse sessions started from Bubbles.
- **Risk and answer.** "Spark isn't used." The brief accepts any of the three; we say exactly how each model is used.

#### VP-36. Cheap and predictable to run per Group per day

- **Claim.** A game takes 4 to 6 Muse calls and a few thousand output tokens, and verifying a score costs milliseconds, so per-Group daily games and server-side boards look feasible.
- **Why Facebook.** First-party models carry no third-party margin, and Meta reports Muse cut content-understanding costs by more than 80% [5]. TechCrunch lists Ember at $0.10 per million input tokens [29] (output price not verified; Meta page not checked).
- **Rationale.** A product lead needs to know a Daily per Group doesn't break the budget. A Daily is one game per Group, not per person.
- **Evidence.**
  - Median 3,391.5 text output tokens per game (range 2,633 to 5,651), of which a median 2,428.5 were reasoning.
  - Cover: median 2,257 image output tokens; 4 to 6 calls per game (D9).
  - Verifying a run costs 4.06 ms of CPU in Node (D14).
  - Input tokens were not logged, so **we claim no dollar figure**.
- **How Bubbles delivers it.**
  - Live: the Studio pipeline; a headless validator and simulator.
  - Not built: server-side replay verification and boards in a teammate's Go backend.
- **Demo.** Q&A answer: "about 5 calls per game; verification is milliseconds".
- **Metric.** Measured cost per game and per Group Daily once input tokens are logged.
- **Risk and answer.** "Without input tokens and prices this is hand-waving." We claim only measured call counts and output tokens. Logging input tokens is a small task (section 11).

#### VP-37. AI content made by and about real people

- **Claim.** Bubbles is AI-made content anchored to a human maker, a Group and remix credits, rather than an anonymous pile of AI media. It is AI that brings you to people, not AI that replaces them.
- **Why Facebook.** Zuckerberg describes a third era of social content: "as AI makes it easier to create and remix content, we're going to add yet another huge corpus of content on top of those" [9]. Every Bubble carries a real maker credit and a social context from the graph.
- **Rationale.** Backlash against anonymous AI media (Vibes [45]) shows the risk. A social anchor and a playable format give AI content a reason to be shared.
- **Evidence.**
  - Zuckerberg's framing [9] and the Vibes reception [45].
  - With no hints, Muse used all 6 formulas and all 8 looks across 10 prompts, so the feed looks varied (D6).
- **How Bubbles delivers it.**
  - Live: 8 looks with look memory, remix lineage and notification, a maker on every Bubble.
  - Not built: choose-your-own-adventure stories; a guess-what-they-say-next quiz night with original animated scenes; a teammate's Rust/WASM engine for a new game format.
- **Demo.** Scroll three Bubbles with different looks and formulas, each tagged with its maker and why it is in your feed.
- **Metric.** Share rate and completion of Bubbles against AI video; "see less" rate.
- **Risk and answer.** "Formula games will feel samey." Bench variety was 6 of 6 formulas and 8 of 8 looks, and each game's content is specific to its Group. The format list is growing.

### 6.6 Roadmap: being built now (collaboration first)

These are the team's current build priority. None is on `beta-version` yet, so none is claimed in the demo unless it lands.

#### VP-14. Stay close to hometown friends after you move

- **Claim.** Same-seed challenges in Messenger give old friends a quick, specific reason to reach out across cities.
- **Why Facebook.**
  - Facebook holds both sides of a mover's network: friends from home and college, and the new local Groups. Research names the first "maintained social capital": staying connected with a community you previously lived in [71].
  - The graph is tight: it averaged 3.57 degrees of separation in 2016 [31].
  - Messenger has more than a billion monthly users [8].
- **Rationale.**
  - Moving puts relationships at risk. Facebook's own research found that targeted, composed contact from close friends goes with better well-being, while likes "don't move the needle" [70].
  - People underestimate how much others appreciate being reached out to [69].
  - Playing against a friend was more engaging than playing a stranger in a 2006 lab study [78] (verified from the abstract only).
- **Evidence.** The format has worked before:
  - Facebook's Instant Games offered leaderboards and challenges in Messenger threads in 2016 [33].
  - Apple's Games app lets players invite "friends or contacts" to score challenges [110].
  - The NYT added its first two-player game [82] and a friends tab [84].
  - Roblox co-play sessions run 1.9 times longer than solo [93].
  - The same-seed primitive it needs is shipped and verified (D12).
  - No prototype data for the chat feature itself.
- **How Bubbles delivers it.**
  - Not built: Challenge Me (same-seed head-to-heads in a chat, a head-to-head result, Challenge back) and rivalries on friends' profiles.
  - Live: the same-seed primitive and the Friends board scope.
- **Demo.** If it lands, send today's game to a hometown friend's chat and show the result card and Challenge back. If not, show the Friends board and say plainly that Messenger is in progress.
- **Metric.** Challenges sent per weekly player; reply and rematch rate; share of challenges sent to friends in a different city.
- **Risk and answer.**
  - "Facebook pulled Instant Games out of Messenger on iOS in 2019 [36]." Facebook's announcement gave no reason [36], so we don't guess at one. We send a card (a seed and a score), and the game opens in Facebook's built-in runtime.
  - On App Store policy: guideline 4.7 allows "HTML5 and JavaScript mini apps and mini games" inside apps. It requires filtering objectionable material, a way to report content, blocking abusive users, an index of the software with universal links, and an age restriction mechanism [124]. Bubbles are JSON manifests run by a fixed JavaScript runtime, so they fall under 4.7. Reporting, the index and the age gate are not built.

#### VP-15. One card the whole group chat plays

- **Claim.** A group chat gets one game that everyone plays, a live mini leaderboard and a rematch, turning a "we should hang out" chat into shared activity.
- **Why Facebook.** Messenger group chats are a mass behavior: 2.5 million new groups were created every day in 2017, averaging 10 people (2017, latest public figure) [19]. A chat's game can also connect back to the Group or Event where the plan happens. iMessage has chat games and Apple Invites has events [121], but neither has standing Groups or feed discovery.
- **Rationale.** Plans start in group chats and stall there.
  - Social play lasts longer than solo play: Roblox reports co-play sessions are typically 1.9 times longer than solo sessions [93].
  - An AI party game on Discord, Death by AI, reached nearly 7 million players within weeks [98].
  - Wordle revived a quiet family group chat [88].
- **Evidence.**
  - Facebook's own Instant Games offered leaderboards and challenges in Messenger group threads in 2016 [33].
  - Apple made challenges with friends a main social feature of its Games app [110].
  - The same-seed Daily the card relies on is shipped (D12).
- **How Bubbles delivers it.**
  - Not built: a group-chat card with a live mini leaderboard and rematch; a guess-what-they-say-next quiz night in group chats.
  - Live: the same-seed Daily, which is the primitive both use.
- **Demo.** If it has shipped, drop a card into a 4-person demo chat and show the leaderboard filling. Otherwise, describe it as in progress.
- **Metric.** Chats with 3 or more players on one card; messages in the chat within an hour of a card; repeat cards per chat per week.
- **Risk and answer.**
  - "Games in chats are everywhere now (Instagram and Threads prototypes [116], Apple's Games app challenges [110])." Agreed on the mechanic.
  - Snap is the caution: Snap Games reached more than 200 million people, but about 30 million played monthly (2021) [117], and Snap stopped investing in Games in 2022 [106]. Broad trial didn't become a habit.
  - Our answer is content: Muse can make the chat's own game (your trip, your city, your inside joke), tied to the Group and Event where the plan lives. Whether that beats Snap's retention is untested.

#### VP-19. Weekly boards and game night that reward newcomers

- **Claim.** A weekly Group leaderboard with a trophy and "Most improved", plus Challenge the Group and a game night, gives a community a recurring occasion where newcomers can win.
- **Why Facebook.** Recurring Group rituals need Groups and Events together: a weekly board inside the Group and a game night as an Event.
- **Rationale.**
  - Friendship takes accumulated hours together [65].
  - For adults who had just moved, playing video games and watching movies went with closeness, while time together at work or school did not [66].
  - Cooperation and interdependence each increased closeness between strangers [72].
  - "Most improved" keeps newcomers in contention against members who have played for months.
- **Evidence.** Hall's hours-to-friendship figures [65][66] and Depping's cooperation results [72]. Our bots show a caution: the word game "Fog Words" did not rank by skill (median scores 200, 400 and 300 for low, middle and high skill), so luck-heavy games should reward improvement rather than raw rank (D16).
- **How Bubbles delivers it.**
  - Not built: a Games section, a weekly leaderboard with trophy and Most improved, Challenge the Group, game night.
  - Live: the Group board and Daily streak.
- **Demo.** If it has shipped, open the Group's Games section, show the weekly trophy and a newcomer listed as Most improved, then the game-night Event.
- **Metric.** Share of weekly winners or Most improved who joined in the last 30 days; game-night RSVP rate among weekly players.
- **Risk and answer.** "Leaderboards favor the already good." That is why Most improved, cooperative formats (a Group total, team against team) and a Friends scope are in the design.

#### VP-38. Make a game together, for and with your people

- **Claim.** Friends, or members of a Group, co-make a game in Studio, with credit for every maker. Making becomes a shared project, not a solo act.
- **Why Facebook.** The friend graph and Group membership decide who can co-make, and credits go to real profiles that the Group can see. A pseudonymous network can credit handles; Facebook credits the people you'll meet at the picnic.
- **Rationale.**
  - Cooperation and interdependence each increased closeness between strangers, and interdependence worked through more conversation [72]. Co-making is interdependent by design: one person picks the idea, another the look, another the sources.
  - People value what they make, when it is finished (the IKEA effect) [75]; co-makers share that ownership.
- **Evidence.** The cooperation [72] and IKEA-effect [75] findings. No prototype data; Studio's edit, new look and next-level steps are the building blocks.
- **How Bubbles delivers it.** Not built: co-making with friends or a Group, and credits for every maker. Live: Studio edits, remix lineage and the "remixed your Bubble" notification.
- **Demo.** If it lands: two people add one step each to a game for the Group, and both names appear on its credits.
- **Metric.** Co-made games per Group; plays by co-makers' friends; Add friend between co-makers who weren't friends.
- **Risk and answer.** "Committees make worse games." Each step stays small and validated, and the playtest gate still applies. Whether co-making feels fun is untested.

#### VP-40. Blends: a game made from two people, and a bracket for everyone you just met

- **Claim.** From two people's play history, Muse makes a game for just those two: they play it, learn something about each other and see who wins. When you meet several new people at once, for example at an Event, Blends become a small tournament bracket for everyone you met. It works like Spotify's Blend, which merges two people's listening into one shared playlist with a taste match score [125], but the result is a game you play together rather than a playlist.
- **Why Facebook.** A Blend needs to know who the two people are to each other and where they met. Facebook holds the friendship, the shared Group and the Event both RSVP'd to, under everyday names [30], so a bracket can be scoped to the people at one picnic. Spotify's Blend shows people want a shared artifact made from two tastes [125]; Spotify has no Events or Groups to scope it to, and a playlist doesn't let you compete.
- **Rationale.**
  - Getting from acquaintance to friend takes time together: about 50 hours to casual friend and 90 to friend [65]. A game made for two is a reason to spend some of it.
  - Interdependence increased closeness between strangers in lab studies, and it worked through more conversation [72]. A Blend is built from both people's tastes, so each round is a prompt to talk about them.
  - People underestimate how much new acquaintances like them [68] and how much others appreciate being contacted [69]. A Blend gives a concrete, low-stakes reason to reach out after meeting.
  - A bracket keeps the group together after an Event and turns "nice to meet you" into a rematch.
- **Evidence.** No prototype data; it is a design. Spotify's Blend is the analogy [125]. The pieces it builds on exist: same-seed play and replay verification (D12), the Event icebreaker that already makes a game from guests' intros (D8), and Kevin's recommender, which learns each person's taste from their plays (D21 for its simulation; local branch, not in the app).
- **How Bubbles delivers it.**
  - Not built: taste profiles from play history, matching two profiles and blending them into a brief Muse can build from (asked of Kevin's recommender work; design and request sent on Nov 12), a "Blend with" button on a friend's profile and on board rows, and an Event bracket.
  - Live: the same-seed primitive, verified scores, the Event icebreaker and the Friends board scope.
- **Demo.** As a labeled "Coming" frame in beat 8 of the story (section 5.2): "A game for Alex and Maya", then a picnic bracket. If a first version lands, make a Blend between two demo profiles and play one round.
- **Metric.** Blends started per new friendship; share of Blends finished by both people; Add friend or messages between the two within 7 days; bracket completion per Event; repeat Blends between the same pair.
- **Risk and answer.**
  - "This is matchmaking." It isn't: a Blend is only offered between people who are already friends or who went to the same Event, never as a suggestion of strangers. Dating stays out of scope.
  - "Play history says little about a person." True for a few plays. A Blend can start from what each person chose to play and make, and from opted-in intros, as the icebreaker does. Whether it feels personal is untested.
  - "A loss in a two-person game could sting." Blends can use cooperative scoring (a shared total) as well as head-to-head, and a bracket can reward Most improved, as the weekly boards do (VP-19).

#### VP-11. Find your scene through what you want to play

- **Claim.** From Search, a newcomer can find games tied to a place or interest, or make one with Muse, and reach the Group around it.
- **Why Facebook.** Facebook Search now has an AI Mode, powered by Muse Spark, with answers "grounded in what people are saying publicly across our apps like in Groups and Reels" [24]. People ran more than 2 billion searches a day on Facebook in 2016 (latest public figure, likely stale) [120].
- **Rationale.** A game about climbing in SF is a friendlier first contact with a community than a list of Groups. In WeChat, over 80% of mini-game users launch games through pull-down menus, search and social sharing [92].
- **Evidence.** Facebook's AI Mode in Search [24], its search volume [120] and the WeChat launch figures [92]. No prototype data yet.
- **How Bubbles delivers it.** Not built: games in Search and "Make it with Muse" from any search.
- **Demo.** Only if it lands: search "bouldering", play a Group's game from the results and tap through to the Group.
- **Metric.** Group joins that start from a game opened in Search.
- **Risk and answer.** "TikTok Minis are also found through search [105]." Agreed, this is table stakes. Its value is the link to Groups and Events, which TikTok lacks.

#### VP-12. Learn together, with friends' streaks

- **Claim.** Learn games (for example beginner Spanish) with Group mastery and friends' streaks turn solo study into a shared habit.
- **Why Facebook.** Group mastery needs a Group, and friends' streaks need the friend graph.
- **Rationale.** Streaks build habits. Duolingo learners who reach a 7-day streak are 3.6 times more likely to complete their course, and allowing two Streak Freezes raised daily active learners by 0.38% (relative) [114].
- **Evidence.** Duolingo's streak results [114]. Muse's beginner Spanish game was 8 of 8 correct in a spot-check (D8, estimate).
- **How Bubbles delivers it.** Live: the answer formula, used for learn games. Not built: Group mastery and friends' streaks.
- **Demo.** Optional: play the Muse-made Spanish game in about 20 s.
- **Metric.** 7-day streak rate for learners with a friend learning the same topic, against solo learners.
- **Risk and answer.** "Duolingo already does this." It is a supporting value; the point is learning with your Group, which Duolingo does not host.

## 7. Facebook against the alternatives

Could another platform run Bubbles as well? The test is the combination Bubbles needs:

- everyday identity;
- standing communities;
- Events with guest lists;
- chat;
- feed distribution;
- a local layer;
- a first-party model.

Percentages are the share of US adults aged 18 to 29 who use each platform (Pew, 2026) [52], where Pew tracks it.

| Platform | Graph and identity | Communities / Events | Games and AI creation | Where it is stronger than Facebook | What it lacks for Bubbles |
|---|---|---|---|---|---|
| **Facebook** (69%) | Everyday-name friend graph [30], opt-in Verified badges [21] | Groups (almost 1.8B monthly, 2024 [14]); Events (700M monthly in 2017, latest public figure, likely stale [17]); Messenger | Instant Games history [34]; Muse models [2] | (reference) | Not the youngest or most used daily app among 18-29s [52][53] |
| Discord (not tracked by Pew) | Pseudonymous servers | Interest servers with scheduled events, in voice channels or at outside locations [123] | Activities in voice channels; an AI party game reached nearly 7M players [98] | Live group play, gaming culture, community plus events plus chat | Everyday identity (age checks added in 2026 [99]), a local layer, feed distribution, a first-party model |
| Instagram (79%, Meta) | Followers and close friends | No Groups or Events found | 3 billion monthly users [115]; Meta is prototyping games in Threads chats [116] | Younger reach, sharing in DMs | Groups, Events, Marketplace and the local layer (section 3.3); a natural sharing channel for Bursts |
| WhatsApp (37%, Meta) | Phone contacts | Communities link multiple groups; each group holds up to 1,024 people [111]. Events in Communities reported (not verified here) | No native games found | Global group reach | Feed, discovery, games; a natural second surface for challenges, not the home |
| iMessage and Apple Invites (Apple) | Phone contacts | Group chats; Apple Invites (2025) lets iCloud+ subscribers create invitations and "anyone can RSVP" [121] | Games app challenges with friends and contacts; invite links shareable through any messaging app [110] | Where many friend plans happen; polished event invites | No standing Groups, feed or discovery; App Store games, not member-made |
| Partiful | Phone numbers and invite links | Event pages with RSVPs, guests who can see who's coming, comments, photos and text blasts; event listings by city [122] | None found | Popular, fast event invites | No standing community between events, no friend graph or feed distribution, no first-party model |
| TikTok (65%) | Interest graph, handles | No Groups; group chats up to 32 people, ages 16+ [103]; US Local Feed shows nearby content but no RSVPs [104] | Developer-made Mini Games in videos, search and DMs [105] | Daily attention (about half of 18-29s daily [53]), virality, local discovery | Communities, Events with guest lists, everyday names |
| Snapchat (56%) | Close-friend chat graph | Group chats | Stopped investing in Games and Minis in 2022 [106]; about 30M monthly Snap Games players in 2021 [117] | Close-friend messaging among young people | North America daily users down 6% to 92M [107]; no Groups or Events |
| Reddit (40%) | Pseudonymous | Subreddits | Developer-made games inside community posts [109] | Per-community games already shipping | Everyday names, friend graph, Events; games need developers; US daily users down 2% [108] |
| YouTube (95%) | Subscriptions | No Groups or Events | Playables (75+ games [102]); Playables Builder makes games from prompts with Gemini 3, in beta for selected creators [101] | Reach, AI game tooling | Friend graph, communities; games flow from creator to audience |
| LinkedIn (41%) | Everyday-name professional graph | Professional | Daily games; "86% of players returning the next day" (company-reported) [79] | A proven daily habit loop | Personal friends, local Groups, Events; games are editorial, not member-made |
| X (31%) | Public graph | Communities retired 2026-05-30 over spam [100] | No games product found | In-house frontier model (Grok), public virality | Communities, safety record for meeting strangers |
| Telegram (not tracked) | Usernames | Groups up to 200,000 people [112] | Game platform since 2016 [112]; over 1B monthly users (CEO claim) [118] | Spreading games through chats at scale | Everyday identity, Events, local layer; tap-to-earn churn [113] |
| WeChat (China) | Contacts | Super-app | Mini-games passed 500M monthly users in 2025 [91]; Jump Jump got 40% of traffic from friend recommendations, per Tencent [90] | Proof that social mini-games work at this scale | Not in our market; Facebook is the closest Western equivalent |
| Roblox | Avatar "Connections" | Experiences | AI tools; two mostly AI-made games in its top 20 (press) [95]; text-prompt 4D generation [96] | User-made games, AI creation, economy | Adults are 29% of age-checked daily users globally [95]; unfiltered teen-adult chat needs a verified real-world connection [97]; 138M daily users, down 9% [95] |
| NYT Games | Accounts, friends leaderboards | None | 11.2B plays in 2025 [82]; friends tab [84]; first 2-player game [82] | Editorial quality, daily habit | No social graph to speak of, no communities; one global puzzle per game |

**What this shows.**

- **Discord comes closest.** It has communities, scheduled events, chat and live games. It lacks everyday identity, a local layer, feed distribution and a first-party model.
- **One-off event apps cover only the meetup.** Partiful and Apple Invites cover the Event, but not the standing Group around it.
- **WhatsApp and Instagram are Meta's own** and natural second surfaces for sharing and challenges.
- **Where others are clearly stronger,** we treat them as validation of the format, not as reasons Facebook wins on that axis: YouTube and Roblox on AI game tools, TikTok on young adults' daily attention, LinkedIn and the NYT on proven daily habit.

We concede the close calls and win on the full set of pieces: no rival has all of them, and Facebook does.

## 8. Our preliminary data

All runs were on 2026-11-12 against commit `0a3e8f7` unless noted. No real users were involved. Sample sizes are small; treat every number as early evidence, not a benchmark.

### 8.1 Muse benchmark (10 real Muse runs)

**How it was produced.** We ran the real Muse Studio pipeline through our command-line tool on 10 one-sentence prompts from the demo world (running club, hiking, book club, climbing, garden, Spanish, the picnic icebreaker, the New in SF Daily, a neighborhoods quiz and others), one at a time, between 11:52 and 11:58 PST, on one Mac (Apple M4 Pro) and one network. No formula or look hints were passed. We then ran the same prompts through the offline composer (no Muse calls).

| ID | Metric | Value | Label |
|---|---|---|---|
| D1 | End-to-end success (sentence to saved, validated, 5-bot-tested game with a Muse cover) | 10 of 10; 0 offline fallbacks; 43 Muse calls (10 Ember briefs, 1 Ember content call, 22 Wonder turns, 10 Image covers), 0 failed, 0 retried, no rate-limit errors. Wonder wrote the game content in 9 of 10 runs; Ember wrote it once (a word list, run 02) | Measured |
| D2 | Time from sentence to finished game | Median 28.0 s; range 15.7 to 40.9 s; mean 27.85 s. Per run: 40.9, 24.3, 27.2, 15.7, 30.6, 28.9, 35.0, 28.8, 26.7, 20.4 s | Measured |
| D3 | Game ready before its cover | Game validated and bot-tested at a median 21.0 s (15.4 to 28.8 s). Cover took a median 20.2 s (9.1 to 34.9 s) in parallel and was the last step in 8 of 10 runs, adding a median 3.35 s (max 18.0 s). (A single standalone cover call earlier that day took about 11 s; teammate-reported, not logged) | Measured |
| D4 | Per-model timing and models used | Ember brief median 1.9 s (1.3 to 2.7 s). Wonder median 2 turns (2 to 3), median 8.45 s per turn and 18.35 s per game (13.9 to 26.9 s). Formula chosen at a median 7.0 s. Every run used muse-ember-1.0, muse-wonder-1.0, muse-image-1.0; muse-spark-1.3 (fallback) never needed | Measured |
| D5 | First-draft pass rate | 9 of 10 passed validation and playtest first time; 10 of 10 after at most 1 repair. The one repair (Group Daily used two "flow" concepts where one is allowed) was fixed by Wonder in one 12.4 s turn. 50 bot runs, all completed | Bot-run |
| D6 | Variety with no hints | All 6 formulas (answer 3, guess 3, dodge 1, sort 1, merge 1, timing 1) and all 8 looks across 10 games. Note: each run was told the previous 4 looks, as the app's look memory does | Measured |
| D7 | Muse against a template baseline (the offline composer, which picks a formula by keyword and fills a template) | Offline: 10 of 10 valid, median 0.068 s (0.043 to 5.971 s), but 2 on-topic, 2 partly, 6 off-topic, paper look in 7 of 10. Muse: 10 of 10 on-topic. Same formula chosen on 8 of 10 prompts. This shows an LLM is needed; it does not show what Facebook context adds | Relevance is an estimate (one agent's judgment, not users); timings measured |
| D8 | Facebook context used | Icebreaker used 7 of 7 attendees' opted-in posts, with each round pairing a name with facts from that person's intro. Group Daily used 5 of 5 opted-in posts ("Nothing else was read"), and each of its 5 answers was tied to a named member's intro (for example "BERLIN: Lena arrived from here just last week"). The neighborhoods quiz used the Group's name and location to set the quiz in SF. Fact spot-checks: neighborhoods 6 of 6 correct, Spanish 8 of 8 | Context use measured; fact checks are an estimate (agent check, 14 items) |
| D9 | Model output per game | Text output median 3,391.5 tokens (2,633 to 5,651), of which reasoning median 2,428.5; cover median 2,257 image tokens (1,094 to 2,862); 4 to 6 calls per game; median 10 of 55 concepts per game. Input tokens not logged | Measured |

### 8.2 Earlier Muse runs committed in the repo

| ID | Metric | Value | Label |
|---|---|---|---|
| D10 | 5 sample runs (create, edit, next level, Group Daily, Event icebreaker), 09:21 to 09:24 PST | 25.0, 40.6, 25.4, 39.4 and 33.0 s (median 33.0 s). Ember brief 1.1 to 2.4 s; Wonder 3.5 to 19.9 s per turn; Image covers 18.7 to 25.8 s. 3 of 5 runs auto-repaired (4 repair rounds); all 5 shipped valid. Text output 2,616 to 6,784 tokens per game, 64.5% reasoning overall. The Daily and icebreaker timelines say "Wonder wrote the content" | Measured |
| D11 | First end-to-end real Muse game that morning (Hill Drift, about 08:33 PST) | 58.5 s, reported in Slack at 08:48 by an agent, not logged: Ember wrote 12 SF hill names and Wonder assembled 15 pieces. This is a different run from the logged 25.0 s Hill Drift in D10 (09:21 PST), where Wonder wrote 8 obstacle labels and composed 14 concepts | Teammate-reported (not logged; unverified) |
| D26 | In-app Muse runs of Send It (09:37 PST) | Restyle from clay to pixel with "a little slower": 15.8 s. Level 2 (Send It 2): 28.4 s, which is the "28 s" reported in Slack at 09:48. The first make of Send It was not logged. Both published with covers | Measured (in-app run records) |

### 8.3 Runtime, verification and bot experiment

**How it was produced.** A script played each of the 13 seed games with bots at 3 skill levels and 10 random seeds (390 runs), then re-simulated every run from its seed and input log in Node.

| ID | Metric | Value | Label |
|---|---|---|---|
| D12 | Runs reproduced exactly from seed plus input log | 390 of 390 (same score, ticks and event counts) | Bot-run |
| D13 | Size of a run's input log (also what a Burst replays) | Median 600 bytes; 90th percentile 5,980; max 27,498 (uncompressed JSON) | Bot-run |
| D14 | Cost to verify a run (replaces an earlier "about 24 ms" in our notes) | 4.06 ms of CPU per run on average in Node (about 8,900 times faster than real time). The JavaScriptCore shell simulated a 90 s run in 8.53 ms | Bot-run (Node and macOS jsc shell, not a phone or server) |
| D15 | Run lengths | 92% (331 of 359) of runs that ended by a game rule lasted 10 to 120 s. Medians: Fog Words (Group Daily) 13.5 s, picnic icebreaker 13.6 s, Fog or Sun? 18.4 s, Trivia Thursday SF 21.7 s, picnic This or That 23.1 s. Bots read instantly; people will be slower | Bot-run |
| D16 | Scores reward skill | Median score rose with bot skill (0.35, 0.7, 0.95) on 12 of 13 games, e.g. Hill Hopper 5, 18, 117; Trivia Thursday SF 296, 683, 1,150. Exception: Fog Words 200, 400, 300 | Bot-run |
| D17 | Test suites (rerun with the repo's runners at `0a3e8f7`) | Runtime: the Node runner reports 318 passed, 0 failed (its main suite prints 310, the figure quoted in Slack); the JavaScriptCore runner reports 308 passed, 0 failed. Kits: pass in both engines, 23 fingerprinted runs identical across engines; 11 of 11 manifests validate. The kit runner prints no test count. Earlier counts (212 and 202 on the Build tracker) are out of date | Measured |
| D18 | Speed on the iOS simulator | Warm switch to the next game about 3.6 ms median (1.9 to 9.7 ms) against a 50 ms target; game start once warm 17 to 27 ms; 57 to 60 fps. Memory not measured; not yet measured on a phone | Teammate-reported (simulator); no log in our data folder, not reproduced by us |

### 8.4 Product facts and simulations

| ID | Metric | Value | Label |
|---|---|---|---|
| D19 | Places in the app with Bubbles | 9 in all. 6 distribution surfaces: Home feed posts, Stories, Reels and the Video tab, Groups (page and tab), Events, profiles. 3 entry points: the Bubbles tab, Notifications, the Library in the Menu. Messenger and Search: 0 so far | Measured (code count) |
| D20 | Feed candidate weights | Group Daily 3.0, friend's Burst 2.2, Event icebreaker 2.0, new nearby 1.8, Group member's Burst 1.6, next level 1.2, popular 0.8, your own 0.6 | Shipped configuration, not a result |
| D21 | Recommender simulation | 5 synthetic worlds of 90 people for 14 days, about 20% clickbait. Bait-averse users: clickbait share 36% today, 49% when ranking on taps alone, 14% with the social reward; pages per session 5.9 to 7.2. Bait-loving users: 6.8 to 10.2 pages | Simulated; teammate-reported, not reproduced by us |
| D22 | Code size | 68 Bubbles Swift files (20,908 lines) in an app of 183 Swift files (53,101 lines), plus 12,332 lines of runtime JS, CSS and HTML; 13 seed games; 6 formulas, 55 concepts, 8 looks | Measured |
| D23 | Installs | Builds running on 4 team iPhones (iOS 18.6 and iOS 26) | Teammate-reported (installs, not usage) |
| D24 | Rust/WASM engine for a new format | 124 tests pass; 50 seeds times 1,000 random inputs per test game gave 0 runtime errors; state hashes match between native and WASM | Teammate-reported, not reproduced by us; not in the app |
| D25 | Demo world | 1 Group, 1 Event, 10 newcomers with intros. The Group's 2,814 members, the picnic's 46 going, mutual-friend counts on board rows, and the play and like counts on seed games are synthetic | Synthetic |

## 9. How we'd know it works

**North star.** The share of new Group members who make a first new friend (an accepted friend request with another member) or attend a first Event within 14 days of joining.

**Guardrails.** We would watch four things:

- notification mutes and unsubscribes;
- block and report rate on board-originated friend requests;
- session length, where we want short, social sessions, not longer ones;
- removal requests on games made from posts.

**Pilot.** We would run it in four steps:

1. Randomize at the Group level: the Daily on or off, across new local Groups (for example, newcomer and city Groups) in a few cities.
2. Run it for 4 weeks.
3. Compare the north star and guardrails between arms.
4. Also measure admin opt-in, since supply depends on it (VP-18).

**The return loop: why someone comes back on day 2, 7 and 30.**

| When | Why she returns | Loop step |
|---|---|---|
| Day 2 | A new Daily in her Group, and the Daily-ready notification | Daily |
| Day 2 to 7 | Someone passed her score; she checks the board, watches their Burst and sends an Add friend | Board, then Add friend |
| Day 7 | The picnic is Saturday; she plays the icebreaker and goes | Event |
| Day 7 to 30 | A rematch with a new friend in Messenger, a weekly trophy, a game made with friends (not built) | Rematch |
| Day 30 | Each Group she has joined has its own Daily | The next Daily |

The loop: Daily, then board, then Add friend, then Event, then rematch, then the next Daily.

## 10. How this maps to the brief

### 10.1 Judging criteria

| Criterion | Weight | Description (from the brief) | How we meet it |
|---|---|---|---|
| AI Integration | 30% | "AI does real work and feels like a natural part of the product, not a cosmetic add-on." | Ember writes the brief; Wonder composes the game through 8 tools, writes content from Group and Event posts and repairs failed drafts; Image paints the cover (VP-34, VP-35). Against a template baseline, 6 of 10 games were off-topic (D7). Per-Group dailies are impossible to hand-write at scale (VP-18). |
| Product Thinking and User Impact | 25% | "Solves a clear young-adult need, fits naturally on Facebook, and gives people a reason to come back." | Need: friends in a new city (the core five, section 2). Fit: built on Groups, Events, friends and the feed (section 3). Return: the loop and north star in section 9. |
| Execution & Demo | 25% | "A working, polished demo that does what you say it does, with no unnecessary mockups." | Studio runs live on real Muse (10 of 10, median 28.0 s, D1 and D2). Bubbles is on 6 distribution surfaces and 3 entry points (D19), and 318 runtime tests pass (D17). Every status is labeled Live, Debug/CLI only or Not built, and the roadmap is kept apart. |
| Originality and Cohesion | 20% | "A distinct, ambitious idea where every part cohesively supports solving the user problem." | Facebook Groups have members but no shared moment; Bubbles gives every Group and Event a daily shared moment that Muse writes from the community itself, played on one seed, so a score next to a stranger becomes an introduction. The five core value propositions are one chain (section 2). |

### 10.2 The four named needs

| Need in the brief | Our fit |
|---|---|
| Making friends in a new city | The core. Ages 19 to 29 are the loneliest age group worldwide (27% very or fairly lonely) [60]. 24% of US adults under 30 felt lonely "a lot of the day yesterday" in early 2023 [119]. In-person time with friends for ages 15 to 24 fell from about 150 to 40 minutes a day between 2003 and 2020 [59], and the Surgeon General compares the health risk of social disconnection to smoking [59]. 25% of US men aged 15 to 34 felt lonely a lot of the previous day [62]. Our answer is the Group Daily, the Event icebreaker and Add friend on boards (VP-02, VP-03, VP-04). |
| Finding their scene | Supporting. Games in Search lead to Groups (VP-11, not built); the feed surfaces Groups' games. |
| Getting a side hustle off the ground | Not our focus. Makers get credit and an audience (VP-23), but we make no income claim. |
| Turning group-chat plans into real plans | Partly. Icebreakers attach play to an Event; group-chat cards, game night and Event brackets connect chats to Events (VP-15, VP-19, VP-40, not built). |

### 10.3 Places to start

| Place | Where we fit | Where we deliberately don't |
|---|---|---|
| Marketplace | Bubbles complements the newcomer's Marketplace habit (VP-08). | No games in listings: buying and selling should stay fast and trusted. |
| Groups | The center: Daily, boards, Games section, game night (VP-02, VP-18, VP-19). | No auto-posting without admin opt-in. |
| Events | Icebreakers before you meet; game night as an Event (VP-03). | We don't replace the Event; play leads to showing up. |
| Dating | Lessons transfer (everyday names, low-pressure first contact). Young-adult matches on Facebook Dating were up 10% a year in 2025 [51], so Meta already uses Facebook to help young adults meet people. | Out of scope: we chose friendship, a lower-stakes and wider need. |
| Gaming | A new kind of social gaming made by members (VP-05, VP-29). | No studio catalog, no cash or token rewards. |
| Messenger | Challenge Me and group-chat play (VP-14, VP-15, not built). | No heavy game engine in the thread; a light card. |
| Feed, Reels and Profile | Bursts, floats, a playable feed, the profile Bubbles tab, Games about me (VP-09, VP-13, VP-39). | No maximizing of minutes; finite daily play. |
| Something new | Playable, AI-made posts about your own people (VP-01, VP-37). | |

### 10.4 "AI should be essential, not decorative"

| What the brief names | What Muse does in Bubbles | Honest strength |
|---|---|---|
| Understand what you're looking for better than a search box | Ember reads one sentence as mood, energy, competition and audience, and writes an editable brief in about 2 s (D4). | Moderate. The brief is real work but simple; the Search feature is not built. |
| Match you with the right people or communities | The feed ranks by relationship and boards offer Add friend; the recommender would reward new friendships; Blends would turn two people's tastes into one game (VP-04, VP-10, VP-40). | Moderate. Matching comes mostly from the graph, not from Muse today; Blends is not built. |
| Coordinate on your behalf | Icebreakers prepare guests before an Event; a Group's Daily gives everyone the same game; Challenge Me and group-chat play are being built. | Thinnest today. Landing Challenge Me would make it concrete. |
| Create something new with you | Wonder composes and writes content from members' intros; Ember writes the brief; Image paints; bots test; Wonder repairs (VP-34). | Strong on the mechanism (D1, D5, D8); the effect on people is untested. |

**Why it would not work without AI.** Without an LLM, there is no game about your Group: the template composer made valid games, but 6 of 10 were off-topic (D7). And without Muse there is no supply: tens of millions of Groups and Events cannot each get a hand-made daily game or icebreaker.

## 11. What we still need to prove, and quick ways to get the data

| Gap | Why it matters | Quick way to close it before the demo |
|---|---|---|
| What Facebook context adds (context ablation) | Our "why Facebook" thesis says the value is the context; D7 only compares against a template | Run Muse twice on the same sentences: once with the Group, Event and member context, once with none. People rate the pairs blind on "mentions real members or facts", "would you play this with this Group" and "would you add someone after playing". About an hour |
| Muse relevance judged by people, not one agent | Our AI-essential claim (D7) | Blind rating: 4 teammates rate the 10 Muse and 10 offline games as on-topic or not, order shuffled (about 20 minutes) |
| Game against text icebreaker | Answers "why a game at all?" | Hallway test with three arms: play the icebreaker; read an AI-written "meet who's coming" summary; read the plain guest list. Then ask each tester to name 3 guests, and ask whether they'd add one |
| How long people take, and whether they finish | Bot timings are a proxy (D15) | Hallway test: 5 to 10 people play the Daily and the icebreaker on a team iPhone; record time and completion |
| Daily generation in the normal UI | VP-01 and VP-18 are Debug/CLI only today | Wire Studio's daily mode into the Group page for admins, so the core thesis is Live |
| Phone performance and memory | Simulator only, teammate-reported (D18) | Measure warm switch, fps and memory on a team iPhone with Instruments, and save the log |
| Perceived wait | The game is ready at 21.0 s but shown at 28.0 s (D3) | Let people play once the game passes its checks, and fade the cover in later |
| Repairs on Group Dailies | Both logged Dailies needed a repair for the same rule (D5, D10) | Teach Wonder the one-flow rule in the daily prompt; saves about 12 s |
| Cost per game | No input-token counts (D9) | Log input tokens in the CLI and rerun the 10-prompt bench |
| Opt-in, moderation and anti-abuse | Named gaps (VP-21, section 5.4) | Add a composer toggle, a basic content check and "remove me"; until then, say "not built" |
| Venue network | Latency was measured on one network | Rerun 3 prompts on the venue Wi-Fi; keep a recorded backup run |
| Unverified sources | Some claims rest on secondary press | Check the Business Insider original on Pocket [44] and confirm Muse Ember on a Meta page [29], or cut them. Check whether the FY2025 10-K keeps the young-adult and "particularly younger users" sentences [12]. Verify events in WhatsApp Communities. Check whether "friend bubbles" is already a Facebook Reels feature name before settling the product name |
| Real usage | Every "Helps people" rating in section 4 | The pilot in section 9; none can be measured before the demo |

## 12. Sources

### Meta primary sources

1. Meta, Q4 2025 earnings call transcript, 2026-01-28. https://s21.q4cdn.com/399680738/files/doc_financials/2025/q4/META-Q4-2025-Earnings-Call-Transcript.pdf
2. Meta Newsroom, "Introducing Muse Spark", 2026-04-08. https://about.fb.com/news/2026/04/introducing-muse-spark-meta-superintelligence-labs/
3. Meta, Q1 2026 earnings call transcript, 2026-04-29. https://s21.q4cdn.com/399680738/files/doc_financials/2026/q1/META-Q1-2026-Earnings-Call-Transcript.pdf
4. Meta, Q2 2026 earnings call transcript, 2026-07-29. https://s21.q4cdn.com/399680738/files/doc_financials/2026/q2/META-Q2-2026-Earnings-Call-Transcript.pdf
5. Meta, Q3 2026 earnings call transcript, 2026-10-21. https://s21.q4cdn.com/399680738/files/content_files/META-Q3-2026-Earnings-Call-Transcript.pdf
6. Meta, "Meta Reports Third Quarter 2026 Results", 2026-10-21 (settlement terms); AP coverage for the 18+ Muse limit. https://investor.atmeta.com/investor-news/press-release-details/2026/Meta-Reports-Third-Quarter-2026-Results/default.aspx and https://www.news4jax.com/business/2026/10/21/meta-q3-revenue-tops-estimates-and-zuckerberg-says-muse-accounts-have-topped-10-million/
7. Meta, Q4 2024 earnings call transcript, 2025-01-29. https://s21.q4cdn.com/399680738/files/doc_financials/2024/q4/META-Q4-2024-Earnings-Call-Transcript.pdf
8. Meta, Q1 2025 earnings call transcript, 2025-04-30 (includes "Facebook, which is the second largest driver of Meta AI engagement"). https://s21.q4cdn.com/399680738/files/doc_financials/2025/q1/Transcripts/META-Q1-2025-Earnings-Call-Transcript-1.pdf
9. Meta, Q3 2025 earnings call transcript, 2025-10-29. https://s21.q4cdn.com/399680738/files/doc_financials/2025/q3/META-Q3-2025-Earnings-Call-Transcript.pdf
10. Meta, Q3 2024 earnings call transcript, 2024-10-30. https://s21.q4cdn.com/399680738/files/doc_financials/2024/q3/META-Q3-2024-Earnings-Call-Transcript.pdf
11. Meta, Q4 2023 earnings presentation (last regional user breakdown), 2024-02-01. https://s21.q4cdn.com/399680738/files/doc_financials/2023/q4/Earnings-Presentation-Q4-2023.pdf
12. Meta, Form 10-K for fiscal 2024, 2025-01-29 (mission, young-adult focus, competition among younger users, violating-account estimate). https://s21.q4cdn.com/399680738/files/doc_financials/2024/ar/Meta-12-31-2024-10K-ARS.pdf
13. Tom Alison, "The Future of Facebook", Meta Newsroom, 2024-05-31. https://about.fb.com/news/2024/05/the-future-of-facebook/
14. Meta Newsroom, Local tab, Messenger Communities and AI, 2024-10-04. https://about.fb.com/news/2024/10/facebook-local-tab-messenger-communities-ai/
15. Meta Newsroom, "Navigating Your 20s With Facebook", 2024-09-04. https://about.fb.com/news/2024/09/navigating-your-20s-with-facebook/
16. Meta Newsroom, "Supporting Online Communities", 2020-10-01. https://about.fb.com/news/2020/10/supporting-online-communities/
17. Meta Newsroom (French), Groups and Events figures, 2017-11-22. https://about.fb.com/fr/news/2017/11/1-milliard-dutilisateurs-des-groupes-outils-de-lien/
18. Meta Newsroom, "Introducing the Events from Facebook App", 2016-10-07. https://about.fb.com/news/2016/10/introducing-the-events-from-facebook-app/
19. Meta Newsroom, "Messenger's 2017 Year in Review", 2017-12-13. https://about.fb.com/news/2017/12/messengers-2017-year-in-review/
20. Meta Newsroom, "Bringing the Magic of Friends Back to Facebook", 2025-03-27. https://about.fb.com/news/2025/03/bringing-magic-of-friends-back-to-facebook/
21. Meta Newsroom, "Introducing Facebook Verified", 2026-07-24. https://about.fb.com/news/2026/07/introducing-facebook-verified/
22. Tom Alison, "Connecting Real People on Facebook", Meta Newsroom, 2026-07-24. https://about.fb.com/news/2026/07/connecting-real-people-on-facebook/
23. Meta Newsroom, "Facebook Marketplace Gets a Glow Up", 2025-11-13. https://about.fb.com/news/2025/11/facebook-marketplace-gets-a-glow-up/
24. Meta Newsroom, new AI tools on Facebook (AI Mode search), 2026-06-15. https://about.fb.com/news/2026/06/new-ai-tools-to-help-you-make-things-happen-on-facebook/
25. Meta Newsroom, Forum, a dedicated app for Facebook Groups, 2026-09-29. https://about.fb.com/news/2026/09/find-community-forum-dedicated-app-facebook-groups/
26. Meta Newsroom, new tools for admins on Forum (Admin AI), 2026-10-23. https://about.fb.com/news/2026/10/new-tools-for-the-admins-who-build-communities-on-forum/
27. Meta Newsroom, Creator fast track and 2025 creator payouts, 2026-03-18. https://about.fb.com/news/2026/03/creator-fast-track-grow-your-audience-earn-money-on-facebook/
28. Meta Newsroom, "Introducing Muse Wonder", 2026-10-12. https://about.fb.com/news/2026/10/introducing-muse-wonder-models/
29. TechCrunch, Muse Ember launch and pricing, 2026-11-09 (input price only; Meta page for Ember not yet checked). https://techcrunch.com/?p=3186298
30. Facebook Help Center, names on Facebook, accessed 2026-11-12. https://www.facebook.com/help/112146705538576
31. Facebook Research, "Three and a half degrees of separation", 2016-02-04. https://research.facebook.com/blog/2016/02/three-and-a-half-degrees-of-separation/
32. Meta for Developers, "Web and Instant Games changes", 2025-07-31 (updated 2025-11-18). https://developers.facebook.com/blog/post/2025/07/31/web-and-instant-games-changes/
33. Meta for Developers, Instant Games closed beta, 2016-11-30. https://developers.facebook.com/blog/post/2016/11/30/instant-games-closed-beta/
34. App Developer Magazine, "Facebook Instant Games turns two with 20 billion game sessions played", 2018-12-13 (secondary; a Meta primary post was not found). https://appdevelopermagazine.com/facebook-instant-games-turns-two-with-20-billion-game-sessions-played/
35. TechCrunch, Instant Games opens to all developers, 2018-03-15. https://techcrunch.com/?p=1607019
36. Engadget, Instant Games leave Messenger on iOS, 2019-07-26 (states the change; gives no reason from Facebook). https://www.engadget.com/2019-07-26-instant-games-facebook-gaming-tab.html
37. TechCrunch, Meta shutting down the Facebook Gaming app, 2022-08-30 (spokesperson: "hundreds of millions of people play games, watch gaming video, and connect in gaming Groups each month" in the main app). https://techcrunch.com/2022/08/30/meta-shutting-down-facebook-gaming-app/
38. Game Developer, FarmVille reaches 32 million daily users, 2010-03-09. https://gamedeveloper.com/game-platforms/gdc-i-farmville-i-reaches-32-million-daily-users
39. Game Developer, Facebook games dip as notification rules change, 2010-05-07. https://gamedeveloper.com/game-platforms/facebook-games-see-user-dip-as-notification-rules-change
40. Facebook, Form S-1, 2012-02-01. https://www.sec.gov/Archives/edgar/data/0001326801/000119312512034517/d287954ds1.htm
41. Meta for Developers, GDC 2013 recap, 2013-04-29. https://developers.facebook.com/blog/post/2013/04/29/game-developers-conference-sf--video-recap/
42. Meta for Developers, Connect recap: Horizon Create and Horizon Studio, 2026-09-24. https://developers.meta.com/blog/meta-connect-recap-horizon-create-and-horizon-studio
43. TechCrunch, Meta brings Pocket to US users, 2026-08-20. https://techcrunch.com/2026/08/20/meta-brings-pocket-an-app-that-lets-you-vibe-code-and-share-games-to-us-users/
44. Digital Trends, citing Business Insider, on Pocket (runs on Muse Spark, no direct messages, no plans to integrate with other apps), 2026-08-20 (secondary; Business Insider original not checked). https://www.digitaltrends.com/gaming/u-s-users-can-now-vibe-code-and-share-mini-games-with-metas-pocket-app/
45. TechCrunch, "Meta launches Vibes, a short-form video feed of AI slop", 2025-09-25. https://techcrunch.com/2025/09/25/meta-launches-vibes-a-short-form-video-feed-of-ai-slop
46. Business Insider via Yahoo, Zuckerberg testimony on friends, 2025-04-14. https://www.yahoo.com/news/facebook-isnt-really-friends-anymore-184002588.html
47. Meta's FTC trial opening slide, as reported by The Keyword, 2025-04-22 (medium confidence; court exhibit not found). https://www.thekeyword.co/news/meta-says-users-are-spending-less-time-on-friend-content
48. Cyprus Mail (republishing Reuters), Zuckerberg testimony on time-based goals, 2026-02-18 (paraphrase, no direct quote; Reuters original not checked). https://cyprus-mail.com/2026/02/18/zuckerberg-says-meta-no-longer-designs-apps-to-maximize-screentime
49. TechCrunch, Meta's Forum app (history of the 2014 to 2017 Groups app), 2026-05-22. https://techcrunch.com/2026/05/22/meta-quietly-launches-a-new-reddit-like-app-called-forum/

### Research and surveys

50. SiliconANGLE, Facebook's new mission to "bring the world closer together", 2017-06-22. https://siliconangle.com/blog/2017/06/22/zuckerberg-sets-new-mission-facebook-bring-world-closer-together/
51. Meta Newsroom, Facebook Dating features for young adults, 2025-09-22. https://about.fb.com/news/2025/09/facebook-dating-adds-features-address-swipe-fatigue/
52. Pew Research Center, Social Media Fact Sheet, 2026-10-19 (survey 2026-01-30 to 2026-06-18, n=5,511). https://www.pewresearch.org/internet/fact-sheet/social-media/
53. Pew Research Center, "Americans' Social Media Use 2025", 2025-11-20 (survey 2025-02-24 to 2025-03-02, n=5,123). https://www.pewresearch.org/wp-content/uploads/sites/20/2025/11/PI_2025.11.20_Social-Media-Use_REPORT.pdf
54. Pew Research Center, "Teens, Social Media and Technology 2024", 2024-12-12. https://www.pewresearch.org/internet/2024/12/12/teens-social-media-and-technology-2024/
55. Pew Research Center, "Teens and Video Games Today", 2024-05-09 (no longer cited; see the appendix on what we dropped). https://www.pewresearch.org/internet/2024/05/09/teens-and-video-games-today/
56. Pew Research Center, "Connection, Creativity and Drama: Teen Life on Social Media in 2022", 2022-11-16 (no longer cited; see the appendix on what we dropped). https://www.pewresearch.org/internet/2022/11/16/connection-creativity-and-drama-teen-life-on-social-media-in-2022/
57. Pew Research Center, "What does friendship look like in America?", 2023-10-12. https://www.pewresearch.org/short-reads/2023/10/12/what-does-friendship-look-like-in-america/
58. Pew Research Center, "Men, Women and Social Connections", 2025-01-16. https://www.pewresearch.org/social-trends/2025/01/16/men-women-and-social-connections/
59. US Surgeon General, "Our Epidemic of Loneliness and Isolation", 2023-05-03. https://www.hhs.gov/sites/default/files/surgeon-general-social-connection-advisory.pdf
60. Gallup and Meta, "Global State of Social Connections", 2023-10-24. https://news.gallup.com/opinion/gallup/512618/almost-quarter-world-feels-lonely.aspx
61. Gallup, "Loneliness in America Rising, Particularly for Young People", 2024-10-14. https://news.gallup.com/poll/651881/loneliness-america-rising-particularly-young-people.aspx
62. Gallup, "Younger Men Among the Loneliest in the West", 2025-05-20. https://news.gallup.com/poll/690788/younger-men-among-loneliest-west.aspx
63. US Census Bureau, ACS-60 report on generational mobility, 2025-04. https://www2.census.gov/library/publications/2025/demo/acs-60.pdf
64. Survey Center on American Life, "The State of American Friendship", 2021-06-08. https://www.americansurveycenter.org/research/the-state-of-american-friendship/
65. University of Kansas, on Hall (2018), hours to make a friend, 2018-03-06. https://news.ku.edu/news/article/2018/03/06/study-reveals-number-hours-it-takes-make-friend
66. Greater Good Science Center, "How Long Does It Take to Make a Friend?", 2018-05-25. https://greatergood.berkeley.edu/article/item/how_long_does_it_take_to_make_a_friend
67. Sandstrom and Dunn, "Social Interactions and Well-Being: The Surprising Power of Weak Ties", PSPB, 2014. https://repository.essex.ac.uk/15300/
68. Boothby et al., the "liking gap", Psychological Science, 2018 (ScienceDaily, 2018-09-11). https://sciencedaily.com/releases/2018/09/180910160629.htm
69. Liu et al., "The Surprise of Reaching Out", JPSP (APA release, 2022-07-11). https://www.apa.org/news/press/releases/2022/07/friends-enjoy-being-reached
70. Burke and Kraut, JCMC, 2016 (ScienceDaily, 2016-09-09). https://www.sciencedaily.com/releases/2016/09/160906084841.htm
71. Ellison, Steinfield and Lampe, "The Benefits of Facebook Friends", JCMC, 2007. https://academic.oup.com/jcmc/article/12/4/1143/4582961
72. Depping, dissertation including CHI PLAY 2016 ("Trust Me"), CHI PLAY 2017 ("Cooperation and Interdependence") and CHI PLAY 2018 ("Designing for Friendship"), University of Saskatchewan, 2018. https://harvest.usask.ca/bitstream/10388/12093/1/DEPPING-DISSERTATION-2018.pdf
73. APA release on Oishi and Schimmack (2010), childhood moves and adult well-being, 2010-06-03 (no longer cited; see the appendix on what we dropped). https://www.apa.org/news/press/releases/2010/06/moving-well-being
74. Tamir and Mitchell, "Disclosing information about the self is intrinsically rewarding", PNAS, 2012. https://pmc.ncbi.nlm.nih.gov/articles/PMC3361411/
75. Norton, Mochon and Ariely, "The IKEA Effect", HBS working paper 11-091, 2011. https://www.hbs.edu/ris/Publication%20Files/11-091.pdf
76. Entertainment Software Association, Essential Facts 2025 (YouGov, n=5,000; industry survey), 2025-05-30. https://www.theesa.com/wp-content/uploads/2025/06/2025-Essential-Facts-Booklet-05-30-25-RGB.pdf
77. Verduyn, Kross et al., "Passive Facebook usage undermines affective well-being", Journal of Experimental Psychology: General 144(2), 2015 (checked from summaries only). https://www.apa.org/pubs/journals/xge
78. Ravaja et al., "Spatial Presence and Emotions during Video Game Playing: Does It Matter with Whom You Play?", Presence 15(4), 2006 (checked from the abstract only). https://dblp.org/rec/journals/presence/RavajaSTLSK06

### Games and platforms

79. LinkedIn Newsroom, Wend launch and games retention, 2026-06-08. https://news.linkedin.com/2026/LinkedIn-AnnouncesWend
80. LinkedIn Newsroom, Tango launch (earlier 80% and 76% figures), 2024-10-07. https://news.linkedin.com/2024/October/linkedin-announces-tango-
81. TechCrunch, LinkedIn launches games (company affiliation and company leaderboards), 2024-05-01. https://techcrunch.com/2024/05/01/linkedin-launches-gaming-three-logic-puzzles-aiming-to-extend-time-spent-on-its-networking-platform
82. AP (via News4JAX), New York Times launches its first 2-player game, 2026-01-21. https://www.news4jax.com/business/2026/01/21/this-just-in-from-the-new-york-times-its-first-2-player-game-and-an-evolving-business-model/
83. A Media Operator, Wordle and NYT Games, 2026-08-03. https://www.amediaoperator.com/analysis/wordle-tv-show-new-york-times-games-jonathan-knight/
84. The New York Times Company, Q1 2025 prepared remarks, 2025-05-07. https://s23.q4cdn.com/152113917/files/doc_events/2025/May/07/Q1-2025-Prepared-Remarks.pdf
85. The New York Times Company, Q2 2025 prepared remarks, 2025-08-06. https://s23.q4cdn.com/152113917/files/doc_events/2025/Aug/06/Q2-2025-Prepared-Remarks.pdf
86. TechCrunch, Wordle brought tens of millions of new users to the Times, 2022-05-04 (no longer cited in the main text). https://techcrunch.com/2022/05/04/wordle-new-york-times-user-growth
87. The Spinoff, "Those coloured boxes on Twitter are New Zealand's fault", 2022-01-13. https://thespinoff.co.nz/media/13-01-2022/those-coloured-boxes-on-twitter-are-new-zealands-fault
88. Game Developer, Josh Wardle at GDC 2022, 2022-03-25. https://www.gamedeveloper.com/marketing/josh-wardle-reflects-on-the-the-unconventional-road-to-wordle-s-success
89. Harvard Making Caring Common, "Loneliness in America", 2021-02. https://mcc.gse.harvard.edu/reports/loneliness-in-america
90. Game Developer blog by Lisa Hanson (citing Tencent at its developer conference), WeChat Mini Games, 2018-02-06. https://www.gamedeveloper.com/business/tencent-targets-casual-mobile-gamers-with-wechat-mini-games
91. PocketGamer.biz, WeChat Mini Games pass 500M monthly users, 2026-06-05. https://www.pocketgamer.biz/wechat-mini-games-crosses-500m-monthly-active-users-as-tencent-shifts-focus-to-retention/
92. TechNode, WeChat mini program games hit 500 million monthly users, 2025-06-26. https://technode.com/2025/06/26/wechat-mini-program-games-hit-500-million-monthly-users-pc-usage-surges/
93. Roblox Newsroom, co-play sessions, 2025-03-17. https://about.roblox.com/newsroom/2025/03/unveiling-future-creation-native-3d-generation-collaborative-studio-tools-economy-expansion
94. Roblox, Q4 2025 shareholder letter, 2026-02-05. https://s27.q4cdn.com/984876518/files/doc_financials/2025/q4/Q4-2025-Shareholder-Letter.pdf
95. Gaming.net, Roblox Q3 2026 results (press summary of company figures), 2026-10-30. https://gaming.net/roblox-q3-revenue-rises-16-as-bookings-fall-12-to-1-7-billion
96. Roblox Newsroom, Cube Foundation Model and 4D generation, 2026-02-04. https://about.roblox.com/newsroom/2026/02/accelerating-creation-powered-roblox-cube-foundation-model
97. Roblox Newsroom, age-based communication, 2025-07-17. https://about.roblox.com/newsroom/2025/07/advancing-safety-on-roblox-with-age-based-communication
98. Discord, "Build where the world plays", 2024-09-26. https://discord.com/blog/build-where-the-world-plays
99. TechCrunch, Discord age verification, 2026-02-09. https://techcrunch.com/2026/02/09/discord-to-roll-out-age-verification-next-month-for-full-access-to-its-platform/
100. Engadget, X is shutting down Communities, 2026-04-23. https://engadget.com/social-media/x-is-shutting-down-its-communities-feature-182843958.html
101. Engadget, YouTube Playables Builder with Gemini 3, 2025-12-16. https://www.engadget.com/ai/youtube-is-letting-creators-make-playable-games-with-a-gemini-3-tool-195500318.html
102. Tubefilter, YouTube Playables rollout, 2024-05-28. https://www.tubefilter.com/2024/05/28/youtube-playables-rollout/
103. MacRumors, TikTok group chats up to 32 users, 2024-08-13. https://www.macrumors.com/2024/08/13/tiktok-rolls-out-group-chats-32-users/
104. MacRumors, TikTok US Local Feed, 2026-02-11. https://www.macrumors.com/2026/02/11/tiktok-us-local-feed/
105. TikTok for Developers, Mini Games overview, updated 2026-10-05. https://developers.tiktok.com/doc/mini-games-overview
106. Snap Newsroom, "Restructuring and refocusing our business", 2022-08-31. https://newsroom.snap.com/restructuring-and-refocusing-our-business
107. Snap, Q3 2026 results press release, 2026-11-04 (via Seeking Alpha's copy; investor.snap.com original not checked). https://seekingalpha.com/pr/20713831
108. Reddit, Q3 2026 results (SEC 8-K exhibit), 2026-10-29. https://www.sec.gov/Archives/edgar/data/0001713445/000171344526000114/earningspressreleaseq326.htm
109. Phaser, Reddit Devvit games hackathon, 2025-02-28 (secondary; Reddit's own Devvit docs not checked). https://phaser.io/news/2025/02/hack-reddit-2025
110. Apple Newsroom, "Introducing the Apple Games app", 2025-06-10. https://www.apple.com/newsroom/2025/06/introducing-the-apple-games-app-a-personalized-home-for-games/
111. WhatsApp Blog, "Communities now available", 2022-11-03. https://blog.whatsapp.com/communities-now-available
112. Telegram Blog, gaming platform, 2016-10-03; Telegram FAQ (group size). https://telegram.org/blog/games and https://telegram.org/faq
113. Decrypt, Hamster Kombat player decline, 2024-11-02. https://decrypt.co/289725
114. Duolingo Blog, "How Duolingo's streak builds habit", 2022-01-31. https://blog.duolingo.com/how-duolingo-streak-builds-habit/
115. Thurrott, Instagram crosses 3 billion monthly users, 2025-09-24 (secondary; Meta's announcement not checked). https://www.thurrott.com/cloud/327214/instagram-crosses-3-billion-monthly-active-users
116. TechCrunch, Threads developing in-message games, 2026-01-06. https://techcrunch.com/2026/01/06/threads-is-developing-in-message-games/
117. GamesBeat, Snap Games reach 200 million players, 2021-05-20. https://gamesbeat.com/snapchat-games-have-reached-more-than-200-million-people/
118. Kun.uz, Telegram surpasses 1 billion users (CEO statement), 2025-03-20 (secondary; Durov's own post not checked). https://kun.uz/en/news/2025/03/20/telegram-surpasses-1-billion-active-users-closes-in-on-whatsapps-dominance
119. Gallup, "Loneliness in U.S. Subsides From Pandemic High", 2023-04-04. https://news.gallup.com/poll/473057/loneliness-subsides-pandemic-high.aspx
120. TechCrunch, Facebook search volume (2 billion searches a day), 2016-07-27. https://techcrunch.com/2016/07/27/facebook-will-make-you-talk/
121. Apple Newsroom, "Introducing Apple Invites, a new app that brings people together for life's special moments", 2025-02-04 ("iCloud+ subscribers can create invitations"; "anyone can RSVP, regardless of whether they have an Apple Account or Apple device"). https://www.apple.com/newsroom/2025/02/introducing-apple-invites-a-new-app-that-brings-people-together/
122. Partiful, home page ("Plan events in seconds with fun, free event pages"), accessed 2026-11-12. https://partiful.com/
123. Discord Developer Documentation, Guild Scheduled Event (stage, voice and external entity types), accessed 2026-11-12. https://docs.discord.com/developers/resources/guild-scheduled-event
124. Apple, App Store Review Guidelines, section 4.7 (mini apps and mini games) and 4.7.1 to 4.7.5, accessed 2026-11-12. https://developer.apple.com/app-store/review/guidelines/
125. Spotify Newsroom, Blend, a shared playlist that merges two people's listening with a taste match score, 2021-08-31. https://newsroom.spotify.com/2021-08-31/how-spotifys-newest-personalized-experience-blend-creates-a-playlist-for-you-and-your-bestie/

## Appendix: what we dropped or held back, and why

| Item | Why it is not in the main argument |
|---|---|
| "7 formulas" in our own notes | The runtime ships 6. "Make" is declared but has no runtime kit, so Studio cannot compose it. |
| Merged value propositions: VP-20, VP-22, VP-27, VP-30, VP-32, VP-33 | Overlapped with others. VP-20 is now part of VP-18, VP-22 of VP-05, VP-27 of VP-13, VP-30 of VP-10, and VP-32 and VP-33 of VP-31. New in recent revisions: VP-38 (Make it together), VP-39 (the playable feed) and VP-40 (Blends). |
| "Muse worked out San Francisco from the Group alone" | The Group is named "New in SF", so this is trivial. Replaced by the member-specific Daily answers (D8). |
| "3.57 degrees of separation" as newcomer evidence | A 2016 global average says nothing about a newcomer's board rows. Kept only for hometown friends (VP-14). |
| TikTok's 32-person chat cap and X's retired Communities as rebuttals in the short answer | Weak rivals; kept only in the section 7 table. |
| Oishi and Schimmack (2010) [73] | The study is about moves in childhood predicting adult well-being, especially for introverts, not about relocating as a young adult. Adult movers are covered by Hall [65][66] and the Census [63]. |
| Pew's teen gaming stat (47% of teen players made a friend online) [55] and teen creativity stat [56] | Teens are out of scope; Bubbles is for adults. |
| Wordle bringing "tens of millions of new users" to the Times [86] | Not needed once VP-13 focused on playable shares. |
| "NYT total plays still rose" | Our source gives Wordle's plays for 2024 and 2025 but no NYT total for 2024, so the rise isn't shown. |
| Seed games' studio times, play and like counts; the Group's member count; the Event's Going count; mutual-friend counts | Hand-written or synthetic demo data (D25). |
| Illustrative cost of a Daily per Group per day | Built on assumed token counts and an unverified output price. We claim only measured call counts and output tokens. |
| Hundreds of millions of people in Groups they call "meaningful" | Could not verify the figure and date against a Meta page in this pass. |
| Zuckerberg's "friendship gap" remarks and the reaction to AI companions | Could not verify the exact quote and date in this pass. Our framing, "AI that brings you to people", stands without it. |
| "Meta's playbook is to ship small new experiences fast and scale them with recommendations" | No primary quote found in the transcripts we hold. |
| Events in WhatsApp Communities | Reported, but not verified against a WhatsApp or Meta page. Mentioned as unverified in section 7. |
| Meta's family of apps at 3.64 billion daily people (Q3 2026 [5]); Netflix moving games toward playing together | True but not needed for the argument. |
| A Snap quote that playing with friends doubles play time | Could not retrieve the article or its date. |
| GamePigeon and other iMessage game usage numbers | Only conflicting third-party estimates. |
| Hamster Kombat "300 million players" as a fact | Company claim; we cite it only as claimed, next to the measured decline [113]. |
| Jest messaging-game numbers | Early, company-reported startup figures. |
| Harvard Making Caring Common's "61% of 18-to-25-year-olds seriously lonely" [89] | October 2020 pandemic survey of about 950 people that its authors call preliminary. |
| Facebook's "800 million monthly gamers" (2019), Gameroom shutdown, Facebook Local deprecation date | Not verified before the shared search budget ran out. |
| Several friendship studies (Rebecca Adams's three conditions, Aron's 36 questions, Epley and Schroeder on talking to strangers, Roberts and Dunbar, Back et al. on random seating, Cigna 2025) | Not verified from a source we could open. |
| Verduyn et al. (2015), "passive Facebook use undermines affective well-being" [77] | Checked only from summaries, and later reviews debate how cleanly passive and active use separate. Not cited as evidence; the related, verified Burke and Kraut finding [70] is used instead. |
| WeChat identity rules, Telegram's reported xAI deal, Snapchat group-chat size, Discord's age mix, Reddit developer payouts | Not verified. |
| A separate "active, connective time" value proposition | Merged into VP-10. |
| A separate "proven daily-games playbook" value proposition | Merged into VP-06 and VP-18; the LinkedIn and NYT evidence is cited there. |
| A separate "new creator class" and "interactive supply for Reels" | Merged into VP-05, VP-23, VP-13 and VP-39. |
| Using game data for ads | Dropped on purpose. VP-31 limits data use to content ranking. |

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
| Teen Facebook use fell from 71% (2014-15) to 32% (2024) [54]. A daily-use figure in our notes is unverified. | Scale of the gap. Teens, not our 18-to-29 users; Bubbles is adults-only | VP-26 | Problem canvas; [54] |
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
| **Competition:** Bubble Board with Group, Friends and Everyone tabs, a podium, your row pinned and a badge on verified runs. Live. | Fair, social ranking | VP-04, VP-16 | BubbleBoardView.swift; Bubble.swift |
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
| **Remix (K):** remix with credit. "Remix of Hill Drift by Leo"; the maker is notified ("Priya remixed your Bubble."); "Send it back" goes to their chat; a remix count and a remix tree with friends highlighted. Each remix records what changed. Lineage and the notification are Live; the rest is not built. | Remixing as conversation | VP-17, VP-23 | Slack, Nov 12 11:35; StudioModel.swift; feature spec |
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
| **Groups:** a Daily Bubble card at the top of each Group (cover, rule, Pop in, today's top 3, your standing, your streak). Live. | A Group-native ritual | VP-02, VP-06 | BubbleGroupSection.swift |
| **Groups:** a Games section, a weekly leaderboard with Most improved, game night and Challenge the Group. In the collaboration batch; not built. | Groups as the home for play | VP-19 | Slack, Nov 12 11:20; feature spec Nov 12 11:58 |
| **Events:** "Who's coming Saturday? Learn a few names before you go." on the picnic Event page, and "Make an icebreaker" on any Event you're going to. Live. | Events get people talking before they meet | VP-03 | BubbleEventSection.swift |
| **Events (new):** a bracket for everyone you met at the Event, from their Blends. Not built. | Play continues after the Event | VP-40 | Karthik, Nov 12 |
| **Messenger (K):** group-chat play as a playable card where everyone plays the same seed: "3 of 5 played", a mini leaderboard, a "your turn" nudge, rematch. Not wired at `0a3e8f7`. | Where plans start | VP-15 | Slack, Nov 12 11:35; feature spec Nov 12 11:58 |
| **Search (K):** find games by title, creator, category or Group; people results show that person's games; no match offers "Make it with Muse" with the query filled in. Not in `0a3e8f7` (only the Library has search). | AI where a search box falls short | VP-11 | Slack, Nov 12 11:20; feature spec |
| **Friends:** Add friend on every board row for someone you don't know yet (Confirm if they already asked); a Challenge button on friends' profiles (not built). | Play becomes friendship | VP-04 | BubbleBoardView.swift; Slack, Nov 12 11:20 |
| **Friends (new):** "Blend with" on a friend's profile or a board row makes a game from both of your play histories. Not built. | A game for two specific people | VP-40 | Karthik, Nov 12 |
| **Profiles:** a Bubbles tab with that person's Bubbles, best scores and chains; the Library holds yours, Groups', friends', chains, saved and popular. Live. | Self-expression on your profile | VP-09, VP-23 | BubbleProfileSection.swift; BubbleLibraryView.swift |
| **Feed:** friends' posts carry playable games. Diego: "Floated Hill Hopper to New in SF. Nobody has cleared Lombard yet." Chloe: "Got today's Fog Words in four. The fog was not helping." Maya: "Scored 27 in Sourdough Stack. Beat it?" (synthetic demo posts) | Games travel through posts | VP-13, VP-25 | BubbleFeedSurface.swift |
| **Reels and Video tab:** Bursts. Maya: "42 on Hill Hopper. Come beat it" (5.4K views, synthetic). Sam: "Caught the cable car by a hair". Lena: "Bay Bubbles, one more merge". Theo: "Drifting through the fog". | Games as watchable short video | VP-13, VP-39 | BubbleReelsSurface.swift |
| **Stories:** share a Burst ("Beat my 42 in Fog Words"); it plays muted for the run's length (6 to 12 s); Pop in opens the same game. | Stories carry play | VP-13 | BubbleStoriesSurface.swift |
| **Notifications:** "Today's Daily Bubble in New in SF is ready. Pop in before the fog lifts." / "Diego beat your score in Hill Hopper. Take it back?" / "Priya remixed your Bubble." / "Jordan played your Bubble." / "You passed Maya in Fog Words." | Pull-back loops on Facebook's own channel | VP-06, VP-17 | BubbleNotificationsSurface.swift |
| **The "New" badge (K, new):** a small "New" badge next to the feature wherever it appears in Facebook, so it calls itself out at once. Not built. Demo note in section 5.3. | The feature is easy to find on every surface | VP-08, VP-13 | Karthik, Nov 12 |
| Bubbles show up all over Facebook, not in a separate app: feed posts, Reels, the Video tab, Stories, Group and Event pages, profiles, notifications, the Bubbles tab, the Bubble page, the Library and Chains (6 distribution surfaces and 3 entry points, D19). | Integrated, not bolted on | VP-08 | Slack, Nov 12 08:48; Build tracker |
| Meta's suggested starting areas we cover: Groups, Events, Gaming, Messenger (in progress), Feed, Reels and Profile, plus Search. The brief describes Gaming as playing, watching and building community around games. | We build on surfaces Meta itself named | VP-08 (section 10.3) | Brief; Problem canvas |
| In the clone today: Gaming is a "Coming Soon" page in the Menu; Marketplace moved into the Menu shortcuts to make room for the Bubbles tab. | An honest map of surfaces | VP-08 | docs/BUBBLES.md §2; FEATURE_PARITY.md |
| Facebook stays Facebook: the tab bar, headers and sheets are Facebook's; only the Bubbles screens carry their own brand. | Fits Facebook's ideals | VP-08 | docs/BUBBLES.md §2 |
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
| The library today: 6 game types, 55 building blocks in 11 kinds, 8 looks, 6 fonts, 8 background motifs. The design calls for about 150 concepts in 14 kinds. | Real scope, honestly stated | VP-34 (D22) | Bubble.catalogJSON() at `0a3e8f7`; Concept library canvas |
| The whole catalog fits in Muse's long context, and each piece has a plain-language description written for Muse, so no search step is needed. | Uses Wonder's long context | VP-35 | Concept library canvas §2-3 |
| Pieces of the right size: whole templates repeat the same games, and raw physics makes Muse write everything; medium pieces let Muse spend effort on what's new. | Answer to "why not let AI write the code?" | VP-34 | Concept library canvas §1 |
| Glue Muse writes: a bonus point for skimming a peak (Hill Hopper: Twin Peaks), up to 60 bonus points for a quick pick (picnic icebreaker), fog banks rising and falling in a slow wave (Fog Drift). Design examples: how many days off a guess is, obstacles shaped like a skyline, points for answers nobody else in your Group gave, a course made from a photo. | Small, sandboxed, tested custom code | VP-34 | Seeds; docs/BUBBLES.md §4.2; Concept library canvas §6 |
| In the Trip Rewind design, Muse needed only one 10-line glue function. | How little custom code a game needs | VP-34 | Slack, Nov 11 20:24 |
| Muse picks one of 8 looks from the brief (paper for cozy, pixel for retro, neon for night, ink for whimsical, clay for cute, riso for zine, chalk for brainy, glow for dreamy) plus colors, font and background, and paints the cover in that look. With no hints, it used all 8 looks across 10 games (D6). | Creative work, not just logic | VP-37, VP-39 | docs/BUBBLES.md §4.10; MusePrompts.swift |
| Daily Bubble from opted-in posts: "Used 5 of 5 opted-in posts: Maya, Diego, Priya, Sam and Lena. Nothing else was read." The finished game lists the posts it drew on. | AI does work nobody could do by hand, privately | VP-01, VP-18, VP-21 (D8) | newinsf-daily timeline; MuseComposeSession.swift |
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
| First Hellos | New in SF Daily Bubble from five intros | 39.4 s (measured) | "Guess today's word from a newcomer's post." Words: AUSTIN, CHICAGO, TORONTO, BERLIN, BERNAL. Clay look. Used 5 of 5 opted-in posts; one repair | VP-01, VP-02, VP-18 (D10) | newinsf-daily-2026-11-13.json |
| Picnic Pals | Picnic icebreaker from seven attendees' posts | 33.0 s (measured) | "Read a fact and tap the picnic pal it belongs to." Wonder's reason: who-style guessing teaches names and facts. Paper look, 7 rounds, 7 of 7 opted-in posts | VP-03 (D10) | picnic-icebreaker.json |
| Send It | "a game for my new climbing gym friends about bouldering in SF", made in the app | First make not logged | Holds like Crimp Wall, Sloper and Dyno. Clay look | VP-05 | Slack, Nov 12 09:48 |
| Send It, restyle and tweak | "Make it a little slower"; clay to pixel | 15.8 s (measured, restyle) | Published with a cover | VP-23 (D26) | In-app run record send-it-wucr.json |
| Send It 2 | Level 2 | 28.4 s (measured) | Published with a cover. This is the "28 s" reported in Slack. The whole Send It sequence took about 2 minutes | VP-23 (D26) | In-app run record send-it-2-fvpy.json; Slack, Nov 12 09:48 |

Count: 17 logged Muse games (10 bench, 5 CLI samples, 2 in-app records), plus the unlogged first Hill Drift and first Send It. A new game took a median of 28.0 s in the bench (15.7 to 40.9 s, D2); the restyle took 15.8 s. None of these were in the app build at `0a3e8f7`, so import the ones we demo (First Hellos, Picnic Pals, Hill Drift, Send It). The CLI tool made the samples and never prints the key.

**Seed Bubbles in the app (13, hand-written by build agents, not Muse output).** All 13 validate and cover all 6 game types, each in its own look.

| Seed | Rule or hook | Proves | VP |
|---|---|---|---|
| Fog Words (New in SF Daily Bubble) | "Guess today's San Francisco word in six tries." Ink look, 15 SF words with clues (DOLORES: "The park where Saturday's newcomers' picnic is"). One run a day | The daily ritual | VP-02, VP-06 |
| Who's coming Saturday? (picnic icebreaker) | "Read a fact, pick the newcomer it belongs to. Quick picks score more." Paper look, 7 attendees, facts like "Has a cat named Biscuit" | Event icebreaker | VP-03 |
| This or That: Picnic | "Pick your side, then see who's with you." Rounds: sourdough and cheese or fruit salad; tacos, ice cream, open mic or nap | Finding your people | VP-03 |
| Fog or Sun? | "Guess what most of New in SF picked." Rounds from opted-in polls: Ocean Beach or Dolores Park, best way up a hill, burrito order, sunset spot | Read the Group | VP-01, VP-02 |
| Trivia Thursday: SF | "Pop the right answer before the bar runs out." Neon. Warms up Chloe's trivia team, which needs two more | A game that recruits people | VP-19 |
| Hill Hopper and Hill Hopper: Twin Peaks | "Tap to float over the hills. Don't touch the fog." Level 1 paper; level 2 neon at night with wind and a peak-skim bonus | Bubble Chains | VP-23 |
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
| **(K)** Makers keep updating their games: edits, a new look, level 2. Edits keep their history ("Earlier versions stay in its history. Plays and the Bubble Board carry over."). | Games evolve | VP-23 | Brainstorm canvas; StudioFloatStep.swift |
| Bubble Chains: each level is its own Bubble; Muse makes the next harder but fair (10 to 120 s for a typical player); levels unlock in order. Level 2 check: the test bot lasted 20 s, down from 25 s. | Progression | VP-23 | docs/BUBBLES.md §2; hill-run-level-2 timeline |
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
| The result sheet: the score counts up, a new best bursts bubbles, your rank with rows around you, a streak flame on Daily Bubbles, then play again, float, share to Story or next level. | A polished end to every game | VP-10, VP-13 | BubbleResultSheet.swift |
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
| **(K)** Like TikTok: every video looks different, but the frame never changes. | One look per Bubble, one Bubble frame | VP-37, VP-39 | Build tracker; docs/BUBBLES.md §2 |
| **(K)** Saves are the likes. | The right engagement signal for games | VP-10 | Slack, Nov 12 11:01 |
| **(K)** Spotify's Blend: two people's tastes merged into one shared thing, with a taste match. For us, a game. | Basis for Blends | VP-40 [125] | Karthik, Nov 12 |
| **(K)** "Drops": random moments that unite a lot of people, like the BeReal effect. Lives on as the Daily Bubble. | A shared daily moment | VP-06 | Brainstorm canvas; Problem canvas |
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
| A Connections-style puzzle made from a Group's recent posts and inside jokes. | What the Daily Bubble can be | VP-18 | Taxonomy canvas §8 |
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
| Every game gets 5 bot runs before it ships (weak, typical, strong, plus typical on two more seeds). A good Bubble lasts 10 to 120 s, can be lost and can score. At most 2 repair rounds. | A quality gate | VP-05, VP-18 (D5) | StudioPlaytest.swift; docs/BUBBLES.md §3 |
| 156 bot runs take about 1 s; posters render in 20 to 130 ms; a 90-second game simulates in about 8.5 ms in JavaScriptCore (D14). | Playtests are almost instant | VP-36 | Feed agent report (teammate-reported); kit tests |
| Skill shows in scores (bots): Sourdough Stack's weakest bot median about 880 against about 4,970 for the strongest; Sort the City cleared 7% against 100%. Median score rose with skill on 12 of 13 games (D16). | Games reward skill | VP-16 | Kit tests |
| Tests, rerun at `0a3e8f7`: the Node runner reports 318 passed, 0 failed, and the JavaScriptCore runner 308 passed, 0 failed; kit tests pass in both engines with 23 fingerprinted runs identical, and 11 of 11 manifests validate (D17). | Execution quality | VP-24 | tools/runtime-tests; tools/kits-tests |
| Bots playtest every game, make demo Bursts and generate realistic friend scores. Demo friend scores are bot-made (Maya plays at skill 0.9). | Honest about synthetic data | VP-16 (D25) | Build tracker; BubbleFeedRoster.swift |
| Bots can't measure fun: only real plays, finishes, saves and shares show that, and those feed the recommender. | Honest limits | VP-10 | Concept library canvas §10 |
| Recommender simulation: 5 synthetic worlds, 90 people each, 14 days, about 20% clickbait. Bait-averse people: 7.2 pages per session against 5.9 today, clickbait down from 36% to 14%. Bait lovers: 10.2 against 6.8, 80% hooky. Ranking on clicks alone leaves bait-averse people at 49% clickbait. | The feed doesn't fill with junk | VP-10 (D21, simulated, teammate-reported) | Slack, Nov 12 11:28 (Kevin's agent) |
| Simulated users on the real seed games, after 4 sessions: a bait lover's next 12 pages are 10 of 12 hooky, a bait-averse person's are 0 of 12 (Daily Bubble, icebreakers, Trivia Thursday, Group games). 42 of 42 recommender checks pass. | Personalization works on our content | VP-10 (simulated, teammate-reported) | Slack, Nov 12 11:37 |
| The recommender's reward counts takeovers, finished runs, replays, saves (weighted like likes), floats to a Group and Add friend; quick skips and quitting count against. New games are explored by Thompson sampling with priors from bot playtests; a calibration re-rank balances formula and mood; cold start leans on the manifest. `FB_RECS` switches stages. Kevin's branch, not in the app. The same taste model is what Blends would use. | Rewards connection, gives new games a fair shot | VP-10, VP-31, VP-40 | Slack, Nov 12 11:10 |
| A Reels-style feed that says why each page is there: a friend's run, a Group member's run, today's Daily Bubble, an Event icebreaker, new near you, a later level, yours, or popular. Never the same Bubble twice in a row. | An explainable feed | VP-10, VP-25 (D20) | BubbleFeedSource.swift; BubblesTabView.swift |
| No blank frames: pages not playing show an exact still from the game's own demo run and turn into the live game without a jump. | Polish | VP-39 | docs/BUBBLES.md §4.6, §4.8 |
| "Made with Muse in 41 s · Wonder, Ember, Image" and "Cover art by Muse" on a Bubble's page; offline games say "Made with Muse Studio". | Provenance shown to people | VP-35, VP-37 | BubbleStore+Screens.swift; BubbleGlow.swift |
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
| Built fast: about 21,000 lines of Swift and 12,000 of engine JavaScript, CSS and HTML for Bubbles (about 53,000 Swift lines in the whole app); Bubbles landed as 10 feature commits on Nov 12 (an earlier Slack post counted 11; recount before quoting). | Execution speed | VP-24 (D22) | git at `0a3e8f7` |
| About 10 AI coding agents built in parallel (6 Opus, 4 Sonnet), each owning its own files, coordinated through a shared spec and Slack canvases; everything merged with no conflicts. CLAUDE.md shows the process. | How a small team built this. A judgment call whether to mention it | VP-24 | Slack, Nov 12 07:37, 10:11; CLAUDE.md |
| Muse Studio runs on the command line (tools/bubble-studio) as the same Studio code; it made the 5 CLI samples and the 10-run benchmark. | Reproducible AI runs | VP-34 | tools/bubble-studio |
| Launch shortcuts (`FB_TAB`, `FB_OPEN`, `FB_SKIP_SPLASH`, `FB_STUDIO_*`) open any demo screen directly. | Reliable demo and recording | VP-24 | FacebookClone/App/DebugLaunch.swift |
| Screenshots of every stage in light and dark, plus four phone shots of a real in-app Muse run (reading the request, Send It in clay, making level 2, Send It in pixel). | Slides and fallback assets | VP-24 | Slack, Nov 12 10:02; in-app run captures |
| Copy voice: warm, short, specific, sentence case. Titles 1 to 3 words, rules one sentence of 70 characters or less, briefs start "I read this as". | A cohesive product voice | VP-37 | MusePrompts.swift |

### A.8 The reason to come back

| Example | What it proves | VP | Source |
|---|---|---|---|
| **(K)** A reason to clock in. | The goal of the whole feature | VP-06 | Slack, Nov 12 11:36 |
| Daily Bubble: one 30 to 90 s game per Group per day, the same for everyone, one run each with no instant retry, a streak for days in a row. | A daily ritual | VP-06, VP-02 | MusePrompts.swift; flow.daily_gate; BubbleStore+World.swift |
| For daily puzzles the cap is the point: you can't binge, so you come back tomorrow. The hooks are streaks and comparing with friends. | Healthy return, not compulsion | VP-06, VP-10 | Taxonomy canvas §3B |
| Short-round games in the feed plus one pinned daily game per Group. | Endless feed and daily ritual coexist | VP-06, VP-39 | Slack, Nov 11 20:13 (Bayan) |
| Tomorrow's Daily Bubble, streaks, friends beating your score, weekly Group leaderboards, game nights. | Many small pulls back | VP-06, VP-19 | Build tracker; posts agent report |
| Notifications: "Diego beat your score in Hill Hopper. Take it back?", "You passed Maya in Fog Words." | Social triggers | VP-04, VP-06 | BubbleNotificationsSurface.swift |
| Rivalries as friendship: "You and Maya: 12 games together". | A relationship that grows | VP-14 | Brand ideas |
| A Blend waiting from someone you met, and a bracket round due tonight. Not built. | A reason to come back that is a person | VP-40 | Karthik, Nov 12 |
| Rituals a name can own: "Today's ___" for the Group daily, a weekly Group cup, game nights. | Brandable habits | VP-06, VP-19 | Brand ideas |
| Challenges waiting: a friend's "Beat my 34" in the group chat with "your move". Not built. | A pending social obligation | VP-14, VP-15 | Feature spec |
| Bubble Chains: the next level unlocks after you finish this one. | Progression | VP-23 | BubbleChainView.swift |
| Makers update their games (edits, new looks, level 2), so there's always something new from friends. | Fresh content from people you know | VP-23, VP-25 | Brainstorm canvas; Slack, Nov 12 08:48 |
| A feed that learns what you like, and how much hooky content you want. | Personal return | VP-10 | Slack, Nov 12 11:10 |
| **(K)** "Drops" like BeReal: one shared moment for the whole Group. | The daily game as a drop | VP-06 | Brainstorm canvas |
| Problem canvas test: fails if useful once, then done. | The bar we clear | VP-06 | Problem canvas |

### A.9 Where it started: Karthik's original asks

| Example | What it proves | VP | Source |
|---|---|---|---|
| **(K)** Kickoff feature list: make games, infinite scroll, clips from games, games on Stories and profiles, leaderboards, editing, linked levels and a game library. Built as Muse Studio, the Bubbles feed, Bursts in Reels, Bubble Stories, profile Bubbles, Bubble Boards, edit, remix and next level, Bubble Chains and the Library. | Everything Karthik asked for exists | VP-05, VP-13, VP-23, VP-39 | Session, Nov 11 22:16 |
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
| **(K)** "Bubbles" works because it is unlike what the games are about. Themed names (Postcards, Charms, Rounds) felt too narrow; the name should feel like anyone can create and share for any purpose, as general as Muse or Bubbles. | How to judge the final name | VP-37 | Session, Nov 12 09:53 |
| **(K)** Bubbles is gender-neutral, clean, concise and flexible, but "blowing" has the wrong connotation, so no "blow" verb. Round 3 looks for a name like that, maybe playing off games as storytelling, that works in social sentences ("Send me a ___"). | A copy rule | VP-37 | Session, Nov 12 11:03; Brand ideas |
| **(K)** Brand color: Facebook blue to purple (#0866FF to #8A3FFC), pastel and blue-led, no pink, rose or coral; a little unique while blending with Facebook. | Visual identity | VP-08 | Session, Nov 12 09:40 to 11:03; Build tracker "Decisions" |
| **(K)** Original style request (Nov 11): pastel, bubbly and glowing, based on the Muse brand. Replaced on Nov 12 by a look per game in a shared frame; glow survives as one of the 8 looks. | How the look evolved | VP-37 | Session, Nov 11 22:16 and Nov 12 08:34 |
| **(K)** A consistent brand with names that work with Facebook. Vocabulary: a game is a Bubble; pop in (play); float (share to a Group); Daily Bubble; Icebreaker; Bubble Board (leaderboard); Burst (replay clip); Bubble Chain (linked levels); Library; Muse Studio; Remix; and now Blend. Names may change after round 3. | Consistent pitch wording | VP-08 | Session, Nov 11 22:16; docs/BUBBLES.md §2 |
