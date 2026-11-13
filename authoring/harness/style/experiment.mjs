// Human-judged art experiment. Arms (pick with --arms, default kit,rubric,freedraw):
//   kit       style spec + flat shapes + compiler, one pass
//   freeform  the kit draft after prompts.mjs's critic
//   rubric    the kit draft after quality.mjs's rubric critic
//   freedraw  Muse draws finished SVG straight from the player's words, no vocabulary
// Every pair of arms is judged blind by a person (judge.html) and by Muse's pairwise judge, which
// also tells us whether Muse's judge can score future changes on its own.
//
// node authoring/harness/style/experiment.mjs <out dir> ["<style>" ...] [--muse-styles N] [--arms a,b,c]
//   --muse-styles N has Muse write N style requests the way players type them, so the test isn't
//   limited to styles we chose. Writes judge.html and key.json (the unblinding key; don't open it first).
// node authoring/harness/style/experiment.mjs <out dir> --tally <human results json>
//   Unblinds the person's picks and reports win rates and human–Muse agreement.

import fs from 'node:fs';
import path from 'node:path';
import { normalizeSpec } from './vocabulary.mjs';
import { compilePack } from './compile.mjs';
import { lintDrawing, lintRendered, snapColors } from './lint.mjs';
import { render } from './render.mjs';
import * as game from './fixtures/cable-car.mjs';
import { directorMessages, illustratorMessages, criticMessages, freeDrawMessages } from './prompts.mjs';
import { lintSet, rubricCritique, pairwiseMessages } from './quality.mjs';
import { judgePage } from './judge-page.mjs';

const [outDir, ...rest] = process.argv.slice(2);
if (!outDir) throw Error('Usage: experiment.mjs <out dir> "<style>"... | --tally <results.json>');
const out = path.resolve(outDir);
fs.mkdirSync(out, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(out, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
const b64 = (file) => fs.readFileSync(file).toString('base64');

function build(rawSpec, pack) {
  const { spec } = normalizeSpec(rawSpec);
  const snapped = {}, lint = [];
  for (const role of game.roles) {
    if (!pack[role.id]) continue;
    snapped[role.id] = snapColors(pack[role.id], spec.palette).svg;
    lint.push(...lintDrawing(pack[role.id], spec, role).map((i) => ({ role: role.id, ...i })));
  }
  lint.push(...lintSet(pack, game.roles, spec.palette));
  return { spec, art: compilePack(snapped, spec, game.roles), lint };
}
function frame(name, built) {
  const sc = game.scene(built.spec.palette);
  const r = render([{ label: '', note: '', art: built.art, scene: sc }], sc, game.roles, out, name);
  built.lint.push(...lintRendered(r.metrics[''] ?? {}, game.roles));
  return r.png;
}

// ---- tally -------------------------------------------------------------------------------
if (rest[0] === '--tally') {
  const human = JSON.parse(fs.readFileSync(path.resolve(rest[1]), 'utf8'));
  const key = JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8'));
  const tally = {}, agree = { same: 0, n: 0, rows: [] };
  for (const p of key.pairs) {
    const h = human[p.id];
    if (!h) continue;
    const winner = (pick, aIs, bIs) => pick === 'tie' ? 'tie' : pick === 'A' ? aIs : bIs;
    const hw = p.identical ? 'tie' : winner(h.pick, p.a, p.b);
    const k = [p.a, p.b].sort().join(' vs ');
    tally[k] ??= {};
    tally[k][hw] = (tally[k][hw] ?? 0) + 1;
    const mw = p.museOverall ? winner(p.museOverall, p.a, p.b) : null;
    if (mw && !p.identical) { agree.n++; if (mw === hw) agree.same++; }
    agree.rows.push({ style: p.style, pair: k, human: hw, muse: mw, note: h.note || undefined });
  }
  const wins = {};
  for (const r of agree.rows) for (const arm of r.pair.split(' vs ')) { wins[arm] ??= { win: 0, loss: 0, tie: 0 }; wins[arm][r.human === arm ? 'win' : r.human === 'tie' ? 'tie' : 'loss']++; }
  const report = { byPair: tally, byArm: wins, museAgreement: agree.n ? `${agree.same}/${agree.n}` : 'n/a', rows: agree.rows };
  save('results.json', report);
  console.log(JSON.stringify(report, null, 1));
  process.exit(0);
}

// ---- generate ----------------------------------------------------------------------------
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const env = fs.existsSync(path.join(repo, '.env')) ? fs.readFileSync(path.join(repo, '.env'), 'utf8') : '';
const keyVal = process.env.MUSE_API_KEY || env.match(/^\s*(?:export\s+)?MUSE_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
if (!keyVal) throw Error('No Muse API key configured');
const CAP = Number(process.env.STYLE_BUDGET_USD ?? 3);
const ledger = [];
const spent = () => ledger.reduce((n, r) => n + r.usd, 0);
async function ask(label, messages, max_tokens) {
  if (spent() + max_tokens * 20 / 1e6 > CAP) throw Error('budget cap $' + CAP);
  const body = { model: 'muse-wonder-1.0', messages, max_tokens, reasoning_effort: 'low', response_format: { type: 'json_object' } };
  const t0 = performance.now();
  const res = await fetch('https://api.meta.ai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + keyVal, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(200000), redirect: 'error' });
  const entry = { label, usd: 0 };
  ledger.push(entry);
  if (!res.ok) { entry.error = res.status; save('ledger.json', ledger); throw Error(`${label}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); }
  const reply = await res.json(), u = reply.usage ?? {};
  entry.usd = ((u.prompt_tokens ?? 0) * 4 + (u.completion_tokens ?? max_tokens) * 20) / 1e6;
  entry.seconds = Math.round((performance.now() - t0) / 100) / 10; entry.finish = reply.choices?.[0]?.finish_reason;
  save('ledger.json', ledger);
  return JSON.parse((reply.choices?.[0]?.message?.content ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
}

// Arms: kit (spec + flat shapes + compiler, one pass), freeform (kit draft after prompts.mjs's
// critic), rubric (kit draft after quality.mjs's rubric critic), freedraw (Muse draws finished SVG
// with no vocabulary). Default: kit, rubric, freedraw.
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const ARMS = (opt('--arms') ?? 'kit,rubric,freedraw').split(',');
const flagValues = new Set(['--arms', '--muse-styles'].map(opt).filter(Boolean));
let styles = rest.filter((a) => !a.startsWith('--') && !flagValues.has(a));
const slug = (p) => p.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28);
const pairs = [], errors = [];
const findings = (b) => b.lint.filter((l) => l.level !== 'fixed');
const revise = (pack, rev) => { const p = { ...pack }; for (const r of game.roles) if (typeof rev?.[r.id] === 'string') p[r.id] = rev[r.id]; return p; };

// Let Muse pick the styles, so the test isn't limited to looks we thought of.
if (opt('--muse-styles')) {
  const n = Number(opt('--muse-styles'));
  const got = await ask('styles', [{ role: 'system', content: 'Return JSON {"styles": [...]} only.' }, { role: 'user', content:
    `List ${n} visual styles that different players might type when asking for a small phone game about a San Francisco cable car. Write them the way people actually type them, a few words each. Make them as varied as you can: art mediums, materials, eras, places, moods, techniques, odd and playful ones. Avoid brand, franchise and artist names.` }], 1500);
  styles = [...styles, ...(got.styles ?? []).slice(0, n)];
  save('styles.json', styles);
}

await Promise.all(styles.map(async (style) => {
  const id = slug(style);
  const arms = {};
  try {
    const needKit = ARMS.some((a) => a !== 'freedraw');
    const jobs = [];
    if (needKit) jobs.push((async () => {
      const rawSpec = await ask(id + '-director', directorMessages(game, style), 2500);
      save(id + '.spec.json', rawSpec);
      const { spec } = normalizeSpec(rawSpec);
      const pack = await ask(id + '-illustrator', illustratorMessages(game, spec), 9000);
      save(id + '.draft.json', pack);
      const draft = build(rawSpec, pack);
      const draftPng = frame(id + '-kit', draft);
      if (ARMS.includes('kit')) arms.kit = { pack, png: draftPng };
      // Critics start from the same draft, the same findings and the same image.
      const critics = [];
      if (ARMS.includes('freeform')) critics.push(['freeform', criticMessages(game, spec, pack, findings(draft), b64(draftPng))]);
      if (ARMS.includes('rubric')) {
        const m = criticMessages(game, spec, pack, findings(draft), '').slice(0, -1);
        m.push(rubricCritique(findings(draft), b64(draftPng)));
        critics.push(['rubric', m]);
      }
      await Promise.all(critics.map(async ([name, m]) => {
        let rev;
        try { rev = await ask(`${id}-critic-${name}`, m, 9000); } catch (e) { errors.push(`${id} ${name}: ${e.message}`); return; }
        save(`${id}.${name}.json`, rev);
        const p = revise(pack, rev);
        arms[name] = { pack: p, png: frame(`${id}-${name}`, build(rawSpec, p)), redrew: game.roles.filter((r) => typeof rev[r.id] === 'string').map((r) => r.id) };
      }));
    })());
    if (ARMS.includes('freedraw')) jobs.push((async () => {
      let pack;
      try { pack = await ask(id + '-freedraw', freeDrawMessages(game, style), 14000); } catch (e) { errors.push(`${id} freedraw: ${e.message}`); return; }
      save(id + '.freedraw.json', pack);
      const pal = { ink: '#1D1D22', surface: '#FFFFFF', accent: '#E04040', tertiary: '#F2C14E', ...(pack.palette ?? {}) };
      const art = Object.fromEntries(game.roles.filter((r) => typeof pack[r.id] === 'string').map((r) => [r.id, pack[r.id]]));
      const sc = game.scene(pal);
      const r = render([{ label: '', note: '', art, scene: sc }], sc, game.roles, out, id + '-freedraw');
      arms.freedraw = { pack, png: r.png, bytes: Object.fromEntries(Object.entries(art).map(([k, v]) => [k, v.length])) };
    })());
    await Promise.all(jobs);

    const names = ARMS.filter((n) => arms[n]);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const flip = Math.random() < 0.5;
      const [a, b] = flip ? [names[j], names[i]] : [names[i], names[j]];
      const identical = JSON.stringify(arms[a].pack) === JSON.stringify(arms[b].pack);
      const pair = { style, a, b, aPng: arms[a].png, bPng: arms[b].png, identical };
      if (!identical) {
        try {
          const v = await ask(`${id}-judge-${a}-${b}`, pairwiseMessages(b64(arms[a].png), b64(arms[b].png)), 4000);
          pair.museOverall = v.overall; pair.muse = v;
        } catch (e) { pair.museError = e.message; }
      }
      pairs.push(pair);
    }
    save(id + '.arms.json', Object.fromEntries(Object.entries(arms).map(([k, v]) => [k, { png: v.png, redrew: v.redrew, bytes: v.bytes }])));
  } catch (e) { errors.push(`${id}: ${e.message}`); }
}));

// Shuffle pairs across styles and give them neutral ids.
for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
pairs.forEach((p, i) => { p.id = 'p' + String(i + 1).padStart(2, '0'); });
save('key.json', { pairs: pairs.map(({ aPng, bPng, ...rest }) => rest), errors, spentUsd: Math.round(spent() * 1000) / 1000 });

// The judging page: images inline, nothing that reveals which arm is which.
const items = pairs.filter((p) => !p.identical).map((p) => ({ id: p.id, style: p.style, a: 'data:image/png;base64,' + b64(p.aPng), b: 'data:image/png;base64,' + b64(p.bPng) }));
fs.writeFileSync(path.join(out, 'judge.html'), judgePage(items));
console.log(JSON.stringify({ spentUsd: spent().toFixed(3), pairs: pairs.length, toJudge: items.length, identical: pairs.filter((p) => p.identical).length, errors, page: path.join(out, 'judge.html') }, null, 1));
