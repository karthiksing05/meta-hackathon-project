# Closer together, and why people come back

*How Muse Curios brings specific people closer, why friendly competition makes friends, and the return loop. Part of the pitch docs; start at [README.md](README.md).*

## The thesis (from the earlier draft, corrected)

*The lead story is now [01-story.md](01-story.md); this is the same idea told from the Group's side.*

**Facebook has many of young adults' Groups and Events but has stopped giving them a reason to open it, or to come back. Muse Curios makes a daily ritual collaborative: every Group, Event and group chat gets games its own members make with Muse, about themselves, played on one seed, so making one is a reason to open Facebook, and a new Daily, a challenge and a rematch are reasons to return.**

Muse Curios is about bringing people closer together, which is the mission Facebook has stated since 2017: to "build community and bring the world closer together" [12][50]. It does that in three ways:

- **Play together.** Everyone in a Group or at an Event gets the same game.
- **Compete together.** Same-seed scores are fair, so a board row next to a stranger is a reason to say hello.
- **Make together.** Friends and Groups make games for and about each other.

Anyone can describe a tiny game in one sentence. Meta's Muse models write a brief, build the game, test it with bots and paint its cover, in a median of 28 seconds for a ready-formula game and 99 seconds for a game made from scratch (D2, D30). The games are made from things only Facebook holds: a Group's opted-in posts, an Event's guest list and a person's friends. They are played where those people already are: Groups, Events, Messenger chats, Search, the feed, Stories, Reels, profiles and notifications (chats and Search on one device, with synthetic friends).

For a young adult new to a city, that means three things:

- a low-stakes first move in a Group of strangers;
- arriving at a meetup already knowing a few names;
- turning a leaderboard row into a friend request.

After a judge's feedback that the closer-together and social-network parts matter most, the team made collaboration its top priority and built it: Challenge Me, group-chat play, Games in Groups and Search, Make it together, Remix, story adventures, quiz night, Learn, length settings and saves landed on Nov 12 (VP-14, VP-15, VP-19, VP-38 in [10-value-propositions.md](10-value-propositions.md)). Kevin's recommender and the Group Blend section followed.

Prompt-to-game generation is no longer rare (YouTube, Roblox and Meta's own Pocket all do it). Our case rests on two things together: a generator that turns *any described idea* into a playable game and agrees it with the maker ([04-why-ai.md](04-why-ai.md)), and the social context, which only Facebook has in one place ([05-why-facebook.md](05-why-facebook.md)). (An earlier draft said the case "does not rest on the generator"; the harness work since then makes the generator half the case.)

The pitch itself is in [01-story.md](01-story.md), [07-demo-script.md](07-demo-script.md) and [08-qa.md](08-qa.md).

## How Muse Curios brings people closer together

Each step of the ladder is a value proposition. Each one names the relationship it builds.

| Step | What happens | Relationship | VP | Status |
|---|---|---|---|---|
| 1. Stranger in a Group | Alex joined New in SF two weeks ago and hasn't posted. | You and your Group | (the need) | Starting point |
| 2. Shared Daily | They play the Group's Daily, made from members' opted-in intros. It is a first move that isn't a post. | You and your Group | VP-02, VP-01 | Live (Daily generation: Debug/CLI only) |
| 3. Board neighbor | Their score lands next to members' names on a fair, same-seed board. | You and a stranger | VP-04, VP-16 | Live |
| 4. Add friend | They watch the Burst of the person just above them, then tap Add friend. | You and a stranger | VP-04 | Live (the row is a bot run by a synthetic person) |
| 5. Icebreaker before meeting | They RSVP to the picnic and play a game made from other guests' intros. | You and a stranger | VP-03 | Live |
| 6. Meeting at the Event | They arrive knowing a few names and facts. | You and a stranger | VP-03 | (offline) |
| 7. Rematch in Messenger | A same-seed challenge with their new friend, or one card the whole group chat plays. | You and a friend | VP-14, VP-15 | Live on one device (the friend's run is a bot on the same seed); not across phones |
| 8. Make a game together | They and their new friends make next week's game for the Group, with credit for every maker. | You, your friends and your Group | VP-38 | Live on one device (co-makers are synthetic) |
| 9. Blend and bracket | After the picnic, Muse makes a game from their and a new friend's play history, and a bracket for everyone they met there. Today's first step is the Group Blend on the Group page: games for everyone, a Blend game Muse makes for the whole Group and a taste twin to add. | You and the people you just met | VP-40 | Not built |

**Why games build friendship, not just engagement.** Three findings support the ladder:

- In a study whose adult sample had just moved, playing video games and watching movies together went with closeness, while time together at work or school did not [66]. Friendship takes about 50 hours to casual friend, 90 to friend and more than 200 to close friend [65].
- In lab studies of strangers, cooperation and interdependence each increased closeness, and interdependence worked entirely through more conversation [72]. The same work found that "cooperation is not necessary to form social bonds in games" [72], so competitive formats such as boards can build ties too.
- In a CHI PLAY 2016 experiment with 52 pairs of strangers, "a social game can be more effective than a social task at fostering interpersonal trust" [72].

These are small or lab studies, so we use them as direction, not proof. Section 9 describes how we would measure the ladder in a pilot.

### Why friendly competition makes friends

Strangers need a reason to talk, and a score gives one. Your 42 next to a stranger's 44 is low stakes: it is about the game, not about you, and the Group or Event already put you both in the room. "How did you get 44?" is easier to send than "want to be friends?", and a rivalry gives a reason to message again. The comparison only means something if both played the same game, and same-seed play gives that.

What the evidence says:

- **Rivals can bond, if they affect each other.** In a lab study, playing an interdependent game as rivals still raised relatedness, enjoyment and trust, though playing as partners raised trust more. In a survey of 234 players, interdependence predicted in-game ties (paths of .45 for bridging and .30 for bonding), while cooperation did not; the authors write that "players do not need to work toward the same goal to form social bonds" [72].
- **Rivalry is a relationship.** In NCAA basketball, how similar two teams were and how often and how closely they had played before predicted how strong a rivalry they felt [126].
- **Small leaderboards bring people back.** In the STEP UP trial (about 600 adults, 2019), groups of three ranked on a weekly leaderboard walked 920 more steps a day than controls, more than the support (689) or collaboration (637) arms. They were the only arm still significantly ahead three months after the game ended (569 steps) [127].
- **First contact works by lowering anxiety.** Across 515 studies, more contact with another group went with less prejudice (mean r = .21), and lower anxiety about contact was a main reason [128].

Competition can also divide. Competition between groups raised cooperation inside each group in a 192-student lab game [129], but at the Robbers Cave camp, after a tournament with prizes, only 6.4% and 7.5% of each group's friendship choices went to the other group; after shared goals they rose to 36.4% and 23.2% [130]. Toxicity also predicted fewer in-game ties [72]. So our guardrails are:

- **Fair seeds.** Everyone in a Group's Daily plays the same seed, and runs can be re-checked (VP-16). Live.
- **Scoped boards.** Rows appear only for people in a Group or Event you both joined, and contact goes through the normal friend flow (VP-04). Live, with synthetic rows.
- **Plus-only fairness in Blends.** Blends favor evenly matched games with a bonus that fades to zero as skills drift apart and never goes negative, and members the Blend has served least get a boost without anyone being pushed down (VP-40). Weekly boards add Most improved, so it isn't only for the best player (VP-19). The Group Blend (with this fairness rule) is in the app at `6b1cc85`; two-person Blends are not built. In simulation the worst-off member's enjoyment rose from 0.31 (random) to 0.489, but that is within noise of plain averaging (D29).
- **Opt-in.** You choose to play, to share a score and to challenge someone. No mass invites, no cash rewards (VP-29).

The board with Add friend is Live, with bot runs by synthetic people. Challenge Me and group-chat play are Live on one device with synthetic friends; the Group Blend is Live; two-person Blends and brackets are Not built.

### How the solution maps to the problem

| Problem point | Feature | Facebook surface | Status |
|---|---|---|---|
| 1, 3. A reason to open the Group, and a first move that isn't a post | Daily Curio from members' opted-in posts (VP-02, VP-01) | Groups | Live (Daily generation: Debug/CLI only) |
| 3, 4. Meeting strangers in person, cold | Event icebreaker made from guests' intros (VP-03) | Events | Live |
| 3, 4. No path from stranger to friend | board with fair, same-seed scores and Add friend (VP-04, VP-16) | Groups, Events, profiles | Live (rows are synthetic people) |
| 1, 2. No daily ritual that brings people back | One Daily per Group, and a playable feed of replays (VP-06, VP-39) | Groups, feed, Stories, Reels | Live |
| All. A game about your people would otherwise need a developer | Muse Studio: one sentence to a game (VP-05, VP-34) | Curios tab, Groups, Events | Live |
| 2, 5. Group chats and old friendships go quiet | Challenge Me and one card the whole chat plays (VP-14, VP-15) | Messenger | Live on one device |
| 4. Time together is scarce | Make a game together; weekly boards and game night (VP-38, VP-19) | Groups, Events | Live on one device (synthetic members) |
| 4. Strangers you just met stay strangers | Group Blend (Live); two-person Blends and an Event bracket (VP-40) | Groups, Events, profiles | Partly Live |

## How we'd know it works

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

| When | Why they return | Loop step |
|---|---|---|
| Day 2 | A new Daily in their Group, and the Daily-ready notification | Daily |
| Day 2 to 7 | Someone passed their score; they check the board, watch that person's Burst and send an Add friend | Board, then Add friend |
| Day 7 | The picnic is Saturday; they play the icebreaker and go | Event |
| Day 7 to 30 | A rematch with a new friend in Messenger, a weekly trophy, a game made with friends (in the app on one device; nothing crosses phones yet) | Rematch |
| Day 30 | Each Group they have joined has its own Daily | The next Daily |

The loop: Daily, then board, then Add friend, then Event, then rematch, then the next Daily.

## Marketing the collaboration

Karthik's note: "Need to market the collaborative aspect of the app!" Most AI game makers stop at "you made a game". Muse Curios is about what happens *between people* around the game, and that is what the pitch should sell. The collaborative features, with their real status:

| Together, how | What happens | Surface | Status |
|---|---|---|---|
| Make it together | A chat, a friend or a Group each add a question, words, a scene or a level; Muse stitches them into one game; credits name every maker | Messenger, Groups, Studio | Live on one device |
| Play together | One card in a group chat becomes a shared session everyone plays on the same seed ("3 of 5 played"), with a mini board and Rematch | Messenger | Live on one device |
| Game night | A Group's quiz night: a lobby fills, everyone plays the same seed, a podium closes it | Groups | Live on one device |
| Compete together | Challenge Me, Challenge back, a weekly Group board with Most improved, "You vs Maya: 3-2 this week" | Messenger, Groups, profiles | Live on one device |
| Remix as a reply | A remix credits and notifies the maker and can go back to them as a playable card | Notifications, Messenger | Live on one device |
| Stories together | Adventures where you see which ending each friend found ("Maya took the ferry") | Feed, Messenger | Live on one device |
| Get to know someone | Group Blend: games for everyone and a "taste twin" to add | Groups | Live |
| Meet someone new | **A 3-game get-to-know-you bracket** for two people who just met | Profiles, Events | **In progress** on `fe-qol`, not merged |
| A game from two people | Two-person Blends and an Event bracket for everyone you met | Profiles, Events | Not built |

**How to say it.** "Games are better with people. So in Muse Curios you make them together, play them together, compete, and meet people through them." Lead with a moment between two people (see [hook.md](hook.md) option 12), not with the generator.

## The engagement story

**What we want more of: moments with people, not minutes.** Muse Curios is short-form and low pressure on purpose: a run takes seconds, a Daily allows one scored run, and every result sheet ends in a person (challenge, board, Add friend), not autoplay. The recommender is built to match.

**The recommender** (`game-recs.js` 0.5, by Kevin; in the app on `main` and running on the Prod server in Go):

- **Hand-written and explainable.** A formula with named weights, updated on the device as you play. Nothing is pretrained or fitted. Each feed page carries a reason ("a friend's run", "today's Daily in New in SF").
- **It separates "did you tap it" from "were you glad you did".** Grab and satisfaction are separate Beta posteriors explored by Thompson sampling, with satisfaction weighted 2.5 times. Finished runs, saves, shares and Add friend count for a game; quick skips count against it.
- **It protects people who don't want bait.** A learned per-person "bait lean", a slop guard and a repeat window. In property tests over about 20,000 pages, the repeat window and slop guard held 100% of the time, and bait-averse people stayed within 5 hooky games per 10 pages in 88.5% of windows, against 67.7% with the guard off (D28).
- **New games get a fair shot.** A bot-gate prior: a new game starts from how the 5 bots played it. (No published counterpart; unvalidated.)

**What the simulation says (all synthetic people, D27 to D29).** 90 synthetic people (bait lovers, balanced and bait-averse), 50 games plus 3 new a day, 14 days, 3 worlds. The repo's own words: these results "show which way things move, not how much they'd move with real users".

| Result | Number | Caveat |
|---|---|---|
| Interleaving against today's feed | The formula wins **70.3%** of decided sessions (95% CI 68 to 72%, p < 0.001; 74.4% in week 2), 3,780 sessions per control | Simulated. It was 68.5% before a repeat-window bug fix; use 70.3% |
| Against its own greedy version | Loses, 47.0% | Interleaving can't see session length or the value of exploration; ε-greedy beats it on payoff for 2 of 3 personas |
| Joy per page, bait lovers | 0.411, against 0.239 for today's feed and 0.201 for most-popular | Simulated |
| Bait-averse people | Joy 0.310 and the longest sessions (8.2 pages) | Simulated. Longer sessions are not our goal; see the Q&A on engagement machines |
| Group Blend | Worst-off member's enjoyment 0.31 (random) to 0.489; games everyone enjoys 8.7% to 32.0%; 240 synthetic Groups | Best of the methods tried, but within noise of plain averaging |

**What it is not.** It has no real traffic: the server copy runs on Prod with no users, and the app copy runs on synthetic people. A Muse re-rank term exists but is off by default and in the demo.

**The return loop** is the table above: a new Daily tomorrow, someone who passed your score, an Event this weekend, a rematch, and each new Group's own Daily. Planned studio accounts and creator-inspired games ([11-roadmap.md](11-roadmap.md)) would make sure the feed is never empty on day one.
