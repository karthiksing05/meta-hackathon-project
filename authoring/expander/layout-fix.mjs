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
const MIN_TARGET_FIX = 40; // canvas units ≈ 44 pt
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
  // Solid colors only: a token with alpha (a shadow, a scrim) can't be a plate or a text color.
  return [...Object.entries(t).filter(([, v]) => typeof v === 'string' && /^#[0-9A-Fa-f]{6}([Ff]{2})?$/.test(v)).map(([k, v]) => ({ ref: `$${k}`, hex: v })), { ref: '#FFFFFF', hex: '#FFFFFF' }, { ref: '#111111', hex: '#111111' }];
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
    if ((f.backdrop_spread ?? 9) < 2.5 && !isExpr(t.color) && !inTemplate) {
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

/**
 * When moving sprites cross the HUD, the HUD is drawn last in its layer on a band: the highest node
 * above each crossed HUD text that holds only HUD moves to the end of its list, after a panel that
 * runs from the canvas edge to just past the HUD (under the phone's bars on a tall canvas, so the
 * band reads as the game's own top or bottom bar) with a thin line in the primary color on its
 * inner edge. Works inside lifted or offset layers (the panel is placed in the layer's coordinates).
 * Mutates `game`.
 */
export function hudPanel(game, findings) {
  const hits = findings.filter((f) => f.code === 'L_OVERLAP_HUD' && f.other && f.hud_box);
  const root = game.presentation?.root;
  if (!hits.length || !root || !Array.isArray(root.children)) return [];
  const H = game.presentation?.canvas?.h ?? 640, W = game.presentation?.canvas?.w ?? 360;
  const { nodes } = instrument(game);
  const onlyHud = (p) => nodes.every((n) => !n || !(n.ptr === p || n.ptr.startsWith(p + '/')) || n.hud);
  const up = (p) => p.replace(/\/(children\/\d+|template|cell|item|node)$/, '');
  const layerOf = (ptr) => {
    let best = null;
    for (let p = ptr; p.startsWith('/presentation/root/'); p = up(p)) if (childSlot(game, p) && onlyHud(p)) best = p;
    return best;
  };
  // The layer's offset: literal x/y of the groups above it (null when a stack, grid or repeat lays it out).
  const offsetOf = (listParent) => {
    let x = 0, y = 0;
    for (let p = listParent; ; p = up(p)) {
      const n = getAt(game, p);
      if (!n || ['stack', 'grid', 'repeat'].includes(n.node)) return null;
      if (n.node === 'group') { x += isNum(n.x) ? n.x : 0; y += isNum(n.y) ? n.y : 0; }
      if (p === '/presentation/root') break;
    }
    return { x, y };
  };
  const bg = game.presentation?.tokens?.bg ? '$bg' : game.presentation?.tokens?.surface ? '$surface' : '#111111';
  const line = game.presentation?.tokens?.primary ? '$primary' : null;
  const groups = new Map();
  for (const f of hits) {
    const layer = layerOf(f.other);
    if (!layer) continue;
    const s = childSlot(game, layer);
    const band = f.hud_box.y + f.hud_box.h / 2 < H / 2 ? 'top' : 'bottom';
    const key = `${s.parentPtr}|${band}`;
    if (!groups.has(key)) groups.set(key, { s, band, layers: new Set(), boxes: [] });
    const gr = groups.get(key);
    gr.layers.add(layer); gr.boxes.push(f.hud_box);
  }
  const fixes = [];
  const done = new Set();
  // Later lists first, so pointers into earlier ones stay valid.
  for (const gr of [...groups.values()].sort((a, b) => b.s.parentPtr.localeCompare(a.s.parentPtr, undefined, { numeric: true }))) {
    const off = offsetOf(gr.s.parentPtr);
    if (!off) continue;
    const list = gr.s.list;
    const moved = [...gr.layers].map((p) => getAt(game, p)).filter((n) => n && !done.has(n));
    if (!moved.length) continue;
    moved.forEach((n) => done.add(n));
    const y0 = gr.band === 'top' ? 0 : Math.max(0, Math.min(...gr.boxes.map((b) => b.y)) - 8);
    const y1 = gr.band === 'top' ? Math.min(H / 3, Math.max(...gr.boxes.map((b) => b.y + b.h)) + 8) : H;
    const panel = { node: 'rect', x: -off.x, y: Math.round(y0 - off.y), w: W, h: Math.round(y1 - y0), fill: bg, opacity: 0.9 };
    const extra = line ? [{ node: 'rect', x: -off.x, y: Math.round((gr.band === 'top' ? y1 - 2 : y0) - off.y), w: W, h: 2, fill: line, opacity: 0.55 }] : [];
    const rest = list.filter((n) => !moved.includes(n));
    list.splice(0, list.length, ...rest, panel, ...extra, ...moved);
    fixes.push({ kind: 'hud_panel', node: gr.s.parentPtr, detail: `${gr.band} HUD (${moved.length} node${moved.length > 1 ? 's' : ''}) drawn last on a ${Math.round(y1 - y0)}-unit ${bg} band` });
  }
  return fixes;
}

// ---------------------------------------------------------------- structural fixes ----
// Read where every node was drawn over sampled play (layout-check.mjs nodeGeometry): what moves,
// what sits where. They change how a kind of text is presented, not one instance's coordinates.

/**
 * Grid cells whose tap boxes sit closer than 8 units: the cell's art and tap box shrink inside the
 * same cell slot (inset on every side), so the board's geometry, which the rules often repeat in
 * their own numbers (a plant drawn at 242 + row × 48), stays exactly where it was. Only while the
 * tap box stays at least 40 units. Mutates `game`.
 */
export function insetCells(game) {
  const fixes = [];
  walkNodes(game.presentation?.root, (node, ptr) => {
    if (node.node !== 'grid' || !node.cell || !isNum(node.cell_size)) return;
    const gap = isNum(node.gap) ? node.gap : 0;
    const cs = node.cell_size;
    const inset = Math.ceil((8 - gap) / 2);
    if (inset <= 0 || cs - 2 * inset < MIN_TARGET_FIX) return;
    const kids = node.cell.node === 'group' ? node.cell.children ?? [] : [node.cell];
    let tap = false;
    walkNodes(node.cell, (x) => { if (x.on_tap || x.on_press || x.on_drag) tap = true; });
    if (!tap) return;
    let n = 0;
    for (const k of kids) {
      if (!k || !['rect', 'image'].includes(k.node) || k.w !== cs || k.h !== cs || (k.anchor ?? null) === 'center') continue;
      if ((k.x !== undefined && !isNum(k.x)) || (k.y !== undefined && !isNum(k.y))) continue;
      k.x = (k.x ?? 0) + inset; k.y = (k.y ?? 0) + inset; k.w = cs - 2 * inset; k.h = cs - 2 * inset;
      if (isNum(k.radius)) k.radius = Math.max(0, k.radius - inset);
      n++;
    }
    if (n) fixes.push({ kind: 'inset', node: ptr, detail: `cell art and tap box inset ${inset} (gap ${gap} → ${gap + 2 * inset}, cells ${cs - 2 * inset})` });
  });
  return fixes;
}

/**
 * Lane strips (tall, narrow, solid rects that run the height of the play area) over a picture
 * backdrop let the picture through: opacity 0.3, so the lanes read as lanes instead of paper strips
 * laid over the art. Mutates `game`.
 */
export function softenLanes(game) {
  const fixes = [];
  const W = game.presentation?.canvas?.w ?? 360, H = game.presentation?.canvas?.h ?? 640;
  let picture = false;
  walkNodes(game.presentation?.root, (n) => { if (n.node === 'image' && isNum(n.w) && isNum(n.h) && n.w >= 0.9 * W && n.h >= 0.9 * Math.min(H, 640)) picture = true; });
  if (!picture) return fixes;
  walkNodes(game.presentation?.root, (n, ptr) => {
    if (n.node !== 'rect' || n.on_tap || n.on_press || n.on_drag) return;
    if (!isNum(n.h) || !isNum(n.w) || n.h < 0.5 * Math.min(H, 640) || n.w > 0.3 * W || n.w < 12) return;
    if (typeof n.fill !== 'string' || isExpr(n.fill) || (n.opacity !== undefined && !(isNum(n.opacity) && n.opacity >= 0.9))) return;
    const hex = tokenColor(game, n.fill);
    if (!hex || (hex.length === 9 && parseInt(hex.slice(7), 16) < 230)) return;
    n.opacity = 0.3;
    fixes.push({ kind: 'lanes', node: ptr, detail: `solid ${n.w} × ${n.h} strip over the picture backdrop at opacity 0.3` });
  });
  return fixes;
}

/** A node's layer offset: the literal x/y of the groups above it (null when a stack, grid or repeat lays it out). */
function layerOffset(game, ptr) {
  let x = 0, y = 0;
  for (let p = ptr.replace(/\/(children\/\d+|template|cell|item|node)$/, ''); ; p = p.replace(/\/(children\/\d+|template|cell|item|node)$/, '')) {
    const n = getAt(game, p);
    if (!n || ['stack', 'grid'].includes(n.node)) return null;
    if (n.node === 'group') { x += isNum(n.x) ? n.x : 0; y += isNum(n.y) ? n.y : 0; }
    if (p === '/presentation/root') return { x, y };
  }
}

/**
 * Tappable pickups (a moving sprite with its own on_tap that doesn't read the pointer, e.g. a sun
 * to collect) never drift under the game's still controls: their drawn y is held below the panel
 * of buttons they would float into (or above one below them). The tap still sends the same payload,
 * so the rules see the same thing. Mutates `game`.
 */
export function clampPickups(game, geometry) {
  const fixes = [];
  const entries = [...(geometry ?? new Map()).entries()];
  const controls = entries.filter(([, g]) => g.interactive && !g.moving && g.kind !== 'text').map(([p, g]) => ({ p, box: g.box }));
  for (const [ptr, g] of entries) {
    if (!g.moving || !g.interactive || g.kind !== 'image' || !ptr.endsWith('/template')) continue;
    const n = getAt(game, ptr);
    if (!n?.on_tap || /\bpointer\b/.test(JSON.stringify(n.on_tap.with ?? {})) || !isExpr(n.y) || n.anchor !== 'center') continue;
    const h = isNum(n.h) ? n.h : 44;
    const cy = (g.box.y0 + g.box.y1) / 2;
    const hits = controls.filter((c) => !c.p.startsWith(ptr) && Math.min(c.box.x1, g.box.x1) - Math.max(c.box.x0, g.box.x0) > 1 && Math.min(c.box.y1, g.box.y1) - Math.max(c.box.y0, g.box.y0) > 1);
    if (!hits.length) continue;
    const off = layerOffset(game, ptr);
    if (!off) continue;
    const above = hits.filter((c) => (c.box.y0 + c.box.y1) / 2 < cy), below = hits.filter((c) => (c.box.y0 + c.box.y1) / 2 >= cy);
    // The band the pickup would rest in must be clear of other controls, or the clamp just moves the overlap.
    const restClear = (y0, y1) => !controls.some((c) => !c.p.startsWith(ptr) && Math.min(c.box.x1, g.box.x1) - Math.max(c.box.x0, g.box.x0) > 1 && Math.min(c.box.y1, y1) - Math.max(c.box.y0, y0) > -8);
    if (above.length) { const top = Math.max(...above.map((c) => c.box.y1)); if (!restClear(top + 10, top + 10 + h)) continue; }
    if (below.length) { const bot = Math.min(...below.map((c) => c.box.y0)); if (!restClear(bot - 10 - h, bot - 10)) continue; }
    let y = n.y.slice(1).trim();
    const parts = [];
    if (above.length) { const lo = Math.round(Math.max(...above.map((c) => c.box.y1)) - off.y + h / 2 + 10); y = `max(${y}, ${lo}.0)`; parts.push(`below y ${lo}`); }
    if (below.length) { const hi = Math.round(Math.min(...below.map((c) => c.box.y0)) - off.y - h / 2 - 10); y = `min(${y}, ${hi}.0)`; parts.push(`above y ${hi}`); }
    n.y = `= ${y}`;
    fixes.push({ kind: 'pickup', node: ptr, detail: `tappable pickup held ${parts.join(' and ')} (it drifted under ${hits.length} control${hits.length > 1 ? 's' : ''})` });
  }
  return fixes;
}

const SIZE_OF = (t) => (t.size === undefined ? 16 : t.size);
const sizeExpr = (t) => { const s = SIZE_OF(t); return isNum(s) ? String(s) : isExpr(s) ? `(${s.slice(1).trim()})` : '16'; };
const lenExpr = (t) => (isExpr(t.text) ? `max(1, len(${t.text.slice(1).trim()}))` : String(Math.max(1, [...String(t.text ?? '')].length)));
const offset = (v, d) => (isNum(v) ? v + d : isExpr(v) ? `= (${v.slice(1).trim()}) + ${d}` : v);

function childSlot(game, ptr) {
  // The list and index a node sits at, when it sits in a children list.
  const m = /^(.*)\/children\/(\d+)$/.exec(ptr);
  if (!m) return null;
  const list = getAt(game, `${m[1]}/children`);
  return Array.isArray(list) ? { list, i: +m[2], parentPtr: m[1] } : null;
}

/**
 * Text over a busy playfield gets a plate. Two kinds:
 *   - text that moves with play (a score popup, a label riding a sprite) becomes a badge: a small
 *     pill in the palette color that reads best behind it, outlined in the text's color. A popup
 *     that fades keeps its full color until it is 30 % faded and then goes, so it never shows as a
 *     ghost half over a sprite;
 *   - still text that moving sprites cross (a lane name, a line's label, an announcement) sits on a
 *     soft plate.
 * Either way the plated text (its node, or the repeat that makes it) moves to the end of its list,
 * so sprites pass under the plate instead of through the words. Text written on its own piece (a
 * rect or image drawn before it in the same group) is part of that piece and stays as it is.
 * Mutates `game`.
 */
export function plateLabels(game, geometry) {
  const fixes = [];
  const palette = paletteCandidates(game);
  const W = game.presentation?.canvas?.w ?? 360, H = game.presentation?.canvas?.h ?? 640;
  const sprites = [...(geometry ?? new Map()).entries()].filter(([, g]) => g.moving && g.kind !== 'text' && !(g.hud && g.inBand)).map(([p, g]) => ({ p, box: g.box }))
    .filter((s) => (s.box.x1 - s.box.x0) * (s.box.y1 - s.box.y0) < 0.9 * W * H);
  const crossed = (b) => sprites.some((s) => Math.min(b.x1, s.box.x1) - Math.max(b.x0, s.box.x0) > 2 && Math.min(b.y1, s.box.y1) - Math.max(b.y0, s.box.y0) > 2);
  // Positions that sprites are drawn at (`player.x`, `o.y`): a text placed from the same one rides
  // that sprite, even if the sampled frames never caught it moving.
  const spriteRefs = new Set();
  const refs = (v) => (isExpr(v) ? v.match(/\b[a-z_][a-z0-9_]*\.[xy]\b/g) ?? [] : []);
  walkNodes(game.presentation?.root, (n) => { if (n.node === 'image') for (const k of ['x', 'y']) refs(n[k]).forEach((r) => spriteRefs.add(r)); });
  const texts = [];
  walkNodes(game.presentation?.root, (n, ptr) => { if (n.node === 'text') texts.push(ptr); });
  const targets = [];
  for (const ptr of texts) {
    const t = getAt(game, ptr);
    const riding = [...refs(t.x), ...refs(t.y)].some((r) => spriteRefs.has(r));
    const g = geometry?.get(ptr) ?? (riding ? { kind: 'text', moving: true, interactive: false, box: null } : null);
    if (!g || g.interactive || (g.hud && g.inBand)) continue;
    if (riding) g.moving = true;
    if (!g.moving && !crossed(g.box)) continue;
    if (!t || t.node !== 'text' || !String(t.text ?? '').trim()) continue;
    if (t.x === undefined || t.y === undefined || t.w !== undefined || t.wrap) continue;
    const slot = childSlot(game, ptr) ?? (ptr.endsWith('/template') ? { template: true, parentPtr: ptr.slice(0, -'/template'.length) } : null);
    if (!slot) continue;
    if (slot.list) {
      const parent = getAt(game, slot.parentPtr);
      if (parent?.node === 'stack') continue;
      // Written on its own piece: a rect or image drawn before it in its list that holds its center.
      const cx = g.box ? (g.box.x0 + g.box.x1) / 2 : NaN, cy = g.box ? (g.box.y0 + g.box.y1) / 2 : NaN;
      const onPiece = !riding && g.box && slot.list.slice(0, slot.i).some((s, j) => {
        if (!s || !['rect', 'image'].includes(s.node)) return false;
        const pg = geometry.get(`${slot.parentPtr}/children/${j}`);
        const b = pg?.box;
        // A separate sprite that moves (a chaser behind the hero) is not the text's piece; a piece in
        // the text's own template (a card and its caption) is, moving or not.
        if (pg?.moving && !/\/(template|cell|item)(\/|$)/.test(ptr)) return false;
        return !!b && (b.x1 - b.x0) * (b.y1 - b.y0) < 0.35 * W * H && (cx >= b.x0 - 1 && cx <= b.x1 + 1 && cy >= b.y0 - 1 && cy <= b.y1 + 1);
      });
      if (onPiece) continue;
    }
    targets.push({ ptr, t, slot, moving: g.moving });
  }
  // Deepest and last first, so earlier pointers stay valid while lists change.
  targets.sort((a, b) => b.ptr.localeCompare(a.ptr, undefined, { numeric: true }));
  const raise = new Set();
  for (const { ptr, t, slot, moving } of targets) {
    const center = t.anchor === 'center';
    if (!center && ((t.align ?? 'left') !== 'left' || (t.valign ?? 'top') !== 'top')) continue;
    const textHex = tokenColor(game, t.color ?? '$ink') ?? '#FFFFFF';
    const plate = palette.map((p) => ({ ...p, c: contrast(rgb(p.hex), rgb(textHex)) })).sort((a, b) => b.c - a.c)[0];
    if (!plate || plate.c < 4.5) continue;
    const S = sizeExpr(t);
    const pad = moving ? 18 : 22;
    const w = isNum(SIZE_OF(t)) && !isExpr(t.text) ? Math.round([...String(t.text)].length * SIZE_OF(t) * CHAR_EM + pad) : `= ${lenExpr(t)} * ${S} * ${CHAR_EM} + ${pad}`;
    const h = isNum(SIZE_OF(t)) ? Math.round(SIZE_OF(t) * 1.3 + 8) : `= ${S} * 1.3 + 8`;
    const rect = { node: 'rect', x: center ? t.x : offset(t.x, -pad / 2), y: center ? t.y : offset(t.y, -4), w, h, radius: isNum(h) ? Math.round(moving ? h / 2 : h / 3) : 10, fill: plate.ref };
    if (moving) Object.assign(rect, { stroke: t.color ?? '$ink', stroke_width: 2 });
    else rect.opacity = 0.92;
    if (center) rect.anchor = 'center';
    if (isExpr(t.text)) rect.visible = `= len(${t.text.slice(1).trim()}) > 0`; // no empty pill when the text is ''
    const text = { ...t };
    delete text.stroke; delete text.stroke_width; delete text.visible;
    if (t.opacity !== undefined) {
      const op = isExpr(t.opacity) ? `(${t.opacity.slice(1).trim()})` : String(t.opacity);
      const snap = isNum(t.opacity) ? (t.opacity >= 0.3 ? 1 : 0) : `= if ${op} >= 0.3 then 1.0 else 0.0`;
      text.opacity = snap;
      rect.opacity = isNum(snap) ? snap * (rect.opacity ?? 1) : moving ? snap : `= if ${op} >= 0.3 then 0.92 else 0.0`;
    }
    if (t.scale !== undefined) rect.scale = t.scale;
    if (t.rotation !== undefined) rect.rotation = t.rotation;
    const node = { node: 'group', children: [rect, text] };
    if (t.visible !== undefined) node.visible = t.visible;
    if (slot.list) slot.list[slot.i] = node;
    else getAt(game, slot.parentPtr).template = node;
    fixes.push({ kind: moving ? 'badge' : 'plate', node: ptr, detail: `${moving ? 'moving' : 'crossed'} text "${String(t.text).slice(0, 24)}" on a ${plate.ref} ${moving ? 'badge' : 'plate'}` });
    raise.add(slot.list ? ptr : slot.parentPtr);
  }
  // Raise each plated node (or its repeat) to the end of its list, when nothing in it takes taps.
  const byList = new Map();
  for (const p of raise) {
    const s = childSlot(game, p);
    if (!s) continue;
    let tap = false;
    walkNodes(s.list[s.i], (x) => { if (x.on_tap || x.on_press || x.on_release || x.on_drag || x.draggable) tap = true; });
    if (tap) continue;
    if (!byList.has(s.list)) byList.set(s.list, []);
    byList.get(s.list).push(s.i);
  }
  for (const [list, idx] of byList) {
    const nodes = idx.sort((a, b) => a - b).map((i) => list[i]);
    const rest = list.filter((n) => !nodes.includes(n));
    list.splice(0, list.length, ...rest, ...nodes);
  }
  return fixes;
}

/** Row stacks of plain text that run past the canvas edges stack as a column instead. Mutates `game`. */
export function rowsToColumns(game, geometry) {
  const fixes = [];
  const W = game.presentation?.canvas?.w ?? 360;
  walkNodes(game.presentation?.root, (node, ptr) => {
    if (node.node !== 'stack' || node.dir !== 'row') return;
    let box = null, tap = false, texts = 0;
    walkNodes(node, (x, p) => {
      if (x.on_tap || x.on_press || x.on_drag) tap = true;
      if (x.node === 'text') texts++;
      const g = geometry?.get(ptr + p.slice('/presentation/root'.length));
      if (g) box = box ? { x0: Math.min(box.x0, g.box.x0), x1: Math.max(box.x1, g.box.x1) } : { x0: g.box.x0, x1: g.box.x1 };
    });
    if (tap || texts < 2 || !box || (box.x0 >= 4 && box.x1 <= W - 4)) return;
    node.dir = 'column';
    node.gap = Math.min(isNum(node.gap) ? node.gap : 4, 4);
    fixes.push({ kind: 'rows', node: ptr, detail: `row of ${texts} texts (${Math.round(box.x0)}–${Math.round(box.x1)}) stacked as a column` });
  });
  return fixes;
}

/**
 * The HUD lives in one band at the top. A bottom HUD row that play runs through (a moving sprite or
 * a playfield label crosses it; the player's avatar usually lives at the bottom) moves up under the
 * top HUD, as a second row of the same bar. Rows that don't cross anything stay where they are.
 * Mutates `game`.
 */
export function hudToTop(game, geometry) {
  const fixes = [];
  const c = game.presentation?.canvas ?? {};
  const H = c.h ?? 640, W = c.w ?? 360;
  const tall = H * 360 > W * 640 * 1.02;
  const safeTop = tall ? Math.round(H * 110 / 780) : 0;
  const entries = [...(geometry ?? new Map()).entries()];
  const hudTexts = entries.filter(([, g]) => g.hud && g.kind === 'text' && !g.interactive && g.frames >= 0.3 * g.of);
  const top = hudTexts.filter(([, g]) => (g.box.y0 + g.box.y1) / 2 < 0.3 * H);
  const bottom = hudTexts.filter(([, g]) => (g.box.y0 + g.box.y1) / 2 > 0.75 * H);
  if (!bottom.length) return fixes;
  const union = (list) => list.reduce((u, [, g]) => (u ? { x0: Math.min(u.x0, g.box.x0), y0: Math.min(u.y0, g.box.y0), x1: Math.max(u.x1, g.box.x1), y1: Math.max(u.y1, g.box.y1) } : { ...g.box }), null);
  const bb = union(bottom);
  const hit = (b) => Math.min(b.x1, bb.x1) - Math.max(b.x0, bb.x0) > 2 && Math.min(b.y1, bb.y1) - Math.max(b.y0, bb.y0) > 2;
  const bottomPtrs = new Set(bottom.map(([p]) => p));
  const crossing = entries.some(([p, g]) => !bottomPtrs.has(p) && !g.hud && g.box && (g.kind === 'text' ? !g.interactive : g.moving) && hit(g.box) && (g.box.x1 - g.box.x0) * (g.box.y1 - g.box.y0) < 0.5 * W * H);
  if (!crossing) return fixes;
  // The layer to move: the highest node above each bottom HUD text with a literal y that holds only
  // HUD (no taps, no playfield).
  const { nodes } = instrument(game);
  const onlyHud = (p) => nodes.every((n) => !n || !(n.ptr === p || n.ptr.startsWith(p + '/')) || (n.hud && !n.interactive));
  const up = (p) => p.replace(/\/(children\/\d+|template|cell|item|node)$/, '');
  const layers = new Set();
  for (const [ptr] of bottom) {
    let best = null;
    for (let p = ptr; p.startsWith('/presentation/root/'); p = up(p)) if (onlyHud(p) && isNum(getAt(game, p)?.y)) best = p;
    if (!best) return fixes;
    layers.add(best);
  }
  const tb = union(top);
  const target = (tb ? tb.y1 : safeTop) + 8;
  const dy = Math.round(target - bb.y0);
  if (dy >= 0) return fixes;
  for (const p of layers) {
    const n = getAt(game, p);
    n.y += dy;
    fixes.push({ kind: 'hud_top', node: p, detail: `bottom HUD row moved up ${-dy} under the top HUD (play crossed it)` });
  }
  return fixes;
}

/**
 * On a tall canvas, still text and tap targets that reach into the bleed bands (under the phone's
 * bars) move into the safe area: the nearest node at or above them with a literal y that isn't a
 * whole-screen layer. Still content the move then runs into moves along with it (a cascade), and
 * the nudge is dropped when the cascade would push words into the other bleed band. Mutates `game`.
 */
export function nudgeIntoSafe(game, geometry) {
  const fixes = [];
  const c = game.presentation?.canvas ?? {};
  const H = c.h ?? 640, W = c.w ?? 360;
  if (!(H * 360 > W * 640 * 1.02)) return fixes;
  const y0 = Math.round(H * 110 / 780), y1 = Math.round(H * (1 - 96 / 780));
  // Move units: the nearest node at or above a drawn node with a literal y, skipping layers that hold
  // the whole screen and anything inside a template (that would move every instance's layout).
  const unitOf = (ptr) => {
    for (let p = ptr; p.startsWith('/presentation/root/'); p = p.replace(/\/(children\/\d+|template|cell|item|node)$/, '')) {
      const n = getAt(game, p);
      // A layer: a group at the origin, or one that holds a whole screen of nodes (a lifted canvas).
      const layer = n?.node === 'group' && (((n.y ?? 0) === 0 && (n.x ?? 0) === 0) || (n.w === undefined && (n.children?.length ?? 0) >= 4));
      if (n && isNum(n.y) && !layer && !/\/(template|cell|item|node)(\/|$)/.test(p)) return p;
    }
    return null;
  };
  const units = new Map();
  for (const [ptr, g] of geometry ?? []) {
    if (g.moving || g.frames < Math.max(1, 0.3 * g.of)) continue;
    const b = g.box;
    if ((b.x1 - b.x0) * (b.y1 - b.y0) > 0.35 * W * H) continue;
    const u = unitOf(ptr);
    if (!u) continue;
    const e = units.get(u) ?? { ptr: u, box: { ...b }, key: false, text: null };
    e.box = { x0: Math.min(e.box.x0, b.x0), y0: Math.min(e.box.y0, b.y0), x1: Math.max(e.box.x1, b.x1), y1: Math.max(e.box.y1, b.y1) };
    if (g.kind === 'text' || g.interactive) { e.key = true; e.text ??= g.text; }
    units.set(u, e);
  }
  // Nested units move with their outer unit.
  const list = [...units.values()].filter((u) => ![...units.keys()].some((o) => o !== u.ptr && u.ptr.startsWith(o + '/')));
  const hit = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1;
  const shift = new Map();
  const box = (u) => { const d = shift.get(u) ?? 0; return { ...u.box, y0: u.box.y0 + d, y1: u.box.y1 + d }; };
  // Push one unit by d, and whatever still content it then lands on, the same way (a cascade). Gives
  // up (false) when the cascade would push key content into the far bleed band.
  const push = (u, d, depth = 0) => {
    if (depth > 12) return false;
    const before = box(u);
    shift.set(u, (shift.get(u) ?? 0) + d);
    const after = box(u);
    if (u.key && (d > 0 ? (after.y0 + after.y1) / 2 > y1 - 2 : (after.y0 + after.y1) / 2 < y0 + 2)) return false;
    for (const o of list) {
      if (o === u) continue;
      const ob = box(o);
      if (!hit(after, ob) || hit(before, ob)) continue; // only what the move runs into
      const need = d > 0 ? after.y1 + 4 - ob.y0 : after.y0 - 4 - ob.y1;
      if (Math.sign(need) !== Math.sign(d) || !push(o, need, depth + 1)) return false;
    }
    return true;
  };
  for (const u of list.filter((x) => x.key).sort((a, b) => a.box.y0 - b.box.y0)) {
    const b = box(u);
    // The center comes inside the safe area by a few units (the phone's bar covers the band's far
    // edge; a glyph's top a few units past the line still reads), which keeps the cascade short.
    const cy = (b.y0 + b.y1) / 2, half = (b.y1 - b.y0) / 2;
    const d = cy < y0 + Math.min(half, 6) ? y0 + Math.min(half, 6) - cy : cy > y1 - Math.min(half, 6) ? y1 - Math.min(half, 6) - cy : 0;
    if (!d || b.y1 - b.y0 > 0.5 * (y1 - y0)) continue;
    const saved = new Map(shift);
    if (!push(u, Math.round(d))) { shift.clear(); for (const [k, v] of saved) shift.set(k, v); }
  }
  for (const [u, d] of shift) {
    if (!d) continue;
    const n = getAt(game, u.ptr);
    n.y = Math.round(n.y + d);
    fixes.push({ kind: 'safe', node: u.ptr, detail: `${u.text ? `"${String(u.text).slice(0, 24)}"` : 'content'} moved ${d > 0 ? 'down' : 'up'} ${Math.round(Math.abs(d))}${u.key ? ' into the safe area' : ' to make room'}` });
  }
  return fixes;
}

// ---------------------------------------------------------------- the pass ----

/**
 * game: a microgame game object. opts.findings: the lint's findings for this game (else it runs the
 * lint). Returns {game, fixes: [{kind, node, detail}], dropped: [{kind, error}]}.
 */
export async function fixLayout(game, { findings = null, pixels = null, engine = null, structure = true } = {}) {
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
  step('inset', insetCells);
  step('lanes', softenLanes);
  // Structural fixes read where things were drawn in sampled play: one lint, three steps that each
  // keep pointers valid for the next (badges only reorder within their own list; rows and the safe
  // area nudge only change props).
  if (structure) {
    const geo = async () => (await layoutCheck(cur, { pixels, engine: eng, everyMs: 300 })).geometry;
    let geometry = await geo();
    for (const [kind, fn] of [['pickup', clampPickups], ['rows', rowsToColumns], ['hud_top', hudToTop], ['safe', nudgeIntoSafe]]) {
      const n = fixes.length;
      step(kind, (g) => fn(g, geometry));
      if (fixes.length > n) geometry = await geo();
    }
    step('plate', (g) => plateLabels(g, geometry));
  }
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
