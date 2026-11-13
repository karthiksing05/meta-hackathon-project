// A game's own look: fonts and a type scale from its vibe, never a house style (authoring/kit/README.md).
//
//   chooseLook(words, gameId)       → spec: the vibe the words point to, one of its pairings and a
//                                     modular scale, both picked by the game id
//   chooseLook(words, gameId, {characterful: true}) → the same from the vibe's characterful
//                                     pairings (vibes.mjs BOLD: Rye, Creepster, Luckiest Guy, …)
//   lookFromChoice({vibe, pairing, seed})  → the same spec from the compact `art.type` block
//   applyLook(game, spec)           → a copy of the game (engine game.json) with every text node on the
//                                     pairing's fonts, weights, case and scale, text colours on the
//                                     game's palette, and the pairing's outline under display text
//   lookCheck(game, spec, {words})  → S_* findings ("does this look nice": consistency, not a
//                                     standard)
//
// Presentation only: text nodes' font, size (literals and the numbers an `if … then … else` picks),
// weight, colour, stroke and text case, plus derived tokens. Rules, state, inputs and every tap
// target stay as they were, so replays don't change. Deterministic. Pure JS (the Studio bundle
// packs it).

import { FONT_DATA, SYSTEM_STACKS } from './font-data.mjs';
import { VIBES, DEFAULT_VIBE } from './vibes.mjs';
import { normHex, hslOf, hsl, contrast, luminance } from '../expander/ui-style.mjs';

export const LOOK_KIT = 'look/1';

// ---------------------------------------------------------------- words → vibe ----

/** FNV-1a, 32 bit. */
export function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRes = new Map();
function wordRe(w) {
  let re = wordRes.get(w);
  if (!re) { re = new RegExp(`(?<![a-z0-9])${esc(w.toLowerCase())}(?:s|es)?(?![a-z0-9])`, 'i'); wordRes.set(w, re); }
  return re;
}

// How much each kind of word counts. The plan's own theme words and the person's request count most.
const FIELD_WEIGHT = { theme: 3, era: 3, genre: 3, type: 3, request: 3, title: 3, refs: 3, style: 2, keywords: 2, pitch: 1, art: 1 };

/**
 * Normalizes the words a vibe is read from. Accepts a plan's `spec.theme` / `understanding`
 * ({theme, era, genre, style, keywords, named_refs, families}), a request string, or any mix:
 * { request, title, theme, era, genre, style, keywords, refs, pitch, art }.
 */
export function lookWords(input = {}) {
  if (typeof input === 'string') return { request: input };
  const flat = (v) => (Array.isArray(v) ? v.flat(3).filter((x) => typeof x === 'string').join(' · ') : typeof v === 'string' ? v : '');
  const w = {};
  const put = (k, ...vals) => { const s = vals.map(flat).filter(Boolean).join(' · '); if (s) w[k] = w[k] ? `${w[k]} · ${s}` : s; };
  put('request', input.request, input.prompt, input.intent);
  put('title', input.title);
  put('theme', input.theme?.words ?? input.theme);
  put('era', input.era);
  put('genre', input.genre, input.families, input.family);
  put('type', input.type);
  put('style', input.style, input.mood);
  put('keywords', input.keywords);
  put('refs', input.refs, input.named_refs);
  put('pitch', input.pitch);
  put('art', input.art, input.art_style);
  return w;
}

/** Every vibe with its score for these words, best first (ties keep table order). */
export function rankVibes(input) {
  const w = lookWords(input);
  const out = VIBES.map((v, i) => {
    // Each word counts once, at the weight of the strongest field it shows up in, plus one for every
    // other field that repeats it: a word the whole plan keeps using matters, but can't outvote two
    // different words on its own.
    let score = 0;
    const hits = [];
    const stems = new Set();
    for (const word of v.words) {
      // 'plant' and 'plants' are one word (the match already takes plurals).
      const stem = word.toLowerCase().replace(/s$/, '');
      if (stems.has(stem)) continue;
      const fields = Object.entries(w).filter(([, text]) => wordRe(word).test(text)).map(([field]) => FIELD_WEIGHT[field] ?? 1);
      if (!fields.length) continue;
      score += Math.max(...fields) + (fields.length - 1) * 0.5;
      stems.add(stem);
      hits.push(word);
    }
    return { id: v.id, score, hits: [...new Set(hits)], i };
  });
  return out.sort((a, b) => b.score - a.score || a.i - b.i);
}

export function vibeFor(input) {
  const best = rankVibes(input)[0];
  return VIBES.find((v) => v.id === (best.score > 0 ? best.id : DEFAULT_VIBE));
}

// ---------------------------------------------------------------- the spec ----

/** The steps of every game's scale, smallest first, as exponents of its ratio around the body size. */
export const STEPS = ['caption', 'label', 'body', 'title', 'display', 'hero'];
const EXP = { caption: -1.25, label: -0.5, body: 0, title: 1.5, display: 3, hero: 4.5 };
// Bounds per step: the kit's boxes were sized for its own scale (13 15 17 22 32), so a game's
// scale moves around it but never far past it.
const FLOOR = { caption: 12, label: 13, body: 14, title: 18, display: 24, hero: 32 };
const CEIL = { caption: 14, label: 16, body: 17, title: 26, display: 36, hero: 52 };
// The width the kit's text fitting assumes per character (ui-text.mjs: the engine's 0.6 × size,
// with a margin). A font that runs wider is set smaller, one that runs narrower a little larger, so
// measured lines still fit the boxes the kit made.
const REF_ADVANCE = 0.56;

const fontOf = (id) => FONT_DATA[id] ?? null;
function weightsOf(id) {
  const f = fontOf(id);
  const ws = f?.weights ?? [400];
  return { regular: ws[0], strong: ws[ws.length - 1] };
}
/** Size factor so a font's average advance lands near the kit's assumption. */
export function widthFactor(id, weight, caps = false) {
  const f = fontOf(id);
  if (!f) return 1;
  const w = f.weights.includes(weight) ? weight : f.weights[f.weights.length - 1];
  const avg = caps || f.caps ? f.avgCaps[w] : f.avg[w];
  // Narrow display faces may grow a little; reading text never grows past the kit's boxes.
  return Math.max(0.6, Math.min(f.role === 'display' ? 1.1 : 1, REF_ADVANCE / (avg || REF_ADVANCE)));
}

/** The font id and weight each step uses. */
function stepFonts(p) {
  const dw = weightsOf(p.display).strong;
  const tw = weightsOf(p.text);
  const titleDisplay = p.title === 'display';
  return {
    caption: { id: p.text, weight: tw.regular },
    label: { id: p.text, weight: p.weights.label === 'strong' ? tw.strong : tw.regular },
    body: { id: p.text, weight: tw.regular },
    title: titleDisplay ? { id: p.display, weight: dw } : { id: p.text, weight: p.weights.title === 'strong' ? tw.strong : tw.regular },
    display: { id: p.display, weight: dw },
    hero: { id: p.display, weight: dw },
  };
}

// Vibes where a slight tilt on display text fits (sport, cartoon, game show energy).
const TILT_VIBES = new Set(['racing_sport', 'cartoon_action', 'meme_brainrot', 'game_show']);
const NEXT_TREATMENT = { none: 'outline', outline: 'heavy', heavy: 'outline' };

/**
 * The pairing as this game wears it: details vary by the game id so two games of one vibe look
 * related but not identical: title case, label weight, tracking, the display treatment, a tilt for
 * sporty vibes, and the numerals face (from the vibe's own numerals).
 */
function varyPairing(vibe, pairing, seed) {
  const v = rng(seed ^ 0x9e3779b9);
  const draws = Array.from({ length: 8 }, () => v());
  const disp = fontOf(pairing.display);
  const scripty = ['script', 'hand', 'blackletter'].includes(disp?.cls) || disp?.caps;
  const pool = [...new Set([pairing.numerals, ...vibe.pairings.map((p) => p.numerals)].filter(Boolean))];
  const flip = (w) => (w === 'strong' ? 'regular' : 'strong');
  const round2 = (x) => Math.round(x * 100) / 100;
  return {
    ...pairing,
    case: {
      display: pairing.case.display === 'asis' && !scripty && draws[0] < 0.35 ? 'upper' : pairing.case.display,
      label: pairing.case.label === 'asis' && draws[1] < 0.3 ? 'upper' : pairing.case.label,
    },
    tracking: {
      display: round2(pairing.tracking.display + [0, 0, 0.03, 0.06][Math.floor(draws[2] * 4)]),
      label: round2(pairing.tracking.label + [0, 0.04, 0.08][Math.floor(draws[3] * 3)]),
    },
    weights: { ...pairing.weights, label: draws[4] < 0.3 ? flip(pairing.weights.label) : pairing.weights.label },
    treatment: draws[5] < 0.4 ? NEXT_TREATMENT[pairing.treatment] : pairing.treatment,
    numerals: pairing.numerals && pool.length > 1 ? pool[Math.floor(draws[6] * pool.length)] : pairing.numerals,
    tilt: TILT_VIBES.has(vibe.id) && draws[7] < 0.5 ? -(2 + Math.floor(draws[7] * 6)) : 0,
  };
}

function buildSpec(vibe, basePairing, seed) {
  const pairing = varyPairing(vibe, basePairing, seed);
  const r = rng(seed ^ 0x5bd1e995);
  const ratio = Math.round((pairing.ratio[0] + (pairing.ratio[1] - pairing.ratio[0]) * r()) * 1000) / 1000;
  const base = pairing.base[0] + Math.floor(r() * (pairing.base[1] - pairing.base[0] + 1));
  const fonts = stepFonts(pairing);
  const caps = (step) => (['display', 'hero'].includes(step) || (step === 'title' && pairing.title === 'display')) && pairing.case.display === 'upper';
  const sizeFor = (step, id, weight, upper) => {
    const raw = base * ratio ** EXP[step] * widthFactor(id, weight, upper);
    return Math.max(FLOOR[step], Math.min(CEIL[step], Math.round(raw)));
  };
  const sizes = {}, numeralSizes = {}, textSizes = {};
  for (const step of STEPS) {
    sizes[step] = sizeFor(step, fonts[step].id, fonts[step].weight, caps(step));
    if (pairing.numerals) numeralSizes[step] = sizeFor(step, pairing.numerals, weightsOf(pairing.numerals).strong, false);
    // The same step in the text font: long or wrapped headlines stay in the text font.
    textSizes[step] = sizeFor(step, pairing.text, weightsOf(pairing.text).strong, false);
  }
  // Keep the scale strictly increasing after rounding and clamping.
  for (let i = 1; i < STEPS.length; i++) if (sizes[STEPS[i]] <= sizes[STEPS[i - 1]]) sizes[STEPS[i]] = sizes[STEPS[i - 1]] + 1;
  const fam = (id) => fontOf(id)?.family ?? null;
  return {
    kit: LOOK_KIT,
    vibe: vibe.id,
    pairing: pairing.id,
    seed,
    ids: { display: pairing.display, text: pairing.text, numerals: pairing.numerals },
    families: { display: fam(pairing.display), text: fam(pairing.text), numerals: fam(pairing.numerals) },
    steps: Object.fromEntries(STEPS.map((s) => [s, { family: fam(fonts[s].id), id: fonts[s].id, weight: fonts[s].weight, size: sizes[s], upper: caps(s) }])),
    textSizes: Object.fromEntries(['title', 'display', 'hero'].map((st) => [st, Math.min(textSizes[st], CEIL.title)])),
    numerals: pairing.numerals ? { family: fam(pairing.numerals), id: pairing.numerals, weight: weightsOf(pairing.numerals).strong, sizes: numeralSizes } : null,
    ratio, base,
    case: pairing.case,
    tracking: pairing.tracking,
    treatment: pairing.treatment,
    tilt: pairing.tilt,
    fallback: vibe.fallback,
    systemStacks: Object.fromEntries([pairing.display, pairing.text, pairing.numerals].filter(Boolean).map((id) => [fam(id), SYSTEM_STACKS[fontOf(id).cls]])),
  };
}

/**
 * The look for a game: the vibe its words point to, then the game id picks one of the vibe's
 * pairings and a scale inside the pairing's ranges. Same words and id → same look.
 */
export function chooseLook(words, gameId = '', { characterful = false } = {}) {
  const vibe = vibeFor(words);
  const seed = hash32(`${gameId}`);
  // characterful: the vibe's most expressive pairings (vibes.mjs BOLD) when it has any.
  const pool = characterful && vibe.bold?.length ? vibe.bold : vibe.pairings;
  const pairing = pool[seed % pool.length];
  return buildSpec(vibe, pairing, seed);
}

/** A vibe's pairings: the classic ones, then its characterful ones (vibes.mjs BOLD). */
export function allPairings(vibe) { return [...vibe.pairings, ...(vibe.bold ?? [])]; }

/** The id of the characterful pairing a seed picks in a vibe (vibes.mjs BOLD), or undefined. */
export function characterfulPairing(vibeId, seed = 0) {
  const bold = VIBES.find((v) => v.id === vibeId)?.bold ?? [];
  return bold.length ? bold[(seed >>> 0) % bold.length].id : undefined;
}

/** The compact block a manifest carries in `art.type`: {kit, vibe, pairing, seed}. */
export function lookChoice(spec) {
  return { kit: LOOK_KIT, vibe: spec.vibe, pairing: spec.pairing, seed: spec.seed };
}

/** Rebuilds the spec from `art.type`. Throws on an unknown vibe or pairing. */
export function lookFromChoice(choice) {
  const vibe = VIBES.find((v) => v.id === choice?.vibe);
  if (!vibe) throw new Error(`unknown vibe '${choice?.vibe}'`);
  const pairing = allPairings(vibe).find((p) => p.id === choice.pairing) ?? (choice.pairing === undefined ? vibe.pairings[(choice.seed >>> 0) % vibe.pairings.length] : null);
  if (!pairing) throw new Error(`vibe ${vibe.id} has no pairing '${choice.pairing}'`);
  return buildSpec(vibe, pairing, (choice.seed ?? 0) >>> 0);
}

/** Problems with an `art.type` block, as messages (empty when it's fine). */
export function lookChoiceErrors(choice) {
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return ['art.type must be an object {vibe, pairing, seed}'];
  const errs = [];
  for (const k of Object.keys(choice)) if (!['kit', 'vibe', 'pairing', 'seed'].includes(k)) errs.push(`art.type has no field '${k}' (kit, vibe, pairing, seed)`);
  if (choice.kit !== undefined && choice.kit !== LOOK_KIT) errs.push(`art.type.kit is '${LOOK_KIT}'`);
  const vibe = VIBES.find((v) => v.id === choice.vibe);
  if (!vibe) errs.push(`art.type.vibe '${choice.vibe}' isn't one of ${VIBES.map((v) => v.id).join(', ')}`);
  else if (choice.pairing !== undefined && !allPairings(vibe).some((p) => p.id === choice.pairing)) errs.push(`art.type.pairing '${choice.pairing}' isn't one of ${allPairings(vibe).map((p) => p.id).join(', ')}`);
  if (choice.seed !== undefined && !(Number.isInteger(choice.seed) && choice.seed >= 0)) errs.push('art.type.seed must be a whole number ≥ 0');
  return errs;
}

/** Every family a spec allows on text. */
export function specFamilies(spec) {
  return [...new Set([spec.families.display, spec.families.text, spec.families.numerals].filter(Boolean))];
}
/** Every size a spec allows (each step for its font, and the numerals' sizes). */
export function specSizes(spec) {
  const s = new Set(Object.values(spec.steps).map((x) => x.size));
  for (const v of Object.values(spec.textSizes ?? {})) s.add(v);
  if (spec.numerals) for (const v of Object.values(spec.numerals.sizes)) s.add(v);
  return s;
}

// ---------------------------------------------------------------- reading a game ----

const isExpr = (v) => typeof v === 'string' && v.startsWith('=');
const CHILD_KEYS = ['children'];
const TEMPLATE_KEYS = ['template', 'cell', 'item'];

/** Every text node in a game's presentation tree, with its pointer and its group offset (null inside repeats or bound positions). */
export function textNodes(game) {
  const out = [];
  const walk = (n, at, ox, oy, inRepeat) => {
    if (!n || typeof n !== 'object') return;
    const bound = ox === null || isExpr(n.x) || isExpr(n.y);
    const nx = bound ? null : ox + (typeof n.x === 'number' ? n.x : 0);
    const ny = bound ? null : oy + (typeof n.y === 'number' ? n.y : 0);
    if (n.node === 'text') out.push({ n, at, ox, oy, inRepeat });
    for (const k of CHILD_KEYS) (n[k] ?? []).forEach((c, i) => walk(c, `${at}/${k}/${i}`, n.node === 'group' || n.node === 'stack' ? nx : null, n.node === 'group' || n.node === 'stack' ? ny : null, inRepeat));
    for (const k of TEMPLATE_KEYS) if (n[k] && typeof n[k] === 'object') walk(n[k], `${at}/${k}`, null, null, true);
  };
  walk(game?.presentation?.root, '/presentation/root', 0, 0, false);
  return out;
}

/** The step a size belongs to (the game's own sizes map onto the scale by these bands). */
export function stepOf(size) {
  if (size >= 40) return 'hero';
  if (size >= 26) return 'display';
  if (size >= 19) return 'title';
  if (size >= 16) return 'body';
  if (size >= 14) return 'label';
  return 'caption';
}

/** A size's step: its own step when it's already on the spec's scale (so the fix is idempotent), else by band. */
export function stepIn(spec, size, family) {
  for (const st of STEPS) if (spec.steps[st].size === size && spec.steps[st].family === family) return st;
  if (spec.numerals && family === spec.numerals.family) for (const st of STEPS) if (spec.numerals.sizes[st] === size) return st;
  if (family === spec.families.text) for (const st of ['title', 'display', 'hero']) if (spec.textSizes?.[st] === size && spec.steps[st].family !== family) return st;
  for (const st of STEPS) if (spec.steps[st].size === size) return st;
  return stepOf(size);
}

/** Numbers a size expression can come out as: `if … then 15 else 13` → [15, 13]. */
function exprSizes(expr) {
  return [...String(expr).matchAll(/\b(?:then|else)\s+(\d+(?:\.\d+)?)\b/g)].map((m) => Number(m[1]));
}
const sizesOf = (n) => (typeof n.size === 'number' ? [n.size] : isExpr(n.size) ? exprSizes(n.size) : [16]);
const maxSize = (n) => Math.max(...sizesOf(n));

/** A score, timer or counter: digits and a few signs, or an expression that only formats a number. */
export function isNumeral(n) {
  const t = n.text;
  if (typeof t === 'number') return true;
  if (typeof t !== 'string') return false;
  if (!isExpr(t)) return /^[\s$€£+\-−×x:.,%0-9/]+$/.test(t) && /\d/.test(t);
  const body = t.slice(1).trim();
  if (/'[^']*[A-Za-z][^']*'/.test(body)) return false; // has words in it
  return /^(str|format_\w+|floor|round|ceil|int|abs|max|min)\s*\(/.test(body) || /^[a-z_][a-z0-9_.]*$/i.test(body);
}
// Literal text without the hair spaces tracking adds (so lengths and checks see the words).
const literalText = (n) => (typeof n.text === 'string' && !isExpr(n.text) ? n.text.replace(/\u200A/g, '') : null);

/** Display fonts are for short lines; long or wrapped text stays in the text font. */
function displayOk(n, step) {
  const lit = literalText(n);
  // An expression's length is unknown: only an unwrapped headline (display or hero) may use it.
  if (lit === null) return n.wrap !== true && (step === 'display' || step === 'hero');
  if (n.wrap === true && lit.length > 18) return false;
  return lit.length <= 26;
}

// ---------------------------------------------------------------- colours ----

const NEUTRAL_TEXT = ['ink', 'ink_muted', 'on_surface', 'on_bg', 'surface', 'bg'];
function tokenHex(tokens, name) { return normHex(tokens?.[name]); }
function resolveColor(tokens, ref) {
  if (typeof ref !== 'string') return null;
  if (ref.startsWith('$')) return tokenHex(tokens, ref.slice(1));
  return normHex(ref);
}
/** Colour references in a colour value: a token, a literal, or every one an expression names. */
function colorRefs(v) {
  if (v === undefined || v === null) return ['$ink'];
  if (!isExpr(v)) return [v];
  return [...v.matchAll(/\$[A-Za-z_][A-Za-z0-9_]*|'#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?'/g)].map((m) => m[0].replace(/'/g, ''));
}
function rgbDist(a, b) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
/** The palette token nearest a literal colour. */
function nearestToken(tokens, hex) {
  let best = null, bd = Infinity;
  for (const [name, v] of Object.entries(tokens ?? {})) {
    const h = normHex(v);
    if (!h || /^(shadow|scrim)$/.test(name) || /^[0-9a-f]{8}$/i.test(String(v).slice(1))) continue;
    // Lightness counts most: the snapped colour keeps the contrast the literal had.
    const d = rgbDist(h, hex) + 400 * Math.abs(luminance(h) - luminance(hex));
    if (d < bd || (d === bd && name < best)) { best = name; bd = d; }
  }
  return best ? `$${best}` : null;
}
/** Bright, fully saturated colours that glow when set big. */
export function isNeon(hex) {
  const [, s, l] = hslOf(hex);
  return s >= 80 && l >= 45 && l <= 72 && luminance(hex) > 0.25;
}
const softName = (ref) => `${ref.slice(1)}_soft`;
function softHex(hex) {
  const [h, s, l] = hslOf(hex);
  // Same hue and lightness, saturation brought down: keeps the contrast it had, loses the glow.
  return hsl(h, Math.min(s, 62), l);
}

// ---------------------------------------------------------------- applying a look ----

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Sets one text node on the look. Returns how many props changed. */
function styleText(n, spec, tokens, addToken) {
  const before = JSON.stringify(n);
  const top = maxSize(n);
  let step = stepIn(spec, top, n.font);
  let st = spec.steps[step];
  // Long text in a display font: down to the text font's title step.
  let textFallback = false;
  if (st.id === spec.ids.display && !displayOk(n, step)) { textFallback = true; step = step === 'hero' || step === 'display' ? 'title' : step; st = { ...spec.steps[step], family: spec.families.text, id: spec.ids.text, size: spec.textSizes[step], weight: weightsOf(spec.ids.text).strong, upper: false }; }
  const numeral = spec.numerals && step !== 'caption' && isNumeral(n);
  const fam = numeral ? spec.numerals.family : st.family;
  const weight = numeral ? spec.numerals.weight : st.weight;
  const sizeAt = (s) => {
    const k = stepIn(spec, s, n.font);
    if (numeral) return spec.numerals.sizes[k];
    if ((textFallback || st.id === spec.ids.text) && spec.steps[k].id === spec.ids.display) return spec.textSizes[k] ?? spec.steps[k].size; // a headline kept in the text font (one family for both: its own step)
    return spec.steps[k].size;
  };
  n.font = fam;
  n.weight = weight;
  if (typeof n.size === 'number') n.size = sizeAt(n.size);
  else if (isExpr(n.size)) n.size = n.size.replace(/\b(then|else)(\s+)(\d+(?:\.\d+)?)\b/g, (_, kw, sp, v) => `${kw}${sp}${sizeAt(Number(v))}`);
  else n.size = sizeAt(16);
  // Case: display steps in a display font follow the pairing; short labels too.
  const fd = fontOf(numeral ? spec.numerals.id : st.id);
  const upper = !numeral && !fd?.caps && ((st.upper && st.id === spec.ids.display) || (spec.case.label === 'upper' && (step === 'label' || step === 'caption') && literalText(n) !== null && literalText(n).length <= 24));
  if (upper) {
    const lit = literalText(n);
    if (lit !== null) n.text = lit.toUpperCase();
    else if (isExpr(n.text) && !/^=\s*upper\(/.test(n.text)) n.text = `= upper(${n.text.slice(1).trim()})`;
  }
  // Tracking: hair spaces between the letters of short display lines and capital labels (the engine
  // draws no letter spacing), so the pairing's tracking shows.
  const lit2 = literalText(n);
  if (lit2 !== null && !String(n.text).includes('\u200A') && !numeral && lit2.length >= 2) {
    const isDisplay = st.id === spec.ids.display && (step === 'display' || step === 'hero' || step === 'title') && lit2.length <= 18 && n.wrap !== true;
    const isLabel = upper && (step === 'label' || step === 'caption') && lit2.length <= 16;
    const em = isDisplay ? spec.tracking.display : isLabel ? spec.tracking.label : 0;
    const tracked = [...lit2].join(em >= 0.1 ? '\u200A\u200A' : '\u200A');
    // Letter-spaced text never wraps: the engine counts each hair space as a character (0.6 em,
    // × 1.05 at 600+) and cuts a word longer than the line, so tracking goes only on text that keeps
    // to one line in its box.
    const sz = typeof n.size === 'number' ? n.size : 16;
    const lineChars = typeof n.w === 'number' ? Math.floor(n.w / (sz * 0.6 * ((n.weight ?? 400) >= 600 ? 1.05 : 1)) + 1e-9) : Infinity;
    if (em >= 0.05 && n.wrap !== true && [...tracked].length <= lineChars) n.text = tracked;
  }
  // Tilt: sporty vibes may set short display lines at a slight angle.
  if (spec.tilt && !numeral && lit2 !== null && st.id === spec.ids.display && (step === 'display' || step === 'hero') && n.wrap !== true && n.rotation === undefined) n.rotation = spec.tilt;

  // Colours: literals snap to the palette; big text in a glowing colour gets the palette's softer tone.
  const snap = (ref) => {
    if (typeof ref !== 'string' || ref.startsWith('$')) return ref;
    const h = normHex(ref);
    return h ? nearestToken(tokens, h) ?? ref : ref;
  };
  if (n.color !== undefined) {
    if (!isExpr(n.color)) n.color = snap(n.color);
    else n.color = n.color.replace(/'#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?'/g, (m) => { const t = snap(m.slice(1, -1)); return t.startsWith('$') ? t : m; });
  }
  const big = maxSize(n) >= 22 || (literalText(n) ?? '').length > 24;
  if (big) {
    const fixRef = (ref) => {
      const h = resolveColor(tokens, ref);
      if (!h || !isNeon(h) || !ref.startsWith('$')) return ref;
      const name = softName(ref);
      addToken(name, softHex(h));
      return `$${name}`;
    };
    if (n.color === undefined) { /* ink: never neon */ } else if (!isExpr(n.color)) n.color = fixRef(n.color);
    else n.color = n.color.replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, (m) => fixRef(m));
  }
  // Treatment: an outline under display text, in whichever ground contrasts most with the fill.
  const lettered = literalText(n) === null || /[A-Za-z0-9]/.test(literalText(n));
  if (!numeral && lettered && spec.treatment !== 'none' && st.id === spec.ids.display && (step === 'display' || step === 'hero' || step === 'title') && n.stroke === undefined) {
    const fill = resolveColor(tokens, colorRefs(n.color)[0]) ?? tokenHex(tokens, 'ink');
    const grounds = ['bg', 'ink', 'surface'].filter((t) => tokenHex(tokens, t));
    if (fill && grounds.length) {
      const g = grounds.reduce((b, t) => (contrast(tokenHex(tokens, t), fill) > contrast(tokenHex(tokens, b), fill) ? t : b), grounds[0]);
      if (contrast(tokenHex(tokens, g), fill) >= 2) {
        n.stroke = `$${g}`;
        n.stroke_width = spec.treatment === 'heavy' ? Math.max(3, Math.round(n.size / 9 || 3)) : 2;
      }
    }
  }
  return before === JSON.stringify(n) ? 0 : 1;
}

/**
 * The game (engine game.json, or a Bubble manifest carrying one) set on its look. Returns
 * {game, changed (text nodes), tokens (added)}. Idempotent: applying twice changes nothing more.
 */
export function applyLook(game, spec, { inPlace = false } = {}) {
  const g = inPlace ? game : clone(game);
  const pres = g.presentation;
  if (!pres?.root) return { game: g, changed: 0, tokens: [] };
  pres.tokens = pres.tokens ?? {};
  const added = [];
  const addToken = (name, hex) => { if (pres.tokens[name] === undefined) { pres.tokens[name] = hex; added.push(name); } };
  let changed = 0;
  for (const t of textNodes(g)) changed += styleText(t.n, spec, pres.tokens, addToken);
  return { game: g, changed, tokens: added };
}

// ---------------------------------------------------------------- the checks ----

export const LOOK_CODES = {
  S_FONT_FAMILIES: { severity: 'block', title: 'more font families than the pairing, or one from outside it', hint: "use the game's pairing: one display font, one text font, an optional numerals font (the look fix sets them)" },
  S_TYPE_SCALE: { severity: 'block', title: "a text size off the game's own modular scale", hint: "use the game's scale steps (caption, label, body, title, display, hero); the look fix snaps them" },
  S_TEXT_COLORS: { severity: 'block', title: "a text colour that isn't one of the game's palette tokens", hint: 'write text colours as palette tokens ($ink, $accent, …); the look fix snaps literals to the nearest token' },
  S_NEON_TEXT: { severity: 'block', title: 'big or long text in a glowing, fully saturated colour', hint: "keep neon for small accents; the look fix uses the palette colour's softer tone" },
  S_WEIGHT_MIX: { severity: 'warn', title: 'more than two weights of one family', hint: 'regular for reading, one strong weight for emphasis' },
  S_ALIGNMENT: { severity: 'warn', title: 'static text on too many different edges and centres', hint: 'line text up on a few shared edges (the gutter, the centre)' },
  S_PALETTE_CLASH: { severity: 'warn', title: "the UI colours don't harmonize with the backdrop", hint: "derive primary and accent from the backdrop's hues (analogous, complementary or triadic)" },
  S_THEME_MISMATCH: { severity: 'warn', title: "the fonts don't fit the game's vibe", hint: "set the game on its vibe's pairing (art.type); the look fix does it" },
};

const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Backdrop colours: the most used colours of the backdrop SVG asset, when it has one. */
function backdropColors(game) {
  const root = game?.presentation?.root;
  const first = root?.children?.[0];
  const id = first?.node === 'image' && first.x === 0 && first.y === 0 ? first.asset : null;
  const asset = (game?.assets ?? []).find?.((a) => a.id === id) ?? (game?.assets && !Array.isArray(game.assets) ? game.assets[id] : null);
  const svg = asset?.svg ?? (typeof asset?.src === 'string' && asset.src.startsWith('<svg') ? asset.src : null);
  const counts = new Map();
  for (const m of String(svg ?? '').matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) { const h = normHex('#' + m[1]); if (h) counts.set(h, (counts.get(h) ?? 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([h]) => h);
}

/**
 * The look checks on an engine game. spec: the game's look (lookFromChoice or chooseLook).
 * opts.words: the game's words, for S_THEME_MISMATCH (skipped without them). Returns findings
 * {code, severity, node, message, hint}.
 */
export function lookCheck(game, spec, { words = null, explicit = false } = {}) {
  const out = [];
  const add = (code, node, message) => out.push({ code, severity: LOOK_CODES[code].severity, node, message, hint: LOOK_CODES[code].hint });
  const tokens = game?.presentation?.tokens ?? {};
  const texts = textNodes(game);
  if (!texts.length) return out;
  const fams = specFamilies(spec);
  const maxFams = spec.numerals ? 3 : 2;

  // Families.
  const used = new Map();
  for (const t of texts) { const f = t.n.font ?? 'system'; if (!used.has(f)) used.set(f, t.at); }
  const foreign = [...used.keys()].filter((f) => !fams.includes(f));
  if (foreign.length || used.size > maxFams) {
    add('S_FONT_FAMILIES', used.get(foreign[0] ?? [...used.keys()][0]), `${used.size} font ${used.size === 1 ? 'family' : 'families'} (${[...used.keys()].join(', ')}); this game's pairing (${spec.vibe}/${spec.pairing}) is ${fams.join(' + ')}`);
  }

  // Scale.
  const allowed = specSizes(spec);
  const off = texts.filter((t) => sizesOf(t.n).some((s) => !allowed.has(s)));
  if (off.length) {
    const sizes = [...new Set(off.flatMap((t) => sizesOf(t.n)).filter((s) => !allowed.has(s)))].sort((a, b) => a - b);
    add('S_TYPE_SCALE', off[0].at, `${off.length} text node${off.length > 1 ? 's' : ''} at ${sizes.join(', ')}, off this game's scale (${[...allowed].sort((a, b) => a - b).join(', ')}; ratio ${spec.ratio} on ${spec.base})`);
  }

  // Colours.
  const literal = texts.filter((t) => colorRefs(t.n.color).some((r) => typeof r === 'string' && !r.startsWith('$')));
  if (literal.length) add('S_TEXT_COLORS', `${literal[0].at}/color`, `${literal.length} text node${literal.length > 1 ? 's use' : ' uses'} a literal colour (${[...new Set(literal.flatMap((t) => colorRefs(t.n.color).filter((r) => !String(r).startsWith('$'))))].slice(0, 4).join(', ')}) instead of the palette`);
  for (const t of texts) {
    const big = maxSize(t.n) >= 22 || (literalText(t.n) ?? '').length > 24;
    if (!big) continue;
    const glow = colorRefs(t.n.color).filter((r) => { const h = resolveColor(tokens, r); return h && isNeon(h); });
    if (glow.length) add('S_NEON_TEXT', `${t.at}/color`, `${glow.join(', ')} glows at size ${maxSize(t.n)}: "${String(literalText(t.n) ?? t.n.text).slice(0, 30)}"`);
  }

  // Weights per family.
  const weights = new Map();
  for (const t of texts) { const f = t.n.font ?? 'system'; const w = typeof t.n.weight === 'number' ? t.n.weight : t.n.weight === 'bold' ? 700 : 400; weights.set(f, (weights.get(f) ?? new Set()).add(w)); }
  for (const [f, ws] of weights) if (ws.size > 2) add('S_WEIGHT_MIX', '/presentation/root', `${f} at ${ws.size} weights (${[...ws].sort((a, b) => a - b).join(', ')})`);

  // Alignment: shared left edges and centres of static, boxed text outside repeats.
  const statics = texts.filter((t) => t.ox !== null && !t.inRepeat && typeof t.n.x === 'number' && typeof t.n.w === 'number');
  if (statics.length >= 5) {
    const lines = statics.map((t) => ((t.n.align ?? 'center') === 'left' ? { k: 'l', v: t.ox + t.n.x } : (t.n.align === 'right' ? { k: 'r', v: t.ox + t.n.x + t.n.w } : { k: 'c', v: t.ox + t.n.x + t.n.w / 2 })));
    const groups = (k) => { const vs = [...new Set(lines.filter((l) => l.k === k).map((l) => Math.round(l.v)))].sort((a, b) => a - b); const g = []; for (const v of vs) if (!g.length || v - g.at(-1) > 6) g.push(v); return g.length; };
    const n = groups('l') + groups('c') + groups('r');
    if (n > Math.max(4, Math.ceil(statics.length / 2))) add('S_ALIGNMENT', '/presentation/root', `${statics.length} static text boxes sit on ${n} different edges and centres`);
  }

  // Palette harmony with the backdrop.
  const hueOf = (h) => { const [hh, s, l] = hslOf(h); return s >= 30 && l >= 15 && l <= 85 ? hh : null; };
  const back = [tokenHex(tokens, 'bg'), ...backdropColors(game).slice(0, 4)].filter(Boolean).map(hueOf).filter((h) => h !== null);
  if (back.length) {
    const fits = (h) => back.some((b) => { const d = hueDist(b, h); return d <= 40 || Math.abs(d - 180) <= 35 || Math.abs(d - 120) <= 25 || Math.abs(d - 150) <= 20; });
    const clash = ['primary', 'accent'].filter((r) => { const v = tokenHex(tokens, r); const h = v && hueOf(v); return h !== null && h !== undefined && !fits(h); });
    if (clash.length === 2) add('S_PALETTE_CLASH', '/presentation/tokens', `primary and accent don't sit with the backdrop's hues (${back.map(Math.round).join('°, ')}°)`);
  }

  // Theme: the display font against the vibe the words point to.
  if (words && !explicit) {
    const vibe = vibeFor(words);
    const vibeFams = new Set(allPairings(vibe).flatMap((p) => [p.display, p.text, p.numerals]).filter(Boolean).map((id) => fontOf(id)?.family));
    const big = texts.reduce((b, t) => (maxSize(t.n) > maxSize(b.n) ? t : b), texts[0]);
    const f = big.n.font ?? 'system';
    if (!vibeFams.has(f)) add('S_THEME_MISMATCH', `${big.at}/font`, `the headline font ${f} isn't one of the ${vibe.id} vibe's fonts (${[...vibeFams].join(', ')})`);
  }
  return out;
}

/** The fix: the game set on its look, then checked again. */
export function lookFix(game, spec, opts = {}) {
  const r = applyLook(game, spec);
  return { game: r.game, changed: r.changed, tokens: r.tokens, findings: lookCheck(r.game, spec, { ...opts, explicit: true }) };
}

// ---------------------------------------------------------------- a built game's words and id ----

/**
 * The words and id of a built game: the Bubble manifest (brief, title, style) and its authoring
 * manifest (meta, design, art.style, art.type). Returns {words, id, choice}.
 */
export function gameIdentity({ manifest = null, authoring = null, game = null } = {}) {
  const a = authoring ?? {};
  const words = lookWords({
    request: manifest?.brief?.intent ?? a.design?.request,
    title: manifest?.title ?? a.meta?.title ?? game?.meta?.title,
    theme: a.design?.theme,
    pitch: a.design?.pitch,
    art: a.art?.style,
    style: manifest?.brief?.mood,
  });
  const id = manifest?.id ?? a.meta?.id ?? a.meta?.title ?? game?.meta?.title ?? '';
  return { words, id, choice: a.art?.type ?? null };
}

/** The look a built game should have: its own `art.type`, else the one its words and id pick. */
export function lookForBuilt(built) {
  const { words, id, choice } = gameIdentity(built);
  if (choice) { try { return { spec: lookFromChoice(choice), words, explicit: true }; } catch { /* fall through */ } }
  return { spec: chooseLook(words, id), words, explicit: false };
}
