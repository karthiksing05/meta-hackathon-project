// Token-level helpers for microgame/0.1 expression strings (format doc A6).
// The expander never parses expressions into trees: it only needs to find identifiers, `@param`
// placeholders and string literals, so it can rename names and substitute params safely.

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUMBER = /[0-9]+(\.[0-9]+)?([a-z]+)?/y;
const PLACEHOLDER = /@(@|game\.[a-z_]+|[A-Za-z_][A-Za-z0-9_]*)/y;

// Splits an expression into tokens: {kind: 'ident'|'param'|'string'|'number'|'token'|'other', text, start}.
export function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'") {
      let j = src.indexOf("'", i + 1);
      if (j < 0) j = src.length - 1;
      out.push({ kind: 'string', text: src.slice(i, j + 1), start: i });
      i = j + 1;
      continue;
    }
    if (c === '@') {
      PLACEHOLDER.lastIndex = i;
      const m = PLACEHOLDER.exec(src);
      if (m) { out.push({ kind: 'param', text: m[0], name: m[1], start: i }); i += m[0].length; continue; }
    }
    if (c === '$') {
      IDENT.lastIndex = i + 1;
      const m = IDENT.exec(src);
      if (m) { out.push({ kind: 'token', text: '$' + m[0], start: i }); i += 1 + m[0].length; continue; }
    }
    if (/[0-9]/.test(c)) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(src);
      out.push({ kind: 'number', text: m[0], start: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      IDENT.lastIndex = i;
      const m = IDENT.exec(src);
      out.push({ kind: 'ident', text: m[0], start: i });
      i += m[0].length;
      continue;
    }
    out.push({ kind: 'other', text: c, start: i });
    i += 1;
  }
  return out;
}

// True when the identifier at token index k is a name lookup (not `.field`, not a record key `x:`).
function isNameRef(tokens, k) {
  let p = k - 1;
  while (p >= 0 && tokens[p].kind === 'other' && /\s/.test(tokens[p].text)) p--;
  if (p >= 0 && tokens[p].kind === 'other' && tokens[p].text === '.') return false;
  let n = k + 1;
  while (n < tokens.length && tokens[n].kind === 'other' && /\s/.test(tokens[n].text)) n++;
  if (n < tokens.length && tokens[n].kind === 'other' && tokens[n].text === ':') return false;
  return true;
}

// Every identifier used as a name in an expression (for requirement and content detection).
export function namesIn(src) {
  const t = tokenize(src);
  const names = new Set();
  t.forEach((tok, k) => { if (tok.kind === 'ident' && isNameRef(t, k)) names.add(tok.text); });
  return names;
}

// Rewrites an expression: renames identifiers by `rename` (a Map) and replaces `@param` with `paramText(name)`.
export function rewrite(src, rename, paramText) {
  const t = tokenize(src);
  let out = '';
  t.forEach((tok, k) => {
    if (tok.kind === 'ident' && rename && rename.has(tok.text) && isNameRef(t, k)) out += rename.get(tok.text);
    else if (tok.kind === 'param') out += tok.name === '@' ? '@' : paramText(tok.name);
    else out += tok.text;
  });
  return out;
}

// Renames identifiers inside a type string such as "list<Spawn>" or "map<string, int>".
export function rewriteType(type, rename) {
  if (typeof type !== 'string') {
    if (type && typeof type === 'object' && !Array.isArray(type) && !type.enum) {
      return Object.fromEntries(Object.entries(type).map(([k, v]) => [k, rewriteType(v, rename)]));
    }
    return type;
  }
  return type.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (w) => (rename && rename.has(w) ? rename.get(w) : w));
}

// Text that can't break out of a single-quoted engine literal (SPEC 1.6).
export function safeText(s) {
  return String(s).replace(/'/g, '’').replace(/[\u0000-\u001f]/g, ' ');
}

export function stringLiteral(s) {
  return `'${safeText(s)}'`;
}

// Duration strings ("150ms", "2s", 300) to integer milliseconds.
export function durationMs(v) {
  if (typeof v === 'number') return Math.round(v);
  const m = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(ms|s)?\s*$/.exec(String(v));
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  return Math.round(m[2] === 's' ? n * 1000 : n);
}
