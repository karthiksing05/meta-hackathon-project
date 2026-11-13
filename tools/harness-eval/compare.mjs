#!/usr/bin/env node
// Compares two scored run folders (for example a baseline and a run after a prompt change):
// aggregates side by side with deltas, then every entry both runs have.
//
//   node tools/harness-eval/compare.mjs BEFORE_DIR AFTER_DIR [--out FILE.md]

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './lib.mjs';
import { collect, aggregate, groups } from './report.mjs';

const args = parseArgs(process.argv.slice(2));
const [a, b] = args._.map((p) => path.resolve(p));
if (!a || !b) { console.error('usage: compare.mjs BEFORE_DIR AFTER_DIR [--out FILE.md]'); process.exit(64); }
const before = collect(a), after = collect(b);

const metrics = [
  ['must_have', 'mustHave', 'pct'], ['verified', 'mustHaveVerified', 'pct'], ['theme /2', 'theme', 'num'],
  ['rule /2', 'customRule', 'num'], ['feel /2', 'feel', 'num'], ['must_not hits', 'mustNotViolations', 'num', true],
  ['keyword hit rate', 'keywordHitRate', 'pct'], ['gate pass', 'gatePass', 'pct'], ['first draft valid', 'firstDraftValid', 'pct'],
  ['repairs', 'repairs', 'num', true], ['median time (s)', 'medianSeconds', 'num', true], ['produced', 'produced', 'pct'],
];
const fmt = (x, kind) => (x === null || x === undefined ? '–' : kind === 'pct' ? `${Math.round(x * 100)}%` : x.toFixed(2));
const delta = (x, y, kind, lowerBetter) => {
  if (x === null || y === null || x === undefined || y === undefined) return '';
  const d = y - x;
  if (Math.abs(d) < 1e-9) return '=';
  const better = lowerBetter ? d < 0 : d > 0;
  return `${d > 0 ? '+' : ''}${kind === 'pct' ? `${Math.round(d * 100)} pts` : d.toFixed(2)} ${better ? '▲' : '▼'}`;
};

function table(title, x, y) {
  const lines = [`### ${title}`, '', `| metric | ${path.basename(a)} | ${path.basename(b)} | change |`, '|---|---|---|---|'];
  for (const [label, key, kind, lowerBetter] of metrics) lines.push(`| ${label} | ${fmt(x?.[key], kind)} | ${fmt(y?.[key], kind)} | ${delta(x?.[key], y?.[key], kind, lowerBetter)} |`);
  return lines.join('\n');
}

const out = [`# Harness eval: ${path.basename(a)} → ${path.basename(b)}`, '', table('Overall', aggregate(before), aggregate(after)), ''];
for (const key of ['specificity', 'category']) {
  const gx = groups(before, key), gy = groups(after, key);
  for (const g of [...new Set([...Object.keys(gx), ...Object.keys(gy)])].sort()) out.push(table(`${key}: ${g}`, gx[g], gy[g]), '');
}
out.push('## Per entry', '', '| id | before | after | must_have | theme | rule | gate | time |', '|---|---|---|---|---|---|---|---|');
const byId = Object.fromEntries(after.map((r) => [r.id, r]));
for (const x of before) {
  const y = byId[x.id];
  if (!y) continue;
  const pair = (p, q, kind) => `${fmt(p, kind)} → ${fmt(q, kind)}`;
  out.push(`| ${x.id} | ${x.title || 'no game'} | ${y.title || 'no game'} | ${pair(x.mustHave, y.mustHave, 'pct')} | ${x.theme ?? '–'} → ${y.theme ?? '–'} | ${x.customRule ?? 'n/a'} → ${y.customRule ?? 'n/a'} | ${x.gatePassed ? 'pass' : 'FLAG'} → ${y.gatePassed ? 'pass' : 'FLAG'} | ${Math.round(x.seconds ?? 0)} → ${Math.round(y.seconds ?? 0)} s |`);
}
const text = out.join('\n');
if (args.out) fs.writeFileSync(path.resolve(args.out), text);
console.log(text);
