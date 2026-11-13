#!/usr/bin/env node
// Generates one game per suite entry through the existing Studio CLI (bubble-studio --microgame,
// MicrogameComposer unchanged) and stores what came out, one folder per entry:
//
//   <out>/<id>/entry.json            the suite entry
//   <out>/<id>/app-brief.json        what the app's brief step (bubble-studio brief) drafts for the request
//   <out>/<id>/manifest.json         the saved Bubble manifest (when the CLI wrote one)
//   <out>/<id>/authoring.json        content.authoring_json, parsed
//   <out>/<id>/game.json             content.game_json, parsed
//   <out>/<id>/anatomy.json          (--anatomy) the drafted anatomy, auto-answers and the agreed text
//   <out>/<id>/cli.log               the CLI's stdout + stderr
//   <out>/<id>/run.json              parsed run: validity, repairs, gate report, timings, bytes, errors
//
//   node tools/harness-eval/run.mjs --out DIR [--only id,id|category|specificity|source]
//        [--config MuseConfig.json] [--cli PATH] [--fake-muse] [--repairs N] [--skip-existing] [--no-brief]
//        [--anatomy [--anatomy-helper PATH]]
//
// --anatomy: before composing, drafts the game anatomy the way Studio does (anatomy-helper, built by
// build-anatomy.sh: GameAnatomyMuse on the fast model), answers its open questions with their first
// option, and composes with "<request>\n\n<agreed anatomy text>" as the request, the way
// StudioModel.microgameRequestText does. The judge still scores against the entry's own request.
//
// Runs sequentially (Muse rate limits). Build the CLI first: tools/harness-eval/build-cli.sh.
// Never prints the key; --config only passes the file path on to the CLI.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs, loadSuite, selectEntries, repoRoot, here, defaultConfigPath } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.out) { console.error('usage: run.mjs --out DIR [--only ...] [--fake-muse]'); process.exit(64); }
const outDir = path.resolve(args.out);
const cli = path.resolve(args.cli || path.join(here, '.build/bubble-studio'));
const config = path.resolve(args.config || defaultConfigPath());
if (!fs.existsSync(cli)) { console.error(`no CLI at ${cli}; run tools/harness-eval/build-cli.sh`); process.exit(1); }
const entries = selectEntries(loadSuite(args.suite ? path.resolve(args.suite) : undefined), args.only);

const helper = path.resolve(args['anatomy-helper'] || path.join(here, '.build/anatomy-helper'));
if (args.anatomy && !fs.existsSync(helper)) { console.error(`no anatomy helper at ${helper}; run tools/harness-eval/build-anatomy.sh`); process.exit(1); }

function run(argv, timeoutMs, bin = cli) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(bin, argv, { cwd: repoRoot });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => { out += `\nerror: harness-eval timed out after ${timeoutMs / 1000} s\n`; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, out, seconds: (Date.now() - started) / 1000 }); });
  });
}

/// Reads the CLI's microgame output (tools/bubble-studio/microgame.swift) into numbers.
function parseLog(log) {
  const r = {
    events: [], repairIssues: [], firstValidAt: null, failed: null, valid: null, validationErrors: null,
    roundTrip: null, gate: null, museCalls: null, models: [], firstDraftValid: null, repairRounds: null,
    playtestRepair: false, composeSeconds: null, errors: [],
  };
  let inGate = false;
  for (const line of log.split('\n')) {
    let m;
    if ((m = line.match(/^\[\s*([\d.]+)s\] (\w+)\s*(.*)$/))) {
      const [, t, kind, rest] = m;
      r.events.push({ t: +t, kind, detail: rest.trim() });
      if (kind === 'playtesting' && r.firstValidAt === null) r.firstValidAt = +t;
      if (kind === 'failed') r.failed = rest.trim();
      inGate = false;
      continue;
    }
    if ((m = line.match(/^\s{11}· (.*)$/))) { r.repairIssues.push(m[1]); continue; }
    if ((m = line.match(/^Validation: (valid|INVALID) \((\d+) errors.*re-expands to content\.game_json: (yes|NO)/))) {
      r.valid = m[1] === 'valid'; r.validationErrors = +m[2]; r.roundTrip = m[3] === 'yes'; inGate = false; continue;
    }
    if ((m = line.match(/^Gate: (passed|FLAGGED) · (.*?) · (.*)$/))) {
      r.gate = { passed: m[1] === 'passed', headline: m[2], spread: m[3], runs: [], flags: [] }; inGate = true; continue;
    }
    if (inGate && (m = line.match(/^\s{2}(.+?)\s+skill ([\d.]+)\s+(\S+)\s+score (-?[\d.]+)\s+([\d.]+) s(?:\s+error: (.*))?$/))) {
      r.gate.runs.push({ bot: m[1].trim(), skill: +m[2], outcome: m[3], score: +m[4], seconds: +m[5], error: m[6] || null }); continue;
    }
    if (inGate && (m = line.match(/^\s{2}(BLOCKING|note) (\w+): (.*)$/))) {
      r.gate.flags.push({ blocking: m[1] === 'BLOCKING', code: m[2], message: m[3] }); continue;
    }
    if ((m = line.match(/^Muse: (\d+) calls \((.*?)\) · first draft (valid|invalid) · (\d+) repair rounds( \+ 1 playtest repair)? · ([\d.]+) s/))) {
      r.museCalls = +m[1]; r.models = m[2].split(', ').filter(Boolean); r.firstDraftValid = m[3] === 'valid';
      r.repairRounds = +m[4]; r.playtestRepair = !!m[5]; r.composeSeconds = +m[6]; inGate = false; continue;
    }
    if ((m = line.match(/^error: (.*)$/))) r.errors.push(m[1]);
  }
  // The last "playtested" event is the gate verdict even when the CLI died before printing "Gate:".
  if (!r.gate) {
    const last = [...r.events].reverse().find((e) => e.kind === 'playtested');
    if (last) {
      const m = last.detail.match(/^(passed|FLAGGED): (.*?) · (.*)$/);
      if (m) r.gate = { passed: m[1] === 'passed', headline: m[2], spread: m[3], runs: [], flags: [] };
    }
  }
  return r;
}

async function runEntry(entry) {
  const dir = path.join(outDir, entry.id);
  if (args['skip-existing'] && fs.existsSync(path.join(dir, 'run.json'))) { console.log(`skip ${entry.id}`); return; }
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['manifest.json', 'authoring.json', 'game.json', 'app-brief.json', 'anatomy.json']) fs.rmSync(path.join(dir, f), { force: true });
  fs.writeFileSync(path.join(dir, 'entry.json'), JSON.stringify(entry, null, 2));
  const started = Date.now();
  console.log(`\n== ${entry.id} (${entry.specificity}, ${entry.category}): ${entry.request}`);

  // The app drafts a brief first (StudioModel.draftBrief), then hands it to the composer. The CLI's
  // --microgame mode can't take a brief, so it composes with BubbleBrief(intent: request); we still
  // record what the app's brief step would have said, to see what a brief carries.
  let appBrief = null;
  if (!args['no-brief'] && !args['fake-muse']) {
    const b = await run(['brief', '--prompt', entry.request, '--config', config], 120000);
    const m = b.out.match(/\{[\s\S]*\}/);
    try { appBrief = m ? JSON.parse(m[0]) : null; } catch { appBrief = null; }
    if (appBrief) fs.writeFileSync(path.join(dir, 'app-brief.json'), JSON.stringify(appBrief, null, 2));
    appBrief = { ok: !!appBrief, seconds: b.seconds, source: (b.out.match(/brief in .*\((.*)\)/) || [])[1] || null };
  }

  let composeRequest = entry.request, anatomy = null;
  if (args.anatomy) {
    const file = path.join(dir, 'anatomy.json');
    const h = await run(['--request', entry.request, '--out', file, '--config', config], 120000, helper);
    const drafted = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    if (drafted) {
      composeRequest = drafted.requestText;
      const parts = drafted.anatomy?.parts || {};
      anatomy = {
        ok: true, seconds: drafted.seconds, wallSeconds: h.seconds, model: drafted.model, fragments: drafted.fragments,
        title: drafted.anatomy?.title, counts: drafted.counts, answered: drafted.answered, theme: drafted.theme,
        partsPresent: Object.keys(parts), agreedChars: drafted.agreedText.length,
      };
      console.log(`   ${h.out.trim().split('\n').pop()}`);
    } else {
      anatomy = { ok: false, wallSeconds: h.seconds, error: h.out.trim().slice(-300) };
      console.log(`   anatomy FAILED, composing with the bare request: ${anatomy.error}`);
    }
  }

  const argv = ['--microgame', composeRequest, '--out', path.join(dir, 'manifest.json'), '--config', config];
  if (args['fake-muse']) argv.push('--fake-muse');
  if (args.repairs) argv.push('--repairs', String(args.repairs));
  const g = await run(argv, 900000);
  fs.writeFileSync(path.join(dir, 'cli.log'), g.out);
  const parsed = parseLog(g.out);

  let manifest = null, authoringBytes = null, gameBytes = null, title = null, rule = null, briefUsed = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { /* no game */ }
  if (manifest) {
    const a = manifest.content?.authoring_json, gm = manifest.content?.game_json;
    if (a) { fs.writeFileSync(path.join(dir, 'authoring.json'), JSON.stringify(JSON.parse(a), null, 2)); authoringBytes = Buffer.byteLength(a); }
    if (gm) { fs.writeFileSync(path.join(dir, 'game.json'), JSON.stringify(JSON.parse(gm), null, 2)); gameBytes = Buffer.byteLength(gm); }
    title = manifest.title; rule = manifest.one_line_rule; briefUsed = manifest.brief || null;
  }
  const result = {
    id: entry.id,
    request: entry.request,
    mode: args.anatomy ? 'anatomy' : 'plain',
    anatomy,
    fake: !!args['fake-muse'],
    exitCode: g.code,
    produced: !!manifest,
    title, oneLineRule: rule,
    briefUsedByCompose: briefUsed,
    appBriefStep: appBrief,
    valid: parsed.valid,
    roundTrip: parsed.roundTrip,
    firstDraftValid: parsed.firstDraftValid,
    repairRounds: parsed.repairRounds,
    playtestRepair: parsed.playtestRepair,
    repairIssues: parsed.repairIssues,
    gate: parsed.gate,
    museCalls: parsed.museCalls,
    models: parsed.models,
    timeToFirstValidSeconds: parsed.firstValidAt,
    composeSeconds: parsed.composeSeconds,
    wallSeconds: g.seconds,
    entrySeconds: (Date.now() - started) / 1000,
    authoringBytes, gameBytes,
    failed: parsed.failed,
    errors: parsed.errors,
  };
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(result, null, 2));
  console.log(`   ${manifest ? `"${title}"` : 'NO GAME'} · valid ${parsed.valid} · first draft ${parsed.firstDraftValid} · repairs ${parsed.repairRounds}` +
    `${parsed.playtestRepair ? '+playtest' : ''} · gate ${parsed.gate ? (parsed.gate.passed ? 'passed' : 'FLAGGED') : '-'} · ${g.seconds.toFixed(1)} s` +
    (parsed.errors.length ? ` · ${parsed.errors.join(' | ')}` : ''));
}

const t0 = Date.now();
fs.mkdirSync(outDir, { recursive: true });
for (const entry of entries) await runEntry(entry);
console.log(`\n${entries.length} entries in ${((Date.now() - t0) / 60000).toFixed(1)} min → ${outDir}`);
