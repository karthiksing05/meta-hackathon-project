// Tests for the verifier, its checks, the layout solver and the proof (no Muse).
// Needs a built engine (MG_ENGINE_DIR). Chrome is optional (widths fall back to the 0.6 em estimate).
//   node authoring/verify/test-verify.mjs

import { loadEngine } from '../expander/engine.mjs';
import { verify, verifyAndFix, summarizeFindings } from './verify.mjs';
import { register, unregister, loadChecks, allChecks, codeInfo, finding } from './registry.mjs';
import { sampleDense, remapTap } from './frames.mjs';
import { solveLayout, movableUnit } from './solve.mjs';
import { sameRules, proveUnchanged } from './prove.mjs';

let failed = 0, passed = 0;
const ok = (cond, name, extra) => { if (cond) passed++; else { failed++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const has = (r, code, sev) => r.findings.some((f) => f.code === code && (!sev || f.severity === sev));

const base = (children, extra = {}) => ({
  format: 'microgame/0.2',
  meta: { title: 'Test', instructions: 'Tap.', duration_s: 20 },
  state: { y: { type: 'float', init: '0' }, taps: { type: 'int', init: '0' }, over: { type: 'bool', init: 'false' } },
  inputs: { tap: { payload: {} }, finish: { payload: {} } },
  rules: [
    { id: 'fall', on: 'tick', do: [{ set: 'y', to: 'if y > 600 then 0.0 else y + 2.0' }] },
    { id: 't', on: 'tap', do: [{ incr: 'taps' }] },
    { id: 'f', on: 'finish', do: [{ set: 'over', to: 'true' }] },
  ],
  objectives: { score: 'taps', time_limit: '20s', on_timeout: 'lose' },
  presentation: { canvas: { w: 360, h: 640, background: '$bg' }, tokens: { bg: '#F4F1EA', ink: '#1A1A1A', surface: '#FFFFFF', accent: '#2F6FDE' }, root: { node: 'group', children } },
  assets: { block: { svg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'><rect width='60' height='60' fill='#C0392B'/></svg>", w: 60, h: 60 } },
  ...extra,
});

const clean = () => base([
  { node: 'text', x: 180, y: 30, anchor: 'center', size: 18, weight: 700, color: '$ink', text: "= 'Score: ' + str(taps)" },
  { node: 'rect', x: 120, y: 500, w: 120, h: 56, radius: 12, fill: '$accent', on_tap: { input: 'tap' } },
  { node: 'text', x: 180, y: 528, anchor: 'center', size: 18, weight: 700, color: '#FFFFFF', text: 'Tap' },
]);

const { engine } = await loadEngine();
await loadChecks();
const opts = { engine, maxSeconds: 8, pixels: false };

// --- registry
{
  const ids = allChecks().map((c) => c.id);
  ok(['layout', 'targets', 'style', 'requirements', 'fill'].every((i) => ids.includes(i)), 'built-in checks load', ids);
  ok(codeInfo('L_TAP_THROUGH')?.severity === 'block' && codeInfo('L_TEXT_SMALL')?.severity === 'warn', 'codes carry severities');
  register({ id: 'test-fill', family: 'F', codes: { F_TEST_EMPTY: { severity: 'warn', title: 't', hint: 'h' } }, needs: ['game'], run: () => [finding('F_TEST_EMPTY', { message: 'empty' })] });
  const r = await verify(clean(), opts);
  ok(has(r, 'F_TEST_EMPTY', 'warn') && r.checks.ran.includes('test-fill'), 'a registered check runs and reports', r.checks);
  let threw = false;
  try { register({ id: 'other', codes: { F_TEST_EMPTY: { severity: 'warn' } }, run: () => [] }); } catch { threw = true; }
  ok(threw, 'two checks cannot own one code');
  unregister('test-fill');
  ok(summarizeFindings([{ code: 'A_X', severity: 'block' }, { code: 'A_Y', severity: 'warn' }]).score === 88, 'score: 10 per block, 2 per warn');
}

// --- a clean game passes; the report has the documented shape
{
  const r = await verify(clean(), opts);
  ok(r.pass && r.blocking === 0, 'clean game passes', r.findings);
  ok(r.coverage.captured > 50 && r.coverage.endStates.lost + r.coverage.endStates.timeout >= 1, 'dense frames and an end state', r.coverage);
  ok(r.checks.skipped.some((s) => s.id === 'requirements'), 'requirements skipped without requirements');
}

// --- each blocking code fires
{
  const g = base([
    { node: 'text', x: 180, y: 30, anchor: 'center', size: 18, weight: 700, color: '$ink', text: "= 'Score: ' + str(taps)" },
    { node: 'image', asset: 'block', x: 150, y: '= y', w: 60, h: 60 },
    { node: 'text', x: 180, y: 300, anchor: 'center', size: 16, weight: 700, color: '$ink', text: 'Overlapping words here' },
    { node: 'text', x: 186, y: 304, anchor: 'center', size: 16, weight: 700, color: '$ink', text: 'Second line on top' },
    { node: 'rect', x: 20, y: 560, w: 30, h: 30, fill: '$accent', on_tap: { input: 'tap' } },
    { node: 'rect', x: 52, y: 560, w: 44, h: 44, fill: '$accent', on_tap: { input: 'finish' } },
    { node: 'text', x: 340, y: 420, size: 16, color: '$ink', text: 'Off the edge of the screen' },
    { node: 'text', x: 180, y: 380, anchor: 'center', size: 16, color: '#F0EDE6', text: 'pale words' },
  ]);
  const r = await verify(g, opts);
  for (const code of ['L_OVERLAP_TEXT', 'L_TARGET_SMALL', 'L_TARGET_GAP', 'L_TEXT_CLIPPED', 'L_LOW_CONTRAST', 'L_TEXT_ON_SPRITE', 'L_OVERLAP_HUD']) ok(has(r, code, 'block'), `${code} blocks`, r.findings.map((f) => f.code));
  ok(!r.pass, 'bad game fails');
  ok(r.findings.every((f) => 'code' in f && 'severity' in f && 'node' in f && 'frame' in f && 'message' in f && 'hint' in f), 'every finding has the report shape');
}

// --- tap-through: an end panel with no handler over a live button
{
  const g = base([
    { node: 'rect', x: 120, y: 300, w: 120, h: 60, radius: 12, fill: '$accent', on_tap: { input: 'tap' } },
    { node: 'rect', x: 120, y: 200, w: 120, h: 50, fill: '$accent', on_tap: { input: 'finish' } },
    { node: 'group', visible: '= over', children: [{ node: 'rect', x: 20, y: 150, w: 320, h: 300, radius: 16, fill: '$surface' }, { node: 'text', x: 180, y: 200, anchor: 'center', size: 22, color: '$ink', text: 'Round over' }] },
  ]);
  const runs = [{ bot: { label: 'scripted' }, replay: { seed: 1, actions: [{ step: 30, action: { kind: 'tap', x: 180, y: 225 } }, { step: 60, action: { kind: 'tap', x: 180, y: 330 } }] } }];
  const r = await verify(g, { ...opts, runs });
  ok(has(r, 'L_TAP_THROUGH', 'block'), 'tap through an overlay to a live button blocks', r.findings.map((f) => `${f.code} ${f.node}`));
  const fixed = await verifyAndFix(g, { ...opts, runs });
  ok(!has(fixed.report, 'L_TAP_THROUGH'), 'the solver gates the covered button on the overlay', fixed.fixes);
  ok(fixed.proof.rules, 'gating keeps the rules', fixed.proof);
}

// --- solver: overlapping texts get separate slots; rules and replays unchanged
{
  const g = base([
    { node: 'text', x: 180, y: 30, anchor: 'center', size: 18, weight: 700, color: '$ink', text: "= 'Score: ' + str(taps)" },
    { node: 'text', x: 180, y: 300, anchor: 'center', size: 16, weight: 700, color: '$ink', text: 'Overlapping words here' },
    { node: 'text', x: 186, y: 304, anchor: 'center', size: 16, weight: 700, color: '$ink', text: 'Second line on top' },
    { node: 'rect', x: 120, y: 500, w: 120, h: 56, radius: 12, fill: '$accent', on_tap: { input: 'tap' } },
  ]);
  const r = await verify(g, opts);
  const s = await solveLayout(g, r);
  ok(s.moves.some((m) => m.kind === 'slot'), 'solver assigns a slot', s.moves);
  const r2 = await verify(s.game, { ...opts, ref: g });
  ok(!has(r2, 'L_OVERLAP_TEXT'), 'texts no longer overlap', r2.findings);
  ok(sameRules(g, s.game).rules, 'rules unchanged');
  const proof = await proveUnchanged(g, s.game, { engine, maxSeconds: 8 });
  ok(proof.replays, 'replay hashes unchanged', proof.runs);
  ok(movableUnit(s.game, '/presentation/root/children/1') === '/presentation/root/children/1', 'a free text is its own unit');
}

// --- proof catches a rules change
{
  const g = clean();
  const h = JSON.parse(JSON.stringify(g));
  h.rules[1].do = [{ incr: 'taps', by: '2' }];
  ok(!sameRules(g, h).rules, 'a changed rule fails the proof');
}

// --- tap remapping follows the target
{
  const a = remapTap({ kind: 'tap', x: 110, y: 110 }, [{ x: 100, y: 100, w: 20, h: 20 }], [{ x: 200, y: 300, w: 40, h: 40 }]);
  ok(a.x === 220 && a.y === 320, 'remapTap keeps the relative spot', a);
}

// --- sampler covers intro and end
{
  const s = await sampleDense(clean(), { engine, maxSeconds: 25 });
  ok(s.frames.some((f) => f.label === 'intro') && s.frames.some((f) => f.label.startsWith('end-')), 'intro and end frames', [...new Set(s.frames.map((f) => f.label))]);
}

// --- FC-02 and FC-10 on Fog Over the Bay (Prod, 2026-11-13): a cream timer over the moon, and a cream
// end card in a dark teal game whose words were drawn in its own colour.
{
  const { readFileSync } = await import('node:fs');
  const fog = JSON.parse(readFileSync(new URL('./fixtures/fog-over-the-bay.game.json', import.meta.url), 'utf8'));
  const r = await verify(fog, { engine, maxSeconds: 62, pixels: false });
  const timer = r.findings.find((f) => f.code === 'S_HUD_READABILITY' && /s"/.test(f.message));
  ok(timer && timer.severity === 'block' && timer.node === '/presentation/root/children/2/children/1', 'the timer over the moon is S_HUD_READABILITY', r.findings.filter((f) => f.code === 'S_HUD_READABILITY').map((f) => f.message));
  ok(!r.findings.some((f) => f.code === 'S_HUD_READABILITY' && f.node?.startsWith('/presentation/root/children/4/')), 'end-card text is not a HUD readout');
  const card = r.findings.find((f) => f.code === 'S_STRAY_SHAPE');
  ok(card && card.node === '/presentation/root/children/4/children/0/children/0' && /off the look/.test(card.message), 'the cream end card is S_STRAY_SHAPE (off the look)', card);
  const { fixShapes } = await import('../expander/layout-fix.mjs');
  const fx = fixShapes(fog, [{ node: '/presentation/root/children/4/children/0/children/0', off: true }]);
  ok(fx.game.presentation.root.children[4].children[0].children[0].fill === '$surface' && fx.fixes.length === 1, 'an off-look panel takes $surface', fx.fixes);
  ok(sameRules(fog, fx.game).rules, 'repainting a panel keeps the rules');
  const fixed = await verifyAndFix(fog, { engine, maxSeconds: 62, pixels: false });
  ok(!fixed.report.findings.some((f) => ['S_HUD_READABILITY', 'S_STRAY_SHAPE'].includes(f.code) && f.severity === 'block') && fixed.proof.rules && fixed.proof.replays, 'verifyAndFix clears both, rules and replays unchanged', fixed.report.findings.filter((f) => f.severity === 'block').map((f) => f.code));
}
{
  // An empty outlined box is hidden; a box that holds something stays.
  const { fixShapes } = await import('../expander/layout-fix.mjs');
  const g = { presentation: { root: { node: 'group', children: [{ node: 'rect', x: 40, y: 300, w: 120, h: 60, fill: '#00000000', stroke: '$line', stroke_width: 3 }] } } };
  const fx = fixShapes(g, [{ node: '/presentation/root/children/0', empty: true }]);
  ok(fx.game.presentation.root.children[0].visible === false, 'an empty box is hidden', fx.fixes);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
