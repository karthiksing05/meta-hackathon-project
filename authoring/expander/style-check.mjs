// The style check: a static "hardware check" of a manifest's own presentation against the
// game-style/1 contract (authoring/UI_KIT.md). It runs on the authoring manifest, before the
// expander and the bot gate, and either reports or auto-corrects each finding.
//
//   styleCheck(manifest, { library, fix }) → { findings, manifest (fixed copy when fix), counts }
//
// Codes (S_ = static, on the manifest; the rendered-frame lint in playtest/layout-check.mjs uses
// L_ codes for what only shows up in frames):
//
//   S_OFF_GRID        a literal position or size that isn't on the 4 pt grid           fix: snap
//   S_FONT_SCALE      a text size that isn't a type step (32 22 17 15 13), or under 13  fix: snap
//   S_COLOR_ROLE      a literal colour that isn't a palette role                        fix: nearest role token
//   S_TEXT_UNBOXED    text with no box (w/h), outside a kit component                   fix: box it and fit it
//   S_TEXT_OVERFLOW   static text that doesn't fit its box at its size                  fix: shrink, wrap, ellipsize
//   S_TEXT_OVERLAP    two static text boxes on the same line overlap                    fix: split the line
//   S_CONTRAST        text below WCAG AA on what it sits on, or a palette below AA      fix: a passing role / adopt
//   S_TOUCH_TARGET    a tap target under 44 × 44                                        fix: grow it (when alone)
//   S_RADIUS          a corner radius that isn't the family's (s, m, l, or a pill)      fix: snap
//   S_STROKE          a stroke width that isn't the family's (thin, base, bold)         fix: snap
//   S_HUD_BAND        a static node in the playfield that enters the HUD band           report
//   S_TOO_MANY_SIZES  more than 5 text sizes in the game                                (fixed by S_FONT_SCALE)
//   S_TOO_MANY_COLORS more than 12 distinct colours in the presentation                 report
//   S_UI_KNOB         an unknown ui knob value                                          fix: the default
//
// Deterministic: the same manifest gives the same findings in the same order, and the fixed
// manifest is byte-identical across runs (and a second fix pass finds nothing left to fix).
// Pure JS, no Node imports.

import { CANVAS as CANVAS0, bands, deriveStyle, TYPE_SIZES, MIN_TEXT, MIN_TOUCH, GRID, normHex, alphaOf, contrast, colorDistance, snapType, STANDARD, readKnobs, FAMILIES, themeFor } from './ui-style.mjs';
import { kitTokens, kitStyle, textTone } from './ui-kit.mjs';
import { fitStatic, fitDynamic, lineBox, lineHeight, WIDTH_SAFETY } from './ui-text.mjs';

export const STYLE_CHECK_VERSION = 1;
// The canvas and its bands come from ui-style.mjs (one constant); set per check from the look.
let CANVAS = { ...CANVAS0 };
let HUD_BAND = { y: 24, h: 48 };
let HUD_BOTTOM_BAND = { y: CANVAS0.h - 40, h: 36 };
function useCanvas(canvas) {
  const b = bands(canvas);
  CANVAS = b.canvas; HUD_BAND = { y: b.hud.y, h: b.hud.h }; HUD_BOTTOM_BAND = { y: b.hudBottom.y, h: b.hudBottom.h };
}
export const MAX_SIZES = 5;
export const MAX_COLORS = 12;
const GUTTER = 12;

export const CODES = {
  S_OFF_GRID: 'warning', S_FONT_SCALE: 'warning', S_COLOR_ROLE: 'warning', S_TEXT_UNBOXED: 'warning',
  S_TEXT_OVERFLOW: 'error', S_TEXT_OVERLAP: 'error', S_CONTRAST: 'error', S_TOUCH_TARGET: 'error',
  S_RADIUS: 'warning', S_STROKE: 'warning', S_HUD_BAND: 'error', S_TOO_MANY_SIZES: 'warning',
  S_TOO_MANY_COLORS: 'warning', S_UI_KNOB: 'warning',
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const isExpr = (v) => typeof v === 'string' && v.startsWith('=');
const esc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');
const onGrid = (v) => Math.abs(v / GRID - Math.round(v / GRID)) < 1e-9;
const snap = (v) => Math.round(v / GRID) * GRID;
const GEOMETRY = ['x', 'y', 'w', 'h'];
const COLOR_PROPS = ['fill', 'stroke', 'color'];
const HEX_IN_EXPR = /'(#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?|#[0-9A-Fa-f]{3})'/g;

/** The full token map a manifest's presentation is drawn with (the look, the art palette, the kit). */
export function tokensFor(manifest, library) {
  const look = library?.looks?.[manifest.look?.id ?? 'paper'];
  const palette = { ...(look?.tokens || {}), ...(manifest.art?.palette || {}), ...(manifest.look?.tokens || {}) };
  const style = kitStyle(manifest, palette);
  return { tokens: kitTokens(manifest, palette, style), style, palette };
}

function resolveColor(v, tokens) {
  if (typeof v !== 'string') return null;
  if (v.startsWith('$')) return normHex(tokens[v.slice(1)]) ? { hex: normHex(tokens[v.slice(1)]), alpha: alphaOf(tokens[v.slice(1)]) } : null;
  const h = normHex(v);
  return h ? { hex: h, alpha: alphaOf(v) } : null;
}
/** Every colour a value can take: a literal, a token, or the tokens and literals in an expression. */
function colorsOf(v, tokens) {
  if (typeof v !== 'string') return [];
  if (!isExpr(v)) { const c = resolveColor(v, tokens); return c ? [c] : []; }
  const out = [];
  for (const m of v.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) { const c = resolveColor('$' + m[1], tokens); if (c) out.push(c); }
  for (const m of v.matchAll(HEX_IN_EXPR)) { const c = resolveColor(m[1], tokens); if (c) out.push(c); }
  return out;
}

/** The nearest palette token for a literal colour (translucent darks become the scrim or shadow). */
/** Tokens a literal colour may snap to: the palette roles and the game's own tokens (never on_* or *_ink). */
const FILL_ROLES = ['bg', 'surface', 'surface_2', 'ink', 'ink_muted', 'primary', 'secondary', 'accent', 'danger', 'success', 'line'];
const KIT_ONLY = /^(on_|scrim$|shadow$)|_ink$/;
function nearestToken(hex, alpha, tokens) {
  if (alpha < 1) return alpha >= 0.6 ? '$scrim' : '$shadow';
  let best = null, bestD = Infinity;
  const names = Object.keys(tokens).filter((n) => FILL_ROLES.includes(n) || !KIT_ONLY.test(n)).sort();
  for (const name of names) {
    const t = normHex(tokens[name]);
    if (!t || alphaOf(tokens[name]) < 1) continue;
    const d = colorDistance(hex, t);
    if (d < bestD || (d === bestD && name < best)) { best = name; bestD = d; }
  }
  return best ? '$' + best : null;
}

/**
 * Runs the check. `library` is loadLibrary()'s result (for the look's tokens). With `fix`, returns
 * a corrected copy of the manifest; the input is never changed.
 */
export function styleCheck(input, { library = null, fix = false, canvas = null } = {}) {
  useCanvas(canvas ?? library?.looks?.[input.look?.id ?? 'paper']?.canvas ?? CANVAS0);
  const manifest = fix ? clone(input) : input;
  const findings = [];
  const add = (code, at, message, fixed = false, extra = {}) => findings.push({ code, severity: CODES[code] ?? 'warning', at, message, fixed: !!(fix && fixed), ...extra });

  // Knobs.
  const notes = [];
  readKnobs(manifest.ui, notes);
  for (const n of notes) {
    add('S_UI_KNOB', n.at, n.message, true);
    if (fix) { const key = n.at.split('/').pop(); delete manifest.ui[key]; }
  }

  let { tokens, style } = tokensFor(manifest, library);

  // Palette contrast: ink on bg and surface; adopt the palette into the kit to repair it.
  const pal = { bg: tokens.bg, surface: tokens.surface, ink: tokens.ink };
  const bad = [];
  if (normHex(pal.ink) && normHex(pal.bg) && contrast(pal.ink, pal.bg) < 4.5) bad.push(`ink on bg is ${contrast(pal.ink, pal.bg).toFixed(2)}:1`);
  if (normHex(pal.ink) && normHex(pal.surface) && contrast(pal.ink, pal.surface) < 4.5) bad.push(`ink on surface is ${contrast(pal.ink, pal.surface).toFixed(2)}:1`);
  if (bad.length) {
    add('S_CONTRAST', manifest.ui ? '/ui' : '/art/palette', `the palette's text fails WCAG AA (${bad.join(', ')}); add a "ui" block so the kit derives a passing palette`, true);
    if (fix && !manifest.ui) {
      manifest.ui = adoptBlock(manifest, library);
      ({ tokens, style } = tokensFor(manifest, library));
    }
  }

  const radii = [...new Set([0, ...Object.values(style.radius)])].sort((a, b) => a - b);
  const strokes = [...new Set(Object.values(style.stroke))].sort((a, b) => a - b);
  const hasHud = (manifest.presentation?.slots ?? []).some((e) => e.slot === 'hud_top') || hudFragments(manifest, library);
  const hasHudBottom = (manifest.presentation?.slots ?? []).some((e) => e.slot === 'hud_bottom') || hudFragments(manifest, library, 'hud_bottom');
  const sizes = new Map();
  const colors = new Set();

  const slots = manifest.presentation?.slots ?? [];
  slots.forEach((entry, i) => {
    if (!entry || typeof entry.node !== 'object') return;
    const at = `/presentation/slots/${i}/node`;
    const inHud = entry.slot === 'hud_top' || entry.slot === 'hud_bottom';
    walk(entry.node, at, { ox: inHud ? null : 0, oy: inHud ? null : 0, slot: entry.slot, inRepeat: false, bg: tokens.bg, parent: null });
  });

  function walk(node, at, ctx) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.ui === 'string') return; // kit components lay themselves out
    if (ctx.slot === 'hud_top' || ctx.slot === 'hud_bottom') return; // the kit's HUD bar places and fits these
    const kind = node.node;
    const staticPos = ctx.ox !== null && !isExpr(node.x) && !isExpr(node.y);
    const x = typeof node.x === 'number' ? node.x : 0, y = typeof node.y === 'number' ? node.y : 0;

    // Grid.
    for (const k of GEOMETRY) {
      const v = node[k];
      if (typeof v === 'number' && !onGrid(v) && !(kind === 'text' && (k === 'x' || k === 'y') && node.anchor === 'center' && Number.isInteger(v) && v % 2 === 0)) {
        add('S_OFF_GRID', `${at}/${k}`, `${k} = ${v} is off the ${GRID} pt grid`, true);
        if (fix) node[k] = snap(v);
      }
    }
    if (kind === 'circle' && typeof node.r === 'number' && !onGrid(node.r * 2)) {
      add('S_OFF_GRID', `${at}/r`, `r = ${node.r} gives a diameter off the ${GRID} pt grid`, true);
      if (fix) node.r = snap(node.r * 2) / 2;
    }

    // Colours.
    for (const k of COLOR_PROPS) {
      const v = node[k];
      if (typeof v !== 'string') continue;
      if (!isExpr(v) && !v.startsWith('$')) {
        const h = normHex(v);
        if (!h) continue;
        const a = alphaOf(v);
        if (a === 0) continue; // transparent hit areas
        const tok = nearestToken(h, a, tokens);
        add('S_COLOR_ROLE', `${at}/${k}`, `${v} is not a palette role${tok ? `; use ${tok}` : ''}`, !!tok);
        if (fix && tok) node[k] = tok;
      } else if (isExpr(v)) {
        let changed = v;
        for (const m of v.matchAll(HEX_IN_EXPR)) {
          const h = normHex(m[1]); const a = alphaOf(m[1]);
          if (!h || a === 0) continue;
          const tok = nearestToken(h, a, tokens);
          add('S_COLOR_ROLE', `${at}/${k}`, `${m[1]} in the expression is not a palette role${tok ? `; use ${tok}` : ''}`, !!tok);
          if (fix && tok) changed = changed.replace(m[0], tok);
        }
        if (fix) node[k] = changed;
      }
      for (const c of colorsOf(node[k], tokens)) colors.add(c.hex);
    }

    // Radii and strokes.
    if (typeof node.radius === 'number' && kind === 'rect') {
      const pill = typeof node.h === 'number' ? node.h / 2 : null;
      if (!radii.includes(node.radius) && node.radius !== pill) {
        const to = radii.reduce((b, r) => (Math.abs(r - node.radius) < Math.abs(b - node.radius) ? r : b), radii[0]);
        add('S_RADIUS', `${at}/radius`, `radius ${node.radius} isn't one of the family's radii (${radii.join(', ')}, or h/2)`, true);
        if (fix) node.radius = to;
      }
    }
    if (typeof node.stroke_width === 'number' && node.stroke && kind !== 'text') {
      if (!strokes.includes(node.stroke_width)) {
        const to = strokes.reduce((b, r) => (Math.abs(r - node.stroke_width) < Math.abs(b - node.stroke_width) ? r : b), strokes[0]);
        add('S_STROKE', `${at}/stroke_width`, `stroke width ${node.stroke_width} isn't one of the family's (${strokes.join(', ')})`, true);
        if (fix) node.stroke_width = to;
      }
    }

    // Touch targets.
    const tap = node.on_tap || node.on_press;
    if (tap && (kind === 'rect' || kind === 'image' || kind === 'circle')) {
      const w = kind === 'circle' ? (typeof node.r === 'number' ? node.r * 2 : null) : node.w;
      const h = kind === 'circle' ? w : node.h;
      if (typeof w === 'number' && typeof h === 'number' && (w < MIN_TOUCH || h < MIN_TOUCH)) {
        const canGrow = !ctx.inRepeat && kind === 'rect' && node.anchor !== 'center';
        add('S_TOUCH_TARGET', at, `tap target is ${w} × ${h}; make it at least ${MIN_TOUCH} × ${MIN_TOUCH}`, canGrow);
        if (fix && canGrow) {
          if (w < MIN_TOUCH && typeof node.x === 'number') { node.x = snap(node.x - (MIN_TOUCH - w) / 2); node.w = MIN_TOUCH; }
          if (h < MIN_TOUCH && typeof node.y === 'number') { node.y = snap(node.y - (MIN_TOUCH - h) / 2); node.h = MIN_TOUCH; }
        }
      }
    }

    // HUD band: static pieces of the playfield that sit in it.
    if (hasHud && ctx.slot === 'playfield' && staticPos && (kind === 'rect' || kind === 'text' || kind === 'image') && !ctx.inRepeat) {
      const box = boxOf(node, ctx);
      if (box && box.w < CANVAS.w * 0.9 && box.y < HUD_BAND.y + HUD_BAND.h && box.y + box.h > HUD_BAND.y) {
        add('S_HUD_BAND', at, `this ${kind} sits in the HUD band (y ${HUD_BAND.y}–${HUD_BAND.y + HUD_BAND.h}); start the playfield below y ${HUD_BAND.y + HUD_BAND.h + 8}`);
      } else if (hasHudBottom && box && box.w < CANVAS.w * 0.9 && box.y + box.h > HUD_BOTTOM_BAND.y && box.y < HUD_BOTTOM_BAND.y + HUD_BOTTOM_BAND.h) {
        add('S_HUD_BAND', at, `this ${kind} sits in the bottom HUD strip (y ${HUD_BOTTOM_BAND.y}–${HUD_BOTTOM_BAND.y + HUD_BOTTOM_BAND.h}); keep the playfield above y ${HUD_BOTTOM_BAND.y - 8}`);
      }
    }

    // Text.
    if (kind === 'text') checkText(node, at, ctx);

    // Children.
    const moved = ctx.ox === null || isExpr(node.x) || isExpr(node.y);
    const childCtx = { ...ctx, ox: moved ? null : ctx.ox + x, oy: moved ? null : ctx.oy + y, parent: node };
    const kids = node.children ?? [];
    // Track what each child sits on: the last full-cover rect drawn before it in this group.
    let under = ctx.bg;
    kids.forEach((c, j) => {
      walk(c, `${at}/children/${j}`, { ...childCtx, bg: under });
      if (c && c.node === 'rect' && typeof c.fill === 'string' && !isExpr(c.fill) && !isExpr(c.opacity) && (c.opacity ?? 1) >= 0.9) {
        const col = resolveColor(c.fill, tokens);
        if (col && col.alpha >= 0.9) under = c.fill;
      }
    });
    if (kind === 'group') checkOverlaps(kids, `${at}/children`, childCtx);
    for (const k of ['template', 'cell', 'item']) if (node[k] && typeof node[k] === 'object') walk(node[k], `${at}/${k}`, { ...childCtx, ox: null, oy: null, inRepeat: true, bg: under });
  }

  function boxOf(node, ctx) {
    if (ctx.ox === null || ctx.oy === null) return null;
    const x = typeof node.x === 'number' ? node.x : 0, y = typeof node.y === 'number' ? node.y : 0;
    let w = typeof node.w === 'number' ? node.w : null, h = typeof node.h === 'number' ? node.h : null;
    if (node.node === 'text') {
      const size = typeof node.size === 'number' ? node.size : 16;
      if (w === null) { if (isExpr(node.text) || typeof node.text !== 'string') return null; w = [...node.text].length * size * 0.6 * ((node.weight ?? 400) >= 600 ? 1.05 : 1); }
      if (h === null) h = lineHeight(size);
    }
    if (w === null || h === null) return null;
    const left = node.anchor === 'center' ? x - w / 2 : x;
    const top = node.anchor === 'center' ? y - h / 2 : y;
    return { x: ctx.ox + left, y: ctx.oy + top, w, h };
  }

  function checkText(node, at, ctx) {
    // Size on the scale.
    if (typeof node.size === 'number') {
      if (!TYPE_SIZES.includes(node.size) || node.size < MIN_TEXT) {
        const to = snapType(node.size);
        add('S_FONT_SCALE', `${at}/size`, `font size ${node.size} isn't on the type scale (${TYPE_SIZES.join(', ')})${node.size < MIN_TEXT ? `; nothing goes under ${MIN_TEXT}` : ''}`, true);
        if (fix) node.size = to;
      }
      sizes.set(fix ? node.size : snapType(node.size), true);
    }
    const size = typeof node.size === 'number' ? node.size : 16;
    const weight = typeof node.weight === 'number' ? node.weight : node.weight === 'bold' ? 700 : 400;

    // Contrast against what the text sits on.
    if (typeof node.color === 'string' || node.color === undefined) {
      const textColors = node.color === undefined ? [resolveColor('$ink', tokens)].filter(Boolean) : colorsOf(node.color, tokens);
      const under = resolveColor(ctx.bg, tokens) ?? resolveColor('$bg', tokens);
      // 4.5:1 for all text: fitted text can shrink to the smallest step, so no large-text allowance.
      const need = 4.5;
      const hasStroke = node.stroke && (node.stroke_width ?? 0) >= 2;
      if (under && !hasStroke) {
        const worst = textColors.reduce((m, c) => Math.min(m, contrast(c.hex, under.hex)), Infinity);
        if (worst < need && typeof node.color === 'string' && /\$(primary|secondary|accent|danger|success)(?![A-Za-z0-9_])/.test(node.color)) {
          // A role colour used for text: its 4.5:1 text variant (<role>_ink) first.
          const toned = textTone(node.color);
          const w2 = colorsOf(toned, tokens).reduce((m, c) => Math.min(m, contrast(c.hex, under.hex)), Infinity);
          if (w2 >= need) {
            add('S_CONTRAST', `${at}/color`, `text is ${worst.toFixed(2)}:1 on ${ctx.bg}; it needs ${need}:1 (use the text variants: ${toned})`, true);
            if (fix) node.color = toned;
            return checkTextBox(node, at, ctx, size, weight);
          }
        }
        if (worst < need) {
          const pick = ['$ink', '$on_bg', '$on_surface', '$on_primary'].map((t) => [t, resolveColor(t, tokens)]).filter(([, c]) => c).sort((a, b) => contrast(b[1].hex, under.hex) - contrast(a[1].hex, under.hex))[0];
          add('S_CONTRAST', `${at}/color`, `text is ${worst.toFixed(2)}:1 on ${ctx.bg}; it needs ${need}:1${pick ? ` (use ${pick[0]})` : ''}`, !!pick && !isExpr(node.color));
          if (fix && pick && !isExpr(node.color)) node.color = pick[0];
        }
      }
    }

    checkTextBox(node, at, ctx, size, weight);
  }

  function checkTextBox(node, at, ctx, size, weight) {
    const hasBox = typeof node.w === 'number';
    if (!hasBox) {
      if (isExpr(node.w)) return;
      add('S_TEXT_UNBOXED', at, 'text has no box, so it can run off the screen or into other pieces; give it w and h (or use a kit component)', true);
      if (fix) boxText(node, ctx, size, weight);
      return;
    }
    if (typeof node.text === 'string' && !isExpr(node.text) && typeof node.h === 'number') {
      const f = fitStatic(node.text, { w: node.w / WIDTH_SAFETY, h: node.h, size: TYPE_SIZES.includes(size) ? size : snapType(size), weight });
      if (f.size !== size || f.cut || (node.wrap !== true && f.lines > 1)) {
        add('S_TEXT_OVERFLOW', at, `"${short(node.text)}" doesn't fit its ${node.w} × ${node.h} box at size ${size}`, true);
        if (fix) { node.size = f.size; node.text = f.text; node.wrap = true; }
      }
    } else if (isExpr(node.text) && typeof node.h === 'number' && typeof node.size === 'number' && !/len\(/.test(node.text)) {
      // Run-time text in a box: fit it at run time.
      add('S_TEXT_OVERFLOW', at, 'run-time text in a fixed box can overflow; it gets a size that steps down with its length and an ellipsis', true);
      if (fix) {
        const f = fitDynamic(node.text.slice(1).trim(), { w: node.w / WIDTH_SAFETY, h: node.h, size, weight });
        node.size = f.size; node.text = f.text; node.wrap = true;
      }
    } else if (node.h === undefined) {
      add('S_TEXT_UNBOXED', `${at}/h`, 'text has a width but no height; give it h so the kit can fit it', true);
      if (fix) {
        node.h = lineBox(size, 2); node.wrap = true;
        if (typeof node.text === 'string' && !isExpr(node.text)) { const f = fitStatic(node.text, { w: node.w / WIDTH_SAFETY, h: node.h, size, weight }); node.size = f.size; node.text = f.text; }
        else if (isExpr(node.text) && !/len\(/.test(node.text)) { const f = fitDynamic(node.text.slice(1).trim(), { w: node.w / WIDTH_SAFETY, h: node.h, size, weight }); node.size = f.size; node.text = f.text; }
      }
    }
  }

  function boxText(node, ctx, size, weight) {
    const center = node.anchor === 'center';
    const ax = typeof node.x === 'number' ? node.x : center ? CANVAS.w / 2 : 0;
    const absX = ctx.ox === null ? null : ctx.ox + ax;
    let w;
    if (absX === null) {
      // Inside a moving group or a repeat: size the box from the shape it labels (a sibling rect or image).
      const sib = (ctx.parent?.children ?? []).find((c) => c && c !== node && (c.node === 'rect' || c.node === 'image') && typeof c.w === 'number' && typeof c.h === 'number');
      if (sib) w = center ? sib.w - 8 : Math.max(48, (typeof sib.x === 'number' ? sib.x : 0) + sib.w - ax - 4);
      else w = 160;
    }
    else if (center) w = Math.max(48, 2 * Math.min(absX - GUTTER, CANVAS.w - GUTTER - absX));
    else w = Math.max(48, CANVAS.w - GUTTER - absX);
    w = Math.floor(w / GRID) * GRID;
    const h = lineBox(size);
    node.w = w; node.h = h; node.wrap = true;
    if (!node.align) node.align = center ? 'center' : 'left';
    if (typeof node.text === 'string' && !isExpr(node.text)) {
      const f = fitStatic(node.text, { w: w / WIDTH_SAFETY, h, size, weight, prefer: 'line' });
      node.size = f.size; node.text = f.text;
    } else if (isExpr(node.text)) {
      const f = fitDynamic(node.text.slice(1).trim(), { w: w / WIDTH_SAFETY, h, size, weight, prefer: 'line' });
      node.size = f.size; node.text = f.text;
    }
  }

  function checkOverlaps(kids, at, ctx) {
    const boxes = [];
    kids.forEach((c, j) => {
      if (!c || c.node !== 'text' || isExpr(c.x) || isExpr(c.y)) return;
      const b = boxOf(c, ctx);
      if (b && typeof c.w === 'number') boxes.push({ c, j, b, vis: JSON.stringify([c.visible ?? null, c.opacity ?? null]) });
    });
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const A = boxes[a], B = boxes[b];
      if (A.vis !== B.vis) continue;
      const ix = Math.min(A.b.x + A.b.w, B.b.x + B.b.w) - Math.max(A.b.x, B.b.x);
      const iy = Math.min(A.b.y + A.b.h, B.b.y + B.b.h) - Math.max(A.b.y, B.b.y);
      if (ix <= 1 || iy <= 1) continue;
      const sameLine = iy >= 0.5 * Math.min(A.b.h, B.b.h);
      const [L, R] = A.b.x <= B.b.x ? [A, B] : [B, A];
      const canSplit = sameLine && L.c.anchor !== 'center' && R.b.x - L.b.x >= 48;
      add('S_TEXT_OVERLAP', `${at}/${L.j}`, `this text overlaps the text at ${at}/${R.j}`, canSplit);
      if (fix && canSplit) {
        L.c.w = Math.floor((R.b.x - L.b.x - 8) / GRID) * GRID;
        const sz = typeof L.c.size === 'number' ? L.c.size : 16;
        const wt = typeof L.c.weight === 'number' ? L.c.weight : 400;
        if (typeof L.c.text === 'string' && !isExpr(L.c.text)) { const f = fitStatic(L.c.text, { w: L.c.w / WIDTH_SAFETY, h: L.c.h ?? lineBox(sz), size: sz, weight: wt, prefer: 'line' }); L.c.size = f.size; L.c.text = f.text; }
        else if (isExpr(L.c.text) && !/len\(/.test(L.c.text)) { const f = fitDynamic(L.c.text.slice(1).trim(), { w: L.c.w / WIDTH_SAFETY, h: L.c.h ?? lineBox(sz), size: sz, weight: wt, prefer: 'line' }); L.c.size = f.size; L.c.text = f.text; }
        L.b.w = L.c.w;
      }
    }
  }

  if (sizes.size > MAX_SIZES) add('S_TOO_MANY_SIZES', '/presentation', `${sizes.size} text sizes; use at most ${MAX_SIZES} (the type scale)`);
  if (colors.size > MAX_COLORS) add('S_TOO_MANY_COLORS', '/presentation', `${colors.size} colours; keep to the palette roles (at most ${MAX_COLORS})`);

  const counts = {};
  for (const f of findings) counts[f.code] = (counts[f.code] ?? 0) + 1;
  return { findings, counts, manifest: fix ? manifest : null, fixable: findings.filter((f) => f.fixed).length };
}

function short(s) { s = String(s); return s.length > 32 ? s.slice(0, 31) + '…' : s; }

function hudFragments(manifest, library, slot = 'hud_top') {
  for (const u of manifest.uses ?? []) {
    const f = library?.fragments?.[u.fragment];
    if (f && (f.presentation?.slots ?? []).some((e) => e.slot === slot)) return true;
  }
  return false;
}

/** A `ui` block that adopts the game's palette (hues kept, lightness moved until AA passes). */
export function adoptBlock(manifest, library) {
  const look = library?.looks?.[manifest.look?.id ?? 'paper'];
  const palette = { ...(look?.tokens || {}), ...(manifest.art?.palette || {}), ...(manifest.look?.tokens || {}) };
  const keep = {};
  for (const r of STANDARD) if (normHex(palette[r])) keep[r] = normHex(palette[r]);
  return { kit: 'game-style/1', theme: themeFor(keep), family: familyFor(manifest), density: 'regular', palette: keep };
}

function familyFor(manifest) {
  const id = manifest.look?.id;
  if (id === 'pixel') return 'pixel';
  if (/Baskerville|Georgia|Fraunces/.test(manifest.art?.font ?? '')) return 'storybook';
  if (id === 'neon' || id === 'riso') return 'sharp';
  return 'rounded';
}

/** One line per code, for prompts and logs. */
export function styleLines(result, max = 12) {
  const lines = [];
  for (const f of result.findings.filter((x) => !x.fixed).slice(0, max)) lines.push(`${f.code} ${f.at}: ${f.message}`);
  return lines;
}

/** Check, fix, and check again: the fixed manifest plus what's left. Deterministic. */
export function styleFix(manifest, { library = null, canvas = null } = {}) {
  const first = styleCheck(manifest, { library, fix: true, canvas });
  const after = styleCheck(first.manifest, { library, fix: false, canvas });
  return { manifest: first.manifest, before: first, after };
}

export { FAMILIES };

/**
 * The style check as a verifier module (for authoring/verify/): static, on the manifest, blocking on
 * errors. `run` reports; `fix` returns the corrected manifest and what's left.
 */
export const styleVerifier = {
  id: 'style',
  stage: 'manifest',
  version: STYLE_CHECK_VERSION,
  codes: CODES,
  run: (manifest, { library = null, canvas = null } = {}) => {
    const r = styleCheck(manifest, { library, canvas });
    return { findings: r.findings, blocking: r.findings.filter((f) => f.severity === 'error'), counts: r.counts };
  },
  fix: (manifest, { library = null, canvas = null } = {}) => {
    const r = styleFix(manifest, { library, canvas });
    return { manifest: r.manifest, findings: r.after.findings, blocking: r.after.findings.filter((f) => f.severity === 'error') };
  },
};
