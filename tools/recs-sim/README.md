# Game feed recommender

Orders the games feed (the app's games tab) after its curated opening pages. The core is
`FacebookClone/Bubbles/Recommend/game-recs.js`: plain JS, no dependencies, the same pattern as the
game runtime. The app runs it in JavaScriptCore through `GameRecommender.swift`. Node runs it here
for checks and the simulator.

```sh
node tools/recs-sim/run-node.js        # 70 checks
tools/recs-sim/run-jsc.sh              # the same checks in JavaScriptCore (macOS)
node tools/recs-sim/seeds-demo.js      # the real seed games through the app bridge
node tools/recs-sim/sim.js --seeds 5   # every stage vs today's feed, synthetic people
node tools/recs-sim/sim.js --seeds 3 --sweep calibration.lambda=0.3,0.5,0.7
node tools/recs-sim/fb-sim.js --seeds 6  # Facebook-style ranker: IDs vs the game language (below)
```

## The model

Every game gets two Beta posteriors:

- **grab** = P(takeover | shown): the hook
- **sat** = P(good outcome | took over): whether the hook paid off

Clickbait is high grab. Slop is low sat.

| Stage | What it does | Main parameters (`defaults()` in the JS) |
|---|---|---|
| 1. Reward | Grab `g`: takeover or save/float/like = 1, watched ≥ 6 s = 0.35, skipped < 1.2 s = 0, otherwise 0.1. Satisfaction `s = σ((r − 0.5)/1)`, where `r = 1·finished + 1.5·ln(1+replays) + 3·saved + 3·floated + 4·addedFriend + 2·remixed + 1·liked + 0.5·openedBoard − 1.5·quitMidRun − 0.75·endedSession`. Saves count like strong likes: people leave a game to save it, not to like it. | `reward.*` |
| 2. Thompson sampling | Score `0.6·logit θg + 1.5·logit θs`, sampled: whether a game paid off counts more than whether it grabbed. The sat prior comes from bot playtests: `0.35 + 0.25·max(0, corr(skill, score)) + 0.15·durationFit`, worth 4 plays. Evidence decays 0.97 a day. | `bandit.*`, `bots.*` |
| 3. Calibration | Steck's greedy re-rank, `(1−λ)·rel − λ·Σ ω·KL(p‖q̃)`, over formula, mood family and hook tier. `q` is measured over a sliding window of the last 10 pages, so the mix holds as you scroll. Before your own history fills the targets in, the bait lean tilts them: each formula or mood gets prior mass `∝ exp(b_u·(2·avgHook − 1))`, and the hook tiers start at 40/35/25. | `calibration.lambda = 0.5`, `history = 10`, `hookPrior`, `hookTilt` |
| 4. Cold start | A manifest hook prior (formula, energy, mood, look, community scope, short bot runs) blends with the observed hook by `w = n/(n+k)`. Young games borrow sat from their 5 most similar established ones. Taste is a centered, decayed feature vector; affinity is its cosine with the game. | `coldStart.*` |
| Bait appetite | `b_u = clamp(b0 + 5·(slope_grab,u − slope_grab,all) + 6·(slope_sat,u − slope_sat,all), −2.5, 1)`. Each slope regresses the page's grab or sat on `2·hook − 1`, with ridge shrinkage. The ranking adds `b_u·(2·hook − 1)`. Slop guard: `−3·P(θs < 0.35)·(1 − σ(b_u))`. Unproven games get at most `0.15 + 0.25·σ(b_u)` of the slots. Session fatigue: −0.4 per skipped or quit hooky page in the last 6. | `bait.b0 = −1` is the product dial |

The feed leans away from hooky games by default (`b0 = −1`, satisfaction over grab, calmer
calibration targets). The lean is still personal: people whose grab and satisfaction respond to
hooks more than everyone else's drift up (capped at +1) and get more of them; people who skip or
quit them drift further down. v0.1 leaned the other way (`b0 = +0.8`); the comparison is below.

**On one phone,** "everyone" is a prior slope (`popGrabSlope`, worth 300 pages), and the hook stays
mostly the manifest's (`hookAgeK = 60`), because a game's takeover rate on one phone measures your
taste, not how grabby the game is.

## In the app

- `BubbleStore.extendFeed` → `recommendedItems` (`StoreRecommendations.swift`). If the recommender is
  off or fails, it falls back to `BubbleFeedGenerator`.
- One impression per feed page (`GameRecommender`). It's fed by `BubbleFeedModel` (page,
  visibility, takeover, play again, result), the tab's like, save, remix and board actions,
  `BubbleSurfaceHooks.float`, and the Board's Add friend. Leaving the tab pauses the page, and 3
  minutes away ends the session.
- Saves and social moments (v0.4, `docs/BUBBLES.md` 7.1): `GameRecommender` listens for
  `.bubbleSaveChanged` and `.bubbleSocialSignal`. A moment about the open page's game joins that
  page's reward (`reward.social` weights: Add friend 4; challenges, rematches, shares and co-make 3;
  group-chat plays, game nights, remixes and stories 2; a challenge won 1; unknown kinds 1). One
  anywhere else goes to `app.signal` as off-feed evidence worth half a page: satisfaction only, no
  grab, plus a nudge to taste. The other people's ids are counted for later Blend work. Unsaves are
  ignored.
- State is saved to `Application Support/Bubbles/game-recs-state.json`.
- Launch variables:
  - `FB_RECS=off`: the old feed.
  - `FB_RECS=reward,bandit,...`: only the listed stages.
  - `FB_RECS_RESET=1`: start from scratch.
  - `FB_RECS_LOG=1`: print every ranking and page.
- Editing `game-recs.js` changes the runtime fingerprint (`BubbleRuntimeWorker`, which hashes
  every bundled `.js`), so the bot runs re-simulate once on the next launch.

## Simulator results (`--seeds 5`, second week)

Synthetic world: 90 people per world (30 bait-lovers, 30 balanced, 30 bait-averse), 14 days, about
20% clickbait slop, 3 new games a day. The numbers show direction, not size.

v0.2 defaults (lean away from hooky):

| | today | CTR only | 1 | 1+2 | 1+2+3 | 1–4 | 1–4 + bait |
|---|---|---|---|---|---|---|---|
| bait-averse pages/session | 5.9 | 5.6 | 7.6 | 7.0 | 7.2 | 7.1 | 7.5 |
| bait-averse hooky / slop share | 45% / 36% | 83% / 49% | 59% / 4% | 46% / 11% | 44% / 11% | 49% / 13% | **23% / 9%** |
| balanced pages/session | 6.5 | 6.7 | 7.6 | 7.0 | 7.6 | 7.6 | **7.9** |
| balanced hooky / slop share | 47% / 37% | 83% / 49% | 60% / 5% | 47% / 12% | 50% / 12% | 58% / 13% | **44% / 11%** |
| bait-lover pages/session | 6.8 | 8.7 | 7.9 | 7.3 | 8.3 | 8.9 | **9.3** |
| bait-lover hooky / slop share | 45% / 37% | 81% / 49% | 61% / 5% | 47% / 13% | 53% / 13% | 63% / 13% | 62% / 14% |
| miscalibration (KL) | .87 | 1.07 | 1.12 | .98 | .49 | .58 | .56 |

"1 reward" alone has the least slop, but it barely explores (about 11% new games vs 14–23%) and
ignores your mix (highest miscalibration). Thompson sampling and calibration trade a little of that
for testing new user-made games and keeping variety.

v0.1 vs v0.2, everything on (1–4 + bait):

| | v0.1 (lean toward hooky, b0 = +0.8) | v0.2 (lean away, b0 = −1) |
|---|---|---|
| bait-averse hooky / slop / pages | 45% / 14% / 7.2 | 23% / 9% / 7.5 |
| balanced hooky / slop / pages | 69% / 21% / 7.6 | 44% / 11% / 7.9 |
| bait-lover hooky / slop / pages | 80% / 30% / 10.2 | 62% / 14% / 9.3 |

## Next (single-person feed)

Ember re-ranking: write the last plays as text, have Ember re-order the top ~15 while the current
game plays, and add a one-line "why". Today's `why` strings are the placeholder. Compare it against
this baseline with the same simulator.

# Group Blend

One feature inside Facebook Groups: a Blend feed of games recommended to everyone in a Group, a
Blend game spec Muse Studio can make for all of them, and taste twins to add as friends. A pair is
a two-person Blend, so Challenge Me can reuse it. Code: `groupBlend` and its helpers in
`game-recs.js`; `GroupBlend.swift` (`bubbleStore.groupBlend(for:)`);
`GroupBlendSection.swift`, mounted under `BubbleGroupSection` in `GroupDetailView`.

```sh
node tools/recs-sim/blend-demo.js                                  # New in SF, on the real seeds
node tools/recs-sim/groups.js --seeds 3 --groups 80                # Groups of 4-6
node tools/recs-sim/groups.js --seeds 3 --groups 150 --min 2 --max 2 --count 5   # pairs
```

## The model

| Piece | What it is | Parameters (`blend.*`) |
|---|---|---|
| Profile | Shares over formula, mood, look and hook tier, smoothed toward uniform by 3 pseudo-pages; the bait lean; a taste vector over the 24 game features; skill per formula. Yours comes from your recommender state; your skill is where your best scores land on each board, averaged per formula. | `priorMass` |
| Synthetic profile (demo cast) | Deterministic from the person's id: softmax of seeded noise over formulas (sd 0.9), moods (0.7) and looks (0.5), with +1.2 / +1.0 boosts for formulas and moods their bio suggests (running → dodge/time and hype, trivia → answer/guess, …); lean `b0 + N(0, 0.9)`; skill = roster skill + N(0, 0.12) per formula. | `syntheticPages` |
| Similarity | `0.35·(1+cos(taste))/2 + 0.3·(1 − JS(formula)/ln 2) + 0.2·(1 − JS(mood)/ln 2) + 0.15·e^(−\|Δlean\|)` | `simWeights` |
| Member enjoyment | `r_ui = σ(1.0·logit(sat_i) + 0.8·log(share_f/uniform) + 0.5·Σ mood·log(share_m/uniform) + 0.2·log(share_look/uniform) + 0.6·lean·(2·hook − 1))` | `qualityW`, `formulaW`, `moodW`, `lookW`, `leanW` |
| Group score | `mean_u log r_ui` (geometric mean: the chance everyone enjoys it, if independent), plus the pluses below, minus 0.25 per earlier pick with the same formula. Games where some member's `r_ui < 0.12` are dropped while others remain. | `aggregate`, `miseryFloor`, `samePenalty` |
| Skill fairness (plus only) | `0.5·max(0, 1 − spread/0.3)`, spread = max − min of members' skill on the game's formula. Exactly 0 once skills differ by 0.3. | `skillBonus`, `skillBand` |
| Served fairness (plus only) | Each member's running enjoyment `U_u` over the Blend so far; weights `max(0, mean(U) − U_u)/(mean(U) + 0.25)`; bonus `0.8·Σ_u w_u·r_ui`. Nobody is pushed down. | `fairBoost` |
| Social plus | +0.4 for a game made for this Group, +0.3 for one made by a member. | `groupGameBonus`, `memberMadeBonus` |
| Labels | "Everyone's pick" when every member's `r_ui` is at or above their own average over the pool; otherwise "For A & B", the two members it lifts most. | |
| Blend spec | Formula = argmax of `log(geometric-mean share) + skill plus`; moods = the top shared mood (and the second if within 60%); look = top shared; energy from the *least* bait-tolerant member (lean < −0.75 low, < 0.5 medium, else high); "friendly" competition when skills match on the formula, else "light"; themes from members' bios; "X brings Y" = each member's biggest share above the group's. Plus a Studio prompt. | |
| Taste twins | The 3 most similar people who aren't your friends yet, with a "You and Priya both like …" line. | |

## Group simulator results

Everyone first plays alone for 14 days with the full recommender, so profiles are learned. Then
random Groups get a Blend, scored with the simulated people's *true* enjoyment, which the
recommender never sees. Synthetic world, so this shows direction, not size.

Groups of 4–6 (3 worlds × 80 Groups, 10 games each):

| strategy | joy | worst-off member | spread | all enjoy | evenly matched |
|---|---|---|---|---|---|
| Random games (no Blend) | 0.396 | 0.309 | 0.178 | 8.7% | 1.4% |
| Average the profiles (centroid) | 0.641 | 0.482 | 0.301 | 29.7% | 1.3% |
| Average enjoyment | 0.641 | 0.483 | 0.298 | 30.4% | 1.3% |
| Least misery | 0.623 | 0.486 | 0.258 | 32.0% | 1.2% |
| Geometric mean | 0.641 | 0.486 | 0.291 | 31.3% | 1.3% |
| **Geometric + fairness plus** | **0.642** | **0.490** | 0.286 | 31.6% | 1.9% |

Pairs (3 worlds × 150 pairs, 5 games each):

| strategy | joy | worst-off | spread | all enjoy | evenly matched |
|---|---|---|---|---|---|
| Random | 0.401 | 0.351 | 0.099 | 20.7% | 35.6% |
| Geometric mean | 0.698 | 0.623 | 0.149 | 71.2% | 34.8% |
| **Geometric + fairness plus** | 0.692 | 0.621 | 0.143 | 70.9% | **49.6%** |

What it says: any Blend beats random games by a lot (joy +0.25, worst-off member +0.18, the share
of games everyone enjoys 9% → 31%). Between strategies the differences are small and mostly within
noise (SE about 0.006). Geometric + fairness has the best worst-off member and a smaller spread than
the plain average. The skill plus barely fires in Groups of 4–6, where skills rarely all land within
0.15, but for pairs it lifts evenly matched games from 35% to 50% for a joy cost within about one SE.

## Assumptions for review (guesses flagged)

- **Guess:** the 24 hand-picked manifest features stand in for a learned embedding. The planned
  upgrade is the SideQuests recipe: sectioned text, Qwen3-Embedding-0.6B, a late-fusion classifier
  with a residual cosine prior, trained on LLM-judged synthetic pairs (where it runs is undecided).
- **Guess:** the similarity weights, the enjoyment weights and the misery floor; none are fitted.
- **Guess:** members are independent, which is what makes the geometric mean "the chance everyone
  enjoys it".
- **Guess:** demo-cast profiles are synthetic, deterministic from ids, roster skill and bio keywords.
- **Evidence:** the group simulator above, which is itself synthetic.
- Skill comes from leaderboard percentiles, and the demo boards are mostly bot runs.

# Facebook-style value model

Karthik's question: does the game language (each game's brief, its authoring fragments, its length
mode, its bot-gate result) make a ranker built the way Facebook describes its feed stronger? Code:
`value-model.js` (the ranker) and `fb-sim.js` (a synthetic world and the comparison). It's a
simulator, not in the app yet.

```sh
node tools/recs-sim/fb-sim.js --seeds 6                           # the comparison below
node tools/recs-sim/fb-sim.js --seeds 6 --pool 40 --newPerDay 3   # a thin catalog
node tools/recs-sim/fb-sim.js --seeds 6 --fragTaste 0             # no mechanic-level taste
node tools/recs-sim/fb-sim.js --seeds 6 --idNoise 1.0             # game IDs know more than features
```

## The ranker

| Stage | Facebook's public description | Here |
|---|---|---|
| Candidates | Pass 0: a lightweight model picks about 500 posts | 60 per session: the most popular, the newest and a few random games. With game features, also the best matches for the person's learned taste |
| Predictions | Multitask neural nets predict each action (like, comment, share, …) | One online logistic head per event (AdaGrad, sparse features). Takeover; then finish, save and share. Social heads: challenge and rematch after a finished run; co-play, remix and Add friend after a takeover |
| Value | `V = Σ w_k·Y_k`, weights not published | `V = P(take)·(1 + 1·P(finish)·(1 + 3·P(challenge) + 3·P(rematch)) + 3·P(save) + 3·P(share) + 2·P(co-play) + 2·P(remix) + 4·P(Add friend))`, the same weights as `game-recs.js` |
| Integrity | Integrity processes run on every post | A game whose finish rate after 10 or more takeovers is under 0.3 is dropped. Same in every version |
| Exploration | Not described | 5% of pages are a random candidate. Same in every version |

The versions differ only in what the heads may see and which heads count:

- **IDs (today):** bias, person, game ID, game age (new, young, old), person context (friends, in a Group).
- **The game language** adds the brief's formula, mood shares, look, energy, competition and scope;
  each authoring fragment (Bayan's 33); the length mode (endless, rounds, timed, lives); and the
  bot-gate quality bucket. It also adds person × feature crosses for formula, mood, fragments,
  length and scope: personal taste per mechanic, which carries over to brand-new games.
- **Social targets** add the five social heads to the value.
- **Generation** (`gen`): when the person's ideal game, read off their crosses, beats every candidate
  by more than 0.1 logit, Muse makes it from that brief and it's shown first. At most once per
  person every 2 days, 25 a day.

## The world (synthetic)

- **People:** 200 in 20 Groups (40% are in two), about 3 friends each.
  - Four taste types (wordsmith, arcade, puzzler, maker), with likes per formula, mood and fragment.
  - How social each one is, how creative, and how much hooks work on them.
- **Games:** 150 to start, plus 12 new a day. Each has a hidden quality (18% are slop) and an
  ID-only effect its features don't show.
- **Run:** 14 days, the second week measured, 6 worlds.
- **Where social outcomes come from:**
  - `beat_target` and `ghost_score` lead to challenges; `turns` and `shared_progress` to co-play.
  - Group and Event scope lead to co-play and Add friend; the make formula to remixes.
  - The person's sociality adds to all of them.
  - Add friend needs a stranger in one of your Groups, and creates a real friendship that later
    challenges can use.

## Results (6 worlds, mean ± SE)

| | IDs (today) | IDs + social | Game features | Features + social | + generation |
|---|---|---|---|---|---|
| value / page | 1.57 ±0.08 | 1.87 ±0.07 | 2.85 ±0.11 | 2.83 ±0.11 | 2.94 ±0.10 |
| pages / session | 3.7 | 3.8 | 4.5 | 4.4 | 4.5 |
| takeovers / 100 pages | 46.8 | 48.5 | 61.3 | 60.5 | 60.4 |
| finished runs / 100 pages | 33.6 | 35.7 | 51.4 | 48.6 | 49.3 |
| saves + shares / 100 pages | 15.3 | 16.9 | 34.4 | 31.5 | 32.6 |
| social moments / person-week | 2.38 ±0.22 | 3.96 ±0.21 | 6.37 ±0.33 | 6.92 ±0.54 | 7.58 ±0.46 |
| challenges + rematches / person-week | 0.95 | 1.68 | 2.66 | 2.89 | 3.40 |
| co-plays / person-week | 0.70 | 1.12 | 1.85 | 1.99 | 2.03 |
| friend adds / person-week | 0.39 ±0.05 | 0.75 ±0.05 | 1.02 ±0.04 | 1.29 ±0.08 | 1.37 ±0.08 |
| takeover rate on games < 2 days old | 33% | 40% | 56% | 55% | 53% |
| share of pages on slop | 10.1% | 7.4% | 5.2% | 7.4% | 7.8% |

The same comparison in four worlds (value / page):

| World | IDs → game features | Friend adds, features → + social | + generation over features + social |
|---|---|---|---|
| Default (150 games + 12 a day) | 1.57 → 2.85 (+81%) | 1.02 → 1.29 | 2.83 → 2.94 (+4%, noise) |
| Thin catalog (40 + 3 a day) | 1.71 → 2.45 (+43%) | 0.96 → 1.12 | 2.53 → 2.92 (+15%) |
| No mechanic-level taste (`--fragTaste 0`) | 1.72 → 2.13 (+24%) | 0.95 → 1.14 | 2.15 → 2.26 (+5%) |
| IDs know more (`--idNoise 1.0`) | 2.08 → 3.00 (+44%) | 1.26 → 1.42 | 2.96 → 3.13 (+6%) |

What it says:

1. **The game language is the big lever.**
   - Value per page rises 81%, and finished runs go from 33.6 to 51.4 per 100 pages.
   - Brand-new games' takeover rate goes from 33% to 56%: features fix cold start.
   - Slop roughly halves (10% to 5%), because the bot-gate result is a feature.
   - It still helps when taste lives only at the formula and mood level (+24%).
2. **Social targets buy social outcomes, not engagement.**
   - With game features, friend adds rise 27% (1.02 to 1.29, about 3 SE). All social moments rise 9%, which is within noise.
   - Finished runs drop by 2.8 per 100 pages, and slop's share goes from 5.2% to 7.4%.
   - With IDs only, social targets nearly double friend adds (0.39 to 0.75), but stay well below what features reach.
3. **Generating games pays off only in a thin catalog.**
   - In the thin world: +15% value, friend adds +38% (1.12 to 1.55), and the person a game was made for takes it over 54% of the time, against 51% for their other pages.
   - In the default world: +4%, within noise, and 55% against 57%.
4. **Value / page is scored with the ranker's own weights,** so the social versions are partly graded on their own target. Read the engagement and social rows on their own.

## Assumptions (for Karthik to vet)

1. **The shape: evidence.** Facebook describes about 500 candidates from a lightweight pass 0, a
   personalized pass predicting each action, a linear value `V = Σ w·Y`, integrity processes on
   every post, and a contextual pass for diversity ([Meta Engineering, 2021][fb-feed]; the
   [Facebook Feed system card][card] gives the same 500). The weights aren't public, so ours are
   guesses.
2. **Online logistic heads stand in for multitask nets: partly evidence.** Facebook's own
   ad-click model was boosted trees plus logistic regression, and features carrying history
   mattered most ([He et al., 2014][he]). Today's multitask nets are richer, so the direction
   should carry over but the size won't.
3. **Person × feature crosses: evidence for the method.** Cross-product features memorize feature
   interactions ([Wide & Deep, 2016][wd]). Hybrids with item metadata beat pure collaborative
   filtering on cold start ([LightFM, 2015][lightfm]; [DropoutNet, 2017][dropout]).
4. **Social targets fit "meaningful social interactions": evidence for the goal, a guess for the
   events.** In January 2018 Facebook said it would prioritize posts that spark conversations and
   meaningful interactions, predicting which posts you'd want to interact with friends about
   ([News Feed FYI, Mosseri][msi]; quoted by [eWeek][eweek]). Which game events count, and their weights (3, 3, 2, 2, 4), are
   our guesses.
5. **Taste varies by mechanic, not just genre: some evidence, size guessed.** Quantic Foundry's
   model finds 12 distinct gaming motivations by factor analysis of a large survey sample and ties
   them to specific mechanics ([model][qf]; [GDC talk][qf-gdc]). The simulator's per-fragment taste
   (sd 0.6) is a guess. With none, the feature gain drops from +81% to +24%.
6. **Social mechanics cause social outcomes: evidence for the direction, sizes guessed.**
   Cooperation and interdependence in multiplayer games increase social closeness
   ([Depping & Mandryk, 2017][closeness]), and a social game built trust better than an icebreaker
   task ([Depping et al., 2016][trust]).
7. **Game IDs know things features don't: guess.** Hidden quality (the bot gate reads it with noise,
   sd 0.8) and an ID-only takeover effect (sd 0.5). With twice that ID effect the feature gain drops
   to +44%.
8. **Muse's generated games: guess.** Average quality (a little below user-made), 15% slop, features
   exactly as briefed, and no time cost, although the real median is 28 s per game.
9. **Integrity: guess.** Crowd-detected slop: a finish rate under 0.3 after 10 takeovers.
10. **Sessions: guess.** You keep scrolling with chance 0.62, +0.25 after a finished run and +0.05
    after a takeover, for at most 20 pages.

[fb-feed]: https://engineering.fb.com/2021/01/26/ml-applications/news-feed-ranking/
[card]: https://transparency.meta.com/features/explaining-ranking/fb-feed
[he]: https://ai.meta.com/research/publications/practical-lessons-from-predicting-clicks-on-ads-at-facebook/
[wd]: https://arxiv.org/abs/1606.07792
[lightfm]: https://arxiv.org/abs/1507.08439
[dropout]: https://proceedings.neurips.cc/paper/2017/file/dbd22ba3bd0df8f385bdac3e9f8be207-Paper.pdf
[msi]: https://www.telecomtv.com/content/tracker/news-feed-fyi-bringing-people-closer-together-29546/
[eweek]: https://www.eweek.com/cloud/facebook-now-prioritizing-friends-posts-over-news-items/
[qf]: https://quanticfoundry.com/2015/07/20/how-we-developed-the-gamer-motivation-profile-v2/
[qf-gdc]: https://gdcvault.com/play/1025742/contactUs
[closeness]: https://doi.org/10.1145/3116595.3116639
[trust]: https://doi.org/10.1145/2967934.2968097
