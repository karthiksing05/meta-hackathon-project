// Bot playtest gate: a port of the beta app's StudioPlaytest (FacebookClone/Bubbles/Studio) for
// authored microgames. Generic bots (no per-game code) play the compiled game headless in the
// Rust/WASM engine; `analyze` turns the runs into blocking and non-blocking flags.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { loadEngine } from '../expander/engine.mjs';
import { DT, LOOKAHEAD_STEPS, DEFAULT_BOTS, mulberry32, asObject, gameObject, inputSources, candidatesFor, textCandidates, apply, analyze, summarize } from './bots.mjs';

export { DEFAULT_BOTS, analyze, summarize, gameObject };

// ---------- one run ----------

function playOne(engine, json, game, sources, bot, seed, maxSeconds) {
  const rng = mulberry32(bot.botSeed);
  const gameSeed = seed + bot.seedOffset;
  const errors = [];
  const note = (e) => { const m = String(e?.message ?? e); if (!errors.includes(m)) errors.push(m); };
  const base = bot.skill >= 0.9 ? 18 : bot.skill >= 0.6 ? 27 : 42;
  const maxSteps = Math.round((maxSeconds * 1000) / DT);

  let g = null;
  let probe = null;
  let steps = 0;
  let last = { phase: 'playing', score: 0, time_ms: 0 };
  const history = [];

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
    probe = engine.load(json, gameSeed);
    let nextDecision = 0;
    while (steps < maxSteps && g.phase() === 'playing') {
      if (steps >= nextDecision) {
        const candidates = candidatesFor(asObject(g.frameJSON()), sources, rng, typeof g.hitTargets === 'function' ? g.hitTargets() : null, sources.text ? textCandidates(g, rng) : null);
        let choice;
        if (rng() < bot.skill) {
          let best = -Infinity;
          for (const cand of candidates) {
            probe.restart(gameSeed);
            let s = 0;
            for (const h of history) {
              while (s < h.step) { probe.step(DT); s++; }
              apply(probe, h.action);
            }
            while (s < steps) { probe.step(DT); s++; }
            apply(probe, cand);
            for (let i = 0; i < LOOKAHEAD_STEPS && probe.phase() === 'playing'; i++) probe.step(DT);
            const v = value(probe);
            if (v > best) { best = v; choice = cand; }
          }
        } else {
          choice = candidates[Math.floor(rng() * candidates.length)];
        }
        if (choice.kind !== 'noop') { apply(g, choice); history.push({ step: steps, action: choice }); }
        nextDecision = steps + Math.max(1, base + Math.round((rng() * 2 - 1) * base * 0.15));
      }
      g.step(DT);
      steps++;
    }
    last = g.status();
    for (const d of g.diagnostics() ?? []) if (d.severity === 'error') note(`${d.code ?? 'runtime'}: ${d.message}`);
  } catch (e) {
    note(e);
  } finally {
    try { g?.dispose(); } catch { /* ignore */ }
    try { probe?.dispose(); } catch { /* ignore */ }
  }

  const outcome = errors.length ? 'error' : last.phase === 'won' ? 'success' : last.phase === 'lost' ? 'fail' : 'timeout';
  return {
    bot,
    ok: errors.length === 0,
    error: errors.length ? errors.join('; ') : null,
    outcome,
    score: Math.round(last.score ?? 0),
    seconds: (last.time_ms ?? steps * DT) / 1000,
    // Enough to replay the run in the shell: same seed, same inputs at the same 60 Hz steps.
    replay: { seed: gameSeed, dt: DT, actions: history },
  };
}

export async function playtest(gameJson, { seed = 1, bots = DEFAULT_BOTS, maxSeconds = 180, inputsOf = gameObject } = {}) {
  const json = typeof gameJson === 'string' ? gameJson : JSON.stringify(gameJson);
  const sources = inputSources(inputsOf(json));
  // Each bot is independent and deterministic, so they run on parallel threads.
  const runs = await Promise.all(bots.map((bot) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { json, sources, bot, seed, maxSeconds } });
    worker.once('message', resolve);
    worker.once('error', reject);
  })));
  const flags = analyze(runs, { maxSeconds });
  return { runs, flags, passed: !flags.some((f) => f.blocking), summary: summarize(runs, maxSeconds) };
}

if (!isMainThread && workerData?.json) {
  const { engine } = await loadEngine();
  const { json, sources, bot, seed, maxSeconds } = workerData;
  parentPort.postMessage(playOne(engine, json, gameObject(json), sources, bot, seed, maxSeconds));
}
