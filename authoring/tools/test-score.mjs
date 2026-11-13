#!/usr/bin/env node
// Tests for the score model and its checks, with no network:
//   1. expander/score.mjs: defaults, kinds, the contract's enums and units, format;
//   2. the expander and wrap carry the model (manifest.score, never game.json);
//   3. playtest/score-check.mjs on fake runs: a time trial, a farmable points game, a Krillion-style
//      tiered game and a calm no-fail game;
//   4. with a built engine (MG_ENGINE_DIR): the whole check through the real engine;
//   5. the committed Studio bundle (engine included): expand → gate → scoreCheck → wrap;
//   6. prompts: the score review and per-part repair, and parsing their replies;
//   7. the pipeline's score step through the bundle's compose, with a fake Muse.
// Usage: node authoring/tools/test-score.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as S from '../expander/score.mjs';
import * as P from '../expander/prompts.mjs';
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

{ // Spam against the median regular, with a margin (story agent, 2026-11-12: one noisy random reader failed 2 of 4 stories).
  const score = S.normalizeScore({ kind: 'points', events: ['ending_reached'] }).score;
  // story-like runs: pro 6025, random readers 1000 / 3050 / 2000 (median 2000), worst 0; range 0..6025
  const runs = [run('pro', 'success', 6025, 60), run('regular', 'success', 1000, 50), run('regular, seed 2', 'success', 3050, 55), run('regular, seed 3', 'success', 2000, 52), run('new player', 'success', 0, 40)];
  const spamAt = (v) => analyzeScore(score, runs, { idle: run('idle', 'timeout', 0, 180), spam: [{ ...run('spam tap', 'success', v, 45), input: 'tap at 180,400' }] });
  ok(status(spamAt(2000), 'spam') === 'warn', 'spam ties the median regular: warn');
  ok(status(spamAt(2500), 'spam') === 'warn', `spam edges the median by 500 of a 6025 range: warn (${spamAt(2500).find((c) => c.id === 'spam').message})`);
  ok(status(spamAt(3050), 'spam') === 'fail', 'spam beats the median by 1050 (17% of the range): fail');
  ok(status(spamAt(2900), 'spam') === 'fail' && /median regular player .*of 3/.test(spamAt(2900).find((c) => c.id === 'spam').message), 'the message names the median of 3');
  // the old rule compared one regular run: beating the lowest random reader (1000) is no longer a failure
  ok(status(spamAt(1500), 'spam') === 'pass', 'spam below the median passes even when it beats one random reader');
  const random = runs.map((r) => (r.bot.label.startsWith('regular') ? { ...r, bot: { label: r.bot.label.replace('regular', 'random') } } : r));
  ok(status(analyzeScore(score, random, { spam: [run('spam', 'success', 4000, 45)] }), 'spam') === 'fail', 'random-labelled readers count as the median too');
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

// ---------- 6. prompts ----------

{
  const parts = S.scoreParts(tide, { kind: 'points' });
  ok(parts.goal && parts.constraints && parts.end && parts.score.kind === 'points', 'scoreParts reads goal, constraints, end and score from a manifest');
  const spec = S.scoreParts({ spec: { goal: 'clear 20 orders', constraints: '60 s', end: 'timer or 20 orders', score: { kind: 'count_in_time' } } });
  ok(spec.goal === 'clear 20 orders' && spec.end === 'timer or 20 orders', 'scoreParts prefers a game-spec/1 spec');
  const u = P.scoreReview(parts, ['pro: lost after 61 s, 270'], [{ id: 'spam', status: 'pass', message: 'ok' }], 'shells at low tide');
  ok(/### goal/.test(u) && /### score/.test(u) && /pro: lost/.test(u) && /pass: spam/.test(u), 'the review prompt carries the parts, bot runs and checks');
  ok(/less time/.test(P.SCORE_REVIEW_SYSTEM) && !/fewer mistakes/.test(P.SCORE_REVIEW_SYSTEM), 'the review states the agreed tie_break values');
  ok(P.SCORE_REVIEW_OPTIONS.model === 'muse-wonder-1.0' && P.SCORE_REVIEW_OPTIONS.effort === 'high', 'the review asks for muse-wonder-1.0 at high effort');
  const r = P.repairPart('score', { kind: 'points' }, [{ problem: 'spam wins', fix: 'count orders' }], { goal: 'serve orders', constraints: '60 s', end: 'timer' });
  ok(/Fix the "score" part/.test(r) && /spam wins Fix: count orders/.test(r) && /### goal/.test(r) && !/### theme/.test(r), 'repairPart sends the part, its problems and only the parts it depends on');
  ok(P.parseScoreReview('```json\n{"ok": false, "issues": [{"part": "score", "problem": "farmable", "fix": "x"}]}\n```').issues[0].problem === 'farmable', 'parseScoreReview reads a fenced reply');
  ok(P.parseScoreReview('no verdict') === null, 'parseScoreReview returns null without a verdict');
  ok(P.parseScoreReview('{"ok": true, "issues": []}').ok === true, 'parseScoreReview ok');
}

// ---------- 7. the pipeline's score step (bundle compose, fake Muse) ----------

const lightsManifest = JSON.parse(readFileSync(join(authoringDir, 'games', 'lights_out.authoring.json'), 'utf8'));
async function composeWith(manifest, reply, args = {}) {
  const calls = [];
  const events = [];
  const ask = async (system, user, purpose, options) => {
    calls.push({ purpose, options: options ?? null, user });
    const r = reply(purpose, user);
    if (r instanceof Error) throw r;
    return { content: typeof r === 'string' ? r : JSON.stringify(r), model: 'fake', usage: { prompt_tokens: 1, completion_tokens: 1 } };
  };
  const out = JSON.parse(await B.compose(JSON.stringify({ request: 'test', brief: { intent: 'test' }, polish: false, ...args }), ask, (e) => events.push(e)));
  return { out, calls, events, purposes: calls.map((c) => c.purpose) };
}
const draftOr = (manifest, rest) => (purpose, user) => (/score/.test(purpose) ? rest(purpose, user) : manifest);
{
  const t0 = Date.now();
  // A fair game: the checks pass and the review agrees.
  const fair = await composeWith({ ...tide, score: { kind: 'points', unit: 'points', events: ['point'] } }, draftOr({ ...tide, score: { kind: 'points', unit: 'points', events: ['point'] } }, () => ({ ok: true, issues: [] })));
  ok(fair.out.manifest.score?.ranked === true && fair.out.manifest.score.bounds?.max > 0, `fair: ranked with bounds (${JSON.stringify(fair.out.manifest.score)})`);
  const rc = fair.calls.find((c) => c.purpose === 'score review');
  ok(rc && rc.options?.model === 'muse-wonder-1.0' && rc.options.effort === 'high', 'fair: the review went to muse-wonder-1.0 at high effort');
  ok(fair.events.some((e) => e.kind === 'score_checking' && e.summary === 'Checking the score is fair…'), 'fair: "Checking the score is fair…" event');
  ok(fair.events.some((e) => e.kind === 'score_checked' && /ranked board, highest first/.test(e.summary)), 'fair: score_checked says ranked');
  ok(fair.out.stats.calls.some((c) => c.purpose === 'score review' && typeof c.ms === 'number' && c.usage), 'fair: each Muse call is logged with time and usage');
  ok(fair.out.score?.ranked === true && fair.out.score.checks.length > 4, 'fair: the result carries the score report');

  // Lights out counting every run: the idle bot wins. The repair makes it finished-only.
  const lightsScore = { kind: 'points', events: ['tap_cell'] };
  const fixedScore = { kind: 'points', measures: 'lights out with the fewest moves', counts_when: 'finished', events: ['tap_cell'], unit: 'points' };
  const rep = await composeWith({ ...lightsManifest, score: lightsScore }, draftOr({ ...lightsManifest, score: lightsScore }, (p) => (p === 'score repair' ? { score: fixedScore } : { ok: true, issues: [] })));
  ok(rep.purposes.filter((p) => p === 'score repair').length === 1, `repair: exactly one score repair (${rep.purposes.join(', ')})`);
  ok(rep.purposes.indexOf('score repair') < rep.purposes.lastIndexOf('score review') || !rep.purposes.includes('score review'), 'repair: no review before the code checks pass');
  ok(rep.out.manifest.score?.counts_when === 'finished', 'repair: the repaired model ships');
  ok(JSON.parse(rep.out.manifest.content.authoring_json).score?.counts_when === 'finished', 'repair: the authoring manifest keeps the repaired score block');
  console.log(`lights_out after the repair: ranked ${rep.out.manifest.score?.ranked}${rep.out.score?.reason ? ` (${rep.out.score.reason})` : ''}`);
  ok(typeof rep.out.manifest.score?.ranked === 'boolean', `repair: ranked is decided (${rep.out.manifest.score?.ranked}; ${rep.out.score?.reason ?? 'no reason'})`);
  const repUser = rep.calls.find((c) => c.purpose === 'score repair')?.user ?? '';
  ok(/### goal/.test(repUser) && /### end/.test(repUser) && /Doing nothing/.test(repUser), 'repair: Muse saw the failing check and the parts it depends on');

  // Farmable and the repair doesn't help: unranked.
  const stuck = await composeWith({ ...lightsManifest, score: lightsScore }, draftOr({ ...lightsManifest, score: lightsScore }, (p) => (p === 'score repair' ? { score: lightsScore } : { ok: true, issues: [] })));
  ok(stuck.out.manifest.score?.ranked === false, 'still failing after one repair: ranked false');
  ok(stuck.events.some((e) => e.kind === 'score_checked' && /^Unranked board/.test(e.summary)), 'still failing: "Unranked board" event');
  ok(stuck.purposes.filter((p) => p === 'score repair').length === 1, 'still failing: at most one repair');

  // The review rejects a game the code checks pass; the repair is accepted on the second review.
  let reviews = 0;
  const rr = await composeWith({ ...tide, score: { kind: 'points', events: ['point'] } }, draftOr({ ...tide, score: { kind: 'points', events: ['point'] } }, (p) => {
    if (p === 'score repair') return { score: { kind: 'points', unit: 'shells', measures: 'shells tapped before the tide comes in', events: ['point'] } };
    reviews++;
    return reviews === 1 ? { ok: false, issues: [{ part: 'score', problem: 'The format says nothing about shells.', fix: 'format "{n} shells"' }] } : { ok: true, issues: [] };
  }));
  ok(rr.out.manifest.score?.ranked === true && rr.out.manifest.score.format === '{n} shells', 'review issue → repair → ranked with the new format');

  // Muse unreachable for the review: the code checks decide.
  const down = await composeWith({ ...tide, score: { kind: 'points', events: ['point'] } }, draftOr({ ...tide, score: { kind: 'points', events: ['point'] } }, () => new Error('Muse timed out')));
  ok(down.out.manifest.score?.ranked === true && down.out.score.review?.ok === null, 'review unreachable: a clean code check still ranks');

  // Calm, no fail: ranked false is honored without any checks.
  const calm = await composeWith({ ...tide, score: { ranked: false } }, draftOr({ ...tide, score: { ranked: false } }, () => { throw new Error('no call expected'); }));
  ok(calm.out.manifest.score?.ranked === false && !calm.purposes.some((p) => /score/.test(p)) && !calm.events.some((e) => e.kind === 'score_checking'), 'calm ranked:false: no checks, no Muse, unranked board');

  // No score block: nothing changes (no score on the manifest, no score events).
  const none = await composeWith(tide, draftOr(tide, () => { throw new Error('no call expected'); }));
  ok(!('score' in none.out.manifest) && !none.events.some((e) => /score/.test(e.kind)) && none.out.score === null, 'no score block: the pipeline is unchanged');

  // Opt-out.
  const off = await composeWith({ ...tide, score: { kind: 'points' } }, draftOr({ ...tide, score: { kind: 'points' } }, () => ({ ok: true, issues: [] })), { score_check: false });
  ok(!off.events.some((e) => /score/.test(e.kind)) && !off.purposes.some((p) => /score/.test(p)), 'score_check: false opts out');
  console.log(`pipeline score step: ${Math.round((Date.now() - t0) / 100) / 10} s for 8 composes`);
}

{ // Kevin32 fixes: no finisher means the bots can't judge; the review is capped; the plan's score wins over drift.
  const { verifyScore, BOTS_CANT_JUDGE } = await import('../expander/score-step.mjs');
  const { adoptSpecScore } = await import('../expander/pipeline.mjs');
  const expansion = (score) => ({ score_declared: true, score: S.normalizeScore(score).score, authoring: { score } });
  const studioWith = (checks) => ({ scoreCheck: async () => ({ ok: !checks.some((c) => c.status === 'fail'), checks, lines: [] }) });
  const calls = [];
  const call = async (sys, user, purpose) => { calls.push(purpose); return '{"ok": true, "issues": []}'; };
  const nf = await verifyScore({ expansion: expansion({ kind: 'time_to_complete', events: ['done'] }), gameJson: '{}' }, studioWith([{ id: 'finish', status: 'fail', message: 'no bot finished' }, { id: 'skill_order', status: 'pass', message: '' }]), { call });
  ok(nf.ranked === false && nf.reason === BOTS_CANT_JUDGE && nf.botsCantJudge && calls.length === 0, `no finisher: unranked "bots can't judge", no repair (${calls.join(', ')})`);
  const both = await verifyScore({ expansion: expansion({ kind: 'points', events: ['p'] }), gameJson: '{}' }, studioWith([{ id: 'finish', status: 'fail', message: '' }, { id: 'spam', status: 'fail', message: 'farmed' }]), { call: async (s, u, p) => { calls.push(p); return p === 'score repair' ? 'nope' : '{"ok": true}'; } });
  ok(!both.botsCantJudge && calls.includes('score repair'), 'a real score fault next to it still goes to repair');
  const t0 = Date.now();
  const hung = await verifyScore({ expansion: expansion({ kind: 'points', events: ['p'] }), gameJson: '{}' }, studioWith([{ id: 'skill_order', status: 'pass', message: '' }]), { call: () => new Promise(() => {}), reviewTimeoutMs: 50 });
  ok(Date.now() - t0 < 2000 && hung.review?.ok === null && /no answer/.test(hung.review.error) && hung.ranked === true, `a hung review gives up and the code checks decide (${Date.now() - t0} ms)`);
  ok(P.SCORE_REVIEW_OPTIONS.timeout_s === 60, 'the review options carry a 60 s timeout for callers');
  ok(/Keep counts_when "any" for points/.test(P.repairPart('score', { kind: 'points' }, ['x'])), 'repairPart keeps points games counting every run');
  // drift: the spec's kind with the game's own events when the spec's don't exist
  const game = { events: { combine_ok: {}, puzzle_solved: {} }, inputs: {} };
  const a = adoptSpecScore({ kind: 'count_in_time', measures: 'sets solved', events: ['set_solved'] }, game, ['puzzle_solved']);
  ok(a && a.score.kind === 'count_in_time' && a.block.events[0] === 'puzzle_solved', `adopt with fallback events: ${JSON.stringify(a?.block)}`);
  const kept = adoptSpecScore({ kind: 'count_in_time', events: ['puzzle_solved', 'nope'] }, game, ['combine_ok']);
  ok(kept.block.events.join() === 'puzzle_solved', 'the spec\'s events win when the game has them');
  // a repair can't move a score of the plan's kind to another kind (#17 rerun: points -> time_to_complete)
  const rc = [];
  const toTime = async (s, u, p) => { rc.push(p); return p === 'score repair' ? '{"score": {"kind": "time_to_complete", "measures": "ms to win", "unit": "ms", "direction": "lower", "counts_when": "finished", "format": "m:ss.t", "events": ["p"]}}' : '{"ok": false, "issues": [{"part": "score", "problem": "farmable", "fix": "use time"}]}'; };
  const st = await verifyScore({ expansion: expansion({ kind: 'points', events: ['p'] }), gameJson: '{"events": {"p": {}}}', spec: { score: { kind: 'points' } } }, studioWith([{ id: 'skill_order', status: 'pass', message: '' }]), { call: toTime });
  ok(st.model.kind === 'points' && !st.repaired && /kept the plan's points/.test(st.repairRejected ?? '') && rc.filter((p) => p === 'score review').length === 1, `the plan's kind survives a repair (${st.model.kind}, ${st.repairRejected})`);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
