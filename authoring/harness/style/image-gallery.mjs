// A gallery of muse-image-1.0 game screens in many styles. Muse Wonder writes the requests (genre,
// theme and visual style, as different as it can make them); Muse Image paints each one. Nothing is
// picked or drawn by hand.
//
// node authoring/harness/style/image-gallery.mjs <out dir> [count, default 12] [--styles "cyberpunk|8-bit"]
// --styles: styles the person asked for; Muse Wonder uses each once and fills the rest with more in
// the same family.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CHROME } from './render.mjs';

const args = process.argv.slice(2);
const si = args.indexOf('--styles');
const asked = si >= 0 ? args.splice(si, 2)[1].split('|').map((x) => x.trim()).filter(Boolean) : [];
const [outDir, countArg] = args;
if (!outDir) throw Error('Usage: image-gallery.mjs <out dir> [count] [--styles "a|b"]');
const N = Number(countArg ?? 12);
const here = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(here, '../../..');
const out = path.resolve(outDir);
fs.mkdirSync(out, { recursive: true });
const env = fs.readFileSync(path.join(REPO, '.env'), 'utf8');
const KEY = process.env.MUSE_API_KEY || env.match(/^\s*(?:export\s+)?MUSE_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
if (!KEY) throw Error('No Muse API key configured');
const post = async (endpoint, body) => {
  const res = await fetch('https://api.meta.ai/v1/' + endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000), redirect: 'error' });
  if (!res.ok) throw Error(`${endpoint}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
};

const reply = await post('chat/completions', { model: 'muse-wonder-1.0', max_tokens: 4000, reasoning_effort: 'low', response_format: { type: 'json_object' }, messages: [
  { role: 'system', content: 'Return JSON {"games": [{"genre": "...", "title": "...", "style": "...", "prompt": "..."}]} only.' },
  { role: 'user', content: `Invent ${N} tiny one-thumb phone games, each a different genre (dodging, catching, runner, merging, match pairs, sorting, word, quiz, story choices, rhythm, stacking, board puzzle...) ${asked.length ? `and every one in the family of looks the person asked for: ${asked.join('; ')}. Use each of those once, then fill the rest with other looks from the same family only (the same kind of look they're after, not paintings or crafts unless they asked for those), each clearly distinct from the others.` : 'and each in a visual style as different from the others as you can make it: different media, eras, cultures, moods and palettes.'} No brand, franchise or artist names. For each, write "prompt": a request for an image model to paint one finished in-game screen, portrait 9:16, showing the scene and the game's pieces in play in that style. Ask for a plain calm band at the top for the score, and no text, letters, numbers or watermark.` },
] });
const games = JSON.parse(reply.choices[0].message.content.replace(/^```(?:json)?\s*|\s*```$/g, '')).games.slice(0, N);
fs.writeFileSync(path.join(out, 'games.json'), JSON.stringify(games, null, 2));
console.log(`${games.length} prompts written`);

await Promise.all(games.map(async (g, i) => {
  const id = String(i + 1).padStart(2, '0');
  const t0 = Date.now();
  try {
    const r = await post('images/generations', { model: 'muse-image-1.0', prompt: g.prompt, n: 1 });
    const item = r.data?.[0] ?? {};
    const bytes = item.b64_json ? Buffer.from(item.b64_json, 'base64') : Buffer.from(await (await fetch(item.url)).arrayBuffer());
    const raw = path.join(out, id + '.raw');
    fs.writeFileSync(raw, bytes);
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', raw, '--out', path.join(out, id + '.jpg')], { stdio: 'ignore' });
    fs.rmSync(raw);
    g.file = id + '.jpg';
    g.seconds = (Date.now() - t0) / 1000;
    console.log(`${id} ${g.genre}: ${g.seconds}s`);
  } catch (e) {
    g.error = e.message;
    console.log(`${id} failed: ${e.message}`);
  }
}));
fs.writeFileSync(path.join(out, 'games.json'), JSON.stringify(games, null, 2));

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#f3f1ec;font:13px -apple-system,sans-serif;color:#222}
.g{display:grid;grid-template-columns:repeat(4,280px);gap:14px}.c img{width:280px;height:498px;object-fit:cover;border-radius:10px;display:block;background:#ccc}
.c b{display:block;margin-top:6px;font-size:14px}.c span{color:#666}</style><div class="g">${games.map((g) => `<div class="c">${g.file ? `<img src="data:image/jpeg;base64,${fs.readFileSync(path.join(out, g.file)).toString('base64')}">` : '<div style="height:498px">failed</div>'}<b>${esc(g.title)}</b><span>${esc(g.genre)} · ${esc(g.style)}</span></div>`).join('')}</div>`;
fs.writeFileSync(path.join(out, 'gallery.html'), html);
const rows = Math.ceil(games.length / 4);
execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=1200,${32 + rows * 580}`, '--force-device-scale-factor=1', `--screenshot=${path.join(out, 'gallery.png')}`, 'file://' + path.join(out, 'gallery.html')], { stdio: 'ignore' });
console.log('gallery:', path.join(out, 'gallery.png'));
