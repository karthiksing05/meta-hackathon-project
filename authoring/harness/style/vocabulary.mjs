// The style vocabulary. A style spec is how Muse turns whatever the player asked for ("vaporwave",
// "watercolor storybook", "chunky toy plastic") into settings the compiler can apply the same way
// to every asset. Muse picks the palette, the light and one option per treatment; the compiler
// (compile.mjs) owns how each option is drawn. Sizes are in screen pixels at play size, so a
// 3 px outline is 3 px on the phone whatever the asset's viewBox.

export const TREATMENTS = {
  edge: {
    what: 'how silhouette edges are cut',
    styles: {
      clean: 'crisp vector edges',
      rough: 'torn or hand-cut edges; amount = how far the edge wanders (px)',
      wobble: 'slow, hand-drawn wobble; amount = wander (px)',
      pixel: 'snap to a pixel grid; amount = cell size (px)',
    },
    defaults: { style: 'clean', amount: 1.5 },
    ranges: { amount: [0.5, 8] },
  },
  shading: {
    what: 'the dark side of each shape, away from the light',
    styles: {
      none: 'flat color',
      cel: 'one hard-edged shadow band',
      soft: 'a soft gradient band',
      clay: 'deep, rounded shading as if the shape were a soft solid',
    },
    defaults: { style: 'none', size: 6, strength: 0.35, color: 'ink' },
    ranges: { size: [1, 24], strength: [0, 0.9] },
  },
  highlight: {
    what: 'the lit side of each shape',
    styles: {
      none: 'no highlight',
      rim: 'a thin lit edge facing the light',
      gloss: 'a glossy specular sheen (plastic, candy, enamel)',
      soft: 'a broad, soft sheen (clay, felt, matte paint)',
    },
    defaults: { style: 'none', size: 3, strength: 0.5, color: 'surface' },
    ranges: { size: [1, 16], strength: [0, 1] },
  },
  texture: {
    what: 'surface texture inside shapes',
    styles: {
      none: 'smooth',
      grain: 'fine film or print grain',
      paper: 'soft blotchy paper fibers',
      canvas: 'woven, painterly canvas',
      scanline: 'horizontal CRT scanlines',
      halftone: 'print halftone dots; size = dot spacing (px)',
      hatch: 'diagonal ink hatching; size = line spacing (px)',
    },
    defaults: { style: 'none', amount: 0.25, size: 4, color: 'ink' },
    ranges: { amount: [0, 0.8], size: [2, 12] },
  },
  outline: {
    what: 'the line around each sprite silhouette',
    styles: {
      none: 'no outline',
      solid: 'one even outer line',
      double: 'two nested outer lines (sticker, badge)',
      glow: 'a blurred light line (neon, magic)',
      inner: 'a line drawn inside the silhouette (ink, woodcut)',
    },
    defaults: { style: 'none', width: 2.5, color: 'ink', color2: 'surface' },
    ranges: { width: [1, 8] },
  },
  shadow: {
    what: 'the shadow the whole sprite casts',
    styles: {
      none: 'no shadow',
      offset: 'a hard, flat offset shadow (paper cutout, print)',
      drop: 'a soft drop shadow',
      long: 'a long flat diagonal shadow (flat design)',
      glow: 'an outer glow instead of a shadow (neon, magic)',
      contact: 'a soft ellipse under the sprite where it meets the ground',
    },
    defaults: { style: 'none', distance: 4, blur: 3, opacity: 0.35, color: 'ink' },
    ranges: { distance: [0, 16], blur: [0, 12], opacity: [0, 1] },
  },
};

const LIGHTS = { 'top-left': [-1, -1], top: [0, -1], 'top-right': [1, -1], left: [-1, 0], right: [1, 0] };
export const LIGHT_NAMES = Object.keys(LIGHTS);
export function lightVector(name) {
  const [x, y] = LIGHTS[name] ?? LIGHTS['top-left'];
  const n = Math.hypot(x, y);
  return [x / n, y / n];
}

// Presets are for tests and fallbacks only. The director prompt does not show them to Muse, so its
// specs come from the player's words and the vocabulary, not from our examples.
export const PRESETS = {
  paper: {
    summary: 'Layered paper cutout: flat colors, torn edges, hard offset shadows, paper grain.',
    palette: { ink: '#352B40', surface: '#FFF1D9', accent: '#C35C52', secondary: '#397770', tertiary: '#D3A454', sky: '#DCE7D8' },
    light: 'top-left',
    sprite: { edge: { style: 'rough', amount: 1.2 }, shading: { style: 'none' }, highlight: { style: 'none' }, texture: { style: 'paper', amount: 0.22 }, outline: { style: 'none' }, shadow: { style: 'offset', distance: 3, opacity: 0.35 } },
    backdrop: { edge: { style: 'rough', amount: 1.5 }, texture: { style: 'paper', amount: 0.3 }, shadow: { style: 'offset', distance: 3, opacity: 0.25 } },
  },
  clay: {
    summary: 'Soft toy clay: rounded shading, a soft sheen, contact shadows, no outlines.',
    palette: { ink: '#3A2E2A', surface: '#FBEFE3', accent: '#E0663F', secondary: '#4F9C8F', tertiary: '#F2C14E', sky: '#BFE3F0' },
    light: 'top-left',
    sprite: { shading: { style: 'clay', size: 10, strength: 0.45 }, highlight: { style: 'soft', size: 6, strength: 0.55 }, texture: { style: 'grain', amount: 0.08 }, outline: { style: 'none' }, shadow: { style: 'contact', opacity: 0.35 } },
    backdrop: { shading: { style: 'clay', size: 14, strength: 0.3 }, highlight: { style: 'soft', size: 8, strength: 0.3 } },
  },
  pixel: {
    summary: 'Chunky 16-bit pixel art: pixel grid, hard cel shading, dark outline, few colors.',
    palette: { ink: '#1B1A2E', surface: '#F4F1DE', accent: '#E63946', secondary: '#2A9D8F', tertiary: '#F4A261', sky: '#8ECAE6' },
    light: 'top-left',
    sprite: { edge: { style: 'pixel', amount: 3 }, shading: { style: 'cel', size: 6, strength: 0.4 }, highlight: { style: 'rim', size: 3, strength: 0.6 }, outline: { style: 'solid', width: 3 } },
    backdrop: { edge: { style: 'pixel', amount: 4 }, shading: { style: 'cel', size: 8, strength: 0.25 } },
  },
  neon: {
    summary: 'Neon at night: dark shapes, glowing tube outlines, outer glow, scanlines.',
    palette: { ink: '#0D0221', surface: '#F7F7FF', accent: '#FF2E88', secondary: '#21D4FD', tertiary: '#FFE15D', sky: '#241153' },
    light: 'top',
    sprite: { outline: { style: 'glow', width: 3, color: 'secondary' }, shadow: { style: 'glow', blur: 6, opacity: 0.8, color: 'accent' }, texture: { style: 'scanline', amount: 0.2 } },
    backdrop: { texture: { style: 'scanline', amount: 0.25 }, shading: { style: 'soft', size: 12, strength: 0.3 } },
  },
};

const HEX = /^#[0-9a-fA-F]{6}$/;
export const REQUIRED_ROLES = ['ink', 'surface', 'accent'];

function clamp(v, [lo, hi], fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

// Fill defaults, clamp numbers, and report anything the compiler had to change. Never throws on
// style choices; only an unusable palette is an error.
export function normalizeSpec(raw) {
  const issues = [];
  const spec = { name: String(raw?.name ?? 'custom'), summary: String(raw?.summary ?? ''), drawing: raw?.drawing ?? {} };
  const palette = {};
  for (const [role, hex] of Object.entries(raw?.palette ?? {})) {
    if (!/^[a-z][a-z0-9_]{0,15}$/.test(role)) { issues.push(`palette role "${role}" must be a short lowercase name`); continue; }
    if (!HEX.test(hex)) { issues.push(`palette.${role} must be #RRGGBB`); continue; }
    palette[role] = hex.toUpperCase();
  }
  for (const r of REQUIRED_ROLES) if (!palette[r]) issues.push(`palette needs a "${r}" role`);
  if (Object.keys(palette).length > 8) issues.push('palette has more than 8 roles; keep it to 8');
  spec.palette = palette;
  spec.light = LIGHT_NAMES.includes(raw?.light) ? raw.light : 'top-left';
  for (const layer of ['sprite', 'backdrop']) {
    spec[layer] = {};
    for (const [name, def] of Object.entries(TREATMENTS)) {
      const given = raw?.[layer]?.[name] ?? {};
      const style = given.style in def.styles ? given.style : def.defaults.style;
      if (given.style && !(given.style in def.styles)) issues.push(`${layer}.${name}.style "${given.style}" isn't one of ${Object.keys(def.styles).join(', ')}`);
      const t = { ...def.defaults, ...given, style };
      for (const [k, range] of Object.entries(def.ranges)) t[k] = clamp(t[k], range, def.defaults[k]);
      for (const k of ['color', 'color2']) if (t[k] !== undefined && !palette[t[k]]) {
        if (given[k]) issues.push(`${layer}.${name}.${k} "${given[k]}" isn't a palette role`);
        t[k] = palette[def.defaults[k]] ? def.defaults[k] : 'ink';
      }
      spec[layer][name] = t;
    }
  }
  // Outlines on a full-bleed backdrop only outline the canvas edge, so they are sprite-only.
  spec.backdrop.outline.style = 'none';
  return { spec, issues, ok: REQUIRED_ROLES.every((r) => palette[r]) };
}

// The vocabulary as prompt text for the style director.
export function describeVocabulary() {
  const lines = [];
  for (const [name, def] of Object.entries(TREATMENTS)) {
    lines.push(`${name} (${def.what}): ` + Object.entries(def.styles).map(([s, d]) => `${s} = ${d}`).join('; ') +
      `. Params: ${Object.entries(def.ranges).map(([k, [a, b]]) => `${k} ${a}–${b}`).join(', ') || 'none'}` +
      (def.defaults.color ? '; color = a palette role' : '') + '.');
  }
  return lines.join('\n');
}
