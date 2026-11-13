// The palette from a style frame's pixels. Deterministic: a fixed-stride sample, a median cut into
// swatches, then the standard token roles picked from the swatches with WCAG contrast enforced, so
// text on the frame's own grounds always reads (ink 7:1 on bg and surface, on-colours 4.5:1).
//
//   extractSwatches(img, {count}) → [{hex, rgb, n, share, lum, chroma, hue}], most common first
//   paletteFromFrame(img, opts)   → {mode: 'light' | 'dark', roles: {bg, surface, primary, secondary,
//                                    accent, ink, danger, ink_muted, on_primary, on_accent, ...},
//                                    swatches}
//
// Pure JS, no imports. An image is {w, h, data: RGBA}.

export const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const contrast = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
export const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
export const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16));
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Hue (0–360), saturation-like chroma (0–1) and lightness (0–1) of an RGB triple. */
export function hcl([r, g, b]) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), c = max - min;
  let h = 0;
  if (c > 0) {
    if (max === R) h = ((G - B) / c) % 6;
    else if (max === G) h = (B - R) / c + 2;
    else h = (R - G) / c + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const light = (max + min) / 2;
  const sat = c === 0 ? 0 : c / (1 - Math.abs(2 * light - 1));
  return { hue: h, chroma: c, light, sat };
}
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Median cut over a fixed-stride sample of opaque pixels. */
export function extractSwatches(img, { count = 12, samples = 24000 } = {}) {
  const { w, h, data } = img;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / samples)));
  const px = [];
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const o = (y * w + x) * 4;
    if (data[o + 3] < 128) continue;
    px.push([data[o], data[o + 1], data[o + 2]]);
  }
  if (!px.length) return [];
  let boxes = [px];
  while (boxes.length < count) {
    // Split the box with the widest channel range (ties: the larger box), at its median.
    let best = -1, bestRange = -1, bestCh = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const p of b) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
        const range = (hi - lo) * Math.log2(b.length + 1);
        if (range > bestRange) { bestRange = range; best = i; bestCh = c; }
      }
    });
    if (best < 0 || bestRange <= 0) break;
    const b = boxes[best].slice().sort((p, q) => p[bestCh] - q[bestCh] || p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    const m = b.length >> 1;
    boxes.splice(best, 1, b.slice(0, m), b.slice(m));
  }
  const total = px.length;
  const out = boxes.filter((b) => b.length).map((b) => {
    const rgb = [0, 1, 2].map((c) => b.reduce((s, p) => s + p[c], 0) / b.length).map(Math.round);
    const { hue, chroma, light, sat } = hcl(rgb);
    return { hex: hex(rgb), rgb, n: b.length, share: b.length / total, lum: lum(rgb), chroma, hue, light, sat };
  });
  return out.sort((a, b) => b.n - a.n || a.hex.localeCompare(b.hex));
}

/** Moves `fg` toward black or white (whichever gains) until it reaches `need`:1 against every ground. */
export function ensureContrast(fg, grounds, need) {
  const ok = (c) => grounds.every((g) => contrast(c, g) >= need);
  if (ok(fg)) return fg;
  const darkGround = grounds.reduce((s, g) => s + lum(g), 0) / grounds.length < 0.4;
  const targets = darkGround ? [[255, 255, 255], [0, 0, 0]] : [[0, 0, 0], [255, 255, 255]];
  for (const t of targets) for (let k = 1; k <= 20; k++) { const c = mix(fg, t, k / 20); if (ok(c)) return c.map(Math.round); }
  return darkGround ? [255, 255, 255] : [0, 0, 0];
}

/**
 * Token roles from a frame. `opts.mode` forces light or dark; `opts.ground` (an RGB) forces the bg.
 * The bg is the frame's most common colour (a dark frame's darkest common colour), the accents are
 * the most chromatic swatches with distinct hues, and every text role is pushed to its contrast.
 */
export function paletteFromFrame(img, { count = 24, mode = null, ground = null } = {}) {
  const sw = extractSwatches(img, { count });
  const meanLum = sw.reduce((s, x) => s + x.lum * x.share, 0);
  const m = mode ?? (meanLum > 0.3 ? 'light' : 'dark');
  const common = sw.filter((x) => x.share >= 0.03);
  const bgSw = ground ? { rgb: ground } : (m === 'dark' ? [...common].sort((a, b) => a.lum - b.lum)[0] : [...common].sort((a, b) => b.lum - a.lum)[0]) ?? sw[0];
  const bg = bgSw.rgb;
  // Accents: colourful swatches (HSL saturation, so pastels count) that the frame really uses, weighted
  // a little by population, with distinct hues (≥ 35° apart) and away from the bg's hue.
  const score = (x) => x.sat * Math.min(1, x.chroma * 4) * Math.pow(x.share, 0.2);
  const bgHue = hcl(bg).hue, bgGrey = hcl(bg).chroma < 0.08;
  const ranked = [...sw].filter((x) => x.share >= 0.003 && x.chroma > 0.12 && x.light > 0.2 && x.light < 0.93 && (bgGrey || hueDist(x.hue, bgHue) >= 20 || x.chroma > 0.4)).sort((a, b) => score(b) - score(a) || a.hex.localeCompare(b.hex));
  const picks = [];
  for (const x of ranked) if (picks.every((p) => hueDist(p.hue, x.hue) >= 35)) picks.push(x);
  // Too few distinct hues (a near-monochrome frame): take the brightest colourful swatches in the bg's
  // own hue family too, lighter than the bg so they read as accents on it.
  if (picks.length < 3) {
    const near = [...sw].filter((x) => !picks.includes(x) && x.share >= 0.003 && x.sat > 0.15 && Math.abs(x.light - hcl(bg).light) > 0.25).sort((a, b) => score(b) - score(a) || a.hex.localeCompare(b.hex));
    for (const x of near) if (picks.length < 3 && picks.every((p) => hueDist(p.hue, x.hue) >= 12 || Math.abs(p.light - x.light) > 0.2)) picks.push(x);
  }
  while (picks.length < 3) picks.push(picks.length ? { rgb: mix(picks[0].rgb, m === 'dark' ? [255, 255, 255] : [0, 0, 0], 0.3 * picks.length) } : { rgb: m === 'dark' ? [120, 200, 255] : [60, 90, 200] });
  const white = [255, 255, 255], black = [0, 0, 0];
  const surface = m === 'dark' ? mix(bg, white, 0.1).map(Math.round) : mix(bg, white, 0.82).map(Math.round);
  const darkest = [...sw].sort((a, b) => a.lum - b.lum)[0].rgb;
  const lightest = [...sw].sort((a, b) => b.lum - a.lum)[0].rgb;
  const ink = ensureContrast(m === 'dark' ? mix(lightest, white, 0.6) : mix(darkest, black, 0.35), [bg, surface], 7);
  const inkMuted = ensureContrast(mix(ink, surface, 0.35), [surface], 4.5);
  const primary = picks[0].rgb, accent = picks[1].rgb, secondary = picks[2].rgb;
  // Text on a role colour: whichever of white, the ink, the bg and the darkest swatch reads best.
  const onColor = (c) => { const best = [white, ink, bg, darkest].sort((p, q) => contrast(q, c) - contrast(p, c))[0]; return ensureContrast(best, [c], 4.5); };
  const danger = ensureContrast(mix([226, 60, 80], primary, 0.15), [surface], 3);
  const roles = {
    bg: hex(bg), surface: hex(surface), primary: hex(primary), secondary: hex(secondary), accent: hex(accent),
    ink: hex(ink), danger: hex(danger), ink_muted: hex(inkMuted),
    on_primary: hex(onColor(primary)), on_accent: hex(onColor(accent)), on_secondary: hex(onColor(secondary)), on_bg: hex(ensureContrast(ink, [bg], 4.5)),
    // Text set straight on a role colour (labels on a coloured plate) and a darker role tone for text on the surface.
    primary_ink: hex(ensureContrast(primary, [surface], 4.5)), accent_ink: hex(ensureContrast(accent, [surface], 4.5)),
  };
  return { mode: m, roles, swatches: sw.map(({ hex: h, share, hue, chroma, light, sat }) => ({ hex: h, share: Math.round(share * 1000) / 1000, hue: Math.round(hue), chroma: Math.round(chroma * 100) / 100, light: Math.round(light * 100) / 100, sat: Math.round(sat * 100) / 100 })) };
}
