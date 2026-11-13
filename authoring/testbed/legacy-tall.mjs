// A game written for the 360 × 640 canvas, shown on the tall 360 × 780 canvas without touching its
// rules: the drawing moves down by 70 units into a group, so the old 40–614 band lands on the tall
// canvas's safe area (110–684) and the old HUD rows sit just inside it. The backdrop is redrawn to
// cover the whole tall canvas (center crop), feedback particles and the native text field move with
// the drawing, and node handlers that read `pointer.y` read it back in the old coordinates.
//
// `proveLift` is the proof for this one coordinate change: everything outside presentation is
// identical, handlers are identical once the pointer rewrite is undone, and every bot run replayed
// with its taps moved down by the same 70 units gives the same state hash at every input and at the
// end. A game whose rules read raw pointer positions (an input `from: pointer`) fails the replay
// proof when a tap's y matters, and keeps the 640 canvas.

import { DT, apply } from '../playtest/bots.mjs';
import { randomRuns } from '../verify/frames.mjs';
import { loadEngine } from '../expander/engine.mjs';
import { walkNodes } from '../playtest/layout-check.mjs';

export const LIFT = 70;
const TALL_H = 780;
const HANDLERS = ['on_tap', 'on_press', 'on_release', 'on_drag'];
const clone = (v) => JSON.parse(JSON.stringify(v));
const PTR_Y = /\bpointer\.y\b/g;
const isExpr = (v) => typeof v === 'string' && v.startsWith('=');

function shiftY(v, dy) {
  if (typeof v === 'number') return v + dy;
  if (isExpr(v)) return `= (${v.slice(1).trim()}) + ${dy}`;
  return v;
}

/** The lifted copy of a 360 × 640 game. Returns null when the game isn't on the 640 canvas. */
export function liftToTall(game, { dy = LIFT } = {}) {
  const c = game.presentation?.canvas;
  if (!c || c.w !== 360 || c.h !== 640) return null;
  const g = clone(game);
  const p = g.presentation;
  p.canvas = { ...p.canvas, h: TALL_H };
  const kids = p.root?.children ?? [];
  // The backdrop picture (the expander puts it first, at 0,0 covering the canvas): cover the tall canvas.
  let back = null;
  const first = kids[0];
  if (first?.node === 'image' && (first.x ?? 0) === 0 && (first.y ?? 0) === 0 && first.w >= 359 && first.h >= 639) {
    back = { ...first };
    const k = TALL_H / first.h;
    back.h = TALL_H; back.w = Math.round(first.w * k); back.x = Math.round((360 - back.w) / 2); back.y = 0;
  }
  const rest = back ? kids.slice(1) : kids;
  p.root = { ...p.root, children: [...(back ? [back] : []), { node: 'group', x: 0, y: dy, children: rest }] };
  // Handlers that read the pointer's y get the old coordinates back.
  walkNodes(p.root, (n) => {
    for (const h of HANDLERS) {
      if (!n[h]?.with) continue;
      for (const [k, v] of Object.entries(n[h].with)) if (typeof v === 'string' && /\bpointer\.y\b/.test(v))n[h].with[k] = v.replace(PTR_Y, `(pointer.y - ${dy})`);
    }
  });
  // Feedback drawn in world coordinates (particles at an event's position) moves with the drawing.
  for (const f of p.feedback ?? []) for (const d of f.do ?? []) if (d.particles && d.particles.y !== undefined) d.particles.y = shiftY(d.particles.y, dy);
  if (p.text_field && typeof p.text_field.y === 'number') p.text_field = { ...p.text_field, y: p.text_field.y + dy };
  return g;
}

const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
function handlers(game, undo) {
  const out = [];
  walkNodes(game?.presentation?.root, (n) => {
    for (const h of HANDLERS) if (n[h]) out.push(`${h}:${stable(n[h])}`.replace(undo ?? /$^/, 'pointer.y'));
  });
  return out.sort();
}

/** {rules, replays, diff, runs} for a lift by `dy`. */
export async function proveLift(original, lifted, { dy = LIFT, runs = null, maxSeconds = 120, engine = null } = {}) {
  const eng = engine ?? (await loadEngine()).engine;
  const diff = [];
  for (const k of new Set([...Object.keys(original), ...Object.keys(lifted)])) if (k !== 'presentation' && stable(original[k]) !== stable(lifted[k])) diff.push(k);
  const undo = new RegExp(`\\(pointer\\.y - ${dy}\\)`, 'g');
  if (handlers(original).join('\n') !== handlers(lifted, undo).join('\n')) diff.push('presentation handlers');
  const ja = JSON.stringify(original), jb = JSON.stringify(lifted);
  const maxSteps = Math.round((maxSeconds * 1000) / DT);
  const list = (runs ?? randomRuns(eng, ja, { maxSeconds: 60 })).filter((r) => r?.replay).map((r) => ({ label: r.bot?.label ?? 'run', seed: r.replay.seed, actions: r.replay.actions ?? [] }));
  list.push({ label: 'idle', seed: list[0]?.seed ?? 1, actions: [] });
  const results = [];
  for (const run of list) {
    const a = eng.load(ja, run.seed), b = eng.load(jb, run.seed);
    let step = 0, k = 0, res = null;
    try {
      while (step < maxSteps && a.phase() === 'playing') {
        let acted = false;
        while (k < run.actions.length && run.actions[k].step === step) {
          const act = run.actions[k].action;
          apply(a, act);
          apply(b, act.kind === 'tap' ? { ...act, y: act.y + dy } : act);
          k++; acted = true;
        }
        a.step(DT); b.step(DT); step++;
        if ((acted || step % 60 === 0) && a.stateHash() !== b.stateHash()) { res = { equal: false, at: step }; break; }
      }
      res ??= { equal: a.stateHash() === b.stateHash() && a.phase() === b.phase(), steps: step };
    } catch (e) { res = { equal: false, error: String(e.message ?? e).slice(0, 160) }; }
    finally { a.dispose(); b.dispose(); }
    results.push({ label: run.label, ...res });
  }
  return { rules: diff.length === 0, diff, replays: results.every((r) => r.equal), runs: results };
}
