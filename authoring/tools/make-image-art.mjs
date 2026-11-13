#!/usr/bin/env node
// Build-time picture art from muse-image-1.0 for a made game (authoring/expander/image-art.mjs).
//
//   node authoring/tools/make-image-art.mjs --manifest games/3/manifest.json --out out/3 \
//        [--plan plans/3.json] [--request "..."] [--style "80s anime"] [--strategy sheet|each]
//        [--no-direction] [--cache dir] [--budget 196608] [--max-redraws 4]
//   node authoring/tools/make-image-art.mjs --story authoring/stories/kevin_01_leia_escape.story.json --out out/s1 [--style ...]
//
// Writes <out>/manifest.json (the game with its new pictures), <out>/art.json (record, stats,
// direction, sprite check) and <out>/preview-*.png (preview-set-<id>.png: a set asset's frames in order). `--cache` keeps every image reply by prompt hash, so a rerun
// makes no calls and gives the same bytes. The Muse key is read into memory only and never printed.

import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { makeImageArt, applyImageArt, makeStoryArt, applyStoryArt } from '../expander/image-art.mjs';
import { decodePNG, encodePNG, isPNG } from '../expander/image-codec.mjs';
import * as X from '../expander/image-pixels.mjs';
import { splitFrames } from '../expander/sprite-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);
const out = resolve(opt('--out', 'image-art-out'));

export const inflate = (b) => new Uint8Array(zlib.inflateSync(b));
export const deflate = (b) => new Uint8Array(zlib.deflateSync(b, { level: 9 }));

/** PNG in pure JS; WebP (Muse's default output, 5× faster to fetch than PNG) through dwebp. */
export function decode(bytes) {
  if (isPNG(bytes)) return decodePNG(bytes, inflate);
  const dir = mkdtempSync(join(tmpdir(), 'image-art-'));
  try {
    writeFileSync(join(dir, 'in.webp'), bytes);
    execFileSync('dwebp', ['-quiet', join(dir, 'in.webp'), '-o', join(dir, 'out.png')]);
    return decodePNG(new Uint8Array(readFileSync(join(dir, 'out.png'))), inflate);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function museKey() {
  // The current key: MUSE_API_KEY in the environment, then the repo's .env, then MuseConfig.json (may be stale).
  if (process.env.MUSE_API_KEY) return process.env.MUSE_API_KEY;
  for (const env of [join(REPO, '.env'), resolve(REPO, '../../../.env')]) {
    if (!existsSync(env)) continue;
    const m = readFileSync(env, 'utf8').match(/^\s*(?:export\s+)?MUSE_API_KEY\s*=\s*["']?([^"'\s]+)/m);
    if (m) return m[1];
  }
  const p = [join(REPO, 'FacebookClone/Bubbles/Studio/MuseConfig.json'), resolve(REPO, '../../../FacebookClone/Bubbles/Studio/MuseConfig.json')].find((f) => existsSync(f));
  if (!p) throw new Error('no MuseConfig.json');
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  return Object.values(cfg).find((x) => typeof x === 'string' && x.length > 20);
}

const BASE = 'https://api.meta.ai/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let KEY = null;
const cacheDir = opt('--cache');
const format = opt('--format', 'webp');
const log = [];

async function withRetry(what, fn) {
  let last;
  for (let a = 1; a <= 4; a++) {
    try { return await fn(); } catch (e) {
      last = e;
      const retry = !e.status || e.status === 429 || e.status >= 500;
      if (!retry || a === 4) break;
      await sleep(4000 * a);
    }
  }
  throw new Error(`${what}: ${String(last?.message ?? last).replaceAll(KEY ?? '\u0000', '***').slice(0, 200)}`);
}

/** One muse-image-1.0 call: generations, or edits (multipart) with a reference image. */
export async function image({ prompt, reference, purpose }) {
  const h = createHash('sha256').update(prompt).update(reference ? createHash('sha256').update(reference).digest('hex') : '').update(format).digest('hex').slice(0, 24);
  if (cacheDir) {
    const f = join(cacheDir, h + '.json');
    if (existsSync(f)) {
      const c = JSON.parse(readFileSync(f, 'utf8'));
      return { bytes: new Uint8Array(readFileSync(join(cacheDir, h + '.img'))), usage: c.usage, cached: true };
    }
  }
  KEY ??= museKey();
  const t0 = Date.now();
  const j = await withRetry(`image ${purpose}`, async () => {
    let res;
    if (reference) {
      const fd = new FormData();
      fd.append('model', 'muse-image-1.0');
      fd.append('prompt', prompt);
      if (format !== 'webp') fd.append('output_format', format);
      fd.append('image', new Blob([reference], { type: isPNG(reference) ? 'image/png' : 'image/webp' }), isPNG(reference) ? 'reference.png' : 'reference.webp');
      res = await fetch(`${BASE}/images/edits`, { method: 'POST', headers: { authorization: `Bearer ${KEY}` }, body: fd, signal: AbortSignal.timeout(120000) });
    } else {
      res = await fetch(`${BASE}/images/generations`, { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'muse-image-1.0', prompt, n: 1, ...(format !== 'webp' ? { output_format: format } : {}) }), signal: AbortSignal.timeout(120000) });
    }
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`${res.status} ${text.slice(0, 200)}`), { status: res.status });
    return JSON.parse(text);
  });
  const bytes = new Uint8Array(Buffer.from(j.data[0].b64_json, 'base64'));
  log.push({ purpose, ms: Date.now() - t0, bytes: bytes.length, size: j.size, usage: j.usage, reference: !!reference });
  if (cacheDir) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, h + '.img'), bytes);
    writeFileSync(join(cacheDir, h + '.json'), JSON.stringify({ purpose, usage: j.usage, size: j.size, prompt }));
  }
  return { bytes, usage: j.usage };
}

/** Muse text (JSON) for art direction. */
export async function ask(system, user, purpose, options = {}) {
  const h = createHash('sha256').update(system).update(user).update(JSON.stringify(options)).digest('hex').slice(0, 24);
  if (cacheDir && existsSync(join(cacheDir, h + '.txt.json'))) return JSON.parse(readFileSync(join(cacheDir, h + '.txt.json'), 'utf8'));
  KEY ??= museKey();
  const t0 = Date.now();
  const data = await withRetry(purpose, async () => {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: options.model ?? 'muse-spark-1.3', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' }, max_tokens: Math.max(options.max_tokens ?? 4000, 4000), reasoning_effort: options.effort ?? 'low' }),
      signal: AbortSignal.timeout(120000),
    });
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`${res.status} ${text.slice(0, 200)}`), { status: res.status });
    return JSON.parse(text);
  });
  const r = { content: String(data.choices?.[0]?.message?.content ?? ''), usage: data.usage };
  log.push({ purpose, ms: Date.now() - t0, usage: data.usage });
  if (cacheDir) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(join(cacheDir, h + '.txt.json'), JSON.stringify(r)); }
  return r;
}

/** Keyed sprites side by side on a checker, for eyeballing. */
function previewSheet(imgs, h = 160) {
  const scaled = imgs.filter(Boolean).map((im) => X.resize(im, Math.max(1, Math.round((im.w * h) / im.h)), h));
  const W = scaled.reduce((a, s) => a + s.w + 8, 8);
  const sheet = X.blank(W, h + 16);
  for (let y = 0; y < sheet.h; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const v = ((x >> 3) + (y >> 3)) & 1 ? 200 : 236;
    sheet.data[o] = sheet.data[o + 1] = sheet.data[o + 2] = v; sheet.data[o + 3] = 255;
  }
  let x = 8;
  for (const s of scaled) {
    for (let r = 0; r < s.h; r++) for (let c = 0; c < s.w; c++) {
      const so = (r * s.w + c) * 4, d = ((r + 8) * W + x + c) * 4, a = s.data[so + 3] / 255;
      for (let k = 0; k < 3; k++) sheet.data[d + k] = Math.round(s.data[so + k] * a + sheet.data[d + k] * (1 - a));
    }
    x += s.w + 8;
  }
  return encodePNG(sheet, deflate);
}

async function main() {
  mkdirSync(out, { recursive: true });
  const deps = { image, decode, deflate, ...(flag('--no-direction') ? {} : { ask }) };
  const style = opt('--style');
  const plan = opt('--plan') ? JSON.parse(readFileSync(opt('--plan'), 'utf8')) : null;
  const spec = plan?.plan?.spec ?? null;

  if (opt('--story')) {
    const { validateStoryGraph, compileStoryGraph } = await import('../expander/story-graph.mjs');
    const { expand, loadLibrary } = await import('../expander/expand.mjs');
    const raw = JSON.parse(readFileSync(opt('--story'), 'utf8'));
    const report = validateStoryGraph(raw);
    const { manifest: authoring } = compileStoryGraph(raw, { report });
    const request = opt('--request', raw.request ?? '');
    const art = await makeStoryArt({ authoring, request, spec, style }, deps, { budget: Number(opt('--budget', 192 * 1024)) });
    const withArt = applyStoryArt(authoring, art);
    const lib = loadLibrary(join(REPO, 'authoring'));
    const plain = expand(authoring, lib);
    const x = expand(withArt, lib);
    const errs = (x.diagnostics ?? []).filter((d) => d.severity === "error");
    if (errs.length) { console.error(JSON.stringify(errs.slice(0, 5), null, 1)); throw new Error('the story with pictures does not expand'); }
    const { wrapGame } = await import('../expander/wrap.mjs');
    const wrap = (g, a) => ({ ...wrapGame({ id: `story-${(raw.title ?? 'story').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`, game: g, authoring: a, brief: { intent: request, audience: 'everyone', mood: ['playful'], energy: 'medium', competition: 'light' } }) });
    writeFileSync(join(out, 'manifest-before.json'), JSON.stringify(wrap(plain.game, authoring), null, 1));
    writeFileSync(join(out, 'manifest.json'), JSON.stringify({ ...wrap(x.game, withArt), art_record: art.record }, null, 1));
    writeFileSync(join(out, 'art.json'), JSON.stringify({ record: art.record, stats: art.stats, direction: art.direction, params: art.params, sheet: art.sheet, fits: art.fits, log }, null, 1));
    writeFileSync(join(out, 'preview-lineup.png'), previewSheet([art.previews.lineup]));
    if (art.previews.stills.length) writeFileSync(join(out, 'preview-stills.png'), previewSheet(art.previews.stills, 240));
    console.log(JSON.stringify({ out, image_calls: art.stats.image_calls, text_calls: art.stats.text_calls, tokens: art.stats.tokens, ms: art.stats.ms, budget: art.stats.budget, cast: art.direction.cast.map((c) => c.name), stills: art.direction.stills.length }));
    return;
  }

  const manifest = JSON.parse(readFileSync(opt('--manifest'), 'utf8'));
  const game = JSON.parse(manifest.content.game_json);
  const authoring = manifest.content.authoring_json ? JSON.parse(manifest.content.authoring_json) : null;
  const request = opt('--request', manifest.brief?.intent ?? '');
  const art = await makeImageArt({ game, authoring, request, spec, style }, deps, { strategy: opt('--strategy', 'sheet'), budget: Number(opt('--budget', 192 * 1024)), ...(opt('--max-redraws') !== null ? { max_redraws: Number(opt('--max-redraws')) } : {}) });
  const next = applyImageArt(manifest, art);
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(next, null, 1));
  writeFileSync(join(out, 'art.json'), JSON.stringify({ record: art.record, stats: art.stats, direction: art.direction, sheet: art.sheet, fits: art.fits, log }, null, 1));
  writeFileSync(join(out, 'preview-sprites.png'), previewSheet(Object.values(art.keyed)));
  // One contact sheet per set asset: its frames as the game will show them, in frame order.
  for (const [id, a] of Object.entries(art.assets)) {
    if (!(a.frames > 1) || a.fps !== undefined || !art.record.pictures.find((p) => p.id === id)?.frames) continue;
    const img = decodePNG(new Uint8Array(Buffer.from(a.image.split(',')[1], 'base64')), inflate);
    writeFileSync(join(out, `preview-set-${id}.png`), previewSheet(splitFrames(img, a.frames, a.cols ?? a.frames), 192));
  }
  console.log(JSON.stringify({ out, strategy: art.stats.strategy, image_calls: art.stats.image_calls, text_calls: art.stats.text_calls, tokens: art.stats.tokens, ms: art.stats.ms, budget: art.stats.budget, slice: art.stats.slice, retried: art.stats.retried ?? [], variants: art.stats.variants ?? {}, sprite_check: art.stats.sprite_check }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(String(e?.message ?? e).replaceAll(KEY ?? '\u0000', '***')); process.exit(1); });
}
