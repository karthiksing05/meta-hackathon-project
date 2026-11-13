// Cable Car Catch as a style test bed: asset roles, the fixed composition (Codex's layout), the
// game brief, and the stand-ins for what the game renderer draws. All art and every style spec
// come from Muse; nothing here is drawn by hand.

export const roles = [
  { id: 'backdrop', kind: 'backdrop', width: 360, height: 640, play: 360 },
  { id: 'car', kind: 'sprite', width: 96, height: 72, play: 96, baseline: 64, gutter: 4, purpose: 'red cable car, side view, wheels on the rail' },
  { id: 'marker', kind: 'sprite', width: 64, height: 64, play: 34, gutter: 4, purpose: 'station lantern that marks where to stop' },
];

export const zones = [
  { x: 16, y: 16, w: 328, h: 92, purpose: 'score and streak' },
  { x: 0, y: 212, w: 360, h: 150, purpose: 'timing band behind the track' },
  { x: 40, y: 485, w: 280, h: 65, purpose: 'tap button' },
];

export function scene(palette) {
  return {
    width: 360, height: 640, zones, showZones: false,
    standins: [
      { type: 'text', text: 'SCORE 12', x: 24, y: 62, size: 22, color: palette.ink, alt: palette.surface },
      { type: 'text', text: 'STREAK ×3', x: 336, y: 62, size: 15, align: 'right', color: palette.ink, alt: palette.surface },
      { type: 'beam', x: 250, y1: 244, y2: 364, w: 44, color: palette.tertiary ?? palette.accent },
      { type: 'line', x1: 0, y1: 278, x2: 360, y2: 278, width: 2, color: palette.ink },
      { type: 'line', x1: 0, y1: 366, x2: 360, y2: 366, width: 5, color: palette.ink },
      { type: 'pill', x: 196, y: 214, w: 108, h: 28, fill: palette.ink, text: 'POWELL ST', size: 13, color: palette.surface },
      { type: 'pill', x: 40, y: 485, w: 280, h: 62, fill: palette.ink, text: 'TAP TO STOP', size: 20, color: palette.surface, swap: true },
    ],
    place: [
      { role: 'car', x: 118, y: 332, w: 96 },
      { role: 'marker', x: 250, y: 278, w: 34 },
    ],
  };
}

export const paletteRoles = ['ink', 'surface', 'accent', 'secondary', 'tertiary', 'sky'];
export const brief = 'Cable Car Catch, a one-thumb timing game on a 360×640 portrait phone screen. A San Francisco cable car glides left and right along a rail under a cable. A station lantern and a street label mark the stop; tap to stop the car under it. The player scores for close stops and builds a streak.';
export const composition = 'HUD (score, streak) y24–100. Street label y214–242 and lantern on the cable at y278 near x250. Cable y278, car center y332, rail y366. Tap button y485–550. Keep y210–366 behind the track calm and low-contrast (sky only, maybe very faint shapes). Distant hills and skyline y130–212; near city blocks mainly y370–470; ground below y470 plain enough for a dark button on top. The car is the only object in the accent color.';
