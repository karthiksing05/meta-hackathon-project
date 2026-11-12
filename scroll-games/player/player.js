// Scroll Games player: renders the runtime's JSON view model and bridges to the host.
import init, { Session } from './pkg/sg_runtime.js';
import { renderExt } from './ext.js';
import { initWorld, renderWorld, worldClock } from './world.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const QUERY = {
  game: params.get('game'),
  seed: params.get('seed'),
  challenge: params.get('challenge'),
  daily: /^\d{4}-\d{2}-\d{2}$/.test(params.get('daily') || '') ? params.get('daily') : '',
  embed: params.get('embed'),
  local: params.get('local') === '1',
  api: params.get('api') || '',
};
if (QUERY.embed === 'ios') document.documentElement.classList.add('embed-ios');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const iosHandler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.scrollGames;

// ---- host bridge -------------------------------------------------------------------------

function post(msg) {
  if (iosHandler) iosHandler.postMessage(msg);
}

function fail(message) {
  console.error('[sg]', message);
  post({ type: 'error', message: String(message) });
  $('error-text').textContent = String(message);
  showScreen('error');
}

// ---- screens -----------------------------------------------------------------------------

function showScreen(name) {
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('active', el.id === 'screen-' + name);
}

// ---- state -------------------------------------------------------------------------------

let session = null;
let loaded = null; // { manifest, content, seed, gameId, gameTitle }
let raf = 0;
let last = 0;
let lastRound = -1;
let lastScore = 0;
let finished = false;
let paused = false;
let wasPlaying = false;

// ---- loading -----------------------------------------------------------------------------

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

async function loadFromQuery() {
  let seed = QUERY.seed != null && QUERY.seed !== '' ? Number(QUERY.seed) >>> 0 : null;
  if (seed == null && QUERY.daily && !QUERY.local) {
    try {
      seed = (await fetchJSON(`${QUERY.api}/api/daily`)).seed >>> 0;
    } catch (e) {
      console.warn('[sg] could not fetch the daily seed', e);
    }
  }
  if (seed == null) seed = randomSeed();
  if (QUERY.local) {
    const tpl = (params.get('template') || 'quiz').replace(/[^a-z0-9_]/g, '');
    const [manifest, content] = await Promise.all([
      fetchJSON(`../spec/templates/${tpl}.manifest.json`),
      fetchJSON(`../spec/templates/${tpl === 'quiz' ? 'trip-trivia' : tpl}.content.json`),
    ]);
    return { manifest, content, seed, gameId: QUERY.game || 'local' };
  }
  if (!QUERY.game) return null;
  const body = await fetchJSON(`${QUERY.api}/api/games/${encodeURIComponent(QUERY.game)}`);
  const game = body.game || body;
  return { manifest: game.manifest, content: game.content, seed, gameId: game.id || QUERY.game };
}

function dailyLabel(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function present(payload) {
  stopLoop();
  $('btn-again').hidden = false;
  loaded = payload;
  finished = false;
  try {
    session = new Session(JSON.stringify(payload.manifest), JSON.stringify(payload.content), payload.seed >>> 0);
  } catch (e) {
    fail(e && e.message ? e.message : e);
    return;
  }
  const view = JSON.parse(session.view());
  applyTheme(view);
  $('intro-title').textContent = view.title;
  $('intro-emoji').textContent = (view.theme && view.theme.emoji) || '🎮';
  $('intro-copy').textContent = (view.copy && view.copy.intro) || '';
  $('hud-daily').hidden = !QUERY.daily;
  $('hud-daily').textContent = QUERY.daily ? `Daily · ${dailyLabel(QUERY.daily)}` : '';
  showScreen('intro');
}

window.SG = {
  load(p) {
    if (!p || !p.manifest || !p.content) return fail('SG.load needs {manifest, content, seed}');
    present({ manifest: p.manifest, content: p.content, seed: p.seed == null ? randomSeed() : p.seed, gameId: p.game_id || null });
  },
};

// ---- rendering ---------------------------------------------------------------------------

function applyTheme(view) {
  const app = $('app');
  const t = view.theme || {};
  if (t.palette) app.dataset.palette = t.palette;
  if (t.mood) app.dataset.mood = t.mood;
  app.classList.toggle('large-text', !!view.large_text);
  $('choices').classList.toggle('stack', view.layout === 'stack');
}

const FLASH_COLORS = { green: '46,204,113', red: '255,77,94', yellow: '255,200,87', white: '255,255,255' };

function flashColor(name) {
  if (FLASH_COLORS[name]) return `rgb(${FLASH_COLORS[name]})`;
  return name;
}

function renderChoices(view) {
  const box = $('choices');
  const rebuild = view.round !== lastRound || box.children.length !== view.choices.length;
  if (rebuild) {
    box.textContent = '';
    view.choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'choice';
      b.textContent = c.label;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pickChoice(i);
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') pickChoice(i);
      });
      box.appendChild(b);
    });
  }
  view.choices.forEach((c, i) => {
    const b = box.children[i];
    const cls = 'choice' + (c.state && c.state !== 'idle' ? ' ' + c.state : '');
    if (b.className !== cls) b.className = cls;
    b.disabled = view.state !== 'playing' || view.choices.some((x) => x.state === 'correct');
  });
}

function renderCard(view) {
  if (view.round === lastRound) return;
  const card = $('card');
  const photo = $('photo');
  $('prompt').textContent = view.prompt || '';
  if (view.media_url) {
    photo.style.backgroundImage = `url("${view.media_url}")`;
    photo.classList.toggle('contain', view.media_fit === 'contain');
    card.classList.remove('no-photo');
  } else {
    photo.style.backgroundImage = '';
    card.classList.add('no-photo');
  }
  if (!reducedMotion) {
    card.classList.remove('enter');
    void card.offsetWidth;
    card.classList.add('enter');
  }
}

function render(view) {
  renderExt(view.ext || {}, view);
  const w = view.world;
  const stage = !!(w && w.space);
  multiSelect = !!(w && w.input && w.input.select);
  if (w && (view.state === 'playing' || view.state === 'countdown' || view.state === 'paused')) renderWorld(w, view);
  if (view.state === 'playing' || view.state === 'countdown' || view.state === 'paused') {
    applyTheme(view);
    if (!stage) {
      renderCard(view);
      renderChoices(view);
    }
    $('hud-round').textContent = view.total_rounds ? `${Math.max(view.round, 1)}/${view.total_rounds}` : '';
    $('hud-round').hidden = !view.total_rounds;
    const score = $('hud-score');
    score.textContent = view.score;
    if (view.score !== lastScore && !reducedMotion) {
      score.classList.remove('bump');
      void score.offsetWidth;
      score.classList.add('bump');
    }
    lastScore = view.score;
    $('hud-streak').hidden = view.streak < 2;
    $('hud-streak-n').textContent = view.streak;
    $('hud-mult').hidden = view.multiplier <= 1;
    $('hud-mult').textContent = `×${view.multiplier}`;
    const clock = w ? worldClock(w) : null;
    const total = clock ? clock.total : view.round_time_ms;
    const left = clock ? clock.left : view.time_left_ms;
    const frac = total > 0 ? Math.max(0, Math.min(1, left / total)) : 1;
    $('timer').hidden = total <= 0;
    $('timer-fill').style.transform = `scaleX(${frac})`;
    $('timer').classList.toggle('low', total > 0 && left < 3000 && left > 0);
    $('timer').setAttribute('aria-valuenow', String(Math.round(frac * 100)));
    const banner = $('banner');
    banner.hidden = !view.banner;
    if (banner.textContent !== view.banner) banner.textContent = view.banner;
    const clue = $('clue');
    clue.hidden = !view.clue || stage;
    clue.textContent = view.clue || '';
    const cd = $('countdown');
    cd.hidden = view.countdown == null;
    if (view.countdown != null && $('countdown-n').textContent !== String(view.countdown)) {
      const n = $('countdown-n');
      n.textContent = view.countdown;
      n.style.animation = 'none';
      void n.offsetWidth;
      n.style.animation = '';
    }
    $('pause-veil').hidden = view.state !== 'paused';
    lastRound = view.round;
  }
  const flash = $('flash');
  if (view.feedback && view.feedback.flash) {
    flash.style.setProperty('--flash', flashColor(view.feedback.flash));
    flash.classList.add('on');
  } else {
    flash.classList.remove('on');
  }
}

// ---- input -------------------------------------------------------------------------------

function sendChoice(index) {
  if (!session || finished) return;
  session.input(JSON.stringify({ type: 'choice', index }));
}

function sendInput(msg) {
  if (!session || finished) return;
  session.input(JSON.stringify(msg));
}

let multiSelect = false;
function pickChoice(index) {
  if (multiSelect) sendInput({ type: 'select', index });
  else sendChoice(index);
}

function setPaused(on) {
  if (!session || finished || paused === on) return;
  paused = on;
  session.input(JSON.stringify({ type: on ? 'pause' : 'resume' }));
  if (!on) last = performance.now();
}

// ext.js (meta concepts) talks to the host through window events.
window.addEventListener('sg:input', (e) => sendInput(e.detail));
window.addEventListener('sg:social', (e) => {
  const detail = e.detail || {};
  (window.SG.social = window.SG.social || []).push(detail);
  if (iosHandler) post({ type: 'social', game_id: loaded && loaded.gameId, challenge_id: QUERY.challenge, ...detail });
  else if (detail.type === 'rematch') $('btn-again').click();
});

$('btn-pause').addEventListener('click', () => setPaused(true));
$('btn-resume').addEventListener('click', () => setPaused(false));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    wasPlaying = !paused && !!session && !finished && $('screen-game').classList.contains('active');
    if (wasPlaying) setPaused(true);
  }
});

// ---- loop --------------------------------------------------------------------------------

function startPlay() {
  showScreen('game');
  lastRound = -1;
  lastScore = 0;
  paused = false;
  session.start();
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

function stopLoop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(now - last, 250);
  last = now;
  if (!paused) session.step(dt);
  render(JSON.parse(session.view()));
  for (const ev of JSON.parse(session.drain_events())) handleEvent(ev);
}

function handleEvent(ev) {
  switch (ev.name) {
    case 'feedback.haptic':
      post({ type: 'haptic', style: ev.data.style });
      break;
    case 'feedback.confetti':
      if (!reducedMotion) confetti();
      break;
    case 'session.ended':
      finish();
      break;
  }
}

// ---- result ------------------------------------------------------------------------------

async function finish() {
  if (finished) return;
  finished = true;
  stopLoop();
  const view = JSON.parse(session.view());
  render(view);
  const result = JSON.parse(session.result());
  showResult(view, result);
  if (iosHandler) {
    post({
      type: 'result',
      result,
      game_id: loaded.gameId,
      challenge_id: QUERY.challenge,
      daily: !!QUERY.daily,
      date: QUERY.daily || undefined,
    });
    return;
  }
  if (QUERY.local || !loaded.gameId) return;
  await submitPlay(result);
}

function showResult(view, result) {
  const total = view.total_rounds || 1;
  const good = result.stats.correct >= Math.ceil(total / 2);
  const copy = view.copy || {};
  $('result-score').textContent = result.score;
  $('result-emoji').textContent = good ? '🏆' : '🫠';
  $('result-kicker').textContent = (view.ui && view.ui.share_headline) || 'Final score';
  $('result-copy').textContent = (good ? copy.win : copy.lose) || '';
  $('stat-correct').textContent = result.stats.correct;
  $('stat-streak').textContent = result.stats.best_streak;
  $('stat-wrong').textContent = result.stats.wrong;
  $('result-title').textContent = view.title;
  $('result-card').hidden = view.ui ? !view.ui.share_card : false;
  $('beat-line').hidden = true;
  $('btn-share').hidden = true;
  $('btn-get').hidden = !!iosHandler;
  const daily = view.world && view.world.extra && view.world.extra.daily_puzzle;
  $('btn-again').hidden = !!daily;
  if (daily) {
    $('result-copy').textContent = `${$('result-copy').textContent} New puzzle at ${String(daily.reset_hour_utc).padStart(2, '0')}:00 UTC.`.trim();
  }
  const practice = view.world && view.world.extra && view.world.extra.practice;
  if (practice) $('result-kicker').textContent = 'Practice run (not counted)';
  $('btn-get').href = QUERY.api ? `${QUERY.api}/` : '/';
  showScreen('result');
  if (!reducedMotion && good) confetti();
}

async function submitPlay(result) {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const play = await fetchJSON(`${QUERY.api}/api/games/${encodeURIComponent(loaded.gameId)}/plays`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        seed: result.seed,
        inputs: result.inputs,
        score: result.score,
        ticks: result.ticks,
        challenge_id: QUERY.challenge || undefined,
        daily: QUERY.daily ? true : undefined,
        date: QUERY.daily || undefined,
      }),
    });
    const beat = play.beat;
    const line = $('beat-line');
    if (beat && beat.user) {
      const name = beat.user.name || beat.user;
      line.textContent = beat.won ? `You beat ${name}! (${beat.score})` : `${name} still leads with ${beat.score}`;
      line.hidden = false;
    } else if (play.rank) {
      line.textContent = `Rank #${play.rank}`;
      line.hidden = false;
    }
    if (play.daily) {
      const streak = play.daily.streak;
      const tag = play.daily.counted ? `Streak: ${streak} ${streak === 1 ? 'day' : 'days'}` : 'Practice run, not counted';
      line.textContent = line.hidden ? tag : `${line.textContent} · ${tag}`;
      line.hidden = false;
    }
    await offerChallenge(play);
  } catch (e) {
    console.warn('[sg] could not submit play', e);
  }
}

function view_ui() {
  return (session && JSON.parse(session.view()).ui) || {};
}

async function offerChallenge(play) {
  const playId = play.play && play.play.id;
  if (!playId) return;
  try {
    const ch = await fetchJSON(`${QUERY.api}/api/challenges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: loaded.gameId, play_id: playId }),
    });
    const btn = $('btn-share');
    btn.textContent = view_ui().beat_label || 'Challenge a friend';
    btn.hidden = false;
    btn.onclick = async () => {
      if (navigator.share) {
        try {
          await navigator.share({ text: ch.text, url: ch.url });
          return;
        } catch (_) {
          /* fall through to copy */
        }
      }
      try {
        await navigator.clipboard.writeText(`${ch.text} ${ch.url}`);
        btn.textContent = 'Link copied!';
      } catch (_) {
        prompt('Copy this challenge link', ch.url);
      }
    };
  } catch (e) {
    console.warn('[sg] could not create challenge', e);
  }
}

$('btn-play').addEventListener('click', startPlay);
$('btn-again').addEventListener('click', () => {
  if (loaded) present({ ...loaded, seed: QUERY.challenge || QUERY.daily ? loaded.seed : randomSeed() });
});

// ---- confetti (canvas, no deps) ------------------------------------------------------------

const fx = $('fx');
const fctx = fx.getContext('2d');
let bits = [];
let fxRaf = 0;

function sizeFx() {
  const r = devicePixelRatio || 1;
  fx.width = fx.clientWidth * r;
  fx.height = fx.clientHeight * r;
}
addEventListener('resize', sizeFx);

function confetti() {
  sizeFx();
  const r = devicePixelRatio || 1;
  const colors = ['#ff7a59', '#ffc857', '#7af0ff', '#ff7ac8', '#7bd88f', '#ffffff'];
  for (let i = 0; i < 140; i++) {
    bits.push({
      x: fx.width / 2 + (Math.random() - 0.5) * 80 * r,
      y: fx.height * 0.35,
      vx: (Math.random() - 0.5) * 16 * r,
      vy: (-Math.random() * 14 - 4) * r,
      s: (4 + Math.random() * 6) * r,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.4,
      c: colors[i % colors.length],
      life: 120 + Math.random() * 60,
    });
  }
  if (!fxRaf) fxRaf = requestAnimationFrame(drawFx);
}

function drawFx() {
  fctx.clearRect(0, 0, fx.width, fx.height);
  bits = bits.filter((b) => b.life > 0 && b.y < fx.height + 20);
  for (const b of bits) {
    b.vy += 0.45 * (devicePixelRatio || 1);
    b.vx *= 0.99;
    b.x += b.vx;
    b.y += b.vy;
    b.rot += b.vr;
    b.life -= 1;
    fctx.save();
    fctx.translate(b.x, b.y);
    fctx.rotate(b.rot);
    fctx.globalAlpha = Math.min(1, b.life / 30);
    fctx.fillStyle = b.c;
    fctx.fillRect(-b.s / 2, -b.s / 2, b.s, b.s * 0.6);
    fctx.restore();
  }
  fxRaf = bits.length ? requestAnimationFrame(drawFx) : 0;
  if (!bits.length) fctx.clearRect(0, 0, fx.width, fx.height);
}

// ---- boot --------------------------------------------------------------------------------

async function boot() {
  try {
    await init();
    initWorld(sendInput);
    if (window.__sgPending) {
      const p = window.__sgPending;
      window.__sgPending = null;
      window.SG.load(p);
    } else {
      const payload = await loadFromQuery();
      if (payload) present(payload);
      else $('loading-text').textContent = 'Waiting for game…';
    }
    post({ type: 'ready' });
  } catch (e) {
    fail(e && e.message ? e.message : e);
  }
}

boot();
