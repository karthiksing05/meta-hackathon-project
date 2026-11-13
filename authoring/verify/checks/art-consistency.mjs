// V_* art consistency: a game with painted (raster) pictures draws EVERY figure or object as one of them.
// Mixed art (a Muse Image Hermione beside a vector Dumbledore, or an emoji owl beside painted owls) reads
// as two games. Shapes stay allowed for UI geometry (bars, rings, dots, grids, panels, buttons) and
// particles. Static, on the game's tree and assets; silent on a game with no raster pictures at all
// (an all-SVG game is consistent by construction).
//
//   V_MIXED_ART      block  a sprite that depicts a thing is SVG while the game's other pictures are painted
//   V_VECTOR_FIGURE  block  a group of shapes that draws a figure (named like a cast member or a figure word)
//   V_EMOJI_ART      block  an emoji or pictograph glyph used as a picture
//   V_FOREIGN_ART    block  a painted picture that isn't from this build's sheet or its base game (opts.own)
//
// Pure: `artConsistency({sprites, tree, own?, cast?})` takes either the authoring manifest's art.sprites
// or the game's assets, and any node tree; the generator's image-first step (backend/generator/src/cast.mjs)
// runs it in its fix loop, and the verifier runs it through `check`.

import { finding } from '../registry.mjs';

export const ART_CODES = {
  V_MIXED_ART: { severity: 'block', title: 'Mixed art: a figure drawn as SVG among painted pictures', hint: 'Draw it with the painted sprite for that figure, or paint it in the same sheet.' },
  V_VECTOR_FIGURE: { severity: 'block', title: 'A figure built from shapes', hint: 'Swap the shape cluster for an image node of the painted sprite.' },
  V_EMOJI_ART: { severity: 'block', title: 'An emoji used as a picture', hint: 'Use a painted sprite instead of a glyph.' },
  V_FOREIGN_ART: { severity: 'block', title: "A painted picture from another generation or style", hint: "Repaint it in this build's sprite sheet." },
};

// Names of UI geometry and effects, which may stay shapes.
const UI_WORDS = ['box', 'button', 'btn', 'panel', 'bar', 'frame', 'ring', 'dot', 'dots', 'grid', 'cell', 'tile', 'slot', 'plate', 'plaque', 'badge', 'banner', 'bg', 'hud', 'meter', 'timer', 'track', 'lane', 'line', 'arrow', 'cursor', 'ui', 'particle', 'particles', 'spark', 'sparkle', 'glow', 'confetti', 'fx', 'shine', 'border', 'divider', 'outline', 'field', 'input', 'bubble', 'card', 'pill', 'chip', 'tab', 'toggle', 'speech', 'marker', 'pip', 'fill', 'gauge', 'progress', 'shadow', 'highlight', 'ripple', 'burst', 'trail', 'board', 'backdrop', 'background', 'hit', 'target_zone', 'zone', 'stamp', 'verdict', 'caret', 'ribbon', 'label', 'text', 'score', 'key', 'keyboard'];
const FIGURE_WORDS = ['char', 'character', 'host', 'hero', 'player', 'avatar', 'person', 'man', 'woman', 'boy', 'girl', 'kid', 'wizard', 'witch', 'king', 'queen', 'knight', 'mascot', 'face', 'head', 'body', 'creature', 'monster', 'animal', 'cat', 'dog', 'owl', 'bird', 'fish', 'dragon', 'ghost', 'robot', 'alien', 'npc', 'enemy', 'boss', 'pet', 'chef', 'portrait'];

const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Is this sprite name UI geometry or an effect (allowed as shapes)? */
export function isUiName(id) {
  const w = words(id);
  if (!w.length) return false;
  if (w.some((x) => FIGURE_WORDS.includes(x))) return false;
  return w.some((x) => UI_WORDS.includes(x));
}

const isRaster = (s) => typeof s?.image === 'string' && /^data:image\/(png|jpe?g|webp|gif)/.test(s.image);
const isSvg = (s) => s && (typeof s.svg === 'string' || Array.isArray(s.svg));
/** An SVG that draws nothing (a figure the generator removed): only unfilled rects. */
export const isBlankSvg = (s) => typeof s?.svg === 'string' && !s.svg.replace(/<svg[^>]*>|<\/svg>|<rect[^>]*fill=['"]none['"][^>]*\/>|\s/g, '');

// Emoji and pictographs (not letters, digits, arrows or plain punctuation).
const EMOJI = /\p{Extended_Pictographic}/u;
const STRIP = /[\s‍️\u{1F3FB}-\u{1F3FF}]/gu;
/** A literal text that is nothing but emoji or pictographs. */
export function isEmojiArt(text) {
  if (typeof text !== 'string' || text.startsWith('=')) return false;
  const t = text.replace(STRIP, '');
  if (!t) return false;
  return [...t].every((ch) => EMOJI.test(ch)) && /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t);
}

const SHAPES = new Set(['circle', 'ellipse', 'rect', 'path', 'polygon', 'line', 'poly', 'arc', 'star']);
/** A group of shapes that draws a figure: four or more shapes, a round one among them, no text or image. */
export function isShapeFigure(node) {
  const kids = Array.isArray(node?.children) ? node.children : null;
  if (!kids || kids.length < 4) return false;
  if (kids.some((k) => k?.node === 'text' || k?.node === 'image' || k?.node === 'repeat')) return false;
  const shapes = kids.filter((k) => SHAPES.has(k?.node));
  return shapes.length >= 4 && shapes.some((k) => k.node === 'circle' || k.node === 'ellipse');
}

/** Every node object in a tree, with its JSON pointer. */
export function walkNodes(tree, fn, ptr = '') {
  if (Array.isArray(tree)) { tree.forEach((v, i) => walkNodes(v, fn, `${ptr}/${i}`)); return; }
  if (!tree || typeof tree !== 'object') return;
  if (typeof tree.node === 'string') fn(tree, ptr);
  for (const [k, v] of Object.entries(tree)) if (v && typeof v === 'object') walkNodes(v, fn, `${ptr}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`);
}

/** The label a node goes by: its id, name, label, role or (literal) asset. */
export const nodeLabel = (n) => [n.id, n.name, n.label, n.role, n.key, n.alt].filter((x) => typeof x === 'string').join(' ');

/**
 * artConsistency({sprites, tree, own = null, cast = []}) -> [{code, id?, node?, message}]
 *   sprites  art.sprites (authoring) or assets (game), backdrop included or not
 *   tree     the nodes to scan (presentation, or the whole manifest)
 *   own      Set of sprite ids painted by this build (or reused from its base); null skips V_FOREIGN_ART
 *   cast     [{id, name}] the build's cast, to name shape figures
 * Empty when the game has no raster sprite (nothing to be consistent with).
 */
export function artConsistency({ sprites = {}, tree = null, own = null, cast = [] } = {}) {
  const entries = Object.entries(sprites ?? {}).filter(([k]) => k !== 'backdrop' && k !== 'music');
  if (!entries.some(([, s]) => isRaster(s))) return [];
  const out = [];
  for (const [id, s] of entries) {
    if (isSvg(s) && !isRaster(s) && !isBlankSvg(s) && !isUiName(id)) out.push({ code: 'V_MIXED_ART', id, message: `sprite "${id}" is drawn as SVG while the game's other pictures are painted` });
    if (own && isRaster(s) && !own.has(id)) out.push({ code: 'V_FOREIGN_ART', id, message: `sprite "${id}" is painted, but not in this build's sheet` });
  }
  const castWords = cast.map((c) => ({ id: c.id, w: new Set([...words(c.id), ...words(c.name)].filter((x) => x.length > 2 && x !== 'char')) }));
  if (tree) {
    walkNodes(tree, (n, ptr) => {
      if (n.node === 'text' && isEmojiArt(n.text)) out.push({ code: 'V_EMOJI_ART', node: ptr, message: `text ${JSON.stringify(n.text)} is an emoji used as a picture` });
      if (n.node === 'group' && isShapeFigure(n)) {
        const lw = words(nodeLabel(n));
        const named = castWords.find((c) => lw.some((x) => c.w.has(x)));
        if (named || lw.some((x) => FIGURE_WORDS.includes(x))) out.push({ code: 'V_VECTOR_FIGURE', node: ptr, id: named?.id ?? null, message: `group "${nodeLabel(n)}" draws a figure from shapes` });
      }
    });
  }
  return out;
}

export const check = {
  id: 'art-consistency',
  family: 'V',
  needs: ['game'],
  codes: ART_CODES,
  async run(ctx) {
    const g = ctx.game ?? {};
    return artConsistency({ sprites: g.assets ?? {}, tree: g.presentation ?? null }).map((f) => finding(f.code, { node: f.node ?? null, frame: null, message: f.message }));
  },
};
