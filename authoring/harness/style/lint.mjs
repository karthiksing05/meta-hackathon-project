// Checks and fixers for Muse's raw drawings, measured against Muse's own style spec rather than a
// fixed look. Static checks run on the markup; rendered checks (padding, contrast at play size,
// quiet protected zones) come back from render.mjs and are merged by `report`.

import { tokenTable, parseSvg, topLevel } from './compile.mjs';

const COLOR_VALUE = /\b(fill|stroke|stop-color|flood-color)\s*(=\s*"|:\s*)([^";]+)/g;

function hexToRgb(hex) {
  const h = hex.length === 4 ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex;
  const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

// Snap every off-palette color to the nearest role token. Returns {svg, changes}.
export function snapColors(svg, palette) {
  const table = tokenTable(palette), entries = Object.entries(table);
  const changes = [];
  const out = svg.replace(COLOR_VALUE, (m, attr, sep, value) => {
    const v = value.trim();
    if (table[v] || v === 'none' || v === 'transparent' || v.startsWith('url(') || v === 'currentColor') return m;
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) { changes.push(`${attr} "${v}" → ink`); return m.replace(value, 'ink'); }
    const rgb = hexToRgb(v);
    let best = entries[0];
    for (const e of entries) if (dist(hexToRgb(e[1]), rgb) < dist(hexToRgb(best[1]), rgb)) best = e;
    changes.push(`${attr} ${v} → ${best[0]} (off by ${Math.round(dist(hexToRgb(best[1]), rgb))})`);
    return m.replace(value, best[0]);
  });
  return { svg: out, changes };
}

// Static checks on one raw drawing.
export function lintDrawing(svg, spec, role) {
  const issues = [];
  let parsed;
  try { parsed = parseSvg(svg); } catch { return [{ level: 'error', check: 'parse', message: 'is not a single <svg> element' }]; }
  const vb = parsed.viewBox;
  if (!vb || vb.x !== 0 || vb.y !== 0 || vb.w !== role.width || vb.h !== role.height)
    issues.push({ level: 'error', check: 'viewBox', message: `viewBox must be "0 0 ${role.width} ${role.height}"` });
  const bytes = Buffer.byteLength(svg);
  const budget = role.kind === 'backdrop' ? 12288 : 6144;
  if (bytes > budget) issues.push({ level: 'warn', check: 'bytes', message: `${Math.round(bytes / 1024)} KB; aim for under ${budget / 1024} KB` });
  for (const bad of ['<text', '<image', '<script', '<foreignObject', '<animate', '<filter', '<style']) {
    if (svg.includes(bad)) issues.push({ level: bad === '<filter' || bad === '<style' ? 'warn' : 'error', check: 'elements', message: `uses ${bad}>; ${bad === '<filter' ? 'the compiler adds all effects' : 'draw with shapes only'}` });
  }
  const table = tokenTable(spec.palette);
  const off = new Set();
  for (const m of svg.matchAll(COLOR_VALUE)) {
    const v = m[3].trim();
    if (!table[v] && !['none', 'transparent', 'currentColor'].includes(v) && !v.startsWith('url(')) off.add(v);
  }
  if (off.size) issues.push({ level: 'fix', check: 'palette', message: `colors outside the palette roles: ${[...off].slice(0, 6).join(', ')}` });
  // Muse's own strokes must survive play size; outer outlines belong to the compiler.
  const s = role.width / (role.play ?? role.width);
  for (const m of svg.matchAll(/stroke-width\s*(?:=\s*"|:\s*)([0-9.]+)/g)) {
    const px = Number(m[1]) / s;
    if (px < 1.2) { issues.push({ level: 'warn', check: 'stroke', message: `a ${m[1]}-unit stroke is ${px.toFixed(1)} px on screen; use at least ${(1.2 * s).toFixed(1)} units or drop it` }); break; }
  }
  if (role.kind !== 'backdrop' && spec.sprite.outline.style !== 'none' && /stroke\s*=\s*"ink"/.test(svg) && (svg.match(/stroke\s*=\s*"ink"/g) ?? []).length > 3)
    issues.push({ level: 'warn', check: 'outline', message: 'draws its own ink outlines; the style already adds them' });
  if (role.kind === 'backdrop') {
    const layers = topLevel(parsed.inner).filter((el) => el.startsWith('<g')).length;
    if (layers < 2) issues.push({ level: 'warn', check: 'layers', message: 'group the backdrop into top-level <g> depth layers (back to front) so each layer gets the style' });
  }
  return issues;
}

// Thresholds for the rendered metrics from render.mjs.
export function lintRendered(metrics, roles) {
  const issues = [];
  for (const role of roles) {
    const m = metrics.assets?.[role.id];
    if (!m) continue;
    if (role.kind !== 'backdrop') {
      const g = role.gutter ?? 4;
      if (m.bbox && (m.bbox.x0 < g - 0.5 || m.bbox.y0 < g - 0.5 || m.bbox.x1 > role.width - g + 0.5 || m.bbox.y1 > role.height - g + 0.5))
        issues.push({ role: role.id, level: 'warn', check: 'padding', message: `art reaches the edge (bbox ${m.bbox.x0},${m.bbox.y0}–${m.bbox.x1},${m.bbox.y1}); keep a ${g}px gutter` });
      if (m.coverage < 0.15) issues.push({ role: role.id, level: 'warn', check: 'mass', message: `only ${Math.round(m.coverage * 100)}% of the box is filled; thin shapes vanish at play size` });
      if (m.contrast !== undefined && m.contrast < 1.8) issues.push({ role: role.id, level: 'warn', check: 'contrast', message: `edge contrast against the backdrop is ${m.contrast.toFixed(2)}:1 at play size; aim for 1.8:1+` });
    }
  }
  for (const z of metrics.zones ?? []) {
    if (z.spread > 2.2) issues.push({ role: 'backdrop', level: 'warn', check: 'zone', message: `"${z.purpose}" zone has a high-contrast shape in it (${z.spread.toFixed(1)}:1 between its lightest and darkest parts, aim under 2.2:1); keep y${z.y}–${z.y + z.h} to one quiet tone` });
    if (z.busy > 0.11) issues.push({ role: 'backdrop', level: 'warn', check: 'zone', message: `"${z.purpose}" zone is busy (edge density ${z.busy.toFixed(2)}, aim under 0.11); move detail out of y${z.y}–${z.y + z.h}` });
  }
  return issues;
}
