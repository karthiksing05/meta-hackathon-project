# The rubric and the brief

*How Whims maps to the judging criteria and to the brief. Part of the pitch docs; start at [README.md](README.md).*

## How this maps to the brief

### Judging criteria

The format: a 5-minute demo and 3 minutes of Q&A. AI must be essential, not decorative, and the core AI must be Muse Spark, Wonder or Ember.

| Criterion | Weight | Description (from the brief) | How we meet it |
|---|---|---|---|
| AI Integration | 30% | "AI does real work and feels like a natural part of the product, not a cosmetic add-on." | Muse turns any described idea into a game with new mechanics on our WASM engine, agrees how it works with the maker part by part and flags what's new to it, writes it, repairs it and has 5 bots play it (VP-34, VP-42; [04-why-ai.md](04-why-ai.md)). Eval suite: 12 of 12 requests passed the gate, 88% of must-haves present, Muse-judged (D30). Ember writes the brief; Wonder composes formula games and writes content from Group and Event posts; Image paints covers (VP-35). Against a template baseline, one agent judged 6 of 10 template games off-topic (D7). Per-Group dailies are impossible to hand-write at scale (VP-18). |
| Product Thinking and User Impact | 25% | "Solves a clear young-adult need, fits naturally on Facebook, and gives people a reason to come back." | Need: Facebook doesn't appeal to young adults because their friends aren't there; the sharpest case is a newcomer in a new city ([01-story.md](01-story.md), [02-problem.md](02-problem.md)). Fit: built on Groups, Events, friends, Messenger and the feed ([05-why-facebook.md](05-why-facebook.md)). Return: the loop, the recommender and the north star ([06](06-closer-together-and-engagement.md)). |
| Execution & Demo | 25% | "A working, polished demo that does what you say it does, with no unnecessary mockups." | Studio runs live on real Muse: ready formulas median 28.0 s (D2), games from scratch median 99 s (D30). Whims is on Groups, Events, the feed, Stories, Reels, profiles, Notifications, Messenger chats and Search (D19). Tests: engine 200, runtime 600 of 600 in Node and 590 of 590 in JSC (D35). Backend live on Prod (D36). Every status is labeled, and the demo has one spoken "planned" moment instead of mock frames ([07](07-demo-script.md)). Weak spots we name: seed stamps, the Daily's CLI-only generation, bot rows behind Add friend ([open-items.md](open-items.md)). |
| Originality and Cohesion | 20% | "A distinct, ambitious idea where every part cohesively supports solving the user problem." | Facebook Groups have members but no shared moment; Whims gives every Group and Event a daily shared moment that Muse writes from the community itself, played on one seed, so a score next to a stranger becomes an introduction. The five core value propositions are one chain ([06](06-closer-together-and-engagement.md)). New since then: a short-form format you play *with* people, and a maker who agrees the game's anatomy with Muse. |

### The four named needs

| Need in the brief | Our fit |
|---|---|
| Making friends in a new city | The core. Ages 19 to 29 are the loneliest age group worldwide (27% very or fairly lonely) [60]. 24% of US adults under 30 felt lonely "a lot of the day yesterday" in early 2023 [119]. In-person time with friends for ages 15 to 24 fell from about 150 to 40 minutes a day between 2003 and 2020 [59], and the Surgeon General compares the health risk of social disconnection to smoking [59]. 25% of US men aged 15 to 34 felt lonely a lot of the previous day [62]. Our answer is the Group Daily, the Event icebreaker and Add friend on boards (VP-02, VP-03, VP-04). |
| Finding their scene | Supporting. Games in Search lead to Groups (VP-11, live); the feed surfaces Groups' games. |
| Getting a side hustle off the ground | Not our focus. Makers get credit and an audience (VP-23), but we make no income claim. |
| Turning group-chat plans into real plans | Partly. Icebreakers attach play to an Event; group-chat cards, game night and Event brackets connect chats to Events (VP-15 and VP-19 live on one device; Event brackets in VP-40 not built). |

### Places to start

| Place | Where we fit | Where we deliberately don't |
|---|---|---|
| Marketplace | Whims complements the newcomer's Marketplace habit (VP-08). | No games in listings: buying and selling should stay fast and trusted. |
| Groups | The center: Daily, boards, Games section, game night (VP-02, VP-18, VP-19). | No auto-posting without admin opt-in. |
| Events | Icebreakers before you meet; game night as an Event (VP-03). | We don't replace the Event; play leads to showing up. |
| Dating | Lessons transfer (everyday names, low-pressure first contact). Young-adult matches on Facebook Dating were up 10% a year in 2025 [51], so Meta already uses Facebook to help young adults meet people. | Out of scope: we chose friendship, a lower-stakes and wider need. |
| Gaming | A new kind of social gaming made by members (VP-05, VP-29). | No studio catalog, no cash or token rewards. |
| Messenger | Challenge Me and group-chat play (VP-14, VP-15, live on one device with synthetic friends). | No heavy game engine in the thread; a light card. |
| Feed, Reels and Profile | Bursts, shares, a recommender-ranked playable feed, the profile Whims tab, Games about me (VP-09, VP-13, VP-39). | No maximizing of minutes; finite daily play. |
| Something new | Playable, AI-made posts about your own people (VP-01, VP-37). | |

More of the brief's wording, Meta's kickoff notes and the rubric text we map against are in [appendix-pitch-examples.md](appendix-pitch-examples.md#a10-rules-rubric-and-brand). The brief's four kinds of AI work are mapped in [04-why-ai.md](04-why-ai.md#5-the-briefs-four-kinds-of-ai-work-mapped).
