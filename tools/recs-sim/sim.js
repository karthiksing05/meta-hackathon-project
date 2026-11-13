#!/usr/bin/env node
// Offline simulator for the Bubbles recommender: how each stage changes the feed.
//
//   node tools/recs-sim/sim.js                     every policy, default world
//   node tools/recs-sim/sim.js --users 20 --days 10
//   node tools/recs-sim/sim.js --sweep calibration.lambda=0.3,0.5,0.7
//   node tools/recs-sim/sim.js --json out.json     also write the numbers
//
// The world is synthetic, so the numbers are about direction, not size. Each Bubble has a true hook
// H (how grabby it is) and a true quality Q. About 20% are clickbait slop: hooky but bad. People
// come in three kinds:
//   lover     hooky Bubbles grab them hard and they enjoy them even when they're shallow
//   balanced  hooky Bubbles grab them; quality is what they enjoy
//   averse    hooky Bubbles barely grab them, and shallow hooky ones annoy them
// Every person has their own taste over formulas and moods. Sessions end sooner when a session goes
// badly, so pages per session is the long-term number to watch (Netflix's point about proxies).
"use strict";
const fs = require("fs");
const path = require("path");
const R = require(path.join(__dirname, "../../FacebookClone/Bubbles/Recommend/game-recs.js"));

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const USERS_PER_TYPE = +opt("--users", 30);
const DAYS = +opt("--days", 14);
const START_ITEMS = +opt("--items", 50);
const NEW_PER_DAY = +opt("--new", 3);
const MAX_PAGES = 40;
const SEED = +opt("--seed", 1);
const jsonOut = opt("--json", null);
const sweep = opt("--sweep", null);

const { sigmoid, logit, rng, hashString } = R._math;
const FORMULAS = R._dims.FORMULAS;

// ------------------------------------------------------------------------------------------------
// World

const MOOD_WORDS = { calm: ["calm", "chill", "dreamy"], warm: ["cozy", "warm", "nostalgic"], playful: ["playful", "silly", "funny", "curious"], hype: ["hype", "chaotic", "intense"] };
const LOOKS = R._dims.LOOKS;

function pickWeighted(r, entries) {
  const total = entries.reduce((a, e) => a + e[1], 0);
  let x = r() * total;
  for (const [v, w] of entries) { if (x < w) return v; x -= w; }
  return entries[entries.length - 1][0];
}
function gauss(r) { let u = r(); while (u <= 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }

function makeItem(r, id, day) {
  const formula = pickWeighted(r, [["dodge", 25], ["time", 15], ["merge", 12], ["guess", 15], ["group", 10], ["answer", 15], ["make", 8]]);
  const fam = pickWeighted(r, [["calm", 2], ["warm", 2], ["playful", 4], ["hype", 3]]);
  const mood = [MOOD_WORDS[fam][Math.floor(r() * MOOD_WORDS[fam].length)]];
  const fast = formula === "dodge" || formula === "time";
  const energy = pickWeighted(r, fast ? [["low", 1], ["medium", 3], ["high", 5]] : [["low", 4], ["medium", 4], ["high", 1]]);
  const look = LOOKS[Math.floor(r() * LOOKS.length)];
  const scopeRoll = r();
  const scope = scopeRoll < 0.85 ? "everyone" : scopeRoll < 0.95 ? "group" : "event";
  const isDaily = scope === "group" && r() < 0.5;
  const summary = { id, formula, mood, energy, competition: pickWeighted(r, [["light", 1], ["friendly", 2], ["competitive", 1]]), look, scope, isDaily, bots: [] };
  const hookPrior = R.describe(summary, R.params()).hookPrior;

  let H = sigmoid(logit(hookPrior) + 0.6 * gauss(r));
  let Q;
  const kindRoll = r();
  let kind = "normal";
  if (kindRoll < 0.2) { kind = "clickbait"; H = sigmoid(logit(H) + 1.2); Q = sigmoid(-1.6 + 0.5 * gauss(r)); }
  else if (kindRoll < 0.3) { kind = "dud"; H = sigmoid(logit(H) - 0.8); Q = sigmoid(-1.4 + 0.5 * gauss(r)); }
  else Q = sigmoid(0.3 + 0.9 * gauss(r));

  // Bot playtests: informative about quality, but noisy. 15% have none (stub runtime, failed sims).
  if (r() < 0.85) {
    const Qb = Math.min(1, Math.max(0, Q + 0.25 * gauss(r)));
    for (let k = 0; k < 8; k++) {
      const skill = (k + r()) / 8;
      const score = Math.round(10 + 40 * (Qb * skill + (1 - Qb) * r()));
      const sec = Math.max(1, Math.min(90, 2 + 40 * Qb + 6 * gauss(r)));
      summary.bots.push({ skill, score, sec });
    }
  }
  return { id, day, summary, H, Q, kind, slop: Q < 0.3 };
}

const TYPES = {
  lover: { grabHook: 2.0, hookJoy: 1.0, qualityCare: 1.2 },
  balanced: { grabHook: 1.3, hookJoy: 0.2, qualityCare: 2.0 },
  averse: { grabHook: 0.7, hookJoy: -1.2, qualityCare: 2.8 }
};

function makeUser(r, id, type) {
  const tf = {}, tm = {};
  FORMULAS.forEach((f) => { tf[f] = 0.8 * gauss(r); });
  Object.keys(MOOD_WORDS).forEach((m) => { tm[m] = 0.6 * gauss(r); });
  return { id, type, T: TYPES[type], tf, tm, friendItems: new Set() };
}

const MOOD_FAMILY = { calm: "calm", chill: "calm", dreamy: "calm", cozy: "warm", warm: "warm", nostalgic: "warm", playful: "playful", silly: "playful", funny: "playful", curious: "playful", hype: "hype", chaotic: "hype", intense: "hype" };
function tasteOf(u, item) {
  return u.tf[item.summary.formula] + u.tm[MOOD_FAMILY[item.summary.mood[0]]];
}

// How much this person would enjoy playing this Bubble (the expectation behave() samples from).
function trueEnjoy(u, item) {
  const T = u.T;
  return sigmoid(-0.3 + T.qualityCare * (2 * item.Q - 1) + T.hookJoy * (2 * item.H - 1) + 0.7 * tasteOf(u, item));
}

// One page: what this person does with this Bubble.
function behave(r, u, item, reason) {
  const T = u.T, taste = tasteOf(u, item);
  const boost = reason === "friendBurst" ? 0.4 : reason === "daily" ? 0.5 : 0;
  const pTake = sigmoid(-0.9 + T.grabHook * (2 * item.H - 1) + 0.8 * taste + boost);
  const imp = { id: item.id, dwellSec: 0, tookOver: false, runsFinished: 0, replays: 0, saved: false, liked: false, floated: false, openedBoard: false, addedFriend: false, remixed: false, quitMidRun: false, endedSession: false };
  let util;
  let enjoy = null;
  if (r() < pTake) {
    imp.tookOver = true;
    enjoy = sigmoid(-0.3 + T.qualityCare * (2 * item.Q - 1) + T.hookJoy * (2 * item.H - 1) + 0.7 * taste);
    const finished = r() < 0.35 + 0.6 * enjoy;
    imp.runsFinished = finished ? 1 : 0;
    imp.quitMidRun = !finished;
    if (finished) { let n = 0; while (n < 5 && r() < 0.65 * enjoy) n++; imp.replays = n; }
    imp.saved = r() < 0.3 * enjoy * enjoy;
    imp.liked = r() < 0.25 * enjoy;
    imp.floated = r() < 0.08 * enjoy;
    imp.addedFriend = r() < (item.summary.scope !== "everyone" ? 0.12 : 0.03) * enjoy;
    imp.openedBoard = r() < 0.15 * enjoy;
    imp.remixed = r() < 0.03 * enjoy;
    imp.dwellSec = 10 + 30 * enjoy;
    util = enjoy;
  } else {
    const quick = r() < 1 - 0.8 * pTake;
    imp.dwellSec = quick ? 0.6 : 2 + 8 * r();
    util = imp.dwellSec >= 6 ? 0.15 : 0.02;
  }
  return { imp, util, enjoy, pTake };
}

// ------------------------------------------------------------------------------------------------
// Feed candidates, like BubbleStore.feedCandidates

function candidatesFor(u, live, day) {
  const out = [];
  for (const item of live) {
    if (item.summary.isDaily) out.push({ gameID: item.id, reason: "daily", runUserID: "m", weight: 3 });
    if (u.friendItems.has(item.id)) out.push({ gameID: item.id, reason: "friendBurst", runUserID: "f", weight: 2.2 });
    if (day - item.day < 3) out.push({ gameID: item.id, reason: "nearby", runUserID: "c", weight: 1.8 });
    out.push({ gameID: item.id, reason: "popular", runUserID: null, weight: 0.8 });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Policies

const POLICIES = [
  { key: "today", name: "Today's feed (weighted random)", baseline: true },
  { key: "ctr", name: "CTR only (what Netflix warns about)", over: { stages: { reward: false, bandit: true, calibration: false, coldStart: false, bait: false } } },
  { key: "s1", name: "1 reward", over: { stages: { reward: true, bandit: false, calibration: false, coldStart: false, bait: false } } },
  { key: "s12", name: "1+2 + Thompson sampling", over: { stages: { reward: true, bandit: true, calibration: false, coldStart: false, bait: false } } },
  { key: "s123", name: "1+2+3 + calibration", over: { stages: { reward: true, bandit: true, calibration: true, coldStart: false, bait: false } } },
  { key: "s1234", name: "1-4 + cold start", over: { stages: { reward: true, bandit: true, calibration: true, coldStart: true, bait: false } } },
  { key: "full", name: "1-4 + bait appetite", over: { stages: { reward: true, bandit: true, calibration: true, coldStart: true, bait: true } } }
];

// ------------------------------------------------------------------------------------------------
// Run

function buildWorld(seed) {
  const r = rng(seed);
  const items = [];
  for (let i = 0; i < START_ITEMS; i++) items.push(makeItem(r, "b" + i, -Math.floor(r() * 20)));
  for (let d = 0; d < DAYS; d++) for (let k = 0; k < NEW_PER_DAY; k++) items.push(makeItem(r, "n" + d + "_" + k, d));
  const users = [];
  Object.keys(TYPES).forEach((type) => {
    for (let i = 0; i < USERS_PER_TYPE; i++) users.push(makeUser(r, type + i, type));
  });
  // Friends played a few Bubbles each.
  users.forEach((u) => items.forEach((it) => { if (r() < 0.15) u.friendItems.add(it.id); }));
  return { items, users };
}

function newMetrics() {
  return { sessionPages: [], sessions: 0, pages: 0, takeovers: 0, util: 0, slop: 0, hooky: 0, fresh: 0, kl: 0, ent: 0, lateSessions: 0, latePages: 0, lateUtil: 0, lateSlop: 0 };
}

function runPolicy(world, policy) {
  const P = policy.baseline ? null : R.params(policy.over);
  const S = R.newState();
  const byId = {};
  world.items.forEach((it) => { byId[it.id] = it; });
  const metrics = {};
  Object.keys(TYPES).forEach((t) => { metrics[t] = newMetrics(); });
  const r = rng(hashString("behave|" + SEED));

  for (let day = 0; day < DAYS; day++) {
    const live = world.items.filter((it) => it.day <= day);
    const summaries = live.map((it) => it.summary);
    const order = world.users.slice();
    // Same visiting order for every policy.
    const vr = rng(hashString("order|" + day + "|" + SEED));
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(vr() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }

    for (const u of order) {
      const user = P ? R.userIn(S, u.id) : null;
      const cands = candidatesFor(u, live, day);
      const feed = [], keys = [];
      let mood = 0.5, pages = 0, exited = false;
      const m = metrics[u.type];
      const shown = {};
      const late = day >= Math.floor(DAYS / 2);
      while (pages < MAX_PAGES && !exited) {
        if (pages >= feed.length) {
          const input = { candidates: cands, summaries, feed: feed.slice(), feedKeys: keys.slice(), count: 12, seed: hashString(u.id + "|" + day + "|" + pages), day };
          const out = P ? R.rank(S, user, input, P) : R.baseline(input);
          out.picks.forEach((p) => { feed.push(p.gameID); keys.push(p.gameID + "|" + p.reason + "|" + (p.runUserID || "-")); });
          if (!out.picks.length) break;
        }
        const id = feed[pages];
        const reason = keys[pages].split("|")[1];
        const item = byId[id];
        const b = behave(r, u, item, reason);
        mood = 0.7 * mood + 0.3 * b.util;
        let hazard = 0.03 + 0.22 * (1 - mood) * (1 - mood);
        if (b.enjoy !== null && b.enjoy < 0.25) hazard += u.type === "averse" ? 0.12 : 0.06;
        exited = r() < hazard;
        b.imp.endedSession = exited || pages === MAX_PAGES - 1;
        b.imp.day = day;
        if (P) R.observe(S, user, b.imp, P);
        pages++;
        m.pages++; m.util += b.util; m.takeovers += b.imp.tookOver ? 1 : 0;
        m.slop += item.slop ? 1 : 0; m.hooky += item.H >= 0.6 ? 1 : 0; m.fresh += day - item.day < 2 ? 1 : 0;
        if (late) { m.latePages++; m.lateUtil += b.util; m.lateSlop += item.slop ? 1 : 0; }
        shown[item.summary.formula] = (shown[item.summary.formula] || 0) + 1;
      }
      if (P) R.endSession(user);
      m.sessions++;
      if (late) { m.lateSessions++; m.sessionPages.push(pages); }
      // Formula mix of the session vs what this person likes (softmax of their taste).
      const z = FORMULAS.map((f) => Math.exp(u.tf[f]));
      const zs = z.reduce((a, b) => a + b, 0);
      let kl = 0, ent = 0;
      FORMULAS.forEach((f, i) => {
        const p = z[i] / zs, q = ((shown[f] || 0) + 0.1) / (pages + 0.7);
        kl += p * Math.log(p / q);
        if (shown[f]) { const s = shown[f] / pages; ent -= s * Math.log(s); }
      });
      m.kl += kl; m.ent += ent;
    }
  }
  // The learned state, for groups.js (not enumerable, so it stays out of the reports).
  Object.defineProperty(metrics, "_state", { value: S, enumerable: false });
  if (P) {
    // What the recommender learned about each kind of person.
    Object.keys(TYPES).forEach((t) => {
      const leans = world.users.filter((u) => u.type === t).map((u) => R.baitLean(R.userIn(S, u.id), P, S));
      metrics[t].lean = leans.reduce((a, l) => a + l.lean, 0) / leans.length;
      metrics[t].appetite = leans.reduce((a, l) => a + l.appetite, 0) / leans.length;
      metrics[t].popGrabSlope = leans[0].popGrabSlope;
      metrics[t].popSatSlope = leans[0].popSatSlope;
    });
  }
  return metrics;
}

function summarize(m) {
  return {
    pagesPerSession: m.pages / m.sessions,
    takeoverRate: m.takeovers / m.pages,
    utilPerPage: m.util / m.pages,
    slopShare: m.slop / m.pages,
    hookyShare: m.hooky / m.pages,
    freshShare: m.fresh / m.pages,
    miscalibration: m.kl / m.sessions,
    formulaEntropy: m.ent / m.sessions,
    latePagesPerSession: m.latePages / Math.max(1, m.lateSessions),
    lateUtilPerPage: m.lateUtil / Math.max(1, m.latePages),
    lateSlopShare: m.lateSlop / Math.max(1, m.latePages),
    latePagesSE: se(m.sessionPages),
    lean: m.lean,
    appetite: m.appetite
  };
}

function se(xs) {
  if (xs.length < 2) return 0;
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (xs.length - 1);
  return Math.sqrt(v / xs.length);
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }
function lpad(s, n) { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; }
const pct = (x) => (100 * x).toFixed(1) + "%";

function printTable(results) {
  const types = Object.keys(TYPES);
  const cols = [
    ["pages/sess", (s) => s.latePagesPerSession.toFixed(1) + "±" + s.latePagesSE.toFixed(1)],
    ["joy/page", (s) => s.lateUtilPerPage.toFixed(3)],
    ["takeover", (s) => pct(s.takeoverRate)],
    ["slop", (s) => pct(s.lateSlopShare)],
    ["hooky", (s) => pct(s.hookyShare)],
    ["new", (s) => pct(s.freshShare)],
    ["miscal", (s) => s.miscalibration.toFixed(2)],
    ["bait lean", (s) => (s.lean === undefined ? "-" : s.lean.toFixed(2))]
  ];
  for (const t of types) {
    console.log("\n" + t.toUpperCase() + "  (pages/sess, joy/page and slop are the second half of the run, after learning)");
    console.log(pad("policy", 40) + cols.map((c, i) => lpad(c[0], i === 0 ? 13 : 11)).join(""));
    for (const res of results) {
      const s = res.summary[t];
      console.log(pad(res.name, 40) + cols.map((c, i) => lpad(c[1](s), i === 0 ? 13 : 11)).join(""));
    }
  }
}

const SEEDS = +opt("--seeds", 1);

function mergeMetrics(a, b) {
  if (!a) return b;
  const out = {};
  Object.keys(b).forEach((k) => {
    if (k === "sessionPages") out[k] = a[k].concat(b[k]);
    else if (k === "lean" || k === "appetite" || k === "popGrabSlope" || k === "popSatSlope") out[k] = b[k] === undefined ? undefined : ((a[k] || 0) * (a._n || 1) + b[k]) / ((a._n || 1) + 1);
    else if (typeof b[k] === "number") out[k] = a[k] + b[k];
  });
  out._n = (a._n || 1) + 1;
  return out;
}

function runAll(policies, seed) {
  const t0 = Date.now();
  let world = null;
  const acc = policies.map(() => ({}));
  for (let k = 0; k < SEEDS; k++) {
    world = buildWorld(seed + 1000 * k);
    policies.forEach((p, i) => {
      const metrics = runPolicy(world, p);
      Object.keys(metrics).forEach((t) => { acc[i][t] = mergeMetrics(acc[i][t], metrics[t]); });
    });
  }
  const results = policies.map((p, i) => {
    const summary = {};
    Object.keys(acc[i]).forEach((t) => { summary[t] = summarize(acc[i][t]); });
    return { key: p.key, name: p.name, summary };
  });
  return { results, ms: Date.now() - t0, world };
}

const variantsFile = opt("--variants", null);

module.exports = { buildWorld, runPolicy, behave, trueEnjoy, tasteOf, candidatesFor, TYPES, POLICIES, pad, lpad, se };

if (require.main !== module) {
  // Loaded as a module (groups.js): nothing to run.
} else if (variantsFile) {
  // --variants file.json: [{ "name": "...", "over": { ...params } }, ...], each run as its own policy.
  const variants = JSON.parse(fs.readFileSync(variantsFile, "utf8")).map((v, i) => ({ key: "v" + i, name: v.name, over: v.over }));
  const { results, ms } = runAll(variants, SEED);
  console.log("Variants (" + ms + " ms)");
  printTable(results);
} else if (sweep) {
  // --sweep a.b=1,2,3 runs the full policy with each value.
  const [keyPath, values] = sweep.split("=");
  const policies = values.split(",").map((v) => {
    const over = JSON.parse(JSON.stringify(POLICIES[POLICIES.length - 1].over));
    const parts = keyPath.split(".");
    let o = over;
    for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
    o[parts[parts.length - 1]] = isNaN(+v) ? v : +v;
    return { key: keyPath + "=" + v, name: "full, " + keyPath + "=" + v, over };
  });
  const { results, ms } = runAll(policies, SEED);
  console.log("Sweep of " + keyPath + " (" + ms + " ms)");
  printTable(results);
} else {
  const { results, ms, world } = runAll(POLICIES, SEED);
  const slopItems = world.items.filter((i) => i.slop).length;
  console.log("Bubbles recommender simulation, recs " + R.version);
  console.log((SEEDS > 1 ? SEEDS + " worlds, each: " : "") + world.users.length + " people (" + USERS_PER_TYPE + " of each kind), " + DAYS + " days, " + world.items.length + " Bubbles (" + slopItems + " slop, " + NEW_PER_DAY + " new a day), " + ms + " ms");
  printTable(results);
  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({ version: R.version, seed: SEED, users: USERS_PER_TYPE, days: DAYS, results }, null, 2));
    console.log("\nwrote " + jsonOut);
  }
}
