// Gold: Fog Over the Bay (Prod 8728f0bbcc52f67f75574de4), rebuilt on its art direction
// (fog.direction.json). Rules, state, inputs and the drag handler are the Prod game's. The game was
// written for 360 × 640, and its rules keep fog and glints inside y 30–610 and 170–500: on the tall
// canvas those coordinates are drawn as they are (no lift) and the drag area stays 360 × 640, so
// every recorded run replays the same; the extra 140 units below are open water from the backdrop.
//
// Layout (safe area y 110–684): the bay (fog 30–643, glints 170–500), open sky above it · the HUD
// plaque in the bottom band 643–684, where the fog can't reach · end card on a sea-glass panel. The
// calm lines are left out: little text, big art.

import { artAssets, frame, text } from '../build.mjs';

export function build(game, art) {
  const g = JSON.parse(JSON.stringify(game));
  const T = (step, value, props) => text(art, step, value, props);
  const old = g.presentation.root.children[1].children;
  const drag = old.find((n) => n.on_drag);
  // The fog's centre stays within y 30–610 (rules), so at 62 tall it never reaches the HUD at y 643.
  const fogH = 62, fogW = Math.round(62 * (192 / 137));

  const play = {
    node: 'group', visible: "= status == 'playing'", children: [
      // Glints twinkle, pop in, and fade for their last 0.6 s (they expire at 9 s).
      {
        node: 'repeat', source: 'items', as: 'i', key: 'i.id',
        template: {
          node: 'image', asset: 'glint', anchor: 'center', x: '= i.x', y: '= i.y + sin((now + i.id * 211) / 260.0) * 2.0', w: 52, h: 42,
          opacity: '= clamp((9000.0 - (now - i.born)) / 600.0, 0.0, 1.0) * (0.85 + 0.15 * sin((now + i.id * 97) / 180.0))',
          animate_on: { pickups__appeared: { when: 'event.id == i.id', prop: 'scale', keys: [0.2, 1.15, 1], ms: 280, ease: 'out' } },
        },
      },
      { node: 'image', asset: 'puff', x: '= player.x - 74.0', y: '= player.y - 6.0', w: 58, h: 24, opacity: 0.7, visible: '= score >= 6', transition: { x: { ms: 260, ease: 'out' }, y: { ms: 260, ease: 'out' } } },
      { node: 'image', asset: 'puff', x: '= player.x + 18.0', y: '= player.y + 4.0', w: 58, h: 24, opacity: 0.7, flip_x: true, visible: '= score >= 12', transition: { x: { ms: 340, ease: 'out' }, y: { ms: 340, ease: 'out' } } },
      {
        node: 'image', asset: 'fog', anchor: 'center', x: '= player.x', y: '= player.y', w: fogW, h: fogH,
        rotation: '= clamp((player_drag__target.x - player.x) * 0.25, -8.0, 8.0)',
        transition: { x: { ms: 80, ease: 'out' }, y: { ms: 80, ease: 'out' }, rotation: { ms: 160, ease: 'out' } },
        animate_on: { point: { prop: 'scale', keys: [1, 1.08, 1], ms: 220, ease: 'out' } },
      },
    ],
  };

  const hud = {
    node: 'group', children: [
      frame(art, 'banner', 40, 643, 280, 41),
      { node: 'image', asset: 'glint', x: 60, y: 648, w: 36, h: 29 },
      T('title', "= str(score) + ' / 18'", { x: 100, y: 643, w: 120, h: 41, align: 'left', valign: 'middle', color: '$on_secondary', animate_on: { point: { prop: 'scale', keys: [1, 1.15, 1], ms: 200, ease: 'out' } } }),
      T('title', "= str(max(0, ceil((60000 - now) / 1000.0))) + 's'", { x: 226, y: 643, w: 74, h: 41, align: 'right', valign: 'middle', color: "= if 60000 - now <= 8000 then $danger_ink else $on_secondary", transition: { color: { ms: 200, ease: 'out' } } }),
    ],
  };

  const endCard = {
    node: 'group', visible: "= status != 'playing'",
    animate_on: { win: { prop: 'scale', keys: [0.85, 1.03, 1], ms: 420, ease: 'out' }, lose: { prop: 'scale', keys: [0.85, 1.03, 1], ms: 420, ease: 'out' } },
    children: [
      { node: 'rect', x: -40, y: -40, w: 440, h: 860, fill: '#06141E80' },
      frame(art, 'panel', 40, 208, 280, 372),
      { node: 'image', asset: 'lamp', x: 146, y: 224, w: 68, h: 68 },
      T('title', "= if status == 'won' then 'The bay is tucked in' else 'The fog drifted off'", { x: 56, y: 300, w: 248, h: 34, align: 'center', valign: 'middle', color: '$on_secondary' }),
      T('hero', "= str(score) + ' / 18'", { x: 56, y: 340, w: 248, h: 64, align: 'center', valign: 'middle', color: '$on_secondary' }),
      T('label', 'glints covered', { x: 56, y: 404, w: 248, h: 20, align: 'center', valign: 'middle', color: '$on_secondary' }),
      T('title', '= rank_for(score)', { x: 56, y: 436, w: 248, h: 34, align: 'center', valign: 'middle', color: '$on_secondary' }),
      T('body', "= if status == 'won' then 'The lighthouse approves of this blanket.' else 'The water still sparkles. Try again?'", { x: 64, y: 480, w: 232, h: 52, align: 'center', valign: 'middle', wrap: true, color: '$on_secondary' }),
    ],
  };

  const pal = art.kit.palette;
  g.presentation = {
    ...g.presentation,
    canvas: { w: 360, h: 780, background: '$bg' },
    // The sea-glass plaques are pale: text on them uses the bay's deep navy (on_secondary).
    tokens: { ...pal, on_secondary: '#0E2A3B', danger_ink: '#9E2B3A', plate: pal.surface, plate_solid: pal.surface },
    // The backdrop is drawn 1.22× and anchored at the bottom, so its horizon (y 305 of 780) lands near
    // y 200, just above where glints spawn (y 170–500 sit on the water), the moon high in the sky.
    root: { node: 'group', children: [{ node: 'image', asset: 'backdrop', x: -40, y: -172, w: 440, h: 952 }, drag, play, hud, endCard] },
    feedback: (g.presentation.feedback ?? []).map((f) => ({
      ...f,
      do: f.do.map((d) => (d.particles ? { particles: { ...d.particles, ...(f.on === 'win' ? { y: 390 } : {}), color: f.on === 'collected_one' ? '#FFE3A3' : d.particles.color } } : d)),
    })),
  };
  g.assets = { ...Object.fromEntries(Object.entries(g.assets ?? {}).filter(([, a]) => a.sound)), ...artAssets(art) };
  return g;
}
