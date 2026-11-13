// Layout lint: plays a microgame headless for a few seeds, samples frames (intro, mid-play, end and
// every ~1.5 s for overlap checks) and checks the engine's draw list for the "intersection" problems:
// text overflowing its tile, text too small, overlapping tap targets, sprites over the HUD or the
// buttons, text over text, small targets, low contrast against what is actually behind the text,
// off-screen text and blank labels. Deterministic: same game, same findings.
//
// The engine's frame ops carry no node ids, so the lint loads an instrumented copy of the game in
// which every drawable node's `rotation` (circles: `r`) is nudged by id × 1e-5 (≤ 0.05°, invisible
// and ignored by hit-testing). Ops are mapped back to presentation nodes (JSON pointers) from that.
// If the instrumented copy doesn't load, the lint runs untagged with geometric roles only.
//
// Contrast and real text widths come from headless Chrome (frame-render.mjs, the engine's own
// renderer) when `pixels` is on; without it, contrast is computed from the shapes under the text and
// skipped where an image is behind it, and widths use the engine's 0.6 em approximation.
//
// CLI: node authoring/playtest/layout-check.mjs <manifest-or-game.json>... [--no-pixels] [--json]

import { readFileSync } from 'node:fs';
import { loadEngine } from '../expander/engine.mjs';
import { mulberry32, inputSources, candidatesFor, apply, gameObject, DT } from './bots.mjs';

export const MIN_TEXT = 11;   // canvas units; 360 units are drawn ~390 pt wide, so ≈ 12 pt
export const MIN_TARGET = 40; // ≈ 44 pt at play size
export const MIN_GAP = 4;     // between tap targets
const TAG_EPS = 1e-5;
const TAGGED = new Set(['rect', 'circle', 'text', 'image']);
const TEMPLATE_KEYS = ['template', 'item', 'cell', 'node'];
// A counter readout: a known HUD word, "3 of 5", or any "Label: <number>" (literal or `'Label: ' + str(n)`).
const HUD_RE = /\b(score|time|timer|clock|lives|life|level|round|best|streak|moves|distance|metres|meters|coins?|strikes?|mistakes?|wave|lap|question|prompt|hp|health|combo|points?|pts|rows)\b|\d+\s*(\/|of)\s*\d+|\bscore\b|^[A-Za-z][A-Za-z ]{1,15}:\s*\d|'[A-Za-z][A-Za-z ]{0,15}:\s*'\s*\+\s*str\(/i;

export const HINTS = {
  L_TEXT_OVERFLOW: 'shrink the label to fit its box (size down to 11), then wrap it (text w + wrap: true), or give the tile more room',
  L_TEXT_OFFCENTER: 'center the label in its tile: x = w/2, y = h/2 with anchor center',
  L_TEXT_SMALL: `raise the text size to at least ${MIN_TEXT}`,
  L_TEXT_CLIPPED: 'the text runs past the canvas edge: move it in or shorten it',
  L_OVERLAP_TEXT: 'move one of the two texts, or stack them with a gap',
  L_OVERLAP_HUD: 'keep sprites below the HUD band, or draw the HUD after the playfield on a solid panel',
  L_OVERLAP_CONTROL: 'keep moving sprites out of the button row, or draw the buttons last on a panel',
  L_OVERLAP_SPRITES: 'space the sprites apart at the start',
  L_OVERLAP_TARGETS: 'tap targets overlap: move them apart so each tap has one owner',
  L_TARGET_GAP: `leave at least ${MIN_GAP} units between tap targets`,
  L_TARGET_SMALL: `make tap targets at least ${MIN_TARGET} units (44 pt) on each side`,
  L_LOW_CONTRAST: 'put a solid plate under the text, add an outline, or switch to ink/surface by contrast',
  L_OFFSCREEN: 'move the target inside the canvas',
  L_EMPTY_LABEL: 'this tap target has no visible label while its siblings do: give it text or an icon',
  L_INCONSISTENT: 'draw every instance of a repeated button or tile with one size, radius, font and text size',
  L_WORD_BREAK: 'a word is split across lines: shrink the text (down to its role minimum), wrap only at spaces, abbreviate HUD words (SCORE → PTS), or widen the box; letter-spaced text must not wrap',
};
const SEVERITY = {
  L_TEXT_OVERFLOW: 'error', L_TEXT_OFFCENTER: 'error', L_TEXT_SMALL: 'warn', L_TEXT_CLIPPED: 'error',
  L_OVERLAP_TEXT: 'error', L_OVERLAP_HUD: 'error', L_OVERLAP_CONTROL: 'warn', L_OVERLAP_SPRITES: 'warn',
  L_OVERLAP_TARGETS: 'error', L_TARGET_GAP: 'warn', L_TARGET_SMALL: 'warn', L_LOW_CONTRAST: 'error',
  L_OFFSCREEN: 'warn', L_EMPTY_LABEL: 'error', L_INCONSISTENT: 'warn', L_WORD_BREAK: 'error',
};

// ---------------------------------------------------------------- instrumenting ----

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isExpr = (v) => typeof v === 'string' && v.startsWith('=');

/** Walks presentation nodes: fn(node, ptr, parents[]) with parents as [{node, ptr}] root-first. */
export function walkNodes(root, fn, ptr = '/presentation/root', parents = []) {
  if (!isObj(root)) return;
  fn(root, ptr, parents);
  const next = [...parents, { node: root, ptr }];
  if (Array.isArray(root.children)) root.children.forEach((c, i) => walkNodes(c, fn, `${ptr}/children/${i}`, next));
  for (const k of TEMPLATE_KEYS) if (isObj(root[k])) walkNodes(root[k], fn, `${ptr}/${k}`, next);
}

/** Returns {game: instrumented copy, nodes: [info by id]}; id 0 is unused. */
export function instrument(game) {
  const copy = JSON.parse(JSON.stringify(game));
  const nodes = [null];
  walkNodes(copy.presentation?.root, (node, ptr, parents) => {
    if (!TAGGED.has(node.node)) return;
    const id = nodes.length;
    const key = node.node === 'circle' ? 'r' : 'rotation';
    const cur = node[key] ?? (key === 'r' ? null : 0);
    const nudge = +(id * TAG_EPS).toFixed(6);
    if (typeof cur === 'number') node[key] = +(cur + nudge).toFixed(6);
    else if (isExpr(cur)) node[key] = `= (${cur.slice(1).trim()}) + ${nudge}`;
    else { nodes.push(null); return; }
    const chain = [...parents.map((p) => p.node), node];
    nodes.push({
      id, ptr, kind: node.node, key,
      parentPtr: parents.at(-1)?.ptr ?? null,
      ancestors: parents.map((p) => p.ptr),
      interactive: chain.some((n) => n.on_tap || n.on_press || n.on_release || n.on_drag || n.draggable),
      fixed: chain.some((n) => n.fixed === true),
      inTemplate: parents.some((p) => ['grid', 'repeat'].includes(p.node.node)),
      text: node.node === 'text' ? String(node.text ?? '') : null,
      wrap: node.node === 'text' && node.wrap === true,
      parents,
    });
  });
  // HUD nodes: a text naming a counter (score, time, lives…) and everything grouped with it in a
  // small stack/group, decided here; the frame check also wants it in the top or bottom band.
  const hud = new Set();
  for (const n of nodes) {
    if (!n || n.kind !== 'text' || n.inTemplate || n.interactive || !HUD_RE.test(n.text)) continue;
    hud.add(n.id);
    const group = [...n.parents].reverse().find((p, i, arr) => i < arr.length - 1 && ['stack', 'group'].includes(p.node.node) && leafCount(p.node) <= 10);
    if (group) for (const m of nodes) if (m && !m.interactive && (m.ptr.startsWith(group.ptr + '/'))) hud.add(m.id);
  }
  for (const n of nodes) if (n) { n.hud = hud.has(n.id); delete n.parents; }
  return { game: copy, nodes };
}

function leafCount(node) {
  let n = 0;
  walkNodes(node, (x) => { if (TAGGED.has(x.node)) n++; });
  return n;
}

function decodeTag(op, nodes) {
  const v = op.op === 'circle' ? op.r : op.rotation;
  if (typeof v !== 'number') return null;
  const frac = v - Math.round(v);
  const id = Math.round(frac / TAG_EPS);
  if (id <= 0 || Math.abs(frac / TAG_EPS - id) > 0.2) return null;
  const n = nodes[id];
  return n && n.kind === op.op ? n : null;
}

// ---------------------------------------------------------------- sampling ----

/**
 * Plays the game and captures frames. Each run: a random-play bot on one seed, plus one idle run.
 * Returns {frames: [{label, seed, t, frame, targets, key}], nodes, tagged, assets}.
 */
export async function sampleFrames(gameJson, { seeds = [1, 2], maxSeconds = 40, everyMs = 1500, engine = null } = {}) {
  const game = typeof gameJson === 'string' ? JSON.parse(gameJson) : gameJson;
  const eng = engine ?? (await loadEngine()).engine;
  let { game: inst, nodes } = instrument(game);
  let tagged = true;
  let probe;
  try { probe = eng.load(JSON.stringify(inst), seeds[0]); } catch { tagged = false; nodes = [null]; inst = game; probe = eng.load(JSON.stringify(game), seeds[0]); }
  const assets = probe.assets();
  probe.dispose();
  const json = JSON.stringify(inst);
  const sources = inputSources(gameObject(json));
  const frames = [];
  const runs = [...seeds.map((s) => ({ seed: s, idle: false })), { seed: seeds[0], idle: true }];
  for (const run of runs) {
    const g = eng.load(json, run.seed);
    const rng = mulberry32(run.seed * 7919 + (run.idle ? 1 : 0));
    const maxSteps = Math.round((maxSeconds * 1000) / DT);
    const everySteps = Math.round(everyMs / DT);
    const cap = (label, step) => {
      const frame = g.frameJSON();
      frames.push({ label, seed: run.seed, idle: run.idle, t: Math.round(step * DT), frame, targets: g.hitTargets?.() ?? [], key: `${run.idle ? 'idle' : 's' + run.seed}:${label}@${(step * DT / 1000).toFixed(1)}s` });
    };
    try {
      let step = 0;
      for (; step < 20; step++) g.step(DT);
      cap('intro', step);
      let next = 30;
      while (step < maxSteps && g.phase() === 'playing') {
        if (!run.idle && step >= next) {
          const cands = candidatesFor(g.frameJSON(), sources, rng, g.hitTargets?.() ?? null, null).filter((c) => c.kind !== 'noop');
          if (cands.length) apply(g, cands[Math.floor(rng() * cands.length)]);
          next = step + 20 + Math.floor(rng() * 20);
        }
        g.step(DT);
        step++;
        if (step % everySteps === 0 && g.phase() === 'playing') cap('play', step);
      }
      cap('end', step);
    } catch { /* runtime errors are the gate's business; keep what we captured */ }
    finally { g.dispose(); }
  }
  // The middle play capture of each run is "mid".
  for (const key of new Set(frames.map((f) => `${f.idle}:${f.seed}`))) {
    const play = frames.filter((f) => `${f.idle}:${f.seed}` === key && f.label === 'play');
    if (play.length) { const m = play[Math.floor(play.length / 2)]; m.label = 'mid'; m.key = m.key.replace(':play@', ':mid@'); }
  }
  return { frames, nodes, tagged, assets };
}

// ---------------------------------------------------------------- geometry ----

const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const inter = (a, b) => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const iarea = (a, b) => area(inter(a, b));
const contains = (b, x, y, tol = 0) => x >= b.x0 - tol && x <= b.x1 + tol && y >= b.y0 - tol && y <= b.y1 + tol;
const round = (b) => b && ({ x: +b.x0.toFixed(1), y: +b.y0.toFixed(1), w: +(b.x1 - b.x0).toFixed(1), h: +(b.y1 - b.y0).toFixed(1) });
const scaled = (b, s, cx, cy) => (s === 1 || s == null ? b : { x0: cx + (b.x0 - cx) * s, y0: cy + (b.y0 - cy) * s, x1: cx + (b.x1 - cx) * s, y1: cy + (b.y1 - cy) * s });

/**
 * Whether a node moved between two captures: its box went up or down, or sideways at both edges and
 * its center. A box that only grows or shrinks around its anchor (a centered label whose text changes
 * length, a bar filling from its left edge) isn't motion.
 */
// The engine's own wrap (mg-scene text.rs wrap_text): characters are size × 0.6 wide (× 1.05 at
// weight 600+), lines break at spaces, and a word longer than a line is cut at the line width.
export const ENGINE_CHAR_EM = 0.6;
export function engineLineChars(w, size, weight) {
  const cw = size * ENGINE_CHAR_EM * ((weight ?? 400) >= 600 ? 1.05 : 1);
  return cw > 0 && Number.isFinite(w) ? Math.max(1, Math.floor(w / cw + 1e-9)) : Infinity;
}
/** The longest word (split at spaces and newlines, hair spaces counted, as the engine counts them). */
export function longestWord(text) {
  return Math.max(0, ...String(text).split(/[ \n]/).map((x) => [...x].length));
}

/**
 * L_WORD_BREAK on a drawn text op: the engine cut a word (a line of exactly the line width with no
 * space in it, followed by more), or letter-spaced text (hair spaces) wrapped at all.
 */
export function wordBreak(op, wrapped) {
  const text = String(op.text ?? '');
  if (!wrapped || !text.includes('\n')) return null;
  if (text.includes('\u200A')) return `letter-spaced "${text.replace(/\u200A/g, '').replace(/\n/g, ' / ')}" wraps; letter-spaced text must stay on one line`;
  const max = engineLineChars(op.w, op.size, op.weight);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i], b = lines[i + 1];
    if ([...a].length === max && !a.includes(' ') && b && !b.startsWith(' ') && /\S$/.test(a) && /^\S/.test(b)) {
      return `"${a}" / "${b.split(' ')[0]}" breaks inside a word (${max} characters fit a line at size ${op.size})`;
    }
  }
  return null;
}

export function moved(p, b) {
  if (Math.abs(p.y0 - b.y0) > 2 && Math.abs(p.y1 - b.y1) > 2) return true;
  return Math.abs(p.x0 - b.x0) > 2 && Math.abs(p.x1 - b.x1) > 2 && Math.abs(p.x0 + p.x1 - b.x0 - b.x1) > 4;
}

/**
 * Whether a y (a box's center) is in a HUD band: the top 20 % or bottom 12 % of a 360 × 640 canvas;
 * on a tall canvas, the safe area's top 100 units (two HUD rows under the phone's bar) or its bottom
 * 72, and the bleed bands beyond them.
 */
export function inHudBand(cy, W, H) {
  if (H * 360 > W * 640 * 1.02) return cy < H * 110 / 780 + 100 || cy > H * (1 - 96 / 780) - 72;
  return cy < 0.2 * H || cy > 0.88 * H;
}

export function approxWidth(line, size, weight) { return [...line].length * size * 0.6 * (weight >= 600 ? 1.05 : 1); }

/** The box a text op's glyphs cover (widths: measured line widths, or the engine's approximation). */
export function textInk(op, widths = null) {
  const lines = String(op.text).split('\n');
  const ws = widths ?? lines.map((l) => approxWidth(l, op.size, op.weight));
  const w = Math.max(0, ...ws);
  const lh = op.line_height || op.size * 1.25;
  const blockH = lh * lines.length;
  const x0 = op.align === 'left' ? op.x : op.align === 'right' ? op.x + op.w - w : op.x + op.w / 2 - w / 2;
  const y0 = op.valign === 'top' ? op.y : op.valign === 'bottom' ? op.y + op.h - blockH : op.y + (op.h - blockH) / 2;
  const pad = (lh - op.size) / 2;
  return scaled({ x0, y0: y0 + pad, x1: x0 + w, y1: y0 + blockH - pad }, op.scale ?? 1, op.x + op.w / 2, op.y + op.h / 2);
}

export function opBox(op) {
  switch (op.op) {
    case 'rect': case 'image': case 'text':
      return scaled({ x0: op.x, y0: op.y, x1: op.x + op.w, y1: op.y + op.h }, op.scale ?? 1, op.x + op.w / 2, op.y + op.h / 2);
    case 'circle': { const r = Math.abs(op.r * (op.scale ?? 1)); return { x0: op.x - r, y0: op.y - r, x1: op.x + r, y1: op.y + r }; }
    case 'line': return { x0: Math.min(op.x1, op.x2), y0: Math.min(op.y1, op.y2), x1: Math.max(op.x1, op.x2), y1: Math.max(op.y1, op.y2) };
    case 'poly': {
      const pts = op.points ?? [];
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return xs.length ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } : null;
    }
    default: return null;
  }
}

// ---------------------------------------------------------------- color ----

export function parseColor(c) {
  if (c == null) return null;
  let h = String(c).replace('#', '');
  if (h.length === 3) h = [...h].map((x) => x + x).join('');
  if (h.length === 6) h += 'ff';
  if (h.length !== 8) return null;
  const n = parseInt(h, 16);
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, (n & 255) / 255];
}
const chan = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = ([r, g, b]) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
export function contrast(a, b) { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
export const toHex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const blend = (top, a, under) => [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a));

/** Without pixels: the color under (x, y) from the shapes painted before op index `upto`; null when an image is in the way. */
function shapeColorAt(frame, upto, x, y) {
  let col = parseColor(frame.background)?.slice(0, 3) ?? [255, 255, 255];
  for (let i = 0; i < upto; i++) {
    const op = frame.ops[i];
    if (op.op === 'text' || op.op === 'line' || !(op.opacity > 0)) continue;
    const b = opBox(op);
    if (!b || !contains(b, x, y)) continue;
    if (op.op === 'image') { if (area(b) > 0) return null; continue; }
    if (op.op === 'circle') { const r = (b.x1 - b.x0) / 2; if ((x - op.x) ** 2 + (y - op.y) ** 2 > r * r) continue; }
    if (op.op === 'poly' && !inPoly(op.points ?? [], x, y)) continue;
    const f = parseColor(op.fill);
    if (!f || f[3] === 0) continue;
    col = blend(f, f[3] * Math.min(1, op.opacity), col);
  }
  return col;
}
function inPoly(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Legibility of a text op over its backdrop samples: the 20th-percentile contrast, outline-aware. */
export function textContrast(op, samples) {
  const fg = parseColor(op.color);
  if (!fg || !samples.length) return null;
  const ratios = samples.map((s) => contrast(blend(fg, fg[3] * Math.min(1, op.opacity ?? 1), s), s)).sort((a, b) => a - b);
  let eff = ratios[Math.floor(ratios.length * 0.2)];
  const st = parseColor(op.stroke);
  if (st && st[3] > 0.5 && op.stroke_width >= 2.5) {
    const outline = contrast(fg, st);
    // An outline wide enough carries the glyphs on its own when fill and outline differ strongly.
    eff = Math.max(eff, Math.min(outline, 7));
  }
  return eff;
}

// ---------------------------------------------------------------- the lint ----

/**
 * sample: from sampleFrames. measures: optional, keyed by frame key → [{i, widths, samples}] from Chrome.
 * Returns findings: [{code, severity, node, role, frame, box, detail, hint, frames}].
 */
export function lintSample(sample, { measures = null } = {}) {
  const { frames, nodes } = sample;
  const found = new Map();
  const add = (code, f, info) => {
    const key = `${code}|${info.dedupe ?? info.node ?? JSON.stringify(info.box)}`;
    const prev = found.get(key);
    if (prev) { prev.frames++; return; }
    const { dedupe: _d, ...rest } = info;
    found.set(key, { code, severity: info.severity ?? SEVERITY[code], ...rest, frame: f.key, hint: HINTS[code], frames: 1 });
  };

  // Which nodes move: an op of the same node (and same ordinal among that node's ops) changes position.
  const moving = new Set();
  const lastPos = new Map();
  for (const f of frames) {
    const ord = new Map();
    f.frame.ops.forEach((op) => {
      const n = decodeTag(op, nodes);
      if (!n) return;
      const k = ord.get(n.id) ?? 0; ord.set(n.id, k + 1);
      const b = opBox(op);
      if (!b) return;
      const sk = `${f.idle}:${f.seed}:${n.id}:${k}`;
      const p = lastPos.get(sk);
      if (p && moved(p, b)) moving.add(n.id);
      lastPos.set(sk, b);
    });
  }

  for (const f of frames) {
    const fr = f.frame;
    const W = fr.width, H = fr.height, canvasArea = W * H;
    const meas = measures?.[f.key];
    const measByIdx = new Map((meas ?? []).map((m) => [m.i, m]));
    const items = fr.ops.map((op, i) => {
      const n = decodeTag(op, nodes);
      const visible = (op.opacity ?? 1) > 0.05 && (op.scale ?? 1) !== 0;
      let box = opBox(op);
      if (op.op === 'text') box = textInk(op, measByIdx.get(i)?.widths ?? null);
      const isBackdrop = op.op !== 'text' && box && area(box) >= 0.7 * canvasArea;
      const cy = box ? (box.y0 + box.y1) / 2 : 0;
      const inBand = inHudBand(cy, W, H);
      let role = 'shape';
      if (isBackdrop) role = 'backdrop';
      else if (n?.hud && inBand) role = 'hud';
      else if (n?.interactive) role = 'target';
      else if (n && moving.has(n.id) && op.op !== 'text') role = 'actor';
      else if (op.op === 'text') role = 'label';
      return { op, i, n, box, visible, role, node: n?.ptr ?? null };
    }).filter((it) => it.box && it.visible);
    const texts = items.filter((it) => it.op.op === 'text' && String(it.op.text).trim() && (parseColor(it.op.color)?.[3] ?? 0) > 0);
    const shapes = items.filter((it) => ['rect', 'image', 'circle'].includes(it.op.op) && it.role !== 'backdrop');
    const opaqueBetween = (a, b, region) => items.some((it) => it.i > a && it.i < b && it.op.op === 'rect' && (parseColor(it.op.fill)?.[3] ?? 0) * it.op.opacity > 0.85 && iarea(it.box, region) >= 0.9 * area(region));

    // --- text: size, container overflow, centering, canvas edges, contrast
    for (const t of texts) {
      const op = t.op, ink = t.box;
      const nodeKey = t.node ?? `text:${op.text}`;
      const size = op.size * (op.scale ?? 1);
      if (size < MIN_TEXT && (op.scale ?? 1) >= 0.95) add('L_TEXT_SMALL', f, { node: t.node, role: t.role, box: round(ink), detail: `size ${+size.toFixed(1)} < ${MIN_TEXT}: "${clip(op.text)}"`, dedupe: nodeKey });
      const broken = wordBreak(op, t.n?.wrap === true);
      if (broken) add('L_WORD_BREAK', f, { node: t.node, role: t.role, box: round(ink), detail: broken, dedupe: nodeKey });
      if (ink.x0 < -2 || ink.x1 > W + 2 || ink.y0 < -2 || ink.y1 > H + 2) {
        if ((op.scale ?? 1) >= 0.95) add('L_TEXT_CLIPPED', f, { node: t.node, role: t.role, box: round(ink), detail: `"${clip(op.text)}" runs off the canvas`, dedupe: nodeKey });
      }
      // Container: the smallest shape painted before the text whose box holds the text's anchor,
      // and (when tagged) that sits beside the text in the tree.
      const ax = op.x + op.w / 2, ay = op.y + op.h / 2;
      const related = (s) => !t.n || !s.n || s.n.parentPtr === t.n.parentPtr || (t.n.ancestors.includes(s.n.parentPtr) && s.n.parentPtr !== t.n.ancestors[0]);
      // A badge's own plate is the rect drawn just before it in its group; the same plate node's
      // other instances (another popup's badge) are never this text's container.
      const plate = items.find((it) => it.i === t.i - 1 && it.op.op === 'rect' && it.n && t.n && it.n.parentPtr === t.n.parentPtr);
      const cont = shapes.filter((s) => s.i < t.i && contains(s.box, ax, ay, 1) && related(s) && !(plate && s !== plate && s.n?.ptr === plate.n.ptr) && area(s.box) < 0.6 * canvasArea && area(s.box) > 100 && (s.op.op !== 'image' || s.role === 'target' || s.n?.interactive || t.n?.inTemplate))
        .sort((a, b) => area(a.box) - area(b.box))[0];
      if (cont) {
        const c = cont.box;
        const over = Math.max(c.x0 - ink.x0, ink.x1 - c.x1, c.y0 - ink.y0, ink.y1 - c.y1);
        if (over > 2 && (op.scale ?? 1) >= 0.95) add('L_TEXT_OVERFLOW', f, { node: t.node, role: t.role, box: round(ink), container: round(c), detail: `"${clip(op.text)}" sticks out of its ${cont.op.op} by ${over.toFixed(0)} units`, dedupe: nodeKey });
        const w = c.x1 - c.x0, h = c.y1 - c.y0;
        const offc = Math.max(Math.abs(ax - (c.x0 + w / 2)) / (w / 2), Math.abs(ay - (c.y0 + h / 2)) / (h / 2));
        if (w <= 140 && h <= 140 && offc > 0.8 && op.align === 'center' && t.n?.inTemplate) add('L_TEXT_OFFCENTER', f, { node: t.node, role: t.role, box: round(ink), container: round(c), detail: `"${clip(op.text)}" is centered on its tile's edge`, dedupe: nodeKey });
      }
      // Contrast. Text half under an opaque plate drawn after it (a newer badge stacked on an older
      // one) is hidden, not hard to read.
      const hidden = items.some((it) => it.i > t.i && it.op.op === 'rect' && (parseColor(it.op.fill)?.[3] ?? 0) * (it.op.opacity ?? 1) > 0.85 && iarea(it.box, ink) >= 0.5 * area(ink));
      if (hidden) continue;
      let samples = meas ? measByIdx.get(t.i)?.samples ?? null : null;
      if (!samples) {
        samples = [];
        for (let a = 0; a < 3; a++) for (let c = 0; c < 8; c++) {
          const x = ink.x0 + ((c + 0.5) * (ink.x1 - ink.x0)) / 8, y = ink.y0 + ((a + 0.5) * (ink.y1 - ink.y0)) / 3;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const col = shapeColorAt(fr, t.i, x, y);
          if (col) samples.push(col);
        }
        if (samples.length < 8) samples = [];
      }
      const eff = textContrast(op, samples);
      if (eff != null && (op.opacity ?? 1) > 0.5) {
        const large = size >= 18 || (size >= 14 && op.weight >= 600);
        const need = large ? 3 : 4.5;
        const mean = [0, 1, 2].map((k) => samples.reduce((s, x) => s + x[k], 0) / samples.length);
        const lums = samples.map(luminance);
        const spread = (Math.max(...lums) + 0.05) / (Math.min(...lums) + 0.05);
        if (eff < need) add('L_LOW_CONTRAST', f, { node: t.node, role: t.role, box: round(ink), severity: eff < 2 ? 'error' : 'warn', contrast: +eff.toFixed(2), backdrop: toHex(mean), backdrop_spread: +spread.toFixed(2), detail: `"${clip(op.text)}" contrast ${eff.toFixed(2)}:1 (needs ${need}:1)`, dedupe: nodeKey });
        t.contrast = eff;
      }
    }
    // --- text over text
    for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) {
      const A = texts[a], B = texts[b];
      // A crossfade (one label fading out as another fades in, 250 ms): a text under half opacity is
      // in transition, not a second label on top.
      if (Math.min(A.op.opacity ?? 1, B.op.opacity ?? 1) < 0.5) continue;
      const ia = iarea(A.box, B.box);
      if (ia <= 0 || ia < 0.2 * Math.min(area(A.box), area(B.box))) continue;
      if (A.op.text === B.op.text && Math.abs(A.op.x - B.op.x) <= 4 && Math.abs(A.op.y - B.op.y) <= 4) continue; // a drop shadow
      if (opaqueBetween(A.i, B.i, inter(A.box, B.box))) continue;
      add('L_OVERLAP_TEXT', f, { node: B.node, other: A.node, role: B.role, box: round(inter(A.box, B.box)), detail: `"${clip(A.op.text)}" and "${clip(B.op.text)}" overlap`, dedupe: `${A.node ?? A.op.text}~${B.node ?? B.op.text}` });
    }
    // --- sprites over the HUD
    const hud = items.filter((it) => it.role === 'hud');
    const actors = items.filter((it) => it.role === 'actor' && area(it.box) < 0.3 * canvasArea);
    for (const h of hud) for (const a of actors) {
      const r = inter(h.box, a.box);
      if (area(r) < Math.max(12, 0.08 * Math.min(area(h.box), area(a.box)))) continue;
      const lo = Math.min(a.i, h.i), hi = Math.max(a.i, h.i);
      if (opaqueBetween(lo, hi, r) && h.i > a.i) continue; // HUD on a solid panel over the sprite
      add('L_OVERLAP_HUD', f, { node: a.node, other: h.node, role: 'actor', box: round(r), hud_box: round(h.box), severity: a.i > h.i ? 'error' : 'warn', detail: a.i > h.i ? 'a moving sprite is drawn over the HUD' : 'the HUD is drawn over a moving sprite with no panel', dedupe: `${a.node}~${h.node}` });
    }
    // --- sprites over controls (static tap targets)
    const controls = items.filter((it) => it.role === 'target' && !(it.n && moving.has(it.n.id)) && it.op.op !== 'text');
    for (const c of controls) for (const a of actors) {
      if (a.n?.interactive) continue;
      const r = inter(c.box, a.box);
      if (area(r) < 0.1 * area(c.box) || a.i < c.i) continue;
      add('L_OVERLAP_CONTROL', f, { node: a.node, other: c.node, role: 'actor', box: round(r), detail: 'a moving sprite covers a button', dedupe: `${a.node}~${c.node}` });
    }
    // --- sprites overlapping at the start
    if (f.label === 'intro') {
      const sprites = items.filter((it) => it.op.op === 'image' && it.role !== 'backdrop' && it.role !== 'hud' && area(it.box) < 0.25 * canvasArea);
      for (let a = 0; a < sprites.length; a++) for (let b = a + 1; b < sprites.length; b++) {
        const A = sprites[a], B = sprites[b];
        const ia = iarea(A.box, B.box), small = Math.min(area(A.box), area(B.box));
        if (ia < 0.35 * small || ia > 0.9 * small) continue; // nested art (an icon on a tile) is fine
        add('L_OVERLAP_SPRITES', f, { node: B.node, other: A.node, role: B.role, box: round(inter(A.box, B.box)), detail: 'two sprites overlap at the start', dedupe: `${A.node ?? A.i}~${B.node ?? B.i}` });
      }
    }
    // --- tap targets
    const tg = (f.targets ?? []).map((t) => ({ x0: t.x, y0: t.y, x1: t.x + t.w, y1: t.y + t.h })).filter((b) => area(b) > 0 && area(b) < 0.5 * canvasArea);
    for (const b of tg) {
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      if (Math.min(w, h) < MIN_TARGET) add('L_TARGET_SMALL', f, { node: null, role: 'target', box: round(b), detail: `${w.toFixed(0)}×${h.toFixed(0)} target`, dedupe: `${Math.round(w / 8)}x${Math.round(h / 8)}` });
      const outside = area(b) - iarea(b, { x0: 0, y0: 0, x1: W, y1: H });
      if (outside > 0.25 * area(b)) add('L_OFFSCREEN', f, { node: null, role: 'target', box: round(b), detail: 'a tap target is mostly off the canvas', dedupe: `off:${Math.round(w / 8)}x${Math.round(h / 8)}` });
    }
    for (let a = 0; a < tg.length; a++) for (let b = a + 1; b < tg.length; b++) {
      const A = tg[a], B = tg[b];
      const ia = iarea(A, B), small = Math.min(area(A), area(B));
      const sz = (b) => `${Math.round((b.x1 - b.x0) / 8)}x${Math.round((b.y1 - b.y0) / 8)}`;
      if (ia > 1 && ia < 0.9 * small) add('L_OVERLAP_TARGETS', f, { node: null, role: 'target', box: round(inter(A, B)), detail: `two tap targets overlap (${round(A).w}×${round(A).h} and ${round(B).w}×${round(B).h})`, dedupe: [sz(A), sz(B)].sort().join('~') });
      else if (ia <= 1) {
        const gx = Math.max(A.x0 - B.x1, B.x0 - A.x1), gy = Math.max(A.y0 - B.y1, B.y0 - A.y1);
        const gap = gx >= 0 && gy < 0 ? gx : gy >= 0 && gx < 0 ? gy : Infinity;
        if (gap < MIN_GAP) add('L_TARGET_GAP', f, { node: null, role: 'target', box: round(A), detail: `${gap.toFixed(1)} units between targets`, dedupe: `gap:${Math.round(A.x1 - A.x0)}x${Math.round(A.y1 - A.y0)}` });
      }
    }
    // --- blank labels: a target with nothing legible on it while most same-size targets have something
    const groups = new Map();
    for (const b of tg) {
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      if (Math.min(w, h) < 20) continue;
      const k = `${Math.round(w / 4)}x${Math.round(h / 4)}`;
      const content = items.some((it) => {
        if (it.role === 'backdrop') return false;
        const cx = (it.box.x0 + it.box.x1) / 2, cy = (it.box.y0 + it.box.y1) / 2;
        if (!contains(b, cx, cy)) return false;
        if (it.op.op === 'text') return String(it.op.text).trim() && (it.contrast == null || it.contrast >= 1.5);
        const ib = iarea(it.box, b), u = area(it.box) + area(b) - ib;
        return ib / u < 0.8 && area(it.box) < 0.8 * area(b); // an icon on the key, not the key itself
      });
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ b, content });
    }
    for (const list of groups.values()) {
      if (list.length < 3) continue;
      const empties = list.filter((x) => !x.content);
      if (!empties.length) continue;
      // A label that is there but can't be seen (contrast under 1.5:1): always a finding.
      const invisible = empties.filter((e) => texts.some((t) => contains(e.b, (t.box.x0 + t.box.x1) / 2, (t.box.y0 + t.box.y1) / 2) && t.contrast != null && t.contrast < 1.5));
      for (const e of invisible) add('L_EMPTY_LABEL', f, { node: null, role: 'target', box: round(e.b), detail: 'the label on this tap target is invisible' });
      // A missing label: only in a short row of buttons or choices where nearly all have one (blank
      // cells on a big board are part of the game).
      const missing = empties.filter((e) => !invisible.includes(e));
      if (list.length <= 12 && missing.length <= 0.25 * list.length) for (const e of missing) add('L_EMPTY_LABEL', f, { node: null, role: 'target', box: round(e.b), detail: 'a tap target shows no label while its siblings have one' });
    }
  }
  // --- consistency: instances of one repeated tap component (a button, tile or key template) share
  // one size, shape and type treatment across instances and frames.
  const looks = new Map();
  for (const f of frames) for (const op of f.frame.ops) {
    const n = decodeTag(op, nodes);
    if (!n || !n.inTemplate || !n.interactive || (op.opacity ?? 1) < 0.3) continue;
    if (!looks.has(n.id)) looks.set(n.id, { n, f, shapes: new Set(), fonts: new Set(), sizes: [] });
    const l = looks.get(n.id);
    if (op.op === 'text') { if (String(op.text).trim()) { l.fonts.add(`${op.font}|${op.weight}`); l.sizes.push(op.size); } }
    else if (op.op !== 'circle') l.shapes.add(`${Math.round(op.w / 3)}x${Math.round(op.h / 3)}r${Math.round((op.radius ?? 0) / 3)}`);
  }
  for (const { n, f, shapes, fonts, sizes } of looks.values()) {
    const spread = sizes.length ? Math.min(...sizes) / Math.max(...sizes) : 1;
    const why = shapes.size > 1 ? `${shapes.size} different sizes or corner radii` : fonts.size > 1 ? `${fonts.size} different fonts or weights` : spread < 0.6 ? `text sizes from ${Math.min(...sizes)} to ${Math.max(...sizes)}` : null;
    if (why) add('L_INCONSISTENT', f, { node: n.ptr, role: 'target', box: null, detail: `one repeated component drawn ${why}`, dedupe: n.ptr });
  }
  return [...found.values()];
}

const clip = (s) => { s = String(s).replace(/\n/g, ' '); return s.length > 28 ? s.slice(0, 27) + '…' : s; };

/**
 * Where each tagged node was drawn over the sampled frames: {ptr → {kind, box (union of every op's
 * box), moving, frames (captures it was visible in), of (captures in all), hud, inTemplate,
 * interactive, text}}. Text boxes use measured widths when `measures` has them. The structural
 * layout fixes (layout-fix.mjs) read this to tell popups and labels riding sprites from fixed text,
 * and to find what sits in a tall canvas's bleed bands.
 */
export function nodeGeometry(sample, { measures = null } = {}) {
  const { frames, nodes } = sample;
  const out = new Map();
  const lastPos = new Map();
  for (const f of frames) {
    const ord = new Map();
    const meas = new Map((measures?.[f.key] ?? []).map((m) => [m.i, m]));
    const seenHere = new Set();
    f.frame.ops.forEach((op, i) => {
      const n = decodeTag(op, nodes);
      if (!n) return;
      if (!((op.opacity ?? 1) > 0.05) || (op.scale ?? 1) === 0) return;
      const k = ord.get(n.id) ?? 0; ord.set(n.id, k + 1);
      const b = op.op === 'text' ? textInk(op, meas.get(i)?.widths ?? null) : opBox(op);
      if (!b) return;
      let g = out.get(n.ptr);
      if (!g) out.set(n.ptr, (g = { kind: n.kind, box: { ...b }, moving: false, frames: 0, of: frames.length, hud: !!n.hud, inTemplate: n.inTemplate, interactive: n.interactive, text: n.text }));
      g.box = { x0: Math.min(g.box.x0, b.x0), y0: Math.min(g.box.y0, b.y0), x1: Math.max(g.box.x1, b.x1), y1: Math.max(g.box.y1, b.y1) };
      if (!seenHere.has(n.ptr)) { g.frames++; seenHere.add(n.ptr); }
      const sk = `${f.idle}:${f.seed}:${f.run ?? ''}:${n.id}:${k}`;
      const p = lastPos.get(sk);
      if (p && moved(p, b)) g.moving = true;
      lastPos.set(sk, b);
    });
  }
  const H = frames[0]?.frame?.height ?? 640, W = frames[0]?.frame?.width ?? 360;
  for (const g of out.values()) g.inBand = inHudBand((g.box.y0 + g.box.y1) / 2, W, H);
  return out;
}

/** Counts by code and severity, plus a 0–100 layout score (100 = no findings). */
export function countFindings(findings) {
  const byCode = {};
  let errors = 0, warns = 0;
  for (const f of findings) { byCode[f.code] = (byCode[f.code] ?? 0) + 1; if (f.severity === 'error') errors++; else warns++; }
  return { total: findings.length, errors, warns, byCode, score: Math.max(0, 100 - errors * 8 - warns * 2) };
}

/**
 * The whole check: sample, measure in Chrome (optional), lint.
 * opts: {seeds, maxSeconds, pixels (default true when Chrome is installed), pngs: write PNGs of intro/mid/end}.
 * Returns {findings, counts, tagged, frames: [{key, label, png?}]}.
 */
export async function layoutCheck(gameJson, { seeds = [1, 2], maxSeconds = 40, everyMs = 1500, pixels = null, pngs = false, engine = null } = {}) {
  const sample = await sampleFrames(gameJson, { seeds, maxSeconds, everyMs, engine });
  let measures = null;
  const shots = [];
  const { chromeAvailable, renderFrames } = await import('./frame-render.mjs');
  if (pixels ?? chromeAvailable()) {
    const pick = sample.frames.filter((f) => f.label !== 'play' || pngs === 'all');
    for (let attempt = 0; attempt < 3 && !measures; attempt++) try {
      const out = renderFrames(pick.map((f) => ({ ...f.frame, png: !!pngs && f.label !== 'play' })), sample.assets);
      measures = {};
      pick.forEach((f, k) => { measures[f.key] = out[k].texts; if (out[k].png) shots.push({ key: f.key, label: f.label, seed: f.seed, idle: f.idle, png: out[k].png }); });
    } catch (e) {
      measures = null;
      shots.length = 0;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500 * (attempt + 1)); // Chrome sometimes crashes on start; back off
      if (attempt === 2) { shots.push({ error: String(e.message ?? e) }); if (process.env.LAYOUT_DEBUG) console.error('frame render failed:', e.message); }
    }
  }
  // Frames without Chrome measures fall back to the approximation inside lintSample.
  const findings = lintSample(sample, { measures });
  const geometry = nodeGeometry(sample, { measures });
  return { findings, counts: countFindings(findings), tagged: sample.tagged, pixels: !!measures, frames: shots, geometry };
}

/** A manifest, a {content: {game_json}} wrapper or a bare game, as the game object. */
export function gameFromFile(path) {
  const v = JSON.parse(readFileSync(path, 'utf8'));
  if (v?.content?.game_json) return typeof v.content.game_json === 'string' ? JSON.parse(v.content.game_json) : v.content.game_json;
  return v;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith('--'));
  const pixels = args.includes('--no-pixels') ? false : null;
  for (const file of files) {
    const res = await layoutCheck(gameFromFile(file), { pixels });
    if (args.includes('--json')) { console.log(JSON.stringify({ file, ...res, frames: undefined })); continue; }
    console.log(`${file}: ${res.counts.errors} errors, ${res.counts.warns} warnings (score ${res.counts.score})${res.tagged ? '' : ' [untagged]'}${res.pixels ? '' : ' [no pixels]'}`);
    for (const f of res.findings) console.log(`  ${f.severity === 'error' ? 'E' : 'w'} ${f.code} ${f.node ?? '-'} [${f.role}] ${f.frame} ×${f.frames}: ${f.detail}`);
  }
}
