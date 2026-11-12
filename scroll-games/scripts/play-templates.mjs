#!/usr/bin/env node
// Plays every genre template headlessly through the wasm build with a deterministic random input bot,
// then replays the recorded inputs through the wasm replay() and the native sgtool and checks all three agree.
// Usage: node scripts/play-templates.mjs [template ...]
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'player/pkg');
const { initSync, Session, replay } = await import(join(pkg, 'sg_runtime.js'));
initSync({ module: readFileSync(join(pkg, 'sg_runtime_bg.wasm')) });
const sgtool = join(root, 'runtime/target/release/sgtool');

const dir = join(root, 'spec/templates');
const names = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith('.manifest.json')).map((f) => f.replace('.manifest.json', ''));

let lcg = 12345;
const rnd = () => ((lcg = (lcg * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

let failed = 0;
for (const name of names) {
  const manifest = readFileSync(join(dir, `${name}.manifest.json`), 'utf8');
  const content = readFileSync(join(dir, name === 'quiz' ? 'trip-trivia.content.json' : `${name}.content.json`), 'utf8');
  const seed = 4242;
  try {
    const s = new Session(manifest, content, seed);
    s.start();
    let ticks = 0;
    for (; ticks < 9000; ticks++) {
      s.step(1000 / 60);
      const v = JSON.parse(s.view());
      if (v.state === 'ended') break;
      if (v.state !== 'playing' || ticks % 5) continue;
      const kind = Math.floor(rnd() * 5);
      const x = Math.round(rnd() * 360);
      const y = Math.round(rnd() * 600);
      const w = v.world;
      if (kind === 0 && v.choices.length) s.input(JSON.stringify({ type: 'choice', index: Math.floor(rnd() * v.choices.length) }));
      else if (kind === 1) s.input(JSON.stringify({ type: 'tap', x, y }));
      else if (kind === 2) s.input(JSON.stringify({ type: 'swipe', dx: Math.round(rnd() * 160 - 80), dy: Math.round(rnd() * 160 - 80), x, y }));
      else if (kind === 3) {
        s.input(JSON.stringify({ type: 'drag', phase: 'start', x, y }));
        s.input(JSON.stringify({ type: 'drag', phase: 'move', x: 360 - x, y }));
        s.input(JSON.stringify({ type: 'drag', phase: 'end', x: 360 - x, y }));
      } else if (w && w.overlay && w.overlay.button) s.input(JSON.stringify({ type: 'ack' }));
    }
    const result = JSON.parse(s.result());
    const inputs = JSON.stringify(result.inputs);
    const viaWasm = JSON.parse(replay(manifest, content, seed, inputs));
    const viaNative = JSON.parse(execFileSync(sgtool, ['replay'], { input: JSON.stringify({ manifest: JSON.parse(manifest), content: JSON.parse(content), seed, inputs: result.inputs }) }).toString());
    const ended = JSON.parse(s.view()).state === 'ended';
    if (ended) {
      assert.equal(viaWasm.score, result.score, 'wasm replay score');
      assert.equal(viaWasm.ticks, result.ticks, 'wasm replay ticks');
    }
    assert.equal(viaNative.score, viaWasm.score, 'native vs wasm score');
    assert.equal(viaNative.ticks, viaWasm.ticks, 'native vs wasm ticks');
    console.log(`ok   ${name.padEnd(14)} score ${String(result.score).padStart(5)} ticks ${String(result.ticks).padStart(5)} inputs ${String(result.inputs.length).padStart(4)} ended=${ended} replay verified (wasm + native)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
