/*
 * bubble-kit-microgame.js: the microgame formula (docs/BUBBLES.md, "microgame").
 *
 * A microgame Bubble carries a complete `microgame/0.1` or `0.2` game (the format of
 * engine/SPEC-v0.2.md, usually expanded from an authoring manifest by authoring/), preferably as
 * the JSON *text* `content.game_json`. Object key order is part of a game's meaning (function
 * params are positional; a state init may read earlier state), and Swift's JSONValue re-encodes
 * objects with sorted keys, so only the text form reaches the engine byte for byte as it was
 * validated. `content.game` (an object) is accepted for hand-made games whose order is safe. The
 * Rust/WASM engine in bubble-kit-microgame-engine.js runs it; this kit only adapts it to the
 * Bubble runtime, so the shared frame (intro card, HUD, pop, result, share, replays, posters,
 * haptics, mute) works the same as for every other formula.
 *
 *   space.microgame   owns the engine session: steps it once per runtime tick (fixed 60 Hz, so
 *                     replays and bot runs are deterministic), draws its frames, plays its audio
 *                     through the runtime's master gain, and forwards haptics and toasts.
 *   input.microgame   forwards pointer down/move/up to the engine and turns quick flicks into
 *                     swipes (the runtime has no keyboard; games should not rely on keys).
 *   score.microgame   mirrors the engine's score and ends the run when the engine says won or lost.
 *
 * State: state.microgame = {phase, score, time_ms} (read-only for bots and HUDs).
 * Headless hosts without WebAssembly (an iOS JSContext) can't run microgames: validation reports
 * `microgame_unavailable`, and Studio validates microgames in a web view instead.
 */
(function () {
  "use strict";
  const B = typeof Bubble !== "undefined" ? Bubble : null;
  if (!B) return;
  const W = B.W, H = B.H;
  const STEP_MS = 1000 / 60;
  const SWIPE_MIN = 28;      // playfield units
  const SWIPE_MAX_TICKS = 30;
  const MAX_LIVE_GAMES = 48; // engine handles kept alive at once (runs are cheap to recreate)

  const lib = () => (typeof MicrogameEngine !== "undefined" ? MicrogameEngine : null);
  const hasDOM = typeof document !== "undefined" && typeof Image !== "undefined";

  // ---- engine sessions -------------------------------------------------------------------

  // One session per run, keyed by the run's state object (sdk.state is per run and shared with
  // the bot's sdk). Engine handles are freed when their run is collected, and the oldest are
  // freed when too many are alive (runs from evicted Bubbles).
  const sessions = new WeakMap();
  const live = [];
  const finalizer = typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry((game) => { dispose(game); })
    : null;
  const jsonCache = new WeakMap();

  function dispose(game) {
    const i = live.indexOf(game);
    if (i >= 0) live.splice(i, 1);
    try { game.dispose(); } catch (e) { /* already gone */ }
  }

  function gameJSON(content) {
    let s = jsonCache.get(content);
    if (!s) {
      s = typeof content.game_json === "string" ? content.game_json : JSON.stringify(content.game);
      jsonCache.set(content, s);
    }
    return s;
  }

  function engineOrNull() {
    const L = lib();
    return L ? L.getEngine() : null;
  }

  function openSession(sdk) {
    const L = lib(), engine = engineOrNull();
    if (!engine) return null;
    // Seed from the run's RNG: replays and challenges reuse the run seed, so they get the same game.
    const seed = Math.floor(sdk.rng() * 2147483647);
    const game = engine.load(gameJSON(sdk.content), seed);
    live.push(game);
    while (live.length > MAX_LIVE_GAMES) dispose(live[0]);
    const meta = game.meta;
    const cw = meta.canvas.w, ch = meta.canvas.h;
    const s = Math.min(W / cw, H / ch);
    const sess = {
      game,
      cw, ch,
      s, ox: (W - cw * s) / 2, oy: (H - ch * s) / 2,
      assets: hasDOM && meta.assets > 0 ? new L.AssetStore(game.assets(), { audioCtx: () => audioOut(sdk)?.ctx || null }) : null,
      music: hasDOM ? new L.MusicPlayer() : null,
      musicTimer: null,
      down: null,
      status: game.status(),
    };
    sessions.set(sdk.state, sess);
    if (finalizer) finalizer.register(sdk.state, game);
    return sess;
  }

  function audioOut(sdk) {
    return sdk.fx && typeof sdk.fx.audio === "function" ? sdk.fx.audio() : null;
  }

  // Playfield (360x640) <-> engine canvas coordinates.
  function toGame(sess, x, y) { return [(x - sess.ox) / sess.s, (y - sess.oy) / sess.s]; }
  function toField(sess, x, y) { return [sess.ox + x * sess.s, sess.oy + y * sess.s]; }

  // ---- concepts --------------------------------------------------------------------------

  B.defineConcept({
    id: "space.microgame",
    kind: "space",
    formulas: ["microgame"],
    describe: "Runs content.game (a complete microgame engine game) in the Rust/WASM engine and draws it full screen. Use only with the microgame formula.",
    examples: ["any game Muse expanded from an authoring manifest"],
    params: {
      runtime_hud: { type: "boolean", default: false, describe: "Show the runtime's score HUD too (most microgames draw their own score)" },
    },
    consumes: ["clock.tick"],
    emits: ["microgame.status"],
    order: 0,
    setup(sdk, p) {
      sdk.hud.score = !!p.runtime_hud;
      let sess;
      try {
        sess = openSession(sdk);
      } catch (e) {
        sdk.log("could not load the game: " + (e && e.message ? e.message : e));
      }
      if (!sess) {
        sdk.state.microgame = { phase: "lost", score: 0, time_ms: 0, error: (lib() && lib().engineError()) || "engine unavailable" };
        sdk.end("fail", { delay: 0 });
        return;
      }
      sdk.state.microgame = { phase: sess.status.phase, score: sess.status.score || 0, time_ms: 0 };

      sdk.on("clock.tick", () => {
        if (sdk.ended) return;
        const g = sess.game;
        g.step(STEP_MS);
        const st = g.status();
        sess.status = st;
        const m = sdk.state.microgame;
        m.phase = st.phase;
        m.time_ms = st.time_ms;
        if (st.score != null && st.score !== m.score) m.score = st.score;
        sdk.emit("microgame.status", m);
      });

      sdk.layer(sdk.Z.space, (gfx) => {
        const L = lib();
        if (!L) return;
        const f = sess.game.frame();
        L.drawFrame(gfx.ctx, f, sess.assets, { clear: false, k: sess.s, ox: sess.ox, oy: sess.oy });
        // Side effects queued since the last drawn frame. Drawing is presentation-only, so none of
        // this touches game state (bot, poster and replay runs stay deterministic).
        const out = audioOut(sdk);
        if (out) for (const s of f.audio) L.playSound(out, s, sess.assets);
        for (const h of f.haptics) sdk.fx.haptic(h);
        for (const t of f.toasts) {
          if (t.text) sdk.fx.float(t.text, W / 2, H * 0.28);
        }
        if (sess.music) {
          sess.music.sync(out, f.music, sess.assets);
          // Stop the music if this run stops being drawn (scrolled away, paused, evicted).
          if (sess.musicTimer) clearTimeout(sess.musicTimer);
          if (sess.music.cur) sess.musicTimer = setTimeout(() => sess.music.stop(), 350);
        }
      });
    },
  });

  B.defineConcept({
    id: "input.microgame",
    kind: "input",
    formulas: ["microgame"],
    describe: "Sends taps, drags and swipes to the microgame engine. Taps and drags hit the game's on_tap / on_drag / on_press nodes; a quick flick is also sent as a swipe.",
    examples: ["tap a tile", "drag the paddle", "flick to slide the board"],
    params: {
      swipes: { type: "boolean", default: true, describe: "Turn quick flicks into engine swipes" },
    },
    consumes: ["pointer.down", "pointer.move", "pointer.up"],
    emits: [],
    order: 1,
    setup(sdk, p) {
      const sess = () => sessions.get(sdk.state);
      sdk.on("pointer.down", (e) => {
        const s = sess();
        if (!s || sdk.ended) return;
        const [x, y] = toGame(s, e.x, e.y);
        // Hit-test against the layout at this tick, not whatever frame was last drawn: live play,
        // headless bots and replays then see the same targets.
        s.game.hitTargets();
        s.game.pointer("down", x, y);
        s.down = { x, y, tick: sdk.tick };
      });
      sdk.on("pointer.move", (e) => {
        const s = sess();
        if (!s || sdk.ended || !s.down) return;
        const [x, y] = toGame(s, e.x, e.y);
        s.game.pointer("move", x, y);
      });
      sdk.on("pointer.up", (e) => {
        const s = sess();
        if (!s || sdk.ended) return;
        const [x, y] = toGame(s, e.x, e.y);
        s.game.pointer("up", x, y);
        const d = s.down;
        s.down = null;
        if (!p.swipes || !d || sdk.tick - d.tick > SWIPE_MAX_TICKS) return;
        const dx = (x - d.x) * s.s, dy = (y - d.y) * s.s;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
        if (Math.abs(dx) > Math.abs(dy)) s.game.swipe(dx > 0 ? "right" : "left");
        else s.game.swipe(dy > 0 ? "down" : "up");
      });
    },
  });

  B.defineConcept({
    id: "score.microgame",
    kind: "score",
    formulas: ["microgame"],
    describe: "Uses the microgame's own score (objectives.score) and ends the run when the game is won or lost.",
    examples: ["the score the game shows on its end screen"],
    params: {
      label: { type: "string", default: "", max_length: 20, describe: "Unit shown under the score and in the share (\"points\")" },
    },
    consumes: ["microgame.status"],
    emits: [],
    ends: true,
    order: 2,
    setup(sdk, p) {
      if (p.label) sdk.hud.label = p.label;
      let last = null;
      sdk.on("microgame.status", (m) => {
        if (m.score !== last && typeof m.score === "number" && isFinite(m.score)) {
          last = m.score;
          sdk.setScore(Math.round(m.score));
        }
        if (sdk.ended) return;
        if (m.phase === "won") sdk.end("success", { delay: 24 });
        else if (m.phase === "lost") sdk.end("fail", { delay: 24 });
      });
    },
  });

  // ---- bot -------------------------------------------------------------------------------

  // A generic player: taps the game's real tap targets, drags its drag targets, and sometimes
  // flicks. Skill sets how often it acts and how precisely. Good enough for posters, demos and
  // smoke runs; Studio's playtest gate uses the authoring layer's stronger bots.
  function decide(sdk) {
    const s = sessions.get(sdk.state);
    if (!s || sdk.ended) return null;
    const bs = sdk.botState;
    const rng = () => sdk.botRng();
    if (bs.drag) {
      const d = bs.drag;
      d.left--;
      const t = 1 - d.left / d.total;
      const x = d.x0 + (d.x1 - d.x0) * t, y = d.y0 + (d.y1 - d.y0) * t;
      if (d.left <= 0) { bs.drag = null; return [{ a: "up", v: toField(s, x, y) }]; }
      return [{ a: "move", v: toField(s, x, y) }];
    }
    const skill = sdk.botSkill;
    const every = Math.round(36 - 26 * skill);
    if (bs.wait > 0) { bs.wait--; return null; }
    bs.wait = every + Math.floor(rng() * every);
    const targets = s.game.hitTargets();
    const r = rng();
    if (targets.length && r < 0.8) {
      const tg = targets[Math.floor(rng() * targets.length)];
      const jit = (1 - skill) * 0.35;
      const x = tg.x + tg.w * (0.5 + (rng() - 0.5) * jit), y = tg.y + tg.h * (0.5 + (rng() - 0.5) * jit);
      if (tg.drag) {
        const total = 8 + Math.floor(rng() * 16);
        bs.drag = { x0: x, y0: y, x1: x + (rng() - 0.5) * s.cw * 0.6, y1: y + (rng() - 0.5) * s.ch * 0.2, left: total, total };
        return [{ a: "tap", v: toField(s, x, y) }];
      }
      return [{ a: "tap", v: toField(s, x, y) }, { a: "up", v: toField(s, x, y) }];
    }
    // Otherwise a flick in a random direction (games with swipe controls) or a tap anywhere.
    const x = s.cw * (0.2 + rng() * 0.6), y = s.ch * (0.3 + rng() * 0.5);
    if (r < 0.92) {
      const dir = Math.floor(rng() * 4);
      const dx = [60, -60, 0, 0][dir], dy = [0, 0, 60, -60][dir];
      bs.drag = { x0: x, y0: y, x1: x + dx / s.s, y1: y + dy / s.s, left: 4, total: 4 };
      return [{ a: "tap", v: toField(s, x, y) }];
    }
    return [{ a: "tap", v: toField(s, x, y) }, { a: "up", v: toField(s, x, y) }];
  }

  // ---- formula ---------------------------------------------------------------------------

  function validateContent(content) {
    const out = [];
    const bad = (code, message, path, warning) => out.push({ code, message, path: "content" + (path || ""), warning: !!warning });
    const hasText = content && typeof content.game_json === "string" && content.game_json.length > 0;
    const hasObject = content && content.game && typeof content.game === "object";
    if (!content || typeof content !== "object" || (!hasText && !hasObject)) {
      bad("content", "content.game_json must be a microgame engine game as JSON text (or content.game as an object)", ".game_json");
      return out;
    }
    if (hasText) {
      try { JSON.parse(content.game_json); } catch (e) { bad("content", "content.game_json is not valid JSON: " + e.message, ".game_json"); return out; }
    }
    const engine = engineOrNull();
    if (!engine) {
      bad("microgame_unavailable", "this runtime can't run microgames (" + ((lib() && lib().engineError()) || "the engine isn't loaded") + "); validate it in a web view", hasText ? ".game_json" : ".game");
      return out;
    }
    let diags;
    try {
      diags = engine.validate(gameJSON(content));
    } catch (e) {
      bad("microgame", "the engine crashed validating the game: " + (e && e.message ? e.message : e), hasText ? ".game_json" : ".game");
      return out;
    }
    for (const d of diags) {
      bad(d.code, d.message + (d.hint ? " (" + d.hint + ")" : ""), (hasText ? ".game_json" : ".game") + (d.at || ""), d.severity === "warning");
    }
    return out;
  }

  function share(sdk) {
    const m = sdk.state.microgame || {};
    const secs = Math.round((m.time_ms || 0) / 1000);
    return {
      headline: sdk.manifest.title,
      score_text: sdk.score + " points" + (secs ? " · " + secs + " s" : ""),
    };
  }

  // A small complete game, so the formula has an example that validates and plays everywhere.
  const EXAMPLE_GAME = {
    format: "microgame/0.2",
    meta: { title: "Glow Taps", instructions: "Tap the glowing tile before it moves. 12 taps wins.", duration_s: 30 },
    state: {
      lit: { type: "ivec2", init: "vec(random_int(0, 3), random_int(0, 3))" },
      hits: { type: "int", init: "0" },
    },
    inputs: { tap_cell: { payload: { cell: "ivec2" } } },
    events: { moved: {} },
    rules: [
      { id: "hit", on: "tap_cell", when: "event.cell == lit", do: [
        { incr: "hits" },
        { set: "lit", to: "pick(filter(coords(4, 4), c => c != lit))" },
        { emit: "moved" },
      ] },
      { id: "wander", on: { every: "1400ms" }, do: [{ set: "lit", to: "pick(filter(coords(4, 4), c => c != lit))" }] },
    ],
    objectives: { win: "hits >= 12", score: "hits * 10", time_limit: "30s", on_timeout: "lose" },
    presentation: {
      canvas: { w: 360, h: 640, background: "$bg" },
      tokens: { bg: "#14123A", tile: "#2A2766", glow: "#8EC5FF", ink: "#EDEBFF" },
      root: {
        node: "stack", dir: "column", gap: 28, align: "center", x: 180, y: 320, anchor: "center",
        children: [
          { node: "text", text: "= str(hits) + ' / 12'", size: 30, weight: 700, color: "$ink" },
          { node: "grid", cols: 4, rows: 4, cell_size: 70, gap: 10, cell: {
            node: "rect", w: 70, h: 70, radius: 14,
            fill: "= if cell == lit then $glow else $tile",
            transition: { fill: { ms: 120, ease: "out" } },
            on_tap: { input: "tap_cell", with: { cell: "cell" } },
          } },
        ],
      },
      feedback: [
        { on: "moved", do: [{ sound: { wave: "triangle", note: "= 520 + hits * 30", ms: 70 } }, { haptic: "light" }] },
        { on: "win", do: [{ sound: { wave: "triangle", notes: ["C5", "E5", "G5", "C6"], step_ms: 80 } }] },
      ],
    },
  };

  B.defineFormula({
    id: "microgame",
    title: "Microgame",
    describe: "Any game the microgame engine can run: arcade, physics, puzzles, typing-free word games, stories. The whole game lives in content.game_json (rules, state, presentation, assets), usually expanded from an authoring manifest. Use the three microgame concepts and nothing else.",
    core: ["space.microgame", "input.microgame", "score.microgame"],
    optional: [],
    content: {
      describe: "game_json: a complete microgame/0.1 or 0.2 game (engine/SPEC-v0.2.md) as JSON text, so its key order survives (game: the same as an object, for hand-made games). authoring_json: the authoring manifest it was expanded from, as text (optional, for remixing).",
      schema: {
        type: "object",
        properties: {
          game_json: { type: "string" },
          game: { type: "object" },
          authoring_json: { type: "string" },
          authoring: { type: "object" },
        },
      },
    },
    validateContent,
    bot: { describe: "Taps the game's real tap targets, drags its drag targets and sometimes flicks; skill sets pace and precision.", decide },
    share,
    poster_ticks: 120,
    tips: [
      "Write the game with the authoring layer (fragments + params), then expand it; don't hand-write content.game_json.",
      "Games should be playable by touch only: taps, drags and swipes. The runtime has no keyboard.",
    ],
    example: {
      id: "example-microgame-glow-taps", version: 1, engine_version: 1,
      title: "Glow Taps",
      one_line_rule: "Tap the glowing tile before it moves.",
      formula: "microgame",
      brief: { intent: "a quick reaction game", audience: "everyone", mood: ["playful"], energy: "high", competition: "friendly" },
      structure: { cadence: "endless", scope: "everyone", setter: "ai" },
      lineage: { parent: null, operators: [], remix_of: null },
      chain: null,
      style: { look: "glow", palette: "lilac-haze", font: "rounded", motif: "sparkles", emoji: "✨", mood_preset: "playful" },
      concepts: [
        { use: "space.microgame" },
        { use: "input.microgame" },
        { use: "score.microgame", params: { label: "points" } },
      ],
      glue: {},
      content: { game_json: JSON.stringify(EXAMPLE_GAME) },
      seed: 4242,
    },
  });
})();
