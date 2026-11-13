#!/usr/bin/env node
// Tests for maps on screen, with no network:
//   1. the geo packs (authoring/content/geo/*.json): format, license, every place drawable;
//   2. expander/geo.mjs: names, projection round trip, clipping, the sprite budget, the poly limit,
//      determinism, unknown places;
//   3. the example games are current (tools/make-geo-games.mjs --check) and expand cleanly;
//   4. with a built engine (MG_ENGINE_DIR): validate, the bot gate, the score check, and the engine's
//      geo_km against a JS great-circle distance for real taps.
// Usage: node authoring/tools/test-geo.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as G from '../expander/geo.mjs';
import { sanitizeSvg } from '../expander/svg.mjs';
import { expand, loadLibrary } from '../expander/expand.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const authoringDir = join(here, '..');
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log(`FAIL ${msg}`); } };

const load = (f) => JSON.parse(readFileSync(join(authoringDir, 'content', 'geo', f), 'utf8'));
const packs = { world: load('world.json'), us_states: load('us_states.json') };

// ---------- 1. packs ----------

for (const pack of Object.values(packs)) {
  ok(pack.format === 'geo-pack/1' && /public domain/i.test(pack.license) && /Natural Earth/.test(pack.source), `${pack.id}: format, source and license recorded`);
  ok(pack.places.every((p) => p.rings.length && p.rings.every((r) => r.length >= 6 && r.length % 2 === 0 && r.every(Number.isInteger))), `${pack.id}: every place has integer rings`);
  ok(new Set(pack.places.map((p) => p.id)).size === pack.places.length, `${pack.id}: ids unique`);
  ok(pack.places.every((p) => p.label[0] >= p.bbox[0] - 0.5 && p.label[0] <= p.bbox[2] + 0.5 && p.label[1] >= p.bbox[1] - 0.5 && p.label[1] <= p.bbox[3] + 0.5), `${pack.id}: label points inside their bbox`);
}
ok(packs.world.places.length === 177 && packs.us_states.places.length === 51, 'world has 177 places, us_states 51 (50 states and DC)');
const capOutside = packs.world.places.filter((p) => p.capital && !(p.capital.lon >= p.bbox[0] - 2.5 && p.capital.lon <= p.bbox[2] + 2.5 && p.capital.lat >= p.bbox[1] - 2.5 && p.capital.lat <= p.bbox[3] + 2.5));
// 2.5 degrees of slack: Malabo and Port Vila are on islands too small for the 1:110m outlines.
ok(capOutside.length === 0, `capitals sit near their country's bbox (${capOutside.map((p) => p.name).join(', ')})`);
ok(packs.world.places.filter((p) => p.capital).length >= 160, 'at least 160 countries have one capital');

// ---------- 2. geo.mjs ----------

const W = packs.world;
ok(G.findPlace(W, 'france')?.id === 'FRA' && G.findPlace(W, 'FRA')?.id === 'FRA', 'find by name and id');
ok(G.findPlace(W, 'USA')?.id === 'USA' && G.findPlace(W, 'United States')?.id === 'USA' && G.findPlace(W, 'UK')?.id === 'GBR', 'find by alias');
ok(G.findPlace(W, "Cote d'Ivoire")?.id === 'CIV', 'accents and apostrophes are ignored');
ok(G.findPlace(W, 'Atlantis') === null, 'unknown places are not found');

const view = G.makeView({ x: 5, y: 92, w: 350, h: 136 }, G.regionBounds(W, 'world'));
for (const [lon, lat] of [[2.35, 48.86], [-77, 38.9], [151.2, -33.9], [-180, 0], [179.9, 70]]) {
  const [x, y] = G.project(view, lon, lat);
  const [lo, la] = G.unproject(view, x, y);
  ok(Math.abs(lo - lon) < 1e-9 && Math.abs(la - lat) < 1e-9, `projection round trip at ${lon},${lat}`);
  ok(x >= 5 - 1e-6 && x <= 355 + 1e-6, `world view fits the rect horizontally at ${lon}`);
}
const clipped = G.clipRing([[0, 0], [20, 0], [20, 20], [0, 20]], { x: 5, y: 5, w: 10, h: 10 });
ok(clipped.every(([x, y]) => x >= 5 && x <= 15 && y >= 5 && y <= 15) && Math.abs(G.area(clipped) - 100) < 1e-9, 'a ring is clipped to the rect');

const pic = G.mapSvg(W, view);
ok(pic.bytes <= 24 * 1024, `the world map fits a sprite (${pic.bytes} B)`);
let svgOk = true;
try { const r = sanitizeSvg(pic.svg); svgOk = !(r?.errors?.length); } catch (e) { svgOk = false; console.log(e.message); }
ok(svgOk, 'the map passes the SVG sanitizer');
const europe = G.makeView({ x: 0, y: 100, w: 360, h: 300 }, G.regionBounds(W, 'Europe'));
ok(G.mapSvg(W, europe).bytes <= 24 * 1024, 'a Europe map fits a sprite');
const us = G.makeView({ x: 0, y: 100, w: 360, h: 220 }, G.regionBounds(packs.us_states, 'world'));
ok(G.mapSvg(packs.us_states, us).bytes <= 24 * 1024, 'the US states map fits a sprite');

const russia = G.placeRings(G.findPlace(W, 'Russia'), view);
ok(russia.length > 0 && russia.every((r) => r.length >= 3 && r.length <= G.POLY_MAX), 'rings respect the poly limit');
ok(russia.every((r) => r.every(([x, y]) => x >= -1e-6 && x <= 350 + 1e-6 && y >= -1e-6 && y <= 136 + 1e-6)), 'rings are relative to the rect and inside it');

const spec = JSON.parse(readFileSync(join(authoringDir, 'content', 'geo', 'examples', 'map_spotter.json'), 'utf8'));
const a = G.applyGeo(spec, packs), b = G.applyGeo(spec, packs);
ok(JSON.stringify(a.manifest) === JSON.stringify(b.manifest), 'applyGeo is deterministic');
ok(!('geo' in a.manifest) && a.manifest.art.sprites.map && a.manifest.functions.geo_rings && a.manifest.functions.geo_choices, 'geo becomes a sprite and functions');
ok(a.manifest.uses.find((u) => u.fragment === 'geo_map').params.w === 350, 'the geo_map use gets the rect');
const choices = JSON.parse(a.manifest.functions.geo_choices.body.replace(/'/g, '"'));
const names = JSON.parse(a.manifest.functions.geo_names.body.replace(/'/g, '"'));
ok(choices.length === names.length * 4 && names.every((n, i) => choices.slice(i * 4, i * 4 + 4).includes(n) && new Set(choices.slice(i * 4, i * 4 + 4)).size === 4), 'each question has its answer and three different neighbours');
const bad = G.applyGeo({ ...spec, geo: { ...spec.geo, places: ['France', 'Atlantis'], pick: undefined } }, packs);
ok(bad.diagnostics.some((d) => d.code === 'A_GEO_PLACE' && d.at === '/geo/places/1'), 'an unknown place is an A_GEO_PLACE error at its pointer');
const named = G.applyGeo({ ...spec, geo: { ...spec.geo, places: ['Japan', 'Brazil', 'Kenya'], pick: undefined, quiz: undefined } }, packs);
ok(!named.diagnostics.length && named.report.places.join() === 'JPN,BRA,KEN', 'named places keep their order');
const capErr = G.applyGeo({ ...spec, geo: { ...spec.geo, places: ['Bolivia'], target: 'capital', pick: undefined, quiz: undefined } }, packs);
ok(capErr.diagnostics.some((d) => d.code === 'A_GEO_PLACE'), 'a place with two capitals can\'t be a capital target');
ok(G.pickPlaces(W, { count: 200 }).every(G.playable), 'picks leave out disputed areas and Antarctica');

// ---------- 3. example games ----------

let current = true;
try { execFileSync(process.execPath, [join(here, 'make-geo-games.mjs'), '--check'], { stdio: 'pipe' }); } catch { current = false; }
ok(current, 'authoring/games has the current geo example games (run tools/make-geo-games.mjs)');
const lib = loadLibrary(authoringDir);
const games = {};
const outl = G.applyGeo(JSON.parse(readFileSync(join(authoringDir, 'content', 'geo', 'examples', 'state_shapes.json'), 'utf8')), packs);
ok(!outl.diagnostics.length && outl.manifest.functions.geo_outline && !outl.manifest.art?.sprites?.map, 'an outline-only game gets outlines and no map picture');
ok(outl.manifest.uses.find((u) => u.fragment === 'country_outline').params.w === 280, 'the country_outline use gets the outline rect');

for (const name of ['map_spotter', 'pin_the_capital', 'state_shapes']) {
  const m = JSON.parse(readFileSync(join(authoringDir, 'games', `${name}.authoring.json`), 'utf8'));
  const out = expand(m, lib);
  const errs = out.diagnostics.filter((d) => d.severity === 'error');
  ok(!errs.length, `${name}: expands (${errs.map((d) => `${d.code} ${d.at} ${d.message}`).join(' | ')})`);
  games[name] = { json: JSON.stringify(out.playtestGame ?? out.game), score: out.score, game: out.game };
}

// ---------- 4. the engine ----------

const R = 6371;
const stateOf = (g) => { const v = g.state(); return typeof v === 'string' ? JSON.parse(v) : v; };
const greatCircle = ([lon1, lat1], [lon2, lat2]) => {
  const r = Math.PI / 180;
  const h = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

let engine = null;
try { ({ engine } = await (await import('../expander/engine.mjs')).loadEngine()); } catch (e) { console.log(`skip engine checks: ${String(e.message).split('.')[0]}`); }
if (engine) {
  const { playtest } = await import('../playtest/gate.mjs');
  const { checkScore } = await import('../playtest/score-check.mjs');
  for (const [name, g] of Object.entries(games)) {
    const v = engine.validate(JSON.stringify(g.game)).filter((d) => d.severity === 'error');
    ok(!v.length, `${name}: validates (${v.map((d) => `${d.code} ${d.message}`).join(' | ')})`);
    const rep = await playtest(g.json, { seed: 1 });
    ok(rep.passed, `${name}: passes the bot gate (${rep.flags.map((f) => f.code).join(', ')}; ${rep.summary})`);
    const sc = await checkScore(engine, g.json, rep.runs, g.score);
    ok(sc.ok, `${name}: passes the score check (${sc.checks.filter((c) => c.status === 'fail').map((c) => `${c.id}: ${c.message}`).join(' | ')})`);
    ok(sc.checks.find((c) => c.id === 'replay')?.status === 'pass', `${name}: every run replays to the same result`);
  }

  // geo_km in the engine against the JS great circle, for taps all over the map.
  const pin = games.pin_the_capital;
  const proj = JSON.parse(readFileSync(join(authoringDir, 'games', 'pin_the_capital.authoring.json'), 'utf8')).uses.find((u) => u.fragment === 'map_pin').params;
  const targets = JSON.parse(readFileSync(join(authoringDir, 'games', 'pin_the_capital.authoring.json'), 'utf8')).functions.geo_target.body
    .replace(/vec\(([^,]+), ([^)]+)\)/g, '[$1,$2]');
  const tl = JSON.parse(targets);
  let worst = 0, taps = 0, exact = true;
  const taps_at = [[30, 170], [180, 225], [350, 290], [90, 200], [300, 160], [200, 280], [10, 295], [260, 240]];
  for (const [i, [x, y]] of taps_at.entries()) {
    const g = engine.load(pin.json, 1 + i);
    for (let s = 0; s < 5; s++) g.step(1000 / 60);
    const st0 = stateOf(g);
    const target = tl[st0.order[st0.round]];
    g.frame(); g.pointer('down', x, y); g.pointer('up', x, y); g.step(1000 / 60);
    const st = stateOf(g);
    const ll = [(x - proj.ax) / proj.kx, (proj.ay - y) / proj.ky];
    const js = greatCircle(ll, target);
    worst = Math.max(worst, Math.abs(st.pin_km - js));
    taps++;
    // A tap right on the answer scores the maximum.
    const g2 = engine.load(pin.json, 1 + i);
    for (let s = 0; s < 5; s++) g2.step(1000 / 60);
    const tx = proj.ax + target[0] * proj.kx, ty = proj.ay - target[1] * proj.ky;
    g2.frame(); g2.pointer('down', tx, ty); g2.pointer('up', tx, ty); g2.step(1000 / 60);
    const st2 = stateOf(g2);
    if (!(st2.pin_km <= 1 && st2.score >= 999)) exact = false;
    g.dispose?.(); g2.dispose?.();
  }
  ok(taps === taps_at.length && worst <= 1.5, `engine geo_km matches the JS great circle within 1.5 km over ${taps} taps (worst ${worst.toFixed(2)} km)`);
  ok(exact, 'a pin on the answer is 0–1 km away and scores 1000');
  console.log(`geo_km: worst difference from the JS great circle ${worst.toFixed(2)} km over ${taps} taps`);

  // geo_place_at: each place's label point (inside the outline for these big countries) finds that place;
  // a point in the ocean finds none.
  {
    const probe = JSON.parse(JSON.stringify(spec));
    probe.geo = { ...probe.geo, places: ['Brazil', 'Australia', 'Kazakhstan', 'Algeria', 'Canada'], pick: undefined, quiz: undefined };
    probe.uses = [{ fragment: 'geo_map' }];
    probe.functions = { map_focus: { params: {}, returns: 'int', body: '-1' } };
    probe.state = { found: { type: 'list<int>', init: '[]' } };
    const { manifest: pm, report } = G.applyGeo(probe, packs);
    const pv = G.makeView({ x: 5, y: 92, w: 350, h: 136 }, report.view);
    const pts = report.places.map((id) => G.project(pv, ...W.places.find((p) => p.id === id).label)).concat([G.project(pv, -30, 0)]);
    pm.rules = [{ id: 'probe', on: 'start', do: pts.map(([x, y]) => ({ push: 'found', value: `geo_place_at(vec(${x.toFixed(1)}, ${y.toFixed(1)}))` })) }];
    pm.objectives = { time_limit: '10s', on_timeout: 'win' };
    delete pm.score;
    const po = expand(pm, lib);
    const perr = [...po.diagnostics, ...engine.validate(JSON.stringify(po.game))].filter((d) => d.severity === 'error');
    ok(!perr.length, `geo_place_at probe validates (${perr.map((d) => `${d.code} ${d.at} ${d.message}`).join(' | ')})`);
    if (!perr.length) {
      const g = engine.load(JSON.stringify(po.game), 1);
      g.step(1000 / 60);
      const found = stateOf(g).found;
      ok(JSON.stringify(found) === JSON.stringify([0, 1, 2, 3, 4, -1]), `geo_place_at finds each country at its label point and none in the ocean (${JSON.stringify(found)})`);
    }
  }

  // geo_distance: km, direction and closeness for fixed pairs, in the engine.
  const pairs = [
    [[2.35, 48.86], [-0.12, 51.5], 'NW'], [[-77.01, 38.9], [139.7, 35.7], 'W'], [[151.2, -33.9], [174.8, -41.3], 'E'], [[-46.6, -23.5], [18.4, -33.9], 'E'], [[28.0, -26.2], [31.2, 30.0], 'N'], [[-74.0, 40.7], [-99.1, 19.4], 'SW'],
    [[0, 0], [0, 0], ''], [[0, 10], [180, -10], 'E'], [[179, 0], [-179, 0], 'E'], [[10, 0], [10, 50], 'N'],
  ];
  const dg = {
    authoring: 'microgame-authoring/0.1', meta: { title: 'Distance probe', instructions: 'probe', duration_s: 10 },
    uses: [{ fragment: 'geo_distance' }],
    state: {
      km: { type: 'list<int>', init: '[]' }, dir: { type: 'list<string>', init: '[]' }, close: { type: 'list<int>', init: '[]' },
    },
    rules: [{ id: 'probe', on: 'start', do: pairs.flatMap(([a, b]) => {
      const e = `vec(${a[0].toFixed(2)}, ${a[1].toFixed(2)}), vec(${b[0].toFixed(2)}, ${b[1].toFixed(2)})`;
      return [{ push: 'km', value: `geo_km(${e})` }, { push: 'dir', value: `geo_dir(${e})` }, { push: 'close', value: `geo_closeness(${e})` }];
    }) }],
    objectives: { time_limit: '10s', on_timeout: 'win' },
  };
  const dout = expand(dg, lib);
  const derr = [...dout.diagnostics, ...engine.validate(JSON.stringify(dout.game))].filter((d) => d.severity === 'error');
  ok(!derr.length, `geo_distance probe expands and validates (${derr.map((d) => `${d.code} ${d.at} ${d.message}`).join(' | ')})`);
  if (!derr.length) {
    const g = engine.load(JSON.stringify(dout.game), 1);
    g.step(1000 / 60);
    const s = stateOf(g);
    pairs.forEach(([a, b, dir], i) => {
      const js = greatCircle(a, b);
      ok(Math.abs(s.km[i] - js) <= 1, `geo_km ${JSON.stringify(a)}→${JSON.stringify(b)}: ${s.km[i]} vs ${js.toFixed(1)} km`);
      ok(s.dir[i] === dir, `geo_dir ${JSON.stringify(a)}→${JSON.stringify(b)}: '${s.dir[i]}', expected '${dir}'`);
      ok(s.close[i] === Math.max(0, Math.min(100, Math.round(100 - Math.round(js) / 200.15))), `geo_closeness ${i}: ${s.close[i]}`);
    });
  }
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
