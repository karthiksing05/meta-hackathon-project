# The value propositions

*The detailed catalogue of every value proposition. Part of the pitch docs; start at [README.md](README.md).*

## At a glance

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

**Status at `6b1cc85`.** Status values are defined in [README.md](README.md#status-at-6b1cc85): **Live** (in the app through the normal UI; other people are synthetic), **Live on one device** (works, but the other side is a bot on the same seed and nothing crosses phones), **Debug/CLI only**, **Not built**, and **Planned**. The tables and entries were first written at `0a3e8f7`; status cells and "How Muse Curios delivers it" lines are updated to `6b1cc85`, while the evidence lines keep the numbers measured then. Key corrections: the Daily is still made from posts only through the CLI or a debug launch; Add friend on the board goes to a bot row; the collaboration features are Live on one device; the recommender and the Group Blend are in the app. VP IDs are kept from earlier drafts; VP-41 and VP-42 are new.

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
| VP-05 | Make a game for your people in about 30 seconds (ready formula) or a minute or two (from scratch) | You and your people | The game is made for a named Group, Event or friends, and lands in front of them | Measured | Literature | Live |
| VP-06 | A daily reason to clock in that is about your people | You and your Groups | One game per Group, and only Facebook has the Groups | Built | Public data | Live |
| VP-07 | Meet strangers on an everyday-name network | You and a stranger | Everyday-name norm, opt-in Verified, shared Groups | Built (rows); None (badges) | Hypothesis | Live (rows); Not built (badges) |
| VP-08 | Everything a newcomer needs, in one app | You and your city | Groups, Events, Marketplace and Dating already live here | Built | Hypothesis | Live |
| VP-09 | A new way to tell your own story | You and your friends | "Who knows you best" needs real friends | Built (profile tab) | Literature | Live (profile, Games about me on one device) |
| VP-10 | Play that ends, ranked for connection | You and your people | Facebook can rank on connection outcomes it can observe | Built; simulated (D27 to D29) | Hypothesis | Live (recommender in the app on `main`) |
| VP-13 | A friend's replay is an invitation | You and a friend | Bursts land in the feed, Stories and Reels where friends look | Bot-run | Public data | Live |
| VP-17 | Remix as a reply to a person | You and a friend | Remixes travel between people who know each other | Built | Hypothesis | Live (lineage and send it back, one device) |
| VP-39 | A playable feed as varied as Reels | You and your feed | Facebook's feed and Reels habit, filled by members | Measured (variety); teammate-reported (speed) | Hypothesis | Live |

### Supporting: for Group hosts and creators

| ID | Value proposition | Relationship | Why only Facebook | Mechanism | Helps people | Status |
|---|---|---|---|---|---|---|
| VP-18 | A fresh daily ritual admins don't have to write | Your Group | Tens of millions of Groups, each with its own members and posts | Measured (real Muse) | Hypothesis | Debug/CLI only |
| VP-21 | You decide which of your posts can become a game | You and your Group | Facebook's per-post audience controls | Built | Hypothesis | Live, with named gaps |
| VP-23 | Credit and an audience you already know | You and your people | Profiles, notifications and a creator program that rewards originals | Built | Hypothesis | Live (profile, lineage, remix credits) |

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
| VP-34 | The AI does the core work: any described idea becomes a game, agreed with the maker | Makers, judges (AI Integration), Meta's AI org | Muse's value comes from Facebook context | Measured (harness eval, D30; template baseline, D7) | Hypothesis | Live |
| VP-35 | A showcase for the whole Muse family | Meta Superintelligence Labs | First-party models on a first-party surface | Measured | Public data (strategic fit) | Live |
| VP-36 | Cheap and predictable to run per Group per day | Meta infrastructure and finance | First-party models with no third-party margin | Measured (calls, output tokens) | Hypothesis | Live (cost not priced) |
| VP-37 | AI content made by and about real people | Feed and Reels, Meta's content strategy | Every Curio carries a real maker and a social context | Measured (variety) | Hypothesis | Live |
| VP-42 | Agree the game with Muse, and see what's new to it | The maker and Muse | (AI value, not Facebook-specific) | Measured (speed, calibration; D33) | Hypothesis | Live |

### Collaboration (formerly "Roadmap"; most now in the app)

| ID | Value proposition | Relationship | Why only Facebook | Mechanism | Helps people | Status |
|---|---|---|---|---|---|---|
| VP-14 | Stay close to hometown friends after you move | You and a friend | Facebook holds both the old friends and the new Groups | Public data (format); same-seed primitive bot-run | Literature | Live on one device (friends are synthetic) |
| VP-15 | One card the whole group chat plays | You and your friends | Messenger chats next to Groups and Events | Public data (format) | Public data | Live on one device |
| VP-19 | Weekly boards and game night that reward newcomers | You and your Group | Needs Groups and Events together | Built | Literature | Live (synthetic members) |
| VP-38 | Make a game together, for and with your people | You, your friends and your Group | The friend graph and Group membership decide who co-makes; credits go to real profiles | Built | Literature | Live on one device |
| VP-40 | Blends: a game made from two people, and a bracket for everyone you just met | You and someone you just met; everyone at an Event | Friendships and Event guest lists scope who you blend with | Built (Group Blend); simulated (D29) | Literature | Partly Live: the Group Blend is in the app; two-person Blends and brackets Not built |
| VP-11 | Find your scene through what you want to play | You and a new Group | A game in Search links to the Group that plays it | Built | Hypothesis | Live |
| VP-12 | Learn together, with friends' streaks | You and your friends | Group mastery needs a Group; friends' streaks need friends | Built (learn formula) | Public data | Live (synthetic friends' streaks) |
| VP-41 | Seed the feed: Meta studio accounts and creator-inspired games | Everyone, together; a creator's audience | Groups to play in, a feed to post to, a creator program [27] | None | Hypothesis | Not built (planned, Nov 12 18:00) |

## Each value proposition in detail

Every entry uses the same eight fields. Our own data IDs (D1 to D26) are explained in section 8.

### 6.1 Core: the pitch

#### VP-02. A first move in a Group that isn't a post

- **Claim.** A newcomer, or a member who has never posted, can take part on day one by playing the Group's Daily Curio. They land on the Group board next to members' names without writing an intro.
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
- **How Muse Curios delivers it.**
  - Live: a Daily card pinned on the Group page, with today's top 3, your rank, a Group streak and copy inviting you to be first on the board; a Daily Curios strip on the Groups tab; a Daily-ready notification; float your result to the Group.
  - The Daily shown in the app today is a hand-made seed game. Generating it from members' posts is Debug/CLI only (VP-18).
  - Live: the "Most improved" award on the weekly Group board (VP-19).
- **Demo.** Narrate the persona: Alex joined New in SF two weeks ago and hasn't posted. They play the Daily, see three members' names around theirs, and share "I got 42. Beat it?" to the Group with one tap.
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
- **How Muse Curios delivers it.**
  - Live: an Event section, "Who's coming? Learn a few names before you go", with avatars of who is going and who has played; "Make an icebreaker" for guests marked Going; a This or That picnic game.
  - Live: quiz night as a Group game night (VP-19). Not built: a post-event rematch tied to the Event.
- **Demo.** Open the picnic Event, play the who-is-it round in about 15 s, then tap a guest's name on the board to open their profile.
- **Metric.** Icebreaker plays per Going guest before the Event; Add friend requests between attendees within 7 days; a post-event survey item, "I knew someone's name when I arrived".
- **Risk and answer.** "The trust study was small, online and about teamwork; a quiz about guests might feel like surveillance." We cite the study as direction, not proof, and section 11 proposes a hallway test. Content comes only from posts guests opted in, and Studio shows exactly which posts it used.

#### VP-04. A leaderboard that works as an introduction

- **Claim.** Every board row for someone you don't know yet has their name, a profile link, Watch Burst and Add friend, so playing the same game becomes a reason to connect.
- **Why Facebook.** For a newcomer, the board's value comes from shared context, not the friend graph: rows appear for people in a Group or Event you both chose to join, under everyday names [30]. Other networks handle this differently:
  - LinkedIn's game leaderboards group players by their connections and company [81].
  - Discord and Reddit are pseudonymous.
  - On Roblox, unfiltered chat between teens and adults requires a verified real-world connection [97].
- **Rationale.**
  - People underestimate how much others appreciate being contacted (more than 5,900 participants) [69]. A shared score is a concrete, low-risk reason to send a request.
  - Close friendships mostly start in shared, repeated settings: 54% of Americans with close friends met one at work, and only 8% made a close friend online [64]. A Group board is a shared, repeated setting.
  - For adults who had just moved, playing video games together went with closeness [66].
  - Facebook use is most strongly tied to "bridging" social capital, the weak ties that bring new information and people [71].
  - Rivals still form ties when they affect each other, and toxicity undoes them [72]. See "Why friendly competition makes friends" for the evidence and our guardrails.
- **Evidence.**
  - Context, not evidence for this mechanism: in ESA's 2025 survey (YouGov, n=5,000 US adults), 70% of Gen Z players and 61% of Millennial players said they have met people through games they otherwise wouldn't have [76] (industry survey; about online games generally, not leaderboards).
  - Context: 61% of US adults say close friends are extremely or very important for a fulfilling life, more than marriage (23%) or money (24%) [57].
  - Built: board rows show Add friend with Requested and Confirm states. In the demo, rows are bot runs by synthetic people.
- **How Muse Curios delivers it.**
  - Live: board with Group, Friends and Everyone scopes; Add friend on non-friend rows; verified-run badge; Watch Burst; notifications when someone beats your score or you pass someone.
  - Live: Kevin's recommender, in the app on `main`, counts Add friend in its reward (D27).
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
- **How Muse Curios delivers it.**
  - Live: the Event icebreaker; "Make a Curio for this group" in Studio with opted-in sources (the card used to say "Blow a bubble for this group"); the guess formula's who-is-it portrait rounds; the answer formula scored against what the Group picked.
  - Debug/CLI only: generating a Group's Daily from opted-in posts works on real Muse through the command-line tool and through Studio's daily mode, which only a debug launch reaches. The Daily shown in the app today is a hand-made seed game. We recommend wiring Daily generation into the normal Group UI before demo day, because it is the core thesis.
  - Live (one device): Games about me.
- **Demo.** In the New in SF Group, tap "Make a Curio for this group", show the source list and the "Nothing else was read" line, generate, and play a round that asks which newcomer said what.
- **Metric.** Share of plays on games built from Group or Event context against generic games; completion and Add friend rate per play for each type.
- **Risk and answer.**
  - "Any app can ask people to type in names and facts." Asking people to re-enter their community is the cold-start problem. Facebook already has the community, the consent surface (per-post settings) and the identity, and the people in the game are one tap from Add friend.
  - "Any frontier model given the same posts would make an on-topic game." True. The moat is the posts and the surfaces, not the model. We have not yet measured what the context adds; section 11 proposes the test.

#### VP-16. Fair competition between people who just met

- **Claim.** Every run is a seed plus an input log that can be re-simulated, so scores on Group boards and in challenges are checkable, and head-to-heads are on identical games.
- **Why Facebook.** Verification itself is not Facebook-specific. Pairing verified scores with everyday-name people, some with opt-in Facebook Verified badges [21], gives a "real person, real score" board that pseudonymous networks lack.
- **Rationale.** Competition only brings people closer if it feels fair. Toxicity is a strong negative predictor of friendships formed in games [72], and cheating is a form of toxicity. A fair, shared game is also what makes a comparison mean anything (see "Why friendly competition makes friends"). One engineering choice powers same-seed challenges, verified badges, Bursts and bot playtests.
- **Evidence.**
  - 390 of 390 bot runs (13 games, 3 skill levels, 10 seeds) re-simulated to the identical score (D12).
  - Verifying a run costs about 4.06 ms of CPU in Node (D14).
  - Median score rose with bot skill on 12 of 13 games, so boards reward skill (D16).
  - All bot-run.
- **How Muse Curios delivers it.**
  - Live: verification in the runtime; verified badges on board rows; the same seed for everyone in a Group's Daily.
  - Live (in the app since the collaboration batch; one device, with synthetic friends): same-seed Challenge Me; length as a shared primitive, so a challenge fixes a fair mode for everyone (for example 10 rounds, 3 lives or 60 seconds).
  - Not built: server-side replay verification. The Go backend on Prod keeps best scores per user, but does not re-simulate runs.
- **Demo.** Tap a verified row's Watch Burst: "every score here is a 600-byte log we can replay".
- **Metric.** Share of board runs verified; disputed scores per 10,000 runs; rematch rate after a verified loss.
- **Risk and answer.** "Verification proves the inputs produce the score, not that a human entered them." Correct, and we say so. It stops forged scores. Bot-input detection is a later server-side layer, and small, scoped boards lower the payoff for cheating.

### 6.2 Supporting: for people and friends

#### VP-05. Make a game for your people in about 30 seconds

*At `6b1cc85`: "about 30 seconds" holds for a ready-formula game (median 28.0 s, D2). A game made from scratch on the microgame engine takes a median 99 s (D30). The in-app copy "about a minute" matches neither (see [open-items.md](open-items.md#proposed-app-fixes)).*

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
- **How Muse Curios delivers it.**
  - Live: Muse Studio from the Curios tab, Groups, Events and profiles; edit, new look and next level; 6 formulas and 8 looks; remix lineage; an offline fallback so a game always comes out.
  - Not built: playing the game as soon as it passes its checks, with the cover fading in later (section 11); "Make it with Muse" from Search is now live.
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
- **How Muse Curios delivers it.**
  - Live: a daily gate (one scored run a day, same seed for the whole Group); Group and personal streaks; a Daily-ready notification; the Curios tab opens with your Group's Daily near the top.
  - Live: a weekly Group leaderboard (VP-19).
- **Demo.** Open the Groups tab, show the Daily strip across your Groups, play today's game in about 20 s, and show your rank and the Group streak.
- **Metric.** Next-day and 7-day return among Daily players (all players who played on a given day, with the base stated); days per week a member opens at least one of their Groups, against control Groups.
- **Risk and answer.** "No user data; another daily notification is exactly what people mute." True; it is a hypothesis for a pilot. We send one notification per day, only for Groups you're in. Facebook's own 2010 notification limits are the lesson [39].

#### VP-07. Meet strangers on an everyday-name network, not a pseudonymous one

- **Claim.** Because players use everyday names and share a Group or Event, moving from a game to a friend request feels safer than on handle-based platforms.
- **Why Facebook.** Facebook's everyday-name norm [30], plus opt-in Facebook Verified, which checks a video selfie against existing profile photos to confirm "there is a real person on the other side of a profile" [21]. Rivals are adding identity after the fact: Discord moved to teen-default settings with face or ID checks in 2026 [99], and X said Communities were "used by less than 0.4% of users" yet "contributed to 80% of spam reports, financial scams, and malware" [100].
- **Rationale.** Muse Curios asks people to add, and later meet, strangers. The trust layer matters as much as the game. Research on friendships formed in games found toxicity a strong negative predictor of in-game social capital [72].
- **Evidence.**
  - Facebook asks for "the name that your friends call you in everyday life" [30].
  - Meta estimated that "less than 3% of our worldwide DAP consisted solely of violating accounts" in Q4 2024 (family-wide) [12].
  - Verified badges launched on Profiles and Groups in July 2026 [21].
- **How Muse Curios delivers it.**
  - Live: profile links and Add friend on rows; a verified-run badge.
  - Not built: showing Facebook Verified badges on board rows and icebreakers.
- **Demo.** On a board row, show the profile with the shared Group before tapping Add friend.
- **Metric.** Acceptance rate of board-originated friend requests; block and report rate per 1,000 such requests, against other suggestion sources.
- **Risk and answer.** "An everyday-name norm doesn't make every account real." Agreed; we claim the strongest identity baseline among major social networks, not perfection. Verified badges, Group scoping and requests rather than open messages add layers, and the metric would show whether board contact is safe.

#### VP-08. Everything a newcomer needs, already in one app

- **Claim.** Muse Curios ties the surfaces a newcomer already uses on Facebook (Groups, Events, Marketplace, Dating) to a shared activity, with no new app or network.
- **Why Facebook.**
  - Meta says young adults arrive at life moments, "moving, going to college, getting their first job or apartment" [13].
  - One in three young adults on Facebook in the US uses Marketplace daily (2026) [22]. An earlier figure, on a different base, was one in four young-adult daily users in the US and Canada (2025) [23].
  - Meta tested a Local tab pulling together Marketplace, Groups and Events in 10 US cities, including San Francisco [14].
  - The standalone Gaming app closed in 2022, with its features moved into Facebook [37]. Meta's first Groups app closed in 2017, and its 2026 Groups app, Forum, syncs with Facebook Groups [25][49].
- **Rationale.** The newcomer's to-do list (furnish, find work, find people, find things to do) already lives on Facebook. What is missing is the step that turns finding a Group or Event into taking part.
- **Evidence.** Muse Curios runs on 6 distribution surfaces and 3 entry points today (D19). Young-adult matches on Facebook Dating were up 10% a year in 2025 [51].
- **How Muse Curios delivers it.**
  - Live: Muse Curios in Groups, Events, the Home feed, Stories, Reels and Video, Notifications, profiles, the Library in the Menu and the Curios tab.
  - Live (in the app since the collaboration batch; one device, with synthetic friends): Search and Messenger chats.
- **Demo.** The newcomer path in 60 seconds: join New in SF, play the Daily, RSVP to the picnic, play the icebreaker and add a friend from the board.
- **Metric.** Share of Muse Curios players who also RSVP to an Event or join a second Group within 14 days.
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
- **How Muse Curios delivers it.**
  - Live: a profile Curios tab with games you made, best scores and chains; "Make a Curio" on your own profile.
  - Live (in the app since the collaboration batch; one device, with synthetic friends): Games about me with "who knows you best"; choose-your-own-adventure stories (Adventures) with friends' endings ("Maya took the ferry") and stories made from your own life.
- **Demo.** Open a profile's Curios tab: games made, best scores and a three-level chain. If it has shipped, show "How well do you know me?" with its ranked friends.
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
- **How Muse Curios delivers it.**
  - Live: a daily gate; a relationship-weighted feed with a reason tag on each page; a result sheet that offers "challenge a friend" and "see the Group board".
  - Live: the recommender (`game-recs.js` 0.5, in the app on `main`; D27 to D29); saves as the main appreciation signal on every surface; endless and finite modes.
- **Demo.** After a Daily run, show that the result sheet ends in a person (challenge, board, Add friend), not another autoplay. Read the reason tags on the first five feed pages aloud.
- **Metric.** Share of sessions that end in a social action (friend request, float, challenge, RSVP); friend adds and Group floats per 100 pages; saves per play; session length distribution, aiming for short, social sessions.
- **Risk and answer.**
  - "The Curios tab is still an endless vertical feed." A fair tension that our own design review raised. The feed opens with your Group's Daily and friends' runs and ranks by relationships; we would measure social outcomes, not minutes.
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
  - Muse Curios runs on 6 distribution surfaces plus 3 entry points (D19).
  - Facebook Reels time spent reached all-time highs in Q3 2026 [5].
- **How Muse Curios delivers it.**
  - Live: Bursts in the Curios tab, feed posts, Stories, Reels and the Video tab; takeover plays the same seed; share to Story from the result sheet; float to feed or Group.
  - Live (in the app since the collaboration batch; one device, with synthetic friends): Messenger chats and Search.
- **Demo.** In Reels, a friend's Burst plays. Tap to take over, play the same seed, finish and share your result to your Story. Two surfaces, no installs.
- **Metric.** Takeover rate on friends' Bursts against strangers'; Burst view to takeover to finished run; new players per shared result.
- **Risk and answer.** "Feeds full of game replays could feel like Canvas-era game spam." Bursts come from friends and Groups, not mass requests, and the feed ranks relationships first (D20). "Distribution" is also unproven in a single-user prototype: nobody but the maker has seen a share yet.

#### VP-17. Remix as a reply to a person

- **Claim.** Remixing a friend's game credits and notifies them, and "send it back" returns the new version to its maker, so making becomes a conversation.
- **Why Facebook.** Remix trees on TikTok connect strangers by interest. On Facebook, a remix travels between people who know each other, through notifications, Messenger and profiles.
- **Rationale.** A remix sent back is targeted interaction with someone you know, the kind linked to well-being [70]. Zuckerberg describes AI making it "easier to create and remix content" [9].
- **Evidence.** Facebook's research links composed, targeted interaction with close ties to well-being [70]. Private sharing on Facebook was growing at over 80% a year in 2024 [13].
- **How Muse Curios delivers it.**
  - Live: remix in Studio, with lineage recorded in the manifest; a "remixed your Curio" notification.
  - Live (in the app since the collaboration batch; one device, with synthetic friends): remix credits and send it back as a playable card. Not built: remix trees.
- **Demo.** Remix a friend's hill game into a night version, then show the notification the original maker receives.
- **Metric.** Share of remixes sent back; maker replies or counter-remixes within 48 hours.
- **Risk and answer.** "Most people won't remix." True, so this is a supporting value; each remix still pulls a second person back in.

#### VP-39. A playable feed as varied as Reels

- **Claim.** The Curios tab is a vertical feed of playable games that switches games in milliseconds, with games that vary in formula, look and content, so scrolling games feels as fresh as scrolling Reels.
- **Why Facebook.** Facebook already has the vertical-video habit and Reels at all-time highs in time spent (Q3 2026) [5]. Muse Curios fills that habit with games made by members for their own Groups, not studio catalogs.
- **Rationale.** People come back to feeds for variety. Zuckerberg predicted "content in our feeds that you can interact with and it'll interact back" [8].
- **Evidence.**
  - Muse used all 6 formulas and all 8 looks across 10 prompts with no hints (D6, measured).
  - Warm switch to the next game: about 3.6 ms at the median on the simulator (D18, teammate-reported, not yet on a phone).
- **How Muse Curios delivers it.**
  - Live: the Curios tab feed with a warm runtime, 8 looks with look memory, Bursts and takeover.
  - Live: length settings (endless, rounds, timed, lives) and customizing in Studio.
- **Demo.** Swipe through four Curios with different looks and formulas, each tagged with why it is in your feed.
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
- **How Muse Curios delivers it.**
  - Live: a Daily per Group (a hand-made seed game in the app today), sources limited to opted-in posts with the maker able to drop any, the Daily card and streak, 6 formulas and 8 looks with look memory so consecutive games vary.
  - Debug/CLI only: generating the Daily from posts (command line and Studio's daily mode).
  - Not built: admin opt-in with preview and veto. Live: a Games tab, weekly leaderboard and quiz night (VP-19).
- **Supply model.** An admin turns on "Daily" once. Muse then generates each day's game from opted-in posts, and the admin gets a preview and can veto it. Members' own creations are a bonus, not the supply. We expect admin opt-in to be the limiting step; it is a hypothesis with a metric below.
- **Demo.** Show Studio in daily mode: "Used 5 of 5 opted-in posts ... Nothing else was read", then the Daily pinned on the Group. Say plainly that this path is a debug launch today.
- **Metric.** Admin opt-in rate and 4-week retention of the feature; weekly active members per Group before and after the Daily; new members' first-week participation; Daily completion over weeks 1 to 8 against a fixed puzzle.
- **Risk and answer.** "Admins don't want AI posting into their community, and a bad game reflects on them." The Daily is an admin opt-in with preview and veto (not built). Every game is validated and bot-playtested first: 9 of 10 first drafts passed, and the tenth was repaired automatically (D5). Fun for people is still unmeasured. A moderation step is a named gap we would close before launch.

#### VP-21. You decide which of your posts can become a game

- **Claim.** Muse reads only posts their authors marked for Muse Curios, and every game shows which posts it used and that nothing else was read.
- **Why Facebook.** Facebook's per-post audience controls are the natural home for a "use in Muse Curios" opt-in. Meta's standard for games is social play while "limiting data sharing outside of Meta" [32]; a first-party feature meets that by design.
- **Rationale.** Games made from people's intros are only welcome if people agreed. Visible provenance makes consent checkable.
- **Evidence.**
  - Built: posts carry an `allowsBubbles` flag; Studio lists only opted-in posts; the timeline reads "Used 7 of 7 opted-in posts ... Nothing else was read" (D8).
  - Muse is instructed to use only the first names it is given, never to invent facts or vote counts, and to keep content kind.
  - Game glue code runs sandboxed, with no network, page access, timers or eval.
- **How Muse Curios delivers it.**
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
- **How Muse Curios delivers it.**
  - Live: a profile Curios tab, Chains (level series), next level, remix lineage and a "remixed your Curio" notification.
  - Live: remix credits and send it back (one device). Not built: remix trees. A path to creator payouts is an idea, not a plan.
- **Demo.** Open a maker's profile: their games, a three-level chain and a friend's remix with lineage.
- **Metric.** Makers with 2 or more games in 30 days; remixes per game; profile visits from game credits.
- **Risk and answer.** "If Muse does the work, is the maker creating anything?" The maker chooses the idea, the audience, the sources, edits, look and levels. Whether makers feel ownership is untested.

### 6.4 Value to Meta

#### VP-24. A working version of a product Meta's CEO has described

- **Claim.** Muse Curios is a working, mobile, friends-first 2D build of the loop Zuckerberg described: make a game from a prompt, share it with people you care about, and play it from your feed.
- **Why Facebook.** The statement is Meta's, the models are Meta's and the surfaces are Facebook's. On the Q4 2025 call (2026-01-28), he said: "you can imagine people being able to, easily through a prompt, create a world or create a game and be able to share that with people who they care about and you see it in your feed and you can jump right into it". He added: "Our feeds will become more interactive overall" [1].
- **Rationale.** A product lead funds work that de-risks a stated company bet.
  - Meta's Muse Spark launch advertises "custom websites and mini-games straight from a prompt" that you can "share ... with friends" [2].
  - The same launch says Muse will reach people "in places like search bars, group chats, posts, and more", and offers answers "grounded in what your group is discussing" [2]. Muse Curios in Search and in group chats (being built) are exactly those placements.
  - On the Q1 2026 call, Zuckerberg listed "creating games" among Spark's leading areas [3]. On the Q3 2026 call, he said Muse should not be "a kind of single player game" but should let "your Muses ... work with your friends and your families" [5].
- **Evidence.** The quotes above [1][2][3][5]. Our benchmark shows the loop working end to end with real Muse latency (D1, D2).
- **How Muse Curios delivers it.**
  - Live: Studio; the Curios tab feed; sharing; Bursts in Reels and Stories you can take over; Make it together on one device (VP-38).
- **Demo.** Open with the quote on screen, then do it: prompt, wait about 28 s, float to the Group, then play a friend's Burst from the feed.
- **Metric.** Steps of the quote demonstrated live: prompt, share, see in feed, jump in (all four today). In a pilot, share of created games shared to a person or Group within 24 hours.
- **Risk and answer.** "If Meta already plans this, a hackathon team adds nothing." Meta's shipped versions (Pocket, Horizon Create) are standalone or creator-to-audience. Muse Curios shows the community version and answers the hard parts: consent from Group posts, fair same-seed competition, a per-Group daily and a playtest gate.

#### VP-25. Bringing friends back into Facebook time

- **Claim.** Muse Curios makes friend-to-friend interaction the content: beat my score, rematch, remix, play my Burst.
- **Why Facebook.** Meta has publicly committed to this. On the Q4 2024 call: "I'm excited this year to get back to some OG Facebook" [7]. In March 2025: "the magic of friends has fallen away" and "Social media should feel social", with a promise of "more fun, simple experiences to help you connect" [20].
- **Rationale.**
  - Zuckerberg testified in 2025 that "The friend part has gone down quite a bit" [46].
  - A slide in Meta's opening presentation at the FTC trial showed friends' content falling from 22% (2023) to 17% (2025) of Facebook time, as reported by The Keyword [47] (medium confidence; not for slides).
  - Facebook needs formats that need a friend to finish. Games are entertainment that is better with friends: Roblox reports co-play sessions are typically 1.9 times longer than solo sessions [93].
  - Muse Curios uses AI to bring you to people, not to replace them.
- **Evidence.**
  - Meta's own statements [7][20][46], the trial slide [47] and Roblox's co-play figure [93].
  - Shipped feed weights rank your Group's Daily (3.0), a friend's Burst (2.2) and an Event icebreaker (2.0) above popular games (0.8) (D20).
- **How Muse Curios delivers it.**
  - Live: friends' Bursts in the feed and Stories; the Friends board scope; each feed page tagged with its social reason.
  - Live (in the app since the collaboration batch; one device, with synthetic friends): Challenge Me, rivalries on profiles ("You vs Maya: 3-2 this week"), send it back.
- **Demo.** Open the Curios tab: the first page is a friend's run, tagged with why it is there. Take over, beat it, and float "Beat it?" to the Group.
- **Metric.** Share of Curio sessions where the maker, the Group or a board neighbor is a friend or Group member; friend-to-friend interactions per session.
- **Risk and answer.** "Friend content declined because people prefer entertainment." We are not asking people to choose friends over fun; games are fun that needs friends.

#### VP-26. Fits Meta's young-adult priority

- **Claim.** Young adults already have Facebook accounts but not a daily habit. Muse Curios targets the gap Meta discloses as a long-term focus and a competitive risk.
- **Why Facebook.**
  - Reach already exists: 69% of US 18-to-29-year-olds use Facebook [52].
  - Meta's FY2024 10-K says it has "announced plans to focus product decisions on optimizing the young adult experience in the long term". It also says: "We believe that some users, particularly younger users, are aware of and actively engaging with other products and services similar to, or as a substitute for, our products and services" [12]. We could not check whether the FY2025 10-K keeps both sentences.
  - Its Head of Facebook says "Generative AI creates even more opportunities for social discovery on Facebook" [13].
- **Rationale.** Facebook's daily use peaks among adults aged 30 to 64 (58% of 30-to-49-year-olds) [53]; the job is giving young adults a reason to open it daily.
- **Evidence.**
  - More than 40 million US and Canada young-adult daily users in May 2024, "the highest in three years" (latest public figure) [13].
  - In October 2024, Meta still reported "positive trends with young adults, especially in the US" [10].
  - 49% of all US 18-to-29-year-olds use Facebook daily [53].
- **How Muse Curios delivers it.**
  - Live: the New in SF Group and picnic Event demo world; the Daily and boards.
  - Live (in the app since the collaboration batch; one device, with synthetic friends): Challenge Me.
- **Demo.** Frame the 5 minutes as one newcomer's week: on Monday they join the Group and play the Daily, on Thursday they play the icebreaker, on Saturday they go to the picnic, and on Sunday they have a rematch with a new friend.
- **Metric.** Daily return of 18-to-29-year-old Muse Curios users against matched non-users; share of 18-to-29 Group joins followed by a Curio play.
- **Risk and answer.** "Teen use of Facebook has collapsed (32% in 2024, down from 71% in 2014-15 [54])." Muse Curios is designed for adults (Meta limits Muse to 18 and over [6]), and young adults are the stated target.

#### VP-28. The social layer Meta's AI-game products lack

- **Claim.** Meta has prompt-to-game generators but no place where those games bring a Group, an Event or a chat together. Muse Curios is that layer and could host games from any Meta generator.
- **Why Facebook.**
  - Pocket, Meta's standalone app for prompt-made "gizmos", rolled out across the US in August 2026 [43]. Per Business Insider (as reported by Digital Trends), Pocket runs on Muse Spark, has no direct messages, and Meta has no plans to integrate it with its other apps [44] (secondary source).
  - Horizon Create and Horizon Studio games run in Facebook and Instagram feeds for creators [42]; the announcement does not mention Groups, Events or Messenger.
- **Rationale.** AI media with no social anchor draws backlash (Vibes [45]). Positioning Muse Curios as the complement turns the likely objection "isn't this Pocket?" into a strength.
- **Evidence.** Pocket's US launch [43], its reported limits [44], Horizon's creator focus [42] and the Vibes reception [45].
- **How Muse Curios delivers it.**
  - Live: Group Daily, Event icebreaker, boards, remix lineage.
  - Live (in the app since the collaboration batch; one device, with synthetic friends): Challenge Me, group-chat play, games in Groups and Search; the Group Blend.
- **Demo.** One Q&A slide: Pocket makes games for a feed; Horizon gives creators a tool; Muse Curios is where your Group, your Event and your chat play together.
- **Metric.** Share of Curio plays that happen inside a Group, Event or chat.
- **Risk and answer.** "Meta could add Groups to Pocket in a sprint." That would validate the thesis. It would still need what we built: opt-in sourcing, same-seed fair boards, per-Group dailies and icebreakers.

#### VP-29. Facebook's games history, without its old mistakes

- **Claim.** Facebook proved social games spread through its graph and learned what goes wrong. Muse Curios keeps the reach and drops request spam, studio dependence and separate apps.
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
- **How Muse Curios delivers it.**
  - Design rules: scoped invites only (one friend, a Group board, a chat card); no mass requests; no cash or token rewards; inside core surfaces.
  - Live: saves as the quality signal.
- **Demo.** Q&A only: "FarmVille showed the graph spreads games; we keep that and drop the spam."
- **Metric.** Invite acceptance rate; mute or unsubscribe rate on Curio notifications.
- **Risk and answer.** "Games failed on Facebook twice." Earlier tries were catalogs bolted on. Muse Curios is made by members, about the Group, inside Groups and Events.

#### VP-31. Further upside for Meta: generations, ranking signals and revenue

*Now includes former VP-32 (ranking signals) and VP-33 (revenue paths). These are hypotheses for Q&A, not part of the pitch.*

- **Claim.** Beyond young adults, Muse Curios offers three kinds of upside. A Group's game can include long-time locals and travel across languages. Structured manifests give ranking cold-start signals. Sponsored Muse Curios are a possible future ad format.
- **Why Facebook.**
  - Facebook reaches 69% of 18-to-29-year-olds, 78% of 30-to-49, 71% of 50-to-64 and 59% of 65 and over. Instagram reaches 41% of 50-to-64 and 21% of 65 and over [52].
  - About 90% of Facebook's daily users were outside the US and Canada at the last regional breakdown (our arithmetic: 1,905 million of 2,110 million, December 2023) [11].
  - Meta says generative retrieval surfaces new posts "before they've accumulated significant engagement", and that moving content understanding to Muse cut per-unit processing costs by more than 80% [5].
  - Nearly 10 million advertisers used at least one of Meta's AI creative tools in Q3 2026 [5].
- **Rationale.**
  - Long-time locals are a newcomer's best guides to a city. 49% of adult players say games helped them stay connected to friends and family [76].
  - Bot playtest results (score spread, run length) act as quality priors for new Curios.
  - A product lead will ask how this makes money. The honest answer is indirect (engagement on existing ad-supported surfaces), with a speculative direct path. We found no Meta playable-ad roadmap.
- **Evidence.** The reach and ranking figures above [52][11][5]; the ESA survey [76]; manifests and playtest outputs are shipped. Nothing ad-related is built.
- **How Muse Curios delivers it.**
  - Live: Group Daily and looks that need little text; manifests, lineage and bot playtests.
  - Live: a recommender with bot-playtest priors for new games (unvalidated, D29a). Not built: sponsored Muse Curios.
- **Demo.** Not a demo moment. Use one line each in Q&A.
- **Metric.** Age spread of players per Group board; completion of brand-new Curios with and without playtest priors; sponsored-Curio completion in a test.
- **Risk and answer.**
  - "The demo is US-only and English." Agreed; this is headroom, not a tested claim.
  - "Ads in games about your friends feel invasive." We would keep sponsorship opt-in for Groups and Events, never in personal games, and use game data for content ranking only, never ads.

### 6.5 Muse and the AI ecosystem

#### VP-34. The AI does the core work: without Muse there is no game about your people

*At `6b1cc85` the strongest evidence for this VP is the microgame harness and the game anatomy, written up in [04-why-ai.md](04-why-ai.md) and VP-42 below: on 12 eval requests, 12 games passed the gate with 88% of must-haves present (D30, Muse-judged). The entry below covers the formula path, measured at `0a3e8f7`. Its line "Muse's added value is content, context and look" is true for formula games only; on the microgame path Muse writes the mechanics too (D31).*

- **Claim.** Muse does the core work: Ember writes the brief; Wonder composes the game with tool calls, writes its content and repairs failed drafts; bots tune difficulty; and Muse Image paints the cover. Without an LLM, the same prompts give valid but mostly off-topic games.
- **Why Facebook.** The AI's value comes from Facebook context (posts, RSVPs, Group identity).
  - Any frontier model given the same posts would also make on-topic games, so the template comparison below proves the AI is essential, not that Facebook is.
  - The Facebook-specific claim is that the context and the surfaces only exist here. We have not yet measured what the context adds; section 11 proposes the test.
  - Meta says Facebook was "the second largest driver of Meta AI engagement" in 2025 [8]. Muse Curios gives people a frequent, social reason to use Muse there.
- **Rationale.** The brief says: "If your feature would work just as well without AI, keep pushing." We tested exactly that by running the same 10 prompts through our offline composer, which picks a formula by keyword and fills a template.
- **Evidence.** The template baseline is D7; relevance was judged by one agent, not by users.
  - Offline composer: 10 of 10 valid in a median 0.068 s, but only 2 on-topic, 2 partly and 6 off-topic, with the paper look 7 times in 10.
  - Muse: 10 of 10 on-topic, with 8 different looks.
  - Examples from the offline side: a brunch poll for "a quiz about the city's neighborhoods", and template San Francisco words for "learn Spanish words".
  - Keyword matching picked the same formula as Muse on 8 of 10 prompts, so Muse's added value is content, context and look, not the choice of game type.
  - The repair loop is real AI work: 9 of 10 first drafts passed, and Wonder fixed the tenth in one 12.4 s turn (D5).
- **How Muse Curios delivers it.** Live:
  - Ember writes the brief (10 of 10 runs; median 1.9 s).
  - Wonder composes with 8 tools (list_formulas, get_formula, get_concepts, write_content, paint_cover, validate_manifest, playtest, finalize) and writes the content (9 of 10 runs). Ember wrote content once, a word list in run 02.
  - A 5-bot playtest runs, with up to 2 repair rounds.
  - Muse Image paints the cover.
- **Demo.** Run Studio live with the timeline visible. Then show one slide with the offline result for the neighborhoods prompt next to Muse's San Francisco quiz.
- **Metric.** Human-rated on-topic rate, Muse against offline; first-draft pass rate; share of created games played by others; in the context test, "mentions real members or facts" and "would you play this with this Group".
- **Risk and answer.** "Relevance was judged by one agent on 10 prompts." True; a blind human rating is the first item in section 11.

#### VP-41. Seed the feed: Meta studio accounts and creator-inspired games (planned)

- **Claim.** Meta-run "studio" accounts that each own one kind of game (Daily Word, Party Night, Story Club, Quick Arcade, Group Trivia) post a new game every day, and games inspired by famous creators ("A Curio inspired by MrBeast") give a creator's audience something to play together. The feed is never empty, and a creator's fans have a reason to come to Facebook together.
- **Why Facebook.** The games are played in Groups and the feed, with friends, and Facebook already pays creators and rewards original content [27]. A creator's audience on Facebook can play in its own Groups.
- **Rationale.** The way back for young adults is a reason for whole friend groups to show up ([01-story.md](01-story.md)). An empty feed is the first thing a new user sees; the server now holds real data only (`0636df3`), so content has to come from somewhere real.
- **Evidence.** None yet. Karthik's decision, Nov 12 18:00, with a starter list of one game per creator (see [11-roadmap.md](11-roadmap.md#seeding-the-feed-studio-accounts-and-creator-inspired-games)).
- **How Muse Curios delivers it.** Not built. The accounts and games would live in the backend database (Max's rule: no game data in app code). Muse's prompts ban real people today, so creator games need a prompt exception and a label.
- **Demo.** Said out loud as planned in beat 3 of the script; not shown.
- **Metric.** Share of new users whose first play is a studio-account game; plays and shares per creator-inspired game; Group joins that start from one.
- **Risk and answer.** "Using real creators' names without their consent" is a real right-of-publicity and endorsement risk. Guardrails: label every game "inspired by", never "by"; no face, voice or logo; original mechanics. The right production version is opt-in partnership with creators (see [08-qa.md](08-qa.md#creators-names-and-likeness)).

#### VP-42. Agree the game with Muse, and see what's new to it

- **Claim.** Before Muse builds, it shows "How the game works" part by part, marks each part Known, Approximate or New to Muse, and asks only about what it guessed. After the build, "Change the game" maps a person's words onto the parts it changes. The person controls the *function* of their game, not just its look.
- **Why Facebook.** Not Facebook-specific: this is AI value. It matters on Facebook because the games are made for specific people, so they have to play the way the maker meant.
- **Rationale.** Studio used to take a person's style (mood, look, theme) but not their function. Specific requests were where Muse missed most: 63% of must-haves, against 100% for vague ones (D30).
- **Evidence.** A draft takes 4 to 7 s on the fast model, a change about 3 s (D33). Calibration took over-flagging of "New to Muse" from 10 of 13 parts to 0 (D33). In anatomy mode, titles kept the request and the calm garden became really no-fail, but the run is not scored and gate pass fell to 7 of 11 because the gate expects a losable run (D32).
- **How Muse Curios delivers it.** Live: the "How the game works" card on Brief, quick answers, "Something off? Tell Muse", "Change the game" on Try, and the anatomy saved with the game on this device for Edit, Remix and Level 2. Not built: syncing the anatomy to friends' devices; a genre-aware gate.
- **Demo.** Beat 6 of the script: hand a judge the phone and let them change the game.
- **Metric.** Share of anatomy parts the person edits; scored must-have coverage with and without the anatomy (the next harness run); turns per game.
- **Risk and answer.** "It slows down 'one sentence'." It adds one card and 4 to 7 s; Muse asks only about guesses.

#### VP-35. A showcase for the whole Muse family

- **Claim.** Every game uses Wonder to plan with tools and write content, Ember for briefs (and one word list), and Muse Image for covers, with Spark 1.3 as the backup planner: Meta's model family used the way Meta recommends.
- **Why Facebook.** First-party models on a first-party surface. Meta describes Muse Wonder as for people "building everything from a game to an app" [28]. TechCrunch reports Meta's line "Muse Wonder plans, Muse Ember handles the volume" [29].
- **Rationale.** Meta needs frequent, social reasons to use Muse.
  - Its CFO lists creativity among the top 3 Muse categories, and more than 10 million people in the US and Canada set up Muse personal agents in about a month and a half [5].
  - People interacting with Meta AI daily rose 60% after the Muse Spark rebuild [4].
  - Facebook is the second-largest driver of Meta AI engagement [8].
- **Evidence.** Every benchmark run used muse-ember-1.0, muse-wonder-1.0 and muse-image-1.0. muse-spark-1.3 was configured as a fallback and never needed (D4). The brief requires Spark, Wonder or Ember; Wonder and Ember power every game.
- **How Muse Curios delivers it.** Live: the Studio pipeline, with the model named on each timeline step; edit, new look and level 2. Debug/CLI only: daily mode.
- **Demo.** Point at the timeline: Ember's brief at about 2 s, Wonder picks a formula at about 7 s, Image paints in parallel, and the game is ready at about 21 s.
- **Metric.** Muse calls per game and failure rate (0 of 43 in the bench); weekly Muse sessions started from Muse Curios.
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
- **How Muse Curios delivers it.**
  - Live: the Studio pipeline; a headless validator and simulator.
  - Not built: server-side replay verification. The backend is live on Prod with per-game leaderboards, but does not re-simulate runs (D36).
- **Demo.** Q&A answer: "about 5 calls per game; verification is milliseconds".
- **Metric.** Measured cost per game and per Group Daily once input tokens are logged.
- **Risk and answer.** "Without input tokens and prices this is hand-waving." We claim only measured call counts and output tokens. Logging input tokens is a small task (section 11).

#### VP-37. AI content made by and about real people

- **Claim.** Muse Curios is AI-made content anchored to a human maker, a Group and remix credits, rather than an anonymous pile of AI media. It is AI that brings you to people, not AI that replaces them.
- **Why Facebook.** Zuckerberg describes a third era of social content: "as AI makes it easier to create and remix content, we're going to add yet another huge corpus of content on top of those" [9]. Every Curio carries a real maker credit and a social context from the graph.
- **Rationale.** Backlash against anonymous AI media (Vibes [45]) shows the risk. A social anchor and a playable format give AI content a reason to be shared.
- **Evidence.**
  - Zuckerberg's framing [9] and the Vibes reception [45].
  - With no hints, Muse used all 6 formulas and all 8 looks across 10 prompts, so the feed looks varied (D6).
- **How Muse Curios delivers it.**
  - Live: 8 looks with look memory, remix lineage and notification, a maker on every Curio.
  - Live: choose-your-own-adventure stories; a guess-what-they-say-next quiz night with original scenes; Artem's Rust/WASM engine, where Muse writes new mechanics (D30).
- **Demo.** Scroll three Curios with different looks and formulas, each tagged with its maker and why it is in your feed.
- **Metric.** Share rate and completion of Muse Curios against AI video; "see less" rate.
- **Risk and answer.** "Formula games will feel samey." Bench variety was 6 of 6 formulas and 8 of 8 looks, and each game's content is specific to its Group. The format list is growing.

### 6.6 Collaboration (formerly "Roadmap: being built now")

These were the team's build priority after the judge's note. Since the collaboration batch merged (13:08, Nov 12), most of them are in the app on one device, with synthetic friends whose runs are bots on the same seed. Nothing crosses phones yet. Two-person Blends and brackets are still not built. Each entry's evidence below is from before the batch; its delivery line is updated to `6b1cc85`.

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
  - Rivalry grows from repeated, close contests [126], which is what Challenge back sets up (see "Why friendly competition makes friends").
- **Evidence.** The format has worked before:
  - Facebook's Instant Games offered leaderboards and challenges in Messenger threads in 2016 [33].
  - Apple's Games app lets players invite "friends or contacts" to score challenges [110].
  - The NYT added its first two-player game [82] and a friends tab [84].
  - Roblox co-play sessions run 1.9 times longer than solo [93].
  - The same-seed primitive it needs is shipped and verified (D12).
  - No prototype data for the chat feature itself.
- **How Muse Curios delivers it.**
  - Live (in the app since the collaboration batch; one device, with synthetic friends): Challenge Me (same-seed head-to-heads in a chat, a head-to-head result, Challenge back) and rivalries on friends' profiles; the same-seed primitive and the Friends board scope.
  - Not built: challenges that reach another person's phone.
- **Demo.** If it lands, send today's game to a hometown friend's chat and show the result card and Challenge back. If not, show the Friends board and say plainly that Messenger is in progress.
- **Metric.** Challenges sent per weekly player; reply and rematch rate; share of challenges sent to friends in a different city.
- **Risk and answer.**
  - "Facebook pulled Instant Games out of Messenger on iOS in 2019 [36]." Facebook's announcement gave no reason [36], so we don't guess at one. We send a card (a seed and a score), and the game opens in Facebook's built-in runtime.
  - On App Store policy: guideline 4.7 allows "HTML5 and JavaScript mini apps and mini games" inside apps. It requires filtering objectionable material, a way to report content, blocking abusive users, an index of the software with universal links, and an age restriction mechanism [124]. Muse Curios are JSON manifests run by a fixed JavaScript runtime, so they fall under 4.7. Reporting, the index and the age gate are not built.

#### VP-15. One card the whole group chat plays

- **Claim.** A group chat gets one game that everyone plays, a live mini leaderboard and a rematch, turning a "we should hang out" chat into shared activity.
- **Why Facebook.** Messenger group chats are a mass behavior: 2.5 million new groups were created every day in 2017, averaging 10 people (2017, latest public figure) [19]. A chat's game can also connect back to the Group or Event where the plan happens. iMessage has chat games and Apple Invites has events [121], but neither has standing Groups or feed discovery.
- **Rationale.** Plans start in group chats and stall there.
  - Social play lasts longer than solo play: Roblox reports co-play sessions are typically 1.9 times longer than solo sessions [93].
  - An AI party game on Discord, Death by AI, reached nearly 7 million players within weeks [98].
  - Wordle revived a quiet family group chat [88].
  - Groups of three ranked on a weekly leaderboard walked 920 more steps a day than controls, the most of any arm (STEP UP, 2019) [127]. A chat's mini leaderboard is the same shape (see "Why friendly competition makes friends").
- **Evidence.**
  - Facebook's own Instant Games offered leaderboards and challenges in Messenger group threads in 2016 [33].
  - Apple made challenges with friends a main social feature of its Games app [110].
  - The same-seed Daily the card relies on is shipped (D12).
- **How Muse Curios delivers it.**
  - Live (in the app since the collaboration batch; one device, with synthetic friends): a group-chat card that becomes a shared session ("3 of 5 played"), with a mini leaderboard and Rematch; a guess-what-they-say-next quiz night in group chats; the same-seed Daily.
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
  - Competition between groups raised cooperation inside each group in a lab game [129], but a prize tournament between groups cut friendships across them [130]. Team formats should pull a Group together without making another Group the enemy (see "Why friendly competition makes friends").
- **Evidence.** Hall's hours-to-friendship figures [65][66] and Depping's cooperation results [72]. Our bots show a caution: the word game "Fog Words" did not rank by skill (median scores 200, 400 and 300 for low, middle and high skill), so luck-heavy games should reward improvement rather than raw rank (D16).
- **How Muse Curios delivers it.**
  - Live (synthetic members): a Games tab, a weekly leaderboard with Most improved, Challenge the Group, quiz night as game night, the Group board and Daily streak.
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
- **How Muse Curios delivers it.** Live (in the app since the collaboration batch; one device, with synthetic friends): Make it together (invite a chat, a friend or a Group to add a question, words, a scene or a level; Muse stitches them; credits name every maker), plus Studio edits, remix lineage and the "remixed your Curio" notification.
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
  - Head-to-head play can still build trust when the two players affect each other [72]; Blends add a bonus for evenly matched games that never goes negative, so nobody is matched down (built on a teammate's branch, not yet in the app) (see "Why friendly competition makes friends").
- **Evidence.** For the Group version: Kevin's Group Blend (geometric mean, a misery floor and plus-only fairness) raised the worst-off member's enjoyment from 0.31 (random) to 0.489 and games everyone enjoys from 8.7% to 32.0% across 240 synthetic Groups, within noise of plain averaging (D29, simulated). For the two-person version: no prototype data; Spotify's Blend is the analogy [125]. The pieces exist: same-seed play and replay verification (D12), the Event icebreaker that already makes a game from guests' intros (D8), and the recommender, which learns each person's taste from their plays (in the app on `main`).
- **How Muse Curios delivers it.**
  - Not built: taste profiles from play history, matching two profiles and blending them into a brief Muse can build from (asked of Kevin's recommender work; design and request sent on Nov 12), a "Blend with" button on a friend's profile and on board rows, and an Event bracket.
  - Live: the **Group Blend** on Group pages (games picked for everyone, "Make our Blend game" in Studio, and a "taste twin" with Add friend); the same-seed primitive, verified scores, the Event icebreaker and the Friends board scope. The server also has `POST /v1/blend` and a Group blend route (D36).
- **Demo.** Show the Group Blend on the New in SF page in beat 5 ([07-demo-script.md](07-demo-script.md)). Two-person Blends and brackets are said as next, not shown.
- **Metric.** Blends started per new friendship; share of Blends finished by both people; Add friend or messages between the two within 7 days; bracket completion per Event; repeat Blends between the same pair.
- **Risk and answer.**
  - "This is matchmaking." It isn't: a two-person Blend is only offered between people who are already friends or who went to the same Event. The Group Blend's "taste twin" is a member of a Group you both joined, the same scope as a board row. Dating stays out of scope.
  - "Play history says little about a person." True for a few plays. A Blend can start from what each person chose to play and make, and from opted-in intros, as the icebreaker does. Whether it feels personal is untested.
  - "A loss in a two-person game could sting." Blends can use cooperative scoring (a shared total) as well as head-to-head, and a bracket can reward Most improved, as the weekly boards do (VP-19).

#### VP-11. Find your scene through what you want to play

- **Claim.** From Search, a newcomer can find games tied to a place or interest, or make one with Muse, and reach the Group around it.
- **Why Facebook.** Facebook Search now has an AI Mode, powered by Muse Spark, with answers "grounded in what people are saying publicly across our apps like in Groups and Reels" [24]. People ran more than 2 billion searches a day on Facebook in 2016 (latest public figure, likely stale) [120].
- **Rationale.** A game about climbing in SF is a friendlier first contact with a community than a list of Groups. In WeChat, over 80% of mini-game users launch games through pull-down menus, search and social sharing [92].
- **Evidence.** Facebook's AI Mode in Search [24], its search volume [120] and the WeChat launch figures [92]. No prototype data yet.
- **How Muse Curios delivers it.** Live: games in Search, and "Make it with Muse" when nothing matches (its copy says "about a minute", which is wrong for both build paths; see open-items).
- **Demo.** Only if it lands: search "bouldering", play a Group's game from the results and tap through to the Group.
- **Metric.** Group joins that start from a game opened in Search.
- **Risk and answer.** "TikTok Minis are also found through search [105]." Agreed, this is table stakes. Its value is the link to Groups and Events, which TikTok lacks.

#### VP-12. Learn together, with friends' streaks

- **Claim.** Learn games (for example beginner Spanish) with Group mastery and friends' streaks turn solo study into a shared habit.
- **Why Facebook.** Group mastery needs a Group, and friends' streaks need the friend graph.
- **Rationale.** Streaks build habits. Duolingo learners who reach a 7-day streak are 3.6 times more likely to complete their course, and allowing two Streak Freezes raised daily active learners by 0.38% (relative) [114].
- **Evidence.** Duolingo's streak results [114]. Muse's beginner Spanish game was 8 of 8 correct in a spot-check (D8, estimate).
- **How Muse Curios delivers it.** Live: the `learn` formula, with a Group mastery meter ("New in SF knows 82% of the hills") and friends' streaks, both synthetic in the demo.
- **Demo.** Optional: play the Muse-made Spanish game in about 20 s.
- **Metric.** 7-day streak rate for learners with a friend learning the same topic, against solo learners.
- **Risk and answer.** "Duolingo already does this." It is a supporting value; the point is learning with your Group, which Duolingo does not host.
