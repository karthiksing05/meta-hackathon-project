// Pixel steps for build-time art (image-art.mjs): find the chroma background, key it out with clean
// edges, slice a sheet into cells, trim, crop, downscale and sharpen. Pure JS, no imports, deterministic.
// An image is {w, h, data: Uint8ClampedArray RGBA}.

export const KEYS = {
  magenta: [255, 0, 255],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  cyan: [0, 255, 255],
};

export function blank(w, h) { return { w, h, data: new Uint8ClampedArray(w * h * 4) }; }

export function crop(img, x, y, w, h) {
  x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
  w = Math.max(1, Math.min(img.w - x, Math.round(w))); h = Math.max(1, Math.min(img.h - y, Math.round(h)));
  const out = blank(w, h);
  for (let r = 0; r < h; r++) out.data.set(img.data.subarray(((y + r) * img.w + x) * 4, ((y + r) * img.w + x + w) * 4), r * w * 4);
  return out;
}

/**
 * The background color, read from the image border: the median of the border pixels that are close
 * to the expected key (the model rarely paints exactly #FF00FF). Falls back to the expected key.
 */
export function detectKey(img, expected = KEYS.magenta) {
  const { w, h, data } = img;
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 200));
  const take = (x, y) => {
    const o = (y * w + x) * 4;
    const c = [data[o], data[o + 1], data[o + 2]];
    if (dist(c, expected) < 180) samples.push(c);
  };
  for (let x = 0; x < w; x += step) { take(x, 0); take(x, 1); take(x, h - 1); take(x, h - 2); }
  for (let y = 0; y < h; y += step) { take(0, y); take(1, y); take(w - 1, y); take(w - 2, y); }
  if (samples.length < 16) return expected.slice();
  return [0, 1, 2].map((c) => samples.map((s) => s[c]).sort((a, b) => a - b)[samples.length >> 1]);
}

function dist(a, b) { const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return Math.sqrt(dr * dr + dg * dg + db * db); }

/**
 * Keys out the background. Distance in a key-aligned space: how much of the pixel is explained by the
 * key color. Pixels within `inner` of the key are transparent, beyond `outer` opaque, a smooth ramp in
 * between. Then despill: semi-transparent edge pixels are un-mixed from the key (as if composited over
 * it) and the key's dominant channel is clamped on pixels near the background, so no magenta or
 * green fringe survives. With `flood` (default) "near the background" means within 2 px of key color
 * reachable from the border, so a key-tinted detail inside a character keeps its color; enclosed holes
 * of pure key color (between an arm and a body) still go transparent.
 */
export function chromaKey(img, key, { inner = 60, outer = 140, flood = true } = {}) {
  const { w, h, data } = img;
  const out = { w, h, data: new Uint8ClampedArray(data) };
  const n = w * h;
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = dist([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]], key);
    alpha[i] = d <= inner ? 0 : d >= outer ? 1 : (d - inner) / (outer - inner);
  }
  let bg = null;
  if (flood) {
    // Background = pixels reachable from the border through not-fully-opaque pixels.
    bg = new Uint8Array(n);
    const stack = [];
    const push = (i) => { if (!bg[i] && alpha[i] < 1) { bg[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i - x) / w;
      if (x > 0) push(i - 1); if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w); if (y < h - 1) push(i + w);
    }
  }
  const dom = key.map((v) => v > 127);
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    const o = i * 4;
    if (a < 1 && a > 0) {
      // Un-mix: c = a*fg + (1-a)*key  →  fg = (c - (1-a)*key) / a
      for (let c = 0; c < 3; c++) out.data[o + c] = Math.round((data[o + c] - (1 - a) * key[c]) / a);
    }
    // Despill near the key hue: the key's strong channels may not exceed the others' max.
    if (a > 0) {
      const r = out.data[o], g = out.data[o + 1], b = out.data[o + 2];
      const ch = [r, g, b];
      const weak = [0, 1, 2].filter((c) => !dom[c]);
      const strong = [0, 1, 2].filter((c) => dom[c]);
      if (weak.length && strong.length) {
        const capWeak = Math.max(...weak.map((c) => ch[c]));
        const minStrong = Math.min(...strong.map((c) => ch[c]));
        // Classic despill: the key's strong channels lose what they have above the weak ones.
        const spill = minStrong - capWeak;
        if (spill > 24 && (bg ? isNearBg(bg, i, w, h) : a < 1)) for (const c of strong) out.data[o + c] = ch[c] - spill;
      }
    }
    out.data[o + 3] = Math.round(a * (data[o + 3] / 255) * 255);
  }
  return out;
}

function isNearBg(bg, i, w, h) {
  const x = i % w, y = (i - x) / w;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx >= 0 && yy >= 0 && xx < w && yy < h && bg[yy * w + xx]) return true;
  }
  return false;
}

/** Shrinks the alpha edge by `px` pixels (removes a one-pixel halo). */
export function erodeAlpha(img, px = 1) {
  let cur = img;
  for (let k = 0; k < px; k++) {
    const { w, h, data } = cur;
    const out = { w, h, data: new Uint8ClampedArray(data) };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = data[(y * w + x) * 4 + 3];
      if (!m) continue;
      if (x > 0) m = Math.min(m, data[(y * w + x - 1) * 4 + 3]);
      if (x < w - 1) m = Math.min(m, data[(y * w + x + 1) * 4 + 3]);
      if (y > 0) m = Math.min(m, data[((y - 1) * w + x) * 4 + 3]);
      if (y < h - 1) m = Math.min(m, data[((y + 1) * w + x) * 4 + 3]);
      out.data[(y * w + x) * 4 + 3] = Math.round((data[(y * w + x) * 4 + 3] + m) / 2);
    }
    cur = out;
  }
  return cur;
}

/** Bounding box of pixels with alpha ≥ min, or null. */
export function alphaBox(img, min = 24) {
  const { w, h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] >= min) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Trims to the opaque content plus `pad` transparent pixels. */
export function trim(img, { min = 24, pad = 0 } = {}) {
  const b = alphaBox(img, min);
  if (!b) return img;
  const t = crop(img, b.x, b.y, b.w, b.h);
  if (!pad) return t;
  const out = blank(t.w + 2 * pad, t.h + 2 * pad);
  paste(out, t, pad, pad);
  return out;
}

export function paste(dst, src, x, y) {
  for (let r = 0; r < src.h; r++) {
    const ty = y + r;
    if (ty < 0 || ty >= dst.h) continue;
    for (let c = 0; c < src.w; c++) {
      const tx = x + c;
      if (tx < 0 || tx >= dst.w) continue;
      const s = (r * src.w + c) * 4, d = (ty * dst.w + tx) * 4;
      for (let k = 0; k < 4; k++) dst.data[d + k] = src.data[s + k];
    }
  }
}

/**
 * Connected opaque regions (8-neighbour, alpha ≥ min) with their boxes and pixel counts, largest first.
 * Small specks (sparkles, motion lines) are merged into the nearest big region when within `join` px.
 */
export function components(img, { min = 40, minArea = 0.002, join = 0.03 } = {}) {
  const { w, h, data } = img;
  const lab = new Int32Array(w * h).fill(-1);
  const comps = [];
  for (let i = 0; i < w * h; i++) {
    if (lab[i] >= 0 || data[i * 4 + 3] < min) continue;
    const id = comps.length;
    const c = { x0: w, y0: h, x1: 0, y1: 0, n: 0 };
    const stack = [i];
    lab[i] = id;
    while (stack.length) {
      const j = stack.pop();
      const x = j % w, y = (j - x) / w;
      c.n++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (lab[k] < 0 && data[k * 4 + 3] >= min) { lab[k] = id; stack.push(k); }
      }
    }
    comps.push(c);
  }
  const area = w * h;
  const big = comps.filter((c) => c.n >= area * minArea);
  const small = comps.filter((c) => c.n < area * minArea);
  const gap = (a, b) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1), Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
  for (const s of small) {
    let best = null, bd = Infinity;
    for (const b of big) { const d = gap(s, b); if (d < bd) { bd = d; best = b; } }
    if (best && bd <= Math.max(w, h) * join) {
      best.x0 = Math.min(best.x0, s.x0); best.y0 = Math.min(best.y0, s.y0); best.x1 = Math.max(best.x1, s.x1); best.y1 = Math.max(best.y1, s.y1); best.n += s.n;
    }
  }
  return big.map((c) => ({ x: c.x0, y: c.y0, w: c.x1 - c.x0 + 1, h: c.y1 - c.y0 + 1, n: c.n })).sort((a, b) => b.n - a.n);
}

/**
 * Splits a keyed sheet into `count` sprites laid out in a cols × rows grid. First tries the grid's own
 * cells (each cell trimmed to its content); a cell whose content touches its border means the model
 * didn't keep to the grid, and then the sheet is read as connected regions in reading order instead.
 * Returns {sprites: [img], method: 'grid' | 'regions' | 'grid-fallback'}.
 */
export function sliceSheet(img, count, cols, rows) {
  const cw = img.w / cols, ch = img.h / rows;
  const cells = [];
  let clean = true;
  for (let k = 0; k < count; k++) {
    const cx = (k % cols) * cw, cy = Math.floor(k / cols) * ch;
    const cell = crop(img, cx, cy, cw, ch);
    const b = alphaBox(cell);
    if (!b) { clean = false; cells.push(cell); continue; }
    const m = 2;
    if (b.x < m || b.y < m || b.x + b.w > cell.w - m || b.y + b.h > cell.h - m) clean = false;
    cells.push(cell);
  }
  if (clean) return { sprites: cells.map((c) => trim(c)), method: 'grid' };
  const regions = components(img);
  if (regions.length >= count) {
    const picked = regions.slice(0, count);
    // Reading order: by row band (the grid's rows), then x.
    picked.sort((a, b) => Math.floor((a.y + a.h / 2) / ch) - Math.floor((b.y + b.h / 2) / ch) || a.x - b.x);
    return { sprites: picked.map((r) => trim(crop(img, r.x, r.y, r.w, r.h))), method: 'regions' };
  }
  return { sprites: cells.map((c) => trim(c)), method: 'grid-fallback' };
}

/** Center crop to an aspect ratio (w/h). */
export function cropAspect(img, aspect) {
  const cur = img.w / img.h;
  if (Math.abs(cur - aspect) < 1e-3) return img;
  if (cur > aspect) { const w = Math.round(img.h * aspect); return crop(img, (img.w - w) / 2, 0, w, img.h); }
  const h = Math.round(img.w / aspect);
  return crop(img, 0, (img.h - h) / 2, img.w, h);
}

/**
 * Area-average downscale (each output pixel averages the source pixels it covers), in premultiplied
 * alpha so transparent edges don't darken. For upscaling it falls back to nearest.
 */
export function resize(img, W, H) {
  W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H));
  const { w, h, data } = img;
  const out = blank(W, H);
  const sx = w / W, sy = h / H;
  for (let Y = 0; Y < H; Y++) {
    const y0 = Y * sy, y1 = y0 + sy;
    for (let X = 0; X < W; X++) {
      const x0 = X * sx, x1 = x0 + sx;
      let r = 0, g = 0, b = 0, a = 0, wt = 0;
      for (let y = Math.floor(y0); y < Math.min(h, Math.ceil(y1)); y++) {
        const fy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.min(w, Math.ceil(x1)); x++) {
          const f = fy * (Math.min(x + 1, x1) - Math.max(x, x0));
          if (f <= 0) continue;
          const o = (y * w + x) * 4;
          const al = data[o + 3] / 255;
          r += data[o] * al * f; g += data[o + 1] * al * f; b += data[o + 2] * al * f; a += al * f; wt += f;
        }
      }
      const o = (Y * W + X) * 4;
      if (a > 0) { out.data[o] = Math.round(r / a); out.data[o + 1] = Math.round(g / a); out.data[o + 2] = Math.round(b / a); }
      out.data[o + 3] = Math.round((a / (wt || 1)) * 255);
    }
  }
  return out;
}

/** Unsharp mask (3×3 box blur) on color; alpha is left alone. amount 0–1.5. */
export function sharpen(img, amount = 0.5) {
  if (amount <= 0) return img;
  const { w, h, data } = img;
  const out = { w, h, data: new Uint8ClampedArray(data) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    if (data[o + 3] === 0) continue;
    for (let c = 0; c < 3; c++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = (yy * w + xx) * 4;
        if (data[k + 3] === 0) continue;
        s += data[k + c]; n++;
      }
      out.data[o + c] = data[o + c] + amount * (data[o + c] - s / n);
    }
  }
  return out;
}

/** Fits an image inside W × H (aspect kept), centered on a transparent canvas. */
export function fitInto(img, W, H) {
  const k = Math.min(W / img.w, H / img.h);
  const rw = Math.max(1, Math.round(img.w * k)), rh = Math.max(1, Math.round(img.h * k));
  const r = resize(img, rw, rh);
  const out = blank(W, H);
  paste(out, r, Math.floor((W - rw) / 2), Math.floor((H - rh) / 2));
  return out;
}

/** Fraction of pixels with any alpha (how much of the frame the sprite fills). */
export function coverage(img) {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] >= 128) n++;
  return n / (img.w * img.h);
}

/** Silhouette check at play size: share of opaque pixels on the alpha edge (thin, noisy shapes score high). */
export function edgeRatio(img) {
  const { w, h, data } = img;
  let edge = 0, solid = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] < 128) continue;
    solid++;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const xx = x + dx, yy = y + dy;
      return xx < 0 || yy < 0 || xx >= w || yy >= h || data[(yy * w + xx) * 4 + 3] < 128;
    });
    if (nb) edge++;
  }
  return solid ? edge / solid : 1;
}

/** How busy a picture is: mean absolute luma step to the right and down neighbours, 0–1. */
export function busyness(img) {
  const { w, h, data } = img;
  const L = (i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  let s = 0, n = 0;
  for (let y = 0; y < h - 1; y += 2) for (let x = 0; x < w - 1; x += 2) {
    const o = (y * w + x) * 4;
    const l = L(o);
    s += Math.abs(l - L(o + 4)) + Math.abs(l - L(o + w * 4));
    n += 2;
  }
  return n ? s / n / 255 : 0;
}

/** Luma contrast (standard deviation, 0–1) and mean saturation (HSV, 0–1): how loud a backdrop is. */
export function loudness(img) {
  const { w, h, data } = img;
  let s = 0, s2 = 0, sat = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    s += l; s2 += l * l;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat += mx ? (mx - mn) / mx : 0;
  }
  const mean = s / n;
  return { contrast: Math.sqrt(Math.max(0, s2 / n - mean * mean)), saturation: sat / n };
}

/** Box blur of radius r (separable, edges clamped), all four channels. */
export function blur(img, r = 1) {
  if (r < 1) return img;
  const { w, h } = img;
  const pass = (src, dx, dy) => {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0];
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k * dx)), yy = Math.min(h - 1, Math.max(0, y + k * dy));
        const o = (yy * w + xx) * 4;
        for (let c = 0; c < 4; c++) acc[c] += src[o + c];
      }
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c] / (2 * r + 1));
    }
    return out;
  };
  return { w, h, data: pass(pass(img.data, 1, 0), 0, 1) };
}

/** Mixes every pixel toward a color by `amount` (0–1): calms a busy backdrop behind play. */
export function tint(img, rgb, amount) {
  if (!(amount > 0)) return img;
  const out = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
  for (let i = 0; i < img.w * img.h; i++) for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round(img.data[i * 4 + c] * (1 - amount) + rgb[c] * amount);
  return out;
}

/** Composites over a solid color (for previews and the JPEG matte). */
export function flatten(img, rgb) {
  const out = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
  for (let i = 0; i < img.w * img.h; i++) {
    const a = img.data[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round(img.data[i * 4 + c] * a + rgb[c] * (1 - a));
    out.data[i * 4 + 3] = 255;
  }
  return out;
}
