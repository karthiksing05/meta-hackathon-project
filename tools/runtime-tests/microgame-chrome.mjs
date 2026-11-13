#!/usr/bin/env node
// Plays microgame seeds in the real host page (bubble-host.html) in headless Chrome, the way the
// app does: BubbleHost.prepare + activate with the seed manifest, then real touch input through
// the DevTools protocol. Checks the bridge messages (ready, phase playing, score, result) and
// writes a screenshot per seed. No npm packages: Chrome's DevTools protocol over Node's WebSocket.
//
//   node tools/runtime-tests/microgame-chrome.mjs [seed-id ...] [--out /tmp/mg-chrome]
//
// Chrome isn't WebKit, so this doesn't replace a phone check, but it runs the same JS, WASM and
// canvas code the app runs.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST = join(ROOT, 'FacebookClone', 'Bubbles', 'Runtime', 'web', 'bubble-host.html');
const SEEDS = join(ROOT, 'FacebookClone', 'Bubbles', 'Seeds');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : '/tmp/mg-chrome';
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');

// What each seed is played with: taps on points, drags, or flicks (playfield-relative 0..1).
const PLANS = {
  'mg-prism-breaker': [{ drag: [[0.5, 0.88], [0.2, 0.88], [0.8, 0.88], [0.4, 0.88]] }],
  'mg-number-merge': [{ flick: 'left' }, { flick: 'up' }, { flick: 'right' }, { flick: 'down' }, { flick: 'left' }],
  'mg-postcard-pairs': [{ tap: [0.3, 0.45] }, { tap: [0.7, 0.45] }, { tap: [0.3, 0.6] }, { tap: [0.7, 0.6] }],
  'mg-gust-glider': [{ tap: [0.5, 0.5] }, { tap: [0.5, 0.5] }, { tap: [0.5, 0.5] }],
  'mg-kite-day-detour': [{ tap: [0.5, 0.75] }, { tap: [0.5, 0.85] }],
};
const targets = ids.length ? ids : Object.keys(PLANS);
// Any other game: taps spread over the playfield, a drag and two flicks, about 6 s of play.
const GENERIC_PLAN = [
  { tap: [0.5, 0.62] }, { tap: [0.5, 0.72] }, { tap: [0.3, 0.55] }, { tap: [0.7, 0.55] },
  { drag: [[0.5, 0.8], [0.25, 0.8], [0.75, 0.8]] }, { tap: [0.5, 0.5] }, { flick: 'left' },
  { tap: [0.4, 0.66] }, { tap: [0.6, 0.78] }, { flick: 'up' }, { tap: [0.5, 0.6] }, { tap: [0.5, 0.85] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(out, { recursive: true });
const profile = join(out, 'profile');
rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`,
  '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

let ws, nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

let failures = 0;
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page'); } catch { /* starting */ }
  }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  const W = 390, H = 844;
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.__msgs = []; window.webkit = { messageHandlers: { bubble: { postMessage: (m) => window.__msgs.push(m) } } };',
  });

  const touch = (type, x, y) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  // Playfield-relative point → page point, from the canvas the runtime sized.
  const pt = async (fx, fy) => evaluate(`(() => { const r = document.getElementById('bubble-canvas').getBoundingClientRect(); return [r.left + ${fx} * r.width, r.top + ${fy} * r.height]; })()`);

  for (const id of targets) {
    // A seed id, or a path to a manifest file (e.g. a wrapped gold game).
    const manifest = JSON.parse(readFileSync(id.endsWith('.json') ? id : join(SEEDS, `bubble-seed-${id}.json`), 'utf8'));
    await send('Page.navigate', { url: pathToFileURL(HOST).href });
    await sleep(1200);
    const prep = JSON.parse(await evaluate(`BubbleHost.prepare(${JSON.stringify(JSON.stringify({ key: id, manifest, mode: 'play' }))})`));
    const act = JSON.parse(await evaluate(`BubbleHost.activate(${JSON.stringify(id)}, ${JSON.stringify(JSON.stringify({ mode: 'play', muted: true }))})`));
    await sleep(600);
    const [cx, cy] = await pt(0.5, 0.5);
    await touch('touchStart', cx, cy); await touch('touchEnd', cx, cy); // the intro card's "Tap to play"
    await sleep(900);
    for (const step of PLANS[id] || GENERIC_PLAN) {
      if (step.tap) {
        const [x, y] = await pt(...step.tap);
        await touch('touchStart', x, y); await sleep(40); await touch('touchEnd', x, y);
      } else if (step.drag) {
        const [x0, y0] = await pt(...step.drag[0]);
        await touch('touchStart', x0, y0);
        for (const p of step.drag.slice(1)) {
          const [x, y] = await pt(...p);
          for (let k = 1; k <= 8; k++) { await touch('touchMove', x0 + ((x - x0) * k) / 8, y0 + ((y - y0) * k) / 8); await sleep(16); }
        }
        await touch('touchEnd', 0, 0);
      } else if (step.flick) {
        const d = { left: [-0.25, 0], right: [0.25, 0], up: [0, -0.15], down: [0, 0.15] }[step.flick];
        const [x0, y0] = await pt(0.5, 0.5);
        const [x1, y1] = await pt(0.5 + d[0], 0.5 + d[1]);
        await touch('touchStart', x0, y0);
        for (let k = 1; k <= 4; k++) { await touch('touchMove', x0 + ((x1 - x0) * k) / 4, y0 + ((y1 - y0) * k) / 4); await sleep(16); }
        await touch('touchEnd', 0, 0);
      }
      await sleep(450);
    }
    await sleep(800);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const name = id.endsWith('.json') ? id.split('/').pop().replace(/\.json$/, '') : id;
    writeFileSync(join(out, `${name}.png`), Buffer.from(shot.data, 'base64'));
    const msgs = ((await evaluate('window.__msgs')) || []).map((m) => (typeof m === 'string' ? JSON.parse(m) : m));
    const types = msgs.map((m) => m.type + (m.type === 'phase' ? ':' + m.name : ''));
    const errors = msgs.filter((m) => m.type === 'error');
    const scores = msgs.filter((m) => m.type === 'score').map((m) => m.value);
    const playing = types.includes('phase:playing');
    const ok = prep.ok && act.ok && types.includes('ready') && playing && errors.length === 0;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}: prepare ${prep.ms} ms${prep.ok ? '' : ' ' + prep.error}, activate ${act.ok ? 'ok' : act.error}, ` +
      `phases ${[...new Set(types.filter((t) => t.startsWith('phase')))].join(' ')}, scores ${scores.slice(-3).join(',') || '-'}` +
      (errors.length ? `, errors: ${errors.map((e) => e.message).join('; ')}` : ''));
  }
} finally {
  try { ws?.close(); } catch { /* closing */ }
  chrome.kill();
}
console.log(`screenshots in ${out}`);
process.exit(failures ? 1 : 0);
