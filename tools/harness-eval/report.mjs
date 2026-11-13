#!/usr/bin/env node
// Builds a scorecard from a scored run folder: <run>/scorecard.json and <run>/scorecard.md, with a
// row per entry, aggregates by specificity and category, the worst entries, and a text contact sheet
// (title, instructions, art roles, what the judge says is missing).
//
//   node tools/harness-eval/report.mjs RUN_DIR

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readJSONIf, median, mean } from './lib.mjs';

export function collect(dir) {
  const rows = [];
  for (const id of fs.readdirSync(dir).sort()) {
    const run = readJSONIf(path.join(dir, id, 'run.json'));
    if (!run) continue;
    const entry = readJSONIf(path.join(dir, id, 'entry.json')) || {};
    const score = readJSONIf(path.join(dir, id, 'score.json')) || {};
    const j = score.judge && !score.judge.error ? score.judge : null;
    rows.push({
      id, specificity: entry.specificity, category: entry.category, source: entry.source, request: entry.request,
      produced: run.produced, title: run.title, instructions: score.precheck?.instructions || run.oneLineRule || null,
      roles: score.precheck?.roles || [],
      keywordHits: score.precheck ? score.precheck.hitCount : null, keywordTerms: score.precheck ? score.precheck.terms : null,
      keywordHitList: score.precheck ? Object.keys(score.precheck.hits) : [],
      mustHave: j ? j.mustHaveCoverage : run.produced ? null : 0,
      mustHaveVerified: j ? j.mustHaveVerifiedCoverage : run.produced ? null : 0,
      missingItems: j ? j.mustHave.filter((x) => !x.present).map((x) => x.item) : [],
      niceToHave: j ? j.niceToHaveCoverage : null,
      mustNotViolations: j ? j.mustNotViolations : null,
      theme: j ? j.theme : run.produced ? null : 0,
      customRule: j ? j.customRule : null,
      feel: j ? j.feel : null,
      judgeMissing: j ? j.missing : run.produced ? (score.judge?.error ? `judge error: ${score.judge.error}` : '') : 'no game produced',
      themeReason: j ? j.themeReason : '',
      gatePassed: run.gate ? run.gate.passed : false,
      logicOK: score.logic?.allOK ?? null,
      canLose: score.logic?.canLose ?? null, lengthOK: score.logic?.lengthOK ?? null, spreadOK: score.logic?.spreadOK ?? null,
      blocking: score.logic?.blocking || [],
      firstDraftValid: run.firstDraftValid, repairRounds: run.repairRounds, playtestRepair: run.playtestRepair,
      timeToFirstValid: run.timeToFirstValidSeconds, seconds: run.composeSeconds ?? run.wallSeconds, wallSeconds: run.wallSeconds,
      museCalls: run.museCalls, authoringBytes: run.authoringBytes, gameBytes: run.gameBytes,
      errors: [...(run.errors || []), ...(run.failed ? [run.failed] : [])],
    });
  }
  return rows;
}

const pct = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined); return v.length ? v.filter(Boolean).length / v.length : null; };

export function aggregate(rows) {
  return {
    n: rows.length,
    produced: pct(rows.map((r) => r.produced)),
    mustHave: mean(rows.map((r) => r.mustHave)),
    mustHaveVerified: mean(rows.map((r) => r.mustHaveVerified)),
    theme: mean(rows.map((r) => r.theme)),
    customRule: mean(rows.map((r) => r.customRule)),
    customRuleN: rows.filter((r) => typeof r.customRule === 'number').length,
    feel: mean(rows.map((r) => r.feel)),
    mustNotViolations: mean(rows.map((r) => r.mustNotViolations)),
    keywordHitRate: mean(rows.filter((r) => r.keywordTerms).map((r) => r.keywordHits / r.keywordTerms)),
    gatePass: pct(rows.map((r) => r.gatePassed)),
    logicOK: pct(rows.map((r) => r.logicOK)),
    firstDraftValid: pct(rows.map((r) => r.firstDraftValid)),
    repairs: mean(rows.map((r) => r.repairRounds)),
    playtestRepairs: rows.filter((r) => r.playtestRepair).length,
    medianSeconds: median(rows.map((r) => r.seconds)),
    medianTimeToFirstValid: median(rows.map((r) => r.timeToFirstValid)),
    medianAuthoringBytes: median(rows.map((r) => r.authoringBytes)),
  };
}

export function groups(rows, key) {
  const out = {};
  for (const r of rows) (out[r[key] || '-'] ||= []).push(r);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, aggregate(v)]));
}

/// Worst first: lowest must-have coverage, then theme, then custom rule.
export function worst(rows, n = 3) {
  const key = (r) => [r.mustHave ?? 0, r.theme ?? 0, r.customRule ?? 2];
  return [...rows].sort((a, b) => { const x = key(a), y = key(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }).slice(0, n);
}

const f = {
  pct: (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`),
  n1: (x) => (x === null || x === undefined ? '–' : x.toFixed(1)),
  n2: (x) => (x === null || x === undefined ? '–' : x.toFixed(2)),
  s: (x) => (x === null || x === undefined ? '–' : `${Math.round(x)} s`),
  b: (x) => (x === null || x === undefined ? '–' : x ? 'yes' : 'no'),
};

function aggTable(title, map) {
  const lines = [`### ${title}`, '', '| group | n | must_have | verified | theme /2 | rule /2 (n) | feel /2 | must_not hits | gate pass | first draft valid | repairs | median time |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const [k, a] of Object.entries(map)) {
    lines.push(`| ${k} | ${a.n} | ${f.pct(a.mustHave)} | ${f.pct(a.mustHaveVerified)} | ${f.n2(a.theme)} | ${a.customRuleN ? `${f.n2(a.customRule)} (${a.customRuleN})` : '–'} | ${f.n2(a.feel)} | ${f.n2(a.mustNotViolations)} | ${f.pct(a.gatePass)} | ${f.pct(a.firstDraftValid)} | ${f.n1(a.repairs)} | ${f.s(a.medianSeconds)} |`);
  }
  return lines.join('\n');
}

export function markdown(name, rows) {
  const all = aggregate(rows);
  const out = [`# Harness eval scorecard: ${name}`, '',
    `${rows.length} entries · ${f.pct(all.produced)} produced a game · gate pass ${f.pct(all.gatePass)} · median ${f.s(all.medianSeconds)} per game (first valid at ${f.s(all.medianTimeToFirstValid)})`, '',
    aggTable('Overall', { all }), '', aggTable('By specificity', groups(rows, 'specificity')), '', aggTable('By category', groups(rows, 'category')), '',
    '## Per entry', '',
    '| id | title | kw | must_have | theme | rule | feel | must_not | gate | logic | 1st valid | repairs | time | bytes |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    out.push(`| ${r.id} | ${r.produced ? r.title : '**no game**'} | ${r.keywordTerms ? `${r.keywordHits}/${r.keywordTerms}` : '–'} | ${f.pct(r.mustHave)} | ${r.theme ?? '–'} | ${r.customRule ?? 'n/a'} | ${r.feel ?? '–'} | ${r.mustNotViolations ?? '–'} | ${r.gatePassed ? 'pass' : 'FLAG'} | ${r.logicOK === null ? '–' : r.logicOK ? 'ok' : 'FLAG' + (r.blocking.length ? ` (${r.blocking.join(',')})` : '')} | ${f.b(r.firstDraftValid)} | ${r.repairRounds ?? '–'}${r.playtestRepair ? '+p' : ''} | ${f.s(r.seconds)} | ${r.authoringBytes ?? '–'} |`);
  }
  out.push('', '## Worst 3', '');
  for (const r of worst(rows)) {
    out.push(`- **${r.id}** — "${r.request}" → *${r.title || 'no game'}* · must_have ${f.pct(r.mustHave)}, theme ${r.theme ?? '–'}, rule ${r.customRule ?? 'n/a'}`);
    if (r.missingItems.length) out.push(`  - missing: ${r.missingItems.join('; ')}`);
    if (r.judgeMissing) out.push(`  - judge: ${r.judgeMissing}`);
  }
  out.push('', '## Contact sheet', '');
  for (const r of rows) {
    out.push(`**${r.id}** · "${r.request}"`, `> ${r.produced ? `**${r.title}** — ${r.instructions || ''}` : 'no game'}  `,
      `> roles: ${r.roles.join(', ') || '–'} · theme words hit: ${r.keywordHitList.join(', ') || 'none'}  `,
      `> judge: ${r.judgeMissing || '–'}${r.errors.length ? `  \n> errors: ${r.errors.join(' | ')}` : ''}`, '');
  }
  return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = parseArgs(process.argv.slice(2));
  const runDir = args._[0] && path.resolve(args._[0]);
  if (!runDir) { console.error('usage: report.mjs RUN_DIR'); process.exit(64); }
  const rows = collect(runDir);
  const card = { run: path.basename(runDir), generatedAt: new Date().toISOString(), overall: aggregate(rows), bySpecificity: groups(rows, 'specificity'), byCategory: groups(rows, 'category'), entries: rows, worst: worst(rows).map((r) => r.id) };
  fs.writeFileSync(path.join(runDir, 'scorecard.json'), JSON.stringify(card, null, 2));
  fs.writeFileSync(path.join(runDir, 'scorecard.md'), markdown(path.basename(runDir), rows));
  console.log(`Wrote ${path.join(runDir, 'scorecard.md')} and scorecard.json`);
}
