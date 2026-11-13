#!/usr/bin/env node
// Tests for picture games (docs/harness-gaps/images.md), with no network:
//   1. expander/spot-diff.mjs: checks, determinism, the answer key matches the pictures,
//      hit circles apart, fixed objects and emoji colors left alone, decoys, toAuthoring;
//   2. the fragments expand: zoom_reveal + picture_quiz (games/zoom_safari) and diff_spots
//      (examples/group_chat_diff, rebuilt from its scene here so it can't go stale);
//   3. with a built engine (MG_ENGINE_DIR): validate, play scripted taps, check the zoom geometry
//      frame by frame, and verify the replay logs.
// Usage: node authoring/tools/test-pictures.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSpotDifference, toAuthoring, checkScene, sceneSvg, bbox, KINDS } from '../expander/spot-diff.mjs';
import { sanitizeSvg } from '../expander/svg.mjs';
import { expand, loadLibrary } from '../expander/expand.mjs';
import { diffGame } from './make-diff-game.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const authoringDir = join(here, '..');
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log(`FAIL ${msg}`); } };
const readJSON = (p) => JSON.parse(readFileSync(join(authoringDir, p), 'utf8'));
const errorsOf = (r) => r.diagnostics.filter((d) => d.severity === 'error');

// ---------- 1. the generator ----------

const scene = readJSON('examples/group_chat_scene.json');
{
  ok(checkScene(scene).length === 0, `the example scene is valid (${checkScene(scene).join('; ')})`);
  ok(checkScene({ objects: [] }).length > 0, 'an empty scene is a problem');
  ok(checkScene({ w: 320, h: 240, objects: [{ id: 'a', shape: 'blob' }, { id: 'a', shape: 'rect' }, { id: 'c', shape: 'text', x: 1, y: 1 }] }).length >= 3, 'bad shape, duplicate id, text without text are all reported');
  ok(checkScene({ w: 320, h: 240, objects: [1, 2, 3].map((i) => ({ id: `r${i}`, shape: 'rect', x: 1, y: 1, w: 5, h: 5, fill: 'red' })) }).some((p) => p.includes('#RRGGBB')), 'named colors are rejected');

  const p1 = makeSpotDifference(scene, { count: 7, seed: 7 });
  const p2 = makeSpotDifference(scene, { count: 7, seed: 7 });
  const p3 = makeSpotDifference(scene, { count: 7, seed: 8 });
  ok(JSON.stringify(p1) === JSON.stringify(p2), 'same scene + same seed gives the same pair');
  ok(p1.a === p3.a && (p1.b !== p3.b || JSON.stringify(p1.diffs) !== JSON.stringify(p3.diffs)), 'another seed changes picture b and the key, never picture a');
  ok(p1.diffs.length === 7 && !p1.problems.length, `7 differences, no problems (${p1.problems.join('; ')})`);
  ok(p1.a === sceneSvg(scene), 'picture a is the scene as written');
  for (const [name, svg] of [['a', p1.a], ['b', p1.b]]) {
    const r = sanitizeSvg(svg);
    ok(r.ok && r.viewBox.w === 320 && r.viewBox.h === 240, `picture ${name} passes the SVG sanitizer with the scene's viewBox`);
  }
  // Apart: no tap finds two changes.
  let apart = true;
  for (let i = 0; i < p1.diffs.length; i++) for (let j = i + 1; j < p1.diffs.length; j++) {
    const a = p1.diffs[i], b = p1.diffs[j];
    if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) apart = false;
  }
  ok(apart, 'hit circles never overlap');
  // Each recorded change really is in picture b, and only those objects changed.
  const byId = Object.fromEntries(scene.objects.map((o) => [o.id, o]));
  const fixed = scene.objects.filter((o) => o.fixed).map((o) => o.id);
  ok(p1.diffs.every((d) => !fixed.includes(d.id)), 'fixed objects never change');
  ok(p1.diffs.every((d) => KINDS.includes(d.kind) && d.r >= 12 && d.x >= 0 && d.x <= 320 && d.y >= 0 && d.y <= 240), 'every difference has a kind, a fingertip-size radius and sits in the scene');
  ok(p1.diffs.every((d) => { const b = bbox(byId[d.id]); return d.x >= b.x - d.r && d.x <= b.x + b.w + d.r && d.y >= b.y - d.r && d.y <= b.y + b.h + d.r; }), 'each hit circle covers the object that changed');
  const elementsA = p1.a.match(/<(rect|circle|ellipse|polygon|line|text)[^>]*>([^<]*)/g), elementsB = p1.b.match(/<(rect|circle|ellipse|polygon|line|text)[^>]*>([^<]*)/g);
  const onlyA = elementsA.filter((e) => !elementsB.includes(e)).length, onlyB = elementsB.filter((e) => !elementsA.includes(e)).length;
  const removed = p1.diffs.filter((d) => d.kind === 'remove').length;
  ok(onlyA === p1.diffs.length && onlyB === p1.diffs.length - removed, `exactly the ${p1.diffs.length} recorded objects differ between the pictures (a-only ${onlyA}, b-only ${onlyB})`);
  // Emoji-only text is never recolored (the glyph keeps its own colors, so it would look the same).
  const emojiIds = scene.objects.filter((o) => o.shape === 'text' && !/[A-Za-z0-9]{3}/.test(o.text.replace(/[^A-Za-z0-9]/g, ''))).map((o) => o.id);
  let emojiRecolor = false;
  for (let s = 1; s <= 40; s++) for (const d of makeSpotDifference(scene, { count: 7, seed: s }).diffs) if (d.kind === 'recolor' && emojiIds.includes(d.id)) emojiRecolor = true;
  ok(!emojiRecolor, 'emoji-only text is never recolored (40 seeds)');
  // Every seed in a range makes a full, clean pair.
  let full = 0;
  for (let s = 1; s <= 40; s++) { const p = makeSpotDifference(scene, { count: 6, seed: s }); if (p.diffs.length === 6 && !p.problems.length) full++; }
  ok(full === 40, `40 of 40 seeds make 6 clean differences (${full})`);
  // Decoys: unchanged objects, away from every change.
  ok(p1.decoys.length >= 8 && p1.decoys.every((c) => p1.diffs.every((d) => Math.hypot(d.x - c.x, d.y - c.y) >= d.r + 10)), `decoys sit away from the changes (${p1.decoys.length})`);
  // Too few objects is reported, not hidden.
  const tiny = { w: 320, h: 240, objects: [1, 2, 3].map((i) => ({ id: `c${i}`, shape: 'circle', x: 60 * i, y: 100, r: 10, fill: '#3A6EA5' })) };
  const pt = makeSpotDifference(tiny, { count: 5, seed: 1 });
  ok(pt.diffs.length === 3 && pt.problems.some((p) => p.includes('only 3 of 5')), 'a scene with too few objects says how many fit');
  // kinds can be limited.
  ok(makeSpotDifference(scene, { count: 5, seed: 3, kinds: ['remove'] }).diffs.every((d) => d.kind === 'remove'), 'kinds limits the changes');
  // toAuthoring
  const t = toAuthoring(p1);
  ok(t.art.sprites.picture_a.svg === p1.a && t.art.sprites.picture_b.w === 320 && t.art.sprites.picture_b.h === 240, 'toAuthoring writes both sprites at the scene size');
  ok(t.functions.diff_points.body.split('vec(').length - 1 === 7 && t.functions.diff_radii.returns === 'list<int>' && t.functions.diff_decoys.returns === 'list<ivec2>', 'toAuthoring writes the three answer-key functions');
}

// ---------- 2. the fragments expand ----------

const lib = loadLibrary(authoringDir);
const zoomManifest = readJSON('games/zoom_safari.authoring.json');
const zoomX = expand(zoomManifest, lib);
ok(errorsOf(zoomX).length === 0, `zoom_safari expands (${errorsOf(zoomX).map((d) => d.code + ' ' + d.message).join('; ')})`);
const pair = makeSpotDifference(scene, { count: 7, seed: 7 });
const diffManifest = diffGame(pair, { title: 'Group Chat Detective', theme: ['group chat', 'pizza', 'receipts'] });
ok(JSON.stringify(diffManifest) === JSON.stringify(readJSON('examples/group_chat_diff.authoring.json')), 'examples/group_chat_diff is what make-diff-game.mjs builds from the scene (rerun it after changing either)');
const diffX = expand(diffManifest, lib);
ok(errorsOf(diffX).length === 0, `group_chat_diff expands (${errorsOf(diffX).map((d) => d.code + ' ' + d.message).join('; ')})`);
{
  // zoom_reveal must come first: its background-coloured mask hides whatever was drawn before it.
  const wrongOrder = JSON.parse(JSON.stringify(zoomManifest));
  wrongOrder.uses.reverse();
  ok(errorsOf(expand(wrongOrder, lib)).length === 0, 'order is a convention, not an error (documented in the fragment)');
  // picture_quiz and quiz can't be used together.
  const both = JSON.parse(JSON.stringify(zoomManifest));
  both.uses.push({ fragment: 'quiz', params: {} });
  ok(errorsOf(expand(both, lib)).some((d) => d.code === 'A_CONFLICT'), 'picture_quiz conflicts with quiz');
  // Without art the fragments fall back to shapes.
  const noArt = JSON.parse(JSON.stringify(diffManifest));
  delete noArt.art.sprites;
  ok(errorsOf(expand(noArt, lib)).length === 0, 'diff_spots expands without its sprites (placeholder panels)');
}

// ---------- 3. in the engine ----------

let engine = null;
try { ({ engine } = await (await import('../expander/engine.mjs')).loadEngine()); } catch { /* no engine */ }
if (!engine) {
  console.log('skip: engine checks (set MG_ENGINE_DIR to a built engine)');
} else {
  const DT = 1000 / 60;
  const run = (game, ms, g) => { for (let t = 0; t < ms; t += DT) g.step(DT); };
  const tap = (g, x, y) => { g.frame(); g.pointer('down', x, y); g.pointer('up', x, y); g.step(DT); };

  // diff_spots: every difference found (in either picture) wins with full score; a miss costs a life.
  {
    const text = JSON.stringify(diffX.game);
    ok(engine.validate(text).filter((d) => d.severity === 'error').length === 0, 'group_chat_diff validates in the engine');
    const g = engine.load(text, 5);
    run(text, 300, g);
    const k = 320 / pair.w;
    tap(g, 20 + pair.decoys[0].x * k, 84 + pair.decoys[0].y * k);
    ok(g.state().lives === 2 && g.state().found_count === 0, 'a tap on an unchanged object is a miss and costs a life');
    tap(g, 20 + pair.diffs[0].x * k, 84 + pair.diffs[0].y * k);
    tap(g, 20 + pair.diffs[0].x * k, 340 + pair.diffs[0].y * k);
    ok(g.state().found_count === 1 && g.state().score === 10, 'finding one in the top picture counts once, tapping it again below doesn\'t');
    pair.diffs.slice(1).forEach((d, i) => tap(g, 20 + d.x * k, (i % 2 ? 84 : 340) + d.y * k));
    run(text, 100, g);
    const s = g.state();
    ok(g.phase() === 'won' && s.found_count === 7 && s.score === 70, `all 7 found wins with every point counted (${g.phase()}, ${s.found_count}, ${s.score})`);
    const v = engine.verify(text, g.log());
    ok(v.ok, 'the run replays and verifies');
    const g2 = engine.load(text, 5);
    run(text, 200, g2);
    for (let i = 0; i < 3; i++) tap(g2, 20 + pair.decoys[i].x * k, 340 + pair.decoys[i].y * k);
    run(text, 100, g2);
    ok(g2.phase() === 'lost', 'three misses lose');
  }

  // zoom_reveal: the picture starts zoom_from times bigger around the focus, shrinks to the window
  // over zoom_ms, snaps whole on an answer, and pays more for early answers.
  {
    const text = JSON.stringify(zoomX.game);
    ok(engine.validate(text).filter((d) => d.severity === 'error').length === 0, 'zoom_safari validates in the engine');
    const imageOp = (g) => ({ ...g.frame().ops.find((o) => o.op === 'image') }); // frame() reuses its objects
    const g = engine.load(text, 3);
    g.step(DT);
    const first = imageOp(g);
    ok(first && Math.abs(first.w - 280 * 6) < 280 * 0.05, `starts about 6x zoomed (${first && Math.round(first.w)})`);
    ok(first.x <= 40 && first.y <= 76 && first.x + first.w >= 320 && first.y + first.h >= 356, 'the zoomed picture always covers the window');
    run(text, 3500, g);
    const mid = imageOp(g);
    ok(mid.w < first.w && mid.w > 280, `zooms out over time (${Math.round(mid.w)})`);
    run(text, 3600, g);
    const s0 = g.state();
    // The 7 s question timer has run out by now: the answer shows the whole picture.
    g.frame();
    const end = imageOp(g);
    ok(Math.abs(end.w - 280) < 1 && Math.abs(end.x - 40) < 1 && Math.abs(end.y - 76) < 1, `ends at exactly the window (${Math.round(end.w)} at ${Math.round(end.x)}, ${Math.round(end.y)})`);
    ok(s0.wrong_count === 1, 'running out of time counts as a wrong answer');
    ok(g.frame().ops.filter((o) => o.op === 'rect' && o.w >= 40 && (o.y === 0 || o.y === 356)).length >= 2, 'the mask rects frame the window');
    // Answer right immediately on a fresh run: about 10 + 100/5 = 30 points.
    const g2 = engine.load(text, 3);
    g2.step(DT);
    const right = zoomManifest.content.answers;
    const st = g2.state();
    const q = st.order[st.qi];
    const k = st.opts.indexOf(right[q]);
    // The UI kit lays the answer tiles out (two columns): tile k in reading order.
    g2.frame();
    const tiles = g2.hitTargets().filter((t) => t.w >= 120 && t.h >= 52).sort((a, b) => a.y - b.y || a.x - b.x);
    tap(g2, tiles[k].x + tiles[k].w / 2, tiles[k].y + tiles[k].h / 2);
    ok(g2.state().score >= 28 && g2.state().score <= 30, `an instant right answer pays about 30 (${g2.state().score})`);
    const held = imageOp(g2);
    ok(Math.abs(held.w - 280) < 1, 'after answering, the whole picture shows');
    ok(engine.verify(text, g2.log()).ok, 'the zoom run replays and verifies');
  }
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
