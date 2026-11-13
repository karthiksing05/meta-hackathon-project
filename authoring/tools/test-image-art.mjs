#!/usr/bin/env node
// Tests for build-time picture art (authoring/expander/image-art.mjs, image-pixels.mjs, image-codec.mjs,
// sprite-check.mjs).
// No network: a fake image model paints sheets from the prompt. Run: node authoring/tools/test-image-art.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import zlib from 'node:zlib';
import * as C from '../expander/image-codec.mjs';
import * as X from '../expander/image-pixels.mjs';
import * as A from '../expander/image-art.mjs';
import * as SC from '../expander/sprite-check.mjs';
import { validateStoryGraph, compileStoryGraph } from '../expander/story-graph.mjs';
import { expand, loadLibrary } from '../expander/expand.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const inflate = (b) => new Uint8Array(zlib.inflateSync(b));
const deflate = (b) => new Uint8Array(zlib.deflateSync(b, { level: 9 }));
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${extra}`); } };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const px = (img, x, y) => Array.from(img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));

// ---------- a fake image model ----------

const PALETTE = [[220, 40, 40], [40, 160, 60], [40, 80, 220], [240, 200, 30], [30, 30, 30], [250, 140, 20], [120, 70, 30], [0, 170, 170], [200, 200, 200], [255, 120, 200], [120, 20, 140], [0, 90, 20], [255, 255, 255], [110, 210, 255], [150, 0, 30], [70, 70, 150]];
function paint(w, h, bg) { const im = X.blank(w, h); for (let i = 0; i < w * h; i++) im.data.set([...bg, 255], i * 4); return im; }
function disc(im, cx, cy, r, rgb) {
  for (let y = Math.max(0, cy - r - 2); y < Math.min(im.h, cy + r + 2); y++) for (let x = Math.max(0, cx - r - 2); x < Math.min(im.w, cx + r + 2); x++) {
    const d = Math.hypot(x - cx, y - cy);
    const a = Math.max(0, Math.min(1, r + 0.5 - d)); // anti-aliased edge
    if (a <= 0) continue;
    const o = (y * im.w + x) * 4;
    for (let c = 0; c < 3; c++) im.data[o + c] = Math.round(rgb[c] * a + im.data[o + c] * (1 - a));
  }
}
const KEYRGB = (prompt) => (/pure green/.test(prompt) ? [2, 250, 4] : /pure blue/.test(prompt) ? [3, 2, 250] : [250, 3, 248]);
function fakeImage(calls, { sameSet = false } = {}) {
  return async ({ prompt, purpose, reference }) => {
    calls?.push({ purpose, prompt, reference: !!reference });
    if (/Leia/.test(prompt)) throw new Error('400 {"error":{"code":"content_policy_violation","message":"The response was filtered"}}');
    let im;
    const grid = /(\d+) separate subjects arranged in a (\d+) columns x (\d+) rows/.exec(prompt);
    const lineup = /(\d+) head-and-shoulders portrait busts side by side/.exec(prompt);
    if (grid) {
      const [n, cols, rows] = grid.slice(1).map(Number);
      im = paint(960, 640, KEYRGB(prompt));
      const cw = 960 / cols, ch = 640 / rows;
      for (let k = 0; k < n; k++) disc(im, Math.round((k % cols) * cw + cw / 2), Math.round(Math.floor(k / cols) * ch + ch / 2), Math.round(Math.min(cw, ch) * 0.3), sameSet && /different figures of one collectible set/.test(prompt) && k >= 2 ? PALETTE[2] : PALETTE[k % PALETTE.length]);
    } else if (lineup) {
      const n = Number(lineup[1]);
      im = paint(960, 480, KEYRGB(prompt));
      for (let k = 0; k < n; k++) disc(im, Math.round((k + 0.5) * (960 / n)), 240, 90, PALETTE[k]);
    } else if (/One game sprite/.test(prompt)) {
      im = paint(400, 400, KEYRGB(prompt));
      disc(im, 200, 200, 150, PALETTE[prompt.length % PALETTE.length]);
    } else {
      im = X.blank(640, 960);
      for (let y = 0; y < 960; y++) for (let x = 0; x < 640; x++) im.data.set([(x * 255) / 640, (y * 255) / 960, 128, 255], (y * 640 + x) * 4);
    }
    return { bytes: C.encodePNG(im, deflate), usage: { total_tokens: 1000 } };
  };
}
const decode = (b) => C.decodePNG(b, inflate);

// ---------- codecs ----------

{
  const im = X.blank(37, 23);
  for (let i = 0; i < 37 * 23; i++) im.data.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, (i * 3) % 256], i * 4);
  const back = C.decodePNG(C.encodePNG(im, deflate), inflate);
  ok(back.w === 37 && back.h === 23 && same(back.data, im.data), 'PNG RGBA round trip');
  const opaque = { ...im, data: new Uint8ClampedArray(im.data) };
  for (let i = 3; i < opaque.data.length; i += 4) opaque.data[i] = 255;
  const enc = C.encodePNG(opaque, deflate);
  ok(enc[25] === 2, 'opaque PNG is written as RGB');
  ok(same(C.decodePNG(enc, inflate).data, opaque.data), 'PNG RGB round trip');
  const q = C.quantize(im, 64);
  ok(q.colors.length / 4 <= 64, 'quantize keeps to the color count', String(q.colors.length / 4));
  const pal = C.decodePNG(C.encodePNG(im, deflate, { palette: q }), inflate);
  ok(same(pal.data, C.dequantize(37, 23, q).data), 'palette PNG decodes to the quantized picture');
  ok(same(C.encodePNG(im, deflate, { palette: C.quantize(im, 64) }), C.encodePNG(im, deflate, { palette: q })), 'quantize + PNG is deterministic');
}
{
  const im = X.blank(50, 30);
  for (let y = 0; y < 30; y++) for (let x = 0; x < 50; x++) im.data.set([x * 5, y * 8, 120, 255], (y * 50 + x) * 4);
  const j1 = C.encodeJPEG(im, 70), j2 = C.encodeJPEG(im, 70);
  ok(j1[0] === 0xff && j1[1] === 0xd8 && j1[j1.length - 2] === 0xff && j1[j1.length - 1] === 0xd9, 'JPEG has SOI and EOI');
  ok(same(j1, j2), 'JPEG is deterministic');
  ok(C.encodeJPEG(im, 40).length < C.encodeJPEG(im, 90).length, 'JPEG quality changes size');
  // An outside decoder, when the Mac has one (sips), reads it back at the right size.
  try {
    const d = mkdtempSync(join(tmpdir(), 'jpg-'));
    writeFileSync(join(d, 'a.jpg'), j1);
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', join(d, 'a.jpg')], { encoding: 'utf8' });
    ok(/pixelWidth: 50/.test(out) && /pixelHeight: 30/.test(out), 'sips reads the JPEG');
    rmSync(d, { recursive: true });
  } catch { /* no sips: skipped */ }
  ok(C.toBase64(new Uint8Array([1, 2, 3, 4, 5])) === Buffer.from([1, 2, 3, 4, 5]).toString('base64'), 'base64 matches Node');
}

// ---------- keying, slicing, trimming ----------

{
  const im = paint(120, 80, [251, 2, 247]);
  disc(im, 60, 40, 25, [200, 30, 30]);
  ok(same(X.detectKey(im, X.KEYS.magenta), [251, 2, 247]), 'detectKey reads the painted background');
  const k = X.chromaKey(im, X.detectKey(im));
  ok(px(k, 2, 2)[3] === 0 && px(k, 117, 77)[3] === 0, 'corners are transparent');
  ok(px(k, 60, 40)[3] === 255 && px(k, 60, 40)[0] === 200, 'the subject stays opaque and unchanged');
  let fringe = 0;
  for (let i = 0; i < k.w * k.h; i++) {
    const [r, g, b, a] = Array.from(k.data.subarray(i * 4, i * 4 + 4));
    if (a > 0 && a < 255 && Math.min(r, b) > g + 60) fringe++;
  }
  ok(fringe === 0, 'no magenta fringe on the anti-aliased edge', String(fringe));
  const t = X.trim(k);
  ok(Math.abs(t.w - 51) <= 2 && Math.abs(t.h - 51) <= 2, 'trim fits the disc', `${t.w}x${t.h}`);
  // A hole of pure key inside the subject goes transparent too.
  const ring = paint(100, 100, [255, 0, 255]);
  disc(ring, 50, 50, 40, [20, 20, 200]);
  disc(ring, 50, 50, 12, [255, 0, 255]);
  ok(px(X.chromaKey(ring, [255, 0, 255]), 50, 50)[3] === 0, 'enclosed key-colored hole is transparent');
}
{
  const sheet = paint(300, 200, [255, 0, 255]);
  for (let k = 0; k < 6; k++) disc(sheet, (k % 3) * 100 + 50, Math.floor(k / 3) * 100 + 50, 30, PALETTE[k]);
  const s = X.sliceSheet(X.chromaKey(sheet, [255, 0, 255]), 6, 3, 2);
  ok(s.method === 'grid' && s.sprites.length === 6, 'clean grid slices by cells', s.method);
  ok(s.sprites.every((sp, k) => { const c = px(sp, sp.w >> 1, sp.h >> 1); return Math.abs(c[0] - PALETTE[k][0]) < 3 && Math.abs(c[2] - PALETTE[k][2]) < 3; }), 'cells come back in reading order');
  // The model ignored the grid: subjects straddle cell borders, so connected regions are used.
  const messy = paint(300, 200, [255, 0, 255]);
  const spots = [[100, 45], [205, 50], [270, 60], [40, 150], [150, 150], [262, 140]];
  spots.forEach(([x, y], k) => disc(messy, x, y, 26, PALETTE[k]));
  const m = X.sliceSheet(X.chromaKey(messy, [255, 0, 255]), 6, 3, 2);
  ok(m.method === 'regions', 'off-grid sheet falls back to regions', m.method);
  ok(m.sprites.every((sp, k) => { const c = px(sp, sp.w >> 1, sp.h >> 1); return Math.abs(c[1] - PALETTE[k][1]) < 3; }), 'regions come back in reading order');
  // Sparkles next to a subject are joined to it, not counted as a sprite.
  const sp = paint(200, 100, [255, 0, 255]);
  disc(sp, 50, 50, 30, [200, 150, 20]); disc(sp, 86, 20, 2, [255, 255, 255]); disc(sp, 150, 50, 30, [20, 20, 200]);
  ok(X.components(X.chromaKey(sp, [255, 0, 255])).length === 2, 'specks merge into the nearest subject');
}
{
  const im = paint(40, 20, [10, 20, 30]);
  const r = X.resize(im, 10, 5);
  ok(r.w === 10 && r.h === 5 && same(px(r, 3, 3), [10, 20, 30, 255]), 'resize keeps flat color');
  const f = X.fitInto(paint(40, 20, [9, 9, 9]), 30, 30);
  ok(f.w === 30 && f.h === 30 && px(f, 15, 2)[3] === 0 && px(f, 15, 15)[3] === 255, 'fitInto letterboxes with transparency');
  ok(X.cropAspect(paint(160, 90, [0, 0, 0]), 9 / 16).w === 51, 'cropAspect crops the middle');
}

// ---------- style, people, keys ----------

ok(A.findStyle('Make it pixel art please') === 'pixel_art', 'style: pixel art');
ok(A.findStyle('Studio Ghibli watercolor vibes') === 'watercolor', 'style: Ghibli watercolor');
ok(A.findStyle('LEGO city chase') === 'brick', 'style: LEGO');
ok(A.findStyle('claymation pets') === 'clay', 'style: claymation');
ok(A.findStyle('Leia escaping, like an 80s anime') === 'anime', 'style: 80s anime');
ok(A.findStyle('Angry Birds style physics game') === null, 'a game reference is not an art style');
{
  const g = A.guardPrompt('A photorealistic portrait of Jensen Huang holding a GPU, Liquid Death can on the desk', []);
  ok(g.changed && /a stylised cartoon caricature of Jensen Huang/.test(g.prompt), 'real person becomes a caricature', g.prompt);
  ok(!/photorealistic/i.test(g.prompt.split('Real people')[0]) && /never photorealistic/.test(g.prompt), 'photo words are removed and the rule added');
  ok(/Liquid Death can/.test(g.prompt), 'brands are untouched');
  ok(!A.guardPrompt('Tung Tung Tung Sahur running', []).changed, 'fictional characters are untouched');
  const twice = A.guardPrompt(A.guardPrompt('Mr. Beast hosting', []).prompt, []).prompt;
  ok((twice.match(/caricature of/g) ?? []).length === 1 + (twice.match(/caricatures/g) ? 0 : 0) && !/caricature of a stylised/.test(twice), 'the guard is idempotent on names');
  ok(A.guardPrompt('Pierre the baker', ['Pierre']).prompt.includes('caricature of Pierre'), 'names from art direction are guarded');
}
ok(A.pickKey({ roles: { avatar: 'Bombardiro Crocodilo, a green crocodile bomber' }, key: 'green' }) === 'magenta', 'key avoids green subjects');
ok(A.pickKey({ roles: { a: 'pink Labubu', b: 'green leaf' } }) === 'blue', 'key avoids pink and green');
ok(A.stripNames('Princess Leia runs past a Stormtrooper', ['Princess Leia', 'Stormtrooper']) === 'the character runs past a the character', 'stripNames replaces names');

// ---------- the sprite step, end to end with the fake model ----------

const game = {
  meta: { title: 'Crocodilo vs Pineapples', instructions: 'Drag to dodge.' },
  assets: {
    backdrop: { svg: '<svg viewBox="0 0 360 640"/>', w: 360, h: 640 },
    avatar: { svg: '<svg viewBox="0 0 64 56"/>', w: 64, h: 56, frames: 2, cols: 2, fps: 6 },
    pineapple: { svg: '<svg viewBox="0 0 59 64"/>', w: 59, h: 64 },
    bolt: { svg: '<svg viewBox="0 0 25 64"/>', w: 25, h: 64 },
    life: { svg: '<svg viewBox="0 0 64 55"/>', w: 64, h: 55 },
    music: { sound: 'data:audio/wav;base64,AAAA' },
  },
  presentation: { tokens: { primary: '#22AA55', accent: '#FFCC00' }, canvas: { background: '$bg' } },
  rules: [{ id: 'r1', on: 'tick', do: [] }],
};
const authoring = { authoring: 'microgame-authoring/0.1', art: { style: 'neon', sprites: { avatar: { svg: '<svg/>', color: '#22AA55' } } }, uses: [] };
const manifest = { id: 'mg-x', title: 'x', content: { game_json: JSON.stringify(game), authoring_json: JSON.stringify(authoring) } };
{
  const calls = [];
  const deps = { image: fakeImage(calls), decode, deflate };
  const a1 = await A.makeImageArt({ game, authoring, request: 'Galaga style shooter where Bombardiro Crocodilo bombs pineapples', style: 'pixel art' }, deps);
  const a2 = await A.makeImageArt({ game, authoring, request: 'Galaga style shooter where Bombardiro Crocodilo bombs pineapples', style: 'pixel art' }, { ...deps, image: fakeImage() });
  ok(calls.length === 2 && calls.some((c) => c.purpose === 'sheet 1') && calls.some((c) => c.purpose === 'backdrop'), 'sheet strategy: one sheet call and one backdrop call', JSON.stringify(calls.map((c) => c.purpose)));
  ok(Object.keys(a1.assets).sort().join() === 'avatar,backdrop,bolt,life,pineapple', 'every picture role gets an image, sounds are left alone', Object.keys(a1.assets).join());
  ok(JSON.stringify(a1.assets) === JSON.stringify(a2.assets), 'same input, same output bytes');
  ok(a1.assets.avatar.frames === 2 && a1.assets.avatar.cols === 2 && a1.assets.avatar.fps === 6 && a1.assets.avatar.w === 64 && a1.assets.avatar.h === 56, 'frames, size and fps are kept');
  ok(a1.assets.avatar.image.startsWith('data:image/png;base64,') && a1.assets.backdrop.image.startsWith('data:image/jpeg;base64,'), 'sprites are PNG, the backdrop JPEG');
  const avatarPNG = C.decodePNG(new Uint8Array(Buffer.from(a1.assets.avatar.image.split(',')[1], 'base64')), inflate);
  ok(avatarPNG.w === 2 * Math.round(avatarPNG.h / (56 / 64)) || Math.abs(avatarPNG.w / 2 / avatarPNG.h - 64 / 56) < 0.05, 'a 2-frame sheet with the asset aspect', `${avatarPNG.w}x${avatarPNG.h}`);
  const total = Object.values(a1.assets).reduce((s, x) => s + x.image.length, 0);
  ok(a1.fits && total <= A.IMAGE_ART_LIMITS.art_bytes, 'within the art budget', String(total));
  ok(a1.record.license === 'generated' && a1.record.pictures.every((p) => p.license === 'generated' && p.source === 'muse-image-1.0'), 'license: generated for every picture');
  ok(a1.sheet.id === 'pixel_art' && a1.sheet.pixel, 'the requested style is the style sheet');

  const next = A.applyImageArt(manifest, a1);
  const g2 = JSON.parse(next.content.game_json);
  const { assets: _a, ...restBefore } = game;
  const { assets: _b, ...restAfter } = g2;
  ok(JSON.stringify(restBefore) === JSON.stringify(restAfter), 'everything but the assets is unchanged (replays are safe)');
  ok(g2.assets.music.sound && !g2.assets.avatar.svg && g2.assets.avatar.image, 'svg swapped for image, sound kept');
  const au = JSON.parse(next.content.authoring_json);
  ok(au.art.sprites.avatar.image === a1.assets.avatar.image && au.art.sprites.avatar.color === '#22AA55' && au.art.backdrop.image, 'authoring art carries the same pictures (remixes keep them)');
  ok(next.art_record.pictures.length === 5, 'the manifest has the art record');

  const each = [];
  await A.makeImageArt({ game, authoring, request: 'x' }, { image: fakeImage(each), decode, deflate }, { strategy: 'each' });
  ok(each.length === 5, 'each strategy: one call per sprite plus the backdrop', String(each.length));

  // The budget steps down when it has to.
  const tight = await A.makeImageArt({ game, authoring, request: 'x' }, { image: fakeImage(), decode, deflate }, { budget: 9 * 1024 });
  const tTotal = Object.values(tight.assets).reduce((s, x) => s + x.image.length, 0);
  ok(tight.fits && tTotal <= 9 * 1024 && tight.stats.budget.steps > 1, 'a tight budget steps down until it fits', `${tTotal} after ${tight.stats.budget.steps} steps`);

  // Art direction (fake ask) names a real person: every prompt that names them is guarded.
  const seen = [];
  const ask = async () => ({ content: JSON.stringify({ roles: { avatar: 'Jensen Huang in a leather jacket' }, backdrop: 'a datacenter', real_people: ['Jensen Huang'], key: 'magenta' }), usage: { prompt_tokens: 10, completion_tokens: 5 } });
  await A.makeImageArt({ game, authoring, request: 'Jensen Huang simulator' }, { image: fakeImage(seen), decode, deflate, ask });
  const named = seen.filter((c) => /Jensen Huang/.test(c.prompt));
  ok(named.length > 0 && named.every((c) => /caricature of Jensen Huang/.test(c.prompt) && /never photorealistic/.test(c.prompt)), 'real people in prompts are caricatures');
}

// ---------- the sprite check ----------

{
  const onGrey = (rgb, r = 30, size = 80) => { const p = paint(size, size, [250, 3, 248]); disc(p, size >> 1, size >> 1, r, rgb); return X.chromaKey(p, [250, 3, 248]); };
  const red = onGrey(PALETTE[0]), red2 = onGrey(PALETTE[0]), blue = onGrey(PALETTE[2]), green = onGrey(PALETTE[1]);
  const c1 = SC.checkSprites([{ key: 'a', img: red }, { key: 'b', img: red2 }, { key: 'c', img: blue }]);
  ok(c1.issues.length === 1 && c1.issues[0].code === 'V_SPRITE_DUP' && c1.issues[0].keys.join() === 'a,b', 'V_SPRITE_DUP: two copies of one figure', JSON.stringify(c1.issues));
  ok(SC.checkSprites([{ key: 'r', img: red }, { key: 'g', img: green }, { key: 'b', img: blue }]).ok, 'figures in different colors pass');
  ok(SC.redrawKeys(c1).join() === 'b', 'the later of a duplicate pair is redrawn');
  const tiny = onGrey(PALETTE[0], 3);
  const c2 = SC.checkSprites([{ key: 'e', img: X.blank(40, 40) }, { key: 't', img: tiny, cell: tiny }]);
  ok(c2.issues.filter((i) => i.code === 'V_SPRITE_EMPTY').length === 2, 'V_SPRITE_EMPTY: empty and near-empty slices', JSON.stringify(c2.issues));
  // A cell that a figure runs off: opaque pixels along its edge.
  const cutCell = X.crop(onGrey(PALETTE[0], 30, 80), 0, 0, 50, 80);
  const c3 = SC.checkSprites([{ key: 'cut', img: X.trim(cutCell), cell: cutCell }, { key: 'whole', img: X.trim(blue), cell: blue }]);
  ok(c3.issues.some((i) => i.code === 'V_SPRITE_CUT' && i.keys[0] === 'cut') && !c3.issues.some((i) => i.keys.includes('whole')), 'V_SPRITE_CUT: a slice cut across a figure', JSON.stringify(c3.issues));
  const two = paint(160, 80, [250, 3, 248]); disc(two, 40, 40, 30, PALETTE[0]); disc(two, 120, 40, 30, PALETTE[2]);
  const c4 = SC.checkSprites([{ key: 'two', img: X.chromaKey(two, [250, 3, 248]) }]);
  ok(c4.issues.some((i) => i.code === 'V_SPRITE_MULTI'), 'V_SPRITE_MULTI: two figures in one slice', JSON.stringify(c4.issues));
  ok(SC.checkSprites([{ key: 'one', img: red }]).issues.length === 0, 'one whole figure passes');
  const strip = X.blank(160, 40); X.paste(strip, X.fitInto(red, 40, 40), 0, 0); X.paste(strip, X.fitInto(blue, 40, 40), 40, 0); X.paste(strip, X.fitInto(red, 40, 40), 80, 0); X.paste(strip, X.fitInto(green, 40, 40), 120, 0);
  const fr = SC.splitFrames(strip, 4, 4);
  ok(fr.length === 4 && fr[1].w === 40, 'splitFrames cuts a frame strip');
  const sc = SC.checkSprites(fr.map((f, k) => ({ key: k, img: f })));
  ok(sc.issues.length === 1 && sc.issues[0].keys.join() === '0,2', 'frame check finds the repeated frame', JSON.stringify(sc.issues));
}

// ---------- one picture per item: a set asset (nine figures, frame chosen by the game) ----------

const NAMES = ['Coco Labubu', 'Berry Labubu', 'Mint Labubu', 'Lilac Labubu', 'Peach Labubu', 'Sky Labubu', 'Rose Labubu', 'Coral Labubu', 'Golden Labubu'];
const setGame = {
  meta: { title: 'Blind Box Set', instructions: 'Tap the box to open it.' },
  assets: {
    backdrop: { svg: '<svg viewBox="0 0 360 640"/>', w: 360, h: 640 },
    blind_box: { svg: '<svg/>', w: 64, h: 55 },
    book_slot: { svg: '<svg/>', w: 64, h: 64 },
    labubu: { svg: '<svg/>', w: 64, h: 64, frames: 9, cols: 9 },
    runner: { svg: '<svg/>', w: 64, h: 64, frames: 4, cols: 4, fps: 8 },
  },
  state: {
    content_figures: { type: 'list<string>', init: `[${NAMES.map((n) => `'${n}'`).join(', ')}]` },
    content_short: { type: 'list<string>', init: "['COCO', 'BERRY', 'MINT', 'LILAC', 'PEACH', 'SKY', 'ROSE', 'CORAL', 'GOLD']" },
    content_end_lines: { type: 'list<string>', init: "['One lonely silhouette left in the book. So close!', 'b']" },
    last_idx: { type: 'int', init: '-1' },
  },
  presentation: { tokens: { primary: '#E0457B' }, canvas: { background: '#FFF4E8' }, root: { node: 'group', children: [{ node: 'image', asset: 'backdrop' }, { node: 'image', asset: 'labubu', frame: '= last_idx', w: 104, h: 104 }, { node: 'image', asset: 'runner' }] } },
  rules: [{ id: 'open', on: 'tap_box', do: [] }],
};
{
  const roles = A.spriteRoles(setGame);
  const lab = roles.find((r) => r.id === 'labubu');
  ok(lab.variants?.join() === NAMES.join(), 'a set asset gets one name per frame from the content list', JSON.stringify(lab.variants));
  ok(!roles.find((r) => r.id === 'runner').variants && !roles.find((r) => r.id === 'blind_box').variants, 'animations (fps) and single pictures are not sets');
  const clock = { ...setGame, presentation: { root: { node: 'image', asset: 'labubu', frame: '= floor(time * 6) % 9' } } };
  ok(!A.variantNames(clock, null, 'labubu', setGame.assets.labubu), 'a frame driven by the clock is an animation');
  ok(A.variantNames({ assets: {} }, null, 'gem', { frames: 3 }).join() === 'gem 1,gem 2,gem 3', 'a set with no names gets numbered names');
  const looks = NAMES.map((n, k) => A.variantLook(n, k, new Set()));
  ok(/mint green/.test(looks[2]) && /sky blue/.test(looks[5]) && /gold/.test(looks[8]), 'fallback looks take the color from the name', looks[2]);
  const used = new Set();
  const colors = Array.from({ length: 16 }, (_, k) => A.variantLook(`gem ${k + 1}`, k, used).split(': ')[1].split(' all over')[0]);
  ok(new Set(colors).size === 16, 'sixteen fallback looks, sixteen colors', colors.join('|'));
  const pack = A.packSheets(Array.from({ length: 20 }, (_, k) => ({ key: k, role: k < 2 ? 'a' : 'set' })));
  ok(pack.length === 2 && pack.every((g) => g.length <= 16), 'at most 16 pictures per sheet, the rest on a second sheet', pack.map((g) => g.length).join());
  ok(A.packSheets(Array.from({ length: 11 }, (_, k) => ({ key: k, role: k < 2 ? k : 'set' }))).length === 1, 'eleven pictures fit one sheet');
}
{
  const calls = [];
  const dir = { roles: { blind_box: 'a sealed box', book_slot: 'an empty book slot', labubu: 'cream Labubu waving' }, variants: { labubu: NAMES.map((n, k) => `${n}: ${['brown', 'red', 'mint', 'lilac', 'peach', 'blue', 'pink', 'coral', 'gold'][k]} fur, outfit ${k}, pose ${k}`) }, backdrop: 'a toy shop', real_people: [], key: 'green' };
  const ask = async () => ({ content: JSON.stringify(dir), usage: { prompt_tokens: 10, completion_tokens: 5 } });
  const asked = [];
  const askSpy = async (s, u) => { asked.push({ s, u }); return ask(); };
  const art = await A.makeImageArt({ game: setGame, request: 'Pop Mart blind box game to finish the Labubu set' }, { image: fakeImage(calls), decode, deflate, ask: askSpy });
  ok(/"variants"/.test(asked[0].s) && NAMES.every((n) => asked[0].u.includes(n)), 'art direction asks for one look per item, by name');
  const sheetCall = calls.find((c) => c.purpose === 'sheet 1');
  ok(calls.filter((c) => c.purpose.startsWith('sheet')).length === 1 && /12 separate subjects arranged in a 4 columns x 3 rows/.test(sheetCall.prompt), 'one sheet: 2 pictures, 9 figures and the runner', calls.map((c) => c.purpose).join());
  ok(NAMES.every((n) => sheetCall.prompt.includes(n)) && /different figures of one collectible set/.test(sheetCall.prompt) && /Lilac Labubu: lilac fur/.test(sheetCall.prompt), 'the sheet prompt lists every figure by name with its look');
  ok(!/cream Labubu waving/.test(sheetCall.prompt), "the role's single look does not pull the set together");
  ok(art.stats.sprite_check.ok && !art.stats.retried, 'the sprite check passes a sheet of different figures', JSON.stringify(art.stats.sprite_check));
  ok(art.assets.labubu.frames === 9 && art.assets.labubu.cols === 9 && art.assets.labubu.w === 64 && art.assets.labubu.h === 64, 'the set asset keeps its frames and size');
  const png = C.decodePNG(new Uint8Array(Buffer.from(art.assets.labubu.image.split(',')[1], 'base64')), inflate);
  const frames = SC.splitFrames(png, 9, 9);
  const fc = SC.checkSprites(frames.map((f, k) => ({ key: k, img: f })));
  ok(fc.ok, 'every frame of the set is a different figure', JSON.stringify(fc.issues.slice(0, 2)));
  ok(frames.every((f, k) => { const c = px(f, f.w >> 1, f.h >> 1); const want = PALETTE[(k + 2) % PALETTE.length]; return Math.abs(c[0] - want[0]) < 30 && Math.abs(c[2] - want[2]) < 30; }), 'frame k is item k (sheet order)');
  ok(SC.checkGameSets(JSON.parse(A.applyImageArt({ content: { game_json: JSON.stringify(setGame) } }, art).content.game_json), (b) => C.decodePNG(b, inflate)).ok, 'checkGameSets passes the made game');
  ok(art.record.pictures.find((p) => p.id === 'labubu').frames.join() === NAMES.join(), 'the art record names each frame');
  const next = JSON.parse(A.applyImageArt({ content: { game_json: JSON.stringify(setGame) } }, art).content.game_json);
  const strip = (g) => { const { assets: _, ...r } = g; return JSON.stringify(r); };
  ok(strip(next) === strip(setGame), 'pictures per item change no rules, state or presentation');

  // The model draws the same figure for the whole set: the check flags it and redraws at most 4.
  const same = [];
  const bad = await A.makeImageArt({ game: setGame, request: 'x' }, { image: fakeImage(same, { sameSet: true }), decode, deflate, ask });
  ok(bad.stats.sprite_check.issues.some((i) => i.startsWith('V_SPRITE_DUP labubu#')), 'look-alike figures are flagged V_SPRITE_DUP', JSON.stringify(bad.stats.sprite_check.issues.slice(0, 3)));
  ok(same.filter((c) => /redraw/.test(c.purpose)).length === A.IMAGE_ART_LIMITS.max_redraws && bad.stats.retried.length === A.IMAGE_ART_LIMITS.max_redraws, 'flagged figures are redrawn one by one, capped', String(same.length));
  // A live manifest with one picture in every frame (the bug) fails checkGameSets.
  const oldStyle = { ...art.assets.labubu };
  const one = frames[0];
  const rep = X.blank(one.w * 9, one.h); for (let k = 0; k < 9; k++) X.paste(rep, one, k * one.w, 0);
  oldStyle.image = 'data:image/png;base64,' + Buffer.from(C.encodePNG(rep, deflate)).toString('base64');
  const g3 = { assets: { labubu: oldStyle } };
  const gc = SC.checkGameSets(g3, (b) => C.decodePNG(b, inflate));
  ok(!gc.ok && gc.assets.labubu.issues.filter((i) => i.code === 'V_SPRITE_DUP').length === 36, 'checkGameSets flags a set drawn as one figure nine times', String(gc.assets.labubu.issues.length));
}

// ---------- stories ----------

{
  const raw = JSON.parse(readFileSync(join(ROOT, 'stories/kevin_01_leia_escape.story.json'), 'utf8'));
  const report = validateStoryGraph(raw);
  const { manifest: story } = compileStoryGraph(raw, { report });
  const scenes = A.storyScenes(story);
  ok(scenes.length === report.graph.nodes.length && scenes[0].next.length > 0, 'storyScenes reads the compiled graph');
  const still = A.inheritStills(scenes, { 0: 0, [scenes.length - 1]: 1 });
  ok(still.length === scenes.length && still.every((v) => v >= 0), 'every scene inherits a still');
  const calls = [];
  const art = await A.makeStoryArt({ authoring: story, request: raw.request, style: '80s anime' }, { image: fakeImage(calls), decode, deflate });
  ok(calls[0].purpose === 'character lineup' && calls.filter((c) => c.purpose === 'character lineup').every((c) => !c.reference) && calls.filter((c) => c.purpose.startsWith('still')).every((c) => c.reference) && calls.some((c) => c.purpose.startsWith('still')), 'lineup first, then stills drawn with it as the reference');
  ok(calls.filter((c) => /Leia/.test(c.prompt)).length >= 1 && (art.stats.policy_rewrites ?? []).length >= 1, 'a refused prompt is rewritten and retried', JSON.stringify(art.stats.policy_rewrites));
  ok(art.params.stills.split('.').length === scenes.length && art.params.cast_at.split('.').length === scenes.length, 'one still and one portrait per scene');
  ok(art.sprites.portrait.frames === art.direction.cast.length && art.sprites.still.frames >= 1, 'portrait and still sheets');
  ok(art.record.license === 'generated' && art.sheet.id === 'anime', 'story record and style');
  const lib = loadLibrary(ROOT);
  const plain = expand(story, lib);
  const withArt = expand(A.applyStoryArt(story, art), lib);
  const errs = (x) => (x.diagnostics ?? []).filter((d) => d.severity === "error");
  ok(!errs(plain).length && !errs(withArt).length, 'the story with pictures expands', JSON.stringify(errs(withArt).slice(0, 2)));
  if (!errs(plain).length && !errs(withArt).length) {
    ok(JSON.stringify(plain.game.rules) === JSON.stringify(withArt.game.rules) && JSON.stringify(plain.game.state) === JSON.stringify(withArt.game.state), 'pictures change no rules or state');
    ok(withArt.game.assets.portrait?.image && withArt.game.assets.still?.image, 'the expanded game carries portrait and still');
    const total = Object.values(withArt.game.assets).reduce((s, a) => s + (a.image ?? a.svg ?? '').length, 0);
    ok(total <= A.IMAGE_ART_LIMITS.art_bytes, 'story art within the budget', String(total));
  }
}

console.log(`image art: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
