#!/usr/bin/env node
// The twist step, offline: give a published game a difficulty twist and prove it made skill show.
//
//   MG_ENGINE_DIR=<engine> node authoring/tools/twist.mjs <manifest.json> --measure [--profile NAME]
//   MG_ENGINE_DIR=<engine> node authoring/tools/twist.mjs <manifest.json> --twist <twist.json> --out <dir>
//        [--profile NAME] [--seeded <dir>]... [--game-id <Prod id>] [--no-verify]
//
// A twist file is written by a person or an agent (no Muse text calls here):
//   {"kind": "ramp"|"constraint"|"limited_resource"|"decoy"|"speed_up"|"late_rule_change"|"combo"|"penalty",
//    "line": "one sentence, shown in the notes", "candidates": [{"kind", "rule"}], "why": "...",
//    "instructions": "a sentence added to meta.instructions so players see the rule",
//    "patches": [ ...ops on content.game_json... ]}
// Patch ops:
//   {"op": "state", "key", "type", "init"}             add or replace a state variable
//   {"op": "rule", "rule": {...}, "after": "<rule id>"} add a rule (at the end, or after that rule)
//   {"op": "sub", "from": "...", "to": "...", "in": "rules"|"objectives"|"presentation"|"state", "count": n}
//                                                      replace exact text in that section's JSON (must match)
//   {"op": "objective", "key", "value"}                set objectives[key]
//   {"op": "event", "name", "payload": {}}             declare an event
//
// The tool measures the skill spread (playtest/bots.mjs skillSpread) before and after, runs the bot gate and the
// verifier (blocking findings must not grow), and checks the score stays inside manifest.score.bounds. It writes
// <out>/manifest.json and <out>/report.json only when the gate passes and the spread improved; exit 1 otherwise.
// Seeded games (ids or slugs found in a --seeded folder's JSON) are refused: their rules stay as they are.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { playtest, DEFAULT_BOTS } from '../playtest/gate.mjs';
import { skillSpread } from '../playtest/bots.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const opts = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const file = args.find((a, i) => !a.startsWith('--') && !['--twist', '--out', '--profile', '--seeded', '--game-id'].includes(args[i - 1]));
if (!file) { console.error('usage: twist.mjs <manifest.json> (--measure | --twist <twist.json> --out <dir>)'); process.exit(2); }

const manifest = JSON.parse(readFileSync(file, 'utf8'));
const asObj = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const game = asObj(manifest.content?.game_json);
if (!game?.rules) { console.error('no content.game_json with rules'); process.exit(2); }
const direction = manifest.score?.direction ?? 'higher';

/** The gate profile: given, else a guess from the objectives (no lose condition: a quiz or puzzle). */
export function guessProfile(g) {
  const lose = String(g.objectives?.lose ?? '').trim();
  return lose && lose !== 'false' ? 'arcade' : 'trivia';
}
const profile = opt('--profile') ?? guessProfile(game);

/** Ids and slugs named in the seeded worlds' JSON (never their private files). */
export function seededKeys(dirs) {
  const keys = new Set();
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.json') && !n.includes('private')) {
        const txt = readFileSync(p, 'utf8');
        for (const m of txt.matchAll(/\b[0-9a-f]{24}\b|\bmg-[a-z0-9-]+\b/g)) keys.add(m[0]);
      }
    }
  };
  for (const d of dirs) if (existsSync(d)) walk(d);
  return keys;
}

async function measure(g) {
  const res = await playtest(JSON.stringify(g), { bots: DEFAULT_BOTS, profile });
  const spread = skillSpread(res.runs, { direction });
  return {
    passed: res.passed, summary: res.summary, spread,
    blocking: res.flags.filter((f) => f.blocking).map((f) => f.code),
    warnings: res.flags.filter((f) => !f.blocking).map((f) => f.code),
    runs: res.runs.map((r) => ({ bot: r.bot.label, outcome: r.outcome, score: r.score, seconds: Math.round(r.seconds) })),
    maxScore: Math.max(...res.runs.filter((r) => r.ok).map((r) => r.score)),
  };
}

async function verifyBlocking(m) {
  try {
    const { verify } = await import('../verify/verify.mjs');
    const report = await verify(m, { measures: null, pixels: false });
    return { pass: report.pass, blocking: report.findings.filter((f) => f.severity === 'block').map((f) => f.code) };
  } catch (e) {
    return { pass: null, blocking: [], error: String(e.message ?? e).slice(0, 200) };
  }
}

/** Applies a twist's patches to a copy of the game. Throws when a patch doesn't apply. */
export function applyTwist(g0, twist) {
  const g = structuredClone(g0);
  for (const p of twist.patches ?? []) {
    switch (p.op) {
      case 'state': g.state[p.key] = { type: p.type, init: String(p.init) }; break;
      case 'event': g.events[p.name] = p.payload ?? {}; break;
      case 'objective': g.objectives[p.key] = p.value; break;
      case 'rule': {
        if (!p.rule?.id) throw new Error('a rule patch needs rule.id');
        if (g.rules.some((r) => r.id === p.rule.id)) throw new Error(`rule ${p.rule.id} exists`);
        const at = p.after ? g.rules.findIndex((r) => r.id === p.after) : -1;
        if (p.after && at < 0) throw new Error(`no rule ${p.after}`);
        g.rules.splice(at >= 0 ? at + 1 : g.rules.length, 0, p.rule);
        break;
      }
      case 'sub': {
        const key = p.in ?? 'rules';
        const txt = JSON.stringify(g[key]);
        // Patterns may be written with JSON's spaced separators; the game's JSON is compact.
        const compact = (s) => s.replace(/": "/g, '":"').replace(/", "/g, '","').replace(/\}, \{/g, '},{').replace(/\], "/g, '],"');
        let [from, to] = [p.from, p.to];
        if (!txt.includes(from)) [from, to] = [compact(p.from), compact(p.to)];
        const n = txt.split(from).length - 1;
        if (!n) throw new Error(`sub: "${p.from}" not found in ${key}`);
        if (p.count != null && n !== p.count) throw new Error(`sub: "${p.from}" found ${n} times in ${key}, expected ${p.count}`);
        g[key] = JSON.parse(txt.split(from).join(to));
        break;
      }
      default: throw new Error(`unknown op ${p.op}`);
    }
  }
  if (twist.instructions && g.meta) g.meta.instructions = `${String(g.meta.instructions ?? '').trim()} ${twist.instructions}`.trim();
  return g;
}

const before = await measure(game);
if (args.includes('--measure')) {
  console.log(JSON.stringify({ title: manifest.title, profile, before }, null, 2));
  process.exit(0);
}

const seeded = seededKeys(opts('--seeded'));
const ids = [manifest.id, manifest.slug, manifest.lineage?.game_id, opt('--game-id')].filter(Boolean);
if (ids.some((k) => seeded.has(k))) { console.error(`refused: ${manifest.title} is a seeded game; its rules stay as they are`); process.exit(3); }

const twist = JSON.parse(readFileSync(opt('--twist'), 'utf8'));
let twisted;
try { twisted = applyTwist(game, twist); } catch (e) { console.error(`patch failed: ${e.message}`); process.exit(1); }
const v = engineValidate(twisted);
const after = await measure(twisted);

const out = structuredClone(manifest);
out.content.game_json = typeof manifest.content.game_json === 'string' ? JSON.stringify(twisted) : twisted;
out.studio = { ...(out.studio ?? {}), twist: { kind: twist.kind, line: twist.line, at: new Date().toISOString() } };

let verifyBefore = { blocking: [] }, verifyAfter = { blocking: [] };
if (!args.includes('--no-verify')) { verifyBefore = await verifyBlocking(manifest); verifyAfter = await verifyBlocking(out); }
const newBlocking = verifyAfter.blocking.filter((c) => !verifyBefore.blocking.includes(c));

const bound = manifest.score?.bounds?.max;
const inBounds = bound == null || direction === 'lower' || after.maxScore <= bound;
const b = before.spread, a = after.spread;
const improved = !!a && a.ok && !a.maxed && (!b || !b.ok || b.maxed || a.margin > b.margin + 0.02);
const ok = (await v) && after.passed && improved && inBounds && !newBlocking.length;
const report = {
  title: manifest.title, id: manifest.id, profile, twist: { kind: twist.kind, line: twist.line },
  before: { passed: before.passed, spread: b, blocking: before.blocking, summary: before.summary },
  after: { passed: after.passed, spread: a, blocking: after.blocking, warnings: after.warnings, summary: after.summary, runs: after.runs },
  verify: { before: verifyBefore.blocking, after: verifyAfter.blocking, newBlocking, error: verifyAfter.error ?? null },
  inBounds, improved, ok,
};
console.log(JSON.stringify(report, null, 2));
if (ok && opt('--out')) {
  const dir = resolve(opt('--out'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(out));
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
process.exit(ok ? 0 : 1);

async function engineValidate(g) {
  const { loadEngine } = await import('../expander/engine.mjs');
  const { engine } = await loadEngine();
  const errors = engine.validate(JSON.stringify(g)).filter((d) => d.severity === 'error');
  if (errors.length) { console.error(`engine validate: ${errors.slice(0, 3).map((d) => `${d.code} ${d.message}`).join('; ')}`); return false; }
  return true;
}
