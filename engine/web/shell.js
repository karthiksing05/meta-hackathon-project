// shell.js: the browser shell. It has no game logic (spec B4): it forwards raw
// input to the engine, steps it once per animation frame, and draws whatever
// the frame says. It also owns the default start and end screens, sound,
// music, haptics, toasts, shake, asset loading and the v0.2 text field.

import { Microgame, MicrogameLoadError, MicrogameCrash, rgbaToCss } from './microgame.js';

const $ = (sel, root = document) => root.querySelector(sel);
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
const frameEl = $('#frame');
const picker = $('#picker');
const startEl = $('#start');
const endEl = $('#end');
const panel = $('#panel');
const badge = $('#badge');
const textField = $('#textfield');

const SWIPE_MIN_PX = 24;
const MAX_DT_MS = 100;
const END_DELAY_MS = 700;

let engine;
const games = new Map();   // picker value → { game, text, label }
let cur = null;            // current entry
let mode = 'idle';         // idle | start | playing | ending | ended | crashed
let endAt = 0;
let lastT = 0;
let fit = { s: 1, dpr: 1 };
let runtimeDiags = [];
let frameCount = 0;

// ------------------------------------------------------------ loading ----

async function main() {
  try {
    engine = await Microgame.init(new URL('./pkg/microgame.wasm', import.meta.url));
  } catch (e) {
    showPanel('Engine failed to load', textBlock(`${e.message}\n\nRun engine/build-wasm.sh, then serve engine/web over HTTP.`));
    return;
  }
  let names = [];
  try {
    names = await (await fetch('./games/index.json')).json();
  } catch {
    names = ['lights_out.json', 'snake.json', 'number_merge.json'];
  }
  // Preload every fixture so switching is instant (the feed does the same).
  for (const name of names) {
    try {
      const text = await (await fetch(`./games/${name}`)).text();
      addGame(`fixture:${name}`, text, name.replace(/\.json$/, ''), false);
    } catch (e) {
      console.warn(`could not load ${name}`, e);
    }
  }
  // ?game=snake opens a fixture; &play=1 skips the start screen.
  const params = new URLSearchParams(location.search);
  const wanted = `fixture:${params.get('game')}.json`;
  if (games.has(wanted)) select(wanted);
  else if (picker.options.length) select(picker.options[0].value);
  if (cur && params.get('play') === '1') cur.assets.ready.then(() => play());
  requestAnimationFrame(loop);
}

function randomSeed() {
  return (Math.random() * 0x7fffffff) >>> 0;
}

function fileSeed(text) {
  try { return JSON.parse(text)?.meta?.seed ?? undefined; } catch { return undefined; }
}

/** Compiles and loads a game. Shows diagnostics and returns false if it is invalid. */
function addGame(key, text, label, selectIt = true) {
  let game;
  try {
    game = engine.load(text, fileSeed(text) ?? randomSeed());
  } catch (e) {
    if (e instanceof MicrogameLoadError) showDiagnostics(`${label}: not a valid game`, e.diagnostics, text);
    else showPanel(`${label}: failed to load`, textBlock(String(e.message || e)));
    return false;
  }
  const warnings = game.meta.warnings || [];
  if (warnings.length) console.info(`${label}: ${warnings.length} warning(s)`, warnings);
  const old = games.get(key);
  if (old) old.game.dispose();
  else picker.add(new Option(game.meta.title || label, key));
  if (old) old.assets.dispose();
  const entry = { game, text, label: game.meta.title || label, assets: new AssetStore(game.assets()) };
  games.set(key, entry);
  entry.assets.ready.then(() => { if (cur === entry && mode === 'start') showStartReady(); });
  if (selectIt) select(key);
  return true;
}

function select(key) {
  const entry = games.get(key);
  if (!entry) return;
  cur = entry;
  picker.value = key;
  runtimeDiags = [];
  updateBadge();
  hideOverlays();
  stopMusic();
  $('[data-title]', startEl).textContent = entry.game.meta.title;
  $('[data-instructions]', startEl).textContent = entry.game.meta.instructions;
  startEl.classList.add('show');
  mode = 'start';
  showStartReady();
  setupTextField();
  resize();
}

/** The Play button waits for the game's assets (missing ones draw a placeholder). */
function showStartReady() {
  const btn = $('[data-play]', startEl);
  const a = cur && cur.assets;
  const loading = a && !a.done;
  btn.disabled = !!loading;
  btn.textContent = loading ? `Loading assets… ${a.loaded}/${a.list.length}` : 'Play';
  if (a && a.done && a.failed.length) console.warn(`${a.failed.length} asset(s) failed to load`, a.failed);
}

function play() {
  if (cur && !cur.assets.done) return;
  ensureAudio();
  hideOverlays();
  mode = 'playing';
  lastT = performance.now();
  if (cur?.game.meta.text_input) {
    textField.value = '';
    textField.disabled = false;
    textField.focus({ preventScroll: true });
  }
}

function restart() {
  stopMusic();
  if (!cur || cur.game.crashed) {
    if (cur) addGame(picker.value, cur.text, cur.label);
    return;
  }
  cur.game.restart(fileSeed(cur.text) ?? randomSeed());
  runtimeDiags = [];
  updateBadge();
  play();
}

// ----------------------------------------------------------- the loop ----

// The game always advances in fixed 60 Hz steps, whatever the display's
// refresh rate, so a seed plus an input log (stamped with step numbers)
// replays identically on every device.
const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 6;
let stepAcc = 0;

function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(MAX_DT_MS, Math.max(0, t - lastT));
  lastT = t;
  if (!cur || mode === 'idle' || mode === 'crashed') return;
  const game = cur.game;
  try {
    if (mode === 'playing' || mode === 'ending') {
      stepAcc = Math.min(stepAcc + dt, STEP_MS * MAX_STEPS_PER_FRAME);
      while (stepAcc >= STEP_MS) {
        stepAcc -= STEP_MS;
        const phase = game.step(STEP_MS);
        if (mode === 'playing' && phase !== 'playing') {
          mode = 'ending';
          endAt = t + END_DELAY_MS;
        }
      }
    }
    const f = game.frame();
    draw(f);
    const live = mode === 'playing' || mode === 'ending';
    if (live) {
      for (const s of f.audio) playSound(s);
      for (const h of f.haptics) haptic(h);
    }
    syncMusic(live ? f.music : null);
    for (const toast of f.toasts) showToast(toast.text, toast.ms);
    if (mode === 'ending' && t >= endAt) showEnd(game.status());
    if (++frameCount % 30 === 0) collectRuntimeDiagnostics(game);
  } catch (e) {
    mode = 'crashed';
    hideOverlays();
    showPanel(e instanceof MicrogameCrash ? 'The engine crashed' : 'Shell error',
      textBlock(`${e.message}\n\nPress Restart to reload the game.`));
    console.error(e);
  }
}

function showEnd(st) {
  mode = 'ended';
  textField.disabled = true;
  $('[data-result]', endEl).textContent = st.phase === 'won' ? 'You won!' : 'Game over';
  $('[data-score]', endEl).textContent = st.score == null ? '' : formatScore(st.score);
  $('[data-detail]', endEl).textContent = `${(st.time_ms / 1000).toFixed(1)} s`;
  endEl.classList.add('show');
}

function formatScore(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function hideOverlays() {
  startEl.classList.remove('show');
  endEl.classList.remove('show');
}

function collectRuntimeDiagnostics(game) {
  const d = game.diagnostics();
  if (!d.length) return;
  console.warn('runtime diagnostics', d);
  runtimeDiags.push(...d);
  if (runtimeDiags.length > 200) runtimeDiags.splice(0, runtimeDiags.length - 200);
  updateBadge();
}

function updateBadge() {
  badge.style.display = runtimeDiags.length ? 'inline-block' : 'none';
  badge.textContent = `${runtimeDiags.length} runtime error${runtimeDiags.length === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------- rendering ----

function resize() {
  if (!cur) return;
  const { w, h } = cur.game.meta.canvas;
  const stage = $('#stage').getBoundingClientRect();
  const s = Math.max(0.1, Math.min((stage.width - 16) / w, (stage.height - 16) / h));
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${Math.round(w * s)}px`;
  canvas.style.height = `${Math.round(h * s)}px`;
  canvas.width = Math.round(w * s * dpr);
  canvas.height = Math.round(h * s * dpr);
  fit = { s, dpr };
  placeTextField();
}

function draw(f) {
  const k = fit.s * fit.dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (f.background & 0xff) {
    ctx.fillStyle = rgbaToCss(f.background);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  let ox = 0, oy = 0;
  if (f.shake > 0.05) {
    ox = (Math.random() * 2 - 1) * f.shake;
    oy = (Math.random() * 2 - 1) * f.shake;
  }
  ctx.setTransform(k, 0, 0, k, ox * k, oy * k);
  for (const op of f.ops) {
    const alpha = Math.min(1, op.opacity);
    if (!(alpha > 0) || !(op.scale !== 0)) continue;
    ctx.globalAlpha = alpha;
    switch (op.op) {
      case 'rect': drawRect(op); break;
      case 'circle': drawCircle(op); break;
      case 'text': drawText(op); break;
      case 'image': drawImage(op); break;
      case 'line': drawLine(op); break;
      case 'poly': drawPoly(op); break;
    }
  }
  ctx.globalAlpha = 1;
}

/** Applies rotation (degrees, clockwise) and scale around (cx, cy). Returns true if it saved. */
function transformAround(op, cx, cy) {
  if (op.rotation === 0 && op.scale === 1) return false;
  ctx.save();
  ctx.translate(cx, cy);
  if (op.rotation) ctx.rotate((op.rotation * Math.PI) / 180);
  if (op.scale !== 1) ctx.scale(op.scale, op.scale);
  ctx.translate(-cx, -cy);
  return true;
}

function paint(op) {
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

function drawRect(op) {
  const saved = transformAround(op, op.x + op.w / 2, op.y + op.h / 2);
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
  paint(op);
  if (saved) ctx.restore();
}

function drawCircle(op) {
  const r = Math.abs(op.r * op.scale);
  ctx.beginPath();
  ctx.arc(op.x, op.y, r, 0, Math.PI * 2);
  paint(op);
}

function drawImage(op) {
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
  const a = cur.assets.images[op.asset];
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

function drawLine(op) {
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

function drawPoly(op) {
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
  paint(op);
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

function drawText(op) {
  const fill = op.color & 0xff ? op.color : 0;
  const stroke = op.stroke & 0xff && op.stroke_width > 0 ? op.stroke : 0;
  if (!op.text || (!fill && !stroke)) return;
  const saved = transformAround(op, op.x + op.w / 2, op.y + op.h / 2);
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

// -------------------------------------------------------------- input ----

let down = null; // { id, x, y }

function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  const { w, h } = cur.game.meta.canvas;
  return [((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h];
}

function send(fn) {
  if (mode !== 'playing' || !cur) return;
  try { fn(cur.game); } catch (e) { console.error(e); }
}

// Keep keyboard focus in the text field when the canvas is clicked.
canvas.addEventListener('mousedown', (e) => { if (document.activeElement === textField) e.preventDefault(); });

canvas.addEventListener('pointerdown', (e) => {
  ensureAudio();
  if (mode !== 'playing') return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  down = { id: e.pointerId, x: e.clientX, y: e.clientY };
  const [x, y] = toCanvas(e);
  send((g) => g.pointer('down', x, y));
});
canvas.addEventListener('pointermove', (e) => {
  if (!down || e.pointerId !== down.id) return;
  const [x, y] = toCanvas(e);
  send((g) => g.pointer('move', x, y));
});
function pointerEnd(e) {
  if (!down || e.pointerId !== down.id) return;
  const [x, y] = toCanvas(e);
  send((g) => g.pointer('up', x, y));
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  down = null;
  if (e.type === 'pointercancel') return;
  if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_MIN_PX) {
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    send((g) => g.swipe(horizontal ? Math.sign(dx) : 0, horizontal ? 0 : Math.sign(dy)));
  }
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);

// Keys go to the engine as full events (code, printable char, down/up).
// While the text field has focus, only Enter reaches the game as a key; the
// field itself submits on Enter.
const keysDown = new Set();
function onKey(e, down) {
  const t = e.target;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
  const inField = t === textField;
  if (down) ensureAudio();
  if (down && !inField && (mode === 'start' || mode === 'ended') && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    if (mode === 'start') play(); else restart();
    return;
  }
  if (mode !== 'playing') return;
  if (inField && e.key !== 'Enter') return;
  if (!down && !keysDown.delete(e.code)) return; // an up without a down we saw (e.g. focus moved)
  if (down) keysDown.add(e.code);
  let matched = false;
  send((g) => { matched = g.keyEvent(e.code, e.key, down); });
  if (!inField && (matched || e.key.startsWith('Arrow') || e.key === ' ')) e.preventDefault();
}
window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));
window.addEventListener('blur', () => {
  // Release held keys so games don't see a key stuck down.
  for (const code of keysDown) send((g) => g.keyEvent(code, '', false));
  keysDown.clear();
});

// ------------------------------------------------------- text field ----

function setupTextField() {
  const ti = cur?.game.meta.text_input;
  textField.hidden = !ti;
  textField.disabled = true;
  textField.value = '';
  if (!ti) return;
  textField.placeholder = ti.placeholder || 'Type here';
  textField.maxLength = ti.max_len || 32;
}

function placeTextField() {
  const ti = cur?.game.meta.text_input;
  if (!ti) return;
  const { w: cw, h: ch } = cur.game.meta.canvas;
  const r = ti.x == null ? { x: 12, y: ch - 60, w: cw - 24, h: 48 } : { x: ti.x, y: ti.y, w: ti.w, h: ti.h };
  const size = ti.size ?? Math.max(12, Math.min(22, r.h * 0.45));
  const s = fit.s;
  Object.assign(textField.style, {
    left: `${r.x * s}px`, top: `${r.y * s}px`, width: `${r.w * s}px`, height: `${r.h * s}px`,
    fontSize: `${size * s}px`,
  });
}

textField.addEventListener('input', () => send((g) => g.text('change', textField.value)));
textField.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  const value = textField.value;
  send((g) => g.text('submit', value));
  textField.value = '';
  send((g) => g.text('change', ''));
});

window.addEventListener('resize', resize);
matchMedia?.('(resolution: 1dppx)')?.addEventListener?.('change', resize);

// ------------------------------------------------- sound, toasts, UI ----

let audioCtx = null;
function getAudioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!audioCtx && AC) audioCtx = new AC();
  return audioCtx;
}
/** Creates or resumes the AudioContext. Call from user gestures (it unlocks audio). */
function ensureAudio() {
  const ac = getAudioCtx();
  if (ac && ac.state === 'suspended') ac.resume();
}

const MAX_SOUND_S = 5;

/** v0.2 audio entries: {kind: 'synth', wave, freqs, step_ms, slide_hz, ms, volume} or {kind: 'sample', asset, rate, volume}. */
function playSound(s) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const volume = Math.max(0, Math.min(1, s.volume ?? 0.6));
  if (!(volume > 0)) return;
  if (s.kind === 'sample') return playSample(s, volume);
  const freqs = s.freqs || [];
  if (!freqs.length) return;
  const jingle = freqs.length > 1;
  const noteS = Math.max(0.02, Math.min(MAX_SOUND_S, (jingle ? s.step_ms : s.ms) / 1000));
  const peak = volume * (s.wave === 'square' || s.wave === 'sawtooth' ? 0.13 : 0.3);
  let t0 = audioCtx.currentTime;
  for (let i = 0; i < freqs.length && i < 64; i++) {
    const last = i === freqs.length - 1;
    note(s.wave, freqs[i], last ? s.slide_hz : null, t0, noteS, peak);
    t0 += noteS;
  }
}

function note(wave, freq, slideHz, t0, dur, peak) {
  if (!(freq > 0)) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = wave || 'sine';
  osc.frequency.setValueAtTime(Math.min(20000, freq), t0);
  if (slideHz > 0) osc.frequency.exponentialRampToValueAtTime(Math.min(20000, slideHz), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
  gain.gain.setValueAtTime(peak, t0 + Math.min(0.03, dur * 0.3));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function playSample(s, volume) {
  const buf = cur?.assets.buffers[s.asset];
  if (!buf) return;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.max(0.1, Math.min(4, s.rate || 1));
  const gain = audioCtx.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(audioCtx.destination);
  src.start();
}

// Music: one looping BufferSource, started and stopped from frame.music.
let music = null; // { asset, buffer, src, gain }
function syncMusic(m) {
  const buf = m && m.playing ? cur?.assets.buffers[m.asset] : null;
  if (!buf || !audioCtx || audioCtx.state !== 'running') { stopMusic(); return; }
  if (music && music.buffer !== buf) stopMusic();
  if (!music) {
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = audioCtx.createGain();
    src.connect(gain).connect(audioCtx.destination);
    src.start();
    music = { buffer: buf, src, gain };
  }
  music.gain.gain.value = Math.max(0, Math.min(1, m.volume));
}
function stopMusic() {
  if (!music) return;
  try { music.src.stop(); } catch { /* already stopped */ }
  music.src.disconnect();
  music = null;
}

const HAPTIC_PATTERNS = {
  light: 10, medium: 20, heavy: 35, success: [15, 60, 15], warning: [25, 50, 25], error: [40, 40, 40, 40, 40],
};
function haptic(name) {
  if (typeof navigator.vibrate !== 'function') return;
  try { navigator.vibrate(HAPTIC_PATTERNS[name] ?? 10); } catch { /* not allowed */ }
}

// ------------------------------------------------------------- assets ----

/**
 * Loads a game's assets (from `game.assets()`): inline SVG becomes a Blob
 * URL image, URLs and data URIs load as images, and sounds are decoded into
 * AudioBuffers. Failures are logged and draw a placeholder; they never stop
 * the game.
 */
class AssetStore {
  constructor(list) {
    this.list = list;
    this.images = [];
    this.buffers = [];
    this.urls = [];
    this.failed = [];
    this.loaded = 0;
    this.done = list.length === 0;
    const TIMEOUT_MS = 15000;
    const jobs = list.map((a) => this.load(a)
      .catch((e) => { this.failed.push({ name: a.name, error: String(e?.message || e) }); })
      .finally(() => { this.loaded++; if (this === cur?.assets && mode === 'start') showStartReady(); }));
    const all = Promise.all(jobs);
    const timeout = new Promise((r) => setTimeout(r, TIMEOUT_MS));
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
      const ac = getAudioCtx();
      if (!ac) throw new Error('no WebAudio');
      const res = await fetch(a.src);
      if (!res.ok) throw new Error(`sound '${a.name}': HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
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

function showToast(text, ms) {
  if (!text) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), Math.max(200, ms - 250));
  setTimeout(() => el.remove(), Math.max(450, ms));
}

function textBlock(s) {
  const pre = document.createElement('pre');
  pre.style.whiteSpace = 'pre-wrap';
  pre.textContent = s;
  return pre;
}

function showPanel(heading, ...nodes) {
  $('[data-heading]', panel).textContent = heading;
  $('[data-load]', panel).hidden = true;
  const body = $('[data-body]', panel);
  body.replaceChildren(...nodes);
  panel.classList.add('show');
}

function hidePanel() {
  panel.classList.remove('show');
}

/** Resolves a JSON Pointer in `doc`. */
function resolvePointer(doc, ptr) {
  if (!ptr) return doc;
  let v = doc;
  for (const raw of ptr.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (v == null || typeof v !== 'object') return undefined;
    v = v[key];
  }
  return v;
}

function showDiagnostics(heading, diags, text) {
  let doc = null;
  try { doc = JSON.parse(text); } catch { /* the diagnostics say why */ }
  const items = diags.map((d) => {
    const el = document.createElement('div');
    el.className = `diag ${d.severity}`;
    const head = document.createElement('div');
    head.innerHTML = '<code></code> at <code></code>';
    head.children[0].textContent = d.code;
    head.children[1].textContent = d.at || '/';
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.textContent = d.message;
    el.append(head, msg);
    if (d.hint) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = d.hint;
      el.append(hint);
    }
    const src = doc ? resolvePointer(doc, d.at) : undefined;
    if (typeof src === 'string') {
      const pre = document.createElement('pre');
      const chars = [...src];
      if (d.span) {
        const [a, b] = d.span;
        const mark = document.createElement('mark');
        mark.textContent = chars.slice(a, Math.max(b, a + 1)).join('') || ' ';
        pre.append(chars.slice(0, a).join(''), mark, chars.slice(Math.max(b, a + 1)).join(''));
      } else {
        pre.textContent = src;
      }
      el.append(pre);
    }
    return el;
  });
  showPanel(`${heading} (${diags.filter((d) => d.severity === 'error').length} errors)`, ...items);
}

let customCount = 0;
function loadCustom(text, name) {
  const key = `custom:${++customCount}`;
  if (addGame(key, text, name || 'custom game')) hidePanel();
}

picker.addEventListener('change', () => { select(picker.value); picker.blur(); });
$('#restart').addEventListener('click', (e) => { e.currentTarget.blur(); restart(); });
$('[data-play]', startEl).addEventListener('click', play);
$('[data-again]', endEl).addEventListener('click', restart);
$('[data-close]', panel).addEventListener('click', hidePanel);
badge.addEventListener('click', () => showDiagnostics('Runtime diagnostics', runtimeDiags, cur ? cur.text : ''));

$('#paste').addEventListener('click', () => {
  const ta = document.createElement('textarea');
  ta.placeholder = 'Paste a game.json here';
  ta.spellcheck = false;
  showPanel('Paste a game');
  $('[data-body]', panel).replaceChildren(ta);
  const btn = $('[data-load]', panel);
  btn.hidden = false;
  btn.onclick = () => loadCustom(ta.value, 'pasted game');
  ta.focus();
});

$('#open').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) loadCustom(await file.text(), file.name);
  e.target.value = '';
});

const drop = $('#drop');
window.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('show'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.classList.remove('show'); });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('show');
  const file = e.dataTransfer.files[0];
  if (file) loadCustom(await file.text(), file.name);
  else {
    const text = e.dataTransfer.getData('text/plain');
    if (text) loadCustom(text, 'dropped game');
  }
});

// For tests and debugging: the current game (e.g. `microgameShell.game().log()`).
window.microgameShell = { game: () => cur?.game, mode: () => mode, assets: () => cur?.assets };

main();
