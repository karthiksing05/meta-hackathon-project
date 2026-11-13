#!/usr/bin/env node
// Asks real Muse for a qa-bank/1 (authoring/expander/qa-bank.mjs) and prints the bank checker's report.
// Used for the open-text gap measurement (docs/harness-gaps/open-text.md); the generator will call the
// same prompts once it has a content step.
//
// Usage: node authoring/tools/qa-bank-muse.mjs "<request>" [--count 1] [--model muse-wonder-1.0]
//          [--effort low] [--out bank.json] [--puzzle old-bank.json] [--bank start.json]
//          [--refine [--probe probe.json] [--probe-out probe.json]] [--verbose]
// --puzzle: reuse that bank's first case (setup and solution); Muse writes only the facts.
// --bank:   start from an existing bank instead of writing one.
// --refine: Muse writes 40 player questions with true replies (probe), the matcher answers them, and
//           the failures go back to Muse once to repair the bank.
// Reads the Muse key from FacebookClone/Bubbles/Studio/MuseConfig.json or MUSE_CONFIG (in memory only;
// never printed).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bankPrompt, checkBank, probePrompt, probeFailures, repairPrompt } from '../expander/qa-bank.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const request = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--refine', '--verbose'].includes(args[i - 1])));
if (!request) { console.error('usage: qa-bank-muse.mjs "<request>" [options]'); process.exit(2); }

const configPath = process.env.MUSE_CONFIG ?? join(here, '..', '..', 'FacebookClone', 'Bubbles', 'Studio', 'MuseConfig.json');
const key = process.env.MUSE_API_KEY ?? Object.values(JSON.parse(readFileSync(configPath, 'utf8'))).find((v) => typeof v === 'string' && v.length > 20);
const model = opt('model', 'muse-wonder-1.0');
const effort = opt('effort', 'low');

async function muse({ system, user }, step) {
  const t0 = Date.now();
  const call = () => fetch('https://api.meta.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, reasoning_effort: effort, max_tokens: 16000, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(240000),
  });
  // One retry after a network failure (DNS flakes on this Mac), never after an answer.
  const r = await call().catch(async () => { await new Promise((ok) => setTimeout(ok, 3000)); return call(); });
  const j = await r.json();
  if (!r.ok) { console.error(`muse ${r.status}: ${JSON.stringify(j.error ?? j).slice(0, 300)}`); process.exit(1); }
  console.error(`USAGE step=${step} model=${model} effort=${effort} ms=${Date.now() - t0} prompt=${j.usage?.prompt_tokens} completion=${j.usage?.completion_tokens}`);
  const text = j.choices?.[0]?.message?.content ?? '';
  try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { console.error(`not JSON: ${text.slice(0, 300)}`); process.exit(1); }
}

const report = (b, label) => {
  const problems = checkBank(b);
  const facts = (b.cases ?? []).map((c) => (c.facts ?? []).length);
  console.log(`${label}: ${b.cases?.length ?? 0} cases, facts ${facts.join(', ')}; ${problems.filter((p) => p.startsWith('error')).length} errors, ${problems.filter((p) => p.startsWith('warn')).length} warnings`);
  if (args.includes('--verbose')) for (const p of problems) console.log(`  ${p}`);
};

const puzzle = opt('puzzle') ? JSON.parse(readFileSync(opt('puzzle'), 'utf8')).cases[0] : null;
let bank = opt('bank') ? JSON.parse(readFileSync(opt('bank'), 'utf8')) : await muse(bankPrompt({ request, count: Number(opt('count', 1)), puzzle }), 'bank');
report(bank, 'bank');
if (args.includes('--refine')) {
  // One probe and one repair, for the first case.
  const probe = opt('probe') ? JSON.parse(readFileSync(opt('probe'), 'utf8')) : await muse(probePrompt(bank.cases[0]), 'probe');
  if (opt('probe-out')) writeFileSync(opt('probe-out'), JSON.stringify(probe, null, 2) + '\n');
  const before = probeFailures(bank.cases[0], probe.questions);
  console.log(`probe: ${probe.questions?.length ?? 0} questions, ${before.length} answered wrongly or not placed`);
  if (before.length) {
    const fixed = await muse(repairPrompt(bank, before), 'repair');
    const after = probeFailures(fixed.cases[0], probe.questions);
    console.log(`after repair: ${after.length} of ${probe.questions.length} still wrong or not placed`);
    bank = fixed;
    report(bank, 'repaired bank');
  }
}
if (opt('out')) writeFileSync(opt('out'), JSON.stringify(bank, null, 2) + '\n');
