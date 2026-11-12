#!/usr/bin/env node
// Plays a game in headless Chrome through the real player page and checks the browser's own
// POST /plays is verified by the server. Usage: node browser-play-check.mjs <game_id> [--base http://localhost:8787]
// Chrome path: $CHROME or the macOS default.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const gameId = process.argv[2];
const baseArg = process.argv.indexOf('--base');
const BASE = baseArg > 0 ? process.argv[baseArg + 1] : 'http://localhost:8787';
assert.ok(gameId, 'usage: browser-play-check.mjs <game_id>');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sg-chrome-'))}`,
  '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* chrome not ready */
    }
    await sleep(250);
  }
  throw new Error('chrome did not start');
}

try {
  const ws = new WebSocket(await targets());
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const responses = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Network.responseReceived') responses.push(msg.params);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;

  await send('Network.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `${BASE}/player/index.html?game=${gameId}` });
  for (let i = 0; i < 80 && (await evaluate(`document.querySelector('.screen.active')?.id`)) !== 'screen-intro'; i++) await sleep(250);
  assert.equal(await evaluate(`document.querySelector('.screen.active')?.id`), 'screen-intro', 'player did not reach the intro screen: ' + (await evaluate(`document.getElementById('error-text').textContent`)));
  const title = await evaluate(`document.getElementById('intro-title').textContent`);
  await evaluate(`document.getElementById('btn-play').click()`);
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const screen = await evaluate(`document.querySelector('.screen.active')?.id`);
    if (screen === 'screen-result') break;
    if (screen === 'screen-game') {
      // tap the first idle choice (pointerdown, like a finger)
      await evaluate(`(() => { const b = document.querySelector('#choices .choice:not(.correct):not(.wrong):not(.dim)'); if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); })()`);
      n++;
    }
    await sleep(350);
  }
  assert.equal(await evaluate(`document.querySelector('.screen.active')?.id`), 'screen-result', 'game did not finish');
  const score = await evaluate(`document.getElementById('result-score').textContent`);
  await sleep(1500);
  const wasm = responses.find((r) => r.response.url.endsWith('.wasm'));
  assert.ok(wasm && wasm.response.mimeType === 'application/wasm', 'wasm mime: ' + (wasm && wasm.response.mimeType));
  const plays = responses.find((r) => /\/api\/games\/[^/]+\/plays$/.test(r.response.url));
  assert.ok(plays, 'browser did not POST /plays');
  const body = JSON.parse((await send('Network.getResponseBody', { requestId: plays.requestId })).result.body);
  assert.equal(body.verified, true, 'play not verified: ' + JSON.stringify(body).slice(0, 200));
  console.log(`browser play ok: "${title}" score ${score}, verified=${body.verified}, rank=${body.rank}, wasm mime ${wasm.response.mimeType}`);
  ws.close();
} catch (e) {
  console.error('BROWSER CHECK FAIL:', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}
