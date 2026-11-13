# Evidence

*Our own data, with the source of every number and whether it is measured, simulated or reported. Part of the pitch docs; start at [README.md](README.md).*

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
| D19 | Places in the app with Whims | 9 in all. 6 distribution surfaces: Home feed posts, Stories, Reels and the Video tab, Groups (page and tab), Events, profiles. 3 entry points: the Whims tab, Notifications, the Library in the Menu. Messenger and Search: 0 so far | Measured (code count) |
| D20 | Feed candidate weights | Group Daily 3.0, friend's Burst 2.2, Event icebreaker 2.0, new nearby 1.8, Group member's Burst 1.6, next level 1.2, popular 0.8, your own 0.6 | Shipped configuration, not a result |
| D21 | Recommender simulation | 5 synthetic worlds of 90 people for 14 days, about 20% clickbait. Bait-averse users: clickbait share 36% today, 49% when ranking on taps alone, 14% with the social reward; pages per session 5.9 to 7.2. Bait-loving users: 6.8 to 10.2 pages | Simulated; teammate-reported, not reproduced by us |
| D22 | Code size | 68 Whims Swift files (20,908 lines) in an app of 183 Swift files (53,101 lines), plus 12,332 lines of runtime JS, CSS and HTML; 13 seed games; 6 formulas, 55 concepts, 8 looks | Measured |
| D23 | Installs | Builds running on 4 team iPhones (iOS 18.6 and iOS 26) | Teammate-reported (installs, not usage) |
| D24 | Rust/WASM engine for a new format | 124 tests pass; 50 seeds times 1,000 random inputs per test game gave 0 runtime errors; state hashes match between native and WASM | Teammate-reported, not reproduced by us; not in the app |
| D25 | Demo world | 1 Group, 1 Event, 10 newcomers with intros. The Group's 2,814 members, the picnic's 46 going, mutual-friend counts on board rows, and the play and like counts on seed games are synthetic | Synthetic |
