#!/usr/bin/env node
// fb-sim.js: does the game language make a Facebook-style ranker stronger?
//
// The same ranker (value-model.js: retrieval, a multi-task ranker that learns online, one value
// score, an integrity filter) runs on the same synthetic world in five versions:
//
//   ids       today's engagement signals, game IDs only
//   social    + social targets in the value score (challenge, rematch, co-play, remix, Add friend)
//   features  + the game language as features (brief fields, fragments, length, bot gate)
//   both      features and social targets
//   gen       both, plus a game generated from the person's taste when nothing fits
//
// Synthetic world: the numbers show direction, not size. Every assumption is flagged in
// tools/recs-sim/README.md ("Facebook-style value model").
//
//   node tools/recs-sim/fb-sim.js                      # 3 seeds, all versions
//   node tools/recs-sim/fb-sim.js --seeds 5 --users 240
//   node tools/recs-sim/fb-sim.js --json               # machine-readable
//   sensitivity: --idNoise 1.0 (IDs know more), --fragTaste 0 (no mechanic-level taste),
//                --pool 40 --newPerDay 3 (a thin catalog)
"use strict";
const path = require("path");
const VM = require(path.join(__dirname, "value-model.js"));

// ------------------------------------------------------------------------------------------------
// Options

function parseArgs(argv) {
  const o = { seeds: 3, users: 200, days: 14, newPerDay: 12, startPool: 150, versions: Object.keys(VM.VERSIONS), json: false,
              idNoise: 0.5, fragTaste: 0.6 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seeds") o.seeds = +argv[++i];
    else if (a === "--users") o.users = +argv[++i];
    else if (a === "--days") o.days = +argv[++i];
    else if (a === "--versions") o.versions = argv[++i].split(",");
    else if (a === "--json") o.json = true;
    else if (a === "--idNoise") o.idNoise = +argv[++i];     // what a game's ID knows that its features don't
    else if (a === "--fragTaste") o.fragTaste = +argv[++i]; // 0 = taste only at the formula level
    else if (a === "--pool") o.startPool = +argv[++i];      // games on day 0
    else if (a === "--newPerDay") o.newPerDay = +argv[++i]; // new user-made games a day
  }
  return o;
}

// ------------------------------------------------------------------------------------------------
// Seeded randomness

function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(r) { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function pick(r, list) { return list[Math.floor(r() * list.length)]; }
const sig = VM.sigmoid;

// ------------------------------------------------------------------------------------------------
// The game language: brief fields plus Bayan's 33 authoring fragments (from his Slack posts)

const FORMULAS = ["dodge", "time", "merge", "guess", "group", "answer", "make"];
const MOODS = ["calm", "warm", "playful", "hype"];
const LOOKS = ["glow", "paper", "pixel", "neon", "ink", "clay", "riso", "chalk"];
const SCOPES = ["everyone", "group", "event"];
const LENGTHS = ["endless", "rounds", "timed", "lives"];
const FAMILY = {
  twitch: ["player_drag", "lanes", "gravity_jump", "collide", "pickups", "spawn_wave", "speed_ramp", "combo", "timer_bar", "waves"],
  words: ["keyboard", "word_check", "quiz", "hint", "reveal"],
  puzzle: ["grid_board", "match_pairs", "tile_slide", "sequence_memory", "sort_bins"],
  story: ["choice_story", "checkpoint", "difficulty_curve", "daily_seed"],
  base: ["lives", "score", "countdown", "rounds", "endless"],
  social: ["ghost_score", "beat_target", "turns", "shared_progress"]
};
const BY_FORMULA = {
  dodge: ["player_drag", "lanes", "gravity_jump", "collide", "pickups", "spawn_wave", "speed_ramp", "waves", "lives"],
  time: ["timer_bar", "combo", "countdown", "speed_ramp", "rounds", "endless"],
  merge: ["tile_slide", "grid_board", "combo", "endless", "score"],
  guess: ["keyboard", "word_check", "hint", "reveal", "rounds", "daily_seed"],
  group: ["sort_bins", "match_pairs", "sequence_memory", "grid_board", "countdown"],
  answer: ["quiz", "rounds", "reveal", "hint", "daily_seed", "countdown"],
  make: ["choice_story", "checkpoint", "reveal", "difficulty_curve", "score"]
};
const FAMILY_OF = {};
for (const fam in FAMILY) FAMILY[fam].forEach(f => { FAMILY_OF[f] = fam; });
const VOCAB = {
  formulas: FORMULAS, moods: MOODS, scopes: SCOPES, lengths: LENGTHS, social: FAMILY.social,
  fragmentsFor: f => BY_FORMULA[f].concat(FAMILY.social)
};
const ARCHETYPES = {
  wordsmith: { formula: { guess: 1.0, answer: 0.8 }, family: { words: 0.9, story: 0.2 } },
  arcade:    { formula: { dodge: 1.0, time: 0.8 },   family: { twitch: 0.9 } },
  puzzler:   { formula: { merge: 1.0, group: 0.8 },  family: { puzzle: 0.9 } },
  maker:     { formula: { make: 1.0, answer: 0.4 },  family: { story: 0.9, words: 0.2 } }
};

function hasAny(g, list) { return g.fragments.some(f => list.indexOf(f) >= 0); }

function makeGame(r, id, day, brief, slopRate, idNoise) {
  const formula = brief ? brief.formula : pick(r, FORMULAS);
  const m1 = brief ? brief.mood : pick(r, MOODS);
  let m2 = pick(r, MOODS);
  const mood = {};
  mood[m1] = 0.7;
  mood[m2] = (mood[m2] || 0) + 0.3;
  let fragments;
  if (brief) fragments = brief.fragments.slice();
  else {
    const own = BY_FORMULA[formula].slice();
    fragments = [];
    const n = 2 + Math.floor(r() * 3);
    while (fragments.length < n && own.length) fragments.push(own.splice(Math.floor(r() * own.length), 1)[0]);
    if (r() < 0.35) fragments.push(pick(r, FAMILY.social));
  }
  const slop = r() < slopRate;
  const q = normal(r) * 0.7 - (slop ? 1.6 : 0) - (brief ? 0.1 : 0);
  const g = {
    id, born: day, formula, mood, fragments,
    look: pick(r, LOOKS),
    energy: formula === "dodge" || formula === "time" ? 0.75 : formula === "make" ? 0.25 : 0.5,
    competition: brief ? 0.5 : pick(r, [0, 0.5, 1]),
    scope: brief ? brief.scope : (r() < 0.7 ? "everyone" : r() < 0.75 ? "group" : "event"),
    length: brief ? brief.length : pick(r, LENGTHS),
    hook: Math.min(1, Math.max(0, 0.45 + 0.2 * normal(r) + (slop ? 0.3 : 0))),
    q, slop,
    idTake: normal(r) * (idNoise === undefined ? 0.5 : idNoise), // what the game's ID knows that its features don't
    botQuality: q + normal(r) * 0.8,  // the bot gate reads quality, noisily
    generated: !!brief
  };
  g.socialChallenge = hasAny(g, ["beat_target", "ghost_score"]) ? 1 : 0;
  g.socialTogether = hasAny(g, ["turns", "shared_progress"]) ? 1 : 0;
  g.socialAny = hasAny(g, FAMILY.social) ? 1 : 0;
  return g;
}

function makePerson(r, i, fragTaste) {
  const type = pick(r, Object.keys(ARCHETYPES));
  const A = ARCHETYPES[type];
  const pf = {}, pm = {}, pl = {}, plen = {}, pfr = {};
  FORMULAS.forEach(f => { pf[f] = (A.formula[f] || 0) - 0.3 + normal(r) * 0.5; });
  MOODS.forEach(m => { pm[m] = normal(r) * 0.4; });
  LOOKS.forEach(l => { pl[l] = normal(r) * 0.15; });
  LENGTHS.forEach(l => { plen[l] = normal(r) * 0.4; });
  // Taste varies at the mechanic level: a family lean plus each person's own likes and dislikes.
  const sd = fragTaste === undefined ? 0.6 : fragTaste;
  for (const f in FAMILY_OF) pfr[f] = sd > 0 ? (A.family[FAMILY_OF[f]] || 0) - 0.2 + normal(r) * sd : 0;
  return {
    id: "u" + i, type, pf, pm, pl, plen, pfr,
    soc: normal(r),                     // how social they are
    creative: normal(r) * 0.8 - 0.5,    // how likely to remix
    hookW: 0.6 + normal(r) * 0.4,       // how much hooks work on them
    friends: new Set(), groups: []
  };
}

function appeal(u, g) {
  let a = u.pf[g.formula] + u.pl[g.look] + u.plen[g.length];
  for (const m in g.mood) a += g.mood[m] * u.pm[m];
  let fr = 0;
  g.fragments.forEach(f => { fr += u.pfr[f]; });
  a += fr / Math.sqrt(g.fragments.length || 1) * 0.8;
  if (g.scope !== "everyone") a += 0.3 * u.soc;
  return a;
}

// What actually happens when person u is shown game g. The rankers never see these formulas.
function outcome(r, w, u, g) {
  const a = appeal(u, g);
  const o = { take: false };
  o.take = r() < sig(-0.8 + a + u.hookW * (g.hook - 0.5) * 2 + g.idTake);
  if (!o.take) return o;
  o.finish = r() < sig(0.5 + 0.7 * a + 1.0 * g.q);
  o.save = r() < sig(-2.4 + 0.9 * a + 0.8 * g.q);
  o.share = r() < sig(-3.0 + 0.7 * a + 0.5 * g.q + 0.5 * u.soc + 0.4 * g.socialAny);
  const comp = (g.competition - 0.5) * 2;
  o.challenge = o.finish && u.friends.size > 0 && r() < sig(-3.2 + 1.5 * g.socialChallenge + 0.5 * comp + 0.7 * u.soc + 0.4 * a);
  o.rematch = o.challenge && r() < sig(-0.6 + 0.8 * g.socialChallenge + 0.5 * a);
  o.coplay = u.groups.length > 0 && r() < sig(-3.4 + 1.6 * g.socialTogether + 0.8 * (g.scope !== "everyone" ? 1 : 0) + 0.7 * u.soc + 0.3 * a);
  o.remix = r() < sig(-3.8 + 1.4 * (g.formula === "make" ? 1 : 0) + 0.9 * u.creative + 0.4 * a);
  const strangers = w.strangersOf(u);
  o.addFriend = strangers.length > 0 && r() < sig(-4.0 + 1.1 * (g.scope !== "everyone" ? 1 : 0) + 0.9 * g.socialAny + 0.6 * u.soc + 0.3 * a);
  if (o.addFriend) {
    const v = pick(r, strangers);
    u.friends.add(v.id);
    w.byId[v.id].friends.add(u.id);
  }
  return o;
}

// ------------------------------------------------------------------------------------------------
// One world, one version

function buildWorld(seed, opt) {
  const r = rng(seed * 7919 + 1);
  const people = [];
  for (let i = 0; i < opt.users; i++) people.push(makePerson(r, i, opt.fragTaste));
  const nGroups = Math.max(1, Math.round(opt.users / 10));
  const groups = [];
  for (let k = 0; k < nGroups; k++) groups.push([]);
  people.forEach((u, i) => {
    const a = i % nGroups;
    groups[a].push(u); u.groups.push(a);
    if (r() < 0.4) { const b = Math.floor(r() * nGroups); if (b !== a) { groups[b].push(u); u.groups.push(b); } }
  });
  // About 3 friends each, mostly from their own Groups; the rest of a Group are strangers.
  people.forEach(u => {
    const mates = [];
    u.groups.forEach(gi => groups[gi].forEach(v => { if (v !== u) mates.push(v); }));
    for (let k = 0; k < 2 && mates.length; k++) { const v = pick(r, mates); u.friends.add(v.id); v.friends.add(u.id); }
    if (r() < 0.5) { const v = pick(r, people); if (v !== u) { u.friends.add(v.id); v.friends.add(u.id); } }
  });
  const games = [];
  for (let i = 0; i < opt.startPool; i++) games.push(makeGame(r, "s" + i, -1 - Math.floor(r() * 20), null, 0.18, opt.idNoise));
  const stream = [];
  for (let d = 0; d < opt.days; d++) for (let i = 0; i < opt.newPerDay; i++) stream.push(makeGame(r, "d" + d + "-" + i, d, null, 0.18, opt.idNoise));
  return { seed, people, groups, games, stream };
}

function cloneWorld(base) {
  const people = base.people.map(u => Object.assign({}, u, { friends: new Set(u.friends), groups: u.groups.slice() }));
  const byId = {};
  people.forEach(u => { byId[u.id] = u; });
  const groups = base.groups.map(g => g.map(u => byId[u.id]));
  const strip = g => { const c = Object.assign({}, g); delete c._fx; delete c._cx; return c; };
  return {
    people, byId, groups,
    pool: base.games.map(strip),
    stream: base.stream.map(strip),
    strangersOf(u) {
      const out = [];
      u.groups.forEach(gi => groups[gi].forEach(v => { if (v !== u && !u.friends.has(v.id)) out.push(v); }));
      return out;
    }
  };
}

function newTally() {
  return { sessions: 0, pages: 0, take: 0, finish: 0, save: 0, share: 0, challenge: 0, rematch: 0, coplay: 0, remix: 0, addFriend: 0,
           newShown: 0, newTake: 0, newFinish: 0, slopShown: 0, generated: 0, genShown: 0, genTake: 0, value: 0,
           genOwnShown: 0, genOwnTake: 0, genOtherShown: 0, genOtherTake: 0 };
}

function runVersion(base, name, opt) {
  const w = cloneWorld(base);
  const model = VM.newModel(name);
  const r = rng(base.seed * 104729 + 17);           // same seed for every version
  const rg = rng(base.seed * 15485863 + 3);         // generation's own stream
  const tally = newTally();
  let streamAt = 0, genCount = 0;
  const pagesSeen = {}, lastGenDay = {};
  for (let day = 0; day < opt.days; day++) {
    while (streamAt < w.stream.length && w.stream[streamAt].born === day) w.pool.push(w.stream[streamAt++]);
    const order = w.people.slice().sort(() => r() - 0.5);
    let genToday = 0;
    for (const u of order) {
      if (r() > 0.8) continue;
      const counted = day >= opt.days / 2;
      const cands = VM.retrieve(model, u, w.pool, day, r);
      const scored = cands.map(g => { const p = VM.predict(model, u, g, day); return { g, p, v: VM.valueOf(model, p) }; });
      const shown = new Set();
      const queue = [];
      let madeFor = null;
      const seen = pagesSeen[u.id] || 0, lastGen = lastGenDay[u.id];
      if (model.version.generate && genToday < model.opt.genPerDay && seen >= model.opt.genMinPages &&
          (lastGen === undefined || day - lastGen >= model.opt.genEveryDays)) {
        const gap = VM.tasteGap(model, u, cands, VOCAB);
        if (gap.gap > model.opt.genGap) {
          const g = makeGame(rg, "gen" + (genCount++), day, gap.brief, 0.15, opt.idNoise);
          lastGenDay[u.id] = day;
          w.pool.push(g);
          genToday++;
          if (counted) tally.generated++;
          const p = VM.predict(model, u, g, day);
          queue.push({ g, p, v: VM.valueOf(model, p) });
          madeFor = g.id;
        }
      }
      if (counted) tally.sessions++;
      for (let page = 0; page < 20; page++) {
        let item = queue.shift();
        if (!item) {
          const open = scored.filter(s => !shown.has(s.g.id));
          if (!open.length) break;
          if (r() < model.opt.explore) item = open[Math.floor(r() * open.length)];
          else item = open.reduce((b, s) => (s.v > b.v ? s : b), open[0]);
        }
        const g = item.g;
        shown.add(g.id);
        const o = outcome(r, w, u, g);
        VM.learn(model, u, g, day, o, item.p);
        pagesSeen[u.id] = (pagesSeen[u.id] || 0) + 1;
        if (counted) {
          tally.pages++;
          ["take", "finish", "save", "share", "challenge", "rematch", "coplay", "remix", "addFriend"].forEach(k => { if (o[k]) tally[k]++; });
          let v = o.take ? 1 : 0;
          for (const k in VM.WEIGHTS) if (o[k]) v += VM.WEIGHTS[k];
          tally.value += v;
          if (day - g.born < 2) { tally.newShown++; if (o.take) tally.newTake++; if (o.finish) tally.newFinish++; }
          if (g.slop) tally.slopShown++;
          if (g.generated) { tally.genShown++; if (o.take) tally.genTake++; }
          if (madeFor) {
            if (g.id === madeFor) { tally.genOwnShown++; if (o.take) tally.genOwnTake++; }
            else { tally.genOtherShown++; if (o.take) tally.genOtherTake++; }
          }
        }
        // Keep scrolling? More likely after a game that paid off.
        const go = 0.62 + (o.finish ? 0.25 : 0) + (o.take ? 0.05 : 0);
        if (r() > go) break;
      }
    }
  }
  const userWeeks = (opt.users * (opt.days / 2)) / 7;
  const t = tally;
  return {
    version: name,
    label: VM.VERSIONS[name].label,
    pagesPerSession: t.pages / t.sessions,
    takePer100: 100 * t.take / t.pages,
    finishPer100: 100 * t.finish / t.pages,
    appreciatePer100: 100 * (t.save + t.share) / t.pages,
    valuePerPage: t.value / t.pages,
    challenges: (t.challenge + t.rematch) / userWeeks,
    coplays: t.coplay / userWeeks,
    remixes: t.remix / userWeeks,
    friendAdds: t.addFriend / userWeeks,
    social: (t.challenge + t.rematch + t.coplay + t.remix + t.addFriend) / userWeeks,
    newShare: t.newShown / t.pages,
    newTakeRate: t.newShown ? t.newTake / t.newShown : 0,
    newFinishRate: t.newShown ? t.newFinish / t.newShown : 0,
    slopShare: t.slopShown / t.pages,
    generatedPerUserWeek: t.generated / userWeeks,
    genTakeRate: t.genShown ? t.genTake / t.genShown : null,
    genOwnTakeRate: t.genOwnShown ? t.genOwnTake / t.genOwnShown : null,
    genOtherTakeRate: t.genOtherShown ? t.genOtherTake / t.genOtherShown : null
  };
}

// ------------------------------------------------------------------------------------------------
// Report

const METRICS = [
  ["pagesPerSession", "pages / session", 1],
  ["takePer100", "takeovers / 100 pages", 1],
  ["finishPer100", "finished runs / 100 pages", 1],
  ["appreciatePer100", "saves + shares / 100 pages", 1],
  ["valuePerPage", "value / page (true events, value weights)", 3],
  ["challenges", "challenges + rematches / person-week", 2],
  ["coplays", "co-plays / person-week", 2],
  ["remixes", "remixes / person-week", 2],
  ["friendAdds", "friend adds / person-week", 3],
  ["social", "all social moments / person-week", 2],
  ["newShare", "share of pages on games < 2 days old", "%"],
  ["newTakeRate", "takeover rate on games < 2 days old", "%"],
  ["slopShare", "share of pages on slop", "%"],
  ["generatedPerUserWeek", "games generated / person-week", 2],
  ["genTakeRate", "takeover rate on generated games (anyone)", "%"],
  ["genOwnTakeRate", "  ... for the person it was made for", "%"],
  ["genOtherTakeRate", "  ... other pages in those sessions", "%"]
];

function main() {
  const opt = parseArgs(process.argv.slice(2));
  const all = {};
  opt.versions.forEach(v => { all[v] = []; });
  for (let s = 1; s <= opt.seeds; s++) {
    const base = buildWorld(s, opt);
    opt.versions.forEach(v => all[v].push(runVersion(base, v, opt)));
  }
  const summary = {};
  opt.versions.forEach(v => {
    summary[v] = { label: VM.VERSIONS[v].label };
    METRICS.forEach(([k]) => {
      const xs = all[v].map(x => x[k]).filter(x => x !== null && x !== undefined);
      const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, xs.length - 1));
      summary[v][k] = { mean, se: sd / Math.sqrt(xs.length || 1), n: xs.length };
    });
  });
  if (opt.json) { console.log(JSON.stringify({ options: opt, summary }, null, 2)); return; }
  console.log(`Facebook-style value model: ${opt.seeds} worlds x ${opt.users} people x ${opt.days} days, second half measured (pool ${opt.startPool} + ${opt.newPerDay}/day, idNoise ${opt.idNoise}, fragTaste ${opt.fragTaste}). Synthetic: direction, not size.\n`);
  const head = ["metric"].concat(opt.versions);
  const rows = METRICS.map(([k, label, dp]) => [label].concat(opt.versions.map(v => {
    const m = summary[v][k];
    if (!m.n) return "-";
    return dp === "%" ? (100 * m.mean).toFixed(1) + "% ±" + (100 * m.se).toFixed(1) : m.mean.toFixed(dp) + " ±" + m.se.toFixed(dp);
  })));
  const width = head.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
  const line = r => r.map((c, i) => (i === 0 ? String(c).padEnd(width[i]) : String(c).padStart(width[i]))).join("  ");
  console.log(line(head));
  rows.forEach(r => console.log(line(r)));
  console.log("\nVersions: " + opt.versions.map(v => `${v} = ${VM.VERSIONS[v].label}`).join("; "));
}

if (require.main === module) main();
module.exports = { buildWorld, runVersion, parseArgs, makeGame, makePerson, appeal, outcome, VOCAB };
