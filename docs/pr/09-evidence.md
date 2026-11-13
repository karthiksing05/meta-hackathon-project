# Evidence

*Our own data, with the source of every number and whether it is measured, simulated or reported. Part of the pitch docs; start at [README.md](README.md).*

## How to read this file

Every number has an ID (D1 to D39), a label and a source. Labels:

- **Measured**: we measured it, in the prototype or with real Muse runs.
- **Bot-run**: bots played the games.
- **Simulated**: synthetic people in a simulator. Never real users.
- **Teammate-reported**: a teammate's number we have not reproduced.
- **Estimate**: a judgment or calculation.

No real users were involved anywhere. Sample sizes are small; treat every number as early evidence, not a benchmark. Sections 8.1 to 8.4 were measured against commit `0a3e8f7` on Nov 12 (morning) and describe the formula path; sections 8.5 to 8.8 were added at `6b1cc85` and cover the microgame harness, the recommender, the backend and the build. Where a source is "Slack HH:MM", it is a post in the team channel on Nov 12 (PST).

## Our preliminary data

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
| D7 | Muse against a template baseline (the offline composer, which picks a formula by keyword and fills a template) | Offline: 10 of 10 valid, median 0.068 s (0.043 to 5.971 s), but 2 on-topic, 2 partly, 6 off-topic, paper look in 7 of 10. Muse: 10 of 10 on-topic. Same formula chosen on 8 of 10 prompts. This shows an LLM is needed; it does not show what Facebook context adds. On the formula path, Muse's value over the template was content, context and look; the microgame path (D30, D31) is where Muse also writes the mechanics | Relevance is an estimate (one agent's judgment, not users); timings measured |
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
| D17 | Test suites (rerun with the repo's runners at `0a3e8f7`; superseded by D35) | Runtime: the Node runner reports 318 passed, 0 failed (its main suite prints 310, the figure quoted in Slack); the JavaScriptCore runner reports 308 passed, 0 failed. Kits: pass in both engines, 23 fingerprinted runs identical across engines; 11 of 11 manifests validate. The kit runner prints no test count. Earlier counts (212 and 202 on the Build tracker) are out of date | Measured |
| D18 | Speed on the iOS simulator (formula games) | Warm switch to the next game about 3.6 ms median (1.9 to 9.7 ms) against a 50 ms target; game start once warm 17 to 27 ms; 57 to 60 fps. Memory not measured; not yet measured on a phone | Teammate-reported (simulator); no log in our data folder, not reproduced by us |

### 8.4 Product facts and simulations

| ID | Metric | Value | Label |
|---|---|---|---|
| D19 | Places in the app with Muse Curios | At `0a3e8f7`: 9 in all. 6 distribution surfaces: Home feed posts, Stories, Reels and the Video tab, Groups (page and tab), Events, profiles. 3 entry points: the Curios tab, Notifications, the Library in the Menu. Messenger and Search: 0 then. Since the collaboration batch (13:08), Messenger chats (Challenge Me, group-chat sessions) and Search also carry Muse Curios, on one device | Measured (code count at `0a3e8f7`); the later surfaces from the merged batch, not recounted |
| D20 | Feed candidate weights (the old feed, used when the recommender is off) | Group Daily 3.0, friend's Burst 2.2, Event icebreaker 2.0, new nearby 1.8, Group member's Burst 1.6, next level 1.2, popular 0.8, your own 0.6 | Shipped configuration, not a result |
| D21 | Recommender simulation (earlier version, 11:28; superseded by D27 to D29) | 5 synthetic worlds of 90 people for 14 days, about 20% clickbait. Bait-averse users: clickbait share 36% today, 49% when ranking on taps alone, 14% with the social reward; pages per session 5.9 to 7.2. Bait-loving users: 6.8 to 10.2 pages | Simulated; teammate-reported, not reproduced by us |
| D22 | Code size | 68 Curios Swift files (20,908 lines) in an app of 183 Swift files (53,101 lines), plus 12,332 lines of runtime JS, CSS and HTML; 13 seed games; 6 formulas, 55 concepts, 8 looks | Measured |
| D23 | Installs | Builds running on 4 team iPhones (iOS 18.6 and iOS 26), morning of Nov 12. See D38 for the current state | Teammate-reported (installs, not usage) |
| D24 | Rust/WASM engine for a new format | At the time: 124 tests pass; 50 seeds times 1,000 random inputs per test game gave 0 runtime errors; state hashes match between native and WASM. Now v0.2 with 200 tests, and in the app (D35) | Teammate-reported, not reproduced by us |
| D25 | Demo world (in the app; the server copy was removed in `0636df3`) | 1 Group, 1 Event, 10 newcomers with intros. The Group's 2,814 members, the picnic's 46 going, mutual-friend counts on board rows, and the play and like counts on seed games are synthetic | Synthetic |

### 8.5 The microgame harness (games made from scratch)

| ID | Metric | Value | Label | Source |
|---|---|---|---|---|
| D30 | Harness eval baseline: 12 starter requests, real Muse, unchanged pipeline | Produced a game 12 of 12; gate pass 12 of 12; must-haves 88% (83% verified by quote); theme 1.75 of 2; custom rule 1.60 of 2 (n = 5); feel 1.83 of 2; first draft valid 75%; 0.3 repairs on average; median 99 s per game (first valid manifest at 72 s); fastest 53 s (Flipfall Sky). By specificity: specific 63% must-haves and theme 1.25; "some" 100% and 2.00; vague 100% and 2.00. Franchise requests: theme 0.5 of 2 ("Glowblade Deflect" for Star Wars, theme 0; the snitch became a "golden Swift", must-haves 25%). Calm no-fail garden: came back with a 50 s lose timer and lives (must-haves 50%, rule 0). Custom rules, generic themes and the multi-constraint rover: 2 of 2 | Measured. Muse (muse-wonder) both makes and judges; the judge varies, so changes under about 10 points are noise. One run, not a before-and-after | Local scorecard from `tools/harness-eval` (not committed: results stay out of the repo); suite `tools/harness-eval/suite/starter.json`; Slack 16:22 thread |
| D31 | Earlier real-Muse microgame runs (10, at 15:10) | 6 of 10 first drafts valid; 6 of 10 couldn't be lost; 5 of 10 used made-up feedback syntax; Muse wrote 255 to 1,845 characters of custom logic per game. Art: 8 of 10 games had art, 27 SVGs of 0.3 to 5 KB; games with art were 90 to 160 KB against 11 to 17 KB without; characters weak, palettes mismatched | Measured | Slack 16:11; 16:22 thread audit; 15:50 thread |
| D32 | Anatomy-mode run and the expressiveness audit | Anatomy mode: 11 of 12 ran, **not scored**; titles keep the request ("Star Sword Deflect", "Catch the Golden Snitch"); the calm garden is really no-fail, but gate pass fell to 7 of 11 because the gate blocks it and 3 others as "can't lose". Audit: 9 of 10 test ideas (Wordle-style, Connections, Queens, crossword and others) are expressible in the format; the only gap is a game-defined share grid; none of the 9 has been built or played | Anatomy: local prototype run. Audit: a read-only review (estimate) | Slack 17:19 handoff; 16:22 thread |
| D33 | Anatomy speed and calibration | Fast model: 4 to 7 s per draft, about 3 s per change; the planner model took 27 to 76 s. Over-flagging of "New to Muse" fell from 10 of 13 parts to 0 after calibration | Measured | Slack 16:22 thread; docs/BUBBLES.md 7.13 |
| D34 | One real end-to-end run in the app | "a bouncy pinball game about fog over the bay": built in 1 fix round, passed the gate, then 2 revisions and a challenge to 3 friends, about 3.5 minutes in all | Measured (one run) | Slack 15:44 |

### 8.6 The recommender (Kevin)

All of these are on synthetic people in a simulator: 90 people (bait lovers, balanced, bait-averse), 50 games plus 3 new a day, 14 days. `docs/RANKING.md` says the results "show which way things move, not how much they'd move with real users".

| ID | Metric | Value | Label | Source |
|---|---|---|---|---|
| D27 | Interleaving | The formula wins **70.3%** of decided sessions against today's feed (95% CI 68 to 72%, p < 0.001; 74.4% in week 2), over 3 synthetic worlds with 3,780 sessions per control. It was 68.5% (CI 67 to 70%) before a repeat-window bug fix. It **loses** to its own greedy version, 47.0%, and ε-greedy beats it on payoff for 2 of 3 personas; interleaving can't see session length or the value of exploration. A perfect stand-in for the optional Muse re-rank term wins 52.6%, a hostile one 47.0% | Simulated | `docs/RANKING.md` §2.4; Slack 15:31 |
| D28 | Joy and property tests | Joy per page for bait lovers: formula 0.411, today's feed 0.239, most-popular 0.201. Bait-averse people: joy 0.310 and the longest sessions (8.2 pages). Property tests over about 20,000 pages: the repeat window and slop guard hold 100%; bait-averse people stay within 5 hooky games per 10 pages in 88.5% of windows, against 67.7% with the guard off | Simulated | `docs/RANKING.md` §2.1, §2.2 |
| D29 | Group Blend | Geometric mean plus a misery floor plus plus-only fairness. Worst-off member's enjoyment: 0.31 (random) to 0.489. Games everyone enjoys: 8.7% to 32.0%. Best of the methods tried, but within noise of plain averaging. 240 synthetic Groups | Simulated | `docs/RANKING.md` §2.6 |
| D29a | Design benchmark | 10 rows and 39 cited sources (YouTube multitask, Meta "worth your time", Spotify calibration, LinkedIn LiRank, Kuaishou on-device, Masthoff). The bot-gate prior and per-person bait lean have no published counterpart and are unvalidated | Literature review | `docs/RANKING.md` §3 |

### 8.7 Backend, build and tests

| ID | Metric | Value | Label | Source |
|---|---|---|---|---|
| D35 | Tests at integration | Engine 200; runtime 600 of 600 in Node and 590 of 590 in JavaScriptCore; authoring gate 20 of 20; art and sound 165; gold set full gate 36 of 36 (20 old plus 16 gold); recommender sim 127 of 127 in Node and JSC | Measured (teammate runs, not rerun for this doc) | Slack 14:53 (Artem), 15:02; 16:11 thread; Kevin's 14:53 thread |
| D36 | Backend on Prod | api and games servers live with auto-deploy on push to `Prod`; `/readyz` returns database ok and storage ok; 14 read-only route checks passed; the recommender runs unchanged in Go (goja) and a golden test matches Node; search reorders the top 50 matches 60/40 text-to-taste; `POST /v1/blend` and `/v1/generate` live. **No real traffic, and server generation has never completed a real end-to-end run** (at 16:15 it had been tested only with a scripted Muse). Generation limits: signed in only, 1 job per person, 6 an hour, 2 at a time overall, 10-minute cap | Measured by Max (route checks); live generation unmeasured | Slack 15:03, 16:15, 16:51; `backend/README.md` |
| D37 | Style kit prototype (Bayan) | On Cable Car Catch, one drawing compiles into 8 looks; all 24 assets are 1.4 to 3.6 KB and pass `sanitizeSvg`; 5 real Muse runs cost $0.79 in total (about $0.15 a style); director 10 to 13 s, illustrator 23 to 28 s, critique 10 to 23 s; the critique fixed HUD clutter in 3 styles but missed a dark lantern on noir. Not in the repo; not run on iOS; only Cable Car is set up; check thresholds are first guesses. A blind human-judged test (5 styles, 15 pairs) was running with no results | Measured, on an uncommitted prototype | Slack 15:50 thread (Bayan); 17:19 thread |
| D38 | Phones | `ee12c04` is installed on Karthik's iPhone 14 Pro, Artem's iPhone 17 Pro and Bayan's iPhone 16. Kevin's phone is on `e30f0a3` (3-device limit on the free account). Nothing from `7aa67a8` to `6b1cc85` is confirmed on any phone | Teammate-reported | Slack 15:44 thread |

### 8.8 App content we counted ourselves

| ID | Metric | Value | Label | Source |
|---|---|---|---|---|
| D39 | "Made with Muse" stamps on seed games | 22 of the 33 seed files in `FacebookClone/Bubbles/Seeds` carry a studio stamp with Muse model names and a time between 28.0 and 55.0 s, dated 2026-11-12. The app shows these as "Made with Muse in N s". The games were written by build agents, not by Muse | Measured (file count at `6b1cc85`) | The seed files; `BubbleStore+Screens.swift` `studioStampText` |
