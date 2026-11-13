// Checks for game-recs.js. Engine-agnostic: run-node.js runs them in Node, run-jsc.sh in
// JavaScriptCore (the engine the app uses). No require, no DOM.
//
//   runRecsChecks(GameRecs, ok)   where ok(condition, name, detail)
function runRecsChecks(R, ok) {
  "use strict";
  var P = R.params();

  function summary(id, o) {
    var s = { id: id, formula: "dodge", mood: ["playful"], energy: "medium", competition: "friendly", look: "glow", scope: "everyone", isDaily: false, bots: [] };
    for (var k in o) s[k] = o[k];
    return s;
  }
  function goodBots(sec) {
    var b = [];
    for (var i = 0; i < 8; i++) b.push({ skill: i / 7, score: 5 + 40 * (i / 7), sec: sec });
    return b;
  }
  function flatBots(sec) {
    var b = [];
    for (var i = 0; i < 8; i++) b.push({ skill: i / 7, score: 3, sec: sec });
    return b;
  }
  function imp(id, o) {
    var x = { id: id, dwellSec: 3, tookOver: false, runsFinished: 0, replays: 0, saved: false, liked: false, floated: false, openedBoard: false, addedFriend: false, remixed: false, quitMidRun: false, endedSession: false, day: 0 };
    for (var k in o) x[k] = o[k];
    return x;
  }

  // Params
  var P2 = R.params({ stages: { bait: false }, bait: { b0: 0.3 } });
  ok(P2.stages.bait === false && P2.stages.reward === true && P2.bait.b0 === 0.3 && P2.bait.gainGrab === 5, "overrides merge deeply");
  ok(R.params().bait.b0 === -1, "defaults are fresh each time");

  // Stage 1: reward
  var skip = R.rewardOf(imp("a", { dwellSec: 0.4 }), P);
  ok(skip.g === 0 && skip.s === null && skip.quickSkip, "a quick skip is a zero grab");
  var watch = R.rewardOf(imp("a", { dwellSec: 9 }), P);
  ok(Math.abs(watch.g - 0.35) < 1e-9 && !watch.quickSkip, "watching the Burst is a partial grab");
  var fin = R.rewardOf(imp("a", { tookOver: true, runsFinished: 1 }), P);
  ok(fin.g === 1 && Math.abs(fin.s - R._math.sigmoid(0.5)) < 1e-9, "a finished run is sigmoid(0.5)", fin.s);
  var quit = R.rewardOf(imp("a", { tookOver: true, quitMidRun: true }), P);
  ok(quit.s < 0.15, "quitting mid-run is a bad outcome", quit.s);
  var saved = R.rewardOf(imp("a", { tookOver: true, runsFinished: 1, replays: 2, saved: true }), P);
  ok(saved.s > 0.97 && saved.s > fin.s, "replays and a save beat a single run", saved.s);
  var friend = R.rewardOf(imp("a", { tookOver: true, runsFinished: 1, addedFriend: true }), P);
  ok(friend.s > saved.s - 0.05 && friend.s > 0.98, "Add friend is the strongest single signal", friend.s);
  var saveNoPlay = R.rewardOf(imp("a", { saved: true, dwellSec: 2 }), P);
  ok(saveNoPlay.g === 1 && saveNoPlay.s > 0.9, "saving without playing counts (saves are likes)");
  var ctr = R.rewardOf(imp("a", { tookOver: true, quitMidRun: true }), R.params({ stages: { reward: false } }));
  ok(ctr.g === 1 && ctr.v === 1 && ctr.s === null, "CTR mode only sees the takeover");

  // Bot prior
  var bqGood = R.botQuality(goodBots(25), P), bqFlat = R.botQuality(flatBots(2), P);
  ok(bqGood && bqGood.mean > 0.7, "skill-driven, well-paced bots give a high prior", bqGood && bqGood.mean);
  ok(bqFlat && bqFlat.mean <= 0.36, "flat scores and 2-second runs give a low prior", bqFlat && bqFlat.mean);
  ok(R.botQuality([{ skill: 0.5, score: 3, sec: 10 }], P) === null, "fewer than 3 bot runs is no prior");

  // Manifest hook prior
  var hype = R.describe(summary("h", { formula: "dodge", energy: "high", mood: ["chaotic"], look: "neon" }), P);
  var calm = R.describe(summary("c", { formula: "guess", energy: "low", mood: ["cozy"], look: "ink", scope: "group", isDaily: true }), P);
  ok(hype.hookPrior > 0.85 && calm.hookPrior < 0.15, "dodge/neon/chaotic is hooky; a cozy Daily guess isn't", hype.hookPrior.toFixed(2) + " vs " + calm.hookPrior.toFixed(2));
  ok(hype.x.length === R._dims.DIM, "feature vector has the right size");

  // Ranking basics
  var sums = [], cands = [];
  for (var i = 0; i < 10; i++) {
    var f = R._dims.FORMULAS[i % 7];
    sums.push(summary("b" + i, { formula: f, bots: goodBots(20) }));
    cands.push({ gameID: "b" + i, reason: "popular", runUserID: null, weight: 0.8 });
  }
  var S = R.newState(), me = R.userIn(S, "me");
  var out = R.rank(S, me, { candidates: cands, summaries: sums, feed: [], count: 12, seed: 7, day: 0 }, P);
  ok(out.picks.length === 12, "rank fills every slot");
  var repeatOK = true;
  for (var j = 0; j < out.picks.length; j++) {
    for (var k2 = Math.max(0, j - 4); k2 < j; k2++) if (out.picks[k2].gameID === out.picks[j].gameID) repeatOK = false;
  }
  ok(repeatOK, "no Bubble repeats within 4 pages");
  var again = R.rank(S, me, { candidates: cands, summaries: sums, feed: [], count: 12, seed: 7, day: 0 }, P);
  ok(JSON.stringify(again.picks.map(function (p) { return p.gameID; })) === JSON.stringify(out.picks.map(function (p) { return p.gameID; })), "same seed and state, same feed");
  ok(R.rank(S, me, { candidates: [], summaries: sums, feed: [], count: 5, seed: 1 }, P).picks.length === 0, "no candidates, no picks");
  var one = R.rank(S, me, { candidates: [cands[0]], summaries: sums, feed: ["b0"], count: 3, seed: 1 }, P);
  ok(one.picks.length === 3 && one.picks[0].gameID === "b0", "a single candidate still fills the feed");

  // Bait appetite: a person who skips hooky Bubbles and enjoys calm ones drifts below b0, and a
  // person who loves hooky ones drifts above it.
  var bsums = [
    summary("hook1", { formula: "dodge", energy: "high", mood: ["hype"], look: "neon", bots: goodBots(20) }),
    summary("hook2", { formula: "time", energy: "high", mood: ["chaotic"], look: "pixel", bots: goodBots(20) }),
    summary("calm1", { formula: "guess", energy: "low", mood: ["calm"], look: "ink", bots: goodBots(30) }),
    summary("calm2", { formula: "group", energy: "low", mood: ["cozy"], look: "paper", bots: goodBots(30) })
  ];
  var S2 = R.newState(), averse = R.userIn(S2, "averse"), lover = R.userIn(S2, "lover");
  R.describeAll(bsums, P);
  for (var t = 0; t < 12; t++) {
    R.observe(S2, averse, imp("hook" + (1 + t % 2), { dwellSec: 0.5 }), P);
    R.observe(S2, averse, imp("calm" + (1 + t % 2), { tookOver: true, runsFinished: 1, replays: 1 }), P);
    R.observe(S2, lover, imp("hook" + (1 + t % 2), { tookOver: true, runsFinished: 1, replays: 2 }), P);
    R.observe(S2, lover, imp("calm" + (1 + t % 2), { dwellSec: 0.5 }), P);
  }
  R.endSession(averse); R.endSession(lover);
  var la = R.baitLean(averse, P, S2), ll = R.baitLean(lover, P, S2);
  ok(la.appetite < -0.5 && la.lean < P.bait.b0 - 0.5, "bait-averse lean drops below b0", la.lean.toFixed(2));
  ok(ll.appetite > 0.5 && ll.lean > P.bait.b0 + 0.5, "bait-loving lean rises above b0", ll.lean.toFixed(2));
  var fresh = R.newUser();
  ok(Math.abs(R.baitLean(fresh, P, R.newState()).lean - P.bait.b0) < 1e-9, "a new person starts at b0");
  var tired = R.newUser();
  tired.recent = [{ hooky: true, bad: true }, { hooky: true, bad: true }];
  ok(Math.abs(R.baitLean(tired, P, R.newState()).lean - (P.bait.b0 - 0.8)) < 1e-9, "two skipped hooky pages in a session cool the lean");

  // Default lean: with no history, a mix of hooky and calm Bubbles comes out mostly calm.
  var mixSums = [], mixCands = [];
  for (var mi = 0; mi < 6; mi++) {
    mixSums.push(summary("hk" + mi, { formula: mi % 2 ? "dodge" : "time", energy: "high", mood: ["hype"], look: "neon", bots: goodBots(20) }));
    mixSums.push(summary("cm" + mi, { formula: mi % 2 ? "guess" : "group", energy: "low", mood: ["cozy"], look: "paper", bots: goodBots(20) }));
    mixCands.push({ gameID: "hk" + mi, reason: "popular", weight: 1 });
    mixCands.push({ gameID: "cm" + mi, reason: "popular", weight: 1 });
  }
  function highShareFor(Pm) {
    var total = 0;
    for (var sd = 0; sd < 10; sd++) {
      var ps = R.rank(R.newState(), R.newUser(), { candidates: mixCands, summaries: mixSums, feed: [], count: 20, seed: 21 + sd }, Pm).picks;
      total += ps.filter(function (p) { return p.tier === "high"; }).length / ps.length;
    }
    return total / 10;
  }
  var highOn = highShareFor(P), highOff = highShareFor(R.params({ stages: { bait: false } }));
  ok(highOn <= 0.45 && highOn < highOff - 0.1, "a new person's feed leans away from hooky Bubbles (50/50 catalog)", highOn.toFixed(2) + " vs " + highOff.toFixed(2) + " with the bait stage off");

  // Slop guard: same likely-slop Bubble ranks lower for the bait-averse person.
  var slopSums = [
    summary("slop", { formula: "dodge", energy: "high", mood: ["chaotic"], look: "neon", bots: flatBots(2) }),
    summary("fine", { formula: "merge", energy: "medium", mood: ["playful"], look: "clay", bots: goodBots(25) })
  ];
  var S3 = R.newState();
  R.describeAll(slopSums, P);
  for (var q = 0; q < 8; q++) {
    R.observe(S3, R.userIn(S3, "crowd"), imp("slop", { tookOver: true, quitMidRun: true }), P);
    R.observe(S3, R.userIn(S3, "crowd"), imp("fine", { tookOver: true, runsFinished: 1, replays: 1 }), P);
  }
  var sv = R.itemView(S3, "slop", P, 0);
  ok(sv.pSlop > 0.8 && !sv.unproven, "a Bubble people keep quitting is likely slop", sv.pSlop.toFixed(2));
  S3.users.averse = averse; S3.users.lover = lover;
  var slopCands = [{ gameID: "slop", reason: "popular", weight: 1 }, { gameID: "fine", reason: "popular", weight: 1 }];
  var Pg = R.params({ stages: { bandit: false, calibration: false } });
  var ra = R.rank(S3, averse, { candidates: slopCands, summaries: slopSums, feed: [], count: 1, seed: 3 }, Pg).picks[0];
  var rl = R.rank(S3, lover, { candidates: slopCands, summaries: slopSums, feed: [], count: 1, seed: 3 }, Pg);
  var lp = R.rank(S3, lover, { candidates: [slopCands[0]], summaries: slopSums, feed: [], count: 1, seed: 3 }, Pg).picks[0];
  var ap = R.rank(S3, averse, { candidates: [slopCands[0]], summaries: slopSums, feed: [], count: 1, seed: 3 }, Pg).picks[0];
  ok(ra.gameID === "fine", "the bait-averse person gets the good Bubble");
  ok(ap.parts.slop < lp.parts.slop - 0.5, "the slop penalty is much bigger for the bait-averse person", ap.parts.slop.toFixed(2) + " vs " + lp.parts.slop.toFixed(2));
  ok(rl.picks.length === 1, "the bait-loving person still gets a pick");

  // Unproven cap: low-tolerance people see fewer untested Bubbles.
  var capSums = [], capCands = [];
  for (var u = 0; u < 12; u++) {
    capSums.push(summary("n" + u, { formula: R._dims.FORMULAS[u % 7], bots: goodBots(20) }));
    capCands.push({ gameID: "n" + u, reason: "popular", weight: 1 });
  }
  var S4 = R.newState();
  R.describeAll(capSums, P);
  for (var w = 0; w < 6; w++) {
    for (var z = 0; z < 6; z++) R.observe(S4, R.userIn(S4, "crowd"), imp("n" + w, { tookOver: true, runsFinished: 1 }), P);
  }
  S4.users.averse = averse;
  var capPicks = R.rank(S4, averse, { candidates: capCands, summaries: capSums, feed: [], count: 20, seed: 5 }, P).picks;
  var unprovenShare = capPicks.filter(function (p) { return p.unproven; }).length / capPicks.length;
  var capLimit = P.bait.unprovenBase + P.bait.unprovenSpan * R.baitLean(averse, P, S4).tolerance;
  ok(unprovenShare <= capLimit + 0.06, "unproven share stays under the cap for the bait-averse person", unprovenShare.toFixed(2) + " <= " + capLimit.toFixed(2));

  // Calibration: someone who enjoys dodge and guess equally keeps getting both even when dodge scores higher.
  var calSums = [], calCands = [];
  for (var c = 0; c < 6; c++) {
    calSums.push(summary("d" + c, { formula: "dodge", mood: ["playful"], energy: "medium", look: "glow", bots: goodBots(20) }));
    calSums.push(summary("g" + c, { formula: "guess", mood: ["playful"], energy: "medium", look: "glow", bots: goodBots(20) }));
    calCands.push({ gameID: "d" + c, reason: "popular", weight: 2 });
    calCands.push({ gameID: "g" + c, reason: "popular", weight: 0.5 });
  }
  var S5 = R.newState(), cu = R.userIn(S5, "me");
  cu.cal.formula = { dodge: 10, guess: 10 };
  var Pnc = R.params({ stages: { calibration: false, bandit: false, bait: false } });
  var Pc = R.params({ stages: { calibration: true, bandit: false, bait: false } });
  var share = function (ps) { return ps.filter(function (p) { return p.gameID[0] === "g"; }).length / ps.length; };
  var Pstrong = R.params({ stages: { calibration: true, bandit: false, bait: false }, calibration: { lambda: 0.75 } });
  var noCal = R.rank(S5, cu, { candidates: calCands, summaries: calSums, feed: [], count: 24, seed: 9 }, Pnc).picks;
  var withCal = R.rank(S5, cu, { candidates: calCands, summaries: calSums, feed: [], count: 24, seed: 9 }, Pc).picks;
  var strongCal = R.rank(S5, cu, { candidates: calCands, summaries: calSums, feed: [], count: 24, seed: 9 }, Pstrong).picks;
  ok(share(noCal) === 0 && share(withCal) >= 0.2, "calibration brings guess back even against a 4x reason weight", share(noCal).toFixed(2) + " -> " + share(withCal).toFixed(2));
  ok(share(strongCal) >= 0.4 && share(strongCal) > share(withCal), "a higher lambda pulls closer to the 50% target", share(strongCal).toFixed(2));
  var late = strongCal.slice(12);
  ok(share(late) >= 0.35, "calibration holds deep into the feed (sliding window)", share(late).toFixed(2));

  // Cold start: a young Bubble borrows its sat prior from similar proven ones.
  var csSums = [summary("old1", { formula: "merge", look: "clay" }), summary("old2", { formula: "merge", look: "clay" }), summary("young", { formula: "merge", look: "clay" })];
  var S6 = R.newState();
  R.describeAll(csSums, P);
  for (var y = 0; y < 10; y++) {
    R.observe(S6, R.userIn(S6, "crowd"), imp("old1", { tookOver: true, runsFinished: 1, replays: 2, saved: y % 2 === 0 }), P);
    R.observe(S6, R.userIn(S6, "crowd"), imp("old2", { tookOver: true, runsFinished: 1, replays: 2 }), P);
  }
  var yv = R.itemView(S6, "young", P, 0);
  var yvOff = R.itemView(S6, "young", R.params({ stages: { coldStart: false } }), 0);
  ok(yv.neighborSat !== null && yv.sat > yvOff.sat + 0.05, "a young Bubble borrows from similar loved ones", yvOff.sat.toFixed(2) + " -> " + yv.sat.toFixed(2));

  // Decay
  var S7 = R.newState();
  R.describeAll([summary("dk", {})], P);
  R.observe(S7, R.userIn(S7, "me"), imp("dk", { tookOver: true, runsFinished: 1, day: 0 }), P);
  var later = R.itemView(S7, "dk", P, 30);
  ok(Math.abs(later.ev.n - Math.pow(0.97, 30)) < 1e-9, "evidence decays per day");

  // App bridge round trip
  var A = R.app;
  var loaded = JSON.parse(A.load(null, JSON.stringify({ stages: { calibration: true } })));
  ok(loaded.ok && loaded.version === R.version, "app.load works with no saved state");
  var ranked = JSON.parse(A.rank(JSON.stringify({ candidates: cands, summaries: sums, feed: [], count: 4, seed: 11, day: 3 })));
  ok(ranked.picks.length === 4, "app.rank returns picks");
  A.observe(JSON.stringify(imp(ranked.picks[0].gameID, { tookOver: true, runsFinished: 1, day: 3 })));
  var exported = A.exportState();
  var reloaded = JSON.parse(A.load(exported, null));
  ok(reloaded.items >= 1 && JSON.parse(A.exportState()).users.me.n === 1, "state survives export and reload");
  ok(JSON.parse(A.load("not json", null)).ok, "corrupt saved state starts fresh");
  ok(typeof JSON.parse(A.debugSummary()).bait.lean === "number", "debug summary has the bait lean");

  // Thompson sampling sanity
  var r = R._math.rng(42), sum = 0;
  for (var s = 0; s < 4000; s++) sum += R._math.betaSample(r, 3, 7);
  ok(Math.abs(sum / 4000 - 0.3) < 0.02, "Beta(3,7) samples average 0.3", (sum / 4000).toFixed(3));
  var r2 = R._math.rng(43), small = 0;
  for (var s2 = 0; s2 < 2000; s2++) small += R._math.betaSample(r2, 0.4, 0.6);
  ok(Math.abs(small / 2000 - 0.4) < 0.04, "Beta with shape < 1 samples correctly", (small / 2000).toFixed(3));
  ok(Math.abs(R._math.phi(0) - 0.5) < 1e-6 && Math.abs(R._math.phi(1.96) - 0.975) < 1e-3, "normal CDF");

  // Social moments (docs/BUBBLES.md 7.1)
  var plain = R.rewardOf(imp("a", { tookOver: true, runsFinished: 1 }), P);
  var challenged = R.rewardOf(imp("a", { tookOver: true, runsFinished: 1, social: ["challenge_sent"] }), P);
  ok(challenged.s > plain.s, "a challenge sent from a page makes it a better page", plain.s.toFixed(3) + " -> " + challenged.s.toFixed(3));
  var twice = R.rewardOf(imp("a", { tookOver: true, runsFinished: 1, social: ["challenge_sent", "challenge_sent"] }), P);
  ok(Math.abs(twice.s - challenged.s) < 1e-12, "the same kind twice on one page counts once");
  var noPlay = R.rewardOf(imp("a", { dwellSec: 0.5, social: ["share"] }), P);
  ok(noPlay.g === 1 && noPlay.s !== null && !noPlay.quickSkip, "sharing without playing still counts as engaged");
  ok(R.socialSum(["something_new"], P) === P.reward.socialDefault, "an unknown kind counts a little");
  var Ss = R.newState(), us = R.newUser();
  R.describeAll([summary("soc", { bots: goodBots(20) })], P);
  var before = R.itemView(Ss, "soc", P, 0).sat;
  var sigOut = R.signal(Ss, us, { id: "soc", kind: "group_chat_play", with: ["u1", "u2"], day: 0 }, P);
  var after = R.itemView(Ss, "soc", P, 0).sat;
  ok(sigOut.item && after > before, "an off-feed group-chat play raises the Bubble's satisfaction", before.toFixed(3) + " -> " + after.toFixed(3));
  ok(Ss.items.soc.g1 === 0 && Ss.items.soc.g0 === 0, "off-feed moments add no grab evidence");
  ok(Ss.social.with.u1 === 1 && Ss.social.kinds.group_chat_play === 1, "who you played with is counted");
  var Poff = R.params({ stages: { reward: false } });
  var Soff = R.newState();
  R.signal(Soff, R.newUser(), { id: "soc", kind: "saved", day: 0 }, Poff);
  ok(!Soff.items.soc, "with the reward stage off, off-feed moments don't touch the posteriors");
  A.load(null, null);
  ok(JSON.parse(A.signal(JSON.stringify({ id: "x", kind: "add_friend_from_game", with: ["p"], day: 1 }))).w === 4, "app.signal works");
}

if (typeof module !== "undefined" && module.exports) module.exports = runRecsChecks;

// Group Blend checks.
function runBlendChecks(R, ok) {
  "use strict";
  var P = R.params();
  function summary(id, o) {
    var s = { id: id, formula: "dodge", mood: ["playful"], energy: "medium", competition: "friendly", look: "glow", scope: "everyone", isDaily: false, bots: [] };
    for (var k in o) s[k] = o[k];
    return s;
  }
  function profile(id, o) {
    var base = R.syntheticProfile({ id: id, name: id, skill: { overall: 0.5 } }, P);
    for (var k in o) base[k] = o[k];
    return base;
  }
  function shares(keys, hot, w) {
    var m = {};
    keys.forEach(function (k) { m[k] = hot === k ? w : (1 - w) / (keys.length - 1); });
    return m;
  }
  var F = R._dims.FORMULAS, M = R._dims.MOODS;

  // Synthetic profiles are deterministic and steered by bios.
  var a1 = R.syntheticProfile({ id: "sf-x", name: "X", hints: { bio: "I organize a Thursday trivia team" } }, P);
  var a2 = R.syntheticProfile({ id: "sf-x", name: "X", hints: { bio: "I organize a Thursday trivia team" } }, P);
  ok(JSON.stringify(a1) === JSON.stringify(a2), "synthetic profiles are deterministic");
  var hints = R.hintsFromBio("Looking for people to run Lands End with on Saturday mornings");
  ok(hints.likes.indexOf("dodge") >= 0 && hints.moods.indexOf("hype") >= 0, "a running bio steers toward dodge and hype");

  // Similarity: identical tastes score higher than opposite ones, and it's symmetric.
  var calmGuess = profile("a", { formula: shares(F, "guess", 0.7), mood: shares(M, "calm", 0.7), lean: -1.5 });
  var calmGuess2 = profile("b", { formula: shares(F, "guess", 0.65), mood: shares(M, "calm", 0.6), lean: -1.2 });
  var hypeDodge = profile("c", { formula: shares(F, "dodge", 0.7), mood: shares(M, "hype", 0.7), lean: 0.8 });
  var sAB = R.similarity(calmGuess, calmGuess2, P), sAC = R.similarity(calmGuess, hypeDodge, P);
  ok(sAB > sAC + 0.15, "similar tastes are more similar", sAB.toFixed(2) + " vs " + sAC.toFixed(2));
  ok(Math.abs(R.similarity(calmGuess, hypeDodge, P) - R.similarity(hypeDodge, calmGuess, P)) < 1e-12, "similarity is symmetric");

  // Skill fairness is only ever a plus, and exactly 0 past the band.
  var lo = profile("lo", {}), hi = profile("hi", {});
  lo.skill = { overall: 0.2, byFormula: {} }; hi.skill = { overall: 0.9, byFormula: {} };
  F.forEach(function (f) { lo.skill.byFormula[f] = 0.2; hi.skill.byFormula[f] = 0.9; });
  var same = profile("same", {}); same.skill = { overall: 0.2, byFormula: {} };
  F.forEach(function (f) { same.skill.byFormula[f] = 0.21; });
  ok(R.skillPlus([lo, hi], "dodge", P) === 0, "very different skills earn exactly 0");
  ok(R.skillPlus([lo, same], "dodge", P) > 0.4, "matching skills earn the bonus");
  var mid = profile("mid", {}); mid.skill = { overall: 0.35, byFormula: {} };
  F.forEach(function (f) { mid.skill.byFormula[f] = 0.35; });
  var midPlus = R.skillPlus([lo, mid], "dodge", P);
  ok(midPlus > 0 && midPlus < R.skillPlus([lo, same], "dodge", P), "the bonus fades as skills diverge", midPlus.toFixed(2));

  // Group ranking: a game one member hates loses to one everyone likes (geometric mean + floor).
  var sums = [
    summary("calm-guess", { formula: "guess", mood: ["calm"], energy: "low", look: "ink" }),
    summary("hype-dodge", { formula: "dodge", mood: ["chaotic"], energy: "high", look: "neon" }),
    summary("playful-answer", { formula: "answer", mood: ["playful"], energy: "medium", look: "paper" })
  ];
  function two(keys, a, wa, b, wb) {
    var m = {}, rest = (1 - wa - wb) / (keys.length - 2);
    keys.forEach(function (k) { m[k] = k === a ? wa : k === b ? wb : rest; });
    return m;
  }
  // A loves calm guessing, C loves fast dodging, and both like trivia some; "both" loves trivia.
  var gA = profile("a", { formula: two(F, "guess", 0.5, "answer", 0.3), mood: two(M, "calm", 0.5, "playful", 0.3), lean: -1 });
  var gC = profile("c", { formula: two(F, "dodge", 0.5, "answer", 0.3), mood: two(M, "hype", 0.5, "playful", 0.3), lean: 0 });
  var both = profile("both", { formula: shares(F, "answer", 0.5), mood: shares(M, "playful", 0.5), lean: -0.5 });
  var S = R.newState();
  var members = [{ id: "a", profile: gA }, { id: "c", profile: gC }, { id: "both", profile: both }];
  var out = R.groupBlend(S, null, { group: { id: "g", name: "G" }, members: members, summaries: sums, feed: [], count: 3 }, P);
  ok(out.picks.length === 3 && out.picks[0].gameID === "playful-answer", "the game everyone can enjoy comes first", out.picks.map(function (p) { return p.gameID; }).join(","));
  ok(out.picks.every(function (p) { return p.everyone > 0 && p.everyone <= 1; }), "all-enjoy scores are probabilities");
  var mean = R.groupBlend(S, null, { group: { id: "g", name: "G" }, members: members, summaries: sums, feed: [], count: 3 }, R.params({ blend: { aggregate: "mean" } }));
  ok(mean.aggregate === "mean" && mean.picks.length === 3, "other aggregations run");
  ok(typeof out.spec.prompt === "string" && out.spec.prompt.indexOf("G") >= 0 && F.indexOf(out.spec.formula) >= 0, "the Blend spec names a formula and the Group");
  ok(out.spec.energy === "low" || out.spec.energy === "medium", "Blend energy follows the least bait-tolerant member", out.spec.energy);
  ok(out.cohesion > 0 && out.cohesion < 1, "cohesion is between 0 and 1");

  // No repeats; shown pages are excluded.
  var again = R.groupBlend(S, null, { group: { id: "g", name: "G" }, members: members, summaries: sums, feed: ["playful-answer"], count: 3 }, P);
  ok(again.picks.length === 2 && again.picks.every(function (p) { return p.gameID !== "playful-answer"; }), "games already in the Blend aren't repeated");

  // Group games and member-made games get a social plus.
  var social = [summary("plain", { formula: "answer", mood: ["playful"] }), summary("ours", { formula: "answer", mood: ["playful"], groupID: "g", creatorID: "a" })];
  var so = R.groupBlend(S, null, { group: { id: "g", name: "G" }, members: members, summaries: social, feed: [], count: 2 }, P);
  ok(so.picks[0].gameID === "ours", "the Group's own game wins a tie");

  // Taste twins: only people who aren't friends yet, through the app bridge with "me".
  R.app.load("", "");
  var bridged = JSON.parse(R.app.groupBlend(JSON.stringify({
    group: { id: "g", name: "G" },
    members: [{ id: "me", name: "You", isMe: true, skill: { overall: 0.5 } },
      { id: "p1", name: "Ana", isFriend: false, skill: { overall: 0.5 }, hints: { bio: "trivia night" } },
      { id: "p2", name: "Ben", isFriend: true, skill: { overall: 0.5 }, hints: { bio: "trivia night" } }],
    summaries: sums, feed: [], count: 3
  })));
  ok(bridged.picks.length === 3 && bridged.twins.every(function (t) { return t.userID !== "p2"; }), "twins skip people who are already friends");
  ok(bridged.twins.length === 1 && /You and Ana both like/.test(bridged.twins[0].why), "twins come with a why line", bridged.twins[0] && bridged.twins[0].why);
  var pairOut = R.groupBlend(S, null, { group: { id: "g", name: "G" }, members: [{ id: "a", profile: gA }, { id: "both", profile: both }], summaries: sums, feed: [], count: 2 }, P);
  ok(/^You both like/.test(pairOut.spec.why), "a pair Blend reads as two people", pairOut.spec.why);
}

if (typeof module !== "undefined" && module.exports) module.exports.runBlendChecks = runBlendChecks;

// Team-draft interleaving: the merge, the credit, the tally and the app bridge.
function runInterleaveChecks(R, ok) {
  "use strict";
  var F = ["dodge", "time", "merge", "guess", "group", "answer"], M = ["calm", "warm", "playful", "hype"];
  var sums = [], cands = [];
  for (var i = 0; i < 10; i++) {
    sums.push({ id: "g" + i, formula: F[i % F.length], mood: [M[i % M.length]], energy: i % 3 === 0 ? "high" : "medium", competition: "friendly", look: "glow", scope: "everyone", isDaily: i === 0, bots: [] });
    cands.push({ gameID: "g" + i, reason: i % 2 ? "popular" : "friendBurst", runUserID: null, weight: 1 + (i % 4) });
  }
  function input(seed, count, feed) { return { candidates: cands, summaries: sums, feed: feed || [], count: count || 6, seed: seed, day: 2 }; }
  function imp(id, o) {
    var x = { id: id, dwellSec: 3, tookOver: false, runsFinished: 0, replays: 0, saved: false, liked: false, floated: false, openedBoard: false, addedFriend: false, remixed: false, quitMidRun: false, endedSession: false, day: 2 };
    for (var k in o) x[k] = o[k];
    return x;
  }
  function ids(list) { return list.map(function (p) { return p.gameID; }); }
  function isSubsequence(sub, full) {
    var j = 0;
    for (var k = 0; k < full.length && j < sub.length; k++) if (full[k] === sub[j]) j++;
    return j === sub.length;
  }
  var good = { tookOver: true, runsFinished: 1, replays: 2 };

  ok(R.params().interleave.on === false && R.params().interleave.against === "baseline", "interleaving is off by default, against today's feed");

  // The merge
  var Pi = R.params({ interleave: { on: true } });
  var S = R.newState(), u = R.newUser();
  var out = R.interleave(S, u, input(5), Pi);
  var got = ids(out.picks), seen = {};
  ok(out.picks.length === 6 && got.every(function (g) { var dup = seen[g]; seen[g] = true; return !dup; }), "a merged page has the asked count and no repeats", got.join(","));
  ok(Math.abs(out.interleave.A - out.interleave.B) <= 1 && out.interleave.A + out.interleave.B === 6, "each side gets half the slots", out.interleave.A + " vs " + out.interleave.B);
  var a = R.rank(S, R.newUser(), input(5), Pi), b = R.baseline(input(5));
  var aTeam = out.picks.filter(function (p) { return p.team === "A"; }), bTeam = out.picks.filter(function (p) { return p.team === "B"; });
  ok(isSubsequence(ids(aTeam), ids(a.picks)), "the formula's picks keep the formula's order");
  ok(isSubsequence(ids(bTeam), ids(b.picks)), "the control's picks keep the control's order");
  ok(got[0] === a.picks[0].gameID || got[0] === b.picks[0].gameID, "the first slot goes to one side's top pick");
  var again = R.interleave(R.newState(), R.newUser(), input(5), Pi);
  ok(ids(again.picks).join() === got.join() && again.picks.map(function (p) { return p.team; }).join() === out.picks.map(function (p) { return p.team; }).join(), "the same seed gives the same merge");
  var firstA = 0;
  for (var s = 0; s < 400; s++) {
    var o = R.interleave(R.newState(), R.newUser(), input(1000 + s, 2), Pi);
    var top = R.rank(R.newState(), R.newUser(), input(1000 + s, 2), Pi).picks[0].gameID, base = R.baseline(input(1000 + s, 2)).picks[0].gameID;
    if (top !== base && o.picks[0].team === "A") firstA++;
    else if (top === base) firstA += 0.5;
  }
  ok(firstA / 400 > 0.4 && firstA / 400 < 0.6, "a fair coin decides who picks first", (firstA / 400).toFixed(2));

  // Credit and the session tally
  var S2 = R.newState(), u2 = R.newUser();
  var m = R.interleave(S2, u2, input(7), Pi);
  var pa = m.picks.filter(function (p) { return p.team === "A"; })[0], pb = m.picks.filter(function (p) { return p.team === "B"; })[0];
  var ra = R.observe(S2, u2, imp(pa.gameID, good), Pi);
  var rb = R.observe(S2, u2, imp(pb.gameID, { dwellSec: 0.4 }), Pi);
  ok(ra.team === "A" && rb.team === "B", "each page is traced to the side that picked it");
  ok(u2.inter.session.A.points === 1 && u2.inter.session.B.points === 0, "an enjoyed page earns its side a point; a skip earns nothing");
  ok(R.observe(S2, u2, imp("not-shown", good), Pi).team === null, "a page the merge didn't pick counts for nobody");
  R.endSession(u2, S2);
  var st = R.interleaveStats(S2).baseline;
  ok(st && st.sessions === 1 && st.formulaWins === 1 && st.controlWins === 0 && st.ties === 0, "the session goes to the side with more points");
  ok(u2.inter.session === null && Object.keys(u2.inter.pending).length === 0, "ending a session clears what's pending");

  m = R.interleave(S2, u2, input(8), Pi);
  pa = m.picks.filter(function (p) { return p.team === "A"; })[0];
  R.observe(S2, u2, imp(pa.gameID, { tookOver: true, quitMidRun: true }), Pi);
  ok(u2.inter.session.A.engaged === 1 && u2.inter.session.A.points === 0, "a grab without enjoyment isn't a point");
  R.endSession(u2, S2);
  ok(R.interleaveStats(S2).baseline.ties === 1, "no points on either side is a tie");

  m = R.interleave(S2, u2, input(9), Pi);
  pb = m.picks.filter(function (p) { return p.team === "B"; })[0];
  R.observe(S2, u2, imp(pb.gameID, { saved: true, dwellSec: 2 }), Pi);
  R.endSession(u2, S2);
  st = R.interleaveStats(S2).baseline;
  ok(st.controlWins === 1 && st.sessions === 3 && Math.abs(st.preference - 0.5) < 1e-9, "the control can win too; preference counts ties as half", JSON.stringify(st));
  R.endSession(u2, S2);
  ok(R.interleaveStats(S2).baseline.sessions === 3, "a session with no interleaved pages isn't counted");

  // The judge doesn't move when the formula is tuned.
  var Pt = R.params({ interleave: { on: true }, reward: { w: { finished: -5 }, r0: 3 } });
  var S3 = R.newState(), u3 = R.newUser();
  var m3 = R.interleave(S3, u3, input(10), Pt);
  R.observe(S3, u3, imp(m3.picks[0].gameID, { tookOver: true, runsFinished: 1 }), Pt);
  ok(u3.inter.session[m3.picks[0].team].points === 1, "credit uses the default reward weights, not the tuned ones");

  // Controls: the formula with a part switched off
  var Pv = R.params({ interleave: { on: true, against: "noCalibration" } });
  var S4 = R.newState(), u4 = R.newUser();
  var mv = R.interleave(S4, u4, input(11, 8), Pv);
  var noCal = R.rank(S4, R.newUser(), input(11, 8), R.params({ stages: { calibration: false } }));
  ok(mv.interleave.against === "noCalibration" && isSubsequence(ids(mv.picks.filter(function (p) { return p.team === "B"; })), ids(noCal.picks)), "a variant control is the formula with that part off");
  var mu = R.interleave(R.newState(), R.newUser(), input(11), R.params({ interleave: { on: true, against: "noSuchThing" } }));
  ok(mu.interleave.against === "baseline", "an unknown control falls back to today's feed");

  // A tiny catalog runs out of distinct games: repeats fill the page and count for nobody.
  var tiny = { candidates: cands.slice(0, 2), summaries: sums.slice(0, 2), feed: [], count: 5, seed: 3, day: 2 };
  var mt = R.interleave(R.newState(), R.newUser(), tiny, Pi);
  ok(mt.picks.length === 5 && mt.picks.filter(function (p) { return p.team === null; }).length === 3, "repeats fill a small catalog without a team", mt.picks.map(function (p) { return p.team; }).join(","));

  // Statistics
  ok(Math.abs(R._math.signTest(8, 10) - 0.109375) < 1e-9, "sign test: 8 of 10 is p = 0.109");
  ok(R._math.signTest(5, 10) === 1 && R._math.signTest(0, 0) === 1, "sign test: an even split is p = 1");
  ok(R._math.signTest(1100, 2000) < 0.001, "sign test: the large-sample branch");
  var w = R._math.wilson(8, 10);
  ok(Math.abs(w[0] - 0.490) < 0.001 && Math.abs(w[1] - 0.943) < 0.001, "Wilson 95% interval for 8 of 10", w.join(","));

  // App bridge
  var A = R.app;
  A.load(null, JSON.stringify({ interleave: { on: true } }));
  var ranked = JSON.parse(A.rank(JSON.stringify(input(12))));
  ok(ranked.interleave && ranked.picks.every(function (p) { return p.team === "A" || p.team === "B"; }), "app.rank interleaves when the flag is on");
  var firstA2 = ranked.picks.filter(function (p) { return p.team === "A"; })[0];
  A.observe(JSON.stringify(imp(firstA2.gameID, good)));
  A.endSession();
  var bridged = JSON.parse(A.interleaveStats());
  ok(bridged.baseline && bridged.baseline.formulaWins === 1, "app.interleaveStats has the tally");
  ok(JSON.parse(A.debugSummary()).interleave.against === "baseline", "the debug summary shows the control");
  A.load(A.exportState(), JSON.stringify({ interleave: { on: true } }));
  ok(JSON.parse(A.interleaveStats()).baseline.sessions === 1, "the tally survives export and reload");
  A.load(null, null);
  ok(JSON.parse(A.rank(JSON.stringify(input(12)))).picks.every(function (p) { return p.team === undefined; }), "with the flag off, app.rank is the plain formula");
}

if (typeof module !== "undefined" && module.exports) module.exports.runInterleaveChecks = runInterleaveChecks;

// The optional Muse re-rank: the prompt, the reply check, the capped term, and the guards.
function runMuseChecks(R, ok) {
  "use strict";
  var F = ["dodge", "time", "merge", "guess", "group", "answer"], M = ["calm", "warm", "playful", "hype"];
  var sums = [], cands = [];
  for (var i = 0; i < 12; i++) {
    sums.push({ id: "m" + i, formula: F[i % F.length], mood: [M[i % M.length]], energy: "medium", competition: "friendly", look: "glow", scope: i === 3 ? "group" : "everyone", isDaily: false, bots: [] });
    cands.push({ gameID: "m" + i, reason: "popular", runUserID: null, weight: 1 });
  }
  function input(seed, count, extra) {
    var x = { candidates: cands, summaries: sums, feed: [], count: count || 6, seed: seed, day: 1 };
    for (var k in extra || {}) x[k] = extra[k];
    return x;
  }
  function imp(id, o) {
    var x = { id: id, dwellSec: 3, tookOver: false, runsFinished: 0, replays: 0, saved: false, liked: false, floated: false, openedBoard: false, addedFriend: false, remixed: false, quitMidRun: false, endedSession: false, day: 1 };
    for (var k in o) x[k] = o[k];
    return x;
  }
  function reply(order, why) { return JSON.stringify({ order: order, why: why || {} }); }

  var Pon = R.params({ muse: { on: true } });
  ok(R.params().muse.on === false, "the Muse layer is off by default");

  // The request
  var S = R.newState(), u = R.newUser();
  R.describeAll(sums, Pon);
  R.observe(S, u, imp("m1", { tookOver: true, runsFinished: 1, replays: 2, saved: true }), Pon);
  R.observe(S, u, imp("m2", { dwellSec: 0.4 }), Pon);
  var req = R.museRequest(S, u, input(5), Pon);
  var known = {};
  cands.forEach(function (c) { known[c.gameID] = true; });
  ok(req.ids.length === 10 && req.ids.every(function (id) { return known[id]; }), "Ember sees the formula's top 10, all real games", req.ids.length);
  ok(/finished a .*replayed it twice, saved it/.test(req.user) && /skipped a /.test(req.user), "recent plays are described in words", req.user.split("\n").slice(0, 3).join(" | "));
  ok(!/\bme\b|@|\.com/.test(req.user) && req.ids.every(function (id) { return req.user.indexOf("- " + id + ":") >= 0; }), "the prompt lists the games and no people");
  var formulaOrder = R.rank(S, u, input(5, 10), R.params()).picks.map(function (p) { return p.gameID; });
  var shuffledSomewhere = false;
  for (var s = 0; s < 5; s++) {
    var q = R.museRequest(S, u, input(20 + s), Pon);
    var f = R.rank(S, u, input(20 + s, 10), R.params()).picks.map(function (p) { return p.gameID; });
    if (q.ids.join() !== f.slice(0, q.ids.length).join()) shuffledSomewhere = true;
  }
  ok(shuffledSomewhere, "candidates reach Ember shuffled, not in the formula's order (position bias)");
  ok(R.museRequest(S, u, input(5), Pon).ids.join() === req.ids.join(), "the same seed gives the same prompt");

  // Checking the reply
  var want = req.ids.slice().reverse();
  var a1 = R.museApply(S, u, "Sure! Here you go: " + reply(want.concat(["made-up-1"]).concat([want[0]]), { m1: "You loved this kind of game" }) + " Enjoy.", Pon, 1000);
  ok(a1.ok && a1.kept === 10 && a1.dropped === 2, "made-up and repeated IDs are dropped and counted; prose around the JSON is fine", JSON.stringify(a1));
  ok(u.museStats.dropped === 2 && Math.abs(R.museStats(u).madeUpIDShare - 2 / 12) < 1e-9, "the made-up-ID share is tracked");
  R.museRequest(S, u, input(5), Pon);
  ok(R.museApply(S, u, "no json here", Pon, 1000).ok === false, "a reply without an order is rejected");
  R.museRequest(S, u, input(5), Pon);
  ok(R.museApply(S, u, reply(["nope", "nada"]), Pon, 1000).ok === false, "a reply naming no real games is rejected");
  ok(R.museApply(R.newState(), R.newUser(), reply(["m1"]), Pon, 1000).ok === false, "a reply with no request behind it is rejected");

  // The capped term
  var u2 = R.newUser(), S2 = R.newState();
  R.museRequest(S2, u2, input(5), Pon);
  var ids2 = u2.musePending.ids.slice();
  R.museApply(S2, u2, reply(ids2), Pon, 1000);
  var top = R.museTerm(u2, ids2[0], Pon, 2000), last = R.museTerm(u2, ids2[ids2.length - 1], Pon, 2000);
  ok(Math.abs(top - 0.6) < 1e-9 && Math.abs(last + 0.6) < 1e-9, "Ember's first pick gets +0.6 and its last -0.6", top + ", " + last);
  ok(R.museTerm(u2, "m-not-ranked", Pon, 2000) === 0, "a game Ember didn't rank gets nothing");
  var big = R.params({ muse: { on: true, w: 5, cap: 0.6 } });
  ok(Math.abs(R.museTerm(u2, ids2[0], big, 2000)) <= 0.6 + 1e-12, "the cap holds even with a big weight");
  ok(R.museTerm(u2, ids2[0], Pon, 1000 + 31 * 60000) === 0, "an order older than 30 minutes is ignored");
  ok(R.museTerm(u2, ids2[0], R.params(), 2000) === 0, "with the layer off, the term is 0");

  // Muse breaks a tie...
  var flat = R.params({ muse: { on: true }, stages: { bandit: false, calibration: false, coldStart: false, bait: false } });
  var twins = [{ id: "tA", formula: "guess", mood: ["calm"], energy: "medium", competition: "friendly", look: "glow", scope: "everyone", isDaily: false, bots: [] },
    { id: "tB", formula: "guess", mood: ["calm"], energy: "medium", competition: "friendly", look: "glow", scope: "everyone", isDaily: false, bots: [] }];
  var tIn = { candidates: [{ gameID: "tA", reason: "popular", weight: 1 }, { gameID: "tB", reason: "popular", weight: 1 }], summaries: twins, feed: [], count: 1, seed: 3, day: 1, now: 2000 };
  var u3 = R.newUser(), S3 = R.newState();
  R.museRequest(S3, u3, tIn, flat);
  R.museApply(S3, u3, reply(["tB", "tA"], { tB: "a calm one to unwind" }), flat, 1000);
  var withMuse = R.rank(S3, u3, tIn, flat).picks[0];
  ok(withMuse.gameID === "tB" && withMuse.museWhy === "a calm one to unwind" && withMuse.parts.muse > 0, "between equal games, Ember's pick wins and brings its why line");
  ok(typeof withMuse.why === "string" && withMuse.why.length > 0, "the formula's own why line is kept next to Ember's");
  // ...but can't lift slop over a good game.
  var S4 = R.newState(), u4 = R.newUser(), crowd = R.userIn(S4, "crowd");
  var pair = [{ id: "good", formula: "merge", mood: ["warm"], energy: "medium", competition: "friendly", look: "glow", scope: "everyone", isDaily: false, bots: [] },
    { id: "slop", formula: "merge", mood: ["warm"], energy: "medium", competition: "friendly", look: "glow", scope: "everyone", isDaily: false, bots: [] }];
  R.describeAll(pair, Pon);
  for (var t = 0; t < 12; t++) {
    R.observe(S4, crowd, imp("good", { tookOver: true, runsFinished: 1, replays: 1 }), Pon);
    R.observe(S4, crowd, imp("slop", { tookOver: true, quitMidRun: true }), Pon);
  }
  var pIn = { candidates: [{ gameID: "good", reason: "popular", weight: 1 }, { gameID: "slop", reason: "popular", weight: 1 }], summaries: pair, feed: [], count: 1, seed: 9, day: 1, now: 2000 };
  R.museRequest(S4, u4, pIn, Pon);
  R.museApply(S4, u4, reply(["slop", "good"]), Pon, 1000);
  var firstPicks = 0;
  for (var z = 0; z < 20; z++) { pIn.seed = 100 + z; if (R.rank(S4, u4, pIn, Pon).picks[0].gameID === "good") firstPicks++; }
  ok(firstPicks >= 19, "Ember can't lift a game people quit over a game they finish", firstPicks + "/20");

  // Interleaving judges it against the formula alone.
  var Pi = R.params({ muse: { on: true }, interleave: { on: true, against: "noMuse" } });
  var S5 = R.newState(), u5 = R.newUser();
  R.museRequest(S5, u5, input(7), Pi);
  R.museApply(S5, u5, reply(u5.musePending.ids.slice().reverse()), Pi, 1000);
  var mix = R.interleave(S5, u5, input(7, 6, { now: 2000 }), Pi);
  var noMuse = R.rank(S5, u5, input(7, 6, { now: 2000 }), R.params({ muse: { on: false } })).picks.map(function (p) { return p.gameID; });
  var bIds = mix.picks.filter(function (p) { return p.team === "B"; }).map(function (p) { return p.gameID; });
  var j = 0;
  noMuse.forEach(function (id) { if (id === bIds[j]) j++; });
  ok(mix.interleave.against === "noMuse" && j === bIds.length, "interleaving against noMuse compares with the formula alone");

  // App bridge
  var A = R.app;
  A.load(null, null);
  ok(JSON.parse(A.museRequest(JSON.stringify(input(5)))).skip === true, "with the flag off, app.museRequest skips");
  A.load(null, JSON.stringify({ muse: { on: true } }));
  var bridged = JSON.parse(A.museRequest(JSON.stringify(input(5))));
  ok(typeof bridged.system === "string" && bridged.ids.length === 10, "app.museRequest returns the prompt");
  var applied = JSON.parse(A.museApply(reply(bridged.ids), 5000));
  ok(applied.ok && applied.kept === 10, "app.museApply takes Ember's raw reply");
  var dbg = JSON.parse(A.debugSummary());
  ok(dbg.muse && dbg.muse.active && dbg.muse.applied === 1 && dbg.muse.madeUpIDShare === 0, "the debug summary shows the Muse layer");
  A.load(A.exportState(), JSON.stringify({ muse: { on: true } }));
  ok(JSON.parse(A.debugSummary()).muse.active, "Ember's order survives export and reload");
  A.load(null, null);
  ok(R._math.firstJSONObject('x {"a": "}{"} y {"b":1}').a === "}{", "the JSON finder handles braces inside strings");

  // "Why" lines name hooks the right way round (fixed in 0.5: calm picks were called hooky).
  var whyBad = 0, whyCalm = 0;
  for (var ws = 0; ws < 30; ws++) {
    R.rank(R.newState(), R.newUser(), input(200 + ws, 8), R.params()).picks.forEach(function (p) {
      if (/hooky/.test(p.why) && p.hook < 0.5) whyBad++;
      if (/calmer pick/.test(p.why)) { whyCalm++; if (p.hook >= 0.5) whyBad++; }
    });
  }
  ok(whyBad === 0 && whyCalm > 0, "why lines call calm games calm and hooky games hooky", "wrong " + whyBad + ", calm " + whyCalm);

  // Repeat window early in a session (fixed in 0.5: a short feed used to block too little).
  var fresh = R.rank(R.newState(), R.newUser(), input(31, 5), R.params()).picks.map(function (p) { return p.gameID; });
  var freshBase = R.baseline(input(31, 5)).picks.map(function (p) { return p.gameID; });
  function distinct(list) { var o = {}; list.forEach(function (x) { o[x] = true; }); return Object.keys(o).length; }
  ok(distinct(fresh) === 5 && distinct(freshBase) === 5, "the first 5 pages of a session never repeat a game", fresh.join(",") + " / " + freshBase.join(","));
}

if (typeof module !== "undefined" && module.exports) module.exports.runMuseChecks = runMuseChecks;
