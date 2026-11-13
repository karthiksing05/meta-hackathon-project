// Motion tracks for the verifier's motion checks (checks/motion.mjs) and fixes (motion-fix.mjs).
//
// The layout checks judge still frames. Motion is judged on a contiguous run of frames instead: each
// bot run is replayed (same seed, same inputs) and a frame is taken every `every` steps (3 = 50 ms),
// with no repeats dropped, plus a short tail after the run ends so the end card's arrival is seen.
// From the frames come per-node tracks: for every tagged op (layout-check.mjs's rotation tags) its
// box, scale, opacity and text over time, keyed by node and instance (the k-th op of that node).
//
// What the shell adds on top of the engine's ops is simulated too, because that is what a player
// sees on the phone (FacebookClone/Bubbles/Runtime/web):
//   - shake: the engine reports `shake.px` (decaying to 0 over the action's ms); the shell moves the
//     whole canvas by a random vector that long on every drawn frame (bubble-kit-microgame-engine.js);
//   - toasts: `fx.float` draws each toast at (W/2, 0.28 H) of the 360 × 640 field, 20 pt weight 800,
//     popping from 0.7 scale, rising 46 units a second and fading over 0.9 s, whatever the toast's ms
//     (bubble-runtime.js `fxFloat`). Mapped back to canvas units with the session's fit.

import { loadEngine } from '../expander/engine.mjs';
import { instrument, opBox, textInk, walkNodes } from '../playtest/layout-check.mjs';
import { DT, apply } from '../playtest/bots.mjs';
import { randomRuns, remapTap } from './frames.mjs';
import { decodeTag } from './scene.mjs';

/** The shell's toast and field constants (bubble-runtime.js, bubble-kit-microgame.js). */
export const SHELL = { fieldW: 360, fieldH: 640, toastLifeMs: 900, toastRise: 46, toastSize: 20, toastWeight: 800, toastY: 0.28 };

/** How the shell fits a canvas into its 360 × 640 field: {s, ox, oy} (field = canvas × s + o). */
export function shellFit(W, H) {
  const tall = H * SHELL.fieldW > W * SHELL.fieldH * 1.02;
  const s = tall ? SHELL.fieldW / W : Math.min(SHELL.fieldW / W, SHELL.fieldH / H);
  return { s, ox: (SHELL.fieldW - W * s) / 2, oy: (SHELL.fieldH - H * s) / 2 };
}

/** A toast as drawn `ageMs` after it fired, as a virtual text op in canvas units (null once gone). */
export function toastOp(text, ageMs, W, H) {
  if (ageMs < 0 || ageMs >= SHELL.toastLifeMs) return null;
  const { s, ox, oy } = shellFit(W, H);
  const k = ageMs / SHELL.toastLifeMs;
  const back = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const pop = k < 0.2 ? back(k / 0.2) : 1;
  const sizeField = Math.round(SHELL.toastSize * (0.7 + 0.3 * pop) * 4) / 4;
  const yField = SHELL.fieldH * SHELL.toastY - SHELL.toastRise * (ageMs / 1000);
  const size = sizeField / s;
  const w = [...String(text)].length * size * 0.6 * 1.05;
  const cx = (SHELL.fieldW / 2 - ox) / s, cy = (yField - oy) / s;
  return { op: 'text', virtual: 'toast', text: String(text), size, weight: SHELL.toastWeight, x: cx - w / 2, y: cy - size * 0.625, w, h: size * 1.25, align: 'center', valign: 'middle', scale: 1, opacity: Math.min(1, (1 - k) * 2.2) };
}

const round2 = (v) => Math.round(v * 100) / 100;

/** One frame in compact form: tagged items, the shake amplitude and the toasts fired since the last one. */
function compact(frame, nodes) {
  const items = [];
  const ord = new Map();
  const particleBoxes = [];
  frame.ops.forEach((op, i) => {
    const n = decodeTag(op, nodes);
    // Untagged circles are the engine's feedback particles.
    if (!n) { if (op.op === 'circle' && (op.opacity ?? 1) > 0.2) particleBoxes.push({ x: round2(op.x), y: round2(op.y) }); return; }
    const k = ord.get(n.id) ?? 0;
    ord.set(n.id, k + 1);
    const box = op.op === 'text' ? (op.text ? textInk(op) : null) : opBox(op);
    if (!box) return;
    items.push({
      key: `${n.id}:${k}`, id: n.id, k, i, op: op.op, box: { x0: round2(box.x0), y0: round2(box.y0), x1: round2(box.x1), y1: round2(box.y1) },
      opacity: round2(op.opacity ?? 1), scale: round2(op.scale ?? 1), text: op.op === 'text' ? String(op.text) : null, size: op.size ?? null,
      w: op.w ?? null, h: op.h ?? null, fill: op.fill ?? op.color ?? null,
    });
  });
  const shake = typeof frame.shake === 'number' ? frame.shake : frame.shake?.px ?? frame.shake_px ?? 0;
  return { W: frame.width, H: frame.height, items, particles: particleBoxes.length, particleBoxes, shake: round2(shake), toasts: (frame.toasts ?? []).map((t) => ({ text: String(t.text ?? ''), ms: t.ms ?? null })) };
}

/**
 * Samples motion. opts: {replayCtx (from frames.mjs sampleDense: instrumented json, runs, ref),
 * runs (the gate's runs, when no replayCtx), every (steps between frames, default 3 = 50 ms),
 * maxSeconds (default 60), tailMs (frames after the end, default 1200), engine, nodes}.
 * Returns {every, dtMs, nodes, runs: [{label, idle, frames: [{t, step, items, shake, toasts, phase}], inputs: [t]}]}.
 */
export async function sampleMotion(game, { replayCtx = null, nodes = null, runs = null, every = 3, maxSeconds = 60, tailMs = 1200, engine = null, includeIdle = true } = {}) {
  const eng = engine ?? (await loadEngine()).engine;
  let json, refJson = null, list;
  if (replayCtx && nodes) {
    json = replayCtx.json; refJson = replayCtx.refJson; list = replayCtx.runs;
  } else {
    const inst = instrument(typeof game === 'string' ? JSON.parse(game) : game);
    nodes = inst.nodes;
    json = JSON.stringify(inst.game);
    try { eng.load(json, 1).dispose(); } catch { json = typeof game === 'string' ? game : JSON.stringify(game); nodes = [null]; }
    const theRuns = runs ?? randomRuns(eng, json, { maxSeconds: Math.min(maxSeconds, 60) });
    list = theRuns.filter((r) => r?.replay).map((r, i) => ({ label: r.bot?.label ?? `run ${i + 1}`, seed: r.replay.seed, actions: r.replay.actions ?? [], idle: false }));
    list.push({ label: 'idle', seed: list[0]?.seed ?? 1, actions: [], idle: true });
  }
  const maxSteps = Math.round((maxSeconds * 1000) / DT);
  const tailSteps = Math.round(tailMs / DT);
  const out = [];
  for (const run of list) {
    if (run.idle && !includeIdle) continue;
    const g = eng.load(json, run.seed);
    const r = refJson ? eng.load(refJson, run.seed) : null;
    const frames = [];
    const inputs = [];
    let step = 0, k = 0, endAt = null;
    let carry = []; // toasts drained by a remapping frame() call before a tap
    const capture = () => {
      const f = compact(g.frameJSON(), nodes);
      if (carry.length) { f.toasts = [...carry, ...f.toasts]; carry = []; }
      frames.push({ t: Math.round(step * DT), step, phase: g.phase(), ...f });
    };
    try {
      while (step < maxSteps + tailSteps) {
        const playing = g.phase() === 'playing';
        if (!playing && endAt == null) endAt = step;
        if (endAt != null && step - endAt >= tailSteps) break;
        if (playing && step >= maxSteps) break;
        while (playing && k < run.actions.length && run.actions[k].step === step) {
          let a = run.actions[k].action;
          if (r) {
            if (a.kind === 'tap') { r.frame(); carry.push(...(g.frameJSON().toasts ?? []).map((t) => ({ text: String(t.text ?? ''), ms: t.ms ?? null }))); a = remapTap(a, r.hitTargets(), g.hitTargets()); }
            apply(r, run.actions[k].action);
          }
          apply(g, a);
          inputs.push(Math.round(step * DT));
          k++;
        }
        g.step(DT);
        if (playing) r?.step(DT);
        step++;
        if (step % every === 0 || (endAt == null && g.phase() !== 'playing')) capture();
      }
    } catch (e) {
      frames.push({ error: String(e?.message ?? e).slice(0, 160) });
    } finally { g.dispose(); r?.dispose(); }
    out.push({ label: run.label, idle: !!run.idle, frames: frames.filter((f) => !f.error), inputs, endAt: endAt == null ? null : Math.round(endAt * DT) });
  }
  // Toasts as virtual items in every frame they are on screen.
  for (const run of out) {
    const live = [];
    run.frames.forEach((f, fi) => {
      for (const t of f.toasts) live.push({ text: t.text, at: f.t, id: `toast:${fi}:${live.length}` });
      f.virtual = [];
      for (const t of live) {
        const op = toastOp(t.text, f.t - t.at, f.W, f.H);
        if (op) f.virtual.push({ key: t.id, id: t.id, op: 'text', virtual: 'toast', text: t.text, box: textInk(op), opacity: round2(op.opacity), scale: 1, size: op.size, born: t.at });
      }
    });
  }
  return { every, dtMs: every * DT, nodes, runs: out };
}

/**
 * Tracks per run: Map key → [{fi, t, ...item}] (only frames where the item is drawn), plus each
 * track's node info. Virtual toast items get their own tracks.
 */
export function tracksOf(run) {
  const tracks = new Map();
  run.frames.forEach((f, fi) => {
    for (const it of [...f.items, ...(f.virtual ?? [])]) {
      let tr = tracks.get(it.key);
      if (!tr) tracks.set(it.key, (tr = []));
      tr.push({ fi, t: f.t, ...it });
    }
  });
  return tracks;
}

/** A box's center. */
export const center = (b) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });

/** Presentation nodes by pointer, with their parents (for fixes): Map ptr → {node, parents: [{node, ptr}]}. */
export function nodeIndex(game) {
  const idx = new Map();
  walkNodes(game?.presentation?.root, (node, ptr, parents) => idx.set(ptr, { node, parents }));
  return idx;
}
