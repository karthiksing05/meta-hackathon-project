#!/usr/bin/env node
// Hooky means the game's true hook in the simulator (H >= 0.6), not the formula's own estimate.
//
// Property tests: the formula's promises, checked over every page of every session in synthetic
// worlds (RecList-style behavioral tests). Each property prints how often it held. `--break` runs
// the same tests with a guard switched off, to show the test would catch it.
//
//   node tools/recs-sim/props.js                 the formula as it ships, 2 worlds
//   node tools/recs-sim/props.js --break         also with the bait guard off and the repeat window off
"use strict";
const path = require("path");
const R = require(path.join(__dirname, "../../FacebookClone/Bubbles/Recommend/game-recs.js"));
const { buildWorld, behave, candidatesFor, TYPES } = require("./sim.js");

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const DAYS = +opt("--days", 14);
const SEEDS = +opt("--seeds", 2);
const MAX_PAGES = 40, COUNT = 12;
const HOOKY_MAX = 5;      // a bait-averse person sees at most 5 hooky games in any 10 pages
const NEW_WITHIN = 60;    // a new game reaches someone's feed within 60 pages shown after it launches
const { rng, hashString } = R._math;

function runWorld(world, over, seed) {
  const P = R.params(over);
  const S = R.newState();
  const byId = {};
  world.items.forEach((it) => { byId[it.id] = it; });
  const r = rng(hashString("behave|props|" + seed));
  const c = {
    repeatPages: 0, repeatBad: 0,
    slopRankings: 0, slopBad: 0,
    capWindows: 0, capBad: 0,
    averseWindows: 0, averseBad: 0,
    newGames: 0, newLate: 0, newWaits: [],
    rankings: 0
  };
  const launched = {}, firstShown = {};
  let pagesShown = 0;

  for (let day = 0; day < DAYS; day++) {
    const live = world.items.filter((it) => it.day <= day);
    live.forEach((it) => { if (it.day === day && it.day > 0 && launched[it.id] === undefined) launched[it.id] = pagesShown; });
    const summaries = live.map((it) => it.summary);
    const order = world.users.slice();
    const vr = rng(hashString("order|" + day + "|" + seed));
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(vr() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const u of order) {
      const user = R.userIn(S, u.id);
      const cands = candidatesFor(u, live, day);
      const feed = [], keys = [], hooky = [], unproven = [];
      let mood = 0.5, pages = 0, exited = false;
      while (pages < MAX_PAGES && !exited) {
        if (pages >= feed.length) {
          const input = { candidates: cands, summaries, feed: feed.slice(), feedKeys: keys.slice(), count: COUNT, seed: hashString(u.id + "|" + day + "|" + pages), day };
          const out = R.rank(S, user, input, P);
          c.rankings++;
          // Slop guard: a game the posteriors are 90% sure is slop never makes the top 3 of a
          // ranking while at least 3 games look fine (P(slop) < 0.5).
          const views = {};
          cands.forEach((x) => { if (!views[x.gameID]) views[x.gameID] = R.itemView(S, x.gameID, P, day); });
          const fine = Object.keys(views).filter((g) => views[g] && views[g].pSlop < 0.5).length;
          if (fine >= 3) {
            c.slopRankings++;
            if (out.picks.slice(0, 3).some((p) => p.pSlop > 0.9)) c.slopBad++;
          }
          out.picks.forEach((p) => { feed.push(p.gameID); keys.push(p.gameID + "|" + p.reason + "|" + (p.runUserID || "-")); hooky.push(byId[p.gameID].H >= 0.6); unproven.push(!!p.unproven); });
          if (!out.picks.length) break;
        }
        const item = byId[feed[pages]];
        // Repeat window: no game twice within 4 pages, when the catalog has more than 4 games.
        c.repeatPages++;
        if (feed.slice(Math.max(0, pages - 4), pages).includes(item.id)) c.repeatBad++;
        if (firstShown[item.id] === undefined) firstShown[item.id] = pagesShown;
        const b = behave(r, u, item, keys[pages].split("|")[1]);
        mood = 0.7 * mood + 0.3 * b.util;
        let hazard = 0.03 + 0.22 * (1 - mood) * (1 - mood);
        if (b.enjoy !== null && b.enjoy < 0.25) hazard += u.type === "averse" ? 0.12 : 0.06;
        exited = r() < hazard;
        b.imp.endedSession = exited || pages === MAX_PAGES - 1;
        b.imp.day = day;
        R.observe(S, user, b.imp, P);
        pages++; pagesShown++;
        if (pages >= 10) {
          const w = pages - 10;
          // Untested cap: at most the cap's share of any 10 pages are untested games, plus one page.
          const lean = R.baitLean(user, P, S);
          const cap = P.stages.bait ? P.bait.unprovenBase + P.bait.unprovenSpan * lean.tolerance : 1;
          c.capWindows++;
          if (unproven.slice(w, pages).filter(Boolean).length > Math.ceil(cap * 10) + 1) c.capBad++;
          if (u.type === "averse") {
            c.averseWindows++;
            if (hooky.slice(w, pages).filter(Boolean).length > HOOKY_MAX) c.averseBad++;
          }
        }
      }
      R.endSession(user, S);
    }
  }
  for (const id in launched) {
    c.newGames++;
    const wait = firstShown[id] === undefined ? Infinity : firstShown[id] - launched[id];
    c.newWaits.push(wait);
    if (wait > NEW_WITHIN) c.newLate++;
  }
  return c;
}

function sum(a, b) { for (const k in b) a[k] = Array.isArray(b[k]) ? (a[k] || []).concat(b[k]) : (a[k] || 0) + b[k]; return a; }
const pct = (bad, n) => (n ? (100 * (1 - bad / n)).toFixed(2) + "%" : "-");

function report(name, over) {
  const tot = {};
  for (let s = 0; s < SEEDS; s++) sum(tot, runWorld(buildWorld(1 + s), over, 1 + s));
  const waits = tot.newWaits.filter(isFinite).sort((a, b) => a - b);
  console.log("\n" + name);
  console.log("  holds    property");
  console.log("  " + pct(tot.repeatBad, tot.repeatPages).padStart(8) + "  no game twice within 4 pages (" + tot.repeatPages + " pages)");
  console.log("  " + pct(tot.slopBad, tot.slopRankings).padStart(8) + "  a game 90% likely to be slop never makes a top 3 while 3 games look fine (" + tot.slopRankings + " rankings)");
  console.log("  " + pct(tot.capBad, tot.capWindows).padStart(8) + "  untested games stay within their cap in any 10 pages (" + tot.capWindows + " windows)");
  console.log("  " + pct(tot.averseBad, tot.averseWindows).padStart(8) + "  a bait-averse person sees at most " + HOOKY_MAX + " hooky games in any 10 pages (" + tot.averseWindows + " windows)");
  const q = (f) => (waits.length ? waits[Math.min(waits.length - 1, Math.floor(f * waits.length))] : "-");
  const never = tot.newWaits.length - waits.length;
  console.log("  " + pct(tot.newLate, tot.newGames).padStart(8) + "  a new game reaches a feed within " + NEW_WITHIN + " pages shown (all people) after launch (" + tot.newGames + " games; wait median " + q(0.5) + ", p90 " + q(0.9) + ", max " + q(1) + " pages; never shown " + never + ")");
}

const t0 = Date.now();
console.log("Property tests, recs " + R.version + " (" + SEEDS + " worlds, " + DAYS + " days, every page of every session)");
report("The formula as it ships", {});
if (argv.includes("--break")) {
  report("Break it: bait guard off (stages.bait = false)", { stages: { bait: false } });
  report("Break it: repeat window off (feed.repeatWindow = 0)", { feed: { repeatWindow: 0 } });
}
console.log("\n" + ((Date.now() - t0) / 1000).toFixed(1) + " s");
