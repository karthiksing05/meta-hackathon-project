#!/usr/bin/env node
// Strips of frames around a game's transitions, drawn as a player sees them: the engine's ops with
// the shell's shake offset and toast floats added (motion-track.mjs `SHELL`), one frame every 50 ms.
//
//   node authoring/verify/motion-strips.mjs <manifest-or-game.json> --out <dir> [--runs runs.json]
//        [--every 3] [--frames 14] [--scale 0.5] [--moments name@s,...] [--name n] [--shell old|new]
// `--shell new` draws toasts, shake and pulses the way the current runtime does (bubble-kit-microgame.js);
// `old` (the default) the way builds up to 1d2a374 did.
//
// Picks the windows itself: each kind of moment once (the first right answer, the first wrong one,
// the first shake, the first toast, the end), starting 100 ms before it. Writes <dir>/<name>-<moment>.png
// (one strip each) and <dir>/<name>-sheet.png (every 250 ms of the longest run). Needs MG_ENGINE_DIR
// and Chrome.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../expander/engine.mjs';
import { DT, apply } from '../playtest/bots.mjs';
import { renderFrames, CHROME } from '../playtest/frame-render.mjs';
import { randomRuns } from './frames.mjs';
import { readInput } from './verify.mjs';
import { toastOp } from './motion-track.mjs';
import { createRequire } from 'node:module';

/** The app runtime's motion helpers (bubble-kit-microgame.js), loaded headless. */
let runtimeMotion = null;
export function shellMotion() {
  if (runtimeMotion) return runtimeMotion;
  const require = createRequire(import.meta.url);
  const { load } = require('../../tools/runtime-tests/load.js');
  runtimeMotion = load().Bubble.microgameMotion;
  return runtimeMotion;
}

/** Deterministic shake offsets (the shell's are random; any spread of that amplitude looks alike). */
function jitter(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 2 ** 32) * 2 - 1; }; }

/** Shifts every op by (dx, dy) (the shell's whole-canvas shake). */
function shifted(op, dx, dy) {
  const o = { ...op };
  for (const k of ['x', 'x1', 'x2']) if (typeof o[k] === 'number') o[k] += dx;
  for (const k of ['y', 'y1', 'y2']) if (typeof o[k] === 'number') o[k] += dy;
  if (Array.isArray(o.points)) o.points = o.points.map((p) => (Array.isArray(p) ? [p[0] + dx, p[1] + dy] : p));
  return o;
}

/**
 * Replays one run and returns full frames (with shell effects) every `every` steps:
 * [{t, frame, shake, toasts}]. `ink` colours the toast text.
 */
export function playFrames(engine, json, run, { every = 3, maxSeconds = 120, tailMs = 1200, ink = '#FFFFFF', shell = 'old' } = {}) {
  if (shell === 'new') return playFramesNew(engine, json, run, { every, maxSeconds, tailMs });
  const g = engine.load(json, run.seed);
  const out = [];
  const live = [];
  const rnd = jitter(run.seed * 31 + 7);
  let step = 0, k = 0, endAt = null;
  const maxSteps = Math.round((maxSeconds * 1000) / DT);
  try {
    while (step < maxSteps) {
      const playing = g.phase() === 'playing';
      if (!playing && endAt == null) endAt = step;
      if (endAt != null && (step - endAt) * DT >= tailMs) break;
      while (playing && k < run.actions.length && run.actions[k].step === step) { apply(g, run.actions[k].action); k++; }
      g.step(DT);
      step++;
      if (step % every) continue;
      const f = g.frameJSON();
      const t = Math.round(step * DT);
      for (const x of f.toasts ?? []) live.push({ text: x.text, at: t });
      const shake = typeof f.shake === 'number' ? f.shake : f.shake?.px ?? 0;
      const dx = shake > 0.05 ? rnd() * shake : 0, dy = shake > 0.05 ? rnd() * shake : 0;
      const ops = f.ops.map((o) => (dx || dy ? shifted(o, dx, dy) : o));
      for (const x of live) {
        const op = toastOp(x.text, t - x.at, f.width, f.height);
        if (op) ops.push({ ...op, color: ink, font: 'Inter', line_height: op.size * 1.25, rotation: 0, stroke: '#00000099', stroke_width: 2 });
      }
      out.push({ t, frame: { ...f, ops }, shake, toasts: (f.toasts ?? []).map((x) => x.text), inputs: run.actions.filter((a) => Math.round(a.step * DT) > t - every * DT && Math.round(a.step * DT) <= t).length });
    }
  } finally { g.dispose(); }
  return { frames: out, endAt: endAt == null ? null : Math.round(endAt * DT) };
}

/**
 * The same, as the current runtime draws it (bubble-kit-microgame.js motion helpers): toasts in a free
 * lane, fading in place; one capped shake per moment, art only, after input; text pulses capped.
 */
function playFramesNew(engine, json, run, { every = 3, maxSeconds = 120, tailMs = 1200 } = {}) {
  const MM = shellMotion();
  const g = engine.load(json, run.seed);
  const out = [];
  const rnd = jitter(run.seed * 31 + 7);
  const sh = { prev: 0, start: null, amp: 0 };
  let toast = null, lastInput = null, step = 0, k = 0, endAt = null;
  const maxSteps = Math.round((maxSeconds * 1000) / DT);
  const tall = (f) => f.height * 360 > f.width * 640 * 1.02;
  const sig = (ops) => ops.filter((o) => o.op === 'text' && o.text && (o.opacity ?? 1) > 0.05).map((o) => String(o.text).replace(/\b\d+\b/g, '#')).join('|');
  try {
    while (step < maxSteps) {
      const playing = g.phase() === 'playing';
      if (!playing && endAt == null) endAt = step;
      if (endAt != null && (step - endAt) * DT >= tailMs) break;
      while (playing && k < run.actions.length && run.actions[k].step === step) { apply(g, run.actions[k].action); lastInput = step * DT; k++; }
      g.step(DT);
      step++;
      const now = step * DT;
      // The shake state follows every drawn frame (60 Hz); toasts and pictures only every `every` steps.
      const f = g.frameJSON();
      const enginePx = typeof f.shake === 'number' ? f.shake : f.shake?.px ?? 0;
      const shake = MM.shakeNow(sh, enginePx, now, lastInput);
      const targets = g.hitTargets() ?? [];
      const W = f.width, H = f.height;
      if ((f.toasts ?? []).length && !(f.haptics ?? []).includes('success')) {
        const text = MM.toastCopy(f.toasts.at(-1).text);
        if (text) {
          const size = 15, w = Math.min(W - 16, text.length * size * 0.56 + 28), h = size * 1.9;
          const y = MM.toastLane(f.ops.map((o) => ({ ...o, opacity: o.opacity ?? 1, scale: o.scale ?? 1 })), targets, W, H, tall(f), w, h);
          if (y != null) toast = { text, y, w, h, size, born: now, life: Math.min(MM.TOAST_MAX_MS, f.toasts.at(-1).ms > 0 ? f.toasts.at(-1).ms : MM.TOAST_MAX_MS), sig: sig(f.ops), cleared: null };
        }
      }
      if (toast && toast.cleared == null && sig(f.ops) !== toast.sig) toast.cleared = now;
      if (step % every) continue;
      let ops = MM.clampTextScale({ ops: f.ops.map((o) => ({ ...o, scale: o.scale ?? 1 })) }).ops;
      let tinted = false;
      if (shake) {
        const moves = ops.map((o) => MM.shakeable(o, targets, W, H, tall(f)));
        if (moves.some(Boolean)) {
          const dx = rnd() * shake.amp, dy = rnd() * shake.amp;
          ops = ops.map((o, i) => (moves[i] ? shifted(o, dx, dy) : o));
        } else tinted = true;
      }
      if (tinted) {
        const a = Math.min(1, 0.35 * (shake.amp / MM.SHAKE_MAX_PX)), e = 10;
        for (const [x, y, w, h] of [[0, 0, W, e], [0, H - e, W, e], [0, 0, e, H], [W - e, 0, e, H]]) ops.push({ op: 'rect', x, y, w, h, radius: 0, fill: '#FF4D6D', stroke: null, stroke_width: 0, rotation: 0, scale: 1, opacity: a });
      }
      let toastText = null;
      if (toast) {
        const a = MM.toastAlpha(toast, now);
        if (a > 0) {
          toastText = toast.text;
          ops.push({ op: 'rect', x: W / 2 - toast.w / 2, y: toast.y - toast.h / 2, w: toast.w, h: toast.h, radius: toast.h / 2, fill: '#0C0E18C7', stroke: null, stroke_width: 0, rotation: 0, scale: 1, opacity: a });
          ops.push({ op: 'text', text: toast.text, x: W / 2 - toast.w / 2, y: toast.y - toast.h / 2, w: toast.w, h: toast.h, size: toast.size, weight: 700, font: 'Inter', color: '#FFFFFF', align: 'center', valign: 'middle', line_height: toast.size * 1.25, rotation: 0, scale: 1, opacity: a, stroke: null, stroke_width: 0 });
        } else if (now > toast.born) toast = null;
      }
      out.push({ t: Math.round(now), frame: { ...f, ops }, shake: shake ? shake.amp : 0, toasts: (f.toasts ?? []).map((x) => x.text), toast: toastText, inputs: run.actions.filter((a) => Math.round(a.step * DT) > now - every * DT && Math.round(a.step * DT) <= now).length });
    }
  } finally { g.dispose(); }
  return { frames: out, endAt: endAt == null ? null : Math.round(endAt * DT) };
}

/** Lays PNGs out in a grid with captions and screenshots it with Chrome. */
export function sheet(files, { out, cols, w, h, title = '' }) {
  const dir = mkdtempSync(join(tmpdir(), 'motion-sheet-'));
  try {
    const rows = Math.ceil(files.length / cols);
    const html = `<!doctype html><html><body style="margin:0;background:#1d1d22;font:12px -apple-system,Helvetica;color:#eee"><div style="padding:6px 8px;height:18px">${title}</div><div style="display:grid;grid-template-columns:repeat(${cols},${w}px);gap:4px;padding:0 8px 8px">${files.map((f) => `<div><div style="height:16px;white-space:nowrap;overflow:hidden">${f.label}</div><img src="file://${f.file}" width="${w}" height="${h}" style="display:block"></div>`).join('')}</div></body></html>`;
    writeFileSync(join(dir, 'sheet.html'), html);
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', `--user-data-dir=${join(dir, 'p')}`, `--window-size=${cols * (w + 4) + 16},${rows * (h + 20) + 36}`, `--screenshot=${out}`, 'file://' + join(dir, 'sheet.html')], { stdio: 'ignore', timeout: 90000 });
    return out;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Renders frames to PNG files in `dir` (scale relative to canvas units). */
export function renderPngs(frames, assets, dir, prefix, scale) {
  const res = renderFrames(frames.map((f) => ({ ...f.frame, png: true })), assets, { scale, budgetMs: 60000 });
  return frames.map((f, i) => { const file = join(dir, `${prefix}-${String(i).padStart(3, '0')}.png`); writeFileSync(file, res[i].png); return file; });
}

/** The moments worth a strip: first right answer, first wrong one, first shake, first toast, the end. */
export function pickMoments(frames, endAt) {
  const moments = [];
  const add = (name, t) => { if (t != null && !moments.some((m) => Math.abs(m.t - t) < 300)) moments.push({ name, t }); };
  const shakeAt = frames.find((f) => f.shake > 0.05)?.t;
  add('shake', shakeAt != null ? shakeAt - 50 : null);
  const toastAt = frames.find((f) => f.toasts.length)?.t;
  add('toast', toastAt != null ? toastAt - 50 : null);
  const inputAt = frames.find((f) => f.inputs)?.t;
  add('input', inputAt != null ? inputAt - 50 : null);
  if (endAt != null) add('end', endAt - 100);
  return moments;
}

export async function strips(input, { out, name, runs = null, every = 3, count = 14, scale = 0.5, engine = null, moments = null, shell = 'old' } = {}) {
  const { game } = readInput(input);
  const eng = engine ?? (await loadEngine()).engine;
  const json = JSON.stringify(game);
  const run = (runs ?? randomRuns(eng, json, { seeds: [1], maxSeconds: 60 })).map((r) => ({ seed: r.replay.seed, actions: r.replay.actions ?? [] }))[0];
  const ink = String(game.presentation?.tokens?.ink ?? '#FFFFFF');
  const { frames, endAt } = playFrames(eng, json, run, { every, ink, shell });
  const probe = eng.load(json, 1);
  const assets = probe.assets();
  probe.dispose();
  mkdirSync(out, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'motion-png-'));
  const W = game.presentation?.canvas?.w ?? 360, H = game.presentation?.canvas?.h ?? 640;
  const written = [];
  try {
    for (const m of moments ?? pickMoments(frames, endAt)) {
      const i0 = Math.max(0, frames.findIndex((f) => f.t >= m.t));
      const pick = frames.slice(i0, i0 + count);
      if (!pick.length) continue;
      const files = renderPngs(pick, assets, work, `${m.name}`, scale * 2).map((file, j) => ({ file, label: `${(pick[j].t / 1000).toFixed(2)}s${pick[j].shake > 0.05 ? ` shake ${pick[j].shake.toFixed(1)}` : ''}${pick[j].toasts.length ? ' toast' : ''}${pick[j].inputs ? ' tap' : ''}` }));
      const file = join(out, `${name}-${m.name}.png`);
      sheet(files, { out: file, cols: Math.min(7, files.length), w: W * scale, h: H * scale, title: `${name} · ${m.name} · every ${Math.round(every * DT)} ms` });
      written.push(file);
    }
    // Contact sheet: every 250 ms of the run.
    const stride = Math.max(1, Math.round(250 / (every * DT)));
    const pick = frames.filter((_, i) => i % stride === 0).slice(0, 120);
    const files = renderPngs(pick, assets, work, 'sheet', 0.5).map((file, j) => ({ file, label: `${(pick[j].t / 1000).toFixed(2)}s${pick[j].shake > 0.05 ? ' shake' : ''}` }));
    const file = join(out, `${name}-sheet.png`);
    sheet(files, { out: file, cols: 12, w: W * 0.25, h: H * 0.25, title: `${name} · every 250 ms` });
    written.push(file);
  } finally { rmSync(work, { recursive: true, force: true }); }
  return { files: written, frames: frames.length, endAt };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const out = resolve(opt('--out') ?? 'motion-strips');
  const runs = opt('--runs') ? JSON.parse(readFileSync(opt('--runs'), 'utf8')) : null;
  const momentsArg = opt('--moments'); // name@seconds,name@seconds
  const moments = momentsArg ? momentsArg.split(',').map((s) => { const [n, t] = s.split('@'); return { name: n, t: Math.round(+t * 1000) }; }) : null;
  const files = args.filter((a, i) => !a.startsWith('--') && !['--out', '--runs', '--every', '--frames', '--scale', '--moments', '--name', '--shell'].includes(args[i - 1]));
  const { engine } = await loadEngine();
  for (const f of files) {
    const name = opt('--name') ?? (basename(f) === 'manifest.json' ? basename(resolve(f, '..')) : basename(f, '.json'));
    const r = await strips(f, { out, name, runs, engine, moments, shell: opt('--shell') ?? 'old', every: +(opt('--every') ?? 3), count: +(opt('--frames') ?? 14), scale: +(opt('--scale') ?? 0.5) });
    for (const x of r.files) console.log(x);
  }
}
