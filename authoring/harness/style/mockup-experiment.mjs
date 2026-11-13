// Mockup → SVG art test, on games made in the app's Studio. Nothing is drawn by hand: for each game,
//   1. muse-image-1.0 paints a mockup of the game screen in the requested style;
//   2. muse-wonder-1.0 sees the mockup and the game's real layout (drawn by the engine with no art)
//      and draws the backdrop, every sprite role and the palette as SVG to match the mockup.
// For comparison, the same game is also drawn by the current art pass (layout only, no mockup), and
// shown with the art Muse wrote inside the manifest. Every frame is the engine's own poster.
//
// node authoring/harness/style/mockup-experiment.mjs <out dir> <name>=<dir with authoring-before.json>::<request> ...
// (the app's art pass writes authoring-before.json to tmp/artpass/ in debug builds)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CHROME } from './render.mjs';

const [outDir, ...specs] = process.argv.slice(2);
if (!outDir || !specs.length) throw Error('Usage: mockup-experiment.mjs <out dir> <name>=<dir>::<request> ...');
const here = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(here, '../../..');
const out = path.resolve(outDir);
fs.mkdirSync(out, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(out, name), typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n');
const { loadStudio } = await import(path.join(REPO, 'backend/generator/src/studio.mjs'));
const studio = loadStudio(path.join(REPO, 'backend/generator/vendor'));

// ---- Muse ---------------------------------------------------------------------------------
const envFile = path.join(REPO, '.env');
const env = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
const KEY = process.env.MUSE_API_KEY || env.match(/^\s*(?:export\s+)?MUSE_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
if (!KEY) throw Error('No Muse API key configured');
const API = 'https://api.meta.ai/v1/';
const ledger = [];
const flush = () => save('ledger.json', ledger);
async function post(endpoint, body) {
  const res = await fetch(API + endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000), redirect: 'error' });
  if (!res.ok) throw Error(`${endpoint}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
async function chat(label, messages, max_tokens) {
  const started = Date.now();
  const reply = await post('chat/completions', { model: 'muse-wonder-1.0', messages, max_tokens, reasoning_effort: 'low', response_format: { type: 'json_object' } });
  const u = reply.usage ?? {};
  ledger.push({ label, model: reply.model, seconds: (Date.now() - started) / 1000, usd: ((u.prompt_tokens ?? 0) * 4 + (u.completion_tokens ?? 0) * 20) / 1e6, finish: reply.choices?.[0]?.finish_reason });
  flush();
  return JSON.parse((reply.choices?.[0]?.message?.content ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
}
async function paint(label, prompt) {
  const started = Date.now();
  const reply = await post('images/generations', { model: 'muse-image-1.0', prompt, n: 1 });
  const item = reply.data?.[0] ?? {};
  let bytes;
  if (item.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
  else if (item.url) bytes = Buffer.from(await (await fetch(item.url, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
  else throw Error(label + ': no image in the reply');
  ledger.push({ label, model: 'muse-image-1.0', seconds: (Date.now() - started) / 1000, usage: reply.usage ?? null });
  flush();
  return bytes;
}

// ---- Engine capture -----------------------------------------------------------------------
const CAP = path.join(out, 'capture');
fs.mkdirSync(path.join(CAP, 'm'), { recursive: true });
fs.cpSync(path.join(REPO, 'backend/internal/staticsrv/player/runtime'), path.join(CAP, 'runtime'), { recursive: true });
{
  const player = fs.readFileSync(path.join(REPO, 'backend/internal/staticsrv/player/index.html'), 'utf8');
  const scripts = player.match(/<script src="runtime\/[^"]+"><\/script>/g).join('\n');
  fs.writeFileSync(path.join(CAP, 'capture.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="runtime/bubble-glow.css">
<style>body{margin:0;background:#000}#bubble-root{position:relative;width:390px;height:844px;overflow:hidden}</style></head>
<body><div id="bubble-root" class="palette-lilac-haze"><canvas id="bubble-canvas"></canvas></div><pre id="out" style="display:none">pending</pre>
${scripts}
<script>(async()=>{const q=new URLSearchParams(location.search),o=document.getElementById('out');
try{const m=await (await fetch(q.get('m'))).json();
const p={manifest:m,mode:'poster',player:{name:'Tester',best:null},muted:true,reduced_motion:true,insets:{top:0,bottom:0,left:0,right:0}};
const pr=JSON.parse(BubbleHost.prepare(p)),a=JSON.parse(BubbleHost.activate(pr.key,JSON.stringify(p)));
o.textContent=JSON.stringify({ok:pr.ok&&a.ok,error:pr.error||a.error});}catch(e){o.textContent='ERROR '+e.message}})();</script></body></html>`);
}
function capture(name, manifest) {
  fs.writeFileSync(path.join(CAP, 'm', name + '.json'), JSON.stringify(manifest));
  const png = path.join(out, name + '.png');
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--window-size=390,844', '--force-device-scale-factor=1', '--virtual-time-budget=12000', `--screenshot=${png}`, 'file://' + path.join(CAP, 'capture.html') + `?m=m/${name}.json`], { stdio: 'ignore' });
  return png;
}
function build(authoring, id) {
  const text = typeof authoring === 'string' ? authoring : JSON.stringify(authoring);
  const ex = studio.expand(text);
  if (!ex.ok) return { error: (ex.diagnostics ?? []).filter((d) => (d.severity ?? 'error') === 'error').slice(0, 3).map((d) => `${d.code}: ${d.message}`).join(' | ') };
  return { manifest: studio.wrap({ id, game_json: ex.game_json, authoring_json: ex.authoring_json ?? text, seed: 7 }) };
}

// ---- Roles and prompts (same as the app's MicrogameArtPass) -------------------------------
const FRAGMENT_ROLES = { player_drag: ['avatar'], lanes: ['avatar'], gravity_jump: ['avatar', 'ground'], spawn_wave: ['hazard'], pickups: ['pickup'], lives: ['life'], grid_board: ['cell'], match_pairs: ['card'], tile_slide: ['tile'], sort_bins: ['bin'], sequence_memory: ['pad'], quiz: ['button'], choice_story: ['scene', 'button'] };
const vbSize = (svg) => {
  const m = /viewBox\s*=\s*['"]\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg ?? '');
  return m ? [Math.round(Number(m[1])), Math.round(Number(m[2]))] : [64, 64];
};
function rolesOf(a) {
  const roles = [{ id: 'backdrop', kind: 'backdrop', width: 360, height: 640, play: 360, frames: 1, purpose: 'the full-screen backdrop behind everything' }];
  const seen = new Set(), sprites = a.art?.sprites ?? {};
  const add = (id, purpose, svg) => {
    if (seen.has(id)) return; seen.add(id);
    const [w, h] = vbSize(Array.isArray(svg) ? svg[0] : svg);
    roles.push({ id, kind: 'sprite', width: w, height: h, play: Math.min(72, Math.max(w, h)), frames: Array.isArray(svg) ? svg.length : 1, purpose });
  };
  for (const use of a.uses ?? []) for (const role of FRAGMENT_ROLES[use.fragment] ?? []) {
    const name = use.art?.[role] ?? role;
    if (name !== false) add(name, `drawn by the ${use.fragment} fragment as its ${role}${use.params?.kind ? ` (${use.params.kind})` : ''}`, sprites[name]?.svg);
  }
  for (const [name, s] of Object.entries(sprites)) add(name, 'a sprite the game draws by name', s?.svg);
  return roles;
}
const P = ['ink', 'surface', 'accent', 'primary', 'secondary', 'bg', 'danger'];
function drawMessages(a, roles, request, images) {
  const frames = (r) => r.frames > 1 ? ` Return a JSON array of ${r.frames} SVGs for this role, one per frame, all the same size.` : '';
  const system = [
    `Art-direct and draw a small phone game. Return one JSON object: ${roles.map((r) => r.id).join(', ')} as standalone SVG strings (each starts with <svg and has xmlns and the exact viewBox), plus "palette": {${P.map((r) => `"${r}"`).join(', ')}} as #RRGGBB (ink = text color, bg = background, surface = cards and panels, primary/secondary/accent = game colors, danger = warnings). The engine uses the palette for its HUD, text and controls.`,
    ...roles.map((r) => `${r.id}: viewBox "0 0 ${r.width} ${r.height}", ${r.kind === 'backdrop' ? 'opaque, full bleed' : `transparent, shown about ${r.play} px, subject centred and filling the box`}. ${r.purpose}${frames(r)}`),
    'Carry the requested style fully: palette, line, shading, texture, lighting and shape language. Any SVG drawing feature is fine: shapes, gradients, patterns, clip paths, masks, filters with local url(#id). No text, scripts, images, external references, links or animation. Sprites under 16 KB, backdrop under 40 KB.',
    'The layout image is this game rendered by the engine with placeholder shapes: it shows where each sprite sits and how big it is. The engine draws the HUD, score, text, buttons and controls on top of your art. Keep the backdrop calm wherever the game puts text, HUD or controls, and keep detail out of the play area so moving sprites stay readable. Use bg for the backdrop\'s main color.',
    images.mockup ? 'The mockup image is the art target, painted for this game. Match it closely: its palette, rendering, texture, lighting, line quality and shape language, and how each thing in the game looks there. Translate it into SVG; where it disagrees with the layout, follow the layout.' : '',
  ].filter(Boolean).join('\n');
  const content = [];
  if (images.mockup) content.push({ type: 'text', text: 'The mockup (art target):' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + images.mockup.toString('base64') } });
  content.push({ type: 'text', text: 'The game\'s layout with placeholder shapes:' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + images.layout.toString('base64') } });
  return [{ role: 'system', content: system }, { role: 'user', content: `Game: ${a.meta?.title ?? 'microgame'}: ${a.meta?.instructions ?? ''} (The player asked for: ${request})` }, { role: 'user', content }];
}
function mockupPrompt(a, roles, request) {
  const things = roles.filter((r) => r.kind === 'sprite').map((r) => `${r.id} (${r.purpose})`).join('; ');
  return `A finished mobile game screen, portrait 9:16, for "${a.meta?.title ?? 'a microgame'}": ${a.meta?.instructions ?? ''}. Visual style: ${request}. Show the full-screen background scene and the game's things in play: ${things || 'just the scene'}. Leave a calm, plain band across the top for the score and timer and keep the middle of the screen uncluttered so the game stays readable. No text, letters, numbers, buttons, menus or watermark.`;
}
const asList = (v, n) => (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string').slice(0, Math.max(1, n));
function applyArt(a, pieces, roles) {
  const next = { ...(a.art ?? {}) };
  delete next.style;
  next.palette = Object.fromEntries(['primary', 'secondary', 'accent', 'ink', 'bg', 'danger', 'surface'].filter((k) => /^#[0-9a-fA-F]{6}$/.test(pieces.palette?.[k] ?? '')).map((k) => [k, pieces.palette[k].toUpperCase()]));
  const back = pieces.backdrop && asList(pieces.backdrop, 1)[0];
  if (back) next.backdrop = { svg: back }; else delete next.backdrop;
  const sprites = {};
  for (const r of roles) {
    if (r.kind === 'backdrop' || !pieces[r.id]) continue;
    const list = asList(pieces[r.id], r.frames), was = a.art?.sprites?.[r.id] ?? {};
    sprites[r.id] = { svg: r.frames > 1 ? list : list[0], ...(was.w ? { w: was.w } : {}), ...(was.h ? { h: was.h } : {}), ...(was.fps ? { fps: was.fps } : {}) };
  }
  next.sprites = sprites;
  return { ...a, art: next };
}

// ---- Run ----------------------------------------------------------------------------------
const rows = [];
await Promise.all(specs.map(async (spec) => {
  const [name, rest] = spec.split(/=(.*)/s);
  const [dir, request] = rest.split('::');
  const log = (m) => console.log(`[${name}] ${m}`);
  const text = fs.readFileSync(path.join(dir, 'authoring-before.json'), 'utf8');
  const a = JSON.parse(text);
  const roles = rolesOf(a);
  const row = { name, request, title: a.meta?.title ?? name, roles: roles.map((r) => r.id), cells: {}, notes: [] };
  rows.push(row);
  const before = build(text, name + '-before');
  if (before.error) { row.notes.push('original: ' + before.error); return; }
  row.cells.before = capture(name + '-before', before.manifest);
  const bare = build({ ...a, art: { palette: a.art?.palette ?? {} } }, name + '-layout');
  const layout = fs.readFileSync(bare.manifest ? capture(name + '-layout', bare.manifest) : row.cells.before);

  const pass = (async () => {
    log('art pass (layout only)');
    const pieces = await chat(name + ' art pass', drawMessages(a, roles, request, { layout }), 16000);
    save(name + '.artpass.json', pieces);
    const b = build(applyArt(a, pieces, roles), name + '-artpass');
    if (b.error) row.notes.push('art pass rejected: ' + b.error); else row.cells.artpass = capture(name + '-artpass', b.manifest);
  })().catch((e) => row.notes.push('art pass: ' + e.message));

  const mock = (async () => {
    log('painting mockup');
    const prompt = mockupPrompt(a, roles, request);
    save(name + '.mockup-prompt.txt', prompt);
    const raw = await paint(name + ' mockup', prompt);
    const rawFile = path.join(out, name + '-mockup.raw');
    fs.writeFileSync(rawFile, raw);
    const png = path.join(out, name + '-mockup.png');
    execFileSync('sips', ['-s', 'format', 'png', rawFile, '--out', png], { stdio: 'ignore' });
    row.cells.mockup = png;
    log('drawing SVG from the mockup');
    const pieces = await chat(name + ' from mockup', drawMessages(a, roles, request, { layout, mockup: fs.readFileSync(png) }), 16000);
    save(name + '.frommockup.json', pieces);
    const b = build(applyArt(a, pieces, roles), name + '-frommockup');
    if (b.error) row.notes.push('mockup SVG rejected: ' + b.error); else row.cells.frommockup = capture(name + '-frommockup', b.manifest);
  })().catch((e) => row.notes.push('mockup: ' + e.message));

  await Promise.all([pass, mock]);
  log('done' + (row.notes.length ? ': ' + row.notes.join('; ') : ''));
}));

// ---- Comparison sheet ---------------------------------------------------------------------
const cols = [['before', 'Art in the manifest'], ['artpass', 'Art pass (layout only)'], ['mockup', 'muse-image-1.0 mockup'], ['frommockup', 'Wonder SVG from the mockup']];
const img = (f) => f ? `<img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}">` : '<div class="miss">failed</div>';
const sheet = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#f3f1ec;font:14px -apple-system,sans-serif;color:#222}
h2{margin:18px 0 4px;font-size:17px}p{margin:0 0 8px;color:#666}.row{display:grid;grid-template-columns:repeat(4,300px);gap:12px}
.c b{display:block;margin-bottom:4px}.c img{width:300px;height:650px;object-fit:contain;background:#000;border-radius:10px}.miss{width:300px;height:650px;display:grid;place-items:center;background:#ddd;border-radius:10px}</style>
${rows.map((r) => `<h2>${r.title}</h2><p>“${r.request}” · roles: ${r.roles.join(', ')}${r.notes.length ? ' · ' + r.notes.join('; ') : ''}</p>
<div class="row">${cols.map(([k, label]) => `<div class="c"><b>${label}</b>${img(r.cells[k])}</div>`).join('')}</div>`).join('')}`;
save('sheet.html', sheet);
const height = 80 + rows.length * 740;
execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=1290,${height}`, '--force-device-scale-factor=1', `--screenshot=${path.join(out, 'sheet.png')}`, 'file://' + path.join(out, 'sheet.html')], { stdio: 'ignore' });
save('summary.json', rows);
console.log('sheet:', path.join(out, 'sheet.png'));
