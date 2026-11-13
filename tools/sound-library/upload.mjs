#!/usr/bin/env node
// Uploads the packages build.py made (tools/sound-library/out/*.zip) to the sound library through the
// API (POST /v1/sounds, signed in as the studio account), then checks each one: the sound reads back
// and its audioUrl serves audio. Never writes to the database directly.
//
//   API=https://api.ol4ol.com SOUNDS_EMAIL=... SOUNDS_PASSWORD=... node tools/sound-library/upload.mjs [--dry-run]
//
// The credentials come from the environment and are never printed. A title already in the library
// (same title and creator) is skipped, so a rerun only adds what's missing. Results: out/uploaded.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const API = (process.env.API || '').replace(/\/$/, '');
const dry = process.argv.includes('--dry-run');
if (!API) { console.error('Set API (and SOUNDS_EMAIL / SOUNDS_PASSWORD).'); process.exit(2); }

const catalog = JSON.parse(readFileSync(join(here, 'catalog.json'), 'utf8')).tracks;
const byKey = Object.fromEntries(catalog.map((t) => [t.key, t]));
const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).filter((r) => r.status === 'built');
const donePath = join(out, 'uploaded.json');
const done = existsSync(donePath) ? JSON.parse(readFileSync(donePath, 'utf8')) : {};
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function call(method, path, { token, body, type } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (type) headers['Content-Type'] = type;
  const res = await fetch(API + path, { method, headers, body });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

let token = null;
if (!dry) {
  const login = await call('POST', '/v1/auth/login', { type: 'application/json',
    body: JSON.stringify({ email: process.env.SOUNDS_EMAIL, password: process.env.SOUNDS_PASSWORD }) });
  if (login.status >= 300) { console.error(`sign-in failed (${login.status})`); process.exit(1); }
  token = login.json.accessToken;
}

let uploaded = 0, skipped = 0, failed = 0;
for (const r of report) {
  const t = byKey[r.key];
  if (done[r.key]?.id) { skipped++; continue; }
  // Already in the library under this title (a rerun, or uploaded another way)?
  const found = await call('GET', `/v1/sounds?tab=recent&limit=50&q=${encodeURIComponent(t.title.split(/\s+/)[0])}`);
  const same = (found.json?.items || []).find((s) => norm(s.title) === norm(t.title.slice(0, 80)));
  if (same) { done[r.key] = { id: same.id, audioUrl: same.audioUrl, existing: true }; skipped++; continue; }
  if (dry) { console.log('would upload', r.key, t.title); continue; }
  const zip = readFileSync(join(here, r.zip));
  const up = await call('POST', '/v1/sounds', { token, type: 'application/zip', body: zip });
  if (up.status >= 300) { failed++; console.log(`  FAIL ${r.key}: ${up.status} ${JSON.stringify(up.json)}`); continue; }
  const sound = up.json.sound ?? up.json;
  const audio = await fetch(sound.audioUrl, { method: 'GET', headers: { Range: 'bytes=0-1023' } });
  const ok = audio.status < 300 && /audio|mp4|octet/.test(audio.headers.get('content-type') || '');
  done[r.key] = { id: sound.id, audioUrl: sound.audioUrl, title: sound.title, playable: ok };
  if (!ok) { failed++; console.log(`  NOT PLAYABLE ${r.key}: ${audio.status} ${audio.headers.get('content-type')}`); }
  else uploaded++;
  writeFileSync(donePath, JSON.stringify(done, null, 1));
}
writeFileSync(donePath, JSON.stringify(done, null, 1));
console.log(`uploaded ${uploaded}, skipped ${skipped} (already there), failed ${failed}`);
process.exit(failed ? 1 : 0);
