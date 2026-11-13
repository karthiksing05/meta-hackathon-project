// Gold v2: Pop Mart Labubu Blind Box Set (Prod key s3, ab3696f4592af6b849ddc97b). Unseeded, so the loop
// is rebuilt as well as the look.
//
// The Prod loop was pure luck: tap one box 14 times and hope (the five gate bots all scored the same).
// The new loop is a shelf hunt, the collector's trick of reading the box before you buy:
//   - a shelf of three boxes restocks every few seconds; most boxes show a peek of the figure inside
//     on their tag, some are mystery boxes (a "?" tag): the only place the golden secret hides, so a full
//     set means a gamble;
//   - tap a box to open it (11 boxes in all): a new figure goes in the collection book (+10), a
//     duplicate becomes a trade token (+2); four tokens trade for any missing silhouette;
//   - the shelf restocks faster as you open more (3.2 s down to 1.5 s) and mystery boxes get commoner,
//     so the stakes rise; finish the set before 75 s or the boxes run out; boxes left are a bonus.
// Skill shows: reading the tags and picking the missing figure fast. Art: the s3 run (9 Labubus, box,
// slot, token, candy frames, backdrop) plus the lettered wordmark, all muse-image-1.0.

import { artAssets, frame, text, wordmark } from '../build.mjs';

const FIGURES = ['Coco Labubu', 'Berry Labubu', 'Mint Labubu', 'Lilac Labubu', 'Peach Labubu', 'Sky Labubu', 'Rose Labubu', 'Coral Labubu', 'Golden Labubu'];
const q = (xs) => `[${xs.map((x) => `'${x.replace(/'/g, "\\'")}'`).join(', ')}]`;

/** One box's figure: the golden secret hides only in mystery boxes; the two rares are next. */
const roll = (r, myst) => `if ${myst} then (if ${r} <= 18 then 8 else ${r} % 8) else if ${r} <= 22 then 6 + ${r} % 2 else ${r} % 6`;

function rules(prod) {
  return {
    format: 'microgame/0.2',
    meta: { title: prod.meta.title, instructions: 'A shelf of three blind boxes restocks every few seconds. Read the peek on each tag and tap the box holding a figure you still need; the golden secret hides only in ? boxes. Duplicates become trade tokens; 4 tokens trade for any missing figure. Collect all 9 before 75 s or your 11 boxes run out.', duration_s: 75 },
    state: {
      shelf: { type: 'list<int>', init: '[0, 1, 2]' },
      mystery: { type: 'list<bool>', init: '[false, false, false]' },
      picked: { type: 'int', init: '-1' },
      locked: { type: 'bool', init: 'true' },
      boxes_left: { type: 'int', init: '11' },
      opened: { type: 'int', init: '0' },
      collected: { type: 'list<bool>', init: '[false, false, false, false, false, false, false, false, false]' },
      trade_tokens: { type: 'int', init: '0' },
      figures_collected: { type: 'int', init: '0' },
      score: { type: 'int', init: '0' },
      last_idx: { type: 'int', init: '-1' },
      last_new: { type: 'bool', init: 'false' },
      message: { type: 'string', init: "'Read the tags. Tap a box you need!'" },
      shelf__serial: { type: 'int', init: '0' },
      shelf__until: { type: 'int', init: '0' },
      pace_ms: { type: 'int', init: '3200' },
      content_figures: { type: 'list<string>', init: q(FIGURES) },
      content_end_lines: { type: 'list<string>', init: q(['One lonely silhouette left in the book. So close!', 'A cosy little shelf: a few Labubu still hiding in boxes.', 'Nearly there! One good trade could finish this set.', 'What a shelf! Just the trickiest ears left to find.', 'FULL SET ENERGY. Every Labubu home, secret figure included!']) },
    },
    functions: {
      last_name: { params: {}, returns: 'string', body: "if last_idx < 0 then 'Labubu blind boxes' else get_or(content_figures, last_idx, '')" },
      need: { params: { s: 'int' }, returns: 'bool', body: 'not get_or(collected, get_or(shelf, s, 0), true)' },
    },
    events: { restock: {}, shelf__timeout: { serial: 'int' }, box_opened: { slot: 'int' }, opened_new: {}, opened_dup: {}, traded: {}, secret_found: {} },
    inputs: { tap_box: { payload: { slot: 'int' } }, tap_cell: { payload: { cell: 'ivec2' } } },
    rules: [
      { id: 'shelf__first', on: 'start', do: [{ emit: 'restock' }] },
      {
        id: 'shelf__restock', on: 'restock', when: 'boxes_left > 0 and figures_collected < 9', do: [
          { let: { mp: 'min(45, 10 + opened * 4)' } },
          { let: { m0: 'random_int(1, 100) <= mp', m1: 'random_int(1, 100) <= mp', m2: 'random_int(1, 100) <= mp' } },
          { let: { r0: 'random_int(1, 100)', r1: 'random_int(1, 100)', r2: 'random_int(1, 100)' } },
          { set: 'mystery', to: '[m0, m1, m2]' },
          { set: 'shelf', to: `[${roll('r0', 'm0')}, ${roll('r1', 'm1')}, ${roll('r2', 'm2')}]` },
          { set: 'picked', to: '-1' },
          { set: 'locked', to: 'false' },
          { incr: 'shelf__serial' },
          { set: 'pace_ms', to: 'max(1500, 3200 - opened * 100)' },
          { set: 'shelf__until', to: 'now + pace_ms' },
          { after: 'pace_ms', emit: 'shelf__timeout', with: { serial: 'shelf__serial' }, id: 'shelf__t_clock' },
        ],
      },
      { id: 'shelf__rotate', on: 'shelf__timeout', when: 'not locked and event.serial == shelf__serial', do: [{ set: 'locked', to: 'true' }, { emit: 'restock' }] },
      {
        id: 'open_box', on: 'tap_box', when: 'not locked and boxes_left > 0 and figures_collected < 9 and event.slot >= 0 and event.slot < 3', do: [
          { let: { idx: 'get_or(shelf, event.slot, 0)' } },
          { set: 'locked', to: 'true' },
          { set: 'picked', to: 'event.slot' },
          { decr: 'boxes_left' },
          { incr: 'opened' },
          { set: 'last_idx', to: 'idx' },
          { emit: 'box_opened', with: { slot: 'event.slot' } },
          {
            if: 'get_or(collected, idx, false)',
            then: [{ set: 'last_new', to: 'false' }, { incr: 'trade_tokens' }, { incr: 'score', by: '2' }, { set: 'message', to: "'Duplicate! It became a trade token.'" }, { emit: 'opened_dup' }],
            else: [
              { set: 'last_new', to: 'true' }, { set: 'collected', to: 'set_at(collected, idx, true)' }, { incr: 'figures_collected' }, { incr: 'score', by: '10' },
              { set: 'message', to: "if idx == 8 then 'THE SECRET FIGURE! Golden ears!' else 'New Labubu! Into the book.'" }, { emit: 'opened_new' },
              { if: 'idx == 8', then: [{ emit: 'secret_found' }] },
            ],
          },
          { if: 'figures_collected >= 9', then: [{ incr: 'score', by: 'boxes_left * 5' }] },
          { after: '750ms', emit: 'restock', id: 'shelf__t_reveal' },
        ],
      },
      {
        id: 'trade_slot', on: 'tap_cell', when: 'trade_tokens >= 4 and figures_collected < 9', do: [
          { let: { idx: 'event.cell.y * 3 + event.cell.x' } },
          {
            if: 'not get_or(collected, idx, false)', then: [
              { set: 'collected', to: 'set_at(collected, idx, true)' }, { decr: 'trade_tokens', by: '4' }, { incr: 'figures_collected' }, { incr: 'score', by: '10' },
              { set: 'last_idx', to: 'idx' }, { set: 'last_new', to: 'true' }, { set: 'message', to: "'Trade done! Swapped 4 tokens for it.'" }, { emit: 'traded' },
              { if: 'figures_collected >= 9', then: [{ incr: 'score', by: 'boxes_left * 5' }] },
            ],
          },
        ],
      },
    ],
    objectives: { win: 'figures_collected >= 9', lose: 'boxes_left <= 0 and figures_collected < 9 and trade_tokens < 4', score: 'score', time_limit: '75s', on_timeout: 'lose' },
  };
}

export function build(prod, art) {
  const g = rules(prod);
  const T = (step, value, props) => text(art, step, value, props);
  const fig = (idx) => `= 'f' + str(${idx})`;

  const hud = {
    node: 'group', children: [
      frame(art, 'banner', 14, 112, 332, 56),
      { node: 'image', asset: 'token', x: 30, y: 123, w: 34, h: 34 },
      T('title', '= str(trade_tokens)', { numerals: true, x: 68, y: 120, w: 34, h: 40, align: 'left', valign: 'middle' }),
      T('title', '= str(score)', { numerals: true, x: 104, y: 120, w: 76, h: 40, align: 'center', valign: 'middle', animate_on: { opened_new: { prop: 'scale', keys: [1, 1.12, 1], ms: 220, ease: 'out' } } }),
      { node: 'image', asset: 'box', x: 186, y: 122, w: 32, h: 36 },
      T('title', '= str(boxes_left)', { numerals: true, x: 220, y: 120, w: 40, h: 40, align: 'left', valign: 'middle' }),
      { node: 'image', asset: 'f0', x: 266, y: 121, w: 25, h: 38 },
      T('title', "= str(figures_collected) + '/9'", { numerals: true, x: 292, y: 120, w: 48, h: 40, align: 'left', valign: 'middle' }),
    ],
  };

  const plaque = {
    node: 'group', children: [
      frame(art, 'banner', 30, 176, 300, 64),
      T('title', '= last_name()', { x: 46, y: 182, w: 268, h: 26, align: 'center', valign: 'middle', color: '= if last_idx == 8 then $primary_ink else $ink' }),
      T('caption', '= message', { x: 46, y: 208, w: 268, h: 24, align: 'center', valign: 'middle', color: '$ink_muted' }),
    ],
  };

  // The shelf: three boxes, each with a peek tag; the picked one opens into its figure.
  const shelf = {
    node: 'repeat', source: 'range(3)', as: 's', key: 's',
    template: {
      node: 'group', x: '= 18 + s * 110', y: 262,
      animate_on: { restock: { prop: 'scale', keys: [0.94, 1.02, 1], ms: 220, ease: 'out' }, tap_box: { when: 'event.slot == s', prop: 'scale', keys: [1, 0.94, 1], ms: 160 } },
      children: [
        { node: 'image', asset: 'box', x: 4, y: 20, w: 94, h: 104, opacity: '= if picked == s then 0.0 else 1.0', transition: { opacity: { ms: 160, ease: 'out' } } },
        { node: 'image', asset: fig('get_or(shelf, s, 0)'), x: 18, y: 4, w: 70, h: 108, visible: '= picked == s', animate_on: { box_opened: { when: 'event.slot == s', prop: 'scale', keys: [0.6, 1.08, 1], ms: 300, ease: 'out' } } },
        // The tag: a peek at the figure, or a mystery mark; a missing figure's tag glows.
        frame(art, 'badge', 20, 122, 62, 62, { visible: '= picked != s' }),
        { node: 'image', asset: fig('get_or(shelf, s, 0)'), x: 34, y: 127, w: 34, h: 52, visible: '= picked != s and not get_or(mystery, s, false)', opacity: '= if need(s) then 1.0 else 0.4' },
        T('display', '?', { x: 20, y: 122, w: 62, h: 62, align: 'center', valign: 'middle', color: '$ink', visible: '= picked != s and get_or(mystery, s, false)' }),
        { node: 'rect', x: 0, y: 0, w: 102, h: 186, radius: 16, fill: '#00000000', on_tap: { input: 'tap_box', with: { slot: 's' } } },
      ],
    },
  };
  const clock = { node: 'rect', x: 40, y: 452, h: 5, radius: 3, w: '= if locked then 0.0 else max(0.0, 280.0 * ((shelf__until - now) * 1.0) / (pace_ms * 1.0))', fill: '$primary' };

  const cell = 52, gap = 8, gridW = cell * 3 + gap * 2;
  const book = {
    node: 'group', children: [
      frame(art, 'panel', 24, 462, 312, 222),
      T('label', "= if trade_tokens >= 4 then 'Tap a silhouette to trade' else 'Collection book'", { x: 40, y: 474, w: 280, h: 22, align: 'center', valign: 'middle', color: '$ink_muted' }),
      {
        node: 'grid', cols: 3, rows: 3, cell_size: cell, gap, x: 180 - gridW / 2, y: 500,
        cell: {
          node: 'group',
          animate_on: { tap_cell: { when: 'event.cell == cell', prop: 'scale', keys: [1, 0.94, 1], ms: 170 } },
          children: [
            { node: 'image', asset: 'slot', x: 0, y: 0, w: cell, h: cell },
            { node: 'image', asset: fig('cell.y * 3 + cell.x'), x: 11, y: 4, w: 30, h: 44, opacity: '= if get_or(collected, cell.y * 3 + cell.x, false) then 1.0 else if trade_tokens >= 4 then 0.42 else 0.16', transition: { opacity: { ms: 280, ease: 'out' } } },
            { node: 'rect', x: 0, y: 0, w: cell, h: cell, radius: 10, fill: '#00000000', on_tap: { input: 'tap_cell', with: { cell: 'cell' } } },
          ],
        },
      },
    ],
  };

  const endCard = {
    node: 'group', visible: "= status != 'playing'",
    animate_on: { win: { prop: 'opacity', keys: [0, 1], ms: 220, ease: 'out' }, lose: { prop: 'opacity', keys: [0, 1], ms: 220, ease: 'out' } },
    children: [
      { node: 'rect', x: -40, y: -40, w: 440, h: 860, fill: '#3B1E2C8C' },
      frame(art, 'panel', 30, 150, 300, 470),
      wordmark(art, 180, 222, 250, 110),
      T('title', "= if status == 'won' then 'Full set!' else 'Out of boxes'", { x: 50, y: 284, w: 260, h: 34, align: 'center', valign: 'middle', color: '$primary_ink' }),
      { node: 'image', asset: "= if status == 'won' then 'f8' else 'f' + str(max(0, last_idx))", x: 144, y: 322, w: 72, h: 110 },
      T('hero', '= str(score)', { numerals: true, x: 50, y: 438, w: 260, h: 56, align: 'center', valign: 'middle' }),
      T('body', "= str(figures_collected) + ' of 9 figures'", { x: 50, y: 496, w: 260, h: 26, align: 'center', valign: 'middle' }),
      T('caption', "= get_or(content_end_lines, min(4, figures_collected / 2), '')", { x: 54, y: 526, w: 252, h: 54, align: 'center', valign: 'top', wrap: true, color: '$ink_muted' }),
    ],
  };

  const playing = { node: 'group', visible: "= status == 'playing'", children: [book, shelf, clock, plaque] };
  const P = prod.presentation ?? {};
  g.presentation = {
    canvas: { w: 360, h: 780, background: '$bg' },
    tokens: { ...art.kit.palette, plate: art.kit.palette.surface, plate_solid: art.kit.palette.surface },
    root: { node: 'group', children: [{ node: 'image', asset: 'backdrop', x: 0, y: 0, w: 360, h: 780 }, playing, hud, endCard] },
    feedback: [
      { on: 'opened_new', do: [{ sound: { wave: 'triangle', notes: ['C6', 'E6', 'G6'], step_ms: 60, volume: 0.3 } }, { particles: { x: '= 69 + max(0, picked) * 110', y: 330, count: 18, color: '$primary', speed: 220, size: 5, ms: 500 } }, { haptic: 'success' }] },
      { on: 'opened_dup', do: [{ sound: { wave: 'sine', notes: ['G5', 'D5'], step_ms: 70, volume: 0.25 } }, { haptic: 'light' }] },
      { on: 'secret_found', do: [{ sound: { wave: 'triangle', notes: ['C6', 'E6', 'G6', 'C7'], step_ms: 70, volume: 0.32 } }, { particles: { x: '= 69 + max(0, picked) * 110', y: 330, count: 30, color: '$accent', speed: 300, size: 6, ms: 800 } }] },
      { on: 'traded', do: [{ sound: { wave: 'triangle', notes: ['E5', 'A5'], step_ms: 60, volume: 0.28 } }, { particles: { x: 180, y: 580, count: 18, color: '$accent', speed: 220, size: 5, ms: 500 } }, { haptic: 'success' }] },
      { on: 'win', do: [{ sound: { wave: 'square', notes: ['E5', 'G5', 'E6', 'C6', 'G6'], step_ms: 75, volume: 0.188 } }, { particles: { x: 180, y: 380, count: 36, color: '$primary', speed: 320, size: 7, ms: 1200, gravity: 520 } }, { haptic: 'success' }] },
      { on: 'lose', do: [{ sound: { wave: 'sawtooth', notes: ['E4', 'D#4', 'D4'], step_ms: 160, volume: 0.18 } }, { haptic: 'error' }] },
    ],
    ...(P.music ? { music: P.music } : {}),
  };
  g.assets = { ...Object.fromEntries(Object.entries(prod.assets ?? {}).filter(([, a]) => a.sound)), ...artAssets(art) };
  return g;
}

export function manifestPatch(m) {
  return {
    one_line_rule: 'Read the peek on each blind box and tap the Labubu you still need.',
    score: { ...m.score, measures: 'figures collected, duplicates traded and boxes saved', bounds: { min: 0, max: 200, max_rate_per_s: 25 } },
  };
}
