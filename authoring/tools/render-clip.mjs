#!/usr/bin/env node
// Renders melody clips to WAV files so a person can listen to them.
//
//   node authoring/tools/render-clip.mjs <clip.json | manifest.authoring.json> [out-dir]
//   node authoring/tools/render-clip.mjs --styles [out-dir]     one demo clip per era style
//
// A clip file holds one clip object or a list of them; a manifest's `sound.clips` are rendered too.
// Files are named <name>_<i>.wav. Prints each clip's length, size and any problems.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { renderClip, STYLES } from '../expander/melody.mjs';

const args = process.argv.slice(2);
if (!args.length) {
  console.log('usage: render-clip.mjs <clip.json | manifest.json> [out-dir]   or   render-clip.mjs --styles [out-dir]');
  process.exit(2);
}

let clips, name, outDir;
if (args[0] === '--styles') {
  // One original demo phrase per style, over the same chords, so the styles can be compared.
  const lead = 'A4/8 C5 E5 A5/4 G5/8 E5 D5/4 C5/8 D5 E5/2 r/8 E5/8 G5/8 A5/8 G5/4 E5/4 C5/2 r/2';
  clips = Object.keys(STYLES).map((style) => ({ style, bars: 4, lead, chords: 'Am F C G', label: style }));
  const fast = clips.find((c) => c.style === '50s');
  if (fast) fast.bpm = 140;
  name = 'style';
  outDir = args[1] || '.';
} else {
  const j = JSON.parse(readFileSync(args[0], 'utf8'));
  clips = Array.isArray(j) ? j : j.sound?.clips ?? [j];
  name = basename(args[0]).replace(/\.(authoring\.)?json$/, '');
  outDir = args[1] || '.';
}
mkdirSync(outDir, { recursive: true });
let bad = 0;
clips.forEach((c, i) => {
  const r = renderClip(c);
  const label = c?.label ?? c?.style ?? '';
  if (!r.ok) {
    bad++;
    console.log(`${i} ${label}: ${r.problems.map((p) => `${p.at || '/'} ${p.message}`).join('; ')}`);
    return;
  }
  const file = join(outDir, `${name}_${i}${label ? '_' + String(label).replace(/[^a-z0-9]+/gi, '-') : ''}.wav`);
  writeFileSync(file, r.bytes);
  console.log(`${i} ${label}: ${(r.ms / 1000).toFixed(1)} s, ${(r.bytes.length / 1024).toFixed(0)} KB -> ${file}`);
});
process.exit(bad ? 1 : 0);
