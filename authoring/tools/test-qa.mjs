#!/usr/bin/env node
// Tests for the open-text tools (docs/harness-gaps/open-text.md):
//   1. intent matching (authoring/expander/intent.mjs): roots, typos, specificity, coverage, misses;
//   2. qa-bank/1 content (authoring/expander/qa-bank.mjs): encoding, checker, the held-out eval floor;
//   3. the qa_bank fragment is current with intent.mjs;
//   4. with a built engine (MG_ENGINE_DIR): the example game expands and validates; typed questions
//      get the same answers in the engine as in JS; solving, clues, scoring and replay verification;
//      npc_judge expands, rates replies and replays.
// Usage: node authoring/tools/test-qa.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as I from '../expander/intent.mjs';
import * as Q from '../expander/qa-bank.mjs';
import { evaluate } from './qa-eval.mjs';
import { expand, loadLibrary } from '../expander/expand.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const authoringDir = join(here, '..');
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log(`FAIL ${msg}`); } };

// ---------- 1. intent matching ----------

for (const [w, r] of [['scared', 'scar'], ['scaring', 'scar'], ['scare', 'scar'], ['stopped', 'stop'], ['killed', 'kil'],
  ['kill', 'kil'], ['quickly', 'quick'], ['early', 'early'], ['bartender', 'bartender'], ['hiccup', 'hiccup']]) {
  ok(I.root(w) === r, `root(${w}) = ${I.root(w)}, want ${r}`);
}
ok(I.wordHit('bartendr', 'bartender'), 'one typo on a long word hits');
ok(I.wordHit('hicup', 'hiccup'), 'dropped letter hits');
ok(!I.wordHit('than', 'thank'), 'short words must be exact');
ok(!I.wordHit('car', 'cat'), 'cat is not car');
ok(!I.wordHit('scar', 'star'), 'four-letter roots are exact');

const BANK = [
  'bartender=barman|angry=mad=upset',    // 0: two groups
  'bartender=barman=barkeep',            // 1
  'gun=pistol=weapon|fire=shoot=shot',   // 2
  'gun=pistol=weapon',                   // 3
  'water=glass|drink=sip=swallow',       // 4
  'water=glass',                         // 5
  'hiccup=hiccough',                     // 6
  'gun shot=gunshot',                    // 7: a phrase
];
const want = [
  ['was the bartender angry', 0],
  ['was the barman mad at him', 0],
  ['is the bartender important', 1],
  ['did the bartendr shoot', 1],                 // only one group of fact 2 is there, so the 1-group fact wins
  ['did the bartender fire the gun', 2],
  ['was the gun real', 3],
  ['did he sip the water', 4],
  ['did he drink the glass of water', 4],
  ['does the water matter', 5],
  ['did he have the hiccups', 6],
  ['Did He Have HICCUPS?', 6],
  ['was there a shot from a gun', 2],            // gun + shot fits fact 2 (two groups) before the phrase (one)
  ['did the bartender like cats', 1],
  ['was it raining', -1],
  ['', -1],
];
for (const [q, i] of want) {
  const m = I.matchIntent(q, BANK);
  ok(m.index === i, `matchIntent(${JSON.stringify(q)}) = ${m.index}, want ${i} (hits ${m.hits.join(', ')})`);
}
// Coverage breaks a tie between two 1-group facts: "backup" and "oversleep" beat "kitchen".
ok(I.matchIntent('is the kitchen alarm a backup in case she oversleeps', ['kitchen=oven', 'backup=oversleep=overslept']).index === 1,
  'coverage: the fact that explains more of the question wins');
ok(I.matchIntent('was it a hiccup', ['hiccup', 'hiccup']).index === 0, 'ties go to the earlier fact');

// ---------- 2. qa-bank content ----------

const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'qa-eval.json'), 'utf8'));
const fact = { ask: "Was the man's gun real?", reply: 'yes', key: true, match: [['Gun', 'pistol'], ['real|fake=x']] };
const s = Q.factString(fact);
ok(s === 'y*|Was the man’s gun real?|gun=pistol|real fake x', `factString: ${s}`);
const back = Q.parseFact(s);
ok(back.reply === 'yes' && back.key && back.ask === 'Was the man’s gun real?' && back.intent === 'gun=pistol|real fake x', `parseFact: ${JSON.stringify(back)}`);
ok(Q.keyPhrase('hiccup=hiccough|scare=fright') === 'hiccup scare', 'keyPhrase');
for (const p of fixture.puzzles) {
  const errs = Q.checkBank(p.bank).filter((x) => x.startsWith('error'));
  ok(!errs.length, `${p.id} bank has no errors: ${errs.join('; ')}`);
  const c = Q.toContent(p.bank);
  ok(c.qa_facts.length === 1 && c.qa_facts[0].split(';').length === p.bank.cases[0].facts.length, `${p.id} toContent keeps every fact`);
  ok(!JSON.stringify(c).includes("'"), `${p.id} content has no ASCII apostrophes`);
  const solves = c.qa_solves[0].split(';');
  ok(solves.every((x) => I.matchIntent(Q.keyPhrase(x), [x]).index === 0), `${p.id} solutions match their key phrases`);
}
ok(Q.checkBank({ bank: 'qa-bank/1', cases: [{ setup: 'x', solution: 'y', facts: [], solve: [] }] }).some((x) => x.includes('need at least 12')), 'checker: too few facts');
ok(Q.checkBank({ bank: 'nope', cases: [] }).length >= 2, 'checker: bad header and no cases');
const { system, user } = Q.bankPrompt({ request: 'lateral puzzles', puzzle: { setup: 'S', solution: 'T' } });
ok(system.includes('qa-bank/1') && user.includes('Setup: S') && user.includes('Write 1 case'), 'bankPrompt with a fixed puzzle');
ok(Q.probeFailures(fixture.puzzles[0].bank.cases[0], [{ q: 'did the man have hiccups', reply: 'yes' }, { q: 'was it raining', reply: 'no' }]).length === 1, 'probeFailures');

// The measured floor (doc: open-text.md). Held-out player questions, refined banks.
const rows = evaluate(fixture);
const refined = rows.filter((r) => r.which === 'bank');
const right = refined.reduce((a, r) => a + r.right, 0), wrong = refined.reduce((a, r) => a + r.wrong, 0), n = refined.reduce((a, r) => a + r.n, 0);
ok(right >= 27 && wrong <= 2, `held-out eval: refined banks right ${right}/${n}, wrong ${wrong} (want >= 27 right, <= 2 wrong)`);

// ---------- 3. the fragment is current ----------

try {
  execFileSync(process.execPath, [join(here, 'make-qa-fragment.mjs'), '--check'], { stdio: 'pipe' });
  ok(true, '');
} catch (e) {
  ok(false, `qa_bank.fragment.json is stale: ${String(e.stderr)}`);
}

// ---------- 4. the engine ----------

let engine = null;
try {
  ({ engine } = await (await import('../expander/engine.mjs')).loadEngine());
} catch (e) {
  console.log(`skip engine checks: ${String(e.message).split('.')[0]}`);
}

if (engine) {
  const lib = loadLibrary(authoringDir);
  const build = (m) => {
    const out = expand(m, lib);
    const errs = out.diagnostics.filter((d) => d.severity === 'error');
    if (errs.length) throw new Error(errs.map((d) => `${d.code} ${d.at ?? ''} ${d.message}`).join('; '));
    return JSON.stringify(out.game);
  };
  const example = JSON.parse(readFileSync(join(authoringDir, 'games', 'qa_ask_me_why.authoring.json'), 'utf8'));
  const one = (ci) => ({ ...example, content: Object.fromEntries(Object.entries(example.content).map(([k, v]) => [k, [v[ci]]])) });
  let json = null;
  try { json = build(one(0)); ok(true, ''); } catch (e) { ok(false, `qa example expands: ${e.message}`); }
  if (json) {
    const vd = engine.validate(json).filter((d) => d.severity === 'error');
    ok(!vd.length, `qa example validates: ${vd.map((d) => d.code + ' ' + d.message).join('; ')}`);
    // Typed into the native text field (each edit, then Return), as the app and the bots do.
    const tap = (g, x, y) => { g.frame(); g.pointer('down', x, y); g.pointer('up', x, y); g.step(16); };
    const type = (g, text) => { for (let i = 1; i <= text.length; i++) g.text('change', text.slice(0, i)); g.step(16); g.text('submit', text); g.text('change', ''); g.step(16); };
    const ask = (g, q) => { type(g, q.toLowerCase()); g.step(16); return g.state(); };
    // Solve switches Return to checking a theory.
    const solve = (g, q) => { tap(g, 265, 328); type(g, q.toLowerCase()); g.step(16); return g.state(); };

    const facts = fixture.puzzles[0].bank.cases[0].facts;
    const intents = facts.map(Q.factIntent);
    const g = engine.load(json, 3);
    g.step(16);
    const t0 = Date.now();
    let asked = 0;
    for (const { q } of fixture.puzzles[0].questions.slice(0, 8)) {
      const clean = q.toLowerCase().replace(/[^a-z ]/g, '').slice(0, 40);
      const m = I.matchIntent(clean, intents);
      const st = ask(g, clean);
      const jsReply = m.index < 0 ? 'unclear' : facts[m.index].reply;
      if (m.index >= 0) asked++;
      ok(st.last_reply === jsReply, `engine answers ${JSON.stringify(clean)}: ${st.last_reply}, JS ${jsReply}`);
      ok(m.index < 0 || st.last_ask === Q.factString(facts[m.index]).split('|')[1], `engine shows the matched question for ${JSON.stringify(clean)}: ${st.last_ask}`);
    }
    const perQ = (Date.now() - t0) / 8;
    console.log(`engine: ${perQ.toFixed(0)} ms per question`); ok(perQ < 400, `a question takes ${perQ.toFixed(0)} ms in the engine (typing included), want < 400`);
    let st = g.state();
    ok(st.asked === asked, `asked counts answered questions only: ${st.asked} vs ${asked}`);
    ok(st.clues >= 1 && st.qa_points === st.clues * 50, `clues score: ${st.clues} clues, ${st.qa_points} points`);
    st = solve(g, 'he had the hiccup and got a scare');
    ok(st.last_reply === 'solved' && st.solved_count === 1 && st.revealing, `solve: ${st.last_reply}`);
    ok(st.qa_points === st.clues * 50 + 500 + (20 - st.asked) * 25, `solve points: ${st.qa_points}`);
    g.step(100);
    ok(g.phase() === 'won', `goal 1 wins: phase ${g.phase()}`);
    const log = g.log();
    const v = engine.verify(json, log);
    ok(v.ok, `the run replays: ${JSON.stringify(v.problems ?? v).slice(0, 300)}`);
    const errs = (g.diagnostics() ?? []).filter((d) => d.severity === 'error');
    ok(!errs.length, `qa example runs without runtime errors: ${errs.map((d) => d.message).join('; ')}`);
    g.dispose();

    // A wrong theory costs questions; running out loses.
    const g2 = engine.load(json, 5);
    g2.step(16);
    let s2 = solve(g2, 'he was a spy');
    ok(s2.last_reply === 'wrong' && s2.asked === 2, `wrong solve costs 2: ${s2.last_reply} ${s2.asked}`);
    for (let k = 0; k < 9 && g2.phase() !== 'lost'; k++) s2 = solve(g2, 'he was a spy');
    g2.step(16);
    ok(g2.phase() === 'lost' && g2.state().ran_out, `running out loses: phase ${g2.phase()}`);
    g2.dispose();
  }

  // npc_judge: ratings, bands, reactions, timeout, replay.
  const judge = {
    authoring: 'microgame-authoring/0.1',
    meta: { title: 'Judge probe', instructions: 'Pick the best reply.', duration_s: 60 },
    uses: [
      { fragment: 'npc_judge', params: { choices: 3, labels: 'cringe|mid|smooth|W rizz', time_ms: '5s' } },
      { fragment: 'rounds', params: { count: 2 }, bind: { round_done: 'line_done' } },
    ],
    functions: {
      nj_lines: { params: {}, returns: 'list<string>', body: 'content_lines' },
      nj_options: { params: {}, returns: 'list<string>', body: 'content_options' },
      nj_ratings: { params: {}, returns: 'list<string>', body: 'content_ratings' },
      nj_reactions: { params: {}, returns: 'list<string>', body: 'content_reactions' },
    },
    content: {
      lines: ['Nice jacket.', 'What are you reading?'],
      options: ['Thanks, it has pockets', 'I know', 'Want it? Forever?', 'A map to your heart', 'A book', 'The terms of service'],
      ratings: ['82', '10', '45', '20', '50', '90'],
      reactions: ['Pockets are a W.', 'Okay then.', 'Slow down.', 'Oof.', 'Fair.', 'You read those?!'],
    },
  };
  let jj = null;
  try { jj = build(judge); ok(true, ''); } catch (e) { ok(false, `npc_judge expands: ${e.message}`); }
  if (jj) {
    const vd = engine.validate(jj).filter((d) => d.severity === 'error');
    ok(!vd.length, `npc_judge validates: ${vd.map((d) => d.code + ' ' + d.message).join('; ')}`);
    const g = engine.load(jj, 9);
    g.step(16);
    let st = g.state();
    const line = st.order[st.ri];
    const texts = [0, 1, 2].map((k) => judge.content.options[line * 3 + st.opts[k]]);
    const ratings = [0, 1, 2].map((k) => Number(judge.content.ratings[line * 3 + st.opts[k]]));
    const best = ratings.indexOf(Math.max(...ratings));
    g.step(1300);
    g.frame(); g.pointer('down', 180, 330 + best * 68 + 29); g.pointer('up', 180, 330 + best * 68 + 29); g.step(16);
    st = g.state();
    const want = ratings[best];
    const band = Math.floor((want * 4) / 101);
    ok(st.last_rating === want && st.nj_points === want, `npc_judge rates "${texts[best]}": ${st.last_rating}, want ${want}`);
    ok(st.last_label === ['cringe', 'mid', 'smooth', 'W rizz'][band], `npc_judge band: ${st.last_label}`);
    ok(st.last_reaction === judge.content.reactions[line * 3 + st.opts[best]], `npc_judge reaction: ${st.last_reaction}`);
    // Let the second line time out: rating 0.
    g.step(2000);
    g.step(6000);
    g.step(2000);
    st = g.state();
    ok(st.low_count >= 1 && st.nj_points === want, `npc_judge timeout scores 0: points ${st.nj_points}, low ${st.low_count}`);
    const v = engine.verify(jj, g.log());
    ok(v.ok, `npc_judge replays: ${JSON.stringify(v.problems ?? v).slice(0, 300)}`);
    g.dispose();
  }
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
