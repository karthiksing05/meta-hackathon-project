// Gold v2: Guess the Decade (Prod key k20, dca2283a1b53cd83a57173d0). SEEDED (Daily, Group and Event
// runs on Prod). Since 2026-11-13 a seeded game may take new pictures: images don't change the
// simulation. Rules, state, inputs, functions and feedback stay byte for byte, and every tap target
// keeps its order and its box (the server replays raw input logs), so every seeded run replays to the
// same score (finish.mjs: logic hash + demo-seed run logs).
//
// Art (muse-image-1.0, k20.direction.json): the backdrop is an edit of the synthwave style frame (sky,
// striped sun, mountains, grid floor: no more engine-shape scenery); the play button, the cassette
// lives and one icon per decade (disco ball, boombox, CD, flip phone, smartphone, earbuds) come from
// one sprite sheet; the answer pills, HUD plaques and end card are neon-glass frames from the UI kit
// sheet; the title is the lettered wordmark, shown over the sky in the first round and on the end card.
//
// Builds on the game as it is on Prod now (the presentation-only gold v1).

import { text, frame, wordmark, artAssets } from '../build.mjs';

/** The decade icon for answer k: one sprite per decade label. */
const ICON = "= if get_or(opts, k, '') == '1970s' then 'd70' else if get_or(opts, k, '') == '1980s' then 'd80' else if get_or(opts, k, '') == '1990s' then 'd90' else if get_or(opts, k, '') == '2000s' then 'd00' else if get_or(opts, k, '') == '2010s' then 'd10' else 'd20'";

export function build(game, art) {
  const g = JSON.parse(JSON.stringify(game));
  const T = (step, value, props) => text(art, step, value, props);
  const P = g.presentation;
  const kids = P.root.children;
  const playingOld = kids[kids.length - 3];
  const hudOld = kids[kids.length - 2];
  const endOld = kids[kids.length - 1];
  const answers = playingOld.children.find((n) => n.node === 'repeat');
  const playGroup = playingOld.children.find((n) => n.node === 'group');
  const replayText = playingOld.children.filter((n) => n.node === 'text')[0];
  const hintText = playingOld.children.filter((n) => n.node === 'text')[1];
  const timer = playingOld.children.find((n) => n.node === 'rect');
  const tpl = answers.template;
  const stateRect = tpl.children.find((c) => c.on_tap);
  const label = tpl.children.find((c) => c.node === 'text');
  const ay = (dy = 0) => `= 462 + k * 56${dy ? ` + ${dy}` : ''}`;

  // Answers: a neon-glass pill (one baked frame), the Prod tap rect on top (same box, same tap),
  // tinted only once answered, the decade's icon and its label.
  const pill = frame(art, 'button', 30, 0, 300, 46);
  const answerRow = {
    ...answers,
    template: {
      ...tpl,
      children: [
        { ...pill, y: ay() },
        { ...stateRect, stroke_width: 0, fill: "= if quiz__opt_fill(k) == 'good' then '#1F8A6EB3' else if quiz__opt_fill(k) == 'bad' then '#A3284FB3' else '#00000000'" },
        { node: 'image', asset: ICON, x: 44, y: ay(5), w: 36, h: 36 },
        T('title', label.text, { x: 84, y: ay(), w: 200, h: 46, align: 'center', valign: 'middle', color: '$ink' }),
      ],
    },
  };

  // The play button: the sprite, same box and tap; the ring pulse stays a ring.
  const ring = playGroup.children.find((c) => c.node === 'circle');
  const btn = playGroup.children.find((c) => c.on_tap);
  const play = { ...playGroup, children: [{ ...ring, r: 46, stroke_width: 2, opacity: 0.5, animate_on: { round_started: { prop: 'scale', keys: [1, 1.06, 1], ms: 600, ease: 'out' }, play_again: { prop: 'scale', keys: [1, 1.06, 1], ms: 600, ease: 'out' } } }, { ...btn, asset: 'play' }] };

  // Words under the sun sit on a banner frame so they read over the grid's glow.
  const banner = frame(art, 'banner', 34, 411, 292, 36);
  // One steady line (no flicker between quick answers); the decade hint shows on its own after a pick.
  const replayLine = T('label', 'Tap play to hear it again', { x: 40, y: 415, w: 280, h: 28, align: 'center', valign: 'middle', color: '$ink', opacity: '= if replays_left > 0 then 1.0 else 0.45', transition: { opacity: { ms: 200, ease: 'out' } } });
  const hintBanner = { ...frame(art, 'banner', 24, 370, 312, 36), visible: hintText.visible, opacity: '= if locked then 1.0 else 0.0', transition: { opacity: { ms: 150, ease: 'out' } } };
  const hint = T('body', hintText.text, { x: 34, y: 374, w: 292, h: 28, align: 'center', valign: 'middle', color: '$ink', visible: hintText.visible, opacity: '= if locked then 1.0 else 0.0', transition: { opacity: { ms: 150, ease: 'out' } } });
  const timerBar = { ...timer, y: 452, h: 5 };

  // The title over the sky while the first round plays (the app's intro shows it before).
  const title = wordmark(art, 180, 206, 236, 92, { visible: '= round == 0', opacity: '= if round == 0 then 1.0 else 0.0', transition: { opacity: { ms: 300, ease: 'out' } } });

  const playing = { ...playingOld, children: [answerRow, play, banner, replayLine, timerBar, hintBanner, hint] };

  // HUD: two neon plaques; lives are cassettes.
  const [, , roundText, scoreText, livesGroup] = hudOld.children;
  const lives = livesGroup.children[0];
  const hud = {
    ...hudOld,
    children: [
      frame(art, 'badge', 16, 116, 150, 48),
      frame(art, 'badge', 176, 116, 168, 48),
      T('label', roundText.text, { x: 16, y: 118, w: 150, h: 44, align: 'center', valign: 'middle', color: '$ink' }),
      T('title', scoreText.text, { numerals: true, x: 190, y: 118, w: 80, h: 44, align: 'left', valign: 'middle', color: '$ink', animate_on: scoreText.animate_on }),
      { ...livesGroup, x: 270, y: 129, children: [{ ...lives, template: { ...lives.template, x: '= k * 36', w: 33, h: 22, animate_on: { life_lost: { when: 'k == lives', prop: 'scale', keys: [1, 1.12, 1], ms: 240 } } } }] },
    ],
  };

  // End card: the panel frame, the wordmark, the score.
  const [, , , endTitle, , endScore, endRank, endRight] = endOld.children;
  const endCard = {
    ...endOld,
    children: [
      { node: 'rect', x: -40, y: -40, w: 440, h: 860, fill: '#08041ACC' },
      frame(art, 'panel', 30, 150, 300, 440),
      wordmark(art, 180, 222, 236, 100),
      T('title', endTitle.text, { x: 50, y: 284, w: 260, h: 36, align: 'center', valign: 'middle', color: '$ink' }),
      T('hero', endScore.text, { numerals: true, x: 50, y: 326, w: 260, h: 70, align: 'center', valign: 'middle', color: '$primary' }),
      T('title', endRank.text, { x: 50, y: 406, w: 260, h: 36, align: 'center', valign: 'middle', color: '$accent' }),
      T('body', endRight.text, { x: 50, y: 452, w: 260, h: 28, align: 'center', valign: 'middle', color: '$ink' }),
    ],
  };

  g.presentation = {
    ...P,
    canvas: { w: 360, h: 780, background: '$bg' },
    tokens: { ...P.tokens, ...art.kit.palette },
    root: { node: 'group', children: [{ node: 'image', asset: 'backdrop', x: 0, y: 0, w: 360, h: 780 }, title, playing, hud, endCard] },
  };
  // Pictures: the backdrop, the sprite set, the wordmark and the baked frames. The Prod SVGs go.
  const keep = Object.fromEntries(Object.entries(g.assets ?? {}).filter(([, a]) => !a.svg && !a.image));
  g.assets = { ...keep, ...artAssets(art) };
  return g;
}
