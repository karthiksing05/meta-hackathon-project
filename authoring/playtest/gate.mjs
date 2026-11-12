// Bot playtest gate: a port of the beta app's StudioPlaytest (FacebookClone/Bubbles/Studio) for
// authored microgames. Generic bots (no per-game code) play the compiled game headless in the
// Rust/WASM engine; `analyze` turns the runs into blocking and non-blocking flags.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { loadEngine } from '../expander/engine.mjs';

const DT = 1000 / 60;
const LOOKAHEAD_STEPS = 45;
const MAX_TAP_TARGETS = 40;

export const DEFAULT_BOTS = [
  { label: 'new player', skill: 0.35, botSeed: 11, seedOffset: 0 },
  { label: 'regular', skill: 0.7, botSeed: 23, seedOffset: 0 },
  { label: 'pro', skill: 0.95, botSeed: 37, seedOffset: 0 },
  { label: 'regular, seed 2', skill: 0.7, botSeed: 41, seedOffset: 7 },
  { label: 'regular, seed 3', skill: 0.7, botSeed: 53, seedOffset: 13 },
];

const isTypical = (bot) => bot.label.startsWith('regular');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const asObject = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

export function gameObject(json) {
  return typeof json === 'string' ? JSON.parse(json) : json;
}

// ---------- action space ----------

function inputSources(game) {
  const keys = new Set();
  let swipes = false;
  let pointer = false;
  for (const input of Object.values(game.inputs ?? {})) {
    // An input with no key or swipe source is driven by the pointer (taps and drags).
    if (!(input.from ?? []).some((f) => f.key || f.swipe)) pointer = true;
    for (const from of input.from ?? []) {
      if (from.key) keys.add(from.key);
      if (from.swipe) swipes = true;
      if (!from.key && !from.swipe) pointer = true;
    }
  }
  // Arrow keys duplicate swipes in the usual four-way games; evaluating both only doubles the cost.
  const allArrows = [...keys].every((k) => k.startsWith('Arrow'));
  return { keys: swipes && allArrows ? [] : [...keys], swipes, pointer };
}

function tapAt(x, y) {
  return { kind: 'tap', x, y };
}

function candidatesFor(frame, sources, rng) {
  const out = [{ kind: 'noop' }];
  if (!sources.pointer) {
    for (const key of sources.keys) out.push({ kind: 'key', key });
    if (sources.swipes) for (const dir of ['left', 'right', 'up', 'down']) out.push({ kind: 'swipe', dir });
    return out;
  }
  const seen = [];
  let taps = [];
  for (const op of frame.ops ?? []) {
    if (op.op !== 'rect' && op.op !== 'circle') continue;
    const x = op.op === 'rect' ? op.x + op.w / 2 : op.x;
    const y = op.op === 'rect' ? op.y + op.h / 2 : op.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (seen.some(([sx, sy]) => Math.abs(sx - x) < 4 && Math.abs(sy - y) < 4)) continue;
    seen.push([x, y]);
    taps.push(tapAt(x, y));
  }
  if (taps.length > MAX_TAP_TARGETS) {
    const pool = taps.slice();
    taps = [];
    for (let i = 0; i < MAX_TAP_TARGETS; i++) taps.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  out.push(...taps);
  for (let i = 0; i < 7; i++) out.push(tapAt(((i + 0.5) / 7) * frame.width, 0.875 * frame.height));
  for (const key of sources.keys) out.push({ kind: 'key', key });
  if (sources.swipes) for (const dir of ['left', 'right', 'up', 'down']) out.push({ kind: 'swipe', dir });
  return out;
}

function apply(g, action) {
  switch (action.kind) {
    case 'tap':
      // Engine v0.1 hit-tests against the layout from the last frame() call, not the current
      // state. A real screen draws every frame, so refresh it before tapping (main game and probe
      // alike), or lookahead taps hit stale positions.
      g.frame();
      g.pointer('down', action.x, action.y);
      g.pointer('up', action.x, action.y);
      break;
    case 'key': g.key(action.key); break;
    case 'swipe': g.swipe(action.dir); break;
    default: break;
  }
}

// ---------- one run ----------

function playOne(engine, json, game, sources, bot, seed, maxSeconds) {
  const rng = mulberry32(bot.botSeed);
  const gameSeed = seed + bot.seedOffset;
  const errors = [];
  const note = (e) => { const m = String(e?.message ?? e); if (!errors.includes(m)) errors.push(m); };
  const base = bot.skill >= 0.9 ? 18 : bot.skill >= 0.6 ? 27 : 42;
  const maxSteps = Math.round((maxSeconds * 1000) / DT);

  let g = null;
  let probe = null;
  let steps = 0;
  let last = { phase: 'playing', score: 0, time_ms: 0 };
  const history = [];

  const value = (p) => {
    const st = p.status();
    if (st.phase === 'won') return 1e9 - st.time_ms;
    if (st.phase === 'lost') return -1e9 + st.time_ms;
    let progress;
    try { progress = asObject(p.state()).__progress; } catch { /* no state */ }
    return typeof progress === 'number' ? progress : st.score;
  };

  try {
    g = engine.load(json, gameSeed);
    probe = engine.load(json, gameSeed);
    let nextDecision = 0;
    while (steps < maxSteps && g.phase() === 'playing') {
      if (steps >= nextDecision) {
        const candidates = candidatesFor(asObject(g.frameJSON()), sources, rng);
        let choice;
        if (rng() < bot.skill) {
          let best = -Infinity;
          for (const cand of candidates) {
            probe.restart(gameSeed);
            let s = 0;
            for (const h of history) {
              while (s < h.step) { probe.step(DT); s++; }
              apply(probe, h.action);
            }
            while (s < steps) { probe.step(DT); s++; }
            apply(probe, cand);
            for (let i = 0; i < LOOKAHEAD_STEPS && probe.phase() === 'playing'; i++) probe.step(DT);
            const v = value(probe);
            if (v > best) { best = v; choice = cand; }
          }
        } else {
          choice = candidates[Math.floor(rng() * candidates.length)];
        }
        if (choice.kind !== 'noop') { apply(g, choice); history.push({ step: steps, action: choice }); }
        nextDecision = steps + Math.max(1, base + Math.round((rng() * 2 - 1) * base * 0.15));
      }
      g.step(DT);
      steps++;
    }
    last = g.status();
    for (const d of g.diagnostics() ?? []) if (d.severity === 'error') note(`${d.code ?? 'runtime'}: ${d.message}`);
  } catch (e) {
    note(e);
  } finally {
    try { g?.dispose(); } catch { /* ignore */ }
    try { probe?.dispose(); } catch { /* ignore */ }
  }

  const outcome = errors.length ? 'error' : last.phase === 'won' ? 'success' : last.phase === 'lost' ? 'fail' : 'timeout';
  return {
    bot,
    ok: errors.length === 0,
    error: errors.length ? errors.join('; ') : null,
    outcome,
    score: Math.round(last.score ?? 0),
    seconds: (last.time_ms ?? steps * DT) / 1000,
    // Enough to replay the run in the shell: same seed, same inputs at the same 60 Hz steps.
    replay: { seed: gameSeed, dt: DT, actions: history },
  };
}

// ---------- analysis ----------

function median(values) {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function analyze(runs, { maxSeconds = 180 } = {}) {
  const flags = [];
  const flag = (code, message, blocking) => flags.push({ code, message, blocking });
  const done = runs.filter((r) => r.ok);

  const broken = runs.find((r) => !r.ok);
  if (broken) flag('runtime_error', `The game crashed in a bot run: ${broken.error ?? 'unknown error'}. Check glue functions and params.`, true);
  if (!done.length) return flags;

  const med = median(done.map((r) => r.seconds));
  const scores = done.map((r) => r.score);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const timeouts = done.filter((r) => r.outcome === 'timeout');
  const fails = done.filter((r) => r.outcome === 'fail');
  const wins = done.filter((r) => r.outcome === 'success');
  const weak = done.find((r) => r.bot.label === 'new player');
  const regulars = done.filter((r) => isTypical(r.bot)).sort((a, b) => a.seconds - b.seconds);
  const regular = regulars.length ? regulars[regulars.length >> 1] : null;
  const pro = done.find((r) => r.bot.label === 'pro');
  const secs = (s) => Math.round(s);

  if (timeouts.length === done.length) {
    flag('never_ends', `Never ends: no bot run ended within ${maxSeconds} s. Make the challenge ramp up (or add a clear finish) so a run can be failed.`, true);
  } else if (med < 10 && med >= 6 && !fails.length && !timeouts.length) {
    flag('short', `Short: bots clear it in about ${secs(med)} s; people take longer.`, false);
  } else if (med < 10) {
    const isFail = fails.length * 2 >= done.length;
    flag('too_short', isFail
      ? `Too short and too hard: runs end after about ${secs(med)} s. A good game lasts 10–120 s; ease the start (slower speed, wider gaps, gentler gravity, more tries).`
      : `Too short: runs are over in about ${secs(med)} s. A good game lasts 10–120 s; add rounds, items or tries.`, true);
  }

  if (maxScore <= 0) flag('no_score', 'Nobody scored: every bot finished with 0 points. Check the score concept and that the content gives points.', true);

  if (pro && pro.outcome === 'fail' && pro.seconds < 8 && med >= 10) {
    flag('too_hard', `Too hard: even the strongest bot lost after ${secs(pro.seconds)} s.`, true);
  } else if (regular && regular.outcome === 'fail' && regular.seconds < 10 && med >= 10) {
    flag('too_hard', `Too hard: a typical player loses after ${secs(regular.seconds)} s. Ease the first seconds.`, true);
  }

  if (weak && weak.outcome !== 'fail' && timeouts.length !== done.length && !fails.length && done.length > 2 && minScore === maxScore) {
    flag('no_challenge', "Even the weakest bot got the top score without failing; skill doesn't show yet.", false);
  } else if (done.length > 2 && minScore === maxScore && maxScore > 0) {
    flag('flat', `Skill doesn't change the score (every bot scored ${maxScore}). Consider a twist that rewards good play.`, false);
  }

  const typicalTimedOut = regular?.outcome === 'timeout' && regulars.filter((r) => r.outcome === 'timeout').length * 2 > regulars.length;
  if (timeouts.length !== done.length && (typicalTimedOut || timeouts.length * 2 >= done.length)) {
    flag('too_easy', `Too easy: a typical player is still going after ${maxSeconds} s (${timeouts.length} of ${done.length} bots never failed). Make it ramp up (faster pace, tighter gaps, a timer) so runs end in 10–120 s.`, true);
  } else if (timeouts.length && timeouts.length !== done.length) {
    flag('long', `Long for strong players: the ${timeouts.map((r) => r.bot.label).join(', ')} bot was still going after ${maxSeconds} s.`, false);
  } else if (med > 120) {
    flag('long', `Long: runs take about ${secs(med)} s.`, false);
  }

  // Handoff rules: ends, can be lost, can be won or scored, lasts 10–120 s.
  if (!fails.length) flag('cant_lose', 'Can\'t be lost: no bot run ended in a loss.', true);
  if (!wins.length && maxScore <= 0) flag('no_win_or_score', 'No bot won or scored: it can\'t be won or scored.', true);
  if (med > 120) flag('too_long', `Too long: the median run is ${secs(med)} s; a good game lasts 10–120 s.`, true);

  return flags;
}

export function summarize(runs, maxSeconds = 180) {
  const done = runs.filter((r) => r.ok);
  if (!done.length) return 'No bot run finished';
  const scores = done.map((r) => r.score);
  const secs = done.map((r) => Math.round(r.seconds));
  const range = (a) => (Math.min(...a) === Math.max(...a) ? `${a[0]}` : `${Math.min(...a)}–${Math.max(...a)}`);
  const parts = [`${done.length} bots scored ${range(scores)} over ${range(secs)} s`];
  const count = (o) => done.filter((r) => r.outcome === o).length;
  const out = [];
  if (count('fail')) out.push(`${count('fail')} lost`);
  if (count('success')) out.push(`${count('success')} won`);
  if (count('timeout')) out.push(`${count('timeout')} still going at ${maxSeconds} s`);
  if (out.length) parts.push(out.join(', '));
  return parts.join(' · ');
}

export async function playtest(gameJson, { seed = 1, bots = DEFAULT_BOTS, maxSeconds = 180, inputsOf = gameObject } = {}) {
  const json = typeof gameJson === 'string' ? gameJson : JSON.stringify(gameJson);
  const sources = inputSources(inputsOf(json));
  // Each bot is independent and deterministic, so they run on parallel threads.
  const runs = await Promise.all(bots.map((bot) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { json, sources, bot, seed, maxSeconds } });
    worker.once('message', resolve);
    worker.once('error', reject);
  })));
  const flags = analyze(runs, { maxSeconds });
  return { runs, flags, passed: !flags.some((f) => f.blocking), summary: summarize(runs, maxSeconds) };
}

if (!isMainThread && workerData?.json) {
  const { engine } = await loadEngine();
  const { json, sources, bot, seed, maxSeconds } = workerData;
  parentPort.postMessage(playOne(engine, json, gameObject(json), sources, bot, seed, maxSeconds));
}
