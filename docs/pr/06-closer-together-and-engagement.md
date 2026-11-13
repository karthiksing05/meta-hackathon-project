# Closer together, and why people come back

*How Whims brings specific people closer, why friendly competition makes friends, and the return loop. Part of the pitch docs; start at [README.md](README.md).*

## 1. Thesis

**Facebook has young adults' people but has stopped giving them a reason to open it, or to come back. Whims makes a daily ritual collaborative: every Group, Event and group chat gets games its own members make with Muse, about themselves, played on one seed, so making one is a reason to open Facebook, and a new Daily, a challenge and a rematch are reasons to return.**

Whims is about bringing people closer together, which is the mission Facebook has stated since 2017: to "build community and bring the world closer together" [12][50]. It does that in three ways:

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

## 2. How Whims brings people closer together

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
- **Plus-only fairness in Blends.** Blends favor evenly matched games with a bonus that fades to zero as skills drift apart and never goes negative, and members the Blend has served least get a boost without anyone being pushed down (VP-40). Weekly boards add Most improved, so it isn't only for the best player (VP-19). Blends: built on a teammate's branch, not yet in the app.
- **Opt-in.** You choose to play, to float a score and to challenge someone. No mass invites, no cash rewards (VP-29).

The board with Add friend is Live, with bot runs by synthetic people. Challenge Me, group-chat play and Blends are Not built.

### How the solution maps to the problem

| Problem point | Feature | Facebook surface | Status |
|---|---|---|---|
| 1, 3. A reason to open the Group, and a first move that isn't a post | Daily Whim from members' opted-in posts (VP-02, VP-01) | Groups | Live (Daily generation: Debug/CLI only) |
| 3, 4. Meeting strangers in person, cold | Event icebreaker made from guests' intros (VP-03) | Events | Live |
| 3, 4. No path from stranger to friend | board with fair, same-seed scores and Add friend (VP-04, VP-16) | Groups, Events, profiles | Live (rows are synthetic people) |
| 1, 2. No daily ritual that brings people back | One Daily per Group, and a playable feed of replays (VP-06, VP-39) | Groups, feed, Stories, Reels | Live |
| All. A game about your people would otherwise need a developer | Muse Studio: one sentence to a game (VP-05, VP-34) | Whims tab, Groups, Events | Live |
| 2, 5. Group chats and old friendships go quiet | Challenge Me and one card the whole chat plays (VP-14, VP-15) | Messenger | Not built |
| 4. Time together is scarce | Make a game together; weekly boards and game night (VP-38, VP-19) | Groups, Events | Not built |
| 4. Strangers you just met stay strangers | Blends and an Event bracket (VP-40) | Events, profiles | Not built |

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
