#!/usr/bin/env node
// Contact sheets for judging: the intro, two mid-play frames and the end frame of a game, drawn with
// the engine's own renderer (playtest/frame-render.mjs), side by side in one PNG.
//
//   node authoring/testbed/shots.mjs <manifest.json>... --out <dir> [--scale 1]
//
// Writes <dir>/<name>.png (the sheet) and <dir>/<name>-<label>.png (each frame). Needs MG_ENGINE_DIR
// and Chrome.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../expander/engine.mjs';
import { sampleDense } from '../verify/frames.mjs';
import { readInput } from '../verify/verify.mjs';
import { renderFrames, CHROME } from '../playtest/frame-render.mjs';

/** Intro, two mid-play frames (a third and two thirds through the longest run) and one end frame. */
export function pickFrames(sample) {
  const out = [];
  const intro = sample.frames.find((f) => f.label === 'intro');
  if (intro) out.push({ ...intro, name: 'intro' });
  const runs = sample.coverage.runs.map((r, i) => ({ ...r, i })).filter((r) => r.label !== 'idle');
  const longest = runs.sort((a, b) => b.steps - a.steps)[0];
  const play = sample.frames.filter((f) => f.label === 'play' && (!longest || f.run === longest.i));
  if (play.length) {
    out.push({ ...play[Math.floor(play.length * 0.3)], name: 'mid1' });
    out.push({ ...play[Math.floor(play.length * 0.7)], name: 'mid2' });
  }
  const ends = sample.frames.filter((f) => f.label.startsWith('end-'));
  const end = ends.find((f) => f.label === 'end-won') ?? ends.find((f) => f.label === 'end-lost') ?? ends[0];
  if (end) out.push({ ...end, name: end.label });
  return out;
}

export async function shoot(input, { out, name, scale = 1, engine = null } = {}) {
  const { game } = readInput(input);
  const eng = engine ?? (await loadEngine()).engine;
  const sample = await sampleDense(game, { engine: eng, maxSeconds: 90 });
  const picks = pickFrames(sample);
  const rendered = renderFrames(picks.map((f) => ({ ...f.frame, png: true })), sample.assets, { scale });
  mkdirSync(out, { recursive: true });
  const files = picks.map((f, k) => {
    const file = join(out, `${name}-${f.name}.png`);
    writeFileSync(file, rendered[k].png);
    return { file, label: `${f.name} ${(f.t / 1000).toFixed(1)}s` };
  });
  const W = (game.presentation?.canvas?.w ?? 360) * scale, H = (game.presentation?.canvas?.h ?? 640) * scale;
  const dir = mkdtempSync(join(tmpdir(), 'tb-sheet-'));
  try {
    const html = `<!doctype html><html><body style="margin:0;background:#222;font:14px -apple-system;color:#eee"><div style="display:flex;gap:8px;padding:8px">${files.map((f) => `<div><div style="height:20px">${name} · ${f.label}</div><img src="file://${f.file}" width="${W}" height="${H}"></div>`).join('')}</div></body></html>`;
    writeFileSync(join(dir, 'sheet.html'), html);
    const sheet = join(out, `${name}.png`);
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', `--user-data-dir=${join(dir, 'p')}`, `--window-size=${files.length * (W + 8) + 8},${H + 36}`, `--screenshot=${sheet}`, 'file://' + join(dir, 'sheet.html')], { stdio: 'ignore', timeout: 60000 });
    return { sheet, frames: files };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const out = resolve(opt('--out') ?? 'shots');
  const scale = +(opt('--scale') ?? 1);
  const files = args.filter((a, i) => !a.startsWith('--') && !['--out', '--scale'].includes(args[i - 1]));
  const { engine } = await loadEngine();
  for (const f of files) {
    const name = basename(f) === 'manifest.json' ? basename(resolve(f, '..')) : basename(f, '.json');
    const r = await shoot(f, { out, name, scale, engine });
    console.log(r.sheet);
  }
}
