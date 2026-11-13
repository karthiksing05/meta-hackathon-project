// Readability: is every word legible against what's actually behind it? Deterministic and
// Chrome-free: frames are composited in JS (raster.mjs: shapes, PNG/JPEG pictures, SVG sprites)
// with the text left out, and each text op is measured against the pixels under its ink box.
//
//   readabilityFindings(game, sample, {measures, inflate})  → findings per node (S_READABILITY)
//   readabilityFix(game, findings, {spec})                  → {game, fixes}
//
// A text op fails when the 10th-percentile contrast over its box (WCAG, text colour composited at
// its opacity against each pixel) is under 4.5:1 for small text or 3:1 for large text (size ≥ 22,
// or bold ≥ 700 at 18.5+), or when small text sits on a busy background (luminance spread) without
// an outline. A text outline of 2+ units that contrasts with the fill counts as the text's ground.
//
// The fix, in order: (1) a text colour from the game's own palette that passes everywhere the node
// failed; (2) the look's treatment: an outline for display text, a soft plate (a palette colour at
// 85 %, the look's corner radius) behind body text, the same style for every node of a role;
// (3) a solid plate. Never a new hue, never neon. Presentation only.

import { compositeFrame, assetBitmaps, pixelsIn, engineColor } from './raster.mjs';
import { normHex, contrast, luminance } from '../expander/ui-style.mjs';
import { isNeon, stepOf } from './look.mjs';
import { analyze } from '../verify/scene.mjs';

export const READABILITY_CODE = 'S_READABILITY';
export const P_WORST = 0.1;
export const BUSY_SPREAD = 0.13;
export const MAX_FRAMES = 36;

const lumRGB = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (la, lb) => (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);

/** Needed contrast for a text op or node: 3 for large text, 4.5 otherwise. */
export function needFor(size, weight) {
  return size >= 22 || ((weight ?? 400) >= 700 && size >= 18.5) ? 3 : 4.5;
}

/**
 * The legibility of text colour `rgb` (opacity `alpha`) over `pixels`: {p10, spread}.
 * With an outline (`outline` rgb, width ≥ 2) the outline is the ground the glyphs sit on.
 */
export function legibility(rgb, pixels, { alpha = 1, outline = null } = {}) {
  if (!pixels.length) return { p10: 21, spread: 0 };
  const vals = new Float64Array(pixels.length);
  let sum = 0, sum2 = 0;
  for (let i = 0; i < pixels.length; i++) {
    const [r, g, b] = pixels[i];
    const lp = lumRGB(r, g, b);
    const lt = lumRGB(rgb[0] * alpha + r * (1 - alpha), rgb[1] * alpha + g * (1 - alpha), rgb[2] * alpha + b * (1 - alpha));
    vals[i] = ratio(lt, lp);
    sum += lp; sum2 += lp * lp;
  }
  vals.sort();
  let p10 = vals[Math.floor(pixels.length * P_WORST)];
  const mean = sum / pixels.length;
  const spread = Math.sqrt(Math.max(0, sum2 / pixels.length - mean * mean));
  if (outline) p10 = Math.max(p10, ratio(lumRGB(...rgb), lumRGB(...outline)));
  return { p10, spread };
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Engine frames carry resolved colours: '#RRGGBB[AA]' strings or u32. */
function opRGBA(c) { return engineColor(c); }

/** Up to MAX_FRAMES frames: every intro and end frame, the rest spread evenly. */
export function pickFrames(frames, max = MAX_FRAMES) {
  const key = frames.filter((f) => f.label !== 'play');
  const play = frames.filter((f) => f.label === 'play');
  const room = Math.max(0, max - key.length);
  const spread = play.length <= room ? play : Array.from({ length: room }, (_, k) => play[Math.floor((k * play.length) / room)]);
  return [...key.slice(0, max), ...spread];
}

/**
 * S_READABILITY findings for a game. sample: verify/frames.mjs sampleDense output; measures:
 * optional Chrome widths (verify's measureFrames). inflate: zlib inflate for PNG pictures.
 * Returns [{code, severity, node, frame, frames, message, p10, need, size, busy, pixels (a sample
 * of the worst backgrounds), color, text}].
 */
export function readabilityFindings(game, sample, { measures = null, inflate = null, maxFrames = MAX_FRAMES } = {}) {
  const scene = analyze(sample, game, measures);
  const picked = new Set(pickFrames(sample.frames, maxFrames).map((f) => f.key));
  const ids = (sample.assets ?? []).map((a) => a.name ?? a.id);
  const bitmaps = assetBitmaps(game, { inflate });
  const byNode = new Map();
  const inkMax = new Map(); // node → widest and tallest ink box seen in any frame
  const seen = new Map(); // node → a sample of its backgrounds in every frame, failing or not
  const states = new Map(); // node → {piece fill as #RRGGBB, or 'clear' when see-through: backgrounds in those frames}
  const pieces = new Map();
  const pieceFor = (ptr) => { if (!pieces.has(ptr)) pieces.set(ptr, pieceOf(game, ptr)?.ptr ?? null); return pieces.get(ptr); };
  for (const s of scene) {
    if (!picked.has(s.f.key)) continue;
    const texts = s.items.filter((it) => it.op.op === 'text' && it.op.text && String(it.op.text).trim());
    if (!texts.length) continue;
    const r = compositeFrame(s.f.frame, bitmaps, { assetIds: ids });
    for (const it of texts) {
      const op = it.op;
      const fill = opRGBA(op.color);
      if (!fill) continue;
      const sw = op.stroke_width ?? 0;
      const st = sw >= 2 ? opRGBA(op.stroke) : null;
      let box = it.box;
      // Text half under an opaque shape drawn after it (an end card over the play screen, a newer
      // badge on an older one) is hidden, not hard to read: the composite left it out with its cover on.
      const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
      const cover = (b) => area({ x0: Math.max(b.x0, box.x0), y0: Math.max(b.y0, box.y0), x1: Math.min(b.x1, box.x1), y1: Math.min(b.y1, box.y1) });
      if (s.items.some((o) => o.i > it.i && ((o.op.op === 'rect' && (opRGBA(o.op.fill)?.[3] ?? 0) * (o.op.opacity ?? 1) > 0.85) || (o.op.op === 'image' && (o.op.opacity ?? 1) > 0.95 && o.role !== 'actor')) && cover(o.box) >= 0.5 * area(box))) continue;
      // Text under a scrim drawn after it (a dimmed play screen behind an end card or a pause) is
      // put back on purpose: it isn't there to be read.
      const W = s.f.frame?.width ?? 360, H = s.f.frame?.height ?? 640;
      if (s.items.some((o) => o.i > it.i && o.op.op === 'rect' && (opRGBA(o.op.fill)?.[3] ?? 0) * (o.op.opacity ?? 1) >= 0.3 && area(o.box) >= 0.25 * W * H && cover(o.box) >= 0.5 * area(box))) continue;
      // Something small drawn over the words (particles, a sprite passing): a moment, and the
      // layout checks' business (L_TEXT_ON_SPRITE), not the text's ground.
      if (s.items.some((o) => o.i > it.i && o.op.op !== 'text' && o.box && cover(o.box) > 0 && area(o.box) < area(box))) continue;
      // An opaque cover across the whole width over the top or bottom of the box (the edge of a
      // card): measure the lines still showing.
      for (const o of s.items) {
        if (o.i <= it.i || !o.box || o.op.op !== 'rect' || (opRGBA(o.op.fill)?.[3] ?? 0) * (o.op.opacity ?? 1) <= 0.85) continue;
        if (o.box.x0 > box.x0 || o.box.x1 < box.x1 || o.box.y1 <= box.y0 || o.box.y0 >= box.y1) continue;
        if (o.box.y0 <= box.y0) box = { ...box, y0: o.box.y1 };
        else if (o.box.y1 >= box.y1) box = { ...box, y1: o.box.y0 };
      }
      if (box.y1 - box.y0 < 0.3 * (it.box.y1 - it.box.y0)) continue;
      const px = pixelsIn(r, box, box.x1 - box.x0 > 160 ? 2 : 1);
      if (!px.length) continue;
      // A fade in or out (the op is fainter than its node's own opacity) is a moment, not the look.
      const own = it.node ? getAt(game, it.node)?.opacity : undefined;
      const staticOpacity = typeof own === 'number' ? own : 1;
      if ((op.opacity ?? 1) < staticOpacity - 0.02) continue;
      const alpha = Math.min(1, (op.opacity ?? 1) * fill[3]);
      const outline = st && ratio(lumRGB(...fill), lumRGB(...st)) >= 3 ? st.slice(0, 3) : null;
      const { p10, spread } = legibility(fill.slice(0, 3), px, { alpha, outline });
      const need = needFor(op.size, op.weight);
      const busy = !outline && op.size < 22 && spread > BUSY_SPREAD && p10 < 7;
      if (it.node && pieceFor(it.node)) {
        const pp = pieceFor(it.node);
        let po = null;
        for (const o of s.items) { if (o.i >= it.i) break; if (o.node === pp && o.i >= it.i - 3) po = o; }
        const pf = po ? opRGBA(po.op.fill) : [0, 0, 0, 0]; // no op: the engine leaves out a see-through shape
        {
          const key = !po || pf[3] * (po.op.opacity ?? 1) < 0.5 ? 'clear' : rgbHex(pf.slice(0, 3));
          const m = states.get(it.node) ?? {};
          const b = (m[key] ??= []);
          if (b.length < 2400) for (let i = 0; i < px.length; i += Math.max(1, Math.floor(px.length / 60))) b.push(px[i]);
          states.set(it.node, m);
        }
      }
      if (it.node) {
        const all = seen.get(it.node) ?? [];
        if (all.length < 2400) for (let i = 0; i < px.length; i += Math.max(1, Math.floor(px.length / 60))) all.push(px[i]);
        seen.set(it.node, all);
      }
      if (it.node) { const m = inkMax.get(it.node) ?? [0, 0]; inkMax.set(it.node, [Math.max(m[0], it.box.x1 - it.box.x0), Math.max(m[1], it.box.y1 - it.box.y0)]); }
      if (p10 >= need && !busy) continue;
      const k = it.node ?? `op:${s.f.key}:${it.i}`;
      const prev = byNode.get(k);
      const worse = !prev || p10 < prev.p10;
      const keep = prev?.pixels ?? [];
      // Keep a sample of failing backgrounds for the fixer: from the first 6 frames, and always
      // from a new worst frame (a fix that passes on the samples must pass where it was worst).
      if (!prev || prev.samples < 6 || worse) for (let i = 0; i < px.length; i += Math.max(1, Math.floor(px.length / 300))) keep.push(px[i]);
      byNode.set(k, {
        code: READABILITY_CODE, severity: 'block', node: it.node, frame: worse ? s.f.key : prev.frame, frames: (prev?.frames ?? 0) + 1,
        p10: worse ? p10 : prev.p10, need, size: op.size, weight: op.weight, busy: (prev?.busy ?? false) || busy, spread: Math.max(spread, prev?.spread ?? 0),
        color: normHex(typeof op.color === 'string' ? op.color.slice(0, 7) : null), text: String(op.text).slice(0, 28), pixels: keep, samples: (prev?.samples ?? 0) + 1,
        box: worse ? box : prev.box,
        // The worst frame's backgrounds on their own: a fix must pass there, not only on the mix.
        // (and a frame that first made it busy, which isn't always the one with the lowest contrast).
        worst: worse || (busy && !prev?.busy) ? [...(worse ? [] : prev?.worst ?? []), ...px.filter((_, i) => i % Math.max(1, Math.floor(px.length / 300)) === 0)] : prev.worst,
      });
    }
  }
  return [...byNode.values()].map((f) => ({
    ...f, ink: f.node ? inkMax.get(f.node) : undefined, seen: f.node ? seen.get(f.node) : undefined, states: f.node ? states.get(f.node) : undefined,
    message: `"${f.text}" ${f.busy && f.p10 >= f.need ? `on a busy background (spread ${f.spread.toFixed(2)})` : `reads at ${f.p10.toFixed(2)}:1 in its worst 10 % (needs ${f.need}:1)`}`,
  }));
}

// ---------------------------------------------------------------- the fix ----

const clone = (v) => JSON.parse(JSON.stringify(v));
function getAt(game, ptr) {
  let n = game;
  for (const p of ptr.split('/').slice(1)) { if (n == null) return null; n = n[p.replace(/~1/g, '/').replace(/~0/g, '~')]; }
  return n;
}
function parentOf(game, ptr) {
  const parts = ptr.split('/');
  const last = parts.pop();
  return { parent: getAt(game, parts.join('/')), key: last, parentPtr: parts.join('/') };
}
const isExpr = (v) => typeof v === 'string' && v.startsWith('=');

/** The piece a text sits on: in a small group (≤ 4 children), the nearest shape before it, when that shape's fill is an expression (it changes with state). */
function pieceOf(game, ptr, depth = 0) {
  const { parent, key, parentPtr } = parentOf(game, ptr);
  const i = Number(key);
  if (!Array.isArray(parent) || !Number.isInteger(i) || parent.length > 4) return null;
  for (let j = i - 1; j >= 0; j--) {
    const s = parent[j];
    if (s?.node === 'rect' || s?.node === 'circle') return isExpr(s.fill) ? { node: s, ptr: `${parentPtr}/${j}` } : null;
  }
  // A text alone in a group (a kit cell, a padded label): its piece is the group's sibling.
  if (parent.length === 1 && depth < 2 && parentPtr.endsWith('/children')) return pieceOf(game, parentPtr.slice(0, -'/children'.length), depth + 1);
  return null;
}

/** Palette tokens usable as text colours: opaque hex, best first for a given current colour. */
function candidates(tokens, current, big) {
  const names = Object.keys(tokens).filter((n) => /^#[0-9A-Fa-f]{6}$/.test(String(tokens[n])) && !/^(shadow|scrim|plate)/.test(n));
  const role = typeof current === 'string' && current.startsWith('$') ? current.slice(1).replace(/_(ink|soft)$/, '') : null;
  const rank = (n) => {
    if (role && (n === `${role}_ink` || n === `on_${role}`)) return 0;
    if (['ink', 'on_bg', 'on_surface'].includes(n)) return 1;
    if (['surface', 'bg', 'ink_muted'].includes(n)) return 2;
    if (/_ink$/.test(n)) return 3;
    return 4;
  };
  return names.filter((n) => !(big && isNeon(normHex(tokens[n])))).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
}

/** Corner radius for plates, from the look's vibe. */
function plateRadius(spec) {
  const v = spec?.vibe ?? '';
  if (/pixel/.test(v)) return 0;
  if (/cute|cartoon|meme|food|notebook|tropical/.test(v)) return 12;
  if (/medieval|myth|elegant|noir|jazz/.test(v)) return 4;
  return 8;
}

/**
 * Fixes S_READABILITY findings (presentation only). spec: the game's look (for treatment and
 * radius). Returns {game, fixes: [{node, kind, detail}]}.
 */
export function readabilityFix(game, findings, { spec = null } = {}) {
  const g = clone(game);
  const tokens = g.presentation.tokens = { ...(g.presentation.tokens ?? {}) };
  const tok = (n) => normHex(tokens[n]);
  const fixes = [];
  const list = findings.filter((f) => f.code === READABILITY_CODE && f.node && f.pixels?.length)
    // Deepest and last first, so inserting a group never moves a pointer still to be fixed.
    .sort((a, b) => cmpPtr(b.node, a.node));
  // One plate style per game, and one colour choice per (colour, step) role.
  const roleChoice = new Map();
  let plate = null;
  const plateStyle = (fillRgb) => {
    if (plate) return plate;
    const grounds = ['surface', 'bg', 'ink'].filter((n) => tok(n));
    // A game that already has plates (an earlier round) keeps their colour.
    const had = grounds.find((n) => tokens.plate_solid && tok(n) === normHex(tokens.plate_solid));
    if (had) return (plate = { ground: had, radius: plateRadius(spec) });
    const best = grounds.reduce((b, n) => (contrast(tok(n), rgbHex(fillRgb)) > contrast(tok(b), rgbHex(fillRgb)) ? n : b), grounds[0]);
    plate = { ground: best, radius: plateRadius(spec) };
    tokens.plate = `${tok(best)}D9`;
    tokens.plate_solid = tok(best);
    return plate;
  };
  for (const f of list) {
    const node = getAt(g, f.node);
    if (!node || node.node !== 'text') continue;
    const big = f.need === 3;
    const alpha = typeof node.opacity === 'number' ? node.opacity : 1;
    // On the text's own backgrounds (no plate) a busy ground stays busy whatever the colour: only
    // a colour that reads at 7:1 everywhere, or an outline, gets past it.
    const passOn = (hex, outline, px, own = false) => {
      const r = legibility(hexRgb(hex), px, { alpha, outline: outline ? hexRgb(outline) : null });
      return r.p10 >= f.need + 0.15 && !(f.busy && !outline && (own || r.spread > BUSY_SPREAD) && r.p10 < 7);
    };
    // Muted text (opacity under 1) that reads at full strength: drop the mute first.
    if (typeof node.opacity === 'number' && node.opacity < 1 && !isExpr(node.color)) {
      const hex = resolve(tokens, node.color ?? '$ink');
      const full = (px) => !px?.length || legibility(hexRgb(hex), px).p10 >= f.need + 0.15;
      if (hex && !f.busy && full(f.pixels) && full(f.worst) && full(f.seen)) {
        fixes.push({ node: f.node, kind: 'opacity', detail: `${node.opacity} → 1` });
        node.opacity = 1;
        continue;
      }
    }
    const passes = (hex, outline = null, px = null) => {
      if (!hex) return false;
      if (px) return passOn(hex, outline, px);
      // A new colour must also read everywhere else the text shows (a label repeated over lanes of
      // different colours), or the next round just flips it back.
      return passOn(hex, outline, f.pixels, true) && (!f.worst?.length || passOn(hex, outline, f.worst, true)) && (!f.seen?.length || passOn(hex, outline, f.seen, true));
    };
    const cands = candidates(tokens, node.color, big);
    // 0. Text on its own piece (a key or button drawn just before it) whose fill changes with state:
    // one ink can't read on every state, so the ink follows the fill, a palette ink per fill colour.
    const pieceAt = pieceOf(g, f.node);
    const piece = pieceAt?.node;
    // A colour expression already keyed to state: its last branch is the ink on the bare piece.
    const lastInk = isExpr(node.color) ? /\belse\s+(\$[A-Za-z_][A-Za-z0-9_]*)\s*\)*\s*$/.exec(node.color)?.[1] : null;
    if (piece && (!isExpr(node.color) || lastInk)) {
      const cur = lastInk ?? node.color ?? '$ink';
      const curHex = typeof cur === 'string' && cur.startsWith('$') ? tok(cur.slice(1)) : normHex(cur);
      const refs0 = [...new Set(piece.fill.match(/\$[A-Za-z_][A-Za-z0-9_]*|'#[0-9A-Fa-f]{6,8}'/g) ?? [])];
      const map = {};
      for (const ref of refs0) {
        const lit = ref.startsWith("'");
        const raw = lit ? ref.slice(1, -1) : tokens[ref.slice(1)];
        if (typeof raw !== 'string') { map.__fail = true; break; }
        if (raw.length === 9 && parseInt(raw.slice(7), 16) < 0x80) {
          // See-through: the text reads on what's under the piece, where it failed: the first ink that passes there.
          const under = [cur.startsWith?.('$') ? cur.slice(1) : null, 'on_bg', 'ink', 'on_surface', ...cands].filter((n) => n && tok(n));
          const bare = f.states?.clear?.length ? [f.states.clear] : [f.pixels, f.worst].filter((x) => x?.length);
          const ink = under.find((n) => bare.every((px) => passOn(tok(n), null, px)));
          if (!ink) { map.__fail = true; break; }
          map[ref] = ink === cur.slice?.(1) ? null : ink;
          continue;
        }
        const fillHex = normHex(raw.slice(0, 7));
        const role = lit ? null : ref.slice(1);
        const order = [cur.startsWith?.('$') ? cur.slice(1) : null, role && `on_${role}`, role && `${role}_ink`, 'ink', 'on_surface', 'bg', 'surface', ...cands].filter((n) => n && tok(n));
        // Judged on the frames where the piece shows this colour (its opacity and what's under it
        // included), else against the flat colour.
        const shown = fillHex && f.states?.[fillHex.toUpperCase()];
        const ok = (hex) => hex && fillHex && (shown?.length ? passOn(hex, null, shown) : contrast(hex, fillHex) >= f.need + 0.15);
        const pick = ok(curHex) ? (cur.startsWith('$') ? cur.slice(1) : null) : order.find((n) => !(big && isNeon(tok(n))) && ok(tok(n)));
        if (pick === undefined) { map.__fail = true; break; }
        map[ref] = pick;
      }
      const keepInk = cur.startsWith('$') ? cur : `'${cur}'`;
      const follow = map.__fail ? null : piece.fill.replace(/\$[A-Za-z_][A-Za-z0-9_]*|'#[0-9A-Fa-f]{6,8}'/g, (m) => (m in map ? (map[m] ? `$${map[m]}` : keepInk) : m));
      if (follow && follow !== node.color && (lastInk || refs0.some((r) => map[r] && `$${map[r]}` !== cur))) {
        const before = node.color ?? '$ink';
        node.color = follow;
        fixes.push({ node: f.node, kind: 'color', detail: `${isExpr(before) ? 'its state colours' : before} → ink that follows its piece` });
        continue;
      }
    }
    // A small centred line with no box: give it the box it draws in, so it can take a soft plate
    // (outlines look cramped on small type).
    if (!big && !(typeof node.w === 'number' && typeof node.h === 'number') && node.anchor === 'center' && f.ink && !node.wrap
      && !node.transition && !node.animate_on && typeof node.size === 'number' && typeof node.text === 'string') {
      node.w = Math.ceil(f.ink[0]) + 2;
      node.h = Math.ceil(Math.max(f.ink[1], node.size * 1.25));
    }
    // 1. A palette colour (for a colour expression: one for every token it can pick).
    const refs = isExpr(node.color) ? [...new Set(node.color.match(/\$[A-Za-z_][A-Za-z0-9_]*/g) ?? [])] : [node.color ?? '$ink'];
    const literalInExpr = isExpr(node.color) && /'#[0-9A-Fa-f]{6}/.test(node.color);
    if (!literalInExpr && refs.length) {
      const map = {};
      for (const ref of refs) {
        const roleKey = `${ref}|${stepOf(f.size)}`;
        const prior = roleChoice.get(roleKey);
        // A plain colour failed where it was measured: only an expression's other branches can keep theirs.
        const own = isExpr(node.color) && typeof ref === 'string' && ref.startsWith('$') && passes(tok(ref.slice(1))) ? ref.slice(1) : null;
        const curHex = !isExpr(node.color) ? resolve(tokens, node.color ?? '$ink') : null;
        const pick = own ?? (prior && tok(prior) !== curHex && passes(tok(prior)) ? prior : candidates(tokens, ref, big).find((n) => tok(n) !== curHex && passes(tok(n))));
        if (!pick) { map.__fail = true; break; }
        map[ref] = pick;
      }
      if (!map.__fail) {
        for (const ref of refs) roleChoice.set(`${ref}|${stepOf(f.size)}`, map[ref]);
        const before = node.color ?? '$ink';
        node.color = isExpr(node.color) ? node.color.replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, (m) => `$${map[m] ?? m.slice(1)}`) : `$${map[refs[0]]}`;
        if (node.color !== before) fixes.push({ node: f.node, kind: 'color', detail: `${before} → ${node.color}` });
        continue;
      }
    }
    // The colours the text can show now (all an expression can pick).
    const fills = refs.map((r) => (typeof r === 'string' && r.startsWith('$') ? tok(r.slice(1)) : normHex(r))).filter(Boolean);
    if (!fills.length) fills.push(f.color ?? tok('ink'));
    const boxed = typeof node.w === 'number' && typeof node.h === 'number' && !node.transition && !node.animate_on;
    const grounds = ['bg', 'ink', 'surface', 'surface_2', 'on_bg'].filter((n) => tok(n));
    // 2a. Display text (and text with no box to put a plate in): the look's outline, in the
    // palette ground that contrasts most with every colour the text can take; if none does, the
    // text moves to the palette colour that does.
    if (big || !boxed) {
      const groundFor = (hexes) => grounds.map((n) => [n, Math.min(...hexes.map((h) => contrast(tok(n), h)))]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      let [ground, c] = groundFor(fills);
      let recolor = null;
      if (!(c >= f.need)) {
        for (const n of ['ink', ...cands]) { const [gn, gc] = groundFor([tok(n)]); if (gc >= f.need && tok(n)) { recolor = n; ground = gn; c = gc; break; } }
      }
      if (c >= f.need) {
        if (recolor) node.color = `$${recolor}`;
        node.stroke = `$${ground}`;
        node.stroke_width = spec?.treatment === 'heavy' || f.size >= 30 ? 3 : 2;
        fixes.push({ node: f.node, kind: 'outline', detail: `${recolor ? `$${recolor} ` : ''}on $${ground} ${node.stroke_width}` });
        continue;
      }
    }
    // 2b/3. A plate behind body text: soft first, then solid; the text takes the palette colour
    // that reads on the plate if its own doesn't.
    if (typeof node.w === 'number' && typeof node.h === 'number') {
      const ps = plateStyle(hexRgb(fills[0]));
      const groundHex = tok(ps.ground);
      const gc = hexRgb(groundHex);
      const over = (k) => [...f.pixels, ...(f.worst ?? []), ...(f.seen ?? [])].map(([r, gg, b]) => [gc[0] * k + r * (1 - k), gc[1] * k + gg * (1 - k), gc[2] * k + b * (1 - k)]);
      const soft = over(0.85), solid = over(1);
      let kind = null;
      if (fills.every((h) => passes(h, null, soft))) kind = 'plate';
      else if (fills.every((h) => passes(h, null, solid))) kind = 'solid plate';
      else {
        const n = ['ink', ...cands].find((x) => passes(tok(x), null, solid));
        if (n) { node.color = `$${n}`; kind = passes(tok(n), null, soft) ? 'plate' : 'solid plate'; }
      }
      if (!kind) continue;
      // Already on a plate (an earlier round): make that plate solid rather than stack another.
      const { parent: sibs } = parentOf(g, f.node);
      const own = Array.isArray(sibs) && sibs.length === 2 && sibs[0]?.node === 'rect' && /^\$plate/.test(String(sibs[0].fill)) ? sibs[0] : null;
      if (own) {
        if (own.fill === '$plate_solid') continue;
        own.fill = '$plate_solid';
        fixes.push({ node: f.node, kind: 'solid plate', detail: `$${ps.ground}` });
        continue;
      }
      wrapWithPlate(g, f.node, node, kind === 'plate' ? '$plate' : '$plate_solid', ps.radius);
      fixes.push({ node: f.node, kind, detail: `$${ps.ground}` });
    }
  }
  return { game: g, fixes };
}

function rgbHex(rgb) { return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase(); }
function resolve(tokens, c) {
  if (typeof c !== 'string') return null;
  if (c.startsWith('$')) return normHex(tokens[c.slice(1)]);
  return normHex(c);
}
function cmpPtr(a, b) {
  const pa = a.split('/'), pb = b.split('/');
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue;
    const na = Number(pa[i]), nb = Number(pb[i]);
    return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : pa[i] < pb[i] ? -1 : 1;
  }
  return pa.length - pb.length;
}

/**
 * Replaces a boxed text node with a group holding a plate and the text, at the text's place. The
 * group takes the text's position, anchor, visibility and opacity; the plate hugs a literal
 * centred line, else fills the text's box, 6 units out on the sides and 3 above and below.
 */
function wrapWithPlate(g, ptr, node, fill, radius) {
  const { parent, key } = parentOf(g, ptr);
  if (!parent) return;
  const padX = 6, padY = 3;
  const lit = typeof node.text === 'string' && !isExpr(node.text) ? node.text : null;
  const size = typeof node.size === 'number' ? node.size : 16;
  const inkW = lit && !node.wrap && !lit.includes('\n') ? Math.min(node.w, [...lit].length * size * 0.56) : node.w;
  const pw = Math.min(node.w + 2 * padX, inkW + 2 * padX);
  const align = node.align ?? 'center';
  const px = align === 'left' ? -padX : align === 'right' ? node.w + padX - pw : (node.w - pw) / 2;
  const plateNode = { node: 'rect', x: Math.round(px), y: -padY, w: Math.round(pw), h: node.h + 2 * padY, radius, fill };
  const { x, y, anchor, visible, opacity, ...rest } = node;
  if (anchor === 'center') {
    // Groups take no box: the text keeps its anchor at the group's origin, the plate goes round it.
    plateNode.x = Math.round(px - node.w / 2); plateNode.y = Math.round(-padY - node.h / 2);
    parent[key] = { node: 'group', x: x ?? 0, y: y ?? 0, ...(visible !== undefined ? { visible } : {}), ...(opacity !== undefined ? { opacity } : {}), children: [plateNode, { ...rest, anchor, x: 0, y: 0 }] };
    return;
  }
  const group = { node: 'group', x: x ?? 0, y: y ?? 0, ...(anchor ? { anchor, w: node.w, h: node.h } : {}), ...(visible !== undefined ? { visible } : {}), ...(opacity !== undefined ? { opacity } : {}), children: [plateNode, { ...rest, x: 0, y: 0 }] };
  parent[key] = group;
}
