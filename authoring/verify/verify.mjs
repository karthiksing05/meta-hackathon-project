// The verifier: runs every registered check on a built game and returns one report.
//
//   report = {pass, score, blocking, warnings, findings: [{code, severity: 'block' | 'warn', node,
//             frame, message, hint, ...}], byCode, coverage, checks: {ran, skipped}, ms}
//
// Frames come from a dense replay of the bot runs (frames.mjs): a capture every 100 ms of every run,
// the intro, every end state (won, lost, timeout) and an idle run. Text widths are measured in Chrome
// for every text op of every frame; backdrop pixels (contrast) for up to `pixelFrames` frames (all
// intro and end frames, the rest spread evenly), the shapes-only estimate elsewhere.
//
// `verifyAndFix` is the whole flow: verify, code fixes (layout-fix.mjs), verify, the layout solver
// (solve.mjs) as the last resort, verify, and a proof that rules and replays are unchanged.
//
// CLI: node authoring/verify/verify.mjs <manifest-or-game.json>... [--fix] [--out=<dir>]
//      [--runs=<runs.json>] [--every=6] [--max-seconds=120] [--pixel-frames=160] [--no-pixels] [--json]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadEngine } from '../expander/engine.mjs';
import { readBuilt } from '../playtest/requirements-check.mjs';
import { apply, isDeadInput } from '../playtest/bots.mjs';
import { loadChecks, allChecks } from './registry.mjs';
import { sampleDense, atFrame } from './frames.mjs';

export { register, allCodes, codeInfo } from './registry.mjs';

/** A path, manifest, {authoring, game} pair or bare game → {game, built}. */
export function readInput(input) {
  let v = input;
  if (typeof v === 'string') v = JSON.parse(v.trim().startsWith('{') ? v : readFileSync(v, 'utf8'));
  if (v?.content?.game_json || v?.game) { const built = readBuilt(v); return { game: built.game, built }; }
  return { game: v, built: { manifest: null, authoring: {}, game: v } };
}

// ---------------------------------------------------------------- Chrome measures ----

/**
 * Real text widths for every text op in every frame, and backdrop pixel samples for a spread of
 * frames. Widths are kept per line at size 100 in `cache` (a Map the caller may share between runs:
 * width scales with size, so a resized label needs no new measurement). With `pixels: false` only
 * lines missing from the cache are measured (one quick Chrome launch, no art). Returns
 * {measures, pixelFrames, error}.
 */
export async function measureFrames(sample, { pixels = null, pixelFrames = 160, cache = new Map() } = {}) {
  const { chromeAvailable, renderFrames } = await import('../playtest/frame-render.mjs');
  if (!chromeAvailable()) return { measures: null, pixelFrames: 0, error: 'no Chrome' };
  const retry = (fn) => {
    let err;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return fn(); } catch (e) { err = e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500 * (attempt + 1)); }
    }
    throw err;
  };
  const lineKey = (o, line) => `${o.font ?? ''}|${o.weight ?? 400}|${line}`;
  const linesOf = (o) => String(o.text).split('\n');
  let picked = [];
  if (pixels !== false) {
    const keyFrames = sample.frames.filter((f) => f.label !== 'play');
    const play = sample.frames.filter((f) => f.label === 'play');
    const room = Math.max(0, pixelFrames - keyFrames.length);
    picked = [...keyFrames, ...(play.length <= room ? play : Array.from({ length: room }, (_, k) => play[Math.floor((k * play.length) / room)]))];
  }
  // Lines to measure: every line not in the cache, as one synthetic frame per 400 lines at size 100.
  const todo = new Map();
  for (const f of sample.frames) for (const o of f.frame.ops) {
    if (o.op !== 'text' || !o.text) continue;
    for (const line of linesOf(o)) { const k = lineKey(o, line); if (!cache.has(k) && !todo.has(k)) todo.set(k, { ...o, text: line, size: 100, line_height: 125, x: 0, y: 0, w: 4000, h: 130, scale: 1 }); }
  }
  const extra = [...todo.entries()];
  const synth = [];
  for (let k = 0; k < extra.length; k += 400) synth.push(extra.slice(k, k + 400));
  const measures = {};
  let error = null;
  // One Chrome launch (launches are the slow, flaky part).
  if (picked.length || synth.length) {
    try {
      const out = retry(() => renderFrames([
        ...picked.map((f) => ({ ...f.frame, png: false })),
        ...synth.map((ops) => ({ width: 360, height: 640, background: '#FFFFFF', ops: ops.map(([, o]) => o) })),
      ], picked.length ? sample.assets : [], { budgetMs: 30000 }));
      picked.forEach((f, j) => { measures[f.key] = out[j].texts; });
      synth.forEach((ops, j) => { for (const t of out[picked.length + j].texts) cache.set(ops[t.i][0], t.widths[0]); });
    } catch (e) { error = String(e.message ?? e).slice(0, 200); }
  }
  for (const f of sample.frames) {
    if (measures[f.key]) continue;
    measures[f.key] = f.frame.ops.map((o, i) => {
      if (o.op !== 'text' || !o.text) return null;
      const ws = linesOf(o).map((line) => cache.get(lineKey(o, line)));
      return ws.every((w) => w != null) ? { i, widths: ws.map((w) => (w * o.size) / 100), samples: null } : null;
    }).filter(Boolean);
  }
  return { measures, pixelFrames: error ? 0 : picked.length, error };
}

// ---------------------------------------------------------------- the run ----

/** One finding per code and node: frames summed, the other nodes involved listed, worst kept first. */
export function mergeByNode(findings) {
  const seen = new Map();
  const out = [];
  for (const f of findings) {
    if (!f.node) { out.push(f); continue; }
    const k = `${f.code}|${f.node}`;
    const p = seen.get(k);
    if (!p) { seen.set(k, f); out.push(f); continue; }
    p.frames = (p.frames ?? 1) + (f.frames ?? 1);
    if (f.severity === 'block' && p.severity !== 'block') { p.severity = 'block'; p.message = f.message; p.frame = f.frame; }
    if (f.contrast != null && (p.contrast == null || f.contrast < p.contrast)) { p.contrast = f.contrast; p.backdrop = f.backdrop; p.backdrop_spread = f.backdrop_spread; }
    if (f.other && f.other !== p.other) p.others = [...new Set([...(p.others ?? []), f.other])];
  }
  findings.length = 0;
  findings.push(...out);
  return findings;
}

export function summarizeFindings(findings) {
  const byCode = {};
  let blocking = 0, warnings = 0;
  for (const f of findings) {
    const c = (byCode[f.code] ??= { block: 0, warn: 0 });
    c[f.severity === 'block' ? 'block' : 'warn']++;
    if (f.severity === 'block') blocking++; else warnings++;
  }
  return { blocking, warnings, byCode, score: Math.max(0, 100 - 10 * blocking - 2 * warnings), pass: blocking === 0 };
}

/**
 * Verifies a built game. opts: {runs (the gate's runs), ref (reference game for tap remapping),
 * every, maxSeconds, pixels, pixelFrames, requirements, trace, only: [check ids], engine, sample}.
 */
export async function verify(input, opts = {}) {
  const t0 = Date.now();
  const { game, built } = readInput(input);
  await loadChecks();
  const engine = opts.engine ?? (await loadEngine()).engine;
  const sample = opts.sample ?? (await sampleDense(game, { runs: opts.runs ?? null, ref: opts.ref ?? null, every: opts.every ?? 6, maxSeconds: opts.maxSeconds ?? 120, engine }));
  const { measures, pixelFrames, error } = opts.measures !== undefined ? { measures: opts.measures, pixelFrames: 0, error: null } : await measureFrames(sample, { pixels: opts.pixels ?? null, pixelFrames: opts.pixelFrames ?? 160, cache: opts.widthCache ?? new Map() });
  const probeTap = (f, x, y) => {
    if (f.label !== 'play' && f.label !== 'intro') return false; // a finished game takes no input
    try { return atFrame(engine, sample.replayCtx, f, (g) => { g.frame(); const d = isDeadInput(g, { kind: 'tap', x, y }); return d == null ? null : !d; }); } catch { return null; }
  };
  const ctx = { game, built, sample, measures, engine, probeTap, requirements: opts.requirements ?? null, trace: opts.trace ?? null };
  const have = { frames: true, game: true, built: !!built?.manifest || !!built?.authoring, requirements: Array.isArray(opts.requirements) && opts.requirements.length > 0 };
  const findings = [];
  const ran = [], skipped = [];
  for (const c of allChecks()) {
    if (opts.only && !opts.only.includes(c.id)) continue;
    const missing = (c.needs ?? []).filter((n) => !have[n]);
    if (missing.length || (c.available && !(await c.available()))) { skipped.push({ id: c.id, why: missing.length ? `needs ${missing.join(', ')}` : 'module not installed' }); continue; }
    try { findings.push(...(await c.run(ctx))); ran.push(c.id); } catch (e) { skipped.push({ id: c.id, why: `crashed: ${String(e.message ?? e).slice(0, 160)}` }); }
  }
  mergeByNode(findings);
  findings.sort((a, b) => (a.severity === b.severity ? a.code.localeCompare(b.code) : a.severity === 'block' ? -1 : 1));
  const sum = summarizeFindings(findings);
  const report = {
    ...sum, findings,
    coverage: { ...sample.coverage, pixelFrames, measured: !!measures, measureError: error, tagged: sample.tagged },
    checks: { ran, skipped }, ms: Date.now() - t0,
  };
  // The solver reads the frames behind the findings; kept off the JSON.
  Object.defineProperty(report, '_sample', { value: sample, enumerable: false });
  Object.defineProperty(report, '_measures', { value: measures, enumerable: false });
  return report;
}

/**
 * The flow before the gate: look → verify → code fixes → verify → layout solver → verify → proof.
 * Returns {game, report (final), stages: [{stage, blocking, warnings, byCode}], fixes, proof}.
 * Pass a manifest or {game, authoring} (not a bare game) so the look checks hold the game to its art.type.
 * opts.budgetMs (default 75000; 0 for none): past it, no new stage or solver move starts; the game so far is
 * re-verified, proved and returned with report.truncated = true. opts.readability false skips that stage.
 */
export async function verifyAndFix(input, opts = {}) {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 75000;
  let truncated = false;
  // Checked only at safe points: between stages, between solver moves.
  const over = () => { if (!truncated && budgetMs > 0 && Date.now() - started > budgetMs) truncated = true; return truncated; };
  const { game: original, built: built0 } = readInput(input);
  // Every verify sees the game with its manifest and authoring (the look checks read art.type from them).
  const hasBuilt = !!built0?.manifest || Object.keys(built0?.authoring ?? {}).length > 0;
  const withBuilt = (g) => (hasBuilt ? { manifest: built0.manifest, authoring: built0.authoring, game: g } : g);
  const engine = opts.engine ?? (await loadEngine()).engine;
  const { fixLayout } = await import('../expander/layout-fix.mjs');
  const { solveLayout } = await import('./solve.mjs');
  const { proveUnchanged } = await import('./prove.mjs');
  const stages = [];
  const note = (stage, r) => stages.push({ stage, blocking: r.blocking, warnings: r.warnings, byCode: r.byCode });
  const v = (g) => verify(withBuilt(g), { ...opts, engine, ref: g === original ? null : original });
  let game = original;
  const fixes = [];
  // The look stage (kit/look.mjs lookFix): every text node on the game's own fonts, scale and palette,
  // before anything is measured. Presentation only, so the proof covers it like the other fixes.
  // The motion stage (motion-fix.mjs): one subtle shake, capped pulses, fixed HUD slots, fades
  // instead of pops, the reveal cleared before the next labels. First, so the look stage dresses
  // anything it adds. Presentation only; the proof covers it.
  if (opts.motion !== false) {
    try {
      const { sampleMotion } = await import('./motion-track.mjs');
      const { motionFindings } = await import('./motion.mjs');
      const { motionFix } = await import('./motion-fix.mjs');
      for (let round = 0; round < 2 && !over(); round++) {
        const ms = await sampleMotion(game, { runs: opts.runs ?? null, engine, maxSeconds: 60 });
        const f = motionFindings(game, ms).filter((x) => x.severity === 'block');
        if (!f.length) break;
        const r = motionFix(game, f, { msample: ms, lookId: built0?.authoring?.look?.id ?? null });
        if (!r.fixes.length) break;
        try { engine.load(JSON.stringify(r.game), 1).dispose(); } catch (e) { stages.push({ stage: 'motion', error: `fix rejected by the engine: ${String(e?.message ?? e).slice(0, 160)}` }); break; }
        game = r.game;
        fixes.push(...r.fixes.map((x) => ({ stage: 'motion', ...x })));
      }
    } catch (e) {
      stages.push({ stage: 'motion', error: String(e?.message ?? e).slice(0, 200) });
    }
  }
  let lookSpec = null;
  if (opts.look !== false) {
    try {
      const { lookForBuilt, lookFix } = await import('../kit/look.mjs');
      const { spec } = lookForBuilt({ ...built0, game: original });
      lookSpec = spec;
      const r = lookFix(game, spec);
      if (r.changed || r.tokens?.length) { game = r.game; fixes.push({ stage: 'look', changed: r.changed, tokens: r.tokens ?? [] }); }
    } catch (e) {
      stages.push({ stage: 'look', error: String(e?.message ?? e).slice(0, 200) });
    }
  }
  // The readability stage (kit/readability.mjs): text over busy or low-contrast pixels gets a plate, an
  // outline or a recolour from the look, judged on frames rasterised in code (no Chrome). Up to 2 rounds;
  // presentation only, so the proof covers it.
  if (opts.readability !== false) {
    try {
      const { readabilityFindings, readabilityFix } = await import('../kit/readability.mjs');
      const { inflateSync } = await import('node:zlib');
      const inflate = (b) => new Uint8Array(inflateSync(b));
      // Stray and off-look panels first (FC-10), so the words on a repainted card are re-inked against it.
      const { strayShapes } = await import('./checks/shapes.mjs');
      const { hudReadabilityFindings } = await import('./checks/hud.mjs');
      const shaped = (await import('../expander/layout-fix.mjs')).fixShapes(game, strayShapes(game, await sampleDense(game, { engine, maxSeconds: opts.maxSeconds ?? 120, ref: original })));
      if (shaped.fixes.length) { game = shaped.game; fixes.push(...shaped.fixes.map((x) => ({ stage: 'readability', ...x }))); }
      for (let round = 0; round < 2 && !over(); round++) {
        const sample = await sampleDense(game, { engine, maxSeconds: opts.maxSeconds ?? 120, ref: original });
        const f = [...readabilityFindings(game, sample, { inflate }), ...hudReadabilityFindings(game, sample, { inflate })];
        if (!f.length) break;
        const r = readabilityFix(game, f, { spec: lookSpec });
        if (!r.fixes?.length) break;
        game = r.game;
        fixes.push(...r.fixes.map((x) => ({ stage: 'readability', ...x })));
      }
    } catch (e) {
      stages.push({ stage: 'readability', error: String(e?.message ?? e).slice(0, 200) });
    }
  }
  // The text-fit stage (checks/textfit.mjs): every text inside the canvas margin, its panel or button
  // and clear of other text, with the longest string of every content pool. Shrinks on the game's
  // scale, then wraps. Up to 2 rounds, each kept only if the findings fall; presentation only.
  if (opts.textFit !== false) {
    try {
      const { textFitFindings, textFitFix } = await import('./checks/textfit.mjs');
      let sizes = null;
      if (lookSpec) { const { specSizes } = await import('../kit/look.mjs'); sizes = [...specSizes(lookSpec)]; }
      const count = async (g) => (await textFitFindings(g, await sampleDense(g, { engine, maxSeconds: 40, every: 12, ref: original }), { engine })).findings;
      let cur = await count(game);
      for (let round = 0; round < 2 && cur.length && !over(); round++) {
        const r = textFitFix(game, cur, { sizes });
        if (!r.fixes.length) break;
        try { engine.load(JSON.stringify(r.game), 1).dispose(); } catch (e) { stages.push({ stage: 'text-fit', error: `fix rejected by the engine: ${String(e?.message ?? e).slice(0, 160)}` }); break; }
        const next = await count(r.game);
        if (next.length >= cur.length) break;
        game = r.game; cur = next;
        fixes.push(...r.fixes.map((x) => ({ stage: 'text-fit', ...x })));
      }
    } catch (e) {
      stages.push({ stage: 'text-fit', error: String(e?.message ?? e).slice(0, 200) });
    }
  }
  let report = await v(game);
  note('built', report);
  if ((!report.pass || opts.always) && !over()) {
    const fixed = await fixLayout(game, { engine, pixels: opts.pixels ?? null });
    if (fixed.fixes.length) {
      const r2 = await v(fixed.game);
      // Keep the code fixes unless they made blocking findings worse.
      if (r2.blocking <= report.blocking) { game = fixed.game; report = r2; fixes.push(...fixed.fixes.map((f) => ({ stage: 'code', ...f }))); }
      note('code fixes', r2);
    }
  }
  // The solver, move by move: each move is kept only if blocking findings fall. A move that trades
  // one finding for another (a stack turned into a column now overlaps a label) gets one look-ahead:
  // kept if a follow-up move from the solver then brings the count down.
  const { setAt } = await import('./solve.mjs');
  const inner = { ...opts, pixels: false, widthCache: opts.widthCache ?? new Map() };
  const vi = (g) => verify(withBuilt(g), { ...inner, engine, ref: original });
  const withMove = (g, m) => { const c = JSON.parse(JSON.stringify(g)); setAt(c, m.node, JSON.parse(JSON.stringify(m.patch))); return c; };
  const related = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
  const keep = (list) => fixes.push(...list.map(({ patch: _p, ...x }) => ({ stage: 'solver', ...x })));
  // Outlines only raise contrast and draw nothing new: applied straight from the pixel-measured
  // report (the inner loop doesn't sample pixels, so it can't see them help).
  const outlines = async (rep) => {
    const list = (await solveLayout(game, rep, { engine })).moves.filter((m) => m.kind === 'outline');
    for (const m of list) game = withMove(game, m);
    keep(list);
    return list.length;
  };
  if (report.blocking && !over()) await outlines(report);
  let cur = report.blocking && !over() ? await vi(game) : report;
  for (let round = 0; round < (opts.solverRounds ?? 3) && cur.blocking && !over(); round++) {
    // Round one also sees the pixel-measured findings of the full report.
    const { moves } = await solveLayout(game, round === 0 && report.blocking >= cur.blocking ? report : cur, { engine });
    const touched = [];
    let kept = 0;
    for (const m of moves.filter((x) => x.kind !== 'outline').slice(0, opts.maxMoves ?? 16)) {
      if (over()) break;
      if (touched.some((t) => related(t, m.node))) continue;
      const g2 = withMove(game, m);
      const r2 = await vi(g2);
      let accept = r2.blocking < cur.blocking ? { g: g2, r: r2, list: [m] } : null;
      if (!accept && r2.blocking === cur.blocking) {
        for (const m2 of (await solveLayout(g2, r2, { engine })).moves.slice(0, 4)) {
          if (over()) break;
          const g3 = withMove(g2, m2);
          const r3 = await vi(g3);
          if (r3.blocking < cur.blocking) { accept = { g: g3, r: r3, list: [m, m2] }; break; }
        }
      }
      if (!accept) continue;
      game = accept.g; cur = accept.r; kept++;
      touched.push(...accept.list.map((x) => x.node));
      keep(accept.list);
    }
    stages.push({ stage: `solver ${round + 1}`, blocking: cur.blocking, warnings: cur.warnings, byCode: cur.byCode, moves: kept });
    if (!kept) break;
  }
  if (fixes.some((f) => f.stage === 'solver')) { report = await v(game); note('final', report); }
  // The pixel-measured report can still show what the inner loop couldn't see (contrast on art,
  // widths in frames it measured itself): one more pass judged by the full verifier.
  if (report.blocking && (opts.finalPass ?? true) && !over()) {
    let changed = (await outlines(report)) > 0;
    if (changed) report = await v(game);
    for (const m of (await solveLayout(game, report, { engine })).moves.filter((x) => x.kind !== 'outline').slice(0, 4)) {
      const g2 = withMove(game, m);
      const r2 = await v(g2);
      if (r2.blocking < report.blocking) { game = g2; report = r2; keep([m]); changed = true; }
    }
    if (changed) note('final pass', report);
  }
  const proof = game === original ? { rules: true, replays: true, note: 'unchanged' } : await proveUnchanged(original, game, { engine, runs: opts.runs ?? null });
  if (!proof.rules || !proof.replays) {
    // A fix that changes play is not a layout fix: ship the original, with its findings.
    const back = await v(original);
    if (truncated) back.truncated = true;
    return { game: original, report: back, stages, fixes: [], proof, reverted: true };
  }
  if (truncated) { report.truncated = true; stages.push({ stage: 'truncated', budgetMs, ms: Date.now() - started }); }
  return { game, report, stages, fixes, proof };
}

// ---------------------------------------------------------------- CLI ----

function printReport(file, r) {
  console.log(`${file}: ${r.pass ? 'PASS' : 'FAIL'} ${r.blocking} blocking, ${r.warnings} warnings, score ${r.score} (${r.coverage.unique}/${r.coverage.captured} frames, ${r.coverage.pixelFrames} with pixels, ends ${JSON.stringify(r.coverage.endStates)}, ${r.ms} ms)`);
  for (const f of r.findings) console.log(`  ${f.severity === 'block' ? 'B' : 'w'} ${f.code} ${f.node ?? '-'} ${f.frame ?? ''} ×${f.frames ?? 1}: ${f.message}`);
  if (r.checks.skipped.length) console.log(`  skipped: ${r.checks.skipped.map((s) => `${s.id} (${s.why})`).join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const files = args.filter((a) => !a.startsWith('--'));
  const runsFile = opt('runs');
  const runsByFile = runsFile ? JSON.parse(readFileSync(runsFile, 'utf8')) : null;
  const out = opt('out');
  if (out) mkdirSync(out, { recursive: true });
  const base = { every: opt('every') ? +opt('every') : undefined, maxSeconds: opt('max-seconds') ? +opt('max-seconds') : undefined, pixelFrames: opt('pixel-frames') ? +opt('pixel-frames') : undefined, pixels: args.includes('--no-pixels') ? false : null };
  let failed = 0;
  for (const file of files) {
    const runs = runsByFile ? (Array.isArray(runsByFile) ? runsByFile : runsByFile[file] ?? runsByFile[basename(file)] ?? null) : null;
    if (args.includes('--fix')) {
      const res = await verifyAndFix(file, { ...base, runs });
      if (args.includes('--json')) console.log(JSON.stringify({ file, ...res, game: undefined }));
      else { printReport(file, res.report); console.log(`  stages: ${res.stages.map((s) => `${s.stage} ${s.blocking}`).join(' → ')}; ${res.fixes.length} fixes; proof ${JSON.stringify({ rules: res.proof.rules, replays: res.proof.replays })}`); }
      if (out) writeFileSync(join(out, basename(file)), JSON.stringify(res.game));
      if (!res.report.pass) failed++;
    } else {
      const r = await verify(file, { ...base, runs });
      if (args.includes('--json')) console.log(JSON.stringify({ file, ...r }));
      else printReport(file, r);
      if (!r.pass) failed++;
    }
  }
  process.exit(failed ? 1 : 0);
}
