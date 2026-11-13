#!/usr/bin/env node
// Loop critic: how the core loop plays, read from the five-bot gate runs (playtest/gate.mjs). No image
// or text calls. For each bot it replays the run's recorded inputs and measures:
//
//   cadence      median seconds between inputs (the bar: a meaningful action every 1 to 3 s)
//   feedback     share of inputs that changed the game state within 250 ms (the bar: every action)
//   dead time    the longest stretch with no state-changing input and no score change (seconds)
//   run length   seconds to the end (the bar: 45 to 120 s) and how it ended (won, lost, timeout)
//   skill spread the pro's score against the new player's (a reason to replay: skill shows)
//   escalation   state numbers named like difficulty (speed, level, round, wave, mult, ...) that
//                move during the run, and the score rate in each third of the regular's run
//   restart      engine restart time (ms)
//
//   node authoring/tools/loop-critic.mjs <manifest.json | game.json> [--profile p] [--max-seconds 120] [--json]
//
// Prints one line per bot, then the issues against the bar (empty when the loop meets it). Exit 0.

import { readFileSync } from 'node:fs';
import { loadEngine } from '../expander/engine.mjs';
import { playtest } from '../playtest/gate.mjs';
import { apply, DT } from '../playtest/bots.mjs';

const ESCALATION = /(speed|level|round|wave|diff|mult|rate|stage|tier|pace|drain|spawn|gap|interval|heat|combo)/i;

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

/** Numbers in the state whose names read like difficulty or pace. */
function paceNumbers(state) {
  const out = {};
  for (const [k, v] of Object.entries(state ?? {})) if (typeof v === 'number' && ESCALATION.test(k) && !k.includes('__')) out[k] = v;
  return out;
}

/** Replays one run and measures its loop. */
export function measureRun(eng, json, run, { maxSeconds = 120 } = {}) {
  const g = eng.load(json, run.replay.seed);
  const actions = run.replay.actions ?? [];
  const maxSteps = Math.round((maxSeconds * 1000) / DT);
  const window = Math.round(250 / DT);
  let k = 0, step = 0;
  const inputs = [];
  const scoreChanges = [];
  let lastScore = 0;
  const thirds = [];
  const pace = { start: null, end: null };
  try {
    pace.start = paceNumbers(JSON.parse(g.state?.() ?? '{}'));
  } catch { pace.start = {}; }
  try {
    while (step < maxSteps && g.phase() === 'playing') {
      while (k < actions.length && actions[k].step === step) {
        // Feedback: against an idle fork taken before the input, the state moves within 250 ms
        // (inputs are read on the next step; a reveal may follow a beat later).
        const idle = g.fork();
        apply(g, actions[k].action);
        const probe = g.fork();
        let changed = false;
        for (let i = 0; i < window && !changed; i++) { probe.step(DT); idle.step(DT); if (probe.stateHash() !== idle.stateHash()) changed = true; }
        probe.dispose();
        idle.dispose();
        inputs.push({ t: (step * DT) / 1000, changed });
        k++;
      }
      g.step(DT);
      step++;
      const sc = g.status().score ?? 0;
      if (sc !== lastScore) { scoreChanges.push({ t: (step * DT) / 1000, d: sc - lastScore }); lastScore = sc; }
    }
    try { pace.end = paceNumbers(JSON.parse(g.state?.() ?? '{}')); } catch { pace.end = {}; }
    const st = g.status();
    const T = (st.time_ms ?? step * DT) / 1000;
    for (let i = 0; i < 3; i++) {
      const a = (T * i) / 3, b = (T * (i + 1)) / 3;
      const pts = scoreChanges.filter((c) => c.t > a && c.t <= b).reduce((s, c) => s + c.d, 0);
      thirds.push(r2(pts / Math.max(0.001, b - a)));
    }
    const gaps = inputs.slice(1).map((x, i) => x.t - inputs[i].t);
    const moments = [0, ...inputs.filter((x) => x.changed).map((x) => x.t), ...scoreChanges.map((c) => c.t), T].sort((a, b) => a - b);
    const dead = moments.slice(1).reduce((m, t, i) => Math.max(m, t - moments[i]), 0);
    const t0 = performance.now();
    g.restart(run.replay.seed);
    const restartMs = performance.now() - t0;
    return {
      bot: run.bot?.label ?? 'run', end: st.phase, seconds: r2(T), score: Math.round(st.score ?? 0), inputs: inputs.length,
      cadence: r2(median(gaps)), feedback: inputs.length ? r2(inputs.filter((x) => x.changed).length / inputs.length) : null,
      dead: r2(dead), thirds, restartMs: r2(restartMs),
      escalation: Object.keys(pace.end ?? {}).filter((key) => pace.start?.[key] !== undefined && pace.start[key] !== pace.end[key]).map((key) => `${key} ${r2(pace.start[key])}→${r2(pace.end[key])}`),
    };
  } finally { g.dispose(); }
}

/** The whole report: per-bot measures and the issues against the bar. */
export async function critique(json, { profile = null, maxSeconds = 120, engine = null } = {}) {
  const eng = engine ?? (await loadEngine()).engine;
  const gate = await playtest(json, { seed: 1, maxSeconds, profile });
  const bots = gate.runs.filter((r) => r.replay).map((r) => measureRun(eng, json, r, { maxSeconds }));
  const issues = [];
  const reg = bots.filter((b) => b.bot.startsWith('regular'));
  const lens = reg.map((b) => b.seconds);
  const medLen = median(lens);
  if (medLen != null && medLen < 45) issues.push(`runs are short: the regular bots end at ${lens.join(', ')} s (bar: 45 to 120 s)`);
  if (medLen != null && medLen > 120) issues.push(`runs are long: ${lens.join(', ')} s`);
  const cad = median(bots.map((b) => b.cadence).filter((x) => x != null));
  if (cad != null && cad > 3) issues.push(`slow cadence: a median ${cad} s between inputs (bar: 1 to 3 s)`);
  const fb = median(bots.map((b) => b.feedback).filter((x) => x != null));
  if (fb != null && fb < 0.9) issues.push(`feedback: only ${Math.round(fb * 100)} % of inputs change anything within 250 ms`);
  const dead = Math.max(0, ...bots.map((b) => b.dead));
  if (dead > 6) issues.push(`dead time: ${dead} s with no responsive input or score change`);
  const pro = bots.find((b) => b.bot === 'pro'), rookie = bots.find((b) => b.bot === 'new player');
  if (pro && rookie && pro.score <= rookie.score) issues.push(`no skill spread: the pro scores ${pro.score}, the new player ${rookie.score}`);
  if (!bots.some((b) => b.escalation.length) && !reg.some((b) => b.thirds[2] > b.thirds[0] * 1.15)) issues.push('no escalation: nothing named like pace or difficulty moves, and the score rate does not rise');
  if (reg.length && reg.every((b) => b.end === 'timeout')) issues.push('no fair end: every regular run times out');
  const restart = Math.max(0, ...bots.map((b) => b.restartMs));
  if (restart > 2000) issues.push(`restart takes ${Math.round(restart)} ms`);
  return { gate: { passed: gate.passed, profile: gate.profile }, bots, issues };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const file = args.find((a) => !a.startsWith('--') && a !== opt('--profile') && a !== opt('--max-seconds'));
  if (!file) { console.error('usage: loop-critic.mjs <manifest.json | game.json> [--profile p] [--max-seconds 120] [--json]'); process.exit(2); }
  const m = JSON.parse(readFileSync(file, 'utf8'));
  const json = m.content?.game_json ?? JSON.stringify(m);
  const r = await critique(json, { profile: opt('--profile'), maxSeconds: Number(opt('--max-seconds', '120')) });
  if (args.includes('--json')) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
  console.log(`gate ${r.gate.passed ? 'passed' : 'FAILED'} (${r.gate.profile})`);
  for (const b of r.bots) console.log(`${b.bot.padEnd(16)} ${b.end.padEnd(7)} ${String(b.seconds).padStart(6)} s  score ${String(b.score).padStart(6)}  inputs ${String(b.inputs).padStart(3)}  cadence ${b.cadence ?? '-'} s  feedback ${b.feedback ?? '-'}  dead ${b.dead} s  thirds ${b.thirds.join('/')} pts/s  restart ${b.restartMs} ms${b.escalation.length ? '  pace ' + b.escalation.join(', ') : ''}`);
  console.log(r.issues.length ? 'issues:\n- ' + r.issues.join('\n- ') : 'issues: none');
}
