#!/usr/bin/env node
// Writes the engine version of intent matching (authoring/expander/intent.mjs, with the fuzzy.mjs helpers
// it uses) into the qa_bank fragment as private `_qz_*` functions, so the fragment can't drift from the
// JS reference. Only the `_qz_*` functions are replaced; the rest of the file is hand-written.
//
// Usage: node authoring/tools/make-qa-fragment.mjs [--check]   (--check: exit 1 if out of date)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineFunctions } from '../expander/intent.mjs';

const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'fragments', 'qa_bank.fragment.json');
const before = readFileSync(path, 'utf8');
const frag = JSON.parse(before);
const kept = Object.fromEntries(Object.entries(frag.functions ?? {}).filter(([k]) => !k.startsWith('_qz_')));
frag.functions = { ...kept, ...engineFunctions((k) => `_qz_${k}`) };
const after = JSON.stringify(frag, null, 2) + '\n';
if (after === before) console.log('qa_bank fragment is current');
else if (process.argv.includes('--check')) { console.error('qa_bank.fragment.json is out of date: run node authoring/tools/make-qa-fragment.mjs'); process.exit(1); }
else { writeFileSync(path, after); console.log('wrote qa_bank.fragment.json'); }
