// fuzzy_match: does a typed answer match an accepted one? (docs/HARNESS_V2.md, "Runtime tools to build now")
//
// Deterministic, no LLM, no dependencies. The same algorithm exists twice, generated from this file:
//   - `match()` and friends below: the JS reference, for tests, answer-bank checks and the server;
//   - `engineFunctions()`: the same steps as microgame engine expressions. The
//     fuzzy_match and typed_answer fragments carry them (written by authoring/tools/make-fuzzy-fragments.mjs),
//     so matching runs inside the Rust/WASM engine: on the phone, in the Node bots and gate, and in
//     replay verification, with one implementation and no engine rebuild.
// authoring/tools/test-fuzzy.mjs checks the two agree, through the real engine when one is built.
//
// Steps, in order:
//   1. normalize: lower case, fold accents (an explicit table, not Unicode NFD, so JS and the engine
//      agree), drop apostrophes and periods, other punctuation to spaces, '&' to 'and', split into
//      words, number words to digits ("three" -> "3"), drop a leading article (the, a, an), fold
//      plurals and simple stems per word;
//   2. aliases: every name of an entry (answer, aliases, also_accept) is tried; the best one counts;
//   3. Damerau-Levenshtein (optimal string alignment) ratio on the words joined without spaces;
//   4. token-set ratio (sorted shared words, then the rest), so word order doesn't matter;
//   5. (plural folding happens in step 1);
//   6. optional phonetic key (a Soundex-style code of the whole name) for names typed by ear.
// Score = max(3, 4), or 1.0 when the normalized forms are equal. Pass when score >= need(name):
//   need = 1.0 (exact after normalizing) for names of <= 4 letters, min(threshold, 1 - 1/n) for 5-7
//   letters (one typo), threshold (default 0.82) from 8 letters on. So "cat" never matches "car",
//   "zebar" matches "zebra", and "wingardium leviosaa" matches "Wingardium Leviosa".
// With phonetic on, a name of 5+ letters also passes when its phonetic key equals the input's and the
// score is at least 0.6.

export const DEFAULT_THRESHOLD = 0.82;
export const PHONETIC_FLOOR = 0.6;
export const TIER_NAMES = ['common', 'uncommon', 'rare', 'legendary'];

// ---------- tables (shared by both implementations) ----------

const FOLD_GROUPS = {
  a: 'àáâãäåāăą', c: 'çćĉċč', d: 'ďđð', e: 'èéêëēĕėęě', g: 'ĝğġģ', h: 'ĥħ', i: 'ìíîïĩīĭįı', j: 'ĵ', k: 'ķ',
  l: 'ĺļľŀł', n: 'ñńņňŉ', o: 'òóôõöøōŏő', r: 'ŕŗř', s: 'śŝşšș', t: 'ţťŧț', u: 'ùúûüũūŭůűų', w: 'ŵ',
  y: 'ýÿŷ', z: 'źżž',
};
const FOLD_MULTI = { 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'þ': 'th', '&': ' and ' };
// Removed outright, so "U.S.A." is "usa" and "don’t" is "dont". (ASCII "'" is handled on its own:
// engine string literals in fragments can't hold it, see `apostrophe` below.)
const DELETE = '.’‘ʼ´`';
// Turned into a space.
const SPACE = '!"#$%()*+,-/:;<=>?@[\\]^_{|}~\t\n\r –—‐‑…·•«»“”„¿¡';

/** char -> replacement, after lower-casing. Combining accents (U+0300-U+036F) are removed. */
export const FOLD = (() => {
  const m = new Map();
  for (const [base, chars] of Object.entries(FOLD_GROUPS)) for (const c of chars) m.set(c, base);
  for (const [c, r] of Object.entries(FOLD_MULTI)) m.set(c, r);
  for (const c of DELETE) m.set(c, '');
  for (const c of SPACE) m.set(c, ' ');
  for (let cp = 0x300; cp <= 0x36f; cp++) m.set(String.fromCodePoint(cp), '');
  return m;
})();

export const NUMBER_WORDS = new Map(
  ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'].map((w, i) => [w, String(i)]),
);
export const ARTICLES = ['the', 'a', 'an'];

// Soundex-style consonant classes; vowels, h, w and y are 0 (dropped, but they split repeats).
const SOUND_GROUPS = { 1: 'bfpv', 2: 'cgjkqsxz', 3: 'dt', 4: 'l', 5: 'mn', 6: 'r' };
export const SOUND = (() => {
  const m = new Map();
  for (const [d, chars] of Object.entries(SOUND_GROUPS)) for (const c of chars) m.set(c, d);
  return m;
})();
const SOUND_ZERO = 'aeiouyhw';

// ---------- the JS reference ----------

const cps = (s) => Array.from(s);
const clen = (s) => cps(s).length;
const csub = (s, a, b) => cps(s).slice(a, b).join('');
// Code point order, like the engine's string ordering (Rust compares UTF-8 bytes).
const cmp = (a, b) => {
  const x = cps(a), y = cps(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
};

export function clean(s) {
  let out = '';
  for (const c of cps(String(s ?? '').toLowerCase())) {
    if (c === "'") continue;
    out += FOLD.has(c) ? FOLD.get(c) : c;
  }
  return out;
}

export function stem(w) {
  let a = w;
  const n0 = clen(a);
  if (n0 > 3 && a.endsWith('s') && !(a.endsWith('ss') || a.endsWith('is') || (a.endsWith('us') && n0 > 4))) a = csub(a, 0, n0 - 1);
  const n = clen(a);
  if (n > 3 && (a.endsWith('xe') || a.endsWith('she') || a.endsWith('che') || a.endsWith('sse'))) return csub(a, 0, n - 1);
  if (n > 3 && a.endsWith('ie')) return csub(a, 0, n - 2) + 'y';
  if (n > 4 && (a.endsWith('ve') || a.endsWith('fe'))) return csub(a, 0, n - 2) + 'f';
  if (n > 5 && a.endsWith('oe')) return csub(a, 0, n - 1);
  return a;
}

/** Normalized words: cleaned, numbers as digits, no leading article, plurals folded. */
export function words(s) {
  let w = clean(s).split(' ').filter((x) => x !== '').map((x) => (NUMBER_WORDS.has(x) ? NUMBER_WORDS.get(x) : x));
  if (w.length > 1 && ARTICLES.includes(w[0])) w = w.slice(1);
  return w.map(stem);
}

export const normalize = (s) => words(s).join(' ');

/** Damerau-Levenshtein distance (optimal string alignment), over code points. */
export function distance(a, b) {
  const x = cps(a), y = cps(b);
  const m = y.length;
  if (!x.length) return m;
  if (!m) return x.length;
  let pp = Array.from({ length: m + 1 }, (_, j) => j);
  let p = pp.slice();
  for (let i = 1; i <= x.length; i++) {
    const c = x[i - 1], cprev = i > 1 ? x[i - 2] : '';
    const r = [i];
    for (let j = 1; j <= m; j++) {
      const bj = y[j - 1];
      let v = Math.min(p[j] + 1, r[j - 1] + 1, p[j - 1] + (c === bj ? 0 : 1));
      if (i > 1 && j > 1 && c === y[j - 2] && cprev === bj) v = Math.min(v, pp[j - 2] + 1);
      r.push(v);
    }
    pp = p;
    p = r;
  }
  return p[m];
}

export function ratio(a, b) {
  const la = clen(a), lb = clen(b);
  if (!la && !lb) return 1.0;
  return 1.0 - (distance(a, b) * 1.0) / (Math.max(la, lb) * 1.0);
}

export function tokenSet(wa, wb) {
  const ua = [...new Set(wa)].sort(cmp), ub = [...new Set(wb)].sort(cmp);
  const inter = ua.filter((w) => ub.includes(w));
  const t1 = [...inter, ...ua.filter((w) => !ub.includes(w))].join(' ');
  const t2 = [...inter, ...ub.filter((w) => !ua.includes(w))].join(' ');
  return ratio(t1, t2);
}

export function soundKey(s) {
  const c = cps(s);
  if (!c.length) return '';
  const code = (ch) => (SOUND.has(ch) ? SOUND.get(ch) : SOUND_ZERO.includes(ch) ? '0' : ch);
  let out = c[0], prev = code(c[0]);
  for (const ch of c.slice(1)) {
    const d = code(ch);
    if (d !== prev && d !== '0') out += d;
    prev = d;
  }
  return out;
}

/** 0..1 similarity of a typed input to one name (both raw text). */
export function score(input, name) {
  const wa = words(input), wb = words(name);
  if (!wa.length || !wb.length) return 0.0;
  const ca = wa.join(''), cb = wb.join('');
  if (ca === cb) return 1.0;
  return Math.max(ratio(ca, cb), tokenSet(wa, wb));
}

/** The score a name needs: exact for short names, one typo for 5-7 letters, then `threshold`. */
export function need(name, threshold = DEFAULT_THRESHOLD) {
  const n = clen(words(name).join(''));
  if (n <= 4) return 1.0;
  if (n <= 7) return Math.min(threshold, 1.0 - 1.0 / (n * 1.0));
  return threshold;
}

export function passes(input, name, s, threshold = DEFAULT_THRESHOLD, phonetic = false) {
  if (s >= need(name, threshold)) return true;
  if (!phonetic || s < PHONETIC_FLOOR) return false;
  const ca = words(input).join(''), cb = words(name).join('');
  return clen(cb) >= 5 && soundKey(ca) === soundKey(cb);
}

/** One entry: a string, or {answer, tier, aliases, also_accept, phonetic}. tier: index or name. */
export function entryOf(e, i = 0) {
  if (typeof e === 'string') {
    const [answer, ...aliases] = e.split('=');
    return { answer, tier: 0, aliases, also_accept: [], phonetic: undefined, index: i };
  }
  const tier = typeof e.tier === 'string' ? Math.max(0, TIER_NAMES.indexOf(e.tier)) : Number.isInteger(e.tier) ? e.tier : 0;
  return { answer: String(e.answer ?? ''), tier, aliases: [...(e.aliases ?? [])].map(String), also_accept: [...(e.also_accept ?? [])].map(String), phonetic: e.phonetic, index: i };
}

/**
 * match(input, accepted[], {threshold, phonetic}) -> {ok, best, score, tier, via, name, index}
 * `best` is the matched entry's answer (on a miss: the closest entry, so tools can show near misses;
 * don't show it to players). Highest passing score wins; ties go to the earlier entry.
 */
export function match(input, accepted, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  let hit = null, near = null;
  (accepted ?? []).forEach((raw, i) => {
    const e = entryOf(raw, i);
    const names = [['answer', e.answer], ...e.aliases.map((a) => ['alias', a]), ...e.also_accept.map((a) => ['also_accept', a])];
    for (const [via, name] of names) {
      const s = score(input, name);
      const ok = passes(input, name, s, threshold, e.phonetic ?? !!opts.phonetic);
      const r = { ok, best: e.answer, score: s, tier: e.tier, via, name, index: i };
      if (ok && (!hit || s > hit.score)) hit = r;
      if (!near || s > near.score) near = r;
    }
  });
  if (hit) return hit;
  return near ? { ...near, ok: false } : { ok: false, best: null, score: 0, tier: null, via: null, name: null, index: -1 };
}

/** typed_answer's content string ("a=alias,b|c|d": tiers by '|', entries by ',', names by '=') to entries. */
export function parseTiers(s) {
  const out = [];
  String(s).split('|').forEach((tier, t) => {
    for (const e of tier.split(',')) if (e.trim()) out.push({ ...entryOf(e), tier: t });
  });
  return out;
}

/** Entries back to typed_answer's content string (aliases and also_accept become '=' names). */
export function formatTiers(entries) {
  const tiers = [];
  for (const raw of entries) {
    const e = entryOf(raw);
    const safe = (x) => String(x).replace(/[|,=]/g, ' ').trim();
    (tiers[e.tier] ??= []).push([e.answer, ...e.aliases, ...e.also_accept].map(safe).filter(Boolean).join('='));
  }
  return Array.from(tiers, (t) => (t ?? []).join(',')).join('|');
}

/**
 * Answer-bank check for the generator: names in different entries that would match each other
 * (so one answer could score as another), with the pair and score.
 */
export function bankCollisions(entries, opts = {}) {
  const list = entries.map(entryOf);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      for (const a of [list[i].answer, ...list[i].aliases, ...list[i].also_accept]) {
        const r = match(a, [list[j]], opts);
        if (r.ok) out.push({ a, b: r.name, score: r.score, tiers: [list[i].tier, list[j].tier] });
      }
    }
  }
  return out;
}

// ---------- the engine version ----------
// `n(key)` names each function and state entry: typed_answer keeps them all private (`_fm_<key>`);
// the fuzzy_match fragment makes `key score passes entry best ok` public (`fuzzy_<key>`). Locals
// start with `fz_` so they can't shadow a game's state. `@threshold` and `@phonetic` are fragment
// params.

const lit = (s) => {
  if (s.includes("'")) throw new Error('engine literal with an apostrophe');
  return `'${s.replace(/\\/g, '\\\\')}'`;
};
// The tables as two parallel strings (one char each) plus a small map for the multi-char folds:
// `index_of` into a literal keeps the functions free of state (no big map serialized with every
// state snapshot the playtest bots take). In TO, '!' means delete and '*' means "see MULTI".
const ENGINE_TABLE = (() => {
  let from = '', to = '';
  const multi = [];
  for (const [k, v] of FOLD) {
    from += k;
    if (v === '') to += '!';
    else if (Array.from(v).length === 1) to += v;
    else { to += '*'; multi.push([k, v]); }
  }
  return { from, to, multi };
})();
const SOUND_FROM = [...SOUND.keys()].join('');
const SOUND_TO = [...SOUND.values()].join('');

/** Kept for callers that merge it into a fragment: the engine version needs no state. */
export function engineState() {
  return {};
}

export function engineFunctions(n) {
  const f = (params, returns, body) => ({ params, returns, body });
  const S = 'string';
  return {
    // ASCII apostrophe: a double-quoted literal on its own, so the expander's token scanner (which
    // only knows single-quoted strings) passes it through untouched.
    [n("apos")]: f({}, S, `"'"`),
    [n("clean")]: f({ fz_s: S }, S,
      `join(map(chars(lower(fz_s)), fz_c => if fz_c == ${n("apos")}() then '' else ${n("fold")}(fz_c)), '')`),
    [n("fold")]: f({ fz_c: S }, S,
      `let fz_i = index_of(${lit(ENGINE_TABLE.from)}, fz_c) in if fz_i < 0 then fz_c else ` +
      `let fz_t = substr(${lit(ENGINE_TABLE.to)}, fz_i, fz_i + 1) in ` +
      `if fz_t == '!' then '' else if fz_t == '*' then get_or(map_of([${ENGINE_TABLE.multi.map(([k, v]) => `[${lit(k)}, ${lit(v)}]`).join(', ')}]), fz_c, fz_c) else fz_t`),
    [n("stem")]: f({ fz_w: S }, S,
      `let fz_a = if len(fz_w) > 3 and ends_with(fz_w, 's') and not (ends_with(fz_w, 'ss') or ends_with(fz_w, 'is') or (ends_with(fz_w, 'us') and len(fz_w) > 4)) then substr(fz_w, 0, len(fz_w) - 1) else fz_w in ` +
      `let fz_n = len(fz_a) in ` +
      `if fz_n > 3 and (ends_with(fz_a, 'xe') or ends_with(fz_a, 'she') or ends_with(fz_a, 'che') or ends_with(fz_a, 'sse')) then substr(fz_a, 0, fz_n - 1) ` +
      `else if fz_n > 3 and ends_with(fz_a, 'ie') then concat(substr(fz_a, 0, fz_n - 2), 'y') ` +
      `else if fz_n > 4 and (ends_with(fz_a, 've') or ends_with(fz_a, 'fe')) then concat(substr(fz_a, 0, fz_n - 2), 'f') ` +
      `else if fz_n > 5 and ends_with(fz_a, 'oe') then substr(fz_a, 0, fz_n - 1) ` +
      `else fz_a`),
    [n("words")]: f({ fz_s: S }, 'list<string>',
      `let fz_t = map(filter(split(${n("clean")}(fz_s), ' '), fz_x => fz_x != ''), fz_x => ${n("num")}(fz_x)) in ` +
      `map(if len(fz_t) > 1 and contains([${ARTICLES.map(lit).join(', ')}], first(fz_t)) then drop(fz_t, 1) else fz_t, fz_x => ${n("stem")}(fz_x))`),
    [n("num")]: f({ fz_x: S }, S,
      `let fz_i = index_of([${[...NUMBER_WORDS.keys()].map(lit).join(', ')}], fz_x) in if fz_i < 0 then fz_x else str(fz_i)`),
    [n("key")]: f({ fz_s: S }, S, `join(${n("words")}(fz_s), ' ')`),
    [n("row")]: f({ fz_pp: 'list<int>', fz_p: 'list<int>', fz_b: 'list<string>', fz_c: S, fz_cp: S, fz_i: 'int' }, 'list<int>',
      `fold(range(1, len(fz_b) + 1), [fz_i], (fz_r, fz_j) => push(fz_r, ` +
      `let fz_bj = get_or(fz_b, fz_j - 1, '') in ` +
      `let fz_v = min(get_or(fz_p, fz_j, 0) + 1, last(fz_r) + 1, get_or(fz_p, fz_j - 1, 0) + (if fz_c == fz_bj then 0 else 1)) in ` +
      `if fz_i > 1 and fz_j > 1 and fz_c == get_or(fz_b, fz_j - 2, '') and fz_cp == fz_bj then min(fz_v, get_or(fz_pp, fz_j - 2, 0) + 1) else fz_v))`),
    [n("dist")]: f({ fz_a: S, fz_b: S }, 'int',
      `let fz_x = chars(fz_a) in let fz_y = chars(fz_b) in ` +
      `if len(fz_x) == 0 then len(fz_y) else if len(fz_y) == 0 then len(fz_x) else ` +
      `last(fold(range(len(fz_x)), {pp: range(len(fz_y) + 1), p: range(len(fz_y) + 1)}, (fz_st, fz_k) => ` +
      `{pp: fz_st.p, p: ${n("row")}(fz_st.pp, fz_st.p, fz_y, get_or(fz_x, fz_k, ''), get_or(fz_x, fz_k - 1, ''), fz_k + 1)}).p)`),
    [n("ratio")]: f({ fz_a: S, fz_b: S }, 'float',
      `if len(fz_a) == 0 and len(fz_b) == 0 then 1.0 else 1.0 - (${n("dist")}(fz_a, fz_b) * 1.0) / (max(len(fz_a), len(fz_b)) * 1.0)`),
    [n("uniq")]: f({ fz_w: 'list<string>' }, 'list<string>',
      `sort_by(filter(fz_w, (fz_x, fz_k) => index_of(fz_w, fz_x) == fz_k), fz_x => fz_x)`),
    [n("tset")]: f({ fz_wa: 'list<string>', fz_wb: 'list<string>' }, 'float',
      `let fz_ua = ${n("uniq")}(fz_wa) in let fz_ub = ${n("uniq")}(fz_wb) in ` +
      `let fz_in = filter(fz_ua, fz_x => contains(fz_ub, fz_x)) in ` +
      `${n("ratio")}(join(concat(fz_in, filter(fz_ua, fz_x => not contains(fz_ub, fz_x))), ' '), join(concat(fz_in, filter(fz_ub, fz_x => not contains(fz_ua, fz_x))), ' '))`),
    [n("sound")]: f({ fz_s: S }, S,
      `let fz_c = chars(fz_s) in if len(fz_c) == 0 then '' else ` +
      `fold(drop(fz_c, 1), {o: first(fz_c), d: ${n("code")}(first(fz_c))}, (fz_st, fz_x) => ` +
      `let fz_d = ${n("code")}(fz_x) in {o: if fz_d != fz_st.d and fz_d != '0' then concat(fz_st.o, fz_d) else fz_st.o, d: fz_d}).o`),
    [n("code")]: f({ fz_x: S }, S,
      `let fz_i = index_of(${lit(SOUND_FROM)}, fz_x) in if fz_i >= 0 then substr(${lit(SOUND_TO)}, fz_i, fz_i + 1) else if contains(${lit(SOUND_ZERO)}, fz_x) then '0' else fz_x`),
    [n("score")]: f({ fz_in: S, fz_nm: S }, 'float',
      `let fz_wa = ${n("words")}(fz_in) in let fz_wb = ${n("words")}(fz_nm) in ` +
      `if len(fz_wa) == 0 or len(fz_wb) == 0 then 0.0 else ` +
      `let fz_ca = join(fz_wa, '') in let fz_cb = join(fz_wb, '') in ` +
      `if fz_ca == fz_cb then 1.0 else max(${n("ratio")}(fz_ca, fz_cb), ${n("tset")}(fz_wa, fz_wb))`),
    [n("need")]: f({ fz_nm: S }, 'float',
      `let fz_n = len(join(${n("words")}(fz_nm), '')) in ` +
      `if fz_n <= 4 then 1.0 else if fz_n <= 7 then min(@threshold, 1.0 - 1.0 / (fz_n * 1.0)) else @threshold`),
    [n("passes")]: f({ fz_in: S, fz_nm: S, fz_sc: 'float' }, 'bool',
      `fz_sc >= ${n("need")}(fz_nm) or (@phonetic and fz_sc >= ${PHONETIC_FLOOR.toFixed(1)} and ` +
      `len(join(${n("words")}(fz_nm), '')) >= 5 and ${n("sound")}(join(${n("words")}(fz_in), '')) == ${n("sound")}(join(${n("words")}(fz_nm), '')))`),
    // Best passing score among an entry's names ("answer=alias=alias"), or -1.0.
    [n("entry")]: f({ fz_in: S, fz_e: S }, 'float',
      `fold(split(fz_e, '='), -1.0, (fz_m, fz_nm) => let fz_sc = ${n("score")}(fz_in, fz_nm) in if fz_sc > fz_m and ${n("passes")}(fz_in, fz_nm, fz_sc) then fz_sc else fz_m)`),
    // Index of the best matching entry (highest score, earlier on ties), or -1.
    [n("best")]: f({ fz_in: S, fz_es: 'list<string>' }, 'int',
      `fold(range(len(fz_es)), {i: -1, s: 0.0}, (fz_st, fz_k) => let fz_v = ${n("entry")}(fz_in, get_or(fz_es, fz_k, '')) in if fz_v > fz_st.s then {i: fz_k, s: fz_v} else fz_st).i`),
    [n("ok")]: f({ fz_in: S, fz_e: S }, 'bool', `${n("entry")}(fz_in, fz_e) >= 0.0`),
  };
}
