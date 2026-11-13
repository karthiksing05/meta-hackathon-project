// Gold v2: Fog Over the Bay. The v1 build (fog.mjs: moonlit gouache bay, Muse Image backdrop, fog, glint,
// puff and lamp sprites, sea-glass frames) with the v2 pieces: the lettered wordmark on the end card,
// the look kit's characterful display face, and presentation.app for the app (written by the build).
// Rules and handlers are the Prod game's.

import { build as buildV1 } from './fog.mjs';
import { frame, text, wordmark } from '../build.mjs';

export function build(game, art, opts) {
  const g = buildV1(game, art, opts);
  const root = g.presentation.root.children;
  const end = root[root.length - 1];
  const T = (step, value, props) => text(art, step, value, props);
  const old = end.children;
  const pick = (re) => old.find((n) => n.node === 'text' && re.test(String(n.text)));
  const title = pick(/tucked in/), hero = pick(/' \/ 18'/), label = pick(/^glints covered$/), rank = pick(/rank_for/), body = pick(/lighthouse approves/);
  end.children = [
    old[0],
    frame(art, 'panel', 30, 140, 300, 456),
    wordmark(art, 180, 214, 250, 120),
    { ...title, y: 288 },
    { ...hero, y: 326 },
    { ...label, y: 390 },
    { ...rank, y: 420 },
    { ...body, y: 462 },
    { node: 'image', asset: 'lamp', x: 156, y: 522, w: 48, h: 48 },
  ];
  // frame() baked a new panel size: refresh the assets so it ships.
  Object.assign(g.assets, art.baked);
  void T;
  return g;
}
