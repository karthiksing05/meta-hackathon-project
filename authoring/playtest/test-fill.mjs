#!/usr/bin/env node
// Tests for the fill check (playtest/fill-check.mjs) and tall canvases (expander/canvas.mjs, the expander's
// look.canvas). Plain Node, no packages, no Muse; the engine part runs when MG_ENGINE_DIR has a build.
//   node authoring/playtest/test-fill.mjs   (exit 1 on any failure)

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as F from './fill-check.mjs';
import * as C from '../expander/canvas.mjs';
import { expand, loadLibrary } from '../expander/expand.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL ${name}${detail !== undefined ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}
const codes = (list) => list.map((f) => f.code);

// ---------- canvas.mjs ----------
ok(!C.isTall({ w: 360, h: 640 }) && C.isTall({ w: 360, h: 780 }), 'isTall');
ok(JSON.stringify(C.safeArea({ w: 360, h: 780 })) === '{"y0":110,"y1":684}', 'safe area 780', C.safeArea({ w: 360, h: 780 }));
ok(JSON.stringify(C.safeArea({ w: 360, h: 640 })) === '{"y0":0,"y1":640}', 'safe area 640');
ok(C.pickCanvas('tall').h === 780 && C.pickCanvas(undefined).h === 640 && C.pickCanvas({ w: 400, h: 780 }).h === 640, 'pickCanvas');
{
  const layout = { node: 'group', children: [
    { node: 'group', x: 0, y: 0, children: [{ slot: 'playfield' }] },
    { node: 'stack', x: 180, y: 48, children: [{ slot: 'hud_top' }] },
    { node: 'stack', x: 180, y: 608, children: [{ slot: 'hud_bottom' }] },
  ] };
  const t = C.fitLayout(layout, { w: 360, h: 780 });
  ok(t.children[1].y === 134 && t.children[2].y === 652 && t.children[0].y === 0, 'fitLayout moves HUD stacks', t.children.map((c) => c.y));
  ok(C.fitLayout(layout, { w: 360, h: 640 }) === layout && layout.children[1].y === 48, 'fitLayout leaves 640 alone');
}

// ---------- the expander's look.canvas ----------
{
  const lib = loadLibrary(root);
  const base = {
    authoring: 'microgame-authoring/0.1', meta: { title: 'Tap test', instructions: 'Tap the dot.', duration_s: 20 },
    look: { id: 'paper' },
    state: { score: { type: 'int', init: '0' } },
    inputs: { tap: { from: [{ pointer: 'down' }] } },
    rules: [{ id: 'tap', on: 'tap', do: [{ incr: 'score' }] }],
    objectives: { score: 'score', time_limit: '20s' },
    presentation: { slots: [{ slot: 'hud_top', node: { node: 'text', text: "= 'Score: ' + str(score)", size: 18 } }] },
  };
  const legacy = expand(base, lib);
  const tall = expand({ ...base, look: { id: 'paper', canvas: 'tall' } }, lib);
  const g0 = legacy.game ?? legacy.out, g1 = tall.game ?? tall.out;
  ok(g0?.presentation?.canvas?.h === 640, 'expander default stays 640', g0?.presentation?.canvas);
  ok(g1?.presentation?.canvas?.h === 780, 'look.canvas tall gives 780', g1?.presentation?.canvas);
  const hudY = (g) => g?.presentation?.root?.children?.find((c) => c.children?.some((k) => k.node === 'text'))?.y;
  ok(hudY(g1) >= 110 && hudY(g1) <= 150 && hudY(g0) < 60, 'tall HUD stack in the HUD band', [hudY(g0), hudY(g1)]);
}

// ---------- static checks ----------
const game = (h, kids, bg = '#101010') => ({ format: 'microgame/0.2', meta: { title: 't' }, presentation: { canvas: { w: 360, h, background: bg }, root: { node: 'group', children: kids } } });
ok(codes(F.checkFillStatic(game(640, []))).includes('F_ASPECT'), 'F_ASPECT on 640');
ok(!codes(F.checkFillStatic(game(780, []))).includes('F_ASPECT'), 'no F_ASPECT on 780');
ok(codes(F.checkFillStatic(game(780, [{ node: 'image', asset: 'backdrop', x: 0, y: 0, w: 360, h: 640 }]))).includes('F_BACKDROP_SHORT'), 'F_BACKDROP_SHORT');
ok(!codes(F.checkFillStatic(game(780, [{ node: 'image', asset: 'backdrop', x: 0, y: 0, w: 360, h: 780 }]))).length, 'full backdrop passes');
ok(codes(F.checkFillStatic({ manifest: null, game: game(640, []) })).includes('F_ASPECT'), 'readGame {game}');

// ---------- frame checks ----------
const op = (o) => ({ rotation: 0, scale: 1, opacity: 1, ...o });
const text = (t, y, x = 120) => op({ op: 'text', text: t, x, y: y - 10, w: 120, h: 20, size: 16 });
const frame = (h, ops, bg = '#00000000') => ({ width: 360, height: h, background: bg, ops });
const backdrop = (h) => op({ op: 'image', asset: 0, x: 0, y: 0, w: 360, h });
const manifestHud = (on) => ({ concepts: [{ use: 'space.microgame', ...(on ? { params: { runtime_hud: true } } : {}) }] });
{
  const good = [backdrop(780), text('Score: 3', 134), text('Lives 3', 134, 240)];
  ok(F.checkFillFrames([frame(780, good), frame(780, good)], { manifest: manifestHud(false) }).length === 0, 'clean tall game passes',
    F.checkFillFrames([frame(780, good)], { manifest: manifestHud(false) }));
}
{
  const r = F.checkFillFrames([frame(780, [op({ op: 'rect', x: 0, y: 70, w: 360, h: 640, fill: '#202020ff' })])]);
  ok(codes(r).includes('F_BG_GAP') && r[0].coverage < 0.9, 'F_BG_GAP when the background stops short', r);
  ok(!codes(F.checkFillFrames([frame(780, [], '#202020')])).includes('F_BG_GAP'), 'opaque canvas background covers');
  ok(codes(F.checkFillFrames([frame(780, [op({ op: 'rect', x: 0, y: 0, w: 360, h: 780, fill: '#20202080' })])])).includes('F_BG_GAP'), 'translucent rect does not cover');
}
{
  const r = F.checkFillFrames([frame(780, [backdrop(780), text('Score: 3', 400)])], { manifest: manifestHud(false) });
  ok(codes(r).includes('F_HUD_OUT_OF_BAND'), 'F_HUD_OUT_OF_BAND for a score mid-screen', r);
  const r2 = F.checkFillFrames([frame(780, [backdrop(780), text('Score: 3', 50)])], { manifest: manifestHud(false) });
  ok(codes(r2).includes('F_KEY_IN_BLEED'), 'F_KEY_IN_BLEED for a score under the top bar', r2);
  const r3 = F.checkFillFrames([frame(780, [backdrop(780), text('Score: 3', 134)])], { manifest: manifestHud(false), targets: [{ x: 100, y: 720, w: 160, h: 50 }, { x: 0, y: 0, w: 360, h: 780 }] });
  ok(codes(r3).filter((c) => c === 'F_KEY_IN_BLEED').length === 1, 'F_KEY_IN_BLEED for a tap target in the bottom band only', r3);
}
{
  const ops = [backdrop(640), text('Score: 3', 48)];
  ok(codes(F.checkFillFrames([frame(640, ops)], { manifest: manifestHud(true) })).includes('F_DOUBLE_HUD'), 'F_DOUBLE_HUD');
  ok(!codes(F.checkFillFrames([frame(640, ops)], { manifest: manifestHud(false) })).includes('F_DOUBLE_HUD'), 'no F_DOUBLE_HUD with the runtime HUD off');
  ok(codes(F.checkFillFrames([frame(640, [backdrop(640)])], { manifest: manifestHud(false) })).includes('F_SCORE_HIDDEN'), 'F_SCORE_HIDDEN');
  ok(!codes(F.checkFillFrames([frame(640, [backdrop(640)])], { manifest: manifestHud(true) })).includes('F_SCORE_HIDDEN'), 'runtime HUD shows the score');
}
{
  // A banner that shows in one frame of five isn't a HUD.
  const fr = (extra) => frame(640, [backdrop(640), text('Score: 1', 48), ...extra]);
  const r = F.checkFillFrames([fr([text('Wave 2 incoming', 300)]), fr([]), fr([]), fr([]), fr([])], { manifest: manifestHud(false) });
  ok(!codes(r).includes('F_HUD_OUT_OF_BAND'), 'transient banners are not HUD', r);
}

// ---------- with the engine ----------
let engine = null;
try { engine = (await (await import('../expander/engine.mjs')).loadEngine()).engine; } catch { /* no build */ }
if (engine) {
  const lib = loadLibrary(root);
  const m = {
    authoring: 'microgame-authoring/0.1', meta: { title: 'Tap test', instructions: 'Tap anywhere.', duration_s: 5 },
    look: { id: 'paper', canvas: 'tall' },
    state: { score: { type: 'int', init: '0' } },
    inputs: { tap: { from: [{ pointer: 'down' }] } },
    rules: [{ id: 'tap', on: 'tap', do: [{ incr: 'score' }] }],
    objectives: { score: 'score', time_limit: '5s' },
    presentation: { slots: [
      { slot: 'playfield', node: { node: 'rect', x: 0, y: 0, w: 360, h: 780, fill: '$bg' } },
      { slot: 'hud_top', node: { node: 'text', text: "= 'Score: ' + str(score)", size: 18 } },
    ] },
  };
  const ex = expand(m, lib);
  const g = ex.game ?? ex.out;
  const errs = (ex.diagnostics ?? ex.diags ?? []).filter((d) => d.severity === 'error');
  ok(g && !errs.length, 'tall test game expands', errs);
  if (g && !errs.length) {
    const r = await F.fillCheck({ game: g, manifest: { concepts: [{ use: 'space.microgame' }] } }, { engine });
    ok(r.ok && r.findings.length === 0, 'tall test game passes the fill check in the engine', r.findings);
  }
} else console.log('  (engine not found: engine checks skipped; set MG_ENGINE_DIR)');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
