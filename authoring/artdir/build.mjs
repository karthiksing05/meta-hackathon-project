// Building a game on its art direction: the art from an `art-direct.mjs` run folder as engine assets,
// and small node helpers (text on the kit's type scale, 9-slice frames, sprites) for the game's own
// build script (authoring/artdir/gold/<key>.mjs). The build script keeps every rule and handler and
// writes a new presentation; finish.mjs then runs the gate, the verifier and the proofs.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { toBase64, decodePNG, encodePNG, quantize } from '../expander/image-codec.mjs';
import { cutNine, bakeNine } from './sheets.mjs';
import { lookFromChoice } from '../kit/look.mjs';
import { uiAsset, nineSlice } from './nine.mjs';
import { TALL } from './prompts.mjs';

const uri = (mime, bytes) => `data:${mime};base64,${toBase64(new Uint8Array(bytes))}`;
const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

/**
 * Reads a run folder: kit.json, backdrop.jpg, sprites/<id>.png (+ sprites.json), ui/<piece>.png
 * (+ ui.json). Missing parts are left out (a presentation-only game has only the kit).
 */
export function loadArt(dir) {
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f)) : null);
  const kit = JSON.parse(read('kit.json'));
  const art = { dir, kit, spec: lookFromChoice(kit.type), sprites: {}, ui: {}, baked: {} };
  const back = read('backdrop.jpg');
  if (back) art.backdrop = uri('image/jpeg', back);
  if (existsSync(join(dir, 'sprites'))) for (const f of readdirSync(join(dir, 'sprites')).filter((x) => x.endsWith('.png')).sort()) {
    const b = readFileSync(join(dir, 'sprites', f));
    art.sprites[f.slice(0, -4)] = { uri: uri('image/png', b), ...pngSize(b) };
  }
  const ui = read('ui.json') && JSON.parse(read('ui.json'));
  const inflate = (b) => new Uint8Array(zlib.inflateSync(b));
  const deflate = (b) => new Uint8Array(zlib.deflateSync(b, { level: 9 }));
  if (ui) for (const [id, p] of Object.entries(ui.pieces)) {
    const b = readFileSync(join(dir, 'ui', `${id}.png`));
    art.ui[id] = uiAsset(uri('image/png', b), p.w, p.h, p.insets, 2);
    const img = decodePNG(new Uint8Array(b), inflate);
    art.ui[id].img = img;
    art.ui[id].insetsPx = p.insets;
    // The nine pieces, for live (expression-sized) frames on engines without crops (nine.mjs mode 'pieces').
    art.ui[id].pieces = cutNine(img, p.insets).map((pc) => ({ uri: uri('image/png', encodePNG(pc, deflate)), w: Math.round((pc.w / 2) * 100) / 100, h: Math.round((pc.h / 2) * 100) / 100 }));
  }
  const wm = read('wordmark.png');
  if (wm) art.wordmark = { uri: uri('image/png', wm), ...pngSize(wm) };
  art.deflate = deflate;
  return art;
}

/**
 * The art as game.assets entries: `backdrop` (360 × 780), each sprite as `<prefix><id>` at half its
 * pixel size (sharp at 2×), every frame `frame()` baked, and for live frames (`frame(..., {live:
 * true})`) the nine pieces `ui_<piece>_0` … `_8` of each frame named in `ui`. A game draws one of several sprites with an asset expression
 * (`"asset": "= 'f' + str(idx)"`), so a set needs no sheet.
 */
export function artAssets(art, { prefix = '', skip = [], ui: used = null } = {}) {
  const assets = {};
  if (art.backdrop) assets.backdrop = { image: art.backdrop, w: TALL.w, h: TALL.h };
  for (const [id, s] of Object.entries(art.sprites)) {
    if (skip.includes(id)) continue;
    assets[prefix + id] = { image: s.uri, w: Math.round(s.w / 2), h: Math.round(s.h / 2) };
  }
  for (const [id, u] of Object.entries(art.ui)) {
    if (used && used.includes(id)) u.pieces.forEach((p, k) => { assets[`ui_${id}_${k}`] = { image: p.uri, w: p.w, h: p.h }; });
  }
  if (art.wordmark && !skip.includes('wordmark')) assets.wordmark = { image: art.wordmark.uri, w: Math.round(art.wordmark.w / 2), h: Math.round(art.wordmark.h / 2) };
  // Frames baked at their box by frame() (call artAssets after building the presentation).
  Object.assign(assets, art.baked);
  return assets;
}

/**
 * The kit's frame for `piece` at a box, as one image node: the 9-slice baked at this size (2×) into its
 * own asset `ui_<piece>_<w>x<h>`, so text written on it sits on one sprite. With `live: true` (a box
 * sized by expressions) it is a 9-slice group of nine pieces (nine.mjs) instead; name the piece in
 * artAssets' `ui`. Props go on the node.
 */
export function frame(art, piece, x, y, w, h, { corner = 1, live = false, ...props } = {}) {
  const u = art.ui[piece];
  if (!u) throw new Error(`no UI piece '${piece}' in ${art.dir}`);
  if (live || typeof w !== 'number' || typeof h !== 'number') return nineSlice({ asset: `ui_${piece}`, x, y, w, h, src: u.nine.src, insets: u.nine.insets, corner, ...props });
  const id = `ui_${piece}_${Math.round(w)}x${Math.round(h)}${corner !== 1 ? `_c${Math.round(corner * 100)}` : ''}`;
  if (!art.baked[id]) {
    const img = bakeNine(u.img, u.insetsPx, Math.round(w * 2), Math.round(h * 2), corner);
    art.baked[id] = { image: uri('image/png', encodePNG(img, art.deflate, { palette: quantize(img, 255) })), w: Math.round(w), h: Math.round(h) };
  }
  return { node: 'image', asset: id, x, y, w, h, ...props };
}

/**
 * A text node on the kit's type scale: `step` is caption, label, body, title, display or hero;
 * `numerals` uses the pairing's numerals face. Display steps follow the pairing's case.
 */
export function text(art, step, value, props = {}) {
  const st = art.spec.steps[step];
  const num = props.numerals && art.spec.numerals;
  const { numerals: _n, ...rest } = props;
  const literal = typeof value === 'string' && !value.startsWith('=');
  return {
    node: 'text',
    text: literal && st.upper && !num ? value.toUpperCase() : value,
    font: num ? art.spec.numerals.family : st.family,
    size: num ? art.spec.numerals.sizes[step] : st.size,
    weight: num ? art.spec.numerals.weight : st.weight,
    color: '$ink',
    ...rest,
  };
}

/**
 * The title wordmark as one image node, fitted into a box `maxW` × `maxH` centred on (cx, cy) keeping
 * its aspect. For the intro and the end card. null when the run folder has no wordmark.png.
 */
export function wordmark(art, cx, cy, maxW = 300, maxH = 130, props = {}) {
  if (!art.wordmark) return null;
  const aw = art.wordmark.w / 2, ah = art.wordmark.h / 2;
  const k = Math.min(maxW / aw, maxH / ah);
  const w = Math.round(aw * k), h = Math.round(ah * k);
  return { node: 'image', asset: 'wordmark', x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, ...props };
}

/**
 * The manifest's `presentation.app` (docs/BUBBLES.md 7.11, "App hooks"): what the app shows around the
 * game: the feed card's cover picture and wordmark (asset ids in game_json's `assets`), the palette the
 * result sheet uses, and the game's fonts. It sits on the manifest, next to `content`, never inside
 * game_json (the engine refuses unknown presentation keys). finish.mjs writes it from `notes.app`.
 */
export function appHooks(art, { cover = 'backdrop', wordmark: wm = art.wordmark ? 'wordmark' : null } = {}) {
  const p = art.kit.palette ?? {};
  const pick = (k) => p[k] ?? p.roles?.[k];
  const palette = Object.fromEntries(['bg', 'surface', 'primary', 'on_primary', 'accent', 'ink'].map((k) => [k, pick(k)]).filter(([, v]) => v));
  const steps = art.spec?.steps ?? {};
  const fonts = { display: steps.display?.family ?? steps.title?.family ?? null, text: steps.body?.family ?? null, numerals: art.spec?.numerals?.family ?? null };
  return { ...(cover ? { cover } : {}), ...(wm ? { wordmark: wm } : {}), palette, fonts: Object.fromEntries(Object.entries(fonts).filter(([, v]) => v)) };
}
