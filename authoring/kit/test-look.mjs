#!/usr/bin/env node
// Tests for the look kit: the font library, the vibe table, choosing a look, applying it and the
// S_* look checks. Engine parts run when MG_ENGINE_DIR (or engine/web/pkg) has the engine.
//
//   node authoring/kit/test-look.mjs

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_DATA } from './font-data.mjs';
import { VIBES } from './vibes.mjs';
import { chooseLook, lookFromChoice, lookChoice, lookChoiceErrors, applyLook, lookCheck, lookFix, rankVibes, specSizes, specFamilies, textNodes, widthFactor, LOOK_CODES } from './look.mjs';
import { FONTS } from '../expander/art.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };

// ---------- the library ----------
const fonts = JSON.parse(readFileSync(join(root, 'authoring/fonts/fonts.json'), 'utf8')).families;
const web = join(root, 'FacebookClone/Bubbles/Runtime/web');
let bytes = 0;
for (const [id, f] of Object.entries(fonts)) {
  ok(['OFL-1.1', 'Apache-2.0'].includes(f.license), `${id} is OFL or Apache`, f.license);
  ok(/^https:\/\/github.com\/google\/fonts\//.test(f.source), `${id} records its source`);
  ok(existsSync(join(root, 'authoring/fonts/licenses', `${id}.txt`)), `${id} ships its license text`);
  for (const file of Object.values(f.files)) { ok(existsSync(join(web, file)), `${file} is bundled`); if (existsSync(join(web, file))) bytes += statSync(join(web, file)).size; }
  ok(FONT_DATA[id]?.family === f.family, `${id} in font-data.mjs`);
  ok(FONTS.includes(f.family), `${f.family} is an allowed art.font`);
}
ok(bytes < 4 * 1024 * 1024, 'bundled fonts under 4 MB', bytes);
const css = readFileSync(join(web, 'game-fonts.css'), 'utf8');
ok(Object.values(fonts).every((f) => css.includes(`font-family: "${f.family}";`)), 'game-fonts.css declares every family');
ok((css.match(/local\("/g) ?? []).length >= Object.keys(fonts).length, 'every face has system fallbacks');
ok(readFileSync(join(web, 'bubble-host.html'), 'utf8').includes('game-fonts.css'), 'the host page loads game-fonts.css');

// ---------- the vibe table ----------
ok(VIBES.length >= 20, 'at least 20 vibes', VIBES.length);
const seenPair = new Set();
for (const v of VIBES) {
  ok(v.pairings.length >= 2 && v.pairings.length <= 3, `${v.id} has 2–3 pairings`);
  ok(Array.isArray(v.fallback) && v.fallback.length, `${v.id} has a system stack`);
  for (const p of v.pairings) {
    for (const r of ['display', 'text', 'numerals']) if (p[r]) ok(!!FONT_DATA[p[r]], `${v.id}/${p.id} ${r} font ${p[r]} exists`);
    // Reading text needs a face that fits the kit's boxes (average advance at most 0.62 em).
    const t = FONT_DATA[p.text];
    ok(t && Math.max(...Object.values(t.avg)) <= 0.62, `${v.id}/${p.id} text font ${p.text} is narrow enough`);
    ok(!seenPair.has(`${p.display}+${p.text}`), `${v.id}/${p.id} is a pairing no other vibe uses`, `${p.display}+${p.text}`);
    seenPair.add(`${p.display}+${p.text}`);
    ok(p.ratio[0] >= 1.125 && p.ratio[1] <= 1.4 && p.ratio[0] <= p.ratio[1], `${v.id}/${p.id} ratio range`);
  }
}

// ---------- choosing ----------
const want = [
  ['Price is Right style game guessing what everyday items cost in 1985', 'game_show'],
  ['Star Wars choose your own adventure game where I play as Princess Leia escaping the Death Star', 'space_saga'],
  ['Plants vs Zombies style lane defense where houseplants defend an apartment from bugs', 'garden_cozy'],
  ['Pop Mart sponsored blind box game where I open boxes and trade duplicates to finish the Labubu set', 'cute_collectible'],
  ['Trivia game about the Greek, Norse and Egyptian gods where wrong answers make Zeus angrier', 'myth_ancient'],
  ['Max Verstappen F1 game', 'racing_sport'],
  ['Choose your own adventure where I\'m a medieval peasant trying to become king in 10 choices or less', 'medieval_quest'],
  ['Galaga style pixel shooter', 'pixel_arcade'],
  ['a calm game', 'clean_modern'],
];
for (const [req, id] of want) ok(rankVibes({ request: req })[0].id === id || (id === 'clean_modern' && rankVibes({ request: req })[0].score === 0), `"${req.slice(0, 40)}" → ${id}`, rankVibes({ request: req }).slice(0, 2));
const a = chooseLook({ request: want[0][0] }, 'game-a');
ok(JSON.stringify(a) === JSON.stringify(chooseLook({ request: want[0][0] }, 'game-a')), 'deterministic');
ok(JSON.stringify(lookFromChoice(lookChoice(a))) === JSON.stringify(a), 'art.type round-trips');
ok(lookChoiceErrors(lookChoice(a)).length === 0, 'art.type validates');
ok(lookChoiceErrors({ vibe: 'nope' }).length > 0 && lookChoiceErrors({ vibe: 'game_show', pairing: 'x' }).length > 0, 'bad art.type is reported');
// Same vibe, different ids: looks differ.
const ids = Array.from({ length: 12 }, (_, i) => `game-${i}`);
const looks = ids.map((id) => chooseLook({ request: want[0][0] }, id));
ok(looks.every((l) => l.vibe === 'game_show'), 'same words → same vibe');
ok(new Set(looks.map((l) => l.pairing)).size >= 2, 'same vibe → different pairings across ids', looks.map((l) => l.pairing));
ok(new Set(looks.map((l) => `${l.pairing}|${l.ratio}|${l.base}`)).size >= 10, 'same vibe → nearly every id a different look');
for (const l of looks) {
  const s = l.steps;
  ok(s.caption.size < s.label.size && s.label.size < s.body.size && s.body.size < s.title.size && s.title.size < s.display.size && s.display.size < s.hero.size, 'scale increases', s);
  ok(s.caption.size >= 12, 'nothing under 12');
  ok(specFamilies(l).length <= (l.numerals ? 3 : 2), 'at most 2 families (3 with numerals)');
}
ok(widthFactor('press_start', 400) < 0.7 && widthFactor('barlow_cond', 500) === 1, 'wide faces are set smaller; text faces never grow');

// ---------- applying ----------
const game = {
  presentation: {
    canvas: { w: 360, h: 780 },
    tokens: { bg: '#24113F', surface: '#FFF3D6', ink: '#2A174A', primary: '#00C2A8', accent: '#FFC21C', danger: '#E8282B', secondary: '#7C5CFF' },
    root: { node: 'group', children: [
      { node: 'text', x: 20, y: 120, w: 320, h: 40, text: 'Come on down!', size: 30, weight: 900, font: 'Inter', color: '#FFC21C' },
      { node: 'text', x: 20, y: 170, w: 320, h: 60, text: '= item_clue()', size: 15, weight: 600, font: 'Inter', color: '$ink', wrap: true },
      { node: 'text', x: 20, y: 240, w: 100, h: 30, text: '= str(score)', size: 28, weight: 800, color: '$primary' },
      { node: 'text', x: 20, y: 280, w: 320, h: 20, text: 'Your bid', size: 12, weight: 700, color: '#FFFFFF' },
      { node: 'text', x: 20, y: 300, w: 320, h: 30, text: "= if len(x) <= 10 then 24 else 18", size: '= if len(x) <= 10 then 24 else 18', weight: 700, color: "= if ok then $primary else '#FF0000'" },
      { node: 'group', x: 0, y: 0, children: [{ node: 'repeat', template: { node: 'text', text: '+10', size: 20, color: '$accent' } }] },
    ] },
  },
  rules: [{ id: 'r' }],
};
const spec = chooseLook({ request: want[0][0] }, 'fixture');
const before = lookCheck(game, spec, { words: { request: want[0][0] } }).map((f) => f.code);
for (const c of ['S_FONT_FAMILIES', 'S_TYPE_SCALE', 'S_TEXT_COLORS', 'S_WEIGHT_MIX', 'S_THEME_MISMATCH']) ok(before.includes(c), `fixture shows ${c}`, before);
const fixed = lookFix(game, spec);
ok(fixed.findings.filter((f) => f.severity === 'block').length === 0, 'the fix leaves no blocking look findings', fixed.findings);
ok(JSON.stringify(fixed.game.rules) === JSON.stringify(game.rules), 'rules untouched');
ok(applyLook(fixed.game, spec).changed === 0, 'idempotent');
const tn = textNodes(fixed.game).map((t) => t.n);
const allowed = specSizes(spec);
ok(tn.every((n) => (typeof n.size === 'number' ? allowed.has(n.size) : [...String(n.size).matchAll(/(?:then|else)\s+(\d+)/g)].every((m) => allowed.has(Number(m[1]))))), 'every size on the scale', tn.map((n) => n.size));
ok(tn.every((n) => specFamilies(spec).includes(n.font)), 'every family from the pairing', tn.map((n) => n.font));
ok(tn[1].font === spec.families.text && !String(tn[1].text).startsWith('= upper'), 'wrapped expression stays in the text font, not upper-cased');
ok(!spec.numerals || tn[2].font === spec.numerals.family, 'score in the numerals font');
ok(tn.every((n) => !/'#/.test(String(n.color)) && !/^#/.test(String(n.color))), 'text colours are tokens', tn.map((n) => n.color));
ok(Object.keys(LOOK_CODES).length === 8, 'eight look codes');

// ---------- the expander applies art.type ----------
const { expand, loadLibrary } = await import('../expander/expand.mjs');
const lib = loadLibrary(join(root, 'authoring'));
const m = {
  authoring: 'microgame-authoring/0.1', meta: { title: 'Tap test', instructions: 'Tap.', duration_s: 20 },
  look: { id: 'paper', canvas: 'tall' }, art: { type: lookChoice(spec) },
  state: { score: { type: 'int', init: '0' } }, inputs: { tap: { from: [{ pointer: 'down' }] } },
  rules: [{ id: 'tap', on: 'tap', do: [{ incr: 'score' }] }], objectives: { score: 'score', time_limit: '20s' },
  presentation: { slots: [{ slot: 'hud_top', node: { node: 'text', text: "= 'Score: ' + str(score)", size: 18 } }, { slot: 'playfield', node: { node: 'text', x: 20, y: 300, w: 320, h: 40, text: 'Hello there', size: 30 } }] },
};
const r = expand(m, lib);
ok(!r.diagnostics.some((d) => d.severity === 'error'), 'a manifest with art.type expands', r.diagnostics.filter((d) => d.severity === 'error'));
const g = r.game ?? r.out;
ok(g && textNodes(g).every((t) => specFamilies(spec).includes(t.n.font)), 'the expander sets the look', g && textNodes(g).map((t) => t.n.font));
const bad = expand({ ...m, art: { type: { vibe: 'nope' } } }, lib);
ok(bad.diagnostics.some((d) => d.code === 'A_ART_FIELD' && d.at === '/art/type'), 'a bad art.type is A_ART_FIELD');

// ---------- the fixed regions ----------
const { kitRegions } = await import('../expander/ui-style.mjs');
const R = kitRegions({ w: 360, h: 780 });
ok(R.hud.y >= 110 && R.hud.y + R.hud.h <= R.play.y && R.play.y + R.play.h <= R.controls.y && R.controls.y + R.controls.h <= 684, 'tall regions stack inside the safe area', R);
ok(R.hud.y === 114 && R.controls.y + R.controls.h === 660, 'tall HUD band and control band', R);
const R0 = kitRegions({ w: 360, h: 640 });
ok(R0.hud.y === 24 && R0.controls.y + R0.controls.h === 616, '640 regions', R0);

// ---------- engine ----------
const { loadEngine } = await import('../expander/engine.mjs');
let engine = null;
try { engine = (await loadEngine()).engine; } catch { /* no engine */ }
if (engine && g) {
  ok(engine.validate(JSON.stringify(g)).filter((d) => d.severity === 'error').length === 0, 'the looked game validates in the engine');
  ok(engine.validate(JSON.stringify({ ...fixed.game, ...{} })) !== null, 'engine runs');
}

console.log(`look kit: ${pass} passed, ${fail} failed${engine ? '' : ' (no engine)'}`);
process.exit(fail ? 1 : 0);
