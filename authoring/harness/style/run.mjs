// node authoring/harness/style/run.mjs restyle <out dir> <muse run dir> [pack json]
//   Compiles one Muse-drawn pack under every Muse-written style spec in that folder.
// node authoring/harness/style/run.mjs muse <out dir> "<style prompt>" [more prompts...] [--critique] [--judge]
//   The full loop on real Muse: style director → illustrator → snap, compile, lint, render →
//   optional single critique round against the quality rubric (quality.mjs) with the rendered frame
//   → optional blind pairwise judge of draft vs revision. Writes every step to <out dir>.

import fs from 'node:fs';
import path from 'node:path';
import { normalizeSpec } from './vocabulary.mjs';
import { compilePack } from './compile.mjs';
import { lintDrawing, lintRendered, snapColors } from './lint.mjs';
import { render } from './render.mjs';
import * as cable from './fixtures/cable-car.mjs';
import { directorMessages, illustratorMessages, criticMessages } from './prompts.mjs';
import { lintSet, rubricCritique, pairwiseMessages } from './quality.mjs';

const [mode, outDir, ...rest] = process.argv.slice(2);
if (!mode || !outDir) throw Error('Usage: run.mjs restyle|muse <out dir> [prompts...]');
const out = path.resolve(outDir);
fs.mkdirSync(out, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(out, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');

export function buildVariant(label, note, rawSpec, pack, game = cable) {
  const { spec, issues } = normalizeSpec(rawSpec);
  const snapped = {}, lint = [...issues.map((m) => ({ role: 'spec', level: 'warn', check: 'spec', message: m }))];
  for (const role of game.roles) {
    if (!pack[role.id]) { lint.push({ role: role.id, level: 'error', check: 'missing', message: 'not drawn' }); continue; }
    const { svg, changes } = snapColors(pack[role.id], spec.palette);
    snapped[role.id] = svg;
    lint.push(...lintDrawing(pack[role.id], spec, role).map((i) => ({ role: role.id, ...i })));
    if (changes.length) lint.push({ role: role.id, level: 'fixed', check: 'palette', message: 'snapped ' + changes.slice(0, 5).join('; ') });
  }
  lint.push(...lintSet(pack, game.roles, spec.palette));
  const art = compilePack(snapped, spec, game.roles);
  return { label, note, spec, art, lint };
}

if (mode === 'restyle') {
  // Re-style one Muse-drawn pack under every Muse-written spec in a run folder, to see how much of
  // a style the compiler carries. Nothing hand-drawn: both the pack and the specs come from Muse.
  const [runDir, packFile] = rest;
  if (!runDir) throw Error('Usage: run.mjs restyle <out dir> <muse run dir> [pack json]');
  const files = fs.readdirSync(runDir);
  const packPath = packFile ?? path.join(runDir, files.find((f) => /\.(draft|pack)\.json$/.test(f)) ?? '');
  if (!fs.existsSync(packPath)) throw Error('no Muse pack (*.draft.json or *.pack.json) in ' + runDir);
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  const specs = files.filter((f) => f.endsWith('.spec.json')).map((f) => [f.replace('.spec.json', ''), JSON.parse(fs.readFileSync(path.join(runDir, f), 'utf8'))]);
  const variants = specs.map(([label, spec]) => buildVariant(label, spec.name ?? '', spec, pack));
  const scenes = variants.map((v) => cable.scene(v.spec.palette));
  const sheetVariants = variants.map((v) => ({ label: v.label, note: v.note, art: v.art }));
  const results = {}, pngs = [];
  for (let i = 0; i < variants.length; i += 4) {
    const { png, metrics } = renderGroup(sheetVariants.slice(i, i + 4), scenes.slice(i, i + 4), `restyle-${i / 4 + 1}`);
    pngs.push(png); Object.assign(results, metrics);
  }
  for (const v of variants) v.lint.push(...lintRendered(results[v.label] ?? {}, cable.roles));
  save('report.json', { pack: packPath, variants: variants.map((v) => ({ label: v.label, lint: v.lint, metrics: results[v.label] })) });
  console.log(pngs.join('\n'));
}

function renderGroup(group, scenes, name) {
  // The page uses one scene; stand-ins differ only in color, so pass each variant's scene inline.
  const merged = group.map((v, k) => ({ ...v, scene: scenes[k] }));
  return render(merged, scenes[0], cable.roles, out, name);
}

// ---- Real Muse ----------------------------------------------------------------------------
async function museLoop() {
  const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
  const env = fs.existsSync(path.join(repo, '.env')) ? fs.readFileSync(path.join(repo, '.env'), 'utf8') : '';
  const key = process.env.MUSE_API_KEY || env.match(/^\s*(?:export\s+)?MUSE_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!key) throw Error('No Muse API key configured');
  const CAP = Number(process.env.STYLE_BUDGET_USD ?? 2);
  const ledger = [];
  const spent = () => ledger.reduce((n, r) => n + r.usd, 0);
  async function ask(label, messages, max_tokens) {
    if (spent() + max_tokens * 20 / 1e6 > CAP) throw Error('budget cap $' + CAP);
    const body = { model: 'muse-wonder-1.0', messages, max_tokens, reasoning_effort: 'low', response_format: { type: 'json_object' } };
    const t0 = performance.now();
    const res = await fetch('https://api.meta.ai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(200000), redirect: 'error' });
    const entry = { label, usd: 0, seconds: 0 };
    ledger.push(entry);
    if (!res.ok) { const why = (await res.text()).slice(0, 300); entry.error = res.status; save('ledger.json', ledger); throw Error(`${label}: HTTP ${res.status} ${why}`); }
    const reply = await res.json(), u = reply.usage ?? {};
    entry.usd = ((u.prompt_tokens ?? 0) * 4 + (u.completion_tokens ?? max_tokens) * 20) / 1e6;
    entry.seconds = Math.round((performance.now() - t0) / 100) / 10; entry.usage = u; entry.finish = reply.choices?.[0]?.finish_reason;
    save('ledger.json', ledger);
    const text = (reply.choices?.[0]?.message?.content ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    return JSON.parse(text);
  }
  const judge = rest.includes('--judge');
  const critique = judge || rest.includes('--critique');
  const prompts = rest.filter((a) => !a.startsWith('--'));
  const game = cable;
  const slug = (p) => p.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  const summary = [];
  await Promise.all(prompts.map(async (prompt) => {
    const id = slug(prompt);
    try {
      const rawSpec = await ask(id + '-director', directorMessages(game, prompt), 2500);
      save(id + '.spec.json', rawSpec);
      const { spec } = normalizeSpec(rawSpec);
      const pack = await ask(id + '-illustrator', illustratorMessages(game, spec), 9000);
      save(id + '.pack.json', pack);
      let v = buildVariant(id, `“${prompt}”`, rawSpec, pack);
      let r = render([{ label: v.label, note: v.note, art: v.art, scene: game.scene(spec.palette) }], game.scene(spec.palette), game.roles, out, id + '-draft');
      v.lint.push(...lintRendered(r.metrics[v.label] ?? {}, game.roles));
      save(id + '-draft.lint.json', v.lint);
      const row = { prompt, draft: r.png, draftFindings: v.lint.filter((l) => l.level !== 'fixed').length };
      if (critique) {
        const findings = v.lint.filter((l) => l.level !== 'fixed');
        let rev;
        // Same conversation as prompts.mjs's critic, with the rubric in place of its free-form checklist.
        const messages = criticMessages(game, spec, pack, findings, '').slice(0, -1);
        messages.push(rubricCritique(findings, fs.readFileSync(r.png).toString('base64')));
        try { rev = await ask(id + '-critic', messages, 9000); }
        catch (e) { row.critiqueError = e.message; }
        if (rev) {
          save(id + '.revision.json', rev);
          const pack2 = { ...pack };
          for (const role of game.roles) if (typeof rev[role.id] === 'string') pack2[role.id] = rev[role.id];
          const v2 = buildVariant(id + '-rev', 'after one critique', rawSpec, pack2);
          const both = [{ label: v.label, note: 'draft', art: v.art, scene: game.scene(spec.palette) }, { label: v2.label, note: 'after critique', art: v2.art, scene: game.scene(spec.palette) }];
          const r2 = render(both, game.scene(spec.palette), game.roles, out, id + '-compare');
          v2.lint.push(...lintRendered(r2.metrics[v2.label] ?? {}, game.roles));
          save(id + '-rev.lint.json', v2.lint);
          if (judge) {
            // Blind: render the revision alone, shuffle the order, and ask in a fresh conversation.
            const r3 = render([{ label: v2.label, note: '', art: v2.art, scene: game.scene(spec.palette) }], game.scene(spec.palette), game.roles, out, id + '-rev');
            const draftFirst = Math.random() < 0.5;
            const [a, b] = draftFirst ? [r.png, r3.png] : [r3.png, r.png];
            try {
              const verdict = await ask(id + '-judge', pairwiseMessages(fs.readFileSync(a).toString('base64'), fs.readFileSync(b).toString('base64')), 1500);
              const unblind = (pick) => pick === 'tie' ? 'tie' : (pick === 'A') === draftFirst ? 'draft' : 'revision';
              row.judge = Object.fromEntries(Object.entries(verdict).map(([k, x]) => [k, typeof x === 'string' ? unblind(x) : { ...x, pick: unblind(x.pick) }]));
              save(id + '.judge.json', { draftFirst, verdict, unblinded: row.judge });
            } catch (e) { row.judgeError = e.message; }
          }
          Object.assign(row, { compare: r2.png, review: rev.review, notes: rev.notes, revisedRoles: game.roles.filter((x) => typeof rev[x.id] === 'string').map((x) => x.id), revFindings: v2.lint.filter((l) => l.level !== 'fixed').length });
        }
      }
      summary.push(row);
    } catch (e) { summary.push({ prompt, error: e.message }); }
  }));
  save('summary.json', { spentUsd: Math.round(spent() * 1000) / 1000, calls: ledger, runs: summary });
  console.log(JSON.stringify({ spentUsd: spent().toFixed(3), runs: summary.map((r) => ({ prompt: r.prompt, error: r.error, critiqueError: r.critiqueError, draftFindings: r.draftFindings, revFindings: r.revFindings, revised: r.revisedRoles, judge: r.judge?.overall, judgeError: r.judgeError })) }, null, 1));
}
if (mode === 'muse') await museLoop();
