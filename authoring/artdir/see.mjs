// See and fix: a built game's frames drawn at iPhone 14 Pro size (393 × 852 points for the tall 360 ×
// 780 canvas) next to its style frame, so an agent can look at both side by side and fix what
// differs. Frames: the intro, the first input's tween (150 ms after it), four play frames spread over
// the longest bot run, the last play frame and the end. Drawn by the engine's own renderer
// (playtest/frame-render.mjs) in headless Chrome. Needs MG_ENGINE_DIR and Chrome.
//
//   const r = await see(manifestOrGame, {out, name, frame: '/abs/frame.png', scale})
//   → {sheet: '<out>/<name>-see.png', frames: [{file, label}]}

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEngine } from '../expander/engine.mjs';
import { sampleDense } from '../verify/frames.mjs';
import { readInput } from '../verify/verify.mjs';
import { renderFrames, CHROME } from '../playtest/frame-render.mjs';

export const PHONE = Object.freeze({ w: 393, h: 852, name: 'iPhone 14 Pro' });

/** The frames worth looking at, from a dense sample (verify/frames.mjs). */
export function pickSeeFrames(sample, { play = 4 } = {}) {
  const out = [];
  const intro = sample.frames.find((f) => f.label === 'intro');
  if (intro) out.push({ ...intro, name: 'intro' });
  const runs = sample.coverage.runs.map((r, i) => ({ ...r, i })).filter((r) => r.label !== 'idle');
  const longest = [...runs].sort((a, b) => b.steps - a.steps)[0];
  const frames = sample.frames.filter((f) => f.label === 'play' && (!longest || f.run === longest.i));
  const firstAct = sample.replayCtx?.runs?.[longest?.i ?? 0]?.actions?.[0];
  if (firstAct) {
    const tween = frames.find((f) => f.step >= firstAct.step + 9);
    if (tween) out.push({ ...tween, name: 'tween' });
  }
  for (let k = 1; k <= play && frames.length; k++) {
    const f = frames[Math.min(frames.length - 1, Math.floor((frames.length * k) / (play + 1)))];
    if (!out.some((o) => o.step === f.step && o.run === f.run)) out.push({ ...f, name: `play${k}` });
  }
  if (frames.length) out.push({ ...frames[frames.length - 1], name: 'last' });
  const ends = sample.frames.filter((f) => f.label.startsWith('end-'));
  const won = ends.find((f) => f.label === 'end-won'), lost = ends.find((f) => f.label === 'end-lost');
  for (const e of [won, lost].filter(Boolean)) out.push({ ...e, name: e.label });
  if (!won && !lost && ends[0]) out.push({ ...ends[0], name: ends[0].label });
  return out;
}

export async function see(input, { out, name = 'game', frame = null, scale = PHONE.w / 360, engine = null, play = 4 } = {}) {
  const { game } = readInput(input);
  const eng = engine ?? (await loadEngine()).engine;
  const sample = await sampleDense(game, { engine: eng, maxSeconds: 90 });
  const picks = pickSeeFrames(sample, { play });
  const rendered = renderFrames(picks.map((f) => ({ ...f.frame, png: true })), sample.assets, { scale });
  mkdirSync(out, { recursive: true });
  const files = picks.map((f, k) => {
    const file = join(out, `${name}-${f.name}.png`);
    writeFileSync(file, rendered[k].png);
    return { file, label: `${f.name} ${(f.t / 1000).toFixed(1)}s` };
  });
  const cw = game.presentation?.canvas?.w ?? 360, ch = game.presentation?.canvas?.h ?? 640;
  const W = Math.round(cw * scale), H = Math.round(ch * scale);
  const cells = [...(frame ? [{ file: frame, label: 'style frame' }] : []), ...files];
  const dir = mkdtempSync(join(tmpdir(), 'artdir-see-'));
  try {
    const html = `<!doctype html><html><body style="margin:0;background:#1b1b1f;font:14px -apple-system;color:#eee"><div style="display:flex;gap:10px;padding:10px">${cells.map((f, i) => `<div><div style="height:20px">${i === 0 && frame ? '<b>style frame</b>' : `${name} · ${f.label}`}</div><img src="file://${f.file}" width="${W}" height="${H}" style="object-fit:cover;border-radius:6px"></div>`).join('')}</div></body></html>`;
    writeFileSync(join(dir, 'sheet.html'), html);
    const sheet = join(out, `${name}-see.png`);
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', `--user-data-dir=${join(dir, 'p')}`, `--window-size=${cells.length * (W + 10) + 10},${H + 40}`, `--screenshot=${sheet}`, 'file://' + join(dir, 'sheet.html')], { stdio: 'ignore', timeout: 60000 });
    return { sheet, frames: files, coverage: sample.coverage };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
