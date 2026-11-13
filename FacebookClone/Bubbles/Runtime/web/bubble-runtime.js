/*
 * bubble-runtime.js: the Bubble runtime.
 *
 * One persistent engine that runs lightweight game definitions (manifests). Contract:
 * docs/BUBBLES.md sections 4.3 (API), 4.6 (kits, concepts, SDK, Glow graphics) and 4.8 (speed).
 *
 *   1. Constants and utilities         5. Headless API (catalog, validate, simulate)
 *   2. Registry (formulas, concepts)   6. Glow graphics (sprite atlas, `g`)
 *   3. Validation                      7. Sound (synthesized WebAudio)
 *   4. Engine (session, run, SDK)      8. Host (BubbleHost: prepare, activate, poster, evict, command)
 *
 * Loads without a DOM (JavaScriptCore, Node): only sections 6 to 8 touch document/window, and only
 * when BubbleHost is used. Game logic is deterministic: fixed 60 Hz ticks, seeded RNG, pointer-only
 * input log, so a seed plus the log reproduces a run exactly.
 *
 * SDK additions beyond the doc table (all optional to use):
 *   sdk.palette, sdk.Z, sdk.range(a, b), sdk.chance(p), sdk.clamp, sdk.lerp, sdk.botSkill,
 *   sdk.botState, sdk.feel {ambient, particles, shake, sound, tempo}, sdk.hud.retry, sdk.hud.note,
 *   sdk.preload(url), sdk.log(msg), sdk.ended, sdk.off(type, fn), fx.sparkle(x, y, color, n),
 *   fx.ring(x, y, r, color).
 * Graphics additions: g.view, g.px, g.reduced, g.poster, g.halo, g.puff, g.spark, g.ring, g.circle,
 *   g.line, g.glowRect, g.rgba, g.mix, g.ease, g.spring, g.wrapText; g.bubble also takes sx, sy, emoji;
 *   g.pill also takes shade, glowColor, strokeWidth; g.palette also has good, near, mid, soft.
 * Concept definition additions: ends (can end the run), order (setup order), check(manifest, params)
 *   (extra validation), consumes entries ending in "?" (optional listens), params with event: true
 *   (the value names an event the concept consumes).
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------------------------
  // 1. Constants and utilities
  // ---------------------------------------------------------------------------------------------

  const VERSION = "1.0.0";
  const ENGINE_VERSION = 1;
  const W = 360;
  const H = 640;
  const TICK_RATE = 60;
  const DT = 1 / TICK_RATE;
  const MAX_EMIT_DEPTH = 16;
  const DEFAULT_MAX_TICKS = 5400;
  const HARD_MAX_TICKS = TICK_RATE * 60 * 10;
  const DEFAULT_BOT_SKILL = 0.7;
  const DEMO_BOT_SKILL = 0.86;
  // Posters: the demo bot plays to state.poster_tick (set by a kit), else to the formula's
  // poster_ticks, else POSTER_TICKS; never past POSTER_MAX_TICKS.
  const POSTER_TICKS = 90;
  const POSTER_MAX_TICKS = 600;

  const KINDS = ["input", "space", "entity", "behavior", "rule", "feedback", "score", "flow", "content", "share", "social", "feel"];
  const KIND_ORDER = { content: 0, input: 10, space: 20, behavior: 30, entity: 40, rule: 50, feedback: 55, score: 60, flow: 70, social: 75, share: 80, feel: 90 };
  const ENGINE_EVENTS = ["clock.tick", "pointer.down", "pointer.move", "pointer.up", "flow.phase", "score.changed"];
  const PHASES = ["intro", "playing", "fail", "success", "result"];
  const SOUNDS = ["pop", "blip", "tick", "chime", "whoosh", "success", "fail"];
  const HAPTICS = ["light", "medium", "selection", "success", "warning"];
  const Z = { background: 0, space: 10, entities: 20, effects: 30, hud: 40 };
  const PARAM_TYPES = ["number", "integer", "boolean", "string", "enum", "string_list"];
  // Length (docs/BUBBLES.md 7.9): how a run ends. Manifest `length` {mode, rounds, seconds, lives};
  // a formula declares `length: {modes, default, knobs}`. Owner: the length feature, which fills in
  // the engine side (lengthRound/lengthMiss/lengthLeft, timed endings, the HUD) and validation.
  const LENGTH_MODES = ["endless", "rounds", "timed", "lives"];
  // The number each mode reads, its allowed range, and the number a locked length uses when it
  // names a mode but no number (and the formula's default is another mode).
  const LENGTH_KEYS = { rounds: "rounds", timed: "seconds", lives: "lives" };
  const LENGTH_LIMITS = { rounds: [1, 50], seconds: [10, 300], lives: [1, 9] };
  const LENGTH_FALLBACK = { rounds: 10, seconds: 60, lives: 3 };
  const LENGTH_KNOBS = ["speed", "difficulty", "lives", "rounds", "timer"];

  const GLUE_SLOTS = {
    feedback: "function feedback(guess, target, info) -> one mark per letter: \"hit\" (right spot), \"near\" (in the word) or \"miss\". Used by letter-feedback rules.",
    spawn: "function spawn(info) -> an object of overrides for the next spawned thing (each concept documents its fields, e.g. {gap_y, gap_h, label}). Return null to keep the default.",
    score: "function score(run) -> points to add for one scoring event. run = {base, count, streak, time, tick, score, ...the event's fields}.",
    transform: "function transform(value, info) -> a changed value. Concepts that call it document what they pass.",
    constraint: "function constraint(info) -> true to allow the action, false to block it. Concepts that call it document what they pass.",
  };
  // Glue may not mention these (docs/BUBBLES.md 4.6), plus hardening additions.
  const GLUE_FORBIDDEN = ["window", "document", "globalThis", "self", "fetch", "XMLHttpRequest", "WebSocket", "import", "require", "eval",
    "Function", "setTimeout", "setInterval", "Date", "webkit", "localStorage"];
  const GLUE_FORBIDDEN_EXTRA = ["constructor", "__proto__", "prototype", "Reflect", "Proxy", "process", "postMessage", "performance",
    "crypto", "navigator", "location", "sessionStorage", "indexedDB", "Worker", "requestAnimationFrame", "queueMicrotask",
    "WebAssembly", "Atomics", "SharedArrayBuffer", "Promise", "async", "await", "globalThis", "setImmediate"];
  const GLUE_MAX_LENGTH = 4000;
  const GLUE_LOOP_LIMIT = 200000;

  const hasDOM = typeof document !== "undefined" && typeof window !== "undefined";

  function nowMs() {
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") return performance.now();
    return Date.now();
  }

  const loggedOnce = Object.create(null);
  function log(message) {
    try {
      if (typeof console !== "undefined" && console && typeof console.log === "function") console.log("[bubble] " + message);
    } catch (e) { /* no console */ }
  }
  function logOnce(key, message) {
    if (loggedOnce[key]) return;
    loggedOnce[key] = true;
    log(message);
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function round1(v) { return Math.round(v * 10) / 10; }
  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function arr(v) { return Array.isArray(v) ? v.slice() : []; }
  function parseMaybe(v) { return typeof v === "string" ? JSON.parse(v) : v; }
  function deepCopy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function deepFreeze(o) {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      const keys = Object.keys(o);
      for (let i = 0; i < keys.length; i++) deepFreeze(o[keys[i]]);
    }
    return o;
  }
  function errMessage(e) {
    if (!e) return "Unknown error";
    if (typeof e === "string") return e;
    return e.message ? String(e.message) : String(e);
  }

  // FNV-1a, for deterministic content picks and cosmetic hashing.
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  function seedToU32(seed) {
    if (typeof seed === "string") return hashString(seed);
    let n = Number(seed);
    if (!isFinite(n)) n = 1;
    n = Math.floor(Math.abs(n));
    const lo = n % 4294967296;
    const hi = Math.floor(n / 4294967296) % 4294967296;
    return (lo ^ Math.imul(hi, 0x9e3779b1)) >>> 0;
  }
  function splitmix32(a) {
    return function () {
      a = (a + 0x9e3779b9) | 0;
      let t = a ^ (a >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      return (t ^ (t >>> 15)) >>> 0;
    };
  }
  // sfc32: small, fast, identical in every JavaScript engine (integer math only).
  function makeRng(seed) {
    const sm = splitmix32(seedToU32(seed));
    let a = sm(), b = sm(), c = sm(), d = sm();
    function next() {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    }
    for (let i = 0; i < 12; i++) next();
    return next;
  }
  function rngInt(next, a, b) {
    a = Math.ceil(a);
    b = Math.floor(b);
    if (b < a) { const t = a; a = b; b = t; }
    return a + Math.floor(next() * (b - a + 1));
  }
  function rngPick(next, list) {
    return list && list.length ? list[Math.floor(next() * list.length)] : undefined;
  }
  function rngShuffle(next, list) {
    const out = list ? Array.prototype.slice.call(list) : [];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  // Edit distance, for "did you mean" hints in validation messages.
  function editDistance(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }
  function closest(name, candidates) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const d = editDistance(name, candidates[i]);
      if (d < bestD) { bestD = d; best = candidates[i]; }
    }
    return best && bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
  }

  // Palettes: identical hex values in BubbleGlow.swift and bubble-glow.css (docs/BUBBLES.md 2).
  // good / near: the accents each palette uses for "right" and "close"; danger: hazards and alarms.
  const PALETTES = {
    "lilac-haze": { top: "#C9B8FF", bottom: "#E6EEFF", ink: "#2E1F5E", glow: "#FFFFFF", accents: ["#9EF0DA", "#FFE59A", "#9AD4FF", "#B8A6FF"], dark: false, good: "#9EF0DA", near: "#FFE59A", danger: "#FF5C8A" },
    "peach-fizz": { top: "#FFC2B0", bottom: "#FFE7A8", ink: "#4D2238", glow: "#FFF6E8", accents: ["#FF8FB8", "#8FD6FF", "#B8F2A6", "#C9A8FF"], dark: false, good: "#B8F2A6", near: "#8FD6FF", danger: "#F2526B" },
    "mint-pop": { top: "#A6F2DC", bottom: "#B3CCFF", ink: "#123B4D", glow: "#F2FFFB", accents: ["#FF9ECB", "#FFE48F", "#C9A8FF", "#8FE3FF"], dark: false, good: "#8FE3FF", near: "#FFE48F", danger: "#FF5F87" },
    "sky-glow": { top: "#ADD8FF", bottom: "#DCC8FF", ink: "#1F2B66", glow: "#F4F8FF", accents: ["#FFB0D9", "#A6F2DC", "#FFE59A", "#9AB8FF"], dark: false, good: "#A6F2DC", near: "#FFE59A", danger: "#FF5F87" },
    "night-bloom": { top: "#2B2150", bottom: "#5A3577", ink: "#FFF3FF", glow: "#FFD9F5", accents: ["#FF9DE2", "#9DF2FF", "#FFE59D", "#B9A2FF"], dark: true, good: "#9DF2FF", near: "#FFE59D", danger: "#FF6F9A" },
  };
  const IRIDESCENT = ["#ADD8FF", "#B8BFFF", "#C9B2FF", "#E6EEFF", "#9AD4FF", "#ADD8FF"];
  const BRAND = ["#ADD8FF", "#B8BFFF", "#C9B2FF"];

  // Looks (LOOKS.md): render families. Every Bubble gets its own look inside the same Bubble frame.
  // Rendering only: a look never changes logic, timing or game randomness.
  const LOOKS = {
    glow: {
      title: "Glow", font: "rounded", motif: "none",
      describe: "Dreamy and soft: pastel gradients, iridescent soap bubbles with halos, rounded glowing type, floating ambient bubbles.",
      moods: ["dreamy", "calm", "chill", "cozy"], energy: ["low", "medium"], fonts: ["rounded"], motifs: ["none", "clouds", "waves", "hills"],
      example_colors: { bg_top: "#C9B8FF", bg_bottom: "#E6EEFF", ink: "#2E1F5E", primary: "#9EF0DA", secondary: "#FFE59A", accent: "#9AD4FF", danger: "#FF5C8A" },
    },
    paper: {
      title: "Paper", font: "rounded", motif: "none",
      describe: "Crafty and warm: paper cutouts with flat fills, slightly irregular edges and offset drop shadows on grainy paper; confetti scraps.",
      moods: ["cozy", "warm", "playful", "crafty"], energy: ["low", "medium"], fonts: ["rounded", "serif"], motifs: ["hills", "leaves", "clouds", "dots", "city"],
      example_colors: { bg_top: "#F7E9D4", bg_bottom: "#F1D9BC", ink: "#3B2A20", primary: "#E8664A", secondary: "#3F9C8A", accent: "#F2B33D", danger: "#C63D3D" },
    },
    pixel: {
      title: "Pixel", font: "pixel", motif: "clouds",
      describe: "Retro arcade: a chunky low-res buffer drawn with nearest-neighbor pixels, a dithered sky, 1 px outlines and a pixel font.",
      moods: ["playful", "hype", "funny", "retro"], energy: ["medium", "high"], fonts: ["pixel", "mono"], motifs: ["clouds", "hills", "city", "stars", "grid"],
      example_colors: { bg_top: "#5D8BF4", bg_bottom: "#A9D6FF", ink: "#14182E", primary: "#FFD93D", secondary: "#FF6B6B", accent: "#6BCB77", danger: "#E23E57" },
    },
    neon: {
      title: "Neon", font: "condensed", motif: "grid",
      describe: "Night and electric: near-black backgrounds, glowing outline strokes with bloom, a synthwave grid, skyline or stars; sparks and streaks.",
      moods: ["hype", "focused", "night", "energetic"], energy: ["high", "medium"], fonts: ["condensed", "mono"], motifs: ["grid", "city", "stars", "waves", "hills"],
      example_colors: { bg_top: "#0A0620", bg_bottom: "#1B0B38", ink: "#F6F0FF", primary: "#FF4FD8", secondary: "#38F2FF", accent: "#FFE84A", danger: "#FF3D6E" },
    },
    ink: {
      title: "Ink", font: "hand", motif: "none",
      describe: "Hand-drawn and whimsical: wobbly ink outlines with watercolor washes and light hatching on off-white paper; scribbles.",
      moods: ["whimsical", "calm", "funny", "thoughtful"], energy: ["low", "medium"], fonts: ["hand", "serif"], motifs: ["clouds", "hills", "leaves", "waves", "city"],
      example_colors: { bg_top: "#FBF8F1", bg_bottom: "#F3ECDD", ink: "#24212B", primary: "#3E7CB1", secondary: "#E07A5F", accent: "#E9B949", danger: "#C8553D" },
    },
    clay: {
      title: "Clay", font: "rounded", motif: "none",
      describe: "Toy-like and chunky: soft 3D shapes with radial shading, a specular dot and a contact shadow in a soft studio with a vignette.",
      moods: ["cute", "playful", "cozy", "funny"], energy: ["low", "medium", "high"], fonts: ["rounded"], motifs: ["hills", "clouds", "dots", "city"],
      example_colors: { bg_top: "#FFE6D6", bg_bottom: "#FFCDB8", ink: "#3D2430", primary: "#FF8A65", secondary: "#6CC4E0", accent: "#FFC94D", danger: "#E5484D" },
    },
    riso: {
      title: "Riso", font: "condensed", motif: "dots",
      describe: "Zine and print: two or three spot inks with halftone fills and slight misregistration on cream paper with grain.",
      moods: ["graphic", "bold", "funny", "indie"], energy: ["medium", "high"], fonts: ["condensed", "serif"], motifs: ["dots", "waves", "city", "grid"],
      example_colors: { bg_top: "#F5EFE0", bg_bottom: "#EFE5CF", ink: "#1D2748", primary: "#FF48B0", secondary: "#0078BF", accent: "#FFE800", danger: "#FF665E" },
    },
    chalk: {
      title: "Chalk", font: "hand", motif: "none",
      describe: "Brainy and calm: a dark slate with smudges, chalky textured strokes, rough fills and chalk dust.",
      moods: ["brainy", "calm", "focused", "school"], energy: ["low", "medium"], fonts: ["hand", "rounded"], motifs: ["none", "grid", "stars"],
      example_colors: { bg_top: "#2F3D3A", bg_bottom: "#243230", ink: "#F3F0E6", primary: "#FFD6A5", secondary: "#9BE3DE", accent: "#FFADAD", danger: "#FF8B8B" },
    },
  };
  const LOOK_IDS = Object.keys(LOOKS);
  // System and web-safe font stacks only (no font files). Canvas text in the pixel font uses a
  // built-in bitmap face; the DOM frame falls back to the mono stack.
  const FONTS = {
    rounded: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", system-ui, -apple-system, "Helvetica Neue", sans-serif',
    serif: 'ui-serif, "New York", "Iowan Old Style", Palatino, Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Monaco, "Courier New", monospace',
    hand: '"Marker Felt", "Chalkboard SE", "Bradley Hand", "Comic Sans MS", "Segoe Print", cursive',
    condensed: '"Avenir Next Condensed", "Helvetica Neue", "Arial Narrow", "Roboto Condensed", sans-serif',
    pixel: 'ui-monospace, "SF Mono", Menlo, Monaco, "Courier New", monospace',
  };
  const FONT_IDS = Object.keys(FONTS);
  const MOTIFS = ["hills", "waves", "city", "stars", "clouds", "grid", "dots", "leaves", "none"];
  const COLOR_ROLES = ["bg_top", "bg_bottom", "ink", "primary", "secondary", "accent", "danger"];

  function hexToRgb(hex) {
    let h = String(hex || "#000000").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16);
    if (!isFinite(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function toHex(r, g, b) {
    const s = ((1 << 24) | (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255)).toString(16);
    return "#" + s.slice(1).toUpperCase();
  }
  function isHex(v) { return typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v.trim()); }
  const colorCache = new Map();
  function mixHex(a, b, t) {
    const key = "m" + a + b + t;
    let v = colorCache.get(key);
    if (v === undefined) {
      const x = hexToRgb(a), y = hexToRgb(b);
      v = toHex(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t));
      if (colorCache.size > 4000) colorCache.clear();
      colorCache.set(key, v);
    }
    return v;
  }
  function rgba(hex, alpha) {
    const a = Math.round(clamp(alpha, 0, 1) * 1000) / 1000;
    const key = "r" + hex + a;
    let v = colorCache.get(key);
    if (v === undefined) {
      const c = hexToRgb(hex);
      v = "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
      if (colorCache.size > 4000) colorCache.clear();
      colorCache.set(key, v);
    }
    return v;
  }
  // WCAG relative luminance and contrast ratio.
  function relLum(hex) {
    const c = hexToRgb(hex);
    let out = 0;
    const wts = [0.2126, 0.7152, 0.0722];
    for (let i = 0; i < 3; i++) {
      const v = c[i] / 255;
      out += wts[i] * (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    }
    return out;
  }
  function contrastRatio(a, b) {
    const x = relLum(a), y = relLum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  // Perceptual-ish RGB distance (the "redmean" approximation; 0 to about 765). Hue differences
  // count, so a yellow on cream stands out even when their luminance is close.
  function colorDistance(a, b) {
    const A = hexToRgb(a), C = hexToRgb(b), r = (A[0] + C[0]) / 2;
    const dR = A[0] - C[0], dG = A[1] - C[1], dB = A[2] - C[2];
    return Math.sqrt((2 + r / 256) * dR * dR + 4 * dG * dG + (2 + (255 - r) / 256) * dB * dB);
  }

  function toHsl(hex) {
    const c = hexToRgb(hex).map((v) => v / 255);
    const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
    const l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn;
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h;
    if (mx === c[0]) h = (c[1] - c[2]) / d + (c[1] < c[2] ? 6 : 0);
    else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
    else h = (c[0] - c[1]) / d + 4;
    return [h * 60, s, l];
  }
  function fromHsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) return toHex(l * 255, l * 255, l * 255);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => {
      t = (t + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return toHex(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255);
  }
  // Perceived lightness the way BubbleGlow.swift measures it (isDark: average below 0.45).
  function swiftLum(hex) { const c = hexToRgb(hex); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }

  // Look adaptations for preset palettes (custom colors are used exactly as given).
  const RISO_INKS = [["#FF48B0", 330], ["#0078BF", 203], ["#FFE800", 54], ["#00A95C", 152], ["#FF6C2F", 20], ["#765BA7", 262], ["#00838A", 184], ["#FF665E", 3]];
  function neonize(hex) { const h = toHsl(hex); return fromHsl(h[0], Math.max(0.88, h[1]), clamp(h[2], 0.6, 0.66)); }
  function risoInk(hex, used) {
    const h = toHsl(hex)[0];
    let best = RISO_INKS[0][0], bestD = 999;
    for (const ink of RISO_INKS) {
      if (used && used.indexOf(ink[0]) >= 0) continue;
      const d = Math.min(Math.abs(ink[1] - h), 360 - Math.abs(ink[1] - h));
      if (d < bestD) { bestD = d; best = ink[0]; }
    }
    if (used) used.push(best);
    return best;
  }
  function chalkTone(hex) { const h = toHsl(hex); return fromHsl(h[0], clamp(h[1], 0.45, 0.85), clamp(h[2], 0.76, 0.86)); }
  function washTone(hex, ink) { const h = toHsl(hex); return mixHex(fromHsl(h[0], clamp(h[1] * 1.1, 0.35, 0.8), clamp(h[2] * 0.82, 0.42, 0.66)), ink, 0.08); }

  function adaptPreset(look, r) {
    const roles = ["primary", "secondary", "accent", "danger", "good", "near"];
    const out = Object.assign({}, r, { accents: r.accents.slice() });
    const each = (fn) => { for (const k of roles) out[k] = fn(r[k]); out.accents = r.accents.map(fn); };
    if (look === "neon") {
      out.bgTop = mixHex(r.bgTop, "#05020D", r.dark ? 0.62 : 0.88);
      out.bgBottom = mixHex(r.bgBottom, "#0B0420", r.dark ? 0.55 : 0.84);
      out.ink = "#F7F2FF";
      out.glow = neonize(r.accents[0]);
      each(neonize);
    } else if (look === "ink") {
      out.bgTop = mixHex("#FBF8F1", r.bgTop, 0.08);
      out.bgBottom = mixHex("#F4EEE1", r.bgBottom, 0.1);
      out.ink = "#24212B";
      out.glow = "#FFFFFF";
      each((c) => washTone(c, "#24212B"));
    } else if (look === "riso") {
      out.bgTop = mixHex("#F5EFE0", r.bgTop, 0.06);
      out.bgBottom = mixHex("#EFE5CF", r.bgBottom, 0.06);
      out.ink = "#1D2748";
      out.glow = "#FFFFFF";
      const used = [];
      out.primary = risoInk(r.primary, used);
      out.secondary = risoInk(r.secondary, used);
      out.accent = risoInk(r.accent, used);
      out.danger = "#FF665E";
      out.good = out.secondary;
      out.near = out.accent;
      out.accents = [out.primary, out.secondary, out.accent, risoInk(r.accents[3], used)];
    } else if (look === "chalk") {
      out.bgTop = mixHex("#2F3D3A", r.bgTop, 0.06);
      out.bgBottom = mixHex("#243230", r.bgBottom, 0.06);
      out.ink = "#F3F0E6";
      out.glow = "#F3F0E6";
      each(chalkTone);
    }
    return out;
  }

  // Resolves a manifest's style into palette roles (LOOKS.md): bgTop, bgBottom, ink, primary,
  // secondary, accent, danger, accents, plus helpers the looks use (surface, line, shadow, inkOn).
  function buildPalette(style, look) {
    const s = isObj(style) ? style : {};
    const presetId = PALETTES[s.palette] ? s.palette : "lilac-haze";
    const p = PALETTES[presetId];
    const c = isObj(s.colors) ? s.colors : null;
    const custom = !!(c && isHex(c.bg_top) && isHex(c.bg_bottom));
    let r;
    if (custom) {
      const pick = (k, fb) => (isHex(c[k]) ? c[k].trim().toUpperCase() : fb);
      r = {
        id: "custom", bgTop: pick("bg_top"), bgBottom: pick("bg_bottom"), ink: pick("ink", p.ink), glow: "#FFFFFF",
        primary: pick("primary", p.accents[0]), secondary: pick("secondary", p.accents[1]), accent: pick("accent", p.accents[2]), danger: pick("danger", p.danger),
      };
      r.accents = [r.primary, r.secondary, r.accent, r.danger];
      r.good = r.primary;
      r.near = r.accent;
    } else {
      r = {
        id: presetId, bgTop: p.top, bgBottom: p.bottom, ink: p.ink, glow: p.glow,
        primary: p.accents[0], secondary: p.accents[1], accent: p.accents[2], danger: p.danger,
        accents: p.accents.slice(), good: p.good, near: p.near, dark: p.dark,
      };
      r = adaptPreset(look, r);
    }
    const dark = (swiftLum(r.bgTop) + swiftLum(r.bgBottom)) / 2 < 0.45;
    const ink = r.ink;
    const bgMid = mixHex(r.bgTop, r.bgBottom, 0.5);
    let surface, surfaceStrong, line;
    switch (look) {
      case "paper": surface = dark ? mixHex(bgMid, "#FFFFFF", 0.16) : mixHex(r.bgBottom, "#FFFFFF", 0.72); surfaceStrong = dark ? mixHex(bgMid, "#FFFFFF", 0.24) : "#FFFDF8"; line = rgba(dark ? "#000000" : ink, 0.16); break;
      case "pixel": surface = dark ? mixHex(bgMid, "#FFFFFF", 0.16) : mixHex(r.bgBottom, "#FFFFFF", 0.68); surfaceStrong = dark ? mixHex(bgMid, "#FFFFFF", 0.26) : "#FFFFFF"; line = mixHex(ink, bgMid, dark ? 0.55 : 0.15); break;
      case "neon": surface = rgba(mixHex(r.bgTop, "#000000", 0.35), 0.78); surfaceStrong = rgba(mixHex(r.bgTop, "#000000", 0.2), 0.88); line = r.primary; break;
      case "ink": surface = dark ? mixHex(bgMid, "#FFFFFF", 0.14) : "#FFFDF9"; surfaceStrong = dark ? mixHex(bgMid, "#FFFFFF", 0.2) : "#FFFFFF"; line = ink; break;
      case "clay": surface = dark ? mixHex(bgMid, "#FFFFFF", 0.18) : mixHex(r.bgBottom, "#FFFFFF", 0.62); surfaceStrong = dark ? mixHex(bgMid, "#FFFFFF", 0.26) : mixHex(r.bgBottom, "#FFFFFF", 0.82); line = rgba("#FFFFFF", 0.6); break;
      case "riso": surface = mixHex(r.bgTop, "#FFFFFF", 0.45); surfaceStrong = "#FFFDF6"; line = ink; break;
      case "chalk": surface = rgba("#FFFFFF", 0.07); surfaceStrong = rgba("#FFFFFF", 0.12); line = rgba(ink, 0.75); break;
      default: surface = dark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.6)"; surfaceStrong = dark ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.82)"; line = dark ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.95)"; break;
    }
    const darkInk = dark ? mixHex(r.bgTop, "#000000", 0.55) : ink;
    const inkCache = new Map();
    function inkOn(fill) {
      if (!isHex(fill)) return ink;
      let v = inkCache.get(fill);
      if (v) return v;
      const cands = [ink, darkInk, "#FFFFFF", "#1C1830"];
      v = cands[0];
      let best = contrastRatio(fill, v);
      // The look's ink wins whenever it reads (4.5:1); otherwise the clearly better candidate.
      if (best < 4.5) for (let i = 1; i < cands.length; i++) { const cr = contrastRatio(fill, cands[i]); if (cr > best + 0.6) { best = cr; v = cands[i]; } }
      inkCache.set(fill, v);
      return v;
    }
    return Object.freeze({
      id: r.id, look,
      bgTop: r.bgTop, bgBottom: r.bgBottom, ink, primary: r.primary, secondary: r.secondary, accent: r.accent, danger: r.danger,
      accents: Object.freeze(r.accents.slice(0, 4)),
      // helpers and back-compat names
      top: r.bgTop, bottom: r.bgBottom, glow: r.glow, dark, good: r.good, near: r.near,
      mid: bgMid, soft: dark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.55)",
      surface, surfaceStrong, line, shadow: dark ? "#000000" : mixHex(ink, r.bgBottom, 0.3),
      // mist: the color for fog, clouds and smoke in this look.
      mist: look === "glow" ? mixHex(dark ? r.glow : "#FFFFFF", r.bgTop, 0.1) : look === "neon" ? r.secondary : look === "chalk" ? ink : isHex(surfaceStrong) ? surfaceStrong : "#FFFFFF",
      inkOn,
    });
  }

  const styleCache = new Map();
  // {look, font, fontStack, motif, palette}: what a manifest's style resolves to (cached).
  function resolveStyle(style) {
    const s = isObj(style) ? style : {};
    const key = JSON.stringify([s.look, s.palette, s.colors, s.font, s.motif]);
    let out = styleCache.get(key);
    if (out) return out;
    const look = LOOKS[s.look] ? s.look : "glow";
    const meta = LOOKS[look];
    const font = FONTS[s.font] ? s.font : meta.font;
    const motif = MOTIFS.indexOf(s.motif) >= 0 ? s.motif : meta.motif;
    out = Object.freeze({ look, font, fontStack: FONTS[font], motif, motifSet: MOTIFS.indexOf(s.motif) >= 0, palette: buildPalette(s, look) });
    if (styleCache.size > 64) styleCache.clear();
    styleCache.set(key, out);
    return out;
  }
  // Bubble.palette(id or style): a preset id gives that preset in the glow look.
  function paletteFor(arg) {
    if (isObj(arg)) return resolveStyle(arg).palette;
    return resolveStyle({ palette: arg }).palette;
  }

  // Springy easing (cosmetic only).
  const ease = {
    out(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); },
    inOut(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    back(t) { t = clamp(t, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    spring(t) { t = clamp(t, 0, 1); return 1 - Math.cos(t * Math.PI * 2.6) * Math.exp(-t * 6.2); },
  };

  // ---------------------------------------------------------------------------------------------
  // 2. Registry
  // ---------------------------------------------------------------------------------------------

  const formulas = Object.create(null);
  const concepts = Object.create(null);
  const formulaOrder = [];
  const conceptOrder = [];
  const loadWarnings = [];

  function loadWarning(message) {
    loadWarnings.push(message);
    log(message);
  }

  function checkParamValue(spec, value) {
    // Returns null when fine, or {code, message}.
    switch (spec.type) {
      case "number":
      case "integer":
        if (typeof value !== "number" || !isFinite(value)) return { code: "param_type", message: "must be a " + spec.type };
        if (spec.type === "integer" && Math.floor(value) !== value) return { code: "param_type", message: "must be a whole number" };
        if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) {
          return { code: "param_range", message: "must be between " + spec.min + " and " + spec.max + " (got " + value + ")" };
        }
        return null;
      case "boolean":
        return typeof value === "boolean" ? null : { code: "param_type", message: "must be true or false" };
      case "string":
        if (typeof value !== "string") return { code: "param_type", message: "must be a string" };
        if (spec.max_length !== undefined && value.length > spec.max_length) return { code: "param_range", message: "must be at most " + spec.max_length + " characters" };
        return null;
      case "enum":
        if (typeof value !== "string") return { code: "param_type", message: "must be one of " + spec.values.join(", ") };
        if (spec.values.indexOf(value) < 0) return { code: "param_range", message: "must be one of " + spec.values.join(", ") + " (got \"" + value + "\")" };
        return null;
      case "string_list":
        if (!Array.isArray(value) || value.some((s) => typeof s !== "string")) return { code: "param_type", message: "must be a list of strings" };
        if (spec.max_items !== undefined && value.length > spec.max_items) return { code: "param_range", message: "must have at most " + spec.max_items + " items" };
        if (spec.max_length !== undefined && value.some((s) => s.length > spec.max_length)) return { code: "param_range", message: "items must be at most " + spec.max_length + " characters" };
        return null;
      default:
        return { code: "param_type", message: "has an unknown type" };
    }
  }

  function normalizeParamSpec(conceptID, name, spec) {
    if (!isObj(spec) || PARAM_TYPES.indexOf(spec.type) < 0) {
      loadWarning("Concept " + conceptID + ": param \"" + name + "\" needs a type (" + PARAM_TYPES.join(", ") + ")");
      return null;
    }
    const out = { type: spec.type, describe: spec.describe || "" };
    if (spec.type === "number" || spec.type === "integer") {
      out.min = typeof spec.min === "number" ? spec.min : -1e9;
      out.max = typeof spec.max === "number" ? spec.max : 1e9;
    }
    if (spec.type === "string" || spec.type === "string_list") out.max_length = typeof spec.max_length === "number" ? spec.max_length : 80;
    if (spec.type === "string_list") out.max_items = typeof spec.max_items === "number" ? spec.max_items : 20;
    if (spec.type === "enum") out.values = Array.isArray(spec.values) ? spec.values.slice() : [];
    if (spec.event) out.event = true;
    if (spec.unit) out.unit = spec.unit;
    let def = spec.default;
    if (def === undefined) {
      def = spec.type === "boolean" ? false : spec.type === "string" ? "" : spec.type === "string_list" ? [] :
        spec.type === "enum" ? out.values[0] : clamp(0, out.min, out.max);
    }
    const bad = checkParamValue(out, def);
    if (bad) loadWarning("Concept " + conceptID + ": default of param \"" + name + "\" " + bad.message);
    out.default = def;
    return out;
  }

  function defineFormula(def) {
    if (!isObj(def) || typeof def.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(def.id)) {
      loadWarning("defineFormula: a formula needs a lowercase id");
      return null;
    }
    if (formulas[def.id]) {
      loadWarning("defineFormula: formula \"" + def.id + "\" is already defined; keeping the first definition");
      return formulas[def.id];
    }
    const content = isObj(def.content) ? def.content : {};
    const f = {
      id: def.id,
      title: def.title || def.id,
      describe: def.describe || "",
      core: arr(def.core),
      optional: arr(def.optional),
      content: { describe: content.describe || "", schema: isObj(content.schema) ? content.schema : { type: "object" } },
      validateContent: typeof def.validateContent === "function" ? def.validateContent : null,
      bot: def.bot && typeof def.bot.decide === "function" ? def.bot : null,
      share: typeof def.share === "function" ? def.share : null,
      example: isObj(def.example) ? def.example : null,
      examples: arr(def.examples),
      styles: arr(def.styles),
      tags: isObj(def.tags) ? def.tags : {},
      tips: arr(def.tips),
      poster_ticks: typeof def.poster_ticks === "number" && isFinite(def.poster_ticks) ? clamp(Math.floor(def.poster_ticks), 0, POSTER_MAX_TICKS) : POSTER_TICKS,
      // {modes: [...LENGTH_MODES], default: {mode, rounds, seconds, lives}, knobs: {id: {concept, param, label}}}
      length: isObj(def.length) ? def.length : null,
    };
    formulas[f.id] = f;
    formulaOrder.push(f.id);
    return f;
  }

  function defineConcept(def) {
    if (!isObj(def) || typeof def.id !== "string" || !/^[a-z]+\.[a-z0-9_]+$/.test(def.id)) {
      loadWarning("defineConcept: concept ids look like <kind>.<name> (got " + (def && def.id) + ")");
      return null;
    }
    const kind = def.id.split(".")[0];
    if (KINDS.indexOf(kind) < 0) {
      loadWarning("defineConcept: unknown kind \"" + kind + "\" for " + def.id + " (kinds: " + KINDS.join(", ") + ")");
      return null;
    }
    if (def.kind && def.kind !== kind) loadWarning("defineConcept: " + def.id + " says kind \"" + def.kind + "\" but its id says \"" + kind + "\"; using \"" + kind + "\"");
    if (concepts[def.id]) {
      loadWarning("defineConcept: concept \"" + def.id + "\" is already defined; keeping the first definition. Common concepts live in bubble-kit-common.js: reuse them instead of redefining.");
      return concepts[def.id];
    }
    const params = {};
    if (isObj(def.params)) {
      for (const name of Object.keys(def.params)) {
        const spec = normalizeParamSpec(def.id, name, def.params[name]);
        if (spec) params[name] = spec;
      }
    }
    const c = {
      id: def.id,
      kind,
      version: typeof def.version === "number" ? def.version : 1,
      formulas: Array.isArray(def.formulas) && def.formulas.length ? def.formulas.slice() : ["*"],
      describe: def.describe || "",
      examples: arr(def.examples),
      params,
      consumes: arr(def.consumes),
      emits: arr(def.emits),
      requires: arr(def.requires),
      conflicts: arr(def.conflicts),
      tags: isObj(def.tags) ? def.tags : {},
      glue: arr(def.glue),
      ends: !!def.ends,
      order: typeof def.order === "number" ? def.order : KIND_ORDER[kind],
      state: def.state || "",
      setup: typeof def.setup === "function" ? def.setup : null,
      check: typeof def.check === "function" ? def.check : null,
    };
    concepts[c.id] = c;
    conceptOrder.push(c.id);
    return c;
  }

  function formulaMeta(f) {
    return {
      id: f.id, title: f.title, describe: f.describe, core: f.core, optional: f.optional,
      content: f.content, has_bot: !!f.bot, styles: f.styles, tags: f.tags, tips: f.tips,
      poster_ticks: f.poster_ticks, example: f.example, examples: f.examples, length: f.length,
    };
  }

  // The run's length: the manifest's `length` over the formula's default, else endless. Numbers
  // only for the chosen mode (null otherwise). Frozen; kits read it through `sdk.length`.
  //
  // A formula's declaration: {modes, default, knobs, numbers?: {rounds, seconds, lives} (what a
  // mode suggests when picked without a number), infer?: {rounds|seconds|lives: [refs]} (labels).
  //
  // `locked` is true when the manifest sets `length` itself (a creator's Customize choice, or a
  // challenge, group-chat session or game night that locks everyone to the same length). A locked
  // length always has its number (the manifest's, else the formula default's for the same mode,
  // else LENGTH_FALLBACK), clamped to LENGTH_LIMITS. An unlocked length is the formula's default:
  // a kit may leave its number null ("from content", "from rule.timer"), and then the engine
  // enforces nothing, so a manifest without `length` plays exactly as it did before lengths.
  function resolveLength(manifest, formula) {
    const own = isObj(manifest && manifest.length) && LENGTH_MODES.indexOf(manifest.length.mode) >= 0 ? manifest.length : null;
    const base = formula && isObj(formula.length) && isObj(formula.length.default) && LENGTH_MODES.indexOf(formula.length.default.mode) >= 0 ? formula.length.default : null;
    const pick = own || base || { mode: "endless" };
    const key = LENGTH_KEYS[pick.mode];
    const valid = (v) => typeof v === "number" && isFinite(v) && v > 0;
    let n = null;
    if (key) {
      const mine = pick[key];
      const fromBase = base && base.mode === pick.mode ? base[key] : undefined;
      if (valid(mine)) n = Math.floor(mine);
      else if (valid(fromBase)) n = Math.floor(fromBase);
      else if (own) {
        // The formula's suggested number for the mode (`length.numbers`), else the engine's.
        const sug = formula && isObj(formula.length) && isObj(formula.length.numbers) ? formula.length.numbers[key] : undefined;
        n = valid(sug) ? Math.floor(sug) : LENGTH_FALLBACK[key];
      }
      if (n !== null && own) n = clamp(n, LENGTH_LIMITS[key][0], LENGTH_LIMITS[key][1]);
    }
    return Object.freeze({
      mode: pick.mode,
      rounds: pick.mode === "rounds" ? n : null,
      seconds: pick.mode === "timed" ? n : null,
      lives: pick.mode === "lives" ? n : null,
      locked: !!own,
    });
  }

  // Concept param a formula's `length.infer` names ("rule.timer.seconds"), or content array
  // length ("content:rounds"). Used only for labels, never for enforcement.
  function inferNumber(manifest, ref) {
    if (typeof ref !== "string") return null;
    if (ref.indexOf("content:") === 0) {
      const v = isObj(manifest.content) ? manifest.content[ref.slice(8)] : undefined;
      return Array.isArray(v) && v.length ? v.length : null;
    }
    const dot = ref.lastIndexOf(".");
    const cid = ref.slice(0, dot), param = ref.slice(dot + 1);
    const use = (Array.isArray(manifest.concepts) ? manifest.concepts : []).filter((c) => isObj(c) && c.use === cid)[0];
    if (!use) return null;
    const v = isObj(use.params) ? use.params[param] : undefined;
    if (typeof v === "number" && isFinite(v) && v > 0) return Math.floor(v);
    const def = concepts[cid] && concepts[cid].params[param];
    return def && typeof def.default === "number" && def.default > 0 ? Math.floor(def.default) : null;
  }

  // The length a player sees for a manifest: the locked length, else what the concepts say
  // (rule.timer, flow.rounds, the formula's `length.infer`, rule.lives), else the formula's
  // default mode. Labels only (intro card, Studio, feed); runs use resolveLength.
  const LENGTH_INFER = { timed: ["rule.timer.seconds"], rounds: ["flow.rounds.count"], lives: ["rule.lives.lives"] };
  function displayLength(manifest, formula) {
    const L = resolveLength(manifest, formula);
    if (L.locked || !isObj(manifest)) return L;
    const infer = formula && isObj(formula.length) && isObj(formula.length.infer) ? formula.length.infer : {};
    for (const mode of ["timed", "rounds", "lives"]) {
      const refs = LENGTH_INFER[mode].concat(arr(infer[mode]));
      for (const ref of refs) {
        const n = inferNumber(manifest, ref);
        if (n) return Object.freeze({ mode, rounds: mode === "rounds" ? n : null, seconds: mode === "timed" ? n : null, lives: mode === "lives" ? n : null, locked: false });
      }
    }
    if (L.rounds || L.seconds || L.lives || L.mode === "endless") return L;
    return null;
  }

  // "Endless: beat 42", "10 rounds", "60 seconds", "3 lives" (docs/BUBBLES.md 7.9).
  function lengthLabel(L, best) {
    if (!L) return "";
    if (L.mode === "endless") return typeof best === "number" && best > 0 ? "Endless: beat " + best : "Endless";
    if (L.mode === "rounds") return L.rounds ? L.rounds + (L.rounds === 1 ? " round" : " rounds") : "";
    if (L.mode === "timed") return L.seconds ? L.seconds + " seconds" : "";
    if (L.mode === "lives") return L.lives ? L.lives + (L.lives === 1 ? " life" : " lives") : "";
    return "";
  }

  function conceptMeta(c) {
    return {
      id: c.id, kind: c.kind, version: c.version, formulas: c.formulas, describe: c.describe, examples: c.examples,
      params: c.params, consumes: c.consumes, emits: c.emits, requires: c.requires, conflicts: c.conflicts,
      tags: c.tags, glue: c.glue, ends: c.ends, order: c.order, state: c.state || undefined,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // 3. Validation
  // ---------------------------------------------------------------------------------------------

  function issue(code, message, path) {
    return { code, message, path: path || "" };
  }

  // JSON-schema-lite for formula content: type, properties, required, items, minItems, maxItems,
  // minLength, maxLength, minimum, maximum, enum, pattern.
  function checkSchema(schema, value, path, out) {
    if (!isObj(schema)) return;
    const t = schema.type;
    if (t) {
      const types = Array.isArray(t) ? t : [t];
      const ok = types.some((ty) =>
        (ty === "object" && isObj(value)) ||
        (ty === "array" && Array.isArray(value)) ||
        (ty === "string" && typeof value === "string") ||
        (ty === "number" && typeof value === "number" && isFinite(value)) ||
        (ty === "integer" && typeof value === "number" && Math.floor(value) === value) ||
        (ty === "boolean" && typeof value === "boolean") ||
        (ty === "null" && value === null));
      if (!ok) {
        out.push(issue("content", path + " must be " + types.join(" or "), path));
        return;
      }
    }
    if (schema.enum && schema.enum.indexOf(value) < 0) out.push(issue("content", path + " must be one of " + schema.enum.join(", "), path));
    if (typeof value === "string") {
      if (schema.minLength !== undefined && value.length < schema.minLength) out.push(issue("content", path + " must be at least " + schema.minLength + " characters", path));
      if (schema.maxLength !== undefined && value.length > schema.maxLength) out.push(issue("content", path + " must be at most " + schema.maxLength + " characters", path));
      if (schema.pattern && !(new RegExp(schema.pattern).test(value))) out.push(issue("content", path + " doesn't match " + schema.pattern, path));
    }
    if (typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) out.push(issue("content", path + " must be at least " + schema.minimum, path));
      if (schema.maximum !== undefined && value > schema.maximum) out.push(issue("content", path + " must be at most " + schema.maximum, path));
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) out.push(issue("content", path + " needs at least " + schema.minItems + " items", path));
      if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push(issue("content", path + " can have at most " + schema.maxItems + " items", path));
      if (schema.items) for (let i = 0; i < value.length && out.length < 40; i++) checkSchema(schema.items, value[i], path + "[" + i + "]", out);
    }
    if (isObj(value)) {
      if (Array.isArray(schema.required)) {
        for (const k of schema.required) if (value[k] === undefined) out.push(issue("content", path + "." + k + " is required", path + "." + k));
      }
      if (isObj(schema.properties)) {
        for (const k of Object.keys(schema.properties)) {
          if (value[k] !== undefined) checkSchema(schema.properties[k], value[k], path + "." + k, out);
        }
      }
    }
  }

  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  }

  function scanGlueTokens(raw) {
    // Returns the forbidden words a glue source uses. Strings count (bracket access like
    // x["constructor"] is how sandboxes leak); comments don't.
    const source = stripComments(raw);
    const found = [];
    const words = GLUE_FORBIDDEN.concat(GLUE_FORBIDDEN_EXTRA);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (found.indexOf(w) >= 0) continue;
      if (new RegExp("(^|[^A-Za-z0-9_$])" + w.replace(/\$/g, "\\$") + "($|[^A-Za-z0-9_$])").test(source)) found.push(w);
    }
    if (/Math\s*\.\s*random/.test(source) || /Math\s*\[\s*["'`]random/.test(source)) found.push("Math.random");
    return found;
  }

  // Inserts a loop guard into every for(;;) and while () so a runaway glue loop throws instead of
  // hanging the engine. Skips strings and comments.
  function instrumentLoops(src) {
    let out = "";
    let i = 0;
    const n = src.length;
    function isIdent(ch) { return /[A-Za-z0-9_$]/.test(ch); }
    function skipString(q, start) {
      let j = start + 1;
      while (j < n) {
        const ch = src[j];
        if (ch === "\\") { j += 2; continue; }
        if (ch === q) return j + 1;
        j++;
      }
      return n;
    }
    function matchParen(start) {
      // start at "("; returns index of matching ")"
      let depth = 0, j = start;
      while (j < n) {
        const ch = src[j];
        if (ch === "'" || ch === '"' || ch === "`") { j = skipString(ch, j); continue; }
        if (ch === "(") depth++;
        else if (ch === ")") { depth--; if (depth === 0) return j; }
        j++;
      }
      return -1;
    }
    function splitTop(s) {
      const parts = [];
      let depth = 0, last = 0, j = 0;
      while (j < s.length) {
        const ch = s[j];
        if (ch === "'" || ch === '"' || ch === "`") {
          let k = j + 1;
          while (k < s.length && s[k] !== ch) { if (s[k] === "\\") k++; k++; }
          j = k + 1;
          continue;
        }
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        else if (ch === ";" && depth === 0) { parts.push(s.slice(last, j)); last = j + 1; }
        j++;
      }
      parts.push(s.slice(last));
      return parts;
    }
    while (i < n) {
      const ch = src[i];
      if (ch === "/" && src[i + 1] === "/") { const e = src.indexOf("\n", i); const end = e < 0 ? n : e; out += src.slice(i, end); i = end; continue; }
      if (ch === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? n : e + 2; out += src.slice(i, end); i = end; continue; }
      if (ch === "'" || ch === '"' || ch === "`") { const end = skipString(ch, i); out += src.slice(i, end); i = end; continue; }
      if ((src.startsWith("for", i) || src.startsWith("while", i)) && (i === 0 || !isIdent(src[i - 1]))) {
        const kw = src.startsWith("for", i) ? "for" : "while";
        let j = i + kw.length;
        if (j < n && isIdent(src[j])) { out += src.slice(i, j); i = j; continue; }
        while (j < n && /\s/.test(src[j])) j++;
        if (src[j] === "(") {
          const close = matchParen(j);
          if (close > 0) {
            const header = src.slice(j + 1, close);
            let newHeader = header;
            if (kw === "while") newHeader = "__bubbleLoop() && (" + header + ")";
            else {
              const parts = splitTop(header);
              if (parts.length === 3) {
                const mid = parts[1].trim();
                parts[1] = mid ? " __bubbleLoop() && (" + mid + ")" : " __bubbleLoop()";
                newHeader = parts.join(";");
              }
            }
            out += kw + " (" + newHeader + ")";
            i = close + 1;
            continue;
          }
        }
        out += src.slice(i, j);
        i = j;
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  }

  const GLUE_SHADOWED = ["window", "document", "globalThis", "self", "fetch", "XMLHttpRequest", "WebSocket", "require", "Function",
    "setTimeout", "setInterval", "Date", "webkit", "localStorage", "sessionStorage", "navigator", "location", "postMessage",
    "performance", "crypto", "Reflect", "Proxy", "process", "WebAssembly", "Worker", "requestAnimationFrame", "queueMicrotask",
    "indexedDB", "Atomics", "SharedArrayBuffer", "Promise", "setImmediate"];

  // Compiles one glue source into a factory: factory(glueSdk, loopGuard) -> the slot function.
  function compileGlue(slot, source) {
    if (typeof source !== "string" || !source.trim()) return { error: issue("glue_compile", "Glue source is empty") };
    if (source.length > GLUE_MAX_LENGTH) return { error: issue("glue_compile", "Glue source is too long (" + source.length + " characters; keep it under " + GLUE_MAX_LENGTH + ")") };
    const forbidden = scanGlueTokens(source);
    if (forbidden.length) return { error: issue("glue_forbidden", "Glue can't use " + forbidden.join(", ") + ". Write one pure function with no globals, timers, network or DOM.") };
    if (!new RegExp("function\\s+" + slot + "\\s*\\(").test(source)) {
      return { error: issue("glue_compile", "Glue for slot \"" + slot + "\" must define function " + slot + "(...) {...}") };
    }
    let factory;
    try {
      const body = '"use strict";\n' + instrumentLoops(source) + "\nreturn typeof " + slot + ' === "function" ? ' + slot + " : undefined;";
      factory = new Function("sdk", "__bubbleLoop", ...GLUE_SHADOWED, body);
    } catch (e) {
      return { error: issue("glue_compile", "Glue doesn't compile: " + errMessage(e)) };
    }
    return { factory };
  }

  function normalizeManifest(input) {
    const m = deepCopy(input) || {};
    for (const k of Object.keys(m)) if (k.charAt(0) === "_") delete m[k];
    if (typeof m.version !== "number") m.version = 1;
    if (typeof m.engine_version !== "number") m.engine_version = ENGINE_VERSION;
    if (!isObj(m.style)) m.style = {};
    if (!LOOKS[m.style.look]) m.style.look = "glow";
    if (!PALETTES[m.style.palette] && m.style.palette !== "custom") m.style.palette = "lilac-haze";
    if (!isObj(m.content)) m.content = {};
    if (!isObj(m.glue)) m.glue = {};
    if (typeof m.seed !== "number" || !isFinite(m.seed)) m.seed = typeof m.seed === "string" ? seedToU32(m.seed) : 1;
    m.seed = Math.floor(m.seed);
    if (!Array.isArray(m.concepts)) m.concepts = [];
    m.concepts = m.concepts.map((c) => {
      const use = isObj(c) ? c.use : c;
      const def = concepts[use];
      const params = isObj(c) && isObj(c.params) ? Object.assign({}, c.params) : {};
      if (def) {
        for (const name of Object.keys(def.params)) {
          if (params[name] === undefined) params[name] = deepCopy(def.params[name].default);
        }
      }
      return { use, params };
    });
    return m;
  }

  // Style (LOOKS.md): an unknown look is an error; everything else falls back with a warning.
  function validateStyle(st, errors, warnings) {
    if (st.look !== undefined && !LOOKS[st.look]) {
      const hint = typeof st.look === "string" ? closest(st.look, LOOK_IDS) : null;
      errors.push(issue("style", "Unknown look \"" + st.look + "\"" + (hint ? ". Did you mean \"" + hint + "\"?" : "") + " Looks: " + LOOK_IDS.join(", "), "style.look"));
    }
    if (st.palette !== undefined && st.palette !== "custom" && !PALETTES[st.palette]) {
      warnings.push(issue("style", "Unknown palette \"" + st.palette + "\" (presets: " + Object.keys(PALETTES).join(", ") + ", or custom with colors); using lilac-haze", "style.palette"));
    }
    if (st.font !== undefined && !FONTS[st.font]) {
      warnings.push(issue("style", "Unknown font \"" + st.font + "\" (fonts: " + FONT_IDS.join(", ") + "); using the look's font", "style.font"));
    }
    if (st.motif !== undefined && st.motif !== null && MOTIFS.indexOf(st.motif) < 0) {
      warnings.push(issue("style", "Unknown motif \"" + st.motif + "\" (motifs: " + MOTIFS.join(", ") + ")", "style.motif"));
    }
    const c = st.colors;
    if (c === undefined || c === null) {
      if (st.palette === "custom") warnings.push(issue("style", "palette is custom but there are no colors; using lilac-haze", "style.colors"));
      return;
    }
    if (!isObj(c)) {
      warnings.push(issue("style_contrast", "colors must be an object of #RRGGBB values (" + COLOR_ROLES.join(", ") + ")", "style.colors"));
      return;
    }
    for (const k of Object.keys(c)) {
      if (COLOR_ROLES.indexOf(k) < 0) warnings.push(issue("style", "Unknown color role \"" + k + "\" (roles: " + COLOR_ROLES.join(", ") + ")", "style.colors." + k));
      else if (!isHex(c[k])) warnings.push(issue("style_contrast", "colors." + k + " must be a #RRGGBB hex color (got " + JSON.stringify(c[k]) + ")", "style.colors." + k));
    }
    if (!isHex(c.bg_top) || !isHex(c.bg_bottom)) {
      warnings.push(issue("style", "colors need bg_top and bg_bottom to be used; using the " + (PALETTES[st.palette] ? st.palette : "lilac-haze") + " palette", "style.colors"));
      return;
    }
    if (isHex(c.ink)) {
      for (const bg of ["bg_top", "bg_bottom"]) {
        const cr = contrastRatio(c.ink, c[bg]);
        if (cr < 4.5) warnings.push(issue("style_contrast", "ink on " + bg + " has contrast " + Math.round(cr * 10) / 10 + ":1; text needs at least 4.5:1", "style.colors.ink"));
      }
    } else {
      warnings.push(issue("style_contrast", "colors.ink is missing; text may be hard to read on these backgrounds", "style.colors.ink"));
    }
    const bgMid = mixHex(c.bg_top, c.bg_bottom, 0.5);
    for (const k of ["primary", "secondary", "accent"]) {
      if (!isHex(c[k])) continue;
      const cr = contrastRatio(c[k], bgMid);
      if (cr < 1.25 && colorDistance(c[k], bgMid) < 100) warnings.push(issue("style_contrast", k + " barely stands out from the background (" + Math.round(cr * 100) / 100 + ":1, and a similar hue)", "style.colors." + k));
    }
  }

  // Length (docs/BUBBLES.md 7.9): the mode must be one the formula supports, and its number must
  // be a whole number in LENGTH_LIMITS. A formula with no length declaration gets a warning.
  function validateLength(len, formula, errors, warnings) {
    const decl = isObj(formula.length) ? formula.length : null;
    if (!decl) {
      warnings.push(issue("length", "Formula \"" + formula.id + "\" doesn't declare length modes, so its kit may not honor length " + len.mode, "length.mode"));
    } else {
      const modes = arr(decl.modes).filter((x) => LENGTH_MODES.indexOf(x) >= 0);
      if (modes.length && modes.indexOf(len.mode) < 0) {
        errors.push(issue("length", "Formula \"" + formula.id + "\" can't run length mode \"" + len.mode + "\". Modes: " + modes.join(", "), "length.mode"));
      }
    }
    for (const mode of Object.keys(LENGTH_KEYS)) {
      const key = LENGTH_KEYS[mode];
      const v = len[key];
      if (v === undefined || v === null) continue;
      const lim = LENGTH_LIMITS[key];
      if (typeof v !== "number" || !isFinite(v) || Math.floor(v) !== v) errors.push(issue("length", "length." + key + " must be a whole number", "length." + key));
      else if (v < lim[0] || v > lim[1]) errors.push(issue("length", "length." + key + " must be " + lim[0] + "–" + lim[1] + " (got " + v + ")", "length." + key));
    }
  }

  function validateManifest(input) {
    const errors = [];
    const warnings = [];
    if (!isObj(input)) {
      errors.push(issue("schema", "The manifest must be a JSON object", ""));
      return { ok: false, errors, warnings };
    }
    const m = input;
    // Schema
    if (typeof m.id !== "string" || !m.id.trim()) errors.push(issue("schema", "id must be a non-empty string", "id"));
    else if (m.id.length > 100) errors.push(issue("schema", "id must be at most 100 characters", "id"));
    if (typeof m.title !== "string" || !m.title.trim()) errors.push(issue("schema", "title must be a non-empty string", "title"));
    else if (m.title.length > 48) warnings.push(issue("schema", "title is long (" + m.title.length + " characters); keep it under 40 so it fits on a card", "title"));
    if (typeof m.one_line_rule !== "string" || !m.one_line_rule.trim()) errors.push(issue("schema", "one_line_rule must be a non-empty string", "one_line_rule"));
    else if (m.one_line_rule.length > 110) warnings.push(issue("schema", "one_line_rule is long; one short sentence reads best on the intro card", "one_line_rule"));
    if (typeof m.formula !== "string") errors.push(issue("schema", "formula must be a string", "formula"));
    if (m.version !== undefined && (typeof m.version !== "number" || Math.floor(m.version) !== m.version || m.version < 1)) errors.push(issue("schema", "version must be a whole number of at least 1", "version"));
    if (m.seed !== undefined && (typeof m.seed !== "number" || !isFinite(m.seed))) errors.push(issue("schema", "seed must be a number", "seed"));
    if (m.seed === undefined) warnings.push(issue("schema", "seed is missing; using 1", "seed"));
    if (m.engine_version !== undefined && (typeof m.engine_version !== "number" || m.engine_version > ENGINE_VERSION)) {
      errors.push(issue("engine_version", "engine_version " + m.engine_version + " is newer than this runtime (" + ENGINE_VERSION + ")", "engine_version"));
    }
    if (m.content !== undefined && !isObj(m.content)) errors.push(issue("schema", "content must be an object", "content"));
    if (m.glue !== undefined && m.glue !== null && !isObj(m.glue)) errors.push(issue("schema", "glue must be an object of {slot, source}", "glue"));
    if (m.length !== undefined && m.length !== null && (!isObj(m.length) || LENGTH_MODES.indexOf(m.length.mode) < 0)) {
      errors.push(issue("length", "length must be {mode, rounds?, seconds?, lives?} with mode one of " + LENGTH_MODES.join(", "), "length"));
    }
    if (m.style !== undefined && !isObj(m.style)) errors.push(issue("schema", "style must be an object", "style"));
    else if (isObj(m.style)) validateStyle(m.style, errors, warnings);
    if (!Array.isArray(m.concepts) || !m.concepts.length) {
      errors.push(issue("schema", "concepts must be a non-empty list of {use, params}", "concepts"));
      return { ok: false, errors, warnings };
    }

    const formula = typeof m.formula === "string" ? formulas[m.formula] : null;
    if (typeof m.formula === "string" && !formula) {
      const hint = closest(m.formula, formulaOrder);
      errors.push(issue("unknown_formula", "Unknown formula \"" + m.formula + "\"" + (hint ? ". Did you mean \"" + hint + "\"?" : "") + " Formulas: " + formulaOrder.join(", "), "formula"));
    }
    if (formula && isObj(m.length) && LENGTH_MODES.indexOf(m.length.mode) >= 0) validateLength(m.length, formula, errors, warnings);

    // Concepts
    const used = [];
    const seen = Object.create(null);
    m.concepts.forEach((c, i) => {
      const path = "concepts[" + i + "]";
      if (!isObj(c) || typeof c.use !== "string") {
        errors.push(issue("schema", path + " must be {use: \"<kind>.<name>\", params: {}}", path));
        return;
      }
      if (c.params !== undefined && !isObj(c.params)) errors.push(issue("schema", path + ".params must be an object", path + ".params"));
      const def = concepts[c.use];
      if (!def) {
        const hint = closest(c.use, conceptOrder);
        errors.push(issue("unknown_concept", "Unknown concept \"" + c.use + "\"" + (hint ? ". Did you mean \"" + hint + "\"?" : ""), path + ".use"));
        return;
      }
      if (seen[c.use]) {
        errors.push(issue("structure", "Concept \"" + c.use + "\" is used twice; use it once", path + ".use"));
        return;
      }
      seen[c.use] = true;
      if (formula && def.formulas.indexOf("*") < 0 && def.formulas.indexOf(formula.id) < 0) {
        errors.push(issue("formula_mismatch", "Concept \"" + c.use + "\" is built for " + def.formulas.join(", ") + ", not " + formula.id, path + ".use"));
      }
      const params = isObj(c.params) ? c.params : {};
      for (const name of Object.keys(params)) {
        const spec = def.params[name];
        if (!spec) {
          const hint = closest(name, Object.keys(def.params));
          warnings.push(issue("param_unknown", "Concept \"" + c.use + "\" has no param \"" + name + "\"" + (hint ? ". Did you mean \"" + hint + "\"?" : "") + (Object.keys(def.params).length ? " Params: " + Object.keys(def.params).join(", ") : ""), path + ".params." + name));
          continue;
        }
        const bad = checkParamValue(spec, params[name]);
        if (bad) errors.push(issue(bad.code, c.use + " param \"" + name + "\" " + bad.message, path + ".params." + name));
      }
      used.push({ def, params, index: i, path });
    });

    const ids = used.map((u) => u.def.id);
    const has = (id) => ids.indexOf(id) >= 0;
    const matches = (pattern) => pattern.split("|").some((p) => {
      p = p.trim();
      if (p.slice(-2) === ".*") return used.some((u) => u.def.kind === p.slice(0, -2));
      return has(p);
    });

    // Core and structure
    if (formula) {
      for (const core of formula.core) {
        if (!matches(core)) errors.push(issue("missing_core", formula.id + " needs " + core.split("|").join(" or "), "concepts"));
      }
    }
    if (used.length === m.concepts.length) {
      const count = (kind) => used.filter((u) => u.def.kind === kind).length;
      const spaces = count("space");
      if (spaces !== 1) errors.push(issue("structure", "A Bubble needs exactly one space.* concept (found " + spaces + ")", "concepts"));
      if (count("input") < 1) errors.push(issue("structure", "A Bubble needs at least one input.* concept", "concepts"));
      if (!used.some((u) => u.def.ends)) errors.push(issue("structure", "Nothing can end the run: add a concept that ends it (" + conceptOrder.filter((id) => concepts[id].ends).slice(0, 8).join(", ") + ")", "concepts"));
      const scores = count("score");
      if (scores !== 1) errors.push(issue("structure", "A Bubble needs exactly one score.* concept (found " + scores + ")", "concepts"));
      if (count("flow") > 1) errors.push(issue("structure", "A Bubble can use at most one flow.* concept", "concepts"));
    }

    // Requires, conflicts
    for (const u of used) {
      for (const req of u.def.requires) {
        if (!matches(req)) errors.push(issue("requires", u.def.id + " requires " + req.split("|").join(" or "), u.path + ".use"));
      }
      for (const con of u.def.conflicts) {
        if (con !== u.def.id && matches(con)) errors.push(issue("conflicts", u.def.id + " conflicts with " + con, u.path + ".use"));
      }
    }

    // Event wiring
    const emitted = Object.create(null);
    for (const e of ENGINE_EVENTS) emitted[e] = "engine";
    for (const u of used) for (const e of u.def.emits) if (!emitted[e]) emitted[e] = u.def.id;
    for (const u of used) {
      const needs = [];
      for (const e of u.def.consumes) if (e && e.slice(-1) !== "?") needs.push(e);
      for (const name of Object.keys(u.def.params)) {
        const spec = u.def.params[name];
        if (!spec.event) continue;
        const v = u.params[name] !== undefined ? u.params[name] : spec.default;
        if (typeof v === "string" && v) needs.push(v);
      }
      for (const e of needs) {
        if (emitted[e]) continue;
        const emitters = conceptOrder.filter((id) => concepts[id].emits.indexOf(e) >= 0 &&
          (!formula || concepts[id].formulas.indexOf("*") >= 0 || concepts[id].formulas.indexOf(formula.id) >= 0));
        errors.push(issue("wiring", u.def.id + " listens for \"" + e + "\" but nothing in this Bubble emits it" +
          (emitters.length ? " (add " + emitters.slice(0, 3).join(" or ") + ")" : ""), u.path + ".use"));
      }
    }

    // Glue
    const glue = isObj(m.glue) ? m.glue : {};
    const slotsUsed = Object.create(null);
    const slotsCalled = Object.create(null);
    for (const u of used) for (const s of u.def.glue) slotsCalled[s] = u.def.id;
    for (const key of Object.keys(glue)) {
      const path = "glue." + key;
      const g = glue[key];
      if (!isObj(g) || typeof g.slot !== "string" || typeof g.source !== "string") {
        errors.push(issue("schema", path + " must be {slot, source}", path));
        continue;
      }
      if (!GLUE_SLOTS[g.slot]) {
        errors.push(issue("glue_slot", "Unknown glue slot \"" + g.slot + "\" (slots: " + Object.keys(GLUE_SLOTS).join(", ") + ")", path + ".slot"));
        continue;
      }
      if (slotsUsed[g.slot]) {
        errors.push(issue("glue_slot", "Two glue functions for slot \"" + g.slot + "\" (" + slotsUsed[g.slot] + " and " + key + "); keep one", path + ".slot"));
        continue;
      }
      slotsUsed[g.slot] = key;
      if (!slotsCalled[g.slot]) {
        const callers = conceptOrder.filter((id) => concepts[id].glue.indexOf(g.slot) >= 0);
        errors.push(issue("glue_slot", "No concept in this Bubble calls the \"" + g.slot + "\" slot, so this glue never runs" +
          (callers.length ? " (concepts that call it: " + callers.slice(0, 5).join(", ") + ")" : ""), path + ".slot"));
      }
      const compiled = compileGlue(g.slot, g.source);
      if (compiled.error) {
        compiled.error.path = path + ".source";
        errors.push(compiled.error);
      } else {
        try {
          const fn = compiled.factory(GLUE_SDK_STUB, () => true);
          if (typeof fn !== "function") errors.push(issue("glue_compile", "Glue must define function " + g.slot + "(...)", path + ".source"));
        } catch (e) {
          errors.push(issue("glue_compile", "Glue failed while loading: " + errMessage(e), path + ".source"));
        }
      }
    }

    // Content
    if (formula && isObj(m.content)) {
      const out = [];
      checkSchema(formula.content.schema, m.content, "content", out);
      for (const e of out) errors.push(e);
      if (formula.validateContent) {
        try {
          const extra = formula.validateContent(m.content, m) || [];
          for (const e of extra) {
            const target = e && e.warning ? warnings : errors;
            target.push(issue(e.code || "content", e.message || String(e), e.path || "content"));
          }
        } catch (e) {
          errors.push(issue("content", "Content check failed: " + errMessage(e), "content"));
        }
      }
    }

    // Per-concept checks
    if (!errors.length) {
      const nm = normalizeManifest(m);
      for (const u of used) {
        if (!u.def.check) continue;
        try {
          const params = nm.concepts[u.index].params;
          const extra = u.def.check(nm, params) || [];
          for (const e of extra) {
            const target = e && e.warning ? warnings : errors;
            target.push(issue(e.code || "content", e.message || String(e), e.path || u.path));
          }
        } catch (e) {
          errors.push(issue("runtime", u.def.id + " check failed: " + errMessage(e), u.path));
        }
      }
    }

    // Soft checks
    if (isObj(m.structure) && m.structure.cadence === "daily" && !has("flow.daily_gate") && concepts["flow.daily_gate"]) {
      warnings.push(issue("structure", "cadence is daily but the Bubble has no flow.daily_gate", "concepts"));
    }

    // Smoke run: set up and play a second with the bot, so crashes show up here instead of on a phone.
    if (!errors.length) {
      try {
        const session = createSession(m);
        const run = session.newRun({ mode: "headless", bot: true, botSkill: DEFAULT_BOT_SKILL });
        run.begin();
        for (let i = 0; i < 60 && !run.ended; i++) run.step();
      } catch (e) {
        errors.push(issue("runtime", "The Bubble crashed while starting: " + errMessage(e), "concepts"));
      }
    }

    return { ok: errors.length === 0, errors, warnings };
  }

  // ---------------------------------------------------------------------------------------------
  // 4. Engine
  // ---------------------------------------------------------------------------------------------

  const NOOP = function () {};
  const NOOP_FX = Object.freeze({ pop: NOOP, float: NOOP, shake: NOOP, flash: NOOP, sound: NOOP, haptic: NOOP, sparkle: NOOP, ring: NOOP });
  const EMPTY = Object.freeze({});
  const NO_DASH = Object.freeze([]);
  const DEFAULT_V = Object.freeze([W / 2, H / 2]);
  const GLUE_SDK_STUB = Object.freeze({ rng: () => 0.5, int: (a) => a, pick: (l) => (l ? l[0] : undefined), clamp, lerp });

  // The engine's length chip (docs/BUBBLES.md 7.9), top left in the HUD layer: "Round 3/10", a
  // timer ring with seconds, or lives as small bubbles. Drawn through g with palette roles, so it
  // reads in every look; hidden on the intro (the card shows the label) and when a concept shows
  // the length itself (hud.length false). Render only: it never touches game state.
  function drawLengthChip(g, run) {
    if (run.hud.length === false || run.phase === "intro") return;
    const L = run.length, pal = g.palette, left = run.lengthLeft();
    const h = 26, x = 12;
    const y = run.session.conceptIDs.indexOf("rule.lives") >= 0 ? 48 : 12;
    const cy = y + h / 2;
    const chip = (w) => g.pill(x, y, w, h, { fill: pal.surface, stroke: pal.line, strokeWidth: 1, radius: h / 2, alpha: 0.94 });
    if (L.mode === "rounds") {
      const text = "Round " + Math.min(run.lengthRounds + 1, L.rounds) + "/" + L.rounds;
      const w = 22 + text.length * 6.6;
      chip(w);
      g.text(text, x + w / 2, cy + 0.5, { size: 12, weight: 800, color: pal.ink });
    } else if (L.mode === "timed") {
      const secs = left.seconds_left;
      const text = secs >= 60 ? Math.floor(secs / 60) + ":" + (secs % 60 < 10 ? "0" : "") + (secs % 60) : secs + "s";
      const w = 40 + text.length * 7;
      chip(w);
      const rx = x + 15, r = 7.5;
      const frac = clamp((run.lengthTicks - run.tick) / run.lengthTicks, 0, 1);
      const warn = secs <= 5;
      g.ring(rx, cy, r, pal.ink, { width: 2.5, alpha: 0.16 });
      if (frac > 0.01) {
        const pts = [], steps = Math.max(2, Math.ceil(frac * 24));
        for (let i = 0; i <= steps; i++) {
          const a = -Math.PI / 2 + (Math.PI * 2 * frac * i) / steps;
          pts.push(rx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        g.path(pts, warn ? pal.danger : pal.primary, { width: 2.5 });
      }
      g.text(text, x + 28 + (w - 28) / 2 - 2, cy + 0.5, { size: 12, weight: 800, color: warn ? pal.danger : pal.ink });
    } else if (L.mode === "lives") {
      const n = L.lives, gap = 15, w = 16 + n * gap;
      chip(w);
      for (let i = 0; i < n; i++) {
        const bx = x + 15 + i * gap;
        if (i < left.lives_left) g.bubble(bx, cy, 5.5, { tint: pal.danger, glow: 0.6 });
        else g.ring(bx, cy, 4, pal.ink, { width: 1.5, alpha: 0.25 });
      }
    }
  }

  class BubbleSession {
    constructor(input) {
      const m = normalizeManifest(input);
      const formula = formulas[m.formula];
      if (!formula) throw new Error("Unknown formula \"" + m.formula + "\"");
      const uses = [];
      m.concepts.forEach((c, index) => {
        const def = concepts[c.use];
        if (!def) throw new Error("Unknown concept \"" + c.use + "\"");
        uses.push({ def, params: deepFreeze(Object.assign({}, c.params)), index });
      });
      uses.sort((a, b) => (a.def.order - b.def.order) || (a.index - b.index));
      const glue = [];
      for (const key of Object.keys(m.glue)) {
        const g = m.glue[key];
        if (!isObj(g) || !GLUE_SLOTS[g.slot]) continue;
        const compiled = compileGlue(g.slot, g.source);
        if (compiled.error) throw new Error("Glue " + key + ": " + compiled.error.message);
        glue.push({ key, slot: g.slot, source: g.source });
      }
      this.manifest = deepFreeze(m);
      this.formula = formula;
      this.uses = uses;
      this.glue = glue;
      this.style = resolveStyle(m.style);
      this.palette = this.style.palette;
      this.conceptIDs = uses.map((u) => u.def.id);
      this.runs = 0;
    }

    // Options: {mode, seed, bot, botSeed, botSkill, replay, player, fx}
    newRun(o) {
      this.runs++;
      return new BubbleRun(this, o || {});
    }
  }

  class BubbleSDK {
    constructor(run, params, owner) {
      this._run = run;
      this._owner = owner;
      this.params = params;
      this.manifest = run.manifest;
      this.content = run.content;
      this.state = run.state;
      this.hud = run.hud;
      this.feel = run.feel;
      this.fx = run.fx;
      this.player = run.player;
      this.palette = run.palette;
      this.w = W;
      this.h = H;
      this.dt = DT;
      this.Z = Z;
      this.clamp = clamp;
      this.lerp = lerp;
    }
    get tick() { return this._run.tick; }
    get time() { return this._run.tick * DT; }
    get score() { return this._run.score; }
    get phase() { return this._run.phase; }
    get mode() { return this._run.mode; }
    get ended() { return this._run.ending || this._run.ended; }
    get botSkill() { return this._run.botSkill; }
    get botState() { return this._run.botState; }
    on(type, fn) { this._run.on(type, fn, this._owner); }
    off(type, fn) { this._run.off(type, fn); }
    emit(type, payload) { this._run.emit(type, payload); }
    rng() { return this._run.rng(); }
    int(a, b) { return rngInt(this._run.rng, a, b); }
    range(a, b) { return a + this._run.rng() * (b - a); }
    chance(p) { return this._run.rng() < p; }
    pick(list) { return rngPick(this._run.rng, list); }
    shuffle(list) { return rngShuffle(this._run.rng, list); }
    botRng() { return this._run.botRng(); }
    addScore(n, at) { this._run.addScore(n, at); }
    setScore(n) { this._run.setScore(n); }
    end(outcome, info) { this._run.end(outcome, info); }
    glue(slot) { return this._run.glueFor(slot); }
    has(conceptID) { return this._run.session.conceptIDs.indexOf(conceptID) >= 0; }
    layer(z, draw) { this._run.addLayer(z, draw, this._owner); }
    share(partial) { this._run.mergeShare(partial); }
    preload(url) { if (this._run.preload) this._run.preload(url); }
    log(message) { logOnce(this._owner + ":" + message, this._owner + ": " + message); }
    // Length contract (docs/BUBBLES.md 7.9). Every kit honors it:
    //   sdk.length         {mode, rounds, seconds, lives}, resolved from the manifest and formula
    //   sdk.lengthRound(info?)  call when a round/item/scene completes; false means the run is
    //                      over (info {delay, outcome} shapes how the last round ends it)
    //   sdk.lengthMiss()   call on a miss; true means a life absorbed it, false means apply the
    //                      kit's normal fail
    //   sdk.lengthLeft()   {rounds_left, seconds_left, lives_left} (null when not used) for HUDs
    get length() { return this._run.length; }
    lengthRound(info) { return this._run.lengthRound(isObj(info) ? info : null); }
    lengthMiss() { return this._run.lengthMiss(); }
    lengthLeft() { return this._run.lengthLeft(); }
  }

  class BubbleRun {
    constructor(session, o) {
      this.session = session;
      this.manifest = session.manifest;
      this.formula = session.formula;
      this.palette = session.palette;
      this.mode = o.mode || "headless";
      this.seed = o.seed !== undefined && o.seed !== null ? Math.floor(Number(o.seed)) || 0 : this.manifest.seed;
      this.rng = makeRng(this.seed);
      const botSeed = o.botSeed !== undefined && o.botSeed !== null ? o.botSeed : seedToU32(this.seed) ^ 0x5bd1e995;
      this.botRng = makeRng(botSeed);
      this.botSkill = clamp(typeof o.botSkill === "number" && isFinite(o.botSkill) ? o.botSkill : DEFAULT_BOT_SKILL, 0, 1);
      this.botOn = !!o.bot && !!this.formula.bot && !o.replay;
      this.botState = {};
      this.player = Object.freeze(Object.assign({ name: "", best: null }, isObj(o.player) ? o.player : {}));
      this.fx = o.fx || NOOP_FX;
      this.preload = o.preload || null;
      this.tick = 0;
      this.score = 0;
      this.phase = "intro";
      this.begun = false;
      this.ending = false;
      this.ended = false;
      this.endAt = 0;
      this.outcome = null;
      this.endInfo = null;
      this.state = {};
      this.length = resolveLength(this.manifest, this.formula);
      this.lengthRounds = 0;
      this.lengthLivesLost = 0;
      // Timed runs end at seconds x 60 ticks (an unlocked default without a number never does).
      this.lengthTicks = this.length.seconds ? this.length.seconds * TICK_RATE : 0;
      this.content = Object.assign({}, this.manifest.content);
      // hud.length: the engine's length chip (rounds 3/10, a timer, lives). A concept that shows the
      // length itself (rule.timer, rule.lives, flow.rounds) sets it to false.
      this.hud = { score: true, label: "", retry: true, note: "", length: true };
      this.feel = { ambient: 1, particles: 1, shake: 1, sound: "soft", tempo: 1 };
      this.handlers = Object.create(null);
      this.counts = Object.create(null);
      this.depth = 0;
      this.owner = "engine";
      this.log = [];
      this.pending = [];
      this.replayInputs = null;
      this.replayIndex = 0;
      this.replayTotal = 0;
      if (o.replay && Array.isArray(o.replay.inputs)) {
        this.replayInputs = o.replay.inputs.slice().sort((a, b) => (a.t | 0) - (b.t | 0));
        this.replayTotal = o.replay.total_ticks | 0;
      }
      this.layers = [];
      this.layersDirty = false;
      this.layerSeq = 0;
      this.sharePartial = {};
      this.share = null;
      this.tickPayload = { tick: 0 };
      this.ptr = { x: 0, y: 0 };
      this.glueFns = Object.create(null);
      this.setupGlue();
      this.botSdk = null;
      this.setup();
    }

    setupGlue() {
      const run = this;
      const glueSdk = Object.freeze({
        rng: () => run.rng(),
        int: (a, b) => rngInt(run.rng, a, b),
        pick: (list) => rngPick(run.rng, list),
        clamp,
        lerp,
      });
      for (const g of this.session.glue) {
        const compiled = compileGlue(g.slot, g.source);
        if (!compiled.factory) continue;
        let loops = 0;
        const guard = () => {
          if (++loops > GLUE_LOOP_LIMIT) throw new Error("glue loop ran too long");
          return true;
        };
        let fn;
        try {
          fn = compiled.factory(glueSdk, guard);
        } catch (e) {
          logOnce("glue-load:" + g.key, "Glue " + g.key + " failed to load: " + errMessage(e));
          continue;
        }
        if (typeof fn !== "function") continue;
        let disabled = false;
        this.glueFns[g.slot] = function () {
          if (disabled) return undefined;
          loops = 0;
          try {
            return fn.apply(undefined, arguments);
          } catch (e) {
            disabled = true;
            logOnce("glue-throw:" + g.key + ":" + run.session.runs, "Glue " + g.key + " threw and is off for this run: " + errMessage(e));
            return undefined;
          }
        };
      }
    }

    setup() {
      for (const u of this.session.uses) {
        if (!u.def.setup) continue;
        const sdk = new BubbleSDK(this, u.params, u.def.id);
        this.owner = u.def.id;
        u.def.setup(sdk, u.params);
      }
      this.owner = "engine";
      this.botSdk = new BubbleSDK(this, EMPTY, "bot");
      if (this.lengthActive()) this.addLayer(Z.hud + 2, (g) => drawLengthChip(g, this), "engine");
    }

    // Starts the run: phase "playing". Called right away headless, on the first tap in play mode.
    begin() {
      if (this.begun) return;
      this.begun = true;
      this.phase = "playing";
      this.emit("flow.phase", { name: "playing" });
    }

    on(type, fn, owner) {
      if (typeof fn !== "function") return;
      const list = this.handlers[type] || (this.handlers[type] = []);
      list.push({ fn, owner: owner || "engine" });
    }

    off(type, fn) {
      const list = this.handlers[type];
      if (!list) return;
      for (let i = list.length - 1; i >= 0; i--) if (list[i].fn === fn) list.splice(i, 1);
    }

    emit(type, payload) {
      this.counts[type] = (this.counts[type] || 0) + 1;
      const list = this.handlers[type];
      if (!list || !list.length) return;
      if (this.depth >= MAX_EMIT_DEPTH) throw new Error("Event loop: \"" + type + "\" nested more than " + MAX_EMIT_DEPTH + " deep");
      this.depth++;
      const prevOwner = this.owner;
      try {
        const p = payload === undefined ? EMPTY : payload;
        for (let i = 0; i < list.length; i++) {
          const h = list[i];
          this.owner = h.owner;
          h.fn(p);
        }
      } finally {
        this.depth--;
        this.owner = prevOwner;
      }
    }

    glueFor(slot) {
      return this.glueFns[slot] || null;
    }

    addLayer(z, draw, owner) {
      if (typeof draw !== "function") return;
      this.layers.push({ z: typeof z === "number" ? z : Z.entities, draw, owner, seq: this.layerSeq++ });
      this.layersDirty = true;
    }

    sortedLayers() {
      if (this.layersDirty) {
        this.layers.sort((a, b) => (a.z - b.z) || (a.seq - b.seq));
        this.layersDirty = false;
      }
      return this.layers;
    }

    mergeShare(partial) {
      if (!isObj(partial)) return;
      for (const k of Object.keys(partial)) {
        const v = partial[k];
        if (v === undefined) continue;
        this.sharePartial[k] = v;
      }
    }

    addScore(n, at) {
      n = Math.round(Number(n));
      if (!n || !isFinite(n)) return;
      const before = this.score;
      this.score = clamp(this.score + n, 0, 1e9);
      const delta = this.score - before;
      if (!delta) return;
      this.emit("score.changed", { score: this.score, delta });
      if (at && typeof at.x === "number") this.fx.float((delta > 0 ? "+" : "") + delta, at.x, at.y, null);
    }

    setScore(n) {
      n = clamp(Math.round(Number(n)) || 0, 0, 1e9);
      const delta = n - this.score;
      if (!delta) return;
      this.score = n;
      this.emit("score.changed", { score: this.score, delta });
    }

    // The run ends after this tick, or info.delay ticks later (so a reveal can finish). Input and
    // the bot stop right away either way.
    end(outcome, info) {
      if (this.ending || this.ended) return;
      this.ending = true;
      this.outcome = outcome === "success" ? "success" : "fail";
      this.endInfo = isObj(info) ? info : null;
      const delay = this.endInfo && typeof this.endInfo.delay === "number" && isFinite(this.endInfo.delay) ? clamp(Math.floor(this.endInfo.delay), 0, 600) : 0;
      this.endAt = this.tick + 1 + delay;
    }

    // Queue live input (play mode); applied at the start of the next tick and recorded with it.
    queue(a, x, y) {
      if (a === "move" && this.pending.length && this.pending[this.pending.length - 1].a === "move") {
        const last = this.pending[this.pending.length - 1];
        last.x = x; last.y = y;
        return;
      }
      this.pending.push({ a, x, y });
    }

    wants(a) {
      if (a === "tap") return true;
      const list = this.handlers[a === "move" ? "pointer.move" : "pointer.up"];
      return !!(list && list.length);
    }

    pointer(a, x, y) {
      if (a !== "tap" && a !== "move" && a !== "up") return;
      if (!this.wants(a)) return;
      x = round1(clamp(Number(x) || 0, -400, W + 400));
      y = round1(clamp(Number(y) || 0, -400, H + 400));
      this.log.push({ t: this.tick, a, v: [x, y] });
      const p = this.ptr;
      p.x = x;
      p.y = y;
      this.emit(a === "tap" ? "pointer.down" : a === "move" ? "pointer.move" : "pointer.up", p);
    }

    step() {
      if (this.ended) return false;
      if (!this.begun) this.begin();
      const t = this.tick;
      if (this.replayInputs) {
        const inputs = this.replayInputs;
        while (this.replayIndex < inputs.length && (inputs[this.replayIndex].t | 0) <= t) {
          const inp = inputs[this.replayIndex++];
          const v = Array.isArray(inp.v) && inp.v.length >= 2 ? inp.v : DEFAULT_V;
          this.pointer(inp.a, v[0], v[1]);
        }
      } else if (this.botOn && !this.ending) {
        this.owner = "bot";
        const out = this.formula.bot.decide(this.botSdk);
        this.owner = "engine";
        if (out && out.length) {
          for (let i = 0; i < out.length; i++) {
            const inp = out[i];
            if (!inp) continue;
            const v = Array.isArray(inp.v) && inp.v.length >= 2 ? inp.v : DEFAULT_V;
            this.pointer(inp.a || "tap", v[0], v[1]);
          }
        }
      }
      if (this.pending.length) {
        for (let i = 0; i < this.pending.length; i++) {
          const p = this.pending[i];
          this.pointer(p.a, p.x, p.y);
        }
        this.pending.length = 0;
      }
      this.tickPayload.tick = t;
      this.emit("clock.tick", this.tickPayload);
      if (this.lengthTicks && !this.ending && !this.ended && t + 1 >= this.lengthTicks) this.lengthEnd("timed", null);
      this.tick = t + 1;
      if (this.ending && this.tick >= this.endAt) this.finish();
      return !this.ended;
    }

    // Ends the run. outcome "timeout" is used by simulate when max_ticks runs out.
    finish(outcome) {
      if (this.ended) return;
      this.ended = true;
      if (outcome === "timeout") {
        this.outcome = "timeout";
      } else {
        this.outcome = this.outcome || "fail";
        this.phase = this.outcome;
        this.emit("flow.phase", { name: this.outcome });
      }
      this.share = this.buildShare();
    }

    buildShare() {
      const m = this.manifest;
      const emoji = m.style && m.style.emoji ? m.style.emoji + " " : "";
      const label = this.hud.label || "points";
      const out = { headline: emoji + m.title, score_text: this.score + " " + label };
      if (this.formula.share) {
        try {
          const base = this.formula.share(this.botSdk || new BubbleSDK(this, EMPTY, "share"));
          if (isObj(base)) Object.assign(out, base);
        } catch (e) {
          logOnce("share:" + m.id, "share builder failed: " + errMessage(e));
        }
      }
      Object.assign(out, this.sharePartial);
      const share = { headline: String(out.headline || m.title), score_text: String(out.score_text === undefined ? this.score : out.score_text) };
      if (typeof out.emoji_grid === "string" && out.emoji_grid) share.emoji_grid = out.emoji_grid;
      // A short machine-readable result for the app (docs/BUBBLES.md 7.1), e.g. "ending=ferry" or
      // "mastery=7/8". Never shown to players.
      if (typeof out.tag === "string" && out.tag) share.tag = out.tag.slice(0, 120);
      return share;
    }

    replayLog() {
      const log = { seed: this.seed, tick_rate: TICK_RATE, total_ticks: this.tick, inputs: this.log.slice() };
      // A locked length travels with the replay, so verification replays it exactly.
      if (isObj(this.manifest.length)) log.length = deepCopy(this.manifest.length);
      return log;
    }

    // ----- length (docs/BUBBLES.md 7.9) -----

    // True when the engine enforces the length: a mode with its number. An unlocked default
    // without a number ("rounds from content") and endless enforce nothing.
    lengthActive() {
      const L = this.length;
      return !!(L.rounds || L.seconds || L.lives);
    }

    // The engine ends the run for its length: emits length.end first, so a kit can end it with its
    // own outcome (a word not found when time runs out is a fail); otherwise success.
    lengthEnd(mode, info) {
      this.emit("length.end", { mode, rounds: this.lengthRounds, lives_lost: this.lengthLivesLost, tick: this.tick });
      if (this.ending || this.ended) return;
      const outcome = info && info.outcome === "fail" ? "fail" : "success";
      this.emit(outcome === "success" ? "rule.success" : "rule.fail", { reason: "length", mode });
      if (this.ending || this.ended) return;
      this.end(outcome, Object.assign({ reason: "length", mode }, isObj(info) ? info : null));
    }

    // A round completed. Returns false when the run is over (rounds used up), and then ends it
    // after this tick (info.delay ticks later; info.outcome "fail" to end it as a fail).
    lengthRound(info) {
      this.lengthRounds++;
      const n = this.length.rounds;
      if (!n) return true;
      this.emit("length.round", { index: this.lengthRounds - 1, done: this.lengthRounds, total: n, left: Math.max(0, n - this.lengthRounds) });
      if (this.lengthRounds < n) return true;
      if (this.lengthRounds === n) this.lengthEnd("rounds", info);
      return false;
    }

    // A miss. In lives mode it costs a life: true while one absorbed it, false when the last one is
    // gone (the kit then applies its normal fail). Otherwise false.
    lengthMiss() {
      const n = this.length.lives;
      if (!n || this.ending || this.ended) return false;
      this.lengthLivesLost = Math.min(n, this.lengthLivesLost + 1);
      const left = n - this.lengthLivesLost;
      this.emit("length.life", { left, lost: this.lengthLivesLost, total: n });
      if (left > 0) return true;
      this.emit("length.end", { mode: "lives", rounds: this.lengthRounds, lives_lost: this.lengthLivesLost, tick: this.tick });
      return false;
    }

    // For HUDs: what's left of the length (null for numbers the mode doesn't use).
    lengthLeft() {
      const L = this.length;
      return {
        rounds_left: L.rounds ? Math.max(0, L.rounds - this.lengthRounds) : null,
        seconds_left: L.seconds ? Math.max(0, Math.ceil((this.lengthTicks - this.tick) / TICK_RATE)) : null,
        lives_left: L.lives ? Math.max(0, L.lives - this.lengthLivesLost) : null,
      };
    }

    eventCounts() {
      const out = {};
      const keys = Object.keys(this.counts).sort();
      for (const k of keys) out[k] = this.counts[k];
      return out;
    }
  }

  function createSession(manifest) {
    return new BubbleSession(parseMaybe(manifest));
  }

  // ----- posters -----
  // A poster is one representative still, not tick 0: the demo bot plays until state.poster_tick
  // when a kit sets it (the first question with its answer cards, a half-typed guess), else until
  // the formula's poster_ticks (default 90 = 1.5 s). Demo mode starts from the same tick with the
  // same bot seed, so a feed page turns from its poster into the live demo without a jump.
  function posterTickOf(run) {
    const pt = run.state.poster_tick;
    if (typeof pt === "number" && isFinite(pt)) return clamp(Math.floor(pt), 0, POSTER_MAX_TICKS);
    return run.formula.poster_ticks === undefined ? POSTER_TICKS : run.formula.poster_ticks;
  }
  function advanceToPoster(run) {
    if (!run.begun) run.begin();
    while (!run.ended && !run.ending && run.tick < POSTER_MAX_TICKS && run.tick < posterTickOf(run)) run.step();
    return run;
  }
  // Resume (docs/BUBBLES.md 4.8): plays a saved partial log (a `checkpoint`) back at full speed to the
  // tick it was saved at, then stops replaying so live input continues the same run. The run records
  // the replayed inputs in its own log as it goes, so the finished run is still one seed plus one input
  // log and replays (and verifies) exactly like a run played in one sitting. Make the run with
  // `replay: saved` and `seed: saved.seed`. Returns false when the saved run had already ended.
  function resumeRun(run, saved) {
    const total = isObj(saved) ? Math.max(0, Math.floor(Number(saved.total_ticks) || 0)) : 0;
    if (!run.begun) run.begin();
    while (!run.ended && !run.ending && run.tick < total) run.step();
    run.replayInputs = null;
    run.replayIndex = 0;
    run.replayTotal = 0;
    return !run.ended && !run.ending;
  }
  function demoBotSeed(session, loop) {
    return (seedToU32(session.manifest.seed) + (loop || 0) * 7919) >>> 0;
  }
  // The run a poster shows, advanced to its poster tick. o: {bot_skill, player, preload, fx}.
  function posterRun(session, o) {
    o = o || {};
    const run = session.newRun({
      mode: "poster", bot: true, botSeed: demoBotSeed(session, 0),
      botSkill: typeof o.bot_skill === "number" && isFinite(o.bot_skill) ? o.bot_skill : DEMO_BOT_SKILL,
      fx: o.fx || NOOP_FX, preload: o.preload || null, player: o.player,
    });
    return advanceToPoster(run);
  }

  // ---------------------------------------------------------------------------------------------
  // 5. Headless API
  // ---------------------------------------------------------------------------------------------

  function catalog() {
    return {
      version: VERSION,
      engine_version: ENGINE_VERSION,
      playfield: { w: W, h: H, tick_rate: TICK_RATE },
      kinds: KINDS.slice(),
      engine_events: ENGINE_EVENTS.slice(),
      glue_slots: Object.assign({}, GLUE_SLOTS),
      glue_rules: "Each glue entry is {slot, source}: the source of one pure function named after its slot. It gets sdk = {rng, int, pick, clamp, lerp}. No globals, timers, network, DOM, Date or Math.random. A function that throws is turned off for the rest of the run.",
      palettes: Object.keys(PALETTES).map((id) => Object.assign({ id }, PALETTES[id])),
      looks: LOOK_IDS.map((id) => {
        const L = LOOKS[id];
        return { id, title: L.title, describe: L.describe, moods: L.moods.slice(), energy: L.energy.slice(), fonts: L.fonts.slice(), motifs: L.motifs.slice(), default_font: L.font, default_motif: L.motif, example_colors: Object.assign({}, L.example_colors) };
      }),
      fonts: FONT_IDS.slice(),
      motifs: MOTIFS.slice(),
      color_roles: COLOR_ROLES.slice(),
      style_rules: "style: {look, palette (a preset or custom), colors {" + COLOR_ROLES.join(", ") + "} as #RRGGBB (ink needs 4.5:1 on both backgrounds), font, motif, emoji, mood_preset, cover_prompt}. Kits color through palette roles (g.palette.primary, secondary, accent, ink, bgTop, bgBottom, danger, surface, line, inkOn(fill)) and draw through g, so every look applies.",
      sounds: SOUNDS.slice(),
      haptics: HAPTICS.slice(),
      length_modes: LENGTH_MODES.slice(),
      length_limits: deepCopy(LENGTH_LIMITS),
      length_knobs: LENGTH_KNOBS.slice(),
      formulas: formulaOrder.map((id) => formulaMeta(formulas[id])),
      concepts: conceptOrder.map((id) => conceptMeta(concepts[id])),
      load_warnings: loadWarnings.slice(),
    };
  }

  function simulate(manifestInput, optionsInput) {
    const t0 = nowMs();
    const o = isObj(optionsInput) ? optionsInput : {};
    const base = { ok: false, error: null, outcome: null, score: 0, ticks: 0, duration_sec: 0, events: {}, replay: null };
    let run = null;
    try {
      let m = parseMaybe(manifestInput);
      if (!isObj(m)) throw new Error("The manifest must be a JSON object");
      const replay = isObj(o.replay) ? o.replay : null;
      // A replay is self-describing: a locked length it recorded applies to a manifest without one.
      if (replay && isObj(replay.length) && !isObj(m.length)) m = Object.assign({}, m, { length: deepCopy(replay.length) });
      const session = createSession(m);
      const seed = o.seed !== undefined && o.seed !== null ? o.seed : replay && replay.seed !== undefined ? replay.seed : session.manifest.seed;
      run = session.newRun({
        mode: "headless",
        seed,
        bot: o.bot !== false && !replay,
        botSeed: o.bot_seed,
        botSkill: o.bot_skill,
        replay,
        player: o.player,
      });
      const maxTicks = clamp(Math.floor(Number(o.max_ticks) || DEFAULT_MAX_TICKS), 1, HARD_MAX_TICKS);
      run.begin();
      while (!run.ended && run.tick < maxTicks) run.step();
      if (!run.ended) run.finish("timeout");
      return {
        ok: true,
        error: null,
        outcome: run.outcome,
        score: run.score,
        ticks: run.tick,
        duration_sec: Math.round((run.tick / TICK_RATE) * 1000) / 1000,
        events: run.eventCounts(),
        replay: run.replayLog(),
        share: run.share,
        bot: run.botOn ? { seed: o.bot_seed === undefined ? null : o.bot_seed, skill: run.botSkill } : null,
        ms: Math.round((nowMs() - t0) * 100) / 100,
      };
    } catch (e) {
      const owner = run && run.owner && run.owner !== "engine" ? " (in " + run.owner + ")" : "";
      return Object.assign(base, {
        error: errMessage(e) + owner,
        ticks: run ? run.tick : 0,
        score: run ? run.score : 0,
        events: run ? run.eventCounts() : {},
      });
    }
  }

  function safeValidate(input) {
    try {
      return validateManifest(input);
    } catch (e) {
      return { ok: false, errors: [issue("runtime", "Validator crashed: " + errMessage(e), "")], warnings: [] };
    }
  }

  const Bubble = {
    version: VERSION,
    engine_version: ENGINE_VERSION,
    W, H, TICK_RATE, Z,
    defineFormula,
    defineConcept,
    catalogJSON() {
      return JSON.stringify(catalog());
    },
    validateJSON(manifestJSON) {
      let m;
      try {
        m = parseMaybe(manifestJSON);
      } catch (e) {
        return JSON.stringify({ ok: false, errors: [issue("schema", "The manifest is not valid JSON: " + errMessage(e), "")], warnings: [] });
      }
      return JSON.stringify(safeValidate(m));
    },
    simulateJSON(manifestJSON, optionsJSON) {
      let o = {};
      try {
        o = optionsJSON ? parseMaybe(optionsJSON) || {} : {};
      } catch (e) {
        return JSON.stringify({ ok: false, error: "options are not valid JSON: " + errMessage(e), outcome: null, score: 0, ticks: 0, duration_sec: 0, events: {}, replay: null });
      }
      return JSON.stringify(simulate(manifestJSON, o));
    },
    // Fills every param default and pins engine_version: what Studio publishes ("compiled at publish").
    normalizeJSON(manifestJSON) {
      const m = parseMaybe(manifestJSON);
      const keep = {};
      if (isObj(m)) for (const k of Object.keys(m)) if (k.charAt(0) === "_") keep[k] = m[k];
      return JSON.stringify(Object.assign(normalizeManifest(m), keep));
    },
    // Object versions for JavaScript callers (tests, the host).
    catalog,
    validate: safeValidate,
    simulate: (m, o) => simulate(m, o || {}),
    normalize: normalizeManifest,
    createSession,
    resolveLength,
    lengthModes: LENGTH_MODES,
    // Labels only: the length a player sees for a manifest, and its text ("Endless: beat 42").
    displayLength(manifest) {
      const m = parseMaybe(manifest);
      return isObj(m) ? displayLength(m, formulas[m.formula] || null) : null;
    },
    lengthLabel,
    palette: paletteFor,
    palettes: PALETTES,
    looks: LOOKS,
    resolveStyle,
    posterRun,
    resumeRun,
    color: { mix: mixHex, rgba, hexToRgb, contrast: contrastRatio, isHex, hsl: toHsl, fromHsl },
    ease,
    util: { clamp, lerp, hashString, makeRng, rngInt, rngPick, rngShuffle, round1, deepCopy },
    _internal: { formulas, concepts, loadWarnings, compileGlue, instrumentLoops, scanGlueTokens },
  };

  root.Bubble = Bubble;

  // ---------------------------------------------------------------------------------------------
  // 6. Graphics: looks (LOOKS.md), the sprite atlas and `g`, the drawing API concepts get.
  //    Every look renders the same primitives its own way. Sprites, textures and scenery strips are
  //    pre-rendered per look, palette and size (shadowBlur only while pre-rendering), so frames stay
  //    cheap. Looks are rendering only: they never touch game state or game randomness.
  // ---------------------------------------------------------------------------------------------

  const FONT_STACK = FONTS.rounded;
  const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  const fontMaps = new Map();
  function fontFor(size, weight, stack) {
    stack = stack || FONT_STACK;
    let m = fontMaps.get(stack);
    if (!m) { m = new Map(); fontMaps.set(stack, m); }
    const key = weight * 100000 + Math.round(size * 10);
    let f = m.get(key);
    if (!f) {
      f = weight + " " + Math.round(size * 10) / 10 + "px " + stack;
      m.set(key, f);
    }
    return f;
  }

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  // Quantize a device-pixel radius to quarter-octave steps so sprites are shared.
  function quantR(rDev) {
    return Math.pow(2, Math.round(Math.log2(clamp(rDev, 1, 1024)) * 4) / 4);
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const Atlas = {
    map: null,
    pixels: 0,
    limit: 30e6,
    get(key, w, h, paint) {
      if (!this.map) this.map = new Map();
      let c = this.map.get(key);
      if (c) return c;
      if (this.pixels > this.limit) this.clear();
      c = makeCanvas(w, h);
      const ctx = c.getContext("2d");
      paint(ctx, c.width, c.height);
      this.map.set(key, c);
      this.pixels += c.width * c.height;
      return c;
    },
    clear() {
      if (this.map) this.map.clear();
      this.pixels = 0;
    },
  };

  // Cosmetic hash noise in [0, 1): jitter, grain and boil. Never game randomness.
  function hashN(a, b) {
    let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  }

  // Scratch buffers for wobbly paths, so per-frame paths allocate nothing.
  const PX = new Float64Array(160);
  const PY = new Float64Array(160);

  function smoothClosed(ctx, n) {
    ctx.moveTo((PX[n - 1] + PX[0]) / 2, (PY[n - 1] + PY[0]) / 2);
    for (let i = 0; i < n; i++) {
      const j = i + 1 < n ? i + 1 : 0;
      ctx.quadraticCurveTo(PX[i], PY[i], (PX[i] + PX[j]) / 2, (PY[i] + PY[j]) / 2);
    }
    ctx.closePath();
  }

  // A hand-drawn circle: deterministic jitter (seed), smooth curve through n points.
  function wobblyCirclePath(ctx, cx, cy, R, seed, amp, n) {
    n = Math.max(6, Math.min(n || 18, 150));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const k = 1 + amp * (hashN(seed, i) * 2 - 1);
      PX[i] = cx + Math.cos(a) * R * k;
      PY[i] = cy + Math.sin(a) * R * k;
    }
    ctx.beginPath();
    smoothClosed(ctx, n);
  }

  // A hand-drawn rounded rectangle: perimeter samples pushed along the normal by up to amp px.
  function wobblyRectPath(ctx, x, y, w, h, r, seed, amp) {
    r = Math.max(1, Math.min(r, w / 2, h / 2));
    const sw = w - 2 * r, sh = h - 2 * r, arc = (Math.PI / 2) * r;
    const P = 2 * sw + 2 * sh + 4 * arc;
    const n = Math.max(12, Math.min(140, Math.round(P / 15)));
    for (let i = 0; i < n; i++) {
      let s = (i / n) * P;
      let px, py, nx, ny;
      if (s < sw) { px = x + r + s; py = y; nx = 0; ny = -1; }
      else if ((s -= sw) < arc) { const a = -Math.PI / 2 + s / r; px = x + w - r + Math.cos(a) * r; py = y + r + Math.sin(a) * r; nx = Math.cos(a); ny = Math.sin(a); }
      else if ((s -= arc) < sh) { px = x + w; py = y + r + s; nx = 1; ny = 0; }
      else if ((s -= sh) < arc) { const a = s / r; px = x + w - r + Math.cos(a) * r; py = y + h - r + Math.sin(a) * r; nx = Math.cos(a); ny = Math.sin(a); }
      else if ((s -= arc) < sw) { px = x + w - r - s; py = y + h; nx = 0; ny = 1; }
      else if ((s -= sw) < arc) { const a = Math.PI / 2 + s / r; px = x + r + Math.cos(a) * r; py = y + h - r + Math.sin(a) * r; nx = Math.cos(a); ny = Math.sin(a); }
      else if ((s -= arc) < sh) { px = x; py = y + h - r - s; nx = -1; ny = 0; }
      else { s -= sh; const a = Math.PI + s / r; px = x + r + Math.cos(a) * r; py = y + r + Math.sin(a) * r; nx = Math.cos(a); ny = Math.sin(a); }
      const d = amp * (hashN(seed, i) * 2 - 1);
      PX[i] = px + nx * d;
      PY[i] = py + ny * d;
    }
    ctx.beginPath();
    smoothClosed(ctx, n);
  }

  // Textures: noise grain, chalk speckle and halftone tiles (device pixels), cached per key.
  function noiseTile(seed, size, color, minA, maxA, density) {
    return Atlas.get("tex|n|" + seed + "|" + size + "|" + color + "|" + minA + "|" + maxA + "|" + density, size, size, (ctx) => {
      const img = ctx.createImageData(size, size);
      const d = img.data;
      const c = hexToRgb(color);
      const rng = makeRng(seed);
      for (let i = 0; i < size * size; i++) {
        if (rng() > density) continue;
        d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2];
        d[i * 4 + 3] = Math.round((minA + rng() * (maxA - minA)) * 255);
      }
      ctx.putImageData(img, 0, 0);
    });
  }
  function halftoneTile(color, cell, frac) {
    const c = Math.max(3, Math.round(cell));
    return Atlas.get("tex|h|" + color + "|" + c + "|" + frac, c, c, (ctx) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c / 2, c / 2, Math.max(0.6, (c / 2) * frac), 0, Math.PI * 2);
      ctx.fill();
    });
  }
  // Patterns are cached per drawing context; pxScale maps tile pixels to device pixels.
  const patternCache = new WeakMap();
  function patternFor(ctx, key, tile, pxScale) {
    let m = patternCache.get(ctx);
    if (!m) { m = new Map(); patternCache.set(ctx, m); }
    const k = key + "|" + pxScale;
    let p = m.get(k);
    if (p === undefined) {
      p = ctx.createPattern(tile, "repeat");
      if (p && typeof p.setTransform === "function" && typeof DOMMatrix === "function") {
        try { p.setTransform(new DOMMatrix([1 / pxScale, 0, 0, 1 / pxScale, 0, 0])); } catch (e) { /* older WebKit */ }
      }
      if (m.size > 80) m.clear();
      m.set(k, p);
    }
    return p;
  }

  // 4x4 ordered dither (pixel look).
  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  // A 5x7 bitmap face for the pixel font (uppercase; accents are stripped).
  const PIXEL_GLYPHS = (function () {
    const src = {
      A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110",
      C: "01110 10001 10000 10000 10000 10001 01110", D: "11110 10001 10001 10001 10001 10001 11110",
      E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
      G: "01110 10001 10000 10111 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001",
      I: "01110 00100 00100 00100 00100 00100 01110", J: "00111 00010 00010 00010 00010 10010 01100",
      K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
      M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 10001 11001 10101 10011 10001 10001",
      O: "01110 10001 10001 10001 10001 10001 01110", P: "11110 10001 10001 11110 10000 10000 10000",
      Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
      S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100",
      U: "10001 10001 10001 10001 10001 10001 01110", V: "10001 10001 10001 10001 10001 01010 00100",
      W: "10001 10001 10001 10101 10101 10101 01010", X: "10001 10001 01010 00100 01010 10001 10001",
      Y: "10001 10001 10001 01010 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
      0: "01110 10001 10011 10101 11001 10001 01110", 1: "00100 01100 00100 00100 00100 00100 01110",
      2: "01110 10001 00001 00010 00100 01000 11111", 3: "11111 00010 00100 00010 00001 10001 01110",
      4: "00010 00110 01010 10010 11111 00010 00010", 5: "11111 10000 11110 00001 00001 10001 01110",
      6: "00110 01000 10000 11110 10001 10001 01110", 7: "11111 00001 00010 00100 01000 01000 01000",
      8: "01110 10001 10001 01110 10001 10001 01110", 9: "01110 10001 10001 01111 00001 00010 01100",
      "!": "00100 00100 00100 00100 00100 00000 00100", "?": "01110 10001 00001 00010 00100 00000 00100",
      ".": "00000 00000 00000 00000 00000 01100 01100", ",": "00000 00000 00000 00000 01100 00100 01000",
      ":": "00000 01100 01100 00000 01100 01100 00000", ";": "00000 01100 01100 00000 01100 00100 01000",
      "-": "00000 00000 00000 11111 00000 00000 00000", "+": "00000 00100 00100 11111 00100 00100 00000",
      "'": "00100 00100 01000 00000 00000 00000 00000", '"': "01010 01010 01010 00000 00000 00000 00000",
      "/": "00001 00010 00010 00100 01000 01000 10000", "(": "00010 00100 01000 01000 01000 00100 00010",
      ")": "01000 00100 00010 00010 00010 00100 01000", "&": "01100 10010 10100 01000 10101 10010 01101",
      "%": "11000 11001 00010 00100 01000 10011 00011", "#": "01010 01010 11111 01010 11111 01010 01010",
      "*": "00000 00100 10101 01110 10101 00100 00000", "=": "00000 00000 11111 00000 11111 00000 00000",
      "<": "00010 00100 01000 10000 01000 00100 00010", ">": "01000 00100 00010 00001 00010 00100 01000",
      "@": "01110 10001 10111 10101 10111 10000 01110", _: "00000 00000 00000 00000 00000 00000 11111",
      $: "00100 01111 10100 01110 00101 11110 00100", "·": "00000 00000 00000 01100 01100 00000 00000",
      "×": "00000 10001 01010 00100 01010 10001 00000", "…": "00000 00000 00000 00000 00000 00000 10101",
      "’": "00100 00100 01000 00000 00000 00000 00000", "“": "01010 01010 01010 00000 00000 00000 00000",
      "”": "01010 01010 01010 00000 00000 00000 00000", "–": "00000 00000 00000 11111 00000 00000 00000",
      "—": "00000 00000 00000 11111 00000 00000 00000", " ": "00000 00000 00000 00000 00000 00000 00000",
    };
    const out = Object.create(null);
    for (const ch of Object.keys(src)) out[ch] = src[ch].split(" ").map((row) => parseInt(row, 2));
    return out;
  })();
  function pixelChars(s) {
    let t = String(s).toUpperCase();
    if (typeof t.normalize === "function") t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return t;
  }
  function pixelFontFits(s) {
    const t = pixelChars(s);
    for (let i = 0; i < t.length; i++) if (!PIXEL_GLYPHS[t[i]]) return false;
    return true;
  }
  // A 3x5 face for small or narrow pixel text (same character set as the 5x7 face).
  const PIXEL_MINI = (function () {
    const src = {
      A: "010 101 111 101 101", B: "110 101 110 101 110", C: "011 100 100 100 011", D: "110 101 101 101 110",
      E: "111 100 111 100 111", F: "111 100 111 100 100", G: "011 100 111 101 011", H: "101 101 111 101 101",
      I: "111 010 010 010 111", J: "001 001 001 101 010", K: "101 101 110 101 101", L: "100 100 100 100 111",
      M: "101 111 111 101 101", N: "101 111 111 111 101", O: "010 101 101 101 010", P: "110 101 110 100 100",
      Q: "010 101 101 111 011", R: "110 101 111 110 101", S: "011 100 010 001 110", T: "111 010 010 010 010",
      U: "101 101 101 101 011", V: "101 101 101 010 010", W: "101 101 111 111 101", X: "101 101 010 101 101",
      Y: "101 101 010 010 010", Z: "111 001 010 100 111",
      0: "011 101 101 101 110", 1: "010 110 010 010 010", 2: "110 001 010 100 111", 3: "110 001 010 001 110",
      4: "101 101 111 001 001", 5: "111 100 110 001 110", 6: "011 100 111 101 111", 7: "111 001 010 100 100",
      8: "111 101 111 101 111", 9: "111 101 111 001 110",
      "!": "010 010 010 000 010", "?": "111 001 010 000 010", ".": "000 000 000 000 010", ",": "000 000 000 010 100",
      ":": "000 010 000 010 000", ";": "000 010 000 010 100", "-": "000 000 111 000 000", "+": "000 010 111 010 000",
      "'": "010 010 000 000 000", '"': "101 101 000 000 000", "/": "001 001 010 100 100", "(": "001 010 010 010 001",
      ")": "100 010 010 010 100", "&": "010 101 010 101 011", "%": "101 001 010 100 101", "#": "101 111 101 111 101",
      "*": "101 010 101 000 000", "=": "000 111 000 111 000", "<": "001 010 100 010 001", ">": "100 010 001 010 100",
      "@": "010 101 111 100 011", _: "000 000 000 000 111", $: "011 110 010 011 110", "·": "000 000 010 000 000",
      "×": "000 101 010 101 000", "…": "000 000 000 000 101", "’": "010 010 100 000 000", "“": "101 101 000 000 000",
      "”": "101 101 000 000 000", "–": "000 000 111 000 000", "—": "000 000 111 000 000", " ": "000 000 000 000 000",
    };
    const out = Object.create(null);
    for (const ch of Object.keys(src)) out[ch] = src[ch].split(" ").map((row) => parseInt(row, 2));
    return out;
  })();

  // Pixel text sprite: k = device pixels per font pixel, with a hard 1-pixel drop shadow.
  // mini: the 3x5 face (4 pixel advance) instead of the 5x7 one (6 pixel advance).
  function pixelTextSprite(s, k, color, shadow, mini) {
    const t = pixelChars(s);
    const key = "px|" + t + "|" + k + "|" + color + "|" + (shadow || "") + (mini ? "|m" : "");
    const gw = mini ? 3 : 5, gh = mini ? 5 : 7, adv = gw + 1, set = mini ? PIXEL_MINI : PIXEL_GLYPHS;
    return Atlas.get(key, (t.length * adv + 2) * k, (gh + 2) * k, (ctx) => {
      const draw = (col, ox, oy) => {
        ctx.fillStyle = col;
        for (let i = 0; i < t.length; i++) {
          const gl = set[t[i]];
          if (!gl) continue;
          for (let row = 0; row < gh; row++) {
            const bits = gl[row];
            if (!bits) continue;
            for (let col2 = 0; col2 < gw; col2++) if (bits & ((1 << (gw - 1)) >> col2)) ctx.fillRect((1 + i * adv + col2 + ox) * k, (1 + row + oy) * k, k, k);
          }
        }
      };
      if (shadow) draw(shadow, 1, 1);
      draw(color, 0, 0);
    });
  }

  // ----- sprite painters -----
  // Each look paints its sprites once per (palette, kind, radius, color, variant, scale):
  // painter(ctx, c, R, color, pal, v, px) with c the sprite center, R the radius in device
  // pixels and px device pixels per logical pixel. pad: extra room around R (shadows, bloom).

  function iridescentStroke(ctx, c, R) {
    if (typeof ctx.createConicGradient === "function") {
      const cg = ctx.createConicGradient(-0.7, c, c);
      for (let i = 0; i < IRIDESCENT.length; i++) cg.addColorStop(i / (IRIDESCENT.length - 1), IRIDESCENT[i]);
      return cg;
    }
    const lg = ctx.createLinearGradient(c - R, c - R, c + R, c + R);
    for (let i = 0; i < IRIDESCENT.length; i++) lg.addColorStop(i / (IRIDESCENT.length - 1), IRIDESCENT[i]);
    return lg;
  }

  function radialFill(ctx, c, R, stops) {
    const g = ctx.createRadialGradient(c, c, 0, c, c, R);
    for (let i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.fill();
  }

  function sheen(ctx, c, R, alpha, ox, oy) {
    ctx.save();
    ctx.translate(c + R * (ox || -0.36), c + R * (oy || -0.42));
    ctx.rotate(-0.62);
    ctx.scale(1, 0.56);
    const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.34);
    hg.addColorStop(0, "rgba(255,255,255," + alpha + ")");
    hg.addColorStop(0.55, "rgba(255,255,255," + alpha * 0.7 + ")");
    hg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function grainOver(ctx, x, y, w, h, alpha, dark) {
    const tile = noiseTile(dark ? 17 : 7, 96, dark ? "#000000" : "#6E5B45", 0.05, 0.22, 0.6);
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = alpha;
    for (let ty = y; ty < y + h; ty += 96) for (let tx = x; tx < x + w; tx += 96) ctx.drawImage(tile, tx, ty);
    ctx.restore();
  }

  function paperDisc(ctx, c, R, color, pal, seed, shadowK) {
    ctx.save();
    ctx.shadowColor = rgba(pal.shadow, 0.34 * shadowK);
    ctx.shadowBlur = Math.max(1, R * 0.1);
    ctx.shadowOffsetY = R * 0.12 * shadowK;
    ctx.fillStyle = color;
    wobblyCirclePath(ctx, c, c, R, seed, 0.022, 24);
    ctx.fill();
    ctx.restore();
    ctx.save();
    wobblyCirclePath(ctx, c, c, R, seed, 0.022, 24);
    ctx.clip();
    grainOver(ctx, c - R, c - R, 2 * R, 2 * R, 0.55, false);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = Math.max(1, R * 0.045);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(c, c, R * 0.94, Math.PI * 1.02, Math.PI * 1.5);
    ctx.stroke();
    if (relLum(color) > 0.72) {
      ctx.strokeStyle = rgba(pal.ink, 0.13);
      ctx.lineWidth = Math.max(1, R * 0.035);
      wobblyCirclePath(ctx, c, c, R - ctx.lineWidth / 2, seed, 0.022, 24);
      ctx.stroke();
    }
  }

  function clayBall(ctx, c, R, color, pal, spec, shadowK) {
    ctx.save();
    ctx.translate(c, c + R * 0.92);
    ctx.scale(1, 0.3);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    sg.addColorStop(0, rgba(pal.shadow, 0.42 * shadowK));
    sg.addColorStop(1, rgba(pal.shadow, 0));
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const g = ctx.createRadialGradient(c - R * 0.34, c - R * 0.42, R * 0.04, c, c, R * 1.02);
    g.addColorStop(0, mixHex(color, "#FFFFFF", 0.62));
    g.addColorStop(0.36, mixHex(color, "#FFFFFF", 0.16));
    g.addColorStop(0.78, color);
    g.addColorStop(1, mixHex(color, pal.ink, 0.26));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = Math.max(1, R * 0.07);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(c, c, R * 0.86, Math.PI * 0.08, Math.PI * 0.55);
    ctx.stroke();
    if (spec) {
      ctx.save();
      ctx.translate(c - R * 0.36, c - R * 0.45);
      ctx.rotate(-0.6);
      ctx.scale(1, 0.6);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.17, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath();
      ctx.arc(c - R * 0.08, c - R * 0.64, Math.max(0.8, R * 0.045), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function chalkPattern(ctx, color, seed) {
    return ctx.createPattern(noiseTile(seed || 91, 64, color, 0.35, 1, 0.82), "repeat");
  }

  // Pixel discs written pixel by pixel: crisp edges, 1 px outline, a highlight, optional shading.
  function pixelDisc(ctx, S, R, fill, fillA, outline, hi, shade, outlineBottomOnly) {
    const img = ctx.createImageData(S, S);
    const d = img.data;
    const c = S / 2;
    const f = hexToRgb(fill), o = outline ? hexToRgb(outline) : null, sh = shade ? hexToRgb(shade) : null;
    const R2 = R * R + R * 0.35;
    const inside = (x, y) => { const dx = x + 0.5 - c, dy = y + 0.5 - c; return dx * dx + dy * dy <= R2; };
    const hr = Math.max(0.8, R * 0.22), hc = c - R * 0.42;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (!inside(x, y)) continue;
        const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        let col = f, a = fillA;
        if (edge && o && (!outlineBottomOnly || y + 0.5 > c)) { col = o; a = 1; }
        else if (sh && (x + 0.5 - c) + (y + 0.5 - c) > R * 0.5) col = sh;
        const hx = x + 0.5 - hc, hy = y + 0.5 - hc;
        if (hi && !edge && R >= 3 && hx * hx + hy * hy <= hr * hr) { col = [255, 255, 255]; a = 1; }
        const i = (y * S + x) * 4;
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  const SPRITE_PAINTERS = {
    glow: {
      pad: { bubble: 0.04, orb: 0.04, halo: 0, puff: 0, spark: 0 },
      // A soap bubble: thin tinted film, iridescent rim, rim light, reflection and a highlight.
      bubble(ctx, c, R, tint, pal) {
        const film = ctx.createRadialGradient(c - R * 0.3, c - R * 0.35, R * 0.05, c, c, R);
        film.addColorStop(0, rgba(tint, 0.1));
        film.addColorStop(0.6, rgba(tint, 0.13));
        film.addColorStop(0.9, rgba(tint, 0.3));
        film.addColorStop(1, rgba(tint, 0.52));
        ctx.fillStyle = film;
        ctx.beginPath();
        ctx.arc(c, c, R, 0, Math.PI * 2);
        ctx.fill();
        const lw = Math.max(1, R * 0.09);
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = iridescentStroke(ctx, c, R);
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(c, c, R - lw / 2, 0, Math.PI * 2);
        ctx.stroke();
        if (!pal.dark) {
          ctx.globalAlpha = 0.22;
          ctx.strokeStyle = pal.ink;
          ctx.lineWidth = Math.max(0.8, R * 0.025);
          ctx.beginPath();
          ctx.arc(c, c, R - ctx.lineWidth / 2, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineCap = "round";
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = Math.max(0.8, R * 0.045);
        ctx.beginPath();
        ctx.arc(c, c, R * 0.84, Math.PI * 0.98, Math.PI * 1.42);
        ctx.stroke();
        ctx.globalAlpha = 0.42;
        ctx.lineWidth = Math.max(1, R * 0.075);
        ctx.beginPath();
        ctx.arc(c, c, R * 0.74, Math.PI * 0.1, Math.PI * 0.4);
        ctx.stroke();
        ctx.globalAlpha = 1;
        sheen(ctx, c, R, 0.98);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(c - R * 0.04, c - R * 0.64, Math.max(0.8, R * 0.055), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      },
      // A solid glowing orb: lit from the top left, soft rim light, highlight.
      orb(ctx, c, R, color, pal) {
        const body = ctx.createRadialGradient(c - R * 0.35, c - R * 0.4, R * 0.05, c, c, R * 1.05);
        body.addColorStop(0, mixHex(color, "#FFFFFF", 0.7));
        body.addColorStop(0.5, mixHex(color, "#FFFFFF", 0.12));
        body.addColorStop(1, mixHex(color, pal.dark ? "#000000" : pal.ink, 0.12));
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(c, c, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = Math.max(0.8, R * 0.06);
        ctx.beginPath();
        ctx.arc(c, c, R - ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.stroke();
        sheen(ctx, c, R, 0.85, -0.34, -0.4);
      },
      halo(ctx, c, R, color) {
        radialFill(ctx, c, R, [0, rgba(color, 0.9), 0.35, rgba(color, 0.45), 0.7, rgba(color, 0.12), 1, rgba(color, 0)]);
      },
      puff(ctx, c, R, color) {
        const g = ctx.createRadialGradient(c - R * 0.12, c - R * 0.15, 0, c, c, R);
        g.addColorStop(0, rgba(color, 1));
        g.addColorStop(0.55, rgba(color, 0.96));
        g.addColorStop(0.8, rgba(color, 0.6));
        g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(c - R, c - R, 2 * R, 2 * R);
      },
      spark(ctx, c, R, color) {
        radialFill(ctx, c, R, [0, "rgba(255,255,255,1)", 0.2, rgba(color, 0.9), 1, rgba(color, 0)]);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath();
        ctx.moveTo(c, c - R);
        ctx.quadraticCurveTo(c, c, c + R * 0.16, c);
        ctx.quadraticCurveTo(c, c, c, c + R);
        ctx.quadraticCurveTo(c, c, c - R * 0.16, c);
        ctx.quadraticCurveTo(c, c, c, c - R);
        ctx.moveTo(c - R, c);
        ctx.quadraticCurveTo(c, c, c, c - R * 0.16);
        ctx.quadraticCurveTo(c, c, c + R, c);
        ctx.quadraticCurveTo(c, c, c, c + R * 0.16);
        ctx.quadraticCurveTo(c, c, c - R, c);
        ctx.fill();
      },
    },

    paper: {
      pad: { bubble: 0.34, orb: 0.34, halo: 0.04, puff: 0.3, spark: 0.4 },
      bubble(ctx, c, R, tint, pal, v) {
        paperDisc(ctx, c, R, tint, pal, 11, 1);
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(1, R * 0.1);
        ctx.beginPath();
        ctx.arc(c, c, R * 0.7, Math.PI * 1.1, Math.PI * 1.38);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.beginPath();
        ctx.arc(c - R * 0.06, c - R * 0.7, Math.max(0.8, R * 0.06), 0, Math.PI * 2);
        ctx.fill();
      },
      orb(ctx, c, R, color, pal) { paperDisc(ctx, c, R, color, pal, 23, 1); },
      halo(ctx, c, R, color) {
        // A paper sunburst.
        const n = 18;
        for (let i = 0; i < n * 2; i++) {
          const a = (i / (n * 2)) * Math.PI * 2;
          const k = i % 2 ? 0.84 : 1;
          PX[i] = c + Math.cos(a) * R * 0.96 * k;
          PY[i] = c + Math.sin(a) * R * 0.96 * k;
        }
        ctx.beginPath();
        smoothClosed(ctx, n * 2);
        ctx.fillStyle = color;
        ctx.fill();
      },
      puff(ctx, c, R, color, pal, v) { paperDisc(ctx, c, R * 0.97, color, pal, 37 + v, 0.6); },
      spark(ctx, c, R, color, pal, v) {
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate((v % 4) * 0.8 + 0.3);
        ctx.shadowColor = rgba(pal.shadow, 0.3);
        ctx.shadowBlur = Math.max(1, R * 0.15);
        ctx.shadowOffsetY = R * 0.12;
        ctx.fillStyle = color;
        if (v % 2) ctx.fillRect(-R * 0.75, -R * 0.36, R * 1.5, R * 0.72);
        else { ctx.beginPath(); ctx.moveTo(0, -R * 0.8); ctx.lineTo(R * 0.72, R * 0.5); ctx.lineTo(-R * 0.72, R * 0.5); ctx.closePath(); ctx.fill(); }
        ctx.restore();
      },
    },

    neon: {
      pad: { bubble: 0.95, orb: 1, halo: 0, puff: 0.55, spark: 0 },
      bubble(ctx, c, R, tint, pal, v, px) {
        const lw = Math.max(1.5, 2.2 * px);
        ctx.fillStyle = rgba(tint, 0.1);
        ctx.beginPath();
        ctx.arc(c, c, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = tint;
        ctx.shadowBlur = Math.max(6, R * 0.55);
        ctx.strokeStyle = tint;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(c, c, R - lw / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = mixHex(tint, "#FFFFFF", 0.72);
        ctx.lineWidth = lw * 0.4;
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = lw * 0.75;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(c, c, R * 0.66, Math.PI * 1.12, Math.PI * 1.36);
        ctx.stroke();
      },
      orb(ctx, c, R, color) {
        ctx.shadowColor = color;
        ctx.shadowBlur = Math.max(6, R * 0.8);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(c, c, R * 0.92, 0, Math.PI * 2);
        ctx.fill();
        ctx.fill();
        ctx.shadowBlur = 0;
        const g = ctx.createRadialGradient(c - R * 0.28, c - R * 0.3, 0, c - R * 0.28, c - R * 0.3, R * 0.75);
        g.addColorStop(0, "rgba(255,255,255,0.8)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c, c, R * 0.92, 0, Math.PI * 2);
        ctx.fill();
      },
      halo(ctx, c, R, color) {
        radialFill(ctx, c, R, [0, rgba(color, 0.75), 0.25, rgba(color, 0.42), 0.6, rgba(color, 0.1), 1, rgba(color, 0)]);
      },
      puff(ctx, c, R, color, pal, v, px) {
        const g = ctx.createRadialGradient(c, c, R * 0.2, c, c, R * 0.95);
        g.addColorStop(0, mixHex(pal.bgTop, color, 0.1));
        g.addColorStop(0.75, mixHex(pal.bgTop, color, 0.2));
        g.addColorStop(1, mixHex(pal.bgTop, color, 0.42));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c, c, R * 0.95, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = color;
        ctx.shadowBlur = Math.max(4, R * 0.3);
        ctx.strokeStyle = rgba(color, 0.55);
        ctx.lineWidth = Math.max(1, 1.2 * px);
        ctx.stroke();
      },
      spark(ctx, c, R, color) {
        radialFill(ctx, c, R, [0, "rgba(255,255,255,1)", 0.25, rgba(color, 0.95), 1, rgba(color, 0)]);
      },
    },

    clay: {
      pad: { bubble: 0.5, orb: 0.5, halo: 0, puff: 0.45, spark: 0.5 },
      bubble(ctx, c, R, tint, pal) { clayBall(ctx, c, R, relLum(tint) > 0.9 ? mixHex(tint, pal.bgTop, 0.2) : tint, pal, true, 1); },
      orb(ctx, c, R, color, pal) { clayBall(ctx, c, R, color, pal, true, 1); },
      halo(ctx, c, R, color) {
        const k = mixHex(color, "#FFFFFF", 0.5);
        radialFill(ctx, c, R, [0, rgba(k, 0.55), 0.5, rgba(k, 0.2), 1, rgba(k, 0)]);
      },
      puff(ctx, c, R, color, pal) { clayBall(ctx, c, R * 0.96, color, pal, false, 0.5); },
      spark(ctx, c, R, color, pal) { clayBall(ctx, c, R * 0.8, color, pal, true, 0.6); },
    },

    ink: {
      pad: { bubble: 0.24, orb: 0.24, halo: 0.12, puff: 0.18, spark: 0.2 },
      bubble(ctx, c, R, tint, pal, v, px) {
        const lw = Math.max(1, Math.min(R * 0.14, 1.8 * px));
        wobblyCirclePath(ctx, c + R * 0.07, c + R * 0.06, R * 0.95, 101 + v * 7, 0.05, 14);
        ctx.fillStyle = rgba(tint, 0.32);
        ctx.fill();
        ctx.strokeStyle = rgba(tint, 0.4);
        ctx.lineWidth = lw * 1.1;
        ctx.stroke();
        wobblyCirclePath(ctx, c, c, R - lw / 2, 7 + v * 13, 0.035, 16);
        ctx.strokeStyle = pal.ink;
        ctx.lineWidth = lw;
        ctx.lineJoin = "round";
        ctx.stroke();
        ctx.lineCap = "round";
        ctx.lineWidth = lw * 0.8;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.arc(c, c, R * 0.64, Math.PI * (1.12 + v * 0.02), Math.PI * 1.36);
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      orb(ctx, c, R, color, pal, v, px) {
        const lw = Math.max(1, Math.min(R * 0.14, 1.8 * px));
        wobblyCirclePath(ctx, c + R * 0.06, c + R * 0.05, R * 0.96, 201 + v * 7, 0.05, 14);
        ctx.fillStyle = rgba(color, 0.88);
        ctx.fill();
        ctx.save();
        wobblyCirclePath(ctx, c, c, R - lw / 2, 31 + v * 13, 0.035, 16);
        ctx.clip();
        ctx.strokeStyle = rgba(pal.ink, 0.42);
        ctx.lineWidth = lw * 0.6;
        ctx.beginPath();
        for (let k = 0; k < 5; k++) {
          const o = R * 0.25 + k * R * 0.17;
          ctx.moveTo(c + o, c + R * 1.3);
          ctx.lineTo(c + R * 1.3, c + o);
        }
        ctx.stroke();
        ctx.restore();
        wobblyCirclePath(ctx, c, c, R - lw / 2, 31 + v * 13, 0.035, 16);
        ctx.strokeStyle = pal.ink;
        ctx.lineWidth = lw;
        ctx.stroke();
      },
      halo(ctx, c, R, color, pal, v) {
        wobblyCirclePath(ctx, c, c, R * 0.86, 301 + v, 0.06, 12);
        ctx.fillStyle = rgba(color, 0.4);
        ctx.fill();
      },
      puff(ctx, c, R, color, pal, v, px) {
        const lw = Math.max(1, Math.min(R * 0.1, 1.5 * px));
        wobblyCirclePath(ctx, c, c, R * 0.94, 401 + v * 5, 0.05, 14);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = rgba(pal.ink, 0.55);
        ctx.lineWidth = lw;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(c, c, R * 0.92, Math.PI * 1.08, Math.PI * 1.92);
        ctx.stroke();
      },
      spark(ctx, c, R, color, pal, v, px) {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, Math.min(R * 0.3, 1.6 * px));
        ctx.lineCap = "round";
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI + v * 0.4;
          ctx.moveTo(c + Math.cos(a) * R * 0.85, c + Math.sin(a) * R * 0.85);
          ctx.lineTo(c - Math.cos(a) * R * 0.85, c - Math.sin(a) * R * 0.85);
        }
        ctx.stroke();
      },
    },

    // Pixel sprites are made at the low-res buffer's scale: R is in buffer pixels.
    pixel: {
      pad: {},
      bubble(ctx, c, R, tint, pal) {
        const light = relLum(tint) > 0.8;
        const fill = light ? mixHex(tint, pal.bgTop, 0.35) : tint;
        pixelDisc(ctx, ctx.canvas.width, R, fill, light ? 0.45 : 0.6, mixHex(fill, pal.ink, 0.6), true, null, false);
      },
      orb(ctx, c, R, color, pal) { pixelDisc(ctx, ctx.canvas.width, R, color, 1, mixHex(color, pal.ink, 0.6), true, mixHex(color, pal.ink, 0.22), false); },
      dot(ctx, c, R, color) { pixelDisc(ctx, ctx.canvas.width, R, color, 1, null, false, null, false); },
      ring(ctx, c, R, color) {
        const S = ctx.canvas.width, img = ctx.createImageData(S, S), d = img.data, col = hexToRgb(color);
        const R2 = R * R + R * 0.35;
        const inside = (x, y) => { const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2; return dx * dx + dy * dy <= R2; };
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          if (!inside(x, y) || (inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1))) continue;
          const i = (y * S + x) * 4;
          d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      },
      halo(ctx, c, R, color) {
        const S = ctx.canvas.width, img = ctx.createImageData(S, S), d = img.data, col = hexToRgb(color);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2;
          const k = 1 - Math.sqrt(dx * dx + dy * dy) / R;
          if (k <= 0 || BAYER4[(y & 3) * 4 + (x & 3)] / 16 >= k * 0.75) continue;
          const i = (y * S + x) * 4;
          d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      },
      puff(ctx, c, R, color, pal) { pixelDisc(ctx, ctx.canvas.width, R, color, 1, mixHex(color, pal.ink, 0.3), false, null, true); },
      spark(ctx, c, R, color) {
        const S = ctx.canvas.width, m = Math.floor(S / 2), arm = Math.max(1, Math.round(R * 0.8));
        ctx.fillStyle = color;
        ctx.fillRect(m - arm, m, arm * 2 + 1, 1);
        ctx.fillRect(m, m - arm, 1, arm * 2 + 1);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(m, m, 1, 1);
      },
    },

    riso: {
      pad: { bubble: 0.16, orb: 0.2, halo: 0, puff: 0.06, spark: 0.06 },
      bubble(ctx, c, R, tint, pal, v, px) {
        const color = relLum(tint) > 0.82 ? pal.secondary : tint;
        const other = color === pal.primary ? pal.secondary : pal.primary;
        ctx.save();
        ctx.beginPath();
        ctx.arc(c, c, R, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = ctx.createPattern(halftoneTile(color, Math.max(3, 3.6 * px), 0.62), "repeat");
        ctx.fillRect(c - R, c - R, 2 * R, 2 * R);
        ctx.restore();
        const lw = Math.max(1.2, 1.9 * px);
        ctx.globalCompositeOperation = "multiply";
        ctx.strokeStyle = other;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(c + Math.max(1, R * 0.05), c + Math.max(0.8, R * 0.04), R - lw, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
        ctx.save();
        ctx.translate(c - R * 0.36, c - R * 0.42);
        ctx.rotate(-0.6);
        ctx.scale(1, 0.55);
        ctx.fillStyle = pal.bgTop;
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      },
      orb(ctx, c, R, color, pal, v, px) {
        const other = color === pal.secondary ? pal.primary : pal.secondary;
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(c, c, R * 0.95, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.fillStyle = ctx.createPattern(halftoneTile(other, Math.max(3, 3.4 * px), 0.6), "repeat");
        ctx.beginPath();
        ctx.arc(c + R * 0.42, c + R * 0.45, R * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.globalCompositeOperation = "source-over";
      },
      halo(ctx, c, R, color, pal, v, px) {
        const cell = Math.max(3, 4 * px);
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let y = c - R; y <= c + R; y += cell) {
          for (let x = c - R + ((Math.round((y - c) / cell) & 1) ? cell / 2 : 0); x <= c + R; x += cell) {
            const d = Math.sqrt((x - c) * (x - c) + (y - c) * (y - c)) / R;
            if (d >= 1) continue;
            const r = (cell / 2) * 0.9 * (1 - d);
            if (r < 0.4) continue;
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, Math.PI * 2);
          }
        }
        ctx.fill();
      },
      puff(ctx, c, R, color, pal, v, px) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(c, c, R * 0.97, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(c - R, c - R, 2 * R, 2 * R);
        ctx.globalAlpha = 1;
        ctx.fillStyle = ctx.createPattern(halftoneTile(pal.secondary, Math.max(3, 3.6 * px), 0.38), "repeat");
        ctx.globalCompositeOperation = "multiply";
        ctx.fillRect(c - R, c + R * 0.2, 2 * R, R);
        ctx.restore();
      },
      spark(ctx, c, R, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(c, c, R * 0.7, 0, Math.PI * 2);
        ctx.fill();
      },
    },

    chalk: {
      pad: { bubble: 0.12, orb: 0.12, halo: 0, puff: 0.04, spark: 0 },
      bubble(ctx, c, R, tint, pal, v, px) {
        const lw = Math.max(1.4, Math.min(R * 0.16, 2.4 * px));
        ctx.fillStyle = rgba(tint, 0.1);
        ctx.beginPath();
        ctx.arc(c, c, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = chalkPattern(ctx, tint, 91 + v);
        ctx.lineWidth = lw;
        ctx.lineCap = "round";
        wobblyCirclePath(ctx, c, c, R - lw / 2, 5 + v, 0.025, 18);
        ctx.stroke();
        ctx.globalAlpha = 0.5;
        wobblyCirclePath(ctx, c + 0.6 * px, c + 0.4 * px, R - lw / 2, 9 + v, 0.03, 18);
        ctx.stroke();
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(c, c, R * 0.62, Math.PI * 1.12, Math.PI * 1.36);
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      orb(ctx, c, R, color, pal, v, px) {
        ctx.fillStyle = chalkPattern(ctx, color, 93 + v);
        wobblyCirclePath(ctx, c, c, R * 0.96, 15 + v, 0.03, 18);
        ctx.fill();
        ctx.fill();
        ctx.strokeStyle = chalkPattern(ctx, mixHex(color, "#FFFFFF", 0.4), 95);
        ctx.lineWidth = Math.max(1.2, Math.min(R * 0.12, 1.8 * px));
        ctx.stroke();
      },
      halo(ctx, c, R, color) {
        radialFill(ctx, c, R, [0, rgba(color, 0.22), 0.6, rgba(color, 0.08), 1, rgba(color, 0)]);
      },
      puff(ctx, c, R, color) {
        radialFill(ctx, c, R, [0, rgba(color, 0.6), 0.7, rgba(color, 0.3), 1, rgba(color, 0)]);
        ctx.globalCompositeOperation = "destination-out";
        const tile = noiseTile(77, 64, "#000000", 0.2, 0.9, 0.5);
        for (let y = 0; y < 2 * R + 2; y += 64) for (let x = 0; x < 2 * R + 2; x += 64) ctx.drawImage(tile, c - R + x, c - R + y);
        ctx.globalCompositeOperation = "source-over";
      },
      spark(ctx, c, R, color) {
        radialFill(ctx, c, R, [0, rgba("#FFFFFF", 0.9), 0.4, rgba(color, 0.6), 1, rgba(color, 0)]);
      },
    },
  };

  // Sprite index: palette (one per style, so one per look) -> kind -> color -> size key -> canvas.
  // Lookups use existing keys only, so drawing a cached sprite allocates nothing.
  let spriteIndex = new Map();
  function spriteFor(pal, kind, R, color, v, q, S, paint) {
    let a = spriteIndex.get(pal);
    if (!a) { a = new Map(); spriteIndex.set(pal, a); }
    let b = a.get(kind);
    if (!b) { b = new Map(); a.set(kind, b); }
    let c = b.get(color);
    if (!c) { c = new Map(); b.set(color, c); }
    const nk = R * 4096 + v * 64 + q;
    let sp = c.get(nk);
    if (!sp) {
      if (Atlas.pixels > Atlas.limit) Atlas.clear();
      sp = makeCanvas(S, S);
      paint(sp.getContext("2d"), S / 2, R, color, pal, v, q / 2);
      c.set(nk, sp);
      Atlas.pixels += S * S;
    }
    return sp;
  }

  // The halo around a rounded rectangle, drawn once with shadowBlur and stretched as a 9-slice.
  function glowFrameSprite(R, E, color) {
    const S = Math.ceil(2 * (R + E) + 2);
    return Atlas.get("g|" + R + "|" + E + "|" + color, S, S, (ctx) => {
      ctx.shadowColor = rgba(color, 0.95);
      ctx.shadowBlur = E * 0.75;
      ctx.fillStyle = rgba(color, 1);
      roundRectPath(ctx, E, E, 2 * R + 2, 2 * R + 2, R);
      ctx.fill();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = "destination-out";
      roundRectPath(ctx, E, E, 2 * R + 2, 2 * R + 2, R);
      ctx.fill();
    });
  }

  // Text sprites with a look's effect: glow, sticker, neon, paper, clay, riso or chalk.
  function textSprite(s, size, weight, color, effect, effColor, pxScale, stack) {
    const key = "t|" + s + "|" + size + "|" + weight + "|" + color + "|" + effect + "|" + effColor + "|" + pxScale + "|" + stack;
    if (Atlas.map && Atlas.map.has(key)) return Atlas.map.get(key);
    const fs = size * pxScale;
    const font = fontFor(fs, weight, stack);
    const probe = Host.measureCtx();
    probe.font = font;
    const tw = probe.measureText(s).width;
    const pad = Math.ceil(fs * 0.6);
    return Atlas.get(key, tw + pad * 2, fs * 1.5 + pad * 2, (ctx) => {
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      const cx = ctx.canvas.width / 2, cy = ctx.canvas.height / 2;
      if (effect === "glow") {
        ctx.shadowColor = effColor;
        ctx.shadowBlur = fs * 0.5;
        ctx.fillStyle = effColor;
        ctx.fillText(s, cx, cy);
        ctx.fillText(s, cx, cy);
        ctx.shadowBlur = 0;
        ctx.fillStyle = color;
      } else if (effect === "neon") {
        ctx.shadowColor = effColor;
        ctx.shadowBlur = fs * 0.45;
        ctx.fillStyle = effColor;
        ctx.fillText(s, cx, cy);
        ctx.fillText(s, cx, cy);
        ctx.shadowBlur = 0;
        ctx.fillStyle = mixHex(effColor, "#FFFFFF", 0.7);
      } else if (effect === "sticker" || effect === "paper" || effect === "clay") {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.22)";
        ctx.shadowBlur = effect === "clay" ? fs * 0.14 : fs * 0.04;
        ctx.shadowOffsetY = effect === "paper" ? 0 : fs * 0.07;
        ctx.strokeStyle = effColor;
        ctx.lineWidth = fs * (effect === "paper" ? 0.16 : 0.24);
        ctx.strokeText(s, cx, cy);
        ctx.restore();
        ctx.fillStyle = color;
      } else if (effect === "riso") {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = effColor;
        ctx.fillText(s, cx + fs * 0.05, cy + fs * 0.04);
        ctx.fillStyle = color;
      } else {
        ctx.fillStyle = color;
      }
      ctx.fillText(s, cx, cy);
      if (effect === "chalk") {
        ctx.globalCompositeOperation = "destination-out";
        const tile = noiseTile(53, 64, "#000000", 0.1, 0.7, 0.45);
        for (let y = 0; y < ctx.canvas.height; y += 64) for (let x = 0; x < ctx.canvas.width; x += 64) ctx.drawImage(tile, x, y);
      }
      ctx.globalCompositeOperation = "source-over";
    });
  }

  function emojiSprite(s, size, pxScale) {
    const q = Math.round(size * pxScale / 4) * 4 || 4;
    const key = "e|" + s + "|" + q;
    return Atlas.get(key, q * 1.4, q * 1.4, (ctx) => {
      ctx.font = q + "px " + EMOJI_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s, ctx.canvas.width / 2, ctx.canvas.height / 2 + q * 0.06);
    });
  }

  // Images (avatars). Loaded once, cropped into cached sprites; a soft placeholder until they arrive.
  const Images = {
    map: new Map(),
    alias: new Map(),
    seq: 0,
    // Same-origin stand-ins for remote images (payload.images: {url: "data:image/..."}). A canvas
    // that drew a cross-origin image served without CORS headers can't be exported, so posters
    // show such images as placeholders unless Swift hands them over this way.
    setAlias(url, src) {
      if (typeof url !== "string" || typeof src !== "string" || !url || !src || this.alias.get(url) === src) return;
      if (this.alias.size > 400) this.alias.clear();
      this.alias.set(url, src);
      const rec = this.map.get(url);
      if (rec && !(rec.ok && rec.cors)) this.map.delete(url);
    },
    load(url) {
      if (!hasDOM || typeof url !== "string" || !url) return null;
      let rec = this.map.get(url);
      if (rec) return rec;
      rec = { id: ++this.seq, img: null, ok: false, failed: false, cors: true, tries: 0 };
      this.map.set(url, rec);
      const src = this.alias.get(url) || url;
      const remote = /^https?:/i.test(src);
      const start = (cors) => {
        const img = new Image();
        if (cors && remote) img.crossOrigin = "anonymous";
        img.decoding = "async";
        img.onload = () => { rec.img = img; rec.ok = true; rec.cors = cors; Host.imageLoaded(); };
        img.onerror = () => {
          if (cors) start(false);
          else { rec.failed = true; Host.imageLoaded(); }
        };
        img.src = src;
      };
      start(true);
      return rec;
    },
  };

  function imageSprite(rec, url, wDev, hDev, circle, radiusDev) {
    const qw = Math.max(8, Math.round(wDev / 8) * 8), qh = Math.max(8, Math.round(hDev / 8) * 8);
    const key = "i|" + rec.id + "|" + url + "|" + qw + "|" + qh + "|" + (circle ? 1 : 0) + "|" + Math.round(radiusDev || 0);
    return Atlas.get(key, qw, qh, (ctx) => {
      const img = rec.img;
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const k = Math.max(qw / iw, qh / ih);
      const dw = iw * k, dh = ih * k;
      ctx.save();
      if (circle) {
        ctx.beginPath();
        ctx.arc(qw / 2, qh / 2, Math.min(qw, qh) / 2, 0, Math.PI * 2);
        ctx.clip();
      } else if (radiusDev) {
        roundRectPath(ctx, 0, 0, qw, qh, radiusDev);
        ctx.clip();
      }
      ctx.drawImage(img, (qw - dw) / 2, (qh - dh) / 2, dw, dh);
      ctx.restore();
    });
  }

  // ----- per-frame helpers -----

  // How a fill string should be read by the looks: a solid color, a panel (the frosted
  // glass kits draw cards and keys with) or a translucent tint (highlights). Cached per string.
  const FILL_SOLID = 0, FILL_PANEL = 1, FILL_TINT = 2, FILL_OTHER = 3;
  const fillKinds = new Map();
  function fillKind(fill) {
    if (typeof fill !== "string") return FILL_OTHER;
    let k = fillKinds.get(fill);
    if (k !== undefined) return k;
    if (isHex(fill)) k = FILL_SOLID;
    else {
      const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(fill);
      if (!m) k = FILL_OTHER;
      else k = (m[4] === undefined ? 1 : Number(m[4])) >= 0.5 ? FILL_PANEL : FILL_TINT;
    }
    if (fillKinds.size > 500) fillKinds.clear();
    fillKinds.set(fill, k);
    return k;
  }

  // Texture tiles and patterns, cached by color and by canvas so per-frame use allocates nothing.
  const chalkTiles = new Map();
  function chalkTile(color) {
    let t = chalkTiles.get(color);
    if (!t) { t = noiseTile(91, 64, color, 0.35, 1, 0.82); chalkTiles.set(color, t); }
    return t;
  }
  const htTiles = new Map();
  function htTile(color, q) {
    let m = htTiles.get(color);
    if (!m) { m = new Map(); htTiles.set(color, m); }
    let t = m.get(q);
    if (!t) { t = halftoneTile(color, Math.max(3, q * 1.8), 0.6); m.set(q, t); }
    return t;
  }
  let grainTileCanvas = null;
  function grainTile() {
    if (!grainTileCanvas) grainTileCanvas = noiseTile(7, 96, "#6E5B45", 0.05, 0.22, 0.6);
    return grainTileCanvas;
  }
  const tilePatterns = new WeakMap();
  function tilePattern(ctx, tile, pxScale) {
    let a = tilePatterns.get(ctx);
    if (!a) { a = new Map(); tilePatterns.set(ctx, a); }
    let b = a.get(tile);
    if (!b) { b = new Map(); a.set(tile, b); }
    let p = b.get(pxScale);
    if (p === undefined) {
      p = ctx.createPattern(tile, "repeat");
      if (p && typeof p.setTransform === "function" && typeof DOMMatrix === "function") {
        try { p.setTransform(new DOMMatrix([1 / pxScale, 0, 0, 1 / pxScale, 0, 0])); } catch (e) { /* older WebKit */ }
      }
      b.set(pxScale, p);
    }
    return p;
  }

  const clayGrads = new Map();
  function clayGradient(ctx, base, h, pal) {
    let m = clayGrads.get(base);
    if (!m) { m = new Map(); clayGrads.set(base, m); }
    const hk = Math.round(h);
    let g = m.get(hk);
    if (!g) {
      g = ctx.createLinearGradient(0, 0, 0, Math.max(1, hk));
      g.addColorStop(0, mixHex(base, "#FFFFFF", 0.38));
      g.addColorStop(0.42, base);
      g.addColorStop(1, mixHex(base, pal.ink, 0.2));
      if (m.size > 120) m.clear();
      m.set(hk, g);
    }
    return g;
  }

  const shadeCache = new Map();
  const pixelShadows = new Map();
  function pixelShadowFor(color) {
    let s = pixelShadows.get(color);
    if (s === undefined) {
      s = isHex(color) && relLum(color) > 0.45 ? mixHex(color, "#000000", 0.68) : "";
      pixelShadows.set(color, s);
    }
    return s;
  }
  const pixelFits = new Map();
  function pixelFitsCached(s) {
    let v = pixelFits.get(s);
    if (v === undefined) {
      v = pixelFontFits(s) ? pixelChars(s).length : -1;
      if (pixelFits.size > 600) pixelFits.clear();
      pixelFits.set(s, v);
    }
    return v;
  }

  // The edge for sticker text (paper, clay): whichever of white, the ink or a deep shade of the
  // background stands out most from the text, so light text on a dark palette stays readable.
  const stickerCache = new Map();
  function stickerEdge(pal, color) {
    if (!isHex(color)) return "#FFFFFF";
    const key = pal.id + "|" + pal.look + "|" + pal.ink + "|" + pal.bgTop + "|" + color;
    let v = stickerCache.get(key);
    if (v) return v;
    const cands = ["#FFFFFF", pal.ink, mixHex(pal.bgTop, "#000000", 0.55)];
    v = cands[0];
    let best = contrastRatio(color, v);
    for (let i = 1; i < cands.length; i++) { const c = contrastRatio(color, cands[i]); if (c > best + 0.25) { best = c; v = cands[i]; } }
    if (stickerCache.size > 300) stickerCache.clear();
    stickerCache.set(key, v);
    return v;
  }

  function flatPill(ctx, x, y, w, h, r, fill, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Rows of a pixel rounded rectangle, in buffer pixels (u = logical size of one buffer pixel).
  // A pixel rounded rect as rows of buffer pixels; asPath adds the rows to the current path
  // (outlines fill an outer and an inner one with "evenodd").
  function pixelRows(ctx, X, Y, Wp, Hp, Rp, u, asPath) {
    if (Wp <= 0 || Hp <= 0) return;
    Rp = Math.min(Rp, Wp >> 1, Hp >> 1);
    for (let j = 0; j < Rp; j++) {
      const dy = Rp - j - 0.5;
      const inset = Rp - Math.floor(Math.sqrt(Math.max(0, Rp * Rp - dy * dy)) + 0.5);
      if (asPath) {
        ctx.rect((X + inset) * u, (Y + j) * u, (Wp - 2 * inset) * u, u);
        ctx.rect((X + inset) * u, (Y + Hp - 1 - j) * u, (Wp - 2 * inset) * u, u);
      } else {
        ctx.fillRect((X + inset) * u, (Y + j) * u, (Wp - 2 * inset) * u, u);
        ctx.fillRect((X + inset) * u, (Y + Hp - 1 - j) * u, (Wp - 2 * inset) * u, u);
      }
    }
    if (Hp - 2 * Rp > 0) {
      if (asPath) ctx.rect(X * u, (Y + Rp) * u, Wp * u, (Hp - 2 * Rp) * u);
      else ctx.fillRect(X * u, (Y + Rp) * u, Wp * u, (Hp - 2 * Rp) * u);
    }
  }

  const TAU = Math.PI * 2;

  // ----- skins: how each look draws the g primitives (missing methods fall back to glow) -----

  const SKIN_GLOW = {
    bubbleHalo: 0.45,
    orbHalo: 0.55,
    haloK: 1,
    bubble(g, x, y, r, tint, glow, alpha, sx, sy) {
      if (glow > 0 && this.bubbleHalo) g.halo(x, y, r * 1.75, tint, this.bubbleHalo * glow * alpha);
      g.sprite("bubble", x, y, r, tint, alpha, sx, sy, g.boil);
    },
    orb(g, x, y, r, color, glow, alpha) {
      if (glow > 0 && this.orbHalo) g.halo(x, y, r * 1.9, color, this.orbHalo * glow * alpha);
      g.sprite("orb", x, y, r, color, alpha, 1, 1, g.boil);
    },
    halo(g, x, y, r, color, alpha) {
      g.sprite("halo", x, y, r, color, alpha * this.haloK, 1, 1, 0);
    },
    puff(g, x, y, r, color, alpha) {
      g.sprite("puff", x, y, r, color, alpha, 1, 1, g.boil);
    },
    spark(g, x, y, r, color, alpha) {
      g.sprite("spark", x, y, r, color, alpha, 1, 1, ((x * 3 + y * 7) | 0) & 3);
    },
    circle(g, x, y, r, color, alpha) {
      const ctx = g.ctx;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    },
    ring(g, x, y, r, color, width, alpha) {
      const ctx = g.ctx;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    line(g, x1, y1, x2, y2, color, width, alpha, cap) {
      const ctx = g.ctx;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = cap;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    pill(g, x, y, w, h, r, fill, o, alpha) {
      const ctx = g.ctx;
      if (o.glow) g.glowRect(x, y, w, h, r, o.glowColor || (typeof fill === "string" && fill.charAt(0) === "#" ? fill : g.palette.glow), o.glow * 0.8 * alpha);
      ctx.globalAlpha = alpha;
      if (fill) {
        if (o.shade && typeof fill === "string" && fill.charAt(0) === "#") {
          let m = shadeCache.get(fill);
          if (!m) { m = new Map(); shadeCache.set(fill, m); }
          const key = Math.round(w) * 16 + Math.round(o.shade * 10);
          let grad = m.get(key);
          if (!grad) {
            grad = ctx.createLinearGradient(0, 0, w, 0);
            grad.addColorStop(0, mixHex(fill, "#FFFFFF", 0.55 * o.shade));
            grad.addColorStop(0.3, mixHex(fill, "#FFFFFF", 0.2 * o.shade));
            grad.addColorStop(0.75, fill);
            grad.addColorStop(1, mixHex(fill, g.palette.dark ? "#000000" : g.palette.ink, 0.25 * o.shade));
            if (m.size > 200) m.clear();
            m.set(key, grad);
          }
          ctx.translate(x, 0);
          ctx.fillStyle = grad;
          roundRectPath(ctx, 0, y, w, h, r);
          ctx.fill();
          ctx.translate(-x, 0);
        } else {
          ctx.fillStyle = fill;
          roundRectPath(ctx, x, y, w, h, r);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },
    // A pill's outline: on its own (fill null or "none") or over a filled pill (o.stroke).
    outline(g, x, y, w, h, r, color, width, o, alpha, filled) {
      const ctx = g.ctx;
      if (o.glow && !filled) g.glowRect(x, y, w, h, r, o.glowColor || (isHex(color) ? color : g.palette.glow), o.glow * 0.8 * alpha);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      roundRectPath(ctx, x, y, w, h, r);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    textEffect(g, o) { return o.glow ? "glow" : null; },
    effColor(g, o) { return typeof o.glow === "string" ? o.glow : g.palette.glow; },
    weight(w) { return w; },
    imageUnder() {},
    imageOver() {},
    particle(g, kind, x, y, size, k, color, vx, vy, i) {
      if (kind === 2) this.spark(g, x, y, size * (0.4 + k * 0.8), color, Math.min(1, k * 1.6));
      else if (kind === 1) this.bubble(g, x, y, size * (0.6 + k * 0.5), g.palette.glow, 0, k, 1, 1);
      else this.orb(g, x, y, size * (0.5 + k * 0.5), color, 0.6, Math.min(1, k * 1.4));
    },
  };

  function skin(overrides) { return Object.assign(Object.create(SKIN_GLOW), overrides); }

  const SKINS = {
    glow: SKIN_GLOW,

    paper: skin({
      bubbleHalo: 0,
      orbHalo: 0,
      haloK: 0.4,
      ring(g, x, y, r, color, width, alpha) {
        const ctx = g.ctx;
        ctx.lineWidth = width;
        ctx.globalAlpha = alpha * 0.25;
        ctx.strokeStyle = g.palette.shadow;
        ctx.beginPath();
        ctx.arc(x, y + 1.5, r, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      line(g, x1, y1, x2, y2, color, width, alpha, cap) {
        SKIN_GLOW.line(g, x1, y1 + 1.5, x2, y2 + 1.5, g.palette.shadow, width, alpha * 0.22, cap);
        SKIN_GLOW.line(g, x1, y1, x2, y2, color, width, alpha, cap);
      },
      pill(g, x, y, w, h, r, fill, o, alpha) {
        const ctx = g.ctx, pal = g.palette, kind = fillKind(fill);
        if (kind === FILL_TINT || kind === FILL_OTHER) { flatPill(ctx, x, y, w, h, r, fill, alpha); return; }
        const body = kind === FILL_SOLID ? fill : pal.surface;
        const lift = 1.6 + (o.glow ? Math.min(1.5, o.glow) * 2.2 : 0);
        ctx.globalAlpha = alpha * 0.24;
        ctx.fillStyle = pal.shadow;
        roundRectPath(ctx, x + lift * 0.25, y + lift, w, h, r);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = body;
        roundRectPath(ctx, x, y, w, h, r);
        ctx.fill();
        ctx.globalAlpha = alpha * 0.55;
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = tilePattern(ctx, grainTile(), g.pxScale);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = alpha * 0.55;
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      outline(g, x, y, w, h, r, color, width, o, alpha) {
        const ctx = g.ctx;
        ctx.lineJoin = "round";
        ctx.globalAlpha = alpha * 0.22;
        ctx.strokeStyle = g.palette.shadow;
        ctx.lineWidth = width + 0.8;
        roundRectPath(ctx, x + 0.5, y + 1.5, w, h, r);
        ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        roundRectPath(ctx, x, y, w, h, r);
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      textEffect(g, o) { return o.glow ? "sticker" : null; },
      effColor(g, o, color) { return stickerEdge(g.palette, color); },
      imageUnder(g, x, y, w, h, o, alpha) {
        const ctx = g.ctx;
        ctx.globalAlpha = alpha * 0.25;
        ctx.fillStyle = g.palette.shadow;
        if (o.circle) { ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2 + 2.5, Math.min(w, h) / 2 + 2, 0, TAU); ctx.fill(); }
        else { roundRectPath(ctx, x, y + 2.5, w, h, o.radius || 0); ctx.fill(); }
        ctx.globalAlpha = 1;
      },
      imageOver(g, x, y, w, h, o, alpha) {
        const ctx = g.ctx;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2.5;
        if (o.circle) { ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, TAU); ctx.stroke(); }
        else { roundRectPath(ctx, x, y, w, h, o.radius || 0); ctx.stroke(); }
        ctx.globalAlpha = 1;
      },
      particle(g, kind, x, y, size, k, color, vx, vy, i) {
        g.sprite("spark", x, y, size * (kind === 2 ? 0.9 : 1.25) * (0.6 + 0.4 * k), color, Math.min(1, k * 1.6), 1, 1, (i + Math.floor(g.t * 12)) & 3);
      },
    }),

    neon: skin({
      bubbleHalo: 0.3,
      orbHalo: 0.4,
      haloK: 0.9,
      halo(g, x, y, r, color, alpha) {
        const ctx = g.ctx;
        ctx.globalCompositeOperation = "lighter";
        g.sprite("halo", x, y, r, color, alpha * this.haloK, 1, 1, 0);
        ctx.globalCompositeOperation = "source-over";
      },
      ring(g, x, y, r, color, width, alpha) {
        const ctx = g.ctx;
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.globalAlpha = alpha * 0.28;
        ctx.lineWidth = width * 3.2;
        ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      },
      line(g, x1, y1, x2, y2, color, width, alpha, cap) {
        const ctx = g.ctx;
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = color;
        ctx.lineCap = cap;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.globalAlpha = alpha * 0.28;
        ctx.lineWidth = width * 3.2;
        ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      },
      outline(g, x, y, w, h, r, color, width, o, alpha) {
        const ctx = g.ctx, c = isHex(color) ? color : g.palette.line;
        ctx.globalCompositeOperation = "lighter";
        g.glowRect(x, y, w, h, r, c, alpha * (0.3 + (o.glow ? Math.min(1, o.glow) * 0.4 : 0)));
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.6, width);
        roundRectPath(ctx, x, y, w, h, r);
        ctx.stroke();
        ctx.globalAlpha = alpha * 0.9;
        ctx.strokeStyle = mixHex(c, "#FFFFFF", 0.7);
        ctx.lineWidth = Math.max(0.6, width * 0.4);
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      pill(g, x, y, w, h, r, fill, o, alpha) {
        const ctx = g.ctx, pal = g.palette, kind = fillKind(fill);
        if (kind === FILL_TINT || kind === FILL_OTHER) { flatPill(ctx, x, y, w, h, r, fill, alpha); return; }
        const edge = kind === FILL_SOLID ? fill : isHex(o.glowColor) && relLum(o.glowColor) < 0.9 ? o.glowColor : pal.line;
        const body = kind === FILL_SOLID ? mixHex(pal.bgTop, fill, 0.13) : pal.surface;
        ctx.globalCompositeOperation = "lighter";
        g.glowRect(x, y, w, h, r, edge, alpha * (0.3 + (o.glow ? Math.min(1, o.glow) * 0.4 : 0)));
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = alpha * 0.94;
        ctx.fillStyle = body;
        roundRectPath(ctx, x, y, w, h, r);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = edge;
        ctx.lineWidth = 2;
        roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1));
        ctx.stroke();
        ctx.globalAlpha = alpha * 0.9;
        ctx.strokeStyle = mixHex(edge, "#FFFFFF", 0.7);
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      textEffect() { return "neon"; },
      effColor(g, o, color) { return typeof o.glow === "string" && isHex(o.glow) ? o.glow : relLum(color) > 0.7 ? g.palette.primary : color; },
      imageOver(g, x, y, w, h, o, alpha) {
        if (o.circle) this.ring(g, x + w / 2, y + h / 2, Math.min(w, h) / 2, g.palette.primary, 2, alpha);
      },
      particle(g, kind, x, y, size, k, color, vx, vy, i) {
        const ctx = g.ctx;
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = color;
        ctx.beginPath();
        if (kind === 1) {
          ctx.globalAlpha = k;
          ctx.lineWidth = 1.2;
          ctx.arc(x, y, size * 0.8, 0, TAU);
        } else {
          ctx.globalAlpha = Math.min(1, k * 1.5);
          ctx.lineWidth = Math.max(1, size * 0.45);
          ctx.lineCap = "round";
          ctx.moveTo(x, y);
          ctx.lineTo(x - vx * 0.035, y - vy * 0.035);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      },
    }),

    ink: skin({
      bubbleHalo: 0,
      orbHalo: 0,
      haloK: 0.5,
      ring(g, x, y, r, color, width, alpha) {
        const ctx = g.ctx;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineJoin = "round";
        wobblyCirclePath(ctx, x, y, r, ((r * 10) | 0) + g.boil * 7, 0.04, 14);
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      line(g, x1, y1, x2, y2, color, width, alpha, cap) {
        const ctx = g.ctx;
        const dx = x2 - x1, dy = y2 - y1;
        const bend = (hashN((dx * 10) | 0, ((dy * 10) | 0) + g.boil) - 0.5) * 0.08;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = cap;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo((x1 + x2) / 2 - dy * bend, (y1 + y2) / 2 + dx * bend, x2, y2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      outline(g, x, y, w, h, r, color, width, o, alpha) {
        const ctx = g.ctx;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.2, width);
        ctx.lineJoin = "round";
        wobblyRectPath(ctx, x, y, w, h, r, ((w * 7) | 0) * 31 + ((h * 3) | 0) + g.boil * 977 + 5, 0.9);
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      pill(g, x, y, w, h, r, fill, o, alpha) {
        const ctx = g.ctx, pal = g.palette, kind = fillKind(fill);
        if (kind === FILL_TINT || kind === FILL_OTHER) { flatPill(ctx, x, y, w, h, r, fill, alpha); return; }
        const solid = kind === FILL_SOLID;
        if (solid) {
          // Paper under the wash, so what's behind the pill doesn't show through it.
          ctx.globalAlpha = alpha;
          ctx.fillStyle = pal.bgTop;
          roundRectPath(ctx, x, y, w, h, r);
          ctx.fill();
        }
        ctx.globalAlpha = alpha * (solid ? 0.62 : 1);
        ctx.fillStyle = solid ? fill : pal.surfaceStrong;
        roundRectPath(ctx, x + 2, y + 1.6, w, h, r);
        ctx.fill();
        if (solid && w > 26 && h > 26) {
          ctx.save();
          roundRectPath(ctx, x, y, w, h, r);
          ctx.clip();
          ctx.globalAlpha = alpha * 0.3;
          ctx.strokeStyle = pal.ink;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          const x0 = x + w * 0.64, span = w - (x0 - x);
          for (let yy = y - span; yy < y + h; yy += 6.5) {
            ctx.moveTo(x0, yy + span);
            ctx.lineTo(x + w, yy);
          }
          ctx.stroke();
          ctx.restore();
        }
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = pal.ink;
        ctx.lineWidth = 1.6;
        ctx.lineJoin = "round";
        wobblyRectPath(ctx, x, y, w, h, r, ((w * 7) | 0) * 31 + ((h * 3) | 0) + g.boil * 977, 0.9);
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      textEffect(g, o) { return o.glow ? "paper" : null; },
      effColor(g, o, color) { return isHex(color) && relLum(color) > 0.6 ? stickerEdge(g.palette, color) : g.palette.surfaceStrong; },
      imageOver(g, x, y, w, h, o, alpha) {
        if (o.circle) this.ring(g, x + w / 2, y + h / 2, Math.min(w, h) / 2, g.palette.ink, 1.6, alpha);
      },
      particle(g, kind, x, y, size, k, color, vx, vy, i) {
        g.sprite("spark", x, y, size * (0.7 + 0.5 * k), kind === 0 ? g.palette.ink : color, Math.min(1, k * 1.6), 1, 1, i % 3);
      },
    }),

    clay: skin({
      bubbleHalo: 0,
      orbHalo: 0,
      haloK: 0.6,
      ring(g, x, y, r, color, width, alpha) {
        const ctx = g.ctx;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width * 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = alpha * 0.55;
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = Math.max(0.6, width * 0.45);
        ctx.beginPath();
        ctx.arc(x - 0.4, y - 0.6, r, Math.PI * 0.95, Math.PI * 1.7);
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      line(g, x1, y1, x2, y2, color, width, alpha, cap) {
        SKIN_GLOW.line(g, x1, y1, x2, y2, color, width * 1.4, alpha, "round");
        SKIN_GLOW.line(g, x1 - 0.3, y1 - 0.6, x2 - 0.3, y2 - 0.6, "#FFFFFF", Math.max(0.6, width * 0.4), alpha * 0.45, "round");
      },
      outline(g, x, y, w, h, r, color, width, o, alpha) {
        const ctx = g.ctx, lw = Math.max(2, width * 1.4);
        ctx.lineJoin = "round";
        ctx.lineWidth = lw;
        ctx.globalAlpha = alpha * 0.25;
        ctx.strokeStyle = g.palette.shadow;
        roundRectPath(ctx, x, y + 2, w, h, r);
        ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        roundRectPath(ctx, x, y, w, h, r);
        ctx.stroke();
        if (isHex(color)) {
          ctx.globalAlpha = alpha * 0.55;
          ctx.strokeStyle = mixHex(color, "#FFFFFF", 0.55);
          ctx.lineWidth = lw * 0.35;
          roundRectPath(ctx, x, y - lw * 0.2, w, h, r);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      },
      pill(g, x, y, w, h, r, fill, o, alpha) {
        const ctx = g.ctx, pal = g.palette, kind = fillKind(fill);
        if (kind === FILL_TINT || kind === FILL_OTHER) { flatPill(ctx, x, y, w, h, r, fill, alpha); return; }
        const base = kind === FILL_SOLID ? fill : pal.surface;
        const lift = 2.5 + (o.glow ? Math.min(1.5, o.glow) * 2 : 0);
        ctx.translate(0, lift);
        g.glowRect(x + 3, y + 2, w - 6, h - 3, r, pal.shadow, alpha * 0.42);
        ctx.translate(0, -lift);
        ctx.translate(x, y);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = clayGradient(ctx, base, h, pal);
        roundRectPath(ctx, 0, 0, w, h, r);
        ctx.fill();
        ctx.translate(-x, -y);
        if (h > 8 && w > 8) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, Math.min(h * 0.45, 16));
          ctx.clip();
          ctx.globalAlpha = alpha * 0.6;
          ctx.strokeStyle = "#FFFFFF";
          ctx.lineWidth = 2;
          roundRectPath(ctx, x + 2, y + 2, w - 4, h - 4, Math.max(0, r - 2));
          ctx.stroke();
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      },
      textEffect(g, o) { return o.glow ? "clay" : null; },
      effColor(g, o, color) { return stickerEdge(g.palette, color); },
      weight(w) { return Math.min(900, w + 100); },
      imageOver(g, x, y, w, h, o, alpha) {
        if (o.circle) this.ring(g, x + w / 2, y + h / 2, Math.min(w, h) / 2 + 1, g.palette.surfaceStrong, 2.5, alpha);
      },
      particle(g, kind, x, y, size, k, color, vx, vy, i) {
        g.sprite("spark", x, y, size * (0.55 + 0.45 * k), color, Math.min(1, k * 1.8), 1, 1, 0);
      },
    }),

    // Pixel: everything lands in a low-res buffer (see Host.drawFrame), snapped to its grid.
    pixel: skin({
      bubbleHalo: 0,
      orbHalo: 0,
      haloK: 0.5,
      circle(g, x, y, r, color, alpha) { g.sprite("dot", x, y, r, color, alpha, 1, 1, 0); },
      ring(g, x, y, r, color, width, alpha) { g.sprite("ring", x, y, r, color, alpha, 1, 1, 0); },
      line(g, x1, y1, x2, y2, color, width, alpha) {
        const ctx = g.ctx, s = g.pxScale, u = 1 / s;
        const ax = Math.round(x1 * s), ay = Math.round(y1 * s), bx = Math.round(x2 * s), by = Math.round(y2 * s);
        const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
        const t = Math.max(1, Math.round(width * s));
        // Dashes in buffer pixels along the line (g.dash in playfield units).
        const d = g.dash, on = d ? Math.max(1, Math.round(d[0] * s)) : 0, period = d ? on + Math.max(1, Math.round((d.length > 1 ? d[1] : d[0]) * s)) : 0;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        for (let i = 0; i <= n; i++) {
          if (period && i % period >= on) continue;
          ctx.fillRect(Math.round(ax + ((bx - ax) * i) / n) * u, Math.round(ay + ((by - ay) * i) / n) * u, t * u, t * u);
        }
        ctx.globalAlpha = 1;
      },
      outline(g, x, y, w, h, r, color, width, o, alpha) {
        const ctx = g.ctx, s = g.pxScale, u = 1 / s;
        const X = Math.round(x * s), Y = Math.round(y * s), Wp = Math.max(1, Math.round(w * s)), Hp = Math.max(1, Math.round(h * s));
        const Rp = Math.max(0, Math.min(Math.round(r * s), Wp >> 1, Hp >> 1));
        const t = Math.max(1, Math.round(width * s));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        pixelRows(ctx, X, Y, Wp, Hp, Rp, u, true);
        if (Wp > 2 * t && Hp > 2 * t) pixelRows(ctx, X + t, Y + t, Wp - 2 * t, Hp - 2 * t, Math.max(0, Rp - t), u, true);
        ctx.fill("evenodd");
        ctx.globalAlpha = 1;
      },
      pill(g, x, y, w, h, r, fill, o, alpha) {
        const ctx = g.ctx, pal = g.palette, kind = fillKind(fill), s = g.pxScale, u = 1 / s;
        const X = Math.round(x * s), Y = Math.round(y * s), Wp = Math.max(1, Math.round(w * s)), Hp = Math.max(1, Math.round(h * s));
        const Rp = Math.max(0, Math.min(Math.round(r * s), Wp >> 1, Hp >> 1));
        ctx.globalAlpha = alpha;
        if (kind === FILL_TINT || kind === FILL_OTHER) {
          ctx.fillStyle = fill;
          pixelRows(ctx, X, Y, Wp, Hp, Rp, u);
          ctx.globalAlpha = 1;
          return;
        }
        const body = kind === FILL_SOLID ? fill : pal.surface;
        if (o.glow) {
          ctx.globalAlpha = alpha * 0.35;
          ctx.fillStyle = pal.shadow;
          pixelRows(ctx, X + 1, Y + 1, Wp, Hp, Rp, u);
          ctx.globalAlpha = alpha;
        }
        ctx.fillStyle = kind === FILL_SOLID ? mixHex(body, pal.ink, 0.55) : pal.line;
        pixelRows(ctx, X, Y, Wp, Hp, Rp, u);
        ctx.fillStyle = body;
        pixelRows(ctx, X + 1, Y + 1, Wp - 2, Hp - 2, Math.max(0, Rp - 1), u);
        if (Wp > 4 && Hp > 3) {
          ctx.fillStyle = mixHex(body, "#FFFFFF", 0.4);
          ctx.fillRect((X + 1 + Math.max(1, Rp)) * u, (Y + 1) * u, Math.max(0, Wp - 2 - 2 * Math.max(1, Rp)) * u, u);
        }
        ctx.globalAlpha = 1;
      },
      textEffect() { return null; },
      imageOver(g, x, y, w, h, o, alpha) {
        if (o.circle) g.sprite("ring", x + w / 2, y + h / 2, Math.min(w, h) / 2, g.palette.ink, alpha, 1, 1, 0);
      },
      particle(g, kind, x, y, size, k, color) {
        const ctx = g.ctx, s = g.pxScale, u = 1 / s;
        const n = Math.max(1, Math.round(size * s * (0.4 + 0.5 * k)));
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.fillStyle = kind === 1 ? g.palette.glow : color;
        ctx.fillRect(Math.round(x * s) * u, Math.round(y * s) * u, n * u, n * u);
        ctx.globalAlpha = 1;
      },
    }),

    riso: skin({
      bubbleHalo: 0,
      orbHalo: 0,
      haloK: 0.6,
      ring(g, x, y, r, color, width, alpha) {
        const ctx = g.ctx, pal = g.palette;
        ctx.globalCompositeOperation = "multiply";
        ctx.lineWidth = width;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = alpha * 0.75;
        ctx.strokeStyle = color === pal.secondary ? pal.primary : pal.secondary;
        ctx.beginPath();
        ctx.arc(x + 1.1, y + 0.9, r, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      },
      line(g, x1, y1, x2, y2, color, width, alpha, cap) {
        const ctx = g.ctx;
        ctx.globalCompositeOperation = "multiply";
        SKIN_GLOW.line(g, x1, y1, x2, y2, color, width, alpha, cap);
        ctx.globalCompositeOperation = "multiply";
        SKIN_GLOW.line(g, x1 + 1.1, y1 + 0.9, x2 + 1.1, y2 + 0.9, color === g.palette.secondary ? g.palette.primary : g.palette.secondary, width, alpha * 0.7, cap);
        ctx.globalCompositeOperation = "source-over";
      },
      outline(g, x, y, w, h, r, color, width, o, alpha) {
        const ctx = g.ctx, pal = g.palette;
        const mul = !isHex(color) || relLum(color) < 0.8;
        ctx.lineWidth = Math.max(1.2, width);
        ctx.lineJoin = "round";
        if (mul) ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = color === pal.secondary ? pal.primary : pal.secondary;
        roundRectPath(ctx, x + 1.2, y + 1, w, h, r);
        ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        roundRectPath(ctx, x, y, w, h, r);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      },
      pill(g, x, y, w, h, r, fill, o, alpha) {
        const ctx = g.ctx, pal = g.palette, kind = fillKind(fill);
        if (kind === FILL_TINT || kind === FILL_OTHER) { flatPill(ctx, x, y, w, h, r, fill, alpha); return; }
        // Panels and paper-light fills print as paper (multiplying white would leave them clear).
        if (kind === FILL_PANEL || relLum(fill) > 0.8) {
          flatPill(ctx, x, y, w, h, r, kind === FILL_PANEL ? pal.surface : fill, alpha);
          ctx.globalCompositeOperation = "multiply";
          ctx.globalAlpha = alpha * 0.85;
          ctx.strokeStyle = pal.ink;
          ctx.lineWidth = 1.4;
          roundRectPath(ctx, x + 1, y + 0.8, w, h, r);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
          return;
        }
        const other = fill === pal.secondary ? pal.primary : pal.secondary;
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = alpha * 0.92;
        ctx.fillStyle = fill;
        roundRectPath(ctx, x, y, w, h, r);
        ctx.fill();
        if (w > 10 && h > 10) {
          ctx.save();
          ctx.clip();
          ctx.globalAlpha = alpha * 0.8;
          ctx.fillStyle = tilePattern(ctx, htTile(other, g.q2), g.pxScale);
          ctx.fillRect(x + w * 0.58, y, w * 0.42, h);
          ctx.restore();
        }
        ctx.globalAlpha = alpha * 0.7;
        ctx.strokeStyle = pal.ink;
        ctx.lineWidth = 1.3;
        roundRectPath(ctx, x + 1.2, y + 1, w, h, r);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      },
      textEffect(g, o) { return o.glow ? "riso" : null; },
      effColor(g, o, color) { return color === g.palette.primary ? g.palette.secondary : g.palette.primary; },
      imageOver(g, x, y, w, h, o, alpha) {
        if (o.circle) this.ring(g, x + w / 2, y + h / 2, Math.min(w, h) / 2, g.palette.primary, 2, alpha);
      },
      particle(g, kind, x, y, size, k, color) {
        const ctx = g.ctx;
        ctx.globalCompositeOperation = "multiply";
        SKIN_GLOW.circle(g, x, y, size * (0.4 + 0.5 * k), color, Math.min(1, k * 1.6));
        ctx.globalCompositeOperation = "source-over";
      },
    }),

    chalk: skin({
      bubbleHalo: 0.15,
      orbHalo: 0,
      haloK: 0.7,
      ring(g, x, y, r, color, width, alpha) {
        const ctx = g.ctx;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = tilePattern(ctx, chalkTile(color), g.pxScale);
        ctx.lineWidth = width * 1.3;
        wobblyCirclePath(ctx, x, y, r, ((r * 10) | 0) + 3, 0.03, 16);
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      line(g, x1, y1, x2, y2, color, width, alpha, cap) {
        SKIN_GLOW.line(g, x1, y1, x2, y2, tilePattern(g.ctx, chalkTile(color), g.pxScale), width * 1.3, alpha, cap);
      },
      outline(g, x, y, w, h, r, color, width, o, alpha) {
        const ctx = g.ctx;
        ctx.strokeStyle = isHex(color) ? tilePattern(ctx, chalkTile(color), g.pxScale) : color;
        ctx.lineWidth = Math.max(1.6, width * 1.3);
        ctx.lineJoin = "round";
        ctx.globalAlpha = alpha * 0.9;
        wobblyRectPath(ctx, x, y, w, h, r, ((w * 5) | 0) + ((h * 3) | 0) * 17 + 3, 0.7);
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      pill(g, x, y, w, h, r, fill, o, alpha) {
        const ctx = g.ctx, pal = g.palette, kind = fillKind(fill);
        if (kind === FILL_TINT || kind === FILL_OTHER) { flatPill(ctx, x, y, w, h, r, fill, alpha); return; }
        const col = kind === FILL_SOLID ? fill : pal.ink;
        roundRectPath(ctx, x, y, w, h, r);
        if (kind === FILL_SOLID) {
          ctx.globalAlpha = alpha * 0.16;
          ctx.fillStyle = col;
          ctx.fill();
          ctx.globalAlpha = alpha * 0.32;
          ctx.fillStyle = tilePattern(ctx, chalkTile(col), g.pxScale);
          ctx.fill();
        } else {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = pal.surface;
          ctx.fill();
        }
        ctx.strokeStyle = tilePattern(ctx, chalkTile(col), g.pxScale);
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.globalAlpha = alpha * 0.9;
        wobblyRectPath(ctx, x, y, w, h, r, ((w * 5) | 0) + ((h * 3) | 0) * 17, 0.7);
        ctx.stroke();
        ctx.globalAlpha = 1;
      },
      textEffect() { return "chalk"; },
      effColor() { return ""; },
      imageOver(g, x, y, w, h, o, alpha) {
        if (o.circle) this.ring(g, x + w / 2, y + h / 2, Math.min(w, h) / 2, g.palette.ink, 2, alpha);
      },
      particle(g, kind, x, y, size, k, color) {
        g.sprite("spark", x, y, size * (0.5 + 0.5 * k), kind === 0 ? g.palette.ink : color, Math.min(1, k * 1.2), 1, 1, 0);
      },
    }),
  };

  class Graphics {
    constructor() {
      this.ctx = null;
      this.w = W;
      this.h = H;
      this.t = 0;
      this.pendingImages = null;
      this.dash = null;
      this.clipDepth = 0;
      this.style = resolveStyle(null);
      this.palette = this.style.palette;
      this.look = "glow";
      this.font = "rounded";
      this.fontStack = FONT_STACK;
      this.motif = "none";
      this.skin = SKIN_GLOW;
      this.painters = SPRITE_PAINTERS.glow;
      this.view = { x0: 0, y0: 0, x1: W, y1: H, w: W, h: H };
      this.pxScale = 1;
      this.px = 1;
      this.q2 = 2;
      this.reduced = false;
      this.poster = false;
      this.allowTainted = true;
      this.lowRes = false;
      this.pixelFont = false;
      this.boil = 0;
      this.sceneryCalls = 0;
      this.ease = ease;
      this.spring = ease.spring;
      this.lastFont = "";
    }

    begin(ctx, style, pxScale, view, t, flags) {
      this.ctx = ctx;
      this.clipDepth = 0;
      this.dash = null;
      this.style = style;
      this.palette = style.palette;
      this.look = style.look;
      this.font = style.font;
      this.fontStack = style.fontStack;
      this.motif = style.motif;
      this.skin = SKINS[style.look] || SKIN_GLOW;
      this.painters = SPRITE_PAINTERS[style.look] || SPRITE_PAINTERS.glow;
      this.pxScale = pxScale;
      this.px = 1 / pxScale;
      this.q2 = clamp(Math.round(pxScale * 2), 1, 12);
      this.view = view;
      this.t = t;
      this.reduced = !!flags.reduced;
      this.poster = !!flags.poster;
      this.allowTainted = !flags.poster;
      this.lowRes = !!flags.lowRes;
      this.pixelFont = style.font === "pixel" || this.lowRes;
      this.boil = this.reduced || this.poster ? 0 : Math.floor(t * 5) % 3;
      this.lastFont = "";
    }

    rgba(hex, a) { return rgba(hex, a); }
    mix(a, b, t) { return mixHex(a, b, t); }

    // Draws a cached look sprite centered at (x, y) with radius r.
    sprite(kind, x, y, r, color, alpha, sx, sy, v) {
      const P = this.painters;
      const paint = P[kind] || SPRITE_PAINTERS.glow[kind];
      const ctx = this.ctx;
      if (this.lowRes) {
        const R = Math.max(1, Math.round(r * this.pxScale));
        const S = 2 * R + 3;
        const sp = spriteFor(this.palette, kind, R, color, v, 0, S, paint);
        const u = 1 / this.pxScale;
        const size = S * u;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sp, Math.round((x - (size * sx) / 2) * this.pxScale) * u, Math.round((y - (size * sy) / 2) * this.pxScale) * u, size * sx, size * sy);
        ctx.globalAlpha = 1;
        return;
      }
      const R = quantR(r * this.pxScale);
      const pad = (P.pad && P.pad[kind]) || 0;
      const S = Math.ceil(2 * R * (1 + pad) + 4);
      const sp = spriteFor(this.palette, kind, R, color, v, this.q2, S, paint);
      const size = (S / this.pxScale) * ((r * this.pxScale) / R);
      ctx.globalAlpha = alpha;
      ctx.drawImage(sp, x - (size * sx) / 2, y - (size * sy) / 2, size * sx, size * sy);
      ctx.globalAlpha = 1;
    }

    halo(x, y, r, color, alpha) {
      if (!(r > 0) || !(alpha > 0.003)) return;
      this.skin.halo(this, x, y, r, color || this.palette.glow, clamp(alpha, 0, 1));
    }

    puff(x, y, r, color, alpha) {
      if (!(r > 0)) return;
      this.skin.puff(this, x, y, r, color || this.palette.glow, alpha === undefined ? 1 : clamp(alpha, 0, 1));
    }

    spark(x, y, r, color, alpha) {
      if (!(r > 0)) return;
      this.skin.spark(this, x, y, r, color || this.palette.glow, alpha === undefined ? 1 : clamp(alpha, 0, 1));
    }

    bubble(x, y, r, o) {
      o = o || EMPTY;
      if (!(r > 0)) return;
      const alpha = o.alpha === undefined ? 1 : clamp(o.alpha, 0, 1);
      if (alpha <= 0.003) return;
      let sx = o.sx || 1, sy = o.sy || 1;
      if (o.wobble && !this.reduced) {
        const wv = Math.sin(this.t * 4.2 + x * 0.05 + y * 0.03) * 0.04 * o.wobble;
        sx *= 1 + wv;
        sy *= 1 - wv;
      }
      this.skin.bubble(this, x, y, r, o.tint || this.palette.glow, o.glow === undefined ? 1 : o.glow, alpha, sx, sy);
      if (o.emoji) this.emoji(o.emoji, x, y + r * 0.04, r * 1.1);
      if (o.label !== undefined && o.label !== null && o.label !== "") {
        this.text(String(o.label), x, y + 1, { size: o.labelSize || r * 0.95, weight: 800, color: o.labelColor || this.palette.ink, alpha, glow: o.labelGlow });
      }
    }

    orb(x, y, r, color, o) {
      o = o || EMPTY;
      if (!(r > 0)) return;
      const alpha = o.alpha === undefined ? 1 : clamp(o.alpha, 0, 1);
      if (alpha <= 0.003) return;
      color = color || this.palette.primary;
      this.skin.orb(this, x, y, r, color, o.glow === undefined ? 0.8 : o.glow, alpha);
      if (o.ring) this.skin.ring(this, x, y, r + 2.5, typeof o.ring === "string" ? o.ring : "#FFFFFF", 2, 0.85 * alpha);
    }

    circle(x, y, r, color, alpha) {
      if (!(r > 0)) return;
      this.skin.circle(this, x, y, r, color || this.palette.glow, alpha === undefined ? 1 : clamp(alpha, 0, 1));
    }

    ring(x, y, r, color, o) {
      if (!(r > 0)) return;
      o = o || EMPTY;
      this.skin.ring(this, x, y, r, color || this.palette.glow, o.width || 2, o.alpha === undefined ? 1 : clamp(o.alpha, 0, 1));
    }

    line(x1, y1, x2, y2, color, o) {
      o = o || EMPTY;
      const dashed = o.dash ? this.setDash(o.dash) : false;
      this.skin.line(this, x1, y1, x2, y2, color || this.palette.glow, o.width || 2, o.alpha === undefined ? 1 : clamp(o.alpha, 0, 1), o.cap || "round");
      if (dashed) this.setDash(null);
    }

    // A soft halo around a rounded rectangle (9-slice of a pre-blurred frame).
    glowRect(x, y, w, h, r, color, alpha) {
      if (alpha <= 0.003 || w <= 0 || h <= 0) return;
      const s = this.pxScale;
      const Rd = Math.max(2, Math.round(Math.min(r, w / 2, h / 2) * s / 2) * 2);
      const Ed = Math.max(4, Math.round(Math.min(18, Math.max(6, Math.min(w, h) * 0.35)) * s / 2) * 2);
      const sp = glowFrameSprite(Rd, Ed, color);
      const C = Rd + Ed;
      const Cl = C / s, El = Ed / s;
      const X = x - El, Y = y - El, DW = w + 2 * El, DH = h + 2 * El;
      const cw = Math.min(Cl, DW / 2), ch = Math.min(Cl, DH / 2);
      const ctx = this.ctx;
      ctx.globalAlpha = clamp(alpha, 0, 1);
      const S = sp.width;
      const mid = C;
      ctx.drawImage(sp, 0, 0, C, C, X, Y, cw, ch);
      ctx.drawImage(sp, S - C, 0, C, C, X + DW - cw, Y, cw, ch);
      ctx.drawImage(sp, 0, S - C, C, C, X, Y + DH - ch, cw, ch);
      ctx.drawImage(sp, S - C, S - C, C, C, X + DW - cw, Y + DH - ch, cw, ch);
      if (DW - 2 * cw > 0.5) {
        ctx.drawImage(sp, mid, 0, 2, C, X + cw, Y, DW - 2 * cw, ch);
        ctx.drawImage(sp, mid, S - C, 2, C, X + cw, Y + DH - ch, DW - 2 * cw, ch);
      }
      if (DH - 2 * ch > 0.5) {
        ctx.drawImage(sp, 0, mid, C, 2, X, Y + ch, cw, DH - 2 * ch);
        ctx.drawImage(sp, S - C, mid, C, 2, X + DW - cw, Y + ch, cw, DH - 2 * ch);
      }
      ctx.globalAlpha = 1;
    }

    // fill: a color (default palette.surface), or null / "none" for an outline-only pill.
    // stroke, strokeWidth: an outline in the look's line style; dash: [on, off] for the outline.
    pill(x, y, w, h, o) {
      o = o || EMPTY;
      if (!(w > 0) || !(h > 0)) return;
      const alpha = o.alpha === undefined ? 1 : clamp(o.alpha, 0, 1);
      if (alpha <= 0.003) return;
      const r = Math.min(o.radius === undefined ? Math.min(w, h) / 2 : o.radius, w / 2, h / 2);
      const fill = o.fill === undefined ? this.palette.surface : o.fill;
      const filled = !!fill && fill !== "none" && fill !== "transparent";
      if (filled) this.skin.pill(this, x, y, w, h, r, fill, o, alpha);
      if (!o.stroke) return;
      const dashed = this.setDash(o.dash);
      this.skin.outline(this, x, y, w, h, r, o.stroke, o.strokeWidth || 1, o, alpha, filled);
      if (dashed) this.setDash(null);
    }

    // Dashes for the next strokes ([on, off] in playfield units); null clears them.
    setDash(d) {
      const ok = Array.isArray(d) && d.length > 0 && d[0] > 0;
      this.dash = ok ? d : null;
      if (typeof this.ctx.setLineDash === "function") this.ctx.setLineDash(ok ? d : NO_DASH);
      return ok;
    }

    // A polyline through [x0, y0, x1, y1, ...] in the look's line style. o: {width, alpha, cap,
    // dash, closed, fill (a color: fills the shape first)}.
    path(points, color, o) {
      o = o || EMPTY;
      if (!points || points.length < 4) return;
      const alpha = o.alpha === undefined ? 1 : clamp(o.alpha, 0, 1);
      if (alpha <= 0.003) return;
      const n = points.length >> 1, ctx = this.ctx;
      if (o.fill && n >= 3) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = o.fill;
        if (this.look === "riso") ctx.globalCompositeOperation = "multiply";
        ctx.beginPath();
        ctx.moveTo(points[0], points[1]);
        for (let i = 1; i < n; i++) ctx.lineTo(points[2 * i], points[2 * i + 1]);
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }
      if (color === null || color === "none") return;
      const c = color || this.palette.ink, w = o.width || 2, cap = o.cap || "round";
      const dashed = this.setDash(o.dash);
      const last = o.closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const j = (i + 1) % n;
        this.skin.line(this, points[2 * i], points[2 * i + 1], points[2 * j], points[2 * j + 1], c, w, alpha, cap);
      }
      if (dashed) this.setDash(null);
    }

    // Clips what's drawn next to a rounded rect until unclip() (or the end of the layer).
    clip(x, y, w, h, r) {
      const ctx = this.ctx;
      ctx.save();
      roundRectPath(ctx, x, y, Math.max(0, w), Math.max(0, h), Math.max(0, Math.min(r || 0, w / 2, h / 2)));
      ctx.clip();
      this.clipDepth++;
    }

    unclip() {
      if (this.clipDepth <= 0) return;
      this.ctx.restore();
      this.clipDepth--;
      this.lastFont = "";
    }

    text(s, x, y, o) {
      if (s === undefined || s === null || s === "") return;
      o = o || EMPTY;
      s = typeof s === "string" ? s : String(s);
      const size = o.size || 16;
      const color = o.color || this.palette.ink;
      const alpha = o.alpha === undefined ? 1 : clamp(o.alpha, 0, 1);
      if (alpha <= 0.003) return;
      const align = o.align || "center";
      const baseline = o.baseline || "middle";
      if (this.pixelFont && this.pixelText(s, x, y, size, color, alpha, align, baseline, o.maxWidth)) return;
      const skin = this.skin;
      const weight = skin.weight(o.weight || 700);
      const ctx = this.ctx;
      const effect = skin.textEffect(this, o);
      if (effect) {
        const sp = textSprite(s, size, weight, color, effect, skin.effColor(this, o, color), this.pxScale, this.fontStack);
        let w = sp.width / this.pxScale, h = sp.height / this.pxScale;
        const pad = Math.ceil(size * this.pxScale * 0.6) / this.pxScale;
        let k = 1;
        if (o.maxWidth && w - 2 * pad > o.maxWidth) k = o.maxWidth / (w - 2 * pad);
        w *= k;
        h *= k;
        let dx = x - w / 2;
        if (align === "left" || align === "start") dx = x - pad * k;
        else if (align === "right" || align === "end") dx = x - w + pad * k;
        let dy = y - h / 2;
        if (baseline === "top") dy = y - pad * k - size * 0.15;
        else if (baseline === "bottom" || baseline === "alphabetic") dy = y - h + pad * k + size * 0.2;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sp, dx, dy, w, h);
        ctx.globalAlpha = 1;
        return;
      }
      const font = fontFor(size, weight, this.fontStack);
      if (this.lastFont !== font) { ctx.font = font; this.lastFont = font; }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      if (o.maxWidth) ctx.fillText(s, x, y, o.maxWidth);
      else ctx.fillText(s, x, y);
      ctx.globalAlpha = 1;
    }

    // The built-in 5x7 pixel face; returns false when the text can't use it (unsupported
    // characters or too wide), so the caller falls back to the look's font.
    pixelText(s, x, y, size, color, alpha, align, baseline, maxWidth) {
      const n = pixelFitsCached(s);
      if (n < 0) return false;
      const ps = this.pxScale;
      let k = Math.max(1, Math.round((size * ps) / 9));
      if (maxWidth) while (k > 1 && ((n * 6 + 2) * k) / ps > maxWidth + 4) k--;
      let mini = false;
      if ((maxWidth && ((n * 6) * k) / ps > maxWidth * 1.12) || (size * ps) / 9 < 0.72) {
        // Too wide or too small for the 5x7 face: the 3x5 face, else the look's font.
        k = Math.max(1, Math.round((size * ps) / 7));
        if (maxWidth) while (k > 1 && ((n * 4 + 2) * k) / ps > maxWidth + 4) k--;
        if (maxWidth && ((n * 4) * k) / ps > maxWidth * 1.12) return false;
        mini = true;
      }
      const sp = pixelTextSprite(s, k, color, pixelShadowFor(color), mini);
      const w = sp.width / ps, h = sp.height / ps, unit = k / ps;
      let dx = x - w / 2;
      if (align === "left" || align === "start") dx = x - unit;
      else if (align === "right" || align === "end") dx = x - w + unit;
      let dy = y - h / 2 + unit * 0.5;
      if (baseline === "top") dy = y - unit;
      else if (baseline === "bottom" || baseline === "alphabetic") dy = y - h + unit * 2;
      if (this.lowRes) {
        dx = Math.round(dx * ps) / ps;
        dy = Math.round(dy * ps) / ps;
      }
      const ctx = this.ctx;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sp, dx, dy, w, h);
      ctx.globalAlpha = 1;
      return true;
    }

    // Splits text into lines that fit maxWidth (cached).
    wrapText(s, maxWidth, size, weight) {
      const key = s + "|" + maxWidth + "|" + size + "|" + (weight || 700) + "|" + this.fontStack + "|" + (this.pixelFont ? 1 : 0);
      let lines = wrapCache.get(key);
      if (lines) return lines;
      const probe = Host.measureCtx();
      probe.font = fontFor(size, this.skin.weight(weight || 700), this.fontStack);
      const pixel = this.pixelFont;
      const kpx = Math.max(1, Math.round((size * this.pxScale) / 9));
      const measure = (t) => (pixel && pixelFontFits(t) ? (pixelChars(t).length * 6 * kpx) / this.pxScale : probe.measureText(t).width);
      lines = [];
      let line = "";
      for (const word of String(s).split(/\s+/)) {
        const next = line ? line + " " + word : word;
        if (line && measure(next) > maxWidth) { lines.push(line); line = word; }
        else line = next;
      }
      if (line) lines.push(line);
      if (wrapCache.size > 400) wrapCache.clear();
      wrapCache.set(key, lines);
      return lines;
    }

    // o: an alpha (number) or {alpha}.
    emoji(s, x, y, size, o) {
      if (!s || !(size > 0)) return;
      const alpha = typeof o === "number" ? clamp(o, 0, 1) : o && o.alpha !== undefined ? clamp(o.alpha, 0, 1) : 1;
      if (alpha <= 0.003) return;
      const sp = emojiSprite(String(s), size, this.pxScale);
      const k = size / (sp.width / 1.4 / this.pxScale);
      const w = (sp.width / this.pxScale) * k, h = (sp.height / this.pxScale) * k;
      if (alpha < 1) this.ctx.globalAlpha = alpha;
      this.ctx.drawImage(sp, x - w / 2, y - h / 2, w, h);
      if (alpha < 1) this.ctx.globalAlpha = 1;
    }

    image(url, x, y, w, h, o) {
      o = o || EMPTY;
      const alpha = o.alpha === undefined ? 1 : clamp(o.alpha, 0, 1);
      const rec = Images.load(url);
      const ctx = this.ctx;
      if (rec && rec.ok && (rec.cors || this.allowTainted)) {
        this.skin.imageUnder(this, x, y, w, h, o, alpha);
        const sp = imageSprite(rec, url, w * this.pxScale, h * this.pxScale, !!o.circle, (o.radius || 0) * this.pxScale);
        ctx.globalAlpha = alpha;
        ctx.drawImage(sp, x, y, w, h);
        ctx.globalAlpha = 1;
        this.skin.imageOver(this, x, y, w, h, o, alpha);
        return;
      }
      // Placeholder until it loads: a soft orb with an initial.
      if (rec && !rec.ok && !rec.failed && this.pendingImages && this.pendingImages.indexOf(rec) < 0) this.pendingImages.push(rec);
      const color = this.palette.accents[hashString(String(url || "")) % 4];
      if (o.circle) this.orb(x + w / 2, y + h / 2, Math.min(w, h) / 2, color, { glow: 0, alpha });
      else this.pill(x, y, w, h, { fill: color, radius: o.radius || 8, alpha });
      if (o.placeholder) this.text(String(o.placeholder).charAt(0).toUpperCase(), x + w / 2, y + h / 2 + 1, { size: Math.min(w, h) * 0.42, weight: 800, color: this.palette.inkOn(color), alpha });
    }

    // A see-through bubble over something (a portrait, a letter): the soap bubble in glow, a rim
    // and a highlight in looks whose bubbles are opaque.
    lens(x, y, r, o) {
      o = o || EMPTY;
      if (!(r > 0)) return;
      const alpha = o.alpha === undefined ? 1 : clamp(o.alpha, 0, 1);
      if (alpha <= 0.003) return;
      const tint = o.tint || this.palette.glow;
      if (this.look === "glow") { this.skin.bubble(this, x, y, r, tint, o.glow === undefined ? 0.7 : o.glow, alpha, 1, 1); return; }
      const rim = this.look === "neon" || this.look === "riso" || this.look === "chalk" ? (tint === this.palette.glow ? this.palette.primary : tint) : this.look === "ink" ? this.palette.ink : tint === this.palette.glow ? this.palette.surfaceStrong : tint;
      this.skin.ring(this, x, y, r, isHex(rim) ? rim : this.palette.ink, Math.max(2, r * 0.07), alpha);
      if (this.look !== "pixel") this.skin.line(this, x - r * 0.52, y - r * 0.5, x - r * 0.32, y - r * 0.66, "#FFFFFF", Math.max(2, r * 0.07), alpha * 0.85, "round");
    }

    // One pooled particle (fx.pop, fx.sparkle) in this look. k: remaining life 0..1.
    particle(kind, x, y, size, k, color, vx, vy, i) {
      this.skin.particle(this, kind, x, y, size, k, color, vx, vy, i);
    }

    // Parallax scenery for a motif in this look ("auto": the style's motif, else hills).
    scenery(motif, o) {
      o = o || EMPTY;
      this.sceneryCalls++;
      Scenery.draw(this, Scenery.pick(this, motif), o.scroll || 0, o);
    }

    // A ground band at floor (logical y) that scrolls with the world.
    ground(floor, scroll, o) {
      Scenery.ground(this, floor, scroll || 0, o || EMPTY);
    }
  }
  const wrapCache = new Map();

  // ----- scenery: motifs (style.motif, space backdrops) drawn in each look -----
  // Ridges, waves, skylines and the ground are pre-rendered into horizontally tileable strips
  // (y and h in playfield units, period = tile width); clouds, stars, dots, leaves and grids are
  // drawn from look sprites. speed: parallax factor of the world scroll.
  const MOTIF_LAYERS = {
    hills: [
      { kind: "ridge", y: 300, h: 360, period: 720, speed: 0.12, depth: 0, base: 170, amp: 120, n1: 2, n2: 5, ph: 1.7 },
      { kind: "ridge", y: 400, h: 260, period: 540, speed: 0.3, depth: 1, base: 145, amp: 90, n1: 3, n2: 7, ph: 0.4 },
    ],
    city: [
      { kind: "ridge", y: 290, h: 370, period: 720, speed: 0.08, depth: 0, base: 140, amp: 110, n1: 2, n2: 3, ph: 0.9 },
      { kind: "skyline", y: 380, h: 280, period: 640, speed: 0.28, depth: 1, ground: 180 },
    ],
    waves: [
      { kind: "ridge", y: 360, h: 300, period: 720, speed: 0.1, depth: 0, base: 140, amp: 70, n1: 2, n2: 5, ph: 2.2 },
      { kind: "wave", y: 516, h: 144, period: 360, speed: 0.25, depth: 1, base: 22, amp: 5, n: 6, ph: 0, bob: 0.8 },
      { kind: "wave", y: 542, h: 118, period: 360, speed: 0.45, depth: 1, base: 22, amp: 7, n: 5, ph: 1.3, bob: 1.1 },
      { kind: "wave", y: 568, h: 92, period: 360, speed: 0.65, depth: 2, base: 22, amp: 9, n: 4, ph: 2.6, bob: 1.4 },
    ],
    clouds: [
      { kind: "clouds", y: 40, h: 360, period: 720, speed: 0.1, depth: 0, count: 5, seed: 11 },
      { kind: "clouds", y: 100, h: 320, period: 560, speed: 0.22, depth: 1, count: 3, seed: 23 },
    ],
    stars: [{ kind: "stars", y: 0, h: 660, period: 540, speed: 0.03, depth: 0, count: 64, seed: 5 }],
    dots: [{ kind: "dots", y: 0, h: 680, period: 360, speed: 0.06, depth: 0, gap: 44 }],
    leaves: [
      { kind: "leaves", y: 0, h: 660, period: 600, speed: 0.08, depth: 0, count: 11, seed: 3 },
      { kind: "leaves", y: 0, h: 660, period: 480, speed: 0.18, depth: 1, count: 5, seed: 9 },
    ],
    grid: [{ kind: "grid", y: 0, h: 680, period: 360, speed: 0.15, depth: 0 }],
    none: [],
  };
  const GROUND_LAYER = { kind: "ground", y: 0, h: 120, period: 144, speed: 1, depth: 2 };

  function ridgeY(L, x) {
    if (L.kind === "wave") return L.base + L.amp * Math.sin((x / L.period) * L.n * TAU + L.ph);
    if (L.kind === "ground") return 6 + Math.cos((x / 144) * TAU) * 3;
    const u = (x / L.period) * TAU;
    return L.base - L.amp * (0.55 + 0.3 * Math.cos(u * L.n1) + 0.15 * Math.cos(u * L.n2 + L.ph));
  }

  function sceneryColor(pal, look, depth) {
    const a = depth === 0 ? pal.secondary : depth === 1 ? pal.primary : pal.accent;
    switch (look) {
      case "glow": return depth === 0 ? mixHex(pal.bgTop, pal.glow, pal.dark ? 0.12 : 0.45) : depth === 1 ? mixHex(pal.bgBottom, pal.accent, pal.dark ? 0.25 : 0.3) : mixHex(pal.bgBottom, pal.secondary, pal.dark ? 0.2 : 0.35);
      case "paper": return mixHex(depth === 0 ? pal.bgTop : pal.bgBottom, a, depth === 0 ? 0.32 : depth === 1 ? 0.45 : 0.6);
      case "clay": return mixHex(depth === 0 ? pal.bgTop : pal.bgBottom, a, depth === 0 ? 0.35 : depth === 1 ? 0.5 : 0.62);
      case "pixel": return mixHex(depth === 0 ? pal.bgTop : pal.bgBottom, a, depth === 0 ? 0.42 : depth === 1 ? 0.56 : 0.7);
      default: return a;
    }
  }

  function polyPath(ctx, pts, bottom) {
    ctx.beginPath();
    ctx.moveTo(pts[0], bottom);
    for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.lineTo(pts[pts.length - 2], bottom);
    ctx.closePath();
  }
  function topPath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  }
  function hatchLines(ctx, x0, y0, x1, y1, gap) {
    ctx.beginPath();
    const span = y1 - y0;
    for (let x = x0 - span; x < x1; x += gap) {
      ctx.moveTo(x, y1);
      ctx.lineTo(x + span, y0);
    }
    ctx.stroke();
  }
  // Pixel look: snap anti-aliased edges to fully opaque or clear.
  function crispAlpha(ctx) {
    const c = ctx.canvas;
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 100 ? 255 : 0;
    ctx.putImageData(img, 0, 0);
  }

  // Paints one scenery shape in a look. pathFn builds the shape, edgeFn (optional) the edge to
  // ink or light; b: bounds {x0, y0, x1, y1} for textures.
  function shapePaint(ctx, look, pal, color, depth, res, pathFn, edgeFn, b, role) {
    const edge = edgeFn || pathFn;
    switch (look) {
      case "paper": {
        ctx.save();
        ctx.translate(0, 3 + depth);
        pathFn();
        ctx.fillStyle = rgba(pal.shadow, 0.2);
        ctx.fill();
        ctx.restore();
        pathFn();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.save();
        ctx.clip();
        grainOver(ctx, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 0.6, false);
        ctx.restore();
        edge();
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        break;
      }
      case "neon": {
        pathFn();
        ctx.fillStyle = mixHex(pal.bgBottom, "#000000", 0.3 - depth * 0.06);
        ctx.fill();
        edge();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.shadowColor = color;
        ctx.shadowBlur = 9 * res;
        ctx.stroke();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = mixHex(color, "#FFFFFF", 0.6);
        ctx.lineWidth = 0.8;
        ctx.stroke();
        break;
      }
      case "ink": {
        pathFn();
        ctx.fillStyle = mixHex(pal.bgTop, "#FFFFFF", 0.6);
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = rgba(pal.ink, 0.2 + depth * 0.05);
        ctx.lineWidth = 0.9;
        hatchLines(ctx, b.x0, b.y0, b.x1, b.y1, 6.5 - depth);
        const fade = ctx.createLinearGradient(0, b.y0 + 16, 0, b.y0 + 70);
        fade.addColorStop(0, rgba(mixHex(pal.bgTop, "#FFFFFF", 0.6), 0));
        fade.addColorStop(1, mixHex(pal.bgTop, "#FFFFFF", 0.6));
        ctx.fillStyle = fade;
        ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0 + 20);
        ctx.restore();
        edge();
        ctx.strokeStyle = pal.ink;
        ctx.lineWidth = 1.6;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
        break;
      }
      case "clay": {
        ctx.save();
        ctx.shadowColor = rgba(pal.shadow, 0.3);
        ctx.shadowBlur = 10 * res;
        ctx.shadowOffsetY = 3 * res;
        pathFn();
        // The shading ends well above the strip's bottom, whose rows tile below it.
        const gr = ctx.createLinearGradient(0, b.y0, 0, b.y0 + Math.min(140, Math.max(30, b.y1 - b.y0 - 48)));
        gr.addColorStop(0, mixHex(color, "#FFFFFF", 0.32));
        gr.addColorStop(0.45, color);
        gr.addColorStop(1, mixHex(color, pal.ink, 0.12));
        ctx.fillStyle = gr;
        ctx.fill();
        ctx.restore();
        edge();
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 2.5;
        ctx.lineJoin = "round";
        ctx.stroke();
        break;
      }
      case "pixel": {
        pathFn();
        ctx.fillStyle = color;
        ctx.fill();
        edge();
        ctx.strokeStyle = mixHex(color, pal.ink, 0.45);
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case "riso": {
        ctx.globalCompositeOperation = "multiply";
        pathFn();
        ctx.globalAlpha = 0.82;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.clip();
        ctx.fillStyle = ctx.createPattern(halftoneTile(color === pal.secondary ? pal.primary : pal.secondary, Math.max(3, 3.4 * res), 0.55), "repeat");
        ctx.globalAlpha = 0.7;
        ctx.fillRect(b.x0, b.y0 + 40, b.x1 - b.x0, b.y1 - b.y0);
        ctx.restore();
        ctx.save();
        ctx.translate(1.5, 1);
        edge();
        ctx.strokeStyle = pal.ink;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
        ctx.globalCompositeOperation = "source-over";
        break;
      }
      case "chalk": {
        pathFn();
        ctx.fillStyle = rgba(color, 0.1);
        ctx.fill();
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = chalkPattern(ctx, color, 97);
        ctx.fill();
        ctx.globalAlpha = 1;
        edge();
        ctx.strokeStyle = chalkPattern(ctx, color, 99);
        ctx.lineWidth = 2.4;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.globalAlpha = 0.5;
        ctx.translate(0.6, 0.5);
        ctx.stroke();
        ctx.translate(-0.6, -0.5);
        ctx.globalAlpha = 1;
        break;
      }
      default: {
        pathFn();
        ctx.fillStyle = color;
        ctx.fill();
        if (role === "ground") {
          edge();
          ctx.strokeStyle = mixHex(color, pal.glow, 0.35);
          ctx.lineWidth = 3;
          ctx.globalAlpha = 0.9;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  function paintStrip(ctx, L, pal, look, res) {
    ctx.setTransform(res, 0, 0, res, 0, 0);
    const P = L.period, bottom = L.h + 4;
    const color = L.kind === "ground" ? (look === "glow" ? mixHex(pal.bgBottom, pal.secondary, pal.dark ? 0.2 : 0.35) : sceneryColor(pal, look, 2)) : sceneryColor(pal, look, L.depth);
    if (L.kind === "skyline") {
      let x = 0, i = 0;
      const items = [];
      while (x < P - 20) {
        let w = 34 + Math.floor(hashN(901, i) * 24);
        if (P - x - w - 6 < 30) w = P - x - 6;
        const ht = 70 + Math.floor(hashN(902, i) * 95);
        items.push({ x, w, top: L.ground - ht, roof: Math.floor(hashN(903, i) * 3), c: i % 4 });
        x += w + 6;
        i++;
      }
      for (const it of items) {
        for (const dx of [-P, 0, P]) {
          const bx = it.x + dx;
          if (bx > P + 4 || bx + it.w < -4) continue;
          const c = look === "glow" ? mixHex(pal.accents[it.c], pal.bgBottom, 0.55) : look === "ink" ? pal.ink : mixHex(sceneryColor(pal, look, 1), pal.accents[it.c], look === "paper" || look === "clay" || look === "pixel" ? 0.35 : 1);
          const r = it.roof === 0 ? it.w / 2 : it.roof === 1 ? 6 : 0;
          const pathFn = () => {
            if (it.roof === 2) {
              ctx.beginPath();
              ctx.moveTo(bx, bottom);
              ctx.lineTo(bx, it.top + 14);
              ctx.lineTo(bx + it.w / 2, it.top - 4);
              ctx.lineTo(bx + it.w, it.top + 14);
              ctx.lineTo(bx + it.w, bottom);
              ctx.closePath();
            } else roundRectPath(ctx, bx, it.top, it.w, bottom - it.top + 20, r);
          };
          if (look === "glow") ctx.globalAlpha = 0.75;
          shapePaint(ctx, look, pal, c, 1, res, pathFn, null, { x0: bx - 2, y0: it.top - 6, x1: bx + it.w + 2, y1: bottom }, "building");
          ctx.globalAlpha = 1;
          // windows
          const lit = look === "neon" ? pal.accent : look === "ink" ? pal.ink : look === "riso" ? pal.bgTop : look === "chalk" ? pal.ink : look === "glow" ? mixHex(pal.glow, pal.accent, 0.4) : mixHex(c, "#FFFFFF", 0.55);
          ctx.fillStyle = lit;
          ctx.strokeStyle = lit;
          ctx.globalAlpha = look === "glow" ? 0.55 : look === "ink" ? 0.7 : 0.85;
          if (look === "neon") { ctx.shadowColor = lit; ctx.shadowBlur = 6 * res; }
          for (let wy = it.top + (it.roof === 0 ? it.w / 2 : it.roof === 2 ? 22 : 14); wy < L.ground - 8; wy += 18) {
            for (const wx of it.w > 40 ? [bx + 7, bx + it.w - 13] : [bx + 7]) {
              if (hashN((wx * 7) | 0, (wy * 3) | 0) < (look === "neon" ? 0.45 : 0.25)) continue;
              if (look === "ink" || look === "chalk") { ctx.lineWidth = 1; ctx.strokeRect(wx, wy, 6, 8); }
              else ctx.fillRect(wx, wy, 6, 8);
            }
          }
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }
      }
      // The street the buildings stand on (its bottom rows tile below the strip).
      const top = L.ground;
      shapePaint(ctx, look, pal, sceneryColor(pal, look, 1), 2, res, () => { ctx.beginPath(); ctx.rect(-12, top, P + 24, bottom - top + 8); }, () => { ctx.beginPath(); ctx.moveTo(-12, top); ctx.lineTo(P + 12, top); }, { x0: -12, y0: top - 4, x1: P + 12, y1: bottom + 8 }, "street");
    } else {
      const pts = [];
      const jitter = look === "ink" || look === "chalk";
      for (let x = -12, i = 0; x <= P + 12; x += 6, i++) pts.push(x, ridgeY(L, ((x % P) + P) % P) + (jitter ? (hashN(L.period + L.depth, i) - 0.5) * 1.2 : 0));
      let minY = 1e9;
      for (let i = 1; i < pts.length; i += 2) if (pts[i] < minY) minY = pts[i];
      // Fills run past the canvas bottom: at fractional scales its last pixel row must be solid,
      // since that's where the tail (tiled below the strip) comes from.
      shapePaint(ctx, look, pal, color, L.depth, res, () => polyPath(ctx, pts, bottom + 8), () => topPath(ctx, pts), { x0: -12, y0: minY - 4, x1: P + 12, y1: bottom + 8 }, L.kind);
    }
    if (look === "pixel") crispAlpha(ctx);
  }

  // Leaves: one painter for every look (the look is on the palette).
  function leafPaint(ctx, c, R, color, pal, v, px) {
    ctx.translate(c, c);
    ctx.rotate(v * 1.3 + 0.4);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-R * 0.9, 0);
      ctx.quadraticCurveTo(0, -R * 0.78, R * 0.9, 0);
      ctx.quadraticCurveTo(0, R * 0.78, -R * 0.9, 0);
      ctx.closePath();
    };
    const vein = (col, w) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(-R * 0.75, 0);
      ctx.lineTo(R * 0.7, 0);
      ctx.stroke();
    };
    const lw = Math.max(1, 1.5 * px);
    switch (pal.look) {
      case "paper":
        ctx.save(); ctx.translate(0, R * 0.12); path(); ctx.fillStyle = rgba(pal.shadow, 0.25); ctx.fill(); ctx.restore();
        path(); ctx.fillStyle = color; ctx.fill(); vein("rgba(255,255,255,0.55)", lw); break;
      case "neon":
        path(); ctx.shadowColor = color; ctx.shadowBlur = R * 0.4; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke(); ctx.shadowBlur = 0; vein(color, lw * 0.7); break;
      case "ink":
        path(); ctx.fillStyle = rgba(color, 0.45); ctx.fill(); ctx.strokeStyle = pal.ink; ctx.lineWidth = lw; ctx.stroke(); vein(pal.ink, lw * 0.7); break;
      case "clay": {
        path();
        const g = ctx.createLinearGradient(0, -R * 0.6, 0, R * 0.6);
        g.addColorStop(0, mixHex(color, "#FFFFFF", 0.35)); g.addColorStop(1, mixHex(color, pal.ink, 0.15));
        ctx.fillStyle = g; ctx.fill(); vein("rgba(255,255,255,0.4)", lw); break;
      }
      case "riso":
        ctx.globalCompositeOperation = "multiply"; path(); ctx.fillStyle = color; ctx.fill(); ctx.globalCompositeOperation = "source-over"; vein(pal.bgTop, lw); break;
      case "chalk":
        path(); ctx.strokeStyle = chalkPattern(ctx, color, 41); ctx.lineWidth = lw * 1.3; ctx.stroke(); vein(ctx.strokeStyle, lw); break;
      case "pixel":
        path(); ctx.fillStyle = color; ctx.fill(); vein(mixHex(color, pal.ink, 0.4), 1); ctx.setTransform(1, 0, 0, 1, 0, 0); crispAlpha(ctx); break;
      default:
        path(); ctx.fillStyle = rgba(color, 0.6); ctx.fill(); vein("rgba(255,255,255,0.6)", lw); break;
    }
  }
  SPRITE_PAINTERS.glow.leaf = leafPaint;

  const Scenery = {
    strips: new Map(),

    // "auto" (or nothing): the manifest's motif, else the look's own, else hills.
    pick(g, motif) {
      if (motif && motif !== "auto") return MOTIF_LAYERS[motif] ? motif : "hills";
      if (g.style.motifSet) return g.style.motif;
      return g.style.motif !== "none" ? g.style.motif : "hills";
    },

    stripFor(g, L) {
      const res = g.lowRes ? g.pxScale : Math.min(2, Math.max(1, g.pxScale));
      let a = this.strips.get(g.palette);
      if (!a) { a = new Map(); this.strips.set(g.palette, a); }
      let b = a.get(L);
      if (!b) { b = new Map(); a.set(L, b); }
      let sp = b.get(res);
      if (!sp) {
        if (this.strips.size > 6) { this.strips.clear(); a = new Map(); this.strips.set(g.palette, a); b = new Map(); a.set(L, b); }
        sp = makeCanvas(L.period * res, (L.h + 4) * res);
        paintStrip(sp.getContext("2d"), L, g.palette, g.look, res);
        // The bottom rows, tiled below the strip down to the view's bottom edge (a whole number of
        // halftone cells so riso dots line up; grain and chalk repeat unnoticed).
        const cell = g.look === "riso" ? Math.max(3, Math.round(3.4 * res)) : 1;
        const tailPx = Math.max(cell, cell * Math.round((32 * res) / cell));
        const tail = makeCanvas(sp.width, tailPx);
        tail.getContext("2d").drawImage(sp, 0, sp.height - tailPx, sp.width, tailPx, 0, 0, sp.width, tailPx);
        sp._tail = tail;
        sp._tailH = tailPx / res;
        b.set(res, sp);
      }
      return sp;
    },

    drawStrip(g, L, off, y, alpha) {
      const sp = this.stripFor(g, L);
      const ctx = g.ctx, v = g.view, P = L.period, s = g.pxScale, ox = g.originX, H = L.h + 4;
      ctx.globalAlpha = alpha;
      // Tiles and rows are snapped to device pixels, so they meet without seams or overlaps.
      const oy = g.originY, T = sp._tailH;
      const t0 = Math.round(y * s + oy), t1 = Math.round((y + H) * s + oy);
      for (let k = Math.floor((v.x0 + off) / P); k * P - off < v.x1; k++) {
        const a = Math.round((k * P - off) * s + ox), bpx = Math.round(((k + 1) * P - off) * s + ox);
        const xx = (a - ox) / s, ww = (bpx - a) / s;
        ctx.drawImage(sp, xx, (t0 - oy) / s, ww, (t1 - t0) / s);
        // Below the strip: its bottom rows, repeated down to the view's bottom edge.
        for (let j = 0, ya = t1; (ya - oy) / s < v.y1; j++) {
          const yb = Math.round((y + H + (j + 1) * T) * s + oy);
          ctx.drawImage(sp._tail, xx, (ya - oy) / s, ww, (yb - ya) / s);
          ya = yb;
        }
      }
      ctx.globalAlpha = 1;
    },

    draw(g, motif, scroll, o) {
      const layers = MOTIF_LAYERS[motif];
      if (!layers || !layers.length) return;
      for (let i = 0; i < layers.length; i++) {
        const L = layers[i];
        const off = scroll * L.speed;
        if (L.kind === "ridge" || L.kind === "wave" || L.kind === "skyline") {
          const bob = L.bob && !g.reduced && !g.poster ? Math.sin(g.t * L.bob + L.ph) * 2 : 0;
          this.drawStrip(g, L, off, L.y + bob, g.look === "glow" ? (L.kind === "skyline" ? 1 : L.kind === "wave" ? 0.32 + L.depth * 0.12 : 0.55 - L.depth * 0.05) : 1);
        } else if (L.kind === "clouds") this.clouds(g, L, off);
        else if (L.kind === "stars") this.stars(g, L, off);
        else if (L.kind === "dots") this.dots(g, L, off);
        else if (L.kind === "leaves") this.leaves(g, L, off);
        else if (L.kind === "grid") this.grid(g, L, off);
      }
    },

    ground(g, floor, scroll, o) {
      this.drawStrip(g, GROUND_LAYER, scroll, floor - 3, 1);
    },

    // Each item sits in a tile of width period; draws every copy that's on screen.
    each(g, L, off, n, fn) {
      const v = g.view, P = L.period;
      for (let i = 0; i < n; i++) {
        const bx = hashN(L.seed || 1, i * 3) * P;
        const y = L.y + hashN(L.seed || 1, i * 3 + 1) * L.h;
        const s = hashN(L.seed || 1, i * 3 + 2);
        for (let k = Math.floor((v.x0 - 80 + off - bx) / P); bx + k * P - off < v.x1 + 80; k++) fn(bx + k * P - off, y, s, i);
      }
    },

    clouds(g, L, off) {
      const pal = g.palette, look = g.look;
      const color = look === "neon" ? pal.secondary : look === "chalk" ? pal.ink : look === "riso" ? pal.secondary : pal.glow;
      const a = look === "glow" ? (pal.dark ? 0.12 : 0.45) : look === "neon" ? 0.5 : look === "chalk" ? 0.35 : 0.95;
      this.each(g, L, off, L.count, (x, y, s) => {
        const k = 0.7 + s * 0.8;
        g.puff(x, y, 34 * k, color, a);
        g.puff(x + 30 * k, y - 10 * k, 26 * k, color, a * 0.95);
        g.puff(x - 28 * k, y + 4 * k, 22 * k, color, a * 0.9);
      });
    },

    stars(g, L, off) {
      const pal = g.palette;
      const color = g.look === "neon" || pal.dark ? pal.glow : pal.ink;
      const tw = g.reduced || g.poster ? 0 : 1;
      this.each(g, L, off, L.count, (x, y, s, i) => {
        const a = (pal.dark ? 0.75 : 0.45) * (0.55 + 0.45 * Math.sin(g.t * (1.3 + s) * tw + i));
        g.spark(x, y, 2 + s * 4, i % 5 === 0 ? pal.accent : color, a);
      });
    },

    dots(g, L, off) {
      const v = g.view, gap = L.gap, pal = g.palette;
      const color = g.look === "glow" ? pal.glow : g.look === "neon" ? pal.secondary : sceneryColor(pal, g.look, 0);
      const a = g.look === "glow" ? 0.35 : g.look === "neon" ? 0.5 : 0.45;
      const x0 = Math.floor((v.x0 + off) / gap) * gap - off;
      for (let row = 0, y = Math.floor(v.y0 / gap) * gap; y < v.y1 + gap; y += gap, row++) {
        for (let x = x0 + (row & 1 ? gap / 2 : 0); x < v.x1 + gap; x += gap) g.circle(x, y, 3.5, color, a);
      }
    },

    leaves(g, L, off) {
      const pal = g.palette;
      this.each(g, L, off, L.count, (x, y, s, i) => {
        g.sprite("leaf", x, y, 10 + s * 9 + L.depth * 4, pal.accents[i % 3], L.depth ? 0.95 : 0.7, 1, 1, i & 3);
      });
    },

    grid(g, L, off) {
      const ctx = g.ctx, v = g.view, pal = g.palette;
      if (g.look === "neon") {
        const hz = 440, vx = W / 2;
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = pal.secondary;
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(v.x0, hz);
        ctx.lineTo(v.x1, hz);
        const spread = 46, shift = (off * 2.2) % spread;
        for (let k = -14; k <= 14; k++) {
          const bx = vx + k * spread * 3 - shift * 3;
          ctx.moveTo(vx + (bx - vx) * 0.08, hz);
          ctx.lineTo(bx, v.y1);
        }
        const phase = (g.reduced || g.poster ? 0 : (g.t * 0.6) % 1);
        for (let k = 0; k < 9; k++) {
          const y = hz + Math.pow(1.48, k + phase) * 5;
          if (y > v.y1) break;
          ctx.moveTo(v.x0, y);
          ctx.lineTo(v.x1, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        return;
      }
      const gap = 24;
      const color = g.look === "chalk" || pal.dark ? pal.ink : pal.ink;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = g.look === "chalk" ? 0.12 : 0.07;
      ctx.beginPath();
      for (let x = Math.floor((v.x0 + off) / gap) * gap - off; x < v.x1; x += gap) { ctx.moveTo(x, v.y0); ctx.lineTo(x, v.y1); }
      for (let y = Math.floor(v.y0 / gap) * gap; y < v.y1; y += gap) { ctx.moveTo(v.x0, y); ctx.lineTo(v.x1, y); }
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
  };

  // ----- backdrops: the look's background, pre-rendered once per size (motif included) -----

  function paintBackdrop(ctx, g, style, cssW, cssH, res, fit, motif) {
    const pal = style.palette, look = style.look;
    ctx.setTransform(res, 0, 0, res, 0, 0);
    if (look === "glow") {
      const grad = ctx.createLinearGradient(0, 0, cssW * 0.55, cssH);
      grad.addColorStop(0, pal.bgTop);
      grad.addColorStop(1, pal.bgBottom);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cssW, cssH);
    } else if (look === "pixel") {
      // Dithered sky: 6 bands between bgTop and bgBottom with a 4x4 ordered dither.
      const c = ctx.canvas, img = ctx.createImageData(c.width, c.height), d = img.data;
      const steps = 6, cols = [];
      for (let i = 0; i <= steps; i++) cols.push(hexToRgb(mixHex(pal.bgTop, pal.bgBottom, i / steps)));
      for (let y = 0; y < c.height; y++) {
        const t = (y / Math.max(1, c.height - 1)) * steps;
        const base = Math.min(steps - 1, Math.floor(t)), frac = t - base;
        for (let x = 0; x < c.width; x++) {
          const col = frac * 16 > BAYER4[(y & 3) * 4 + (x & 3)] + 0.5 ? cols[base + 1] : cols[base];
          const i = (y * c.width + x) * 4;
          d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    } else if (look === "clay") {
      const R = Math.max(cssW, cssH) * 0.9;
      const grad = ctx.createRadialGradient(cssW * 0.5, cssH * 0.3, 0, cssW * 0.5, cssH * 0.3, R);
      grad.addColorStop(0, mixHex(pal.bgTop, "#FFFFFF", 0.28));
      grad.addColorStop(0.5, pal.bgTop);
      grad.addColorStop(1, pal.bgBottom);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cssW, cssH);
      const floor = ctx.createLinearGradient(0, cssH * 0.68, 0, cssH);
      floor.addColorStop(0, rgba(pal.bgBottom, 0));
      floor.addColorStop(0.25, rgba(mixHex(pal.bgBottom, "#FFFFFF", 0.18), 0.6));
      floor.addColorStop(1, rgba(mixHex(pal.bgBottom, pal.ink, 0.06), 0.9));
      ctx.fillStyle = floor;
      ctx.fillRect(0, cssH * 0.68, cssW, cssH * 0.32);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, cssH);
      grad.addColorStop(0, pal.bgTop);
      grad.addColorStop(1, pal.bgBottom);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cssW, cssH);
    }
    // Texture and light.
    if (look === "paper") grainOver(ctx, 0, 0, cssW, cssH, 0.75, false);
    else if (look === "ink") {
      grainOver(ctx, 0, 0, cssW, cssH, 0.35, false);
      ctx.save();
      ctx.strokeStyle = rgba(pal.ink, 0.06);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(cssW * 0.04, cssH * 0.96, cssW * 0.5, cssH * 0.16, -0.3, 0, TAU);
      ctx.ellipse(cssW * 0.98, cssH * 0.05, cssW * 0.38, cssH * 0.11, -0.3, 0, TAU);
      ctx.clip();
      hatchLines(ctx, 0, 0, cssW, cssH, 6);
      ctx.restore();
    } else if (look === "riso") {
      grainOver(ctx, 0, 0, cssW, cssH, 0.55, false);
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = ctx.createPattern(halftoneTile(pal.secondary, Math.max(3, 4 * res), 0.45), "repeat");
      ctx.fillRect(0, cssH * 0.82, cssW, cssH * 0.18);
      ctx.restore();
    } else if (look === "chalk") {
      for (let i = 0; i < 7; i++) {
        const x = hashN(71, i) * cssW, y = hashN(72, i) * cssH, r = (0.18 + hashN(73, i) * 0.3) * cssW;
        const sg = ctx.createRadialGradient(x, y, 0, x, y, r);
        sg.addColorStop(0, "rgba(255,255,255,0.05)");
        sg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = sg;
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth = 22;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cssW * 0.08, cssH * 0.3);
      ctx.quadraticCurveTo(cssW * 0.5, cssH * 0.24, cssW * 0.9, cssH * 0.36);
      ctx.moveTo(cssW * 0.15, cssH * 0.72);
      ctx.quadraticCurveTo(cssW * 0.55, cssH * 0.66, cssW * 0.85, cssH * 0.78);
      ctx.stroke();
      const tile = noiseTile(33, 96, "#FFFFFF", 0.02, 0.09, 0.35);
      for (let y = 0; y < cssH * res; y += 96) for (let x = 0; x < cssW * res; x += 96) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(tile, x, y); }
      ctx.setTransform(res, 0, 0, res, 0, 0);
    } else if (look === "neon") {
      const hy = fit.oy + 440 * fit.scale;
      const hg = ctx.createRadialGradient(cssW / 2, hy, 0, cssW / 2, hy, cssW * 0.9);
      hg.addColorStop(0, rgba(pal.primary, 0.22));
      hg.addColorStop(0.5, rgba(pal.primary, 0.06));
      hg.addColorStop(1, rgba(pal.primary, 0));
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, cssW, cssH);
      for (let i = 0; i < 46; i++) {
        const x = hashN(61, i) * cssW, y = hashN(62, i) * Math.max(10, hy - 30);
        const r = 0.5 + hashN(63, i) * 1.3;
        ctx.globalAlpha = 0.35 + hashN(64, i) * 0.55;
        ctx.fillStyle = i % 6 === 0 ? pal.secondary : "#FFFFFF";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (look === "paper" || look === "clay" || look === "neon" || look === "chalk") {
      const R = Math.max(cssW, cssH) * 0.75;
      const vg = ctx.createRadialGradient(cssW / 2, cssH * 0.45, R * 0.45, cssW / 2, cssH * 0.45, R);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, look === "neon" || look === "chalk" ? "rgba(0,0,0,0.35)" : rgba(pal.shadow, 0.16));
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, cssW, cssH);
    }
    // The motif, in playfield coordinates, at rest.
    if (motif && motif !== "none") {
      const s = res * fit.scale;
      ctx.setTransform(s, 0, 0, s, res * fit.ox, res * fit.oy);
      g.begin(ctx, style, s, fit.view, 0, { poster: true, lowRes: look === "pixel" });
      g.originX = res * fit.ox;
      g.originY = res * fit.oy;
      Scenery.draw(g, motif, 0, EMPTY);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // 7. Sound: tiny synthesized WebAudio sounds (no audio files). Muted by default.
  // ---------------------------------------------------------------------------------------------

  const Sound = {
    ctx: null,
    master: null,
    muted: true,
    last: Object.create(null),
    noiseBuf: null,
    flavor: "soft",
    voices: 0,
    ensure() {
      if (this.ctx) return this.ctx;
      const AC = hasDOM ? (window.AudioContext || window.webkitAudioContext) : null;
      if (!AC) return null;
      try {
        this.ctx = new AC();
      } catch (e) {
        return null;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.32;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 6000;
      this.master.connect(lp);
      lp.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 0.4);
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      let s = 0x2468ace;
      for (let i = 0; i < len; i++) {
        s = (Math.imul(s, 1103515245) + 12345) | 0;
        data[i] = ((s >>> 8) / 8388608 - 1) * 0.9;
      }
      return ctx;
    },
    setMuted(m) {
      this.muted = !!m;
      if (!this.muted) this.unlock();
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.32;
    },
    unlock() {
      if (this.muted) return;
      let ctx = this.ensure();
      if (ctx && ctx.state === "closed") {
        this.ctx = null;
        ctx = this.ensure();
      }
      // iOS leaves the context "interrupted" (not "suspended") after a call, Siri or another app
      // takes the audio session; resume either, or the game stays silent until it is reloaded.
      if (ctx && ctx.state !== "running" && typeof ctx.resume === "function") ctx.resume().catch(() => {});
    },
    tone(t, type, f0, f1, dur, vol) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.03);
      this.voices++;
      o.onended = () => { this.voices--; };
    },
    noise(t, dur, f0, f1, q, vol) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = q;
      bp.frequency.setValueAtTime(f0, t);
      bp.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.master);
      src.start(t);
      src.stop(t + dur + 0.03);
    },
    play(name) {
      if (this.muted || SOUNDS.indexOf(name) < 0) return;
      const ctx = this.ensure();
      if (!ctx) return;
      if (ctx.state !== "running") { this.unlock(); return; }
      if (this.voices > 24) return;
      const now = ctx.currentTime;
      if (this.last[name] && now - this.last[name] < 0.05) return;
      this.last[name] = now;
      const bright = this.flavor === "bright", dreamy = this.flavor === "dreamy";
      const wave = bright ? "triangle" : "sine";
      const tail = dreamy ? 1.6 : 1;
      try {
        switch (name) {
          case "pop":
            this.tone(now, "sine", 760, 170, 0.11, 0.5);
            this.noise(now, 0.06, 3200, 1200, 1.2, 0.22);
            break;
          case "blip":
            this.tone(now, wave, 520, 780, 0.08 * tail, 0.26);
            break;
          case "tick":
            this.tone(now, "sine", 1400, 1300, 0.045, 0.14);
            break;
          case "chime":
            this.tone(now, "sine", 988, 990, 0.42 * tail, 0.22);
            this.tone(now + 0.07, "sine", 1480, 1482, 0.5 * tail, 0.14);
            break;
          case "whoosh":
            this.noise(now, 0.34 * tail, 420, 1800, 0.9, 0.18);
            break;
          case "success": {
            const notes = [523.25, 659.25, 783.99, 1046.5];
            for (let i = 0; i < notes.length; i++) this.tone(now + i * 0.08, wave, notes[i], notes[i] * 1.002, 0.34 * tail, 0.24);
            break;
          }
          case "fail":
            this.tone(now, "triangle", 392, 349, 0.2, 0.24);
            this.tone(now + 0.15, "triangle", 330, 262, 0.36 * tail, 0.22);
            break;
          default:
            break;
        }
      } catch (e) { /* audio is optional */ }
    },
  };

  // ---------------------------------------------------------------------------------------------
  // 8. Host: BubbleHost in the web view (docs/BUBBLES.md 4.3 and 4.8).
  // ---------------------------------------------------------------------------------------------

  const MODES = ["play", "replay", "demo", "poster"];
  const MAX_SESSIONS = 4;
  const MAX_STEPS_PER_FRAME = 5;
  const DEMO_MAX_TICKS = 60 * 42;
  // A play run posts a `checkpoint` (its log so far) this often, and when it pauses, so the app can
  // resume it after the player closes (docs/BUBBLES.md 4.8, "Resume").
  const CHECKPOINT_TICKS = 60 * 2;
  // With insets, the score HUD (top + 8 px, a 50 px number and its label) gets this much room
  // under the top inset, so it never covers the game's top line.
  const HUD_ROW = 72;
  const PARTICLES = 320;
  const RINGS = 24;
  const FLOATS = 24;

  // Insets in CSS px: {top, bottom, left, right}, missing or bad values are 0.
  function normInsets(v) {
    const n = (k) => (isObj(v) ? Math.max(0, Number(v[k]) || 0) : 0);
    return { top: n("top"), bottom: n("bottom"), left: n("left"), right: n("right") };
  }

  const Host = {
    ready: false,
    dom: null,
    sessions: new Map(),
    posterWaits: new Map(),
    ffwd: false,
    entry: null,
    key: null,
    run: null,
    mode: "play",
    opts: null,
    stage: "idle",
    paused: false,
    hidden: false,
    loopOn: false,
    raf: 0,
    lastTs: 0,
    acc: 0,
    renderT: 0,
    stageUntil: 0,
    stopAt: 0,
    demoLoop: 0,
    lastScore: -1,
    lastCheckpoint: 0,
    lastHaptic: 0,
    lastHapticStyle: "",
    perfState: null,
    g: null,
    fit: null,
    probe: null,
    cssW: 0,
    cssH: 0,
    dpr: 1,
    // fx pools
    pX: null, pY: null, pVX: null, pVY: null, pLife: null, pMax: null, pSize: null, pKind: null, pCol: null, pNext: 0,
    rX: null, rY: null, rR: null, rMax: null, rLife: null, rCol: null, rNext: 0,
    fText: null, fX: null, fY: null, fLife: null, fCol: null, fNext: 0,
    shakeAmp: 0, shakeX: 0, shakeY: 0, flashA: 0, flashCol: "#FFFFFF",
    // ambient bubbles (screen space), one cached field per seed so posters match first frames
    ambient: null,
    ambientCache: null,
    cosmetic: null,

    measureCtx() {
      if (!this.probe) this.probe = makeCanvas(4, 4).getContext("2d");
      return this.probe;
    },

    initDOM() {
      if (this.dom || !hasDOM) return;
      let root = document.getElementById("bubble-root");
      if (!root) {
        root = document.createElement("div");
        root.id = "bubble-root";
        document.body.appendChild(root);
      }
      const el = (tag, cls, parent) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        (parent || root).appendChild(e);
        return e;
      };
      let canvas = document.getElementById("bubble-canvas");
      if (!canvas) { canvas = el("canvas"); canvas.id = "bubble-canvas"; }
      const hud = el("div", "bubble-hud hidden");
      const hudScore = el("div", "hud-score", hud);
      const hudLabel = el("div", "hud-label", hud);
      const card = el("div", "bubble-card hidden");
      const error = el("div", "bubble-card bubble-error hidden");
      const pop = el("div", "bubble-pop");
      this.dom = { root, canvas, ctx: canvas.getContext("2d", { alpha: true }), hud, hudScore, hudLabel, card, error, pop };
      this.g = new Graphics();
      this.backdrops = new Map();
      // Pools: allocated once, reused for every run.
      this.pX = new Float32Array(PARTICLES); this.pY = new Float32Array(PARTICLES);
      this.pVX = new Float32Array(PARTICLES); this.pVY = new Float32Array(PARTICLES);
      this.pLife = new Float32Array(PARTICLES); this.pMax = new Float32Array(PARTICLES);
      this.pSize = new Float32Array(PARTICLES); this.pKind = new Uint8Array(PARTICLES); this.pCol = new Array(PARTICLES).fill("#FFFFFF");
      this.rX = new Float32Array(RINGS); this.rY = new Float32Array(RINGS); this.rR = new Float32Array(RINGS);
      this.rMax = new Float32Array(RINGS); this.rLife = new Float32Array(RINGS); this.rCol = new Array(RINGS).fill("#FFFFFF");
      this.fText = new Array(FLOATS).fill(""); this.fX = new Float32Array(FLOATS); this.fY = new Float32Array(FLOATS);
      this.fLife = new Float32Array(FLOATS); this.fCol = new Array(FLOATS).fill("#FFFFFF");
      this.ambientCache = new Map();

      const opts = { passive: false };
      root.addEventListener("pointerdown", (e) => this.onPointer("tap", e), opts);
      root.addEventListener("pointermove", (e) => this.onPointer("move", e), opts);
      root.addEventListener("pointerup", (e) => this.onPointer("up", e), opts);
      root.addEventListener("pointercancel", (e) => this.onPointer("up", e), opts);
      const stop = (e) => { if (e.cancelable) e.preventDefault(); };
      root.addEventListener("touchstart", stop, opts);
      root.addEventListener("touchmove", stop, opts);
      document.addEventListener("gesturestart", stop, opts);
      document.addEventListener("dblclick", stop, opts);
      document.addEventListener("contextmenu", stop, opts);
      window.addEventListener("resize", () => this.onResize());
      document.addEventListener("visibilitychange", () => {
        this.hidden = document.visibilityState === "hidden";
        if (this.hidden) this.stopLoop();
        else {
          Sound.unlock();
          this.maybeLoop();
        }
      });
      this.resize();
    },

    // ----- messages -----

    post(msg) {
      msg.key = msg.key === undefined ? this.key : msg.key;
      try {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bubble) {
          window.webkit.messageHandlers.bubble.postMessage(msg);
        }
      } catch (e) { /* not in WKWebView */ }
      if (typeof this.onmessage === "function") {
        try { this.onmessage(msg); } catch (e) { /* preview hook */ }
      }
    },

    // ----- sizing -----

    resize() {
      const d = this.dom;
      if (!d) return;
      const cssW = Math.max(1, d.root.clientWidth || window.innerWidth || W);
      const cssH = Math.max(1, d.root.clientHeight || window.innerHeight || H);
      const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
      const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
      if (d.canvas.width !== pw || d.canvas.height !== ph) {
        d.canvas.width = pw;
        d.canvas.height = ph;
      }
      this.cssW = cssW;
      this.cssH = cssH;
      this.dpr = dpr;
      const insets = this.opts ? this.opts.insets : null;
      this.fit = this.fitFor(cssW, cssH, insets, this.hudRowFor(this.entry, insets));
      if (d.root.style) {
        const ins = normInsets(this.opts ? this.opts.insets : null);
        d.root.style.setProperty("--inset-top", ins.top + "px");
        d.root.style.setProperty("--inset-bottom", ins.bottom + "px");
        d.root.style.setProperty("--inset-left", ins.left + "px");
        d.root.style.setProperty("--inset-right", ins.right + "px");
      }
    },

    // The playfield fits inside the insets (top, bottom, left, right in CSS px); the look's
    // background still fills the whole canvas.
    fitFor(cssW, cssH, insets, hudRow) {
      const ins = normInsets(insets);
      let top = ins.top + (hudRow || 0), bottom = ins.bottom, left = ins.left, right = ins.right;
      if (cssH - top - bottom < 240) { top = 0; bottom = 0; }
      if (cssW - left - right < 180) { left = 0; right = 0; }
      const availW = cssW - left - right, availH = cssH - top - bottom;
      const scale = Math.min(availW / W, availH / H);
      const ox = left + (availW - W * scale) / 2;
      const oy = top + (availH - H * scale) / 2;
      return {
        scale, ox, oy,
        view: { x0: -ox / scale, y0: -oy / scale, x1: (cssW - ox) / scale, y1: (cssH - oy) / scale, w: cssW / scale, h: cssH / scale },
      };
    },

    // On a full screen the HUD floats in the space above the playfield; with insets (the feed)
    // there's no such space, so a Bubble that shows the score HUD gets a row for it.
    hudRowFor(entry, insets) {
      if (!entry || entry.hudShown === false) return 0;
      const ins = normInsets(insets);
      return ins.top || ins.bottom || ins.left || ins.right ? HUD_ROW : 0;
    },

    onResize() {
      this.resize();
      if (this.run && !this.loopOn) this.render(0);
    },

    // ----- sessions -----

    touch(key) {
      const e = this.sessions.get(key);
      if (!e) return null;
      this.sessions.delete(key);
      this.sessions.set(key, e);
      return e;
    },

    trim() {
      while (this.sessions.size > MAX_SESSIONS) {
        let victim = null;
        for (const k of this.sessions.keys()) { if (k !== this.key) { victim = k; break; } }
        if (!victim) break;
        this.sessions.delete(victim);
      }
    },

    prepare(payloadJSON) {
      const t0 = nowMs();
      let key = null;
      try {
        this.initDOM();
        const payload = parseMaybe(payloadJSON) || {};
        const manifest = payload.manifest;
        if (!isObj(manifest)) throw new Error("The payload has no manifest");
        key = typeof payload.key === "string" && payload.key ? payload.key : String(manifest.id) + "#" + (manifest.version || 1);
        if (isObj(payload.images)) for (const u of Object.keys(payload.images)) Images.setAlias(u, payload.images[u]);
        const mjson = JSON.stringify(manifest);
        const old = this.sessions.get(key);
        if (old && old.mjson === mjson) {
          old.payload = payload;
          this.touch(key);
          return JSON.stringify({ ok: true, key, ms: round1(nowMs() - t0), error: null });
        }
        const session = createSession(manifest);
        const entry = { key, session, mjson, payload, prepare_ms: 0 };
        // Warm up: play to the poster moment (where demos start and posters are taken) and draw
        // that frame offscreen at the real scale, so sprites, fonts, images and the JIT are ready
        // before the person gets here.
        const run = posterRun(session, { bot_skill: payload.bot_skill, player: payload.player, preload: (u) => Images.load(u) });
        this.warm(entry, run);
        entry.prepare_ms = round1(nowMs() - t0);
        this.sessions.set(key, entry);
        this.trim();
        return JSON.stringify({ ok: true, key, ms: entry.prepare_ms, error: null });
      } catch (e) {
        return JSON.stringify({ ok: false, key, ms: round1(nowMs() - t0), error: errMessage(e) });
      }
    },

    activate(key, optionsJSON) {
      const t0 = nowMs();
      try {
        this.initDOM();
        const entry = this.touch(key);
        if (!entry) return JSON.stringify({ ok: false, ms: 0, error: "Nothing prepared for key " + key });
        let o = {};
        try { o = optionsJSON ? parseMaybe(optionsJSON) || {} : {}; } catch (e) { o = {}; }
        const p = entry.payload || {};
        const pick = (name, dflt) => (o[name] !== undefined ? o[name] : p[name] !== undefined ? p[name] : dflt);
        this.stopLoop();
        this.entry = entry;
        this.key = key;
        const mode = pick("mode", "play");
        this.mode = MODES.indexOf(mode) >= 0 ? mode : "play";
        const replay = pick("replay", null);
        if (this.mode === "replay" && !(isObj(replay) && Array.isArray(replay.inputs))) this.mode = "demo";
        this.opts = {
          replay: isObj(replay) ? replay : null,
          player: isObj(pick("player", null)) ? pick("player", null) : { name: "", best: null },
          muted: pick("muted", true) !== false,
          reduced: !!pick("reduced_motion", false),
          insets: normInsets(pick("insets", null)),
          botSkill: typeof pick("bot_skill", null) === "number" ? pick("bot_skill", null) : DEMO_BOT_SKILL,
          // A saved partial run to pick up (play mode only). Read from the activate options, never
          // the prepared payload, and used once: Play again starts fresh.
          resume: this.mode === "play" && isObj(o.resume) && Array.isArray(o.resume.inputs) ? o.resume : null,
        };
        // A replay that recorded a locked length (a challenge, a group-chat session) plays on that
        // length even when the prepared manifest has none (docs/BUBBLES.md 7.9).
        const rl = this.opts.replay && isObj(this.opts.replay.length) ? this.opts.replay.length : null;
        if (this.mode === "replay" && rl && !isObj(entry.session.manifest.length) && LENGTH_MODES.indexOf(rl.mode) >= 0) {
          const lk = JSON.stringify(rl);
          const cache = entry.lengthSessions || (entry.lengthSessions = {});
          const locked = cache[lk] || (cache[lk] = createSession(Object.assign({}, entry.session.manifest, { length: deepCopy(rl) })));
          this.entry = Object.assign({}, entry, { session: locked });
        }
        this.paused = false;
        this.demoLoop = 0;
        this.hideError();
        this.applyStyle(entry.session.style);
        Sound.setMuted(this.opts.muted);
        this.resize();
        this.resetFx(entry.session);
        this.startRun(pick("skip_intro", false) === true, null);
        const t1 = nowMs();
        this.render(0);
        const firstFrame = nowMs() - t1;
        this.post({ type: "ready", title: entry.session.manifest.title });
        const activateMs = nowMs() - t0;
        this.perfState = { activate_ms: round1(activateMs), first_frame_ms: round1(firstFrame), frames: 0, since: nowMs(), last: nowMs() };
        this.post({ type: "perf", prepare_ms: entry.prepare_ms, activate_ms: round1(activateMs), first_frame_ms: round1(firstFrame), fps: null, heap_mb: this.heapMB() });
        return JSON.stringify({ ok: true, ms: round1(activateMs), error: null });
      } catch (e) {
        this.fatal(e);
        return JSON.stringify({ ok: false, ms: round1(nowMs() - t0), error: errMessage(e) });
      }
    },

    boot(payloadJSON) {
      let payload;
      try {
        payload = parseMaybe(payloadJSON) || {};
      } catch (e) {
        this.initDOM();
        this.fatal(e);
        return;
      }
      const res = JSON.parse(this.prepare(payload));
      if (!res.ok) {
        this.initDOM();
        this.key = res.key;
        this.fatal(new Error(res.error));
        return;
      }
      this.activate(res.key, payload);
    },

    evict(key) {
      if (!this.sessions.has(key)) return;
      this.sessions.delete(key);
      if (this.key === key) {
        this.stopLoop();
        this.entry = null;
        this.run = null;
        this.stage = "idle";
        this.key = null;
        if (this.dom) {
          this.dom.ctx.setTransform(1, 0, 0, 1, 0, 0);
          this.dom.ctx.clearRect(0, 0, this.dom.canvas.width, this.dom.canvas.height);
          this.hideCard();
          this.dom.hud.classList.add("hidden");
        }
      }
    },

    poster(key, optionsJSON) {
      try {
        this.initDOM();
        const entry = this.sessions.get(key);
        if (!entry) return "";
        let o = {};
        try { o = optionsJSON ? parseMaybe(optionsJSON) || {} : {}; } catch (e) { o = {}; }
        const w = clamp(Number(o.width) || 360, 16, 2000), h = clamp(Number(o.height) || 640, 16, 3000);
        const scale = clamp(Number(o.scale) || 1, 0.25, 3);
        const type = o.type === "image/png" ? "image/png" : "image/jpeg";
        const quality = clamp(Number(o.quality) || 0.82, 0.3, 1);
        const canvas = makeCanvas(w * scale, h * scale);
        const ctx = canvas.getContext("2d");
        const p = entry.payload || {};
        // Same insets as boot/activate (options.insets wins), so key content clears the overlay.
        const insets = normInsets(isObj(o.insets) ? o.insets : p.insets);
        const run = posterRun(entry.session, { bot_skill: typeof o.bot_skill === "number" ? o.bot_skill : p.bot_skill, player: p.player, preload: (u) => Images.load(u) });
        const fit = this.fitFor(w, h, insets, o.hud !== false ? this.hudRowFor(entry, insets) : 0);
        const g = this.g;
        g.pendingImages = [];
        this.drawFrame(ctx, run, entry.session.style, w, h, scale, fit, { poster: true, t: 0, fx: false, ambientSeed: entry.session.manifest.seed, entry, noCache: true });
        // The score HUD where the live page shows it, so poster and live demo match (hud: false
        // leaves it out, e.g. for small cards).
        if (o.hud !== false && run.hud.score !== false) this.drawPosterHud(ctx, run, entry.session.style, w, h, scale, insets);
        // Images still loading were drawn as placeholders: say when a better poster is ready.
        if (g.pendingImages.length) this.posterWaits.set(key, g.pendingImages);
        else this.posterWaits.delete(key);
        g.pendingImages = null;
        return canvas.toDataURL(type, quality);
      } catch (e) {
        log("poster failed: " + errMessage(e));
        return "";
      }
    },

    // Top center inside the insets, like the DOM HUD (.bubble-hud): the score, then its label.
    drawPosterHud(ctx, run, style, w, h, scale, ins) {
      const g = this.g, pal = style.palette;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      g.begin(ctx, style, scale, { x0: 0, y0: 0, x1: w, y1: h, w, h }, 0, { poster: true });
      g.originX = 0;
      g.originY = 0;
      const cx = (ins.left + w - ins.right) / 2, top = ins.top + 8;
      g.text(String(run.score), cx, top + 26, { size: 50, weight: 800, color: pal.ink, glow: true });
      if (run.hud.label) g.text(String(run.hud.label), cx, top + 67, { size: 14, weight: 800, color: pal.ink, alpha: 0.7 });
    },

    command(cmd) {
      try {
        if (typeof cmd === "string") cmd = cmd.trim().charAt(0) === "{" ? JSON.parse(cmd) : { type: cmd };
        if (!isObj(cmd)) return;
        switch (cmd.type) {
          case "pause":
            this.paused = true;
            this.stopLoop();
            this.checkpoint(true);
            break;
          case "resume":
            Sound.unlock();
            if (!this.paused) break;
            this.paused = false;
            this.lastTs = 0;
            this.acc = 0;
            this.maybeLoop();
            break;
          case "restart":
            if (!this.entry) break;
            this.paused = false;
            this.mode = "play";
            this.hideCard();
            this.startRun(true, null);
            break;
          case "start":
            if (this.stage === "intro") this.beginPlay();
            break;
          case "mute":
            Sound.setMuted(true);
            break;
          case "unmute":
            Sound.setMuted(false);
            break;
          case "insets":
            if (this.opts) this.opts.insets = normInsets(cmd);
            this.onResize();
            break;
          case "reduced_motion":
            if (this.opts) this.opts.reduced = !!cmd.value;
            if (this.dom) this.dom.root.classList.toggle("reduced", !!cmd.value);
            break;
          default:
            break;
        }
      } catch (e) {
        log("command failed: " + errMessage(e));
      }
    },

    // ----- runs -----

    startRun(skipIntro, firstTap) {
      const entry = this.entry;
      if (!entry) return;
      const session = entry.session;
      const mode = this.mode;
      const o = { mode, player: this.opts.player, fx: mode === "poster" ? NOOP_FX : this.fx(), preload: (u) => Images.load(u) };
      const resume = mode === "play" ? this.opts.resume : null;
      this.opts.resume = null;
      this.lastCheckpoint = 0;
      if (resume) {
        o.replay = resume;
        o.seed = resume.seed;
      } else if (mode === "replay") {
        o.replay = this.opts.replay;
        o.seed = this.opts.replay.seed;
      } else if (mode === "demo" || mode === "poster") {
        o.bot = true;
        o.botSkill = this.opts.botSkill;
        o.botSeed = demoBotSeed(session, this.demoLoop);
      }
      this.run = session.newRun(o);
      if (resume) {
        // Fast-forward silently to where they left off, then wait on a "Tap to keep going" card.
        this.ffwd = true;
        let resumed = false;
        try { resumed = resumeRun(this.run, resume); } finally { this.ffwd = false; }
        if (!resumed) {
          this.startRun(skipIntro, firstTap);
          return;
        }
        Sound.flavor = this.run.feel.sound || "soft";
        this.acc = 0;
        this.lastTs = 0;
        this.lastScore = -1;
        this.lastCheckpoint = this.run.tick;
        this.stage = "intro";
        this.showResumeCard();
        this.post({ type: "phase", name: "intro" });
        this.post({ type: "resumed", tick: this.run.tick, score: this.run.score });
        this.render(0);
        this.maybeLoop();
        return;
      }
      Sound.flavor = this.run.feel.sound || "soft";
      if (mode !== "poster") this.popIn(firstTap);
      this.acc = 0;
      this.lastTs = 0;
      this.lastScore = -1;
      this.hideCard();
      if (mode === "poster") {
        advanceToPoster(this.run);
        this.stage = "poster";
        this.dom.hud.classList.add("hidden");
        this.post({ type: "phase", name: "playing" });
        this.render(0);
        return;
      }
      if (mode === "play" && !skipIntro) {
        this.stage = "intro";
        this.showIntro();
        this.post({ type: "phase", name: "intro" });
      } else {
        this.run.begin();
        if (mode === "demo" && this.demoLoop === 0) {
          // Start where the poster is, silently, so poster and live demo match.
          this.ffwd = true;
          try { advanceToPoster(this.run); } finally { this.ffwd = false; }
        }
        this.stage = "playing";
        this.post({ type: "phase", name: "playing" });
        if (firstTap) this.run.queue("tap", firstTap.x, firstTap.y);
      }
      this.updateHud(true);
      this.maybeLoop();
    },

    beginPlay() {
      if (!this.run || this.stage !== "intro") return;
      this.hideCard();
      this.run.begin();
      this.stage = "playing";
      this.post({ type: "phase", name: "playing" });
      Sound.play("blip");
      this.updateHud(true);
      this.maybeLoop();
    },

    onPointer(a, e) {
      if (e.cancelable) e.preventDefault();
      if (a === "tap") Sound.unlock();
      if (!this.run || this.paused || !this.fit) return;
      const rect = this.dom.root.getBoundingClientRect();
      const x = (e.clientX - rect.left - this.fit.ox) / this.fit.scale;
      const y = (e.clientY - rect.top - this.fit.oy) / this.fit.scale;
      const st = this.stage;
      if (st === "error") return;
      if (this.mode === "replay" || this.mode === "demo") {
        if (a === "tap" && (st === "playing" || st === "moment")) this.takeover(x, y);
        return;
      }
      if (this.mode !== "play") return;
      if (st === "intro") {
        if (a === "tap") this.beginPlay();
        return;
      }
      if (st === "result") {
        if (a === "tap" && this.run.hud.retry !== false && this.renderT > this.stageUntil) this.startRun(true, null);
        return;
      }
      if (st !== "playing" || this.run.ended) return;
      if (e.isPrimary === false && a !== "tap") return;
      this.run.queue(a, x, y);
    },

    takeover(x, y) {
      this.post({ type: "takeover" });
      this.mode = "play";
      this.demoLoop = 0;
      this.startRun(true, { x, y });
    },

    // Posts the live play run's log so far ({type: "checkpoint", tick, score, replay}), so the app can
    // save it and resume the run later (`resumeRun`). Only mid-run: not before the first tap, not once
    // the run is ending, and not in the first second (nothing worth keeping yet).
    checkpoint(force) {
      const run = this.run;
      if (!run || this.mode !== "play" || this.stage !== "playing" || !run.begun || run.ending || run.ended) return;
      if (run.tick < TICK_RATE) return;
      if (!force && run.tick - this.lastCheckpoint < CHECKPOINT_TICKS) return;
      this.lastCheckpoint = run.tick;
      this.post({ type: "checkpoint", tick: run.tick, score: run.score, replay: run.replayLog() });
    },

    // ----- loop -----

    maybeLoop() {
      if (this.loopOn || this.paused || this.hidden || !this.run) return;
      if (this.stage === "poster" || this.stage === "error" || this.stage === "idle") return;
      if (this.stage === "result" && this.renderT > this.stopAt) return;
      this.loopOn = true;
      this.lastTs = 0;
      this.raf = requestAnimationFrame((ts) => this.frame(ts));
    },

    stopLoop() {
      this.loopOn = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    },

    frame(ts) {
      this.raf = 0;
      if (!this.loopOn) return;
      let dt = this.lastTs ? (ts - this.lastTs) / 1000 : DT;
      this.lastTs = ts;
      if (!(dt > 0)) dt = DT;
      dt = Math.min(dt, 0.1);
      try {
        this.advance(dt);
        if (!this.loopOn) return;
        this.render(dt);
        this.measure(ts);
      } catch (e) {
        this.fatal(e);
        return;
      }
      if (this.stage === "result" && this.renderT > this.stopAt) { this.loopOn = false; return; }
      if (this.loopOn) this.raf = requestAnimationFrame((t2) => this.frame(t2));
    },

    advance(dt) {
      this.renderT += dt;
      const run = this.run;
      if (!run) return;
      if (this.stage === "playing") {
        this.acc += dt;
        // 60 Hz displays jitter around 1/60 s: snap so each frame is exactly one tick.
        if (this.acc > DT * 0.9 && this.acc < DT * 1.12) this.acc = DT;
        let steps = 0;
        while (this.acc >= DT - 1e-6 && steps < MAX_STEPS_PER_FRAME && !run.ended) {
          run.step();
          this.acc -= DT;
          steps++;
        }
        if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0;
        this.updateHud(false);
        if (run.tick - this.lastCheckpoint >= CHECKPOINT_TICKS) this.checkpoint(false);
        const replayDone = this.mode === "replay" && run.replayTotal > 0 && run.tick >= run.replayTotal && !run.ended;
        const demoDone = this.mode === "demo" && run.tick >= DEMO_MAX_TICKS && !run.ended;
        if (run.ended || replayDone || demoDone) this.onRunEnded(run.ended);
      } else if (this.stage === "moment" && this.renderT >= this.stageUntil) {
        if (this.mode === "play") this.showResult();
        else {
          this.demoLoop++;
          this.startRun(true, null);
        }
      }
    },

    onRunEnded(realEnd) {
      const run = this.run;
      this.stage = "moment";
      const outcome = run.ended ? run.outcome : "fail";
      if (this.mode === "play") {
        this.stageUntil = this.renderT + (this.opts.reduced ? 0.5 : 0.85);
        this.post({ type: "phase", name: outcome === "success" ? "success" : "fail" });
        if (outcome === "success") {
          Sound.play("success");
          this.haptic("success");
          this.burst(W / 2, H * 0.42);
        } else {
          Sound.play("fail");
          if (this.renderT - this.lastHaptic > 0.3) this.haptic("warning");
        }
      } else {
        this.stageUntil = this.renderT + (realEnd ? 1.5 : 0.9);
        this.post({ type: "phase", name: outcome === "success" ? "success" : "fail" });
      }
    },

    showResult() {
      const run = this.run;
      this.stage = "result";
      this.stageUntil = this.renderT + 0.35;
      this.stopAt = this.renderT + 1.6;
      this.post({ type: "phase", name: "result" });
      const share = run.share || run.buildShare();
      this.post({
        type: "result",
        outcome: run.outcome === "success" ? "success" : "fail",
        score: run.score,
        duration_sec: Math.round((run.tick / TICK_RATE) * 100) / 100,
        replay: run.replayLog(),
        share,
      });
      this.showResultCard();
    },

    burst(x, y) {
      const pal = this.entry.session.palette;
      for (let i = 0; i < 4; i++) this.fxPop(x + (i - 1.5) * 50, y + (i % 2) * 30, pal.accents[i], 12);
      this.fxSparkle(x, y, pal.look === "glow" ? pal.glow : pal.accent, 20);
    },

    haptic(style) {
      if (this.mode !== "play" || HAPTICS.indexOf(style) < 0) return;
      const now = this.renderT;
      if (now - this.lastHaptic < 0.06 && style === this.lastHapticStyle) return;
      this.lastHaptic = now;
      this.lastHapticStyle = style;
      this.post({ type: "haptic", style });
    },

    heapMB() {
      try {
        if (typeof performance !== "undefined" && performance.memory && performance.memory.usedJSHeapSize) {
          return Math.round(performance.memory.usedJSHeapSize / 1048576);
        }
      } catch (e) { /* WebKit doesn't expose it */ }
      return null;
    },

    measure(ts) {
      const p = this.perfState;
      if (!p) return;
      p.frames++;
      const now = nowMs();
      if (now - p.last >= 5000) {
        const fps = Math.round((p.frames * 1000) / (now - p.last));
        p.frames = 0;
        p.last = now;
        this.post({ type: "perf", prepare_ms: this.entry ? this.entry.prepare_ms : null, activate_ms: p.activate_ms, first_frame_ms: p.first_frame_ms, fps, heap_mb: this.heapMB() });
      }
    },

    // ----- fx (cosmetic; never touches game state) -----

    fx() {
      if (this._fx) return this._fx;
      const self = this;
      // Silent while a demo fast-forwards to its poster tick (self.ffwd).
      this._fx = {
        pop(x, y, color, n) { if (!self.ffwd) self.fxPop(x, y, color, n); },
        float(text, x, y, color) { if (!self.ffwd) self.fxFloat(text, x, y, color); },
        shake(n) { if (!self.ffwd && (!self.opts || !self.opts.reduced)) self.shakeAmp = Math.max(self.shakeAmp, clamp(n === undefined ? 6 : n, 0, 16) * (self.run ? self.run.feel.shake : 1)); },
        flash(color) { if (self.ffwd) return; self.flashA = self.opts && self.opts.reduced ? 0.12 : 0.32; self.flashCol = color || "#FFFFFF"; },
        sound(name) { if (!self.ffwd) Sound.play(name); },
        haptic(style) { if (!self.ffwd) self.haptic(style); },
        // Where formulas that synthesize their own audio (microgame) should play it: the shared
        // master gain, so mute and volume apply. Null while muted, fast-forwarding or locked.
        audio() {
          if (self.ffwd || Sound.muted) return null;
          const ctx = Sound.ensure();
          return ctx && ctx.state === "running" ? { ctx, dest: Sound.master } : null;
        },
        sparkle(x, y, color, n) { if (!self.ffwd) self.fxSparkle(x, y, color, n); },
        ring(x, y, r, color) { if (!self.ffwd) self.fxRing(x, y, r || 40, color); },
      };
      return this._fx;
    },

    particleScale() {
      const feel = this.run ? this.run.feel.particles || 1 : 1;
      return (this.opts && this.opts.reduced ? 0.4 : 1) * feel;
    },

    fxPop(x, y, color, n) {
      if (!this.entry) return;
      const pal = this.entry.session.palette;
      const rng = this.cosmetic;
      n = Math.round(clamp(n === undefined ? 14 : n, 1, 60) * this.particleScale());
      for (let i = 0; i < n; i++) {
        const k = this.pNext;
        this.pNext = (this.pNext + 1) % PARTICLES;
        const a = (i / n) * Math.PI * 2 + rng() * 0.5;
        const sp = 70 + rng() * 170;
        this.pX[k] = x; this.pY[k] = y;
        this.pVX[k] = Math.cos(a) * sp; this.pVY[k] = Math.sin(a) * sp - 40;
        this.pMax[k] = this.pLife[k] = 0.45 + rng() * 0.45;
        this.pSize[k] = 2 + rng() * 4.5;
        this.pKind[k] = i % 3 === 0 ? 1 : 0;
        this.pCol[k] = color || (i % 2 || pal.look !== "glow" ? pal.accents[i % 4] : IRIDESCENT[i % 5]);
      }
      this.fxRing(x, y, 46, color || (pal.look === "glow" || pal.look === "neon" ? pal.glow : pal.ink));
    },

    fxSparkle(x, y, color, n) {
      if (!this.entry) return;
      const pal = this.entry.session.palette;
      const rng = this.cosmetic;
      n = Math.round(clamp(n === undefined ? 10 : n, 1, 40) * this.particleScale());
      for (let i = 0; i < n; i++) {
        const k = this.pNext;
        this.pNext = (this.pNext + 1) % PARTICLES;
        const a = rng() * Math.PI * 2;
        const sp = 30 + rng() * 110;
        this.pX[k] = x + Math.cos(a) * 6; this.pY[k] = y + Math.sin(a) * 6;
        this.pVX[k] = Math.cos(a) * sp; this.pVY[k] = Math.sin(a) * sp - 30;
        this.pMax[k] = this.pLife[k] = 0.5 + rng() * 0.5;
        this.pSize[k] = 3 + rng() * 5;
        this.pKind[k] = 2;
        this.pCol[k] = color || pal.accent;
      }
    },

    fxRing(x, y, r, color) {
      const k = this.rNext;
      this.rNext = (this.rNext + 1) % RINGS;
      this.rX[k] = x; this.rY[k] = y; this.rR[k] = r * 0.3; this.rMax[k] = r;
      this.rLife[k] = 0.42;
      this.rCol[k] = color || "#FFFFFF";
    },

    fxFloat(text, x, y, color) {
      if (text === undefined || text === null || text === "") return;
      const k = this.fNext;
      this.fNext = (this.fNext + 1) % FLOATS;
      this.fText[k] = String(text);
      this.fX[k] = x; this.fY[k] = y;
      this.fLife[k] = 0.9;
      this.fCol[k] = color || "";
    },

    resetFx(session) {
      this.pLife.fill(0);
      this.rLife.fill(0);
      this.fLife.fill(0);
      this.shakeAmp = 0;
      this.flashA = 0;
      this.renderT = 0;
      this.cosmetic = makeRng(seedToU32(session.manifest.seed) ^ 0xa5a5a5);
      this.ambient = this.ambientFor(session.manifest.seed);
    },

    ambientFor(seed) {
      let a = this.ambientCache.get(seed);
      if (a) return a;
      const n = 28;
      a = { n, x: new Float32Array(n), y: new Float32Array(n), r: new Float32Array(n), d: new Float32Array(n), v: new Float32Array(n), ph: new Float32Array(n) };
      const rng = makeRng(seedToU32(seed) ^ 0x51ed27);
      for (let i = 0; i < n; i++) {
        a.x[i] = rng();
        a.y[i] = rng();
        a.d[i] = 0.25 + rng() * 0.75;
        a.r[i] = 3 + Math.pow(rng(), 2) * 22 * a.d[i];
        a.v[i] = 8 + rng() * 16;
        a.ph[i] = rng() * Math.PI * 2;
      }
      if (this.ambientCache.size > 12) this.ambientCache.clear();
      this.ambientCache.set(seed, a);
      return a;
    },

    // ----- rendering -----

    warm(entry, run) {
      // Draws the first frame into a tiny canvas at the real scale: creates the sprites this
      // Bubble needs, JIT-warms its draw code and finds out whether it draws its own scenery;
      // then pre-renders the look's backdrop at the real size.
      if (!this.dom) return;
      if (!this.warmCanvas) this.warmCanvas = makeCanvas(2, 2);
      const ctx = this.warmCanvas.getContext("2d");
      const cssW = this.cssW || 390, cssH = this.cssH || 844, ratio = this.dpr || 2;
      entry.hudShown = run.hud.score !== false;
      const insets = entry.payload && isObj(entry.payload.insets) ? entry.payload.insets : this.opts ? this.opts.insets : null;
      const fit = this.fitFor(cssW, cssH, insets, this.hudRowFor(entry, insets));
      const style = entry.session.style;
      entry.ownScenery = false;
      this.drawFrame(ctx, run, style, cssW, cssH, ratio, fit, { poster: false, t: 0, fx: false, ambientSeed: run.manifest.seed, entry, skipBackdrop: true });
      entry.ownScenery = this.g.sceneryCalls > 0;
      this.backdropFor(entry, style, cssW, cssH, ratio, fit, false);
    },

    render(dt) {
      const d = this.dom;
      if (!d || !this.run || !this.entry) return;
      this.updateFx(dt);
      this.drawFrame(d.ctx, this.run, this.entry.session.style, this.cssW, this.cssH, this.dpr, this.fit, { poster: false, t: this.renderT, fx: true, dt, entry: this.entry });
    },

    // The look's background at this size, cached per Bubble (two at a time). Includes the motif
    // unless the Bubble draws its own scenery (g.scenery).
    backdropFor(entry, style, cssW, cssH, ratio, fit, noCache) {
      if (!entry || !hasDOM) return null;
      const lowRes = style.look === "pixel";
      const res = lowRes ? 0.5 : Math.min(ratio, 2);
      const motif = entry.ownScenery ? "none" : style.motif;
      const b = noCache ? null : this.backdrops.get(entry);
      if (b && b.w === cssW && b.h === cssH && b.res === res && b.scale === fit.scale && b.oy === fit.oy && b.motif === motif) return b.canvas;
      let canvas;
      if (lowRes) {
        const v = fit.view;
        canvas = makeCanvas(Math.ceil(v.w * res), Math.ceil(v.h * res));
        paintBackdrop(canvas.getContext("2d"), new Graphics(), style, v.w, v.h, res, { scale: 1, ox: -v.x0, oy: -v.y0, view: v }, motif);
      } else {
        canvas = makeCanvas(cssW * res, cssH * res);
        paintBackdrop(canvas.getContext("2d"), new Graphics(), style, cssW, cssH, res, fit, motif);
      }
      if (!noCache) {
        this.backdrops.delete(entry);
        this.backdrops.set(entry, { canvas, w: cssW, h: cssH, res, scale: fit.scale, oy: fit.oy, motif });
        while (this.backdrops.size > 2) this.backdrops.delete(this.backdrops.keys().next().value);
      }
      return canvas;
    },

    // Root classes and CSS variables: the Bubble frame takes the look's font and colors.
    applyStyle(style) {
      const d = this.dom;
      if (!d) return;
      const pal = style.palette;
      d.root.className = "look-" + style.look + " palette-" + pal.id + " font-" + style.font + (pal.dark ? " dark" : "") + (this.opts && this.opts.reduced ? " reduced" : "");
      const rs = d.root.style;
      if (!rs || typeof rs.setProperty !== "function") return;
      const vars = {
        "--top": pal.bgTop, "--bottom": pal.bgBottom, "--ink": pal.ink, "--glow": pal.glow,
        "--primary": pal.primary, "--secondary": pal.secondary, "--accent": pal.accent, "--danger": pal.danger,
        "--a1": pal.accents[0], "--a2": pal.accents[1], "--a3": pal.accents[2], "--a4": pal.accents[3],
        "--surface": pal.surface, "--surface-strong": pal.surfaceStrong, "--on-primary": pal.inkOn(pal.primary),
        "--font": style.fontStack,
      };
      for (const k of Object.keys(vars)) rs.setProperty(k, vars[k]);
    },

    // The Bubble frame's pop transition: the game opens like a bubble from a point.
    popIn(at) {
      const d = this.dom;
      if (!d || !d.canvas.classList) return;
      const fit = this.fit;
      const x = at && fit ? fit.ox + at.x * fit.scale : this.cssW / 2;
      const y = at && fit ? fit.oy + at.y * fit.scale : this.cssH * 0.52;
      d.root.style.setProperty("--pop-x", Math.round(x) + "px");
      d.root.style.setProperty("--pop-y", Math.round(y) + "px");
      d.canvas.classList.remove("pop-in");
      d.pop.classList.remove("go");
      void d.canvas.offsetWidth;
      d.canvas.classList.add("pop-in");
      if (!(this.opts && this.opts.reduced)) d.pop.classList.add("go");
    },

    updateFx(dt) {
      if (!(dt > 0)) return;
      for (let i = 0; i < PARTICLES; i++) {
        if (this.pLife[i] <= 0) continue;
        this.pLife[i] -= dt;
        const drag = this.pKind[i] === 2 ? 0.9 : 0.94;
        this.pVX[i] *= drag;
        this.pVY[i] = this.pVY[i] * drag + (this.pKind[i] === 2 ? -10 : 140) * dt;
        this.pX[i] += this.pVX[i] * dt;
        this.pY[i] += this.pVY[i] * dt;
      }
      for (let i = 0; i < RINGS; i++) if (this.rLife[i] > 0) this.rLife[i] -= dt;
      for (let i = 0; i < FLOATS; i++) {
        if (this.fLife[i] <= 0) continue;
        this.fLife[i] -= dt;
        this.fY[i] -= 46 * dt;
      }
      if (this.shakeAmp > 0.05) {
        this.shakeAmp *= Math.pow(0.0009, dt);
        this.shakeX = (this.cosmetic() * 2 - 1) * this.shakeAmp;
        this.shakeY = (this.cosmetic() * 2 - 1) * this.shakeAmp;
      } else {
        this.shakeAmp = this.shakeX = this.shakeY = 0;
      }
      if (this.flashA > 0) this.flashA = Math.max(0, this.flashA - dt * 1.4);
    },

    // Screen-space life behind the playfield: bubbles (glow), motes (neon), chalk dust (chalk).
    drawAmbient(g, cssW, cssH, t, run, amb, k) {
      const look = g.look;
      if (look !== "glow" && look !== "neon" && look !== "chalk") return;
      const feel = run.feel || EMPTY;
      const reduced = this.opts && this.opts.reduced;
      const n = Math.min(amb.n, Math.round((look === "glow" ? 14 : 10) * (feel.ambient || 1) * (reduced ? 0.5 : 1)));
      const scroll = run.state && run.state.scroll ? run.state.scroll.x : 0;
      const pal = g.palette, ctx = g.ctx;
      if (look === "neon") ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < n; i++) {
        const depth = amb.d[i];
        const r = amb.r[i] * k * 0.9;
        const span = cssH + 80;
        let y = (amb.y[i] * span - t * amb.v[i] * (reduced ? 0.35 : 1) * depth) % span;
        if (y < 0) y += span;
        y -= 40;
        const spanX = cssW + 80;
        let x = (amb.x[i] * spanX - scroll * k * depth * 0.35 + Math.sin(t * 0.7 + amb.ph[i]) * 10 * depth) % spanX;
        if (x < 0) x += spanX;
        x -= 40;
        if (look === "glow") {
          const wv = reduced ? 0 : Math.sin(t * 4.2 + x * 0.05 + y * 0.03) * 0.02;
          g.skin.bubble(g, x, y, r, pal.glow, 0.35, 0.28 + depth * 0.4, 1 + wv, 1 - wv);
        } else if (look === "neon") {
          g.sprite("spark", x, y, 2 + r * 0.18, pal.accents[i & 3], (0.25 + 0.45 * depth) * (0.6 + 0.4 * Math.sin(t * 1.7 + amb.ph[i])), 1, 1, 0);
        } else {
          SKIN_GLOW.circle(g, x, y, 0.8 + r * 0.05, pal.ink, 0.1 + depth * 0.12);
        }
      }
      ctx.globalCompositeOperation = "source-over";
    },

    drawFrame(ctx, run, style, cssW, cssH, ratio, fit, o) {
      const g = this.g;
      const reduced = !!(this.opts && this.opts.reduced);
      const entry = o.entry || this.entry;
      const sx = o.fx ? this.shakeX : 0, sy = o.fx ? this.shakeY : 0;
      if (style.look === "pixel") {
        // Pixel: draw everything into a low-res buffer (2 playfield units per pixel), then scale
        // it up with nearest-neighbor sampling.
        const v = fit.view, k = 0.5;
        const bw = Math.ceil(v.w * k), bh = Math.ceil(v.h * k);
        if (!this.lowBuf || this.lowBuf.width !== bw || this.lowBuf.height !== bh) {
          this.lowBuf = makeCanvas(bw, bh);
          this.lowCtx = this.lowBuf.getContext("2d");
        }
        const b = this.lowCtx;
        b.setTransform(1, 0, 0, 1, 0, 0);
        b.imageSmoothingEnabled = false;
        const bd = o.skipBackdrop ? null : this.backdropFor(entry, style, cssW, cssH, ratio, fit, o.noCache);
        if (bd) b.drawImage(bd, 0, 0);
        else { b.fillStyle = style.palette.bgTop; b.fillRect(0, 0, bw, bh); }
        const tx = Math.round((-v.x0 + sx / fit.scale) * k), ty = Math.round((-v.y0 + sy / fit.scale) * k);
        b.setTransform(k, 0, 0, k, tx, ty);
        g.begin(b, style, k, v, o.t, { reduced, poster: o.poster, lowRes: true });
        g.originX = tx;
        g.originY = ty;
        this.drawLayers(g, run, o);
        if (o.fx && this.flashA > 0.004) {
          b.setTransform(1, 0, 0, 1, 0, 0);
          b.globalAlpha = this.flashA;
          b.fillStyle = this.flashCol;
          b.fillRect(0, 0, bw, bh);
          b.globalAlpha = 1;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        const scaleDev = (ratio * fit.scale) / k;
        ctx.drawImage(this.lowBuf, 0, 0, bw, bh, 0, 0, bw * scaleDev, bh * scaleDev);
        ctx.imageSmoothingEnabled = true;
        return;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const bd = o.skipBackdrop ? null : this.backdropFor(entry, style, cssW, cssH, ratio, fit, o.noCache);
      if (bd) ctx.drawImage(bd, 0, 0, cssW, cssH);
      else if (o.skipBackdrop) ctx.clearRect(0, 0, cssW, cssH);
      else { ctx.fillStyle = style.palette.bgTop; ctx.fillRect(0, 0, cssW, cssH); }
      // Screen-space ambient life behind everything.
      g.begin(ctx, style, ratio, fit.view, o.t, { reduced, poster: o.poster });
      g.originX = 0;
      g.originY = 0;
      const amb = o.ambientSeed !== undefined ? this.ambientFor(o.ambientSeed) : this.ambient;
      if (amb) this.drawAmbient(g, cssW, cssH, o.t, run, amb, fit.scale);
      // Playfield.
      const s = fit.scale;
      ctx.setTransform(ratio * s, 0, 0, ratio * s, ratio * (fit.ox + sx), ratio * (fit.oy + sy));
      g.begin(ctx, style, ratio * s, fit.view, o.t, { reduced, poster: o.poster });
      g.originX = ratio * (fit.ox + sx);
      g.originY = ratio * (fit.oy + sy);
      this.drawLayers(g, run, o);
      if (o.fx && this.flashA > 0.004) {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.globalAlpha = this.flashA;
        ctx.fillStyle = this.flashCol;
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.globalAlpha = 1;
      }
    },

    drawLayers(g, run, o) {
      const ctx = g.ctx;
      const layers = run.sortedLayers();
      let fxDone = !o.fx;
      g.sceneryCalls = 0;
      for (let i = 0; i < layers.length; i++) {
        const L = layers[i];
        if (!fxDone && L.z > Z.effects + 5) { this.drawFx(g); fxDone = true; }
        ctx.save();
        try {
          L.draw(g);
        } catch (e) {
          while (g.clipDepth > 0) g.unclip();
          ctx.restore();
          throw new Error(errMessage(e) + " (drawing " + L.owner + ")");
        }
        while (g.clipDepth > 0) g.unclip();
        ctx.restore();
        g.dash = null;
        g.lastFont = "";
      }
      if (!fxDone) this.drawFx(g);
    },

    drawFx(g) {
      const pal = g.palette;
      for (let i = 0; i < RINGS; i++) {
        const life = this.rLife[i];
        if (life <= 0) continue;
        const k = 1 - life / 0.42;
        const r = this.rR[i] + (this.rMax[i] - this.rR[i]) * ease.out(k);
        g.skin.ring(g, this.rX[i], this.rY[i], r, this.rCol[i], 3 * (1 - k) + 0.5, (1 - k) * 0.85);
      }
      for (let i = 0; i < PARTICLES; i++) {
        const life = this.pLife[i];
        if (life <= 0) continue;
        g.particle(this.pKind[i], this.pX[i], this.pY[i], this.pSize[i], life / this.pMax[i], this.pCol[i], this.pVX[i], this.pVY[i], i);
      }
      const fo = this.floatOpts || (this.floatOpts = { size: 20, weight: 800, color: "", glow: "", alpha: 1 });
      for (let i = 0; i < FLOATS; i++) {
        const life = this.fLife[i];
        if (life <= 0) continue;
        const k = 1 - life / 0.9;
        const pop = k < 0.2 ? ease.back(k / 0.2) : 1;
        fo.size = Math.round(20 * (0.7 + 0.3 * pop) * 4) / 4;
        fo.color = this.fCol[i] || pal.ink;
        fo.glow = pal.glow;
        fo.alpha = Math.min(1, (1 - k) * 2.2);
        g.text(this.fText[i], this.fX[i], this.fY[i], fo);
      }
    },

    // ----- DOM overlays -----

    updateHud(force) {
      const d = this.dom, run = this.run;
      if (!d || !run) return;
      const show = (this.stage === "playing" || this.stage === "moment") && run.hud.score !== false;
      d.hud.classList.toggle("hidden", !show);
      if (run.score !== this.lastScore || force) {
        const changed = this.lastScore >= 0 && run.score > this.lastScore;
        this.lastScore = run.score;
        d.hudScore.textContent = String(run.score);
        d.hudLabel.textContent = run.hud.label || "";
        if (changed) {
          d.hudScore.classList.remove("bump");
          void d.hudScore.offsetWidth;
          d.hudScore.classList.add("bump");
        }
        if (!force) this.post({ type: "score", value: run.score });
      }
    },

    cardEl(parts) {
      const d = this.dom;
      const card = d.card;
      while (card.firstChild) card.removeChild(card.firstChild);
      for (const p of parts) {
        if (!p) continue;
        const e = document.createElement("div");
        e.className = p[0];
        e.textContent = p[1];
        card.appendChild(e);
      }
      card.classList.remove("hidden");
      card.classList.remove("enter");
      void card.offsetWidth;
      card.classList.add("enter");
      return card;
    },

    showIntro() {
      const m = this.entry.session.manifest;
      const best = this.opts.player && typeof this.opts.player.best === "number" && this.opts.player.best > 0 ? this.opts.player.best : null;
      // The length (docs/BUBBLES.md 7.9): "Endless: beat 42" takes the place of "Your best 42";
      // "10 rounds", "60 seconds" and "3 lives" sit next to it.
      const len = displayLength(m, this.entry.session.formula);
      const lenText = lengthLabel(len, best);
      const endlessBest = len && len.mode === "endless" && best !== null;
      const card = this.cardEl([
        ["card-mark", ""],
        ["card-orb", m.style && m.style.emoji ? m.style.emoji : "🫧"],
        ["card-title", m.title],
        ["card-rule", m.one_line_rule || ""],
        lenText ? ["card-best card-length", lenText] : null,
        best !== null && !endlessBest ? ["card-best", "Your best " + best] : null,
        ["card-cta", "Tap to play"],
      ]);
      const chip = card.querySelector ? card.querySelector(".card-length") : null;
      if (chip && best !== null && !endlessBest) chip.style.marginRight = "6px";
      card.className = "bubble-card intro enter";
      this.dom.hud.classList.add("hidden");
    },

    // The card over a resumed run's frozen frame: the score so far and "Tap to keep going".
    showResumeCard() {
      const run = this.run;
      const label = run.hud.label || (run.score === 1 ? "point" : "points");
      const card = this.cardEl([
        ["card-kicker", "Welcome back"],
        ["card-score", String(run.score)],
        ["card-label", label],
        ["card-cta", "Tap to keep going"],
      ]);
      card.className = "bubble-card intro enter";
      this.dom.hud.classList.add("hidden");
    },

    showResultCard() {
      const run = this.run;
      const best = this.opts.player && typeof this.opts.player.best === "number" ? this.opts.player.best : null;
      const isBest = best !== null && run.score > best;
      const label = run.hud.label || (run.score === 1 ? "point" : "points");
      const kicker = run.outcome === "success" ? "You did it!" : "Game over";
      const cta = run.hud.retry === false ? run.hud.note || "Nice one" : run.hud.note || "Tap to play again";
      const card = this.cardEl([
        ["card-kicker", kicker],
        ["card-score", String(run.score)],
        ["card-label", label],
        isBest ? ["card-best new", "New best!"] : best !== null && best > 0 ? ["card-best", "Best " + best] : null,
        [run.hud.retry === false ? "card-note" : "card-cta", cta],
      ]);
      card.className = "bubble-card result enter";
      this.dom.hud.classList.add("hidden");
    },

    hideCard() {
      if (this.dom) this.dom.card.classList.add("hidden");
    },

    hideError() {
      if (this.dom) this.dom.error.classList.add("hidden");
    },

    fatal(e) {
      const message = errMessage(e);
      log("error: " + message);
      this.stopLoop();
      this.stage = "error";
      if (this.dom) {
        const err = this.dom.error;
        while (err.firstChild) err.removeChild(err.firstChild);
        const parts = [["error-orb", ""], ["card-title", "This game hit a snag"], ["card-rule", "Something in this game broke. Try another one."]];
        for (const p of parts) {
          const el = document.createElement("div");
          el.className = p[0];
          el.textContent = p[1];
          err.appendChild(el);
        }
        err.classList.remove("hidden");
        this.hideCard();
        this.dom.hud.classList.add("hidden");
      }
      this.post({ type: "error", message });
    },

    imageLoaded() {
      if (this.run && !this.loopOn && this.stage !== "idle" && this.stage !== "error") {
        try { this.render(0); } catch (e) { /* next frame */ }
      }
      // A poster drawn with placeholders: once all its images have settled, tell Swift that
      // calling poster() again gives the finished frame.
      for (const [key, recs] of this.posterWaits) {
        if (!this.sessions.has(key)) { this.posterWaits.delete(key); continue; }
        let settled = true, loaded = false;
        for (const r of recs) { if (r.ok) loaded = true; else if (!r.failed) settled = false; }
        if (!settled) continue;
        this.posterWaits.delete(key);
        if (loaded) this.post({ type: "poster_update", key });
      }
    },
  };

  if (hasDOM) {
    const api = {
      version: VERSION,
      prepare: (payloadJSON) => Host.prepare(payloadJSON),
      activate: (key, optionsJSON) => Host.activate(key, optionsJSON),
      poster: (key, optionsJSON) => Host.poster(key, optionsJSON),
      evict: (key) => Host.evict(key),
      boot: (payloadJSON) => Host.boot(payloadJSON),
      command: (cmd) => Host.command(cmd),
      get onmessage() { return Host.onmessage; },
      set onmessage(fn) { Host.onmessage = fn; },
      _host: Host,
    };
    root.BubbleHost = api;
    window.addEventListener("error", (ev) => {
      if (Host.entry && Host.stage !== "error") Host.fatal(ev.error || ev.message);
    });
    window.addEventListener("unhandledrejection", (ev) => {
      if (Host.entry && Host.stage !== "error") Host.fatal(ev.reason);
    });
    const init = () => { try { Host.initDOM(); } catch (e) { log("init failed: " + errMessage(e)); } };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
