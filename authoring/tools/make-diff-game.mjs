#!/usr/bin/env node
// Builds a spot-the-difference authoring manifest from one scene, at build time:
//   node authoring/tools/make-diff-game.mjs [scene.json] [--seed N] [--count N] [-o out.authoring.json]
// Defaults: authoring/examples/group_chat_scene.json, seed 7, 7 differences,
// authoring/examples/group_chat_diff.authoring.json (examples/, not games/: the bot gate can't model looking for differences yet, see docs/harness-gaps/images.md). Exit 1 if the scene has problems.
// The pictures and the answer key come from expander/spot-diff.mjs, so they always agree.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSpotDifference, toAuthoring } from '../expander/spot-diff.mjs';

const authoringDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The manifest for a pair: diff_spots + lives (misses) + score, 60 s on the clock. */
export function diffGame(pair, { title = 'Spot the Difference', theme = [] } = {}) {
  const pieces = toAuthoring(pair);
  return {
    authoring: 'microgame-authoring/0.1',
    meta: {
      title,
      instructions: `Find the ${pair.diffs.length} differences between the two pictures. Tap either picture where they differ. Three wrong taps or 60 seconds and you're out.`,
      duration_s: 60,
    },
    uses: [
      { fragment: 'diff_spots', params: { scene_w: pair.w, w: 320, h: Math.round((320 * pair.h) / pair.w) } },
      { fragment: 'lives', params: { count: 3 }, bind: { hit: 'spot_missed' } },
      { fragment: 'score', params: { points: 10, label: 'Score' }, bind: { point: 'spot_found' } },
    ],
    functions: pieces.functions,
    objectives: { time_limit: '60s', on_timeout: 'lose' },
    look: { id: 'paper', tokens: {} },
    art: {
      style: 'A flat phone-screenshot look: white chat, grey and blue bubbles.',
      palette: { bg: '#F0F2F5', surface: '#FFFFFF', primary: '#0866FF', accent: '#E4572E', ink: '#1C1E21', danger: '#C8463B', secondary: '#65676B' },
      sprites: pieces.art.sprites,
    },
    content: { theme_words: theme },
    score: { kind: 'points', measures: 'differences found, 10 points each', unit: 'points', direction: 'higher', counts_when: 'any', aggregate: 'best', format: '{n} pts', events: ['spot_found'] },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
  const valued = new Set(['--seed', '--count', '-o']);
  const file = args.find((a, i) => !a.startsWith('-') && !valued.has(args[i - 1])) ?? join(authoringDir, 'examples/group_chat_scene.json');
  const out = opt('-o', join(authoringDir, 'examples/group_chat_diff.authoring.json'));
  const scene = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const pair = makeSpotDifference(scene, { count: Number(opt('--count', 7)), seed: Number(opt('--seed', 7)) });
  if (pair.problems.length) { for (const p of pair.problems) console.error(`problem: ${p}`); process.exit(1); }
  const game = diffGame(pair, { title: 'Group Chat Detective', theme: ['group chat', 'pizza', 'receipts'] });
  writeFileSync(out, JSON.stringify(game, null, 2) + '\n');
  console.log(`wrote ${out}: ${pair.diffs.length} differences (${pair.diffs.map((d) => `${d.id} ${d.kind}`).join(', ')})`);
}
