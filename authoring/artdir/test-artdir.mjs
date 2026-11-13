// Tests for the art-direction pipeline's pure parts (no engine, no Chrome, no image calls):
//   node authoring/artdir/test-artdir.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as X from '../expander/image-pixels.mjs';
import { paletteFromFrame, extractSwatches, contrast, rgbOf } from './palette.mjs';
import { kitFromFrame } from './kit.mjs';
import { nineSlice, skinRects } from './nine.mjs';
import { nineInsets, sliceCells, cutNine, bakeNine, despill, toTall } from './sheets.mjs';
import { directionErrors, framePrompt, spriteSheetPrompt, uiSheetPrompt, backdropPrompt, gridFor } from './prompts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };

const fill = (w, h, f) => { const img = X.blank(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = f(x, y); img.data.set(c.length === 3 ? [...c, 255] : c, (y * w + x) * 4); } return img; };

test('palette: deterministic, text roles reach their contrast', () => {
  const img = fill(120, 260, (x, y) => (y < 100 ? [20, 12, 55] : y < 180 ? [255, 170, 78] : x < 60 ? [63, 222, 248] : [130, 15, 141]));
  const a = paletteFromFrame(img), b = paletteFromFrame(img);
  assert.deepEqual(a, b);
  assert.equal(a.mode, 'dark');
  for (const g of ['bg', 'surface']) assert.ok(contrast(rgbOf(a.roles.ink), rgbOf(a.roles[g])) >= 7, `ink on ${g}`);
  for (const r of ['primary', 'accent', 'secondary']) assert.ok(contrast(rgbOf(a.roles[`on_${r}`]), rgbOf(a.roles[r])) >= 4.5, `on_${r}`);
  const light = paletteFromFrame(fill(80, 160, (x, y) => (y < 120 ? [253, 239, 228] : [236, 171, 182])));
  assert.equal(light.mode, 'light');
  assert.ok(extractSwatches(img).length >= 4);
});

test('kit: vibe and pairing from the direction, shape from the vibe', () => {
  const k = kitFromFrame({ frame: fill(36, 78, () => [250, 238, 228]), words: 'labubu', gameId: 'x', vibe: 'cute_collectible', pairing: 'soft_box' });
  assert.equal(k.type.vibe, 'cute_collectible');
  assert.equal(k.type.pairing, 'soft_box');
  assert.equal(k.shape.family, 'soft');
  assert.ok(k.calm.hud >= 0);
});

test('nine: nine pieces cover the box exactly at the outer edges', () => {
  const g = nineSlice({ asset: 'ui_panel', x: 10, y: 20, w: 200, h: 120, src: { w: 100, h: 80 }, insets: { l: 20, t: 20, r: 20, b: 20 } });
  assert.equal(g.children.length, 9);
  assert.equal(g.w, undefined, 'no v0.2.2 group box');
  const xs = g.children.map((c) => c.x), ws = g.children.map((c) => c.w);
  assert.equal(Math.min(...xs), 0);
  assert.equal(Math.max(...g.children.map((c, i) => xs[i] + ws[i])), 200);
  assert.deepEqual(g.children.map((c) => c.asset), Array.from({ length: 9 }, (_, k) => `ui_panel_${k}`));
  // A box smaller than two corners shrinks them.
  const small = nineSlice({ asset: 'a', w: 20, h: 20, src: { w: 100, h: 80 }, insets: { l: 20, t: 20, r: 20, b: 20 } });
  assert.equal(small.children[0].w, 10);
  // Expression boxes and crop mode.
  const e = nineSlice({ asset: 'a', w: '= 100 + k', h: 40, src: { w: 60, h: 40 }, insets: { l: 10, t: 10, r: 10, b: 10 }, mode: 'crop' });
  assert.match(String(e.children[1].w), /^= /);
  assert.equal(e.children[4].src_w, 40);
});

test('skinRects: panels and buttons become frames, handlers kept, bound fills stay', () => {
  const tap = { input: 'go', with: {} };
  const game = { presentation: { root: { node: 'group', children: [
    { node: 'rect', x: 20, y: 100, w: 300, h: 200, fill: '$surface', radius: 12 },
    { node: 'rect', x: 40, y: 400, w: 120, h: 48, fill: '$primary', on_tap: tap },
    { node: 'rect', x: 40, y: 500, w: 120, h: 48, fill: '= if a then $x else $y', on_tap: tap },
  ] } } };
  const frames = { panel: { asset: 'ui_panel', src: { w: 100, h: 100 }, insets: { l: 20, t: 20, r: 20, b: 20 } }, button: { asset: 'ui_button', src: { w: 100, h: 40 }, insets: { l: 18, t: 18, r: 18, b: 18 } } };
  const changes = skinRects(game, { frames });
  assert.deepEqual(changes.map((c) => c.piece), ['panel', 'button']);
  const kids = game.presentation.root.children;
  assert.equal(kids[1].node, 'group');
  assert.deepEqual(kids[1].on_tap, tap);
  assert.equal(kids[2].node, 'rect');
});

test('sheets: 9-slice insets, cut and bake', () => {
  // A 100 × 60 frame: transparent outside, an 8 px dark rim, a flat light middle.
  const img = fill(100, 60, (x, y) => (x < 8 || y < 8 || x > 91 || y > 51 ? [90, 30, 60, 255] : [240, 234, 218, 255]));
  const ins = nineInsets(img);
  for (const s of ['l', 'r', 't', 'b']) assert.ok(ins[s] >= 8 && ins[s] <= 16, `${s} ${ins[s]}`);
  const parts = cutNine(img, ins);
  assert.equal(parts.length, 9);
  assert.equal(parts[0].w, ins.l);
  const baked = bakeNine(img, ins, 300, 90);
  assert.equal(baked.w, 300);
  assert.equal(baked.h, 90);
  const mid = (45 * 300 + 150) * 4;
  assert.deepEqual([...baked.data.slice(mid, mid + 3)], [240, 234, 218]);
});

test('sheets: grid slicing with alpha trim, and region fallback joins specks', () => {
  const sheet = fill(200, 100, (x, y) => ((x % 100 > 30 && x % 100 < 70 && y > 30 && y < 70) ? [200, 50, 50, 255] : [0, 0, 0, 0]));
  const s = sliceCells(sheet, 2, 2, 1);
  assert.equal(s.method, 'grid');
  assert.equal(s.sprites[0].w, 39);
  // Subjects off the grid: read as regions; a sparkle above one joins it.
  const off = fill(200, 100, (x, y) => (((x > 80 && x < 120 && y > 40 && y < 80) || (x > 150 && x < 190 && y > 40 && y < 80) || (x > 95 && x < 105 && y > 25 && y < 35)) ? [200, 50, 50, 255] : [0, 0, 0, 0]));
  const r = sliceCells(off, 2, 2, 1);
  assert.equal(r.method, 'regions');
  assert.ok(r.sprites[0].h >= 50, 'the sparkle joined its subject');
});

test('sheets: despill and the tall crop', () => {
  const img = fill(4, 4, () => [230, 200, 240, 200]);
  const d = despill(img, 'magenta', { hard: true });
  assert.ok(d.data[0] <= 230 && d.data[2] < 240);
  const t = toTall(fill(100, 100, () => [1, 2, 3]), 1);
  assert.deepEqual([t.w, t.h], [360, 780]);
});

test('prompts: the gold directions are valid and every prompt says no text', () => {
  for (const k of ['s3', 'fog', 'k20']) {
    const d = JSON.parse(readFileSync(join(HERE, 'gold', `${k}.direction.json`), 'utf8'));
    assert.deepEqual(directionErrors(d), [], k);
    const ps = [framePrompt(d), ...(d.presentationOnly ? [] : [backdropPrompt(d), backdropPrompt(d, { edit: false })]), ...(d.sprites ? [spriteSheetPrompt(d)] : []), ...(d.ui ? [uiSheetPrompt(d)] : [])];
    for (const p of ps) assert.match(p, /No letters, no numbers, no words/);
  }
  assert.deepEqual(gridFor(12), { cols: 4, rows: 3 });
  assert.deepEqual(gridFor(4), { cols: 2, rows: 2 });
  assert.ok(directionErrors({ title: 'x' }).length > 0);
  assert.ok(directionErrors({ title: 'x', style: 's', frame: { scene: 'a', focal: 'b' }, presentationOnly: true, ui: { material: 'm' } }).some((e) => /presentationOnly/.test(e)));
});

console.log(`${n} tests passed`);
