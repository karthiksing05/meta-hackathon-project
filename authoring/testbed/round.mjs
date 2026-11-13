#!/usr/bin/env node
// One testbed round: rebuild every game in the ring from its stored authoring manifest (no Muse),
// verify it, render its contact sheet, and write a table.
//
//   node authoring/testbed/round.mjs --ring <ring.json> --out <dir> [--only k19,k3] [--legacy]
//
// ring.json: {"games": [{"key", "src" (manifest path), "edits"? (merge patch file), "tall"? (default true)}]}.
// Writes <out>/<key>/manifest.json, rebuild.json, verify.json, <out>/shots/<key>.png and <out>/table.md.
// Needs MG_ENGINE_DIR and Chrome.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { loadEngine } from '../expander/engine.mjs';
import { rebuild } from './rebuild.mjs';
import { verify } from '../verify/verify.mjs';
import { shoot } from './shots.mjs';
import { checkFillStatic } from '../playtest/fill-check.mjs';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const ringFile = resolve(opt('--ring'));
const ring = JSON.parse(readFileSync(ringFile, 'utf8'));
const out = resolve(opt('--out'));
const only = opt('--only')?.split(',') ?? null;
mkdirSync(out, { recursive: true });
const { engine } = await loadEngine();
const rows = [];
for (const g of ring.games) {
  if (only && !only.includes(g.key)) continue;
  const t0 = Date.now();
  const dir = join(out, g.key);
  mkdirSync(dir, { recursive: true });
  const src = JSON.parse(readFileSync(resolve(dirname(ringFile), g.src), 'utf8'));
  const editsFile = g.edits ? resolve(dirname(ringFile), g.edits) : null;
  const edits = editsFile && existsSync(editsFile) ? JSON.parse(readFileSync(editsFile, 'utf8')) : null;
  const tall = !args.includes('--legacy') && g.tall !== false;
  let res;
  try { res = await rebuild(src, { tall, edits, engine, profile: g.profile ?? null }); } catch (e) { res = { manifest: null, record: { ok: false, errors: [String(e.stack ?? e).slice(0, 400)] } }; }
  const runs = res.record.runs ?? null;
  delete res.record.runs;
  writeFileSync(join(dir, 'rebuild.json'), JSON.stringify(res.record, null, 2));
  if (!res.manifest) { rows.push({ key: g.key, error: JSON.stringify(res.record.errors).slice(0, 200) }); console.log(g.key, 'FAILED', JSON.stringify(res.record).slice(0, 400)); continue; }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(res.manifest));
  const rep = await verify(res.manifest, { engine, runs });
  const fill = checkFillStatic(res.manifest);
  writeFileSync(join(dir, 'verify.json'), JSON.stringify({ ...rep, fillStatic: fill }, null, 2));
  let sheet = null;
  try { sheet = (await shoot(res.manifest, { out: join(out, 'shots'), name: g.key, engine })).sheet; } catch (e) { sheet = `render failed: ${e.message}`; }
  const row = {
    key: g.key, tall: !!(res.record.lift?.rules && res.record.lift?.replays), gate: res.record.gate.passed, gateFlags: res.record.gate.flags,
    stages: res.record.stages?.join(' → '), proof: res.record.proof, lift: res.record.lift,  sameRules: res.record.sameRules ?? null, asBuilt: !!res.record.asBuilt, blocking: rep.blocking, warnings: rep.warnings,
    codes: Object.entries(rep.byCode).filter(([, v]) => v.block).map(([k, v]) => `${k}×${v.block}`).join(' '),
    sheet, s: ((Date.now() - t0) / 1000).toFixed(0),
  };
  rows.push(row);
  console.log(`${g.key}: gate ${row.gate ? 'pass' : 'FAIL ' + row.gateFlags.join(',')} | ${row.stages} | final ${rep.blocking} blocking (${row.codes}) | sameRules ${row.sameRules}${row.asBuilt ? " (as built)" : ""} | proof ${JSON.stringify(row.proof)} | lift ${JSON.stringify(row.lift ?? null)} | ${row.s}s`);
  for (const f of rep.findings.filter((x) => x.severity === 'block')) console.log(`   ${f.code} ${f.node} ${f.frame} ×${f.frames}: ${f.message}`);
}
const table = ['| game | canvas | gate | blocking | codes | proof |', '|---|---|---|---|---|---|',
  ...rows.map((r) => r.error ? `| ${r.key} | | error | | ${r.error} | |` : `| ${r.key} | ${r.tall ? 'tall' : '640'} | ${r.gate ? 'pass' : 'FAIL'} | ${r.blocking} | ${r.codes} | ${r.proof ? (r.proof.rules && r.proof.replays ? 'holds' : 'FAILS') : '-'} |`)];
writeFileSync(join(out, 'table.md'), table.join('\n') + '\n');
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
console.log(table.join('\n'));
