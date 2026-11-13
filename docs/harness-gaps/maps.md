# Gap: maps on screen

## Who asks for it

- Kevin #7: "Trivia geography game with maps featured on the screen".
- Kevin #11: "'Finish the Saying' trivia … with the country shown on a map once I answer".
- Other likely requests:
  - guess the country (or US state) from its outline;
  - pin the city or capital, scored by distance ("where in the world");
  - name the lit-up country;
  - capitals;
  - flags;
  - a state map for a US Group;
  - a map of our Group's hometowns.

In the kevin32 run, v2 planned #7 as `map_place_pin_quiz` and `capital_match`, and #11 as plain trivia. Both
plans leaned on `map_pin_guess`, which was planned, with no way to draw an accurate map.

## What exists today (read from the code)

- **Engine (v0.2, Artem):**
  - `poly` nodes take up to 256 points, with `fill` and `stroke`. `points` can be an `=` expression, so a
    state-driven highlight works.
  - `line`, `circle` and `image` nodes exist.
  - `on_tap` hands the tap position over as `pointer`, a canvas `vec2`.
  - The `pointer` input source (down, move, up) gives coordinates anywhere on the canvas.
  - So tap coordinates do reach game rules. Pin-on-map needs nothing new.
  - Hit-testing uses the node's box, not polygons. Point-in-polygon has to happen in rules. A `fold` over the
    edges works, and is now shipped as `geo_place_at`.
  - `sin`, `cos` and `sqrt` match between native and WASM (SPEC §4). `atan2` and `pow` are not listed as
    matching.
- **Art (Bayan, `art.mjs`/`svg.mjs`):**
  - Sprites can be SVG, or a PNG, JPEG or WebP data URI.
  - Size limits: 24 KB per sprite, 64 KB for the backdrop, 192 KB of art in total, 2,000 elements.
  - The sanitizer allows paths and `<image>` data URIs. A single-path world map is fine.
- **Bots:**
  - They tap the centres of `rect` and `circle` targets.
  - Inside a large tap layer (more than 20% of the canvas), they tap the shapes drawn inside it.
  - So a pin game needs some circles on the map for the bots to aim at. Faint grid dots do that.
- **Muse drawing the map itself:** measured once (muse-spark-1.3, same rect, France lit and three others):
  - It took 100 s and 11.9k completion tokens (9.6k of them reasoning) for a 3.6 KB SVG.
  - The result was a cartoon world: no borders, Japan as a single line, Kenya floating, Brazil a blob.
  - It's fine as a decorative backdrop, but not usable as an answer key. Never let Muse write coordinates.

## Options

| | What | Cost | Needs | Replay risk |
|---|---|---|---|---|
| **A. Build-time geo pack + expander step (built)** | Natural Earth 1:110m (public domain) simplified into `geo-pack/1` JSON. A manifest `geo` section names or picks places. `expander/geo.mjs` writes the map SVG sprite, the highlight rings as `poly` point lists, coordinates, capitals and quiz choices into the manifest. | Done: about 1 day. The hook is about 1 hour. | A one-line hook before `expand` in the Studio and server pipelines, plus the packs in the bundle (see Requests) | None. Everything is literal data at build time, and the maths in rules is plain arithmetic plus `sin`/`cos`/`sqrt`. |
| B. Engine map layer | A `map` node: the projection, country fills by id and polygon hit-tests, inside the engine | Artem: 2–3 days | Engine and runtime release | Low, but projection maths in Rust must match native and WASM |
| C. Server-served packs | Max serves `/v1/geo/<pack>` (more packs: admin-1 for every country, cities, and later flags), so the bundle stays small | Max: half a day | An endpoint and storage | None if the pack is versioned and pinned in the game's lineage |

**Recommendation:** ship A now. It works on today's engine and passes the gate. Do C when we need more than two
packs. Ask for B only if polygon taps over the whole world (all 177 countries as tap targets) turn out too slow
in rules. Today they only cover the game's own places.

**Honest stand-in until the hook lands:**
- Muse-made games can't fill `geo` yet. The planner should plan the tools, which are marked `building`, and the
  game should fall back to plain trivia with country names, with no drawn map.
- Hand-built or seeded games can use it today: run `tools/make-geo-games.mjs`.

## What's built

- **The geo pack:**
  - The generator is `authoring/tools/make-geo-pack.mjs`, and the packs are in `authoring/content/geo/`.
    - `world.json` has 177 countries, 9,383 points and is 147 KB.
    - `us_states.json` has 50 states plus DC, 1,326 points and is 25 KB.
  - Source: `ne_110m_admin_0_countries`, `ne_110m_populated_places_simple` and
    `ne_110m_admin_1_states_provinces` (v5).
  - Fields per place:
    - id (ISO-style `ADM0_A3`, or `US_XX`), name and aliases;
    - kind (sovereign, disputed and so on), continent and subregion;
    - label point, bbox and area;
    - capital, with its coordinates. Bolivia, South Africa and Côte d'Ivoire have more than one capital, which
      are listed in `capitals` and never used as an answer.
    - outer rings, as integers in hundredths of a degree, simplified with Douglas–Peucker at 0.05°.
  - License: public domain. It is recorded in the pack.
  - Every coordinate comes from the files. Rebuild with
    `node authoring/tools/make-geo-pack.mjs --src <dir with the three GeoJSON files>`.
- **`authoring/expander/geo.mjs`:** pure JS with no Node imports, so it can be bundled. It does:
  - name matching (ids, names, aliases, accents);
  - a deterministic pick, which leaves out disputed and indeterminate areas and Antarctica;
  - an equirectangular projection with a standard parallel and a linear inverse;
  - clipping and simplification, keeping each `poly` at 256 points or fewer;
  - the map SVG, simplified until it fits the byte budget (the world map is 17 KB);
  - `applyGeo(manifest, packs)`. An unknown place is an `A_GEO_PLACE` error at its pointer.
- **Fragments (catalog status `building`):**
  - `geo_map`: the map picture, the lit place, a pulsing ring at its label, and `geo_place_at(p)` for
    point-in-polygon taps.
  - `map_pin`: a tap becomes a pin. It gives the great-circle distance in whole km, plus `pinned`, `pin_far`,
    `pin_done` and `pin_points`.
  - `geo_distance`: `geo_km`, `geo_dir` (8-point compass) and `geo_closeness`.
  - `country_outline`: one place drawn big and alone.
  - Distances use an asin series with `sqrt`/`sin`/`cos`, and no `atan2` or `pow`.
- **Example games (passing the gate and the score check):** sources are in `authoring/content/geo/examples/`, built
  into `authoring/games/` by `tools/make-geo-games.mjs`.
  - **Map Spotter** (Kevin #7): name the lit-up country.
  - **Pin the Capital**: pin a capital, with points by distance.
  - **State Shapes**: name the US state from its outline.
  - Kevin #11 is the `map_reveal_trivia` type: the same as Map Spotter, but with
    `map_focus() = if locked then get_or(order, qi, -1) else -1`.
- **Catalog:**
  - Tools:
    - added the fragment entries `geo_map`, `map_pin`, `geo_distance` and `country_outline`;
    - moved `map_pin` out of `planned.json`;
    - `map_pin_guess` and `map_geometry` (now the geo pack) are `building`.
  - Types:
    - new types `lit_country_quiz` and `outline_pick_quiz` (knowledge_quiz), and `map_reveal_trivia` (trivia);
    - tool lists updated on `map_click_quiz`, `capital_match`, `spell_the_country`, `geo_guess`,
      `flag_and_shape`, `map_place_pin_quiz` and `geo_silhouette_distance_guess`.
  - Checklists: a geography checklist in `checklists/knowledge_quiz.json` (region, map or outline, answer mode,
    how hard). It has no family default yet; whoever owns knowledge_quiz can add one.
  - Evals: six cases. Kevin #7 and #11 retrieve the right types. Two of the new phrasings miss: "guess the state
    from its shape…" and "food trivia that shows each dish's country on a map".
- **Tests:** `node authoring/tools/test-geo.mjs` gives 93 passed with the engine and 46 without. It checks:
  - the packs;
  - the projection round trip;
  - clipping;
  - sprite budgets and the sanitizer;
  - the poly limit;
  - determinism;
  - the gate and the score check, with replays, for all three games;
  - that the engine's `geo_km` is within 0.46 km of a JS great circle over 8 taps;
  - `geo_place_at`;
  - `geo_dir`.

### The `geo` section (what a manifest writes)

```json
"geo": { "pack": "world | us_states", "places": ["France", "JPN"] | "pick": {"region": "Europe", "count": 12, "min_area": 20, "seed": 7},
         "target": "label | capital", "map": {"x", "y", "w", "h", "view": "world | fit | <continent> | <subregion> | [w,s,e,n]"},
         "outline": {"x", "y", "w", "h"}, "quiz": {"choices": 2..4, "ask": "name | capital"} }
```

It writes the following functions:
- `geo_names()`;
- `geo_ids()`;
- `geo_capitals()`;
- `geo_continents()`;
- `geo_target()`, as lon/lat `vec2`;
- `geo_rings()`, `geo_ring_place()` and `geo_label()` when the game has a map;
- `geo_outline()` and `geo_outline_place()` when it has outlines;
- `geo_choices()`: neighbours as distractors, with the answer's slot rotating.

It also writes the sprite `map`. The geo step owns the rect and projection params of `geo_map`, `map_pin` and
`country_outline`.

## Requests

**For the group-play agent or the lead (owners of `pipeline.mjs`, `studio.mjs` and `prompts.mjs`):**
> Maps gap (branch `harness-v2`): please add a one-line hook so Muse-made games can use real maps. Before `expand(manifest, lib)` in the Studio pipeline and the server generator, call `({ manifest } = applyGeo(manifest, GEO_PACKS))` from `authoring/expander/geo.mjs`, and surface its diagnostics like any other `A_*` code to the model. Bundle `authoring/content/geo/world.json` and `us_states.json` as `GEO_PACKS` (172 KB total; or trim them to the places a pick can reach). Add the four new fragments to the bundle, and one compose-prompt line: "For maps, write a `geo` section (SPEC: docs/harness-gaps/maps.md) and use geo_map / map_pin / country_outline / geo_distance; never draw maps or write coordinates yourself." Once that's in, flip the four fragments plus map_pin_guess and map_geometry to `shipped`.

**For Max:**
> Maps gap: when the bundle gets heavy, could the server serve geo content packs? `GET /v1/geo/packs` (list: id, version, bytes) and `GET /v1/geo/packs/{id}@{version}` (the `geo-pack/1` JSON as built by `authoring/tools/make-geo-pack.mjs`), cacheable and immutable per version. The generator would record `geo_pack: "world@1"` in the game's lineage so replays stay pinned. Later packs: `ne_10m_admin_1` for all countries and a cities pack. Also, for "a map of our Group's hometowns": an opt-in Group field with each member's country or US state code (never the exact town). The game would get the codes, never the addresses.

**For Bayan (art):**
> Maps gap: the map is a generated SVG sprite (one path, about 17 KB, sea, land and border colours passed in). Two asks. (1) Would you add a map style to the style kit (paper atlas, neon, chalk) that `geo.mjs` can take as `{sea, land, border}`, so maps match a game's look? (2) Flags: Natural Earth has none. A public-domain flag set (Wikimedia's national flag SVGs are mostly PD, but each needs checking) simplified under 24 KB per sprite sheet would close "guess the flag". Until then the planner says flags aren't available and offers outlines.

**For Artem (engine, optional):**
> Maps gap: today `poly` hit-testing uses the bounding box, so tap-the-country runs point-in-polygon in rules (`geo_place_at`, a fold over edges). That's fine for a game's 10–20 places. If we ever want all 177 countries tappable, a `hit: "shape"` option on `poly` (exact polygon hit-test) would move that into the engine. Also, please confirm `atan2` and `pow` match between native and WASM; we avoid them for now.

## What's left

- The hook and bundling (above). Until then the tools stay `building`.
- Flags: there's no data yet.
- Cities beyond capitals: a 10m populated-places pack (Option C).
- Hometown maps need Max's Group field.
- Regional views beyond continents (for example "the Balkans") use `[w,s,e,n]` bounds; the planner could map
  names to bounds.
