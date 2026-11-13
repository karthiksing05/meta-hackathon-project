#!/usr/bin/env node
// Tests for the score model and its checks, with no network:
//   1. expander/score.mjs: defaults, kinds, the contract's enums and units, format;
//   2. the expander and wrap carry the model (manifest.score, never game.json);
//   3. playtest/score-check.mjs on fake runs: a time trial, a farmable points game, a Krillion-style
//      tiered game and a calm no-fail game;
//   4. with a built engine (MG_ENGINE_DIR): the whole check through the real engine;
//   5. the committed Studio bundle (engine included): expand → gate → scoreCheck → wrap.
// Usage: node authoring/tools/test-score.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as S from '../expander/score.mjs';
import { expand, loadLibrary } from '../expander/expand.mjs';
import { wrapGame } from '../expander/wrap.mjs';
import { analyzeScore, recordBounds, checkScore, instrumentEvents } from '../playtest/score-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const authoringDir = join(here, '..');
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log(`FAIL ${msg}`); } };
const status = (checks, id) => checks.find((c) => c.id === id)?.status;
const codes = (r) => r.diagnostics.map((d) => d.code);

// ---------- 1. the model ----------

{
  const d = S.normalizeScore(undefined);
  ok(!d.declared && d.score.kind === 'points' && d.score.direction === 'higher' && d.score.counts_when === 'any' && d.score.aggregate === 'best', 'no block: points, higher, every run, best');
  const t = S.normalizeScore({ kind: 'time_to_complete', measures: 'seconds to make 20 sandwiches' });
  ok(t.score.direction === 'lower' && t.score.counts_when === 'finished' && t.score.format === 'm:ss.t' && t.score.source === 'time' && !t.diagnostics.length, 'time trial defaults: lower, finished, m:ss.t, from the clock');
  ok(codes(S.normalizeScore({ kind: 'time_to_complete', direction: 'higher' })).includes('A_SCORE_DIRECTION'), 'a time trial must rank lower first');
  ok(codes(S.normalizeScore({ kind: 'time_to_complete', counts_when: 'any' })).includes('A_SCORE_COUNTS'), 'a time trial only counts finished runs');
  ok(codes(S.normalizeScore({ kind: 'points', direction: 'lower' })).includes('A_SCORE_COUNTS'), 'lower-is-better with every run counting is an error');
  ok(codes(S.normalizeScore({ kind: 'accuracy', counts_when: 'any' })).includes('A_SCORE_COUNTS'), 'accuracy only counts finished runs');
  const k = S.normalizeScore({ kind: 'krill' });
  ok(codes(k).includes('A_SCORE_KIND') && k.score.kind === 'points', 'unknown kind is an error and falls back to points');
  ok(codes(S.normalizeScore({ tie_break: 'fewer mistakes' })).includes('A_SCORE_TIE_BREAK'), 'tie_break is only "less time" or "earlier"');
  ok(S.normalizeScore({ tie_break: 'less time' }).score.tie_break === 'less time', 'tie_break "less time"');
  ok(codes(S.normalizeScore({ aggregate: 'average' })).includes('A_SCORE_AGGREGATE'), 'aggregate is best, latest or sum_week');
  ok(S.normalizeScore({ aggregate: 'sum_week' }).score.aggregate === 'sum_week', 'sum_week accepted');
  ok(codes(S.normalizeScore({ format: '{n} {n}' })).includes('A_SCORE_FORMAT'), 'a format has one {n}');
  ok(S.normalizeScore({ kind: 'count_in_time', unit: 'orders' }).score.format === '{n} orders', 'unit fills in the format');
  ok(S.normalizeScore({ bounds: { min: 0.4, max: 59.6 } }).score.bounds.max === 60, 'bounds are whole numbers');
  ok(S.normalizeScore({ ranked: false }).score.ranked === false, 'ranked: false is kept');
  ok(S.normalizeScore({ colour: 'x' }).diagnostics.some((x) => x.severity === 'warning'), 'unknown fields warn');
  ok(S.formatScore(83456, 'm:ss.t') === '1:23.4', 'm:ss.t reads 83456 ms as 1:23.4');
  ok(S.formatScore(83456, 'm:ss') === '1:23', 'm:ss');
  ok(S.formatScore(12345, 's.t') === '12.3', 's.t');
  ok(S.formatScore(12, '{n} orders') === '12 orders' && S.formatScore(87, '{n}%') === '87%', 'text formats');
  ok(S.runValue({ source: 'time' }, { seconds: 61.2345, time_ms: 61234 }) === 61234, 'time values are whole ms from time_ms');
  ok(S.runValue({ source: 'score' }, { score: 12.6 }) === 13, 'score values are whole numbers');
  ok(S.PART_DEPENDS.score.join() === 'goal,constraints,end', 'the score part depends on goal, constraints and end');
}

// ---------- 2. expander and wrap ----------

const lib = loadLibrary(authoringDir);
const tide = JSON.parse(readFileSync(join(authoringDir, 'games', 'tide_taps.authoring.json'), 'utf8'));
{
  const plain = expand(tide, lib);
  ok(!plain.scoreDeclared && plain.score.kind === 'points', 'a manifest without a score block expands with the default model');
  const block = { kind: 'points', measures: 'shells tapped while the tide is out', unit: 'points', events: ['point'] };
  const withScore = expand({ ...tide, score: block }, lib);
  ok(withScore.scoreDeclared && withScore.score.events.join() === 'point', 'the score block comes back from the expander');
  ok(JSON.stringify(withScore.game) === JSON.stringify(plain.game), 'game.json is identical with or without a score block');
  ok(!withScore.diagnostics.some((d) => d.severity === 'error'), 'a good score block adds no errors');
  const bad = expand({ ...tide, score: { ...block, events: ['pointt'] } }, lib);
  const e = bad.diagnostics.find((d) => d.code === 'A_SCORE_EVENTS');
  ok(e && e.at === '/score/events' && /point/.test(e.hint ?? ''), 'an unknown score event is an error with a hint');
  const m = wrapGame({ id: 'mg-x', game: withScore.game, authoring: tide, score: withScore.score });
  ok(m.score && m.score.kind === 'points' && Object.keys(m).indexOf('score') === Object.keys(m).indexOf('formula') + 1, 'wrap puts score at the top level, next to formula');
  ok(!('score' in wrapGame({ id: 'mg-y', game: plain.game })), 'no model, no score key (older boards behave as before)');
}

// ---------- 3. checks on fake runs ----------

const run = (label, outcome, score, seconds) => ({ bot: { label }, ok: true, outcome, score, seconds, time_ms: Math.round(seconds * 1000) });

{ // A time trial: lower is better, and unfinished runs don't count.
  const score = S.normalizeScore({ kind: 'time_to_complete', measures: 'time to make 20 sandwiches', events: ['order_done'] }).score;
  const runs = [
    run('new player', 'fail', 0, 20.0), // quit early (lost fast): would rank first if it counted
    run('regular', 'success', 3, 45.0),
    run('pro', 'success', 5, 30.5),
    run('regular, seed 2', 'success', 2, 50.0),
    run('regular, seed 3', 'timeout', 1, 180),
  ];
  const idle = run('idle', 'timeout', 0, 180);
  const spam = [run('spam tap', 'fail', 0, 4.0)];
  const checks = analyzeScore(score, runs, { idle, spam });
  ok(status(checks, 'finish') === 'pass', 'time trial: finished runs exist');
  ok(status(checks, 'skill_order') === 'pass', `time trial: the pro's 30.5 s ranks first (${checks.find((c) => c.id === 'skill_order').message})`);
  ok(status(checks, 'idle') === 'pass' && status(checks, 'spam') === 'pass', 'time trial: idle and spam runs never finish, so they rank last');
  const b = recordBounds(score, [...runs, idle, ...spam]);
  ok(b.min === 15250 && b.max === 75001 && b.max_rate_per_s === undefined, `time trial bounds in ms from finished runs only: ${JSON.stringify(b)}`);
  const anyScore = { ...score, counts_when: 'any' };
  ok(analyzeScore(anyScore, runs, { idle, spam }).find((c) => c.id === 'skill_order').status === 'fail', 'the same time trial counting every run puts the quitter first (and fails)');
  const none = analyzeScore(score, runs.map((r) => ({ ...r, outcome: r.outcome === 'success' ? 'timeout' : r.outcome })), {});
  ok(status(none, 'finish') === 'fail', 'time trial with no finished run fails the finish rule');
}

{ // A farmable points game: one tap, repeated, beats playing well.
  const score = S.normalizeScore({ kind: 'points', events: ['point'] }).score;
  const runs = [run('new player', 'fail', 50, 25), run('regular', 'fail', 200, 40), run('pro', 'fail', 300, 60), run('regular, seed 2', 'fail', 180, 38), run('regular, seed 3', 'fail', 220, 42)];
  const checks = analyzeScore(score, runs, { idle: run('idle', 'fail', 0, 12), spam: [{ ...run('spam tap at 180,320', 'fail', 900, 60), input: 'tap at 180,320' }] });
  ok(status(checks, 'spam') === 'fail', 'farmable: the spam bot wins, so the check fails');
  ok(/tap at 180,320/.test(checks.find((c) => c.id === 'spam').message), 'farmable: the message names the input');
  const capped = analyzeScore({ ...score, bounds: { max_rate_per_s: 5 } }, runs, {});
  ok(status(capped, 'rate') === 'fail', 'a run faster than the stated max_rate_per_s fails');
  ok(status(analyzeScore({ ...score, bounds: { max_rate_per_s: 10 } }, runs, {}), 'rate') === 'pass', 'within max_rate_per_s passes');
  const idleWins = analyzeScore(score, runs, { idle: run('idle', 'timeout', 400, 180) });
  ok(status(idleWins, 'idle') === 'fail', 'an idle bot above the regular fails');
}

{ // A Krillion-style tiered game: rarer answers score more; everything counts.
  const score = S.normalizeScore({ kind: 'tiered_points', measures: 'rarity points over 7 prompts', unit: 'pts', events: ['typed_answer__submit'] }).score;
  const runs = [run('new player', 'success', 30, 140), run('regular', 'success', 90, 140), run('pro', 'success', 160, 140), run('regular, seed 2', 'success', 80, 140), run('regular, seed 3', 'success', 110, 140)];
  const checks = analyzeScore(score, runs, { idle: run('idle', 'success', 0, 140), spam: [run('spam key', 'success', 10, 140)] });
  ok(checks.every((c) => c.status === 'pass'), `tiered: every check passes (${checks.filter((c) => c.status !== 'pass').map((c) => c.id).join(', ')})`);
  ok(score.format === '{n} pts', 'tiered format from the unit');
  const b = recordBounds(score, runs);
  ok(b.min === 0 && b.max === 241 && b.max_rate_per_s > 0, `tiered bounds: ${JSON.stringify(b)}`);
  const acc = S.normalizeScore({ kind: 'accuracy' }).score;
  ok(status(analyzeScore(acc, [run('pro', 'success', 130, 30)], {}), 'integer') === 'fail', 'accuracy above 100 fails');
}

{ // A calm no-fail game: every bot scores the same; the check can't call it a fair race.
  const score = S.normalizeScore(undefined).score;
  const runs = ['new player', 'regular', 'pro', 'regular, seed 2', 'regular, seed 3'].map((l) => run(l, 'success', 0, 60));
  const checks = analyzeScore(score, runs, { idle: run('idle', 'success', 0, 60), spam: [run('spam', 'success', 0, 60)] });
  ok(status(checks, 'skill_order') === 'warn' && !checks.some((c) => c.status === 'fail'), 'calm: flat scores are ambiguous, not a failure');
  ok(S.normalizeScore({ ranked: false }).score.ranked === false, 'calm: a game can say its board is unranked');
}

// ---------- 4. the real engine ----------

let engine = null;
try {
  ({ engine } = await (await import('../expander/engine.mjs')).loadEngine());
} catch (e) {
  console.log(`skip engine checks: ${String(e.message).split('.')[0]}`);
}
if (engine) {
  const { playtest } = await import('../playtest/gate.mjs');
  const game = (m) => { const out = expand(m, lib); return { json: JSON.stringify(out.playtestGame ?? out.game), score: out.score }; };

  // Tide taps: points from taps on the shell; fair.
  const tideGame = game({ ...tide, score: { kind: 'points', events: ['point'] } });
  const report = await playtest(tideGame.json, { seed: 1 });
  const res = await checkScore(engine, tideGame.json, report.runs, tideGame.score);
  ok(res.ok, `tide_taps: the score check passes (${res.checks.filter((c) => c.status === 'fail').map((c) => c.message).join(' | ')})`);
  ok(status(res.checks, 'replay') === 'pass', `tide_taps: every run replays to the same result (${res.checks.find((c) => c.id === 'replay').message})`);
  ok(status(res.checks, 'events') === 'pass', 'tide_taps: the score changes only on point');
  ok(res.bounds && Number.isInteger(res.bounds.max) && res.bounds.max > Math.max(...report.runs.map((r) => r.score)), `tide_taps: bounds above every run (${JSON.stringify(res.bounds)})`);
  ok(res.runs.idle && res.runs.spam.length > 0, `tide_taps: idle and ${res.runs.spam.length} spam runs played`);
  if (typeof engine.verify === 'function') ok(/verified \d+ logs/.test(res.checks.find((c) => c.id === 'replay').message), 'tide_taps: the engine verified the logs');
  else console.log('note: this engine has no verify (main\'s fair-challenges engine has it); replays were re-run instead');

  // The same game naming the wrong event fails.
  const wrong = await checkScore(engine, tideGame.json, report.runs, { ...tideGame.score, events: ['level_up'] }, { spam: false });
  ok(status(wrong.checks, 'events') === 'fail', 'tide_taps with events [level_up]: the score changed on something else');

  // A tampered report doesn't replay.
  const tampered = report.runs.map((r, i) => (i === 2 ? { ...r, score: r.score + 500 } : r));
  const t = await checkScore(engine, tideGame.json, tampered, tideGame.score, { spam: false });
  ok(status(t.checks, 'replay') === 'fail', 'a run reporting 500 more points than its inputs earn fails the replay check');

  // Lights out scores 1000 - 20 per move and counts every run: doing nothing wins.
  const lights = JSON.parse(readFileSync(join(authoringDir, 'games', 'lights_out.authoring.json'), 'utf8'));
  const lg = game(lights);
  const lr = await checkScore(engine, lg.json, (await playtest(lg.json, { seed: 1 })).runs, lg.score);
  ok(!lr.ok && status(lr.checks, 'idle') === 'fail', 'lights_out as points for every run: the idle bot wins, so it fails');

  ok(engine.validate(instrumentEvents(tideGame.json, ['point', 'refill'])).every((d) => d.severity !== 'error'), 'the instrumented copy validates');
}

// ---------- 5. the Studio bundle (always: it carries the engine) ----------

const root = join(authoringDir, '..');
function loadBundle() {
  const context = vm.createContext({ console, setTimeout, clearTimeout, performance });
  for (const f of ['FacebookClone/Bubbles/Runtime/web/bubble-kit-microgame-engine.js', 'FacebookClone/Bubbles/Studio/web/microgame-studio.js']) {
    vm.runInContext(readFileSync(join(root, f), 'utf8'), context, { filename: f });
  }
  return context.MicrogameStudio;
}
const B = loadBundle();
{
  const t0 = Date.now();
  const x = JSON.parse(B.expand(JSON.stringify({ ...tide, score: { kind: 'points', unit: 'points', events: ['point'] } })));
  ok(x.ok && x.score_declared && x.score.format === '{n} points', 'bundle: expand returns the score model');
  await B.gate(x.playtest_game_json, 1);
  const c = JSON.parse(await B.scoreCheck(x.playtest_game_json, JSON.stringify(x.score)));
  ok(c.ok && c.bounds && c.checks.find((k) => k.id === 'replay').status === 'pass', `bundle: scoreCheck passes on the gate's runs (${c.checks.filter((k) => k.status !== 'pass').map((k) => `${k.id}: ${k.message}`).join(' | ')})`);
  const m = JSON.parse(B.wrap(JSON.stringify({ id: 'mg-t', game_json: x.game_json, authoring_json: x.authoring_json, score: { ...x.score, bounds: c.bounds, ranked: true } })));
  ok(m.score?.ranked === true && m.score.bounds.max === c.bounds.max, 'bundle: wrap puts the checked model on the manifest');
  console.log(`bundle score check: ${Date.now() - t0} ms (gate + check), bounds ${JSON.stringify(c.bounds)}`);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
