// Checks a built game against the person's requirements (authoring/expander/requirements.mjs), after the
// gate: code checks on the manifest and the expanded game, playtest checks on bot runs replayed with a
// state trace, and a judge (Muse) for tone, style and rules no code can read.
//
// Every result: {id, quote, kind, must, verify, status: "pass" | "fail" | "unknown", by: "code" | "playtest"
// | "judge", code, evidence}. Failure codes are fixed (CODES). A failed must gets one targeted repair
// (requirements.mjs repairRequest); a must that still fails ships with an honest note and a gap entry.
//
// Pure apart from `traceRuns`, which needs the engine (MG_ENGINE_DIR), and `judgeRequirements`, which
// needs Muse (an `ask` the caller passes in).

import { compare, describeTarget } from '../expander/requirements.mjs';

export const CODES = {
  R_COUNT_MISMATCH: 'a count in the game differs from the one asked for',
  R_TIMER_MISMATCH: 'a time limit differs from the one asked for',
  R_LIVES_MISMATCH: 'lives, strikes or mistakes allowed differ from the ones asked for',
  R_TEXT_MISSING: 'words the person named are not in the game',
  R_PALETTE_OFF: 'the colors are not the ones asked for',
  R_CONTROL_MISSING: 'the control the person asked for is not there',
  R_CONTROL_FORBIDDEN: 'the game uses a control the person ruled out',
  R_NOT_RULED_OUT: 'the game has something the person ruled out (a timer, a way to lose)',
  R_TIMEOUT_OUTCOME: 'running out the clock does not end the way the person asked',
  R_NUMBERS_MISSING: 'numbers the person gave (prices, costs, points) are not in the rules',
  R_STATE_NOT_REACHED: 'no bot run reaches the value the rule should produce',
  R_PATH_MISMATCH: 'a manifest path does not hold the asked-for value',
  R_JUDGE_UNMET: 'a reader found the requirement unmet',
  R_UNVERIFIED: 'nothing could check it',
};

const KIND_CODE = { count: 'R_COUNT_MISMATCH', structure: 'R_COUNT_MISMATCH', timer: 'R_TIMER_MISMATCH', lose: 'R_LIVES_MISMATCH' };

// ---------- reading the game ----------

/** {manifest, authoring, game} from a wrapped manifest, or from {authoring, game} objects/strings. */
export function readBuilt(input) {
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v ?? null);
  if (input?.content?.game_json || input?.content?.authoring_json) {
    return { manifest: input, authoring: parse(input.content.authoring_json) ?? {}, game: parse(input.content.game_json) ?? {} };
  }
  return { manifest: input?.manifest ?? null, authoring: parse(input?.authoring) ?? {}, game: parse(input?.game) ?? {} };
}

const usesOf = (A) => (Array.isArray(A.uses) ? A.uses : []).filter((u) => u && typeof u.fragment === 'string');
const fragment = (A, id) => usesOf(A).filter((u) => u.fragment === id);
const param = (A, id, key) => fragment(A, id).map((u) => u.params?.[key]).filter((v) => v !== undefined && v !== null);

/** Milliseconds from a duration ("45s", "1500ms", "1m", 45000, "45000"). */
export function toMs(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  let m = /^(-?\d+(?:\.\d+)?)\s*(ms|s|m|min)?$/i.exec(s);
  if (!m) m = /^(-?\d+(?:\.\d+)?)\s*\*\s*1000(?:\.0)?$/.exec(s) ? [null, String(Number(/^(-?\d+(?:\.\d+)?)/.exec(s)[1]) * 1000), 'ms'] : null;
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'ms').toLowerCase();
  return unit === 's' ? n * 1000 : unit === 'm' || unit === 'min' ? n * 60000 : n;
}

/** A state variable's initial value, when it's a plain number ("3", "45000", "45 * 1000.0", "45.0"). */
function initNumber(init) {
  const s = String(init ?? '').trim();
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  const m = /^(-?\d+(?:\.\d+)?)\s*\*\s*(-?\d+(?:\.\d+)?)$/.exec(s);
  return m ? Number(m[1]) * Number(m[2]) : null;
}

function stateVars(A, G) {
  const out = [];
  for (const src of [G.state ?? {}, A.state ?? {}]) for (const [name, v] of Object.entries(src)) {
    const n = initNumber(v?.init);
    if (n !== null && !out.some((x) => x.name === name)) out.push({ name, value: n });
  }
  return out;
}

/** Every string players can see: title, instructions, content, text nodes, fragment labels. Not the design notes or SVG. */
export function visibleText(A, G) {
  const parts = [];
  const add = (s) => { if (typeof s === 'string' && s.trim() && !/^\s*</.test(s) && !/^=/.test(s.trim())) parts.push(s); };
  const walk = (v, depth = 0) => {
    if (depth > 8 || v == null) return;
    if (typeof v === 'string') add(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!/^(svg|asset|font|color|fill|stroke)$/i.test(k)) walk(x, depth + 1);
  };
  for (const meta of [A.meta, G.meta]) if (meta) { add(meta.title); add(meta.instructions); }
  walk(A.content);
  for (const u of usesOf(A)) for (const [k, v] of Object.entries(u.params ?? {})) if (/label|text|title|name|word|placeholder|message/i.test(k)) add(v);
  // Text nodes, including literal strings inside "= ..." expressions ('DOUBLE!').
  const nodes = [];
  const walkNodes = (v, depth = 0) => {
    if (depth > 30 || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((x) => walkNodes(x, depth + 1)); return; }
    if (v.node === 'text' && typeof v.text === 'string') nodes.push(v.text);
    for (const x of Object.values(v)) walkNodes(x, depth + 1);
  };
  walkNodes(A.presentation);
  walkNodes(G.presentation);
  for (const t of nodes) {
    if (t.trim().startsWith('=')) for (const lit of t.matchAll(/'([^']{1,80})'/g)) add(lit[1]);
    else add(t);
  }
  // Strings in rules and functions (shown through state): literals only.
  for (const src of [JSON.stringify(G.rules ?? []), JSON.stringify(G.functions ?? {})]) for (const lit of src.matchAll(/'([^'\\]{2,80})'/g)) add(lit[1]);
  return parts.join('\n');
}

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'");

/** Whether `word` shows up in the text: exact (case-insensitive), or every part of "X and Y" / "X, Y". */
export function hasWord(text, word) {
  const t = norm(text);
  const w = norm(word).trim();
  if (!w) return true;
  if (t.includes(w)) return true;
  const stem = w.replace(/(?:es|s)$/, '');
  if (stem.length >= 4 && t.includes(stem)) return true;
  const parts = w.split(/\s*(?:,|\band\b|&)\s*/).filter(Boolean);
  return parts.length > 1 && parts.every((p) => t.includes(p));
}

// ---------- colors ----------

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : null;
}

/** The color names a hex counts as (a dark green is "green"; near-black is "black"; gold is yellow and orange). */
export function colorClasses(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return [];
  const [r, g, b] = rgb.map((x) => x / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  // Near-black and near-white keep a tint's hue too ("#E8FFE8" is white and green).
  const tint = (base) => (s >= 0.3 && d > 0.03 ? [base, ...hues(h, l).filter((x) => x !== 'brown')] : [base]);
  if (l < 0.12 || (l < 0.2 && s < 0.35)) return tint('black');
  if (l > 0.93 || (l > 0.85 && s < 0.3)) return tint('white');
  if (s < 0.12) return l < 0.35 ? ['black', 'gray'] : l > 0.75 ? ['white', 'gray'] : ['gray'];
  return hues(h, l);
}

function hues(h, l) {
  const out = [];
  if (h < 15 || h >= 345) out.push('red');
  if (h >= 15 && h < 45) out.push(l < 0.35 ? 'brown' : 'orange');
  if (h >= 40 && h < 50) out.push('gold');
  if (h >= 45 && h < 70) out.push('yellow');
  if (h >= 70 && h < 170) out.push('green');
  if (h >= 160 && h < 195) out.push('teal', h < 180 ? 'green' : 'blue');
  if (h >= 190 && h < 255) out.push('blue');
  if (h >= 255 && h < 295) out.push('purple');
  if (h >= 290 && h < 345) out.push('pink', h < 310 ? 'purple' : 'red');
  if (out.includes('gold')) out.push('yellow', 'orange');
  return [...new Set(out)];
}

/** The game's colors: tokens, art palette and every fill in its SVG art, with how often each is used. */
export function gameColors(A, G, manifest) {
  const counts = new Map();
  const add = (c, n = 1) => {
    if (typeof c !== 'string') return;
    const m = /^#[0-9a-f]{3,8}$/i.exec(c.trim());
    if (m) counts.set(m[0].toUpperCase(), (counts.get(m[0].toUpperCase()) ?? 0) + n);
  };
  for (const src of [G.presentation?.tokens, A.art?.palette, A.look?.tokens, manifest?.style?.colors]) for (const v of Object.values(src ?? {})) add(v, 3);
  const svgs = JSON.stringify([A.art ?? {}, G.assets ?? {}]);
  for (const m of svgs.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) add(m[0]);
  return [...counts.entries()].map(([hex, n]) => ({ hex, n, classes: colorClasses(hex) }));
}

// ---------- controls ----------

export function controlsOf(A, G) {
  const inputs = Object.values(G.inputs ?? {});
  const from = inputs.flatMap((i) => i.from ?? []);
  const nodes = { tap: 0, drag: 0 };
  const walk = (v, depth = 0) => {
    if (depth > 30 || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (v.on_tap) nodes.tap++;
    if (v.on_drag) nodes.drag++;
    for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(G.presentation);
  const frags = new Set(usesOf(A).map((u) => u.fragment));
  return {
    swipe: from.some((f) => f.swipe),
    tap: nodes.tap > 0,
    drag: nodes.drag > 0 || frags.has('player_drag'),
    type: from.some((f) => f.text) || ['keyboard', 'typed_answer', 'word_check'].some((f) => frags.has(f)),
    // Multiple choice: the quiz fragments, a story's choices, or tap buttons that send an answer index.
    choice: ['quiz', 'picture_quiz', 'choice_story'].some((f) => frags.has(f)) || (nodes.tap > 1 && Object.entries(G.inputs ?? {}).some(([k, i]) => /answer|choice|option|pick/i.test(k) && Object.keys(i.payload ?? {}).some((p) => /index|choice|option|i$/i.test(p)))),
    taps: nodes.tap,
  };
}

// ---------- measures ----------

const LIST_NAMES = {
  questions: /question|prompt|problem|clue|flag|word|puzzle|order|item|level|riddle|movie|plant|kick|scene|round|answer|planet|pizza|card|target|stage|song|quote/i,
  rounds: /round|match|game/i,
  waves: /wave/i,
  pairs: /pair|card|animal/i,
  lanes: /lane/i,
  holes: /hole|cell|slot/i,
  rows: /row|brick/i,
  columns: /col/i,
  pads: /pad|color|button/i,
};
const STATE_NAMES = {
  lives: /^(?:lives?|hearts?|hp|health|chances|stars?|strikes_left|lives_left|tries|tries_left|guesses_left|misses_left)$|lives|hearts|chances_left|tries_left/i,
  lanes: /^(?:lanes|lane_count|num_lanes|n_lanes|lanes_total)$/i,
  columns: /^(?:cols?|columns?|board_w|grid_w|width_cells)$/i,
  rows: /^(?:rows?|brick_rows|board_h|grid_h)$/i,
  budget: /budget|money|cash|wallet|dollars|funds|cents|spend/i,
  bpm: /bpm|tempo/i,
  pads: /pads?$/i,
  pairs: /pairs?$/i,
  holes: /holes?$/i,
  waves: /waves?_?(?:total|to_win|count)?$/i,
};

/** Numbers in end conditions: objectives.win/lose and every rule that ends the run, with the var each compares. */
function endConditions(G) {
  const out = [];
  const scan = (expr, outcome) => {
    for (const m of String(expr ?? '').matchAll(/([a-z_][\w.]*)\s*(>=|==|>|<=|<)\s*(\d+(?:\.\d+)?)/gi)) out.push({ outcome, name: m[1], op: m[2], value: Number(m[3]) });
  };
  scan(G.objectives?.win, 'win');
  scan(G.objectives?.lose, 'lose');
  const walk = (rules, inherited) => {
    for (const r of Array.isArray(rules) ? rules : []) {
      if (!r || typeof r !== 'object') continue;
      const ends = JSON.stringify(r.do ?? r.then ?? []).match(/"end"\s*:\s*"(win|lose)"/);
      if (ends) { scan(r.when, ends[1]); scan(r.if, ends[1]); }
      if (r.if && (JSON.stringify(r.then ?? []).match(/"end"\s*:\s*"(win|lose)"/))) scan(r.if, JSON.stringify(r.then).match(/"end"\s*:\s*"(win|lose)"/)[1]);
      for (const k of ['do', 'then', 'else']) if (Array.isArray(r[k])) walk(r[k], inherited);
    }
  };
  walk(G.rules);
  return out;
}

/** Candidate values the game has for a measure, each with where it came from. */
export function measureCandidates(measure, A, G) {
  const c = [];
  const push = (value, where) => { const v = Number(value); if (Number.isFinite(v)) c.push({ value: v, where }); };
  const content = A.content && typeof A.content === 'object' ? A.content : {};
  const lists = (re) => Object.entries(content).filter(([k, v]) => Array.isArray(v) && re.test(k));
  const vars = stateVars(A, G);
  const ends = endConditions(G);
  switch (measure) {
    case 'questions':
    case 'rounds': {
      for (const v of param(A, 'rounds', 'count')) push(v, 'rounds.count');
      for (const v of param(A, 'quiz', 'goal')) if (Number(v) > 0) push(v, 'quiz.goal');
      for (const v of param(A, 'picture_quiz', 'goal')) if (Number(v) > 0) push(v, 'picture_quiz.goal');
      for (const v of param(A, 'waves', 'waves_to_win')) if (Number(v) > 0) push(v, 'waves.waves_to_win');
      for (const v of param(A, 'turns', 'count')) push(v, 'turns.count');
      for (const [k, v] of lists(LIST_NAMES[measure])) push(v.length, `content.${k}.length`);
      for (const e of ends) if (e.outcome === 'win' && /round|qi|answered|solved|done|count|served|order|plant|bloom|kick|shot|cleared|found|turn|q_?index|step|level|made|finished|question/i.test(e.name)) push(e.op === '>' ? e.value + 1 : e.value, `win when ${e.name} ${e.op} ${e.value}`);
      for (const e of ends) if (/round|qi|question|turn|kick|shot|order/i.test(e.name) && e.outcome === 'lose') push(e.op === '>' ? e.value + 1 : e.value, `ends when ${e.name} ${e.op} ${e.value}`);
      if (measure === 'rounds') for (const e of ends) if (e.outcome === 'win' && /win|point|score/i.test(e.name)) push(e.value * 2 - 1, `first to ${e.value} (${e.name})`);
      break;
    }
    case 'choices':
      for (const v of param(A, 'quiz', 'choices')) push(v, 'quiz.choices');
      for (const v of param(A, 'picture_quiz', 'choices')) push(v, 'picture_quiz.choices');
      if (A.geo?.quiz?.choices) push(A.geo.quiz.choices, 'geo.quiz.choices');
      {
        const qs = lists(/question|prompt/i)[0]?.[1];
        const ch = lists(/choice|option/i)[0]?.[1];
        if (qs?.length && ch?.length && ch.length % qs.length === 0 && typeof ch[0] === 'string') push(ch.length / qs.length, 'content choices per question');
        if (Array.isArray(ch?.[0])) push(ch[0].length, 'content choices[0].length');
      }
      break;
    case 'run_seconds': {
      const tl = toMs(G.objectives?.time_limit ?? A.objectives?.time_limit);
      if (tl !== null) push(tl / 1000, 'objectives.time_limit');
      for (const v of param(A, 'countdown', 'ms')) { const ms = toMs(v); if (ms !== null) push(ms / 1000, 'countdown.ms'); }
      if (fragment(A, 'countdown').length && !param(A, 'countdown', 'ms').length && A.meta?.duration_s) push(A.meta.duration_s, 'countdown (meta.duration_s)');
      for (const v of vars) if (/^(?:time_left|time|clock|timer|time_ms|remaining|ms_left|t_left|seconds_left|secs_left|countdown)$/i.test(v.name)) push(v.value >= 1000 ? v.value / 1000 : v.value, `state.${v.name}`);
      break;
    }
    case 'per_question_seconds': {
      for (const [f, k] of [['quiz', 'time_ms'], ['typed_answer', 'time_ms'], ['timer_bar', 'full_ms'], ['picture_quiz', 'time_ms']]) for (const v of param(A, f, k)) { const ms = toMs(v); if (ms !== null) push(ms / 1000, `${f}.${k}`); }
      for (const m of JSON.stringify(G.rules ?? []).matchAll(/"after"\s*:\s*"?(\d+(?:\.\d+)?)\s*(ms|s)?"?/g)) { const ms = toMs(`${m[1]}${m[2] ?? 'ms'}`); if (ms >= 2000 && ms <= 120000) push(ms / 1000, 'rule after'); }
      for (const v of vars) if (/time|clock|timer|countdown/i.test(v.name) && v.value > 0) push(v.value >= 1000 ? v.value / 1000 : v.value, `state.${v.name}`);
      break;
    }
    case 'lives': {
      for (const v of param(A, 'lives', 'count')) push(v, 'lives.count');
      if (fragment(A, 'lives').length && !param(A, 'lives', 'count').length) push(3, 'lives (default 3)');
      for (const v of vars) if (STATE_NAMES.lives.test(v.name) && v.value > 0 && v.value < 20) push(v.value, `state.${v.name}`);
      for (const e of ends) if (e.outcome === 'lose' && /wrong|miss|strike|mistake|error|fail|hit|crash|bad|lost|dropped|escaped/i.test(e.name) && e.value > 0) push(e.op === '>' ? e.value + 1 : e.value, `lose when ${e.name} ${e.op} ${e.value}`);
      for (const e of ends) if (e.outcome === 'lose' && /hit|crash|collide|dead|game_?over/i.test(e.name) && e.value <= 1) push(1, `lose when ${e.name}`);
      break;
    }
    case 'choices_made':
      for (const e of ends) if (/choice|turn|step|depth|day|move/i.test(e.name)) push(e.value, `ends when ${e.name} ${e.op} ${e.value}`);
      break;
    case 'win_at':
      for (const e of ends) if (e.outcome === 'win') push(e.value, `win when ${e.name} ${e.op} ${e.value}`);
      for (const v of param(A, 'score', 'target')) if (Number(v) > 0) push(v, 'score.target');
      for (const v of param(A, 'beat_target', 'target')) push(v, 'beat_target.target');
      break;
    case 'budget':
      for (const v of vars) if (STATE_NAMES.budget.test(v.name)) { push(v.value, `state.${v.name}`); if (v.value % 100 === 0) push(v.value / 100, `state.${v.name} (cents)`); }
      for (const [k, v] of Object.entries(content)) if (/budget|money|cash|wallet/i.test(k) && typeof v === 'number') push(v, `content.${k}`);
      // A cap written into a rule or function: "spent_dollars + price > 100".
      for (const m of JSON.stringify([G.rules ?? [], G.functions ?? {}]).matchAll(/(?:budget|spent|money|cash|wallet|total|cost)[\w.]*(?:\s*[+-]\s*[\w.()]+)?\s*(?:>|>=|<|<=)\s*(\d+(?:\.\d+)?)/gi)) push(m[1], 'a budget cap in the rules');
      break;
    case 'pairs':
      for (const v of param(A, 'match_pairs', 'pairs')) push(v, 'match_pairs.pairs');
      for (const [k, v] of lists(LIST_NAMES.pairs)) { push(v.length, `content.${k}.length`); if (/card/i.test(k) && v.length % 2 === 0) push(v.length / 2, `content.${k}.length / 2`); }
      for (const v of vars) if (STATE_NAMES.pairs.test(v.name)) push(v.value, `state.${v.name}`);
      for (const e of ends) if (e.outcome === 'win' && /pair|match|found/i.test(e.name)) push(e.value, `win when ${e.name} ${e.op} ${e.value}`);
      break;
    case 'holes':
      for (const u of fragment(A, 'grid_board')) push(Number(u.params?.cols ?? 4) * Number(u.params?.rows ?? 4), 'grid_board cols × rows');
      for (const [k, v] of lists(LIST_NAMES.holes)) push(v.length, `content.${k}.length`);
      for (const v of vars) if (STATE_NAMES.holes.test(v.name)) push(v.value, `state.${v.name}`);
      break;
    case 'columns':
      for (const u of fragment(A, 'grid_board')) push(u.params?.cols ?? 4, 'grid_board.cols');
      for (const v of vars) if (STATE_NAMES.columns.test(v.name)) push(v.value, `state.${v.name}`);
      for (const [k, v] of Object.entries(content)) if (/^(?:cols?|columns?|board_w|width)$/i.test(k) && typeof v === 'number') push(v, `content.${k}`);
      break;
    case 'rows':
      for (const u of fragment(A, 'grid_board')) push(u.params?.rows ?? 4, 'grid_board.rows');
      for (const v of vars) if (STATE_NAMES.rows.test(v.name)) push(v.value, `state.${v.name}`);
      for (const [k, v] of lists(LIST_NAMES.rows)) push(v.length, `content.${k}.length`);
      for (const [k, v] of Object.entries(content)) if (/rows?$/i.test(k) && typeof v === 'number') push(v, `content.${k}`);
      break;
    case 'lanes':
      for (const v of param(A, 'lanes', 'count')) push(v, 'lanes.count');
      if (fragment(A, 'lanes').length && !param(A, 'lanes', 'count').length) push(3, 'lanes (default 3)');
      for (const v of vars) if (STATE_NAMES.lanes.test(v.name)) push(v.value, `state.${v.name}`);
      for (const [k, v] of lists(LIST_NAMES.lanes)) push(v.length, `content.${k}.length`);
      for (const [k, v] of Object.entries(content)) if (/lanes?$/i.test(k) && typeof v === 'number') push(v, `content.${k}`);
      break;
    case 'waves':
      for (const v of param(A, 'waves', 'waves_to_win')) push(v, 'waves.waves_to_win');
      for (const [k, v] of lists(LIST_NAMES.waves)) push(v.length, `content.${k}.length`);
      for (const e of ends) if (e.outcome === 'win' && /wave/i.test(e.name)) push(e.op === '>' ? e.value + 1 : e.value, `win when ${e.name} ${e.op} ${e.value}`);
      for (const v of vars) if (STATE_NAMES.waves.test(v.name) && v.value > 1) push(v.value, `state.${v.name}`);
      break;
    case 'pads':
      for (const v of param(A, 'sequence_memory', 'pads')) push(v, 'sequence_memory.pads');
      if (fragment(A, 'sequence_memory').length && !param(A, 'sequence_memory', 'pads').length) push(4, 'sequence_memory (default 4)');
      for (const [k, v] of lists(LIST_NAMES.pads)) push(v.length, `content.${k}.length`);
      for (const v of vars) if (STATE_NAMES.pads.test(v.name)) push(v.value, `state.${v.name}`);
      break;
    case 'bpm':
      for (const v of vars) if (STATE_NAMES.bpm.test(v.name)) push(v.value, `state.${v.name}`);
      for (const [k, v] of Object.entries(content)) if (/bpm|tempo/i.test(k) && typeof v === 'number') push(v, `content.${k}`);
      for (const m of JSON.stringify(A.sound ?? {}).matchAll(/"(?:bpm|tempo)"\s*:\s*(\d+)/g)) push(m[1], 'sound bpm');
      for (const v of vars) if (/beat|interval|period/i.test(v.name) && v.value >= 150 && v.value <= 2000) push(Math.round(60000 / v.value), `60000 / state.${v.name}`);
      break;
    default:
      break;
  }
  // Same value from two places counts once.
  return c.filter((x, i) => c.findIndex((y) => y.value === x.value && y.where === x.where) === i);
}

function resolvePath(obj, path) {
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur == null) return undefined;
    if (part === 'length' && (Array.isArray(cur) || typeof cur === 'string')) return cur.length;
    cur = cur[part];
  }
  return cur;
}

// ---------- code checks ----------

const result = (r, status, by, code, evidence) => ({ id: r.id, quote: r.quote, kind: r.kind, must: r.must !== false, verify: r.verify, target: r.target ?? null, status, by, code: status === 'pass' ? null : code, evidence });

/** One requirement against the manifest and the expanded game. status "unknown" hands it to the playtest or the judge. */
export function codeCheck(r, built) {
  const { authoring: A, game: G, manifest } = built;
  const t = r.target;
  if (!t) return result(r, 'unknown', 'code', 'R_UNVERIFIED', 'no machine target');
  if (t.measure) {
    const cands = measureCandidates(t.measure, A, G);
    const code = t.measure === 'lives' ? 'R_LIVES_MISMATCH' : /seconds/.test(t.measure) ? 'R_TIMER_MISMATCH' : KIND_CODE[r.kind] ?? 'R_COUNT_MISMATCH';
    if (!cands.length) return result(r, 'unknown', 'code', code, `no ${t.measure} found in the game`);
    const hit = cands.find((c) => compare(c.value, t.op, t.value) || (/seconds/.test(t.measure) && Math.abs(c.value - t.value) <= 0.5));
    if (hit) return result(r, 'pass', 'code', null, `${hit.where} = ${hit.value}`);
    return result(r, 'fail', 'code', code, `asked ${t.op} ${t.value}; the game has ${cands.slice(0, 4).map((c) => `${c.where} = ${c.value}`).join(', ')}`);
  }
  if (t.path) {
    const v = resolvePath(A, t.path) ?? resolvePath(G, t.path);
    if (v === undefined) return result(r, 'unknown', 'code', 'R_PATH_MISMATCH', `${t.path} is not in the game`);
    const ok = typeof t.value === 'number' ? compare(Number(v), t.op, t.value) : JSON.stringify(v) === JSON.stringify(t.value);
    return result(r, ok ? 'pass' : 'fail', 'code', 'R_PATH_MISMATCH', `${t.path} = ${JSON.stringify(v).slice(0, 60)}`);
  }
  if (t.text) {
    const text = visibleText(A, G);
    const found = t.text.filter((w) => hasWord(text, w));
    const ok = t.match === 'any' ? found.length > 0 : found.length === t.text.length;
    const missing = t.text.filter((w) => !found.includes(w));
    return result(r, ok ? 'pass' : 'fail', 'code', 'R_TEXT_MISSING', ok ? `found ${found.map((w) => `"${w}"`).join(', ')}` : `missing ${missing.map((w) => `"${w}"`).join(', ')}`);
  }
  if (t.palette) {
    const colors = gameColors(A, G, manifest);
    if (!colors.length) return result(r, 'unknown', 'code', 'R_PALETTE_OFF', 'no colors found');
    if (t.palette.only) {
      const allowed = new Set(t.palette.only);
      const total = colors.reduce((a, c) => a + c.n, 0);
      const off = colors.filter((c) => !c.classes.some((k) => allowed.has(k)));
      const offShare = off.reduce((a, c) => a + c.n, 0) / total;
      const tokens = [G.presentation?.tokens, A.art?.palette].flatMap((s) => Object.entries(s ?? {})).filter(([, v]) => typeof v === 'string' && /^#/.test(v));
      const offTokens = tokens.filter(([, v]) => !colorClasses(v).some((k) => allowed.has(k)));
      const ok = offShare <= 0.15 && offTokens.length <= 1;
      return result(r, ok ? 'pass' : 'fail', 'code', 'R_PALETTE_OFF', `${Math.round((1 - offShare) * 100)}% of color uses are ${[...allowed].join('/')}${offTokens.length ? `; off tokens: ${offTokens.slice(0, 4).map(([k, v]) => `${k} ${v} (${colorClasses(v).join('/') || '?'})`).join(', ')}` : ''}`);
    }
    const missing = t.palette.include.filter((name) => !colors.some((c) => c.classes.includes(name)));
    return result(r, missing.length ? 'fail' : 'pass', 'code', 'R_PALETTE_OFF', missing.length ? `no ${missing.join(', ')} in the palette or art` : `has ${t.palette.include.join(', ')}`);
  }
  if (t.input || t.input_not) {
    const ctl = controlsOf(A, G);
    if (t.input) return result(r, ctl[t.input] ? 'pass' : 'fail', 'code', 'R_CONTROL_MISSING', ctl[t.input] ? `${t.input} input present` : `no ${t.input} input (has: ${Object.entries(ctl).filter(([k, v]) => v === true).map(([k]) => k).join(', ') || 'none'})`);
    const bad = ctl[t.input_not];
    return result(r, bad ? 'fail' : 'pass', 'code', 'R_CONTROL_FORBIDDEN', bad ? `the game uses ${t.input_not}${t.input_not === 'tap' ? ` (${ctl.taps} tap targets)` : ''}` : `no ${t.input_not}`);
  }
  if (t.no === 'timer') {
    const timers = [];
    if (G.objectives?.time_limit) timers.push(`objectives.time_limit ${G.objectives.time_limit}`);
    for (const f of ['countdown', 'timer_bar']) if (fragment(A, f).length) timers.push(f);
    for (const [f, k] of [['quiz', 'time_ms'], ['typed_answer', 'time_ms'], ['picture_quiz', 'time_ms']]) if (fragment(A, f).length) timers.push(`${f}.${k} ${param(A, f, k)[0] ?? 'default'}`);
    return result(r, timers.length ? 'fail' : 'pass', 'code', 'R_NOT_RULED_OUT', timers.length ? `timers: ${timers.join(', ')}` : 'no timer');
  }
  if (t.no === 'lose') {
    const loses = [];
    if (G.objectives?.lose) loses.push(`objectives.lose ${G.objectives.lose}`);
    if (G.objectives?.on_timeout === 'lose') loses.push('time out loses');
    if (/"end"\s*:\s*"lose"/.test(JSON.stringify(G.rules ?? []))) loses.push('a rule ends the run as lost');
    if (fragment(A, 'lives').length) loses.push('lives');
    return result(r, loses.length ? 'fail' : 'pass', 'code', 'R_NOT_RULED_OUT', loses.length ? loses.join('; ') : 'no way to lose in the rules');
  }
  if (t.timeout_is) {
    const on = G.objectives?.on_timeout ?? (param(A, 'countdown', 'on_end')[0]);
    if (!on && !G.objectives?.time_limit && !fragment(A, 'countdown').length) return result(r, 'fail', 'code', 'R_TIMEOUT_OUTCOME', 'the game has no clock to run out');
    const ok = on === t.timeout_is;
    return result(r, ok ? 'pass' : 'fail', 'code', 'R_TIMEOUT_OUTCOME', `time out → ${on ?? 'nothing'}`);
  }
  if (t.numbers) {
    const hay = JSON.stringify([A.content ?? {}, A.uses ?? [], G.state ?? {}, G.rules ?? [], G.functions ?? {}]).replace(/<svg[^"]*/g, '');
    const missing = t.numbers.filter((n) => !new RegExp(`(?<![\\d.])${n}(?:\\.0)?(?![\\d])`).test(hay));
    return result(r, missing.length ? 'fail' : 'pass', 'code', 'R_NUMBERS_MISSING', missing.length ? `missing ${missing.join(', ')}` : `has ${t.numbers.join(', ')}`);
  }
  if (t.state_reaches) return result(r, 'unknown', 'code', 'R_STATE_NOT_REACHED', 'needs a playtest');
  return result(r, 'unknown', 'code', 'R_UNVERIFIED', 'unknown target');
}

// ---------- playtest checks ----------

/**
 * Replays bot runs with a state trace. runs: the gate's runs with `replay` ({seed, dt, actions}), as
 * authoring/playtest/gate.mjs playtest() returns them. engine: loadEngine().engine. Samples the numeric
 * state every `every` steps. Returns [{label, outcome, seconds, inputs, init, last, max, min}].
 */
export function traceRuns(engine, gameJson, runs, { every = 6, apply } = {}) {
  const json = typeof gameJson === 'string' ? gameJson : JSON.stringify(gameJson);
  const out = [];
  for (const run of runs) {
    if (!run?.replay) continue;
    let g;
    try {
      g = engine.load(json, run.replay.seed);
      const numeric = (st) => Object.fromEntries(Object.entries(st ?? {}).filter(([k, v]) => typeof v === 'number' && !k.startsWith('__')));
      const init = numeric(g.state());
      const max = { ...init };
      const min = { ...init };
      let last = init;
      const sample = () => {
        last = numeric(g.state());
        for (const [k, v] of Object.entries(last)) { if (!(k in max) || v > max[k]) max[k] = v; if (!(k in min) || v < min[k]) min[k] = v; }
      };
      let step = 0;
      const dt = run.replay.dt ?? 1000 / 60;
      for (const h of run.replay.actions ?? []) {
        while (step < h.step && g.phase() === 'playing') { g.step(dt); step++; if (step % every === 0) sample(); }
        if (g.phase() !== 'playing') break;
        apply(g, h.action);
      }
      const maxSteps = Math.round((run.seconds ?? 180) * 1000 / dt) + 2;
      while (g.phase() === 'playing' && step < maxSteps) { g.step(dt); step++; if (step % every === 0) sample(); }
      sample();
      const st = g.status();
      out.push({ label: run.bot?.label ?? '', skill: run.bot?.skill ?? null, outcome: st.phase === 'won' ? 'success' : st.phase === 'lost' ? 'fail' : 'timeout', seconds: (st.time_ms ?? step * dt) / 1000, inputs: (run.replay.actions ?? []).length, init, last, max, min });
    } catch (e) {
      out.push({ label: run.bot?.label ?? '', error: String(e?.message ?? e) });
    } finally {
      try { g?.dispose(); } catch { /* ignore */ }
    }
  }
  return out;
}

/** One requirement against the traced runs. Returns null when the trace can't speak to it. */
export function playtestCheck(r, trace, built) {
  const t = r.target;
  const runs = (trace ?? []).filter((x) => !x.error);
  if (!t || !runs.length) return null;
  if (t.measure === 'lives') {
    const lost = runs.filter((x) => x.outcome === 'fail');
    const names = Object.keys(runs[0].init ?? {});
    const down = names.filter((n) => STATE_NAMES.lives.test(n) && runs[0].init[n] > 0 && runs[0].init[n] < 20);
    const up = names.filter((n) => /wrong|miss|strike|mistake|error|fail|hits?_?taken|crash|lost_count/i.test(n) && runs[0].init[n] === 0);
    if (down.length) {
      const n = down[0];
      const init = runs[0].init[n];
      const usedUp = lost.filter((x) => x.last[n] <= 0);
      if (init !== t.value) return result(r, 'fail', 'playtest', 'R_LIVES_MISMATCH', `${n} starts at ${init}`);
      return result(r, 'pass', 'playtest', null, `${n} starts at ${init}${usedUp.length ? `; ${usedUp.length} bot run(s) lost when it reached 0` : ''}`);
    }
    if (up.length && lost.length) {
      const ends = lost.map((x) => Math.max(...up.map((n) => x.last[n] ?? 0)));
      const ok = ends.some((v) => v === t.value);
      return result(r, ok ? 'pass' : 'fail', 'playtest', 'R_LIVES_MISMATCH', `lost runs ended with ${up.join('/')} at ${[...new Set(ends)].join(', ')}`);
    }
    return null;
  }
  if (t.measure === 'run_seconds') {
    const ended = runs.filter((x) => x.outcome !== 'timeout');
    const full = ended.filter((x) => Math.abs(x.seconds - t.value) <= 1.5);
    const longer = runs.filter((x) => x.seconds > t.value + 1.5);
    if (longer.length) return result(r, 'fail', 'playtest', 'R_TIMER_MISMATCH', `a bot run lasted ${Math.max(...longer.map((x) => x.seconds)).toFixed(1)} s`);
    if (full.length) return result(r, 'pass', 'playtest', null, `${full.length} bot run(s) ended at ${full[0].seconds.toFixed(1)} s`);
    return null;
  }
  if (t.measure === 'choices_made') {
    // A story counts its own choices (choices_used, sg_used); taps on the page are not choices.
    const re = /^(?:choices?_used|choices?_made|sg_used|decisions|turns?_used|steps?_taken|moves?_made)$/i;
    const name = Object.keys(runs[0].max ?? {}).find((k) => re.test(k));
    if (!name) return null;
    const most = Math.max(...runs.map((x) => x.max?.[name] ?? 0));
    return result(r, compare(most, t.op, t.value) ? 'pass' : 'fail', 'playtest', 'R_COUNT_MISMATCH', `the longest bot run made ${most} choices (${name})`);
  }
  if (t.no === 'lose') {
    const lost = runs.filter((x) => x.outcome === 'fail');
    return result(r, lost.length ? 'fail' : 'pass', 'playtest', 'R_NOT_RULED_OUT', lost.length ? `${lost.length} bot run(s) lost` : 'no bot run lost');
  }
  if (t.timeout_is) {
    const ends = runs.filter((x) => x.outcome !== 'timeout');
    const longest = ends.sort((a, b) => b.seconds - a.seconds)[0];
    if (!longest) return null;
    return null;
  }
  if (t.state_reaches) {
    const re = new RegExp(t.state_reaches.name, 'i');
    const hits = [];
    for (const x of runs) for (const [k, v] of Object.entries(x.max ?? {})) if (re.test(k)) hits.push({ k, v });
    if (!hits.length) return result(r, 'unknown', 'playtest', 'R_STATE_NOT_REACHED', `no state matches /${t.state_reaches.name}/`);
    const ok = hits.some((h) => compare(h.v, t.state_reaches.op, t.state_reaches.value));
    const best = hits.sort((a, b) => b.v - a.v)[0];
    return result(r, ok ? 'pass' : 'fail', 'playtest', 'R_STATE_NOT_REACHED', `${best.k} reached ${best.v}`);
  }
  return null;
}

// ---------- the judge ----------

export const JUDGE_SYSTEM = `You check a tiny phone game against requirements the person stated, quoted. You get the game (its instructions, writing, rules, numbers, controls and colors) and a list of requirements. For each one decide if the game, as built, meets it: the rule really runs (not just mentioned in the instructions), the content really is what was asked, the tone really reads that way. Be strict: "mentioned in instructions only" or "approximately" is not met. Reply with one JSON object {"results": [{"id": "r1", "met": true | false, "evidence": "<a short quote or fact from the game>"}]}.`;

/** A compact digest of the game for the judge (about 12k characters at most). */
export function gameDigest(built) {
  const { authoring: A, game: G } = built;
  const clip = (v, n) => { const s = typeof v === 'string' ? v : JSON.stringify(v ?? ''); return s.length > n ? `${s.slice(0, n)}…` : s; };
  const strip = (v) => JSON.parse(JSON.stringify(v ?? {}, (k, x) => (k === 'svg' ? undefined : x)));
  const lines = [
    `Title: ${A.meta?.title ?? G.meta?.title ?? ''}`,
    `Instructions: ${A.meta?.instructions ?? G.meta?.instructions ?? ''}`,
    `Fragments: ${clip(usesOf(A).map((u) => ({ fragment: u.fragment, params: u.params })), 1500)}`,
    `Content: ${clip(A.content, 3500)}`,
    `State: ${clip(Object.fromEntries(Object.entries(G.state ?? {}).map(([k, v]) => [k, v?.init])), 1200)}`,
    `Rules: ${clip(strip(A.rules ?? []), 3000)}`,
    `Objectives: ${clip(G.objectives, 300)}`,
    `Controls: ${clip(controlsOf(A, G), 200)}`,
    `Art: ${clip({ style: A.art?.style, palette: A.art?.palette, font: A.art?.font, look: A.look?.id }, 600)}`,
    `Sound: ${clip(strip(A.sound), 300)}`,
  ];
  return lines.join('\n');
}

export function judgePrompt(requirements, built) {
  return [
    'The game:', gameDigest(built), '',
    'The requirements, quoted from the person:',
    ...requirements.map((r) => `- ${r.id} (${r.kind}): "${r.quote}"${r.target ? ` (check: ${describeTarget(r.target)})` : ''}`),
    '', 'Reply with {"results": [...]}, one entry per requirement.',
  ].join('\n');
}

/** Muse reads the game for each requirement. ask as in pipeline.mjs. Returns {id: {met, evidence}}. */
export async function judgeRequirements(requirements, built, ask, { model = 'muse-wonder-1.0', effort = 'medium', image = null } = {}) {
  if (!requirements.length) return {};
  const text = judgePrompt(requirements, built);
  const user = image ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] : text;
  const r = await ask(JUDGE_SYSTEM, user, 'requirements judge', { model, effort, max_tokens: 8000 });
  const s = typeof r === 'string' ? r : r?.content ?? '';
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  const parsed = a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : { results: [] };
  const out = {};
  for (const x of Array.isArray(parsed.results) ? parsed.results : []) if (x && typeof x.id === 'string') out[x.id] = { met: x.met === true, evidence: String(x.evidence ?? '').slice(0, 240) };
  return out;
}

// ---------- the whole check ----------

/**
 * requirements: the list. built: readBuilt(manifest). trace: traceRuns(...) or null. judge: the
 * judgeRequirements result (or null to skip the judge). Code first; then the playtest for anything it
 * speaks to (a playtest result overrides an unknown code result, and a playtest fail overrides a code
 * pass for "playtest" requirements); then the judge for whatever is still unknown or verify "judge".
 */
export function checkRequirements(requirements, built, { trace = null, judge = null } = {}) {
  const results = [];
  for (const r of requirements) {
    let res = codeCheck(r, built);
    const pt = playtestCheck(r, trace, built);
    if (pt && (res.status === 'unknown' || (r.verify === 'playtest' && pt.status !== 'unknown'))) {
      // A code pass and a playtest that can't confirm it: keep the code pass.
      res = pt.status === 'unknown' && res.status !== 'unknown' ? res : pt;
    }
    if ((res.status === 'unknown' || r.verify === 'judge') && judge && judge[r.id]) {
      const j = judge[r.id];
      // The judge never overrides a code fail on a number: a reader can't count better than code.
      if (!(res.status === 'fail' && r.target?.measure)) res = result(r, j.met ? 'pass' : 'fail', 'judge', 'R_JUDGE_UNMET', j.evidence);
    }
    results.push(res);
  }
  return { results, summary: summarize(results) };
}

/** Which requirements the judge should read: verify "judge", plus anything code and playtest left unknown. */
export function needsJudge(requirements, built, trace = null) {
  return requirements.filter((r) => {
    if (r.verify === 'judge' || !r.target) return true;
    const c = codeCheck(r, built);
    if (c.status !== 'unknown') return false;
    const p = playtestCheck(r, trace, built);
    return !p || p.status === 'unknown';
  });
}

export function summarize(results) {
  const must = results.filter((r) => r.must);
  const rate = (list) => (list.length ? Math.round((list.filter((r) => r.status === 'pass').length / list.length) * 1000) / 1000 : null);
  const byKind = {};
  for (const r of results) {
    byKind[r.kind] ??= { total: 0, passed: 0 };
    byKind[r.kind].total++;
    if (r.status === 'pass') byKind[r.kind].passed++;
  }
  return {
    total: results.length, passed: results.filter((r) => r.status === 'pass').length, failed: results.filter((r) => r.status === 'fail').length,
    unknown: results.filter((r) => r.status === 'unknown').length, rate: rate(results),
    must_total: must.length, must_passed: must.filter((r) => r.status === 'pass').length, must_rate: rate(must),
    by_kind: byKind,
  };
}

/** The must-haves that failed: what one targeted repair names (requirements.mjs repairRequest). */
export function repairTargets(report) {
  return report.results.filter((r) => r.must && r.status === 'fail');
}

/** After the repair: a gap entry per must that still fails, in the plan's `gaps` shape. */
export function gapEntries(report) {
  return report.results.filter((r) => r.must && r.status !== 'pass').map((r) => ({
    tool: `requirement:${r.id}`, status: 'gap', quote: r.quote, code: r.code ?? 'R_UNVERIFIED',
    approximation: `shipped without it: ${r.evidence ?? 'not found'}`, familiarity: 'new to Muse',
  }));
}

/** The honest line the person sees when a must still fails after the repair. Empty when all musts hold. */
export function honestNote(report) {
  const missed = report.results.filter((r) => r.must && r.status === 'fail');
  if (!missed.length) return '';
  const parts = missed.slice(0, 3).map((r) => `"${r.quote}"`);
  return `Heads up: this version doesn't do ${parts.join(', ')}${missed.length > 3 ? ` and ${missed.length - 3} more` : ''} yet. Ask for a change to try again.`;
}
