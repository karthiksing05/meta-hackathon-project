#!/usr/bin/env node
// Builds the gold set's derived files from authoring/gold/{story,party,arcade,social,puzzle}.json and the
// games they point at:
//   authoring/gold/index.json  every entry, with its group and title, in one list
//   authoring/gold/pairs.jsonl one chat-format training pair per game: the user turn is the request
//                              as prompts.mjs phrases it, the assistant turn is the design (when the
//                              entry has one) followed by the manifest
// Each game must expand with no errors first. --check exits 1 if the files are stale.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, loadLibrary } from '../expander/expand.mjs';
import * as Prompts from '../expander/prompts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// puzzle.json is optional (the puzzle set may not be there yet).
const GROUPS = ['story', 'party', 'arcade', 'social', 'puzzle'].filter((g) => existsSync(join(root, 'gold', `${g}.json`)));
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
    // The same user turn Muse gets at run time (prompts.mjs), and the reply it should give: the
    // design first, then the manifest.
    const user = Prompts.compose(e.request, e.brief || {});
    const reply = e.design ? { design: e.design, ...manifest } : manifest;
    pairs.push(JSON.stringify({ id: e.id, messages: [{ role: 'user', content: user }, { role: 'assistant', content: JSON.stringify(reply) }] }));
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
