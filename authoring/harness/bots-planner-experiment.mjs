// The playtest bots' shared, host-agnostic parts: the bot roster, the action space, how an action
// is applied, and the analysis that turns runs into flags (a port of the beta app's
// StudioPlaytest). No Node APIs, so both gate.mjs (Node worker threads) and gate-async.mjs (the
// Studio web view, bundled by authoring/tools/make-studio-bundle.mjs) use it.

export const DT = 1000 / 60;
export const LOOKAHEAD_STEPS = 45;
// Timing games (flap through a gap, jump a hurdle) hide the consequence of an action beyond the
// look-ahead: acting now and waiting both survive 0.75 s, but only one survives the wall behind
// it. When the look-ahead can't tell candidates apart, the tied ones are rolled out this far.
export const DEEP_STEPS = +(process?.env?.DEEP ?? 120);
const MAX_TIED = 4;
const POPULATION = +(process?.env?.POP ?? 12);
const GENERATIONS = +(process?.env?.GEN ?? 6);
const ELITE = 3;
const LATE = 1.25;
const FOCUS = 0.5;
const FOCUS_HOLD_STEPS = 60;
const MAX_TAP_TARGETS = 40;

export const DEFAULT_BOTS = [
  { label: 'new player', skill: 0.35, botSeed: 11, seedOffset: 0 },
  { label: 'regular', skill: 0.7, botSeed: 23, seedOffset: 0 },
  { label: 'pro', skill: 0.95, botSeed: 37, seedOffset: 0 },
  { label: 'regular, seed 2', skill: 0.7, botSeed: 41, seedOffset: 7 },
  { label: 'regular, seed 3', skill: 0.7, botSeed: 53, seedOffset: 13 },
];

// Steps between a bot's decisions: stronger players react more often.
export const decisionSteps = (bot, focus = false) => {
  const base = bot.skill >= 0.9 ? 18 : bot.skill >= 0.6 ? 27 : 42;
  return focus ? Math.round(base * FOCUS) : base;
};

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
  for (const input of Object.values(game.inputs ?? {})) {
    // An input with no key or swipe source is driven by the pointer (taps and drags).
    if (!(input.from ?? []).some((f) => f.key || f.swipe)) pointer = true;
    for (const from of input.from ?? []) {
      if (from.key) keys.add(from.key);
      if (from.swipe) swipes = true;
      if (!from.key && !from.swipe) pointer = true;
    }
  }
  // Arrow keys duplicate swipes in the usual four-way games; evaluating both only doubles the cost.
  const allArrows = [...keys].every((k) => k.startsWith('Arrow'));
  return { keys: swipes && allArrows ? [] : [...keys], swipes, pointer };
}

function tapAt(x, y) {
  return { kind: 'tap', x, y };
}

/**
 * Tap candidates: the engine's own hit targets (`targets`, from game.hitTargets()) when the engine
 * provides them, so the bots never tap decoration such as particles or sprites; otherwise the
 * centers of drawn rects and circles (engine v0.1). Plus a row of open-screen taps for games that
 * take a pointer anywhere, and the game's keys and swipes.
 */
export function candidatesFor(frame, sources, rng, targets = null) {
  const out = [{ kind: 'noop' }];
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

/**
 * When the bot decides next, as a step number: its usual interval (jittered), or the shorter focused
 * interval while `attention` (one object per run) says a critical moment was within the last second.
 */
export function nextDecisionStep(bot, rng, steps, focus, attention) {
  if (focus) attention.until = steps + FOCUS_HOLD_STEPS;
  const gap = decisionSteps(bot, steps < attention.until);
  return steps + Math.max(1, gap + Math.round((rng() * 2 - 1) * gap * 0.15));
}

// ---------- choosing an action ----------

/**
 * How good a game state is for a bot: a win beats everything (sooner is better), a loss is worst
 * (later is better), otherwise the game's own `__progress` state (from `playtest.progress`) or its score.
 */
export function outcomeValue(p) {
  const st = p.status();
  if (st.phase === 'won') return 1e9 - st.time_ms;
  if (st.phase === 'lost') return -1e9 + st.time_ms;
  let progress;
  try { progress = asObject(p.state()).__progress; } catch { /* no state */ }
  return typeof progress === 'number' ? progress : st.score;
}

function stepFor(p, n) {
  for (let i = 0; i < n && p.phase() === 'playing'; i++) p.step(DT);
}

// Value of `action` followed by `steps` of play.
function tryAction(g, action, steps) {
  const probe = g.fork();
  try {
    apply(probe, action);
    stepFor(probe, steps);
    return outcomeValue(probe);
  } finally {
    probe.dispose();
  }
}

// The candidates that change the game differently one step on, dropping duplicates (ten taps on the
// same button). Falls back to all of them when the engine can't hash state.
function distinctActions(g, candidates) {
  if (typeof g.stateHash !== 'function') return candidates;
  const seen = new Set();
  const out = [];
  for (const cand of candidates) {
    const probe = g.fork();
    try {
      apply(probe, cand);
      probe.step(DT);
      const hash = probe.stateHash();
      if (seen.has(hash)) continue;
      seen.add(hash);
      out.push(cand);
    } finally {
      probe.dispose();
    }
  }
  return out;
}

/**
 * Looks for a way to keep the game alive: a small evolutionary search over plans, each a choice of
 * one of `options` per decision, `depth` decisions long, one every `cadence` steps (the first
 * option is waiting). A plan's fitness is how many decisions it lives through. Starts from the
 * all-waiting plan and random ones, keeps the fittest and mutates them. Returns {first, fitness,
 * waiting}: the index of the first option of the best plan (waiting if waiting alone gets through, else an action if a best plan starts with one),
 * how far the best plan got, and how far merely waiting got.
 */
function plan(g, options, cadence, depth, seed) {
  const rng = mulberry32(seed);
  const go = (genes, steps) => {
    const q = g.fork();
    try {
      let d = 0;
      for (; d < depth; d++) {
        apply(q, options[genes[d]]);
        stepFor(q, steps);
        if (q.phase() === 'lost') break;
      }
      return d;
    } finally {
      q.dispose();
    }
  };
  // Fitness is how far a plan gets, as planned or a beat late, whichever is worse. Among plans that
  // get equally far, the better one also survives slips (a stray action at one of the next two
  // decisions): that is what keeps the bot away from the edge of a gap.
  const slipped = (genes, at) => genes.map((v, i) => (i === at ? 1 : v));
  const entry = (genes) => ({
    genes,
    fitness: Math.min(go(genes, cadence), go(genes, Math.round(cadence * LATE))),
    slips: go(slipped(genes, 1), cadence) + go(slipped(genes, 2), cadence),
  });
  const better = (x, y) => y.fitness > x.fitness || (y.fitness === x.fitness && y.slips > x.slips);
  const random = (rate) => Array.from({ length: depth }, () => (rng() < rate ? 1 + Math.floor(rng() * (options.length - 1)) : 0));
  const waiting = entry(new Array(depth).fill(0));
  let pop = [waiting];
  while (pop.length < POPULATION) pop.push(entry(random(0.05 + 0.45 * rng())));
  for (let gen = 0; gen < GENERATIONS; gen++) {
    pop.sort((x, y) => (better(x, y) ? 1 : -1));
    const elite = pop.slice(0, ELITE);
    const children = [];
    while (elite.length + children.length < POPULATION) {
      const parent = elite[Math.floor(rng() * elite.length)].genes;
      const genes = parent.map((v) => (rng() < 2 / depth ? (rng() < 0.5 ? 0 : 1 + Math.floor(rng() * (options.length - 1))) : v));
      children.push(entry(genes));
    }
    pop = elite.concat(children);
  }
  let best = pop.reduce((x, y) => (better(x, y) ? y : x));
  // Needing to act sometime means acting now: a plan that puts it off is just as likely to be late.
  // So try the best plan with an action first, as it is and pushed back one decision.
  if (waiting.fitness < depth && best.genes[0] === 0) {
    for (let act = 1; act < options.length; act++) {
      for (const genes of [[act, ...best.genes.slice(1)], [act, ...best.genes.slice(0, -1)]]) {
        const tried = entry(genes);
        if (tried.fitness >= best.fitness) best = tried;
      }
    }
  }
  return { first: best.genes[0], fitness: best.fitness, waiting: waiting.fitness };
}

/**
 * The bot's decision at a decision point: {action, focus}. A bot with skill `s` looks ahead (by
 * forking the live game) with probability `s`, and otherwise picks a candidate at random. Looking
 * ahead tries every candidate for LOOKAHEAD_STEPS and takes the best outcome. When waiting ties with
 * acting (nothing visible within the look-ahead), the tied candidates are searched longer with
 * `plan`, so the bot acts when waiting would end badly later. `focus` is true at a critical
 * moment (an option loses within the look-ahead or the long search): the bot then decides again
 * sooner, the way a player watches closely when a wall is coming.
 */
export function chooseAction(g, candidates, bot, rng, focused = false) {
  // Focus shortens the interval, so lapses are scaled to keep their rate per second the same.
  if (globalThis.DBG) console.log('  chooseAction');
  if (rng() >= 1 - (1 - bot.skill) * (focused ? FOCUS : 1)) return { action: candidates[Math.floor(rng() * candidates.length)], focus: false };
  const values = candidates.map((cand) => tryAction(g, cand, LOOKAHEAD_STEPS));
  if (globalThis.DBG) console.log('  values', values);
  const top = Math.max(...values);
  const first = values.indexOf(top);
  const decided = (action, focus) => ({ action, focus });
  if (top >= 1e8) return decided(candidates[first], false);
  const risky = values.some((v) => v <= -1e8);
  // When every candidate loses within the look-ahead, search among all of them for a way out.
  const tied = top <= -1e8 ? candidates : candidates.filter((_, i) => values[i] === top);
  if (!tied.some((c) => c.kind === 'noop') || tied.length < 2) return decided(candidates[first], risky);
  const options = distinctActions(g, tied).slice(0, MAX_TIED);
  if (options.length < 2) return decided(candidates[first], risky);
  const cadence = decisionSteps(bot, true);
  const depth = Math.ceil(DEEP_STEPS / cadence);
  const found = plan(g, options, cadence, depth, g.status().time_ms | 0);
  if (globalThis.DBG) console.log('  plan', JSON.stringify(found), 'depth', depth, 'opts', options.length);
  return decided(options[found.first], risky || found.waiting < depth || found.fitness < depth);
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
