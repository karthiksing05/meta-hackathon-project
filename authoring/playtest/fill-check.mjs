// Fill check: does a microgame fill a phone screen? Phones are about 19.5:9, so the standard canvas is
// 360 × 780. Its top 110 and bottom 96 units are bleed bands: on a phone they run under the player's top
// bar (close, title) and bottom bar, so they hold background only. Key content (taps, the HUD, text)
// stays in the safe area between them, and the HUD sits in a band at the top of that area. Older
// 360 × 640 games are shown inside the bars with their background bled to the screen's edges by the
// runtime (docs/BUBBLES.md 4.6, "Filling the screen").
//
// Codes (F_*): the canvas aspect, whether the background covers the canvas, where the HUD is, key content
// in the bleed bands, and who draws the score (the game, the runtime HUD, both or neither).
// `checkFillStatic` reads the game JSON only; `checkFillFrames` reads engine frames (frameJSON); `fillCheck`
// plays the game headless for a few seconds (needs the engine, MG_ENGINE_DIR) and runs both.
//
// CLI: node authoring/playtest/fill-check.mjs <manifest-or-game.json>... [--json] [--static]

import { readFileSync } from 'node:fs';
import { TALL_CANVAS as STANDARD, isTall, safeArea } from '../expander/canvas.mjs';

export { STANDARD };
export const HUD_BAND = 72;           // canvas units: the top HUD row, from the top of the safe area
export const ASPECT_TOLERANCE = 0.12; // h/w within this of 780/360 is "19.5:9"
const DT = 1000 / 60;

export const CODES = {
  F_ASPECT: 'the canvas is not 19.5:9 (360 × 780), so a phone shows bands around it',
  F_BG_GAP: 'the background does not cover the canvas: some of it shows nothing behind the game',
  F_BACKDROP_SHORT: 'the backdrop image is smaller than the canvas',
  F_HUD_OUT_OF_BAND: 'a HUD readout (score, time, lives) sits outside the HUD bands',
  F_KEY_IN_BLEED: 'text or a tap target sits in a bleed band, under the player\'s bars on a phone',
  F_DOUBLE_HUD: 'the game draws its own score and also turns on the runtime score HUD',
  F_SCORE_HIDDEN: 'nobody shows the score: the game draws none and the runtime HUD is off',
};
export const HINTS = {
  F_ASPECT: 'use the standard 360 × 780 canvas (looks set it); keep key content between y 110 and 684',
  F_BG_GAP: 'start the root with a backdrop image or a rect covering the whole canvas, or give canvas.background an opaque color',
  F_BACKDROP_SHORT: 'draw the backdrop at the canvas size (x 0, y 0, w canvas_w, h canvas_h)',
  F_HUD_OUT_OF_BAND: 'put score, time and lives in hud_top (the band at the top of the safe area) or hud_bottom',
  F_KEY_IN_BLEED: 'move it into the safe area (y 110 to 684 on a 360 × 780 canvas); the bands are for background only',
  F_DOUBLE_HUD: 'turn runtime_hud off (space.microgame params) or stop drawing the score in the game',
  F_SCORE_HIDDEN: 'draw the score in hud_top, or turn runtime_hud on',
};
const SEVERITY = {
  F_ASPECT: 'warn', F_BG_GAP: 'error', F_BACKDROP_SHORT: 'error', F_HUD_OUT_OF_BAND: 'warn',
  F_KEY_IN_BLEED: 'error', F_DOUBLE_HUD: 'error', F_SCORE_HIDDEN: 'warn',
};

// A HUD readout: short, has a number, and names what it counts ("Score: 3", "Wave 2 of 5", "0:42 left").
const HUD_RE = /\b(score|time|timer|left|lives|life|level|round|best|streak|moves|coins?|strikes?|mistakes?|wave|lap|hp|health|combo|points?|pts)\b|\d+\s*(\/|of)\s*\d+|\d:\d\d/i;
const isHud = (t) => t.length <= 40 && /\d/.test(t) && HUD_RE.test(t);
const SCORE_RE = /\b(score|points?|pts)\b/i;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v ?? null);

function finding(code, at, detail, extra = {}) {
  return { code, severity: SEVERITY[code], at, message: CODES[code], detail, hint: HINTS[code], ...extra };
}

/** {manifest, game} from a wrapped manifest (content.game_json), or a bare game. */
export function readGame(input) {
  const v = parse(input);
  if (v?.content?.game_json || v?.content?.game) return { manifest: v, game: parse(v.content.game_json) ?? v.content.game };
  if (v?.game) return { manifest: v.manifest ?? null, game: parse(v.game) };
  return { manifest: null, game: v };
}

/** Bands in canvas units: bleed (tall canvases only), the safe area and the two HUD bands. */
export function bands(canvas) {
  const w = canvas?.w ?? 360, h = canvas?.h ?? 640;
  const tall = isTall({ w, h });
  const safe = safeArea({ w, h });
  return {
    w, h, tall, safe,
    // Older 360 × 640 games often stack two HUD rows: their top band is deeper.
    hudTop: { y0: safe.y0, y1: safe.y0 + HUD_BAND + (tall ? 0 : 78) },
    hudBottom: { y0: safe.y1 - HUD_BAND, y1: safe.y1 },
  };
}

/** Whether the runtime's score HUD is on (space.microgame runtime_hud), from the wrapped manifest. */
export function runtimeHudOn(manifest) {
  const c = (manifest?.concepts ?? []).find((u) => u?.use === 'space.microgame');
  return c?.params?.runtime_hud === true;
}

// ---------------------------------------------------------------- static ----

/** Checks that need only the game JSON (and the wrapped manifest, if any). */
export function checkFillStatic(input) {
  const { manifest, game } = readGame(input);
  const out = [];
  const canvas = game?.presentation?.canvas ?? {};
  const w = Number(canvas.w) || 360, h = Number(canvas.h) || 640;
  const ratio = h / w, ideal = STANDARD.h / STANDARD.w;
  if (Math.abs(ratio - ideal) > ASPECT_TOLERANCE) {
    out.push(finding('F_ASPECT', '/presentation/canvas', `${w} × ${h} is ${ratio.toFixed(2)}:1; phones are ${ideal.toFixed(2)}:1${isTall({ w, h }) ? '' : ' (the runtime bleeds its background into the bands)'}`));
  }
  // A backdrop image at the root that is smaller than the canvas.
  const kids = game?.presentation?.root?.children ?? [];
  for (let i = 0; i < Math.min(3, kids.length); i++) {
    const n = kids[i];
    if (n?.node !== 'image' || typeof n.w !== 'number' || typeof n.h !== 'number') continue;
    const x = Number(n.x ?? 0), y = Number(n.y ?? 0);
    if (x <= 2 && y <= 2 && n.w >= w * 0.9 && (n.w < w - 2 || n.h < h - 2)) {
      out.push(finding('F_BACKDROP_SHORT', `/presentation/root/children/${i}`, `backdrop is ${n.w} × ${n.h} on a ${w} × ${h} canvas`));
    }
  }
  return out;
}

// ---------------------------------------------------------------- frames ----

function u32(s) {
  if (s == null) return 0;
  if (typeof s === 'number') return s >>> 0;
  let x = String(s).replace('#', '');
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  if (x.length === 6) x += 'ff';
  return x.length === 8 ? parseInt(x, 16) >>> 0 : 0;
}
const opaque = (c) => (u32(c) & 0xff) === 0xff;

function covers(op) {
  if (!(op.opacity >= 0.99) || (op.rotation ?? 0) !== 0 || (op.scale ?? 1) !== 1) return false;
  if (op.op === 'rect') return opaque(op.fill);
  return op.op === 'image';
}

/** Fraction of a grid of points on the canvas that an opaque background (color, rect or large image) covers. */
export function coverage(frame, cols = 18, rows = 39) {
  const W = frame.width, H = frame.height;
  if (opaque(frame.background)) return { fraction: 1, gaps: [] };
  const big = frame.ops.filter((o) => covers(o) && o.w * o.h >= W * H * 0.2);
  let hit = 0;
  const gaps = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = ((c + 0.5) * W) / cols, y = ((r + 0.5) * H) / rows;
    if (big.some((o) => x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h)) hit++;
    else gaps.push([Math.round(x), Math.round(y)]);
  }
  return { fraction: hit / (cols * rows), gaps };
}

const textOps = (f) => f.ops.filter((o) => o.op === 'text' && typeof o.text === 'string' && o.text.trim() && o.opacity > 0.05);
const center = (o) => [o.x + o.w / 2, o.y + o.h / 2];
const inBand = (y, b) => y >= b.y0 - 4 && y <= b.y1 + 4;

/**
 * Checks on engine frames (frameJSON, in play order). Persistent HUD readouts are text ops that match a HUD
 * word or a number and show at about the same place in at least 60% of the frames.
 */
export function checkFillFrames(frames, { manifest = null, targets = null } = {}) {
  const out = [];
  if (!frames.length) return out;
  const B = bands({ w: frames[0].width, h: frames[0].height });
  // Background coverage: the worst frame.
  let worst = null;
  for (const f of frames) {
    const c = coverage(f);
    if (!worst || c.fraction < worst.fraction) worst = c;
  }
  if (worst.fraction < 0.98) {
    const ys = worst.gaps.map((g) => g[1]);
    out.push(finding('F_BG_GAP', '/presentation/root', `${Math.round(worst.fraction * 100)}% of the canvas is covered; gaps from y ${Math.min(...ys)} to ${Math.max(...ys)}`, { coverage: worst.fraction }));
  }
  // Persistent text: keyed by rounded position.
  const seen = new Map();
  for (const f of frames) {
    const keys = new Set();
    for (const o of textOps(f)) {
      const [cx, cy] = center(o);
      const key = `${Math.round(cx / 24)}:${Math.round(cy / 16)}`;
      if (keys.has(key)) continue;
      keys.add(key);
      const e = seen.get(key) ?? { n: 0, texts: new Set(), cx, cy, op: o };
      e.n++;
      e.texts.add(o.text);
      seen.set(key, e);
    }
  }
  const persistent = [...seen.values()].filter((e) => e.n >= Math.max(1, Math.ceil(frames.length * 0.6)));
  const hud = persistent.filter((e) => [...e.texts].some(isHud));
  for (const e of hud) {
    if (!inBand(e.cy, B.hudTop) && !inBand(e.cy, B.hudBottom)) {
      out.push(finding('F_HUD_OUT_OF_BAND', '/presentation/root', `"${[...e.texts][0]}" at y ${Math.round(e.cy)}; HUD bands are y ${B.hudTop.y0}–${B.hudTop.y1} and ${B.hudBottom.y0}–${B.hudBottom.y1}`));
    }
  }
  // Key content in the bleed bands (tall canvases only).
  if (B.tall) {
    const bleed = (y) => y < B.safe.y0 || y > B.safe.y1;
    for (const e of persistent) {
      if (bleed(e.cy)) out.push(finding('F_KEY_IN_BLEED', '/presentation/root', `text "${[...e.texts][0]}" at y ${Math.round(e.cy)}`));
    }
    for (const t of targets ?? []) {
      if (t.w >= B.w * 0.9 && t.h >= B.h * 0.6) continue; // a full-canvas drag or tap area
      const cy = t.y + t.h / 2;
      if (bleed(cy)) out.push(finding('F_KEY_IN_BLEED', '/presentation/root', `tap target at y ${Math.round(t.y)}–${Math.round(t.y + t.h)}`));
    }
  }
  // Who shows the score.
  const drawsScore = persistent.some((e) => [...e.texts].some((t) => SCORE_RE.test(t)));
  const runtimeHud = runtimeHudOn(manifest);
  if (drawsScore && runtimeHud) out.push(finding('F_DOUBLE_HUD', '/concepts', 'a score text is drawn every frame and runtime_hud is on'));
  if (!drawsScore && manifest && !runtimeHud && !hud.length) out.push(finding('F_SCORE_HIDDEN', '/concepts', 'no score or HUD text is drawn and runtime_hud is off'));
  return dedupe(out);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((f) => {
    const k = f.code + '|' + f.detail;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------- playing ----

/** Plays the game idle for `seconds` and samples frames every `everyMs` (needs the engine). */
export function sampleFrames(engine, gameJSON, { seed = 1, seconds = 8, everyMs = 1000 } = {}) {
  const g = engine.load(gameJSON, seed);
  const frames = [];
  let targets = null;
  try {
    const steps = Math.round((seconds * 1000) / DT), every = Math.max(1, Math.round(everyMs / DT));
    for (let i = 0; i <= steps; i++) {
      if (i % every === 0 || i === 1) {
        frames.push(g.frameJSON());
        if (!targets && typeof g.hitTargets === 'function') { try { targets = g.hitTargets(); } catch { targets = null; } }
      }
      if (g.status().phase !== 'playing' && i > 0) break;
      g.step(DT);
    }
  } finally {
    try { g.dispose(); } catch { /* gone */ }
  }
  return { frames, targets };
}

/** Static checks plus frame checks. Pass `engine` (from expander/engine.mjs) to play the game. */
export async function fillCheck(input, { engine = null, seed = 1 } = {}) {
  const { manifest, game } = readGame(input);
  const findings = checkFillStatic(input);
  if (engine) {
    const { frames, targets } = sampleFrames(engine, JSON.stringify(game), { seed });
    findings.push(...checkFillFrames(frames, { manifest, targets }));
  }
  const errors = findings.filter((f) => f.severity === 'error').length;
  return { ok: errors === 0, errors, findings };
}

// ---------------------------------------------------------------- CLI ----

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const json = args.includes('--json'), staticOnly = args.includes('--static');
  const files = args.filter((a) => !a.startsWith('--'));
  let engine = null;
  if (!staticOnly) {
    try { engine = (await (await import('../expander/engine.mjs')).loadEngine()).engine; }
    catch (e) { console.error(`engine not found, static checks only (${e.message.split('.')[0]})`); }
  }
  const results = [];
  for (const f of files) {
    try { results.push({ file: f, ...(await fillCheck(readFileSync(f, 'utf8'), { engine })) }); }
    catch (e) { results.push({ file: f, ok: false, errors: 1, findings: [], error: String(e.message).split('\n')[0] }); }
  }
  if (json) console.log(JSON.stringify(results, null, 2));
  else for (const r of results) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.file}${r.error ? `  (${r.error})` : ''}`);
    for (const x of r.findings) console.log(`  ${x.severity.padEnd(5)} ${x.code}  ${x.detail}`);
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
