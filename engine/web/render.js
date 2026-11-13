// Shared frame renderer for microgame engine frames: canvas drawing, assets,
// sound, music and haptics. Used by the browser shell (shell.js) and by the
// iOS app's runtime adapter (bundled by tools/make-app-bundle.mjs).
//
// Nothing here touches the DOM at import time, and nothing knows about the
// page around the canvas: callers pass the 2D context, the transform, and
// where audio should go.

import { rgbaToCss } from './microgame.js';

// ------------------------------------------------------------- drawing ----

/**
 * Draws a decoded frame.
 * opts.clear (default true): reset the transform and clear the whole canvas
 *   first. With `clear: false` the frame is drawn on top of whatever
 *   transform the caller set (e.g. a host's playfield transform).
 * opts.k: scale from canvas units to the current space; opts.ox/oy: offset
 *   in the current space (applied before the scale).
 * opts.clip (default true): clip to the frame's canvas rectangle.
 * opts.noShake: ignore frame.shake.
 */
export function drawFrame(ctx, f, assets, opts = {}) {
  const k = opts.k ?? 1;
  ctx.save();
  if (opts.clear !== false) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.translate(opts.ox ?? 0, opts.oy ?? 0);
  ctx.scale(k, k);
  if (opts.clip !== false) {
    ctx.beginPath();
    ctx.rect(0, 0, f.width, f.height);
    ctx.clip();
  }
  if (f.background & 0xff) {
    ctx.fillStyle = rgbaToCss(f.background);
    ctx.fillRect(0, 0, f.width, f.height);
  }
  if (f.shake > 0.05 && !opts.noShake) {
    ctx.translate((Math.random() * 2 - 1) * f.shake, (Math.random() * 2 - 1) * f.shake);
  }
  for (const op of f.ops) {
    const alpha = Math.min(1, op.opacity);
    if (!(alpha > 0) || !(op.scale !== 0)) continue;
    ctx.globalAlpha = alpha;
    switch (op.op) {
      case 'rect': drawRect(ctx, op); break;
      case 'circle': drawCircle(ctx, op); break;
      case 'text': drawText(ctx, op); break;
      case 'image': drawImage(ctx, op, assets); break;
      case 'line': drawLine(ctx, op); break;
      case 'poly': drawPoly(ctx, op); break;
    }
  }
  ctx.restore();
}

/** Applies rotation (degrees, clockwise) and scale around (cx, cy). Returns true if it saved. */
function transformAround(ctx, op, cx, cy) {
  if (op.rotation === 0 && op.scale === 1) return false;
  ctx.save();
  ctx.translate(cx, cy);
  if (op.rotation) ctx.rotate((op.rotation * Math.PI) / 180);
  if (op.scale !== 1) ctx.scale(op.scale, op.scale);
  ctx.translate(-cx, -cy);
  return true;
}

function paint(ctx, op) {
  if (op.fill & 0xff) {
    ctx.fillStyle = rgbaToCss(op.fill);
    ctx.fill();
  }
  if ((op.stroke & 0xff) && op.stroke_width > 0) {
    ctx.strokeStyle = rgbaToCss(op.stroke);
    ctx.lineWidth = op.stroke_width;
    ctx.stroke();
  }
}

function drawRect(ctx, op) {
  const saved = transformAround(ctx, op, op.x + op.w / 2, op.y + op.h / 2);
  ctx.beginPath();
  const r = Math.max(0, Math.min(op.radius, Math.abs(op.w) / 2, Math.abs(op.h) / 2));
  if (r > 0) {
    const { x, y, w, h } = op;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  } else {
    ctx.rect(op.x, op.y, op.w, op.h);
  }
  paint(ctx, op);
  if (saved) ctx.restore();
}

function drawCircle(ctx, op) {
  const r = Math.abs(op.r * op.scale);
  ctx.beginPath();
  ctx.arc(op.x, op.y, r, 0, Math.PI * 2);
  paint(ctx, op);
}

function drawImage(ctx, op, assets) {
  const cx = op.x + op.w / 2, cy = op.y + op.h / 2;
  const flip = op.flip_x || op.flip_y;
  const saved = flip || op.rotation !== 0 || op.scale !== 1;
  if (saved) {
    ctx.save();
    ctx.translate(cx, cy);
    if (op.rotation) ctx.rotate((op.rotation * Math.PI) / 180);
    if (op.scale !== 1 || flip) ctx.scale(op.scale * (op.flip_x ? -1 : 1), op.scale * (op.flip_y ? -1 : 1));
    ctx.translate(-cx, -cy);
  }
  const a = assets && assets.images[op.asset];
  if (a && a.ok) {
    const cols = a.cols, rows = Math.ceil(a.frames / cols);
    const sw = a.img.naturalWidth / cols, sh = a.img.naturalHeight / rows;
    const f = op.frame % a.frames;
    ctx.drawImage(a.img, (f % cols) * sw, Math.floor(f / cols) * sh, sw, sh, op.x, op.y, op.w, op.h);
  } else {
    // Missing or still loading: a placeholder box with a cross.
    ctx.fillStyle = 'rgba(128,128,128,0.25)';
    ctx.fillRect(op.x, op.y, op.w, op.h);
    ctx.strokeStyle = 'rgba(128,128,128,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(op.x, op.y, op.w, op.h);
    ctx.moveTo(op.x, op.y); ctx.lineTo(op.x + op.w, op.y + op.h);
    ctx.moveTo(op.x + op.w, op.y); ctx.lineTo(op.x, op.y + op.h);
    ctx.stroke();
  }
  if (saved) ctx.restore();
}

function drawLine(ctx, op) {
  if (!(op.stroke & 0xff) || !(op.stroke_width > 0)) return;
  ctx.beginPath();
  ctx.moveTo(op.x1, op.y1);
  ctx.lineTo(op.x2, op.y2);
  ctx.strokeStyle = rgbaToCss(op.stroke);
  ctx.lineWidth = op.stroke_width;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawPoly(ctx, op) {
  const p = op.points; // flat [x0, y0, x1, y1, ...] (binary) or [[x, y], ...] (JSON)
  const flat = typeof p[0] === 'number' || p.length === 0;
  const n = flat ? p.length / 2 : p.length;
  if (n < 2) return;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = flat ? p[2 * i] : p[i][0], y = flat ? p[2 * i + 1] : p[i][1];
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  if (op.closed) ctx.closePath();
  ctx.lineJoin = 'round';
  paint(ctx, op);
  ctx.lineJoin = 'miter';
}

const fontCache = new Map();
function fontFor(weight, size, family) {
  const key = `${weight}|${size}|${family}`;
  let f = fontCache.get(key);
  if (!f) {
    const fam = family && family !== 'system' ? `"${family.replace(/"/g, '')}", ` : '';
    f = `${weight} ${size}px ${fam}system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    if (fontCache.size > 512) fontCache.clear();
    fontCache.set(key, f);
  }
  return f;
}

function drawText(ctx, op) {
  const fill = op.color & 0xff ? op.color : 0;
  const stroke = op.stroke & 0xff && op.stroke_width > 0 ? op.stroke : 0;
  if (!op.text || (!fill && !stroke)) return;
  const saved = transformAround(ctx, op, op.x + op.w / 2, op.y + op.h / 2);
  ctx.font = fontFor(op.weight, op.size, op.font);
  ctx.textAlign = op.align;
  ctx.textBaseline = 'middle';
  const x = op.align === 'left' ? op.x : op.align === 'right' ? op.x + op.w : op.x + op.w / 2;
  // Lines are already wrapped by the engine; each sits line_height apart.
  const lines = op.text.includes('\n') ? op.text.split('\n') : null;
  const lh = op.line_height || op.size * 1.25;
  const blockH = lines ? lh * lines.length : lh;
  let y = op.valign === 'top' ? op.y : op.valign === 'bottom' ? op.y + op.h - blockH : op.y + (op.h - blockH) / 2;
  y += lh / 2;
  if (stroke) {
    // The outline goes under the fill, so only its outer half shows.
    ctx.strokeStyle = rgbaToCss(stroke);
    ctx.lineWidth = op.stroke_width;
    ctx.lineJoin = 'round';
  }
  if (fill) ctx.fillStyle = rgbaToCss(fill);
  for (const line of lines || [op.text]) {
    if (stroke) ctx.strokeText(line, x, y);
    if (fill) ctx.fillText(line, x, y);
    y += lh;
  }
  if (saved) ctx.restore();
}

// --------------------------------------------------------------- audio ----

const MAX_SOUND_S = 5;

/**
 * Plays a frame's audio. `out` is {ctx: AudioContext, dest: AudioNode} or
 * null (muted / unavailable), so the host decides mute and master volume.
 * v0.2 entries: {kind: 'synth', wave, freqs, step_ms, slide_hz, ms, volume}
 * or {kind: 'sample', asset, rate, volume}.
 */
export function playSound(out, s, assets) {
  if (!out || !out.ctx || out.ctx.state !== 'running') return;
  const volume = Math.max(0, Math.min(1, s.volume ?? 0.6));
  if (!(volume > 0)) return;
  if (s.kind === 'sample') return playSample(out, s, volume, assets);
  const freqs = s.freqs || [];
  if (!freqs.length) return;
  const jingle = freqs.length > 1;
  const noteS = Math.max(0.02, Math.min(MAX_SOUND_S, (jingle ? s.step_ms : s.ms) / 1000));
  const peak = volume * (s.wave === 'square' || s.wave === 'sawtooth' ? 0.13 : 0.3);
  let t0 = out.ctx.currentTime;
  for (let i = 0; i < freqs.length && i < 64; i++) {
    const last = i === freqs.length - 1;
    note(out, s.wave, freqs[i], last ? s.slide_hz : null, t0, noteS, peak);
    t0 += noteS;
  }
}

function note(out, wave, freq, slideHz, t0, dur, peak) {
  if (!(freq > 0)) return;
  const ac = out.ctx;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = wave || 'sine';
  osc.frequency.setValueAtTime(Math.min(20000, freq), t0);
  if (slideHz > 0) osc.frequency.exponentialRampToValueAtTime(Math.min(20000, slideHz), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
  gain.gain.setValueAtTime(peak, t0 + Math.min(0.03, dur * 0.3));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(out.dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function playSample(out, s, volume, assets) {
  const buf = assets && assets.buffers[s.asset];
  if (!buf) return;
  const src = out.ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.max(0.1, Math.min(4, s.rate || 1));
  const gain = out.ctx.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(out.dest);
  src.start();
}

/** Looping music from frame.music; keep one per game and call sync() each frame. */
export class MusicPlayer {
  constructor() { this.cur = null; } // { buffer, src, gain }
  sync(out, m, assets) {
    const buf = m && m.playing && assets ? assets.buffers[m.asset] : null;
    if (!buf || !out || !out.ctx || out.ctx.state !== 'running') { this.stop(); return; }
    if (this.cur && this.cur.buffer !== buf) this.stop();
    if (!this.cur) {
      const src = out.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = out.ctx.createGain();
      src.connect(gain).connect(out.dest);
      src.start();
      this.cur = { buffer: buf, src, gain };
    }
    this.cur.gain.gain.value = Math.max(0, Math.min(1, m.volume));
  }
  stop() {
    if (!this.cur) return;
    try { this.cur.src.stop(); } catch { /* already stopped */ }
    this.cur.src.disconnect();
    this.cur = null;
  }
}

// -------------------------------------------------------------- assets ----

/**
 * Loads a game's assets (from `game.assets()`): inline SVG becomes a Blob URL
 * image, URLs and data URIs load as images, and sounds are decoded into
 * AudioBuffers with `audioCtx()` (a function, so audio can start late).
 * Failures are recorded and draw a placeholder; they never stop the game.
 * `onProgress(store)` runs after each asset settles.
 */
export class AssetStore {
  constructor(list, { audioCtx = () => null, onProgress = null, timeoutMs = 15000 } = {}) {
    this.list = list;
    this.images = [];
    this.buffers = [];
    this.urls = [];
    this.failed = [];
    this.loaded = 0;
    this.done = list.length === 0;
    this.audioCtx = audioCtx;
    const jobs = list.map((a) => this.load(a)
      .catch((e) => { this.failed.push({ name: a.name, error: String(e?.message || e) }); })
      .finally(() => { this.loaded++; if (onProgress) onProgress(this); }));
    const all = Promise.all(jobs);
    const timeout = new Promise((r) => setTimeout(r, timeoutMs));
    this.ready = Promise.race([all, timeout]).then(() => { this.done = true; });
  }

  async load(a) {
    if (a.kind === 'image') {
      let src = a.src;
      const frames = a.frames || 1, cols = a.cols || frames;
      if (a.svg) {
        let svg = a.src;
        if (!/xmlns=/.test(svg.slice(0, 400))) svg = svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
        // Give the sheet an intrinsic size so every browser can rasterize it.
        if (!/^<svg[^>]*\swidth=/.test(svg)) {
          const rows = Math.ceil(frames / cols);
          svg = svg.replace(/^<svg/, `<svg width="${a.w * cols}" height="${a.h * rows}"`);
        }
        src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        this.urls.push(src);
      }
      const img = new Image();
      if (!src.startsWith('data:') && !src.startsWith('blob:')) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      const entry = { img, ok: false, frames, cols };
      this.images[a.id] = entry;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error(`image '${a.name}' failed to load`));
        img.src = src;
      });
      if (!img.naturalWidth || !img.naturalHeight) throw new Error(`image '${a.name}' has no size`);
      entry.ok = true;
    } else if (a.kind === 'sound') {
      const ac = this.audioCtx();
      if (!ac) throw new Error('no WebAudio');
      const bytes = await fetchBytes(a.src);
      this.buffers[a.id] = await new Promise((resolve, reject) => {
        const p = ac.decodeAudioData(bytes, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
    }
  }

  dispose() {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
  }
}

/** data: URIs are decoded locally (fetch of data: URIs is blocked in some web views). */
async function fetchBytes(src) {
  const m = /^data:[^;,]*(;base64)?,/.exec(src);
  if (m) {
    const body = src.slice(m[0].length);
    if (m[1]) {
      const bin = atob(body);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out.buffer;
    }
    return new TextEncoder().encode(decodeURIComponent(body)).buffer;
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${src.slice(0, 80)}`);
  return res.arrayBuffer();
}

// ------------------------------------------------------------- haptics ----

export const HAPTIC_PATTERNS = {
  light: 10, medium: 20, heavy: 35, success: [15, 60, 15], warning: [25, 50, 25], error: [40, 40, 40, 40, 40],
};
