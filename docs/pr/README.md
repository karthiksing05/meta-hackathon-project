# The pitch docs

*Index of the pitch and value-proposition writing for Whims, how to read it, and its status. Moved here from `docs/VALUE_PROPOSITION.md`, which now points to this file.*

## In one paragraph

Facebook doesn't appeal to young adults: their friends are on Instagram, and people join a network because their friends are there. The way back is a reason for a whole friend group to show up on Facebook *together*. We designed a short-form format you play *with* people, not just watch, and built it as **Whims**: tiny, low-pressure games anyone makes from one sentence with Meta's Muse models, then plays with their friends, Groups and Events. Create on a whim, play on a whim. Muse is essential because it turns any described idea into a game that plays the way the person meant: it agrees how the game works with them, says which parts are new to it, writes it, fixes it and has bots play it first. Facebook is essential because only Facebook has the Groups, Events, friends, chats and feed that make the games mean something.

## How to read it

Read [01-story.md](01-story.md) first; it is the pitch in seven steps, and each step links to the file that backs it.

| File | What it holds |
|---|---|
| [hook.md](hook.md) | Options for the first 15 to 30 seconds, with a recommended pick |
| [01-story.md](01-story.md) | The story spine in Karthik's order, the one-liners and the line bank |
| [02-problem.md](02-problem.md) | The problem, who has it, and why it isn't solved today |
| [03-what-we-built.md](03-what-we-built.md) | What a person does, what is live, local or coming at `6b1cc85`, and the terms |
| [04-why-ai.md](04-why-ai.md) | Why Muse is needed: the harness, the game anatomy, the eval numbers and their limits |
| [05-why-facebook.md](05-why-facebook.md) | Why only Facebook, Instagram, and every alternative compared |
| [06-closer-together-and-engagement.md](06-closer-together-and-engagement.md) | How Whims brings people closer, why friendly competition makes friends, the engagement story and the return loop |
| [07-demo-script.md](07-demo-script.md) | The 5-minute script on the spine, with fallbacks; the earlier 9-beat version below it |
| [08-qa.md](08-qa.md) | Q&A: the hardest questions first, the IP line, creators, then everything else |
| [09-evidence.md](09-evidence.md) | Our data, D1 to D39, with each number's source and label |
| [10-value-propositions.md](10-value-propositions.md) | The detailed catalogue of every value proposition (VP-01 to VP-42) |
| [11-roadmap.md](11-roadmap.md) | What is planned or not built: studio accounts, creator games and the rest |
| [12-rubric-and-brief.md](12-rubric-and-brief.md) | How it maps to the judging criteria and the brief |
| [open-items.md](open-items.md) | Internal: proposed app fixes, pending decisions, what must land, what we still need to prove |
| [sources.md](sources.md) | Every public source, numbered [1] to [134] |
| [appendix-pitch-examples.md](appendix-pitch-examples.md) | Every example gathered for the pitch |
| [appendix-dropped.md](appendix-dropped.md) | What we dropped or held back, and why |

**Conventions.**

- Numbers in square brackets, such as [52], are public sources in [sources.md](sources.md). IDs such as D30 are our own data in [09-evidence.md](09-evidence.md). VP-NN are value propositions in [10-value-propositions.md](10-value-propositions.md).
- Our own data is always labeled **measured**, **bot-run**, **simulated** (synthetic people, never real users), **teammate-reported** or **estimate**.
- Every person, Group, Event and score in the demo is synthetic. We have no real-user data. The planned creator-inspired games are the one place real names appear, by Karthik's decision, labeled "inspired by".
- **(K)** marks something Karthik asked for himself.
- The product is called **Whims** in prose. "Bubble" survives in code names and in quotes about the naming history.

**Old section numbers.** Some entries still say "see section 3.3" or "section 11". They refer to the old document's numbering, which maps to these files:

| Old section | Now in |
|---|---|
| The problem and the solution; "Where this came from" | [02-problem.md](02-problem.md) |
| "Our solution"; "Terms a judge may not know" | [03-what-we-built.md](03-what-we-built.md) |
| 1 Thesis; 2 How it brings people closer; "Why friendly competition makes friends"; 9 How we'd know it works | [06-closer-together-and-engagement.md](06-closer-together-and-engagement.md) |
| 3 Why Facebook (3.1 to 3.3); 7 Facebook against the alternatives | [05-why-facebook.md](05-why-facebook.md) |
| 4 At a glance; 6 Each value proposition (6.1 to 6.6) | [10-value-propositions.md](10-value-propositions.md) |
| 5.1 One-liner and line bank | [01-story.md](01-story.md) |
| 5 intro, 5.2 the story, 5.3 the demo script | [07-demo-script.md](07-demo-script.md) |
| 5.4 Q&A | [08-qa.md](08-qa.md) |
| 5.5 Open items; 11 What we still need to prove | [open-items.md](open-items.md) |
| 8 Our preliminary data (8.1 to 8.4) | [09-evidence.md](09-evidence.md) |
| 10.1 to 10.3 The brief | [12-rubric-and-brief.md](12-rubric-and-brief.md) |
| 10.4 "AI should be essential" | [04-why-ai.md](04-why-ai.md) (section 5) |
| 12 Sources | [sources.md](sources.md) |
| Appendices | [appendix-dropped.md](appendix-dropped.md), [appendix-pitch-examples.md](appendix-pitch-examples.md) |

## Status at `6b1cc85`

Statuses in these files are as of commit `6b1cc85` on `main` (the integration of `recommendation`, `backend-api` and `gold-games`). Values:

- **Live**: in the app on `main`, reachable through the normal UI. Other people in it are synthetic.
- **Live on one device**: works in the app, but the other side (a friend, a chat, a Group member) is a bot run on the same seed, and nothing crosses phones.
- **Debug/CLI only**: works, but only through our command-line tools or a debug launch.
- **Live on Prod**: deployed on the backend servers, with no real traffic.
- **Not built** or **Planned**: designed or decided, not built.

The short version:

- **Live:** Studio with the game anatomy and both build paths; microgames on the WASM engine with Muse-made art and sound; the recommender-ranked feed; the Group Blend; boards with Add friend (to bot rows); the collaboration batch (Challenge Me, group chats, Games in Groups, Search, Make it together, Games about me, Remix, adventures, quiz night, Learn, length, saves), on one device.
- **Debug/CLI only:** making a Group's Daily from members' posts.
- **Live on Prod:** the backend with the recommender, feed, search, Blend and generate. Server generation has never completed a real end-to-end run.
- **On `main` but not in the app:** the gold set and its retrieval in Muse's prompt; the harness eval suite and anatomy mode.
- **Not in the repo:** the style kit (an unpushed prototype).
- **Planned:** Meta studio accounts and creator-inspired games; two-person Blends and brackets.
- **Not confirmed on a phone:** anything after `ee12c04`.
- **Built but wrong:** seed games' "Made with Muse in N s" stamps and the "about a minute" copy. See [open-items.md](open-items.md#proposed-app-fixes).

## Where this came from

These files were one document, `docs/VALUE_PROPOSITION.md` (about 1,930 lines, last updated at 13:52 on Nov 12). Karthik asked to keep all of the writing, split it by topic, rename it to Whims and correct it. Nothing substantive was deleted: superseded material is kept and marked (for example the earlier 9-beat demo in [07](07-demo-script.md), and retired claims in [appendix-dropped.md](appendix-dropped.md)). Work credited to teammates: the engine and the harness up to the 17:19 handoff (Artem; Karthik owns the agentic harness since then, and Artem takes the front-end handoff next), the recommender and Group Blend (Kevin), the backend (Max), the style kit and authoring layer (Bayan), and the front end and story (Karthik).
