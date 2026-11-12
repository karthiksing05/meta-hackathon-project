// shell.js: the browser shell. It has no game logic (spec B4): it forwards raw
// input to the engine, steps it once per animation frame, and draws whatever
// the frame says. It also owns the default start and end screens, sound,
// toasts and shake.

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
  if (cur && params.get('play') === '1') play();
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
  games.set(key, { game, text, label: game.meta.title || label });
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
  $('[data-title]', startEl).textContent = entry.game.meta.title;
  $('[data-instructions]', startEl).textContent = entry.game.meta.instructions;
  startEl.classList.add('show');
  mode = 'start';
  resize();
}

function play() {
  ensureAudio();
  hideOverlays();
  mode = 'playing';
  lastT = performance.now();
}

function restart() {
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
    for (const s of f.audio) playSound(s);
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
    if (op.op === 'rect') drawRect(op);
    else if (op.op === 'circle') drawCircle(op);
    else drawText(op);
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
  if (!op.text || !(op.color & 0xff)) return;
  const saved = transformAround(op, op.x + op.w / 2, op.y + op.h / 2);
  ctx.font = fontFor(op.weight, op.size, op.font);
  ctx.fillStyle = rgbaToCss(op.color);
  ctx.textAlign = op.align;
  ctx.textBaseline = 'middle';
  const x = op.align === 'left' ? op.x : op.align === 'right' ? op.x + op.w : op.x + op.w / 2;
  const lines = op.text.includes('\n') ? op.text.split('\n') : null;
  const lh = op.size * 1.2;
  const blockH = lines ? lh * lines.length : lh;
  let y = op.valign === 'top' ? op.y : op.valign === 'bottom' ? op.y + op.h - blockH : op.y + (op.h - blockH) / 2;
  y += lh / 2;
  if (lines) {
    for (const line of lines) { ctx.fillText(line, x, y); y += lh; }
  } else {
    ctx.fillText(op.text, x, y);
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

canvas.addEventListener('pointerdown', (e) => {
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

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
  if (mode === 'start' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); play(); return; }
  if (mode === 'ended' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); restart(); return; }
  if (mode !== 'playing') return;
  let matched = false;
  send((g) => { matched = g.key(e.code, e.key); });
  if (matched || e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
});

window.addEventListener('resize', resize);
matchMedia?.('(resolution: 1dppx)')?.addEventListener?.('change', resize);

// ------------------------------------------------- sound, toasts, UI ----

let audioCtx = null;
function ensureAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playSound({ wave, freq, ms }) {
  if (!audioCtx || audioCtx.state !== 'running' || !(freq > 0)) return;
  const t0 = audioCtx.currentTime;
  const dur = Math.max(0.02, Math.min(5, ms / 1000));
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = wave;
  osc.frequency.value = Math.min(20000, freq);
  const peak = wave === 'square' || wave === 'sawtooth' ? 0.08 : 0.18;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
  gain.gain.setValueAtTime(peak, t0 + Math.min(0.03, dur * 0.3));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
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

main();
