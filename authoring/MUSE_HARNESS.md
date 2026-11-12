# Muse harness: Emberpost sprite experiment

Emberpost is a top-down game where a fox walks around brambles, collects three embers, and
delivers them to a postbox. The local comparison ran the same map, movement rules, seed, and
recorded inputs with a shape baseline and two SVG packs from Muse Wonder. Each pack supplied a
fox walk cycle, an ember, a bramble, and a postbox. This experiment isolated asset generation:
the map and movement code were built separately.

## What worked

- Both prompts produced a usable six-frame SVG sheet. The structured prompt specified a shared
  palette and silhouette, along with exact cell dimensions, a centerline, a foot baseline,
  and how far the body and accessories could move.
- All six structured poses kept at least 4 px of transparent padding on each side and shared a
  foot baseline at y=40. A stroked ear in the plain sheet extended above the top edge in one
  frame. These were geometry checks on the SVGs.
- The same WASM replay exercised all six frames and both left/right facings for each Muse
  pack. All three variants picked up three embers and finished in 13.416 seconds. The WASM
  checks also verified that brambles block movement.
- Bayan liked the structured result in the gallery. Keep that pack as a quality reference
  for future trials while giving each game its own style.

This was one comparison on one game. It showed that a production brief can improve measurable
sprite consistency. It did not establish which prompt will give the best art across games.
The two Muse calls cost about $0.30.

## Prompt used

Both versions got the same brief and output contract:

> A 2D top-down pixel-art game called Emberpost. A small orange fox courier with a teal scarf carries mail through a mossy night forest. Make a six-frame walk-cycle sprite sheet (six horizontal 48×48 frames, SVG viewport 288×48), plus separate 48×48 SVGs of an ember pickup, a chunky bramble obstacle, and a tiny teal-roofed postbox goal. Transparent backgrounds. Each art role must be easy to identify at phone size.

> Return JSON with exactly four keys: fox, ember, bramble, postbox. Values are complete standalone SVG strings starting with &lt;svg. Use xmlns, explicit width and height, and matching viewBox. No script, image, use, style element, embedded assets, references, text, animation, or foreignObject. Built-in geometry only. For fox draw all six poses separately in translated groups. Keep markup compact.

The structured version added this:

> Treat each sprite as part of one production asset pack. Use a 2 px hard edge grid and a shared palette: dark outline #201D31, warm orange #D77A37, warm cream #FFF0C2, teal #74C8BA, deep pine #2A554E. Fox faces right with a recognizable cream muzzle, tall ears, teal scarf, and big tail; same head, body proportions, centerline x=24, and foot baseline y=40 in every cell. Give its front and back paws opposing strides at phases 0,1,2,3,4,5; allow only 1–2px body bob and 2–4px tail or scarf swing. Keep 4px padding from every cell edge and preserve a transparent gutter. Define visual priorities at a glance: warm outlined fox silhouette, bright gold ember diamond, dark thorn cluster with pale spikes, teal roof with golden mail slot. Avoid noise and detached pixels. Before answering check each cell visually in local coordinates for clipping and identical registration. Ensure artwork differs between frames only where motion demands it.

## Checks to add to the harness

1. Validate the JSON keys, SVG markup, sheet dimensions, and number of frames.
2. Measure the visible bounds, including strokes, per frame. Report the frame number and which
   edge broke the padding requirement. Check foot baseline and center alignment, allowing only
   the motion specified in the brief.
3. Preview the strip and loop at the actual game size. Check the silhouette, apparent jitter,
   and whether the player can distinguish pickups, obstacles, and the goal during play.
4. Run the same seeded replay with each candidate pack to catch changes in position, facing,
   or outcome. If a repair fails validation or regresses the replay, keep the last passing pack.
