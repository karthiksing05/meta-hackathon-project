// story-graph/1: branching stories and light RPGs as data (docs/harness-gaps/story.md).
//
// Muse writes a small story graph (nodes, choices, conditions on variables, effects, ranked endings).
// This module checks it deterministically (`validateStoryGraph`) and compiles it into an authoring
// manifest (`compileStoryGraph`) that plays on today's engine with the `choice_story` and
// `story_vars` fragments. The JS walk here and the fragment's engine rules implement the same
// semantics, and authoring/playtest/story-bots.mjs checks that they agree move by move.
//
// Semantics (one choice):
//   1. Only choices whose `if` holds are shown (packed into the first buttons, at most 3).
//   2. The choice's `do` effects apply (deltas clamp to each variable's [min, max]).
//   3. Its `routes` are checked in order on the new values; the first that holds picks the target,
//      else `to`.
//   4. With `max_choices` and `on_limit`: if this was the max_choices-th choice and the target isn't
//      an ending, the target becomes `on_limit`.
//   5. The target's `enter` effects apply. Reaching an ending ends the run.
//
// Pure: no disk, network or Node APIs, so it can go in the Studio bundle.

export const STORY_FORMAT = 'story-graph/1';

export const STORY_LIMITS = Object.freeze({
  minNodes: 4,
  maxNodes: 60, // choice_story addresses scenes 0–59
  maxChoices: 3, // choice_story draws 3 buttons
  minEndings: 2,
  maxEndings: 8,
  maxVars: 8,
  maxRange: 20, // max - min of a stat, to keep the state walk small
  lineChars: 30, // choice_story draws 4 lines of about 30 characters
  lines: 4,
  minText: 12,
  label: 28,
  note: 34,
  place: 28,
  endingTitle: 30,
  share: 60,
  varLabel: 10,
  depthCap: 30, // without max_choices, no path may take more choices than this
  maxStates: 250000,
  contentBytes: 40000,
});

const ID = /^[a-z][a-z0-9_]{0,31}$/;
const TONES = ['good', 'secret', 'neutral', 'bad'];
const KINDS = ['stat', 'item', 'flag'];
const WIN_TONES = new Set(['good', 'secret']);

// ---------- text ----------

/** Greedy word wrap into lines of at most `width` characters (a longer word gets its own line). */
export function wrapText(text, width = STORY_LIMITS.lineChars) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

const chars = (s) => [...String(s ?? '')].length;
// Straight apostrophes become ’ so content never breaks an engine string literal (SPEC 1.6).
const clean = (s) => String(s ?? '').replace(/'/g, '’').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();

// FNV-1a, for the deterministic button order.
function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

// ---------- conditions and effects ----------

/**
 * Parses a condition: atoms joined by `&` (or `and`, `&&`), alternatives by `|` (or `or`, `||`).
 * Atoms: `name` (> 0), `!name` (0 or less), `name OP n` with OP in >= <= > < ==.
 * Returns {alts: [[{v, op: '>=' | '<=', n}]]} with variable names, or {error}.
 */
export function parseCondition(src) {
  if (src == null || (typeof src === 'string' && src.trim() === '')) return { alts: [] };
  if (typeof src !== 'string') return { error: 'a condition must be a string such as "gold>=2 & !caught"' };
  const text = src.replace(/\s+or\s+/gi, '|').replace(/\s+and\s+/gi, '&').replace(/\|\|/g, '|').replace(/&&/g, '&')
    .replace(/\bnot\s+/gi, '!').replace(/\s+/g, '');
  const alts = [];
  for (const alt of text.split('|')) {
    const atoms = [];
    for (const raw of alt.split('&')) {
      if (!raw) return { error: `empty part in condition "${src}"` };
      let m;
      if ((m = /^!([a-z][a-z0-9_]*)$/.exec(raw))) atoms.push({ v: m[1], op: '<=', n: 0 });
      else if ((m = /^([a-z][a-z0-9_]*)$/.exec(raw))) atoms.push({ v: m[1], op: '>=', n: 1 });
      else if ((m = /^([a-z][a-z0-9_]*)(>=|<=|==|=|>|<)(-?\d+)$/.exec(raw))) {
        const [, v, op, ns] = m;
        const n = Number(ns);
        if (op === '>=') atoms.push({ v, op: '>=', n });
        else if (op === '<=') atoms.push({ v, op: '<=', n });
        else if (op === '>') atoms.push({ v, op: '>=', n: n + 1 });
        else if (op === '<') atoms.push({ v, op: '<=', n: n - 1 });
        else atoms.push({ v, op: '>=', n }, { v, op: '<=', n });
      } else if (/!=/.test(raw)) return { error: `"${raw}": != isn't supported; use < and > alternatives joined by |` };
      else return { error: `can't read "${raw}" in condition "${src}" (use name, !name or name>=2)` };
    }
    alts.push(atoms);
  }
  return { alts };
}

/**
 * Parses effects: a string of space-separated tokens or an array of them. Tokens: `name` or `+name`
 * (+1), `-name` (-1), `name+3`, `name-2`, `name=5`. Items and flags clamp to 0–1, so `+key` gives the
 * key and `-key` takes it. Returns {fx: [{v, set?: n, add?: n}]} or {error}.
 */
export function parseEffects(src) {
  if (src == null || src === '') return { fx: [] };
  const toks = Array.isArray(src) ? src.map(String) : typeof src === 'string' ? src.split(/[\s,]+/) : null;
  if (!toks) return { error: 'effects must be a string such as "+gold -trust key" or a list of them' };
  const fx = [];
  for (const raw of toks.map((t) => t.replace(/\s+/g, '')).filter(Boolean)) {
    let m;
    if ((m = /^\+?([a-z][a-z0-9_]*)$/.exec(raw))) fx.push({ v: m[1], add: 1 });
    else if ((m = /^-([a-z][a-z0-9_]*)$/.exec(raw))) fx.push({ v: m[1], add: -1 });
    else if ((m = /^([a-z][a-z0-9_]*)(\+=|-=|\+|-)(\d+)$/.exec(raw))) fx.push({ v: m[1], add: m[2].startsWith('-') ? -Number(m[3]) : Number(m[3]) });
    else if ((m = /^([a-z][a-z0-9_]*)=(-?\d+)$/.exec(raw))) fx.push({ v: m[1], set: Number(m[2]) });
    else return { error: `can't read effect "${raw}" (use +gold, -gold, gold+2, gold=0 or key)` };
  }
  return { fx };
}

// ---------- normalize ----------

/**
 * Checks the shape of a story graph and resolves names to indices. Returns
 * {graph, errors, warnings}; `graph` is null when the shape is too broken to walk.
 * The normalized graph orders nodes with `start` first (choice_story starts at scene 0).
 */
export function normalizeStoryGraph(raw) {
  const errors = [];
  const warnings = [];
  const err = (code, at, message) => errors.push({ code, at, message });
  const warn = (code, at, message) => warnings.push({ code, at, message });
  const L = STORY_LIMITS;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    err('S_SHAPE', '', 'the story graph must be a JSON object');
    return { graph: null, errors, warnings };
  }
  if (raw.format && raw.format !== STORY_FORMAT) warn('S_FORMAT', '/format', `expected "${STORY_FORMAT}"`);
  const title = clean(raw.title || 'A short adventure');
  if (chars(title) > 40) err('S_TITLE', '/title', `title is ${chars(title)} characters; keep it to 40`);

  // Variables.
  const vars = [];
  const varIndex = new Map();
  (Array.isArray(raw.vars) ? raw.vars : []).forEach((v, i) => {
    const at = `/vars/${i}`;
    if (!v || !ID.test(v.id ?? '')) { err('S_VAR_ID', at, 'each variable needs an id like "gold" (lowercase, letters, digits, _)'); return; }
    if (varIndex.has(v.id)) { err('S_VAR_DUP', at, `variable "${v.id}" is declared twice`); return; }
    const kind = v.kind ?? 'stat';
    if (!KINDS.includes(kind)) err('S_VAR_KIND', at, `kind must be one of ${KINDS.join(', ')}`);
    const bool = kind !== 'stat';
    const min = bool ? 0 : Number.isInteger(v.min) ? v.min : 0;
    const max = bool ? 1 : Number.isInteger(v.max) ? v.max : 9;
    if (max <= min) err('S_VAR_RANGE', at, `"${v.id}": max must be above min`);
    if (max - min > L.maxRange) err('S_VAR_RANGE', at, `"${v.id}" spans ${max - min} steps; keep a stat within ${L.maxRange} (it's a story, not a spreadsheet)`);
    const init = Number.isInteger(v.init) ? v.init : (v.init === true ? 1 : 0);
    if (init < min || init > max) err('S_VAR_INIT', at, `"${v.id}" starts at ${init}, outside ${min}–${max}`);
    const label = clean(v.label || v.id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
    if (kind !== 'flag' && chars(label) > L.varLabel) err('S_VAR_LABEL', at, `label "${label}" is ${chars(label)} characters; keep HUD labels to ${L.varLabel}`);
    const weight = Number.isInteger(v.score) ? v.score : 0;
    if (weight < 0 || weight > 100) err('S_VAR_SCORE', at, `"${v.id}".score is points per unit, 0–100`);
    varIndex.set(v.id, vars.length);
    vars.push({ id: v.id, label, kind, min, max, init, weight });
  });
  if (vars.length > L.maxVars) err('S_VARS', '/vars', `${vars.length} variables; keep it to ${L.maxVars} (a few stats, a few items)`);
  if (vars.filter((v) => v.kind === 'stat').length > 3) warn('S_HUD', '/vars', 'more than 3 stats crowd the HUD line; hide some as flags');

  const resolveCond = (src, at) => {
    const r = parseCondition(src);
    if (r.error) { err('S_COND', at, r.error); return ''; }
    const parts = [];
    for (const alt of r.alts) {
      const atoms = [];
      for (const a of alt) {
        if (!varIndex.has(a.v)) { err('S_UNKNOWN_VAR', at, `condition names "${a.v}", which isn't in vars`); return ''; }
        atoms.push(`${varIndex.get(a.v)}${a.op}${a.n}`);
      }
      parts.push(atoms.join('&'));
    }
    return parts.join('|');
  };
  const resolveFx = (src, at) => {
    const r = parseEffects(src);
    if (r.error) { err('S_EFFECT', at, r.error); return ''; }
    const toks = [];
    for (const f of r.fx) {
      if (!varIndex.has(f.v)) { err('S_UNKNOWN_VAR', at, `effect names "${f.v}", which isn't in vars`); return ''; }
      const i = varIndex.get(f.v);
      toks.push(f.set != null ? `${i}:=${f.set}` : `${i}:${f.add}`);
    }
    return toks.join(' ');
  };

  // Nodes.
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  if (rawNodes.length < L.minNodes || rawNodes.length > L.maxNodes) err('S_NODES', '/nodes', `${rawNodes.length} nodes; a story needs ${L.minNodes}–${L.maxNodes}`);
  const seen = new Set();
  const good = [];
  rawNodes.forEach((n, i) => {
    if (!n || !ID.test(n.id ?? '')) { err('S_NODE_ID', `/nodes/${i}`, 'each node needs an id like "market" (lowercase, letters, digits, _)'); return; }
    if (seen.has(n.id)) { err('S_NODE_DUP', `/nodes/${i}`, `node "${n.id}" appears twice`); return; }
    seen.add(n.id);
    good.push({ n, i });
  });
  const start = raw.start ?? good[0]?.n.id;
  if (!seen.has(start)) { err('S_START', '/start', `start "${start}" isn't a node`); return { graph: null, errors, warnings }; }
  good.sort((a, b) => (a.n.id === start ? -1 : b.n.id === start ? 1 : a.i - b.i));
  const index = new Map(good.map((g, k) => [g.n.id, k]));

  const nodes = good.map(({ n, i }, k) => {
    const at = `/nodes/${i}`;
    const text = clean(n.text);
    const lines = wrapText(text);
    if (chars(text) < L.minText) err('S_TEXT_SHORT', `${at}/text`, `"${n.id}" has no real text`);
    if (lines.length > L.lines) err('S_TEXT_LONG', `${at}/text`, `"${n.id}" text wraps to ${lines.length} lines of ${L.lineChars} characters; one screen holds ${L.lines} (about ${L.lines * L.lineChars - 10} characters). Cut ${chars(text) - (L.lines * L.lineChars - 10)} or more characters, or split the scene.`);
    const place = clean(n.place || '');
    if (chars(place) > L.place) err('S_PLACE', `${at}/place`, `place is ${chars(place)} characters; keep it to ${L.place}`);
    const node = { id: n.id, k, text, lines, place, enter: resolveFx(n.enter, `${at}/enter`), choices: [], ending: null };
    if (n.ending) {
      const e = n.ending;
      const tone = e.tone ?? 'good';
      if (!TONES.includes(tone)) err('S_ENDING_TONE', `${at}/ending/tone`, `tone must be one of ${TONES.join(', ')}`);
      const etitle = clean(e.title || n.id);
      if (chars(etitle) > L.endingTitle) err('S_ENDING_TITLE', `${at}/ending/title`, `ending title is ${chars(etitle)} characters; keep it to ${L.endingTitle}`);
      const share = clean(e.share || raw.share || '');
      node.ending = { tone, win: WIN_TONES.has(tone), title: etitle, rank: Number.isInteger(e.rank) ? e.rank : null, points: Number.isInteger(e.points) ? e.points : null, share };
      if (Array.isArray(n.choices) && n.choices.length) err('S_ENDING_CHOICES', `${at}/choices`, `"${n.id}" is an ending, so it can't have choices`);
    } else {
      const cs = Array.isArray(n.choices) ? n.choices : [];
      if (!cs.length) err('S_DEAD_END', `${at}/choices`, `"${n.id}" has no choices and isn't an ending`);
      if (cs.length > L.maxChoices) err('S_TOO_MANY_CHOICES', `${at}/choices`, `"${n.id}" has ${cs.length} choices; the screen shows ${L.maxChoices}`);
      // Buttons are mixed deterministically (by node id and label), because writers put the best
      // choice first and a player who always taps the top button would then win. keep_order: true
      // keeps the written order.
      const order = cs.slice(0, L.maxChoices).map((c, j) => ({ c, j }));
      if (raw.keep_order !== true) order.sort((a, b) => fnv(`${n.id}/${clean(a.c?.label)}`) - fnv(`${n.id}/${clean(b.c?.label)}`) || a.j - b.j);
      order.forEach(({ c, j }) => {
        const cat = `${at}/choices/${j}`;
        const label = clean(c?.label ?? c?.text);
        if (!label) err('S_LABEL', cat, 'every choice needs a label');
        if (chars(label) > L.label) err('S_LABEL_LONG', `${cat}/label`, `"${label}" is ${chars(label)} characters; a button holds ${L.label}`);
        const note = clean(c?.note || '');
        if (chars(note) > L.note) err('S_NOTE', `${cat}/note`, `note is ${chars(note)} characters; keep it to ${L.note}`);
        const to = c?.to;
        if (!index.has(to)) err('S_TARGET', `${cat}/to`, `"${to}" isn't a node`);
        else if (to === n.id && !(c.routes?.length)) warn('S_SELF', `${cat}/to`, `"${label}" leads back to the same scene`);
        const routes = (Array.isArray(c?.routes) ? c.routes : []).map((r, ri) => {
          if (!index.has(r?.to)) { err('S_TARGET', `${cat}/routes/${ri}/to`, `"${r?.to}" isn't a node`); return null; }
          const cond = resolveCond(r.if, `${cat}/routes/${ri}/if`);
          if (!cond) warn('S_ROUTE_ALWAYS', `${cat}/routes/${ri}`, 'a route with no condition always wins; use `to` instead');
          return { cond, to: index.get(r.to) };
        }).filter(Boolean);
        node.choices.push({ label, note, need: resolveCond(c?.if, `${cat}/if`), fx: resolveFx(c?.do, `${cat}/do`), to: index.get(to) ?? 0, routes });
      });
    }
    return node;
  });

  const endings = nodes.filter((n) => n.ending);
  if (endings.length < L.minEndings || endings.length > L.maxEndings) err('S_ENDINGS', '/nodes', `${endings.length} endings; a story needs ${L.minEndings}–${L.maxEndings}`);
  if (nodes[0]?.ending) err('S_START', '/start', 'the story starts on an ending');
  // Ranks: 1 is best. Missing ranks follow tone order (good, secret, neutral, bad).
  const tonal = { good: 1, secret: 2, neutral: 3, bad: 4 };
  for (const e of endings) if (e.ending.rank == null) e.ending.rank = tonal[e.ending.tone] ?? 4;
  const ranks = [...new Set(endings.map((e) => e.ending.rank))].sort((a, b) => a - b);
  for (const e of endings) {
    const tier = ranks.length - ranks.indexOf(e.ending.rank); // best rank gets the top tier
    if (e.ending.points == null) e.ending.points = tier * 1000;
  }
  endings.slice().sort((a, b) => a.ending.rank - b.ending.rank || a.k - b.k).forEach((e, j) => { e.ending.number = j + 1; });
  if (!endings.some((e) => e.ending.win)) err('S_NO_WIN', '/nodes', 'no ending is good or secret, so nobody can win');
  if (!endings.some((e) => !e.ending.win)) warn('S_NO_LOSS', '/nodes', 'every ending is a win; add a bad or neutral ending so choices matter');

  const maxChoices = Number.isInteger(raw.max_choices) && raw.max_choices > 0 ? raw.max_choices : 0;
  if (maxChoices > L.depthCap) err('S_LIMIT', '/max_choices', `max_choices is at most ${L.depthCap}`);
  let onLimit = -1;
  if (raw.on_limit != null) {
    if (!index.has(raw.on_limit) || !nodes[index.get(raw.on_limit)]?.ending) err('S_ON_LIMIT', '/on_limit', `on_limit "${raw.on_limit}" must be an ending node`);
    else if (!maxChoices) warn('S_ON_LIMIT', '/on_limit', 'on_limit does nothing without max_choices');
    else onLimit = index.get(raw.on_limit);
  }
  const goalId = raw.goal ?? null;
  let goal = endings.slice().sort((a, b) => a.ending.rank - b.ending.rank || a.k - b.k)[0]?.k ?? -1;
  if (goalId != null) {
    if (!index.has(goalId) || !nodes[index.get(goalId)].ending) err('S_GOAL', '/goal', `goal "${goalId}" must be an ending node`);
    else goal = index.get(goalId);
  }
  for (const e of endings) {
    const share = e.ending.share;
    if (share) {
      for (const m of share.matchAll(/\{([a-z_]+)\}/g)) if (!['choices', 'limit', 'ending'].includes(m[1]) && !varIndex.has(m[1])) err('S_SHARE', `/nodes/${e.id}/ending/share`, `share line names {${m[1]}}, which isn't choices, limit, ending or a variable`);
      const longest = share.replace(/\{ending\}/g, e.ending.title).replace(/\{[a-z_]+\}/g, '00');
      if (chars(longest) > L.share) err('S_SHARE', `/nodes/${e.id}/ending/share`, `share line is about ${chars(longest)} characters; keep it to ${L.share}`);
      if (/\{(?![a-z_]+\})/.test(share)) warn('S_SHARE', `/nodes/${e.id}/ending/share`, 'stray { in the share line');
    }
  }
  const bonusMax = (maxChoices ? (maxChoices - 1) * 25 : 0) + vars.reduce((a, v) => a + v.weight * Math.max(Math.abs(v.max), Math.abs(v.min)), 0);
  if (bonusMax >= 1000 && endings.every((e) => e.ending.points % 1000 === 0)) warn('S_SCORE_ORDER', '/vars', `stat points can reach ${bonusMax}, so a worse ending can outscore a better one; lower the score weights`);

  return {
    graph: { title, premise: clean(raw.premise || ''), vars, nodes, maxChoices, onLimit, goal, raw },
    errors,
    warnings,
  };
}

// ---------- the walk ----------

function holds(cond, vals) {
  if (!cond) return true;
  return cond.split('|').some((alt) => alt.split('&').every((a) => {
    const ge = a.split('>=');
    if (ge.length === 2) return (vals[+ge[0]] ?? 0) >= +ge[1];
    const le = a.split('<=');
    if (le.length === 2) return (vals[+le[0]] ?? 0) <= +le[1];
    return false;
  }));
}

function applyFx(g, vals, fx) {
  if (!fx) return vals;
  const out = vals.slice();
  for (const t of fx.split(' ')) {
    const [i, v] = t.split(':');
    const k = +i;
    out[k] = v.startsWith('=') ? +v.slice(1) : out[k] + +v;
  }
  return out.map((x, k) => Math.min(Math.max(x, g.vars[k].min), g.vars[k].max));
}

/** The choices shown at node `s` with values `vals`: original choice indices, in display order. */
export function openChoices(g, s, vals) {
  return g.nodes[s].choices.map((c, j) => (holds(c.need, vals) ? j : -1)).filter((j) => j >= 0);
}

/** Takes choice `j` (original index) at node `s`: {to, vals} after effects, routes, limit and enter. */
export function takeChoice(g, s, j, vals, used) {
  const c = g.nodes[s].choices[j];
  const after = applyFx(g, vals, c.fx);
  let to = c.to;
  for (const r of c.routes) if (holds(r.cond, after)) { to = r.to; break; }
  if (g.maxChoices && g.onLimit >= 0 && used + 1 >= g.maxChoices && !g.nodes[to].ending) to = g.onLimit;
  return { to, vals: applyFx(g, after, g.nodes[to].enter) };
}

export function initialVals(g) {
  return applyFx(g, g.vars.map((v) => v.init), g.nodes[0].enter);
}

/** The score the engine gives a run that ends at ending node `s` with `vals` after `used` choices. */
export function storyScore(g, s, vals, used) {
  const e = g.nodes[s].ending;
  if (!e) return 0;
  const bonus = e.win && g.maxChoices ? Math.max(0, g.maxChoices - used) * 25 : 0;
  return e.points + bonus + vals.reduce((a, v, k) => a + v * g.vars[k].weight, 0);
}

/**
 * Walks every reachable (node, values, choices used) state. Returns the state table, or
 * {overflow: true} past maxStates.
 */
export function walkStory(g, { maxStates = STORY_LIMITS.maxStates } = {}) {
  const cap = g.maxChoices || STORY_LIMITS.depthCap;
  const states = new Map(); // key -> {s, vals, used, next: [{j, display, key}], end}
  const key = (s, vals, used) => `${s}|${vals.join(',')}|${used}`;
  const v0 = initialVals(g);
  const root = key(0, v0, 0);
  const queue = [[0, v0, 0]];
  states.set(root, null);
  let overflow = false;
  const overLimit = [];
  for (let qi = 0; qi < queue.length; qi++) {
    const [s, vals, used] = queue[qi];
    const k = key(s, vals, used);
    const st = { s, vals, used, next: [], end: !!g.nodes[s].ending, depthHit: false };
    states.set(k, st);
    if (st.end) continue;
    if (used >= cap) { st.depthHit = true; overLimit.push(k); continue; }
    openChoices(g, s, vals).forEach((j, display) => {
      const t = takeChoice(g, s, j, vals, used);
      const nk = key(t.to, t.vals, used + 1);
      st.next.push({ j, display, key: nk });
      if (!states.has(nk)) {
        if (states.size >= maxStates) { overflow = true; return; }
        states.set(nk, null);
        queue.push([t.to, t.vals, used + 1]);
      }
    });
    if (overflow) break;
  }
  return { states, root, overflow, overLimit, cap };
}

/** A path of {s, j, display} steps from the root to state `target` (BFS parents). */
export function pathTo(walk, target) {
  const parent = new Map([[walk.root, null]]);
  const queue = [walk.root];
  for (let i = 0; i < queue.length && !parent.has(target); i++) {
    const st = walk.states.get(queue[i]);
    for (const n of st?.next ?? []) if (!parent.has(n.key)) { parent.set(n.key, { from: queue[i], s: st.s, j: n.j, display: n.display }); queue.push(n.key); }
  }
  if (!parent.has(target)) return null;
  const steps = [];
  for (let k = target; parent.get(k); k = parent.get(k).from) steps.unshift(parent.get(k));
  return steps.map(({ s, j, display }) => ({ s, j, display }));
}

const describePath = (g, steps) => steps.map((p) => `"${g.nodes[p.s].choices[p.j].label}"`).join(' → ') || '(the start)';

// ---------- validate ----------

/**
 * The deterministic story check. Returns {ok, errors, warnings, stats, graph}. Errors block; each
 * has {code, at, message} with a message written so Muse can fix it.
 */
export function validateStoryGraph(raw, opts = {}) {
  const norm = normalizeStoryGraph(raw);
  const { graph: g, errors, warnings } = norm;
  const stats = {};
  if (!g || errors.some((e) => ['S_TARGET', 'S_START', 'S_SHAPE', 'S_NODE_ID', 'S_NODE_DUP'].includes(e.code))) {
    return { ok: false, errors, warnings, stats, graph: g };
  }
  const err = (code, at, message) => errors.push({ code, at, message });
  const warn = (code, at, message) => warnings.push({ code, at, message });
  const N = g.nodes.length;

  // Static reachability (ignoring conditions): a cheap first answer.
  const staticSeen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const s = stack.pop();
    for (const c of g.nodes[s].choices) for (const t of [c.to, ...c.routes.map((r) => r.to)]) if (!staticSeen.has(t)) { staticSeen.add(t); stack.push(t); }
    if (g.onLimit >= 0 && !staticSeen.has(g.onLimit) && g.nodes[s].choices.length) { staticSeen.add(g.onLimit); stack.push(g.onLimit); }
  }

  const walk = walkStory(g, opts);
  stats.states = walk.states.size;
  if (walk.overflow) {
    err('S_STATE_SPACE', '/vars', `the story has more than ${STORY_LIMITS.maxStates} distinct situations; narrow the stat ranges or use fewer variables`);
    return { ok: false, errors, warnings, stats, graph: g };
  }
  const all = [...walk.states.entries()].filter(([, st]) => st);

  // Reachable nodes, dead ends, paths that don't end in time.
  const reached = new Set(all.map(([, st]) => st.s));
  for (const n of g.nodes) {
    if (reached.has(n.k)) continue;
    if (n.k === g.onLimit) { warn('S_LIMIT_UNUSED', `/nodes/${n.id}`, `no path runs out of choices, so the on_limit ending "${n.id}" never shows`); continue; }
    const why = staticSeen.has(n.k) ? 'the conditions on the way never hold' : 'no choice leads here';
    err(n.ending ? 'S_ENDING_UNREACHABLE' : 'S_UNREACHABLE', `/nodes/${n.id}`, `${n.ending ? 'ending' : 'node'} "${n.id}" can't be reached: ${why}`);
  }
  const deadEnds = all.filter(([, st]) => !st.end && !st.depthHit && st.next.length === 0);
  const deadNodes = new Set();
  for (const [k, st] of deadEnds) {
    if (deadNodes.has(st.s)) continue;
    deadNodes.add(st.s);
    const p = pathTo(walk, k);
    err('S_DEAD_END', `/nodes/${g.nodes[st.s].id}`, `dead end: after ${describePath(g, p ?? [])}, "${g.nodes[st.s].id}" shows no choice (every choice's condition fails). Add a choice with no condition.`);
  }
  if (walk.overLimit.length) {
    const p = pathTo(walk, walk.overLimit[0]);
    if (g.maxChoices) err('S_OVER_LIMIT', '/max_choices', `a run can use all ${g.maxChoices} choices without ending: ${describePath(g, p ?? [])}. Shorten that branch, or set on_limit to an ending.`);
    else err('S_NEVER_ENDS', '/nodes', `a run can go ${walk.cap} choices without ending (a loop?): ${describePath(g, (p ?? []).slice(-6))}. Make loops spend a stat that runs out, or set max_choices.`);
  }

  // Exact odds under a uniform random chooser, path counts, and min/max choices to each ending.
  const memo = new Map();
  const outcome = (k) => {
    if (memo.has(k)) return memo.get(k);
    const st = walk.states.get(k);
    const r = { p: new Map(), paths: new Map(), win: false, maxLeft: 0 };
    if (st.end) { r.p.set(st.s, 1); r.paths.set(st.s, 1); r.win = g.nodes[st.s].ending.win; }
    else {
      const n = st.next.length;
      for (const nx of st.next) {
        const sub = outcome(nx.key);
        for (const [e, p] of sub.p) r.p.set(e, (r.p.get(e) ?? 0) + p / n);
        for (const [e, c] of sub.paths) r.paths.set(e, Math.min(1e12, (r.paths.get(e) ?? 0) + c));
        r.win ||= sub.win;
        r.maxLeft = Math.max(r.maxLeft, sub.maxLeft + 1);
      }
    }
    memo.set(k, r);
    return r;
  };
  // Children before parents: `used` only grows, so sort by used, descending.
  for (const [k] of all.slice().sort((a, b) => b[1].used - a[1].used)) outcome(k);
  const rootOut = outcome(walk.root);

  const minTo = new Map();
  const maxTo = new Map();
  for (const [, st] of all) if (st.end) {
    minTo.set(st.s, Math.min(minTo.get(st.s) ?? Infinity, st.used));
    maxTo.set(st.s, Math.max(maxTo.get(st.s) ?? 0, st.used));
  }
  const endings = g.nodes.filter((n) => n.ending);
  stats.nodes = N;
  stats.endings = endings.length;
  stats.vars = g.vars.length;
  stats.max_choices = g.maxChoices || null;
  stats.shortest = Math.min(...minTo.values());
  stats.longest = Math.max(...maxTo.values(), 0);
  stats.paths = [...rootOut.paths.values()].reduce((a, b) => a + b, 0);
  stats.p_win = Math.round(endings.filter((e) => e.ending.win).reduce((a, e) => a + (rootOut.p.get(e.k) ?? 0), 0) * 1000) / 1000;
  stats.endings_detail = endings.map((e) => ({
    id: e.id, title: e.ending.title, tone: e.ending.tone, rank: e.ending.rank, points: e.ending.points,
    p_random: Math.round((rootOut.p.get(e.k) ?? 0) * 1000) / 1000,
    paths: rootOut.paths.get(e.k) ?? 0,
    min_choices: minTo.get(e.k) ?? null,
    max_choices: maxTo.get(e.k) ?? null,
  }));

  // The goal (best ending) within the choice limit.
  const goal = g.nodes[g.goal];
  if (goal && minTo.has(goal.k)) {
    stats.goal = goal.id;
    stats.goal_min_choices = minTo.get(goal.k);
    if (g.maxChoices && minTo.get(goal.k) > g.maxChoices) err('S_LIMIT_UNSAT', '/max_choices', `the best ending "${goal.id}" needs ${minTo.get(goal.k)} choices but the limit is ${g.maxChoices}`);
    if (stats.goal_min_choices <= 1 && N > 6) warn('S_GOAL_TOO_CLOSE', `/nodes/${goal.id}`, `the best ending is one tap from the start`);
  }

  for (const d of stats.endings_detail) {
    const e = g.nodes.find((n) => n.id === d.id);
    if (d.p_random === 0) continue;
    if (d.p_random < 0.02 && e.ending.tone !== 'secret' && e.k !== g.goal) warn('S_ENDING_RARE', `/nodes/${d.id}`, `a random player reaches "${d.id}" ${(d.p_random * 100).toFixed(1)}% of the time; make it easier to find or mark it secret`);
    if (d.p_random > 0.6 && endings.length > 2) warn('S_ENDING_COMMON', `/nodes/${d.id}`, `${Math.round(d.p_random * 100)}% of random runs end at "${d.id}"; the other endings barely matter`);
  }
  if (stats.p_win === 1) warn('S_ALWAYS_WIN', '/nodes', 'every path wins; bad choices should cost something');
  if (stats.p_win === 0 && !errors.some((e) => e.code === 'S_ENDING_UNREACHABLE')) err('S_NEVER_WIN', '/nodes', 'no path reaches a good ending');
  const goalP = stats.endings_detail.find((d) => d.id === goal?.id)?.p_random ?? 0;
  if (goal && goalP > 0 && goalP < 0.02) warn('S_GOAL_HARD', `/nodes/${goal.id}`, `only ${(goalP * 100).toFixed(1)}% of random runs reach the best ending; aim for 5–20% so most friends can find it with some thought`);
  if (goalP > 0.5) warn('S_GOAL_EASY', `/nodes/${goal.id}`, `${Math.round(goalP * 100)}% of random runs reach the best ending`);

  // Doomed stretches: from a state that can no longer win, how many choices until it ends.
  let doomed = 0;
  let worst = null;
  for (const [k, st] of all) {
    if (st.end || outcome(k).win) continue;
    const left = outcome(k).maxLeft;
    if (left >= 3) { doomed++; if (!worst || left > worst.left) worst = { k, left, st }; }
  }
  stats.doomed_states = doomed;
  if (worst) {
    const p = pathTo(walk, worst.k);
    warn('S_DOOMED', `/nodes/${g.nodes[worst.st.s].id}`, `after ${describePath(g, p ?? [])} the good endings are already out of reach, but the run can go ${worst.left} more choices. Tell the player sooner (end the branch, or keep a way back).`);
  }

  // Tapping one button over and over (what the score check's spam bot does) shouldn't beat a
  // typical reader: compare its ending with the median random run's.
  const ranked = stats.endings_detail.slice().sort((a, b) => a.rank - b.rank);
  let acc = 0;
  let medianRank = ranked[ranked.length - 1]?.rank;
  for (const d of ranked.slice().reverse()) { acc += d.p_random; if (acc >= 0.5) { medianRank = d.rank; break; } }
  stats.same_button = [];
  for (let d = 0; d < STORY_LIMITS.maxChoices; d++) {
    let k = walk.root;
    for (let guard = 0; guard < 64; guard++) {
      const st = walk.states.get(k);
      const nx = st?.next.find((n) => n.display === d);
      if (!st || st.end || !nx) break;
      k = nx.key;
    }
    const st = walk.states.get(k);
    const end = st?.end ? g.nodes[st.s] : null;
    stats.same_button.push(end ? end.id : null);
    if (end && end.ending.rank < medianRank) warn('S_SAME_BUTTON', `/nodes/${end.id}`, `always tapping button ${d + 1} reaches "${end.id}" (rank ${end.ending.rank}), better than a typical random run (rank ${medianRank}); the score check reads that as farming. Move the better choice off button ${d + 1} somewhere on that route.`);
  }

  // Choices that do the same thing.
  for (const n of g.nodes) {
    const sig = n.choices.map((c) => `${c.need}|${c.fx}|${c.to}|${c.routes.map((r) => r.cond + '~' + r.to).join(';')}`);
    if (sig.length > 1 && new Set(sig).size < sig.length) warn('S_SAME_CHOICE', `/nodes/${n.id}`, `two choices in "${n.id}" have the same conditions, effects and target; make them lead somewhere different`);
  }
  const single = g.nodes.filter((n) => !n.ending && n.choices.length === 1).length;
  if (single > (N - endings.length) * 0.3) warn('S_LINEAR', '/nodes', `${single} scenes have a single choice; a story needs real decisions`);
  if (N - endings.length < 3) warn('S_SMALL', '/nodes', 'fewer than 3 scenes before the endings');

  // Size of what the engine carries.
  const compiled = compileContent(g);
  stats.content_bytes = new TextEncoder().encode(JSON.stringify(compiled)).length;
  if (stats.content_bytes > STORY_LIMITS.contentBytes) err('S_SIZE', '/nodes', `the story is ${stats.content_bytes} bytes as game content; keep it under ${STORY_LIMITS.contentBytes}`);
  stats.words = g.nodes.reduce((a, n) => a + n.text.split(' ').length, 0);

  return { ok: errors.length === 0, errors, warnings, stats, graph: g };
}

/** One line per problem, for a Muse repair prompt or a log. */
export function storyIssueLines(report, { warnings = true } = {}) {
  const lines = report.errors.map((e) => `error ${e.code} at ${e.at || '/'}: ${e.message}`);
  if (warnings) lines.push(...report.warnings.map((w) => `warning ${w.code} at ${w.at || '/'}: ${w.message}`));
  return lines;
}

// ---------- compile ----------

/** The content lists the `story_vars` and `choice_story` fragments read (aligned by scene). */
export function compileContent(g) {
  const per = (f) => g.nodes.map(f);
  const perChoice = (f) => g.nodes.flatMap((n) => [0, 1, 2].map((j) => (n.choices[j] ? f(n.choices[j], n, j) : '')));
  const endingCount = g.nodes.filter((n) => n.ending).length;
  return {
    story_lines: g.nodes.flatMap((n) => [0, 1, 2, 3].map((k) => n.lines[k] ?? '')),
    story_ends: per((n) => (n.ending ? (n.ending.win ? 'good' : 'bad') : '')),
    sg_src_labels: perChoice((c) => c.label),
    sg_src_next: perChoice((c) => String(c.to)),
    sg_need: perChoice((c) => c.need),
    sg_do: perChoice((c) => c.fx),
    sg_route: perChoice((c) => c.routes.map((r) => `${r.cond}~${r.to}`).join(';')),
    sg_note: perChoice((c) => c.note),
    sg_enter: per((n) => n.enter),
    sg_place: per((n) => n.place),
    sg_end_title: per((n) => n.ending?.title ?? ''),
    sg_end_id: per((n) => (n.ending ? n.id : '')),
    sg_end_tag: per((n) => (n.ending ? `Ending ${n.ending.number} of ${endingCount}` : '')),
    sg_end_points: per((n) => (n.ending ? String(n.ending.points) : '')),
    sg_share: per((n) => n.ending?.share || (n.ending ? (g.maxChoices ? '{ending} in {choices} choices' : '{ending}') : '')),
    sg_var: g.vars.map((v) => v.id),
    sg_label: g.vars.map((v) => v.label),
    sg_kind: g.vars.map((v) => v.kind),
    sg_init: g.vars.map((v) => String(v.init)),
    sg_lo: g.vars.map((v) => String(v.min)),
    sg_hi: g.vars.map((v) => String(v.max)),
    sg_weight: g.vars.map((v) => String(v.weight)),
  };
}

// The state each fragment requires, filled from content.
const CONTENT_STATE = ['story_lines', 'story_ends', 'sg_src_labels', 'sg_src_next', 'sg_need', 'sg_do', 'sg_route', 'sg_note', 'sg_enter', 'sg_place',
  'sg_end_title', 'sg_end_id', 'sg_end_tag', 'sg_end_points', 'sg_share', 'sg_var', 'sg_label', 'sg_kind', 'sg_init', 'sg_lo', 'sg_hi', 'sg_weight'];

/** The board model for a story (SPEC 2.13): ending rank first, then fewer choices, then stats. */
export function storyScoreModel(g) {
  return {
    kind: 'points',
    measures: g.maxChoices ? `which ending you reached (best first), then how few of the ${g.maxChoices} choices you used` : 'which ending you reached (best first), then your stats',
    unit: 'points',
    direction: 'higher',
    counts_when: 'any',
    aggregate: 'best',
    tie_break: 'less time',
    format: '{n} pts',
    events: ['ending_reached'],
  };
}

/**
 * The group-play result for a story (HARNESS_V2 "Group play", social.result): compare by ending, best
 * first, then the score (which already counts unused choices). The game keeps the ending's id in state
 * `ending` and the choices used in `choices_used` (story_vars).
 */
export function storyGroupResult(g) {
  const endings = g.nodes.filter((n) => n.ending).sort((a, b) => a.ending.rank - b.ending.rank || a.ending.number - b.ending.number).map((n) => n.id);
  return { kind: 'ending', compare: 'ending', display: '{ending}', endings, state: ['ending', 'choices_used'] };
}

/**
 * Compiles a story graph into an authoring manifest. Throws if the graph has errors (validate first).
 * opts: {look, palette, readMs, curtainMs, instructions}
 */
export function compileStoryGraph(raw, opts = {}) {
  const report = opts.report ?? validateStoryGraph(raw);
  if (!report.ok) throw new Error(`story graph has errors:\n${storyIssueLines(report, { warnings: false }).join('\n')}`);
  const g = report.graph;
  const content = compileContent(g);
  const state = {};
  for (const k of CONTENT_STATE) state[k] = { type: 'list<string>', init: `content_${k}` };
  // choice_story rewrites these two from the sources each choice (story_vars), so they start empty.
  state.story_labels = { type: 'list<string>', init: 'content_sg_src_labels' };
  state.story_next = { type: 'list<string>', init: 'content_sg_src_next' };
  const words = g.nodes.reduce((a, n) => a + n.text.length, 0);
  const avgRead = Math.round(Math.min(3000, Math.max(1200, (words / g.nodes.length) * 18)));
  const limitText = g.maxChoices ? ` in ${g.maxChoices} choices or less` : '';
  const instructions = clean(opts.instructions || `${g.premise ? g.premise + ' ' : ''}Tap a choice. Reach the best ending${limitText}.`).slice(0, 200);
  const manifest = {
    authoring: 'microgame-authoring/0.1',
    meta: { title: g.title, instructions, duration_s: Math.min(300, Math.max(60, (report.stats.longest || 8) * Math.round(avgRead / 1000 + 4))) },
    uses: [
      { fragment: 'choice_story', params: { read_ms: opts.readMs ?? avgRead, good_wins: false, bad_loses: false, text_y: 156, button_y: 392 } },
      {
        fragment: 'story_vars',
        params: {
          limit: g.maxChoices,
          limit_to: g.onLimit,
          curtain_ms: opts.curtainMs ?? 3500,
        },
      },
    ],
    state,
    rules: [],
    objectives: {},
    presentation: { slots: [], feedback: [] },
    look: { id: opts.look ?? 'paper', tokens: {} },
    ...(opts.palette ? { art: { palette: opts.palette } } : {}),
    sound: { set: opts.soundSet ?? 'cozy' },
    content,
    playtest: { progress: 'sg_progress' },
    score: storyScoreModel(g),
  };
  // A hint for the generic gate bots (SPEC 2.6): closer to the best ending is better.
  const dist = goalDistances(g);
  manifest.content.sg_heat = g.nodes.map((n) => String(Math.max(0, 60 - (dist[n.k] ?? 60))));
  manifest.state.sg_heat = { type: 'list<string>', init: 'content_sg_heat' };
  manifest.functions = {
    sg_progress: { params: {}, returns: 'int', body: 'if sg_end >= 0 then 100000 + sg_score() else or_else(parse_int(get_or(sg_heat, scene, \'0\')), 0) * 100 + sum(sg_vals)' },
  };
  manifest.playtest = { progress: 'sg_progress()' };
  return { manifest, report, score: manifest.score, groupResult: storyGroupResult(g) };
}

/** Choices from each node to the goal ending, ignoring conditions (for the bots' progress hint). */
function goalDistances(g) {
  const rev = g.nodes.map(() => []);
  for (const n of g.nodes) for (const c of n.choices) for (const t of [c.to, ...c.routes.map((r) => r.to)]) rev[t].push(n.k);
  const dist = { [g.goal]: 0 };
  const q = [g.goal];
  for (let i = 0; i < q.length; i++) for (const p of rev[q[i]]) if (dist[p] == null) { dist[p] = dist[q[i]] + 1; q.push(p); }
  return dist;
}
