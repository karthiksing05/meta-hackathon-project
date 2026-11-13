// Gold: Pop Mart Labubu Blind Box Set (Prod key s3), rebuilt on its art direction (s3.direction.json).
// Rules, state, inputs and every handler are the Prod game's; the presentation and the art are new:
// a shop-counter stage (the blind box, then the figure it held), a name plaque above it, the
// collection book on a candy panel below, one HUD plaque (tokens, points, figures) and an end card.
//
// Layout on the tall canvas (safe area y 110–684): HUD 114–166 · name plaque 182–244 · stage (the
// backdrop's counter top is at y 442) · collection panel 462–684.

import { artAssets, frame, text } from '../build.mjs';

export function build(game, art) {
  const g = JSON.parse(JSON.stringify(game));
  // Assets: the old ones go (backdrop, blind_box, book_slot, labubu); the new art comes in.
  const T = (step, value, props) => text(art, step, value, props);
  const fig = (idx) => `= 'f' + str(${idx})`;
  const stageY = 452; // feet on the counter
  const boxX = '= if last_idx < 0 then 105.0 else 30.0';

  const hud = {
    node: 'group', fixed: true, children: [
      frame(art, 'banner', 16, 114, 328, 52),
      { node: 'image', asset: 'token', x: 34, y: 123, w: 34, h: 34 },
      T('title', '= str(trade_tokens)', { numerals: true, x: 74, y: 120, w: 44, h: 40, align: 'left', valign: 'middle' }),
      T('title', "= str(score) + ' pts'", { numerals: true, x: 115, y: 120, w: 130, h: 40, align: 'center', valign: 'middle', animate_on: { opened_new: { prop: 'scale', keys: [1, 1.18, 1], ms: 220, ease: 'out' } } }),
      { node: 'image', asset: 'f0', x: 256, y: 121, w: 25, h: 38 },
      T('title', "= str(figures_collected) + '/9'", { numerals: true, x: 282, y: 120, w: 52, h: 40, align: 'left', valign: 'middle' }),
    ],
  };

  const namePlaque = {
    node: 'group', children: [
      frame(art, 'banner', 32, 180, 296, 76),
      T('title', "= if last_idx < 0 then 'Labubu blind box' else last_name()", { x: 52, y: 189, w: 256, h: 28, align: 'center', valign: 'middle', color: "= if last_idx == 8 then $primary_ink else $ink" }),
      T('caption', '= message', { x: 56, y: 219, w: 248, h: 30, align: 'center', valign: 'middle', wrap: true, color: '$ink_muted' }),
    ],
  };

  const stage = {
    node: 'group', children: [
      // The box: centred until the first opening, then it steps left to make room for the figure.
      {
        node: 'group', x: boxX, y: stageY - 166, transition: { x: { ms: 320, ease: 'out' } },
        animate_on: { tap_box: { prop: 'scale', keys: [1, 0.93, 1.05, 1], ms: 260, ease: 'out' } },
        children: [
          { node: 'image', asset: 'box', x: 0, y: 0, w: 150, h: 166, opacity: '= if boxes_left > 0 then 1.0 else 0.45', transition: { opacity: { ms: 300, ease: 'out' } } },
          { node: 'rect', x: 0, y: 0, w: 150, h: 166, radius: 18, fill: '#00000000', on_tap: { input: 'tap_box', with: {} } },
          frame(art, 'badge', 112, -10, 48, 44),
          T('label', '= str(boxes_left)', { numerals: true, x: 112, y: -10, w: 48, h: 44, align: 'center', valign: 'middle' }),
        ],
      },
      // The figure it held.
      {
        node: 'group', visible: '= last_idx >= 0', x: 206, y: stageY - 156,
        animate_on: { box_opened: { prop: 'scale', keys: [0.5, 1.1, 1], ms: 360, ease: 'out' }, traded: { prop: 'scale', keys: [0.5, 1.1, 1], ms: 360, ease: 'out' } },
        children: [{ node: 'image', asset: fig('max(0, last_idx)'), x: 0, y: 0, w: 102, h: 156 }],
      },
    ],
  };

  const cell = 52, gap = 8, gridW = cell * 3 + gap * 2;
  const book = {
    node: 'group', children: [
      frame(art, 'panel', 24, 462, 312, 222),
      T('label', 'Collection book', { x: 40, y: 474, w: 280, h: 22, align: 'center', valign: 'middle', color: '$ink_muted' }),
      {
        node: 'grid', cols: 3, rows: 3, cell_size: cell, gap, x: 180 - gridW / 2, y: 500,
        cell: {
          node: 'group',
          animate_on: { tap_cell: { when: 'event.cell == cell', prop: 'scale', keys: [1, 0.9, 1.05, 1], ms: 170 } },
          children: [
            { node: 'image', asset: 'slot', x: 0, y: 0, w: cell, h: cell },
            // Collected: the figure. Missing: its faint silhouette, a little stronger when a trade is possible.
            { node: 'image', asset: fig('cell.y * 3 + cell.x'), x: 11, y: 4, w: 30, h: 44, opacity: '= if get_or(collected, cell.y * 3 + cell.x, false) then 1.0 else if trade_tokens >= 3 then 0.42 else 0.16', transition: { opacity: { ms: 280, ease: 'out' } } },
            { node: 'rect', x: 0, y: 0, w: cell, h: cell, radius: 10, fill: '#00000000', on_tap: { input: 'tap_cell', with: { cell: 'cell' } } },
          ],
        },
      },
    ],
  };

  const endCard = {
    node: 'group', visible: "= status != 'playing'",
    animate_on: { win: { prop: 'scale', keys: [0.85, 1.03, 1], ms: 380, ease: 'out' }, lose: { prop: 'scale', keys: [0.85, 1.03, 1], ms: 380, ease: 'out' } },
    children: [
      { node: 'rect', x: -40, y: -40, w: 440, h: 860, fill: '#3B1E2C8C' },
      frame(art, 'panel', 36, 196, 288, 380),
      T('title', "= if status == 'won' then 'Full set!' else 'Out of boxes'", { x: 56, y: 218, w: 248, h: 34, align: 'center', valign: 'middle', color: '$primary_ink' }),
      { node: 'image', asset: "= if status == 'won' then 'f8' else 'f' + str(max(0, last_idx))", x: 141, y: 258, w: 78, h: 120 },
      T('hero', '= str(score)', { numerals: true, x: 56, y: 384, w: 248, h: 60, align: 'center', valign: 'middle' }),
      T('label', 'points', { x: 56, y: 442, w: 248, h: 20, align: 'center', valign: 'middle', color: '$ink_muted' }),
      T('body', "= str(figures_collected) + ' of 9 figures'", { x: 56, y: 470, w: 248, h: 26, align: 'center', valign: 'middle' }),
      T('caption', "= get_or(content_end_lines, min(4, figures_collected / 2), '')", { x: 60, y: 502, w: 240, h: 60, align: 'center', valign: 'top', wrap: true, color: '$ink_muted' }),
    ],
  };

  const playing = { node: 'group', visible: "= status == 'playing'", children: [book, stage, namePlaque] };
  g.presentation = {
    ...g.presentation,
    canvas: { w: 360, h: 780, background: '$bg' },
    tokens: { ...art.kit.palette, plate: art.kit.palette.surface, plate_solid: art.kit.palette.surface },
    root: { node: 'group', children: [{ node: 'image', asset: 'backdrop', x: 0, y: 0, w: 360, h: 780 }, playing, hud, endCard] },
    feedback: (g.presentation.feedback ?? []).map((f) => ({
      ...f,
      do: f.do.map((d) => (d.particles ? { particles: { ...d.particles, y: f.on === 'traded' ? 580 : f.on === 'win' ? 380 : 380, x: f.on === 'opened_new' || f.on === 'opened_dup' || f.on === 'secret_found' ? 262 : 180, color: d.particles.color === '#FF8FB8' ? '$primary' : d.particles.color === '#7AC7A8' ? '$accent' : d.particles.color } } : d)),
    })),
  };
  // Assets last (frame() bakes each frame it draws): the old pictures go, the new art comes in.
  g.assets = { ...Object.fromEntries(Object.entries(g.assets ?? {}).filter(([, a]) => a.sound)), ...artAssets(art) };
  return g;
}
