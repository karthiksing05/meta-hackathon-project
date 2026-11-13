// Tests for the loop critic (authoring/tools/loop-critic.mjs) on two tiny fixture games. Needs MG_ENGINE_DIR.
//   node authoring/tools/test-loop-critic.mjs

import { loadEngine } from '../expander/engine.mjs';
import { critique, summary } from './loop-critic.mjs';

let failed = 0, passed = 0;
const ok = (cond, name, extra) => { if (cond) passed++; else { failed++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };

// A 50 s tapper: each tap scores `level`, and the level rises every tick. A sound on every tap.
const game = (rising) => ({
  format: 'microgame/0.2',
  meta: { title: 'Loop fixture', instructions: 'Tap the button.', duration_s: 50 },
  state: { taps: { type: 'float', init: '0.0' }, level: { type: 'float', init: '1.0' } },
  inputs: { tap: { payload: {} } },
  rules: [
    { id: 'rise', on: 'tick', do: [{ set: 'level', to: rising ? 'level + 0.002' : 'level' }] },
    { id: 't', on: 'tap', do: [{ set: 'taps', to: 'taps + level' }] },
  ],
  objectives: { score: 'taps', time_limit: '50s', on_timeout: 'win' },
  presentation: {
    canvas: { w: 360, h: 640, background: '#F4F1EA' }, tokens: {},
    root: { node: 'group', children: [
      { node: 'rect', x: 120, y: 300, w: 120, h: 60, radius: 12, fill: '#2F6FDE', on_tap: { input: 'tap' } },
      { node: 'text', x: 180, y: 330, anchor: 'center', size: 18, color: '#FFFFFF', text: 'Tap' },
    ] },
    feedback: [{ on: 'tap', do: [{ sound: { wave: 'square', note: 'C5', ms: 60 } }] }],
  },
});

const { engine } = await loadEngine();
const r = await critique(game(true), { engine, maxSeconds: 60 });
console.log(summary(r, 'rising tapper'));
ok(r.bots.length === 5 && r.bots.every((b) => b.end === 'won' && Math.abs(b.seconds - 50) < 0.5), 'five bots, each a 50 s run', r.bots.map((b) => [b.bot, b.seconds, b.end]));
ok(r.checks.runLength.status === 'pass', 'run length 50 s passes', r.checks.runLength);
ok(r.checks.goal.status === 'pass' && r.checks.goal.value <= 1, 'the first meaningful input comes at once', r.checks.goal);
ok(r.checks.cadence.value.medianS > 0 && r.checks.cadence.value.medianS < 1 && r.checks.cadence.value.feedbackMedianS < 1, 'every tap matters and sounds', r.checks.cadence);
ok(r.checks.deadTime.status === 'pass' && r.checks.deadTime.value < 6, 'no dead time', r.checks.deadTime);
ok(r.checks.escalation.status === 'pass' && r.checks.escalation.value.rises.some((x) => /level|score/.test(x)), 'a rising level is escalation', r.checks.escalation);
ok(r.bots.every((b) => b.escalation.rows.find((x) => x.name === 'state level').last > b.escalation.rows.find((x) => x.name === 'state level').first), 'level rows: last third above the first');
ok(typeof r.checks.restart.value === 'number' && r.checks.restart.status === 'pass', 'restart is measured', r.checks.restart);
ok(r.gate && typeof r.gate.passed === 'boolean', 'the gate ran');

const flat = await critique(game(false), { engine, maxSeconds: 60 });
ok(!flat.checks.escalation.value.rises.includes('state level'), 'a flat level is not escalation', flat.checks.escalation);
ok(JSON.parse(JSON.stringify(flat)).checks.skillSpread.value.best >= flat.checks.skillSpread.value.worst, 'the report is plain JSON');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
