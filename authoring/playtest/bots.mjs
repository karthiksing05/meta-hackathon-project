// The playtest bots' shared, host-agnostic parts: the bot roster, the action space, how an action
// is applied, and the analysis that turns runs into flags (a port of the beta app's
// StudioPlaytest). No Node APIs, so both gate.mjs (Node worker threads) and gate-async.mjs (the
// Studio web view, bundled by authoring/tools/make-studio-bundle.mjs) use it.

export const DT = 1000 / 60;
export const LOOKAHEAD_STEPS = 45;
const MAX_TAP_TARGETS = 40;

export const DEFAULT_BOTS = [
  { label: 'new player', skill: 0.35, botSeed: 11, seedOffset: 0 },
  { label: 'regular', skill: 0.7, botSeed: 23, seedOffset: 0 },
  { label: 'pro', skill: 0.95, botSeed: 37, seedOffset: 0 },
  { label: 'regular, seed 2', skill: 0.7, botSeed: 41, seedOffset: 7 },
  { label: 'regular, seed 3', skill: 0.7, botSeed: 53, seedOffset: 13 },
];

const isTypical = (bot) => bot.label.startsWith('regular');

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const asObject = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

export function gameObject(json) {
  return typeof json === 'string' ? JSON.parse(json) : json;
}

// ---------- action space ----------

export function inputSources(game) {
  const keys = new Set();
  let swipes = false;
  let pointer = false;
  let text = false;
  for (const input of Object.values(game.inputs ?? {})) {
    // An input with no key, swipe or text source is driven by the pointer (taps and drags).
    if (!(input.from ?? []).some((f) => f.key || f.swipe || f.text)) pointer = true;
    for (const from of input.from ?? []) {
      if (from.key) keys.add(from.key);
      if (from.swipe) swipes = true;
      if (from.text) text = true;
      if (!from.key && !from.swipe && !from.text) pointer = true;
    }
  }
  // Arrow keys duplicate swipes in the usual four-way games; evaluating both only doubles the cost.
  const allArrows = [...keys].every((k) => k.startsWith('Arrow'));
  return { keys: swipes && allArrows ? [] : [...keys], swipes, pointer, text };
}

const MAX_TEXT_CANDIDATES = 12;

/**
 * Strings a bot may submit to a game with a text input (SPEC 2.6): the playtest copy's
 * `__text_candidates` (from the manifest's `playtest.text_candidates`) when it has one, otherwise
 * the strings in the game's own state (a target word, words on screen, answers left). At most 12,
 * picked with the bot's rng when there are more.
 */
export function textCandidates(g, rng) {
  let state;
  try { state = asObject(g.state()); } catch { return []; }
  const out = [];
  const add = (v) => {
    if (typeof v !== 'string') return;
    const w = v.trim();
    if (w && w.length <= 200 && !w.includes('\n') && !out.includes(w)) out.push(w);
  };
  const walk = (v, depth) => {
    if (out.length >= 64 || depth > 4 || v == null) return;
    if (typeof v === 'string') add(v);
    else if (Array.isArray(v)) v.slice(0, 64).forEach((x) => walk(x, depth + 1));
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!k.startsWith('__')) walk(x, depth + 1);
  };
  if (Array.isArray(state?.__text_candidates)) state.__text_candidates.forEach(add);
  else walk(state, 0);
  if (out.length <= MAX_TEXT_CANDIDATES) return out;
  const pool = out.slice();
  const picked = [];
  for (let i = 0; i < MAX_TEXT_CANDIDATES; i++) picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return picked;
}

function tapAt(x, y) {
  return { kind: 'tap', x, y };
}

/**
 * Tap candidates: the engine's own hit targets (`targets`, from game.hitTargets()) when the engine
 * provides them, so the bots never tap decoration such as particles or sprites; otherwise the
 * centers of drawn rects and circles (engine v0.1). Plus a row of open-screen taps for games that
 * take a pointer anywhere, the game's keys and swipes, and `texts` to submit (textCandidates) for
 * games with a text input.
 */
export function candidatesFor(frame, sources, rng, targets = null, texts = null) {
  const out = [{ kind: 'noop' }];
  for (const value of texts ?? []) out.push({ kind: 'text', value });
  if (!sources.pointer) {
    for (const key of sources.keys) out.push({ kind: 'key', key });
    if (sources.swipes) for (const dir of ['left', 'right', 'up', 'down']) out.push({ kind: 'swipe', dir });
    return out;
  }
  const seen = [];
  let taps = [];
  const shapes = (frame.ops ?? []).filter((op) => op.op === 'rect' || op.op === 'circle')
    .map((op) => (op.op === 'rect' ? [op.x + op.w / 2, op.y + op.h / 2] : [op.x, op.y]));
  let points = shapes;
  if (Array.isArray(targets) && targets.length) {
    // Small targets (buttons, tiles, cards): their centers. Big ones (a full-screen tap layer that
    // reads the pointer position): the drawn shapes inside them, which is where the play is.
    const big = (t) => t.w * t.h > 0.2 * frame.width * frame.height;
    const inside = (t, [x, y]) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h;
    points = targets.filter((t) => !big(t)).map((t) => [t.x + t.w / 2, t.y + t.h / 2]);
    const bigs = targets.filter(big);
    if (bigs.length) points.push(...shapes.filter((p) => bigs.some((t) => inside(t, p))));
  }
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (seen.some(([sx, sy]) => Math.abs(sx - x) < 4 && Math.abs(sy - y) < 4)) continue;
    seen.push([x, y]);
    taps.push(tapAt(x, y));
  }
  if (taps.length > MAX_TAP_TARGETS) {
    const pool = taps.slice();
    taps = [];
    for (let i = 0; i < MAX_TAP_TARGETS; i++) taps.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  out.push(...taps);
  for (let i = 0; i < 7; i++) out.push(tapAt(((i + 0.5) / 7) * frame.width, 0.875 * frame.height));
  for (const key of sources.keys) out.push({ kind: 'key', key });
  if (sources.swipes) for (const dir of ['left', 'right', 'up', 'down']) out.push({ kind: 'swipe', dir });
  return out;
}

export function apply(g, action) {
  switch (action.kind) {
    case 'tap':
      // Engine v0.1 hit-tests against the layout from the last frame() call, not the current
      // state. A real screen draws every frame, so refresh it before tapping (main game and probe
      // alike), or lookahead taps hit stale positions.
      g.frame();
      g.pointer('down', action.x, action.y);
      g.pointer('up', action.x, action.y);
      break;
    case 'key': g.key(action.key); break;
    case 'swipe': g.swipe(action.dir); break;
    // Typed and submitted at once (Enter), then the field clears, like the app's text field.
    case 'text': g.text('submit', action.value); g.text('change', ''); break;
    default: break;
  }
}

/**
 * Whether an input would do nothing right now. Inputs are queued until the next step, so this forks
 * the game twice, sends the input to one fork, steps both once and compares their state hashes: the
 * same hash means no rule took the input, or a rule's `when` blocked it. Returns null when it can't
 * tell (an engine without `fork()` or `stateHash()`).
 */
export function isDeadInput(g, action) {
  if (typeof g.fork !== 'function' || typeof g.stateHash !== 'function') return null;
  let ref = null;
  let withInput = null;
  try {
    ref = g.fork();
    withInput = g.fork();
    apply(withInput, action);
    ref.step(DT);
    withInput.step(DT);
    return ref.stateHash() === withInput.stateHash();
  } catch {
    return null;
  } finally {
    try { ref?.dispose(); } catch { /* ignore */ }
    try { withInput?.dispose(); } catch { /* ignore */ }
  }
}

const MASH_STEPS_BETWEEN = 10;
const MASH_MAX_SECONDS = 30;
const MASH_MIN_INPUTS = 20;
const DEAD_WARN = 0.5;
const DEAD_BLOCK = 0.75;

/**
 * Mashes the game's anywhere-inputs the way a person does, to see which ones do nothing. Every
 * ~170 ms it sends a random key or swipe and checks with `isDeadInput` whether that input had any effect. The bots
 * can't measure this themselves: a look-ahead bot never sends an input that does nothing, so a
 * jump that ignores presses in the air looks fine to them. Taps aren't probed: whether a tap does
 * anything depends on where it lands, so a dead tap says little. Returns {sent, dead, byKind: {kind:
 * {sent, dead}}}; `sent` is 0 when the game has no keys or swipes or the engine can't fork.
 */
export function probeDeadInputs(engine, json, sources, { seed = 1 } = {}) {
  const stats = { sent: 0, dead: 0, byKind: {} };
  const rng = mulberry32(0x5eed1e55);
  const maxSteps = Math.round((MASH_MAX_SECONDS * 1000) / DT);
  const g = engine.load(json, seed);
  try {
    if (typeof g.fork !== 'function' || typeof g.stateHash !== 'function') return stats;
    let steps = 0;
    while (steps < maxSteps && g.phase() === 'playing') {
      if (steps % MASH_STEPS_BETWEEN === 0) {
        const open = candidatesFor({}, { ...sources, pointer: false }, rng).filter((c) => c.kind !== 'noop');
        if (open.length) {
          const action = open[Math.floor(rng() * open.length)];
          const dead = isDeadInput(g, action);
          if (dead !== null) {
            const kind = (stats.byKind[action.kind] ??= { sent: 0, dead: 0 });
            stats.sent++;
            kind.sent++;
            if (dead) { stats.dead++; kind.dead++; }
          }
          apply(g, action);
        }
      }
      g.step(DT);
      steps++;
    }
  } finally {
    try { g.dispose(); } catch { /* ignore */ }
  }
  return stats;
}

// ---------- analysis ----------

export function median(values) {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function analyze(runs, { maxSeconds = 180, inputProbe = null, game = null } = {}) {
  const flags = [];
  const flag = (code, message, blocking) => flags.push({ code, message, blocking });
  const done = runs.filter((r) => r.ok);

  const broken = runs.find((r) => !r.ok);
  if (broken) flag('runtime_error', `The game crashed in a bot run: ${broken.error ?? 'unknown error'}. Check glue functions and params.`, true);
  if (!done.length) return flags;

  const med = median(done.map((r) => r.seconds));
  const scores = done.map((r) => r.score);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const timeouts = done.filter((r) => r.outcome === 'timeout');
  const fails = done.filter((r) => r.outcome === 'fail');
  const wins = done.filter((r) => r.outcome === 'success');
  const weak = done.find((r) => r.bot.label === 'new player');
  const regulars = done.filter((r) => isTypical(r.bot)).sort((a, b) => a.seconds - b.seconds);
  const regular = regulars.length ? regulars[regulars.length >> 1] : null;
  const pro = done.find((r) => r.bot.label === 'pro');
  const secs = (s) => Math.round(s);

  if (timeouts.length === done.length) {
    flag('never_ends', `Never ends: no bot run ended within ${maxSeconds} s. Make the challenge ramp up (or add a clear finish) so a run can be failed.`, true);
  } else if (med < 10 && med >= 6 && !fails.length && !timeouts.length) {
    flag('short', `Short: bots clear it in about ${secs(med)} s; people take longer.`, false);
  } else if (med < 10) {
    const isFail = fails.length * 2 >= done.length;
    flag('too_short', isFail
      ? `Too short and too hard: runs end after about ${secs(med)} s. A good game lasts 10–120 s; ease the start (slower speed, wider gaps, gentler gravity, more tries).`
      : `Too short: runs are over in about ${secs(med)} s. A good game lasts 10–120 s; add rounds, items or tries.`, true);
  }

  if (maxScore <= 0) flag('no_score', 'Nobody scored: every bot finished with 0 points. Check the score concept and that the content gives points.', true);

  if (pro && pro.outcome === 'fail' && pro.seconds < 8 && med >= 10) {
    flag('too_hard', `Too hard: even the strongest bot lost after ${secs(pro.seconds)} s.`, true);
  } else if (regular && regular.outcome === 'fail' && regular.seconds < 10 && med >= 10) {
    flag('too_hard', `Too hard: a typical player loses after ${secs(regular.seconds)} s. Ease the first seconds.`, true);
  }

  if (weak && weak.outcome !== 'fail' && timeouts.length !== done.length && !fails.length && done.length > 2 && minScore === maxScore) {
    flag('no_challenge', "Even the weakest bot got the top score without failing; skill doesn't show yet.", false);
  } else if (done.length > 2 && minScore === maxScore && maxScore > 0) {
    flag('flat', `Skill doesn't change the score (every bot scored ${maxScore}). Consider a twist that rewards good play.`, false);
  }

  const typicalTimedOut = regular?.outcome === 'timeout' && regulars.filter((r) => r.outcome === 'timeout').length * 2 > regulars.length;
  if (timeouts.length !== done.length && (typicalTimedOut || timeouts.length * 2 >= done.length)) {
    flag('too_easy', `Too easy: a typical player is still going after ${maxSeconds} s (${timeouts.length} of ${done.length} bots never failed). Make it ramp up (faster pace, tighter gaps, a timer) so runs end in 10–120 s.`, true);
  } else if (timeouts.length && timeouts.length !== done.length) {
    flag('long', `Long for strong players: the ${timeouts.map((r) => r.bot.label).join(', ')} bot was still going after ${maxSeconds} s.`, false);
  } else if (med > 120) {
    flag('long', `Long: runs take about ${secs(med)} s.`, false);
  }

  // Handoff rules: ends, can be lost, can be won or scored, lasts 10–120 s.
  if (!fails.length) flag('cant_lose', 'Can\'t be lost: no bot run ended in a loss.', true);
  if (!wins.length && maxScore <= 0) flag('no_win_or_score', 'No bot won or scored: it can\'t be won or scored.', true);
  if (med > 120) flag('too_long', `Too long: the median run is ${secs(med)} s; a good game lasts 10–120 s.`, true);

  deadInputFlag(inputProbe, game, flag);

  return flags;
}

const KIND_NAMES = { key: ['key press', 'key presses'], swipe: ['swipe', 'swipes'] };

// The rules that take a key or swipe input but only run `when` something holds: the likely blockers.
function guardedRules(game, kind) {
  const inputs = Object.entries(game?.inputs ?? {})
    .filter(([, input]) => (input.from ?? []).some((f) => (kind === 'key' ? f.key : f.swipe)))
    .map(([name]) => name);
  return (game?.rules ?? []).filter((r) => inputs.includes(r.on) && r.when && r.when !== 'true');
}

/**
 * Flags `dead_inputs` when most of the keys or swipes the mash probe sent changed nothing. Warning
 * from half, blocking from three quarters: a game where three of four presses vanish is broken, while
 * lane and board games legitimately ignore a few (a swipe into a wall).
 */
function deadInputFlag(probe, game, flag) {
  const worst = Object.entries(probe?.byKind ?? {})
    .filter(([kind, k]) => KIND_NAMES[kind] && k.sent >= MASH_MIN_INPUTS)
    .map(([kind, k]) => ({ kind, ...k, share: k.dead / k.sent }))
    .sort((a, b) => b.share - a.share)[0];
  if (!worst || worst.share < DEAD_WARN) return;
  const [one, many] = KIND_NAMES[worst.kind];
  const guards = guardedRules(game, worst.kind).slice(0, 2)
    .map((r) => `rule \`${r.id ?? r.on}\` only runs when \`${r.when}\``);
  const cause = guards.length ? `${guards.join('; ')}, so a ${one} is ignored whenever that is false` : `no rule reacts to them at that moment`;
  flag('dead_inputs', `Most ${many} (${worst.dead} of ${worst.sent}) did nothing when a player mashed them: ${cause}. `
    + `Make the ${one} work whenever the player presses it (for a jump: let it work in the air too), or give it another effect.`, worst.share >= DEAD_BLOCK);
}

export function summarize(runs, maxSeconds = 180) {
  const done = runs.filter((r) => r.ok);
  if (!done.length) return 'No bot run finished';
  const scores = done.map((r) => r.score);
  const secs = done.map((r) => Math.round(r.seconds));
  const range = (a) => (Math.min(...a) === Math.max(...a) ? `${a[0]}` : `${Math.min(...a)}–${Math.max(...a)}`);
  const parts = [`${done.length} bots scored ${range(scores)} over ${range(secs)} s`];
  const count = (o) => done.filter((r) => r.outcome === o).length;
  const out = [];
  if (count('fail')) out.push(`${count('fail')} lost`);
  if (count('success')) out.push(`${count('success')} won`);
  if (count('timeout')) out.push(`${count('timeout')} still going at ${maxSeconds} s`);
  if (out.length) parts.push(out.join(', '));
  return parts.join(' · ');
}
