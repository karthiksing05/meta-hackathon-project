// The game generator: an internal service that the Go API calls. It is the only place that talks
// to Muse. It listens on the private Docker network (no published port) and streams one job's
// progress as JSON Lines:
//
//   POST /compose  {request, brief}
//     -> 200 application/x-ndjson, one object per line:
//        {"type":"event","event":{"kind","summary",...}}  ... then one of
//        {"type":"result","manifest":{...},"stats":{...},"gate":{...}}
//        {"type":"error","message":"...","issues":[...],"stats":{...}}
//     -> 503 {"error":"muse_not_configured"} when MUSE_API_KEY isn't set
//     -> 429 {"error":"busy"} when GENERATOR_MAX_CONCURRENT jobs are already running
//   GET /healthz -> {"status":"ok","museConfigured":bool,"fragments":n}

import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose } from './src/composer.mjs';
import { MuseClient } from './src/muse.mjs';
import { loadStudio } from './src/studio.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.PORT ?? 8090);
const MAX_CONCURRENT = Number(env.GENERATOR_MAX_CONCURRENT ?? 2);
const JOB_TIMEOUT_MS = Number(env.GENERATOR_JOB_TIMEOUT_SECONDS ?? 540) * 1000;
const MODEL = env.MUSE_MODEL || 'muse-wonder-1.0';

const studio = loadStudio(env.GENERATOR_VENDOR_DIR || join(here, 'vendor'));
const fragments = studio.catalog().fragments.length;
const muse = new MuseClient({ apiKey: env.MUSE_API_KEY ?? '', baseURL: env.MUSE_BASE_URL || 'https://api.meta.ai/v1' });
let running = 0;

const log = (msg, extra = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...extra }));

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      return json(res, 200, { status: 'ok', museConfigured: muse.isConfigured, fragments });
    }
    if (req.method !== 'POST' || req.url !== '/compose') return json(res, 404, { error: 'not found' });

    let input;
    try {
      input = await readBody(req);
    } catch {
      return json(res, 400, { error: 'invalid JSON body' });
    }
    const request = String(input.request ?? '').trim();
    if (!request || request.length > 2000) return json(res, 400, { error: 'request must be 1 to 2000 characters' });
    if (!muse.isConfigured) return json(res, 503, { error: 'muse_not_configured' });
    if (running >= MAX_CONCURRENT) return json(res, 429, { error: 'busy' });

    running++;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), JOB_TIMEOUT_MS);
    res.on('close', () => abort.abort()); // the Go API went away: stop spending Muse calls
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    const send = (obj) => { if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n'); };
    const started = Date.now();
    try {
      const out = await compose({ request, brief: input.brief ?? {} }, {
        muse, studio, model: MODEL, signal: abort.signal,
        onEvent: (event) => send({ type: 'event', event }),
      });
      send({ type: 'result', manifest: out.manifest, stats: out.stats, gate: out.gate, bots: out.bots });
      log('compose ok', { seconds: (Date.now() - started) / 1000, museCalls: out.stats.museCalls, gate: out.gate.passed });
    } catch (e) {
      send({ type: 'error', message: e?.message ?? String(e), issues: e?.issues ?? [], stats: e?.stats });
      log('compose failed', { seconds: (Date.now() - started) / 1000, error: String(e?.message ?? e).slice(0, 200) });
    } finally {
      clearTimeout(timer);
      running--;
      res.end();
    }
  } catch (e) {
    log('request failed', { error: String(e?.message ?? e) });
    if (!res.headersSent) json(res, 500, { error: 'internal error' });
    else res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => log('generator listening', { port: PORT, museConfigured: muse.isConfigured, model: MODEL, fragments }));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
