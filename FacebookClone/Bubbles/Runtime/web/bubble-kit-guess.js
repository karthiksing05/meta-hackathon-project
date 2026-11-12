/*
 * bubble-kit-guess.js: the guess formula (docs/BUBBLES.md 4.6). Two styles:
 *
 *  word  Type today's word on a glowing bubble keyboard (input.type). The hidden word is a string
 *        of empty bubbles under a little fog. When you pop a guess, each letter floats up: right
 *        spot letters glow into their bubble, letters in the word drift down as loose bubbles, the
 *        rest pop. The fog lifts as you find letters. Concepts: space.word_bubbles,
 *        rule.letter_feedback, score.attempts_used, rule.attempt_budget, feel.bubble_reveal.
 *  who   "Who is it?" rounds for icebreakers: a fact card above portrait bubbles; pick the person it
 *        belongs to. Concepts: space.portrait_choices, rule.pick_match, flow.rounds, input.select.
 *
 * State: word {target, length, slots, slotTick, near, guesses, reveal}, round {index, heading, fact,
 * choices, answer, picked, correct, start}, choices (portrait hit areas), keyboard (input.type).
 * Events: guess.made {correct}, guess.feedback {guess, marks, index}, guess.invalid {reason},
 * guess.solved {tries}, round.correct / round.miss {x, y, ticks, index}, round.done {correct}.
 *
 * Length (docs/BUBBLES.md 7.9): the word style's tries are rounds (rounds mode: length.rounds
 * tries; lives mode: length.lives wrong tries; rule.attempt_budget or rule.letter_feedback counts
 * them) and a timed word that isn't found when the clock runs out is a fail. The who style plays
 * through flow.rounds: length.rounds facts (cycling), or facts until the clock or lives run out.
 */
(function () {
  "use strict";
  const B = typeof Bubble !== "undefined" ? Bubble : null;
  if (!B) return;
  const clamp = B.util.clamp;
  const W = B.W;

  function cleanWord(s) {
    return String(s || "").toUpperCase().replace(/[^A-Z]/g, "");
  }

  // Standard letter feedback: right spot first, then letters elsewhere (respecting counts).
  function letterMarks(guess, target) {
    const n = guess.length;
    const marks = new Array(n).fill("miss");
    const left = Object.create(null);
    for (let i = 0; i < n; i++) {
      if (guess[i] === target[i]) marks[i] = "hit";
      else left[target[i]] = (left[target[i]] || 0) + 1;
    }
    for (let i = 0; i < n; i++) {
      if (marks[i] === "hit") continue;
      const c = guess[i];
      if (left[c] > 0) { marks[i] = "near"; left[c]--; }
    }
    return marks;
  }

  function resolveTarget(sdk) {
    let t = cleanWord(sdk.content.target);
    if (!t && Array.isArray(sdk.content.words) && sdk.content.words.length) {
      const list = sdk.content.words.map(cleanWord).filter((w) => w.length >= 3 && w.length <= 10);
      if (list.length) t = list[B.util.hashString(String(sdk.manifest.seed)) % list.length];
    }
    return t.length >= 3 && t.length <= 10 ? t : "BUBBLE";
  }

  // ------------------------------------------------------------------------------------------
  // Word style
  // ------------------------------------------------------------------------------------------

  B.defineConcept({
    id: "rule.letter_feedback",
    kind: "rule",
    formulas: ["guess"],
    describe: "Guess a hidden word (content.target, or one picked by content.seed). Each guess gets letter feedback: hit (right spot), near (in the word, elsewhere) or miss. Finding every letter wins. The feedback glue can replace the marking rule.",
    examples: ["guess today's SF word", "find the neighborhood name in six tries"],
    params: {
      accept: { type: "enum", values: ["any", "dictionary"], default: "any", describe: "any: any letters of the right length. dictionary: only words in content.dictionary (or content.words)" },
      hint: { type: "enum", values: ["none", "first_letter", "last_letter"], default: "none", describe: "Start with a letter already showing" },
    },
    consumes: ["input.submit", "clock.tick"],
    emits: ["guess.made", "guess.feedback", "guess.invalid", "guess.solved", "rule.success"],
    requires: ["input.type"],
    glue: ["feedback"],
    ends: true,
    state: "word: {target, length, slots, near, guesses, reveal}",
    tags: { energy: ["low"], competition: ["light", "friendly"], skill: ["words"] },
    check(manifest, p) {
      const out = [];
      if (p.accept === "dictionary") {
        const dict = (manifest.content.dictionary || manifest.content.words || []).map(cleanWord);
        if (!dict.length) out.push({ code: "content", message: "accept: dictionary needs content.dictionary (or content.words)", path: "content.dictionary" });
      }
      return out;
    },
    setup(sdk, p) {
      const target = resolveTarget(sdk);
      const n = target.length;
      const clues = sdk.content.clues && typeof sdk.content.clues === "object" ? sdk.content.clues : null;
      const clue = (clues && (clues[target] || clues[target.toLowerCase()])) || sdk.content.clue || "";
      const st = (sdk.state.word = {
        target, length: n, clue: String(clue).slice(0, 90),
        slots: new Array(n).fill(null), slotTick: new Array(n).fill(-1), hinted: new Array(n).fill(false),
        near: [], nearTick: [], guesses: [], reveal: null, solved: false, stagger: 6,
      });
      sdk.state.share_rows = [];
      if (p.hint === "first_letter" || p.hint === "last_letter") {
        const i = p.hint === "first_letter" ? 0 : n - 1;
        st.slots[i] = target[i];
        st.slotTick[i] = -100;
        st.hinted[i] = true;
      }
      const dict = Object.create(null);
      for (const w of (sdk.content.dictionary || sdk.content.words || [])) dict[cleanWord(w)] = true;
      dict[target] = true;
      const kb = sdk.state.keyboard;
      if (kb) {
        kb.max = n;
        if (p.hint !== "none") {
          const i = p.hint === "first_letter" ? 0 : n - 1;
          kb.marks[target[i]] = "hit";
        }
      }
      const rank = { miss: 1, near: 2, hit: 3 };
      // Length: a timed word not found in time is a fail; without rule.attempt_budget this rule
      // counts tries as rounds or wrong tries as lives.
      const L = sdk.length || {};
      const countsTries = !sdk.has("rule.attempt_budget") && (L.rounds || L.lives);
      sdk.on("length.end", (e) => {
        if (e.mode !== "timed" || st.solved || sdk.ended) return;
        sdk.emit("rule.fail", { reason: "time" });
        sdk.end("fail", { delay: 24 });
      });

      sdk.on("input.submit", (e) => {
        if (sdk.ended || st.solved) return;
        if (st.reveal && sdk.tick < st.reveal.until) return;
        const guess = cleanWord(e && e.value);
        if (guess.length !== n) { sdk.emit("guess.invalid", { reason: "length", need: n }); sdk.fx.haptic("light"); return; }
        if (p.accept === "dictionary" && !dict[guess]) { sdk.emit("guess.invalid", { reason: "word" }); sdk.fx.haptic("light"); return; }
        let marks = null;
        const glue = sdk.glue("feedback");
        if (glue) {
          const v = glue(guess, target, { tries: st.guesses.length });
          if (Array.isArray(v) && v.length === n && v.every((m) => m === "hit" || m === "near" || m === "miss")) marks = v.slice();
        }
        if (!marks) marks = letterMarks(guess, target);
        const stagger = typeof sdk.state.reveal_stagger === "number" ? sdk.state.reveal_stagger : 6;
        st.stagger = stagger;
        const t0 = sdk.tick;
        const until = t0 + stagger * n + 20;
        st.reveal = { tick: t0, guess, marks, until, index: st.guesses.length };
        st.guesses.push({ guess, marks });
        sdk.state.share_rows.push(marks);
        sdk.state.reveal_until = until;
        if (kb) kb.locked = true;
        for (let i = 0; i < n; i++) {
          const land = t0 + i * stagger + 16;
          if (marks[i] === "hit" && st.slots[i] === null) { st.slots[i] = guess[i]; st.slotTick[i] = land; }
        }
        for (let i = 0; i < n; i++) {
          if (marks[i] !== "near") continue;
          const c = guess[i];
          if (st.near.indexOf(c) < 0 && st.slots.indexOf(c) < 0) { st.near.push(c); st.nearTick.push(t0 + i * stagger + 16); }
        }
        // Letters found in place no longer float around loose.
        for (let k = st.near.length - 1; k >= 0; k--) {
          const c = st.near[k];
          let needed = 0, placed = 0;
          for (let i = 0; i < n; i++) { if (target[i] === c) needed++; if (st.slots[i] === c) placed++; }
          if (placed >= needed) { st.near.splice(k, 1); st.nearTick.splice(k, 1); }
        }
        const solved = marks.every((m) => m === "hit");
        sdk.emit("guess.feedback", { guess, marks, index: st.reveal.index });
        sdk.emit("guess.made", { correct: solved });
        if (solved) {
          st.solved = true;
          sdk.emit("guess.solved", { tries: st.guesses.length });
          sdk.emit("rule.success", { tries: st.guesses.length });
          sdk.end("success", { delay: until - sdk.tick + 36 });
          if (countsTries && L.rounds) sdk.lengthRound();
        } else if (countsTries && !sdk.ended) {
          const out = L.rounds ? !sdk.lengthRound({ outcome: "fail", delay: until - sdk.tick + 24 }) : !sdk.lengthMiss();
          if (out && !sdk.ended) {
            sdk.emit("rule.fail", { reason: "tries" });
            sdk.end("fail", { delay: until - sdk.tick + 24 });
          }
        }
      });

      sdk.on("clock.tick", (e) => {
        const r = st.reveal;
        if (!r) return;
        const k = e.tick - r.tick - 16;
        if (k >= 0 && k % st.stagger === 0) {
          const i = k / st.stagger;
          if (i < n) {
            const c = r.guess[i], m = r.marks[i];
            if (kb && (!kb.marks[c] || rank[m] > rank[kb.marks[c]])) kb.marks[c] = m;
            const pos = sdk.state.word_layout;
            if (pos) {
              if (m === "hit") { sdk.fx.sparkle(pos.slotX[i], pos.slotY[i], sdk.palette.good, 8); sdk.fx.sound("chime"); }
              else if (m === "miss") { sdk.fx.pop(pos.slotX[i], pos.slotY[i] - 70, null, 6); sdk.fx.sound("pop"); }
              else sdk.fx.sound("blip");
            }
          }
        }
        if (kb && e.tick >= r.until - 1 && !st.solved && !sdk.ended) kb.locked = false;
      });
    },
  });

  B.defineConcept({
    id: "space.word_bubbles",
    kind: "space",
    formulas: ["guess"],
    describe: "The hidden word as a string of glass bubbles under a little fog, a clue on top, your guess in a bubble wand, and loose letters you've found floating nearby. The fog lifts as letters land. No grid of squares.",
    examples: ["today's word hiding in the fog"],
    params: {
      mist: { type: "boolean", default: true, describe: "Fog over the word that lifts as you find letters" },
      show_last: { type: "boolean", default: true, describe: "Show your last guess with soft color dots" },
      show_tries: { type: "boolean", default: true, describe: "Show tries left under the wand" },
    },
    requires: ["rule.letter_feedback"],
    tags: { mood: ["cozy", "calm", "playful"] },
    setup(sdk, p) {
      // Colors come from palette roles; the look decides how they're drawn.
      const pal = sdk.palette;
      const dark = pal.dark;
      const hitFill = pal.good, nearFill = pal.near;
      const ink = pal.ink;
      const inkOnHit = pal.inkOn(hitFill), inkOnNear = pal.inkOn(nearFill);
      const glass = pal.surface;
      const edge = pal.look === "glow" ? pal.line : undefined;
      // Layout is fixed per word length, so work it out once (bots and fx read it too).
      let layout = null;
      function ensureLayout() {
        const st = sdk.state.word;
        if (!st) return null;
        if (layout && layout.n === st.length) return layout;
        const n = st.length;
        const r = Math.min(25, (W - 34 - (n - 1) * 8) / n / 2);
        const gap = 2 * r + 8;
        const x0 = W / 2 - (gap * (n - 1)) / 2;
        const slotX = [], slotY = [], wandX = [];
        const wr = Math.min(17, (W - 80 - (n - 1) * 6) / n / 2);
        const wgap = 2 * wr + 6;
        const wx0 = W / 2 - (wgap * (n - 1)) / 2;
        for (let i = 0; i < n; i++) {
          const x = x0 + i * gap;
          const u = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
          slotX.push(x);
          slotY.push(190 + 18 * (1 - u * u));
          wandX.push(wx0 + i * wgap);
        }
        layout = { n, r, slotX, slotY, wr, wandX, wandY: 352 };
        sdk.state.word_layout = layout;
        return layout;
      }
      sdk.on("flow.phase", () => { ensureLayout(); });
      const tryLabels = [];
      for (let i = 0; i <= 12; i++) tryLabels.push(i === 1 ? "1 try left" : i + " tries left");

      // Clue and fog (behind the word).
      sdk.layer(sdk.Z.space, (g) => {
        const st = sdk.state.word;
        if (!st) return;
        const L = ensureLayout();
        if (st.clue) {
          const lines = g.wrapText(st.clue, 290, 17, 700);
          const h = 26 + lines.length * 22;
          g.pill(22, 56, W - 44, h, { fill: glass, radius: 22, glow: 0.5, glowColor: pal.glow, stroke: edge });
          for (let i = 0; i < lines.length && i < 3; i++) g.text(lines[i], W / 2, 56 + 24 + i * 22, { size: 17, weight: 700, color: ink });
        }
        if (p.mist) {
          let found = 0;
          for (let i = 0; i < st.length; i++) if (st.slots[i] !== null && sdk.tick >= st.slotTick[i]) found++;
          const lift = st.solved && sdk.tick > (st.reveal ? st.reveal.until : 0) ? 1 : found / st.length;
          const a = (dark ? 0.32 : 0.62) * (1 - lift);
          if (a > 0.01) {
            for (let k = 0; k < 7; k++) {
              const x = ((k * 71 + g.t * (9 + k * 2)) % (W + 120)) - 60;
              const y = L.slotY[0] + Math.sin(k * 1.9) * 16 - lift * 30;
              g.puff(x, y, 46 + (k % 3) * 10, pal.mist, a * (0.55 + (k % 2) * 0.25));
            }
          }
        }
      });

      // The word, loose letters, the wand.
      sdk.layer(sdk.Z.entities, (g) => {
        const st = sdk.state.word;
        if (!st) return;
        const L = ensureLayout();
        const n = st.length;
        const tick = sdk.tick;
        const reveal = st.reveal;
        const failed = sdk.phase === "fail" || (sdk.ended && !st.solved);
        const solvedGlow = st.solved && reveal && tick >= reveal.until - 4;
        // Slots
        for (let i = 0; i < n; i++) {
          const x = L.slotX[i];
          const bob = Math.sin(g.t * 1.6 + i * 0.9) * 2.5;
          const y = L.slotY[i] + bob;
          const letter = st.slots[i];
          const shown = letter !== null && tick >= st.slotTick[i];
          if (shown) {
            const since = tick - st.slotTick[i];
            const pop = since < 18 && st.slotTick[i] >= 0 ? g.ease.back(since / 18) : 1;
            const rr = L.r * (0.75 + 0.25 * pop) * (solvedGlow ? 1 + Math.sin(g.t * 5 + i) * 0.05 : 1);
            g.orb(x, y, rr, st.hinted[i] && !solvedGlow ? B.color.mix(hitFill, pal.glow, 0.45) : hitFill, { glow: solvedGlow ? 1.3 : 0.9 });
            g.text(letter, x, y + 1.5, { size: L.r * 1.05, weight: 800, color: inkOnHit });
          } else if (failed && sdk.phase === "fail") {
            g.bubble(x, y, L.r, { glow: 0.4, wobble: 0.4 });
            g.text(st.target[i], x, y + 1.5, { size: L.r * 1.0, weight: 800, color: ink, alpha: 0.55 });
          } else {
            g.bubble(x, y, L.r, { glow: 0.6, wobble: 0.5 });
          }
        }
        // Loose letters: in the word, not placed yet.
        const nn = st.near.length;
        for (let k = 0; k < nn; k++) {
          if (tick < st.nearTick[k]) continue;
          const span = Math.min(W - 80, nn * 40);
          const x = W / 2 - span / 2 + (nn > 1 ? (k * span) / (nn - 1) : span / 2) + Math.sin(g.t * 1.3 + k * 2.1) * 6;
          const y = 268 + Math.sin(g.t * 1.9 + k * 1.3) * 5;
          const since = tick - st.nearTick[k];
          const s = since < 16 ? g.ease.back(since / 16) : 1;
          g.orb(x, y, 14 * s, nearFill, { glow: 0.8 });
          g.text(st.near[k], x, y + 1, { size: 15 * s, weight: 800, color: inkOnNear });
        }
        // Wand: the guess you're typing.
        const kb = sdk.state.keyboard;
        const typing = kb ? kb.value : "";
        const inFlight = reveal && tick < reveal.until;
        const shake = kb && tick - kb.shakeTick < 18 ? Math.sin((tick - kb.shakeTick) * 1.4) * 6 * (1 - (tick - kb.shakeTick) / 18) : 0;
        const wy = L.wandY;
        const ww = L.wandX[n - 1] - L.wandX[0] + 2 * L.wr + 26;
        g.pill(W / 2 - ww / 2 + shake, wy - L.wr - 11, ww, 2 * L.wr + 22, { fill: glass, radius: L.wr + 11, stroke: edge, strokeWidth: 1.5, glow: 0.4, glowColor: pal.glow });
        for (let i = 0; i < n; i++) {
          const x = L.wandX[i] + shake;
          if (!inFlight && i < typing.length) {
            g.bubble(x, wy, L.wr, { glow: 0.5, tint: pal.glow });
            g.text(typing[i], x, wy + 1, { size: L.wr * 1.15, weight: 800, color: ink });
          } else if (!inFlight) {
            const next = i === typing.length && !sdk.ended;
            g.circle(x, wy, next ? 4 + Math.sin(g.t * 6) * 1.2 : 3, ink, next ? 0.45 : 0.18);
          }
        }
        // Letters in flight from the wand to where they belong.
        if (inFlight) {
          for (let i = 0; i < n; i++) {
            const start = reveal.tick + i * st.stagger;
            const k = (tick - start) / 16;
            const m = reveal.marks[i];
            const c = reveal.guess[i];
            if (k < 0) {
              g.bubble(L.wandX[i], wy, L.wr, { glow: 0.5 });
              g.text(c, L.wandX[i], wy + 1, { size: L.wr * 1.15, weight: 800, color: ink });
              continue;
            }
            if (k >= 1) continue;
            const e = g.ease.inOut(k);
            let tx = L.slotX[i], ty = L.slotY[i];
            if (m === "near") { tx = W / 2; ty = 268; }
            const x = L.wandX[i] + (tx - L.wandX[i]) * e;
            const y = wy + (ty - wy) * e - Math.sin(k * Math.PI) * 40;
            const a = m === "miss" ? 1 - Math.max(0, k - 0.6) / 0.4 : 1;
            g.bubble(x, y, L.wr * (1 + 0.2 * Math.sin(k * Math.PI)), { glow: 0.7, alpha: a, tint: m === "hit" ? hitFill : m === "near" ? nearFill : pal.glow });
            g.text(c, x, y + 1, { size: L.wr * 1.15, weight: 800, color: ink, alpha: a });
          }
        }
        // Tries left, then the last guess with soft color dots.
        const att = sdk.state.attempts;
        if (p.show_tries && att && !sdk.ended) {
          g.text(tryLabels[clamp(att.left, 0, 12)], W / 2, 395, { size: 14, weight: 800, color: ink, alpha: 0.6 });
        }
        if (p.show_last && st.guesses.length && !inFlight) {
          const last = st.guesses[st.guesses.length - 1];
          const lw = 15;
          const lx0 = W / 2 - (lw * (n - 1)) / 2;
          for (let i = 0; i < n; i++) {
            const x = lx0 + i * lw;
            g.text(last.guess[i], x, 426, { size: 13, weight: 800, color: ink, alpha: last.marks[i] === "miss" ? 0.35 : 0.85 });
            const col = last.marks[i] === "hit" ? hitFill : last.marks[i] === "near" ? nearFill : null;
            if (col) g.circle(x, 441, 3, col, 1);
            else g.circle(x, 441, 2, ink, 0.2);
          }
        }
      });
    },
  });

  B.defineConcept({
    id: "score.attempts_used",
    kind: "score",
    formulas: ["guess"],
    describe: "Scores a solve by how few tries it took: (tries in budget - tries used + 1) x per_try, so solving early scores more. A miss still earns partial points per letter found. The score glue can reshape it.",
    examples: ["600 for a first-try solve, 100 on the last try"],
    params: {
      per_try: { type: "integer", default: 100, min: 10, max: 500, describe: "Points for each try you had left" },
      partial: { type: "integer", default: 10, min: 0, max: 100, describe: "Points per letter found when you don't solve it" },
    },
    consumes: ["guess.made"],
    glue: ["score"],
    tags: { competition: ["light", "friendly"] },
    setup(sdk, p) {
      sdk.hud.score = false;
      let done = false;
      function budget() { return sdk.state.attempts ? sdk.state.attempts.budget : 6; }
      sdk.on("guess.made", (e) => {
        if (done || !e || !e.correct) return;
        done = true;
        const tries = sdk.state.word ? sdk.state.word.guesses.length : 1;
        let pts = Math.max(1, budget() - tries + 1) * p.per_try;
        const glue = sdk.glue("score");
        if (glue) {
          const v = glue({ base: pts, tries, budget: budget(), time: sdk.time, tick: sdk.tick, score: sdk.score, solved: true });
          if (typeof v === "number" && isFinite(v)) pts = clamp(Math.round(v), 0, 100000);
        }
        sdk.addScore(pts);
        sdk.share({ score_text: "Solved in " + tries + "/" + budget() });
      });
      sdk.on("flow.phase", (e) => {
        if (e.name !== "fail" || done) return;
        done = true;
        const st = sdk.state.word;
        let found = 0;
        if (st) for (let i = 0; i < st.length; i++) if (st.slots[i] !== null && !st.hinted[i]) found++;
        if (found && p.partial) sdk.addScore(found * p.partial);
        sdk.share({ score_text: st ? "Found " + found + " of " + st.length + " letters" : sdk.score + " points" });
      });
    },
  });

  B.defineConcept({
    id: "feel.bubble_reveal",
    kind: "feel",
    formulas: ["guess"],
    describe: "Paces the reveal: each guessed letter floats up one after another (stagger ticks apart) before the next guess. Bigger is more dramatic, smaller is snappier.",
    examples: ["a slow, cozy reveal (12)", "a quick one (5)"],
    params: {
      stagger: { type: "integer", default: 9, min: 4, max: 20, unit: "ticks", describe: "Ticks between letters" },
    },
    order: 5,
    tags: { mood: ["cozy", "dreamy", "playful"] },
    setup(sdk, p) {
      sdk.state.reveal_stagger = p.stagger;
    },
  });

  // ------------------------------------------------------------------------------------------
  // Who-is-it style
  // ------------------------------------------------------------------------------------------

  const LAYOUTS = {
    2: [[98, 410], [262, 410]],
    3: [[180, 316], [98, 482], [262, 482]],
    4: [[98, 322], [262, 322], [98, 492], [262, 492]],
  };

  B.defineConcept({
    id: "space.portrait_choices",
    kind: "space",
    formulas: ["guess"],
    describe: "A fact card above two to four portrait bubbles (photo inside a soap bubble, name below). Tap the person the fact belongs to. Made for Event icebreakers and getting to know a Group.",
    examples: ["who runs Lands End every Saturday?", "match the intro to the newcomer"],
    params: {
      choices: { type: "integer", default: 4, min: 2, max: 4, describe: "Portraits per round" },
      heading: { type: "string", default: "Who is it?", max_length: 28, describe: "Line above each fact" },
      show_names: { type: "boolean", default: true, describe: "Show names under portraits" },
    },
    requires: ["rule.pick_match"],
    order: 21,
    state: "choices: [{x, y, r, value}]",
    tags: { mood: ["warm", "playful", "cozy"], occasion: ["icebreaker", "event"] },
    setup(sdk, p) {
      const spots = LAYOUTS[p.choices] || LAYOUTS[4];
      const r = p.choices === 4 ? 60 : 64;
      sdk.state.choices = spots.map((s, i) => ({ x: s[0], y: s[1], r, value: i }));
      sdk.state.choice_count = p.choices;
      // Colors come from palette roles; the look decides how they're drawn.
      const pal = sdk.palette;
      const ink = pal.ink;
      const hit = pal.good;
      const inkOnHit = pal.inkOn(hit);
      const glass = pal.surface;
      const edge = pal.look === "glow" ? pal.line : undefined;
      const thatsCache = Object.create(null);

      sdk.layer(sdk.Z.space, (g) => {
        const rd = sdk.state.round;
        if (!rd) return;
        const since = sdk.tick - rd.start;
        const a = clamp(since / 14, 0, 1);
        const out = rd.picked >= 0 ? clamp((sdk.tick - rd.pickTick - 46) / 14, 0, 1) : 0;
        const alpha = a * (1 - out);
        const lines = g.wrapText(rd.fact, 280, 22, 800);
        const h = 54 + Math.min(3, lines.length) * 27;
        const y0 = 62 + (1 - g.ease.back(a)) * 16;
        g.pill(20, y0, W - 40, h, { fill: glass, radius: 26, glow: 0.6, glowColor: pal.glow, alpha, stroke: edge, strokeWidth: 1.2 });
        g.text(p.heading, W / 2, y0 + 24, { size: 14, weight: 800, color: ink, alpha: alpha * 0.6 });
        for (let i = 0; i < lines.length && i < 3; i++) g.text(lines[i], W / 2, y0 + 52 + i * 27, { size: 22, weight: 800, color: ink, alpha, maxWidth: 296 });
      });

      sdk.layer(sdk.Z.entities, (g) => {
        const rd = sdk.state.round;
        const ch = sdk.state.choices;
        if (!rd || !ch) return;
        const tick = sdk.tick;
        const picked = rd.picked;
        for (let i = 0; i < ch.length && i < rd.choices.length; i++) {
          const c = ch[i], person = rd.choices[i];
          const since = tick - rd.start - i * 4;
          const enter = clamp(since / 22, 0, 1);
          if (enter <= 0) continue;
          const leave = picked >= 0 ? clamp((tick - rd.pickTick - 44) / 16, 0, 1) : 0;
          const e = g.ease.back(enter);
          let x = c.x, y = c.y + (1 - e) * 70 - leave * 60 + Math.sin(g.t * 1.5 + i * 1.7) * 3;
          let s = 0.6 + 0.4 * e;
          let alpha = Math.min(1, enter * 1.5) * (1 - leave);
          const isAnswer = i === rd.answer;
          let ring = null;
          if (picked >= 0) {
            const k = tick - rd.pickTick;
            if (i === picked && rd.correct) { s *= 1 + 0.08 * Math.sin(Math.min(1, k / 12) * Math.PI); ring = hit; }
            else if (i === picked) { x += k < 18 ? Math.sin(k * 1.3) * 7 * (1 - k / 18) : 0; alpha *= 0.55; }
            else if (isAnswer) { ring = hit; s *= 1 + 0.05 * Math.sin(g.t * 6); }
            else alpha *= 0.45;
          }
          const r = c.r * s;
          if (ring) g.halo(x, y, r * 1.6, ring, 0.75 * alpha);
          g.image(person.avatar, x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8, { circle: true, alpha, placeholder: person.name });
          g.lens(x, y, r, { glow: 0.7, alpha, tint: ring || pal.glow });
          if (ring) g.ring(x, y, r + 3, ring, { width: 4, alpha: alpha * 0.95 });
          if (p.show_names) {
            let label = person.short || person.name;
            if (picked >= 0 && isAnswer && !rd.correct) {
              label = thatsCache[person.name] || (thatsCache[person.name] = "That's " + (person.short || person.name) + "!");
            }
            const lw = Math.min(150, 24 + label.length * 8.2);
            g.pill(x - lw / 2, y + c.r + 6, lw, 26, { fill: ring ? ring : glass, radius: 13, alpha, glow: ring ? 0.8 : 0, glowColor: ring || pal.glow });
            g.text(label, x, y + c.r + 19.5, { size: 14, weight: 800, color: ring ? inkOnHit : ink, alpha, maxWidth: lw - 12 });
          }
        }
      });
    },
  });

  function firstName(name) {
    return String(name || "").trim().split(/\s+/)[0] || "";
  }

  function buildRounds(sdk, count) {
    const c = sdk.content;
    const want = clamp(count, 2, 4);
    const out = [];
    if (Array.isArray(c.rounds) && c.rounds.length) {
      for (const r of c.rounds) {
        if (!r || !Array.isArray(r.choices) || r.choices.length < 2) continue;
        const ans = r.choices.find((x) => x && x.id === r.answer_id);
        if (!ans) continue;
        let picks = sdk.shuffle(r.choices).slice(0, want);
        if (picks.indexOf(ans) < 0) { picks[picks.length - 1] = ans; picks = sdk.shuffle(picks); }
        out.push({
          fact: String(r.fact || ""),
          choices: picks.map((x) => ({ id: String(x.id), name: String(x.name || x.id), short: firstName(x.name || x.id), avatar: x.avatar || "" })),
          answer: picks.indexOf(ans),
        });
      }
      return out;
    }
    const people = (Array.isArray(c.people) ? c.people : []).filter((x) => x && x.id && x.name && Array.isArray(x.facts) && x.facts.length);
    if (people.length < 2) return out;
    const order = sdk.shuffle(people);
    for (let k = 0; k < order.length; k++) {
      const person = order[k];
      const fact = sdk.pick(person.facts);
      const others = sdk.shuffle(people.filter((x) => x.id !== person.id)).slice(0, want - 1);
      const picks = sdk.shuffle([person].concat(others));
      out.push({
        fact: String(fact),
        choices: picks.map((x) => ({ id: String(x.id), name: String(x.name), short: firstName(x.name), avatar: x.avatar || "" })),
        answer: picks.indexOf(person),
      });
    }
    return out;
  }

  B.defineConcept({
    id: "rule.pick_match",
    kind: "rule",
    formulas: ["guess"],
    describe: "Each round shows a fact and portrait choices; pick who it belongs to. Rounds come from content.rounds, or are built from content.people (each with facts) with the seed. Emits round.correct or round.miss, then round.done for flow.rounds.",
    examples: ["six facts about people coming to the picnic"],
    params: {
      feedback: { type: "boolean", default: true, describe: "Sparkle and sound on each pick" },
    },
    consumes: ["round.start", "input.select"],
    emits: ["guess.made", "round.done", "round.correct", "round.miss"],
    requires: ["flow.rounds", "input.select", "space.portrait_choices"],
    state: "round: {index, fact, choices, answer, picked, correct, start}",
    tags: { occasion: ["icebreaker", "event"], competition: ["light", "friendly"] },
    setup(sdk, p) {
      const count = sdk.state.choice_count || 4;
      const rounds = buildRounds(sdk, count);
      sdk.state.rounds_available = Math.max(1, rounds.length);
      sdk.state.round = null;
      for (let i = 0; i < Math.min(2, rounds.length); i++) for (const c of rounds[i].choices) sdk.preload(c.avatar);
      sdk.on("round.start", (e) => {
        const r = rounds[e.index % Math.max(1, rounds.length)];
        if (!r) return;
        sdk.state.round = { index: e.index, fact: r.fact, choices: r.choices, answer: r.answer, picked: -1, correct: null, start: sdk.tick, pickTick: -1 };
        sdk.state.choices_locked = false;
        // Poster moment: the first fact with every portrait in place (they enter 4 ticks apart
        // over 22 ticks), before anyone is picked (the bot waits at least 34 ticks).
        if (sdk.state.poster_tick === undefined) sdk.state.poster_tick = sdk.tick + Math.min(34, (r.choices.length - 1) * 4 + 22);
        const next = rounds[e.index + 1];
        if (next) for (const c of next.choices) sdk.preload(c.avatar);
      });
      sdk.on("input.select", (e) => {
        const rd = sdk.state.round;
        if (!rd || rd.picked >= 0 || sdk.ended || sdk.state.choices_locked) return;
        if (e.index >= rd.choices.length) return;
        rd.picked = e.index;
        rd.pickTick = sdk.tick;
        rd.correct = e.index === rd.answer;
        sdk.state.choices_locked = true;
        const spot = sdk.state.choices[e.index];
        const info = { x: spot.x, y: spot.y - spot.r - 10, ticks: sdk.tick - rd.start, index: rd.index };
        sdk.emit("guess.made", { correct: rd.correct });
        if (rd.correct) {
          sdk.emit("round.correct", info);
          if (p.feedback) { sdk.fx.sparkle(spot.x, spot.y, sdk.palette.good, 16); sdk.fx.sound("chime"); sdk.fx.haptic("success"); }
        } else {
          sdk.emit("round.miss", info);
          if (p.feedback) { sdk.fx.sound("blip"); sdk.fx.haptic("light"); }
        }
        sdk.emit("round.done", { correct: rd.correct });
      });
    },
  });

  // ------------------------------------------------------------------------------------------
  // Bot
  // ------------------------------------------------------------------------------------------

  const COMMON = "EAORTINSLHCUDPMGBYFWKV";

  function planWord(sdk, mem) {
    const st = sdk.state.word;
    const n = st.length, target = st.target, skill = sdk.botSkill;
    const k = st.guesses.length;
    const pSolve = clamp(skill * (0.06 + k * 0.17) + (k >= 3 ? 0.05 : 0), 0, 0.95);
    if (sdk.botRng() < pSolve) return target;
    const dict = (sdk.content.dictionary || sdk.content.words || []).map(cleanWord).filter((w) => w.length === n && w !== target);
    const tried = Object.create(null);
    for (const gu of st.guesses) tried[gu.guess] = true;
    const fresh = dict.filter((w) => !tried[w]);
    if (fresh.length && (k === 0 ? sdk.botRng() < 0.7 : sdk.botRng() < 0.3)) return fresh[Math.floor(sdk.botRng() * fresh.length)];
    // Build a plausible guess: keep what's known, sometimes "work out" a right letter.
    const know = 0.06 + skill * 0.3 + k * 0.05 * (0.4 + skill);
    let out = "";
    for (let i = 0; i < n; i++) {
      if (st.slots[i] !== null) { out += st.slots[i]; continue; }
      if (sdk.botRng() < know) { out += target[i]; continue; }
      const pool = st.near.length && sdk.botRng() < 0.5 ? st.near.join("") : COMMON;
      out += pool[Math.floor(sdk.botRng() * Math.min(pool.length, 12))];
    }
    if (tried[out]) out = out.slice(0, n - 1) + COMMON[Math.floor(sdk.botRng() * 8)];
    return out;
  }

  function wordBot(sdk, mem) {
    const kb = sdk.state.keyboard, st = sdk.state.word;
    if (!kb || !st || kb.locked || st.solved) return null;
    if (!mem.queue) { mem.queue = []; mem.at = sdk.tick + 30; }
    if (sdk.tick < mem.at) return null;
    if (!mem.queue.length) {
      if (kb.value.length) { mem.queue = ["BACK"]; }
      else {
        const guess = planWord(sdk, mem);
        mem.queue = guess.split("").concat(["ENTER"]);
        mem.at = sdk.tick + 20 + Math.floor(sdk.botRng() * 40 * (1.3 - sdk.botSkill));
        return null;
      }
    }
    const key = mem.queue.shift();
    const k = kb.keys.find((x) => x.key === key);
    if (!k) { mem.queue = []; return null; }
    const pace = 6 + Math.floor(sdk.botRng() * (6 + 8 * (1 - sdk.botSkill)));
    mem.at = sdk.tick + (mem.queue.length === 1 ? pace + 14 : pace);
    return [{ a: "tap", v: [Math.round(k.cx + (sdk.botRng() - 0.5) * k.w * 0.4), Math.round(k.cy + (sdk.botRng() - 0.5) * k.h * 0.3)] }];
  }

  function whoBot(sdk, mem) {
    const rd = sdk.state.round;
    if (!rd || rd.picked >= 0 || sdk.state.choices_locked) return null;
    if (mem.round !== rd.index) {
      mem.round = rd.index;
      const skill = sdk.botSkill;
      mem.at = rd.start + 34 + Math.floor(sdk.botRng() * (40 + 70 * (1 - skill)));
      const right = sdk.botRng() < 0.3 + 0.65 * skill;
      if (right) mem.pick = rd.answer;
      else {
        const wrong = [];
        for (let i = 0; i < rd.choices.length; i++) if (i !== rd.answer) wrong.push(i);
        mem.pick = wrong[Math.floor(sdk.botRng() * wrong.length)];
      }
    }
    if (sdk.tick < mem.at) return null;
    const c = sdk.state.choices[mem.pick];
    if (!c) return null;
    mem.round = -1 - rd.index;
    return [{ a: "tap", v: [Math.round(c.x + (sdk.botRng() - 0.5) * 30), Math.round(c.y + (sdk.botRng() - 0.5) * 30)] }];
  }

  // ------------------------------------------------------------------------------------------
  // Formula
  // ------------------------------------------------------------------------------------------

  const WORD_EXAMPLE = {
    id: "example-fog-words",
    version: 1,
    engine_version: 1,
    title: "Fog Words",
    one_line_rule: "Guess today's San Francisco word in six tries.",
    formula: "guess",
    brief: { intent: "learn the city with your new Group", audience: "group:group-newinsf", mood: ["cozy", "playful"], energy: "low", competition: "light", occasion: "daily" },
    structure: { cadence: "daily", scope: "group:group-newinsf", setter: "ai" },
    lineage: { parent: null, operators: [], remix_of: null },
    chain: null,
    style: { palette: "lilac-haze", mood_preset: "cozy", emoji: "🌫️" },
    concepts: [
      { use: "content.seed", params: { list: "words", into: "target" } },
      { use: "space.word_bubbles" },
      { use: "input.type" },
      { use: "rule.letter_feedback", params: { hint: "first_letter" } },
      { use: "rule.attempt_budget", params: { attempts: 6, show: false } },
      { use: "score.attempts_used" },
      { use: "flow.daily_gate" },
      { use: "feel.bubble_reveal", params: { stagger: 9 } },
      { use: "feel.mood_preset" },
      { use: "share.emoji_grid", params: { set: "weather" } },
    ],
    glue: {},
    content: {
      words: ["FOGGY", "HILLS", "CABLE", "OCEAN", "MURAL"],
      clues: {
        FOGGY: "How most summer mornings look from the Sunset",
        HILLS: "Forty-some of them, and you'll climb every one",
        CABLE: "The kind of car you hang off on Powell Street",
        OCEAN: "The beach at the end of the N line",
        MURAL: "Painted walls all over the Mission",
      },
    },
    seed: 20261112,
  };

  const WHO_EXAMPLE = {
    id: "example-whos-coming",
    version: 1,
    engine_version: 1,
    title: "Who's coming Saturday?",
    one_line_rule: "Read a fact, pick the newcomer it belongs to.",
    formula: "guess",
    brief: { intent: "learn names before the picnic", audience: "event:event-newcomers-picnic", mood: ["warm", "playful"], energy: "low", competition: "light", occasion: "icebreaker" },
    structure: { cadence: "once", scope: "event:event-newcomers-picnic", setter: "ai" },
    lineage: { parent: null, operators: [], remix_of: null },
    chain: null,
    style: { palette: "peach-fizz", mood_preset: "warm", emoji: "🧺" },
    concepts: [
      { use: "space.portrait_choices", params: { choices: 4 } },
      { use: "input.select" },
      { use: "rule.pick_match" },
      { use: "flow.rounds", params: { count: 5, pause: 70 } },
      { use: "score.count", params: { on: "round.correct", points: 100, label: "points" } },
      { use: "feel.mood_preset" },
      { use: "share.emoji_grid", params: { set: "smiles" } },
    ],
    glue: {},
    content: {
      heading: "Who is it?",
      people: [
        { id: "a", name: "Maya Okafor", avatar: "https://randomuser.me/api/portraits/women/44.jpg", facts: ["Runs the Lands End trail every Saturday"] },
        { id: "b", name: "Diego Ramírez", avatar: "https://randomuser.me/api/portraits/men/32.jpg", facts: ["Bakes too much sourdough"] },
        { id: "c", name: "Priya Natarajan", avatar: "https://randomuser.me/api/portraits/women/65.jpg", facts: ["Works night shifts as a nurse"] },
        { id: "d", name: "Lena Fischer", avatar: "https://randomuser.me/api/portraits/women/21.jpg", facts: ["Swims in the cold water at Aquatic Park"] },
        { id: "e", name: "Jordan Brooks", avatar: "https://randomuser.me/api/portraits/men/57.jpg", facts: ["Wants to learn to surf at Ocean Beach"] },
      ],
    },
    seed: 4471,
  };

  B.defineFormula({
    id: "guess",
    title: "Guess",
    // The poster waits for its moment (state.poster_tick: a half-typed guess or the first fact
    // with its portraits); this is the fallback.
    poster_ticks: 240,
    describe: "Work it out from clues. Word style: guess a hidden word on a glowing bubble keyboard; right letters glow into place, letters in the word float nearby, misses pop, and the fog lifts. Who style: read a fact about someone and pick them from portrait bubbles, a few quick rounds. Great for Daily Bubbles and Event icebreakers.",
    core: ["space.word_bubbles|space.portrait_choices", "rule.letter_feedback|rule.pick_match"],
    optional: ["content.seed", "input.type", "input.select", "rule.attempt_budget", "score.attempts_used", "score.count", "flow.daily_gate",
      "flow.rounds", "feel.bubble_reveal", "feel.mood_preset", "feel.sfx_on_action", "share.emoji_grid", "share.score_card", "social.beat_marker", "rule.timer"],
    styles: [
      { id: "word", describe: "Guess a word with letter feedback", concepts: ["space.word_bubbles", "input.type", "rule.letter_feedback", "rule.attempt_budget", "score.attempts_used"] },
      { id: "who", describe: "Who is it? Match facts to people", concepts: ["space.portrait_choices", "input.select", "rule.pick_match", "flow.rounds", "score.count"] },
    ],
    content: {
      describe: "Word style: target (A-Z, 3 to 10 letters) or words (a list content.seed picks from), plus clue or clues {WORD: clue}; dictionary for accept: dictionary. Who style: people [{id, name, avatar, facts: [...]}] (rounds are built with the seed) or rounds [{fact, answer_id, choices: [{id, name, avatar}]}]; optional heading.",
      schema: {
        type: "object",
        properties: {
          target: { type: "string", maxLength: 12 },
          words: { type: "array", items: { type: "string", minLength: 3, maxLength: 12 }, maxItems: 400 },
          dictionary: { type: "array", items: { type: "string", maxLength: 12 }, maxItems: 5000 },
          clue: { type: "string", maxLength: 90 },
          clues: { type: "object" },
          heading: { type: "string", maxLength: 28 },
          people: {
            type: "array", maxItems: 40,
            items: { type: "object", required: ["id", "name", "facts"], properties: { id: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 40 }, avatar: { type: "string", maxLength: 300 }, facts: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", minLength: 3, maxLength: 90 } } } },
          },
          rounds: {
            type: "array", maxItems: 20,
            items: { type: "object", required: ["fact", "answer_id", "choices"], properties: { fact: { type: "string", minLength: 3, maxLength: 90 }, answer_id: { type: "string" }, choices: { type: "array", minItems: 2, maxItems: 6, items: { type: "object", required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string", maxLength: 40 }, avatar: { type: "string", maxLength: 300 } } } } } },
          },
        },
      },
    },
    validateContent(content, manifest) {
      const out = [];
      const uses = (manifest && Array.isArray(manifest.concepts) ? manifest.concepts : []).map((c) => (c && c.use) || "");
      if (uses.indexOf("rule.letter_feedback") >= 0) {
        const target = cleanWord(content.target);
        const words = Array.isArray(content.words) ? content.words : [];
        if (!target && !words.length) out.push({ code: "content", message: "Word style needs content.target or a content.words list", path: "content.target" });
        if (content.target !== undefined && (target.length < 3 || target.length > 10 || target !== String(content.target).toUpperCase().replace(/\s/g, ""))) {
          out.push({ code: "content", message: "content.target must be one word of 3 to 10 letters A-Z", path: "content.target" });
        }
        words.forEach((w, i) => {
          const cw = cleanWord(w);
          if (cw.length < 3 || cw.length > 10 || cw !== String(w).toUpperCase()) out.push({ code: "content", message: "content.words[" + i + "] must be one word of 3 to 10 letters A-Z", path: "content.words[" + i + "]" });
        });
        if (!content.clue && !content.clues) out.push({ code: "content", message: "Add a clue (or clues per word) so the word is guessable and teaches something", path: "content.clue", warning: true });
        if (words.length && !uses.some((u) => u === "content.seed") && !target) out.push({ code: "content", message: "content.words without content.target needs content.seed to pick the word", path: "concepts", warning: true });
      }
      if (uses.indexOf("rule.pick_match") >= 0) {
        const rounds = Array.isArray(content.rounds) ? content.rounds : [];
        const people = Array.isArray(content.people) ? content.people : [];
        if (!rounds.length && people.length < 2) out.push({ code: "content", message: "Who style needs content.people (2 or more, each with facts) or content.rounds", path: "content.people" });
        rounds.forEach((r, i) => {
          if (r && Array.isArray(r.choices) && !r.choices.some((c) => c && c.id === r.answer_id)) {
            out.push({ code: "content", message: "content.rounds[" + i + "].answer_id isn't one of its choices", path: "content.rounds[" + i + "].answer_id" });
          }
        });
        const ids = Object.create(null);
        people.forEach((x, i) => {
          if (!x) return;
          if (ids[x.id]) out.push({ code: "content", message: "Two people share id " + x.id, path: "content.people[" + i + "].id" });
          ids[x.id] = true;
          if (x.avatar && !/^https?:\/\//.test(x.avatar)) out.push({ code: "content", message: "avatar should be an https URL", path: "content.people[" + i + "].avatar", warning: true });
        });
      }
      return out;
    },
    bot: {
      decide(sdk) {
        const mem = sdk.botState;
        if (sdk.state.word) return wordBot(sdk, mem);
        if (sdk.state.round !== undefined) return whoBot(sdk, mem);
        return null;
      },
    },
    share(sdk) {
      const st = sdk.state.word;
      if (st) return { score_text: st.solved ? "Solved in " + st.guesses.length : "Found " + st.slots.filter((s) => s !== null).length + " of " + st.length + " letters" };
      const r = sdk.state.rounds;
      if (r) return { score_text: "Knew " + r.won + " of " + r.total };
      return null;
    },
    tips: [
      "Word style: a clue per word makes it learnable; hint: first_letter makes long words friendlier. Never reveal the word in the share.",
      "Who style: give 5 to 8 people with one or two short facts each, written as \"Runs the Lands End trail every Saturday\".",
      "A daily word uses content.seed + flow.daily_gate; an icebreaker uses flow.rounds (count 5 or 6).",
      "The feedback glue gets (guess, target, {tries}) and returns one of hit/near/miss per letter.",
    ],
    example: WORD_EXAMPLE,
    examples: [WORD_EXAMPLE, WHO_EXAMPLE],
    // Length (docs/BUBBLES.md 7.9): word style tries or who style facts, from the manifest.
    length: {
      modes: ["rounds", "timed", "lives"],
      default: { mode: "rounds" },
      numbers: { rounds: 6, seconds: 90, lives: 5 },
      infer: { rounds: ["rule.attempt_budget.attempts"] },
      knobs: {
        difficulty: { concept: "space.portrait_choices", param: "choices", label: "Faces to pick from", min: 2, max: 4, step: 1 },
        speed: { concept: "flow.rounds", param: "pause", label: "Pace", min: 50, max: 130, invert: true },
      },
      describe: "Rounds: tries (word) or facts (who). Timed: find it before the clock. Lives: wrong tries you can take.",
    },
  });
})();
