# Games feed ranking

How the games feed is ranked, what that changes, and how we check it without training.

- **The ranker:** `FacebookClone/Bubbles/Recommend/game-recs.js` (v0.5). It is plain JavaScript that
  runs on the phone in JavaScriptCore.
- **The direction (Karthik):** hand-written formulas with readable weights, refined by continual
  on-device learning. Nothing is pretrained, and nothing is fitted to logs.
- **The Muse layer** is optional and off by default.
- **Tools:** the checks and simulators are in `tools/recs-sim/`. The research behind section 3 is in
  `tools/recs-sim/BENCHMARKING.md` (how companies evaluate recommenders) and in section 3 itself
  (how each part of the design compares to published work).

Written by Claude (AI agent for Kevin). All results are on synthetic people unless marked
otherwise. They show which way things move, not how much they'd move with real users.

---

## 1. What changes

### 1.1 The unit is a playable game, so the feed can see whether a page paid off

A post or a video tells a feed whether you looked at it. A game tells us more: whether you started
it, finished it, replayed it, quit halfway, challenged a friend or remixed it. The ranker splits every
page into two separate questions:
- **Grab:** did the page pull you in?
- **Satisfaction:** did it pay off?

Clickbait is high grab and low satisfaction. Slop is low satisfaction however it grabs.

| Signal | Where it comes from | How it enters the formula |
|---|---|---|
| Takeover (you started playing) | feed page | grab = 1 |
| Watched the preview 6 s or more / skipped in under 1.2 s | feed page | grab = 0.35 / 0 |
| Finished a run | game | satisfaction +1 |
| Replays | game | satisfaction +1.5·ln(1 + replays) |
| Quit mid-run | game | satisfaction −1.5 |
| Ended the session on this page | feed | satisfaction −0.75; grab penalty if not played |
| Saved, floated | page, Library | satisfaction +3 each |
| Add friend from a game | Bubble Board | satisfaction +4 (the strongest single signal) |
| Remixed, liked, board opened | page | +2, +1, +0.5 |
| Challenge sent, accepted, rematch; group challenge; share; co-make | `bubbleSocialSignal` | +3 each kind |
| Group-chat play, game night, about-me play, story or lesson shared | `bubbleSocialSignal` | +2 each kind |
| Any of these away from the feed (Messenger, a Group, a profile) | `bubbleSocialSignal`, `bubbleSaveChanged` | half a page of satisfaction evidence, no grab |
| Bot playtest results (skill vs score, run length) | Studio's bot gate | the new game's satisfaction prior |
| Manifest: formula, mood, energy, competition, look, scope | the game's manifest | 24 features for taste, calibration and cold start; a hook prior |
| Who you played with | social moments | counted for Blends and taste twins (not yet in the score) |

### 1.2 The feed formula

For person u and candidate game i. Every weight is named in `defaults()` in `game-recs.js`.

```
score = 0.6·logit(θg) + 1.5·logit(θs)        grab and satisfaction: one Thompson draw each from Beta posteriors
      + 1.2·ramp·cos(taste_u, x_i)            taste; ramp = pages/(pages+5); x_i = the game's 24 features
      + b_u·(2·hook_i − 1)                    your bait lean
      − 3·P(θs < 0.35)·(1 − σ(b_u))           slop guard
      + ln(reason weight) − 0.9·ln(1 + times shown)
      + museTerm_i                            0 unless the Muse layer is on (1.6)

pick  = argmax (1 − 0.5)·σ(score) − 0.5·Σ_d ω_d·KL(target_d ‖ last 10 pages_d)
        ω: formula 1, mood 0.6, hook level 1; KL smoothed with α = 0.01

caps    untested games ≤ 0.15 + 0.25·σ(b_u) of any 10 pages; no game twice within 4 pages
```

- **Paying off counts 2.5× grabbing** (1.5 against 0.6). That's Kevin's call: lean away from bait.
- **The bait lean b_u** starts at −1, which leans away from hooky games. It moves with how hooks
  actually work on you, and is capped at +1.

### 1.3 Priors for a new game

- **Grab:** the global takeover rate, tilted by the manifest's hook prior, worth 3 pages.
- **Satisfaction:** from the bot gate: 0.35 + 0.25·max(0, corr(bot skill, score)) + 0.15·run-length fit,
  worth 4 plays. A game whose bots can't tell skill apart, or whose runs last 2 seconds, starts low.
- **While the game is young,** 40% of its satisfaction comes from its 5 most similar games (by the
  24 features).

### 1.4 The online update after each page

```
g = 1 if you played or engaged | 0.35 watched ≥ 6 s | 0 skipped < 1.2 s | else 0.1
r = 1·finished + 1.5·ln(1+replays) + 3·saved + 3·floated + 4·Add friend + 2·remixed
    + 1·liked + 0.5·board opened − 1.5·quit mid-run − 0.75·session ended here + Σ social moments
s = σ(r − 0.5)
grab α,β += g, 1−g;   satisfaction α,β += s, 1−s;   all evidence × 0.97 per day
taste_u ← 0.97·taste_u + (g·s − your average)·x_i
b_u = clamp(−1 + 5·(your grab-vs-hook slope − everyone's) + 6·(your sat-vs-hook slope − everyone's), −2.5, 1)
```

The slopes come from ridge regressions on 2·hook − 1, shrunk toward everyone's by 8 pages.

### 1.5 Group Blend and pairs

For members u of a Group (or two people, for Challenge Me), and game i:

```
r_ui  = σ(1.0·logit(sat_i) + 0.8·ln(share_u[formula]·7) + 0.5·Σ mood_i·ln(share_u[mood]·4)
          + 0.2·ln(share_u[look]·8) + 0.6·b_u·(2·hook_i − 1))
score = mean_u ln r_ui                       geometric mean: the chance everyone enjoys it
      + 0.5·max(0, 1 − skill spread/0.3)     fairness, plus only (Kevin's call)
      + 0.8·Σ_u w_u·r_ui                     boost the members served least so far
      + 0.4·[made for this Group] + 0.3·[made by a member] − 0.25·(earlier picks of this formula)
drop i if any member's r_ui < 0.12 (misery floor)
```

### 1.6 The optional Muse re-rank (off by default)

**Off for the demo (Karthik's call, 2026-11-12).** Nothing in the demo path turns it on; only
`FB_RECS_MUSE=1` does. The formula alone is what we present. The layer stays in the code to build on
later.

- **Prompt:** Ember gets the formula's top 10 games, shuffled, and your last 8 plays, described by
  game features only. No names or people go to Muse.
- **Checking the reply:** only games from the request count, each once. Made-up IDs are dropped and
  counted.
- **The term:** Ember's order enters the score as one term, `museTerm = 0.6·(1 − 2ρ/(K−1))` for its
  rank ρ of K, hard-capped at ±0.6. The order expires after 30 minutes. The formula still decides, and
  every guard still holds.
- **"Why" lines:** each pick keeps the formula's own line (`why`) and adds Ember's (`museWhy`).
- **On the phone:** `FB_RECS_MUSE=1` calls Ember through the app's `MuseClient`. It calls at most
  every 10 minutes, off the main thread, with an 8-second timeout. If anything fails, the feed stays
  as the formula ranked it.

### 1.7 Handwritten vs learned, and what's parked

- **All handwritten:** every weight above.
- **Learned on the device, per person:** the two posteriors per game, the taste vector, the bait lean
  and the calibration targets.
- **Parked:** learned predictors (the Facebook-style value model stays a simulator), two-tower
  retrieval, embeddings and fitted weights.
- **Next:** fragments and bot-gate results as named inputs, and a co-player bonus in Blends.

---

## 2. How we check it without training

There are no real users yet. So we test what each part promises, compare the formula with simple
published baselines, and run the online test companies use first, interleaving. All of it runs on
synthetic people from `tools/recs-sim/sim.js`:
- 90 people, 30 of each kind:
  - **lovers:** hooky games grab them, and they enjoy them;
  - **balanced:** hooks grab them, but quality is what they enjoy;
  - **averse:** hooks barely grab them, and shallow ones annoy them.
- 50 games plus 3 new ones a day. About a fifth are clickbait and a tenth are duds.
- 14 days.

Nothing was tuned to these tests: every run uses the v0.5 defaults. Where a test suggests a change,
it's listed in section 4 as a decision, not made.

### 2.1 Property tests (`node tools/recs-sim/props.js --break`)

The properties are checked on every page of every session (2 worlds, about 20,000 pages). The "break
it" column runs the same tests with that part switched off, which shows each test would catch a
regression.

| Property | Holds | With the part off |
|---|---|---|
| No game twice within 4 pages | 100% | 91.8% (repeat window off) |
| A game 90% likely to be slop never makes a top 3 while 3 games look fine | 100% (3,111 rankings) | 100% (the quality term alone keeps it out) |
| Untested games stay within their cap in any 10 pages | 99.7% | (no cap) |
| A bait-averse person sees at most 5 hooky games in any 10 pages | **88.5%** of windows | **67.7%** (bait guard off) |
| A new game reaches a feed after launch | all 78 games; median wait 51 pages shown, p90 213 | median 20, p90 60 (bait guard and cap off) |

- **The hooky property is soft, not a guarantee:** 88.5% of windows.
- **The untested-game cap delays new games:** that's the price of protecting bait-averse people
  (section 4).
- **Unit checks:** 127 more in `node tools/recs-sim/run-node.js`, which run in Node and
  JavaScriptCore.

### 2.2 Against simple published baselines (`node tools/recs-sim/eval-bench.js`)

Each policy gets its own copy of each world and learns on its own (3 worlds). Numbers are for the
second week, after learning.
- **Joy per page:** what people actually enjoyed.
- **Regret:** the oracle's expected payoff minus the page shown. The oracle knows each person's true
  chance of playing × enjoyment.
- **Fav formula:** the share of pages from the person's own favorite kind of game.

| Policy | Lover joy / regret | Balanced joy / regret | Averse joy / regret | Averse pages per session | Slop (lover / averse) | Fav formula (balanced) |
|---|---|---|---|---|---|---|
| Today's feed (weighted random) | 0.239 / 0.477 | 0.207 / 0.447 | 0.163 / 0.400 | 6.3 | 32.9% / 31.0% | 13.5% |
| Most popular (MostPop) | 0.201 / 0.526 | 0.201 / 0.453 | 0.196 / 0.386 | 6.5 | 25.2% / 24.7% | 13.9% |
| ε-greedy bandit, ε = 0.1, global mean value | **0.515 / 0.188** | **0.427 / 0.205** | 0.257 / 0.304 | 7.2 | 5.4% / 5.2% | 15.7% |
| **Formula (v0.5)** | 0.411 / 0.301 | 0.323 / 0.334 | **0.310 / 0.272** | **8.2** | 14.3% / 6.5% | **21.1%** |
| Formula, Thompson off (greedy) | 0.446 / 0.270 | 0.347 / 0.302 | 0.323 / 0.240 | 7.5 | 8.4% / 3.6% | 19.3% |

What this says, honestly:
- **The formula beats today's feed and MostPop for every kind of person,** by a wide margin (lover
  joy per page 0.411 vs 0.239 and 0.201).
- **A plain ε-greedy bandit on each game's mean value beats the formula for lovers and balanced
  people** (0.515 vs 0.411; 0.427 vs 0.323). It also shows less slop (5.4% vs 14.3% for lovers).
- **The formula wins for bait-averse people:** joy 0.310 vs 0.257, regret 0.272 vs 0.304, and the
  longest sessions of any policy, 8.2 pages.
- **The formula is the most personal:** 21–23% of pages come from each person's favorite formula,
  against 14–19% for ε-greedy.
- **Why ε-greedy does so well here (inference):**
  - It estimates exactly the simulator's yardstick (grab × satisfaction).
  - It starts every game optimistic, so new games get tried at once.
  - In this world, game quality matters more than personal taste.

  A real catalog of user-made games may be thinner per game and more about taste. That's untested.
- **Thompson sampling costs payoff here too:** greedy beats it for all three kinds, by 0.01–0.04 joy
  per page. With 90 people sharing evidence on each game, exploring is cheap to get from others.

### 2.3 Which parts earn their place (ablations, same runs)

Joy per page in week 2, with one part switched off:

| | Lover | Balanced | Averse |
|---|---|---|---|
| Full formula | 0.411 | 0.323 | 0.310 |
| Calibration off | 0.408 | 0.305 | 0.298 |
| Bait lean and guards off | 0.410 | **0.347** | **0.286** |
| Cold start off | **0.364** | 0.299 | 0.287 |
| No reason prior | 0.397 | 0.322 | 0.290 |
| Thompson off (greedy) | 0.446 | 0.347 | 0.323 |
| Greedy, calibration and bait off | 0.475 | 0.402 | 0.325 |
| …and grab weight = satisfaction weight | 0.483 | 0.398 | 0.281 (slop 14.9%, vs 6.4%) |

- **Cold start helps everyone** (−0.05 for lovers without it).
- **Calibration helps a little everywhere.**
- **The bait lean is a trade:** it helps averse people (+0.024) and costs balanced people (−0.024).
  That's as designed.
- **The 2.5× satisfaction weight** keeps slop down: equal weights more than double it for averse
  people.
- **Not from any one part:** the gap to ε-greedy comes from Thompson's exploration plus the formula's
  overall shape.

### 2.4 Interleaving (`node tools/recs-sim/interleave-sim.js --seeds 3`)

The on-device test, run on synthetic people (3 worlds, 3,780 sessions per control). In each session,
team-draft merges the formula's picks (A) with a control's (B). A page earns its side a point when it
was satisfying: a finish, replay, save or social moment. A grab alone isn't a point. A session goes to
the side with more points.

| Formula against | Formula's share of decided sessions | 95% interval | Sign test p |
|---|---|---|---|
| Today's feed | **70.3%** (74.4% in week 2) | 68–72% | < 0.001 |
| Itself without calibration | 54.9% | 53–57% | < 0.001 |
| Itself without cold start | 53.4% | 51–55% | 0.001 |
| Itself without the bait lean | 49.8% | 48–52% | 0.84 |
| Itself without Thompson (greedy) | **47.0%** | 45–49% | 0.005 |

Interleaving measures preference within a session. It can't see two things:
- **Session length:** that's where the bait lean pays off, hence 49.8%.
- **The value of exploration:** both sides learn from the same pages, so the exploring side pays the
  cost and the greedy side gets the benefit. This is a known limit: interleaving measures preference,
  not total consumption [39].

On the phone it runs with `FB_RECS_INTERLEAVE=1` (or `=noMuse`, `=noCalibration`, and so on). The
tally is in `app.interleaveStats()`.

### 2.5 Learning curves

Regret per page by day, from 2.2. The formula learns, but the global ε-greedy learns faster:

| | Day 1 | Days 2–3 | Days 4–7 | Days 8–14 |
|---|---|---|---|---|
| Formula, lover | 0.469 | 0.395 | 0.338 | 0.301 |
| Formula, balanced | 0.407 | 0.373 | 0.347 | 0.334 |
| Formula, averse | 0.304 | 0.286 | 0.276 | 0.272 |
| ε-greedy, lover | 0.321 | 0.264 | 0.218 | 0.188 |
| Today's feed, lover | 0.449 | 0.479 | 0.466 | 0.477 |

### 2.6 Group Blend (`node tools/recs-sim/groups.js --seeds 3`)

240 synthetic Groups of 4–6 people, 10 games each, scored with members' true enjoyment.

| Strategy | Joy | Worst-off member | Games everyone enjoys |
|---|---|---|---|
| Random games | 0.396 | 0.309 | 8.7% |
| Average enjoyment | 0.643 | 0.483 | 31.0% |
| Least misery | 0.627 | 0.481 | 31.7% |
| Geometric mean | 0.642 | 0.483 | 31.4% |
| **Geometric + fairness plus (default)** | 0.643 | **0.489** | **32.0%** |

- **Every Blend strategy** far beats random games.
- **Among the strategies,** the differences are within noise (± about 0.006). Ours is best on the
  worst-off member and on games everyone enjoys, but only slightly.

### 2.7 The Muse term

The real Ember can't run in the simulator. So `interleave-sim.js --muse` stands in four kinds of
Ember and interleaves the formula with the Muse term against the formula alone:

| Stand-in Ember | Share of decided sessions | p |
|---|---|---|
| Knows each person's true payoff | 52.6% | 0.014 |
| Knows it roughly | 51.3% | 0.23 |
| Orders at random | 50.0% | 1.0 |
| Orders worst first | 47.0% | 0.004 |

- **At w = 0.6, the cap does its job both ways:** even a perfect Ember adds little, and a hostile one
  does limited harm.
- **Unit checks:**
  - made-up and repeated IDs are dropped and counted;
  - the candidate order is shuffled before Ember sees it;
  - Ember can't lift a game people quit over one they finish (20 of 20 seeds);
  - the cap holds at any weight;
  - stale orders expire.
- **On the phone:** the real test is `FB_RECS_INTERLEAVE=noMuse` with `FB_RECS_MUSE=1`, plus the
  made-up-ID rate in the debug summary.

### 2.8 What we can and can't conclude

**Can:**
- The formula clearly beats today's feed and a popularity baseline, in separate worlds and in
  interleaving.
- Its guards do what they promise: the property tests pass, and fail when the guard is switched off.
- It protects bait-averse people best of everything tested.
- It learns each person's taste online with no training.
- The Muse term can't do much damage.

**Can't:**
- That it beats a simple ε-greedy bandit. In our own simulator it doesn't, for two of the three
  kinds of people.
- That Thompson sampling helps. It costs payoff in every simulator test.
- Anything about real users. The people, the payoff and the games are all synthetic, and the
  simulator rewards grab and satisfaction equally while the formula doesn't.
- That calibration's variety matters to people. The simulator has no boredom.

---

## 3. How this compares to published work

### 3.1 Design benchmark

Each piece of the formula against its closest published counterpart. **Match** means the same idea
and shape; **simplify** means the same idea, cheaper or hand-set; **differ** means a different idea, or
no counterpart found. *(inference)* marks our reasoning, not a published result.

| # | Our piece | Published counterpart | Verdict | Why, and what we give up |
|---|---|---|---|---|
| 1 | Grab vs satisfaction as two targets, hand-set weights | YouTube's multitask ranker splits engagement from satisfaction objectives, with manually tuned weights [1]. YouTube's "valued watch time" counts only videos rated 4–5 stars [2]. Meta sums predicted actions with weights and asks "worth your time?" [3][4]. Netflix warns that clicks alone favor clickbait [5]. | Match (idea), simplify (machinery) | Same split. They predict many heads with neural nets and calibrate against surveys; we keep two Beta posteriors and use behavior only. The 2.5× ratio is our prior *(inference)*. |
| 2 | Per-person bait lean and slop guard | Facebook's clickbait classifiers (page-level, then post-level) [6][7]. YouTube demotes borderline content (it reports a 70% watch-time drop, self-reported) [2]. Meta says viewer-specific ranking weights are still research [3]. | Simplify (detection), differ (per-person lean) | Published guards are global. A tolerance learned per person has no published counterpart that we found. |
| 3 | Thompson sampling with Beta priors | Chapelle and Li: Thompson sampling is a strong baseline [8]. Li et al. (Yahoo): contextual bandits [9]. LinkedIn's LiRank: Thompson sampling over a Bayesian last layer, +0.06% DAU on Feed [10]. | Match (method), simplify (form) | Non-contextual, per game. Fractional rewards in a Beta and the 0.97/day decay are heuristics *(inference)*. Our simulator suggests the exploration costs payoff (2.2). |
| 4 | Calibration: greedy KL re-rank over the last 10 pages | Steck, RecSys 2018 [11]. Spotify's KL-calibrated slates with a bandit-learned target: +3.93% impression-to-stream against a Steck baseline [12]. | Match | Same objective and smoothing. Spotify learns each user's target mix; ours is set by formula. |
| 5 | Cold start: manifest features, borrowing from similar games, bot-gate quality prior | DropoutNet [13] and MeLU [14] (content and meta-learning cold start). Pinterest found content features underweighted for cold items [15]. Meta's SocRipple boosts new items through the creator's network [16]. | Match (content, similar items), differ (bot gate) | No published counterpart for a playtest-bot quality prior. It's new, and it's unvalidated whether bot results predict human satisfaction. |
| 6 | Decayed per-page updates on the phone | ByteDance's Monolith (real-time training) [17]. Kuaishou's tiny on-device re-ranker using just-watched feedback: +1.28% effective views, +8.22% likes, +13.6% follows [18]. | Simplify | The closest counterpart is Kuaishou's on-device model. Ours learns a handful of numbers, not a network. |
| 7 | Social moments as rewards | Meta's 2018 "meaningful social interactions" shift [19]. LinkedIn's PYMK discounts overloaded recipients (overloaded recipients down 50%) [20]. Snap's GraFRank friend ranking [21]. | Match (spirit), simplify (weights) | Our 1–4 weights are hand-set; Meta calibrates against what people say. No recipient-overload check for Add friend yet (section 4). |
| 8 | Cap on untested games, repeat window | TikTok avoids back-to-back videos with the same sound or creator, and adds some outside your interests [22]. Fairness of exposure (Singh and Joachims, KDD 2018) [23]. | Simplify | A hard slot cap and repeat block instead of optimized exposure. Tying the cap to the bait lean is ours. |
| 9 | Group Blend: geometric mean, misery floor, plus-only fairness | Masthoff: the multiplicative rule is the most promising, and people avoid misery [24]. Rank-sensitive fairness (Kaya et al., RecSys 2020) [25]. Pareto approaches [26]. Spotify Blend chose "maximize the joy" [27]. | Match (product rule, floor), simplify (fairness) | Our fairness isn't rank-sensitive, so one member's favorites can cluster at the top. |
| 10 | Optional LLM re-rank as one capped term | LLM rankers are biased by candidate position and popularity [28]. Netflix GenRec replaces the ranker with an LLM-backed one [29]. | Match (caution), differ (role) | The cap and shuffled input are our safety design, not a published pattern. Netflix bets on the LLM; we keep it advisory. |

**Safe phrasing:** each term follows a published idea. The specific numbers are hand-set priors that
we test on personas.

### 3.2 Evaluation methods: what companies use and what we did

| Method | Who uses it | What we did |
|---|---|---|
| Interleaving (team-draft) | Netflix: over 100× fewer users than its most sensitive A/B metric [30]. Airbnb: a 50× speedup and 82% agreement with A/B results, crediting bookings, not clicks [31]. Spotify: 10–100× [32]. | Built on the phone; credits satisfaction, not grabs; run on personas (2.4). |
| Behavioral and property tests | RecList [33] | 5 properties plus break-it runs (2.1), and 127 unit checks. |
| Simulation with known tastes | RecSim [34], KuaiSim [35] | Separate worlds, regret against an oracle, learning curves (2.2, 2.5). |
| Simple published baselines | MostPop; ε-greedy (Li et al.'s comparison [9]; Chapelle and Li [8]) | Both, at defaults (2.2). |
| Offline replay and off-policy evaluation | Li et al. replay [36]. Pinterest's offline replay found over 90% of the ideas that won online, against 25% for MAP [37]. | Not yet. The event contract logs `propensity` and `team` so replay can run on real logs (`docs/RECOMMENDER_BACKEND.md`). |
| Fully observed public data | KuaiRec: 1,411 × 3,327, 99.6% dense, short videos [38] | Not run: its host isn't reachable from our workspace, and it's video, not games. |
| Group strategies | Masthoff's average, least misery and multiplicative rules [24] | Compared in 2.6. |
| LLM ranker checks | Position and popularity bias [28] | Shuffled input, made-up-ID rate, a capped term, stand-in Embers (2.7). |
| Survey-based value | Facebook's "worth your time" [4]; YouTube's ratings [2] | Not built. A one-tap "worth it?" after a run would ground satisfaction (section 4). |

---

## 4. Decisions these results raise (for Kevin and Karthik; nothing changed)

1. **Thompson sampling costs payoff in every simulator test** (0.01–0.04 joy per page; 47% in
   interleaving). The options:
   - Keep it, because real per-game evidence will be thinner than the simulator's 90 people sharing.
   - Temper it.
   - Use greedy posterior means with an optimistic start, the thing that makes ε-greedy strong here.
2. **ε-greedy on mean value beats the formula for lovers and balanced people.** One option is to test
   a `g·s` value term in place of the logit sum, keeping the slop guard and bait lean. The check
   would be against the property tests and interleaving, not this simulator alone.
3. **The untested-game cap slows new games** (median 51 pages vs 20). That matters for makers seeing
   their first plays: a fixed minimum of first impressions per new game would help.
4. **The Muse weight w = 0.6 is safe but small.** Raise it only if on-device interleaving against
   `noMuse` shows wins with real Ember.
5. **Add friend has no recipient-overload check.** LinkedIn found it matters for popular people.
6. **A one-tap "worth it?" after a run,** as Facebook and YouTube use surveys, would give
   satisfaction a ground truth.

---

## Appendix: running it

```sh
node tools/recs-sim/run-node.js            # 127 checks (Node); tools/recs-sim/run-jsc.sh for JavaScriptCore
node tools/recs-sim/props.js --break       # property tests (2.1)
node tools/recs-sim/eval-bench.js --ablate # baselines, regret, learning curves, ablations (2.2, 2.3, 2.5)
node tools/recs-sim/interleave-sim.js      # interleaving against every control (2.4); --muse for 2.7
node tools/recs-sim/groups.js              # Group Blend strategies (2.6)
node tools/recs-sim/sim.js --seeds 5       # each stage against today's feed (the earlier write-up)
node tools/recs-sim/fb-sim.js --seeds 6    # the Facebook-style value model (simulator only)
```

The numbers above are from recs 0.5.0 on 2026-11-12. Version 0.5 also fixed a repeat-window bug: a
short feed blocked too little, so early pages could repeat. Interleaving against today's feed was
68.5% before the fix and 70.3% after.

## Sources

Each source is marked opened (we read the page or paper), abstract (we read only the abstract),
mirror (we read a copy hosted elsewhere) or listing. Company figures are self-reported.

1. Zhao et al., "Recommending What Video to Watch Next: A Multitask Ranking System", YouTube, RecSys 2019 (mirror). https://research.google/pubs/recommending-what-video-to-watch-next-a-multitask-ranking-system/
2. YouTube, "On YouTube's Recommendation System" (opened). https://blog.youtube/inside-youtube/on-youtubes-recommendation-system/
3. Meta Engineering, "How machine learning powers Facebook's News Feed ranking algorithm", 2021 (opened). https://engineering.fb.com/2021/01/26/core-infra/news-feed-ranking/
4. Meta, "Incorporating More Feedback Into News Feed Ranking", 2021 (opened). https://about.fb.com/news/2021/04/incorporating-more-feedback-into-news-feed-ranking/
5. Netflix, "Recommending for Long-Term Member Satisfaction at Netflix", 2024 (mirror). https://noise.getoto.net/2024/08/29/recommending-for-long-term-member-satisfaction-at-netflix/
6. Facebook, "Further Reducing Clickbait in Feed", 2016 (opened). https://about.fb.com/news/2016/08/news-feed-fyi-further-reducing-clickbait-in-feed/
7. Facebook, "New Updates to Reduce Clickbait Headlines", 2017 (opened). https://about.fb.com/news/2017/05/news-feed-fyi-new-updates-to-reduce-clickbait-headlines/
8. Chapelle and Li, "An Empirical Evaluation of Thompson Sampling", NIPS 2011 (abstract). https://papers.nips.cc/paper/2011/hash/e53a0a2978c28872a4505bdb51db06dc-Abstract.html
9. Li et al., "A Contextual-Bandit Approach to Personalized News Article Recommendation", WWW 2010 (abstract). https://arxiv.org/abs/1003.0146
10. LinkedIn, "LiRank: Industrial Large Scale Ranking Models at LinkedIn", 2024 (opened). https://arxiv.org/abs/2402.06859
11. Steck, "Calibrated Recommendations", RecSys 2018 (opened). https://salanghei.github.io/download/paper/CalibratedRecommendations.pdf
12. Spotify, "Calibrated Recommendations with Contextual Bandits on Spotify Homepage", 2025 (opened). https://research.atspotify.com/2025/9/calibrated-recommendations-with-contextual-bandits-on-spotify-homepage
13. Volkovs et al., "DropoutNet", NeurIPS 2017 (abstract). https://proceedings.neurips.cc/paper/2017/file/dbd22ba3bd0df8f385bdac3e9f8be207-Paper.pdf
14. Lee et al., "MeLU", KDD 2019 (abstract). https://arxiv.org/abs/1908.00413
15. Pinterest, "Warmer for Less", 2025 (abstract). https://arxiv.org/abs/2512.17277
16. Meta, "SocRipple", 2025 (opened). https://arxiv.org/abs/2508.07241
17. ByteDance, "Monolith: Real Time Recommendation System With Collisionless Embedding Table", 2022 (abstract). https://arxiv.org/abs/2209.07663
18. Gong et al., Kuaishou, "Real-time Short Video Recommendation on Mobile Devices", 2022 (abstract). https://arxiv.org/abs/2208.09577
19. Facebook, "Bringing People Closer Together", 2018 (opened). https://about.fb.com/news/2018/01/news-feed-fyi-bringing-people-closer-together/
20. LinkedIn, "Optimizing PYMK for equity in network creation", 2021 (opened). https://engineering.linkedin.com/blog/2021/optimizing-pymk-for-equity-in-network-creation
21. Sankar et al., Snap, "GraFRank", WWW 2021 (abstract). https://research.snap.com/publications/graph-neural-networks-for-friend-ranking-in-large-scale-social-platforms.html
22. TikTok, "How TikTok recommends videos #ForYou" (opened). https://newsroom.tiktok.com/en-us/how-tiktok-recommends-videos-for-you
23. Singh and Joachims, "Fairness of Exposure in Rankings", KDD 2018 (abstract). https://arxiv.org/abs/1802.07281
24. Masthoff, "Group Modeling: Selecting a Sequence of Television Items to Suit a Group of Viewers", UMUAI 2004 (opened). https://abdn.elsevierpure.com/files/4013726/UMUAI04.pdf
25. Kaya, Bridge and Tintarev, "Ensuring Fairness in Group Recommendations by Rank-Sensitive Balancing of Relevance", RecSys 2020 (abstract). https://repository.tudelft.nl/record/uuid:979613f4-ed82-400d-9b9d-08fc7a84c7cc
26. Xiao et al., "Fairness-Aware Group Recommendation with Pareto-Efficiency", RecSys 2017 (abstract). https://bibbase.org/network/publication/xiao-min-yongfeng-zhaoquan-yiqun-shaoping-fairnessawaregrouprecommendationwithparetoefficiency
27. Spotify Engineering, "A Look Behind Blend", 2021 (opened). https://engineering.atspotify.com/2021/12/a-look-behind-blend-the-personalized-playlist-for-youand-you/
28. Hou et al., "Large Language Models are Zero-Shot Rankers for Recommender Systems" (abstract). https://arxiv.org/abs/2305.08845
29. Netflix, "GenRec", 2026 (abstract). https://arxiv.org/abs/2608.10257
30. Netflix, "Interleaving in Online Experiments at Netflix" (opened). https://netflixtechblog.com/interleaving-in-online-experiments-at-netflix-a04ee392ec55
31. Airbnb, "Beyond A/B Test: Speeding up Airbnb Search Ranking Experimentation through Interleaving" (opened). https://medium.com/airbnb-engineering/beyond-a-b-test-speeding-up-airbnb-search-ranking-experimentation-through-interleaving-7087afa09c8e
32. Spotify Confidence, "Interleaving" (opened). https://confidence.spotify.com/glossary/interleaving.md
33. Chia et al., "RecList" (opened). https://arxiv.org/abs/2111.09963
34. Ie et al., "RecSim" (opened). https://arxiv.org/abs/1909.04847
35. Zhao et al., "KuaiSim" (opened). https://arxiv.org/abs/2309.12645v2
36. Li et al., "Unbiased Offline Evaluation of Contextual-bandit-based News Article Recommendation Algorithms" (opened). https://arxiv.org/abs/1003.5956
37. Pinterest, "Experiment without the wait: Offline Replay Experimentation" (opened). https://medium.com/pinterest-engineering/experiment-without-the-wait-speeding-up-the-iteration-cycle-with-offline-replay-experimentation-7a4a95fa674b
38. Gao et al., "KuaiRec" (abstract), and its README (opened). https://arxiv.org/abs/2202.10842 and https://github.com/chongminggao/KuaiRec
39. Spotify, "Navigating the Evaluation Funnel to Optimize Iteration Speed for Recommender Systems", 2024 (opened). https://arxiv.org/html/2404.08671v1
