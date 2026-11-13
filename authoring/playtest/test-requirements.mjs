#!/usr/bin/env node
// Unit tests for requirement extraction (expander/requirements.mjs) and the requirement check
// (playtest/requirements-check.mjs). Plain Node, no packages, no engine, no Muse:
//   node authoring/playtest/test-requirements.mjs   (exit 1 on any failure)
// Also scores the code pass against the hand-written specified set (catalog/eval/specified/requests.json).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../expander/requirements.mjs';
import * as C from './requirements-check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL ${name}${detail !== undefined ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}
const find = (reqs, pred) => reqs.find(pred);
const measure = (reqs, m) => find(reqs, (r) => r.target?.measure === m);

// ---------- extraction: the code pass ----------
{
  const reqs = R.seedRequirements('The Office trivia with 12 questions only about Season 3, 4 answer choices each, and a 15-second timer per question');
  ok(measure(reqs, 'questions')?.target.value === 12 && measure(reqs, 'questions').quote === '12 questions', 'sp01 12 questions', reqs);
  ok(measure(reqs, 'choices')?.target.value === 4, 'sp01 4 choices');
  ok(measure(reqs, 'per_question_seconds')?.target.value === 15, 'sp01 15 s per question');
  ok(find(reqs, (r) => r.quote === 'The Office'), 'sp01 name The Office');
  ok(R.coverageIssues('The Office trivia with 12 questions only about Season 3, 4 answer choices each, and a 15-second timer per question', reqs).length === 0, 'sp01 every number covered');
}
{
  const reqs = R.seedRequirements('Snake game in pixel art using only greens and black, where the snake speeds up every 5 apples and you have 3 lives');
  const pal = find(reqs, (r) => r.target?.palette);
  ok(pal && JSON.stringify(pal.target.palette.only) === '["green","black"]', 'sp02 palette only green+black', pal);
  ok(find(reqs, (r) => r.kind === 'rule' && /every 5 apples/.test(r.quote) && r.target === null), 'sp02 speed-up is a judged rule');
  ok(measure(reqs, 'lives')?.target.value === 3 && measure(reqs, 'lives').verify === 'playtest', 'sp02 3 lives by playtest');
  ok(find(reqs, (r) => r.quote === 'pixel art' && r.kind === 'style'), 'sp02 pixel art');
  ok(!find(reqs, (r) => r.quote === 'Snake'), 'sp02 a genre at the start is not a name');
}
{
  const reqs = R.seedRequirements('Endless runner with 4 lanes where I swipe, not tap, to change lanes');
  ok(find(reqs, (r) => r.target?.input === 'swipe'), 'swipe control');
  ok(find(reqs, (r) => r.target?.input_not === 'tap' && r.quote === 'not tap'), 'not tap');
  ok(measure(reqs, 'lanes')?.target.value === 4, '4 lanes');
}
{
  const t = 'Cookie clicker where each tap earns 1 cookie, upgrades cost 10, 50 and 200 cookies, and I win at 1,000 cookies';
  const reqs = R.seedRequirements(t);
  ok(find(reqs, (r) => JSON.stringify(r.target?.numbers) === '[10,50,200]'), 'number list', reqs);
  ok(measure(reqs, 'win_at')?.target.value === 1000, '1,000 is one number');
  ok(R.coverageIssues(t, reqs).length === 0, 'cookie: every number covered', R.coverageIssues(t, reqs));
}
{
  const reqs = R.seedRequirements('Pizza shop game where I make exactly 5 pizzas, each order lists 3 toppings, and every wrong topping costs 1 of my 3 stars');
  ok(measure(reqs, 'questions')?.target.value === 5, 'exactly 5 pizzas');
  ok(find(reqs, (r) => /each order lists 3 toppings/.test(r.quote) && r.kind === 'rule'), 'per-order count is a rule');
  ok(measure(reqs, 'lives')?.target.value === 3 && /1 of my 3 stars/.test(measure(reqs, 'lives').quote), '1 of my 3 stars', measure(reqs, 'lives'));
}
{
  const reqs = R.seedRequirements('Choose your own adventure where I\'m a medieval peasant trying to become king in 10 choices or less');
  ok(measure(reqs, 'choices_made')?.target.op === '<=' && measure(reqs, 'choices_made').target.value === 10, '10 choices or less');
}
{
  const reqs = R.seedRequirements("Block stacker 8 columns wide, where clearing 2 lines at once shows a 'DOUBLE!' message, no timer and no way to lose");
  ok(find(reqs, (r) => r.target?.text?.[0] === 'DOUBLE!'), 'quoted word');
  ok(find(reqs, (r) => r.target?.no === 'timer'), 'no timer');
  ok(find(reqs, (r) => r.target?.no === 'lose'), 'no way to lose');
  ok(measure(reqs, 'columns')?.target.value === 8, '8 columns');
}

// ---------- normalize + merge ----------
{
  const request = 'Trivia with 10 questions about 2000s pop music, a 45-second timer';
  const muse = [
    { quote: '10 questions', kind: 'count', target: { measure: 'questions', op: '==', value: '10' }, must: true, verify: 'code' },
    { quote: 'ABOUT 2000S POP MUSIC', kind: 'content', target: null, must: true },
    { quote: 'something not in the request', kind: 'rule', target: null },
    { quote: '10 questions', kind: 'count', target: { measure: 'nonsense', value: 3 } },
  ];
  const { requirements, issues } = R.normalizeRequirements(muse, request);
  ok(requirements[0].target.value === 10, 'numeric strings become numbers');
  ok(requirements[1].quote === 'about 2000s pop music' && requirements[1].verify === 'judge', 'quotes are matched back to the request text');
  ok(issues.some((i) => i.code === 'R_QUOTE_NOT_IN_REQUEST'), 'invented quotes are dropped');
  ok(requirements.length === 3 && requirements[2].target === null && requirements[2].verify === 'judge', 'an invalid target becomes a judged requirement', requirements);
  const merged = R.mergeRequirements(request, muse);
  ok(merged.requirements.some((r) => r.target?.measure === 'run_seconds' && r.target.value === 45), 'merge keeps the 45 s Muse missed');
  ok(merged.requirements.every((r, i) => r.id === `r${i + 1}`), 'ids renumbered');
}

// ---------- the plan may not contradict ----------
{
  const reqs = R.seedRequirements('Trivia with 12 questions and a 45-second timer');
  const spec = { pieces: { items: [{ name: 'question', count: '10 questions' }] }, constraints: { items: [{ kind: 'time', value: '60 s total' }] } };
  const c = R.planContradictions(reqs, spec);
  ok(c.length === 2 && c.every((x) => x.code === 'R_PLAN_CONTRADICTS'), 'plan contradictions', c);
  const good = { pieces: { items: [{ count: '12 questions' }] }, constraints: { items: [{ kind: 'time', value: '45 s' }] } };
  ok(R.planContradictions(reqs, good).length === 0, 'a matching plan has none');
}

// ---------- prompts ----------
{
  const reqs = R.seedRequirements('Snake with 3 lives, only greens and black');
  const s = R.requirementsSection(reqs);
  ok(s.startsWith('## Requirements you must meet, quoted') && s.includes('"3 lives"') && s.includes('lives == 3'), 'compose section');
  ok(R.REQUIREMENTS_SYSTEM.includes('state_reaches') && R.requirementsPrompt('x').includes('The request:'), 'extraction prompt');
  const rr = R.repairRequest([{ id: 'r1', quote: '3 lives', code: 'R_LIVES_MISMATCH', evidence: 'lives.count = 5', target: { measure: 'lives', op: '==', value: 3 } }]);
  ok(rr.includes('r1 "3 lives" (R_LIVES_MISMATCH)') && rr.includes('lives == 3'), 'repair request names the requirement and quote');
}
{
  // extractRequirements with a scripted Muse, and with one that fails.
  const fake = async () => ({ content: JSON.stringify({ requirements: [{ quote: '3 lives', kind: 'lose', target: { measure: 'lives', op: '==', value: 3 }, must: true, verify: 'playtest' }] }) });
  const x = await R.extractRequirements('Snake with 3 lives in pixel art', fake);
  ok(x.by === 'muse' && x.requirements.some((r) => r.quote === 'pixel art'), 'muse list + code seeds', x);
  const y = await R.extractRequirements('Snake with 3 lives', async () => { throw new Error('down'); });
  ok(/^code \(muse failed/.test(y.by) && measure(y.requirements, 'lives'), 'falls back to the code pass');
}

// ---------- the check ----------
const game = {
  meta: { title: 'Pond Snake', instructions: 'Eat apples. 3 lives.' },
  inputs: { turn: { payload: { dir: 'int' }, from: [{ swipe: 'left', with: { dir: '-1' } }] } },
  state: { lives: { type: 'int', init: '3' }, score: { type: 'int', init: '0' }, time_left: { type: 'float', init: '45 * 1000.0' } },
  rules: [{ id: 'die', on: 'hit', when: 'lives <= 0', do: [{ end: 'lose' }] }],
  objectives: { time_limit: '45s', on_timeout: 'win' },
  presentation: { tokens: { bg: '#0B1F0B', ink: '#E8FFE8', primary: '#2ECC40', accent: '#145A14' }, root: { node: 'group', children: [{ node: 'text', text: "= if streak >= 2 then 'DOUBLE!' else ''" }] } },
};
const authoring = {
  meta: game.meta,
  uses: [{ fragment: 'lives', params: { count: 3 } }, { fragment: 'rounds', params: { count: 12 } }, { fragment: 'quiz', params: { choices: 4, time_ms: '15s' } }],
  content: { questions: Array.from({ length: 12 }, (_, i) => `Q${i}`), words: ['pancake', 'lantern'], prices: [10, 50, 200] },
  art: { palette: { bg: '#0B1F0B', ink: '#E8FFE8', primary: '#2ECC40' } },
};
const built = C.readBuilt({ content: { game_json: JSON.stringify(game), authoring_json: JSON.stringify(authoring) } });
const check = (target, kind = 'count') => C.codeCheck({ id: 'r1', quote: 'q', kind, target, must: true, verify: 'code' }, built);
ok(check({ measure: 'questions', op: '==', value: 12 }).status === 'pass', 'questions 12 pass');
ok(check({ measure: 'questions', op: '==', value: 10 }).code === 'R_COUNT_MISMATCH', 'questions 10 → R_COUNT_MISMATCH');
ok(check({ measure: 'choices', op: '==', value: 4 }).status === 'pass', 'choices');
ok(check({ measure: 'per_question_seconds', op: '==', value: 15 }, 'timer').status === 'pass', 'per question 15 s');
ok(check({ measure: 'run_seconds', op: '==', value: 45 }, 'timer').status === 'pass', 'run 45 s');
ok(check({ measure: 'run_seconds', op: '==', value: 30 }, 'timer').code === 'R_TIMER_MISMATCH', 'run 30 s → R_TIMER_MISMATCH');
ok(check({ measure: 'lives', op: '==', value: 3 }, 'lose').status === 'pass', 'lives 3');
ok(check({ measure: 'lives', op: '==', value: 2 }, 'lose').code === 'R_LIVES_MISMATCH', 'lives 2 → R_LIVES_MISMATCH');
ok(check({ text: ['pancake', 'lantern'], match: 'all' }, 'content').status === 'pass', 'words present');
ok(check({ text: ['DOUBLE!'], match: 'all' }, 'tone').status === 'pass', 'literal inside a text expression counts');
ok(check({ text: ['giraffe'], match: 'all' }, 'content').code === 'R_TEXT_MISSING', 'missing word → R_TEXT_MISSING');
ok(check({ palette: { only: ['green', 'black'] } }, 'style').status === 'pass', 'palette only green/black', check({ palette: { only: ['green', 'black'] } }, 'style'));
ok(check({ palette: { only: ['blue', 'white'] } }, 'style').code === 'R_PALETTE_OFF', 'palette off → R_PALETTE_OFF');
ok(check({ palette: { include: ['green'] } }, 'style').status === 'pass', 'palette include');
ok(check({ input: 'swipe' }, 'control').status === 'pass', 'swipe present');
ok(check({ input: 'drag' }, 'control').code === 'R_CONTROL_MISSING', 'drag missing → R_CONTROL_MISSING');
ok(check({ input_not: 'type' }, 'control').status === 'pass', 'no typing');
ok(check({ input_not: 'choice' }, 'control').code === 'R_CONTROL_FORBIDDEN', 'quiz is multiple choice → R_CONTROL_FORBIDDEN');
ok(check({ no: 'timer' }, 'rule').code === 'R_NOT_RULED_OUT', 'has a timer → R_NOT_RULED_OUT');
ok(check({ no: 'lose' }, 'lose').code === 'R_NOT_RULED_OUT', 'can lose → R_NOT_RULED_OUT');
ok(check({ timeout_is: 'win' }, 'win').status === 'pass', 'time out wins');
ok(check({ numbers: [10, 50, 200] }, 'rule').status === 'pass', 'numbers present');
ok(check({ numbers: [999] }, 'rule').code === 'R_NUMBERS_MISSING', 'numbers missing → R_NUMBERS_MISSING');
ok(check({ path: 'content.questions.length', op: '==', value: 12 }).status === 'pass', 'path check');
ok(C.codeCheck({ id: 'r9', quote: 'pixel art', kind: 'style', target: null, must: true, verify: 'judge' }, built).status === 'unknown', 'no target → unknown');

// colors
ok(C.colorClasses('#000000')[0] === 'black' && C.colorClasses('#FFFFFF')[0] === 'white', 'black/white');
ok(C.colorClasses('#2ECC40').includes('green') && C.colorClasses('#7B2FF7').includes('purple') && C.colorClasses('#FF8C1A').includes('orange'), 'hues');
ok(C.colorClasses('#AEE2FF').includes('blue'), 'pastel blue');

// playtest checks on a fake trace
{
  const lose3 = { id: 'r2', quote: '3 lives', kind: 'lose', target: { measure: 'lives', op: '==', value: 3 }, must: true, verify: 'playtest' };
  const trace = [
    { label: 'a', outcome: 'fail', seconds: 20, inputs: 9, init: { lives: 3, mult: 1 }, last: { lives: 0, mult: 1 }, max: { lives: 3, mult: 2 }, min: { lives: 0 } },
    { label: 'b', outcome: 'success', seconds: 45, inputs: 30, init: { lives: 3, mult: 1 }, last: { lives: 1, mult: 1 }, max: { lives: 3, mult: 1 }, min: { lives: 1 } },
  ];
  ok(C.playtestCheck(lose3, trace, built).status === 'pass', 'lives from trace');
  ok(C.playtestCheck({ ...lose3, target: { measure: 'run_seconds', op: '==', value: 45 } }, trace, built).status === 'pass', 'run ends at 45 s');
  ok(C.playtestCheck({ ...lose3, target: { measure: 'run_seconds', op: '==', value: 30 } }, trace, built).code === 'R_TIMER_MISMATCH', 'run longer than asked');
  ok(C.playtestCheck({ ...lose3, target: { state_reaches: { name: 'mult', op: '>=', value: 2 } } }, trace, built).status === 'pass', 'multiplier fires');
  ok(C.playtestCheck({ ...lose3, target: { no: 'lose' } }, trace, built).code === 'R_NOT_RULED_OUT', 'a bot lost');
  const report = C.checkRequirements([lose3, { id: 'r3', quote: 'pixel art', kind: 'style', target: null, must: true, verify: 'judge' }], built, { trace, judge: { r3: { met: false, evidence: 'smooth vector art' } } });
  ok(report.summary.must_passed === 1 && report.results[1].code === 'R_JUDGE_UNMET', 'judge result used', report.results);
  ok(C.repairTargets(report).length === 1 && C.gapEntries(report)[0].tool === 'requirement:r3', 'repair targets and gap entries');
  ok(/pixel art/.test(C.honestNote(report)), 'honest note');
  ok(C.judgePrompt([lose3], built).includes('"3 lives"') && C.gameDigest(built).includes('Pond Snake'), 'judge prompt');
}

// ---------- the specified set: code-pass recall ----------
{
  const set = JSON.parse(readFileSync(join(root, 'catalog', 'eval', 'specified', 'requests.json'), 'utf8'));
  const specified = set.filter((t) => t.expect);
  ok(specified.length === 30 && set.filter((t) => t.general_of).length === 10, '30 specified + 10 general');
  for (const t of specified) for (const g of t.expect) {
    ok(t.request.includes(g.quote), `${t.id} ${g.id} quote is exact`, g.quote);
    ok(R.REQUIREMENT_KINDS.includes(g.kind) && R.VERIFY_BY.includes(g.verify), `${t.id} ${g.id} kind/verify`);
  }
  let found = 0, total = 0;
  for (const t of specified) {
    const seeds = R.seedRequirements(t.request);
    for (const g of t.expect.filter((x) => x.target?.measure)) {
      total++;
      if (seeds.some((s) => s.target?.measure && s.target.value === g.target.value)) found++;
    }
  }
  console.log(`  code pass finds ${found}/${total} numeric gold requirements`);
  ok(found / total >= 0.9, 'code pass finds ≥ 90% of numeric requirements', `${found}/${total}`);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
