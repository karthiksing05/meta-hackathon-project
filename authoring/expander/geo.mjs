// Maps on screen, from a checked content pack (authoring/content/geo/*.json, `geo-pack/1`, built from
// Natural Earth by tools/make-geo-pack.mjs). Pure JS, no Node imports, so the Studio bundle can carry it.
//
// A manifest may carry a `geo` section. `applyGeo(manifest, packs)` turns it into ordinary manifest parts
// before the expander runs, so the engine and the expander need nothing new:
//
//   "geo": {
//     "pack": "world",                                     world | us_states
//     "places": ["France", "Japan", "BRA"],                names, aliases or ids from the pack
//     "pick": { "region": "Europe", "count": 12, "min_area": 2, "seed": 7 },   or a deterministic pick
//     "target": "label",                                   label | capital: the point a pin is scored against
//     "map": { "x": 5, "y": 92, "w": 350, "h": 136, "view": "world" },  view: world | fit | a continent,
//                                                          subregion or US region | [w, s, e, n] in degrees
//     "quiz": { "choices": 3, "ask": "name" }              optional: write geo_choices() (name | capital)
//   }
//
// It writes: the map picture as the sprite `map` (role `map` of the geo_map fragment), the functions
// geo_names, geo_ids, geo_capitals, geo_target, geo_rings, geo_ring_place, geo_label (and geo_choices with
// `quiz`), and the rect and projection params of any geo_map or map_pin use. Places Muse names that the
// pack doesn't have are errors (A_GEO_PLACE): coordinates only ever come from the pack.

export const GEO_FORMAT = 'geo-pack/1';
export const POLY_MAX = 256; // engine limit on poly points
const SPRITE_BUDGET = 23000; // bytes; the sanitizer's sprite limit is 24 KB

// ---------- names ----------

const keyOf = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/^(the) /, '').trim();

export function findPlace(pack, name) {
  const k = keyOf(name);
  if (!k) return null;
  for (const p of pack.places) if (keyOf(p.id) === k || keyOf(p.name) === k) return p;
  for (const p of pack.places) if ((p.aliases ?? []).some((a) => keyOf(a) === k)) return p;
  return null;
}

/** Places a game may use by default: no disputed or indeterminate areas, no Antarctica. */
export const playable = (p) => !['disputed', 'indeterminate'].includes(p.kind) && p.continent !== 'Antarctica'
  && p.continent !== 'Seven seas (open ocean)';

function inRegion(p, region) {
  if (!region || region === 'world') return true;
  const k = keyOf(region);
  return keyOf(p.continent) === k || keyOf(p.subregion) === k;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic pick: same pack, same options, same places. */
export function pickPlaces(pack, { region = 'world', count = 10, min_area = 0, seed = 1, need_capital = false } = {}) {
  const pool = pack.places.filter((p) => playable(p) && inRegion(p, region) && (p.area ?? Infinity) >= min_area
    && (!need_capital || p.capital));
  const rng = mulberry32(seed);
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, count);
}

// ---------- projection ----------

export const ringPoints = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i] / 100, flat[i + 1] / 100]); return out; };

export function regionBounds(pack, view, places = []) {
  if (Array.isArray(view) && view.length === 4) return view;
  const list = view === 'fit' ? places
    : !view || view === 'world' ? pack.places.filter(playable)
    : pack.places.filter((p) => inRegion(p, view));
  if (!list.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of list) {
    // Overseas parts (French Guiana, Alaska's Aleutians) would blow a regional view up: use the main ring.
    const b = view === 'world' || !view ? p.bbox : bboxOfRing(ringPoints(p.rings[0]));
    w = Math.min(w, b[0]); s = Math.min(s, b[1]); e = Math.max(e, b[2]); n = Math.max(n, b[3]);
  }
  if (!view || view === 'world') return [-180, Math.max(-60, s), 180, Math.min(84, n)];
  const pad = 0.06 * Math.max(e - w, n - s);
  return [w - pad, s - pad, e + pad, n + pad];
}

function bboxOfRing(pts) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of pts) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
}

/**
 * Equirectangular with a standard parallel at the middle latitude (x shrinks by its cosine), fitted into
 * the rect and centred. Canvas position = (ax + lon * kx, ay - lat * ky); the inverse is linear too, so
 * game rules can turn a tap back into longitude and latitude with plain arithmetic.
 */
export function makeView(rect, bounds) {
  const [w, s, e, n] = bounds;
  const mid = ((s + n) / 2) * Math.PI / 180;
  const c = bounds[2] - bounds[0] >= 300 ? 1 : Math.cos(mid);
  const k = Math.min(rect.w / ((e - w) * c), rect.h / (n - s));
  const kx = k * c, ky = k;
  const ox = rect.x + (rect.w - (e - w) * kx) / 2;
  const oy = rect.y + (rect.h - (n - s) * ky) / 2;
  return { rect, bounds, kx, ky, ax: ox - w * kx, ay: oy + n * ky };
}

export const project = (v, lon, lat) => [v.ax + lon * v.kx, v.ay - lat * v.ky];
export const unproject = (v, x, y) => [(x - v.ax) / v.kx, (v.ay - y) / v.ky];

// ---------- rings on screen ----------

function segDist2(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

function simplifyLine(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bi = -1;
    for (let k = i + 1; k < j; k++) { const d = segDist2(pts[k], pts[i], pts[j]); if (d > best) { best = d; bi = k; } }
    if (best > tol * tol) { keep[bi] = 1; stack.push([i, bi], [bi, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

export function simplifyRing(ring, tol) {
  if (ring.length < 4 || tol <= 0) return ring.slice();
  let far = 0, fd = -1;
  for (let k = 1; k < ring.length; k++) {
    const d = (ring[k][0] - ring[0][0]) ** 2 + (ring[k][1] - ring[0][1]) ** 2;
    if (d > fd) { fd = d; far = k; }
  }
  const a = simplifyLine(ring.slice(0, far + 1), tol);
  const b = simplifyLine(ring.slice(far).concat([ring[0]]), tol);
  return a.concat(b.slice(1, -1));
}

export function area(r) {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(s / 2);
}

/** Sutherland–Hodgman against an axis-aligned rect. */
export function clipRing(ring, { x, y, w, h }) {
  const edges = [
    [(p) => p[0] >= x, (a, b) => { const t = (x - a[0]) / (b[0] - a[0]); return [x, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[0] <= x + w, (a, b) => { const t = (x + w - a[0]) / (b[0] - a[0]); return [x + w, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[1] >= y, (a, b) => { const t = (y - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y]; }],
    [(p) => p[1] <= y + h, (a, b) => { const t = (y + h - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y + h]; }],
  ];
  let out = ring;
  for (const [inside, cut] of edges) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i], prev = src[(i + src.length - 1) % src.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}

/**
 * A place's rings in canvas coordinates relative to the map rect's top-left: clipped to the rect,
 * simplified to `tol` px, rings under `minArea` px² dropped (the largest is always kept), each ring at
 * most POLY_MAX points (simplified harder until it fits).
 */
export function placeRings(place, view, { tol = 0.6, minArea = 2 } = {}) {
  const { rect } = view;
  const rings = [];
  for (const flat of place.rings) {
    let r = ringPoints(flat).map(([lon, lat]) => project(view, lon, lat));
    r = clipRing(r, rect);
    if (r.length < 3) continue;
    let t = tol;
    let s = simplifyRing(r, t);
    while (s.length > POLY_MAX) { t *= 1.5; s = simplifyRing(r, t); }
    if (s.length < 3) s = r.length <= POLY_MAX ? r : s;
    if (s.length < 3) continue;
    rings.push(s.map(([px, py]) => [px - rect.x, py - rect.y]));
  }
  rings.sort((a, b) => area(b) - area(a));
  return rings.filter((r, i) => i === 0 || area(r) >= minArea);
}

// ---------- the map picture ----------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');

function pathData(rings, scale) {
  let d = '';
  for (const r of rings) {
    let px = Math.round(r[0][0] * scale), py = Math.round(r[0][1] * scale);
    d += `M${px} ${py}`;
    let body = '';
    for (let i = 1; i < r.length; i++) {
      const x = Math.round(r[i][0] * scale), y = Math.round(r[i][1] * scale);
      if (x === px && y === py) continue;
      const dx = x - px, dy = y - py;
      body += `${dx < 0 ? '' : ' '}${dx}${dy < 0 ? '' : ' '}${dy}`;
      px = x; py = y;
    }
    d += `l${body.replace(/^ /, '')}z`;
  }
  return d;
}

/**
 * The map as one SVG (viewBox = the rect at 2x, whole numbers): sea, land with borders, and optional
 * graticule lines. Simplifies harder until it fits `budget` bytes.
 */
export function mapSvg(pack, view, { sea = '#CFE3F2', land = '#F4EFE4', border = '#8A9AAE', graticule = true, budget = SPRITE_BUDGET, places = null } = {}) {
  const { rect } = view;
  const S = 2;
  const W = Math.round(rect.w * S), H = Math.round(rect.h * S);
  const list = (places ?? pack.places).filter((p) => p.continent !== 'Antarctica' || view.bounds[1] < -60);
  let tol = 0.35;
  for (let tries = 0; tries < 12; tries++) {
    let d = '';
    for (const p of list) {
      const [w, s, e, n] = p.bbox;
      const [b0, b1, b2, b3] = view.bounds;
      if (e < b0 || w > b2 || n < b1 || s > b3) continue;
      d += pathData(placeRings(p, view, { tol, minArea: tol * tol * 4 }), S);
    }
    let grid = '';
    if (graticule) {
      for (let lon = -150; lon <= 150; lon += 30) {
        const [gx] = project(view, lon, 0);
        if (gx > rect.x && gx < rect.x + rect.w) grid += `M${Math.round((gx - rect.x) * S)} 0v${H}`;
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const [, gy] = project(view, 0, lat);
        if (gy > rect.y && gy < rect.y + rect.h) grid += `M0 ${Math.round((gy - rect.y) * S)}h${W}`;
      }
    }
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}'>`
      + `<rect width='${W}' height='${H}' rx='${Math.round(10 * S)}' fill='${esc(sea)}'/>`
      + (grid ? `<path d='${grid}' stroke='${esc(border)}' stroke-opacity='0.25' stroke-width='1' fill='none'/>` : '')
      + `<path d='${d}' fill='${esc(land)}' stroke='${esc(border)}' stroke-width='1' stroke-linejoin='round'/>`
      + '</svg>';
    if (svg.length <= budget) return { svg, tol, bytes: svg.length };
    tol *= 1.35;
  }
  throw new Error(`map picture still over ${budget} bytes; use a smaller view or fewer places`);
}

// ---------- expressions ----------

const num = (v) => { const r = Math.round(v * 10) / 10; return Number.isInteger(r) ? `${r}.0` : String(r); };
const vec = ([x, y]) => `vec(${num(x)}, ${num(y)})`;
const str = (s) => `'${String(s).replace(/'/g, '’').replace(/[\u0000-\u001f]/g, ' ')}'`;
const list = (items) => `[${items.join(', ')}]`;

/** Distractors for a quiz: nearest places first (same subregion, then continent), deterministic. */
function distractors(pack, place, n, field, pool) {
  const [lx, ly] = place.label;
  const cands = pool.filter((p) => p.id !== place.id && (field !== 'capital' || p.capital))
    .map((p) => ({ p, d: (p.label[0] - lx) ** 2 + (p.label[1] - ly) ** 2 }))
    .sort((a, b) => a.d - b.d || a.p.id.localeCompare(b.p.id));
  return cands.slice(0, n).map(({ p }) => (field === 'capital' ? p.capital.name : p.name));
}

// ---------- applyGeo ----------

/**
 * Turn a manifest's `geo` section into sprites, functions and params. Returns
 * { manifest, diagnostics, report }; the input manifest is not changed.
 */
export function applyGeo(manifest, packs) {
  const diagnostics = [];
  const err = (at, message, hint) => diagnostics.push({ code: 'A_GEO_PLACE', severity: 'error', at, message, ...(hint ? { hint } : {}) });
  const geo = manifest?.geo;
  if (!geo) return { manifest, diagnostics, report: null };
  const out = JSON.parse(JSON.stringify(manifest));
  delete out.geo;
  const pack = packs[geo.pack ?? 'world'];
  if (!pack || pack.format !== GEO_FORMAT) {
    diagnostics.push({ code: 'A_GEO_PACK', severity: 'error', at: '/geo/pack', message: `unknown geo pack '${geo.pack}'`, hint: `use one of: ${Object.keys(packs).join(', ')}` });
    return { manifest: out, diagnostics, report: null };
  }

  const targetKind = geo.target === 'capital' ? 'capital' : 'label';
  let places = [];
  if (Array.isArray(geo.places)) {
    geo.places.forEach((name, i) => {
      const p = findPlace(pack, name);
      if (!p) err(`/geo/places/${i}`, `'${name}' isn't in the ${pack.id} pack`, 'use the place\'s common English name; the pack has no made-up or historical places');
      else if (targetKind === 'capital' && !p.capital) err(`/geo/places/${i}`, `${p.name} has no single capital in the pack`, 'pick another place or use "target": "label"');
      else places.push(p);
    });
  } else {
    places = pickPlaces(pack, { ...(geo.pick ?? {}), need_capital: targetKind === 'capital' || geo.quiz?.ask === 'capital' });
  }
  if (!places.length) {
    if (!diagnostics.length) err('/geo', 'no places to play with');
    return { manifest: out, diagnostics, report: null };
  }

  const fn = (returns, body) => ({ params: {}, returns, body });
  const target = places.map((p) => (targetKind === 'capital' && p.capital ? [p.capital.lon, p.capital.lat] : p.label));
  out.functions = {
    ...(out.functions ?? {}),
    geo_names: fn('list<string>', list(places.map((p) => str(p.name)))),
    geo_ids: fn('list<string>', list(places.map((p) => str(p.id)))),
    geo_capitals: fn('list<string>', list(places.map((p) => str(p.capital?.name ?? '')))),
    geo_continents: fn('list<string>', list(places.map((p) => str(p.continent ?? '')))),
    geo_target: fn('list<vec2>', list(target.map(vec))),
  };
  const report = { pack: pack.id, places: places.map((p) => p.id) };
  const usesOf = (name) => (out.uses ?? []).filter((u) => u.fragment === name);

  // The map: a picture of all land (disputed areas included) plus highlight rings for the game's places.
  if (geo.map || usesOf('geo_map').length || usesOf('map_pin').length) {
    const rect = { x: 5, y: 92, w: 350, h: 136 };
    for (const k of ['x', 'y', 'w', 'h']) if (Number.isFinite(geo.map?.[k])) rect[k] = geo.map[k];
    const bounds = regionBounds(pack, geo.map?.view ?? 'world', places);
    if (!bounds) { err('/geo/map/view', `unknown view '${geo.map?.view}'`, 'world, fit, a continent or a subregion'); return { manifest: out, diagnostics, report: null }; }
    const view = makeView(rect, bounds);
    const picture = mapSvg(pack, view, { ...(geo.map?.colors ?? {}) });
    const rings = [], owner = [];
    places.forEach((p, i) => {
      for (const r of placeRings(p, view, { tol: 0.4, minArea: 1 })) { rings.push(r); owner.push(i); }
    });
    const label = places.map((p) => project(view, ...p.label).map((v, k) => v - (k ? rect.y : rect.x)));
    Object.assign(out.functions, {
      geo_rings: fn('list<list<vec2>>', list(rings.map((r) => list(r.map(vec))))),
      geo_ring_place: fn('list<int>', list(owner.map(String))),
      geo_label: fn('list<vec2>', list(label.map(vec))),
    });
    out.art = { ...(out.art ?? {}), sprites: { ...(out.art?.sprites ?? {}), map: { svg: picture.svg, color: '#8A9AAE' } } };
    const proj = { ax: +view.ax.toFixed(4), ay: +view.ay.toFixed(4), kx: +view.kx.toFixed(6), ky: +view.ky.toFixed(6) };
    // The geo step owns the rect and the projection: whatever the model wrote there is replaced.
    for (const use of usesOf('geo_map')) use.params = { ...(use.params ?? {}), ...rect };
    for (const use of usesOf('map_pin')) use.params = { ...(use.params ?? {}), ...rect, ...proj };
    Object.assign(report, { view: bounds, map_bytes: picture.bytes, map_tol_px: +picture.tol.toFixed(2), rings: rings.length, ring_points: rings.reduce((s, r) => s + r.length, 0), projection: proj });
  }

  // Outlines: each place alone, its main land mass fitted to the outline rect.
  if (geo.outline || usesOf('country_outline').length) {
    const rect = { x: 40, y: 100, w: 280, h: 150 };
    for (const k of ['x', 'y', 'w', 'h']) if (Number.isFinite(geo.outline?.[k])) rect[k] = geo.outline[k];
    const rings = [], owner = [];
    places.forEach((p, i) => {
      const [w, s, e, n] = bboxOfRing(ringPoints(p.rings[0]));
      const pad = 0.04 * Math.max(e - w, n - s);
      const view = makeView(rect, [w - pad, s - pad, e + pad, n + pad]);
      const tol = Math.max(0.5, Math.max(rect.w, rect.h) / 300);
      for (const r of placeRings(p, view, { tol, minArea: 4 })) { rings.push(r); owner.push(i); }
    });
    Object.assign(out.functions, {
      geo_outline: fn('list<list<vec2>>', list(rings.map((r) => list(r.map(vec))))),
      geo_outline_place: fn('list<int>', list(owner.map(String))),
    });
    for (const use of usesOf('country_outline')) use.params = { ...(use.params ?? {}), ...rect };
    Object.assign(report, { outline_rings: rings.length, outline_points: rings.reduce((s, r) => s + r.length, 0) });
  }

  if (geo.quiz) {
    const n = Math.max(2, Math.min(4, geo.quiz.choices ?? 3));
    const field = geo.quiz.ask === 'capital' ? 'capital' : 'name';
    const pool = pack.places.filter(playable);
    const flat = [];
    places.forEach((p, i) => {
      const right = field === 'capital' ? p.capital.name : p.name;
      // The answer's slot turns with the question, so a quiz that shows choices in order isn't always "first".
      const group = distractors(pack, p, n - 1, field, pool);
      group.splice(i % n, 0, right);
      flat.push(...group);
    });
    out.functions.geo_choices = fn('list<string>', list(flat.map(str)));
  }
  return { manifest: out, diagnostics, report };
}
