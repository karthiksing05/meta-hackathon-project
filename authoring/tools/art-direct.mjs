#!/usr/bin/env node
// The art-direction pipeline on the command line (authoring/ARTDIR.md). Steps, each one resumable:
//
//   node authoring/tools/art-direct.mjs frame --direction d.json --out dir   # 1 image call: the style frame
//   node authoring/tools/art-direct.mjs kit   --direction d.json --out dir   # 0 calls: palette, fonts, shape
//   node authoring/tools/art-direct.mjs art   --direction d.json --out dir [--only backdrop,sprites,ui]
//                                                                           # ≤ 3 calls: backdrop, sprite sheet, UI kit sheet
//   node authoring/tools/art-direct.mjs build --prod prod.json --builder authoring/artdir/gold/s3.mjs --direction d.json --out dir [--seeded] [--profile p]
//                                                                           # 0 calls: the game's build script, then finish.mjs
//   node authoring/tools/art-direct.mjs see   --manifest built.json --out dir [--frame dir/frame.png] [--name s3]
//
// Common: --cache <dir> keeps every image reply by prompt hash (a rerun makes no calls and gives the
// same bytes); --ledger <file> counts image calls across games and --max-calls <n> refuses a call
// that would go over; --env <.env> reads MUSE_API_KEY from that file (into memory only, never printed).
//
// Writes into --out: frame.png (720 × 1560, the frame on the tall canvas at 2×), frame.json, kit.json,
// backdrop.jpg, sprites/<id>.png + sprites.json, ui/<piece>.png + ui.json (9-slice insets), art.json
// (prompts, calls, slicing). The game itself is changed by the game's own build script (ARTDIR.md
// step 5), which reads these files.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import zlib from 'node:zlib';
import { directionErrors, framePrompt, backdropPrompt, spriteSheetPrompt, uiSheetPrompt } from '../artdir/prompts.mjs';
import { toTall, sliceSprites, finishSprite, sliceUi, finishUi, calmZones, contactSheet } from '../artdir/sheets.mjs';
import { kitFromFrame } from '../artdir/kit.mjs';
import { encodePNG, encodeJPEG, quantize, decodePNG } from '../expander/image-codec.mjs';
import * as X from '../expander/image-pixels.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const out = resolve(opt('--out', 'artdir-out'));
const deflate = (b) => new Uint8Array(zlib.deflateSync(b, { level: 9 }));
const inflate = (b) => new Uint8Array(zlib.inflateSync(b));

function loadEnvKey() {
  const env = opt('--env');
  if (!env || process.env.MUSE_API_KEY) return;
  const m = readFileSync(env, 'utf8').match(/^\s*(?:export\s+)?MUSE_API_KEY\s*=\s*["']?([^"'\s]+)/m);
  if (!m) throw new Error(`no MUSE_API_KEY in ${env}`);
  process.env.MUSE_API_KEY = m[1];
}

// The image client is make-image-art.mjs's (same endpoint, retries, --cache by prompt hash).
let client = null;
async function imageClient() {
  if (!client) {
    if (!process.env.MUSE_API_KEY) throw new Error('set MUSE_API_KEY or pass --env <.env>; MuseConfig.json is never read here');
    client = await import('./make-image-art.mjs');
  }
  return client;
}

// The ledger is JSON Lines (one line per fresh call), appended, so parallel runs count correctly.
const ledgerCount = () => { const f = opt('--ledger'); return f && existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).length : 0; };

/** One budgeted image call. Cached replies are free; a fresh one is appended to the ledger. */
async function call(purpose, prompt, reference = null) {
  const c = await imageClient();
  const r = await c.image({ prompt, reference, purpose });
  if (!r.cached && opt('--ledger')) appendFileSync(opt('--ledger'), JSON.stringify({ at: new Date().toISOString(), purpose, out }) + '\n');
  return { bytes: r.bytes, cached: !!r.cached, img: c.decode(r.bytes) };
}

/** Refuses up front when `n` more fresh calls would pass --max-calls. */
function checkBudget(n) {
  const max = Number(opt('--max-calls', 'Infinity'));
  const used = ledgerCount();
  if (used + n > max) throw new Error(`image budget: ${used} used, ${n} more would pass --max-calls ${max} (cached replies are free: pass the same --cache)`);
}

const png = (img) => encodePNG(img, deflate, { palette: quantize(img, 255) });
const readJSON = (f) => JSON.parse(readFileSync(f, 'utf8'));
const direction = () => {
  const d = readJSON(opt('--direction'));
  const errs = directionErrors(d);
  if (errs.length) throw new Error('direction: ' + errs.join('; '));
  return d;
};
const record = (patch) => {
  const f = join(out, 'art.json');
  const cur = existsSync(f) ? readJSON(f) : { steps: {} };
  cur.steps = { ...cur.steps, ...patch };
  writeFileSync(f, JSON.stringify(cur, null, 1));
};

async function stepFrame() {
  const d = direction();
  mkdirSync(out, { recursive: true });
  const prompt = framePrompt(d);
  checkBudget(1);
  const r = await call('style frame', prompt);
  writeFileSync(join(out, 'frame-source.bin'), r.bytes);
  const tall = toTall(r.img, 2);
  writeFileSync(join(out, 'frame.png'), encodePNG(tall, deflate));
  const zones = calmZones(tall);
  writeFileSync(join(out, 'frame.json'), JSON.stringify({ prompt, source: [r.img.w, r.img.h], calm: zones, cached: r.cached }, null, 1));
  record({ frame: { prompt, cached: r.cached, source: [r.img.w, r.img.h] } });
  console.log(JSON.stringify({ step: 'frame', out: join(out, 'frame.png'), calm: zones, cached: r.cached }));
}

function stepKit() {
  const d = direction();
  const frame = decodePNG(new Uint8Array(readFileSync(join(out, 'frame.png'))), inflate);
  const small = X.resize(frame, 360, 780);
  const kit = kitFromFrame({ frame: small, words: [d.title, d.style, d.words ?? ''].join(' '), gameId: d.gameId ?? d.title, vibe: d.vibe ?? null, pairing: d.pairing ?? null, mode: d.mode ?? null, shape: d.shape ?? null });
  writeFileSync(join(out, 'kit.json'), JSON.stringify(kit, null, 1));
  console.log(JSON.stringify({ step: 'kit', mode: kit.mode, palette: kit.palette, type: kit.type, fonts: kit.fonts, shape: kit.shape, calm: kit.calm }));
}

async function stepArt() {
  const d = direction();
  const only = (opt('--only') ?? 'backdrop,sprites,ui').split(',');
  const want = (k) => only.includes(k) && (k !== 'sprites' || d.sprites) && (k !== 'ui' || d.ui);
  checkBudget(['backdrop', 'sprites', 'ui'].filter(want).length);
  const frameBytes = existsSync(join(out, 'frame-source.bin')) ? new Uint8Array(readFileSync(join(out, 'frame-source.bin'))) : null;
  const tasks = [];
  if (want('backdrop')) tasks.push((async () => {
    const edit = !!frameBytes && d.backdrop.edit !== false;
    const prompt = backdropPrompt(d, { edit });
    const r = await call('backdrop', prompt, edit ? frameBytes : null);
    writeFileSync(join(out, 'backdrop-source.bin'), r.bytes);
    const tall = toTall(r.img, 2);
    writeFileSync(join(out, 'backdrop.jpg'), encodeJPEG(tall, Number(d.backdrop.quality ?? 72)));
    writeFileSync(join(out, 'backdrop.png'), encodePNG(X.resize(tall, 360, 780), deflate));
    record({ backdrop: { prompt, edit, cached: r.cached, source: [r.img.w, r.img.h], calm: calmZones(tall) } });
  })());
  if (want('sprites')) tasks.push((async () => {
    const prompt = spriteSheetPrompt(d);
    const r = await call('sprite sheet', prompt);
    writeFileSync(join(out, 'sprites-source.bin'), r.bytes);
    const s = sliceSprites(r.img, d.sprites.items, d.sprites.key ?? 'magenta', { hard: d.sprites.despill === 'hard' });
    mkdirSync(join(out, 'sprites'), { recursive: true });
    const meta = {};
    const shown = [];
    for (const it of d.sprites.items) {
      const img = finishSprite(s.sprites[it.id], it.px ?? d.sprites.px ?? 192);
      writeFileSync(join(out, 'sprites', `${it.id}.png`), png(img));
      meta[it.id] = { w: img.w, h: img.h };
      shown.push(img);
    }
    writeFileSync(join(out, 'sprites-preview.png'), encodePNG(contactSheet(shown), deflate));
    writeFileSync(join(out, 'sprites.json'), JSON.stringify({ method: s.method, sprites: meta }, null, 1));
    record({ sprites: { prompt, cached: r.cached, method: s.method, source: [r.img.w, r.img.h] } });
  })());
  if (want('ui')) tasks.push((async () => {
    const prompt = uiSheetPrompt(d);
    const r = await call('ui kit sheet', prompt);
    writeFileSync(join(out, 'ui-source.bin'), r.bytes);
    const s = sliceUi(r.img, d.ui.key ?? 'magenta');
    mkdirSync(join(out, 'ui'), { recursive: true });
    const meta = {};
    const shown = [];
    for (const [id, piece] of Object.entries(s.pieces)) {
      const f = finishUi(piece, d.ui.corner ?? 48);
      writeFileSync(join(out, 'ui', `${id}.png`), png(f.img));
      meta[id] = { w: f.img.w, h: f.img.h, insets: f.insets };
      shown.push(f.img);
    }
    writeFileSync(join(out, 'ui-preview.png'), encodePNG(contactSheet(shown), deflate));
    writeFileSync(join(out, 'ui.json'), JSON.stringify({ method: s.method, pieces: meta }, null, 1));
    record({ ui: { prompt, cached: r.cached, method: s.method, source: [r.img.w, r.img.h] } });
  })());
  await Promise.all(tasks);
  console.log(JSON.stringify({ step: 'art', out, only }));
}

async function stepSee() {
  const { see } = await import('../artdir/see.mjs');
  const m = readJSON(opt('--manifest'));
  const r = await see(m, { out, name: opt('--name', 'game'), frame: opt('--frame') ? resolve(opt('--frame')) : null });
  console.log(JSON.stringify({ step: 'see', sheet: r.sheet, frames: r.frames.map((f) => f.label), ends: r.coverage.endStates }));
}

async function stepBuild() {
  const { loadArt } = await import('../artdir/build.mjs');
  const { finish } = await import('../artdir/finish.mjs');
  const d = direction();
  const prod = readJSON(opt('--prod'));
  const builder = await import(resolve(opt('--builder')));
  const art = loadArt(out);
  const game = builder.build(JSON.parse(prod.content.game_json), art, { direction: d });
  const seeded = argv.includes('--seeded') || !!d.presentationOnly;
  const artRecord = d.presentationOnly ? undefined : { format: 'artdir/1', builtBy: 'harness+opus', imageArt: 'muse-image-1.0', license: 'generated', pictures: Object.keys(game.assets ?? {}).filter((k) => game.assets[k].image) };
  const { manifest, record } = await finish(prod, game, { kit: art.kit, seeded, profile: opt('--profile'), notes: { artRecord } });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(out, 'finish.json'), JSON.stringify(record, null, 1));
  const bytes = JSON.stringify(manifest).length;
  console.log(JSON.stringify({ step: 'build', ok: record.ok, why: record.why, gate: record.gate.passed, blocking: record.verifier.blocking, byCode: record.verifier.byCode, rulesHash: record.rulesHash, replays: record.replays.equal, manifestBytes: bytes }));
}

const steps = { frame: stepFrame, kit: stepKit, art: stepArt, build: stepBuild, see: stepSee };
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!steps[cmd]) { console.error('usage: art-direct.mjs frame|kit|art|see --out <dir> ...'); process.exit(2); }
  try { loadEnvKey(); } catch (e) { console.error(String(e.message)); process.exit(1); }
  Promise.resolve(steps[cmd]()).catch((e) => {
    const key = process.env.MUSE_API_KEY;
    console.error(String(e?.stack ?? e).replaceAll(key || '\u0000', '***'));
    process.exit(1);
  });
}
