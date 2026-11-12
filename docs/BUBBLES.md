# Bubbles

**Tiny games your people make with Muse.** Bubbles is a Facebook feature where anyone can describe a
game in a sentence and Muse builds it, for a Group, an Event, or everyone. Bubbles play inline in a
vertical feed, live in the Groups they were made for, show up on Stories and profiles, and turn into
short clips ("Bursts") for Reels.

This doc is the source of truth for the build. It follows the team's Slack canvases (Problem
Statement, Short-Form Viral Games taxonomy, Concept Library architecture). Where it differs, the
reason is written next to the decision.

---

## 1. The need and the pitch

**Need (Meta's list): making friends in a new city.**

You moved. You joined "New in SF" and RSVP'd to a newcomers' picnic, but a Group full of strangers
is awkward and nobody posts. Bubbles gives every Group and Event a reason to show up every day:

- **Daily Bubble:** each Group gets one short game a day, the same for everyone in the Group, built by
  Muse from the Group's opted-in posts and intros. You learn the city and the people in it while
  you play, and the Group leaderboard puts names to faces before you meet.
- **Icebreaker Bubbles:** Events get a game for attendees ("Who's coming Saturday?"), so you walk
  into the picnic already knowing three people's names.
- **Make your own:** "a chill game for my new running club about SF hills" becomes a playable game in
  under a minute. Muse writes the brief, composes the game from our concept library, writes the
  small bits of custom code, playtests it and paints the cover.

**Why it passes the brief's tests**

| Test | Answer |
|---|---|
| Real young-adult need | Moving somewhere new and knowing nobody. |
| Belongs on Facebook | Groups, Events, the friend graph, Stories, Reels, Messenger. A standalone app has none of these. |
| AI does real work | Remove Muse and nothing gets made: no briefs, no games, no daily content, no covers. |
| Reason to come back | A new Daily Bubble every day, streaks, and friends beating your score. |

**Models**

| Model | Job |
|---|---|
| `muse-wonder-1.0` | Planner and composer: brief, manifest, glue, repairs. Tool-calling agent. |
| `muse-ember-1.0` | Fast, high-volume steps: word lists, clues, prompts, titles, daily content. |
| `muse-image-1.0` | Cover art for every Bubble, in the Glow style. |
| `muse-spark-1.3` | Fallback planner; reading photos when a request includes them. |

Measured on our key (2026-11-12): models list 1.2 s; small JSON reply 2–4 s; tool calls work on
Wonder, Spark 1.3 and Ember; image 1600×1600 WebP in ~11 s. All three text models spend reasoning
tokens before answering, so never send a small `max_tokens` (use 4,000+).

---

## 2. Brand

**Name:** Bubbles. One game is a **Bubble**. You **blow** a Bubble (make one), **pop** into one
(play), and **float** it to your Group (share).

| Term | Meaning |
|---|---|
| Bubble | A mini-game. |
| Daily Bubble | A Group's game for today. Same for everyone in the Group. |
| Icebreaker | A Bubble made for an Event's attendees. |
| Bubble Chain | Linked levels. Each level is its own Bubble; chains link them in order. |
| Burst | A short replay clip of a run. Plays before you take over, on Stories and in Reels. |
| Bubble Board | Leaderboard: Group, Friends, Everyone. |
| Muse Studio | Where you make, edit, remix or level up a Bubble with Muse. |
| Library | Every Bubble you can play: yours, your Groups', friends', chains, saved. |
| Remix | Fork a Bubble and change it. |

**Look: every Bubble looks like itself, inside the same Bubble frame.** Games do not share one
theme. Each Bubble gets its own look (render family, colors, font, motif) that Muse picks from the
brief, so you know which game it is the moment you see it. The look stays the same across
gameplay, poster frames, cover art and cards. What stays the same everywhere is how Bubbles are
built and framed: the intro card, HUD, pop transition, result moment and share card, plus the
Bubbles app chrome around them. Think TikTok: every video looks different, but the frame never
changes. See 4.10.

**Brand: Glow** is the Bubbles platform's own look, used for app chrome: the Bubbles tab header,
Muse Studio, badges and card frames. It is pastel, bubbly and glowing, taken from the Muse cover
art: iridescent soap-bubble rims, lilac-to-peach gradients, soft white halos, rounded type (SF
Pro Rounded) and springy motion. `glow` is also one of the game looks.

- Facebook chrome (tab bar, headers, sheets) stays Facebook. Bubbles chrome uses Glow. Games use their own look.
- Brand gradient: `#B9A7FF → #FF9ECF → #FFC59E` (lilac → pink → peach).
- Preset palettes are shared by Swift (`BubbleGlow`) and CSS (`bubble-glow.css`); keep them identical. A game can also bring its own colors (`style.colors`).

**Copy:** sentence case, warm and short. "Blow a bubble", "Pop in", "Float it to New in SF",
"Maya beat your score", "Made with Muse". Games are original: genre mechanics are fine, but never
reuse another game's name, characters, art or levels.

Tab bar: Home · Video · **Bubbles** · Friends · Notifications · Menu. Marketplace moves into the Menu
shortcuts (Facebook lets people customize tabs).

---

## 3. Architecture

```
Request ──► Muse Studio (Swift harness) ──► Manifest (JSON) ──► Bubble runtime (JS) in WKWebView
             │  Wonder: brief, compose, glue, repair (tool calls)       ▲
             │  Ember: content     Image: cover                         │ same runtime, headless,
             └─ tools ─► Validator (JavaScriptCore) ────────────────────┘ in JavaScriptCore
```

1. **Concept registry (JS).** Typed concepts with the canvas contract: `id, kind, version, describe,
   examples, params (type, default, safe range), consumes, emits, requires, conflicts, tags`.
2. **Runtime (JS).** Event bus, session state machine (intro → playing → fail/success → result),
   seeded RNG, fixed 60 Hz timestep, input layer, Canvas 2D + DOM renderer in the Glow style,
   replay recording and playback. Runs in WKWebView (rendered) and in JavaScriptCore (headless).
   *Decision:* our own small engine instead of KAPLAY: determinism and replays need a fixed
   timestep we control, the Glow look needs Canvas 2D glow effects, and the runtime has to run
   headless in JavaScriptCore for validation. KAPLAY was a proposal; this keeps the same concept
   model.
3. **Muse Studio (Swift).** The compositional harness: an agent loop on Wonder with tools, plus
   Ember for content and Image for covers. Validates and playtests every manifest in JavaScriptCore
   before it ships, and repairs failures (max 2 rounds). Has an offline composer so the demo never
   breaks.
4. **App (SwiftUI).** `BubbleStore` holds Bubbles, scores and boards. Surfaces: Bubbles tab
   (infinite feed), player, result sheet, Bubble Board, Library, chains, Studio, Group Daily Bubble,
   Event icebreaker, profile, Stories, feed posts, Reels Bursts, notifications.
5. **CLI.** `tools/bubble-studio` runs the same harness on macOS to pre-generate the seed library
   with Muse and to validate every seed.

**Formulas** (taxonomy canvas, section 9) the runtime supports, in priority order:
`dodge`, `guess`, `group` (sort into groups), `answer` (type or pick; consensus or correct scoring),
`time` (tap at the right moment, e.g. stack), `merge` (drop and merge). The collaboration batch adds
`story` (Adventure: choose your path), `nextline` (Quiz night: guess what they say next) and
`learn` (Learn: lesson, practice, recap); see section 7.

---

## 4. Contracts

### 4.1 Files and naming

Xcode's synced folders copy every resource **flat into the app bundle root**, so resource names
must be unique across the app.

```
FacebookClone/Bubbles/Models/        Shared Swift types (Foundation only, also compiled by the CLI)
FacebookClone/Bubbles/Runtime/web/   bubble-runtime.js, bubble-glow.css, bubble-host.html
FacebookClone/Bubbles/Seeds/         bubble-seed-<slug>.json (one manifest each)
FacebookClone/Bubbles/Studio/        Muse client + harness + validator (Foundation + JavaScriptCore only)
FacebookClone/Bubbles/Store/         BubbleStore (SwiftUI app state)
FacebookClone/Bubbles/UI/            Shared Bubbles UI: Glow tokens, web view, cards
FacebookClone/Features/Bubbles/      Screens
tools/bubble-studio/                 macOS CLI
scripts/sync-muse-config.sh          .env → FacebookClone/Bubbles/Studio/MuseConfig.json (gitignored)
```

### 4.2 Manifest (JSON, snake_case keys)

Swift type: `BubbleManifest` in `Bubbles/Models/BubbleManifest.swift`.

```json
{
  "id": "new-in-sf-daily-2026-11-12",
  "version": 1,
  "title": "Fog Words",
  "one_line_rule": "Guess today's San Francisco word in six tries.",
  "formula": "guess",
  "brief": {
    "intent": "learn the city with your new Group",
    "audience": "group:new-in-sf",
    "mood": ["cozy", "playful"],
    "energy": "low",
    "competition": "light",
    "occasion": "daily",
    "content_sources": ["New in SF posts (opted in)"]
  },
  "structure": { "cadence": "daily", "scope": "group:new-in-sf", "setter": "ai" },
  "lineage": { "parent": null, "operators": ["re-scope", "hand-off"], "remix_of": null },
  "chain": { "id": "chain-fog", "index": 1, "title": "Fog Words", "prev": null, "next": null },
  "style": { "palette": "lilac-haze", "mood_preset": "cozy", "emoji": "🌫️" },
  "concepts": [
    { "use": "space.grid", "params": { "rows": 6, "cols": 5 } },
    { "use": "input.type" },
    { "use": "rule.guess_feedback", "params": { "feedback": "feedback.letter_position" } },
    { "use": "rule.attempt_budget", "params": { "attempts": 6 } },
    { "use": "score.attempts_used" },
    { "use": "flow.daily_gate" },
    { "use": "feel.flip_reveal" },
    { "use": "share.emoji_grid" }
  ],
  "glue": {
    "glue.hill_bonus": { "slot": "score", "source": "function score(run) { return run.base + run.streak * 2; }" }
  },
  "content": { "target": "FOGGY", "dictionary": ["FOGGY", "HILLS"] },
  "seed": 20261112,
  "studio": { "models": ["muse-wonder-1.0", "muse-ember-1.0"], "created_at": "2026-11-12T08:00:00Z", "duration_sec": 41.2, "offline": false }
}
```

Collaboration fields (all optional, section 7.1): `length` (`{mode, rounds, seconds, lives}`),
`about` (`{subject_id, subject_name, template}`), and in `lineage`: `remix_of_title`,
`remix_of_creator_id`, `remix_of_creator_name` and `makers` (`[{id, name, role, contribution}]`).

Glue rules: each entry is the source of **one pure function** whose name is the slot
(`feedback`, `spawn`, `score`, `transform`, `constraint`). No network, DOM, timers or globals.
The runtime compiles it with the SDK as its only argument.

### 4.3 Runtime API (JavaScript, `globalThis.Bubble`)

Headless functions take and return **JSON strings** so JavaScriptCore bridging stays trivial:

| Function | Returns (JSON string) |
|---|---|
| `Bubble.catalogJSON()` | `{version, formulas: [FormulaMeta], concepts: [ConceptMeta]}`: every formula (with an example manifest) and concept with its contract (4.6) |
| `Bubble.validateJSON(manifestJSON)` | `{ ok, errors: [{code, message, path}], warnings: [{code, message, path}] }`: schema, unknown concepts, param ranges, requires/conflicts, event wiring, glue compiles (4.6) |
| `Bubble.simulateJSON(manifestJSON, optionsJSON)` | `{ ok, error, outcome, score, ticks, duration_sec, events: {name: count}, replay }`. Options: `{ seed, max_ticks, bot: true, replay }` |

In the web view, `bubble-host.html` loads `bubble-glow.css` and `bubble-runtime.js`, then waits for
Swift to call `BubbleHost.boot(payloadJSON)`:

```json
{ "manifest": { }, "mode": "play" | "replay" | "demo" | "poster",
  "replay": { "seed": 1, "tick_rate": 60, "total_ticks": 600, "inputs": [{ "t": 12, "a": "tap" }] },
  "player": { "name": "Alex", "best": 42 }, "muted": true, "reduced_motion": false,
  "insets": { "top": 0, "bottom": 0 } }
```

- `replay` plays an input log exactly (seeded, fixed timestep). `demo` lets the built-in bot play.
  `poster` draws one still frame. Tapping during `replay` or `demo` **takes over**: the runtime
  restarts the same seed in `play` mode and posts `takeover`.
- Swift → JS: `BubbleHost.command({"type": "pause" | "resume" | "restart" | "mute" | "unmute"})`.
- JS → Swift: `window.webkit.messageHandlers.bubble.postMessage({...})`:

| `type` | Fields |
|---|---|
| `ready` | `title` |
| `phase` | `name`: `intro`, `playing`, `fail`, `success`, `result` |
| `score` | `value` |
| `result` | `outcome` (`fail`/`success`), `score`, `duration_sec`, `replay` (input log), `share` `{headline, score_text, emoji_grid?, tag?}` |
| `haptic` | `style`: `light`, `medium`, `selection`, `success`, `warning` |
| `takeover` | (none) |
| `error` | `message` |

Swift types: `BubbleBridgeMessage`, `BubbleRunResult`, `BubbleInputLog` in
`Bubbles/Models/BubbleRun.swift`.

### 4.4 Studio API (Swift)

`Bubbles/Models/StudioContracts.swift`:

- `draftBrief(_ request) async throws -> BubbleBrief`: fast first pass, shown to the creator to
  edit ("I read this as calm and nostalgic, for New in SF").
- `compose(_ request) -> AsyncThrowingStream<StudioEvent, Error>`: emits steps
  (`understand, brief, compose, glue, content, validate, repair, playtest, cover, polish, done`).
  The `done` event carries the manifest and optional cover image data.
- Modes: `create`, `edit` (change an existing Bubble), `remix` (fork), `next_level` (new linked
  Bubble in the chain), `daily` (a Group's Daily Bubble from its opted-in posts).

### 4.5 App state

`BubbleStore` (environment object) owns Bubbles, scores, boards and the Studio service.
Routes and covers: `Route.bubble(id)`, `.bubbleBoard(id)`, `.bubbleLibrary`, `.bubbleChain(id)`,
`.marketplace`; `router.play(...)` opens the player, `router.openStudio(...)` opens Muse Studio.

Surfaces outside the Bubbles screens hook in through `BubbleSurfaceHooks` (called once at launch);
each surface has its own file in `Features/Bubbles/Surfaces/`. `Post` carries `bubbleID`,
`bubbleReplay` (a Burst) and `allowsBubbles` (opted in as Daily Bubble material).

`BubbleJSRuntime` (`Bubbles/Studio/BubbleJSRuntime.swift`) runs the runtime headless in
JavaScriptCore: `catalog()`, `validate(_:)`, `simulate(_:seed:maxTicks:bot:replay:)`.

DEBUG launch routing for screenshots: `FB_TAB`, `FB_OPEN`, `FB_SKIP_SPLASH` (see `App/DebugLaunch.swift`).
Collaboration screens open with `FB_OPEN=feature:<key>/<screen>[/<arg>]` (section 7.1).

### 4.6 Runtime internals: kits, concepts and the SDK

**Files and load order.** All in `Bubbles/Runtime/web/`. The host page, JavaScriptCore and tests
load them in this order: `bubble-runtime.js` (engine, SDK, Glow graphics, host), then
`bubble-kit-common.js` (concepts any formula can use), then each other `bubble-kit-<formula>.js`
sorted by name. A kit only calls `Bubble.defineFormula` and `Bubble.defineConcept`. Every file
must load without a DOM (guard `document`/`window` access), because JavaScriptCore has none.

**Playfield.** Game logic uses a fixed logical playfield of **360 × 640** (portrait). The host scales
it to fit the screen ("contain", centered); the palette background and ambient bubbles fill the
whole screen. Fixed size keeps runs identical on every device, so replays work everywhere.

**Determinism.** Logic runs at a fixed 60 ticks per second. The only randomness allowed in game
logic is the seeded `sdk.rng()` family. No `Math.random`, `Date`, timers or DOM reads in logic.
Cosmetic effects (particles, ambient bubbles) use their own RNG and never touch game state.
Bots use `sdk.botRng()`, never the game RNG, so a recorded bot run replays exactly.

**Inputs.** The replay log stores only pointer input: `{t, a, v}` with `a` = `tap` (finger down),
`move` or `up` and `v` = `[x, y]` in logical coordinates (rounded to 0.1). Live input is queued and
applied at the start of the next tick, and recorded with that tick. The engine emits
`pointer.down`, `pointer.move`, `pointer.up` `{x, y}` on the bus. **Input concepts** turn those into
game input: `input.tap` emits `input.action {x, y}`; an on-screen keyboard concept emits
`input.key {key}` and `input.submit {value}`; choices emit `input.select {index, value}`; a drag
emits `input.launch {dx, dy}`. Everything is drawn in the canvas (keyboards and choice buttons
too), so replays and posters show it. Bots return the same pointer input (`[{a: "tap", v: [x, y]}]`),
using layout helpers their kit exposes in `sdk.state`.

**Defining a formula** (one per kit):

```js
Bubble.defineFormula({
  id: "dodge", title: "Dodge", describe: "One-touch survival: float through gaps.",
  core: ["space.side_scroll", "entity.avatar", "input.tap"],   // must be present
  optional: ["behavior.speed_ramp", "feel.mood_preset"],        // known to work with it
  content: { describe: "Theme words for obstacles", schema: { /* JSON-schema-lite */ } },
  validateContent(content) { return [] },                       // [{code, message, path}]
  bot: { decide(sdk) { return [] } },                           // inputs for this tick
  share(sdk) { return { headline, score_text, emoji_grid } },   // optional default
  example: { /* a complete, valid manifest: the few-shot for Muse and the offline composer */ }
})
```

**Defining a concept:**

```js
Bubble.defineConcept({
  id: "behavior.gravity", kind: "behavior", version: 1,
  formulas: ["dodge"],                  // or ["*"]
  describe: "Pulls the avatar down every tick.", examples: ["a slow, floaty fall"],
  params: {
    strength: { type: "number", default: 0.4, min: 0.1, max: 0.9, describe: "Fall speed" },
    // types: number (min/max), integer (min/max), boolean, string (max_length), enum (values), string_list (max_items)
  },
  consumes: ["clock.tick"], emits: [], requires: ["entity.avatar"], conflicts: [],
  tags: { mood: ["calm"], energy: ["low", "medium"] },
  glue: [],                             // glue slots it calls, e.g. ["spawn"]
  setup(sdk, params) { /* subscribe with sdk.on, draw with sdk.layer */ }
})
```

Kinds: `input`, `space`, `entity`, `behavior`, `rule`, `feedback`, `score`, `flow`, `content`,
`share`, `social`, `feel`. Concept ids are `<kind>.<name>`; formula-specific names may say so
(`rule.merge_on_touch`).

**SDK** (the `sdk` passed to `setup`, bots and share builders):

| Member | Meaning |
|---|---|
| `manifest`, `content`, `params` | Read-only manifest, its `content`, this concept's params (defaults filled in) |
| `state` | Shared run state. Each concept writes under its own key (`state.avatar`). Bots read it. |
| `on(type, fn)`, `emit(type, payload)` | Synchronous event bus (nesting depth limit 16) |
| `rng()`, `int(a, b)`, `pick(arr)`, `shuffle(arr)` | Seeded game randomness |
| `botRng()` | Bot-only randomness |
| `tick`, `dt` (1/60), `time` (seconds), `w` (360), `h` (640) | Clock and playfield |
| `score`, `addScore(n, at)`, `setScore(n)` | Score (always higher is better). `at` `{x, y}` floats "+n" |
| `end(outcome, info)` | `"fail"` or `"success"`; the run ends after this tick |
| `glue(slot)` | The compiled glue function for that slot, or `null` |
| `has(conceptID)` | Whether the manifest uses a concept |
| `layer(z, draw)` | Register `draw(g)`: 0 background, 10 space, 20 entities, 30 effects, 40 HUD |
| `fx.pop(x, y, color, n)`, `fx.float(text, x, y, color)`, `fx.shake(n)`, `fx.flash(color)`, `fx.sound(name)`, `fx.haptic(style)` | Feel. No-ops headless. Sounds: `pop blip tick chime whoosh success fail` |
| `share(partial)` | Merge into the share artifact `{headline, score_text, emoji_grid}` |
| `phase`, `mode`, `player` | `intro/playing/fail/success/result`; `play/replay/demo/poster/headless`; `{name, best}` |
| `hud` | `{ score: true, label: "" }`: turn off or relabel the engine's score HUD |

Engine events: `clock.tick {tick}`, `pointer.down/move/up {x, y}`, `flow.phase {name}`,
`score.changed {score, delta}`. Concepts emit the rest (`input.*`, `entity.*`, `rule.*`,
`round.*`, `share.ready`). A concept that ends the run calls `sdk.end(...)` and emits `rule.fail` or
`rule.success`.

**Glow graphics** (`g`, passed to layer draw functions; render only):

| Member | Draws |
|---|---|
| `g.ctx`, `g.w`, `g.h`, `g.t` | Raw 2D context in logical coordinates; playfield size; render clock (seconds, cosmetic only) |
| `g.palette` | `{id, top, bottom, ink, glow, accents: [4], dark}` |
| `g.bubble(x, y, r, {tint, alpha, label, labelSize, labelColor, wobble, glow})` | Iridescent soap bubble: rim, sheen, highlight, soft halo |
| `g.orb(x, y, r, color, {glow, alpha, ring})` | Solid glowing orb |
| `g.pill(x, y, w, h, {fill, stroke, radius, glow, alpha})` | Rounded rectangle (x, y = top-left) |
| `g.text(s, x, y, {size, weight, color, align, baseline, glow, alpha, maxWidth})` | Rounded type with optional glow |
| `g.emoji(s, x, y, size)` | Emoji glyph |
| `g.image(url, x, y, w, h, {circle, radius, alpha})` | Cached image (avatars); a placeholder orb until loaded |

**Looks: the full `g`** (additions, implemented with LOOKS.md). Every primitive above draws in
the Bubble's look (`style.look`: `glow paper pixel neon ink clay riso chalk`); kit code never
changes per look. Rendering only: looks never touch game state or the game RNG, so a run is
identical in every look (tested). Each look pre-renders its sprites and textures into the atlas at
prepare time.

| Member | Meaning |
|---|---|
| `g.palette` | Roles: `primary secondary accent ink bgTop bgBottom danger`, `accents` (4), plus helpers `surface` (panels, keys), `surfaceStrong`, `line`, `shadow`, `mist`, `good`/`near` (right/close feedback), `mid`, `soft`, `dark`, `look`, and `inkOn(fill)` (readable text color on a fill). `top`, `bottom`, `glow` stay for old code. Custom `style.colors` are used as given. |
| `g.look`, `g.font`, `g.fontStack`, `g.motif`, `g.view` | The look id (only for small optional flourishes), font, motif and the visible area in playfield units (`{x0, y0, x1, y1, w, h}`, larger than 360 × 640 on tall screens) |
| `g.pill(x, y, w, h, {fill, stroke, strokeWidth, dash, radius, glow, glowColor, shade, alpha})` | `fill: null` or `"none"` draws an outline-only pill; `stroke` outlines in the look's line style (wobbly ink, chalk, pixel steps, neon tube) |
| `g.line(x1, y1, x2, y2, color, {width, alpha, cap, dash})`, `g.path([x0, y0, ...], color, {width, alpha, closed, fill, dash})` | Lines and polylines in the look's line style; `dash: [on, off]` in playfield units |
| `g.circle`, `g.ring`, `g.halo`, `g.puff`, `g.spark`, `g.glowRect`, `g.lens(x, y, r, {tint, alpha, glow})` | Small shapes; `lens` is a see-through bubble over a portrait or letter |
| `g.clip(x, y, w, h, r)`, `g.unclip()` | Clip to a rounded rect (unwound automatically at the end of the layer) |
| `g.emoji(s, x, y, size, alpha)` | Emoji with optional alpha (a number or `{alpha}`) |
| `g.particle(kind, x, y, size, k, color)`, `g.scenery(motif \| "auto", {scroll})`, `g.ground(floorY, scroll)` | Look particles; parallax motif scenery (`hills waves city stars clouds grid dots leaves`) and a ground strip |
| `g.wrapText(s, maxWidth, size, weight)`, `g.rgba(hex, a)`, `g.mix(a, b, t)`, `g.ease`, `g.spring` | Helpers |

Rules for kits: color through roles, never hex; draw through `g` (raw `g.ctx` drawing skips the
look). Text uses the look's font; the pixel look draws a built-in 5x7 (or 3x5) bitmap face.

**Style validation.** An unknown `style.look` is an error with code `style` (with a "Did you mean");
an unknown palette, font, motif or color role is a `style` warning; a bad hex, ink below 4.5:1 on
either background, or an accent that barely differs from the background (low contrast and a
similar hue) is a `style_contrast` warning. The catalog adds `looks` (`{id, title, describe,
moods, energy, fonts, motifs, default_font, default_motif, example_colors}`), `fonts`, `motifs`,
`color_roles` and `style_rules`.

**SDK additions.** Beyond the table above: `palette` (the roles), `feel`, `Z` (layer constants),
`clamp`, `lerp`, `off(type, fn)`, `range(a, b)`, `chance(p)` (seeded), `botSkill`, `botState`
(bot memory), `ended`, `preload(url)` (warm an image), `log(message)` (once), `fx.sparkle(x, y,
color, n)` and `fx.ring(x, y, r, color)`.

**Poster moment.** A poster is one representative still, not tick 0: the demo bot plays until
`state.poster_tick` when a concept sets it (`rule.pick_match`: the first fact with every portrait
in place; `input.type`: the first guess half typed, nothing revealed), else until the formula's
`poster_ticks` (default 90 = 1.5 s). `Bubble.posterRun(session, {bot_skill})` returns that run;
the host draws it, and `demo` starts from the same tick with the same bot seed (silently), so a
feed page turns from its poster into the live demo without a jump.

**Validation** (`Bubble.validateJSON`) checks, with these error codes: `schema` (required fields
and types), `unknown_formula`, `unknown_concept`, `formula_mismatch` (concept not built for this
formula), `missing_core`, `structure` (exactly one `space.*`, at least one `input.*`, at least one
concept that can end the run, exactly one `score.*`, at most one `flow.*`), `param_type`,
`param_range`, `requires`, `conflicts`, `wiring` (a consumed event nothing emits), `glue_slot`,
`glue_compile`, `glue_forbidden` (uses `window document globalThis self fetch XMLHttpRequest
WebSocket import require eval Function setTimeout setInterval Date Math.random webkit
localStorage`), `content` (the formula's `validateContent`). Warnings use the same shape.

**Glue** compiles as `new Function("sdk", source + "\nreturn " + slot + ";")` with a restricted
SDK `{rng, int, pick, clamp, lerp}` and is called by the concepts that list that slot. A glue
function that throws is disabled for the rest of the run (logged once).

**Simulation** (`Bubble.simulateJSON(manifest, {seed, max_ticks, bot, bot_seed, bot_skill,
replay})`) runs the manifest headless with the formula's bot (or replays `replay`). `bot_seed`
varies the bot's choices and `bot_skill` (0–1, default 0.7) how well it plays, so bot runs can
stand in for different players. It returns `{ok, error, outcome:
"fail"|"success"|"timeout", score, ticks, duration_sec, events: {type: count}, replay}`. The
Studio playtest uses it: a good Bubble lasts 10–120 s with the bot, can be failed and can score.

**Catalog** (`Bubble.catalogJSON()`) returns `{version, formulas: [FormulaMeta], concepts:
[ConceptMeta]}` where FormulaMeta is the formula definition without functions (including
`example`) and ConceptMeta is the concept definition without `setup`.

**Host behavior.** `play`: intro card (emoji, title, one-line rule, "Tap to pop in"); the first tap
starts the run and is not recorded. `replay`/`demo`: start immediately, loop with a short pause when
the run ends; a tap **takes over** (post `takeover`, restart the same seed in `play`, skip the intro,
and apply the tap as the first input). After a `play` run ends: a ~0.8 s fail/success moment, then
phase `result` and the `result` message (Swift shows the result sheet). `restart` replays from the
start in `play` without the intro. `pause` stops the clock without catch-up. `poster`: run the bot
to the poster moment headless, draw one frame, stop. Uncaught errors post `error` and show "This bubble
popped" instead of a blank screen.

### 4.7 Demo world

`Bubbles/Seeds/bubble-demo-world.json` holds the synthetic New in SF Group (`group-newinsf`), the
newcomers' picnic Event (`event-newcomers-picnic`), ten newcomers with intros and facts, and a list
of SF words. Mock data (Swift) and seed Bubbles both read it, so names and IDs always match. The
signed-in user, Alex, just moved to San Francisco and joined New in SF.

---

### 4.8 Speed: one persistent runtime

Bubbles scroll like Reels, so switching games has to feel like switching videos. The engine is
**one persistent runtime that runs lightweight game definitions**: it starts once and stays
alive, and a new Bubble is data (a manifest), not a new engine, page or download.

**Targets** (measure on device; the host reports them in `perf` messages):

| Measure | Target |
|---|---|
| Cold start: tap the Bubbles tab to the first interactive Bubble | under 1 s |
| Warm switch: a prepared Bubble becomes interactive | under 50 ms |
| Frame rate while playing, mid-range iPhone | 60 fps |
| Memory for the whole Bubbles experience | under 150 MB |

**Warm hosts (Swift).** `BubbleRuntimePool` keeps a small number (2–3) of `WKWebView`s that load
`bubble-host.html` once, at app launch, in the background, and are never reloaded. Surfaces lease
a warm host instead of creating a web view. `BubbleWebView` keeps its public initializer and leases
from the pool.

**Prepare, then activate (JS).** Starting a Bubble is split so the slow part happens before the
user arrives:

| Call | Does | Returns (JSON string) |
|---|---|---|
| `BubbleHost.prepare(payloadJSON)` | Parses the manifest, compiles glue, runs concept setup, warms sprites, draws the first frame offscreen. Keeps the 4 most recently used sessions (LRU). Payload as `boot`, plus optional `key` (default `"<id>#<version>"`). | `{ok, key, ms, error}` |
| `BubbleHost.activate(key, optionsJSON)` | Shows that session and starts it from tick 0 in `options.mode` (`play/replay/demo/poster`, plus `replay`, `player`, `muted`, `reduced_motion`, `insets`). The previous session pauses. | `{ok, ms, error}` |
| `BubbleHost.poster(key, optionsJSON)` | The session's poster frame as an image (`{width, height, scale, type: "image/jpeg", quality, insets, bot_skill, hud}`). It honors `insets` (default: the payload's) like activate and draws the score HUD where the live page shows it (`hud: false` leaves it out, e.g. for small cards). | data URL string |
| `BubbleHost.evict(key)` | Frees a session. | — |
| `BubbleHost.boot(payloadJSON)` | `prepare` + `activate` (kept for simple surfaces). | — |

Every message the host posts carries `key`, so Swift knows which session sent it. The new
`perf` message: `{type: "perf", key, prepare_ms, activate_ms, first_frame_ms, fps, heap_mb}`
(sent after activation and every few seconds while playing).

**Insets and posters (additions).** `insets` are `{top, bottom, left, right}` in points (each
optional): the playfield fits inside them, the look's background still fills the screen, and the
HUD and cards center inside them (`command({type: "insets", top, bottom, left, right})` updates
them live). With insets, a Bubble that shows the score HUD also gets a 72 pt row for it under the
top inset (on a full screen the HUD floats in the space above the playfield), so the HUD never
covers the game's top line. Posters use the same insets, so in the feed the game clears the caption, the "Pop in"
button and the action rail. A poster drawn while its images were still loading shows
placeholders; when they arrive the host posts `{type: "poster_update", key}` and calling `poster`
again gives the finished frame. Remote images served without CORS headers (for example
randomuser.me portraits) can't be drawn into an exported canvas, so posters show them as
placeholders unless the payload maps them to same-origin data: `"images": {"<url>":
"data:image/jpeg;base64,..."}` (Swift can pass the photos it already cached). Live play shows
them either way.

**The feed's sliding window.** While Bubble 0 plays: +1 is prepared (ready to activate), +2 is
preparing, −1 stays prepared for scrolling back, anything further is evicted. Only Bubble 0
simulates and renders; the others are paused. Pages that aren't live show their poster frame (an
exact still of the demo's first frame, the poster moment), so scrolling looks live and the live
host takes over when the page settles.

**Inside the engine.**

- Glow sprites are pre-rendered once per palette, into offscreen canvases (a sprite atlas) at
  quantized radii, then drawn with `drawImage`. No per-frame `shadowBlur`.
- Entity-heavy parts (particles, obstacles, merge orbs) use pooled objects or typed arrays and
  allocate nothing per frame, to avoid garbage-collection hitches.
- One `requestAnimationFrame` loop for the active session. A fixed 60 Hz step with an accumulator,
  at most 5 steps per frame.
- The Swift ↔ JS boundary carries only coarse messages (`phase`, `score`, `result`, `perf`), never
  per-frame calls. Glue runs inside the engine, not across a bridge.

**Compiled at publish, trusted at play.** Muse Studio validates and playtests a manifest before it
ships, fills in every default and pins `engine_version`. Devices only check `engine_version` and
prepare. The full validator runs in Studio and the CLI, not on every play.

**Every score is verifiable.** Runs are deterministic: the seed plus the pointer log reproduces the
run exactly. `BubbleJSRuntime.verify(_:replay:claimedScore:)` re-simulates a run headless; the app
marks verified runs on the Bubble Board. A server would do the same before accepting a score.

**Three tiers of game logic, one SDK.**

1. Declarative: concepts and params from the library (most Bubbles).
2. Glue: small sandboxed pure functions Muse writes for a Bubble's unique twist.
3. New concepts and kits: whole new mechanics, written once and added to the library. They run
   behind the same SDK, so later they could be sandboxed plugin modules (JS or WebAssembly).

**Why JavaScript in WKWebView, not Rust and WebAssembly (for now).** Bubbles are light: a few
dozen entities, 2D, pastel. WKWebView JIT-compiles JavaScript, and Canvas 2D is GPU-backed, so
logic is not the bottleneck. WebAssembly would add a toolchain and a JS ↔ Wasm boundary without
speeding up games this small. The same JavaScript also runs headless in JavaScriptCore inside
the app and CLI, where Studio validates and playtests every Bubble. Muse also writes JavaScript
glue reliably. WebGPU is not available on iOS 18. The `g` drawing API is the render boundary, so
a native or WebAssembly backend can replace pieces later if profiling ever shows a need.

**Production path (not built for the hackathon).** Manifests are documents: a document store
(MongoDB fits) keeps one editable document per Bubble version plus metadata. A publish pipeline
runs the same validator and simulator (JavaScriptCore or Node) and writes immutable,
content-hashed manifests to object storage behind a CDN. Clients cache them, and popular Bubbles
are served almost entirely from the CDN. Leaderboards verify replays server-side. Gameplay never
calls the server.

### 4.9 Seed files

`Bubbles/Seeds/bubble-seed-<id>.json` is a manifest plus keys starting with `_`, which the runtime
and validator ignore. `_seed` holds demo metadata for `BubbleStore`: `creator_id` (a demo-world
person id or `me`), `group_id`, `event_id`, `created_hours_ago`, `play_count`, `like_count`, `save_count` (saves are the
likes, 7.10; defaults to `like_count`).
`_placeholder: true` marks a stand-in that the runtime owners replace with a real, validated
manifest under the same id. Seed ids are stable; screens and debug links use them.

| Id | Formula | Notes |
|---|---|---|
| `newinsf-daily-fog-words` | guess | New in SF's Daily Bubble (word) |
| `picnic-icebreaker-whos-coming` | guess | Picnic icebreaker (match facts to newcomers) |
| `hill-hopper`, `hill-hopper-2` | dodge | A two-level Bubble Chain (`chain-hill-hopper`) |
| `fog-drift` | dodge | |
| `moving-day` | dodge | Alex's own Bubble (profile, edit demo) |
| `newinsf-fog-or-sun` | answer | Consensus: guess what the Group picked |
| `sort-the-city` | group | |
| `cable-car-catch`, `sourdough-stack` | time | |
| `bay-bubbles` | merge | |

### 4.10 Looks

Every Bubble looks like itself; every Bubble has the same frame.

#### Two layers

**1. The Bubble frame: the same in every game.** This is what makes a game recognizably a Bubble.
- The intro card structure: emoji, title, one-line rule, "Tap to pop in", and a small Bubble mark (a tiny iridescent bubble icon).
- The score HUD position: top center, inside the insets.
- The pop-in and pop-out transition: a quick bubble-pop wipe.
- The fail and success moments and the result flow.
- The share card layout.
- The Bubbles app chrome around the game: feed overlay, Studio, card frames and badges. These keep the Glow brand (`BubbleGlow`, the wordmark, `MuseBadge`).

The frame borrows the game's font and colors so it never clashes, but its **layout and motion
never change**.

**2. The look: different for every Bubble.** Muse picks it for each game from the brief. It stays the
same across gameplay, poster frames, cover art and cards. Manifest `style` fields:

| Field | Meaning |
|---|---|
| `look` | Render family (table below). Default `glow`. |
| `palette` | A preset id (`lilac-haze`, `peach-fizz`, `mint-pop`, `sky-glow`, `night-bloom`) or `custom` |
| `colors` | `{bg_top, bg_bottom, ink, primary, secondary, accent, danger}` as `#RRGGBB`. Required when `palette` is `custom`. Ink needs ≥ 4.5:1 contrast with both backgrounds. |
| `font` | `rounded`, `serif`, `mono`, `hand`, `condensed` or `pixel`. System or web-safe font stacks only; no font files. Default `rounded`. |
| `motif` | Optional background hint: `hills`, `waves`, `city`, `stars`, `clouds`, `grid`, `dots`, `leaves` or `none` |
| `cover_prompt` | Written **in the same look**, so the cover art matches the game ("paper cutout diorama of…", "pixel art of…") |
| `emoji`, `mood_preset` | As before |

Manifests without these fields keep working (`glow`, `lilac-haze`, `rounded`).

#### Looks (render families)

Each look is a skin over the same `g` primitives. Kit code does not change per look. What changes is how
`g.bubble`, `g.orb`, `g.pill`, `g.text`, `g.emoji`, `g.image`, the background and particles draw.

| id | Feel | Background | Shapes (bubble, orb, pill) | Text | Particles |
|---|---|---|---|---|---|
| `glow` | Dreamy, soft, pastel (today's look) | Gradient and ambient bubbles | Iridescent soap bubbles with halos | Rounded, soft glow | Mini bubbles |
| `paper` | Crafty, warm, tactile | Paper grain, layered cutout motif | Flat fills, slightly irregular edges, offset drop shadows | Rounded or serif, no glow | Confetti scraps |
| `pixel` | Retro arcade | Low-res buffer (about 180×320, nearest-neighbor), dithered sky | Pixel circles and blocks with a 1 px outline | Pixel or mono, hard shadow | Square pixels |
| `neon` | Night, electric | Near-black with a grid, horizon or stars | Outline strokes with bloom, dark or no fills | Condensed or mono, glow | Sparks and streaks |
| `ink` | Hand-drawn, whimsical | Off-white paper, light hatching | Wobbly outlines (deterministic jitter), hatch shading | Hand | Scribbles |
| `clay` | Toy-like, chunky, cute | Soft studio backdrop with vignette | Soft 3D: radial shading, specular dot, contact shadow | Heavy rounded | Little blobs |
| `riso` | Zine, print, graphic | Cream with grain | 2–3 spot colors, halftone fills, slight misregistration | Condensed or serif | Halftone dots |
| `chalk` | Brainy, calm, school | Dark slate with smudges | Chalky textured strokes, rough fills | Hand or rounded, chalk texture | Chalk dust |

**Must-haves first:** `glow`, `paper`, `pixel`, `neon`, `ink` and `clay`. Add `riso` and `chalk` if there is time.

#### Rules

- **Rendering only.** Looks never change game logic, timing or game randomness. Render-time jitter uses its own hash or RNG. Replays and simulations are identical in every look.
- **Palette roles, not hex.** Kits color things through roles: `g.palette.primary`, `.secondary`, `.accent`, `.ink`, `.bgTop`, `.bgBottom`, `.danger`, plus `.accents` for back-compat. Never hard-code hex, and draw through `g` primitives. Check `g.look` only for small optional flourishes.
- **Same budgets.** Each look pre-renders its sprites and textures into the atlas at prepare time: 60 fps, activate in under 50 ms.
- **Legible everywhere.** The HUD and all text stay readable in every look.
- **Catalog and validation.** `Bubble.catalogJSON()` gains `looks: [{id, title, describe, moods, energy, fonts, motifs, example_colors}]` so Muse can choose. An unknown `style.look` is an error with code `style`; a bad hex or low contrast is a warning with code `style_contrast`.
- **How Muse picks** (harness):
  - match the theme: paper for crafty or cozy, pixel for retro or arcade, neon for night or energetic, ink for whimsical or handmade, clay for cute or toy, riso for zine or graphic, chalk for brainy or puzzle, glow for dreamy or calm;
  - edits, remixes and next levels keep the base's look unless the request asks to change it;
  - new Bubbles should vary;
  - the cover prompt is written in the chosen look.
- **Identity on every surface.** Cards, feed pages, stories and Bursts show the game's own poster frame (drawn by the runtime in its look) or its cover art. A generic gradient in the game's own colors is only the last-resort fallback. Swift resolves colors with `BubbleGlow.palette(for: manifest.style)`, which honors custom colors.
- **Seeds should show the range.** For example: Fog Words in `ink`, the picnic icebreaker in `paper`, Hill Hopper in `paper` with a hills motif, Hill Hopper 2 in `neon` (night), Fog Drift in `glow`, Moving Day in `clay`, Cable Car Catch in `pixel`, Sourdough Stack in `riso` or `clay`, Sort the City in `chalk` or `paper`, Bay Bubbles in `glow` or `clay`, Fog or Sun? in `riso`.

## 5. Privacy and data

- Demo data is synthetic. No real posts, people or brands.
- Daily Bubbles read only posts marked as opted in, and Studio shows which sources it used.
- The Muse key lives in `.env` and a gitignored `MuseConfig.json`; it is never committed.

## 6. Demo (5 minutes)

1. The problem: new city, a Group of strangers.
2. Open Bubbles: a feed of glowing Bursts; tap one to take over and play.
3. New in SF's Daily Bubble: play, float the result to the Group, see the Bubble Board.
4. Blow a bubble live: type a request, edit the brief, watch Muse compose, play it, make level 2.
5. Share a Burst to your Story; the Event icebreaker; tomorrow's Daily Bubble is the reason to return.

---

## 7. Collaboration: closer together

Every Bubble should bring specific people closer (friends, a Group, a group chat, people from an
Event) through Facebook's own surfaces: friends, Groups, Messenger chats, Search, profiles and the
feed. People come closer three ways: **friendly competition** (challenges, leaderboards, quiz
nights), **shared stories** (adventures, paths you send) and **self-expression** (games about you,
games made together, remixes). Every social screen shows who played, made or remixed it, plus a
one-tap way to bring someone in: challenge, invite, send to the chat or add friend.

The batch is nine features, each built on its own branch from `feat/base`: challenge, groups-search,
together, remix, story, nextline, learn, length and saves. 7.1 is the shared plumbing every feature
uses; 7.2 to 7.10 belong to the features, and each feature's implementer fills in its own section.

### 7.1 Shared plumbing (feat/base)

**Rule: fill in your own files only.** Shared screens call into features through pre-wired slots
and registries. A feature edits its own files plus the small, listed shared edits in its spec.

**Routes.** `Route.bubbleFeature(BubbleFeatureRoute)` pushes a feature screen;
`router.bubbleSheet` presents one as a sheet over the tabs. `BubbleFeatureRoute(feature, screen,
arg)`; `BubbleFeature` keys are `challenge`, `groups-search`, `together`, `remix`, `story`,
`nextline`, `learn`, `length`, `saves`. `BubbleFeatureRouter` (Features/Bubbles/Social) dispatches
to each feature's `<Feature>Screens` enum: `destination`, `sheet`, `open` (notification taps and
cards), `debugOpen`, `install` (once at launch, after `BubbleSocialCast.install`), `didFinish`
(after the player records one of your runs) and `didPublish` (after Muse Studio publishes). `AppNotification.bubbleAction` routes a notification
tap to a feature. DEBUG: `FB_OPEN=feature:<key>/<screen>[/<arg>]`, for example
`FB_OPEN=feature:challenge/picker/hill-hopper`. Stub screens show a "Coming soon" placeholder.

**Slots.** `Social/BubbleFeatureSlots.swift` lists every slot and its order: result sheet info and
actions, feed caption, Bubble page, player top bar and banner, Group Featured and Games tab,
profile header and Bubbles tab, friend rows, Library header, Studio Ask and Try. Each slot view lives
in `<Feature>Slots.swift` and keeps its name and stored properties. Result-sheet slots get a
`BubbleResultSlotContext` (`result`, `bubble`, `play`, `request`, `playAgain`, `exitPlayer`; use
`leavingPlayer { }` to open Studio or a chat from inside the player).

**Playing with a fixed seed and length.** `BubblePlayRequest` has `seed`, `length` and `context`
(`BubblePlayContext`: `kind` challenge/session/gameNight/contribution/lesson, `id`, `cardID`,
`opponentName`, `target`). `router.play(BubblePlayRequest(...))` plays
`manifest.withSeed(seed).withLength(length)`; the session key includes the content hash, so it never
reuses a prepared session. The replay log records the seed and, when locked, the length
(`BubbleInputLog.length`, also written by the runtime's `replayLog()`), and `BubbleStore.verify`
replays with it, so every score stays verifiable.

**Playable cards and Group posts** (owner: challenge). `BubbleChatCard` (`id, kind, bubble_id,
seed, length, from_user_id, headline, session_id, score, extras`) rides on `Message.bubbleCard` and
`Post.bubbleCard`. Kinds and owners: `challenge`, `session`, `share` (challenge); `remix` (remix);
`contribution` (together); `gameNight` (nextline); `storyPath` (story); `lesson` (learn).
`BubbleChatCardView` draws each kind with its owner's view (`<Feature>CardBody`), falling back to
`BubbleChatCardFallback`. Send and update cards only through `BubbleSocialHub`:

| Call | Does |
|---|---|
| `targets(appStore:kinds:)` | Friends, recent chats (group chats first), your Groups, feed, story, as `BubbleShareTarget` |
| `send(_:to:note:appStore:bubbleStore:)` | Chat or friend: a message carrying the card. Group or feed: a post carrying it |
| `receive(_:from:in:text:appStore:)` | A card from someone else lands in a chat (a friend's simulated score) |
| `update(cardID:appStore:_:)` | Changes a card wherever it is ("3 of 5 played", the winner line) |
| `play(_:router:context:)` | Plays the card's seed and length |

**The other side.** `BubbleSocialCast` installs the synthetic group chats "New in SF crew" (Maya,
Diego, Priya, Chloe) and "Picnic planners" (Omar, Lena, Jordan), names the default rival (Maya),
and lists New in SF's members. `BubbleStore.simulateRun(of:on:manifest:skill:botSeed:completion:)`
plays a person's run with the real runtime's bot on the exact seed and length, so a friend's score
arrives with a replay. Use short delays (2–6 s) so it feels live.

**Social signals.** Every collaboration moment calls `BubbleSocialSignals.post(_ kind:bubbleID:with:)`,
which posts `Notification.Name.bubbleSocialSignal` with userInfo `["kind": String, "bubbleID":
String, "with": [String]]` (other people's user ids). Kinds (`BubbleSocialSignalKind`):
`challenge_sent`, `challenge_accepted`, `challenge_won`, `challenge_rematch`, `group_chat_play`,
`group_challenge`, `game_night_play`, `remix`, `share`, `co_make_contribution`, `about_me_play`,
`story_path_shared`, `lesson_shared`, `add_friend_from_game`. Kevin's recommender listens.

**Saves contract.** Every save anywhere goes through `BubbleStore.toggleSave(_ bubble: Bubble,
source: BubbleSaveSource = .feed)`, which updates `isSaved` and `saveCount` and posts
`Notification.Name.bubbleSaveChanged` with userInfo `["bubbleID": String, "isSaved": Bool,
"source": String]`. Sources: `feed game result detail library chat group search profile`. Don't save
any other way. Kevin's recommender codes against this.

**Length contract** (owner: length). Manifest `length` `{mode: endless|rounds|timed|lives, rounds?,
seconds?, lives?}`; Swift `BubbleLength`. A formula declares `length: {modes, default, knobs}` in
`defineFormula`; the catalog lists it and `length_modes`. In kits: `sdk.length` (resolved and
frozen: `{mode, rounds, seconds, lives}`), `sdk.lengthRound()` when a round ends (false: the run is
over), `sdk.lengthMiss()` on a miss (true: a life absorbed it; false: apply the kit's normal fail),
`sdk.lengthLeft()` for HUDs. feat/base resolves `sdk.length` and validates the shape (error code
`length`); the engine side (ending timed and rounds runs, lives, HUD, intro label) is the length
feature's.

**Studio hooks** (`Bubbles/Studio/StudioFormulaHints.swift`). `StudioFormulaHint` per new formula
(keywords, nouns, looks, composer guide, offline content, playtest flags, relaxed flags), registered
for story, nextline and learn. `StudioSocialHooks` runs each feature's `promptLines`, `applyDraft`
(online draft to manifest), `applyOffline` (offline, before validation) and `finalize` (metadata at
stamp time: lineage credits, makers, `about`). `StudioRequest` carries `length`, `tuning` and
`social` (`StudioSocialContext`: base creator, makers, contributions, about-me template and answers,
own story, lesson notes); `StudioLaunch` carries `social` and `length`, and `StudioModel` passes them
on (remixes fill the base creator automatically).

**Result tags.** A kit may set `share.tag` (via `sdk.share({tag})` or its `share` builder): a short
machine-readable result the app reads and players never see, such as `ending=ferry;first=ferry`
(story), `right=4/5` (nextline) or `mastery=7/8` (learn). It reaches Swift as
`BubbleShareArtifact.tag` and comes back from `simulate` too, so a friend's bot run has one. Each
formula's feature defines its own keys in its section.

**Categories.** `BubbleFormula.category` (`BubbleCategory`): `story` is **Adventure**, `nextline`
is **Quiz night**, `learn` is **Learn**, everything else is play (no chip). `BubbleCategoryChip`
shows on feed pages, Bubble pages and Library cards; the Studio and Library formula chips list the
new formulas.

**Tests.** `tools/kits-tests` tests `story`, `nextline` and `learn` by default with the other kits.
Feature-specific kit checks go in a new `tools/kits-tests/suite-<name>.js` that adds
`{name, run(env)}` to `KitSuites` (env: `Bubble, print, fail, ok, quick, wanted, manifests,
report`); both runners load every suite file. `suite-length.js` is the length feature's.

**Copy.** Each feature keeps its new user-facing strings in its `<Feature>Copy` enum, so a rename
is one place per feature. The name stays "Bubbles" for now.

### 7.2 Challenge Me and group chats (challenge)

Challenge any friend, chat or Group to beat your score on the exact same seed, right from the
result sheet, a friend row or a profile. The card lands in Messenger (or the Group), opening it plays
the same seed, and a head-to-head result offers a rematch. A card dropped in a group chat starts a
shared session: everyone plays the same seed, and the card tracks who played, a mini leaderboard
and the winner. Friends' sides are bot runs that arrive a few seconds later, so every score stays
verifiable. Owns `BubbleSocialHub`.

### 7.3 Games in Groups and Search (groups-search)

Search finds games by title, creator, category or Group, with a Games filter and playable results,
and offers "Make it with Muse" when nothing matches. Groups get a Games tab: the Daily Bubble, a
weekly leaderboard with a trophy and "Most improved", "Challenge the Group" posts, a game-night
entry point, and Add friend from the leaderboard.

### 7.4 Make it together, and games about you (together)

Start a game and invite friends, a chat or a Group to add to it (a question, words, a scene or a
level); Muse stitches the contributions into one game and credits every maker in `lineage.makers`.
"Games about me" templates build a game from your answers (manifest `about`), shown on your profile
with who knows you best.

### 7.5 Remix and share (remix)

Remix is on every surface and opens Studio with the game loaded. The manifest's lineage carries a
"Remix of <title> by <name>" credit; the original creator is notified; the Bubble page shows a remix
count and a small tree with friends highlighted; "Send it back" sends your remix to the creator's
chat. Share always sends a playable card.

### 7.6 Adventures: stories you play (story)

The `story` formula, category **Adventure** (never "Story", so it isn't confused with Facebook
Stories). A story is a small graph: scenes type out, 1–3 choices are drawn as pills, choices can
`set` flags and other choices `need` them, a bold choice can hide a quick timing tap, and every path
ends at one of 2–6 endings (usually one secret). After an ending you see which endings friends found
and who took the other path ("Maya took the ferry"), and you can send your path to a friend, a chat
or the Group. Muse plans and writes adventures, including one built from your own story ("my first
week in SF"). Shared stories and self-expression: friends compare paths and the card starts a
conversation.

**Kit** (`bubble-kit-story.js`): `space.story_page` (draws the page in any look), `rule.story_paths`
(walks the graph, ends with success at an ending), `score.story_points` (scenes visited × 10, timing
hits × 25, ending bonus good 40 / odd 30 / secret 80; all params) and `input.select`. Pacing: text
types at 1.6 characters a tick (a tap finishes it), choices unlock after at least 1.6 s per scene,
an ending card holds 2.5 s. The bot reads for 1–3 s, then bolder (more skilled) bots take the boldest
choice (timing, then flag-unlocked, then flag-setting, then not-an-ending; ties at random) and land
timing taps more often, so skilled bots score more. Length: modes `rounds` and `endless`, default
`rounds: 12` (the depth cap); each scene left is `lengthRound()`, and when it returns false the run
jumps to the nearest ending. The kit also emits `story.reached_<n>` at ending n, so playtest event
counts show which endings bots found.

**Content:**

```json
{ "start": "morning",
  "scenes": [
    { "id": "morning", "emoji": "☀️", "speaker": "Maya", "text": "≤ 160 chars, second person",
      "choices": [
        { "id": "ferry", "text": "Take the ferry", "past": "took the ferry", "to": "ferry", "set": ["sketch"] },
        { "id": "race", "text": "Race to the bottom", "past": "raced down", "to": "race",
          "skill": { "kind": "timing", "window": 0.25, "miss": "fog" } },
        { "text": "Try the yellow roof", "to": "rooftop", "need": ["key"] } ] },
    { "id": "golden", "emoji": "🌇", "text": "…",
      "ending": { "id": "golden-hour", "title": "Golden Hour on the Pier", "emoji": "🌇", "tone": "good" } } ] }
```

Choice `text` ≤ 28, `past` ≤ 32 (what friends read: "Maya took the ferry"), `id` ≤ 24 (defaults to a
slug of the text, unique in the scene). `skill.window` 0.15–0.4 is the share of the meter that
counts; a hit takes `to` and sets the flags, a miss (or no tap) takes `miss` and sets nothing.
Ending `tone`: `good`, `odd` or `secret`.

**Validator** (`validateContent`, code `content`, path into the content): 3–40 scenes with unique ids;
text and name limits; 1–3 choices on every scene that isn't an ending and none on an ending; every
`to` and `skill.miss` names a real scene (not itself); every `need`ed flag is `set` somewhere; at most
8 flags; `start` exists; 2–6 endings with unique ids; no loops; every scene reachable from `start`
(no orphans); the longest path is at most 12 choices; walking `(scene, flags)` states, no scene is a
dead end (all choices gated by flags you may not have) and every ending is reachable with flags set
before they're needed.

**Share and tag.** `score_text` "Ending 2 of 4 · 🌇" (the number, never the title), `emoji_grid` one
mark per choice (▫️, ⚡ timing hit, 💨 miss) and the ending's emoji. `tag`:
`ending=<ending id>;first=<id of the first choice taken>;found=<n>/<m>;path=<steps>`, where
`found` is this ending's number and the story's ending count, and `path` is the choice index taken in
each scene, dot-separated, with `x` after a missed timing tap (`1.1x.0.2`). The app rebuilds the
path from the tag and the manifest (`StoryAdventure.choices(along:)`).

**Card** `.storyPath` (owner story) extras: `ending_id` (String), `path_choices` ([String], the choice
texts in order), `found` (Number, endings the sender has found). The headline is "Alex took the
stairs. Which way would you go?"; Play plays the card's seed and length. Sending posts
`.storyPathShared` with the recipients (a friend, the chat's members, or New in SF's members), and a
friend in the chat answers a few seconds later with their own path card (a real bot run).

**App.** `StoryProgressStore.shared` keeps the endings you found and your latest run per Bubble
(UserDefaults), and friends' paths per Bubble for the session: Maya, Diego and Chloe each play a
real bot run (`simulateRun`) of the story, chosen so one took the other path from you, one found a
secret ending and one shows a new ending. Slots: `StoryResultEndings` (your ending N of M and path,
endings found with the rest as "?", friends' paths with Add friend for non-friends, Send your path),
`StoryDetailEndings` (the same on the Bubble page, plus Play to find the rest), `StoryStudioEntry`
(Studio Ask: "Turn your story into an adventure", a sheet that sets `social.personalStory`, the
prompt and formula hint `story`) and `StoryCardBody`. `StoryScreens.install` adds a notification
("Priya made an adventure in New in SF") that opens the endings screen.

**Studio** (`StoryStudio.swift`): keywords (adventure, choose your own, choose your path, story,
branching, quest, what would you do, my first week, my story), nouns Path, Tale, Adventure, looks
paper, ink, riso, a composer guide (plan the graph first: 6–12 scenes, 3–4 endings with one secret
gated by a flag, depth ≤ 10, ≤ 3 choices, `past` on every choice, at most two timing moments), and
prompt lines that pass `social.personalStory` with "Turn this into an adventure about the person who
wrote it; keep real details they gave, invent nothing private." Offline: a deterministic 7-scene,
3-ending graph from the own story's sentences (first person turned to second) or the prompt, with
one timing moment that unlocks the secret ending ("Wrote 7 scenes and 3 endings from your story").
Playtest: `ending_unreachable` (blocking) when bots found fewer endings than the story has and a
static walk (`StoryGraphCheck`) can't reach them; otherwise a non-blocking `endings_rare` note.
`no_challenge` and `flat` are relaxed (stories have no fail state).

**FB_OPEN** (with `FB_SKIP_SPLASH=1`): `play:story-ferry-or-fog`;
`feature:story/endings/<bubbleID>` pushes the endings screen with friends' paths loading;
`feature:story/path/<bubbleID>` presents the send-path sheet (DEBUG stages a bot run as your path if
you haven't played); `feature:story/mystory` presents the own-story sheet, which opens Studio;
`studio:an%20adventure%20about%20my%20first%20week`.

**Seeds** (New in SF, Group `group-newinsf`):

| Id | Look | Notes |
|---|---|---|
| `story-ferry-or-fog` | paper | "Ferry or Fog?", a first Saturday. 4 endings (Island Picnic, Golden Hour on the Pier, Lost in the Fog, secret The Secret Rooftop gated by a key), two timing moments. By Priya. |
| `story-last-cable-home` | ink | "The Last Cable Home", getting home across three hills at midnight. 4 endings (Home by Midnight, Night Bus Friends, Above the Fog, secret The Conductor's Bell gated by ringing the bell), three timing moments. By Theo. |

**Tests:** `tools/kits-tests/suite-story.js` (validator rejections: a dangling choice or miss, an
orphan, a dead end, an unreachable ending, a loop, too deep, a bad window, one ending, long text, an
ending with choices; bots reach every ending of the example and both seeds in 40 runs; replays
reproduce ending, tag and score; rounds and endless lengths still end at an ending).

### 7.7 Quiz night: guess what they say next (nextline)

The `nextline` formula (category Quiz night): a short, original animated scene freezes before the
punchline and players pick the real line from four tiles against a timer. A quiz night runs in a
Group or group chat, with a live-feeling leaderboard between rounds.

### 7.8 Learn together (learn)

The `learn` formula (category **Learn**): a lesson card with 2–4 points, practice questions with an
explanation after every answer (right or wrong), a recap of the points you know, your mastery
("7/8") and a learning streak. Learning is social: a Group's lessons have a mastery meter
everyone moves together ("New in SF knows 82% of the hills"), friends' streaks sit next to yours
(Library, profiles, lesson pages), and lesson cards in chats and Groups invite people to learn it
with you; friends in a chat learn it too and their results land in the chat.

**Why a dedicated kit** (not a teach mode in answer, sort and guess): it demos the whole arc (lesson,
practice, explanation, recap) in one game; it needs no edits to kits other features own; and it gets
its own category, Studio guidance and playtest policy. Its concepts are its own (`formulas:
["learn"]`), so it never borrows answer's quiz concepts.

**Kit** (`bubble-kit-learn.js`): `space.lesson_desk` (draws everything), `rule.lesson_practice`
(runs the lesson and ends the run; params `pass_ratio` 0.5, `shuffle_choices`, `shuffle_questions`,
`lesson_min_seconds`, `recap_seconds`), `score.mastery` (100 a right answer + 20 per streak step,
capped at 5; glue `score`), with the common `input.select`. Content: `{topic, subject?, lesson:
{title, points: [2–4, ≤ 90]}, questions: [{q ≤ 90, choices: [2–4, ≤ 40, distinct], answer, explain
≤ 120, point?}]}`; `point` links a question to the lesson point it practices (the recap ticks it off),
`subject` is the meter's noun phrase. Length: `rounds` (default: one per question), `lives` (each
wrong answer costs a life; 3 by default) and `endless` (fresh order each pass until the first miss);
the kit calls `lengthRound()` after every question and `lengthMiss()` on every miss, and counts lives
itself while `lengthLeft()` reports nulls. A run succeeds at `pass_ratio` mastery or better. Events:
`learn.lesson_done`, `learn.question`, `learn.answer`, `learn.right`, `learn.wrong`, `learn.explain`,
`learn.recap`, `round.start`, `round.end`. Share: `score_text` "7/8 mastered".

**Tag keys:** `mastery` (`right/asked`), `topic` (a slug), `miss` (content indexes of missed
questions, comma-separated). Example: `mastery=7/8;topic=hills-of-sf;miss=3`.

**Lesson cards** (`.lesson`, sent through `BubbleSocialHub`; `LearnShare` in `LearnScreens.swift`).
Extras: `topic`, `subject`, `mastery` (the sender's "7/8"), `group_mastery` (0–1) and `group_name`
(the meter when the lesson has one), `learners` (`{userID: "7/8"}`, updated live as people learn it).
`sessionID` is `lesson-<bubbleID>`; Learn it plays the card's seed with context `.lesson`. Sending
posts `lesson_shared` with the chat's members, the friend, or the Group's members. Sent to a chat,
two members play the same seed (real bot runs) and reply with their result a few seconds later.

**State** (`LearnProgressStore.shared`): your learning days and best mastery per lesson
(UserDefaults; each launch the demo world gives Alex the two days before today, so a lesson today makes a 3-day
streak); members' mastery from `simulateRun` tags (until a run lands, a member's best real board
score / the best possible score stands in); friends' streaks are deterministic and synthetic.
`groupMastery(group:in:)` is the Group meter across its lessons (0–1); `groupMastery(of:group:)` is
one lesson's.

**Slots:** `LearnResultRecap` (ring, streak with friends', what you learned, the Group meter, "Share
with New in SF" and "Send to New in SF crew"), `LearnDetailMastery`, `LearnGroupMastery` (Games tab),
`LearnProfileStreak`, `LearnLibraryStreaks`, `LearnStudioEntry` ("Turn a topic or notes into a
lesson": a sheet that sets the learn formula hint, the prompt and `social.lessonNotes`) and
`LearnCardBody`. Copy lives in `LearnCopy`.

**Studio** (`LearnStudio.swift`): keywords (learn, lesson, teach, study, quiz me, flashcards,
practice, notes, language, phrases, history of…), nouns (101, Lesson, Basics), looks (chalk, paper,
riso), a composer guide (accurate, widely known, checkable facts; conservative over surprising; one
short sentence that teaches why; 6–10 questions; 2–4 points the questions cover; no medical, legal or
financial advice; generic, non-brand content), prompt lines that pass pasted notes with "use only
facts from these notes", and an offline builder (cloze questions from the notes' sentences, with
the sentence as the explanation; else a built-in SF neighborhoods lesson). Playtest policy:
`no_challenge` is relaxed (practice shouldn't feel punishing) and a non-blocking `lesson_short` flag
notes fewer than 5 questions.

**FB_OPEN:** `feature:learn/lesson/<bubbleID>` (the lesson's page with mastery and friends),
`feature:learn/group/<groupID>` (the Group page on its Games tab with the meter),
`feature:learn/streaks` (friends' learning streaks). Also `play:learn-hills-of-sf` and
`bubble:learn-hola-meetup`.

**Seeds:** `learn-hills-of-sf` ("Hills of SF 101", chalk, by Aiko) and `learn-hola-meetup` ("Hola!
Meetup Basics", paper, by Lena), both for New in SF. Tests: `tools/kits-tests/suite-learn.js`.

### 7.9 Length and customizing (length)

Length is a first-class primitive (7.1): endless, rounds, timed or lives, honored by every kit, with
a Customize panel in Studio. Intro cards, results and boards label the mode, and shared play locks
everyone to the same mode and numbers.

### 7.10 Saves are the likes (saves)

People leave a game to save it but not to like it, so saves are the appreciation signal: saves
counts where likes would be, a one-tap Save in the player that never leaves the game, Save as the
result sheet's primary action, "Saved by Maya and 37 others", creator notifications and stats. The
contract is in 7.1.
