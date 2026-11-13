// The score model (docs/HARNESS_V2.md "Scores you can rank", authoring/SPEC.md 2.13): what a game's
// board ranks, in which direction, which runs count, and how the number reads. An authoring manifest
// may carry it as a top-level `score` block; without one a game is ranked as points, higher is
// better, best run per player, every run counts (what boards did before).
//
// The engine's game file is strict (unknown keys are errors), so the model never goes into
// game.json: the expander returns it next to the game, and wrap.mjs puts it on the wrapped manifest
// as `score`, where the app, the runtime and the server read it.
//
// Every score is a whole number: time_to_complete and survival_time in milliseconds, accuracy in whole
// percent (0–100), the rest counts or points. bounds use the same units.
//
// Pure: no disk, no network.

export const SCORE_KINDS = {
  points: { direction: 'higher', counts_when: 'any', format: '{n}', source: 'score' },
  time_to_complete: { direction: 'lower', counts_when: 'finished', format: 'm:ss.t', source: 'time' },
  count_in_time: { direction: 'higher', counts_when: 'any', format: '{n}', source: 'score' },
  survival_time: { direction: 'higher', counts_when: 'any', format: 'm:ss.t', source: 'time' },
  accuracy: { direction: 'higher', counts_when: 'finished', format: '{n}%', source: 'score' },
  distance: { direction: 'higher', counts_when: 'any', format: '{n} m', source: 'score' },
  tiered_points: { direction: 'higher', counts_when: 'any', format: '{n}', source: 'score' },
  streak: { direction: 'higher', counts_when: 'any', format: '{n}', source: 'score' },
};

export const DIRECTIONS = ['higher', 'lower'];
export const COUNTS_WHEN = ['finished', 'any'];
export const AGGREGATES = ['best', 'latest', 'sum_week'];
export const SOURCES = ['score', 'time'];
export const TIE_BREAKS = ['less time', 'earlier'];
const TIME_FORMATS = ['m:ss.t', 'm:ss', 's.t'];
const KEYS = ['kind', 'measures', 'unit', 'direction', 'counts_when', 'aggregate', 'tie_break', 'format', 'bounds', 'events', 'source', 'ranked'];

/** The model a game without a `score` block gets. */
export function defaultScore() {
  return { kind: 'points', direction: 'higher', counts_when: 'any', aggregate: 'best', tie_break: 'earlier', format: '{n}', source: 'score' };
}

export function isTimeFormat(format) {
  return TIME_FORMATS.includes(String(format ?? '').trim());
}

/** A format is a time pattern, or text with one `{n}` in it ("{n} orders", "{n}%"). */
export function validFormat(format) {
  if (typeof format !== 'string' || !format.trim() || format.length > 40) return false;
  return isTimeFormat(format) || (format.match(/\{n\}/g) ?? []).length === 1;
}

const near = (word, options) => {
  const w = String(word ?? '').toLowerCase();
  return options.find((o) => o.startsWith(w.slice(0, 4)) || w.includes(o) || o.includes(w));
};

/**
 * Fills in defaults from the kind and checks the shape. Returns {score, diagnostics}; diagnostics
 * use the expander's shape ({code, severity, at, message, hint}) with pointers under /score.
 * `raw` undefined or null gives the default model and no diagnostics.
 */
export function normalizeScore(raw) {
  const diagnostics = [];
  const err = (code, at, message, hint) => diagnostics.push({ code, severity: 'error', at: `/score${at}`, message, ...(hint ? { hint } : {}) });
  const warn = (code, at, message, hint) => diagnostics.push({ code, severity: 'warning', at: `/score${at}`, message, ...(hint ? { hint } : {}) });
  if (raw === undefined || raw === null) return { score: defaultScore(), diagnostics, declared: false };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    err('A_SCORE_SHAPE', '', 'score is an object like {"kind": "points", "measures": "…", "direction": "higher", "format": "{n} points"}');
    return { score: defaultScore(), diagnostics, declared: true };
  }
  for (const k of Object.keys(raw)) if (!KEYS.includes(k)) warn('W_SCORE_KEY', `/${k}`, `score has no field '${k}' (ignored)`, `fields: ${KEYS.join(', ')}`);

  const kind = raw.kind ?? 'points';
  const known = SCORE_KINDS[kind];
  if (!known) err('A_SCORE_KIND', '/kind', `no score kind '${kind}'`, `kinds: ${Object.keys(SCORE_KINDS).join(', ')}${near(kind, Object.keys(SCORE_KINDS)) ? `; did you mean '${near(kind, Object.keys(SCORE_KINDS))}'?` : ''}`);
  const base = known ?? SCORE_KINDS.points;
  const out = { kind: known ? kind : 'points' };
  if (typeof raw.measures === 'string' && raw.measures.trim()) out.measures = raw.measures.trim().slice(0, 160);
  if (typeof raw.unit === 'string' && raw.unit.trim()) out.unit = raw.unit.trim().slice(0, 30);

  const pick = (field, allowed, fallback) => {
    const v = raw[field];
    if (v === undefined || v === null) return fallback;
    if (!allowed.includes(v)) { err(`A_SCORE_${field.toUpperCase()}`, `/${field}`, `score.${field} is one of ${allowed.join(', ')}`); return fallback; }
    return v;
  };
  out.direction = pick('direction', DIRECTIONS, base.direction);
  out.counts_when = pick('counts_when', COUNTS_WHEN, base.counts_when);
  out.aggregate = pick('aggregate', AGGREGATES, 'best');
  out.tie_break = pick('tie_break', TIE_BREAKS, 'earlier');
  out.source = pick('source', SOURCES, base.source);

  if (raw.format === undefined || raw.format === null) out.format = out.unit && !isTimeFormat(base.format) && base.format === '{n}' ? `{n} ${out.unit}` : base.format;
  else if (!validFormat(raw.format)) { err('A_SCORE_FORMAT', '/format', `score.format "${raw.format}" isn't a format`, 'use text with one {n} ("{n} orders", "{n}%") or a time: m:ss.t, m:ss, s.t'); out.format = base.format; }
  else out.format = raw.format;
  // A time score is whole milliseconds; "{n} ms" would show 83400 ms (Kevin32 #24). It always reads as a time.
  if (out.source === 'time' && !isTimeFormat(out.format)) {
    warn('W_SCORE_FORMAT', '/format', `a time score reads as m:ss.t, not "${out.format}"; set to m:ss.t`);
    out.format = 'm:ss.t';
  }

  // The kind fixes the direction and the finish rule where the other choice can't be ranked fairly.
  if (known && kind === 'time_to_complete' && out.direction !== 'lower') err('A_SCORE_DIRECTION', '/direction', 'a time to complete ranks the fastest first: direction must be "lower"');
  if (known && ['time_to_complete', 'accuracy'].includes(kind) && out.counts_when !== 'finished') err('A_SCORE_COUNTS', '/counts_when', `a ${kind} score only counts finished runs: counts_when must be "finished" (or quitting early would win)`);
  if (out.direction === 'lower' && out.counts_when === 'any') err('A_SCORE_COUNTS', '/counts_when', 'lower-is-better scores must only count finished runs, or a run that quits at once ranks first');

  if (raw.events !== undefined) {
    if (!Array.isArray(raw.events) || !raw.events.every((e) => typeof e === 'string' && e)) err('A_SCORE_EVENTS', '/events', 'score.events is a list of event or input names');
    else out.events = [...new Set(raw.events)];
  }
  if (raw.bounds !== undefined) {
    const b = raw.bounds;
    if (!b || typeof b !== 'object' || Array.isArray(b)) err('A_SCORE_BOUNDS', '/bounds', 'score.bounds is {min, max, max_rate_per_s}');
    else {
      const bounds = {};
      for (const k of ['min', 'max', 'max_rate_per_s']) {
        if (b[k] === undefined) continue;
        if (typeof b[k] !== 'number' || !Number.isFinite(b[k])) err('A_SCORE_BOUNDS', `/bounds/${k}`, `score.bounds.${k} is a number`);
        else bounds[k] = k === 'max_rate_per_s' ? b[k] : Math.round(b[k]);
      }
      if (Object.keys(bounds).length) out.bounds = bounds;
    }
  }
  if (raw.ranked !== undefined) {
    if (typeof raw.ranked !== 'boolean') err('A_SCORE_RANKED', '/ranked', 'score.ranked is true or false');
    else out.ranked = raw.ranked;
  }
  return { score: out, diagnostics, declared: true };
}

/** Event names in score.events that the game doesn't have ('tick' always exists). */
export function unknownScoreEvents(score, game) {
  const names = new Set(['tick', 'start', ...Object.keys(game?.events ?? {}), ...Object.keys(game?.inputs ?? {})]);
  return (score?.events ?? []).filter((e) => !names.has(e));
}

/**
 * The value a run ranks by, always a whole number: the engine score, or the run time in whole
 * milliseconds (the engine's `time_ms`) for `source: "time"`.
 */
export function runValue(score, run) {
  if ((score?.source ?? 'score') === 'time') return Math.round(run.time_ms ?? Number(run.seconds ?? 0) * 1000);
  return Math.round(Number(run.score ?? 0));
}

/** Whether a run goes on the board: finished-only models count won runs only. */
export function runCounts(score, run) {
  if (run.ok === false) return false;
  return (score?.counts_when ?? 'any') === 'finished' ? run.outcome === 'success' : true;
}

/** > 0 when run a ranks above run b. Runs that don't count rank below every run that does. */
export function compareRuns(score, a, b) {
  const ca = runCounts(score, a), cb = runCounts(score, b);
  if (ca !== cb) return ca ? 1 : -1;
  if (!ca) return 0;
  const d = runValue(score, a) - runValue(score, b);
  return (score?.direction ?? 'higher') === 'lower' ? -d : d;
}

/** How the app and share text show a value: "{n} orders" → "12 orders"; m:ss.t (ms) → "1:23.4". */
export function formatScore(value, format = '{n}') {
  const v = Number(value ?? 0);
  if (isTimeFormat(format)) {
    const tenths = Math.floor(Math.max(0, v) / 100);
    const s = Math.floor(tenths / 10), t = tenths % 10;
    if (format === 's.t') return `${s}.${t}`;
    const m = Math.floor(s / 60), ss = String(s % 60).padStart(2, '0');
    return format === 'm:ss' ? `${m}:${ss}` : `${m}:${ss}.${t}`;
  }
  const n = String(Math.round(v));
  return String(format).replace('{n}', n);
}

// ---------- the spec parts the score review reads ----------

/** Which parts a part is built on (docs/HARNESS_V2.md "The game spec"): a repair sends these along. */
export const PART_DEPENDS = {
  theme: [],
  goal: ['theme'],
  loop: ['goal'],
  pieces: ['goal', 'loop'],
  constraints: ['goal', 'loop'],
  progression: ['loop', 'constraints'],
  end: ['goal', 'constraints'],
  score: ['goal', 'constraints', 'end'],
  social: ['goal', 'score'],
  feel: ['theme'],
};

/**
 * The goal, constraints, end and score parts of a game. A manifest with a planner `spec`
 * (game-spec/1) uses its parts; otherwise they are read from design, meta and objectives.
 */
export function scoreParts(authoring = {}, score = null) {
  const spec = authoring.spec && typeof authoring.spec === 'object' ? authoring.spec : (authoring.plan?.spec ?? null);
  const parts = spec?.parts && typeof spec.parts === 'object' ? spec.parts : spec;
  const d = authoring.design ?? {};
  const o = authoring.objectives ?? {};
  const uses = (authoring.uses ?? []).map((u) => ({ fragment: u.fragment, params: u.params ?? {} }));
  const pressure = uses.filter((u) => /lives|timer|countdown|moves|speed|ramp|wave|difficulty/.test(String(u.fragment)));
  return {
    goal: parts?.goal ?? { win: d.win ?? null, pitch: d.pitch ?? null, instructions: authoring.meta?.instructions ?? null, score_expr: o.score ?? null },
    constraints: parts?.constraints ?? { time_limit: o.time_limit ?? null, lose: d.lose ?? null, pressure },
    end: parts?.end ?? { win: o.win ?? null, lose: o.lose ?? null, time_limit: o.time_limit ?? null, on_timeout: o.on_timeout ?? null, session_seconds: authoring.meta?.duration_s ?? null },
    score: score ?? authoring.score ?? defaultScore(),
  };
}
