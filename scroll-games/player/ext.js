// Renders view.ext (data from ext_meta.rs concept systems): HUD badges, toasts, overlays,
// accessibility adjustments, audio cues and the result-screen social/share panel.
// Owned by the meta-concepts work; player.js only calls renderExt every frame.

const STYLE_ID = 'sg-ext-style';

const CSS = `
#app { --sg-min-target: 0px; }
#app.sg-big-targets .choice, #app.sg-big-targets .btn, #app.sg-big-targets .icon-btn { min-height: var(--sg-min-target); min-width: var(--sg-min-target); }
#app.sg-reduced-motion *, #app.sg-reduced-motion *::before, #app.sg-reduced-motion *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
#app.sg-reduced-motion #fx { display: none; }
#app.sg-high-contrast .choice, #app.sg-high-contrast .btn, #app.sg-high-contrast .card { border: 2px solid var(--fg) !important; background: var(--bg) !important; color: var(--fg) !important; }
#app.sg-high-contrast .choice.correct { background: var(--good) !important; color: #000 !important; }
#app.sg-high-contrast .choice.wrong { background: var(--bad) !important; color: #000 !important; }
#app.sg-colorblind .choice.correct::before { content: '\\2713  '; }
#app.sg-colorblind .choice.wrong::before { content: '\\2717  '; }
#app.sg-dyslexia { font-family: 'OpenDyslexic', 'Atkinson Hyperlegible', 'Comic Sans MS', Verdana, sans-serif !important; letter-spacing: 0.04em; word-spacing: 0.12em; line-height: 1.5; }
#app.sg-dyslexia * { font-family: inherit !important; }
#app.sg-oh-right .choices, #app.sg-oh-right .card { margin-left: 16%; }
#app.sg-oh-left .choices, #app.sg-oh-left .card { margin-right: 16%; }
#app.sg-oh-right .choices { margin-top: auto; }
#app.sg-oh-left .choices { margin-top: auto; }
#app.sg-pause-anytime #btn-pause { position: fixed; z-index: 40; bottom: calc(14px + var(--safe-b, 0px)); left: 14px; width: 52px; height: 52px; border-radius: 50%; background: rgba(0,0,0,0.55); color: #fff; border: 2px solid #fff; }
#app.sg-oh-left.sg-pause-anytime #btn-pause { left: auto; right: 14px; }
#app.sg-retro { font-family: 'Courier New', monospace; }
#app.sg-retro .photo, #app.sg-retro img { image-rendering: pixelated; }
#app.sg-retro .card, #app.sg-retro .choice, #app.sg-retro .btn { border-radius: 0 !important; }
#app.sg-paper::after { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 30; opacity: var(--sg-grain, 0.3); mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/><feColorMatrix values='0 0 0 0 0.4  0 0 0 0 0.3  0 0 0 0 0.2  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
#app.sg-neon .choice, #app.sg-neon .card, #app.sg-neon .chip { box-shadow: 0 0 calc(18px * var(--sg-glow, 0.6)) var(--accent), inset 0 0 calc(8px * var(--sg-glow, 0.6)) var(--accent); border-color: var(--accent); }
#app.sg-neon .prompt, #app.sg-neon .score { text-shadow: 0 0 calc(14px * var(--sg-glow, 0.6)) var(--accent); }
#app.sg-light { --bg: #fff7ef; --bg2: #ffe9d6; --fg: #1b1424; --muted: rgba(27,20,36,0.65); --card: rgba(0,0,0,0.06); }
#app.sg-dark { --bg: #14111f; --bg2: #2a1b3d; --fg: #fff7ef; }
#app.sg-cozy { filter: sepia(0.22) saturate(1.1); }
#app.sg-juice-low #fx { opacity: 0.35; }
#app.sg-juice-high .choice:active { transform: scale(0.92); }
#app.sg-font-serif { font-family: Georgia, 'Times New Roman', serif; }
#app.sg-font-mono { font-family: ui-monospace, Menlo, monospace; }
#app.sg-font-display { font-family: 'Impact', 'Arial Black', sans-serif; letter-spacing: 0.02em; }
#app.sg-font-rounded { font-family: ui-rounded, 'SF Pro Rounded', 'Nunito', sans-serif; }
#app.sg-shake { animation: sg-shake 0.4s ease; }
@keyframes sg-shake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(calc(-10px * var(--sg-int, 0.5))); } 40% { transform: translateX(calc(10px * var(--sg-int, 0.5))); } 60% { transform: translateX(calc(-6px * var(--sg-int, 0.5))); } 80% { transform: translateX(calc(6px * var(--sg-int, 0.5))); } }
#card.sg-zoom { animation: sg-zoom 0.35s ease; }
@keyframes sg-zoom { 50% { transform: scale(calc(1 + var(--sg-zoom, 0.04))); } }
#timer.sg-pulse i { animation: sg-pulse var(--sg-pulse-s, 0.5s) ease-in-out infinite; }
@keyframes sg-pulse { 50% { opacity: 0.45; } }
#app.sg-slowmo .choice { animation-duration: 1.1s !important; transition-duration: 0.9s !important; }
#sg-vignette { position: absolute; inset: 0; pointer-events: none; z-index: 25; opacity: 0; transition: opacity 0.2s; box-shadow: inset 0 0 120px 40px rgba(255,0,30,0.85); }
#sg-wash { position: absolute; inset: 0; pointer-events: none; z-index: 1; transition: background 1s; mix-blend-mode: soft-light; }
#sg-toasts { position: absolute; top: calc(70px + var(--safe-t, 0px)); left: 50%; transform: translateX(-50%); z-index: 50; display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; }
.sg-toast { background: rgba(0,0,0,0.75); color: #fff; padding: 8px 14px; border-radius: 999px; font-weight: 700; }
#sg-floaters { position: absolute; top: calc(48px + var(--safe-t, 0px)); right: 14px; z-index: 45; pointer-events: none; }
.sg-floater { position: absolute; right: 0; font-weight: 800; font-size: 22px; white-space: nowrap; text-shadow: 0 2px 6px rgba(0,0,0,0.5); }
.sg-floater.neg { color: var(--bad); } .sg-floater.pos { color: var(--accent2); }
.sg-emoji { position: absolute; top: -40px; z-index: 44; pointer-events: none; font-size: 28px; animation: sg-fall 1.6s ease-in forwards; }
@keyframes sg-fall { to { transform: translateY(110vh) rotate(360deg); opacity: 0.9; } }
#sg-captions { position: absolute; left: 50%; bottom: calc(18px + var(--safe-b, 0px)); transform: translateX(-50%); z-index: 55; display: flex; flex-direction: column; gap: 4px; align-items: center; pointer-events: none; }
.sg-caption { background: rgba(0,0,0,0.85); color: #fff; padding: 6px 12px; border-radius: 6px; font-size: 16px; }
#sg-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
#sg-badges { display: contents; }
#sg-debug { position: absolute; left: 6px; bottom: 6px; z-index: 60; margin: 0; padding: 6px 8px; font: 11px/1.3 ui-monospace, Menlo, monospace; background: rgba(0,0,0,0.7); color: #9fffb0; border-radius: 6px; pointer-events: none; white-space: pre; }
#sg-riddle { display: flex; gap: 8px; width: 100%; }
#sg-riddle input { flex: 1; padding: 12px; font-size: 18px; border-radius: 12px; border: 2px solid var(--accent); background: var(--card); color: var(--fg); }
#sg-panel { width: 100%; max-width: 420px; margin: 10px auto; display: flex; flex-direction: column; gap: 10px; text-align: left; }
#sg-panel section { background: var(--card); border-radius: 14px; padding: 10px 12px; }
#sg-panel h3 { margin: 0 0 6px; font-size: 14px; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.06em; }
#sg-panel .row { display: flex; justify-content: space-between; padding: 2px 0; }
#sg-panel .row.you { font-weight: 800; color: var(--accent2); }
#sg-panel pre { margin: 0; font-size: 20px; line-height: 1.2; white-space: pre-wrap; }
#sg-panel button { margin: 2px 4px 2px 0; padding: 8px 12px; border-radius: 10px; border: 0; font-size: 16px; background: var(--accent); color: #fff; }
`;

const cache = {};
let audio = null;
let musicTimer = null;
let origVibrate = null;

function el(tag, props, parent) {
  const e = document.createElement(tag);
  Object.assign(e, props || {});
  if (parent) parent.appendChild(e);
  return e;
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = el('style', { id: STYLE_ID, textContent: CSS }, document.head);
  s.dataset.owner = 'ext';
}

// Run fn only when the JSON of `value` changed since the last call for `key`.
function changed(key, value) {
  const j = JSON.stringify(value === undefined ? null : value);
  if (cache[key] === j) return false;
  cache[key] = j;
  return true;
}

function ensureLayer(root, id, parent) {
  let n = document.getElementById(id);
  if (!n) n = el('div', { id }, parent || root);
  return n;
}

function setClass(root, name, on) {
  root.classList.toggle(name, !!on);
}

function applyA11y(root, a) {
  setClass(root, 'sg-reduced-motion', a.reduced_motion);
  setClass(root, 'sg-high-contrast', a.high_contrast);
  setClass(root, 'sg-colorblind', a.colorblind);
  setClass(root, 'sg-dyslexia', a.dyslexia_font);
  setClass(root, 'sg-pause-anytime', a.pause_anytime);
  setClass(root, 'sg-oh-right', a.one_handed === 'right');
  setClass(root, 'sg-oh-left', a.one_handed === 'left');
  setClass(root, 'sg-big-targets', a.min_target_px);
  if (a.min_target_px) root.style.setProperty('--sg-min-target', a.min_target_px + 'px');

  if (changed('palette', [a.palette, a.colorblind])) {
    const vars = Object.assign({}, a.palette || {});
    if (a.colorblind) {
      vars.good = a.colorblind.good;
      vars.bad = a.colorblind.bad;
    }
    for (const k of ['bg', 'bg2', 'fg', 'accent', 'good', 'bad']) {
      if (vars[k]) root.style.setProperty('--' + k, vars[k]);
      else root.style.removeProperty('--' + k);
    }
  }

  if (a.haptics_off && navigator.vibrate && origVibrate === null) {
    origVibrate = navigator.vibrate;
    navigator.vibrate = () => false;
  }

  const live = ensureLayer(root, 'sg-live');
  live.setAttribute('aria-live', 'polite');
  if (a.labels && changed('labels', a.labels)) {
    const l = a.labels;
    if (changed('announce', l.announce_n)) live.textContent = l.announce || '';
    const choices = document.querySelectorAll('#choices .choice');
    choices.forEach((b, i) => {
      if (l.choices && l.choices[i]) b.setAttribute('aria-label', l.choices[i]);
    });
    const prompt = document.getElementById('prompt');
    if (prompt && l.status) prompt.setAttribute('aria-description', l.status);
  }

  const caps = ensureLayer(root, 'sg-captions');
  if (changed('captions', a.captions)) {
    caps.textContent = '';
    for (const c of a.captions || []) el('div', { className: 'sg-caption', textContent: c.text }, caps);
  }
}

function applyStyle(root, st) {
  setClass(root, 'sg-retro', st.pixel_size);
  setClass(root, 'sg-paper', st.paper_grain);
  if (st.paper_grain) root.style.setProperty('--sg-grain', st.paper_grain);
  setClass(root, 'sg-neon', st.neon_glow);
  if (st.neon_glow) root.style.setProperty('--sg-glow', st.neon_glow);
  setClass(root, 'sg-cozy', st.cozy);
  setClass(root, 'sg-light', st.appearance === 'light');
  setClass(root, 'sg-dark', st.appearance === 'dark');
  for (const f of ['rounded', 'serif', 'mono', 'display']) setClass(root, 'sg-font-' + f, st.font === f);
  for (const j of ['low', 'high']) setClass(root, 'sg-juice-' + j, st.juice === j);
  const game = document.getElementById('screen-game');
  if (game) game.style.filter = st.palette_cycle ? `hue-rotate(${st.palette_cycle.hue}deg)` : '';
}

function pulseClass(node, cls, ms) {
  if (!node) return;
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
  setTimeout(() => node.classList.remove(cls), ms);
}

function applyFx(root, fx, a11y) {
  const calm = !!a11y.reduced_motion;
  const shake = fx.shake;
  if (shake && changed('shake', shake.n) && shake.active && !calm) {
    root.style.setProperty('--sg-int', shake.intensity);
    pulseClass(root, 'sg-shake', 420);
  }
  const zoom = fx.zoom;
  if (zoom && changed('zoom', zoom.n) && !calm) {
    root.style.setProperty('--sg-zoom', zoom.amount);
    pulseClass(document.getElementById('card'), 'sg-zoom', 380);
  }
  setClass(root, 'sg-slowmo', fx.slowmo && fx.slowmo.active && !calm);

  const vig = ensureLayer(root, 'sg-vignette');
  vig.style.opacity = String(fx.vignette || 0);

  const timer = document.getElementById('timer');
  if (timer) {
    const p = fx.timer_pulse;
    setClass(timer, 'sg-pulse', p && p.active);
    if (p && p.active && p.hz) timer.style.setProperty('--sg-pulse-s', (1 / p.hz).toFixed(2) + 's');
  }

  const wash = ensureLayer(root, 'sg-wash');
  if (fx.color_wash && changed('wash', fx.color_wash.hue)) {
    wash.style.background = fx.color_wash.hue ? `hsla(${fx.color_wash.hue}, 85%, 55%, 0.35)` : 'transparent';
  }

  const eb = fx.emoji_burst;
  if (eb && changed('emoji', eb.n) && !calm) {
    for (let i = 0; i < (eb.count || 12); i++) {
      const s = el('span', { className: 'sg-emoji', textContent: eb.emoji }, root);
      s.style.left = ((i * 37) % 100) + '%';
      s.style.animationDelay = ((i % 6) * 0.08).toFixed(2) + 's';
      setTimeout(() => s.remove(), 2200);
    }
  }

  const fl = ensureLayer(root, 'sg-floaters');
  if (changed('floaters', fx.floaters)) {
    fl.textContent = '';
    (fx.floaters || []).forEach((f) => {
      const n = el('div', { className: 'sg-floater ' + (f.delta < 0 ? 'neg' : 'pos'), textContent: (f.delta > 0 ? '+' : '') + f.delta }, fl);
      n.style.opacity = String(f.life);
      if (!calm) n.style.transform = `translateY(${Math.round((1 - f.life) * -40)}px)`;
    });
  }

  const tl = ensureLayer(root, 'sg-toasts');
  if (changed('toasts', fx.toasts)) {
    tl.textContent = '';
    for (const t of fx.toasts || []) el('div', { className: 'sg-toast', textContent: t.text }, tl);
  }
}

// ---- audio

function ctx() {
  if (audio) return audio;
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  try {
    audio = new C();
  } catch (e) {
    return null;
  }
  return audio;
}

function tone(freq, ms, vol, type, when) {
  const c = ctx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t0 = c.currentTime + (when || 0);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + ms / 1000 + 0.02);
}

const PACKS = {
  arcade: { type: 'square', correct: [660, 880], wrong: [220, 160] },
  soft: { type: 'sine', correct: [523, 659], wrong: [330, 262] },
  retro: { type: 'sawtooth', correct: [784, 988], wrong: [180, 120] },
};

const TRACKS = {
  chill: { bpm: 80, notes: [262, 330, 392, 330] },
  upbeat: { bpm: 140, notes: [392, 494, 587, 494, 659, 587] },
  tense: { bpm: 110, notes: [196, 208, 196, 233] },
};

function applySound(snd) {
  const pack = snd.pack || 'arcade';
  if (snd.cue && changed('cue', snd.n) && pack !== 'none') {
    const p = PACKS[pack] || PACKS.arcade;
    const [a, b] = p[snd.cue] || p.correct;
    const v = (snd.volume === undefined ? 0.7 : snd.volume) * 0.25;
    tone(a, 120, v, p.type, 0);
    tone(b, 160, v, p.type, 0.1);
  }
  const m = snd.music;
  const on = !!(m && m.playing && pack !== 'none');
  if (on && !musicTimer) {
    const tr = TRACKS[m.track] || TRACKS.chill;
    let i = 0;
    musicTimer = setInterval(() => {
      tone(tr.notes[i++ % tr.notes.length], 300, (m.volume || 0.4) * 0.08, 'triangle', 0);
    }, Math.round(60000 / tr.bpm / 2));
  } else if (!on && musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
}

function applyVoice(v) {
  if (!v || !changed('voice', v.n) || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(v.text));
  } catch (e) { /* speech is optional */ }
}

function applyContent(root, c, view) {
  const au = c.audio;
  if (au && au.url && changed('audio', au.round)) {
    try {
      const a = new Audio(au.url);
      a.play().catch(() => {});
      setTimeout(() => a.pause(), au.clip_ms || 5000);
    } catch (e) { /* audio is optional */ }
  }
  const box = document.getElementById('sg-riddle');
  const r = c.riddle;
  const show = !!(r && r.active && view.state === 'playing');
  if (show && !box) {
    const b = el('form', { id: 'sg-riddle' }, document.getElementById('choices') || root);
    const input = el('input', { type: 'text', autocomplete: 'off', placeholder: 'Your answer' }, b);
    el('button', { type: 'submit', className: 'btn primary', textContent: 'Go' }, b);
    b.addEventListener('submit', (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('sg:input', { detail: { type: 'text', text: input.value } }));
      input.value = '';
    });
  } else if (!show && box) {
    box.remove();
  }
}

// ---- HUD badges

function chip(parent, id, text) {
  let c = document.getElementById(id);
  if (!text) {
    if (c) c.remove();
    return;
  }
  if (!c) c = el('span', { id, className: 'chip' }, parent);
  if (c.textContent !== text) c.textContent = text;
}

function applyBadges(root, ext) {
  const left = document.querySelector('.hud-left');
  if (!left) return;
  const sc = ext.score || {};
  const soc = ext.social || {};
  const meta = ext.meta || {};
  chip(left, 'sg-b-combo', sc.combo > 1 ? `⚡ x${sc.combo}` : '');
  chip(left, 'sg-b-par', sc.par ? `Par ${sc.par.par}${sc.par.hit ? ' ✓' : ''}` : '');
  chip(left, 'sg-b-acc', sc.accuracy !== undefined ? `${sc.accuracy}%` : '');
  chip(left, 'sg-b-dist', sc.distance_m !== undefined ? `${Math.floor(sc.distance_m)} m` : '');
  chip(left, 'sg-b-coll', sc.collected !== undefined ? `⭐ ${sc.collected}` : '');
  const g = soc.ghost;
  chip(left, 'sg-b-ghost', g ? `👻 ${g.name} ${g.score} (${g.delta >= 0 ? '+' : ''}${g.delta})` : '');
  const hs = meta.hot_seat;
  chip(left, 'sg-b-seat', hs ? `P${hs.current + 1}` : '');
  const co = soc.coop;
  chip(left, 'sg-b-coop', co ? `Team ${co.pool}` : '');
  const bt = ext.content && ext.content.beats;
  chip(left, 'sg-b-beat', bt && bt.total ? `♪ ${bt.perfect + bt.good}/${bt.total}` : '');
}

function applyLocale(loc) {
  if (!loc || !changed('locale', loc)) return;
  document.documentElement.lang = loc.locale;
  document.documentElement.dir = loc.dir || 'ltr';
  const s = loc.strings || {};
  const set = (id, key) => {
    const n = document.getElementById(id);
    if (n && s[key]) n.textContent = s[key];
  };
  set('btn-again', 'play_again');
  const veil = document.querySelector('#pause-veil h2');
  if (veil && s.paused) veil.textContent = s.paused;
}

function applyDebug(root, d) {
  let n = document.getElementById('sg-debug');
  if (!d) {
    if (n) n.remove();
    return;
  }
  if (!n) n = el('pre', { id: 'sg-debug' }, root);
  n.textContent = `tick ${d.tick}  score ${d.score}  round ${d.round}  warn ${d.warnings}\n` + (d.recent || []).join('\n');
}

// ---- result-screen panel (social + share + meta)

function row(parent, left, right, you) {
  const r = el('div', { className: 'row' + (you ? ' you' : '') }, parent);
  el('span', { textContent: left }, r);
  el('span', { textContent: right }, r);
}

function board(panel, title, b) {
  if (!b || !b.rows) return;
  const s = el('section', null, panel);
  el('h3', { textContent: title }, s);
  for (const r of b.rows) row(s, `#${r.rank} ${r.name}`, String(r.score), r.you);
}

function button(parent, text, fn) {
  const b = el('button', { type: 'button', textContent: text }, parent);
  b.addEventListener('click', fn);
  return b;
}

function host(type, detail) {
  window.dispatchEvent(new CustomEvent('sg:social', { detail: Object.assign({ type }, detail || {}) }));
}

function renderPanel(panel, ext) {
  panel.textContent = '';
  const soc = ext.social || {};
  const sh = ext.share || {};
  const meta = ext.meta || {};
  board(panel, 'Friends', soc.friends_leaderboard);
  board(panel, soc.group_scoreboard ? `Scoreboard (${soc.group_scoreboard.scope})` : '', soc.group_scoreboard);
  if (soc.versus) {
    const s = el('section', null, panel);
    el('h3', { textContent: 'Head to head' }, s);
    const o = soc.versus.opponent || {};
    row(s, o.name || 'Opponent', o.score === undefined ? '...' : String(o.score));
    row(s, 'Result', soc.versus.status);
  }
  if (soc.coop) {
    const s = el('section', null, panel);
    el('h3', { textContent: 'Team score' }, s);
    row(s, 'You', String(soc.coop.mine), true);
    row(s, 'Team total', String(soc.coop.pool));
  }
  if (meta.hot_seat) {
    const s = el('section', null, panel);
    el('h3', { textContent: 'Pass and play' }, s);
    meta.hot_seat.scores.forEach((v, i) => row(s, `Player ${i + 1}`, String(v), meta.hot_seat.winner === i));
    if (meta.hot_seat.winner === 'tie') row(s, 'Result', 'Tie');
  }
  if (soc.reactions && soc.reactions.enabled) {
    const s = el('section', null, panel);
    el('h3', { textContent: 'React' }, s);
    for (const e of soc.reactions.available) {
      const n = soc.reactions.counts && soc.reactions.counts[e];
      button(s, n ? `${e} ${n}` : e, () => host('reaction', { sticker: e }));
    }
  }
  if (soc.comments && soc.comments.enabled) {
    const s = el('section', null, panel);
    el('h3', { textContent: 'Comments' }, s);
    for (const c of soc.comments.items || []) row(s, c.name || '', c.text || '');
    const input = el('input', { type: 'text', maxLength: soc.comments.max_len, placeholder: 'Add a comment' }, s);
    button(s, 'Post', () => {
      if (input.value.trim()) host('comment', { text: input.value.trim() });
      input.value = '';
    });
  }
  if (soc.follow && soc.follow.show && soc.follow.creator) {
    const s = el('section', null, panel);
    button(s, `Follow ${soc.follow.creator.name || 'creator'}`, () => host('follow', { creator: soc.follow.creator }));
  }
  if (soc.rematch && soc.rematch.available) {
    const s = el('section', null, panel);
    button(s, 'Rematch', () => host('rematch'));
  }
  const hasShare = sh.emoji_grid || sh.text || sh.invite || sh.daily_streak || sh.qr || sh.story || sh.replay_clip;
  if (hasShare) {
    const s = el('section', null, panel);
    el('h3', { textContent: 'Share' }, s);
    if (sh.daily_streak) el('div', { textContent: sh.daily_streak.text }, s);
    if (sh.emoji_grid) el('pre', { textContent: sh.emoji_grid.grid }, s);
    const text = sh.text || (sh.invite && sh.invite.text);
    if (text) button(s, 'Copy result', () => navigator.clipboard && navigator.clipboard.writeText(text + (sh.invite && sh.invite.url ? ' ' + sh.invite.url : '')));
    if (sh.invite && sh.invite.url) el('div', { textContent: sh.invite.url }, s);
    if (sh.qr) button(s, 'Show QR', () => host('qr', { payload: sh.qr.payload }));
    if (sh.story) button(s, 'Save story', () => host('story', sh.story));
    if (sh.replay_clip) button(s, 'Share replay', () => host('replay_clip', sh.replay_clip));
  }
}

function applyPanel(view, ext) {
  const host_ = document.getElementById('result-card');
  let panel = document.getElementById('sg-panel');
  if (view.state !== 'ended') {
    if (panel) panel.remove();
    delete cache.panel;
    return;
  }
  if (!host_) return;
  if (!panel) panel = el('div', { id: 'sg-panel' }, host_.parentNode);
  if (panel.previousSibling !== host_) host_.parentNode.insertBefore(panel, host_.nextSibling);
  if (changed('panel', [ext.social, ext.share, ext.meta && ext.meta.hot_seat])) renderPanel(panel, ext);
}

export function renderExt(ext, view) {
  ensureStyle();
  const root = document.getElementById('app');
  if (!root) return;
  ext = ext || {};
  const a11y = ext.a11y || {};
  applyA11y(root, a11y);
  applyStyle(root, ext.style || {});
  applyFx(root, ext.fx || {}, a11y);
  applySound(ext.sound || {});
  applyVoice(ext.voice);
  applyContent(root, ext.content || {}, view || {});
  applyBadges(root, ext);
  applyLocale(ext.meta && ext.meta.locale);
  applyDebug(root, ext.meta && ext.meta.debug);
  applyPanel(view || {}, ext);
}
