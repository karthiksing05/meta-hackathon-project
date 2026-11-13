#!/usr/bin/env node
// Build the geography content packs from Natural Earth (public domain) at build time:
//
//   node authoring/tools/make-geo-pack.mjs --src <dir> [--out authoring/content/geo] [--tol 0.05]
//
// <dir> must hold these Natural Earth GeoJSON files (1:110m, version 5.x), downloaded by hand:
//   ne_110m_admin_0_countries.geojson
//   ne_110m_populated_places_simple.geojson
//   ne_110m_admin_1_states_provinces.geojson
// from https://www.naturalearthdata.com/downloads/110m-cultural-vectors/ (or the mirror at
// cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/<name>.geojson).
//
// Writes two packs in `geo-pack/1` format (docs/harness-gaps/maps.md, "The geo pack"):
//   world.json      countries: outlines, label point, bbox, continent, subregion, capital, aliases
//   us_states.json  the 50 US states and DC: outlines, label point, bbox, postal code
//
// Every coordinate comes from the source files; nothing is typed in by hand. Outlines are simplified
// (Douglas–Peucker, `--tol` degrees) and stored as integers in hundredths of a degree. The output is
// deterministic: same input files, same bytes.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const src = opt('--src');
const out = resolve(opt('--out', join(here, '..', 'content', 'geo')));
const tol = Number(opt('--tol', '0.05'));
if (!src) {
  console.error('usage: make-geo-pack.mjs --src <dir with the Natural Earth 110m GeoJSON files> [--out dir] [--tol deg]');
  process.exit(2);
}

const read = (name) => JSON.parse(readFileSync(join(src, `${name}.geojson`), 'utf8'));
const Q = 100; // hundredths of a degree

// ---------- geometry ----------

function segDist2(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/** Douglas–Peucker on a polyline; keeps the ends. */
export function simplifyLine(pts, tolerance) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bi = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDist2(pts[k], pts[i], pts[j]);
      if (d > best) { best = d; bi = k; }
    }
    if (best > t2) { keep[bi] = 1; stack.push([i, bi], [bi, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

/** A closed ring (first point == last point): split at the point farthest from the start so both halves simplify well. */
export function simplifyRing(ring, tolerance) {
  const open = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : ring.slice();
  if (open.length < 4) return open;
  let far = 0, fd = -1;
  for (let k = 1; k < open.length; k++) {
    const d = (open[k][0] - open[0][0]) ** 2 + (open[k][1] - open[0][1]) ** 2;
    if (d > fd) { fd = d; far = k; }
  }
  const a = simplifyLine(open.slice(0, far + 1), tolerance);
  const b = simplifyLine(open.slice(far).concat([open[0]]), tolerance);
  return a.concat(b.slice(1, -1));
}

export function ringArea(r) {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(s / 2);
}

function outerRings(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  // Holes (inner rings) are dropped: at 1:110m the only ones are enclaves like Lesotho, which is its own country.
  return polys.map((p) => p[0]);
}

function packRings(geometry) {
  const rings = outerRings(geometry)
    .map((r) => simplifyRing(r, tol).map(([x, y]) => [Math.round(x * Q), Math.round(y * Q)]))
    .map((r) => r.filter((p, i) => i === 0 || p[0] !== r[i - 1][0] || p[1] !== r[i - 1][1]))
    .filter((r) => r.length >= 3)
    .sort((a, b) => ringArea(b) - ringArea(a));
  // Keep the largest ring always; drop slivers under 0.0004 square degrees (about 5 km²).
  return rings.filter((r, i) => i === 0 || ringArea(r) / (Q * Q) >= 0.0004).map((r) => r.flat());
}

function bboxOf(rings) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) {
    w = Math.min(w, r[i]); e = Math.max(e, r[i]); s = Math.min(s, r[i + 1]); n = Math.max(n, r[i + 1]);
  }
  return [w, s, e, n].map((v) => v / Q);
}

const r2 = (v) => Math.round(v * 100) / 100;
const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

function aliasesOf(names, main) {
  const seen = new Set([main.toLowerCase()]);
  const out = [];
  for (const raw of names) {
    const s = clean(raw);
    if (!s || s === '-99' || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

// ---------- world ----------

const countries = read('ne_110m_admin_0_countries');
const places = read('ne_110m_populated_places_simple');

const capitalsBy = new Map();
for (const f of places.features) {
  const p = f.properties;
  if (p.adm0cap !== 1) continue;
  const key = p.adm0_a3;
  if (!capitalsBy.has(key)) capitalsBy.set(key, []);
  capitalsBy.get(key).push({ name: clean(p.name), lon: r2(p.longitude), lat: r2(p.latitude) });
}

const world = [];
for (const f of countries.features) {
  const p = f.properties;
  const id = p.ADM0_A3;
  const rings = packRings(f.geometry);
  if (!rings.length) continue;
  const caps = (capitalsBy.get(id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
  const abbrev = clean(p.ABBREV).replace(/\./g, '');
  // NAME abbreviates long names ("Dem. Rep. Congo", "S. Sudan"); NAME_LONG spells them out.
  const name = /\./.test(clean(p.NAME)) && clean(p.NAME_LONG) ? clean(p.NAME_LONG) : clean(p.NAME);
  const entry = {
    id,
    name,
    aliases: aliasesOf([p.NAME, p.NAME_LONG, p.ADMIN, p.NAME_EN, p.FORMAL_EN, p.NAME_ALT, p.BRK_NAME, p.NAME_SORT,
      /^[A-Z]{2,4}$/.test(abbrev) ? abbrev : ''], name),
    kind: clean(p.TYPE).toLowerCase(),
    continent: clean(p.CONTINENT),
    subregion: clean(p.SUBREGION),
    label: [r2(p.LABEL_X), r2(p.LABEL_Y)],
    bbox: bboxOf(rings),
    area: r2(rings.reduce((s, r) => {
      const pts = []; for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
      return s + ringArea(pts) / (Q * Q);
    }, 0)),
    ...(caps.length === 1 ? { capital: caps[0] } : {}),
    ...(caps.length > 1 ? { capitals: caps } : {}),
    rings,
  };
  world.push(entry);
}
world.sort((a, b) => a.id.localeCompare(b.id));

// ---------- US states ----------

const admin1 = read('ne_110m_admin_1_states_provinces');
const states = [];
for (const f of admin1.features) {
  const p = f.properties;
  if (p.adm0_a3 !== 'USA') continue;
  const rings = packRings(f.geometry);
  if (!rings.length) continue;
  const postal = clean(p.postal);
  states.push({
    id: `US_${postal}`,
    name: clean(p.name),
    aliases: aliasesOf([p.name_en, postal], clean(p.name)),
    kind: 'state',
    continent: 'North America',
    subregion: clean(p.region) || '',
    label: [r2(p.longitude), r2(p.latitude)],
    bbox: bboxOf(rings),
    rings,
  });
}
states.sort((a, b) => a.id.localeCompare(b.id));

// ---------- write ----------

const header = (id, title, files) => ({
  format: 'geo-pack/1',
  id,
  title,
  source: `Natural Earth 1:110m cultural vectors (${files.join(', ')}), naturalearthdata.com`,
  license: 'Public domain. Natural Earth: "All versions of Natural Earth raster + vector map data found on this website are in the public domain." (naturalearthdata.com/about/terms-of-use). No attribution required; we credit "Made with Natural Earth".',
  coords: 'rings are flat [lon, lat, lon, lat, ...] integer lists in hundredths of a degree (WGS84); label, bbox and capitals are in degrees',
  simplify: `Douglas–Peucker at ${tol} degrees; outer rings only; slivers under 0.0004 square degrees dropped except each place's largest ring`,
  notes: 'Borders follow Natural Earth\'s de facto view. kind "disputed" or "indeterminate" entries are left out of games by default. A country with more than one capital lists them under "capitals" and has no "capital".',
});

mkdirSync(out, { recursive: true });
const write = (file, obj) => {
  // One place per line: readable diffs, still compact.
  const { places: list, ...head } = obj;
  const text = `{\n${Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n  "places": [\n${list.map((pl) => `    ${JSON.stringify(pl)}`).join(',\n')}\n  ]\n}\n`;
  writeFileSync(join(out, file), text);
  const pts = list.reduce((s, pl) => s + pl.rings.reduce((t, r) => t + r.length / 2, 0), 0);
  console.log(`${file}: ${list.length} places, ${pts} points, ${(text.length / 1024).toFixed(1)} KB`);
};
write('world.json', { ...header('world', 'Countries of the world', ['ne_110m_admin_0_countries', 'ne_110m_populated_places_simple']), places: world });
write('us_states.json', { ...header('us_states', 'US states and DC', ['ne_110m_admin_1_states_provinces']), places: states });
