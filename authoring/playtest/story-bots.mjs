// Story bots: playtest players for games compiled from a story graph (expander/story-graph.mjs).
// The generic bots in bots.mjs tap whatever looks best a moment ahead, which tells us little about a
// story. These bots read the graph instead and play planned routes through the real engine:
//
//   random 1–3   a uniform random chooser (seeded), like a first-time reader
//   shortest     the fewest choices to the best ending (what a pro shares: "king in 5 choices")
//   longest      the most choices any run can take (checks the choice limit and pacing)
//   worst        the fewest choices to the lowest-ranked ending (checks a run can be lost)
//   find <id>    the fewest choices to each other ending (every ending can be found in play)
//
// Every move is checked against the graph: the scene the engine shows, the values of the variables
// and, at the end, the phase and score must be what the graph walk predicts. A mismatch is a compiler
// or fragment bug and blocks. Runs carry replays in the shape score-check.mjs reads.
//
// Host-agnostic like bots.mjs: pass an engine (expander/engine.mjs loadEngine().engine).

import { DT, mulberry32, analyze, summarize } from './bots.mjs';
import { walkStory, pathTo, openChoices, takeChoice, initialVals, storyScore } from '../expander/story-graph.mjs';

const BUTTON_X = 180;
const BUTTON_H = 52;
const BUTTON_GAP = 64;

/** Planned routes through a validated graph: [{label, skill, steps: [{s, j, display}]}]. */
export function storyPlans(report, { randomBots = 3, seed = 1 } = {}) {
  const g = report.graph;
  const walk = walkStory(g);
  const ends = [...walk.states.entries()].filter(([, st]) => st?.end);
  const byUsed = (a, b) => a[1].used - b[1].used;
  const plans = [];
  const add = (label, skill, key) => { const steps = key ? pathTo(walk, key) : null; if (steps) plans.push({ label, skill, steps }); };

  for (let b = 0; b < randomBots; b++) {
    const rng = mulberry32(seed * 7919 + b * 104729 + 17);
    const steps = [];
    let k = walk.root;
    for (let guard = 0; guard < 64; guard++) {
      const st = walk.states.get(k);
      if (!st || st.end || !st.next.length) break;
      const n = st.next[Math.floor(rng() * st.next.length)];
      steps.push({ s: st.s, j: n.j, display: n.display });
      k = n.key;
    }
    plans.push({ label: `random ${b + 1}`, skill: 0.5, steps });
  }
  const goalEnds = ends.filter(([, st]) => st.s === g.goal).sort(byUsed);
  add('shortest', 0.95, goalEnds[0]?.[0]);
  const longest = ends.slice().sort((a, b) => b[1].used - a[1].used || a[1].s - b[1].s)[0];
  add('longest', 0.6, longest?.[0]);
  const rankOf = (st) => g.nodes[st.s].ending.rank;
  const worst = ends.slice().sort((a, b) => rankOf(b[1]) - rankOf(a[1]) || a[1].used - b[1].used)[0];
  add('worst', 0.2, worst?.[0]);
  const covered = new Set(plans.map((p) => endOf(g, p.steps)));
  for (const n of g.nodes.filter((x) => x.ending && !covered.has(x.k))) {
    const e = ends.filter(([, st]) => st.s === n.k).sort(byUsed)[0];
    add(`find ${n.id}`, 0.5, e?.[0]);
  }
  return plans;
}

/** The node a planned route ends on. */
export function endOf(g, steps) {
  let s = 0;
  let vals = initialVals(g);
  steps.forEach((p, used) => { const t = takeChoice(g, s, p.j, vals, used); s = t.to; vals = t.vals; });
  return s;
}

/** Predicts every step of a planned route: [{s, vals}] after each choice, then the score. */
export function predict(g, steps) {
  let s = 0;
  let vals = initialVals(g);
  const trail = [];
  steps.forEach((p, used) => {
    const shown = openChoices(g, s, vals);
    if (shown[p.display] !== p.j) throw new Error(`plan step ${used}: choice ${p.j} isn't shown at button ${p.display}`);
    const t = takeChoice(g, s, p.j, vals, used);
    s = t.to; vals = t.vals;
    trail.push({ s, vals });
  });
  return { trail, end: s, score: storyScore(g, s, vals, steps.length), won: !!g.nodes[s].ending?.win };
}

const stateOf = (game) => { const v = game.state(); return typeof v === 'string' ? JSON.parse(v) : v; };

/**
 * Plays one planned route in the engine. `params` are the compiled choice_story / story_vars
 * params ({read_ms, button_y, curtain_ms}). Returns a run in the gate's shape plus `mismatch`.
 */
export function playPlan(engine, gameJson, report, plan, params, { seed = 1 } = {}) {
  const g = report.graph;
  const json = typeof gameJson === 'string' ? gameJson : JSON.stringify(gameJson);
  const readSteps = Math.ceil((params.read_ms + 80) / DT);
  const curtainSteps = Math.ceil((params.curtain_ms + 300) / DT);
  const expected = predict(g, plan.steps);
  const actions = [];
  let mismatch = null;
  let game;
  let steps = 0;
  const run = (n) => { for (let i = 0; i < n && game.phase() === 'playing'; i++) { game.step(DT); steps++; } };
  try {
    game = engine.load(json, seed);
    run(readSteps);
    plan.steps.forEach((p, used) => {
      if (mismatch) return;
      const y = params.button_y + p.display * BUTTON_GAP + BUTTON_H / 2;
      game.frame();
      game.pointer('down', BUTTON_X, y);
      game.pointer('up', BUTTON_X, y);
      actions.push({ step: steps, action: { kind: 'tap', x: BUTTON_X, y } });
      run(1); // inputs are handled on the next step
      const st = stateOf(game);
      const want = expected.trail[used];
      const label = g.nodes[p.s].choices[p.j].label;
      if (st.scene !== want.s) mismatch = `after "${label}" (choice ${used + 1}) the engine shows scene ${st.scene} ("${g.nodes[st.scene]?.id}"), the graph says "${g.nodes[want.s].id}"`;
      else if (JSON.stringify(st.sg_vals) !== JSON.stringify(want.vals)) mismatch = `after "${label}" (choice ${used + 1}) the engine has values ${JSON.stringify(st.sg_vals)}, the graph says ${JSON.stringify(want.vals)}`;
      run(readSteps);
    });
    run(curtainSteps);
    const status = game.status();
    const phase = status.phase;
    const want = expected.won ? 'won' : 'lost';
    if (!mismatch && phase !== want) mismatch = `the run ended "${phase}", the graph says "${want}" (ending "${g.nodes[expected.end].id}")`;
    if (!mismatch && Math.round(status.score) !== expected.score) mismatch = `the engine scored ${status.score}, the graph says ${expected.score}`;
    const fin = stateOf(game);
    if (!mismatch && (fin.ending !== g.nodes[expected.end].id || fin.choices_used !== plan.steps.length)) mismatch = `the result state is ending "${fin.ending}" after ${fin.choices_used} choices, the graph says "${g.nodes[expected.end].id}" after ${plan.steps.length}`;
    const outcome = phase === 'won' ? 'success' : phase === 'lost' ? 'fail' : 'timeout';
    return {
      bot: { label: plan.label, skill: plan.skill, botSeed: 0, seedOffset: 0 },
      ok: true,
      error: null,
      outcome,
      score: Math.round(status.score ?? 0),
      seconds: (status.time_ms ?? steps * DT) / 1000,
      ending: g.nodes[expected.end].id,
      choices: plan.steps.length,
      path: plan.steps.map((p) => p.display).join('.'),
      mismatch,
      replay: { seed, dt: DT, actions },
    };
  } catch (e) {
    return { bot: { label: plan.label, skill: plan.skill }, ok: false, error: String(e?.message ?? e), outcome: 'error', score: 0, seconds: steps * DT / 1000, mismatch, replay: { seed, dt: DT, actions } };
  } finally {
    try { game?.dispose(); } catch { /* ignore */ }
  }
}

/** The compiled params a story game uses (from the authoring manifest's uses). */
export function storyParams(manifest) {
  const cs = manifest.uses.find((u) => u.fragment === 'choice_story')?.params ?? {};
  const sv = manifest.uses.find((u) => u.fragment === 'story_vars')?.params ?? {};
  return { read_ms: cs.read_ms ?? 1200, button_y: cs.button_y ?? 380, curtain_ms: sv.curtain_ms ?? 3500 };
}

/**
 * The story gate: plays every plan, checks the engine against the graph, and reports which endings
 * the bots found. Returns {runs, flags, passed, summary, endings}.
 */
export function storyGate(engine, gameJson, report, manifest, { seed = 1, randomBots = 3 } = {}) {
  const g = report.graph;
  const params = storyParams(manifest);
  const plans = storyPlans(report, { randomBots, seed });
  const runs = plans.map((p) => playPlan(engine, gameJson, report, p, params, { seed }));
  const flags = [];
  const flag = (code, message, blocking) => flags.push({ code, message, blocking });
  for (const r of runs) if (r.mismatch) flag('story_mismatch', `${r.bot.label}: ${r.mismatch}`, true);
  for (const r of runs) if (!r.ok) flag('runtime_error', `${r.bot.label}: ${r.error}`, true);
  for (const e of report.errors) flag('story_graph', `${e.code}: ${e.message}`, true);
  // The generic analysis, minus what doesn't fit a story (no fail state is fine; equal scores on a
  // planned route are expected).
  for (const f of analyze(runs.filter((r) => r.ok), { maxSeconds: 600 })) {
    if (['no_challenge', 'flat', 'too_short', 'short'].includes(f.code)) continue;
    if (f.code === 'cant_lose' && !g.nodes.some((n) => n.ending && !n.ending.win)) continue;
    flags.push(f);
  }
  const found = new Set(runs.filter((r) => r.ok && !r.mismatch).map((r) => r.ending));
  const all = g.nodes.filter((n) => n.ending && n.k !== g.onLimit).map((n) => n.id);
  const missing = all.filter((id) => !found.has(id));
  if (missing.length) flag('ending_unreachable', `no bot reached ${missing.map((m) => `"${m}"`).join(', ')} in the engine`, true);
  const short = runs.find((r) => r.bot.label === 'shortest');
  const order = ['shortest', 'random 1', 'worst'].map((l) => runs.find((r) => r.bot.label === l)).filter(Boolean);
  if (order.length === 3 && !(order[0].score >= order[1].score && order[1].score >= order[2].score)) flag('story_skill_order', `scores don't follow the ending ranks: shortest ${order[0].score}, random ${order[1].score}, worst ${order[2].score}`, false);
  return {
    runs,
    flags,
    passed: !flags.some((f) => f.blocking),
    summary: `${summarize(runs, 600)} · endings ${found.size}/${g.nodes.filter((n) => n.ending).length}${short ? ` · best in ${short.choices} choices` : ''}`,
    endings: [...found],
  };
}

/**
 * Story runs relabelled for playtest/score-check.mjs (checkScore), whose skill-order check reads the
 * generic bot labels: the shortest route to the best ending plays the pro, the random readers the
 * regulars, the worst route the new player. With these, the score check measures what a story's
 * skill is (choosing well), not how fast a bot taps.
 */
export function asScoreRuns(runs) {
  const map = { shortest: 'pro', 'random 1': 'regular', 'random 2': 'regular, seed 2', 'random 3': 'regular, seed 3', worst: 'new player' };
  return runs.filter((r) => map[r.bot.label] && r.ok).map((r) => ({ ...r, bot: { ...r.bot, label: map[r.bot.label] } }));
}
