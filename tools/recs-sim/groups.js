#!/usr/bin/env node
// Group Blend simulator: which way of combining members' predictions serves a whole Group best.
//
//   node tools/recs-sim/groups.js                  3 worlds, 80 Groups each
//   node tools/recs-sim/groups.js --seeds 5 --groups 120
//   node tools/recs-sim/groups.js --min 2 --max 2 --count 5     pairs (Challenge Me)
//
// Same synthetic world as sim.js. First everyone plays alone for `--days` days with the full
// recommender, so each person has a learned profile. Then random Groups of 4-6 mixed people get a
// 10-game Blend from each strategy, scored with everyone's TRUE enjoyment (what the simulator's
// people would actually feel, which the recommender never sees):
//   joy          average enjoyment over members and games
//   worst-off    the least-served member's average (does anyone get left out?)
//   spread       best-served minus least-served member
//   all enjoy    share of games every member would enjoy (enjoyment >= 0.5)
//   matched      share of games where members' skills on that formula are within 0.15
// Skills are synthetic: each person gets an overall skill and a per-formula wobble.
"use strict";
const path = require("path");
const fs = require("fs");
const sim = require("./sim.js");
const R = require(path.join(__dirname, "../../FacebookClone/Bubbles/Recommend/game-recs.js"));
const { rng, hashString } = R._math;

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const SEEDS = +opt("--seeds", 3);
const GROUPS = +opt("--groups", 80);
const COUNT = +opt("--count", 10);
const MIN_SIZE = +opt("--min", 4);
const MAX_SIZE = +opt("--max", 6);
const jsonOut = opt("--json", null);
const FORMULAS = R._dims.FORMULAS;

const NO_FAIR = { skillBonus: 0, fairBoost: 0 };
const STRATEGIES = [
  { key: "random", name: "Random games (no Blend)" },
  { key: "centroid", name: "Average the profiles (centroid)", over: { blend: Object.assign({ aggregate: "centroid" }, NO_FAIR) } },
  { key: "mean", name: "Average enjoyment", over: { blend: Object.assign({ aggregate: "mean" }, NO_FAIR) } },
  { key: "min", name: "Least misery", over: { blend: Object.assign({ aggregate: "min" }, NO_FAIR) } },
  { key: "geo", name: "Geometric mean", over: { blend: Object.assign({ aggregate: "geometric" }, NO_FAIR) } },
  { key: "geofair", name: "Geometric + fairness plus (default)", over: {} }
];

function gauss(r) { let u = r(); while (u <= 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }

function skillsFor(world, seed) {
  const r = rng(hashString("skills|" + seed));
  const out = {};
  world.users.forEach((u) => {
    const overall = 0.2 + 0.7 * r();
    const byFormula = {};
    FORMULAS.forEach((f) => { byFormula[f] = Math.min(0.98, Math.max(0.02, overall + 0.1 * gauss(r))); });
    out[u.id] = { overall, byFormula };
  });
  return out;
}

function makeGroups(world, seed) {
  const r = rng(hashString("groups|" + seed));
  const groups = [];
  for (let g = 0; g < GROUPS; g++) {
    const size = MIN_SIZE + Math.floor(r() * (MAX_SIZE - MIN_SIZE + 1));
    const pool = world.users.slice();
    const members = [];
    while (members.length < size) members.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    groups.push(members);
  }
  return groups;
}

function score(members, picks, itemsById, skills) {
  const per = members.map(() => 0);
  let allEnjoy = 0, matched = 0;
  picks.forEach((id) => {
    const item = itemsById[id];
    let all = true, lo = 1, hi = 0;
    members.forEach((u, j) => {
      const e = sim.trueEnjoy(u, item);
      per[j] += e;
      if (e < 0.5) all = false;
      const s = skills[u.id].byFormula[item.summary.formula];
      lo = Math.min(lo, s); hi = Math.max(hi, s);
    });
    if (all) allEnjoy++;
    if (hi - lo <= 0.15) matched++;
  });
  const avgs = per.map((x) => x / Math.max(1, picks.length));
  return {
    joy: avgs.reduce((a, b) => a + b, 0) / avgs.length,
    worst: Math.min(...avgs),
    spread: Math.max(...avgs) - Math.min(...avgs),
    allEnjoy: allEnjoy / Math.max(1, picks.length),
    matched: matched / Math.max(1, picks.length)
  };
}

const totals = {};
STRATEGIES.forEach((s) => { totals[s.key] = { joy: [], worst: [], spread: [], allEnjoy: [], matched: [] }; });
const t0 = Date.now();
for (let k = 0; k < SEEDS; k++) {
  const seed = 1 + 1000 * k;
  const world = sim.buildWorld(seed);
  // Everyone plays alone first, so profiles are learned, not given.
  const learned = sim.runPolicy(world, sim.POLICIES[sim.POLICIES.length - 1]);
  const S = learned._state;
  const day = Math.max(...world.items.map((i) => i.day));
  const live = world.items.filter((i) => i.day <= day);
  const itemsById = {};
  live.forEach((i) => { itemsById[i.id] = i; });
  const summaries = live.map((i) => i.summary);
  const skills = skillsFor(world, seed);
  const groups = makeGroups(world, seed);
  const r = rng(hashString("random|" + seed));

  STRATEGIES.forEach((strategy) => {
    const P = R.params(strategy.over || {});
    groups.forEach((members, g) => {
      let picks;
      if (strategy.key === "random") {
        const pool = live.map((i) => i.id);
        picks = [];
        while (picks.length < COUNT && pool.length) picks.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
      } else {
        const input = {
          group: { id: "g" + g, name: "Group " + g },
          members: members.map((u) => ({ id: u.id, profile: R.profileOf(R.userIn(S, u.id), P, S, { id: u.id, name: u.id, skill: skills[u.id] }) })),
          summaries, feed: [], count: COUNT, day
        };
        picks = R.groupBlend(S, null, input, P).picks.map((p) => p.gameID);
      }
      const m = score(members, picks, itemsById, skills);
      Object.keys(m).forEach((key) => totals[strategy.key][key].push(m[key]));
    });
  });
}

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
console.log("Group Blend simulation, recs " + R.version + ": " + SEEDS + " worlds x " + GROUPS + " Groups of " + (MIN_SIZE === MAX_SIZE ? MIN_SIZE : MIN_SIZE + "-" + MAX_SIZE) + ", " + COUNT + " games each, " + (Date.now() - t0) + " ms");
const cols = [["joy", "joy"], ["worst", "worst-off"], ["spread", "spread"], ["allEnjoy", "all enjoy"], ["matched", "matched"]];
console.log(sim.pad("strategy", 40) + cols.map((c) => sim.lpad(c[1], 13)).join(""));
const results = [];
STRATEGIES.forEach((s) => {
  const t = totals[s.key];
  const row = {};
  cols.forEach((c) => { row[c[0]] = { mean: mean(t[c[0]]), se: sim.se(t[c[0]]) }; });
  results.push({ key: s.key, name: s.name, metrics: row });
  const fmt = (c) => (c[0] === "allEnjoy" || c[0] === "matched")
    ? (100 * row[c[0]].mean).toFixed(1) + "%"
    : row[c[0]].mean.toFixed(3) + "±" + row[c[0]].se.toFixed(3);
  console.log(sim.pad(s.name, 40) + cols.map((c) => sim.lpad(fmt(c), 13)).join(""));
});
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ version: R.version, seeds: SEEDS, groups: GROUPS, results }, null, 2));
  console.log("wrote " + jsonOut);
}
