// Distinctness check for sliced sprites (build-time picture art, image-art.mjs). After a sprite sheet is
// keyed and sliced, every picture the game shows for a different thing must look different, and every
// slice must hold exactly one whole figure. Pure: no Node APIs, deterministic.
//
//   V_SPRITE_DUP    two items that should differ look the same (perceptual hash and pixel difference)
//   V_SPRITE_EMPTY  a slice is empty or nearly empty
//   V_SPRITE_CUT    a slice was cut across a figure (its grid cell has opaque pixels along the border)
//   V_SPRITE_MULTI  a slice holds two or more separate figures
//
// input: [{key, img, cell?}] — `img` is the keyed, trimmed sprite (RGBA with alpha), `cell` the untrimmed
// grid cell it came from (when the sheet was sliced by the grid). Returns {ok, issues, pairs, metrics}.

import * as X from './image-pixels.mjs';

export const SPRITE_CHECK = Object.freeze({
  sig_px: 24, // signature size: the sprite fitted into 24 × 24 over neutral grey
  dup_diff: 14, // mean |RGB| difference (0–255) below this, together with…
  dup_hash: 12, // …a 64-bit difference-hash distance at or below this, is a duplicate
  same_diff: 4, // or a difference this small on its own (a copy, whatever the hash says)
  min_cover: 0.02, // share of the cell (or sprite box) that must be opaque
  min_px: 12, // the trimmed sprite's longest side, in pixels
  cut_border: 0.03, // share of the cell border that may be opaque before the slice counts as cut
  multi_ratio: 0.3, // a second component at least this share of the largest one…
  multi_area: 0.06, // …and at least this share of the sprite box is a second figure
});

const GREY = [128, 128, 128];

/** A sprite's signature: fitted into n × n over grey (RGB), plus a 64-bit difference hash. */
export function signature(img, n = SPRITE_CHECK.sig_px) {
  const t = X.alphaBox(img) ? X.trim(img) : img;
  const fit = X.flatten(X.fitInto(t, n, n), GREY);
  const rgb = new Uint8Array(n * n * 3);
  for (let i = 0; i < n * n; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = fit.data[i * 4 + c];
  const small = X.flatten(X.resize(X.fitInto(t, 64, 64), 9, 8), GREY);
  const lum = (x, y) => { const o = (y * 9 + x) * 4; return small.data[o] * 0.299 + small.data[o + 1] * 0.587 + small.data[o + 2] * 0.114; };
  const hash = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash.push(lum(x, y) > lum(x + 1, y) ? 1 : 0);
  return { n, rgb, hash };
}

/** Mean absolute RGB difference between two signatures (0–255). */
export function pixelDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.rgb.length; i++) s += Math.abs(a.rgb[i] - b.rgb[i]);
  return s / a.rgb.length;
}

export function hashDistance(a, b) {
  let d = 0;
  for (let i = 0; i < 64; i++) if (a.hash[i] !== b.hash[i]) d++;
  return d;
}

// Opaque share of a cell's one-pixel border.
function borderOpaque(cell) {
  const { w, h, data } = cell;
  let n = 0, total = 0;
  const at = (x, y) => { total++; if (data[(y * w + x) * 4 + 3] >= 128) n++; };
  for (let x = 0; x < w; x++) { at(x, 0); at(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { at(0, y); at(w - 1, y); }
  return total ? n / total : 0;
}

/**
 * Checks sliced sprites. `entries` are [{key, img, cell?}], in sheet order. `distinct(a, b)` says
 * whether two keys should look different (default: all of them). Returns
 * {ok, issues: [{code, keys, detail}], pairs: [{a, b, diff, hash}], metrics: {key: {...}}}.
 */
export function checkSprites(entries, { distinct = () => true, limits = {} } = {}) {
  const L = { ...SPRITE_CHECK, ...limits };
  const issues = [];
  const metrics = {};
  const sigs = {};
  for (const e of entries) {
    const box = e.img ? X.alphaBox(e.img) : null;
    const m = { w: box?.w ?? 0, h: box?.h ?? 0 };
    if (!box) { issues.push({ code: 'V_SPRITE_EMPTY', keys: [e.key], detail: 'no opaque pixels' }); metrics[e.key] = m; continue; }
    const t = X.trim(e.img);
    m.cover = round(X.coverage(e.cell ?? t));
    if (Math.max(box.w, box.h) < L.min_px || m.cover < L.min_cover) {
      issues.push({ code: 'V_SPRITE_EMPTY', keys: [e.key], detail: `near-empty: ${box.w}x${box.h} px, ${Math.round(m.cover * 100)}% opaque` });
      metrics[e.key] = m;
      continue;
    }
    if (e.cell) {
      m.border = round(borderOpaque(e.cell));
      if (m.border > L.cut_border) issues.push({ code: 'V_SPRITE_CUT', keys: [e.key], detail: `${Math.round(m.border * 100)}% of the cell border is opaque: the slice cuts through a figure` });
    }
    const comps = X.components(t, { join: 0.01 });
    m.parts = comps.length;
    if (comps.length >= 2) {
      const [a, b] = comps;
      if (b.n >= a.n * L.multi_ratio && b.n >= t.w * t.h * L.multi_area) issues.push({ code: 'V_SPRITE_MULTI', keys: [e.key], detail: `${comps.length} separate figures in one slice` });
    }
    sigs[e.key] = signature(t, L.sig_px);
    metrics[e.key] = m;
  }
  const pairs = [];
  const keys = entries.map((e) => e.key).filter((k) => sigs[k]);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    if (!distinct(keys[i], keys[j])) continue;
    const a = sigs[keys[i]], b = sigs[keys[j]];
    const p = { a: keys[i], b: keys[j], diff: round(pixelDiff(a, b), 1), hash: hashDistance(a, b) };
    pairs.push(p);
    if (p.diff < L.same_diff || (p.diff < L.dup_diff && p.hash <= L.dup_hash)) issues.push({ code: 'V_SPRITE_DUP', keys: [p.a, p.b], detail: `look the same: pixel difference ${p.diff}, hash distance ${p.hash}` });
  }
  return { ok: !issues.length, issues, pairs, metrics };
}

/** The keys to redraw for a check's issues: each flagged slice, and the later item of each duplicate pair. */
export function redrawKeys(check) {
  const out = new Set();
  for (const i of check.issues) out.add(i.code === 'V_SPRITE_DUP' ? i.keys[1] : i.keys[0]);
  return [...out];
}

/** Splits a multi-frame sprite sheet image into its frames (cols × rows of equal cells). */
export function splitFrames(img, frames, cols = frames) {
  const rows = Math.ceil(frames / cols);
  const fw = Math.floor(img.w / cols), fh = Math.floor(img.h / rows);
  const out = [];
  for (let k = 0; k < frames; k++) out.push(X.crop(img, (k % cols) * fw, Math.floor(k / cols) * fh, fw, fh));
  return out;
}

/**
 * Checks a made game's set assets: every image asset with several frames and no fps (one frame per
 * item, chosen by the game) must have frames that look different. `decode(bytes)` reads PNG bytes.
 * Returns {ok, assets: {id: check}} — useful on manifests already published.
 */
export function checkGameSets(game, decode) {
  const assets = {};
  for (const [id, a] of Object.entries(game?.assets ?? {})) {
    if (!a?.image || !(a.frames > 1) || a.fps !== undefined) continue;
    const m = /^data:image\/png;base64,(.*)$/.exec(a.image);
    if (!m) continue;
    const img = decode(fromBase64(m[1]));
    assets[id] = checkSprites(splitFrames(img, a.frames, a.cols ?? a.frames).map((f, k) => ({ key: `${id}#${k}`, img: f })));
  }
  return { ok: Object.values(assets).every((c) => c.ok), assets };
}

function fromBase64(s) {
  const T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (T.indexOf(clean[i]) << 18) | (T.indexOf(clean[i + 1]) << 12) | ((T.indexOf(clean[i + 2]) & 63) << 6) | (T.indexOf(clean[i + 3]) & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
