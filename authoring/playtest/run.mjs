#!/usr/bin/env node
// node authoring/playtest/run.mjs [games...] [--bots N] [--profile NAME] [--json]
// Expands each manifest, validates it in the engine, then runs the bot playtest gate.
// Default: every authoring/games/*.authoring.json. Writes authoring/playtest/report.json.
// Needs MG_ENGINE_DIR (see authoring/expander/engine.mjs). Exit 1 if any game fails.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, loadLibrary } from '../expander/expand.mjs';
import { loadEngine } from '../expander/engine.mjs';
import { DEFAULT_BOTS, playtest } from './gate.mjs';

const authoringDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gamesDir = join(authoringDir, 'games');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const botsIdx = args.indexOf('--bots');
const botCount = botsIdx >= 0 ? Number(args[botsIdx + 1]) : DEFAULT_BOTS.length;
const profileIdx = args.indexOf('--profile');
const profile = profileIdx >= 0 ? args[profileIdx + 1] : null; // a gate profile (bots.mjs GATE_PROFILES)
const files = args.filter((a, i) => !a.startsWith('--') && !(botsIdx >= 0 && i === botsIdx + 1) && !(profileIdx >= 0 && i === profileIdx + 1));
const targets = files.length
  ? files.map((f) => resolve(f))
  : readdirSync(gamesDir).filter((f) => f.endsWith('.authoring.json')).sort().map((f) => join(gamesDir, f));

const log = (...a) => { if (!asJson) console.log(...a); };
const pad = (v, n) => String(v).padEnd(n);
const started = Date.now();
const lib = loadLibrary(authoringDir);
const { engine } = await loadEngine();
const report = [];

for (const file of targets) {
  const name = basename(file).replace(/\.authoring\.json$/, '');
  const entry = { game: name, file, stage: 'expand', passed: false, diagnostics: [], runs: [], flags: [], summary: '' };
  report.push(entry);
  const t0 = Date.now();
  log(`\n== ${name}`);
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    const result = expand(manifest, lib);
    entry.diagnostics = result.diagnostics;
    const expandErrors = result.diagnostics.filter((d) => d.severity === 'error');
    if (expandErrors.length) {
      for (const d of expandErrors) log(`  expand error ${d.code} ${d.at ?? ''} ${d.message}`);
      continue;
    }
    entry.stage = 'validate';
    const validation = engine.validate(JSON.stringify(result.game));
    const validateErrors = validation.filter((d) => d.severity === 'error');
    entry.diagnostics.push(...validation);
    if (validateErrors.length) {
      for (const d of validateErrors) log(`  validate error ${d.code} ${d.at ?? ''} ${d.message}`);
      continue;
    }
    entry.stage = 'gate';
    const res = await playtest(JSON.stringify(result.playtestGame ?? result.game), { bots: DEFAULT_BOTS.slice(0, botCount), profile });
    Object.assign(entry, { runs: res.runs.map((r) => ({ bot: r.bot.label, skill: r.bot.skill, outcome: r.outcome, score: r.score, seconds: Math.round(r.seconds * 10) / 10, ...(r.error ? { error: r.error } : {}) })), flags: res.flags, summary: res.summary, passed: res.passed });
    log(`  ${pad('bot', 18)}${pad('skill', 7)}${pad('outcome', 10)}${pad('score', 8)}seconds`);
    for (const r of entry.runs) log(`  ${pad(r.bot, 18)}${pad(r.skill, 7)}${pad(r.outcome, 10)}${pad(r.score, 8)}${r.seconds}${r.error ? `  ${r.error}` : ''}`);
    for (const f of res.flags) log(`  ${f.blocking ? 'BLOCK' : 'note '} ${f.code}: ${f.message}`);
    log(`  ${res.summary}`);
  } catch (e) {
    entry.error = String(e?.stack ?? e);
    log(`  error: ${e?.message ?? e}`);
  }
  entry.elapsed_s = (Date.now() - t0) / 1000;
  log(`  ${entry.passed ? 'PASS' : 'FAIL'} (${entry.elapsed_s.toFixed(1)} s)`);
}

const failed = report.filter((r) => !r.passed);
writeFileSync(join(authoringDir, 'playtest/report.json'), JSON.stringify(report, null, 2) + '\n');
if (asJson) console.log(JSON.stringify(report, null, 2));
else console.log(`\n${report.length - failed.length}/${report.length} games pass · ${((Date.now() - started) / 1000).toFixed(1)} s total`);
process.exit(failed.length ? 1 : 0);
