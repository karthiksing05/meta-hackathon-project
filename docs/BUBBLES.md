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
3. **Muse Studio (Swift).** The screens for making a game. Since the live-data Stage 3 the app
   calls no Muse model: a new game is made on the games server (`POST /v1/generate`, 7.12), which
   runs the Muse harness, validates, repairs and playtests it. There is no offline composer; with
   no server, Studio says it couldn't reach it.
4. **App (SwiftUI).** `BubbleStore` holds the games, scores and boards fetched from the games API
   (4.5). Surfaces: Bubbles tab
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
FacebookClone/Bubbles/API/           Games API client (the only source of games, people, scores, Groups)
tools/game-fixtures/                 bubble-seed-<slug>.json test manifests (not in the app; see 4.9)
FacebookClone/Bubbles/Studio/        Muse client + harness + validator (Foundation + JavaScriptCore only)
FacebookClone/Bubbles/Store/         BubbleStore (SwiftUI app state)
FacebookClone/Bubbles/UI/            Shared Bubbles UI: Glow tokens, web view, cards
FacebookClone/Features/Bubbles/      Screens
tools/bubble-studio/                 macOS CLI
scripts/sync-muse-config.sh          .env → MuseConfig.json, for the macOS CLI only (the app reads no key)
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
  `unmute`, `resume`, a tap and the page becoming visible again all resume the Web Audio context
  when it is `suspended` or `interrupted` (iOS interrupts it for calls, Siri and other apps).
  While a session is unmuted and not paused, the host holds the app's audio session in
  `.playback` with `.mixWithOthers` (`GameSound.beginGamePlayback`), so games are heard with the
  silent switch on and people's music keeps playing.
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

`Features/Bubbles/Studio/StudioModel.swift` drives the screens; the app talks to no model itself.

- **Brief.** `draftBrief()` fills the brief from what the person typed (intent, audience, a default
  mood and energy); they edit it on the Brief step. The server reads it with Muse when it builds.
- **Build.** `startCompose(.create)` sends the request and brief to the games server
  (`GameGeneratorFactory.current`, `POST /v1/generate`, 7.12). `StudioGenerateBridge` turns the job
  into `StudioEvent`s (`compose, validate, repair, playtest, polish, done`); the `done` event carries
  the manifest.
- **Changes.** Tweaks (`startCompose(.tweak)`, "Change the game", the Sound card's free text), a new
  look (`changeLook(to:)`, `look`), the next level (`startCompose(.nextLevel)`, `nextLevel: true`) and
  remix, next-level and edit launches go to `POST /v1/generate {baseGameId, change?, look?, nextLevel?,
  brief?}` as a `GameRevision` (`StudioModel.runRevision`). It is the same job and polling as a new
  game (`GameGenerator.generate(revision:)`, `StudioGenerateBridge.revise`), so Build shows the same
  steps; a change can take minutes. The result is always a **new** server game with `remixOf` set to
  the base: Studio keeps the server's manifest id (it links to the new server id), a tweaked level
  replaces the one on Try, and saving an edit shares it as a new version. `baseGameId` is the Bubble's
  `serverID`, or for a level made this session its app id (the client maps it). Only the person's
  words go as `change` (at most 1,800 characters); the base game already follows its anatomy.
- Modes: `create`, `edit` (change an existing Bubble), `remix` (fork), `next_level` (new linked
  Bubble in the chain), `daily` (a Group's Daily Bubble). `create` and `daily` make a new game; the
  others change their base game.

### 4.5 App state

`BubbleStore` (environment object) holds the games fetched from the games API this session, their
boards and the Studio service. It keeps nothing of its own and invents nothing (docs/APP_LIVE_DATA_PLAN.md):

| Data | From |
|---|---|
| Games tab feed | `GET /v1/feed?limit=10&sessionID=<per launch>&exclude=` (the server's recommender picks and orders every page; `BubbleFeedItem` keeps `feedItemID`, `reason`, `why`, `team`) |
| A game | its server object plus the manifest at `manifestUrl` and the cover at `coverUrl`; `GET /v1/games/{id}` when a screen opens one that isn't loaded (`loadGame`) |
| Boards | `GET /v1/games/{id}/leaderboard` (one global board; Friends and Group tabs say "Not available yet") |
| Your run | `POST /v1/games/{id}/scores`, then the returned board |
| Saves (= likes) | `PUT`/`DELETE /v1/games/{id}/like`; your saved games `GET /v1/me/likes` (Library's Saved section, `loadSavedGames`); who saved a game `GET /v1/games/{id}/likes` → `{count, friends}` (`loadSavers`, `saverStates`) |
| Search | `GET /v1/search?q=` (Facebook Search's Games results) |
| Your games | `GET /v1/creations` (Library) |
| Group Blend | `POST /v1/groups/{id}/blend` (Group page, members only) |
| What happened on each page | `POST /v1/feed/events` (`FeedEventReporter`: page events and off-feed moments) |

The app ranks nothing: `game-recs.js` stays in `Bubbles/Recommend/` only because the API image
reads it from there. No Bursts play friends' runs yet (the server keeps scores, not replays), so feed
pages play the bot's demo. Screens show loading, error ("Try again") and empty states from
`LiveDataStateView`, never stand-in content.
Routes and covers: `Route.bubble(id)`, `.bubbleBoard(id)`, `.bubbleLibrary`, `.bubbleChain(id)`,
`.marketplace`; `router.play(...)` opens the player, `router.openStudio(...)` opens Muse Studio.

Surfaces outside the Bubbles screens hook in through `BubbleSurfaceHooks` (called once at launch);
each surface has its own file in `Features/Bubbles/Surfaces/`. Nothing is added to the home feed,
Stories, Reels or notifications at launch; games reach them when you share one. `Post` carries `bubbleID`,
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
| `length`, `lengthRound(info?)`, `lengthMiss()`, `lengthLeft()` | The run's length `{mode, rounds, seconds, lives, locked}`; call `lengthRound` when a round ends (false: over) and `lengthMiss` on a miss (true: a life absorbed it); `lengthLeft()` for HUDs. `hud.length = false` hides the engine's length chip. See 7.9 |

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

The games feature has no demo world: people, friends and Groups come from the games API (section 7
note). `Bubbles/Seeds/bubble-demo-world.json` is read only by Studio's offline pieces until Stage 3
removes them; the wider Facebook clone's mock data (`Data/MockData.swift`) is Stage 5.

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

**Resume (closing mid-run keeps the run).** While a play run is under way the host posts
`{type: "checkpoint", key, tick, score, replay}` every 2 s and when it pauses (the app going to the
background), where `replay` is the run's log so far (`seed`, `tick_rate`, `total_ticks`, `inputs`,
`length`). Nothing is posted before the first tap, in the first second, or once the run is ending.
The player saves the latest checkpoint per game (`RunResumeStoring`, local today:
`Features/Bubbles/Resume/`), keyed by the session key (id, version and content hash, so the same
seed and length), and clears it when the run ends or on Play again. The next open shows Resume or
Start over. Resume activates with `options.resume` (the saved log; play mode only, read from the
activate options and used once): the runtime makes the run with that seed, fast-forwards silently
through the saved inputs to `total_ticks` (`Bubble.resumeRun(run, saved)`), stops replaying, and
shows a "Welcome back · Tap to keep going" card (it posts `{type: "resumed", tick, score}`). The run
keeps recording, so the finished log holds every input once and verifies like a run played in one
sitting (`tools/runtime-tests` checks this for every seed). Burst replays and the feed's in-place
play don't save checkpoints.

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

### 4.9 Test fixtures (formerly seed files)

The app bundles no games. The old seed manifests live in `tools/game-fixtures/bubble-seed-<id>.json`
for the runtime and kit tests (`tools/runtime-tests`, `tools/kits-tests`, `tools/recs-sim`) and the
preview pages. They are a manifest plus keys starting with `_`, which the runtime and validator
ignore (`_seed` held the old demo metadata). `mg-*` are written by `authoring/tools/make-seeds.mjs`
(see 7.11); don't edit them by hand. Demo games belong in the server's database, not the app.

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
- The Muse key lives on the games server (and in `.env` for the CLI); the app has none and it is
  never committed.

## 6. Demo (5 minutes)

1. The problem: new city, a Group of strangers.
2. Open Bubbles: a feed of glowing Bursts; tap one to take over and play.
3. New in SF's Daily Bubble: play, float the result to the Group, see the Bubble Board.
4. Blow a bubble live: type a request, edit the brief, watch Muse compose, play it, make level 2.
5. Share a Burst to your Story; the Event icebreaker; tomorrow's Daily Bubble is the reason to return.

---

## 7. Collaboration: closer together

> **Live data (docs/APP_LIVE_DATA_PLAN.md, Stage 2).** The sections below describe the features as
> first built on the synthetic New in SF cast. That cast is gone from the app: there is no
> `BubbleSocialCast`, no roster, no rival "Maya", no seeded chats, notifications or rivalry history,
> and no bot runs standing in for other people (`simulateRun` is deleted). People are server
> accounts (`BubbleStore.resolvePerson`, `GET /v1/users/{id}`; friends `GET /v1/me/friends`; Group
> members `GET /v1/groups/{id}`); a Group's games are `GET /v1/groups/{id}/games`; Blend is
> `POST /v1/groups/{id}/blend`. What needs server work first shows "Not available yet"
> (`LiveDataStateView`, copy in `LiveDataCopy`): challenges and group-chat sessions (7.2), making
> together (7.4), quiz nights (7.7), the Group weekly board (7.3), friends' story paths (7.6), and
> friends' and Group boards. Saves (7.10) name you and the friends who saved a game
> (`GET /v1/games/{id}/likes`); everyone else is a count. Cards you share still go to the app's
> Messenger chats, which are Stage 5.

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

Friendly competition, through Messenger, friends, profiles and Groups. Any run becomes a fair
head-to-head: one tap on the result sheet sends **Challenge Me** to a friend, a chat or a Group, on
the exact seed and length you played. Opening the card plays that same course, and a head-to-head
result offers **Challenge back**. A card dropped in a group chat or a Group becomes a shared session
everyone plays. With one phone at the demo, friends' sides are bot runs of the real runtime on the
same seed (`BubbleStore.simulateRun`), so their scores carry replays and verify like yours. Files:
`Features/Bubbles/Challenge/` (`ChallengeCenter` holds all state for the launch) and
`Bubbles/Store/BubbleSocialHub.swift`.

**Where it shows.** Result sheet: `ChallengeResultAction` ("Challenge Me", or "Challenge back" and
"Open chat" after a challenge, "Rematch" and "Back to the chat" after a session) opens
`ChallengePickerSheet` locally; `ChallengeResultHeadToHead` shows both players, scores and the winner
(or your rank in a session), plus "Add Maya as a friend" when she isn't one yet. Player: `ChallengePlayerBanner` reads "Beat Maya's 41" and turns into
"Ahead of Maya!" once your live score passes it (the target updates if her score lands mid-run).
Bubble page: `ChallengeDetailRow` ("Challenge a friend", plus your latest challenge on it). Friend
rows: `ChallengeFriendButton` opens `ChallengeGamePickerSheet` (games you've played, best first, then
games they play first). Profiles (not yours): `ChallengeProfileRivalry`, "You vs Maya: 3-2 this
week", the last three results and a Challenge button. The head-to-head screen adds "Watch Maya's
run" (her replay as a Burst on the same seed; tapping takes over as a challenge play) and "Add Maya
as a friend" (posts `add_friend_from_game`).

**Hub contract.** `BubbleSocialHub.send` with a `.challenge` or `.session` card whose `sessionID` is
nil starts one through `ChallengeCenter.open`: a friend or 1:1 chat gets a 1:1 challenge (kind
forced to `.challenge`); a group chat or a Group gets a session (kind forced to `.session`). The hub
assigns `sessionID` (a UUID string), fills the extras below, delivers, then starts the bots. Cards
sent to the feed, and every other kind, are delivered as is. `BubbleSocialHub.play` fills in the
play context for challenge and session cards when the caller passes none (opponent name, score to
beat), and closes Messenger or a feature sheet before opening the player (one cover at a time),
so Play works from a chat. `targets` lists New in SF friends first, the demo group chats first among chats, and New in
SF first among Groups. `receive` counts a message unread unless that chat is open.

**1:1 challenges.** Seed and length are the run's (`replay.seed`, `replay.length`); your score and
replay ride along when you challenge with a run, otherwise they play first. 3–6 s later the
opponent's bot plays: of skills 0.95, 0.85 and 0.7 the app takes the score closest above yours, or
the lowest if none beats you (no score: 0.85). The chat shows typing, then a reply card ("41 💪 your
move"), the invite card's score row updates, an `AppNotification` (`.bubbleScore`, "beat your 34
with 41 in Hill Hopper. Rematch?") arrives with `bubbleAction = feature:challenge/chat/<id>`, and a
toast shows unless the chat is open. Your plays from a card count your best attempt; the first drops
a result card ("You 45 · Maya 41") in the chat. Challenge back makes a new challenge in the same chat
on a new seed (`stableHash("rematch|<id>|<seed>")`), with `rematch_of`; they play first.

**Sessions.** Members are a group chat's participants plus you, or for a Group target the first five
of `BubbleSocialCast.groupMembers` plus you. Each other member's bot plays on a stable delay of
5–25 s, and the card updates live: "N of M played", a progress bar, the top three, "Your turn, Alex"
until you play, then who's left, then the winner line and Rematch. When everyone but you has played,
a notification and toast nudge you. When the session ends, a member cheers the winner in the chat
(once). Playing a session you weren't counted in (the seeded past one) adds you to its members. A
Group target makes a "Challenge New in SF" post that fills in the same way.

**Card extras** (kinds `challenge`, `session`; `share` uses `BubbleChatCardFallback`):

| Key | Type | Meaning |
|---|---|---|
| `scores` | `[{"user_id": String, "score": Int}]` | Everyone who has played, best first |
| `played` | Int | How many have played |
| `members` | Int | How many are in it (2 for a 1:1 challenge) |
| `winner_id` | String or null | Set once everyone has played (null before, and on a 1:1 tie; a session tie goes to whoever played first) |
| `rematch_of` | String | The challenge or session this one is a rematch of |
| `role` | String | `invite` (starts the thread), `reply` (a friend's score), `result` (your head-to-head) |
| `title` | String | The chat or Group name of a session |

**Signals.** `challenge_sent` (1:1 or group chat; with the opponents), `group_challenge` (a Group
target), `challenge_rematch` (any rematch), `challenge_accepted` (a friend's score lands),
`challenge_won` (a 1:1 turns into your win: your run passes theirs, or theirs lands below yours),
`group_chat_play` (your first play in a session), `add_friend_from_game` (result sheet after a
challenge, and the head-to-head screen).

**Locked length.** A challenge or session card that arrives without a length and without a run of
yours gets `card.length = BubbleLength.locked(for: bubble)` (7.9), and session cards show it as a
locked chip ("Same for everyone: 10 rounds"). A card that carries your run keeps that run's length.

**Verification.** Every play from a card runs `manifest.withSeed(card.seed).withLength(card.length)`,
so your recorded `BubbleScore.replay.seed` equals the card's seed (DEBUG logs a mismatch), and
`BubbleStore.verify` checks it (`BubbleRuntimePerf` "verify" lines). Friends' entries keep their bot
replay and are marked verified; a check mark shows next to verified scores. Nothing records a score
for you that you didn't play (the seeded past session includes you only with your real Fog Drift
best). `tools/kits-tests/suite-challenge.js` checks, for one seeded Bubble per formula, that bot
runs at 0.95, 0.85 and 0.7 on a challenge seed and a rematch seed record that seed, replay exactly
and repeat exactly.

**Seeds** (at launch, no seed files): a 1:1 chat with Maya (two friendly messages from New in SF); a
finished Fog Drift session in New in SF crew with a winner line; rivalry histories with Maya (3-2)
and Diego (2-2) from `stableHash("rivalry|<id>")`. Everyone else starts at 0-0; live results add to
`ChallengeCenter.shared.rivalry(with:)`.

**FB_OPEN** (with `FB_SKIP_SPLASH=1`): `feature:challenge/picker/hill-hopper` (the picker, with your
best or a staged 34), `feature:challenge/chat/hill-hopper` (a challenge to Maya, her reply in about
4 s), `feature:challenge/h2h/hill-hopper` (a finished You 45, Maya 41), `feature:challenge/groupchat/fog-drift`
(a session in New in SF crew filling in over about 20 s), `feature:challenge/rivalry/sf-maya-okafor`
(Maya's profile) and `feature:challenge/friend/<userID>` (pick a game for them). `FB_TAB=friends`, then
All friends, shows the Challenge buttons.

### 7.3 Games in Groups and Search (groups-search)

Games live where Facebook already gathers people: a Group's **Games** tab and **Search**. Closer
together through friendly competition: a weekly Group board puts names and faces next to each other,
"Most improved" means it isn't only for the best player, Add friend sits on every row of someone you
don't know yet, and "Challenge the Group" starts a shared game in the Group feed. Code:
`Features/Bubbles/GroupsSearch/` (`GroupsSearchScreens`, `GroupsSearchSlots`, `GroupGamesStore`,
`GroupWeeklyBoardView`, `GroupGamesHubView`, `SearchGamesResults`); copy in `GroupsSearchCopy`.

**Games tab** (`GroupsSearchGamesHub` on top, `GroupsSearchGamesList` at the bottom): today's Daily
Bubble (`BubbleGroupDailyCard`), the weekly board card and "Challenge the Group"; the quiz night
card comes from nextline's `NextlineGroupGameNight` slot right below; and at the bottom a grid of `worldBubbles(in:)` with "N members played". The Featured tab gets one line,
`GroupsSearchFeaturedTeaser` ("This week: Diego leads · you're #3"), which opens the full board.

**Weekly board** (`GroupGamesStore.shared.weeklyStandings(group:)` →
`[Standing(user, points, lastWeekPoints, rank, rankChange, isMostImproved, gamesPlayed)]`). Each
Group game (icebreakers excluded), each day: 1st 5 points, 2nd 3, 3rd 2, anyone else who played 1.
This week is the last 7 days. Today counts the real Group boards (`leaderboard(for:scope: .group)`,
with your entry being your best run from today), so a run moves you at once. Earlier days for the cast come from a stable synthetic history (hash of
Group, person, game and date; New in SF is tuned so Diego leads, Chloe is most improved and Maya won
last week); your earlier days count only your real runs (1 point per game played), never invented
scores. "Most improved" is the biggest gain on last week, leader excluded. The leader row plays a
one-shot trophy pop and sparkles once per launch (still under Reduce Motion). Add friend calls
`appStore.sendRequest(to:)` and posts `add_friend_from_game` (`with: [userID]`, bubbleID = the
Group's Daily or first game).

**Challenge the Group** (`GroupChallengeComposer.post`): pick the Daily or a Group game, then
`BubbleSocialHub.send` a `BubbleChatCard(kind: .session, seed: manifest.seed, length:
manifest.length, sessionID: nil, score: your best)` to the `.group` target, so the post lands in the
Group feed and the challenge feature runs the shared session. Extras keys (groups-search): `origin`
= `"groups-search"`, `group_id` = the Group id. `group_challenge` (with the session's members) is
posted by the challenge feature when it starts the session, not again here.
groups-search owns only the button and the post copy; challenge draws the card.

**Game night**: `GroupsSearchScreens.gameNightRoute(for: groupID)` =
`BubbleFeatureRoute(.nextline, "night", groupID)`; nextline implements it and draws the Games tab's
only game-night entry (the hub dropped its own card at integration so there is just one).

**Search** (`SearchView`): a "Games" filter chip and a Games section in All (4 rows, all on the
filter). `gamesMatching(query:in:)` is a pure, case- and diacritic-insensitive match on title,
rule, creator name, formula title, category title (Adventure, Quiz night, Learn) and Group name;
every query word must match; title matches rank first; an empty query returns nothing ("fog" →
Fog Words, Fog Drift and Fog or Sun? by title, then Hill Hopper by its rule). Rows show cover, title, category
or formula, creator, Group, friends' faces with "N friends played", Save (`toggleSave(_, source:
.search)`) and Play (`router.play`); tapping the row opens the Bubble page. People rows show
`SearchPersonGamesStrip` (up to 3 covers, "Diego's games"). With no game matches, a "Make
"<query>" with Muse" row opens `router.openStudio(StudioLaunch(prompt: query))`.
`SearchView(initialQuery:startsOnGames:)` opens on the Games filter.

No seeds, kits or tags. `FB_OPEN=feature:groups-search/<screen>/<arg>` (with `FB_SKIP_SPLASH=1`):
`search/fog` (Games filter), `search/picnic%20dance-off` (URL-decoded; shows Make with Muse),
`games/group-newinsf` (Group page on Games), `leaderboard/group-newinsf` (full board),
`gamenight/group-newinsf` (nextline's night route), `challenge/group-newinsf` (posts a Challenge the
Group for the Daily, then opens the Group feed) and `addfriend/group-newinsf` (sends Maya a request
from the board, then opens it). `router.bubbleSheet = BubbleFeatureRoute(.groupsSearch,
"challenge", groupID)` shows the game picker over the tabs.

### 7.4 Make it together, and games about you (together)

Making a game becomes something friends do together, and a way to say something about yourself.
Two flows: **Make it together** (start a game, invite a group chat, a friend or a Group to add a
question, words, a scene or a level; Muse stitches every contribution into one game whose credits
name every maker) and **Games about me** (a template turns your answers into a quiz; friends play it
and your profile shows who knows you best). Code: `Features/Bubbles/Together/` (state in
`TogetherCenter.shared`, strings in `TogetherCopy`) and `Bubbles/Studio/TogetherStudio.swift`.

**Make it together.** `TogetherStartSheet` picks what friends add (`TogetherAskKind`: `question`,
`words`, `scene`, `level`), the game's name, the ask, and one target from
`BubbleSocialHub.targets` (group chats first, then Groups, then friends; New in SF crew is the
default). Start creates a `TogetherSession` (`id, kind, title, ask, starterID, target, invitedIDs,
entries, inviteCardID, bubbleID?`) and sends the invite card with `hub.send`. Two people from the
target add over about 3–10 s (the first adds one, the second two; canned, original content in
`TogetherCopy.cannedContributions`): each arrives through `hub.receive` in a chat, or as a live count
on the Group's invite post through `hub.update`, with a notification (tap opens the session) and
`co_make_contribution` with the maker's id (the session id stands in for `bubbleID` until the game
exists). `TogetherSessionView` shows contributions arriving with avatars, who is still adding, and
your own (question, right answer, optional wrong answers; words; or a line of text). **Stitch with
Muse** opens Studio with `StudioLaunch(prompt: "“<title>”: …", social: StudioSocialContext(makers:
[starter, contributors…], contributions: [...]))`, the Group as audience for Group sessions; the
Studio entry sets `formulaHint` (questions → answer, words → guess).

**Contribution card extras** (`BubbleChatCard.kind == .contribution`, `bubble_id` empty until the
game exists):

| Key | Type | Meaning |
|---|---|---|
| `session_id` | String | The `TogetherSession` (also in `session_id` on the card) |
| `stage` | String | `invite`, `contribution`, `published`, `played` or `about_me` (your game about you, sent to a chat) |
| `kind` | String | `question`, `words`, `scene` or `level` |
| `ask` | String? | What the starter asked for (invite) |
| `text` | String? | The contribution as written (contribution), or the maker's result line (played) |
| `title` | String | The game's name |
| `added` | Number? | Live count of friends' contributions (invite) |
| `makers` | String? | The credit line, "Made by Maya, Diego and you" (published) |

A question's `text` is `"<question>\nAnswer: <answer>\nAlso: <wrong>, <wrong>"`
(`TogetherStudio.encodeQuestion` / `parseQuestion`); words are `"BLANKET (clue), FRISBEE"`
(`parseWords`: A–Z, 3–10 letters, clue in parentheses).

**Studio** (`TogetherStudio`, runs only when `request.social` has contributions, more than one
maker, or an about-me template, so remixes are untouched). `promptLines` adds a **Made together**
block (each maker's exact contribution; keep their wording, fix only spelling, credit everyone, fit
the formula schema, top up to 5 rounds with rounds noted "Added by Muse") or an **About <name>**
block (Q/A pairs; the subject's answers are right, decoys plausible but not theirs, no brands,
nothing private beyond what's given). `applyOffline` turns questions into answer-key rounds (the
maker's answer plus their wrong answers and a fitting pool, at a stable position, note
"<Maya>'s question"), tops up to 5 rounds from `TogetherStudio.toppers`, switches the answer
manifest to `rule.answer_key` + `score.answer_points` with `flow.rounds` count = rounds, and takes
the title from the quoted prompt; words become the guess kit's `words` and `clues` (no daily gate).
Scenes and levels need Muse online; offline keeps the template's content and still credits every
maker. The stitch line ("Stitched 3 questions from 3 makers; added 2 Muse questions…") goes in
`brief.notes`. `finalize` (metadata only) sets `lineage.makers`: the starter first with role
`starter`, then each contributor once with role `contributor` and what they added ("a question",
"2 questions", "4 words").

**Published.** `didPublish` takes the first new Bubble whose `lineage.makers` has more than one
entry, you as starter, and no `remix_of` or `parent`: a `published` card goes to the session's chat
("We made Picnic Trivia together · Play"), or the Group's invite post turns into it; you get a
notification naming the makers; `co_make_contribution` posts with every maker's id; and each maker
plays the game a few seconds later (`simulateRun`, scores added to the board, a `played` card in
the chat). `TogetherDetailCredits` on the Bubble page shows "Made by Maya, Diego and you" with each
maker (tap for their profile) and what they added.

**Games about me.** Templates (`TogetherStudio.templates`, ids `how-well` "How well do you know
me?", `first-month` "My first month in SF", `favorite-spot` "Guess my favorite spot") have 5–6
questions, each with an id, a form label, a third-person round prompt (`{name}`), decoys and a demo
answer. `AboutMeFormSheet` prefills the answers (edit any; blank skips), can add your opted-in posts
(`allowsBubbles`) as `aboutMeAnswers["from_posts"]`, and opens Studio with `social.aboutMeTemplate`,
`aboutMeAnswers` (by question id) and `makers: [you]`, prompt "“How Well Do You Know Alex?”: a quiz
about me…" (from Studio's own entry it fills the open Studio instead). `applyOffline` builds one
answer-key round per answered question in template order; `finalize` sets `about` `{subject_id,
subject_name, template}` from the first maker. When a game about you publishes, Diego, Aiko and
Theo play it over the next ~12 s (Diego knows you best in the demo).
`TogetherProfileAboutMe` (profile Bubbles tab) and the `together/profile/<id>` page list Bubbles
whose `about.subject_id` is the person (`"me"` counts as you), "Who knows <name> best" (each
player's best score per game, summed; on your games friends only, on a friend's games your own runs
count too; top 3, with Add friend for people who aren't friends yet, posting
`add_friend_from_game`), Play it on a friend's game, and for you the three templates plus **Send to
friends** on each of your games: an `about_me` card (`bubble_id` set, `stage`, `title`) goes to New
in SF crew through `hub.send`, posting `share` with the chat's members, and friends' plays follow. Finishing a run of someone else's about-me game posts `about_me_play` with
`[subject_id]`. `TogetherGroupMakeRow` on a Group's Games tab starts a session with the Group as the
target and lists its sessions in progress.

**Seeds.** `bubble-seed-together-picnic-trivia.json` (answer; creator you; New in SF; makers Alex
starter, Maya, Diego; 6 rounds, 2 "Added by Muse") and `bubble-seed-aboutme-maya-first-month.json`
(answer; creator Maya; `about` Maya, `first-month`). Both pass the strict kit tests.

**FB_OPEN** (with `FB_SKIP_SPLASH=1`):

| Value | Opens |
|---|---|
| `feature:together/start[/group:<id>\|chat:<id>\|friend:<id>]` | `TogetherStartSheet` over the tabs |
| `feature:together/session/demo` | Stages Picnic Trivia in New in SF crew (contributions over ~10 s) and pushes the session |
| `feature:together/session/<id>` | A session started this launch |
| `feature:together/aboutme[/<template>]` | The template picker, or `how-well`, `first-month`, `favorite-spot`'s form |
| `feature:together/profile/me` | Stages your "Alex's First Month in SF" (offline rounds) and friends' plays, then pushes "Games about me" |
| `feature:together/profile/<userID>` | Games about that person, e.g. `sf-maya-okafor` |
| `bubble:together-picnic-trivia` | The Bubble page with "Made by Maya, Diego and you" |

### 7.5 Remix and share (remix)

Remixing and sharing bring people closer through self-expression built on each other's work:
every remix credits the game it came from, its creator hears about it, and the remix can go back
to them as a playable card. Code: `Features/Bubbles/Remix/` and `Bubbles/Studio/RemixStudio.swift`.

**Credit (manifest lineage).** A remix keeps `lineage.parent` and `operators` as Studio's identity
sets them, plus `remix_of` (the base id), `remix_of_title`, `remix_of_creator_id` (the base
creator's id: a demo-world id, `"me"` in seeds, or your own user id from Studio) and `remix_of_creator_name` (first name; omitted when the base is your own game).
`RemixStudio.finalize` fills them in remix mode from `request.base` and `request.social`
(`StudioModel` puts the base creator in `social`), and an edit of a remix keeps them.
`RemixStudio.promptLines` tells Muse: keep the core and feel, change what was asked, and give it a
title that nods to the original. The offline remix path and the bot playtest are unchanged.
`RemixLineage` (app side) builds on `remix_of` only: `descendants(of:in:)` (all generations),
`root`, `tree(around:in:maxDepth:maxNodes:)` (friends' remixes first) and `credit(for:)` ("Remix of
Hill Hopper by Diego"; "Remix of your Moving Day" for your games). Chains stay separate: they are
levels of one game, not remixes.

**Surfaces.** Remix is on the feed rail (existing), the result sheet (`RemixResultAction`: Remix,
Share, and "Send it back to <name>" for your remix of someone's game), the Bubble page (the existing
Remix button; Float became **Share**) and `.remix` cards ("Remix back"). Every path opens Studio in
remix mode with the game loaded. Feed captions (`RemixCaptionCredit.text(for:in:)`, as one part of
the page's meta line) say "Remixed by Diego · from
Maya" when a friend made the remix, "Remix of Hill Hopper by Diego" otherwise, and "2 remixes" on an
original. The Bubble page (`RemixDetailTree`) shows the remix count, the credit with "Open original",
a tree of up to 2 levels and 6 nodes ("+N more") with friends ringed in blue, and "See all".
Under the tree, "Remixers you might know" lists up to 3 creators in the family who aren't your
friends yet, each with Add friend (`appStore.sendRequest`, plus the `addFriendFromGame` signal).

**Send it back.** `RemixCenter.sendBack` sends a `.remix` card to the original creator's 1:1 chat
through `BubbleSocialHub.send(_, to: .friend(creatorID))`, posts the `remix` signal with the
creator, and the creator replies a few seconds later.

**Share.** `RemixShareSheet` lists `BubbleSocialHub.targets(kinds: [.feed, .story, .chat, .group,
.friend])`. Feed, Group, chat and friend get a `.share` card with the Bubble's (or the play's) seed
and length and your score from a result; Story uses `BubbleSurfaceHooks.shareToStory` with a result,
else a story item with the featured run. Every share posts the `share` signal with the people it
reached (a friend, a chat's members, New in SF's members, nobody for feed and story).
Signals: `remix` (with the original creator), `share` (with recipients) and `addFriendFromGame`.

**After publish.** `RemixScreens.didPublish` fills a missing credit, posts `remix` with the original
creator (never you, once per creator per publish, so a remixed Chain doesn't repeat it), and schedules the creator's reply in your chat plus a "played your remix"
notification that opens the tree.

**Card extras.** `.remix`: `original_id`, `remix_id` (strings). `.share` (sent by remix):
`score` (number, optional). No result tags.

**Notifications at launch.** "Diego remixed your Moving Day into Moving Day: Fourth Floor Walk-up"
and "Maya remixed Diego's Hill Hopper into Hill Hopper: Night Hop", both `.bubbleRemix` with
`bubbleAction` = `remix/tree/<remix id>`.

**Seeds.** `remix-hill-hopper-night-hop` (Maya's remix of `hill-hopper`),
`remix-night-hop-fog` (Diego's remix of Maya's) and `remix-moving-day-diego` (Diego's remix of your
`moving-day`); all dodge.

**FB_OPEN** (with `FB_SKIP_SPLASH=1`):

| Value | Opens |
|---|---|
| `feature:remix/tree/hill-hopper` | The remix tree screen (pushed): count, tree, Remix, Share |
| `feature:remix/sendback/remix-night-hop-fog` | Stages it as your remix, then the Send it back sheet |
| `feature:remix/share/hill-hopper` | `RemixShareSheet` via `router.bubbleSheet` |
| `remix:hill-hopper` | Studio in remix mode (existing) |
| `bubble:remix-night-hop-fog` | A remix's page: credit pill, Open original, tree |

`FB_TAB=notifications` shows "Diego remixed your Moving Day…"; tapping it opens the tree.

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
`{mode: "rounds"}` with no number (an unlocked story ends at its ending, and the validator caps
depth at 12, so no length label shows), suggesting `rounds: 12` (the depth cap) when a length is
locked. Each scene left is `lengthRound()`, except that when one round is left the run jumps to the
nearest ending without spending it, so the engine never ends a story mid-scene and every run ends
on an ending with its tag. The kit draws no engine length chip. It also emits `story.reached_<n>`
at ending n, so playtest event counts show which endings bots found.

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

The `nextline` formula (category Quiz night): a short, original scene (2–3 shape characters whose
lines type out in speech bubbles) freezes right before the punchline, and players pick the real
next line from four tiles against a timer. A quiz night runs in a Group or group chat: a lobby
fills with members, everyone plays the same seed and length, members light up as they answer, and
a podium, a Rematch and the game night card close the loop. Members' sides are real bot runs
(`simulateRun`) on the night's seed and length; the app only paces them to your clock.

**Kit** (`bubble-kit-nextline.js`). Concepts: `space.nextline_stage` (stage, characters, typed
bubbles; idle bobs on the tick clock), `entity.line_tiles` (the tiles and timer bar),
`rule.next_line` (params `round_seconds` 4–15, default 8; `shuffle_episodes`) and
`score.quick_answer` (`base` 500 + up to `speed_bonus` 500 by time left, times a streak
multiplier: +`streak_step` 0.5 per right answer in a row, up to `max_multiplier` 3; glue slot
`score`). Content:

```
{ episodes: [ { title ≤ 40, setting? ≤ 80,
    cast: [{ name ≤ 14, shape: blob|square|tall|round|star, role: primary|secondary|accent }] (2–3),
    lines: [{ who: <cast name>, text ≤ 70 }] (2–6),
    next_who: <cast name>, answer ≤ 60, decoys: [3 × ≤ 60, distinct from the answer],
    reveal_emoji? } ] (2–6) }
```

Tile style: four full-width rounded cards in one card color with a number badge and a small
speech tail. No color or shape coding per answer, no copied sounds. A time-out is wrong and breaks
the streak. Timing (ticks): lead-in 18, title 54, each line `ceil(chars × 1.25) + 22` (a tap on the
stage finishes a line), the timer, then a 150-tick reveal; `QuizTimeline` mirrors it in Swift.
Length: `rounds` (default 5, capped at the episode count), `timed` (finishes the round in
progress) and `lives` (a miss calls `lengthMiss()`; out of lives fails the run). The bot is right
with probability 0.35 + 0.6 × skill and answers faster with skill.

**Share tag**: `right=4/5;streak=3;r=1:1.8:1:868|2:8.0:0:0|…`. `right` is right/played,
`streak` the best streak, and each `r` entry is `round:seconds:correct(1/0):points` (a time-out
reports the full timer). Falls back to dropping points, then `r`, to stay within 120 characters.

**Card** (`.gameNight`, sent with `BubbleSocialHub.send` to the Group or chat; the seed and
`length: rounds(n)` lock everyone to the same game). Extras: `night_id`, `bubble_id`, `rounds`,
`members` (Int, you included), `place_name`, `standings` (`[{user_id, score}]`, people whose run
has finished on the night's clock) and `winner_id` (once everyone is done).
`BubbleSocialHub.update` keeps it live. Play context: `.gameNight` with `id` = the night id.

**Signals**: `game_night_play` (with the members' ids) when a night starts and when you finish;
`add_friend_from_game` from the podium's Add friend. Someone else's win adds a notification whose
`bubbleAction` opens the podium; in a group chat a member reacts.

**Screens** (`NextlineScreens`, state in `QuizNightCenter.shared`): `night/<groupID or chatID>`
(lobby), `podium/<nightID>`, `results/<bubbleID>` (latest finished night). Slots:
`NextlineResultSummary`, `NextlinePlayerBanner` (live strip, mini leaderboard between rounds; its
clock starts when the player sets `EnvironmentValues.bubblePlayerStarted` on the banner slots,
which happens once the intro card is tapped),
`NextlineGroupGameNight`, `NextlineFeaturedBanner`, `NextlineDetailRow` (Start a quiz night in…),
`NextlineCardBody`. The groups-search Games tab opens `BubbleFeatureRoute(.nextline, "night",
groupID)`.

**FB_OPEN** (with `FB_SKIP_SPLASH=1`): `play:nextline-thermostat-wars`,
`feature:nextline/night/group-newinsf`, `feature:nextline/night/bubble-chat-newinsf-crew`,
`feature:nextline/live/nextline-thermostat-wars` (a staged night in New in SF: the card posts and
the player opens with the live strip) and `feature:nextline/results/nextline-thermostat-wars` (a
staged podium; your side there is a practice bot run, labeled and never recorded).

**Seeds**: `nextline-thermostat-wars` (roommates and the thermostat, riso, by Chloe) and
`nextline-hill-parking` (new neighbors on a steep street, clay, by Omar), both in New in SF, 5
episodes each. **Studio**: `NextlineStudio.hint` (keywords such as quiz night, punchline, what
they say next; looks riso, paper, clay; a composer guide; offline: five scenes from original
templates with the request's subject; playtest flag `nextline_short` under 15 s). **Tests**:
`tools/kits-tests/suite-nextline.js`.

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
`subject` is the meter's noun phrase. Length: `rounds` (default: one per question, labeled from
`content.questions`; a locked length suggests 8), `lives` (each
wrong answer costs a life; 3 by default) and `endless` (fresh order each pass until the first miss);
the kit calls `lengthRound()` after every question except the last of a locked rounds length (so the
engine doesn't end the run before the recap and tag), and `lengthMiss()` on every miss. A run succeeds at `pass_ratio` mastery or better. Events:
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

Length is a first-class primitive: every kit honors one contract, so a creator can shape how a run
feels and shared play stays fair. A challenge, a group-chat session or a Group game night locks
everyone to the same mode and numbers ("10 rounds for everyone"), and each friend's bot run plays
that same length.

**Manifest.** `length: {mode: endless|rounds|timed|lives, rounds?, seconds?, lives?}`, only the
mode's own number; rounds 1–50, seconds 10–300, lives 1–9. No `length` plays exactly as before
lengths existed (same scores, ticks and events for every seed; `tools/kits-tests` checks it).

**Formula declaration** (`defineFormula`):
`length: {modes, default, numbers?, infer?, knobs, describe?}`. `default` is the unlocked length
(its number may be left out: "rounds from content"); `numbers` suggests a number per mode when a
creator picks one (`{rounds, seconds, lives}`); `infer` names what an unlocked run's length comes
from, for labels only (`{rounds: ["rule.timing_window.targets", "content:rounds"]}`); `knobs` are
the Customize sliders, `{speed|difficulty|timer|rounds|lives: {concept ("a|b" for alternatives),
param, label, min, max, step?, invert?}}` (`invert`: a higher param is easier). The catalog lists
each formula's `length`, plus `length_modes`, `length_limits` and `length_knobs`.

| Kit | Modes (default first) | A round is | Knobs |
|---|---|---|---|
| dodge | endless, timed, rounds, lives | an obstacle cleared | speed, difficulty (gap) |
| time | rounds (targets/goal), timed, lives, endless | a hit or a stacked piece | speed, difficulty (perfect zone) |
| merge | endless (rule.timer: timed), timed, rounds | a drop (the jar settles 1.5 s after the last) | speed (drop pace), difficulty (overflow grace) |
| group | rounds (the deck), timed, lives, endless | a bubble sorted or lost | speed (rise), difficulty (bubble pace) |
| answer | rounds (content), timed, lives, endless | a question (content cycles) | speed (pace), timer (seconds per question) |
| guess | rounds (tries or facts), timed, lives | a try (word) or a fact (who) | speed, difficulty (faces) |

**Runtime.** `resolveLength` gives `sdk.length = {mode, rounds, seconds, lives, locked}` (frozen).
`locked` is true when the manifest sets `length`; a locked length always has its number (the
manifest's, the formula's `numbers`, else 10 rounds, 60 seconds or 3 lives). The engine enforces a
length only when it has a number:

- `sdk.lengthRound(info?)` counts a round and emits `length.round {index, done, total, left}`; at
  N it emits `length.end` and ends the run after this tick (`info.delay` ticks later, `info.outcome`
  "fail" to end it as a fail) and returns false.
- `sdk.lengthMiss()` in lives mode emits `length.life {left, lost, total}` and returns true while a
  life absorbed the miss; the last one emits `length.end` and returns false (apply your normal fail).
  Outside lives mode it returns false.
- Timed: at seconds × 60 ticks the engine emits `length.end {mode: "timed"}`, then (if no handler
  ended the run first) `rule.success` and ends it in success. A kit can end it first with its own
  outcome (a word not found in time is a fail).
- `sdk.lengthLeft()` returns `{rounds_left, seconds_left, lives_left}` (null when unused).
- The engine draws a small HUD chip top left ("Round 3/10", a timer ring with seconds, lives as
  bubbles) through `g` with palette roles, only for an enforced length and never on the intro. A
  concept that shows the length itself sets `sdk.hud.length = false` (rule.timer, rule.lives and
  flow.rounds do; so do the story kit, the learn kit and the nextline kit in rounds mode, which
  draw their own progress).

**Precedence.** A manifest `length` (a locked one; a formula's unlocked default never does)
overrides the common concepts' numbers: rule.timer runs for
`length.seconds` (a locked length in another mode turns rule.timer off), rule.lives takes
`length.lives` misses through `lengthMiss`, flow.rounds plays `length.rounds` rounds (content
cycles) and has no round count in a locked timed, lives or endless run, rule.attempt_budget allows
`length.rounds` tries or `length.lives` wrong tries. Kit goals (time's targets and goal, group's
deck, answer's content) become the length's rounds, or unlimited in the other locked modes. In a
locked endless run with no rule.lives, the first miss ends it; with rule.lives, its lives do.

**Intro card, replays, validation.** The intro card shows the length next to the title:
"Endless: beat 42" (with `player.best`, in place of "Your best"), "10 rounds", "60 seconds",
"3 lives" (`Bubble.displayLength(manifest)`, `Bubble.lengthLabel(len, best)`). `replayLog()`
carries a locked `length`, and `simulate` (and the host's `replay` mode, for Bursts) applies
`replay.length` to a manifest without one, so a replay is self-describing; `BubbleStore.verify`
replays with it. Validation errors (code `length`):
a bad shape, a mode the formula doesn't list, a number that isn't a whole number in range; a
warning when the formula declares no length.

**Swift.** `BubbleLength` (`label`, `label(best:)`, `shortLabel`, `normalized`, `json`,
`init?(json:)`), `BubbleLengthSpec` and `BubbleLengthKnob` (a formula's declaration), and
`BubbleLengthCatalog.shared` (built in, mirroring the kits; `LengthScreens.install` registers the
runtime catalog over it a few seconds after launch). Helpers for other features: `BubbleLength.defaultLength(for: manifest)`,
`BubbleLength.effective(for: manifest)` (what players see), `BubbleLength.locked(for: bubble)`
(what a challenge, session or game night card should carry in `card.length` and pass to
`BubblePlayRequest.length`) and `BubbleLength.of(run: replay, in: bubble)`.

**Players.** Feed pages: the length's `shortLabel` in the caption's one meta line ("Level 1 ·
Endless · 2 remixes"; `LengthCaptionLabel` is no longer on the feed). Bubble page:
`LengthDetailRow` (mode, best to beat, the shared-play promise, Customize for the creator). Result
sheet: `LengthResultLabel` ("60 seconds · 41", from the run's own `replay.length`), plus "You and
Maya played the same 10 rounds" in a challenge, session or game night.

**Studio.** `LengthCustomizePanel` (under the details card on Try): a mode picker with only the
formula's modes, a stepper for the number, a slider per knob the manifest uses. Every change
re-validates and re-playtests the level with a headless runtime after a short pause and is kept
only if it validates and the bots can play it ("Playtest: a typical player lasts 60 s, 34 points");
choices land in `StudioModel.length` and `.tuning` (knob id to param value), so a later "Tweak it"
keeps them. `LengthStudio`: `promptLines` locks Muse to `request.length`, or asks it to pick
`length` from the brief ("a quick game for the bus" is timed 45) and to keep the creator's tuning;
`applyDraft` copies the request's or the draft's valid `length` (else the base Bubble's) and applies
tuning; `applyOffline` applies `request.length` and tuning, or a length the brief clearly asks for
(the bus, a quiz night, "until you drop", kids); `finalize` does nothing. Both cap a nextline rounds
length at its episode count, because nextline plays each episode once.

**FB_OPEN screens** (with `FB_SKIP_SPLASH=1`): `feature:length/customize/<bubbleID>` (Studio
editing it, scrolled to Customize; `FB_STUDIO_SCROLL=customize` does the same on any Studio
launch) and `feature:length/intro/<bubbleID>/<mode>` (the player locked to timed 60, rounds 10,
lives 3 or endless, on its intro card), for example `intro/hill-hopper/timed`,
`intro/newinsf-fog-or-sun/rounds`, `intro/cable-car-catch/lives`. No cards, extras, tags or seeds
of its own.

**Tests.** `tools/kits-tests/suite-length.js`: every example and seed of every declared formula, in
every mode, at three bot skills: timed runs end at seconds × 60 ticks, rounds after N
`length.round`, lives after N `length.life`; endless matches today's run where today's is endless;
every run replays exactly, also from a self-describing replay on the plain manifest. story,
nextline and learn get the replay checks until their kits call the length hooks.
`tools/runtime-tests/checks.js` has a Length section (catalog, validation, labels, replays).

### 7.10 Saves are the likes (saves)

People leave a game to save it but not to like it, so saves are the appreciation signal on every
Bubble surface. The contract (`BubbleStore.toggleSave(_:source:)`, `BubbleSaveSource`,
`Notification.Name.bubbleSaveChanged`) is in 7.1; this section is what the feature adds.

**Surfaces and sources.** Every save below goes through `toggleSave`; nothing sets `isSaved` or
`saveCount` directly.

| Surface | Control | `source` |
|---|---|---|
| Player top bar (`SavesPlayerButton`) | 36 pt bookmark before mute; haptic and symbol bounce; no sheet, toast or pause; shown while playing and while watching a Burst | `game` |
| Result sheet (`SavesResultAction`) | primary full-width Save / Saved; Play again is secondary | `result` |
| Feed rail (`BubbleFeedRail`) | bookmark with `saveCount.fbCompact`, in the old like slot; the separate Save button is gone | `feed` (the tab's default) |
| Bubble page (`BubbleDetailView`) | Save action; stats read "N saves" | `detail` |
| Library (`SavesLibraryStats`) | bookmark on your most-saved game | `library` |

**Likes are folded away.** `likeCount`, `isLiked` and `toggleLike` stay (persistence and old
archives), but no Bubble surface shows or sets them.

**Copy.** All strings live in `SavesCopy`. 'Saved by Diego and 37 others' (friends named first,
'you' first when you saved it), '1.2K saves', '38 saves this week', 'Your games were saved N times
this week', and the first-run hint 'Saving is how you show love for a game. Tap the bookmark
anytime, even mid-game.' (once, `bubbles.saves.hintSeen` in UserDefaults; in the player, and on the
feed as a one-line tip beside the Save button that never shows on the first page, is marked seen as
it appears and fades after 4 s; dismissed by tap or by saving, and in the player after 12 s on screen).

**Reusable.** `SavesSocialProof.savers(for:in:limit:) -> [User]` (deterministic, friends first,
you first when saved, never the creator, never more than `saveCount`),
`SavesSocialProof.text(for:in:) -> String?` and `SavesSocialProof.savesThisWeek(_:)`.

**Notifications.** At launch a `.bubblePlayed` row 'Diego Ramirez and 37 others saved Moving Day.'
(`extraActorCount = saveCount - 1`; the actor is the friend the feed caption names) is added with
`bubbleAction = route(.saves, "stats", id)`. When one of your Bubbles' `saveCount` reaches 10, 25,
50, 100, 250, 500 or 1000 after a save, a milestone row is added (once per number).

**Who saved it.** The feed caption shows one social line: a friend's best to beat (opens the board)
or, when no friend has a run, 'Saved by …' (opens the list). Long-pressing the feed's Save button
(or the VoiceOver action 'See everyone who saved it') pushes `feature:saves/stats/<id>`.
`SavesStatsView` lists you and the friends who saved it (`GET /v1/games/{id}/likes`, loaded once
per game per session by `BubbleStore.loadSavers`, skipped when nobody but you saved it or you're
signed out), then "and N more" for savers the server doesn't name. It shows loading and "Try again"
states. The Bubble page shows the top three for your own Bubbles.

**Seeds.** Every seed's `_seed` block has `save_count` (hill-hopper 1,240 down to 17).

**For the recommender (Kevin).** Listen for `Notification.Name.bubbleSaveChanged`; userInfo is
`["bubbleID": String, "isSaved": Bool, "source": String]`. Treat `game` and `result` as the
strongest signals: the player chose to leave attention on the game to save it, or saved right
after a run. `feed` is a browse-time save, `detail` and `library` are deliberate re-visits.
`isSaved == false` is an unsave and should cancel the earlier boost. Read totals from
`Bubble.saveCount` (seed counts plus yours) and `BubbleStore.savedBubbles` for the set you saved.
Add friend from the savers list posts `.addFriendFromGame`.

**FB_OPEN screens.** `feature:saves/hint` (resets the flag and plays Hill Hopper so the hint shows),
`feature:saves/stats/<bubbleID>` (an unknown id falls back to your first Bubble),
`feature:saves/library`. The feed, `play:hill-hopper` and `FB_TAB=notifications` show the rest.

### 7.11 Microgames: the Rust/WASM engine (microgame)

Bubbles with `formula: "microgame"` run on the microgame engine (`engine/`, Rust compiled to
WebAssembly) instead of the JS kits, **side by side**: every other formula is unchanged. Challenge Me,
group-chat play, Groups leaderboards and saves stay on the JS formulas for now. Plan and history:
`authoring/INTEGRATION.md`.

**Manifest.** The whole game is in `content.game_json`: a `microgame/0.1` or `0.2` game
(`engine/SPEC-v0.2.md`: rules, state, presentation, assets, audio) **as JSON text**.
`content.authoring_json` optionally keeps the authoring manifest it was expanded from
(`authoring/SPEC.md` 2.7), also as text, for remixing. Text, because key order is part of a game's
meaning (function params are positional; a state init reads only earlier state) and Swift's `JSONValue`
writes objects with sorted keys: as text, the game reaches the engine byte for byte as it was validated
and gated. (`content.game` as an object is still accepted, for hand-made games.) Concepts are always
exactly `space.microgame`, `input.microgame` and `score.microgame` (params: `runtime_hud`, `swipes`,
`label`). `authoring/expander/wrap.mjs` (`wrapGame`) writes this wrapper, and picks `style.colors`
from the game so the frame and letterbox match it.

**Score model.** A microgame manifest may carry a top-level `score` (next to `formula` and `brief`):
what its board ranks, `direction` (`higher` or `lower`), `counts_when` (`finished` or `any`),
`aggregate` (`best`, `latest`, `sum_week`), `tie_break` (`less time`, `earlier`), `format` (`{n} orders`,
`{n}%`, `m:ss.t`), `events`, the `bounds` the bots reached plus headroom, and `ranked`. Every score is a
whole number: time kinds in milliseconds of run time, accuracy in whole percent. No `score` means
points, higher first, best run, every run counts. It comes from the authoring manifest's `score` block
(`authoring/SPEC.md` 2.13); the server sorts and checks boards by it, and the app shows `format`.

**Runtime.** `bubble-kit-microgame.js` adapts the engine to the runtime, so the frame (intro, HUD, pop,
result, share, posters, demos, replays, haptics, mute) works as for any formula:

- The engine steps once per runtime tick (1000/60 ms), so replays and bot runs are deterministic. The
  engine is seeded from the run's RNG.
- Its frames draw in one `space` layer, scaled to fit the 360×640 playfield. Audio goes through the
  runtime's master gain (`fx.audio()`, new), so mute applies. Haptics and toasts go through `fx`.
- Taps, drags and holds are forwarded; a quick flick is also sent as a swipe. The runtime has no
  keyboard, so microgames must be playable by touch.
- **Typed answers** (`typed_answer` + `keyboard`, `fuzzy_match`; `authoring/SPEC.md` 2.12) are
  matched by engine functions the fragments carry, generated from `authoring/expander/fuzzy.mjs`:
  case, accents, punctuation, articles, word order, plurals and length-aware typos are forgiven,
  aliases come from the answer bank (`answer=alias`). Nothing runs outside the engine, so live play,
  bots and replays score the same answer the same way. Typing is through the on-screen keyboard
  fragment for now (letters and space); the engine's native text field (`{"text": "submit"}`) isn't
  wired into this kit yet.
- The formula's bot taps the game's real targets (`mg_hit_targets`) and flicks. It drives posters,
  demos and smoke runs. It's generic, so the runtime tests skip the skill checks for microgame seeds;
  game quality is gated by `authoring/playtest` and the engine's replay tests.
- **Verifiable scores** (for challenges and leaderboards). When a run is won or lost, the kit puts the
  engine's input log in `state.microgame.log`: `microgame-log/1` JSON text with the seed, the game's
  hash, every input and the final `{state_hash, phase, score, time_ms}`. Submit it with the score.
  `MicrogameEngine.verify(content.game_json, log)` replays it and returns `{ok, game_hash_ok, steps,
  recomputed, claimed, problems}`. It runs anywhere the engine bundle loads: the app, a friend's
  phone, or the server's Node generator. An edited score, a removed input or another game file fails.
  `tools/runtime-tests/microgame-verify.js` plays every microgame seed through the real runtime
  and checks that honest logs verify and raised scores don't.

**Engine bundle.** `bubble-kit-microgame-engine.js` is **generated and committed** (the Mac that builds
the app needn't have Rust): `engine/web/microgame.js` and `engine/web/render.js` plus the WASM as base64,
compiled synchronously on first use (`fetch` of `file://` WASM isn't reliable under `loadFileURL`). It
adds about 1.5 MB to the bundle and 8–15 ms on the first microgame. Rebuild after any engine change:

```sh
(cd engine && ./build-wasm.sh && node tools/make-app-bundle.mjs)   # --check verifies it's current
node authoring/tools/make-seeds.mjs                           # the mg-* seeds; --check too
```

A bare `JSContext` on iOS has no WebAssembly, so headless validation there reports
`microgame_unavailable`; microgame validation and playtests run in a web view (Studio, 7.12).

**Tests.** `tools/runtime-tests/run-node.js` and `run-jsc.sh` validate, play and replay the formula's
example and the `mg-*` seeds. `node tools/runtime-tests/microgame-chrome.mjs` plays seeds in the real
`bubble-host.html` in headless Chrome with touch input and checks the bridge messages.

**FB_OPEN.** `play:mg-gust-glider`, `bubble:mg-prism-breaker` (any `mg-*` seed id).

### 7.12 Making microgames in Studio

> **Live data (Stage 3).** The app no longer runs this pipeline: `MicrogameComposer.swift`,
> `MicrogamePrompts.swift`, `MuseClient.swift`, the on-device revise path and the offline and
> scripted services are deleted. New games are made on the server (the **Server path** below); the
> pieces described here run there and in the CLI. `MicrogameStudio` stays in the app to load and
> check engine games. The CLI (`tools/bubble-studio`) still lists the deleted files and needs its
> own copy before it builds again.

Muse writes an **authoring manifest** (`authoring/SPEC.md` 2); Studio expands it into a `game.json`,
validates it in the engine, sends errors back to Muse, playtests it with the bots and wraps it as a
`formula: "microgame"` Bubble (7.11). Everything runs in **one hidden `WKWebView`** (a bare `JSContext`
on iOS has no WebAssembly), created lazily and never on screen. Headless pieces only; the Studio
screens call them.

**Interface** (`Bubbles/Studio/MicrogameStudio.swift`, `MicrogameComposer.swift`, `MicrogamePrompts.swift`):

```swift
@MainActor final class MicrogameStudio {             // the page: microgame-studio.html
    static let shared: MicrogameStudio
    func warmUp() async
    func catalog() async throws -> MicrogameCatalog    // fragments, looks, engine catalog, format rules,
                                                       // examples, ready-made prompt text
    func expand(_ authoring: JSONValue) async throws -> MicrogameExpansion
    func expand(text: String) async throws -> MicrogameExpansion   // model output: keeps its key order
    func gate(_ e: MicrogameExpansion, seed: Int) async throws -> StudioPlaytest.Report
    func wrap(_ e: MicrogameExpansion, id: String, brief: BubbleBrief?, emoji: String?) async throws -> BubbleManifest
    func examples(for request: String, count: Int = 2) async throws -> (ids: [String], text: String)
    func prompt(_ name: String, _ args: [String: JSONValue]) async throws -> String   // prompts.mjs
    func quality(_ e: MicrogameExpansion, request: String) async throws -> MicrogameQuality  // quality.mjs
}
@MainActor final class MicrogameComposer {
    init(muse: any MicrogameMuse = MuseClient.studio, studio: MicrogameStudio = .shared, maxRepairRounds: Int = 3)
    func compose(request: String, brief: BubbleBrief, onEvent: @MainActor (Event) -> Void) async throws -> BubbleManifest
    func revise(_ bubble: BubbleManifest, request: String, onEvent: @MainActor (Event) -> Void) async throws -> BubbleManifest
    // Event: drafting(attempt:), expanding, repairing(round:issues:), playtesting(bots:),
    //        playtested(Report), done(BubbleManifest), failed(String)
}
protocol MicrogameMuse { func chatJSON(model:system:user:options:) async throws -> (value: JSONValue, reply: MuseClient.ChatReply) }
```

`MicrogameDiagnostic` has `severity`, `code`, `at` (a JSON Pointer into the manifest), `message`, `hint` and
`audience`: `.model` (Muse fixes it) or `.library` (a fragment or look bug: logged in
`MicrogameComposer.libraryIssues`, and Muse only hears that the fragment can't take those params). Errors
are `MicrogameStudioError` (page missing, load failed, engine unavailable, JavaScript, timed out). A call
that times out throws the page away; the next call loads a fresh one.

**Flow.** `compose`: the system prompt (`MicrogamePrompts.system`, text from
`authoring/expander/prompts.mjs`) is built from the catalog at run time: every fragment's `describe`,
params, requires, provides and slots, the looks, the engine catalog, the format rules (SPEC.md 1.1–1.4
and 2) and the two closest gold games. Muse starts its reply with a `design` block (pitch, theme items,
verb, twist, a three-step arc, lose and win, juice, look, voice); the expander ignores it, and it stays in
`content.authoring_json` for later changes. Muse's reply text goes to
`expand(text:)`. Model errors go back with their pointers, for up to `maxRepairRounds`. Then the gate
(the five `StudioPlaytest` bots, the same flags; runs capped at 180 s as in `authoring/playtest`); blocking
flags get one more repair. If neither version passes, the one with fewer blocking flags ships, and the
`playtested` event carries its report. `wrap` stores the game as text in `content.game_json` and the
authoring manifest, with fragment versions pinned, as text in `content.authoring_json`, and sets `studio`
(models, time). `revise` starts from `content.authoring_json` (the text, so Muse sees the real key order)
and keeps the Bubble's id, brief and lineage, with `version + 1`.
`lastStats` says whether the first draft validated, how many repair rounds it took, the quality score and
whether it was polished.

**Score check.** After the gate (and polish), a game with a `score` block goes through
`authoring/playtest/score-check.mjs` (`MicrogameStudio.scoreCheck(gameJSON, scoreJSON, optionsJSON)`,
on the runs the last gate played): skill order in the score's direction, an idle bot and a one-input
spam bot ranking no better than real play, the finish rule, `max_rate_per_s`, every bot run replaying to
the same phase, time and score (the engine's `verify` where it has it) and the score changing only on its
`events`. It records `bounds`. Each check is pass, warn or fail; `{ok, ambiguous, checks, bounds, lines}`.
The pipeline (`authoring/expander/score-step.mjs`) runs it by default for every game with a `score` block
(`score_check: false` in compose's args opts out). When the code checks pass or are unsure, Muse reviews
the goal, constraints, end and score parts with the bot runs (`prompt('score_review')`, asked for with
`ask(system, user, 'score review', {model: 'muse-wonder-1.0', effort: 'high', max_tokens})`;
`score_review: false` opts out). A failure gets one score-only repair (`prompt('repair_part')`: the part,
its problems and the parts it depends on), then the checks and the review again. Still failing, the game
ships with `score.ranked: false` (an unranked board). The game itself never changes in this step. Events:
`score_checking` ("Checking the score is fair…"), `score_reviewing`, `score_repairing`, `score_checked`.
compose's result adds `score` (ranked, repaired, reason, checks, review, bounds), and `stats.calls` logs
every Muse call's purpose, wall time and `usage` when `ask` returns it.

**Quality and polish.** A new game that passes the bots then goes through the quality check
(`authoring/expander/quality.mjs`, no model): no palette, backdrop or sound, fragment roles or the game's
own pieces drawn as fallback shapes, placeholder text, the request's theme words missing from what
players read, no ramp in an action game, thin content, no writing of its own, a generic title. Each
issue is major (−15) or minor (−5) from 100; the 16 gold games score 100. Any major issue, or a score
under 85, sends the lines back to Muse for one polish round (prompts.mjs `polish`: keep how it plays,
fix the art, sound, words and feedback). The polished version ships only if it validates, scores higher
and passes the bots. In the app it shows as one more fix round.

**One source for the app and the server.** The prompts, the quality check and the whole loop live in
the Studio bundle, so the server's generator and the app send Muse the same text:
`MicrogameStudio.prompt(name, argsJSON)` (`system`, `compose`, `revise`, `repair`, `playtest_repair`,
`polish`, `issues`), `MicrogameStudio.quality(manifestJSON, request)` → `{score, major, issues, lines}`,
and `MicrogameStudio.compose(argsJSON, ask, onEvent)` → a Promise of `{manifest, stats, bots, gate,
quality}` (`authoring/expander/pipeline.mjs`), where `ask(system, user, purpose)` returns Muse's reply
text (or `{content, model}`), `onEvent` gets `{kind, summary, …}` (the kinds above plus `polishing`),
and `argsJSON` is `{request, brief, base?}` (a `base` microgame manifest makes it a revision). A request
that carries Studio's agreed anatomy (7.13) gets it as its own prompt section, with every rule's check
as a hard constraint.
`argsJSON` may also carry the harness `context` (docs/HARNESS_V2.md, "The context the generator receives";
`MicrogameStudio.version` 3): with tools or types, the system prompt's fragment menu holds only the planned
tools, plus the matched types and the planned spec; gold examples come from `context.gold_ids` first
(`examples(request, k, ids)`); `gate_profile` goes to `gate(json, seed, {gate_profile})`. Without it, nothing
changes. `prompt('system', {examples, context})` gives the same text.

**Key order.** Swift's `JSONValue` writes objects with sorted keys, and the engine reads key order in
function `params` (positional) and state `init`s (an init reads only earlier state). So games never
cross Swift as objects: the page returns `game_json`, `playtest_game_json` and `authoring_json` text
(`MicrogameExpansion.gameJSON` …), `gate` and `wrap` take that text back, and the Bubble stores text
(7.11). As a second line of defense, `expand` also makes games sort-safe
(`authoring/expander/stable.mjs`: out-of-order params are renamed `p0_…`, `p1_…`; a pure init that would
sort later is inlined).

**The page.** `Studio/web/microgame-studio.html` loads `bubble-kit-microgame-engine.js` (7.11) and
`microgame-studio.js`. Both sit flat in the bundle root next to the page, so `loadFileURL` with read access
to that folder finds them. `microgame-studio.js` is **generated and committed** from `authoring/`: the
expander, `wrap.mjs`, the async gate (`playtest/gate-async.mjs`: bots one after another, yielding to the
page, with `game.fork()` look-ahead instead of replaying the history) and the API
(`expander/studio.mjs`, `window.MicrogameStudio`: `catalog()`, `expand(json)`, `gate(json, seed)` (a
Promise) and `wrap(opts)`, all JSON strings), with the fragment and look library, the engine's
`catalog --json`, the format rules and the examples as data. Rebuild after changing anything in
`authoring/` or the engine:

```sh
node authoring/tools/make-studio-bundle.mjs          # runs the engine's catalog with cargo; --check verifies
node authoring/tools/test-studio-bundle.mjs          # the bundle in a Node vm vs the Node gate; --all for all 20
```

**CLI.** `tools/bubble-studio/build.sh`, then
`bubble-studio --microgame "a cozy game about lanterns" [--fake-muse] [--out FILE.json] [--revise FILE.json]`.
It runs `MicrogameComposer` in a hidden macOS `WKWebView` (WebKit runs the WebAssembly engine) and prints
the events, the title, the validation result and the gate report. It uses real Muse when a key is
configured; `--fake-muse` replies with a manifest with a misspelled param, then
`authoring/games/tide_taps.authoring.json` (or `--fake-good FILE`), which exercises the repair loop.

**Server path.** Studio makes new microgames on the games server (Max's `POST /v1/generate`, which runs
this same composer server-side). `GameGenerator` (`Bubbles/API/GameGenerator.swift`; `GameGeneratorLive`
is the only implementation) polls `GET /v1/generate/{jobId}` every 1–2 s, dedupes events by `seq`, and
fetches the finished game's manifest from `manifestUrl` without re-encoding it. `StudioGenerateBridge`
turns the server's events (`kind` + `summary`) into the same `StudioEvent`s as `StudioMicrogameBridge`,
so Build, Try, Share and "How Muse made it" are unchanged. Optional fields (`data` on events, `position`,
`code`) are used when present; the server puts each step's details (`round`, `passed`, `headline`,
`bots`) on the event itself, and `GenerationEvent.data` falls back to the whole event. Changes to a game
(`{baseGameId, change?, look?, nextLevel?}`, 4.4) use the same job and polling. `request` may be at
most 2,000 characters, so when the agreed anatomy would push a new game's request past that, it goes
in the brief's `notes` instead. The games API client is always the live server (`GamesAPIFactory.current`,
base URL `https://api.ol4ol.com`, `FB_API_URL` overrides it in DEBUG); the app signs in once at launch
with a device account (`GamesAccount`). There is no mock client.

**Gold examples.** Muse's prompt shows the two gold games closest to the request (`authoring/gold/`, 16
hand-made games paired with requests; `expander/gold.mjs` picks them and `MicrogameStudio.examples(for:)`
returns them). Each entry's `themes` (words people type for that kind of game, franchises included) is used
for matching only. Each example is shown as the reply Muse should give: its `design`, then the manifest.
A theme or franchise the person asks for is kept, with its real names; the gold games themselves are
original.
`MicrogameComposer.lastStats.examples` records which were used.

### 7.13 Game anatomy: agreeing how the game works

> **Live data (Stage 4).** The app's Muse call (`GameAnatomyMuse.swift`, `MuseAnatomyPrompts.swift`)
> and the fixtures are deleted. The server asks Muse instead (`POST /v1/anatomy {request, audience?}`
> and `POST /v1/anatomy/revise {anatomy, change, request?, afterPlaying?}`, both answered in the reply
> with the `game-anatomy/0.1` object, about 5 to 10 s; the prompts moved to
> `backend/generator/src/anatomy.mjs`). The app decodes it (`GameAnatomy.decode`) and calibrates it
> with the engine's fragment ids from `MicrogameStudio.catalog()`. Errors show the server's words: 503
> "Muse is not set up on this server yet", 502 "Muse couldn't take this game apart", with Try again
> (or "Make it as written" on Try).

Studio used to take a person's *style* (mood, look, theme) but not their *function*. The game anatomy is
Muse's read of how the game works, part by part, agreed with the person before the build and changed
with them after it. New games only (`StudioModel.usesAnatomy`: create mode).

**Format `game-anatomy/0.1`** (all in `Bubbles/Studio/GameAnatomy.swift`, so it can be swapped for another
plan format):

```
{"anatomy": "game-anatomy/0.1", "title", "genre": "word|puzzle|action|story|party",
 "parts": {"core_loop": {"text"}, "verbs": {"items": [..]}, "pieces": {"items": [{"name","has"}]},
   "state": {"items": [{"name","type"}]}, "rules": [{"n","text","check"}], "end": {"win","lose","score"},
   "structure": {"turns","timing","length_s": [a,b]}, "randomness": {"seed"}, "share": {"grid"}, "theme": {"text"}}}
```

Every part and rule also carries `source` (`you` | `guess`), `familiarity` (`known` | `approximate` |
`unfamiliar`, shown as Known / Approximate / New to Muse), `plan` (`fragment:<id>` | `custom:<what>` |
`gate:<check>` | `engine-gap:<name>`), `question` and `options`. Familiarity is mechanical: **known** maps to a
listed fragment; **approximate** is custom rules from named engine builtins (`custom:grid, neighbors8, count - …`;
the list is `GameAnatomy.promptBuiltins`); **unfamiliar** needs an engine gap or has no builtin plan. The
prompt names the known gaps (`MusePrompts.anatomyEngineGaps`: `share_grid` (microgames share score text only),
`segment_collision`, `joints`, `rotated_shapes`, `device_sensors`, `live_multiplayer`, `3d`), and an
`engine-gap:` plan always reads as unfamiliar.
`GameAnatomy.calibrated(knownFragments:)` enforces it on Muse's reply: an unfamiliar part with a listed
fragment or a builtins-only `custom:` plan becomes approximate, and a "known" part without a fragment becomes
approximate. Muse asks questions only on guessed parts
it doesn't know; vague requests get concrete picks marked as guesses. Decoding is lenient (missing fields
get defaults, unknown familiarity reads as approximate, a `{"anatomy": {...}}` wrapper is accepted).
Revisions add top-level `changed` (`"end"`, `"rules.2"`, ...) and `reply` ("This changes rule 2 and how it
ends."); Studio also diffs the two versions itself when `changed` is missing.

**Muse.** On the server (`GamesAPI.anatomy(request:audience:)` and
`reviseAnatomy(_:change:request:afterPlaying:)`), one JSON turn on the fast model. The server's system
prompt lists the microgame fragments so Muse can judge what it knows; the answers the person gave
travel inside the anatomy (`answer` on each part). There are no fixtures: when the server can't answer,
the card says why.

**In Studio** (`StudioAnatomyThread`, `StudioAnatomyCard`, `StudioAnatomyChat`):
- *Brief step*: "How the game works" drafts alongside the brief. Summary ("Muse understood 13 parts; 2 are
  new to it"), then a card per part and rule with the tags, the plan for anything not known, and Muse's
  questions with quick answers. Tap a part to rewrite it; "Something off? Tell Muse" reruns the anatomy with
  the change; after local edits or answers, "Have Muse check my changes" folds them in.
- *The build*: `GameAnatomy.agreedText(request:)` ("Agreed game anatomy (follow the rules and mechanics
  exactly, not just the look)", with the person's request verbatim and a requested theme kept as said) is
  appended to the microgame request text (`microgameRequestText`, so repair rounds see it too) or, for
  formula games, to the brief's `notes`. `MicrogamePrompts` is unchanged.
- *Try step*: "Change the game" replaces "Tweak it" when there is an anatomy. Each message is first mapped
  onto the anatomy (Muse's reply, the updated parts, anything new to Muse); "Make the change" makes the
  updated anatomy the agreed one and runs the usual tweak (`startCompose(.tweak, text:)`, a change on the
  server, 4.4) with the person's words, what changes and the changed parts' new wording (the game
  already follows the rest). The last 6 turns stay visible.
- *Saved with the game*: on share or save, the agreed anatomy goes into the game's make record on this
  device (`MakeRecord.anatomyJSON` and `anatomyRequest`; the manifest is unchanged). Edit, Remix and the
  next level load it (`StudioModel.loadSavedAnatomy`), so they keep "Change the game", and a remix shows
  and builds with its base's anatomy. Friends' devices don't have it.

**Themes and brands.** A theme, franchise or brand the person asks for ("Star Wars") is honored in names,
art and words; Muse doesn't add ones they didn't ask for. Mechanics stay original to their idea, no specific
existing game's levels or art are copied, and our own seeded content stays original (`MusePrompts.safety`,
the content prompt; covers still carry no text or logos).

DEBUG: the anatomy fixtures and `FB_STUDIO_ANATOMY`/`FB_STUDIO_STEP` were removed in Stage 4;
`FB_STUDIO_SCROLL=anatomy|anatomy-rules|anatomy-<part>` (Brief) or `chat` (Try).

### 7.14 Get-to-know brackets (bracket)

Meeting someone new should come with something to do together. When you become friends (you
confirm, or they accept: `AppStore` posts `Notification.Name.friendshipStarted`), or you tap Add
friend next to a stranger on a Group's weekly board or a game's board, the app proposes a **best of
three** with that person: round 1 **Quick hands** (dodge, timing, microgame, merge), round 2 **Words
and trivia** (guess, quiz night, answer, learn), round 3 **Get to know you** (answer, adventure,
sort). Each round is a different game on a seed shared by the two of you (and the game's length), so
it's the same course. The card (`BracketCardView`) shows both faces, the standing ("You 1 – 0
Maya"), each round's game and both scores, and the winner; each round's Play opens the player on the
round's seed. It sits at the top of their profile (`BubbleProfileHeaderSlots`), which also offers
"Get to know Maya: 3 quick games" when there is none. Each round you finish posts a line to your 1:1
chat ("Our bracket, round 1 (Hill Hopper): me 42 · you 39"); the final result goes to the chat and,
for a bracket that started on a Group board, to the Group as a playable share card.

**Files** (`Features/Bubbles/Bracket/`): `FriendBracket.swift` (model, `BracketService` protocol,
`BracketPlanner`), `LocalBracketService.swift` (today's implementation, in memory for the launch),
`BracketLocalOpponent.swift` (**local stand-in**: the other person's rounds are bot runs of the real
runtime on the same seed, through `BubbleStore.runtimeWorker`, marked `theirsIsLocalStandIn`),
`BracketCardView.swift`, `BracketHooks.swift` (install, `didFinish`, `met`). Shared edits: one line
each in `BubbleFeatureRouter` (install, didFinish), `BubbleFeatureSlots` (profile header),
`AppStore` (the friendship notification), `GroupWeeklyBoardActions.addFriend` and `BubbleBoardView`.
DEBUG: `FB_BRACKET=<userID>[:played]`.

**One offer per Add friend.** A server friendship (Find friends, the Group Blend's Add friend) posts
`gamesFriendAdded`, and that tap gets the Challenges best-of-5 offer (`BestOfFiveOfferSheet`) and
nothing from brackets. Brackets never pop up there: they live as the "Getting to know" card on the
person's profile, start from its button, start quietly from Add friend on a game or Group weekly
board (which use the local friend request and get no best-of-5 offer), and announce themselves with a
toast only for friendships made through the local friend requests (`friendshipStarted`). When the
server serves same-seed series, the bracket's rounds can become that series and the two merge.

**Server endpoints the backend would need** (so `LocalBracketService` and `BracketLocalOpponent`
can be swapped for a `GamesAPI`-backed service with no screen changes). Picking games, seeds and
winners moves to the server; runs are verified like any score (seed plus replay).

| Call | Body | Returns |
|---|---|---|
| `POST /v1/brackets` | `{opponent_id, origin: {kind: "new_friend" \| "group" \| "event", id?}}` | the bracket (an open one with that person if it exists) |
| `GET /v1/brackets?with=<user_id>` | — | `{brackets: [bracket]}`, newest first |
| `GET /v1/brackets/<id>` | — | the bracket |
| `POST /v1/brackets/<id>/rounds/<index>/runs` | `{score, replay}` (the `BubbleInputLog`; its seed must be the round's) | the bracket, with your best score on that round |

A bracket: `{id, created_at, origin, players: [user_id, user_id], rounds: [{index, theme: "reflex" |
"words" | "about_you", game_id, seed, length, scores: {<user_id>: {score, replay_id, verified}}}],
standing: {<user_id>: wins}, winner_id: string | null, finished: bool}`. Best of three: finished at
two wins or when all three rounds have both scores. Events the app should hear (push or the
notifications feed): `bracket.proposed` (a new friend; the app shows the card), `bracket.round_played`
(the other person's score landed), `bracket.finished`. Posting the round lines to the chat and the
final card to the Group can stay in the app (it already sends messages and Group posts) or move to the
server with these events.
