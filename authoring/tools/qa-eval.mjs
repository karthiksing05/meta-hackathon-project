#!/usr/bin/env node
// How well does a build-time qa bank answer the questions real players type?
// For each puzzle in a fixture (default authoring/tools/fixtures/qa-eval.json), matches every held-out
// player question with the intent matcher (authoring/expander/intent.mjs) and sorts it into:
//   right   - matched a fact whose reply is one the solution supports;
//   unclear - matched nothing (the game says "ask another way"; costs no question);
//   wrong   - matched a fact with a reply the solution doesn't support (the bad case).
// It scores `first_draft` (Muse's first bank) and `bank` (after the refine round) when both are there.
// Usage: node authoring/tools/qa-eval.mjs [fixture.json] [--verbose] [--json]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchIntent } from '../expander/intent.mjs';
import { factIntent } from '../expander/qa-bank.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Scores one bank on a list of {q, accept}. */
export function scoreBank(bank, questions) {
  const facts = bank.cases[0].facts;
  const intents = facts.map(factIntent);
  const t = { right: 0, unclear: 0, wrong: 0, n: questions.length, facts: facts.length, details: [] };
  for (const { q, accept } of questions) {
    const m = matchIntent(q, intents);
    const reply = m.index < 0 ? null : facts[m.index].reply;
    const verdict = reply == null ? 'unclear' : accept.includes(reply) ? 'right' : 'wrong';
    t[verdict]++;
    t.details.push({ q, verdict, reply, fact: m.index < 0 ? null : facts[m.index].ask, hits: m.hits });
  }
  return t;
}

export function evaluate(fixture) {
  const rows = [];
  for (const p of fixture.puzzles) {
    for (const which of ['first_draft', 'bank']) if (p[which]) rows.push({ id: p.id, which, ...scoreBank(p[which], p.questions) });
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--')) ?? join(here, 'fixtures', 'qa-eval.json');
  const rows = evaluate(JSON.parse(readFileSync(file, 'utf8')));
  if (args.includes('--json')) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
  const tot = {};
  for (const t of rows) {
    console.log(`${t.id} (${t.which}, ${t.facts} facts): right ${t.right}/${t.n}, unclear ${t.unclear}, wrong ${t.wrong}`);
    if (args.includes('--verbose')) for (const d of t.details) console.log(`  ${d.verdict.padEnd(7)} ${JSON.stringify(d.q)} -> ${d.reply ?? '-'} ${d.fact ? `[${d.fact}] via ${d.hits.join(' + ')}` : ''}`);
    const a = (tot[t.which] ??= { right: 0, unclear: 0, wrong: 0, n: 0 });
    for (const k of Object.keys(a)) a[k] += t[k];
  }
  for (const [w, a] of Object.entries(tot)) console.log(`total ${w}: right ${a.right}/${a.n} (${Math.round((100 * a.right) / a.n)}%), unclear ${a.unclear}, wrong ${a.wrong}`);
}
