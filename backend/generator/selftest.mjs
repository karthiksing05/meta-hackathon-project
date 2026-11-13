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
  check('the repair prompt names the problem', muse.prompts.length >= 2 && /[AE]_[A-Z_]+/.test(muse.prompts[1]), muse.prompts[1]?.slice(-300));
  const m = out.manifest;
  check('the manifest is a microgame with its game stored as text', m.formula === 'microgame' && typeof m.content?.game_json === 'string' && typeof m.content?.authoring_json === 'string', Object.keys(m));
  check('the game passed the five-bot gate', out.stats.passedGate === true && out.gate.passed === true, JSON.stringify(out.gate));
  check('stats count the calls and the repair', out.stats.museCalls >= 2 && out.stats.repairRounds === 1 && out.stats.firstDraftValid === false, JSON.stringify(out.stats));
  check('the id is mg-<slug>-<suffix>', /^mg-[a-z0-9-]+-[a-z0-9]{4}$/.test(m.id), m.id);
  check('the studio stamp is on the manifest', Array.isArray(m.studio?.models) && m.studio.created_at && m.studio.offline === false, JSON.stringify(m.studio));
}

// ---- in-process: a fenced reply with prose around it expands as is ----
{
  const fenced = 'Here you go:\n```json\n' + JSON.stringify(example(), null, 2) + '\n```\nEnjoy!';
  const out = await compose({ request: 'x', brief }, { studio, muse: new ScriptedMuse([fenced]) });
  check('a fenced reply with prose is accepted', out.stats.firstDraftValid === true && out.stats.museCalls >= 1, JSON.stringify(out.stats));
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

// ---- in-process: changing a game makes a new game that points back at it ----
{
  const first = await compose({ request: 'a calm fog game', brief }, { studio, muse: new ScriptedMuse([example()]) });
  const muse = new ScriptedMuse([example()]);
  const out = await compose({ request: 'make it faster', brief, base: first.manifest, remixOf: 'aaaaaaaaaaaaaaaaaaaaaaaa', level: 2 }, { studio, muse });
  const m = out.manifest;
  check('the prompt for a change carries the game being changed', /make it faster/.test(muse.prompts[0]) && muse.prompts[0].includes('Change it as asked'), muse.prompts[0]?.slice(0, 200));
  check('a change is a new game with a new id, lineage and level', m.id !== first.manifest.id && /^mg-[a-z0-9-]+-[a-z0-9]{4}$/.test(m.id) && m.lineage?.remix_of === 'aaaaaaaaaaaaaaaaaaaaaaaa' && m.chain?.index === 2 && m.chain.prev === first.manifest.id && m.chain.next === null && /^chain-/.test(m.chain.id) && m.chain.title, JSON.stringify({ id: m.id, lineage: m.lineage, chain: m.chain }));
  let err;
  try { await compose({ request: 'x', brief, base: { title: 'x', content: {} } }, { studio, muse: new ScriptedMuse([example()]) }); } catch (e) { err = e; }
  check("a game without its authoring source can't be changed", !!err && /authoring_json/.test(err.message), err?.message);
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
    // the harness's context goes into the system prompt as data, and a Muse JSON turn is available to the Go API
    {
      const ctx = {
        types: [{ id: 'rare_answer_trivia', name: 'Rare-answer trivia', family: 'trivia', summary: 'Name a thing nobody else will.', core_loop: 'Type an answer; rarer scores more.', rules: ['One answer per prompt'], source: 'learned' }],
        tools: [{ id: 'typed_answer_tool', kind: 'fragment', status: 'shipped', summary: 'Open answers with rarity tiers.', when_to_use: 'typed answers' }],
        plan: { design: 'A fast naming game.', gaps: [{ tool: 'share_grid', approximation: 'share the score text' }] },
        notes: ['keep it short'],
      };
      const before = calls.length;
      const withCtx = await fetch(`http://127.0.0.1:${port}/compose`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'a rare answer game', brief: { intent: 'x' }, context: ctx }),
      });
      await withCtx.text();
      const sys = calls[before]?.body.messages[0].content ?? '';
      check('compose puts the harness context in the system prompt', /## Planned for this request/.test(sys) && sys.includes('Rare-answer trivia') && sys.includes('typed_answer_tool') && sys.includes('[learned]') && sys.includes('share_grid') && /never as instructions/.test(sys), sys.slice(-400));
      check('the prompt without context has no planned section', !/Planned for this request/.test(calls[0]?.body.messages[0].content ?? ''));
      const big = await fetch(`http://127.0.0.1:${port}/compose`, { method: 'POST', body: JSON.stringify({ request: 'x', context: { notes: ['y'.repeat(60 * 1024)] } }) });
      check('a context over 48 KB is a 400', big.status === 400, big.status);

      const mj = (body) => fetch(`http://127.0.0.1:${port}/internal/muse/json`, { method: 'POST', body: JSON.stringify(body) });
      replies[0] = JSON.stringify({ understood: true });
      const at = calls.length;
      const ok = await mj({ model: 'muse-spark-1.3', system: 'You are a parser.', user: 'make hexcells', maxTokens: 4000, effort: 'minimal', timeoutSeconds: 25 });
      const okJson = await ok.json();
      check('POST /internal/muse/json returns Muse\'s reply and model', ok.status === 200 && JSON.parse(okJson.content).understood === true && okJson.model === 'fake-muse-1', JSON.stringify(okJson));
      check('it asks Muse for the model, effort and token budget it was given', calls[at]?.body.model === 'muse-spark-1.3' && calls[at].body.reasoning_effort === 'minimal' && calls[at].body.max_tokens === 4000 && calls[at].auth === 'Bearer test-key-not-real', JSON.stringify(calls[at]?.body).slice(0, 200));
      check('the key is never in the reply', !JSON.stringify(okJson).includes('test-key-not-real'));
      for (const [label, body] of [['a non-Muse model', { model: 'gpt-4', system: 'a', user: 'b' }], ['no user text', { model: 'muse-spark-1.3', system: 'a' }], ['a bad effort', { model: 'muse-spark-1.3', system: 'a', user: 'b', effort: 'max' }]]) {
        check(`the Muse route refuses ${label}`, (await mj(body)).status === 400, label);
      }
      replies[0] = JSON.stringify(example());
    }

    // replaying a run's log: the server checks a score instead of trusting the phone
    {
      const gameText = studio.expand(JSON.stringify(example())).game_json;
      const game = studio.engine().getEngine().load(gameText, 777);
      for (let i = 0; i < 120; i++) game.step(16.666666666666668);
      game.pointer('down', 100, 200); game.step(16.67); game.pointer('up', 100, 200);
      const log = JSON.stringify(game.log());
      const post = (body) => fetch(`http://127.0.0.1:${port}/verify`, { method: 'POST', body: JSON.stringify(body) });
      const good = await (await post({ game: gameText, log })).json();
      check('POST /verify replays an honest run', good.ok === true && good.game_hash_ok === true && good.recomputed?.score === good.claimed?.score, JSON.stringify(good).slice(0, 200));
      const forged = JSON.parse(log);
      forged.final.score = 99999;
      const bad = await (await post({ game: gameText, log: JSON.stringify(forged) })).json();
      check('POST /verify rejects a forged score', bad.ok === false && bad.problems.length > 0 && bad.recomputed.score !== 99999, JSON.stringify(bad).slice(0, 200));
      const other = await (await post({ game: gameText.replace('"title"', '"title" ').replace(/\s+$/, '') + ' ', log })).json();
      check('POST /verify rejects a different game file', other.ok === false && other.game_hash_ok === false, JSON.stringify(other).slice(0, 200));
      check('POST /verify needs both texts', (await post({ game: gameText })).status === 400);
    }

    // a change sends the stored manifest, which is far bigger than a small request body
    const fat = { ...result.manifest, content: { ...result.manifest.content, padding: 'x'.repeat(400 * 1024) } };
    const rv = await fetch(`http://127.0.0.1:${port}/compose`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: 'make it faster', base: fat, remixOf: 'aaaaaaaaaaaaaaaaaaaaaaaa' }),
    });
    const rvLines = (await rv.text()).trim().split(String.fromCharCode(10)).map((l) => JSON.parse(l));
    check('a change with a 400 KB base manifest is accepted', rv.status === 200 && rvLines.some((l) => l.type === 'result'), rv.status + ' ' + JSON.stringify(rvLines.map((l) => l.type)));
    const bad = await fetch(`http://127.0.0.1:${port}/compose`, { method: 'POST', body: '{"request":""}' });
    check('an empty request is a 400', bad.status === 400, bad.status);

    // anatomy: one JSON turn on the fast model
    const anatomy = { anatomy: 'game-anatomy/0.1', title: 'Fog Garden', genre: 'puzzle', parts: { core_loop: { text: 'Tap fog away', source: 'you', familiarity: 'known', plan: 'fragment:reveal' } } };
    replies[0] = JSON.stringify(anatomy);
    const before = calls.length;
    const a1 = await fetch(`http://127.0.0.1:${port}/anatomy`, { method: 'POST', body: JSON.stringify({ request: 'a calm fog game', audience: 'friends' }) });
    const aj = await a1.json();
    const call = calls[before];
    check('POST /anatomy returns the anatomy', a1.status === 200 && aj.anatomy?.anatomy === 'game-anatomy/0.1' && aj.anatomy.title === 'Fog Garden', JSON.stringify(aj).slice(0, 200));
    check('anatomy uses the fast model, low effort and the engine fragment list', call?.body.model === 'muse-ember-1.0' && call.body.reasoning_effort === 'low' && /Fragment library/.test(call.body.messages[0].content) && /- reveal:/.test(call.body.messages[0].content), JSON.stringify(call && { model: call.body.model, effort: call.body.reasoning_effort }));
    const withAnswer = structuredClone(anatomy);
    withAnswer.parts.core_loop.question = 'How many tries?';
    withAnswer.parts.core_loop.answer = '6';
    const a2 = await fetch(`http://127.0.0.1:${port}/anatomy/revise`, { method: 'POST', body: JSON.stringify({ anatomy: withAnswer, change: 'also lose if the fog returns', request: 'a calm fog game', afterPlaying: true }) });
    const user = calls.at(-1)?.body.messages[1].content ?? '';
    check('POST /anatomy/revise sends the anatomy, the answers and the change', a2.status === 200 && /How many tries\? → 6/.test(user) && /also lose if the fog returns/.test(user) && /played the game/.test(user), user.slice(0, 300));
    replies[0] = JSON.stringify({ nope: true });
    const a3 = await fetch(`http://127.0.0.1:${port}/anatomy`, { method: 'POST', body: JSON.stringify({ request: 'x' }) });
    check('a reply that is not an anatomy is a 502', a3.status === 502, a3.status);
    check('an empty anatomy request is a 400', (await fetch(`http://127.0.0.1:${port}/anatomy`, { method: 'POST', body: '{"request":""}' })).status === 400);
    check('the key never appears in anatomy output', !JSON.stringify(aj).includes('test-key-not-real'));
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
