// A small software compositor for engine frames, so readability can be measured without a browser
// (the generator's server image has no Chrome). It paints a frame's draw list the way
// engine/web/render.js does, minus text: background, rects (rounded), circles, lines, polys and
// image assets (PNG pictures through image-codec.mjs, SVG sprites through the small SVG rasterizer
// below), with opacity, scale, flips and clip ops. Rotation of images is ignored (drawn upright).
//
// The SVG rasterizer covers what our art uses: nested <svg> and <g> with transforms, rect, circle,
// ellipse, polygon, polyline, line and path (curves flattened, arcs as their chord), fill and stroke
// with opacity, linear and radial gradients, and style attributes. Filters, masks, patterns, clip
// paths and <use> are skipped. Deterministic and pure JS: the caller passes zlib's inflate.

import { decodePNG, isPNG } from '../expander/image-codec.mjs';
import { decodeJPEG, isJPEG } from './jpeg.mjs';

// ---------------------------------------------------------------- raster ----

export function createRaster(w, h, rgb = [255, 255, 255]) {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  const data = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) { data[i * 3] = rgb[0]; data[i * 3 + 1] = rgb[1]; data[i * 3 + 2] = rgb[2]; }
  return { W, H, data };
}
/** An RGBA bitmap (for sprites), transparent. */
function createBitmap(w, h) {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  return { w: W, h: H, data: new Float32Array(W * H * 4) };
}

/** Blends paint into a raster (RGB, opaque) or bitmap (RGBA, straight alpha) at pixel i. */
function blendPx(t, i, r, g, b, a) {
  if (a <= 0) return;
  if (t.W !== undefined) {
    const k = i * 3;
    t.data[k] += (r - t.data[k]) * a; t.data[k + 1] += (g - t.data[k + 1]) * a; t.data[k + 2] += (b - t.data[k + 2]) * a;
  } else {
    const k = i * 4, da = t.data[k + 3], oa = a + da * (1 - a);
    if (oa <= 0) return;
    t.data[k] = (r * a + t.data[k] * da * (1 - a)) / oa;
    t.data[k + 1] = (g * a + t.data[k + 1] * da * (1 - a)) / oa;
    t.data[k + 2] = (b * a + t.data[k + 2] * da * (1 - a)) / oa;
    t.data[k + 3] = oa;
  }
}
const dimsOf = (t) => (t.W !== undefined ? [t.W, t.H] : [t.w, t.h]);

/**
 * Fills polygons (lists of [x, y] in target pixels) with nonzero winding, sampled at pixel centres.
 * paint: [r, g, b, a] or (x, y) → [r, g, b, a]. clip: {x0, y0, x1, y1} or null.
 */
export function fillPolys(t, polys, paint, clip = null) {
  const [W, H] = dimsOf(t);
  const edges = [];
  let minY = Infinity, maxY = -Infinity;
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if (a[1] === b[1]) continue;
      edges.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1], 1] : [b[0], b[1], a[0], a[1], -1]);
      minY = Math.min(minY, a[1], b[1]); maxY = Math.max(maxY, a[1], b[1]);
    }
  }
  if (!edges.length) return;
  const cx0 = Math.max(0, clip ? Math.ceil(clip.x0 - 0.5) : 0), cx1 = Math.min(W - 1, clip ? Math.floor(clip.x1 - 0.5) : W - 1);
  const y0 = Math.max(0, Math.ceil(minY - 0.5), clip ? Math.ceil(clip.y0 - 0.5) : 0);
  const y1 = Math.min(H - 1, Math.floor(maxY - 0.5), clip ? Math.floor(clip.y1 - 0.5) : H - 1);
  const fixed = Array.isArray(paint) ? paint : null;
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (const e of edges) if (sy >= e[1] && sy < e[3]) xs.push([e[0] + ((sy - e[1]) * (e[2] - e[0])) / (e[3] - e[1]), e[4]]);
    if (xs.length < 2) continue;
    xs.sort((a, b) => a[0] - b[0]);
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k][1];
      if (!wind) continue;
      const a = Math.max(cx0, Math.ceil(xs[k][0] - 0.5)), b = Math.min(cx1, Math.floor(xs[k + 1][0] - 0.5));
      for (let x = a; x <= b; x++) {
        const c = fixed ?? paint(x + 0.5, sy);
        if (c) blendPx(t, y * W + x, c[0], c[1], c[2], c[3]);
      }
    }
  }
}

function strokeSegs(t, pts, closed, width, paint, clip) {
  const hw = Math.max(0.5, width / 2);
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (!len) continue;
    const nx = (-dy / len) * hw, ny = (dx / len) * hw;
    fillPolys(t, [[[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]], paint, clip);
  }
}

function roundRect(x, y, w, h, r) {
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  if (!r) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const out = [];
  const corner = (cx, cy, a0) => { for (let k = 0; k <= 4; k++) { const a = a0 + (k * Math.PI) / 8; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  return out;
}
function ellipsePts(cx, cy, rx, ry, n = 28) {
  const out = [];
  for (let k = 0; k < n; k++) { const a = (k * 2 * Math.PI) / n; out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return out;
}

// ---------------------------------------------------------------- colours ----

const NAMED = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', gray: '#808080', grey: '#808080', brown: '#a52a2a', gold: '#ffd700', navy: '#000080', teal: '#008080', cyan: '#00ffff', magenta: '#ff00ff', lime: '#00ff00', silver: '#c0c0c0', maroon: '#800000', olive: '#808000', beige: '#f5f5dc', ivory: '#fffff0', tan: '#d2b48c', coral: '#ff7f50', salmon: '#fa8072', crimson: '#dc143c', skyblue: '#87ceeb', lightblue: '#add8e6', darkblue: '#00008b', darkgreen: '#006400', lightgreen: '#90ee90', khaki: '#f0e68c', violet: '#ee82ee', indigo: '#4b0082', chocolate: '#d2691e', sienna: '#a0522d', wheat: '#f5deb3', lavender: '#e6e6fa', darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', dimgray: '#696969', forestgreen: '#228b22', steelblue: '#4682b4', tomato: '#ff6347', orchid: '#da70d6', turquoise: '#40e0d0', slategray: '#708090', whitesmoke: '#f5f5f5', snow: '#fffafa' };
/** CSS colour → [r, g, b, a] or null (none). */
export function parseColor(s) {
  if (s == null) return undefined;
  s = String(s).trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent') return null;
  if (NAMED[s]) s = NAMED[s];
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return undefined;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((v) => (v.endsWith('%') ? (parseFloat(v) * 2.55) : parseFloat(v)));
    return [p[0] || 0, p[1] || 0, p[2] || 0, p[3] === undefined ? 1 : Math.min(1, m[1].includes('%') && p[3] > 1 ? p[3] / 255 : p[3])];
  }
  if (s === 'currentcolor') return [0, 0, 0, 1];
  return undefined;
}
/** Engine colour (u32 0xRRGGBBAA or '#RRGGBB[AA]') → [r, g, b, a]. */
export function engineColor(c) {
  if (c == null || c === 0) return null;
  if (typeof c === 'number') { c >>>= 0; return (c & 0xff) ? [c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, (c & 255) / 255] : null; }
  const p = parseColor(c);
  return p && p[3] > 0 ? p : null;
}

// ---------------------------------------------------------------- SVG ----

const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function invert(m) {
  const d = m[0] * m[3] - m[1] * m[2];
  if (!d) return [1, 0, 0, 1, 0, 0];
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}
const ID = [1, 0, 0, 1, 0, 0];
const nums = (s) => (String(s ?? '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? []).map(Number);

function parseTransform(s) {
  let m = ID;
  for (const [, fn, args] of String(s ?? '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = nums(args);
    let t = ID;
    if (fn === 'matrix' && a.length >= 6) t = a.slice(0, 6);
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (fn === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const r = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
      t = [c, sn, -sn, c, 0, 0];
      if (a.length >= 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]);
    } else if (fn === 'skewX') t = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === 'skewY') t = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

/** Path data → list of subpaths (point lists) and whether each is closed. */
export function pathPolys(d) {
  const toks = String(d ?? '').match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? [];
  const out = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = null, lcx = null, lcy = null, i = 0;
  const num = () => Number(toks[i++]);
  const start = (nx, ny) => { if (cur && cur.pts.length > 1) out.push(cur); cur = { pts: [[nx, ny]], closed: false }; sx = nx; sy = ny; };
  const to = (nx, ny) => { if (!cur) start(x, y); cur.pts.push([nx, ny]); x = nx; y = ny; };
  const cubic = (x1, y1, x2, y2, ex, ey) => { const x0 = x, y0 = y; for (let k = 1; k <= 8; k++) { const t = k / 8, u = 1 - t; to(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey); } lcx = x2; lcy = y2; };
  const quad = (x1, y1, ex, ey) => { const x0 = x, y0 = y; for (let k = 1; k <= 6; k++) { const t = k / 6, u = 1 - t; to(u * u * x0 + 2 * u * t * x1 + t * t * ex, u * u * y0 + 2 * u * t * y1 + t * t * ey); } lcx = x1; lcy = y1; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { if (cur) { cur.closed = true; x = sx; y = sy; out.push(cur); cur = null; } lcx = null; continue; }
    if (i >= toks.length || /[a-zA-Z]/.test(toks[i])) continue;
    if (C === 'M') { const nx = ox + num(), ny = oy + num(); start(nx, ny); x = nx; y = ny; cmd = rel ? 'l' : 'L'; lcx = null; }
    else if (C === 'L') { to(ox + num(), oy + num()); lcx = null; }
    else if (C === 'H') { to(ox + num(), y); lcx = null; }
    else if (C === 'V') { to(x, (rel ? y : 0) + num()); lcx = null; }
    else if (C === 'C') { const a = [num(), num(), num(), num(), num(), num()]; cubic(ox + a[0], oy + a[1], ox + a[2], oy + a[3], ox + a[4], oy + a[5]); }
    else if (C === 'S') { const a = [num(), num(), num(), num()]; const x1 = lcx === null ? x : 2 * x - lcx, y1 = lcy === null ? y : 2 * y - lcy; cubic(x1, y1, ox + a[0], oy + a[1], ox + a[2], oy + a[3]); }
    else if (C === 'Q') { const a = [num(), num(), num(), num()]; quad(ox + a[0], oy + a[1], ox + a[2], oy + a[3]); }
    else if (C === 'T') { const a = [num(), num()]; const x1 = lcx === null ? x : 2 * x - lcx, y1 = lcy === null ? y : 2 * y - lcy; quad(x1, y1, ox + a[0], oy + a[1]); }
    else if (C === 'A') {
      const a = [num(), num(), num(), num(), num(), num(), num()];
      const ex = ox + a[5], ey = oy + a[6];
      // The arc's sagitta, approximated: bulge the chord's midpoint out by the radius' share.
      const mx = (x + ex) / 2, my = (y + ey) / 2, dx = ex - x, dy = ey - y, len = Math.hypot(dx, dy) || 1;
      const r = Math.max(a[0], a[1]);
      const h = r > len / 2 ? (a[3] ? r + Math.sqrt(Math.max(0, r * r - (len * len) / 4)) : r - Math.sqrt(Math.max(0, r * r - (len * len) / 4))) : len / 2;
      const sgn = a[4] ? 1 : -1;
      quad(mx + (sgn * -dy / len) * h * 1.3, my + (sgn * dx / len) * h * 1.3, ex, ey);
      lcx = null;
    } else i++;
  }
  if (cur && cur.pts.length > 1) out.push(cur);
  return out;
}

function parseStyle(s) {
  const o = {};
  for (const part of String(s ?? '').split(';')) { const k = part.indexOf(':'); if (k > 0) o[part.slice(0, k).trim()] = part.slice(k + 1).trim(); }
  return o;
}
function attrsOf(s) {
  const o = {};
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) o[m[1]] = m[2] ?? m[3];
  if (o.style) Object.assign(o, parseStyle(o.style));
  return o;
}
const len = (v, ref = 0) => { if (v == null) return 0; const s = String(v).trim(); return s.endsWith('%') ? (parseFloat(s) / 100) * ref : parseFloat(s) || 0; };

/**
 * Rasterizes an SVG into an RGBA bitmap of w × h pixels (the SVG's viewBox scaled to fit, as an
 * <img> would draw it with preserveAspectRatio's default). inflate decodes embedded PNGs.
 */
export function rasterSvg(svg, w, h, inflate = null) {
  const bm = createBitmap(w, h);
  const src = String(svg ?? '');
  const grads = {};
  // Gradients first (they may be defined after use).
  for (const m of src.matchAll(/<(linearGradient|radialGradient)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const a = attrsOf(m[2]);
    const stops = [...m[3].matchAll(/<stop\b([^>]*)\/?>/g)].map((s) => {
      const sa = attrsOf(s[1]);
      const c = parseColor(sa['stop-color'] ?? '#000') ?? [0, 0, 0, 0];
      const op = sa['stop-opacity'] !== undefined ? parseFloat(sa['stop-opacity']) : 1;
      const off = sa.offset !== undefined ? (String(sa.offset).endsWith('%') ? parseFloat(sa.offset) / 100 : parseFloat(sa.offset)) : 0;
      return { off: Math.max(0, Math.min(1, off || 0)), c: [c[0], c[1], c[2], (c[3] ?? 1) * op] };
    });
    if (a.id) grads[a.id] = { kind: m[1], a, stops, href: (a.href ?? a['xlink:href'] ?? '').replace(/^#/, '') };
  }
  for (const g of Object.values(grads)) if (!g.stops.length && grads[g.href]) g.stops = grads[g.href].stops;
  const stopAt = (stops, t) => {
    if (!stops.length) return [0, 0, 0, 0];
    if (t <= stops[0].off) return stops[0].c;
    for (let k = 1; k < stops.length; k++) if (t <= stops[k].off) {
      const a = stops[k - 1], b = stops[k], u = (t - a.off) / Math.max(1e-6, b.off - a.off);
      return a.c.map((v, j) => v + (b.c[j] - v) * u);
    }
    return stops[stops.length - 1].c;
  };

  // Root viewBox → bitmap.
  const rootTag = /<svg\b([^>]*)>/.exec(src);
  if (!rootTag) return bm;
  const ra = attrsOf(rootTag[1]);
  const vb = nums(ra.viewBox ?? ra.viewbox);
  const vw = vb.length === 4 ? vb[2] : len(ra.width) || w, vh = vb.length === 4 ? vb[3] : len(ra.height) || h;
  const k = Math.min(w / vw, h / vh);
  let root = [k, 0, 0, k, (w - vw * k) / 2 - (vb[0] || 0) * k, (h - vh * k) / 2 - (vb[1] || 0) * k];

  const paintFor = (val, opacity, m, bbox) => {
    if (val === undefined) val = '#000';
    const url = /^url\(\s*#([^)\s]+)\s*\)/.exec(String(val));
    if (url) {
      const g = grads[url[1]];
      if (!g || !g.stops.length) return null;
      const inv = invert(m);
      const units = g.a.gradientUnits ?? grads[g.href]?.a.gradientUnits ?? 'objectBoundingBox';
      const bb = units === 'userSpaceOnUse' ? null : bbox;
      const P = (v, ref, def) => { if (v === undefined) return def; const s = String(v); return bb ? (s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s)) : len(s, ref); };
      const gt = parseTransform(g.a.gradientTransform);
      const ginv = invert(gt);
      if (g.kind === 'linearGradient') {
        const x1 = P(g.a.x1, vw, 0), y1 = P(g.a.y1, vh, 0), x2 = P(g.a.x2, vw, bb ? 1 : vw), y2 = P(g.a.y2, vh, 0);
        const dx = x2 - x1, dy = y2 - y1, dd = dx * dx + dy * dy || 1;
        return (px, py) => {
          let [ux, uy] = apply(inv, px, py);
          if (bb) { ux = (ux - bb.x) / (bb.w || 1); uy = (uy - bb.y) / (bb.h || 1); }
          [ux, uy] = apply(ginv, ux, uy);
          const c = stopAt(g.stops, Math.max(0, Math.min(1, ((ux - x1) * dx + (uy - y1) * dy) / dd)));
          return [c[0], c[1], c[2], c[3] * opacity];
        };
      }
      const cx = P(g.a.cx, vw, bb ? 0.5 : vw / 2), cy = P(g.a.cy, vh, bb ? 0.5 : vh / 2), r = P(g.a.r, Math.hypot(vw, vh) / Math.SQRT2, bb ? 0.5 : vw / 2) || 1;
      return (px, py) => {
        let [ux, uy] = apply(inv, px, py);
        if (bb) { ux = (ux - bb.x) / (bb.w || 1); uy = (uy - bb.y) / (bb.h || 1); }
        [ux, uy] = apply(ginv, ux, uy);
        const c = stopAt(g.stops, Math.min(1, Math.hypot(ux - cx, uy - cy) / r));
        return [c[0], c[1], c[2], c[3] * opacity];
      };
    }
    const c = parseColor(val);
    if (!c) return null;
    return [c[0], c[1], c[2], c[3] * opacity];
  };

  const SKIP = new Set(['defs', 'clipPath', 'mask', 'pattern', 'symbol', 'filter', 'linearGradient', 'radialGradient', 'style', 'title', 'desc', 'metadata', 'marker', 'text', 'foreignObject']);
  const stack = [{ m: root, fill: '#000', stroke: 'none', sw: 1, op: 1, fop: 1, sop: 1, hidden: false }];
  let skip = 0;
  let first = true;
  for (const t of src.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>|<!--[\s\S]*?-->/g)) {
    if (!t[2]) continue;
    const [, close, name, rest, self] = t;
    if (close) { if (skip) { if (SKIP.has(name)) skip--; continue; } if (name === 'svg' || name === 'g' || name === 'a') stack.length > 1 && stack.pop(); continue; }
    if (skip) { if (SKIP.has(name) && !self) skip++; continue; }
    if (SKIP.has(name)) { if (!self) skip++; continue; }
    const a = attrsOf(rest);
    const parent = stack[stack.length - 1];
    const ctx = {
      m: mul(parent.m, parseTransform(a.transform)),
      fill: a.fill ?? parent.fill, stroke: a.stroke ?? parent.stroke,
      sw: a['stroke-width'] !== undefined ? len(a['stroke-width']) : parent.sw,
      op: parent.op * (a.opacity !== undefined ? parseFloat(a.opacity) : 1),
      fop: a['fill-opacity'] !== undefined ? parseFloat(a['fill-opacity']) : parent.fop,
      sop: a['stroke-opacity'] !== undefined ? parseFloat(a['stroke-opacity']) : parent.sop,
      hidden: parent.hidden || a.display === 'none' || a.visibility === 'hidden',
    };
    if (name === 'svg') {
      if (first) { first = false; if (!self) stack.push({ ...ctx, m: root }); continue; }
      // A nested svg (a sprite-sheet frame): its own viewport and viewBox.
      const x = len(a.x), y = len(a.y), nw = len(a.width, vw) || vw, nh = len(a.height, vh) || vh;
      const nvb = nums(a.viewBox ?? a.viewbox);
      let m = mul(ctx.m, [1, 0, 0, 1, x, y]);
      if (nvb.length === 4) { const kk = Math.min(nw / nvb[2], nh / nvb[3]); m = mul(m, [kk, 0, 0, kk, (nw - nvb[2] * kk) / 2 - nvb[0] * kk, (nh - nvb[3] * kk) / 2 - nvb[1] * kk]); }
      if (!self) stack.push({ ...ctx, m });
      continue;
    }
    if (name === 'g' || name === 'a') { if (!self) stack.push(ctx); continue; }
    if (ctx.hidden) continue;
    let subs = null, bbox = null;
    if (name === 'rect') { const x = len(a.x), y = len(a.y), rw = len(a.width, vw), rh = len(a.height, vh); bbox = { x, y, w: rw, h: rh }; subs = [{ pts: roundRect(x, y, rw, rh, len(a.rx ?? a.ry)), closed: true }]; }
    else if (name === 'circle') { const cx = len(a.cx), cy = len(a.cy), r = len(a.r); bbox = { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }; subs = [{ pts: ellipsePts(cx, cy, r, r), closed: true }]; }
    else if (name === 'ellipse') { const cx = len(a.cx), cy = len(a.cy), rx = len(a.rx), ry = len(a.ry ?? a.rx); bbox = { x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry }; subs = [{ pts: ellipsePts(cx, cy, rx, ry), closed: true }]; }
    else if (name === 'polygon' || name === 'polyline') { const p = nums(a.points); const pts = []; for (let q = 0; q + 1 < p.length; q += 2) pts.push([p[q], p[q + 1]]); subs = [{ pts, closed: name === 'polygon' }]; }
    else if (name === 'line') subs = [{ pts: [[len(a.x1), len(a.y1)], [len(a.x2), len(a.y2)]], closed: false }];
    else if (name === 'path') subs = pathPolys(a.d);
    else if (name === 'image') {
      const href = a.href ?? a['xlink:href'] ?? '';
      const im = decodeDataImage(href, inflate);
      if (im) {
        const x = len(a.x), y = len(a.y), iw = len(a.width) || im.w, ih = len(a.height) || im.h;
        drawBitmap(bm, im, ctx.m, x, y, iw, ih, ctx.op);
      }
      continue;
    }
    if (!subs || !subs.length) continue;
    if (!bbox) { const all = subs.flatMap((s) => s.pts); const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]); bbox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
    const dev = subs.map((s) => ({ pts: s.pts.map(([px, py]) => apply(ctx.m, px, py)), closed: s.closed }));
    if (name !== 'line' && name !== 'polyline') {
      const fp = paintFor(ctx.fill, ctx.op * ctx.fop, ctx.m, bbox);
      if (fp) fillPolys(bm, dev.map((s) => s.pts), fp);
    }
    const sp = ctx.stroke && ctx.stroke !== 'none' ? paintFor(ctx.stroke, ctx.op * ctx.sop, ctx.m, bbox) : null;
    if (sp && ctx.sw > 0) {
      const scale = Math.sqrt(Math.abs(ctx.m[0] * ctx.m[3] - ctx.m[1] * ctx.m[2]));
      for (const s of dev) strokeSegs(bm, s.pts, s.closed || name === 'rect' || name === 'circle' || name === 'ellipse', ctx.sw * scale, sp, null);
    }
  }
  return bm;
}

/** Draws an RGBA bitmap into a bitmap through matrix m (nearest neighbour, inverse mapped). */
function drawBitmap(dst, im, m, x, y, w, h, opacity) {
  const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => apply(m, px, py));
  const inv = invert(m);
  fillPolys(dst, [corners], (px, py) => {
    const [ux, uy] = apply(inv, px, py);
    const sx = Math.floor(((ux - x) / w) * im.w), sy = Math.floor(((uy - y) / h) * im.h);
    if (sx < 0 || sy < 0 || sx >= im.w || sy >= im.h) return null;
    const k = (sy * im.w + sx) * 4;
    const al = im.float ? im.data[k + 3] : im.data[k + 3] / 255;
    return [im.data[k], im.data[k + 1], im.data[k + 2], al * opacity];
  });
}

function b64(s) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
}
/** A data: PNG or baseline JPEG as an RGBA image ({w, h, data}); null for other formats (PNG needs inflate). */
export function decodeDataImage(uri, inflate) {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.*)$/s.exec(String(uri ?? ''));
  if (!m) return null;
  try {
    const bytes = b64(m[2]);
    if (isJPEG(bytes)) return decodeJPEG(bytes);
    return isPNG(bytes) && inflate ? decodePNG(bytes, inflate) : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- engine frames ----

/**
 * Asset bitmaps for a game: id → {bm (RGBA float, 0..255 colours and 0..1 alpha), frames, cols}.
 * game: engine game.json (assets map). Each SVG is rasterized at `res` pixels per canvas unit.
 */
export function assetBitmaps(game, { inflate = null, res = 1, ids = null } = {}) {
  const out = {};
  const assets = game?.assets ?? {};
  for (const [id, a] of Object.entries(assets)) {
    if (ids && !ids.has(id)) continue;
    if (!a || (a.svg === undefined && a.image === undefined)) continue;
    const frames = a.frames ?? 1, cols = a.cols ?? frames, rows = Math.ceil(frames / cols);
    const fw = a.w ?? 64, fh = a.h ?? 64;
    let bm = null;
    if (a.svg !== undefined) {
      const k = Math.max(1, Math.min(4, res * Math.max(1, 96 / Math.max(fw, fh))));
      bm = rasterSvg(a.svg, Math.round(fw * cols * k), Math.round(fh * rows * k), inflate);
      bm = { w: bm.w, h: bm.h, data: bm.data, float: true };
    } else {
      const im = decodeDataImage(a.image, inflate);
      if (im) bm = { w: im.w, h: im.h, data: im.data, float: false };
    }
    if (bm) out[id] = { bm, frames, cols, rows, w: fw, h: fh };
  }
  return out;
}

const sel = (op, k, d) => (op[k] === undefined || op[k] === null ? d : op[k]);

/**
 * Composites a JSON frame ({width, height, background, ops}) without its text: what sits behind
 * every word. Returns the raster (RGB floats, 1 pixel per canvas unit). `bitmaps` from assetBitmaps.
 * Assets are matched by op.asset; the engine's JSON frame names an asset by id or dense index, so
 * `assetIds` (the engine's asset list order) maps indices to ids.
 */
export function compositeFrame(frame, bitmaps, { assetIds = null, skip = null } = {}) {
  const W = frame.width ?? 360, H = frame.height ?? 640;
  const bg = engineColor(frame.background) ?? [255, 255, 255, 1];
  const r = createRaster(W, H, bg.slice(0, 3));
  const clips = [];
  const clipNow = () => clips.reduce((c, b) => ({ x0: Math.max(c.x0, b.x0), y0: Math.max(c.y0, b.y0), x1: Math.min(c.x1, b.x1), y1: Math.min(c.y1, b.y1) }), { x0: 0, y0: 0, x1: W, y1: H });
  (frame.ops ?? []).forEach((op, idx) => {
    if (op.op === 'clip') { clips.push({ x0: op.x, y0: op.y, x1: op.x + Math.max(0, op.w), y1: op.y + Math.max(0, op.h) }); return; }
    if (op.op === 'unclip') { clips.pop(); return; }
    if (op.op === 'text' || (skip && skip(op, idx))) return;
    const alpha = Math.min(1, sel(op, 'opacity', 1));
    const scale = sel(op, 'scale', 1);
    if (!(alpha > 0) || scale === 0) return;
    const clip = clipNow();
    const withA = (c) => (c ? [c[0], c[1], c[2], c[3] * alpha] : null);
    const fill = withA(engineColor(op.fill)), stroke = withA(engineColor(op.stroke)), sw = sel(op, 'stroke_width', 0);
    if (op.op === 'rect') {
      const cx = op.x + op.w / 2, cy = op.y + op.h / 2;
      const pts = roundRect(cx + (op.x - cx) * scale, cy + (op.y - cy) * scale, op.w * scale, op.h * scale, sel(op, 'radius', 0) * scale);
      const rot = (sel(op, 'rotation', 0) * Math.PI) / 180;
      const P = rot ? pts.map(([x, y]) => [cx + (x - cx) * Math.cos(rot) - (y - cy) * Math.sin(rot), cy + (x - cx) * Math.sin(rot) + (y - cy) * Math.cos(rot)]) : pts;
      if (fill) fillPolys(r, [P], fill, clip);
      if (stroke && sw > 0) strokeSegs(r, P, true, sw, stroke, clip);
    } else if (op.op === 'circle') {
      const pts = ellipsePts(op.x, op.y, Math.abs(op.r * scale), Math.abs(op.r * scale));
      if (fill) fillPolys(r, [pts], fill, clip);
      if (stroke && sw > 0) strokeSegs(r, pts, true, sw, stroke, clip);
    } else if (op.op === 'line') {
      if (stroke && sw > 0) strokeSegs(r, [[op.x1, op.y1], [op.x2, op.y2]], false, sw, stroke, clip);
    } else if (op.op === 'poly') {
      const p = op.points ?? [];
      const pts = typeof p[0] === 'number' ? Array.from({ length: p.length / 2 }, (_, k) => [p[2 * k], p[2 * k + 1]]) : p;
      if (pts.length >= 2) {
        if (fill && sel(op, 'closed', true)) fillPolys(r, [pts], fill, clip);
        if (stroke && sw > 0) strokeSegs(r, pts, sel(op, 'closed', true), sw, stroke, clip);
      }
    } else if (op.op === 'image') {
      const id = typeof op.asset === 'number' && assetIds ? assetIds[op.asset] : op.asset;
      const a = bitmaps[id];
      if (!a) return;
      const cx = op.x + op.w / 2, cy = op.y + op.h / 2;
      const w = op.w * scale, h = op.h * scale, x0 = cx - w / 2, y0 = cy - h / 2;
      const f = (sel(op, 'frame', 0) % a.frames + a.frames) % a.frames;
      const cw = a.bm.w / a.cols, ch = a.bm.h / a.rows;
      let fx = (f % a.cols) * cw, fy = Math.floor(f / a.cols) * ch, fw = cw, fh = ch;
      if (op.src_w > 0 && op.src_h > 0) { const kx = cw / a.w, ky = ch / a.h; fx += op.src_x * kx; fy += op.src_y * ky; fw = op.src_w * kx; fh = op.src_h * ky; }
      const fxF = op.flip_x, fyF = op.flip_y;
      fillPolys(r, [[[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]], (px, py) => {
        let u = (px - x0) / w, v = (py - y0) / h;
        if (fxF) u = 1 - u;
        if (fyF) v = 1 - v;
        const sx = Math.floor(fx + u * fw), sy = Math.floor(fy + v * fh);
        if (sx < fx || sy < fy || sx >= fx + cw || sy >= fy + ch || sx >= a.bm.w || sy >= a.bm.h) return null;
        const k = (sy * a.bm.w + sx) * 4;
        const al = a.bm.float ? a.bm.data[k + 3] : a.bm.data[k + 3] / 255;
        return [a.bm.data[k], a.bm.data[k + 1], a.bm.data[k + 2], al * alpha];
      }, clip);
    }
  });
  return r;
}

/** The raster's pixels inside a box (canvas units), as [r, g, b] triples, every `step` pixels. */
export function pixelsIn(r, box, step = 1) {
  const out = [];
  const x0 = Math.max(0, Math.floor(box.x0)), x1 = Math.min(r.W - 1, Math.ceil(box.x1) - 1);
  const y0 = Math.max(0, Math.floor(box.y0)), y1 = Math.min(r.H - 1, Math.ceil(box.y1) - 1);
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) { const k = (y * r.W + x) * 3; out.push([r.data[k], r.data[k + 1], r.data[k + 2]]); }
  return out;
}
