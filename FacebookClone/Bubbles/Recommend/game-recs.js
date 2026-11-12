// game-recs.js: the games feed recommender, stages 1–4, plus a per-person bait appetite.
//
//   1. Reward      what a page view was worth: takeovers, finished runs, replays, saves, floats,
//                  Add friend and the social moments (challenges, rematches, group-chat plays…);
//                  quick skips and mid-run quits count against. Saves and social moments that
//                  happen off the feed (in Messenger, a Group, a profile) count too, via `signal`.
//   2. Bandit      two Beta posteriors per game, grab = P(takeover | shown) and
//                  sat = P(good outcome | took over), sampled with Thompson sampling. The sat prior
//                  comes from the bot playtests every game already gets.
//   3. Calibration Steck-style greedy re-rank (RecSys '18) so the feed keeps each person's mix of
//                  formulas, moods and hook tiers.
//   4. Cold start  new games lean on their manifest (hook prior, similar games' quality);
//                  established ones lean on their own plays (Netflix's age-weighted blend).
//
// The feed leans away from hooky games by default: satisfaction counts more than grab in the
// score, the calibration targets favor calmer formulas, moods and hook tiers, and each person's
// learned bait lean b_u starts below zero (b0 = -1). b_u still moves with how *they* respond to hooky games, so
// people who love them get more (capped at +1), and people who skip or quit them get fewer. A slop
// guard keeps likely-bad games away from people with low tolerance, and caps how often unproven
// games are tested on them.
//
// No dependencies and no DOM. Runs in JavaScriptCore in the app (GameRecommender.swift) and in
// Node for the simulator and tests (tools/recs-sim). Everything random is seeded.
(function (root) {
  "use strict";

  var VERSION = "0.5.0";

  // ---------------------------------------------------------------------------------------------
  // Parameters

  function defaults() {
    return {
      stages: { reward: true, bandit: true, calibration: true, coldStart: true, bait: true },
      reward: {
        quickSkipSec: 1.2,   // shorter than this without a takeover is a "no"
        watchSec: 6,         // watched the Burst like a reel
        watchGrab: 0.35,
        idleGrab: 0.1,
        w: {
          finished: 1, replayLog: 1.5, saved: 3, floated: 3, addedFriend: 4,
          remixed: 2, liked: 1, openedBoard: 0.5, quitMidRun: -1.5, endedSession: -0.75
        },
        // `BubbleSocialSignalKind` raw values (docs/BUBBLES.md 7.1), plus "saved" for saves made
        // off the feed. Guesses, scaled like the weights above: a moment that pulls in another
        // person counts about as much as a save; Add friend counts most.
        social: {
          challenge_sent: 3, challenge_accepted: 3, challenge_won: 1, challenge_rematch: 3,
          group_chat_play: 2, group_challenge: 3, game_night_play: 2, remix: 2, share: 3,
          co_make_contribution: 3, about_me_play: 2, story_path_shared: 2, lesson_shared: 2,
          add_friend_from_game: 4, saved: 3
        },
        socialDefault: 1,    // an unknown kind still counts a little
        offFeedMass: 0.5,    // an off-feed moment is worth half a page of evidence
        r0: 0.5,             // neutral reward: s = sigmoid((r - r0) / kappa)
        kappa: 1.0,
        exitGrabPenalty: 0.5 // left the tab on a page without playing it
      },
      bandit: {
        decayPerDay: 0.97,
        grabPriorStrength: 3,
        satPriorStrength: 4,       // with bot playtests
        satPriorStrengthNoBots: 2,
        globalGrab: 0.35,
        globalSat: 0.5,
        globalMass: 20,            // pseudo-count behind the global grab rate
        provenAt: 5,               // impressions before a game counts as proven
        grabWeight: 0.6,           // score = grabWeight * logit(grab) + satWeight * logit(sat):
        satWeight: 1.5             // did it pay off counts more than did it grab
      },
      bots: { base: 0.35, skillCorr: 0.25, durationFit: 0.15, minRuns: 3, shortSec: 3, fitLo: 8, fitHi: 60, longSec: 120 },
      coldStart: {
        hookAgeK: 10,        // w = n / (n + k) between manifest hook and observed hook
        neighbors: 5,
        neighborMinN: 3,
        neighborShare: 0.4,  // how much of a young game's sat prior comes from similar games
        tasteWeight: 1.2,
        tasteRampK: 5,
        tasteDecay: 0.97
      },
      bait: {
        b0: -1.0,            // product lean (logit units): below zero leans away from hooky games
        // Appetite = how much more (or less) than everyone else hooks work on this person:
        // b_u = b0 + gainGrab * (slopeGrab_u - slopeGrab_all) + gainSat * (slopeSat_u - slopeSat_all),
        // where slope* regress the page's grab (every page) and satisfaction (after a takeover)
        // on x = 2 * hook - 1, shrunk toward everyone's slope with `shrink` pseudo-pages.
        gainGrab: 5,
        gainSat: 6,
        shrink: 8,
        typicalVar: 0.1,
        popGrabSlope: 0.25,  // prior for everyone's slopes; a single phone compares you to this
        popSatSlope: 0,
        popShrink: 300,
        userDecay: 0.995,
        globalDecay: 0.999,
        min: -2.5,
        max: 1,              // even people who love hooky games aren't flooded with them
        fatiguePer: 0.4,
        fatigueWindow: 6,
        hookyAt: 0.6,
        slopFloor: 0.35,     // sat below this is slop
        slopPenalty: 3,
        unprovenBase: 0.15,  // share of slots unproven games may take: base + span * tolerance
        unprovenSpan: 0.25
      },
      calibration: {
        lambda: 0.5,
        alpha: 0.01,
        history: 10,         // sliding window of pages q is measured over (Steck's list size)
        priorMass: 3,
        decay: 0.98,
        weights: { formula: 1, mood: 0.6, hook: 1 },
        hookPrior: [0.4, 0.35, 0.25],  // low, mid, high hook tiers before anyone plays
        hookTilt: 1.0,       // how hard the bait lean tilts every calibration target
        tiers: [0.4, 0.65]
      },
      feed: { reasonPrior: 1, repeatWindow: 4, repeatFatigue: 0.9, burstRotation: 1.6 },
      // Team-draft interleaving: each feed mixes the formula's picks (team A) with a control's
      // (team B), and a session goes to whichever side's picks you enjoyed more. Off by default.
      interleave: {
        on: false,
        against: "baseline",   // "baseline" (today's weighted-random feed) or one of `variants`
        creditAt: 0.5,         // a page earns its team a point when the judge's satisfaction is this or more
        // The formula with one part switched off, to show each part earns its place.
        variants: {
          noMuse: { muse: { on: false } },
          noCalibration: { stages: { calibration: false } },
          noBait: { stages: { bait: false } },
          noColdStart: { stages: { coldStart: false } },
          noBandit: { stages: { bandit: false } }
        }
      },
      blend: {
        aggregate: "geometric",    // geometric (default), mean, min (least misery) or centroid
        priorMass: 3,              // pseudo-pages of a uniform taste behind every profile's shares
        eps: 0.02,
        simWeights: { taste: 0.35, formula: 0.3, mood: 0.2, lean: 0.15 },
        // A member's predicted enjoyment: sigmoid of quality + how much they like this formula,
        // mood and look (log share vs uniform) + their bait lean on the hook.
        qualityW: 1.0, formulaW: 0.8, moodW: 0.5, lookW: 0.2, leanW: 0.6,
        miseryFloor: 0.12,         // drop games one member is very unlikely to enjoy
        // Fairness is only ever a plus (Kevin's call):
        skillBonus: 0.5,           // members' skills on the game's formula within skillBand: up to +0.5
        skillBand: 0.3,            // skill spread at or past this earns exactly 0
        fairBoost: 0.8,            // members served least so far in this Blend get their picks boosted
        groupGameBonus: 0.4,       // made for this Group (its Daily game, its games)
        memberMadeBonus: 0.3,      // made by someone in the Group
        samePenalty: 0.25,         // variety: each earlier pick with the same formula
        syntheticPages: 30
      }
    };
  }

  function merge(base, over) {
    if (!over || typeof over !== "object") return base;
    for (var k in over) {
      if (!Object.prototype.hasOwnProperty.call(over, k)) continue;
      var v = over[k];
      if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
        merge(base[k], v);
      } else {
        base[k] = v;
      }
    }
    return base;
  }

  function params(overrides) {
    return merge(defaults(), overrides || {});
  }

  // ---------------------------------------------------------------------------------------------
  // Math and seeded randomness

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }
  function logit(p) { p = clamp(p, 1e-4, 1 - 1e-4); return Math.log(p / (1 - p)); }

  // Standard normal CDF (Abramowitz and Stegun 26.2.17).
  function phi(z) {
    var t = 1 / (1 + 0.2316419 * Math.abs(z));
    var d = 0.3989423 * Math.exp(-z * z / 2);
    var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  function hashString(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normal(r) {
    var u = r();
    while (u <= 0) u = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  }

  // Marsaglia and Tsang.
  function gamma(r, k) {
    if (k < 1) {
      var u0 = r();
      while (u0 <= 0) u0 = r();
      return gamma(r, k + 1) * Math.pow(u0, 1 / k);
    }
    var d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      var x, v;
      do { x = normal(r); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      var u = r();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  function betaSample(r, a, b) {
    var x = gamma(r, a), y = gamma(r, b);
    return x / (x + y);
  }

  function betaMean(a, b) { return a / (a + b); }
  function betaVar(a, b) { var s = a + b; return (a * b) / (s * s * (s + 1)); }

  // P(theta < floor) under Beta(a, b), normal approximation.
  function betaBelow(a, b, floor) {
    var m = betaMean(a, b), sd = Math.sqrt(betaVar(a, b));
    return phi((floor - m) / Math.max(sd, 1e-6));
  }

  // ---------------------------------------------------------------------------------------------
  // Item features (stage 4) and the manifest hook prior

  var FORMULAS = ["dodge", "time", "merge", "guess", "group", "answer", "make"];
  var MOODS = ["calm", "warm", "playful", "hype"];
  var LOOKS = ["glow", "paper", "pixel", "neon", "ink", "clay", "riso", "chalk"];
  var SCOPES = ["everyone", "group", "event"];
  var TIERS = ["low", "mid", "high"];
  var MOOD_FAMILY = {
    calm: "calm", chill: "calm", dreamy: "calm", relaxed: "calm", peaceful: "calm", gentle: "calm", serene: "calm", mellow: "calm",
    warm: "warm", cozy: "warm", nostalgic: "warm", supportive: "warm", together: "warm", sweet: "warm", wholesome: "warm",
    playful: "playful", silly: "playful", funny: "playful", curious: "playful", whimsical: "playful", goofy: "playful", quirky: "playful",
    hype: "hype", chaotic: "hype", intense: "hype", focused: "hype", competitive: "hype", energetic: "hype", tense: "hype", spooky: "hype", fast: "hype"
  };
  var ENERGY = { low: 0, medium: 0.5, mid: 0.5, high: 1 };
  var COMPETITION = { light: 0, friendly: 0.5, competitive: 1 };

  var DIM = FORMULAS.length + MOODS.length + 2 + LOOKS.length + SCOPES.length;
  var OFF_MOOD = FORMULAS.length;
  var OFF_E = OFF_MOOD + MOODS.length;
  var OFF_C = OFF_E + 1;
  var OFF_LOOK = OFF_C + 1;
  var OFF_SCOPE = OFF_LOOK + LOOKS.length;

  var HOOK = {
    bias: -0.2,
    formula: { dodge: 0.9, time: 0.8, merge: 0.3, answer: 0, guess: -0.3, group: -0.3, make: -0.5 },
    energy: 1.2,
    mood: { hype: 0.8, playful: 0.3, warm: -0.4, calm: -0.8 },
    look: { neon: 0.4, pixel: 0.3, glow: 0.2, clay: 0.1, riso: 0, chalk: -0.1, paper: -0.2, ink: -0.3 },
    community: -0.5,
    shortRun: 0.4
  };

  function moodShares(tags) {
    var out = {}, n = 0;
    (tags || []).forEach(function (t) {
      var fam = MOOD_FAMILY[String(t).toLowerCase()];
      if (fam) { out[fam] = (out[fam] || 0) + 1; n++; }
    });
    if (!n) return { playful: 1 };
    for (var k in out) out[k] /= n;
    return out;
  }

  function median(xs) {
    if (!xs.length) return null;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Quality prior from bot playtests: skill should matter, and runs shouldn't end in 3 seconds.
  function botQuality(bots, P) {
    var B = P.bots;
    if (!bots || bots.length < B.minRuns) return null;
    var n = bots.length, ms = 0, mc = 0;
    bots.forEach(function (b) { ms += b.skill; mc += b.score; });
    ms /= n; mc /= n;
    var cov = 0, vs = 0, vc = 0;
    bots.forEach(function (b) {
      cov += (b.skill - ms) * (b.score - mc);
      vs += (b.skill - ms) * (b.skill - ms);
      vc += (b.score - mc) * (b.score - mc);
    });
    var corr = vs > 0 && vc > 0 ? cov / Math.sqrt(vs * vc) : 0;
    var secs = bots.map(function (b) { return b.sec; }).filter(function (s) { return typeof s === "number" && s > 0; });
    var med = median(secs);
    var fit;
    if (med === null) fit = 0.5;
    else if (med < B.shortSec) fit = 0;
    else if (med < B.fitLo) fit = (med - B.shortSec) / (B.fitLo - B.shortSec);
    else if (med <= B.fitHi) fit = 1;
    else if (med <= B.longSec) fit = 1 - 0.5 * (med - B.fitHi) / (B.longSec - B.fitHi);
    else fit = 0.5;
    return { mean: clamp(B.base + B.skillCorr * Math.max(0, corr) + B.durationFit * fit, 0.05, 0.95), corr: corr, medianSec: med, fit: fit };
  }

  // summary: { id, formula, mood: [..], energy, competition, look, scope, isDaily, bots: [{skill, score, sec}] }
  function describe(summary, P) {
    var x = new Array(DIM);
    for (var i = 0; i < DIM; i++) x[i] = 0;
    var fi = FORMULAS.indexOf(summary.formula);
    if (fi >= 0) x[fi] = 1;
    var moods = moodShares(summary.mood);
    MOODS.forEach(function (m, j) { x[OFF_MOOD + j] = moods[m] || 0; });
    var energy = ENERGY[String(summary.energy || "").toLowerCase()];
    if (energy === undefined) energy = 0.5;
    var comp = COMPETITION[String(summary.competition || "").toLowerCase()];
    if (comp === undefined) comp = 0.5;
    x[OFF_E] = energy - 0.5;
    x[OFF_C] = comp - 0.5;
    var li = LOOKS.indexOf(summary.look);
    if (li >= 0) x[OFF_LOOK + li] = 1;
    var scope = SCOPES.indexOf(summary.scope) >= 0 ? summary.scope : "everyone";
    x[OFF_SCOPE + SCOPES.indexOf(scope)] = 1;

    var bq = botQuality(summary.bots, P);
    var z = HOOK.bias + (HOOK.formula[summary.formula] || 0) + HOOK.energy * (energy - 0.5) + (HOOK.look[summary.look] || 0);
    for (var m in moods) z += moods[m] * (HOOK.mood[m] || 0);
    if (scope !== "everyone" || summary.isDaily) z += HOOK.community;
    if (bq && bq.medianSec !== null && bq.medianSec < 15) z += HOOK.shortRun;
    var hookPrior = typeof summary.hook === "number" ? clamp(summary.hook, 0, 1) : sigmoid(z);

    var norm = 0;
    for (var k = 0; k < DIM; k++) norm += x[k] * x[k];
    var formulaCat = {};
    formulaCat[fi >= 0 ? summary.formula : "other"] = 1;
    var lookCat = {};
    lookCat[li >= 0 ? summary.look : "glow"] = 1;
    return {
      id: summary.id,
      x: x,
      norm: Math.sqrt(norm) || 1,
      cats: { formula: formulaCat, mood: moods, look: lookCat },
      hookPrior: hookPrior,
      bot: bq
    };
  }

  function cosine(a, an, b, bn) {
    var s = 0;
    for (var i = 0; i < DIM; i++) s += a[i] * b[i];
    return s / (an * bn);
  }

  function vecNorm(a) {
    var s = 0;
    for (var i = 0; i < DIM; i++) s += a[i] * a[i];
    return Math.sqrt(s);
  }

  // ---------------------------------------------------------------------------------------------
  // State

  function newState() {
    return { v: 1, items: {}, global: { g1: 0, g0: 0 }, users: {} };
  }

  function newUser() {
    var t = new Array(DIM);
    for (var i = 0; i < DIM; i++) t[i] = 0;
    return {
      taste: t, n: 0, vBar: 0.25, vN: 0,
      hookGrab: newReg(), hookSat: newReg(),
      cal: { formula: {}, mood: {}, hook: {}, look: {} },
      recent: []
    };
  }

  function userIn(S, id) {
    if (!S.users[id]) S.users[id] = newUser();
    return S.users[id];
  }

  // Item evidence, decayed to `day`.
  function evidence(S, id, day, P, write) {
    var ev = S.items[id];
    if (!ev) {
      ev = { g1: 0, g0: 0, s1: 0, s0: 0, n: 0, day: day };
      if (write) S.items[id] = ev;
      else return ev;
    }
    var dt = day - ev.day;
    if (dt > 0) {
      var f = Math.pow(P.bandit.decayPerDay, dt);
      if (write) {
        ev.g1 *= f; ev.g0 *= f; ev.s1 *= f; ev.s0 *= f; ev.n *= f; ev.day = day;
        return ev;
      }
      return { g1: ev.g1 * f, g0: ev.g0 * f, s1: ev.s1 * f, s0: ev.s0 * f, n: ev.n * f, day: day };
    }
    return ev;
  }

  function globalGrab(S, P) {
    var m = P.bandit.globalMass;
    return (P.bandit.globalGrab * m + S.global.g1) / (m + S.global.g1 + S.global.g0);
  }

  // ---------------------------------------------------------------------------------------------
  // Caches that are never persisted: descriptors and neighbor lists.

  var CACHE = { descs: {}, nbrSig: "", nbr: {} };

  function describeAll(summaries, P) {
    var ids = [];
    summaries.forEach(function (s) {
      CACHE.descs[s.id] = describe(s, P);
      ids.push(s.id);
    });
    var sig = ids.slice().sort().join("|");
    if (sig !== CACHE.nbrSig) {
      CACHE.nbrSig = sig;
      CACHE.nbr = {};
      ids.forEach(function (a) {
        var da = CACHE.descs[a], list = [];
        ids.forEach(function (b) {
          if (a === b) return;
          var db = CACHE.descs[b];
          var s = cosine(da.x, da.norm, db.x, db.norm);
          if (s > 0) list.push({ id: b, sim: s });
        });
        list.sort(function (p, q) { return q.sim - p.sim || (p.id < q.id ? -1 : 1); });
        CACHE.nbr[a] = list.slice(0, 15);
      });
    }
    return ids;
  }

  // Posterior view of one game.
  function itemView(S, d, P, day, gGlobal) {
    var st = P.stages, B = P.bandit;
    var ev = evidence(S, d.id, day, P, false);

    // Grab prior: hookier manifests start with a higher takeover rate (stage 4).
    var mg0 = st.coldStart ? sigmoid(logit(gGlobal) + 2 * (d.hookPrior - 0.5)) : gGlobal;
    var gA = mg0 * B.grabPriorStrength + ev.g1;
    var gB = (1 - mg0) * B.grabPriorStrength + ev.g0;

    // Sat prior: bot playtests (stage 2), similar established games (stage 4).
    var base = (st.bandit && d.bot) ? d.bot.mean : B.globalSat;
    var strength = (st.bandit && d.bot) ? B.satPriorStrength : B.satPriorStrengthNoBots;
    var nbrMean = null;
    if (st.coldStart) {
      nbrMean = neighborSat(S, d, P, day);
      if (nbrMean !== null) base = (1 - P.coldStart.neighborShare) * base + P.coldStart.neighborShare * nbrMean;
    }
    var sA = base * strength + ev.s1;
    var sB = (1 - base) * strength + ev.s0;

    // Observed hook: this game's takeover rate against everyone's, blended by age (stage 4).
    var gData = (ev.g1 + gGlobal * 2) / (ev.g1 + ev.g0 + 2);
    var hObs = sigmoid(1.5 * (logit(gData) - logit(gGlobal)));
    var w = ev.n / (ev.n + P.coldStart.hookAgeK);
    var hook = st.coldStart ? (1 - w) * d.hookPrior + w * hObs : d.hookPrior;

    var tiers = P.calibration.tiers;
    var tier = hook < tiers[0] ? "low" : hook < tiers[1] ? "mid" : "high";
    var hookCat = {};
    hookCat[tier] = 1;
    return {
      id: d.id, ev: ev, gA: gA, gB: gB, sA: sA, sB: sB,
      grab: betaMean(gA, gB), sat: betaMean(sA, sB),
      satPrior: base, neighborSat: nbrMean,
      hook: hook, tier: tier,
      cats: { formula: d.cats.formula, mood: d.cats.mood, hook: hookCat, look: d.cats.look },
      pSlop: betaBelow(sA, sB, P.bait.slopFloor),
      unproven: ev.n < B.provenAt
    };
  }

  function neighborSat(S, d, P, day) {
    var C = P.coldStart, B = P.bandit;
    var list = CACHE.nbr[d.id] || [];
    var num = 0, den = 0, used = 0;
    for (var i = 0; i < list.length && used < C.neighbors; i++) {
      var nd = CACHE.descs[list[i].id];
      if (!nd) continue;
      var ev = evidence(S, nd.id, day, P, false);
      if (ev.n < C.neighborMinN) continue;
      var base = (P.stages.bandit && nd.bot) ? nd.bot.mean : B.globalSat;
      var strength = (P.stages.bandit && nd.bot) ? B.satPriorStrength : B.satPriorStrengthNoBots;
      var m = (base * strength + ev.s1) / (strength + ev.s1 + ev.s0);
      var w = list[i].sim * (ev.n / (ev.n + 5));
      num += w * m; den += w; used++;
    }
    return den > 0.3 ? num / den : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Bait appetite

  // Weighted least squares of y on x, kept as decayed sums [w, x, y, xx, xy].
  function newReg() { return [0, 0, 0, 0, 0]; }

  function regAdd(reg, x, y, decay) {
    for (var i = 0; i < 5; i++) reg[i] *= decay;
    reg[0] += 1; reg[1] += x; reg[2] += y; reg[3] += x * x; reg[4] += x * y;
  }

  // Slope with ridge shrinkage toward `prior` worth `k` pseudo-pages of typical spread `v0`.
  function regSlope(reg, prior, k, v0) {
    if (!reg || reg[0] <= 0) return prior;
    var w = reg[0], mx = reg[1] / w, my = reg[2] / w;
    var vxx = Math.max(0, reg[3] / w - mx * mx);
    var cxy = reg[4] / w - mx * my;
    var den = w * vxx + k * v0;
    return den > 1e-9 ? (w * cxy + k * v0 * prior) / den : prior;
  }

  function baitLean(user, P, S) {
    var b = P.bait;
    if (!P.stages.bait) return { lean: 0, tolerance: 0.5, appetite: 0, fatigue: 0 };
    var G = (S && S.global) || {};
    var popGrab = regSlope(G.hookGrab, b.popGrabSlope, b.popShrink, b.typicalVar);
    var popSat = regSlope(G.hookSat, b.popSatSlope, b.popShrink, b.typicalVar);
    var grabExcess = regSlope(user.hookGrab, popGrab, b.shrink, b.typicalVar) - popGrab;
    var satExcess = regSlope(user.hookSat, popSat, b.shrink, b.typicalVar) - popSat;
    var appetite = b.gainGrab * grabExcess + b.gainSat * satExcess;
    var lean = clamp(b.b0 + appetite, b.min, b.max);
    var fatigue = 0;
    user.recent.forEach(function (r) { if (r.hooky && r.bad) fatigue++; });
    lean = clamp(lean - b.fatiguePer * fatigue, b.min, b.max);
    return { lean: lean, tolerance: sigmoid(lean), appetite: appetite, fatigue: fatigue, popGrabSlope: popGrab, popSatSlope: popSat };
  }

  // ---------------------------------------------------------------------------------------------
  // Stage 1: reward for one page view

  // impression: { id, dwellSec, tookOver, runsFinished, replays, saved, liked, floated,
  //               openedBoard, addedFriend, remixed, quitMidRun, endedSession, day }
  function rewardOf(imp, P) {
    var R = P.reward, W = R.w;
    var took = !!imp.tookOver;
    var social = socialSum(imp.social, P);
    var engagedNoPlay = !took && !!(imp.saved || imp.floated || imp.liked || imp.openedBoard || imp.remixed || social > 0);
    var quickSkip = !took && !engagedNoPlay && (imp.dwellSec || 0) < R.quickSkipSec;
    if (!P.stages.reward) {
      // CTR only: what Netflix warns about.
      return { g: took ? 1 : 0, s: null, v: took ? 1 : 0, r: null, quickSkip: quickSkip, engaged: took };
    }
    var g;
    if (took || engagedNoPlay) g = 1;
    else if ((imp.dwellSec || 0) >= R.watchSec) g = R.watchGrab;
    else if (quickSkip) g = 0;
    else g = R.idleGrab;
    var s = null, r = null;
    if (took || engagedNoPlay) {
      r = W.finished * ((imp.runsFinished || 0) > 0 ? 1 : 0)
        + W.replayLog * Math.log(1 + (imp.replays || 0))
        + W.saved * (imp.saved ? 1 : 0)
        + W.floated * (imp.floated ? 1 : 0)
        + W.addedFriend * (imp.addedFriend ? 1 : 0)
        + W.remixed * (imp.remixed ? 1 : 0)
        + W.liked * (imp.liked ? 1 : 0)
        + W.openedBoard * (imp.openedBoard ? 1 : 0)
        + W.quitMidRun * (imp.quitMidRun ? 1 : 0)
        + W.endedSession * (imp.endedSession ? 1 : 0)
        + social;
      s = sigmoid((r - R.r0) / R.kappa);
    }
    var v = s !== null ? g * s : g * 0.5;
    return { g: g, s: s, v: v, r: r, quickSkip: quickSkip, engaged: took || engagedNoPlay };
  }

  // The summed weight of a page's social moments, each kind counted once.
  function socialSum(kinds, P) {
    if (!kinds || !kinds.length) return 0;
    var R = P.reward, seen = {}, total = 0;
    kinds.forEach(function (k) {
      k = String(k);
      if (seen[k]) return;
      seen[k] = true;
      var w = (R.social || {})[k];
      total += w === undefined ? R.socialDefault : w;
    });
    return total;
  }

  // A save or social moment that happened away from the feed page (Messenger, a Group, a
  // profile, the Library). No grab evidence, since the feed didn't show it; a little
  // satisfaction evidence and a nudge to taste. `with` (other people's ids) is counted for later:
  // who you play with is the strongest signal we have for Blends and twins.
  function signal(S, user, sig, P) {
    var day = sig.day || 0, kind = String(sig.kind || ""), R = P.reward;
    var w = socialSum([kind], P);
    var m = R.offFeedMass;
    var s = sigmoid((w - R.r0) / R.kappa);
    var d = sig.id ? CACHE.descs[sig.id] : null;
    if (P.stages.reward && sig.id) {
      var ev = evidence(S, sig.id, day, P, true);
      ev.s1 += m * s;
      ev.s0 += m * (1 - s);
      if (d) {
        for (var i = 0; i < DIM; i++) user.taste[i] += m * (s - user.vBar) * d.x[i];
      }
    }
    if (!S.social) S.social = { kinds: {}, with: {} };
    S.social.kinds[kind] = (S.social.kinds[kind] || 0) + 1;
    (sig.with || []).forEach(function (id) { S.social.with[id] = (S.social.with[id] || 0) + 1; });
    return { kind: kind, w: w, s: s, mass: m, item: !!(sig.id && P.stages.reward), taste: !!(d && P.stages.reward) };
  }

  function observe(S, user, imp, P) {
    var day = imp.day || 0;
    var res = rewardOf(imp, P);
    var ev = evidence(S, imp.id, day, P, true);
    var d = CACHE.descs[imp.id];
    var gGlobal = globalGrab(S, P);
    // The hook as the ranker saw it, before this page counts.
    var hook = d ? itemView(S, d, P, day, gGlobal).hook : 0.5;

    ev.g1 += res.g;
    ev.g0 += 1 - res.g;
    S.global.g1 += res.g;
    S.global.g0 += 1 - res.g;
    if (P.stages.reward && imp.endedSession && !res.engaged) {
      ev.g0 += P.reward.exitGrabPenalty;
    }
    if (res.s !== null) {
      ev.s1 += res.s;
      ev.s0 += 1 - res.s;
    }
    ev.n += 1;
    if ((imp.social && imp.social.length) || (imp.with && imp.with.length)) {
      if (!S.social) S.social = { kinds: {}, with: {} };
      (imp.social || []).forEach(function (k) { S.social.kinds[k] = (S.social.kinds[k] || 0) + 1; });
      (imp.with || []).forEach(function (id) { S.social.with[id] = (S.social.with[id] || 0) + 1; });
    }

    // Person-level learning.
    var vBefore = user.vBar;
    user.vN = Math.min(user.vN + 1, 30);
    user.vBar += (res.v - user.vBar) / user.vN;
    user.n += 1;
    if (d) {
      var td = P.coldStart.tasteDecay;
      for (var i = 0; i < DIM; i++) user.taste[i] = user.taste[i] * td + (res.v - vBefore) * d.x[i];

      // Bait appetite: regress this page's grab (every page) and satisfaction (after a
      // takeover) on the hook, for this person and for everyone. baitLean compares the slopes.
      var bx = 2 * hook - 1, B = P.bait;
      if (!user.hookGrab) { user.hookGrab = newReg(); user.hookSat = newReg(); }
      if (!S.global.hookGrab) { S.global.hookGrab = newReg(); S.global.hookSat = newReg(); }
      regAdd(user.hookGrab, bx, res.g, B.userDecay);
      regAdd(S.global.hookGrab, bx, res.g, B.globalDecay);
      if (res.s !== null) {
        regAdd(user.hookSat, bx, res.s, B.userDecay);
        regAdd(S.global.hookSat, bx, res.s, B.globalDecay);
      }

      // Calibration targets: what they actually engaged with.
      var cd = P.calibration.decay, cal = user.cal;
      if (!cal.look) cal.look = {};
      ["formula", "mood", "hook", "look"].forEach(function (dim) {
        for (var c in cal[dim]) cal[dim][c] *= cd;
      });
      var view = itemView(S, d, P, day, gGlobal);
      ["formula", "mood", "hook", "look"].forEach(function (dim) {
        var cats = view.cats[dim];
        for (var c in cats) cal[dim][c] = (cal[dim][c] || 0) + res.v * cats[c];
      });

      user.recent.push({ hooky: hook >= P.bait.hookyAt, bad: res.quickSkip || !!imp.quitMidRun });
      while (user.recent.length > P.bait.fatigueWindow) user.recent.shift();
    }
    var team = creditPage(user, imp, P);
    return { g: res.g, s: res.s, v: res.v, r: res.r, hook: hook, team: team };
  }

  // S is optional (older callers pass only the user); without it the interleaving tally is skipped.
  function endSession(user, S) {
    user.recent = [];
    if (S) endInterleave(S, user);
  }

  // ---------------------------------------------------------------------------------------------
  // Stage 3: calibration helpers

  // `available` maps each category on offer to the average hook of its games. Before your own
  // history fills in, the bait lean tilts every target: formulas and moods whose games are
  // hookier get more prior mass when your lean is positive, and less when it's negative.
  function targetDist(dim, userCal, available, P, bait) {
    var C = P.calibration;
    var cats = Object.keys(available);
    if (!cats.length) return null;
    var prior = {};
    if (dim === "hook") {
      var base = P.stages.bait ? C.hookPrior : [1, 1, 1];
      TIERS.forEach(function (t, i) { if (available[t] !== undefined) prior[t] = base[i]; });
    } else {
      cats.forEach(function (c) {
        prior[c] = P.stages.bait ? Math.exp(C.hookTilt * bait.lean * (2 * available[c] - 1)) : 1;
      });
    }
    var ps = 0;
    for (var c in prior) ps += prior[c];
    var p = {}, total = 0;
    cats.forEach(function (c) {
      p[c] = C.priorMass * (prior[c] || 0) / (ps || 1) + (userCal[c] || 0);
      total += p[c];
    });
    if (dim === "hook" && P.stages.bait) {
      total = 0;
      var dir = { low: -1, mid: 0, high: 1 };
      cats.forEach(function (c) {
        p[c] *= Math.exp(C.hookTilt * (bait.lean - P.bait.b0) * dir[c]);
        total += p[c];
      });
    }
    if (total <= 0) return null;
    cats.forEach(function (c) { p[c] /= total; });
    return p;
  }

  function klWith(p, counts, total, add, alpha) {
    var kl = 0, t = total + 1;
    for (var c in p) {
      var pc = p[c];
      if (pc <= 0) continue;
      var q = ((counts[c] || 0) + (add[c] || 0)) / t;
      q = (1 - alpha) * q + alpha * pc;
      kl += pc * Math.log(pc / q);
    }
    return kl;
  }

  // ---------------------------------------------------------------------------------------------
  // Ranking

  // input: {
  //   candidates: [{ gameID, reason, runUserID, weight }],
  //   summaries:  [summary],          every game a candidate points at
  //   feed:       [gameID],         pages already in this session's feed, oldest first
  //   feedKeys:   [gameID|reason|runUserID], optional, for rotating Bursts
  //   count, seed, day
  // }
  function rank(S, user, input, P) {
    var st = P.stages, F = P.feed, C = P.calibration;
    var day = input.day || 0;
    var r = rng((input.seed >>> 0) ^ hashString("recs|" + (input.feed || []).length));
    describeAll(input.summaries || [], P);
    var gGlobal = globalGrab(S, P);
    var bait = baitLean(user, P, S);

    // Group candidates by game.
    var byGame = {}, order = [];
    (input.candidates || []).forEach(function (c) {
      if (!CACHE.descs[c.gameID]) return;
      if (!byGame[c.gameID]) { byGame[c.gameID] = []; order.push(c.gameID); }
      byGame[c.gameID].push(c);
    });
    if (!order.length) return { picks: [], bait: bait, stages: st, version: VERSION };

    var tn = vecNorm(user.taste);
    var ramp = user.n / (user.n + P.coldStart.tasteRampK);

    // Score every game once (one Thompson draw per game per call).
    var info = {};
    order.forEach(function (id) {
      var d = CACHE.descs[id];
      var v = itemView(S, d, P, day, gGlobal);
      var tg = st.bandit ? betaSample(r, v.gA, v.gB) : v.grab;
      var ts = st.bandit ? betaSample(r, v.sA, v.sB) : v.sat;
      var parts = {};
      parts.quality = st.reward ? P.bandit.grabWeight * logit(tg) + P.bandit.satWeight * logit(ts) : logit(tg);
      parts.taste = (st.coldStart && tn > 1e-9) ? P.coldStart.tasteWeight * ramp * cosine(user.taste, tn, d.x, d.norm) : 0;
      parts.bait = st.bait ? bait.lean * (2 * v.hook - 1) : 0;
      parts.slop = st.bait ? -P.bait.slopPenalty * v.pSlop * (1 - bait.tolerance) : 0;
      var maxW = 0;
      byGame[id].forEach(function (c) { if (c.weight > maxW) maxW = c.weight; });
      parts.reason = F.reasonPrior * Math.log(Math.max(maxW, 0.05));
      var base = parts.quality + parts.taste + parts.bait + parts.slop + parts.reason;
      info[id] = { view: v, parts: parts, base: base, thetaGrab: tg, thetaSat: ts };
    });

    // Session so far.
    var feed = (input.feed || []).slice();
    var uses = {};
    feed.forEach(function (id) { uses[id] = (uses[id] || 0) + 1; });
    var keyUses = {};
    (input.feedKeys || []).forEach(function (k) { keyUses[k] = (keyUses[k] || 0) + 1; });

    // Calibration: targets over what's available. q is measured over a sliding window of the
    // last `history` pages (shown pages plus new picks), so any run of consecutive pages keeps
    // the mix. Over a growing list each page would move q by only 1/t and calibration would
    // fade as you scroll.
    var dims = ["formula", "mood", "hook"];
    var targets = {};
    if (st.calibration) {
      dims.forEach(function (dim) {
        // Each category on offer, with the average hook of its games.
        var sum = {}, wsum = {};
        order.forEach(function (id) {
          var cats = info[id].view.cats[dim];
          for (var c in cats) {
            sum[c] = (sum[c] || 0) + cats[c] * info[id].view.hook;
            wsum[c] = (wsum[c] || 0) + cats[c];
          }
        });
        var avail = {};
        for (var c in wsum) avail[c] = wsum[c] > 0 ? sum[c] / wsum[c] : 0.5;
        targets[dim] = targetDist(dim, user.cal[dim], avail, P, bait);
      });
    }
    function windowCounts() {
      var counts = {}, total = 0;
      dims.forEach(function (dim) { counts[dim] = {}; });
      feed.slice(-(C.history - 1)).forEach(function (id) {
        var it = info[id];
        if (!it) return;
        total++;
        dims.forEach(function (dim) {
          var cats = it.view.cats[dim];
          for (var c in cats) counts[dim][c] = (counts[dim][c] || 0) + cats[c];
        });
      });
      return { counts: counts, total: total };
    }

    // Unproven cap (slop guard), over the same sliding window.
    var cap = st.bait ? P.bait.unprovenBase + P.bait.unprovenSpan * bait.tolerance : 1;
    function unprovenInWindow() {
      var tail = feed.slice(-(C.history - 1)), n = 0;
      tail.forEach(function (id) { if (info[id] && info[id].view.unproven) n++; });
      return { n: n, slots: tail.length };
    }

    var distinct = order.length;
    var window = Math.max(0, Math.min(F.repeatWindow, distinct - 1));
    var count = Math.max(0, input.count || 0);
    var picks = [];
    for (var slot = 0; slot < count; slot++) {
      var blocked = {};
      feed.slice(Math.max(0, feed.length - window)).forEach(function (id) { if (window > 0) blocked[id] = true; });
      var pool = order.filter(function (id) { return !blocked[id]; });
      if (!pool.length) pool = order.filter(function (id) { return id !== feed[feed.length - 1]; });
      if (!pool.length) pool = order.slice();
      var uw = unprovenInWindow();
      if (st.bait && (uw.n + 1) / (uw.slots + 1) > cap) {
        var proven = pool.filter(function (id) { return !info[id].view.unproven; });
        if (proven.length) pool = proven;
      }

      var wc = st.calibration ? windowCounts() : null;
      var best = null, bestObj = -Infinity, bestScore = 0, bestRel = 0, bestKL = 0;
      pool.forEach(function (id) {
        var score = info[id].base - F.repeatFatigue * Math.log(1 + (uses[id] || 0));
        var obj = score, kl = 0;
        var rel = sigmoid(score);
        if (st.calibration) {
          dims.forEach(function (dim) {
            if (!targets[dim]) return;
            kl += (C.weights[dim] || 0) * klWith(targets[dim], wc.counts[dim], wc.total, info[id].view.cats[dim], C.alpha);
          });
          obj = (1 - C.lambda) * rel - C.lambda * kl;
        }
        if (obj > bestObj) { bestObj = obj; best = id; bestScore = score; bestRel = rel; bestKL = kl; }
      });

      // Rotate whose Burst plays, like the old generator.
      var cands = byGame[best], pick = cands[0], pickW = -Infinity;
      cands.forEach(function (c) {
        var key = c.gameID + "|" + c.reason + "|" + (c.runUserID || "-");
        var w = c.weight / (1 + F.burstRotation * (keyUses[key] || 0));
        if (w > pickW) { pickW = w; pick = c; }
      });
      var pickKey = pick.gameID + "|" + pick.reason + "|" + (pick.runUserID || "-");
      keyUses[pickKey] = (keyUses[pickKey] || 0) + 1;

      var it = info[best];
      picks.push({
        gameID: best,
        reason: pick.reason,
        runUserID: pick.runUserID || null,
        score: bestScore,
        rel: bestRel,
        kl: bestKL,
        grab: it.view.grab,
        sat: it.view.sat,
        hook: it.view.hook,
        tier: it.view.tier,
        pSlop: it.view.pSlop,
        unproven: it.view.unproven,
        parts: it.parts,
        why: explain(it, bait)
      });
      feed.push(best);
      uses[best] = (uses[best] || 0) + 1;
    }
    return { picks: picks, bait: bait, targets: targets, stages: st, version: VERSION };
  }

  // A short, honest reason for a debug overlay (and later for an Ember "why" line).
  function explain(it, bait) {
    var p = it.parts, v = it.view;
    var bits = [];
    if (p.reason > 0.6) bits.push("from your people");
    if (v.unproven) bits.push("new, still testing");
    else if (v.sat > 0.6) bits.push("people finish and replay it");
    if (p.taste > 0.3) bits.push("like what you play");
    if (p.bait > 0.4) bits.push("hooky, and hooky works for you");
    else if (bait.lean < 0 && v.hook < 0.45) bits.push("calmer pick");
    if (p.slop < -0.5) bits.push("held back: may be low quality");
    return bits.length ? bits.join(" · ") : "a change of pace";
  }

  // ---------------------------------------------------------------------------------------------
  // Today's feed, for comparisons: weighted random over candidates (BubbleFeedGenerator).

  function baseline(input) {
    var r = rng((input.seed >>> 0) ^ hashString("base|" + (input.feed || []).length));
    var cands = input.candidates || [];
    var feed = (input.feed || []).slice();
    var keyUses = {};
    (input.feedKeys || []).forEach(function (k) { keyUses[k] = (keyUses[k] || 0) + 1; });
    var distinct = {};
    cands.forEach(function (c) { distinct[c.gameID] = true; });
    var window = Math.max(0, Math.min(4, Object.keys(distinct).length - 1));
    var picks = [];
    for (var i = 0; i < (input.count || 0); i++) {
      var blocked = {};
      if (window > 0) feed.slice(Math.max(0, feed.length - window)).forEach(function (id) { blocked[id] = true; });
      var pool = cands.filter(function (c) { return !blocked[c.gameID]; });
      if (!pool.length) pool = cands.filter(function (c) { return c.gameID !== feed[feed.length - 1]; });
      if (!pool.length) pool = cands;
      if (!pool.length) break;
      var weights = pool.map(function (c) {
        var key = c.gameID + "|" + c.reason + "|" + (c.runUserID || "-");
        return c.weight / (1 + 1.6 * (keyUses[key] || 0));
      });
      var sum = weights.reduce(function (a, b) { return a + b; }, 0);
      var x = r() * sum, idx = pool.length - 1;
      for (var j = 0; j < weights.length; j++) { if (x < weights[j]) { idx = j; break; } x -= weights[j]; }
      var c = pool[idx];
      var key = c.gameID + "|" + c.reason + "|" + (c.runUserID || "-");
      keyUses[key] = (keyUses[key] || 0) + 1;
      feed.push(c.gameID);
      picks.push({ gameID: c.gameID, reason: c.reason, runUserID: c.runUserID || null });
    }
    return { picks: picks };
  }

  // ---------------------------------------------------------------------------------------------
  // Team-draft interleaving (Radlinski, Kurup and Joachims 2008; Netflix and Airbnb use it to
  // compare rankers with far fewer people than an A/B test).
  //
  //   draft    the formula (team A) and a control (team B) each rank the same candidates. Each
  //            round a coin flip says who picks first, and each team adds its best game that isn't
  //            on the page yet. Neither side gets the better slots on average.
  //   credit   a page earns its team a point when you enjoyed it: the judge's satisfaction is at
  //            least `creditAt` (finishes, replays, saves, social moments; a grab alone isn't
  //            enough, as Airbnb credits bookings, not clicks). The judge is always the default
  //            reward weights, so tuning the formula can't move the yardstick.
  //   session  whoever has more points wins it; equal points (including none) is a tie.
  //
  // The control is today's weighted-random feed ("baseline") or the formula with one part
  // switched off (`interleave.variants`), so the same tally can show each part earns its place.

  var JUDGE = { reward: defaults().reward, stages: { reward: true } };

  function controlPicks(S, user, input, P) {
    var I = P.interleave || {};
    var over = I.against && I.against !== "baseline" ? (I.variants || {})[I.against] : null;
    if (!over) return baseline(input);
    var Pb = merge(JSON.parse(JSON.stringify(P)), JSON.parse(JSON.stringify(over)));
    Pb.interleave.on = false;
    return rank(S, user, input, Pb);
  }

  function interleave(S, user, input, P) {
    var I = P.interleave || {}, count = input.count || 0;
    var against = I.against && (I.against === "baseline" || (I.variants || {})[I.against]) ? I.against : "baseline";
    // Control first, so the description cache ends on the formula's own parameters.
    var b = controlPicks(S, user, input, P);
    var a = rank(S, user, input, P);
    var r = rng((input.seed >>> 0) ^ hashString("draft|" + (input.feed || []).length));
    var lists = { A: a.picks, B: b.picks }, at = { A: 0, B: 0 }, taken = {}, picks = [];
    function nextFree(t) {
      while (at[t] < lists[t].length && taken[lists[t][at[t]].gameID]) at[t]++;
      return at[t] < lists[t].length;
    }
    function take(t) {
      var p = lists[t][at[t]++], out = {};
      for (var k in p) out[k] = p[k];
      out.team = t;
      taken[p.gameID] = true;
      picks.push(out);
    }
    while (picks.length < count && (nextFree("A") || nextFree("B"))) {
      var order = r() < 0.5 ? ["A", "B"] : ["B", "A"];
      for (var i = 0; i < 2 && picks.length < count; i++) {
        if (nextFree(order[i])) take(order[i]);
      }
    }
    // A small catalog can run out of distinct games: fill with the formula's own repeats, which
    // count for nobody.
    for (var j = 0; picks.length < count && j < a.picks.length; j++) {
      var rep = {};
      for (var key in a.picks[j]) rep[key] = a.picks[j][key];
      rep.team = null;
      picks.push(rep);
    }

    if (!user.inter) user.inter = { pending: {}, session: null };
    if (!user.inter.session || user.inter.session.against !== against) {
      user.inter.session = { against: against, A: { shown: 0, engaged: 0, points: 0 }, B: { shown: 0, engaged: 0, points: 0 } };
    }
    picks.forEach(function (p) {
      if (!p.team) return;
      (user.inter.pending[p.gameID] = user.inter.pending[p.gameID] || []).push(p.team);
    });
    return {
      picks: picks, bait: a.bait, targets: a.targets, stages: a.stages, version: VERSION,
      interleave: { against: against, A: picks.filter(function (p) { return p.team === "A"; }).length, B: picks.filter(function (p) { return p.team === "B"; }).length }
    };
  }

  // Called from observe(): which team showed this page, and did it earn a point?
  function creditPage(user, imp, P) {
    var it = user.inter;
    if (!it || !it.session || !it.pending) return null;
    var queue = it.pending[imp.id];
    if (!queue || !queue.length) return null;
    var team = queue.shift();
    if (!queue.length) delete it.pending[imp.id];
    var res = rewardOf(imp, JUDGE), side = it.session[team];
    var creditAt = (P.interleave || {}).creditAt;
    if (creditAt === undefined) creditAt = 0.5;
    side.shown += 1;
    if (res.engaged) side.engaged += 1;
    if (res.s !== null && res.s >= creditAt) side.points += 1;
    return team;
  }

  function endInterleave(S, user) {
    var it = user.inter;
    if (!it || !it.session) return;
    var ses = it.session;
    it.pending = {};
    it.session = null;
    if (!ses.A.shown && !ses.B.shown) return;
    if (!S.inter) S.inter = {};
    var T = S.inter[ses.against] = S.inter[ses.against] || {
      sessions: 0, aWins: 0, bWins: 0, ties: 0,
      A: { shown: 0, engaged: 0, points: 0 }, B: { shown: 0, engaged: 0, points: 0 }
    };
    T.sessions += 1;
    if (ses.A.points > ses.B.points) T.aWins += 1;
    else if (ses.B.points > ses.A.points) T.bWins += 1;
    else T.ties += 1;
    ["A", "B"].forEach(function (t) {
      T[t].shown += ses[t].shown;
      T[t].engaged += ses[t].engaged;
      T[t].points += ses[t].points;
    });
  }

  // Two-sided sign test on decided sessions: exact up to 1,000, normal approximation past that.
  function signTest(wins, n) {
    if (!n) return 1;
    var k = Math.min(wins, n - wins);
    if (n > 1000) {
      var z = (Math.abs(wins - n / 2) - 0.5) / Math.sqrt(n / 4);
      return clamp(2 * (1 - phi(z)), 0, 1);
    }
    var logP = -n * Math.LN2, term = logP, tail = Math.exp(term);
    for (var i = 1; i <= k; i++) {
      term += Math.log((n - i + 1) / i);
      tail += Math.exp(term);
    }
    return clamp(2 * tail, 0, 1);
  }

  function wilson(wins, n) {
    if (!n) return [0, 1];
    var z = 1.96, p = wins / n, z2 = z * z;
    var mid = (p + z2 / (2 * n)) / (1 + z2 / n);
    var half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n);
    return [clamp(mid - half, 0, 1), clamp(mid + half, 0, 1)];
  }

  // The tally per control: wins, losses, ties; A's share of decided sessions with a 95% interval
  // and a sign-test p-value; and points per page shown for each side.
  function interleaveStats(S) {
    var out = {};
    for (var against in (S && S.inter) || {}) {
      var T = S.inter[against], decided = T.aWins + T.bWins;
      out[against] = {
        sessions: T.sessions, formulaWins: T.aWins, controlWins: T.bWins, ties: T.ties,
        winShare: decided ? T.aWins / decided : null,
        winShare95: wilson(T.aWins, decided),
        preference: T.sessions ? (T.aWins + 0.5 * T.ties) / T.sessions : null,
        pValue: signTest(T.aWins, decided),
        formulaPointsPerPage: T.A.shown ? T.A.points / T.A.shown : null,
        controlPointsPerPage: T.B.shown ? T.B.points / T.B.shown : null,
        formulaPages: T.A.shown, controlPages: T.B.shown
      };
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Group Blend: one feed for everyone in a Group, plus a Blend game spec for Muse Studio.
  //
  //   profile     what a person likes: smoothed shares over formula, mood, look and hook tier,
  //               their bait lean, a taste vector over the 24 game features, and per-formula skill
  //   similarity  cosine of taste vectors, Jensen–Shannon similarity of formula and mood shares,
  //               and bait-lean closeness
  //   enjoyment   r_ui = sigmoid(quality + formula/mood/look affinity + lean * hook), per member
  //   ranking     geometric mean of r_ui over members (the chance everyone enjoys it, if members
  //               are independent), a misery floor, and fairness that is only ever a plus: similar
  //               skill on the game's formula, and a boost for members the Blend has served least
  //
  // A pair is a two-person Blend, so Challenge Me can call the same code.

  var FORMULA_WORD = { dodge: "dodge", time: "timing", merge: "merge", guess: "guessing", group: "sorting", answer: "trivia", make: "making" };
  var MOOD_WORD = { calm: "calm", warm: "cozy", playful: "playful", hype: "fast-paced" };
  var FORMULA_BRINGS = { dodge: "the reflexes", time: "the timing", merge: "the strategy", guess: "the guesswork", group: "the sorting", answer: "the trivia", make: "the creativity" };
  var MOOD_BRINGS = { calm: "the chill", warm: "the warmth", playful: "the silliness", hype: "the speed" };

  function normalize(map, keys) {
    var out = {}, total = 0;
    keys.forEach(function (k) { total += map[k] || 0; });
    keys.forEach(function (k) { out[k] = total > 0 ? (map[k] || 0) / total : 1 / keys.length; });
    return out;
  }

  // Engagement masses smoothed toward uniform with `priorMass` pseudo-pages.
  function smoothShares(masses, keys, priorMass) {
    var out = {}, total = priorMass;
    keys.forEach(function (k) { total += masses[k] || 0; });
    keys.forEach(function (k) { out[k] = (priorMass / keys.length + (masses[k] || 0)) / total; });
    return out;
  }

  function softmaxNoise(r, keys, sd, boost) {
    var out = {}, total = 0;
    keys.forEach(function (k) {
      out[k] = Math.exp(sd * normal(r) + ((boost && boost[k]) || 0));
      total += out[k];
    });
    keys.forEach(function (k) { out[k] /= total; });
    return out;
  }

  function hookShares(lean, P) {
    var base = P.calibration.hookPrior, dir = [-1, 0, 1], m = {};
    TIERS.forEach(function (t, i) { m[t] = base[i] * Math.exp(P.calibration.hookTilt * (lean - P.bait.b0) * dir[i]); });
    return normalize(m, TIERS);
  }

  function skillMap(skill) {
    var overall = 0.5, by = {};
    if (typeof skill === "number") overall = skill;
    else if (skill && typeof skill.overall === "number") overall = skill.overall;
    FORMULAS.forEach(function (f) {
      var v = skill && skill.byFormula && typeof skill.byFormula[f] === "number" ? skill.byFormula[f] : overall;
      by[f] = clamp(v, 0, 1);
    });
    return { overall: clamp(overall, 0, 1), byFormula: by };
  }

  // A real person's profile, from their recommender state.
  function profileOf(user, P, S, person) {
    person = person || {};
    var B = P.blend, cal = user.cal || {};
    var lean = baitLean(user, P, S).lean;
    var hookMass = cal.hook || {};
    var hasHook = Object.keys(hookMass).length > 0;
    return {
      id: person.id || "me",
      name: person.name || "You",
      isMe: !!person.isMe,
      isFriend: !!person.isFriend,
      synthetic: false,
      n: user.n || 0,
      formula: smoothShares(cal.formula || {}, FORMULAS, B.priorMass),
      mood: smoothShares(cal.mood || {}, MOODS, B.priorMass),
      look: smoothShares(cal.look || {}, LOOKS, B.priorMass),
      hook: hasHook ? smoothShares(hookMass, TIERS, B.priorMass) : hookShares(lean, P),
      lean: lean,
      taste: (user.taste || []).slice(),
      skill: skillMap(person.skill),
      themes: (person.hints && person.hints.themes) || []
    };
  }

  // Bio words that steer a demo profile. Synthetic on purpose: a guess, not learned.
  var BIO_HINTS = [
    { words: ["run", "bike", "biking", "soccer", "surf", "swim", "hike", "climb"], likes: ["dodge", "time"], moods: ["hype"] },
    { words: ["trivia", "quiz", "facts"], likes: ["answer", "guess"], moods: ["playful"] },
    { words: ["board game", "puzzle", "chess"], likes: ["group", "merge"], moods: ["playful"] },
    { words: ["sketch", "draw", "paint", "music", "keys", "band", "open mic"], likes: ["make", "time"], moods: ["playful"] },
    { words: ["bake", "sourdough", "cook", "chicken", "recipe"], likes: ["make", "merge"], moods: ["warm"] },
    { words: ["coffee", "walk", "sunset", "read"], likes: ["guess", "group"], moods: ["calm"] }
  ];

  function hintsFromBio(bio) {
    var text = String(bio || "").toLowerCase(), likes = [], moods = [];
    BIO_HINTS.forEach(function (h) {
      if (h.words.some(function (w) { return text.indexOf(w) >= 0; })) {
        h.likes.forEach(function (f) { if (likes.indexOf(f) < 0) likes.push(f); });
        h.moods.forEach(function (m) { if (moods.indexOf(m) < 0) moods.push(m); });
      }
    });
    return { likes: likes, moods: moods };
  }

  // A demo profile, deterministic from the person's id. `hints` can steer it:
  // { likes: [formulas], moods: [mood words], lean: number, themes: [strings], bio: string }.
  function syntheticProfile(person, P) {
    var B = P.blend, r = rng(hashString("profile|" + person.id));
    var hints = person.hints || {};
    if (hints.bio) {
      var fromBio = hintsFromBio(hints.bio);
      hints = merge({ likes: fromBio.likes, moods: fromBio.moods }, hints);
    }
    var boostF = {}, boostM = {};
    (hints.likes || []).forEach(function (f) { boostF[f] = 1.2; });
    (hints.moods || []).forEach(function (m) { boostM[MOOD_FAMILY[String(m).toLowerCase()] || m] = 1.0; });
    var formula = softmaxNoise(r, FORMULAS, 0.9, boostF);
    var mood = softmaxNoise(r, MOODS, 0.7, boostM);
    var look = softmaxNoise(r, LOOKS, 0.5, null);
    var lean = clamp(P.bait.b0 + 0.9 * normal(r) + (typeof hints.lean === "number" ? hints.lean : 0), P.bait.min, P.bait.max);
    var taste = new Array(DIM);
    for (var i = 0; i < DIM; i++) taste[i] = 0;
    FORMULAS.forEach(function (f, j) { taste[j] = formula[f] - 1 / FORMULAS.length; });
    MOODS.forEach(function (m, j) { taste[OFF_MOOD + j] = mood[m] - 1 / MOODS.length; });
    LOOKS.forEach(function (l, j) { taste[OFF_LOOK + j] = look[l] - 1 / LOOKS.length; });
    taste[OFF_E] = 0.15 * (lean - P.bait.b0);
    var skill = skillMap(person.skill);
    FORMULAS.forEach(function (f) {
      if (!(person.skill && person.skill.byFormula && typeof person.skill.byFormula[f] === "number")) {
        skill.byFormula[f] = clamp(skill.overall + 0.12 * normal(r), 0.05, 0.95);
      }
    });
    return {
      id: person.id, name: person.name || person.id, isMe: false, isFriend: !!person.isFriend,
      synthetic: true, n: B.syntheticPages,
      formula: formula, mood: mood, look: look, hook: hookShares(lean, P),
      lean: lean, taste: taste, skill: skill, themes: hints.themes || []
    };
  }

  function jsDivergence(p, q) {
    var keys = {}, js = 0;
    for (var a in p) keys[a] = true;
    for (var b in q) keys[b] = true;
    for (var k in keys) {
      var pk = p[k] || 0, qk = q[k] || 0, m = (pk + qk) / 2;
      if (pk > 0) js += 0.5 * pk * Math.log(pk / m);
      if (qk > 0) js += 0.5 * qk * Math.log(qk / m);
    }
    return js;
  }

  // How alike two people's tastes are, 0..1.
  function similarity(a, b, P) {
    var W = P.blend.simWeights;
    var an = vecNorm(a.taste), bn = vecNorm(b.taste);
    var tasteSim = an > 1e-9 && bn > 1e-9 ? (1 + cosine(a.taste, an, b.taste, bn)) / 2 : 0.5;
    var formulaSim = 1 - jsDivergence(a.formula, b.formula) / Math.LN2;
    var moodSim = 1 - jsDivergence(a.mood, b.mood) / Math.LN2;
    var leanSim = Math.exp(-Math.abs(a.lean - b.lean));
    var total = W.taste + W.formula + W.mood + W.lean;
    return (W.taste * tasteSim + W.formula * formulaSim + W.mood * moodSim + W.lean * leanSim) / total;
  }

  function topKey(map) {
    var best = null, bv = -Infinity;
    for (var k in map) if (map[k] > bv) { bv = map[k]; best = k; }
    return best;
  }

  // Geometric-mean shares across profiles for one dimension (what they share).
  function sharedShares(profiles, dim, keys, eps) {
    var out = {};
    keys.forEach(function (k) {
      var s = 0;
      profiles.forEach(function (p) { s += Math.log((p[dim][k] || 0) + eps); });
      out[k] = Math.exp(s / profiles.length);
    });
    return normalize(out, keys);
  }

  // What a person likes more than the group does, for "Maya brings the speed".
  function brings(profile, shared, eps) {
    var bestF = null, bf = -Infinity, bestM = null, bm = -Infinity;
    FORMULAS.forEach(function (f) { var v = Math.log((profile.formula[f] + eps) / (shared.formula[f] + eps)); if (v > bf) { bf = v; bestF = f; } });
    MOODS.forEach(function (m) { var v = Math.log((profile.mood[m] + eps) / (shared.mood[m] + eps)); if (v > bm) { bm = v; bestM = m; } });
    return bm >= bf ? { kind: "mood", key: bestM, words: MOOD_BRINGS[bestM] } : { kind: "formula", key: bestF, words: FORMULA_BRINGS[bestF] };
  }

  // Skill fairness, only ever a plus: full bonus when skills match, fading to exactly 0 once the
  // spread reaches skillBand.
  function skillPlus(profiles, formula, P) {
    if (profiles.length < 2) return 0;
    var lo = 1, hi = 0;
    profiles.forEach(function (p) {
      var s = p.skill.byFormula[formula];
      if (typeof s !== "number") s = p.skill.overall;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    });
    return P.blend.skillBonus * Math.max(0, 1 - (hi - lo) / P.blend.skillBand);
  }

  // A member's predicted chance of enjoying a game.
  function memberEnjoy(profile, view, d, P) {
    var B = P.blend, eps = B.eps;
    var f = Object.keys(d.cats.formula)[0], l = Object.keys(d.cats.look)[0];
    var z = B.qualityW * logit(view.sat);
    if (profile.formula[f] !== undefined) z += B.formulaW * Math.log((profile.formula[f] + eps) / (1 / FORMULAS.length + eps));
    for (var m in d.cats.mood) z += B.moodW * d.cats.mood[m] * Math.log(((profile.mood[m] || 0) + eps) / (1 / MOODS.length + eps));
    if (profile.look[l] !== undefined) z += B.lookW * Math.log((profile.look[l] + eps) / (1 / LOOKS.length + eps));
    z += B.leanW * profile.lean * (2 * view.hook - 1);
    return sigmoid(z);
  }

  function centroidProfile(profiles) {
    var c = { id: "centroid", formula: {}, mood: {}, look: {}, lean: 0 };
    [["formula", FORMULAS], ["mood", MOODS], ["look", LOOKS]].forEach(function (pair) {
      pair[1].forEach(function (k) {
        var s = 0;
        profiles.forEach(function (p) { s += p[pair[0]][k]; });
        c[pair[0]][k] = s / profiles.length;
      });
    });
    profiles.forEach(function (p) { c.lean += p.lean / profiles.length; });
    return c;
  }

  function aggregateLog(rs, how, centroidR) {
    var n = rs.length;
    if (!n) return -Infinity;
    if (how === "mean") return Math.log(rs.reduce(function (a, b) { return a + b; }, 0) / n);
    if (how === "min") return Math.log(Math.min.apply(null, rs));
    if (how === "centroid") return Math.log(centroidR);
    return rs.reduce(function (a, b) { return a + Math.log(b); }, 0) / n;
  }

  function names(list) {
    if (list.length <= 1) return list.join("");
    return list.slice(0, -1).join(", ") + " & " + list[list.length - 1];
  }

  // input: {
  //   group:   { id, name },
  //   members: [{ id, name, isMe, isFriend, skill: { overall, byFormula }, hints }],
  //   summaries: [summary + { creatorID, groupID }],   every candidate game
  //   feed:    [gameID] already shown in this Blend (for fairness and no repeats)
  //   count, day
  // }
  // `meUser` is the recommender state used for the member with isMe.
  function groupBlend(S, meUser, input, P) {
    var B = P.blend, day = input.day || 0, eps = B.eps;
    var group = input.group || { id: "", name: "your Group" };
    describeAll(input.summaries || [], P);
    var gGlobal = globalGrab(S, P);
    var profiles = (input.members || []).map(function (m) {
      if (m.profile) return m.profile;
      return m.isMe && meUser ? profileOf(meUser, P, S, m) : syntheticProfile(m, P);
    });
    if (!profiles.length) return { picks: [], spec: null, cohesion: 0, twins: [], members: [] };
    var centroid = centroidProfile(profiles);
    var memberIDs = {};
    profiles.forEach(function (p) { memberIDs[p.id] = true; });

    // Predicted enjoyment of every candidate, per member.
    var games = [];
    (input.summaries || []).forEach(function (s) {
      var d = CACHE.descs[s.id];
      if (!d) return;
      var v = itemView(S, d, P, day, gGlobal);
      var rs = profiles.map(function (p) { return memberEnjoy(p, v, d, P); });
      var f = Object.keys(d.cats.formula)[0];
      var social = 0;
      if (group.id && (s.groupID === group.id)) social += B.groupGameBonus;
      if (s.creatorID && memberIDs[s.creatorID]) social += B.memberMadeBonus;
      games.push({
        id: s.id, d: d, view: v, rs: rs, formula: f,
        agg: aggregateLog(rs, B.aggregate, memberEnjoy(centroid, v, d, P)),
        minR: Math.min.apply(null, rs),
        skill: skillPlus(profiles, f, P),
        social: social
      });
    });

    // Each member's average over the pool, for "Everyone's pick" and "For Maya & you".
    var means = profiles.map(function (p, j) {
      var s = 0;
      games.forEach(function (g) { s += g.rs[j]; });
      return games.length ? s / games.length : 0.5;
    });

    // Satisfaction each member has had from this Blend so far.
    var served = profiles.map(function () { return 0; });
    var shownSet = {};
    var byId = {};
    games.forEach(function (g) { byId[g.id] = g; });
    (input.feed || []).forEach(function (id) {
      shownSet[id] = true;
      var g = byId[id];
      if (g) g.rs.forEach(function (r, j) { served[j] += r; });
    });

    var count = Math.max(0, input.count || 8);
    var picks = [], pickedFormulas = {};
    while (picks.length < count) {
      var pool = games.filter(function (g) { return !shownSet[g.id]; });
      if (!pool.length) break;
      var safe = pool.filter(function (g) { return g.minR >= B.miseryFloor; });
      if (safe.length) pool = safe;
      var meanServed = served.reduce(function (a, b) { return a + b; }, 0) / served.length;
      var weights = served.map(function (u) { return Math.max(0, meanServed - u) / (meanServed + 0.25); });
      var best = null, bestScore = -Infinity, bestFair = 0;
      pool.forEach(function (g) {
        var fair = 0;
        g.rs.forEach(function (r, j) { fair += weights[j] * r; });
        fair *= B.fairBoost;
        var score = g.agg + g.skill + fair + g.social - B.samePenalty * (pickedFormulas[g.formula] || 0);
        if (score > bestScore || (score === bestScore && best && g.id < best.id)) { bestScore = score; best = g; bestFair = fair; }
      });
      shownSet[best.id] = true;
      pickedFormulas[best.formula] = (pickedFormulas[best.formula] || 0) + 1;
      best.rs.forEach(function (r, j) { served[j] += r; });

      var lifts = best.rs.map(function (r, j) { return { j: j, lift: r - means[j] }; });
      var everyone = lifts.every(function (x) { return x.lift >= 0; }) && profiles.length > 1;
      lifts.sort(function (a, b) { return b.lift - a.lift || a.j - b.j; });
      var forWho = lifts.filter(function (x) { return x.lift > 0; }).slice(0, 2).map(function (x) { return profiles[x.j]; });
      if (!forWho.length) forWho = [profiles[lifts[0].j]];
      forWho.sort(function (a, b) { return (a.isMe ? 1 : 0) - (b.isMe ? 1 : 0); });
      var label = everyone ? "Everyone's pick" : "For " + names(forWho.map(function (p) { return p.isMe ? "you" : p.name; }));
      var moodKey = topKey(best.d.cats.mood);
      var whoNames = forWho.map(function (p) { return p.isMe ? "you" : p.name; });
      var who = names(whoNames);
      var why = everyone
        ? (profiles.length === 2 ? "you both" : "you all") + " lean " + MOOD_WORD[moodKey] + " " + FORMULA_WORD[best.formula]
        : who.charAt(0).toUpperCase() + who.slice(1) + (whoNames.length === 1 && whoNames[0] !== "you" ? " likes " : " like ") + FORMULA_WORD[best.formula] + " games";
      if (best.skill > 0.25) why += ", and you're evenly matched";
      var perMember = {};
      profiles.forEach(function (p, j) { perMember[p.id] = best.rs[j]; });
      picks.push({
        gameID: best.id, label: label, why: why, score: bestScore,
        everyone: Math.exp(best.agg), minEnjoy: best.minR, skillPlus: best.skill, fairPlus: bestFair,
        perMember: perMember
      });
    }

    // Pairwise similarity: cohesion and taste twins.
    var pairs = [];
    for (var a = 0; a < profiles.length; a++) {
      for (var b = a + 1; b < profiles.length; b++) {
        pairs.push({ a: profiles[a], b: profiles[b], sim: similarity(profiles[a], profiles[b], P) });
      }
    }
    var cohesion = pairs.length ? pairs.reduce(function (s, p) { return s + p.sim; }, 0) / pairs.length : 1;
    var twins = pairs
      .filter(function (p) { return (p.a.isMe || p.b.isMe) && !(p.a.isFriend || p.b.isFriend); })
      .sort(function (x, y) { return y.sim - x.sim; })
      .slice(0, 3)
      .map(function (p) {
        var other = p.a.isMe ? p.b : p.a, me = p.a.isMe ? p.a : p.b;
        var shared = sharedShares([p.a, p.b], "formula", FORMULAS, eps);
        var sharedMood = sharedShares([p.a, p.b], "mood", MOODS, eps);
        var f = topKey(shared), m = topKey(sharedMood);
        return {
          userID: other.id, name: other.name, similarity: p.sim,
          why: "You and " + other.name + " both like " + MOOD_WORD[m] + " " + FORMULA_WORD[f] + " games",
          evenlyMatched: skillPlus([me, other], f, P) > 0
        };
      });

    return {
      picks: picks,
      spec: blendSpec(profiles, group, P),
      cohesion: cohesion,
      twins: twins,
      members: profiles.map(function (p) {
        return { id: p.id, name: p.name, isMe: p.isMe, synthetic: p.synthetic, lean: p.lean, topFormula: topKey(p.formula), topMood: topKey(p.mood) };
      }),
      aggregate: B.aggregate,
      version: VERSION
    };
  }

  // A Blend game spec: what the Group shares, plus what each person brings, in the shape of
  // BubbleBrief, with a prompt Muse Studio can take as-is.
  function blendSpec(profiles, group, P) {
    var B = P.blend, eps = B.eps;
    var shared = {
      formula: sharedShares(profiles, "formula", FORMULAS, eps),
      mood: sharedShares(profiles, "mood", MOODS, eps),
      look: sharedShares(profiles, "look", LOOKS, eps)
    };
    // Formula: what they share most, plus the skill-fairness bonus where skills match.
    var formula = null, fs = -Infinity;
    FORMULAS.forEach(function (f) {
      var s = Math.log(shared.formula[f]) + skillPlus(profiles, f, P);
      if (s > fs) { fs = s; formula = f; }
    });
    var moods = MOODS.slice().sort(function (a, b) { return shared.mood[b] - shared.mood[a]; });
    var mood = [moods[0]];
    if (shared.mood[moods[1]] > 0.6 * shared.mood[moods[0]]) mood.push(moods[1]);
    var look = topKey(shared.look);
    // Energy follows the least bait-tolerant member, so nobody gets a game louder than they like.
    var minLean = Math.min.apply(null, profiles.map(function (p) { return p.lean; }));
    var energy = minLean < -0.75 ? "low" : minLean < 0.5 ? "medium" : "high";
    var matched = skillPlus(profiles, formula, P) > 0;
    var competition = profiles.length < 2 ? "light" : matched ? "friendly" : "light";
    var contributions = profiles.map(function (p) {
      return { userID: p.id, name: p.isMe ? "you" : p.name, brings: brings(p, shared, eps) };
    });
    var themes = [];
    profiles.forEach(function (p) { (p.themes || []).forEach(function (t) { if (themes.length < 4 && themes.indexOf(t) < 0) themes.push(t); }); });
    var moodWords = mood.map(function (m) { return MOOD_WORD[m]; }).join(" and ");
    var bringsText = contributions
      .filter(function (c) { return !(c.brings.kind === "formula" && c.brings.key === formula); })
      .slice(0, 3)
      .map(function (c) { return (c.name === "you" ? "you bring " : c.name + " brings ") + c.brings.words; })
      .join("; ");
    var who = profiles.length === 2 ? names(profiles.map(function (p) { return p.isMe ? "you" : p.name; })) : "everyone in " + group.name;
    var why = (profiles.length === 2 ? "You both like " : "You all like ") + moodWords + " " + FORMULA_WORD[formula] + " games" + (bringsText ? "; " + bringsText : "");
    var prompt = "Make a " + moodWords + " " + FORMULA_WORD[formula] + " game for " + who + ", in the " + look + " look. " +
      (themes.length ? "Work in " + themes.join(", ") + ". " : "") +
      (bringsText ? bringsText.charAt(0).toUpperCase() + bringsText.slice(1) + ". " : "") +
      "Keep the energy " + energy + (matched ? " and make it a fair head-to-head: they play at a similar level." : " and keep it friendly: skills differ, so lean co-op over versus.");
    return {
      formula: formula, look: look, mood: mood, energy: energy, competition: competition,
      intent: profiles.length === 2 ? "get to know each other through a game made for the two of them" : "a game everyone in " + group.name + " can enjoy together",
      audience: group.id ? "group:" + group.id : "everyone",
      contentSources: group.id ? ["group:" + group.id] : [],
      themes: themes, evenlyMatched: matched, contributions: contributions,
      why: why, prompt: prompt
    };
  }

  // ---------------------------------------------------------------------------------------------
  // App bridge: strings in, strings out, one person ("me"). GameRecommender.swift calls these.

  var APP = { S: null, P: null };

  var app = {
    load: function (stateJSON, overridesJSON) {
      var S = null;
      try { S = stateJSON ? JSON.parse(stateJSON) : null; } catch (e) { S = null; }
      if (!S || S.v !== 1 || !S.items || !S.users) S = newState();
      if (!S.global) S.global = { g1: 0, g0: 0 };
      var over = null;
      try { over = overridesJSON ? JSON.parse(overridesJSON) : null; } catch (e2) { over = null; }
      APP.S = S;
      // On one phone every play is the same person's, so a game's own takeover rate says what
      // *you* like, not how grabby it is for people in general. Keep the hook mostly the
      // manifest's (your taste and the posteriors already carry what you like).
      APP.P = params(merge({ coldStart: { hookAgeK: 60 } }, over || {}));
      var me = userIn(S, "me");
      if (!me.taste || me.taste.length !== DIM) S.users.me = newUser();
      if (!S.users.me.cal.look) S.users.me.cal.look = {};
      return JSON.stringify({ ok: true, version: VERSION, stages: APP.P.stages, items: Object.keys(S.items).length });
    },
    rank: function (inputJSON) {
      if (!APP.S) app.load(null, null);
      var ranker = APP.P.interleave && APP.P.interleave.on ? interleave : rank;
      return JSON.stringify(ranker(APP.S, userIn(APP.S, "me"), JSON.parse(inputJSON), APP.P));
    },
    observe: function (impressionJSON) {
      if (!APP.S) app.load(null, null);
      return JSON.stringify(observe(APP.S, userIn(APP.S, "me"), JSON.parse(impressionJSON), APP.P));
    },
    // A save or social moment away from the open feed page: {id, kind, with, day}.
    signal: function (signalJSON) {
      if (!APP.S) app.load(null, null);
      return JSON.stringify(signal(APP.S, userIn(APP.S, "me"), JSON.parse(signalJSON), APP.P));
    },
    endSession: function () {
      if (APP.S) endSession(userIn(APP.S, "me"), APP.S);
      return "{}";
    },
    // Interleaving tally so far, per control: {baseline: {sessions, formulaWins, ...}}.
    interleaveStats: function () {
      return JSON.stringify(interleaveStats(APP.S));
    },
    exportState: function () {
      return JSON.stringify(APP.S || newState());
    },
    groupBlend: function (inputJSON) {
      if (!APP.S) app.load(null, null);
      return JSON.stringify(groupBlend(APP.S, userIn(APP.S, "me"), JSON.parse(inputJSON), APP.P));
    },
    profile: function () {
      if (!APP.S) app.load(null, null);
      return JSON.stringify(profileOf(userIn(APP.S, "me"), APP.P, APP.S, { id: "me", isMe: true }));
    },
    debugSummary: function () {
      if (!APP.S) return "{}";
      var me = userIn(APP.S, "me");
      return JSON.stringify({
        version: VERSION, stages: APP.P.stages, bait: baitLean(me, APP.P, APP.S), pages: me.n, items: Object.keys(APP.S.items).length,
        interleave: APP.P.interleave && APP.P.interleave.on ? { against: APP.P.interleave.against, stats: interleaveStats(APP.S) } : null
      });
    }
  };

  var API = {
    version: VERSION,
    defaults: defaults,
    params: params,
    newState: newState,
    newUser: newUser,
    userIn: userIn,
    describe: describe,
    describeAll: describeAll,
    itemView: function (S, id, P, day) {
      var d = CACHE.descs[id];
      return d ? itemView(S, d, P, day || 0, globalGrab(S, P)) : null;
    },
    rewardOf: rewardOf,
    observe: observe,
    signal: signal,
    socialSum: socialSum,
    endSession: endSession,
    rank: rank,
    baseline: baseline,
    interleave: interleave,
    interleaveStats: interleaveStats,
    baitLean: baitLean,
    botQuality: botQuality,
    profileOf: profileOf,
    syntheticProfile: syntheticProfile,
    hintsFromBio: hintsFromBio,
    similarity: similarity,
    memberEnjoy: function (profile, S, id, P, day) {
      var d = CACHE.descs[id];
      return d ? memberEnjoy(profile, itemView(S, d, P, day || 0, globalGrab(S, P)), d, P) : null;
    },
    skillPlus: skillPlus,
    groupBlend: groupBlend,
    blendSpec: blendSpec,
    _math: { sigmoid: sigmoid, logit: logit, phi: phi, betaSample: betaSample, betaBelow: betaBelow, rng: rng, hashString: hashString, signTest: signTest, wilson: wilson },
    _dims: { FORMULAS: FORMULAS, MOODS: MOODS, LOOKS: LOOKS, SCOPES: SCOPES, DIM: DIM },
    app: app
  };

  root.GameRecs = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
