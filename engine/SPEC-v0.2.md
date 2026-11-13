# Microgame format v0.2: additions to v0.1

This adds to `docs/microgame-input-format.md` (v0.1). Everything here is **additive**: every
v0.1 file is still valid, and `"format"` may be `"microgame/0.1"` or `"microgame/0.2"`.
Where this file and the v0.1 doc disagree, this file wins. The engine's spec decisions so
far are in `engine/README.md` under "Where the engine differs from or fills gaps in the spec".

New in v0.2:

1. **Assets:** images, SVG, sprite sheets and sounds.
2. **New nodes:** `image`, `line`, `poly`.
3. **Camera:** scrolling worlds, with `fixed` HUD nodes.
4. **Input sources:** typed text, any key, key up, and pointer anywhere.
5. **Physics:** optional, arcade-style and deterministic.
6. **Audio:** samples, richer synth sounds, and music.
7. **Feedback:** `particles` and `haptic`.
8. **New builtins and the constant `pi`.**

Since then, [v0.2.1](#v021-additions) added hold buttons (`on_press`, `on_release`), text
wrapping, text outlines, conditional feedback, a compile-time poly limit, and documents a few
physics, particle and step details. The format string stays `"microgame/0.2"`.

---

## 1. Assets

The top-level `assets` map runs from an id to one asset. The engine never loads files: it
validates assets, gives them dense ids, and refers to them by id in draw ops and sounds. The
shell loads and caches them (`mg_assets(h)` returns the list).

```json
"assets": {
  "bird":  { "svg": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 34 24'>...</svg>", "w": 34, "h": 24 },
  "pipe":  { "image": "https://example.com/pipe.png", "w": 52, "h": 320 },
  "hero":  { "image": "data:image/png;base64,....", "w": 32, "h": 32, "frames": 6, "cols": 6, "fps": 10 },
  "flap":  { "sound": "data:audio/wav;base64,...." },
  "theme": { "sound": "https://example.com/loop.mp3" }
}
```

| Field | Meaning |
|---|---|
| `svg` | Inline SVG markup, which must start with `<svg`. The best choice for LLM-made art: instant and tiny |
| `image` | `https://` URL or `data:image/...` URI (PNG, JPEG, WebP, GIF, SVG) |
| `sound` | `https://` URL or `data:audio/...` URI (WAV, MP3, OGG, M4A) |
| `w`, `h` | Required for images: the size of **one frame** in canvas units. It's the default node size |
| `frames` | Sprite sheet frame count (default 1). Frames are laid out left to right, top to bottom |
| `cols` | Frames per row in the sheet (default `frames`) |
| `fps` | Default animation speed when an `image` node sets no `frame` (default 0, which means frame 0) |

Exactly one of `svg`, `image` or `sound` per asset. Ids follow identifier rules. Validation
code: `E_ASSET` (bad source, missing `w`/`h`, a sound used as an image, an unknown asset id, or
something too big). Limits: 256 assets per game, 256 KB per inline `svg`, 4 MB per `data:` URI.

## 2. New nodes

| Node | Specific props | Notes |
|---|---|---|
| `image` | `asset` (an id, literal or `=` expression giving a string), `w`, `h` (default: the asset's size), `frame` (int; default `floor(t * fps / 1000) % frames` on the presentation clock), `flip_x`, `flip_y` (bool) | Box = `w` × `h`. Common props apply |
| `line` | `x1 y1 x2 y2` (relative to the node's origin), `stroke`, `stroke_width` (default 2) | Box = the bounding box of both ends |
| `poly` | `points` (`list<vec2>` or `list<ivec2>`, relative to the node's origin), `closed` (default true), `fill`, `stroke`, `stroke_width` | Box = the bounding box of the points. Max 256 points (see v0.2.1) |

## 3. Camera and `fixed`

```json
"presentation": {
  "camera": { "x": "= max(0, player.x - 120)", "y": "0" },
  ...
}
```

* `camera.x/y` is the top-left of the view in **world** units (default 0, 0). Every node is
  drawn at `world - camera`.
* A node with `"fixed": true` (and its subtree) ignores the camera. Use it for the HUD (score
  text, buttons).
* Hit-testing and every `pointer` value use world coordinates for world nodes and canvas
  coordinates for fixed nodes. Pointer sources (section 4) report world coordinates.

## 4. New input sources

`inputs.<name>.from` accepts these. The `with` expressions see the source record in scope:

| Source | Fires | Record in scope |
|---|---|---|
| `{"key": "Space"}` | key down (as in v0.1) | `key: {code: string, char: string}` |
| `{"key": "Space", "on": "up"}` | key up | same |
| `{"key": "any"}` (also `"on": "up"`) | every key | same. `key.char` is the printable character (`'a'`, `'A'`, `' '`) or `''` |
| `{"pointer": "down"}` / `"up"` / `"move"` | a pointer anywhere on the canvas that **no** `on_tap`/`on_drag`/`on_press`/`on_release` node took. `move` fires only while the pointer is down | `pointer: {x: float, y: float}` (world coordinates) |
| `{"text": "submit"}` | the player submits typed text (Enter or Done) | `text: {value: string}` |
| `{"text": "change"}` | every edit of the text field | same |

Text sources accept two extra options:

* `"placeholder"`: default `"Type here"`.
* `"max_len"`: default 32, max 200.

If any input has a text source, the shell shows a text field and keyboard, placed at
`presentation.text_field` (`{x, y, w, h, size}` in canvas units, default a bar at the bottom).
The field clears after submit. `key` records now have both `code` and `char`; v0.1 files only
used `code`.

## 5. Physics (optional)

```json
"physics": {
  "gravity": [0, 1500],
  "bounds":  [0, 0, 360, 640],
  "bodies": {
    "bird":      { "state": "bird", "bounded": true },
    "pipes":     { "state": "pipes", "gravity": 0 },
    "platforms": { "state": "platforms", "static": true }
  },
  "collisions": [
    { "a": "bird",   "b": "pipes",     "emit": "crash" },
    { "a": "player", "b": "platforms", "solid": true, "emit": "land" }
  ],
  "on_bounds": [ { "body": "bird", "emit": "crash" } ]
}
```

**Bodies:**
* A body group points at a state variable that is either one record or a `list` of records.
* The record fields are `float`. `x`, `y` (the **center**) are required. `vx` and `vy` are
  optional; without them the body never moves on its own.
* Shape: `r` makes it a circle. Otherwise `w` and `h` make it an axis-aligned box centered at
  `x, y`.
* Extra fields are fine and physics ignores them.

**Group options:**

| Option | Default | Meaning |
|---|---|---|
| `gravity` | 1 if the record has `vy`, else 0 | Gravity scale |
| `static` | false | Never moved by physics |
| `bounded` | false | Kept inside `bounds`. The velocity on the hit axis is multiplied by `-bounce` |
| `bounce` | 0 | Restitution, 0–1 |
| `max_speed` | none | Clamps the speed after gravity is applied |

Gravity and bounds are numbers in canvas units (px/s²), as `[x, y]` and `[x, y, w, h]`.

**Step semantics** (this extends spec A10). Physics runs once per `step`, **after timers and
before `tick`**, as one atomic pseudo-rule:

1. For each non-static body with velocity, in group order and then list order:
   `v += gravity * scale * dt_s`, then clamp to `max_speed`, then `p += v * dt_s`.
   Fast bodies are sub-stepped (up to 8 sub-steps) so nothing moves more than half its
   smallest size per sub-step.
2. `bounded` bodies are clamped to `bounds`. `on_bounds` entries emit their event for each
   body that touched the edge (payload fields `a`, `nx`, `ny`).
3. Collision rules run in file order. For each overlapping pair (`a` index i, `b` index j;
   when `a == b` only i < j is checked) in index order:
   * With `solid`, the bodies are pushed apart along the minimum-translation axis. A static
     body never moves, and two dynamic bodies split the push. Velocity into the contact
     becomes `-bounce *` itself.
   * The `emit` event is queued. Its payload may declare any subset of `a: int` (index in
     group a, 0 for a single record), `b: int`, `nx: float`, `ny: float`. The normal
     `(nx, ny)` points from b toward a, so `ny == -1` means a landed on top of b.
4. The results are written back into the state records, and the emitted events are processed
   (before `tick`), counting toward the 256-events-per-step cap.

Validation codes:
* `E_PHYSICS`: bad group, a missing or non-float field, no shape, or an unknown group in a
  collision.
* `E_BAD_PAYLOAD`: the emit event declares fields other than `a b nx ny`, or the wrong types.

## 6. Audio

The feedback `sound` action has three forms:

```json
{ "sound": { "asset": "flap", "volume": 0.8, "rate": 1.0 } }
{ "sound": { "wave": "square", "note": "C5", "ms": 90, "volume": 0.5, "slide": "C6" } }
{ "sound": { "wave": "triangle", "notes": ["C5", "E5", "G5", "C6"], "step_ms": 70, "volume": 0.6 } }
```

* **Sample:** plays a `sound` asset.
* **Synth:** `slide` glides the pitch to a second note over `ms`.
* **Jingle:** plays each note for `step_ms` in sequence.

Defaults: `volume` 0.6, `rate` 1, `ms` 100, `step_ms` 80. Any field may be an `=` expression.

Music loops one sound asset while `playing` is true (default `status == 'playing'`):

```json
"presentation": { "music": { "asset": "theme", "volume": 0.4, "playing": "= status == 'playing'" } }
```

## 7. New feedback actions

```json
{ "particles": { "x": "= event.x", "y": "= event.y", "count": 16, "color": "#FFD166",
                 "speed": 220, "size": 4, "ms": 600, "gravity": 600, "spread": 360 } }
{ "haptic": "light" }
```

* **particles:** a burst of fading circles in world coordinates, drawn above the scene and
  below `fixed` nodes. The shape of the burst is seeded from the event, so it's the same on
  every replay. Defaults: count 12 (max 64), speed 200, size 4, ms 500, gravity 0, spread 360
  (degrees, centered on up). At most 512 particles are alive at once.
* **haptic:** `light | medium | heavy | success | warning | error`. The shell maps it to
  `navigator.vibrate`, and the iOS host can map it to UIKit feedback generators.

## 8. New builtins and constants

| Builtin | Signature and semantics |
|---|---|
| `split` | `split(string, sep: string) -> list<string>`. `sep == ''` splits into chars |
| `trim` | `trim(string) -> string` (whitespace at both ends) |
| `substr` | `substr(string, start: int, end: int) -> string`. Char indices, end exclusive, clamped like `slice` |
| `starts_with`, `ends_with` | `(string, string) -> bool` |
| `replace` | `replace(string, from: string, to: string) -> string`. Replaces all; an empty `from` changes nothing |
| `parse_int` | `parse_int(string) -> int?`. Trims first; `none` if it isn't an integer |
| `index_of` | now also `index_of(string, string) -> int`, a char index or -1 |
| `atan2` | `atan2(y: num, x: num) -> float`, in radians |
| `sign` | `sign(num) -> same`, giving -1, 0 or 1 |
| `pow` | `pow(num, num) -> float` |
| `fmod` | `fmod(num, num) -> float`. The result takes the sign of the dividend; dividing by 0 is an error |
| `angle` | `angle(ivec2\|vec2) -> float`, which is `atan2(y, x)` |
| `from_angle` | `from_angle(radians: num) -> vec2`, which is `(cos, sin)` |
| `rotate` | `rotate(vec2\|ivec2, radians) -> vec2` |
| `min_of`, `max_of` | `(list<num>) -> num`. An empty list is an error |
| `chance` | `chance(p: num) -> bool`. **Random**: true with probability p |

New constant: `pi` (float).

## 9. Engine API additions (WASM)

| Call | Meaning |
|---|---|
| `mg_key_event(h, code, char, down)` | Full keyboard event. `mg_key` stays as a key down with an empty char |
| `mg_text(h, kind, value)` | `kind` 0 = submit, 1 = change |
| `mg_assets(h)` | JSON list `[{id, name, kind, src, w, h, frames, cols, fps}]` in id order |
| `mg_meta(h)` | Now also carries `text_input: {placeholder, max_len, x, y, w, h, size}` or null |
| `mg_fork(h)` | A new handle with an exact, independent copy of the game (state, scene, input log). Cheap: state is shared copy-on-write. For bot look-ahead |

Frames gain:
* Ops: `image`, `line` and `poly`.
* `audio` entries: `{kind: synth, wave, freqs, step_ms, slide_hz, ms, volume}` or
  `{kind: sample, asset, rate, volume}`.
* `haptics`: a list.
* `music`: `{asset, volume, playing}` or null.

The binary frame format follows the same additions; see `web/FRAME_FORMAT.md`.

---

## v0.2.1 additions

All additive: every v0.2 file means the same as before. The format string stays
`"microgame/0.2"`. `microgame catalog` lists each addition.

### Hold buttons: `on_press` and `on_release`

Two node props with the same shape as `on_tap` (`{"input": ..., "with": {...}}`). Their `with`
expressions see the node locals and `pointer`, like `on_tap`.

* **`on_press`** is sent on pointer down over the node.
* **`on_release`** is sent when the pointer that pressed the node comes up, **wherever it is**
  (on the node or not). `pointer` is the up position. The node locals are the ones saved at the
  down, so a released `repeat` item still knows which item it was.
* A node may have `on_press`, `on_release` and `on_tap` together (and `on_drag`). On down they
  are sent in the order `on_press`, `on_tap`, `on_drag`. On up the drag's last `on_drag` goes
  before `on_release`.
* Hit-testing is the same as for `on_tap`: the topmost target wins, fixed (HUD) targets are
  above world ones, and `pointer` is in canvas units for fixed nodes and world units otherwise.
  A node with only `on_release` is still a target, so the press never reaches the pointer
  sources.
* **Cancelled presses.** A restart sends the pending `on_release` to the game that is ending
  (which then discards it with the rest of its queue), so the restarted game never sees a
  release for a press it didn't get, and an input log recorded from the restart verifies the
  same. A second pointer down before the up releases the first press at the new position.

Hold-to-move with mobile HUD buttons (the pattern in `examples/lantern_ridge.json`):

```json
"inputs": { "right": { "payload": { "on": "bool" },
  "from": [ { "key": "ArrowRight", "with": { "on": "true" } },
            { "key": "ArrowRight", "on": "up", "with": { "on": "false" } } ] } },
...
{ "node": "circle", "fixed": true, "x": 132, "y": 584, "r": 34, "fill": "#FFF",
  "scale": "= if right_held then 0.9 else 1",
  "on_press":   { "input": "right", "with": { "on": "true" } },
  "on_release": { "input": "right", "with": { "on": "false" } } }
```

### Text wrapping: `wrap`

A `text` node with a box width `w` may set `"wrap": true` (a literal bool, default false).
`wrap` without `w` is an `E_PRESENTATION` error.

* The engine breaks the text into lines no wider than `w`, using the same width approximation
  as measuring (`0.6 × size` per character, × 1.05 at weight 600 and above). Lines break at
  spaces; spaces inside a line are kept and spaces at a break are dropped. A word longer than a
  whole line is split at the line width.
* `\n` always starts a new line (with or without `wrap`).
* `h` defaults to the wrapped height: `lines × size × 1.25`. An explicit `h` wins, and the
  block is placed in the box with `valign`.
* The frame's text op carries the lines joined with `\n` plus `line_height` (`size × 1.25`).
  The shell draws each line `line_height` apart with `align` and `valign`.

### Text outlines: `stroke` and `stroke_width` on `text`

`stroke` (a color) draws an outline **under** the fill, so about half its width shows outside
the glyphs. `stroke_width` defaults to 2 when `stroke` is set. Both can be bound (`=`) and
animated like any color or number prop. Without `stroke`, nothing changes. The text op carries
`stroke` (or null) and `stroke_width`.

### Conditional feedback: `when`

A `feedback` entry may have `"when"`: a bool expression that sees `event` (the trigger's
payload) and state, like an `animate_on` `when`. It's pure: random builtins are an
`E_RANDOM_IN_PURE` error. The entry's actions run only when it's true; an evaluation error
counts as false and is reported once.

```json
{ "on": "hit", "when": "event.power >= 3 and lives > 0", "do": [ { "shake": { "px": 10, "ms": 250 } } ] }
```

### Poly limit at validation

A `points` value whose length is known when the file is checked (a JSON list of pairs, or a
list literal such as `"= [vec(0, 0), vec(4, 0), ...]"`) with more than 256 points is an
`E_LIMIT` error at validation, and one with fewer than 2 is an `E_PRESENTATION` error. A
computed list (`map(...)`) is still checked per frame: points past 256 are dropped and an
`E_LIMIT` diagnostic is reported once.

### Clarifications of v0.2 behavior

These already worked this way in v0.2; now they're written down.

* **`on_bounds` normal points inward**, away from the edge the body touched: `ny == -1` means
  the body hit the bottom of `bounds`, `nx == 1` the left edge.
* **Collision `bounce`.** A collision rule accepts its own `bounce` (0–1). Without one it uses
  the larger of the two groups' `bounce`.
* **Particles.** `size` is the **diameter** of each particle. Each particle's speed is random
  between 50% and 100% of `speed` (seeded, so replays look the same).
* **List indices in collision events** (`a`, `b`) refer to the lists as they were when physics
  ran. Rules for earlier events in the same step may already have changed those lists, so
  don't `remove` items from a body list in the collision rule: mark them (`set
  sparks[event.b].taken` to true) and remove the marked items in `tick`, which runs after all
  the step's events.
* **`tick` always runs once per step**, even when the 256-events-per-step budget overflows and
  the remaining queued events are dropped.
