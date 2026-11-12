/*
 * bubble-kit-dodge.js: the dodge formula (docs/BUBBLES.md 4.6).
 *
 * One-touch survival: float a glowing soap bubble through gaps in soft pastel pillars, hills, fog
 * banks or box stacks. Tap for a puff (behavior.impulse) or hold to rise (behavior.thrust).
 *
 * State: scroll {x, speed}, bounds {top, floor}, avatar {x, y, vy, r, alive}, physics {gravity,
 * max_fall, impulse, thrust, max_rise}, obstacles [pool of {on, x, w, gap_y, gap_h, label, ...}],
 * wind {active, dir, strength}. The bot reads these; it never writes them.
 * Events: entity.spawn {gap_y, gap_h, label, index}, entity.passed {x, y, near, index},
 * entity.near_miss {x, y}, entity.hit {kind, x, y}, entity.puff, behavior.gust {dir}.
 */
(function () {
  "use strict";
  const B = typeof Bubble !== "undefined" ? Bubble : null;
  if (!B) return;
  const clamp = B.util.clamp;
  const W = B.W;
  const POOL = 10;

  function avatarOf(sdk) { return sdk.state.avatar; }

  // Distance from point (px, py) to a rounded rectangle [x0, x1] x [y0, y1] with corner radius rc.
  function roundRectDist(px, py, x0, y0, x1, y1, rc) {
    const ix0 = x0 + rc, ix1 = x1 - rc, iy0 = y0 + rc, iy1 = y1 - rc;
    const dx = px < ix0 ? ix0 - px : px > ix1 ? px - ix1 : 0;
    const dy = py < iy0 ? iy0 - py : py > iy1 ? py - iy1 : 0;
    return Math.sqrt(dx * dx + dy * dy) - rc;
  }

  // Clearance between a circle and one obstacle pair, shared by collision, near misses and the bot.
  function clearanceAt(x, w, gapY, gapH, rc, px, py, r) {
    const top = gapY - gapH / 2, bot = gapY + gapH / 2;
    const dTop = roundRectDist(px, py, x, -2000, x + w, top, rc);
    const dBot = roundRectDist(px, py, x, bot, x + w, 3000, rc);
    return Math.min(dTop, dBot) - r;
  }
  function obstacleClearance(o, px, py, r) {
    return clearanceAt(o.x, o.w, o.gap_y, o.gap_h, o.rc, px, py, r);
  }

  // ------------------------------------------------------------------------------------------
  // Space
  // ------------------------------------------------------------------------------------------

  B.defineConcept({
    id: "space.side_scroll",
    kind: "space",
    formulas: ["dodge"],
    describe: "A side-scrolling sky. The world drifts left at speed (times state.pace), with parallax scenery drawn in the Bubble's look and a ground that pops the bubble if it touches.",
    examples: ["drifting over SF hills", "a calm bay with gentle waves", "a skyline at night"],
    params: {
      speed: { type: "number", default: 2.4, min: 1, max: 5, unit: "px/tick", describe: "Scroll speed at the start (2 calm, 3 brisk, 4 hard)" },
      backdrop: { type: "enum", values: ["auto", "hills", "clouds", "waves", "city", "stars", "grid", "dots", "leaves", "none"], default: "auto", describe: "Parallax scenery (auto: style.motif, else the look's motif, else hills)" },
      ground: { type: "boolean", default: true, describe: "A ground at the bottom that ends the run on touch" },
    },
    consumes: ["clock.tick"],
    state: "scroll: {x, speed}, bounds: {top, floor}",
    tags: { energy: ["low", "medium", "high"] },
    setup(sdk, p) {
      const scroll = (sdk.state.scroll = { x: 0, speed: p.speed });
      const bounds = (sdk.state.bounds = { top: 14, floor: p.ground ? 612 : 760 });
      sdk.on("clock.tick", () => {
        scroll.speed = p.speed * (sdk.state.pace || 1);
        scroll.x += scroll.speed;
      });
      // Scenery and ground come from the runtime, so every look draws them its own way.
      const opts = { scroll: 0 };
      sdk.layer(sdk.Z.background, (g) => {
        opts.scroll = scroll.x;
        g.scenery(p.backdrop, opts);
      });
      if (p.ground) sdk.layer(sdk.Z.space, (g) => g.ground(bounds.floor, scroll.x));
    },
  });

  // ------------------------------------------------------------------------------------------
  // Entities
  // ------------------------------------------------------------------------------------------

  B.defineConcept({
    id: "entity.avatar",
    kind: "entity",
    formulas: ["dodge"],
    describe: "The player: a glowing soap bubble with a little face (or an emoji inside). It drifts with gravity and pops on the ground or an obstacle.",
    examples: ["a soap bubble with a smile", "a moving box floating in a bubble (emoji 📦)"],
    params: {
      size: { type: "number", default: 15, min: 10, max: 24, unit: "px", describe: "Bubble radius" },
      x: { type: "number", default: 104, min: 60, max: 180, unit: "px", describe: "Horizontal position" },
      emoji: { type: "string", default: "", max_length: 8, describe: "Emoji inside the bubble (empty: content.avatar_emoji, or a face)" },
      face: { type: "boolean", default: true, describe: "Draw a little face when there's no emoji" },
      tint: { type: "enum", values: ["auto", "glow", "primary", "secondary", "accent", "accent1", "accent2", "accent3", "accent4"], default: "auto", describe: "Bubble color from the palette (auto: a glow look keeps the soap bubble clear, other looks use primary)" },
    },
    consumes: ["clock.tick", "flow.phase"],
    emits: ["entity.hit"],
    state: "avatar: {x, y, vy, r, alive}, physics: {gravity, max_fall, impulse, thrust, max_rise}",
    tags: { mood: ["any"] },
    setup(sdk, p) {
      const av = (sdk.state.avatar = { x: p.x, y: 300, vy: 0, r: p.size, alive: true, puffTick: -100 });
      sdk.state.physics = sdk.state.physics || { gravity: 0, max_fall: 9, impulse: 0, thrust: 0, max_rise: 7 };
      const bounds = () => sdk.state.bounds || { top: 14, floor: 760 };
      const TRAIL = 24;
      const trail = new Float32Array(TRAIL);
      for (let i = 0; i < TRAIL; i++) trail[i] = av.y;

      sdk.on("flow.phase", (e) => {
        if (e.name === "playing") { av.vy = -3.4; av.puffTick = sdk.tick; }
      });
      sdk.on("rule.fail", () => {
        if (!av.alive) return;
        av.alive = false;
        sdk.fx.pop(av.x, av.y, null, 26);
      });
      sdk.on("clock.tick", (e) => {
        trail[e.tick % TRAIL] = av.y;
        if (!av.alive || sdk.ended) return;
        const b = bounds();
        av.y += av.vy;
        if (av.y < b.top + av.r) { av.y = b.top + av.r; if (av.vy < 0) av.vy = 0; }
        if (av.y + av.r >= b.floor) {
          av.y = b.floor - av.r;
          sdk.emit("entity.hit", { kind: "floor", x: av.x, y: av.y });
        }
      });

      const pal = sdk.palette;
      const tint = p.tint === "auto" ? (pal.look === "glow" ? pal.glow : pal.primary)
        : p.tint === "glow" || p.tint === "primary" || p.tint === "secondary" || p.tint === "accent" ? pal[p.tint]
        : pal.accents[Math.max(0, Number(p.tint.slice(-1)) - 1)];
      const emoji = p.emoji || (typeof sdk.content.avatar_emoji === "string" ? sdk.content.avatar_emoji : "");
      const faceInk = pal.look === "neon" ? tint : pal.look === "chalk" || pal.look === "ink" ? pal.ink
        : pal.look === "glow" ? (pal.dark ? pal.inkOn(pal.glow) : pal.ink) : pal.inkOn(tint);
      const cheek = pal.look === "neon" ? pal.accent : pal.accents[3];

      sdk.layer(sdk.Z.entities, (g) => {
        if (!av.alive) return;
        let y = av.y;
        if (sdk.phase === "intro") y += Math.sin(g.t * 2.4) * 7;
        // Trail of tiny bubbles left behind (they drift with the world).
        const sp = sdk.state.scroll ? sdk.state.scroll.speed : 2;
        for (let k = 3; k < TRAIL; k += 4) {
          const ty = trail[(sdk.tick - k + TRAIL * 4) % TRAIL];
          const a = 0.5 * (1 - k / TRAIL);
          if (sdk.phase !== "playing") break;
          g.bubble(av.x - av.r * 0.6 - k * sp * 0.9, ty + Math.sin(k * 1.7 + g.t * 3) * 3, 2.2 + (TRAIL - k) * 0.12, { alpha: a, glow: 0 });
        }
        // Squash and stretch from vertical speed, plus a springy puff.
        const since = sdk.tick - av.puffTick;
        const puff = since >= 0 && since < 14 ? Math.sin((since / 14) * Math.PI) * 0.16 : 0;
        const stretch = clamp(av.vy * 0.018, -0.12, 0.14);
        const sx = 1 + puff - stretch * 0.6, sy = 1 - puff * 0.7 + stretch;
        const lives = sdk.state.lives;
        const blink = lives && sdk.tick < lives.grace_until && Math.floor(sdk.tick / 5) % 2 === 1;
        if (g.look === "glow" || g.look === "neon") g.halo(av.x, y, av.r * 2.6, tint, (pal.dark ? 0.35 : 0.5) * (blink ? 0.4 : 1));
        g.bubble(av.x, y, av.r, { tint, glow: 1, sx, sy, wobble: 0.6, alpha: blink ? 0.4 : 1 });
        if (emoji) {
          if (!blink) g.emoji(emoji, av.x, y + 1, av.r * 1.15);
        } else if (p.face && !blink) {
          const ctx = g.ctx;
          const look = clamp(av.vy * 0.25, -2, 2);
          ctx.fillStyle = faceInk;
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.arc(av.x - av.r * 0.28 + 1.5, y - av.r * 0.12 + look, av.r * 0.11, 0, Math.PI * 2);
          ctx.arc(av.x + av.r * 0.28 + 1.5, y - av.r * 0.12 + look, av.r * 0.11, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = Math.max(1.4, av.r * 0.09);
          ctx.strokeStyle = faceInk;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.arc(av.x + 1.5, y + av.r * 0.12 + look, av.r * 0.24, 0.15 * Math.PI, 0.85 * Math.PI);
          ctx.stroke();
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = cheek;
          ctx.beginPath();
          ctx.arc(av.x - av.r * 0.5 + 1.5, y + av.r * 0.18 + look, av.r * 0.12, 0, Math.PI * 2);
          ctx.arc(av.x + av.r * 0.5 + 1.5, y + av.r * 0.18 + look, av.r * 0.12, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      });
    },
  });

  B.defineConcept({
    id: "entity.obstacle",
    kind: "entity",
    formulas: ["dodge"],
    describe: "Pairs of soft obstacles with a gap to float through, labeled with words from content.obstacle_labels. Styles: pastel pillars, hills under fog banks, fog banks, or stacks of boxes. Emits entity.passed for each one cleared and entity.near_miss when you skim one.",
    examples: ["pastel pillars labeled with SF hills", "fog banks over the bay", "stacks of moving boxes"],
    params: {
      style: { type: "enum", values: ["pillar", "hill", "fog", "stack"], default: "pillar", describe: "How obstacles look" },
      width: { type: "number", default: 64, min: 44, max: 110, unit: "px", describe: "Obstacle width" },
      forgiveness: { type: "number", default: 4, min: 0, max: 10, unit: "px", describe: "How much a graze is forgiven" },
      near: { type: "number", default: 14, min: 4, max: 30, unit: "px", describe: "Clearance that counts as a near miss" },
      labels: { type: "boolean", default: true, describe: "Show content labels on obstacles" },
    },
    consumes: ["entity.spawn", "clock.tick"],
    emits: ["entity.passed", "entity.hit", "entity.near_miss"],
    requires: ["entity.avatar"],
    state: "obstacles: [{on, x, w, gap_y, gap_h, rc, label, passed}]",
    tags: { mood: ["any"] },
    setup(sdk, p) {
      const pool = [];
      for (let i = 0; i < POOL; i++) pool.push({ on: false, x: 0, w: p.width, gap_y: 320, gap_h: 180, rc: 16, label: "", passed: false, minClear: 99, index: 0, color: 0 });
      sdk.state.obstacles = pool;
      sdk.state.obstacle_rules = { forgiveness: p.forgiveness, near: p.near, style: p.style };
      const w = p.style === "hill" ? p.width * 1.35 : p.width;
      const rc = p.style === "hill" || p.style === "fog" ? w / 2 : p.style === "stack" ? 10 : 18;

      sdk.on("entity.spawn", (e) => {
        let slot = null;
        for (let i = 0; i < POOL; i++) if (!pool[i].on) { slot = pool[i]; break; }
        if (!slot) return;
        slot.on = true;
        slot.x = typeof e.x === "number" ? e.x : W + 40;
        slot.w = w;
        slot.rc = rc;
        slot.gap_y = e.gap_y;
        slot.gap_h = e.gap_h;
        slot.label = p.labels && e.label ? String(e.label) : "";
        slot.passed = false;
        slot.minClear = 99;
        slot.index = e.index | 0;
        slot.color = (e.index | 0) % 4;
      });

      sdk.on("clock.tick", () => {
        const av = avatarOf(sdk);
        const speed = sdk.state.scroll ? sdk.state.scroll.speed : 2.4;
        for (let i = 0; i < POOL; i++) {
          const o = pool[i];
          if (!o.on) continue;
          o.x -= speed;
          if (o.x + o.w < -140) { o.on = false; continue; }
          if (!av || !av.alive || sdk.ended) continue;
          if (av.x + av.r > o.x - 2 && av.x - av.r < o.x + o.w + 2) {
            const c = obstacleClearance(o, av.x, av.y, av.r);
            if (c < o.minClear) o.minClear = c;
            if (c + p.forgiveness < 0) {
              sdk.emit("entity.hit", { kind: "obstacle", x: av.x, y: av.y });
              if (sdk.ended) return;
            }
          }
          if (!o.passed && o.x + o.w < av.x - av.r) {
            o.passed = true;
            const near = o.minClear < p.near;
            sdk.emit("entity.passed", { x: av.x + 6, y: av.y - av.r - 14, near, index: o.index });
            if (near) {
              sdk.emit("entity.near_miss", { x: av.x, y: av.y });
              sdk.fx.sparkle(av.x + 4, av.y, sdk.palette.accents[1], 10);
            }
          }
        }
      });

      // Look
      // Colors come from palette roles; the look decides how they're drawn.
      const pal = sdk.palette;
      const glowLook = pal.look === "glow";
      const fills = pal.accents.map((a) => (glowLook ? B.color.mix(a, pal.glow, pal.dark ? 0.15 : 0.28) : a));
      const hillFills = pal.accents.map((a) => (glowLook ? B.color.mix(B.color.mix(a, pal.bottom, 0.35), pal.glow, pal.dark ? 0.05 : 0.2) : a));
      const fogColor = pal.mist;
      const boxFill = [pal.primary, pal.secondary, pal.accent].map((c) => (glowLook ? B.color.mix(c, pal.bottom, 0.2) : c));
      const tape = glowLook ? B.color.mix(pal.glow, pal.bottom, 0.3) : B.color.mix(pal.glow, pal.secondary, 0.25);
      const boxEdge = glowLook ? "rgba(255,255,255,0.7)" : undefined;
      const stripes = glowLook || pal.look === "paper" || pal.look === "clay";
      const labelFill = pal.surfaceStrong;
      const labelInk = pal.inkOn(labelFill);

      function puffColumn(g, o, yFrom, yTo, edgeY, down) {
        // A column of soft cloud puffs from yFrom to yTo with a puffy leading edge at edgeY.
        const cx = o.x + o.w / 2;
        const r = o.w * 0.5;
        const h = o.index * 7919;
        let k = 0;
        const step = r * 0.95;
        if (down) {
          for (let y = edgeY - r * 0.6; y > yFrom - r; y -= step) {
            const j = ((h + k * 31) % 17) / 17 - 0.5;
            g.puff(cx + j * o.w * 0.3, y, r * (1.05 + (((h >> 3) + k) % 5) * 0.04), fogColor, 0.82);
            k++;
          }
          g.puff(cx - o.w * 0.26, edgeY - r * 0.55, r * 0.7, fogColor, 0.9);
          g.puff(cx + o.w * 0.28, edgeY - r * 0.45, r * 0.64, fogColor, 0.9);
        } else {
          for (let y = edgeY + r * 0.6; y < yTo + r; y += step) {
            const j = ((h + k * 37) % 13) / 13 - 0.5;
            g.puff(cx + j * o.w * 0.3, y, r * (1.05 + (((h >> 4) + k) % 5) * 0.04), fogColor, 0.82);
            k++;
          }
          g.puff(cx - o.w * 0.26, edgeY + r * 0.55, r * 0.7, fogColor, 0.9);
          g.puff(cx + o.w * 0.28, edgeY + r * 0.45, r * 0.64, fogColor, 0.9);
        }
        g.ctx.globalAlpha = 1;
      }

      function boxStack(g, o, yFrom, yTo, fromBottom) {
        const bh = 44;
        let k = 0;
        if (fromBottom) {
          for (let y = yFrom; y < yTo; y += bh + 2) {
            const jx = ((o.index * 13 + k * 7) % 9) - 4;
            g.pill(o.x + jx, y, o.w, bh, { fill: boxFill[(o.index + k) % 3], radius: 9, glow: k === 0 ? 0.5 : 0, glowColor: pal.glow, stroke: boxEdge, strokeWidth: 1.2 });
            g.pill(o.x + jx + o.w / 2 - 5, y + 2, 10, bh - 4, { fill: tape, radius: 3, alpha: 0.85 });
            k++;
          }
        } else {
          for (let y = yTo - bh; y > yFrom - bh; y -= bh + 2) {
            const jx = ((o.index * 11 + k * 5) % 9) - 4;
            g.pill(o.x + jx, y, o.w, bh, { fill: boxFill[(o.index + k + 1) % 3], radius: 9, glow: k === 0 ? 0.5 : 0, glowColor: pal.glow, stroke: boxEdge, strokeWidth: 1.2 });
            g.pill(o.x + jx + o.w / 2 - 5, y + 2, 10, bh - 4, { fill: tape, radius: 3, alpha: 0.85 });
            k++;
          }
        }
      }

      sdk.layer(sdk.Z.space + 2, (g) => {
        const v = g.view;
        for (let i = 0; i < POOL; i++) {
          const o = pool[i];
          if (!o.on || o.x > v.x1 + 10 || o.x + o.w < v.x0 - 10) continue;
          const top = o.gap_y - o.gap_h / 2, bot = o.gap_y + o.gap_h / 2;
          const yTop0 = v.y0 - 30, yBot1 = v.y1 + 30;
          if (p.style === "pillar") {
            const fill = fills[o.color];
            g.pill(o.x, yTop0, o.w, top - yTop0, { fill, radius: o.rc, glow: 0.9, glowColor: fill, shade: 0.35 });
            g.pill(o.x, bot, o.w, yBot1 - bot, { fill, radius: o.rc, glow: 0.9, glowColor: fill, shade: 0.35 });
            if (stripes) {
              g.pill(o.x + o.w * 0.16, bot + 10, o.w * 0.13, Math.max(10, yBot1 - bot - 20), { fill: "rgba(255,255,255,0.45)", radius: o.w * 0.065 });
              g.pill(o.x + o.w * 0.16, yTop0 + 10, o.w * 0.13, Math.max(10, top - yTop0 - 20), { fill: "rgba(255,255,255,0.45)", radius: o.w * 0.065 });
            }
          } else if (p.style === "hill") {
            const fill = hillFills[o.color];
            puffColumn(g, o, yTop0, top, top, true);
            g.pill(o.x, bot, o.w, yBot1 - bot, { fill, radius: o.rc, glow: 0.8, glowColor: fill, shade: 0.3 });
            if (stripes) g.pill(o.x + o.w * 0.22, bot + o.w * 0.14, o.w * 0.16, o.w * 0.3, { fill: "rgba(255,255,255,0.5)", radius: o.w * 0.08 });
          } else if (p.style === "fog") {
            puffColumn(g, o, yTop0, top, top, true);
            puffColumn(g, o, bot, yBot1, bot, false);
          } else {
            boxStack(g, o, yTop0, top, false);
            boxStack(g, o, bot, yBot1, true);
          }
          if (o.label) {
            const lw = Math.min(118, 16 + o.label.length * 7.2);
            const ly = p.style === "hill" ? bot + o.w * 0.55 : bot + 24;
            g.pill(o.x + o.w / 2 - lw / 2, ly - 11, lw, 22, { fill: labelFill, radius: 11, glow: 0.5, glowColor: pal.glow });
            g.text(o.label, o.x + o.w / 2, ly + 0.5, { size: 11.5, weight: 800, color: labelInk, maxWidth: lw - 10 });
          }
        }
      });
    },
  });

  // ------------------------------------------------------------------------------------------
  // Behaviors
  // ------------------------------------------------------------------------------------------

  B.defineConcept({
    id: "behavior.gravity",
    kind: "behavior",
    formulas: ["dodge"],
    describe: "Pulls the avatar down every tick, up to a top falling speed. Lower is floatier.",
    examples: ["a slow, floaty fall (0.25)", "a snappy fall (0.45)"],
    params: {
      strength: { type: "number", default: 0.34, min: 0.1, max: 0.9, unit: "px/tick²", describe: "Fall acceleration" },
      max_fall: { type: "number", default: 9, min: 4, max: 14, unit: "px/tick", describe: "Top falling speed" },
    },
    consumes: ["clock.tick"],
    requires: ["entity.avatar"],
    tags: { energy: ["low", "medium", "high"] },
    setup(sdk, p) {
      const phys = (sdk.state.physics = sdk.state.physics || { gravity: 0, max_fall: 9, impulse: 0, thrust: 0, max_rise: 7 });
      phys.gravity = p.strength;
      phys.max_fall = p.max_fall;
      sdk.on("clock.tick", () => {
        const av = avatarOf(sdk);
        if (!av || !av.alive || sdk.ended) return;
        av.vy = Math.min(av.vy + p.strength, p.max_fall);
      });
    },
  });

  B.defineConcept({
    id: "behavior.impulse",
    kind: "behavior",
    formulas: ["dodge"],
    describe: "Each input.action gives the avatar an upward puff (sets its vertical speed).",
    examples: ["tap for a little puff upward"],
    params: {
      strength: { type: "number", default: 6.2, min: 3, max: 10, unit: "px/tick", describe: "Upward speed of a puff" },
    },
    consumes: ["input.action"],
    emits: ["entity.puff"],
    requires: ["entity.avatar"],
    conflicts: ["behavior.thrust"],
    tags: { energy: ["medium", "high"], skill: ["timing"] },
    setup(sdk, p) {
      const phys = (sdk.state.physics = sdk.state.physics || { gravity: 0, max_fall: 9, impulse: 0, thrust: 0, max_rise: 7 });
      phys.impulse = p.strength;
      sdk.on("input.action", () => {
        const av = avatarOf(sdk);
        if (!av || !av.alive || sdk.ended) return;
        av.vy = -p.strength;
        av.puffTick = sdk.tick;
        sdk.emit("entity.puff", { x: av.x, y: av.y });
      });
    },
  });

  B.defineConcept({
    id: "behavior.thrust",
    kind: "behavior",
    formulas: ["dodge"],
    describe: "Hold to rise: while input.hold is down the avatar accelerates upward; let go and gravity takes over. Smooth and dreamy.",
    examples: ["hold your breath to drift up, let go to sink"],
    params: {
      strength: { type: "number", default: 0.62, min: 0.2, max: 1.4, unit: "px/tick²", describe: "Upward acceleration while holding" },
      max_rise: { type: "number", default: 6, min: 2, max: 10, unit: "px/tick", describe: "Top rising speed" },
    },
    consumes: ["input.hold", "clock.tick"],
    emits: ["entity.puff"],
    requires: ["entity.avatar", "input.hold"],
    conflicts: ["behavior.impulse"],
    tags: { energy: ["low", "medium"], mood: ["dreamy", "chill"], skill: ["control"] },
    setup(sdk, p) {
      const phys = (sdk.state.physics = sdk.state.physics || { gravity: 0, max_fall: 9, impulse: 0, thrust: 0, max_rise: 7 });
      phys.thrust = p.strength;
      phys.max_rise = p.max_rise;
      sdk.on("input.hold", () => {
        const av = avatarOf(sdk);
        if (av && av.alive) { av.puffTick = sdk.tick; sdk.emit("entity.puff", { x: av.x, y: av.y }); }
      });
      sdk.on("clock.tick", () => {
        const av = avatarOf(sdk);
        const inp = sdk.state.input;
        if (!av || !av.alive || sdk.ended || !inp || !inp.holding) return;
        av.vy = Math.max(av.vy - p.strength, -p.max_rise);
      });
    },
  });

  B.defineConcept({
    id: "behavior.spawn_stream",
    kind: "behavior",
    formulas: ["dodge"],
    describe: "Sends a steady stream of obstacles: one every spacing pixels, each with a gap that drifts up or down. The gap narrows a little as the pace rises. The spawn glue can move or resize each gap.",
    examples: ["evenly spaced, gentle gaps", "gaps that swing in a wave (spawn glue)"],
    params: {
      spacing: { type: "number", default: 220, min: 150, max: 340, unit: "px", describe: "Distance between obstacles" },
      gap: { type: "number", default: 190, min: 120, max: 280, unit: "px", describe: "Gap height at the start (190 chill, 160 hard)" },
      gap_shrink: { type: "number", default: 14, min: 0, max: 60, unit: "px", describe: "How much the gap narrows by pace 1.5" },
      variance: { type: "number", default: 0.45, min: 0, max: 1, describe: "How far each gap can jump from the last (0.3 gentle, 0.7 wild)" },
      first: { type: "number", default: 330, min: 220, max: 600, unit: "px", describe: "Where the first obstacle starts" },
    },
    consumes: ["clock.tick"],
    emits: ["entity.spawn"],
    requires: ["entity.obstacle"],
    glue: ["spawn"],
    order: 45,
    state: "spawn: {index, last_gap_y}",
    tags: { energy: ["low", "medium", "high"] },
    setup(sdk, p) {
      const st = (sdk.state.spawn = { index: 0, last_gap_y: 300, last_x: 0 });
      const labels = Array.isArray(sdk.content.obstacle_labels) ? sdk.content.obstacle_labels.filter((s) => typeof s === "string" && s) : [];
      const bounds = () => sdk.state.bounds || { top: 14, floor: 612 };
      function spawnAt(x) {
        const b = bounds();
        const pace = sdk.state.pace || 1;
        let gap = Math.max(110, p.gap - p.gap_shrink * clamp((pace - 1) / 0.5, 0, 1.6));
        const lo = b.top + 54 + gap / 2, hi = b.floor - 40 - gap / 2;
        let gy;
        if (st.index === 0) gy = clamp(300 + sdk.range(-30, 30), lo, hi);
        else gy = clamp(st.last_gap_y + (sdk.rng() * 2 - 1) * p.variance * (hi - lo), lo, hi);
        let label = labels.length ? labels[st.index % labels.length] : "";
        if (labels.length > 1 && st.index >= labels.length) label = sdk.pick(labels);
        const glue = sdk.glue("spawn");
        if (glue) {
          const v = glue({ index: st.index, gap_y: gy, gap_h: gap, pace, x, label, min_y: lo, max_y: hi });
          if (v && typeof v === "object") {
            if (typeof v.gap_h === "number" && isFinite(v.gap_h)) gap = clamp(v.gap_h, 110, 320);
            const lo2 = b.top + 54 + gap / 2, hi2 = b.floor - 40 - gap / 2;
            if (typeof v.gap_y === "number" && isFinite(v.gap_y)) gy = v.gap_y;
            gy = clamp(gy, lo2, hi2);
            if (typeof v.label === "string") label = v.label.slice(0, 18);
          }
        }
        st.last_gap_y = gy;
        st.last_x = x;
        sdk.emit("entity.spawn", { x, gap_y: gy, gap_h: gap, label, index: st.index });
        st.index++;
      }
      // Pre-place the opening obstacles so the first frame (poster, intro) already shows the course.
      for (let x = p.first; x < W + 80; x += p.spacing) spawnAt(x);
      sdk.on("clock.tick", () => {
        const speed = sdk.state.scroll ? sdk.state.scroll.speed : 2.4;
        st.last_x -= speed;
        if (st.last_x <= W + 80 - p.spacing) spawnAt(st.last_x + p.spacing);
      });
    },
  });

  // Gusts swell and fade instead of switching on and off.
  function windEnvelope(st, tick) {
    const len = Math.max(1, st.until - st.start);
    return Math.sin(clamp((tick - st.start) / len, 0, 1) * Math.PI);
  }

  B.defineConcept({
    id: "behavior.wind",
    kind: "behavior",
    formulas: ["dodge"],
    describe: "Gusts of wind now and then push the avatar up or down for a moment. Streaks show which way it blows.",
    examples: ["mind the wind on Twin Peaks"],
    params: {
      strength: { type: "number", default: 0.1, min: 0.03, max: 0.3, unit: "px/tick²", describe: "Peak push of a gust (0.06 a breeze, 0.15 a shove)" },
      every: { type: "number", default: 5, min: 2, max: 12, unit: "s", describe: "Average seconds between gusts" },
      length: { type: "number", default: 1.2, min: 0.4, max: 3, unit: "s", describe: "How long a gust lasts" },
    },
    consumes: ["clock.tick"],
    emits: ["behavior.gust"],
    requires: ["entity.avatar"],
    state: "wind: {active, dir, strength, until}",
    tags: { energy: ["medium", "high"], skill: ["control"] },
    setup(sdk, p) {
      const st = (sdk.state.wind = { active: false, dir: 0, strength: p.strength, until: 0, next: Math.round(p.every * 60 * 0.8), start: 0 });
      const len = Math.round(p.length * 60);
      sdk.on("clock.tick", (e) => {
        const av = avatarOf(sdk);
        if (sdk.ended) { st.active = false; return; }
        if (!st.active && e.tick >= st.next) {
          st.active = true;
          st.dir = sdk.rng() < 0.5 ? -1 : 1;
          st.start = e.tick;
          st.until = e.tick + len;
          st.next = e.tick + len + Math.round(p.every * 60 * (0.7 + sdk.rng() * 0.6));
          sdk.emit("behavior.gust", { dir: st.dir });
          sdk.fx.sound("whoosh");
        }
        if (st.active) {
          if (e.tick >= st.until) { st.active = false; return; }
          if (av && av.alive) av.vy += st.dir * p.strength * windEnvelope(st, e.tick);
        }
      });
      const pal = sdk.palette;
      sdk.layer(sdk.Z.effects, (g) => {
        if (!st.active) return;
        const k = (sdk.tick - st.start) / Math.max(1, st.until - st.start);
        const a = Math.sin(k * Math.PI) * (pal.dark ? 0.5 : 0.7);
        for (let i = 0; i < 9; i++) {
          const x = ((i * 97 + g.t * 520) % 460) - 50;
          const y = 90 + i * 58 + st.dir * k * 30;
          g.line(W - x, y, W - x - 46, y + st.dir * 10, pal.glow, { width: 2.2, alpha: a * (0.5 + (i % 3) * 0.2) });
        }
      });
    },
  });

  // ------------------------------------------------------------------------------------------
  // Rule
  // ------------------------------------------------------------------------------------------

  B.defineConcept({
    id: "rule.collide_fail",
    kind: "rule",
    formulas: ["dodge"],
    describe: "Touching an obstacle or the ground pops the bubble and ends the run.",
    examples: ["one touch and it pops"],
    params: {
      shake: { type: "boolean", default: true, describe: "Shake the screen on the pop" },
    },
    consumes: ["entity.hit"],
    emits: ["rule.fail"],
    conflicts: ["rule.lives"],
    ends: true,
    tags: { competition: ["friendly", "competitive"] },
    setup(sdk, p) {
      sdk.on("entity.hit", (e) => {
        if (sdk.ended) return;
        sdk.emit("rule.fail", { reason: e.kind, x: e.x, y: e.y });
        if (p.shake) sdk.fx.shake(7);
        sdk.fx.flash(sdk.palette.glow);
        sdk.fx.sound("pop");
        sdk.fx.haptic("warning");
        sdk.end("fail", { x: e.x, y: e.y, reason: e.kind });
      });
    },
  });

  // ------------------------------------------------------------------------------------------
  // Bot: hovers near the next gap's center like a good player, with look-ahead safety checks.
  // Skill changes reaction lag, how well it reads gaps, and how often it hesitates.
  // ------------------------------------------------------------------------------------------

  // The gap the avatar should aim for k ticks from now: the first obstacle it hasn't cleared.
  function laneAt(sdk, mem, k) {
    const av = sdk.state.avatar, obs = sdk.state.obstacles || [];
    const b = sdk.state.bounds || { top: 14, floor: 760 };
    const speed = sdk.state.scroll ? sdk.state.scroll.speed : 2.4;
    let best = null, bestX = 1e9;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (!o.on) continue;
      const ox = o.x - speed * k;
      if (ox + o.w < av.x - av.r) continue;
      if (ox < bestX) { bestX = ox; best = o; }
    }
    const lane = mem.lane;
    if (!best) {
      lane.center = (b.top + b.floor) / 2;
      lane.h = 240;
      lane.dist = 999;
      return lane;
    }
    lane.center = best.gap_y + (mem.noise[best.index % 64] || 0);
    lane.h = best.gap_h;
    lane.dist = bestX - av.x;
    return lane;
  }

  function targetFor(lane, mem) {
    // Aim a little below center: a puff carries the bubble up past the tap point.
    return lane.center + Math.min(34, lane.h * 0.17) + mem.bias;
  }

  // Simulates the next T ticks with the same controller; returns {dead, at, worst}.
  function rollout(sdk, mem, first, T) {
    const av = sdk.state.avatar, phys = sdk.state.physics, b = sdk.state.bounds || { top: 14, floor: 760 };
    const obs = sdk.state.obstacles || [];
    const speed = sdk.state.scroll ? sdk.state.scroll.speed : 2.4;
    const wind = sdk.state.wind;
    const rules = sdk.state.obstacle_rules || { forgiveness: 4 };
    let y = av.y, vy = av.vy;
    let holding = mem.holdMode ? first === "hold" : false;
    let lastTap = first === "tap" ? 0 : mem.lastTap - sdk.tick;
    if (first === "tap") vy = -phys.impulse;
    let worst = 1e9;
    for (let k = 1; k <= T; k++) {
      if (k > 3) {
        const lane = laneAt(sdk, mem, k);
        const target = targetFor(lane, mem);
        if (mem.holdMode) holding = y + vy * 6 > target - 20;
        else if (k - lastTap >= mem.minGap && vy > -1.5 && y + vy * 4 > target) { vy = -phys.impulse; lastTap = k; }
      }
      if (mem.holdMode && holding) vy = Math.max(vy - phys.thrust, -phys.max_rise);
      vy = Math.min(vy + phys.gravity, phys.max_fall);
      if (wind && wind.active && sdk.tick + k < wind.until) vy += wind.dir * wind.strength * windEnvelope(wind, sdk.tick + k);
      y += vy;
      if (y < b.top + av.r) { y = b.top + av.r; if (vy < 0) vy = 0; }
      let clear = b.floor - (y + av.r);
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i];
        if (!o.on) continue;
        const ox = o.x - speed * k;
        if (av.x + av.r < ox - 2 || av.x - av.r > ox + o.w + 2) continue;
        const c = clearanceAt(ox, o.w, o.gap_y + (mem.noise[o.index % 64] || 0), o.gap_h, o.rc, av.x, y, av.r) + rules.forgiveness;
        if (c < clear) clear = c;
      }
      if (clear < worst) worst = clear;
      if (clear < mem.margin) return { dead: true, at: k, worst };
    }
    return { dead: false, at: T, worst };
  }

  function botPoint(sdk) {
    return [Math.round(150 + sdk.botRng() * 120), Math.round(300 + sdk.botRng() * 220)];
  }

  const dodgeBot = {
    decide(sdk) {
      const av = sdk.state.avatar, phys = sdk.state.physics;
      if (!av || !av.alive || !phys) return null;
      const mem = sdk.botState;
      const skill = sdk.botSkill;
      if (!mem.init) {
        mem.init = true;
        mem.holdMode = sdk.has("behavior.thrust");
        mem.holding = false;
        mem.lastTap = -99;
        mem.lastSwitch = -99;
        mem.minGap = 7;
        mem.lag = 1 + Math.round((1 - skill) * 4);
        mem.lead = 1 + Math.round(skill * 2);
        mem.margin = 1 + skill * 6;
        mem.bias = (sdk.botRng() * 2 - 1) * (1 - skill) * 10;
        mem.lane = { center: 300, h: 200, dist: 0 };
        mem.noise = [];
        for (let i = 0; i < 64; i++) mem.noise.push((sdk.botRng() * 2 - 1) * (1 - skill) * (1 - skill) * 60);
        mem.frozenUntil = 0;
      }
      if (sdk.tick % mem.lag !== 0) return null;
      // Everyone hesitates sometimes; less skilled players more often and for longer.
      if (sdk.tick < mem.frozenUntil) return null;
      if (sdk.botRng() < (1 - skill) * (1 - skill) * 0.05) {
        mem.frozenUntil = sdk.tick + 6 + Math.floor(sdk.botRng() * (10 + (1 - skill) * 30));
        return null;
      }
      const T = 40;
      const lane = laneAt(sdk, mem, mem.lead);
      const target = targetFor(lane, mem);
      const lead = mem.lead;
      const yPred = av.y + av.vy * lead + 0.5 * phys.gravity * lead * lead;

      if (mem.holdMode) {
        if (sdk.tick - mem.lastSwitch < 4) return null;
        let want = yPred > target - 20;
        const r = rollout(sdk, mem, want ? "hold" : "release", T);
        if (r.dead && r.at < 24) {
          const alt = rollout(sdk, mem, want ? "release" : "hold", T);
          if (!alt.dead || alt.at > r.at) want = !want;
        }
        if (want === mem.holding) return null;
        mem.holding = want;
        mem.lastSwitch = sdk.tick;
        return [{ a: want ? "tap" : "up", v: botPoint(sdk) }];
      }

      if (sdk.tick - mem.lastTap < mem.minGap) return null;
      let want = yPred > target && av.vy > -1.5;
      if (!want) {
        const wait = rollout(sdk, mem, "wait", T);
        if (wait.dead && wait.at < 22) {
          const t = rollout(sdk, mem, "tap", T);
          want = !t.dead || t.at > wait.at;
        }
      } else {
        const t = rollout(sdk, mem, "tap", T);
        if (t.dead && t.at < 30) {
          const wait = rollout(sdk, mem, "wait", T);
          if (!wait.dead || wait.at >= t.at) want = false;
        }
      }
      if (!want) return null;
      mem.lastTap = sdk.tick;
      return [{ a: "tap", v: botPoint(sdk) }];
    },
  };

  // ------------------------------------------------------------------------------------------
  // Formula
  // ------------------------------------------------------------------------------------------

  const EXAMPLE = {
    id: "example-hill-hopper",
    version: 1,
    engine_version: 1,
    title: "Hill Hopper",
    one_line_rule: "Tap to float over the hills. Don't touch the fog.",
    formula: "dodge",
    brief: { intent: "a chill game for my new running club about SF hills", audience: "everyone", mood: ["chill"], energy: "medium", competition: "friendly" },
    structure: { cadence: "endless", scope: "everyone", setter: "ai" },
    lineage: { parent: null, operators: [], remix_of: null },
    chain: null,
    style: { palette: "sky-glow", mood_preset: "chill", emoji: "⛰️" },
    concepts: [
      { use: "space.side_scroll", params: { speed: 2.3, backdrop: "hills" } },
      { use: "entity.avatar" },
      { use: "entity.obstacle", params: { style: "hill", width: 64 } },
      { use: "input.tap" },
      { use: "behavior.gravity", params: { strength: 0.32 } },
      { use: "behavior.impulse", params: { strength: 6.1 } },
      { use: "behavior.spawn_stream", params: { spacing: 230, gap: 196 } },
      { use: "behavior.speed_ramp", params: { rate: 0.05, max: 1.5 } },
      { use: "rule.collide_fail" },
      { use: "score.count", params: { on: "entity.passed", label: "hills" } },
      { use: "flow.run_retry" },
      { use: "feel.mood_preset" },
      { use: "feel.sfx_on_action" },
      { use: "share.score_card", params: { label: "hills" } },
    ],
    glue: {},
    content: { theme: "SF hills", obstacle_labels: ["Twin Peaks", "Bernal", "Nob Hill", "Russian Hill"] },
    seed: 1907,
  };

  B.defineFormula({
    id: "dodge",
    title: "Dodge",
    describe: "One-touch survival: float a glowing soap bubble through the gaps in soft obstacles (pillars, hills, fog banks, box stacks) labeled with your content. +1 for each one you clear; touching one pops you. Short, juicy runs with instant retry.",
    core: ["space.side_scroll", "entity.avatar", "entity.obstacle"],
    optional: ["input.tap", "input.hold", "behavior.gravity", "behavior.impulse", "behavior.thrust", "behavior.spawn_stream", "behavior.speed_ramp",
      "behavior.wind", "rule.collide_fail", "rule.lives", "score.count", "score.survival", "flow.run_retry", "flow.daily_gate",
      "feel.mood_preset", "feel.sfx_on_action", "social.beat_marker", "share.score_card", "share.emoji_grid", "rule.timer"],
    content: {
      describe: "Theme words for the obstacles (short place names or objects), plus an optional emoji to carry inside the bubble.",
      schema: {
        type: "object",
        properties: {
          theme: { type: "string", maxLength: 80 },
          obstacle_labels: { type: "array", items: { type: "string", minLength: 1, maxLength: 18 }, maxItems: 16 },
          avatar_emoji: { type: "string", maxLength: 8 },
        },
      },
    },
    validateContent(content) {
      const out = [];
      const labels = content.obstacle_labels;
      if (labels === undefined || (Array.isArray(labels) && !labels.length)) {
        out.push({ code: "content", message: "Add a few obstacle_labels (short words from the theme) so obstacles feel personal", path: "content.obstacle_labels", warning: true });
      }
      return out;
    },
    bot: dodgeBot,
    share(sdk) {
      const label = sdk.hud.label || "points";
      return { score_text: sdk.score + " " + label };
    },
    tips: [
      "Chill: speed 2.2, gap 190+, gravity 0.3, ramp rate 0.04. Hard: speed 2.8, gap 160, ramp 0.1, add behavior.wind.",
      "Use input.tap + behavior.impulse for puffs, or input.hold + behavior.thrust for a smooth, dreamy float.",
      "score.count on entity.passed scores 1 per obstacle; a score glue can add a near-miss bonus (run.near).",
      "The spawn glue gets {index, gap_y, gap_h, pace, min_y, max_y, label} and may return {gap_y, gap_h, label}.",
    ],
    example: EXAMPLE,
  });
})();
