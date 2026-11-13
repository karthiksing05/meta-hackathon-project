// Text fitting for the game UI kit (authoring/UI_KIT.md): text never overflows its box.
//
// Order: shrink one type step at a time down to the minimum step, then wrap, then ellipsize.
// Static text is fitted exactly, with a port of the engine's own measurement and wrapping
// (engine/crates/mg-scene/src/text.rs: 0.6 em a character, ×1.05 bold, 1.25 em lines). Text that
// is an expression is fitted at run time with an expression the kit writes: a size picked from
// the string's length and a cut with "…" at the minimum step's capacity.
//
// Pure JS, deterministic.

import { TYPE, TYPE_SIZES, MIN_TEXT, GRID } from './ui-style.mjs';

export const CHAR_EM = 0.6;
export const BOLD = 1.05;
export const LINE_EM = 1.25;
/** Real fonts run wider than the engine's estimate (capitals, wide faces): leave this much room. */
export const WIDTH_SAFETY = 0.92;
/** Greedy wrapping wastes part of each line; capacity estimates for run-time text assume this fill. */
export const WRAP_FILL = 0.8;
const ELLIPSIS = '…';

export const charWidth = (size, weight = 400) => size * CHAR_EM * (weight >= 600 ? BOLD : 1);
export const lineHeight = (size) => size * LINE_EM;
/** Line height rounded up to the grid, for laying out boxes. */
export const lineBox = (size, lines = 1) => Math.ceil((lineHeight(size) * lines) / GRID) * GRID;

/** The engine's wrap_text, ported: returns the lines. */
export function wrapLines(text, w, size, weight = 400) {
  const cw = charWidth(size, weight);
  const max = cw > 0 && Number.isFinite(w) ? Math.max(1, Math.floor(w / cw + 1e-9)) : Infinity;
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    let len = 0;
    let started = false;
    let spaces = 0;
    for (const word of para.split(' ')) {
      if (!word) { spaces++; continue; }
      let chars = [...word];
      const sep = started ? spaces + 1 : spaces;
      spaces = 0;
      if (len + sep + chars.length <= max) {
        line += ' '.repeat(sep) + word;
        len += sep + chars.length;
        started = true;
        continue;
      }
      if (started) { out.push(line); line = ''; len = 0; }
      while (chars.length > max) { out.push(chars.slice(0, max).join('')); chars = chars.slice(max); }
      line = chars.join('');
      len = chars.length;
      started = true;
    }
    out.push(line);
  }
  return out;
}

/** Type steps from `size` down to `min`, on the scale. */
export function stepsFrom(size, min = MIN_TEXT) {
  const s = TYPE_SIZES.filter((t) => t <= size && t >= min).sort((a, b) => b - a);
  return s.length ? s : [min];
}

/**
 * Fits a static string into a w × h box. Returns { text, size, lines, cut } where `text` may have
 * been ellipsized (cut = true) at the minimum size.
 */
export function fitStatic(text, { w, h, size, weight = 400, min = MIN_TEXT, maxLines = Infinity, prefer = 'wrap' }) {
  const wEff = w * WIDTH_SAFETY;
  // Short labels (tiles, buttons, chips): one line, shrinking, before any wrapping.
  if (prefer === 'line') {
    for (const s of stepsFrom(size, min)) if (wrapLines(text, wEff, s, weight).length === 1 && lineHeight(s) <= h + 0.01) return { text: String(text), size: s, lines: 1, cut: false };
  }
  for (const s of stepsFrom(size, min)) {
    const lines = wrapLines(text, wEff, s, weight);
    const allowed = Math.min(maxLines, Math.max(1, Math.floor((h + 0.01) / lineHeight(s))));
    if (lines.length <= allowed) return { text: String(text), size: s, lines: lines.length, cut: false };
  }
  // Ellipsize at the minimum step: keep whole words while the result fits.
  const s = stepsFrom(size, min).at(-1);
  const allowed = Math.min(maxLines, Math.max(1, Math.floor((h + 0.01) / lineHeight(s))));
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
  let best = '';
  for (let n = 1; n <= words.length; n++) {
    const cand = words.slice(0, n).join(' ') + ELLIPSIS;
    if (wrapLines(cand, wEff, s, weight).length <= allowed) best = cand; else break;
  }
  if (!best) {
    // One long word: cut by characters.
    const perLine = Math.max(1, Math.floor(wEff / charWidth(s, weight)));
    best = [...String(text)].slice(0, Math.max(1, perLine * allowed - 1)).join('') + ELLIPSIS;
  }
  return { text: best, size: s, lines: allowed, cut: true };
}

/** How many characters fit in a w × h box at `size` (an estimate for run-time text). */
export function capacity(w, h, size, weight = 400) {
  const perLine = Math.max(1, Math.floor((w * WIDTH_SAFETY) / charWidth(size, weight)));
  const lines = Math.max(1, Math.floor((h + 0.01) / lineHeight(size)));
  return lines === 1 ? perLine : Math.max(perLine, Math.floor(perLine * lines * WRAP_FILL));
}

/**
 * Run-time fitting for an expression `expr` (without the leading '='): returns { size, text } as
 * engine expressions ('= …'). The size steps down the scale as the string gets longer; past the
 * minimum step's capacity the text is cut with "…".
 */
export function fitDynamic(expr, { w, h, size, weight = 400, min = MIN_TEXT, prefer = 'wrap' }) {
  let steps = stepsFrom(size, min);
  let caps = steps.map((s) => capacity(w, h, s, weight));
  if (prefer === 'line') {
    // One line at each step first, then the wrapped capacities that are larger still.
    const single = steps.map((s) => Math.max(1, Math.floor((w * WIDTH_SAFETY) / charWidth(s, weight))));
    const pairs = steps.map((s, i) => [s, single[i]]);
    for (let i = 0; i < steps.length; i++) if (caps[i] > pairs.at(-1)[1]) pairs.push([steps[i], caps[i]]);
    steps = pairs.map((p) => p[0]);
    caps = pairs.map((p) => p[1]);
  }
  const e = `(${expr})`;
  const n = `len(${e})`;
  let sizeExpr = String(steps.at(-1));
  for (let i = steps.length - 2; i >= 0; i--) sizeExpr = `if ${n} <= ${caps[i]} then ${steps[i]} else ${sizeExpr}`;
  const cap = caps.at(-1);
  const textExpr = `if ${n} <= ${cap} then ${e} else substr(${e}, 0, ${Math.max(1, cap - 1)}) + '${ELLIPSIS}'`;
  return { size: steps.length > 1 ? `= ${sizeExpr}` : steps[0], text: `= ${textExpr}`, caps };
}

const isExpr = (v) => typeof v === 'string' && v.startsWith('=');

/**
 * A text node that fits its box: static or expression text, any type step.
 * `box` is {x, y, w, h} relative to the parent. `step` is a TYPE name or a size.
 */
export function fitTextNode(text, box, { step = 'body', min = MIN_TEXT, weight, color = '$ink', align = 'center', valign = 'middle', maxLines, prefer = 'wrap', extra = {} } = {}) {
  const base = typeof step === 'number' ? { size: step, weight: weight ?? 600 } : TYPE[step] ?? TYPE.body;
  const wt = weight ?? base.weight;
  const w = Math.max(GRID, box.w);
  const h = Math.max(lineHeight(min), box.h);
  // The engine wraps at the node's w; give it the safety margin so real glyphs stay inside.
  const tw = Math.floor(w * WIDTH_SAFETY);
  const tx = box.x + Math.floor((w - tw) / 2);
  const node = { node: 'text', x: tx, y: box.y, w: tw, h, align, valign, wrap: true, weight: wt, color, ...extra };
  if (isExpr(text)) {
    const f = fitDynamic(text.slice(1).trim(), { w, h, size: base.size, weight: wt, min, prefer });
    node.size = f.size;
    node.text = f.text;
  } else {
    const f = fitStatic(String(text ?? ''), { w, h, size: base.size, weight: wt, min, maxLines, prefer });
    node.size = f.size;
    node.text = f.text;
  }
  return node;
}
