#!/usr/bin/env node
// Makes 2–3 versions of one game on real Muse (authoring/expander/variants.mjs) from a harness plan.
//
//   node authoring/tools/variants-muse.mjs --context plan.json --request "<request>"
//        [--n 2] [--axes look,twist] [--mode auto|separate|shared|both] [--out dir] [--posters]
//
// --context   a harness-context/1 (POST /v1/harness/plan, or harness-query --muse --plan --json)
// --mode      auto: restyle for look, compose otherwise (default); separate: a full compose per version;
//             shared: one compose plus a cheap pass per other version; both: measures separate and shared on
//             the same plan (version a is composed once and reused by both), for the cost table.
// --posters   renders each version's poster with headless Chrome (poster-<id>.png)
// --pick b    with --out of an earlier run: writes the variant_pick event and the next plan's context
//
// Needs the Muse key in FacebookClone/Bubbles/Studio/MuseConfig.json (or MUSE_CONFIG pointing at a copy, or
// MUSE_API_KEY); the key stays in memory and is never printed. Writes <out>/result.json, <out>/<id>/manifest.json,
// <out>/calls.jsonl and <out>/events.jsonl.

import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadMuseConfig } from '../../tools/harness-eval/lib.mjs';
import * as V from '../expander/variants.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const out = resolve(opt('--out', 'variants-out'));
mkdirSync(out, { recursive: true });

// --pick: the learning loop, no Muse.
if (args.includes('--pick')) {
  const result = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'));
  const e = V.pickEvent(result, opt('--pick'), { played: (opt('--played', '') || '').split(',').filter(Boolean) });
  const next = V.applyPick(JSON.parse(readFileSync(resolve(opt('--context')), 'utf8')), e);
  writeFileSync(join(out, 'pick.json'), JSON.stringify(e, null, 2) + '\n');
  writeFileSync(join(out, 'next-context.json'), JSON.stringify(next, null, 2) + '\n');
  console.log(JSON.stringify(e));
  console.log(next.notes.at(-1));
  process.exit(0);
}

const request = opt('--request');
const contextFile = opt('--context');
if (!request || !contextFile) { console.error('usage: variants-muse.mjs --context plan.json --request "<request>" [--n 2] [--axes look] [--mode auto|separate|shared|both] [--out dir] [--posters]'); process.exit(2); }
const context = JSON.parse(readFileSync(resolve(contextFile), 'utf8'));
const n = Number(opt('--n', 2));
const axes = opt('--axes') ? opt('--axes').split(',') : null;
const mode = opt('--mode', 'auto');

const config = loadMuseConfig();
if (!config) { console.error('no Muse key (MuseConfig.json, MUSE_CONFIG or MUSE_API_KEY)'); process.exit(2); }
const { loadStudio } = await import(join(repo, 'backend/generator/src/studio.mjs'));
const studio = loadStudio();

const callLog = join(out, 'calls.jsonl');
const evLog = join(out, 'events.jsonl');
writeFileSync(callLog, '');
writeFileSync(evLog, '');
const started = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ask(system, user, purpose, options?) → {content, model, usage}; honours {model, effort, max_tokens}; retries 429s and blips.
async function ask(system, user, purpose, options) {
  const model = options?.model ?? 'muse-wonder-1.0';
  const effort = options?.effort ?? 'medium';
  let budget = Math.max(options?.max_tokens ?? 16000, 4000);
  const t0 = Date.now();
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      for (let pass = 0; pass < 2; pass++) {
        const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' }, max_tokens: budget, reasoning_effort: effort };
        const res = await fetch(`${config.baseURL}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(200000) });
        const text = await res.text();
        if (!res.ok) throw Object.assign(new Error(`Muse ${res.status}: ${text.slice(0, 160)}`), { status: res.status });
        const data = JSON.parse(text);
        const ch = data?.choices?.[0];
        const content = String(ch?.message?.content ?? '').trim();
        const u = data.usage ?? {};
        const usage = { prompt_tokens: u.prompt_tokens ?? 0, completion_tokens: u.completion_tokens ?? 0, reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? 0 };
        appendFileSync(callLog, JSON.stringify({ purpose, model: data.model ?? model, effort, max_tokens: budget, attempt, pass, ms: Date.now() - t0, t: Date.now() - started, finish: ch?.finish_reason, chars: content.length, usage }) + '\n');
        if (content) return { content, model: data.model ?? model, usage };
        if (ch?.finish_reason === 'length' && pass === 0) { budget = Math.min(budget * 2, 32000); continue; }
        throw Object.assign(new Error(`empty reply (${ch?.finish_reason})`), { status: 0 });
      }
    } catch (e) {
      lastErr = e;
      appendFileSync(callLog, JSON.stringify({ purpose, model, attempt, error: String(e.message ?? e).slice(0, 200), ms: Date.now() - t0 }) + '\n');
      const retryable = !e.status || e.status === 429 || e.status >= 500;
      if (!retryable || attempt >= 4) throw e;
      await sleep(5000 * attempt);
    }
  }
  throw lastErr;
}
const onEvent = (e) => appendFileSync(evLog, JSON.stringify({ t: Date.now() - started, ...e }) + '\n');

function save(id, r) {
  mkdirSync(join(out, id), { recursive: true });
  writeFileSync(join(out, id, 'manifest.json'), JSON.stringify(r.manifest, null, 2));
}

// Posters: the runtime's host page in poster mode, in headless Chrome (like the app's card).
function renderPoster(manifestFile, png) {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!existsSync(chrome)) return false;
  const web = join(out, '.render');
  if (!existsSync(web)) cpSync(join(repo, 'FacebookClone/Bubbles/Runtime/web'), web, { recursive: true });
  const host = readFileSync(join(web, 'bubble-host.html'), 'utf8').replace(/<\/body>[\s\S]*$/, '');
  const page = join(web, `shot-${process.pid}-${Math.random().toString(36).slice(2, 6)}.html`);
  const boot = `<script>window.webkit={messageHandlers:{bubble:{postMessage:function(m){}}}};BubbleHost.boot(JSON.stringify({manifest:${readFileSync(manifestFile, 'utf8')},mode:"poster",muted:true,reduced_motion:true,player:{name:"You",best:0},insets:{top:0,bottom:0}}));</script></body></html>`;
  writeFileSync(page, host + boot);
  const prof = `${page}.prof`;
  try {
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', `--user-data-dir=${prof}`, '--window-size=500,900', '--virtual-time-budget=4000', `--screenshot=${png}`, `file://${page}`], { stdio: 'ignore', timeout: 60000 });
  } catch { /* a missing poster is not fatal */ }
  rmSync(page, { force: true });
  rmSync(prof, { recursive: true, force: true });
  return existsSync(png);
}

const tokens = (calls) => calls.reduce((t, c) => ({ prompt: t.prompt + (c.usage?.prompt_tokens ?? 0), completion: t.completion + (c.usage?.completion_tokens ?? 0) }), { prompt: 0, completion: 0 });

let result;
if (mode === 'both') {
  // Measure both ways on one plan: a (the plan) composed once; b as a full compose (separate) and as a cheap
  // pass from a (shared), all timed from the moment the plan's alternatives are ready.
  const planned = await V.planVariants({ request, brief: { intent: request }, context, n, axes }, { ask, onEvent });
  const [a, ...rest] = planned.variants;
  const tPlanned = Date.now();
  const timed = async (label, p) => { const t0 = Date.now(); try { const r = await p; return { label, ok: true, r, s: (Date.now() - t0) / 1000, end: Date.now() }; } catch (e) { return { label, ok: false, error: String(e?.message ?? e).slice(0, 300), s: (Date.now() - t0) / 1000, end: Date.now() }; } };
  const tag = (id) => (e) => onEvent({ ...e, variant: id });
  const aP = timed('a', studio.compose({ request, brief: a.brief, context: a.context }, ask, tag('a')));
  const sepP = rest.map((v) => timed(`${v.id}-separate`, studio.compose({ request, brief: v.brief, context: v.context }, ask, tag(`${v.id}-separate`))));
  const aR = await aP;
  const sharedP = rest.map((v) => (aR.ok
    ? timed(`${v.id}-shared`, v.axis === 'look' ? V.restyle(aR.r, v.value, studio, { ask, id: v.id }) : studio.compose({ request: V.revisionRequest(v), brief: v.brief, context: v.context, base: aR.r.manifest }, ask, tag(`${v.id}-shared`)))
    : Promise.resolve({ label: `${v.id}-shared`, ok: false, error: 'a failed', s: 0, end: Date.now() })));
  const sep = await Promise.all(sepP);
  const shared = await Promise.all(sharedP);
  const runs = [aR, ...sep, ...shared];
  const describe = (x, v) => {
    if (!x.ok) return { label: x.label, ok: false, error: x.error, seconds: Math.round(x.s) };
    const calls = x.r.stats?.calls ?? [];
    save(x.label, x.r);
    return { label: x.label, ok: true, axis: v?.axis ?? null, name: v?.label, title: x.r.manifest.title, gate: x.r.gate?.passed ?? null, gate_summary: x.r.gate?.summary ?? '', quality: x.r.quality?.score ?? null, ranked: x.r.score?.ranked ?? null, seconds: Math.round(x.s), muse_calls: calls.length, tokens: tokens(calls), art: x.r.stats?.art ?? undefined };
  };
  const rows = [describe(aR, a), ...sep.map((x, i) => describe(x, rest[i])), ...shared.map((x, i) => describe(x, rest[i]))];
  const altCalls = planned.calls;
  const wallSeparate = Math.max(aR.end, ...sep.map((x) => x.end)) - tPlanned;
  const wallShared = Math.max(aR.end, ...shared.map((x) => x.end)) - tPlanned;
  const sum = (xs) => xs.filter((x) => x.ok).reduce((t, x) => ({ prompt: t.prompt + x.tokens.prompt, completion: t.completion + x.tokens.completion }), { prompt: 0, completion: 0 });
  const rowA = rows[0];
  result = {
    request, n, mode, axes: planned.axes, chosen_axis: rest[0]?.axis,
    variants: planned.variants.map((v) => ({ id: v.id, axis: v.axis, label: v.label, value: v.value, source: v.source ?? 'plan' })),
    alternatives_call: { seconds: Math.round(altCalls.reduce((t, c) => t + (c.ms ?? 0), 0) / 100) / 10, tokens: tokens(altCalls) },
    runs: rows,
    separate: { wall_s: Math.round(wallSeparate / 1000), tokens: sum([rowA, ...rows.slice(1, 1 + sep.length)]), passed: [rowA, ...rows.slice(1, 1 + sep.length)].filter((r) => r.ok && r.gate).length },
    shared: { wall_s: Math.round(wallShared / 1000), tokens: sum([rowA, ...rows.slice(1 + sep.length)]), passed: [rowA, ...rows.slice(1 + sep.length)].filter((r) => r.ok && r.gate).length },
    total_wall_s: Math.round((Date.now() - started) / 1000),
  };
  if (args.includes('--posters')) for (const r of rows) if (r.ok) r.poster = renderPoster(join(out, r.label, 'manifest.json'), join(out, `poster-${r.label}.png`)) ? `poster-${r.label}.png` : null;
} else {
  const r = await V.makeVariants({ request, brief: { intent: request }, context, n, axes, mode }, studio, { ask, onEvent });
  for (const v of r.variants) {
    save(v.id, v);
    if (args.includes('--posters')) v.poster.png = renderPoster(join(out, v.id, 'manifest.json'), join(out, `poster-${v.id}.png`)) ? `poster-${v.id}.png` : null;
  }
  result = { request, n, mode, recommended: r.recommended, dropped: r.dropped, axes: r.axes, stats: { ...r.stats, calls: undefined }, variants: r.variants.map(({ manifest, ...v }) => ({ ...v, game_id: manifest.id, title: manifest.title })) };
}
rmSync(join(out, '.render'), { recursive: true, force: true });
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, axes: undefined, variants: result.variants.map((v) => `${v.id} ${v.axis} ${v.label}`) }, null, 2));
