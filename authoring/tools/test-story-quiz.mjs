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
    const choiceTargets = () => { g.frame(); return g.hitTargets().filter((t) => t.w >= 300 && t.h >= 44 && t.h <= 60).sort((a, b) => a.y - b.y); };
    let st = g.state();
    ok(st.beat === 0 && !st.revealing, `${id} starts on beat 0`);
    // A tap inside read_ms does nothing.
    const early = choiceTargets();
    ok(early.length === 3, `${id} shows 3 choices (${early.length})`);
    if (early.length) tapAt(early[0]);
    ok(!g.state().revealing, `${id} ignores a pick during read_ms`);
    let expectCalled = 0;
    const expectPicks = [];
    for (let b = 0; b < n; b++) {
      g.step(1000);
      st = g.state();
      ok(st.beat === b, `${id} beat ${b} comes in order (state beat ${st.beat})`);
      ok(st.opts.length === 3 && st.opts.every((o) => m.content.choices.slice(b * 3, b * 3 + 3).includes(o)), `${id} beat ${b} shows its own choices`);
      // Alternate: pick the real line on even beats, a tame one on odd beats.
      const want = b % 2 === 0 ? m.content.answers[b] : st.opts.find((o) => o !== m.content.answers[b]);
      const k = st.opts.indexOf(want);
      const targets = choiceTargets();
      tapAt(targets[k]);
      st = g.state();
      ok(st.revealing, `${id} beat ${b}: a pick reveals`);
      expectPicks.push(m.content.choices.slice(b * 3, b * 3 + 3).indexOf(want));
      if (b % 2 === 0) expectCalled++;
      ok(st.called === expectCalled, `${id} beat ${b}: called ${st.called}, want ${expectCalled}`);
      ok(JSON.stringify(st.picks) === JSON.stringify(expectPicks), `${id} beat ${b}: picks ${JSON.stringify(st.picks)}, want ${JSON.stringify(expectPicks)}`);
      // The panel is the one image smaller than the canvas (the backdrop fills it).
      const f = g.frameJSON ? g.frameJSON() : null;
      const frame = typeof f === 'string' ? JSON.parse(f) : f;
      if (frame?.ops) ok((media[b] >= 0) === frame.ops.some((o) => o.op === 'image' && o.w < frame.width), `${id} beat ${b}: picture ${media[b] >= 0 ? 'shown' : 'hidden'}`);
      // Next is the one small target left on screen.
      g.frame();
      const next = g.hitTargets().filter((t) => t.w < 200 && t.h >= 40);
      ok(next.length === 1, `${id} beat ${b}: one Next button (${next.length})`);
      if (next.length) tapAt(next[0]);
    }
    ok(g.phase() === 'won' && g.state().finished, `${id}: the last beat wins (phase ${g.phase()})`);
    const v = engine.verify(json, g.log());
    ok(v.ok !== false && (v.problems ?? []).length === 0, `${id}: the run replays (${JSON.stringify(v.problems ?? [])})`);
    // Left alone, a beat moves on by itself after reveal_ms once picked; unpicked, it waits.
    const g2 = engine.load(json, 7);
    g2.step(20000);
    ok(g2.state().beat === 0 && !g2.state().revealing, `${id}: an unpicked beat waits`);
  }
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
