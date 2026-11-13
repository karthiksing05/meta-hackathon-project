// value-model.js: a Facebook-shaped ranker for Bubbles, used by fb-sim.js.
//
// The public descriptions of Facebook's feed ranking share one shape: retrieve a few hundred
// candidates, predict per-item events with a multi-task model (P(like), P(comment), P(share),
// P(dwell), meaningful social interactions), combine the predictions into one value score with
// hand-set weights, filter integrity problems, then rank by value. This file is that shape, small
// enough to run in a simulator:
//
//   retrieve(user)  popularity + newest + random, and (with game features) feature matches
//   heads           one online logistic regression per event, AdaGrad, hashed sparse features
//   value(user, g)  P(takeover) * (1 + w_finish * P(finish) * (1 + sum_{challenge, rematch} w_k * P(k | finish))
//                                   + sum_{other k} w_k * P(k | takeover))
//   integrity       drop games whose finish rate after takeovers is below 0.3 (crowd-detected slop)
//
// What changes between versions is only what the heads may see and which heads count:
//
//   ids       today's engagement signals with game IDs only: bias, user, game ID, user context
//   +social   the same features, plus the social heads in the value score
//   +features the game language: brief fields (formula, mood, look, energy, competition, scope),
//             authoring fragments, length mode and the bot-gate result, plus user x feature crosses
//             (personal taste per mechanic) that carry over to brand-new games
//   +both     game features and social heads
//   +gen      +both, plus a game generated from the person's learned taste when nothing fits
//
// No dependencies. Deterministic given its inputs.
"use strict";

const ENGAGEMENT = ["take", "finish", "save", "share"];
const SOCIAL = ["challenge", "rematch", "coplay", "remix", "addFriend"];

// Value weights. Engagement mirrors game-recs.js reward weights (save and share 3, finish 1);
// social mirrors its v0.4 social weights (challenge and rematch 3, co-play and remix 2, Add friend 4).
const WEIGHTS = { finish: 1, save: 3, share: 3, challenge: 3, rematch: 3, coplay: 2, remix: 2, addFriend: 4 };

const VERSIONS = {
  ids:        { features: false, social: false, generate: false, label: "Game IDs, engagement only (today)" },
  social:     { features: false, social: true,  generate: false, label: "Game IDs + social targets" },
  features:   { features: true,  social: false, generate: false, label: "Game features, engagement only" },
  both:       { features: true,  social: true,  generate: false, label: "Game features + social targets" },
  gen:        { features: true,  social: true,  generate: true,  label: "+ generate when nothing fits" }
};

function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

// One head: online logistic regression over sparse features. Global weights `w` are keyed by
// feature strings; per-user crosses `cross[user][featureKey]` are personal taste per feature.
function newHead() {
  return { w: Object.create(null), g2: Object.create(null), cross: Object.create(null), cg2: Object.create(null), n: 0, pos: 0 };
}

// x = [[key, value], ...] global features; c = [[key, value], ...] features crossed with the user.
function headLogit(h, x, user, c) {
  let z = 0;
  for (let i = 0; i < x.length; i++) z += (h.w[x[i][0]] || 0) * x[i][1];
  if (c && c.length) {
    const wu = h.cross[user];
    if (wu) for (let i = 0; i < c.length; i++) z += (wu[c[i][0]] || 0) * c[i][1];
  }
  return z;
}

function headUpdate(h, x, user, c, y, opt) {
  const p = sigmoid(headLogit(h, x, user, c));
  const g = y - p;
  const eta = opt.eta, l2 = opt.l2;
  for (let i = 0; i < x.length; i++) {
    const k = x[i][0], v = x[i][1], gi = g * v;
    const G = (h.g2[k] || 0) + gi * gi;
    h.g2[k] = G;
    const w = h.w[k] || 0;
    h.w[k] = w + eta * gi / Math.sqrt(G + 1) - eta * l2 * w;
  }
  if (c && c.length) {
    let wu = h.cross[user], gu = h.cg2[user];
    if (!wu) { wu = h.cross[user] = Object.create(null); gu = h.cg2[user] = Object.create(null); }
    for (let i = 0; i < c.length; i++) {
      const k = c[i][0], v = c[i][1], gi = g * v;
      const G = (gu[k] || 0) + gi * gi;
      gu[k] = G;
      const w = wu[k] || 0;
      wu[k] = w + opt.crossEta * gi / Math.sqrt(G + 1) - opt.crossEta * l2 * w;
    }
  }
  h.n++;
  h.pos += y;
  return p;
}

// The game language as features. `game` = {id, formula, mood: {calm: .5, ...}, look, energy,
// competition, scope, fragments: [...], length, botQuality}. Cached per game.
function gameFeatures(game) {
  if (game._fx) return game._fx;
  const f = [];
  f.push(["f:" + game.formula, 1]);
  for (const m in game.mood) f.push(["m:" + m, game.mood[m]]);
  f.push(["l:" + game.look, 0.5]);
  f.push(["e", game.energy - 0.5]);
  f.push(["c", game.competition - 0.5]);
  f.push(["s:" + game.scope, 1]);
  const k = 1 / Math.sqrt(game.fragments.length || 1);
  game.fragments.forEach(fr => f.push(["fr:" + fr, k]));
  f.push(["len:" + game.length, 0.7]);
  f.push(["bot:" + (game.botQuality < -0.5 ? "low" : game.botQuality < 0.5 ? "mid" : "high"), 1]);
  game._fx = f;
  return f;
}

// Features crossed with the user: the ones a person's taste plausibly attaches to.
function crossFeatures(game) {
  if (game._cx) return game._cx;
  const all = gameFeatures(game);
  game._cx = all.filter(([key]) => /^(f:|m:|fr:|len:|s:)/.test(key));
  return game._cx;
}

function ageBucket(age) { return age < 1 ? "new" : age < 3 ? "young" : "old"; }

function rowFor(version, user, game, day) {
  const age = day - game.born;
  const x = [["b", 1], ["u:" + user.id, 1], ["i:" + game.id, 1], ["age:" + ageBucket(age), 1],
             ["uf:" + Math.min(user.friends.size, 6), 0.5], ["ug:" + (user.groups.length ? 1 : 0), 0.5]];
  if (!version.features) return { x, c: null };
  return { x: x.concat(gameFeatures(game)), c: crossFeatures(game) };
}

function newModel(versionName, opt) {
  const version = VERSIONS[versionName];
  const heads = {};
  ENGAGEMENT.forEach(k => { heads[k] = newHead(); });
  if (version.social) SOCIAL.forEach(k => { heads[k] = newHead(); });
  return {
    name: versionName, version, heads,
    opt: Object.assign({ eta: 0.08, crossEta: 0.15, l2: 1e-4, explore: 0.05, retrieve: 60, slopFinish: 0.3, slopMinTakes: 10, genGap: 0.1, genMinPages: 8, genEveryDays: 2, genPerDay: 25 }, opt || {}),
    stats: Object.create(null) // per-game take and finish counts, for retrieval and integrity
  };
}

function predict(model, user, game, day) {
  const r = rowFor(model.version, user, game, day);
  const out = { _row: r };
  for (const k in model.heads) out[k] = sigmoid(headLogit(model.heads[k], r.x, user.id, r.c));
  return out;
}

// The event graph: a challenge or rematch only follows a finished run, so their heads predict
// P(k | finished) and count through P(finish). Everything else is P(k | takeover).
const AFTER_FINISH = { challenge: true, rematch: true };

function valueOf(model, p) {
  let finished = 1, tail = 1;
  if (model.version.social) {
    for (const k in AFTER_FINISH) finished += WEIGHTS[k] * p[k];
    SOCIAL.forEach(k => { if (!AFTER_FINISH[k]) tail += WEIGHTS[k] * p[k]; });
  }
  tail += WEIGHTS.finish * p.finish * finished + WEIGHTS.save * p.save + WEIGHTS.share * p.share;
  return p.take * tail;
}

function gameStats(model, id) {
  return model.stats[id] || (model.stats[id] = { shown: 0, take: 0, finish: 0 });
}

function isSlop(model, game) {
  const s = model.stats[game.id];
  return !!s && s.take >= model.opt.slopMinTakes && s.finish / s.take < model.opt.slopFinish;
}

// Candidate retrieval: popularity (smoothed take rate), the newest games, a few random ones, and
// with game features the best feature matches for this person (their take head's crosses).
function retrieve(model, user, pool, day, rand) {
  const N = model.opt.retrieve;
  const chosen = new Set();
  const live = pool.filter(g => !isSlop(model, g));
  const pop = g => { const s = model.stats[g.id]; return s ? (s.take + 1) / (s.shown + 3) : 1 / 3; };
  const byPop = live.slice().sort((a, b) => pop(b) - pop(a) || (a.id < b.id ? -1 : 1));
  const byNew = live.slice().sort((a, b) => b.born - a.born || (a.id < b.id ? -1 : 1));
  const take = (list, n) => { for (let i = 0; i < list.length && n > 0; i++) if (!chosen.has(list[i])) { chosen.add(list[i]); n--; } };
  if (model.version.features) {
    const wu = model.heads.take.cross[user.id];
    const match = g => {
      if (!wu) return 0;
      let z = 0;
      const c = crossFeatures(g);
      for (let i = 0; i < c.length; i++) z += (wu[c[i][0]] || 0) * c[i][1];
      return z;
    };
    take(live.slice().sort((a, b) => match(b) - match(a) || (a.id < b.id ? -1 : 1)), Math.round(N / 3));
    take(byPop, Math.round(N / 3));
  } else {
    take(byPop, Math.round(N * 2 / 3));
  }
  take(byNew, Math.round(N / 6));
  const rest = live.filter(g => !chosen.has(g));
  while (chosen.size < N && rest.length) chosen.add(rest.splice(Math.floor(rand() * rest.length), 1)[0]);
  return Array.from(chosen);
}

// Rank one page: the best value not shown in this session, with epsilon exploration.
function pickPage(model, user, cands, day, shown, rand) {
  const open = cands.filter(g => !shown.has(g.id));
  if (!open.length) return null;
  if (rand() < model.opt.explore) {
    const g = open[Math.floor(rand() * open.length)];
    return { game: g, p: predict(model, user, g, day), explored: true };
  }
  let best = null, bestV = -1, bestP = null;
  for (const g of open) {
    const p = predict(model, user, g, day);
    const v = valueOf(model, p);
    if (v > bestV) { bestV = v; best = g; bestP = p; }
  }
  return { game: best, p: bestP, value: bestV, explored: false };
}

// Train every head on what happened. Conditional heads learn only where their event could happen.
function learn(model, user, game, day, outcome, p) {
  const r = p && p._row ? p._row : rowFor(model.version, user, game, day);
  const H = model.heads, opt = model.opt;
  const st = gameStats(model, game.id);
  st.shown++;
  headUpdate(H.take, r.x, user.id, r.c, outcome.take ? 1 : 0, opt);
  if (!outcome.take) return;
  st.take++;
  if (outcome.finish) st.finish++;
  headUpdate(H.finish, r.x, user.id, r.c, outcome.finish ? 1 : 0, opt);
  headUpdate(H.save, r.x, user.id, r.c, outcome.save ? 1 : 0, opt);
  headUpdate(H.share, r.x, user.id, r.c, outcome.share ? 1 : 0, opt);
  if (!model.version.social) return;
  SOCIAL.forEach(k => {
    if (AFTER_FINISH[k] && !outcome.finish) return;
    headUpdate(H[k], r.x, user.id, r.c, outcome[k] ? 1 : 0, opt);
  });
}

// Generation: when no candidate is likely to land, write a brief from the person's learned taste
// (their crosses on the take head), the same path the Blend spec takes to Muse Studio.
function briefFor(model, user, vocab) {
  const wu = model.heads.take.cross[user.id] || {};
  const top = (prefix, list) => list.slice().sort((a, b) => (wu[prefix + b] || 0) - (wu[prefix + a] || 0) || (a < b ? -1 : 1));
  const formula = top("f:", vocab.formulas)[0];
  const mood = top("m:", vocab.moods)[0];
  const allowed = vocab.fragmentsFor(formula);
  const fragments = top("fr:", allowed).slice(0, 3);
  // A social mechanic when this person's social heads respond to one.
  if (model.version.social) {
    const ws = (model.heads.challenge.cross[user.id] || {});
    const social = vocab.social.slice().sort((a, b) => (ws["fr:" + b] || 0) - (ws["fr:" + a] || 0) || (a < b ? -1 : 1))[0];
    if ((ws["fr:" + social] || 0) > 0 && fragments.indexOf(social) < 0) fragments.push(social);
  }
  const length = top("len:", vocab.lengths)[0];
  const scope = top("s:", vocab.scopes)[0];
  return { formula, mood, fragments, length, scope };
}

// How far the best candidate falls short of the game this person's taste describes, in the take
// head's cross units. A big gap = a taste the pool doesn't serve: the case for generating one.
function crossScoreOf(wu, features) {
  let z = 0;
  for (let i = 0; i < features.length; i++) z += (wu[features[i][0]] || 0) * features[i][1];
  return z;
}

function tasteGap(model, user, cands, vocab) {
  const wu = model.heads.take.cross[user.id];
  if (!wu) return { gap: 0, brief: null };
  const brief = briefFor(model, user, vocab);
  const k = 1 / Math.sqrt(brief.fragments.length || 1);
  const ideal = [["f:" + brief.formula, 1], ["m:" + brief.mood, 0.7], ["len:" + brief.length, 0.7], ["s:" + brief.scope, 1]]
    .concat(brief.fragments.map(f => ["fr:" + f, k]));
  const want = crossScoreOf(wu, ideal);
  let best = -Infinity;
  cands.forEach(g => { best = Math.max(best, crossScoreOf(wu, crossFeatures(g))); });
  return { gap: want - best, brief };
}

module.exports = { VERSIONS, ENGAGEMENT, SOCIAL, WEIGHTS, newModel, predict, valueOf, retrieve, pickPage, learn, briefFor, tasteGap, isSlop, gameFeatures, sigmoid, _head: { newHead, headLogit, headUpdate } };
