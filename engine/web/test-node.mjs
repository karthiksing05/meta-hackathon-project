// Node smoke test for the WASM build: `node engine/web/test-node.mjs`
// (run engine/build-wasm.sh first). Loads microgame.wasm through
// microgame.js, plays each fixture, and checks that every decoded binary
// frame matches the JSON frame op for op.

import { readFileSync } from 'node:fs';
import { Microgame, MicrogameLoadError, rgbaToHex } from './microgame.js';

const here = new URL('.', import.meta.url);
const fixtures = ['lights_out', 'snake', 'number_merge'];
let failures = 0;

function check(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

const near = (a, b) => Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(b));
const color = (c) => (c === 0 ? null : rgbaToHex(c));
const jsonColor = (c) => (c === '#00000000' ? null : c);

function compareFrames(name, step, bin, js) {
  check(bin.ops.length === js.ops.length, `${name} step ${step}: ${bin.ops.length} binary ops vs ${js.ops.length} JSON ops`);
  check(near(bin.width, js.width) && near(bin.height, js.height), `${name}: canvas size`);
  check(rgbaToHex(bin.background) === js.background, `${name}: background ${rgbaToHex(bin.background)} vs ${js.background}`);
  const n = Math.min(bin.ops.length, js.ops.length);
  for (let i = 0; i < n; i++) {
    const b = bin.ops[i], j = js.ops[i];
    const where = `${name} step ${step} op ${i} (${j.op})`;
    if (b.op !== j.op) { check(false, `${where}: kind ${b.op}`); continue; }
    for (const k of ['x', 'y', 'w', 'h', 'r', 'radius', 'size', 'stroke_width', 'rotation', 'scale', 'opacity']) {
      if (k in j) check(near(b[k], j[k]), `${where}: ${k} ${b[k]} vs ${j[k]}`);
    }
    for (const k of ['fill', 'stroke']) if (k in j) check(color(b[k]) === jsonColor(j[k]), `${where}: ${k} ${color(b[k])} vs ${j[k]}`);
    if (j.op === 'text') {
      check(b.text === j.text, `${where}: text ${JSON.stringify(b.text)} vs ${JSON.stringify(j.text)}`);
      check(b.font === j.font && b.weight === j.weight, `${where}: font`);
      check(b.align === j.align && b.valign === j.valign, `${where}: align`);
      check(rgbaToHex(b.color) === j.color, `${where}: color`);
    }
  }
}

const t0 = performance.now();
const engine = await Microgame.init(readFileSync(new URL('pkg/microgame.wasm', here)));
console.log(`engine instantiated in ${(performance.now() - t0).toFixed(1)} ms`);

// Validation and load errors.
const bad = engine.validate('{"format": "microgame/0.1"}');
check(Array.isArray(bad) && bad.some((d) => d.severity === 'error'), 'an empty game should not validate');
try {
  engine.load('{ not json');
  check(false, 'loading invalid JSON should throw');
} catch (e) {
  check(e instanceof MicrogameLoadError && e.diagnostics.length > 0, `load error should carry diagnostics: ${e}`);
}

// Load all three at once (the feed preloads), then play them interleaved.
const sources = Object.fromEntries(fixtures.map((n) => [n, readFileSync(new URL(`../fixtures/${n}.json`, here), 'utf8')]));
const games = {};
for (const name of fixtures) {
  const diags = engine.validate(sources[name]);
  check(!diags.some((d) => d.severity === 'error'), `${name} should validate: ${JSON.stringify(diags)}`);
  games[name] = engine.load(sources[name], 7);
  check(games[name].meta.title.length > 0, `${name}: meta.title`);
}
check(engine.liveGames() === 3, `3 games should be loaded, found ${engine.liveGames()}`);

const inputs = {
  lights_out: (g, i) => { g.pointer('down', 180, 320 + (i % 3) * 20); g.pointer('up', 180, 320); },
  snake: (g, i) => g.key(['ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight'][i % 4]),
  number_merge: (g, i) => g.swipe(['left', 'down', 'right', 'up'][i % 4]),
};

const sizes = {};
for (let step = 0; step < 180; step++) {
  for (const name of fixtures) {
    const g = games[name];
    if (step % 12 === 0) inputs[name](g, step / 12);
    g.step(16);
    const bytes = g.frameBytes().length;
    // frame() and frameJSON() each build a frame; ops are identical with no step in between.
    const bin = g.frame();
    const js = g.frameJSON();
    compareFrames(name, step, bin, js);
    const s = (sizes[name] ||= { bin: 0, json: 0, ops: 0, n: 0 });
    s.bin += bytes; s.json += JSON.stringify(js).length; s.ops += js.ops.length; s.n++;
  }
}
for (const name of fixtures) {
  const g = games[name];
  const st = g.status();
  check(['playing', 'won', 'lost'].includes(st.phase) && Number.isInteger(st.time_ms), `${name}: status ${JSON.stringify(st)}`);
  check(/^[0-9a-f]{16}$/.test(g.stateHash()), `${name}: state hash`);
  check(typeof g.state() === 'object', `${name}: state JSON`);
  check(Array.isArray(g.diagnostics()), `${name}: diagnostics`);
  const d = g.diagnostics();
  check(d.length === 0, `${name}: runtime diagnostics ${JSON.stringify(d)}`);
  const s = sizes[name];
  console.log(`${name}: ${st.phase} at ${st.time_ms} ms, ${(s.ops / s.n).toFixed(0)} ops/frame, ` +
    `binary ${(s.bin / s.n).toFixed(0)} B/frame vs JSON ${(s.json / s.n).toFixed(0)} B/frame`);
}

// Determinism through the wrapper: same seed and inputs → same hash.
for (const name of fixtures) {
  const hashes = [];
  for (let k = 0; k < 2; k++) {
    const g = engine.load(sources[name], 99);
    for (let i = 0; i < 60; i++) {
      if (i % 6 === 0) inputs[name](g, i / 6);
      g.step(16);
      g.frame();
    }
    hashes.push(g.stateHash());
    g.dispose();
  }
  check(hashes[0] === hashes[1], `${name}: hashes differ ${hashes}`);
}

// Restart resets the clock; dispose frees the slot; stale handles are rejected.
const g = games.snake;
g.restart(5);
check(g.status().time_ms === 0, 'restart resets time');
for (const name of fixtures) games[name].dispose();
check(engine.liveGames() === 0, `all games disposed, ${engine.liveGames()} left`);
try {
  g.step(16);
  check(false, 'a disposed game should throw');
} catch { /* expected */ }

// Frame speed through the wrapper (binary decode vs JSON parse).
{
  const gm = engine.load(sources.number_merge, 3);
  const N = 2000;
  let t = performance.now();
  for (let i = 0; i < N; i++) { gm.step(16); gm.frame(); }
  const binUs = ((performance.now() - t) * 1000) / N;
  t = performance.now();
  for (let i = 0; i < N; i++) { gm.step(16); gm.frameJSON(); }
  const jsonUs = ((performance.now() - t) * 1000) / N;
  console.log(`number_merge in wasm: step+binary frame ${binUs.toFixed(1)} µs, step+JSON frame ${jsonUs.toFixed(1)} µs`);
  gm.dispose();
}

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('ok: node smoke test passed');
