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
