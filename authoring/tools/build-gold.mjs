#!/usr/bin/env node
// Builds the gold set's derived files from authoring/gold/{story,party,arcade,social}.json and the
// games they point at:
//   authoring/gold/index.json  every entry, with its group and title, in one list
//   authoring/gold/pairs.jsonl one chat-format training pair per game: the user turn is the request
//                              (as the composer phrases it), the assistant turn is the manifest
// Each game must expand with no errors first. --check exits 1 if the files are stale.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, loadLibrary } from '../expander/expand.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GROUPS = ['story', 'party', 'arcade', 'social'];
const check = process.argv.includes('--check');
const lib = loadLibrary(root);

const index = [];
const pairs = [];
for (const group of GROUPS) {
  for (const e of JSON.parse(readFileSync(join(root, 'gold', `${group}.json`), 'utf8'))) {
    const file = e.file.replace(/^authoring\//, '');
    const text = readFileSync(join(root, file), 'utf8');
    const manifest = JSON.parse(text);
    const errors = expand(manifest, lib).diagnostics.filter((d) => d.severity === 'error');
    if (errors.length) throw new Error(`${e.id}: ${errors[0].code} ${errors[0].message}`);
    const entry = { ...e, group, title: manifest.meta?.title ?? e.id };
    index.push(entry);
    const b = e.brief || {};
    const user = [
      'Make a microgame for this request:', e.request, '',
      `Brief: ${b.intent ?? ''}. Audience: ${b.audience ?? 'everyone'}. Mood: ${(b.mood || []).join(', ')}. ` +
      `Energy: ${b.energy ?? 'medium'}. Competition: ${b.competition ?? 'friendly'}.`,
      '', 'Reply with the complete authoring manifest.',
    ].join('\n');
    pairs.push(JSON.stringify({ id: e.id, messages: [{ role: 'user', content: user }, { role: 'assistant', content: JSON.stringify(manifest) }] }));
  }
}
const outputs = {
  [join(root, 'gold', 'index.json')]: JSON.stringify(index, null, 2) + '\n',
  [join(root, 'gold', 'pairs.jsonl')]: pairs.join('\n') + '\n',
};
let stale = 0;
for (const [path, text] of Object.entries(outputs)) {
  if (check) { if (!existsSync(path) || readFileSync(path, 'utf8') !== text) { console.error(`${path} is out of date`); stale++; } }
  else writeFileSync(path, text);
}
if (stale) { console.error('run: node authoring/tools/build-gold.mjs'); process.exit(1); }
console.log(`${check ? 'checked' : 'wrote'} gold index and pairs: ${index.length} games (${GROUPS.map((g) => `${index.filter((e) => e.group === g).length} ${g}`).join(', ')})`);
