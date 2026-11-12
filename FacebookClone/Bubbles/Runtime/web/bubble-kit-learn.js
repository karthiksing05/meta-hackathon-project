// Bubble kit: learn. See docs/BUBBLES.md, 4.6 and 7.8. Kits only call Bubble.defineFormula and Bubble.defineConcept.
//
// A short lesson you learn together: a lesson card with 2–4 points, then practice questions with an
// explanation after every answer (right or wrong), then a recap of what you got and your mastery.
//
// Content: { topic, subject?, lesson: { title, points: [2–4] }, questions: [{ q, choices: [2–4],
// answer, explain, point? }] }. `point` links a question to the lesson point it practices, so the
// recap can tick off the points you know. `subject` is the short noun phrase the app uses for the
// Group meter ("the hills": "New in SF knows 82% of the hills").
//
// Concepts: space.lesson_desk draws everything, rule.lesson_practice runs the lesson (and ends the
// run), score.mastery scores right answers with a streak bonus. input.select (common) taps the
// choices, the start button and "next" (state.choices).
//
// Length contract (docs/BUBBLES.md 7.9): rounds (default: one per question), lives (3 wrong answers
// end the run) and endless (fresh order each pass, until the first miss). The kit calls
// sdk.lengthRound() after every question but the last of a locked rounds length (spending that
// one would end the run before the recap), and sdk.lengthMiss() on every miss.
//
// Share: score_text "7/8 mastered", tag "mastery=7/8;topic=hills-of-sf;miss=2,5" (miss: content
// indexes of the questions you missed). Events: learn.lesson_done, learn.question, learn.answer,
// learn.right, learn.wrong, learn.explain, learn.recap, round.start, round.end.
//
// State: state.learn (phase, questions, results; the rule), state.choices / state.choices_locked
// (for input.select).
(function () {
  "use strict";
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var B = root.Bubble;
  if (!B || typeof B.defineConcept !== "function" || typeof B.defineFormula !== "function") return;

  var W = 360, H = 640;
  // Layout (logical playfield). The engine's score HUD sits above y 100.
  var CARD_Y = 104, Q_CARD_H = 132, CHOICE_Y = 250, CHOICE_H = 54, CHOICE_GAP = 10;
  var EXPLAIN_Y = 506, EXPLAIN_H = 124;
  var LESSON_CARD_H = 440, START_Y = 562, START_H = 56;
  var ENDLESS_PASSES = 3;

  // ---- small helpers -------------------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function isStr(v) { return typeof v === "string" && v.trim().length > 0; }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); }
  function slug(s) {
    var out = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return out.slice(0, 32) || "lesson";
  }
  function choiceText(c) {
    if (typeof c === "string") return c;
    if (c && typeof c === "object") return String(c.label || c.text || "");
    return String(c);
  }
  function skillOf(sdk) {
    var s = sdk.botSkill;
    return clamp(typeof s === "number" && isFinite(s) ? s : 0.7, 0, 1);
  }

  // Normalized questions in content order (bad ones skipped), each remembering its content index.
  function readQuestions(content) {
    var list = content && Array.isArray(content.questions) ? content.questions : [];
    var out = [];
    for (var i = 0; i < list.length && out.length < 12; i++) {
      var q = list[i] || {};
      var choices = (Array.isArray(q.choices) ? q.choices : []).slice(0, 4).map(choiceText);
      var answer = Math.floor(num(q.answer, -1));
      if (!isStr(q.q) || choices.length < 2 || answer < 0 || answer >= choices.length) continue;
      out.push({
        src: i, q: String(q.q), choices: choices, answer: answer,
        explain: isStr(q.explain) ? String(q.explain) : "",
        point: typeof q.point === "number" && isFinite(q.point) ? Math.floor(q.point) : -1
      });
    }
    return out;
  }
  function readPoints(content) {
    var lesson = content && content.lesson && typeof content.lesson === "object" ? content.lesson : {};
    return (Array.isArray(lesson.points) ? lesson.points : []).filter(isStr).slice(0, 4).map(String);
  }

  // ---- look-friendly color helpers (LOOKS.md) ------------------------------------------------
  function lookOf(g) { return g.look || (g.palette && g.palette.look) || "glow"; }
  // Looks that outline or tint fills instead of painting them solid read best with the palette ink
  // on a light wash of the fill; the solid looks (paper, pixel, clay, riso) take the ink that reads
  // on the fill itself.
  function washes(g) { var lk = lookOf(g); return lk === "glow" || lk === "neon" || lk === "ink" || lk === "chalk"; }
  function fillStyle(g, color) {
    var pal = g.palette;
    if (washes(g)) return { fill: color, alpha: 0.34, ink: pal.ink, stroke: color };
    return { fill: color, alpha: 1, ink: typeof pal.inkOn === "function" ? pal.inkOn(color) : pal.ink, stroke: pal.line || null };
  }
  function cardFill(g) { return g.palette.surfaceStrong || g.palette.surface || g.palette.glow; }

  function fitText(g, text, maxW, maxH, big, small, maxLines, weight) {
    var best = null;
    for (var size = big; size >= small; size -= 1) {
      var lines = g.wrapText ? g.wrapText(String(text), maxW, size, weight) : [String(text)];
      best = { lines: lines, size: size };
      if (lines.length <= maxLines && lines.length * size * 1.2 <= maxH) return best;
    }
    if (best && best.lines.length > maxLines) {
      best.lines = best.lines.slice(0, maxLines);
      best.lines[maxLines - 1] = best.lines[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    }
    return best;
  }
  // Draws lines centered vertically on y (align "center") or from the top at y (align "left").
  function drawLines(g, fit, x, y, o) {
    var lh = fit.size * 1.2;
    var top = o.top ? y + lh / 2 : y - (fit.lines.length - 1) * lh / 2;
    for (var i = 0; i < fit.lines.length; i++) {
      g.text(fit.lines[i], x, top + i * lh, { size: fit.size, weight: o.weight || 700, color: o.color, align: o.align || "center", alpha: o.alpha, maxWidth: o.maxWidth });
    }
    return fit.lines.length * lh;
  }
  function card(g, x, y, w, h, o) {
    o = o || {};
    var pal = g.palette;
    // Translucent surfaces (glow, chalk, neon) get an opaque underlay so scenery and ambient
    // bubbles never show through the text.
    var fill = o.fill || cardFill(g);
    if (!o.fill && typeof fill === "string" && fill.charAt(0) !== "#" && pal.mid) g.pill(x, y, w, h, { fill: pal.mid, radius: o.radius || 24, alpha: (o.alpha === undefined ? 1 : o.alpha) * 0.92 });
    g.pill(x, y, w, h, { fill: fill, stroke: o.stroke || pal.line || null, strokeWidth: o.strokeWidth || 1.5, radius: o.radius || 24, alpha: o.alpha === undefined ? 1 : o.alpha, shade: o.shade });
  }

  // ---- layout ----------------------------------------------------------------------------------
  function choiceBoxes(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push({ x: W / 2, y: CHOICE_Y + i * (CHOICE_H + CHOICE_GAP) + CHOICE_H / 2, w: 304, h: CHOICE_H, value: i });
    return out;
  }
  var START_BOX = { x: W / 2, y: START_Y + START_H / 2, w: 300, h: START_H, value: "start" };
  var NEXT_BOX = { x: W / 2, y: H / 2, w: W, h: H, value: "next" };

  // ---- the rule --------------------------------------------------------------------------------
  function setupPractice(sdk, params) {
    var content = sdk.content || {};
    var base = readQuestions(content);
    var points = readPoints(content);
    var length = sdk.length || { mode: "rounds" };
    var mode = length.mode === "lives" || length.mode === "endless" ? length.mode : "rounds";
    var total = mode === "rounds" ? Math.max(1, Math.floor(num(length.rounds, base.length)) || base.length) : 0;
    if (mode === "rounds" && base.length) total = Math.min(total, base.length * ENDLESS_PASSES);
    var lives = mode === "lives" ? Math.max(1, Math.floor(num(length.lives, 3))) : 0;

    // One pass in content order (lesson order) with shuffled choices; later passes reshuffle.
    function pass(index) {
      var order = [];
      for (var i = 0; i < base.length; i++) order.push(i);
      if (index > 0 || params.shuffle_questions) order = sdk.shuffle(order);
      return order.map(function (k) {
        var q = base[k];
        var idx = [];
        for (var c = 0; c < q.choices.length; c++) idx.push(c);
        if (params.shuffle_choices) idx = sdk.shuffle(idx);
        return { src: q.src, q: q.q, explain: q.explain, point: q.point, choices: idx.map(function (o) { return q.choices[o]; }), answer: idx.indexOf(q.answer) };
      });
    }

    var L = sdk.state.learn = {
      phase: "lesson", mode: mode, total: total, lives: lives, livesLeft: lives,
      title: content.lesson && isStr(content.lesson.title) ? String(content.lesson.title) : sdk.manifest.title,
      topic: isStr(content.topic) ? String(content.topic) : sdk.manifest.title,
      points: points, queue: [], passes: 0, index: -1, current: null,
      results: [], right: 0, asked: 0, streak: 0, bestStreak: 0, missed: [],
      t0: 0, pickedAt: 0, pick: -1, good: false, over: false, outcome: null, endAt: 0,
      pointsKnown: [], serial: 0
    };
    sdk.hud.label = "points";
    // The desk shows "Question 3 of 8" or the hearts itself, so the engine's length chip is off.
    sdk.hud.length = false;
    sdk.state.choices = [START_BOX];
    sdk.state.choices_locked = true;

    function engineLives() {
      var left = sdk.lengthLeft ? sdk.lengthLeft() : null;
      return left && typeof left.lives_left === "number" ? left.lives_left : null;
    }

    function nextQuestion() {
      if (!L.queue.length) {
        if (L.passes >= ENDLESS_PASSES || !base.length) return null;
        L.queue = pass(L.passes);
        L.passes += 1;
      }
      return L.queue.shift();
    }

    function ask() {
      var q = nextQuestion();
      if (!q) { recap(); return; }
      L.index += 1;
      L.serial += 1;
      L.current = q;
      L.phase = "ask";
      L.pick = -1;
      L.t0 = sdk.tick;
      sdk.state.choices = choiceBoxes(q.choices.length);
      sdk.state.choices_locked = false;
      sdk.emit("round.start", { index: L.index, total: L.total || 0 });
      sdk.emit("learn.question", { index: L.index, src: q.src });
    }

    function judge(i) {
      var q = L.current;
      var good = i === q.answer;
      L.asked += 1;
      L.pick = i;
      L.good = good;
      L.pickedAt = sdk.tick;
      L.phase = "explain";
      sdk.state.choices_locked = true;
      var box = sdk.state.choices[i] || { x: W / 2, y: CHOICE_Y };
      if (good) {
        L.right += 1;
        L.streak += 1;
        if (L.streak > L.bestStreak) L.bestStreak = L.streak;
      } else {
        L.streak = 0;
        if (L.missed.indexOf(q.src) < 0) L.missed.push(q.src);
      }
      L.results.push({ src: q.src, good: good, point: q.point });
      sdk.emit("learn.answer", { index: L.index, src: q.src, correct: good, streak: L.streak, x: box.x, y: box.y });
      sdk.emit(good ? "learn.right" : "learn.wrong", { index: L.index, src: q.src });
      sdk.emit("round.end", { index: L.index, correct: good });
      sdk.emit("learn.explain", { index: L.index, src: q.src, correct: good });
      if (good) {
        sdk.fx.sound("chime");
        sdk.fx.haptic("success");
        sdk.fx.sparkle(box.x + 120, box.y, null, 8);
      } else {
        sdk.fx.sound("blip");
        sdk.fx.haptic("warning");
        sdk.fx.shake(3);
      }
      // A miss: lives and endless runs may end once the explanation is read.
      L.endsAfter = false;
      if (!good) {
        var absorbed = sdk.lengthMiss();
        if (mode === "lives") {
          var left = engineLives();
          if (left !== null) {
            L.livesLeft = left;
            if (!absorbed) L.endsAfter = true;
          } else {
            L.livesLeft = Math.max(0, L.livesLeft - 1);
            if (L.livesLeft <= 0) L.endsAfter = true;
          }
        } else if (mode === "endless" && !absorbed) {
          L.endsAfter = true;
        }
      }
      // A completed question is a round; false from the engine means the length is used up. The
      // last round of a locked length isn't spent: the kit's own count (L.total) ends the run after
      // the explanation and recap, so the result keeps its outcome and mastery tag.
      var lengthLeft = sdk.lengthLeft ? sdk.lengthLeft() : null;
      var more = lengthLeft && lengthLeft.rounds_left === 1 ? true : sdk.lengthRound();
      if (more === false) L.endsAfter = true;
      if (mode === "rounds" && L.asked >= L.total) L.endsAfter = true;
    }

    function recap() {
      L.phase = "recap";
      L.recapAt = sdk.tick;
      L.current = null;
      // A lesson point is known when every question that practices it was answered right.
      L.pointsKnown = points.map(function (_, p) {
        var seen = false, ok = true;
        L.results.forEach(function (r) { if (r.point === p) { seen = true; if (!r.good) ok = false; } });
        return seen ? (ok ? "known" : "review") : "seen";
      });
      sdk.state.choices = [NEXT_BOX];
      sdk.state.choices_locked = true;
      var mastery = L.asked ? L.right / L.asked : 0;
      var livesOut = mode === "lives" && L.livesLeft <= 0;
      L.outcome = livesOut || mastery < params.pass_ratio ? "fail" : "success";
      var tag = "mastery=" + L.right + "/" + L.asked + ";topic=" + slug(L.topic);
      if (L.missed.length) tag += ";miss=" + L.missed.slice().sort(function (a, b) { return a - b; }).slice(0, 12).join(",");
      sdk.share({ score_text: L.right + "/" + L.asked + " mastered", tag: tag.slice(0, 120) });
      sdk.emit("learn.recap", { right: L.right, asked: L.asked });
      sdk.fx.sound(L.outcome === "success" ? "success" : "whoosh");
    }

    function finish() {
      if (L.over) return;
      L.over = true;
      L.phase = "done";
      sdk.emit(L.outcome === "success" ? "rule.success" : "rule.fail", { right: L.right, asked: L.asked });
      sdk.end(L.outcome, { right: L.right, asked: L.asked, mastery: L.asked ? L.right / L.asked : 0 });
    }

    sdk.on("input.select", function (e) {
      if (L.over || sdk.ended) return;
      if (L.phase === "lesson" && e.value === "start") {
        sdk.fx.sound("pop");
        sdk.fx.haptic("light");
        sdk.emit("learn.lesson_done", { points: points.length });
        ask();
      } else if (L.phase === "ask" && typeof e.value === "number") {
        sdk.fx.haptic("selection");
        judge(e.index);
      } else if (L.phase === "explain" && e.value === "next") {
        if (L.endsAfter) recap();
        else ask();
      } else if (L.phase === "recap" && e.value === "next") {
        finish();
      }
    });

    sdk.on("clock.tick", function () {
      if (L.over || sdk.ended) return;
      if (!base.length) {
        L.over = true;
        sdk.emit("rule.fail", { reason: "no_questions" });
        sdk.end("fail", { reason: "no_questions" });
        return;
      }
      var t = sdk.tick;
      if (L.phase === "lesson") {
        // The start button wakes up after a moment, so a stray tap doesn't skip the lesson.
        if (sdk.state.choices_locked && t >= Math.round(params.lesson_min_seconds * 60)) sdk.state.choices_locked = false;
      } else if (L.phase === "explain") {
        if (sdk.state.choices_locked && t - L.pickedAt >= 30) {
          sdk.state.choices = [NEXT_BOX];
          sdk.state.choices_locked = false;
        }
      } else if (L.phase === "recap") {
        if (sdk.state.choices_locked && t - L.recapAt >= 45) sdk.state.choices_locked = false;
        if (t - L.recapAt >= Math.round(params.recap_seconds * 60)) finish();
      }
    });
  }

  // ---- concepts --------------------------------------------------------------------------------

  B.defineConcept({
    id: "space.lesson_desk", kind: "space", version: 1, formulas: ["learn"],
    describe: "The lesson desk: a lesson card with the lesson's 2–4 points and a Start practice button, then one question card at a time with 2–4 answer pills stacked under it, an explanation card that slides up after every answer (right or wrong), and a recap card listing the points you know and your mastery.",
    examples: ["a three-point lesson on the city's hills, then eight questions", "basic greetings for a language-exchange meetup"],
    params: {
      header: { type: "string", default: "", max_length: 24, describe: "Small label over the lesson card (empty: \"Lesson\")." }
    },
    consumes: [], emits: [], requires: ["rule.lesson_practice", "input.select"], conflicts: [],
    tags: { mood: ["cozy", "curious", "focused", "warm"], energy: ["low"] },
    state: "reads state.learn",
    glue: [],
    setup: function (sdk, params) {
      var header = params.header || "Lesson";

      sdk.layer(sdk.Z.space, function (g) {
        var L = sdk.state.learn;
        if (!L) return;
        var pal = g.palette;
        if (L.phase === "lesson") drawLesson(g, sdk, L, header, pal);
        else if (L.phase === "ask" || L.phase === "explain") drawQuestion(g, sdk, L, pal);
        else drawRecap(g, sdk, L, pal);
      });
    }
  });

  function drawLesson(g, sdk, L, header, pal) {
    var t = sdk.tick;
    var appear = easeOut(clamp(t / 18, 0, 1));
    var y0 = CARD_Y + (1 - appear) * 24;
    card(g, 20, y0, 320, LESSON_CARD_H, { alpha: appear, radius: 28 });
    g.text("🎓 " + header.toUpperCase(), 44, y0 + 30, { size: 12, weight: 800, color: pal.ink, align: "left", alpha: 0.65 * appear });
    var tfit = fitText(g, L.title, 272, 64, 26, 17, 2, 800);
    var used = drawLines(g, tfit, 44, y0 + 46, { top: true, align: "left", color: pal.ink, weight: 800, alpha: appear, maxWidth: 276 });
    var y = y0 + 58 + used;
    var n = Math.max(1, L.points.length);
    var room = (y0 + LESSON_CARD_H - 24 - y) / n;
    for (var i = 0; i < L.points.length; i++) {
      var a = easeOut(clamp((t - 10 - i * 8) / 16, 0, 1)) * appear;
      var fs = fillStyle(g, pal.accents && pal.accents.length ? pal.accents[i % pal.accents.length] : pal.primary);
      g.circle(58, y + 16, 15, fs.fill, fs.alpha * a);
      g.text(String(i + 1), 58, y + 16, { size: 15, weight: 900, color: fs.ink, alpha: a });
      var pfit = fitText(g, L.points[i], 236, room - 8, 18, 12, 4, 600);
      drawLines(g, pfit, 84, y + 4, { top: true, align: "left", color: pal.ink, weight: 600, alpha: a, maxWidth: 240 });
      y += room;
    }
    var ready = !sdk.state.choices_locked;
    var fs2 = fillStyle(g, pal.primary);
    var pulse = ready && !g.reduced ? 1 + 0.025 * Math.sin(g.t * 4) : 1;
    var bw = 300 * pulse, bh = START_H * pulse;
    g.pill(W / 2 - bw / 2, START_Y + START_H / 2 - bh / 2, bw, bh, { fill: fs2.fill, alpha: (ready ? 1 : 0.5) * Math.max(fs2.alpha, washes(g) ? 0.5 : 1), stroke: fs2.stroke, strokeWidth: 2, radius: 28, shade: 0.4 });
    g.text("Start practice  →", W / 2, START_Y + START_H / 2, { size: 19, weight: 800, color: fs2.ink, alpha: ready ? 1 : 0.6 });
  }

  function drawProgress(g, L, pal) {
    // One dot per question in rounds mode; hearts for lives; a pass counter for endless.
    var y = CARD_Y + 22;
    var label;
    if (L.mode === "rounds") label = "Question " + Math.min(L.index + 1, L.total) + " of " + L.total;
    else if (L.mode === "lives") label = "Question " + (L.index + 1) + "  ·  " + "♥".repeat(Math.max(0, L.livesLeft)) + "♡".repeat(Math.max(0, L.lives - L.livesLeft));
    else label = "Question " + (L.index + 1) + "  ·  until your first miss";
    g.text(label, 40, y, { size: 12, weight: 800, color: pal.ink, align: "left", alpha: 0.65 });
    if (L.streak >= 2) g.text("🔥 " + L.streak + " in a row", 320, y, { size: 12, weight: 800, color: pal.ink, align: "right", alpha: 0.8 });
  }

  function drawQuestion(g, sdk, L, pal) {
    var q = L.current;
    if (!q) return;
    var t = sdk.tick;
    var since = t - L.t0;
    var appear = easeOut(clamp(since / 14, 0, 1));
    card(g, 20, CARD_Y, 320, Q_CARD_H, { radius: 26 });
    drawProgress(g, L, pal);
    var qfit = fitText(g, q.q, 280, 84, 23, 14, 3, 800);
    drawLines(g, qfit, W / 2, CARD_Y + 78, { color: pal.ink, weight: 800, alpha: appear, maxWidth: 290 });

    var boxes = choiceBoxes(q.choices.length);
    var explaining = L.phase === "explain";
    var p = explaining ? easeOut(clamp((t - L.pickedAt) / 14, 0, 1)) : 0;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      var a = easeOut(clamp((since - i * 3) / 12, 0, 1));
      var x = b.x - b.w / 2, y = b.y - b.h / 2 + (1 - a) * 12;
      var isAnswer = i === q.answer, isPick = i === L.pick;
      var style, alpha = a;
      if (explaining && isAnswer) style = fillStyle(g, pal.good || pal.primary);
      else if (explaining && isPick) style = fillStyle(g, pal.danger);
      else style = { fill: pal.surface, alpha: 1, ink: pal.ink, stroke: pal.line || null };
      if (explaining && !isAnswer && !isPick) alpha = a * (1 - 0.55 * p);
      var shakeX = explaining && isPick && !L.good && !g.reduced ? Math.sin((t - L.pickedAt) * 1.4) * 6 * Math.max(0, 1 - (t - L.pickedAt) / 20) : 0;
      g.pill(x + shakeX, y, b.w, b.h, { fill: style.fill, alpha: alpha * style.alpha, radius: 18 });
      if (style.stroke) g.pill(x + shakeX, y, b.w, b.h, { fill: null, stroke: style.stroke, strokeWidth: explaining && (isAnswer || isPick) ? 2.5 : 1.5, radius: 18, alpha: alpha });
      var cfit = fitText(g, q.choices[i], 232, 44, 18, 12, 2, 700);
      drawLines(g, cfit, b.x + shakeX - 10, b.y + (1 - a) * 12, { color: style.ink, weight: 700, alpha: alpha, maxWidth: 240 });
      if (explaining && (isAnswer || isPick)) {
        g.text(isAnswer ? "✓" : "✗", x + b.w - 26 + shakeX, b.y, { size: 22, weight: 900, color: style.ink, alpha: p });
      }
    }

    if (explaining) {
      var s = easeOut(clamp((t - L.pickedAt) / 18, 0, 1));
      var ey = EXPLAIN_Y + (1 - s) * 60;
      var tone = L.good ? (pal.good || pal.primary) : pal.danger;
      var fs = fillStyle(g, tone);
      card(g, 16, ey, 328, EXPLAIN_H, { radius: 24, alpha: s, strokeWidth: 2.5, stroke: tone });
      g.pill(16, ey, 10, EXPLAIN_H, { fill: tone, alpha: s * Math.max(0.6, fs.alpha), radius: 5 });
      var head = L.good ? (L.streak >= 3 ? "Right! " + L.streak + " in a row" : "Right!") : "Not quite. Answer: " + q.choices[q.answer];
      var hfit = fitText(g, head, 284, 40, 17, 11, 2, 900);
      var hh = drawLines(g, hfit, 40, ey + 12, { top: true, align: "left", color: pal.ink, weight: 900, alpha: s, maxWidth: 290 });
      if (q.explain) {
        var efit = fitText(g, q.explain, 284, EXPLAIN_H - 38 - hh, 16, 10, 3, 600);
        drawLines(g, efit, 40, ey + 16 + hh, { top: true, align: "left", color: pal.ink, weight: 600, alpha: s, maxWidth: 290 });
      }
      if (!sdk.state.choices_locked) {
        var blink = g.reduced ? 0.7 : 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(g.t * 3));
        g.text(L.endsAfter ? "Tap for your recap" : "Tap to continue", 330, ey + EXPLAIN_H - 11, { size: 12, weight: 800, color: pal.ink, align: "right", alpha: blink * s });
      }
    }
  }

  function drawRecap(g, sdk, L, pal) {
    var t = sdk.tick - (L.recapAt || 0);
    var a = easeOut(clamp(t / 18, 0, 1));
    var y0 = CARD_Y + (1 - a) * 20;
    card(g, 20, y0, 320, 460, { radius: 28, alpha: a });
    g.text("🎓 RECAP", 44, y0 + 30, { size: 12, weight: 800, color: pal.ink, align: "left", alpha: 0.65 * a });
    var tfit = fitText(g, L.title, 272, 34, 20, 14, 1, 800);
    drawLines(g, tfit, 44, y0 + 46, { top: true, align: "left", color: pal.ink, weight: 800, alpha: a, maxWidth: 276 });

    // Mastery ring.
    var cx = W / 2, cy = y0 + 150, r = 54;
    var mastery = L.asked ? L.right / L.asked : 0;
    var shown = mastery * easeOut(clamp((t - 6) / 40, 0, 1));
    var good = pal.good || pal.primary;
    g.ring(cx, cy, r, pal.ink, { width: 10, alpha: 0.12 * a });
    if (shown > 0.001) {
      var pts = [], steps = Math.max(2, Math.round(48 * shown));
      for (var i = 0; i <= steps; i++) {
        var ang = -Math.PI / 2 + (Math.PI * 2 * shown * i) / steps;
        pts.push(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
      }
      g.path(pts, good, { width: 10, alpha: a, cap: "round" });
    }
    g.text(L.right + "/" + L.asked, cx, cy - 6, { size: 30, weight: 900, color: pal.ink, alpha: a });
    g.text("mastered", cx, cy + 22, { size: 12, weight: 800, color: pal.ink, alpha: 0.7 * a });

    // What you learned.
    var y = cy + r + 26;
    g.text("What you learned", 44, y, { size: 13, weight: 900, color: pal.ink, align: "left", alpha: a });
    y += 14;
    var n = Math.max(1, L.points.length);
    var room = Math.min(56, (y0 + 446 - y) / n);
    for (var k = 0; k < L.points.length; k++) {
      var st = L.pointsKnown[k] || "seen";
      var mark = st === "known" ? "✓" : st === "review" ? "↻" : "•";
      var color = st === "known" ? good : st === "review" ? pal.danger : pal.ink;
      var fs = fillStyle(g, color);
      g.circle(56, y + 14, 11, fs.fill, fs.alpha * a);
      g.text(mark, 56, y + 14, { size: 13, weight: 900, color: fs.ink, alpha: a });
      var pfit = fitText(g, L.points[k], 248, room - 6, 14, 10, 3, 600);
      drawLines(g, pfit, 76, y + 4, { top: true, align: "left", color: pal.ink, weight: 600, alpha: a * (st === "review" ? 1 : 0.9), maxWidth: 252 });
      y += room;
    }
    var line = L.outcome === "success" ? (L.bestStreak >= 3 ? "Best streak: " + L.bestStreak + " in a row" : "Nice work") : "Keep practicing: the ↻ points are worth another look";
    var lfit = fitText(g, line, 300, 36, 14, 11, 2, 700);
    drawLines(g, lfit, W / 2, y0 + 486, { color: pal.ink, weight: 700, alpha: 0.85 * a, maxWidth: 310 });
    if (!sdk.state.choices_locked) g.text("Tap to finish", W / 2, y0 + 520, { size: 12, weight: 800, color: pal.ink, alpha: 0.55 * a });
  }

  B.defineConcept({
    id: "rule.lesson_practice", kind: "rule", version: 1, formulas: ["learn"],
    describe: "Runs the lesson: the lesson card first (Start practice), then the questions one at a time. Every answer, right or wrong, shows its explanation before the next question. After the last question a recap lists the lesson points you know and your mastery (right / asked), then the run ends: success at or above pass_ratio, else fail (\"keep practicing\"). Honors length: rounds (default one per question), lives (wrong answers cost a life) and endless (fresh order each pass until the first miss).",
    examples: ["eight questions after a three-point lesson", "practice basic greetings until you miss one (endless)"],
    params: {
      pass_ratio: { type: "number", default: 0.5, min: 0, max: 1, describe: "Mastery needed for a success (0.5: half right). 0 makes every finished lesson a success." },
      shuffle_choices: { type: "boolean", default: true, describe: "Show each question's choices in a seeded random order." },
      shuffle_questions: { type: "boolean", default: false, describe: "Shuffle the first pass too (later passes always reshuffle). Off keeps lesson order." },
      lesson_min_seconds: { type: "number", default: 1, min: 0.3, max: 4, describe: "Seconds before Start practice works, so a stray tap doesn't skip the lesson." },
      recap_seconds: { type: "number", default: 5, min: 2, max: 10, describe: "Seconds the recap shows before the run ends (a tap ends it sooner)." }
    },
    consumes: ["input.select", "clock.tick"],
    emits: ["learn.lesson_done", "learn.question", "learn.answer", "learn.right", "learn.wrong", "learn.explain", "learn.recap", "round.start", "round.end", "rule.success", "rule.fail"],
    requires: ["space.lesson_desk"], conflicts: [], ends: true,
    state: "learn: {phase, mode, total, index, current, results, right, asked, streak, missed}",
    tags: { mood: ["curious", "cozy", "focused"], energy: ["low"], competition: ["light", "friendly"] },
    glue: [],
    setup: function (sdk, params) { setupPractice(sdk, params); }
  });

  B.defineConcept({
    id: "score.mastery", kind: "score", version: 1, formulas: ["learn"],
    describe: "Points for right answers: `points` each, plus `streak_bonus` for every right answer in a row after the first (capped at 5 steps). Wrong answers score 0 and reset the streak. The score glue gets {base, correct, streak, index}.",
    examples: ["100 per right answer, +20 per step of a streak"],
    params: {
      points: { type: "integer", default: 100, min: 10, max: 1000, describe: "Points for a right answer." },
      streak_bonus: { type: "integer", default: 20, min: 0, max: 200, describe: "Extra points per right answer in a row (2nd +1×, 3rd +2×, up to +5×)." }
    },
    consumes: ["learn.answer"], emits: [], requires: ["rule.lesson_practice"], conflicts: [],
    tags: { competition: ["light", "friendly"] },
    glue: ["score"],
    setup: function (sdk, params) {
      sdk.hud.label = "points";
      sdk.on("learn.answer", function (e) {
        if (!e.correct) return;
        var base = params.points + params.streak_bonus * Math.min(5, Math.max(0, e.streak - 1));
        var pts = base;
        var fn = sdk.glue("score");
        if (fn) {
          var out;
          try { out = fn({ base: base, correct: true, streak: e.streak, index: e.index }); } catch (err) { out = undefined; }
          if (typeof out === "number" && isFinite(out)) pts = clamp(Math.round(out), 0, 10000);
        }
        if (pts) sdk.addScore(pts, { x: W / 2 + 40, y: e.y - 6 });
      });
    }
  });

  // ---- validation ------------------------------------------------------------------------------
  function validateContent(content) {
    var out = [];
    function bad(message, path, warning) { out.push({ code: "content", message: message, path: "content" + (path || ""), warning: !!warning }); }
    if (!content || typeof content !== "object") { bad("content must be {topic, lesson: {title, points}, questions: [...]}"); return out; }
    if (!isStr(content.topic)) bad("topic is required (a short name for what this teaches, e.g. \"SF hills\")", ".topic");
    else if (content.topic.length > 40) bad("topic is too long (40 characters max)", ".topic");
    if (content.subject != null && (!isStr(content.subject) || content.subject.length > 32)) bad("subject must be a short noun phrase (32 characters max), e.g. \"the hills\"", ".subject");
    var lesson = content.lesson;
    var nPoints = 0;
    if (!lesson || typeof lesson !== "object") bad("lesson must be {title, points: [2–4 short points]}", ".lesson");
    else {
      if (!isStr(lesson.title)) bad("lesson.title is required", ".lesson.title");
      else if (lesson.title.length > 48) bad("lesson.title is too long (48 characters max)", ".lesson.title");
      if (!Array.isArray(lesson.points) || lesson.points.length < 1 || lesson.points.length > 4) bad("lesson.points must list 2–4 short points", ".lesson.points");
      else {
        nPoints = lesson.points.length;
        if (nPoints < 2) bad("a lesson reads better with 2–4 points", ".lesson.points", true);
        lesson.points.forEach(function (p, i) {
          if (!isStr(p)) bad("each point must be a non-empty string", ".lesson.points[" + i + "]");
          else if (p.length > 120) bad("point is too long (90 characters reads best, 120 max)", ".lesson.points[" + i + "]");
          else if (p.length > 90) bad("point is long (90 characters reads best)", ".lesson.points[" + i + "]", true);
        });
      }
    }
    var qs = content.questions;
    if (!Array.isArray(qs) || qs.length < 2) { bad("questions must list 2–12 questions (6–10 is best)", ".questions"); return out; }
    if (qs.length > 12) bad("at most 12 questions", ".questions");
    if (qs.length < 5) bad("short lesson: 6–10 questions practice it better", ".questions", true);
    qs.forEach(function (q, i) {
      var p = ".questions[" + i + "]";
      if (!q || typeof q !== "object") { bad("question must be an object {q, choices, answer, explain}", p); return; }
      if (!isStr(q.q)) bad("q (the question) is required", p + ".q");
      else if (q.q.length > 120) bad("question is too long (90 characters reads best, 120 max)", p + ".q");
      if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 4) { bad("choices must have 2–4 entries", p + ".choices"); return; }
      var seen = {};
      q.choices.forEach(function (c, k) {
        var lab = choiceText(c);
        if (!isStr(lab)) bad("choice must be a non-empty string", p + ".choices[" + k + "]");
        else if (lab.length > 48) bad("choice is too long (40 characters reads best, 48 max)", p + ".choices[" + k + "]");
        var key = String(lab).trim().toLowerCase();
        if (seen[key]) bad("choices must be different", p + ".choices[" + k + "]");
        seen[key] = true;
      });
      var n = q.choices.length;
      if (typeof q.answer !== "number" || Math.floor(q.answer) !== q.answer || q.answer < 0 || q.answer >= n) bad("answer must be the index of the right choice (0–" + (n - 1) + ")", p + ".answer");
      if (!isStr(q.explain)) bad("explain is required: one short sentence that teaches why", p + ".explain");
      else if (q.explain.length > 160) bad("explain is too long (120 characters reads best, 160 max)", p + ".explain");
      if (q.point != null && (typeof q.point !== "number" || Math.floor(q.point) !== q.point || q.point < 0 || (nPoints && q.point >= nPoints))) bad("point must be the index of the lesson point this practices", p + ".point");
    });
    return out;
  }

  // ---- bot ---------------------------------------------------------------------------------------
  // Reads the lesson, thinks, answers (right more often with skill), reads the explanation, moves
  // on. Memory lives in sdk.botState so a recorded bot run replays identically.
  function botDecide(sdk) {
    var L = sdk.state.learn;
    if (!L || L.over || sdk.state.choices_locked) return [];
    var mem = sdk.botState.learn || (sdk.botState.learn = { key: "", at: 0, pick: -1 });
    var skill = skillOf(sdk);
    var key = L.phase + ":" + L.serial;
    if (mem.key !== key) {
      mem.key = key;
      var rng = sdk.botRng();
      if (L.phase === "lesson") mem.at = sdk.tick + Math.round(110 + (1 - skill) * 90 + rng * 70);
      else if (L.phase === "ask") {
        var q = L.current;
        mem.at = sdk.tick + Math.round(45 + (1 - skill) * 75 + rng * 60);
        var right = sdk.botRng() < 0.28 + 0.7 * skill;
        if (right || q.choices.length < 2) mem.pick = q.answer;
        else {
          var k = Math.floor(sdk.botRng() * (q.choices.length - 1));
          mem.pick = k >= q.answer ? k + 1 : k;
        }
      } else if (L.phase === "explain") mem.at = sdk.tick + Math.round(40 + rng * 60 + (L.good ? 0 : 30));
      else if (L.phase === "recap") mem.at = sdk.tick + Math.round(80 + rng * 60);
      else mem.at = Infinity;
    }
    if (sdk.tick < mem.at) return [];
    mem.at = Infinity;
    var list = sdk.state.choices || [];
    var target = L.phase === "ask" ? list[mem.pick] : list[0];
    if (!target) return [];
    return [{ a: "tap", v: [Math.round(target.x), Math.round(target.y)] }];
  }

  B.defineFormula({
    id: "learn",
    title: "Learn",
    describe: "A short lesson you learn together: a lesson card with 2–4 points, then 6–10 practice questions with an explanation after every answer, then a recap of what you know and your mastery (7/8). Facts must be accurate and checkable.",
    core: ["space.lesson_desk", "rule.lesson_practice", "input.select"],
    optional: ["score.mastery", "feel.mood_preset", "feel.sfx_on_action"],
    content: {
      describe: "A lesson and its practice: {topic, subject?, lesson: {title, points: [2–4 points, 90 characters max each]}, questions: [6–10 × {q (90 max), choices: [2–4 × 40 max], answer (index of the right choice), explain (one sentence that teaches why, 120 max), point? (index of the lesson point it practices)}]}. topic names the lesson (\"SF hills\"); subject is a short noun phrase for the Group meter (\"the hills\"). Every fact must be accurate, widely known and checkable; prefer conservative facts.",
      schema: {
        type: "object",
        required: ["topic", "lesson", "questions"],
        properties: {
          topic: { type: "string", max_length: 40 },
          subject: { type: "string", max_length: 32 },
          lesson: { type: "object", required: ["title", "points"], properties: { title: { type: "string", max_length: 48 }, points: { type: "array", min_items: 2, max_items: 4, items: { type: "string", max_length: 90 } } } },
          questions: { type: "array", min_items: 2, max_items: 12, items: { type: "object", required: ["q", "choices", "answer", "explain"], properties: { q: { type: "string", max_length: 90 }, choices: { type: "array", min_items: 2, max_items: 4, items: { type: "string", max_length: 40 } }, answer: { type: "integer" }, explain: { type: "string", max_length: 120 }, point: { type: "integer" } } } }
        }
      }
    },
    validateContent: validateContent,
    length: { modes: ["rounds", "lives", "endless"], default: { mode: "rounds" }, knobs: {} },
    poster_ticks: 60,
    tags: { category: ["learn"], mood: ["curious", "cozy"], energy: ["low"] },
    tips: [
      "2–4 lesson points, and every question practices one of them (set point).",
      "Each explanation is one short sentence that teaches why, not just the answer.",
      "Facts must be accurate and checkable; skip numbers you can't verify."
    ],
    bot: { decide: botDecide },
    share: function (sdk) {
      var L = sdk.state.learn;
      if (!L) return {};
      return { score_text: L.right + "/" + L.asked + " mastered" };
    },
    example: {
      id: "example-learn-sf-basics",
      version: 1,
      title: "SF Basics 101",
      one_line_rule: "Read three quick facts about the city, then practice them.",
      formula: "learn",
      brief: { intent: "learn the city together", audience: "everyone", mood: ["curious", "cozy"], energy: "low", competition: "light" },
      structure: { cadence: "endless", scope: "everyone", setter: "ai" },
      style: { look: "chalk", palette: "sky-glow", emoji: "🎓" },
      concepts: [
        { use: "space.lesson_desk" },
        { use: "input.select" },
        { use: "rule.lesson_practice" },
        { use: "score.mastery" },
        { use: "feel.mood_preset", params: { preset: "cozy" } }
      ],
      content: {
        topic: "SF basics",
        subject: "the city basics",
        lesson: {
          title: "SF Basics 101",
          points: [
            "The Golden Gate Bridge crosses the strait between the Pacific and the bay.",
            "Cable cars are pulled by cables running under the street.",
            "Summer fog rolls in from the ocean, so the west side is often cooler."
          ]
        },
        questions: [
          { q: "What does the Golden Gate Bridge span?", choices: ["The Golden Gate strait", "The Bay's east shore", "A river"], answer: 0, explain: "It crosses the strait where the bay meets the Pacific.", point: 0 },
          { q: "What moves a cable car up the hill?", choices: ["A cable under the street", "An engine on board", "Overhead wires"], answer: 0, explain: "The car grips a moving cable that runs in a slot under the street.", point: 1 },
          { q: "Where does SF's summer fog come from?", choices: ["The mountains", "The ocean", "The desert"], answer: 1, explain: "Cool ocean air meets warm inland air and the fog rolls in from the west.", point: 2 },
          { q: "Which side of the city is often cooler in summer?", choices: ["The east side", "The west side"], answer: 1, explain: "The west side is closest to the ocean, where the fog arrives first.", point: 2 },
          { q: "Which body of water is west of the city?", choices: ["A big lake", "The Atlantic Ocean", "The Pacific Ocean"], answer: 2, explain: "San Francisco sits on a peninsula with the Pacific on its west side.", point: 0 },
          { q: "Cable cars grip what to move?", choices: ["A rail magnet", "A chain overhead", "A moving cable"], answer: 2, explain: "A grip on the car clamps the moving cable to go and lets go to stop.", point: 1 }
        ]
      },
      seed: 2026111303
    }
  });
})();
