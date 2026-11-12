#!/usr/bin/env node
// node authoring/expander/cli.mjs <manifest.json> [-o game.json] [--map map.json] [--no-validate] [--json]
//
// Expands an authoring manifest (or a beta wrapper with formula "microgame") into game.json, runs
// the engine's validator, and prints diagnostics mapped back to the manifest.
// Exit 0 when there are no errors for the model or the library.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, loadLibrary, translate } from './expand.mjs';
import { loadEngine } from './engine.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function expandAndValidate(manifest, { validate = true, library = loadLibrary(root) } = {}) {
  // A Bubble wrapper (SPEC.md 2.7): the authoring manifest is content.authoring (or `game` in the
  // earlier beta draft).
  const m = manifest.formula === 'microgame' ? manifest.content?.authoring ?? manifest.game ?? manifest : manifest;
  const result = expand(m, library);
  const authoringErrors = result.diagnostics.filter((d) => d.severity === 'error');
  let engineDiagnostics = [];
  if (validate && authoringErrors.length === 0) {
    const { engine } = await loadEngine();
    engineDiagnostics = engine.validate(JSON.stringify(result.game)).map((d) => translate(d, result.sourceMap));
  }
  const all = [...result.diagnostics.map((d) => ({ ...d, audience: d.library ? 'library' : 'model' })), ...engineDiagnostics];
  return { ...result, all, errors: all.filter((d) => d.severity === 'error') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('-') && args[args.indexOf(a) - 1] !== '-o' && args[args.indexOf(a) - 1] !== '--map');
  if (!file) { console.error('usage: cli.mjs <manifest.json> [-o game.json] [--map map.json] [--no-validate] [--json]'); process.exit(2); }
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const r = await expandAndValidate(manifest, { validate: !args.includes('--no-validate') });
  if (opt('-o')) writeFileSync(opt('-o'), JSON.stringify(r.game, null, 2) + '\n');
  if (opt('--map')) writeFileSync(opt('--map'), JSON.stringify(r.sourceMap, null, 2) + '\n');
  if (args.includes('--json')) console.log(JSON.stringify(r.all, null, 2));
  else if (!r.all.length) console.log(`ok: ${file} expands and validates with no diagnostics`);
  else for (const d of r.all) console.log(`${d.severity} ${d.code} [${d.audience}] ${d.at ?? ''} ${d.message}${d.hint ? ` (${d.hint})` : ''}`);
  process.exit(r.errors.length ? 1 : 0);
}
