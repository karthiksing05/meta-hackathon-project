#!/usr/bin/env node
// Asks real Muse for a story graph, checks it, repairs it from the checker's errors, then compiles it
// and plays it with the story bots in the engine (when one is built).
//
//   node authoring/tools/story-muse.mjs "<request>" [--out dir] [--repairs 1] [--effort low]
//
// Needs the Muse key in FacebookClone/Bubbles/Studio/MuseConfig.json (or MUSE_CONFIG pointing at a
// copy); the key stays in memory and is never printed. MG_ENGINE_DIR for the engine steps.
// Writes <out>/graph.json, <out>/report.json, <out>/authoring.json and <out>/usage.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadMuseConfig, museJSON } from '../../tools/harness-eval/lib.mjs';
import { validateStoryGraph, compileStoryGraph, storyIssueLines } from '../expander/story-graph.mjs';
import { STORY_GRAPH_SYSTEM, STORY_MUSE_OPTIONS, STORY_REPAIR_OPTIONS, storyGraphUser, storyRepairUser } from '../expander/story-prompt.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const request = args.find((a, i) => !a.startsWith('--') && !['--out', '--repairs', '--effort'].includes(args[i - 1]));
if (!request) { console.error('usage: story-muse.mjs "<request>" [--out dir] [--repairs 1] [--effort low]'); process.exit(2); }
const out = resolve(opt('--out', 'story-muse-out'));
const repairs = Number(opt('--repairs', 1));
const effort = opt('--effort', STORY_MUSE_OPTIONS.effort);
mkdirSync(out, { recursive: true });

const config = loadMuseConfig();
if (!config) { console.error('no Muse key (MuseConfig.json or MUSE_API_KEY)'); process.exit(2); }

const usage = [];
async function ask(step, user, o) {
  const t0 = Date.now();
  const r = await museJSON(config, { model: o.model, system: STORY_GRAPH_SYSTEM, user, maxTokens: o.max_tokens, effort, timeoutMs: 240000 });
  usage.push({ step, model: r.model, seconds: Math.round((Date.now() - t0) / 100) / 10, prompt_tokens: r.usage?.prompt_tokens ?? null, completion_tokens: r.usage?.completion_tokens ?? null });
  console.log(`${step}: ${usage.at(-1).seconds} s, ${usage.at(-1).prompt_tokens} prompt / ${usage.at(-1).completion_tokens} completion tokens`);
  return r.value;
}

let graph = await ask('draft', storyGraphUser(request), STORY_MUSE_OPTIONS);
let report = validateStoryGraph(graph);
const rounds = [{ round: 0, ok: report.ok, errors: report.errors.length, warnings: report.warnings.length, codes: report.errors.map((e) => e.code) }];
console.log(`draft: ${report.ok ? 'valid' : 'invalid'} · ${report.errors.length} errors, ${report.warnings.length} warnings`);
for (const l of storyIssueLines(report)) console.log('  ' + l);
writeFileSync(join(out, 'graph.draft.json'), JSON.stringify(graph, null, 2) + '\n');

for (let i = 1; i <= repairs && !report.ok; i++) {
  graph = await ask(`repair ${i}`, storyRepairUser(request, graph, report), STORY_REPAIR_OPTIONS);
  report = validateStoryGraph(graph);
  rounds.push({ round: i, ok: report.ok, errors: report.errors.length, warnings: report.warnings.length, codes: report.errors.map((e) => e.code) });
  console.log(`repair ${i}: ${report.ok ? 'valid' : 'invalid'} · ${report.errors.length} errors, ${report.warnings.length} warnings`);
  for (const l of storyIssueLines(report)) console.log('  ' + l);
}
writeFileSync(join(out, 'graph.json'), JSON.stringify(graph, null, 2) + '\n');
const { graph: _g, ...plain } = report;
writeFileSync(join(out, 'report.json'), JSON.stringify({ request, rounds, ...plain }, null, 2) + '\n');
writeFileSync(join(out, 'usage.json'), JSON.stringify(usage, null, 2) + '\n');
console.log('stats', JSON.stringify({ ...report.stats, endings_detail: undefined }));
if (report.stats.endings_detail) console.table(report.stats.endings_detail);
if (!report.ok) process.exit(1);

const { manifest } = compileStoryGraph(graph, { report });
writeFileSync(join(out, 'authoring.json'), JSON.stringify(manifest, null, 2) + '\n');
let engine = null;
try { ({ engine } = await (await import('../expander/engine.mjs')).loadEngine()); } catch (e) { console.log(`engine: skipped (${e.message.split('.')[0]})`); }
if (engine) {
  const { expandAndValidate } = await import('../expander/cli.mjs');
  const { storyGate } = await import('../playtest/story-bots.mjs');
  const x = await expandAndValidate(manifest);
  console.log(`expand + engine validate: ${x.errors.length} errors`);
  for (const d of x.errors) console.log(`  ${d.code} ${d.at ?? ''} ${d.message}`);
  if (!x.errors.length) {
    const gate = storyGate(engine, JSON.stringify(x.game), report, manifest);
    for (const r of gate.runs) console.log(`  ${r.bot.label.padEnd(20)} ${r.outcome.padEnd(8)} ${String(r.score).padEnd(6)} ${r.ending} in ${r.choices}${r.mismatch ? '  MISMATCH ' + r.mismatch : ''}`);
    for (const f of gate.flags) console.log(`  ${f.blocking ? 'BLOCK' : 'note '} ${f.code}: ${f.message}`);
    console.log(`story gate: ${gate.passed ? 'PASS' : 'FAIL'} · ${gate.summary}`);
    writeFileSync(join(out, 'gate.json'), JSON.stringify({ passed: gate.passed, summary: gate.summary, flags: gate.flags, runs: gate.runs.map(({ replay, ...r }) => r) }, null, 2) + '\n');
    process.exit(gate.passed ? 0 : 1);
  }
  process.exit(1);
}
