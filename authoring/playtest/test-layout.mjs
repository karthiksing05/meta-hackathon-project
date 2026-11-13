// Tests for the layout lint, the code fixes and the critique loop's plumbing (no Muse).
// Needs a built engine (MG_ENGINE_DIR). Chrome is optional: the pixel checks run when it's installed.
//   node authoring/playtest/test-layout.mjs

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../expander/engine.mjs';
import { expand, loadLibrary } from '../expander/expand.mjs';
import { layoutCheck, lintSample, sampleFrames, instrument, textInk, contrast, parseColor, moved, inHudBand } from './layout-check.mjs';
import { fixLayout, fitText, spaceTargets, plateLabels, rowsToColumns, hudToTop, nudgeIntoSafe } from '../expander/layout-fix.mjs';
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

// Structural fixes from node geometry (synthetic geometry: no engine needed).
{
  ok(!moved({ x0: 100, y0: 10, x1: 200, y1: 30 }, { x0: 80, y0: 10, x1: 220, y1: 30 }), 'a centered label that grows is not motion');
  ok(moved({ x0: 100, y0: 10, x1: 200, y1: 30 }, { x0: 100, y0: 40, x1: 200, y1: 60 }), 'a box that goes down is motion');
  ok(inHudBand(150, 360, 780) && !inHudBand(400, 360, 780) && inHudBand(100, 360, 640), 'HUD bands: two rows under the bar on a tall canvas');
  const geo = (list) => new Map(list.map(([p, g]) => [p, { frames: 10, of: 10, hud: false, inBand: false, interactive: false, moving: false, ...g }]));
  const tokens = { bg: '#0A0F24', ink: '#FFFFFF', accent: '#FFD23F', surface: '#151C3A', primary: '#00E5FF' };
  // A popup in a repeat and a still label that a falling sprite crosses get plates and draw last.
  const g1 = { presentation: { canvas: { w: 360, h: 640 }, tokens, root: { node: 'group', children: [
    { node: 'repeat', source: 'pops', as: 'p', template: { node: 'text', text: '= p.text', x: '= p.x', y: '= p.y', anchor: 'center', size: 14, color: '$accent', opacity: '= 1.0 - (now - p.born) / 700.0' } },
    { node: 'text', text: 'LANDING LINE', x: 180, y: 590, anchor: 'center', size: 12, color: '$ink' },
    { node: 'repeat', source: 'drops', as: 'd', template: { node: 'image', asset: 'drop', x: '= d.x', y: '= d.y', w: 18, h: 22 } },
  ] } } };
  const fx1 = plateLabels(g1, geo([
    ['/presentation/root/children/0/template', { kind: 'text', moving: true, box: { x0: 40, y0: 100, x1: 300, y1: 400 } }],
    ['/presentation/root/children/1', { kind: 'text', box: { x0: 140, y0: 584, x1: 220, y1: 596 } }],
    ['/presentation/root/children/2/template', { kind: 'image', moving: true, box: { x0: 20, y0: 0, x1: 340, y1: 640 } }],
  ]));
  const kids = g1.presentation.root.children;
  ok(fx1.length === 2 && kids[0].node === 'repeat' && kids[0].source === 'drops', 'plated nodes draw after the sprites', fx1);
  const popup = kids.find((k) => k.source === 'pops')?.template;
  ok(popup?.node === 'group' && popup.children[0].node === 'rect' && popup.children[0].fill === '$bg' && /then 1.0 else 0.0/.test(popup.children[1].opacity), 'a popup becomes a badge that snaps out instead of fading over sprites', popup);
  const still = kids.find((k) => k.node === 'group');
  ok(still && still.children[0].opacity === 0.92 && still.children[1].text === 'LANDING LINE', 'a crossed still label sits on a plate', still);
  // A text written on its own tile is left alone.
  const g2 = { presentation: { canvas: { w: 360, h: 640 }, tokens, root: { node: 'group', children: [{ node: 'repeat', source: 'cards', as: 'c', template: { node: 'group', children: [{ node: 'rect', x: '= c.x', y: 0, w: 60, h: 40 }, { node: 'text', text: '= c.name', x: '= c.x + 30', y: 20, anchor: 'center' }] } }] } } };
  const fx2 = plateLabels(g2, geo([
    ['/presentation/root/children/0/template/children/0', { kind: 'rect', moving: true, box: { x0: 0, y0: 0, x1: 70, y1: 40 } }],
    ['/presentation/root/children/0/template/children/1', { kind: 'text', moving: true, box: { x0: 10, y0: 14, x1: 50, y1: 26 } }],
  ]));
  ok(fx2.length === 0, 'a label on its own piece stays', fx2);
  // A row of texts past the edges stacks as a column; a bottom HUD row the player crosses moves up.
  const g3 = { presentation: { canvas: { w: 360, h: 640 }, tokens, root: { node: 'group', children: [
    { node: 'stack', dir: 'row', gap: 28, x: 180, y: 48, anchor: 'center', children: [{ node: 'text', text: 'Score: 0' }] },
    { node: 'stack', dir: 'row', gap: 28, x: 180, y: 608, anchor: 'center', children: [{ node: 'text', text: 'Bombs: 2 and a long hint' }, { node: 'text', text: 'Another long line here' }] },
    { node: 'image', asset: 'ship', x: '= px', y: 600, w: 40, h: 30 },
  ] } } };
  const rows = rowsToColumns(g3, geo([
    ['/presentation/root/children/1/children/0', { kind: 'text', box: { x0: -20, y0: 600, x1: 170, y1: 616 } }],
    ['/presentation/root/children/1/children/1', { kind: 'text', box: { x0: 198, y0: 600, x1: 380, y1: 616 } }],
  ]));
  ok(rows.length === 1 && g3.presentation.root.children[1].dir === 'column', 'an overflowing row becomes a column', rows);
  const top = hudToTop(g3, geo([
    ['/presentation/root/children/0/children/0', { kind: 'text', hud: true, inBand: true, box: { x0: 140, y0: 40, x1: 220, y1: 56 } }],
    ['/presentation/root/children/1/children/0', { kind: 'text', hud: true, inBand: true, box: { x0: 100, y0: 590, x1: 260, y1: 606 } }],
    ['/presentation/root/children/1/children/1', { kind: 'text', hud: true, inBand: true, box: { x0: 100, y0: 610, x1: 260, y1: 626 } }],
    ['/presentation/root/children/2', { kind: 'image', moving: true, box: { x0: 0, y0: 585, x1: 360, y1: 615 } }],
  ]));
  ok(top.length === 1 && g3.presentation.root.children[1].y === 608 - (590 - 64), 'the crossed bottom HUD row moves under the top HUD', { top, y: g3.presentation.root.children[1].y });
  // On a tall canvas, a still title under the phone's bar moves into the safe area.
  const g4 = { presentation: { canvas: { w: 360, h: 780 }, tokens, root: { node: 'group', children: [{ node: 'group', x: 0, y: 70, children: [{ node: 'text', text: 'Title', x: 180, y: 34, anchor: 'center', size: 20 }] }] } } };
  const safe = nudgeIntoSafe(g4, geo([['/presentation/root/children/0/children/0', { kind: 'text', box: { x0: 150, y0: 92, x1: 210, y1: 116 } }]]));
  ok(safe.length === 1 && g4.presentation.root.children[0].children[0].y === 34 + 12, 'bleed text nudged into the safe area', { safe, y: g4.presentation.root.children[0].children[0].y });
}

console.log(`layout tests: ${passed} passed, ${failed} failed${pixels ? '' : ' (no Chrome: pixel checks skipped)'}`);
process.exit(failed ? 1 : 0);
