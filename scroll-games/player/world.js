// Generic canvas/DOM renderer for gameplay worlds (view.world). The runtime owns all state;
// this module draws it and turns pointer / tilt / text input into recorded session inputs.
const W = 360;
const H = 600;
const $ = (id) => document.getElementById(id);
const FRUIT_HUE = [350, 50, 280, 330, 120, 30, 20, 220];
const PAD_COLORS = ['#ff4d5e', '#2ecc71', '#4da3ff', '#ffc857'];
const LANE_COLORS = ['#ff7a59', '#ffc857', '#7af0ff', '#ff7ac8'];
const images = new Map();

let send = () => {};
let world = null;
let canvas;
let ctx;
let scale = 1;
let ptr = null;
let strokeLive = [];
let lastMove = 0;
let lastTilt = 0;
let tiltOn = false;

export function initWorld(sendInput) {
  send = sendInput;
  canvas = $('world-canvas');
  ctx = canvas.getContext('2d');
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  $('w-text').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('w-text-input');
    if (input.value.trim()) send({ type: 'text', text: input.value });
    input.value = '';
  });
  $('w-mic').addEventListener('click', listen);
  $('w-submit').addEventListener('click', () => send({ type: 'submit' }));
  $('w-overlay-btn').addEventListener('click', () => send({ type: 'ack' }));
  $('w-hint').addEventListener('click', () => {
    const h = ((world && world.ents) || []).find((e) => e.role === 'hint');
    if (h) send({ type: 'tap', x: h.x, y: h.y });
  });
}

function listen() {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const lang = (world && world.input.voice && world.input.voice.language) || 'en-US';
  if (!Rec) {
    const t = prompt('Say your answer');
    if (t) send({ type: 'voice', text: t });
    return;
  }
  const r = new Rec();
  r.lang = lang;
  r.onresult = (e) => send({ type: 'voice', text: e.results[0][0].transcript });
  r.start();
}

function logical(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}

function enableTilt() {
  if (tiltOn) return;
  tiltOn = true;
  const start = () =>
    addEventListener('deviceorientation', (e) => {
      const x = Math.max(-1, Math.min(1, (e.gamma || 0) / 30));
      const q = Math.round(x * 10) / 10;
      const now = performance.now();
      if (q !== lastTilt && now - lastTilt_t > 80) {
        lastTilt = q;
        lastTilt_t = now;
        send({ type: 'tilt', x: q });
      }
    });
  if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) {
    DeviceOrientationEvent.requestPermission().then((s) => s === 'granted' && start()).catch(() => {});
  } else start();
}
let lastTilt_t = 0;

function dialStep(p) {
  const steps = world.input.dial.steps;
  const a = Math.atan2(p.y - 300, p.x - 180);
  return Math.round(((a + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * steps) % steps;
}

function down(e) {
  if (!world) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  const p = logical(e);
  const inp = world.input;
  ptr = { x0: p.x, y0: p.y, x: p.x, y: p.y, moved: 0 };
  strokeLive = [[p.x, p.y]];
  if (inp.tilt) enableTilt();
  if (inp.drag) send({ type: 'drag', phase: 'start', x: p.x, y: p.y });
  if (inp.hold) send({ type: 'press' });
  if (inp.dial) send({ type: 'dial', step: dialStep(p) });
}

function move(e) {
  if (!ptr || !world) return;
  const p = logical(e);
  ptr.moved = Math.max(ptr.moved, Math.hypot(p.x - ptr.x0, p.y - ptr.y0));
  ptr.x = p.x;
  ptr.y = p.y;
  const inp = world.input;
  const now = performance.now();
  if (inp.draw) {
    const last = strokeLive[strokeLive.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) > 5) strokeLive.push([p.x, p.y]);
  }
  if (now - lastMove < 33) return;
  lastMove = now;
  if (inp.drag) send({ type: 'drag', phase: 'move', x: p.x, y: p.y });
  if (inp.dial) send({ type: 'dial', step: dialStep(p) });
}

function up(e) {
  if (!ptr || !world) return;
  const p = logical(e);
  const inp = world.input;
  const d = ptr;
  ptr = null;
  if (inp.drag) send({ type: 'drag', phase: 'end', x: p.x, y: p.y });
  if (inp.hold) send({ type: 'release' });
  const dx = p.x - d.x0;
  const dy = p.y - d.y0;
  if (inp.draw && strokeLive.length > 1 && d.moved > 8) {
    send({ type: 'draw', points: strokeLive.map((q) => [Math.round(q[0]), Math.round(q[1])]) });
  } else if (inp.swipe && Math.hypot(dx, dy) >= (inp.swipe.min || 30)) {
    send({ type: 'swipe', dx: Math.round(dx), dy: Math.round(dy), x: Math.round(d.x0), y: Math.round(d.y0) });
  } else if (inp.tap && d.moved < 14) {
    send({ type: 'tap', x: Math.round(p.x), y: Math.round(p.y) });
  }
  strokeLive = [];
}

function img(url) {
  if (!url) return null;
  let i = images.get(url);
  if (!i) {
    i = new Image();
    i.crossOrigin = 'anonymous';
    i.src = url;
    images.set(url, i);
  }
  return i.complete && i.naturalWidth ? i : null;
}

function rrect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

function text(t, x, y, size, color = '#fff', weight = 700) {
  ctx.font = `${weight} ${size}px -apple-system, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t, x, y);
}

function wrap(t, x, y, w, size) {
  const words = String(t).split(' ');
  const lines = [];
  let cur = '';
  ctx.font = `700 ${size}px -apple-system, system-ui, sans-serif`;
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > w && cur) {
      lines.push(cur);
      cur = word;
    } else cur = test;
  }
  lines.push(cur);
  lines.forEach((l, i) => text(l, x, y + (i - (lines.length - 1) / 2) * (size + 2), size));
}

function drawSpace(w) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  if (w.bg && w.bg !== '#101018' && w.space === 'canvas') {
    ctx.fillStyle = w.bg;
    ctx.fillRect(0, 0, W, H);
  }
  if (w.space === 'lanes' || w.space === 'rhythm') {
    const n = w.lanes || 3;
    for (let i = 1; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo((W / n) * i, 0);
      ctx.lineTo((W / n) * i, H);
      ctx.stroke();
    }
    if (w.space === 'rhythm') {
      const y = w.extra.hit_y || 490;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  } else if (w.space === 'scroll') {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    const horizontal = w.flow[0] !== 0;
    for (let i = -1; i < 14; i++) {
      const off = (w.scroll * (w.flow[0] || w.flow[1]) * -1) % 80;
      if (horizontal) ctx.fillRect(i * 80 + off, H / 2 - 2, 40, 4);
      else ctx.fillRect(W / 2 - 2, i * 80 + off, 4, 40);
    }
  } else if (w.grid) {
    const { ox, oy, s } = w.grid;
    for (let r = 0; r < w.rows; r++) {
      for (let c = 0; c < w.cols; c++) {
        rrect(ox + c * s + 2, oy + r * s + 2, s - 4, s - 4, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fill();
      }
    }
  } else if (w.space === 'timeline') {
    w.zones.forEach((z, i) => {
      rrect(z[0] - z[2], z[1] - 36, z[2] * 2, 72, 12);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      text(String(i + 1), z[0], z[1], 20, 'rgba(255,255,255,0.4)');
    });
    text('earliest', 36, 130, 12, 'rgba(255,255,255,0.5)');
    text('latest', W - 30, 130, 12, 'rgba(255,255,255,0.5)');
  } else if (w.space === 'map') {
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    for (let x = 0; x <= W; x += 360 / (w.zoom + 3)) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H - 140);
      ctx.stroke();
    }
    for (let y = 0; y <= H - 140; y += 360 / (w.zoom + 3)) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    text(`zoom ${w.zoom}`, W - 36, 14, 12, 'rgba(255,255,255,0.5)');
  } else if (w.space === 'photo') {
    const i = img(w.photo);
    if (i) {
      const k = w.fit === 'contain' ? Math.min(W / i.naturalWidth, H / i.naturalHeight) : Math.max(W / i.naturalWidth, H / i.naturalHeight);
      ctx.drawImage(i, (W - i.naturalWidth * k) / 2, (H - i.naturalHeight * k) / 2, i.naturalWidth * k, i.naturalHeight * k);
    }
    const find = w.extra.find || [];
    find.forEach((f, k) => {
      ctx.font = '700 13px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(6, 8 + k * 20, ctx.measureText(`${f.found ? '✓' : '○'} ${f.label}`).width + 12, 18);
      ctx.fillStyle = f.found ? '#2ecc71' : '#fff';
      ctx.fillText(`${f.found ? '✓' : '○'} ${f.label}`, 12, 17 + k * 20);
    });
  } else if (w.space === 'words') {
    drawWordGrid(w);
  } else if (w.extra.dial) {
    drawDial(w.extra.dial);
  }
}

function drawWordGrid(w) {
  const wd = w.extra.word;
  if (!wd) return;
  const cell = Math.min(46, (W - 40) / wd.len);
  const x0 = (W - cell * wd.len) / 2;
  for (let r = 0; r < wd.max_rows; r++) {
    for (let c = 0; c < wd.len; c++) {
      const row = wd.rows[r];
      const ch = row ? row[c] : r === wd.rows.length ? { c: [...wd.cur][c] || '', s: 'cur' } : { c: '', s: '' };
      rrect(x0 + c * cell + 2, 14 + r * (cell + 2) + 2, cell - 4, cell - 4, 8);
      const fill = { correct: '#2ecc71', present: '#e0b020', absent: 'rgba(255,255,255,0.12)', cur: 'rgba(255,255,255,0.22)' }[ch.s] || 'rgba(255,255,255,0.06)';
      ctx.fillStyle = fill;
      ctx.fill();
      if (ch.c) text(ch.c, x0 + c * cell + cell / 2, 14 + r * (cell + 2) + cell / 2, cell * 0.5);
    }
  }
  if (wd.hint) text(`Hint: ${wd.hint}`, W / 2, 14 + wd.max_rows * (cell + 2) + 14, 14, 'rgba(255,255,255,0.8)');
  else if (wd.clue) text(wd.clue, W / 2, 14 + wd.max_rows * (cell + 2) + 14, 13, 'rgba(255,255,255,0.6)', 500);
}

function drawDial(d) {
  const cx = 180;
  const cy = 300;
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, 110, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < d.steps; i++) {
    const a = (i / d.steps) * Math.PI * 2 - Math.PI / 2;
    text(String(i), cx + Math.cos(a) * 85, cy + Math.sin(a) * 85, 14, i === d.value ? '#ffc857' : 'rgba(255,255,255,0.6)');
  }
  text(String(d.value), cx, cy, 44);
}

function drawEnt(e, w) {
  const x = e.x;
  const y = e.y;
  switch (e.role) {
    case 'tile': {
      const s = w.grid ? w.grid.s - 8 : 40;
      const merge = !Number.isNaN(Number(e.label));
      rrect(x - s / 2, y - s / 2, s, s, 10);
      ctx.fillStyle = merge ? `hsl(${(Math.log2(Number(e.label) || 2) * 32) % 360} 70% 50%)` : `hsl(${FRUIT_HUE[e.tag % 8]} 60% 28% / 0.7)`;
      ctx.fill();
      text(e.label, x, y + 1, merge ? s * 0.4 : s * 0.62);
      break;
    }
    case 'card': {
      const s = e.r * 2;
      rrect(x - e.r, y - e.r, s, s, 12);
      const down = e.state === 'down';
      ctx.fillStyle = down ? 'rgba(255,255,255,0.18)' : e.state === 'wrong' ? 'rgba(255,77,94,0.45)' : e.state === 'matched' ? 'rgba(46,204,113,0.35)' : 'rgba(255,255,255,0.9)';
      ctx.fill();
      if (down) text('✦', x, y, s * 0.4, 'rgba(255,255,255,0.5)');
      else {
        const i = img(e.img);
        if (i) ctx.drawImage(i, x - e.r + 4, y - e.r + 4, s - 8, s - 8);
        else text(e.label, x, y + 1, s * 0.5, '#111');
      }
      break;
    }
    case 'event':
    case 'pin': {
      rrect(x - e.hw, y - e.hh, e.hw * 2, e.hh * 2, 14);
      ctx.fillStyle = e.state === 'locked' ? 'rgba(46,204,113,0.55)' : e.state === 'drag' ? 'rgba(255,200,87,0.9)' : 'rgba(255,255,255,0.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      wrap((e.role === 'pin' ? '📍 ' : '') + e.label, x, y, e.hw * 2 - 12, 13);
      break;
    }
    case 'paddle':
      rrect(x - e.hw, y - e.hh, e.hw * 2, e.hh * 2, 8);
      ctx.fillStyle = '#fff';
      ctx.fill();
      break;
    case 'key': {
      rrect(x - e.hw, y - e.hh, e.hw * 2, e.hh * 2, 7);
      ctx.fillStyle = { correct: '#2ecc71', present: '#e0b020', absent: 'rgba(255,255,255,0.06)' }[e.state] || 'rgba(255,255,255,0.2)';
      ctx.fill();
      text(e.label, x, y + 1, 16);
      break;
    }
    case 'pad':
      rrect(x - e.hw + 3, y - e.hh + 3, e.hw * 2 - 6, e.hh * 2 - 6, 22);
      ctx.fillStyle = PAD_COLORS[e.tag % 4];
      ctx.globalAlpha = e.state === 'lit' ? 1 : 0.32;
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    case 'note':
      ctx.beginPath();
      ctx.arc(x, y, e.r, 0, Math.PI * 2);
      ctx.fillStyle = LANE_COLORS[Math.min(3, Math.floor(x / (W / 4)))];
      ctx.fill();
      break;
    case 'hotspot':
      if (e.state === 'found') {
        ctx.beginPath();
        ctx.arc(x, y, e.r, 0, Math.PI * 2);
        ctx.strokeStyle = '#2ecc71';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      break;
    case 'particle':
      ctx.globalAlpha = 0.7;
      text(e.label, x, y, 10, '#ffc857');
      ctx.globalAlpha = 1;
      break;
    default:
      text(e.label, x, y + 1, Math.max(18, e.r * 2.3));
  }
}

function drawStrokes(w) {
  const tr = w.extra.trace;
  if (tr) {
    tr.points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p[0], p[1], 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
    });
    text(`${tr.name}: ${tr.coverage}%`, W / 2, 24, 16);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const line = (pts, color, size) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.stroke();
  };
  for (const s of w.strokes) line(s.points, s.color, s.brush);
  if (ptr && world.input.draw && strokeLive.length > 1) line(strokeLive, world.input.draw.color, world.input.draw.brush);
}

function size() {
  const st = $('stage');
  const fit = Math.max(0.1, Math.min(st.clientWidth / W, st.clientHeight / H));
  canvas.style.width = `${Math.floor(W * fit)}px`;
  canvas.style.height = `${Math.floor(H * fit)}px`;
  const dpr = devicePixelRatio || 1;
  const cw = Math.round(canvas.clientWidth * dpr);
  const ch = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  scale = canvas.width / W;
}

const HUD_LABEL = { lives: '❤️', hints: '🦉', level: 'Lvl', found: '🔍', pairs: '🃏', wave: 'Wave', combo: 'Combo', collected: '🪙', coverage: '✏️', pinned: '📍', placed: '⏳', alive: '👥', shield: '🛡️', run: 'Run', best_tile: 'Best', sequence: 'Length', target: 'Goal' };

function renderHud(w) {
  const box = $('w-hud');
  const items = [];
  for (const [k, v] of Object.entries(w.hud)) {
    if (k.startsWith('clock') || k === 'levels' || k === 'difficulty') continue;
    if (k === 'lives') items.push('❤️'.repeat(Math.max(0, v)) || '💔');
    else if (k === 'shield') v && items.push('🛡️');
    else items.push(`${HUD_LABEL[k] || k} ${v}`);
  }
  box.hidden = items.length === 0;
  const html = items.map((t) => `<span class="chip">${t}</span>`).join('');
  if (box.dataset.html !== html) {
    box.dataset.html = html;
    box.innerHTML = html;
  }
}

/** Draw the world and sync DOM bits. `isStage` is true when a canvas space is active. */
export function renderWorld(w, view) {
  world = w;
  const stage = !!w.space;
  $('screen-game').classList.toggle('world-mode', stage);
  $('stage').hidden = !stage;
  renderHud(w);
  const toast = $('w-toast');
  toast.hidden = !w.toast;
  if (w.toast && toast.textContent !== w.toast) toast.textContent = w.toast;
  const ov = $('w-overlay');
  ov.hidden = !w.overlay;
  if (w.overlay) {
    $('w-overlay-text').textContent = w.overlay.text;
    $('w-overlay-btn').hidden = !w.overlay.button;
    ov.hidden = false;
  }
  if (!w.overlay && stage) {
    $('w-overlay').hidden = true;
  }
  const text_ = !!w.input.text || !!w.input.voice;
  $('w-text').hidden = !text_;
  $('w-mic').hidden = !w.input.voice;
  $('w-submit').hidden = !w.input.select;
  const hint = w.ents.find((e) => e.role === 'hint');
  $('w-hint').hidden = !(hint && !stage);
  if (!stage) return;
  size();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  drawSpace(w);
  for (const e of w.ents) drawEnt(e, w);
  drawStrokes(w);
  if (w.extra.hold) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(40, H - 30, ((W - 80) * w.extra.hold.ms) / w.extra.hold.max, 10);
  }
}

export function worldClock(w) {
  const total = w.hud.clock_total_ms;
  return total ? { left: w.hud.clock_ms, total } : null;
}
