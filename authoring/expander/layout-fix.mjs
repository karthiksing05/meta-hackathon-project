// Layout fixes that need no Muse: a pass over a flat microgame game.json (after expand, before the
// gate). It is the fallback for games that don't use the UI kit's components (the kit's text-fit
// tiles, HUD bar and buttons do the same jobs by construction).
//
// Static fixes, from the tree alone:
//   - fit:       a label on a tile or button shrinks with its length (down to 11), then wraps in the
//                tile's width (text w + wrap: true);
//   - center:    a label that a cell template anchors on its tile's corner moves to the tile's center
//                (the grid_board "x = cell_size" slip);
//   - gap:       stacks and grids of tap targets get at least a 6-unit gap.
// Fixes driven by the layout lint's findings (layout-check.mjs), run here when not given:
//   - contrast:  low-contrast text is recolored to the palette color that reads best on the measured
//                backdrop when that backdrop is even; otherwise it gets a solid plate (or an outline
//                when a plate can't be placed);
//   - hud_panel: when moving sprites cross the HUD, the HUD's top-level nodes are drawn last on a
//                solid panel (Bayan's finding: a solid panel beats repainting the art).
// Presentation only: rules, state and inputs are untouched, so seeds and replays still verify.
// Each fix is validated with the engine and dropped if the game stops loading.

import { loadEngine } from './engine.mjs';
import { layoutCheck, instrument, walkNodes, parseColor, contrast, MIN_TEXT } from '../playtest/layout-check.mjs';

const CHAR_EM = 0.63; // the engine's bold width per character (0.6 × 1.05)
const MIN_GAP_FIX = 6;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isExpr = (v) => typeof v === 'string' && v.startsWith('=');
const clone = (v) => JSON.parse(JSON.stringify(v));

export function getAt(obj, ptr) {
  let cur = obj;
  for (const part of ptr.split('/').slice(1)) { if (cur == null) return undefined; cur = cur[part.replace(/~1/g, '/').replace(/~0/g, '~')]; }
  return cur;
}
const parentPtr = (ptr) => ptr.slice(0, ptr.lastIndexOf('/'));

function tokenColor(game, v) {
  if (typeof v !== 'string') return null;
  if (v.startsWith('$')) return game.presentation?.tokens?.[v.slice(1)] ?? null;
  return v.startsWith('#') ? v : null;
}
function paletteCandidates(game) {
  const t = game.presentation?.tokens ?? {};
  return [...Object.entries(t).filter(([, v]) => typeof v === 'string' && v.startsWith('#')).map(([k, v]) => ({ ref: `$${k}`, hex: v })), { ref: '#FFFFFF', hex: '#FFFFFF' }, { ref: '#111111', hex: '#111111' }];
}
const rgb = (hex) => parseColor(hex)?.slice(0, 3);

// ---------------------------------------------------------------- static fixes ----

function containerOf(siblings, idx) {
  // The first rect or image sibling before the text with a literal size: the tile the text sits on.
  for (let i = 0; i < idx; i++) {
    const s = siblings[i];
    if (!s || !['rect', 'image'].includes(s.node) || !isNum(s.w) || !isNum(s.h)) continue;
    if ((s.x !== undefined && !isNum(s.x)) || (s.y !== undefined && !isNum(s.y)) || s.anchor === 'center') continue;
    return { x: s.x ?? 0, y: s.y ?? 0, w: s.w, h: s.h };
  }
  return null;
}

/** Fits tile and button labels; centers labels anchored on their tile's corner. Mutates `game`. */
export function fitText(game) {
  const fixes = [];
  walkNodes(game.presentation?.root, (node, ptr, parents) => {
    const p = parents.at(-1)?.node;
    if (!p || !Array.isArray(p.children)) return;
    const idx = p.children.indexOf(node);
    p.children.forEach((t, i) => {
      if (i !== idx || t.node !== 'text' || t.anchor !== 'center' || !isNum(t.x) || !isNum(t.y)) return;
      const c = containerOf(p.children, i);
      if (!c) return;
      const inTemplate = parents.some((q) => ['grid', 'repeat'].includes(q.node.node));
      const fx = (t.x - c.x) / c.w, fy = (t.y - c.y) / c.h;
      if (fx < -0.05 || fx > 1.05 || fy < -0.05 || fy > 1.05) return; // a caption beside the tile, not on it
      if (inTemplate && (fx >= 0.9 || fx <= 0.1) && (fy >= 0.9 || fy <= 0.1)) {
        t.x = c.x + c.w / 2; t.y = c.y + c.h / 2;
        fixes.push({ kind: 'center', node: ptr, detail: `label moved from the tile's corner to its center (${t.x}, ${t.y})` });
      }
      if (t.w !== undefined || t.wrap) return;
      const size = isNum(t.size) ? t.size : t.size === undefined ? 16 : null;
      if (size == null) return;
      const avail = Math.max(8, c.w - 8);
      if (typeof t.text === 'string' && !isExpr(t.text)) {
        const chars = Math.max(1, [...t.text].length);
        const fit = Math.floor(avail / (chars * CHAR_EM));
        if (fit >= size) return;
        if (fit >= MIN_TEXT) { t.size = fit; fixes.push({ kind: 'fit', node: ptr, detail: `"${t.text}" ${size} → ${fit}` }); return; }
        t.size = MIN_TEXT; t.w = avail; t.wrap = true;
        fixes.push({ kind: 'fit', node: ptr, detail: `"${t.text}" ${size} → ${MIN_TEXT}, wrapped in ${avail}` });
        return;
      }
      if (!isExpr(t.text) || size <= MIN_TEXT) return;
      const expr = t.text.slice(1).trim();
      t.size = `= max(${MIN_TEXT}, min(${size}, ${avail} / (max(1, len(${expr})) * ${CHAR_EM})))`;
      t.w = avail; t.wrap = true;
      fixes.push({ kind: 'fit', node: ptr, detail: `bound label shrinks with its length (${size} → ${MIN_TEXT} min) and wraps in ${avail}` });
    });
  });
  return fixes;
}

/** Stacks and grids of tap targets get a minimum gap. Mutates `game`. */
export function spaceTargets(game) {
  const fixes = [];
  const W = game.presentation?.canvas?.w ?? 360;
  const interactive = (n) => { let hit = false; walkNodes(n, (x) => { if (x.on_tap || x.on_press || x.on_drag) hit = true; }); return hit; };
  walkNodes(game.presentation?.root, (node, ptr) => {
    if (node.node === 'stack' && isNum(node.gap ?? 0) && (node.gap ?? 0) < MIN_GAP_FIX && (node.children ?? []).filter(interactive).length >= 2) {
      fixes.push({ kind: 'gap', node: ptr, detail: `stack gap ${node.gap ?? 0} → ${MIN_GAP_FIX}` });
      node.gap = MIN_GAP_FIX;
    }
    if (node.node === 'grid' && isNum(node.gap ?? 0) && (node.gap ?? 0) < 4 && isNum(node.cols) && isNum(node.cell_size) && isNum(node.x ?? 0) && node.cell && interactive(node.cell)) {
      const old = node.gap ?? 0, gap = 4;
      const oldW = node.cols * node.cell_size + (node.cols - 1) * old, newW = node.cols * node.cell_size + (node.cols - 1) * gap;
      if (newW > W) return;
      const x0 = node.x ?? 0;
      const centered = Math.abs(x0 + oldW / 2 - W / 2) < 6;
      node.gap = gap;
      if (centered || x0 + newW > W) node.x = Math.max(0, Math.round((W - newW) / 2));
      fixes.push({ kind: 'gap', node: ptr, detail: `grid gap ${old} → ${gap}` });
    }
  });
  return fixes;
}

// ---------------------------------------------------------------- finding-driven fixes ----

/** Recolor, plate or outline text the lint found hard to read. Mutates `game`. */
export function fixContrast(game, findings) {
  const fixes = [];
  const done = new Set();
  const palette = paletteCandidates(game);
  // Plates are inserted into parents' children lists: do deeper and later pointers first.
  const list = findings.filter((f) => f.code === 'L_LOW_CONTRAST' && f.node && !done.has(f.node)).sort((a, b) => b.node.localeCompare(a.node, undefined, { numeric: true }));
  for (const f of list) {
    if (done.has(f.node)) continue;
    done.add(f.node);
    const t = getAt(game, f.node);
    if (!t || t.node !== 'text') continue;
    const back = rgb(f.backdrop ?? '#808080');
    const cur = tokenColor(game, t.color);
    // Even backdrop: the palette color that reads best on it. Not for a template node (a key, a
    // cell): the finding saw one instance, and its siblings may sit on other fills; those get an
    // outline, which reads on any fill.
    const inTemplate = /\/(cell|template|item|node)(\/|$)/.test(f.node);
    if ((f.backdrop_spread ?? 9) < 1.6 && !isExpr(t.color) && !inTemplate) {
      const best = palette.map((p) => ({ ...p, c: contrast(rgb(p.hex), back) })).sort((a, b) => b.c - a.c)[0];
      const size = isNum(t.size) ? t.size : 16;
      if (best && best.c >= (size >= 18 ? 3 : 4.5)) {
        fixes.push({ kind: 'contrast', node: f.node, recolor: { from: t.color }, detail: `color ${t.color} → ${best.ref} (${best.c.toFixed(1)}:1 on ${f.backdrop})` });
        t.color = best.ref; continue;
      }
    }
    if (!cur) continue; // a bound color: nothing safe to do in code
    const plate = palette.map((p) => ({ ...p, c: contrast(rgb(p.hex), rgb(cur)) })).sort((a, b) => b.c - a.c)[0];
    const parent = getAt(game, parentPtr(parentPtr(f.node)));
    const siblings = getAt(game, parentPtr(f.node));
    const size = isNum(t.size) ? t.size : 16;
    // A plate is a big change (it can cover a neighbor): only for text that is close to invisible.
    const canPlate = (f.contrast ?? 0) < 2 && parent && parent.node === 'group' && Array.isArray(siblings) && isNum(t.x) && isNum(t.y) && t.w === undefined && !t.wrap;
    if (canPlate) {
      const chars = typeof t.text === 'string' && !isExpr(t.text) ? [...t.text].length : null;
      const wExpr = chars != null ? Math.round(Math.min(chars * size * CHAR_EM, f.box?.w ?? Infinity) + 16) : `= max(1, len(${t.text.slice(1).trim()})) * ${+(size * CHAR_EM).toFixed(2)} + 16`;
      const h = Math.round(size * 1.25 + 6);
      const rect = { node: 'rect', h, radius: Math.round(h / 2), fill: plate.ref, opacity: 0.9 };
      if (t.anchor === 'center') Object.assign(rect, { anchor: 'center', x: t.x, y: t.y, w: wExpr });
      else if ((t.align ?? 'left') === 'left' && (t.valign ?? 'top') === 'top') Object.assign(rect, { x: t.x - 8, y: t.y - 3, w: wExpr });
      else { outline(t, plate, fixes, f); continue; }
      if (t.visible !== undefined) rect.visible = t.visible;
      siblings.splice(siblings.indexOf(t), 0, rect);
      fixes.push({ kind: 'contrast', node: f.node, detail: `solid ${plate.ref} plate under the text (${plate.c.toFixed(1)}:1)` });
    } else outline(t, plate, fixes, f);
  }
  return fixes;
}
function outline(t, plate, fixes, f) {
  const size = isNum(t.size) ? t.size : 16;
  t.stroke = plate.ref; t.stroke_width = Math.max(3, Math.round(size * 0.2));
  fixes.push({ kind: 'contrast', node: f.node, detail: `${plate.ref} outline (${plate.c.toFixed(1)}:1)` });
}

/**
 * Shrinks text the lint saw overflowing its tile or running off the canvas (what the static fit
 * can't see: labels in stacks, bound sizes, captions on art), down to MIN_TEXT, then wraps it.
 */
export function shrinkFound(game, findings) {
  const fixes = [];
  const W = game.presentation?.canvas?.w ?? 360;
  const worst = new Map();
  for (const f of findings) {
    if (!f.node || !f.box || !['L_TEXT_OVERFLOW', 'L_TEXT_CLIPPED'].includes(f.code)) continue;
    const t = getAt(game, f.node);
    if (!t || t.node !== 'text') continue;
    const parent = getAt(game, parentPtr(parentPtr(f.node)));
    const centered = t.anchor === 'center' || parent?.node === 'stack' || t.align === 'center';
    const b = f.box, c = b.x + b.w / 2;
    let k;
    if (f.code === 'L_TEXT_OVERFLOW' && f.container) k = Math.min((f.container.w - 6) / b.w, (f.container.h - 2) / b.h);
    else if (centered) k = Math.min((c - 4) / (b.w / 2), (W - 4 - c) / (b.w / 2));
    else k = (W - 4 - b.x) / b.w;
    if (!(k > 0)) continue;
    const prev = worst.get(f.node);
    if (!prev || k < prev.k) worst.set(f.node, { k, t, parent, centered, f, c });
  }
  for (const [ptr, { k, t, parent, centered, f, c }] of worst) {
    if (k >= 1) continue;
    const size = isNum(t.size) ? t.size : t.size === undefined ? 16 : null;
    if (size != null) {
      const next = Math.max(MIN_TEXT, Math.floor(size * k * 0.97));
      if (next < size) { t.size = next; fixes.push({ kind: 'shrink', node: ptr, detail: `size ${size} → ${next} (${f.code})` }); }
      if (size * k * 0.97 >= MIN_TEXT) continue;
    } else if (isExpr(t.size)) {
      t.size = `= max(${MIN_TEXT}, (${t.size.slice(1).trim()}) * ${+(k * 0.97).toFixed(3)})`;
      fixes.push({ kind: 'shrink', node: ptr, detail: `bound size × ${(k * 0.97).toFixed(2)} (${f.code})` });
      continue;
    }
    // Still too wide at the minimum size: wrap it in the room it has (not inside a stack, which sizes from its children).
    if (t.w === undefined && !t.wrap && parent?.node !== 'stack' && t.anchor === 'center' && isNum(t.x)) {
      const room = f.code === 'L_TEXT_OVERFLOW' && f.container ? f.container.w - 8 : Math.max(40, Math.round(2 * Math.min(c, W - c) - 8));
      t.w = room; t.wrap = true;
      fixes.push({ kind: 'shrink', node: ptr, detail: `wrapped in ${room}` });
    }
  }
  return fixes;
}

/** Moves HUD-only top-level nodes last, on a solid panel, when sprites crossed them. Mutates `game`. */
export function hudPanel(game, findings) {
  const hits = findings.filter((f) => f.code === 'L_OVERLAP_HUD' && f.other && f.hud_box);
  const root = game.presentation?.root;
  if (!hits.length || !root || !Array.isArray(root.children)) return [];
  const H = game.presentation?.canvas?.h ?? 640, W = game.presentation?.canvas?.w ?? 360;
  const { nodes } = instrument(game);
  const topChild = (ptr) => { const m = /^\/presentation\/root\/children\/(\d+)/.exec(ptr); return m ? +m[1] : null; };
  const fixes = [];
  const original = root.children.slice(); // pointers in the findings index this order
  const tail = [];
  for (const band of ['top', 'bottom']) {
    const bandHits = hits.filter((f) => (band === 'top') === (f.hud_box.y + f.hud_box.h / 2 < H / 2));
    if (!bandHits.length) continue;
    const idx = [...new Set(bandHits.map((f) => topChild(f.other)).filter((i) => i != null))];
    // Only children whose every drawable node is HUD can move without moving the playfield.
    const movable = idx.filter((i) => nodes.every((n) => !n || !n.ptr.startsWith(`/presentation/root/children/${i}/`) && n.ptr !== `/presentation/root/children/${i}` || n.hud));
    if (!movable.length) continue;
    const y0 = band === 'top' ? 0 : Math.max(0, Math.min(...bandHits.map((f) => f.hud_box.y)) - 8);
    const y1 = band === 'top' ? Math.min(H / 3, Math.max(...bandHits.map((f) => f.hud_box.y + f.hud_box.h)) + 8) : H;
    const bg = game.presentation?.tokens?.bg ? '$bg' : game.presentation?.tokens?.surface ? '$surface' : '#111111';
    const moved = movable.sort((a, b) => a - b).map((i) => original[i]).filter((c) => !tail.includes(c));
    if (!moved.length) continue;
    tail.push({ node: 'rect', x: 0, y: Math.round(y0), w: W, h: Math.round(y1 - y0), fill: bg, opacity: 0.94 }, ...moved);
    fixes.push({ kind: 'hud_panel', node: '/presentation/root', detail: `${band} HUD (${moved.length} node${moved.length > 1 ? 's' : ''}) drawn last on a ${Math.round(y1 - y0)}-unit ${bg} panel` });
  }
  if (tail.length) root.children = [...original.filter((c) => !tail.includes(c)), ...tail];
  return fixes;
}

// ---------------------------------------------------------------- the pass ----

/**
 * game: a microgame game object. opts.findings: the lint's findings for this game (else it runs the
 * lint). Returns {game, fixes: [{kind, node, detail}], dropped: [{kind, error}]}.
 */
export async function fixLayout(game, { findings = null, pixels = null, engine = null } = {}) {
  const eng = engine ?? (await loadEngine()).engine;
  const valid = (g) => { try { eng.load(JSON.stringify(g), 1).dispose(); return null; } catch (e) { return String(e.message ?? e).slice(0, 200); } };
  let cur = clone(game);
  const fixes = [], dropped = [];
  const step = (kind, fn) => {
    const next = clone(cur);
    const got = fn(next);
    if (!got.length) return;
    const err = valid(next);
    if (err) { dropped.push({ kind, error: err }); return; }
    cur = next; fixes.push(...got);
  };
  step('fit', fitText);
  step('gap', spaceTargets);
  // The panel reorders the root's children and plates insert siblings, so each finding-driven step
  // reads pointers from a fresh lint of the game as it is now (given findings serve the first one).
  const lint = async () => (await layoutCheck(cur, { pixels, engine: eng })).findings;
  const before = fixes.length;
  let found = findings && !before ? findings : await lint();
  for (let round = 0; round < 2; round++) {
    const n = fixes.length;
    step('shrink', (g) => shrinkFound(g, found));
    if (fixes.length === n) break;
    found = await lint(); // stacks re-lay out around the smaller text
  }
  const n = fixes.length;
  step('hud_panel', (g) => hudPanel(g, found));
  if (fixes.length > n) found = await lint();
  const m = fixes.length;
  step('contrast', (g) => fixContrast(g, found));
  // A recolor judged on one frame can lose on another (a scrolling backdrop, a lit tile). Check
  // again; where the text still fails, put the old color back and outline it instead.
  const recolored = fixes.slice(m).filter((f) => f.recolor);
  if (recolored.length) {
    const still = new Set((await lint()).filter((f) => f.code === 'L_LOW_CONTRAST').map((f) => f.node));
    step('contrast', (g) => {
      const out = [];
      for (const r of recolored.filter((x) => still.has(x.node))) {
        const t = getAt(g, r.node);
        const hex = tokenColor(g, r.recolor.from);
        if (!t || !hex) continue;
        t.color = r.recolor.from;
        const plate = paletteCandidates(g).map((p) => ({ ...p, c: contrast(rgb(p.hex), rgb(hex)) })).sort((a, b) => b.c - a.c)[0];
        outline(t, plate, out, { node: r.node });
        r.detail += ' (reverted)';
      }
      return out;
    });
  }
  return { game: cur, fixes, dropped };
}
