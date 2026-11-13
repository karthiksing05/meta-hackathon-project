// game-style/1: the design tokens every game's UI is built from (authoring/UI_KIT.md).
//
// Muse picks only a theme preset and a few knobs (a base colour from the subject, a style family,
// a density). Everything else — the palette roles and their on-colours, the type scale, spacing,
// radii, strokes, elevation and motion — is derived here, in code, so two games with the same
// knobs look the same and text always passes WCAG AA against the role it sits on.
//
// Pure JS, no Node imports (the Studio bundle packs it). Deterministic: no randomness, no clocks.
// Builds on Bayan's HUD-panel findings (authoring/harness/layout-experiment/hud.mjs: solid panels,
// 4.5:1 text, small HUD type) and his style-kit vocabulary (authoring/harness/style/).

import { LEGACY_CANVAS, isTall, safeArea } from './canvas.mjs';

export const STYLE_KIT = 'game-style/1';

// ---------- the canvas and its fixed bands ----------

/**
 * The game canvas. THE one place to change its size: the kit's regions, the HUD bar, the cards and
 * the style check all derive from it (a look or game.json can still pass its own canvas). Taller
 * canvases (e.g. 360 × 780 for 19.5:9 phones) give the playfield the extra height.
 */
export const CANVAS = { ...LEGACY_CANVAS };

/**
 * The fixed rectangles every game is laid out in, for a canvas. Nothing the kit places can cross a
 * band edge: the HUD band holds only the HUD bar, the controls stack up from `controlsBottom`
 * (above the bottom strip when there is one), and the playfield is what's left between them.
 *   hud         the top HUD bar                     y 24 – 72 on any canvas
 *   top         where top components start          y 84
 *   hudBottom   the bottom strip (daily, hints)     36 tall, 4 above the bottom safe margin
 *   controlsBottom  where controls end with no strip   h − 24
 */
export function bands(canvas = CANVAS) {
  // On a tall canvas (canvas.mjs) everything sits in the safe area: the top and bottom bleed bands
  // run under the phone's bars and carry only background.
  const w = canvas.w, h = canvas.h, gutter = 12;
  const tall = isTall(canvas);
  const safe = safeArea(canvas);
  const hudY = tall ? safe.y0 + 4 : 24;
  return {
    canvas: { w, h },
    gutter,
    safe,
    hud: { x: gutter, y: hudY, w: w - gutter * 2, h: 48 },
    top: hudY + 48 + 12,
    hudBottom: { x: gutter, y: safe.y1 - (tall ? 40 : 40), w: w - gutter * 2, h: 36 },
    controlsBottom: safe.y1 - 24,
  };
}

/** Height of the fixed control band (answer tiles, buttons, a keypad) at the bottom of the safe area. */
export const CONTROL_BAND_H = 152;

/**
 * The three fixed screen regions a game's own nodes are placed in, for a canvas. On the tall
 * 360 × 780 canvas they sit inside the safe area (y 110–684):
 *   hud       the HUD band            y 114–162 (tall) / 24–72 (640)
 *   play      the play area           from 12 under the HUD band to 12 above the control band
 *   controls  the control band        CONTROL_BAND_H tall, ending 24 above the safe bottom
 * plus `strip` (the bottom strip, when a game uses hud_bottom) and `safe`.
 */
export function kitRegions(canvas = CANVAS) {
  const b = bands(canvas);
  const hud = { ...b.hud };
  const controls = { x: b.gutter, y: b.controlsBottom - CONTROL_BAND_H, w: canvas.w - b.gutter * 2, h: CONTROL_BAND_H };
  const top = hud.y + hud.h + 12;
  return { hud, play: { x: 0, y: top, w: canvas.w, h: controls.y - 12 - top }, controls, strip: { ...b.hudBottom }, safe: b.safe };
}

// ---------- the scales (fixed: Muse never picks a size) ----------

/** The 4 pt grid. Every static position and size the kit writes is a multiple of GRID. */
export const GRID = 4;
export const SPACE = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 };

/** Five type steps. `min` is the smallest any text may shrink to at play size. */
export const TYPE = {
  display: { size: 32, weight: 800 },
  title: { size: 22, weight: 700 },
  body: { size: 17, weight: 500 },
  label: { size: 15, weight: 700 },
  caption: { size: 13, weight: 600 },
};
export const TYPE_STEPS = ['display', 'title', 'body', 'label', 'caption'];
export const TYPE_SIZES = TYPE_STEPS.map((s) => TYPE[s].size); // 32 22 17 15 13
export const MIN_TEXT = 13;
/** Smallest touch target, in canvas units (the canvas is 360 wide, about 1 pt per unit on a phone). */
export const MIN_TOUCH = 44;

export const MOTION = {
  fast: { ms: 120, ease: 'out' },
  base: { ms: 180, ease: 'out' },
  slow: { ms: 280, ease: 'in_out' },
  pop: { ms: 170, ease: 'spring' },
};

/** Style families: corner radii, stroke widths, elevation and a fallback font. */
export const FAMILIES = {
  rounded: { radius: { s: 8, m: 12, l: 20 }, stroke: { thin: 1, base: 2, bold: 3 }, elevation: 1, font: 'Avenir Next' },
  soft: { radius: { s: 12, m: 16, l: 24 }, stroke: { thin: 1, base: 2, bold: 2 }, elevation: 2, font: 'Avenir Next' },
  sharp: { radius: { s: 2, m: 4, l: 8 }, stroke: { thin: 1, base: 2, bold: 3 }, elevation: 1, font: 'Space Grotesk' },
  pixel: { radius: { s: 0, m: 0, l: 0 }, stroke: { thin: 2, base: 4, bold: 4 }, elevation: 0, font: 'Silkscreen' },
  storybook: { radius: { s: 8, m: 12, l: 16 }, stroke: { thin: 1, base: 2, bold: 3 }, elevation: 1, font: 'Baskerville' },
};

/** Density: how tall controls are and how far apart. Controls never go under MIN_TOUCH. */
export const DENSITIES = {
  roomy: { control: 56, gap: 12, pad: 16 },
  regular: { control: 52, gap: 8, pad: 12 },
  compact: { control: 48, gap: 8, pad: 12 },
};

/**
 * Theme presets: the mood of the palette. The hue comes from the game's base colour; the preset
 * decides light or dark, how saturated, and where the accent sits on the colour wheel.
 * bg/surface are HSL lightness (0–100) and saturation; accent is a hue shift in degrees.
 */
export const THEMES = {
  bright: { dark: false, bg: [96, 60], surface: [100, 0], raise: -6, sat: 78, accent: 150 },
  soft: { dark: false, bg: [95, 35], surface: [99, 30], raise: -5, sat: 50, accent: 120 },
  paper: { dark: false, bg: [93, 28], surface: [97, 30], raise: -6, sat: 45, accent: 170, hue: 40 },
  mono: { dark: false, bg: [96, 4], surface: [100, 0], raise: -6, sat: 70, accent: 180 },
  night: { dark: true, bg: [11, 45], surface: [18, 40], raise: 7, sat: 80, accent: 150 },
  neon: { dark: true, bg: [7, 55], surface: [13, 50], raise: 7, sat: 95, accent: 165 },
  dusk: { dark: true, bg: [16, 28], surface: [23, 26], raise: 7, sat: 55, accent: 135 },
  retro: { dark: false, bg: [90, 45], surface: [95, 40], raise: -7, sat: 65, accent: 190 },
};
export const THEME_NAMES = Object.keys(THEMES);

/** Every palette role the kit defines, and the roles each has an on-colour for. */
export const ROLES = ['bg', 'surface', 'surface_2', 'ink', 'ink_muted', 'primary', 'secondary', 'accent', 'danger', 'success',
  'primary_ink', 'secondary_ink', 'accent_ink', 'danger_ink', 'success_ink', 'line', 'scrim'];
/** Colour roles that have a 4.5:1 text variant `<role>_ink`. */
export const INK_ROLES = ['primary', 'secondary', 'accent', 'danger', 'success'];
export const ON_ROLES = ['primary', 'secondary', 'accent', 'danger', 'success', 'surface', 'bg'];
/** The engine's standard token roles (fragments use only these). */
export const STANDARD = ['primary', 'secondary', 'accent', 'ink', 'bg', 'danger', 'surface'];

// ---------- colour math ----------

const HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;

export function normHex(c) {
  if (typeof c !== 'string') return null;
  const m3 = HEX3.exec(c);
  if (m3) return ('#' + [...m3[1]].map((d) => d + d).join('')).toUpperCase();
  const m = HEX.exec(c);
  return m ? ('#' + m[1]).toUpperCase() : null;
}
export const isHex = (c) => normHex(c) !== null;
/** Alpha of a #RRGGBBAA colour (1 for #RRGGBB). */
export function alphaOf(c) {
  const m = HEX.exec(String(c));
  return m && m[2] ? parseInt(m[2], 16) / 255 : 1;
}

export function hexToRgb(hex) {
  const h = normHex(hex);
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}
export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}
export function hslToRgb([h, s, l]) {
  h = (((h % 360) + 360) % 360) / 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
export const hsl = (h, s, l) => rgbToHex(hslToRgb([h, s, l]));
export const hslOf = (hex) => rgbToHsl(hexToRgb(hex));

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [lo, hi] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}
/** Mix two colours, t = 0 → a, 1 → b. */
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}
/** Squared distance in RGB weighted for perception (redmean). */
export function colorDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/**
 * Moves `color`'s lightness, in 1% steps, away from every colour in `against` until it has at
 * least `min` contrast with all of them. Keeps hue and saturation. Deterministic. Returns the
 * first lightness that passes, or the extreme (0 or 100) when none does.
 */
export function ensureContrast(color, against, min) {
  const list = (Array.isArray(against) ? against : [against]).filter(Boolean);
  const ok = (c) => list.every((a) => contrast(c, a) >= min);
  if (ok(color)) return normHex(color);
  const [h, s, l] = hslOf(color);
  const avgLum = list.reduce((t, a) => t + luminance(a), 0) / list.length;
  // Try the direction away from the backgrounds first, then the other one.
  const firstDown = avgLum > 0.18;
  for (const dir of firstDown ? [-1, 1] : [1, -1]) {
    for (let step = 1; step <= 100; step++) {
      const ll = l + dir * step;
      if (ll < 0 || ll > 100) break;
      const c = hsl(h, s, ll);
      if (ok(c)) return c;
    }
  }
  return hsl(h, s, firstDown ? 0 : 100);
}

/** The better of a near-white and a near-black tinted with `hue`, for text on `fill`. */
export function onColor(fill, hue, min = 4.5) {
  const light = hsl(hue, 30, 98), dark = hsl(hue, 35, 10);
  const cl = contrast(light, fill), cd = contrast(dark, fill);
  const pick = cl >= cd ? light : dark;
  if (contrast(pick, fill) >= min) return pick;
  return contrast('#FFFFFF', fill) >= contrast('#000000', fill) ? '#FFFFFF' : '#000000';
}

// ---------- the knobs ----------

/** Reads and normalizes a manifest's `ui` block. Unknown values fall back, with a note. */
export function readKnobs(ui = {}, notes = []) {
  const k = { kit: STYLE_KIT, theme: 'bright', base: null, accent: null, family: 'rounded', density: 'regular', palette: null };
  if (!ui || typeof ui !== 'object') return k;
  if (ui.theme !== undefined) {
    if (THEMES[ui.theme]) k.theme = ui.theme;
    else notes.push({ code: 'S_UI_KNOB', at: '/ui/theme', message: `ui.theme '${ui.theme}' is not one of ${THEME_NAMES.join(', ')}; used 'bright'` });
  }
  if (ui.family !== undefined) {
    if (FAMILIES[ui.family]) k.family = ui.family;
    else notes.push({ code: 'S_UI_KNOB', at: '/ui/family', message: `ui.family '${ui.family}' is not one of ${Object.keys(FAMILIES).join(', ')}; used 'rounded'` });
  }
  if (ui.density !== undefined) {
    if (DENSITIES[ui.density]) k.density = ui.density;
    else notes.push({ code: 'S_UI_KNOB', at: '/ui/density', message: `ui.density '${ui.density}' is not one of ${Object.keys(DENSITIES).join(', ')}; used 'regular'` });
  }
  for (const key of ['base', 'accent']) {
    if (ui[key] === undefined) continue;
    if (isHex(ui[key])) k[key] = normHex(ui[key]);
    else notes.push({ code: 'S_UI_KNOB', at: `/ui/${key}`, message: `ui.${key} must be #RRGGBB` });
  }
  if (ui.palette && typeof ui.palette === 'object') {
    k.palette = {};
    for (const [r, v] of Object.entries(ui.palette)) if (isHex(v)) k.palette[r] = normHex(v);
  }
  return k;
}

/** Guesses a theme for an existing palette (adopting a game written before the kit). */
export function themeFor(palette = {}) {
  const bg = normHex(palette.bg) ?? '#F4F1EA';
  const [, s, l] = hslOf(bg);
  if (l < 9) return 'neon';
  if (l < 30) return s < 30 ? 'dusk' : 'night';
  if (s < 8) return 'mono';
  if (l < 91 && s > 30) return 'retro';
  return s > 50 ? 'bright' : 'soft';
}

// ---------- derivation ----------

/**
 * The full token set for a game.
 *
 *   deriveStyle({ theme, base, accent, family, density })   a palette from the knobs
 *   deriveStyle({ palette: {bg, ink, primary, …} })          adopt an existing palette, moving
 *                                                            only lightness until it passes AA
 *
 * Returns { kit, knobs, colors: {role: #RRGGBB}, on: {role: #RRGGBB}, type, space, radius,
 * stroke, elevation, motion, control, gap, pad, font, contrast: {pair: ratio} }.
 */
export function deriveStyle(ui = {}, { fallbackPalette = null } = {}) {
  const notes = [];
  const k = readKnobs(ui, notes);
  const fam = FAMILIES[k.family];
  const den = DENSITIES[k.density];
  const adopt = k.palette ?? (k.base ? null : fallbackPalette ? Object.fromEntries(Object.entries(fallbackPalette).filter(([, v]) => isHex(v)).map(([r, v]) => [r, normHex(v)])) : null);
  const theme = THEMES[adopt && ui.theme === undefined ? themeFor(adopt) : k.theme];
  const base = k.base ?? adopt?.primary ?? '#4A6CF7';
  const [bh, bs] = hslOf(base);
  const hue = bh;
  const c = {};

  // Grounds.
  const groundHue = theme.hue ?? hue;
  c.bg = adopt?.bg ?? hsl(groundHue, theme.bg[1], theme.bg[0]);
  const [gh, gs, gl] = hslOf(c.bg);
  c.surface = adopt?.surface && Math.abs(hslOf(adopt.surface)[2] - gl) >= 3 ? adopt.surface : hsl(gh, Math.min(gs, theme.surface[1] || gs), theme.dark ? Math.min(100, gl + Math.abs(theme.raise)) : Math.max(0, theme.surface[0]));
  if (!theme.dark && Math.abs(hslOf(c.surface)[2] - gl) < 3) c.surface = hsl(gh, gs, Math.max(0, gl + theme.raise));
  const [sh, ss, sl] = hslOf(c.surface);
  c.surface_2 = hsl(sh, ss, Math.max(0, Math.min(100, sl + (theme.dark ? 6 : -6))));

  // Ink: AAA on bg, AA on both surfaces.
  const inkSeed = adopt?.ink ?? (theme.dark ? hsl(groundHue, 30, 96) : hsl(groundHue, 35, 12));
  c.ink = ensureContrast(ensureContrast(inkSeed, [c.bg], 7), [c.bg, c.surface, c.surface_2], 4.5);
  // Muted ink: halfway to the ground, then back toward ink until AA on surface and bg.
  c.ink_muted = ensureContrast(mix(c.ink, c.surface, 0.42), [c.bg, c.surface], 4.5);

  // Colour roles: 3:1 on bg and surface (WCAG AA for large text and UI parts), so they work as
  // fills, strokes and big text. Small text in a role colour uses `<role>_ink` (4.5:1).
  const roleSeed = (h, sat, l) => hsl(h, sat, l);
  const midL = theme.dark ? 66 : 42;
  const seeds = {
    primary: adopt?.primary ?? roleSeed(hue, Math.max(bs, theme.sat * 0.9), midL),
    accent: k.accent ?? adopt?.accent ?? roleSeed(hue + theme.accent, theme.sat, theme.dark ? 64 : 44),
    secondary: adopt?.secondary ?? roleSeed(hue + 30, theme.sat * 0.6, theme.dark ? 72 : 36),
    danger: adopt?.danger ?? roleSeed(356, 78, theme.dark ? 66 : 44),
    success: adopt?.success ?? roleSeed(146, 62, theme.dark ? 58 : 32),
  };
  for (const [role, seed] of Object.entries(seeds)) c[role] = ensureContrast(seed, [c.bg, c.surface], 3);
  for (const role of Object.keys(seeds)) c[`${role}_ink`] = ensureContrast(c[role], [c.bg, c.surface, c.surface_2], 4.5);
  c.line = ensureContrast(mix(c.ink, c.surface, 0.72), [c.surface], 1.6);
  c.scrim = c.bg;

  // On-colours: text on a filled role, AA.
  const on = {};
  for (const role of ON_ROLES) on[role] = onColor(c[role], hue);

  const pairs = {};
  for (const role of ON_ROLES) pairs[`on_${role}/${role}`] = round2(contrast(on[role], c[role]));
  for (const t of ['ink', 'ink_muted', ...INK_ROLES.map((r) => `${r}_ink`)]) {
    pairs[`${t}/bg`] = round2(contrast(c[t], c.bg));
    pairs[`${t}/surface`] = round2(contrast(c[t], c.surface));
  }

  return {
    kit: STYLE_KIT,
    knobs: { theme: Object.keys(THEMES).find((n) => THEMES[n] === theme), base, accent: k.accent, family: k.family, density: k.density, adopted: !!adopt },
    dark: theme.dark,
    colors: c,
    on,
    type: TYPE,
    space: SPACE,
    radius: { ...fam.radius },
    stroke: { ...fam.stroke },
    elevation: fam.elevation,
    motion: MOTION,
    control: den.control,
    gap: den.gap,
    pad: den.pad,
    font: fam.font,
    contrast: pairs,
    notes,
  };
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * The engine tokens for a style: the seven standard roles plus the kit's own (`ink_muted`,
 * `surface_2`, `success`, `line`, `scrim`, `shadow`, `on_<role>`). Kit token names never start with
 * a role a game might use for itself.
 */
export function styleTokens(style) {
  const t = {};
  for (const r of ROLES) t[r] = style.colors[r];
  t.scrim = style.colors.bg + 'E6';
  t.shadow = '#00000033';
  for (const [r, v] of Object.entries(style.on)) t[`on_${r}`] = v;
  return t;
}

/** Every literal colour value a style allows, normalized, for the style check. */
export function styleColorSet(style) {
  return new Set(Object.values(styleTokens(style)).map((v) => normHex(v)).filter(Boolean));
}

/** Nearest scale step for a font size (ties go to the smaller step). */
export function snapType(size) {
  let best = TYPE_SIZES[0];
  for (const s of TYPE_SIZES) if (Math.abs(s - size) < Math.abs(best - size) || (Math.abs(s - size) === Math.abs(best - size) && s < best)) best = s;
  return Math.max(MIN_TEXT, best);
}
/** The type step at or below `size`, never under MIN_TEXT. */
export function stepAtOrBelow(size) {
  const below = TYPE_SIZES.filter((s) => s <= size);
  return below.length ? Math.max(...below) : MIN_TEXT;
}
export const snapGrid = (v) => Math.round(v / GRID) * GRID;
