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

## Transfer test

The transfer test used five briefs: movement, timing, a board puzzle, branching strategy,
and pass-and-play. Both prompt variants got the same game brief and output envelope.
The structured logic prompt added a request for a rules plan and traces, plus a working manifest as a
syntax reference. Art was generated separately as a backdrop and emblem, then installed
on the same validated build for each game.

| Logic variant | Passed on first draft | Passed after up to one repair |
| --- | --- | --- |
| Plain | 0 of 5 | 0 of 5 |
| Structured | 1 of 5 | 3 of 5 |

Pass-and-play passed on the first draft. Timing and the board puzzle passed after one
repair. The movement and branching drafts still used unsupported manifest fields after
repair. Use a schema or a smaller intermediate representation to remove those syntax
choices from the model before testing more elaborate rules. The experiment varied the plan
and the example together, so it cannot isolate their individual effects.

Both art packs for all five briefs passed the asset checks and preserved the independent
replay results. The movement and branching comparisons used reference gameplay that we
wrote for the test. Art preference is a separate human judgment. The gallery hides the
prompt labels, and the report records the mapping.

To run the test with a configured Muse key and a built WASM engine:

```sh
export MG_ENGINE_DIR=/path/to/built/engine
node authoring/harness/generate.mjs /tmp/muse-transfer
node authoring/harness/evaluate.mjs /tmp/muse-transfer
node authoring/harness/generate.mjs /tmp/muse-transfer --repair
node authoring/harness/evaluate.mjs /tmp/muse-transfer
```

The generator records usage in the output directory and caps estimated spend at $5 per
directory. This run used $2.48 for 20 first-pass calls and nine repairs. The evaluator
writes the gameplay checks, art verification, and usage to `transfer-results.json`.

## Recreating the JS games

A follow-up used player-style briefs for Fog Drift, Cable Car Catch, and Sort the City.
Each brief went through three calls: a direct manifest with a working syntax example, a
small game-specific JSON plan, and a structured SVG brief for three asset roles.

None of the direct manifests validated. Fog Drift omitted the state a collision fragment
requires, Cable Car Catch used unsupported anchors and events, and Sort the City returned
rules in the wrong shape. All three smaller plans compiled through handwritten adapters
and passed nine gameplay checks in total. These adapters implement movement, input, and
scoring. Muse supplied values, game content, and art. This tested a way to author supported
game types and did not test generation of new mechanics without an adapter.

The gallery includes the actual JS originals beside the recreations. Each runtime has its
own replay. Within the recreation, swapping shapes for SVG art preserved the tested
outcomes. Sort the City uses one rising card and tap-to-sort controls. The original can
show several items and supports dragging and flicking.

The nine calls cost $0.51, for $2.99 total across this test and the transfer test.

## Karthik’s team on SVG quality

Claude (for Karthik) reported that 8 of 10 live Muse runs produced art, for 27 SVGs at
0.3–5 KB each. Simple objects with a flat fill, dark outline, and one highlight read
well even as thumbnails. Generating eight postcards together gave them a consistent
frame, palette, and horizon. Characters were less reliable. A sailor had misaligned
limbs, a gull’s outlines disappeared at play size, and some sprites clashed with their
backdrops. Games with art were 90–160 KB compared with 11–17 KB without art. The
cause of that size difference was an open question.

- **Start with reusable drawing treatments.** Use the JS Paper and Clay looks as references.
  Paper uses irregular edges, offset shadows, and grain. Clay uses radial shading, a
  highlight dot, and a contact shadow. Give Muse a fixed palette, target size, baseline,
  and stroke weight, and generate the full sprite set in one call. Muse designs the
  silhouettes and backdrop composition. The renderer applies the treatments, normalizes
  scale and baseline, and handles typography, easing, and feedback.
- **Add one review pass at play size.** Render the sprites at 48 and 96 px over their actual
  backdrop. Check silhouette readability at 48 px, palette adherence, a minimum 2 px
  outline at that size, bounds, baseline alignment, absence of text, and the asset byte
  budget. Run automatic checks before the bot gate. Karthik’s team suggested one critique
  round because their median first draft already took about 120 seconds.
- **Show the art in the product.** Karthik’s team plans to build the game-page poster from
  the generated backdrop and hero sprite. They also suggested surfacing the art result
  in “How Muse made it.”

They offered to rerun the same 10 prompts with and without the constraints and compare
the results on one contact sheet. They estimated about 25 minutes for that follow-up.
[Slack reply](https://karthiks-agents.slack.com/archives/C0CH1G45BJQ/p1794527886760369?thread_ts=1794527403.594159&cid=C0CH1G45BJQ)

In a follow-up, Karthik’s team shared the contact sheet for the 27 baseline SVGs.
They suggested Clay for the Cable Car vehicle to make its volume readable at 48 px,
and Paper for the stop marker to keep its sign silhouette clear against the skyline.
They based those suggestions on the JS look definitions. The constrained rerun was
still pending. We shared the exact Cable Car Catch and Sort the City prompts and
asked for paired gameplay frames at play size with the renderer held fixed.
[Baseline contact sheet](https://karthiks-agents.slack.com/archives/C0CH1G45BJQ/p1794529796769039)
[Treatment suggestions](https://karthiks-agents.slack.com/archives/C0CH1G45BJQ/p1794529826731729)
[Prompts and comparison setup](https://karthiks-agents.slack.com/archives/C0CH1G45BJQ/p1794530256606959)

## Testing scene composition

These experiments used existing games and hand-authored layout briefs to isolate
visual changes. They show what those inputs can do in controlled fixtures. They do
not establish that the production flow can create or art-direct a new game from a
player prompt.

Cable Car Catch separated changes to the renderer from changes to Muse's SVGs. With
the earlier art still in place, aligning the station name, stop beam, cable, and track
made the timing action clearer in the rendered frame. With that UI held fixed, the
layout-guided brief left a quieter timing lane than the descriptive brief. One
revision based on a human review of a rendered frame moved the skyline away from hit
feedback. The car and marker were held fixed during that revision. All five WASM
versions finished the same replay with 117 points and the same final state hash.

The Cable Car UI is an experiment fixture. The reusable prompt builder in
`harness/visual-brief.mjs` takes a brief, asset roles, dimensions, palette, protected
zones, and sprite placement. Sort the City supplied its own values for those fields.
Both of its new packs passed the SVG sanitizer from main and preserved the full-deck
replay. A visual preference for that game has not been established. Frame review was
manual in this experiment.

The five calls cost $0.35, bringing the transfer, recreation, and scene experiments to
$3.34 total. [Results shared with Karthik’s agent](https://karthiks-agents.slack.com/archives/C0CH1G45BJQ/p1794529594450749?thread_ts=1794527403.594159&cid=C0CH1G45BJQ).

### Fog Drift transfer

The same prompt builder generated a plain and a structured pack from Fog Drift's
asset roles and protected regions. The structured backdrop kept the flight lane
quieter, but the stretching fog texture still made the collision edge hard to read.
A revision based on a rendered frame strengthened the edge. A separate, fixed-height
edge asset kept its proportions while the fog body stretched. The fog still looked
rectangular compared with the original JS renderer.

The reusable rule is to describe how each asset is drawn, especially whether it
stretches and which edge the player needs to read. The fog renderer supplies the
geometry. The generic art installer validates each role through the SVG sanitizer,
checks its viewBox, and swaps the art without editing the layout or rules. The
body-and-edge treatment was tested on Fog Drift only.

All six WASM treatments cleared five banks and crashed at the same time with the
same final state hash. Four Muse calls cost $0.23, bringing the experiment to $3.58.

### Testing web references on new games

Start each run in Studio's create flow with an ordinary player prompt for a new game.
Use prompts across different mechanics and include both requests with a style cue
and requests where Muse chooses the style. Each run should produce a playable game
from scratch. The player prompt and Studio's normal context are the inputs. Any
asset roles, layout, or art direction must come from Muse's new draft or from data
the renderer exposes for that draft.

Compare the current create flow with a version where Muse can search for visual
references after it has a game draft. Have Muse choose the queries and references
itself. Use the references to inform choices such as palette, texture, or silhouette
and generate original game assets. Record which searches ran and which results Muse
could actually use. Meta documents web search on Responses and Messages and image
input on Chat Completions. [Search grounding](https://dev.meta.ai/docs/search-grounding)
[Image input](https://dev.meta.ai/docs/media-understanding)

For each prompt, use the same newly generated draft in both versions when measuring
the effect of search on the art. Check that the full create flow can produce a
playable game without manual fixes, and review gameplay frames at play size for
visual quality, variety, and control legibility. Record validation failures, cost,
and latency. Count requests that never reach a playable result in the outcome.
