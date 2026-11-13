// Bubble kit: nextline. See docs/BUBBLES.md, 4.6 and 7.7. Kits only call Bubble.defineFormula and Bubble.defineConcept.
//
// Guess what they say next. Each round is one short, original scene: two or three simple
// characters (shapes with eyes) trade lines in speech bubbles that type out. The scene freezes
// right before the punchline, and the player picks the real next line from four answer tiles
// against a timer. Right and fast scores more, streaks multiply, then the reveal types the real
// line and the right tile lights up.
//
// Concepts:
//   space.nextline_stage  the stage: characters, idle bobs on the tick clock, typed speech bubbles
//   entity.line_tiles     the four answer tiles: stacked rounded cards with a number and a tail
//   rule.next_line        rounds, typing, the freeze, the timer, the reveal, streaks, the length contract
//   score.quick_answer    base + speed bonus, times a streak multiplier
// input.select (common kit) taps the tiles (state.choices are boxes).
//
// Timing (ticks at 60/s), so the app can follow a run's rounds from its replay:
//   lead-in 18 (first round only), title card 54, each line ceil(chars × 1.25) + 22, then the
//   freeze (the timer: round_seconds, 8 s by default), then a 150-tick reveal.
//   A tap on the stage while a line types finishes that line.
//
// Share tag (docs/BUBBLES.md 7.7): "right=4/5;streak=3;r=1:1.8:1:868|2:8.0:0:0|..." where each r
// entry is round:seconds-to-answer:correct(1/0):points. A time-out reports the full timer.
//
// State: state.nextline (the rule), state.choices / state.choices_locked (input.select),
// state.nextline_score (the score concept).
(function () {
  "use strict";
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var B = root.Bubble;
  if (!B || typeof B.defineConcept !== "function" || typeof B.defineFormula !== "function") return;

  var W = 360;
  var LEAD_IN = 18;
  var TITLE_TICKS = 54;
  var LINE_HOLD = 22;
  var TICKS_PER_CHAR = 1.25;
  var REVEAL_TICKS = 150;
  var SHAPES = ["blob", "square", "tall", "round", "star"];
  var ROLES = ["primary", "secondary", "accent"];
  var MARK = { right: "✨", wrong: "💥", timeout: "⏳", none: "▫️" };

  // Layout (logical playfield).
  var STAGE = { x: 16, y: 64, w: 328, h: 276, r: 26 };
  var FLOOR_Y = 298;
  var NAME_Y = 316;
  var ASK_Y = 330;
  var TIMER_Y = 368;
  var TILE = { x: 22, y: 384, w: 316, h: 52, gap: 7 };

  // ---- helpers ---------------------------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function isStr(v) { return typeof v === "string" && v.trim().length > 0; }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); }
  function lower(s) { return String(s || "").trim().toLowerCase(); }
  function skillOf(sdk) {
    var s = sdk.botSkill;
    return clamp(typeof s === "number" && isFinite(s) ? s : 0.7, 0, 1);
  }
  // Bot memory lives outside game state (sdk.botState), so a recorded bot run replays identically.
  function botMem(sdk) {
    var holder = sdk.botState && typeof sdk.botState === "object" ? sdk.botState : (sdk.state.__nextlineBot = sdk.state.__nextlineBot || {});
    if (!holder.nextline || sdk.tick < holder.nextline.lastTick) holder.nextline = { lastTick: 0 };
    holder.nextline.lastTick = sdk.tick;
    return holder.nextline;
  }
  function lineTicks(text) { return Math.ceil(String(text).length * TICKS_PER_CHAR) + LINE_HOLD; }
  function tileBox(i) {
    return { x: TILE.x + TILE.w / 2, y: TILE.y + i * (TILE.h + TILE.gap) + TILE.h / 2, w: TILE.w, h: TILE.h, value: i };
  }
  function lookOf(g) { return g.look || (g.palette && g.palette.look) || "glow"; }
  function cardFill(g) { var p = g.palette; return p.surfaceStrong || p.surface; }
  function edgeOf(g) { var p = g.palette, lk = lookOf(g); return lk === "glow" || lk === "clay" ? p.surfaceStrong : p.line || p.ink; }

  // ---- content model ---------------------------------------------------------------------------
  // Normalizes content into episodes; tile order is shuffled per round with the seeded RNG.
  function buildEpisodes(sdk) {
    var content = sdk.content || {};
    var list = Array.isArray(content.episodes) ? content.episodes : [];
    var out = [];
    for (var i = 0; i < list.length && out.length < 6; i++) {
      var e = list[i] || {};
      var cast = (Array.isArray(e.cast) ? e.cast : []).filter(function (c) { return c && isStr(c.name); }).slice(0, 3).map(function (c, k) {
        return {
          name: String(c.name).slice(0, 14),
          shape: SHAPES.indexOf(c.shape) >= 0 ? c.shape : SHAPES[k % SHAPES.length],
          role: ROLES.indexOf(c.role) >= 0 ? c.role : ROLES[k % ROLES.length]
        };
      });
      if (cast.length < 2) continue;
      var names = cast.map(function (c) { return lower(c.name); });
      var lines = (Array.isArray(e.lines) ? e.lines : []).filter(function (l) { return l && isStr(l.text); }).slice(0, 6).map(function (l) {
        var w = names.indexOf(lower(l.who));
        return { who: w >= 0 ? w : 0, text: String(l.text).slice(0, 70) };
      });
      var decoys = (Array.isArray(e.decoys) ? e.decoys : []).filter(isStr).slice(0, 3).map(function (d) { return String(d).slice(0, 60); });
      if (!lines.length || !isStr(e.answer) || decoys.length < 3) continue;
      var nw = names.indexOf(lower(e.next_who));
      out.push({
        title: isStr(e.title) ? String(e.title).slice(0, 40) : "Scene " + (out.length + 1),
        setting: isStr(e.setting) ? String(e.setting).slice(0, 80) : "",
        cast: cast,
        lines: lines,
        nextWho: nw >= 0 ? nw : (lines[lines.length - 1].who + 1) % cast.length,
        answer: String(e.answer).slice(0, 60),
        decoys: decoys,
        emoji: isStr(e.reveal_emoji) ? String(e.reveal_emoji).slice(0, 8) : "😂"
      });
    }
    return out;
  }

  // The tick the first round freezes (the poster moment: the scene with its four tiles).
  function firstFreezeTick(ep) {
    var t = LEAD_IN + TITLE_TICKS;
    for (var i = 0; i < ep.lines.length; i++) t += lineTicks(ep.lines[i].text);
    return t;
  }

  // ---- drawing helpers -------------------------------------------------------------------------
  function fitText(g, text, maxW, big, small, maxLines, weight) {
    var best = null;
    for (var size = big; size >= small; size -= 1) {
      var lines = g.wrapText ? g.wrapText(String(text), maxW, size, weight) : [String(text)];
      best = { lines: lines, size: size };
      if (lines.length <= maxLines) return best;
    }
    if (best && best.lines.length > maxLines) {
      best.lines = best.lines.slice(0, maxLines);
      best.lines[maxLines - 1] = best.lines[maxLines - 1] + "…";
    }
    return best;
  }

  // A speech bubble whose bottom edge sits at `bottom`, with a tail toward (tx, ty).
  function speech(g, text, fullText, cx, bottom, tx, ty, o) {
    var p = g.palette;
    var size = o.size || 17;
    // Measure with the full line, so the bubble doesn't grow while the text types.
    var fit = fitText(g, fullText, o.maxW || 268, size, Math.max(11, size - 4), o.maxLines || 3, 700);
    var lh = fit.size * 1.2;
    // Several lines fill the width; one line gets a width estimate (wider for the pixel face).
    var perChar = lookOf(g) === "pixel" || g.pixelFont ? 0.8 : 0.55;
    var widest = fit.lines.length > 1 ? (o.maxW || 268) : Math.min(o.maxW || 268, fit.lines[0].length * fit.size * perChar);
    var w = clamp(widest + 32, 90, (o.maxW || 268) + 32);
    var h = fit.lines.length * lh + 22;
    var x = clamp(cx - w / 2, STAGE.x + 8, STAGE.x + STAGE.w - 8 - w);
    var y = bottom - h;
    var alpha = o.alpha === undefined ? 1 : o.alpha;
    var fill = o.fill || cardFill(g);
    // Tail: a small triangle from the bubble's bottom toward the speaker.
    if (o.tail !== false) {
      var bx = clamp(tx, x + 22, x + w - 22);
      g.path([bx - 9, bottom - 3, bx + 9, bottom - 3, bx + (tx - bx) * 0.4, Math.min(ty, bottom + 18)], o.stroke || edgeOf(g), { fill: fill, closed: true, width: 1.5, alpha: alpha });
    }
    g.pill(x, y, w, h, { fill: fill, stroke: o.stroke || edgeOf(g), strokeWidth: 1.5, radius: 18, alpha: alpha, shade: 0.3 });
    // Typed text: draw the visible prefix line by line.
    var left = text.length;
    var ty0 = y + 11 + lh / 2;
    for (var k = 0; k < fit.lines.length && left > 0; k++) {
      var ln = fit.lines[k];
      var shown = ln.slice(0, Math.max(0, left));
      left -= ln.length + 1;
      g.text(shown, x + 16, ty0 + k * lh, { size: fit.size, weight: o.weight || 700, color: o.color || p.ink, align: "left", alpha: alpha });
    }
    return { x: x, y: y, w: w, h: h };
  }

  function starPoints(x, y, r) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var rr = i % 2 === 0 ? r : r * 0.52;
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    return pts;
  }
  function blobPoints(x, y, r, k) {
    var pts = [];
    for (var i = 0; i < 18; i++) {
      var a = i / 18 * Math.PI * 2;
      var rr = r * (1 + 0.07 * Math.sin(a * 3 + k) + 0.04 * Math.cos(a * 2 - k * 0.7));
      pts.push(x + Math.cos(a) * rr * 1.08, y + Math.sin(a) * rr * 0.94);
    }
    return pts;
  }

  // One character standing on the floor at x. `look` is the x it looks toward.
  function character(g, c, x, floor, o) {
    var p = g.palette;
    var color = p[c.role] || p.primary;
    var edge = edgeOf(g);
    var bob = o.bob || 0;
    var head; // top of the shape
    var cy; // eye line
    var r;
    g.pill(x - 27, floor - 1, 54, 8, { fill: p.ink, radius: 4, alpha: 0.12 });
    switch (c.shape) {
      case "square":
        g.pill(x - 29, floor - 58 + bob, 58, 58, { fill: color, stroke: edge, strokeWidth: 2, radius: 12, shade: 0.5 });
        head = floor - 58 + bob; cy = head + 22; break;
      case "tall":
        g.pill(x - 21, floor - 78 + bob, 42, 78, { fill: color, stroke: edge, strokeWidth: 2, radius: 19, shade: 0.5 });
        head = floor - 78 + bob; cy = head + 24; break;
      case "round":
        r = 31;
        g.orb(x, floor - r + bob, r, color, { glow: 0.2 });
        head = floor - 2 * r + bob; cy = head + 26; break;
      case "star":
        r = 36;
        g.path(starPoints(x, floor - r + 4 + bob, r), edge, { fill: color, closed: true, width: 2 });
        head = floor - 2 * r + 8 + bob; cy = floor - r + 2 + bob; break;
      default: // blob
        r = 31;
        g.path(blobPoints(x, floor - r + bob, r, o.wob || 0), edge, { fill: color, closed: true, width: 2 });
        head = floor - 2 * r + bob; cy = head + 26; break;
    }
    // Eyes look toward whoever is talking.
    var dx = clamp((o.look - x) / 40, -1, 1) * 2.4;
    var white = p.surfaceStrong && p.surfaceStrong.charAt(0) === "#" ? p.surfaceStrong : "#FFFFFF";
    for (var s = -1; s <= 1; s += 2) {
      var ex = x + s * 9;
      if (o.blink) g.line(ex - 4, cy, ex + 4, cy, p.ink, { width: 2.2 });
      else {
        g.circle(ex, cy, 6.2, white, 1);
        g.circle(ex + dx, cy + 0.6, 3, p.ink, 1);
      }
    }
    // Mouth: opens and closes while talking; a small smile otherwise.
    var my = cy + 14;
    var mouthInk = p.inkOn(color);
    if (o.talking) {
      var open = 2 + 4 * Math.abs(Math.sin(o.talkPhase));
      g.pill(x - 5, my - open / 2, 10, open, { fill: mouthInk, radius: 4 });
    } else if (o.thinking) {
      g.line(x - 4, my, x + 4, my, mouthInk, { width: 2 });
    } else {
      g.path([x - 6, my - 1, x, my + 2.5, x + 6, my - 1], mouthInk, { width: 2 });
    }
    return { head: head, x: x };
  }

  function castXs(n) {
    return n <= 2 ? [104, 256] : [74, 180, 286];
  }

  // ---- concepts --------------------------------------------------------------------------------

  B.defineConcept({
    id: "space.nextline_stage", kind: "space", version: 1, formulas: ["nextline"],
    describe: "The stage for guess-what-they-say-next: a rounded set with 2–3 simple characters (blob, square, tall, round or star shapes with eyes) standing on a floor, gently bobbing. Each line types out in a speech bubble over its speaker; the previous line stays above it, faded. At the freeze the next speaker gets a thinking bubble and the question 'What does <name> say next?'; at the reveal their bubble types the real line and the reveal emoji pops.",
    examples: ["roommates bickering about the thermostat", "new neighbors on a steep street", "coworkers planning a potluck"],
    params: {
      bob: { type: "boolean", default: true, describe: "Characters bob gently while idle (off for a calmer stage)." }
    },
    consumes: [], emits: [], requires: ["rule.next_line"], conflicts: [],
    tags: { mood: ["playful", "silly", "warm", "social"], energy: ["low", "medium"] },
    state: "reads nextline (the rule)",
    glue: [],
    setup: function (sdk, params) {
      sdk.layer(sdk.Z.space, function (g) {
        var a = sdk.state.nextline;
        if (!a || !a.episodes.length) return;
        var p = g.palette;
        var idx = clamp(a.index, 0, a.episodes.length - 1);
        var ep = a.episodes[idx];
        var tick = sdk.tick;
        // Header: round and episode.
        g.text("ROUND " + (idx + 1) + " OF " + a.total, W / 2, 20, { size: 11, weight: 800, color: p.ink, alpha: 0.6 });
        g.text(ep.title, W / 2, 42, { size: 19, weight: 800, color: p.ink, maxWidth: 250 });
        if (a.mult > 1 && (a.phase === "ask" || a.phase === "reveal" || a.phase === "scene")) {
          g.pill(W - 66, 30, 50, 24, { fill: p.accent, radius: 12 });
          g.text("×" + (Math.round(a.mult * 10) / 10), W - 41, 42, { size: 13, weight: 900, color: p.inkOn(p.accent) });
        }
        if (a.streak >= 2 && (a.phase === "ask" || a.phase === "scene" || a.phase === "title")) {
          g.text("🔥 " + a.streak, 40, 42, { size: 14, weight: 800, color: p.ink, align: "center" });
        }
        // The set.
        var lk = lookOf(g);
        g.pill(STAGE.x, STAGE.y, STAGE.w, STAGE.h, { fill: p.surface, stroke: lk === "glow" ? edgeOf(g) : null, strokeWidth: 2, radius: STAGE.r, alpha: lk === "neon" || lk === "chalk" ? 1 : 0.85 });
        g.line(STAGE.x + 22, FLOOR_Y + 4, STAGE.x + STAGE.w - 22, FLOOR_Y + 4, p.ink, { width: 2, alpha: 0.18 });

        // Title card: the setting before the first line.
        if (a.phase === "title" || a.phase === "wait") {
          var tp = a.phase === "wait" ? 0 : easeOut((tick - a.t0) / 18);
          g.text(ep.setting || "Listen in…", W / 2, 128, { size: 15, weight: 700, color: p.ink, alpha: 0.75 * tp, maxWidth: 290 });
        }

        // Who is talking right now.
        var talker = -1, typing = false, prevText = "", curText = "", curFull = "", curWho = -1;
        if (a.phase === "scene") {
          var line = ep.lines[a.line];
          var shown = Math.min(line.text.length, Math.floor((tick - a.lineStart) / TICKS_PER_CHAR) + 1);
          if (a.skipAt === a.line) shown = line.text.length;
          typing = shown < line.text.length;
          talker = line.who;
          curWho = line.who; curFull = line.text; curText = line.text.slice(0, shown);
          if (a.line > 0) prevText = ep.lines[a.line - 1].text;
        } else if (a.phase === "ask" || a.phase === "reveal" || a.phase === "done") {
          var last = ep.lines[ep.lines.length - 1];
          if (a.phase === "ask") {
            curWho = last.who; curFull = last.text; curText = last.text;
            if (ep.lines.length > 1) prevText = ep.lines[ep.lines.length - 2].text;
          } else {
            var since = tick - a.revealAt;
            var n = Math.min(ep.answer.length, Math.max(0, Math.floor((since - 8) / 0.7)));
            curWho = ep.nextWho; curFull = ep.answer; curText = ep.answer.slice(0, n);
            typing = n < ep.answer.length;
            talker = ep.nextWho;
            prevText = last.text;
          }
        }

        var xs = castXs(ep.cast.length);
        var lookX = talker >= 0 ? xs[talker] : a.phase === "ask" ? xs[ep.nextWho] : W / 2;
        var heads = [];
        for (var i = 0; i < ep.cast.length; i++) {
          var bob = params.bob && !g.reduced ? Math.sin((tick + i * 23) * 0.075) * 2.2 : 0;
          if (talker === i && typing && !g.reduced) bob -= Math.abs(Math.sin(tick * 0.35)) * 2.5;
          var blink = !g.poster && ((tick + i * 61) % 170) < 6;
          heads.push(character(g, ep.cast[i], xs[i], FLOOR_Y, {
            bob: bob, look: i === talker ? (i === 0 ? xs[1] : xs[0]) : lookX, talking: talker === i && typing,
            talkPhase: tick * 0.55, thinking: a.phase === "ask" && i === ep.nextWho, blink: blink, wob: tick * 0.03 + i
          }));
          g.text(ep.cast[i].name, xs[i], NAME_Y, { size: 12, weight: 800, color: p.ink, alpha: 0.7, maxWidth: 96 });
        }

        // Speech: the previous line above, faded; the current line over its speaker.
        if (prevText) speech(g, prevText, prevText, W / 2, 124, 0, 0, { size: 13, maxLines: 2, alpha: 0.55, tail: false, maxW: 270 });
        if (curWho >= 0 && curFull) {
          var hx = xs[curWho], hy = heads[curWho].head;
          var isAnswer = a.phase === "reveal" || a.phase === "done";
          speech(g, curText, curFull, hx, Math.min(214, hy - 18), hx, hy - 4, {
            size: 17, maxLines: 3,
            fill: isAnswer ? p.primary : undefined,
            color: isAnswer ? p.inkOn(p.primary) : undefined,
            weight: isAnswer ? 800 : 700
          });
        }
        // The freeze: a thinking bubble over the next speaker.
        if (a.phase === "ask") {
          var nx = xs[ep.nextWho], ny = heads[ep.nextWho].head;
          var bx = clamp(nx + 34, 60, W - 60), by = ny - 2;
          g.circle(nx + 16, ny + 4, 4, cardFill(g), 1);
          g.pill(bx - 26, by - 30, 52, 26, { fill: cardFill(g), stroke: edgeOf(g), strokeWidth: 1.5, radius: 13 });
          for (var d = 0; d < 3; d++) {
            var up = g.reduced ? 0 : Math.max(0, Math.sin(tick * 0.18 - d * 0.9)) * 3;
            g.circle(bx - 10 + d * 10, by - 17 - up, 3.2, p.ink, 0.7);
          }
        }
        // Reveal emoji.
        if (a.phase === "reveal" || a.phase === "done") {
          var rs = tick - a.revealAt;
          var pop = g.reduced ? 1 : easeOut(clamp((rs - 30) / 16, 0, 1));
          if (rs > 30) g.emoji(ep.emoji, clamp(xs[ep.nextWho] + 44, 40, W - 40), heads[ep.nextWho].head - 10 - 8 * pop, 30 * (0.4 + 0.6 * pop), pop);
        }

        // Question / result chip straddling the bottom of the set.
        var chip = "", chipFill = cardFill(g), chipInk = p.ink;
        if (a.phase === "ask") chip = "What does " + ep.cast[ep.nextWho].name + " say next?";
        else if ((a.phase === "reveal" || a.phase === "done") && a.caption) {
          chip = a.caption;
          var res = a.results[a.index];
          if (res && res.correct) { chipFill = p.primary; chipInk = p.inkOn(p.primary); }
        } else if (a.phase === "scene") chip = "";
        if (chip) {
          var cw = clamp(chip.length * 8.4 + 34, 140, 320);
          g.pill(W / 2 - cw / 2, ASK_Y, cw, 30, { fill: chipFill, stroke: edgeOf(g), strokeWidth: 1.5, radius: 15 });
          g.text(chip, W / 2, ASK_Y + 15, { size: 14, weight: 800, color: chipInk, maxWidth: cw - 20 });
        }
      });
    }
  });

  B.defineConcept({
    id: "entity.line_tiles", kind: "entity", version: 1, formulas: ["nextline"],
    describe: "The four answer tiles for guess-what-they-say-next: full-width rounded cards stacked under the stage, each with a numbered badge and a small speech tail, all in the same card color (no color or shape coding). They pop in at the freeze; on reveal the real line fills with the primary color and a check, and a wrong pick shakes with an outline in the danger color. Also draws the round timer bar above them.",
    examples: ["four possible next lines under a frozen scene"],
    params: {},
    consumes: [], emits: [], requires: ["rule.next_line", "input.select"], conflicts: [],
    tags: { mood: ["playful", "social"], energy: ["low", "medium"] },
    state: "reads nextline (the rule) and choices",
    glue: [],
    setup: function (sdk) {
      sdk.layer(sdk.Z.entities, function (g) {
        var a = sdk.state.nextline;
        if (!a || !a.episodes.length) return;
        var p = g.palette;
        var tick = sdk.tick;
        // Timer bar.
        if (a.phase === "ask" || a.phase === "reveal") {
          var res0 = a.results[a.index];
          var left = a.phase === "ask" ? clamp(1 - (tick - a.t0) / (a.seconds * 60), 0, 1) : res0 ? res0.left : 0;
          g.pill(40, TIMER_Y, 280, 7, { fill: p.ink, alpha: 0.12, radius: 3.5 });
          if (left > 0) g.pill(40, TIMER_Y, Math.max(7, 280 * left), 7, { fill: left < 0.3 ? p.danger : p.primary, radius: 3.5 });
        }
        var tiles = a.tiles;
        if (a.phase === "title" || a.phase === "scene" || a.phase === "wait" || !tiles) {
          // Ghost tiles so the layout never jumps.
          for (var q = 0; q < 4; q++) {
            var gb = tileBox(q);
            g.pill(gb.x - gb.w / 2, gb.y - gb.h / 2, gb.w, gb.h, { fill: null, stroke: p.ink, strokeWidth: 1.5, radius: 16, dash: [6, 6], alpha: 0.18 });
          }
          g.text(a.phase === "scene" ? "Listen in… tap the scene to skip ahead" : "Get ready to guess the next line", W / 2, TILE.y + TILE.h + TILE.gap + TILE.h / 2, { size: 13, weight: 700, color: p.ink, alpha: 0.5, maxWidth: 300 });
          return;
        }
        var res = a.results[a.index];
        var revealing = a.phase !== "ask" && !!res;
        var since = revealing ? tick - a.revealAt : 0;
        for (var i = 0; i < tiles.length; i++) {
          var b = tileBox(i);
          var appear = a.phase === "ask" ? easeOut((tick - a.t0 - i * 4) / 12) : 1;
          if (g.poster || g.reduced) appear = 1;
          var x = b.x - b.w / 2, y = b.y - b.h / 2 + (1 - appear) * 18;
          var right = i === a.answerTile;
          var picked = revealing && res.pick === i;
          var fill = cardFill(g), ink = p.ink, stroke = edgeOf(g), alpha = appear;
          if (revealing) {
            if (right) { fill = p.primary; ink = p.inkOn(p.primary); }
            else if (picked) { stroke = p.danger; x += Math.sin(since * 1.3) * 6 * Math.max(0, 1 - since / 24); }
            else alpha = 0.55;
          }
          // Speech tail under the card's left side.
          g.path([x + 30, y + b.h - 3, x + 42, y + b.h - 3, x + 31, y + b.h + 6], stroke, { fill: fill, closed: true, width: 1.5, alpha: alpha });
          g.pill(x, y, b.w, b.h, { fill: fill, stroke: picked && !right ? p.danger : stroke, strokeWidth: picked ? 3 : 1.5, radius: 16, alpha: alpha, shade: 0.4 });
          // Number badge.
          g.circle(x + 26, b.y, 13, revealing && right ? p.inkOn(p.primary) : p.primary, alpha);
          g.text(revealing && right ? "✓" : revealing && picked ? "✗" : String(i + 1), x + 26, b.y + 1, { size: 13, weight: 900, color: revealing && right ? p.primary : p.inkOn(p.primary), alpha: alpha });
          var fit = fitText(g, tiles[i], b.w - 62, 15, 11, 2, 700);
          var lh = fit.size * 1.18;
          for (var k = 0; k < fit.lines.length; k++) {
            g.text(fit.lines[k], x + 48, b.y - (fit.lines.length - 1) * lh / 2 + k * lh, { size: fit.size, weight: 700, color: ink, align: "left", alpha: alpha, maxWidth: b.w - 60 });
          }
          if (picked) {
            g.pill(x + b.w - 50, y - 9, 42, 18, { fill: p.ink, radius: 9, alpha: alpha });
            g.text("You", x + b.w - 29, y, { size: 10, weight: 800, color: p.inkOn(p.ink), alpha: alpha });
          }
        }
      });
    }
  });

  B.defineConcept({
    id: "rule.next_line", kind: "rule", version: 1, formulas: ["nextline"],
    describe: "Guess-what-they-say-next rounds: each content episode is one round. A title card, then each line types out over its speaker (a tap on the stage finishes the line); the scene freezes before the punchline and four tiles (the real line plus three decoys, in a seeded order) wait for a pick against the timer. A time-out counts as wrong and breaks the streak. The reveal types the real line, lights the right tile and pops the reveal emoji. Honors the length contract: rounds (default: every episode), timed (finishes the round in progress when time is up) and lives (a miss costs a life). The run succeeds after the last round; it fails only when lives run out.",
    examples: ["five roommate scenes, 8 seconds to pick each punchline", "three neighbor scenes with a 10 second timer"],
    params: {
      round_seconds: { type: "number", default: 8, min: 4, max: 15, describe: "Seconds to pick the next line once the scene freezes. A time-out is a miss." },
      shuffle_episodes: { type: "boolean", default: false, describe: "Play the episodes in a seeded random order instead of content order." }
    },
    consumes: ["input.select", "clock.tick", "pointer.down"],
    emits: ["round.start", "round.result", "round.end", "guess.made", "rule.success", "rule.fail"],
    requires: ["space.nextline_stage", "input.select"], conflicts: [], ends: true,
    state: "nextline: {episodes, index, phase, results, streak, tiles, answerTile}",
    tags: { mood: ["playful", "silly", "social", "competitive"], energy: ["low", "medium"], competition: ["friendly", "competitive"], occasion: ["party", "game night"] },
    glue: [],
    setup: function (sdk, params) {
      var episodes = buildEpisodes(sdk);
      if (params.shuffle_episodes) episodes = sdk.shuffle(episodes);
      var len = sdk.length || { mode: "rounds" };
      var total = episodes.length;
      if (len.mode === "rounds" && len.rounds) total = Math.min(total, len.rounds);
      // The stage shows "ROUND 2 OF 5" itself, so the engine's rounds chip would repeat it.
      if (len.mode === "rounds") sdk.hud.length = false;
      var a = sdk.state.nextline = {
        episodes: episodes,
        total: Math.max(1, total),
        index: 0,
        phase: "wait",
        t0: 0,
        line: 0,
        lineStart: 0,
        lineEnd: 0,
        skipAt: -1,
        tiles: null,
        answerTile: -1,
        revealAt: 0,
        seconds: clamp(num(params.round_seconds, 8), 4, 15),
        streak: 0,
        bestStreak: 0,
        mult: 1,
        right: 0,
        results: [],
        caption: "",
        livesOut: false,
        over: false
      };
      sdk.state.choices = [];
      sdk.state.choices_locked = true;
      if (episodes.length) sdk.state.poster_tick = firstFreezeTick(episodes[0]) + 24;

      function startLine(i) {
        var ep = episodes[a.index];
        a.line = i;
        a.lineStart = sdk.tick;
        a.lineEnd = sdk.tick + lineTicks(ep.lines[i].text);
        a.skipAt = -1;
      }

      function startRound(i) {
        a.index = i;
        a.phase = "title";
        a.t0 = sdk.tick;
        a.tiles = null;
        a.answerTile = -1;
        a.caption = "";
        sdk.state.choices = [];
        sdk.state.choices_locked = true;
        sdk.emit("round.start", { index: i, total: a.total });
      }

      function freeze() {
        var ep = episodes[a.index];
        var order = sdk.shuffle([0, 1, 2, 3]);
        var options = [ep.answer].concat(ep.decoys);
        a.tiles = order.map(function (o) { return options[o]; });
        a.answerTile = order.indexOf(0);
        a.phase = "ask";
        a.t0 = sdk.tick;
        var boxes = [];
        for (var i = 0; i < 4; i++) boxes.push(tileBox(i));
        sdk.state.choices = boxes;
        sdk.state.choices_locked = false;
        sdk.fx.sound("tick");
        sdk.fx.haptic("light");
      }

      function judge(pick) {
        var timedOut = pick < 0;
        var elapsed = (sdk.tick - a.t0) / 60;
        var correct = !timedOut && pick === a.answerTile;
        var left = timedOut ? 0 : clamp(1 - elapsed / a.seconds, 0, 1);
        a.streak = correct ? a.streak + 1 : 0;
        a.bestStreak = Math.max(a.bestStreak, a.streak);
        if (correct) a.right += 1;
        var res = {
          index: a.index, pick: pick, correct: correct, timedOut: timedOut,
          seconds: timedOut ? a.seconds : Math.round(elapsed * 10) / 10, left: left, streak: a.streak, points: 0,
          mark: timedOut ? MARK.timeout : correct ? MARK.right : MARK.wrong
        };
        a.results[a.index] = res;
        a.phase = "reveal";
        a.revealAt = sdk.tick;
        sdk.state.choices_locked = true;
        var t = tileBox(pick >= 0 ? pick : a.answerTile);
        sdk.emit("round.result", { index: a.index, pick: pick, correct: correct, timed_out: timedOut, elapsed: elapsed, left: left, streak: a.streak, total: a.total, x: t.x, y: t.y - t.h / 2 - 10 });
        var sc = sdk.state.nextline_score;
        res.points = correct && sc ? sc.last : 0;
        a.mult = sc && sc.mult ? sc.mult : 1;
        sdk.emit("guess.made", { correct: correct });
        a.caption = timedOut ? "Time's up" : correct ? "Right! +" + res.points + (a.streak >= 2 ? " · " + a.streak + " in a row" : "") : "Not quite";
        if (!correct && len.mode === "lives" && !sdk.lengthMiss()) a.livesOut = true;
        if (correct) {
          sdk.fx.pop(t.x, t.y, null, 20);
          if (sdk.fx.sparkle) sdk.fx.sparkle(t.x, t.y - t.h / 2, null, 10);
          sdk.fx.sound("chime");
          sdk.fx.haptic("success");
        } else if (timedOut) {
          sdk.fx.sound("whoosh");
          sdk.fx.haptic("warning");
        } else {
          sdk.fx.shake(4);
          sdk.fx.sound("fail");
          sdk.fx.haptic("warning");
        }
      }

      function finish(outcome) {
        a.over = true;
        a.phase = "done";
        if (outcome === "success") {
          sdk.emit("rule.success", { rounds: a.results.length, right: a.right });
          sdk.fx.sound("success");
          sdk.fx.haptic("success");
        } else {
          sdk.emit("rule.fail", { reason: "lives", rounds: a.results.length });
        }
        sdk.end(outcome, { rounds: a.results.length, right: a.right });
      }

      sdk.on("pointer.down", function (e) {
        if (a.over || sdk.ended || a.phase !== "scene") return;
        if (e.y > STAGE.y + STAGE.h || e.y < STAGE.y) return;
        if (sdk.tick < a.lineEnd - LINE_HOLD) {
          a.skipAt = a.line;
          a.lineEnd = sdk.tick + LINE_HOLD;
        }
      });

      sdk.on("input.select", function (e) {
        if (a.phase !== "ask" || a.over || sdk.ended) return;
        var i = Math.floor(num(e.index, -1));
        if (i < 0 || i > 3) return;
        sdk.fx.sound("blip");
        sdk.fx.haptic("selection");
        judge(i);
      });

      sdk.on("clock.tick", function () {
        if (a.over || sdk.ended) return;
        var ep;
        switch (a.phase) {
          case "wait":
            if (!episodes.length) { a.over = true; sdk.emit("rule.fail", { reason: "no_episodes" }); sdk.end("fail", { reason: "no_episodes" }); return; }
            if (sdk.tick >= LEAD_IN) startRound(0);
            return;
          case "title":
            if (sdk.tick - a.t0 >= TITLE_TICKS) { a.phase = "scene"; startLine(0); }
            return;
          case "scene":
            ep = episodes[a.index];
            if (sdk.tick >= a.lineEnd) {
              if (a.line + 1 < ep.lines.length) startLine(a.line + 1);
              else freeze();
            }
            return;
          case "ask":
            var el = sdk.tick - a.t0;
            if (el >= a.seconds * 60) judge(-1);
            else if (el === Math.round((a.seconds - 3) * 60)) sdk.fx.sound("tick");
            return;
          case "reveal":
            if (sdk.tick - a.revealAt < REVEAL_TICKS) return;
            var res = a.results[a.index];
            sdk.emit("round.end", { index: a.index, correct: res.correct });
            var more = sdk.lengthRound();
            if (a.livesOut) { finish("fail"); return; }
            if (more === false || a.index + 1 >= a.total) { finish("success"); return; }
            if (len.mode === "timed" && len.seconds && sdk.tick >= len.seconds * 60) { finish("success"); return; }
            startRound(a.index + 1);
            return;
        }
      });

      sdk.on("flow.phase", function (e) {
        if (e.name !== "fail" && e.name !== "success") return;
        var row = [];
        for (var i = 0; i < a.results.length; i++) { var r = a.results[i]; row.push(!r ? "skip" : r.correct ? "hit" : r.timedOut ? "skip" : "miss"); }
        sdk.state.share_rows = [row];
      });
    }
  });

  function applyScoreGlue(sdk, base, info) {
    var fn = sdk.glue("score");
    if (!fn) return base;
    var out;
    try { out = fn(info); } catch (e) { out = undefined; }
    return typeof out === "number" && isFinite(out) ? clamp(Math.round(out), 0, 100000) : base;
  }

  B.defineConcept({
    id: "score.quick_answer", kind: "score", version: 1, formulas: ["nextline"],
    describe: "Points for picking the real next line: `base` for a right pick plus up to `speed_bonus` for time left on the timer, all times a streak multiplier (1× for the first right answer in a row, then + `streak_step` per answer in a row, up to `max_multiplier`). Wrong picks and time-outs score 0 and reset the multiplier. The score glue gets {base, correct, streak, multiplier, left, elapsed, round, rounds}.",
    examples: ["500 + up to 500 for speed, ×1.5 for 2 in a row, up to ×3"],
    params: {
      base: { type: "integer", default: 500, min: 50, max: 2000, describe: "Points for a right pick." },
      speed_bonus: { type: "integer", default: 500, min: 0, max: 2000, describe: "Most extra points for an instant answer, scaled by time left." },
      streak_step: { type: "number", default: 0.5, min: 0, max: 1, describe: "Multiplier added per right answer in a row." },
      max_multiplier: { type: "number", default: 3, min: 1, max: 5, describe: "Highest streak multiplier." }
    },
    consumes: ["round.result"], emits: [], requires: ["rule.next_line"], conflicts: [],
    tags: { competition: ["friendly", "competitive"] },
    state: "nextline_score: {last, mult}",
    glue: ["score"],
    setup: function (sdk, params) {
      var st = sdk.state.nextline_score = { last: 0, mult: 1 };
      sdk.hud.label = "points";
      sdk.on("round.result", function (e) {
        if (!e.correct) { st.last = 0; st.mult = 1; return; }
        var mult = Math.min(params.max_multiplier, 1 + params.streak_step * Math.max(0, e.streak - 1));
        var base = Math.round((params.base + params.speed_bonus * clamp(e.left, 0, 1)) * mult);
        var pts = applyScoreGlue(sdk, base, { base: base, correct: true, streak: e.streak, multiplier: mult, left: e.left, elapsed: e.elapsed, round: e.index, rounds: e.total });
        st.last = pts;
        st.mult = Math.min(params.max_multiplier, 1 + params.streak_step * e.streak);
        sdk.addScore(pts, { x: e.x, y: e.y });
      });
    }
  });

  // ---- validation ------------------------------------------------------------------------------
  function validateContent(content) {
    var out = [];
    function bad(message, path) { out.push({ code: "content", message: message, path: "content" + (path || "") }); }
    if (!content || typeof content !== "object") { bad("content must be an object with episodes"); return out; }
    var eps = content.episodes;
    if (!Array.isArray(eps) || eps.length < 2) { bad("episodes must be a list of 2–6 scenes", ".episodes"); return out; }
    if (eps.length > 6) bad("at most 6 episodes", ".episodes");
    eps.forEach(function (e, i) {
      var p = ".episodes[" + i + "]";
      if (!e || typeof e !== "object") { bad("episode must be an object", p); return; }
      if (!isStr(e.title) || e.title.length > 40) bad("title is required (40 characters max)", p + ".title");
      if (e.setting != null && (typeof e.setting !== "string" || e.setting.length > 80)) bad("setting must be a short string (80 characters max)", p + ".setting");
      var names = [];
      if (!Array.isArray(e.cast) || e.cast.length < 2 || e.cast.length > 3) bad("cast must have 2–3 characters", p + ".cast");
      else e.cast.forEach(function (c, k) {
        var cp = p + ".cast[" + k + "]";
        if (!c || !isStr(c.name) || c.name.length > 14) bad("each character needs a short name (14 characters max)", cp + ".name");
        else if (names.indexOf(lower(c.name)) >= 0) bad("character names must be different", cp + ".name");
        else names.push(lower(c.name));
        if (c && c.shape != null && SHAPES.indexOf(c.shape) < 0) bad("shape must be one of " + SHAPES.join(", "), cp + ".shape");
        if (c && c.role != null && ROLES.indexOf(c.role) < 0) bad("role must be one of " + ROLES.join(", "), cp + ".role");
      });
      if (!Array.isArray(e.lines) || e.lines.length < 2 || e.lines.length > 6) bad("lines must have 2–6 lines of dialogue", p + ".lines");
      else e.lines.forEach(function (l, k) {
        var lp = p + ".lines[" + k + "]";
        if (!l || !isStr(l.text) || l.text.length > 70) bad("each line needs text (70 characters max)", lp + ".text");
        if (!l || names.indexOf(lower(l.who)) < 0) bad("who must be one of the cast's names", lp + ".who");
      });
      if (names.indexOf(lower(e.next_who)) < 0) bad("next_who must be one of the cast's names", p + ".next_who");
      if (!isStr(e.answer) || e.answer.length > 60) bad("answer is the real next line (60 characters max)", p + ".answer");
      if (!Array.isArray(e.decoys) || e.decoys.length !== 3) bad("decoys must be exactly 3 wrong next lines", p + ".decoys");
      else {
        var seen = [lower(e.answer)];
        e.decoys.forEach(function (d, k) {
          var dp = p + ".decoys[" + k + "]";
          if (!isStr(d) || d.length > 60) bad("each decoy is a line (60 characters max)", dp);
          else if (seen.indexOf(lower(d)) >= 0) bad("decoys must differ from the answer and each other", dp);
          else seen.push(lower(d));
        });
      }
      if (e.reveal_emoji != null && (typeof e.reveal_emoji !== "string" || e.reveal_emoji.length > 8)) bad("reveal_emoji must be one emoji", p + ".reveal_emoji");
    });
    return out;
  }

  // ---- bot -------------------------------------------------------------------------------------
  // Right with probability 0.35 + 0.6 × skill; faster with skill; a weak bot sometimes lets the
  // timer run out. Uses botRng only.
  function decide(sdk) {
    var a = sdk.state.nextline;
    if (!a || a.phase !== "ask" || a.over || sdk.state.choices_locked) return [];
    var m = botMem(sdk);
    var skill = skillOf(sdk);
    function rnd() { return sdk.botRng(); }
    if (m.round !== a.index || m.roundStart !== a.t0) {
      m.round = a.index; m.roundStart = a.t0; m.done = false;
      var think = 0.7 + (3.4 - 2.6 * skill) * (0.6 + 0.8 * rnd());
      think = Math.min(think, a.seconds - 0.4);
      m.at = a.t0 + Math.max(24, Math.round(think * 60));
      m.pick = rnd() < 0.35 + 0.6 * skill ? a.answerTile : (a.answerTile + 1 + Math.floor(rnd() * 3)) % 4;
      if (rnd() < 0.12 * (1 - skill)) m.at = a.t0 + a.seconds * 60 + 30;
    }
    if (!m.done && sdk.tick >= m.at) {
      m.done = true;
      var t = tileBox(m.pick);
      var dx = (rnd() - 0.5) * t.w * 0.6, dy = (rnd() - 0.5) * t.h * 0.5;
      return [{ a: "tap", v: [Math.round((t.x + dx) * 10) / 10, Math.round((t.y + dy) * 10) / 10] }];
    }
    return [];
  }

  function share(sdk) {
    var a = sdk.state.nextline;
    var m = sdk.manifest || {};
    var title = (m.style && m.style.emoji ? m.style.emoji + " " : "") + (m.title || "Game");
    if (!a) return { headline: title, score_text: sdk.score + " points" };
    var played = a.results.filter(function (r) { return !!r; });
    var marks = played.map(function (r) { return r.mark; });
    var rounds = played.map(function (r) { return (r.index + 1) + ":" + r.seconds.toFixed(1) + ":" + (r.correct ? 1 : 0) + ":" + r.points; });
    var head = "right=" + a.right + "/" + played.length + ";streak=" + a.bestStreak;
    var tag = head + ";r=" + rounds.join("|");
    if (tag.length > 120) tag = head + ";r=" + played.map(function (r) { return (r.index + 1) + ":" + r.seconds.toFixed(1) + ":" + (r.correct ? 1 : 0); }).join("|");
    if (tag.length > 120) tag = head;
    return {
      headline: title,
      score_text: sdk.score + " points · " + a.right + "/" + played.length + " right",
      emoji_grid: marks.join(""),
      tag: tag
    };
  }

  // ---- formula ---------------------------------------------------------------------------------
  B.defineFormula({
    id: "nextline",
    title: "Next line",
    describe: "Guess what they say next: a short, original scripted scene (2–3 simple characters with typed speech bubbles) freezes right before the punchline; pick the real next line from four tiles against the clock. Right and fast scores more, streaks multiply, then the reveal. A party game for quiz nights in Groups and group chats. A run is 3–6 scenes, 40–90 seconds.",
    core: ["space.nextline_stage", "entity.line_tiles", "input.select", "rule.next_line", "score.quick_answer"],
    optional: ["feel.mood_preset", "share.score_card"],
    tips: [
      "Write 5 short original scenes; 2–3 characters with neutral names; 4–5 lines each, under 50 characters per line.",
      "The real next line is funny and in character; the 3 decoys are plausible and similar in length and tone, but clearly wrong in context.",
      "No real people, shows, quotes, brands or celebrities. Family-friendly.",
      "round_seconds 8 suits most groups; raise it to 10–12 for long lines."
    ],
    content: {
      describe: "episodes: 2–6 scenes of {title (≤ 40), setting (optional, ≤ 80: one line shown before the scene), cast: 2–3 of {name (≤ 14), shape: blob|square|tall|round|star, role: primary|secondary|accent (its color)}, lines: 2–6 of {who (a cast name), text (≤ 70)}, next_who (the cast name who says the punchline), answer (the real next line, ≤ 60), decoys (exactly 3 wrong next lines, ≤ 60 each, different from the answer), reveal_emoji (one emoji for the reveal)}.",
      schema: {
        type: "object", required: ["episodes"],
        properties: {
          episodes: {
            type: "array", minItems: 2, maxItems: 6,
            items: {
              type: "object", required: ["title", "cast", "lines", "next_who", "answer", "decoys"],
              properties: {
                title: { type: "string", minLength: 1, maxLength: 40 },
                setting: { type: "string", maxLength: 80 },
                cast: { type: "array", minItems: 2, maxItems: 3, items: { type: "object", required: ["name"], properties: { name: { type: "string", maxLength: 14 }, shape: { type: "string", enum: SHAPES }, role: { type: "string", enum: ROLES } } } },
                lines: { type: "array", minItems: 2, maxItems: 6, items: { type: "object", required: ["who", "text"], properties: { who: { type: "string" }, text: { type: "string", maxLength: 70 } } } },
                next_who: { type: "string" },
                answer: { type: "string", minLength: 1, maxLength: 60 },
                decoys: { type: "array", minItems: 3, maxItems: 3, items: { type: "string", minLength: 1, maxLength: 60 } },
                reveal_emoji: { type: "string", maxLength: 8 }
              }
            }
          }
        }
      }
    },
    validateContent: validateContent,
    length: { modes: ["rounds", "timed", "lives"], default: { mode: "rounds", rounds: 5 }, knobs: { timer: { concept: "rule.next_line", param: "round_seconds", label: "Seconds to answer" } } },
    bot: { describe: "Thinks 1–5 s (faster with skill), then picks the real line with probability 0.35 + 0.6 × skill, else a decoy; weak bots sometimes let the timer run out.", decide: decide },
    share: share,
    example: {
      id: "example-nextline-potluck", version: 1, engine_version: 1,
      title: "Potluck Plans",
      one_line_rule: "Guess what they say next.",
      formula: "nextline",
      brief: { intent: "laugh together at a quiz night", audience: "everyone", mood: ["playful", "silly"], energy: "medium", competition: "friendly", occasion: "party" },
      structure: { cadence: "endless", scope: "everyone", setter: "ai" },
      lineage: { parent: null, operators: [], remix_of: null },
      chain: null,
      style: { look: "paper", palette: "lilac-haze", font: "rounded", motif: "dots", emoji: "🥘", mood_preset: "playful" },
      concepts: [
        { use: "space.nextline_stage" },
        { use: "entity.line_tiles" },
        { use: "input.select" },
        { use: "rule.next_line", params: { round_seconds: 8 } },
        { use: "score.quick_answer" }
      ],
      glue: {},
      content: {
        episodes: [
          {
            title: "The sign-up sheet", setting: "Planning the office potluck.",
            cast: [{ name: "Ada", shape: "round", role: "primary" }, { name: "Rio", shape: "square", role: "secondary" }],
            lines: [
              { who: "Ada", text: "Potluck sign-up. Rio, what are you bringing?" },
              { who: "Rio", text: "Napkins." },
              { who: "Ada", text: "You brought napkins last time." },
              { who: "Ada", text: "And the time before that." }
            ],
            next_who: "Rio", answer: "I'm known for my napkins. It's my brand.",
            decoys: ["Okay, I'll bring a lasagna this time.", "What is everyone else bringing?", "Can I bring a friend along?"],
            reveal_emoji: "🧻"
          },
          {
            title: "The mystery dish", setting: "Something is in a blue container.",
            cast: [{ name: "Noor", shape: "blob", role: "accent" }, { name: "Rio", shape: "square", role: "secondary" }, { name: "Ada", shape: "round", role: "primary" }],
            lines: [
              { who: "Noor", text: "What's in the blue container?" },
              { who: "Rio", text: "It's a family recipe." },
              { who: "Noor", text: "It's... moving a little." },
              { who: "Ada", text: "Rio, what's the recipe called?" }
            ],
            next_who: "Rio", answer: "We just call it Surprise.",
            decoys: ["It's my grandma's potato salad.", "It's from the corner store.", "It needs five more minutes."],
            reveal_emoji: "🫕"
          },
          {
            title: "Too many desserts", setting: "Counting what everyone signed up for.",
            cast: [{ name: "Ada", shape: "round", role: "primary" }, { name: "Noor", shape: "blob", role: "accent" }],
            lines: [
              { who: "Ada", text: "Quick count: how many desserts?" },
              { who: "Noor", text: "Seven pies, two cakes, one brownie tray." },
              { who: "Ada", text: "And main dishes?" },
              { who: "Noor", text: "Just Rio's napkins." }
            ],
            next_who: "Ada", answer: "Perfect. Dessert is dinner tonight.",
            decoys: ["Let's order sandwiches for everyone.", "I'll cancel the whole potluck.", "Who brought all those pies?"],
            reveal_emoji: "🥧"
          },
          {
            title: "Seating chart", setting: "Twelve guests, eight chairs.",
            cast: [{ name: "Rio", shape: "square", role: "secondary" }, { name: "Noor", shape: "blob", role: "accent" }, { name: "Ada", shape: "round", role: "primary" }],
            lines: [
              { who: "Rio", text: "We have twelve people and eight chairs." },
              { who: "Noor", text: "The cooler can be a chair." },
              { who: "Ada", text: "So can the recycling bin." },
              { who: "Rio", text: "And where do I sit?" }
            ],
            next_who: "Noor", answer: "You get the throne of napkins.",
            decoys: ["You can sit right next to me.", "We'll borrow chairs from next door.", "You can stand by the door."],
            reveal_emoji: "👑"
          },
          {
            title: "Cleanup crew", setting: "The party's over.",
            cast: [{ name: "Ada", shape: "round", role: "primary" }, { name: "Noor", shape: "blob", role: "accent" }, { name: "Rio", shape: "square", role: "secondary" }],
            lines: [
              { who: "Ada", text: "Great potluck, everyone!" },
              { who: "Noor", text: "Who's helping clean up?" },
              { who: "Rio", text: "Don't worry. I came prepared." },
              { who: "Ada", text: "Prepared how?" }
            ],
            next_who: "Rio", answer: "Three hundred napkins.",
            decoys: ["I brought a dishwasher.", "I hired a cleaning crew.", "I'll take the trash out."],
            reveal_emoji: "✨"
          }
        ]
      },
      seed: 2026111302
    }
  });
})();
