// Bubble kit: merge. See docs/BUBBLES.md, 4.6. Kits only call Bubble.defineFormula and Bubble.defineConcept.
//
// Drop and merge. Aim at the top of a glass jar and let a bubble go; two bubbles of the same tier
// that touch merge into the next tier (content.tiers: emoji or short labels, smallest first). The
// run fails when the pile stays over the fill line. By default the jar hangs upside down and
// bubbles float up into it from below (rise); rise: false drops them in from above instead.
//
// Physics is deterministic by construction: fixed 60 Hz ticks split into fixed substeps,
// position-based Verlet with a sweep-and-prune broad phase in a stable order, and only + - * /
// and sqrt in the math (no sin, pow or random), so a seed plus the input log replays bit for bit
// in every engine. No sleeping: piles settle through damping and floor/contact friction.
//
// Reuses the common kit: input.drag (aim while dragging, drop on release) or input.tap (drop where
// you tap), rule.timer (a time limit), share.emoji_grid (state.share_rows).
//
// State: state.jar (space), state.merge (bodies, drop queue; the entity), state.merge_rule,
// state.overflow, state.merge_score.
(function () {
  "use strict";
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var B = root.Bubble;
  if (!B || typeof B.defineConcept !== "function" || typeof B.defineFormula !== "function") return;

  var W = 360, CX = 180;
  var JAR_TOP = 156, JAR_FLOOR = 588;
  var SUB = 6;                       // physics substeps per tick
  var H = 1 / (60 * SUB);            // substep length (s)
  var DAMP = 0.997;                  // air drag per substep
  var VMAX = 9;                      // speed cap per substep (points)
  var MAX_BODIES = 72;
  var DEFAULT_TIERS = ["🫧", "💧", "🐚", "🦀", "🐟", "🐬", "🐋"];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function isStr(v) { return typeof v === "string" && v.trim().length > 0; }
  function skillOf(sdk) {
    var s = sdk.botSkill;
    if (typeof s !== "number" && sdk.bot && typeof sdk.bot.skill === "number") s = sdk.bot.skill;
    return clamp(typeof s === "number" && isFinite(s) ? s : 0.7, 0, 1);
  }
  var memo = typeof WeakMap === "function" ? new WeakMap() : null;
  function botMem(sdk) {
    var holder = sdk.botState && typeof sdk.botState === "object" ? sdk.botState : null;
    if (!holder) {
      holder = memo ? memo.get(sdk.state) : sdk.state.__mergeBot;
      if (!holder) { holder = {}; if (memo) memo.set(sdk.state, holder); else sdk.state.__mergeBot = holder; }
    }
    if (!holder.merge || sdk.tick < holder.merge.lastTick) holder.merge = { lastTick: 0, step: "idle" };
    holder.merge.lastTick = sdk.tick;
    return holder.merge;
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
  // A rounded-rectangle outline. The glow look strokes a pill with no fill; the other looks only
  // draw filled pills, so there the outline is g.line segments (corners as short chords) and
  // comes out in the look's own line style (pencil, pixels, neon tube, chalk...).
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
  function dots(g, x1, y1, x2, y2, gap, r, color, alpha) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
    var n = Math.max(1, Math.floor(len / gap));
    for (var i = 0; i <= n; i++) g.circle(x1 + dx * i / n, y1 + dy * i / n, r, color, alpha);
  }
  function tiersOf(content) {
    var t = content && Array.isArray(content.tiers) ? content.tiers.filter(isStr).map(String) : [];
    return t.length >= 3 ? t.slice(0, 10) : DEFAULT_TIERS.slice();
  }
  function isEmojiish(s) { return /[^\u0000-ɏ]/.test(s) && s.length <= 4; }
  // Tier radii by repeated multiplication (no pow), shrunk evenly if the top tier wouldn't fit.
  function radii(n, base, growth, maxR) {
    var g = growth;
    for (var tries = 0; tries < 40; tries++) {
      var r = base, top = base;
      for (var i = 1; i < n; i++) { r *= g; top = r; }
      if (top <= maxR || g <= 1.02) break;
      g -= 0.01;
    }
    var out = [base];
    for (var k = 1; k < n; k++) out.push(out[k - 1] * g);
    return out;
  }
  function tierColor(ro, t) { return ro.series[t % ro.series.length]; }

  // ---- physics -----------------------------------------------------------------------------------
  // Pure functions over a world {n, x[], y[], px[], py[], r[], tier[], age[], alive[], merged[],
  // order[]} and an env {L, R, floor, gh2, rmax, canMerge, keepTop, nT, radii}. The game steps
  // state.merge with them; the bot steps a copy to look ahead. Only + - * / and sqrt.

  // Sweep-and-prune order: insertion sort by x, stable (ties keep index order).
  function sortOrder(w) {
    var o = w.order, x = w.x;
    for (var a = 1; a < o.length; a++) {
      var v = o[a], xv = x[v], b = a - 1;
      while (b >= 0 && (x[o[b]] > xv || (x[o[b]] === xv && o[b] > v))) { o[b + 1] = o[b]; b--; }
      o[b + 1] = v;
    }
  }
  // Two touching bodies of one tier: i becomes the next tier at the midpoint, k disappears. Two
  // top-tier bodies both vanish (a burst). Returns the new tier, or -1 for a burst.
  function mergePair(w, i, k, env) {
    var t = w.tier[i];
    var mx = (w.x[i] + w.x[k]) * 0.5, my = (w.y[i] + w.y[k]) * 0.5;
    var vx = ((w.x[i] - w.px[i]) + (w.x[k] - w.px[k])) * 0.5;
    var vy = ((w.y[i] - w.py[i]) + (w.y[k] - w.py[k])) * 0.5;
    w.alive[k] = false;
    w.merged[i] = true; w.merged[k] = true;
    w.mx = mx; w.my = my;
    if (t + 1 >= env.nT) { w.alive[i] = false; return -1; }
    // The bigger bubble starts inside the jar (no one-frame poke through the glass).
    var nr = env.radii[t + 1];
    mx = clamp(mx, env.L + nr, env.R - nr);
    if (my > env.floor - nr) my = env.floor - nr;
    w.x[i] = mx; w.y[i] = my;
    w.px[i] = mx - vx * 0.5; w.py[i] = my - vy * 0.5;
    w.tier[i] = t + 1; w.r[i] = nr;
    w.age[i] = Math.max(w.age[i], w.age[k]);
    return t + 1;
  }
  function substep(w, env, onMerge) {
    var n = w.n, x = w.x, y = w.y, px = w.px, py = w.py, r = w.r, alive = w.alive;
    var i, k, a, b, gh2 = env.gh2, reach = env.rmax + 4;
    // Integrate (Verlet), with drag and a speed cap.
    for (i = 0; i < n; i++) {
      if (!alive[i]) continue;
      var vx = (x[i] - px[i]) * DAMP, vy = (y[i] - py[i]) * DAMP;
      var sp2 = vx * vx + vy * vy;
      if (sp2 > VMAX * VMAX) { var s = VMAX / Math.sqrt(sp2); vx *= s; vy *= s; }
      px[i] = x[i]; py[i] = y[i];
      x[i] += vx; y[i] += vy + gh2;
    }
    // Contacts: sweep along x in a stable order; area-weighted position correction plus a
    // little tangential friction so piles settle instead of creeping.
    sortOrder(w);
    var o = w.order;
    for (a = 0; a < o.length; a++) {
      i = o[a];
      if (!alive[i]) continue;
      for (b = a + 1; b < o.length; b++) {
        k = o[b];
        if (!alive[k]) continue;
        var dx = x[k] - x[i];
        if (dx > r[i] + reach) break;
        var rr = r[i] + r[k];
        if (dx >= rr) continue;
        var dy = y[k] - y[i];
        var d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        var d = Math.sqrt(d2), nx, ny;
        if (d < 1e-6) { nx = i < k ? 1 : -1; ny = 0; d = 0; } else { nx = dx / d; ny = dy / d; }
        var pen = rr - d;
        var mi = r[i] * r[i], mk = r[k] * r[k];
        var wi = mk / (mi + mk), wk = mi / (mi + mk);
        var c = pen * 0.9;
        x[i] -= nx * c * wi; y[i] -= ny * c * wi;
        x[k] += nx * c * wk; y[k] += ny * c * wk;
        var rvx = (x[k] - px[k]) - (x[i] - px[i]), rvy = (y[k] - py[k]) - (y[i] - py[i]);
        var f = (rvx * -ny + rvy * nx) * 0.04;
        px[i] -= -ny * f * wi; py[i] -= nx * f * wi;
        px[k] += -ny * f * wk; py[k] += nx * f * wk;
      }
    }
    // Walls and floor: inelastic (no bounce), with friction so piles settle.
    for (i = 0; i < n; i++) {
      if (!alive[i]) continue;
      if (x[i] - r[i] < env.L) { x[i] = env.L + r[i]; if (x[i] - px[i] < 0) px[i] = x[i]; py[i] = y[i] - (y[i] - py[i]) * 0.97; }
      if (x[i] + r[i] > env.R) { x[i] = env.R - r[i]; if (x[i] - px[i] > 0) px[i] = x[i]; py[i] = y[i] - (y[i] - py[i]) * 0.97; }
      if (y[i] + r[i] > env.floor) {
        y[i] = env.floor - r[i];
        if (y[i] - py[i] > 0) py[i] = y[i];
        px[i] = x[i] - (x[i] - px[i]) * 0.86;
      }
    }
    // Merges: equal tiers that touch, in a stable order; each body merges once per substep.
    if (!env.canMerge) return;
    for (i = 0; i < n; i++) w.merged[i] = false;
    for (a = 0; a < o.length; a++) {
      i = o[a];
      if (!alive[i] || w.merged[i]) continue;
      for (b = a + 1; b < o.length; b++) {
        k = o[b];
        if (!alive[k] || w.merged[k]) continue;
        var ddx = x[k] - x[i];
        if (ddx > r[i] * 2 + 2) break;
        if (w.tier[k] !== w.tier[i]) continue;
        if (env.keepTop && w.tier[i] >= env.nT - 1) continue;
        var ddy = y[k] - y[i], rr2 = r[i] + r[k] + 0.75;
        if (ddx * ddx + ddy * ddy <= rr2 * rr2) { onMerge(w, i, k); break; }
      }
    }
  }
  // Drop dead bodies, keeping the survivors' relative order (stable, deterministic).
  function compact(w) {
    var keep = 0, map = [], i;
    for (i = 0; i < w.n; i++) {
      if (!w.alive[i]) { map[i] = -1; continue; }
      map[i] = keep;
      if (keep !== i) {
        w.id[keep] = w.id[i]; w.x[keep] = w.x[i]; w.y[keep] = w.y[i]; w.px[keep] = w.px[i]; w.py[keep] = w.py[i];
        w.r[keep] = w.r[i]; w.tier[keep] = w.tier[i]; w.age[keep] = w.age[i]; w.alive[keep] = true; w.merged[keep] = false;
      }
      keep++;
    }
    if (keep === w.n) return;
    w.n = keep;
    w.id.length = keep; w.x.length = keep; w.y.length = keep; w.px.length = keep; w.py.length = keep;
    w.r.length = keep; w.tier.length = keep; w.age.length = keep; w.alive.length = keep; w.merged.length = keep;
    var o = [];
    for (var a = 0; a < w.order.length; a++) { var m = map[w.order[a]]; if (m >= 0) o.push(m); }
    w.order = o;
  }
  function envOf(state) {
    var st = state.merge, j = state.jar, rule = state.merge_rule;
    return { L: j.L, R: j.R, floor: j.floor, gh2: st.gh2, rmax: st.radii[st.radii.length - 1], canMerge: !!rule,
      keepTop: !!(rule && rule.keepTop), nT: st.tiers.length, radii: st.radii };
  }
  function cloneWorld(st) {
    return { n: st.n, id: st.id.slice(), x: st.x.slice(), y: st.y.slice(), px: st.px.slice(), py: st.py.slice(),
      r: st.r.slice(), tier: st.tier.slice(), age: st.age.slice(), alive: st.alive.slice(), merged: st.merged.slice(), order: st.order.slice() };
  }

  // ---- concepts --------------------------------------------------------------------------------

  B.defineConcept({
    id: "space.merge_jar", kind: "space", version: 1, formulas: ["merge"],
    describe: "The jar: a tall glass with a fill line near its open end. By default it hangs upside down and bubbles float up into it from the bottom of the screen (rise); with rise false it stands up and things drop in from above. Shows the bubble you're about to let go, a guide, the next one and the tier ladder.",
    examples: ["a glass jar of sea bubbles", "an upside-down jar where bubbles float up"],
    params: {
      width: { type: "integer", default: 300, min: 220, max: 330, describe: "Inner width of the jar in points (narrower = harder)." },
      line: { type: "number", default: 0.1, min: 0.05, max: 0.3, describe: "Where the fill line sits, as a fraction of the jar's height from its open end (higher = less room)." },
      rise: { type: "boolean", default: true, describe: "true: bubbles float up into an upside-down jar (you aim from the bottom of the screen). false: the jar stands up and things drop in from above (better for heavy things like snacks)." }
    },
    consumes: [], emits: [], requires: ["entity.merge_orb"], conflicts: [],
    tags: { mood: ["calm", "cozy", "dreamy"], energy: ["low", "medium"] },
    state: "jar: {L, R, top, floor, line, chute_y, rise}",
    glue: [],
    setup: function (sdk, params) {
      var jar = sdk.state.jar = {
        L: CX - params.width / 2, R: CX + params.width / 2, top: JAR_TOP, floor: JAR_FLOOR,
        line: JAR_TOP + params.line * (JAR_FLOOR - JAR_TOP), chuteY: JAR_TOP - 46, rise: !!params.rise
      };
      // Logic runs in a "falls down" frame; rise flips it on screen.
      function sy(y) { return jar.rise ? JAR_TOP + JAR_FLOOR - y : y; }
      jar.toScreenY = null;
      sdk.layer(10, function (g) {
        var ro = roles(g.palette);
        var L = jar.L - 10, R = jar.R + 10;
        var yTop = sy(jar.top - 6), yBot = sy(jar.floor + 12);
        var y0 = Math.min(yTop, yBot), y1 = Math.max(yTop, yBot);
        var soft = glossy(g), lk = lookOf(g);
        // Glass: a tall rounded body; the rim marks the open end. In glow it's a lit soap-glass
        // outline; other looks draw it as a line in their own style (a neon tube in neon).
        var edgeCol = lk === "glow" ? ro.light : lk === "neon" ? ro.secondary : mixHex(ro.ink, ro.bgTop, 0.3);
        g.pill(L, y0, R - L, y1 - y0, { fill: ro.light, alpha: ro.dark ? 0.1 : 0.24, radius: 34 });
        if (lk === "glow") g.pill(L, y0, R - L, y1 - y0, { fill: null, stroke: edgeCol, strokeWidth: 5, radius: 34, alpha: 0.9, glow: 0.7, glowColor: ro.light });
        else roundOutline(g, L, y0, R - L, y1 - y0, 34, edgeCol, 4, 1);
        var rimY = jar.rise ? y1 : y0;
        g.pill(L - 8, rimY - 5, R - L + 16, 10, { fill: edgeCol, radius: 5, glow: 0.8, glowColor: ro.light });
        if (soft) g.pill(L + 9, y0 + 30, 7, (y1 - y0) * 0.55, { fill: ro.light, alpha: 0.5, radius: 3.5 });
        // Fill line: dashes that pulse in the danger color while the pile is over it.
        var ov = sdk.state.overflow;
        var danger = ov ? clamp(ov.danger / Math.max(1, ov.limit), 0, 1) : 0;
        var ly = sy(jar.line);
        var pulse = danger > 0 ? 0.6 + 0.4 * Math.abs(Math.sin(g.t * 8)) : 0;
        if (danger > 0) g.pill(jar.L + 2, ly - 4, jar.R - jar.L - 4, 8, { fill: ro.danger, alpha: 0.25 * pulse, radius: 4, glow: 1, glowColor: ro.danger });
        for (var dx = jar.L + 6; dx < jar.R - 10; dx += 18) {
          g.line(dx, ly, Math.min(dx + 10, jar.R - 6), ly, danger > 0 ? ro.danger : ro.ink, { width: 3 + 2 * danger, alpha: danger > 0 ? pulse : 0.3 });
        }
      });
    }
  });

  B.defineConcept({
    id: "entity.merge_orb", kind: "entity", version: 1, formulas: ["merge"],
    describe: "The tiered bubbles and their physics. Each drop is one of the `spawn_tiers` smallest tiers (small ones more often); the next one is shown in advance. Bubbles float up (or fall, with rise false), roll and pile up with deterministic circle physics; with rule.merge_on_touch two of the same tier that touch become one of the next tier. Aim with input.drag (let go to release) or release right where you tap with input.tap.",
    examples: ["seven sea tiers from 🫧 to 🐋", "SF snacks from a crumb to a whole sourdough"],
    params: {
      base_radius: { type: "number", default: 17, min: 12, max: 26, describe: "Radius of the smallest tier in points." },
      growth: { type: "number", default: 1.25, min: 1.12, max: 1.4, describe: "Each tier is this much wider than the one before (shrinks automatically so the top tier fits)." },
      spawn_tiers: { type: "integer", default: 4, min: 2, max: 5, describe: "Drops come from this many of the smallest tiers." },
      gravity: { type: "number", default: 1, min: 0.5, max: 2, describe: "How fast bubbles fall (1 = a gentle, floaty fall)." },
      cooldown: { type: "number", default: 0.5, min: 0.25, max: 1.2, describe: "Seconds between drops." }
    },
    consumes: ["clock.tick", "input.aim?", "input.launch?", "input.action?"], emits: ["entity.dropped", "entity.merged", "entity.maxed"],
    requires: ["space.merge_jar", "input.drag|input.tap"], conflicts: [],
    tags: { mood: ["calm", "cozy"], energy: ["low", "medium"] },
    state: "merge: {n, x[], y[], r[], tier[], age[], current, next, aim, ready_at, radii, tiers}",
    glue: ["spawn"],
    setup: function (sdk, params) {
      var tiers = tiersOf(sdk.content);
      var nT = tiers.length;
      var jarW = sdk.state.jar ? sdk.state.jar.R - sdk.state.jar.L : 300;
      var R = radii(nT, params.base_radius, params.growth, jarW * 0.36);
      var G = 1500 * params.gravity;
      var GH2 = G * H * H;
      var st = sdk.state.merge = {
        tiers: tiers, radii: R, n: 0, nextId: 1,
        id: [], x: [], y: [], px: [], py: [], r: [], tier: [], age: [], alive: [], merged: [],
        order: [],
        current: 0, next: 0, aim: CX, aiming: false, readyAt: 0, drops: 0, maxTier: 0,
        lastMerge: { tick: -1000, x: 0, y: 0, tier: 0 }, combo: 0, pops: [], gh2: GH2
      };
      var spawnTiers = Math.min(params.spawn_tiers, Math.max(1, nT - 1));
      var spawnGlue = sdk.glue("spawn");
      function rollTier() {
        // Weighted toward small tiers: weights spawnTiers, spawnTiers-1, ..., 1.
        var total = spawnTiers * (spawnTiers + 1) / 2;
        var roll = sdk.rng() * total, t = 0;
        for (var k = 0; k < spawnTiers; k++) { roll -= spawnTiers - k; if (roll < 0) { t = k; break; } }
        if (spawnGlue) {
          var out = spawnGlue({ next: t, drops: st.drops, max_tier: st.maxTier, tiers: nT });
          var want = out && typeof out === "object" ? out.tier : out;
          if (typeof want === "number" && isFinite(want)) t = clamp(Math.floor(want), 0, spawnTiers - 1);
        }
        return t;
      }
      st.current = rollTier();
      st.next = rollTier();
      var cooldownTicks = Math.round(params.cooldown * 60);
      function jar() { return sdk.state.jar; }
      function clampAim(x, r) { var j = jar(); return clamp(x, j.L + r + 1, j.R - r - 1); }

      function add(t, x, y) {
        if (st.n >= MAX_BODIES) return -1;
        var i = st.n++;
        st.id[i] = st.nextId++; st.x[i] = x; st.y[i] = y; st.px[i] = x; st.py[i] = y;
        st.r[i] = R[t]; st.tier[i] = t; st.age[i] = 0; st.alive[i] = true; st.merged[i] = false;
        st.order.push(i);
        return i;
      }
      function drop(x) {
        if (sdk.ended || sdk.tick < st.readyAt) return;
        var t = st.current;
        var j = jar();
        var dx = clampAim(x, R[t]);
        add(t, dx, j.chuteY + 14);
        st.drops += 1;
        st.current = st.next;
        st.next = rollTier();
        st.readyAt = sdk.tick + cooldownTicks;
        st.aiming = false;
        sdk.emit("entity.dropped", { tier: t, x: dx });
        sdk.fx.sound("blip");
        sdk.fx.haptic("light");
      }
      // Share rows for share.emoji_grid: the tier ladder (hit = made it, miss = not yet).
      sdk.on("flow.phase", function (e) {
        if (e.name !== "fail" && e.name !== "success") return;
        var row = [];
        for (var t = 0; t < nT; t++) row.push(t <= st.maxTier ? "hit" : "miss");
        sdk.state.share_rows = [row];
      });
      sdk.on("input.aim", function (e) { if (!sdk.ended) { st.aim = clampAim(e.x, R[st.current]); st.aiming = true; } });
      sdk.on("input.launch", function (e) { st.aim = clampAim(e.x, R[st.current]); drop(e.x); });
      sdk.on("input.action", function (e) { st.aim = clampAim(e.x, R[st.current]); drop(e.x); });

      // A real merge: update the bodies, then events, combo and the flash.
      function onMerge(w, i, k) {
        var rule = sdk.state.merge_rule;
        var t = w.tier[i];
        var nt = mergePair(w, i, k, env);
        var mx = w.mx, my = w.my;
        var combo = sdk.tick - st.lastMerge.tick <= (rule ? rule.comboTicks : 30) ? st.combo + 1 : 1;
        st.combo = combo;
        st.lastMerge = { tick: sdk.tick, x: mx, y: my, tier: t + 1 };
        if (nt < 0) {
          // Two top-tier bubbles: both burst for a bonus.
          st.pops.push({ x: mx, y: my, tick: sdk.tick, tier: t });
          sdk.emit("entity.maxed", { tier: t, x: mx, y: my, combo: combo });
          return;
        }
        if (nt > st.maxTier) st.maxTier = nt;
        st.pops.push({ x: mx, y: my, tick: sdk.tick, tier: nt });
        sdk.emit("entity.merged", { tier: nt, from: t, x: mx, y: my, combo: combo, top: nt === nT - 1 });
      }
      var env = null;
      sdk.on("clock.tick", function () {
        env = envOf(sdk.state);
        for (var s = 0; s < SUB; s++) substep(st, env, onMerge);
        for (var i = 0; i < st.n; i++) st.age[i] += 1;
        compact(st);
        if (st.pops.length && sdk.tick - st.pops[0].tick > 30) st.pops.shift();
      });

      // Poster frame (cards, feed) before anything has dropped: a little pile showing the tiers.
      var POSTER_PILE = [[0.14, 0], [0.33, 2], [0.52, 1], [0.71, 3], [0.88, 0], [0.24, 4], [0.6, 2], [0.82, 1], [0.42, 5]];
      function drawPosterPile(g, ro, j) {
        var row = j.floor, x0 = j.L, span = j.R - j.L;
        for (var i = 0; i < POSTER_PILE.length; i++) {
          var t = Math.min(POSTER_PILE[i][1], nT - 1), r = R[t];
          var x = clamp(x0 + span * POSTER_PILE[i][0], j.L + r, j.R - r);
          var y = i < 5 ? row - r : row - 2 * R[3] - r + 6;
          if (i === 8) y = row - 2 * R[3] - 2 * R[4] - r + 18;
          var sy2 = j.rise ? JAR_TOP + JAR_FLOOR - y : y;
          g.bubble(x, sy2, r, { tint: tierColor(ro, t), glow: 1, wobble: 1 });
          var lab = st.tiers[t];
          if (isEmojiish(lab)) g.emoji(lab, x, sy2 + 1, r * 1.08);
          else g.text(lab, x, sy2, { size: Math.max(10, r * 0.5), weight: 800, color: inkFor(g, ro, tierColor(ro, t)), maxWidth: r * 1.7 });
        }
      }
      // Bodies.
      sdk.layer(20, function (g) {
        var ro = roles(g.palette), j = jar();
        var flip = j.rise;
        var ov = sdk.state.overflow;
        if (g.poster && !st.n) drawPosterPile(g, ro, j);
        for (var i = 0; i < st.n; i++) {
          var t = st.tier[i];
          var x = st.x[i], y = flip ? JAR_TOP + JAR_FLOOR - st.y[i] : st.y[i], r = st.r[i];
          var born = st.age[i] < 8 ? 0.85 + 0.15 * st.age[i] / 8 : 1;
          var warn = ov && ov.over && ov.over[st.id[i]] ? 0.5 + 0.5 * Math.sin(g.t * 12) : 0;
          if (warn > 0) g.orb(x, y, r + 5, ro.danger, { alpha: 0.35 * warn, glow: 1 });
          g.bubble(x, y, r * born, { tint: tierColor(ro, t), glow: 1, wobble: 1 });
          var lab = st.tiers[t];
          if (isEmojiish(lab)) g.emoji(lab, x, y + 1, r * 1.08 * born);
          else g.text(lab, x, y, { size: Math.max(10, r * 0.5), weight: 800, color: inkFor(g, ro, tierColor(ro, t)), maxWidth: r * 1.7 });
        }
        // Merge flashes.
        for (var k = 0; k < st.pops.length; k++) {
          var p = st.pops[k];
          var a = (sdk.tick - p.tick) / 18;
          if (a > 1) continue;
          var ry = flip ? JAR_TOP + JAR_FLOOR - p.y : p.y;
          var rr = (R[Math.min(p.tier, R.length - 1)] || 20) * (1 + a * 0.8);
          g.ring(p.x, ry, rr, glossy(g) ? ro.light : tierColor(ro, p.tier), { width: 4 * (1 - a) + 1, alpha: (1 - a) * 0.8 });
        }
      });
      // Chute: the bubble you're about to drop, its guide and the next one.
      sdk.layer(30, function (g) {
        var ro = roles(g.palette), j = jar();
        if (sdk.ended) return;
        var flip = j.rise;
        var t = st.current, r = R[t];
        var ready = sdk.tick >= st.readyAt;
        var cy = flip ? JAR_TOP + JAR_FLOOR - j.chuteY : j.chuteY;
        var ax = clampAim(st.aim, r);
        var grow = ready ? 1 : 0.55 + 0.45 * clamp(1 - (st.readyAt - sdk.tick) / Math.max(1, cooldownTicks), 0, 1);
        if (ready) {
          var endY = flip ? JAR_TOP + JAR_FLOOR - j.floor + 6 : j.floor - 6;
          dots(g, ax, cy + (flip ? -r - 8 : r + 8), ax, endY, 10, 1.7, glossy(g) ? ro.light : ro.ink, st.aiming ? 0.9 : 0.5);
        }
        g.bubble(ax, cy, r * grow, { tint: tierColor(ro, t), glow: 1, alpha: ready ? 1 : 0.8 });
        var lab = st.tiers[t];
        if (isEmojiish(lab)) g.emoji(lab, ax, cy + 1, r * 1.08 * grow);
        else g.text(lab, ax, cy, { size: Math.max(10, r * 0.5), weight: 800, color: inkFor(g, ro, tierColor(ro, t)), maxWidth: r * 1.7 });
        // Next.
        var nx = W - 34, ny = flip ? 604 : 98;
        g.text("Next", nx, ny - 26, { size: 11, weight: 800, color: ro.ink, alpha: 0.65 });
        var nr = Math.min(16, R[st.next]);
        g.bubble(nx, ny, nr, { tint: tierColor(ro, st.next), glow: 1 });
        var nl = st.tiers[st.next];
        if (isEmojiish(nl)) g.emoji(nl, nx, ny + 1, nr * 1.1);
        else g.text(nl, nx, ny, { size: 9, weight: 800, color: inkFor(g, ro, tierColor(ro, st.next)), maxWidth: nr * 1.8 });
      });
      // Tier ladder (along the bottom, or above an upside-down jar): reached tiers light up.
      sdk.layer(40, function (g) {
        var ro = roles(g.palette), j = jar(), ctx = g.ctx;
        var n = st.tiers.length, gap = Math.min(34, 300 / n), x0 = CX - (n - 1) * gap / 2;
        var y = j.rise ? 114 : 624;
        for (var i = 0; i < n; i++) {
          var reached = i <= st.maxTier;
          var lab = st.tiers[i];
          if (reached) g.orb(x0 + i * gap, y, 12, tierColor(ro, i), { glow: 0.7, alpha: 0.6 });
          else g.ring(x0 + i * gap, y, 11, ro.ink, { width: 1.5, alpha: 0.2 });
          if (isEmojiish(lab)) { ctx.globalAlpha = reached ? 1 : 0.3; g.emoji(lab, x0 + i * gap, y + 1, 16); ctx.globalAlpha = 1; }
          else g.text(lab, x0 + i * gap, y, { size: 9, weight: 800, color: ro.ink, alpha: reached ? 1 : 0.35, maxWidth: gap - 2 });
        }
      });
    }
  });

  B.defineConcept({
    id: "rule.merge_on_touch", kind: "rule", version: 1, formulas: ["merge"],
    describe: "Two bubbles of the same tier that touch merge into one of the next tier, right where they met (chains can cascade). Two top-tier bubbles burst for a bonus, or stay put with top_tier 'keep'. Optionally win by making a goal tier.",
    examples: ["two 🐟 make a 🐬", "make a 🐋 to win"],
    params: {
      top_tier: { type: "enum", values: ["burst", "keep"], default: "burst", describe: "What two top-tier bubbles do when they touch: burst (clears space, bonus points) or keep." },
      combo_seconds: { type: "number", default: 0.5, min: 0, max: 2, describe: "Merges within this many seconds of each other count as a combo (a cascade from one drop usually is one); score.merge_value multiplies them." },
      win_tier: { type: "integer", default: 0, min: 0, max: 10, describe: "Make this tier (1 = the smallest) to win right away. 0 = no goal tier." }
    },
    consumes: ["entity.merged", "entity.maxed?"], emits: ["rule.success"], requires: ["entity.merge_orb"], conflicts: [], ends: true,
    state: "merge_rule: {keepTop, comboTicks}",
    tags: { mood: ["calm", "cozy", "satisfying"], energy: ["low", "medium"] },
    glue: [],
    setup: function (sdk, params) {
      sdk.state.merge_rule = { keepTop: params.top_tier === "keep", comboTicks: Math.round(params.combo_seconds * 60) };
      var done = false;
      sdk.on("entity.merged", function (e) {
        var jar = sdk.state.jar;
        var y = jar && jar.rise ? JAR_TOP + JAR_FLOOR - e.y : e.y;
        sdk.fx.pop(e.x, y, null, 8 + e.tier * 3);
        if (e.combo > 1 && sdk.fx.sparkle) sdk.fx.sparkle(e.x, y, null, 6 + e.combo * 2);
        sdk.fx.sound(e.tier >= 4 || e.combo > 2 ? "chime" : "pop");
        sdk.fx.haptic(e.tier >= 4 ? "medium" : "light");
        if (e.tier >= 5) sdk.fx.shake(2 + e.tier * 0.5);
        if (!done && params.win_tier > 0 && e.tier + 1 >= params.win_tier && !sdk.ended) {
          done = true;
          sdk.emit("rule.success", { tier: e.tier });
          sdk.fx.sound("success");
          sdk.fx.haptic("success");
          sdk.end("success", { tier: e.tier, delay: 30 });
        }
      });
      sdk.on("entity.maxed", function (e) {
        var jar = sdk.state.jar;
        var y = jar && jar.rise ? JAR_TOP + JAR_FLOOR - e.y : e.y;
        sdk.fx.pop(e.x, y, null, 40);
        if (sdk.fx.sparkle) sdk.fx.sparkle(e.x, y, null, 24);
        sdk.fx.flash(null);
        sdk.fx.sound("success");
        sdk.fx.haptic("success");
        sdk.fx.shake(6);
      });
    }
  });

  B.defineConcept({
    id: "rule.overflow_fail", kind: "rule", version: 1, formulas: ["merge"],
    describe: "The run fails when settled bubbles stay past the fill line for `grace` seconds (fresh drops get a moment to settle first). The line pulses as a warning while they are past it.",
    examples: ["fail if the jar stays overfull for a second"],
    params: {
      grace: { type: "number", default: 1.2, min: 0.5, max: 3, describe: "Seconds the pile may stay over the line before the run fails." }
    },
    consumes: ["clock.tick"], emits: ["rule.fail"], requires: ["entity.merge_orb"], conflicts: [], ends: true,
    state: "overflow: {danger, limit, over: {id: true}}",
    tags: { energy: ["low", "medium"] },
    glue: [],
    setup: function (sdk, params) {
      var ov = sdk.state.overflow = { danger: 0, limit: Math.round(params.grace * 60), over: {} };
      sdk.on("clock.tick", function () {
        var st = sdk.state.merge, jar = sdk.state.jar;
        if (!st || !jar || sdk.ended) return;
        var any = false;
        ov.over = {};
        for (var i = 0; i < st.n; i++) {
          if (st.age[i] < 50) continue;
          if (st.y[i] - st.r[i] < jar.line) {
            var vy = st.y[i] - st.py[i];
            if (vy < 0.25 && vy > -0.25) { any = true; ov.over[st.id[i]] = true; }
          }
        }
        if (any) {
          if (ov.danger === 0) { sdk.fx.sound("tick"); sdk.fx.haptic("warning"); }
          ov.danger += 1;
        } else ov.danger = Math.max(0, ov.danger - 2);
        if (ov.danger >= ov.limit) {
          sdk.emit("rule.fail", { reason: "overflow" });
          sdk.fx.sound("fail");
          sdk.fx.haptic("warning");
          sdk.fx.shake(6);
          sdk.end("fail", { reason: "overflow", delay: 20 });
        }
      });
    }
  });

  B.defineConcept({
    id: "score.merge_value", kind: "score", version: 1, formulas: ["merge"],
    describe: "Points for every merge, more for bigger tiers: making tier k (k = 1 for the second tier) is worth `points` × k(k+1)/2 (1, 3, 6, 10, 15...). Merges in quick succession multiply (×1.5, ×2, up to ×3). Bursting two top-tier bubbles adds `burst_bonus`. The score glue gets {base, tier, combo, burst}.",
    examples: ["a 🐬 is worth 15 × 2 = 30; a three-merge cascade doubles it"],
    params: {
      points: { type: "integer", default: 2, min: 1, max: 50, describe: "Points for the smallest merge." },
      burst_bonus: { type: "integer", default: 150, min: 0, max: 2000, describe: "Bonus for bursting two top-tier bubbles." }
    },
    consumes: ["entity.merged", "entity.maxed?"], emits: [], requires: ["rule.merge_on_touch"], conflicts: [],
    tags: { competition: ["light", "friendly", "competitive"] },
    state: "merge_score: {merges, best_combo}",
    glue: ["score"],
    setup: function (sdk, params) {
      var st = sdk.state.merge_score = { merges: 0, bestCombo: 0 };
      var fn = sdk.glue("score");
      function award(base, info, x, y) {
        var pts = base;
        if (fn) {
          var out;
          try { out = fn(info); } catch (e) { out = undefined; }
          if (typeof out === "number" && isFinite(out)) pts = clamp(Math.round(out), 0, 100000);
        }
        var jar = sdk.state.jar;
        sdk.addScore(pts, { x: x, y: (jar && jar.rise ? JAR_TOP + JAR_FLOOR - y : y) - 24 });
      }
      sdk.on("entity.merged", function (e) {
        st.merges += 1;
        st.bestCombo = Math.max(st.bestCombo, e.combo);
        var mult = Math.min(3, 1 + 0.5 * (e.combo - 1));
        var base = Math.round(params.points * e.tier * (e.tier + 1) / 2 * mult);
        award(base, { base: base, tier: e.tier, combo: e.combo, burst: false }, e.x, e.y);
      });
      sdk.on("entity.maxed", function (e) {
        award(params.burst_bonus, { base: params.burst_bonus, tier: e.tier, combo: e.combo, burst: true }, e.x, e.y);
      });
    }
  });

  // ---- validation, bot, share ------------------------------------------------------------------
  function validateContent(content) {
    var out = [];
    function bad(message, path, warning) { out.push({ code: "content", message: message, path: "content" + (path || ""), warning: !!warning }); }
    if (!content || typeof content !== "object") { bad("content must be an object with tiers"); return out; }
    var t = content.tiers;
    if (!Array.isArray(t) || t.length < 3 || t.length > 10) { bad("tiers must list 3–10 emoji or short labels, smallest first", ".tiers"); return out; }
    var seen = {};
    t.forEach(function (s, i) {
      if (!isStr(s)) { bad("tier must be a non-empty string", ".tiers[" + i + "]"); return; }
      if (s.length > 10) bad("tier label is too long to fit in a bubble (10 characters max; an emoji is best)", ".tiers[" + i + "]");
      if (seen[s]) bad("tiers must all be different", ".tiers[" + i + "]");
      seen[s] = true;
    });
    if (t.length < 5) bad("5–8 tiers make the best runs", ".tiers", true);
    if (content.tier_names != null && (!Array.isArray(content.tier_names) || content.tier_names.length !== t.length)) bad("tier_names must have one name per tier", ".tier_names");
    return out;
  }

  // The bot scores drop columns: land on a twin of the same tier, keep the pile low and big
  // bubbles to the sides. Skilled bots also wait out a warning instead of dropping into it; weak
  // bots aim loosely, drop sooner and sometimes drop anywhere.
  function decide(sdk) {
    var st = sdk.state.merge, jar = sdk.state.jar;
    if (!st || !jar) return [];
    var mem = botMem(sdk);
    var skill = skillOf(sdk);
    function rnd() { return sdk.botRng(); }
    var chuteScreenY = jar.rise ? JAR_TOP + JAR_FLOOR - jar.chuteY : jar.chuteY;
    if (mem.step === "hold") {
      if (sdk.tick < mem.at) return [];
      mem.step = "idle";
      // Weak players hesitate between drops; skilled ones keep a steady rhythm.
      mem.wait = sdk.tick + Math.round((0.2 + (1 - skill) * 1.1) * 60 * (0.6 + 0.8 * rnd()));
      return [{ a: "up", v: [mem.x, chuteScreenY] }];
    }
    if (sdk.tick < st.readyAt || (mem.wait && sdk.tick < mem.wait)) return [];
    var t = st.current, r = st.radii[t];
    var room = jar.floor - jar.line;
    // How full is the jar? Highest settled top (smallest y) of anything not just dropped.
    var topY = jar.floor;
    for (var q = 0; q < st.n; q++) if (st.age[q] > 40 && st.y[q] - st.r[q] < topY) topY = st.y[q] - st.r[q];
    var ov = sdk.state.overflow;
    var fill = clamp((jar.floor - topY) / room, 0, 1);
    if ((ov && ov.danger > 0) || fill > 0.66) {
      // A nearly full jar: skilled bots let it settle (merges keep cascading) before dropping more.
      if (!mem.patience) mem.patience = sdk.tick + Math.round(skill * (ov && ov.danger > 0 ? 90 : 20 + 160 * (fill - 0.66)));
      if (sdk.tick < mem.patience) { mem.wait = sdk.tick + 6; return []; }
    } else mem.patience = 0;
    var best = CX, bestScore = -Infinity;
    var cols = 23, cand = [];
    for (var c = 0; c < cols; c++) {
      var x = jar.L + r + 1 + (jar.R - jar.L - 2 * r - 2) * c / (cols - 1);
      // Where would it land, and on what?
      var landY = jar.floor - r, hit = -1;
      for (var i = 0; i < st.n; i++) {
        var dx = st.x[i] - x, rr = r + st.r[i];
        if (dx * dx >= rr * rr) continue;
        var cy = st.y[i] - Math.sqrt(rr * rr - dx * dx);
        if (cy < landY) { landY = cy; hit = i; }
      }
      // Lower landings keep room under the line; skilled bots care more.
      var sc = (landY - jar.line) / room * (2 + 8 * skill);
      if (hit >= 0) {
        var ht = st.tier[hit];
        if (ht === t) {
          sc += 12;
          // The merged bubble might chain into a neighbor of the next tier.
          for (var k2 = 0; k2 < st.n; k2++) {
            if (k2 === hit || st.tier[k2] !== t + 1) continue;
            var cx2 = st.x[k2] - st.x[hit], cy2 = st.y[k2] - st.y[hit], reach = st.r[k2] + st.radii[Math.min(t + 1, st.radii.length - 1)] + 6;
            if (cx2 * cx2 + cy2 * cy2 < reach * reach) { sc += 4 * skill; break; }
          }
        } else {
          sc -= Math.abs(ht - t) * (0.8 + 1.2 * skill);
          if (ht < t) sc -= 2 + 3 * skill;
        }
      }
      // Neighbors of the same tier near the landing spot help chains.
      for (var k = 0; k < st.n; k++) {
        if (st.tier[k] !== t || k === hit) continue;
        var ddx = st.x[k] - x, ddy = st.y[k] - landY;
        if (ddx * ddx + ddy * ddy < (r * 3) * (r * 3)) sc += 3;
      }
      if (landY - r < jar.line + 3 * r) sc -= 10 + 10 * skill;
      // Big drops prefer the walls.
      sc += (Math.abs(x - CX) / 150) * (t >= 2 ? 1.5 : -0.3);
      sc += (rnd() - 0.5) * (1 - skill) * 14;
      cand.push({ x: x, sc: sc });
      if (sc > bestScore) { bestScore = sc; best = x; }
    }
    // Skilled bots play the best few columns forward for 40 ticks on a copy of the jar and keep
    // the one that merges most and leaves the most room under the line.
    if (rnd() < skill * skill) {
      cand.sort(function (p, q) { return q.sc - p.sc || p.x - q.x; });
      var env = envOf(sdk.state), look = Math.min(cand.length, 2 + Math.round(4 * skill)), bestV = -Infinity;
      for (var ci = 0; ci < look; ci++) {
        var v = lookAhead(st, env, jar, t, cand[ci].x, 40) + cand[ci].sc * 0.15;
        if (v > bestV) { bestV = v; best = cand[ci].x; }
      }
    }
    if (rnd() < 0.5 * (1 - skill) * (1 - skill)) best = jar.L + r + rnd() * (jar.R - jar.L - 2 * r);
    best += (rnd() + rnd() - 1) * r * (1 - skill) * 1.2;
    best = clamp(best, jar.L + r + 1, jar.R - r - 1);
    mem.x = Math.round(best * 10) / 10;
    mem.step = "hold";
    mem.at = sdk.tick + 4 + Math.round(rnd() * 8);
    return [{ a: "tap", v: [mem.x, chuteScreenY] }];
  }

  // Value of dropping tier t at x: plays `ticks` ticks forward on a copy (no events, no RNG).
  function lookAhead(st, env, jar, t, x, ticks) {
    var w = cloneWorld(st), gain = 0;
    var i = w.n++;
    w.id[i] = -1; w.x[i] = x; w.y[i] = jar.chuteY + 14; w.px[i] = x; w.py[i] = jar.chuteY + 14;
    w.r[i] = env.radii[t]; w.tier[i] = t; w.age[i] = 0; w.alive[i] = true; w.merged[i] = false;
    w.order.push(i);
    function onMerge(world, a, b) { var nt = mergePair(world, a, b, env); gain += nt < 0 ? env.nT + 2 : nt + 1; }
    for (var k = 0; k < ticks; k++) {
      for (var s = 0; s < SUB; s++) substep(w, env, onMerge);
      compact(w);
    }
    var top = jar.floor;
    for (var q = 0; q < w.n; q++) if (w.y[q] - w.r[q] < top) top = w.y[q] - w.r[q];
    var room = (top - jar.line) / Math.max(1, jar.floor - jar.line);
    return gain * 3 + room * 14 - (room < 0.08 ? 20 : 0);
  }

  function share(sdk) {
    var st = sdk.state.merge, sc = sdk.state.merge_score;
    var m = sdk.manifest || {};
    var title = (m.style && m.style.emoji ? m.style.emoji + " " : "") + (m.title || "Bubble");
    if (!st) return { headline: title, score_text: sdk.score + " points" };
    var ladder = st.tiers.map(function (t, i) { return i <= st.maxTier ? (isEmojiish(t) ? t : "🫧") : "⚪"; }).join("");
    var names = sdk.content && Array.isArray(sdk.content.tier_names) ? sdk.content.tier_names : null;
    var top = names && names[st.maxTier] ? names[st.maxTier] : st.tiers[st.maxTier];
    return { headline: title, score_text: sdk.score + " points · made " + top + (sc && sc.bestCombo > 2 ? " · " + sc.bestCombo + "× combo" : ""), emoji_grid: ladder };
  }

  B.defineFormula({
    id: "merge", title: "Merge",
    describe: "Float and merge: aim from the bottom and let a bubble go; it floats up into an upside-down jar (or drops into an upright one with rise false). Two of the same tier that touch merge into the next tier (content.tiers, smallest first: sea creatures, snacks, anything that grows) and big merges cascade. The run fails when the pile stays past the fill line; add rule.timer for a timed run that ends in success. Calm and satisfying; a run is 30–90 seconds.",
    core: ["space.merge_jar", "entity.merge_orb", "input.drag|input.tap", "rule.merge_on_touch", "rule.overflow_fail", "score.merge_value"],
    optional: ["rule.timer", "flow.run_retry", "flow.daily_gate", "share.emoji_grid", "share.score_card", "feel.mood_preset", "social.beat_marker"],
    tips: [
      "input.drag with show_line false lets people aim before they let go; input.tap drops right where you tap.",
      "rule.timer (60–90 s, outcome success) keeps runs snack-sized; without it the run lasts until the jar overflows.",
      "6–8 tiers with emoji read best; the top tier should feel like a prize (a whale, a whole sourdough).",
      "space.merge_jar rise (the default) floats bubbles up into an upside-down jar; rise false suits heavy things that drop."
    ],
    content: {
      describe: "tiers: 3–10 emoji (or labels of up to 10 characters), smallest first; two of a tier make the next. Optional tier_names: a word per tier for the share text (\"made a whale\").",
      schema: {
        type: "object", required: ["tiers"],
        properties: {
          tiers: { type: "array", minItems: 3, maxItems: 10, items: { type: "string", minLength: 1, maxLength: 10 } },
          tier_names: { type: "array", minItems: 3, maxItems: 10, items: { type: "string", maxLength: 16 } }
        }
      }
    },
    validateContent: validateContent,
    bot: { describe: "Scores 23 drop columns (land on a same-tier twin, keep the pile low, big bubbles to the walls) with noise that shrinks with skill; weak bots aim loosely and sometimes drop anywhere.", decide: decide },
    share: share,
    example: {
      id: "example-merge", version: 1, engine_version: 1,
      title: "Snack Stack",
      one_line_rule: "Drop snacks in the jar. Two of a kind merge into a bigger one.",
      formula: "merge",
      brief: { intent: "a calm merge game about SF snacks", audience: "everyone", mood: ["cozy"], energy: "low", competition: "light" },
      structure: { cadence: "endless", scope: "everyone", setter: "ai" },
      lineage: { parent: null, operators: [], remix_of: null },
      chain: null,
      style: { look: "pixel", palette: "peach-fizz", font: "pixel", motif: "none", emoji: "🥐", mood_preset: "cozy" },
      concepts: [
        { use: "space.merge_jar", params: { rise: false } },
        { use: "entity.merge_orb", params: { base_radius: 17, growth: 1.25, spawn_tiers: 4 } },
        { use: "input.drag", params: { show_line: false } },
        { use: "rule.merge_on_touch" },
        { use: "rule.overflow_fail" },
        { use: "rule.timer", params: { seconds: 75, outcome: "success" } },
        { use: "score.merge_value" },
        { use: "flow.run_retry" },
        { use: "share.emoji_grid" }
      ],
      glue: {},
      content: { tiers: ["🫐", "🍓", "🍪", "🥐", "🥯", "🥧", "🎂"], tier_names: ["a blueberry", "a strawberry", "a cookie", "a croissant", "a bagel", "a pie", "a whole cake"] },
      seed: 6161
    }
  });
})();
