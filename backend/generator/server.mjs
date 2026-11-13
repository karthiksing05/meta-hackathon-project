// The game generator: an internal service that the Go API calls. It is the only place that talks
// to Muse. It listens on the private Docker network (no published port) and streams one job's
// progress as JSON Lines:
//
//   POST /compose  {request, brief, base?, remixOf?, level?, context?}
//        base is the stored manifest of a game being changed (a tweak, a new look, a next level, a remix);
//        the result is always a new game whose lineage points at remixOf.
//     -> 200 application/x-ndjson, one object per line:
//        {"type":"event","event":{"kind","summary",...}}  ... then one of
//        {"type":"result","manifest":{...},"stats":{...},"gate":{...}}
//        {"type":"error","message":"...","issues":[...],"stats":{...}}
//     -> 503 {"error":"muse_not_configured"} when MUSE_API_KEY isn't set
//     -> 429 {"error":"busy"} when GENERATOR_MAX_CONCURRENT jobs are already running
//   POST /anatomy         {request, audience?}                      -> 200 {anatomy: game-anatomy/0.1 ...}
//   POST /anatomy/revise  {anatomy, change, request?, afterPlaying?} -> 200 {anatomy: ...}  (the same shape)
//        one JSON turn on the fast model; 503 muse_not_configured, 429 busy, 502 when Muse's reply isn't an anatomy
//   POST /internal/muse/json {model, system, user, maxTokens?, effort?, timeoutSeconds?} -> {content, model, usage}
//        one JSON turn on a Muse model, for the Go API's harness steps; the key never leaves this container
//   POST /internal/muse/image {prompt, size?, guide?, timeoutSeconds?}  -> {png_base64, model, seconds}   (one muse-image-1.0 picture)
//   POST /internal/media/video  (raw video bytes, Content-Type video/mp4 or video/quicktime, up to 85 MB)
//        -> {width, height, durationMs, thumb, cuts, frames: [{t, cut, jpg, w, h}]}  (ffmpeg; jpg/thumb base64 JPEG); 422 unreadable
//   POST /internal/media/describe {kind, durationMs?, note?, frames: [{t, jpg}]} -> {description, model}   (one Muse vision call)
//   POST /verify          {game, log, state?: [names]} (text)               -> the engine's replay result {ok, game_hash_ok, recomputed, claimed, problems}
//   GET /healthz -> {"status":"ok","museConfigured":bool,"fragments":n}

import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose, failureStats } from './src/composer.mjs';
import { MuseClient, extractObject } from './src/muse.mjs';
import * as Anatomy from './src/anatomy.mjs';
import { loadStudio } from './src/studio.mjs';
import { MediaError, describe as describeMedia, videoFrames } from './src/media.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.PORT ?? 8090);
const MAX_CONCURRENT = Number(env.GENERATOR_MAX_CONCURRENT ?? 2);
const JOB_TIMEOUT_MS = Number(env.GENERATOR_JOB_TIMEOUT_SECONDS ?? 780) * 1000;
const MODEL = env.MUSE_MODEL || 'muse-wonder-1.0';
// A change to a game sends the whole stored manifest (the game script alone can be 150 KB or more); a new game with the
// person's photos and video carries their pictures (media_files, about 2 MB at most).
const COMPOSE_BODY_LIMIT = 12 * 1024 * 1024;
const MAX_CONTEXT_BYTES = 48 * 1024;
const FAST_MODEL = env.MUSE_FAST_MODEL || 'muse-ember-1.0';
const ANATOMY_TIMEOUT_S = Number(env.GENERATOR_ANATOMY_TIMEOUT_SECONDS ?? 40);

const studio = loadStudio();
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

/**
 * One JSON turn on any Muse model, for the Go API's harness steps (understand, plan, lookup summary). The Muse key stays
 * in this container: the API calls this route on the private network and never reads the key.
 *   {model, system, user, maxTokens?, effort?, timeoutSeconds?} -> {content, model}
 */
async function museJSON(req, res) {
  let input;
  try {
    input = await readBody(req, 1024 * 1024);
  } catch {
    return json(res, 400, { error: 'invalid JSON body' });
  }
  const model = String(input.model ?? '');
  const system = typeof input.system === 'string' ? input.system : '';
  const user = typeof input.user === 'string' ? input.user : '';
  const effort = input.effort ?? 'low';
  if (!/^muse-[a-z0-9.-]{1,40}$/.test(model)) return json(res, 400, { error: 'model must be a Muse model name' });
  if (!system || !user || system.length + user.length > 400000) return json(res, 400, { error: 'system and user are required (together up to 400 KB)' });
  if (effort !== null && !['minimal', 'low', 'medium', 'high'].includes(effort)) return json(res, 400, { error: 'effort must be minimal, low, medium, high or null' });
  const maxTokens = Math.min(16000, Math.max(256, Number(input.maxTokens) || 4000));
  const timeout = Math.min(120, Math.max(1, Number(input.timeoutSeconds) || 25));
  if (!muse.isConfigured) return json(res, 503, { error: 'muse_not_configured' });
  if (running >= MAX_CONCURRENT + 4) return json(res, 429, { error: 'busy' });
  running++;
  const started = Date.now();
  try {
    const r = await muse.chatJSON({ model, system, user, maxTokens, reasoningEffort: effort, timeout, maxAttempts: 1 });
    log('muse json ok', { model: r.model, seconds: (Date.now() - started) / 1000, usage: r.usage });
    return json(res, 200, { content: r.content, model: r.model, usage: r.usage });
  } catch (e) {
    log('muse json failed', { model, seconds: (Date.now() - started) / 1000, error: String(e?.message ?? e).slice(0, 200) });
    return json(res, 502, { error: 'muse_failed', message: String(e?.message ?? e).slice(0, 300) });
  } finally {
    running--;
  }
}

/**
 * One picture from muse-image-1.0, for the Go API's picture steps. The key stays in this container.
 *   {prompt, size?, guide?: base64 PNG, timeoutSeconds?} -> {png_base64, model, seconds}
 * A picture takes 13-18 s and returns about 0.5-3 MB, so the caller shrinks it and keeps it with the game.
 */
const IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536', '512x512', '768x768'];
async function museImage(req, res) {
  let input;
  try {
    input = await readBody(req, 6 * 1024 * 1024);
  } catch {
    return json(res, 400, { error: 'invalid JSON body' });
  }
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  const size = input.size ?? '1024x1024';
  if (!prompt || prompt.length > 4000) return json(res, 400, { error: 'prompt is required (up to 4000 characters)' });
  if (!IMAGE_SIZES.includes(size)) return json(res, 400, { error: `size must be one of ${IMAGE_SIZES.join(', ')}` });
  let guide = null;
  if (input.guide != null) {
    if (typeof input.guide !== 'string' || input.guide.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(input.guide)) {
      return json(res, 400, { error: 'guide must be a base64 PNG (up to 4 MB)' });
    }
    guide = Buffer.from(input.guide, 'base64');
  }
  const timeout = Math.min(170, Math.max(10, Number(input.timeoutSeconds) || 150));
  if (!muse.isConfigured) return json(res, 503, { error: 'muse_not_configured' });
  if (running >= MAX_CONCURRENT + 6) return json(res, 429, { error: 'busy' });
  running++;
  const started = Date.now();
  try {
    const r = await muse.image({ prompt, size, guide, timeout, maxAttempts: 1 });
    log('muse image ok', { model: r.model, seconds: (Date.now() - started) / 1000, bytes: r.png.length });
    return json(res, 200, { png_base64: r.png.toString('base64'), model: r.model, seconds: r.seconds });
  } catch (e) {
    log('muse image failed', { seconds: (Date.now() - started) / 1000, error: String(e?.message ?? e).slice(0, 200) });
    return json(res, 502, { error: 'muse_failed', message: String(e?.message ?? e).slice(0, 300) });
  } finally {
    running--;
  }
}

/** A video's key frames and scene cuts (ffmpeg), for the API's POST /v1/media. The bytes come raw. */
const VIDEO_LIMIT = 85 * 1024 * 1024;
async function mediaVideo(req, res) {
  const type = String(req.headers['content-type'] ?? '');
  if (!/^video\/(mp4|quicktime)\b/.test(type)) return json(res, 415, { error: 'send video/mp4 or video/quicktime' });
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > VIDEO_LIMIT) return json(res, 413, { error: 'video too large' });
    chunks.push(c);
  }
  if (running >= MAX_CONCURRENT + 4) return json(res, 429, { error: 'busy' });
  running++;
  const started = Date.now();
  try {
    const out = await videoFrames(Buffer.concat(chunks));
    log('media video ok', { seconds: (Date.now() - started) / 1000, frames: out.frames.length, cuts: out.cuts.length, durationMs: out.durationMs });
    return json(res, 200, out);
  } catch (e) {
    log('media video failed', { error: String(e?.message ?? e).slice(0, 200) });
    if (e instanceof MediaError) return json(res, e.status, { error: 'media', message: e.message });
    return json(res, 500, { error: 'media_failed' });
  } finally {
    running--;
  }
}

/** Muse vision describes a photo or a video's frames: who and what is on screen, captions, the beats. */
async function mediaDescribe(req, res) {
  let input;
  try {
    input = await readBody(req, 8 * 1024 * 1024);
  } catch {
    return json(res, 400, { error: 'invalid JSON body' });
  }
  if (!muse.isConfigured) return json(res, 503, { error: 'muse_not_configured' });
  if (running >= MAX_CONCURRENT + 4) return json(res, 429, { error: 'busy' });
  running++;
  const started = Date.now();
  try {
    const r = await describeMedia(input, muse, { model: env.MUSE_VISION_MODEL || 'muse-wonder-1.0' });
    log('media describe ok', { kind: input.kind, seconds: (Date.now() - started) / 1000, model: r.model, usage: r.usage });
    return json(res, 200, { description: r.description, model: r.model });
  } catch (e) {
    log('media describe failed', { seconds: (Date.now() - started) / 1000, error: String(e?.message ?? e).slice(0, 200) });
    if (e instanceof MediaError) return json(res, e.status, { error: 'media', message: e.message });
    return json(res, 502, { error: 'muse_failed', message: String(e?.message ?? e).slice(0, 300) });
  } finally {
    running--;
  }
}

/** Replays a run's log against the exact game text, so a score can be trusted without trusting the phone. */
async function verifyRun(req, res) {
  let input;
  try {
    input = await readBody(req, COMPOSE_BODY_LIMIT);
  } catch {
    return json(res, 400, { error: 'invalid JSON body' });
  }
  if (typeof input.game !== 'string' || !input.game || typeof input.log !== 'string' || !input.log) {
    return json(res, 400, { error: 'game and log are required, both as text' });
  }
  try {
    const names = Array.isArray(input.state) ? input.state.filter((n) => typeof n === 'string').slice(0, 12) : undefined;
    return json(res, 200, studio.verify(input.game, input.log, names));
  } catch (e) {
    log('verify failed', { error: String(e?.message ?? e).slice(0, 200) });
    return json(res, 500, { error: 'verify_failed' });
  }
}

/** One anatomy turn: the draft from a request, or a revision of an agreed anatomy. */
async function anatomy(req, res) {
  let input;
  try {
    input = await readBody(req, 256 * 1024);
  } catch {
    return json(res, 400, { error: 'invalid JSON body' });
  }
  const revise = req.url === '/anatomy/revise';
  const request = String(input.request ?? '').trim();
  if (!revise && (!request || request.length > 2000)) return json(res, 400, { error: 'request must be 1 to 2000 characters' });
  if (revise && (!input.anatomy || typeof input.anatomy !== 'object')) return json(res, 400, { error: 'anatomy is required' });
  if (revise && String(input.change ?? '').length > 2000) return json(res, 400, { error: 'change is too long' });
  if (!muse.isConfigured) return json(res, 503, { error: 'muse_not_configured' });
  if (running >= MAX_CONCURRENT + 2) return json(res, 429, { error: 'busy' }); // anatomy turns are short: a little extra room

  running++;
  const started = Date.now();
  try {
    const catalog = studio.catalog();
    const sys = Anatomy.system(Anatomy.fragmentLines(catalog));
    const user = revise
      ? Anatomy.userRevise({ anatomy: input.anatomy, request: request || input.anatomy.title || '', change: input.change, afterPlaying: input.afterPlaying === true })
      : Anatomy.userCreate(request, input.audience);
    const r = await muse.chatJSON({ model: FAST_MODEL, system: sys, user, maxTokens: 12000, reasoningEffort: 'low', timeout: ANATOMY_TIMEOUT_S, maxAttempts: 2 });
    const value = Anatomy.validate(extractObject(r.content));
    log('anatomy ok', { revise, seconds: (Date.now() - started) / 1000, model: r.model });
    return json(res, 200, { anatomy: value, model: r.model });
  } catch (e) {
    log('anatomy failed', { revise, seconds: (Date.now() - started) / 1000, error: String(e?.message ?? e).slice(0, 200) });
    return json(res, 502, { error: 'muse_failed', message: String(e?.message ?? e).slice(0, 300) });
  } finally {
    running--;
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      return json(res, 200, { status: 'ok', museConfigured: muse.isConfigured, fragments });
    }
    if (req.method === 'POST' && req.url === '/verify') return verifyRun(req, res);
    if (req.method === 'POST' && req.url === '/internal/muse/json') return museJSON(req, res);
    if (req.method === 'POST' && req.url === '/internal/muse/image') return museImage(req, res);
    if (req.method === 'POST' && req.url === '/internal/media/video') return mediaVideo(req, res);
    if (req.method === 'POST' && req.url === '/internal/media/describe') return mediaDescribe(req, res);
    if (req.method === 'POST' && (req.url === '/anatomy' || req.url === '/anatomy/revise')) return anatomy(req, res);
    if (req.method !== 'POST' || req.url !== '/compose') return json(res, 404, { error: 'not found' });

    let input;
    try {
      input = await readBody(req, COMPOSE_BODY_LIMIT);
    } catch {
      return json(res, 400, { error: 'invalid JSON body' });
    }
    const request = String(input.request ?? '').trim();
    if (!request || request.length > 20000) return json(res, 400, { error: 'request must be 1 to 20000 characters' });
    if (input.context && JSON.stringify(input.context).length > MAX_CONTEXT_BYTES) return json(res, 400, { error: 'context is too large (up to 48 KB)' });
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
      const base = input.base && typeof input.base === 'object' ? input.base : null;
      const context = input.context && typeof input.context === 'object' ? input.context : null;
      const mediaFiles = input.media_files && typeof input.media_files === 'object' ? input.media_files : null;
      const out = await compose({ request, brief: input.brief ?? null, base, remixOf: input.remixOf ?? null, level: Number(input.level) || null, context, mediaFiles }, {
        muse, studio, model: MODEL, signal: abort.signal,
        onEvent: (event) => send({ type: 'event', event }),
      });
      send({ type: 'result', manifest: out.manifest, stats: out.stats, gate: out.gate, bots: out.bots });
      log('compose ok', { seconds: (Date.now() - started) / 1000, museCalls: out.stats.museCalls, gate: out.gate.passed });
    } catch (e) {
      // stats.lastManifest: the last manifest the pipeline built, so a failed job can be debugged (composer.mjs failureStats).
      send({ type: 'error', message: e?.message ?? String(e), issues: e?.issues ?? [], stats: failureStats(e) });
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
