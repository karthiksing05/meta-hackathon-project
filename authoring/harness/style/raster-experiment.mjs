// Raster art test: a game's art painted by muse-image-1.0 instead of drawn as SVG, rendered by the
// engine. Nothing is drawn by hand:
//   backdrop  muse-image-1.0 paints the empty scene (no characters or objects); scaled to 360×640 JPEG
//   sprites   Muse Wonder names what each sprite role depicts (a short noun); muse-image-1.0 paints each
//             one alone over flat green, one call per sprite; sam-3.1 finds it by that noun (bounding
//             box); code crops it, keys out the green and scales it to a transparent PNG
//             (v1 painted all sprites on one sheet: Muse Image drew a single huge piece instead)
//   palette   from Muse Wonder's SVG pass over the mockup (mockup-experiment.mjs), for the HUD
// Also a consistency check: the main sprite painted alone three times from the same prompt.
// Multi-frame roles (card faces, tiers) stay SVG here.
//
// node authoring/harness/style/raster-experiment.mjs <out dir> <mockup-experiment out dir> <name>=<dir with authoring-before.json>::<request> ...

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CHROME } from './render.mjs';

const [outDir, mockDir, ...specs] = process.argv.slice(2);
if (!outDir || !mockDir || !specs.length) throw Error('Usage: raster-experiment.mjs <out dir> <mockup out dir> <name>=<dir>::<request> ...');
const here = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(here, '../../..');
const out = path.resolve(outDir);
fs.mkdirSync(path.join(out, 'work'), { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(out, name), typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n');
const { loadStudio } = await import(path.join(REPO, 'backend/generator/src/studio.mjs'));
const studio = loadStudio(path.join(REPO, 'backend/generator/vendor'));

const env = fs.readFileSync(path.join(REPO, '.env'), 'utf8');
const KEY = process.env.MUSE_API_KEY || env.match(/^\s*(?:export\s+)?MUSE_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
if (!KEY) throw Error('No Muse API key configured');
const timings = [];
async function post(endpoint, body) {
  const res = await fetch('https://api.meta.ai/v1/' + endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000), redirect: 'error' });
  if (!res.ok) throw Error(`${endpoint}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
async function paint(label, prompt, file) {
  const t0 = Date.now();
  const r = await post('images/generations', { model: 'muse-image-1.0', prompt, n: 1 });
  const item = r.data?.[0] ?? {};
  const bytes = item.b64_json ? Buffer.from(item.b64_json, 'base64') : Buffer.from(await (await fetch(item.url, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
  const raw = file + '.raw';
  fs.writeFileSync(raw, bytes);
  execFileSync('sips', ['-s', 'format', 'png', raw, '--out', file], { stdio: 'ignore' });
  fs.rmSync(raw);
  timings.push({ label, model: 'muse-image-1.0', seconds: (Date.now() - t0) / 1000 });
  return file;
}
// sam-3.1 on /v1/responses: replies with <|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|> in the model's
// working size, plus a mask in an undocumented encoding (not used here).
async function find(label, pngFile, what) {
  const t0 = Date.now();
  const r = await post('responses', { model: 'sam-3.1', input: [{ role: 'user', content: [{ type: 'input_text', text: what }, { type: 'input_image', image_url: 'data:image/png;base64,' + fs.readFileSync(pngFile).toString('base64') }] }] });
  timings.push({ label, model: 'sam-3.1', seconds: (Date.now() - t0) / 1000 });
  const text = r.output?.[0]?.content?.[0]?.text ?? '';
  const boxes = [...text.matchAll(/<\|box;x1=([\d.]+);y1=([\d.]+);x2=([\d.]+);y2=([\d.]+);w=([\d.]+);h=([\d.]+)\|>/g)]
    .map((m) => m.slice(1).map(Number)).map(([x1, y1, x2, y2, w, h]) => ({ x1: x1 / w, y1: y1 / h, x2: x2 / w, y2: y2 / h }));
  return boxes;
}

// ---- Image work in headless Chrome (canvas): crop, key out green, scale ---------------------
function cutSprites(sheetFile, jobs) {
  // jobs: [{ id, box: {x1,y1,x2,y2} (0–1), max }] → { id: dataURL }
  const page = path.join(out, 'work', 'cut-' + path.basename(sheetFile, '.png') + '.html');
  fs.writeFileSync(page, `<!doctype html><pre id="out">pending</pre><script>
const jobs=${JSON.stringify(jobs)};const im=new Image();im.onload=()=>{const W=im.naturalWidth,H=im.naturalHeight,res={};
const c0=document.createElement('canvas');c0.width=W;c0.height=H;const g0=c0.getContext('2d');g0.drawImage(im,0,0);
const bg=g0.getImageData(2,2,1,1).data;
for(const j of jobs){const pad=0.01;let x1=Math.max(0,Math.floor((j.box.x1-pad)*W)),y1=Math.max(0,Math.floor((j.box.y1-pad)*H)),x2=Math.min(W,Math.ceil((j.box.x2+pad)*W)),y2=Math.min(H,Math.ceil((j.box.y2+pad)*H));
const w=x2-x1,h=y2-y1,d=g0.getImageData(x1,y1,w,h),p=d.data;
for(let i=0;i<p.length;i+=4){const r=p[i],g=p[i+1],b=p[i+2];
 const dist=Math.hypot(r-bg[0],g-bg[1],b-bg[2]);let a=Math.min(1,Math.max(0,(dist-60)/90));
 if(g>r&&g>b){const lim=Math.max(r,b);if(p[i+1]>lim)p[i+1]=Math.round(lim+(p[i+1]-lim)*(1-Math.min(1,(1-a)*1.5)));}
 p[i+3]=Math.round(a*255);}
const c1=document.createElement('canvas');c1.width=w;c1.height=h;c1.getContext('2d').putImageData(d,0,0);
const s=Math.min(1,j.max/Math.max(w,h)),c2=document.createElement('canvas');c2.width=Math.max(1,Math.round(w*s));c2.height=Math.max(1,Math.round(h*s));
const g2=c2.getContext('2d');g2.imageSmoothingQuality='high';g2.drawImage(c1,0,0,c2.width,c2.height);
res[j.id]={url:c2.toDataURL('image/webp',0.82),w:c2.width,h:c2.height};}
document.getElementById('out').textContent=JSON.stringify(res);};
im.src=${JSON.stringify('file://' + sheetFile)};</script>`);
  const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--virtual-time-budget=8000', '--dump-dom', 'file://' + page], { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  const json = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom)?.[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  return JSON.parse(json);
}

// ---- Engine capture ------------------------------------------------------------------------
const CAP = path.join(out, 'capture');
fs.mkdirSync(path.join(CAP, 'm'), { recursive: true });
fs.cpSync(path.join(REPO, 'backend/internal/staticsrv/player/runtime'), path.join(CAP, 'runtime'), { recursive: true });
{
  const player = fs.readFileSync(path.join(REPO, 'backend/internal/staticsrv/player/index.html'), 'utf8');
  const scripts = player.match(/<script src="runtime\/[^"]+"><\/script>/g).join('\n');
  fs.writeFileSync(path.join(CAP, 'capture.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="runtime/bubble-glow.css">
<style>body{margin:0;background:#000}#bubble-root{position:relative;width:390px;height:844px;overflow:hidden}</style></head>
<body><div id="bubble-root" class="palette-lilac-haze"><canvas id="bubble-canvas"></canvas></div>
${scripts}
<script>(async()=>{const q=new URLSearchParams(location.search);const m=await (await fetch(q.get('m'))).json();
const p={manifest:m,mode:'poster',player:{name:'Tester',best:null},muted:true,reduced_motion:true,insets:{top:0,bottom:0,left:0,right:0}};
const pr=JSON.parse(BubbleHost.prepare(p));BubbleHost.activate(pr.key,JSON.stringify(p));})();</script></body></html>`);
}
function capture(name, manifest) {
  fs.writeFileSync(path.join(CAP, 'm', name + '.json'), JSON.stringify(manifest));
  const png = path.join(out, name + '.png');
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--window-size=390,844', '--force-device-scale-factor=1', '--virtual-time-budget=12000', `--screenshot=${png}`, 'file://' + path.join(CAP, 'capture.html') + `?m=m/${name}.json`], { stdio: 'ignore' });
  return png;
}
function build(authoring, id) {
  const text = JSON.stringify(authoring);
  const ex = studio.expand(text);
  if (!ex.ok) return { error: (ex.diagnostics ?? []).filter((d) => (d.severity ?? 'error') === 'error').slice(0, 3).map((d) => `${d.code}: ${d.message}`).join(' | ') };
  return { manifest: studio.wrap({ id, game_json: ex.game_json, authoring_json: ex.authoring_json ?? text, seed: 7 }) };
}

// ---- Roles (as in MicrogameArtPass) ----------------------------------------------------------
const FRAGMENT_ROLES = { player_drag: ['avatar'], lanes: ['avatar'], gravity_jump: ['avatar', 'ground'], spawn_wave: ['hazard'], pickups: ['pickup'], lives: ['life'], grid_board: ['cell'], match_pairs: ['card'], tile_slide: ['tile'], sort_bins: ['bin'], sequence_memory: ['pad'], quiz: ['button'], choice_story: ['scene', 'button'] };
function rolesOf(a) {
  const roles = [], seen = new Set(), sprites = a.art?.sprites ?? {};
  const add = (id, purpose, svg) => { if (seen.has(id)) return; seen.add(id); roles.push({ id, purpose, frames: Array.isArray(svg) ? svg.length : 1 }); };
  for (const use of a.uses ?? []) for (const role of FRAGMENT_ROLES[use.fragment] ?? []) {
    const name = use.art?.[role] ?? role;
    if (name !== false) add(name, `the ${use.fragment} fragment's ${role}${use.params?.kind ? ` (${use.params.kind})` : ''}`, sprites[name]?.svg);
  }
  for (const [name, s] of Object.entries(sprites)) add(name, 'a decoration the game places by name', s?.svg);
  return roles;
}

// ---- Run -------------------------------------------------------------------------------------
const rows = [];
await Promise.all(specs.map(async (spec) => {
  const [name, rest] = spec.split(/=(.*)/s);
  const [dir, request] = rest.split('::');
  const log = (m) => console.log(`[${name}] ${m}`);
  const a = JSON.parse(fs.readFileSync(path.join(dir, 'authoring-before.json'), 'utf8'));
  const roles = rolesOf(a);
  const single = roles.filter((r) => r.frames === 1);
  const row = { name, request, title: a.meta?.title ?? name, roles: roles.map((r) => r.id), notes: [], sizes: {}, cells: {} };
  rows.push(row);
  const fromMock = JSON.parse(fs.readFileSync(path.join(mockDir, `${name}.frommockup.json`), 'utf8'));
  const game = `"${a.meta?.title}": ${a.meta?.instructions ?? ''}`;
  const t0 = Date.now();

  // What each sprite depicts, as a short noun (for the painter and for SAM).
  const t1 = Date.now();
  const named = await post('chat/completions', { model: 'muse-wonder-1.0', max_tokens: 1500, reasoning_effort: 'low', response_format: { type: 'json_object' }, messages: [
    { role: 'system', content: 'Return JSON {"<role id>": "<noun phrase>"} only.' },
    { role: 'user', content: `Game ${game} (the player asked for: ${request}). For each sprite role, say in 1–3 plain words the single object it shows (for example "koi fish", "pebble"): ${single.map((r) => `${r.id} (${r.purpose})`).join('; ')}` }] });
  const nouns = JSON.parse(named.choices[0].message.content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  timings.push({ label: name + ' nouns', model: 'muse-wonder-1.0', seconds: (Date.now() - t1) / 1000 });
  row.nouns = nouns;

  // Backdrop and every sprite in parallel (as Studio would run them).
  const backFile = path.join(out, 'work', `${name}-backdrop.png`);
  log('painting backdrop and ' + single.length + ' sprites');
  const cut = {};
  row.spriteFiles = [];
  await Promise.all([
    paint(name + ' backdrop', `The empty background scene for a mobile game, portrait 9:16, for ${game}. Visual style: ${request}. Only the setting: no characters, creatures, items, pickups or obstacles. A plain calm band across the top for the score. The middle two thirds of the screen must be a nearly plain surface (water, sky, paper, ground) with only faint texture, because game pieces and text go there; put the detail at the edges and corners. No text, letters, numbers, buttons or watermark.`, backFile),
    ...single.map(async (r) => {
      const noun = nouns[r.id] || r.id.replace(/_/g, ' ');
      const file = path.join(out, 'work', `${name}-sprite-${r.id}-raw.png`);
      try {
        await paint(`${name} sprite ${r.id}`, `A single ${noun}, a game sprite for ${game}. Visual style: ${request}. Exactly one ${noun}, whole and centred, filling most of the frame, alone on a perfectly flat pure green (#00FF00) background. Nothing else: no other objects, no scenery, no ground, no shadow, no frame, no text.`, file);
        row.spriteFiles.push(file);
        const boxes = await find(`${name} find ${r.id}`, file, noun).catch(() => []);
        const box = boxes.sort((p, q) => (q.x2 - q.x1) * (q.y2 - q.y1) - (p.x2 - p.x1) * (p.y2 - p.y1))[0];
        if (!box) row.notes.push(`sam found no ${noun}, used the whole image`);
        Object.assign(cut, cutSprites(file, [{ id: r.id, box: box ?? { x1: 0, y1: 0, x2: 1, y2: 1 }, max: 128 }]));
      } catch (e) {
        row.notes.push(`${r.id}: ${e.message}`);
      }
    }),
  ]);

  // Backdrop: 9:16 → 360×640 JPEG (sips), inside the art budget.
  const backJpg = path.join(out, 'work', `${name}-backdrop-360.jpg`);
  execFileSync('sips', ['-z', '640', '360', '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', backFile, '--out', backJpg], { stdio: 'ignore' });
  const backURL = 'data:image/jpeg;base64,' + fs.readFileSync(backJpg).toString('base64');
  row.sizes.backdrop = fs.statSync(backJpg).size;
  row.seconds = (Date.now() - t0) / 1000;

  // Raster art into the manifest (multi-frame roles keep their SVG).
  const art = { ...(a.art ?? {}) };
  delete art.style;
  art.palette = Object.fromEntries(Object.entries(fromMock.palette ?? {}).filter(([, v]) => /^#[0-9a-fA-F]{6}$/.test(v)).map(([k, v]) => [k, v.toUpperCase()]));
  art.backdrop = { image: backURL, w: 360, h: 640 };
  const sprites = { ...(a.art?.sprites ?? {}) };
  for (const r of single) {
    const c = cut[r.id];
    if (!c) continue;
    const old = a.art?.sprites?.[r.id] ?? {};
    const long = Math.max(old.w ?? 0, old.h ?? 0) || 64;
    const s = long / Math.max(c.w, c.h);
    sprites[r.id] = { image: c.url, w: Math.round(c.w * s), h: Math.round(c.h * s), ...(old.fps ? { fps: old.fps } : {}) };
    row.sizes[r.id] = Math.round(c.url.length * 0.75);
    fs.writeFileSync(path.join(out, `${name}-sprite-${r.id}.webp`), Buffer.from(c.url.split(',')[1], 'base64'));
  }
  art.sprites = sprites;
  row.sizes.total = Object.values(row.sizes).reduce((n, v) => n + v, 0);
  const b = build({ ...a, art }, name + '-raster');
  if (b.error) row.notes.push('raster game rejected: ' + b.error); else row.cells.raster = capture(name + '-raster', b.manifest);
  row.cells.sheet = row.spriteFiles[0];
  row.cells.backdrop = backFile;
  row.cells.frommockup = path.join(mockDir, `${name}-frommockup.png`);
  row.cells.mockup = path.join(mockDir, `${name}-mockup.png`);

  // Consistency: the main piece painted alone, three times, same prompt (skip with NO_REPEATS=1).
  const main = process.env.NO_REPEATS ? null : single[0];
  if (main) {
    log(`consistency: ${main.id} ×3`);
    row.repeats = await Promise.all([1, 2, 3].map((k) => paint(`${name} repeat ${k}`, `One game piece for ${game}: ${main.id} (${main.purpose}). Visual style: ${request}. Whole, centred, large, on a plain white background. No text or watermark.`, path.join(out, 'work', `${name}-repeat-${k}.png`)).catch((e) => { row.notes.push('repeat: ' + e.message); return null; })));
  }
  log('done ' + (row.notes.join('; ') || ''));
}));

// ---- Sheet ------------------------------------------------------------------------------------
const img = (f, h = 560) => f && fs.existsSync(f) ? `<img style="height:${h}px" src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}">` : `<div class="miss" style="height:${h}px">none</div>`;
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#f3f1ec;font:13px -apple-system,sans-serif;color:#222}
h2{margin:18px 0 2px;font-size:17px}p{margin:0 0 8px;color:#555}.r{display:flex;gap:12px;align-items:flex-start}.c b{display:block;margin-bottom:4px}
.c img{border-radius:8px;background:#000;display:block}.miss{width:250px;background:#ddd;display:grid;place-items:center;border-radius:8px}.rep img{height:180px;background:#fff}</style>
${rows.map((r) => `<h2>${r.title}</h2><p>“${r.request}” · ${r.seconds?.toFixed(0)} s for backdrop + sheet + SAM · art ${kb(r.sizes.total ?? 0)} (${Object.entries(r.sizes).filter(([k]) => k !== 'total').map(([k, v]) => `${k} ${kb(v)}`).join(', ')})${r.notes.length ? ' · ' + r.notes.join('; ') : ''}</p>
<div class="r"><div class="c"><b>muse-image mockup</b>${img(r.cells.mockup)}</div><div class="c"><b>Wonder SVG from mockup</b>${img(r.cells.frommockup)}</div><div class="c"><b>Raster art in the engine</b>${img(r.cells.raster)}</div><div class="c"><b>Sprites (cut out)</b><div style="display:grid;gap:8px;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/16px 16px;padding:8px;border-radius:8px">${Object.keys(r.sizes).filter((k) => k !== 'backdrop' && k !== 'total').map((k) => `<div><img style="height:96px;background:transparent" src="data:image/webp;base64,${fs.readFileSync(path.join(out, `${r.name}-sprite-${k}.webp`)).toString('base64')}"><div>${k}: ${r.nouns?.[k] ?? ''}</div></div>`).join('')}</div></div></div>
${r.repeats ? `<div class="r rep" style="margin-top:8px"><div class="c"><b>Same piece, 3 separate calls</b><div class="r">${r.repeats.map((f) => img(f, 180)).join('')}</div></div></div>` : ''}`).join('')}`;
save('sheet.html', html);
execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=1240,${60 + rows.length * 860}`, '--force-device-scale-factor=1', `--screenshot=${path.join(out, 'sheet.png')}`, 'file://' + path.join(out, 'sheet.html')], { stdio: 'ignore' });
save('summary.json', { rows: rows.map(({ cells, repeats, ...r }) => r), timings });
console.log('sheet:', path.join(out, 'sheet.png'));
