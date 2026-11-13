# How companies evaluate recommenders, and what to build for the demo

Scope: the games feed ranker (Thompson sampling, grab/satisfaction posteriors, bait lean, calibration), Group Blend, interleaving, and the optional Muse "Ember" LLM re-rank. No real users, no logs, on-device JavaScript, 5-minute demo plus 3 minutes Q&A.

Verification note: every source marked [opened] was opened and read for this report. I did not find usable public evaluation details for TikTok/ByteDance, Snap or Reddit, so they are not cited. Numbers come only from the pages listed in Sources. Where a source gave no number, I say so.

## Executive summary

1. Industry practice is a funnel: offline metrics and replay first, then interleaving, then A/B, then long-term holdouts and surveys. Spotify describes exactly this "evaluation funnel" [S1].
2. Interleaving is the cheap online method. Netflix says it needs over 100x fewer users than its most sensitive A/B metric [S2]. Airbnb reports up to 50x, using about 6% of A/B traffic, and 82% agreement with A/B outcomes [S3]. Spotify cites 10 to 100x [S4].
3. With no real users, interleaving can only be shown on synthetic personas and on a handful of live judges. It proves the instrumentation and the story, not real-world lift. Say so.
4. Companies pair engagement with survey-based value. Facebook uses "worth your time" surveys to set ranking weights [S5][S6]. YouTube counts only 4 and 5 star videos as "valued watch time" and predicts survey answers for everyone [S7]. Whims' grab versus satisfaction split is the same idea. Lead with that.
5. Offline accuracy metrics (NDCG etc.) are not the right tool here: there are no held-out logs. Sampled metrics can even flip model rankings [S8].
6. Simulation is the honest substitute for logs. RecSim, RecoGym, KuaiSim and LLM-agent simulators exist for this [S9][S10][S11][S12][S13]. Simulator fidelity is a known weak spot, so test across more than one persona set.
7. Behavioral and property tests (RecList) fit a hand-written formula well, because each named weight has a testable promise [S14].
8. Group Blend has a 20-year literature to borrow from: Masthoff compared average, least misery, multiplicative and other strategies [S15].
9. For the LLM layer, the published failure modes are candidate-order bias and hallucinated items [S16][S17][S18]. Each is a cheap test.
10. Best demo story: "Every promise in our formula is a test that runs on the phone, and the model proves it learns, fairly, and beats the old feed on known personas."

## Ranked shortlist: what to build

### 1. Persona learning curves and regret chart (effort: S to M)
- **What a judge sees:** the continual learning claim, as a picture. A new user's model finds their favorite within a stated number of plays.
- **How:**
  - Make 5 to 6 personas with known tastes: a competitive rematcher, a cozy self-expresser, a bait-averse minimalist, a bait-lover, a social sharer, and a "random" control.
  - Run 200 pages per persona, 30 seeds each.
  - Plot (a) cumulative regret against an oracle that knows the true taste, (b) top-1 match to the persona's favorite formula/mood against plays, with a band over seeds.
  - Headline numbers: plays until the favorite is the top pick in 80% of seeds; exploration cost (regret in the first 20 pages); regret of a no-learning baseline and of a popularity baseline.
- **Why this is credible:** regret and learning curves are the standard way bandits are judged, and this is what the Li et al. line of work and RecSim-style simulation are for [S19][S9].
- **Honest framing:** the personas are our assumptions. Add a persona whose taste drifts mid-session to show the online update tracking change.

### 2. Property tests as a live guardrail board (effort: S)
- **What a judge sees:** the formula's promises are enforced, not hoped for. This answers "how do you know it doesn't push clickbait?" in one slide.
- **How:** a table of properties, each with a pass count over thousands of randomized sessions. Examples:
  - bait-averse user: at most N hooky games in any 10 pages;
  - Group Blend never picks a game below the misery floor when a game above it exists;
  - a new game is shown within K pages (the cap on untested games does not starve it);
  - slop guard: a game flagged as slop never ranks in the top 3;
  - calibration: KL of the last-10-page mix stays under a bound;
  - invariants such as score is monotone in sat and does not change when a user's grab history is unchanged (determinism under a fixed seed).
  - Show a "break it" demo: set the bait weight to 0 and watch one property go red.
- **Source of the idea:** RecList argues held-out accuracy misses real-world behavior and proposes behavioral tests grouped by use case [S14].

### 3. Interleaving against the old feed (effort: M)
- **What a judge sees:** a real online-evaluation method used by Netflix, Airbnb and Spotify [S2][S3][S4], running on the phone.
- **How:**
  - Team-draft: coin flip for who picks first, then alternate, each taking its best unpicked game (Netflix's description [S2]).
  - Credit by satisfaction events (finished, replay, save), not by grab alone. Airbnb credits bookings, not clicks [S3].
  - Offline on personas: report win rate of formula vs old feed with a binomial confidence interval, per persona, plus a "preference margin" t-test as Airbnb does [S3].
  - Live: invite 5 to 10 judges to swipe 10 interleaved cards. Show the running tally. Do not claim significance with n of 10; claim "the logger works and the tally moves".
- **Caveat to say aloud:** interleaving measures preference, not lift in total consumption or business metrics [S1].

### 4. Group Blend evaluation on synthetic groups (effort: M)
- **What a judge sees:** the "closer together" claim, quantified.
- **How:** 1,000 synthetic groups (size 3 to 8, varying taste spread). Compare Blend against average, least misery, multiplicative and "most pleasure", the same families Masthoff studied [S15].
  - Metrics: minimum member enjoyment, mean enjoyment, share of groups with someone below the misery floor, and spread (Gini or standard deviation) of satisfaction across members.
  - Plus-only skill fairness: show that the weakest player's expected result improves without lowering anyone's below their baseline.
  - Taste twins: precision@5 of twins against the persona generator's known nearest neighbors.
- **Caveat:** Masthoff's studies were small (39 and 22 people) and used hypothetical ratings, and the multiplicative rule was called most promising but needing more testing [S15]. Your geometric mean is the multiplicative family. Cite that as support, not proof.

### 5. Calibration and beyond-accuracy dashboard (effort: S)
- **What a judge sees:** the feed is varied and fair to new games, not just accurate.
- **How:** per persona, plot the KL between the user's taste mix and the last-10-pages mix, with and without Steck-style re-ranking [S20]. Also show catalog coverage, share of impressions going to untested games, bait share, and new-game time-to-first-impression.
- **Why:** Steck's point is that accuracy-tuned lists crowd out minor interests; calibration fixes it [S20]. Spotify now uses a calibration penalty (KL) with a contextual bandit on Home, and reports +3.93% overall impression-to-stream in an A/B test [S21]. That makes your KL step a recognized idea.

### 6. LLM re-rank safety and value check (effort: S to M)
- **What a judge sees:** the AI layer is measured, not assumed to help. Directly relevant to the 30% AI Integration criterion.
- **How:** four numbers per run.
  - Order sensitivity: feed the same top-10 in shuffled orders and report Kendall tau between outputs. Papers find LLM rankers are affected by prompt position and popularity [S16][S17].
  - Hallucination rate: share of returned IDs not in the candidate set. Target 0% after a hard filter [S17].
  - Value: persona ground-truth utility of Ember order vs formula order (NDCG@10 against persona utility, paired by seed).
  - Safety net: the property suite from item 2 re-run on Ember's output; reject and fall back to the formula if a property fails.
- **Related evidence:** one LLM re-ranker study found large gains over random candidates but marginal, mostly non-significant gains over a strong knowledge-graph base [S18]. Expect small gains over a strong formula and say that up front.

### 7. "Why" line fidelity test (effort: S)
- **What a judge sees:** explanations that are true to the model.
- **How:** each why-line cites a term (taste match, rematch with a friend, fresh game). Fidelity check: zero out the cited term and confirm the game's rank drops by at least a set amount in at least X% of cases. Report that rate. Add an audience poll after the demo: "was this reason helpful?" 
- **Source of the framework:** Tintarev and Masthoff list seven explanation aims (transparency, scrutability, trust, effectiveness, persuasiveness, efficiency, satisfaction) and say a study should state which aim it targets [S22]. Target transparency and trust. Do not claim persuasiveness.

### 8. Instrumentation for later: log propensities (effort: S)
- **What a judge sees:** a credible path from demo to production. This supports the "judge the changes and the story" framing.
- **How:** for each impression, log the Thompson-sampling selection probability (estimate by Monte Carlo draws) and the interleaving team. With propensities, off-policy estimators such as replay and doubly robust can be run later [S19][S23]. Validate once on the simulator: the estimator's value estimate should match the simulator's true value (a one-slide sanity check).

Not worth building: full NDCG/MAP benchmark, sampled metrics, an LLM-agent simulator, a network-interference experiment.

## Detailed survey

Verdict key: **Use now**, **Reduced**, **N/A**.

### 1. Online evaluation

| Method | What and who | Verdict |
|---|---|---|
| A/B testing with engagement metrics | Standard at all large firms. Meta argues likes and comments are not enough and aims at long-run value [S24]. | N/A for us (needs users). Name it as the final step. |
| Survey-based value | Facebook asks whether a post is "worth your time" and uses answers to predict value and set weights [S5][S6]. YouTube counts 4 to 5 star videos as valued watch time and trains a model to predict survey answers, holding back real answers to check it [S7]. | **Reduced.** Our grab/satisfaction split is the analogue. Add a one-tap "worth it?" after a run in the demo. |
| Long-run value via experiment meta-analysis | Meta regresses long-run outcomes on shifts in content mix across many experiments, and re-checks the proxy about every six months [S24]. | N/A. Mention as the reason satisfaction is weighted 1.5 vs 0.6. Say the weights are hand-set priors. |
| Meaningful social interactions | Meta says it weights predicted likes, comments, shares by what people report is meaningful [S6]. I did not find a published MSI formula or sensitivity numbers. | **Reduced.** Our social moments (challenge, rematch, Add friend) are the analogue. |
| Holdout of a simple baseline | Twitter's amplification study compared a personalized feed with a reverse-chronological holdout of nearly 2 million daily accounts [S25]. | **Reduced.** Our "old feed" arm in interleaving plays this role. |
| Interference in social A/B tests | LinkedIn clusters members into 10,000 communities and compares member-level and cluster-level randomization to detect interference [S26]. | N/A. One sentence in Q&A: friends affect each other, so social features need cluster tests at scale. |
| Team-draft interleaving | Netflix: over 100x fewer users than its most sensitive A/B metric for 95% power [S2]. Airbnb: up to 50x, about 6% of A/B traffic, 82% agreement with A/B [S3]. Spotify cites 10 to 100x fewer users [S4]. | **Reduced** (item 3). |
| Balanced interleaving, multileaving | Multileaving shows several rankers at once; Spotify's paper cites Schuth et al. and Chuklin et al. but gives no numbers [S1]. Yahoo/Microsoft's large-scale validation of interleaving exists (Chapelle et al.) but I only saw its listing, not the text [S27]. | **N/A** for multileaving (we have two rankers). Mention it as a known extension. |

### 2. Offline evaluation

- **Ranking metrics (NDCG, MRR, recall@k, MAP).** Need held-out relevance labels. Pinterest found MAP flagged only about 25% of ideas that later won online, while their replay method found over 90% [S28]. **Verdict: Reduced.** Use NDCG only against persona ground truth, for the LLM check (item 6).
- **Beyond-accuracy: calibration.** Steck 2018 [S20]; Spotify's production use [S21]. **Use now** (item 5).
- **Diversity, novelty, coverage, popularity bias, exposure fairness.** Standard definitions; I did not open a dedicated survey for these. **Use now** in the dashboard: coverage, bait share, untested-game exposure share. Serendipity needs a human judgment, so skip.
- **Replay method.** Li et al. evaluate contextual-bandit policies directly on logged data, unbiased given random logging, validated against live tests on Yahoo front page data [S19]. Pinterest's "offline replay" resimulates the feed on history and checked it against 26 pairs of online home-feed experiment variants [S28]. **Reduced:** log propensities now (item 8); replay later.
- **IPS and doubly robust.** Doubly robust combines a reward model with importance weighting; it is accurate if either part is good [S23]. The Open Bandit Pipeline packages these estimators with a public dataset [S29]. **Reduced:** one simulator sanity check.
- **Pitfalls.** Sampled metrics can reverse the true order of two recommenders, and the authors say to avoid sampling [S8]. Leakage: do not tune weights on the same simulator you report results from. Use a second persona set for reporting.

### 3. Simulation-based evaluation

- **RecSim** (Google) lets you set user tastes, familiarity, hidden state and choice behavior for sequential recommendation [S9]. **Reduced:** we already have simulators. Borrow the idea of hidden user state (a mood that drifts).
- **RecoGym** simulates ad-recommendation traffic as a bandit/RL environment, motivated by the gap between offline and online results [S10]. **N/A.**
- **Virtual Taobao** learns a simulator from hundreds of millions of customer records and compares properties with the real environment [S11]. The abstract does not say which properties. **N/A** (needs data).
- **KuaiSim** offers three levels: list-wise, session, and cross-session retention, with evaluation protocols [S12]. **Reduced:** copy the three levels as our test layers (page, session, return visit).
- **LLM-agent simulators.** RecAgent reports simulated behavior "very close" to real humans [S13]. Agent4Rec reports both alignment and deviation from real preferences [S30]. **N/A:** costly and unvalidated here. If asked, say these are the next step for richer personas.
- **How simulators are validated.** Compare simulator statistics to real ones (Virtual Taobao [S11]) or measure alignment of agents with real users (Agent4Rec [S30]). We cannot do either. Substitute: sensitivity analysis. Show that the formula's win holds across several persona sets and noise levels.

### 4. Property-based and behavioral testing

- **RecList** groups systems by use case and runs behavioral tests, including on black-box commercial systems [S14]. **Use now** (item 2).
- **Metamorphic testing.** Not sourced here, so no company claim. As a cheap test: swapping two users' histories should swap their feeds; duplicating a game should not change the other games' ranks.
- **Slice-based evaluation.** Report every metric per persona, not only averaged. **Use now**: it is free once you have personas.
- **Guardrails.** YouTube reports demoting borderline content cut watch time on non-subscribed borderline recommendations by 70% in the US (self-reported) [S7]. Our guardrails are the slop guard, bait cap and misery floor, tested as in item 2.

### 5. Social and group evaluation

- **Group strategies and satisfaction.** Masthoff compares average, multiplicative, least misery, most pleasure, Borda, fairness and others, and finds people avoid misery; multiplicative was most promising in her second experiment [S15]. **Use now** (item 4).
- **People-you-may-know, connections formed, reciprocity, conversations started.** I did not find an open source with numbers for these, so I make no company claim. **Reduced:** in the simulator, count accepted Add-friend suggestions among persona pairs who truly share taste (precision) and mutual accepts (reciprocity). The Facebook and Messenger claim for judges: a challenge that gets a rematch within the session.
- **Interference.** See LinkedIn [S26]. Q&A only.

### 6. Bandit and continual-learning evaluation

- **Regret and learning curves.** Standard for bandits; see item 1. I did not open a single canonical source, so treat this as standard practice, not a cited claim.
- **Exploration cost.** Report regret in the first N pages and the share of impressions on untested games. Spotify's bandit uses epsilon-greedy exploration and lists UCB and multi-objective rewards as next steps [S21]. **Use now.**
- **Counterfactual validity of Thompson sampling logs.** Propensities are recoverable by Monte Carlo (item 8).

### 7. Explainability evaluation

- Tintarev and Masthoff: pick an aim, and measure effectiveness as the gap between predicted and post-use rating. Opt-outs can hide weak explanations, and personalization sometimes lowered effectiveness [S22]. **Reduced:** the counterfactual fidelity test (item 7) plus a one-question poll.
- Fidelity to the model: the standard idea is to check the explanation changes when the cited factor changes. I did not find a source to cite for a specific benchmark, so describe it as our own test.

### 8. LLM re-ranking evaluation

- **Position and popularity bias.** Hou et al.: LLMs rank well zero-shot, but struggle with history order and are skewed by item popularity and prompt position; prompts and bootstrapping reduce it [S16]. **Use now.**
- **Instability.** Another paper reports consistent positional bias and proposes a Bayesian correction [S17]. **Reduced:** shuffle test only.
- **Hallucinations and candidate position.** "Beyond Utility" measures history-length sensitivity, candidate position bias and the share of items not in the catalog; re-ranking partly eases position bias [S31]. **Use now.**
- **Human or LLM judges.** A re-ranker-with-explanations paper used 5 raters on 20 samples, paired t-tests on NDCG, and found marginal gains over a strong base [S18]. That sample is tiny; do not copy its confidence. **Reduced:** use the persona utility as the judge, and a small audience poll for the why lines. LLM-as-judge for explanations is optional and should be labeled as weak evidence.
- **Does it help vs the base formula?** Paired comparison per seed (Ember order vs formula order), plus interleaving of the two (item 3 machinery, reused). Report the win rate honestly, including ties.

## What to say in Q&A

- "We have no users, so we test promises, not averages." (Item 2.)
- "We built the measurement the way Netflix, Airbnb and Spotify do, and ran it on personas." (Item 3.)
- "Our weights are priors. The logger records propensities so a real A/B or replay can tune them." (Item 8.)
- "Simulator results can mislead, so we report across several persona sets and never tuned on the reporting set."

## Sources

- [S1] Spotify, "Navigating the Evaluation Funnel to Optimize Iteration Speed for Recommender Systems" [opened]: https://arxiv.org/html/2404.08671v1
- [S2] Netflix Tech Blog, "Interleaving in Online Experiments at Netflix" [opened]: https://netflixtechblog.com/interleaving-in-online-experiments-at-netflix-a04ee392ec55
- [S3] Airbnb Engineering, "Beyond A/B Test: Speeding up Airbnb Search Ranking Experimentation through Interleaving" [opened]: https://medium.com/airbnb-engineering/beyond-a-b-test-speeding-up-airbnb-search-ranking-experimentation-through-interleaving-7087afa09c8e
- [S4] Spotify Confidence glossary, Interleaving [opened]: https://confidence.spotify.com/glossary/interleaving.md
- [S5] Meta, "Incorporating More Feedback Into News Feed Ranking" [opened]: https://about.fb.com/news/2021/04/incorporating-more-feedback-into-news-feed-ranking/
- [S6] Meta Engineering, "How machine learning powers Facebook's News Feed ranking algorithm" [opened]: https://engineering.fb.com/2021/01/26/core-infra/news-feed-ranking/ and Meta, "Using Surveys to Make News Feed More Personal" [opened]: https://about.fb.com/news/2019/05/more-personalized-experiences/
- [S7] YouTube, "On YouTube's Recommendation System" (self-reported figures) [opened]: https://blog.youtube/inside-youtube/on-youtubes-recommendation-system/
- [S8] Krichene and Rendle, "On Sampled Metrics for Item Recommendation" (KDD 2020) [opened]: https://research.google/pubs/on-sampled-metrics-for-item-recommendation/
- [S9] RecSim [opened]: https://arxiv.org/abs/1909.04847
- [S10] RecoGym [opened]: https://arxiv.org/abs/1808.00720
- [S11] Virtual-Taobao [opened]: https://arxiv.org/abs/1805.10000
- [S12] KuaiSim [opened]: https://arxiv.org/abs/2309.12645v2
- [S13] RecAgent, "User Behavior Simulation with LLM-based Agents" [opened]: https://arxiv.org/abs/2306.02552
- [S14] Chia et al., RecList [opened]: https://arxiv.org/abs/2111.09963
- [S15] Masthoff, "Group Modeling: Selecting a Sequence of Television Items to Suit a Group of Viewers" [opened; first 100k characters]: https://abdn.elsevierpure.com/files/4013726/UMUAI04.pdf
- [S16] Hou et al., "Large Language Models are Zero-Shot Rankers for Recommender Systems" [opened]: https://arxiv.org/abs/2305.08845
- [S17] "Large Language Models are Not Stable Recommender Systems" [opened]: https://arxiv.org/abs/2312.15746
- [S18] "LLM as Explainable Re-Ranker for Recommendation System" [opened]: https://arxiv.org/html/2512.03439v1
- [S19] Li et al., replay method for contextual bandits [opened]: https://arxiv.org/abs/1003.5956
- [S20] Steck, "Calibrated Recommendations" (RecSys 2018) [opened a mirror; abstract only, divergence choice not confirmed there]: https://scispace.com/papers/calibrated-recommendations-4kfm63hhtr
- [S21] Spotify Research, "Calibrated Recommendations with Contextual Bandits on Spotify Homepage" [opened]: https://research.atspotify.com/2025/9/calibrated-recommendations-with-contextual-bandits-on-spotify-homepage
- [S22] Tintarev and Masthoff, "Evaluating the effectiveness of explanations for recommender systems" [opened; first 100k characters]: https://abdn.elsevierpure.com/files/20864620/USER700.pdf
- [S23] Dudik, Langford, Li, "Doubly Robust Policy Evaluation and Learning" [opened]: https://arxiv.org/abs/1103.4601
- [S24] Meta Analytics, "Estimating the long-run value we give to our users through experiment meta-analysis" [opened]: https://medium.com/meta-analytics/estimating-the-long-run-value-we-give-to-our-users-through-experiment-meta-analysis-6ddb9073b29b
- [S25] Huszar et al., "Algorithmic Amplification of Politics on Twitter" [opened]: https://arxiv.org/abs/2110.11010
- [S26] LinkedIn Engineering, "Detecting interference: an A/B test of A/B tests" [opened]: https://engineering.linkedin.com/blog/2019/06/detecting-interference--an-a-b-test-of-a-b-tests
- [S27] Chapelle et al., "Large-scale validation and analysis of interleaved search evaluation" (listing only, not read): https://www.doi.org/10.1145/2094072.2094078
- [S28] Pinterest Engineering, "Experiment without the wait: Offline Replay Experimentation" [opened]: https://medium.com/pinterest-engineering/experiment-without-the-wait-speeding-up-the-iteration-cycle-with-offline-replay-experimentation-7a4a95fa674b
- [S29] Saito et al., Open Bandit Dataset and Pipeline [opened; abstract names no estimators]: https://arxiv.org/abs/2008.07146v5
- [S30] Agent4Rec, "On Generative Agents in Recommendation" [opened]: https://arxiv.org/abs/2310.10108v3
- [S31] "Beyond Utility: Evaluating LLM as Recommender" [opened; first 100k of 249k characters]: https://arxiv.org/html/2411.00331v1
