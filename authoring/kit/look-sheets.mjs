#!/usr/bin/env node
// Before/after contact sheets for the look fix: each game's intro, a mid-play frame and its end
// frame, as shipped and on its own look (kit/look.mjs), drawn in headless Chrome with the bundled
// fonts. Also checks that the fix is presentation only (rules and replays unchanged) and counts
// the verifier's blocking findings before and after.
//
//   MG_ENGINE_DIR=<engine> node authoring/kit/look-sheets.mjs <out-dir> <manifest.json>... [--verify] [--twin=<manifest.json>]
//
// --twin renders one manifest twice under two different game ids (same words, same vibe) to show
// that two games with one vibe still get different looks.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { applyLook, lookCheck, lookForBuilt, chooseLook, gameIdentity } from './look.mjs';
import { readBuilt } from '../playtest/requirements-check.mjs';
import { sampleDense } from '../verify/frames.mjs';
import { renderFrames, CHROME } from '../playtest/frame-render.mjs';
import { loadEngine } from '../expander/engine.mjs';
import { readabilityFindings, readabilityFix } from './readability.mjs';
import { inflateSync } from 'node:zlib';

const inflate = (b) => new Uint8Array(inflateSync(b));
/** The look, then the readability fix on the looked game. Returns {game, before, after, fixes}. */
async function lookAndRead(game, spec) {
  const looked = applyLook(game, spec).game;
  const s0 = await sampleDense(game, { engine, maxSeconds: 60 });
  const before = readabilityFindings(game, s0, { inflate }).length;
  let g = looked, fixes = [];
  for (let round = 0; round < 2; round++) {
    const s = await sampleDense(g, { engine, maxSeconds: 60, ref: game });
    const f = readabilityFindings(g, s, { inflate });
    if (!f.length) break;
    const r = readabilityFix(g, f, { spec });
    g = r.game; fixes.push(...r.fixes);
  }
  const s2 = await sampleDense(g, { engine, maxSeconds: 60, ref: game });
  return { game: g, before, after: readabilityFindings(g, s2, { inflate }).length, fixes };
}

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--'));
const files = args.filter((a) => !a.startsWith('--')).slice(1);
const doVerify = args.includes('--verify');
const twin = args.find((a) => a.startsWith('--twin='))?.slice(7);
if (!outDir || (!files.length && !twin)) { console.log('usage: look-sheets.mjs <out-dir> <manifest.json>... [--verify] [--twin=<manifest.json>]'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const { engine } = await loadEngine();

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Intro, middle of the first run, and the first end frame. */
function pick(sample) {
  const intro = sample.frames.find((f) => f.label === 'intro') ?? sample.frames[0];
  const play = sample.frames.filter((f) => f.label === 'play' && f.run === 0);
  const mid = play[Math.floor(play.length * 0.45)] ?? play[0] ?? intro;
  const end = sample.frames.find((f) => f.label.startsWith('end-') && !f.idle) ?? sample.frames.find((f) => f.label.startsWith('end-')) ?? sample.frames.at(-1);
  return [intro, mid, end];
}

async function shots(game, ref = null) {
  const sample = await sampleDense(game, { engine, maxSeconds: 60, ref, idle: true });
  const fr = pick(sample);
  const out = renderFrames(fr.map((f) => ({ ...f.frame, png: true })), sample.assets, { scale: 1, budgetMs: 30000 });
  return fr.map((f, i) => ({ key: f.key, png: out[i].png }));
}

function snapshot(html, png, w, h) {
  const file = png.replace(/\.png$/, '.html');
  writeFileSync(file, html);
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', `--user-data-dir=${join(dirname(png), '.chrome')}`,
    `--window-size=${w},${h}`, `--screenshot=${png}`, '--virtual-time-budget=8000', 'file://' + file], { stdio: 'ignore', timeout: 120000 });
}

const fontsCss = () => readFileSync(new URL('../../FacebookClone/Bubbles/Runtime/web/game-fonts.css', import.meta.url), 'utf8')
  .replace(/url\("([^"/]+\.woff2)"\)/g, (_, f) => `url("${new URL(`../../FacebookClone/Bubbles/Runtime/web/${f}`, import.meta.url).href}")`);

function row(title, sub, cells) {
  return `<div class="row"><div class="hd"><b>${esc(title)}</b><span>${esc(sub)}</span></div><div class="cells">${cells.map((c) => `<figure><img src="data:image/png;base64,${c.png.toString('base64')}"><figcaption>${esc(c.cap)}</figcaption></figure>`).join('')}</div></div>`;
}
const page = (rows, sample) => `<!doctype html><html><head><meta charset="utf-8"><style>${fontsCss()}
body{margin:0;padding:16px;background:#14141a;color:#eee;font:13px -apple-system,Helvetica,sans-serif}
.row{margin:0 0 18px}.hd{margin:0 0 6px}.hd b{font-size:15px;margin-right:10px}.hd span{color:#aab}
.cells{display:flex;gap:8px}figure{margin:0}img{width:200px;display:block;border-radius:6px;border:1px solid #333}
figcaption{color:#99a;font-size:11px;margin-top:3px;max-width:200px}.sp{display:flex;gap:18px;margin:4px 0 0;color:#ccd}${sample}</style></head><body>${rows.join('')}</body></html>`;

function specLine(spec) {
  const s = spec.steps;
  return `${spec.vibe}/${spec.pairing} · ${spec.families.display} + ${spec.families.text}${spec.numerals ? ` + ${spec.numerals.family} (numerals)` : ''} · scale ${s.caption.size}/${s.label.size}/${s.body.size}/${s.title.size}/${s.display.size}/${s.hero.size} (×${spec.ratio} on ${spec.base}) · ${spec.treatment} · display ${spec.case.display}, tracking ${spec.tracking.display}/${spec.tracking.label}${spec.tilt ? ` · tilt ${spec.tilt}°` : ''}`;
}

const summary = [];
const rowsAll = [];
for (const file of files) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const built = readBuilt(raw);
  const key = basename(dirname(file)).match(/^[a-z]?\d+$|^k\d+|^s\d+/i) ? basename(dirname(file)) : basename(file).replace(/\.json$/, '');
  const { spec, words } = lookForBuilt({ manifest: built.manifest, authoring: built.authoring, game: built.game });
  const before = built.game;
  const lr = await lookAndRead(before, spec);
  const after = lr.game;
  const f0 = lookCheck(before, spec, { words }).map((f) => f.code);
  const f1 = lookCheck(after, spec, { words, explicit: true }).map((f) => f.code);
  const { proveUnchanged } = await import('../verify/prove.mjs');
  const proof = await proveUnchanged(before, after, { engine });
  const b = await shots(before);
  const a = await shots(after, before);
  const kinds = lr.fixes.reduce((m, x) => ({ ...m, [x.kind]: (m[x.kind] ?? 0) + 1 }), {});
  const entry = { key, title: built.manifest?.title ?? before.meta?.title, look: specLine(spec), lookBefore: f0, lookAfter: f1, readability: { before: lr.before, after: lr.after, fixes: kinds }, proof: { rules: proof.rules, replays: proof.replays } };
  if (doVerify) {
    const { verify } = await import('../verify/verify.mjs');
    const rb = await verify(raw, { engine });
    const ra = await verify({ ...raw, content: { ...raw.content, game_json: JSON.stringify(after) } }, { engine });
    entry.blocking = { before: rb.blocking, after: ra.blocking, beforeL: rb.findings.filter((f) => f.severity === 'block' && f.code.startsWith('L_')).length, afterL: ra.findings.filter((f) => f.severity === 'block' && f.code.startsWith('L_')).length };
    entry.newL = ra.findings.filter((f) => f.severity === 'block' && f.code.startsWith('L_') && !rb.findings.some((g) => g.code === f.code && g.node === f.node)).map((f) => `${f.code} ${f.message}`);
  }
  summary.push(entry);
  const cells = [...b.map((c, i) => ({ png: c.png, cap: `before · ${['intro', 'mid', 'end'][i]}` })), ...a.map((c, i) => ({ png: c.png, cap: `after · ${['intro', 'mid', 'end'][i]}` }))];
  const r = row(`${key} · ${entry.title}`, entry.look, cells);
  rowsAll.push(row(`${key} · ${entry.title}`, entry.look, [cells[0], cells[3], cells[1], cells[4]]));
  snapshot(page([r], ''), join(outDir, `${key}.png`), 1290, 470);
  console.log(`${key}: ${entry.look}\n   look ${f0.join(' ') || '-'} → ${f1.join(' ') || '-'}; S_READABILITY ${lr.before} → ${lr.after} ${JSON.stringify(kinds)}; proof rules ${proof.rules} replays ${proof.replays}${entry.blocking ? `; blocking ${entry.blocking.before} → ${entry.blocking.after} (L_ ${entry.blocking.beforeL} → ${entry.blocking.afterL})${entry.newL.length ? ' new: ' + entry.newL.join(' | ') : ''}` : ''}`);
}
if (files.length) {
  for (let i = 0; i < rowsAll.length; i += 5) snapshot(page(rowsAll.slice(i, i + 5), ''), join(outDir, `overview-${i / 5 + 1}.png`), 900, 60 + 470 * Math.min(5, rowsAll.length - i));
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
}

// Two games with the same words (so the same vibe) under different ids.
if (twin) {
  const raw = JSON.parse(readFileSync(twin, 'utf8'));
  const built = readBuilt(raw);
  const { words, id } = gameIdentity({ manifest: built.manifest, authoring: built.authoring, game: built.game });
  const ids = [id, `${id}-again`, `${id}-third`];
  const rows = [];
  const specs = [];
  for (const gid of ids) {
    const spec = chooseLook(words, gid);
    specs.push(spec);
    const g = applyLook(built.game, spec).game;
    const s = await shots(g, built.game);
    rows.push(row(`id ${gid}`, specLine(spec), s.map((c, i) => ({ png: c.png, cap: ['intro', 'mid', 'end'][i] }))));
  }
  snapshot(page(rows, ''), join(outDir, 'same-vibe.png'), 700, 60 + 470 * rows.length);
  const same = specs.every((s) => s.vibe === specs[0].vibe);
  const distinct = new Set(specs.map((s) => `${s.pairing}|${s.ratio}|${s.base}|${JSON.stringify([s.case, s.tracking, s.treatment, s.numerals?.family, s.tilt])}`)).size === specs.length;
  console.log(`same vibe ${same} (${specs[0].vibe}); looks distinct ${distinct}: ${specs.map((s) => specLine(s)).join(' | ')}`);
}
