// Gold: Guess the Decade (Prod key k20, dca2283a1b53cd83a57173d0). SEEDED (Daily and board runs on
// Prod), so presentation only: rules, state, inputs, functions and every asset stay byte for byte
// (the rules hash covers `assets`), so no new pictures. The art direction from its style frame
// (k20.direction.json, retro synthwave) is drawn as engine shapes: a banded sky, a striped sunset sun
// cut from polygons, mountain silhouettes and a perspective grid floor, with the answer bars as
// neon-edged pills over the grid. The Prod play button and headphone lives (SVG assets) are kept.
//
// Layout on the tall canvas (safe area y 110–684): HUD plaques 118–162 · sun and play button around
// y 318 · horizon 400 · replay line / hint 410–440, timer 446 · four answers 462–670.

import { text } from '../build.mjs';

const lerp = (a, b, t) => a + (b - a) * t;
const hexMix = (a, b, t) => '#' + [1, 3, 5].map((i) => Math.round(lerp(parseInt(a.slice(i, i + 2), 16), parseInt(b.slice(i, i + 2), 16), t)).toString(16).padStart(2, '0')).join('').toUpperCase();
const r1 = (v) => Math.round(v * 10) / 10;

const HORIZON = 400;
const SKY_TOP = '#120A30', SKY_LOW = '#4A1766';

/** The sky as bands (the engine draws flat fills), and the band colour at any y. */
function sky() {
  const n = 20, h = HORIZON / n;
  const bands = [];
  for (let i = 0; i < n; i++) bands.push({ node: 'rect', x: 0, y: r1(i * h), w: 360, h: r1(h + 1), fill: hexMix(SKY_TOP, SKY_LOW, (i / (n - 1)) ** 1.6) });
  return bands;
}

/** A sun of horizontal slices, yellow-orange at the top to pink at the base, with widening gaps. */
function sun(cx, cy, r) {
  const slices = [];
  const top = cy - r, bottom = Math.min(cy + r, HORIZON);
  let y = top, k = 0;
  while (y < bottom - 1) {
    const t = (y - top) / (2 * r);
    const hgt = t < 0.3 ? 2 * r * 0.3 : Math.max(4, 14 - (t - 0.3) * 16);
    const gap = t < 0.3 ? 0 : 3 + (t - 0.3) * 10;
    const y0 = y, y1 = Math.min(bottom, y + hgt);
    const pts = [];
    for (let s = 0; s <= 8; s++) { const yy = lerp(y0, y1, s / 8); const dx = Math.sqrt(Math.max(0, r * r - (yy - cy) ** 2)); pts.push([r1(cx + dx), r1(yy)]); }
    for (let s = 8; s >= 0; s--) { const yy = lerp(y0, y1, s / 8); const dx = Math.sqrt(Math.max(0, r * r - (yy - cy) ** 2)); pts.push([r1(cx - dx), r1(yy)]); }
    slices.push({ node: 'poly', points: pts, fill: hexMix('#FFD27A', '#FF4FA3', Math.min(1, ((y0 + y1) / 2 - top) / (bottom - top))) });
    y = y1 + gap; k++;
  }
  return [{ node: 'circle', x: cx, y: cy, r: r + 16, fill: '#FF4FA31A' }, { node: 'circle', x: cx, y: cy, r: r + 7, fill: '#FF8A5C24' }, ...slices];
}

function mountains() {
  const back = [[0, 362], [36, 344], [70, 360], [104, 336], [150, 364], [196, 352], [236, 366], [282, 334], [320, 356], [360, 340], [360, HORIZON], [0, HORIZON]];
  const front = [[0, 378], [44, 366], [92, 386], [140, 372], [178, 390], [226, 370], [270, 388], [318, 364], [360, 378], [360, HORIZON], [0, HORIZON]];
  return [{ node: 'poly', points: back, fill: '#2E1458' }, { node: 'poly', points: front, fill: '#1E0C40' }];
}

function floor() {
  const out = [{ node: 'rect', x: 0, y: HORIZON, w: 360, h: 780 - HORIZON, fill: '#140834' }];
  for (let i = 0; i < 12; i++) { const t = (i + 1) / 12; const y = r1(HORIZON + (780 - HORIZON) * t * t); out.push({ node: 'line', x1: 0, y1: y, x2: 360, y2: y, stroke: '#FF4FA3', stroke_width: r1(1 + t * 1.5), opacity: r1(0.25 + t * 0.35) }); }
  for (let i = -9; i <= 9; i++) out.push({ node: 'line', x1: r1(180 + i * 9), y1: HORIZON, x2: r1(180 + i * 64), y2: 780, stroke: '#FF4FA3', stroke_width: 1.5, opacity: 0.45 });
  out.push({ node: 'rect', x: 0, y: HORIZON - 1, w: 360, h: 3, fill: '#3FDEF8', opacity: 0.85 });
  out.push({ node: 'rect', x: 0, y: HORIZON + 2, w: 360, h: 10, fill: '#3FDEF8', opacity: 0.12 });
  return out;
}

function stars() {
  const pts = [[24, 186], [62, 228], [104, 178], [142, 214], [222, 192], [268, 226], [306, 182], [338, 236], [40, 268], [322, 280], [88, 300], [290, 300]];
  return pts.map(([x, y], i) => ({ node: 'circle', x, y, r: i % 3 === 0 ? 1.6 : 1.1, fill: '#F3EEFF', opacity: i % 2 ? 0.55 : 0.8 }));
}

export function build(game, art) {
  const g = JSON.parse(JSON.stringify(game));
  const T = (step, value, props) => text(art, step, value, props);
  const P = g.presentation;
  // The Prod nodes that carry handlers and state bindings, reused with their handlers untouched.
  const field = P.root.children[1].children;
  const timer = field.find((n) => n.node === 'rect');
  const answers = field.find((n) => n.node === 'repeat');
  const playGroup = field.find((n) => n.node === 'group' && n.children?.some((c) => c.asset === 'play_btn'));
  const playBtn = playGroup.children.find((c) => c.asset === 'play_btn');
  const hudStack = P.root.children[2];
  const scoreText = hudStack.children[1];
  const livesRepeat = hudStack.children[2].children[0];
  const cy = 318;

  // Answers: dark neon-edged pills on the grid (the Prod state rect, with its tap, restyled).
  const ay = (k) => `= 462 + ${k} * 56`;
  const tpl = answers.template;
  const stateRect = tpl.children.find((c) => c.on_tap);
  const answerRow = {
    ...answers,
    template: {
      ...tpl,
      children: [
        // The Prod state rect is the pill itself: dark until answered, then right or wrong.
        { ...stateRect, x: 30, y: ay('k'), w: 300, h: 46, radius: 23, opacity: 1, stroke: '$accent', stroke_width: 2, fill: "= if quiz__opt_fill(k) == 'good' then '#1F8A6E' else if quiz__opt_fill(k) == 'bad' then '#A3284F' else '#120A30E6'" },
        T('title', tpl.children.find((c) => c.node === 'text').text, { numerals: true, x: 30, y: ay('k'), w: 300, h: 46, align: 'center', valign: 'middle', color: '$ink' }),
      ],
    },
  };

  const play = {
    node: 'group', children: [
      { node: 'circle', x: 180, y: cy, r: 58, fill: '#3FDEF814', stroke: '$accent', stroke_width: 1.5, opacity: 0.6, animate_on: { round_started: { prop: 'scale', keys: [1, 1.18, 1], ms: 600, ease: 'out' }, play_again: { prop: 'scale', keys: [1, 1.18, 1], ms: 600, ease: 'out' } } },
      { ...playBtn, x: 140, y: cy - 40, w: 80, h: 80, animate_on: { replay: { prop: 'scale', keys: [1, 0.92, 1.04, 1], ms: 220, ease: 'out' } } },
    ],
  };

  const replayLine = T('label', "= if replays_left > 0 then 'Tap to hear it again' else 'Pick the decade'", { x: 40, y: 410, w: 280, h: 28, align: 'center', valign: 'middle', color: '$ink', visible: '= not locked' });
  const hint = T('body', '= hint_text()', { x: 30, y: 410, w: 300, h: 28, align: 'center', valign: 'middle', color: '$primary', visible: '= locked' });
  const timerBar = { ...timer, x: 30, y: 444, h: 5, radius: 2.5, fill: '= if quiz__until - now < 8000 / 4 then $danger else $accent' };

  const plaque = (x, w) => ({ node: 'rect', x, y: 118, w, h: 44, radius: 22, fill: '#120A30D9', stroke: '#B2F2FC55', stroke_width: 1.5 });
  const hud = {
    node: 'group', children: [
      plaque(16, 150), plaque(176, 168),
      T('label', "= 'Round ' + str(min(round + 1, 10)) + ' / 10'", { x: 16, y: 118, w: 150, h: 44, align: 'center', valign: 'middle', color: '$ink' }),
      T('title', "= str(score)", { numerals: true, x: 192, y: 118, w: 86, h: 44, align: 'left', valign: 'middle', color: '$primary', animate_on: scoreText.animate_on }),
      { node: 'group', x: 280, y: 129, children: [{ ...livesRepeat, template: { ...livesRepeat.template, w: 22, h: 22 } }] },
    ],
  };

  const endCard = {
    node: 'group', visible: "= status != 'playing'",
    animate_on: { win: { prop: 'scale', keys: [0.88, 1.03, 1], ms: 380, ease: 'out' }, lose: { prop: 'scale', keys: [0.88, 1.03, 1], ms: 380, ease: 'out' } },
    children: [
      { node: 'rect', x: -40, y: -40, w: 440, h: 860, fill: '#08041ACC' },
      { node: 'rect', x: 34, y: 196, w: 292, h: 340, radius: 8, fill: '#1A0E3E', stroke: '$accent', stroke_width: 2 },
      { node: 'rect', x: 42, y: 204, w: 276, h: 324, radius: 5, fill: '#00000000', stroke: '#FF4FA388', stroke_width: 1.5 },
      T('title', "= if status == 'won' then 'Time traveller' else 'Out of lives'", { x: 50, y: 222, w: 260, h: 40, align: 'center', valign: 'middle', color: '$ink' }),
      T('label', 'Final score', { x: 50, y: 272, w: 260, h: 22, align: 'center', valign: 'middle', color: '$ink' }),
      T('hero', '= str(score)', { numerals: true, x: 50, y: 298, w: 260, h: 70, align: 'center', valign: 'middle', color: '$primary' }),
      T('title', '= rank_for(score)', { x: 50, y: 384, w: 260, h: 36, align: 'center', valign: 'middle', color: '$accent' }),
      T('body', "= str(right_count) + ' of 10 decades heard right'", { x: 50, y: 434, w: 260, h: 28, align: 'center', valign: 'middle', color: '$ink' }),
    ],
  };

  const playing = { node: 'group', visible: "= status == 'playing'", children: [answerRow, play, replayLine, hint, timerBar] };
  g.presentation = {
    ...P,
    canvas: { w: 360, h: 780, background: '$bg' },
    tokens: { ...P.tokens, ...art.kit.palette },
    root: { node: 'group', children: [...sky(), ...stars(), ...sun(180, 292, 80), ...mountains(), ...floor(), playing, hud, endCard] },
    // One subtle shake on a miss (Prod had three: two on a wrong answer, one on a lost life).
    feedback: P.feedback.map((f, i) => {
      const firstWrong = P.feedback.findIndex((x) => x.on === 'answered_wrong');
      let d = f.do.filter((x) => !(x.shake && (f.on === 'life_lost' || (f.on === 'answered_wrong' && i !== firstWrong))));
      d = d.map((x) => (x.shake ? { shake: { px: 4, ms: 160 } } : x.particles ? { particles: { ...x.particles, ...(f.on === 'answered_right' && typeof x.particles.y === 'string' ? { y: '= 485 + max(0, picked) * 56' } : f.on === 'answered_right' ? { y: cy } : { y: 330 }), color: x.particles.color === '#00E5FF' ? '$accent' : x.particles.color } } : x));
      return { ...f, do: d };
    }),
  };
  return g;
}
