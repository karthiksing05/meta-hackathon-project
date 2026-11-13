// Image codecs for build-time art (image-art.mjs): PNG decode and encode (truecolor with alpha, or
// 8-bit palette with transparency), a palette quantizer, and a baseline JPEG encoder with optimal
// Huffman tables. Pure JS with no imports: the caller passes zlib's inflate and deflate, so the same
// code runs in Node (node:zlib) and anywhere else that has a zlib.
//
// An image is {w, h, data} with data a Uint8ClampedArray of RGBA bytes, row by row (like ImageData).
// Everything here is deterministic: the same pixels and options give the same bytes.

// ---------- PNG ----------

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function chunk(type, body) {
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** True when the bytes start with the PNG signature. */
export function isPNG(bytes) {
  return bytes && bytes.length > 8 && PNG_SIG.every((v, i) => bytes[i] === v);
}

/**
 * Decodes a non-interlaced 8-bit PNG (grey, grey+alpha, RGB, RGBA or palette) to RGBA.
 * inflate(Uint8Array) → Uint8Array (zlib stream).
 */
export function decodePNG(bytes, inflate) {
  if (!isPNG(bytes)) throw new Error('not a PNG');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  let w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (p < bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12);
      depth = body[8]; ctype = body[9]; interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`PNG bit depth ${depth} isn't supported (8 only)`);
  if (interlace) throw new Error('interlaced PNGs aren\'t supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error(`PNG color type ${ctype} isn't supported`);
  const raw = inflate(concat(idat));
  const stride = w * channels;
  const px = new Uint8Array(h * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) v += paeth(a, b, c);
      cur[i] = v & 255;
    }
    prev = cur;
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += channels) {
    const o = i * 4;
    if (ctype === 6) { data[o] = px[j]; data[o + 1] = px[j + 1]; data[o + 2] = px[j + 2]; data[o + 3] = px[j + 3]; }
    else if (ctype === 2) { data[o] = px[j]; data[o + 1] = px[j + 1]; data[o + 2] = px[j + 2]; data[o + 3] = 255; }
    else if (ctype === 0) { data[o] = data[o + 1] = data[o + 2] = px[j]; data[o + 3] = 255; }
    else if (ctype === 4) { data[o] = data[o + 1] = data[o + 2] = px[j]; data[o + 3] = px[j + 1]; }
    else {
      const k = px[j];
      data[o] = palette[k * 3]; data[o + 1] = palette[k * 3 + 1]; data[o + 2] = palette[k * 3 + 2];
      data[o + 3] = trns && k < trns.length ? trns[k] : 255;
    }
  }
  return { w, h, data };
}

// Filters each row with the filter that gives the smallest sum of absolute values (the usual heuristic).
function filterRows(px, h, stride, bpp) {
  const out = new Uint8Array(h * (stride + 1));
  const zero = new Uint8Array(stride);
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  for (let y = 0; y < h; y++) {
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : zero;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const o = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        const v = (cur[i] - (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 255;
        o[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    out[y * (stride + 1)] = best;
    out.set(cand[best], y * (stride + 1) + 1);
  }
  return out;
}

function ihdr(w, h, ctype) {
  const b = new Uint8Array(13);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  b[8] = 8; b[9] = ctype; b[10] = 0; b[11] = 0; b[12] = 0;
  return b;
}

/**
 * Encodes RGBA as PNG. deflate(Uint8Array) → Uint8Array (zlib stream).
 * opts.palette: an indexed image from quantize() ({indices, colors}) to write an 8-bit palette PNG.
 */
export function encodePNG(img, deflate, opts = {}) {
  const { w, h } = img;
  if (opts.palette) {
    const { indices, colors } = opts.palette;
    const n = colors.length / 4;
    const plte = new Uint8Array(n * 3);
    let lastOpaque = -1;
    for (let i = 0; i < n; i++) {
      plte[i * 3] = colors[i * 4]; plte[i * 3 + 1] = colors[i * 4 + 1]; plte[i * 3 + 2] = colors[i * 4 + 2];
      if (colors[i * 4 + 3] !== 255) lastOpaque = i;
    }
    const parts = [Uint8Array.from(PNG_SIG), chunk('IHDR', ihdr(w, h, 3)), chunk('PLTE', plte)];
    if (lastOpaque >= 0) {
      const t = new Uint8Array(lastOpaque + 1);
      for (let i = 0; i <= lastOpaque; i++) t[i] = colors[i * 4 + 3];
      parts.push(chunk('tRNS', t));
    }
    parts.push(chunk('IDAT', deflate(filterRows(indices, h, w, 1))), chunk('IEND', new Uint8Array(0)));
    return concat(parts);
  }
  let opaque = true;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 255) { opaque = false; break; }
  const ch = opaque ? 3 : 4;
  const px = new Uint8Array(w * h * ch);
  for (let i = 0, j = 0; i < w * h; i++, j += ch) {
    px[j] = img.data[i * 4]; px[j + 1] = img.data[i * 4 + 1]; px[j + 2] = img.data[i * 4 + 2];
    if (ch === 4) px[j + 3] = img.data[i * 4 + 3];
  }
  return concat([Uint8Array.from(PNG_SIG), chunk('IHDR', ihdr(w, h, opaque ? 2 : 6)), chunk('IDAT', deflate(filterRows(px, h, w * ch, ch))), chunk('IEND', new Uint8Array(0))]);
}

// ---------- palette quantizer ----------

/**
 * Median cut on RGBA to at most `colors` entries. Fully transparent pixels share index 0. Pixels are
 * mapped to the nearest palette color (no dithering: sprites are small and flat-shaded, and dither
 * noise compresses badly). Returns {indices: Uint8Array, colors: Uint8Array (RGBA × n)}.
 */
export function quantize(img, colors = 256) {
  const { w, h, data } = img;
  const n = w * h;
  // Histogram on 5 bits per channel (+ 3 alpha levels) keeps the boxes small and the result stable.
  const bins = new Map();
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    if (a < 8) continue;
    const key = ((data[i * 4] >> 3) << 12) | ((data[i * 4 + 1] >> 3) << 7) | ((data[i * 4 + 2] >> 3) << 2) | (a >= 248 ? 3 : a >= 128 ? 2 : 1);
    const b = bins.get(key);
    if (b) { b[0] += data[i * 4]; b[1] += data[i * 4 + 1]; b[2] += data[i * 4 + 2]; b[3] += a; b[4]++; }
    else bins.set(key, [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], a, 1, key]);
  }
  const entries = [...bins.values()].sort((x, y) => x[5] - y[5]);
  const boxes = entries.length ? [entries] : [];
  const want = Math.max(1, colors - 1);
  const range = (box, c) => { let lo = 255, hi = 0; for (const e of box) { const v = e[c] / e[4]; if (v < lo) lo = v; if (v > hi) hi = v; } return hi - lo; };
  const weight = (box) => box.reduce((a, e) => a + e[4], 0);
  while (boxes.length < want) {
    let bi = -1, bestScore = 0, bestC = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      for (let c = 0; c < 4; c++) {
        const s = range(boxes[i], c) * Math.sqrt(weight(boxes[i]));
        if (s > bestScore) { bestScore = s; bi = i; bestC = c; }
      }
    }
    if (bi < 0) break;
    const box = boxes[bi].slice().sort((x, y) => x[bestC] / x[4] - y[bestC] / y[4] || x[5] - y[5]);
    const half = weight(box) / 2;
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) { acc += box[i][4]; if (acc >= half) { cut = i + 1; break; } cut = i + 1; }
    boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
  }
  const pal = new Uint8Array((boxes.length + 1) * 4); // index 0: transparent
  boxes.forEach((box, i) => {
    let r = 0, g = 0, b = 0, a = 0, c = 0;
    for (const e of box) { r += e[0]; g += e[1]; b += e[2]; a += e[3]; c += e[4]; }
    pal[(i + 1) * 4] = Math.round(r / c); pal[(i + 1) * 4 + 1] = Math.round(g / c); pal[(i + 1) * 4 + 2] = Math.round(b / c);
    const av = Math.round(a / c);
    pal[(i + 1) * 4 + 3] = av >= 248 ? 255 : av;
  });
  // Translucent entries first, so tRNS stays short.
  const order = [0, ...boxes.map((_, i) => i + 1).sort((x, y) => (pal[x * 4 + 3] === 255) - (pal[y * 4 + 3] === 255) || x - y)];
  const sorted = new Uint8Array(pal.length);
  order.forEach((src, dst) => sorted.set(pal.subarray(src * 4, src * 4 + 4), dst * 4));
  const m = sorted.length / 4;
  const cache = new Map();
  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    if (a < 8) { indices[i] = 0; continue; }
    const key = (data[i * 4] << 24 >>> 0) + (data[i * 4 + 1] << 16) + (data[i * 4 + 2] << 8) + a;
    let k = cache.get(key);
    if (k === undefined) {
      let best = Infinity;
      k = 1;
      for (let j = 1; j < m; j++) {
        const dr = sorted[j * 4] - data[i * 4], dg = sorted[j * 4 + 1] - data[i * 4 + 1], db = sorted[j * 4 + 2] - data[i * 4 + 2], da = sorted[j * 4 + 3] - a;
        const d = 2 * dr * dr + 4 * dg * dg + db * db + 3 * da * da;
        if (d < best) { best = d; k = j; }
      }
      cache.set(key, k);
    }
    indices[i] = k;
  }
  return { indices, colors: sorted };
}

/** The RGBA image a palette encoding shows (for previews and tests). */
export function dequantize(w, h, q) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(q.colors.subarray(q.indices[i] * 4, q.indices[i] * 4 + 4), i * 4);
  return { w, h, data };
}

// ---------- JPEG (baseline, 4:2:0, optimal Huffman tables) ----------

const Q_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const Q_CHROMA = (() => {
  const q = new Array(64).fill(99);
  const top = [[17, 18, 24, 47], [18, 21, 26, 66], [24, 26, 56, 99], [47, 66, 99, 99]];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) q[y * 8 + x] = top[y][x];
  return q;
})();
// ZIGZAG[k] = natural (row-major) index of the k-th coefficient in zigzag order.
const ZIGZAG = (() => {
  const out = [];
  for (let s = 0; s < 15; s++) {
    const cells = [];
    for (let y = 0; y < 8; y++) { const x = s - y; if (x >= 0 && x < 8) cells.push(y * 8 + x); }
    if (s % 2 === 0) cells.reverse(); // even diagonals run bottom-left to top-right
    out.push(...cells);
  }
  return out;
})();
const COS = (() => {
  const t = new Float64Array(64);
  for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) t[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1);
  return t;
})();

function scaledTable(base, quality) {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  const s = q < 50 ? 5000 / q : 200 - 2 * q;
  return base.map((v) => Math.max(1, Math.min(255, Math.floor((v * s + 50) / 100))));
}

// Forward DCT of one 8×8 block (values centred on 0), quantized, in zigzag order.
function fdctQuant(block, qt, out) {
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) {
    let s = 0;
    for (let x = 0; x < 8; x++) s += block[y * 8 + x] * COS[x * 8 + u];
    tmp[y * 8 + u] = s / 2;
  }
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
    let s = 0;
    for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[y * 8 + v];
    const coef = s / 2;
    const nat = v * 8 + u;
    out[nat] = Math.round(coef / qt[nat]);
  }
  const z = new Int32Array(64);
  for (let k = 0; k < 64; k++) z[k] = out[ZIGZAG[k]];
  return z;
}

const bitLength = (v) => { v = Math.abs(v); let n = 0; while (v) { n++; v >>= 1; } return n; };

// Huffman code lengths limited to 16 bits (JPEG Annex K.2), returns {bits[16], vals[]}.
function huffmanSpec(freq) {
  const f = Array.from(freq);
  f[256] = 1; // reserved so no code is all ones
  const size = new Array(257).fill(0);
  const others = new Array(257).fill(-1);
  for (;;) {
    let c1 = -1, c2 = -1;
    for (let i = 0; i < 257; i++) if (f[i] > 0 && (c1 < 0 || f[i] <= f[c1])) c1 = i;
    for (let i = 0; i < 257; i++) if (f[i] > 0 && i !== c1 && (c2 < 0 || f[i] <= f[c2])) c2 = i;
    if (c2 < 0) break;
    f[c1] += f[c2]; f[c2] = 0;
    size[c1]++;
    let k = c1;
    while (others[k] >= 0) { k = others[k]; size[k]++; }
    others[k] = c2;
    size[c2]++;
    k = c2;
    while (others[k] >= 0) { k = others[k]; size[k]++; }
  }
  const bits = new Array(33).fill(0);
  for (let i = 0; i < 257; i++) if (size[i]) bits[size[i]]++;
  for (let i = 32; i > 16; i--) {
    while (bits[i] > 0) {
      let j = i - 2;
      while (bits[j] === 0) j--;
      bits[i] -= 2; bits[i - 1]++; bits[j + 1] += 2; bits[j]--;
    }
  }
  let i = 16;
  while (bits[i] === 0) i--;
  bits[i]--; // drop the reserved symbol
  const vals = [];
  for (let len = 1; len <= 32; len++) for (let s = 0; s < 256; s++) if (size[s] === len) vals.push(s);
  return { bits: bits.slice(1, 17), vals };
}

function huffmanCodes({ bits, vals }) {
  const codes = new Map();
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) codes.set(vals[k++], [code++, len]);
    code <<= 1;
  }
  return codes;
}

/**
 * Encodes RGBA (alpha ignored, composited on `matte`, default white) as a baseline JPEG, 4:2:0.
 * Two passes: the first counts symbols, the second writes with optimal Huffman tables.
 */
export function encodeJPEG(img, quality = 70, { matte = [255, 255, 255] } = {}) {
  const { w, h, data } = img;
  const qY = scaledTable(Q_LUMA, quality), qC = scaledTable(Q_CHROMA, quality);
  const W = Math.ceil(w / 16) * 16, H = Math.ceil(h / 16) * 16;
  const Y = new Float64Array(W * H), Cb = new Float64Array(W * H), Cr = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.min(x, w - 1), sy = Math.min(y, h - 1), o = (sy * w + sx) * 4;
    const a = data[o + 3] / 255;
    const r = data[o] * a + matte[0] * (1 - a), g = data[o + 1] * a + matte[1] * (1 - a), b = data[o + 2] * a + matte[2] * (1 - a);
    const i = y * W + x;
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
    Cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  // Quantized blocks in scan order: per MCU, 4 Y blocks then Cb then Cr.
  const blocks = [];
  const nat = new Int32Array(64);
  const blk = new Float64Array(64);
  for (let my = 0; my < H; my += 16) for (let mx = 0; mx < W; mx += 16) {
    for (const [ox, oy] of [[0, 0], [8, 0], [0, 8], [8, 8]]) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[y * 8 + x] = Y[(my + oy + y) * W + mx + ox + x];
      blocks.push({ c: 0, z: fdctQuant(blk, qY, nat) });
    }
    for (const [plane, c] of [[Cb, 1], [Cr, 2]]) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const i = (my + 2 * y) * W + mx + 2 * x;
        blk[y * 8 + x] = (plane[i] + plane[i + 1] + plane[i + W] + plane[i + W + 1]) / 4;
      }
      blocks.push({ c, z: fdctQuant(blk, qC, nat) });
    }
  }
  // Symbols: per block a DC difference category, then AC (run, size) pairs.
  const freq = [new Array(256).fill(0), new Array(256).fill(0), new Array(256).fill(0), new Array(256).fill(0)]; // dcY, dcC, acY, acC
  const seq = [];
  const pred = [0, 0, 0];
  for (const { c, z } of blocks) {
    const t = c === 0 ? 0 : 1;
    const diff = z[0] - pred[c];
    pred[c] = z[0];
    const s = bitLength(diff);
    freq[t][s]++;
    seq.push([t, s, diff, s]);
    let run = 0;
    let last = 63;
    while (last > 0 && z[last] === 0) last--;
    for (let k = 1; k <= last; k++) {
      if (z[k] === 0) { run++; continue; }
      while (run > 15) { freq[2 + t][0xf0]++; seq.push([2 + t, 0xf0, 0, 0]); run -= 16; }
      const sz = bitLength(z[k]);
      const sym = (run << 4) | sz;
      freq[2 + t][sym]++;
      seq.push([2 + t, sym, z[k], sz]);
      run = 0;
    }
    if (last < 63) { freq[2 + t][0]++; seq.push([2 + t, 0, 0, 0]); }
  }
  const specs = freq.map((f) => huffmanSpec(f));
  const codes = specs.map(huffmanCodes);

  const bytes = [];
  const u16 = (v) => bytes.push((v >> 8) & 255, v & 255);
  const marker = (m) => bytes.push(0xff, m);
  marker(0xd8);
  marker(0xe0); u16(16); bytes.push(0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0); u16(1); u16(1); bytes.push(0, 0);
  for (const [id, qt] of [[0, qY], [1, qC]]) { marker(0xdb); u16(67); bytes.push(id); for (let k = 0; k < 64; k++) bytes.push(qt[ZIGZAG[k]]); }
  marker(0xc0); u16(17); bytes.push(8); u16(h); u16(w); bytes.push(3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  for (const [cls, id, spec] of [[0, 0, specs[0]], [0, 1, specs[1]], [1, 0, specs[2]], [1, 1, specs[3]]]) {
    marker(0xc4); u16(19 + spec.vals.length); bytes.push((cls << 4) | id, ...spec.bits, ...spec.vals);
  }
  marker(0xda); u16(12); bytes.push(3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0);
  let acc = 0, nbits = 0;
  const put = (code, len) => {
    for (let i = len - 1; i >= 0; i--) {
      acc = (acc << 1) | ((code >> i) & 1);
      if (++nbits === 8) { bytes.push(acc); if (acc === 0xff) bytes.push(0); acc = 0; nbits = 0; }
    }
  };
  for (const [t, sym, val, sz] of seq) {
    const [code, len] = codes[t].get(sym);
    put(code, len);
    if (sz) put(val < 0 ? val + (1 << sz) - 1 : val, sz);
  }
  if (nbits) put((1 << (8 - nbits)) - 1, 8 - nbits);
  marker(0xd9);
  return Uint8Array.from(bytes);
}

// ---------- helpers ----------

/** Base64 without Node's Buffer, for data: URIs. */
export function toBase64(bytes) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += A[n >> 18] + A[(n >> 12) & 63] + A[(n >> 6) & 63] + A[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8);
    s += A[n >> 18] + A[(n >> 12) & 63] + (i + 1 < bytes.length ? A[(n >> 6) & 63] : '=') + '=';
  }
  return s;
}

export const dataUri = (mime, bytes) => `data:${mime};base64,${toBase64(bytes)}`;
