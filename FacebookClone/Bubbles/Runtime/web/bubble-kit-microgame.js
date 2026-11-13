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
 *                     swipes (the runtime has no key events; games should not rely on keys). Games
 *                     with a text input (`{"text": "submit" | "change"}`, game.meta.text_input) get
 *                     a native text field at presentation.text_field (sdk.textField); typed text
 *                     reaches the engine through "text.input", so it is in the run's replay log.
 *   score.microgame   mirrors the engine's score and ends the run when the engine says won or lost.
 *
 * State: state.microgame = {phase, score, time_ms} (read-only for bots and HUDs), plus `log` (the
 * run's microgame-log/1 JSON text) once the run is won or lost, for challenges and leaderboards to
 * submit; MicrogameEngine.verify(game_json, log) replays it and recomputes the score. The engine
 * logs text calls itself, so typed answers verify like taps.
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
  // Tall canvases (taller than the 9:16 playfield; the standard is 360 x 780 = 19.5:9) keep their
  // key content between these bands, as fractions of the canvas height (110 and 96 on 780). The
  // bands run under the player's top and bottom bars on a phone (docs/BUBBLES.md 4.6, "Filling the
  // screen"; authoring/SPEC.md, canvas).
  const SAFE_TOP = 110 / 780, SAFE_BOTTOM = 96 / 780;

  const lib = () => (typeof MicrogameEngine !== "undefined" ? MicrogameEngine : null);
  const hasDOM = typeof document !== "undefined" && typeof Image !== "undefined";

  // ---- game fonts --------------------------------------------------------------------------

  // Each game names its own fonts (a pairing from authoring/kit/vibes.mjs). The faces are declared
  // in game-fonts.css; a face only loads when first used, which would draw a game's first frames in
  // the fallback font. So every face starts loading when the host page loads (the files are in the
  // app bundle, about 1 MB), and a game whose fonts aren't in yet draws its first frames without
  // text for up to FONT_WAIT_MS. Drawing only: the engine steps the same either way.
  const FONT_WAIT_MS = 1200;
  const fontsDone = (function preloadFonts() {
    if (!hasDOM || !document.fonts || typeof document.fonts.forEach !== "function") return null;
    const faces = [];
    try { document.fonts.forEach((f) => faces.push(f)); } catch (e) { return null; }
    let done = false;
    Promise.all(faces.map((f) => f.load().catch(() => null))).then(() => { done = true; });
    return () => done;
  })();
  function gameFonts(json) {
    const out = new Set();
    const re = /"font"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(json))) if (m[1] !== "system") out.add(m[1]);
    return [...out];
  }
  function fontsReady(sess) {
    if (sess.fontsOk || !fontsDone) return true;
    if (fontsDone() || Date.now() - sess.fontsSince > FONT_WAIT_MS) { sess.fontsOk = true; return true; }
    try { sess.fontsOk = sess.fonts.every((f) => document.fonts.check(`16px "${f}"`)); } catch (e) { sess.fontsOk = true; }
    return sess.fontsOk;
  }

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
    // A canvas taller than the playfield keeps its full width and runs past the playfield's top
    // and bottom (sdk.fitBox shows all of it); others fit inside, as before. Fixed per game, so
    // pointer coordinates and replays don't depend on the device.
    const tall = ch * W > cw * H * 1.02;
    const s = tall ? W / cw : Math.min(W / cw, H / ch);
    const sess = {
      game,
      cw, ch, tall,
      s, ox: (W - cw * s) / 2, oy: (H - ch * s) / 2,
      assets: hasDOM && meta.assets > 0 ? new L.AssetStore(game.assets(), { audioCtx: () => audioContext(sdk) }) : null,
      music: hasDOM ? new L.MusicPlayer() : null,
      musicTimer: null,
      down: null,
      status: game.status(),
      fonts: hasDOM ? gameFonts(gameJSON(sdk.content)) : [],
      fontsSince: Date.now(),
      fontsOk: !hasDOM,
      clockMs: 0,        // drawing clock (runtime ticks), for toasts and shake
      lastInput: null,   // clockMs of the player's last pointer down
      shake: { prev: 0, start: null, amp: 0 },
      toast: null,
    };
    sessions.set(sdk.state, sess);
    if (finalizer) finalizer.register(sdk.state, game);
    return sess;
  }

  // game.meta.text_input ({placeholder, max_len, x, y, w, h, size} in canvas units, x null for the
  // default bar at the bottom) as an sdk.textField spec in playfield units. Same defaults as the
  // engine's shell (engine/web/shell.js placeTextField).
  function textFieldSpec(sess, ti) {
    const r = ti.x == null ? { x: 12, y: sess.ch - 60, w: sess.cw - 24, h: 48 } : { x: ti.x, y: ti.y, w: ti.w, h: ti.h };
    const size = ti.size != null ? ti.size : Math.max(12, Math.min(22, r.h * 0.45));
    const [x, y] = toField(sess, r.x, r.y);
    return { x, y, w: r.w * sess.s, h: r.h * sess.s, size: size * sess.s, placeholder: ti.placeholder || "Type here", max_len: ti.max_len || 32 };
  }

  function audioOut(sdk) {
    return sdk.fx && typeof sdk.fx.audio === "function" ? sdk.fx.audio() : null;
  }

  // ---- bleed ----------------------------------------------------------------------------

  // The game's own background past its canvas, out to the screen's edges, so no band shows the
  // look's plain color instead (docs/BUBBLES.md 4.6, "Filling the screen"): the canvas
  // background color, then the backdrop (an image op covering the canvas, among the first few
  // ops) mirrored across each edge so it continues without a seam. Left and right (a narrow strip
  // at most) are mirrored as they are, dimmed a hair. Above and below, where a 9:16 game leaves
  // the room under the player's bars, the mirror is softened (so text or faces in the backdrop
  // don't show up upside down) and shaded toward the screen's edge, like a scrim under the bars.
  // Drawing only: nothing here touches game state.
  const BLEED_SIDE_DIM = 0.06;
  const BLEED_EDGE_DIM = 0.12, BLEED_FAR_DIM = 0.42;
  const BLEED_SOFT_DOWN = 12; // the softened copy is drawn this many times smaller, then scaled up

  function backdropOp(sess, f) {
    const n = Math.min(4, f.ops.length);
    for (let i = 0; i < n; i++) {
      const op = f.ops[i];
      if (op.op !== "image" || op.rotation || op.scale !== 1 || !(op.opacity >= 0.99)) continue;
      if (op.x <= 2 && op.y <= 2 && op.x + op.w >= sess.cw - 2 && op.y + op.h >= sess.ch - 2) return op;
    }
    return null;
  }

  // A soft (blurred) copy of one backdrop frame, made once and cached on the session: drawn small
  // and scaled back up with smoothing, which blurs on every WebKit (no canvas filter needed).
  function softBackdrop(sess, a, sx, sy, sw, sh) {
    const key = sx + "," + sy + "," + sw + "," + sh;
    const c = sess.bleedSoft;
    if (c && c.img === a.img && c.key === key) return c.canvas;
    let out = null;
    try {
      const w = Math.max(2, Math.round(sw / BLEED_SOFT_DOWN)), h = Math.max(2, Math.round(sh / BLEED_SOFT_DOWN));
      const small = document.createElement("canvas");
      small.width = w; small.height = h;
      const sc = small.getContext("2d");
      sc.imageSmoothingEnabled = true;
      sc.drawImage(a.img, sx, sy, sw, sh, 0, 0, w, h);
      out = document.createElement("canvas");
      out.width = w * 4; out.height = h * 4;
      const oc = out.getContext("2d");
      oc.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in oc) oc.imageSmoothingQuality = "high";
      oc.drawImage(small, 0, 0, w * 4, h * 4);
    } catch (e) { out = null; }
    sess.bleedSoft = { img: a.img, key, canvas: out };
    return out;
  }

  function paintBleed(gfx, sess, f, L) {
    const v = gfx.view;
    if (!v) return;
    const k = sess.s, cx0 = sess.ox, cy0 = sess.oy, cx1 = cx0 + sess.cw * k, cy1 = cy0 + sess.ch * k;
    if (v.x0 >= cx0 - 0.5 && v.y0 >= cy0 - 0.5 && v.x1 <= cx1 + 0.5 && v.y1 <= cy1 + 0.5) return;
    const ctx = gfx.ctx;
    ctx.save();
    ctx.globalAlpha = 1;
    if (f.background & 0xff) {
      ctx.fillStyle = L.rgbaToCss(f.background);
      ctx.fillRect(v.x0 - 1, v.y0 - 1, v.w + 2, v.h + 2);
    }
    const op = backdropOp(sess, f);
    const a = op && sess.assets && sess.assets.images[op.asset];
    if (a && a.ok) {
      const frames = a.frames || 1, cols = a.cols || 1, rows = Math.ceil(frames / cols);
      const sw = a.img.naturalWidth / cols, sh = a.img.naturalHeight / rows;
      const fr = (op.frame || 0) % frames;
      const sx = (fr % cols) * sw, sy = Math.floor(fr / cols) * sh;
      const soft = hasDOM ? softBackdrop(sess, a, sx, sy, sw, sh) : null;
      // Tiles the size of the backdrop around it, mirrored along each axis they're offset on
      // (odd steps), so every shared edge matches; only the ones the view reaches.
      const tw = op.w * k, th = op.h * k, bx = cx0 + op.x * k, by = cy0 + op.y * k;
      const ix0 = Math.floor((v.x0 - bx) / tw), ix1 = Math.floor((v.x1 - bx) / tw);
      const iy0 = Math.floor((v.y0 - by) / th), iy1 = Math.floor((v.y1 - by) / th);
      if (ix1 - ix0 <= 6 && iy1 - iy0 <= 6) {
        for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
          if (ix === 0 && iy === 0) continue;
          const fx = ix % 2 !== 0, fy = iy % 2 !== 0;
          ctx.save();
          ctx.translate(bx + ix * tw + (fx ? tw : 0), by + iy * th + (fy ? th : 0));
          ctx.scale(fx ? -1 : 1, fy ? -1 : 1);
          // A hair of overlap hides the seam between tiles. Above and below: the soft copy.
          if (iy !== 0 && soft) ctx.drawImage(soft, 0, 0, soft.width, soft.height, -0.25, -0.25, tw + 0.5, th + 0.5);
          else ctx.drawImage(a.img, sx, sy, sw, sh, -0.25, -0.25, tw + 0.5, th + 0.5);
          ctx.restore();
        }
      }
    }
    // Shade what lies outside the canvas: a hair at the sides, and above and below a scrim that
    // deepens toward the screen's edge.
    ctx.fillStyle = "#000";
    if (cx0 > v.x0 || cx1 < v.x1) {
      ctx.globalAlpha = BLEED_SIDE_DIM;
      const y0 = Math.max(v.y0, cy0), y1 = Math.min(v.y1, cy1);
      if (cx0 > v.x0) ctx.fillRect(v.x0 - 1, y0, cx0 - v.x0 + 1, y1 - y0);
      if (cx1 < v.x1) ctx.fillRect(cx1, y0, v.x1 - cx1 + 1, y1 - y0);
    }
    ctx.globalAlpha = 1;
    const scrim = (near, far) => {
      const g = ctx.createLinearGradient(0, near, 0, far);
      g.addColorStop(0, "rgba(0,0,0," + BLEED_EDGE_DIM + ")");
      g.addColorStop(1, "rgba(0,0,0," + BLEED_FAR_DIM + ")");
      ctx.fillStyle = g;
      ctx.fillRect(v.x0 - 1, Math.min(near, far) - (far < near ? 1 : 0), v.w + 2, Math.abs(far - near) + 1);
    };
    if (cy0 > v.y0) scrim(cy0, v.y0);
    if (cy1 < v.y1) scrim(cy1, v.y1);
    ctx.restore();
  }

  // An AudioContext for decoding the game's sounds, even while muted or before audio is unlocked
  // (decoding works on a suspended context), so a run that opens silent still has its sounds and
  // music once audio starts. Older runtimes without fx.audioContext fall back to the playing one.
  function audioContext(sdk) {
    if (sdk.fx && typeof sdk.fx.audioContext === "function") {
      try { return sdk.fx.audioContext() || null; } catch (e) { return null; }
    }
    const out = audioOut(sdk);
    return out ? out.ctx : null;
  }

  // Playfield (360x640) <-> engine canvas coordinates.
  function toGame(sess, x, y) { return [(x - sess.ox) / sess.s, (y - sess.oy) / sess.s]; }
  function toField(sess, x, y) { return [sess.ox + x * sess.s, sess.oy + y * sess.s]; }

  // ---- motion: toasts, shake and pulses ----------------------------------------------------

  // How the shell shows a game's feedback motion (docs/BUBBLES.md, "microgame", "Toasts, shake and
  // pulses"). Drawing only: nothing here touches game state, so runs, replays and verify are the
  // same as before.
  //   Toasts: one at a time, in a lane that crosses no text and no tap target (just under the HUD,
  //     else the first free band), at most TOAST_MAX_CHARS, fading in and out in place (no rise,
  //     no pop), gone after at most TOAST_MAX_MS and cleared as soon as the screen's words change
  //     (the next round; a counter ticking up doesn't count). A toast in the same frame as a "success" haptic (a right answer, which
  //     the game already shows with its own colours) isn't drawn.
  //   Shake: the engine's shakes in one moment fold into one, at most SHAKE_MAX_PX for SHAKE_MS,
  //     and only after the player's own input (never on a timeout). Text, tap targets, the HUD
  //     bands and the backdrop stay still; only art moves. With nothing to move, the shake becomes
  //     a short edge tint.
  //   Pulses: text is drawn at no more than TEXT_SCALE_MAX (or less than 1 / TEXT_SCALE_MAX) scale.
  const TOAST_MAX_CHARS = 22, TOAST_MAX_MS = 900, TOAST_FADE_IN = 120, TOAST_FADE_OUT = 180, TOAST_CLEAR_MS = 90, TOAST_GRACE_MS = 200, TOAST_SIZE = 15;
  const SHAKE_MAX_PX = 3, SHAKE_MS = 150, SHAKE_INPUT_MS = 800;
  const TEXT_SCALE_MAX = 1.08;

  /** A toast's copy cut to TOAST_MAX_CHARS: its first clause if that fits, else whole words and "…". Null when empty. */
  function toastCopy(text) {
    const t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    if (!t) return null;
    if (t.length <= TOAST_MAX_CHARS) return t;
    const clause = t.split(/\s[—–-]\s|[.!?;:,](?:\s|$)/)[0].trim();
    if (clause.length >= 3 && clause.length <= TOAST_MAX_CHARS) return clause;
    let out = "";
    for (const w of t.split(" ")) {
      if ((out ? out.length + 1 : 0) + w.length > TOAST_MAX_CHARS - 1) break;
      out = out ? out + " " + w : w;
    }
    return out ? out + "…" : t.slice(0, TOAST_MAX_CHARS - 1) + "…";
  }

  function textBox(op) {
    const s = op.scale || 1, cx = op.x + op.w / 2, cy = op.y + op.h / 2;
    return { x0: cx - (op.w * s) / 2, y0: cy - (op.h * s) / 2, x1: cx + (op.w * s) / 2, y1: cy + (op.h * s) / 2 };
  }

  /**
   * The toast lane: the center y (canvas units) of a band `h` tall and `w` wide, centered across the
   * canvas, that no text op and no tap target crosses. Looks just under the HUD first (the lowest
   * text in the top fifth of the safe area), then down the screen, then up from there. Null when
   * no band is free.
   */
  function toastLane(ops, targets, cw, ch, tall, w, h) {
    const top = tall ? ch * SAFE_TOP : ch * 0.04, bottom = tall ? ch * (1 - SAFE_BOTTOM) : ch * 0.96;
    const boxes = [];
    for (const op of ops) if (op.op === "text" && op.text && op.opacity > 0.05) boxes.push(textBox(op));
    for (const t of targets || []) boxes.push({ x0: t.x, y0: t.y, x1: t.x + t.w, y1: t.y + t.h });
    let hud = top;
    for (const b of boxes) if ((b.y0 + b.y1) / 2 < top + (bottom - top) * 0.2) hud = Math.max(hud, b.y1);
    const x0 = (cw - w) / 2, x1 = (cw + w) / 2, pad = 3;
    const free = (y) => y - h / 2 >= top && y + h / 2 <= bottom &&
      boxes.every((b) => b.x1 <= x0 || b.x0 >= x1 || b.y1 <= y - h / 2 - pad || b.y0 >= y + h / 2 + pad);
    const start = hud + pad + h / 2;
    for (let y = start; y + h / 2 <= bottom; y += 2) if (free(y)) return y;
    for (let y = start - 2; y - h / 2 >= top; y -= 2) if (free(y)) return y;
    return null;
  }

  /** A text signature with numbers masked: changes when the screen's words change (a new round), not when a counter ticks. */
  function wordsSig(ops) {
    let s = "";
    // Every drawn text, faint or not: words fading in with the toast's own moment are part of it.
    for (const op of ops) if (op.op === "text" && op.text) s += String(op.text).replace(/\b\d+\b/g, "#") + "|";
    return s;
  }

  /** Starts a toast from the frame's toasts (the last one wins), or null when none should show. */
  function nextToast(sess, f, now) {
    if (!f.toasts.length) return null;
    if ((f.haptics || []).some((h) => h === "success")) return null;
    const text = toastCopy(f.toasts[f.toasts.length - 1].text);
    if (!text) return null;
    const ms = f.toasts[f.toasts.length - 1].ms;
    const size = TOAST_SIZE;
    const w = Math.min(sess.cw - 16, text.length * size * 0.56 + 28), h = size * 1.9;
    let targets = [];
    try { targets = sess.game.hitTargets() || []; } catch (e) { targets = []; }
    const y = toastLane(f.ops, targets, sess.cw, sess.ch, sess.tall, w, h);
    if (y == null) return null;
    return { text, y, w, h, size, born: now, life: Math.min(TOAST_MAX_MS, ms > 0 ? ms : TOAST_MAX_MS), sig: wordsSig(f.ops), cleared: null };
  }

  /** The toast's opacity at `now` (0 once it's over). */
  function toastAlpha(t, now) {
    const age = now - t.born;
    const end = t.cleared != null ? Math.min(t.born + t.life, t.cleared + TOAST_CLEAR_MS) : t.born + t.life;
    if (now >= end) return 0;
    return Math.max(0, Math.min(1, age / TOAST_FADE_IN, (end - now) / (t.cleared != null ? TOAST_CLEAR_MS : TOAST_FADE_OUT)));
  }

  function drawToast(ctx, sess, t, alpha) {
    const k = sess.s, cx = sess.ox + (sess.cw / 2) * k, cy = sess.oy + t.y * k, w = t.w * k, h = t.h * k;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(12,14,24,0.78)";
    const r = h / 2, x = cx - w / 2, y = cy - h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    const fam = sess.fonts && sess.fonts[0] ? `"${sess.fonts[0]}", ` : "";
    ctx.font = `700 ${t.size * k}px ${fam}-apple-system, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t.text, cx, cy, w - 12 * k);
    ctx.restore();
  }

  /**
   * The shake to apply now: {amp, age} or null. A new engine shake (its amplitude rising) starts one
   * episode if the player gave input in the last SHAKE_INPUT_MS and no episode is running; the
   * episode lasts SHAKE_MS at most SHAKE_MAX_PX, decaying.
   */
  function shakeNow(sh, enginePx, now, lastInput) {
    const rising = enginePx > sh.prev + 0.05;
    sh.prev = enginePx;
    if (rising && !(sh.start != null && now - sh.start < SHAKE_MS) && lastInput != null && now - lastInput <= SHAKE_INPUT_MS) {
      sh.start = now;
      sh.amp = Math.min(SHAKE_MAX_PX, enginePx);
    }
    if (sh.start == null || now - sh.start >= SHAKE_MS) return null;
    return { amp: sh.amp * (1 - (now - sh.start) / SHAKE_MS), age: now - sh.start };
  }

  /** Whether an op may move with the shake: art only (no text, tap targets, HUD bands or backdrop). */
  function shakeable(op, targets, cw, ch, tall) {
    if (op.op === "text" || op.op === "clip" || op.op === "unclip") return false;
    let b;
    if (op.op === "circle") { const r = Math.abs(op.r * (op.scale || 1)); b = { x0: op.x - r, y0: op.y - r, x1: op.x + r, y1: op.y + r }; }
    else if (op.op === "line") b = { x0: Math.min(op.x1, op.x2), y0: Math.min(op.y1, op.y2), x1: Math.max(op.x1, op.x2), y1: Math.max(op.y1, op.y2) };
    else if (op.op === "poly") return true;
    else b = { x0: op.x, y0: op.y, x1: op.x + op.w, y1: op.y + op.h };
    if ((b.x1 - b.x0) * (b.y1 - b.y0) >= 0.7 * cw * ch) return false;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const top = tall ? ch * SAFE_TOP + 100 : ch * 0.15, bottom = tall ? ch * (1 - SAFE_BOTTOM) - 72 : ch * 0.9;
    if (cy < top || cy > bottom) return false;
    for (const t of targets) if (cx >= t.x && cx <= t.x + t.w && cy >= t.y && cy <= t.y + t.h) return false;
    return true;
  }

  /** Text ops scaled past TEXT_SCALE_MAX come back clamped (a copy of the frame only when needed). */
  function clampTextScale(f) {
    let ops = null;
    for (let i = 0; i < f.ops.length; i++) {
      const op = f.ops[i];
      if (op.op !== "text" || !(op.scale > TEXT_SCALE_MAX || (op.scale > 0 && op.scale < 1 / TEXT_SCALE_MAX))) continue;
      if (!ops) ops = f.ops.slice();
      ops[i] = Object.assign({}, op, { scale: Math.max(1 / TEXT_SCALE_MAX, Math.min(TEXT_SCALE_MAX, op.scale)) });
    }
    return ops ? Object.assign({}, f, { ops }) : f;
  }

  /** Draws a frame with the shake applied to art ops only (runs of ops drawn with their own offset), or an edge tint. */
  function drawShaken(ctx, L, f, sess, assets, shake) {
    const base = { clear: false, k: sess.s, ox: sess.ox, oy: sess.oy, noShake: true };
    let targets = [];
    try { targets = sess.game.hitTargets() || []; } catch (e) { targets = []; }
    const hasClip = f.ops.some((o) => o.op === "clip");
    const moves = hasClip ? [] : f.ops.map((o) => shakeable(o, targets, sess.cw, sess.ch, sess.tall));
    if (!moves.some(Boolean)) {
      L.drawFrame(ctx, f, assets, base);
      // Nothing to move: a short tint at the canvas edges instead.
      const k = sess.s, a = 0.35 * (shake.amp / SHAKE_MAX_PX), e = 10 * k;
      const x = sess.ox, y = sess.oy, w = sess.cw * k, h = sess.ch * k;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.fillStyle = "#FF4D6D";
      ctx.fillRect(x, y, w, e); ctx.fillRect(x, y + h - e, w, e);
      ctx.fillRect(x, y, e, h); ctx.fillRect(x + w - e, y, e, h);
      ctx.restore();
      return;
    }
    const dx = (Math.random() * 2 - 1) * shake.amp * sess.s, dy = (Math.random() * 2 - 1) * shake.amp * sess.s;
    let i = 0;
    while (i < f.ops.length) {
      let j = i;
      while (j < f.ops.length && moves[j] === moves[i]) j++;
      const part = Object.assign({}, f, { ops: f.ops.slice(i, j), background: i === 0 ? f.background : 0 });
      L.drawFrame(ctx, part, assets, moves[i] ? Object.assign({}, base, { ox: sess.ox + dx, oy: sess.oy + dy }) : base);
      i = j;
    }
  }

  // Pure parts, for the runtime tests (tools/runtime-tests/checks.js).
  B.microgameMotion = { toastCopy, toastLane, toastAlpha, shakeNow, shakeable, clampTextScale, TOAST_MAX_CHARS, TOAST_MAX_MS, SHAKE_MAX_PX, SHAKE_MS, TEXT_SCALE_MAX };

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
      if (sess.tall && typeof sdk.fitBox === "function") {
        const y0 = sess.oy, y1 = sess.oy + sess.ch * sess.s;
        sdk.fitBox({ x0: 0, y0, x1: W, y1, safe: { x0: 0, y0: y0 + sess.ch * SAFE_TOP * sess.s, x1: W, y1: y1 - sess.ch * SAFE_BOTTOM * sess.s } });
      }
      const ti = sess.game.meta.text_input;
      if (ti) sdk.textField(textFieldSpec(sess, ti));

      sdk.on("clock.tick", () => {
        if (sdk.ended) return;
        const g = sess.game;
        g.step(STEP_MS);
        sess.clockMs += STEP_MS;
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
        const raw = sess.game.frame();
        paintBleed(gfx, sess, raw, L);
        // Until the game's fonts are in (at most FONT_WAIT_MS), draw the frame without its text.
        const ready = fontsReady(sess);
        const f = clampTextScale(ready ? raw : Object.assign({}, raw, { ops: raw.ops.filter((o) => o.op !== "text") }));
        const now = sess.clockMs;
        const shake = shakeNow(sess.shake, raw.shake || 0, now, sess.lastInput);
        if (shake) drawShaken(gfx.ctx, L, f, sess, sess.assets, shake);
        else L.drawFrame(gfx.ctx, f, sess.assets, { clear: false, k: sess.s, ox: sess.ox, oy: sess.oy, noShake: true });
        // Toasts: the newest one replaces the last; a change in the screen's words fades it out.
        const nt = nextToast(sess, raw, now);
        if (nt) sess.toast = nt;
        const t = sess.toast;
        if (t) {
          if (t.cleared == null && now - t.born > TOAST_GRACE_MS && wordsSig(raw.ops) !== t.sig) t.cleared = now;
          else if (now - t.born <= TOAST_GRACE_MS) t.sig = wordsSig(raw.ops);
          const a = toastAlpha(t, now);
          if (a > 0) { if (ready) drawToast(gfx.ctx, sess, t, a); } else if (now > t.born) sess.toast = null;
        }
        // Side effects queued since the last drawn frame. Drawing is presentation-only, so none of
        // this touches game state (bot, poster and replay runs stay deterministic).
        const out = audioOut(sdk);
        if (out) for (const s of f.audio) L.playSound(out, s, sess.assets);
        for (const h of f.haptics) sdk.fx.haptic(h);
        if (sess.music) {
          // A library sound playing behind the game (`backing`) replaces the game's own music.
          sess.music.sync(out && !out.backing ? out : null, f.music, sess.assets);
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
    describe: "Sends taps, drags and swipes to the microgame engine. Taps and drags hit the game's on_tap / on_drag / on_press nodes; a quick flick is also sent as a swipe. Games with a text input get a native text field; what the person types (each edit, and Enter or Done) goes to the game's text inputs.",
    examples: ["tap a tile", "drag the paddle", "flick to slide the board", "type the answer and press Done"],
    params: {
      swipes: { type: "boolean", default: true, describe: "Turn quick flicks into engine swipes" },
    },
    consumes: ["pointer.down", "pointer.move", "pointer.up", "text.input?"],
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
        s.lastInput = s.clockMs;
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
      // Typed text, only for games with a text input: other games never listen, so their runs log
      // exactly what they always did.
      const s0 = sess();
      if (s0 && s0.game.meta.text_input) {
        sdk.on("text.input", (e) => {
          const s = sess();
          if (!s || sdk.ended) return;
          s.game.text(e.kind, e.value);
        });
      }
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
        if (m.phase === "won" || m.phase === "lost") {
          // The run's input log (microgame-log/1: seed, game hash, inputs, final result), so a
          // challenge or leaderboard can submit it and a server can replay it with
          // MicrogameEngine.verify(content.game_json, log) instead of trusting the score.
          const sess = sessions.get(sdk.state);
          if (sess && m.log == null) {
            try { m.log = sess.game.log(true); } catch (e) { m.log = null; }
          }
          sdk.end(m.phase === "won" ? "success" : "fail", { delay: 24 });
        }
      });
    },
  });

  // ---- bot -------------------------------------------------------------------------------

  // Strings a bot might type: the game's own words, read from its live state (string values, list
  // items and record fields: a target word, the words falling, the answers left). Deduped, in
  // state order, at most 24.
  function textCandidates(s, maxLen) {
    let st;
    try { st = s.game.state(); } catch (e) { return []; }
    const out = [];
    const walk = (v, depth) => {
      if (out.length >= 24 || depth > 4 || v == null) return;
      if (typeof v === "string") {
        const w = v.trim();
        if (w && w.length <= maxLen && w.indexOf("\n") < 0 && out.indexOf(w) < 0) out.push(w);
      } else if (Array.isArray(v)) {
        for (let i = 0; i < v.length && i < 64; i++) walk(v[i], depth + 1);
      } else if (typeof v === "object") {
        for (const k of Object.keys(v)) if (k.slice(0, 2) !== "__") walk(v[k], depth + 1);
      }
    };
    walk(st, 0);
    return out;
  }

  // The candidate that pays off right away: each is submitted to a fork of the game (engine v0.2
  // mg_fork; the real game is untouched), and the one that wins or raises the score most is kept.
  // Null when none does better than doing nothing.
  function bestWord(s, words) {
    const now = s.game.status();
    let best = null, bestV = now.score || 0;
    for (const w of words) {
      let p = null;
      try {
        p = s.game.fork();
        p.text("submit", w);
        p.step(STEP_MS);
        const st = p.status();
        const v = st.phase === "won" ? 1e12 : st.phase === "lost" ? -1e12 : st.score || 0;
        if (v > bestV) { bestV = v; best = w; }
      } catch (e) {
        /* this candidate can't be judged */
      } finally {
        if (p) { try { p.dispose(); } catch (e) { /* already gone */ } }
      }
    }
    return best;
  }

  // Starts typing a word: one of the game's own (at higher skill, the one that scores), sometimes
  // (more often at low skill) with a slip.
  function startTyping(s, bs, skill, rng) {
    const ti = s.game.meta.text_input;
    const maxLen = (ti && ti.max_len) || 32;
    const words = textCandidates(s, maxLen);
    let word = (rng() < skill && words.length && bestWord(s, words)) || (words.length ? words[Math.floor(rng() * words.length)] : "");
    if (!word || rng() < 0.3 * (1 - skill)) {
      const letters = "aeiourstlnmdkpgbh";
      const base = word || "abc";
      const i = Math.floor(rng() * base.length);
      word = (base.slice(0, i) + letters.charAt(Math.floor(rng() * letters.length)) + base.slice(i + 1)).slice(0, maxLen);
    }
    bs.typing = { word, i: 0, gap: Math.round(16 - 8 * skill), wait: 0 };
  }

  // A generic player: taps the game's real tap targets, drags its drag targets, sometimes flicks,
  // and types words into games with a text field (one letter at a time, then Done). Skill sets how
  // often it acts and how precisely. Good enough for posters, demos and smoke runs; Studio's
  // playtest gate uses the authoring layer's stronger bots.
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
    if (bs.typing) {
      const ty = bs.typing;
      if (ty.wait > 0) { ty.wait--; return null; }
      ty.wait = ty.gap;
      if (ty.i < ty.word.length) {
        ty.i++;
        return [{ a: "text", v: ["change", ty.word.slice(0, ty.i)] }];
      }
      bs.typing = null;
      return [{ a: "text", v: ["submit", ty.word] }, { a: "text", v: ["change", ""] }];
    }
    const skill = sdk.botSkill;
    const every = Math.round(36 - 26 * skill);
    if (bs.wait > 0) { bs.wait--; return null; }
    bs.wait = every + Math.floor(rng() * every);
    const targets = s.game.hitTargets();
    if (s.game.meta.text_input && (!targets.length || rng() < 0.6)) {
      startTyping(s, bs, skill, rng);
      return null;
    }
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
    const out = {
      headline: sdk.manifest.title,
      score_text: sdk.score + " points" + (secs ? " · " + secs + " s" : ""),
    };
    // Story games (story_vars, harness-gaps/story.md) keep their own result in state: the share line
    // ("I became king in 6 choices") replaces the points, and the ending, choices and path go in the
    // result tag, which the app and group play read. Presentation only: it reads state, never sets it.
    const sess = sessions.get(sdk.state);
    let st = null;
    try { st = sess && sess.game ? sess.game.state() : null; } catch (e) { st = null; }
    if (st && typeof st === "object") {
      const line = typeof st.sg_share_line === "string" ? st.sg_share_line.trim() : "";
      if (line) out.score_text = line.slice(0, 120);
      const ending = st.ending == null ? "" : String(st.ending);
      if (ending) {
        const tag = ["ending=" + ending];
        if (typeof st.choices_used === "number") tag.push("choices=" + st.choices_used);
        if (typeof st.sg_path === "string" && st.sg_path) tag.push("path=" + st.sg_path);
        out.tag = tag.join(";");
      }
    }
    return out;
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
    describe: "Any game the microgame engine can run: arcade, physics, puzzles, word games (tap letters, or type into a text field), stories. The whole game lives in content.game_json (rules, state, presentation, assets), usually expanded from an authoring manifest. Use the three microgame concepts and nothing else.",
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
    bot: { describe: "Taps the game's real tap targets, drags its drag targets and sometimes flicks; types the game's own words into a text field; skill sets pace and precision.", decide },
    share,
    poster_ticks: 120,
    tips: [
      "Write the game with the authoring layer (fragments + params), then expand it; don't hand-write content.game_json.",
      "Games should be playable by touch: taps, drags and swipes. The runtime has no key events; a game that needs typed answers uses a text input, which gets a native text field and keyboard.",
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
