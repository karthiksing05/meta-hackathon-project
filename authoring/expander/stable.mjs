// Makes a game.json (or an authoring manifest) safe to pass through JSON tools that sort object
// keys, such as Swift's JSONValue: the app re-encodes every Bubble manifest with sorted keys before
// the player gets it.
//
// The engine reads key order in two places:
// - a function's `params` are positional. When they aren't already in sorted order, they're renamed
//   `p0_<name>`, `p1_<name>` and so on (zero-padded past 10), in the params and in the body.
// - a state `init` can only read state declared before it. When an init reads state that would sort
//   after it, and that state's init is pure (no state, no randomness: content lists, constants), the
//   dependency's init is inlined, e.g. `pick(content_words)` becomes `pick((['fog', 'hill']))`.
// Renaming is token-level, like the expander's (expr.mjs): names after `.`, record keys and string
// literals are left alone, and `@` placeholders pass through unchanged. Anything else that sorting
// would break is left for the caller to find (validate the key-sorted copy).

import { tokenize, namesIn } from './expr.mjs';

const RANDOM_NAME = /^(random|pick|shuffle|chance|roll|sample)/;

const SECTIONS = ['types', 'state', 'functions', 'events', 'inputs'];

function isNameRef(tokens, k) {
  let p = k - 1;
  while (p >= 0 && tokens[p].kind === 'other' && /\s/.test(tokens[p].text)) p--;
  if (p >= 0 && tokens[p].kind === 'other' && tokens[p].text === '.') return false;
  let n = k + 1;
  while (n < tokens.length && tokens[n].kind === 'other' && /\s/.test(tokens[n].text)) n++;
  if (n < tokens.length && tokens[n].kind === 'other' && tokens[n].text === ':') return false;
  return true;
}

function renameIn(src, rename) {
  if (typeof src !== 'string') return src;
  const t = tokenize(src);
  return t.map((tok, k) => (tok.kind === 'ident' && rename.has(tok.text) && isNameRef(t, k) ? rename.get(tok.text) : tok.text)).join('');
}

/** Inlines pure inits that a later-sorting state would otherwise read before they're set. */
function stateSafe(doc, isRandom) {
  const state = doc.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return { doc, inlined: 0 };
  const order = new Map(Object.keys(state).map((n, i) => [n, i]));
  const pure = (init) => typeof init === 'string' && ![...namesIn(init)].some((n) => order.has(n) || isRandom(n));
  let inlined = 0;
  const out = {};
  for (const [name, decl] of Object.entries(state)) {
    if (decl && typeof decl === 'object' && typeof decl.init === 'string') {
      const deps = [...namesIn(decl.init)].filter((d) => order.has(d) && order.get(d) < order.get(name) && d > name && pure(state[d]?.init));
      if (deps.length) {
        out[name] = { ...decl, init: renameIn(decl.init, new Map(deps.map((d) => [d, `(${state[d].init})`]))) };
        inlined++;
        continue;
      }
    }
    out[name] = decl;
  }
  return inlined ? { doc: { ...doc, state: out }, inlined } : { doc, inlined: 0 };
}

const isSorted = (keys) => keys.every((k, i) => i === 0 || keys[i - 1] < k);

/**
 * Returns {doc, renamed}: a copy of `doc` that survives key sorting (or `doc` itself when nothing
 * needed changing). `renamed` counts the functions and state inits changed. options.isRandom(name)
 * says which builtins are random (default: names starting random, pick, shuffle, chance, roll, sample).
 */
export function sortSafe(input, { isRandom } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { doc: input, renamed: 0 };
  const random = (n) => RANDOM_NAME.test(n) || (isRandom ? isRandom(n) : false);
  const { doc, inlined } = stateSafe(input, random);
  const fns = doc.functions;
  if (!fns || typeof fns !== 'object' || Array.isArray(fns)) return { doc, renamed: inlined };
  const declared = new Set();
  for (const s of SECTIONS) for (const n of Object.keys(doc[s] || {})) declared.add(n);
  let renamed = 0;
  const functions = {};
  for (const [name, f] of Object.entries(fns)) {
    const params = f && typeof f === 'object' && f.params && typeof f.params === 'object' && !Array.isArray(f.params) ? f.params : null;
    const keys = params ? Object.keys(params) : [];
    if (keys.length < 2 || isSorted(keys)) { functions[name] = f; continue; }
    const width = String(keys.length - 1).length;
    let prefix = 'p';
    const names = () => keys.map((k, i) => `${prefix}${String(i).padStart(width, '0')}_${k}`);
    while (names().some((n) => declared.has(n) || keys.includes(n))) prefix += 'p';
    const rename = new Map(keys.map((k, i) => [k, names()[i]]));
    functions[name] = {
      ...f,
      params: Object.fromEntries(keys.map((k) => [rename.get(k), params[k]])),
      ...(typeof f.body === 'string' ? { body: renameIn(f.body, rename) } : {}),
    };
    renamed++;
  }
  return renamed ? { doc: { ...doc, functions }, renamed: renamed + inlined } : { doc, renamed: inlined };
}

/** Recursively sorts object keys, the way Swift's JSONValue writes JSON (for tests). */
export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
