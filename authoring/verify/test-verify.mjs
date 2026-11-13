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

// --- FC-13 V_VECTOR_FIGURE: figures drawn from shapes block; bars, rings, rows, grids and particles don't.
{
  const figs = async (children, extra) => (await verify(base(children, extra), { ...opts, only: ['vector-figures'] })).findings.filter((f) => f.code.startsWith('V_'));
  const label = { node: 'text', x: 180, y: 30, anchor: 'center', size: 18, weight: 700, color: '$ink', text: "= 'Score: ' + str(taps)" };
  // an owl from circles: body, two eyes with pupils, two ear triangles
  const owl = await figs([label, { node: 'group', x: 0, y: 0, children: [
    { node: 'circle', x: 180, y: 320, r: 60, fill: '#8B5A2B' },
    { node: 'poly', points: [[130, 285], [140, 240], [160, 275]], fill: '#8B5A2B' },
    { node: 'poly', points: [[230, 285], [220, 240], [200, 275]], fill: '#8B5A2B' },
    { node: 'circle', x: 157, y: 305, r: 16, fill: '#FFFFFF' }, { node: 'circle', x: 203, y: 305, r: 16, fill: '#FFFFFF' },
    { node: 'circle', x: 157, y: 305, r: 7, fill: '#111111' }, { node: 'circle', x: 203, y: 305, r: 7, fill: '#111111' },
  ] }]);
  ok(owl.some((f) => f.code === 'V_VECTOR_FIGURE' && f.severity === 'block' && /eyes/.test(f.rule)), 'an owl from circles is V_VECTOR_FIGURE (eyes)', owl);
  ok(owl.some((f) => /limbs/.test(f.rule ?? '')), 'its ears are a mirrored pair (limbs)', owl.map((f) => f.rule));
  // a person: a circle head on a rect body, moving together
  const person = await figs([label,
    { node: 'circle', x: 180, y: '= 200 + y * 0.2', r: 22, fill: '#F2C9A0' },
    { node: 'rect', x: 158, y: '= 222 + y * 0.2', w: 44, h: 70, radius: 8, fill: '#2F6FDE' },
  ]);
  ok(person.some((f) => f.code === 'V_VECTOR_FIGURE' && /head/.test(f.rule)), 'a person from a circle and a rect is V_VECTOR_FIGURE (head)', person);
  // a burrito group named in its id, drawn from shapes with no image
  const burrito = await figs([label, { node: 'group', id: 'burrito', children: [
    { node: 'rect', x: 120, y: 300, w: 120, h: 50, radius: 25, fill: '#E8C27A' },
    { node: 'rect', x: 130, y: 310, w: 100, h: 10, radius: 5, fill: '#5DAA3C' },
  ] }]);
  ok(burrito.some((f) => f.code === 'V_VECTOR_FIGURE' && f.rule === 'name' && f.node === '/presentation/root/children/1'), 'a "burrito" group of shapes is V_VECTOR_FIGURE (name)', burrito);
  // the same group with a picture in it is fine; UI names are fine
  const pic = await figs([label, { node: 'group', id: 'burrito', children: [
    { node: 'image', asset: 'block', x: 120, y: 300, w: 120, h: 50 }, { node: 'rect', x: 120, y: 360, w: 120, h: 8, fill: '#5DAA3C' }, { node: 'rect', x: 120, y: 372, w: 60, h: 8, fill: '#5DAA3C' },
  ] }, { node: 'group', id: 'player_hp_bar', children: [{ node: 'rect', x: 20, y: 60, w: 200, h: 10, fill: '#333333' }, { node: 'rect', x: 20, y: 60, w: '= 2.0 * taps', h: 10, fill: '#2F6FDE' }] }]);
  ok(!pic.some((f) => f.severity === 'block'), 'a named group with an image, and a "player_hp_bar", are not figures', pic);
  // not figures: a row of equal dots, a progress bar with a knob, a single ring, a 4×4 grid of dots,
  // concentric rings, a column of beads, a die face of five pips, particles on tap
  const neg = await figs([label,
    { node: 'repeat', source: 'range(5)', as: 'k', key: 'k', template: { node: 'circle', x: '= 100 + k * 40', y: 120, r: 14, fill: '#2F6FDE' } },
    { node: 'rect', x: 40, y: 170, w: 280, h: 12, radius: 6, fill: '#DDDDDD' }, { node: 'circle', x: 160, y: 176, r: 14, fill: '#2F6FDE' },
    { node: 'circle', x: 80, y: 260, r: 40, fill: '#00000000', stroke: '#2F6FDE', stroke_width: 6 },
    { node: 'circle', x: 270, y: 260, r: 40, fill: '#2F6FDE' }, { node: 'circle', x: 270, y: 260, r: 26, fill: '#FFFFFF' }, { node: 'circle', x: 270, y: 260, r: 12, fill: '#2F6FDE' },
    { node: 'grid', cols: 4, rows: 4, cell_size: 30, gap: 10, x: 100, y: 330, cell: { node: 'circle', x: 15, y: 15, r: 10, fill: '#2F6FDE' } },
    { node: 'repeat', source: 'range(3)', as: 'k', key: 'k', template: { node: 'circle', x: 40, y: '= 360 + k * 30', r: 15, fill: '#C0392B' } },
    { node: 'circle', x: 300, y: 420, r: 34, fill: '#FFFFFF' },
    ...[[285, 405], [315, 405], [300, 420], [285, 435], [315, 435]].map(([x, y]) => ({ node: 'circle', x, y, r: 5, fill: '#111111' })),
    { node: 'rect', x: 120, y: 500, w: 120, h: 56, radius: 12, fill: '$accent', on_tap: { input: 'tap' } },
    { node: 'text', x: 180, y: 528, anchor: 'center', size: 18, weight: 700, color: '#FFFFFF', text: 'Tap' },
  ], { feedback: undefined });
  ok(!neg.some((f) => f.code === 'V_VECTOR_FIGURE'), 'bars, rings, rows, grids, beads and pips are not figures', neg);
  // a figure-named SVG sprite warns
  const svg = await figs([label, { node: 'image', asset: 'owl', x: 140, y: 300, w: 80, h: 80 }], { assets: { owl: { svg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><circle cx='5' cy='5' r='5'/></svg>", w: 80, h: 80 } } });
  ok(svg.some((f) => f.code === 'V_SVG_FIGURE' && f.severity === 'warn') && !svg.some((f) => f.severity === 'block'), 'an "owl" SVG sprite is V_SVG_FIGURE (warn)', svg);
  // the clean game has none
  ok(!(await figs(clean().presentation.root.children)).length, 'the clean game has no figure findings');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
