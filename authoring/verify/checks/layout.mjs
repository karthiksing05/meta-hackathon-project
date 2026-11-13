// Text and overlap checks on every sampled frame: layout-check.mjs's L_* lint (text overflow,
// clipping, text over text, sprites over the HUD, contrast, blank labels, consistency) at the
// verifier's blocking policy, plus L_TEXT_ON_SPRITE (a text box crossing a sprite). Tap-target codes
// come from checks/targets.mjs, which maps each target to its node.

import { lintSample, HINTS } from '../../playtest/layout-check.mjs';
import { finding } from '../registry.mjs';
import { analyze, area, inter, iarea, rbox, clip, opacityOf } from '../scene.mjs';

export const MIN_CONTRAST = 3;

const LINT_CODES = {
  L_TEXT_OVERFLOW: { severity: 'block', title: 'text sticks out of its tile or button' },
  L_TEXT_OFFCENTER: { severity: 'block', title: "a cell label anchored on its tile's edge" },
  L_TEXT_CLIPPED: { severity: 'block', title: 'text runs off the canvas' },
  L_OVERLAP_TEXT: { severity: 'block', title: 'text over text' },
  L_OVERLAP_HUD: { severity: 'block', title: 'a moving sprite and the HUD overlap' },
  L_LOW_CONTRAST: { severity: 'block', title: `text under ${MIN_CONTRAST}:1 against what is behind it (block); under 4.5:1 for small text (warn)` },
  L_EMPTY_LABEL: { severity: 'block', title: 'a key or tile with no visible label while its siblings have one' },
  L_TEXT_SMALL: { severity: 'warn', title: 'text under 11 units (≈ 12 pt)' },
  L_OVERLAP_CONTROL: { severity: 'warn', title: 'a moving sprite covers a button' },
  L_OVERLAP_SPRITES: { severity: 'warn', title: 'sprites overlap at the start' },
  L_INCONSISTENT: { severity: 'warn', title: 'instances of one repeated component drawn differently' },
};
// The lint's own target codes are replaced by checks/targets.mjs (node-mapped, stricter gap).
const DROPPED = new Set(['L_TARGET_SMALL', 'L_TARGET_GAP', 'L_OVERLAP_TARGETS', 'L_OFFSCREEN']);

const codes = {};
for (const [k, v] of Object.entries(LINT_CODES)) codes[k] = { ...v, hint: HINTS[k] };
codes.L_TEXT_ON_SPRITE = { severity: 'block', title: 'a text box crosses a sprite it is not written on', hint: 'move the text off the sprite (or the sprite off the text), or put the text on a solid plate drawn over it' };

/** The lint's severity → the verifier's. */
function severityOf(f) {
  if (f.code === 'L_LOW_CONTRAST') return (f.contrast ?? 0) < MIN_CONTRAST ? 'block' : 'warn';
  return codes[f.code]?.severity ?? 'warn';
}

function textOnSprite(scenes, add) {
  for (const s of scenes) {
    const { items, W, H } = s;
    const texts = items.filter((it) => it.op.op === 'text' && String(it.op.text).trim() && it.role !== 'hud');
    const sprites = items.filter((it) => (it.op.op === 'image' || it.role === 'actor') && it.role !== 'backdrop' && it.role !== 'hud' && area(it.box) < 0.35 * W * H);
    const opaqueBetween = (lo, hi, region) => items.some((it) => it.i > lo && it.i < hi && it.op.op === 'rect' && opacityOf(it.op) > 0.85 && iarea(it.box, region) >= 0.9 * area(region));
    for (const t of texts) {
      const ta = area(t.box);
      if (ta < 4) continue;
      // A label that rides on its own sprite (a badge on a moving piece) is part of that sprite.
      if (t.moving && t.n && items.some((x) => x !== t && x.n && x.n.parentPtr === t.n.parentPtr && x.op.op === 'image')) continue;
      const plate = items.find((it) => it.i === t.i - 1 && it.op.op === 'rect' && it.n && t.n && it.n.parentPtr === t.n.parentPtr);
      for (const sp of sprites) {
        if (sp.handler && sp.handler === t.handler) continue; // the label of a button drawn as a sprite
        // Another instance of the same badge (two popups stacked): opaque plates over plates, read as a pile.
        if (plate && sp !== plate && sp.n?.ptr === plate.n.ptr && opacityOf(sp.op) > 0.85) continue;
        if (sp.n && t.n && (sp.n.parentPtr === t.n.parentPtr || t.n.ancestors.includes(sp.n.parentPtr))) {
          // A sprite beside the text in its own group is its card/tile art: only a partial cross counts.
          if (iarea(t.box, sp.box) >= 0.85 * ta) continue;
        }
        const ia = iarea(t.box, sp.box);
        if (ia < Math.max(6, 0.15 * ta)) continue;
        if (ia >= 0.85 * ta && sp.i < t.i && !sp.moving) continue; // text written on the sprite
        if (ia >= 0.85 * ta && sp.i > t.i && !sp.moving) continue; // text hidden under a picture drawn over it (an overlay): not seen
        const r = inter(t.box, sp.box);
        if (opaqueBetween(Math.min(t.i, sp.i), Math.max(t.i, sp.i), r) && t.i > sp.i) continue;
        add(finding('L_TEXT_ON_SPRITE', {
          node: t.node, other: sp.node, frame: s.f.key, role: t.role, box: rbox(r),
          message: `"${clip(t.op.text)}" is crossed by a ${sp.moving ? 'moving ' : ''}${sp.op.op} (${Math.round((100 * ia) / ta)}% of the text)`,
        }), `${t.node ?? t.op.text}~${sp.node ?? 'untagged'}`);
      }
    }
  }
}

const canvasArea = (ctx) => (ctx.game?.presentation?.canvas?.w ?? 360) * (ctx.game?.presentation?.canvas?.h ?? 640);

export const check = {
  id: 'layout',
  family: 'L',
  needs: ['frames'],
  codes,
  run(ctx) {
    const out = new Map();
    const add = (f, key) => { const k = `${f.code}|${key}`; const p = out.get(k); if (p) p.frames++; else out.set(k, { ...f, frames: 1 }); };
    for (const f of lintSample(ctx.sample, { measures: ctx.measures })) {
      if (DROPPED.has(f.code)) continue;
      // A tall lane or a big region is a place to tap, not a key that needs a label (hand-check:
      // rhythm lanes with their names under them were the lint's false positives).
      if (f.code === 'L_EMPTY_LABEL' && f.box && f.box.w * f.box.h > 0.06 * canvasArea(ctx)) continue;
      const { code, severity: _s, detail, hint, frame, node, frames, ...extra } = f;
      out.set(`${code}|lint|${node ?? JSON.stringify(f.box)}|${f.other ?? ''}`, { ...finding(code, { severity: severityOf(f), node, frame, message: detail, hint, ...extra }), frames });
    }
    textOnSprite(analyze(ctx.sample, ctx.game, ctx.measures), add);
    return [...out.values()];
  },
};
