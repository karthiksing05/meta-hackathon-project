#!/usr/bin/env node
// Tests group play in compose (docs/harness-gaps/group-play.md), with no network: the manifest block
// from the spec's social part, its consistency with the score, the compose rules in the plan menu,
// share lines and the two-player agreement stand-in.
// Usage: node authoring/tools/test-group-play.mjs

import * as G from '../expander/group-play.mjs';
import * as P from '../expander/prompts.mjs';

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log(`FAIL ${msg}`); } };

// no social part: no block, no rules
ok(G.groupPlayBlock(null) === null && G.groupPlayRules(undefined).length === 0, 'no social, no block');

// a score game sent into a chat
let b = G.groupPlayBlock({ mode: 'series', best_of: 5, round_seconds: 60, result: { kind: 'score', compare: 'score', display: '{score}' }, share_line: '{name} ran {result}. Your turn.', same_seed: false });
ok(b.mode === 'series' && b.best_of === 5 && b.same_seed === true && b.modes.includes('weekly_board') && b.round_seconds === 60, `series block ${JSON.stringify(b)}`);

// an unranked score can't be compared as a score
b = G.groupPlayBlock({ mode: 'series', result: { compare: 'score' }, share_line: '{result}' }, { kind: 'points', ranked: false });
ok(b.result.compare === 'none' && b.mode === 'same_seed_async' && !b.best_of, `unranked ${JSON.stringify(b)}`);

// an opinion game: agreement, picks, opinion_compare
b = G.groupPlayBlock({ result: { kind: 'score', compare: 'agreement' }, share_line: 'no placeholder here' });
ok(b.result.kind === 'picks' && b.mode === 'opinion_compare' && b.share_line === G.DEFAULT_SHARE_LINE && b.result.display.includes('{agreement}'), `opinion ${JSON.stringify(b)}`);

// a story: endings kept, best first; an older plan's share text with a placeholder is used
b = G.groupPlayBlock({ result: { compare: 'ending', endings: ['Crowned', 'Knighted', 'Exiled'], state: ['ending', 'choices_used'] }, share: '{name} reached {result}' });
ok(b.result.kind === 'ending' && b.result.endings.length === 3 && b.result.state[1] === 'choices_used' && b.share_line === '{name} reached {result}', `story ${JSON.stringify(b)}`);

// compose rules
const rules = G.groupPlayRules({ round_seconds: 45, result: { compare: 'ending', endings: ['Crowned', 'Exiled'] }, share_line: '{name}: {result}' }).join('\n');
ok(/same seed/.test(rules) && /45 s/.test(rules) && /`ending`/.test(rules) && /never names an answer/.test(rules) && /device, the clock/.test(rules), 'story rules');
const op = G.groupPlayRules({ result: { compare: 'agreement' } }).join('\n');
ok(/No right answer/.test(op) && /`picks`/.test(op) && /don't score how many picks/.test(op), 'opinion rules');

// the plan menu carries them
const menu = P.planMenu({ prompt: { fragment_specs: {} } }, { tools: [{ id: 'x', kind: 'builtin', summary: 'x' }], types: [], plan: { spec: { spec: 'game-spec/1', social: { result: { compare: 'agreement' } }, score: { kind: 'points' } } } });
ok(menu.spec.includes('Group play:') && menu.spec.includes('No right answer'), 'planMenu has the group play rules');
const plain = P.planMenu({ prompt: { fragment_specs: {} } }, { tools: [{ id: 'x', kind: 'builtin', summary: 'x' }], types: [], plan: { spec: { spec: 'game-spec/1' } } });
ok(!plain.spec.includes('Group play:'), 'no social part, no rules');

// share lines
ok(G.fillLine('{name}: {result} on {title}. Your turn.', { name: 'Ana', result: '1:02.4', title: 'Toast Pong' }) === 'Ana: 1:02.4 on Toast Pong. Your turn.', 'fillLine');
ok(G.fillLine('{name} {missing}', { name: 'B' }) === 'B {missing}', 'fillLine keeps unknown placeholders');

// agreement between two friends
ok(G.agreement(['S', 'A', 'B'], ['S', 'A', 'C']) === 67, 'tiers agree 2 of 3');
ok(G.agreement([5, 4, 1], [5, 4, 1]) === 100 && G.agreement([5, 1], [1, 5]) < 50, 'ratings');
ok(G.agreement([1], [1, 2]) === null, 'different lengths are not comparable');

// structure follows group play and the job's target (Kevin32: always {endless, everyone, ai})
ok(JSON.stringify(G.structureFor({})) === JSON.stringify({ cadence: 'endless', scope: 'everyone', setter: 'ai' }), 'default structure');
ok(G.structureFor({ authoring: { uses: [{ fragment: 'daily_seed' }] } }).cadence === 'daily', 'daily_seed in the game makes it daily');
ok(G.structureFor({ context: { plan: { tool_ids: ['daily_seed'] } } }).cadence === 'daily', 'a planned daily_seed makes it daily');
ok(G.structureFor({ groupPlay: { mode: 'weekly_board' } }).cadence === 'daily', 'a weekly board game is daily');
ok(G.structureFor({ context: { group: { id: 'pickle-crew' } } }).scope === 'group:pickle-crew' && G.structureFor({ context: { group: { id: 'picnic', kind: 'event' } } }).scope === 'event:picnic', 'a Group or Event job is scoped to it');
ok(G.structureFor({ context: { scope: 'group:x y' } }).scope === 'everyone', 'a malformed scope is ignored');
ok(/daily_seed/.test(G.groupPlayRules({ mode: 'weekly_board', result: { compare: 'score' } }).join('\n')), 'weekly board rules ask for daily_seed');

console.log(`group play: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
