// 9-slice frames for engine games, with no runtime change: a frame is a `group` of nine `image`
// nodes. Corners keep their size, edges stretch along one axis, the middle stretches both ways, so
// one painted frame fits any box. Two ways to feed it:
//   - `pieces` (the default): nine assets `<asset>_0` … `<asset>_8`, the frame cut at its insets at
//     build time (sheets.cutNine). Works on every engine and in every rasterizer.
//   - `crop`: one asset cropped with `src_x/src_y/src_w/src_h` (engine v0.2.2 crops; the app bundle has
//     them since 2026-11-13, older engines and servers refuse the props).
// Inner edges overlap by half a unit, so a stretched piece never leaves a hairline seam.
//
//   nineSlice({asset, x, y, w, h, src: {w, h}, insets: {l, t, r, b}, corner?, mode?, ...props}) → group node
//   uiAsset(dataUri, pxW, pxH, insetsPx, density) → {asset, nine: {src, insets}}
//   skinRects(game, kit) → replaces plain panel and button rects with 9-slice frames (see below)
//
// Pure JS. `w` and `h` may be numbers or `=` expressions; so may x and y (they go on the group).

const isExpr = (v) => typeof v === 'string' && v.startsWith('=');
const body = (v) => (isExpr(v) ? `(${v.slice(1).trim()})` : String(v));
const sub = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : `= ${body(a)} - ${body(b)}`);
const max0 = (v) => (typeof v === 'number' ? Math.max(0, v) : `= max(0.0, ${body(v)})`);

/**
 * A UI asset entry for game.assets, sized in canvas units at `density` pixels per unit (2 = drawn
 * sharp on a 2× phone at its natural size), with the 9-slice facts in the same units.
 */
export function uiAsset(dataUri, pxW, pxH, insetsPx, density = 2) {
  const u = (v) => Math.round((v / density) * 100) / 100;
  return {
    asset: { image: dataUri, w: u(pxW), h: u(pxH) },
    nine: { src: { w: u(pxW), h: u(pxH) }, insets: { l: u(insetsPx.l), t: u(insetsPx.t), r: u(insetsPx.r), b: u(insetsPx.b) } },
  };
}

/**
 * The nine image nodes. `corner` scales the corners (1 = the asset's own units); a box smaller than
 * its two corners shrinks them so the frame never folds over itself (numbers only; expressions trust
 * the caller). Extra props (opacity, visible, animate_on, transition, on_tap...) go on the group.
 */
export function nineSlice({ asset, x = 0, y = 0, w, h, src, insets, corner = 1, mode = 'pieces', ...props }) {
  let k = corner;
  if (typeof w === 'number') k = Math.min(k, w / Math.max(1e-6, insets.l + insets.r));
  if (typeof h === 'number') k = Math.min(k, h / Math.max(1e-6, insets.t + insets.b));
  const r2 = (v) => Math.round(v * 100) / 100;
  const L = r2(insets.l * k), R = r2(insets.r * k), T = r2(insets.t * k), B = r2(insets.b * k);
  const midW = max0(sub(sub(w, L), R)), midH = max0(sub(sub(h, T), B));
  const rightX = sub(w, R), bottomY = sub(h, B);
  const sw = r2(src.w - insets.l - insets.r), sh = r2(src.h - insets.t - insets.b);
  const add = (v, d) => (typeof v === 'number' ? r2(v + d) : `= ${body(v)} + ${d}`);
  let k9 = 0;
  // Inner edges grow by `o` (half a unit) into their neighbours; the outer edges stay exact.
  const o = 0.5;
  const piece = (px, py, pw, ph, sx, sy, sW, sH, grow) => {
    const [gl, gt, gr, gb] = grow.map((g) => (g ? o : 0));
    const n = { node: 'image', asset: mode === 'crop' ? asset : `${asset}_${k9}`, x: add(px, -gl), y: add(py, -gt), w: add(pw, gl + gr), h: add(ph, gt + gb) };
    k9++;
    return mode === 'crop' ? { ...n, src_x: sx, src_y: sy, src_w: sW, src_h: sH } : n;
  };
  const children = [
    piece(0, 0, L, T, 0, 0, insets.l, insets.t, [0, 0, 0, 0]),
    piece(L, 0, midW, T, insets.l, 0, sw, insets.t, [1, 0, 1, 0]),
    piece(rightX, 0, R, T, r2(src.w - insets.r), 0, insets.r, insets.t, [0, 0, 0, 0]),
    piece(0, T, L, midH, 0, insets.t, insets.l, sh, [0, 1, 0, 1]),
    piece(L, T, midW, midH, insets.l, insets.t, sw, sh, [1, 1, 1, 1]),
    piece(rightX, T, R, midH, r2(src.w - insets.r), insets.t, insets.r, sh, [0, 1, 0, 1]),
    piece(0, bottomY, L, B, 0, r2(src.h - insets.b), insets.l, insets.b, [0, 0, 0, 0]),
    piece(L, bottomY, midW, B, insets.l, r2(src.h - insets.b), sw, insets.b, [1, 0, 1, 0]),
    piece(rightX, bottomY, R, B, r2(src.w - insets.r), r2(src.h - insets.b), insets.r, insets.b, [0, 0, 0, 0]),
  ];
  // No w/h on the group (v0.2.2 group boxes): its box is the union of the pieces, which is the frame's box.
  return { node: 'group', x, y, ...props, children };
}

/** Walks every node of a presentation tree (repeat templates and grid cells too), parent first. */
export function walk(node, fn, parent = null) {
  if (!node || typeof node !== 'object') return;
  fn(node, parent);
  for (const c of node.children ?? []) walk(c, fn, node);
  if (node.template) walk(node.template, fn, node);
  if (node.cell) walk(node.cell, fn, node);
}

const TRANSPARENT = /^#(?:[0-9a-f]{6}00|[0-9a-f]{3}0)$/i;
const literalFill = (f) => typeof f === 'string' && !isExpr(f) && !TRANSPARENT.test(f);

/**
 * Replaces plain rects with the kit's 9-slice frames, in place: a rect with a literal fill of at least
 * 120 × 90 and no handler becomes a `panel`; one with an `on_tap` and a literal fill becomes a
 * `button` (the group keeps the handler, so taps and the proof are unchanged); a rect at least 3× as
 * wide as tall under 60 high becomes a `banner`. Rects with a bound fill (state colours) stay, so the
 * state still shows. Returns the list of changes. `kit.frames` maps a piece name to {asset, src, insets}.
 */
export function skinRects(game, kit, { minPanel = [120, 90], corner = 1 } = {}) {
  const changes = [];
  const frames = kit.frames ?? {};
  walk(game.presentation?.root, (n) => {
    for (let i = 0; i < (n.children ?? []).length; i++) {
      const c = n.children[i];
      if (c?.node !== 'rect' || typeof c.w !== 'number' || typeof c.h !== 'number' || !literalFill(c.fill)) continue;
      const piece = c.on_tap ? 'button' : c.w >= minPanel[0] && c.h >= minPanel[1] ? 'panel' : c.w >= c.h * 3 && c.h < 60 ? 'banner' : null;
      const f = piece && frames[piece];
      if (!f) continue;
      const { node: _n, fill: _f, stroke: _s, stroke_width: _sw, radius: _r, w, h, x = 0, y = 0, ...rest } = c;
      n.children[i] = nineSlice({ asset: f.asset, x, y, w, h, src: f.src, insets: f.insets, corner: f.corner ?? corner, ...rest });
      changes.push({ piece, x, y, w, h });
    }
  });
  return changes;
}
