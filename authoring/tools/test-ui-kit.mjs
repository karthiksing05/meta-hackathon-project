#!/usr/bin/env node
// Tests for the game UI kit (authoring/UI_KIT.md): tokens, text fitting, components, the layout
// pass and the style check. Pure checks always run; engine checks run when MG_ENGINE_DIR (or a
// built engine/) is available.
//   node authoring/tools/test-ui-kit.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveStyle, styleTokens, THEME_NAMES, FAMILIES, DENSITIES, contrast, TYPE_SIZES, MIN_TEXT, INK_ROLES, ON_ROLES } from '../expander/ui-style.mjs';
import { wrapLines, fitStatic, fitDynamic, fitTextNode, lineHeight, WIDTH_SAFETY } from '../expander/ui-text.mjs';
import { COMPONENTS } from '../expander/ui-kit.mjs';
import { styleCheck, styleFix, styleVerifier } from '../expander/style-check.mjs';
import { applyUiKit } from '../expander/ui-kit.mjs';
import { bands, CANVAS } from '../expander/ui-style.mjs';
import { expand, loadLibrary } from '../expander/expand.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = loadLibrary(root);
let failed = 0, passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log('FAIL', msg); } };

// ---- tokens: every theme × base × family passes AA ----
const bases = ['#E4572E', '#00E5FF', '#3A6EA5', '#FFD23F', '#7A5CFF', '#2E9E44', '#111111', '#FFFFFF', '#FF6FAE'];
for (const theme of THEME_NAMES) for (const base of bases) for (const family of Object.keys(FAMILIES)) {
  const s = deriveStyle({ theme, base, family });
  const c = s.colors;
  ok(contrast(c.ink, c.bg) >= 7, `${theme} ${base}: ink on bg ${contrast(c.ink, c.bg).toFixed(2)}`);
  ok(contrast(c.ink, c.surface) >= 4.5 && contrast(c.ink, c.surface_2) >= 4.5, `${theme} ${base}: ink on surfaces`);
  ok(contrast(c.ink_muted, c.surface) >= 4.5, `${theme} ${base}: ink_muted on surface`);
  for (const r of INK_ROLES) ok(contrast(c[`${r}_ink`], c.bg) >= 4.5 && contrast(c[`${r}_ink`], c.surface) >= 4.5, `${theme} ${base}: ${r}_ink`);
  for (const r of ON_ROLES) ok(contrast(s.on[r], c[r]) >= 4.5, `${theme} ${base}: on_${r} ${contrast(s.on[r], c[r]).toFixed(2)}`);
  for (const r of INK_ROLES) ok(contrast(c[r], c.bg) >= 3, `${theme} ${base}: ${r} on bg`);
}
// Adopted palettes (old games) pass too, and the derivation is deterministic.
const muse = { bg: '#0A1233', surface: '#1B2A66', primary: '#00E5FF', secondary: '#FF6FAE', accent: '#FFD23F', ink: '#FFFFFF', danger: '#FF4D5E' };
const bad = { bg: '#F4F1EA', surface: '#FFFFFF', ink: '#F0F0F0', primary: '#FFE08A', accent: '#FFF2B0', danger: '#FFB0B0', secondary: '#E0E0E0' };
for (const p of [muse, bad]) {
  const s = deriveStyle({ palette: p });
  ok(contrast(s.colors.ink, s.colors.bg) >= 7 && contrast(s.colors.ink, s.colors.surface) >= 4.5, `adopted palette ink ${JSON.stringify(p)}`);
  ok(JSON.stringify(s) === JSON.stringify(deriveStyle({ palette: p })), 'deriveStyle is deterministic');
}
ok(Object.keys(styleTokens(deriveStyle({}))).every((k) => /^[a-z][a-z0-9_]*$/.test(k)), 'token names are engine identifiers');
ok(deriveStyle({ theme: 'nope' }).notes.some((n) => n.code === 'S_UI_KNOB'), 'unknown knob is noted');
ok(Object.values(DENSITIES).every((d) => d.control >= 44), 'controls are at least 44 tall');

// ---- text fitting ----
ok(JSON.stringify(wrapLines('the quick brown fox jumps', 60, 10, 400)) === JSON.stringify(['the quick', 'brown fox', 'jumps']), 'wrap matches the engine');
ok(JSON.stringify(wrapLines('  a  b\n\nccc', 60, 10, 400)) === JSON.stringify(['  a  b', '', 'ccc']), 'wrap keeps indentation and blank lines');
const texts = ['Hi', 'What shuts down a Mewing streak?', 'Tongue on the roof of your mouth', 'Supercalifragilisticexpialidocious', 'A '.repeat(80), 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore'];
for (const t of texts) for (const [w, h] of [[312, 52], [152, 64], [96, 20], [336, 84]]) for (const size of TYPE_SIZES) {
  const f = fitStatic(t, { w, h, size, weight: 700 });
  const lines = wrapLines(f.text, w * WIDTH_SAFETY, f.size, 700);
  ok(f.size >= MIN_TEXT && TYPE_SIZES.includes(f.size), `fit size on scale: ${f.size}`);
  ok(lines.length * lineHeight(f.size) <= h + 0.01 || lines.length === 1, `fit "${t.slice(0, 12)}" ${w}x${h}@${size}: ${lines.length} lines at ${f.size}`);
}
ok(fitStatic('Short', { w: 300, h: 60, size: 22 }).size === 22, 'short text keeps its step');
ok(fitStatic('Tongue on the roof of your mouth', { w: 300, h: 52, size: 17, weight: 600, prefer: 'line' }).lines === 1, 'labels shrink before wrapping');
const dyn = fitDynamic("get_or(opts, k, '')", { w: 300, h: 52, size: 17, weight: 600 });
ok(dyn.size.startsWith('= if len(') && dyn.text.includes("substr(") && dyn.text.includes('…'), 'run-time fit writes size and cut expressions');
const tn = fitTextNode('= question_text()', { x: 0, y: 0, w: 312, h: 84 }, { step: 'title' });
ok(tn.wrap === true && tn.w <= 312 && tn.h === 84, 'fitTextNode boxes the text');

// ---- style check: crafted manifest ----
const messy = {
  authoring: 'microgame-authoring/0.1', meta: { title: 'Messy', instructions: 'Tap.', duration_s: 30 },
  uses: [{ fragment: 'score', params: { points: 1 } }],
  inputs: { go: { payload: {} } }, rules: [{ id: 'r', on: 'go', do: [{ emit: 'point' }] }],
  objectives: { time_limit: '30s', on_timeout: 'win' },
  look: { id: 'paper' }, art: { palette: { bg: '#F4F1EA', ink: '#EEEEEE', surface: '#FFFFFF' } },
  presentation: { slots: [
    { slot: 'playfield', node: { node: 'text', x: 181, y: 63, anchor: 'center', size: 19, color: '#FF0000', text: 'A very long heading that will not fit on one line at all' } },
    { slot: 'playfield', node: { node: 'rect', x: 40, y: 40, w: 80, h: 16, fill: '$surface' } },
    { slot: 'playfield', node: { node: 'rect', x: 50, y: 300, w: 30, h: 30, radius: 7, fill: '#123456', stroke: '#000', stroke_width: 5, on_tap: { input: 'go' } } },
    { slot: 'playfield', node: { node: 'group', children: [
      { node: 'text', x: 20, y: 400, w: 200, h: 20, size: 15, color: '$ink', text: 'Left label that is long' },
      { node: 'text', x: 150, y: 400, w: 100, h: 20, size: 15, color: '$ink', text: 'Right' },
    ] } },
  ] },
};
const r1 = styleCheck(messy, { library: lib });
for (const code of ['S_OFF_GRID', 'S_FONT_SCALE', 'S_COLOR_ROLE', 'S_TEXT_UNBOXED', 'S_CONTRAST', 'S_TOUCH_TARGET', 'S_RADIUS', 'S_STROKE', 'S_HUD_BAND', 'S_TEXT_OVERLAP']) ok(r1.counts[code] > 0, `check finds ${code}`);
const f1 = styleFix(messy, { library: lib });
const f2 = styleFix(messy, { library: lib });
ok(JSON.stringify(f1.manifest) === JSON.stringify(f2.manifest), 'fix output is byte-identical across runs');
ok(JSON.stringify(styleFix(f1.manifest, { library: lib }).manifest) === JSON.stringify(f1.manifest), 'a second fix pass changes nothing');
ok(JSON.stringify(messy) === JSON.stringify(JSON.parse(JSON.stringify(messy))) && messy.presentation.slots[0].node.x === 181, 'the input is not mutated');
ok(f1.after.findings.every((f) => !['S_OFF_GRID', 'S_FONT_SCALE', 'S_COLOR_ROLE', 'S_TEXT_UNBOXED', 'S_RADIUS', 'S_STROKE', 'S_TOUCH_TARGET'].includes(f.code)), `fixable codes are fixed (left: ${f1.after.findings.map((f) => f.code).join(', ')})`);
const logic = (m) => JSON.stringify([m.uses, m.inputs, m.rules, m.objectives, m.state, m.functions, m.events]);
ok(logic(f1.manifest) === logic(messy), 'the fix never touches logic');
ok(f1.manifest.ui?.kit === 'game-style/1', 'a failing palette is adopted into a ui block');

// ---- every repo game and fixture still expands; kit-built games are clean ----
const games = readdirSync(join(root, 'games')).filter((f) => f.endsWith('.authoring.json')).sort();
let engine = null;
try { ({ engine } = await (await import('../expander/engine.mjs')).loadEngine()); } catch { console.log('(no engine: skipping engine validation)'); }
for (const f of games) {
  const m = JSON.parse(readFileSync(join(root, 'games', f), 'utf8'));
  const r = expand(m, lib);
  const errs = r.diagnostics.filter((d) => d.severity === 'error');
  ok(!errs.length, `${f} expands (${errs.map((d) => d.code).join(', ')})`);
  ok(JSON.stringify(expand(m, lib).game) === JSON.stringify(r.game), `${f} expands deterministically`);
  if (engine && !errs.length) {
    const v = engine.validate(JSON.stringify(r.game)).filter((d) => d.severity === 'error');
    ok(!v.length, `${f} validates (${v.map((d) => d.code + ' ' + d.at).join('; ')})`);
  }
  if (m.ui) ok(styleCheck(m, { library: lib }).findings.length === 0, `${f} (a kit game) has no style findings`);
}

// ---- every component expands into valid engine nodes ----
const all = {
  authoring: 'microgame-authoring/0.1', meta: { title: 'Kit', instructions: 'Tap.', duration_s: 30 },
  ui: { kit: 'game-style/1', theme: 'night', base: '#7A5CFF' },
  uses: [{ fragment: 'score' }],
  state: { pick: { type: 'int', init: '-1' }, letters_on: { type: 'string', init: "''" } },
  inputs: { answer: { payload: { index: 'int' } }, press: { payload: { letter: 'string' } }, go: { payload: {} }, cell_tap: { payload: { cell: 'ivec2' } } },
  functions: { key_state: { params: { letter: 'string' }, returns: 'int', body: "if contains(chars(letters_on), letter) then 1 else 0" } },
  rules: [{ id: 'a', on: 'answer', do: [{ set: 'pick', to: 'event.index' }, { emit: 'point' }] }, { id: 'p', on: 'press', do: [{ set: 'letters_on', to: 'letters_on + event.letter' }] }],
  objectives: { time_limit: '30s', on_timeout: 'win' },
  presentation: { slots: [
    { slot: 'hud_top', node: { ui: 'stat', label: 'Best', value: '= str(pick)' } },
    { slot: 'playfield', node: { ui: 'question_card', eyebrow: 'Round one', text: 'Which planet is known as the red one?', timer: 0.5, timer_warn: '= pick > 0' } },
    { slot: 'playfield', node: { ui: 'meter', label: 'Heat', value: '= 0.4', tone: 'accent' } },
    { slot: 'playfield', node: { ui: 'board', cols: 3, rows: 2, text: "= str(cell.x)", on_tap: { input: 'cell_tap', with: { cell: 'cell' } } } },
    { slot: 'playfield', node: { ui: 'answer_grid', count: 4, cols: 2, text: "= get_or(['Mars', 'Venus', 'A much longer answer that must fit', 'Io'], k, '')", state: "= if pick == k then 'good' else ''", on_tap: { input: 'answer', with: { index: 'k' } } } },
    { slot: 'playfield', node: { ui: 'keyboard', letters: 'abcdefghij', cols: 10, key_state: '= key_state(letter)', on_tap: { input: 'press', with: { letter: 'letter' } } } },
    { slot: 'playfield', node: { ui: 'button', text: 'Go', on_tap: { input: 'go' } } },
    { slot: 'overlay', node: { ui: 'banner', text: 'Nice!', tone: 'success', visible: '= pick >= 0' } },
    { slot: 'overlay', node: { ui: 'toast', text: '= str(pick)', tone: "= if pick > 0 then 'success' else 'danger'" } },
    { slot: 'overlay', node: { ui: 'intro_card', title: 'Kit test', body: 'Every component', button: 'Start', on_tap: { input: 'go' }, visible: '= false' } },
    { slot: 'overlay', node: { ui: 'result_card', title: 'Done', score: '= str(pick)', line: 'Thanks for playing' } },
  ] },
};
const ra = expand(all, lib);
const raErr = ra.diagnostics.filter((d) => d.severity === 'error');
ok(!raErr.length, `all-components game expands (${raErr.map((d) => d.code + ' ' + d.message).join('; ')})`);
ok(!JSON.stringify(ra.game.presentation.root).includes('"ui"'), 'no kit node survives expansion');
if (engine && !raErr.length) {
  const v = engine.validate(JSON.stringify(ra.game)).filter((d) => d.severity === 'error');
  ok(!v.length, `all-components game validates (${v.map((d) => d.code + ' ' + d.at + ' ' + d.message).join('; ')})`);
  if (!v.length) {
  const g = engine.load(JSON.stringify(ra.game), 1);
  g.step(16); g.frame();
  const targets = g.hitTargets();
  ok(targets.length > 0 && targets.every((t) => t.w >= 24 && t.h >= 44), `kit tap targets are at least 44 tall (${targets.map((t) => `${t.w}x${t.h}`).join(' ')})`);
  g.dispose();
  }
}
ok(Object.keys(COMPONENTS).length >= 18, 'component catalog');

// ---- one canvas constant; a tall canvas moves the bottom bands and never lets regions overlap ----
for (const canvas of [CANVAS, { w: 360, h: 780 }]) {
  const b = bands(canvas);
  ok(b.controlsBottom === b.safe.y1 - 24 && b.hudBottom.y + b.hudBottom.h <= canvas.h && b.hud.y + b.hud.h < b.top, `bands for ${canvas.w}x${canvas.h}`);
  const tall = { ...lib, looks: Object.fromEntries(Object.entries(lib.looks).map(([k, v]) => [k, { ...v, canvas }])) };
  const r = expand(all, tall);
  ok(!r.diagnostics.some((d) => d.severity === 'error') && r.game.presentation.canvas.h === canvas.h, `all-components game on ${canvas.w}x${canvas.h}`);
  const slots = { hud_top: [{ node: { ui: 'stat', label: 'A', value: '= 1' } }], hud_bottom: [{ node: { node: 'text', text: 'Daily' } }], playfield: [
    { node: { ui: 'question_card', text: 'Q' } }, { node: { ui: 'frame' } }, { node: { ui: 'answer_grid', count: 4 } }, { node: { ui: 'button', text: 'Go' } }], overlay: [] };
  const k = applyUiKit(slots, { canvas });
  const R = k.regions;
  const below = (a, b) => a.y + a.h <= b.y;
  ok(below(R.hud, R.top) && below(R.top, R.playfield) && below(R.playfield, R.controls) && below(R.controls, R.hud_bottom), `regions stack without overlap on ${canvas.h} (${JSON.stringify(R)})`);
  ok(R.hud_bottom.y + R.hud_bottom.h <= canvas.h, 'the bottom strip is on the canvas');
}

// ---- the verifier module ----
const vr = styleVerifier.run(messy, { library: lib });
ok(styleVerifier.id === 'style' && vr.blocking.length > 0 && vr.findings.length >= vr.blocking.length, 'verifier: run reports blocking findings');
const vf = styleVerifier.fix(messy, { library: lib });
ok(vf.manifest && vf.blocking.length < vr.blocking.length, 'verifier: fix removes blocking findings');


console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
