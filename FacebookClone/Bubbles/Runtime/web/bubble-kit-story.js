// Bubble kit: story. See docs/BUBBLES.md, 4.6 and 7.6. Kits only call Bubble.defineFormula and Bubble.defineConcept.
//
// Adventures: stories you play. A story is a small graph of scenes. Each scene types out a short
// passage, then offers 1–3 choices drawn as pills. Choices can set flags, flags can unlock choices
// later on, and every path ends at one of 2–6 endings (one of them usually a secret). A choice may
// hide a quick timing tap: land it and you take the bold path (and score), miss it and you take
// the safe one.
//
//   space.story_page   draws the page: scene emoji, speaker, typed text, choice pills, the timing
//                      meter and the ending card; publishes the pills in state.choices
//   rule.story_paths   walks the graph: typing, choosing, flags, timing moments, endings; ends the
//                      run with success at an ending
//   score.story_points scenes visited × 10, timing hits × 25, plus an ending bonus (secret more)
//   input.select       (common kit) taps the pills
//
// Content: {start, scenes: [{id, text, speaker?, emoji?, choices?: [{id?, text, to, past?, set?,
// need?, skill?: {kind: "timing", window, miss}}], ending?: {id, title, emoji, tone}}]}.
// The validator proves every choice points at a real scene, every scene is reachable, the graph
// never loops, every path reaches an ending, every ending is reachable with flags respected (set
// before need), and the depth stays within 12.
//
// Share: score_text "Ending 2 of 4 · 🌉" (no spoilers) and tag
// "ending=<id>;first=<choice id>;found=<n>/<m>;path=<choice indexes>" for the app (7.6).
//
// Length (7.9): modes rounds and endless, default rounds = the depth cap. lengthRound() is called
// when a scene is left. When only one round is left, the story jumps to the nearest ending instead
// of spending it, so the run ends on an ending (with its tag) rather than mid-story.
//
// State: state.story (the walk), state.story_page (layout), state.choices / state.choices_locked
// (for input.select), state.poster_tick.
(function () {
  "use strict";
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var B = root.Bubble;
  if (!B || typeof B.defineConcept !== "function" || typeof B.defineFormula !== "function") return;

  var W = 360;
  var LIMIT = { text: 160, choice: 28, past: 32, speaker: 24, title: 40, id: 24, emoji: 16, choices: 3, scenes: 40, endings: [2, 6], depth: 12, flags: 8 };
  var TONES = ["good", "odd", "secret"];
  // Pacing, in ticks (60 per second).
  var TYPE_RATE = 1.6;        // characters per tick while a passage types out
  var LEAD_IN = 14;           // before the first scene starts typing
  var CHOICE_DELAY = 30;      // choices unlock this long after the text is in
  var MIN_SCENE = 96;         // a scene stays at least this long before its choices unlock
  var SKILL_PERIOD = 68;      // one sweep of the timing marker
  var SKILL_GRACE = 10;       // taps this soon after the meter opens don't count
  var SKILL_TIMEOUT = 170;    // the meter closes (a miss) after this long
  var SKILL_SHOW = 48;        // the hit or miss line stays this long
  var MOVE = 20;              // page turn between scenes
  var ENDING_HOLD = 150;      // the ending card stays this long after its text is in

  // ---- small helpers -------------------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function isStr(v) { return typeof v === "string" && v.trim().length > 0; }
  function strList(v) { return Array.isArray(v) ? v.filter(isStr).map(function (s) { return String(s); }) : []; }
  function skillOf(sdk) {
    var s = sdk.botSkill;
    return clamp(typeof s === "number" && isFinite(s) ? s : 0.7, 0, 1);
  }
  function slug(s) {
    var out = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return out.slice(0, LIMIT.id) || "choice";
  }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); }
  // Bot memory lives outside game state (sdk.botState), so a recorded bot run replays identically.
  function botMem(sdk) {
    var holder = sdk.botState && typeof sdk.botState === "object" ? sdk.botState : (sdk.state.__storyBot = sdk.state.__storyBot || {});
    if (!holder.story || sdk.tick < holder.story.lastTick) holder.story = { lastTick: 0, key: "" };
    holder.story.lastTick = sdk.tick;
    return holder.story;
  }

  // ---- the graph -------------------------------------------------------------------------------
  // Normalizes content into {start, byId, order, endings: [scene ids in content order]}. Choice ids
  // default to a slug of the text, unique within the scene. Lenient: bad entries are skipped, so
  // the runtime never crashes on content the validator would reject.
  function buildGraph(content) {
    var c = content && typeof content === "object" ? content : {};
    var list = Array.isArray(c.scenes) ? c.scenes : [];
    var g = { start: isStr(c.start) ? String(c.start) : "", byId: {}, order: [], endings: [] };
    for (var i = 0; i < list.length && i < LIMIT.scenes + 10; i++) {
      var s = list[i];
      if (!s || typeof s !== "object" || !isStr(s.id) || g.byId[s.id]) continue;
      var scene = {
        id: String(s.id),
        text: isStr(s.text) ? String(s.text) : "…",
        speaker: isStr(s.speaker) ? String(s.speaker).slice(0, LIMIT.speaker) : "",
        emoji: isStr(s.emoji) ? String(s.emoji).slice(0, LIMIT.emoji) : "",
        choices: [],
        ending: null
      };
      if (s.ending && typeof s.ending === "object") {
        var tone = TONES.indexOf(s.ending.tone) >= 0 ? s.ending.tone : "good";
        scene.ending = {
          id: isStr(s.ending.id) ? String(s.ending.id).slice(0, LIMIT.id) : scene.id,
          title: isStr(s.ending.title) ? String(s.ending.title) : "The end",
          emoji: isStr(s.ending.emoji) ? String(s.ending.emoji) : (scene.emoji || "✨"),
          tone: tone
        };
      } else {
        var seen = {};
        var cs = Array.isArray(s.choices) ? s.choices : [];
        for (var k = 0; k < cs.length && scene.choices.length < LIMIT.choices; k++) {
          var ch = cs[k];
          if (!ch || typeof ch !== "object" || !isStr(ch.text) || !isStr(ch.to)) continue;
          var id = isStr(ch.id) ? String(ch.id).slice(0, LIMIT.id) : slug(ch.text);
          if (seen[id]) id = (id.slice(0, LIMIT.id - 2) + "-" + (k + 1));
          seen[id] = true;
          var skill = null;
          if (ch.skill && typeof ch.skill === "object") {
            skill = { kind: "timing", window: clamp(num(ch.skill.window, 0.25), 0.15, 0.4), miss: isStr(ch.skill.miss) ? String(ch.skill.miss) : "" };
          }
          scene.choices.push({
            index: k, id: id, text: String(ch.text), to: String(ch.to),
            past: isStr(ch.past) ? String(ch.past) : "",
            set: strList(ch.set), need: strList(ch.need), skill: skill
          });
        }
      }
      g.byId[scene.id] = scene;
      g.order.push(scene.id);
      if (scene.ending) g.endings.push(scene.id);
    }
    if (!g.byId[g.start] && g.order.length) g.start = g.order[0];
    return g;
  }

  function hasFlags(flags, need) {
    for (var i = 0; i < need.length; i++) if (!flags[need[i]]) return false;
    return true;
  }
  function openChoices(scene, flags) {
    return scene.choices.filter(function (c) { return hasFlags(flags, c.need); });
  }
  // The closest ending from `from` (flags respected), for a run whose length ran out.
  function nearestEnding(graph, from, flags) {
    var queue = [from], seen = {}, head = 0;
    seen[from] = true;
    while (head < queue.length) {
      var id = queue[head++], s = graph.byId[id];
      if (!s) continue;
      if (s.ending) return id;
      var open = openChoices(s, flags);
      for (var i = 0; i < open.length; i++) {
        var nx = [open[i].to].concat(open[i].skill && open[i].skill.miss ? [open[i].skill.miss] : []);
        for (var j = 0; j < nx.length; j++) if (!seen[nx[j]]) { seen[nx[j]] = true; queue.push(nx[j]); }
      }
    }
    return graph.endings[0] || from;
  }
  function endingNumber(graph, sceneID) { return graph.endings.indexOf(sceneID) + 1; }

  // Where the timing marker is (0–1) `t` ticks into a meter: a smooth back-and-forth sweep.
  function markerAt(t) {
    var u = (t % (2 * SKILL_PERIOD)) / SKILL_PERIOD;
    var x = u <= 1 ? u : 2 - u;
    return 0.04 + 0.92 * (0.5 - 0.5 * Math.cos(Math.PI * x));
  }

  // ---- look-friendly roles (LOOKS.md) -----------------------------------------------------------
  function lookOf(g) { return g.look || (g.palette && g.palette.look) || "glow"; }
  function roles(g) {
    var p = g.palette || {};
    var a = p.accents && p.accents.length ? p.accents : [p.ink];
    var lk = lookOf(g);
    var outline = lk === "ink" || lk === "chalk" || lk === "neon";
    var inkOn = typeof p.inkOn === "function" ? p.inkOn : function () { return p.ink; };
    return {
      look: lk,
      ink: p.ink, primary: p.primary || a[0], secondary: p.secondary || a[1 % a.length], accent: p.accent || a[2 % a.length],
      good: p.good || p.primary || a[0], danger: p.danger || a[a.length - 1],
      surface: p.surface || p.glow || p.top, strong: p.surfaceStrong || p.surface || p.glow || p.top,
      line: p.line || p.ink, light: p.glow || p.bgTop || p.top, dark: !!p.dark, outline: outline, back: p.bgBottom || p.bottom,
      // Ink on a filled shape: outline looks keep the palette ink (their fills are see-through).
      on: function (fill) { return outline ? p.ink : inkOn(fill); }
    };
  }
  // A panel: chalk surfaces are see-through, so they get an opaque backing first, which keeps
  // text readable over scenery in every look.
  function panel(g, ro, x, y, w, h, o) {
    if (ro.look === "chalk" && ro.back && g.ctx) {
      // A plain board-colored backing (render only), then the chalk panel on top.
      var c = g.ctx, r = Math.min(o.radius || 0, h / 2, w / 2);
      c.save();
      c.globalAlpha = (o.alpha === undefined ? 1 : o.alpha) * 0.9;
      c.fillStyle = ro.back;
      c.beginPath();
      c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
      c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
      c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
      c.fill();
      c.restore();
    }
    g.pill(x, y, w, h, o);
  }
  var fitCache = { key: "", fit: null };
  function fitText(g, text, maxW, maxLines, big, small, weight) {
    var key = text + "|" + maxW + "|" + maxLines + "|" + big + "|" + lookOf(g) + "|" + (g.font || "");
    if (fitCache.key === key) return fitCache.fit;
    var best = null;
    for (var size = big; size >= small; size -= 1) {
      var lines = g.wrapText ? g.wrapText(String(text), maxW, size, weight) : [String(text)];
      best = { lines: lines, size: size };
      if (lines.length <= maxLines) break;
    }
    fitCache.key = key; fitCache.fit = best;
    return best;
  }
  function fitSmall(g, text, maxW, big, small, weight) {
    for (var size = big; size >= small; size -= 1) {
      var lines = g.wrapText ? g.wrapText(String(text), maxW, size, weight) : [String(text)];
      if (lines.length <= 1) return size;
    }
    return small;
  }

  // Pill layout for n choices (top-left x, y, w, h), plus centers for input.select.
  var CARD = { x: 22, y: 196, w: 316, h: 206 };
  function pillsFor(n) {
    var h = 52, gap = 12, top = 420;
    var out = [];
    for (var i = 0; i < n; i++) out.push({ x: 30, y: top + i * (h + gap), w: 300, h: h });
    return out;
  }

  // ---- concepts --------------------------------------------------------------------------------

  B.defineConcept({
    id: "space.story_page", kind: "space", version: 1, formulas: ["story"],
    describe: "The adventure page: the scene's emoji and speaker on top, the passage typing out on a card, then 1–3 choice pills below it (⚡ marks a choice with a quick timing tap, ✨ one a flag unlocked). A timing tap shows a sweeping meter with a glowing zone. An ending shows a big card: emoji, 'Ending 2 of 4', the ending's title, and a secret badge for secret endings.",
    examples: ["a choose-your-path morning in a new city", "a late-night ride home with three endings", "a mystery at the Group picnic"],
    params: {
      endings_hint: { type: "boolean", default: true, describe: "Show 'N endings to find' under the choices." }
    },
    consumes: ["clock.tick"], emits: [], requires: ["rule.story_paths", "input.select"], conflicts: [],
    tags: { mood: ["cozy", "curious", "warm", "dreamy", "playful"], energy: ["low"] },
    state: "story_page: {pills}; choices: [{x, y, w, h, value}] for input.select",
    glue: [],
    setup: function (sdk, params) {
      sdk.state.story_page = { hint: params.endings_hint };

      // Scene header and the passage card.
      sdk.layer(10, function (g) {
        var st = sdk.state.story;
        if (!st || !st.graph.order.length) return;
        var scene = st.graph.byId[st.scene];
        if (!scene) return;
        var ro = roles(g);
        var fade = st.phase === "move" ? 1 - clamp((sdk.tick - st.t0) / MOVE, 0, 1) : st.phase === "enter" ? clamp((sdk.tick - st.t0) / 10, 0, 1) : 1;
        if (scene.ending) { drawEnding(g, sdk, st, scene, ro, fade); return; }

        // Emoji and speaker.
        if (scene.emoji) {
          g.halo && g.halo(W / 2, 146, 44, ro.light, 0.5 * fade);
          g.emoji(scene.emoji, W / 2, 146, 52, fade);
        }
        if (scene.speaker) {
          var sw = Math.min(220, 24 + scene.speaker.length * 9);
          g.pill(W / 2 - sw / 2, 172, sw, 22, { fill: ro.primary, radius: 11, alpha: 0.95 * fade });
          g.text(scene.speaker, W / 2, 183, { size: 12, weight: 800, color: ro.on(ro.primary), alpha: fade, maxWidth: sw - 12 });
        }
        // Card.
        panel(g, ro, CARD.x, CARD.y, CARD.w, CARD.h, { fill: ro.strong, stroke: ro.line, strokeWidth: 1.5, radius: 22, alpha: fade, glow: ro.look === "glow" ? 0.6 : 0, glowColor: ro.light });
        var fit = fitText(g, scene.text, CARD.w - 40, 6, 20, 15, 650);
        var shown = st.phase === "type" || st.phase === "enter" ? st.chars : 1e9;
        var lh = Math.round(fit.size * 1.32);
        var y0 = CARD.y + CARD.h / 2 - (fit.lines.length - 1) * lh / 2;
        var left = shown;
        for (var i = 0; i < fit.lines.length && left > 0; i++) {
          var line = fit.lines[i];
          var part = left >= line.length ? line : line.slice(0, left);
          left -= line.length + 1;
          g.text(part, CARD.x + 20, y0 + i * lh, { size: fit.size, weight: 650, color: ro.ink, align: "left", alpha: fade * (st.phase === "skill" || st.phase === "skillDone" ? 0.3 : 1) });
        }
        if ((st.phase === "type" || st.phase === "enter") && st.chars < scene.text.length) {
          // A blinking caret while it types; tap to skip.
          if (Math.floor(sdk.tick / 18) % 2 === 0) g.text("▍", CARD.x + CARD.w - 26, CARD.y + CARD.h - 22, { size: 14, weight: 700, color: ro.primary });
        }
      });

      // Choice pills and the timing meter.
      sdk.layer(20, function (g) {
        var st = sdk.state.story;
        if (!st) return;
        var scene = st.graph.byId[st.scene];
        if (!scene || scene.ending) return;
        var ro = roles(g);
        var showing = st.phase === "choose" || st.phase === "skill" || st.phase === "skillDone" || st.phase === "move";
        if (!showing && !(g.poster && st.phase !== "type")) return;
        var open = st.open || [];
        var pills = pillsFor(open.length);
        var since = st.phase === "choose" ? sdk.tick - st.t0 : 99;
        var locked = sdk.state.choices_locked;
        for (var i = 0; i < open.length; i++) {
          var c = open[i], p = pills[i];
          var appear = easeOut(clamp((since - i * 5) / 14, 0, 1));
          var picked = st.pick === c.index && st.phase !== "choose";
          var dim = st.phase !== "choose" && !picked ? 0.35 : 1;
          var fill = picked ? ro.primary : ro.surface;
          var y = p.y + (1 - appear) * 16;
          var a = appear * dim * (st.phase === "move" ? 1 - clamp((sdk.tick - st.t0) / MOVE, 0, 1) : 1);
          panel(g, ro, p.x, y, p.w, p.h, { fill: fill, stroke: picked ? null : ro.primary, strokeWidth: 2, radius: 26, alpha: a, glow: picked ? 0.8 : 0, glowColor: ro.primary });
          var mark = c.skill ? "⚡" : c.need.length ? "✨" : "";
          var tx = p.x + p.w / 2;
          if (mark) g.emoji(mark, p.x + 28, y + p.h / 2, 18, a);
          var size = fitSmall(g, c.text, p.w - (mark ? 76 : 40), 18, 13, 800);
          g.text(c.text, mark ? tx + 12 : tx, y + p.h / 2 + 1, { size: size, weight: 800, color: picked ? ro.on(ro.primary) : ro.on(ro.surface), alpha: a, maxWidth: p.w - (mark ? 70 : 32) });
          if (st.phase === "choose" && locked && appear >= 1) g.pill(p.x, y, p.w, p.h, { fill: ro.surface, radius: 26, alpha: 0.25 });
        }
        if (st.phase === "choose" && sdk.state.story_page.hint && st.graph.endings.length) {
          var n = st.graph.endings.length;
          var ha = clamp(since / 20, 0, 1);
          panel(g, ro, W / 2 - 84, 600, 168, 24, { fill: ro.strong, radius: 12, alpha: 0.92 * ha });
          g.text(n + " endings to find", W / 2, 612, { size: 12, weight: 800, color: ro.on(ro.strong), alpha: 0.8 * ha });
        }
        if (st.phase === "skill" || st.phase === "skillDone") drawMeter(g, sdk, st, ro);
      });
    }
  });

  function drawMeter(g, sdk, st, ro) {
    var sk = st.skill;
    if (!sk) return;
    var x0 = 46, x1 = 314, y = 356, w = x1 - x0;
    panel(g, ro, 30, 300, 300, 92, { fill: ro.strong, stroke: ro.line, strokeWidth: 1.5, radius: 20, glow: 0.5, glowColor: ro.light });
    var title = st.phase === "skill" ? "Quick! Tap in the glow" : sk.hit ? "Nailed it! +" + st.skillPoints : "Missed it. The safe way, then.";
    g.text(title, W / 2, 324, { size: fitSmall(g, title, 270, 14, 9, 800), weight: 800, color: ro.ink, maxWidth: 280 });
    g.pill(x0, y - 8, w, 16, { fill: ro.ink, alpha: 0.12, radius: 8 });
    var zx = x0 + (sk.center - sk.window / 2) * w, zw = sk.window * w;
    g.pill(zx, y - 10, zw, 20, { fill: ro.accent, radius: 10, alpha: 0.85, glow: 1, glowColor: ro.accent });
    var t = st.phase === "skill" ? sdk.tick - sk.start : sk.at - sk.start;
    var mx = x0 + markerAt(t) * w;
    g.orb(mx, y, 11, sk.hit === false ? ro.danger : ro.primary, { glow: 1, ring: ro.light });
  }

  function drawEnding(g, sdk, st, scene, ro, fade) {
    var e = scene.ending;
    var since = sdk.tick - st.t0;
    var pop = easeOut(clamp(since / 24, 0, 1));
    var n = endingNumber(st.graph, scene.id), m = st.graph.endings.length;
    var secret = e.tone === "secret";
    g.halo && g.halo(W / 2, 168, 70, secret ? ro.accent : ro.light, 0.7 * pop);
    g.emoji(e.emoji, W / 2, 168, 30 + 42 * pop, fade);
    var badge = secret ? "Secret ending · " + n + " of " + m : "Ending " + n + " of " + m;
    var bw = Math.min(260, 40 + badge.length * 8);
    g.pill(W / 2 - bw / 2, 222, bw, 26, { fill: secret ? ro.accent : ro.primary, radius: 13, alpha: pop, glow: secret ? 1 : 0.4, glowColor: secret ? ro.accent : ro.primary });
    g.text(badge, W / 2, 235, { size: 13, weight: 800, color: ro.on(secret ? ro.accent : ro.primary), alpha: pop, maxWidth: bw - 14 });
    var tfit = fitSmall(g, e.title, 300, 28, 18, 900);
    g.text(e.title, W / 2, 278, { size: tfit, weight: 900, color: ro.ink, alpha: pop, maxWidth: 310 });
    // The ending's passage, typed like any scene.
    panel(g, ro, CARD.x, 306, CARD.w, 196, { fill: ro.strong, stroke: ro.line, strokeWidth: 1.5, radius: 22, alpha: pop });
    var fit = fitText(g, scene.text, CARD.w - 40, 6, 19, 14, 650);
    var lh = Math.round(fit.size * 1.32);
    var y0 = 306 + 98 - (fit.lines.length - 1) * lh / 2;
    var left = st.chars;
    for (var i = 0; i < fit.lines.length && left > 0; i++) {
      var line = fit.lines[i];
      g.text(left >= line.length ? line : line.slice(0, left), CARD.x + 20, y0 + i * lh, { size: fit.size, weight: 650, color: ro.ink, align: "left", alpha: pop });
      left -= line.length + 1;
    }
    var found = st.path.length + " choice" + (st.path.length === 1 ? "" : "s") + (st.hits ? " · " + st.hits + " ⚡" : "");
    var fw = Math.min(260, 44 + found.length * 8);
    panel(g, ro, W / 2 - fw / 2, 518, fw, 26, { fill: ro.strong, radius: 13, alpha: 0.92 * pop });
    g.text(found, W / 2, 531, { size: 13, weight: 800, color: ro.on(ro.strong), alpha: 0.85 * pop });
  }

  B.defineConcept({
    id: "rule.story_paths", kind: "rule", version: 1, formulas: ["story"],
    describe: "Walks the story graph: each scene's text types out (tap to skip), then its choices unlock; choices whose `need` flags aren't set stay hidden, and a chosen choice sets its `set` flags. A choice with skill {kind: 'timing', window, miss} opens a sweeping meter: a tap inside the glowing zone takes the choice (and scores), a miss or no tap goes to `miss`. Reaching an ending shows its card, then the run ends with success. Honors length rounds: each scene left is a round; when rounds run out it jumps to the nearest ending.",
    examples: ["ferry or fog on your first Saturday", "three ways home after the last cable car", "a picnic mystery with a secret ending"],
    params: {},
    consumes: ["clock.tick", "pointer.down", "input.select"],
    emits: ["story.scene", "story.choice", "story.skill", "story.ending", "story.reached_<n>", "rule.success", "rule.fail"],
    requires: ["space.story_page"], conflicts: [], ends: true,
    state: "story: {graph, scene, phase, flags, path, hits, first, ending}",
    tags: { mood: ["cozy", "curious", "warm", "playful", "dreamy"], energy: ["low"], competition: ["light"] },
    glue: [],
    setup: function (sdk) {
      var graph = buildGraph(sdk.content);
      var st = sdk.state.story = {
        graph: graph, scene: graph.start, phase: "wait", t0: 0, typedAt: -1, chars: 0,
        flags: {}, visited: {}, path: [], marks: [], first: "", hits: 0, misses: 0, scenes: 0,
        open: [], pick: -1, skill: null, skillPoints: 25, ending: "", next: "", over: false
      };
      sdk.state.choices = [];
      sdk.state.choices_locked = true;
      sdk.hud.label = "points";
      // Rounds here are a depth cap on scenes, not something a reader counts: no engine chip.
      sdk.hud.length = false;

      function enter(id) {
        var scene = graph.byId[id];
        if (!scene) { finish(null); return; }
        st.scene = id;
        st.visited[id] = true;
        st.scenes += 1;
        st.phase = "type";
        st.t0 = sdk.tick;
        st.typedAt = -1;
        st.chars = 0;
        st.pick = -1;
        st.skill = null;
        st.open = scene.ending ? [] : openChoices(scene, st.flags);
        sdk.state.choices = [];
        sdk.state.choices_locked = true;
        sdk.emit("story.scene", { id: id, index: st.scenes, ending: !!scene.ending, x: W / 2, y: CARD.y - 8 });
        if (scene.ending) {
          st.ending = id;
          sdk.emit("story.ending", { id: scene.ending.id, tone: scene.ending.tone, number: endingNumber(graph, id), total: graph.endings.length, x: W / 2, y: 200 });
          // Which ending, as an event name too, so a playtest's event counts show the endings bots found.
          sdk.emit("story.reached_" + endingNumber(graph, id), {});
          sdk.fx.sound(scene.ending.tone === "secret" ? "success" : "chime");
          sdk.fx.haptic("success");
          if (sdk.fx.sparkle) sdk.fx.sparkle(W / 2, 168, null, scene.ending.tone === "secret" ? 26 : 14);
        }
        // A scene with nothing to pick (bad content): head for the nearest ending.
        if (!scene.ending && !st.open.length) { st.next = nearestEnding(graph, id, st.flags); if (st.next === id) finish(null); }
      }

      function finish(scene) {
        if (st.over) return;
        st.over = true;
        st.phase = "done";
        sdk.state.choices_locked = true;
        if (scene && scene.ending) {
          sdk.emit("rule.success", { ending: scene.ending.id });
          sdk.end("success", { ending: scene.ending.id });
        } else {
          sdk.emit("rule.fail", { reason: "no_scene" });
          sdk.end("fail", { reason: "no_scene" });
        }
      }

      // Leave the current scene through choice `c` to `target` (a round for the length contract).
      function leave(c, target, hit) {
        var scene = graph.byId[st.scene];
        if (st.path.length === 0) st.first = c.id;
        st.path.push(String(c.index) + (c.skill && !hit ? "x" : ""));
        st.marks.push(c.skill ? (hit ? "⚡" : "💨") : "▫️");
        if (!(c.skill && !hit)) for (var i = 0; i < c.set.length; i++) st.flags[c.set[i]] = true;
        sdk.emit("story.choice", { scene: scene.id, choice: c.id, index: c.index, to: target, hit: !!hit });
        var dest = graph.byId[target] ? target : nearestEnding(graph, st.scene, st.flags);
        // The last round of a locked length goes straight to the nearest ending without spending
        // it: spending it would let the engine end the run before the ending card and its tag.
        var left = sdk.lengthLeft ? sdk.lengthLeft().rounds_left : null;
        if (left === 1) {
          if (!(graph.byId[dest] && graph.byId[dest].ending)) dest = nearestEnding(graph, dest, st.flags);
        } else if (sdk.lengthRound() === false && !(graph.byId[dest] && graph.byId[dest].ending)) {
          dest = nearestEnding(graph, dest, st.flags);
        }
        st.next = dest;
        st.phase = "move";
        st.t0 = sdk.tick;
        sdk.state.choices_locked = true;
      }

      sdk.on("input.select", function (e) {
        if (st.over || st.phase !== "choose" || sdk.ended) return;
        var c = st.open[Math.floor(num(e.value, -1))] || null;
        if (!c) return;
        st.pick = c.index;
        sdk.fx.sound("blip");
        sdk.fx.haptic("selection");
        if (c.skill) {
          st.phase = "skill";
          st.t0 = sdk.tick;
          st.skill = { choice: c, window: c.skill.window, center: 0.26 + sdk.rng() * 0.48, start: sdk.tick, at: -1, hit: null };
          sdk.state.choices_locked = true;
          sdk.fx.sound("whoosh");
        } else {
          leave(c, c.to, false);
        }
      });

      function judge(hit) {
        var sk = st.skill;
        sk.hit = hit;
        sk.at = sdk.tick;
        st.phase = "skillDone";
        st.t0 = sdk.tick;
        sdk.emit("story.skill", { hit: hit, x: W / 2, y: 340 });
        if (hit) {
          st.hits += 1;
          sdk.fx.sound("success"); sdk.fx.haptic("success");
          if (sdk.fx.sparkle) sdk.fx.sparkle(W / 2, 356, null, 12);
        } else {
          st.misses += 1;
          sdk.fx.sound("fail"); sdk.fx.haptic("warning"); sdk.fx.shake(3);
        }
      }

      sdk.on("pointer.down", function () {
        if (st.over || sdk.ended) return;
        if (st.phase === "type" && sdk.tick - st.t0 > 6) {
          var scene = graph.byId[st.scene];
          st.chars = scene ? scene.text.length : 0;
        } else if (st.phase === "skill" && sdk.tick - st.skill.start >= SKILL_GRACE) {
          var sk = st.skill;
          judge(Math.abs(markerAt(sdk.tick - sk.start) - sk.center) <= sk.window / 2);
        }
      });

      sdk.on("clock.tick", function () {
        if (st.over || sdk.ended) return;
        var scene = graph.byId[st.scene];
        if (st.phase === "wait") {
          if (!scene) { finish(null); return; }
          if (sdk.tick >= LEAD_IN) enter(graph.start);
          return;
        }
        if (st.phase === "type") {
          if (st.typedAt < 0) {
            st.chars = Math.max(st.chars, Math.floor((sdk.tick - st.t0) * TYPE_RATE));
            if (st.chars >= scene.text.length) { st.chars = scene.text.length; st.typedAt = sdk.tick; }
            return;
          }
          if (scene.ending) {
            if (sdk.tick - st.typedAt >= ENDING_HOLD) finish(scene);
            return;
          }
          if (st.next) { // nothing to pick here: move on
            st.phase = "move"; st.t0 = sdk.tick; return;
          }
          if (sdk.tick - st.typedAt >= CHOICE_DELAY && sdk.tick - st.t0 >= MIN_SCENE) {
            st.phase = "choose";
            st.t0 = sdk.tick;
            var pills = pillsFor(st.open.length);
            sdk.state.choices = pills.map(function (p, i) { return { x: p.x + p.w / 2, y: p.y + p.h / 2, w: p.w, h: p.h, value: i }; });
            sdk.state.choices_locked = true;
            if (sdk.state.poster_tick === undefined) sdk.state.poster_tick = sdk.tick + 24;
          }
          return;
        }
        if (st.phase === "choose") {
          // Pills slide in first, then unlock.
          if (sdk.state.choices_locked && sdk.tick - st.t0 >= 14) sdk.state.choices_locked = false;
          return;
        }
        if (st.phase === "skill") {
          if (sdk.tick - st.skill.start >= SKILL_TIMEOUT) judge(false);
          return;
        }
        if (st.phase === "skillDone") {
          if (sdk.tick - st.t0 >= SKILL_SHOW) {
            var sk = st.skill;
            leave(sk.choice, sk.hit ? sk.choice.to : (sk.choice.skill.miss || sk.choice.to), sk.hit);
          }
          return;
        }
        if (st.phase === "move") {
          if (sdk.tick - st.t0 >= MOVE) { var nx = st.next; st.next = ""; enter(nx); }
        }
      });

    }
  });

  B.defineConcept({
    id: "score.story_points", kind: "score", version: 1, formulas: ["story"],
    describe: "Adventure points: `scene_points` for every scene you visit, `skill_points` for every timing tap you land, and an ending bonus by tone (good, odd, secret; secret endings are worth the most). Longer, bolder paths score more.",
    examples: ["10 a scene, 25 a timing hit, 80 for the secret ending"],
    params: {
      scene_points: { type: "integer", default: 10, min: 1, max: 100, describe: "Points for each scene visited." },
      skill_points: { type: "integer", default: 25, min: 0, max: 200, describe: "Points for each timing tap landed." },
      good_bonus: { type: "integer", default: 40, min: 0, max: 500, describe: "Bonus for a good ending." },
      odd_bonus: { type: "integer", default: 30, min: 0, max: 500, describe: "Bonus for an odd (funny or strange) ending." },
      secret_bonus: { type: "integer", default: 80, min: 0, max: 500, describe: "Bonus for a secret ending." }
    },
    consumes: ["story.scene", "story.skill", "story.ending"], emits: [], requires: ["rule.story_paths"], conflicts: [],
    tags: { competition: ["light", "friendly"] },
    state: "",
    glue: [],
    setup: function (sdk, params) {
      if (sdk.state.story) sdk.state.story.skillPoints = params.skill_points;
      sdk.on("story.scene", function (e) { sdk.addScore(params.scene_points, e.ending ? null : { x: W / 2 + 120, y: 150 }); });
      sdk.on("story.skill", function (e) { if (e.hit && params.skill_points) sdk.addScore(params.skill_points, { x: e.x, y: e.y }); });
      sdk.on("story.ending", function (e) {
        var bonus = e.tone === "secret" ? params.secret_bonus : e.tone === "odd" ? params.odd_bonus : params.good_bonus;
        if (bonus) sdk.addScore(bonus, { x: e.x, y: e.y });
      });
    }
  });

  // ---- validation ------------------------------------------------------------------------------
  // Static checks (docs/BUBBLES.md 7.6). Errors use code "content" with a path into the content.
  function validateContent(content) {
    var out = [];
    function bad(message, path) { out.push({ code: "content", message: message, path: "content" + (path || "") }); }
    if (!content || typeof content !== "object") { bad("content must be an object with start and scenes"); return out; }
    var scenes = content.scenes;
    if (!Array.isArray(scenes) || scenes.length < 3) { bad("scenes must list 3–" + LIMIT.scenes + " scenes", ".scenes"); return out; }
    if (scenes.length > LIMIT.scenes) bad("at most " + LIMIT.scenes + " scenes", ".scenes");
    var byId = {}, index = {}, endingIds = {}, endings = [], flagsSet = {}, flagsAll = {};
    scenes.forEach(function (s, i) {
      var p = ".scenes[" + i + "]";
      if (!s || typeof s !== "object") { bad("scene must be an object", p); return; }
      if (!isStr(s.id)) { bad("scene needs an id", p + ".id"); return; }
      if (s.id.length > LIMIT.id) bad("scene id is too long (" + LIMIT.id + " characters max)", p + ".id");
      if (byId[s.id]) { bad("scene id \"" + s.id + "\" is used twice", p + ".id"); return; }
      byId[s.id] = s; index[s.id] = i;
      if (!isStr(s.text)) bad("scene needs text", p + ".text");
      else if (s.text.length > LIMIT.text) bad("scene text is too long (" + s.text.length + " of " + LIMIT.text + " characters)", p + ".text");
      if (s.speaker != null && (typeof s.speaker !== "string" || s.speaker.length > LIMIT.speaker)) bad("speaker must be a short name (" + LIMIT.speaker + " characters max)", p + ".speaker");
      if (s.emoji != null && (typeof s.emoji !== "string" || s.emoji.length > LIMIT.emoji)) bad("emoji must be one emoji", p + ".emoji");
      if (s.ending != null) {
        var e = s.ending;
        if (!e || typeof e !== "object") { bad("ending must be an object {id, title, emoji, tone}", p + ".ending"); return; }
        if (!isStr(e.id) || e.id.length > LIMIT.id) bad("ending needs a short id", p + ".ending.id");
        else if (endingIds[e.id]) bad("ending id \"" + e.id + "\" is used twice", p + ".ending.id");
        else endingIds[e.id] = true;
        if (!isStr(e.title) || e.title.length > LIMIT.title) bad("ending needs a title (" + LIMIT.title + " characters max)", p + ".ending.title");
        if (!isStr(e.emoji) || e.emoji.length > LIMIT.emoji) bad("ending needs an emoji", p + ".ending.emoji");
        if (TONES.indexOf(e.tone) < 0) bad("ending tone must be good, odd or secret", p + ".ending.tone");
        if (Array.isArray(s.choices) && s.choices.length) bad("an ending scene has no choices", p + ".choices");
        endings.push(s.id);
        return;
      }
      if (!Array.isArray(s.choices) || s.choices.length < 1 || s.choices.length > LIMIT.choices) { bad("a scene that isn't an ending needs 1–" + LIMIT.choices + " choices", p + ".choices"); return; }
      var ids = {};
      s.choices.forEach(function (c, k) {
        var cp = p + ".choices[" + k + "]";
        if (!c || typeof c !== "object") { bad("choice must be an object", cp); return; }
        if (!isStr(c.text)) bad("choice needs text", cp + ".text");
        else if (c.text.length > LIMIT.choice) bad("choice text is too long (" + c.text.length + " of " + LIMIT.choice + " characters)", cp + ".text");
        var cid = isStr(c.id) ? c.id : slug(c.text);
        if (isStr(c.id) && c.id.length > LIMIT.id) bad("choice id is too long", cp + ".id");
        if (ids[cid]) bad("two choices in this scene share the id \"" + cid + "\"", cp + ".id");
        ids[cid] = true;
        if (c.past != null && (typeof c.past !== "string" || c.past.length > LIMIT.past)) bad("past must be a short phrase (" + LIMIT.past + " characters max), e.g. \"took the ferry\"", cp + ".past");
        ["set", "need"].forEach(function (key) {
          if (c[key] == null) return;
          if (!Array.isArray(c[key]) || c[key].some(function (f) { return !isStr(f) || f.length > LIMIT.id; })) bad(key + " must be a list of short flag names", cp + "." + key);
          else c[key].forEach(function (f) { flagsAll[f] = true; if (key === "set") flagsSet[f] = true; });
        });
        if (c.skill != null) {
          var sk = c.skill;
          if (!sk || typeof sk !== "object" || sk.kind !== "timing") bad("skill must be {kind: \"timing\", window, miss}", cp + ".skill");
          else {
            if (typeof sk.window !== "number" || sk.window < 0.15 || sk.window > 0.4) bad("skill.window must be 0.15–0.4 (the share of the meter that counts as a hit)", cp + ".skill.window");
            if (!isStr(sk.miss)) bad("skill.miss must name the scene a missed tap goes to", cp + ".skill.miss");
          }
        }
      });
    });
    if (out.length) return out;
    // Targets.
    scenes.forEach(function (s, i) {
      (s.choices || []).forEach(function (c, k) {
        var cp = ".scenes[" + i + "].choices[" + k + "]";
        if (!byId[c.to]) bad("choice points at \"" + c.to + "\", which isn't a scene", cp + ".to");
        else if (c.to === s.id) bad("choice points back at its own scene", cp + ".to");
        if (c.skill && isStr(c.skill.miss) && !byId[c.skill.miss]) bad("skill.miss points at \"" + c.skill.miss + "\", which isn't a scene", cp + ".skill.miss");
        (c.need || []).forEach(function (f) { if (!flagsSet[f]) bad("needs flag \"" + f + "\", but no choice sets it", cp + ".need"); });
      });
    });
    if (!isStr(content.start) || !byId[content.start]) bad("start must name a scene", ".start");
    if (endings.length < LIMIT.endings[0] || endings.length > LIMIT.endings[1]) bad("a story needs " + LIMIT.endings[0] + "–" + LIMIT.endings[1] + " endings (it has " + endings.length + ")", ".scenes");
    if (Object.keys(flagsAll).length > LIMIT.flags) bad("at most " + LIMIT.flags + " flags", ".scenes");
    if (out.length) return out;

    function edges(s) {
      var nx = [];
      (s.choices || []).forEach(function (c) { nx.push(c.to); if (c.skill && c.skill.miss) nx.push(c.skill.miss); });
      return nx;
    }
    // No loops: every path moves forward (depth-first, colors).
    var color = {}, loop = null;
    function visit(id, trail) {
      if (loop) return;
      color[id] = 1;
      var nx = edges(byId[id]);
      for (var i = 0; i < nx.length && !loop; i++) {
        if (color[nx[i]] === 1) loop = trail.concat([id, nx[i]]);
        else if (!color[nx[i]]) visit(nx[i], trail.concat([id]));
      }
      color[id] = 2;
    }
    visit(content.start, []);
    if (loop) { bad("the story loops (" + loop.slice(-3).join(" → ") + "); every path must move forward to an ending", ".scenes[" + index[loop[loop.length - 2]] + "]"); return out; }
    // Orphans: every scene is reachable from start.
    scenes.forEach(function (s, i) { if (!color[s.id]) bad("scene \"" + s.id + "\" can't be reached from start", ".scenes[" + i + "]"); });
    if (out.length) return out;
    // Depth: the longest path, in choices, stays within the cap.
    var memo = {};
    function depth(id) {
      if (memo[id] !== undefined) return memo[id];
      var best = 0;
      edges(byId[id]).forEach(function (n) { best = Math.max(best, 1 + depth(n)); });
      memo[id] = best;
      return best;
    }
    var d = depth(content.start);
    if (d > LIMIT.depth) bad("the story is too deep: its longest path has " + d + " choices (" + LIMIT.depth + " max)", ".scenes");
    // Flags respected: walk (scene, flags) states. Every state must have a choice it can take,
    // and every ending must be reached.
    var reached = {}, seenState = {}, queue = [[content.start, {}]], head = 0, deadEnds = {};
    while (head < queue.length && head < 6000) {
      var item = queue[head++], id = item[0], flags = item[1], s = byId[id];
      if (s.ending) { reached[id] = true; continue; }
      var open = (s.choices || []).filter(function (c) { return hasFlags(flags, c.need || []); });
      if (!open.length && !deadEnds[id]) {
        deadEnds[id] = true;
        bad("scene \"" + s.id + "\" is a dead end: you can arrive without the flags all of its choices need", ".scenes[" + index[id] + "]");
      }
      open.forEach(function (c) {
        var next = {};
        Object.keys(flags).forEach(function (f) { next[f] = true; });
        (c.set || []).forEach(function (f) { next[f] = true; });
        var targets = [[c.to, next]];
        if (c.skill && c.skill.miss) targets.push([c.skill.miss, flags]);
        targets.forEach(function (t) {
          var key = t[0] + "|" + Object.keys(t[1]).sort().join(",");
          if (seenState[key]) return;
          seenState[key] = true;
          queue.push(t);
        });
      });
    }
    endings.forEach(function (id) {
      if (!reached[id]) bad("ending \"" + byId[id].ending.id + "\" can't be reached: no path sets the flags it needs before you get there", ".scenes[" + index[id] + "]");
    });
    return out;
  }

  // ---- bot -------------------------------------------------------------------------------------
  // Reads for a while (faster with skill), then picks an open choice with botRng: bolder bots lean
  // toward timing choices and freshly unlocked ones. Timing taps land with a probability tied to
  // skill, so skilled bots take bolder paths and score more.
  function decide(sdk) {
    var st = sdk.state.story;
    if (!st || st.over) return [];
    var m = botMem(sdk);
    var skill = skillOf(sdk);
    var rnd = function () { return sdk.botRng(); };
    if (st.phase === "choose" && !sdk.state.choices_locked) {
      var key = "c|" + st.scene + "|" + st.t0;
      if (m.key !== key) {
        m.key = key;
        var scene = st.graph.byId[st.scene];
        var read = 0.4 + (scene ? scene.text.length : 60) / 90 + rnd() * 1.1 - 0.35 * skill;
        m.at = sdk.tick + Math.max(12, Math.round(read * 60));
        // Boldness: a timing choice, then a freshly unlocked one, then one that sets a flag, then
        // anything that doesn't end the story yet. Bold bots take the boldest choice (ties at
        // random) most of the time; everyone else picks at random, so bot seeds walk different paths.
        var bold = st.open.map(function (c) {
          var target = st.graph.byId[c.to];
          return (c.skill ? 4 : 0) + (c.need.length ? 2 : 0) + (c.set.length ? 1 : 0) + (target && !target.ending ? 1 : 0);
        });
        var roll = rnd(), pool = [];
        if (rnd() < 0.15 + 0.75 * skill) {
          var best = Math.max.apply(null, bold);
          for (var i = 0; i < bold.length; i++) if (bold[i] === best) pool.push(i);
        } else {
          for (var j = 0; j < bold.length; j++) pool.push(j);
        }
        var pick = pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))];
        m.pick = pick;
        m.done = false;
      }
      if (!m.done && sdk.tick >= m.at) {
        m.done = true;
        var t = sdk.state.choices[m.pick];
        if (!t) return [];
        return [{ a: "tap", v: [Math.round((t.x + (rnd() - 0.5) * t.w * 0.6) * 10) / 10, Math.round((t.y + (rnd() - 0.5) * t.h * 0.4) * 10) / 10] }];
      }
      return [];
    }
    if (st.phase === "skill" && st.skill) {
      var sk = st.skill, k2 = "s|" + sk.start;
      if (m.key !== k2) {
        m.key = k2;
        m.done = false;
        var hit = rnd() < 0.08 + 0.88 * skill * skill;
        var react = Math.round(8 + (1 - skill) * 24 + rnd() * 10);
        m.at = -1;
        for (var tt = Math.max(SKILL_GRACE, react); tt < SKILL_TIMEOUT - 2; tt++) {
          var inZone = Math.abs(markerAt(tt) - sk.center) <= sk.window / 2 * (hit ? 0.7 : 1);
          if (hit ? inZone : (!inZone && Math.abs(markerAt(tt) - sk.center) > sk.window / 2 + 0.06)) { m.at = sk.start + tt; break; }
        }
        // Some misses just let the meter run out.
        if (!hit && rnd() < 0.3) m.at = -1;
      }
      if (!m.done && m.at >= 0 && sdk.tick >= m.at) {
        m.done = true;
        return [{ a: "tap", v: [180, 360] }];
      }
    }
    return [];
  }

  function share(sdk) {
    var st = sdk.state.story;
    var mf = sdk.manifest || {};
    var title = (mf.style && mf.style.emoji ? mf.style.emoji + " " : "") + (mf.title || "Adventure");
    if (!st) return { headline: title, score_text: sdk.score + " points" };
    var scene = st.graph.byId[st.ending];
    var m = st.graph.endings.length;
    if (!scene || !scene.ending) return { headline: title, score_text: "Still exploring · " + sdk.score + " points" };
    var n = endingNumber(st.graph, scene.id);
    var marks = st.marks.join("") + scene.ending.emoji;
    var path = st.path.join(".");
    var tag = "ending=" + scene.ending.id + ";first=" + (st.first || "") + ";found=" + n + "/" + m + ";path=" + path;
    if (tag.length > 120) tag = tag.slice(0, 120).replace(/[.;][^.;]*$/, "");
    return { headline: title, score_text: "Ending " + n + " of " + m + " · " + scene.ending.emoji, emoji_grid: marks, tag: tag };
  }

  // ---- formula ---------------------------------------------------------------------------------
  B.defineFormula({
    id: "story",
    title: "Adventure",
    describe: "A story you play (category Adventure): short scenes that type out, 1–3 choices per scene, flags that unlock choices later, a quick timing tap on a bold choice (land it for the bold path, miss it for the safe one) and 2–6 endings to find, one of them secret. A run is one path, 15–60 seconds; replays find the other endings.",
    core: ["space.story_page", "input.select", "rule.story_paths", "score.story_points"],
    optional: ["feel.mood_preset"],
    tips: [
      "Plan the graph first: 6–12 scenes, 3–4 endings (one secret, gated by a flag set earlier), at most 3 choices per scene, every path 3–8 choices long.",
      "Scene text is at most 160 characters, second person, present tense. Choice text is at most 28 characters and starts with a verb; give each choice `past` (\"took the ferry\") so friends can read who took which path.",
      "Use skill moments (a timing tap) on at most two bold choices; skill.miss must lead somewhere fun, not a punishment.",
      "Paper, ink and riso looks suit stories; keep the palette calm so long text reads."
    ],
    length: { modes: ["rounds", "endless"], default: { mode: "rounds", rounds: LIMIT.depth }, knobs: {} },
    content: {
      describe: "start: the first scene's id. scenes: 3–40 scenes of {id (short, unique), text (≤160 chars, second person), speaker? (a first name), emoji?, choices: 1–3 of {id? (short), text (≤28 chars), to (a scene id), past? (≤32 chars, e.g. \"took the ferry\"), set? [flags], need? [flags: the choice shows only when all are set], skill? {kind: \"timing\", window: 0.15–0.4, miss: scene id for a missed tap}} } or, for an ending scene, ending: {id, title (≤40), emoji, tone: good|odd|secret} and no choices. 2–6 endings; no loops; every scene reachable; longest path ≤ 12 choices.",
      schema: {
        type: "object", required: ["start", "scenes"],
        properties: {
          start: { type: "string", minLength: 1, maxLength: 24 },
          scenes: {
            type: "array", minItems: 3, maxItems: 40,
            items: {
              type: "object", required: ["id", "text"],
              properties: {
                id: { type: "string", minLength: 1, maxLength: 24 },
                text: { type: "string", minLength: 1, maxLength: 160 },
                speaker: { type: "string", maxLength: 24 },
                emoji: { type: "string", maxLength: 16 },
                choices: {
                  type: "array", maxItems: 3,
                  items: {
                    type: "object", required: ["text", "to"],
                    properties: {
                      id: { type: "string", maxLength: 24 },
                      text: { type: "string", minLength: 1, maxLength: 28 },
                      to: { type: "string", minLength: 1, maxLength: 24 },
                      past: { type: "string", maxLength: 32 },
                      set: { type: "array", items: { type: "string", maxLength: 24 } },
                      need: { type: "array", items: { type: "string", maxLength: 24 } },
                      skill: { type: "object", required: ["kind", "window", "miss"], properties: { kind: { type: "string", enum: ["timing"] }, window: { type: "number", minimum: 0.15, maximum: 0.4 }, miss: { type: "string", maxLength: 24 } } }
                    }
                  }
                },
                ending: { type: "object", required: ["id", "title", "emoji", "tone"], properties: { id: { type: "string", maxLength: 24 }, title: { type: "string", maxLength: 40 }, emoji: { type: "string", maxLength: 16 }, tone: { type: "string", enum: TONES } } }
              }
            }
          }
        }
      }
    },
    validateContent: validateContent,
    bot: { describe: "Reads each scene for 1–3 s (faster with skill), then picks an open choice: bolder bots lean toward timing choices and freshly unlocked ones. Lands timing taps with a probability that rises with skill.", decide: decide },
    share: share,
    example: {
      id: "example-story-bakery", version: 1, engine_version: 1,
      title: "The Last Loaf",
      one_line_rule: "Pick your path to the corner bakery's last loaf.",
      formula: "story",
      brief: { intent: "a cozy morning adventure for newcomers", audience: "group:group-newinsf", mood: ["cozy", "playful"], energy: "low", competition: "light" },
      structure: { cadence: "endless", scope: "everyone", setter: "ai" },
      lineage: { parent: null, operators: [], remix_of: null },
      chain: null,
      style: { look: "paper", palette: "lilac-haze", font: "serif", motif: "city", emoji: "🥖", mood_preset: "cozy" },
      concepts: [
        { use: "space.story_page" },
        { use: "input.select" },
        { use: "rule.story_paths" },
        { use: "score.story_points" },
        { use: "feel.mood_preset" }
      ],
      glue: {},
      content: {
        start: "line",
        scenes: [
          { id: "line", emoji: "🥖", text: "The line at the corner bakery wraps around the block. A chalk sign says LAST LOAF AT 9. Your phone says 8:52.",
            choices: [
              { id: "wait", text: "Wait it out", to: "wait", past: "waited in line" },
              { id: "side-door", text: "Try the side door", to: "kitchen", past: "tried the side door", set: ["brave"], skill: { kind: "timing", window: 0.3, miss: "caught" } }
            ] },
          { id: "wait", emoji: "🕰️", text: "Ten minutes later you're third in line. The person ahead orders four loaves. Your neighbor Lena waves from across the street.",
            choices: [
              { id: "stay", text: "Keep your place", to: "lastloaf", past: "kept their place" },
              { id: "wave", text: "Wave Lena over", to: "lena", past: "waved Lena over" }
            ] },
          { id: "caught", emoji: "📦", text: "The side door swings back and you bump into a stack of flour sacks. A baker laughs and hands you yesterday's loaf.",
            choices: [{ id: "thanks", text: "Say thanks and go", to: "lastloaf", past: "got yesterday's loaf" }] },
          { id: "kitchen", emoji: "🧑‍🍳", speaker: "The baker", text: "You slip in as the baker turns, flour on her nose. \"Are you the new apprentice? You're late. Grab an apron.\"",
            choices: [
              { id: "apron", text: "Grab an apron", to: "apprentice", past: "grabbed an apron", need: ["brave"] },
              { id: "confess", text: "Confess and laugh", to: "lena", past: "confessed" }
            ] },
          { id: "lena", emoji: "☕", speaker: "Lena", text: "Lena hands you a coffee. \"Forget the line. There's a sunny bench up the hill with the best view of the fog.\"",
            choices: [{ id: "hill", text: "Follow Lena uphill", to: "bench", past: "followed Lena uphill" }] },
          { id: "lastloaf", emoji: "🥖", text: "The baker hands over the very last loaf, still warm. You tear off the end on the walk home. Worth every minute.",
            ending: { id: "last-loaf", title: "The Last Loaf", emoji: "🥖", tone: "good" } },
          { id: "bench", emoji: "🌁", text: "No bread, but the fog rolls under you like a slow river and Lena knows everyone who walks by. You make three new friends.",
            ending: { id: "fog-bench", title: "Bench Above the Fog", emoji: "🌁", tone: "odd" } },
          { id: "apprentice", emoji: "🍞", text: "By 10 you've shaped twelve loaves. The baker gives you one, and a standing invite every Saturday at 6.",
            ending: { id: "apprentice", title: "Saturday Apprentice", emoji: "🍞", tone: "secret" } }
        ]
      },
      seed: 2026111301
    }
  });
})();
