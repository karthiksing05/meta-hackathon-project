// Image-first art for the server's Make path. Every character, mascot, person, creature, food, product and
// recognizable object in a game is drawn by Muse Image in one style, never as shapes, SVG or emoji.
//
//   castFromPlan       the cast from the plan (spec.visual.assets, spec.theme.named, "hosted by X" in the
//                      request): ids, what each is, and 2 or 3 poses for characters
//   startCastArt       right after the plan, in parallel with compose: the backdrop (it sets the style) and
//                      ONE sprite sheet for the whole cast in the same style words and palette, sliced on its
//                      grid with the chroma key (authoring/artdir/sheets.mjs). Every call's latency is timed.
//   castBrief          the compose steering: the asset ids and what they mean; figures MUST use them
//   finishCastArt      after compose: the painted pictures go in under the cast ids, then the consistency loop
//                      (artConsistency, authoring/verify/checks/art-consistency.mjs): shape figures, SVG
//                      figures, emoji art and foreign pictures are swapped to a painted sprite, or painted in
//                      ONE extra sheet call in the same style, or (last resort) removed. Up to 2 rounds.
//
// Art never fails a build: any failure or timeout keeps what compose drew and says why in stats.art.
// At most MAX_IMAGE_CALLS image calls per build. GENERATOR_IMAGE_ART=0 turns all of it off.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodePNG, encodePNG, encodeJPEG, cover, fit, dataURI } from './pixels.mjs';
import { backdropPrompt } from './art.mjs';

export const MAX_IMAGE_CALLS = 4;
export const MAX_CELLS = 16; // one 4 × 4 sheet
export const ART_BUDGET = 192 * 1024 * 0.95; // the expander's art budget (data: URI text), with headroom
const IMAGE_TIMEOUT_S = 120;

// ---------------------------------------------------------------------------------------------- cast

const CHARACTER = /\b(char|character|host|hero|heroine|player|avatar|person|people|man|woman|boy|girl|kid|child|wizard|witch|king|queen|prince|princess|knight|mascot|creature|monster|animal|cat|dog|owl|bird|fish|dragon|ghost|robot|alien|npc|enemy|boss|pet|chef|professor|teacher|captain|pirate|ninja|elf|dwarf|giant|fairy|villain|rival|judge|referee|announcer|portrait|face)\b/i;
const UI = /\b(box|button|btn|panel|bar|frame|ring|dot|dots|grid|cell|tile|slot|plate|plaque|badge|banner|bg|hud|meter|timer|track|lane|line|arrow|cursor|ui|particle|particles|spark|sparkle|glow|confetti|fx|shine|border|divider|outline|field|input|card|pill|chip|tab|toggle|speech|marker|pip|gauge|progress|shadow|highlight|ripple|burst|trail|board|backdrop|background|zone|keyboard|key|letter|number|digit|text|label|score|stamp|verdict|caret|ribbon)\b/i;

const POSES = {
  neutral: 'calm, friendly neutral expression',
  happy: 'delighted, big smile, celebrating',
  react: 'surprised reaction, eyebrows raised, one hand up',
};

const idOf = (s, n = 24) => {
  let out = String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(out)) out = 'c_' + out;
  return out.slice(0, n).replace(/_+$/, '');
};
const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
const overlaps = (a, b) => { const A = new Set(words(a)); return words(b).some((w) => A.has(w)); };
const uiish = (...parts) => {
  const t = parts.filter(Boolean).join(' ').replace(/_/g, ' ');
  return UI.test(t) && !CHARACTER.test(t);
};

/** "hosted by Albus Dumbledore", "host: Dumbledore" -> "Albus Dumbledore". */
export function hostFromRequest(request) {
  const m = String(request ?? '').match(/\bhost(?:ed)?(?:\s+by|:)?\s+((?:[A-Z][\w'’.-]*)(?:\s+[A-Z][\w'’.-]*){0,3})/);
  return m ? m[1].trim() : null;
}

/**
 * castFromPlan({spec, request, base?}) -> [{id, name, text, kind: 'character'|'object', pose, of, host?}]
 * One entry per sheet cell: a character's poses are separate cells (`of` names the character's base id; the
 * neutral pose keeps the base id). Never more than MAX_CELLS.
 */
export function castFromPlan({ spec = null, request = '' } = {}) {
  const visual = spec?.visual ?? null;
  const people = [];
  const things = [];
  const seen = new Set();
  const add = (list, c) => {
    if (!c.id || seen.has(c.id) || [...people, ...things].some((x) => x.name.toLowerCase() === c.name.toLowerCase())) return;
    seen.add(c.id);
    list.push(c);
  };
  const named = (Array.isArray(spec?.theme?.named) ? spec.theme.named : typeof spec?.theme?.named === 'string' ? [spec.theme.named] : []).map(String).filter(Boolean);
  const host = hostFromRequest(request);
  for (const a of Array.isArray(visual?.assets) ? visual.assets : []) {
    if (!a?.id || a.render === 'engine' || uiish(a.id, a.piece, a.depicts)) continue;
    const depicts = String(a.depicts || a.id).trim();
    const proper = named.find((n) => /^[A-Z]/.test(n) && (overlaps(n, depicts) || overlaps(n, a.id) || overlaps(n, a.piece)));
    const isChar = CHARACTER.test(`${a.id} ${a.piece ?? ''} ${a.depicts ?? ''}`.replace(/_/g, ' ')) || !!proper;
    // A short name (the named person, else the depicts words up to the first comma) and the look without any pose.
    const name = proper ?? depicts.split(/[,;]/)[0].slice(0, 60);
    const text = String(depicts || a.prompt || a.reads_as).replace(/,?\s*[^,]*\bposes?\b[^,]*$/i, '').slice(0, 220);
    add(isChar ? people : things, { id: idOf(a.id), name, text, kind: isChar ? 'character' : 'object' });
  }
  if (host && ![...people, ...things].some((c) => overlaps(c.name, host) || overlaps(c.id, host))) {
    people.unshift({ id: idOf('host_' + words(host).slice(-1)[0]), name: host, text: host, kind: 'character' });
    seen.add(people[0].id);
  }
  // A plan with no visual stage: the named things in the theme stand in (proper names are characters).
  if (!(Array.isArray(visual?.assets) && visual.assets.length)) {
    for (const n of named.slice(0, 6)) add(/^[A-Z]/.test(n) ? people : things, { id: idOf(n), name: n, text: n, kind: /^[A-Z]/.test(n) ? 'character' : 'object' });
  }
  if (host) for (const p of people) if (overlaps(p.name, host) || overlaps(p.id, host)) p.host = true;
  people.sort((a, b) => (b.host ? 1 : 0) - (a.host ? 1 : 0));

  // Poses: the host 3, other characters 2, objects 1, cut back (others first, then the host) to fit the sheet.
  const want = people.map((p) => (p.host ? 3 : 2));
  const cells = () => want.reduce((s, n) => s + n, 0) + things.length;
  for (let i = want.length - 1; i >= 0 && cells() > MAX_CELLS; i--) if (!people[i].host) want[i] = 1;
  for (let i = 0; i < want.length && cells() > MAX_CELLS; i++) want[i] = 1;
  while (things.length && cells() > MAX_CELLS) things.pop();
  while (people.length && cells() > MAX_CELLS) { people.pop(); want.pop(); }
  const out = [];
  people.forEach((p, i) => {
    const poses = ['neutral', 'happy', 'react'].slice(0, want[i]);
    for (const pose of poses) out.push({ ...p, id: pose === 'neutral' ? p.id : `${p.id.slice(0, 24 - pose.length - 1)}_${pose}`, pose, of: p.id });
  });
  for (const t of things) out.push({ ...t, pose: null, of: t.id });
  return out;
}

/** The compose steering: the asset ids, what each is, and the rule. Empty for no cast. */
export function castBrief(cast) {
  if (!cast?.length) return '';
  const lines = [
    '',
    'PICTURES (image-first art, required): Muse Image paints every figure and object of this game in one style. These sprite names are reserved for those paintings:',
  ];
  for (const c of cast) lines.push(`- ${c.id}: ${c.name}${c.pose ? ` (${c.pose} pose)` : ''}`);
  lines.push(
    'Rules: declare every one of these names in art.sprites with a simple, well-proportioned stand-in SVG in its colors (the painting replaces it after the playtest). Every visible character, person, creature, food, product or object MUST be drawn with an image node of its sprite ({"node": "image", "asset": "<name>"}) or as a fragment role mapped to it, never built from circles, paths or polygons, and never as an emoji or glyph.',
    'Characters with happy and react poses: switch the image node\'s asset to the happy pose on a good answer or win and to the react pose on a miss, and back to the neutral one after.',
    'Shapes are only for UI geometry (bars, rings, dots, grids, panels, buttons) and particles. Draw image boxes square so the paintings keep their shape.',
  );
  return lines.join('\n');
}

/** The plan with the cast added to spec.visual.assets as painted assets, so the spec compose reads names them too. */
export function contextWithCast(context, cast) {
  const spec = context?.plan?.spec;
  if (!cast?.length || !spec || typeof spec !== 'object') return context;
  const visual = spec.visual && typeof spec.visual === 'object' ? spec.visual : {};
  const assets = Array.isArray(visual.assets) ? visual.assets.filter((a) => !cast.some((c) => c.id === idOf(a?.id))) : [];
  for (const c of cast) assets.push({ id: c.id, piece: c.kind, depicts: c.name + (c.pose && c.pose !== 'neutral' ? ` (${c.pose})` : ''), reads_as: c.text, render: 'image', reason: 'image-first: every figure is a Muse Image painting' });
  return { ...context, plan: { ...context.plan, spec: { ...spec, visual: { ...visual, assets } } } };
}

// ---------------------------------------------------------------------------------------------- style

const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16));
const hueOf = ([r, g, b]) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 30) return null;
  let h = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn);
  return ((h * 60) + 360) % 360;
};
/** The chroma key furthest from the palette's hues (magenta 300°, green 120°). */
export function keyFor(palette = []) {
  const hues = palette.map((h) => (/^#[0-9a-f]{6}$/i.test(h) ? hueOf(hexRGB(h)) : null)).filter((h) => h !== null);
  const near = (k) => Math.min(360, ...hues.map((h) => Math.min(Math.abs(h - k), 360 - Math.abs(h - k))));
  return near(120) > near(300) ? 'green' : 'magenta';
}

/** The art direction every image call shares: the plan's style sentence, the art style slot and palette. */
export function directionFor({ title = '', visual = null, spec = null, baseArt = null }) {
  const colors = visual?.palette?.colors ?? baseArt?.palette ?? {};
  const palette = Object.values(colors).filter((c) => /^#[0-9a-f]{6}$/i.test(String(c))).slice(0, 7);
  const style = [visual?.style ?? baseArt?.style ?? '', spec?.theme?.art_style ? `in a ${spec.theme.art_style} style` : '',
    'illustrated cartoon art, never photorealistic'].filter(Boolean).join('; ');
  const names = (Array.isArray(spec?.theme?.named) ? spec.theme.named : []).map(String).filter((n) => /^[A-Z]/.test(n));
  return { title: String(title || spec?.theme?.world || 'Muse Curio').slice(0, 80), style, palette, names };
}

// ---------------------------------------------------------------------------------------------- modules

let mods = null;
/** The authoring modules the slicing and the check come from (the image copies them into /app/authoring). */
export async function loadArtModules(dir) {
  if (mods) return mods;
  if (!dir || !existsSync(join(dir, 'artdir/sheets.mjs'))) throw new Error('the art-direction modules are missing');
  const load = (p) => import(pathToFileURL(join(dir, p)).href);
  const [sheets, prompts, consistency] = await Promise.all([load('artdir/sheets.mjs'), load('artdir/prompts.mjs'), load('verify/checks/art-consistency.mjs')]);
  mods = { sheets, prompts, consistency };
  return mods;
}

/** A trimmed RGBA sprite padded with transparency to a square, centred. */
export function padSquare(img) {
  const s = Math.max(img.w, img.h);
  if (img.w === img.h) return img;
  const data = new Uint8ClampedArray(s * s * 4);
  const ox = Math.floor((s - img.w) / 2), oy = Math.floor((s - img.h) / 2);
  for (let y = 0; y < img.h; y++) data.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((y + oy) * s + ox) * 4);
  return { w: s, h: s, data };
}

/** Slices one sheet into {id: square RGBA} for `items` (each {id, text}). */
export function sliceSheet(sheets, img, items, key) {
  const { sprites, method } = sheets.sliceSprites(img, items, key);
  const out = {};
  for (const it of items) {
    const s = sprites[it.id];
    if (s && s.w >= 8 && s.h >= 8) out[it.id] = padSquare(s);
  }
  return { sprites: out, method };
}

// ---------------------------------------------------------------------------------------------- painting

const sheetItems = (cast) => cast.map((c) => ({
  id: c.id,
  text: c.kind === 'character'
    ? `${c.name}${c.text && c.text !== c.name ? ` (${c.text})` : ''}, half-body character portrait, ${POSES[c.pose ?? 'neutral']}${c.pose && c.pose !== 'neutral' ? `, the very same ${c.name} as in the neutral cell` : ''}`
    : `${c.name}${c.text && c.text !== c.name ? ` (${c.text})` : ''}, a single game item`,
}));

/** Proper names (the cast's and the plan's named things) swapped for plain words: the retry after a content filter. */
export function withoutNames(text, names = []) {
  let out = String(text);
  const list = [...new Set(names.flatMap((n) => [n, ...String(n).split(/\s+/).filter((w) => /^[A-Z][a-z]{3,}/.test(w))]))].filter(Boolean).sort((x, y) => y.length - x.length);
  for (const n of list) out = out.split(n).join('the character');
  return out.replace(/the character(\s+the character)+/g, 'the character');
}
const filtered = (e) => /\b400\b|filtered|content (management|policy)|safety/i.test(String(e?.message ?? e));

/**
 * Paints one sheet for `cast` in direction `d`. -> {sprites: {id: RGBA}, call: {kind, seconds, ...}, method}
 * A content-filter refusal is retried once (within the call cap) with the proper names taken out.
 */
async function paintSheet({ muse, sheets, prompts, d, cast, signal, purpose, state = null }) {
  const items = sheetItems(cast);
  const key = keyFor(d.palette);
  const make = () => prompts.spriteSheetPrompt({ title: 'this game', style: d.style, palette: d.palette, sprites: { items, key, set: 'All subjects belong to one set: the same art style, line, shading, lighting and palette, as if painted together on the same day by one artist, matching the game\'s backdrop painting.' } });
  const names = [...cast.map((c) => c.name), ...(d.names ?? [])];
  let prompt = make();
  const t0 = Date.now();
  let r, retried = false;
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new Error('cancelled');
    try { r = await muse.image({ prompt, size: '1024x1024', timeout: IMAGE_TIMEOUT_S, maxAttempts: 1 }); break; } catch (e) {
      const canRetry = attempt === 0 && filtered(e) && (!state || state.imageCalls < MAX_IMAGE_CALLS);
      if (!canRetry) throw e;
      if (state) state.imageCalls++;
      retried = true;
      prompt = withoutNames(make(), names);
    }
  }
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  const img = decodePNG(r.png);
  const { sprites, method } = sliceSheet(sheets, img, items, key);
  return { sprites, method, call: { kind: purpose, cells: items.length, seconds, model: r.model, ...(retried ? { retried: 'content filter: names taken out' } : {}) } };
}

/**
 * startCastArt({cast, visual, spec, title, muse, dir, canvas, signal, paintBackdrop}) -> Promise<state>
 * Starts the backdrop and the cast sheet at once. Never rejects: failures are in state.errors.
 * state: {backdrop: RGBA | null, sprites: {id: RGBA}, own: Set, calls: [...], errors: [...], d}
 */
export function startCastArt({ cast, visual = null, spec = null, title = '', muse, dir, canvas = 'tall', signal, paintBackdrop = true, baseArt = null }) {
  const state = { backdrop: null, sprites: {}, own: new Set(), calls: [], errors: [], d: directionFor({ title, visual, spec, baseArt }), started: Date.now(), cast, imageCalls: 0 };
  const H = canvas === 'classic' ? 640 : 780;
  const jobs = [];
  if (paintBackdrop && visual?.backdrop && String(visual.backdrop.prompt ?? visual.scene ?? '').trim()) {
    state.imageCalls++;
    jobs.push((async () => {
      const t0 = Date.now();
      try {
        const r = await muse.image({ prompt: backdropPrompt({ ...visual, backdrop: { ...visual.backdrop, prompt: visual.backdrop.prompt || visual.scene } }, false), size: '1024x1536', timeout: IMAGE_TIMEOUT_S, maxAttempts: 1 });
        state.backdrop = cover(decodePNG(r.png), 360, H);
        state.calls.push({ kind: 'backdrop', seconds: Math.round((Date.now() - t0) / 100) / 10, model: r.model });
      } catch (e) {
        state.calls.push({ kind: 'backdrop', seconds: Math.round((Date.now() - t0) / 100) / 10, failed: true });
        state.errors.push('backdrop: ' + String(e?.message ?? e).slice(0, 160));
      }
    })());
  }
  if (cast.length) {
    state.imageCalls++;
    jobs.push((async () => {
      try {
        const { sheets, prompts } = await loadArtModules(dir);
        const r = await paintSheet({ muse, sheets, prompts, d: state.d, cast, signal, purpose: 'sheet', state });
        Object.assign(state.sprites, r.sprites);
        for (const id of Object.keys(r.sprites)) state.own.add(id);
        state.calls.push({ ...r.call, method: r.method, sliced: Object.keys(r.sprites).length });
      } catch (e) {
        state.calls.push({ kind: 'sheet', failed: true, seconds: Math.round((Date.now() - state.started) / 100) / 10 });
        state.errors.push('sheet: ' + String(e?.message ?? e).slice(0, 160));
      }
    })());
  }
  state.done = Promise.all(jobs).then(() => state);
  return state;
}

// ---------------------------------------------------------------------------------------------- swapping

const RASTER = /^data:image\/(png|jpe?g|webp|gif)/;
const isRaster = (s) => typeof s?.image === 'string' && RASTER.test(s.image);
const SHAPE_KIDS = new Set(['circle', 'ellipse', 'rect', 'path', 'polygon', 'line', 'poly', 'arc', 'star']);

/** A group's box from its children (x, y, w, h, r), in the group's parent space. */
export function groupBox(n) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of n.children ?? []) {
    if (!SHAPE_KIDS.has(k?.node)) continue;
    const num = (v) => (typeof v === 'number' ? v : null);
    const x = num(k.x) ?? num(k.cx) ?? 0, y = num(k.y) ?? num(k.cy) ?? 0;
    const r = num(k.r) ?? num(k.rx) ?? null;
    if (r !== null) { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - (num(k.ry) ?? r)); y1 = Math.max(y1, y + (num(k.ry) ?? r)); }
    else if (num(k.w) !== null && num(k.h) !== null) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + k.w); y1 = Math.max(y1, y + k.h); }
  }
  if (!Number.isFinite(x0)) return null;
  const ox = typeof n.x === 'number' ? n.x : 0, oy = typeof n.y === 'number' ? n.y : 0;
  return { x: ox + x0, y: oy + y0, w: x1 - x0, h: y1 - y0 };
}

const getAt = (obj, ptr) => ptr.split('/').slice(1).reduce((n, k) => (n == null ? n : n[k.replace(/~1/g, '/').replace(/~0/g, '~')]), obj);
const parentOf = (obj, ptr) => { const parts = ptr.split('/'); const last = parts.pop(); return { parent: getAt(obj, parts.join('/')), key: last.replace(/~1/g, '/').replace(/~0/g, '~') }; };

/** An image node in place of a shape figure: the same box (square, centred), keeping its handlers and keys. */
export function figureToImage(n, asset) {
  const b = groupBox(n) ?? { x: n.x ?? 0, y: n.y ?? 0, w: 64, h: 64 };
  const s = Math.max(16, Math.round(Math.min(b.w, b.h) || 64));
  const { children, node, ...keep } = n; // handlers, id, animate_on, visible ... stay
  return { ...keep, node: 'image', asset, x: Math.round(b.x + (b.w - s) / 2), y: Math.round(b.y + (b.h - s) / 2), w: s, h: s };
}

/** The best sprite in `pool` for a name: the one sharing the most words (the neutral pose first). */
export function matchSprite(name, pool, cast = []) {
  const want = new Set(words(String(name).replace(/_/g, ' ')).filter((w) => w !== 'char'));
  if (!want.size) return null;
  let best = null, score = 0;
  for (const id of pool) {
    const c = cast.find((x) => x.id === id);
    const have = new Set([...words(id.replace(/_/g, ' ')), ...words(c?.name)].filter((w) => w !== 'char' && !['happy', 'react', 'neutral'].includes(w)));
    let s = [...want].filter((w) => have.has(w)).length;
    if (s && c?.pose && c.pose !== 'neutral') s -= 0.5;
    if (s > score) { score = s; best = id; }
  }
  return best;
}

/** Square image boxes for literal painted assets (the paintings are square): the box's smaller side, centred. */
function squareImageNodes(tree, painted) {
  const { walkNodes } = mods.consistency;
  let n = 0;
  walkNodes(tree, (node) => {
    if (node.node !== 'image' || typeof node.asset !== 'string' || !painted.has(node.asset)) return;
    if (typeof node.w !== 'number' || typeof node.h !== 'number' || node.w === node.h) return;
    const s = Math.min(node.w, node.h);
    const anchored = typeof node.anchor === 'string' && node.anchor.includes('center');
    if (!anchored && typeof node.x === 'number') node.x = Math.round(node.x + (node.w - s) / 2);
    if (!anchored && typeof node.y === 'number') node.y = Math.round(node.y + (node.h - s) / 2);
    node.w = s; node.h = s;
    n++;
  });
  return n;
}

const EMPTY_SVG = "<svg viewBox='0 0 64 64'><rect width='64' height='64' fill='none'/></svg>";

/**
 * One consistency round on a view of the game (mutated): `sprites` is art.sprites (authoring) or assets (game),
 * `tree` the nodes (presentation). Swaps what it can to sprites in `pool`.
 * -> {flagged, swapped, missing: [{id?, node?, name}], removable: [{node}], codes}
 */
export function consistencyRound({ sprites, tree }, { pool, own, cast }) {
  const { artConsistency, nodeLabel } = mods.consistency;
  const findings = artConsistency({ sprites, tree, own, cast });
  const res = { flagged: findings.length, swapped: 0, missing: [], removable: [], codes: findings.map((f) => f.code) };
  const ids = [...pool.keys()];
  for (const f of findings) {
    if (f.code === 'V_MIXED_ART' || f.code === 'V_FOREIGN_ART') {
      const m = matchSprite(f.id, ids, cast);
      if (m) { sprites[f.id] = { ...pool.get(m), ...(sprites[f.id]?.color ? { color: sprites[f.id].color } : {}) }; own.add(f.id); res.swapped++; }
      else res.missing.push({ id: f.id, name: f.id.replace(/_/g, ' ') });
    } else if (f.code === 'V_VECTOR_FIGURE') {
      const node = getAt(tree, f.node);
      const label = nodeLabel(node ?? {});
      const m = f.id && pool.has(f.id) ? f.id : matchSprite(label, ids, cast);
      if (m && node) {
        const { parent, key } = parentOf(tree, f.node);
        parent[key] = figureToImage(node, m);
        if (!sprites[m]) sprites[m] = { ...pool.get(m) };
        res.swapped++;
      } else res.missing.push({ node: f.node, name: label || 'figure' });
    } else if (f.code === 'V_EMOJI_ART') {
      res.removable.push({ node: f.node });
    }
  }
  return res;
}

/** Removes what the loop couldn't paint: an emoji's text goes blank, a shape figure is emptied, an SVG figure sprite is blanked. */
export function removeLeftovers({ sprites, tree }, items) {
  let removed = 0;
  for (const it of items) {
    if (it.node) {
      const node = getAt(tree, it.node);
      if (!node) continue;
      if (node.node === 'text') node.text = '';
      else if (node.node === 'group') node.children = [];
      removed++;
    } else if (it.id && sprites?.[it.id]) {
      sprites[it.id] = { svg: EMPTY_SVG };
      removed++;
    }
  }
  return removed;
}

/** Encodes the pictures within the art budget: sprites shrink first, then the backdrop's quality. */
export function encodeArt({ backdrop, sprites, otherBytes = 0 }) {
  const budget = ART_BUDGET - otherBytes;
  const ids = Object.keys(sprites);
  for (const [px, q] of [[128, 74], [112, 70], [96, 66], [80, 60], [64, 54], [56, 48], [48, 42]]) {
    const out = { backdrop: backdrop ? dataURI('image/jpeg', encodeJPEG(backdrop, q)) : null, sprites: {}, px };
    let total = out.backdrop?.length ?? 0;
    for (const id of ids) {
      const s = fit(sprites[id], px);
      out.sprites[id] = { image: dataURI('image/png', encodePNG(s)), w: s.w, h: s.h };
      total += out.sprites[id].image.length;
    }
    out.bytes = total;
    if (total <= budget) return out;
  }
  return null;
}

const svgBytes = (s) => (Array.isArray(s?.svg) ? s.svg.join('').length : typeof s?.svg === 'string' ? s.svg.length : 0);

/**
 * finishCastArt({manifest, state, studio, muse, basePool, dir, signal, deadline}) -> {manifest, report}
 * The painted pictures go straight into the built game's assets and the authoring manifest's art under the cast
 * ids (no re-expand: the verified presentation stays as the verifier left it), then the consistency loop runs on
 * both. The caller re-runs the layout verifier on the result (composer.mjs verifyAfterPictures). Never throws.
 */
export async function finishCastArt({ manifest, state, studio, muse, basePool = null, baseBackdrop = null, dir, signal, deadline = Infinity }) {
  const t0 = Date.now();
  const report = { applied: false, calls: state.calls, errors: [...state.errors], consistency: { checked: 0, swapped: 0, generated: 0, removed: 0, rounds: 0, remaining: 0 }, imageCalls: state.imageCalls };
  const done = (m) => { report.seconds = Math.round((Date.now() - state.started) / 100) / 10; report.finish_seconds = Math.round((Date.now() - t0) / 100) / 10; return { manifest: m, report }; };
  let A, G;
  try { A = JSON.parse(manifest.content.authoring_json); G = JSON.parse(manifest.content.game_json); } catch { report.errors.push('no built game'); return done(manifest); }
  try { await loadArtModules(dir); } catch (e) { report.errors.push(String(e?.message ?? e)); return done(manifest); }
  A.art ??= {};
  A.art.sprites ??= {};
  G.assets ??= {};
  const views = [{ sprites: A.art.sprites, tree: A.presentation ?? null }, { sprites: G.assets, tree: G.presentation ?? null }];
  const cast = state.cast ?? [];

  // The pool: this build's sheet, plus the base game's painted sprites (a remix or next level).
  const rgba = { ...state.sprites };
  const pool = new Map(); // id -> {image, w, h}
  const own = new Set(state.own);
  for (const [id, s] of Object.entries(basePool ?? {})) { pool.set(id, s); own.add(id); }
  const provisional = (id) => { const s = fit(rgba[id], 128); return { image: dataURI('image/png', encodePNG(s)), w: s.w, h: s.h }; };
  for (const id of Object.keys(rgba)) pool.set(id, provisional(id));
  const authoringText = JSON.stringify({ ...A, art: { ...A.art, sprites: {} } });
  const referenced = (id) => id in A.art.sprites || id in G.assets || authoringText.includes(`"${id}"`) || authoringText.includes(`'${id}'`);
  for (const v of views) {
    // Base painted sprites compose kept as stand-ins come back; cast sprites go in under their own ids
    // (a pose compose never used stays out: an unused sprite is only bytes).
    for (const [id, s] of Object.entries(basePool ?? {})) if (referenced(id)) v.sprites[id] = { ...s, ...(v.sprites[id]?.color ? { color: v.sprites[id].color } : {}) };
    for (const id of Object.keys(rgba)) if (referenced(id)) v.sprites[id] = { ...pool.get(id), ...(v.sprites[id]?.color ? { color: v.sprites[id].color } : {}) };
  }

  // The consistency loop: swap, else paint the missing ones in ONE extra sheet, else remove. Up to 2 rounds.
  const round = () => {
    const rs = views.map((v) => consistencyRound(v, { pool, own, cast }));
    const missing = new Map();
    for (const r of rs) for (const m of r.missing) missing.set(m.id ?? m.name, m);
    return { flagged: rs.reduce((t, r) => t + r.flagged, 0), swapped: rs.reduce((t, r) => t + r.swapped, 0), missing: [...missing.values()] };
  };
  for (let n = 1; n <= 2; n++) {
    const r = round();
    report.consistency.rounds = n;
    report.consistency.checked += r.flagged;
    report.consistency.swapped += r.swapped;
    if (!r.missing.length) break;
    const canPaint = state.imageCalls < MAX_IMAGE_CALLS && Date.now() + IMAGE_TIMEOUT_S * 1000 < deadline && !signal?.aborted && typeof muse?.image === 'function';
    if (!canPaint || n === 2) break;
    const extra = r.missing.slice(0, MAX_CELLS).map((m) => ({ id: m.id ?? idOf(m.name), name: m.name, text: m.name, kind: CHARACTER.test(m.name) ? 'character' : 'object', pose: CHARACTER.test(m.name) ? 'neutral' : null }));
    state.imageCalls++;
    report.imageCalls = state.imageCalls;
    try {
      const p = await paintSheet({ muse, sheets: mods.sheets, prompts: mods.prompts, d: state.d, cast: extra, signal, purpose: 'extra_sheet', state });
      report.imageCalls = state.imageCalls;
      report.calls.push({ ...p.call, method: p.method, sliced: Object.keys(p.sprites).length });
      for (const [id, img] of Object.entries(p.sprites)) { rgba[id] = img; pool.set(id, provisional(id)); own.add(id); report.consistency.generated++; }
      cast.push(...extra);
    } catch (e) {
      report.calls.push({ kind: 'extra_sheet', failed: true });
      report.errors.push('extra sheet: ' + String(e?.message ?? e).slice(0, 160));
      break;
    }
  }
  // Still flagged after the rounds: removed rather than shipping mixed art.
  for (const v of views) {
    const left = consistencyRound(v, { pool, own, cast });
    report.consistency.swapped += left.swapped;
    report.consistency.removed += removeLeftovers(v, [...left.missing, ...left.removable]);
  }
  const painted = new Set(Object.keys(G.assets).filter((id) => id !== 'backdrop' && isRaster(G.assets[id])));
  report.squared = views.reduce((t, v) => t + (v.tree ? squareImageNodes(v.tree, painted) : 0), 0);

  // Final encode within the art budget: every sprite showing one of this build's paintings, re-encoded together.
  const sourceOf = (s) => (isRaster(s) ? [...pool.entries()].find(([pid, p]) => pid in rgba && p.image === s.image)?.[0] ?? null : null);
  const used = {};
  for (const s of Object.values(G.assets)) { const src = sourceOf(s); if (src) used[src] = rgba[src]; }
  const otherBytes = Object.entries(G.assets).filter(([id, s]) => id !== 'backdrop' && !sourceOf(s)).reduce((t, [, s]) => t + svgBytes(s) + (isRaster(s) ? s.image.length : 0), 0);
  const enc = encodeArt({ backdrop: state.backdrop, sprites: used, otherBytes });
  if (!enc) { report.errors.push('the pictures do not fit the art budget'); return done(manifest); }
  for (const v of views) for (const [id, s] of Object.entries(v.sprites)) {
    const src = id === 'backdrop' ? null : sourceOf(s);
    if (src) v.sprites[id] = { ...enc.sprites[src], ...(s.color ? { color: s.color } : {}) };
  }
  const backdropURI = enc.backdrop ?? baseBackdrop?.image ?? null;
  if (backdropURI) {
    A.art.backdrop = { image: backdropURI };
    const H = Number(G.presentation?.canvas?.h) || state.backdrop?.h || 640;
    G.assets.backdrop = { image: backdropURI, w: 360, h: H };
  }
  report.sprite_px = enc.px;
  report.bytes = enc.bytes;
  report.painted = [...painted];
  report.non_image_figures = mods.consistency.artConsistency({ sprites: G.assets, tree: G.presentation ?? null }).length;
  report.consistency.remaining = report.non_image_figures;

  const rewrapped = studio.wrap({ id: manifest.id, game_json: JSON.stringify(G), authoring_json: JSON.stringify(A), brief: manifest.brief, seed: manifest.seed, ...(manifest.style?.emoji ? { emoji: manifest.style.emoji } : {}) });
  const next = {
    ...manifest,
    content: rewrapped.content,
    style: { ...manifest.style, colors: rewrapped.style?.colors ?? manifest.style?.colors },
    studio: { ...(manifest.studio ?? {}), models: [...new Set([...(manifest.studio?.models ?? []), ...report.calls.filter((c) => c.model).map((c) => c.model)])] },
  };
  report.applied = true;
  return done(next);
}

// ---------------------------------------------------------------------------------------------- remix

/**
 * A base game for compose without its painted pictures (they'd ride into Muse's prompt as base64): each painted
 * sprite becomes a small stand-in SVG under the same id, and the pictures come back after compose.
 * -> {base, pool: {id: {image, w, h}}, backdrop: {image} | null, style}
 */
export function stripBase(base) {
  try {
    const a = JSON.parse(base?.content?.authoring_json ?? base?.authoring_json ?? 'null');
    if (!a?.art) return { base, pool: {}, backdrop: null, art: null };
    const pool = {};
    const sprites = { ...(a.art.sprites ?? {}) };
    for (const [id, s] of Object.entries(sprites)) if (isRaster(s)) { pool[id] = { image: s.image, w: s.w, h: s.h }; sprites[id] = { svg: `<svg viewBox='0 0 ${s.w || 64} ${s.h || 64}'><rect width='${s.w || 64}' height='${s.h || 64}' rx='8' fill='#888888'/></svg>`, ...(s.color ? { color: s.color } : {}) }; }
    const backdrop = isRaster(a.art.backdrop) ? { image: a.art.backdrop.image } : null;
    if (!Object.keys(pool).length && !backdrop) return { base, pool, backdrop: null, art: a.art };
    const art = { ...a.art, sprites, ...(backdrop ? { backdrop: { svg: "<svg viewBox='0 0 360 640'><rect width='360' height='640' fill='#222222'/></svg>" } } : {}) };
    const json = JSON.stringify({ ...a, art });
    const stripped = base.content ? { ...base, content: { ...base.content, authoring_json: json } } : { ...base, authoring_json: json };
    return { base: stripped, pool, backdrop, art: a.art };
  } catch {
    return { base, pool: {}, backdrop: null, art: null };
  }
}
