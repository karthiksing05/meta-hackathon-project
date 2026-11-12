// Node smoke test for the WASM build: `node engine/web/test-node.mjs`
// (run engine/build-wasm.sh first). Loads microgame.wasm through
// microgame.js, plays each fixture, and checks that every decoded binary
// frame matches the JSON frame op for op. Then plays v0.2 examples (assets,
// image/line/poly ops, text input, key up, pointer anywhere, audio, music)
// and checks that an input log recorded here verifies with the native
// `microgame verify` (if the release CLI is built).

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    for (const k of ['x', 'y', 'w', 'h', 'r', 'radius', 'size', 'stroke_width', 'rotation', 'scale', 'opacity',
      'x1', 'y1', 'x2', 'y2', 'asset', 'frame', 'line_height']) {
      if (k in j) check(near(b[k], j[k]), `${where}: ${k} ${b[k]} vs ${j[k]}`);
    }
    for (const k of ['fill', 'stroke']) if (k in j) check(color(b[k]) === jsonColor(j[k]), `${where}: ${k} ${color(b[k])} vs ${j[k]}`);
    if (j.op === 'image') check(b.flip_x === j.flip_x && b.flip_y === j.flip_y, `${where}: flips`);
    if (j.op === 'line') check(color(b.stroke) === jsonColor(j.stroke), `${where}: line stroke`);
    if (j.op === 'poly') {
      check(b.closed === j.closed && b.points.length === 2 * j.points.length, `${where}: poly shape`);
      j.points.forEach(([x, y], k) => check(near(b.points[2 * k], x) && near(b.points[2 * k + 1], y), `${where}: point ${k}`));
    }
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

// ------------------------------------------------------------ v0.2 ----

const examples = {
  lantern_ridge: readFileSync(new URL('../examples/lantern_ridge.json', here), 'utf8'),
  word_rain: readFileSync(new URL('../examples/word_rain.json', here), 'utf8'),
  orbit_warden: readFileSync(new URL('../examples/orbit_warden.json', here), 'utf8'),
  gull_rock: readFileSync(new URL('../examples/gull_rock.json', here), 'utf8'),
};

function compareAudio(name, step, bin, js) {
  check(bin.audio.length === js.audio.length, `${name} step ${step}: audio count ${bin.audio.length} vs ${js.audio.length}`);
  bin.audio.forEach((b, i) => {
    const j = js.audio[i];
    if (!j) return;
    const where = `${name} step ${step} audio ${i}`;
    check(b.kind === j.kind && near(b.volume, j.volume), `${where}: kind/volume`);
    if (j.kind === 'synth') {
      check(b.wave === j.wave && b.freqs.length === j.freqs.length && b.freqs.every((f, k) => near(f, j.freqs[k])), `${where}: notes`);
      check((b.slide_hz == null) === (j.slide_hz == null), `${where}: slide`);
    } else {
      check(b.asset === j.asset && near(b.rate, j.rate), `${where}: sample`);
    }
  });
  check(JSON.stringify(bin.haptics) === JSON.stringify(js.haptics), `${name} step ${step}: haptics`);
  check((bin.music == null) === (js.music == null), `${name} step ${step}: music presence`);
  if (bin.music && js.music) {
    check(bin.music.asset === js.music.asset && bin.music.playing === js.music.playing && near(bin.music.volume, js.music.volume),
      `${name} step ${step}: music`);
  }
}

// Each example runs as twins with the same seed and inputs: one decoded from
// binary frames, one from JSON frames, so per-frame audio compares too.
const v2Inputs = {
  lantern_ridge: (g, i) => {
    const k = ['ArrowRight', 'Space', 'ArrowLeft'][i % 3];
    g.keyEvent(k, k === 'Space' ? ' ' : '', true);
    if (i % 2) g.pointer('down', 132, 584); // v0.2.1: hold the HUD right arrow (on_press)
  },
  word_rain: (g, i) => { g.text('change', 'ca'); if (i % 2) g.text('submit', 'cat'); },
  orbit_warden: (g, i) => { g.pointer('down', 60 + i * 10, 200); g.pointer('move', 70 + i * 10, 220); g.pointer('up', 80, 240); g.keyEvent('KeyQ', 'q', true); },
  gull_rock: (g, i) => g.keyEvent(i % 2 ? 'Digit1' : 'Digit2', i % 2 ? '1' : '2', true),
};
const v2Release = {
  lantern_ridge: (g, i) => {
    const k = ['ArrowRight', 'Space', 'ArrowLeft'][i % 3];
    g.keyEvent(k, '', false);
    if (i % 2) g.pointer('up', 20, 300); // on_release, off the button
  },
  orbit_warden: (g) => g.keyEvent('KeyQ', 'q', false),
  gull_rock: (g, i) => g.keyEvent(i % 2 ? 'Digit1' : 'Digit2', '', false),
};
const seen = { image: 0, line: 0, poly: 0, synth: 0, sample: 0, music: 0, wrapped: 0, outlined: 0 };
const logs = {};
for (const [name, src] of Object.entries(examples)) {
  const diags = engine.validate(src);
  check(!diags.some((d) => d.severity === 'error'), `${name} should validate: ${JSON.stringify(diags.slice(0, 3))}`);
  const a = engine.load(src, 21), b = engine.load(src, 21);
  const assets = a.assets();
  check(Array.isArray(assets), `${name}: assets()`);
  for (const as of assets) {
    check(typeof as.src === 'string' && (as.kind === 'image' || as.kind === 'sound'), `${name}: asset ${as.name}`);
    if (as.kind === 'image') check(as.w > 0 && as.h > 0 && as.frames >= 1 && as.cols >= 1, `${name}: image asset size ${as.name}`);
    if (as.svg) check(as.src.startsWith('<svg'), `${name}: svg asset ${as.name}`);
  }
  if (name === 'word_rain') {
    const ti = a.meta.text_input;
    check(ti && ti.placeholder === 'Type a falling word' && ti.max_len === 16, `word_rain: text_input ${JSON.stringify(ti)}`);
  } else {
    check(a.meta.text_input === null, `${name}: text_input should be null`);
  }
  let steps = 0;
  for (let step = 0; step < 600 && a.phase() === 'playing'; step++) {
    for (const g of [a, b]) {
      if (step % 20 === 5) v2Inputs[name](g, step / 20 | 0);
      if (step % 20 === 12) v2Release[name]?.(g, step / 20 | 0);
      g.step(1000 / 60);
    }
    const bin = a.frame();
    const js = b.frameJSON();
    compareFrames(name, step, bin, js);
    compareAudio(name, step, bin, js);
    for (const op of js.ops) if (op.op in seen) seen[op.op]++;
    for (const op of bin.ops) {
      if (op.op !== 'text') continue;
      if (op.text.includes('\n')) seen.wrapped++;
      if (op.stroke) seen.outlined++;
    }
    for (const s of js.audio) seen[s.kind]++;
    if (js.music) seen.music++;
    steps++;
  }
  check(a.stateHash() === b.stateHash(), `${name}: twins diverged`);
  const d = a.diagnostics();
  check(d.length === 0, `${name}: runtime diagnostics ${JSON.stringify(d.slice(0, 3))}`);
  const log = a.log();
  check(log.format === 'microgame-log/1' && log.seed === 21 && /^[0-9a-f]{16}$/.test(log.game_hash), `${name}: log header`);
  check(log.final.state_hash === a.stateHash(), `${name}: log final hash`);
  logs[name] = a.log(true);
  const st = a.status();
  console.log(`${name}: ${st.phase} at ${st.time_ms} ms after ${steps} steps, ${assets.length} assets, log ${logs[name].length} B`);
  a.dispose(); b.dispose();
}
for (const k of ['image', 'line', 'poly', 'synth', 'music', 'wrapped', 'outlined']) {
  check(seen[k] > 0, `v0.2 examples should produce some ${k}`);
}
console.log(`v0.2 ops/audio seen: ${JSON.stringify(seen)}`);

// Logs recorded in WASM verify natively (microgame verify), and a tampered one fails.
{
  const targetDir = process.env.CARGO_TARGET_DIR || new URL('../target', here).pathname;
  const cli = join(targetDir, 'release', 'microgame');
  if (!existsSync(cli)) {
    console.log(`skipped native verify: ${cli} not built (cargo build --release -p mg-cli)`);
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'mg-log-'));
    for (const [name, text] of Object.entries(logs)) {
      const game = new URL(`../examples/${name}.json`, here).pathname;
      const good = join(dir, `${name}.json`);
      writeFileSync(good, text);
      const r = spawnSync(cli, ['verify', game, '--log', good, '--json'], { encoding: 'utf8' });
      check(r.status === 0, `${name}: native verify failed: ${r.stdout}${r.stderr}`);
      const bad = JSON.parse(text);
      bad.final.time_ms += 16;
      const badPath = join(dir, `${name}.bad.json`);
      writeFileSync(badPath, JSON.stringify(bad));
      const r2 = spawnSync(cli, ['verify', game, '--log', badPath], { encoding: 'utf8' });
      check(r2.status === 1, `${name}: a tampered log should fail verify (exit ${r2.status})`);
    }
    rmSync(dir, { recursive: true, force: true });
    console.log(`native verify: ${Object.keys(logs).length} WASM-recorded logs verified, tampered copies rejected`);
  }
}

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('ok: node smoke test passed');
