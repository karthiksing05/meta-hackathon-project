// The bot playtest gate for hosts with one thread and an event loop (the Studio web view; see
// authoring/tools/make-studio-bundle.mjs). Same bots, actions and analysis as gate.mjs (shared in
// bots.mjs), with two differences:
//
// - Bots run one after another, and each run yields to the event loop every few milliseconds, so
//   the page stays responsive while a gate runs.
// - Look-ahead forks the live game (`game.fork()`, engine v0.2 `mg_fork`) instead of restarting a
//   probe and replaying the whole input history before every candidate. Same states, far less work.
//
// No Node APIs and no imports outside this folder.

import { DT, LOOKAHEAD_STEPS, DEFAULT_BOTS, mulberry32, asObject, gameObject, inputSources, candidatesFor, textCandidates, apply, probeDeadInputs, analyze, summarize, gateProfile, decisionBase, randomLiveChoice, pickState } from './bots.mjs';

export { DEFAULT_BOTS };

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** Resolves on the next event-loop turn (a MessageChannel task where there is one: timers can be throttled in hidden views). */
export function yieldToHost() {
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
      ch.port2.postMessage(0);
    });
  }
  if (typeof setTimeout !== 'undefined') return new Promise((resolve) => setTimeout(resolve, 0));
  return Promise.resolve();
}

async function playOneAsync(engine, json, sources, bot, seed, maxSeconds, sliceMs, profile = gateProfile(null), pickKeys = null) {
  const rng = mulberry32(bot.botSeed);
  const gameSeed = seed + bot.seedOffset;
  const errors = [];
  const note = (e) => { const m = String(e?.message ?? e); if (!errors.includes(m)) errors.push(m); };
  const base = decisionBase(bot, profile);
  const maxSteps = Math.round((maxSeconds * 1000) / DT);

  let g = null;
  let steps = 0;
  let last = { phase: 'playing', score: 0, time_ms: 0 };
  const history = [];
  let picks;

  const value = (p) => {
    const st = p.status();
    if (st.phase === 'won') return 1e9 - st.time_ms;
    if (st.phase === 'lost') return -1e9 + st.time_ms;
    let progress;
    try { progress = asObject(p.state()).__progress; } catch { /* no state */ }
    return typeof progress === 'number' ? progress : st.score;
  };

  try {
    g = engine.load(json, gameSeed);
    let nextDecision = 0;
    let sliceStart = now();
    while (steps < maxSteps && g.phase() === 'playing') {
      if (steps >= nextDecision) {
        const candidates = candidatesFor(asObject(g.frameJSON()), sources, rng, typeof g.hitTargets === 'function' ? g.hitTargets() : null, sources.text ? textCandidates(g, rng) : null);
        let choice;
        if (profile.randomPlay) {
          choice = randomLiveChoice(g, candidates, rng);
        } else if (rng() < bot.skill) {
          let best = -Infinity;
          for (const cand of candidates) {
            const probe = g.fork();
            try {
              apply(probe, cand);
              for (let i = 0; i < (profile.lookahead ?? LOOKAHEAD_STEPS) && probe.phase() === 'playing'; i++) probe.step(DT);
              const v = value(probe);
              if (v > best) { best = v; choice = cand; }
            } finally {
              probe.dispose();
            }
          }
        } else {
          choice = candidates[Math.floor(rng() * candidates.length)];
        }
        if (choice.kind !== 'noop') { apply(g, choice); history.push({ step: steps, action: choice }); }
        nextDecision = steps + Math.max(1, base + Math.round((rng() * 2 - 1) * base * 0.15));
        if (now() - sliceStart >= sliceMs) { await yieldToHost(); sliceStart = now(); }
      }
      g.step(DT);
      steps++;
    }
    last = g.status();
    if (profile.picks) picks = pickState(g, pickKeys);
    for (const d of g.diagnostics() ?? []) if (d.severity === 'error') note(`${d.code ?? 'runtime'}: ${d.message}`);
  } catch (e) {
    note(e);
  } finally {
    try { g?.dispose(); } catch { /* ignore */ }
  }

  const outcome = errors.length ? 'error' : last.phase === 'won' ? 'success' : last.phase === 'lost' ? 'fail' : 'timeout';
  return {
    bot,
    ok: errors.length === 0,
    error: errors.length ? errors.join('; ') : null,
    outcome,
    score: Math.round(last.score ?? 0),
    seconds: (last.time_ms ?? steps * DT) / 1000,
    replay: { seed: gameSeed, dt: DT, actions: history },
    ...(picks ? { picks } : {}),
  };
}

/**
 * Plays the game with every bot, one at a time, and analyzes the runs like gate.mjs `playtest`.
 * options: {seed = 1, bots = DEFAULT_BOTS, maxSeconds = 180, sliceMs = 12, onRun(run, index), profile,
 * pickKeys} (profile and pickKeys as in gate.mjs). Returns {runs, flags, inputProbe, passed, summary,
 * profile, ms}.
 */
export async function playtestAsync(engine, gameJson, { seed = 1, bots = DEFAULT_BOTS, maxSeconds = 180, sliceMs = 12, onRun, profile: profileName = null, pickKeys = null } = {}) {
  const started = now();
  const profile = gateProfile(profileName);
  const json = typeof gameJson === 'string' ? gameJson : JSON.stringify(gameJson);
  const sources = inputSources(gameObject(json));
  const runs = [];
  for (const bot of bots) {
    const t0 = now();
    const run = await playOneAsync(engine, json, sources, bot, seed, maxSeconds, sliceMs, profile, pickKeys);
    run.ms = Math.round(now() - t0);
    runs.push(run);
    if (onRun) onRun(run, runs.length - 1);
    await yieldToHost();
  }
  let inputProbe = null;
  try {
    inputProbe = probeDeadInputs(engine, json, sources, { seed });
  } catch { /* the mash probe is advisory: a failure here never fails the gate */ }
  const flags = analyze(runs, { maxSeconds, inputProbe, game: gameObject(json), profile });
  return { runs, flags, inputProbe, passed: !flags.some((f) => f.blocking), summary: summarize(runs, maxSeconds), profile: profile.name, ms: Math.round(now() - started) };
}
