// Self-test, no network and no Muse key: composes games with a scripted Muse, first in-process, then
// through the real server and the real MuseClient talking to a fake OpenAI-compatible Muse.
//
//   node selftest.mjs

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose } from './src/composer.mjs';
import { ScriptedMuse, extractObject } from './src/muse.mjs';
import { loadStudio } from './src/studio.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '   -> ' + String(detail).slice(0, 300)}`);
};

const studio = loadStudio();
const catalog = studio.catalog();
check('catalog has the fragment library', catalog.fragments.length >= 30 && catalog.looks.length >= 4, `${catalog.fragments.length} fragments`);
const example = () => structuredClone(catalog.examples[0].manifest);
const brief = { intent: 'a calm game about fog over the bay', audience: 'friends', mood: ['cozy'], energy: 'low', competition: 'light' };

// ---- in-process: a first draft with a typo, repaired in one round ----
{
  const bad = example();
  const use = bad.uses.find((u) => u.params && Object.keys(u.params).length) ?? bad.uses[0];
  use.params = { ...(use.params ?? {}), zzz_not_a_param: 1 };
  const muse = new ScriptedMuse([bad, example()]);
  const events = [];
  const out = await compose({ request: 'a calm fog game', brief }, { studio, muse, onEvent: (e) => events.push(e) });
  const kinds = events.map((e) => e.kind);
  check('a typo is repaired, then gated and wrapped', kinds.includes('repairing') && kinds.includes('playtested') && kinds.at(-1) === 'done', kinds.join(','));
  check('events carry readable summaries', events.every((e) => typeof e.summary === 'string' && e.summary.length > 0), JSON.stringify(events.map((e) => e.summary)));
  check('the repair prompt names the problem', muse.prompts.length === 2 && /[AE]_[A-Z_]+/.test(muse.prompts[1]), muse.prompts[1]?.slice(-300));
  const m = out.manifest;
  check('the manifest is a microgame with its game stored as text', m.formula === 'microgame' && typeof m.content?.game_json === 'string' && typeof m.content?.authoring_json === 'string', Object.keys(m));
  check('the game passed the five-bot gate', out.stats.passedGate === true && out.gate.passed === true, JSON.stringify(out.gate));
  check('stats count the calls and the repair', out.stats.museCalls === 2 && out.stats.repairRounds === 1 && out.stats.firstDraftValid === false, JSON.stringify(out.stats));
  check('the id is mg-<slug>-<suffix>', /^mg-[a-z0-9-]+-[a-z0-9]{4}$/.test(m.id), m.id);
  check('the studio stamp is on the manifest', Array.isArray(m.studio?.models) && m.studio.created_at && m.studio.offline === false, JSON.stringify(m.studio));
}

// ---- in-process: a fenced reply with prose around it expands as is ----
{
  const fenced = 'Here you go:\n```json\n' + JSON.stringify(example(), null, 2) + '\n```\nEnjoy!';
  const out = await compose({ request: 'x', brief }, { studio, muse: new ScriptedMuse([fenced]) });
  check('a fenced reply with prose is accepted', out.stats.firstDraftValid === true && out.stats.museCalls === 1, JSON.stringify(out.stats));
}

// ---- in-process: Muse never produces a valid game ----
{
  const events = [];
  let err;
  try {
    await compose({ request: 'x', brief }, { studio, muse: new ScriptedMuse([{ uses: 7 }]), onEvent: (e) => events.push(e) });
  } catch (e) {
    err = e;
  }
  check('a game that never validates fails after the repair rounds', err?.name === 'GenerationError' && events.filter((e) => e.kind === 'repairing').length === 3 && events.at(-1).kind === 'failed', err?.message);
}

check('extractObject finds fenced and padded JSON', extractObject('```json\n{"a":1}\n```')?.a === 1 && extractObject('hi {"a":2} bye')?.a === 2 && extractObject('nope') === null);

// ---- end to end: the real server and MuseClient against a fake Muse API ----
{
  const calls = [];
  const replies = [JSON.stringify(example())];
  const fakeMuse = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'fake-muse-1', choices: [{ message: { role: 'assistant', content: replies[0] }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise((r) => fakeMuse.listen(0, '127.0.0.1', r));
  const museURL = `http://127.0.0.1:${fakeMuse.address().port}/v1`;
  const port = 18991;
  const child = spawn(process.execPath, [join(here, 'server.mjs')], {
    env: { ...process.env, PORT: String(port), MUSE_API_KEY: 'test-key-not-real', MUSE_BASE_URL: museURL, GENERATOR_MAX_CONCURRENT: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      ready = r.ok && (await r.json()).museConfigured === true;
    } catch {}
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  check('server starts and reports Muse configured', ready);
  if (ready) {
    const res = await fetch(`http://127.0.0.1:${port}/compose`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: 'a calm fog game', brief: { intent: 'fog', mood: ['cozy'] } }),
    });
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    const result = lines.find((l) => l.type === 'result');
    check('POST /compose streams events then a result', res.status === 200 && lines.filter((l) => l.type === 'event').length >= 3 && result?.manifest?.formula === 'microgame', JSON.stringify(lines.map((l) => l.type)));
    check('Muse got a Bearer key, JSON mode and the chat path', calls[0]?.url === '/v1/chat/completions' && calls[0].auth === 'Bearer test-key-not-real' && calls[0].body.response_format?.type === 'json_object' && calls[0].body.max_tokens >= 4000, JSON.stringify(calls[0] && { url: calls[0].url, auth: calls[0].auth }));
    check('the key never appears in the output', !JSON.stringify(lines).includes('test-key-not-real'));
    const bad = await fetch(`http://127.0.0.1:${port}/compose`, { method: 'POST', body: '{"request":""}' });
    check('an empty request is a 400', bad.status === 400, bad.status);
  }
  child.kill();
  fakeMuse.close();
}

// ---- without a key the server says so ----
{
  const port = 18992;
  const env = { ...process.env, PORT: String(port) };
  delete env.MUSE_API_KEY;
  const child = spawn(process.execPath, [join(here, 'server.mjs')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${port}/healthz`)).ok; } catch {}
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  const r = up ? await fetch(`http://127.0.0.1:${port}/compose`, { method: 'POST', body: '{"request":"a game"}' }) : null;
  check('without MUSE_API_KEY /compose is a 503', r?.status === 503, r?.status);
  child.kill();
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
