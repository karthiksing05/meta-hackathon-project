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
    if (j.op === 'image') {
      check(b.flip_x === j.flip_x && b.flip_y === j.flip_y, `${where}: flips`);
      for (const k of ['src_x', 'src_y', 'src_w', 'src_h']) {
        check((k in j) ? near(b[k], j[k]) : b[k] === undefined, `${where}: ${k} ${b[k]} vs ${j[k]}`);
      }
    }
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

// The same logs verify in WASM (engine.verify, what a server or phone calls), and tampering fails.
{
  for (const [name, text] of Object.entries(logs)) {
    const game = readFileSync(new URL(`../examples/${name}.json`, here), 'utf8');
    const v = engine.verify(game, text);
    check(v.ok && v.game_hash_ok && v.problems.length === 0, `${name}: engine.verify rejected a good log: ${JSON.stringify(v.problems)}`);
    check(v.recomputed?.score === JSON.parse(text).final.score, `${name}: recomputed score differs`);
    const bad = JSON.parse(text);
    bad.final.score = (bad.final.score ?? 0) + 100;
    const vb = engine.verify(game, bad);
    check(!vb.ok && vb.problems.some((p) => p.includes('final.score')), `${name}: a raised score should fail engine.verify`);
    check(!engine.verify(game + ' ', text).game_hash_ok, `${name}: another game file should fail the hash check`);
    check(!engine.verify(game, '{"format":"nope"}').ok, `${name}: a malformed log should fail`);
    // `result`: the replay's end state, all of it or just the names asked for (group_play.result.state).
    check(v.result && typeof v.result === 'object' && !Array.isArray(v.result), `${name}: verify should return the end state as result`);
    const names = Object.keys(v.result);
    if (names.length) {
      const one = engine.verify(game, text, [names[0], 'no_such_var']);
      check(JSON.stringify(one.result) === JSON.stringify({ [names[0]]: v.result[names[0]], no_such_var: null }),
        `${name}: verify(state) should pick the named values: ${JSON.stringify(one.result)}`);
      check(JSON.stringify(engine.verify(game, text, names).result) === JSON.stringify(v.result), `${name}: the same replay gives the same end state`);
    }
  }
  console.log(`engine.verify: ${Object.keys(logs).length} logs verified in WASM, raised scores and other games rejected`);
}

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

// Sounds that load before there's an audio context (muted, or before the first tap) are decoded
// once one exists, instead of failing for the whole run (Karthik's harness-gap request).
{
  const { AssetStore, MusicPlayer } = await import('./render.js');
  let ctx = null;
  const decoded = [];
  const fakeCtx = {
    state: 'suspended',
    decodeAudioData(bytes, ok) { decoded.push(bytes.byteLength); const buf = { length: bytes.byteLength }; ok(buf); return Promise.resolve(buf); },
  };
  const wav = 'data:audio/wav;base64,' + Buffer.from('RIFF0000WAVEfmt ').toString('base64');
  const store = new AssetStore([{ id: 0, name: 'beep', kind: 'sound', src: wav }], { audioCtx: () => ctx });
  await store.ready;
  check(store.failed.length === 0 && !store.buffers[0] && store.pending.length === 1, 'a sound with no audio context waits instead of failing');
  store.decodePending();
  check(store.pending.length === 1, 'still waiting while there is no context');
  ctx = fakeCtx;
  new MusicPlayer().sync(null, { playing: true, asset: 0, volume: 1 }, store);
  await new Promise((r) => setTimeout(r, 0));
  check(store.buffers[0] && store.pending.length === 0 && decoded.length === 1, 'the waiting sound decodes once a context exists (even suspended)');
  console.log('assets: sounds that load before audio starts decode later');
}

// ------------------------------------------------------------ v0.2.2 ----
// Clipping groups, image source rects and shape hits, end to end through the
// WASM build.
{
  const pic = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 24'><rect width='32' height='24' fill='#f80'/></svg>";
  const src = JSON.stringify({
    format: 'microgame/0.2',
    meta: { title: 'Clip test', instructions: '' },
    assets: { pic: { svg: pic, w: 32, h: 24 } },
    state: {
      inside: { type: 'int', init: '0' },
      tri: { type: 'int', init: '0' },
    },
    inputs: { hit_inside: {}, hit_tri: {} },
    rules: [{ on: 'hit_inside', do: [{ incr: 'inside' }] }, { on: 'hit_tri', do: [{ incr: 'tri' }] }],
    objectives: { time_limit: '60s' },
    presentation: {
      canvas: { w: 360, h: 640, background: '#000' },
      root: { node: 'group', children: [
        { node: 'group', x: 20, y: 40, w: 100, h: 50, clip: true, children: [
          { node: 'image', asset: 'pic', x: -10, w: 200, h: 150, src_x: 8, src_y: 6, src_w: 16, src_h: 12 },
          { node: 'rect', w: 200, h: 200, fill: '#FFFFFF20', on_tap: { input: 'hit_inside' } },
        ] },
        { node: 'poly', x: 200, y: 300, points: [[0, 0], [60, 0], [30, 60]], hit: 'shape', fill: '#0F0',
          on_tap: { input: 'hit_tri' } },
        { node: 'image', asset: 'pic', x: 0, y: 500 },
      ] },
    },
  });
  const diags = engine.validate(src);
  check(!diags.some((d) => d.severity === 'error'), `clip test should validate: ${JSON.stringify(diags.slice(0, 3))}`);
  const bad = engine.validate(src.replace('"src_w":16', '"src_w":0').replace('"w":100,"h":50,', ''));
  check(bad.some((d) => d.at.endsWith('/src_w') && /greater than 0/.test(d.message)), 'src_w 0 is a validation error');
  check(bad.some((d) => d.at.endsWith('/clip') && /needs the group's box/.test(d.message)), 'clip without w/h is a validation error');

  const a = engine.load(src, 1), b = engine.load(src, 1);
  const bin = a.frame(), js = b.frameJSON();
  compareFrames('clip test', 0, bin, js);
  check(JSON.stringify(js.ops.map((o) => o.op)) === JSON.stringify(['clip', 'image', 'rect', 'unclip', 'poly', 'image']),
    `clip test ops: ${js.ops.map((o) => o.op)}`);
  check(JSON.stringify(js.ops[0]) === JSON.stringify({ op: 'clip', x: 20, y: 40, w: 100, h: 50 }), `clip op: ${JSON.stringify(js.ops[0])}`);
  check(js.ops[1].src_w === 16 && js.ops[1].src_x === 8 && !('src_x' in js.ops[5]), 'only the cropped image has src fields');
  check(bin.ops[5].src_w === undefined, 'the pooled image op lost its src fields');
  // Taps: inside the clip hits the rect; on the rect but outside the clip hits nothing;
  // the triangle only inside its shape.
  for (const g of [a, b]) {
    for (const [x, y] of [[25, 45], [25, 120], [230, 310], [203, 350]]) { g.pointer('down', x, y); g.pointer('up', x, y); }
    g.step(16);
  }
  const st = a.state();
  check(st.inside === 1 && st.tri === 1, `clip/shape taps: ${JSON.stringify({ inside: st.inside, tri: st.tri })}`);
  const targets = a.hitTargets();
  check(targets.some((t) => t.x === 20 && t.y === 40 && t.w === 100 && t.h === 50), `clipped hit target: ${JSON.stringify(targets)}`);
  check(a.diagnostics().length === 0, `clip test diagnostics ${JSON.stringify(a.diagnostics())}`);

  // The renderer: clip ops become save/clip/restore, the crop the 9-argument drawImage.
  const { drawFrame, drawImageSrc } = await import('./render.js');
  const calls = [];
  const ctx = new Proxy({ canvas: { width: 360, height: 640 } }, {
    get: (t, k) => (k in t ? t[k] : (...args) => calls.push([k, args])),
  });
  const img = { naturalWidth: 64, naturalHeight: 48 }; // a 2x raster of the 32x24 asset
  const assets = { images: [{ img, ok: true, frames: 1, cols: 1, w: 32, h: 24 }] };
  drawFrame(ctx, bin, assets);
  const names = calls.map((c) => c[0]);
  check(names.filter((n) => n === 'save').length === names.filter((n) => n === 'restore').length, `save/restore balance: ${names}`);
  const clipAt = names.indexOf('clip', names.indexOf('clip') + 1); // the first clip is the canvas clip
  const draws = calls.filter((c) => c[0] === 'drawImage');
  check(clipAt > 0 && names.indexOf('drawImage') > clipAt, 'the cropped image is drawn inside the clip');
  check(JSON.stringify(draws[0][1].slice(1)) === JSON.stringify([16, 12, 32, 24, 10, 40, 200, 150]), `crop drawImage: ${JSON.stringify(draws[0][1].slice(1))}`);
  check(JSON.stringify(draws[1][1].slice(1)) === JSON.stringify([0, 0, 64, 48, 0, 500, 32, 24]), `plain drawImage: ${JSON.stringify(draws[1][1].slice(1))}`);
  // A crop half past the frame's right edge draws only the part inside, into the left half of the box.
  calls.length = 0;
  drawImageSrc(ctx, assets.images[0], { x: 0, y: 0, w: 100, h: 50, src_x: 24, src_y: 0, src_w: 16, src_h: 24 }, 0, 0, 64, 48);
  check(JSON.stringify(calls[0][1].slice(1)) === JSON.stringify([48, 0, 16, 48, 0, 0, 50, 50]), `edge crop: ${JSON.stringify(calls[0] && calls[0][1].slice(1))}`);
  calls.length = 0;
  drawImageSrc(ctx, assets.images[0], { x: 0, y: 0, w: 10, h: 10, src_x: 40, src_y: 0, src_w: 8, src_h: 8 }, 0, 0, 64, 48);
  check(calls.length === 0, 'a crop entirely outside the frame draws nothing');
  a.dispose(); b.dispose();
  console.log('v0.2.2: clip ops, image crops and shape hits match between binary and JSON');
}

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('ok: node smoke test passed');
