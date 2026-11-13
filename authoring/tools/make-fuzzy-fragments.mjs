#!/usr/bin/env node
// Writes the engine version of fuzzy matching (authoring/expander/fuzzy.mjs) into the fragments that
// carry it, so they can't drift from the JS reference:
//   - fuzzy_match: helpers private (`_fz_*`), `fuzzy_key score passes entry best ok` public;
//   - typed_answer: everything private (`_fm_*`).
// Only the generated state entries and functions are replaced; the rest of each file is hand-written.
//
// Usage: node authoring/tools/make-fuzzy-fragments.mjs [--check]   (--check: exit 1 if out of date)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineFunctions, engineState } from '../expander/fuzzy.mjs';

const fragmentsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fragments');
const PUBLIC = new Set(['key', 'score', 'passes', 'entry', 'best', 'ok']);

const TARGETS = [
  { file: 'fuzzy_match.fragment.json', name: (k) => (PUBLIC.has(k) ? `fuzzy_${k}` : `_fz_${k}`), owned: /^(fuzzy_|_fz_)/ },
  { file: 'typed_answer.fragment.json', name: (k) => `_fm_${k}`, owned: /^_fm_/ },
];

const check = process.argv.includes('--check');
let stale = 0;
for (const t of TARGETS) {
  const path = join(fragmentsDir, t.file);
  const before = readFileSync(path, 'utf8');
  const frag = JSON.parse(before);
  const keep = (section) => Object.fromEntries(Object.entries(frag[section] ?? {}).filter(([k]) => !t.owned.test(k)));
  frag.state = { ...keep('state'), ...engineState(t.name) };
  frag.functions = { ...keep('functions'), ...engineFunctions(t.name) };
  const after = JSON.stringify(frag, null, 2) + '\n';
  if (after === before) continue;
  stale++;
  if (check) console.error(`${t.file} is out of date: run node authoring/tools/make-fuzzy-fragments.mjs`);
  else { writeFileSync(path, after); console.log(`wrote ${t.file}`); }
}
if (check && stale) process.exit(1);
if (!stale) console.log('fuzzy fragments are current');
