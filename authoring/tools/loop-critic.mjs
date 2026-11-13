#!/usr/bin/env node
// Loop critic: how the game plays, read off the five-bot gate (authoring/playtest/gate.mjs, as
// authoring/artdir/finish.mjs runs it). No Muse calls. Each gate run is replayed in the engine, with the
// frame read every 50 ms, and measured against the bar in authoring/ARTDIR.md ("A great loop"):
//
//   cadence      median and p90 seconds between meaningful inputs (an input after which the state moves
//                away from an idle copy within 250 ms), and between feedback moments (a sound, toast, haptic, shake or
//                score change). Bar: an action every 1 to 3 s.
//   feedback     share of meaningful inputs answered within 0.3 s (drawn differently from an idle copy, or a
//                feedback moment; bar: 90 %), and
//                the share of all inputs that change the game.
//   fair end     the regular runs end (won or lost) rather than only on the time cap.
//   dead time    the longest stretch with no meaningful input and no feedback, and the longest with no
//                feedback at all. Bar: 6 s at most.
//   run length   seconds and end phase per bot. Bar: 45 to 120 s (median of the bots).
//   first action the first meaningful input and the first feedback (a proxy for "goal clear in 3 s").
//   skill spread best vs worst bot score; whether new player ≤ regular ≤ pro.
//   escalation   first third vs last third of each run: score per second, feedback per second, meaningful
//                inputs per second, and numeric state named like speed, level, difficulty, spawn, wave,
//                round, tier, rate (up) or interval, delay, gap, period, cooldown (down). Present when
//                any of them rises 15 % or more in most runs.
//   restart      wall-clock ms for the engine to restart the game and draw its first frame (the shell's
//                own cost isn't measured). Bar: under 2 s.
//
// Bots play at a fixed tempo (0.3 to 0.7 s a decision), so cadence measures how often an input matters,
// not how fast a person would tap.
//
// CLI: node authoring/tools/loop-critic.mjs <manifest-or-game.json> [--json] [--out <file>]
//        [--profile <gate profile>] [--max-seconds 120] [--seed 1]   (--key=value works too)
// Module: critique(gameOrManifest, {engine, runs, profile, maxSeconds, seed}) → {pass, warnings, issues, checks,
//         bots, gate}; summary(report) → the human summary.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../expander/engine.mjs';
import { playtest } from '../playtest/gate.mjs';
import { apply, isDeadInput, DT } from '../playtest/bots.mjs';

export const BAR = { goalS: 3, actionMinS: 1, actionMaxS: 3, deadMaxS: 6, runMinS: 45, runMaxS: 120, restartMaxMs: 2000, escalation: 0.15 };
const SAMPLE_STEPS = 3; // 50 ms
const WINDOW_STEPS = Math.round(250 / DT);
const FEEDBACK_WITHIN_S = 0.3;
const UP = /speed|level|difficulty|spawn|wave|round|tier|rate|stage|pace|heat|danger|combo|mult/i;
const DOWN = /interval|delay|gap|period|cooldown|every|wait|window/i;

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const gaps = (ts) => ts.slice(1).map((t, i) => t - ts[i]);
const longestGap = (ts, end) => { const pts = [0, ...ts, end].sort((a, b) => a - b); let m = 0, at = 0; for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] > m) { m = pts[i] - pts[i - 1]; at = pts[i - 1]; } return { s: m, at }; };

/** A path, manifest or game → the game object (and its gate profile, when the manifest names one). */
export function readGame(input) {
  let v = input;
  if (typeof v === 'string') v = JSON.parse(v.trim().startsWith('{') ? v : readFileSync(v, 'utf8'));
  const content = v?.content ?? null;
  let game = v;
  if (content?.game_json) game = typeof content.game_json === 'string' ? JSON.parse(content.game_json) : content.game_json;
  else if (v?.game_json) game = typeof v.game_json === 'string' ? JSON.parse(v.game_json) : v.game_json;
  else if (v?.game?.presentation) game = v.game;
  const profile = v?.gate_profile ?? content?.gate_profile ?? v?.catalog?.gate_profile ?? null;
  return { game, profile };
}

const numericState = (g) => {
  try {
    const st = g.state();
    const o = typeof st === 'string' ? JSON.parse(st) : st;
    const out = {};
    for (const [k, v] of Object.entries(o ?? {})) if (typeof v === 'number' && Number.isFinite(v) && (UP.test(k) || DOWN.test(k))) out[k] = v;
    return out;
  } catch { return {}; }
};

/** Replays one gate run and returns its timeline: meaningful inputs, feedback moments, state samples. */
export function timeline(engine, json, run, { maxSeconds = 120 } = {}) {
  const seed = run.replay?.seed ?? 1;
  const actions = run.replay?.actions ?? [];
  const g = engine.load(json, seed);
  const inputs = [], meaningful = [], seen = [], feedback = [], samples = [];
  let step = 0, ai = 0, lastScore = 0;
  const maxSteps = Math.round((maxSeconds * 1000) / DT);
  try {
    g.frameJSON(); // drain the intro's sounds
    while (step < maxSteps && g.phase() === 'playing') {
      while (ai < actions.length && actions[ai].step <= step) {
        const a = actions[ai++].action;
        const t = (step * DT) / 1000;
        inputs.push(t);
        // Meaningful: against an idle fork taken before the input, the state moves within 250 ms
        // (inputs are read on the next step; a reveal may follow a beat later).
        let idle = null, probe = null, changed = false;
        try {
          idle = g.fork();
          apply(g, a);
          probe = g.fork();
          let i = 0;
          for (; i < WINDOW_STEPS && !changed; i++) { probe.step(DT); idle.step(DT); if (probe.stateHash() !== idle.stateHash()) changed = true; }
          // Seen: the drawn ops differ from the idle copy's by 0.3 s (a sprite moved, a tile lit).
          if (changed) {
            // transitions tween on drawn frames, so both copies draw every 50 ms like the shell
            for (; i < Math.round((FEEDBACK_WITHIN_S * 1000) / DT); i++) { probe.step(DT); idle.step(DT); if (i % SAMPLE_STEPS === SAMPLE_STEPS - 1) { probe.frameJSON(); idle.frameJSON(); } }
            const ops = (x) => JSON.stringify(x.frameJSON().ops);
            if (ops(probe) !== ops(idle)) seen.push(t);
          }
        } catch {
          changed = isDeadInput(g, a) === false;
        } finally {
          try { idle?.dispose(); } catch { /* ignore */ }
          try { probe?.dispose(); } catch { /* ignore */ }
        }
        if (changed) meaningful.push(t);
      }
      g.step(DT);
      step++;
      if (step % SAMPLE_STEPS === 0 || g.phase() !== 'playing') {
        const t = (step * DT) / 1000;
        const f = g.frameJSON();
        const st = g.status();
        const score = st.score ?? 0;
        const fb = (f.audio?.length ?? 0) > 0 || (f.toasts?.length ?? 0) > 0 || (f.haptics?.length ?? 0) > 0 || (f.shake?.px ?? f.shake ?? 0) > 0 || score !== lastScore;
        if (fb) feedback.push(t);
        samples.push({ t, score, state: numericState(g) });
        lastScore = score;
      }
    }
    const st = g.status();
    return { seconds: (st.time_ms ?? step * DT) / 1000, phase: st.phase, score: st.score ?? 0, inputs, meaningful, seen, feedback, samples };
  } finally {
    try { g.dispose(); } catch { /* ignore */ }
  }
}

/** First third vs last third: which measures rise. */
function escalation(tl) {
  const T = tl.seconds;
  if (T < 6) return { measured: false, rises: [] };
  const a = T / 3, b = (2 * T) / 3;
  const rate = (ts, lo, hi) => ts.filter((t) => t >= lo && t < hi).length / (hi - lo);
  const scoreAt = (t) => { let s = 0; for (const x of tl.samples) { if (x.t > t) break; s = x.score; } return s; };
  const rows = [
    { name: 'score per second', first: scoreAt(a) / a, last: (scoreAt(T + 1) - scoreAt(b)) / (T - b) },
    { name: 'feedback per second', first: rate(tl.feedback, 0, a), last: rate(tl.feedback, b, T + 0.01) },
    { name: 'meaningful inputs per second', first: rate(tl.meaningful, 0, a), last: rate(tl.meaningful, b, T + 0.01) },
  ];
  const keys = new Set(tl.samples.flatMap((x) => Object.keys(x.state)));
  for (const k of keys) {
    const mean = (lo, hi) => { const v = tl.samples.filter((x) => x.t >= lo && x.t < hi && k in x.state).map((x) => x.state[k]); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };
    const first = mean(0, a), last = mean(b, T + 1);
    if (first == null || last == null) continue;
    rows.push(DOWN.test(k) && !UP.test(k) ? { name: `state ${k} (falls)`, first: -first, last: -last, raw: [first, last] } : { name: `state ${k}`, first, last });
  }
  const rises = rows.filter((r) => r.last > r.first + Math.abs(r.first) * BAR.escalation && r.last - r.first > 1e-6).map((r) => r.name);
  return { measured: true, rises, rows: rows.map((r) => ({ name: r.name, first: r2(r.raw ? r.raw[0] : r.first), last: r2(r.raw ? r.raw[1] : r.last) })) };
}

const grade = (ok) => (ok ? 'pass' : 'warn');

/**
 * Critique a game's loop. opts: {engine, runs (the gate's runs, else the gate is run), profile,
 * maxSeconds = 120, seed = 1}. Returns {pass, warnings, checks: {name: {status, value, bar, note}}, bots, gate}.
 */
export async function critique(input, opts = {}) {
  const { game, profile: p0 } = readGame(input);
  const profile = opts.profile ?? p0 ?? null;
  const maxSeconds = opts.maxSeconds ?? 120;
  const engine = opts.engine ?? (await loadEngine()).engine;
  const json = JSON.stringify(game);
  let gate = null, runs = opts.runs;
  if (!runs) {
    gate = await playtest(json, { seed: opts.seed ?? 1, maxSeconds, profile });
    runs = gate.runs;
  }
  const bots = runs.filter((r) => r?.replay).map((r) => {
    const tl = timeline(engine, json, r, { maxSeconds });
    const esc = escalation(tl);
    const dead = longestGap([...tl.meaningful, ...tl.feedback], tl.seconds);
    const quiet = longestGap(tl.feedback, tl.seconds);
    return {
      bot: r.bot?.label ?? '?', skill: r.bot?.skill ?? null, seconds: r2(tl.seconds), end: tl.phase, score: r2(tl.score),
      inputs: tl.inputs.length, meaningful: tl.meaningful.length, feedback: tl.feedback.length,
      // share of inputs that change the game within 250 ms; share of those answered within 300 ms by
      // something drawn differently or a sound, toast, haptic, shake or score change
      changeShare: tl.inputs.length ? r2(tl.meaningful.length / tl.inputs.length) : null,
      answeredShare: tl.meaningful.length ? r2(tl.meaningful.filter((t) => tl.seen.includes(t) || tl.feedback.some((f) => f >= t && f <= t + FEEDBACK_WITHIN_S)).length / tl.meaningful.length) : null,
      firstActionS: r2(tl.meaningful[0] ?? null), firstFeedbackS: r2(tl.feedback[0] ?? null),
      actionGapS: { median: r2(median(gaps(tl.meaningful))), p90: r2(pct(gaps(tl.meaningful), 0.9)) },
      feedbackGapS: { median: r2(median(gaps(tl.feedback))), p90: r2(pct(gaps(tl.feedback), 0.9)) },
      deadTimeS: r2(dead.s), deadAtS: r2(dead.at), quietS: r2(quiet.s), quietAtS: r2(quiet.at),
      escalation: esc,
    };
  });

  // restart: engine cost to restart and draw (the shell's own cost isn't measured)
  let restartMs = null;
  try {
    const g = engine.load(json, 1);
    for (let i = 0; i < 60; i++) g.step(DT);
    const t0 = performance.now();
    g.restart(1); g.frameJSON();
    restartMs = r2(performance.now() - t0);
    g.dispose();
  } catch { /* not measurable */ }

  const all = (k) => bots.map((b) => b[k]).filter((v) => v != null);
  const typical = bots.filter((b) => /^regular/.test(b.bot));
  const pool = typical.length ? typical : bots;
  const cadence = median(pool.map((b) => b.actionGapS.median).filter((v) => v != null));
  const cadenceP90 = median(pool.map((b) => b.actionGapS.p90).filter((v) => v != null));
  const fbCadence = median(pool.map((b) => b.feedbackGapS.median).filter((v) => v != null));
  const deadMax = Math.max(0, ...all('deadTimeS'));
  const answered = median(all('answeredShare'));
  const runLen = median(pool.map((b) => b.seconds));
  const firstAction = median(all('firstActionS'));
  const scores = bots.map((b) => b.score);
  const by = (re) => bots.find((b) => re.test(b.bot));
  const nw = by(/^new/), pro = by(/^pro/), reg = median(typical.map((b) => b.score));
  const spread = scores.length ? Math.max(...scores) - Math.min(...scores) : 0;
  const ordered = nw && pro ? nw.score <= (reg ?? nw.score) && (reg ?? pro.score) <= pro.score && pro.score > nw.score : null;
  const escRuns = bots.filter((b) => b.escalation.measured);
  const escCount = escRuns.filter((b) => b.escalation.rises.length).length;
  const riseNames = [...new Set(escRuns.flatMap((b) => b.escalation.rises))];

  const checks = {
    goal: { status: grade(firstAction != null && firstAction <= BAR.goalS), value: r2(firstAction), bar: `first meaningful input within ${BAR.goalS} s (proxy for the goal being clear)` },
    cadence: { status: grade(cadence != null && cadence <= BAR.actionMaxS && (cadenceP90 ?? 0) <= BAR.actionMaxS * 2), value: { medianS: r2(cadence), p90S: r2(cadenceP90), feedbackMedianS: r2(fbCadence) }, bar: `a meaningful input every ${BAR.actionMinS}-${BAR.actionMaxS} s (median at most ${BAR.actionMaxS} s, p90 within ${BAR.actionMaxS * 2} s; faster is noted, not warned)`, note: cadence != null && cadence < BAR.actionMinS ? 'inputs matter more often than once a second: fine for an action game' : undefined },
    feedback: { status: grade(answered == null || answered >= 0.9), value: { answeredShare: answered, changeShare: median(all('changeShare')) }, bar: 'every meaningful input answered within 0.3 s by a visible change, sound, toast, haptic, shake or score change (90 %+)' },
    fairEnd: { status: grade(!(typical.length && typical.every((b) => b.end === 'playing'))), value: typical.map((b) => b.end), bar: 'the regular runs end (won or lost), not only on the cap' },
    deadTime: { status: grade(deadMax <= BAR.deadMaxS), value: r2(deadMax), bar: `no stretch over ${BAR.deadMaxS} s without a meaningful input or feedback` },
    runLength: { status: grade(runLen != null && runLen >= BAR.runMinS && runLen <= BAR.runMaxS), value: r2(runLen), bar: `${BAR.runMinS}-${BAR.runMaxS} s (median of the regular bots)` },
    skillSpread: { status: grade(spread > 0 && ordered !== false), value: { best: Math.max(...scores), worst: Math.min(...scores), newPlayer: nw?.score ?? null, regular: r2(reg), pro: pro?.score ?? null, ordered }, bar: 'scores differ and new player ≤ regular ≤ pro' },
    escalation: { status: grade(escRuns.length > 0 && escCount * 2 > escRuns.length), value: { runs: `${escCount}/${escRuns.length}`, rises: riseNames }, bar: `something rises ${Math.round(BAR.escalation * 100)} %+ from the first third to the last in most runs` },
    restart: { status: restartMs == null ? 'n/a' : grade(restartMs < BAR.restartMaxMs), value: restartMs, bar: `engine restart + first frame under ${BAR.restartMaxMs} ms (shell not measured)` },
  };
  for (const c of Object.values(checks)) if (c.note === undefined) delete c.note;
  const warnings = Object.entries(checks).filter(([, c]) => c.status === 'warn').map(([k]) => k);
  return {
    pass: warnings.length === 0, warnings, issues: warnings.map((k) => `${k}: ${JSON.stringify(checks[k].value)} (bar: ${checks[k].bar})`), checks, bots,
    gate: gate ? { passed: gate.passed, profile: gate.profile, blocking: gate.flags.filter((f) => f.blocking).map((f) => f.code) } : null,
  };
}

/** A short human summary. */
export function summary(r, title = '') {
  const L = [`Loop check${title ? ` — ${title}` : ''}: ${r.pass ? 'PASS' : `WARN (${r.warnings.join(', ')})`}${r.gate ? `; gate ${r.gate.passed ? 'passed' : `failed: ${r.gate.blocking.join(', ')}`}` : ''}`];
  const c = r.checks;
  const tag = (x) => (x.status === 'pass' ? 'ok  ' : x.status === 'warn' ? 'WARN' : 'n/a ');
  L.push(`  ${tag(c.goal)} goal: first meaningful input at ${c.goal.value ?? '–'} s`);
  L.push(`  ${tag(c.cadence)} cadence: input every ${c.cadence.value.medianS ?? '–'} s (p90 ${c.cadence.value.p90S ?? '–'}), feedback every ${c.cadence.value.feedbackMedianS ?? '–'} s`);
  L.push(`  ${tag(c.feedback)} feedback: ${c.feedback.value.answeredShare ?? '–'} of meaningful inputs answered; ${c.feedback.value.changeShare ?? '–'} of inputs change the game`);
  L.push(`  ${tag(c.fairEnd)} fair end: regular runs end ${c.fairEnd.value.join(', ')}`);
  L.push(`  ${tag(c.deadTime)} dead time: longest ${c.deadTime.value} s`);
  L.push(`  ${tag(c.runLength)} run length: ${c.runLength.value} s (${r.bots.map((b) => `${b.bot} ${b.seconds}s ${b.end}`).join('; ')})`);
  const s = c.skillSpread.value;
  L.push(`  ${tag(c.skillSpread)} skill spread: new ${s.newPlayer} / regular ${s.regular} / pro ${s.pro} (best ${s.best}, worst ${s.worst})`);
  L.push(`  ${tag(c.escalation)} escalation: ${c.escalation.value.runs} runs rise${c.escalation.value.rises.length ? ` (${c.escalation.value.rises.join(', ')})` : ''}`);
  L.push(`  ${tag(c.restart)} restart: ${c.restart.value ?? '–'} ms`);
  return L.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const VALUED = ['profile', 'max-seconds', 'seed', 'out'];
  const opt = (k) => { const eq = args.find((a) => a.startsWith(`--${k}=`)); if (eq) return eq.split('=').slice(1).join('='); const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.includes(args[i - 1].replace(/^--/, ''))));
  if (!files.length) { console.error('usage: node authoring/tools/loop-critic.mjs <manifest-or-game.json>... [--json] [--out=<file>] [--profile=<p>] [--max-seconds=120]'); process.exit(2); }
  const results = {};
  for (const f of files) {
    const r = await critique(f, { profile: opt('profile') ?? null, maxSeconds: Number(opt('max-seconds') ?? 120), seed: Number(opt('seed') ?? 1) });
    results[f] = r;
    if (!args.includes('--json')) console.log(summary(r, f.split('/').slice(-2).join('/')));
  }
  const out = files.length === 1 ? results[files[0]] : results;
  if (args.includes('--json')) console.log(JSON.stringify(out, null, 2));
  if (opt('out')) writeFileSync(opt('out'), JSON.stringify(out, null, 2));
}
