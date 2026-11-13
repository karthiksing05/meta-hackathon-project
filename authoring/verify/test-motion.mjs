// Tests for the motion checks and fixes (motion-track.mjs, motion.mjs, motion-fix.mjs, checks/motion.mjs),
// with Guess the Decade (Prod, 2026-11-13) as the fixture: three stacked shakes on a wrong answer, a
// 1.25× score pulse and a 1.6× life pulse, a HUD row that re-centres when the score grows, answers
// that swap with no fade, reveal colours carried onto the next round's answers, an end card that
// pops in under 72 particles. No Muse. Needs MG_ENGINE_DIR.
//   node authoring/verify/test-motion.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../expander/engine.mjs';
import { readInput, verify, verifyAndFix } from './verify.mjs';
import { sampleMotion, toastOp, shellFit } from './motion-track.mjs';
import { motionFindings, pickShakeKeeper, triggerEvents, isFailEvent, MOTION } from './motion.mjs';
import { motionFix } from './motion-fix.mjs';
import { sameRules, proveUnchanged } from './prove.mjs';
import { rulesHash } from '../testbed/rebuild.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
const ok = (cond, name, extra) => { if (cond) passed++; else { failed++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
const codes = (fs) => fs.filter((f) => f.severity === 'block').map((f) => `${f.code}:${f.cause}`);

const { engine } = await loadEngine();
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/guess-the-decade.json'), 'utf8'));
const runs = JSON.parse(readFileSync(join(here, 'fixtures/guess-the-decade-runs.json'), 'utf8'));
const { game } = readInput(fixture);

// --- shell geometry
{
  ok(shellFit(360, 640).s === 1 && shellFit(360, 780).oy === -70, 'shell fit: 640 fills, 780 runs past top and bottom');
  const t = toastOp('Hello', 0, 360, 640);
  ok(Math.abs((t.y + t.h / 2) - 179.2) < 0.5 && toastOp('Hello', 950, 360, 640) === null, 'old toasts start at 0.28 H and are gone after 0.9 s');
}

// --- structure helpers
{
  ok(isFailEvent('answered_wrong') && isFailEvent('life_lost') && !isFailEvent('answered_right') && !isFailEvent('win'), 'fail moments by name');
  ok(pickShakeKeeper(game)?.on === 'answered_wrong', 'the kept shake is on the cause (answered_wrong), not its echo (life_lost)');
  const ev = triggerEvents(game, '/presentation/root/children/1/children/2/template/children/2');
  ok(ev.includes('quiz__ask') && !ev.includes('tick'), 'answer labels change on quiz__ask', ev);
  ok(triggerEvents(game, '/presentation/root/children/4/children/0').join() === 'win,lose', 'the end card shows on win or lose');
}

// --- findings on the Prod build
const ms = await sampleMotion(game, { runs, engine, maxSeconds: 60 });
const before = motionFindings(game, ms);
{
  const c = codes(before);
  ok(ms.runs[0].frames.length > 300 && ms.dtMs === 50, 'a frame every 50 ms, nothing dropped', ms.runs[0].frames.length);
  ok(c.filter((x) => x === 'M_SHAKE:feedback-shake').length === 3, 'three shakes on a wrong answer, all flagged', c);
  ok(c.includes('M_TEXT_UNSTABLE:pulse') && c.includes('M_PULSE:pulse'), 'score pulse 1.25× and life pulse 1.6× flagged', c);
  ok(before.some((f) => f.cause === 'reflow' && /Round 1 of 10/.test(f.message)), 'the HUD row re-centring moves "Round"', c);
  ok(before.some((f) => f.code === 'M_POP' && f.node.endsWith('/template/children/2')), 'answer labels swap with no fade', c);
  ok(before.some((f) => f.code === 'M_POP' && f.node === '/presentation/root/children/4/children/0'), 'the end card pops in', c);
  ok(before.some((f) => f.cause === 'carry-over' && f.node.endsWith('/template/children/1')), "the next answers show on the reveal's colours", c);
  ok(before.some((f) => f.cause === 'particles'), 'particles over the final score', c);
  ok(before.some((f) => f.code === 'M_TEXT_HOLD' && f.severity === 'warn'), 'the 700 ms hint is too short to read (a warning: rules)', c);
}

// --- the fix: presentation only, same rules hash, every finding but the rules-bound one gone
const fixed = motionFix(game, before.filter((f) => f.severity === 'block'), { msample: ms, lookId: 'neon' });
{
  const g = fixed.game;
  ok(rulesHash(g) === rulesHash(game), 'same rules hash');
  ok(sameRules(game, g).rules, 'rules, handlers and the feedback (sounds, haptics) unchanged', sameRules(game, g).diff);
  const shakes = (g.presentation.feedback ?? []).flatMap((fb) => (fb.do ?? []).filter((a) => a.shake).map((a) => ({ on: fb.on, ...a.shake })));
  ok(shakes.length === 1 && shakes[0].on === 'answered_wrong' && shakes[0].px <= MOTION.shakeMaxPx && shakes[0].ms <= MOTION.shakeMaxMs, 'one subtle shake, on a wrong answer', shakes);
  const row = g.presentation.root.children[2];
  ok(row.children.filter((c) => c.node === 'text').every((c) => typeof c.w === 'number' && c.align === 'center'), 'fixed HUD slots');
  const label = g.presentation.root.children[1].children[2].template.children[2];
  ok(label.animate_on?.quiz__ask?.prop === 'opacity' && label.animate_on.quiz__ask.ms === 160, 'answer labels fade in on quiz__ask');
  ok(!g.presentation.root.children[1].children[2].template.children[1].transition?.fill, 'the reveal fill clears at once');
  ok(g.presentation.root.children[4].children[0].animate_on?.win?.prop === 'opacity', 'the end card fades in');
  const ms2 = await sampleMotion(g, { runs, engine, maxSeconds: 60 });
  const after = motionFindings(g, ms2);
  ok(codes(after).length === 0, 'no blocking motion findings after the fix', codes(after));
  ok(after.some((f) => f.code === 'M_TEXT_HOLD'), 'the rules-bound hint stays a warning');
  // HUD row: "Round" stays put when the score grows.
  const xs = new Set();
  for (const f of ms2.runs[0].frames) for (const it of f.items) if (it.text?.startsWith('Round')) xs.add(Math.round((it.box.x0 + it.box.x1) / 2));
  ok(xs.size === 1, '"Round" never moves', [...xs]);
  const proof = await proveUnchanged(game, g, { engine, runs, maxSeconds: 60 });
  ok(proof.rules && proof.replays, 'proof: same replays', proof);
  ok(motionFix(g, [], { msample: ms2, lookId: 'neon' }).fixes.length === 0, 'the fix is idempotent');
}

// --- in the verifier: registered codes, and verifyAndFix's motion stage
{
  const r = await verify(fixture, { engine, runs, maxSeconds: 30, pixels: false, only: ['motion'] });
  ok(r.checks.ran.includes('motion') && r.findings.some((f) => f.code === 'M_SHAKE' && f.severity === 'block'), 'the motion check runs in verify()', r.checks);
  const res = await verifyAndFix(fixture, { engine, runs, maxSeconds: 30, pixels: false, budgetMs: 0, solverRounds: 0, finalPass: false });
  ok(res.fixes.some((f) => f.stage === 'motion') && !res.reverted, 'verifyAndFix applies the motion fixes and keeps them', res.stages);
  ok(!res.report.findings.some((f) => f.code.startsWith('M_') && f.severity === 'block'), 'and the result has no blocking motion finding', res.report.findings.filter((f) => f.code.startsWith('M_')));
  ok(rulesHash(res.game) === rulesHash(game), 'verifyAndFix keeps the rules hash');
}

// --- small games: element shake on a button, a stable game stays clean
{
  const g0 = JSON.parse(JSON.stringify(game));
  g0.presentation.root.children[1].children[2].template.animate_on.answer = { prop: 'x', keys: [0, -6, 6, -4, 4, 0], ms: 300 };
  const f = motionFindings(g0, ms);
  ok(f.some((x) => x.code === 'M_SHAKE' && x.cause === 'element-shake' && x.severity === 'block'), 'a button that shakes is flagged');
  const r = motionFix(g0, f.filter((x) => x.severity === 'block'), { msample: ms, lookId: 'neon' });
  ok(!r.game.presentation.root.children[1].children[2].template.animate_on?.answer, 'and its shake is dropped');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
