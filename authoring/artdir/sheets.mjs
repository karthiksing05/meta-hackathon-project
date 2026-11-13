// Pixels for the art-direction pipeline: crop the style frame and the backdrop to the tall canvas,
// slice the sprite sheet and the UI kit sheet on a deterministic grid with alpha trim, and find each
// UI frame's 9-slice insets. Pure JS on {w, h, data: RGBA} images (image-pixels.mjs does the keying).

import * as X from '../expander/image-pixels.mjs';
import { TALL, KEY_RGB, UI_PIECES, gridFor } from './prompts.mjs';

/** A picture cropped (center, cover) to the tall canvas and scaled to `scale` × 360 × 780. */
export function toTall(img, scale = 2) {
  const c = X.cropAspect(img, TALL.w / TALL.h);
  return X.resize(c, TALL.w * scale, TALL.h * scale);
}

/** Mean luminance spread (0–1) of a band of a tall picture: how busy it is behind the HUD or play area. */
export function bandBusyness(img, y0, y1) {
  const k = img.h / TALL.h;
  const band = X.crop(img, 0, Math.round(y0 * k), img.w, Math.max(1, Math.round((y1 - y0) * k)));
  return Math.round(X.busyness(band) * 1000) / 1000;
}

/** Calm-zone report for a tall picture: the HUD band, the play area and the control band. */
export function calmZones(img) {
  return { hud: bandBusyness(img, 110, 170), play: bandBusyness(img, 174, 496), controls: bandBusyness(img, 508, 684) };
}

/**
 * Removes the key's colour cast from soft edges and glows. For magenta that is red and blue both above
 * green, for green it is green above both; a pixel with the cast gets the excess channel(s) pulled
 * down to the others. `hard` (a direction's `despill: "hard"`) applies it to every pixel, for art
 * with no colours of the key's family (a white cloud on magenta); otherwise only to pixels that are
 * not fully opaque and their 2-pixel neighbourhood.
 */
export function despill(img, key, { hard = false } = {}) {
  const { w, h, data } = img;
  const out = { w, h, data: new Uint8ClampedArray(data) };
  const near = new Uint8Array(w * h);
  if (!hard) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] === 255) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) near[yy * w + xx] = 1; }
  }
  for (let i = 0; i < w * h; i++) {
    if (!hard && !near[i]) continue;
    const o = i * 4, r = data[o], g = data[o + 1], b = data[o + 2];
    if (key === 'magenta' && r > g && b > g) { const m = Math.max(g, Math.min(r, b) - (Math.min(r, b) - g)); out.data[o] = Math.min(r, m + (r - Math.min(r, b))); out.data[o + 2] = Math.min(b, m + (b - Math.min(r, b))); }
    else if (key === 'green' && g > r && g > b) out.data[o + 1] = Math.max(r, b);
    else if (key === 'blue' && b > r && b > g) out.data[o + 2] = Math.max(r, g);
  }
  return out;
}

/**
 * Cuts a keyed sheet on its cols × rows grid when every cell's solid content (alpha ≥ 96) keeps clear
 * of the cell's edges (faint glows may cross); otherwise reads it as connected regions in reading
 * order (image-pixels.sliceSheet). Each piece is trimmed to its content.
 */
export function sliceCells(keyed, count, cols, rows) {
  const cw = keyed.w / cols, ch = keyed.h / rows;
  const cells = [];
  let clean = true;
  for (let k = 0; k < count; k++) {
    const cell = X.crop(keyed, (k % cols) * cw, Math.floor(k / cols) * ch, cw, ch);
    const b = X.alphaBox(cell, 96);
    if (!b || b.x < 2 || b.y < 2 || b.x + b.w > cell.w - 2 || b.y + b.h > cell.h - 2) clean = false;
    cells.push(cell);
  }
  if (clean) return { sprites: cells.map((c) => X.trim(c, { min: 40 })), method: 'grid' };
  // Regions: subjects spaced with wide margins, so specks up to 6 % of the sheet away (a sparkle above
  // a ripple, a bow above a box) belong to the nearest subject.
  const regions = X.components(keyed, { join: 0.06 });
  if (regions.length < count) return X.sliceSheet(keyed, count, cols, rows);
  // Regions past the `count` largest (a sparkle as big as a speck threshold) join the nearest subject.
  const near = Math.max(keyed.w, keyed.h) * 0.06;
  const gap = (a, b) => Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  const top = regions.slice(0, count).map((r) => ({ ...r }));
  for (const extra of regions.slice(count)) {
    const best = top.reduce((m, t) => (gap(extra, t) < gap(extra, m) ? t : m), top[0]);
    if (gap(extra, best) > near) continue;
    const x0 = Math.min(best.x, extra.x), y0 = Math.min(best.y, extra.y);
    best.w = Math.max(best.x + best.w, extra.x + extra.w) - x0; best.h = Math.max(best.y + best.h, extra.y + extra.h) - y0; best.x = x0; best.y = y0;
  }
  const picked = top.sort((a, b) => Math.floor((a.y + a.h / 2) / ch) - Math.floor((b.y + b.h / 2) / ch) || a.x - b.x);
  return { sprites: picked.map((r) => X.trim(X.crop(keyed, r.x, r.y, r.w, r.h))), method: 'regions' };
}

/** Keys a sheet on its chroma colour (read from its border), cleans the cast and slices a cols × rows grid. */
export function sliceGrid(img, count, cols, rows, key = 'magenta', { hard = false } = {}) {
  const keyed = despill(X.erodeAlpha(X.chromaKey(img, X.detectKey(img, KEY_RGB[key] ?? KEY_RGB.magenta)), 1), key, { hard });
  const s = sliceCells(keyed, count, cols, rows);
  return { sprites: s.sprites, method: s.method, keyed };
}

/** The sprite sheet's items as {id: trimmed RGBA}, plus how it was sliced. */
export function sliceSprites(img, items, key, { hard = false } = {}) {
  const { cols, rows } = gridFor(items.length);
  const s = sliceGrid(img, items.length, cols, rows, key, { hard });
  const out = {};
  items.forEach((it, i) => { out[it.id] = X.trim(s.sprites[i], { pad: 2 }); });
  return { sprites: out, method: s.method };
}

/** Fits a sprite inside a box of `px` on its longest side, keeping its aspect, sharpened a little. */
export function finishSprite(img, px) {
  const k = px / Math.max(img.w, img.h);
  const r = X.resize(img, Math.max(1, Math.round(img.w * k)), Math.max(1, Math.round(img.h * k)));
  return X.sharpen(r, 0.3);
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const at = (img, x, y) => { const o = (y * img.w + x) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]; };

/**
 * 9-slice insets of a UI frame (pixels): walking in from each edge along the middle row and column,
 * where the border ends and the flat middle begins (4 pixels in a row within 22 of the middle's
 * median colour), at least the corner's rounding (where the outer column first turns opaque), plus
 * 2 pixels. Capped at 45 % of the side, so a stretch region always remains.
 */
export function nineInsets(img) {
  const { w, h } = img;
  const mid = [];
  for (let y = Math.floor(h * 0.4); y < Math.ceil(h * 0.6); y += 1) for (let x = Math.floor(w * 0.4); x < Math.ceil(w * 0.6); x += 1) mid.push(at(img, x, y));
  const med = [0, 1, 2].map((c) => mid.map((p) => p[c]).sort((a, b) => a - b)[mid.length >> 1]);
  // Painted (brushy, shaded) middles vary: the tolerance follows the middle's own spread.
  const dev = mid.map((p) => dist(p, med)).sort((a, b) => a - b);
  const tol = Math.max(22, Math.min(60, dev[Math.floor(dev.length * 0.9)] * 1.5));
  const walk = (get, n) => {
    let run = 0;
    for (let i = 0; i < n / 2; i++) {
      const p = get(i);
      run = p[3] > 200 && dist(p, med) < tol ? run + 1 : 0;
      if (run >= 4) return i - 3;
    }
    return Math.floor(n * 0.3);
  };
  const cy = h >> 1, cx = w >> 1;
  const l = walk((i) => at(img, i, cy), w), r = walk((i) => at(img, w - 1 - i, cy), w);
  const t = walk((i) => at(img, cx, i), h), b = walk((i) => at(img, cx, h - 1 - i), h);
  // Corner rounding from the diagonals: a corner of radius r leaves r·(1 − 1/√2) transparent pixels
  // along its diagonal. The median of the four corners, so one chipped corner doesn't decide.
  const diag = (fx, fy) => { for (let i = 0; i < Math.min(w, h) / 2; i++) if (at(img, fx(i), fy(i))[3] > 128) return i; return 0; };
  const ds = [diag((i) => i, (i) => i), diag((i) => w - 1 - i, (i) => i), diag((i) => i, (i) => h - 1 - i), diag((i) => w - 1 - i, (i) => h - 1 - i)].sort((a, b) => a - b);
  const rc = Math.round(((ds[1] + ds[2]) / 2) / (1 - Math.SQRT1_2));
  const cap = (v, n) => Math.min(Math.floor(n * 0.48), Math.max(v, rc) + 2);
  return { l: cap(l, w), r: cap(r, w), t: cap(t, h), b: cap(b, h), radius: rc, color: '#' + med.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase() };
}

/** The UI kit sheet's four frames as {panel, button, badge, banner: {img, insets}}. */
export function sliceUi(img, key) {
  const s = sliceGrid(img, UI_PIECES.length, 2, 2, key);
  const out = {};
  UI_PIECES.forEach((id, i) => { const t = X.trim(s.sprites[i]); out[id] = { img: t, insets: nineInsets(t) }; });
  return { pieces: out, method: s.method };
}

/**
 * A UI frame scaled so its corner insets come out at `corner` pixels (2× the canvas units it will be
 * drawn at), with the insets scaled to match. Smaller files, crisp corners.
 */
export function finishUi(piece, corner = 48) {
  const { img, insets } = piece;
  const k = Math.min(1, corner / Math.max(1, Math.max(insets.l, insets.r, insets.t, insets.b)));
  const w = Math.max(8, Math.round(img.w * k)), h = Math.max(8, Math.round(img.h * k));
  const r = X.resize(img, w, h);
  const s = (v) => Math.max(1, Math.round(v * k));
  return { img: r, insets: { l: s(insets.l), r: s(insets.r), t: s(insets.t), b: s(insets.b), color: insets.color } };
}

/** Pictures side by side on a grey checker at height `h` (for eyeballing slices). */
export function contactSheet(imgs, h = 160) {
  const scaled = imgs.filter(Boolean).map((im) => X.resize(im, Math.max(1, Math.round((im.w * h) / im.h)), h));
  const W = scaled.reduce((a, s) => a + s.w + 8, 8);
  const sheet = X.blank(W, h + 16);
  for (let y = 0; y < sheet.h; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, v = ((x >> 3) + (y >> 3)) & 1 ? 200 : 236;
    sheet.data[o] = sheet.data[o + 1] = sheet.data[o + 2] = v; sheet.data[o + 3] = 255;
  }
  let x = 8;
  for (const s of scaled) {
    for (let r = 0; r < s.h; r++) for (let c = 0; c < s.w; c++) {
      const so = (r * s.w + c) * 4, d = ((r + 8) * W + x + c) * 4, a = s.data[so + 3] / 255;
      for (let k = 0; k < 3; k++) sheet.data[d + k] = Math.round(s.data[so + k] * a + sheet.data[d + k] * (1 - a));
    }
    x += s.w + 8;
  }
  return sheet;
}

/**
 * A UI frame cut into its nine pieces (row by row: top-left, top, top-right, left, middle, right,
 * bottom-left, bottom, bottom-right) at its insets, for engines without image crops.
 */
export function cutNine(img, insets) {
  const { l, t, r, b } = insets;
  const xs = [0, l, img.w - r, img.w], ys = [0, t, img.h - b, img.h];
  const out = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) out.push(X.crop(img, xs[col], ys[row], Math.max(1, xs[col + 1] - xs[col]), Math.max(1, ys[row + 1] - ys[row])));
  return out;
}

/**
 * A UI frame baked at one size: corners copied, edges stretched along their side, the middle both
 * ways (the 9-slice done at build time). `w` × `h` and `insets` in pixels. One picture per box, so text written on
 * it sits on one sprite and any engine draws it.
 */
export function bakeNine(img, insets, w, h, scale = 1) {
  // `scale` sizes the corners (1: as painted); a box smaller than two corners shrinks them to fit.
  const k = Math.min(scale, w / Math.max(1, insets.l + insets.r), h / Math.max(1, insets.t + insets.b));
  const L = Math.round(insets.l * k), R = Math.round(insets.r * k), T = Math.round(insets.t * k), B = Math.round(insets.b * k);
  const parts = cutNine(img, insets);
  const out = X.blank(w, h);
  const dx = [0, L, w - R, w], dy = [0, T, h - B, h];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const pw = dx[col + 1] - dx[col], ph = dy[row + 1] - dy[row];
    if (pw <= 0 || ph <= 0) continue;
    X.paste(out, stretch(parts[row * 3 + col], pw, ph), dx[col], dy[row]);
  }
  return out;
}

/** Bilinear resize (smooth both ways, unlike the area-average downscaler's nearest upscale). */
function stretch(img, W, H) {
  if (img.w === W && img.h === H) return img;
  if (W <= img.w && H <= img.h) return X.resize(img, W, H);
  const out = X.blank(W, H);
  for (let y = 0; y < H; y++) {
    const sy = Math.max(0, Math.min(img.h - 1, ((y + 0.5) * img.h) / H - 0.5)), y0 = Math.floor(sy), y1 = Math.min(img.h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = Math.max(0, Math.min(img.w - 1, ((x + 0.5) * img.w) / W - 0.5)), x0 = Math.floor(sx), x1 = Math.min(img.w - 1, x0 + 1), fx = sx - x0;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p = (yy, xx) => img.data[(yy * img.w + xx) * 4 + c];
        out.data[o + c] = Math.round((p(y0, x0) * (1 - fx) + p(y0, x1) * fx) * (1 - fy) + (p(y1, x0) * (1 - fx) + p(y1, x1) * fx) * fy);
      }
    }
  }
  return out;
}
