#!/usr/bin/env node
// Tests for story graphs: the condition and effect grammar, the validator's checks on small broken
// graphs, every graph in authoring/stories/, the compiler's determinism, and (with MG_ENGINE_DIR) the
// compiled games in the real engine: expand + validate, the story bots move for move against the
// graph walk, the generic gate, and the score check fed with the story bots.
//
//   node authoring/tools/test-story.mjs [--no-engine]

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCondition, parseEffects, wrapText, validateStoryGraph, compileStoryGraph, STORY_LIMITS } from '../expander/story-graph.mjs';
import { STORY_GRAPH_SYSTEM, storyGraphUser, storyRepairUser } from '../expander/story-prompt.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let passes = 0;
const check = (name, ok, detail = '') => {
  if (ok) passes++;
  else { failures++; console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`); }
};
const codes = (r) => r.errors.map((e) => e.code);
const wcodes = (r) => r.warnings.map((e) => e.code);

// ---------- grammar ----------
check('cond flag', JSON.stringify(parseCondition('key').alts) === '[[{"v":"key","op":">=","n":1}]]');
check('cond not', JSON.stringify(parseCondition('!key').alts) === '[[{"v":"key","op":"<=","n":0}]]');
check('cond and/or words', parseCondition('gold >= 2 and not caught or key').alts.length === 2);
check('cond > and <', JSON.stringify(parseCondition('a>2&b<3').alts) === '[[{"v":"a","op":">=","n":3},{"v":"b","op":"<=","n":2}]]');
check('cond ==', parseCondition('a==2').alts[0].length === 2);
check('cond != rejected', !!parseCondition('a!=2').error);
check('cond junk rejected', !!parseCondition('gold >> 2').error);
check('fx forms', JSON.stringify(parseEffects('+a -b c d+3 e-2 f=0').fx) === JSON.stringify([{ v: 'a', add: 1 }, { v: 'b', add: -1 }, { v: 'c', add: 1 }, { v: 'd', add: 3 }, { v: 'e', add: -2 }, { v: 'f', set: 0 }]));
check('fx list', parseEffects(['gold+2', 'key']).fx.length === 2);
check('fx junk rejected', !!parseEffects('gold*2').error);
check('wrap', JSON.stringify(wrapText('one two three four five six seven', 10)) === JSON.stringify(['one two', 'three four', 'five six', 'seven']));
check('wrap limit', wrapText('x '.repeat(80)).every((l) => l.length <= STORY_LIMITS.lineChars));

// ---------- validator on small graphs ----------
const T = 'Some words that set the scene.';
const end = (id, tone = 'good', rank) => ({ id, text: T, ending: { title: id, tone, ...(rank ? { rank } : {}) } });
const base = () => ({
  format: 'story-graph/1', title: 'Test', start: 'a',
  vars: [{ id: 'gold', kind: 'stat', min: 0, max: 3 }, { id: 'key', kind: 'item' }],
  nodes: [
    { id: 'a', text: T, choices: [{ label: 'Work', to: 'b', do: '+gold' }, { label: 'Wander', to: 'c' }] },
    { id: 'b', text: T, choices: [{ label: 'Buy key', to: 'c', if: 'gold>=1', do: '-gold key' }, { label: 'Go on', to: 'c' }] },
    { id: 'c', text: T, choices: [{ label: 'Open door', to: 'win', if: 'key' }, { label: 'Give up', to: 'lose' }] },
    end('win', 'good', 1), end('lose', 'bad', 2),
  ],
});
let r = validateStoryGraph(base());
check('base valid', r.ok, codes(r).join());
check('base stats', r.stats.endings === 2 && r.stats.shortest === 2 && r.stats.goal === 'win' && r.stats.goal_min_choices === 3, JSON.stringify(r.stats));
check('base odds sum to 1', Math.abs(r.stats.endings_detail.reduce((a, d) => a + d.p_random, 0) - 1) < 0.01);
check('base odds exact', r.stats.endings_detail.find((d) => d.id === 'win').p_random === 0.125, JSON.stringify(r.stats.endings_detail));

let g = base(); g.nodes[2].choices = [{ label: 'Open door', to: 'win', if: 'key' }];
r = validateStoryGraph(g);
check('dead end found', codes(r).includes('S_DEAD_END'), codes(r).join());
check('dead end path', /Wander/.test(r.errors.find((e) => e.code === 'S_DEAD_END')?.message ?? ''));

g = base(); g.nodes.splice(3, 0, { id: 'orphan', text: T, choices: [{ label: 'x', to: 'win' }] });
r = validateStoryGraph(g);
check('unreachable node', codes(r).includes('S_UNREACHABLE'), codes(r).join());

g = base(); g.nodes[2].choices[0].if = 'gold>=3';
r = validateStoryGraph(g);
check('unreachable ending by conditions', codes(r).includes('S_ENDING_UNREACHABLE') && /conditions/.test(r.errors.find((e) => e.code === 'S_ENDING_UNREACHABLE').message), codes(r).join());

g = base(); g.nodes[2].choices[1] = { label: 'Loop back', to: 'a' };
r = validateStoryGraph(g);
check('endless loop', codes(r).includes('S_NEVER_ENDS'), codes(r).join());

g = base(); g.nodes[2].choices[1] = { label: 'Loop back', to: 'a' }; g.max_choices = 6; g.on_limit = 'lose';
r = validateStoryGraph(g);
check('loop with limit and on_limit is fine', r.ok, codes(r).join());
check('on_limit reached', r.stats.endings_detail.find((d) => d.id === 'lose').min_choices === 6);

g = base(); g.nodes[2].choices[1] = { label: 'Loop back', to: 'a' }; g.max_choices = 6;
r = validateStoryGraph(g);
check('over limit without on_limit', codes(r).includes('S_OVER_LIMIT'), codes(r).join());

g = base(); g.max_choices = 2; g.on_limit = 'lose';
r = validateStoryGraph(g);
check('limit unsatisfiable', codes(r).includes('S_ENDING_UNREACHABLE') || codes(r).includes('S_LIMIT_UNSAT'), codes(r).join());

g = base(); g.nodes[0].text = 'word '.repeat(40);
r = validateStoryGraph(g);
check('text too long', codes(r).includes('S_TEXT_LONG'));
g = base(); g.nodes[0].choices[0].label = 'A label that is much too long for a button';
check('label too long', codes(validateStoryGraph(g)).includes('S_LABEL_LONG'));
g = base(); g.nodes[0].choices[0].do = '+silver';
check('unknown var', codes(validateStoryGraph(g)).includes('S_UNKNOWN_VAR'));
g = base(); g.nodes[0].choices.push({ label: 'c', to: 'c' }, { label: 'd', to: 'c' });
check('too many choices', codes(validateStoryGraph(g)).includes('S_TOO_MANY_CHOICES'));
g = base(); g.nodes[0].choices[0].to = 'nowhere';
check('bad target', codes(validateStoryGraph(g)).includes('S_TARGET'));
g = base(); g.nodes[3].ending.tone = 'bad';
check('no win', codes(validateStoryGraph(g)).includes('S_NO_WIN'));
g = base(); g.nodes[3].choices = [{ label: 'x', to: 'a' }];
check('ending with choices', codes(validateStoryGraph(g)).includes('S_ENDING_CHOICES'));
g = base(); g.nodes[3].ending.share = 'I won with {gold} gold and {silver}';
check('share unknown placeholder', codes(validateStoryGraph(g)).includes('S_SHARE'));
g = base(); g.vars[0].max = 50;
check('stat range', codes(validateStoryGraph(g)).includes('S_VAR_RANGE'));
g = base(); g.nodes[1].choices[1] = { label: 'Buy key', to: 'c', if: 'gold>=1', do: '-gold key' };
check('same choice warning', wcodes(validateStoryGraph(g)).includes('S_SAME_CHOICE'));
g = base(); g.nodes[1].choices[0].routes = [{ if: 'gold>=1', to: 'win' }]; // routes see the value after "-gold"
r = validateStoryGraph(g);
check('routes read values after the effects', r.ok && r.stats.endings_detail.find((d) => d.id === 'win').min_choices === 3, JSON.stringify(r.stats.endings_detail));
{
  const c = compileStoryGraph(base());
  check('group-play result shape', JSON.stringify(c.groupResult) === JSON.stringify({ kind: 'ending', compare: 'ending', display: '{ending}', endings: ['win', 'lose'], state: ['ending', 'choices_used'] }), JSON.stringify(c.groupResult));
}
check('validator is deterministic', JSON.stringify(validateStoryGraph(base()).stats) === JSON.stringify(validateStoryGraph(base()).stats));
check('not an object', !validateStoryGraph(null).ok && !validateStoryGraph([]).ok);

// ---------- prompts ----------
check('system prompt states the limits', STORY_GRAPH_SYSTEM.includes(`${STORY_LIMITS.label} characters`) && STORY_GRAPH_SYSTEM.includes('story-graph/1'));
check('user prompt', storyGraphUser('a story', { spec: { theme: 'pirates' } }).includes('pirates'));
check('repair prompt', storyRepairUser('a story', base(), validateStoryGraph(g)).includes('GRAPH:'));

// ---------- the stories ----------
const storyDir = join(root, 'stories');
const stories = readdirSync(storyDir).filter((f) => f.endsWith('.story.json')).sort().map((f) => ({ name: f.replace(/\.story\.json$/, ''), graph: JSON.parse(readFileSync(join(storyDir, f), 'utf8')) }));
for (const s of stories) {
  const rep = validateStoryGraph(s.graph);
  check(`${s.name} valid`, rep.ok, codes(rep).join());
  s.report = rep;
  const a = JSON.stringify(compileStoryGraph(s.graph).manifest);
  const b = JSON.stringify(compileStoryGraph(JSON.parse(JSON.stringify(s.graph))).manifest);
  check(`${s.name} compiles deterministically`, a === b);
  s.manifest = JSON.parse(a);
}
const committed = JSON.parse(readFileSync(join(root, 'games/story_peasant_crown.authoring.json'), 'utf8'));
const fresh = stories.find((s) => s.name === 'peasant_crown')?.manifest;
check('games/story_peasant_crown is the compiled peasant_crown', JSON.stringify(committed) === JSON.stringify(fresh), 'run: node authoring/tools/test-story.mjs --write');
if (process.argv.includes('--write') && fresh) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(root, 'games/story_peasant_crown.authoring.json'), JSON.stringify(fresh, null, 2) + '\n');
  console.log('wrote games/story_peasant_crown.authoring.json');
}

// ---------- in the engine ----------
let engine = null;
if (!process.argv.includes('--no-engine')) {
  try { ({ engine } = await (await import('../expander/engine.mjs')).loadEngine()); } catch (e) { console.log(`engine: skipped (${String(e.message).split('.')[0]})`); }
}
if (engine) {
  const { expandAndValidate } = await import('../expander/cli.mjs');
  const { storyGate, asScoreRuns } = await import('../playtest/story-bots.mjs');
  const { playtest } = await import('../playtest/gate.mjs');
  const { checkScore } = await import('../playtest/score-check.mjs');
  for (const s of stories) {
    if (!s.report.ok) continue;
    const x = await expandAndValidate(s.manifest);
    check(`${s.name} expands and validates in the engine`, x.errors.length === 0, x.errors.map((d) => d.message).join('; '));
    if (x.errors.length) continue;
    const json = JSON.stringify(x.game);
    const gate = storyGate(engine, json, s.report, s.manifest);
    const mism = gate.runs.filter((q) => q.mismatch);
    check(`${s.name} engine matches the graph on every move`, mism.length === 0, mism.map((q) => `${q.bot.label}: ${q.mismatch}`).join('; '));
    check(`${s.name} story gate`, gate.passed, gate.flags.filter((f) => f.blocking).map((f) => f.message).join('; '));
    const sc = await checkScore(engine, json, asScoreRuns(gate.runs), s.manifest.score);
    const failed = sc.checks.filter((c) => c.status === 'fail');
    check(`${s.name} score check with story bots`, failed.every((c) => c.id === 'spam'), failed.map((c) => c.message).join('; '));
    console.log(`  ${s.name}: ${gate.summary} · score check ${sc.checks.map((c) => `${c.id} ${c.status}`).join(', ')}`);
    if (s.name === 'peasant_crown') {
      const pt = await playtest(JSON.stringify(x.playtestGame ?? x.game));
      check('peasant_crown passes the generic gate', pt.passed, pt.flags.map((f) => f.message).join('; '));
      console.log(`  peasant_crown generic gate: ${pt.summary}`);
    }
  }
}

console.log(`${passes} passed, ${failures} failed (${stories.length} stories${engine ? ', engine' : ', no engine'})`);
process.exit(failures ? 1 : 0);
