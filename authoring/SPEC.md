# Microgame authoring format v0.1

The authoring layer turns what a model writes into one flat `microgame/0.1` `game.json` that Artem's
engine validates and runs. This page defines the two things it reads:

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

**Optional pieces.** A rule, a feedback entry, a slot entry or an objective can carry
`"include": "<condition>"`. The condition reads only params, so the expander decides it once: the piece
is either kept (minus the `include` key) or dropped. Objectives use the long form
`"win": { "include": "@target > 0", "expr": "score >= @target" }`. Conditions are `@param` compared
with a literal (`== != < <= > >=`), joined by `and`/`or`. Without this, a param that turns something off
leaves dead `10 > 0 and …` guards in the output.

**Game params** are read-only values every fragment can use, in either kind of field and as a param's
`default`: `@game.duration_ms` (the game's `time_limit`, or else `meta.duration_s × 1000`),
`@game.canvas_w` and `@game.canvas_h` (from the look, 360 × 640 for every v0.1 look).

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

**Collisions:** if two uses provide the same public name, the second use's name gets a `_2` suffix (then
`_3` and so on), and the expander reports `W_AUTO_RENAMED` with the new name. If the game declares a name
a use provides, that's `A_DUPLICATE_NAME`. The game should drop its own copy, or `bind` the fragment's
to another name. The game reads that warning
like any other. Explicit `bind` is preferred, because an auto-renamed copy still listens for the
un-renamed requirements. Two uses of a fragment that lists the other in `conflicts` are `A_CONFLICT`.

**What gets renamed:** an identifier token inside an expression string, unless it comes after `.`, is a
record field key (`{x: …}`), or is inside a string literal. Also renamed: effect targets (`set`, `incr`,
`push`, `remove`), `on`, `emit`, `after.emit`, `after.id`, `cancel`, rule `id`, `inputs[*].when`,
`on_tap.input`, `on_drag.input`, `animate_on` keys and `feedback[*].on`. Payload field names are never
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
$surface`. Anything else is `A_UNKNOWN_TOKEN`. Games may also define their own tokens (2.4).

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

## 2. Authoring manifest

```json
{
  "authoring": "microgame-authoring/0.1",
  "meta": { "title": "Fog Dodge", "instructions": "Drag to steer through the fog. Survive 45 seconds.", "duration_s": 45 },
  "uses": [
    { "fragment": "lives",      "params": { "count": 3 }, "bind": { "hit": "fog_hit" } },
    { "fragment": "spawn_wave", "params": { "every": "600ms", "kind": "fogbank", "from": "top" } }
  ],
  "types": {}, "state": {}, "functions": {}, "events": {}, "inputs": {},
  "rules": [],
  "objectives": { "time_limit": "45s", "on_timeout": "win" },
  "presentation": { "slots": [], "feedback": [] },
  "look": { "id": "paper", "tokens": { "primary": "#3A6EA5" } },
  "content": { "theme_words": ["fog", "cable car", "hill"] }
}
```

### 2.1 `uses`

Each entry has `fragment`, optional `id` (default: the fragment name, then `<name>_2` and so on),
`params`, `bind` and `version`. Without a version, the expander uses the library's latest and records
which one it used (2.6). Unknown fragments are `A_UNKNOWN_FRAGMENT`, with a did-you-mean hint.

### 2.2 The game's own sections

`types` through `rules` are raw engine format, the "novelty path". They can read and write anything a
use provides, under its bound name. The game's rules run after every fragment's rules for the same
event, because the expander writes fragment rules first (A10: rules run in file order).

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

### 2.5 Content

`content` holds words and lists the model writes, kept out of expression strings so they can be read
and moderated in one place. In v0.1 a value is a string or a list of strings. Each key that an
expression reads, as `content_<key>`, becomes a state entry of type `string` or `list<string>`. Writing
to one is `A_CONTENT_WRITE`. Keys nothing reads stay in the manifest only (covers, captions).

### 2.6 Playtest hint

`"playtest": { "progress": "<expr>" }` is optional. It tells the playtest bots what "doing better" means
(lights switched off, distance to the food, lives kept) when the score alone doesn't show it. The
expander writes a second copy of the game for the gate, with a hidden `__progress` state that a `tick`
rule updates. The shipped `game.json` never contains it.

### 2.7 Inside Bubbles

The manifest sits in beta's wrapper as `formula: "microgame"`, with the manifest under `game`. `brief`,
`lineage`, `chain`, `style`, `seed` and `studio` don't change. The expander adds the fragment versions it
resolved to `lineage`, so an old Bubble expands the same way after the library moves on.

## 3. Expander

The expander is deterministic: the same manifest and library versions give byte-identical output.

1. Resolve `uses`, then check and substitute params (1.1).
2. Rename private names, apply `bind`, then auto-rename collisions (1.2).
3. Check `requires` and `conflicts` across all uses and the game.
4. Merge, in `uses` order and then the game's: `types`, `state`, `functions`, `events`, `inputs`,
   `rules`, slots and `feedback`. Combine `objectives` (1.3).
5. Apply the look: `presentation.canvas`, `presentation.tokens` (preset, then overrides), and `root`
   built from the look's slot layout with the slot nodes inside.
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
  A_UNKNOWN_SLOT A_UNKNOWN_LOOK A_UNKNOWN_CONTENT A_CONTENT_TYPE A_CONTENT_WRITE` and
  `W_AUTO_RENAMED`.
- For the library log: `A_PARAM_PLACEMENT A_UNKNOWN_TOKEN A_FRAGMENT_FIELD`. They use the engine's diagnostic shape (`code`, `at`, `span`, `message`, `hint`), with
`at` pointing into the manifest.

## 4. Engine facts this format relies on

From Artem's agent's answers on 2026-11-12, tested against the built engine:

- Objectives are checked after the whole start chain and then after every event.
- `and`, `or` and `if` short-circuit. `string + string` concatenates. `fold` infers `[]` accumulators.
- `after` takes any int-ms expression; `every` and `time_limit` are constants. So speed ramps use
  `after` timers that re-schedule themselves, or a `tick` accumulator.
- Fixed 60 Hz stepping in the shell. `sin`, `cos` and `log2` match between native and WASM.
- Hit-testing picks the topmost target and uses the untransformed box. `pointer` is a `vec2`. A group's
  size is its children's bounding box. Text is measured by the engine.
- Collisions are expressions in `tick` rules. There are no images or text entry until v0.2.

## 5. Open

- `role` and `presentation.look` pass-through (Artem's call). Until then, looks can only change tokens
  and layout, not how ops are skinned.
- `microgame catalog` (Artem's call). Until then, the compose prompt's builtin list is copied by hand
  from `mg-core/src/builtins.rs`.
- `engine/` is on Artem's `rust-engine` branch, not on `beta-version` yet. The tools find a built copy
  through `MG_ENGINE_DIR` (see `README.md`).
- Engine v0.2 (assets, text input, physics, camera) is coming. Physics bodies and pairs, and assets,
  need to be keyed so fragments can contribute them; we've asked Artem's agent for that.
