// Bubble kit: group. See docs/BUBBLES.md, 4.6. Kits only call Bubble.defineFormula and Bubble.defineConcept.
//
// Sort into groups. Labeled bubbles drift up from the bay; tap one and then a glowing bin (or drag
// or flick it down into a bin) to sort it. A wrong bin or a bubble that floats away is a miss;
// right sorts in a row build a streak multiplier. The run succeeds when every bubble is sorted.
//
// Reuses the common kit: rule.lives (a miss emits entity.hit), rule.timer (an endless deck against
// the clock), behavior.speed_ramp (state.pace), share.emoji_grid (state.share_rows).
//
// State: state.sort_bins (space), state.sort_field (bubbles), state.sort_rule (judging, marks),
// state.sort_score (multiplier).
(function () {
  "use strict";
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var B = root.Bubble;
  if (!B || typeof B.defineConcept !== "function" || typeof B.defineFormula !== "function") return;

  var W = 360;
  var BIN_TOP = 506, BIN_H = 114, ESCAPE_Y = 98, SPAWN_Y = 462;
  var LANES = [70, 180, 290];
  var MARK = { hit: "✨", wrong: "💥", escaped: "💨" };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function isStr(v) { return typeof v === "string" && v.trim().length > 0; }
  // Deterministic sine (argument in turns): only + - * / and floor, so every engine agrees bit for bit.
  function dsin(t) {
    var x = t - Math.floor(t);
    if (x >= 0.5) x -= 1;
    if (x > 0.25) x = 0.5 - x; else if (x < -0.25) x = -0.5 - x;
    var a = x * 6.283185307179586, a2 = a * a;
    return a * (1 - a2 / 6 * (1 - a2 / 20 * (1 - a2 / 42 * (1 - a2 / 72 * (1 - a2 / 110)))));
  }
  function skillOf(sdk) {
    var s = sdk.botSkill;
    if (typeof s !== "number" && sdk.bot && typeof sdk.bot.skill === "number") s = sdk.bot.skill;
    if (typeof s !== "number" && typeof sdk.bot_skill === "number") s = sdk.bot_skill;
    return clamp(typeof s === "number" && isFinite(s) ? s : 0.7, 0, 1);
  }
  var memo = typeof WeakMap === "function" ? new WeakMap() : null;
  function botMem(sdk) {
    if (sdk.botState && typeof sdk.botState === "object") {
      var bs = sdk.botState;
      if (!bs.sort || sdk.tick < bs.sort.lastTick) bs.sort = { lastTick: 0, step: "idle" };
      bs.sort.lastTick = sdk.tick;
      return bs.sort;
    }
    var key = sdk.state;
    var m = memo ? memo.get(key) : key.__sortBot;
    if (!m || sdk.tick < m.lastTick) {
      m = { lastTick: 0, step: "idle" };
      if (memo) memo.set(key, m); else key.__sortBot = m;
    }
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
  // Ink for text drawn on a bubble or bin of color `fill`. Glow bubbles are see-through and
  // neon ones dark inside, and ink/chalk only outline, so the palette ink reads there; the solid
  // looks (paper, pixel, clay, riso) need the ink that reads on the fill itself.
  function inkFor(g, ro, fill) {
    var lk = lookOf(g);
    return lk === "glow" || lk === "neon" || lk === "ink" || lk === "chalk" ? ro.ink : ro.inkOn(fill);
  }
  // A rounded-rectangle outline. The glow look strokes a pill with no fill; the other looks only
  // draw filled pills, so there the outline is g.line segments (corners as short chords) and
  // comes out in the look's own line style.
  function roundOutline(g, x, y, w, h, r, color, width, alpha) {
    if (lookOf(g) === "glow") { g.pill(x, y, w, h, { fill: null, stroke: color, strokeWidth: width, radius: r, alpha: alpha }); return; }
    r = Math.min(r, w / 2, h / 2);
    var o = { width: width, alpha: alpha, cap: "round" }, Q = Math.PI / 2, N = 4;
    g.line(x + r, y, x + w - r, y, color, o);
    g.line(x + w, y + r, x + w, y + h - r, color, o);
    g.line(x + w - r, y + h, x + r, y + h, color, o);
    g.line(x, y + h - r, x, y + r, color, o);
    var cx = [x + w - r, x + w - r, x + r, x + r], cy = [y + r, y + h - r, y + h - r, y + r];
    for (var c = 0; c < 4; c++) {
      var a0 = (c - 1) * Q, px = cx[c] + r * Math.cos(a0), py = cy[c] + r * Math.sin(a0);
      for (var k = 1; k <= N; k++) {
        var a = a0 + Q * k / N, nx = cx[c] + r * Math.cos(a), ny = cy[c] + r * Math.sin(a);
        g.line(px, py, nx, ny, color, o);
        px = nx; py = ny;
      }
    }
  }
  // Outline color: the look's own line color, else white glass in soft looks and ink elsewhere.
  function edge(g, ro) { return ro.line || (glossy(g) ? ro.surface : ro.ink); }
  function groupsOf(content) {
    var gs = content && Array.isArray(content.groups) ? content.groups : [];
    return gs.slice(0, 4).map(function (g) {
      return {
        label: isStr(g && g.label) ? String(g.label) : "",
        emoji: isStr(g && g.emoji) ? String(g.emoji) : "",
        items: (g && Array.isArray(g.items) ? g.items : []).filter(isStr).map(String)
      };
    }).filter(function (g) { return g.label && g.items.length; });
  }
  function binLayout(n) {
    var gap = 8, margin = 12;
    var w = (W - 2 * margin - gap * (n - 1)) / n;
    var out = [];
    for (var i = 0; i < n; i++) out.push({ x: margin + i * (w + gap), y: BIN_TOP, w: w, h: BIN_H, cx: margin + i * (w + gap) + w / 2 });
    return out;
  }
  function binAt(bins, x, y, slop) {
    if (y < BIN_TOP - slop) return -1;
    for (var i = 0; i < bins.length; i++) if (x >= bins[i].x - 4 && x <= bins[i].x + bins[i].w + 4) return i;
    return x < bins[0].x ? 0 : bins.length - 1;
  }
  function nearestBin(bins, x) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < bins.length; i++) { var d = Math.abs(bins[i].cx - x); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  function radiusFor(label) {
    var n = label.length;
    return n <= 6 ? 34 : n <= 11 ? 39 : 43;
  }

  // Render-only text wrapping in the look's font.
  function wrap2(g, text, size, maxW) {
    if (g.wrapText) return g.wrapText(String(text), maxW, size, 800);
    return [String(text)];
  }
  function bubbleLabel(g, text, x, y, r, color, alpha) {
    var size = r >= 42 ? 15 : r >= 38 ? 15 : 16;
    var lines = wrap2(g, text, size, r * 1.55);
    while (lines.length > 2 && size > 11) { size -= 1; lines = wrap2(g, text, size, r * 1.55); }
    var lh = size * 1.12;
    for (var i = 0; i < lines.length; i++) {
      g.text(lines[i], x, y - (lines.length - 1) * lh / 2 + i * lh, { size: size, weight: 800, color: color, alpha: alpha, maxWidth: r * 1.7 });
    }
  }

  // ---- concepts --------------------------------------------------------------------------------

  B.defineConcept({
    id: "space.sort_bins", kind: "space", version: 1, formulas: ["group"],
    describe: "The sorting stage: 2–4 bins along the bottom, one per content group (label and optional emoji), with an open sky above where bubbles rise. Each bin fills with little orbs as you sort into it; a bubble that reaches the top floats away.",
    examples: ["3 bins: neighborhood, food, landmark", "2 bins: true or myth", "4 bins: one per newcomer's hometown"],
    params: {
      show_counts: { type: "boolean", default: true, describe: "Fill each bin with a small orb per right sort." }
    },
    consumes: [], emits: [], requires: ["entity.sort_bubble"], conflicts: [],
    tags: { mood: ["curious", "playful"], energy: ["medium", "high"] },
    glue: [],
    setup: function (sdk, params) {
      var groups = groupsOf(sdk.content);
      var st = sdk.state.sort_bins = { bins: binLayout(Math.max(2, groups.length)), groups: groups, escapeY: ESCAPE_Y, top: BIN_TOP, flash: [], showCounts: params.show_counts };
      st.bins.forEach(function (b, i) { b.group = i; b.label = groups[i] ? groups[i].label : ""; b.emoji = groups[i] ? groups[i].emoji : ""; st.flash[i] = { at: -100, good: true }; });
      sdk.on("rule.hit", function (e) { if (st.flash[e.bin]) st.flash[e.bin] = { at: sdk.tick, good: true }; });
      sdk.on("rule.miss", function (e) { if (e.bin >= 0 && st.flash[e.bin]) st.flash[e.bin] = { at: sdk.tick, good: false }; });

      sdk.layer(10, function (g) {
        var ro = roles(g.palette);
        // The sky line where bubbles float away: a soft band and a dotted line.
        g.pill(-10, ESCAPE_Y - 14, W + 20, 28, { fill: ro.light, alpha: ro.dark ? 0.08 : 0.22, radius: 14 });
        for (var dx = 18; dx <= W - 18; dx += 11) g.circle(dx, ESCAPE_Y, 1.6, glossy(g) ? ro.light : ro.ink, glossy(g) ? 0.95 : 0.35);
        var field = sdk.state.sort_field;
        var selecting = field && field.selected >= 0;
        var rule = sdk.state.sort_rule;
        for (var i = 0; i < st.bins.length; i++) {
          var b = st.bins[i];
          var col = ro.series[i % ro.series.length];
          var f = st.flash[i];
          var since = sdk.tick - f.at;
          var pulse = since >= 0 && since < 24 ? 1 - since / 24 : 0;
          var shake = !f.good && pulse > 0 ? dsin(since / 8) * 5 * pulse : 0;
          var hint = selecting ? 0.5 + 0.5 * Math.sin(g.t * 6 + i) : 0;
          var bx = b.x + shake;
          // Soft looks get see-through glass bins; flat looks (paper, pixel, ink...) solid ones.
          var binAlpha = lookOf(g) === "glow" ? (ro.dark ? 0.34 : 0.5) + 0.2 * pulse * (f.good ? 1 : 0) : 0.94;
          g.pill(bx, b.y, b.w, b.h, { fill: col, alpha: binAlpha, radius: 26, glow: Math.max(pulse, hint * 0.6), glowColor: f.good ? col : ro.danger });
          // Glass bins get a lit rim; solid bins already have the look's own edge. A miss flashes
          // the rim in the danger color in every look.
          if (!f.good && pulse > 0) roundOutline(g, bx, b.y, b.w, b.h, 26, ro.danger, 3, 1);
          else if (lookOf(g) === "glow") roundOutline(g, bx, b.y, b.w, b.h, 26, edge(g, ro), 2.5, 0.7 + 0.3 * hint);
          // Mouth highlight.
          if (glossy(g)) g.pill(bx + 10, b.y + 6, b.w - 20, 7, { fill: ro.light, alpha: 0.7, radius: 4 });
          // Sorted orbs inside.
          if (st.showCounts && rule && rule.binCounts) {
            var cnt = Math.min(rule.binCounts[i] || 0, 12);
            var per = Math.max(1, Math.floor((b.w - 16) / 15));
            for (var k = 0; k < cnt; k++) {
              var row = Math.floor(k / per), colm = k % per;
              g.orb(bx + 8 + 7.5 + colm * 15, b.y + b.h - 44 - row * 13, 5.5, lookOf(g) === "glow" ? ro.light : inkFor(g, ro, col), { glow: 0.6, alpha: lookOf(g) === "glow" ? 0.95 : 0.6 });
            }
          }
          if (b.emoji) g.emoji(b.emoji, bx + b.w / 2, b.y + 36, 26);
          g.text(b.label, bx + b.w / 2, b.y + b.h - 20, { size: b.w < 90 ? 13 : 15, weight: 800, color: inkFor(g, ro, col), maxWidth: b.w - 12, glow: true });
          if (f.good === false && pulse > 0.4) g.text("✕", bx + b.w / 2, b.y - 16, { size: 20, weight: 900, color: ro.danger, alpha: pulse });
        }
      });
    }
  });

  B.defineConcept({
    id: "entity.sort_bubble", kind: "entity", version: 1, formulas: ["group"],
    describe: "The labeled bubbles to sort. Deals every content item once in a seeded random order (or `deal` of them; endlessly reshuffled when rule.timer runs the clock); each one bloops up from just above the bins and drifts up with a gentle sway in one of three lanes. Bubbles are tinted at random, never by group, so color is no hint. Rise and arrival speed follow state.pace (behavior.speed_ramp).",
    examples: ["slow, chill drift for a cozy Group", "fast rise with 5 on screen for a frantic one"],
    params: {
      rise_speed: { type: "number", default: 32, min: 15, max: 80, describe: "Rise speed in points per second at the start (32 crosses the screen in about 11 s)." },
      spawn_every: { type: "number", default: 1.9, min: 0.8, max: 4, describe: "Seconds between new bubbles at the start." },
      max_on_screen: { type: "integer", default: 4, min: 1, max: 6, describe: "Most bubbles floating at once; new ones wait." },
      sway: { type: "number", default: 0.5, min: 0, max: 1, describe: "Side-to-side drift (0 = straight up)." },
      deal: { type: "integer", default: 0, min: 0, max: 30, describe: "How many items one run deals (a seeded sample). 0 = every item once. Keep runs at 8–20 bubbles." }
    },
    consumes: ["clock.tick", "input.sort"], emits: ["entity.spawned", "entity.escaped", "entity.sorted"], requires: ["space.sort_bins"], conflicts: [],
    tags: { energy: ["low", "medium", "high"] },
    state: "sort_field: {bubbles: [{id, label, group, x, y, r}], selected, held, dealt, total}",
    glue: ["spawn"],
    setup: function (sdk, params) {
      var groups = groupsOf(sdk.content);
      var items = [];
      groups.forEach(function (g, gi) { g.items.forEach(function (label) { items.push({ label: label, group: gi }); }); });
      var endless = sdk.has("rule.timer");
      function freshDeck() {
        var idx = [];
        for (var i = 0; i < items.length; i++) idx.push(i);
        idx = sdk.shuffle(idx);
        var n = Math.floor(num(params.deal, 0));
        if (n > 0 && !endless) idx = idx.slice(0, Math.min(n, idx.length));
        return idx;
      }
      var f = sdk.state.sort_field = {
        items: items, bubbles: [], flying: [], deck: freshDeck(), dealt: 0, total: 0, nextId: 1,
        nextSpawn: 18, selected: -1, held: -1, downX: 0, downY: 0, downTick: 0, lastLane: -1,
        baseSpeed: params.rise_speed, baseEvery: params.spawn_every, endless: endless
      };
      f.total = endless ? 0 : f.deck.length;
      var swayAmp = 13 * clamp(params.sway, 0, 1);
      var spawnGlue = sdk.glue && sdk.glue("spawn");

      // behavior.speed_ramp (common) raises state.pace over time; bubbles rise and arrive faster.
      function scale() { var p = sdk.state.pace; return typeof p === "number" && p > 0 ? p : 1; }
      function byId(id) { for (var i = 0; i < f.bubbles.length; i++) if (f.bubbles[i].id === id) return f.bubbles[i]; return null; }

      function spawn() {
        if (!f.deck.length) {
          if (!endless) return;
          f.deck = freshDeck();
        }
        var item = items[f.deck.shift()];
        var lanes = [];
        for (var l = 0; l < LANES.length; l++) if (l !== f.lastLane) lanes.push(l);
        // Prefer a lane whose last bubble has risen clear of the spawn point.
        var free = lanes.filter(function (ln) {
          return !f.bubbles.some(function (bb) { return bb.lane === ln && bb.y > SPAWN_Y - 100; });
        });
        var lane = (free.length ? free : lanes)[Math.floor(sdk.rng() * (free.length ? free.length : lanes.length))];
        f.lastLane = lane;
        var r = radiusFor(item.label);
        var speed = f.baseSpeed;
        var x = LANES[lane];
        if (spawnGlue) {
          var out = spawnGlue({ index: f.dealt, label: item.label, group: item.group, speed: speed, x: x, total: f.total });
          if (out && typeof out === "object") {
            if (typeof out.speed === "number" && isFinite(out.speed)) speed = clamp(out.speed, 10, 120);
            if (typeof out.x === "number" && isFinite(out.x)) x = clamp(out.x, 50, W - 50);
          }
        }
        var b = { id: f.nextId++, label: item.label, group: item.group, lane: lane, baseX: x, x: x, y: SPAWN_Y, r: r, speed: speed, phase: sdk.rng(), born: sdk.tick, swayT0: sdk.tick, tint: Math.floor(sdk.rng() * 4) };
        f.bubbles.push(b);
        f.dealt += 1;
        sdk.emit("entity.spawned", { id: b.id, label: b.label, group: b.group });
        sdk.fx.sound("blip");
      }

      sdk.on("clock.tick", function () {
        var s = scale();
        var dt = sdk.dt;
        // Spawn on a timer, but never more than max_on_screen at once.
        if (sdk.tick >= f.nextSpawn && (endless || f.deck.length) && f.bubbles.length < params.max_on_screen) {
          spawn();
          f.nextSpawn = sdk.tick + Math.max(24, Math.round(f.baseEvery * 60 / s));
        }
        for (var i = f.bubbles.length - 1; i >= 0; i--) {
          var b = f.bubbles[i];
          if (b.id === f.held) continue;
          var age = (sdk.tick - b.swayT0) / 60;
          b.y -= b.speed * s * dt;
          b.x = b.baseX + dsin(b.phase + age * 0.28) * swayAmp;
          if (b.y - b.r * 0.4 <= ESCAPE_Y) {
            f.bubbles.splice(i, 1);
            if (f.selected === b.id) f.selected = -1;
            sdk.emit("entity.escaped", { id: b.id, label: b.label, group: b.group, x: b.x, y: b.y });
          }
        }
        for (var j = f.flying.length - 1; j >= 0; j--) if (sdk.tick - f.flying[j].t0 > f.flying[j].dur + 2) f.flying.splice(j, 1);
      });

      sdk.on("input.sort", function (e) {
        var b = byId(e.id);
        if (!b) return;
        var bins = sdk.state.sort_bins.bins;
        var bin = clamp(Math.floor(num(e.bin, 0)), 0, bins.length - 1);
        f.bubbles.splice(f.bubbles.indexOf(b), 1);
        if (f.selected === b.id) f.selected = -1;
        if (f.held === b.id) f.held = -1;
        var good = b.group === bins[bin].group;
        f.flying.push({ id: b.id, label: b.label, x0: b.x, y0: b.y, x1: bins[bin].cx, y1: BIN_TOP + 26, r: b.r, t0: sdk.tick, dur: 10, good: good, tint: b.tint });
        sdk.emit("entity.sorted", { id: b.id, label: b.label, group: b.group, bin: bin, good: good, x: bins[bin].cx, y: BIN_TOP + 20, via: e.via || "tap" });
      });

      sdk.layer(20, function (g) {
        var ro = roles(g.palette);
        if (g.poster && !f.bubbles.length) {
          // Poster frame (cards, feed): show the first few items of the deal mid-rise.
          var spots = [[LANES[0], 330], [LANES[2], 250], [LANES[1], 400]];
          for (var pi = 0; pi < spots.length && pi < f.deck.length; pi++) {
            var it = items[f.deck[pi]], pr = radiusFor(it.label);
            var ptint = ro.series[(pi + 1) % ro.series.length];
            g.bubble(spots[pi][0], spots[pi][1], pr, { tint: ptint, wobble: 1, glow: 1 });
            bubbleLabel(g, it.label, spots[pi][0], spots[pi][1], pr, inkFor(g, ro, ptint), 1);
          }
        }
        for (var i = 0; i < f.bubbles.length; i++) {
          var b = f.bubbles[i];
          var age = sdk.tick - b.born;
          var grow = age < 14 ? 0.3 + 0.7 * (1 - Math.pow(1 - age / 14, 3)) + Math.sin(age / 14 * Math.PI) * 0.12 : 1;
          var sel = b.id === f.selected, held = b.id === f.held;
          var r = b.r * grow * (sel ? 1.08 : 1) * (held ? 1.12 : 1);
          // Bubbles near the top glow in the danger color: they're about to float away.
          var danger = clamp(1 - (b.y - ESCAPE_Y - b.r) / 90, 0, 1);
          if (danger > 0) g.orb(b.x, b.y, r + 6, ro.danger, { alpha: 0.3 * danger * (0.6 + 0.4 * Math.sin(g.t * 10)), glow: 1 });
          if (sel) {
            // A ring of dots that turns slowly around the picked bubble.
            var spin = g.t * 0.8;
            for (var d = 0; d < 14; d++) {
              var ang = (d / 14 + spin) * Math.PI * 2;
              g.circle(b.x + Math.cos(ang) * (r + 8), b.y + Math.sin(ang) * (r + 8), 2.2, glossy(g) ? ro.light : ro.ink, 0.95);
            }
          }
          var btint = ro.series[b.tint % ro.series.length];
          g.bubble(b.x, b.y, r, { tint: btint, wobble: 1, glow: 1 });
          bubbleLabel(g, b.label, b.x, b.y, r, inkFor(g, ro, btint), 1);
        }
        for (var k = 0; k < f.flying.length; k++) {
          var fl = f.flying[k];
          var t = clamp((sdk.tick - fl.t0) / fl.dur, 0, 1);
          var e = t * t;
          var x = fl.x0 + (fl.x1 - fl.x0) * e, y = fl.y0 + (fl.y1 - fl.y0) * e;
          if (t < 1) g.bubble(x, y, fl.r * (1 - 0.55 * t), { tint: ro.series[fl.tint % ro.series.length], alpha: 1 - 0.3 * t, glow: 1 });
        }
      });
    }
  });

  B.defineConcept({
    id: "input.sort_gesture", kind: "input", version: 1, formulas: ["group"],
    describe: "Sort with any of three gestures: tap a bubble then tap a bin, drag a bubble onto a bin, or flick it down toward a bin. A held bubble stops rising. Emits input.sort {id, bin, via}.",
    examples: ["tap, then tap the bin", "flick it down into the right bin"],
    params: {
      flick: { type: "boolean", default: true, describe: "Allow flicking a bubble down toward a bin (aimed along the flick)." }
    },
    consumes: ["pointer.down", "pointer.move", "pointer.up"], emits: ["input.sort", "input.pick"], requires: ["entity.sort_bubble"], conflicts: [],
    tags: { energy: ["medium", "high"] }, glue: [],
    setup: function (sdk, params) {
      function field() { return sdk.state.sort_field; }
      function hit(x, y) {
        var f = field(), best = null, bd = Infinity;
        for (var i = 0; i < f.bubbles.length; i++) {
          var b = f.bubbles[i];
          var dx = x - b.x, dy = y - b.y, d2 = dx * dx + dy * dy, rr = b.r + 10;
          if (d2 <= rr * rr && d2 < bd) { best = b; bd = d2; }
        }
        return best;
      }
      sdk.on("pointer.down", function (p) {
        var f = field();
        if (!f) return;
        var bins = sdk.state.sort_bins.bins;
        var b = p.y < BIN_TOP - 4 ? hit(p.x, p.y) : null;
        if (b) {
          f.held = b.id; f.selected = b.id;
          f.downX = p.x; f.downY = p.y; f.downTick = sdk.tick;
          f.grabDX = b.x - p.x; f.grabDY = b.y - p.y;
          sdk.emit("input.pick", { id: b.id });
          sdk.fx.sound("tick");
          sdk.fx.haptic("selection");
          return;
        }
        if (f.selected >= 0) {
          var bin = binAt(bins, p.x, p.y, 28);
          if (bin >= 0) { sdk.emit("input.sort", { id: f.selected, bin: bin, via: "tap" }); return; }
          f.selected = -1;
        }
      });
      sdk.on("pointer.move", function (p) {
        var f = field();
        if (!f || f.held < 0) return;
        for (var i = 0; i < f.bubbles.length; i++) {
          var b = f.bubbles[i];
          if (b.id !== f.held) continue;
          b.x = clamp(p.x + f.grabDX, 30, W - 30);
          b.y = clamp(p.y + f.grabDY, ESCAPE_Y + b.r * 0.5, BIN_TOP + 30);
          b.baseX = b.x;
          b.phase = 0;
          b.swayT0 = sdk.tick;
        }
      });
      sdk.on("pointer.up", function (p) {
        var f = field();
        if (!f || f.held < 0) return;
        var id = f.held;
        f.held = -1;
        var bins = sdk.state.sort_bins.bins;
        var dx = p.x - f.downX, dy = p.y - f.downY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (p.y >= BIN_TOP - 16 && dist > 12) {
          sdk.emit("input.sort", { id: id, bin: binAt(bins, p.x, p.y, 40), via: "drag" });
          return;
        }
        if (params.flick && dist >= 28 && dy > 12 && sdk.tick - f.downTick <= 30) {
          var aimX = p.x + dx / dy * (BIN_TOP + 40 - p.y);
          sdk.emit("input.sort", { id: id, bin: nearestBin(bins, clamp(aimX, 0, W)), via: "flick" });
          return;
        }
        // A tap (or a short drag): keep it selected; it floats on from where it is.
        for (var i = 0; i < f.bubbles.length; i++) {
          var b = f.bubbles[i];
          if (b.id === id) { b.baseX = b.x; b.phase = 0; b.swayT0 = sdk.tick; }
        }
      });
    }
  });

  B.defineConcept({
    id: "rule.sort_match", kind: "rule", version: 1, formulas: ["group"],
    describe: "Judges every sort: the right bin is a hit and grows the streak; a wrong bin, or a bubble that floats off the top, is a miss that resets the streak and emits entity.hit (so rule.lives takes a life). Succeeds when every dealt bubble is resolved; with rule.timer the deck never runs out and the clock ends the run instead.",
    examples: ["sort all 15 SF spots; 3 lives (rule.lives)", "forgiving: only wrong bins cost a life, escapes are free"],
    params: {
      escape_costs_life: { type: "boolean", default: true, describe: "Whether a bubble that floats away costs a life like a wrong bin (false = only wrong bins do)." }
    },
    consumes: ["entity.sorted", "entity.escaped", "clock.tick"], emits: ["rule.hit", "rule.miss", "entity.hit", "rule.success"],
    requires: ["entity.sort_bubble", "input.sort_gesture"], conflicts: [], ends: true,
    state: "sort_rule: {hits, wrong, escaped, streak, best_streak, marks}",
    tags: { competition: ["light", "friendly", "competitive"] },
    glue: [],
    setup: function (sdk, params) {
      var st = sdk.state.sort_rule = { hits: 0, wrong: 0, escaped: 0, streak: 0, bestStreak: 0, marks: [], rows: [], binCounts: [0, 0, 0, 0], over: false };
      function mark(m) {
        st.marks.push(m === "hit" ? MARK.hit : m === "miss" ? MARK.wrong : MARK.escaped);
        st.rows.push(m);
      }
      function lose(reason, e) {
        st.streak = 0;
        if (reason === "escaped") { st.escaped += 1; mark("skip"); } else { st.wrong += 1; mark("miss"); }
        sdk.emit("rule.miss", { id: e.id, bin: reason === "escaped" ? -1 : e.bin, group: e.group, reason: reason });
        if (reason !== "escaped" || params.escape_costs_life) sdk.emit("entity.hit", { x: e.x, y: reason === "escaped" ? ESCAPE_Y + 20 : e.y, reason: reason });
        if (reason === "escaped") { sdk.fx.pop(e.x, ESCAPE_Y, null, 10); sdk.fx.sound("whoosh"); }
        else { sdk.fx.pop(e.x, e.y, null, 8); sdk.fx.sound("fail"); sdk.fx.shake(4); }
        sdk.fx.haptic("warning");
      }
      sdk.on("entity.sorted", function (e) {
        if (st.over || sdk.ended) return;
        if (e.good) {
          st.hits += 1; st.streak += 1; st.bestStreak = Math.max(st.bestStreak, st.streak);
          st.binCounts[e.bin] = (st.binCounts[e.bin] || 0) + 1;
          mark("hit");
          sdk.emit("rule.hit", { id: e.id, bin: e.bin, group: e.group, label: e.label, streak: st.streak, x: e.x, y: e.y });
          sdk.fx.pop(e.x, e.y, null, 16);
          var big = st.streak > 1 && st.streak % 3 === 0;
          if (big && sdk.fx.sparkle) sdk.fx.sparkle(e.x, e.y - 20, null, 12);
          sdk.fx.sound(big ? "chime" : "pop");
          sdk.fx.haptic(big ? "success" : "light");
        } else lose("wrong_bin", e);
      });
      sdk.on("entity.escaped", function (e) { if (!st.over && !sdk.ended) lose("escaped", e); });
      sdk.on("clock.tick", function () {
        var f = sdk.state.sort_field;
        if (st.over || sdk.ended || !f || f.endless) return;
        if (f.dealt >= f.total && f.bubbles.length === 0 && f.flying.length === 0 && sdk.tick > 30) {
          st.over = true;
          sdk.emit("rule.success", { sorted: st.hits, total: f.total });
          sdk.fx.sound("success");
          sdk.fx.haptic("success");
          sdk.end("success", { sorted: st.hits, total: f.total, delay: 12 });
        }
      });
      // Share rows for share.emoji_grid: six sorts per row.
      sdk.on("flow.phase", function (e) {
        if (e.name !== "fail" && e.name !== "success") return;
        var rows = [];
        for (var i = 0; i < st.rows.length; i += 6) rows.push(st.rows.slice(i, i + 6));
        if (rows.length) sdk.state.share_rows = rows;
      });
      sdk.layer(40, function (g) {
        var f = sdk.state.sort_field;
        if (f && !f.endless && f.total) g.text(Math.min(st.hits + st.wrong + st.escaped, f.total) + "/" + f.total, W - 22, 30, { size: 14, weight: 800, color: g.palette.ink, alpha: 0.8, align: "right" });
      });
    }
  });

  B.defineConcept({
    id: "score.sort_streak", kind: "score", version: 1, formulas: ["group"],
    describe: "Points per right sort times a streak multiplier: every `streak_step` right sorts in a row adds 1× (up to `max_multiplier`); any miss resets it. Lives left at the end (rule.lives) are worth `life_bonus` each. The score glue gets {base, streak, multiplier, group, label}.",
    examples: ["10 a sort, x2 after 3 in a row, x3 after 6"],
    params: {
      points: { type: "integer", default: 10, min: 1, max: 100, describe: "Points for one right sort at 1×." },
      streak_step: { type: "integer", default: 3, min: 2, max: 6, describe: "Right sorts in a row needed for each +1× multiplier." },
      max_multiplier: { type: "integer", default: 4, min: 1, max: 6, describe: "Highest multiplier." },
      life_bonus: { type: "integer", default: 25, min: 0, max: 200, describe: "Points per life left (rule.lives) when the run succeeds." }
    },
    consumes: ["rule.hit", "rule.miss", "rule.success?"], emits: [], requires: ["rule.sort_match"], conflicts: [],
    tags: { competition: ["friendly", "competitive"] },
    state: "sort_score: {mult}",
    glue: ["score"],
    setup: function (sdk, params) {
      var st = sdk.state.sort_score = { mult: 1, bumpAt: -100 };
      var fn = sdk.glue && sdk.glue("score");
      sdk.on("rule.hit", function (e) {
        var mult = Math.min(params.max_multiplier, 1 + Math.floor((e.streak - 1) / params.streak_step));
        if (mult > st.mult) { st.bumpAt = sdk.tick; sdk.fx.float("×" + mult + " streak", e.x, e.y - 70, null); }
        st.mult = mult;
        var base = params.points * mult;
        var pts = base;
        if (fn) {
          var out;
          try { out = fn({ base: base, streak: e.streak, multiplier: mult, group: e.group, label: e.label }); } catch (err) { out = undefined; }
          if (typeof out === "number" && isFinite(out)) pts = clamp(Math.round(out), 0, 100000);
        }
        sdk.addScore(pts, { x: e.x, y: e.y - 30 });
      });
      sdk.on("rule.miss", function () { st.mult = 1; });
      sdk.on("rule.success", function () {
        var lives = sdk.state.lives;
        if (lives && lives.left > 0 && params.life_bonus > 0) sdk.addScore(lives.left * params.life_bonus, { x: W / 2, y: 300 });
      });
      sdk.layer(40, function (g) {
        if (st.mult <= 1) return;
        var ro = roles(g.palette);
        var since = sdk.tick - st.bumpAt;
        var s = since < 16 ? 1 + 0.35 * (1 - since / 16) : 1;
        var cx = W - 40, cy = 62;
        g.pill(cx - 24 * s, cy - 13 * s, 48 * s, 26 * s, { fill: ro.accent, radius: 13 * s, glow: 1, glowColor: ro.accent });
        g.text("×" + st.mult, cx, cy, { size: 15 * s, weight: 900, color: ro.inkOn(ro.accent) });
      });
    }
  });

  // ---- validation, bot, share ------------------------------------------------------------------
  function validateContent(content) {
    var out = [];
    function bad(message, path) { out.push({ code: "content", message: message, path: "content" + (path || "") }); }
    if (!content || typeof content !== "object") { bad("content must be an object with groups"); return out; }
    var gs = content.groups;
    if (!Array.isArray(gs) || gs.length < 2 || gs.length > 4) { bad("groups must have 2–4 groups", ".groups"); return out; }
    var seen = {}, total = 0, labels = {};
    gs.forEach(function (g, i) {
      var p = ".groups[" + i + "]";
      if (!g || typeof g !== "object") { bad("group must be an object", p); return; }
      if (!isStr(g.label)) bad("label is required", p + ".label");
      else {
        if (g.label.length > 16) bad("label is too long for a bin (16 characters max)", p + ".label");
        var lk = g.label.trim().toLowerCase();
        if (labels[lk]) bad("group labels must be different", p + ".label");
        labels[lk] = true;
      }
      if (g.emoji != null && (typeof g.emoji !== "string" || g.emoji.length > 8)) bad("emoji must be one emoji", p + ".emoji");
      if (!Array.isArray(g.items) || g.items.length < 2) { bad("items must list at least 2 entries", p + ".items"); return; }
      g.items.forEach(function (it, k) {
        if (!isStr(it)) { bad("item must be a non-empty string", p + ".items[" + k + "]"); return; }
        if (it.length > 22) bad("item is too long for a bubble (22 characters max)", p + ".items[" + k + "]");
        var key = it.trim().toLowerCase();
        if (seen[key]) bad("\"" + it + "\" appears in two places; every item must belong to exactly one group", p + ".items[" + k + "]");
        seen[key] = true;
        total += 1;
      });
    });
    if (total < 6) bad("use at least 6 items in total", ".groups");
    if (total > 60) bad("use at most 60 items in total", ".groups");
    return out;
  }

  function decide(sdk) {
    var f = sdk.state.sort_field, bins = sdk.state.sort_bins, rule = sdk.state.sort_rule;
    if (!f || !bins || !rule || rule.over) return [];
    var m = botMem(sdk);
    var skill = skillOf(sdk);
    var rnd = function () { return sdk.botRng(); };
    function find(id) { for (var i = 0; i < f.bubbles.length; i++) if (f.bubbles[i].id === id) return f.bubbles[i]; return null; }
    if (m.step === "release") {
      m.step = "aim";
      var b0 = find(m.target);
      if (!b0) { m.step = "idle"; return [{ a: "up", v: [m.px, m.py] }]; }
      return [{ a: "up", v: [m.px, m.py] }];
    }
    if (m.step === "aim") {
      var b = find(m.target);
      if (!b || f.selected !== m.target) { m.step = "idle"; m.wait = sdk.tick + 6; return []; }
      if (sdk.tick < m.at) return [];
      var bin = m.bin;
      var bx = bins.bins[bin].cx + (rnd() - 0.5) * bins.bins[bin].w * 0.5, by = BIN_TOP + 40 + rnd() * 40;
      m.step = "lift"; m.px = bx; m.py = by;
      return [{ a: "tap", v: [Math.round(bx * 10) / 10, Math.round(by * 10) / 10] }];
    }
    if (m.step === "lift") { m.step = "idle"; m.wait = sdk.tick + Math.round((0.35 - 0.25 * skill) * 60 + rnd() * 12); return [{ a: "up", v: [m.px, m.py] }]; }
    // Idle: choose the most urgent bubble once it has fully appeared.
    if (m.wait && sdk.tick < m.wait) return [];
    var target = null;
    for (var i = 0; i < f.bubbles.length; i++) {
      var c = f.bubbles[i];
      // Read it first: about a second, longer for long labels and for weaker players.
      var read = Math.round((0.8 + 0.03 * c.label.length) * (1.25 - 0.3 * skill) * 60);
      if (sdk.tick - c.born < read) continue;
      if (!target || c.y < target.y) target = c;
    }
    if (!target) return [];
    if (m.seen !== target.id) {
      m.seen = target.id;
      // Reaction time: slower bots notice later (and sometimes too late).
      m.reactAt = sdk.tick + Math.round((1.15 - 0.95 * skill) * 60 * (0.6 + 0.8 * rnd()));
      return [];
    }
    if (sdk.tick < m.reactAt) return [];
    var right = target.group;
    var n = bins.bins.length;
    var choose = rnd() < 0.55 + 0.43 * skill ? right : (right + 1 + Math.floor(rnd() * (n - 1))) % n;
    m.target = target.id; m.bin = choose;
    m.at = sdk.tick + 2 + Math.round((0.5 - 0.4 * skill) * 60 * (0.5 + rnd()));
    m.step = "release";
    m.px = Math.round(target.x * 10) / 10; m.py = Math.round(target.y * 10) / 10;
    return [{ a: "tap", v: [m.px, m.py] }];
  }

  function share(sdk) {
    var rule = sdk.state.sort_rule, f = sdk.state.sort_field;
    var m = sdk.manifest || {};
    var title = (m.style && m.style.emoji ? m.style.emoji + " " : "") + (m.title || "Bubble");
    if (!rule) return { headline: title, score_text: sdk.score + " points" };
    var rows = [];
    for (var i = 0; i < rule.marks.length; i += 6) rows.push(rule.marks.slice(i, i + 6).join(""));
    var total = f && !f.endless ? f.total : rule.hits + rule.wrong + rule.escaped;
    var extra = rule.bestStreak >= 4 ? " · best streak " + rule.bestStreak : "";
    return { headline: title, score_text: sdk.score + " points · " + rule.hits + "/" + total + " sorted" + extra, emoji_grid: rows.join("\n") };
  }

  B.defineFormula({
    id: "group", title: "Sort",
    describe: "Sort into groups: labeled bubbles drift up and you sort each into one of 2–4 bins (tap then tap a bin, drag, or flick it down). Wrong bins and bubbles that float away cost lives (rule.lives); right sorts in a row build a streak multiplier. Learn which things belong together: neighborhoods vs food, who said what, true vs myth. A run is 8–20 bubbles, 20–50 seconds.",
    core: ["space.sort_bins", "entity.sort_bubble", "input.sort_gesture", "rule.sort_match", "score.sort_streak"],
    optional: ["rule.lives", "rule.timer", "behavior.speed_ramp", "flow.run_retry", "flow.daily_gate", "share.emoji_grid", "share.score_card", "feel.mood_preset", "social.beat_marker"],
    tips: [
      "Add rule.lives (lives 3, grace 0) so wrong bins and escapes cost a life; leave it out for a no-fail warm-up.",
      "Add rule.timer (outcome success) for 'sort as many as you can in 45 seconds': the deck reshuffles endlessly.",
      "behavior.speed_ramp (rate 0.15–0.3) makes bubbles rise and arrive faster as the run goes on.",
      "Use 2 groups for quick true/false or this/that sorts, 3–4 for richer ones; 4–6 items per group."
    ],
    content: {
      describe: "groups: 2–4 groups of {label (bin name, 16 characters max), optional emoji, items (2+ short labels, 22 characters max)}. Every item belongs to exactly one group; 6–60 items in total (a run deals all of them, or `deal` of them). Bubbles show the item; bins show the label.",
      schema: {
        type: "object", required: ["groups"],
        properties: {
          groups: {
            type: "array", minItems: 2, maxItems: 4,
            items: {
              type: "object", required: ["label", "items"],
              properties: {
                label: { type: "string", minLength: 1, maxLength: 16 },
                emoji: { type: "string", maxLength: 8 },
                items: { type: "array", minItems: 2, maxItems: 30, items: { type: "string", minLength: 1, maxLength: 22 } }
              }
            }
          }
        }
      }
    },
    validateContent: validateContent,
    bot: { describe: "Takes the highest (most urgent) bubble after a 0.2–1.1 s reaction (faster with skill), taps it, then taps the right bin with probability 0.55–0.98 by skill.", decide: decide },
    share: share,
    example: {
      id: "example-group", version: 1, engine_version: 1,
      title: "Hill or Flat?",
      one_line_rule: "Sort each spot: up a hill or on the flats. Don't let them float away.",
      formula: "group",
      brief: { intent: "learn the city's shape", audience: "everyone", mood: ["curious", "playful"], energy: "medium", competition: "friendly" },
      structure: { cadence: "endless", scope: "everyone", setter: "ai" },
      lineage: { parent: null, operators: [], remix_of: null },
      chain: null,
      style: { look: "paper", palette: "lilac-haze", font: "rounded", motif: "hills", emoji: "⛰️", mood_preset: "playful" },
      concepts: [
        { use: "space.sort_bins" },
        { use: "entity.sort_bubble", params: { rise_speed: 32, spawn_every: 1.9 } },
        { use: "input.sort_gesture" },
        { use: "rule.sort_match" },
        { use: "rule.lives", params: { lives: 3, grace: 0 } },
        { use: "behavior.speed_ramp", params: { rate: 0.2, delay: 4 } },
        { use: "score.sort_streak" },
        { use: "flow.run_retry" },
        { use: "share.emoji_grid" }
      ],
      glue: {},
      content: {
        groups: [
          { label: "Hill", emoji: "⛰️", items: ["Twin Peaks", "Bernal Heights", "Nob Hill", "Telegraph Hill", "Potrero Hill"] },
          { label: "Flat", emoji: "🚲", items: ["Marina", "SoMa", "Mission", "Dogpatch", "Embarcadero"] }
        ]
      },
      seed: 1907
    }
  });
})();
