// The layout solver: the last resort after the code fixes, for blocking findings the fixes left.
// Deterministic, presentation only (positions, sizes, gaps, wrapping, outlines, visibility gates),
// and checked afterwards by prove.mjs (rules identical, replay state hashes identical).
//
// The screen is split into three fixed bands: the top HUD band (top 14 %), the play area and the
// bottom control band (bottom 14 %). From the verifier's frames it builds an occupancy map: every
// box anything other than the backdrop and big plain panels covered in any frame (moving sprites
// leave their whole path). Each UI node that overlaps something (text over text, text on a sprite,
// the HUD under a sprite, text off the canvas) gets a free slot of its size: first in its own band,
// nearest its current spot, then the other bands; shrinking the text (down to 11) when no slot fits
// at full size. Slots already handed out are occupied for the next node.
//
// Other findings get direct moves:
//   L_TEXT_OVERFLOW / L_TEXT_CLIPPED  shrink to the measured room, then wrap in it;
//   L_LOW_CONTRAST                    an outline in the palette color farthest from the text's color;
//   L_TARGET_SMALL                    grow the target (grid cell_size, stack/rect w and h) when it fits;
//   L_TARGET_GAP                      raise the stack or grid gap to 8 pt when it fits;
//   L_TAP_THROUGH / L_OVERLAP_TARGETS hide the covered target while the overlay shows (its `visible`
//                                     gets `and not (<overlay visible>)`), so taps can't reach it.

import { getAt } from '../expander/layout-fix.mjs';
import { walkNodes, parseColor, contrast, instrument, opBox } from '../playtest/layout-check.mjs';
import { MIN_TARGET, MIN_GAP } from './checks/targets.mjs';
import { bands as fillBands } from '../playtest/fill-check.mjs';
import { isTall } from '../expander/canvas.mjs';
import { analyze, area, decodeTag } from './scene.mjs';

export const BANDS = { top: [0, 0.14], play: [0.14, 0.86], bottom: [0.86, 1] };

/**
 * The three bands in canvas units. A tall 360 × 780 canvas keeps its bleed bands (under the phone's
 * bars) empty: the HUD bands sit inside the safe area (fill-check.mjs's bands). A legacy 360 × 640
 * canvas uses the fractions above.
 */
export function bandRanges(W, H) {
  if (isTall({ w: W, h: H })) {
    const b = fillBands({ w: W, h: H });
    return { top: [b.hudTop.y0, b.hudTop.y1], play: [b.hudTop.y1, b.hudBottom.y0], bottom: [b.hudBottom.y0, b.hudBottom.y1] };
  }
  return Object.fromEntries(Object.entries(BANDS).map(([k, [a, b]]) => [k, [a * H, b * H]]));
}
const MIN_TEXT = 11;
const CELL = 4;
const PAD = 4;
const CHAR_EM = 0.6;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isExpr = (v) => typeof v === 'string' && v.startsWith('=');
const clone = (v) => JSON.parse(JSON.stringify(v));
const parentPtr = (p) => p.slice(0, p.lastIndexOf('/'));
const nodePtr = (p) => (/\/children\/\d+$/.test(p) ? parentPtr(parentPtr(p)) : /\/(cell|template|item|node)$/.test(p) ? parentPtr(p) : null);

const SLOT_CODES = new Set(['L_OVERLAP_TEXT', 'L_TEXT_ON_SPRITE', 'L_OVERLAP_HUD', 'L_TEXT_CLIPPED']);

// ---------------------------------------------------------------- tree edits ----

function addTo(node, key, d) {
  if (!d) return true;
  const v = node[key];
  if (v === undefined) { node[key] = +d.toFixed(2); return true; }
  if (isNum(v)) { node[key] = +(v + d).toFixed(2); return true; }
  if (isExpr(v)) { node[key] = `= (${v.slice(1).trim()}) + ${+d.toFixed(2)}`; return true; }
  return false;
}

/** The node that moves when `ptr` must move: itself, or the stack that lays it out. Null in a template. */
export function movableUnit(game, ptr) {
  let p = ptr;
  // Inside a list template: only a template of plain text (a popup, a caption list) moves, as a whole.
  const tm = /^(.*\/(?:template|item|node))(\/|$)/.exec(p);
  if (tm && !/\/cell(\/|$)/.test(p)) return textOnly(getAt(game, tm[1])) ? tm[1] : null;
  for (let guard = 0; guard < 12 && p; guard++) {
    if (/\/(cell|template|item|node)(\/|$)/.test(p)) return null; // a board or list item moves every instance
    const parent = nodePtr(p) ? getAt(game, nodePtr(p)) : null;
    if (!parent || parent.node !== 'stack') return p;
    p = nodePtr(p);
  }
  return null;
}

/** Only text (and plain plates): no handlers, no pictures, no lists inside. */
function textOnly(node) {
  if (!node) return false;
  let ok = true, texts = 0;
  walkNodes(node, (n) => {
    if (n.node === 'text') texts++;
    else if (!['group', 'stack', 'rect'].includes(n.node)) ok = false;
    if (['on_tap', 'on_press', 'on_release', 'on_drag'].some((h) => n[h])) ok = false;
  });
  return ok && texts > 0;
}

/**
 * Where the unit draws when its x and y are 0, at two moments: {box} when the offset is fixed (the
 * parents don't move), null otherwise. Used to pin a moving label to a fixed slot.
 */
function zeroBox(engine, game, ptr) {
  if (!engine) return null;
  const g = clone(game);
  const n = getAt(g, ptr);
  if (!n) return null;
  n.x = 0; n.y = 0;
  let inst;
  try { inst = instrument(g); } catch { return null; }
  const ids = new Set(inst.nodes.filter((x) => x && (x.ptr === ptr || x.ptr.startsWith(ptr + '/'))).map((x) => x.id));
  let run;
  try { run = engine.load(JSON.stringify(inst.game), 1); } catch { return null; }
  const boxes = [];
  try {
    for (let step = 0; step < 3600 && boxes.length < 2 && run.phase() === 'playing'; step++) {
      run.step(1000 / 60);
      if (step % 15) continue;
      const f = run.frameJSON();
      let b = null;
      for (const op of f.ops) {
        const t = decodeTag(op, inst.nodes);
        if (!t || !ids.has(t.id)) continue;
        const ob = op.op === 'text' ? { x0: op.x, y0: op.y, x1: op.x + op.w, y1: op.y + op.h } : opBox(op);
        if (ob) b = b ? { x0: Math.min(b.x0, ob.x0), y0: Math.min(b.y0, ob.y0), x1: Math.max(b.x1, ob.x1), y1: Math.max(b.y1, ob.y1) } : ob;
      }
      if (b && (!boxes.length || step > 120)) boxes.push(b);
    }
  } finally { run.dispose(); }
  if (boxes.length < 2) return boxes[0] ? { box: boxes[0] } : null;
  const [a, b] = boxes;
  if (Math.abs(a.x0 - b.x0) > 1 || Math.abs(a.y0 - b.y0) > 1) return null; // the parent moves it
  return { box: a };
}

function translate(game, ptr, dx, dy) {
  const n = getAt(game, ptr);
  if (!n) return false;
  const before = clone(n);
  if (addTo(n, 'x', dx) && addTo(n, 'y', dy)) return true;
  Object.assign(n, before);
  return false;
}

/** Rewrites `visible` so the node shows only while `cond` (an expression body) is false. */
function hideWhile(node, cond) {
  const v = node.visible;
  const not = `not (${cond})`;
  if (v === undefined || v === true) node.visible = `= ${not}`;
  else if (isExpr(v)) node.visible = `= (${v.slice(1).trim()}) and ${not}`;
  else return false;
  return true;
}

// ---------------------------------------------------------------- occupancy ----

class Grid {
  constructor(W, H) { this.W = W; this.H = H; this.cw = Math.ceil(W / CELL); this.ch = Math.ceil(H / CELL); this.cells = new Uint8Array(this.cw * this.ch); this.sum = null; }
  mark(b) {
    const x0 = Math.max(0, Math.floor(b.x0 / CELL)), y0 = Math.max(0, Math.floor(b.y0 / CELL));
    const x1 = Math.min(this.cw, Math.ceil(b.x1 / CELL)), y1 = Math.min(this.ch, Math.ceil(b.y1 / CELL));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.cells[y * this.cw + x] = 1;
    this.sum = null;
  }
  build() {
    const w = this.cw + 1;
    this.sum = new Int32Array(w * (this.ch + 1));
    for (let y = 0; y < this.ch; y++) for (let x = 0; x < this.cw; x++) this.sum[(y + 1) * w + x + 1] = this.cells[y * this.cw + x] + this.sum[y * w + x + 1] + this.sum[(y + 1) * w + x] - this.sum[y * w + x];
  }
  free(x0, y0, x1, y1) { // cell coords, exclusive end
    if (!this.sum) this.build();
    const w = this.cw + 1;
    return this.sum[y1 * w + x1] - this.sum[y0 * w + x1] - this.sum[y1 * w + x0] + this.sum[y0 * w + x0] === 0;
  }
}

/** Every op box of every frame except the backdrop, big plain panels and the excluded nodes. */
function occupancy(scenes, W, H, exclude) {
  const g = new Grid(W, H);
  for (const s of scenes) for (const it of s.items) {
    if (it.role === 'backdrop') continue;
    if (it.node && [...exclude].some((p) => it.node === p || it.node.startsWith(p + '/'))) continue;
    const panel = ['rect', 'poly', 'circle'].includes(it.op.op) && !it.handler && !it.moving && area(it.box) > 0.025 * W * H;
    if (panel) continue;
    if (it.op.op === 'line') continue;
    g.mark(it.box);
  }
  return g;
}

/** The free spot nearest `box` for a w×h box, searched band by band. Null when none. */
function findSlot(grid, box, w, h, bandOrder) {
  const { W, H } = grid;
  const cw = Math.ceil((w + 2 * PAD) / CELL), chh = Math.ceil((h + 2 * PAD) / CELL);
  for (const band of bandOrder) {
    const [a0, a1] = bandRanges(W, H)[band];
    const y0 = Math.ceil(a0 / CELL), y1 = Math.floor(a1 / CELL);
    let best = null;
    for (let cy = y0; cy + chh <= y1; cy++) for (let cx = 0; cx + cw <= grid.cw; cx++) {
      if (!grid.free(cx, cy, cx + cw, cy + chh)) continue;
      const x = cx * CELL + PAD, y = cy * CELL + PAD;
      const d = Math.abs(x - box.x0) + 1.5 * Math.abs(y - box.y0);
      if (!best || d < best.d) best = { x, y, d, band };
    }
    if (best && best.x + w <= W) return best;
  }
  return null;
}

const bandOf = (box, W, H) => { const r = bandRanges(W, H), c = (box.y0 + box.y1) / 2; return c < r.top[1] ? 'top' : c > r.bottom[0] ? 'bottom' : 'play'; };

// ---------------------------------------------------------------- the solver ----

function unionBox(scenes, ptr) {
  let b = null;
  for (const s of scenes) for (const it of s.items) {
    if (!it.node || (it.node !== ptr && !it.node.startsWith(ptr + '/'))) continue;
    b = b ? { x0: Math.min(b.x0, it.box.x0), y0: Math.min(b.y0, it.box.y0), x1: Math.max(b.x1, it.box.x1), y1: Math.max(b.y1, it.box.y1) } : { ...it.box };
  }
  return b;
}

/** The biggest box the unit draws in any single frame (a moving label's own size, not its path). */
function frameBox(scenes, ptr) {
  let w = 0, h = 0;
  for (const s of scenes) {
    let b = null;
    for (const it of s.items) {
      if (!it.node || (it.node !== ptr && !it.node.startsWith(ptr + '/'))) continue;
      b = b ? { x0: Math.min(b.x0, it.box.x0), y0: Math.min(b.y0, it.box.y0), x1: Math.max(b.x1, it.box.x1), y1: Math.max(b.y1, it.box.y1) } : { ...it.box };
    }
    if (b) { w = Math.max(w, b.x1 - b.x0); h = Math.max(h, b.y1 - b.y0); }
  }
  return w ? { w, h } : null;
}

/** Text ops' measured width per font size unit (for shrinking), from the frames. */
function textWidthAt(scenes, ptr) {
  for (const s of scenes) for (const it of s.items) if (it.node === ptr && it.op.op === 'text') return { w: it.box.x1 - it.box.x0, h: it.box.y1 - it.box.y0, size: it.op.size, color: it.op.color, text: it.op.text };
  return null;
}

function palette(game) {
  const t = game.presentation?.tokens ?? {};
  return [...Object.entries(t).filter(([, v]) => typeof v === 'string' && /^#[0-9a-f]{6}(ff)?$/i.test(v)).map(([k, v]) => ({ ref: `$${k}`, hex: v })), { ref: '#FFFFFF', hex: '#FFFFFF' }, { ref: '#111111', hex: '#111111' }];
}

/**
 * game: the game after the code fixes; report: the verifier's report on it (with its sample on
 * report._sample when the caller kept it, else opts.sample). Returns {game, moves: [{kind, node, detail}]}.
 */
export async function solveLayout(game, report, { sample = null, measures = null, engine = null } = {}) {
  const out = clone(game);
  const moves_ = [];
  const smp = sample ?? report._sample;
  const meas = measures ?? report._measures ?? null;
  if (!smp) return { game: out, moves: moves_ };
  const scenes = analyze(smp, game, meas);
  const W = game.presentation?.canvas?.w ?? 360, H = game.presentation?.canvas?.h ?? 640;
  const blocking = report.findings.filter((f) => f.severity === 'block');
  const done = new Set();

  // 1. Tap-through and overlapping targets: gate the covered target on the overlay's visibility.
  for (const f of blocking.filter((x) => (x.code === 'L_TAP_THROUGH' || x.code === 'L_OVERLAP_TARGETS') && x.node && x.other)) {
    const key = `gate|${f.node}|${f.other}`;
    if (done.has(key)) continue;
    done.add(key);
    const cond = visibleCond(out, f.other);
    const target = getAt(out, f.node);
    if (!cond || !target || /\/(cell|template|item|node)\//.test(f.other)) continue;
    if (hideWhile(target, cond)) moves_.push({ kind: 'gate', node: f.node, detail: `hidden while ${f.other} shows (${cond.slice(0, 60)})` });
  }

  // 2a. A row stack wider than the canvas (the HUD's "Round 3 of 10" beside "120 m" in a 340-wide
  // row): stack it as a column.
  for (const f of blocking.filter((x) => x.code === 'L_TEXT_CLIPPED' && x.node && nodePtr(x.node))) {
    const sp = nodePtr(f.node);
    const st = getAt(out, sp);
    if (!st || st.node !== 'stack' || (st.dir ?? 'column') !== 'row' || done.has(`col|${sp}`)) continue;
    done.add(`col|${sp}`);
    const box = unionBox(scenes, sp);
    if (box && box.x1 - box.x0 <= W - 4 && box.x0 >= -2 && box.x1 <= W + 2) continue;
    st.dir = 'column';
    if (isNum(st.gap ?? 0) && (st.gap ?? 0) > 6) st.gap = 4;
    moves_.push({ kind: 'column', node: sp, detail: 'row stack wider than the canvas → column' });
    done.add(`fit|${f.node}`);
  }

  // 2. Text that doesn't fit: shrink to the measured room, then wrap.
  for (const f of blocking.filter((x) => ['L_TEXT_OVERFLOW', 'L_TEXT_CLIPPED'].includes(x.code) && x.node)) {
    if (done.has(`fit|${f.node}`)) continue;
    done.add(`fit|${f.node}`);
    const t = getAt(out, f.node);
    const m = textWidthAt(scenes, f.node);
    if (!t || t.node !== 'text' || !m) continue;
    const room = f.container ? f.container.w - 6 : roomOnCanvas(m, f.box, W);
    if (!(room > 0) || m.w <= room) continue;
    const k = room / m.w;
    const size = isNum(t.size) ? t.size : t.size === undefined ? 16 : null;
    if (size != null && Math.floor(size * k) >= MIN_TEXT) { t.size = Math.floor(size * k); moves_.push({ kind: 'fit', node: f.node, detail: `size ${size} → ${t.size}` }); continue; }
    if (size != null && size > MIN_TEXT) t.size = MIN_TEXT;
    else if (isExpr(t.size)) t.size = `= max(${MIN_TEXT}, (${t.size.slice(1).trim()}) * ${+k.toFixed(3)})`;
    if (t.w === undefined && !t.wrap) { t.w = Math.max(40, Math.floor(room)); t.wrap = true; }
    moves_.push({ kind: 'fit', node: f.node, detail: `size → ${MIN_TEXT}, wrapped in ${Math.floor(room)}` });
  }

  // 3. Slots for overlapping UI text.
  const want = [];
  for (const f of blocking.filter((x) => SLOT_CODES.has(x.code))) {
    let ptr = f.code === 'L_OVERLAP_HUD' ? f.other : f.node;
    if (f.code === 'L_OVERLAP_TEXT') ptr = pickMover(out, f.node, f.other);
    if (!ptr) continue;
    const unit = movableUnit(out, ptr);
    if (!unit || want.some((w) => w.unit === unit)) continue;
    want.push({ unit, code: f.code });
  }
  if (want.length) {
    const grid = occupancy(scenes, W, H, new Set(want.map((w) => w.unit)));
    for (const w of want) {
      const path = unionBox(scenes, w.unit);
      const own = frameBox(scenes, w.unit);
      if (!path || !own) continue;
      // A unit that moves (a label riding a sprite, a popup) is pinned to a fixed slot instead.
      const moves = path.x1 - path.x0 > own.w + 4 || path.y1 - path.y0 > own.h + 4;
      const bw = Math.min(W - 2 * PAD, own.w), bh = own.h;
      if (bh > 0.3 * H) continue; // not a UI block
      const home = bandOf(path, W, H);
      const order = [home, ...['top', 'bottom', 'play'].filter((b) => b !== home)];
      let slot = findSlot(grid, path, bw, bh, order);
      let shrink = 1;
      if (!slot) {
        const sizes = textSizes(out, w.unit);
        const k = sizes.length ? Math.max(...sizes.map((x) => MIN_TEXT / x)) : 1;
        if (k < 1) { shrink = Math.max(k, 0.6); slot = findSlot(grid, path, bw * shrink, bh * shrink, order); }
      }
      if (!slot) continue;
      if (moves) {
        const z = zeroBox(engine, out, w.unit);
        if (!z) continue;
        const n = getAt(out, w.unit);
        n.x = +(slot.x - z.box.x0).toFixed(2); n.y = +(slot.y - z.box.y0).toFixed(2);
      } else if (!translate(out, w.unit, slot.x - path.x0, slot.y - path.y0)) continue;
      if (shrink < 1) scaleText(out, w.unit, shrink);
      grid.mark({ x0: slot.x - PAD, y0: slot.y - PAD, x1: slot.x + bw * shrink + PAD, y1: slot.y + bh * shrink + PAD });
      moves_.push({ kind: moves ? 'pin' : 'slot', node: w.unit, detail: `${w.code}: ${moves ? 'pinned at' : 'moved to'} ${slot.x.toFixed(0)}, ${slot.y.toFixed(0)} in the ${slot.band} band${shrink < 1 ? `, text × ${shrink.toFixed(2)}` : ''}` });
    }
  }

  // 4. Contrast that's still under 3:1: an outline far from the text's own color.
  for (const f of blocking.filter((x) => x.code === 'L_LOW_CONTRAST' && x.node)) {
    if (done.has(`ink|${f.node}`)) continue;
    done.add(`ink|${f.node}`);
    const t = getAt(out, f.node);
    const m = textWidthAt(scenes, f.node);
    const fg = parseColor(m?.color)?.slice(0, 3);
    if (!t || t.node !== 'text' || !fg) continue;
    const best = palette(out).map((p) => ({ ...p, c: contrast(parseColor(p.hex).slice(0, 3), fg) })).sort((a, b) => b.c - a.c)[0];
    t.stroke = best.ref; t.stroke_width = Math.max(3, Math.round((isNum(t.size) ? t.size : 16) * 0.2));
    moves_.push({ kind: 'outline', node: f.node, detail: `${best.ref} outline (${best.c.toFixed(1)}:1 with the text)` });
  }

  // 5. Targets: grow small ones and widen gaps where the canvas has room.
  for (const f of blocking.filter((x) => (x.code === 'L_TARGET_SMALL' || x.code === 'L_TARGET_GAP') && x.node)) {
    const key = `${f.code}|${f.node}`;
    if (done.has(key)) continue;
    done.add(key);
    const r = growTarget(out, f, W, H);
    if (r) moves_.push(r);
  }
  // Each move edits only the subtree at its node: its patch is that subtree, so moves can be tried
  // one at a time (verify.mjs keeps the ones that help).
  for (const m of moves_) m.patch = clone(getAt(out, m.node));
  return { game: out, moves: moves_ };
}

/** Puts `node` at JSON pointer `ptr` in `game` (mutates). */
export function setAt(game, ptr, node) {
  const parts = ptr.split('/').slice(1);
  let cur = game;
  for (const p of parts.slice(0, -1)) cur = cur[p];
  cur[parts.at(-1)] = node;
}

function roomOnCanvas(m, box, W) {
  if (!box) return W - 8;
  const c = box.x + box.w / 2;
  return Math.max(40, 2 * Math.min(c, W - c) - 8);
}

function textSizes(game, ptr) {
  const out = [];
  walkNodes(getAt(game, ptr), (n) => { if (n.node === 'text') out.push(isNum(n.size) ? n.size : 16); }, ptr);
  return out;
}
function scaleText(game, ptr, k) {
  walkNodes(getAt(game, ptr), (n) => {
    if (n.node !== 'text') return;
    if (isNum(n.size) || n.size === undefined) n.size = Math.max(MIN_TEXT, Math.floor((n.size ?? 16) * k));
    else if (isExpr(n.size)) n.size = `= max(${MIN_TEXT}, (${n.size.slice(1).trim()}) * ${+k.toFixed(3)})`;
  }, ptr);
}

/** Of two overlapping texts, the one to move: not in a template, not bound in place, the shorter. */
function pickMover(game, a, b) {
  const score = (p) => {
    if (!p) return -1;
    if (/\/(cell|template|item|node)(\/|$)/.test(p)) return -1;
    const unit = movableUnit(game, p);
    if (!unit) return -1;
    const n = getAt(game, unit);
    let s = 1;
    if (isNum(n.x ?? 0) && isNum(n.y ?? 0)) s += 1;
    return s;
  };
  const sa = score(a), sb = score(b);
  if (sa < 0 && sb < 0) return null;
  return sa > sb ? a : b; // ties: the later-drawn one (the finding's node)
}

/** The expression under which the node at `ptr` (or an ancestor) shows; null when always shown. */
function visibleCond(game, ptr) {
  const conds = [];
  let p = ptr;
  for (let guard = 0; guard < 16 && p && p.startsWith('/presentation/root'); guard++) {
    const n = getAt(game, p);
    if (n && isExpr(n.visible)) conds.push(`(${n.visible.slice(1).trim()})`);
    if (n && n.visible === false) return null;
    p = nodePtr(p);
  }
  return conds.length ? conds.join(' and ') : null;
}

/**
 * A target in a list template (`repeat`): grow it to 40 and widen the list's pitch (the number the
 * item variable is multiplied by in y, or x) so items keep an 8 pt gap. Labels in the item move with
 * the pitch; the rect grows about its center.
 */
function growTemplate(game, f) {
  const m = /^(.*)\/template(\/.*)?$/.exec(f.node);
  if (!m) return null;
  const rep = getAt(game, m[1]);
  const v = rep?.as;
  if (!rep || rep.node !== 'repeat' || !v) return null;
  const n = getAt(game, f.node);
  if (!n || !isNum(n.h) || !isNum(n.w)) return null;
  const axis = n.h <= n.w ? 'y' : 'x', size = axis === 'y' ? 'h' : 'w';
  const old = n[size];
  const want = Math.max(old, MIN_TARGET);
  const varRe = new RegExp(`\\b${v}\\b`);
  const pitchRe = /\*\s*(\d+(?:\.\d+)?)/g;
  let pitch = null;
  walkNodes(getAt(game, `${m[1]}/template`), (x) => {
    const e = x[axis];
    if (!isExpr(e) || !varRe.test(e)) return;
    for (const mm of e.matchAll(pitchRe)) { const P = +mm[1]; if (P >= old && P <= old + 40) pitch = pitch ?? P; }
  }, `${m[1]}/template`);
  if (pitch == null) return null;
  const newPitch = Math.max(pitch, want + MIN_GAP + 1);
  if (newPitch === pitch && want === old) return null;
  walkNodes(getAt(game, `${m[1]}/template`), (x) => {
    const e = x[axis];
    if (isExpr(e) && varRe.test(e)) x[axis] = e.replace(pitchRe, (all, P) => (+P === pitch ? `* ${newPitch}` : all));
  }, `${m[1]}/template`);
  if (want > old) {
    n[size] = want;
    const d = (want - old) / 2;
    if (n.anchor !== 'center') addTo(n, axis, -d);
  }
  return { kind: 'list', node: m[1], detail: `list item ${size} ${old} → ${want}, pitch ${pitch} → ${newPitch}` };
}

function growTarget(game, f, W, H) {
  const n = getAt(game, f.node);
  if (!n) return null;
  if (/\/template(\/|$)/.test(f.node)) return growTemplate(game, f);
  // A grid of tap cells: cell size and gap, kept inside the canvas.
  const gridPtr = /\/cell(\/|$)/.test(f.node) ? f.node.slice(0, f.node.indexOf('/cell')) : null;
  if (gridPtr) {
    const g = getAt(game, gridPtr);
    if (!g || !isNum(g.cols) || !isNum(g.cell_size)) return null;
    const gap = Math.max(g.gap ?? 0, f.code === 'L_TARGET_GAP' ? MIN_GAP : g.gap ?? 0);
    const cs = Math.max(g.cell_size, f.code === 'L_TARGET_SMALL' ? MIN_TARGET : g.cell_size);
    const width = g.cols * cs + (g.cols - 1) * gap;
    if (width > W - 8 || (cs === g.cell_size && gap === (g.gap ?? 0))) return null;
    const oldW = g.cols * g.cell_size + (g.cols - 1) * (g.gap ?? 0);
    g.cell_size = cs; g.gap = gap;
    if (isNum(g.x ?? 0)) g.x = Math.max(4, Math.round((g.x ?? 0) - (width - oldW) / 2));
    return { kind: 'grid', node: gridPtr, detail: `cell ${cs}, gap ${gap}` };
  }
  if (f.code === 'L_TARGET_GAP') {
    const parent = nodePtr(f.node) ? getAt(game, nodePtr(f.node)) : null;
    if (parent?.node === 'stack' && isNum(parent.gap ?? 0) && (parent.gap ?? 0) < MIN_GAP + 1) { parent.gap = MIN_GAP + 1; return { kind: 'gap', node: nodePtr(f.node), detail: `stack gap → ${MIN_GAP + 1}` }; }
    return null;
  }
  // A plain button: its own w/h, grown about its center when literal.
  const b = f.box;
  if (!b) return null;
  let changed = false;
  for (const [k, pos] of [['w', 'x'], ['h', 'y']]) {
    if (isNum(n[k]) && n[k] < MIN_TARGET && isNum(n[pos] ?? 0)) {
      const d = MIN_TARGET - n[k];
      n[k] = MIN_TARGET;
      if (n.anchor !== 'center') n[pos] = +((n[pos] ?? 0) - d / 2).toFixed(2);
      changed = true;
    }
  }
  return changed ? { kind: 'grow', node: f.node, detail: `target grown to ≥ ${MIN_TARGET}` } : null;
}
