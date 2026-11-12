#!/usr/bin/env node
// Loads every genre template in headless Chrome through the real player page (static server, ?local=1&template=),
// plays a few seconds with synthetic pointer input, and checks there are no page errors and the play field painted.
// Usage: node scripts/browser-templates-check.mjs [--shots <dir>] [template ...]   (Chrome path: $CHROME)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shotsAt = args.indexOf('--shots');
const shots = shotsAt >= 0 ? args.splice(shotsAt, 2)[1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const names = args.length ? args : readdirSync(join(root, 'spec/templates')).filter((f) => f.endsWith('.manifest.json')).map((f) => f.replace('.manifest.json', ''));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !existsSync(p)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(readFileSync(p));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9800 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sg-chrome-'))}`, '--no-first-run', '--disable-gpu', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
try {
  let wsUrl;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { await sleep(250); }
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result?.value;
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  for (const name of names) {
    errors.length = 0;
    await send('Page.navigate', { url: `${base}/player/index.html?local=1&template=${name}&seed=7` });
    try {
      for (let i = 0; i < 80 && (await evaluate(`document.querySelector('.screen.active')?.id`)) !== 'screen-intro'; i++) await sleep(150);
      assert.equal(await evaluate(`document.querySelector('.screen.active')?.id`), 'screen-intro', 'no intro: ' + (await evaluate(`document.getElementById('error-text').textContent`)));
      await evaluate(`document.getElementById('btn-play').click()`);
      await sleep(3600);
      const rect = await evaluate(`(() => { const c = document.getElementById('world-canvas'); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, shown: !document.getElementById('stage').hidden }; })()`);
      if (rect.shown) {
        for (let k = 0; k < 6; k++) {
          const x = rect.x + rect.w * (0.15 + 0.7 * ((k * 37) % 100) / 100);
          const y = rect.y + rect.h * (0.2 + 0.6 * ((k * 53) % 100) / 100);
          await mouse('mousePressed', x, y);
          await mouse('mouseMoved', x + 40, y + 10);
          await mouse('mouseReleased', x + 40, y + 10);
          await sleep(250);
        }
        const painted = await evaluate(`(() => { const c = document.getElementById('world-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })()`);
        assert.ok(painted > 500, `canvas looks empty (${painted} painted pixels)`);
      } else {
        await evaluate(`document.querySelector('#choices .choice')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))`);
      }
      if (shots) writeFileSync(join(shots, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
      assert.deepEqual(errors, [], 'page errors');
      const hud = await evaluate(`document.getElementById('hud-score').textContent`);
      console.log(`ok   ${name.padEnd(14)} ${rect.shown ? 'canvas' : 'quiz  '} score ${hud}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}: ${e.message}`);
    }
  }
  ws.close();
} finally {
  chrome.kill();
  server.close();
}
process.exitCode = failed ? 1 : 0;
