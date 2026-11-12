// shell.js: the browser shell. It has no game logic (spec B4): it forwards raw
// input to the engine, steps it once per animation frame, and draws whatever
// the frame says. It also owns the default start and end screens, sound,
// music, haptics, toasts, shake, asset loading and the v0.2 text field.

import { Microgame, MicrogameLoadError, MicrogameCrash } from './microgame.js';
import { drawFrame, playSound as playSoundTo, MusicPlayer, AssetStore as RenderAssetStore, HAPTIC_PATTERNS } from './render.js';

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
  drawFrame(ctx, f, cur.assets, { k: fit.s * fit.dpr });
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

const audioOut = () => (audioCtx ? { ctx: audioCtx, dest: audioCtx.destination } : null);
const playSound = (s) => playSoundTo(audioOut(), s, cur?.assets);
const music = new MusicPlayer();
const syncMusic = (m) => music.sync(audioOut(), m, cur?.assets);
const stopMusic = () => music.stop();

function haptic(name) {
  if (typeof navigator.vibrate !== 'function') return;
  try { navigator.vibrate(HAPTIC_PATTERNS[name] ?? 10); } catch { /* not allowed */ }
}

/** Shell wrapper: shows the start screen once assets finish loading. */
class AssetStore extends RenderAssetStore {
  constructor(list) {
    super(list, {
      audioCtx: getAudioCtx,
      onProgress: (store) => { if (store === cur?.assets && mode === 'start') showStartReady(); },
    });
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
