# Microgame authoring format v0.1

The authoring layer turns what a model writes into one flat `microgame/0.2` `game.json` that Artem's
engine validates and runs (`engine/SPEC-v0.2.md`; the 0.2 parts used are assets, `image` nodes,
particles, haptics, feedback `when` and music). This page defines the two things it reads:

- a **fragment**: one reusable game concept (lives, score, a spawn wave), written in `microgame/0.1`
  pieces plus a header that says how it plugs in;
- an **authoring manifest**: what the model writes. It picks fragments, sets their params, and adds raw
  `microgame/0.1` only for what's new.

The **expander** compiles a manifest plus the fragment library into `game.json` and a source map. The
engine never sees fragments, so the engine format needs no imports or modules.

Everything below refers to the engine format by section (A4 types, A6 expressions, A10 rules and so on)
in `microgame-input-format.md`, as amended by `engine/README.md`, "Where the engine differs from or
fills gaps in the spec".

## 1. Fragment

A fragment is a JSON file, `fragments/<id>.fragment.json`:

```json
{
  "fragment": "lives",
  "version": 1,
  "describe": "The player has N lives. Each `hit` costs one. Zero lives loses.",
  "params":   { "count": { "type": "int", "default": 3, "min": 1, "max": 9 } },
  "requires": { "events": { "hit": {} } },
  "types": {}, "state": {}, "functions": {}, "events": {}, "inputs": {},
  "rules": [],
  "objectives": { "win": "<expr>", "lose": "<expr>", "score": "<expr>" },
  "presentation": { "slots": [ { "slot": "hud_top", "node": {} } ], "feedback": [] },
  "art": { "life": { "describe": "One life icon for the HUD", "color": "danger" } },
  "tags": { "mood": ["tense"], "energy": ["medium", "high"] },
  "conflicts": ["sudden_death"]
}
```

The `types` through `rules` sections use exactly the same syntax as the engine format (A4–A10). A
fragment never contains engine code, and it never sets `time_limit`, `on_timeout`, `meta`, `canvas` or
`tokens`: those belong to the game and the look.

### 1.1 Params

| `type` | Extra fields | Substituted into an expression as |
|---|---|---|
| `int` | `min`, `max` | `3` |
| `float` | `min`, `max` | `0.5` (always written with a decimal point) |
| `bool` | | `true` |
| `duration` | `min`, `max` (ms) | `600` (int ms; the manifest may write `"600ms"` or `"2s"`) |
| `string` | `max_len` | `'fog'` (see 1.6 for quotes) |
| `enum` | `values` | `'top'` |
| `color` | | not substituted into expressions; used only in presentation literals |

Every param has a `default`. The expander checks each value's type and range before anything else
(`A_PARAM_TYPE`, `A_PARAM_RANGE`, `A_UNKNOWN_PARAM`).

**Placeholders are `@name`**, not `{name}`: braces already mean record literals in A6, and `@` isn't
used anywhere in the engine's grammar. `@@` is a literal `@`.

- **Expression fields** (every *(expr)* field in A5–A11, `with` values, and `=` presentation props):
  `@name` anywhere in the string becomes the param rendered as an expression literal, per the table
  above. `"init": "@count"` becomes `"init": "3"`.
- **Literal fields** (everything else, such as `end`, `every`, node props without `=`): only a string
  that is exactly `"@name"` is replaced, by the param's JSON value. `"size": "@size"` becomes
  `"size": 18`, and `"end": "@on_end"` becomes `"end": "lose"`. A `duration` becomes a `"600ms"` string,
  so `{ "every": "@every" }` stays a duration literal.
- Nowhere else. Placeholders in keys, names or partial literal text are `A_PARAM_PLACEMENT`.

**Optional pieces.** A rule, a feedback entry, a single feedback action, a slot entry, any node inside
a `children` list, or an objective can carry `"include": "<condition>"`. The condition reads only params, so the expander decides it once: the piece
is either kept (minus the `include` key) or dropped. Objectives use the long form
`"win": { "include": "@target > 0", "expr": "score >= @target" }`. Conditions are `@param` compared
with a literal (`== != < <= > >=`), joined by `and`/`or`. Without this, a param that turns something off
leaves dead `10 > 0 and …` guards in the output.

**Game params** are read-only values every fragment can use, in either kind of field and as a param's
`default`: `@game.duration_ms` (the game's `time_limit`, or else `meta.duration_s × 1000`),
`@game.canvas_w` and `@game.canvas_h` (360 × 640, or 360 × 780 with `look.canvas: "tall"`, 2.4), and
`@game.safe_top` and `@game.safe_bottom` (the safe area's top and bottom, 2.4).

**Art params** describe the game's sprite for each role the fragment declares in its `art` header
(1.7): `@art.<role>` (bool: the game has one), `@art.<role>.id` (string: its asset id),
`@art.<role>.frames` (int), `@art.<role>.aspect` (float, height ÷ width) and `@art.<role>.color` (a
`#RRGGBB` the sprite names for particles, else the role's fallback token like `$accent`; literal fields
only). Using `@art.<role>` for a role the header doesn't declare is a library error.

### 1.2 Names, `requires` and `bind`

A fragment declares names in its own sections: state, types, functions, events, inputs, timer ids and
rule ids. Those are what it **provides**. It doesn't list them again; the expander reads them from the
sections.

- **Public names** are everything without a leading underscore. Other fragments and the game can read
  public state and functions, emit public events, and write public state.
- **Private names** start with `_`. The expander renames them to `<use id>_<name>` (for example
  `_end` in a use with id `countdown` becomes `countdown__end`), so they can't collide or be used from
  outside. Rule ids and timer ids (`after.id`) are always private, with or without the underscore.

`requires` lists names the fragment uses but doesn't declare, **with their types**:

```json
"requires": {
  "state":     { "player": "vec2" },
  "events":    { "hit": {} },
  "functions": { "is_blocked": { "params": { "c": "ivec2" }, "returns": "bool" } }
}
```

The expander checks that each requirement is declared by another fragment or by the game, with the same
type or payload (`A_MISSING_REQUIREMENT`, `A_REQUIREMENT_TYPE`).

**`bind` renames a fragment's public names at the point of use**, for both requires and provides:

```json
{ "fragment": "lives", "id": "lives", "params": { "count": 3 },
  "bind": { "hit": "crashed", "lives": "hearts" } }
```

This use listens for the game's `crashed` event and keeps its count in `hearts`.

Requirement payloads are written bare: `"events": { "flip": { "index": "int" } }`, and
`"inputs": { "tap_cell": { "cell": "ivec2" } }`, without the `payload` wrapper that declarations use.

**Joining an event:** binding one of a fragment's own events onto an event that already exists, for
example `"bind": { "point": "pair_found" }` on `score`, makes the fragment listen to that event instead
of declaring a new one. The payloads must match (`A_REQUIREMENT_TYPE` otherwise).

**Collisions:** if two uses provide the same public name, the second use's name gets a `_2` suffix (then
`_3` and so on), and the expander reports `W_AUTO_RENAMED` with the new name. If the game declares a name
a use provides, that's `A_DUPLICATE_NAME`. The game should drop its own copy, or `bind` the fragment's
to another name. The game reads that warning
like any other. Explicit `bind` is preferred, because an auto-renamed copy still listens for the
un-renamed requirements. Two uses of a fragment that lists the other in `conflicts` are `A_CONFLICT`.

**What gets renamed:** an identifier token inside an expression string, unless it comes after `.`, is a
record field key (`{x: …}`), or is inside a string literal. Also renamed: effect targets (`set`, `incr`,
`push`, `remove`), `on`, `emit`, `after.emit`, `after.id`, `cancel`, rule `id`, `inputs[*].when`,
`on_tap.input`, `on_drag.input`, `on_press.input`, `on_release.input`, `animate_on` keys and `feedback[*].on`. Payload field names are never
renamed. Library rule: a fragment's lambda params and `let` names must not equal any name it provides or
requires (checked in CI), so token renaming is always safe.

### 1.3 Objectives

- `win` from every fragment and from the game are joined with `or`, in `uses` order and then the game's.
  The same goes for `lose`. The engine checks `win` before `lose`.
- `score`: at most one fragment may set it. If the game sets `score`, the game's wins. Two fragments
  setting it is `A_CONFLICT`.
- `time_limit` and `on_timeout` come only from the game. A game with no way to end is left for the
  engine to report as `E_NO_END_CONDITION`.

### 1.4 Presentation and slots

A fragment adds nodes to named **slots**. The look decides where the slots go:

| Slot | What goes there | Capacity |
|---|---|---|
| `hud_top` | short counters: lives, score, timer | 3 nodes |
| `hud_bottom` | hints, secondary counters | 2 nodes |
| `playfield` | game objects, in canvas coordinates | no limit |
| `overlay` | anything drawn above the playfield | no limit |

Too many nodes in a slot is `A_SLOT_FULL`. Nodes in a slot keep `uses` order, then the game's own. A
fragment's `feedback` entries are appended to the game's in the same order.

Fragments use only the **standard token roles**: `$primary $secondary $accent $ink $bg $danger
$surface`, plus what the kit defines for every game: the on-colours for text on a filled role
(`$on_primary $on_secondary $on_accent $on_danger $on_surface $on_bg`, computed against the fills the game
really uses) and the text variants for small text in a role colour (`$primary_ink $secondary_ink
$accent_ink $danger_ink`, 4.5:1 on bg and surface). Anything else is `A_UNKNOWN_TOKEN`. Games may also define their own tokens (2.4).

Nodes may carry `"role": "avatar" | "hazard" | "pickup" | "tile" | "hud"`, which tells the look how to
skin them. The engine doesn't have `role` yet (Artem's call), so for now the expander removes it from
the output and keeps it in the source map. `repeat` takes its template under `template`, not `node`.

### 1.5 Tests

Each fragment ships `fragments/tests/<id>.test.json`: a minimal manifest that uses it, plus an input
script and the expected end state (`won`, `lost` or `playing`, and a time window). CI expands it, runs
`microgame validate --json` (must be zero errors), then `microgame replay --script`.

### 1.6 Strings

The engine's string literals are single-quoted. Whenever the expander writes text into an expression (a
`string` param, a `content` value), it replaces `'` with `’` (U+2019) and rejects control characters.
Text stays readable, and nothing can break out of a literal.

### 1.7 Sprite roles

A fragment that draws something game-specific (an avatar, hazards, cards, buttons) declares the
**roles** it can draw with the game's art, in an `art` header:

```json
"art": {
  "avatar": { "describe": "The player, centred on `player`, about 2.8 × size wide.", "color": "primary" }
}
```

`describe` tells the model what to draw and at what size; `color` is the standard token the role's
particles fall back to. Each role's slot entries come in two versions, picked with `include` on the
art params (1.1): the sprite as an `image` node when the game has one, and today's shape when it
doesn't, so games without art keep working unchanged:

```json
{ "slot": "playfield", "include": "@art.avatar",
  "node": { "node": "image", "asset": "@art.avatar.id", "anchor": "center", "x": "= player.x", "y": "= player.y",
            "w": "= @size * 2.8", "h": "= @size * 2.8 * @art.avatar.aspect" } },
{ "slot": "playfield", "include": "not @art.avatar",
  "node": { "node": "circle", "x": "= player.x", "y": "= player.y", "r": "@size", "fill": "$primary" } }
```

The fragment sizes the sprite from its own geometry (the hit circle or cell), so art never changes how
the game plays. Variants (card faces, pads, bins, tile values, scene pictures) are frames of one
sprite, picked with `"frame": "= symbol"`; the engine wraps frame numbers past the last frame. Where a
tap target turns into a picture, keep a transparent `rect` with the `on_tap` on top of it.

The game's sprite for a role is the one with the role's name. A use can point a role at another
sprite, or at `false` to keep the shape, with `"art": { "hazard": "fogbank" }` (2.1).

| Fragment | Roles |
|---|---|
| `player_drag`, `lanes` | `avatar` |
| `gravity_jump` | `avatar`, `ground` (a strip along the top of the floor) |
| `spawn_wave` | `hazard` |
| `pickups` | `pickup` |
| `gap_walls` | `wall` (stretched to each wall part), `wall_cap` (at the gap edge, as wide as the wall) |
| `lives` | `life` (one HUD icon per life) |
| `grid_board` | `cell` (a plain cell, such as a card back) |
| `match_pairs` | `card` (one frame per symbol) |
| `tile_slide` | `tile` (one frame per value step: base, 2 × base, …) |
| `sort_bins` | `bin` (one frame per bin) |
| `sequence_memory` | `pad` (one frame per pad) |
| `quiz` | `button` |
| `choice_story` | `scene` (a picture; one frame per scene, or one for all), `button` |
| `chess_board` | `piece` (12 frames: K Q R B N P white, then k q r b n p black) |

### 1.8 Sound moments and feel

Fragments don't write synth notes for common moments. A feedback action `{ "moment": "<name>" }` plays
the game's sound for that moment (2.9): `tap`, `pickup`, `hit`, `combo`, `level`, `countdown`, `win` or
`lose`. Every fragment gives feedback by default, without the game wiring it up:

- **Particles** in the art's colors where something happened: `collide` at `hit_at`, `pickups` at the
  item, `match_pairs` on both cards, `sort_bins`, `quiz` and `sequence_memory` on the answer.
- **Pop and squash** with `animate_on`: avatars squash on lane changes and landings, cells, cards,
  pads, bins, answers and story buttons pop when tapped, pickups pop in, HUD counters pulse.
- **A light shake and a haptic** on hits, misses and wrong answers; light haptics on taps and pickups.
- **Sound moments** as above. Who plays what: the cause makes the sound (`collide` plays `hit`, a
  wrong answer plays `hit`), so `lives` only shakes and buzzes; `score` plays `pickup` on `point`, so
  `pickups` only sparkles.

Use feedback `when` (v0.2.1) so repeated events don't spam: `collide` with a short `grace` fires its
feedback at most every 300 ms, `combo` plays only once the streak is past 1. The `when` and `on` of a
fragment's feedback are renamed like everything else (1.2).

## 2. Authoring manifest

```json
{
  "authoring": "microgame-authoring/0.1",
  "meta": { "title": "Fog Dodge", "instructions": "Drag to steer through the fog. Survive 45 seconds.", "duration_s": 45 },
  "uses": [
    { "fragment": "lives",      "params": { "count": 3 }, "bind": { "hit": "fog_hit" } },
    { "fragment": "spawn_wave", "params": { "every": "600ms", "kind": "fogbank", "from": "top" },
      "art": { "hazard": "fogbank" } }
  ],
  "types": {}, "state": {}, "functions": {}, "events": {}, "inputs": {},
  "rules": [],
  "objectives": { "time_limit": "45s", "on_timeout": "win" },
  "presentation": { "slots": [], "feedback": [] },
  "look": { "id": "paper", "tokens": { "primary": "#3A6EA5" } },
  "art": { "palette": { "bg": "#0E1733" }, "sprites": { "fogbank": { "svg": "<svg viewBox='0 0 64 48'>…</svg>" } } },
  "sound": { "set": "soft", "music": false },
  "feel": { "shake": false },
  "content": { "theme_words": ["fog", "cable car", "hill"] }
}
```

### 2.1 `uses`

Each entry has `fragment`, optional `id` (default: the fragment name, then `<name>_2` and so on),
`params`, `bind`, `art` (2.8) and `version`. Without a version, the expander uses the library's latest and records
which one it used (2.6). Unknown fragments are `A_UNKNOWN_FRAGMENT`, with a did-you-mean hint.

### 2.2 The game's own sections

`types` through `rules` are raw engine format, the "novelty path". They can read and write anything a
use provides, under its bound name. The game's rules run after every fragment's rules for the same
event, because the expander writes fragment rules first (A10: rules run in file order).

**Typed answers.** An input with a `{"text": "submit"}` or `{"text": "change"}` source
(`engine/SPEC-v0.2.md` 4) gets the app's native text field and keyboard (docs/BUBBLES.md 7.11).
`presentation.text_field` (`{x, y, w, h, size}` in canvas units) places it. The expander copies it to
the game as written; without it, the first fragment that places one (its `presentation.text_field`,
params allowed) does, else the field is a bar at the bottom. Put it in the top half: the iPhone
keyboard covers the bottom ~45% while the player types (the app lifts the game when the field would be
hidden). Give gate bots the strings to try with `playtest.text_candidates` (2.6); a fragment may supply
`playtest` hints too, which the game's own override. `typed_answer` and `qa_bank` (version 2) bring their
own field. The drawn `keyboard` fragment is only for games where the keys are the game (Wordle-style
letter colours, letter tiles, crossword cells); its presses are taps and need none of this.
`authoring/tools/convert-native-keyboard.mjs` moves a built game's keyboard-typed answer onto a text
input with the same check and score.

### 2.3 Objectives

These are the game's own `win`, `lose` and `score`, plus `time_limit` and `on_timeout`. See 1.3 for how
they combine.

### 2.4 Look

`look.id` picks a preset: `glow paper pixel neon ink clay riso chalk`. Each preset is
`looks/<id>.look.json` and has standard-role tokens, a `font` and a `layout`. `look.tokens` overrides
standard roles and may add the game's own tokens (for example `snake_head`). Fragments never see the
game's own tokens.

`layout` is a node tree in which `{ "slot": "<name>" }` placeholders stand where a slot's nodes go; the
expander splices them into the parent's `children`. Every layout puts `playfield` first, in a `group` at
(0, 0), so playfield nodes use plain canvas coordinates and the HUD paints on top. The look's `font` is
set on every `text` node that doesn't set its own.

Tokens are applied in this order, later winning: the look's preset, `art.palette` (2.8), `look.tokens`.
`art.font` replaces the look's font.

**Canvas.** Games are 360 × 640 unless `look.canvas` is `"tall"` (360 × 780, 19.5:9, the shape of a
phone; also `{w: 360, h}` or `"legacy"`; the expander's `options.canvas` sets a default). A tall canvas
fills a phone screen: its top 110 and bottom 96 units run under the player's bars and hold background
only (the backdrop is drawn at the full canvas size), and key content (taps, text, the HUD) stays in the
safe area between them, y 110 to 684. The look's `hud_top` and `hud_bottom` stacks move to the top and
bottom of the safe area. Game params `@game.safe_top` and `@game.safe_bottom` give the safe area (0 and
`canvas_h` on a 360 × 640 canvas). `playtest/fill-check.mjs` checks all of this (`F_*` codes).

### 2.5 Content

`content` holds words and lists the model writes, kept out of expression strings so they can be read
and moderated in one place. In v0.1 a value is a string or a list of strings. Each key that an
expression reads, as `content_<key>`, becomes a state entry of type `string` or `list<string>`. Writing
to one is `A_CONTENT_WRITE`. Keys nothing reads stay in the manifest only (covers, captions).

Fragments can't read `content_<key>` themselves, because a content key only becomes state when the
game's own expressions read it. A fragment that needs content (`quiz`, `sort_bins`, `choice_story`)
requires a function or a state entry instead, and the game supplies it from content, for example
`"functions": { "quiz_questions": { "params": {}, "returns": "list<string>", "body": "content_questions" } }` or
`"state": { "story_lines": { "type": "list<string>", "init": "content_story_lines" } }`. A `content`
requirement kind is a possible later addition.

### 2.6 Playtest hint

`"playtest": { "progress": "<expr>", "text_candidates": "<expr>", "tap_pairs": "<expr>" }`. All are optional.

- `progress` tells the playtest bots what "doing better" means (lights switched off, distance to the
  food, lives kept) when the score alone doesn't show it.
- `text_candidates` is for games with a text input (2.2). It's a `list<string>` expression for the
  strings worth submitting right now, for example `content_words` or `[answer, upper(answer)]`. It
  can read whatever the game's own expressions read. Each bot decision submits one of them (at most
  12, picked at random when there are more), then clears the field. Stronger bots pick the one that
  does best in look-ahead. Without a hint, the bots submit strings found in the game's state.

- `tap_pairs` is for board games where a move is two taps (pick a piece, then its square). It's a
  `list<list<float>>` expression: each item is `[x1, y1, x2, y2]` in canvas units. Each bot decision may
  make one pair (at most 40, picked at random when there are more) as two taps in a row; stronger bots
  pick the pair that does best in look-ahead. The input log records the two taps. `chess_board` gives
  every legal move this way.

The expander writes a second copy of the game for the gate. It has a hidden `__progress` (float),
`__text_candidates` (`list<string>`) and `__tap_pairs` (`list<list<float>>`) state, which `tick` rules update. The shipped `game.json` never
contains them. Errors in either expression point at `/playtest/progress` or `/playtest/text_candidates`.
`playtest.texts` is accepted as another name for `text_candidates` (errors still point at
`/playtest/text_candidates`).

### 2.7 Inside Bubbles

A Bubble manifest with `formula: "microgame"` carries the **expanded** `game.json` as JSON text in
`content.game_json`, so the player never needs the expander, and this authoring manifest as text in
`content.authoring_json`, for remixing (text, so key order survives the app's sorted-key JSON)
and lineage (docs/BUBBLES.md 7.11). `expander/wrap.mjs` (`wrapGame`) builds it. `brief`, `lineage`,
`chain`, `style`, `seed` and `studio` are the usual Bubble fields. The expander adds the fragment versions
it resolved to `lineage`, so an old Bubble expands the same way after the library moves on.
(An earlier beta draft put this manifest under a top-level `game`; the CLI still reads that.)

### 2.8 Art

`art` is the game's own look, made from the user's prompt. Every part is optional; whatever is missing
comes from the look preset and the fragments' fallback shapes.

```json
"art": {
  "style": "Moonlit mountain night: navy sky, lavender fog, a red cable car with glowing windows.",
  "palette": { "bg": "#0E1733", "surface": "#1C2850", "primary": "#7FE3FF", "accent": "#FFC86B",
               "ink": "#EAF2FF", "secondary": "#6C7BD9", "danger": "#FF8A7A" },
  "font": "Avenir Next",
  "backdrop": { "svg": "<svg viewBox='0 0 360 640'>…</svg>" },
  "sprites": {
    "avatar":  { "svg": "<svg viewBox='0 0 48 56'>…</svg>", "color": "#FFB08A" },
    "fogbank": { "svg": "<svg viewBox='0 0 64 48'>…</svg>" },
    "card":    { "svg": ["<svg viewBox='0 0 64 64'>…</svg>", "<svg viewBox='0 0 64 64'>…</svg>"] },
    "firefly": { "svg": ["<svg …>glow</svg>", "<svg …>bright</svg>"], "fps": 6 },
    "photo":   { "image": "data:image/png;base64,…", "w": 64, "h": 64 }
  }
}
```

- **`palette`** sets the standard token roles (`primary secondary accent ink bg danger surface`) as
  `#RRGGBB`. It fills the look's tokens, so every fragment's text, HUD and fallback shapes follow it.
  `bg` is also the canvas background and the Bubble frame's color. Put game-only colors in
  `look.tokens`.
- **`font`** is one of: `system`, `Inter`, `Fraunces`, `Space Grotesk`, `Silkscreen`, `Avenir Next`,
  `Futura`, `Gill Sans`, `Optima`, `Georgia`, `Baskerville`, `American Typewriter`, `Chalkboard SE`,
  `Marker Felt`, `Noteworthy`, `Menlo`, `Courier New`. Any family the app bundles (`authoring/fonts/fonts.json`, e.g. `Bowlby One`,
  `Cinzel`, `Press Start 2P`) is allowed too.
- **`type`** is the game's look (`authoring/kit/README.md`): `{ "kit": "look/1", "vibe": "game_show",
  "pairing": "marquee", "seed": 123 }`, normally written by the pipeline from the plan's words and the
  game id. The expander sets every text node on the pairing's fonts, weights, case and modular scale,
  text colours on the palette, and the pairing's outline under display text. An unknown vibe or
  pairing is `A_ART_FIELD` at `/art/type`.
- **`backdrop`** is one sprite drawn under everything at the canvas size (360 × 640).
- **`sprites`** maps a name (lowercase, digits and `_`, up to 24 characters; not `backdrop` or
  `music`) to a sprite. A sprite named after a role a fragment draws (1.7) is drawn by that fragment;
  a use's `"art": { "<role>": "<sprite>" }` picks another one. The game's own nodes draw any sprite by
  name: `{ "node": "image", "asset": "firefly", … }`. A sprite nothing draws is `W_ART_UNUSED`.
- **A sprite** has exactly one source:
  - `svg`: inline SVG (preferred), or a **list of SVGs**, one per frame; the expander lays them out as
    a sprite sheet, so each frame keeps its own `viewBox` and ids.
  - `image`: a `data:image/png|jpeg|webp|gif;base64,…` URI, with `w` and `h` (one frame's size).

  and optionally `w`, `h` (the frame's size in canvas units; default from the `viewBox`, longest side
  64), `frames` and `cols` (for a single SVG or image that is already a sheet), `fps` (animate on its
  own; a fragment that picks frames, like cards, ignores it) and `color` (`#RRGGBB`, for particles).
- The fragment decides the drawn size from its own geometry and keeps the sprite's aspect ratio, so
  draw sprites square-ish and centred, with the subject filling the `viewBox`. For HUD icons and
  numbered tiles, keep the middle calm: text is drawn on top.
- The expander writes the sprites into the engine's `assets` (asset id = sprite name) and validates
  them in the engine (`E_ASSET`).

**SVG rules.** Every SVG goes through the sanitizer (`expander/svg.mjs`) before anything else. Anything
it rejects is an `A_ART_SVG` error for the model, at the SVG's pointer, saying what to change. It
**keeps** shapes, paths, text, groups, `defs`, `use`/`symbol`, gradients, patterns, clip paths, masks,
markers and filters (blur, drop shadow, turbulence and the other `fe*` primitives), and `style`
attributes and elements. It **rejects**:

- `<script>`, `<foreignObject>`, links (`<a>`), SMIL animation (use frames), `<iframe>`, `<embed>`,
  `<object>`, media elements and web fonts;
- any `on…` event attribute, and namespaced attributes other than `xlink:href`, `xml:space` and
  `xmlns:xlink`;
- `href` or `xlink:href` that doesn't start with `#`, except `<image>` embedding a
  `data:image/png|jpeg|gif|webp` URI; any `url(…)` that isn't `url(#id)`; `@import`; `javascript:` or
  `data:text` anywhere (entity-encoded too);
- `<!DOCTYPE>`, `<!ENTITY>`, `<?xml …?>`, anything before `<svg` or after `</svg>`, unclosed tags;
- an SVG without a `viewBox` (or numeric `width` and `height`);
- **size:** a sprite over 24 KB, the backdrop over 64 KB, more than 2,000 elements or 32 levels of
  nesting, an `image` over 512 KB, more than 32 sprites, or all the art together over 192 KB.

Other art errors: `A_ART_FIELD` (an unknown or malformed field), `A_ART_PALETTE`, `A_ART_FONT`,
`A_ART_IMAGE`, `A_ART_SIZE`, `A_UNKNOWN_ART_ROLE` (a use maps a role its fragment doesn't draw) and
`A_ART_MISSING` (a use maps a role to a sprite that doesn't exist).

### 2.9 Sound

Every sound is synthesized: engine synth notes, slides and jingles, and music rendered by the expander
into a short WAV loop. `sound` picks a sound for each **moment** that fragments play (1.8):

| Moment | When |
|---|---|
| `tap` | a small player action: a tap on a cell, a lane change, a hop, a choice |
| `pickup` | something good: a point, a pickup, a right answer, a pair |
| `hit` | something bad: a hit, a miss, a wrong answer |
| `combo` | a streak grows, tiles merge, a pattern is repeated |
| `level` | a step up: a new wave or level, a checkpoint, passing a friend |
| `countdown` | each of the last seconds on a `countdown` clock |
| `win`, `lose` | the stings at the end (every game gets them, with confetti and a haptic on a win) |

```json
"sound": { "set": "arcade", "volume": 0.7, "music": false,
           "moments": { "hit": "thud", "win": { "wave": "triangle", "notes": ["C5", "E5", "G5", "C6"], "step_ms": 90 } } }
```

- **`set`** (default `classic`) is a named sound set from the library (`expander/sound.mjs`):

  | Set | Feel | Music |
  |---|---|---|
  | `classic` | plain, clear synth beeps | none |
  | `soft` | quiet, rounded sine tones for calm games | `drift` |
  | `arcade` | bright square-wave bleeps for fast games | `bounce` |
  | `chime` | bells and sparkles for puzzles and pairs | none |
  | `retro` | chiptune blips | `chip` |
  | `cozy` | wooden plucks for stories and slow play | `lullaby` |

- **`moments`** overrides single moments: a preset name, a synth body (`wave` sine, square, triangle
  or sawtooth; `note` like `"C5"`, `"F#4"` or Hz; optional `slide`, `ms`, `volume`), a jingle body
  (`notes`, up to 8, with `step_ms`), or `false` for silence. Presets: `blip tick click pluck bubble
  pip` (taps), `ding coin sparkle chirp bell woodblock` (good), `thud buzz zap bonk crunch` (bad),
  `rise arpeggio shimmer levelup chime` (streaks and steps), `fanfare tada glow hooray` (wins),
  `sigh fall wah powerdown` (losses).
- **`volume`** (0 to 1, default 1) scales every sound in the game, the game's own included. `0` is
  silent.
- **`music`**: absent means the set's music, `false` none, `true` the set's (or `lullaby`), a name
  (`lullaby drift bounce chip`) that loop, or your own `{ "melody": [eighth notes, null for a rest,
  up to 32], "bass": [quarter notes, up to 16], "bpm": 50–180, "wave": …, "volume": … }`. It plays while
  the game is playing.
- **`clips`**: a list of short **original** tunes for listen-and-answer games (guess the decade, which
  instrument, name the jingle). Clip `i` becomes the sound asset `clip_<i>`. The `play_clip` fragment
  plays clip `i` for quiz question `i`; a game can also play one itself with
  `{ "sound": { "asset": "clip_2" } }` or `"asset": "= 'clip_' + str(n)"`. Never a real song's melody.

  ```json
  { "style": "80s", "bpm": 112, "bars": 2, "lead": "A4/8 A4 C5 A4 E5/4 D5/8 C5 D5 D5 F5 D5 E5/2", "chords": "Am F" }
  ```

  `style` (`50s 60s 70s 80s 90s 00s 10s chip baroque plain`) picks the instruments, drums and recording
  colour; you write the notes. `lead` (and `bass`) are notes with an octave (`C5`, `F#4`, `Bb3`) or `r`
  for a rest, with `/1 /2 /4 /8 /16` or dotted `/4.` durations that carry to the next notes (the first
  defaults to `/4`); fill exactly `bars` bars (16 sixteenths a bar). `chords` is one chord a bar
  (`Am F C G`) or with durations (`Am/2 G/2`); qualities `m 7 maj7 m7 m7b5 dim dim7 aug sus2 sus4 add9 6
  m6 9 5`. Optional: `bpm` (50–200), `bars` (1–8, default 4), `meter` (4 or 3), `swing` (0–1), `bass`
  (`auto`, `none`, a pattern `root root8 octave walk root_fifth offbeat sub`, or notes), `drums` (`auto`,
  `none`, a groove `shuffle backbeat disco gated house breakbeat rnb trap chip waltz`, or
  `{"kick": "x...x...", "snare": "....x...", "hat", "open", "clap", "tamb", "rim"}`), `lead_sound`,
  `chord_sound`, `bass_sound` (`sine triangle square pulse chip saw supersaw brass strings pad organ piano
  epiano bell pluck harpsichord flute bass synth_bass fm_bass sub chip_bass`), `comp` (`pad stabs offbeat
  strum arp boogie block`). Use the era's rhythm, not only straight eighths. Up to 12 clips, each under
  10 s and all under 80 s; 2-bar clips keep a game small (about 30 KB a second of clip, half that past
  30 s). The expander renders them into WAVs, the same bytes every time. Errors: `A_SOUND_CLIP`.

So "softer" is `"volume": 0.5` (or `"set": "soft"`), "more arcade" is `"set": "arcade"`, and "no
music" is `"music": false`. The game can still play its own sounds in `presentation.feedback`, as a
`sound` action or a `{ "moment": … }`. A game's own sound on an event replaces the library's moments on
that event (its own `win` sound replaces the win sting), and one moment on one event plays once even
when two fragments ask for it. Errors: `A_SOUND_SET`, `A_SOUND_MOMENT`, `A_SOUND_PRESET`,
`A_SOUND_FIELD`.

### 2.10 Feel

`feel` turns the default game feel down: `{ "particles": false, "shake": false, "haptics": false }`
(each defaults to true) removes those actions from every feedback entry, the fragments' and the
game's. Unknown keys are `A_FEEL_FIELD`.

### 2.11 For the prompt

<!-- for-the-prompt: start. The Studio composer pastes this block into Muse's prompt as is. -->

```text
ART AND SOUND. A new game always has "art" (palette, font, backdrop, and a sprite for every role
its fragments draw and every piece it draws itself) and "sound". "feel" is optional. When you change
an existing game, keep its art and sound unless the request is about them.

"art": { "style": "<one line>", "palette": {...}, "font": "<font>", "backdrop": {"svg": "..."}, "sprites": {...} }
- palette: #RRGGBB for primary secondary accent ink bg danger surface. ink must read on bg and surface.
- font: system, Inter, Fraunces, Space Grotesk, Silkscreen, Avenir Next, Futura, Gill Sans, Optima,
  Georgia, Baskerville, American Typewriter, Chalkboard SE, Marker Felt, Noteworthy, Menlo, Courier New.
- backdrop: one SVG with viewBox "0 0 360 640", drawn under everything. Keep the middle quiet so
  the game reads on top; put detail at the edges.
- sprites: { "<name>": { "svg": "<svg viewBox='0 0 W H'>...</svg>", "color": "#RRGGBB" } }.
  Name a sprite after a role your fragments draw (each fragment's art header lists its roles,
  what to draw and how big), or map a role with "art": {"<role>": "<sprite>"} on the use.
  For variants (card faces, pads, bins, tile values), or a short animation, give "svg" as a
  list of SVGs, one per frame; add "fps" for an animation. "color" is the sprite's main color,
  used for its particles.
- SVG rules: start with <svg and include a viewBox; fill the viewBox with the subject, centred.
  Use shapes, paths, gradients, patterns, clip paths and filters freely. No <script>, no on...
  attributes, no <foreignObject>, no <a>, no <animate> (use frames), no links or url(...) outside
  the SVG (only href="#id" and url(#id)), no <image> except data:image/png|jpeg|gif|webp. Sprites
  up to 24 KB, the backdrop up to 64 KB. Write attributes with single quotes so the JSON stays
  readable.
- Make the player stand out from hazards (shape and color), and keep HUD icons and numbered
  tiles simple in the middle: text is drawn on top. Draw your own designs: when the person asked
  for a franchise or theme, draw its world and characters in your own style, but never trace a
  logo or copy another game's art.

"sound": { "set": "<classic|soft|arcade|chime|retro|cozy>", "volume": 0..1, "music": true|false|"<lullaby|drift|bounce|chip>", "moments": {...}, "clips": [ {"style", "bpm", "bars", "lead", "chords"} ] }
- Pick the set from the mood and energy of the brief: soft or cozy for calm, arcade or retro for
  fast, chime for puzzles. Moments: tap pickup hit combo level countdown win lose; override one
  with a preset name, {"wave","note","slide","ms","volume"} or {"wave","notes":[...],"step_ms"},
  or false for silence. "Softer" = lower volume or set soft; "no music" = "music": false.

"feel": { "particles": true, "shake": true, "haptics": true }  (turn one off for calmer games)
Fragments already add particles, pops, shake, haptics and the sound moments; don't re-add them.
```

<!-- for-the-prompt: end -->

### 2.12 Typed answers and fuzzy matching

Games where the player types their own answer use `typed_answer` (the iPhone keyboard); games that check typed
text with their own rules use `fuzzy_match`. Both match with the same deterministic rules
(`expander/fuzzy.mjs`), run inside the engine, so the phone, the bots and replay checks agree.

- **Answer bank** (`ta_answers()`, one string per prompt): tiers split by `|` (most common first),
  answers in a tier by `,`, and an answer's other accepted names after it, joined by `=`:
  `"harry potter=harry,hermione granger=hermione|neville longbottom=neville"`. The first name is the one
  shown after a match (state `last_answer`). Aliases are true other names (nicknames, short forms,
  translations), never misspellings: typos are handled for you. Strings without `=` are the original
  format and still work.
- **Matching:** case, accents, punctuation, a leading `the`/`a`/`an`, word order, plurals and number
  words (`three` = `3`) are ignored. Typos are forgiven by length: names of 4 letters or fewer must be
  exact, 5–7 letters allow one typo, longer names pass at `threshold` (0.82 by default; Damerau-
  Levenshtein and token-set ratios). So `cat` never matches `car`, `zebar` matches `zebra`, and
  `wingardium leviosaa` matches `Wingardium Leviosa`. `phonetic: true` also accepts names of 5+ letters
  that sound alike. The best-scoring name wins; ties go to the more common tier.
- **Params** (both fragments): `threshold` (float 0.5–1.0, 1.0 = exact after normalizing) and
  `phonetic` (bool).
- **fuzzy_match functions:** `fuzzy_ok(input, entry)`, `fuzzy_best(input, entries)` (index or -1),
  `fuzzy_score(input, name)` (0..1), `fuzzy_key(s)` (normalized text), `fuzzy_passes(input, name, score)`,
  `fuzzy_entry(input, entry)` (best passing score or -1.0). An entry is `"answer=alias=…"`.
- **Generated code:** the matching functions in both fragment files are written by
  `tools/make-fuzzy-fragments.mjs` from `expander/fuzzy.mjs`; edit the JS and rerun it.
  `tools/test-fuzzy.mjs` checks the JS rules, that the fragments are current, and (with an engine)
  that the engine agrees with the JS on every case.

### 2.13 Score model

`"score"` is optional. It says what the game's board ranks and how, so a time trial ranks the fastest
first and a run that quits early can't win. Without it, the board ranks points, higher first, best run,
every run counts.

```json
"score": { "kind": "count_in_time", "measures": "orders served before the timer ends", "unit": "orders",
           "direction": "higher", "counts_when": "any", "aggregate": "best", "tie_break": "earlier",
           "format": "{n} orders", "events": ["order_done"] }
```

| `kind` | Ranks | `direction` | `counts_when` | Default `format` |
|---|---|---|---|---|
| `points` | points | higher | any | `{n}` |
| `time_to_complete` | ms to finish (the run time) | lower (required) | finished (required) | `m:ss.t` |
| `count_in_time` | how many in the time | higher | any | `{n}` |
| `survival_time` | ms alive (the run time) | higher | any | `m:ss.t` |
| `accuracy` | whole percent, 0–100 | higher | finished (required) | `{n}%` |
| `distance` | distance | higher | any | `{n} m` |
| `tiered_points` | rarity-tier points (Krillion-style) | higher | any | `{n}` |
| `streak` | best run of correct | higher | any | `{n}` |

- **Every score is a whole number.** Time kinds rank the engine's run time in whole milliseconds
  (`source: "time"`, the default for them); the others rank `objectives.score`, rounded. `source:
  "score"` makes a time kind rank `objectives.score` instead.
- `counts_when: "finished"`: only won runs go on the board. A lower-is-better score must use it.
- `aggregate`: `best`, `latest` or `sum_week`. `tie_break`: `less time` or `earlier`.
- `format`: text with one `{n}` (`"{n} orders"`, `"{n}%"`) or a time: `m:ss.t`, `m:ss`, `s.t` (the value
  is milliseconds). It's how the app and share text show the score.
- `events`: the events or inputs that change the score (`tick` if it grows with time). The score
  check fails a game whose score changes on anything else.
- `bounds` (`min`, `max`, `max_rate_per_s`) are recorded by the score check from the bot runs; a
  `max_rate_per_s` you give is checked against them. `ranked: false` says the board is just a list
  (calm and no-fail games).

The model never goes into `game.json` (the engine's file is strict). The expander returns it beside the
game and `wrap.mjs` puts it at the top of the wrapped manifest as `score`, with the recorded `bounds`
and `ranked`. `expander/score.mjs` has the defaults and checks (`A_SCORE_*` errors).
After the bot gate, `playtest/score-check.mjs` checks the board is fair: skill order in the score's
direction, an idle bot and a one-input spam bot ranking no better than real play, the finish rule,
`max_rate_per_s`, every bot run replaying to the same phase, time and score (`verify` where the engine
has it), and the score changing only on `events`.

### 2.14 UI kit (`ui`)

A manifest may carry a `ui` block, `{"kit": "game-style/1", "theme", "base", "accent", "family",
"density"}`, and write UI as kit components: nodes with a `ui` key instead of `node`
(`{"ui": "question_card", "text": "= question_text()"}`). The expander derives every token from the
block (the palette roles and their on-colours, type scale, spacing, radii), lays the components out
in fixed regions (HUD band, top, playfield, controls, overlay) and fits their text. Without a `ui`
block the game's palette stays as written. `quiz`, `picture_quiz`, `choice_story`, `keyboard`,
`story_vars`, `play_clip` and the HUD counters are drawn with the kit. The full contract, the
component list and the style check (`S_*` codes) are in `UI_KIT.md`.

## 3. Expander

The expander is deterministic: the same manifest and library versions give byte-identical output.

1. Resolve `uses`, then check and substitute params (1.1).
2. Rename private names, apply `bind`, then auto-rename collisions (1.2).
3. Check `requires` and `conflicts` across all uses and the game.
4. Merge, in `uses` order and then the game's: `types`, `state`, `functions`, `events`, `inputs`,
   `rules`, slots and `feedback`. Combine `objectives` (1.3).
5. Apply the look: `presentation.canvas`, `presentation.tokens` (preset, then `art.palette`, then
   `look.tokens`), and `root` built from the look's slot layout with the slot nodes inside (the
   backdrop first). Art and music become `assets`; the moments in every feedback entry become the
   game's sounds, scaled by `sound.volume`; `feel` drops what it turns off; the win and lose stings are
   added (origin `feel`, a library origin).
6. Write the **source map**: for every JSON Pointer in the output, its origin. The origin is
   `use:<id>` (with the fragment and version), `game`, or `look:<id>`, plus the pointer in that input.
   Expression strings whose identifiers were renamed also carry a span map, so a diagnostic's `span`
   can be moved back to the original text.
7. Run `microgame validate --json`, then translate each diagnostic's `at` and `span` through the map
   (longest-prefix match).

**Where diagnostics go:**

- Origin `game`: to the model, with the pointer into its own manifest.
- Origin `use:*`: a library bug. Logged for us. The model is told only that the fragment can't be used
  with those params, so it can change them or drop the fragment.
- Origin `look:*`: a library bug, logged.

Authoring-side codes:

- For the model: `A_UNKNOWN_FRAGMENT A_FRAGMENT_VERSION A_UNKNOWN_PARAM A_PARAM_TYPE A_PARAM_RANGE
  A_UNKNOWN_BIND A_DUPLICATE_NAME A_MISSING_REQUIREMENT A_REQUIREMENT_TYPE A_CONFLICT A_SLOT_FULL
  A_UNKNOWN_SLOT A_UNKNOWN_LOOK A_UNKNOWN_CONTENT A_CONTENT_TYPE A_CONTENT_WRITE A_ART_SVG
  A_ART_FIELD A_ART_PALETTE A_ART_FONT A_ART_IMAGE A_ART_SIZE A_UNKNOWN_ART_ROLE A_ART_MISSING
  A_SOUND_SET A_SOUND_MOMENT A_SOUND_PRESET A_SOUND_FIELD A_SOUND_CLIP A_FEEL_FIELD`, and the warnings
  `W_AUTO_RENAMED`, `W_ART_UNUSED` and `W_CLIP_TRIMMED`.
- For the library log: `A_PARAM_PLACEMENT A_UNKNOWN_TOKEN A_FRAGMENT_FIELD`. They use the engine's diagnostic shape (`code`, `at`, `span`, `message`, `hint`), with
`at` pointing into the manifest.

## 4. Engine facts this format relies on

From Artem's agent's answers on 2026-11-12, tested against the built engine:

- Objectives are checked after the whole start chain and then after every event, including each event
  in an emit chain. So a win can fire before a later event in the same chain runs. Count score from
  state the winning rule already set (for example `matches * 100`), not from an event emitted after it.
- Taps hit-test against the layout from the last `frame()` call (v0.1; reported to Artem). The playtest
  gate draws a frame before every bot tap.
- `and`, `or` and `if` short-circuit. `string + string` concatenates. `fold` infers `[]` accumulators.
- `after` takes any int-ms expression; `every` and `time_limit` are constants. So speed ramps use
  `after` timers that re-schedule themselves, or a `tick` accumulator.
- Fixed 60 Hz stepping in the shell. `sin`, `cos` and `log2` match between native and WASM.
- Hit-testing picks the topmost target and uses the untransformed box. `pointer` is a `vec2`. A group's
  size is its children's bounding box. Text is measured by the engine.
- Collisions are expressions in `tick` rules (the fragments don't use v0.2 physics yet).
- v0.2 (tested 2026-11-12): `image` nodes take an `=` asset expression and `frame` (wrapped past the
  last frame), `anchor`, `rotation` (degrees) and `scale`; `animate_on` keys may be inputs and their
  `when` sees `event`, node locals and state; feedback `when` and particles see the state after the
  step's rules; particle `color` takes `$tokens`; synth `note` takes Hz from an expression.
- The playtest bots tap the centres of `rect` and `circle` ops, not `image` ops. A tap target the game
  draws as a sprite needs a transparent `rect` or `circle` under it (the fragments keep one), or bots
  can't find it.

## 5. Open

- `role` and `presentation.look` pass-through (Artem's call). Until then, looks can only change tokens
  and layout, not how ops are skinned.
- `microgame catalog` (Artem's call). Until then, the compose prompt's builtin list is copied by hand
  from `mg-core/src/builtins.rs`.
- `engine/` is on Artem's `rust-engine` branch, not on `beta-version` yet. The tools find a built copy
  through `MG_ENGINE_DIR` (see `README.md`).
- Engine v0.2 (assets, text input, physics, camera) is coming. Physics bodies and pairs, and assets,
  need to be keyed so fragments can contribute them; we've asked Artem's agent for that.
