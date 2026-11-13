// V_VECTOR_FIGURE (FC-13 in docs/games/FAILURE_CLASSES.md): a character, mascot, person, animal, food or
// product drawn from engine shapes. The bar (authoring/ARTDIR.md) is image-first: every figure is Muse Image
// art in the game's one style; shapes are for bars, rings, dots, grids and particles only.
//
// Two rules, either one is a finding:
//   1. Clusters (on the drawn frames): shapes that read as a figure, held in at least 2 frames and in at
//      least a fifth of the frames their main shape is drawn in (so falling pieces that cross by chance
//      don't count):
//      - eyes:  a filled circle or ellipse holding two small circles of about one size, side by side
//               at one height (a face), with no text in it;
//      - head:  a filled circle or ellipse sitting on top of a body (rect, circle, ellipse or poly that
//               is not a bar), about as wide as it (0.3 to 1.3 of its width), centred on it, no text in either;
//      - limbs: two matching shapes (ears, arms, legs, fins) touching a filled circle or ellipse on mirrored
//               sides, each well under half its size.
//      Rows and grids of equal shapes, bars (a rect more than 3.5 times as long as it is tall), single
//      rings, particles (untagged circles and rects) and anything that holds text never form a cluster.
//   2. Names (on the tree): a node whose id or name (or a direct shape child's id, or its one literal
//      label) names a character, food or product (owl, chef, burrito, labubu, mascot, player, phone …)
//      and whose subtree draws two or more shapes and no image. UI words in the name (bar, hp, ring,
//      button, panel, grid, particle, shadow …) exempt it.
// V_SVG_FIGURE (warn): an image node whose asset is hand-written SVG (not Muse Image art) and whose asset id
// names a figure (avatar, burrito, owl …). The same bar, but warn only: most games on Prod before the art
// direction drew their sprites as SVG (17 of 64 on 2026-11-13), and compose without picture art still does.
// Not fixable in presentation code: the fix is a Muse Image sprite (authoring/ARTDIR.md, the art step).

import { finding } from '../registry.mjs';
import { analyze } from '../scene.mjs';
import { walkNodes } from '../../playtest/layout-check.mjs';

export const FIGURE_CODE = 'V_VECTOR_FIGURE';
export const SVG_FIGURE_CODE = 'V_SVG_FIGURE';

const SHAPE_OPS = new Set(['rect', 'circle', 'ellipse', 'poly', 'path']);
const SHAPE_NODES = new Set(['rect', 'circle', 'ellipse', 'poly', 'line', 'path']);
const ROUND = new Set(['circle', 'ellipse']);

/** Words that name a figure: characters, people, animals, food, products. */
export const FIGURE_WORDS = new Set(`
owl cat kitten dog puppy duck bird chick chicken penguin fish frog bunny rabbit bear panda fox mouse rat pig cow
horse sheep monkey ape lion tiger shark whale dolphin octopus crab bee bug snake dragon dino dinosaur unicorn
person people man woman boy girl kid child baby human chef cook farmer knight wizard witch pirate ninja robot alien
zombie ghost monster mascot character hero heroine villain avatar player npc enemy boss creature critter pet
face head body skull labubu mario luigi pikachu sonic
burrito taco pizza burger hamburger hotdog sandwich sushi donut doughnut cake cupcake cookie pie fruit apple banana
orange cherry grape lemon strawberry watermelon pineapple avocado carrot veggie vegetable icecream cone candy
lollipop egg bread croissant noodle ramen fries
bottle soda cup mug phone iphone shoe sneaker car truck bike guitar camera laptop
`.trim().split(/\s+/));

/** UI words: a name with one of these is a bar, ring, grid or effect, not a figure. */
export const UI_WORDS = new Set(`
bar bars hp health life lives heart hearts meter gauge progress track fill timer clock score hud label text
button btn panel card plate badge chip pill tab ring rings dot dots grid cell cells tile tiles board row col
particle particles spark sparks confetti burst shadow glow halo outline border frame bg background backdrop
dice die slot target hitbox zone lane marker cursor arrow icon pip pips bubble bubbles
`.trim().split(/\s+/));

/** Splits an id or name into lowercase words (camelCase, snake_case, kebab-case, digits). */
export function words(s) {
  return String(s ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** The figure word an id names, or null (UI words veto it). */
export function figureWord(s) {
  const ws = words(s);
  if (!ws.length || ws.some((w) => UI_WORDS.has(w))) return null;
  return ws.find((w) => FIGURE_WORDS.has(w)) ?? null;
}

const NAME_KEYS = ['id', 'name', 'label', 'role', 'desc', 'comment', '_comment', 'note'];
const nameOf = (n) => NAME_KEYS.map((k) => (typeof n?.[k] === 'string' ? n[k] : '')).filter(Boolean).join(' ');
const isLiteral = (v) => typeof v === 'string' && !v.trim().startsWith('=');

// ---------------------------------------------------------------- rule 2: names on the tree ----

/** [{node, word, shapes, why}] for named figures built from shapes with no image. */
export function namedFigures(game) {
  const out = [];
  const flagged = [];
  walkNodes(game?.presentation?.root, (node, ptr, parents) => {
    if (SHAPE_NODES.has(node.node) || node.node === 'text' || node.node === 'image') return;
    if (flagged.some((p) => ptr.startsWith(p + '/'))) return;
    let shapes = 0, images = 0;
    walkNodes(node, (n) => { if (SHAPE_NODES.has(n.node)) shapes++; else if (n.node === 'image') images++; }, ptr);
    if (shapes < 2 || images > 0) return;
    const kids = [...(node.children ?? []), ...['template', 'item', 'cell', 'node'].map((k) => node[k]).filter((x) => x && typeof x === 'object')];
    let word = figureWord(nameOf(node)), why = 'its name';
    if (!word) {
      const named = kids.filter((c) => SHAPE_NODES.has(c.node)).map((c) => figureWord(nameOf(c))).filter(Boolean);
      if (named.length >= 2) { word = named[0]; why = 'its shapes\' names'; }
    }
    if (!word) {
      const labels = kids.filter((c) => c.node === 'text' && isLiteral(c.text));
      const round = kids.filter((c) => SHAPE_NODES.has(c.node) && c.node !== 'rect').length;
      if (labels.length === 1 && round >= 2) {
        const ws = words(labels[0].text);
        if (ws.length <= 2 && !ws.some((w) => UI_WORDS.has(w))) { word = ws.find((w) => FIGURE_WORDS.has(w)) ?? null; why = 'its label'; }
      }
    }
    if (!word) return;
    flagged.push(ptr);
    out.push({ node: ptr, word, shapes, why });
  });
  return out;
}

// ---------------------------------------------------------------- rule 1: clusters on the frames ----

const fillAlpha = (c) => {
  if (c == null) return 0;
  if (typeof c === 'number') return (c & 255) / 255;
  const h = String(c).replace('#', '');
  if (h.length === 8) return parseInt(h.slice(6), 16) / 255;
  if (h.length === 4) return parseInt(h[3] + h[3], 16) / 255;
  return /^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(h) ? 1 : String(c).startsWith('rgba') ? 0.5 : 1;
};

function shapeBox(op, fallback) {
  if (op.op === 'ellipse') {
    const rx = Math.abs((op.rx ?? op.r ?? 0) * (op.scale ?? 1)), ry = Math.abs((op.ry ?? op.r ?? 0) * (op.scale ?? 1));
    if (Number.isFinite(op.x) && Number.isFinite(op.y) && rx > 0 && ry > 0) return { x0: op.x - rx, y0: op.y - ry, x1: op.x + rx, y1: op.y + ry };
  }
  return fallback;
}

/** The shapes of one analysed frame that can be part of a figure. */
function frameShapes(s) {
  const { items, W, H } = s;
  const texts = items.filter((it) => it.op.op === 'text' && String(it.op.text ?? '').trim());
  const out = [];
  const ord = new Map();
  for (const it of items) {
    const op = it.op;
    if (!SHAPE_OPS.has(op.op) || it.role === 'backdrop') continue;
    // Particles and feedback bursts: rect and circle ops without a node behind them.
    if ((op.op === 'rect' || op.op === 'circle') && !it.n) continue;
    const b = shapeBox(op, it.box);
    if (!b) continue;
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    if (w < 2 || h < 2 || w * h >= 0.4 * W * H) continue;
    const alpha = fillAlpha(op.fill) * (op.opacity ?? 1);
    const filled = alpha >= 0.35;
    const k = it.n ? (ord.get(it.n.id) ?? 0) : 0;
    if (it.n) ord.set(it.n.id, k + 1);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const key = it.n ? `${it.n.ptr}#${k}` : `${op.op}@${Math.round(cx / 6)},${Math.round(cy / 6)}`;
    const holdsText = texts.some((t) => { const tx = (t.box.x0 + t.box.x1) / 2, ty = (t.box.y0 + t.box.y1) / 2; return tx >= b.x0 && tx <= b.x1 && ty >= b.y0 && ty <= b.y1; });
    const bar = op.op === 'rect' && Math.max(w, h) > 3.5 * Math.min(w, h);
    out.push({ op, kind: op.op, b, w, h, cx, cy, a: w * h, filled, key, node: it.n?.ptr ?? null, moving: it.moving, holdsText, bar, round: ROUND.has(op.op) });
  }
  return out;
}

const similar = (p, q, r = 1.5) => Math.max(p, q) <= r * Math.min(p, q);
const insideC = (c, x, y) => x > c.b.x0 && x < c.b.x1 && y > c.b.y0 && y < c.b.y1;

/** Figure clusters in one frame: [{kind, keys: [main, ...], main}]. */
export function clustersIn(shapes) {
  const out = [];
  const heads = shapes.filter((s) => s.round && s.filled && !s.holdsText && s.w >= 12);
  for (const c of heads) {
    // eyes: two small, matching circles side by side inside c.
    const inner = shapes.filter((s) => s !== c && s.round && s.filled && s.a < 0.2 * c.a && s.w >= 2 && insideC(c, s.cx, s.cy));
    let eyes = null;
    for (let i = 0; i < inner.length && !eyes; i++) for (let j = i + 1; j < inner.length && !eyes; j++) {
      const p = inner[i], q = inner[j];
      if (!similar(p.w, q.w, 1.4) || Math.abs(p.cy - q.cy) > 0.15 * c.h) continue;
      const dx = Math.abs(p.cx - q.cx);
      if (dx < 0.8 * (p.w + q.w) / 2 || dx > 0.8 * c.w) continue;
      if (Math.abs((p.cx + q.cx) / 2 - c.cx) > 0.2 * c.w) continue;
      eyes = [p, q];
    }
    // a pattern (a pizza's toppings, a dice face, a dotted ring) has more than two pupils' worth of dots
    const dots = inner.filter((s) => s.w < 0.45 * c.w).length;
    if (eyes && dots <= 4) out.push({ kind: 'eyes', main: c, keys: [c.key, ...eyes.map((e) => e.key).sort()] });
    // head on a body
    for (const body of shapes) {
      if (body === c || body.bar || body.holdsText || !body.filled || body.kind === 'line') continue;
      if (body.moving !== c.moving) continue;
      if (c.w < 0.3 * body.w || c.w > 1.3 * body.w || body.h < 0.6 * c.h) continue;
      if (Math.abs(c.cx - body.cx) > 0.25 * body.w) continue;
      if (c.b.y1 < body.b.y0 - 0.1 * c.h || c.b.y1 > body.b.y0 + 0.6 * c.h || c.cy > body.b.y0 + 0.25 * body.h) continue;
      // a stack of equal circles (a column of dots, beads) is a row, not a body
      if (body.round && similar(body.w, c.w, 1.15)) continue;
      out.push({ kind: 'head', main: c, keys: [c.key, body.key] });
    }
    // limbs or ears: a mirrored pair touching c
    const touching = shapes.filter((s) => s !== c && !s.holdsText && s.filled && s.kind !== 'line' && s.a < 0.45 * c.a && s.a >= 0.01 * c.a
      && s.b.x1 >= c.b.x0 - 2 && s.b.x0 <= c.b.x1 + 2 && s.b.y1 >= c.b.y0 - 2 && s.b.y0 <= c.b.y1 + 2
      && Math.hypot(s.cx - c.cx, s.cy - c.cy) > 0.35 * Math.min(c.w, c.h) && !inner.includes(s));
    let limbs = null;
    for (let i = 0; i < touching.length && !limbs; i++) for (let j = i + 1; j < touching.length && !limbs; j++) {
      const p = touching[i], q = touching[j];
      if (p.kind !== q.kind || !similar(p.a, q.a, 1.6)) continue;
      if (Math.abs((p.cx + q.cx) / 2 - c.cx) > 0.12 * c.w || Math.abs(p.cy - q.cy) > 0.15 * c.h) continue;
      if (Math.abs(p.cx - q.cx) < 0.4 * c.w) continue;
      limbs = [p, q];
    }
    if (limbs) out.push({ kind: 'limbs', main: c, keys: [c.key, ...limbs.map((e) => e.key).sort()] });
  }
  return out;
}

/** [{key, kind, node, frame, frames, box}] for clusters held across frames. */
export function figureClusters(game, sample, { measures = null } = {}) {
  const scenes = analyze(sample, game, measures);
  const seen = new Map();
  const drawn = new Map();
  for (const s of scenes) {
    const shapes = frameShapes(s);
    for (const sh of shapes) drawn.set(sh.key, (drawn.get(sh.key) ?? 0) + 1);
    const here = new Set();
    for (const cl of clustersIn(shapes)) {
      const key = `${cl.kind}:${cl.keys.join('|')}`;
      if (here.has(key)) continue;
      here.add(key);
      const prev = seen.get(key) ?? { kind: cl.kind, main: cl.main.key, node: cl.main.node, frame: s.f.key, frames: 0, box: cl.main.b };
      prev.frames++;
      seen.set(key, prev);
    }
  }
  const out = [];
  const byMain = new Set();
  for (const [key, v] of seen) {
    if (v.frames < 2 || v.frames < 0.2 * (drawn.get(v.main) ?? v.frames)) continue;
    const id = `${v.kind}:${v.main}`;
    if (byMain.has(id)) continue;
    byMain.add(id);
    out.push({ key, ...v });
  }
  return out;
}

/** [{asset, word, node}] image nodes drawing a figure-named SVG asset. */
export function svgFigures(game) {
  const out = new Map();
  const assets = game?.assets ?? {};
  walkNodes(game?.presentation?.root, (node, ptr) => {
    if (node.node !== 'image' || typeof node.asset !== 'string' || out.has(node.asset)) return;
    const a = assets[node.asset];
    if (!a || typeof a.svg !== 'string' || a.image) return;
    const word = figureWord(node.asset) ?? figureWord(nameOf(node));
    if (word) out.set(node.asset, { asset: node.asset, word, node: ptr });
  });
  return [...out.values()];
}

const KIND_TEXT = {
  eyes: 'a face: two matching circles (eyes) inside a circle',
  head: 'a head on a body: a circle sitting on a shape about its width',
  limbs: 'limbs or ears: a mirrored pair of shapes on a circle',
};

export const check = {
  id: 'vector-figures',
  family: 'V',
  needs: ['frames'],
  codes: {
    [FIGURE_CODE]: {
      severity: 'block',
      title: 'a character, mascot, person, animal, food or product drawn from engine shapes instead of Muse Image art',
      hint: 'draw it as one Muse Image sprite in the game\'s style (authoring/ARTDIR.md, the art step) and place it with an image node; keep shapes for bars, rings, dots, grids and particles',
    },
    [SVG_FIGURE_CODE]: {
      severity: 'warn',
      title: 'a character, food or product drawn as a hand-written SVG sprite instead of Muse Image art',
      hint: 'replace the SVG asset with a Muse Image sprite in the game\'s style (authoring/ARTDIR.md, the art step)',
    },
  },
  async run(ctx) {
    const out = [];
    const named = namedFigures(ctx.game);
    for (const f of named) {
      out.push(finding(FIGURE_CODE, { node: f.node, message: `"${f.word}" (from ${f.why}) is drawn from ${f.shapes} shapes and no image`, rule: 'name' }));
    }
    const taken = named.map((f) => f.node);
    // one finding per main shape, naming every cluster it heads (eyes, head, limbs)
    const byNode = new Map();
    for (const c of figureClusters(ctx.game, ctx.sample, { measures: ctx.measures ?? null })) {
      if (c.node && taken.some((p) => c.node === p || c.node.startsWith(p + '/'))) continue;
      const k = c.node ?? c.main;
      const g = byNode.get(k);
      if (g) { if (!g.kinds.includes(c.kind)) g.kinds.push(c.kind); g.frames = Math.max(g.frames, c.frames); } else byNode.set(k, { ...c, kinds: [c.kind] });
    }
    for (const c of byNode.values()) {
      const box = { x: Math.round(c.box.x0), y: Math.round(c.box.y0), w: Math.round(c.box.x1 - c.box.x0), h: Math.round(c.box.y1 - c.box.y0) };
      out.push(finding(FIGURE_CODE, {
        node: c.node, frame: c.frame, frames: c.frames, rule: c.kinds.join('+'), box,
        message: `${c.kinds.map((k) => KIND_TEXT[k]).join('; ')}, at ${box.x},${box.y} ${box.w}×${box.h} (${c.frames} frames)`,
      }));
    }
    for (const f of svgFigures(ctx.game)) out.push(finding(SVG_FIGURE_CODE, { node: f.node, message: `"${f.asset}" (${f.word}) is an SVG sprite, not Muse Image art` }));
    return out;
  },
};
