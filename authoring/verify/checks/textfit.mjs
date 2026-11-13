// L_TEXT_FIT: no text may leave the canvas's safe margin, its panel or button, or run into other
// text, with the LONGEST content the game can show (FC-04, docs/games/FAILURE_CLASSES.md). Blocking.
//
// The frame lint (checks/layout.mjs) judges the strings the bots happened to see. This check also
// builds a worst-case copy of the game: every string pool (a list<string> state literal, or a
// function whose body is a list of strings) has each entry replaced by the pool's widest entry, so
// every question, answer and name on screen is the longest one. Both the real frames and the
// worst-case frames are measured (Chrome-free: per-font average advances from kit/font-data.mjs) and
// each text op's glyph box is checked:
//   canvas   ink outside the canvas less TEXT_MARGIN (12 units) on any side;
//   box      ink past the panel or button it is written on (the smallest opaque rect drawn before it
//            that holds its declared box), by more than 2 units;
//   overlap  (worst case only) two texts' ink overlapping where they don't with the real content.
// The fix (textFitFix, a verifyAndFix stage) shrinks the node to the room on the game's own scale
// (not under 70 % or 11 units), then wraps it in that room; a panel is never moved. Presentation only.
//
// The runtime draws every text op through the same rule (engine/web/render.js fitText), so old games
// never draw outside the canvas either; this check keeps new games from leaning on that safety net
// (which shrinks or ellipsizes).

import { finding } from '../registry.mjs';
import { analyze, area, iarea, inter, rbox, clip, opacityOf } from '../scene.mjs';
import { FONT_DATA } from '../../kit/font-data.mjs';

export const TEXT_MARGIN = 12;
export const CODE = 'L_TEXT_FIT';
const MIN_SIZE = 11;
const MIN_SCALE = 0.7;

// ---------------------------------------------------------------- measuring ----

const byFamily = new Map(Object.values(FONT_DATA).map((f) => [f.family.toLowerCase(), f]));
const EMOJI = /\p{Extended_Pictographic}/u;

/** A line's width at `size` (canvas units), from the font's average advance per character. */
export function measureLine(line, size, weight = 400, font = '') {
  const f = byFamily.get(String(font ?? '').toLowerCase()) ?? null;
  const pick = (tbl) => {
    if (!tbl) return null;
    const ws = Object.keys(tbl).map(Number).sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight));
    return tbl[ws[0]];
  };
  const letters = [...String(line)];
  const caps = f?.caps || (letters.some((c) => /\p{L}/u.test(c)) && String(line) === String(line).toUpperCase());
  const avg = (caps ? pick(f?.avgCaps) : pick(f?.avg)) ?? (weight >= 600 ? 0.58 : 0.55) * (caps ? 1.12 : 1);
  let w = 0;
  for (const c of letters) w += EMOJI.test(c) ? 1.2 : c === ' ' ? 0.28 : /[il.,:;'!|]/.test(c) ? avg * 0.5 : /[mwMW@%]/.test(c) ? avg * 1.45 : avg;
  return w * size;
}

/** The glyph box of a text op with these widths (as the renderer places it, before its fit). */
export function inkBox(op, widths) {
  const lines = String(op.text).split('\n');
  const w = Math.max(0, ...widths);
  const lh = op.line_height || op.size * 1.25;
  const blockH = lh * lines.length;
  const x0 = op.align === 'left' ? op.x : op.align === 'right' ? op.x + op.w - w : op.x + op.w / 2 - w / 2;
  const y0 = op.valign === 'top' ? op.y : op.valign === 'bottom' ? op.y + op.h - blockH : op.y + (op.h - blockH) / 2;
  const pad = (lh - op.size) / 2;
  return { x0, y0: y0 + pad, x1: x0 + w, y1: y0 + blockH - pad };
}

const opWidths = (op) => String(op.text).split('\n').map((l) => measureLine(l, op.size, op.weight, op.font));

// ---------------------------------------------------------------- worst case ----

const STR = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/y;
/** A list literal of strings (`['a', 'b']`) → its raw literals, else null. */
export function stringList(src) {
  if (typeof src !== 'string') return null;
  const s = src.trim().replace(/^=\s*/, '');
  if (!s.startsWith('[') || !s.endsWith(']')) return null;
  const out = [];
  let i = 1;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  ws();
  if (s[i] === ']') return null;
  for (;;) {
    ws();
    STR.lastIndex = i;
    const m = STR.exec(s);
    if (!m) return null;
    out.push(m[0]);
    i = STR.lastIndex;
    ws();
    if (s[i] === ',') { i++; continue; }
    if (s[i] === ']' && i === s.length - 1) return out;
    return null;
  }
}
const unquote = (lit) => lit.slice(1, -1).replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));

/** The game with every string pool's entries replaced by the pool's widest entry. {game, pools}. */
export function worstCaseGame(game) {
  const g = JSON.parse(JSON.stringify(game));
  let pools = 0;
  const widest = (lits) => lits.reduce((a, b) => (measureLine(unquote(b), 10) > measureLine(unquote(a), 10) ? b : a));
  const rewrite = (src) => {
    const lits = stringList(src);
    if (!lits || lits.length < 2) return null;
    const w = widest(lits);
    if (lits.every((l) => l === w)) return null;
    pools++;
    return `${src.trim().startsWith('=') ? '= ' : ''}[${lits.map(() => w).join(', ')}]`;
  };
  for (const v of Object.values(g.state ?? {})) {
    if (!v || typeof v !== 'object' || !/list<string>/.test(String(v.type ?? ''))) continue;
    const r = rewrite(v.init);
    if (r) v.init = r;
  }
  for (const f of Object.values(g.functions ?? {})) {
    if (!f || typeof f !== 'object' || !/list<string>/.test(String(f.returns ?? ''))) continue;
    const r = rewrite(f.body);
    if (r) f.body = r;
  }
  return { game: g, pools };
}

// ---------------------------------------------------------------- findings ----

const visibleText = (it) => it.op.op === 'text' && String(it.op.text).trim() && (it.op.opacity ?? 1) > 0.1 && it.role !== 'backdrop';

/**
 * Raw findings on one sample: [{kind, node, frame, box, room, need, message, other?}].
 * `pairsOk` (a Set of "a|b" node pairs that overlap already in the real frames) skips those.
 */
export function fitFindings(sample, game, { overlap = false, pairsOk = null, worst = false } = {}) {
  const out = [];
  const pairs = new Set();
  const M = TEXT_MARGIN;
  for (const s of analyze(sample, game, null)) {
    const { items, W, H } = s;
    const texts = [];
    for (const it of items) {
      if (!visibleText(it)) continue;
      const op = it.op;
      const ws = opWidths(op);
      const ink = inkBox(op, ws);
      const cx = op.x + op.w / 2, cy = op.y + op.h / 2;
      const on = cx >= 0 && cx <= W && cy >= 0 && cy <= H;
      texts.push({ it, ink, need: Math.max(0, ...ws) });
      if (!on || (op.scale ?? 1) < 0.5) continue; // sliding in or out, or popping in
      const where = worst ? 'with the longest content' : 'as played';
      if (ink.x0 < M - 1 || ink.x1 > W - M + 1 || ink.y0 < M - 4 || ink.y1 > H - M + 4) {
        // Room: the canvas less the margin, from the text's anchor.
        const room = op.align === 'left' ? W - M - Math.max(op.x, M) : op.align === 'right' ? Math.min(op.x + op.w, W - M) - M : 2 * Math.min(cx - M, W - M - cx);
        out.push({ kind: 'canvas', node: it.node, frame: s.f.key, box: rbox(ink), need: Math.ceil(Math.max(0, ...ws)), room: Math.max(0, Math.floor(Math.min(room, W - 2 * M))), lines: ws.length, _op: op,
          message: `"${clip(op.text)}" runs past the canvas's ${M}-unit margin ${where} (${Math.round(Math.max(0, ...ws))} wide)` });
        continue;
      }
      // The panel or button it is written on.
      const decl = { x0: op.x, y0: op.y, x1: op.x + Math.max(op.w, 1), y1: op.y + Math.max(op.h, 1) };
      let panel = null;
      for (const p of items) {
        if (p.i >= it.i || p.op.op !== 'rect' || p.role === 'backdrop' || opacityOf(p.op) < 0.5) continue;
        if (area(p.box) > 0.5 * W * H || p.box.x1 - p.box.x0 < 40 || p.box.y1 - p.box.y0 < op.size) continue;
        // It holds the text's anchor and its line(s) vertically (a box-less label's w is its own width).
        const vin = Math.min(decl.y1, p.box.y1) - Math.max(decl.y0, p.box.y0);
        if (!(cx >= p.box.x0 && cx <= p.box.x1 && cy >= p.box.y0 && cy <= p.box.y1) || vin < 0.9 * (decl.y1 - decl.y0)) continue;
        if (op.w > 0 && op.w <= p.box.x1 - p.box.x0 && iarea(decl, p.box) < 0.9 * area(decl)) continue;
        if (!panel || area(p.box) < area(panel.box)) panel = p;
      }
      if (panel) {
        const b = panel.box;
        const over = Math.max(b.x0 - ink.x0, ink.x1 - b.x1, b.y0 - ink.y0, ink.y1 - b.y1);
        if (over > 2) {
          out.push({ kind: 'box', node: it.node, other: panel.node, frame: s.f.key, box: rbox(ink), need: Math.ceil(Math.max(0, ...ws)), room: Math.max(0, Math.floor(b.x1 - b.x0 - 8)), roomH: Math.floor(b.y1 - b.y0 - 4), lines: ws.length, _op: op, _panel: b,
            message: `"${clip(op.text)}" sticks out of its ${panel.handler ? 'button' : 'panel'} by ${Math.round(over)} units ${where}` });
        }
      }
    }
    // Text over text.
    for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) {
      const A = texts[a], B = texts[b];
      if (A.it.op.text === B.it.op.text) continue; // a drop shadow
      const ia = iarea(A.ink, B.ink);
      if (ia < Math.max(6, 0.1 * Math.min(area(A.ink), area(B.ink)))) continue;
      const r = inter(A.ink, B.ink);
      const lo = Math.min(A.it.i, B.it.i), hi = Math.max(A.it.i, B.it.i);
      if (items.some((x) => x.i > lo && x.i < hi && (x.op.op === 'rect' || x.op.op === 'image') && opacityOf(x.op) > 0.85 && iarea(x.box, r) >= 0.9 * area(r))) continue; // an overlay between
      const key = [A.it.node ?? A.it.op.text, B.it.node ?? B.it.op.text].sort().join('|');
      pairs.add(key);
      if (!overlap || pairsOk?.has(key)) continue;
      // The longer of the two is the one to fit.
      const [T, O] = A.need * A.it.op.size >= B.need * B.it.op.size ? [A, B] : [B, A];
      out.push({ kind: 'overlap', node: T.it.node, other: O.it.node, frame: s.f.key, box: rbox(r), need: Math.ceil(T.need), room: Math.max(0, Math.floor(T.need - (r.x1 - r.x0) - 4)), lines: 1, _op: T.it.op, _otherInk: O.ink,
        message: `"${clip(T.it.op.text)}" runs into "${clip(O.it.op.text)}" with the longest content` });
    }
  }
  return { findings: out, pairs };
}

/** Real frames + worst-case frames → merged raw findings (one per node and kind, the worst kept). */
export async function textFitFindings(game, sample, { engine = null, worstSample = null, maxSeconds = 40 } = {}) {
  const real = fitFindings(sample, game);
  let worst = { findings: [] };
  const wc = worstCaseGame(game);
  if (wc.pools) {
    let ws = worstSample;
    if (!ws) {
      const { sampleDense } = await import('../frames.mjs');
      try { ws = await sampleDense(wc.game, { engine, maxSeconds, every: 12 }); } catch { ws = null; }
    }
    if (ws) worst = fitFindings(ws, wc.game, { overlap: true, pairsOk: real.pairs, worst: true });
  }
  const best = new Map();
  for (const f of [...real.findings, ...worst.findings]) {
    const k = `${f.kind}|${f.node ?? f.box?.x}`;
    const p = best.get(k);
    if (!p) best.set(k, { ...f, frames: 1 });
    else { p.frames++; if (f.need - f.room > p.need - p.room) Object.assign(p, { ...f, frames: p.frames }); }
  }
  return { findings: [...best.values()], pools: wc.pools };
}

// ---------------------------------------------------------------- the fix ----

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isExpr = (v) => typeof v === 'string' && v.startsWith('=');
function getAt(obj, ptr) {
  let cur = obj;
  for (const part of ptr.split('/').slice(1)) { if (cur == null) return undefined; cur = cur[part.replace(/~1/g, '/').replace(/~0/g, '~')]; }
  return cur;
}

/**
 * Shrinks each flagged text node to its room (onto the largest allowed size that fits, when
 * `sizes` lists the game's scale), not under 70 % or 11 units; what still doesn't fit is wrapped in
 * the room (a `w`, `wrap: true`). Returns {game, fixes}.
 */
export function textFitFix(game, findings, { sizes = null } = {}) {
  const out = JSON.parse(JSON.stringify(game));
  const fixes = [];
  const done = new Set();
  const sorted = [...findings].filter((f) => f.node).sort((a, b) => (b.need - b.room) - (a.need - a.room));
  for (const f of sorted) {
    if (done.has(f.node)) continue;
    done.add(f.node);
    const t = getAt(out, f.node);
    if (!t || t.node !== 'text' || !(f.room > 0) || !(f.need > f.room)) continue;
    const k = Math.max(MIN_SCALE, f.room / f.need);
    let detail = '';
    if (isNum(t.size) || t.size === undefined) {
      const size = t.size ?? 16;
      let next = Math.max(MIN_SIZE, Math.floor(size * k));
      if (sizes?.length) { const ok = sizes.filter((s) => s <= next && s >= Math.min(MIN_SIZE, next)).sort((a, b) => b - a)[0]; if (ok) next = ok; }
      if (next < size) { t.size = next; detail = `size ${size} → ${next}`; }
    } else if (isExpr(t.size)) {
      t.size = `= max(${MIN_SIZE}, (${t.size.slice(1).trim()}) * ${+k.toFixed(3)})`;
      detail = `size × ${k.toFixed(2)}`;
    }
    if (f.room / f.need < MIN_SCALE || f.kind === 'overlap') {
      // Still too wide at 70 %: wrap it in the room.
      if (!isExpr(t.w) && (t.w === undefined || t.w > f.room)) {
        if (t.w !== undefined && isNum(t.x) && t.align !== 'left') t.x += t.align === 'right' ? t.w - f.room : (t.w - f.room) / 2;
        t.w = f.room;
      }
      if (!t.wrap && !isExpr(t.w)) { t.wrap = true; if (isNum(t.h) && f.roomH > t.h) t.h = Math.min(f.roomH, t.h * 2); }
      detail += `${detail ? ', ' : ''}wrapped in ${f.room}`;
    }
    if (detail) fixes.push({ kind: 'text-fit', node: f.node, code: CODE, detail: `${f.kind}: ${detail}` });
  }
  return { game: out, fixes };
}

// ---------------------------------------------------------------- the check ----

export const check = {
  id: 'textfit',
  family: 'L',
  needs: ['frames'],
  codes: {
    [CODE]: {
      severity: 'block',
      title: `text past the canvas's ${TEXT_MARGIN}-unit margin, out of its panel or button, or over other text, with the longest content the game can show`,
      hint: 'set the text node a smaller size on the scale, or a w with wrap: true inside its panel; size boxes for the longest string in each content pool (textFitFix does this)',
    },
  },
  async run(ctx) {
    const { findings } = await textFitFindings(ctx.game, ctx.sample, { engine: ctx.engine });
    return findings.map((f) => finding(CODE, { node: f.node, frame: f.frame, frames: f.frames, message: f.message, kind: f.kind, box: f.box, need: f.need, room: f.room, roomH: f.roomH, other: f.other ?? undefined }));
  },
};
