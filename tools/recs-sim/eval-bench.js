#!/usr/bin/env node
// Evaluation benchmark: the hand-written formula next to the simple published baselines, in
// separate synthetic worlds (each policy gets its own copy of the world and learns on its own),
// with regret against an oracle and learning curves per kind of person. No weights are tuned:
// every policy runs at its defaults.
//
//   node tools/recs-sim/eval-bench.js              3 worlds
//   node tools/recs-sim/eval-bench.js --seeds 5
//
// Policies:
//   today        today's feed: weighted random over the candidates (BubbleFeedGenerator's port)
//   popular      most popular: the most finished games so far, across everyone (MostPop)
//   e-greedy     ε-greedy bandit, ε = 0.1, on each game's mean judged value across everyone
//                (Sutton & Barto; the baseline Li et al. 2010 and Chapelle & Li 2011 compare with)
//   greedy       the formula with Thompson sampling off (posterior means)
//   formula      the formula as it ships (v0.5 defaults)
//
// Regret: per page, the oracle shows the candidate with the highest expected payoff for this
// person (chance they play it × how much they'd enjoy it, the simulator's own truth), avoiding the
// last 4 pages; regret is the oracle's payoff minus the page actually shown. People, games and
// behavior are sim.js's, so the numbers say which way things move, not by how much in real life.
"use strict";
const path = require("path");
const R = require(path.join(__dirname, "../../FacebookClone/Bubbles/Recommend/game-recs.js"));
const { buildWorld, behave, candidatesFor, trueEnjoy, tasteOf, TYPES } = require("./sim.js");

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const DAYS = +opt("--days", 14);
const SEEDS = +opt("--seeds", 3);
const FIRST_SEED = +opt("--seed", 1);
const MAX_PAGES = 40, COUNT = 12, WINDOW = 4, EPS = 0.1;
const { rng, hashString, sigmoid } = R._math;
const FORMULAS = R._dims.FORMULAS;
const JUDGE = R.params();

function pTake(u, item, reason) {
  const boost = reason === "friendBurst" ? 0.4 : reason === "daily" ? 0.5 : 0;
  return sigmoid(-0.9 + u.T.grabHook * (2 * item.H - 1) + 0.8 * tasteOf(u, item) + boost);
}
function payoff(u, item, reason) { return pTake(u, item, reason) * trueEnjoy(u, item); }
function favorite(u) { return FORMULAS.reduce((a, f) => (u.tf[f] > u.tf[a] ? f : a), FORMULAS[0]); }

// The simple baselines pick greedily by a global score, with the same no-repeat window.
function greedyPicks(input, scoreOf, r, eps) {
  const feed = input.feed.slice(), picks = [];
  const byGame = {};
  input.candidates.forEach((c) => { (byGame[c.gameID] = byGame[c.gameID] || []).push(c); });
  const games = Object.keys(byGame);
  for (let k = 0; k < input.count; k++) {
    const blocked = new Set(feed.slice(Math.max(0, feed.length - WINDOW)));
    let pool = games.filter((g) => !blocked.has(g));
    if (!pool.length) pool = games;
    let best;
    if (eps && r() < eps) best = pool[Math.floor(r() * pool.length)];
    else best = pool.reduce((a, g) => (scoreOf(g) + 1e-9 * r() > scoreOf(a) ? g : a), pool[0]);
    const c = byGame[best].reduce((a, x) => (x.weight > a.weight ? x : a), byGame[best][0]);
    picks.push({ gameID: best, reason: c.reason, runUserID: c.runUserID || null });
    feed.push(best);
  }
  return { picks };
}

const POLICIES = [
  { key: "today", name: "Today's feed (weighted random)" },
  { key: "popular", name: "Most popular (MostPop)" },
  { key: "egreedy", name: "ε-greedy bandit (ε = 0.1)" },
  { key: "greedy", name: "Formula, Thompson off (greedy)", over: { stages: { bandit: false } } },
  { key: "formula", name: "Formula (v0.5 defaults)", over: {} }
];
// --metric adds two greedy rankers that differ only in what they optimize: clicks (CTR, the
// usual engagement target) or our grab-and-satisfaction reward. Same posteriors, nothing else on.
if (argv.includes("--metric")) {
  POLICIES.push(
    { key: "ctrOnly", name: "Clicks only (CTR), greedy", over: { stages: { reward: false, bandit: false, calibration: false, coldStart: false, bait: false } } },
    { key: "rewardOnly", name: "Our reward only, greedy", over: { stages: { reward: true, bandit: false, calibration: false, coldStart: false, bait: false } } }
  );
}
// --ablate adds the formula with one part off, to see where its payoff goes (diagnosis, not tuning).
if (argv.includes("--ablate")) {
  POLICIES.push(
    { key: "noCal", name: "Formula, calibration off", over: { stages: { calibration: false } } },
    { key: "noBait", name: "Formula, bait lean and guards off", over: { stages: { bait: false } } },
    { key: "noCold", name: "Formula, cold start off", over: { stages: { coldStart: false } } },
    { key: "noReason", name: "Formula, no reason prior", over: { feed: { reasonPrior: 0 } } },
    { key: "valueOnly", name: "Formula, greedy, cal+bait off", over: { stages: { bandit: false, calibration: false, bait: false } } },
    { key: "equalW", name: "…and grab = satisfaction weight", over: { stages: { bandit: false, calibration: false, bait: false }, bandit: { grabWeight: 1, satWeight: 1 } } }
  );
}

function run(world, policy, seed) {
  const P = policy.over ? R.params(policy.over) : null;
  const S = R.newState();
  const byId = {};
  world.items.forEach((it) => { byId[it.id] = it; });
  const r = rng(hashString("behave|bench|" + seed));
  const pr = rng(hashString("policy|" + policy.key + "|" + seed));
  const glob = { fin: {}, vSum: {}, n: {} };
  const out = {};
  Object.keys(TYPES).forEach((t) => {
    out[t] = { pages: 0, sessions: 0, util: 0, regret: 0, slop: 0, hooky: 0, fav: 0, latePages: 0, lateUtil: 0, lateRegret: 0, lateSessions: 0, lateSessPages: 0, byDay: [] };
  });

  for (let day = 0; day < DAYS; day++) {
    const live = world.items.filter((it) => it.day <= day);
    const summaries = live.map((it) => it.summary);
    const order = world.users.slice();
    const vr = rng(hashString("order|" + day + "|" + seed));
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(vr() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const late = day >= Math.floor(DAYS / 2);

    for (const u of order) {
      const m = out[u.type];
      if (!m.byDay[day]) m.byDay[day] = { pages: 0, regret: 0, fav: 0 };
      const md = m.byDay[day];
      const user = P ? R.userIn(S, u.id) : null;
      const cands = candidatesFor(u, live, day);
      const fav = favorite(u);
      // The oracle's best payoff per game (best reason), once per session.
      const bestPay = {};
      cands.forEach((c) => { const v = payoff(u, byId[c.gameID], c.reason); if (!(bestPay[c.gameID] >= v)) bestPay[c.gameID] = v; });
      const feed = [], keys = [];
      let mood = 0.5, pages = 0, exited = false;
      while (pages < MAX_PAGES && !exited) {
        if (pages >= feed.length) {
          const input = { candidates: cands, summaries, feed: feed.slice(), feedKeys: keys.slice(), count: COUNT, seed: hashString(u.id + "|" + day + "|" + pages), day };
          let res;
          if (P) res = R.rank(S, user, input, P);
          else if (policy.key === "today") res = R.baseline(input);
          else if (policy.key === "popular") res = greedyPicks(input, (g) => glob.fin[g] || 0, pr, 0);
          else res = greedyPicks(input, (g) => ((glob.vSum[g] || 0) + 1) / ((glob.n[g] || 0) + 2), pr, EPS);
          res.picks.forEach((p) => { feed.push(p.gameID); keys.push(p.gameID + "|" + p.reason + "|" + (p.runUserID || "-")); });
          if (!res.picks.length) break;
        }
        const item = byId[feed[pages]], reason = keys[pages].split("|")[1];
        const recent = new Set(feed.slice(Math.max(0, pages - WINDOW), pages));
        let oracle = 0;
        for (const g in bestPay) if (!recent.has(g) && bestPay[g] > oracle) oracle = bestPay[g];
        const regret = Math.max(0, oracle - payoff(u, item, reason));
        const b = behave(r, u, item, reason);
        mood = 0.7 * mood + 0.3 * b.util;
        let hazard = 0.03 + 0.22 * (1 - mood) * (1 - mood);
        if (b.enjoy !== null && b.enjoy < 0.25) hazard += u.type === "averse" ? 0.12 : 0.06;
        exited = r() < hazard;
        b.imp.endedSession = exited || pages === MAX_PAGES - 1;
        b.imp.day = day;
        if (P) R.observe(S, user, b.imp, P);
        else {
          const v = R.rewardOf(b.imp, JUDGE).v;
          glob.vSum[item.id] = (glob.vSum[item.id] || 0) + v;
          glob.n[item.id] = (glob.n[item.id] || 0) + 1;
          if (b.imp.runsFinished > 0) glob.fin[item.id] = (glob.fin[item.id] || 0) + 1;
        }
        pages++;
        const isFav = item.summary.formula === fav ? 1 : 0;
        m.pages++; m.util += b.util; m.regret += regret; m.slop += item.slop ? 1 : 0; m.hooky += item.H >= 0.6 ? 1 : 0; m.fav += isFav;
        md.pages++; md.regret += regret; md.fav += isFav;
        if (late) { m.latePages++; m.lateUtil += b.util; m.lateRegret += regret; }
      }
      if (P) R.endSession(user, S);
      m.sessions++;
      if (late) { m.lateSessions++; m.lateSessPages += pages; }
    }
  }
  return out;
}

function addInto(a, b) {
  for (const k in b) {
    if (k === "byDay") {
      a.byDay = a.byDay || [];
      b.byDay.forEach((d, i) => { a.byDay[i] = a.byDay[i] || { pages: 0, regret: 0, fav: 0 }; for (const x in d) a.byDay[i][x] += d[x]; });
    } else a[k] = (a[k] || 0) + b[k];
  }
}

const t0 = Date.now();
const totals = {};
POLICIES.forEach((p) => { totals[p.key] = {}; Object.keys(TYPES).forEach((t) => { totals[p.key][t] = {}; }); });
for (let s = 0; s < SEEDS; s++) {
  const seed = FIRST_SEED + s;
  for (const p of POLICIES) {
    const o = run(buildWorld(seed), p, seed);
    for (const t in o) addInto(totals[p.key][t], o[t]);
  }
}

const f3 = (x) => x.toFixed(3), pc = (x) => (100 * x).toFixed(1) + "%";
console.log("Evaluation benchmark, recs " + R.version + " (" + SEEDS + " worlds, " + DAYS + " days, each policy in its own copy of each world)");
for (const t of Object.keys(TYPES)) {
  console.log("\n" + t.toUpperCase() + "   second half (after learning) unless noted");
  console.log("  " + "policy".padEnd(34) + "joy/page".padStart(9) + "regret/pg".padStart(11) + "pages/sess".padStart(12) + "slop".padStart(8) + "fav formula".padStart(13) + "regret d1".padStart(11) + "d2-3".padStart(8) + "d4-7".padStart(8) + "d8-14".padStart(8));
  for (const p of POLICIES) {
    const m = totals[p.key][t];
    const span = (a, b) => { let pg = 0, rg = 0; for (let d = a; d <= b && d < DAYS; d++) { if (m.byDay[d]) { pg += m.byDay[d].pages; rg += m.byDay[d].regret; } } return pg ? f3(rg / pg) : "-"; };
    console.log("  " + p.name.padEnd(34) + f3(m.lateUtil / m.latePages).padStart(9) + f3(m.lateRegret / m.latePages).padStart(11) + (m.lateSessPages / m.lateSessions).toFixed(1).padStart(12) +
      pc(m.slop / m.pages).padStart(8) + pc(m.fav / m.pages).padStart(13) + span(0, 0).padStart(11) + span(1, 2).padStart(8) + span(3, 6).padStart(8) + span(7, 13).padStart(8));
  }
}
if (argv.includes("--json")) {
  const outJSON = {};
  for (const p of POLICIES) {
    outJSON[p.key] = { name: p.name };
    for (const t of Object.keys(TYPES)) {
      const m = totals[p.key][t];
      const span = (a, b) => { let pg = 0, rg = 0; for (let d = a; d <= b && d < DAYS; d++) { if (m.byDay[d]) { pg += m.byDay[d].pages; rg += m.byDay[d].regret; } } return pg ? rg / pg : null; };
      outJSON[p.key][t] = { joy: m.lateUtil / m.latePages, regret: m.lateRegret / m.latePages, pagesPerSession: m.lateSessPages / m.lateSessions,
        slop: m.slop / m.pages, hooky: m.hooky / m.pages, fav: m.fav / m.pages,
        regretByDay: [span(0, 0), span(1, 2), span(3, 6), span(7, 13)] };
    }
  }
  require("fs").writeFileSync(opt("--json", "eval-bench.json"), JSON.stringify(outJSON, null, 1));
}
console.log("\nfav formula = share of all pages from the person's own favorite formula (the oracle would show it often but not always).");
console.log(((Date.now() - t0) / 1000).toFixed(1) + " s");
