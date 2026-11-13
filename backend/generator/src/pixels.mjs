// Image work for the art step, in plain Node (the generator has no npm packages): decode a PNG, resize, cut a
// sprite out of a flat green background, and encode PNG (sprites, with alpha) or baseline JPEG (backdrops).
// Images are {w, h, data: Uint8ClampedArray RGBA}.

import zlib from 'node:zlib';

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// ---------------------------------------------------------------- PNG decode

/** 8-bit PNG (gray, RGB, palette, gray+alpha, RGBA; not interlaced) -> RGBA. */
export function decodePNG(buf) {
  buf = Buffer.from(buf);
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG');
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`unsupported PNG color type ${type}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[i] = v & 255;
    }
    prev = out;
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += channels) {
    let r, g, b, al = 255;
    if (type === 0) { r = g = b = px[j]; }
    else if (type === 2) { r = px[j]; g = px[j + 1]; b = px[j + 2]; }
    else if (type === 3) { const k = px[j]; r = palette[k * 3]; g = palette[k * 3 + 1]; b = palette[k * 3 + 2]; if (trns && k < trns.length) al = trns[k]; }
    else if (type === 4) { r = g = b = px[j]; al = px[j + 1]; }
    else { r = px[j]; g = px[j + 1]; b = px[j + 2]; al = px[j + 3]; }
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = al;
  }
  return { w, h, data };
}

// ---------------------------------------------------------------- PNG encode

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(kind, body) {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(kind, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/** RGBA -> PNG (per-row filter chosen by the smallest sum of absolute differences). */
export function encodePNG({ w, h, data }) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    const cur = data.subarray(y * stride, (y + 1) * stride);
    const up = y ? data.subarray((y - 1) * stride, y * stride) : null;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const o = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? cur[i - 4] : 0, b = up ? up[i] : 0, c = up && i >= 4 ? up[i - 4] : 0;
        let p = 0;
        if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
        else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const v = (cur[i] - p) & 255;
        o[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- geometry

/** Area-average resize (good for shrinking). */
export function resize(img, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.w / w, sy = img.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy, y1 = y0 + sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx, x1 = x0 + sx;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = Math.floor(y0); yy < Math.min(img.h, Math.ceil(y1)); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.min(img.w, Math.ceil(x1)); xx++) {
          const wt = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0));
          const i = (yy * img.w + xx) * 4;
          const al = img.data[i + 3] * wt;
          r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al; a += al; n += wt;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = n ? a / n : 0;
    }
  }
  return { w, h, data: out };
}

export function crop(img, x, y, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(img.data.subarray(((y + r) * img.w + x) * 4, ((y + r) * img.w + x + w) * 4), r * w * 4);
  return { w, h, data: out };
}

/** Scale and centre-crop to exactly w x h (cover). */
export function cover(img, w, h) {
  const s = Math.max(w / img.w, h / img.h);
  const cw = Math.round(w / s), ch = Math.round(h / s);
  return resize(crop(img, Math.floor((img.w - cw) / 2), Math.floor((img.h - ch) / 2), cw, ch), w, h);
}

// ---------------------------------------------------------------- sprite cut-out

/**
 * Keys out a flat background (green, sampled from the border) and crops to the subject with a small margin.
 * Returns {img, coverage} or throws when there is no green background or no subject.
 */
export function cutOut(img, { margin = 0.04 } = {}) {
  const { w, h, data } = img;
  const border = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 64));
  for (let x = 0; x < w; x += step) border.push((0 * w + x) * 4, ((h - 1) * w + x) * 4);
  for (let y = 0; y < h; y += step) border.push((y * w + 0) * 4, (y * w + w - 1) * 4);
  const med = (k) => { const v = border.map((i) => data[i + k]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const key = [med(0), med(1), med(2)];
  if (!(key[1] > key[0] + 60 && key[1] > key[2] + 60)) throw new Error(`the background isn't green (rgb ${key.join(',')})`);
  const out = new Uint8ClampedArray(data);
  let minX = w, minY = h, maxX = -1, maxY = -1, solid = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const d = Math.hypot(r - key[0], g - key[1], b - key[2]);
    const greenness = g - Math.max(r, b);
    let a = d < 70 ? 0 : d > 140 ? 1 : (d - 70) / 70;
    if (greenness > 90) a = Math.min(a, 0.15);
    if (a < 1 && greenness > 0) out[i + 1] = Math.max(r, b) + greenness * a * 0.3; // despill the edge
    out[i + 3] = Math.round(a * data[i + 3]);
    if (a > 0.5) { solid++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  const coverage = solid / (w * h);
  if (maxX < 0 || coverage < 0.01) throw new Error('no subject found on the green background');
  if (coverage > 0.97) throw new Error('nothing was keyed out');
  const m = Math.round(Math.max(maxX - minX, maxY - minY) * margin);
  const x0 = Math.max(0, minX - m), y0 = Math.max(0, minY - m);
  const x1 = Math.min(w - 1, maxX + m), y1 = Math.min(h - 1, maxY + m);
  return { img: crop({ w, h, data: out }, x0, y0, x1 - x0 + 1, y1 - y0 + 1), coverage };
}

/** Fit inside max x max, keeping the aspect. */
export function fit(img, max) {
  const s = Math.min(1, max / Math.max(img.w, img.h));
  return s === 1 ? img : resize(img, Math.max(1, Math.round(img.w * s)), Math.max(1, Math.round(img.h * s)));
}

// ---------------------------------------------------------------- JPEG encode (baseline, 4:4:4)

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const Q_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const Q_CHROMA = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99];
// Standard Huffman tables (JPEG Annex K.3): code counts per length 1..16, then the symbols.
const DC_L = [[0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]];
const DC_C = [[0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]];
const AC_L = [[0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa]];
const AC_C = [[0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
  0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
  0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
  0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa]];

function huffCodes([counts, symbols]) {
  const codes = {};
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len - 1]; i++) codes[symbols[k++]] = [code++, len];
    code <<= 1;
  }
  return codes;
}
const H = { dcL: huffCodes(DC_L), acL: huffCodes(AC_L), dcC: huffCodes(DC_C), acC: huffCodes(AC_C) };

function scaledTable(base, quality) {
  const q = Math.min(100, Math.max(1, quality));
  const s = q < 50 ? 5000 / q : 200 - 2 * q;
  return base.map((v) => Math.min(255, Math.max(1, Math.floor((v * s + 50) / 100))));
}

const COS = (() => { const t = []; for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) t[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / 16); return t; })();

function fdct(block) {
  const out = new Float64Array(64);
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
    let s = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) s += block[y * 8 + x] * COS[x * 8 + u] * COS[y * 8 + v];
    out[v * 8 + u] = 0.25 * (u ? 1 : Math.SQRT1_2) * (v ? 1 : Math.SQRT1_2) * s;
  }
  return out;
}

/** Opaque RGBA -> baseline JPEG (alpha is composited over white). */
export function encodeJPEG({ w, h, data }, quality = 72) {
  const qL = scaledTable(Q_LUMA, quality), qC = scaledTable(Q_CHROMA, quality);
  const bytes = [];
  let bitBuf = 0, bitCnt = 0;
  const put = (code, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bitBuf = (bitBuf << 1) | ((code >> i) & 1);
      if (++bitCnt === 8) { bytes.push(bitBuf); if (bitBuf === 0xff) bytes.push(0); bitBuf = 0; bitCnt = 0; }
    }
  };
  const bits = (v) => { let a = Math.abs(v), n = 0; while (a) { n++; a >>= 1; } return n; };
  const valueBits = (v, n) => (v < 0 ? v + (1 << n) - 1 : v);
  const block = (px, q, prev, dc, ac) => {
    const d = fdct(px);
    const z = new Int32Array(64);
    for (let i = 0; i < 64; i++) z[i] = Math.round(d[ZIGZAG[i]] / q[ZIGZAG[i]]);
    const diff = z[0] - prev, n = bits(diff);
    put(...dc[n]); if (n) put(valueBits(diff, n), n);
    let run = 0;
    for (let i = 1; i < 64; i++) {
      if (!z[i]) { run++; continue; }
      while (run > 15) { put(...ac[0xf0]); run -= 16; }
      const m = bits(z[i]);
      put(...ac[(run << 4) | m]); put(valueBits(z[i], m), m);
      run = 0;
    }
    if (run) put(...ac[0x00]);
    return z[0];
  };
  const Y = new Float64Array(64), Cb = new Float64Array(64), Cr = new Float64Array(64);
  let pY = 0, pCb = 0, pCr = 0;
  for (let by = 0; by < h; by += 8) for (let bx = 0; bx < w; bx += 8) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const i = (Math.min(h - 1, by + y) * w + Math.min(w - 1, bx + x)) * 4;
      const a = data[i + 3] / 255;
      const r = data[i] * a + 255 * (1 - a), g = data[i + 1] * a + 255 * (1 - a), b = data[i + 2] * a + 255 * (1 - a);
      const k = y * 8 + x;
      Y[k] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
      Cb[k] = -0.168736 * r - 0.331264 * g + 0.5 * b;
      Cr[k] = 0.5 * r - 0.418688 * g - 0.081312 * b;
    }
    pY = block(Y, qL, pY, H.dcL, H.acL);
    pCb = block(Cb, qC, pCb, H.dcC, H.acC);
    pCr = block(Cr, qC, pCr, H.dcC, H.acC);
  }
  if (bitCnt) put(0x7f, 8 - bitCnt); // pad with ones
  const seg = (marker, body) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
  const dqt = (id, t) => [id, ...ZIGZAG.map((z) => t[z])];
  const dht = (cls, id, [counts, symbols]) => [(cls << 4) | id, ...counts, ...symbols];
  const head = [
    0xff, 0xd8,
    ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xdb, [...dqt(0, qL), ...dqt(1, qC)]),
    ...seg(0xc0, [8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ...seg(0xc4, [...dht(0, 0, DC_L), ...dht(1, 0, AC_L), ...dht(0, 1, DC_C), ...dht(1, 1, AC_C)]),
    ...seg(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]),
  ];
  return Buffer.concat([Buffer.from(head), Buffer.from(bytes), Buffer.from([0xff, 0xd9])]);
}

export const dataURI = (mime, buf) => `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
