// Canvas sizes and the bands of a tall canvas (SPEC 2.2, "Canvas"; docs/BUBBLES.md 4.6, "Filling the screen").
//
// Phones are about 19.5:9, so a 360 × 640 (9:16) game leaves bands around it. The tall canvas is 360 × 780.
// Its top 110 and bottom 96 units run under the player's top and bottom bars on a phone: background only.
// Key content (taps, the HUD, text) stays in the safe area between them, y 110 to 684, and the HUD sits at
// the top of that area. The runtime kit (bubble-kit-microgame.js) uses the same fractions to fit the safe
// area inside the bars and let the rest reach the screen's edges. The game world never depends on the
// device, so replays are the same everywhere.

export const LEGACY_CANVAS = Object.freeze({ w: 360, h: 640 });
export const TALL_CANVAS = Object.freeze({ w: 360, h: 780 });
export const SAFE_TOP = 110 / 780;
export const SAFE_BOTTOM = 96 / 780;

/** True for canvases taller than 9:16 (the runtime then fits the safe area, not the whole canvas). */
export function isTall(canvas) {
  return canvas.h * LEGACY_CANVAS.w > canvas.w * LEGACY_CANVAS.h * 1.02;
}

/** The safe area's top and bottom in canvas units (the whole canvas when it isn't tall). */
export function safeArea(canvas) {
  if (!isTall(canvas)) return { y0: 0, y1: canvas.h };
  return { y0: Math.round(canvas.h * SAFE_TOP), y1: Math.round(canvas.h * (1 - SAFE_BOTTOM)) };
}

/**
 * The canvas a game gets: `requested` ("tall", "legacy" or {w, h}) when valid, else the look's, else
 * 360 × 640. Widths stay 360 so a game's x coordinates read the same at every size.
 */
export function pickCanvas(requested, look) {
  if (requested === 'tall') return { ...TALL_CANVAS };
  if (requested === 'legacy') return { ...LEGACY_CANVAS };
  const ok = (c) => c && Number.isFinite(c.w) && Number.isFinite(c.h) && c.w === 360 && c.h >= 480 && c.h <= 900;
  if (ok(requested)) return { w: requested.w, h: Math.round(requested.h) };
  if (ok(look?.canvas)) return { w: look.canvas.w, h: look.canvas.h };
  return { ...LEGACY_CANVAS };
}

const slotOf = (node) => (node?.children ?? []).find((c) => c?.slot)?.slot;

/**
 * A look's layout (written for 360 × 640) moved onto `canvas`: on a tall canvas the hud_top stack moves to
 * the top of the safe area and hud_bottom to its bottom, keeping their distance from the edge they hug.
 * Other nodes are untouched. Returns a new layout.
 */
export function fitLayout(layout, canvas) {
  if (!layout || !isTall(canvas)) return layout;
  const safe = safeArea(canvas);
  const out = JSON.parse(JSON.stringify(layout));
  for (const node of out.children ?? []) {
    const slot = slotOf(node);
    if (typeof node.y !== 'number') continue;
    if (slot === 'hud_top') node.y = safe.y0 + Math.max(0, node.y - 24);
    else if (slot === 'hud_bottom') node.y = safe.y1 - Math.max(0, LEGACY_CANVAS.h - node.y);
  }
  return out;
}
