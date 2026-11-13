// The manifest's `art` section (authoring/SPEC.md 2.8): palette, font, backdrop and sprites, turned
// into engine assets, token overrides and the facts fragments read through `@art.<role>`.
// Pure JS (its only import is svg.mjs), so the app can bundle it with the expander.

import { sanitizeSvg, composeSheet, utf8Length, SVG_LIMITS } from './svg.mjs';

export const PALETTE_ROLES = ['primary', 'secondary', 'accent', 'ink', 'bg', 'danger', 'surface'];
// Families the app can draw offline: the look fonts plus fonts every iPhone has. `system` is the
// platform UI font.
export const FONTS = [
  'system', 'Inter', 'Fraunces', 'Space Grotesk', 'Silkscreen',
  'Avenir Next', 'Futura', 'Gill Sans', 'Optima', 'Georgia', 'Baskerville', 'American Typewriter',
  'Chalkboard SE', 'Marker Felt', 'Noteworthy', 'Menlo', 'Courier New',
];
const SPRITE_KEYS = ['svg', 'image', 'w', 'h', 'frames', 'cols', 'fps', 'color'];
const NAME = /^[a-z][a-z0-9_]{0,23}$/;
const RESERVED = ['backdrop', 'music'];
const HEX = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;
const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_SPRITES = 32;
const esc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');

// Default asset size from a viewBox: the longer side becomes 64 canvas units.
function sizeFrom(vb) {
  const k = 64 / Math.max(vb.w, vb.h);
  return { w: Math.max(1, Math.round(vb.w * k)), h: Math.max(1, Math.round(vb.h * k)) };
}

/**
 * Reads `art`. err(code, at, message, extra) reports model diagnostics.
 * Returns {assets, sprites: {name: {id, frames, aspect, color}}, tokens, font, backdrop}.
 */
export function compileArt(art, canvas, err) {
  const out = { assets: {}, sprites: {}, tokens: {}, font: undefined, backdrop: null };
  if (art === undefined) return out;
  if (!art || typeof art !== 'object' || Array.isArray(art)) { err('A_ART_FIELD', '/art', 'art must be an object'); return out; }
  for (const k of Object.keys(art)) {
    if (!['palette', 'font', 'backdrop', 'sprites', 'style'].includes(k)) err('A_ART_FIELD', `/art/${esc(k)}`, `art has no field '${k}' (palette, font, backdrop, sprites, style)`);
  }

  for (const [role, v] of Object.entries(art.palette ?? {})) {
    const at = `/art/palette/${esc(role)}`;
    if (!PALETTE_ROLES.includes(role)) { err('A_ART_PALETTE', at, `the palette has no role '${role}'`, { hint: `roles are ${PALETTE_ROLES.join(', ')}; put game-only colors in look.tokens` }); continue; }
    if (typeof v !== 'string' || !HEX.test(v)) { err('A_ART_PALETTE', at, `${role} must be a #RRGGBB color`); continue; }
    out.tokens[role] = v.toUpperCase();
  }
  if (art.font !== undefined) {
    if (!FONTS.includes(art.font)) err('A_ART_FONT', '/art/font', `'${art.font}' isn't an available font`, { hint: `one of ${FONTS.join(', ')}` });
    else out.font = art.font;
  }

  let total = 0, svgTotal = 0, pictures = 0;
  const addAsset = (id, asset) => {
    total += utf8Length(asset.svg ?? asset.image ?? '');
    if (asset.image !== undefined) pictures++;
    else svgTotal += utf8Length(asset.svg ?? '');
    out.assets[id] = asset;
  };

  if (art.backdrop !== undefined) {
    const b = compileSprite(art.backdrop, '/art/backdrop', SVG_LIMITS.backdrop_bytes, err, { w: canvas.w, h: canvas.h });
    if (b) { addAsset('backdrop', b.asset); out.backdrop = { id: 'backdrop', w: canvas.w, h: canvas.h }; }
  }

  const sprites = art.sprites ?? {};
  if (typeof sprites !== 'object' || Array.isArray(sprites)) err('A_ART_FIELD', '/art/sprites', 'sprites is an object: {"avatar": {"svg": "<svg ...>"}}');
  else {
    const names = Object.keys(sprites);
    if (names.length > MAX_SPRITES) err('A_ART_SIZE', '/art/sprites', `${names.length} sprites; the limit is ${MAX_SPRITES}`);
    for (const name of names) {
      const at = `/art/sprites/${esc(name)}`;
      if (!NAME.test(name) || RESERVED.includes(name)) { err('A_ART_FIELD', at, `sprite name '${name}' must be lowercase letters, digits and _ (max 24), and not ${RESERVED.join(' or ')}`); continue; }
      const s = compileSprite(sprites[name], at, SVG_LIMITS.sprite_bytes, err);
      if (!s) continue;
      addAsset(name, s.asset);
      out.sprites[name] = { id: name, frames: s.asset.frames ?? 1, aspect: Math.round((s.asset.h / s.asset.w) * 1000) / 1000, color: s.color };
    }
  }
  // Picture art (muse-image) gets the larger budget; the SVGs in it still fit the SVG budget.
  const limit = pictures ? SVG_LIMITS.image_art_bytes : SVG_LIMITS.art_bytes;
  if (total > limit) err('A_ART_SIZE', '/art', `the art adds up to ${Math.ceil(total / 1024)} KB; the limit is ${limit / 1024} KB. ${pictures ? 'Use fewer or smaller pictures' : 'Simplify the SVGs'}`);
  else if (pictures && svgTotal > SVG_LIMITS.art_bytes) err('A_ART_SIZE', '/art', `the SVG art adds up to ${Math.ceil(svgTotal / 1024)} KB; the limit is ${SVG_LIMITS.art_bytes / 1024} KB. Simplify the SVGs`);
  return out;
}

// One sprite (or the backdrop). Returns {asset, color} or null after reporting.
function compileSprite(s, at, maxBytes, err, fixedSize) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) { err('A_ART_FIELD', at, 'a sprite is an object: {"svg": "<svg ...>"} or {"image": "data:image/png;base64,..."}'); return null; }
  let ok = true;
  for (const k of Object.keys(s)) if (!SPRITE_KEYS.includes(k)) { err('A_ART_FIELD', `${at}/${esc(k)}`, `a sprite has no field '${k}' (${SPRITE_KEYS.join(', ')})`); ok = false; }
  if ((s.svg === undefined) === (s.image === undefined)) { err('A_ART_FIELD', at, 'a sprite needs exactly one of svg or image'); return null; }
  for (const k of ['w', 'h']) if (s[k] !== undefined && !(Number.isFinite(s[k]) && s[k] >= 1 && s[k] <= 1024)) { err('A_ART_FIELD', `${at}/${k}`, `${k} is a size from 1 to 1024`); ok = false; }
  if (s.fps !== undefined && !(Number.isFinite(s.fps) && s.fps >= 0 && s.fps <= 30)) { err('A_ART_FIELD', `${at}/fps`, 'fps is from 0 to 30'); ok = false; }
  if (s.color !== undefined && (typeof s.color !== 'string' || !HEX.test(s.color))) { err('A_ART_FIELD', `${at}/color`, 'color is a #RRGGBB color (used for particles)'); ok = false; }
  for (const k of ['frames', 'cols']) if (s[k] !== undefined && !(Number.isInteger(s[k]) && s[k] >= 1 && s[k] <= 64)) { err('A_ART_FIELD', `${at}/${k}`, `${k} is a whole number from 1 to 64`); ok = false; }
  if (!ok) return null;

  const asset = {};
  if (s.image !== undefined) {
    if (typeof s.image !== 'string' || !DATA_IMAGE.test(s.image)) { err('A_ART_IMAGE', `${at}/image`, 'image must be a data:image/png, jpeg, webp or gif base64 URI (no outside URLs; use svg for SVG)'); return null; }
    if (s.image.length > SVG_LIMITS.image_bytes) { err('A_ART_SIZE', `${at}/image`, `image is ${Math.ceil(s.image.length / 1024)} KB; the limit is ${SVG_LIMITS.image_bytes / 1024} KB`); return null; }
    if (!fixedSize && (s.w === undefined || s.h === undefined)) { err('A_ART_FIELD', at, 'an image sprite needs w and h (the size of one frame)'); return null; }
    Object.assign(asset, { image: s.image, w: fixedSize?.w ?? s.w, h: fixedSize?.h ?? s.h });
  } else {
    const list = Array.isArray(s.svg) ? s.svg : [s.svg];
    if (!list.length || list.length > 64) { err('A_ART_FIELD', `${at}/svg`, 'svg is one SVG string, or a list of 1 to 64 frames'); return null; }
    if (Array.isArray(s.svg) && (s.frames !== undefined || s.cols !== undefined)) { err('A_ART_FIELD', at, 'with a list of SVG frames, leave out frames and cols; the expander builds the sheet'); return null; }
    const each = Array.isArray(s.svg) ? Math.floor(maxBytes / Math.min(list.length, 4)) : maxBytes;
    const checked = list.map((one, i) => {
      const r = sanitizeSvg(one, { maxBytes: Math.max(each, 4096) });
      const here = Array.isArray(s.svg) ? `${at}/svg/${i}` : `${at}/svg`;
      for (const e of r.errors) err('A_ART_SVG', here, `this SVG ${e}`);
      return r;
    });
    if (checked.some((r) => !r.ok)) return null;
    const first = checked[0].viewBox;
    const size = fixedSize ?? { ...sizeFrom(first), ...(s.w !== undefined ? { w: s.w } : {}), ...(s.h !== undefined ? { h: s.h } : {}) };
    if (s.w !== undefined && s.h === undefined && !fixedSize) size.h = Math.max(1, Math.round((s.w * first.h) / first.w));
    if (s.h !== undefined && s.w === undefined && !fixedSize) size.w = Math.max(1, Math.round((s.h * first.w) / first.h));
    if (list.length > 1) {
      asset.svg = composeSheet(checked, size.w, size.h);
      asset.frames = list.length;
      asset.cols = list.length;
      if (asset.svg.length > 256 * 1024) { err('A_ART_SIZE', `${at}/svg`, 'the frames add up to more than 256 KB'); return null; }
    } else {
      asset.svg = checked[0].svg;
      if (s.frames !== undefined) asset.frames = s.frames;
      if (s.cols !== undefined) asset.cols = s.cols;
    }
    Object.assign(asset, { w: size.w, h: size.h });
  }
  if (s.fps !== undefined && !fixedSize) asset.fps = s.fps;
  if (s.image !== undefined && !fixedSize) {
    if (s.frames !== undefined) asset.frames = s.frames;
    if (s.cols !== undefined) asset.cols = s.cols;
  }
  // Key order: source, then size, then animation.
  const ordered = {};
  for (const k of ['svg', 'image', 'w', 'h', 'frames', 'cols', 'fps']) if (asset[k] !== undefined) ordered[k] = asset[k];
  return { asset: ordered, color: s.color?.toUpperCase() };
}
