// The score check (docs/HARNESS_V2.md "Score verification", step 2): deterministic checks, run after
// the bot gate, that a game's score model (expander/score.mjs) gives a fair, rankable board.
//
//   - skill order: pro ≥ regular ≥ new player in the score's direction (new player above pro fails);
//   - an idle bot (no input) ranks no better than the bots that play;
//   - a spam bot (one input, repeated ten times a second) doesn't beat the regular bot;
//   - no run beats a declared `bounds.max_rate_per_s`;
//   - the finish rule: finished-only models have a finished bot run, and unfinished runs don't count;
//   - every gate run, replayed from its input log, gives the same phase, time and score (and, where
//     the engine has `verify` (main's fair-challenges engine), its own log replays as valid);
//   - the score changes only on `score.events` (checked on an instrumented copy of the game);
//   - scores are whole numbers (accuracy 0–100);
//   - `bounds` are recorded from all the runs, with headroom, for the server.
//
// Each check is pass, warn (ambiguous: the Muse review decides) or fail. Pure: the caller passes the
// engine in (Node: expander/engine.mjs; the Studio page: MicrogameEngine), and it yields to the host
// between runs, so it works in both. Bayan's bots.mjs gives the action space; nothing here changes it.

import { DT, inputSources, candidatesFor, apply, asObject, gameObject, mulberry32 } from './bots.mjs';
import { yieldToHost } from './gate-async.mjs';
import { runValue, runCounts, compareRuns, formatScore } from '../expander/score.mjs';

export const SPAM_EVERY_STEPS = 6; // ten inputs a second
export const MAX_SPAM_INPUTS = 8;
export const HEADROOM = 0.5;

const statusOf = (g) => asObject(g.status());

/** A run in the gate's shape: {bot, ok, error, outcome, score, seconds, time_ms, raw_score, log?}. */
function finishRun(g, bot, steps, errors, extra = {}) {
  let last = { phase: 'playing', score: 0, time_ms: steps * DT };
  try { last = statusOf(g); } catch (e) { errors.push(String(e?.message ?? e)); }
  try { for (const d of g.diagnostics() ?? []) if (d.severity === 'error') errors.push(`${d.code ?? 'runtime'}: ${d.message}`); } catch { /* ignore */ }
  const outcome = errors.length ? 'error' : last.phase === 'won' ? 'success' : last.phase === 'lost' ? 'fail' : 'timeout';
  return {
    bot, ok: !errors.length, error: errors.length ? errors.join('; ') : null, outcome,
    score: Math.round(last.score ?? 0), raw_score: last.score ?? 0,
    seconds: (last.time_ms ?? steps * DT) / 1000, time_ms: Math.round(last.time_ms ?? steps * DT), phase: last.phase, ...extra,
  };
}

/** Plays with a fixed policy: `act(step)` returns an action or null. Keeps the engine log when it has one. */
async function playPolicy(engine, json, seed, bot, act, maxSeconds, sliceMs = 12) {
  const errors = [];
  const maxSteps = Math.round((maxSeconds * 1000) / DT);
  let g = null, steps = 0, run;
  try {
    g = engine.load(json, seed);
    let t0 = Date.now();
    while (steps < maxSteps && g.phase() === 'playing') {
      const a = act(steps, g);
      if (a) apply(g, a);
      g.step(DT);
      steps++;
      if (Date.now() - t0 >= sliceMs) { await yieldToHost(); t0 = Date.now(); }
    }
    let log = null;
    try { if (typeof g.log === 'function') log = g.log(); } catch { /* engine without logs */ }
    run = finishRun(g, bot, steps, errors, { log });
  } catch (e) {
    errors.push(String(e?.message ?? e));
    run = { bot, ok: false, error: errors.join('; '), outcome: 'error', score: 0, raw_score: 0, seconds: steps * DT / 1000, time_ms: Math.round(steps * DT) };
  } finally {
    try { g?.dispose(); } catch { /* ignore */ }
  }
  return run;
}

/** The single inputs a spam bot tries: every key and swipe, the hit targets, the middle and the bottom. */
export function spamInputs(engine, json, seed) {
  const g = engine.load(json, seed);
  try {
    const sources = inputSources(gameObject(json));
    const frame = asObject(g.frameJSON());
    const all = candidatesFor(frame, sources, mulberry32(5), typeof g.hitTargets === 'function' ? g.hitTargets() : null).filter((c) => c.kind !== 'noop');
    if (sources.pointer) all.push({ kind: 'tap', x: (frame.width ?? 360) / 2, y: (frame.height ?? 640) / 2 });
    const seen = new Set();
    const out = [];
    // Keys and swipes first (few), then taps spread through the list.
    const ordered = [...all.filter((c) => c.kind !== 'tap'), ...all.filter((c) => c.kind === 'tap')];
    for (const c of ordered) {
      const k = JSON.stringify(c.kind === 'tap' ? { t: Math.round(c.x / 8), u: Math.round(c.y / 8) } : c);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    if (out.length <= MAX_SPAM_INPUTS) return out;
    const step = out.length / MAX_SPAM_INPUTS;
    return Array.from({ length: MAX_SPAM_INPUTS }, (_, i) => out[Math.floor(i * step)]);
  } finally {
    g.dispose();
  }
}

/** Replays a gate run ({replay: {seed, dt, actions: [{step, action}]}}) step for step. */
export async function replayRun(engine, json, run, maxSeconds, { onStep } = {}) {
  const r = run.replay;
  const actions = (r.actions ?? []).slice().sort((a, b) => a.step - b.step);
  const maxSteps = Math.round((maxSeconds * 1000) / (r.dt ?? DT));
  const errors = [];
  let g = null, steps = 0, i = 0, out;
  try {
    g = engine.load(json, r.seed);
    let t0 = Date.now();
    while (steps < maxSteps && g.phase() === 'playing') {
      while (i < actions.length && actions[i].step <= steps) { apply(g, actions[i].action); i++; }
      g.step(r.dt ?? DT);
      steps++;
      if (onStep) onStep(g, steps);
      if (Date.now() - t0 >= 12) { await yieldToHost(); t0 = Date.now(); }
    }
    let log = null;
    try { if (typeof g.log === 'function') log = g.log(); } catch { /* ignore */ }
    out = finishRun(g, run.bot, steps, errors, { log });
  } catch (e) {
    out = { ok: false, error: String(e?.message ?? e), outcome: 'error', score: 0, seconds: 0, time_ms: 0 };
  } finally {
    try { g?.dispose(); } catch { /* ignore */ }
  }
  return out;
}

/**
 * A copy of the game that stamps the game time (`now`) into hidden state whenever a listed event or
 * input fires, so a replay can tell whether a score change had one of them behind it.
 */
export function instrumentEvents(gameJson, events) {
  const game = typeof gameJson === 'string' ? JSON.parse(gameJson) : structuredCloneSafe(gameJson);
  const names = events.filter((e) => e !== 'tick');
  game.state = { ...(game.state ?? {}), __score_mark: { type: 'float', init: '-1.0' } };
  game.rules = [...(game.rules ?? []), ...names.map((name, i) => ({ id: `__score_ev_${i}`, on: name, do: [{ set: '__score_mark', to: 'now * 1.0' }] }))];
  return JSON.stringify(game);
}

function structuredCloneSafe(v) { return JSON.parse(JSON.stringify(v)); }

const label = (r) => r.bot?.label ?? 'bot';
const cmpSec = (r) => `${Math.round(Number(r.seconds ?? 0) * 10) / 10} s`;

/** One line per run, for the Muse review and the Studio log. */
export function runLine(score, r) {
  const counts = runCounts(score, r);
  return `${label(r)}: ${r.outcome === 'success' ? 'won' : r.outcome === 'fail' ? 'lost' : r.outcome === 'timeout' ? 'still going' : 'crashed'} after ${cmpSec(r)}, ${formatScore(runValue(score, r), score.format)}${counts ? '' : ' (doesn\'t count)'}`;
}

/** The bounds the server enforces, from every run that counts, with headroom (whole numbers). */
export function recordBounds(score, runs) {
  const counted = runs.filter((r) => runCounts(score, r));
  if (!counted.length) return null;
  const values = counted.map((r) => runValue(score, r));
  const lo = Math.min(...values), hi = Math.max(...values);
  const bounds = score.direction === 'lower'
    ? { min: Math.max(0, Math.floor(lo * (1 - HEADROOM))), max: Math.ceil(hi * (1 + HEADROOM)) + 1 }
    : { min: Math.min(0, Math.floor(lo * (1 + HEADROOM))), max: Math.ceil(Math.max(hi, 0) * (1 + HEADROOM)) + 1 };
  if (score.kind === 'accuracy') { bounds.min = Math.max(0, bounds.min); bounds.max = Math.min(100, bounds.max); }
  if (score.source !== 'time') {
    const rate = Math.max(0, ...counted.map((r) => Math.abs(runValue(score, r)) / Math.max(1, Number(r.seconds ?? 0))));
    bounds.max_rate_per_s = Math.ceil(rate * (1 + HEADROOM) * 100) / 100 || 0;
  }
  return bounds;
}

/**
 * Pure analysis of runs (no engine): the skill, idle, spam, rate, finish and number checks.
 * runs: the gate's runs; extra: {idle, spam: [runs]}. Returns a list of {id, status, message}.
 */
export function analyzeScore(score, runs, { idle = null, spam = [] } = {}) {
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });
  const ok = runs.filter((r) => r.ok !== false);
  const find = (l) => ok.find((r) => label(r) === l);
  const regulars = ok.filter((r) => label(r).startsWith('regular')).sort((a, b) => compareRuns(score, a, b));
  const regular = regulars.length ? regulars[regulars.length >> 1] : null;
  const pro = find('pro'), weak = find('new player');
  const better = (a, b) => compareRuns(score, a, b) > 0;
  const fmt = (r) => (runCounts(score, r) ? formatScore(runValue(score, r), score.format) : `${formatScore(runValue(score, r), score.format)}, not counted`);

  // Finish rule.
  if (score.counts_when === 'finished') {
    const finished = ok.filter((r) => r.outcome === 'success');
    if (!finished.length) add('finish', 'fail', 'Only finished runs count, but no bot finished a run, so the board would stay empty.');
    else add('finish', 'pass', `${finished.length} of ${ok.length} bot runs finished; the others don't count.`);
  } else add('finish', 'pass', 'Every run counts.');

  // Skill order.
  if (pro && weak) {
    if (better(weak, pro)) add('skill_order', 'fail', `The new player (${fmt(weak)}) ranks above the pro (${fmt(pro)}): the score doesn't reward skill.`);
    else if ((regular && (better(weak, regular) || better(regular, pro)))) add('skill_order', 'warn', `Skill order isn't clean: new player ${fmt(weak)}, regular ${fmt(regular)}, pro ${fmt(pro)}.`);
    else if (ok.every((r) => compareRuns(score, r, pro) === 0)) add('skill_order', 'warn', `Every bot ranks the same (${fmt(pro)}); skill doesn't show on the board.`);
    else add('skill_order', 'pass', `Pro ${fmt(pro)} ≥ regular ${regular ? fmt(regular) : '–'} ≥ new player ${fmt(weak)}.`);
  } else add('skill_order', 'warn', 'The pro or new-player run is missing, so skill order is unchecked.');

  // Idle.
  if (idle) {
    if (idle.ok === false) add('idle', 'warn', `The idle run crashed: ${idle.error}`);
    else if (regular && better(idle, regular)) add('idle', 'fail', `Doing nothing (${fmt(idle)}) ranks above a regular player (${fmt(regular)}).`);
    else if (weak && better(idle, weak)) add('idle', 'warn', `Doing nothing (${fmt(idle)}) ranks above the new player (${fmt(weak)}).`);
    else add('idle', 'pass', `Doing nothing ranks lowest (${fmt(idle)}).`);
  }

  // Spam.
  const spamOk = spam.filter((r) => r.ok !== false);
  if (spamOk.length) {
    const best = spamOk.slice().sort((a, b) => compareRuns(score, b, a))[0];
    const what = best.input ? ` (${best.input})` : '';
    if (regular && better(best, regular)) add('spam', 'fail', `Repeating one input${what} (${fmt(best)}) beats a regular player (${fmt(regular)}): the score can be farmed.`);
    else if (regular && runCounts(score, best) && compareRuns(score, best, regular) === 0 && runValue(score, best) !== 0) add('spam', 'warn', `Repeating one input${what} ties a regular player (${fmt(best)}).`);
    else add('spam', 'pass', `Repeating one input scores at most ${fmt(best)}.`);
  }

  // Rate.
  const all = [...ok, ...(idle && idle.ok !== false ? [idle] : []), ...spamOk];
  const cap = score.bounds?.max_rate_per_s;
  if (typeof cap === 'number' && score.source !== 'time') {
    const fast = all.filter((r) => Math.abs(runValue(score, r)) / Math.max(1, Number(r.seconds ?? 0)) > cap);
    if (fast.length) add('rate', 'fail', `${fast.map(label).join(', ')} scored faster than the stated ${cap} per second.`);
    else add('rate', 'pass', `No run beats ${cap} per second.`);
  }

  // Whole numbers.
  const frac = all.filter((r) => typeof r.raw_score === 'number' && score.source !== 'time' && !Number.isInteger(r.raw_score));
  if (frac.length) add('integer', 'warn', `The engine score isn't a whole number (${frac[0].raw_score}); boards round it. Use whole points.`);
  if (score.kind === 'accuracy') {
    const out = all.filter((r) => runValue(score, r) < 0 || runValue(score, r) > 100);
    if (out.length) add('integer', 'fail', `Accuracy must be a whole percent from 0 to 100; ${label(out[0])} got ${runValue(score, out[0])}.`);
  }
  return checks;
}

/**
 * The whole check. engine: a loaded engine; gameJson: the game as gated (text); runs: the gate's
 * runs with `replay`; score: the normalized model. options: {seed = 1, maxSeconds = 180, spam = true}.
 * Returns {ok, ambiguous, checks, bounds, lines, runs: {idle, spam}}.
 */
export async function checkScore(engine, gameJson, runs, score, { seed = 1, maxSeconds = 180, spam: doSpam = true } = {}) {
  const json = typeof gameJson === 'string' ? gameJson : JSON.stringify(gameJson);
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });

  const idleBot = { label: 'idle', skill: 0 };
  const idle = await playPolicy(engine, json, seed, idleBot, () => null, maxSeconds);
  const spamRuns = [];
  if (doSpam) {
    let inputs = [];
    try { inputs = spamInputs(engine, json, seed); } catch { /* no inputs */ }
    for (const input of inputs) {
      const desc = input.kind === 'tap' ? `tap at ${Math.round(input.x)},${Math.round(input.y)}` : input.kind === 'key' ? `key ${input.key}` : `swipe ${input.dir}`;
      const r = await playPolicy(engine, json, seed, { label: `spam ${desc}`, skill: 0 }, (s) => (s % SPAM_EVERY_STEPS === 0 ? input : null), maxSeconds);
      r.input = desc;
      spamRuns.push(r);
    }
  }
  checks.push(...analyzeScore(score, runs, { idle, spam: spamRuns }));

  // Replays: the score, phase and time re-derived from each gate run's inputs match what it reported.
  const replayable = runs.filter((r) => r.ok !== false && r.replay);
  const mismatches = [];
  const canVerify = typeof engine.verify === 'function';
  let verified = 0;
  const verifyProblems = [];
  for (const r of replayable) {
    const again = await replayRun(engine, json, r, maxSeconds);
    if (again.outcome !== r.outcome || Math.round(again.score) !== Math.round(r.score) || Math.abs(again.seconds - r.seconds) > 0.05) {
      mismatches.push(`${label(r)}: reported ${r.outcome} ${r.score} at ${cmpSec(r)}, replay gives ${again.outcome} ${again.score} at ${cmpSec(again)}`);
    }
    if (canVerify && again.log) {
      const v = engine.verify(json, again.log);
      if (v?.ok) verified++;
      else verifyProblems.push(`${label(r)}: ${(v?.problems ?? ['not verified']).join('; ')}`);
    }
  }
  for (const r of [idle, ...spamRuns]) {
    if (!canVerify || !r.log || r.ok === false) continue;
    const v = engine.verify(json, r.log);
    if (v?.ok) verified++;
    else verifyProblems.push(`${label(r)}: ${(v?.problems ?? ['not verified']).join('; ')}`);
  }
  if (!replayable.length) add('replay', 'warn', 'No gate run carried its inputs, so replays are unchecked.');
  else if (mismatches.length) add('replay', 'fail', `Replaying a run gives a different result: ${mismatches[0]}.`);
  else if (verifyProblems.length) add('replay', 'fail', `The engine's replay check rejects a run: ${verifyProblems[0]}.`);
  else add('replay', 'pass', `${replayable.length} runs replay to the same phase, time and score${canVerify ? `; the engine verified ${verified} logs` : ''}.`);

  // Score events.
  if (score.source === 'time') add('events', 'pass', 'The score is the run time.');
  else if (!score.events?.length) add('events', 'warn', 'score.events is empty, so nothing says what changes the score.');
  else if (score.events.includes('tick')) add('events', 'pass', 'The score may change every tick.');
  else {
    let instrumented;
    try { instrumented = instrumentEvents(json, score.events); } catch (e) { instrumented = null; add('events', 'warn', `Couldn't instrument the events: ${e?.message ?? e}`); }
    if (instrumented) {
      const strays = [];
      for (const r of replayable) {
        let prevScore = null, prevTime = 0;
        try {
          const again = await replayRun(engine, instrumented, r, maxSeconds, {
            onStep: (g) => {
              const st = statusOf(g);
              // The first step is the baseline: a score expression can start above 0 (1000 - moves * 20).
              if (prevScore !== null && st.score !== prevScore) {
                const mark = Number(asObject(g.state()).__score_mark ?? -1);
                if (!(mark >= prevTime)) strays.push(`${label(r)} at ${Math.round(st.time_ms / 100) / 10} s (${prevScore} → ${st.score})`);
              }
              prevScore = st.score;
              prevTime = st.time_ms;
            },
          });
          if (again.ok === false) strays.push(`${label(r)}: the instrumented replay failed (${again.error})`);
        } catch (e) { strays.push(`${label(r)}: ${e?.message ?? e}`); }
        if (strays.length) break;
      }
      if (strays.length) add('events', 'fail', `The score changed with none of ${score.events.join(', ')} firing: ${strays[0]}.`);
      else add('events', 'pass', `The score changes only on ${score.events.join(', ')}.`);
    }
  }

  const allRuns = [...runs.filter((r) => r.ok !== false), ...(idle.ok !== false ? [idle] : []), ...spamRuns.filter((r) => r.ok !== false)];
  const bounds = recordBounds(score, allRuns);
  const fails = checks.filter((c) => c.status === 'fail');
  const warns = checks.filter((c) => c.status === 'warn');
  const lines = [...runs.filter((r) => r.ok !== false), idle, ...spamRuns].map((r) => runLine(score, r));
  return {
    ok: !fails.length,
    ambiguous: !fails.length && warns.length > 0,
    checks,
    bounds,
    lines,
    runs: { idle: strip(idle), spam: spamRuns.map(strip) },
  };
}

const strip = (r) => ({ label: label(r), input: r.input ?? null, outcome: r.outcome, score: r.score, seconds: Math.round(Number(r.seconds ?? 0) * 10) / 10, error: r.error ?? null });
