// The style compiler. Muse draws flat shapes colored with palette role names; this file turns the
// style spec into one SVG filter stack per asset, so outlines, shading, sheen, texture and shadows
// come out identical across a game's sprites and backdrop layers, whatever style was asked for.
// Output uses only elements the app's sanitizer allows (filters, masks, patterns, local url(#id)).

import { lightVector } from './vocabulary.mjs';

const r2 = (n) => Math.round(n * 100) / 100;

function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbToHex(c) { return '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase(); }
function mix(a, b, t) { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(x.map((v, i) => v + (y[i] - v) * t)); }

// Role tokens Muse may use: "accent", "accent-dark", "accent-light" (dark mixes toward ink, light
// toward surface), plus "none" and "transparent".
export function tokenTable(palette) {
  const table = {};
  for (const [role, hex] of Object.entries(palette)) {
    table[role] = hex;
    table[role + '-dark'] = mix(hex, palette.ink, 0.38);
    table[role + '-light'] = mix(hex, palette.surface, 0.42);
  }
  return table;
}

const COLOR_ATTR = /\b(fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*"([^"]*)"/g;
const COLOR_CSS = /\b(fill|stroke|stop-color)\s*:\s*([^;"]+)/g;
export function resolveTokens(markup, palette) {
  const table = tokenTable(palette);
  const swap = (v) => table[v.trim()] ?? v;
  return markup.replace(COLOR_ATTR, (m, k, v) => `${k}="${swap(v)}"`).replace(COLOR_CSS, (m, k, v) => `${k}:${swap(v)}`);
}

export function parseSvg(svg) {
  const m = /^\s*<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(svg);
  if (!m) throw Error('not a single <svg> element');
  const vb = /viewBox\s*=\s*"([^"]+)"/.exec(m[1])?.[1].trim().split(/[\s,]+/).map(Number);
  return { attrs: m[1], inner: m[2], viewBox: vb && vb.length === 4 ? { x: vb[0], y: vb[1], w: vb[2], h: vb[3] } : null };
}

// Split markup into its top-level elements (backdrop layers).
export function topLevel(inner) {
  const out = []; let depth = 0, start = -1;
  const re = /<!--[\s\S]*?-->|<\/?([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g; let m;
  while ((m = re.exec(inner))) {
    if (m[0].startsWith('<!--')) continue;
    const closing = m[0][1] === '/', selfClosing = m[2] === '/';
    if (!closing && depth === 0) start = m.index;
    if (closing) depth--; else if (!selfClosing) depth++;
    if (depth === 0 && start >= 0) { out.push(inner.slice(start, re.lastIndex)); start = -1; }
  }
  return out;
}

const ALPHA = '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0';

// One filter for one asset (or one backdrop layer). t = spec.sprite or spec.backdrop.
function effectFilter(id, t, { W, H, s, L, pal, sprite }) {
  const p = [];
  const col = (role) => pal[role] ?? pal.ink;
  let body = 'SourceGraphic';

  if (t.edge.style === 'rough' || t.edge.style === 'wobble') {
    const f = (t.edge.style === 'rough' ? 0.09 : 0.018) / s;
    p.push(`<feTurbulence type="fractalNoise" baseFrequency="${r2(f * 1000) / 1000}" numOctaves="${t.edge.style === 'rough' ? 3 : 2}" seed="7" result="en"/>`,
      `<feDisplacementMap in="SourceGraphic" in2="en" scale="${r2(t.edge.amount * s * 2)}" xChannelSelector="R" yChannelSelector="G" result="ed"/>`);
    body = 'ed';
  } else if (t.edge.style === 'pixel') {
    const c = t.edge.amount * s, dot = Math.max(c / 5, 0.6 * s);
    p.push(`<feFlood x="${r2((c - dot) / 2)}" y="${r2((c - dot) / 2)}" width="${r2(dot)}" height="${r2(dot)}" flood-color="#000"/>`,
      `<feComposite x="0" y="0" width="${r2(c)}" height="${r2(c)}"/>`,
      '<feTile result="grid"/>',
      `<feComposite in="${body}" in2="grid" operator="in"/>`,
      `<feMorphology operator="dilate" radius="${r2((c - dot) / 2 + 0.01)}"/>`,
      '<feComponentTransfer result="ed"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer>');
    body = 'ed';
  }
  p.push(`<feColorMatrix in="${body}" type="matrix" values="${ALPHA}" result="a"/>`);

  if (t.shading.style !== 'none') {
    const d = t.shading.size * s * (t.shading.style === 'clay' ? 1.3 : 1);
    p.push(`<feOffset in="a" dx="${r2(L[0] * d)}" dy="${r2(L[1] * d)}" result="sho"/>`,
      '<feComposite in="a" in2="sho" operator="out" result="shb"/>');
    let band = 'shb';
    if (t.shading.style !== 'cel') { p.push(`<feGaussianBlur in="shb" stdDeviation="${r2(d * (t.shading.style === 'clay' ? 0.7 : 0.45))}" result="shg"/>`); band = 'shg'; }
    p.push(`<feComposite in="${band}" in2="a" operator="in" result="shm"/>`,
      `<feFlood flood-color="${col(t.shading.color)}" flood-opacity="${t.shading.strength}"/>`,
      '<feComposite in2="shm" operator="in" result="shc"/>',
      `<feComposite in="shc" in2="${body}" operator="over" result="b1"/>`);
    body = 'b1';
  }

  if (t.highlight.style === 'gloss') {
    const az = Math.round(Math.atan2(L[1], L[0]) * 180 / Math.PI + 360) % 360;
    p.push(`<feGaussianBlur in="a" stdDeviation="${r2(t.highlight.size * s)}" result="bump"/>`,
      `<feSpecularLighting in="bump" surfaceScale="${r2(3 * s)}" specularConstant="${r2(0.6 + t.highlight.strength)}" specularExponent="28" lighting-color="${col(t.highlight.color)}" result="spec"><feDistantLight azimuth="${az}" elevation="48"/></feSpecularLighting>`,
      '<feComposite in="spec" in2="a" operator="in" result="specm"/>',
      `<feComposite in="${body}" in2="specm" operator="arithmetic" k2="1" k3="${r2(t.highlight.strength)}" result="b2"/>`);
    body = 'b2';
  } else if (t.highlight.style !== 'none') {
    const d = t.highlight.size * s * (t.highlight.style === 'soft' ? 1.6 : 1);
    p.push(`<feOffset in="a" dx="${r2(-L[0] * d)}" dy="${r2(-L[1] * d)}" result="hio"/>`,
      '<feComposite in="a" in2="hio" operator="out" result="hib"/>');
    let band = 'hib';
    if (t.highlight.style === 'soft') { p.push(`<feGaussianBlur in="hib" stdDeviation="${r2(d * 0.6)}" result="hig"/>`, '<feComposite in="hig" in2="a" operator="in" result="hib2"/>'); band = 'hib2'; }
    p.push(`<feFlood flood-color="${col(t.highlight.color)}" flood-opacity="${t.highlight.strength}"/>`,
      `<feComposite in2="${band}" operator="in" result="hic"/>`,
      `<feComposite in="hic" in2="${body}" operator="over" result="b2"/>`);
    body = 'b2';
  }

  const noise = { grain: [0.65, 1, 'fractalNoise'], paper: [0.085, 4, 'fractalNoise'], canvas: [0.22, 2, 'turbulence'] }[t.texture.style];
  if (noise) {
    const amt = t.texture.amount, c = r2(amt / 3), k = r2(1 - 0.75 * amt);
    const freq = t.texture.style === 'canvas' ? `${r2(noise[0] / s * 1000) / 1000} ${r2(noise[0] / 6 / s * 1000) / 1000}` : r2(noise[0] / s * 1000) / 1000;
    p.push(`<feTurbulence type="${noise[2]}" baseFrequency="${freq}" numOctaves="${noise[1]}" seed="11" result="tn"/>`,
      `<feColorMatrix in="tn" type="matrix" values="${c} ${c} ${c} 0 ${k}  ${c} ${c} ${c} 0 ${k}  ${c} ${c} ${c} 0 ${k}  0 0 0 0 1" result="tg"/>`,
      `<feBlend in="${body}" in2="tg" mode="multiply" result="tb"/>`,
      '<feComposite in="tb" in2="a" operator="in" result="b3"/>');
    body = 'b3';
  }

  const o = t.outline, w = o.width * s;
  const under = [];
  let outer = 'a';
  if (sprite && (o.style === 'solid' || o.style === 'double')) {
    p.push(`<feMorphology in="a" operator="dilate" radius="${r2(w)}" result="od1"/>`,
      `<feFlood flood-color="${col(o.color)}"/>`, '<feComposite in2="od1" operator="in" result="ol1"/>');
    outer = 'od1';
    if (o.style === 'double') {
      p.push(`<feMorphology in="a" operator="dilate" radius="${r2(w * 2.2)}" result="od2"/>`,
        `<feFlood flood-color="${col(o.color2)}"/>`, '<feComposite in2="od2" operator="in" result="ol2"/>');
      under.push('ol2'); outer = 'od2';
    }
    under.push('ol1');
  } else if (sprite && o.style === 'glow') {
    p.push(`<feMorphology in="a" operator="dilate" radius="${r2(w)}" result="gd"/>`,
      '<feComposite in="gd" in2="a" operator="out" result="gring"/>',
      `<feFlood flood-color="${col(o.color)}"/>`, '<feComposite in2="gring" operator="in" result="gcol"/>',
      `<feGaussianBlur in="gcol" stdDeviation="${r2(w * 1.4)}" result="gwide"/>`,
      `<feFlood flood-color="${col(o.color2)}" flood-opacity="0.9"/>`, '<feComposite in2="gring" operator="in" result="gcore"/>',
      `<feGaussianBlur in="gcore" stdDeviation="${r2(w * 0.18)}" result="gcore2"/>`);
    under.push('gwide', 'gwide', 'gcol', 'gcore2');
    outer = 'gd';
  } else if (sprite && o.style === 'inner') {
    p.push(`<feMorphology in="a" operator="erode" radius="${r2(w)}" result="ie"/>`,
      '<feComposite in="a" in2="ie" operator="out" result="iring"/>',
      `<feFlood flood-color="${col(o.color)}"/>`, '<feComposite in2="iring" operator="in" result="icol"/>',
      `<feComposite in="icol" in2="${body}" operator="over" result="b5"/>`);
    body = 'b5';
  }

  const sh = t.shadow, sd = sh.distance * s, shadow = [];
  const sx = r2(-L[0] * sd), sy = r2(-L[1] * sd);
  const flood = `<feFlood flood-color="${col(sh.color)}" flood-opacity="${sh.opacity}"/>`;
  if (sh.style === 'offset' || sh.style === 'drop') {
    p.push(`<feOffset in="${outer}" dx="${sx}" dy="${sy}" result="so"/>`);
    let src = 'so';
    if (sh.style === 'drop') { p.push(`<feGaussianBlur in="so" stdDeviation="${r2(sh.blur * s)}" result="sob"/>`); src = 'sob'; }
    p.push(flood, `<feComposite in2="${src}" operator="in" result="shd"/>`);
    shadow.push('shd');
  } else if (sh.style === 'long') {
    const steps = 8;
    for (let i = 1; i <= steps; i++) p.push(`<feOffset in="${outer}" dx="${r2(sx * i / 2)}" dy="${r2(sy * i / 2)}" result="lo${i}"/>`);
    p.push('<feMerge result="lom">' + Array.from({ length: steps }, (_, i) => `<feMergeNode in="lo${i + 1}"/>`).join('') + '</feMerge>',
      flood, '<feComposite in2="lom" operator="in" result="shd"/>');
    shadow.push('shd');
  } else if (sh.style === 'glow') {
    p.push(`<feGaussianBlur in="${outer}" stdDeviation="${r2(sh.blur * s)}" result="sgb"/>`, flood, '<feComposite in2="sgb" operator="in" result="shd"/>');
    shadow.push('shd', 'shd');
  }

  p.push('<feMerge>' + [...shadow, ...under, body].map((n) => `<feMergeNode in="${n}"/>`).join('') + '</feMerge>');
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB">${p.join('')}</filter>`;
}

// Regular pattern textures (halftone, hatch, scanline) are drawn as an overlay masked to the art.
function patternTexture(prefix, t, { W, H, s, pal }, artRef) {
  const k = t.texture;
  if (!['halftone', 'hatch', 'scanline'].includes(k.style)) return { defs: '', overlay: '' };
  const gap = k.size * s, color = pal[k.color] ?? pal.ink;
  let tile;
  if (k.style === 'halftone') tile = `<circle cx="${r2(gap / 2)}" cy="${r2(gap / 2)}" r="${r2(gap * 0.28)}" fill="${color}"/>`;
  else if (k.style === 'hatch') tile = `<rect x="0" y="0" width="${r2(gap)}" height="${r2(Math.max(0.8 * s, gap * 0.22))}" fill="${color}"/>`;
  else tile = `<rect x="0" y="0" width="${r2(gap)}" height="${r2(Math.max(0.8 * s, gap * 0.4))}" fill="${color}"/>`;
  const rot = k.style === 'hatch' ? ' patternTransform="rotate(45)"' : '';
  let defs = `<pattern id="${prefix}-pat" patternUnits="userSpaceOnUse" width="${r2(gap)}" height="${r2(gap)}"${rot}>${tile}</pattern>`;
  let mask = '';
  if (artRef) {
    defs += `<filter id="${prefix}-white" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/></filter>` +
      `<mask id="${prefix}-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><use href="#${artRef}" filter="url(#${prefix}-white)"/></mask>`;
    mask = ` mask="url(#${prefix}-mask)"`;
  }
  return { defs, overlay: `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#${prefix}-pat)" opacity="${k.amount}"${mask}/>` };
}

/**
 * Compile one asset. role: {id, width, height, kind: 'sprite'|'backdrop', play: on-screen width in
 * px, baseline?: y in viewBox units where the sprite meets the ground}.
 * Returns the finished SVG string.
 */
export function compileAsset(svg, spec, role) {
  const { inner, viewBox } = parseSvg(svg);
  const W = viewBox?.w ?? role.width, H = viewBox?.h ?? role.height;
  const s = W / (role.play ?? W);
  const pal = spec.palette, L = lightVector(spec.light);
  const prefix = `sk-${role.id}`;
  const body = resolveTokens(inner, pal);
  const sprite = role.kind !== 'backdrop';
  const t = sprite ? spec.sprite : spec.backdrop;
  const ctx = { W, H, s, L, pal, sprite };
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;

  if (sprite) {
    const fx = effectFilter(`${prefix}-fx`, t, ctx);
    const tex = patternTexture(prefix, t, ctx, `${prefix}-art`);
    let contact = '', contactDefs = '';
    if (t.shadow.style === 'contact') {
      const base = role.baseline ?? H * 0.9;
      contactDefs = `<filter id="${prefix}-cb" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="${r2(Math.max(1.5, t.shadow.blur) * s)}"/></filter>`;
      contact = `<ellipse cx="${W / 2}" cy="${r2(base)}" rx="${r2(W * 0.36)}" ry="${r2(Math.max(2 * s, H * 0.045))}" fill="${pal[t.shadow.color] ?? pal.ink}" opacity="${t.shadow.opacity}" filter="url(#${prefix}-cb)"/>`;
    }
    return head + `<defs>${fx}${tex.defs}${contactDefs}</defs>${contact}` +
      `<g filter="url(#${prefix}-fx)"><g id="${prefix}-art">${body}</g></g>${tex.overlay}</svg>`;
  }

  // Backdrop: each top-level element is a depth layer and gets the layer filter, so paper layers
  // cast shadows on the layers behind them, clay layers each get rounded, and so on.
  const fx = effectFilter(`${prefix}-fx`, t, ctx);
  const tex = patternTexture(prefix, t, ctx, null);
  const layers = topLevel(body).map((el) => /^<(defs|linearGradient|radialGradient|filter|pattern|clipPath|mask|style)\b/.test(el) ? el : `<g filter="url(#${prefix}-fx)">${el}</g>`);
  return head + `<defs>${fx}${tex.defs}</defs>${layers.join('')}${tex.overlay}</svg>`;
}

export function compilePack(pack, spec, roles) {
  const out = {};
  for (const role of roles) if (pack[role.id]) out[role.id] = compileAsset(pack[role.id], spec, role);
  return out;
}
