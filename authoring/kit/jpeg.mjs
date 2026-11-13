// A baseline JPEG decoder (sequential DCT, Huffman, 8-bit, any sampling, restart markers), enough
// for the pictures our image-art step writes (image-codec.mjs encodeJPEG) and for most camera-free
// baseline files. Progressive and arithmetic-coded files are rejected. Pure JS, no imports.
//
//   decodeJPEG(bytes) → {w, h, data: Uint8ClampedArray RGBA}

const ZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

export function isJPEG(b) { return b && b.length > 3 && b[0] === 0xff && b[1] === 0xd8; }

function buildHuff(counts, symbols) {
  // Canonical codes: lookup by (length, code).
  const maxcode = new Int32Array(18).fill(-1), valptr = new Int32Array(17), mincode = new Int32Array(17);
  let code = 0, k = 0;
  for (let l = 1; l <= 16; l++) {
    valptr[l] = k; mincode[l] = code;
    code += counts[l - 1]; k += counts[l - 1];
    maxcode[l] = counts[l - 1] ? code - 1 : -1;
    code <<= 1;
  }
  return { maxcode, valptr, mincode, symbols };
}

// IDCT cosine table.
const COS = new Float64Array(64);
for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) COS[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);

function idct(inp, out) {
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) {
    let s = 0;
    for (let v = 0; v < 8; v++) s += COS[y * 8 + v] * inp[v * 8 + u];
    tmp[y * 8 + u] = s;
  }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let s = 0;
    for (let u = 0; u < 8; u++) s += COS[x * 8 + u] * tmp[y * 8 + u];
    out[y * 8 + x] = s / 4;
  }
}

export function decodeJPEG(bytes) {
  if (!isJPEG(bytes)) throw new Error('not a JPEG');
  const qt = [], dc = [], ac = [];
  let frame = null, restart = 0, p = 2;
  const u16 = (i) => (bytes[i] << 8) | bytes[i + 1];
  while (p < bytes.length) {
    if (bytes[p] !== 0xff) { p++; continue; }
    const marker = bytes[p + 1];
    p += 2;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) continue;
    if (marker === 0xd9) break;
    const len = u16(p);
    const seg = p + 2, end = p + len;
    if (marker === 0xdb) {
      let q = seg;
      while (q < end) {
        const pq = bytes[q] >> 4, tq = bytes[q] & 15; q++;
        const t = new Int32Array(64);
        for (let i = 0; i < 64; i++) { t[ZZ[i]] = pq ? u16(q + i * 2) : bytes[q + i]; }
        q += pq ? 128 : 64;
        qt[tq] = t;
      }
    } else if (marker === 0xc0 || marker === 0xc1) {
      const comps = [];
      const n = bytes[seg + 5];
      for (let i = 0; i < n; i++) { const b = seg + 6 + i * 3; comps.push({ id: bytes[b], h: bytes[b + 1] >> 4, v: bytes[b + 1] & 15, tq: bytes[b + 2] }); }
      frame = { h: u16(seg + 1), w: u16(seg + 3), comps };
    } else if (marker === 0xc2 || marker === 0xc3 || (marker >= 0xc5 && marker <= 0xcf && marker !== 0xc8 && marker !== 0xcc)) {
      throw new Error('only baseline JPEGs are supported');
    } else if (marker === 0xc4) {
      let q = seg;
      while (q < end) {
        const tc = bytes[q] >> 4, th = bytes[q] & 15;
        const counts = Array.from(bytes.subarray(q + 1, q + 17));
        const total = counts.reduce((a, b) => a + b, 0);
        const syms = bytes.subarray(q + 17, q + 17 + total);
        (tc ? ac : dc)[th] = buildHuff(counts, Array.from(syms));
        q += 17 + total;
      }
    } else if (marker === 0xdd) {
      restart = u16(seg);
    } else if (marker === 0xda) {
      if (!frame) throw new Error('SOS before SOF');
      const ns = bytes[seg];
      const scomps = [];
      for (let i = 0; i < ns; i++) { const id = bytes[seg + 1 + i * 2], t = bytes[seg + 2 + i * 2]; const c = frame.comps.find((x) => x.id === id); c.td = t >> 4; c.ta = t & 15; scomps.push(c); }
      p = decodeScan(bytes, end, frame, scomps, qt, dc, ac, restart);
      continue;
    }
    p = end;
  }
  if (!frame || !frame.comps[0].plane) throw new Error('no image data');
  // Colour.
  const { w, h, comps } = frame;
  const hmax = Math.max(...comps.map((c) => c.h)), vmax = Math.max(...comps.map((c) => c.v));
  const data = new Uint8ClampedArray(w * h * 4);
  const at = (c, x, y) => c.plane[Math.floor((y * c.v) / vmax) * c.stride + Math.floor((x * c.h) / hmax)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y * w + x) * 4;
    if (comps.length >= 3) {
      const Y = at(comps[0], x, y), cb = at(comps[1], x, y) - 128, cr = at(comps[2], x, y) - 128;
      data[k] = Y + 1.402 * cr; data[k + 1] = Y - 0.344136 * cb - 0.714136 * cr; data[k + 2] = Y + 1.772 * cb;
    } else { const Y = at(comps[0], x, y); data[k] = data[k + 1] = data[k + 2] = Y; }
    data[k + 3] = 255;
  }
  return { w, h, data };
}

function decodeScan(bytes, end, frame, scomps, qt, dcT, acT, restart) {
  const hmax = Math.max(...frame.comps.map((c) => c.h)), vmax = Math.max(...frame.comps.map((c) => c.v));
  const mcuX = Math.ceil(frame.w / (8 * hmax)), mcuY = Math.ceil(frame.h / (8 * vmax));
  for (const c of frame.comps) {
    if (!c.plane) { c.stride = mcuX * c.h * 8; c.plane = new Float32Array(c.stride * mcuY * c.v * 8); }
  }
  let p = end, bitBuf = 0, bitCnt = 0;
  const readBit = () => {
    if (bitCnt === 0) {
      if (p >= bytes.length) return 0;
      let b = bytes[p++];
      if (b === 0xff) { const nb = bytes[p]; if (nb === 0) p++; else if (nb >= 0xd0 && nb <= 0xd7) { /* marker: feed zeros */ p--; b = 0; } else { p--; b = 0; } }
      bitBuf = b; bitCnt = 8;
    }
    bitCnt--;
    return (bitBuf >> bitCnt) & 1;
  };
  const receive = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | readBit(); return v; };
  const extend = (v, n) => (n && v < 1 << (n - 1) ? v - (1 << n) + 1 : v);
  const decodeHuff = (t) => {
    let code = 0;
    for (let l = 1; l <= 16; l++) {
      code = (code << 1) | readBit();
      if (t.maxcode[l] >= 0 && code <= t.maxcode[l]) return t.symbols[t.valptr[l] + code - t.mincode[l]];
    }
    return 0;
  };
  const coef = new Float64Array(64), out = new Float64Array(64);
  const single = scomps.length === 1;
  const decodeBlock = (c, bx, by) => {
    coef.fill(0);
    const s = decodeHuff(dcT[c.td]);
    c.pred = (c.pred ?? 0) + (s ? extend(receive(s), s) : 0);
    const q = qt[c.tq];
    coef[0] = c.pred * q[0];
    for (let k = 1; k < 64;) {
      const rs = decodeHuff(acT[c.ta]);
      const r = rs >> 4, sz = rs & 15;
      if (!sz) { if (r === 15) { k += 16; continue; } break; }
      k += r;
      if (k > 63) break;
      coef[ZZ[k]] = extend(receive(sz), sz) * q[ZZ[k]];
      k++;
    }
    idct(coef, out);
    for (let y = 0; y < 8; y++) {
      const row = (by * 8 + y) * c.stride + bx * 8;
      if (row >= c.plane.length) break;
      for (let x = 0; x < 8; x++) c.plane[row + x] = out[y * 8 + x] + 128;
    }
  };
  const resetRestart = () => {
    bitCnt = 0;
    while (p + 1 < bytes.length && !(bytes[p] === 0xff && bytes[p + 1] >= 0xd0 && bytes[p + 1] <= 0xd7)) p++;
    p += 2;
    for (const c of scomps) c.pred = 0;
  };
  for (const c of scomps) c.pred = 0;
  let n = 0;
  if (single) {
    const c = scomps[0];
    const bw = Math.ceil((Math.ceil((frame.w * c.h) / hmax)) / 8), bh = Math.ceil((Math.ceil((frame.h * c.v) / vmax)) / 8);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      if (restart && n && n % restart === 0) resetRestart();
      decodeBlock(c, bx, by); n++;
    }
  } else {
    for (let my = 0; my < mcuY; my++) for (let mx = 0; mx < mcuX; mx++) {
      if (restart && n && n % restart === 0) resetRestart();
      for (const c of scomps) for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) decodeBlock(c, mx * c.h + h, my * c.v + v);
      n++;
    }
  }
  // Find the next marker.
  while (p + 1 < bytes.length && !(bytes[p] === 0xff && bytes[p + 1] !== 0 && !(bytes[p + 1] >= 0xd0 && bytes[p + 1] <= 0xd7))) p++;
  return p;
}
