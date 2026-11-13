#!/usr/bin/env node
// Team-draft interleaving on synthetic people: how the on-device test would score the formula
// against today's feed, and against itself with one part switched off.
//
//   node tools/recs-sim/interleave-sim.js                 every control, one world
//   node tools/recs-sim/interleave-sim.js --seeds 3       three worlds
//   node tools/recs-sim/interleave-sim.js --only baseline
//   node tools/recs-sim/interleave-sim.js --muse       the Muse term with a stand-in Ember, against noMuse
//
// --muse can't call the real Ember here, so it stands in four kinds of Ember: one that knows each
// person's true payoff (oracle), one that knows it roughly (noisy), one that orders at random, and
// one that orders worst-first (adversarial). It shows how much a good Ember could add and how much
// the cap limits the damage a bad one can do.
//
// The people, games and behavior are sim.js's (same flags: --users, --days, --items, --new). Each
// session is one interleaved feed; the formula learns from every page, as it would on the phone.
// The tally is the one the app keeps (app.interleaveStats): wins, losses, ties, the formula's
// share of decided sessions with a 95% interval, and a sign-test p-value. The second half of the
// run (after the formula has learned) is reported on its own.
"use strict";
const path = require("path");
const R = require(path.join(__dirname, "../../FacebookClone/Bubbles/Recommend/game-recs.js"));
const { buildWorld, behave, candidatesFor, trueEnjoy, tasteOf, TYPES } = require("./sim.js");

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const DAYS = +opt("--days", 14);
const SEEDS = +opt("--seeds", 1);
const FIRST_SEED = +opt("--seed", 1);
const ONLY = opt("--only", null);
const MAX_PAGES = 40;
const { rng, hashString, signTest, wilson, sigmoid } = R._math;
const MUSE = argv.includes("--muse");
const MOCKS = ["oracle", "noisy", "random", "adversarial"];

function payoff(u, item) {
  return sigmoid(-0.9 + u.T.grabHook * (2 * item.H - 1) + 0.8 * tasteOf(u, item)) * trueEnjoy(u, item);
}
function gauss(r) { let a = r(); while (a <= 0) a = r(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * r()); }
// A stand-in Ember reply for this person and these games.
function mockReply(mode, u, ids, byId, r) {
  let order = ids.slice();
  if (mode === "random") {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  } else {
    const noise = mode === "noisy" ? 0.15 : 0.02;
    const key = {};
    order.forEach((id) => { key[id] = payoff(u, byId[id]) + noise * gauss(r); });
    order.sort((a, b) => key[b] - key[a]);
    if (mode === "adversarial") order.reverse();
  }
  return JSON.stringify({ order, why: {} });
}

const CONTROLS = [
  { key: "baseline", name: "vs today's feed (weighted random)" },
  { key: "noCalibration", name: "vs the formula without calibration" },
  { key: "noBait", name: "vs the formula without the bait lean" },
  { key: "noColdStart", name: "vs the formula without cold start" },
  { key: "noBandit", name: "vs the formula without Thompson sampling" }
].filter((c) => !ONLY || c.key === ONLY);

function newTally() { return { sessions: 0, aWins: 0, bWins: 0, ties: 0, aPts: 0, bPts: 0, aShown: 0, bShown: 0 }; }

function add(t, ses) {
  t.sessions++;
  if (ses.A.points > ses.B.points) t.aWins++;
  else if (ses.B.points > ses.A.points) t.bWins++;
  else t.ties++;
  t.aPts += ses.A.points; t.bPts += ses.B.points; t.aShown += ses.A.shown; t.bShown += ses.B.shown;
}

function runControl(world, against, seed, mock) {
  const P = R.params(mock ? { interleave: { on: true, against }, muse: { on: true } } : { interleave: { on: true, against } });
  const mr = rng(hashString("mock|" + mock + "|" + seed));
  const S = R.newState();
  const byId = {};
  world.items.forEach((it) => { byId[it.id] = it; });
  const r = rng(hashString("behave|interleave|" + seed));
  const all = newTally(), late = newTally(), byType = {};
  Object.keys(TYPES).forEach((t) => { byType[t] = newTally(); });

  for (let day = 0; day < DAYS; day++) {
    const live = world.items.filter((it) => it.day <= day);
    const summaries = live.map((it) => it.summary);
    const order = world.users.slice();
    const vr = rng(hashString("order|" + day + "|" + seed));
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(vr() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const isLate = day >= Math.floor(DAYS / 2);

    for (const u of order) {
      const user = R.userIn(S, u.id);
      const cands = candidatesFor(u, live, day);
      const feed = [], keys = [];
      let mood = 0.5, pages = 0, exited = false;
      const now = (day * 24 + 9) * 3600000;
      if (mock) {
        // One Ember order per session, from the formula's top 10 at the start of it.
        const req = R.museRequest(S, user, { candidates: cands, summaries, feed: [], count: 12, seed: hashString("m|" + u.id + "|" + day), day }, P);
        R.museApply(S, user, mockReply(mock, u, req.ids, byId, mr), P, now);
      }
      while (pages < MAX_PAGES && !exited) {
        if (pages >= feed.length) {
          const input = { candidates: cands, summaries, feed: feed.slice(), feedKeys: keys.slice(), count: 12, seed: hashString(u.id + "|" + day + "|" + pages), day, now };
          const out = R.interleave(S, user, input, P);
          out.picks.forEach((p) => { feed.push(p.gameID); keys.push(p.gameID + "|" + p.reason + "|" + (p.runUserID || "-")); });
          if (!out.picks.length) break;
        }
        const item = byId[feed[pages]];
        const b = behave(r, u, item, keys[pages].split("|")[1]);
        mood = 0.7 * mood + 0.3 * b.util;
        let hazard = 0.03 + 0.22 * (1 - mood) * (1 - mood);
        if (b.enjoy !== null && b.enjoy < 0.25) hazard += u.type === "averse" ? 0.12 : 0.06;
        exited = r() < hazard;
        b.imp.endedSession = exited || pages === MAX_PAGES - 1;
        b.imp.day = day;
        R.observe(S, user, b.imp, P);
        pages++;
      }
      const ses = user.inter && user.inter.session;
      if (ses && (ses.A.shown || ses.B.shown)) {
        add(all, ses); add(byType[u.type], ses);
        if (isLate) add(late, ses);
      }
      R.endSession(user, S);
    }
  }
  // The engine's own tally must match ours.
  const own = R.interleaveStats(S)[against];
  if (!own || own.sessions !== all.sessions || own.formulaWins !== all.aWins || own.controlWins !== all.bWins) {
    throw new Error("app tally and simulator tally disagree for " + against);
  }
  return { all, late, byType };
}

function merge(into, t) { for (const k in t) into[k] = (into[k] || 0) + t[k]; return into; }

function line(label, t) {
  const decided = t.aWins + t.bWins;
  const share = decided ? t.aWins / decided : NaN;
  const ci = wilson(t.aWins, decided);
  const p = signTest(t.aWins, decided);
  const pts = (n, d) => (d ? (n / d).toFixed(3) : "-");
  return "  " + label.padEnd(10) + String(t.sessions).padStart(6) + String(t.aWins).padStart(7) + String(t.bWins).padStart(7) + String(t.ties).padStart(7) +
    ((isNaN(share) ? "-" : (100 * share).toFixed(1) + "%").padStart(9)) + ("  [" + (100 * ci[0]).toFixed(0) + "–" + (100 * ci[1]).toFixed(0) + "%]").padEnd(12) +
    (p < 0.001 ? "<0.001" : p.toFixed(3)).padStart(8) + pts(t.aPts, t.aShown).padStart(10) + pts(t.bPts, t.bShown).padStart(10);
}

const t0 = Date.now();
console.log("Interleaving on synthetic people, recs " + R.version + " (" + SEEDS + " world" + (SEEDS > 1 ? "s" : "") + ", " + DAYS + " days)");
console.log("  A = the full formula; B = the control. A point = a page the judge scores satisfying (finish, replay, save, social moment).");
const RUNS = MUSE ? MOCKS.map((m) => ({ key: "noMuse", mock: m, name: "Muse term with a stand-in " + m + " Ember, vs the formula alone (noMuse)" })) : CONTROLS;
for (const c of RUNS) {
  const sum = { all: newTally(), late: newTally(), byType: {} };
  for (let s = 0; s < SEEDS; s++) {
    const seed = FIRST_SEED + s;
    const out = runControl(buildWorld(seed), c.key, seed, c.mock);
    merge(sum.all, out.all); merge(sum.late, out.late);
    for (const t in out.byType) sum.byType[t] = merge(sum.byType[t] || newTally(), out.byType[t]);
  }
  console.log("\n" + c.name);
  console.log("  " + "".padEnd(10) + "sess".padStart(6) + "A wins".padStart(7) + "B wins".padStart(7) + "ties".padStart(7) + "A share".padStart(9) + "  95%".padEnd(12) + "p".padStart(8) + "A pts/pg".padStart(10) + "B pts/pg".padStart(10));
  console.log(line("all days", sum.all));
  console.log(line("2nd half", sum.late));
  for (const t of Object.keys(sum.byType)) console.log(line(t, sum.byType[t]));
}
console.log("\n" + ((Date.now() - t0) / 1000).toFixed(1) + " s");
