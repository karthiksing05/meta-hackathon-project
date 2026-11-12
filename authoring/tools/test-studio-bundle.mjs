#!/usr/bin/env node
// Tests the generated Studio bundle the way the app's hidden web view runs it, but in a Node `vm`
// context with no DOM: loads bubble-kit-microgame-engine.js and microgame-studio.js as classic
// scripts, then for each game expands + validates it through `MicrogameStudio.expand`, gates it
// through `MicrogameStudio.gate`, wraps it, and checks the gate's pass/fail against the Node gate
// that `authoring/playtest/run.mjs` uses (gate.mjs, worker threads, replayed look-ahead).
//
// Usage: node authoring/tools/test-studio-bundle.mjs [game ...] [--all] [--no-compare]
//   default games: tide_taps fog_dodge lantern_letters

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { expand, loadLibrary } from '../expander/expand.mjs';
import { playtest } from '../playtest/gate.mjs';
import { sortKeys } from '../expander/stable.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const authoringDir = join(here, '..');
const root = join(authoringDir, '..');
const args = process.argv.slice(2);
const compare = !args.includes('--no-compare');
let games = args.filter((a) => !a.startsWith('--'));
if (args.includes('--all')) games = readdirSync(join(authoringDir, 'games')).filter((f) => f.endsWith('.authoring.json')).map((f) => f.replace('.authoring.json', '')).sort();
if (!games.length) games = ['tide_taps', 'fog_dodge', 'lantern_letters'];

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };

// ---- load the bundles into a bare context ----
const t0 = performance.now();
const context = vm.createContext({ console, setTimeout, clearTimeout, performance });
for (const file of [
  join(root, 'FacebookClone/Bubbles/Runtime/web/bubble-kit-microgame-engine.js'),
  join(root, 'FacebookClone/Bubbles/Studio/web/microgame-studio.js'),
]) {
  vm.runInContext(readFileSync(file, 'utf8'), context, { filename: file });
}
const S = context.MicrogameStudio;
if (!S) { console.log('FAIL: MicrogameStudio is not defined'); process.exit(1); }
const tLoad = performance.now();
const cat = JSON.parse(S.catalog());
const tCatalog = performance.now();
console.log(`bundles loaded in ${(tLoad - t0).toFixed(0)} ms; catalog in ${(tCatalog - tLoad).toFixed(0)} ms: ` +
  `${cat.fragments.length} fragments, ${cat.looks.length} looks, ${cat.examples.length} examples, game format ${cat.game_format}, ` +
  `prompt text ${Object.values(cat.prompt).reduce((n, s) => n + s.length, 0)} chars`);
if (cat.fragments.length < 30 || cat.looks.length < 4 || !cat.prompt.fragments.includes('lives') || !cat.prompt.engine.includes('Builtins')) fail('catalog is missing pieces');

// ---- broken manifests come back as diagnostics, with the right audience ----
{
  const m = JSON.parse(readFileSync(join(authoringDir, 'games', 'tide_taps.authoring.json'), 'utf8'));
  m.uses[0].params.pointz = m.uses[0].params.points; delete m.uses[0].params.points;
  const r = JSON.parse(S.expand(JSON.stringify(m)));
  const d = r.diagnostics.find((x) => x.code === 'A_UNKNOWN_PARAM');
  if (r.ok || !d || d.audience !== 'model' || d.at !== '/uses/0/params/pointz') fail(`misspelled param: ${JSON.stringify(r.diagnostics)}`);
  else console.log(`misspelled param -> ${d.code} at ${d.at} (${d.audience}), hint: ${d.hint}`);

  const m2 = JSON.parse(readFileSync(join(authoringDir, 'games', 'tide_taps.authoring.json'), 'utf8'));
  m2.rules[1].do[0].to = 'drain_mult + tide_speed';
  const r2 = JSON.parse(S.expand(JSON.stringify(m2)));
  const e2 = r2.diagnostics.find((x) => x.severity === 'error');
  if (r2.ok || !e2 || e2.audience !== 'model' || !String(e2.at).startsWith('/rules/1')) fail(`unknown name: ${JSON.stringify(r2.diagnostics)}`);
  else console.log(`unknown name in a game rule -> ${e2.code} at ${e2.at} (${e2.audience})`);

  const m3 = JSON.parse(readFileSync(join(authoringDir, 'games', 'tide_taps.authoring.json'), 'utf8'));
  m3.playtest.progress = 'score + nope';
  const r3 = JSON.parse(S.expand(JSON.stringify(m3)));
  const e3 = r3.diagnostics.find((x) => x.severity === 'error');
  if (r3.ok || !e3 || e3.at !== '/playtest/progress') fail(`bad playtest.progress: ${JSON.stringify(r3.diagnostics)}`);
  else console.log(`bad playtest.progress -> ${e3.code} at ${e3.at} (${e3.audience})`);

  const fenced = '```json\n' + readFileSync(join(authoringDir, 'games', 'tide_taps.authoring.json'), 'utf8') + '```';
  const r5 = JSON.parse(S.expand('Here it is:\n' + fenced));
  if (!r5.ok) fail('a fenced reply should expand');
  else console.log('fenced reply with prose -> ok');

  const r4 = JSON.parse(S.expand('{"uses": 7}'));
  if (r4.ok || !r4.diagnostics.length) fail('a malformed manifest should fail');
  else console.log(`malformed manifest -> ${r4.diagnostics[0].code} (${r4.diagnostics[0].audience})`);
}

// ---- the games ----
const lib = loadLibrary(authoringDir);
const rows = [];
for (const name of games) {
  console.log(`\n== ${name}`);
  const text = readFileSync(join(authoringDir, 'games', `${name}.authoring.json`), 'utf8');
  const te = performance.now();
  const r = JSON.parse(S.expand(text));
  const expandMs = performance.now() - te;
  const errors = r.diagnostics.filter((d) => d.severity === 'error');
  console.log(`  expand + validate ${expandMs.toFixed(1)} ms (expander ${r.ms.expand} ms, engine ${r.ms.validate} ms): ${r.ok ? 'ok' : 'ERRORS'}, ${r.diagnostics.length} diagnostics`);
  for (const d of errors) console.log(`    ${d.code} [${d.audience}] ${d.at} ${d.message}`);
  if (!r.ok) { fail(`${name} doesn't validate`); continue; }

  // Same game.json as the Node expander writes (apart from sort-safe param names).
  const direct = expand(JSON.parse(text), lib);
  const renamedParams = JSON.stringify(direct.game) !== JSON.stringify(r.game);
  if (renamedParams && !/"p0_/.test(JSON.stringify(r.game))) fail(`${name}: bundle and Node expander disagree on game.json`);
  // The app re-encodes JSON with sorted keys (Swift's JSONValue): the games must survive that.
  const engine = context.BubbleMicrogame.getEngine();
  for (const [label, g] of [['game', r.game], ['playtest game', r.playtest_game]]) {
    if (!g) continue;
    const errs = engine.validate(JSON.stringify(sortKeys(g))).filter((d) => d.severity === 'error');
    if (errs.length) fail(`${name}: the ${label} breaks with sorted keys: ${errs[0].code} ${errs[0].at}`);
  }
  if (renamedParams) console.log('  function params renamed so the game survives sorted keys');

  const tg = performance.now();
  const g = JSON.parse(await S.gate(JSON.stringify(r.playtest_game ?? r.game), 1));
  const gateS = (performance.now() - tg) / 1000;
  for (const run of g.runs) console.log(`    ${run.bot.label.padEnd(16)} ${run.outcome.padEnd(8)} ${String(run.score).padStart(6)} ${String(run.seconds).padStart(6)} s  (${run.ms} ms)${run.error ? '  ' + run.error : ''}`);
  for (const f of g.flags) console.log(`    ${f.blocking ? 'BLOCK' : 'note '} ${f.code}`);
  console.log(`  bundle gate ${gateS.toFixed(2)} s: ${g.passed ? 'PASS' : 'FAIL'} · ${g.summary}`);

  const w = JSON.parse(S.wrap(JSON.stringify({ id: `mg-test-${name}`, game: r.game, authoring: JSON.parse(text), emoji: '🎮' })));
  const wGame = typeof w.content?.game_json === 'string' ? JSON.parse(w.content.game_json) : null;
  const wAuth = typeof w.content?.authoring_json === 'string' ? JSON.parse(w.content.authoring_json) : null;
  if (w.formula !== 'microgame' || !wGame || JSON.stringify(wGame) !== JSON.stringify(r.game) || !wAuth?.uses?.every((u) => typeof u.version === 'number')) fail(`${name}: wrap`);

  const row = { name, expandMs, gateS, passed: g.passed };
  if (compare) {
    const tn = performance.now();
    const n = await playtest(JSON.stringify(direct.playtestGame ?? direct.game));
    row.nodeS = (performance.now() - tn) / 1000;
    row.nodePassed = n.passed;
    const same = n.runs.filter((x, i) => x.outcome === g.runs[i].outcome && x.score === g.runs[i].score).length;
    row.sameRuns = same;
    console.log(`  node gate   ${row.nodeS.toFixed(2)} s: ${n.passed ? 'PASS' : 'FAIL'} · ${same}/${n.runs.length} runs identical (outcome and score)`);
    if (n.passed !== g.passed) fail(`${name}: bundle gate ${g.passed ? 'passes' : 'fails'} but the Node gate ${n.passed ? 'passes' : 'fails'}`);
  }
  rows.push(row);
}

console.log('\ngame               expand ms   bundle gate s   node gate s   pass (bundle/node)');
for (const r of rows) {
  console.log(`${r.name.padEnd(18)} ${r.expandMs.toFixed(1).padStart(9)}   ${r.gateS.toFixed(2).padStart(13)}   ${(r.nodeS ?? NaN).toFixed(2).padStart(11)}   ${r.passed}/${r.nodePassed ?? '-'}`);
}
console.log(failures ? `\n${failures} failure(s)` : `\nall checks passed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
