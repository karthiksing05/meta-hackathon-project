// Tap-target checks on every sampled frame, with each hit target mapped to the node that owns it:
// size (44 pt), spacing (8 pt), overlap, off-screen, and taps that pass through something drawn on
// top (an end panel or overlay with no handler of its own sits over a live button or board: the
// engine routes the tap to the topmost *target*, so it reaches the covered node).

import { finding } from '../registry.mjs';
import { getAt } from '../../expander/layout-fix.mjs';
import { analyze, area, inter, iarea, rbox, opacityOf } from '../scene.mjs';

// 360 canvas units are drawn about 390 pt wide on a phone (1.083 pt per unit).
export const PT = 390 / 360;
export const MIN_TARGET = 40; // 44 pt (40.6 units, rounded down: the lint's long-standing value)
export const MIN_GAP = 7;     // 8 pt (7.4 units, rounded down)

export const codes = {
  L_TARGET_SMALL: { severity: 'block', title: 'a tap target under 44 pt', hint: `make tap targets at least ${MIN_TARGET} units (44 pt) on each side` },
  L_TARGET_GAP: { severity: 'block', title: 'tap targets closer than 8 pt', hint: `leave at least ${MIN_GAP} units (8 pt) between tap targets` },
  L_OVERLAP_TARGETS: { severity: 'block', title: 'two tap targets overlap', hint: 'move them apart so each tap has one owner' },
  L_OFFSCREEN: { severity: 'block', title: 'a tap target is mostly off the canvas', hint: 'move the target inside the canvas' },
  L_TAP_THROUGH: { severity: 'block', title: 'a tap on an overlay or end panel reaches a live target underneath', hint: 'hide the covered targets while the overlay shows (visible: not <overlay shown>), or give the overlay its own tap handler' },
};

const big = (b, W, H) => area(b) >= 0.5 * W * H;
const akCache = new WeakMap();
/** What a tap on the handler node does (its handler props), as a string; null for an unknown node. */
function actionKey(game, ptr) {
  if (!ptr) return null;
  let m = akCache.get(game);
  if (!m) { m = new Map(); akCache.set(game, m); }
  if (!m.has(ptr)) {
    const n = getAt(game, ptr);
    m.set(ptr, n ? JSON.stringify(['on_tap', 'on_press', 'on_release', 'on_drag'].map((h) => n[h] ?? null)) : null);
  }
  return m.get(ptr);
}

export const check = {
  id: 'targets',
  family: 'L',
  needs: ['frames'],
  codes,
  async run(ctx) {
    const scenes = analyze(ctx.sample, ctx.game, ctx.measures);
    const out = new Map();
    const add = (f, key) => { const k = `${f.code}|${key}`; const p = out.get(k); if (p) p.frames++; else out.set(k, { ...f, frames: 1 }); };
    const through = [];
    for (const s of scenes) {
      const { W, H, items } = s;
      // A target inside a bigger one that does the same thing (a label with its card's on_tap) adds
      // no new place to tap: only the outer one is checked.
      const act = (t) => actionKey(ctx.game, t.handler);
      const nested = (t) => s.targets.some((o) => o !== t && area(o.box) > area(t.box) && iarea(o.box, t.box) >= 0.9 * area(t.box) && act(o) && act(o) === act(t));
      const tg = s.targets.filter((t) => area(t.box) > 0 && !big(t.box, W, H) && !nested(t));
      for (const t of tg) {
        const w = t.box.x1 - t.box.x0, h = t.box.y1 - t.box.y0;
        const id = t.handler ?? `${Math.round(w / 8)}x${Math.round(h / 8)}`;
        if (Math.min(w, h) < MIN_TARGET - 0.5) add(finding('L_TARGET_SMALL', { node: t.handler, frame: s.f.key, box: rbox(t.box), message: `${w.toFixed(0)}×${h.toFixed(0)} target (${(w * PT).toFixed(0)}×${(h * PT).toFixed(0)} pt)` }), id);
        const outside = area(t.box) - iarea(t.box, { x0: 0, y0: 0, x1: W, y1: H });
        if (outside > 0.25 * area(t.box)) add(finding('L_OFFSCREEN', { node: t.handler, frame: s.f.key, box: rbox(t.box), message: `${Math.round((100 * outside) / area(t.box))}% of a tap target is off the canvas` }), id);
      }
      for (let a = 0; a < tg.length; a++) for (let b = a + 1; b < tg.length; b++) {
        const A = tg[a], B = tg[b];
        const ia = iarea(A.box, B.box), small = Math.min(area(A.box), area(B.box));
        const pair = [A.handler ?? 'target', B.handler ?? 'target'].sort().join('~');
        if (act(A) && act(A) === act(B) && A.handler !== B.handler) continue; // two parts of one button
        if (ia > 1 && ia < 0.9 * small) {
          add(finding('L_OVERLAP_TARGETS', { node: B.handler, other: A.handler, frame: s.f.key, box: rbox(inter(A.box, B.box)), message: `two tap targets overlap (${rbox(A.box).w}×${rbox(A.box).h} and ${rbox(B.box).w}×${rbox(B.box).h})` }), pair);
        } else if (ia <= 1) {
          const gx = Math.max(A.box.x0 - B.box.x1, B.box.x0 - A.box.x1), gy = Math.max(A.box.y0 - B.box.y1, B.box.y0 - A.box.y1);
          const gap = gx >= -1 && gy < 0 ? gx : gy >= -1 && gx < 0 ? gy : Infinity;
          if (gap < MIN_GAP - 0.25) add(finding('L_TARGET_GAP', { node: A.handler, other: B.handler, frame: s.f.key, box: rbox(A.box), gap: +Math.max(0, gap).toFixed(1), message: `${Math.max(0, gap).toFixed(1)} units (${(Math.max(0, gap) * PT).toFixed(1)} pt) between tap targets` }), pair);
        }
      }
      // Tap-through: something with no handler, drawn after the target, opaque, covering most of it.
      for (const t of s.targets) {
        if (t.last < 0) continue;
        const ta = area(t.box);
        const covers = items.filter((it) => it.i > t.last && !it.handler && ['rect', 'image', 'poly'].includes(it.op.op) && opacityOf(it.op) >= 0.85 && it.role !== 'actor');
        // The covered part: the largest single cover, or the union area of covers (bounded).
        let covered = 0;
        let cover = null;
        for (const c of covers) { const ia = iarea(c.box, t.box); if (ia > covered) { covered = ia; cover = c; } }
        if (!cover || covered < 0.6 * ta) continue;
        // Pick the point to probe: the covered target's center when it's under the cover.
        const cx = (t.box.x0 + t.box.x1) / 2, cy = (t.box.y0 + t.box.y1) / 2;
        const r = inter(cover.box, t.box);
        const px = cx >= r.x0 && cx <= r.x1 ? cx : (r.x0 + r.x1) / 2, py = cy >= r.y0 && cy <= r.y1 ? cy : (r.y0 + r.y1) / 2;
        through.push({ s, t, cover, px, py, frac: covered / ta });
      }
    }
    // Only a tap that would change the game's state counts: probe it on the game at that frame.
    const probed = new Map();
    for (const x of through) {
      const key = `${x.t.handler}|${x.cover.node ?? x.cover.i}`;
      if (probed.get(key) === true) { out.get(`L_TAP_THROUGH|${key}`).frames++; continue; }
      if ((probed.get(key) ?? 0) >= 4) continue; // dead on 4 frames: a finished game, not a leak
      let live = null;
      if (ctx.probeTap) live = await ctx.probeTap(x.s.f, x.px, x.py);
      if (live === false) { probed.set(key, (probed.get(key) ?? 0) + 1); continue; }
      probed.set(key, true);
      add(finding('L_TAP_THROUGH', {
        node: x.t.handler, other: x.cover.node, frame: x.s.f.key, box: rbox(x.t.box), cover_box: rbox(x.cover.box), live,
        message: `a tap on the ${x.cover.op.op} drawn over this target (${Math.round(x.frac * 100)}% covered) still reaches it${live == null ? ' (liveness not probed)' : ' and changes the game'}`,
      }), key);
    }
    return [...out.values()];
  },
};
