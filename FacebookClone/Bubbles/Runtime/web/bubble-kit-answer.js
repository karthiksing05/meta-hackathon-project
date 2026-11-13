// Bubble kit: answer. See docs/BUBBLES.md, 4.6. Kits only call Bubble.defineFormula and Bubble.defineConcept.
//
// Rounds of quick picks. Each round shows a prompt and 2–4 choice bubbles. Scoring is either
// against an answer key (rule.answer_key + score.answer_points) or against the crowd's votes
// (rule.consensus + score.closeness: "guess what New in SF picked"), where the reveal fills each
// bubble with its share of the vote.
//
// Reuses the common kit: input.select taps the bubbles (state.choices), flow.rounds paces the
// rounds and decides success (without it the rule paces them and the run succeeds after the last
// round), rule.lives turns misses into lost lives (a miss emits entity.hit), share.emoji_grid
// reads state.share_rows.
//
// State: state.answer (rounds, progress, results; the rule), state.answer_stage (the space),
// state.choices / state.choices_locked (for input.select), state.answer_score.
//
// Length (docs/BUBBLES.md 7.9): rounds from content by default. Rounds: length.rounds questions
// (content cycles). Timed, lives and endless keep asking: the clock ends a timed run; misses spend
// lives (rule.lives, else sdk.lengthMiss); endless ends on the first miss unless rule.lives is there.
(function () {
  "use strict";
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var B = root.Bubble;
  if (!B || typeof B.defineConcept !== "function" || typeof B.defineFormula !== "function") return;

  var W = 360;
  var MARK = { top: "🎯", crowd_miss: "🫧", right: "✨", wrong: "💥", timeout: "💨", none: "▫️" };
  var LEAD_IN = 12;

  // ---- small helpers -------------------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function isStr(v) { return typeof v === "string" && v.trim().length > 0; }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); }
  function skillOf(sdk) {
    var s = sdk.botSkill;
    if (typeof s !== "number" && sdk.bot && typeof sdk.bot.skill === "number") s = sdk.bot.skill;
    return clamp(typeof s === "number" && isFinite(s) ? s : 0.7, 0, 1);
  }
  // Bot memory lives outside game state (sdk.botState), so a recorded bot run replays identically.
  var memo = typeof WeakMap === "function" ? new WeakMap() : null;
  function botMem(sdk) {
    var holder = sdk.botState && typeof sdk.botState === "object" ? sdk.botState : null;
    if (!holder) {
      holder = memo ? memo.get(sdk.state) : sdk.state.__answerBot;
      if (!holder) { holder = {}; if (memo) memo.set(sdk.state, holder); else sdk.state.__answerBot = holder; }
    }
    if (!holder.answer || sdk.tick < holder.answer.lastTick) holder.answer = { lastTick: 0 };
    holder.answer.lastTick = sdk.tick;
    return holder.answer;
  }
  function choiceLabel(c) {
    if (typeof c === "string") return c;
    if (c && typeof c === "object") return String(c.label || c.name || c.text || "");
    return String(c);
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
  function mixHex(a, b, t) {
    var x = hexRgb(a), y = hexRgb(b);
    if (!x || !y) return a;
    var r = Math.round(x[0] + (y[0] - x[0]) * t), gg = Math.round(x[1] + (y[1] - x[1]) * t), bl = Math.round(x[2] + (y[2] - x[2]) * t);
    return "#" + ((1 << 24) + (r << 16) + (gg << 8) + bl).toString(16).slice(1);
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
  // Outline color: the look's own line color, else white glass in soft looks and ink elsewhere.
  function edge(g, ro) { return ro.line || (glossy(g) ? ro.surface : ro.ink); }


  // ---- content model ---------------------------------------------------------------------------
  // Normalizes content into rounds, optionally shuffling round and choice order with the seeded
  // RNG (the answer index, votes and voters move with their choice).
  function buildRounds(sdk, mode, shuffleRounds, shuffleChoices) {
    var content = sdk.content || {};
    var list = Array.isArray(content.rounds) ? content.rounds : [];
    var rounds = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var labels = (Array.isArray(r.choices) ? r.choices : []).slice(0, 4).map(choiceLabel);
      if (labels.length < 2 || !isStr(r.prompt)) continue;
      var n = labels.length;
      var votes = null;
      if (Array.isArray(r.votes) && r.votes.length === n) votes = r.votes.map(function (v) { return Math.max(0, num(v, 0)); });
      var voters = null;
      if (Array.isArray(r.voters) && r.voters.length === n) voters = r.voters.map(function (v) { return Array.isArray(v) ? v.filter(isStr).slice(0, 6) : []; });
      var answer = typeof r.answer === "number" && r.answer >= 0 && r.answer < n ? Math.floor(r.answer) : -1;
      var order = [];
      for (var k = 0; k < n; k++) order.push(k);
      if (shuffleChoices) order = sdk.shuffle(order);
      var round = {
        prompt: String(r.prompt),
        note: isStr(r.note) ? String(r.note) : "",
        choices: order.map(function (o) { return labels[o]; }),
        answer: answer >= 0 ? order.indexOf(answer) : -1,
        votes: votes ? order.map(function (o) { return votes[o]; }) : null,
        voters: voters ? order.map(function (o) { return voters[o]; }) : null,
        shares: null,
        top: []
      };
      if (round.votes) {
        var total = 0, best = -1;
        round.votes.forEach(function (v) { total += v; if (v > best) best = v; });
        round.shares = round.votes.map(function (v) { return total > 0 ? v / total : 0; });
        round.votes.forEach(function (v, idx) { if (v === best && total > 0) round.top.push(idx); });
      }
      if (mode === "crowd" && !(round.votes && round.top.length)) continue;
      if (mode === "key" && round.answer < 0) continue;
      rounds.push(round);
    }
    if (shuffleRounds) rounds = sdk.shuffle(rounds);
    return rounds.slice(0, 12);
  }

  // Choice bubbles for n choices, in logical playfield coordinates.
  function layoutFor(n, scale) {
    var s = clamp(num(scale, 1), 0.8, 1.15);
    var pts;
    if (n <= 2) pts = [[94, 396, 76], [266, 396, 76]];
    else if (n === 3) pts = [[100, 360, 68], [260, 360, 68], [180, 492, 68]];
    else pts = [[100, 346, 65], [260, 346, 65], [100, 494, 65], [260, 494, 65]];
    return pts.slice(0, Math.max(2, n)).map(function (p, i) { return { x: p[0], y: p[1], r: Math.round(p[2] * s), value: i }; });
  }

  // ---- render helpers --------------------------------------------------------------------------
  // Wrapping in the look's font.
  function wrapLines(g, text, size, weight, maxW) {
    if (g.wrapText) return g.wrapText(String(text), maxW, size, weight);
    return [String(text)];
  }
  function fitText(g, text, maxW, maxH, big, small, maxLines, weight) {
    var best = null;
    for (var size = big; size >= small; size -= 1) {
      var lines = wrapLines(g, text, size, weight, maxW);
      best = { lines: lines, size: size };
      if (lines.length <= maxLines && lines.length * size * 1.18 <= maxH) return best;
    }
    return best;
  }
  function drawLines(g, fit, x, y, o) {
    var lh = fit.size * 1.16;
    var y0 = y - (fit.lines.length - 1) * lh / 2;
    for (var i = 0; i < fit.lines.length; i++) {
      g.text(fit.lines[i], x, y0 + i * lh, { size: fit.size, weight: o.weight || 800, color: o.color, glow: o.glow, alpha: o.alpha, maxWidth: o.maxWidth });
    }
  }

  // ---- concepts --------------------------------------------------------------------------------

  B.defineConcept({
    id: "space.answer_stage", kind: "space", version: 1, formulas: ["answer"],
    describe: "The answer stage: a prompt card on top and 2–4 big choice bubbles below it (side by side for 2, a triangle for 3, a 2×2 grid for 4) that input.select taps. Shows an optional timer bar and the reveal: the right answer lights up with a check, or every bubble fills with its share of the crowd's votes and the favorite gets a crown.",
    examples: ["this-or-that picks for a Group", "four-way trivia about the city", "who-said-it icebreaker with 3 names"],
    params: {
      bubble_scale: { type: "number", default: 1, min: 0.8, max: 1.15, describe: "Size of the choice bubbles (1 = fills the stage). Lower it for long labels with 4 choices." },
      progress: { type: "boolean", default: true, describe: "Show a dot per round above the prompt when flow.rounds isn't drawing its own." }
    },
    consumes: ["round.start", "round.result?"], emits: [], requires: ["input.select"], conflicts: [],
    tags: { mood: ["playful", "curious", "cozy", "warm"], energy: ["low", "medium"] },
    state: "answer_stage: {round}; choices: [{x, y, r, value}] for input.select",
    glue: [],
    setup: function (sdk, params) {
      var stage = sdk.state.answer_stage = { round: -1, scale: params.bubble_scale };
      sdk.state.choices = [];
      sdk.state.choices_locked = true;
      sdk.on("round.start", function (e) {
        var a = sdk.state.answer;
        var round = a && a.rounds[e.index];
        stage.round = e.index;
        sdk.state.choices = round ? layoutFor(round.choices.length, params.bubble_scale) : [];
      });
      var flowDots = sdk.has("flow.rounds");

      sdk.layer(10, function (g) {
        var a = sdk.state.answer;
        if (!a || !a.rounds.length) return;
        var ro = roles(g.palette);
        var idx = clamp(a.index, 0, a.rounds.length - 1);
        var round = a.rounds[idx];
        var total = a.total();
        if (params.progress && !flowDots && !a.unbounded) {
          var gap = 20, x0 = W / 2 - (total - 1) * gap / 2;
          for (var i = 0; i < total; i++) {
            var res = a.results[i];
            if (res) g.orb(x0 + i * gap, 84, 5.5, res.good ? ro.good : res.timedOut ? ro.ink : ro.danger, { glow: res.timedOut ? 0 : 0.8, alpha: res.timedOut ? 0.3 : 1 });
            else if (i === a.index && a.phase === "ask") g.bubble(x0 + i * gap, 84, 7 + Math.sin(g.t * 6) * 0.8, { tint: ro.primary, glow: 1 });
            else g.circle(x0 + i * gap, 84, 4, ro.ink, 0.25);
          }
        }
        // Prompt card.
        g.pill(20, 104, 320, 128, { fill: ro.card || ro.light, alpha: ro.card ? 1 : ro.dark ? 0.16 : 0.66, radius: 30, glow: 0.8, glowColor: ro.light });
        // Only the glow look strokes an unfilled pill; other looks give the card their own edge.
        if (lookOf(g) === "glow") g.pill(20, 104, 320, 128, { fill: null, stroke: edge(g, ro), strokeWidth: 2, radius: 30 });
        var head = (a.crowd ? a.crowd + " · " : "") + "Round " + (idx + 1) + (a.unbounded ? "" : " of " + total);
        g.text(head, W / 2, 126, { size: 12, weight: 700, color: ro.ink, alpha: 0.65, maxWidth: 290 });
        var fit = fitText(g, round.prompt, 284, 84, 26, 15, 3, 800);
        drawLines(g, fit, W / 2, 176, { color: ro.ink, weight: 800, maxWidth: 296 });
        if (a.seconds > 0) {
          var res2 = a.results[a.index];
          var left = a.phase === "ask" ? clamp(1 - (sdk.tick - a.t0) / (a.seconds * 60), 0, 1) : res2 && !res2.timedOut ? a.leftAtPick : 0;
          g.pill(60, 242, 240, 6, { fill: ro.ink, alpha: 0.12, radius: 3 });
          if (left > 0) g.pill(60, 242, Math.max(6, 240 * left), 6, { fill: left < 0.3 ? ro.danger : ro.primary, radius: 3, glow: left < 0.3 ? 1 : 0, glowColor: ro.danger });
        }
      });

      sdk.layer(20, function (g) {
        var a = sdk.state.answer;
        if (!a || !a.rounds.length || (a.phase === "wait" && !g.poster)) return;
        var ro = roles(g.palette), ctx = g.ctx;
        var round = a.rounds[clamp(a.index, 0, a.rounds.length - 1)];
        var res = a.results[a.index];
        var revealing = a.phase !== "ask" && !!res;
        var p = revealing ? clamp((sdk.tick - a.revealAt) / Math.max(1, a.revealTicks * 0.55), 0, 1) : 0;
        var appear = clamp((sdk.tick - a.t0) / 14, 0, 1);
        var targets = sdk.state.choices && sdk.state.choices.length ? sdk.state.choices : g.poster ? layoutFor(round.choices.length, stage.scale) : [];
        for (var i = 0; i < targets.length && i < round.choices.length; i++) {
          var t = targets[i];
          var bob = Math.sin(g.t * 1.6 + i * 1.9) * 3;
          var pop = a.phase === "ask" ? 0.6 + 0.4 * easeOut(clamp(appear * 1.4 - i * 0.12, 0, 1)) : 1;
          var x = t.x, y = t.y + bob, r = t.r * pop;
          var tint = ro.series[i % ro.series.length];
          var picked = revealing && res.pick === i;
          var alpha = 1;
          if (picked) {
            var since = sdk.tick - a.revealAt;
            r = t.r * (1 + 0.08 * Math.max(0, 1 - since / 12) * Math.sin(Math.min(1, since / 12) * Math.PI));
          }
          if (revealing && a.mode === "key") {
            if (i === round.answer) r *= 1 + 0.05 * easeOut(p);
            else if (!picked) alpha = 1 - 0.45 * p;
            if (picked && !res.good) x += Math.sin((sdk.tick - a.revealAt) * 1.3) * 6 * Math.max(0, 1 - (sdk.tick - a.revealAt) / 24);
            if (i === round.answer) g.orb(x, y, r + 10, ro.good, { alpha: 0.35 * p, glow: 1 });
          }
          // During a crowd reveal the bubble goes pale so its vote fill (full color) reads in every look.
          var crowdFill = revealing && a.mode === "crowd" && round.shares;
          g.bubble(x, y, r, { tint: crowdFill ? mixHex(tint, ro.light, 0.6) : tint, alpha: alpha, wobble: 1, glow: 1 });
          // Crowd reveal: each bubble fills with its share of the vote.
          if (revealing && a.mode === "crowd" && round.shares) {
            var share = round.shares[i] * easeOut(p);
            // The fill: a level of the bubble's color with a gently bobbing surface, masked to the
            // bubble (the clip is only a mask; the shapes are g primitives).
            var level = y + r - 2 * r * share;
            ctx.save();
            ctx.beginPath(); ctx.arc(x, y, r - 3, 0, Math.PI * 2); ctx.clip();
            g.pill(x - r, level, 2 * r, y + r - level + 4, { fill: tint, alpha: 0.92, radius: 0 });
            for (var k = 0; k <= 12; k++) g.circle(x - r + 2 * r * k / 12, level + Math.sin(k * 0.9 + g.t * 5 + i) * 2.4 * (1 - 0.5 * p), r / 8, tint, 0.92);
            ctx.restore();
            g.ring(x, y, r - 3, glossy(g) ? ro.light : ro.ink, { width: 2.5, alpha: glossy(g) ? 0.9 : 0.5 });
            if (glossy(g)) g.circle(x - r * 0.38, y - r * 0.42, r * 0.16, ro.light, 0.55);
          }
          var lab = round.choices[i];
          if (revealing && a.mode === "crowd" && round.shares) {
            var pct = Math.round(round.shares[i] * 100 * easeOut(p));
            g.text(pct + "%", x, y - r * 0.12, { size: Math.round(r * 0.44), weight: 900, color: inkFor(g, ro, tint), glow: true, alpha: alpha });
            drawLines(g, fitText(g, lab, r * 1.45, r * 0.5, 15, 10, 2, 700), x, y + r * 0.36, { color: inkFor(g, ro, tint), weight: 700, alpha: 0.9, maxWidth: r * 1.6 });
          } else {
            drawLines(g, fitText(g, lab, r * 1.5, r * 1.1, r > 70 ? 21 : 19, 11, 3, 800), x, y, { color: inkFor(g, ro, tint), weight: 800, alpha: alpha * pop, maxWidth: r * 1.62 });
          }
          if (revealing && a.mode === "crowd" && round.top.indexOf(i) >= 0 && p > 0.6) g.emoji("👑", x + r * 0.62, y - r * 0.78, 22);
          if (revealing && a.mode === "key" && i === round.answer && p > 0.3) {
            g.orb(x + r * 0.68, y - r * 0.68, 13, ro.good, { glow: 1, ring: ro.light });
            g.text("✓", x + r * 0.68, y - r * 0.68, { size: 15, weight: 900, color: ro.inkOn(ro.good) });
          }
          if (picked) {
            g.pill(x - 22, y + r + 6, 44, 20, { fill: ro.ink, radius: 10, glow: 0.6, glowColor: ro.light });
            g.text("You", x, y + r + 16, { size: 11, weight: 800, color: ro.inkOn(ro.ink) });
          }
        }
        // While asking in crowd mode: say what the pick is about, under the lowest bubble.
        if (!revealing && a.mode === "crowd" && targets.length) {
          var lowAsk = 0;
          for (var q = 0; q < targets.length; q++) lowAsk = Math.max(lowAsk, targets[q].y + targets[q].r);
          g.text((a.crowd || "The group") + " voted. Guess their favorite!", W / 2, Math.min(600, lowAsk + 44), { size: 14, weight: 700, color: ro.ink, alpha: 0.6 * (g.poster ? 1 : appear), maxWidth: 320 });
        }
        // Reveal caption, just under the lowest bubble.
        if (revealing && p > 0.2) {
          var low = 0;
          for (var j = 0; j < targets.length; j++) low = Math.max(low, targets[j].y + targets[j].r);
          var cy = Math.min(592, low + 50);
          if (a.caption) g.text(a.caption, W / 2, cy, { size: 17, weight: 800, color: ro.ink, glow: true, alpha: clamp((p - 0.2) * 3, 0, 1), maxWidth: 330 });
          if (a.subcaption) g.text(a.subcaption, W / 2, cy + 24, { size: 13, weight: 700, color: ro.ink, alpha: 0.75 * clamp((p - 0.3) * 3, 0, 1), maxWidth: 330 });
        }
      });
    }
  });

  // Shared round logic for both scoring modes.
  function setupRounds(sdk, params, mode) {
    var rounds = buildRounds(sdk, mode, params.shuffle_rounds, params.shuffle_choices);
    var content = sdk.content || {};
    var driven = !sdk.has("flow.rounds");
    // Length (docs/BUBBLES.md 7.9): rounds mode plays exactly length.rounds rounds and a locked
    // timed, lives or endless length keeps going, so the content cycles; unbounded runs drop the
    // "of N" from the header. With no flow.rounds, misses spend lives or end an endless run here.
    var L = sdk.length || {};
    var unbounded = !!L.locked && !L.rounds;
    var contentCount = rounds.length;
    if (contentCount && (L.rounds || unbounded)) {
      var want = L.rounds || 200;
      for (var k = contentCount; k < want; k++) rounds.push(rounds[k % contentCount]);
      if (rounds.length > want) rounds.length = want;
    }
    var a = sdk.state.answer = {
      mode: mode,
      crowd: isStr(content.crowd) ? String(content.crowd).slice(0, 24) : "",
      rounds: rounds,
      index: 0,
      phase: "wait",
      t0: 0,
      revealAt: 0,
      revealTicks: Math.round(clamp(num(params.reveal_seconds, 1.6), 0.8, 3.5) * 60),
      seconds: num(params.round_seconds, 0) > 0 ? clamp(params.round_seconds, 4, 20) : 0,
      leftAtPick: 0,
      streak: 0,
      results: [],
      caption: "",
      subcaption: "",
      over: false,
      driven: driven,
      unbounded: unbounded,
      total: function () {
        if (unbounded) return Math.max(a.index + 1, a.results.length);
        var fr = sdk.state.rounds;
        return fr && typeof fr.total === "number" && !driven ? fr.total : rounds.length;
      }
    };
    // flow.rounds plays min(count, this).
    sdk.state.rounds_available = Math.max(1, rounds.length);

    function startRound(i) {
      if (i >= rounds.length) return;
      a.index = i;
      a.phase = "ask";
      a.t0 = sdk.tick;
      a.caption = ""; a.subcaption = "";
      sdk.state.choices_locked = false;
      if (driven) sdk.emit("round.start", { index: i, total: rounds.length });
    }

    function judge(pick) {
      var round = rounds[a.index];
      var timedOut = pick < 0;
      var elapsed = (sdk.tick - a.t0) / 60;
      a.leftAtPick = a.seconds > 0 ? clamp(1 - elapsed / a.seconds, 0, 1) : 0;
      var res = { index: a.index, pick: pick, timedOut: timedOut, elapsed: elapsed, good: false, correct: false, top: false, share: 0, near: false, mark: MARK.timeout };
      if (mode === "key") {
        res.correct = !timedOut && pick === round.answer;
        res.good = res.correct;
        res.mark = timedOut ? MARK.timeout : res.correct ? MARK.right : MARK.wrong;
        a.caption = timedOut ? "Time's up" : res.correct ? (a.streak >= 2 ? "Right! " + (a.streak + 1) + " in a row" : "Right!") : "So close";
        a.subcaption = res.correct ? round.note : "It was " + round.choices[round.answer] + (round.note ? " · " + round.note : "");
      } else {
        res.share = timedOut ? 0 : round.shares[pick];
        res.top = !timedOut && round.top.indexOf(pick) >= 0;
        res.good = res.top;
        res.near = !res.top && res.share >= 0.3;
        res.mark = timedOut ? MARK.timeout : res.top ? MARK.top : MARK.crowd_miss;
        var who = a.crowd || "the crowd";
        var fav = round.choices[round.top[0]];
        if (timedOut) a.caption = "Time's up · " + who + " picked " + fav;
        else if (res.top) a.caption = "You read the room · " + Math.round(res.share * 100) + "% agree";
        else a.caption = Math.round(res.share * 100) + "% agree · most picked " + fav;
        a.subcaption = "";
        if (!timedOut && round.voters && round.voters[pick] && round.voters[pick].length) {
          var names = round.voters[pick];
          a.subcaption = "Same as " + names.slice(0, 3).join(", ") + (names.length > 3 ? " +" + (names.length - 3) : "");
        } else if (round.note) a.subcaption = round.note;
      }
      a.streak = res.good ? a.streak + 1 : 0;
      res.streak = a.streak;
      a.results[a.index] = res;
      a.phase = "reveal";
      a.revealAt = sdk.tick;
      sdk.state.choices_locked = true;
      sdk.state.reveal_until = sdk.tick + a.revealTicks;
      var t = (sdk.state.choices || [])[pick];
      sdk.emit("round.result", {
        index: a.index, pick: pick, correct: res.correct, top: res.top, share: res.share,
        timed_out: timedOut, elapsed: elapsed, streak: a.streak, seconds: a.seconds, left: a.leftAtPick,
        total: a.total(), x: t ? t.x : W / 2, y: t ? t.y - t.r - 12 : 300
      });
      sdk.emit("guess.made", { correct: res.good });
      if (!res.good) sdk.emit("entity.hit", { x: t ? t.x : W / 2, y: t ? t.y : 380, reason: timedOut ? "timeout" : "miss", delay: a.revealTicks + 6 });
      if (driven && !res.good && L.locked && !sdk.ended && !sdk.has("rule.lives") && (L.mode === "endless" || (L.mode === "lives" && !sdk.lengthMiss()))) {
        a.over = true;
        sdk.emit("rule.fail", { reason: "length", rounds: a.index + 1 });
        sdk.end("fail", { delay: a.revealTicks + 6 });
      }
      if (!driven) sdk.emit("round.done", { correct: res.good });
      // Feel.
      if (res.good) {
        if (t) sdk.fx.pop(t.x, t.y, null, 22);
        if (t && sdk.fx.sparkle) sdk.fx.sparkle(t.x, t.y - t.r, null, 10);
        sdk.fx.sound("chime");
        sdk.fx.haptic("success");
      } else if (timedOut) {
        sdk.fx.sound("whoosh");
        sdk.fx.haptic("warning");
      } else {
        if (mode === "key") sdk.fx.shake(5);
        sdk.fx.sound(mode === "key" ? "fail" : "blip");
        sdk.fx.haptic(mode === "key" ? "warning" : "medium");
        if (t && mode === "crowd") sdk.fx.pop(t.x, t.y, null, 8);
      }
    }

    sdk.on("round.start", function (e) {
      if (driven || a.over) return;
      startRound(clamp(Math.floor(num(e.index, 0)), 0, rounds.length - 1));
    });
    // Driven runs (no flow.rounds) count their own rounds.
    sdk.on("round.end", function () { if (driven) sdk.lengthRound(); });

    sdk.on("input.select", function (e) {
      if (a.phase !== "ask" || a.over || sdk.ended) return;
      var round = rounds[a.index];
      var i = Math.floor(num(e.index, -1));
      if (i < 0 || i >= round.choices.length) return;
      sdk.fx.sound("blip");
      sdk.fx.haptic("selection");
      judge(i);
    });

    sdk.on("clock.tick", function () {
      if (a.over || sdk.ended) return;
      if (a.phase === "wait") {
        if (!rounds.length) { a.over = true; sdk.emit("rule.fail", { reason: "no_rounds" }); sdk.end("fail", { reason: "no_rounds" }); return; }
        if (driven && sdk.tick >= LEAD_IN) startRound(0);
        return;
      }
      if (a.phase === "ask") {
        var el = sdk.tick - a.t0;
        if (a.seconds > 0 && el >= a.seconds * 60) judge(-1);
        else if (a.seconds > 0 && el === Math.round((a.seconds - 3) * 60)) sdk.fx.sound("tick");
        return;
      }
      if (a.phase === "reveal" && driven && sdk.tick - a.revealAt >= a.revealTicks) {
        var res = a.results[a.index];
        sdk.emit("round.end", { index: a.index, correct: res.good });
        if (a.index + 1 >= rounds.length) {
          a.over = true; a.phase = "done";
          if (sdk.ended) return;
          sdk.emit("rule.success", { rounds: rounds.length });
          sdk.fx.sound("success");
          sdk.fx.haptic("success");
          sdk.end("success", { rounds: rounds.length });
        } else if (!sdk.ended) startRound(a.index + 1);
      }
    });

    // Share rows for share.emoji_grid: hit (matched), near (a big minority), miss, skip (time-out).
    sdk.on("flow.phase", function (e) {
      if (e.name !== "fail" && e.name !== "success") return;
      var row = [];
      for (var i = 0; i < a.total(); i++) {
        var r = a.results[i];
        row.push(!r ? "skip" : r.good ? "hit" : r.timedOut ? "skip" : r.near ? "near" : "miss");
      }
      sdk.state.share_rows = [row];
    });
  }

  var roundParams = function (revealDefault) {
    return {
      round_seconds: { type: "number", default: 0, min: 0, max: 20, describe: "Seconds to pick before the round times out (a time-out counts as a miss). 0 = untimed, best for icebreakers. Timed values below 4 become 4." },
      reveal_seconds: { type: "number", default: revealDefault, min: 0.8, max: 3.5, describe: "How long the reveal plays. With flow.rounds, set its pause to about this × 60 ticks." },
      shuffle_rounds: { type: "boolean", default: false, describe: "Play the rounds in a seeded random order instead of content order." },
      shuffle_choices: { type: "boolean", default: true, describe: "Show each round's choices in a seeded random order, so the answer isn't always in the same spot." }
    };
  };

  B.defineConcept({
    id: "rule.answer_key", kind: "rule", version: 1, formulas: ["answer"],
    describe: "Answer-key scoring (trivia): every round has one right choice (content rounds[].answer, an index into choices). The right pick is a hit; a wrong pick or time-out is a miss (emits entity.hit, so rule.lives can take a life). On reveal the right bubble lights up with a check and a wrong pick shakes. With flow.rounds it finishes each round (round.done); without it, it plays every round and the run succeeds after the last.",
    examples: ["SF trivia: which hill is tallest?", "Which neighborhood is this taqueria in?", "quiz the running club about race-day facts"],
    params: roundParams(1.4),
    consumes: ["input.select", "clock.tick", "round.start?"], emits: ["round.start", "round.done", "round.result", "round.end", "guess.made", "entity.hit", "rule.success", "rule.fail"],
    requires: ["space.answer_stage"], conflicts: ["rule.consensus"], ends: true, state: "answer: {rounds, index, phase, results}",
    tags: { mood: ["curious", "playful", "competitive"], energy: ["low", "medium"], competition: ["friendly", "competitive"] },
    glue: [],
    setup: function (sdk, params) { setupRounds(sdk, params, "key"); }
  });

  B.defineConcept({
    id: "rule.consensus", kind: "rule", version: 1, formulas: ["answer"],
    describe: "Consensus scoring (guess what the group picked): every round has the group's vote counts (content rounds[].votes, one number per choice). Pick what you think most people picked. On reveal every bubble fills with its share of the vote, the favorite gets a crown, and optional rounds[].voters names who agreed with you. Matching the favorite is a hit; anything else is a miss (emits entity.hit for rule.lives). With flow.rounds, its pass_ratio decides success (\"read the room in half the rounds\"); without it, the run succeeds after the last round.",
    examples: ["Fog or sun? Guess what New in SF picked", "picnic this-or-that: guess what the attendees chose", "which brunch spot won the Group poll"],
    params: roundParams(2.0),
    consumes: ["input.select", "clock.tick", "round.start?"], emits: ["round.start", "round.done", "round.result", "round.end", "guess.made", "entity.hit", "rule.success", "rule.fail"],
    requires: ["space.answer_stage"], conflicts: ["rule.answer_key"], ends: true, state: "answer: {rounds, index, phase, results}",
    tags: { mood: ["playful", "warm", "cozy", "social"], energy: ["low"], competition: ["light", "friendly"], occasion: ["icebreaker", "daily"] },
    glue: [],
    setup: function (sdk, params) { setupRounds(sdk, params, "crowd"); }
  });

  function applyScoreGlue(sdk, base, info) {
    var fn = sdk.glue("score");
    if (!fn) return base;
    var out;
    try { out = fn(info); } catch (e) { out = undefined; }
    return typeof out === "number" && isFinite(out) ? clamp(Math.round(out), 0, 100000) : base;
  }

  B.defineConcept({
    id: "score.answer_points", kind: "score", version: 1, formulas: ["answer"],
    describe: "Points for right answers: `points` per right pick, plus up to `speed_bonus` for answering fast (full bonus within 1.5 s, or by time left when rounds are timed), plus `streak_bonus` for each right answer in a row after the first. Wrong picks score 0. The score glue gets {base, correct, streak, elapsed, round, rounds}.",
    examples: ["100 per right answer, quick answers earn up to +50"],
    params: {
      points: { type: "integer", default: 100, min: 10, max: 1000, describe: "Points for a right answer." },
      speed_bonus: { type: "integer", default: 50, min: 0, max: 500, describe: "Most extra points for a fast answer. 0 turns speed off (calmer)." },
      streak_bonus: { type: "integer", default: 20, min: 0, max: 200, describe: "Extra points per right answer in a row (2nd in a row +1×, 3rd +2×...)." }
    },
    consumes: ["round.result"], emits: [], requires: ["rule.answer_key"], conflicts: [],
    tags: { competition: ["friendly", "competitive"] },
    state: "answer_score: {last, rights}",
    glue: ["score"],
    setup: function (sdk, params) {
      var st = sdk.state.answer_score = { last: 0, rights: 0 };
      sdk.hud.label = "points";
      sdk.on("round.result", function (e) {
        if (!e.correct) { st.last = 0; return; }
        var speed = e.seconds > 0 ? e.left : clamp(1 - (e.elapsed - 1.5) / 6.5, 0, 1);
        var base = params.points + Math.round(params.speed_bonus * speed) + params.streak_bonus * Math.max(0, e.streak - 1);
        var pts = applyScoreGlue(sdk, base, { base: base, correct: true, share: e.share, top: e.top, streak: e.streak, elapsed: e.elapsed, round: e.index, rounds: e.total });
        st.last = pts; st.rights += 1;
        sdk.addScore(pts, { x: e.x, y: e.y });
      });
    }
  });

  B.defineConcept({
    id: "score.closeness", kind: "score", version: 1, formulas: ["answer"],
    describe: "Points for reading the room: each round scores the share of the group that picked the same as you (59% agree = 59 points at scale 100), plus `top_bonus` when you picked the group's favorite. Time-outs score 0. The score glue gets {base, share, top, streak, elapsed, round, rounds}.",
    examples: ["59% agree: +59, plus 25 for matching the favorite"],
    params: {
      scale: { type: "integer", default: 100, min: 50, max: 500, describe: "Points for a pick that 100% of the group made." },
      top_bonus: { type: "integer", default: 25, min: 0, max: 200, describe: "Extra points for matching the group's favorite." }
    },
    consumes: ["round.result"], emits: [], requires: ["rule.consensus"], conflicts: [],
    tags: { competition: ["light", "friendly"], mood: ["warm", "social"] },
    state: "answer_score: {last, agree}",
    glue: ["score"],
    setup: function (sdk, params) {
      var st = sdk.state.answer_score = { last: 0, agree: 0 };
      sdk.hud.label = "points";
      sdk.on("round.result", function (e) {
        if (e.timed_out) { st.last = 0; return; }
        var base = Math.round(params.scale * e.share) + (e.top ? params.top_bonus : 0);
        var pts = applyScoreGlue(sdk, base, { base: base, correct: e.top, share: e.share, top: e.top, streak: e.streak, elapsed: e.elapsed, round: e.index, rounds: e.total });
        st.last = pts;
        if (e.top) st.agree += 1;
        if (pts > 0) sdk.addScore(pts, { x: e.x, y: e.y });
      });
    }
  });

  // ---- validation ------------------------------------------------------------------------------
  function validateContent(content, manifest) {
    var out = [];
    function bad(message, path, warning) { out.push({ code: "content", message: message, path: "content" + (path || ""), warning: !!warning }); }
    if (!content || typeof content !== "object") { bad("content must be an object with rounds"); return out; }
    var uses = {};
    if (manifest && Array.isArray(manifest.concepts)) manifest.concepts.forEach(function (c) { if (c && c.use) uses[c.use] = c; });
    var needKey = !!uses["rule.answer_key"], needVotes = !!uses["rule.consensus"];
    if (content.crowd != null && (typeof content.crowd !== "string" || content.crowd.length > 24)) bad("crowd must be a short name (24 characters max), e.g. \"New in SF\"", ".crowd");
    var rounds = content.rounds;
    if (!Array.isArray(rounds) || rounds.length < 2) { bad("rounds must be a list of 2–12 rounds", ".rounds"); return out; }
    if (rounds.length > 12) bad("at most 12 rounds", ".rounds");
    rounds.forEach(function (r, i) {
      var p = ".rounds[" + i + "]";
      if (!r || typeof r !== "object") { bad("round must be an object", p); return; }
      if (!isStr(r.prompt)) bad("prompt is required", p + ".prompt");
      else if (r.prompt.length > 90) bad("prompt is too long (90 characters max)", p + ".prompt");
      if (!Array.isArray(r.choices) || r.choices.length < 2 || r.choices.length > 4) { bad("choices must have 2–4 entries", p + ".choices"); return; }
      var seen = {};
      r.choices.forEach(function (c, k) {
        var lab = choiceLabel(c);
        if (!isStr(lab)) bad("choice must be a non-empty string", p + ".choices[" + k + "]");
        else if (lab.length > 32) bad("choice is too long (32 characters max)", p + ".choices[" + k + "]");
        var key = lab.trim().toLowerCase();
        if (seen[key]) bad("choices must be different", p + ".choices[" + k + "]");
        seen[key] = true;
      });
      var n = r.choices.length;
      var hasKey = typeof r.answer === "number";
      if (hasKey && (Math.floor(r.answer) !== r.answer || r.answer < 0 || r.answer >= n)) bad("answer must be an index into choices (0–" + (n - 1) + ")", p + ".answer");
      var hasVotes = r.votes != null;
      if (hasVotes) {
        if (!Array.isArray(r.votes) || r.votes.length !== n || r.votes.some(function (v) { return typeof v !== "number" || !isFinite(v) || v < 0; })) bad("votes must list one number ≥ 0 per choice", p + ".votes");
        else if (r.votes.reduce(function (s, v) { return s + v; }, 0) <= 0) bad("votes must add up to more than 0", p + ".votes");
      }
      if (r.voters != null && (!Array.isArray(r.voters) || r.voters.length !== n || r.voters.some(function (v) { return !Array.isArray(v); }))) bad("voters must list one array of first names per choice", p + ".voters");
      if (r.note != null && (typeof r.note !== "string" || r.note.length > 80)) bad("note must be a string (80 characters max)", p + ".note");
      if (needKey && !hasKey) bad("rule.answer_key needs answer (the index of the right choice)", p + ".answer");
      if (needVotes && !hasVotes) bad("rule.consensus needs votes (one count per choice)", p + ".votes");
      if (!needKey && !needVotes && !hasKey && !hasVotes) bad("each round needs answer (answer key) or votes (consensus)", p);
    });
    var flow = uses["flow.rounds"];
    if (flow) {
      var count = flow.params && typeof flow.params.count === "number" ? flow.params.count : 5;
      if (count < rounds.length) bad("flow.rounds count is " + count + ", so only " + count + " of the " + rounds.length + " rounds play", ".rounds", true);
      var pause = flow.params && typeof flow.params.pause === "number" ? flow.params.pause : 54;
      if (pause < 80) bad("flow.rounds pause is " + pause + " ticks; the answer reveal reads best with a pause of 90–130", ".rounds", true);
    }
    return out;
  }

  // ---- bot -------------------------------------------------------------------------------------
  function decide(sdk) {
    var a = sdk.state.answer, targets = sdk.state.choices;
    if (!a || a.phase !== "ask" || a.over || !targets || !targets.length || sdk.state.choices_locked) return [];
    var m = botMem(sdk);
    var skill = skillOf(sdk);
    function rnd() { return sdk.botRng(); }
    if (m.round !== a.index || m.roundStart !== a.t0) {
      var round = a.rounds[a.index];
      var n = round.choices.length;
      m.round = a.index; m.roundStart = a.t0; m.done = false;
      var think = 2.5 - 1.6 * skill + rnd() * 0.9 + (round.prompt.length > 40 ? 0.4 : 0);
      if (a.seconds > 0) think = Math.min(think, a.seconds * (0.45 + 0.4 * rnd()));
      m.at = a.t0 + Math.max(18, Math.round(think * 60));
      var pick;
      if (a.mode === "key") {
        pick = rnd() < 0.3 + 0.65 * skill ? round.answer : (round.answer + 1 + Math.floor(rnd() * (n - 1))) % n;
      } else if (rnd() < 0.25 + 0.65 * skill) {
        pick = round.top[Math.floor(rnd() * round.top.length)];
      } else {
        // Otherwise lean on the votes, like a person who half-knows the Group.
        var total = 0, k;
        for (k = 0; k < n; k++) total += round.votes[k] + 1;
        var roll = rnd() * total;
        pick = n - 1;
        for (k = 0; k < n; k++) { roll -= round.votes[k] + 1; if (roll < 0) { pick = k; break; } }
      }
      // A very weak bot sometimes just lets the timer run out.
      if (a.seconds > 0 && rnd() < 0.12 * (1 - skill)) m.at = a.t0 + a.seconds * 60 + 30;
      m.pick = pick;
    }
    if (!m.done && sdk.tick >= m.at) {
      m.done = true;
      var t = targets[m.pick];
      if (!t) return [];
      var ang = rnd() * 6.283, d = rnd() * t.r * 0.45;
      return [{ a: "tap", v: [Math.round((t.x + Math.cos(ang) * d) * 10) / 10, Math.round((t.y + Math.sin(ang) * d) * 10) / 10] }];
    }
    return [];
  }

  function share(sdk) {
    var a = sdk.state.answer;
    var m = sdk.manifest || {};
    var title = (m.style && m.style.emoji ? m.style.emoji + " " : "") + (m.title || "Game");
    if (!a) return { headline: title, score_text: sdk.score + " points" };
    var total = a.total();
    var marks = [];
    for (var i = 0; i < total; i++) marks.push(a.results[i] ? a.results[i].mark : MARK.none);
    var good = a.results.filter(function (r) { return r && r.good; }).length;
    var text = sdk.score + " points · " + good + "/" + total + (a.mode === "crowd" ? " with the crowd" : " right");
    return { headline: title, score_text: text, emoji_grid: marks.join("") };
  }

  // ---- formula ---------------------------------------------------------------------------------
  B.defineFormula({
    id: "answer", title: "Answer",
    describe: "Rounds of quick picks: read a prompt, tap one of 2–4 choice bubbles. Score against an answer key (trivia: rule.answer_key + score.answer_points) or against the group's votes (guess what the Group picked: rule.consensus + score.closeness), where the reveal fills each bubble with its share of the vote. Great for icebreakers and Daily Bubbles. A run is 3–8 rounds, 15–60 seconds.",
    core: ["space.answer_stage", "input.select", "rule.answer_key|rule.consensus", "score.answer_points|score.closeness"],
    optional: ["flow.rounds", "flow.daily_gate", "rule.lives", "share.emoji_grid", "share.score_card", "feel.mood_preset", "social.beat_marker"],
    tips: [
      "Pair rule.consensus with score.closeness and rule.answer_key with score.answer_points.",
      "flow.rounds paces the rounds: set count to the number of rounds, pause to 90–130 ticks so the reveal lands, and pass_ratio for what counts as a win (0 for icebreakers nobody should fail).",
      "rule.lives makes misses cost a life; leave it out for gentle icebreakers.",
      "Keep choices under 20 characters when there are 4 of them; an emoji in a choice reads well."
    ],
    content: {
      describe: "rounds: 2–12 rounds of {prompt, choices (2–4 short labels; an emoji in a label is fine), answer (index of the right choice, for rule.answer_key) or votes (one count per choice, for rule.consensus), optional voters (first names per choice, shown as \"Same as Maya, Diego\"), optional note (a fun fact shown on reveal)}. Optional crowd: who voted, e.g. \"New in SF\".",
      schema: {
        type: "object", required: ["rounds"],
        properties: {
          crowd: { type: "string", maxLength: 24 },
          rounds: {
            type: "array", minItems: 2, maxItems: 12,
            items: {
              type: "object", required: ["prompt", "choices"],
              properties: {
                prompt: { type: "string", minLength: 1, maxLength: 90 },
                choices: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", minLength: 1, maxLength: 32 } },
                answer: { type: "integer", minimum: 0, maximum: 3 },
                votes: { type: "array", minItems: 2, maxItems: 4, items: { type: "number", minimum: 0 } },
                voters: { type: "array", items: { type: "array", items: { type: "string", maxLength: 24 } } },
                note: { type: "string", maxLength: 80 }
              }
            }
          }
        }
      }
    },
    validateContent: validateContent,
    // Length (docs/BUBBLES.md 7.9): one pass through the content's rounds by default.
    length: {
      modes: ["rounds", "timed", "lives", "endless"],
      default: { mode: "rounds" },
      numbers: { rounds: 8, seconds: 60, lives: 3 },
      infer: { rounds: ["content:rounds"] },
      knobs: {
        timer: { concept: "rule.answer_key|rule.consensus", param: "round_seconds", label: "Seconds per question", min: 4, max: 15 },
        speed: { concept: "flow.rounds", param: "pause", label: "Pace", min: 70, max: 150, invert: true },
      },
      describe: "Rounds: questions. Timed: as many as you can. Lives: wrong answers you can take. Endless: until a wrong answer.",
    },
    bot: { describe: "Thinks for 1–3 s (faster with skill), then picks the right answer or the crowd favorite with probability 0.3–0.95 by skill; otherwise a plausible wrong pick weighted by the votes.", decide: decide },
    share: share,
    example: {
      id: "example-answer-crowd", version: 1, engine_version: 1,
      title: "Brunch or Bust?",
      one_line_rule: "Guess what most of New in SF picked.",
      formula: "answer",
      brief: { intent: "see what the Group thinks", audience: "group:group-newinsf", mood: ["playful", "warm"], energy: "low", competition: "light" },
      structure: { cadence: "endless", scope: "group:group-newinsf", setter: "ai" },
      lineage: { parent: null, operators: [], remix_of: null },
      chain: null,
      style: { look: "clay", palette: "mint-pop", font: "rounded", motif: "dots", emoji: "🥞", mood_preset: "playful" },
      concepts: [
        { use: "space.answer_stage" },
        { use: "input.select" },
        { use: "rule.consensus", params: { round_seconds: 8 } },
        { use: "score.closeness", params: { top_bonus: 25 } },
        { use: "flow.rounds", params: { count: 4, pause: 110, pass_ratio: 0.5 } },
        { use: "share.emoji_grid", params: { set: "smiles" } }
      ],
      glue: {},
      content: {
        crowd: "New in SF",
        rounds: [
          { prompt: "Sunday brunch?", choices: ["Sweet 🥞", "Savory 🍳"], votes: [44, 56] },
          { prompt: "Best seat in the park?", choices: ["Sunny hill", "Under a tree", "Near the tacos"], votes: [52, 19, 29] },
          { prompt: "Coffee order?", choices: ["Drip", "Oat latte", "Cold brew", "Tea, actually"], votes: [18, 41, 26, 15] },
          { prompt: "First thing to show a visitor?", choices: ["The bridge 🌉", "A burrito 🌯"], votes: [61, 39] }
        ]
      },
      seed: 2026
    }
  });
})();
