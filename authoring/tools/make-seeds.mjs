#!/usr/bin/env node
// Writes the microgame seed Bubbles for the app (FacebookClone/Bubbles/Seeds/bubble-seed-mg-*.json):
// a few authoring games (expanded here) and a few engine example games, each wrapped as a
// `formula: "microgame"` manifest. Every game must validate with zero errors first.
//
// Usage: node authoring/tools/make-seeds.mjs [--check]
//   --check: exit 1 if the committed seed files differ from a fresh build.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, loadLibrary } from '../expander/expand.mjs';
import { loadEngine } from '../expander/engine.mjs';
import { wrapGame } from '../expander/wrap.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const seedsDir = join(root, 'FacebookClone', 'Bubbles', 'Seeds');
const check = process.argv.includes('--check');

// All touch-playable (taps, drags, holds, flicks): the app has no keyboard during play.
const SEEDS = [
  // Authoring games (fragments + look).
  { id: 'mg-friend-dash', authoring: 'friend_dash', emoji: '🏃', creator: 'sf-maya-okafor', group: 'group-newinsf', hours: 5, plays: 640, likes: 150 },
  { id: 'mg-postcard-pairs', authoring: 'postcard_pairs', emoji: '💌', creator: 'sf-aiko-tanaka', hours: 12, plays: 410, likes: 96 },
  { id: 'mg-number-merge', authoring: 'number_merge', emoji: '🔢', creator: 'sf-theo-adeyemi', hours: 40, plays: 1880, likes: 402 },
  { id: 'mg-kite-day-detour', authoring: 'kite_day_detour', emoji: '🪁', creator: 'sf-lena-fischer', group: 'group-newinsf', hours: 16, plays: 233, likes: 71 },
  // Engine examples (hand-written, with SVG sprites, physics and audio).
  { id: 'mg-gust-glider', example: 'gust_glider', emoji: '🪶', creator: 'sf-diego-ramirez', hours: 7, plays: 1320, likes: 318 },
  { id: 'mg-prism-breaker', example: 'prism_breaker', emoji: '🔷', creator: 'sf-omar-haddad', hours: 22, plays: 905, likes: 211 },
  { id: 'mg-lantern-ridge', example: 'lantern_ridge', emoji: '🏮', creator: 'sf-chloe-nguyen', hours: 30, plays: 512, likes: 133 },
  { id: 'mg-gull-rock', example: 'gull_rock', emoji: '🪨', creator: 'sf-priya-natarajan', hours: 48, plays: 287, likes: 90 },
];

const { engine } = await loadEngine();
const lib = loadLibrary(join(root, 'authoring'));
let failed = 0, stale = 0;

for (const s of SEEDS) {
  let game, authoring = null;
  if (s.authoring) {
    authoring = JSON.parse(readFileSync(join(root, 'authoring', 'games', `${s.authoring}.authoring.json`), 'utf8'));
    const r = expand(authoring, lib);
    const errs = r.diagnostics.filter((d) => d.severity === 'error');
    if (errs.length) { console.error(`${s.id}: expander errors`, errs); failed++; continue; }
    game = r.game;
  } else {
    game = JSON.parse(readFileSync(join(root, 'engine', 'examples', `${s.example}.json`), 'utf8'));
  }
  const errors = engine.validate(JSON.stringify(game)).filter((d) => d.severity === 'error');
  if (errors.length) { console.error(`${s.id}: ${errors.length} engine errors`, errors.slice(0, 3)); failed++; continue; }

  const m = wrapGame({ id: s.id, game, authoring, emoji: s.emoji, seed: 1000 + SEEDS.indexOf(s) });
  m._seed = {
    creator_id: s.creator,
    ...(s.group ? { group_id: s.group } : {}),
    created_hours_ago: s.hours,
    play_count: s.plays,
    like_count: s.likes,
    save_count: Math.round(s.likes * 1.2),
  };
  const file = join(seedsDir, `bubble-seed-${s.id}.json`);
  const text = JSON.stringify(m, null, 2) + '\n';
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) { console.error(`${file} is out of date`); stale++; }
  } else {
    writeFileSync(file, text);
    console.log(`${s.id}: ${(text.length / 1024).toFixed(0)} KiB`);
  }
}
if (failed) { console.error(`${failed} seed(s) failed`); process.exit(1); }
if (stale) { console.error('run: node authoring/tools/make-seeds.mjs'); process.exit(1); }
if (check) console.log(`${SEEDS.length} microgame seeds are up to date`);
