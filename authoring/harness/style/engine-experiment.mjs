// Art experiment on real games, rendered by the real engine. Nothing here is drawn by hand: Muse
// writes the game requests (or you pass them), Muse makes each game through the production
// pipeline (backend/generator: compose → expand → repair → five-bot gate → wrap), and every frame
// is the runtime's own poster (a bot plays to a representative moment and the engine draws it).
//
// Arms, all on the same game logic and the same seed:
//   pipeline  the art Muse wrote inside the game manifest (what ships today)
//   kit       style director + flat shapes + style compiler (this folder)
//   freedraw  Muse draws finished SVG for the game's sprite roles, no vocabulary
// The kit and freedraw illustrators also see the game's layout, rendered by the engine with
// placeholder shapes, so they know where things go.
//
// ENGINE_REPO=<a beta-version checkout> node authoring/harness/style/engine-experiment.mjs <out dir> \
//   [--muse-requests N] ["<game request>" ...]
// Then judge <out dir>/judge.html, and tally with experiment.mjs <out dir> --tally <answers.json>.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { normalizeSpec } from './vocabulary.mjs';
import { compileAsset } from './compile.mjs';
import { snapColors } from './lint.mjs';
import { directorMessages, illustratorMessages } from './prompts.mjs';
import { pairwiseMessages } from './quality.mjs';
import { judgePage } from './judge-page.mjs';
import { CHROME } from './render.mjs';

const [outDir, ...rest] = process.argv.slice(2);
if (!outDir) throw Error('Usage: ENGINE_REPO=<beta-version checkout> engine-experiment.mjs <out dir> [--muse-requests N] ["<request>" ...]');
const REPO = path.resolve(process.env.ENGINE_REPO ?? '');
const GEN = path.join(REPO, 'backend/generator');
if (!fs.existsSync(path.join(GEN, 'src/composer.mjs'))) throw Error('ENGINE_REPO must be a checkout of beta-version (needs backend/generator)');
const out = path.resolve(outDir);
fs.mkdirSync(out, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(out, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
const b64 = (f) => fs.readFileSync(f).toString('base64');

const { compose } = await import(path.join(GEN, 'src/composer.mjs'));
const { MuseClient } = await import(path.join(GEN, 'src/muse.mjs'));
const { loadStudio } = await import(path.join(GEN, 'src/studio.mjs'));
const studio = loadStudio(path.join(GEN, 'vendor'));

// ---- Muse ---------------------------------------------------------------------------------
const here = path.dirname(new URL(import.meta.url).pathname);
const envFile = path.resolve(here, '../../../.env');
const env = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
const KEY = process.env.MUSE_API_KEY || env.match(/^\s*(?:export\s+)?MUSE_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
if (!KEY) throw Error('No Muse API key configured');
const CAP = Number(process.env.STYLE_BUDGET_USD ?? 7);
const ledger = [];
const spent = () => ledger.reduce((n, r) => n + r.usd, 0);
const flush = () => save('ledger.json', ledger);
// Count the production pipeline's Muse calls too, by wrapping fetch for the generator's client.
const meteredFetch = async (url, init) => {
  const res = await fetch(url, init);
  const clone = res.clone();
  clone.json().then((j) => { const u = j.usage ?? {}; ledger.push({ label: 'pipeline', usd: ((u.prompt_tokens ?? 0) * 4 + (u.completion_tokens ?? 0) * 20) / 1e6 }); flush(); }).catch(() => {});
  return res;
};
const muse = new MuseClient({ apiKey: KEY, fetchImpl: meteredFetch });
async function ask(label, messages, max_tokens, effort = 'low') {
  if (spent() + max_tokens * 20 / 1e6 > CAP) throw Error('budget cap $' + CAP);
  const body = { model: 'muse-wonder-1.0', messages, max_tokens, reasoning_effort: effort, response_format: { type: 'json_object' } };
  const res = await fetch('https://api.meta.ai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000), redirect: 'error' });
  const entry = { label, usd: 0 };
  ledger.push(entry);
  if (!res.ok) { entry.error = res.status; flush(); throw Error(`${label}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); }
  const reply = await res.json(), u = reply.usage ?? {};
  entry.usd = ((u.prompt_tokens ?? 0) * 4 + (u.completion_tokens ?? 0) * 20) / 1e6;
  entry.finish = reply.choices?.[0]?.finish_reason; flush();
  return JSON.parse((reply.choices?.[0]?.message?.content ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
}

// ---- Engine capture -----------------------------------------------------------------------
const CAP_DIR = path.join(out, 'capture');
fs.mkdirSync(path.join(CAP_DIR, 'm'), { recursive: true });
fs.cpSync(path.join(REPO, 'backend/internal/staticsrv/player/runtime'), path.join(CAP_DIR, 'runtime'), { recursive: true });
{
  const player = fs.readFileSync(path.join(REPO, 'backend/internal/staticsrv/player/index.html'), 'utf8');
  const scripts = player.match(/<script src="runtime\/[^"]+"><\/script>/g).join('\n');
  fs.writeFileSync(path.join(CAP_DIR, 'capture.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="runtime/bubble-glow.css">
<style>body{margin:0;background:#000}#bubble-root{position:relative;width:390px;height:844px;overflow:hidden}</style></head>
<body><div id="bubble-root" class="palette-lilac-haze"><canvas id="bubble-canvas"></canvas></div><pre id="out" style="display:none">pending</pre>
${scripts}
<script>(async()=>{const q=new URLSearchParams(location.search),o=document.getElementById('out');
try{const m=await (await fetch(q.get('m'))).json();
const p={manifest:m,mode:'poster',player:{name:'Tester',best:null},muted:true,reduced_motion:true,insets:{top:0,bottom:0,left:0,right:0}};
const v=Bubble.validate(m),pr=JSON.parse(BubbleHost.prepare(p)),a=JSON.parse(BubbleHost.activate(pr.key,JSON.stringify(p)));
o.textContent=JSON.stringify({valid:v.ok,errors:v.errors,ok:pr.ok&&a.ok,error:pr.error||a.error});}catch(e){o.textContent='ERROR '+e.message}})();</script></body></html>`);
}
function capture(name, manifest) {
  const mf = path.join(CAP_DIR, 'm', name + '.json'), png = path.join(out, name + '.png');
  fs.writeFileSync(mf, JSON.stringify(manifest));
  const url = 'file://' + path.join(CAP_DIR, 'capture.html') + '?m=m/' + name + '.json';
  const common = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--window-size=390,844', '--force-device-scale-factor=1', '--virtual-time-budget=12000'];
  const dom = execFileSync(CHROME, [...common, '--dump-dom', url], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  const status = /<pre id="out"[^>]*>([\s\S]*?)<\/pre>/.exec(dom)?.[1].replace(/&quot;/g, '"') ?? 'missing';
  execFileSync(CHROME, [...common, `--screenshot=${png}`, url], { stdio: 'ignore' });
  return { png, status };
}

// ---- Roles a game's art can fill ----------------------------------------------------------
const FRAGMENT_ROLES = { player_drag: ['avatar'], lanes: ['avatar'], gravity_jump: ['avatar', 'ground'], spawn_wave: ['hazard'], pickups: ['pickup'], lives: ['life'], grid_board: ['cell'], match_pairs: ['card'], tile_slide: ['tile'], sort_bins: ['bin'], sequence_memory: ['pad'], quiz: ['button'], choice_story: ['scene', 'button'] };
function vbSize(svg) {
  const m = /viewBox\s*=\s*['"]\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg ?? '');
  return m ? [Math.round(Number(m[1])), Math.round(Number(m[2]))] : [64, 64];
}
function rolesOf(authoring) {
  const roles = [{ id: 'backdrop', kind: 'backdrop', width: 360, height: 640, play: 360, frames: 1, purpose: 'the full-screen backdrop behind everything' }];
  const seen = new Set();
  const add = (id, purpose, svg) => {
    if (seen.has(id)) return; seen.add(id);
    const first = Array.isArray(svg) ? svg[0] : svg;
    const [w, h] = vbSize(first);
    roles.push({ id, kind: 'sprite', width: w, height: h, play: Math.min(72, Math.max(w, h)), gutter: 3, frames: Array.isArray(svg) ? svg.length : 1, purpose });
  };
  const sprites = authoring.art?.sprites ?? {};
  for (const use of authoring.uses ?? []) {
    for (const role of FRAGMENT_ROLES[use.fragment] ?? []) {
      const name = use.art?.[role] ?? role;
      if (name === false) continue;
      add(name, `drawn by the ${use.fragment} fragment as its ${role}${use.params?.kind ? ` (${use.params.kind})` : ''}`, sprites[name]?.svg);
    }
  }
  for (const [name, s] of Object.entries(sprites)) add(name, 'a sprite the game draws by name', s.svg);
  return roles;
}

// ---- The two alternative art makers -------------------------------------------------------
const ENGINE_ROLES = ['ink', 'surface', 'accent', 'primary', 'secondary', 'bg', 'danger'];
const framesNote = (r) => r.frames > 1 ? ` Return a JSON array of ${r.frames} SVGs for this role, one per frame (variants such as different card faces or values), all the same size.` : '';
function gameFor(meta, roles, request) {
  return {
    roles: roles.map((r) => ({ ...r, purpose: r.purpose + framesNote(r) })),
    paletteRoles: ENGINE_ROLES,
    brief: `${meta.title}: ${meta.instructions ?? ''} (The player asked for: ${request})`,
    composition: 'The attached image is this game rendered by the engine with placeholder shapes: it shows where each sprite sits and how big it is. The engine draws the HUD, score, text, buttons and controls on top of your art. Keep the backdrop calm wherever the game puts text, HUD or controls, and keep detail out of the play area so moving sprites stay readable. Use bg for the backdrop\'s main color.',
  };
}
const withImage = (messages, png) => [...messages, { role: 'user', content: [{ type: 'text', text: 'The game\'s layout with placeholder shapes:' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64(png) } }] }];

function freeDrawMessages(game, request) {
  const system = [
    `Art-direct and draw a small phone game. Return one JSON object: ${game.roles.map((r) => r.id).join(', ')} as standalone SVG strings (each starts with <svg and has xmlns and the exact viewBox), plus "palette": {${ENGINE_ROLES.map((r) => `"${r}"`).join(', ')}} as #RRGGBB (ink = text color, bg = background, surface = cards and panels, primary/secondary/accent = game colors, danger = warnings). The engine uses the palette for its HUD, text and controls.`,
    ...game.roles.map((r) => `${r.id}: viewBox "0 0 ${r.width} ${r.height}", ${r.kind === 'backdrop' ? 'opaque, full bleed' : `transparent, shown about ${r.play} px, subject centred and filling the box`}. ${r.purpose}`),
    'Carry the requested style fully: palette, line, shading, texture, lighting and shape language. Any SVG drawing feature is fine: shapes, gradients, patterns, clip paths, masks, filters with local url(#id). No text, scripts, images, external references, links or animation. Sprites under 16 KB, backdrop under 40 KB.',
    game.composition,
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: `Game: ${game.brief}` }];
}

const asList = (v, n) => (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string').slice(0, Math.max(1, n));
function applyArt(authoring, palette, pieces, roles) {
  const a = structuredClone(authoring);
  const art = { ...(a.art ?? {}) };
  delete art.style;
  art.palette = Object.fromEntries(['primary', 'secondary', 'accent', 'ink', 'bg', 'danger', 'surface'].filter((k) => /^#[0-9a-fA-F]{6}$/.test(palette?.[k] ?? '')).map((k) => [k, palette[k].toUpperCase()]));
  const back = pieces.backdrop && asList(pieces.backdrop, 1)[0];
  if (back) art.backdrop = { svg: back }; else delete art.backdrop;
  const sprites = {};
  for (const r of roles) {
    if (r.kind === 'backdrop' || !pieces[r.id]) continue;
    const list = asList(pieces[r.id], r.frames);
    const old = authoring.art?.sprites?.[r.id] ?? {};
    sprites[r.id] = { svg: r.frames > 1 ? list : list[0], ...(old.w ? { w: old.w } : {}), ...(old.h ? { h: old.h } : {}), ...(old.fps ? { fps: old.fps } : {}) };
  }
  art.sprites = sprites;
  a.art = art;
  return a;
}
function build(authoring, manifest, id) {
  const text = JSON.stringify(authoring);
  const ex = studio.expand(text);
  if (!ex.ok) return { error: (ex.diagnostics ?? []).filter((d) => (d.severity ?? 'error') === 'error').slice(0, 4).map((d) => `${d.code} ${d.at ?? ''}: ${d.message}`).join(' | ') };
  return { manifest: studio.wrap({ id, game_json: ex.game_json, authoring_json: ex.authoring_json ?? text, brief: manifest.brief, seed: manifest.seed ?? manifest.content?.seed ?? 1 }) };
}

// ---- Run ----------------------------------------------------------------------------------
const opt = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
let requests = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--muse-requests');
if (opt('--muse-requests')) {
  const n = Number(opt('--muse-requests'));
  const got = await ask('requests', [{ role: 'system', content: 'Return JSON {"requests": [...]} only.' }, { role: 'user', content:
    `Write ${n} requests that different people might type to make a tiny one-thumb phone game to play with friends. Vary the game type as much as you can (dodging, catching, memory, sorting, matching, timing, jumping, quiz, merging) and give each its own theme and its own visual style in the person's own words. One or two sentences each, casual. No brand, franchise or artist names.` }], 2000);
  requests = [...requests, ...(got.requests ?? []).slice(0, n)];
}
save('requests.json', requests);
const slug = (p) => p.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
const pairs = [], errors = [], games = [];

await Promise.all(requests.map(async (request, k) => {
  const id = `g${k + 1}-${slug(request)}`;
  const log = (m) => console.log(`[${id}] ${m}`);
  try {
    log('composing');
    const brief = { intent: request, audience: 'friends', mood: ['playful'], energy: 'medium', competition: 'light' };
    const made = await compose({ request, brief }, { muse, studio, onEvent: (e) => e.kind === 'repairing' && log(e.summary) });
    const manifest = made.manifest;
    save(id + '.pipeline.manifest.json', manifest);
    const authoring = JSON.parse(manifest.content?.authoring_json ?? manifest.authoring_json ?? JSON.stringify(manifest.content?.authoring ?? {}));
    save(id + '.authoring.json', authoring);
    const meta = { title: manifest.title ?? authoring.meta?.title ?? id, instructions: authoring.meta?.instructions ?? manifest.one_line_rule ?? '' };
    const roles = rolesOf(authoring);
    log(`gate ${made.gate.passed ? 'passed' : 'flagged'}; roles: ${roles.map((r) => r.id + (r.frames > 1 ? `×${r.frames}` : '')).join(', ')}`);

    const arms = {};
    arms.pipeline = { ...capture(id + '-pipeline', manifest) };
    // Layout reference: the same game with no art (placeholder shapes), drawn by the engine.
    const bare = build({ ...structuredClone(authoring), art: { palette: authoring.art?.palette ?? {} } }, manifest, manifest.id);
    const layout = bare.manifest ? capture(id + '-layout', bare.manifest).png : arms.pipeline.png;
    const game = gameFor(meta, roles, request);

    const kitJob = (async () => {
      const rawSpec = await ask(id + '-director', directorMessages(game, request), 2500);
      save(id + '.spec.json', rawSpec);
      const { spec } = normalizeSpec(rawSpec);
      const pack = await ask(id + '-illustrator', withImage(illustratorMessages(game, spec), layout), 12000);
      save(id + '.kit.pack.json', pack);
      const compiled = {};
      for (const r of roles) {
        if (!pack[r.id]) continue;
        compiled[r.id] = asList(pack[r.id], r.frames).map((svg) => { try { return compileAsset(snapColors(svg, spec.palette).svg, spec, r); } catch { return null; } }).filter(Boolean);
        if (r.frames === 1) compiled[r.id] = compiled[r.id][0];
      }
      const b = build(applyArt(authoring, spec.palette, compiled, roles), manifest, manifest.id);
      if (b.error) throw Error('kit art rejected: ' + b.error);
      arms.kit = capture(id + '-kit', b.manifest);
    })().catch((e) => errors.push(`${id} kit: ${e.message}`));

    const freeJob = (async () => {
      const pack = await ask(id + '-freedraw', withImage(freeDrawMessages(game, request), layout), 16000);
      save(id + '.freedraw.pack.json', pack);
      const b = build(applyArt(authoring, pack.palette, pack, roles), manifest, manifest.id);
      if (b.error) throw Error('freedraw art rejected: ' + b.error);
      arms.freedraw = capture(id + '-freedraw', b.manifest);
    })().catch((e) => errors.push(`${id} freedraw: ${e.message}`));
    await Promise.all([kitJob, freeJob]);

    games.push({ id, request, title: meta.title, gate: made.gate, stats: made.stats, roles: roles.map((r) => r.id), arms: Object.fromEntries(Object.entries(arms).map(([a, v]) => [a, v.status])) });
    const names = ['pipeline', 'kit', 'freedraw'].filter((n) => arms[n]);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const [a, b] = Math.random() < 0.5 ? [names[j], names[i]] : [names[i], names[j]];
      const pair = { style: request, a, b, aPng: arms[a].png, bPng: arms[b].png, identical: false };
      try { const v = await ask(`${id}-judge-${a}-${b}`, pairwiseMessages(b64(arms[a].png), b64(arms[b].png)), 4000); pair.museOverall = v.overall; pair.muse = v; }
      catch (e) { pair.museError = e.message; }
      pairs.push(pair);
    }
    log('done');
  } catch (e) { errors.push(`${id}: ${e.message}`); log('failed: ' + e.message); }
}));

for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
pairs.forEach((p, i) => { p.id = 'p' + String(i + 1).padStart(2, '0'); });
save('games.json', games);
save('key.json', { pairs: pairs.map(({ aPng, bPng, ...r }) => r), errors, spentUsd: Math.round(spent() * 1000) / 1000 });
fs.writeFileSync(path.join(out, 'judge.html'), judgePage(pairs.map((p) => ({ id: p.id, style: p.style, a: 'data:image/png;base64,' + b64(p.aPng), b: 'data:image/png;base64,' + b64(p.bPng) }))));
console.log(JSON.stringify({ spentUsd: spent().toFixed(3), games: games.map((g) => ({ id: g.id, title: g.title, gate: g.gate.passed, arms: Object.keys(g.arms) })), pairs: pairs.length, errors }, null, 1));
