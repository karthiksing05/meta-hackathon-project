#!/usr/bin/env node
// Tests for the story_quiz fragment (a scripted clip told as a quiz), on the gold story quizzes.
//
//   node authoring/tools/test-story-quiz.mjs        (engine checks need MG_ENGINE_DIR)
//
// 1. Both gold story quizzes expand with no errors, on the tall and the classic canvas.
// 2. With the engine: beats play in content order (never shuffled), each pick is recorded in `picks` as the
//    choice's index in content order, `called` counts the real lines, a beat mapped to -1 in `media` has no
//    picture, taps during `read_ms` do nothing, Next moves on, the last beat wins, and the run replays.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, loadLibrary } from '../expander/expand.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = loadLibrary(root);
let failed = 0, passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log(`FAIL ${msg}`); } };

const GAMES = ['gold_the_podium', 'gold_purr_earth'];
const manifests = Object.fromEntries(GAMES.map((g) => [g, JSON.parse(readFileSync(join(root, 'games', `${g}.authoring.json`), 'utf8'))]));

// ---------- 1. expansion ----------
const built = {};
for (const [id, m] of Object.entries(manifests)) {
  for (const canvas of ['tall', 'legacy']) {
    const r = expand({ ...m, look: { ...m.look, canvas } }, lib);
    const errors = r.diagnostics.filter((d) => d.severity === 'error');
    ok(errors.length === 0, `${id} (${canvas}) expands: ${errors.map((e) => `${e.code} ${e.message}`).join('; ')}`);
    if (canvas === 'tall') built[id] = r.game;
  }
}

// ---------- 1b. the tiles and the Next label take the game's palette, with readable ink ----------
// Prod 2026-11-13: the tiles were hard-coded Kahoot colours (red, blue, mustard, green) whatever the person asked for,
// and "Next" was the page colour on $primary (2.19:1 on a pastel palette).
{
  const { contrast, parseColor } = await import('../playtest/layout-check.mjs');
  const KAHOOT = ['#D01937', '#1368CE', '#9A6B00', '#1F7A0A'];
  // Resolves "= if k == 0 then $a else if k == 1 then $b ... else $d" (or a plain "$x") for tile k.
  const pickFor = (expr, k) => {
    const toks = [...String(expr).matchAll(/\$([a-z_0-9]+)/g)].map((x) => x[1]);
    return String(expr).startsWith('$') ? toks[0] : toks[Math.min(k, toks.length - 1)];
  };
  const find = (n, pred, out = []) => { if (!n || typeof n !== 'object') return out; if (pred(n)) out.push(n); for (const v of Object.values(n)) if (v && typeof v === 'object') find(v, pred, out); return out; };
  const hue = (hex) => {
    const [r, g, b] = parseColor(hex).slice(0, 3).map((v) => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 0.08) return null; // grey: no hue
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const indigoViolet = { bg: '#F4F2FF', surface: '#E6E1FF', primary: '#3F37C9', secondary: '#6D28D9', accent: '#8B5CF6', ink: '#1E1B4B', danger: '#7C3AED' };
  const cases = [...Object.entries(manifests).map(([id, m]) => [id, m]), ['indigo and violet, no yellow', { ...manifests.gold_the_podium, art: { ...manifests.gold_the_podium.art, palette: indigoViolet } }]];
  for (const [id, m] of cases) {
    const r = expand(m, lib);
    ok(!r.diagnostics.some((d) => d.severity === 'error'), `${id}: expands with the palette tiles (${r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join('; ')})`);
    const g = r.game;
    const tokens = g.presentation.tokens;
    const tile = find(g.presentation.root, (n) => n.node === 'rect' && typeof n.fill === 'string' && n.fill.includes('$secondary') && n.on_tap?.input === 'pick')[0];
    const label = find(g.presentation.root, (n) => n.node === 'text' && typeof n.text === 'string' && n.text.includes('get_or(opts, k'))[0];
    const next = find(g.presentation.root, (n) => n.node === 'text' && typeof n.text === 'string' && n.text.includes("'Next'"))[0];
    ok(tile && label && next, `${id}: finds the tiles, their labels and Next`);
    if (!tile || !label || !next) continue;
    const fills = [0, 1, 2, 3].map((k) => tokens[pickFor(tile.fill, k)]);
    const inks = [0, 1, 2, 3].map((k) => tokens[pickFor(label.color, k)]);
    ok(fills.every((c) => parseColor(c)) && new Set(fills.map((c) => c.toUpperCase())).size === 4, `${id}: four distinct tile colours from the palette (${fills.join(' ')})`);
    ok(!fills.some((c) => KAHOOT.includes(String(c).toUpperCase())), `${id}: no Kahoot colours (${fills.join(' ')})`);
    ok(!JSON.stringify(g.presentation.root).includes('#D01937'), `${id}: the Kahoot red is gone from the presentation`);
    fills.forEach((c, k) => ok(contrast(parseColor(inks[k]), parseColor(c)) >= 4.5, `${id}: tile ${k} label reads (${inks[k]} on ${c}: ${contrast(parseColor(inks[k]), parseColor(c)).toFixed(2)}:1)`));
    const nextInk = tokens[pickFor(next.color, 0)];
    ok(contrast(parseColor(nextInk), parseColor(tokens.primary)) >= 4.5, `${id}: Next reads on $primary (${nextInk} on ${tokens.primary})`);
    if (id.startsWith('indigo')) {
      const yellow = fills.filter((c) => { const h = hue(c); return h != null && h >= 40 && h <= 70; });
      ok(!yellow.length, `${id}: no yellow tile (${fills.join(' ')})`);
      ok(fills.every((c) => { const h = hue(c); return h == null || (h >= 225 && h <= 290); }), `${id}: every tile is indigo, violet or a neutral from the palette (${fills.map((c) => `${c}:${Math.round(hue(c) ?? -1)}`).join(' ')})`);
    }
  }
  // Published story quizzes (The Podium, Purr Earth) keep their rules: the palette change is presentation only.
  const { createHash } = await import('node:crypto');
  const rulesHash = (game) => { const { presentation: _p, ...rest } = game; return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 16); };
  const RULES = { gold_the_podium: '7da4f6ad7e091f0e', gold_purr_earth: '14d61cc47fad6291' };
  for (const [id, h] of Object.entries(RULES)) {
    const got = rulesHash(expand(manifests[id], lib).game);
    ok(got === h, `${id}: rules unchanged (rules hash ${got}, published ${h})`);
  }
}

// ---------- 2. the engine ----------
let engine = null;
try {
  ({ engine } = await (await import('../expander/engine.mjs')).loadEngine());
} catch (e) {
  console.log(`skip engine checks: ${String(e.message).split('.')[0]}`);
}
if (engine) {
  for (const id of GAMES) {
    const m = manifests[id];
    const json = JSON.stringify(built[id]);
    ok(engine.validate(json).filter((d) => d.severity === 'error').length === 0, `${id} validates in the engine`);
    const media = String(m.uses[0].params.media ?? '').split(',').map(Number);
    const n = m.content.answers.length;
    const g = engine.load(json, 7);
    g.step(16);
    const tapAt = (t) => { g.frame(); g.pointer('down', t.x + t.w / 2, t.y + t.h / 2); g.pointer('up', t.x + t.w / 2, t.y + t.h / 2); g.step(16); };
    // The pick buttons are the three targets of equal size stacked under the card, top to bottom.
    const choiceTargets = () => { g.frame(); return g.hitTargets().filter((t) => t.w >= 150 && t.w <= 160 && t.h >= 70).sort((a, b) => a.y - b.y || a.x - b.x); };
    let st = g.state();
    ok(st.beat === 0 && !st.revealing, `${id} starts on beat 0`);
    // A tap inside read_ms does nothing.
    const early = choiceTargets();
    ok(early.length === 4, `${id} shows 4 tiles (${early.length})`);
    if (early.length) tapAt(early[0]);
    ok(!g.state().revealing, `${id} ignores a pick during read_ms`);
    let expectCalled = 0;
    const expectPicks = [];
    for (let b = 0; b < n; b++) {
      g.step(1000);
      st = g.state();
      ok(st.beat === b, `${id} beat ${b} comes in order (state beat ${st.beat})`);
      ok(st.opts.length === 4 && st.opts.every((o) => m.content.choices.slice(b * 4, b * 4 + 4).includes(o)), `${id} beat ${b} shows its own choices`);
      // Alternate: pick the real line on even beats, a tame one on odd beats.
      const want = b % 2 === 0 ? m.content.answers[b] : st.opts.find((o) => o !== m.content.answers[b]);
      const k = st.opts.indexOf(want);
      const targets = choiceTargets();
      tapAt(targets[k]);
      st = g.state();
      ok(st.revealing, `${id} beat ${b}: a pick reveals`);
      expectPicks.push(m.content.choices.slice(b * 4, b * 4 + 4).indexOf(want));
      if (b % 2 === 0) expectCalled++;
      ok(st.called === expectCalled, `${id} beat ${b}: called ${st.called}, want ${expectCalled}`);
      ok(JSON.stringify(st.picks) === JSON.stringify(expectPicks), `${id} beat ${b}: picks ${JSON.stringify(st.picks)}, want ${JSON.stringify(expectPicks)}`);
      // The panel is the one image smaller than the canvas (the backdrop fills it).
      const f = g.frameJSON ? g.frameJSON() : null;
      const frame = typeof f === 'string' ? JSON.parse(f) : f;
      if (frame?.ops) ok((media[b] >= 0) === frame.ops.some((o) => o.op === 'image' && o.w < frame.width), `${id} beat ${b}: picture ${media[b] >= 0 ? 'shown' : 'hidden'}`);
      // Next is the one small target left on screen.
      g.frame();
      const next = g.hitTargets().filter((t) => t.w === 100 && t.h === 44);
      ok(next.length === 1, `${id} beat ${b}: one Next button (${next.length})`);
      if (next.length) tapAt(next[0]);
    }
    ok(g.phase() === 'won' && g.state().finished, `${id}: the last beat wins (phase ${g.phase()})`);
    const v = engine.verify(json, g.log());
    ok(v.ok !== false && (v.problems ?? []).length === 0, `${id}: the run replays (${JSON.stringify(v.problems ?? [])})`);
    // Left alone, the countdown runs out: the real line is revealed with no pick (-1), then the next beat comes.
    const g2 = engine.load(json, 7);
    g2.step(16000);
    ok(g2.state().beat === 0 && g2.state().revealing && JSON.stringify(g2.state().picks) === '[-1]' && g2.state().called === 0, `${id}: the countdown runs out into the reveal (${JSON.stringify(g2.state().picks)})`);
    g2.step(10000);
    ok(g2.state().beat === 1, `${id}: then the next beat comes by itself`);
    g2.step(30 * 26000);
    ok(g2.phase() === 'won', `${id}: an idle run still ends (phase ${g2.phase()})`);
  }
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
