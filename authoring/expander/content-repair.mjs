// Deterministic repair for A_UNKNOWN_CONTENT (an expression reads content_<key>, but content has no <key>),
// run by the pipeline before it asks Muse. Muse repeated this one error for three repair rounds in two Prod
// jobs (content_words, content_end_lines), so a repair round alone doesn't fix it.
//
// For each missing key, the first that applies:
//   moved     content has "content_<key>" (the prefix written into the key): renamed to <key>
//   hoisted   content has it one level down (content.lists.words, content.words.list): moved up
//   renamed   content has the same name in another spelling (word / words, Lines, a typo in a long name): the
//             expressions are pointed at that key
//   derived   the manifest has a string or list of strings under that name elsewhere (top level,
//             design, state init as a literal list): copied into content
//   defaulted only with `fill` (the key was already sent to Muse, or this is the last round): an empty
//             list or string, so the build can continue; the gate and the quality check judge the result
// Pure: returns {manifest, fixes: [{key, kind, from?, detail}]}; the manifest is a copy.

import { tokenize } from './expr.mjs';

export const UNKNOWN_CONTENT = 'A_UNKNOWN_CONTENT';

const isStrings = (v) => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
const clone = (v) => JSON.parse(JSON.stringify(v));

/** The keys an expansion's diagnostics say are missing from content. */
export function missingContentKeys(diagnostics = []) {
  const keys = [];
  for (const d of diagnostics) {
    if (d?.code !== UNKNOWN_CONTENT) continue;
    const m = /content_([A-Za-z0-9_]+)/.exec(d.message ?? '');
    if (m && !keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// word / words, story_line / story_lines, entry / entries; case and separators dropped.
const stem = (w) => w.toLowerCase().replace(/ies$/, 'y').replace(/(ss|us|is)$/, '$1').replace(/s$/, '');
const norm = (k) => String(k).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem).join('_');

/**
 * The content key that is plainly the same name as `key`, or null: the same words up to plurals, case and
 * separators (words / word, endLines / end_lines), else a typo (a small edit distance, one clear winner). A key
 * with a word more or less (end_lines / lines, words / theme_words) is a different list, so it never matches.
 */
export function similarKey(key, keys) {
  const usable = keys.filter((k) => k !== key);
  const n = norm(key);
  const same = usable.filter((k) => norm(k) === n);
  if (same.length === 1) return same[0];
  if (same.length > 1) return null;
  let best = null;
  for (const k of usable) {
    const dist = editDistance(n, norm(k));
    if (n.length >= 6 && dist <= (n.length >= 12 ? 2 : 1) && (!best || dist < best.dist)) best = { k, dist, tie: false };
    else if (best && dist === best.dist) best.tie = true;
  }
  return best && !best.tie ? best.k : null;
}

// Every expression string in the game's own sections (not content, art, sound or design text).
const EXPR_SECTIONS = ['types', 'state', 'functions', 'events', 'inputs', 'rules', 'objectives', 'presentation', 'playtest', 'score', 'uses'];
function mapStrings(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, fn)]));
  return v;
}
// Renames one identifier where it is read as a name (not `.field`, not a record key `x:`); the rest of the
// text (strings, @params) stays byte for byte.
function renameIdent(src, from, to) {
  const t = tokenize(src);
  const near = (k, step) => { let i = k + step; while (i >= 0 && i < t.length && t[i].kind === 'other' && /\s/.test(t[i].text)) i += step; return t[i]; };
  let changed = false;
  const out = t.map((tok, k) => {
    if (tok.kind !== 'ident' || tok.text !== from) return tok.text;
    if (near(k, -1)?.text === '.' || near(k, 1)?.text === ':') return tok.text;
    changed = true;
    return to;
  }).join('');
  return changed ? out : src;
}
function renameReads(manifest, from, to) {
  let count = 0;
  const fn = (s) => {
    if (!s.includes(`content_${from}`)) return s;
    const r = renameIdent(s, `content_${from}`, `content_${to}`);
    if (r !== s) count++;
    return r;
  };
  for (const s of EXPR_SECTIONS) if (manifest[s] !== undefined) manifest[s] = mapStrings(manifest[s], fn);
  return count;
}

/** How the expressions use content_<key>: 'list' or 'string' (a guess from the calls around it and the name). */
function usageOf(manifest, key) {
  const name = `content_${key}`;
  let list = 0, str = 0;
  const listCall = new RegExp(`\\b(len|get_or|pick|shuffle|contains|index_of|at|sample|slice|count|first|last|join)\\s*\\(\\s*${name}\\b|\\b${name}\\s*\\[|\\bin\\s+${name}\\b`);
  const strUse = new RegExp(`\\b(upper|lower|trim)\\s*\\(\\s*${name}\\b|\\b${name}\\s*\\+|\\+\\s*${name}\\b`);
  const fn = (s) => { if (s.includes(name)) { if (listCall.test(s)) list++; if (strUse.test(s)) str++; } return s; };
  for (const s of EXPR_SECTIONS) if (manifest[s] !== undefined) mapStrings(manifest[s], fn);
  // State or function types that hold it: {"type": "list<string>", "init": "content_x"}.
  for (const sec of ['state', 'functions']) for (const v of Object.values(manifest[sec] ?? {})) {
    const body = String(v?.init ?? v?.body ?? '');
    if (body.trim() === name) { const t = String(v?.type ?? v?.returns ?? ''); if (t.startsWith('list')) list++; else if (t === 'string') str++; }
  }
  if (list !== str) return list > str ? 'list' : 'string';
  return /(s|list|lines|options|choices|words|names|items|questions|answers)$/i.test(key) ? 'list' : 'string';
}

/** A string or list of strings named `key` somewhere else in the manifest (one level into objects). */
function findElsewhere(manifest, key) {
  const names = [key, `content_${key}`];
  for (const [section, v] of Object.entries(manifest)) {
    if (section === 'content' || !v || typeof v !== 'object') continue;
    for (const n of names) if (isStrings(v[n]) && (v[n].length ?? 0) > 0) return { value: v[n], from: `/${section}/${n}` };
    // A state entry that holds the list itself: {"words": {"type": "list<string>", "init": "['a', 'b']"}}.
    if (section === 'state') for (const n of names) {
      const init = v[n]?.init;
      if (typeof init === 'string' && /^\s*\[\s*'/.test(init)) {
        const items = [...init.matchAll(/'([^']*)'/g)].map((m) => m[1]);
        if (items.length) return { value: items, from: `/state/${n}/init` };
      }
    }
  }
  for (const n of names) if (isStrings(manifest[n])) return { value: manifest[n], from: `/${n}` };
  return null;
}

/**
 * repairContent(manifest, keys, {fill}) → {manifest, fixes}. keys: the missing content keys
 * (missingContentKeys). fill: true, or a Set of keys, for which an empty value may be added when nothing
 * better is found.
 */
export function repairContent(manifest, keys, { fill = false } = {}) {
  const m = clone(manifest ?? {});
  const fixes = [];
  if (!keys?.length || !m || typeof m !== 'object') return { manifest: m, fixes };
  if (!m.content || typeof m.content !== 'object' || Array.isArray(m.content)) m.content = {};
  const C = m.content;
  for (const key of keys) {
    if (C[key] !== undefined) continue;
    // moved: "content_words": [...] inside content.
    if (isStrings(C[`content_${key}`])) {
      C[key] = C[`content_${key}`];
      delete C[`content_${key}`];
      fixes.push({ key, kind: 'moved', from: `/content/content_${key}`, detail: `content.content_${key} is now content.${key}` });
      continue;
    }
    // hoisted: one level down (content.lists.words), or wrapped (content.words.list / .items / .values).
    let hoisted = null;
    for (const [k, v] of Object.entries(C)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      if (isStrings(v[key])) { hoisted = { value: v[key], from: `/content/${k}/${key}` }; break; }
      if (k === key) {
        const inner = Object.entries(v).filter(([, x]) => isStrings(x));
        if (inner.length === 1) { hoisted = { value: inner[0][1], from: `/content/${k}/${inner[0][0]}` }; break; }
      }
    }
    if (hoisted) {
      C[key] = hoisted.value;
      fixes.push({ key, kind: 'hoisted', from: hoisted.from, detail: `moved ${hoisted.from} up to content.${key}` });
      continue;
    }
    // renamed: the expressions read the close key that content does have.
    const near = similarKey(key, Object.keys(C).filter((k) => isStrings(C[k])));
    if (near) {
      const n = renameReads(m, key, near);
      if (n) { fixes.push({ key, kind: 'renamed', from: near, detail: `content_${key} now reads content_${near} (${n} expression${n === 1 ? '' : 's'})` }); continue; }
    }
    // derived: the same name holds words elsewhere in the manifest.
    const found = findElsewhere(m, key);
    if (found) {
      C[key] = clone(found.value);
      fixes.push({ key, kind: 'derived', from: found.from, detail: `copied ${found.from} into content.${key}` });
      continue;
    }
    if (fill === true || (fill instanceof Set && fill.has(key))) {
      const kind = usageOf(m, key);
      C[key] = kind === 'list' ? [] : '';
      fixes.push({ key, kind: 'defaulted', detail: `content.${key} was missing; added an empty ${kind === 'list' ? 'list' : 'string'} so the build can continue` });
    }
  }
  return { manifest: m, fixes };
}
