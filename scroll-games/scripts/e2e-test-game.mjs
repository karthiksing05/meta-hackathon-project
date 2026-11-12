#!/usr/bin/env node
// End-to-end check of the live Scroll Games pipeline:
//   start server -> brief -> generate (SSE, live Muse) -> validate -> play headlessly in the wasm runtime
//   -> POST the play (server replays it with sgtool) -> publish -> challenge -> /c/<id> redirect.
//
// Usage: node scripts/e2e-test-game.mjs [--no-start] [--keep-running] [--cache-check]
//   --no-start      use a server that is already running on $SG_BASE (default http://localhost:8787)
//   --keep-running  leave the server we started running (default: stop it at the end)
//   --cache-check   also generate the same brief again and assert the cache answers in < 100 ms
// Env: SG_BASE, E2E_PROMPT, E2E_TITLE (the creator's edit of the brief's title idea; default "Lisbon Trip Trivia", set it empty to keep
//      the model's title. Editing the brief means generation cannot reuse the speculative job, so timings are the conservative case).
// Needs MUSE_API_KEY in the repo-root .env (read by the server, never by this script).

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = new Set(process.argv.slice(2));
const BASE = process.env.SG_BASE || 'http://localhost:8787';
const PROMPT = process.env.E2E_PROMPT || 'A trivia game about our Lisbon trip photos';
const TITLE = process.env.E2E_TITLE ?? 'Lisbon Trip Trivia';
const timings = [];
const T0 = performance.now();

function step(name, ms, extra = '') {
  timings.push({ name, ms: Math.round(ms), extra });
  console.log(`  ${name.padEnd(28)} ${String(Math.round(ms)).padStart(6)} ms ${extra}`);
}

async function timed(name, fn, extraFn) {
  const t = performance.now();
  const r = await fn();
  step(name, performance.now() - t, extraFn ? extraFn(r) : '');
  return r;
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// ---- server ---------------------------------------------------------------------------------

let child = null;

async function startServer() {
  const bin = join(tmpdir(), 'sg-e2e-server');
  const build = spawnSync('go', ['build', '-o', bin, './cmd/server'], { cwd: join(root, 'server'), stdio: 'inherit' });
  assert.equal(build.status, 0, 'go build failed');
  const port = new URL(BASE).port || '8787';
  child = spawn(bin, [], { cwd: join(root, 'server'), env: { ...process.env, SG_ADDR: `:${port}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 100; i++) {
    try {
      const h = await fetch(BASE + '/api/health');
      if (h.ok) return h.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

function stopServer() {
  if (child && !args.has('--keep-running')) child.kill('SIGTERM');
}

// ---- headless play through the wasm runtime -------------------------------------------------

async function loadRuntime() {
  const pkg = join(root, 'player', 'pkg');
  const mod = await import(join(pkg, 'sg_runtime.js'));
  mod.initSync({ module: readFileSync(join(pkg, 'sg_runtime_bg.wasm')) });
  return mod;
}

// Plays every question: waits 600 ms into a round, then taps the correct label (every 4th question is answered wrong).
function playHeadless(rt, game, seed) {
  const manifest = JSON.stringify(game.manifest);
  const content = JSON.stringify(game.content);
  const session = new rt.Session(manifest, content, seed);
  const byPrompt = new Map(game.content.items.map((q) => [q.prompt, q]));
  session.start();
  let round = -1;
  let roundMs = 0;
  let answered = false;
  let asked = 0;
  for (let guard = 0; guard < 60 * 60 * 10; guard++) {
    session.step(50);
    const view = JSON.parse(session.view());
    if (view.state === 'ended') break;
    if (view.state !== 'playing') continue;
    if (view.round !== round) {
      round = view.round;
      roundMs = 0;
      answered = false;
    }
    roundMs += 50;
    if (!answered && roundMs >= 600) {
      const q = byPrompt.get(view.prompt);
      assert.ok(q, `prompt not found in content: ${view.prompt}`);
      const right = q.choices[q.answer];
      let index = view.choices.findIndex((c) => c.label === right);
      assert.ok(index >= 0, 'correct choice not shown');
      asked++;
      if (asked % 4 === 0) index = (index + 1) % view.choices.length;
      session.input(JSON.stringify({ type: 'choice', index }));
      answered = true;
    }
  }
  const result = JSON.parse(session.result());
  assert.ok(result.score > 0, 'headless play scored 0');
  return result;
}

// ---- main -----------------------------------------------------------------------------------

async function main() {
  console.log(`Scroll Games e2e against ${BASE}`);
  let health;
  if (args.has('--no-start')) health = await api('/api/health');
  else health = await timed('server start', startServer);
  assert.ok(health.muse.configured, 'MUSE_API_KEY is not configured: live Muse is required');
  assert.ok(health.sgtool, 'sgtool is not available: build the runtime first (scripts/build-runtime.sh)');
  const usage0 = await api('/api/usage');

  const media = await api('/api/media');
  const groups = await api('/api/groups');
  const lisbon = groups.find((g) => /lisbon/i.test(g.name)) || groups[0];
  const ids = media.filter((m) => m.group_id === lisbon.id).slice(0, 8).map((m) => m.id);
  assert.equal(ids.length, 8, 'need 8 media items in the Lisbon group');
  console.log(`  group ${lisbon.id} media ${ids.join(',')}`);

  // 1. brief
  const tb = performance.now();
  const br = await api('/api/briefs', { method: 'POST', body: JSON.stringify({ prompt: PROMPT, media_ids: ids, level: 'remix', opt_in_personal_media: true }) });
  step('brief', performance.now() - tb, `source=${br.source} cached=${br.cached}`);
  assert.equal(br.source, 'muse', 'brief did not come from Muse');
  const brief = br.brief;
  if (TITLE) brief.title_idea = TITLE;
  for (const k of ['intent', 'audience', 'mood', 'energy', 'competition', 'content_source', 'limits', 'title_idea', 'template', 'level', 'glue_ideas']) {
    assert.ok(k in brief, `brief lacks ${k}`);
  }

  // 2. generate over SSE
  const tg = performance.now();
  const res = await fetch(BASE + '/api/games/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: PROMPT, brief, media_ids: ids }) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
  const decoder = new TextDecoder();
  let buf = '';
  let firstEventMs = null;
  const stageDone = {};
  let game = null;
  let evName = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.startsWith('event:')) evName = line.slice(6).trim();
      else if (line.startsWith('data:')) {
        const data = JSON.parse(line.slice(5));
        if (firstEventMs === null) firstEventMs = performance.now() - tg;
        if (evName === 'stage' && data.status === 'done') stageDone[data.stage] = { server_ms: data.ms, at_ms: Math.round(performance.now() - tg) };
        if (evName === 'error') throw new Error('generate failed: ' + data.message);
        if (evName === 'done') game = data.game;
      }
    }
  }
  assert.ok(game, 'no done event');
  step('generate (to done)', performance.now() - tg, `first stage event after ${Math.round(firstEventMs)} ms`);
  for (const [name, s] of Object.entries(stageDone)) step(`  stage ${name}`, s.at_ms, `(server reports ${s.server_ms} ms)`);
  console.log(`  game ${game.id} "${game.title}" source=${game.gen.source} cost=$${game.gen.cost_usd.toFixed(4)}`);
  assert.equal(game.gen.source, 'muse', `generation fell back (${game.gen.source}): ${(game.gen.notes || []).join(' | ')}`);
  assert.equal(game.status, 'draft');

  // 3. validation (independent of the server: same wasm the player runs)
  const rt = await loadRuntime();
  const v = JSON.parse(rt.validate(JSON.stringify(game.manifest), JSON.stringify(game.content)));
  assert.equal(v.ok, true, 'validate failed: ' + JSON.stringify(v.errors));
  assert.ok(game.manifest.concepts.some((c) => c.id === 'flow.session'));
  assert.ok(game.content.items.every((q) => q.choices.length === 4 && q.answer >= 0 && q.answer < 4));
  assert.ok(game.content.items.some((q) => q.media_url), 'content has no media_url');
  console.log(`  validate ok (${v.warnings.length} warnings), ${game.content.items.length} questions, ${game.manifest.glue.length} glue`);

  // 4. the player fetches the draft the same way
  const fetched = (await api(`/api/games/${game.id}`)).game;
  assert.equal(fetched.id, game.id);
  const player = await fetch(`${BASE}/player/index.html?game=${game.id}`);
  assert.equal(player.status, 200);
  const wasm = await fetch(`${BASE}/player/pkg/sg_runtime_bg.wasm`);
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');

  // 5. play headlessly and submit
  const seed = 424242;
  const result = await timed('headless play (wasm)', async () => playHeadless(rt, game, seed), (r) => `score=${r.score} ticks=${r.ticks}`);
  const play = await timed('POST /plays', () => api(`/api/games/${game.id}/plays`, { method: 'POST', body: JSON.stringify({ seed: result.seed, inputs: result.inputs, score: result.score, ticks: result.ticks }) }), (p) => `verified=${p.verified} rank=${p.rank}`);
  assert.equal(play.verified, true, 'server replay did not verify the score');

  // 6. publish, challenge, redirect
  const pub = await timed('publish', () => api(`/api/games/${game.id}/publish`, { method: 'POST', body: '{}' }));
  assert.equal(pub.game.status, 'published');
  assert.ok(pub.feed_item && pub.feed_item.game.id === game.id);
  const ch = await timed('challenge', () => api('/api/challenges', { method: 'POST', body: JSON.stringify({ game_id: game.id, play_id: play.play.id }) }), (c) => c.url);
  assert.ok(ch.url.endsWith('/c/' + ch.challenge.id));
  const red = await timed('GET /c/<id>', () => fetch(`${BASE}/c/${ch.challenge.id}`, { redirect: 'manual' }));
  assert.equal(red.status, 302);
  const loc = red.headers.get('location');
  assert.ok(loc.includes(`game=${game.id}`) && loc.includes(`seed=${seed}`) && loc.includes(`challenge=${ch.challenge.id}`), loc);
  const feed = await api('/api/feed');
  assert.ok(feed.some((f) => f.game && f.game.id === game.id), 'published game missing from feed');

  if (args.has('--cache-check')) {
    const t = performance.now();
    const again = await fetch(BASE + '/api/games/generate?stream=0', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: PROMPT, brief, media_ids: ids }) });
    const g2 = (await again.json()).game;
    const ms = performance.now() - t;
    step('generate (cache hit)', ms, `source=${g2.gen.source}`);
    assert.equal(g2.gen.source, 'cache');
    assert.ok(ms < 100, `cache hit took ${Math.round(ms)} ms`);
  }

  const usage1 = await api('/api/usage');
  const total = performance.now() - T0;
  console.log('\nSUMMARY');
  console.log(`  game id        ${game.id}  ("${game.title}")`);
  console.log(`  brief + generate  ${timings.find((t) => t.name === 'brief').ms + timings.find((t) => t.name === 'generate (to done)').ms} ms`);
  console.log(`  verified       ${play.verified}   score ${result.score}   rank ${play.rank}`);
  console.log(`  challenge url  ${ch.url}`);
  console.log(`  cost this run  $${(usage1.spent_usd - usage0.spent_usd).toFixed(4)}   (spent so far $${usage1.spent_usd.toFixed(4)} of $${usage1.cap_usd})`);
  console.log(`  total          ${Math.round(total)} ms`);
  console.log('E2E PASS');
}

main()
  .then(() => stopServer())
  .catch((e) => {
    console.error('E2E FAIL:', e.message);
    stopServer();
    process.exitCode = 1;
  });
