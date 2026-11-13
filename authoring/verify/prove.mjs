// Proof that a layout change is presentation only:
//   - rules: everything outside `presentation` is identical, and inside it every handler (on_tap,
//     on_press, on_release, on_drag) and the feedback block are identical;
//   - replays: each bot run (and an idle run) replayed on the original and on the changed game, with
//     taps remapped to the same hit target, gives the same state hash after every input and at the
//     end, and the same end phase. One exception, reported as `blockedTaps`: a recorded tap that
//     reached a target the changed game hides under an overlay (the tap-through fix) ends that
//     run's comparison there, since blocking that tap is the point of the fix.

import { loadEngine } from '../expander/engine.mjs';
import { walkNodes } from '../playtest/layout-check.mjs';
import { DT, apply } from '../playtest/bots.mjs';
import { randomRuns, remapTap, hitIndex } from './frames.mjs';

const HANDLERS = ['on_tap', 'on_press', 'on_release', 'on_drag'];
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

function handlers(game) {
  const out = [];
  walkNodes(game?.presentation?.root, (n) => { for (const h of HANDLERS) if (n[h]) out.push(`${h}:${stable(n[h])}`); });
  return out.sort();
}

/** {rules: bool, diff: [what differs]} */
export function sameRules(a, b) {
  const diff = [];
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    if (k === 'presentation') continue;
    if (stable(a[k]) !== stable(b[k])) diff.push(k);
  }
  if (stable(a.presentation?.feedback) !== stable(b.presentation?.feedback)) diff.push('presentation.feedback');
  if (handlers(a).join('\n') !== handlers(b).join('\n')) diff.push('presentation handlers');
  return { rules: diff.length === 0, diff };
}

/** Replays one run on both games in lockstep; returns {equal, steps, at (first differing step)}. */
export function sameReplay(engine, jsonA, jsonB, { seed, actions = [], maxSteps }) {
  const a = engine.load(jsonA, seed), b = engine.load(jsonB, seed);
  let step = 0, k = 0;
  try {
    while (step < maxSteps && a.phase() === 'playing') {
      let acted = false;
      while (k < actions.length && actions[k].step === step) {
        const act = actions[k].action;
        let mapped = act;
        if (act.kind === 'tap') {
          a.frame(); b.frame();
          const ta = a.hitTargets(), tb = b.hitTargets();
          const i = hitIndex(ta, act.x, act.y);
          // The changed game hid the target this tap reached (a tap-through gate): from here the
          // runs differ by design. Stop comparing this run and say so.
          const same = (p, q) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5 && Math.abs(p.w - q.w) < 0.5 && Math.abs(p.h - q.h) < 0.5;
          if (i >= 0 && ta.length > tb.length && !tb.some((t) => same(t, ta[i]))) return { equal: true, steps: step, blockedTap: { step, x: act.x, y: act.y } };
          mapped = remapTap(act, ta, tb);
        }
        apply(a, act); apply(b, mapped); k++; acted = true;
      }
      a.step(DT); b.step(DT); step++;
      if ((acted || step % 60 === 0) && a.stateHash() !== b.stateHash()) return { equal: false, steps: step, at: step };
      if (a.phase() !== b.phase()) return { equal: false, steps: step, at: step, why: 'phase' };
    }
    const equal = a.stateHash() === b.stateHash() && a.phase() === b.phase();
    return { equal, steps: step, at: equal ? null : step };
  } finally { a.dispose(); b.dispose(); }
}

/** opts: {runs (the gate's runs), maxSeconds (default 120), engine}. */
export async function proveUnchanged(original, changed, { runs = null, maxSeconds = 120, engine = null } = {}) {
  const eng = engine ?? (await loadEngine()).engine;
  const rules = sameRules(original, changed);
  const ja = JSON.stringify(original), jb = JSON.stringify(changed);
  const maxSteps = Math.round((maxSeconds * 1000) / DT);
  const list = (runs ?? randomRuns(eng, ja, { maxSeconds: 60 })).filter((r) => r?.replay).map((r) => ({ label: r.bot?.label ?? 'run', seed: r.replay.seed, actions: r.replay.actions ?? [] }));
  list.push({ label: 'idle', seed: list[0]?.seed ?? 1, actions: [] });
  const results = [];
  for (const run of list) {
    try { results.push({ label: run.label, ...sameReplay(eng, ja, jb, { ...run, maxSteps }) }); } catch (e) { results.push({ label: run.label, equal: false, error: String(e.message ?? e).slice(0, 160) }); }
  }
  const blocked = results.filter((r) => r.blockedTap).length;
  return { rules: rules.rules, rulesDiff: rules.diff, replays: results.every((r) => r.equal), blockedTaps: blocked, runs: results };
}
