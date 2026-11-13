// Shared frame analysis for the verifier's checks: maps each drawn op back to its presentation node
// (layout-check.mjs's rotation tags), gives it a role (backdrop, hud, target, actor, label, shape),
// and maps the engine's hit targets to the nodes that own them (the nearest node with a handler).

import { walkNodes, opBox, textInk, parseColor } from '../playtest/layout-check.mjs';

const TAG_EPS = 1e-5;
export const area = (b) => (b ? Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0) : 0);
export const inter = (a, b) => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
export const iarea = (a, b) => area(inter(a, b));
export const contains = (b, x, y, tol = 0) => x >= b.x0 - tol && x <= b.x1 + tol && y >= b.y0 - tol && y <= b.y1 + tol;
export const rbox = (b) => b && ({ x: +b.x0.toFixed(1), y: +b.y0.toFixed(1), w: +(b.x1 - b.x0).toFixed(1), h: +(b.y1 - b.y0).toFixed(1) });
export const clip = (s) => { s = String(s).replace(/\n/g, ' '); return s.length > 28 ? s.slice(0, 27) + '…' : s; };
const HANDLERS = ['on_tap', 'on_press', 'on_release', 'on_drag'];

export function decodeTag(op, nodes) {
  const v = op.op === 'circle' ? op.r : op.rotation;
  if (typeof v !== 'number' || !nodes) return null;
  const frac = v - Math.round(v);
  const id = Math.round(frac / TAG_EPS);
  if (id <= 0 || Math.abs(frac / TAG_EPS - id) > 0.2) return null;
  const n = nodes[id];
  return n && n.kind === op.op ? n : null;
}

/** Pointer → the pointer of the nearest node at or above it with a tap/press/release/drag handler. */
export function handlerIndex(game) {
  const handlers = new Set();
  walkNodes(game?.presentation?.root, (node, ptr) => { if (HANDLERS.some((h) => node[h]) || node.draggable) handlers.add(ptr); });
  return (n) => (n ? [n.ptr, ...[...n.ancestors].reverse()].find((p) => handlers.has(p)) ?? null : null);
}

/**
 * Per frame: {f, W, H, items: [{op, i, n, box, role, node, handler}], targets: [{box, i, handler, ops}]}.
 * `measures` (key → [{i, widths}]) gives real text widths. Cached on the sample.
 */
export function analyze(sample, game, measures = null) {
  if (sample._scene && sample._sceneMeasures === measures) return sample._scene;
  const { frames, nodes } = sample;
  const handlerOf = handlerIndex(game);
  const hcache = new Map();
  const handler = (n) => { if (!n) return null; if (!hcache.has(n.id)) hcache.set(n.id, handlerOf(n)); return hcache.get(n.id); };
  // Moving nodes: the same node's k-th op changes position between captures of one run.
  const moving = new Set();
  const lastPos = new Map();
  for (const f of frames) {
    const ord = new Map();
    for (const op of f.frame.ops) {
      const n = decodeTag(op, nodes);
      if (!n) continue;
      const k = ord.get(n.id) ?? 0; ord.set(n.id, k + 1);
      const b = opBox(op);
      if (!b) continue;
      const sk = `${f.seed}:${n.id}:${k}`;
      const p = lastPos.get(sk);
      if (p && (Math.abs(p.x0 - b.x0) > 2 || Math.abs(p.y0 - b.y0) > 2)) moving.add(n.id);
      lastPos.set(sk, b);
    }
  }
  const out = frames.map((f) => {
    const fr = f.frame;
    const W = fr.width, H = fr.height;
    const meas = new Map((measures?.[f.key] ?? []).map((m) => [m.i, m]));
    const items = [];
    fr.ops.forEach((op, i) => {
      const n = decodeTag(op, nodes);
      if (!((op.opacity ?? 1) > 0.05) || (op.scale ?? 1) === 0) return;
      let box = op.op === 'text' ? textInk(op, meas.get(i)?.widths ?? null) : opBox(op);
      if (!box) return;
      const cy = (box.y0 + box.y1) / 2;
      let role = 'shape';
      if (op.op !== 'text' && area(box) >= 0.7 * W * H) role = 'backdrop';
      else if (n?.hud && (cy < 0.2 * H || cy > 0.88 * H)) role = 'hud';
      else if (n?.interactive) role = 'target';
      else if (n && moving.has(n.id) && op.op !== 'text') role = 'actor';
      else if (op.op === 'text') role = 'label';
      items.push({ op, i, n, box, role, node: n?.ptr ?? null, handler: handler(n), moving: !!(n && moving.has(n.id)) });
    });
    // Hit targets → owning node: the handler most of the tagged interactive ops inside the box share.
    const targets = (f.targets ?? []).map((t) => {
      const box = { x0: t.x, y0: t.y, x1: t.x + t.w, y1: t.y + t.h };
      const ops = items.filter((it) => it.handler && it.role !== 'backdrop' && iarea(it.box, box) >= 0.5 * Math.max(1, area(it.box)) && contains(box, (it.box.x0 + it.box.x1) / 2, (it.box.y0 + it.box.y1) / 2, 1));
      const votes = new Map();
      for (const it of ops) votes.set(it.handler, (votes.get(it.handler) ?? 0) + area(it.box) + 1);
      const h = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const own = ops.filter((it) => it.handler === h);
      return { box, drag: !!t.drag, handler: h, ops: own, last: own.length ? Math.max(...own.map((o) => o.i)) : -1, first: own.length ? Math.min(...own.map((o) => o.i)) : -1 };
    });
    return { f, W, H, items, targets };
  });
  sample._scene = out;
  sample._sceneMeasures = measures;
  return out;
}

/** Fill alpha × opacity of a shape op (0 for text and lines). */
export function opacityOf(op) {
  if (op.op === 'image') return op.opacity ?? 1;
  if (!['rect', 'circle', 'poly'].includes(op.op)) return 0;
  return (parseColor(op.fill)?.[3] ?? 0) * (op.opacity ?? 1);
}
