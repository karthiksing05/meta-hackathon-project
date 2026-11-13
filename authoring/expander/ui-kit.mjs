// The game UI kit (authoring/UI_KIT.md): components with fixed layouts, and the layout pass that
// gives every game the same regions.
//
// A manifest (or a fragment) writes a component as a node with a `ui` key instead of `node`:
//
//   { "ui": "question_card", "text": "= question_text()" }
//   { "ui": "answer_grid", "count": 4, "text": "= get_or(opts, k, '')", "on_tap": {"input": "answer", "with": {"index": "k"}} }
//
// Components take content and roles, never coordinates. The layout pass stacks the top-level ones
// into regions — HUD band, top, playfield, controls, overlay — and each component expands into
// plain engine nodes on the 4 pt grid, with sizes from the type scale, colours from the palette
// roles and text that fits its box (ui-text.mjs). The HUD slot becomes a solid bar of equal chips.
//
// expand.mjs calls `applyUiKit` once, on the slot entries, before they are spliced into the look's
// layout, and `kitTokens` when it builds the tokens. Pure JS, deterministic.

import { CANVAS, bands, deriveStyle, styleTokens, STANDARD, INK_ROLES, GRID, SPACE, TYPE, MIN_TOUCH, MOTION, normHex, contrast } from './ui-style.mjs';
import { fitTextNode, lineBox, lineHeight } from './ui-text.mjs';

export const COMPONENTS = {
  text: { region: 'top', describe: 'A line or paragraph that fits its box. Props: text, step (display|title|body|label|caption), lines (default 2), tone, align.' },
  question_card: { region: 'top', describe: 'A card with an optional eyebrow, the question (fits 3 lines of title), and an optional timer meter. Props: text, eyebrow, lines, timer (0..1 expr), timer_warn (bool expr).' },
  dialog: { region: 'top', describe: 'A story panel: an optional portrait sprite, a speaker name and the line (fits 4 lines of body). Props: text, speaker, portrait (sprite), portrait_frame, lines.' },
  picture: { region: 'playfield', describe: 'A sprite fitted into the playfield, centered, keeping its aspect. Props: sprite, frame, aspect (h ÷ w, default 1), max_h.' },
  frame: { region: 'playfield', describe: 'A framed panel filling the playfield region; draw your own pieces inside it. Props: tone (surface|surface_2|none).' },
  board: { region: 'playfield', describe: 'A cols × rows grid of tappable cells fitted into the playfield. Props: cols, rows, text (expr of cell), fill (expr of cell, a colour or \'\'), on_tap (with cell), sprite, gap.' },
  lanes: { region: 'playfield', describe: 'Lane dividers across the playfield. Props: count.' },
  meter: { region: 'top', describe: 'A bar from 0 to 1. Props: value (expr), label, tone (primary|accent|danger|success), warn (bool expr).' },
  answer_grid: { region: 'controls', describe: 'Answer tiles, 1 or 2 columns, text auto-fitted. Props: count, cols, as (default k), text (expr of k), state (expr of k: \'good\'|\'bad\'|\'\'), on_tap, sprite, visible_item (bool expr of k), dim (bool expr).' },
  choice_list: { region: 'controls', describe: 'Story choice buttons, one column. Same props as answer_grid.' },
  button: { region: 'controls', describe: 'One button. Props: text, variant (primary|secondary|ghost|danger), on_tap, enabled (bool expr), progress (0..1 expr).' },
  keyboard: { region: 'controls', describe: 'On-screen letter keys. Props: letters (expr, a string), cols, on_tap (with letter), key_state (expr of letter: 0 plain, 1 good, 2 bad).' },
  toast: { region: 'overlay', describe: 'A pill message at the top of the playfield. Props: text, tone, visible.' },
  banner: { region: 'overlay', describe: 'A full-width feedback banner at the top of the playfield. Props: text, tone (success|danger|accent|primary), visible.' },
  intro_card: { region: 'overlay', describe: 'A centered card: title, body and a start button. Props: title, body, button, on_tap, visible.' },
  result_card: { region: 'overlay', describe: 'A centered end card: title, a big score, a line. Props: title, score (expr), line, visible (default status != \'playing\').' },
  stat: { region: 'top', describe: 'A HUD counter: a caption label over its value. Put stats in the hud_top slot (up to 3) and the kit lays them out as a bar. Props: label, value (expr), color.' },
  spacer: { region: 'top', describe: 'Empty space. Props: h (grid units of 4).' },
};

// Geometry comes from ui-style.mjs's CANVAS and bands(); these are set per expansion.
let CANVAS_W = CANVAS.w;
let CANVAS_H = CANVAS.h;
let GUTTER = 12;
let HUD = { y: 24, h: 48 };
let BOTTOM = CANVAS.h - 24;
let HUD_BOTTOM_H = 36;
let HUD_BOTTOM_Y = CANVAS.h - 40;
let SAFE_Y0 = 0;
function useCanvas(canvas) {
  const b = bands(canvas);
  CANVAS_W = b.canvas.w; CANVAS_H = b.canvas.h; GUTTER = b.gutter;
  HUD = { y: b.hud.y, h: b.hud.h }; BOTTOM = b.controlsBottom;
  HUD_BOTTOM_H = b.hudBottom.h; HUD_BOTTOM_Y = b.hudBottom.y; SAFE_Y0 = b.safe.y0;
}
const isExpr = (v) => typeof v === 'string' && v.startsWith('=');
const g4 = (v) => Math.round(v / GRID) * GRID;
const g4down = (v) => Math.floor(v / GRID) * GRID;
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Swaps role colours for their 4.5:1 text variants in a colour value (literal or expression). */
export function textTone(color) {
  if (typeof color !== 'string') return color;
  return color.replace(/\$(primary|secondary|accent|danger|success)(?![A-Za-z0-9_])/g, (_, r) => `$${r}_ink`);
}
const TONES = ['primary', 'accent', 'danger', 'success', 'secondary', 'surface'];
/** A tone written as an expression picks the role at run time. */
const toneExpr = (tone, map) => `= ${TONES.map((t) => `if (${tone.slice(1).trim()}) == '${t}' then ${map(t)} else `).join('')}${map('primary')}`;
const toneFill = (tone) => (isExpr(tone) ? toneExpr(tone, (t) => toneFillLit(t)) : toneFillLit(tone));
const toneOn = (tone) => (isExpr(tone) ? toneExpr(tone, (t) => toneOnLit(t)) : toneOnLit(tone));
const toneFillLit = (tone) => ({ primary: '$primary', accent: '$accent', danger: '$danger', success: '$success', secondary: '$secondary', surface: '$surface' }[tone] ?? '$primary');
const toneOnLit = (tone) => ({ primary: '$on_primary', accent: '$on_accent', danger: '$on_danger', success: '$on_success', secondary: '$on_secondary', surface: '$ink' }[tone] ?? '$on_primary');

// ---------- building blocks ----------

function panel(w, h, ctx, { fill = '$surface', stroke = '$line', radius = ctx.style.radius.l, elevation = ctx.style.elevation } = {}) {
  const out = [];
  if (elevation > 0) out.push({ node: 'rect', x: 0, y: 2 * elevation, w, h, radius, fill: '$shadow' });
  out.push({ node: 'rect', x: 0, y: 0, w, h, radius, fill, ...(stroke ? { stroke, stroke_width: ctx.style.stroke.thin } : {}) });
  return out;
}

function passThrough(n) {
  const out = {};
  for (const k of ['id', 'visible', 'opacity', 'animate_on', 'transition']) if (n[k] !== undefined) out[k] = clone(n[k]);
  return out;
}

// ---------- component heights (for the layout pass) ----------

function heightOf(n, w, ctx) {
  const s = ctx.style;
  const pad = s.pad;
  switch (n.ui) {
    case 'text': {
      const step = TYPE[n.step] ? n.step : 'body';
      return lineBox(TYPE[step].size, n.lines ?? 2);
    }
    case 'question_card':
      return g4(pad * 2 + (n.eyebrow ? lineBox(TYPE.caption.size) + SPACE.xs : 0) + lineBox(TYPE.title.size, n.lines ?? 3) + (n.timer !== undefined ? SPACE.m + 8 : 0));
    case 'dialog':
      return g4(pad * 2 + Math.max(n.portrait ? 64 : 0, (n.speaker ? lineBox(TYPE.label.size) + SPACE.xs : 0) + lineBox(TYPE.body.size, n.lines ?? 4)));
    case 'meter': return n.label ? lineBox(TYPE.caption.size) + SPACE.xs + 12 : 12;
    case 'stat': return 40;
    case 'spacer': return g4((n.h ?? 2) * GRID);
    case 'button': return s.control;
    case 'answer_grid':
    case 'choice_list': {
      const count = Number(n.count ?? 3);
      const cols = n.ui === 'choice_list' ? 1 : Math.max(1, Math.min(2, Number(n.cols ?? 1)));
      const rows = Math.ceil(count / cols);
      const tileH = cols === 2 ? s.control + SPACE.m : s.control;
      return rows * tileH + (rows - 1) * s.gap;
    }
    case 'keyboard': {
      const count = keyboardCount(n);
      const cols = Math.max(4, Math.min(10, Number(n.cols ?? 7)));
      const rows = Math.max(1, Math.ceil(count / cols));
      return rows * MIN_TOUCH + (rows - 1) * SPACE.xs;
    }
    default: return 0;
  }
}

function keyboardCount(n) {
  if (typeof n.letters === 'string' && !isExpr(n.letters)) return [...n.letters.replace(/^'|'$/g, '')].length;
  return Number(n.count ?? 26);
}

// ---------- component expansion ----------

function expandComponent(n, box, ctx) {
  const s = ctx.style;
  const pad = s.pad;
  const { w, h } = box;
  const group = (children, extra = {}) => ({ node: 'group', x: box.x, y: box.y, ...passThrough(n), ...extra, children });
  switch (n.ui) {
    case 'spacer': return group([]);
    case 'stat': return statChip(n, box);
    case 'text': {
      const step = TYPE[n.step] ? n.step : 'body';
      const color = n.tone ? textTone(`$${n.tone}`) : n.muted ? '$ink_muted' : '$ink';
      return group([fitTextNode(n.text ?? '', { x: 0, y: 0, w, h }, { step, color, align: n.align ?? 'center', valign: 'middle', font: ctx.font })]);
    }
    case 'question_card': {
      const kids = panel(w, h, ctx);
      let y = pad;
      if (n.eyebrow !== undefined) {
        kids.push(fitTextNode(n.eyebrow, { x: pad, y, w: w - pad * 2, h: lineBox(TYPE.caption.size) }, { step: 'caption', color: '$accent_ink' }));
        y += lineBox(TYPE.caption.size) + SPACE.xs;
      }
      const textH = lineBox(TYPE.title.size, n.lines ?? 3);
      kids.push(fitTextNode(n.text ?? '', { x: pad, y, w: w - pad * 2, h: textH }, { step: 'title', color: '$ink' }));
      y += textH;
      if (n.timer !== undefined) {
        y += SPACE.m;
        const mw = w - pad * 2;
        kids.push({ node: 'rect', x: pad, y, w: mw, h: 8, radius: 4, fill: '$surface_2' });
        kids.push({ node: 'rect', x: pad, y, w: meterWidth(n.timer, mw), h: 8, radius: 4, fill: n.timer_warn ? `= if (${exprOf(n.timer_warn)}) then $danger else $primary` : '$primary' });
      }
      return group(kids);
    }
    case 'dialog': {
      const kids = panel(w, h, ctx);
      let x = pad;
      if (n.portrait) {
        kids.push({ node: 'rect', x: pad, y: pad, w: 64, h: 64, radius: s.radius.m, fill: '$surface_2' });
        kids.push({ node: 'image', asset: n.portrait, x: pad, y: pad, w: 64, h: 64, ...(n.portrait_frame !== undefined ? { frame: n.portrait_frame } : {}) });
        x = pad + 64 + SPACE.m;
      }
      let y = pad;
      const tw = w - x - pad;
      if (n.speaker !== undefined) {
        kids.push(fitTextNode(n.speaker, { x, y, w: tw, h: lineBox(TYPE.label.size) }, { step: 'label', color: '$accent_ink', align: 'left' }));
        y += lineBox(TYPE.label.size) + SPACE.xs;
      }
      kids.push(fitTextNode(n.text ?? '', { x, y, w: tw, h: h - y - pad }, { step: 'body', color: '$ink', align: 'left', valign: 'top' }));
      return group(kids);
    }
    case 'meter': {
      const kids = [];
      let y = 0;
      if (n.label !== undefined) {
        kids.push(fitTextNode(n.label, { x: 0, y: 0, w, h: lineBox(TYPE.caption.size) }, { step: 'caption', color: '$ink_muted', align: 'left' }));
        y = lineBox(TYPE.caption.size) + SPACE.xs;
      }
      const tone = toneFill(n.tone ?? 'primary');
      kids.push({ node: 'rect', x: 0, y, w, h: 12, radius: 6, fill: '$surface_2', stroke: '$line', stroke_width: s.stroke.thin });
      kids.push({ node: 'rect', x: 0, y, w: meterWidth(n.value ?? 0, w), h: 12, radius: 6, fill: n.warn ? `= if (${exprOf(n.warn)}) then $danger else ${tone}` : tone, transition: { w: { ms: MOTION.base.ms, ease: MOTION.base.ease } } });
      return group(kids);
    }
    case 'button': {
      const v = n.variant ?? 'primary';
      let fill = v === 'secondary' ? '$surface' : v === 'ghost' ? '#00000000' : v === 'danger' ? '$danger' : '$primary';
      let color = v === 'secondary' || v === 'ghost' ? '$ink' : v === 'danger' ? '$on_danger' : '$on_primary';
      // `enabled` (bool expr): the variant when true, a quiet surface button when false.
      if (n.enabled !== undefined) { const c = `(${exprOf(n.enabled)})`; fill = `= if ${c} then ${fill} else $surface`; color = `= if ${c} then ${color} else $ink_muted`; }
      const kids = [{ node: 'rect', x: 0, y: 0, w, h, radius: s.radius.m, fill, ...(v !== 'primary' && v !== 'danger' || n.enabled !== undefined ? { stroke: '$line', stroke_width: s.stroke.base } : {}), ...(n.on_tap ? { on_tap: clone(n.on_tap) } : {}), transition: { fill: { ms: MOTION.base.ms, ease: MOTION.base.ease } } }];
      // `progress` (0..1 expr): a fill sweeping across the button, e.g. while a clip plays.
      if (n.progress !== undefined) kids.push({ node: 'rect', x: 0, y: 0, w: meterWidth(n.progress, w), h, radius: s.radius.m, fill: '$accent', opacity: 0.45 });
      kids.push(fitTextNode(n.text ?? '', { x: SPACE.m, y: 0, w: w - SPACE.m * 2, h }, { step: 'label', color, maxLines: 1, prefer: 'line' }));
      return group(kids, { animate_on: n.animate_on ?? (n.on_tap ? { [n.on_tap.input]: { prop: 'scale', keys: [1, 0.96, 1], ms: MOTION.pop.ms } } : undefined) });
    }
    case 'answer_grid':
    case 'choice_list': return answerGrid(n, box, ctx);
    case 'keyboard': return keyboard(n, box, ctx);
    case 'frame': {
      if (n.tone === 'none') return group([]);
      return group(panel(w, h, ctx, { fill: n.tone === 'surface' ? '$surface' : '$surface_2', elevation: 0 }));
    }
    case 'picture': {
      const aspect = Number(n.aspect ?? 1) || 1;
      const maxH = Math.min(h, Number(n.max_h ?? h));
      let pw = w, ph = pw * aspect;
      if (ph > maxH) { ph = maxH; pw = ph / aspect; }
      pw = g4down(pw); ph = g4down(ph);
      return group([{ node: 'image', asset: n.sprite, x: g4((w - pw) / 2), y: g4((h - ph) / 2), w: pw, h: ph, ...(n.frame !== undefined ? { frame: n.frame } : {}) }]);
    }
    case 'board': return board(n, box, ctx);
    case 'lanes': {
      const count = Math.max(2, Number(n.count ?? 3));
      const kids = [];
      for (let i = 1; i < count; i++) kids.push({ node: 'rect', x: g4((w * i) / count) - 1, y: 0, w: 2, h, fill: '$line', opacity: 0.6 });
      return group(kids);
    }
    case 'toast':
    case 'banner': {
      const tone = n.tone ?? (n.ui === 'banner' ? 'primary' : 'surface');
      const bw = n.ui === 'banner' ? w : Math.min(w, 280);
      const bh = n.ui === 'banner' ? 44 : 36;
      const kids = [
        { node: 'rect', x: g4((w - bw) / 2), y: 0, w: bw, h: bh, radius: n.ui === 'banner' ? s.radius.m : bh / 2, fill: toneFill(tone), ...(tone === 'surface' ? { stroke: '$line', stroke_width: s.stroke.thin } : {}) },
        fitTextNode(n.text ?? '', { x: g4((w - bw) / 2) + SPACE.m, y: 0, w: bw - SPACE.m * 2, h: bh }, { step: 'label', color: toneOn(tone), maxLines: n.ui === 'banner' ? 2 : 1 }),
      ];
      return group(kids, { animate_on: n.animate_on });
    }
    case 'intro_card':
    case 'result_card': return card(n, box, ctx);
    default:
      ctx.warn('S_UI_UNKNOWN', ctx.at(n), `no kit component named '${n.ui}' (${Object.keys(COMPONENTS).join(', ')})`);
      return group([]);
  }
}

const exprOf = (v) => (isExpr(v) ? v.slice(1).trim() : String(v));
function meterWidth(value, full) {
  if (typeof value === 'number') return g4down(full * Math.max(0, Math.min(1, value)));
  return `= ${full}.0 * max(0.0, min(1.0, (${exprOf(value)}) * 1.0))`;
}

function answerGrid(n, box, ctx) {
  const s = ctx.style;
  const count = Number(n.count ?? 3);
  const cols = n.ui === 'choice_list' ? 1 : Math.max(1, Math.min(2, Number(n.cols ?? 1)));
  const as = n.as ?? 'k';
  const tileH = cols === 2 ? s.control + SPACE.m : s.control;
  const tileW = g4down((box.w - (cols - 1) * s.gap) / cols);
  const step = tileH + s.gap;
  const xExpr = cols === 1 ? 0 : `= (${as} % ${cols}) * ${tileW + s.gap}`;
  const yExpr = cols === 1 ? `= ${as} * ${step}` : `= (${as} / ${cols}) * ${step}`;
  const state = n.state ? `(${exprOf(n.state)})` : null;
  const fill = state
    ? `= if ${state} == 'good' then $success else if ${state} == 'bad' then $danger else ${n.ui === 'choice_list' ? '$surface' : '$surface'}`
    : '$surface';
  const color = state
    ? `= if ${state} == 'good' then $on_success else if ${state} == 'bad' then $on_danger else $ink`
    : '$ink';
  const kids = [];
  if (n.sprite) kids.push({ node: 'image', asset: n.sprite, x: 0, y: 0, w: tileW, h: tileH });
  kids.push({
    node: 'rect', x: 0, y: 0, w: tileW, h: tileH, radius: s.radius.m,
    fill: n.sprite ? (state ? `= if ${state} == 'good' then $success else if ${state} == 'bad' then $danger else '#00000000'` : '#00000000') : fill,
    ...(n.sprite ? { opacity: 0.85 } : { stroke: '$line', stroke_width: s.stroke.thin }),
    transition: { fill: { ms: MOTION.fast.ms, ease: MOTION.fast.ease } },
    ...(n.on_tap ? { on_tap: clone(n.on_tap) } : {}),
  });
  kids.push(fitTextNode(n.text ?? '', { x: SPACE.m, y: 0, w: tileW - SPACE.m * 2, h: tileH }, { step: cols === 2 ? 'label' : 'body', weight: 600, color, maxLines: 2, prefer: 'line' }));
  const template = { node: 'group', x: xExpr, y: yExpr, children: kids };
  if (n.visible_item !== undefined) template.visible = n.visible_item;
  if (n.dim !== undefined) { template.opacity = `= if (${exprOf(n.dim)}) then 0.4 else 1.0`; template.transition = { opacity: { ms: MOTION.slow.ms, ease: MOTION.slow.ease } }; }
  template.animate_on = n.animate_on ?? (n.on_tap ? { [n.on_tap.input]: { when: `event.${Object.keys(n.on_tap.with ?? {})[0] ?? 'index'} == ${as}`, prop: 'scale', keys: [1, 0.94, 1.03, 1], ms: MOTION.pop.ms } } : undefined);
  if (template.animate_on === undefined) delete template.animate_on;
  const outer = { ...passThrough(n) };
  delete outer.animate_on;
  return { node: 'group', x: box.x, y: box.y, ...outer, children: [{ node: 'repeat', source: `range(${count})`, as, key: as, template }] };
}

function keyboard(n, box, ctx) {
  const s = ctx.style;
  const count = keyboardCount(n);
  const cols = Math.max(4, Math.min(10, Number(n.cols ?? 7)));
  const gap = SPACE.xs;
  const kw = Math.floor((box.w - (cols - 1) * gap) / cols);
  const kh = MIN_TOUCH;
  const rowW = cols * kw + (cols - 1) * gap;
  const x0 = Math.floor((box.w - rowW) / 2);
  const letters = isExpr(n.letters) ? exprOf(n.letters) : `'${String(n.letters ?? 'abcdefghijklmnopqrstuvwxyz').replace(/^'|'$/g, '')}'`;
  const letter = `get_or(chars(${letters}), i, '')`;
  const state = n.key_state ? `(${exprOf(n.key_state).replace(/\bletter\b/g, letter)})` : null;
  const fill = state ? `= if ${state} == 1 then $success else if ${state} == 2 then $danger else $surface` : '$surface';
  const color = state ? `= if ${state} == 1 then $on_success else if ${state} == 2 then $on_danger else $ink` : '$ink';
  const onTap = n.on_tap ? { input: n.on_tap.input, with: Object.fromEntries(Object.entries(n.on_tap.with ?? { letter: 'letter' }).map(([k, v]) => [k, String(v).replace(/\bletter\b/g, letter)])) } : null;
  const template = {
    node: 'group', x: `= ${x0} + (i % ${cols}) * ${kw + gap}`, y: `= (i / ${cols}) * ${kh + gap}`,
    children: [
      { node: 'rect', x: 0, y: 0, w: kw, h: kh, radius: s.radius.s, fill, stroke: '$line', stroke_width: s.stroke.thin, transition: { fill: { ms: MOTION.fast.ms, ease: MOTION.fast.ease } }, ...(onTap ? { on_tap: onTap } : {}) },
      { node: 'text', x: 0, y: 0, w: kw, h: kh, align: 'center', valign: 'middle', size: kw >= 28 ? TYPE.body.size : TYPE.label.size, weight: 700, color, text: `= if ${letter} == ' ' then '␣' else upper(${letter})` },
    ],
    ...(onTap ? { animate_on: { [onTap.input]: { when: `event.${Object.keys(onTap.with)[0] ?? 'letter'} == ${letter}`, prop: 'scale', keys: [1, 0.9, 1.04, 1], ms: MOTION.pop.ms } } } : {}),
  };
  const countExpr = isExpr(n.letters) ? `len(chars(${letters}))` : String(count);
  return { node: 'group', x: box.x, y: box.y, ...passThrough(n), children: [{ node: 'repeat', source: `range(${countExpr})`, as: 'i', key: 'i', template }] };
}

function board(n, box, ctx) {
  const s = ctx.style;
  const cols = Math.max(1, Number(n.cols ?? 4));
  const rows = Math.max(1, Number(n.rows ?? 4));
  const gap = n.gap !== undefined ? g4(Number(n.gap)) : s.gap;
  const fitCell = Math.floor(Math.min((box.w - (cols - 1) * gap) / cols, (box.h - (rows - 1) * gap) / rows));
  if (fitCell < MIN_TOUCH) ctx.warn('S_REGION_FULL', '/presentation/slots', `the board's cells would be ${fitCell} wide; they stay ${MIN_TOUCH} (touch size), so give the playfield more room`);
  const cell = Math.max(MIN_TOUCH, fitCell);
  const bw = cols * cell + (cols - 1) * gap, bh = rows * cell + (rows - 1) * gap;
  const kids = [];
  if (n.sprite) kids.push({ node: 'image', asset: n.sprite, w: cell, h: cell, ...(n.fill ? { visible: `= (${exprOf(n.fill)}) == ''` } : {}) });
  const fill = n.fill ? `= if (${exprOf(n.fill)}) == '' then ${n.sprite ? "'#00000000'" : '$surface'} else ${exprOf(n.fill)}` : n.sprite ? '#00000000' : '$surface';
  kids.push({ node: 'rect', w: cell, h: cell, radius: s.radius.s, fill, ...(n.sprite ? {} : { stroke: '$line', stroke_width: s.stroke.thin }), transition: { fill: { ms: MOTION.fast.ms, ease: MOTION.fast.ease } }, ...(n.on_tap ? { on_tap: clone(n.on_tap) } : {}) });
  if (n.text !== undefined) kids.push(fitTextNode(n.text, { x: 0, y: 0, w: cell, h: cell }, { step: cell >= 56 ? 'title' : 'body', color: '$ink', maxLines: 1, extra: { stroke: '$bg', stroke_width: 4 } }));
  return {
    node: 'group', x: box.x, y: box.y, ...passThrough(n),
    children: [{ node: 'grid', cols, rows, cell_size: cell, gap, x: g4down((box.w - bw) / 2), y: g4down((box.h - bh) / 2), cell: { node: 'group', children: kids, ...(n.on_tap ? { animate_on: { [n.on_tap.input]: { when: 'event.cell == cell', prop: 'scale', keys: [1, 0.9, 1.05, 1], ms: MOTION.pop.ms } } } : {}) } }],
  };
}

function card(n, box, ctx) {
  const s = ctx.style;
  const pad = SPACE.l;
  const w = box.w;
  const kids = [];
  const body = [];
  let y = pad;
  if (n.eyebrow !== undefined) {
    body.push(fitTextNode(n.eyebrow, { x: pad, y, w: w - pad * 2, h: lineBox(TYPE.caption.size) }, { step: 'caption', color: '$accent_ink', maxLines: 1 }));
    y += lineBox(TYPE.caption.size) + SPACE.xs;
  }
  body.push(fitTextNode(n.title ?? '', { x: pad, y, w: w - pad * 2, h: lineBox(TYPE.title.size, 2) }, { step: 'title', color: '$ink' }));
  y += lineBox(TYPE.title.size, 2) + SPACE.s;
  if (n.ui === 'result_card' && n.score !== undefined) {
    body.push(fitTextNode(n.score, { x: pad, y, w: w - pad * 2, h: lineBox(TYPE.display.size) }, { step: 'display', color: '$primary_ink', maxLines: 1 }));
    y += lineBox(TYPE.display.size) + SPACE.s;
  }
  const textProp = n.ui === 'intro_card' ? n.body : n.line;
  if (textProp !== undefined) {
    body.push(fitTextNode(textProp, { x: pad, y, w: w - pad * 2, h: lineBox(TYPE.body.size, 3) }, { step: 'body', color: '$ink_muted' }));
    y += lineBox(TYPE.body.size, 3) + SPACE.s;
  }
  if (n.button !== undefined) {
    y += SPACE.xs;
    const bx = { x: pad, y, w: w - pad * 2, h: s.control };
    body.push(expandComponent({ ui: 'button', text: n.button, on_tap: n.on_tap, variant: 'primary' }, bx, ctx));
    y += s.control;
  }
  const h = g4(y + pad);
  kids.push(...panel(w, h, ctx, { elevation: 2 }), ...body);
  const top = g4((CANVAS_H - h) / 2) - 24;
  const vis = n.visible ?? (n.ui === 'result_card' ? "= status != 'playing'" : undefined);
  return {
    node: 'group', x: 0, y: 0, ...passThrough(n), ...(vis !== undefined ? { visible: vis } : {}),
    children: [{ node: 'rect', x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, fill: '$scrim' }, { node: 'group', x: box.x, y: top, children: kids }],
  };
}

// ---------- the HUD bar ----------

function rangeCount(node) {
  const find = (n) => {
    if (!n || typeof n !== 'object') return null;
    if (n.node === 'repeat' && typeof n.source === 'string') { const m = /^range\((\d+)\)$/.exec(n.source.trim()); if (m) return { count: Number(m[1]), item: n.template }; }
    for (const c of n.children ?? []) { const r = find(c); if (r) return r; }
    return null;
  };
  return find(node);
}

/** Turns one HUD entry into a chip in a column of the bar: text fitted to one line. */
function hudChip(node, col, band, ctx) {
  if (node.ui === 'stat') return statChip(node, { x: col.x, y: band.y, w: col.w, h: band.h }, band.step === 'caption');
  if (node.ui) return expandComponent(node, { x: col.x, y: band.y + SPACE.s, w: col.w, h: band.h - SPACE.s * 2 }, ctx);
  if (node.node === 'text') {
    const t = fitTextNode(node.text ?? '', { x: col.x + SPACE.xs, y: band.y + SPACE.xs, w: col.w - SPACE.s, h: band.h - SPACE.s }, {
      step: band.step, min: TYPE.caption.size, weight: 700, color: textTone(node.color ?? '$ink'), maxLines: 1,
    });
    for (const k of ['opacity', 'visible', 'transition', 'animate_on', 'id', 'stroke', 'stroke_width']) if (node[k] !== undefined) t[k] = node[k];
    // Scale pulses stay small so the chip never leaves the bar (Bayan's HUD finding).
    if (t.animate_on) for (const a of Object.values(t.animate_on)) if (a.prop === 'scale' && Array.isArray(a.keys)) a.keys = a.keys.map((v) => Math.min(v, 1.12));
    return t;
  }
  // A group with fixed geometry (a hint button): centred, scaled down only if it can't fit.
  const bb = staticBox(node);
  if (bb && !rangeCount(node)) {
    const scale = Math.min(1, (col.w - SPACE.xs) / bb.w, band.h / bb.h);
    return { ...node, x: Math.round(col.x + (col.w - bb.w * scale) / 2 - bb.x * scale), y: Math.round(band.y + (band.h - bb.h * scale) / 2 - bb.y * scale), ...(scale < 1 ? { scale: Math.round(scale * 100) / 100 } : {}) };
  }
  // Icons (lives as sprites) and anything else: centred in the column at its own size.
  const r = rangeCount(node);
  const itemW = r && typeof r.item?.w === 'number' ? r.item.w : 22;
  const stepX = r && typeof r.item?.x === 'string' ? Number((/k\s*\*\s*(\d+)/.exec(r.item.x) || [])[1] ?? itemW + 2) : itemW + 2;
  const gw = r ? stepX * (r.count - 1) + itemW : col.w;
  const scale = gw > col.w - SPACE.s ? (col.w - SPACE.s) / gw : 1;
  return { ...node, x: Math.round(col.x + (col.w - gw * scale) / 2), y: band.y + Math.round((band.h - itemW * scale) / 2), ...(scale < 1 ? { scale: Math.round(scale * 100) / 100 } : {}) };
}

/** A stat: a small caption label over its value, both on one line, in a w × h box. */
function statChip(node, box, compact = false) {
  const color = textTone(node.color ?? '$ink');
  const kids = [];
  const pulse = (a) => { if (!a) return a; const out = clone(a); for (const v of Object.values(out)) if (v.prop === 'scale' && Array.isArray(v.keys)) v.keys = v.keys.map((k) => Math.min(k, 1.12)); return out; };
  if (compact || node.label === undefined || node.label === '') {
    const t = fitTextNode(node.label ? (isExpr(node.value) ? `= '${String(node.label).replace(/'/g, '’')} ' + (${exprOf(node.value)})` : `${node.label} ${node.value}`) : node.value ?? '', { x: SPACE.xs, y: Math.round((box.h - lineBox(TYPE.label.size)) / 2), w: box.w - SPACE.s, h: lineBox(TYPE.label.size) }, { step: compact ? 'caption' : 'label', color, maxLines: 1 });
    kids.push(t);
  } else {
    const lh = lineBox(TYPE.caption.size), vh = lineBox(TYPE.label.size);
    const top = Math.round((box.h - lh - vh) / 2);
    kids.push(fitTextNode(String(node.label).toUpperCase(), { x: SPACE.xs, y: top, w: box.w - SPACE.s, h: lh }, { step: 'caption', color: '$ink_muted', maxLines: 1 }));
    kids.push(fitTextNode(node.value ?? '', { x: SPACE.xs, y: top + lh, w: box.w - SPACE.s, h: vh }, { step: 'label', color, maxLines: 1, extra: node.transition ? { transition: clone(node.transition) } : {} }));
  }
  const g = { node: 'group', x: box.x, y: box.y, children: kids };
  for (const k of ['id', 'visible', 'opacity']) if (node[k] !== undefined) g[k] = clone(node[k]);
  if (node.animate_on) g.animate_on = pulse(node.animate_on);
  return g;
}

/** The bounding box of a node's rects and images with literal geometry, or null. */
export function staticBox(node) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const visit = (n, ox, oy) => {
    if (!n || typeof n !== 'object') return;
    const x = typeof n.x === 'number' ? n.x : 0, y = typeof n.y === 'number' ? n.y : 0;
    if ((n.node === 'rect' || n.node === 'image') && typeof n.w === 'number' && typeof n.h === 'number') {
      x0 = Math.min(x0, ox + x); y0 = Math.min(y0, oy + y); x1 = Math.max(x1, ox + x + n.w); y1 = Math.max(y1, oy + y + n.h);
    }
    if (n.node === 'group') for (const c of n.children ?? []) visit(c, ox + x, oy + y);
  };
  for (const c of node.node === 'group' ? node.children ?? [] : [node]) visit(c, 0, 0);
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function hudBar(entries, band, ctx) {
  const n = entries.length;
  const inner = { x: GUTTER, w: CANVAS_W - GUTTER * 2 };
  const colW = Math.floor((inner.w - SPACE.s * 2) / n);
  const kids = [];
  if (band.panel) {
    if (ctx.style.elevation > 0) kids.push({ node: 'rect', x: inner.x, y: band.y + 2, w: inner.w, h: band.h, radius: ctx.style.radius.l, fill: '$shadow' });
    kids.push({ node: 'rect', x: inner.x, y: band.y, w: inner.w, h: band.h, radius: ctx.style.radius.l, fill: '$surface', stroke: '$line', stroke_width: ctx.style.stroke.thin });
    for (let i = 1; i < n; i++) kids.push({ node: 'rect', x: inner.x + SPACE.s + colW * i, y: band.y + SPACE.m, w: 1, h: band.h - SPACE.m * 2, fill: '$line' });
  }
  return { kids, cols: entries.map((_, i) => ({ x: inner.x + SPACE.s + colW * i, w: colW })) };
}

// ---------- the layout pass ----------

/**
 * Lays out the slot entries (expand.mjs's `slotNodes`) in place and returns the look layout to
 * splice them into, the regions and the style.
 *
 *   slotNodes   { hud_top: [entry], hud_bottom: [...], playfield: [...], overlay: [...] }, each
 *               entry { node, origin, pointer }
 *   ctx         { manifest, lookLayout, palette (the look's tokens after art and look.tokens), warn }
 */
export function applyUiKit(slotNodes, { manifest = {}, lookLayout = null, palette = {}, font = null, warn = () => {}, canvas = CANVAS } = {}) {
  useCanvas(canvas);
  const style = kitStyle(manifest, palette);
  const ctx = { style, font, warn, at: (n) => n.__at ?? '' };
  const regions = {};
  const hasHud = slotNodes.hud_top.length > 0;
  const hasHudBottom = slotNodes.hud_bottom.length > 0;
  regions.hud = hasHud ? { x: GUTTER, y: HUD.y, w: CANVAS_W - GUTTER * 2, h: HUD.h } : { x: GUTTER, y: SAFE_Y0, w: CANVAS_W - GUTTER * 2, h: SPACE.l };
  regions.hud_bottom = hasHudBottom ? { x: GUTTER, y: HUD_BOTTOM_Y, w: CANVAS_W - GUTTER * 2, h: HUD_BOTTOM_H } : null;
  const usable = { x: GUTTER + SPACE.xs, w: CANVAS_W - (GUTTER + SPACE.xs) * 2 };

  // Top-level components in the playfield slot, by region, in slot order.
  const kitEntries = slotNodes.playfield.filter((e) => e.node && typeof e.node.ui === 'string')
    .map((e, i) => [e, i]).sort((a, b) => (Number(a[0].node.order ?? 0) - Number(b[0].node.order ?? 0)) || a[1] - b[1]).map(([e]) => e);
  const byRegion = { top: [], playfield: [], controls: [] };
  for (const e of kitEntries) {
    const r = e.node.region ?? COMPONENTS[e.node.ui]?.region ?? 'top';
    (byRegion[r] ?? byRegion.top).push(e);
  }
  let y = regions.hud.y + regions.hud.h + SPACE.m;
  const top0 = y;
  for (const e of byRegion.top) {
    const h = heightOf(e.node, usable.w, ctx);
    e.box = { x: usable.x, y, w: usable.w, h };
    y += h + SPACE.m;
  }
  regions.top = { x: usable.x, y: top0, w: usable.w, h: Math.max(0, y - top0 - SPACE.m) };
  let bottom = (regions.hud_bottom ? regions.hud_bottom.y - SPACE.m : BOTTOM);
  const ctlHeights = byRegion.controls.map((e) => heightOf(e.node, usable.w, ctx));
  const ctlTotal = ctlHeights.reduce((t, h) => t + h, 0) + Math.max(0, ctlHeights.length - 1) * SPACE.m;
  let cy = bottom - ctlTotal;
  regions.controls = { x: usable.x, y: cy, w: usable.w, h: ctlTotal };
  byRegion.controls.forEach((e, i) => { e.box = { x: usable.x, y: cy, w: usable.w, h: ctlHeights[i] }; cy += ctlHeights[i] + SPACE.m; });
  const pfTop = byRegion.top.length ? y : regions.hud.y + regions.hud.h + SPACE.m;
  const pfBottom = byRegion.controls.length ? regions.controls.y - SPACE.m : bottom;
  regions.playfield = { x: GUTTER, y: pfTop, w: CANVAS_W - GUTTER * 2, h: Math.max(0, pfBottom - pfTop) };
  if (regions.playfield.h < 48 && (byRegion.playfield.length || byRegion.controls.length)) {
    warn('S_REGION_FULL', '/presentation/slots', `the kit components need ${-regions.playfield.h + 48} more units of height than the screen has; use fewer lines or fewer components`);
  }
  for (const e of byRegion.playfield) e.box = { ...regions.playfield };

  // Overlay components: toasts and banners at the top of the playfield, cards centred.
  for (const e of slotNodes.overlay.filter((x) => x.node && typeof x.node.ui === 'string')) {
    const kind = e.node.ui;
    if (kind === 'toast' || kind === 'banner') e.box = { x: usable.x, y: regions.playfield.y + SPACE.s, w: usable.w, h: 44 };
    else e.box = { x: GUTTER + SPACE.l, y: 0, w: CANVAS_W - (GUTTER + SPACE.l) * 2, h: 0 };
  }

  // Expand every component, top-level and nested.
  const expandDeep = (node, box) => {
    if (node && typeof node.ui === 'string') return expandComponent(node, box, ctx);
    if (!node || typeof node !== 'object') return node;
    const out = { ...node };
    if (Array.isArray(out.children)) out.children = out.children.map((c) => expandDeep(c, { x: 0, y: 0, w: usable.w, h: 0 }));
    for (const k of ['template', 'cell', 'item']) if (out[k] && typeof out[k] === 'object') out[k] = expandDeep(out[k], { x: 0, y: 0, w: usable.w, h: 0 });
    return out;
  };
  for (const slot of ['playfield', 'overlay']) {
    for (const e of slotNodes[slot]) {
      if (e.node && typeof e.node.ui === 'string') {
        if (!e.box) e.box = { ...regions.playfield };
        e.node = expandComponent(e.node, e.box, ctx);
      } else e.node = expandDeep(e.node, regions.playfield);
    }
  }

  // The HUD: a solid bar of equal chips (top), and a quieter strip at the bottom.
  const layoutKids = [];
  const hudTop = slotNodes.hud_top;
  if (hudTop.length) {
    const band = { y: HUD.y, h: HUD.h, step: 'label', panel: true };
    const bar = hudBar(hudTop, band, ctx);
    layoutKids.push({ node: 'group', x: 0, y: 0, fixed: true, children: bar.kids });
    hudTop.forEach((e, i) => { e.node = hudChip(e.node, bar.cols[i], band, ctx); });
  }
  if (hasHudBottom) {
    const band = { y: regions.hud_bottom.y, h: HUD_BOTTOM_H, step: 'caption', panel: true };
    const bar = hudBar(slotNodes.hud_bottom, band, ctx);
    layoutKids.push({ node: 'group', x: 0, y: 0, fixed: true, children: bar.kids });
    slotNodes.hud_bottom.forEach((e, i) => { e.node = hudChip(e.node, bar.cols[i], band, ctx); });
  }
  const layout = kitLayout(lookLayout, layoutKids);
  return { style, regions, layout, bands: bands(canvas) };
}

/** The look's layout with the HUD stacks replaced by plain groups (the chips place themselves). */
function kitLayout(lookLayout, hudPanels) {
  const base = clone(lookLayout) ?? { node: 'group', children: [{ node: 'group', x: 0, y: 0, children: [{ slot: 'playfield' }] }, { node: 'group', x: 0, y: 0, children: [{ slot: 'overlay' }] }] };
  const kids = [];
  let placedPanels = false;
  for (const c of base.children ?? []) {
    const slots = (c.children ?? []).filter((x) => x.slot).map((x) => x.slot);
    if (slots.includes('hud_top') || slots.includes('hud_bottom')) {
      if (!placedPanels) { kids.push(...hudPanels); placedPanels = true; }
      kids.push({ node: 'group', x: 0, y: 0, fixed: true, children: slots.map((slot) => ({ slot })) });
    } else kids.push(c);
  }
  if (!placedPanels && hudPanels.length) kids.splice(1, 0, ...hudPanels);
  return { ...base, children: kids };
}

// ---------- tokens ----------

/** The kit's style for a manifest: from `ui` when present, else adopted from the palette in effect. */
export function kitStyle(manifest = {}, palette = {}) {
  if (manifest.ui && typeof manifest.ui === 'object') return deriveStyle(manifest.ui, { fallbackPalette: manifest.ui.palette ? null : null });
  return deriveStyle({ palette }, {});
}

/**
 * The tokens for the game. With a `ui` block the kit owns the standard roles too; without one the
 * game's own roles stay as written and the kit only adds its tokens, with on-colours computed
 * against the game's real fills.
 */
export function kitTokens(manifest = {}, tokens = {}, style = kitStyle(manifest, tokens)) {
  const kit = styleTokens(style);
  const owns = !!(manifest.ui && typeof manifest.ui === 'object');
  const out = { ...tokens };
  for (const [k, v] of Object.entries(kit)) {
    if (STANDARD.includes(k) && !owns && tokens[k] !== undefined) continue;
    if (!STANDARD.includes(k) && tokens[k] !== undefined && !owns) continue; // the game's own token wins
    out[k] = v;
  }
  if (!owns) {
    // On-colours and text variants must hold against the fills actually used.
    for (const r of ['primary', 'secondary', 'accent', 'danger', 'surface', 'bg']) {
      const fill = normHex(out[r]);
      if (!fill) continue;
      const light = '#FFFFFF', dark = '#111111';
      out[`on_${r}`] = contrast(light, fill) >= contrast(dark, fill) ? (normHex(kit[`on_${r}`]) && contrast(kit[`on_${r}`], fill) >= 4.5 ? kit[`on_${r}`] : light) : (normHex(kit[`on_${r}`]) && contrast(kit[`on_${r}`], fill) >= 4.5 ? kit[`on_${r}`] : dark);
    }
    for (const r of INK_ROLES) if (normHex(out[r]) && !tokens[`${r}_ink`]) out[`${r}_ink`] = kit[`${r}_ink`];
  }
  return out;
}

export { lineHeight };
