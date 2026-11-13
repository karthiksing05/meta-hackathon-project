// Style-agnostic art quality. A style is a set of choices; quality is how well a pack carries them
// out. Five criteria, each checked by code where it can be measured and by a model only where it
// can't. lint.mjs already covers the per-asset measurements (palette, stroke, padding, mass,
// contrast, busy zones); this file adds the set-level checks and the two model prompts:
// a rubric critique (one revision round) and a blind pairwise judge (for scoring, not for revising).

import { parseSvg } from './compile.mjs';

export const RUBRIC = [
  {
    id: 'coherence',
    name: 'One set, one rule book',
    test: 'Every asset shares the palette, one stroke weight, one light direction, one shadow kind, one corner treatment and one level of detail.',
    fails: ['a gradient sprite on a flat backdrop', 'a 1 px line next to a 4 px line', 'one sprite lit from the left, another from the right', 'a detailed hero on a blocky backdrop'],
    code: ['palette (lint)', 'stroke-spread', 'fill-mix', 'detail-spread'],
  },
  {
    id: 'legibility',
    name: 'Reads at play size',
    test: 'At its real on-screen size, over the real backdrop, each sprite is recognizable from its silhouette alone and separates from what is behind it.',
    fails: ['thin line art that disappears at 48 px', 'a silhouette that is a blob', 'a sprite the same value as the sky behind it'],
    code: ['mass (lint)', 'contrast (lint)', 'stroke (lint)'],
  },
  {
    id: 'hierarchy',
    name: 'The eye goes to the right place',
    test: 'Interactive objects carry the most saturation and contrast; the backdrop is quieter and less detailed; zones the game uses stay calm.',
    fails: ['a saturated kite over a pastel sky is fine, but a saturated sky behind a pastel kite is not', 'skyline detail behind the hit text', 'decoration that looks like a button'],
    code: ['zone (lint)', 'saturation-order'],
  },
  {
    id: 'intent',
    name: 'Nothing looks like a default',
    test: 'Shapes are drawn on purpose rather than generic primitives, spacing follows a grid, there is one focal point, and no element looks unfinished.',
    fails: ['a character built from plain circles and rectangles', 'stiff, misaligned limbs', 'an empty corner next to a crowded one', 'a backdrop that is a gradient and two hills'],
    code: [],
  },
  {
    id: 'craft',
    name: 'Clean execution',
    test: 'Edges meet, there are no stray overlaps or slivers, sprites sit on their baseline and inside their padding.',
    fails: ['a wheel floating above the rail', 'a 1 px gap between a roof and its wall', 'art clipped at the box edge'],
    code: ['padding (lint)', 'viewBox (lint)'],
  },
];

const hex = (v) => {
  const h = v.length === 4 ? '#' + [...v.slice(1)].map((c) => c + c).join('') : v;
  const n = parseInt(h.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
};
function saturation([r, g, b]) {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}
// Resolve a fill value (hex or palette role name) to RGB, or null.
function color(value, palette) {
  const v = palette?.[value] ?? value;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? hex(v) : null;
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

// Measurements from markup alone, per asset, in on-screen pixels.
function profile(svg, role, palette) {
  try { parseSvg(svg); } catch { return null; }
  const scale = (role.play ?? role.width) / role.width;
  const strokes = [...svg.matchAll(/stroke-width\s*(?:=\s*"|:\s*)([0-9.]+)/g)].map((m) => Number(m[1]) * scale).filter((w) => w > 0);
  const fills = [...svg.matchAll(/\bfill\s*(?:=\s*"|:\s*)([^";]+)/g)].map((m) => m[1].trim());
  const sats = fills.map((f) => color(f, palette)).filter(Boolean).map(saturation);
  const shapes = (svg.match(/<(path|rect|circle|ellipse|polygon|polyline|line)\b/g) ?? []).length;
  const area = (role.play ?? role.width) * ((role.play ?? role.width) * role.height / role.width);
  return {
    stroke: median(strokes),
    gradient: /<(linear|radial)Gradient\b/.test(svg),
    sat: sats.length ? Math.max(...sats) : 0,
    meanSat: sats.length ? sats.reduce((a, b) => a + b, 0) / sats.length : 0,
    density: shapes / (area / 1000), // shapes per 1,000 on-screen px²
  };
}

// Set-level checks: things no single asset can fail on its own.
export function lintSet(pack, roles, palette) {
  const issues = [];
  const p = Object.fromEntries(roles.filter((r) => pack[r.id]).map((r) => [r.id, profile(pack[r.id], r, palette)]).filter(([, v]) => v));
  const sprites = roles.filter((r) => r.kind !== 'backdrop' && p[r.id]);

  const stroked = sprites.filter((r) => p[r.id].stroke > 0);
  if (stroked.length >= 2) {
    const ws = stroked.map((r) => p[r.id].stroke), lo = Math.min(...ws), hi = Math.max(...ws);
    if (hi / lo > 1.6) issues.push({ role: 'set', level: 'warn', criterion: 'coherence', check: 'stroke-spread',
      message: `on-screen stroke weights range ${lo.toFixed(1)}–${hi.toFixed(1)} px across sprites (${stroked.map((r) => `${r.id} ${p[r.id].stroke.toFixed(1)}`).join(', ')}); pick one weight` });
  }
  const withGrad = Object.keys(p).filter((id) => p[id].gradient);
  if (withGrad.length && withGrad.length < Object.keys(p).length)
    issues.push({ role: 'set', level: 'warn', criterion: 'coherence', check: 'fill-mix',
      message: `shaded with gradients: ${withGrad.join(', ')}; flat: ${Object.keys(p).filter((id) => !p[id].gradient).join(', ')}. Shade all or none` });
  if (sprites.length >= 2) {
    const ds = sprites.map((r) => p[r.id].density), lo = Math.min(...ds), hi = Math.max(...ds);
    if (lo > 0 && hi / lo > 4) issues.push({ role: 'set', level: 'warn', criterion: 'coherence', check: 'detail-spread',
      message: `detail per screen area differs ${Math.round(hi / lo)}× between sprites; match the level of detail` });
  }
  const back = p.backdrop;
  if (back) for (const r of sprites) {
    if (back.meanSat > p[r.id].sat + 0.05) issues.push({ role: r.id, level: 'warn', criterion: 'hierarchy', check: 'saturation-order',
      message: `the backdrop's average saturation (${back.meanSat.toFixed(2)}) is above ${r.id}'s strongest color (${p[r.id].sat.toFixed(2)}); the interactive object should be the most saturated thing` });
  }
  return issues;
}

// Group code findings (lint.mjs + lintSet) under the rubric, so the critic sees them by criterion.
const CHECK_TO_CRITERION = Object.fromEntries(RUBRIC.flatMap((c) => c.code.map((k) => [k.replace(/ \(lint\)$/, ''), c.id])));
export function byCriterion(findings) {
  const out = Object.fromEntries(RUBRIC.map((c) => [c.id, []]));
  for (const f of findings) (out[f.criterion ?? CHECK_TO_CRITERION[f.check] ?? 'craft']).push(f);
  return out;
}

function rubricText() {
  return RUBRIC.map((c, i) => `${i + 1}. ${c.name} (${c.id}): ${c.test}\n   Typical failures: ${c.fails.join('; ')}.`).join('\n');
}

// Optional references: [{ label, look, pngBase64, good: true|false, why }]. Good ones from several
// different looks teach craft without one aesthetic; labeled bad ones show what each failure looks like.
function referenceParts(references = []) {
  const parts = [];
  if (!references.length) return parts;
  const looks = [...new Set(references.filter((r) => r.good).map((r) => r.look))];
  parts.push({ type: 'text', text: `Reference frames follow. The good ones are in ${looks.length} different styles (${looks.join(', ')}). Do not copy their style; notice what they share: the five criteria above, carried out fully. The bad ones are labeled with the criterion they fail.` });
  for (const r of references) {
    parts.push({ type: 'text', text: `${r.good ? 'GOOD' : 'BAD'} — ${r.label} (${r.look})${r.why ? ': ' + r.why : ''}` });
    parts.push({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + r.pngBase64 } });
  }
  return parts;
}

// The single revision round. Goes after the illustrator's own turn (see prompts.mjs criticMessages),
// replacing its free-form checklist with the rubric, criterion by criterion.
export function rubricCritique(findings, pngBase64, references) {
  const grouped = byCriterion(findings);
  const text = [
    'This is your art pack rendered into a real gameplay frame at actual phone size, with each sprite at play size and 2×. The game draws the labels, HUD, track and buttons.',
    'Judge craft, not taste. Whatever the style, good art meets these five criteria:',
    rubricText(),
    'Automatic checks, by criterion:\n' + RUBRIC.map((c) => `- ${c.id}: ${grouped[c.id].length ? grouped[c.id].map((f) => `${f.role}: ${f.message}`).join(' | ') : 'nothing found'}`).join('\n'),
    references?.length ? 'Compare your frame with the GOOD references: for each criterion, where do they succeed and yours does not?' : '',
    'For each criterion, name at most two concrete failures you can see in the frame, each with its fix, e.g. "legibility: the gull outline vanishes against the sky → fill the body and use a 3 px ink edge". Say "none" if it passes. Do not praise.',
    'Return JSON {"review": {"coherence": [...], "legibility": [...], "hierarchy": [...], "intent": [...], "craft": [...]}, "notes": [what you are changing], ...only the roles you redraw}. Redraw a role completely in the same format; leave a role out to keep it.',
  ].filter(Boolean).join('\n\n');
  return { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + pngBase64 } }, ...referenceParts(references)] };
}

// Blind pairwise judge for measuring a pipeline change: shuffle which frame is A, and run it with a
// different model (or at least a fresh conversation) from the one that drew the art.
export function pairwiseMessages(pngA, pngB, references) {
  const text = [
    'Two gameplay frames from the same game at actual phone size. The game draws labels, HUD and buttons the same way in both; only the art differs. They may be in different styles. Judge craft, not which style you prefer.',
    rubricText(),
    'For each criterion, pick A, B or tie, with one sentence naming what you see. Then pick an overall winner.',
    'Return JSON {"coherence": {"pick": "A|B|tie", "why": ""}, "legibility": {...}, "hierarchy": {...}, "intent": {...}, "craft": {...}, "overall": "A|B|tie"}.',
  ].join('\n\n');
  return [
    { role: 'system', content: 'You are an art director reviewing mobile game art. You are strict and specific.' },
    { role: 'user', content: [
      { type: 'text', text },
      ...referenceParts(references),
      { type: 'text', text: 'Frame A:' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + pngA } },
      { type: 'text', text: 'Frame B:' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + pngB } },
    ] },
  ];
}
