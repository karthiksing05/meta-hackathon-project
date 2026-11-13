// Spot-the-difference scenes, made at build time (docs/harness-gaps/images.md).
//
// Muse (or a person) writes ONE scene as a list of simple placed objects. This module draws it as
// an SVG, picks N objects deterministically from a seed, changes each one in the second picture
// (recolor, remove, move, resize or new text) and records where every change is, so the game's tap
// targets come from data, never from looking at pixels. Same scene + same seed = the same two
// pictures and the same answer key, so replays verify.
//
// Pure JS, no imports beyond svg.mjs, so the Studio bundle and the server's generator can use it.
//
//   makeSpotDifference(scene, {count, seed, kinds}) -> {a, b, w, h, diffs, seed, problems}
//   toAuthoring(result, {roleA, roleB, size}) -> {art: {sprites}, functions}   (for diff_spots)
//
// Scene format (scene coordinates; default 320 x 240):
//   { "w": 320, "h": 240, "bg": "#F4F1EA",
//     "objects": [
//       { "id": "sun",  "shape": "circle",  "x": 40, "y": 40, "r": 18, "fill": "#FFC86B" },
//       { "id": "msg1", "shape": "rect",    "x": 20, "y": 30, "w": 150, "h": 34, "radius": 12, "fill": "#E4E6EB" },
//       { "id": "txt1", "shape": "text",    "x": 30, "y": 52, "text": "who took my fries", "size": 12, "fill": "#1C1E21", "alt": ["who took my chips"] },
//       { "id": "hat",  "shape": "ellipse", "x": 200, "y": 90, "rx": 20, "ry": 8, "fill": "#7B4FD6" },
//       { "id": "roof", "shape": "poly",    "points": [[150, 120], [190, 90], [230, 120]], "fill": "#C0392B" },
//       { "id": "rope", "shape": "line",    "x1": 10, "y1": 10, "x2": 80, "y2": 30, "stroke": "#333333", "stroke_width": 2 }
//     ] }
//   Object fields: id (unique), shape, its geometry, fill / stroke / stroke_width / opacity, and:
//     fixed: true   never change this object (backgrounds, the frame, the layout);
//     alt: [...]    other texts a text object may switch to (a text change needs one);
//     weight, font  for text (weight 400–900; font is one of the safe families below).
//   Text is drawn with its baseline at y (SVG default), left-aligned unless "anchor": "middle" | "end".
//   Emoji are fine inside text.

import { sanitizeSvg } from './svg.mjs';

export const SHAPES = ['rect', 'circle', 'ellipse', 'text', 'poly', 'line'];
export const KINDS = ['recolor', 'remove', 'move', 'resize', 'text'];
const FONTS = { system: '-apple-system, Helvetica, Arial, sans-serif', serif: 'Georgia, serif', mono: 'Menlo, monospace', rounded: 'Avenir Next, Helvetica, sans-serif' };
const HEX = /^#[0-9A-Fa-f]{6}$/;
const MIN_R = 12;      // smallest hit radius in scene units (a fingertip at 1:1)
const MAX_SHARE = 0.3; // objects bigger than this share of the scene are never changed
// Contrasting swaps for recolor when the scene has too few colors of its own.
const SWAPS = ['#E4572E', '#3A6EA5', '#2EAD5B', '#F2B705', '#7B4FD6', '#111111', '#FFFFFF', '#FF8FB1'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (v) => Math.round(v * 10) / 10;
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Text width estimate, the same rule the engine uses (0.6 x size per character, emoji count 2). */
function textWidth(o) {
  const n = [...String(o.text ?? '')].reduce((acc, ch) => acc + (ch.codePointAt(0) > 0x2000 ? 2 : 1), 0);
  return n * (o.size ?? 12) * 0.6 * ((o.weight ?? 400) >= 600 ? 1.05 : 1);
}

/** Axis-aligned bounding box {x, y, w, h} of an object in scene units. */
export function bbox(o) {
  switch (o.shape) {
    case 'rect': return { x: o.x, y: o.y, w: o.w, h: o.h };
    case 'circle': return { x: o.x - o.r, y: o.y - o.r, w: 2 * o.r, h: 2 * o.r };
    case 'ellipse': return { x: o.x - o.rx, y: o.y - o.ry, w: 2 * o.rx, h: 2 * o.ry };
    case 'text': {
      const w = textWidth(o), size = o.size ?? 12;
      const x = o.anchor === 'middle' ? o.x - w / 2 : o.anchor === 'end' ? o.x - w : o.x;
      return { x, y: o.y - size * 0.85, w, h: size * 1.1 };
    }
    case 'poly': {
      const xs = o.points.map((p) => p[0]), ys = o.points.map((p) => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    case 'line': {
      const x = Math.min(o.x1, o.x2), y = Math.min(o.y1, o.y2);
      return { x, y, w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
    }
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

const union = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** Checks a scene. Returns a list of plain-language problems (empty when it's fine). */
export function checkScene(scene) {
  const p = [];
  if (!scene || typeof scene !== 'object') return ['the scene must be an object with w, h and objects'];
  const W = scene.w ?? 320, H = scene.h ?? 240;
  if (!(W >= 64 && W <= 1024 && H >= 64 && H <= 1024)) p.push('w and h are 64 to 1024');
  if (scene.bg !== undefined && !HEX.test(scene.bg)) p.push('bg is a #RRGGBB color');
  if (!Array.isArray(scene.objects) || scene.objects.length < 3) { p.push('objects is a list of at least 3 objects'); return p; }
  if (scene.objects.length > 200) p.push('at most 200 objects');
  const ids = new Set();
  scene.objects.forEach((o, i) => {
    const at = `objects[${i}]`;
    if (!o || typeof o !== 'object') { p.push(`${at} is not an object`); return; }
    if (typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(o.id)) p.push(`${at}.id is letters, digits, _ or -`);
    else if (ids.has(o.id)) p.push(`${at}.id '${o.id}' is used twice`);
    else ids.add(o.id);
    if (!SHAPES.includes(o.shape)) { p.push(`${at}.shape is one of ${SHAPES.join(', ')}`); return; }
    const need = { rect: ['x', 'y', 'w', 'h'], circle: ['x', 'y', 'r'], ellipse: ['x', 'y', 'rx', 'ry'], text: ['x', 'y'], line: ['x1', 'y1', 'x2', 'y2'], poly: [] }[o.shape];
    for (const k of need) if (!Number.isFinite(o[k])) p.push(`${at}.${k} must be a number`);
    if (o.shape === 'text' && (typeof o.text !== 'string' || !o.text.length || o.text.length > 80)) p.push(`${at}.text is 1 to 80 characters`);
    if (o.shape === 'poly' && !(Array.isArray(o.points) && o.points.length >= 3 && o.points.length <= 64 && o.points.every((q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite)))) p.push(`${at}.points is 3 to 64 [x, y] pairs`);
    for (const k of ['fill', 'stroke']) if (o[k] !== undefined && o[k] !== 'none' && !HEX.test(o[k])) p.push(`${at}.${k} is a #RRGGBB color or "none"`);
    if (o.alt !== undefined && !(Array.isArray(o.alt) && o.alt.every((s) => typeof s === 'string' && s.length && s.length <= 80))) p.push(`${at}.alt is a list of texts`);
    if (o.font !== undefined && !FONTS[o.font]) p.push(`${at}.font is one of ${Object.keys(FONTS).join(', ')}`);
  });
  return p;
}

function drawObject(o) {
  const paint = [];
  const fill = o.fill ?? (o.shape === 'line' ? 'none' : '#000000');
  paint.push(`fill="${fill}"`);
  if (o.stroke) paint.push(`stroke="${o.stroke}" stroke-width="${r1(o.stroke_width ?? 2)}"`);
  if (o.opacity !== undefined && o.opacity < 1) paint.push(`opacity="${r1(o.opacity)}"`);
  const pp = paint.join(' ');
  switch (o.shape) {
    case 'rect': return `<rect x="${r1(o.x)}" y="${r1(o.y)}" width="${r1(o.w)}" height="${r1(o.h)}"${o.radius ? ` rx="${r1(o.radius)}"` : ''} ${pp}/>`;
    case 'circle': return `<circle cx="${r1(o.x)}" cy="${r1(o.y)}" r="${r1(o.r)}" ${pp}/>`;
    case 'ellipse': return `<ellipse cx="${r1(o.x)}" cy="${r1(o.y)}" rx="${r1(o.rx)}" ry="${r1(o.ry)}" ${pp}/>`;
    case 'poly': return `<polygon points="${o.points.map((q) => `${r1(q[0])},${r1(q[1])}`).join(' ')}" ${pp}/>`;
    case 'line': return `<line x1="${r1(o.x1)}" y1="${r1(o.y1)}" x2="${r1(o.x2)}" y2="${r1(o.y2)}" stroke="${o.stroke ?? '#000000'}" stroke-width="${r1(o.stroke_width ?? 2)}" stroke-linecap="round"/>`;
    case 'text': {
      const anchor = o.anchor === 'middle' || o.anchor === 'end' ? ` text-anchor="${o.anchor}"` : '';
      return `<text x="${r1(o.x)}" y="${r1(o.y)}" font-size="${r1(o.size ?? 12)}" font-weight="${o.weight ?? 400}" font-family="${escAttr(FONTS[o.font ?? 'system'])}"${anchor} ${pp}>${escText(o.text)}</text>`;
    }
  }
  return '';
}

/** Draws a scene as one sanitizer-safe SVG string. */
export function sceneSvg(scene) {
  const W = scene.w ?? 320, H = scene.h ?? 240;
  const body = scene.objects.map(drawObject).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect x="0" y="0" width="${W}" height="${H}" fill="${scene.bg ?? '#FFFFFF'}"/>${body}</svg>`;
}

// One change to an object. Returns {kind, after (object or null), note} or null if it can't apply.
function change(kind, o, scene, rng, palette) {
  const W = scene.w ?? 320, H = scene.h ?? 240;
  const b = bbox(o);
  switch (kind) {
    case 'remove':
      return { kind, after: null, note: `${o.id} is missing` };
    case 'recolor': {
      // Emoji keep their own colors, so a recolored emoji-only text would look the same.
      if (o.shape === 'text' && (String(o.text).match(/[A-Za-z0-9]/g) ?? []).length < 3) return null;
      const key = o.shape === 'line' ? 'stroke' : 'fill';
      const from = String(o[key] ?? '#000000').toUpperCase();
      const pool = [...palette, ...SWAPS].filter((c) => colorDistance(c, from) > 120);
      if (!pool.length) return null;
      const to = pool[Math.floor(rng() * pool.length)];
      return { kind, after: { ...o, [key]: to }, note: `${o.id} changes color` };
    }
    case 'move': {
      // 10 to 18 units in one of 8 directions, staying inside the scene.
      for (let tries = 0; tries < 8; tries++) {
        const ang = Math.floor(rng() * 8) * (Math.PI / 4), dist = 10 + Math.floor(rng() * 9);
        const dx = Math.round(Math.cos(ang) * dist), dy = Math.round(Math.sin(ang) * dist);
        if (b.x + dx < 0 || b.y + dy < 0 || b.x + b.w + dx > W || b.y + b.h + dy > H) continue;
        return { kind, after: shift(o, dx, dy), note: `${o.id} moved` };
      }
      return null;
    }
    case 'resize': {
      const k = rng() < 0.5 ? 1.45 : 0.6;
      const after = scale(o, k);
      const a = bbox(after);
      if (a.x < 0 || a.y < 0 || a.x + a.w > W || a.y + a.h > H) return null;
      if (Math.max(a.w, a.h) < 6) return null;
      return { kind, after, note: `${o.id} is ${k > 1 ? 'bigger' : 'smaller'}` };
    }
    case 'text': {
      if (o.shape !== 'text' || !Array.isArray(o.alt) || !o.alt.length) return null;
      const options = o.alt.filter((t) => t !== o.text);
      if (!options.length) return null;
      return { kind, after: { ...o, text: options[Math.floor(rng() * options.length)] }, note: `${o.id} says something else` };
    }
  }
  return null;
}

function shift(o, dx, dy) {
  switch (o.shape) {
    case 'poly': return { ...o, points: o.points.map((q) => [q[0] + dx, q[1] + dy]) };
    case 'line': return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
    default: return { ...o, x: o.x + dx, y: o.y + dy };
  }
}

function scale(o, k) {
  const b = bbox(o), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const at = (x, y) => [cx + (x - cx) * k, cy + (y - cy) * k];
  switch (o.shape) {
    case 'rect': return { ...o, x: cx - (o.w * k) / 2, y: cy - (o.h * k) / 2, w: o.w * k, h: o.h * k, radius: o.radius ? o.radius * k : o.radius };
    case 'circle': return { ...o, r: o.r * k };
    case 'ellipse': return { ...o, rx: o.rx * k, ry: o.ry * k };
    case 'poly': return { ...o, points: o.points.map((q) => at(q[0], q[1])) };
    case 'line': { const [x1, y1] = at(o.x1, o.y1), [x2, y2] = at(o.x2, o.y2); return { ...o, x1, y1, x2, y2 }; }
    case 'text': { const size = (o.size ?? 12) * k; const w0 = textWidth(o), w1 = textWidth({ ...o, size }); const x = o.anchor === 'middle' ? o.x : o.anchor === 'end' ? o.x + (w1 - w0) / 2 : o.x - (w1 - w0) / 2; return { ...o, size, x, y: o.y + ((o.size ?? 12) * 0.85 * (k - 1)) / 2 }; }
  }
  return o;
}

function rgb(hex) { const n = parseInt(String(hex).slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function colorDistance(a, b) { const [r, g, bl] = rgb(a), [r2, g2, b2] = rgb(b); return Math.sqrt((r - r2) ** 2 + (g - g2) ** 2 + (bl - b2) ** 2); }

/** Hit circle around a box, in scene units: the box's half diagonal, at least MIN_R. */
function hitCircle(box) {
  return { x: Math.round(box.x + box.w / 2), y: Math.round(box.y + box.h / 2), r: Math.max(MIN_R, Math.round(Math.hypot(box.w, box.h) / 2)) };
}

/**
 * Makes the pair. Options: count (3..9, default 5), seed (int, default 1), kinds (subset of KINDS).
 * Returns {a, b, w, h, diffs: [{id, kind, x, y, r, box, note}], decoys: [{x, y}], seed, problems}.
 * Decoys are the centres of the unchanged objects (taps there are misses). `problems` is
 * non-empty when the scene is invalid or has too few changeable objects for `count`; the pictures
 * are still drawn with the changes it could make.
 */
export function makeSpotDifference(scene, { count = 5, seed = 1, kinds = KINDS } = {}) {
  const problems = checkScene(scene);
  const W = scene?.w ?? 320, H = scene?.h ?? 240;
  if (problems.length) return { a: '', b: '', w: W, h: H, diffs: [], decoys: [], seed, problems };
  count = Math.max(1, Math.min(9, Math.floor(count)));
  const rng = mulberry32((seed * 2654435761) >>> 0);
  const palette = [...new Set(scene.objects.map((o) => o.fill).filter((c) => c && HEX.test(c)).map((c) => c.toUpperCase()))];

  // Candidates: not fixed, not huge, not tiny. Shuffle deterministically.
  const area = W * H;
  const cand = scene.objects.map((o, i) => ({ o, i, box: bbox(o) }))
    .filter(({ o, box }) => !o.fixed && box.w * box.h <= area * MAX_SHARE && Math.max(box.w, box.h) >= 6);
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }

  const after = scene.objects.slice();
  const diffs = [];
  const used = [];
  let kindTurn = Math.floor(rng() * kinds.length);
  for (const c of cand) {
    if (diffs.length >= count) break;
    // Try the kinds in rotation so a pair mixes kinds; the first that applies wins.
    let made = null;
    for (let t = 0; t < kinds.length && !made; t++) made = change(kinds[(kindTurn + t) % kinds.length], c.o, scene, rng, palette);
    if (!made) continue;
    const box = made.after ? union(c.box, bbox(made.after)) : c.box;
    const hit = hitCircle(box);
    // Keep the hit circles apart, so one tap never finds two changes.
    if (used.some((u) => Math.hypot(u.x - hit.x, u.y - hit.y) < u.r + hit.r + 4)) continue;
    used.push(hit);
    after[c.i] = made.after;
    kindTurn = (kindTurn + 1) % kinds.length;
    diffs.push({ id: c.o.id, kind: made.kind, ...hit, box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) }, note: made.note });
  }
  // Decoys: the centre of every other visible, tappable-size object that isn't next to a change.
  const changed = new Set(diffs.map((d) => d.id));
  const decoys = [];
  for (const o of scene.objects) {
    if (changed.has(o.id)) continue;
    const box = bbox(o);
    if (box.w * box.h > area * MAX_SHARE || Math.max(box.w, box.h) < 6) continue;
    const c = { x: Math.round(box.x + box.w / 2), y: Math.round(box.y + box.h / 2) };
    if (used.some((u) => Math.hypot(u.x - c.x, u.y - c.y) < u.r + 10)) continue;
    if (decoys.some((d) => Math.hypot(d.x - c.x, d.y - c.y) < 8)) continue;
    decoys.push(c);
  }
  if (diffs.length < count) problems.push(`only ${diffs.length} of ${count} changes fit: add more small objects, or objects further apart`);
  // Order the answer key top-to-bottom, left-to-right, so it reads like the picture.
  diffs.sort((p, q) => p.y - q.y || p.x - q.x);
  const a = sceneSvg(scene);
  const b = sceneSvg({ ...scene, objects: after.filter(Boolean) });
  for (const [name, svg] of [['a', a], ['b', b]]) {
    const r = sanitizeSvg(svg, { maxBytes: 24 * 1024 });
    for (const e of r.errors) problems.push(`picture ${name}: ${e}`);
  }
  return { a, b, w: W, h: H, diffs, decoys, seed, problems };
}

/**
 * The authoring pieces for the `diff_spots` fragment: two sprites and the answer-key functions.
 * Merge `art.sprites` into the manifest's art and `functions` into its functions.
 * size: the drawn sprite size (default the scene's own; w and h at most 1024).
 */
export function toAuthoring(result, { roleA = 'picture_a', roleB = 'picture_b', size } = {}) {
  const w = Math.min(1024, size?.w ?? result.w), h = Math.min(1024, size?.h ?? result.h);
  const pts = result.diffs.map((d) => `vec(${d.x}, ${d.y})`).join(', ');
  const radii = result.diffs.map((d) => d.r).join(', ');
  const decoys = (result.decoys ?? []).map((d) => `vec(${d.x}, ${d.y})`).join(', ');
  return {
    art: { sprites: { [roleA]: { svg: result.a, w, h }, [roleB]: { svg: result.b, w, h } } },
    functions: {
      diff_points: { params: {}, returns: 'list<ivec2>', body: `[${pts}]` },
      diff_radii: { params: {}, returns: 'list<int>', body: `[${radii}]` },
      diff_decoys: { params: {}, returns: 'list<ivec2>', body: `[${decoys}]` },
    },
  };
}
