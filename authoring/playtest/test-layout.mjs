// Tests for the layout lint, the code fixes and the critique loop's plumbing (no Muse).
// Needs a built engine (MG_ENGINE_DIR). Chrome is optional: the pixel checks run when it's installed.
//   node authoring/playtest/test-layout.mjs

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../expander/engine.mjs';
import { expand, loadLibrary } from '../expander/expand.mjs';
import { layoutCheck, lintSample, sampleFrames, instrument, textInk, contrast, parseColor } from './layout-check.mjs';
import { fixLayout, fitText, spaceTargets } from '../expander/layout-fix.mjs';
import { applyLayoutOps, parseJudge, critiqueLoop, CHECKLIST } from './visual-critique.mjs';
import { chromeAvailable } from './frame-render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
const ok = (cond, name, extra) => { if (cond) passed++; else { failed++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const codes = (fs) => fs.map((f) => f.code);

/** A small game with every problem: a long label on a small tile, a corner-anchored cell label,
 *  text over text, a light label on a light tile, buttons too close, and a block falling through the HUD. */
function badGame() {
  return {
    format: 'microgame/0.2',
    meta: { title: 'Bad layout', instructions: 'Tap.', duration_s: 30 },
    state: { y: { type: 'float', init: '0' }, taps: { type: 'int', init: '0' } },
    inputs: { tap: { payload: {} }, tap_cell: { payload: { cell: 'ivec2' } } },
    rules: [
      { id: 'fall', on: 'tick', do: [{ set: 'y', to: 'if y > 600 then 0.0 else y + 1.0' }] },
      { id: 't', on: 'tap', do: [{ incr: 'taps' }] },
      { id: 'c', on: 'tap_cell', do: [{ incr: 'taps' }] },
    ],
    objectives: { score: 'taps', time_limit: '30s', on_timeout: 'lose' },
    presentation: {
      canvas: { w: 360, h: 640, background: '$bg' },
      tokens: { bg: '#F4F1EA', ink: '#1A1A1A', surface: '#FFFFFF', accent: '#F2C94C' },
      root: {
        node: 'group',
        children: [
          { node: 'text', x: 180, y: 30, anchor: 'center', size: 18, weight: 700, color: '$ink', text: "= 'Score: ' + str(taps)" },
          { node: 'image', asset: 'block', x: 150, y: '= y', w: 60, h: 60 },
          { node: 'group', x: 40, y: 200, children: [
            { node: 'rect', w: 70, h: 70, radius: 10, fill: '$surface', on_tap: { input: 'tap' } },
            { node: 'text', x: 35, y: 35, anchor: 'center', size: 24, weight: 700, color: '$ink', text: 'Watermelon' },
          ] },
          { node: 'grid', cols: 3, rows: 1, cell_size: 60, gap: 2, x: 120, y: 320, cell: { node: 'group', children: [
            { node: 'rect', w: 60, h: 60, radius: 8, fill: '$accent', on_tap: { input: 'tap_cell', with: { cell: 'cell' } } },
            { node: 'text', x: 60, y: 60, anchor: 'center', size: 20, weight: 700, color: '#FFF6D0', text: "= 'K' + str(cell.x)" },
          ] } },
          { node: 'text', x: 180, y: 470, anchor: 'center', size: 16, weight: 700, color: '$ink', text: 'Overlapping words here' },
          { node: 'text', x: 190, y: 474, anchor: 'center', size: 16, weight: 700, color: '$ink', text: 'Second line on top' },
          { node: 'text', x: 6, y: 560, size: 8, color: '$ink', text: 'tiny print' },
        ],
      },
    },
    assets: { block: { svg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'><rect width='60' height='60' fill='#C0392B'/></svg>", w: 60, h: 60 } },
  };
}

const { engine } = await loadEngine();
const pixels = chromeAvailable();

// --- instrumentation round-trips and the game still validates
{
  const g = badGame();
  const { game, nodes } = instrument(g);
  ok(nodes.filter(Boolean).length >= 8, 'instrument tags every drawable node', nodes.length);
  let loaded = true;
  try { engine.load(JSON.stringify(game), 1).dispose(); } catch (e) { loaded = String(e.message); }
  ok(loaded === true, 'the instrumented game loads', loaded);
  const sample = await sampleFrames(g, { seeds: [1], maxSeconds: 6, engine });
  ok(sample.tagged, 'ops map back to nodes');
  ok(sample.frames.some((f) => f.label === 'intro') && sample.frames.some((f) => f.label === 'end') && sample.frames.some((f) => f.label === 'mid'), 'intro, mid and end frames', sample.frames.map((f) => f.key));
  const fs = lintSample(sample);
  const c = codes(fs);
  ok(c.includes('L_TEXT_OVERFLOW') && fs.find((f) => f.code === 'L_TEXT_OVERFLOW').node === '/presentation/root/children/2/children/1', 'overflowing tile label found, with its node', fs.filter((f) => f.code === 'L_TEXT_OVERFLOW'));
  ok(c.includes('L_TEXT_OFFCENTER'), 'corner-anchored cell label found');
  ok(c.includes('L_OVERLAP_TEXT'), 'text over text found');
  ok(c.includes('L_TEXT_SMALL'), 'tiny text found');
  ok(c.includes('L_TARGET_GAP'), 'buttons 2 units apart found');
  ok(c.includes('L_OVERLAP_HUD') && fs.find((f) => f.code === 'L_OVERLAP_HUD').node === '/presentation/root/children/1', 'the falling block crosses the HUD', fs.filter((f) => f.code === 'L_OVERLAP_HUD'));
  ok(c.includes('L_LOW_CONTRAST'), 'light label on the yellow tile found (shape sampling)', fs.filter((f) => f.code === 'L_LOW_CONTRAST'));
  ok(fs.every((f) => f.hint && f.frame && f.role), 'every finding has a hint, a frame and a role');
}

// --- geometry and color helpers
{
  const ink = textInk({ x: 0, y: 0, w: 100, h: 20, text: 'abcd', size: 10, weight: 400, align: 'center', valign: 'middle', line_height: 12.5, scale: 1 });
  ok(Math.abs(ink.x1 - ink.x0 - 24) < 1e-9 && Math.abs((ink.x0 + ink.x1) / 2 - 50) < 1e-9, 'text ink box is centered and 0.6 em per char', ink);
  ok(Math.abs(contrast([0, 0, 0], [255, 255, 255]) - 21) < 0.01, 'black on white is 21:1');
  ok(parseColor('#FF000080')[3] > 0.49 && parseColor('#abc')[0] === 0xaa, 'colors parse with alpha and short form');
}

// --- static fixes on the tree
{
  const g = badGame();
  const fits = fitText(g);
  const label = g.presentation.root.children[2].children[1];
  ok(fits.some((f) => f.kind === 'fit') && label.size < 24, 'the long tile label shrinks', label);
  const cell = g.presentation.root.children[3].cell.children[1];
  ok(cell.x === 30 && cell.y === 30, 'the corner-anchored cell label is centered', cell);
  const gaps = spaceTargets(g);
  ok(gaps.length === 1 && g.presentation.root.children[3].gap === 4, 'the grid gets a 4-unit gap', gaps);
}

// --- the full pass: fewer findings, still valid, rules untouched
{
  const g = badGame();
  const before = await layoutCheck(g, { seeds: [1], maxSeconds: 6, engine, pixels });
  const { game, fixes, dropped } = await fixLayout(g, { engine, pixels });
  const after = await layoutCheck(game, { seeds: [1], maxSeconds: 6, engine, pixels });
  ok(dropped.length === 0, 'no fix broke the game', dropped);
  ok(JSON.stringify(game.rules) === JSON.stringify(g.rules) && JSON.stringify(game.state) === JSON.stringify(g.state), 'rules and state untouched');
  ok(after.counts.errors < before.counts.errors, 'fewer layout errors after the pass', { before: before.counts, after: after.counts, fixes });
  const ac = codes(after.findings);
  for (const code of ['L_TEXT_OVERFLOW', 'L_TEXT_OFFCENTER', 'L_OVERLAP_HUD', 'L_LOW_CONTRAST']) ok(!ac.includes(code), `${code} fixed`, after.findings.filter((f) => f.code === code));
  ok(fixes.some((f) => f.kind === 'hud_panel'), 'the HUD moved onto a panel', fixes);
  // Replays still verify: same seed and inputs give the same state as the original game.
  const run = (src) => { const h = engine.load(JSON.stringify(src), 7); for (let i = 0; i < 120; i++) { h.step(1000 / 60); if (i === 30) { h.frame(); h.pointer('down', 75, 235); h.pointer('up', 75, 235); } } const s = h.stateHash(); h.dispose(); return s; };
  ok(run(g) === run(game), 'same seed and inputs give the same state hash after the fixes');
}

// --- grid_board: long labels fit their cells
{
  const lib = loadLibrary(join(here, '..'));
  const m = {
    authoring: 'microgame-authoring/0.1', meta: { title: 'G', instructions: 'x', duration_s: 60 },
    state: { n: { type: 'int', init: '0' } },
    uses: [{ fragment: 'grid_board', params: { cols: 4, rows: 4, cell_size: 70, gap: 6, x: 31, y: 248 } }],
    functions: { cell_fill: { params: { c: 'ivec2' }, returns: 'string', body: "''" }, cell_label: { params: { c: 'ivec2' }, returns: 'string', body: "if c.x == 0 then 'Triangle' else if c.x == 1 then 'Mississippi River' else 'Owl'" } },
    objectives: { time_limit: '60s', on_timeout: 'lose' }, look: { id: 'paper' },
  };
  const r = expand(m, lib);
  ok(r.diagnostics.filter((d) => d.severity !== 'warning').length === 0, 'grid_board expands', r.diagnostics);
  const res = await layoutCheck(r.game, { seeds: [1], maxSeconds: 4, engine, pixels });
  const bad = res.findings.filter((f) => ['L_TEXT_OVERFLOW', 'L_TEXT_OFFCENTER', 'L_TEXT_CLIPPED', 'L_OVERLAP_TEXT'].includes(f.code));
  ok(bad.length === 0, 'grid_board labels stay inside their cells', bad);
}

// --- critique plumbing
{
  const g = badGame();
  const { game, applied, refused } = applyLayoutOps(g, [
    { op: 'set', path: '/presentation/root/children/0/size', value: 14 },
    { op: 'set', path: '/rules/0/do/0/to', value: '0' },
    { op: 'set', path: '/presentation/root/children/0/text', value: 'hacked' },
    { op: 'insert', path: '/presentation/root/children/1', value: { node: 'rect', x: 0, y: 0, w: 360, h: 60, fill: '#000000' } },
    { op: 'insert', path: '/presentation/root/children/1', value: { node: 'text', text: 'no' } },
  ]);
  ok(applied.length === 2 && refused.length === 3, 'repairs may only change layout props and insert plain rects', { applied, refused });
  ok(game.presentation.root.children[0].size === 14 && game.rules[0].do[0].to === g.rules[0].do[0].to, 'rules untouched by a repair');
  const j = parseJudge('noise {"checks":[{"id":"V_OVERLAP","pass":false,"severity":"major","where":"intro","issue":"x","fix":"y"},{"id":"V_BOGUS","pass":true}],"overall":4} tail');
  ok(j.checks.length === 1 && j.overall === 4, 'judge output parses and unknown checks drop', j);
  ok(CHECKLIST.some((c) => c.id === 'V_CONSISTENT'), 'the checklist covers consistency across frames');
  if (pixels) {
    let calls = 0;
    const judge = async () => {
      calls++;
      const pass = calls > 1;
      return JSON.stringify({ checks: CHECKLIST.map((c) => ({ id: c.id, pass: pass || c.id !== 'V_LEGIBLE', severity: 'major', where: 'intro', issue: pass ? '' : 'tiny print', fix: 'bigger' })), overall: pass ? 8 : 5 });
    };
    const repair = async () => JSON.stringify({ ops: [{ op: 'set', path: '/presentation/root/children/6/size', value: 13 }] });
    const out = await critiqueLoop(g, { judge, repair, engine });
    ok(out.rounds.length === 1 && out.rounds[0].kept && out.game.presentation.root.children[6].size === 13, 'one repair round, kept when the judge and the lint improve', out.rounds.map((r) => ({ kept: r.kept, applied: r.applied, refused: r.refused })));
    ok(out.pngs.length === 3, 'three frames rendered for the judge');
  }
}

console.log(`layout tests: ${passed} passed, ${failed} failed${pixels ? '' : ' (no Chrome: pixel checks skipped)'}`);
process.exit(failed ? 1 : 0);
