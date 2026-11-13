#!/usr/bin/env node
// Build the geography example games: each authoring/content/geo/examples/<name>.json carries a `geo`
// section; expander/geo.mjs turns it into the map sprite, the geo_* functions and the map params, and the
// result is written to authoring/games/<name>.authoring.json (an ordinary manifest the gate can run).
//
//   node authoring/tools/make-geo-games.mjs           write
//   node authoring/tools/make-geo-games.mjs --check   exit 1 if a written game is out of date

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyGeo } from '../expander/geo.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const geoDir = join(root, 'content', 'geo');
const check = process.argv.includes('--check');

export function loadGeoPacks(dir = geoDir) {
  const packs = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const p = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (p.format === 'geo-pack/1') packs[p.id] = p;
  }
  return packs;
}

const packs = loadGeoPacks();
let stale = 0, failed = 0;
for (const f of readdirSync(join(geoDir, 'examples')).filter((n) => n.endsWith('.json')).sort()) {
  const name = f.replace(/\.json$/, '');
  const src = JSON.parse(readFileSync(join(geoDir, 'examples', f), 'utf8'));
  const { manifest, diagnostics, report } = applyGeo(src, packs);
  if (diagnostics.length) {
    failed++;
    for (const d of diagnostics) console.error(`${name}: ${d.code} ${d.at} ${d.message}`);
    continue;
  }
  const text = JSON.stringify(manifest, null, 2) + '\n';
  const out = join(root, 'games', `${name}.authoring.json`);
  if (check) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== text) { stale++; console.error(`${name}: out of date`); }
  } else {
    writeFileSync(out, text);
  }
  const parts = [`${report.places.length} places (${report.places.join(" ")})`];
  if (report.map_bytes) parts.push(`map ${report.map_bytes} B at ${report.map_tol_px} px, ${report.rings} rings / ${report.ring_points} points`);
  if (report.outline_rings) parts.push(`outlines ${report.outline_rings} rings / ${report.outline_points} points`);
  console.log(`${name}: ${parts.join(", ")}, game ${(text.length / 1024).toFixed(1)} KB`);
}
process.exit(failed || stale ? 1 : 0);
