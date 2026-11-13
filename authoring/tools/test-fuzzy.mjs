#!/usr/bin/env node
// Tests for fuzzy matching (authoring/expander/fuzzy.mjs) and the fragments that carry it.
//   1. the JS reference: typos, articles, plurals, word order, accents, aliases, tiers, near misses;
//   2. the fuzzy_match and typed_answer fragments are current with fuzzy.mjs;
//   3. with a built engine (MG_ENGINE_DIR): the engine version agrees with the JS one on every case,
//      and typed_answer scores typed answers end to end.
// Usage: node authoring/tools/test-fuzzy.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as F from '../expander/fuzzy.mjs';
import { expand, loadLibrary } from '../expander/expand.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const authoringDir = join(here, '..');
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log(`FAIL ${msg}`); } };

// ---------- 1. JS reference ----------

// [input, accepted name, should match]
const CASES = [
  ['wingardium leviosaa', 'Wingardium Leviosa', true],
  ['Wingardium Leviosa', 'wingardium leviosa', true],
  ['wingardiumleviosa', 'Wingardium Leviosa', true],
  ['leviosa wingardium', 'Wingardium Leviosa', true],
  ['wingardum leviosa', 'Wingardium Leviosa', true],
  ['the beatles', 'beatles', true],
  ['beatles', 'The Beatles', true],
  ['a tiger', 'tiger', true],
  ['cats', 'cat', true],
  ['cat', 'cats', true],
  ['berries', 'berry', true],
  ['movies', 'movie', true],
  ['boxes', 'box', true],
  ['wolves', 'wolf', true],
  ['knives', 'knife', true],
  ['potatoes', 'potato', true],
  ['glasses', 'glass', true],
  ['churches', 'church', true],
  ['eggs', 'egg', true],
  ['Pokémon', 'pokemon', true],
  ['pokemon', 'Pokémon', true],
  ['Beyonce', 'Beyoncé', true],
  ['creme brulee', 'Crème brûlée', true],
  ["don't stop believing", 'Dont Stop Believin', true],
  ['spider-man', 'spiderman', true],
  ['spider man', 'Spider-Man', true],
  ['U.S.A.', 'usa', true],
  ['simon and garfunkel', 'Simon & Garfunkel', true],
  ['three blind mice', '3 blind mice', true],
  ['  ZEBRA  ', 'zebra', true],
  ['zebar', 'zebra', true],
  ['zebr', 'zebra', true],
  ['hermoine granger', 'Hermione Granger', true],
  ['dumbledor', 'Dumbledore', true],
  ['voldemort', 'Voldemort', true],
  ['Shakespear', 'Shakespeare', true],
  ['jupyter', 'jupiter', true],
  // near misses that must not match
  ['car', 'cat', false],
  ['cat', 'car', false],
  ['bat', 'cat', false],
  ['beer', 'bear', false],
  ['mars', 'mats', false],
  ['pine', 'pane', false],
  ['zbra', 'zebra', true],
  ['zbr', 'zebra', false],
  ['zebar', 'zebra', true],
  ['zebrs', 'zebras', true],
  ['tigers', 'tiger', true],
  ['tiger', 'tigress', false],
  ['harry', 'Harry Potter', false],
  ['potter', 'Harry Potter', false],
  ['ron', 'Ron Weasley', false],
  ['the', 'the beatles', false],
  ['', 'apple', false],
  ['apple', '', false],
  ['   ', 'apple', false],
  ['i think its zebra', 'zebra', false],
  ['saturn', 'neptune', false],
  ['mercury', 'murphy', false],
  ['wingardium', 'Wingardium Leviosa', false],
  ['avada kedavra', 'Wingardium Leviosa', false],
  ['hufflepuff', 'Ravenclaw', false],
];
for (const [input, name, want] of CASES) {
  const r = F.match(input, [name]);
  ok(r.ok === want, `match(${JSON.stringify(input)}, ${JSON.stringify(name)}) = ${r.ok} (score ${r.score.toFixed(3)}), want ${want}`);
}

// Scores and pieces
ok(F.distance('ca', 'ac') === 1, 'transposition costs 1');
ok(F.distance('kitten', 'sitting') === 3, 'kitten/sitting = 3');
ok(F.distance('', 'abc') === 3 && F.distance('abc', '') === 3, 'empty distance');
ok(F.score('abc', 'abc') === 1, 'equal score 1');
ok(F.normalize('The Beatles!') === 'beatle', 'normalize strips article, punctuation, plural');
ok(F.normalize('The') === 'the', 'a lone article stays');
ok(F.need('cat') === 1 && F.need('zebra') === 0.8 && F.need('wingardium leviosa') === 0.82, 'need() by length');
ok(F.need('wingardium leviosa', 0.9) === 0.9, 'threshold option');
ok(!F.match('wingardium leviosaa', ['Wingardium Leviosa'], { threshold: 0.99 }).ok, 'strict threshold rejects a typo');

// Aliases, also_accept, tiers, best entry
const bank = [
  { answer: 'Harry Potter', tier: 'common', aliases: ['harry'] },
  { answer: 'Hermione Granger', tier: 0, aliases: ['hermione'] },
  { answer: 'Neville Longbottom', tier: 'rare', aliases: ['neville'] },
  { answer: 'Lord Voldemort', tier: 'legendary', aliases: ['tom riddle'], also_accept: ['you know who'] },
];
let r = F.match('hermoine', bank);
ok(r.ok && r.best === 'Hermione Granger' && r.tier === 0 && r.via === 'alias', 'alias with a typo matches its entry');
r = F.match('nevile longbotom', bank);
ok(r.ok && r.best === 'Neville Longbottom' && r.tier === 2, 'tier name -> index');
r = F.match('you-know-who', bank);
ok(r.ok && r.best === 'Lord Voldemort' && r.via === 'also_accept' && r.tier === 3, 'also_accept');
r = F.match('Tom Riddle', bank);
ok(r.ok && r.best === 'Lord Voldemort', 'alias exact');
r = F.match('draco malfoy', bank);
ok(!r.ok && r.index >= 0, 'miss still reports the nearest entry');
r = F.match('cat', ['car', 'cat', 'cats']);
ok(r.ok && r.index === 1 && r.score === 1, 'exact beats near, earlier wins ties');
ok(F.match('anything', []).ok === false && F.match('x', null).best === null, 'empty list');

// Phonetic
ok(!F.match('filosofer', ['philosopher']).ok, 'phonetic off: far spelling misses');
ok(F.match('filosofer', ['philosopher'], { phonetic: true }).ok === false, 'phonetic needs the same first letter');
ok(F.match('kathrine', ['Katharine'], { phonetic: true }).ok, 'phonetic on: sound-alike name');
ok(F.match('kathrine', [{ answer: 'Katharine', phonetic: true }]).ok, 'per-entry phonetic flag');
ok(!F.match('cat', ['kat'], { phonetic: true }).ok, 'phonetic never loosens short names');
ok(F.soundKey('robert') === F.soundKey('rupert'), 'soundex classes');

// typed_answer's content string
const tiers = 'apple,strawberry=strawberries|raspberry|lingonberry';
const parsed = F.parseTiers(tiers);
ok(parsed.length === 4 && parsed[1].aliases[0] === 'strawberries' && parsed[3].tier === 2, 'parseTiers');
ok(F.formatTiers(parsed) === tiers, 'formatTiers round trip');
ok(F.formatTiers(bank) === 'Harry Potter=harry,Hermione Granger=hermione||Neville Longbottom=neville|Lord Voldemort=tom riddle=you know who', 'formatTiers from a bank');
ok(F.bankCollisions(['cat', 'cats', 'dog']).length === 1, 'bankCollisions finds cat/cats');
ok(F.bankCollisions(['cat', 'car', 'dog']).length === 0, 'bankCollisions keeps cat/car apart');

// ---------- 2. fragments are current ----------

try {
  execFileSync(process.execPath, [join(here, 'make-fuzzy-fragments.mjs'), '--check'], { stdio: 'pipe' });
  ok(true, '');
} catch (e) {
  ok(false, `fragments out of date: ${String(e.stderr || e.message).trim()}`);
}

// ---------- 3. the engine version ----------

let engine = null;
try {
  ({ engine } = await (await import('../expander/engine.mjs')).loadEngine());
} catch (e) {
  console.log(`skip engine checks: ${String(e.message).split('.')[0]}`);
}

if (engine) {
  const lib = loadLibrary(authoringDir);
  const q = (s) => `'${F.FOLD.get('’') === '' ? s.replace(/'/g, '’') : s}'`;
  const pairs = CASES.map(([a, b]) => [a, b]).concat([['kathrine', 'Katharine'], ['hermoine', 'hermione granger=hermione'], ['you know who', 'lord voldemort=tom riddle=you know who']]);
  const manifest = {
    authoring: 'microgame-authoring/0.1',
    meta: { title: 'Fuzzy probe', instructions: 'Probe.', duration_s: 5 },
    uses: [{ fragment: 'fuzzy_match', params: { phonetic: true } }],
    state: {
      ins: { type: 'list<string>', init: `[${pairs.map((p) => q(p[0])).join(', ')}]` },
      nms: { type: 'list<string>', init: `[${pairs.map((p) => q(p[1])).join(', ')}]` },
      res: { type: 'list<float>', init: '[]' },
      oks: { type: 'list<bool>', init: '[]' },
      keys: { type: 'list<string>', init: '[]' },
      bests: { type: 'list<int>', init: '[]' },
    },
    rules: [{ id: 'go', on: 'start', do: [
      { set: 'res', to: "map(range(len(ins)), k => fuzzy_score(get_or(ins, k, ''), get_or(nms, k, '')))" },
      { set: 'oks', to: "map(range(len(ins)), k => fuzzy_ok(get_or(ins, k, ''), get_or(nms, k, '')))" },
      { set: 'keys', to: 'map(ins, k => fuzzy_key(k))' },
      { set: 'bests', to: "map(ins, k => fuzzy_best(k, ['car', 'cat', 'cats', 'zebra', 'the beatles=beatles']))" },
    ] }],
    objectives: { time_limit: '5s', on_timeout: 'win' },
  };
  const res = expand(manifest, lib);
  const errs = res.diagnostics.filter((d) => d.severity === 'error');
  ok(!errs.length, `fuzzy probe expands: ${errs.map((d) => d.code + ' ' + d.message).join('; ')}`);
  if (!errs.length) {
    const json = JSON.stringify(res.game);
    const vd = engine.validate(json).filter((d) => d.severity === 'error');
    ok(!vd.length, `fuzzy probe validates: ${vd.map((d) => d.code + ' ' + d.message).join('; ')}`);
    const g = engine.load(json, 1);
    g.step(16);
    const st = g.state();
    const shown = (s) => s.replace(/'/g, '’');
    const entries = ['car', 'cat', 'cats', 'zebra', 'the beatles=beatles'];
    pairs.forEach(([a, b], i) => {
      const js = F.score(shown(a), b);
      ok(st.res[i] === js, `engine score ${JSON.stringify(a)}/${JSON.stringify(b)}: ${st.res[i]} vs JS ${js}`);
      const jsOk = F.match(shown(a), [b], { phonetic: true }).ok;
      ok(st.oks[i] === jsOk, `engine ok ${JSON.stringify(a)}/${JSON.stringify(b)}: ${st.oks[i]} vs JS ${jsOk}`);
      ok(st.keys[i] === F.normalize(shown(a)), `engine key ${JSON.stringify(a)}: ${JSON.stringify(st.keys[i])} vs ${JSON.stringify(F.normalize(shown(a)))}`);
      const jb = F.match(shown(a), entries, { phonetic: true });
      ok(st.bests[i] === (jb.ok ? jb.index : -1), `engine best ${JSON.stringify(a)}: ${st.bests[i]} vs JS ${jb.ok ? jb.index : -1}`);
    });
    const diags = (g.diagnostics() ?? []).filter((d) => d.severity === 'error');
    ok(!diags.length, `fuzzy probe runs without runtime errors: ${diags.map((d) => d.message).join('; ')}`);
    g.dispose();
  }

  // typed_answer end to end: one prompt, tap the keyboard, submit, read the result.
  const LETTERS = 'qwertyuiopasdfghjklzxcvbnm <>';
  const typedGame = (answers, params = {}) => {
    const m = JSON.parse(readFileSync(join(authoringDir, 'games', 'typed_answer_min.authoring.json'), 'utf8'));
    m.content = { prompts: ['Name a thing'], answers: [answers] };
    m.uses[1].params = { ...m.uses[1].params, max_len: 24, ...params };
    const out = expand(m, lib);
    const e = out.diagnostics.filter((d) => d.severity === 'error');
    if (e.length) throw new Error(e.map((d) => d.code + ' ' + d.message).join('; '));
    return JSON.stringify(out.game);
  };
  const play = (json, text) => {
    const g = engine.load(json, 7);
    g.step(16);
    for (const ch of text + '>') {
      const i = LETTERS.indexOf(ch);
      const x = 9 + (i % 10) * 34 + 15.5, y = 420 + Math.floor(i / 10) * 34 + 15.5;
      g.frame();
      g.pointer('down', x, y);
      g.pointer('up', x, y);
      g.step(16);
    }
    g.step(16);
    const st = g.state();
    const errs = (g.diagnostics() ?? []).filter((d) => d.severity === 'error');
    g.dispose();
    return { st, errs };
  };
  const json = typedGame('apple,strawberry=strawberries|raspberry|wingardium leviosa=levitation charm|the beatles');
  const expect = [
    ['wingardium leviosaa', 'rare', 'wingardium leviosa'],
    ['leviosa wingardium', 'rare', 'wingardium leviosa'],
    ['levitation charn', 'rare', 'wingardium leviosa'],
    ['beatles', 'legendary', 'the beatles'],
    ['apples', 'common', 'apple'],
    ['strawberies', 'common', 'strawberry'],
    ['rasberry', 'uncommon', 'raspberry'],
    ['appel', 'common', 'apple'],
    ['grape', 'miss', ''],
    ['cherry', 'miss', ''],
  ];
  for (const [text, want, answer] of expect) {
    const { st, errs } = play(json, text);
    ok(!errs.length, `typed_answer "${text}" runs: ${errs.map((d) => d.message).join('; ')}`);
    ok(st.last_result === want && st.last_answer === answer,
      `typed_answer "${text}": ${st.last_result} "${st.last_answer}", want ${want} "${answer}"`);
  }
  // Artem's original format still works, and threshold is a param.
  const old = typedGame('mars,earth,jupiter|saturn,venus|mercury,neptune|uranus,pluto');
  ok(play(old, 'jupiters').st.last_result === 'common', 'old format: trailing s');
  ok(play(old, 'mars').st.ta_points === 10, 'old format: points');
  ok(play(old, 'mats').st.last_result === 'miss', 'old format: near miss on a short word');
  const strict = typedGame('wingardium leviosa', { threshold: 1.0 });
  ok(play(strict, 'wingardium leviosaa').st.last_result === 'miss', 'threshold 1.0 is exact');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
