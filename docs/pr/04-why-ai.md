# Why AI is needed

*Why Whims does not work without Muse: the interactivity and customizability of the games, what we measured and what we didn't. Part of the pitch docs; start at [README.md](README.md).*

**The short answer.** A Whim is whatever a person can describe. Turning "a game where gravity flips every time I tap" or "a Wordle about our Group" into a game that plays the way they meant needs a model that can design rules, write them, check them and fix them, then talk the result through with the person. Templates can only reskin. Without Muse there is no game, no anatomy, no daily content and no cover. And without Muse there is no supply: tens of millions of Groups and Events cannot each get a hand-made daily game or icebreaker.

## 1. Any idea becomes a game that plays (the microgame harness)

Studio has two paths. A **ready formula** composes one of 6 game types from 55 tested blocks (median 28 s, D2). A game **made from scratch** is where the AI does the most:

1. **Muse writes the whole game** as an authoring manifest for our Rust/WASM engine: rules, state, art (SVG sprites) and sound sets. Its system prompt is built at run time from the live catalog: 33 tested fragments, the engine's builtins, the format rules and the two closest of our 16 hand-made gold examples.
2. **Studio expands and validates it** in 1 to 3 ms, and sends every error back to Muse with a pointer to where it is, for up to 3 repair rounds.
3. **Five bots play it** in the real engine. A game must be losable, winnable or scorable, and last 10 to 120 s. Blocking problems get one more repair.
4. **What is played is exactly what passed**: the game travels as exact JSON text (`content.game_json`), byte for byte (a key-order bug forced this).

In 10 real Muse runs on Nov 12, Muse wrote 255 to 1,845 characters of custom game logic per game (D31). This is not a reskin.

## 2. Muse agrees the game with you, and says what's new to it (the game anatomy)

Before the build, Muse drafts **"How the game works"**: the core loop, verbs, pieces, state, rules (each with a check), how it ends, timing, randomness, what you share and the theme. Every part says whether it came from you or is Muse's guess, and how familiar it is:

- **Known**: a tested fragment covers it.
- **Approximate**: custom rules built from named engine builtins.
- **New to Muse**: it needs something the engine can't do yet (a share grid, segment collision, joints, rotated shapes, device sensors, live multiplayer or 3D), or Muse has no plan for it.

Familiarity is mechanical, not the model's mood: Studio recalibrates Muse's reply against the real catalog. Calibration took over-flagging of "New to Muse" from 10 of 13 parts to 0 (D33). Muse asks only about guessed parts it isn't sure of; vague requests get concrete picks marked as guesses. After the build, **"Change the game"** maps each message onto the parts it changes ("This changes rule 2 and how it ends.") before rebuilding. The agreed anatomy is saved with the game on that device, so Edit, Remix and Level 2 keep it.

**Speed.** On the fast model a draft takes 4 to 7 s and a change about 3 s; the planner model took 27 to 76 s for the same reads, so we use the fast one (D33).

**Does it break "one sentence, 30 seconds"?** It adds one card and 4 to 7 s. Muse asks questions only on parts it guessed; for most requests the person reads the card and taps Make. We have not measured how many turns a typical person takes.

## 3. What we measured, and how much to trust it

**The eval suite** (`tools/harness-eval`, on `main`): 12 starter requests, from vague ("a game") to specific (a 45-second rover game with three crystal rules), plus two franchise requests, a calm no-fail request and a competitive Group request. Each game is scored by a keyword pre-check, a logic check from the bots' report, and a Muse judge with a strict rubric whose quotes are checked against the game's text.

**Baseline** (real Muse, unchanged pipeline, all 12 requests; D30):

| Measure | Result |
|---|---|
| Produced a game | 12 of 12 |
| Passed the gate | 12 of 12 |
| Must-haves present | 88% (83% verified by a quote) |
| Theme | 1.75 of 2 |
| Custom rule | 1.60 of 2 (5 requests) |
| Feel | 1.83 of 2 |
| First draft valid | 75%, 0.3 repairs on average |
| Time per game | median 99 s (first valid manifest at 72 s); fastest 53 s |

**Where Muse does well:** custom rules ("gravity flips every tap", "colors swap every 10 s"), generic themes (pirates, cooking) and the multi-constraint rover all scored 2 of 2.

**Where it fell short, and what we did:**

- **Specific requests** got 63% of must-haves and theme 1.25, against 100% and 2.00 for vague ones. The more you ask for, the more it misses.
- **Franchise themes** scored 0.5 of 2: "a star wars game" came back as "Glowblade Deflect", and the Harry Potter request turned the snitch into a "golden Swift". The prompts steered away from names. Karthik decided that requested themes are honored by name, and the prompts on `main` now say so (`d80ced9`, `df72dc3`, `07299ab`). That fix has not been re-scored.
- **The calm, no-fail garden** came back with a 50 s lose timer and lives, because both the prompt and the gate require that a run can be lost.

**Anatomy mode** (`run.mjs --anatomy`; D32): 11 of 12 requests ran. It is **not scored**, so it is not a measured improvement. Titles now keep the request ("Star Sword Deflect", "Catch the Golden Snitch"), and the calm garden really is no-fail now, but gate pass fell to 7 of 11 because the gate blocks it and 3 others as "can't lose".

**How much to trust these numbers.**

- One baseline run, not a before-and-after.
- Muse (muse-wonder) both makes and judges the games. The judge varies between passes, so treat changes under about 10 points as noise.
- 12 requests is a small suite.

**The earlier audit** (10 real Muse runs at 15:10, before the eval suite; D31): 6 of 10 first drafts were valid, 6 of 10 games couldn't be lost, and 5 of 10 used made-up feedback syntax. Those mistakes are what the gold set and the gate's repair loop now target.

**How far does it go? Close to limitless, for 2D.** This is the claim to make on stage, and it is true as stated:

- **What Muse can use.** The microgame format (v0.2) gives Muse state, rules with checks, inputs (tap, drag, hold, swipe, pointer anywhere, typed text), timers, an optional deterministic arcade physics layer, a scrolling camera with a fixed HUD, images, SVG and sprite sheets, synthesized sound and music, particles and haptics. Where no fragment fits, Muse writes custom rules from the engine's builtins (D31: 255 to 1,845 characters per game).
- **What that covers.** Word games, grouping puzzles, logic grids, quizzes, adventures, runners, dodgers, stackers, rhythm and reaction games, physics toys. In the audit, 9 of 10 hard ideas fit (D32).
- **What's next, by name.** Seven engine gaps, each one a roadmap item rather than a fuzzy limit: a game-defined share grid, segment collision, joints, rotated shapes, device sensors (tilt and gyro), live multiplayer and 3D ([11-roadmap.md](11-roadmap.md#make-any-idea-true)). Muse knows the list, so a request that needs one is flagged "New to Muse" before the build.
- **What we haven't done yet.** Built and played the 9 expressible ideas, and made the gate genre-aware so calm and puzzle games pass. Say "fits the format", not "we've built it".

**Is the engine the limit?** No. A read-only review found 9 of 10 test ideas (Wordle-style, Connections-style, Queens-style, a crossword and others) can be expressed in the format today; the only gap is a game-defined share grid (D32). None of those 9 has been built and played yet. The real blockers are a prompt that still steers toward reskins and a gate that assumes action games. So the honest line is: "if you can describe it in 2D, Muse can write it; here is the short list of what we're adding next". Don't say "we've built every kind of game".

**One real end-to-end run** (D34): "a bouncy pinball game about fog over the bay" built in 1 fix round, passed the gate, then took 2 revisions and a challenge to 3 friends, in about 3.5 minutes in all.

## 4. The rest of the AI work

- **Briefs.** Ember reads one sentence as mood, energy, competitiveness and audience and writes an editable brief in a median 1.9 s (D4).
- **Content from your community.** Wonder writes a Daily from members' opted-in posts and an icebreaker from guests' intros, naming what it used: "Used 5 of 5 opted-in posts ... Nothing else was read" (D8).
- **Covers and art.** Muse Image paints formula covers in parallel (median 20.2 s, D3). In microgames Muse draws SVG sprites: in 10 runs, 8 games had art, 27 SVGs of 0.3 to 5 KB each, but characters were weak and palettes didn't match (D31). A style-kit prototype (Muse as style director and illustrator) is not in the repo yet (D37).
- **Group Blend.** "Make our Blend game" hands Muse a prompt built from the Group's shared taste.
- **Ranking is not Muse.** The recommender is a hand-written formula. A Muse re-rank term exists but is off by default and in the demo (`FB_RECS_MUSE=1`); a perfect stand-in for it won only 52.6% (D27).

## 5. The brief's four kinds of AI work, mapped

| What the brief names | What Muse does in Whims | Honest strength |
|---|---|---|
| Understand what you're looking for better than a search box | Ember writes an editable brief in about 2 s (D4). The game anatomy turns a sentence into parts, rules and checks, and says what's new to Muse. Search offers "Make it with Muse" when nothing matches. | Strong for games: the anatomy is real understanding with a visible result. Search itself is a list of games, not an AI search. |
| Match you with the right people or communities | The feed ranks by relationship and the board offers Add friend. Group Blend picks games for everyone in a Group and shows a "taste twin". | Moderate. Matching comes from the recommender and the graph, not from Muse; two-person Blends are not built. |
| Coordinate on your behalf | Icebreakers prepare guests before an Event; a Group's Daily gives everyone the same game; Challenge Me and group-chat sessions run on one seed. | Moderate. Challenge Me is in the app but on one device, with bot friends. |
| Create something new with you | Muse writes whole games with new mechanics, agrees them with you part by part, repairs them, and draws art; Ember writes the brief; Image paints covers; bots test. | Strong on the mechanism (D1, D5, D8, D30); the effect on people is untested. |

**Why it would not work without AI.** Without an LLM, there is no game that does what you asked: our keyword template made valid formula games, but one agent judged 6 of 10 off-topic (D7), and a template can't write "gravity flips every tap" at all. Without Muse there is no anatomy to agree, no Daily written from a Group's week and no supply at Facebook's scale.

## 6. What we still haven't shown

- A scored anatomy-mode run, and a re-run of the franchise requests after the theme fix.
- A human judge, not Muse, on the request-match scores.
- A genre-aware gate, so calm and puzzle games can pass (not built).
- A context ablation: the same requests with and without the Group's posts, rated blind ([open-items.md](open-items.md)).
- Whether the gold set improves Muse's games: not measured, and "star wars deflect" retrieves the wrong gold games (Aura Farm and Cake Tower instead of Rift Run).
