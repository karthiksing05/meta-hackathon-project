#!/usr/bin/env node
// Unit tests for the `dead_inputs` flag in bots.mjs `analyze`. Plain Node, no packages, no engine:
// node authoring/playtest/test-dead-inputs.mjs  (exit 1 on any failure).

import { analyze } from './bots.mjs';

let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL ${name}${detail !== undefined ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}

const run = (label) => ({ bot: { label }, ok: true, outcome: 'fail', score: 3, seconds: 20 });
const runs = [run('new player'), run('regular'), run('pro')];
const game = {
  inputs: { hop: { from: [{ key: ' ' }] }, tap: { from: [{ pointer: true }] } },
  rules: [
    { id: 'hop_rule', on: 'hop', when: 'player.y >= 540.0', do: [] },
    { id: 'tap_rule', on: 'tap', when: 'false', do: [] },
  ],
};
const probe = (sent, dead, kind = 'key') => ({ sent, dead, byKind: { [kind]: { sent, dead } } });
const dead = (p, g = game) => analyze(runs, { inputProbe: p, game: g }).find((f) => f.code === 'dead_inputs');

const mostly = dead(probe(74, 61));
ok(mostly && mostly.blocking, 'mostly dead keys block', mostly);
ok(mostly?.message.includes('61 of 74') && mostly.message.includes('hop_rule') && mostly.message.includes('player.y >= 540.0'), 'message names the count and the blocking rule', mostly?.message);
ok(!mostly?.message.includes('tap_rule'), 'only rules for the dead kind are named', mostly?.message);

const half = dead(probe(60, 36));
ok(half && !half.blocking, 'half dead is a warning', half);
ok(!dead(probe(60, 20)), 'a third dead is fine');
ok(!dead(probe(19, 19)), 'too few inputs to judge');
ok(!dead(probe(60, 60, 'tap')), 'taps are not judged');
ok(!dead(null), 'no probe, no flag');
ok(dead(probe(30, 28), { inputs: {}, rules: [] })?.message.includes('no rule reacts'), 'no guarded rule: generic cause');
ok(!analyze(runs, {}).some((f) => f.code === 'dead_inputs'), 'analyze without options still works');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
