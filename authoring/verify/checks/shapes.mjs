// S_STRAY_SHAPE (FC-10 in docs/games/FAILURE_CLASSES.md): a panel, plate or box that doesn't belong
// to the game's look. On the drawn frames, a still, filled or outlined rect (not the backdrop, a tap
// target, a moving sprite, a full-width band or a cell of a board) is a stray shape when:
//   - empty: nothing (text, picture, shape) sits on it in any frame it's drawn in;
//   - off the look: a large opaque panel painted in a literal colour far from the look's surfaces
//     (a cream card in a dark game, a dark card in a light one), so it reads as a different game;
//   - half off: a quarter or more of it lies outside the canvas.
// Fixes (expander/layout-fix.mjs): restyleShapes repaints an off-look panel in $surface (before the
// readability stage, so its words are re-inked against it); hideStrayShapes hides an empty one.

import { finding } from '../registry.mjs';
import { analyze } from '../scene.mjs';
import { normHex, luminance } from '../../expander/ui-style.mjs';

export const STRAY_CODE = 'S_STRAY_SHAPE';

const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const inside = (b, x, y) => x >= b.x0 - 1 && x <= b.x1 + 1 && y >= b.y0 - 1 && y <= b.y1 + 1;
const getAt = (obj, ptr) => ptr.split('/').slice(1).reduce((n, k) => (n == null ? n : n[k.replace(/~1/g, '/').replace(/~0/g, '~')]), obj);
const alphaOf = (c) => {
  if (typeof c === 'number') return (c & 255) / 255;
  if (typeof c !== 'string') return 0;
  const h = c.replace('#', '');
  return h.length === 8 ? parseInt(h.slice(6), 16) / 255 : h.length === 6 || h.length === 3 ? 1 : 0;
};

/** The look's surface family: luminances of its ground tokens. */
function surfaceLums(game) {
  const t = game.presentation?.tokens ?? {};
  return ['surface', 'surface_2', 'bg'].map((k) => normHex(t[k])).filter(Boolean).map((h) => luminance(h));
}

/** Is a literal fill far from every surface of the look? */
export function offLook(game, fill) {
  if (typeof fill !== 'string' || fill.startsWith('$') || fill.startsWith('=')) return false;
  const h = normHex(fill.slice(0, 7));
  if (!h || alphaOf(fill) < 0.85) return false;
  const lums = surfaceLums(game);
  if (!lums.length) return false;
  const l = luminance(h);
  return lums.every((x) => Math.abs(x - l) >= 0.45);
}

export function strayShapes(game, sample, { measures = null } = {}) {
  const scenes = analyze(sample, game, measures);
  const seen = new Map(); // node → {frames, empty, off, box, frame}
  for (const s of scenes) {
    const { items, W, H } = s;
    for (const it of items) {
      if (it.op.op !== 'rect' || !it.node || it.role === 'backdrop' || it.role === 'target' || it.role === 'hud' || it.moving || it.n?.inTemplate) continue;
      const b = it.box;
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      if (w < 40 || h < 24 || w >= 0.9 * W) continue;
      const op = it.op;
      const filled = alphaOf(op.fill) * (op.opacity ?? 1) >= 0.35;
      const stroked = (op.stroke_width ?? 0) >= 2 && alphaOf(op.stroke) * (op.opacity ?? 1) >= 0.35;
      if (!filled && !stroked) continue;
      const holds = items.some((o) => o !== it && o.op.op !== 'clip' && o.op.op !== 'unclip' && o.box && o.role !== 'backdrop' && area(o.box) < area(b) && inside(b, (o.box.x0 + o.box.x1) / 2, (o.box.y0 + o.box.y1) / 2));
      const outside = area(b) - area({ x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(W, b.x1), y1: Math.min(H, b.y1) });
      const node = getAt(game, it.node);
      const prev = seen.get(it.node) ?? { frames: 0, held: 0, off: false, half: false, box: b, frame: s.f.key };
      prev.frames += 1;
      if (holds) prev.held += 1;
      if (filled && area(b) >= 0.08 * W * H && offLook(game, node?.fill)) prev.off = true;
      if (outside >= 0.25 * area(b)) { prev.half = true; prev.frame = s.f.key; prev.box = b; }
      seen.set(it.node, prev);
    }
  }
  const out = [];
  for (const [node, v] of seen) {
    const why = [];
    if (v.held === 0) why.push('empty: nothing sits on it in any frame');
    if (v.off) why.push(`off the look: a literal ${String(getAt(game, node)?.fill)} panel far from the look's surfaces`);
    if (v.half) why.push('half off the canvas');
    if (why.length) out.push({ node, frame: v.frame, frames: v.frames, empty: v.held === 0, off: v.off, half: v.half, message: `a ${Math.round(v.box.x1 - v.box.x0)}×${Math.round(v.box.y1 - v.box.y0)} box: ${why.join('; ')}` });
  }
  return out;
}

export const check = {
  id: 'stray-shapes',
  family: 'S',
  needs: ['frames'],
  codes: {
    [STRAY_CODE]: {
      severity: 'block',
      title: "a panel, plate or box that doesn't belong: empty, painted off the look's surfaces, or half off the canvas",
      hint: "remove an empty box; paint a panel in the look's $surface (with its radius and line); move a box inside the canvas",
    },
  },
  async run(ctx) {
    return strayShapes(ctx.game, ctx.sample, { measures: ctx.measures ?? null })
      .map((f) => finding(STRAY_CODE, { node: f.node, frame: f.frame, frames: f.frames, message: f.message }));
  },
};
