// Dense frame sampling for the verifier. Replays the gate's bot runs (same seed, same inputs at the
// same 60 Hz steps) and captures a frame every `every` steps, plus the intro, every run's end state
// (won, lost or timeout) and an idle run that plays out the clock. Frames come back in the shape
// layout-check.mjs's `lintSample` reads, with exact duplicates dropped (a still screen is checked
// once, however long it stays up).
//
// Replays against a changed copy of the game (after a layout fix moved a button) remap each tap to
// the same hit target: the tap that hit target i of the reference game at that step hits target i of
// the copy, at the same relative spot. With no reference, taps replay at their recorded points.

import { loadEngine } from '../expander/engine.mjs';
import { instrument } from '../playtest/layout-check.mjs';
import { DT, DEFAULT_BOTS, mulberry32, inputSources, candidatesFor, apply, gameObject } from '../playtest/bots.mjs';

const asJson = (g) => (typeof g === 'string' ? g : JSON.stringify(g));

/** Topmost hit target index containing (x, y), or -1. */
export function hitIndex(targets, x, y) {
  return (targets ?? []).findIndex((t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h);
}

/** The tap on `cur` that does what `action` did on `ref` (same target index, same relative spot). */
export function remapTap(action, refTargets, curTargets) {
  if (action.kind !== 'tap' || !refTargets || !curTargets || refTargets.length !== curTargets.length) return action;
  const i = hitIndex(refTargets, action.x, action.y);
  if (i < 0) return action;
  const a = refTargets[i], b = curTargets[i];
  if (a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h) return action; // unmoved: exact same point
  const fx = a.w ? (action.x - a.x) / a.w : 0.5, fy = a.h ? (action.y - a.y) / a.h : 0.5;
  return { ...action, x: b.x + fx * b.w, y: b.y + fy * b.h };
}

/**
 * Plays one recorded run (or idle when `actions` is empty) and calls `onStep(g, step, applied)` after
 * each input and at every step. With `ref` (the reference game's JSON), taps are remapped and the
 * reference game is stepped in lockstep. Returns {steps, phase, hash}.
 */
export function replay(engine, json, { seed, actions = [], maxSteps, ref = null, onStep = null, atEnd = null }) {
  const g = engine.load(json, seed);
  const r = ref ? engine.load(ref, seed) : null;
  let step = 0, k = 0;
  try {
    while (step < maxSteps && g.phase() === 'playing') {
      while (k < actions.length && actions[k].step === step) {
        let a = actions[k].action;
        if (r) {
          if (a.kind === 'tap') { r.frame(); g.frame(); a = remapTap(a, r.hitTargets(), g.hitTargets()); }
          apply(r, actions[k].action);
        }
        apply(g, a);
        k++;
      }
      g.step(DT);
      r?.step(DT);
      step++;
      onStep?.(g, step);
    }
    const res = { steps: step, phase: g.phase(), hash: typeof g.stateHash === 'function' ? g.stateHash() : null };
    if (atEnd) res.value = atEnd(g);
    return res;
  } finally {
    g.dispose();
    r?.dispose();
  }
}

/** Cheap random-play runs for when the gate's runs aren't given (layout-check's sampler bots). */
export function randomRuns(engine, json, { seeds = [1, 2], maxSeconds = 60 } = {}) {
  const sources = inputSources(gameObject(json));
  const runs = [];
  for (const seed of seeds) {
    const g = engine.load(json, seed);
    const rng = mulberry32(seed * 7919);
    const actions = [];
    let step = 0, next = 30;
    const maxSteps = Math.round((maxSeconds * 1000) / DT);
    try {
      while (step < maxSteps && g.phase() === 'playing') {
        if (step >= next) {
          const c = candidatesFor(g.frameJSON(), sources, rng, g.hitTargets?.() ?? null, null).filter((x) => x.kind !== 'noop');
          if (c.length) { const a = c[Math.floor(rng() * c.length)]; apply(g, a); actions.push({ step, action: a }); }
          next = step + 20 + Math.floor(rng() * 20);
        }
        g.step(DT);
        step++;
      }
    } finally { g.dispose(); }
    runs.push({ bot: { label: `random ${seed}` }, replay: { seed, actions } });
  }
  return runs;
}

/** A frame's draw list as a short string, to drop exact repeats. */
function signature(frame) {
  let s = '';
  for (const o of frame.ops) {
    s += o.op[0];
    for (const k of ['x', 'y', 'w', 'h', 'r', 'x1', 'y1', 'x2', 'y2']) if (typeof o[k] === 'number') s += ',' + Math.round(o[k] * 2);
    if (o.op === 'text') s += '"' + o.text + '"' + o.size + (o.color ?? '');
    if (o.fill) s += o.fill;
    if (o.opacity != null && o.opacity !== 1) s += '~' + o.opacity.toFixed(2);
    if (o.scale != null && o.scale !== 1) s += '*' + o.scale.toFixed(2);
    if (o.op === 'image') s += '#' + o.asset + ':' + o.frame;
    s += ';';
  }
  return s;
}

/**
 * Samples a game densely. opts: {runs (the gate's runs, each with replay {seed, actions}),
 * ref (reference game JSON for tap remapping), every (steps between captures, default 6 = 100 ms),
 * maxSeconds (default 120), idle (default true), engine}.
 * Returns {frames, nodes, tagged, assets, coverage}.
 */
export async function sampleDense(gameJson, { runs = null, ref = null, every = 6, maxSeconds = 120, idle = true, engine = null } = {}) {
  const game = typeof gameJson === 'string' ? JSON.parse(gameJson) : gameJson;
  const eng = engine ?? (await loadEngine()).engine;
  let { game: inst, nodes } = instrument(game);
  let tagged = true;
  let probe;
  try { probe = eng.load(JSON.stringify(inst), 1); } catch { tagged = false; nodes = [null]; inst = game; probe = eng.load(JSON.stringify(game), 1); }
  const assets = probe.assets();
  probe.dispose();
  const json = JSON.stringify(inst);
  // The reference is instrumented too, so remapped taps see the same hit-target layout logic.
  const refJson = ref ? (() => { try { const r = instrument(typeof ref === 'string' ? JSON.parse(ref) : ref).game; eng.load(JSON.stringify(r), 1).dispose(); return JSON.stringify(r); } catch { return asJson(ref); } })() : null;
  const theRuns = runs ?? randomRuns(eng, refJson ?? json, { maxSeconds: Math.min(maxSeconds, 60) });
  const list = theRuns.filter((r) => r?.replay).map((r, i) => ({ label: r.bot?.label ?? `run ${i + 1}`, seed: r.replay.seed, actions: r.replay.actions ?? [], idle: false }));
  if (idle) list.push({ label: 'idle', seed: list[0]?.seed ?? 1, actions: [], idle: true });
  const maxSteps = Math.round((maxSeconds * 1000) / DT);
  const frames = [];
  const seen = new Set();
  const coverage = { captured: 0, unique: 0, runs: [], endStates: { won: 0, lost: 0, timeout: 0 } };
  list.forEach((run, ri) => {
    const cap = (g, step, label) => {
      coverage.captured++;
      const frame = g.frameJSON();
      const sig = signature(frame);
      if (seen.has(sig) && label === 'play') return;
      seen.add(sig);
      const t = Math.round(step * DT);
      frames.push({ label, seed: ri + 1, run: ri, step, idle: run.idle, t, frame, targets: g.hitTargets?.() ?? [], key: `${run.label}:${label}@${(t / 1000).toFixed(1)}s` });
    };
    let res;
    try {
      res = replay(eng, json, {
        seed: run.seed, actions: run.actions, maxSteps, ref: refJson,
        onStep: (g, step) => {
          if (step === 20) cap(g, step, 'intro');
          else if (step % every === 0 && g.phase() === 'playing') cap(g, step, 'play');
          else if (g.phase() !== 'playing') cap(g, step, `end-${g.phase()}`);
          else if (step >= maxSteps) cap(g, step, 'end-timeout');
        },
      });
    } catch (e) { res = { error: String(e.message ?? e) }; }
    const end = res.phase === 'won' ? 'won' : res.phase === 'lost' ? 'lost' : res.error ? 'error' : 'timeout';
    if (end in coverage.endStates) coverage.endStates[end]++;
    coverage.runs.push({ label: run.label, steps: res.steps ?? 0, end, hash: res.hash ?? null });
  });
  coverage.unique = frames.length;
  return { frames, nodes, tagged, assets, coverage, replayCtx: { json, refJson, runs: list, maxSteps } };
}

/** Replays run `f.run` up to frame `f`'s step and returns fn(game) at that point. */
export function atFrame(engine, replayCtx, f, fn) {
  const run = replayCtx.runs[f.run];
  if (!run) return null;
  return replay(engine, replayCtx.json, { seed: run.seed, actions: run.actions.filter((a) => a.step < f.step), maxSteps: f.step, ref: replayCtx.refJson, atEnd: fn }).value;
}
