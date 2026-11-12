/*
 * bubble-kit-common.js: concepts any formula can use (docs/BUBBLES.md 4.6).
 *
 * Kits only call Bubble.defineFormula and Bubble.defineConcept. Reuse these instead of redefining
 * them in a formula kit (a second definition of the same id is ignored with a load warning).
 *
 * Shared state conventions (each concept writes under its own key; bots and other concepts read):
 *   state.pace          1 at the start; behavior.speed_ramp raises it. Kits multiply movement by it.
 *   state.choices       [{x, y, r} or {x, y, w, h}, value?, disabled?]: what input.select hit-tests.
 *                       Set state.choices_locked = true to ignore picks (e.g. during a reveal).
 *   state.keyboard      input.type: {value, max, locked, marks: {A: "hit"|"near"|"miss"}, keys: [{key, x, y, w, h, cx, cy}]}.
 *                       Rules set max, locked and marks; bots tap keys at (cx, cy).
 *   state.rounds        flow.rounds: {index, total, won, results: ["hit"|"miss"], active}.
 *   state.rounds_available  A rule that runs out of content after n rounds sets this; flow.rounds plays min(count, n).
 *   state.share_rows    [["hit"|"near"|"miss"|"skip", ...], ...]: rows that share.emoji_grid turns into emoji.
 *   state.reveal_until  Tick when the current reveal animation finishes; enders wait for it.
 *   state.attempts      rule.attempt_budget: {used, budget, left}.
 *   state.lives         rule.lives: {left, max, grace_until}.
 *   state.timer         rule.timer: {total, left} in ticks.
 *   state.daily         flow.daily_gate: {day: "2026-11-12", pretty: "Nov 12", label}.
 *
 * Common events: input.action {x, y}, input.hold {x, y}, input.release {x, y, ticks}, input.aim {x, y, dx, dy},
 * input.launch {x, y, dx, dy}, input.select {index, value, x, y}, input.key {key}, input.submit {value},
 * guess.made {correct} (any committed answer), round.start {index, total}, round.done {correct}
 * (a rule finished a round), round.end {index, correct}, rule.fail, rule.success, timer.warning,
 * lives.lost {left}, behavior.ramp {pace}, social.new_best {score, best}.
 */
(function () {
  "use strict";
  const B = typeof Bubble !== "undefined" ? Bubble : null;
  if (!B) return;
  const clamp = B.util.clamp;
  const SOUND_CHOICES = ["none", "pop", "blip", "tick", "chime", "whoosh", "success", "fail"];
  const ALL_ENERGY = ["low", "medium", "high"];

  function inZone(zone, x, y) {
    switch (zone) {
      case "upper": return y < B.H / 2;
      case "lower": return y >= B.H / 2;
      case "left": return x < B.W / 2;
      case "right": return x >= B.W / 2;
      default: return true;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Input
  // ------------------------------------------------------------------------------------------

  B.defineConcept({
    id: "input.tap",
    kind: "input",
    formulas: ["*"],
    describe: "Tap anywhere to act. Each tap emits input.action {x, y} at the tap point. The most readable control: one-touch games.",
    examples: ["tap to puff the bubble upward", "tap to drop the next block", "tap when the ring lines up"],
    params: {
      cooldown: { type: "integer", default: 0, min: 0, max: 30, unit: "ticks", describe: "Minimum ticks between actions (0: every tap counts)" },
      zone: { type: "enum", values: ["anywhere", "upper", "lower", "left", "right"], default: "anywhere", describe: "Where on screen taps count" },
    },
    consumes: ["pointer.down"],
    emits: ["input.action"],
    tags: { energy: ALL_ENERGY, skill: ["timing"] },
    setup(sdk, p) {
      let last = -1e9;
      sdk.on("pointer.down", (e) => {
        if (sdk.ended || sdk.tick - last < p.cooldown || !inZone(p.zone, e.x, e.y)) return;
        last = sdk.tick;
        sdk.emit("input.action", { x: e.x, y: e.y });
      });
    },
  });

  B.defineConcept({
    id: "input.hold",
    kind: "input",
    formulas: ["*"],
    describe: "Press and hold. Emits input.hold when a finger goes down and input.release {ticks} when it lifts; state.input.holding is true in between. Good for hold-to-rise or charge-up games.",
    examples: ["hold to float up, let go to sink", "hold to charge a jump"],
    params: {
      max_hold: { type: "integer", default: 0, min: 0, max: 600, unit: "ticks", describe: "Auto-release after this many ticks (0: no limit)" },
    },
    consumes: ["pointer.down", "pointer.up"],
    emits: ["input.hold", "input.release"],
    state: "input: {holding, since}",
    tags: { energy: ["low", "medium"], skill: ["control"] },
    setup(sdk, p) {
      const st = (sdk.state.input = { holding: false, since: 0, x: 0, y: 0 });
      function release(x, y) {
        if (!st.holding) return;
        st.holding = false;
        sdk.emit("input.release", { x, y, ticks: sdk.tick - st.since });
      }
      sdk.on("pointer.down", (e) => {
        if (sdk.ended || st.holding) return;
        st.holding = true;
        st.since = sdk.tick;
        st.x = e.x;
        st.y = e.y;
        sdk.emit("input.hold", { x: e.x, y: e.y });
      });
      sdk.on("pointer.up", (e) => release(e.x, e.y));
      if (p.max_hold > 0) {
        sdk.on("clock.tick", () => {
          if (st.holding && sdk.tick - st.since >= p.max_hold) release(st.x, st.y);
        });
      }
    },
  });

  B.defineConcept({
    id: "input.drag",
    kind: "input",
    formulas: ["*"],
    describe: "Drag to aim, let go to launch. Emits input.aim {x, y, dx, dy} while dragging and input.launch {x, y, dx, dy} on release. In slingshot mode you pull back and it launches the other way.",
    examples: ["drag to aim the drop, release to let go", "pull back and release to fling"],
    params: {
      max_pull: { type: "number", default: 150, min: 40, max: 260, unit: "px", describe: "Longest drag that still adds power" },
      mode: { type: "enum", values: ["aim", "slingshot"], default: "aim", describe: "aim: launch where you drag. slingshot: pull back to launch forward" },
      show_line: { type: "boolean", default: true, describe: "Draw a dotted aim line while dragging" },
    },
    consumes: ["pointer.down", "pointer.move", "pointer.up"],
    emits: ["input.aim", "input.launch"],
    state: "drag: {active, x0, y0, x, y, dx, dy}",
    tags: { energy: ["low", "medium"], skill: ["aim"] },
    setup(sdk, p) {
      const st = (sdk.state.drag = { active: false, x0: 0, y0: 0, x: 0, y: 0, dx: 0, dy: 0 });
      function vec(x, y) {
        let dx = x - st.x0, dy = y - st.y0;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > p.max_pull) { dx = (dx / len) * p.max_pull; dy = (dy / len) * p.max_pull; }
        if (p.mode === "slingshot") { dx = -dx; dy = -dy; }
        st.dx = Math.round(dx * 10) / 10;
        st.dy = Math.round(dy * 10) / 10;
      }
      sdk.on("pointer.down", (e) => {
        if (sdk.ended) return;
        st.active = true;
        st.x0 = st.x = e.x;
        st.y0 = st.y = e.y;
        st.dx = st.dy = 0;
        sdk.emit("input.aim", { x: e.x, y: e.y, dx: 0, dy: 0 });
      });
      sdk.on("pointer.move", (e) => {
        if (!st.active || sdk.ended) return;
        st.x = e.x;
        st.y = e.y;
        vec(e.x, e.y);
        sdk.emit("input.aim", { x: e.x, y: e.y, dx: st.dx, dy: st.dy });
      });
      sdk.on("pointer.up", (e) => {
        if (!st.active) return;
        st.active = false;
        if (sdk.ended) return;
        st.x = e.x;
        st.y = e.y;
        vec(e.x, e.y);
        sdk.emit("input.launch", { x: e.x, y: e.y, dx: st.dx, dy: st.dy });
      });
      if (p.show_line) {
        sdk.layer(sdk.Z.hud, (g) => {
          if (!st.active) return;
          const n = 9;
          for (let i = 1; i <= n; i++) {
            const t = i / n;
            g.circle(st.x0 + st.dx * t, st.y0 + st.dy * t, 2.6 + t * 1.6, g.palette.glow, 0.85 - t * 0.4);
          }
          g.ring(st.x0, st.y0, 14, g.palette.glow, { width: 2.5, alpha: 0.8 });
        });
      }
    },
  });

  B.defineConcept({
    id: "input.select",
    kind: "input",
    formulas: ["*"],
    describe: "Tap one of the choices on screen. Emits input.select {index, value, x, y}. The space or rule concept lists the choices in state.choices as {x, y, r} circles or {x, y, w, h} boxes (x, y = center).",
    examples: ["tap the face that matches the fact", "pick one of four answers"],
    params: {
      slop: { type: "number", default: 8, min: 0, max: 24, unit: "px", describe: "Extra touch margin around each choice" },
    },
    consumes: ["pointer.down"],
    emits: ["input.select"],
    tags: { energy: ["low", "medium"], skill: ["knowledge"] },
    setup(sdk, p) {
      sdk.on("pointer.down", (e) => {
        const list = sdk.state.choices;
        if (sdk.ended || !list || sdk.state.choices_locked) return;
        let best = -1, bestD = Infinity;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (!c || c.disabled) continue;
          let d;
          if (typeof c.r === "number") {
            const dx = e.x - c.x, dy = e.y - c.y;
            d = Math.sqrt(dx * dx + dy * dy) - c.r;
          } else {
            const dx = Math.abs(e.x - c.x) - (c.w || 0) / 2, dy = Math.abs(e.y - c.y) - (c.h || 0) / 2;
            d = Math.max(dx, dy);
          }
          if (d <= p.slop && d < bestD) { bestD = d; best = i; }
        }
        if (best < 0) return;
        const c = list[best];
        sdk.emit("input.select", { index: best, value: c.value === undefined ? best : c.value, x: c.x, y: c.y });
      });
    },
  });

  const KEY_ROWS = {
    qwerty: ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"],
    abc: ["ABCDEFGHIJ", "KLMNOPQRS", "TUVWXYZ"],
  };

  B.defineConcept({
    id: "input.type",
    kind: "input",
    formulas: ["*"],
    describe: "An on-screen bubble keyboard drawn in the game. Letter keys emit input.key {key}; the round Pop key emits input.submit {value} with the typed word. Rules mark letters (state.keyboard.marks) so keys glow by what you've learned.",
    examples: ["type today's word", "type the neighborhood's name"],
    params: {
      layout: { type: "enum", values: ["qwerty", "abc"], default: "qwerty", describe: "Key order" },
      enter_label: { type: "string", default: "Pop", max_length: 8, describe: "Label on the submit key" },
      max_length: { type: "integer", default: 12, min: 1, max: 12, describe: "Longest entry (rules may lower it to the word length)" },
      top: { type: "number", default: 480, min: 380, max: 520, unit: "px", describe: "Top of the keyboard in the 360x640 playfield" },
      show_value: { type: "boolean", default: false, describe: "Draw the typed text above the keyboard (off when the space shows it)" },
    },
    consumes: ["pointer.down"],
    emits: ["input.key", "input.submit"],
    // Optional listens: clear after an accepted guess or a new round, shake on an invalid one.
    state: "keyboard: {value, max, locked, marks, keys: [{key, x, y, w, h, cx, cy}]}",
    tags: { energy: ["low"], skill: ["words"] },
    setup(sdk, p) {
      const rows = KEY_ROWS[p.layout] || KEY_ROWS.qwerty;
      const keys = [];
      const gap = 4, side = 6, kh = 46, rowGap = 7;
      const kw = (B.W - side * 2 - gap * 9) / 10;
      for (let r = 0; r < rows.length; r++) {
        const letters = rows[r];
        const y = p.top + r * (kh + rowGap);
        if (r < 2) {
          const total = letters.length * kw + (letters.length - 1) * gap;
          let x = (B.W - total) / 2;
          for (const ch of letters) { keys.push({ key: ch, label: ch, x, y, w: kw, h: kh }); x += kw + gap; }
        } else {
          const lettersW = letters.length * kw + (letters.length - 1) * gap;
          const special = (B.W - side * 2 - lettersW - gap * 2) / 2;
          keys.push({ key: "BACK", label: "⌫", x: side, y, w: special, h: kh });
          let x = side + special + gap;
          for (const ch of letters) { keys.push({ key: ch, label: ch, x, y, w: kw, h: kh }); x += kw + gap; }
          keys.push({ key: "ENTER", label: p.enter_label || "Pop", x, y, w: special, h: kh });
        }
      }
      for (const k of keys) { k.cx = k.x + k.w / 2; k.cy = k.y + k.h / 2; }
      const kb = (sdk.state.keyboard = { value: "", max: p.max_length, locked: false, marks: {}, keys, top: p.top, pressed: "", pressedTick: -100, shakeTick: -100 });

      sdk.on("pointer.down", (e) => {
        if (sdk.ended || kb.locked) return;
        let hit = null;
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          if (e.x >= k.x - gap / 2 && e.x <= k.x + k.w + gap / 2 && e.y >= k.y - rowGap / 2 && e.y <= k.y + k.h + rowGap / 2) { hit = k; break; }
        }
        if (!hit) return;
        kb.pressed = hit.key;
        kb.pressedTick = sdk.tick;
        const max = Math.min(kb.max || p.max_length, p.max_length);
        if (hit.key === "BACK") {
          if (kb.value.length) { kb.value = kb.value.slice(0, -1); sdk.emit("input.key", { key: "BACK" }); }
        } else if (hit.key === "ENTER") {
          if (kb.value.length) sdk.emit("input.submit", { value: kb.value });
          else kb.shakeTick = sdk.tick;
        } else if (kb.value.length < max) {
          kb.value += hit.key;
          sdk.emit("input.key", { key: hit.key });
          // Poster moment: the first guess half typed (before the next key lands).
          if (kb.value.length === 3 && sdk.state.poster_tick === undefined) sdk.state.poster_tick = sdk.tick + 5;
        } else {
          kb.shakeTick = sdk.tick;
        }
      });
      sdk.on("guess.made", () => { kb.value = ""; });
      sdk.on("round.start", () => { kb.value = ""; });
      sdk.on("guess.invalid", () => { kb.shakeTick = sdk.tick; });

      // Colors come from palette roles (fixed per Bubble, so worked out once); the look draws them.
      const pal = sdk.palette;
      const markFill = { hit: pal.good, near: pal.near, miss: null };
      const keyFill = pal.surface, keyIdle = pal.surfaceStrong, enterFill = pal.primary;
      const keyStroke = pal.look === "glow" ? pal.line : undefined;
      sdk.layer(sdk.Z.hud, (g) => {
        const since = sdk.tick - kb.pressedTick;
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const mark = kb.marks[k.key];
          const isEnter = k.key === "ENTER";
          const pressed = kb.pressed === k.key && since < 7;
          const s = pressed ? 0.92 : 1;
          const w = k.w * s, h = k.h * s, x = k.x + (k.w - w) / 2, y = k.y + (k.h - h) / 2;
          let fill = keyFill;
          let glow = 0;
          let alpha = kb.locked ? 0.75 : 1;
          if (isEnter) {
            fill = kb.value.length ? enterFill : keyIdle;
            glow = kb.value.length ? 0.9 : 0;
          } else if (mark === "hit" || mark === "near") {
            fill = markFill[mark];
            glow = 0.8;
          } else if (mark === "miss") {
            alpha *= 0.38;
          }
          const ink = pal.inkOn(fill);
          g.pill(x, y, w, h, { fill, radius: Math.min(14, h / 2), glow, glowColor: isEnter ? enterFill : fill, alpha, stroke: keyStroke, strokeWidth: 1 });
          g.text(k.label, x + w / 2, y + h / 2 + 1, { size: isEnter ? 17 : k.key === "BACK" ? 19 : 19, weight: 800, color: ink, alpha, maxWidth: w - 6 });
        }
        if (p.show_value) {
          const shake = sdk.tick - kb.shakeTick < 18 ? Math.sin((sdk.tick - kb.shakeTick) * 1.4) * 5 : 0;
          g.pill(40 + shake, p.top - 62, B.W - 80, 46, { fill: keyIdle, radius: 23, glow: 0.6, glowColor: pal.glow });
          g.text(kb.value || " ", B.W / 2 + shake, p.top - 38, { size: 24, weight: 800, color: pal.ink });
        }
      });
    },
  });

  // ------------------------------------------------------------------------------------------
  // Flow
  // ------------------------------------------------------------------------------------------

  B.defineConcept({
    id: "flow.run_retry",
    kind: "flow",
    formulas: ["*"],
    describe: "Endless runs with instant retry: a run lasts until you fail, then one tap starts the next. Best for score-chasing games played again and again.",
    examples: ["survive as long as you can, tap to try again"],
    params: {
      label: { type: "string", default: "Tap to play again", max_length: 28, describe: "What the end card says under the score" },
    },
    tags: { cadence: ["endless"], competition: ["light", "friendly", "competitive"] },
    setup(sdk, p) {
      sdk.hud.retry = true;
      sdk.hud.note = p.label;
    },
  });

  B.defineConcept({
    id: "flow.rounds",
    kind: "flow",
    formulas: ["*"],
    describe: "The run is a few short rounds. Emits round.start {index, total}; a rule emits round.done {correct} to finish each round; after a short pause the next round starts. After the last round the run ends: success if you won at least pass_ratio of the rounds.",
    examples: ["five quick questions", "six faces to name before the picnic"],
    params: {
      count: { type: "integer", default: 5, min: 1, max: 20, describe: "How many rounds" },
      pause: { type: "integer", default: 54, min: 10, max: 150, unit: "ticks", describe: "Pause after each round so the answer can sink in" },
      pass_ratio: { type: "number", default: 0.5, min: 0, max: 1, describe: "Share of rounds you must win for a success" },
      lead_in: { type: "integer", default: 12, min: 0, max: 90, unit: "ticks", describe: "Ticks before the first round" },
      show: { type: "boolean", default: true, describe: "Draw round progress dots at the top" },
    },
    consumes: ["round.done"],
    emits: ["round.start", "round.end", "rule.success", "rule.fail"],
    ends: true,
    state: "rounds: {index, total, won, results, active}",
    tags: { cadence: ["once", "daily"], energy: ["low", "medium"] },
    setup(sdk, p) {
      const st = (sdk.state.rounds = { index: -1, total: p.count, won: 0, results: [], active: false, next: p.lead_in, startTick: 0 });
      if (typeof sdk.state.rounds_available === "number") st.total = clamp(Math.min(p.count, sdk.state.rounds_available), 1, p.count);
      sdk.state.share_rows = [st.results];
      sdk.on("clock.tick", () => {
        if (st.active || sdk.ended || sdk.tick < st.next) return;
        if (st.index + 1 < st.total) {
          st.index++;
          st.active = true;
          st.startTick = sdk.tick;
          sdk.emit("round.start", { index: st.index, total: st.total });
        } else {
          const ok = st.won >= Math.ceil(st.total * p.pass_ratio - 1e-9);
          sdk.emit(ok ? "rule.success" : "rule.fail", { won: st.won, total: st.total });
          sdk.end(ok ? "success" : "fail");
        }
      });
      sdk.on("round.done", (e) => {
        if (!st.active) return;
        st.active = false;
        const correct = !!(e && e.correct);
        if (correct) st.won++;
        st.results.push(correct ? "hit" : "miss");
        sdk.emit("round.end", { index: st.index, correct });
        st.next = sdk.tick + p.pause;
      });
      if (p.show) {
        const pal = sdk.palette;
        const missDot = B.color.mix(pal.ink, pal.mid, 0.6);
        sdk.layer(sdk.Z.hud, (g) => {
          const n = st.total, gap = 22, x0 = B.W / 2 - ((n - 1) * gap) / 2, y = 26;
          for (let i = 0; i < n; i++) {
            const x = x0 + i * gap;
            const r = st.results[i];
            if (r === "hit") g.orb(x, y, 7, pal.good, { glow: 0.9 });
            else if (r === "miss") g.orb(x, y, 6, missDot, { glow: 0.2, alpha: 0.85 });
            else if (i === st.index) {
              const pulse = 1 + Math.sin(g.t * 6) * 0.12;
              g.bubble(x, y, 8 * pulse, { glow: 0.8 });
            } else g.ring(x, y, 5.5, pal.ink, { width: 1.5, alpha: pal.dark ? 0.6 : 0.35 });
          }
        });
      }
    },
  });

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dayFrom(manifest, param) {
    let y, mo, d;
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(param || "");
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    if (!y) {
      const s = String(manifest.seed || "");
      if (/^20\d{6}$/.test(s)) { y = +s.slice(0, 4); mo = +s.slice(4, 6); d = +s.slice(6, 8); }
    }
    if (!y) {
      m = /(\d{4})-(\d{2})-(\d{2})/.exec(manifest.id || "");
      if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    }
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return { day: "", pretty: "Today" };
    const pad = (n) => (n < 10 ? "0" : "") + n;
    return { day: y + "-" + pad(mo) + "-" + pad(d), pretty: MONTHS[mo - 1] + " " + d };
  }

  B.defineConcept({
    id: "flow.daily_gate",
    kind: "flow",
    formulas: ["*"],
    describe: "A Daily Bubble: one run a day, the same seed and content for everyone in the Group today. No instant retry; the share text names the day (the app keeps one score per person per day). The day comes from the day param, a YYYYMMDD seed, or a date in the id.",
    examples: ["today's word for New in SF", "a daily puzzle for the running club"],
    params: {
      label: { type: "string", default: "Daily Bubble", max_length: 24, describe: "Chip text at the top" },
      day: { type: "string", default: "", max_length: 10, describe: "YYYY-MM-DD; empty: read it from the seed or id" },
      note: { type: "string", default: "A new one tomorrow", max_length: 32, describe: "What the end card says" },
    },
    state: "daily: {day, pretty, label}",
    tags: { cadence: ["daily"], competition: ["light", "friendly"] },
    setup(sdk, p) {
      const d = dayFrom(sdk.manifest, p.day);
      const st = (sdk.state.daily = { day: d.day, pretty: d.pretty, label: p.label });
      sdk.hud.retry = false;
      sdk.hud.note = p.note;
      const chip = p.label + " · " + st.pretty;
      sdk.on("flow.phase", (e) => {
        if (e.name !== "fail" && e.name !== "success") return;
        const emoji = sdk.manifest.style && sdk.manifest.style.emoji ? sdk.manifest.style.emoji + " " : "";
        sdk.share({ headline: emoji + sdk.manifest.title + " · " + st.pretty });
      });
      const pal = sdk.palette;
      sdk.layer(sdk.Z.hud, (g) => {
        const w = Math.min(220, 26 + chip.length * 7.4);
        g.pill(B.W / 2 - w / 2, 10, w, 28, { fill: pal.surface, radius: 14, glow: 0.5, glowColor: pal.glow });
        g.text(chip, B.W / 2, 24.5, { size: 13, weight: 800, color: pal.ink, maxWidth: w - 16 });
      });
    },
  });

  // ------------------------------------------------------------------------------------------
  // Share
  // ------------------------------------------------------------------------------------------

  const EMOJI_SETS = {
    bubbles: { hit: "🫧", near: "✨", miss: "⚪", skip: "▫️" },
    weather: { hit: "☀️", near: "⛅", miss: "🌫️", skip: "▫️" },
    smiles: { hit: "😊", near: "🙂", miss: "🤔", skip: "▫️" },
    hearts: { hit: "💜", near: "🩷", miss: "🤍", skip: "▫️" },
  };

  B.defineConcept({
    id: "share.emoji_grid",
    kind: "share",
    formulas: ["*"],
    describe: "Shares the run as rows of emoji (one row per guess or one per round) without giving the answer away. Reads state.share_rows. Sets: bubbles 🫧✨⚪, weather ☀️⛅🌫️, smiles 😊🙂🤔, hearts 💜🩷🤍.",
    examples: ["☀️⛅🌫️☀️☀️ rows for a word guess", "😊😊🤔😊 for an icebreaker"],
    params: {
      set: { type: "enum", values: Object.keys(EMOJI_SETS), default: "bubbles", describe: "Emoji set" },
    },
    emits: [],
    tags: { competition: ["light", "friendly"] },
    setup(sdk, p) {
      const set = EMOJI_SETS[p.set] || EMOJI_SETS.bubbles;
      sdk.on("flow.phase", (e) => {
        if (e.name !== "fail" && e.name !== "success") return;
        const rows = sdk.state.share_rows || [];
        const lines = [];
        for (const row of rows) {
          if (!row || !row.length) continue;
          lines.push(row.map((m) => set[m] || set.skip).join(""));
        }
        if (!lines.length) {
          const n = clamp(Math.round(Math.log2(1 + sdk.score)), 1, 8);
          lines.push(new Array(n + 1).join(set.hit));
        }
        sdk.share({ emoji_grid: lines.join("\n") });
      });
    },
  });

  B.defineConcept({
    id: "share.score_card",
    kind: "share",
    formulas: ["*"],
    describe: "Shares the score with a label (\"14 hills\") and an optional brag line. Best for score-chasing games.",
    examples: ["\"14 hills · beat that\"", "\"230 points\""],
    params: {
      label: { type: "string", default: "", max_length: 24, describe: "Unit after the score (empty: the score HUD label, or \"points\")" },
      brag: { type: "string", default: "", max_length: 48, describe: "Short line after the score" },
    },
    tags: { competition: ["friendly", "competitive"] },
    setup(sdk, p) {
      sdk.on("flow.phase", (e) => {
        if (e.name !== "fail" && e.name !== "success") return;
        const label = p.label || sdk.hud.label || "points";
        const unit = sdk.score === 1 && /s$/.test(label) ? label.slice(0, -1) : label;
        sdk.share({ score_text: sdk.score + " " + unit + (p.brag ? " · " + p.brag : "") });
      });
    },
  });

  // ------------------------------------------------------------------------------------------
  // Feel
  // ------------------------------------------------------------------------------------------

  const MOODS = {
    chill: { ambient: 1.0, particles: 0.8, shake: 0.5, sound: "soft", tempo: 0.9 },
    cozy: { ambient: 1.1, particles: 0.8, shake: 0.4, sound: "soft", tempo: 0.85 },
    playful: { ambient: 1.2, particles: 1.1, shake: 0.8, sound: "bright", tempo: 1 },
    focused: { ambient: 0.6, particles: 0.8, shake: 0.7, sound: "soft", tempo: 1 },
    dreamy: { ambient: 1.5, particles: 0.9, shake: 0.3, sound: "dreamy", tempo: 0.8 },
    funny: { ambient: 1.2, particles: 1.3, shake: 1.0, sound: "bright", tempo: 1.1 },
    warm: { ambient: 1.1, particles: 1.0, shake: 0.5, sound: "soft", tempo: 0.95 },
    hype: { ambient: 1.4, particles: 1.5, shake: 1.2, sound: "bright", tempo: 1.2 },
  };

  B.defineConcept({
    id: "feel.mood_preset",
    kind: "feel",
    formulas: ["*"],
    describe: "Sets the feel from a mood: how many ambient bubbles drift by, how big the pops and shakes are, and the sound palette. Cosmetic only; never changes the game. auto reads style.mood_preset or the brief's first mood.",
    examples: ["chill: slow drifting bubbles, soft pops", "hype: lots of sparkle, punchy sounds"],
    params: {
      preset: { type: "enum", values: ["auto"].concat(Object.keys(MOODS)), default: "auto", describe: "Mood" },
    },
    tags: { mood: Object.keys(MOODS) },
    setup(sdk, p) {
      let id = p.preset;
      if (id === "auto") {
        const m = sdk.manifest;
        const fromStyle = m.style && m.style.mood_preset;
        const fromBrief = m.brief && Array.isArray(m.brief.mood) ? m.brief.mood[0] : null;
        id = MOODS[fromStyle] ? fromStyle : MOODS[fromBrief] ? fromBrief : "playful";
      }
      Object.assign(sdk.feel, MOODS[id] || MOODS.playful, { mood: id });
    },
  });

  B.defineConcept({
    id: "feel.sfx_on_action",
    kind: "feel",
    formulas: ["*"],
    describe: "Plays soft synthesized sounds and light haptics on common moments: each action, each point, near misses. Cosmetic only.",
    examples: ["a blip on every tap and a tick on every point"],
    params: {
      action: { type: "enum", values: SOUND_CHOICES, default: "blip", describe: "Sound for taps, picks and launches" },
      score: { type: "enum", values: SOUND_CHOICES, default: "tick", describe: "Sound for each point" },
      near: { type: "enum", values: SOUND_CHOICES, default: "chime", describe: "Sound for near misses" },
      haptics: { type: "boolean", default: true, describe: "Light haptics with the sounds" },
    },
    consumes: ["input.action?", "input.select?", "input.launch?", "input.key?", "score.changed?", "entity.near_miss?"],
    tags: { mood: ["any"] },
    setup(sdk, p) {
      function act() {
        if (p.action !== "none") sdk.fx.sound(p.action);
        if (p.haptics) sdk.fx.haptic("light");
      }
      sdk.on("input.action", act);
      sdk.on("input.select", act);
      sdk.on("input.launch", act);
      sdk.on("input.key", () => { if (p.action !== "none") sdk.fx.sound("tick"); });
      sdk.on("score.changed", (e) => {
        if (e.delta <= 0) return;
        if (p.score !== "none") sdk.fx.sound(p.score);
        if (p.haptics) sdk.fx.haptic("selection");
      });
      sdk.on("entity.near_miss", () => {
        if (p.near !== "none") sdk.fx.sound(p.near);
        if (p.haptics) sdk.fx.haptic("light");
      });
    },
  });

  // ------------------------------------------------------------------------------------------
  // Content
  // ------------------------------------------------------------------------------------------

  B.defineConcept({
    id: "content.seed",
    kind: "content",
    formulas: ["*"],
    describe: "Picks this run's content from a list with the manifest seed, so everyone with the same seed (a Group today) gets the same pick. Writes content[into] = one item (or count items) from content[list]. Runs before every other concept.",
    examples: ["pick today's word from a list of SF words", "pick five facts from the attendee list"],
    params: {
      list: { type: "string", default: "words", max_length: 24, describe: "Content key that holds the list" },
      into: { type: "string", default: "target", max_length: 24, describe: "Content key to write the pick to" },
      count: { type: "integer", default: 1, min: 1, max: 20, describe: "1: one item. More: a list of distinct items" },
      salt: { type: "integer", default: 0, min: 0, max: 99999, describe: "Change to get a different pick from the same seed" },
    },
    tags: { cadence: ["daily", "once", "endless"] },
    check(manifest, p) {
      const list = manifest.content && manifest.content[p.list];
      if (!Array.isArray(list) || !list.length) return [{ code: "content", message: "content.seed needs a non-empty list at content." + p.list, path: "content." + p.list }];
      return [];
    },
    setup(sdk, p) {
      const list = sdk.content[p.list];
      if (!Array.isArray(list) || !list.length) return;
      const seed = (B.util.hashString(String(sdk.manifest.seed) + ":" + p.salt + ":" + p.list) >>> 0);
      if (p.count === 1) {
        sdk.content[p.into] = list[seed % list.length];
      } else {
        const rng = B.util.makeRng(seed);
        sdk.content[p.into] = B.util.rngShuffle(rng, list).slice(0, p.count);
      }
    },
  });

  // ------------------------------------------------------------------------------------------
  // Score
  // ------------------------------------------------------------------------------------------

  B.defineConcept({
    id: "score.count",
    kind: "score",
    formulas: ["*"],
    describe: "Adds points each time an event happens (an obstacle passed, a round won, a block stacked). The score glue can change the points per event, e.g. a streak or speed bonus.",
    examples: ["+1 for every hill you float over", "+100 for each right answer, more if you're quick (glue)"],
    params: {
      on: { type: "string", default: "entity.passed", max_length: 40, event: true, describe: "Event that scores (another concept must emit it)" },
      points: { type: "integer", default: 1, min: 1, max: 1000, describe: "Points per event before glue" },
      label: { type: "string", default: "", max_length: 20, describe: "Unit shown under the score and in the share (\"hills\")" },
      float: { type: "boolean", default: true, describe: "Float \"+n\" where it happened" },
    },
    consumes: ["entity.hit?", "round.end?"],
    glue: ["score"],
    tags: { competition: ["light", "friendly", "competitive"] },
    setup(sdk, p) {
      if (p.label) sdk.hud.label = p.label;
      let count = 0, streak = 0;
      sdk.on("entity.hit", () => { streak = 0; });
      sdk.on("round.end", (e) => { if (e && !e.correct) streak = 0; });
      sdk.on(p.on, (e) => {
        count++;
        streak++;
        let pts = p.points;
        const glue = sdk.glue("score");
        if (glue) {
          const run = { base: p.points, count, streak, time: sdk.time, tick: sdk.tick, score: sdk.score };
          if (e) {
            for (const k of Object.keys(e)) {
              const v = e[k];
              if (run[k] === undefined && (typeof v === "number" || typeof v === "boolean" || typeof v === "string")) run[k] = v;
            }
          }
          const v = glue(run);
          if (typeof v === "number" && isFinite(v)) pts = clamp(Math.round(v), -1000, 10000);
        }
        if (pts) sdk.addScore(pts, p.float && e && typeof e.x === "number" ? { x: e.x, y: e.y } : null);
      });
    },
  });

  B.defineConcept({
    id: "score.survival",
    kind: "score",
    formulas: ["*"],
    describe: "Points for every second you last. Pairs with a rule that ends the run (lives, collisions).",
    examples: ["10 points a second while you keep floating"],
    params: {
      per_second: { type: "integer", default: 10, min: 1, max: 100, describe: "Points per second" },
      label: { type: "string", default: "points", max_length: 20, describe: "Unit shown under the score" },
    },
    consumes: ["clock.tick"],
    tags: { competition: ["friendly", "competitive"] },
    setup(sdk, p) {
      sdk.hud.label = p.label;
      sdk.on("clock.tick", (e) => {
        if (e.tick > 0 && e.tick % 60 === 0 && !sdk.ended) sdk.addScore(p.per_second);
      });
    },
  });

  // ------------------------------------------------------------------------------------------
  // Rules
  // ------------------------------------------------------------------------------------------

  B.defineConcept({
    id: "rule.timer",
    kind: "rule",
    formulas: ["*"],
    describe: "A countdown. When time runs out the run ends: a success (you lasted) or a fail (you ran out of time). Shows a ring at the top right.",
    examples: ["30 seconds to stack as high as you can", "beat the clock"],
    params: {
      seconds: { type: "integer", default: 30, min: 5, max: 180, unit: "s", describe: "Length of the run" },
      outcome: { type: "enum", values: ["success", "fail"], default: "success", describe: "What time running out means" },
      show: { type: "boolean", default: true, describe: "Show the countdown ring" },
    },
    consumes: ["clock.tick"],
    emits: ["rule.success", "rule.fail", "timer.warning"],
    ends: true,
    state: "timer: {total, left}",
    tags: { energy: ["medium", "high"] },
    setup(sdk, p) {
      const total = p.seconds * 60;
      const st = (sdk.state.timer = { total, left: total });
      sdk.on("clock.tick", (e) => {
        if (sdk.ended) return;
        st.left = Math.max(0, total - (e.tick + 1));
        if (st.left === 300) { sdk.emit("timer.warning", { left: 5 }); sdk.fx.sound("tick"); }
        if (st.left <= 0) {
          sdk.emit(p.outcome === "success" ? "rule.success" : "rule.fail", { reason: "time" });
          sdk.end(p.outcome);
        }
      });
      if (p.show) {
        const pal = sdk.palette;
        const labels = [];
        for (let i = 0; i <= p.seconds; i++) labels.push(String(i));
        sdk.layer(sdk.Z.hud, (g) => {
          const x = B.W - 30, y = 30, r = 17;
          const frac = st.left / total;
          const ctx = g.ctx;
          g.pill(x - r - 3, y - r - 3, 2 * r + 6, 2 * r + 6, { fill: pal.surface, radius: r + 3 });
          g.ring(x, y, r, pal.ink, { width: 3, alpha: 0.12 });
          ctx.save();
          ctx.globalAlpha = 0.95;
          ctx.strokeStyle = st.left <= 300 ? pal.danger : pal.primary;
          ctx.lineWidth = 3.5;
          ctx.lineCap = g.look === "pixel" ? "butt" : "round";
          ctx.beginPath();
          ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
          ctx.stroke();
          ctx.restore();
          g.text(labels[Math.ceil(st.left / 60)] || "0", x, y + 1, { size: 13, weight: 800, color: pal.ink });
        });
      }
    },
  });

  B.defineConcept({
    id: "rule.lives",
    kind: "rule",
    formulas: ["*"],
    describe: "You can take a few hits. Each entity.hit pops one life (with a short grace period); when the last one pops, the run ends. Gentler than instant fail.",
    examples: ["three bubbles of health", "one extra chance"],
    params: {
      lives: { type: "integer", default: 3, min: 1, max: 9, describe: "Hits you can take" },
      grace: { type: "integer", default: 50, min: 0, max: 120, unit: "ticks", describe: "Can't be hit again for this long" },
    },
    consumes: ["entity.hit"],
    emits: ["rule.fail", "lives.lost"],
    conflicts: ["rule.collide_fail"],
    ends: true,
    state: "lives: {left, max, grace_until}",
    tags: { energy: ["low", "medium"], mood: ["chill", "cozy", "warm"] },
    setup(sdk, p) {
      const st = (sdk.state.lives = { left: p.lives, max: p.lives, grace_until: -1 });
      sdk.on("entity.hit", (e) => {
        if (sdk.ended || sdk.tick < st.grace_until) return;
        st.left--;
        st.grace_until = sdk.tick + p.grace;
        sdk.emit("lives.lost", { left: st.left });
        sdk.fx.shake(5);
        sdk.fx.haptic("medium");
        sdk.fx.sound("pop");
        if (st.left <= 0) {
          sdk.emit("rule.fail", { reason: "lives", x: e && e.x, y: e && e.y });
          sdk.end("fail", e);
        }
      });
      const pal = sdk.palette;
      sdk.layer(sdk.Z.hud, (g) => {
        for (let i = 0; i < st.max; i++) {
          const x = 22 + i * 21, y = 30;
          if (i < st.left) g.bubble(x, y, 8.5, { tint: pal.danger, glow: 0.9 });
          else g.ring(x, y, 6, pal.ink, { width: 1.5, alpha: 0.25 });
        }
      });
    },
  });

  B.defineConcept({
    id: "rule.attempt_budget",
    kind: "rule",
    formulas: ["*"],
    describe: "A fixed number of tries. Every committed answer (guess.made) uses one, or only wrong ones (counts: misses). Out of tries without the answer: the run ends.",
    examples: ["six tries to find the word", "three wrong picks and you're out"],
    params: {
      attempts: { type: "integer", default: 6, min: 1, max: 12, describe: "Tries" },
      counts: { type: "enum", values: ["all", "misses"], default: "all", describe: "all: every answer uses a try. misses: only wrong ones" },
      show: { type: "boolean", default: true, describe: "Show tries left as small bubbles at the top right" },
    },
    consumes: ["guess.made"],
    emits: ["rule.fail"],
    ends: true,
    state: "attempts: {used, budget, left}",
    tags: { energy: ["low"], competition: ["light", "friendly"] },
    setup(sdk, p) {
      const st = (sdk.state.attempts = { used: 0, budget: p.attempts, left: p.attempts });
      sdk.on("guess.made", (e) => {
        if (sdk.ended) return;
        const correct = !!(e && e.correct);
        if (p.counts === "misses" && correct) return;
        st.used++;
        st.left = Math.max(0, st.budget - st.used);
        if (st.left <= 0 && !correct) {
          sdk.emit("rule.fail", { reason: "attempts" });
          const settle = typeof sdk.state.reveal_until === "number" ? Math.max(0, sdk.state.reveal_until - sdk.tick) : 0;
          sdk.end("fail", { delay: settle + 24 });
        }
      });
      if (p.show) {
        const pal = sdk.palette;
        sdk.layer(sdk.Z.hud, (g) => {
          for (let i = 0; i < st.budget; i++) {
            const x = B.W - 20 - i * 17, y = 26;
            if (i < st.left) g.bubble(x, y, 7, { tint: pal.accent, glow: 0.7 });
            else g.ring(x, y, 4.5, pal.ink, { width: 1.5, alpha: 0.22 });
          }
        });
      }
    },
  });

  // ------------------------------------------------------------------------------------------
  // Behavior, social
  // ------------------------------------------------------------------------------------------

  B.defineConcept({
    id: "behavior.speed_ramp",
    kind: "behavior",
    formulas: ["*"],
    describe: "Speeds the game up over time: state.pace starts at 1 and rises by rate every 10 seconds up to max. Moving things multiply their speed by it. Emits behavior.ramp {pace} at each step up.",
    examples: ["slowly gets faster", "a gentle ramp for a chill game, steep for a hard level"],
    params: {
      rate: { type: "number", default: 0.06, min: 0, max: 0.4, describe: "Pace added every 10 seconds" },
      max: { type: "number", default: 1.6, min: 1, max: 3, describe: "Top pace" },
      delay: { type: "number", default: 3, min: 0, max: 30, unit: "s", describe: "Seconds before it starts ramping" },
    },
    consumes: ["clock.tick"],
    emits: ["behavior.ramp"],
    state: "pace",
    tags: { energy: ["medium", "high"] },
    setup(sdk, p) {
      sdk.state.pace = 1;
      let step = 10;
      sdk.on("clock.tick", (e) => {
        const t = e.tick / 60 - p.delay;
        if (t <= 0) return;
        const pace = Math.min(p.max, 1 + (p.rate * t) / 10);
        sdk.state.pace = pace;
        const s = Math.floor(pace * 10 + 1e-9);
        if (s > step) {
          step = s;
          sdk.emit("behavior.ramp", { pace });
          sdk.fx.sound("whoosh");
        }
      });
    },
  });

  B.defineConcept({
    id: "social.beat_marker",
    kind: "social",
    formulas: ["*"],
    describe: "Shows the score to beat (your best) in a corner and celebrates the moment you pass it. Cosmetic; emits social.new_best.",
    examples: ["\"Best 14\" chip, sparkles when you beat it"],
    params: {
      text: { type: "string", default: "New best!", max_length: 24, describe: "What floats up when you beat it" },
    },
    consumes: ["score.changed"],
    emits: ["social.new_best"],
    tags: { competition: ["friendly", "competitive"] },
    setup(sdk, p) {
      const best = sdk.player && typeof sdk.player.best === "number" ? sdk.player.best : null;
      let fired = false;
      sdk.on("score.changed", (e) => {
        if (fired || best === null || best <= 0 || e.score <= best) return;
        fired = true;
        sdk.emit("social.new_best", { score: e.score, best });
        sdk.fx.float(p.text, B.W / 2, 150, sdk.palette.accents[1]);
        sdk.fx.sparkle(B.W / 2, 150, sdk.palette.accents[1], 18);
        sdk.fx.sound("chime");
        sdk.fx.haptic("success");
      });
      if (best !== null && best > 0) {
        const pal = sdk.palette;
        const label = "Best " + best;
        sdk.layer(sdk.Z.hud, (g) => {
          if (fired) return;
          g.pill(12, 12, 24 + label.length * 7.2, 26, { fill: pal.surface, radius: 13 });
          g.text(label, 24 + label.length * 3.6, 25.5, { size: 12, weight: 800, color: pal.ink });
        });
      }
    },
  });
})();
