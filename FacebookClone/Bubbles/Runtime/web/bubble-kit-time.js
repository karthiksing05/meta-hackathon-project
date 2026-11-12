// Bubble kit: time. See docs/BUBBLES.md, 4.6. Kits only call Bubble.defineFormula and Bubble.defineConcept.
//
// Tap at the right moment. One concept set, two rules:
//   rule.timing_window (catch): a mover slides, swings or pulses past a target; tap when it lines
//     up. Precision scoring, a sparkle on perfect hits; misses can cost lives (rule.lives).
//   rule.timing_stack (stack): a piece swings from a hook; tap to drop it on the stack. Only the
//     overlap stays, the overhang crumbles off, so every imprecise drop makes the next one harder.
// All motion uses deterministic arithmetic (no Math.sin in game logic), so replays match on every
// engine.
//
// Reuses the common kit: input.tap (input.action), rule.lives (a miss emits entity.hit),
// behavior.speed_ramp (state.pace speeds the mover up), share.emoji_grid (state.share_rows).
//
// State: state.timing_stage (camera), state.timing_mover, state.timing (rule), state.timing_score.
(function () {
  "use strict";
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var B = root.Bubble;
  if (!B || typeof B.defineConcept !== "function" || typeof B.defineFormula !== "function") return;

  var W = 360, CX = 180;
  var TRACK_Y = 360;          // catch: the line the mover rides
  var RING_Y = 360;           // catch + pulse: ring center
  var HOOK_Y = 104;           // stack: hook (screen space)
  var HANG_Y = 236;           // stack: hanging piece center (screen space)
  var BASE_Y = 596;           // stack: top of the plate (world space)
  var TOP_SCREEN = 440;       // stack: the camera keeps the stack top near here
  var MARK = { perfect: "🌟", good: "✨", ok: "🫧", miss: "💨" };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function isStr(v) { return typeof v === "string" && v.trim().length > 0; }
  // Deterministic sine/cosine with the argument in turns.
  function dsin(t) {
    var x = t - Math.floor(t);
    if (x >= 0.5) x -= 1;
    if (x > 0.25) x = 0.5 - x; else if (x < -0.25) x = -0.5 - x;
    var a = x * 6.283185307179586, a2 = a * a;
    return a * (1 - a2 / 6 * (1 - a2 / 20 * (1 - a2 / 42 * (1 - a2 / 72 * (1 - a2 / 110)))));
  }
  function dcos(t) { return dsin(t + 0.25); }
  // Triangle wave in [-1, 1], softened so the mover eases at the turnarounds.
  function slideWave(t) {
    var x = t - Math.floor(t);
    var tri = x < 0.5 ? 4 * x - 1 : 3 - 4 * x;
    return tri * (1.5 - 0.5 * tri * tri);
  }
  // Mover position in [-1, 1] for a motion at phase t (turns).
  function wave(motion, t) { return motion === "swing" ? dsin(t) : slideWave(t); }
  function skillOf(sdk) {
    var s = sdk.botSkill;
    if (typeof s !== "number" && sdk.bot && typeof sdk.bot.skill === "number") s = sdk.bot.skill;
    return clamp(typeof s === "number" && isFinite(s) ? s : 0.7, 0, 1);
  }
  var memo = typeof WeakMap === "function" ? new WeakMap() : null;
  function botMem(sdk) {
    if (sdk.botState && typeof sdk.botState === "object") {
      var bs = sdk.botState;
      if (!bs.timing || sdk.tick < bs.timing.lastTick) bs.timing = { lastTick: 0 };
      bs.timing.lastTick = sdk.tick;
      return bs.timing;
    }
    var key = sdk.state;
    var m = memo ? memo.get(key) : key.__timingBot;
    if (!m || sdk.tick < m.lastTick) { m = { lastTick: 0 }; if (memo) memo.set(key, m); else key.__timingBot = m; }
    m.lastTick = sdk.tick;
    return m;
  }
  // ---- look-friendly drawing (LOOKS.md) ---------------------------------------------------------
  // Everything is colored through palette roles and drawn with g primitives, so every look (glow,
  // paper, pixel, neon, ink, clay...) renders it. Palettes without roles fall back to accents.
  function hexRgb(h) {
    if (typeof h !== "string" || h.charAt(0) !== "#") return null;
    h = h.slice(1);
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var n = parseInt(h.slice(0, 6), 16);
    return isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : null;
  }
  function mixHex(a, b, t) {
    var x = hexRgb(a), y = hexRgb(b);
    if (!x || !y) return a;
    var r = Math.round(x[0] + (y[0] - x[0]) * t), gg = Math.round(x[1] + (y[1] - x[1]) * t), bl = Math.round(x[2] + (y[2] - x[2]) * t);
    return "#" + ((1 << 24) + (r << 16) + (gg << 8) + bl).toString(16).slice(1);
  }
  var roleCache = { pal: null, roles: null };
  function roles(pal) {
    if (roleCache.pal === pal) return roleCache.roles;
    var a = pal.accents && pal.accents.length ? pal.accents : [pal.ink];
    function pick(score) {
      var best = a[0], bs = -1e9;
      for (var i = 0; i < a.length; i++) { var c = hexRgb(a[i]); if (c) { var v = score(c[0], c[1], c[2]); if (v > bs) { bs = v; best = a[i]; } } }
      return best;
    }
    var primary = pal.primary || a[0], secondary = pal.secondary || a[1 % a.length], accent = pal.accent || a[2 % a.length];
    var series = [primary, secondary, accent];
    for (var i = 0; i < a.length; i++) if (series.indexOf(a[i]) < 0 && a[i] !== pal.danger) series.push(a[i]);
    var bgTop = pal.bgTop || pal.top;
    var r = {
      primary: primary, secondary: secondary, accent: accent, series: series, ink: pal.ink,
      bgTop: bgTop, bgBottom: pal.bgBottom || pal.bottom, dark: !!pal.dark, look: pal.look || null,
      danger: pal.danger || pick(function (R, G, B) { return R - (G + B) / 2; }),
      good: pal.good || pick(function (R, G, B) { return G - (R + B) / 2 + (B > R ? 10 : 0); }),
      // surface: card and panel fills (any CSS color); light: a hex highlight for sprite
      // primitives (bubble tints, orbs, glows); line: the look's outline color, if it has one.
      surface: pal.surface || pal.glow || bgTop,
      card: pal.surface || null,
      light: pal.glow || bgTop,
      line: pal.line || null,
      inkOn: typeof pal.inkOn === "function" ? pal.inkOn : function () { return pal.ink; }
    };
    roleCache.pal = pal; roleCache.roles = r;
    return r;
  }
  function lookOf(g) { return g.look || (g.palette && g.palette.look) || "glow"; }
  // Glossy highlights (sheen strips, specular dots) only where the look is soft and shiny.
  function glossy(g) { var lk = lookOf(g); return lk === "glow" || lk === "clay"; }
  // A dotted line made of small circles (looks draw circles in their own style).
  function dots(g, x1, y1, x2, y2, gap, r, color, alpha) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
    var n = Math.max(1, Math.floor(len / gap));
    for (var i = 0; i <= n; i++) g.circle(x1 + dx * i / n, y1 + dy * i / n, r, color, alpha);
  }
  function moverOf(sdk) { return sdk.state.timing_mover; }
  function contentMover(sdk) {
    var c = sdk.content || {};
    return isStr(c.mover) ? String(c.mover) : "🫧";
  }

  // ---- concepts --------------------------------------------------------------------------------

  B.defineConcept({
    id: "space.timing_stage", kind: "space", version: 1, formulas: ["time"],
    describe: "The timing stage: scenery behind the action, drawn by the Bubble's look (the style's motif by default, or a chosen one, or plain for none), and a camera that rises as a stack grows while the scenery sinks slowly behind it. Pair it with entity.timing_mover and one timing rule.",
    examples: ["a cable line over a pixel city", "a bakery counter where loaves stack up"],
    params: {
      backdrop: { type: "enum", values: ["auto", "hills", "city", "waves", "clouds", "stars", "plain"], default: "auto", describe: "Scenery behind the action, in the Bubble's look: auto (style.motif, else the look's own, else hills), a motif of its own (hills, city, waves, clouds, stars), or plain (none: a clean background, good for counters and tabletops)." }
    },
    consumes: ["clock.tick"], emits: [], requires: ["entity.timing_mover"], conflicts: [],
    tags: { mood: ["calm", "playful", "cozy"], energy: ["medium", "high"] },
    glue: [],
    setup: function (sdk, params) {
      var st = sdk.state.timing_stage = { cam: 0, camTarget: 0, backdrop: params.backdrop };
      sdk.on("clock.tick", function () { st.cam += (st.camTarget - st.cam) * 0.12; });
      sdk.layer(0, function (g) {
        // The look draws the motif (g.scenery). Calling it at all, even with "none", tells the
        // engine this Bubble owns its scenery, so the backdrop doesn't paint a second, static copy.
        if (typeof g.scenery !== "function") return;
        var motif = params.backdrop === "plain" ? "none" : params.backdrop;
        var par = st.cam * 0.25;
        if (!par || motif === "none") { g.scenery(motif); return; }
        g.ctx.save();
        g.ctx.translate(0, par);
        g.scenery(motif);
        g.ctx.restore();
      });
    }
  });

  B.defineConcept({
    id: "entity.timing_mover", kind: "entity", version: 1, formulas: ["time"],
    describe: "The thing you time: content.mover (an emoji) in a bubble. motion 'slide' glides back and forth along a line and eases at the ends; 'swing' hangs from a hook like a pendulum (fastest in the middle); 'pulse' is a ring that grows and shrinks around a center (catch only). Speeds up a little after every hit, and with state.pace (behavior.speed_ramp).",
    examples: ["a cable car sliding along its cable", "a loaf swinging from a baker's hook", "a ring that breathes in and out"],
    params: {
      motion: { type: "enum", values: ["slide", "swing", "pulse"], default: "slide", describe: "How it moves. Stacks need slide or swing." },
      speed: { type: "number", default: 0.42, min: 0.2, max: 1.2, describe: "Back-and-forth cycles per second at the start (0.42 = one round trip in 2.4 s)." },
      ramp: { type: "number", default: 0.05, min: 0, max: 0.15, describe: "Extra cycles per second added after every hit." },
      max_speed: { type: "number", default: 1.0, min: 0.4, max: 2, describe: "Speed cap after ramping." },
      size: { type: "integer", default: 120, min: 50, max: 220, describe: "Width of the mover in points (for stacks: the first piece's width)." },
      travel: { type: "number", default: 0.9, min: 0.4, max: 1, describe: "How much of the stage width the motion covers." }
    },
    consumes: ["clock.tick", "rule.hit?"], emits: [], requires: ["space.timing_stage"], conflicts: [],
    tags: { energy: ["medium", "high"] },
    state: "timing_mover: {motion, phase, speed, x, r, w}",
    glue: [],
    setup: function (sdk, params) {
      var mv = sdk.state.timing_mover = {
        motion: params.motion, phase: 0.25 + 0.5 * Math.floor(sdk.rng() * 2), speed: params.speed, w: params.size, h: 48,
        amp: Math.max(30, (300 * params.travel - (params.motion === "pulse" ? 0 : params.size)) / 2),
        x: CX, y: TRACK_Y, r: 0, active: true, hidden: false, emoji: contentMover(sdk), passes: 0, lastSide: 0, pace: 1,
        rMin: 34, rMax: 34 + 120 * params.travel, labelEmoji: ""
      };
      function place() {
        var v = wave(mv.motion === "pulse" ? "slide" : mv.motion, mv.phase);
        if (mv.motion === "pulse") { mv.r = mv.rMin + (mv.rMax - mv.rMin) * (v + 1) / 2; mv.x = CX; mv.y = RING_Y; }
        else mv.x = CX + mv.amp * v;
        mv.v = v;
      }
      place();
      sdk.on("clock.tick", function () {
        if (!mv.active) return;
        var pace = typeof sdk.state.pace === "number" && sdk.state.pace > 0 ? sdk.state.pace : 1;
        mv.pace = pace;
        mv.phase += mv.speed * pace / 60;
        if (mv.phase > 1000) mv.phase -= 1000;
        place();
      });
      sdk.on("rule.hit", function () { mv.speed = Math.min(params.max_speed, mv.speed + params.ramp); });
      mv.place = null;
    }
  });

  // Share rows for share.emoji_grid: eight taps per row (hit = perfect, near = a catch, miss).
  function shareRows(sdk, st) {
    sdk.on("flow.phase", function (e) {
      if (e.name !== "fail" && e.name !== "success") return;
      var rows = [];
      for (var i = 0; i < st.rows.length; i += 8) rows.push(st.rows.slice(i, i + 8));
      if (rows.length) sdk.state.share_rows = rows;
    });
  }
  function drawProgress(g, text) {
    g.text(text, W - 22, 30, { size: 14, weight: 800, color: g.palette.ink, alpha: 0.8, align: "right" });
  }
  function judgeLabel(precision, perfect) {
    return perfect ? "Perfect!" : precision >= 0.8 ? "Great" : precision >= 0.5 ? "Nice" : "Close";
  }

  B.defineConcept({
    id: "rule.timing_window", kind: "rule", version: 1, formulas: ["time"],
    describe: "Catch it: a target (content.stops names, cycled) sits on the mover's path; tap when the mover lines up with it. Within the hit window is a hit (precision 1 at dead center, a sparkle within `perfect`); outside it is a miss. If the mover glides past `passes` times untouched, that's a miss too and the target moves. Misses emit entity.hit, so rule.lives takes a life. The window narrows as you go. Succeeds after `targets` hits.",
    examples: ["Tap when the cable car lines up with the stop", "Tap when the ring matches the moon", "catch the ferry at the pier"],
    params: {
      targets: { type: "integer", default: 12, min: 4, max: 30, describe: "Hits needed to finish the run." },
      window: { type: "number", default: 30, min: 8, max: 60, describe: "Hit window in points either side of the target at the start (bigger = easier)." },
      narrow: { type: "number", default: 0.35, min: 0, max: 0.6, describe: "How much the window narrows by the last target (0.35 = 35% narrower)." },
      perfect: { type: "number", default: 5, min: 2, max: 12, describe: "Perfect zone in points either side of the target." },
      passes: { type: "integer", default: 3, min: 0, max: 8, describe: "Times the mover may glide past the target untouched before that counts as a miss and the target moves (0 = wait forever)." },
      move_target: { type: "boolean", default: true, describe: "Move the target to a new spot after every hit." }
    },
    consumes: ["input.action", "clock.tick"], emits: ["rule.hit", "rule.miss", "entity.hit", "rule.success"],
    requires: ["entity.timing_mover"], conflicts: ["rule.timing_stack"], ends: true,
    state: "timing: {mode: \"catch\", hits, goal, target, window, state}",
    tags: { energy: ["medium", "high"], competition: ["friendly", "competitive"] },
    glue: ["spawn"],
    setup: function (sdk, params) {
      var c = sdk.content || {};
      var stops = Array.isArray(c.stops) ? c.stops.filter(isStr).map(String) : [];
      var fallback = isStr(c.target_label) ? String(c.target_label) : "";
      var st = sdk.state.timing = {
        mode: "catch", hits: 0, goal: params.targets, target: 0, label: "", passes: 0, state: "run", until: 0, cooldown: 0,
        marks: [], rows: [], perfects: 0, streak: 0, last: null, over: false, stopIndex: 0, flashAt: -100, window: params.window
      };
      function windowNow() { return params.window * (1 - params.narrow * clamp(st.hits / Math.max(1, st.goal - 1), 0, 1)); }
      var spawnGlue = sdk.glue && sdk.glue("spawn");
      function mv() { return moverOf(sdk); }
      function pos() { var m = mv(); return m.motion === "pulse" ? m.r : m.x; }
      function bounds() {
        var m = mv();
        if (m.motion === "pulse") return [m.rMin + 22, m.rMax - 14];
        return [CX - m.amp + 18, CX + m.amp - 18];
      }
      function newTarget(first) {
        var b = bounds();
        var t;
        if (first || !params.move_target) t = first ? b[0] + (b[1] - b[0]) * (0.25 + 0.5 * sdk.rng()) : st.target;
        else {
          // Somewhere new, at least a fifth of the path away from the last spot.
          var span = b[1] - b[0];
          t = b[0] + span * sdk.rng();
          if (Math.abs(t - st.target) < span * 0.2) t = b[0] + ((t - b[0] + span * 0.45) % span);
        }
        if (spawnGlue) {
          var out = spawnGlue({ index: st.hits, target: t, min: b[0], max: b[1], window: params.window });
          if (out && typeof out === "object" && typeof out.target === "number" && isFinite(out.target)) t = clamp(out.target, b[0], b[1]);
        }
        st.target = t;
        st.label = stops.length ? stops[st.stopIndex % stops.length] : fallback;
        st.stopIndex += 1;
        st.passes = 0;
        mv().lastSide = pos() < t ? -1 : 1;
      }
      newTarget(true);
      shareRows(sdk, st);

      function miss(reason) {
        st.streak = 0;
        st.marks.push(MARK.miss);
        st.rows.push("miss");
        st.last = { label: reason === "passed" ? "Missed it" : "Too " + (reason === "early" ? "early" : "late"), at: sdk.tick, good: false };
        var m = mv();
        sdk.emit("rule.miss", { reason: reason });
        sdk.emit("entity.hit", { x: m.motion === "pulse" ? CX : m.x, y: m.motion === "pulse" ? RING_Y : TRACK_Y, reason: reason });
        sdk.fx.sound(reason === "passed" ? "whoosh" : "fail");
        sdk.fx.haptic("warning");
        sdk.fx.shake(3);
        if (reason === "passed" && !sdk.ended) newTarget(false);
      }

      sdk.on("input.action", function () {
        if (st.over || sdk.ended || st.state !== "run" || sdk.tick < st.cooldown) return;
        var m = mv();
        var off = pos() - st.target;
        var d = Math.abs(off);
        var win = windowNow();
        if (d <= win) {
          var perfect = d <= params.perfect;
          var precision = perfect ? 1 : clamp(1 - (d - params.perfect) / Math.max(1, win - params.perfect) * 0.85, 0.15, 1);
          st.hits += 1;
          st.streak = perfect ? st.streak + 1 : 0;
          if (perfect) st.perfects += 1;
          st.marks.push(perfect ? MARK.perfect : precision >= 0.7 ? MARK.good : MARK.ok);
          st.rows.push(perfect ? "hit" : precision >= 0.7 ? "near" : "near");
          st.last = { label: judgeLabel(precision, perfect), at: sdk.tick, good: true, perfect: perfect };
          st.flashAt = sdk.tick;
          var hx = m.motion === "pulse" ? CX : st.target, hy = m.motion === "pulse" ? RING_Y - st.target : TRACK_Y;
          sdk.emit("rule.hit", { precision: precision, perfect: perfect, offset: off, index: st.hits, streak: st.streak, x: hx, y: hy });
          sdk.fx.pop(hx, hy, null, perfect ? 26 : 14);
          if (perfect && sdk.fx.sparkle) sdk.fx.sparkle(hx, hy, null, 14);
          sdk.fx.sound(perfect ? "chime" : "pop");
          sdk.fx.haptic(perfect ? "success" : "medium");
          if (st.hits >= st.goal) {
            st.over = true;
            sdk.emit("rule.success", { hits: st.hits, perfects: st.perfects });
            sdk.fx.sound("success");
            sdk.end("success", { hits: st.hits, delay: 24 });
            return;
          }
          st.state = "caught";
          st.until = sdk.tick + 40;
          m.active = false;
        } else {
          st.cooldown = sdk.tick + 14;
          // Early or late, relative to where the mover is heading.
          var heading = st.prevPos !== undefined && pos() < st.prevPos ? -1 : 1;
          miss(off * heading < 0 ? "early" : "late");
        }
      });

      sdk.on("clock.tick", function () {
        st.window = windowNow();
        if (st.over || sdk.ended) return;
        var m = mv();
        if (st.state === "caught" && sdk.tick >= st.until) {
          st.state = "run";
          m.active = true;
          newTarget(false);
        }
        if (st.state === "run" && params.passes > 0) {
          var side = pos() < st.target ? -1 : 1;
          if (m.lastSide && side !== m.lastSide) {
            st.passes += 1;
            if (st.passes >= params.passes) miss("passed");
          }
          m.lastSide = side;
        }
        st.prevPos = pos();
      });

      // The cable sags a little: its height at x.
      function cableY(x) { var u = (x - 10) / (W - 20); return TRACK_Y - 46 + 16 * u * (1 - u); }
      // Target, track and mover.
      sdk.layer(10, function (g) {
        var ro = roles(g.palette), m = mv();
        var flash = clamp(1 - (sdk.tick - st.flashAt) / 24, 0, 1);
        if (m.motion === "pulse") {
          // Target ring and its window band.
          g.ring(CX, RING_Y, st.target, ro.secondary, { width: st.window * 2, alpha: 0.22 + 0.3 * flash });
          g.ring(CX, RING_Y, st.target, ro.ink, { width: 3, alpha: 0.75 });
          if (st.label) g.text(st.label, CX, RING_Y - m.rMax - 26, { size: 15, weight: 800, color: ro.ink, glow: true });
          return;
        }
        // The cable the mover rides, and a rail with little pulleys.
        var x0 = 10, y0 = cableY(10);
        for (var k = 1; k <= 12; k++) {
          var x1 = 10 + (W - 20) * k / 12, y1 = cableY(x1);
          g.line(x0, y0, x1, y1, ro.ink, { width: 3, alpha: 0.32 });
          x0 = x1; y0 = y1;
        }
        g.line(10, TRACK_Y + 40, W - 10, TRACK_Y + 40, ro.ink, { width: 5, alpha: 0.18 });
        for (var px = 30; px < W; px += 60) g.circle(px, TRACK_Y + 40, 4, glossy(g) ? ro.light : ro.ink, glossy(g) ? 0.8 : 0.35);
        // The stop: a beam over the hit window, the window itself and a sign.
        var tx = st.target, win = st.window;
        g.pill(tx - win, TRACK_Y - 112, win * 2, 158, { fill: ro.secondary, alpha: 0.16 + 0.22 * flash, radius: 8 });
        g.pill(tx - win, TRACK_Y + 34, win * 2, 12, { fill: ro.secondary, alpha: 0.95, radius: 6, glow: 1, glowColor: ro.secondary });
        g.pill(tx - 1.5, TRACK_Y - 112, 3, 158, { fill: ro.ink, alpha: 0.5, radius: 1.5 });
        var lab = st.label || "";
        if (lab) {
          var lw = Math.min(176, lab.length * 8.4 + 28);
          var sx = clamp(tx - lw / 2, 8, W - 8 - lw);
          g.pill(sx, TRACK_Y - 150, lw, 30, { fill: ro.card || ro.light, stroke: ro.secondary, strokeWidth: 2.5, radius: 15, glow: 0.8, glowColor: ro.secondary });
          g.text(lab, sx + lw / 2, TRACK_Y - 135, { size: 14, weight: 800, color: ro.ink, maxWidth: lw - 14 });
        }
        if (params.passes > 0 && st.state === "run") {
          var left = params.passes - st.passes;
          for (var i = 0; i < params.passes; i++) g.circle(tx - (params.passes - 1) * 6 + i * 12, TRACK_Y - 104, 3.4, i < left ? ro.ink : ro.ink, i < left ? 0.75 : 0.18);
        }
      });
      sdk.layer(20, function (g) {
        var ro = roles(g.palette), m = mv();
        if (m.motion === "pulse") {
          g.ring(CX, RING_Y, m.r, ro.primary, { width: 7, alpha: 0.95 });
          g.bubble(CX, RING_Y, 30, { tint: ro.primary, glow: 1 });
          g.emoji(m.emoji, CX, RING_Y, 30);
          return;
        }
        var caught = st.state === "caught";
        var bob = caught ? Math.sin((sdk.tick - st.flashAt) * 0.5) * 3 * clamp(1 - (sdk.tick - st.flashAt) / 26, 0, 1) : 0;
        var x = m.x, y = TRACK_Y + bob, cy = cableY(x);
        // Hanger to the cable.
        g.line(x, cy, x, y - 30, ro.ink, { width: 2.5, alpha: 0.45 });
        g.circle(x, cy, 5.5, ro.ink, 0.55);
        g.circle(x, cy, 3, ro.light, 1);
        var r = Math.min(40, m.w * 0.36);
        g.bubble(x, y, r, { tint: ro.primary, glow: 1, wobble: 1 });
        g.emoji(m.emoji, x, y + 1, r * 1.1);
      });
      sdk.layer(40, function (g) {
        var ro = roles(g.palette);
        drawProgress(g, Math.min(st.hits + (st.over ? 0 : 1), st.goal) + " / " + st.goal);
        if (st.last && sdk.tick - st.last.at < 40) {
          var t = (sdk.tick - st.last.at) / 40;
          g.text(st.last.label, CX, 182 - t * 18, { size: st.last.perfect ? 30 : 24, weight: 900, color: ro.ink, alpha: 1 - t * t, glow: st.last.perfect ? ro.accent : true });
        }
      });
    }
  });

  B.defineConcept({
    id: "rule.timing_stack", kind: "rule", version: 1, formulas: ["time"],
    describe: "Stack it: the mover is a piece (content.pieces emoji, cycled) swinging or sliding above the stack; tap to drop it. Only the part that overlaps the piece below stays (the overhang crumbles off), so sloppy drops shrink every piece after. A drop within `perfect` points snaps exactly on top with a sparkle. A drop that misses the stack completely ends the run, or costs a life with rule.lives (it emits entity.hit). Succeeds at `goal` pieces.",
    examples: ["Drop each loaf right on top. Overhangs get trimmed.", "stack pancakes for the brunch club", "build a tower of postcards"],
    params: {
      goal: { type: "integer", default: 16, min: 6, max: 40, describe: "Pieces to stack to finish the run." },
      perfect: { type: "number", default: 4, min: 2, max: 10, describe: "Perfect zone in points: a drop this close snaps exactly on top and keeps its width." },
      piece_height: { type: "integer", default: 30, min: 18, max: 44, describe: "Height of each piece in points." },
      regrow: { type: "number", default: 0, min: 0, max: 12, describe: "Points of width a perfect drop gives back (0 = never; widths only shrink)." }
    },
    consumes: ["input.action", "clock.tick"], emits: ["rule.hit", "rule.miss", "entity.hit", "rule.success", "rule.fail"],
    requires: ["entity.timing_mover"], conflicts: ["rule.timing_window"], ends: true,
    state: "timing: {mode: \"stack\", hits, goal, stack: [{x, w, y}], state}",
    tags: { mood: ["silly", "cozy", "playful"], energy: ["medium"], competition: ["friendly", "competitive"] },
    glue: [],
    check: function (manifest) {
      var mover = (manifest.concepts || []).filter(function (c) { return c.use === "entity.timing_mover"; })[0];
      if (mover && mover.params && mover.params.motion === "pulse") return [{ code: "content", message: "rule.timing_stack needs entity.timing_mover motion \"slide\" or \"swing\", not \"pulse\"", path: "concepts" }];
      return [];
    },
    setup: function (sdk, params) {
      var c = sdk.content || {};
      var pieces = Array.isArray(c.pieces) ? c.pieces.filter(isStr).map(String) : [];
      if (!pieces.length) pieces = [contentMover(sdk)];
      var H = params.piece_height;
      var st = sdk.state.timing = {
        mode: "stack", hits: 0, goal: params.goal, stack: [], falling: null, debris: [], state: "swing", until: 0,
        marks: [], rows: [], perfects: 0, streak: 0, last: null, over: false, pieceH: H, pieces: pieces, next: 0, flashAt: -100
      };
      var withLives = sdk.has("rule.lives");
      shareRows(sdk, st);
      var stage = sdk.state.timing_stage;
      function mv() { return moverOf(sdk); }
      function top() { return st.stack[st.stack.length - 1]; }
      // The plate: as wide as the first piece (drawn a little wider).
      st.maxW = mv().w;
      st.stack.push({ x: CX, w: mv().w, y: BASE_Y, label: "", plate: true, tint: 0 });
      function arm() {
        var m = mv();
        m.w = top().plate ? m.w : top().w;
        m.active = true; m.hidden = false;
        // Start from alternating ends, so each drop has a fresh run-up.
        m.phase = st.hits % 2 === 0 ? 0.25 : 0.75;
        if (m.motion === "slide") m.phase = st.hits % 2 === 0 ? 0.5 : 0;
        m.emoji = st.pieces[st.next % st.pieces.length];
        st.state = "swing";
      }
      arm();
      function screenTop() { return top().y + (stage ? stage.cam : 0); }

      sdk.on("input.action", function () {
        if (st.over || sdk.ended || st.state !== "swing") return;
        var m = mv();
        var dy = m.motion === "swing" ? (1 - dcos(m.phase - 0.25)) * 14 : 0;
        st.falling = { x: m.x, y: HANG_Y - dy, w: m.w, vy: 0, emoji: m.emoji, tint: st.next };
        m.active = false; m.hidden = true;
        st.state = "fall";
        sdk.fx.sound("whoosh");
      });

      sdk.on("clock.tick", function () {
        for (var i = st.debris.length - 1; i >= 0; i--) {
          var d = st.debris[i];
          d.vy += 0.6; d.y += d.vy; d.x += d.vx; d.rot += d.vr;
          if (d.y > 900) st.debris.splice(i, 1);
        }
        if (st.over) return;
        if (st.state === "fall") {
          var f = st.falling;
          f.vy = Math.min(f.vy + 0.9, 22);
          f.y += f.vy;
          var landY = screenTop() - H / 2;
          if (f.y >= landY) land(f);
        } else if (st.state === "settle" && sdk.tick >= st.until) {
          arm();
        }
      });

      function land(f) {
        var t = top();
        var L = Math.max(f.x - f.w / 2, t.x - t.w / 2), R = Math.min(f.x + f.w / 2, t.x + t.w / 2);
        var ov = R - L;
        var cam = stage ? stage.cam : 0;
        st.falling = null;
        if (ov <= 1) {
          // Clean miss: the piece tumbles past the stack.
          st.debris.push({ x: f.x, y: f.y - cam, w: f.w, h: H, vx: f.x < t.x ? -1.6 : 1.6, vy: 2, rot: 0, vr: f.x < t.x ? -0.06 : 0.06, emoji: f.emoji, tint: f.tint, world: true });
          st.streak = 0;
          st.marks.push(MARK.miss);
          st.rows.push("miss");
          st.last = { label: "Whoops", at: sdk.tick, good: false };
          sdk.emit("rule.miss", { reason: "off" });
          sdk.fx.sound("fail"); sdk.fx.haptic("warning"); sdk.fx.shake(5);
          if (withLives) sdk.emit("entity.hit", { x: f.x, y: f.y, reason: "off", delay: 30 });
          else {
            st.over = true;
            sdk.emit("rule.fail", { reason: "off", height: st.hits });
            sdk.end("fail", { height: st.hits, delay: 30 });
            return;
          }
          st.state = "settle"; st.until = sdk.tick + 24;
          return;
        }
        var off = f.x - t.x;
        var perfect = Math.abs(off) <= params.perfect;
        var piece;
        if (perfect) {
          // Snaps exactly on top; regrow gives a little width back, up to the first piece's width.
          var w = t.plate ? f.w : Math.min(st.maxW, Math.max(f.w, t.w) + params.regrow);
          piece = { x: t.x, w: w, y: t.y - H, emoji: f.emoji, tint: f.tint, perfect: true };
        } else {
          piece = { x: (L + R) / 2, w: ov, y: t.y - H, emoji: f.emoji, tint: f.tint, perfect: false };
          // The overhang crumbles off.
          var cutW = f.w - ov;
          var cutX = off > 0 ? R + cutW / 2 : L - cutW / 2;
          st.debris.push({ x: cutX, y: t.y - H / 2, w: cutW, h: H, vx: off > 0 ? 1.2 : -1.2, vy: 0.5, rot: 0, vr: off > 0 ? 0.05 : -0.05, emoji: "", tint: f.tint, world: true });
        }
        st.stack.push(piece);
        st.next += 1;
        st.hits += 1;
        var precision = perfect ? 1 : clamp(ov / f.w, 0, 1);
        st.streak = perfect ? st.streak + 1 : 0;
        if (perfect) st.perfects += 1;
        st.marks.push(perfect ? MARK.perfect : precision >= 0.8 ? MARK.good : MARK.ok);
        st.rows.push(perfect ? "hit" : "near");
        st.last = { label: judgeLabel(precision, perfect), at: sdk.tick, good: true, perfect: perfect };
        st.flashAt = sdk.tick;
        if (stage) stage.camTarget = Math.max(0, TOP_SCREEN - piece.y);
        var sy = piece.y + cam;
        sdk.emit("rule.hit", { precision: precision, perfect: perfect, offset: off, index: st.hits, streak: st.streak, x: piece.x, y: sy, width: piece.w });
        sdk.fx.pop(piece.x, sy, null, perfect ? 24 : 10);
        if (perfect && sdk.fx.sparkle) sdk.fx.sparkle(piece.x, sy, null, 16);
        sdk.fx.sound(perfect ? "chime" : "pop");
        sdk.fx.haptic(perfect ? "success" : "light");
        if (st.hits >= st.goal) {
          st.over = true;
          sdk.emit("rule.success", { height: st.hits, perfects: st.perfects });
          sdk.fx.sound("success");
          sdk.end("success", { height: st.hits, delay: 24 });
          return;
        }
        st.state = "settle"; st.until = sdk.tick + 14;
      }

      function drawPiece(g, x, y, w, h, tint, emoji, alpha, rot, perfect) {
        var ro = roles(g.palette), ctx = g.ctx;
        var col = ro.series[tint % ro.series.length];
        ctx.save();
        ctx.translate(x, y);
        if (rot) ctx.rotate(rot);
        g.pill(-w / 2, -h / 2, w, h, { fill: glossy(g) ? mixHex(col, ro.light, 0.3) : col, stroke: ro.ink, strokeWidth: 1.5, radius: Math.min(h / 2, 14), alpha: alpha, glow: perfect ? 1 : 0, glowColor: ro.accent });
        if (glossy(g)) g.pill(-w / 2 + 6, -h / 2 + 4, Math.max(0, w - 12), Math.max(3, h * 0.22), { fill: ro.light, radius: h * 0.11, alpha: alpha * 0.7 });
        if (emoji) {
          var n = Math.max(1, Math.min(4, Math.floor(w / (h * 1.25))));
          var gap = w / n;
          if (alpha < 1) ctx.globalAlpha = alpha;
          for (var i = 0; i < n; i++) g.emoji(emoji, -w / 2 + gap * (i + 0.5), 1, h * 0.72);
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      }

      sdk.layer(20, function (g) {
        var ro = roles(g.palette), m = mv();
        var cam = stage ? stage.cam : 0;
        // Plate and stack (a poster frame shows a short sample stack).
        var plate = st.stack[0];
        if (g.poster && st.stack.length === 1) {
          for (var ps = 0; ps < 3; ps++) {
            var pw = plate.w * (1 - 0.06 * ps), px = plate.x + (ps === 1 ? 6 : ps === 2 ? -4 : 0);
            drawPiece(g, px, plate.y + cam - H / 2 - ps * H, pw, H, ps, st.pieces[ps % st.pieces.length], 1, 0, false);
          }
        }
        g.pill(plate.x - plate.w / 2 - 10, plate.y + cam, plate.w + 20, 16, { fill: ro.light, stroke: ro.ink, strokeWidth: 1.5, radius: 8, glow: 0.6, glowColor: ro.light });
        for (var i = 1; i < st.stack.length; i++) {
          var p = st.stack[i];
          var sy = p.y + cam + H / 2;
          if (sy < -60 || sy > 760) continue;
          var fresh = i === st.stack.length - 1 ? clamp(1 - (sdk.tick - st.flashAt) / 14, 0, 1) : 0;
          drawPiece(g, p.x, sy + fresh * 2, p.w * (1 + 0.04 * fresh), H * (1 - 0.08 * fresh), p.tint, p.emoji, 1, 0, p.perfect && fresh > 0);
        }
        for (var k = 0; k < st.debris.length; k++) {
          var d = st.debris[k];
          drawPiece(g, d.x, d.y + cam, d.w, d.h, d.tint, d.emoji, 0.85, d.rot, false);
        }
        // Hook, rope and the hanging piece.
        g.circle(CX, HOOK_Y, 8, ro.ink, 0.6);
        g.circle(CX, HOOK_Y, 5, ro.light, 1);
        if (st.falling) {
          drawPiece(g, st.falling.x, st.falling.y, st.falling.w, H, st.falling.tint, st.falling.emoji, 1, 0, false);
        } else if (!m.hidden && !st.over) {
          var dy = m.motion === "swing" ? (1 - dcos(m.phase - 0.25)) * 14 : 0;
          var py = HANG_Y - dy;
          if (m.motion === "swing") g.line(CX, HOOK_Y, m.x, py - H / 2, ro.ink, { width: 2, alpha: 0.4 });
          else {
            g.pill(20, HOOK_Y + 36, W - 40, 6, { fill: ro.ink, alpha: 0.15, radius: 3 });
            g.line(m.x, HOOK_Y + 40, m.x, py - H / 2, ro.ink, { width: 2, alpha: 0.4 });
          }
          drawPiece(g, m.x, py, m.w, H, st.next, m.emoji, 1, m.motion === "swing" ? (m.x - CX) / 900 : 0, false);
          // Drop guide.
          dots(g, m.x, py + H / 2 + 8, m.x, screenTop() - 6, 10, 1.6, ro.ink, 0.25);
        }
      });
      sdk.layer(40, function (g) {
        var ro = roles(g.palette);
        drawProgress(g, st.hits + " / " + st.goal);
        if (st.last && sdk.tick - st.last.at < 40) {
          var t = (sdk.tick - st.last.at) / 40;
          g.text(st.last.label, CX, 300 - t * 18, { size: st.last.perfect ? 30 : 24, weight: 900, color: ro.ink, alpha: 1 - t * t, glow: st.last.perfect ? ro.accent : true });
        }
      });
    }
  });

  B.defineConcept({
    id: "score.precision", kind: "score", version: 1, formulas: ["time"],
    describe: "Precision points: each hit scores `points` × precision (1 at dead center or for a perfect stack drop, down to 0.15 at the edge of the window), plus `perfect_bonus` for a perfect. Perfects in a row multiply (×2, then ×3).",
    examples: ["up to 100 a stop, +25 and a sparkle for a perfect"],
    params: {
      points: { type: "integer", default: 100, min: 10, max: 500, describe: "Points for a dead-center hit." },
      perfect_bonus: { type: "integer", default: 25, min: 0, max: 200, describe: "Extra points for a perfect hit." },
      perfect_streak: { type: "boolean", default: true, describe: "Perfects in a row multiply the hit (×2, then ×3)." }
    },
    consumes: ["rule.hit"], emits: [], requires: ["rule.timing_window|rule.timing_stack"], conflicts: [],
    tags: { competition: ["friendly", "competitive"] },
    glue: ["score"],
    setup: function (sdk, params) {
      var st = sdk.state.timing_score = { last: 0, best: 0 };
      var fn = sdk.glue && sdk.glue("score");
      sdk.on("rule.hit", function (e) {
        var base = Math.round(params.points * e.precision) + (e.perfect ? params.perfect_bonus : 0);
        var mult = params.perfect_streak && e.perfect && e.streak >= 2 ? Math.min(3, e.streak) : 1;
        var pts = base * mult;
        if (fn) {
          var out;
          try { out = fn({ base: pts, precision: e.precision, perfect: e.perfect, streak: e.streak, index: e.index, multiplier: mult }); } catch (err) { out = undefined; }
          if (typeof out === "number" && isFinite(out)) pts = clamp(Math.round(out), 0, 100000);
        }
        st.last = pts; st.best = Math.max(st.best, pts);
        sdk.addScore(pts, { x: e.x, y: e.y - 40 });
        if (mult > 1) sdk.fx.float("×" + mult, e.x + 40, e.y - 64, null);
      });
    }
  });

  // ---- validation, bot, share ------------------------------------------------------------------
  function validateContent(content, manifest) {
    var out = [];
    function bad(message, path, warning) { out.push({ code: "content", message: message, path: "content" + (path || ""), warning: !!warning }); }
    if (!content || typeof content !== "object") { bad("content must be an object with mover"); return out; }
    if (!isStr(content.mover)) bad("mover is required: an emoji (or a 1–2 character label) for the thing you time", ".mover");
    else if (content.mover.length > 12) bad("mover must be an emoji or a very short label (12 characters max)", ".mover");
    if (content.stops != null) {
      if (!Array.isArray(content.stops) || !content.stops.length || content.stops.some(function (s) { return !isStr(s) || s.length > 18; })) bad("stops must be a list of short target names (18 characters max)", ".stops");
    }
    if (content.pieces != null) {
      if (!Array.isArray(content.pieces) || !content.pieces.length || content.pieces.some(function (s) { return !isStr(s) || s.length > 12; })) bad("pieces must be a list of emoji (or tiny labels)", ".pieces");
    }
    if (content.target_label != null && (typeof content.target_label !== "string" || content.target_label.length > 18)) bad("target_label must be a short string (18 characters max)", ".target_label");
    var uses = {};
    if (manifest && Array.isArray(manifest.concepts)) manifest.concepts.forEach(function (c) { if (c && c.use) uses[c.use] = c; });
    if (uses["rule.timing_window"] && content.stops == null && !isStr(content.target_label)) bad("rule.timing_window reads best with stops (target names) or target_label", ".stops", true);
    return out;
  }

  // The bot looks ahead along the mover's path and taps when it will line up, with timing noise
  // that shrinks with skill.
  function decide(sdk) {
    var st = sdk.state.timing, m = sdk.state.timing_mover;
    if (!st || !m || st.over) return [];
    var mem = botMem(sdk);
    var skill = skillOf(sdk);
    function rnd() { return sdk.botRng(); }
    var ready = st.mode === "stack" ? st.state === "swing" : st.state === "run" && sdk.tick >= st.cooldown;
    if (!ready) { mem.plan = null; return []; }
    var key = st.mode + ":" + st.hits + ":" + st.marks.length + ":" + (st.mode === "catch" ? Math.round(st.target * 10) : st.stack.length);
    if (!mem.plan || mem.plan.key !== key) {
      // Where we want the mover to be.
      var goal = st.mode === "stack" ? st.stack[st.stack.length - 1].x : st.target;
      var amp = m.amp, motion = m.motion;
      var best = -1, bestD = Infinity, prevD = Infinity;
      var tol = st.mode === "stack" ? 6 : 8;
      var wait = Math.round((0.35 - 0.25 * skill) * 60 * (0.5 + rnd()));
      for (var k = wait; k < wait + 300; k++) {
        var ph = m.phase + m.speed * k / 60;
        var v = wave(motion === "pulse" ? "slide" : motion, ph);
        var p = motion === "pulse" ? m.rMin + (m.rMax - m.rMin) * (v + 1) / 2 : CX + amp * v;
        var d = Math.abs(p - goal);
        if (d < bestD) { bestD = d; best = k; }
        // Take the first close approach rather than waiting for a perfect one.
        if (d > prevD && prevD < tol) break;
        prevD = d;
      }
      // Timing error in ticks: an approximate bell curve (sum of uniforms), wider for weak bots.
      var sigma = 0.35 + (1 - skill) * (1 - skill) * 7;
      var noise = (rnd() + rnd() + rnd() - 1.5) * 2 * sigma;
      if (rnd() < 0.05 * (1 - skill)) noise += (rnd() < 0.5 ? -1 : 1) * (8 + rnd() * 10);
      mem.plan = { key: key, at: sdk.tick + Math.max(0, best + Math.round(noise)) };
    }
    if (sdk.tick >= mem.plan.at) {
      mem.plan.at = Infinity;
      return [{ a: "tap", v: [CX + Math.round((rnd() - 0.5) * 120), 470 + Math.round(rnd() * 80)] }];
    }
    return [];
  }

  function share(sdk) {
    var st = sdk.state.timing;
    var mf = sdk.manifest || {};
    var title = (mf.style && mf.style.emoji ? mf.style.emoji + " " : "") + (mf.title || "Bubble");
    if (!st) return { headline: title, score_text: sdk.score + " points" };
    var rows = [];
    for (var i = 0; i < st.marks.length; i += 8) rows.push(st.marks.slice(i, i + 8).join(""));
    var unit = st.mode === "stack" ? (sdk.content && isStr(sdk.content.goal_label) ? sdk.content.goal_label : "high") : "caught";
    var text = sdk.score + " points · " + st.hits + (st.mode === "stack" ? " " + unit : "/" + st.goal + " " + unit) + (st.perfects ? " · " + st.perfects + " perfect" : "");
    return { headline: title, score_text: text, emoji_grid: rows.join("\n") };
  }

  B.defineFormula({
    id: "time", title: "Timing",
    describe: "Tap at the right moment. A mover slides, swings or pulses; tap when it lines up with a target (rule.timing_window: catch the cable car at its stop, match the ring) or drop it onto a growing stack where only the overlap stays (rule.timing_stack: stack loaves, pancakes, postcards). Precision scoring with a sparkle on perfect hits; the mover speeds up as you go. A run is 6–30 taps, 15–60 seconds.",
    core: ["space.timing_stage", "entity.timing_mover", "input.tap", "rule.timing_window|rule.timing_stack", "score.precision"],
    optional: ["rule.lives", "behavior.speed_ramp", "flow.run_retry", "flow.daily_gate", "share.emoji_grid", "share.score_card", "feel.mood_preset", "social.beat_marker"],
    tips: [
      "Catch games: entity.timing_mover motion slide (a vehicle on a line) or pulse (a ring), rule.timing_window, and rule.lives (lives 3, grace 0) so misses matter.",
      "Stack games: motion swing (a pendulum from a hook) or slide, rule.timing_stack, and content.pieces emoji. Without rule.lives one full miss ends the run.",
      "Speed 0.35–0.5 with ramp 0.04–0.06 feels fair; raise window or perfect for a chill crowd.",
      "Keep the mover emoji readable at 40 points: one vehicle, food or object."
    ],
    content: {
      describe: "mover: the emoji you time (e.g. \"🚋\"). Catch games: stops, a list of target names cycled as you hit them (e.g. SF cable car stops), or one target_label. Stack games: pieces, a list of emoji cycled per piece (e.g. [\"🍞\", \"🥐\", \"🥖\"]), and optional goal_label for the share text (e.g. \"loaves\").",
      schema: {
        type: "object", required: ["mover"],
        properties: {
          mover: { type: "string", minLength: 1, maxLength: 12 },
          stops: { type: "array", minItems: 1, maxItems: 30, items: { type: "string", minLength: 1, maxLength: 18 } },
          pieces: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 12 } },
          target_label: { type: "string", maxLength: 18 },
          goal_label: { type: "string", maxLength: 16 }
        }
      }
    },
    validateContent: validateContent,
    bot: { describe: "Looks ahead along the mover's path and taps when it will line up; timing noise shrinks from about ±7 ticks at skill 0 to under ±1 at skill 1, with rare fumbles for weak bots.", decide: decide },
    share: share,
    example: {
      id: "example-time-catch", version: 1, engine_version: 1,
      title: "Ferry Hop",
      one_line_rule: "Tap when the ferry lines up with the pier.",
      formula: "time",
      brief: { intent: "a quick timing game about the bay", audience: "everyone", mood: ["playful"], energy: "high", competition: "friendly" },
      structure: { cadence: "endless", scope: "everyone", setter: "ai" },
      lineage: { parent: null, operators: [], remix_of: null },
      chain: null,
      style: { look: "ink", palette: "sky-glow", font: "hand", motif: "waves", emoji: "⛴️", mood_preset: "playful" },
      concepts: [
        { use: "space.timing_stage", params: { backdrop: "auto" } },
        { use: "entity.timing_mover", params: { motion: "slide", speed: 0.42 } },
        { use: "input.tap" },
        { use: "rule.timing_window", params: { targets: 12, window: 30 } },
        { use: "rule.lives", params: { lives: 3, grace: 0 } },
        { use: "score.precision" },
        { use: "flow.run_retry" },
        { use: "share.emoji_grid" }
      ],
      glue: {},
      content: { mover: "⛴️", stops: ["Ferry Building", "Pier 39", "Sausalito", "Angel Island", "Alameda"] },
      seed: 7070
    }
  });
})();
