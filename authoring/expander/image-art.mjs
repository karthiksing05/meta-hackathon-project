// Build-time picture art from muse-image-1.0: detailed sprites, backdrops and story portraits in the
// style the person asked for. It runs after the gate and polish, on a game that already plays: it only
// swaps the pictures behind asset ids the game already has (same ids, same w/h/frames), so rules,
// hitboxes and replays are untouched. Nothing here runs while someone plays.
//
//   style sheet (one per game: style, palette, line, lighting, framing, background key)
//   → pictures: one per sprite role, and one per item for a set asset (several frames, no fps, the
//     frame picked by the game: nine Labubu figures each get their own named, described picture)
//   → art direction (optional Muse text call: what each role looks like, each set item's own color,
//     outfit and pose, real people named)
//   → image calls (one sheet call for all sprite roles on a flat chroma background, or one call per
//     role; one backdrop call; for stories a character lineup, then scene stills drawn with the
//     lineup as a reference image so faces and outfits stay the same)
//   → key out the background, slice, trim, fit to the asset box, downscale to play size, sharpen
//   → sprite check (sprite-check.mjs): look-alikes, empty slices, cut or doubled figures are redrawn
//   → encode: sprites as 8-bit palette PNG, backdrops and stills as JPEG, within the art budget
//   → assets for content.game_json, the same pictures in content.authoring_json's art, and a
//     `license: "generated"` record per picture.
//
// Pure: no Node APIs. The caller passes
//   image({prompt, reference?, purpose}) → Promise<{bytes: Uint8Array, usage?}>   (one muse-image call;
//       `reference` is PNG bytes for the image-edit form, which keeps a character consistent)
//   decode(bytes) → {w, h, data}            (PNG via image-codec's decodePNG; the CLI also reads WebP)
//   deflate(bytes) → bytes                   (zlib, for PNG)
//   ask?(system, user, purpose, options) → Promise<string | {content, usage}>   (art direction)
// Same inputs and same image bytes give the same output bytes.

import { encodePNG, encodeJPEG, quantize, dataUri } from './image-codec.mjs';
import * as X from './image-pixels.mjs';
import { checkSprites, redrawKeys } from './sprite-check.mjs';

export const IMAGE_ART_FORMAT = 'image-art/1';
export const IMAGE_ART_LIMITS = Object.freeze({
  art_bytes: 192 * 1024, // the expander's art budget (svg.mjs SVG_LIMITS.art_bytes), counted as data: URI text
  image_bytes: 512 * 1024, // one image (SVG_LIMITS.image_bytes)
  max_sprites: 32,
  sprite_px: [48, 128], // longest side of one frame, in pixels
  sheet_max: 16, // pictures per sheet call (4 × 4); more go on a second sheet
  max_variants: 32, // pictures drawn for one many-item asset (one per frame)
  max_redraws: 4, // single-picture calls to redraw slices the sprite check flags
  backdrop_w: [270, 540], // pixels across for a 360-wide canvas
  concurrency: 3,
});

// ---------- style ----------

// Requested styles we recognise in a request, with how to draw them. `pixel` keeps hard edges.
export const STYLE_PRESETS = {
  pixel_art: { match: /\b(pixel[- ]?art|pixel|8[- ]?bit|16[- ]?bit|retro (sprite|rpg|arcade|game))/i, name: 'pixel art', look: 'crisp 16-bit pixel art sprites, chunky visible pixels, limited palette', line: 'one-pixel dark outline', lighting: 'flat two-tone shading', pixel: true },
  watercolor: { match: /\b(ghibli|watercolou?r|gouache|storybook painting)/i, name: 'soft watercolor storybook', look: 'hand-painted watercolor and gouache storybook illustration, soft washes, warm natural light', line: 'thin soft ink line', lighting: 'gentle warm daylight' },
  brick: { match: /\b(lego|brick[- ]built|toy bricks?)/i, name: 'toy brick', look: 'glossy plastic toy-brick figures and builds, studs visible, toy photography look', line: 'no outlines, clean plastic edges', lighting: 'bright studio light with soft shadows' },
  clay: { match: /\b(claymation|clay|plasticine|stop[- ]motion)/i, name: 'claymation', look: 'handmade plasticine claymation figures, visible thumbprints, rounded chunky shapes', line: 'no outlines', lighting: 'soft studio light' },
  anime: { match: /\b(80s anime|90s anime|anime|manga|cel[- ]shaded)/i, name: 'retro anime', look: 'retro 1980s cel anime, bold flat colors, dramatic eyes, painted highlights', line: 'clean dark cel outline', lighting: 'hard cel shadows, rim light' },
  comic: { match: /\b(comic book|comic|pop art|halftone)/i, name: 'comic book', look: 'bold comic-book art, halftone shading, punchy colors', line: 'thick black ink outline', lighting: 'high-contrast comic shading' },
  low_poly: { match: /\b(low[- ]poly|3d render|pixar|3d cartoon)/i, name: '3D cartoon', look: 'polished 3D cartoon render, rounded toy-like shapes, soft materials', line: 'no outlines', lighting: 'soft global illumination' },
  paper: { match: /\b(paper ?cut|papercraft|paper craft|collage|felt)/i, name: 'papercut', look: 'layered cut-paper craft, visible paper texture and soft drop shadows between layers', line: 'clean cut edges', lighting: 'soft top light' },
  neon: { match: /\b(neon|synthwave|vaporwave|cyberpunk)/i, name: 'neon synthwave', look: 'glowing neon synthwave game art, saturated magenta-free cyan and violet glows on dark', line: 'glowing outline', lighting: 'neon rim light' },
  crayon: { match: /\b(crayon|kid'?s drawing|doodle|sketch)/i, name: 'crayon doodle', look: 'hand-drawn crayon and marker doodle, wobbly lines, paper texture', line: 'wobbly marker line', lighting: 'flat' },
};
export const DEFAULT_STYLE = { name: 'bold cartoon', look: 'bold cartoon mobile game art, bright saturated colors, clean shapes, cel shading', line: 'thick dark outlines', lighting: 'soft top light, cel shading' };

/** The requested art style in a request or slot answer, or null. "Angry Birds style" is a game, not an art style, so only known art words count. */
export function findStyle(text) {
  const s = String(text ?? '');
  for (const [id, p] of Object.entries(STYLE_PRESETS)) if (p.match.test(s)) return id;
  return null;
}

const HEXRE = /^#[0-9A-Fa-f]{6}/;

/**
 * One style sheet per game, so every picture matches. input: {request, style (preset id, or free
 * text like "80s anime"), spec (game-spec/1: theme, feel), palette (#hex list), title}.
 */
export function styleSheet({ request = '', style = null, spec = null, palette = [], title = '' } = {}) {
  const asked = style ? (STYLE_PRESETS[style] ? style : findStyle(style)) : findStyle(request);
  const preset = asked ? STYLE_PRESETS[asked] : DEFAULT_STYLE;
  const freeText = style && !STYLE_PRESETS[style] ? String(style).slice(0, 120) : null;
  const theme = spec?.theme ?? {};
  const colors = [...new Set((palette ?? []).filter((c) => HEXRE.test(String(c))).map((c) => String(c).slice(0, 7).toUpperCase()))].slice(0, 5);
  return {
    format: IMAGE_ART_FORMAT,
    id: asked ?? 'cartoon',
    name: freeText ?? preset.name,
    look: freeText && !asked ? `${freeText} illustration` : preset.look,
    line: preset.line,
    lighting: preset.lighting,
    pixel: !!preset.pixel,
    framing: 'single subject, full body, three-quarter view, centered, readable silhouette at small size, no glow, no sparkles, no motion lines, no drop shadow',
    world: String(theme.world ?? '').slice(0, 160),
    tone: String(theme.tone ?? '').slice(0, 80),
    palette: colors,
    asked: !!(asked || freeText),
    title: String(title).slice(0, 60),
  };
}

/** The style sheet as prompt text, shared by every call for this game. */
export function styleText(sheet) {
  const parts = [`Style: ${sheet.look}; ${sheet.line}; ${sheet.lighting}.`];
  if (sheet.palette.length) parts.push(`Palette leaning on ${sheet.palette.join(', ')}.`);
  if (sheet.tone) parts.push(`Mood: ${sheet.tone}.`);
  return parts.join(' ');
}

// ---------- real people: caricature only ----------

// A seed list for requests that name well-known real people without the art direction call. The art
// direction call adds any others it finds (real_people).
export const KNOWN_PEOPLE = ['MrBeast', 'Mr. Beast', 'Mr Beast', 'Jensen Huang', 'Max Verstappen', 'Elon Musk', 'Taylor Swift', 'Mark Zuckerberg', 'Lewis Hamilton', 'Kim Kardashian', 'Drake', 'Beyoncé', 'Lionel Messi', 'Cristiano Ronaldo', 'LeBron James', 'Barack Obama', 'Donald Trump', 'Joe Biden', 'Kai Cenat', 'IShowSpeed'];

/** Names of real people mentioned in the text (from the seed list plus `extra`). */
export function findPeople(text, extra = []) {
  const s = String(text ?? '');
  const out = [];
  for (const name of [...extra, ...KNOWN_PEOPLE]) {
    const n = String(name ?? '').trim();
    if (n.length < 3) continue;
    const re = new RegExp(`(^|[^\\w])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\w])`, 'i');
    if (re.test(s) && !out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out;
}

const PHOTO_WORDS = /\b(photo[- ]?realistic|photoreal|hyper[- ]?realistic|realistic photo(graph)?|photograph(ic|y)?|photo|dslr|lifelike|real[- ]life)\b/gi;

/**
 * The image-prompt guard. Any real person named becomes "a stylised cartoon caricature of <name>",
 * photo words become "illustrated", and the prompt says it is never photorealistic. Brands, logos and
 * fictional characters are untouched. Returns {prompt, people, changed}.
 */
export function guardPrompt(prompt, people = []) {
  let p = String(prompt ?? '');
  const found = findPeople(p, people);
  if (!found.length) return { prompt: p, people: [], changed: false };
  for (const name of found.sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(a |an |the )?(stylised cartoon caricature of )?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
    p = p.replace(re, (m, _art, already) => (already ? m : `a stylised cartoon caricature of ${name}`));
  }
  p = p.replace(PHOTO_WORDS, 'illustrated');
  p += ' Real people appear only as exaggerated, stylised cartoon caricatures: never photorealistic, never a photograph, never an exact likeness.';
  return { prompt: p, people: found, changed: true };
}

// ---------- roles ----------

const SOUND = (a) => a && typeof a === 'object' && 'sound' in a;

/**
 * The picture roles of an expanded game: every image asset (svg or image), with its frame size and
 * animation, and what the game says about it. The backdrop is the asset called `backdrop`.
 * A many-frame asset with no fps whose frame is picked by the game (`frame: "= last_idx"`), not by the
 * clock, is a set of different things, one per frame (nine Labubu figures, five fruits): it gets
 * `variants: [name per frame]`, from the content list of that length when the game has one.
 */
export function spriteRoles(game, authoring = null) {
  const roles = [];
  for (const [id, a] of Object.entries(game?.assets ?? {})) {
    if (!a || SOUND(a) || !(a.svg || a.image)) continue;
    const role = { id, kind: id === 'backdrop' ? 'backdrop' : 'sprite', w: a.w, h: a.h, frames: a.frames ?? 1, cols: a.cols ?? a.frames ?? 1, ...(a.fps !== undefined ? { fps: a.fps } : {}), describe: describeRole(id, authoring) };
    const names = role.kind === 'sprite' ? variantNames(game, authoring, id, a) : null;
    if (names) role.variants = names;
    roles.push(role);
  }
  return roles;
}

// Frame expressions that move with the clock are animation, not a choice of item.
const CLOCK = /\b(time|now|elapsed|tick|ticks|t|age|clock|anim\w*)\b/;

function frameExprs(game, id) {
  const out = [];
  const walk = (n) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    if (n.asset === id && n.frame !== undefined) out.push(String(n.frame));
    for (const [k, v] of Object.entries(n)) if (k !== 'assets' && v && typeof v === 'object') walk(v);
  };
  walk(game?.presentation);
  return out;
}

// The string items of a list literal such as "['Coco Labubu', 'Berry Labubu']".
function listLiteral(init) {
  if (Array.isArray(init)) return init.every((x) => typeof x === 'string') ? init : null;
  const s = String(init ?? '').trim();
  if (!s.startsWith('[')) return null;
  const items = [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => (m[1] ?? m[2]).replace(/\\(.)/g, '$1'));
  return items;
}

/**
 * Names for the frames of a many-item asset, or null when its frames are an animation. Candidates are
 * the game's string lists with one entry per frame (authoring content, then content_* state); names
 * that mention the asset ("Coco Labubu" for `labubu`) and read like names (not sentences) win.
 */
export function variantNames(game, authoring, id, a) {
  const frames = a?.frames ?? 1;
  if (frames < 2 || a.fps !== undefined) return null;
  const exprs = frameExprs(game, id);
  if (exprs.some((e) => CLOCK.test(e.replace(/^=\s*/, '')))) return null;
  const lists = [];
  for (const [k, v] of Object.entries(authoring?.content ?? {})) if (Array.isArray(v)) lists.push({ k, items: v });
  for (const [k, v] of Object.entries(game?.state ?? {})) if (/^list<string>/.test(String(v?.type ?? ''))) { const items = listLiteral(v.init); if (items) lists.push({ k: k.replace(/^content_/, ''), items }); }
  const word = id.toLowerCase().split('_').filter((w) => w.length > 2);
  let best = null, bestScore = -Infinity;
  for (const { k, items } of lists) {
    if (items.length !== frames || !items.every((x) => typeof x === 'string' && x.trim())) continue;
    if (new Set(items.map((x) => x.toLowerCase())).size !== items.length) continue;
    const avg = items.reduce((s, x) => s + x.length, 0) / items.length;
    if (avg > 40) continue;
    const mentions = items.filter((x) => word.some((w) => x.toLowerCase().includes(w))).length / items.length;
    const score = mentions * 2 + Math.min(avg, 24) / 24 + (word.some((w) => k.toLowerCase().includes(w)) ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = items; }
  }
  if (best) return best.map((x) => String(x).trim().slice(0, 60));
  const name = id.replace(/_/g, ' ');
  return Array.from({ length: frames }, (_, k) => `${name} ${k + 1}`);
}

// Distinguishing looks for set items that have no art direction: a main color (from the item's name
// when it names one), an outfit and a pose, all different within a set of up to 16.
const COLOR_WORDS = [
  [/\b(coco|cocoa|choco\w*|brown|mocha|coffee)\b/i, 'cocoa brown'], [/\b(berry|cherry|ruby|red|crimson)\b/i, 'berry red'],
  [/\b(mint|green|lime|matcha|jade)\b/i, 'mint green'], [/\b(lilac|lavender|purple|violet|grape)\b/i, 'lilac purple'],
  [/\b(peach|apricot)\b/i, 'peach orange'], [/\b(sky|blue|azure|ocean|navy)\b/i, 'sky blue'],
  [/\b(rose|pink|blush|sakura)\b/i, 'rose pink'], [/\b(coral|salmon)\b/i, 'coral'], [/\b(gold|golden|honey)\b/i, 'shiny metallic gold'],
  [/\b(silver|chrome)\b/i, 'shiny silver'], [/\b(lemon|yellow|banana|sunny)\b/i, 'lemon yellow'], [/\b(orange|tangerine|pumpkin)\b/i, 'tangerine orange'],
  [/\b(snow|white|cream|vanilla|milk)\b/i, 'snow white'], [/\b(black|shadow|night|midnight|ink)\b/i, 'midnight black'], [/\b(teal|aqua|turquoise)\b/i, 'teal'],
];
const SET_COLORS = ['cherry red', 'sky blue', 'mint green', 'lemon yellow', 'lilac purple', 'tangerine orange', 'rose pink', 'cocoa brown', 'teal', 'snow white', 'midnight black', 'shiny gold', 'coral', 'navy blue', 'lime green', 'silver'];
const SET_OUTFITS = ['striped overalls', 'a hooded raincoat', 'a tiny crown and cape', 'a sailor suit', 'a knitted sweater', 'a fruit costume hood', 'a tutu and bow', 'a puffer jacket', 'a chef apron and hat', 'pajamas and a nightcap', 'a sports jersey', 'a wizard robe', 'a flower wreath and dress', 'a space suit', 'a scarf and beanie', 'a tuxedo and bow tie'];
const SET_POSES = ['waving', 'jumping with arms up', 'sitting and hugging its knees', 'winking with a peace sign', 'holding a balloon', 'running', 'dancing on one foot', 'hands on hips', 'blowing a kiss', 'peeking shyly', 'cheering with fists up', 'holding a lollipop', 'reading a tiny book', 'skateboarding', 'curtsying', 'striking a superhero pose'];

/** A deterministic, distinct look for item k of a set (used when there's no art direction for it). */
export function variantLook(name, k, used = new Set()) {
  let color = COLOR_WORDS.find(([re]) => re.test(name))?.[1];
  if (!color || used.has(color)) color = SET_COLORS.find((c, i) => i >= k % SET_COLORS.length && !used.has(c)) ?? SET_COLORS.find((c) => !used.has(c)) ?? SET_COLORS[k % SET_COLORS.length];
  used.add(color);
  return `${name}: ${color} all over, wearing ${SET_OUTFITS[k % SET_OUTFITS.length]}, ${SET_POSES[k % SET_POSES.length]}`;
}

/**
 * The pictures to draw: one per sprite role, and one per frame for a role with variants. Each has a
 * `key` (the role id, or "<id>#<frame>"), the role, its frame and its name.
 */
export function pictureItems(roles, direction) {
  const items = [];
  for (const role of roles) {
    if (role.kind !== 'sprite') continue;
    if (!role.variants) { items.push({ key: role.id, role, name: role.describe.name, text: String(direction?.roles?.[role.id] ?? role.describe.name).slice(0, 220) }); continue; }
    // The role's one-line description ("waving, cream fur") would pull every item toward the same
    // look, so set items carry only their own description.
    const given = Array.isArray(direction?.variants?.[role.id]) ? direction.variants[role.id] : [];
    const used = new Set();
    role.variants.slice(0, IMAGE_ART_LIMITS.max_variants).forEach((name, k) => {
      const d = given[k] ? String(given[k]).trim() : '';
      const look = d ? (d.toLowerCase().includes(name.toLowerCase()) ? d : `${name}: ${d}`) : variantLook(name, k, used);
      items.push({ key: `${role.id}#${k}`, role, frame: k, name, text: look.slice(0, 240) });
    });
  }
  return items;
}

/** Sheets of at most `max` pictures; a role's set stays on one sheet when it fits. */
export function packSheets(items, max = IMAGE_ART_LIMITS.sheet_max) {
  const byRole = [];
  for (const it of items) { const last = byRole[byRole.length - 1]; if (last && last[0].role === it.role) last.push(it); else byRole.push([it]); }
  const groups = [];
  let cur = [];
  for (const set of byRole) {
    // A set that fits one sheet moves to a fresh sheet rather than split; a bigger one fills sheets in turn.
    if (set.length <= max && cur.length + set.length > max) { groups.push(cur); cur = []; }
    for (const it of set) {
      if (cur.length === max) { groups.push(cur); cur = []; }
      cur.push(it);
    }
  }
  if (cur.length) groups.push(cur);
  return groups.filter((g) => g.length);
}

// What the authoring manifest says about a role: the fragment's art header text, if one names it.
function describeRole(id, authoring) {
  const words = id.replace(/_/g, ' ');
  const style = authoring?.art?.style ? String(authoring.art.style) : '';
  return { name: words, hint: style.slice(0, 120) };
}

// ---------- art direction (optional Muse text call) ----------

export const ART_DIRECTION_OPTIONS = { model: 'muse-spark-1.3', effort: 'low', max_tokens: 4000 };

export function artDirectionPrompt({ request, title, instructions, spec, roles, sheet }) {
  const system = [
    'You are the art director for a tiny mobile game. You describe what each picture shows so an image model can draw it.',
    'Reply with JSON only: {"roles": {"<role id>": "<what it looks like, 8-25 words: subject, pose, key colors, one distinctive feature>"}, "backdrop": "<the scene behind play, 15-35 words, calm, no characters, nothing in the middle third>", "real_people": ["<names of real, living or historical people the game shows>"], "key": "magenta | green | blue"}.',
    'Keep the names the person used (franchises, brands, characters, memes) and describe them so they are recognisable. Brand logos and colors are fine.',
    'Real people are drawn as stylised cartoon caricatures, so list every real person in real_people. Fictional characters are not real people.',
    'Every role is one isolated subject drawn at 64 pixels, so describe a bold, simple silhouette with big readable shapes; no tiny text.',
    'Pick "key": the flat background color the image model paints around the sprites. It must not appear in any sprite: magenta unless something is pink or purple, then green unless something is green, else blue.',
    ...(roles.some((r) => r.variants) ? ['Some roles are a set of different items, listed in "items" (one picture each). For each such role add "variants": {"<role id>": ["<one entry per item, same order: the item name as written, then 10-25 words: its main color, outfit, pose and one prop>"]}. Every item in a set must look clearly different from the others: its own main color, its own outfit, its own pose. Keep the names exactly as listed.'] : []),
  ].join('\n');
  const user = JSON.stringify({
    request: String(request ?? '').slice(0, 400),
    title,
    rules: String(instructions ?? '').slice(0, 400),
    theme: spec?.theme ?? null,
    look: spec?.feel?.look ?? null,
    style: sheet ? `${sheet.name}: ${sheet.look}` : null,
    roles: roles.filter((r) => r.kind === 'sprite').map((r) => ({ id: r.id, box: `${r.w}x${r.h}`, ...(r.variants ? { items: r.variants.slice(0, IMAGE_ART_LIMITS.max_variants) } : r.frames > 1 ? { frames: r.frames } : {}) })),
    has_backdrop: roles.some((r) => r.kind === 'backdrop'),
  });
  return { system, user };
}

/** Lenient JSON from a model reply (fences and prose around it are dropped). */
export function parseJSONReply(text) {
  const s = String(text ?? '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/** Deterministic role descriptions when there's no art direction: the role name in the game's world. */
export function fallbackDirection({ title, spec, roles }) {
  const named = (spec?.theme?.named ?? []).map(String);
  const out = { roles: {}, backdrop: '', real_people: [], key: 'magenta' };
  for (const r of roles) {
    if (r.kind !== 'sprite') continue;
    const match = named.find((n) => n.toLowerCase().split(/\s+/).some((w) => w.length > 3 && r.id.includes(w.toLowerCase())));
    out.roles[r.id] = match ? `${match} (${r.describe.name})` : `${r.describe.name} for "${title}"`;
  }
  out.backdrop = `${spec?.theme?.world || title} scene, calm and simple, no characters`;
  return out;
}

// ---------- image prompts ----------

const KEY_TEXT = { magenta: 'pure magenta (#FF00FF)', green: 'pure green (#00FF00)', blue: 'pure blue (#0000FF)' };

/**
 * The chroma key: the direction's pick, unless a picture description names that color. When every key
 * color is named somewhere (a rainbow set), the one named least.
 */
export function pickKey(direction, extra = []) {
  const text = [...Object.values(direction?.roles ?? {}), ...Object.values(direction?.variants ?? {}).flat(), ...extra].join(' ').toLowerCase();
  const avoid = { magenta: /\b(pink|magenta|purple|violet|fuchsia|lilac)/g, green: /\b(green|lime|frog|crocodile|plant|leaf|leaves|cactus|grass|zombie|mint)/g, blue: /\b(blue|navy|sky)\b/g };
  const order = [direction?.key, 'magenta', 'green', 'blue'].filter((k, i, a) => KEY_TEXT[k] && a.indexOf(k) === i);
  const count = (k) => (text.match(avoid[k]) ?? []).length;
  return order.find((k) => !count(k)) ?? [...order].sort((a, b) => count(a) - count(b))[0] ?? 'magenta';
}

const BG_RULES = (key) => `Background: one flat solid ${KEY_TEXT[key]} everywhere, no gradient, no floor, no cast shadows on the background, no text, no labels, no borders, no grid lines, no frames.`;

const shapeHint = (r) => (r.h > r.w * 1.25 ? 'tall composition' : r.w > r.h * 1.25 ? 'wide composition' : 'compact composition');

export function sheetPrompt(sheet, items, cols, rows, key) {
  const list = items.map((it, i) => `(${i + 1}) ${it.text} [${shapeHint(it.role)}]`).join('; ');
  // A set (nine Labubu figures) is named as one, so the model draws each item differently.
  const sets = [];
  for (const it of items) if (it.frame !== undefined) { const s = sets.find((x) => x.role === it.role); if (s) s.to = items.indexOf(it) + 1; else sets.push({ role: it.role, from: items.indexOf(it) + 1, to: items.indexOf(it) + 1 }); }
  const setText = sets.filter((s) => s.to > s.from).map((s) => ` Subjects ${s.from} to ${s.to} are ${s.to - s.from + 1} different figures of one collectible set: same character type, but each has its own main color, outfit and pose exactly as described; no two alike, never repeat the same figure.`).join('');
  return `Game sprite sheet for "${sheet.title}": ${items.length} separate subjects arranged in a ${cols} columns x ${rows} rows grid, reading order left to right then top to bottom, each one centered in its own cell with wide empty space around it, nothing touching or overlapping. ${list}.${setText} ${styleText(sheet)} Each subject: ${sheet.framing}. ${BG_RULES(key)}`;
}

export function rolePrompt(sheet, item, key) {
  return `One game sprite for "${sheet.title}": ${item.text} [${shapeHint(item.role)}]. ${styleText(sheet)} ${sheet.framing}, filling most of the image with a small margin. ${BG_RULES(key)}`;
}

export function backdropPrompt(sheet, text) {
  return `Full-screen vertical mobile game background for "${sheet.title}": ${text}. ${styleText(sheet)} Calm, low contrast, soft detail, no characters, no text, no logos in the middle, nothing important in the middle third, where the game is played.`;
}

// ---------- processing ----------

/** Fits a keyed, trimmed sprite into its asset box at `px` (longest side), padded 4%, sharpened. */
export function finishSprite(img, role, px, sheet) {
  const aspect = role.h / role.w;
  const W = Math.max(8, Math.round(aspect <= 1 ? px : px / aspect));
  const H = Math.max(8, Math.round(aspect <= 1 ? px * aspect : px));
  const pad = Math.max(1, Math.round(Math.min(W, H) * 0.04));
  let f = X.fitInto(img, W - 2 * pad, H - 2 * pad);
  const box = X.blank(W, H);
  X.paste(box, f, pad, pad);
  f = sheet.pixel ? box : X.sharpen(box, 0.35);
  if (role.frames > 1) f = bobFrames(f, role.frames, role.cols);
  return f;
}

// A still pose turned into a gentle run/idle cycle: each frame bobs and squashes a little.
function bobFrames(img, frames, cols) {
  const rows = Math.ceil(frames / cols);
  const out = X.blank(img.w * cols, img.h * rows);
  for (let k = 0; k < frames; k++) {
    const t = (k / frames) * Math.PI * 2;
    const dy = Math.round(-Math.abs(Math.sin(t)) * img.h * 0.05);
    const sq = 1 - Math.abs(Math.cos(t)) * 0.03;
    const r = X.resize(img, img.w, Math.round(img.h * sq));
    const frame = X.blank(img.w, img.h);
    X.paste(frame, r, 0, img.h - r.h + dy);
    X.paste(out, frame, (k % cols) * img.w, Math.floor(k / cols) * img.h);
  }
  return out;
}

/** Encodes a sprite as an 8-bit palette PNG (truecolor when the palette loses too much). */
export function encodeSprite(img, deflate, { colors = 255 } = {}) {
  const q = quantize(img, colors);
  return { bytes: encodePNG(img, deflate, { palette: q }), mime: 'image/png' };
}

export function encodeBackdrop(img, quality) {
  return { bytes: encodeJPEG(img, quality), mime: 'image/jpeg' };
}

const uriLength = (bytes, mime) => `data:${mime};base64,`.length + Math.ceil(bytes.length / 3) * 4;

/**
 * Encodes every finished picture within the budget. Starts at the best settings and steps down, in a
 * fixed order (sprite size, sprite colors, backdrop quality, backdrop size), until the data URIs fit.
 */
export function fitBudget(pieces, deflate, { budget = IMAGE_ART_LIMITS.art_bytes, perImage = IMAGE_ART_LIMITS.image_bytes } = {}) {
  const steps = [];
  const [minPx, maxPx] = IMAGE_ART_LIMITS.sprite_px;
  // Sprites matter more than the backdrop at play size, so the backdrop steps down first (to 360 px
  // across, quality 55), then the sprites, then both.
  const spriteLadder = [{ px: maxPx, colors: 255 }, { px: 112, colors: 255 }, { px: 96, colors: 192 }, { px: 80, colors: 128 }, { px: 64, colors: 96 }, { px: minPx, colors: 64 }];
  const backLadder = [{ q: 72, bw: 540 }, { q: 64, bw: 540 }, { q: 62, bw: 450 }, { q: 58, bw: 360 }, { q: 50, bw: 360 }, { q: 45, bw: 270 }];
  const ladder = [];
  // With a raised budget (image games, see docs/harness-gaps/images.md) the art starts phone-sharp:
  // 192 px sprites and a 1080 px backdrop measured 230–335 KB on six games.
  if (budget > 256 * 1024) ladder.push({ px: 192, colors: 255, q: 72, bw: 1080 }, { px: 192, colors: 255, q: 70, bw: 720 }, { px: 160, colors: 255, q: 70, bw: 720 });
  for (let b = 0; b <= 3; b++) ladder.push({ ...spriteLadder[0], ...backLadder[b] });
  for (let s = 1; s < spriteLadder.length; s++) ladder.push({ ...spriteLadder[s], ...backLadder[Math.min(3 + Math.floor(s / 2), backLadder.length - 1)] });
  const cache = new Map();
  const encode = (p, st) => {
    const k = p.kind === 'sprite' ? `${p.id}|${Math.min(st.px, p.maxPx ?? st.px)}|${st.colors}` : `${p.id}|${st.bw}|${st.q}`;
    if (cache.has(k)) return cache.get(k);
    let out;
    if (p.kind === 'backdrop' || p.kind === 'still') {
      const img = p.render({ bw: st.bw });
      out = encodeBackdrop(img, st.q);
      out.size = [img.w, img.h];
    } else {
      const img = p.render({ px: Math.min(st.px, p.maxPx ?? st.px) });
      out = encodeSprite(img, deflate, { colors: p.pixel ? Math.min(st.colors, 48) : st.colors });
      out.size = [img.w, img.h];
    }
    out.uri = uriLength(out.bytes, out.mime);
    cache.set(k, out);
    return out;
  };
  let last = null;
  for (const st of ladder) {
    const enc = {};
    let total = 0;
    for (const p of pieces) { enc[p.id] = encode(p, st); total += enc[p.id].uri; }
    steps.push({ ...st, total });
    last = { enc, total, step: st };
    const tooBig = Object.values(enc).some((e) => e.uri > perImage);
    if (total <= budget && !tooBig) return { ...last, fits: true, steps };
  }
  return { ...last, fits: false, steps };
}

// ---------- image calls ----------

export const REWRITE_SYSTEM = 'You rewrite prompts for an image model that refuses some trademarked characters and franchises. Rewrite the prompt so it names no trademarked character, franchise, vehicle, place or real person: describe each one visually instead (shape, outfit, colors, signature details), so the picture still reads as the same idea. Keep every style, layout and background instruction word for word. Reply with JSON only: {"prompt": "<the rewritten prompt>"}';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces the given names in a prompt (the fallback when no rewrite call is possible). */
export function stripNames(prompt, names) {
  let p = String(prompt);
  // Full names first, then each name's last word ("Leia" on its own), longest first.
  const all = names.map(String).filter((x) => x.trim().length > 2);
  const lastWords = all.map((n) => n.trim().split(/\s+/)).filter((w) => w.length > 1).map((w) => w[w.length - 1]).filter((w) => w.length >= 4);
  for (const n of [...new Set([...all, ...lastWords])].sort((a, b) => b.length - a.length)) {
    p = p.replace(new RegExp(`\\b${escapeRe(n)}\\b`, 'gi'), 'the character');
  }
  return p;
}

/**
 * One image call with bookkeeping. When muse-image refuses a prompt (content_policy_violation: it
 * refuses some franchise characters, such as Star Wars ones, even when the person named them), the
 * prompt is rewritten once without the names (by a Muse text call when `ask` is there, else by
 * replacing the known names) and tried again. Rewrites are listed in stats.policy_rewrites.
 */
export function makeImageCall({ image, ask }, stats, names = []) {
  return async (purpose, prompt, reference) => {
    const once = async (p) => {
      const t = Date.now();
      const r = await image({ prompt: p, purpose, ...(reference ? { reference } : {}) });
      const tok = r?.usage?.total_tokens ?? 0;
      stats.image_calls++;
      stats.tokens.image += tok;
      stats.calls.push({ purpose, ms: Date.now() - t, tokens: tok, bytes: r.bytes.length, ...(reference ? { reference: true } : {}) });
      return r;
    };
    try { return await once(prompt); } catch (e) {
      if (!/content.?policy|filtered/i.test(String(e?.message ?? e))) throw e;
      let p2 = null;
      if (ask) {
        try {
          const r = await ask(REWRITE_SYSTEM, prompt, 'image prompt rewrite', ART_DIRECTION_OPTIONS);
          stats.text_calls++;
          const u = r?.usage;
          if (u) stats.tokens.text += (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
          p2 = parseJSONReply(textOf(r))?.prompt ?? null;
        } catch { /* fall back to replacing names */ }
      }
      if (!p2 || typeof p2 !== 'string') p2 = stripNames(prompt, names);
      stats.policy_rewrites = [...(stats.policy_rewrites ?? []), purpose];
      try { return await once(p2); } catch (e2) {
        // Last try: the rewrite with every known name replaced too.
        const p3 = stripNames(p2, names);
        if (p3 === p2 || !/content.?policy|filtered/i.test(String(e2?.message ?? e2))) throw e2;
        return await once(p3);
      }
    }
  };
}

// ---------- the step ----------

async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); }
  }));
  return out;
}

const textOf = (r) => (typeof r === 'string' ? r : r?.content ?? '');

/**
 * Makes picture art for an expanded game.
 * input: {game (expanded game object), authoring?, request, spec?, style?, title?}
 * deps: {image, decode, deflate, ask?}
 * opts: {strategy: 'sheet' | 'each', budget, backdrop: true}
 * Returns {assets: {id: asset}, record, stats, direction, sheet, keyed: {id: img}} — assets keep the
 * game's w/h/frames/cols/fps and swap svg for a data: image.
 */
export async function makeImageArt(input, deps, opts = {}) {
  const { game, authoring = null, request = '', spec = null } = input;
  const { image, decode, deflate, ask } = deps;
  const strategy = opts.strategy ?? 'sheet';
  const t0 = Date.now();
  const stats = { strategy, calls: [], image_calls: 0, text_calls: 0, tokens: { image: 0, text: 0 }, ms: {} };
  const roles = spriteRoles(game, authoring).slice(0, IMAGE_ART_LIMITS.max_sprites + 1);
  const sprites = roles.filter((r) => r.kind === 'sprite');
  const backdrop = opts.backdrop === false ? null : roles.find((r) => r.kind === 'backdrop');
  const tokens = game?.presentation?.tokens ?? {};
  const palette = ['primary', 'secondary', 'accent', 'danger'].map((k) => tokens[k]).filter(Boolean);
  const title = input.title ?? game?.meta?.title ?? 'a game';
  const sheet = styleSheet({ request, style: input.style ?? null, spec, palette, title });

  // Art direction.
  let direction = null;
  if (ask) {
    const t = Date.now();
    try {
      const { system, user } = artDirectionPrompt({ request, title, instructions: game?.meta?.instructions, spec, roles, sheet });
      const r = await ask(system, user, 'image art direction', ART_DIRECTION_OPTIONS);
      stats.text_calls++;
      const u = r?.usage;
      if (u) stats.tokens.text += (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
      direction = parseJSONReply(textOf(r));
    } catch (e) { stats.direction_error = String(e?.message ?? e).slice(0, 160); }
    stats.ms.direction = Date.now() - t;
  }
  const fb = fallbackDirection({ title, spec, roles });
  direction = { ...fb, ...(direction ?? {}), roles: { ...fb.roles, ...(direction?.roles ?? {}) } };
  const people = [...new Set([...(Array.isArray(direction.real_people) ? direction.real_people.map(String) : []), ...findPeople(`${request} ${title}`)])];
  const guarded = (p) => { const g = guardPrompt(p, people); if (g.changed) stats.guarded = (stats.guarded ?? 0) + 1; return g.prompt; };
  // One picture per sprite role, and one per item for a role that shows a set of different things.
  const items = pictureItems(sprites, direction);
  const key = pickKey(direction, items.map((it) => it.text));
  const keyRGB = X.KEYS[key];
  const variantRoles = sprites.filter((r) => r.variants);
  if (variantRoles.length) stats.variants = Object.fromEntries(variantRoles.map((r) => [r.id, r.variants.length]));

  // Image calls.
  const imageCall = makeImageCall({ image, ask }, stats, [...people, ...(spec?.theme?.named ?? []).map(String)]);
  const call = async (purpose, prompt, reference) => decode((await imageCall(purpose, prompt, reference)).bytes);
  const tasks = [];
  const groups = strategy === 'sheet' ? packSheets(items, opts.sheet_max ?? IMAGE_ART_LIMITS.sheet_max) : items.map((it) => [it]);
  const cut = {};
  const cells = {};
  const prompts = {};
  const single = async (it, label) => {
    const p = guarded(rolePrompt(sheet, it, key));
    prompts[it.key] = p;
    const img = await call(label, p);
    cut[it.key] = largest(X.chromaKey(halve(img), X.detectKey(img, keyRGB)));
    delete cells[it.key];
  };
  groups.forEach((g, gi) => {
    tasks.push(async () => {
      if (g.length === 1) return single(g[0], `sprite ${g[0].key}`);
      const cols = Math.ceil(Math.sqrt(g.length)), rows = Math.ceil(g.length / cols);
      const p = guarded(sheetPrompt(sheet, g, cols, rows, key));
      for (const it of g) prompts[it.key] = p;
      const img = await call(`sheet ${gi + 1}`, p);
      const keyed = X.chromaKey(halve(img), X.detectKey(img, keyRGB));
      const s = X.sliceSheet(keyed, g.length, cols, rows);
      stats.slice = [...(stats.slice ?? []), s.method];
      const cw = keyed.w / cols, ch = keyed.h / rows;
      g.forEach((it, i) => {
        cut[it.key] = s.sprites[i];
        // The grid cell, so the sprite check can tell a slice that cuts through a figure.
        if (s.method !== 'regions') cells[it.key] = X.crop(keyed, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
      });
    });
  });
  let backdropImg = null;
  if (backdrop) {
    tasks.push(async () => {
      const p = guarded(backdropPrompt(sheet, String(direction.backdrop || fb.backdrop).slice(0, 300)));
      prompts.backdrop = p;
      backdropImg = await call('backdrop', p);
    });
  }
  const tImg = Date.now();
  await pool(tasks, IMAGE_ART_LIMITS.concurrency);
  stats.ms.images = Date.now() - tImg;

  // The sprite check: every picture must differ from the others and hold one whole figure. Flagged
  // slices (empty, cut, two figures, or the later of two look-alikes) are redrawn one by one.
  const check = () => checkSprites(items.map((it) => ({ key: it.key, img: cut[it.key] ?? null, ...(cells[it.key] ? { cell: cells[it.key] } : {}) })));
  let checked = check();
  stats.sprite_check = { issues: summarize(checked) };
  const redraw = redrawKeys(checked).slice(0, opts.max_redraws ?? IMAGE_ART_LIMITS.max_redraws);
  if (redraw.length && strategy === 'sheet' && opts.retry !== false) {
    await pool(redraw.map((k) => async () => single(items.find((it) => it.key === k), `sprite ${k} (redraw)`)), IMAGE_ART_LIMITS.concurrency);
    stats.retried = redraw;
    checked = check();
    stats.sprite_check.after = summarize(checked);
  }
  stats.sprite_check.ok = checked.ok;

  // Encode within the budget.
  const tEnc = Date.now();
  const pieces = [];
  for (const role of sprites) {
    if (role.variants) {
      // One frame per item, in the asset's own frame grid, so frame k is item k.
      const mine = items.filter((it) => it.role === role);
      const srcs = mine.map((it) => cut[it.key]).map((s) => (s && X.alphaBox(s) ? s : null));
      if (!srcs.some(Boolean)) continue;
      const near = (k) => srcs[k] ?? srcs.find(Boolean);
      pieces.push({ id: role.id, kind: 'sprite', pixel: sheet.pixel, render: ({ px }) => setFrames(Array.from({ length: role.frames }, (_, k) => near(Math.min(k, srcs.length - 1))), role, px, sheet) });
      continue;
    }
    const src = cut[role.id];
    if (!src || !X.alphaBox(src)) continue;
    pieces.push({ id: role.id, kind: 'sprite', pixel: sheet.pixel, render: ({ px }) => finishSprite(src, role, px, sheet) });
  }
  if (backdropImg && backdrop) {
    const aspect = backdrop.w / backdrop.h;
    // Calmed toward the game's background color, so sprites read on top of it.
    const bgHex = resolveColor(game, game?.presentation?.canvas?.background) ?? '#000000';
    // Busy pictures get more: the tint grows with busyness and a light blur keeps detail off the play.
    const base = X.cropAspect(backdropImg, aspect);
    const small = X.resize(base, 360, Math.round(360 / aspect));
    const busy = X.busyness(small);
    const loud = X.loudness(small);
    // Measured on six games: calm cartoon backdrops have saturation ≤ 0.5 and contrast ≤ 0.2; neon
    // ones (saturation ~0.87) need the most.
    const calm = opts.calm ?? Math.min(0.45, Math.max(0.15, 0.15 + Math.max(0, loud.saturation - 0.45) * 0.6 + Math.max(0, loud.contrast - 0.15) + Math.max(0, busy - 0.04) * 4));
    const r3 = (v) => Math.round(v * 1000) / 1000;
    stats.backdrop = { busy: r3(busy), contrast: r3(loud.contrast), saturation: r3(loud.saturation), calm: Math.round(calm * 100) / 100 };
    const cropped = X.tint(base, hexRGB(bgHex), calm);
    pieces.push({ id: 'backdrop', kind: 'backdrop', render: ({ bw }) => { const r = X.resize(cropped, bw, Math.round(bw / aspect)); return busy > 0.06 ? X.blur(r, 1) : r; } });
  }
  const fit = fitBudget(pieces, deflate, { budget: opts.budget ?? IMAGE_ART_LIMITS.art_bytes });
  stats.ms.encode = Date.now() - tEnc;
  stats.budget = { fits: fit.fits, total: fit.total, step: fit.step, steps: fit.steps.length };

  const assets = {};
  const record = { format: IMAGE_ART_FORMAT, model: 'muse-image-1.0', license: 'generated', style: sheet.name, strategy, key, real_people_caricatured: people, pictures: [] };
  for (const role of roles) {
    const e = fit.enc[role.id];
    if (!e) continue;
    const a = { image: dataUri(e.mime, e.bytes), w: role.w, h: role.h };
    if (role.frames > 1) { a.frames = role.frames; a.cols = role.cols; }
    if (role.fps !== undefined) a.fps = role.fps;
    assets[role.id] = a;
    const first = role.variants ? `${role.id}#0` : role.id;
    record.pictures.push({ id: role.id, license: 'generated', source: 'muse-image-1.0', mime: e.mime, px: e.size, bytes: e.bytes.length, uri_bytes: e.uri, prompt: prompts[first] ?? null, ...(role.variants ? { frames: role.variants.slice(0, role.frames) } : {}) });
  }
  stats.ms.total = Date.now() - t0;
  stats.bytes = { uri_total: fit.total, pictures: record.pictures.length };
  return { assets, record, stats, direction, sheet, keyed: cut, items: items.map(({ key, name, text }) => ({ key, name, text })), check: checked, fits: fit.fits };
}

const summarize = (c) => c.issues.map((i) => `${i.code} ${i.keys.join(' ')}`);

/** A set's frames: each item's own picture fitted to the frame box, laid out in the asset's frame grid. */
export function setFrames(srcs, role, px, sheet) {
  const one = { ...role, frames: 1, cols: 1 };
  const frames = srcs.map((s) => finishSprite(s, one, px, sheet));
  const fw = frames[0].w, fh = frames[0].h, cols = role.cols ?? frames.length, rows = Math.ceil(frames.length / cols);
  const out = X.blank(fw * cols, fh * rows);
  frames.forEach((f, k) => X.paste(out, f, (k % cols) * fw, Math.floor(k / cols) * fh));
  return out;
}

function resolveColor(game, v) {
  const tokens = game?.presentation?.tokens ?? {};
  for (let i = 0; i < 4 && typeof v === 'string' && v.startsWith('$'); i++) v = tokens[v.slice(1)];
  return typeof v === 'string' && HEXRE.test(v) ? v.slice(0, 7) : null;
}
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// Model images are 1600–1920 px; halving first makes keying and slicing 4× faster with no visible loss
// at play size.
function halve(img) { return img.w > 1000 ? X.resize(img, img.w / 2, img.h / 2) : img; }
function largest(keyed) {
  const r = X.components(keyed)[0];
  return r ? X.trim(X.crop(keyed, r.x, r.y, r.w, r.h)) : X.trim(keyed);
}

// ---------- applying it ----------

/**
 * A new manifest with the pictures in place: content.game_json's assets swap svg for image (same ids,
 * size and frames), content.authoring_json's art sprites and backdrop get the same images (so remixes
 * keep them), and manifest.art_record lists each picture with license "generated".
 * Everything else in game_json is byte-for-byte the same JSON, so rules and replays don't change.
 */
export function applyImageArt(manifest, art) {
  const game = JSON.parse(manifest.content.game_json);
  for (const [id, a] of Object.entries(art.assets)) {
    if (!game.assets?.[id]) continue;
    const { svg: _svg, image: _img, ...rest } = game.assets[id];
    game.assets[id] = { image: a.image, ...rest, w: a.w, h: a.h };
  }
  const content = { ...manifest.content, game_json: JSON.stringify(game) };
  if (manifest.content.authoring_json) {
    try {
      const au = JSON.parse(manifest.content.authoring_json);
      if (au.art) {
        const sprites = { ...(au.art.sprites ?? {}) };
        for (const [id, a] of Object.entries(art.assets)) {
          if (id === 'backdrop') continue;
          const old = sprites[id] ?? {};
          const s = { image: a.image, w: a.w, h: a.h };
          if (a.frames) { s.frames = a.frames; s.cols = a.cols; }
          if (a.fps !== undefined) s.fps = a.fps;
          if (old.color) s.color = old.color;
          sprites[id] = s;
        }
        au.art = { ...au.art, sprites, ...(art.assets.backdrop ? { backdrop: { image: art.assets.backdrop.image } } : {}) };
        content.authoring_json = JSON.stringify(au);
      }
    } catch { /* authoring text that doesn't parse stays as it was */ }
  }
  return { ...manifest, content, art_record: art.record };
}

// ---------- stories: portraits and scene stills ----------

export const STORY_ART = Object.freeze({
  maxCast: 4,
  maxStills: 5,
  still: { w: 320, h: 164, y: 160 },
  portrait: { size: 84, x: 64, y: 122 },
  layout: { place_y: 262, text_y: 292, button_y: 418, card_y: 424 },
});

/** The scenes of a compiled story manifest (story_vars content): text, place, links, endings. */
export function storyScenes(authoring) {
  const c = authoring?.content ?? {};
  const lines = c.story_lines ?? [];
  const n = Math.floor(lines.length / 4);
  const scenes = [];
  for (let s = 0; s < n; s++) {
    const next = [0, 1, 2].filter((j) => (c.sg_src_labels ?? [])[s * 3 + j] && (c.sg_src_next ?? [])[s * 3 + j] !== '').map((j) => Number((c.sg_src_next ?? [])[s * 3 + j]));
    const routes = [0, 1, 2].flatMap((j) => String((c.sg_route ?? [])[s * 3 + j] ?? '').split(';').filter(Boolean).map((r) => Number(r.split('~')[1])));
    scenes.push({
      k: s,
      text: lines.slice(s * 4, s * 4 + 4).filter(Boolean).join(' '),
      place: (c.sg_place ?? [])[s] ?? '',
      ending: (c.story_ends ?? [])[s] || '',
      ending_title: (c.sg_end_title ?? [])[s] ?? '',
      next: [...new Set([...next, ...routes])].filter((v) => Number.isInteger(v) && v >= 0 && v < n),
    });
  }
  return scenes;
}

export function storyDirectionPrompt({ request, title, premise, scenes, sheet }) {
  const system = [
    'You are the art director for an illustrated choose-your-own-adventure. Pick the cast and the key pictures.',
    `Reply with JSON only: {"cast": [{"id": "<snake_case>", "name": "<as written>", "look": "<a fixed visual description reused in every picture: species/age, face, hair, outfit, colors, one signature item; 20-40 words>"}], "who": [<per scene, the index into cast of who is on screen, or -1>], "stills": [{"scene": <scene index>, "prompt": "<the picture: setting, action, who, 20-40 words>"}], "real_people": ["<real people named>"]}.`,
    `At most ${STORY_ART.maxCast} cast members (the hero first) and ${STORY_ART.maxStills} stills: the opening, the turning points most players reach, the best ending and one bad ending.`,
    'Keep names as the person wrote them (franchises and characters are fine). Real people are drawn as stylised cartoon caricatures; list them in real_people.',
  ].join('\n');
  const user = JSON.stringify({
    request: String(request ?? '').slice(0, 400),
    title,
    premise,
    style: `${sheet.name}: ${sheet.look}`,
    scenes: scenes.map((s) => ({ k: s.k, place: s.place, text: s.text.slice(0, 140), ...(s.ending ? { ending: `${s.ending}: ${s.ending_title}` } : {}), next: s.next })),
  });
  return { system, user };
}

/** Each scene's still: its own, else its nearest parent's (breadth first from the start). */
export function inheritStills(scenes, own) {
  const out = scenes.map(() => -1);
  const seen = new Set([0]);
  const q = [0];
  out[0] = own[0] ?? -1;
  for (let i = 0; i < q.length; i++) {
    const s = q[i];
    for (const t of scenes[s].next) {
      if (seen.has(t)) continue;
      seen.add(t);
      out[t] = own[t] ?? out[s];
      q.push(t);
    }
  }
  for (let s = 0; s < scenes.length; s++) if (!seen.has(s)) out[s] = own[s] ?? out[0];
  return out;
}

function fallbackStoryDirection({ title, premise, request, scenes }) {
  const hero = (String(request).match(/play as ([A-Z][\w'.-]*(?: [A-Z][\w'.-]*)*)/) ?? [])[1] ?? 'the hero';
  const best = scenes.find((s) => s.ending === 'good');
  const bad = scenes.find((s) => s.ending === 'bad');
  const stills = [scenes[0], best, bad].filter(Boolean).map((s) => ({ scene: s.k, prompt: `${s.place ? s.place + ': ' : ''}${s.text}` }));
  return { cast: [{ id: 'hero', name: hero, look: `${hero}, the hero of "${title}". ${premise ?? ''}`.slice(0, 200) }], who: scenes.map(() => 0), stills, real_people: [] };
}

export function lineupPrompt(sheet, cast, key) {
  const list = cast.map((c, i) => `(${i + 1}) ${c.name}: ${c.look}`).join('; ');
  return `Character lineup sheet for the illustrated story "${sheet.title}": ${cast.length} head-and-shoulders portrait busts side by side in one row, left to right, each facing the viewer, centered in its own equal-width slot with wide empty space between them, nothing touching. ${list}. ${styleText(sheet)} Expressive faces, clear silhouettes. ${BG_RULES(key)}`;
}

export function stillPrompt(sheet, still, cast) {
  return `A wide cinematic story illustration: ${still.prompt}. The ${cast.length > 1 ? `${cast.length} characters` : 'character'} in the reference sheet, left to right, are ${cast.map((c) => c.look.split(/[.;]/)[0].slice(0, 60)).join(' | ')}; whoever appears looks exactly as in the reference: same faces, hair, outfits and colors. ${styleText(sheet)} Wide landscape composition, subject in the middle band, no text, no captions, no speech bubbles, no borders.`;
}

/**
 * Story art for a compiled story (authoring manifest with story_vars): a portrait per main character
 * and a still per key scene, in one style, the stills drawn with the character lineup as a reference.
 * Returns {sprites: {portrait, still}, params: {stills, cast_at}, layout, record, stats, direction}.
 */
export async function makeStoryArt(input, deps, opts = {}) {
  const { authoring, request = '', spec = null } = input;
  const { image, decode, deflate, ask } = deps;
  const t0 = Date.now();
  const stats = { calls: [], image_calls: 0, text_calls: 0, tokens: { image: 0, text: 0 }, ms: {} };
  const scenes = storyScenes(authoring);
  if (!scenes.length) throw new Error('not a compiled story (no story_lines)');
  const title = authoring?.meta?.title ?? 'a story';
  const premise = String(authoring?.meta?.instructions ?? '').slice(0, 200);
  const palette = Object.values(authoring?.art?.palette ?? {});
  const sheet = styleSheet({ request, style: input.style ?? null, spec, palette, title });
  sheet.framing = 'head-and-shoulders portrait';

  let direction = null;
  if (ask) {
    const t = Date.now();
    try {
      const { system, user } = storyDirectionPrompt({ request, title, premise, scenes, sheet });
      const r = await ask(system, user, 'story art direction', { ...ART_DIRECTION_OPTIONS, max_tokens: 6000 });
      stats.text_calls++;
      const u = r?.usage;
      if (u) stats.tokens.text += (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
      direction = parseJSONReply(textOf(r));
    } catch (e) { stats.direction_error = String(e?.message ?? e).slice(0, 160); }
    stats.ms.direction = Date.now() - t;
  }
  const fb = fallbackStoryDirection({ title, premise, request, scenes });
  const cast = (Array.isArray(direction?.cast) && direction.cast.length ? direction.cast : fb.cast).slice(0, STORY_ART.maxCast)
    .map((c, i) => ({ id: String(c.id ?? `c${i}`), name: String(c.name ?? c.id ?? `character ${i + 1}`).slice(0, 60), look: String(c.look ?? '').slice(0, 260) }));
  const who = scenes.map((_, s) => { const v = Number(direction?.who?.[s] ?? fb.who[s]); return Number.isInteger(v) && v >= -1 && v < cast.length ? v : 0; });
  const stillsWanted = (Array.isArray(direction?.stills) && direction.stills.length ? direction.stills : fb.stills)
    .filter((s) => Number.isInteger(s?.scene) && s.scene >= 0 && s.scene < scenes.length)
    .filter((s, i, a) => a.findIndex((x) => x.scene === s.scene) === i)
    .slice(0, STORY_ART.maxStills);
  if (!stillsWanted.some((s) => s.scene === 0)) {
    stillsWanted.unshift({ scene: 0, prompt: fb.stills[0].prompt });
    stillsWanted.splice(STORY_ART.maxStills);
  }
  const people = [...new Set([...(Array.isArray(direction?.real_people) ? direction.real_people.map(String) : []), ...findPeople(`${request} ${title}`)])];
  const guarded = (p) => { const g = guardPrompt(p, people); if (g.changed) stats.guarded = (stats.guarded ?? 0) + 1; return g.prompt; };
  const key = pickKey({ roles: Object.fromEntries(cast.map((c) => [c.id, c.look])) });
  const keyRGB = X.KEYS[key];

  const imageCall = makeImageCall({ image, ask }, stats, [...people, ...cast.map((c) => c.name), ...(spec?.theme?.named ?? []).map(String)]);
  const call = async (purpose, prompt, reference) => { const r = await imageCall(purpose, prompt, reference); return { img: decode(r.bytes), bytes: r.bytes }; };

  // 1. The lineup (one call), then 2. the stills with the lineup as the reference (in parallel).
  const tImg = Date.now();
  const lineupText = guarded(lineupPrompt(sheet, cast, key));
  const lineup = await call('character lineup', lineupText);
  // The reference is the keyed lineup on a neutral grey, so the key color doesn't leak into scenes.
  const keyed = X.chromaKey(halve(lineup.img), X.detectKey(lineup.img, keyRGB));
  const reference = opts.reference === false ? null : encodePNG(X.flatten(keyed, [228, 228, 228]), deflate);
  const stillImgs = await pool(stillsWanted.map((s) => async () => {
    try { return (await call(`still ${s.scene}`, guarded(stillPrompt(sheet, s, cast)), reference)).img; } catch (e) { stats.still_errors = [...(stats.still_errors ?? []), String(e?.message ?? e).slice(0, 120)]; return null; }
  }), IMAGE_ART_LIMITS.concurrency);
  stats.ms.images = Date.now() - tImg;

  // Portraits: slice the lineup into the cast, each fitted into a square.
  const sliced = X.sliceSheet(keyed, cast.length, cast.length, 1);
  stats.slice = sliced.method;
  const P = STORY_ART.portrait;
  const portraitRole = { id: 'portrait', w: P.size, h: P.size, frames: cast.length, cols: cast.length };
  const S = STORY_ART.still;
  const okStills = stillsWanted.map((s, i) => ({ ...s, img: stillImgs[i] })).filter((s) => s.img);
  const pieces = [{
    id: 'portrait', kind: 'sprite', maxPx: 128,
    render: ({ px }) => {
      const frames = sliced.sprites.map((sp) => finishSprite(sp, { w: 1, h: 1, frames: 1 }, px, sheet));
      const out = X.blank(px * frames.length, px);
      frames.forEach((f, i) => X.paste(out, f, i * px, 0));
      return out;
    },
  }];
  if (okStills.length) {
    const crops = okStills.map((s) => X.cropAspect(s.img, S.w / S.h));
    pieces.push({
      id: 'still', kind: 'still',
      render: ({ bw }) => {
        const w = Math.round(Math.min(480, bw * 0.9)), h = Math.round((w * S.h) / S.w);
        const out = X.blank(w * crops.length, h);
        crops.forEach((c, i) => X.paste(out, X.resize(c, w, h), i * w, 0));
        return out;
      },
    });
  }
  const fit = fitBudget(pieces, deflate, { budget: opts.budget ?? IMAGE_ART_LIMITS.art_bytes - (opts.reserved ?? 0) });
  stats.budget = { fits: fit.fits, total: fit.total, step: fit.step };

  const own = {};
  okStills.forEach((s, i) => { own[s.scene] = i; });
  const stillAt = okStills.length ? inheritStills(scenes, own) : scenes.map(() => -1);
  const sprites = {
    portrait: { image: dataUri(fit.enc.portrait.mime, fit.enc.portrait.bytes), w: portraitRole.w, h: portraitRole.h, frames: portraitRole.frames, cols: portraitRole.cols },
  };
  if (okStills.length) sprites.still = { image: dataUri(fit.enc.still.mime, fit.enc.still.bytes), w: S.w, h: S.h, frames: okStills.length, cols: okStills.length };
  const record = {
    format: IMAGE_ART_FORMAT, model: 'muse-image-1.0', license: 'generated', style: sheet.name, kind: 'story', key,
    reference: !!reference, real_people_caricatured: people,
    cast: cast.map((c) => ({ id: c.id, name: c.name, look: c.look })),
    pictures: [
      { id: 'portrait', license: 'generated', source: 'muse-image-1.0', frames: cast.map((c) => c.name), bytes: fit.enc.portrait.bytes.length, prompt: lineupText },
      ...(okStills.length ? [{ id: 'still', license: 'generated', source: 'muse-image-1.0', frames: okStills.map((s) => `scene ${s.scene}`), bytes: fit.enc.still.bytes.length }] : []),
    ],
  };
  stats.ms.total = Date.now() - t0;
  return {
    sprites,
    params: { stills: stillAt.join('.'), cast_at: who.join('.') },
    record, stats, direction: { cast, who, stills: stillsWanted.map(({ scene, prompt }) => ({ scene, prompt })) }, sheet, fits: fit.fits,
    previews: { lineup: keyed, stills: okStills.map((s) => s.img) },
  };
}

/**
 * The story authoring manifest with its pictures: `portrait` and `still` sprites in art, story_vars
 * params `stills` and `cast_at` (one frame per scene, '.'-separated, -1 for none), and the text and
 * buttons moved down to make room. The caller re-expands it (studio.expand); rules don't change.
 */
export function applyStoryArt(authoring, art) {
  const au = JSON.parse(JSON.stringify(authoring));
  au.art = { ...(au.art ?? {}), sprites: { ...(au.art?.sprites ?? {}), ...art.sprites } };
  const L = STORY_ART.layout;
  for (const u of au.uses ?? []) {
    if (u.fragment === 'story_vars') u.params = { ...(u.params ?? {}), stills: art.params.stills, cast_at: art.params.cast_at, place_y: L.place_y, card_y: L.card_y };
    if (u.fragment === 'choice_story') u.params = { ...(u.params ?? {}), text_y: L.text_y, button_y: L.button_y };
  }
  return au;
}
