# Snake check (milestone step 3)

`authoring.json` is Artem's C2 Snake rewritten as a manifest that uses the `score` fragment.
`expanded.json` is that manifest expanded by hand under `SPEC.md`, using `looks/pixel.look.json`.

## Game sections compared with C2

State compared as a map, rules matched by id: **one difference**.

| C2 | Expanded | Same behavior? |
|---|---|---|
| `move` does `{ "incr": "score" }` | `move` does `{ "emit": "point" }`; `score__add` (from the fragment) does `incr score by 1` on `point` | Yes. `point` runs later in the same step (A10.4), and objectives are checked after it, so the game is won in the same step. |

Two other differences went away after changes to the format, not to the engine:

- `win` was `10 > 0 and score >= 10`. **Fix:** `include` conditions on params (SPEC 1.1), so the score
  fragment drops its `win` when there's no target.
- The HUD text had a dead `if 10 > 0 then … else ''`. Same fix: two slot entries, one per case.

State key order differs (`score` comes first because fragments merge before the game). Order doesn't
matter to the engine.

## Presentation compared with C2

Different on purpose: the look places slots, so this isn't a byte match.

- The HUD text is placed by the pixel look's `hud_top` at (180, 56). C2 stacks it 20 px above the grid.
  It's size 18 rather than 22, and adds the look's `Silkscreen` font.
- The grid sits at an explicit (8, 148) in the playfield. C2 centers it in a column stack.
- The empty-cell color comes from the look's `$surface`. C2 uses its own `$empty` token, but the color
  is the same.
- The fragment adds a `point` sound to `feedback`.
- `role: "tile"` is removed from the output until the engine has `role`.

## Not checked yet

None of this has been through `microgame validate`, because `engine/` isn't pushed. Next is running both
files through `validate --json` and `simulate --json` once Artem pushes it.
