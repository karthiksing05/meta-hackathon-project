// The expander: an authoring manifest plus the fragment library → one flat microgame/0.1 game.json,
// a source map, and authoring diagnostics. See authoring/SPEC.md. Deterministic: the same manifest
// and library give the same output.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { rewrite, rewriteType, namesIn, tokenize, stringLiteral, durationMs, safeText, PLACEHOLDER_NAME } from './expr.mjs';
import { compileArt } from './art.mjs';
import { compileSound, MOMENTS } from './sound.mjs';
import { normalizeScore, unknownScoreEvents } from './score.mjs';
import { pickCanvas, fitLayout, safeArea } from './canvas.mjs';

export const STANDARD_TOKENS = ['primary', 'secondary', 'accent', 'ink', 'bg', 'danger', 'surface'];
export const SLOTS = { hud_top: 3, hud_bottom: 2, playfield: Infinity, overlay: Infinity };
const SECTIONS = ['types', 'state', 'functions', 'events', 'inputs'];
const FRAGMENT_FORBIDDEN_OBJECTIVES = ['time_limit', 'on_timeout'];
const NODE_CHILD_KEYS = ['children'];
const NODE_TEMPLATE_KEYS = ['template', 'item', 'cell', 'node'];
const NAME_EXPR_PROPS = ['source', 'key'];
const LITERAL_PLACEHOLDER = new RegExp(`^@${PLACEHOLDER_NAME}$`);
export const FEEL_KEYS = ['particles', 'shake', 'haptics'];

// ---------- library ----------

export function loadLibrary(root) {
  const read = (dir, suffix) => {
    const out = {};
    const path = join(root, dir);
    if (!existsSync(path)) return out;
    for (const f of readdirSync(path).sort()) {
      if (!f.endsWith(suffix)) continue;
      const data = JSON.parse(readFileSync(join(path, f), 'utf8'));
      out[data.fragment ?? data.look] = data;
    }
    return out;
  };
  return { fragments: read('fragments', '.fragment.json'), looks: read('looks', '.look.json') };
}

// ---------- small helpers ----------

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const esc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');
const ptr = (...parts) => parts.map((p) => '/' + esc(p)).join('');

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function didYouMean(name, options) {
  let best = null;
  for (const o of options) {
    const dist = editDistance(name, o);
    if (dist <= Math.max(2, Math.floor(name.length / 3)) && (!best || dist < best.dist)) best = { o, dist };
  }
  return best ? `did you mean '${best.o}'?` : undefined;
}

// Evaluates an `include` condition: params already substituted, so only literals, comparisons,
// and/or/not and parentheses remain (SPEC 1.1).
function evalCondition(text) {
  const toks = tokenize(text).filter((t) => !(t.kind === 'other' && /\s/.test(t.text)));
  // merge two-char operators
  const t = [];
  for (let i = 0; i < toks.length; i++) {
    const a = toks[i], b = toks[i + 1];
    if (a.kind === 'other' && b && b.kind === 'other' && ['==', '!=', '<=', '>='].includes(a.text + b.text)) {
      t.push({ kind: 'op', text: a.text + b.text }); i++;
    } else t.push(a);
  }
  let i = 0;
  const peek = () => t[i];
  const next = () => t[i++];
  const atom = () => {
    const k = next();
    if (!k) throw new Error('unexpected end');
    if (k.text === '(') { const v = or(); next(); return v; }
    if (k.text === '-') return -atom();
    if (k.kind === 'number') return parseFloat(k.text);
    if (k.kind === 'string') return k.text.slice(1, -1);
    if (k.text === 'true') return true;
    if (k.text === 'false') return false;
    throw new Error(`can't read '${k.text}'`);
  };
  const cmp = () => {
    const a = atom();
    const op = peek();
    if (op && (op.kind === 'op' || op.text === '<' || op.text === '>')) {
      next();
      const b = atom();
      switch (op.text) {
        case '==': return a === b; case '!=': return a !== b;
        case '<': return a < b; case '>': return a > b;
        case '<=': return a <= b; case '>=': return a >= b;
      }
    }
    return a;
  };
  const not = () => (peek()?.text === 'not' ? (next(), !not()) : cmp());
  const and = () => { let v = not(); while (peek()?.text === 'and') { next(); const r = not(); v = v && r; } return v; };
  const or = () => { let v = and(); while (peek()?.text === 'or') { next(); const r = and(); v = v || r; } return v; };
  const v = or();
  if (i !== t.length) throw new Error(`unexpected '${t[i].text}'`);
  return Boolean(v);
}

// ---------- params ----------

function checkParam(spec, value) {
  switch (spec.type) {
    case 'int': if (!Number.isInteger(value)) return 'an int'; break;
    case 'float': if (typeof value !== 'number') return 'a number'; break;
    case 'bool': if (typeof value !== 'boolean') return 'true or false'; break;
    case 'duration': if (Number.isNaN(durationMs(value))) return "a duration like '600ms' or '2s'"; break;
    case 'string': if (typeof value !== 'string') return 'a string'; break;
    case 'enum': if (!spec.values.includes(value)) return `one of ${spec.values.join(', ')}`; break;
    case 'color': if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(value)) return 'a #RRGGBB color'; break;
    default: return `a known param type (fragment declares '${spec.type}')`;
  }
  return null;
}

function inRange(spec, value) {
  const v = spec.type === 'duration' ? durationMs(value) : value;
  if (spec.min !== undefined && v < spec.min) return false;
  if (spec.max !== undefined && v > spec.max) return false;
  if (spec.type === 'string' && spec.max_len !== undefined && value.length > spec.max_len) return false;
  return true;
}

function exprText(type, value) {
  switch (type) {
    case 'int': return String(value);
    case 'float': { const s = String(value); return /[.e]/.test(s) ? s : `${s}.0`; }
    case 'bool': return value ? 'true' : 'false';
    case 'duration': return String(durationMs(value));
    case 'string': case 'enum': return stringLiteral(value);
    default: return null;
  }
}

function literalValue(type, value) {
  if (type === 'duration') return `${durationMs(value)}ms`;
  if (type === 'string') return safeText(value);
  return value;
}

// ---------- the walker ----------
// Walks a game-format section and calls fns for each kind of field, rebuilding it.
// fns: { expr(s, at), type(t), name(n, kind), literal(v, at), local(n) }

function walkEffects(list, fns, at) {
  return (list || []).map((e, i) => walkEffect(e, fns, `${at}/${i}`));
}

function walkEffect(e, fns, at) {
  const out = {};
  for (const [k, v] of Object.entries(e)) {
    const here = `${at}/${esc(k)}`;
    switch (k) {
      case 'set': case 'incr': case 'decr': case 'push': case 'remove':
        out[k] = fns.expr(v, here); fns.target?.(v, here); break;
      case 'to': case 'by': case 'value': case 'where': case 'if': case 'for_each': case 'after':
        out[k] = fns.expr(v, here); break;
      case 'let':
        out[k] = Object.fromEntries(Object.entries(v).map(([n, x]) => [n, fns.expr(x, `${here}/${esc(n)}`)])); break;
      case 'then': case 'else': case 'do':
        out[k] = walkEffects(v, fns, here); break;
      case 'emit':
        out[k] = fns.name(v, 'event'); break;
      case 'with':
        out[k] = Object.fromEntries(Object.entries(v).map(([n, x]) => [n, fns.expr(x, `${here}/${esc(n)}`)])); break;
      case 'id': case 'cancel':
        out[k] = fns.name(v, 'timer'); break;
      case 'end':
        out[k] = fns.literal(v, here); break;
      default:
        out[k] = fns.literal(v, here);
    }
  }
  return out;
}

function walkSection(section, value, fns, at) {
  const out = {};
  switch (section) {
    case 'types':
      for (const [n, rec] of Object.entries(value)) out[fns.name(n, 'type')] = fns.type(rec);
      return out;
    case 'state':
      for (const [n, s] of Object.entries(value)) {
        out[fns.name(n, 'state')] = { ...s, type: fns.type(s.type), init: fns.expr(s.init, `${at}/${esc(n)}/init`) };
      }
      return out;
    case 'functions':
      for (const [n, f] of Object.entries(value)) {
        out[fns.name(n, 'function')] = {
          ...f,
          params: Object.fromEntries(Object.entries(f.params || {}).map(([p, t]) => [p, fns.type(t)])),
          returns: fns.type(f.returns),
          body: fns.expr(f.body, `${at}/${esc(n)}/body`),
        };
      }
      return out;
    case 'events':
      for (const [n, payload] of Object.entries(value)) out[fns.name(n, 'event')] = fns.type(payload || {});
      return out;
    case 'inputs':
      for (const [n, inp] of Object.entries(value)) {
        const o = { ...inp };
        if (inp.payload) o.payload = fns.type(inp.payload);
        if (inp.when !== undefined) o.when = fns.expr(inp.when, `${at}/${esc(n)}/when`);
        if (inp.from) {
          o.from = inp.from.map((src, i) => ({
            ...Object.fromEntries(Object.entries(src).map(([k, v]) => [k, k === 'with' ? v : fns.literal(v, `${at}/${esc(n)}/from/${i}/${esc(k)}`)])),
            ...(src.with ? { with: Object.fromEntries(Object.entries(src.with).map(([p, x]) => [p, fns.expr(x, `${at}/${esc(n)}/from/${i}/with/${esc(p)}`)])) } : {}),
          }));
        }
        out[fns.name(n, 'input')] = o;
      }
      return out;
  }
  throw new Error(`unknown section ${section}`);
}

function walkRule(rule, fns, at) {
  const out = {};
  for (const [k, v] of Object.entries(rule)) {
    if (k === 'id') out.id = fns.name(v, 'rule');
    else if (k === 'on') {
      if (typeof v === 'string') out.on = ['start', 'tick'].includes(v) ? v : fns.name(v, 'event_or_input');
      else out.on = Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, fns.literal(vv, `${at}/on/${esc(kk)}`)]));
    } else if (k === 'when') out.when = fns.expr(v, `${at}/when`);
    else if (k === 'do') out.do = walkEffects(v, fns, `${at}/do`);
    else out[k] = v;
  }
  return out;
}

function walkNode(node, fns, at) {
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    const here = `${at}/${esc(k)}`;
    if (NODE_CHILD_KEYS.includes(k)) out[k] = v.map((c, i) => (c.slot ? c : walkNode(c, fns, `${here}/${i}`)));
    else if (NODE_TEMPLATE_KEYS.includes(k) && v && typeof v === 'object') out[k] = walkNode(v, fns, here);
    else if (k === 'node' || k === 'as' || k === 'anchor' || k === 'dir' || k === 'align' || k === 'valign') out[k] = v;
    else if (NAME_EXPR_PROPS.includes(k)) out[k] = fns.expr(v, here);
    else if (k === 'on_tap' || k === 'on_drag') {
      out[k] = { ...v, input: fns.name(v.input, 'input') };
      if (v.with) out[k].with = Object.fromEntries(Object.entries(v.with).map(([p, x]) => [p, fns.expr(x, `${here}/with/${esc(p)}`)]));
    } else if (k === 'animate_on') {
      out[k] = Object.fromEntries(Object.entries(v).map(([ev, a]) => [
        ['win', 'lose'].includes(ev) ? ev : fns.name(ev, 'event_or_input'),
        { ...a, ...(a.when !== undefined ? { when: fns.expr(a.when, `${here}/${esc(ev)}/when`) } : {}) },
      ]));
    } else if (k === 'transition') out[k] = v;
    else if (k === 'role') { if (fns.role) fns.role(v, here); if (fns.keepRole) out[k] = v; }
    else out[k] = presentationValue(v, fns, here);
  }
  return out;
}

function presentationValue(v, fns, at) {
  if (typeof v === 'string' && v.startsWith('=')) return '= ' + fns.expr(v.slice(1).trimStart(), at);
  if (typeof v === 'string' && v.startsWith('$')) { fns.token?.(v, at); return v; }
  return fns.literal(v, at);
}

function walkFeedback(list, fns, at) {
  return (list || []).map((f, i) => ({
    ...f,
    on: ['win', 'lose'].includes(f.on) ? f.on : fns.name(f.on, 'event_or_input'),
    ...(f.when !== undefined ? { when: fns.expr(f.when, `${at}/${i}/when`) } : {}),
    do: (f.do || []).map((d, j) => Object.fromEntries(Object.entries(d).map(([kind, body]) => [
      kind,
      body && typeof body === 'object'
        ? Object.fromEntries(Object.entries(body).map(([p, x]) => [p, presentationValue(x, fns, `${at}/${i}/do/${j}/${kind}/${esc(p)}`)]))
        : body,
    ]))),
  }));
}

// Every timer id a fragment declares, from `after.id`.
function timerIds(rules) {
  const ids = new Set();
  const visit = (effs) => (effs || []).forEach((e) => {
    if (e.after !== undefined && e.id) ids.add(e.id);
    visit(e.then); visit(e.else); visit(e.do);
  });
  (rules || []).forEach((r) => visit(r.do));
  return ids;
}

const s_isEvent = (declared, n) => declared.get(n) === 'events';

// ---------- expansion ----------

export function expand(manifest, lib, options = {}) {
  const diags = [];
  const err = (code, at, message, extra = {}) => diags.push({ code, severity: 'error', at, message, ...extra });
  const warn = (code, at, message, extra = {}) => diags.push({ code, severity: 'warning', at, message, ...extra });
  const sourceMap = [];
  const map = (out, origin, pointer, extra) => sourceMap.push({ out, origin, pointer, ...extra });

  const lookId = manifest.look?.id ?? 'paper';
  const look = lib.looks[lookId];
  if (!look) err('A_UNKNOWN_LOOK', '/look/id', `no look named '${lookId}'`, { hint: didYouMean(lookId, Object.keys(lib.looks)) });
  // 360 × 640 unless the manifest (look.canvas) or the caller (options.canvas) asks for "tall" (360 × 780,
  // canvas.mjs): then the look's HUD moves into the tall canvas's HUD bands.
  const canvas = pickCanvas(manifest.look?.canvas ?? options.canvas, look);
  const safe = safeArea(canvas);

  // ---- art, sound and feel (SPEC 2.8–2.10) ----
  const art = compileArt(manifest.art, canvas, err);
  const sound = compileSound(manifest.sound, err, warn);
  const feel = Object.fromEntries(FEEL_KEYS.map((k) => [k, true]));
  if (manifest.feel !== undefined) {
    if (!manifest.feel || typeof manifest.feel !== 'object' || Array.isArray(manifest.feel)) err('A_FEEL_FIELD', '/feel', 'feel is an object like {"shake": false}');
    else for (const [k, v] of Object.entries(manifest.feel)) {
      if (!FEEL_KEYS.includes(k)) err('A_FEEL_FIELD', `/feel/${esc(k)}`, `feel has no '${k}' (${FEEL_KEYS.join(', ')})`);
      else if (typeof v !== 'boolean') err('A_FEEL_FIELD', `/feel/${esc(k)}`, `feel.${k} is true or false`);
      else feel[k] = v;
    }
  }
  const usedSprites = new Set();

  const gameObjectives = manifest.objectives || {};
  const durationFromLimit = gameObjectives.time_limit !== undefined ? durationMs(gameObjectives.time_limit) : NaN;
  const gameParams = {
    'game.duration_ms': { type: 'int', value: Number.isNaN(durationFromLimit) ? Math.round((manifest.meta?.duration_s ?? 60) * 1000) : durationFromLimit },
    'game.canvas_w': { type: 'int', value: canvas.w },
    'game.canvas_h': { type: 'int', value: canvas.h },
    'game.safe_top': { type: 'int', value: safe.y0 },
    'game.safe_bottom': { type: 'int', value: safe.y1 },
  };

  // Names the game declares itself, plus content state.
  const gameNames = new Set();
  for (const s of SECTIONS) for (const n of Object.keys(manifest[s] || {})) gameNames.add(n);

  // ---- resolve uses ----
  const uses = [];
  const usedIds = new Set();
  const publicOwner = new Map(); // final public name -> use id
  (manifest.uses || []).forEach((use, ui) => {
    const at = `/uses/${ui}`;
    const frag = lib.fragments[use.fragment];
    if (!frag) {
      err('A_UNKNOWN_FRAGMENT', `${at}/fragment`, `no fragment named '${use.fragment}'`, { hint: didYouMean(String(use.fragment), Object.keys(lib.fragments)) });
      return;
    }
    if (use.version !== undefined && use.version !== frag.version) {
      err('A_FRAGMENT_VERSION', `${at}/version`, `the library has ${use.fragment} version ${frag.version}, not ${use.version}`);
    }
    let id = use.id ?? use.fragment;
    if (usedIds.has(id)) { let n = 2; while (usedIds.has(`${id}_${n}`)) n++; id = `${id}_${n}`; }
    usedIds.add(id);

    // params
    const params = {};
    let paramsOk = true;
    for (const name of Object.keys(use.params || {})) {
      if (!frag.params?.[name]) {
        err('A_UNKNOWN_PARAM', `${at}/params/${esc(name)}`, `${use.fragment} has no param '${name}'`, { hint: didYouMean(name, Object.keys(frag.params || {})) });
        paramsOk = false;
      }
    }
    for (const [name, spec] of Object.entries(frag.params || {})) {
      let value = use.params?.[name];
      const fromDefault = value === undefined;
      if (fromDefault) value = spec.default;
      if (typeof value === 'string' && value.startsWith('@game.')) value = gameParams[value.slice(1)]?.value ?? value;
      const problem = checkParam(spec, value);
      if (problem) {
        err('A_PARAM_TYPE', fromDefault ? `${at}/fragment` : `${at}/params/${esc(name)}`, `${use.fragment}.${name} must be ${problem}`);
        paramsOk = false; continue;
      }
      if (!inRange(spec, value)) {
        const lo = spec.min ?? '', hi = spec.max ?? spec.max_len ?? '';
        err('A_PARAM_RANGE', fromDefault ? `${at}/fragment` : `${at}/params/${esc(name)}`, `${use.fragment}.${name} = ${JSON.stringify(value)} is outside ${lo}..${hi}`);
        paramsOk = false; continue;
      }
      params[name] = { type: spec.type, value };
    }
    for (const [k, v] of Object.entries(gameParams)) params[k] = v;

    // Sprite roles (SPEC 1.7): `use.art` maps a role the fragment draws to one of the game's
    // sprites (default: the sprite with the role's own name), or to false for the fallback shape.
    const roles = frag.art || {};
    const artMap = use.art ?? {};
    if (typeof artMap !== 'object' || Array.isArray(artMap)) err('A_ART_FIELD', `${at}/art`, 'a use\'s art maps a role to a sprite name: {"hazard": "fogbank"}');
    else for (const [role, name] of Object.entries(artMap)) {
      const here = `${at}/art/${esc(role)}`;
      if (!roles[role]) err('A_UNKNOWN_ART_ROLE', here, `${use.fragment} draws no '${role}'`, { hint: Object.keys(roles).length ? `its roles are ${Object.keys(roles).join(', ')}` : `${use.fragment} draws no sprites` });
      else if (name !== false && (typeof name !== 'string' || !art.sprites[name])) err('A_ART_MISSING', here, `there is no sprite named '${name}' in art.sprites`, { hint: didYouMean(String(name), Object.keys(art.sprites)) });
    }
    for (const [role, spec] of Object.entries(roles)) {
      const name = artMap[role] === undefined ? role : artMap[role];
      const sp = typeof name === 'string' ? art.sprites[name] : undefined;
      if (sp) usedSprites.add(name);
      params[`art.${role}`] = { type: 'bool', value: Boolean(sp) };
      params[`art.${role}.id`] = { type: 'string', value: sp?.id ?? '' };
      params[`art.${role}.frames`] = { type: 'int', value: sp?.frames ?? 1 };
      params[`art.${role}.aspect`] = { type: 'float', value: sp?.aspect ?? 1 };
      params[`art.${role}.color`] = { type: 'color', value: sp?.color ?? `$${spec.color ?? 'accent'}` };
    }
    uses.push({ use, ui, at, frag, id, params, paramsOk });
  });

  // ---- rename maps ----
  for (const u of uses) {
    const { frag, use, id } = u;
    const rename = new Map();
    const declared = new Map(); // original name -> kind
    for (const s of SECTIONS) for (const n of Object.keys(frag[s] || {})) declared.set(n, s);
    for (const n of timerIds(frag.rules)) declared.set(n, 'timer');
    for (const r of frag.rules || []) if (r.id) declared.set(r.id, 'rule');
    const bind = use.bind || {};
    const requiredNames = new Set(Object.values(frag.requires || {}).flatMap((m) => Object.keys(m || {})));
    for (const k of Object.keys(bind)) {
      if (!declared.has(k) && !requiredNames.has(k)) err('A_UNKNOWN_BIND', `${u.at}/bind/${esc(k)}`, `${frag.fragment} has no name '${k}' to bind`);
      if (k.startsWith('_')) err('A_UNKNOWN_BIND', `${u.at}/bind/${esc(k)}`, `'${k}' is private to ${frag.fragment}`);
    }
    for (const [n, kind] of declared) {
      if (n.startsWith('_') || kind === 'rule' || kind === 'timer') { rename.set(n, `${id}__${n.replace(/^_+/, '')}`); continue; }
      let final = bind[n] ?? n;
      // An event bound explicitly onto one that already exists joins it: the fragment listens to
      // (and may emit) that event instead of declaring its own. Payloads must match (checked below).
      if (s_isEvent(declared, n) && bind[n] !== undefined && (gameNames.has(final) || publicOwner.has(final))) {
        rename.set(n, final);
        (u.joinedEvents ??= new Map()).set(final, n);
        continue;
      }
      if (gameNames.has(final)) {
        err('A_DUPLICATE_NAME', `${u.at}`, `the game declares '${final}', which ${frag.fragment} also provides`, { hint: `bind it, for example "bind": {"${n}": "${n}_${id}"}, or drop your own '${final}'` });
      } else if (publicOwner.has(final)) {
        let k = 2; while (publicOwner.has(`${final}_${k}`) || gameNames.has(`${final}_${k}`)) k++;
        warn('W_AUTO_RENAMED', `${u.at}`, `'${final}' from ${frag.fragment} is also provided by '${publicOwner.get(final)}', so this use's copy is named '${final}_${k}'`);
        final = `${final}_${k}`;
      }
      publicOwner.set(final, id);
      rename.set(n, final);
    }
    for (const n of requiredNames) rename.set(n, bind[n] ?? n);
    u.rename = rename;
  }

  // ---- transform fragment content ----
  for (const u of uses) {
    const { frag, params, rename, id } = u;
    const origin = `use:${id}`;
    const libErr = (code, at, message) => err(code, at, message, { origin, library: true });
    const paramText = (name) => {
      const p = params[name];
      if (!p) { libErr('A_UNKNOWN_PARAM', '', `${frag.fragment} uses @${name}, which isn't a param${name.startsWith('art.') ? ' (declare the role in the fragment\'s art header)' : ''}`); return '0'; }
      const t = exprText(p.type, p.value);
      if (t === null) { libErr('A_PARAM_PLACEMENT', '', `@${name} (${p.type}) can't go inside an expression`); return '0'; }
      return t;
    };
    const fns = {
      expr: (s, at) => (typeof s === 'string' ? rewrite(s, rename, paramText) : s),
      type: (t) => rewriteType(t, rename),
      name: (n) => (rename.has(n) ? rename.get(n) : n),
      literal: (v) => {
        if (typeof v === 'string' && LITERAL_PLACEHOLDER.test(v)) {
          const p = params[v.slice(1)];
          if (!p) { libErr('A_UNKNOWN_PARAM', '', `${frag.fragment} uses ${v}, which isn't a param`); return v; }
          return literalValue(p.type, p.value);
        }
        return v;
      },
      token: (tok) => {
        const name = tok.slice(1).replace(/\[.*$/, '');
        if (!STANDARD_TOKENS.includes(name)) libErr('A_UNKNOWN_TOKEN', '', `${frag.fragment} uses $${name}; fragments may only use ${STANDARD_TOKENS.map((t) => '$' + t).join(' ')}`);
      },
      keepRole: options.keepRole === true,
    };
    const keep = (item) => {
      if (item?.include === undefined) return true;
      try { return evalCondition(rewrite(item.include, null, paramText)); }
      catch (e) { libErr('A_PARAM_PLACEMENT', '', `${frag.fragment}: can't read include '${item.include}': ${e.message}`); return false; }
    };
    const strip = (item) => { const { include, ...rest } = item; return rest; };
    // `include` also works on any child node and on single feedback actions (SPEC 1.1).
    const pruneNode = (node) => {
      if (!node || typeof node !== 'object') return node;
      const n = strip(node);
      for (const k of NODE_CHILD_KEYS) if (Array.isArray(n[k])) n[k] = n[k].filter((c) => c.slot || keep(c)).map(pruneNode);
      for (const k of NODE_TEMPLATE_KEYS) if (n[k] && typeof n[k] === 'object' && !Array.isArray(n[k])) n[k] = pruneNode(n[k]);
      return n;
    };
    for (const [role, spec] of Object.entries(frag.art || {})) {
      if (!/^[a-z][a-z0-9_]*$/.test(role) || !spec || typeof spec !== 'object') libErr('A_FRAGMENT_FIELD', '', `${frag.fragment}: art role '${role}' needs a lowercase name and an object`);
      else if (spec.color !== undefined && !STANDARD_TOKENS.includes(spec.color)) libErr('A_UNKNOWN_TOKEN', '', `${frag.fragment}: art.${role}.color must be a standard token role`);
    }
    // expression tokens inside expressions too
    const checkTokens = (s) => { if (typeof s === 'string') for (const t of tokenize(s)) if (t.kind === 'token') fns.token(t.text); };
    const exprWithTokens = fns.expr;
    fns.expr = (s, at) => { checkTokens(s); return exprWithTokens(s, at); };

    u.out = {};
    for (const s of SECTIONS) u.out[s] = walkSection(s, frag[s] || {}, fns, `/${s}`);
    u.out.rules = [];
    (frag.rules || []).forEach((r, i) => { if (keep(r)) u.out.rules.push({ rule: walkRule(strip(r), fns, `/rules/${i}`), pointer: `/rules/${i}` }); });
    u.out.objectives = {};
    for (const [k, v] of Object.entries(frag.objectives || {})) {
      if (FRAGMENT_FORBIDDEN_OBJECTIVES.includes(k)) { libErr('A_FRAGMENT_FIELD', '', `${frag.fragment} sets objectives.${k}, which belongs to the game`); continue; }
      const item = typeof v === 'string' ? { expr: v } : v;
      if (keep(item)) u.out.objectives[k] = { expr: fns.expr(item.expr, `/objectives/${k}`), pointer: `/objectives/${esc(k)}` };
    }
    u.out.slots = [];
    (frag.presentation?.slots || []).forEach((e, i) => {
      if (keep(e)) u.out.slots.push({ slot: e.slot, node: walkNode(pruneNode(e.node), fns, `/presentation/slots/${i}/node`), origin, pointer: `/presentation/slots/${i}/node` });
    });
    u.out.feedback = [];
    (frag.presentation?.feedback || []).forEach((f, i) => {
      if (keep(f)) u.out.feedback.push({ item: walkFeedback([{ ...strip(f), do: (f.do || []).filter(keep).map(strip) }], fns, '/presentation/feedback')[0], origin, pointer: `/presentation/feedback/${i}` });
    });
  }

  // ---- the game's own content (not renamed; only checked and collected) ----
  const gameExprs = [];
  const contentWrites = [];
  const gameFns = {
    expr: (s, at) => { if (typeof s === 'string') gameExprs.push({ s, at }); return s; },
    type: (t) => t,
    name: (n) => n,
    literal: (v) => v,
    target: (t, at) => { const head = String(t).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0]; if (head?.startsWith('content_')) contentWrites.push(at); },
    keepRole: options.keepRole === true,
  };
  const game = {};
  for (const s of SECTIONS) game[s] = walkSection(s, manifest[s] || {}, gameFns, `/${s}`);
  const gameRules = (manifest.rules || []).map((r, i) => ({ rule: walkRule(r, gameFns, `/rules/${i}`), pointer: `/rules/${i}` }));
  const gameSlots = (manifest.presentation?.slots || []).map((e, i) => ({ slot: e.slot, node: walkNode(e.node, gameFns, `/presentation/slots/${i}/node`), origin: 'game', pointer: `/presentation/slots/${i}/node` }));
  const gameFeedback = walkFeedback(manifest.presentation?.feedback, gameFns, '/presentation/feedback').map((item, i) => ({ item, origin: 'game', pointer: `/presentation/feedback/${i}` }));
  for (const k of ['win', 'lose', 'score']) if (gameObjectives[k] !== undefined) gameFns.expr(gameObjectives[k], `/objectives/${k}`);
  for (const at of contentWrites) err('A_CONTENT_WRITE', at, 'content is read-only; copy it into your own state first');

  // ---- content → state ----
  const contentState = {};
  const referenced = new Set();
  for (const { s } of gameExprs) for (const n of namesIn(s)) if (n.startsWith('content_')) referenced.add(n.slice('content_'.length));
  for (const key of [...referenced].sort()) {
    const v = manifest.content?.[key];
    if (v === undefined) { err('A_UNKNOWN_CONTENT', '/content', `an expression reads content_${key}, but content has no '${key}'`, { hint: didYouMean(key, Object.keys(manifest.content || {})) }); continue; }
    if (typeof v === 'string') contentState[`content_${key}`] = { type: 'string', init: stringLiteral(v) };
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) contentState[`content_${key}`] = { type: 'list<string>', init: `[${v.map(stringLiteral).join(', ')}]` };
    else err('A_CONTENT_TYPE', `/content/${esc(key)}`, 'content values are a string or a list of strings in v0.1');
  }

  // ---- merge sections ----
  const out = { format: 'microgame/0.2', meta: clone(manifest.meta) };
  map('/meta', 'game', '/meta');
  for (const id of Object.keys(sound.clips.assets)) if (art.assets[id]) err('A_ART_FIELD', ptr('art', 'sprites', id), `'${id}' is the name of a sound clip; rename the sprite`);
  const assets = { ...art.assets, ...sound.clips.assets, ...(sound.music ? { music: sound.music.asset } : {}) };
  if (Object.keys(assets).length) {
    out.assets = assets;
    for (const id of Object.keys(art.assets)) map(ptr('assets', id), 'game', id === 'backdrop' ? '/art/backdrop' : ptr('art', 'sprites', id));
    if (sound.music) map('/assets/music', 'game', '/sound/music');
    for (const id of Object.keys(sound.clips.assets)) map(ptr('assets', id), 'game', ptr('sound', 'clips', id.slice(5)));
  }
  for (const s of SECTIONS) {
    const merged = {};
    for (const u of uses) for (const [n, v] of Object.entries(u.out[s])) { merged[n] = v; map(ptr(s, n), `use:${u.id}`, ptr(s, Object.keys(u.frag[s]).find((o) => u.rename.get(o) === n) ?? n), { fragment: u.frag.fragment, version: u.frag.version }); }
    if (s === 'state') for (const [n, v] of Object.entries(contentState)) { merged[n] = v; map(ptr(s, n), 'game', `/content/${esc(n.slice('content_'.length))}`); }
    for (const [n, v] of Object.entries(game[s])) { merged[n] = v; map(ptr(s, n), 'game', ptr(s, n)); }
    if (Object.keys(merged).length) out[s] = merged;
  }
  out.rules = [];
  for (const u of uses) for (const r of u.out.rules) { map(`/rules/${out.rules.length}`, `use:${u.id}`, r.pointer, { fragment: u.frag.fragment, version: u.frag.version }); out.rules.push(r.rule); }
  for (const r of gameRules) { map(`/rules/${out.rules.length}`, 'game', r.pointer); out.rules.push(r.rule); }

  // ---- requirements and conflicts ----
  const norm = (t) => JSON.stringify(typeof t === 'string' ? t.replace(/\s+/g, '') : t);
  for (const u of uses) {
    for (const [kind, names] of Object.entries(u.frag.requires || {})) {
      const section = { state: 'state', events: 'events', functions: 'functions', inputs: 'inputs', types: 'types' }[kind];
      for (const [n, want] of Object.entries(names || {})) {
        const final = u.rename.get(n) ?? n;
        const have = out[section]?.[final];
        if (!have) {
          err('A_MISSING_REQUIREMENT', u.at, `${u.frag.fragment} needs ${kind.replace(/s$/, '')} '${final}', and nothing declares it`, { hint: kind === 'events' ? `declare "events": {"${final}": {}} and emit it, or bind '${n}' to an event you have` : `declare '${final}' or bind '${n}' to one you have` });
          continue;
        }
        const got = section === 'state' ? have.type : section === 'functions' ? { params: have.params, returns: have.returns } : section === 'inputs' ? have.payload || {} : have;
        if (norm(got) !== norm(want)) err('A_REQUIREMENT_TYPE', u.at, `${u.frag.fragment} needs '${final}' as ${JSON.stringify(want)}, but it is ${JSON.stringify(got)}`);
      }
    }
    for (const [final, original] of u.joinedEvents || []) {
      const mine = rewriteType(u.frag.events[original] || {}, u.rename);
      const owner = (manifest.events || {})[final] ?? uses.find((o) => o !== u && o.out.events[final] && !o.joinedEvents?.has(final))?.out.events[final];
      if (owner && norm(owner) !== norm(mine)) {
        err('A_REQUIREMENT_TYPE', `${u.at}/bind/${esc(original)}`, `${u.frag.fragment}'s '${original}' has payload ${JSON.stringify(mine)}, but '${final}' has ${JSON.stringify(owner)}`);
      }
    }
    for (const c of u.frag.conflicts || []) {
      const other = uses.find((o) => o.frag.fragment === c);
      if (other) err('A_CONFLICT', u.at, `${u.frag.fragment} can't be used with ${c}`);
    }
  }

  // ---- objectives ----
  const objectives = {};
  for (const k of ['win', 'lose']) {
    const parts = [];
    for (const u of uses) if (u.out.objectives[k]) parts.push({ s: u.out.objectives[k].expr, origin: `use:${u.id}`, pointer: u.out.objectives[k].pointer });
    if (gameObjectives[k] !== undefined) parts.push({ s: gameObjectives[k], origin: 'game', pointer: `/objectives/${k}` });
    if (!parts.length) continue;
    if (parts.length === 1) { objectives[k] = parts[0].s; map(`/objectives/${k}`, parts[0].origin, parts[0].pointer); continue; }
    let text = '';
    const segments = [];
    parts.forEach((p, i) => {
      if (i) text += ' or ';
      text += '(';
      segments.push({ start: text.length, end: text.length + p.s.length, origin: p.origin, pointer: p.pointer });
      text += p.s + ')';
    });
    objectives[k] = text;
    map(`/objectives/${k}`, 'mixed', '', { segments });
  }
  const scorers = uses.filter((u) => u.out.objectives.score);
  if (gameObjectives.score !== undefined) { objectives.score = gameObjectives.score; map('/objectives/score', 'game', '/objectives/score'); }
  else if (scorers.length > 1) err('A_CONFLICT', '/uses', `more than one fragment sets the score (${scorers.map((u) => u.id).join(', ')}); set objectives.score yourself`);
  else if (scorers.length === 1) { objectives.score = scorers[0].out.objectives.score.expr; map('/objectives/score', `use:${scorers[0].id}`, '/objectives/score'); }
  for (const k of ['time_limit', 'on_timeout']) if (gameObjectives[k] !== undefined) { objectives[k] = gameObjectives[k]; map(`/objectives/${k}`, 'game', `/objectives/${k}`); }
  out.objectives = objectives;

  // ---- presentation ----
  const slotNodes = Object.fromEntries(Object.keys(SLOTS).map((s) => [s, []]));
  for (const e of [...uses.flatMap((u) => u.out.slots), ...gameSlots]) {
    if (!(e.slot in SLOTS)) {
      const at = e.origin === 'game' ? e.pointer.replace(/\/node$/, '/slot') : '';
      err('A_UNKNOWN_SLOT', at, `no slot named '${e.slot}'`, { hint: didYouMean(String(e.slot), Object.keys(SLOTS)), ...(e.origin === 'game' ? {} : { origin: e.origin, library: true }) });
      continue;
    }
    slotNodes[e.slot].push(e);
  }
  for (const [s, cap] of Object.entries(SLOTS)) {
    if (slotNodes[s].length > cap) err('A_SLOT_FULL', '/presentation/slots', `${s} holds ${cap} nodes; ${slotNodes[s].length} were placed (${slotNodes[s].map((e) => e.origin).join(', ')})`);
  }
  const origins = new WeakMap();
  const splice = (node) => {
    const n = { ...node };
    if (n.children) {
      n.children = n.children.flatMap((c) => {
        if (c.slot) return slotNodes[c.slot]?.map((e) => { const copy = clone(e.node); origins.set(copy, e); return copy; }) ?? [];
        return [splice(c)];
      });
    }
    return n;
  };
  const root = look ? splice(fitLayout(clone(look.layout), canvas)) : { node: 'group', children: [] };
  // The backdrop sits under everything, filling the canvas.
  if (art.backdrop) (root.children ??= []).unshift({ node: 'image', asset: art.backdrop.id, x: 0, y: 0, w: art.backdrop.w, h: art.backdrop.h });
  const font = art.font ?? look?.font;
  const visit = (node, at, inherited) => {
    const e = origins.get(node);
    if (e) map(at, e.origin, e.pointer);
    const from = e ? e : inherited;
    if (node.node === 'text' && font && node.font === undefined) node.font = font;
    for (const k of NODE_CHILD_KEYS) (node[k] || []).forEach((c, i) => visit(c, `${at}/${k}/${i}`, from));
    for (const k of NODE_TEMPLATE_KEYS) if (node[k] && typeof node[k] === 'object') visit(node[k], `${at}/${k}`, from);
  };
  visit(root, '/presentation/root', null);
  map('/presentation/root', `look:${lookId}`, '/layout');
  if (art.backdrop) map('/presentation/root/children/0', 'game', '/art/backdrop');
  const feedback = resolveFeedback([...uses.flatMap((u) => u.out.feedback), ...feelFeedback(canvas), ...gameFeedback], sound, feel, err);
  feedback.forEach((f, i) => map(`/presentation/feedback/${i}`, f.origin, f.pointer));
  const tokens = { ...(look?.tokens || {}), ...art.tokens, ...(manifest.look?.tokens || {}) };
  if (Object.keys(art.tokens).length) map('/presentation/tokens', 'game', '/art/palette');
  out.presentation = {
    canvas: { w: canvas.w, h: canvas.h, background: manifest.look?.background ?? look?.background ?? '$bg' },
    tokens,
    root,
    feedback: feedback.map((f) => f.item),
    ...(sound.music ? { music: sound.music.presentation } : {}),
    // Where the app's text field goes for games with a text input (SPEC 2.2), as written.
    ...(manifest.presentation?.text_field ? { text_field: clone(manifest.presentation.text_field) } : {}),
  };
  if (sound.music) map('/presentation/music', 'game', '/sound/music');

  // Sprites nothing draws are probably a mistake (a role name typo, or a fragment that was dropped).
  for (const e of gameSlots) collectAssetNames(e.node, usedSprites);
  for (const name of Object.keys(art.sprites)) {
    if (!usedSprites.has(name)) warn('W_ART_UNUSED', `/art/sprites/${esc(name)}`, `no fragment or node draws the sprite '${name}'`, { hint: spriteHint(uses) });
  }
  if (!Object.keys(art.tokens).length) map('/presentation/tokens', `look:${lookId}`, '/tokens');
  map('/presentation/canvas', `look:${lookId}`, '/canvas');

  // ---- playtest probe (SPEC 2.6): a copy of the game with hidden values for bots: a progress
  // number, and the strings worth submitting to a text input ----
  let playtestGame;
  const pt = manifest.playtest;
  const textCandidates = pt?.text_candidates ?? pt?.texts; // `texts` is accepted as another name
  if (pt?.progress || textCandidates) {
    playtestGame = clone(out);
    if (textCandidates) {
      playtestGame.state = { ...(playtestGame.state || {}), __text_candidates: { type: 'list<string>', init: '[]' } };
      playtestGame.rules = [...playtestGame.rules, { id: '__text_candidates', on: 'tick', do: [{ set: '__text_candidates', to: textCandidates }] }];
    }
    if (pt.progress) {
      playtestGame.state = { ...(playtestGame.state || {}), __progress: { type: 'float', init: '0.0' } };
      playtestGame.rules = [...playtestGame.rules, { id: '__progress', on: 'tick', do: [{ set: '__progress', to: `${pt.progress} * 1.0` }] }];
    }
  }

  // ---- score model (SPEC 2.13): not part of game.json (the engine's file is strict); returned beside it ----
  const scored = normalizeScore(manifest.score);
  diags.push(...scored.diagnostics);
  for (const name of unknownScoreEvents(scored.score, out)) err('A_SCORE_EVENTS', '/score/events', `score.events names '${name}', which is no event or input in this game`, { hint: didYouMean(name, [...Object.keys(out.events ?? {}), ...Object.keys(out.inputs ?? {})]) });

  return { game: out, sourceMap, diagnostics: diags, playtestGame, score: scored.score, scoreDeclared: scored.declared };
}

// ---------- feel and sound moments (SPEC 2.9, 2.10) ----------

// Game-level feel every game gets: the win and lose stings, confetti and haptics.
function feelFeedback(canvas) {
  const burst = (color, speed) => ({ particles: { x: canvas.w / 2, y: Math.round(canvas.h * 0.42), count: 36, color, speed, size: 7, ms: 1200, gravity: 520 } });
  return [
    { item: { on: 'win', do: [{ moment: 'win' }, burst('$accent', 360), burst('$primary', 280), { haptic: 'success' }] }, origin: 'feel', pointer: '/win' },
    { item: { on: 'lose', do: [{ moment: 'lose' }, { haptic: 'error' }] }, origin: 'feel', pointer: '/lose' },
  ];
}

// Swaps `{ "moment": m }` actions for the game's sound, scales every sound by the game's volume, and
// drops what `feel` turns off. A sound the game itself plays on an event replaces the library's
// moments on that event, and the same moment on the same event plays once.
function resolveFeedback(entries, sound, feel, err) {
  const gameSoundOn = new Set(entries.filter((f) => f.origin === 'game' && f.item.do?.some((a) => a.sound !== undefined || a.moment !== undefined)).map((f) => f.item.on));
  const seen = new Set();
  const out = [];
  for (const f of entries) {
    const actions = [];
    (f.item.do || []).forEach((a, j) => {
      if (a.moment !== undefined) {
        if (!MOMENTS.includes(a.moment)) {
          const extra = f.origin === 'game' ? {} : { origin: f.origin, library: true };
          err('A_SOUND_MOMENT', f.origin === 'game' ? `${f.pointer}/do/${j}/moment` : '', `no sound moment named '${a.moment}'`, { hint: `moments are ${MOMENTS.join(', ')}`, ...extra });
          return;
        }
        if (f.origin !== 'game' && gameSoundOn.has(f.item.on)) return;
        const key = `${f.item.on}|${f.item.when ?? ''}|${a.moment}`;
        if (seen.has(key)) return;
        seen.add(key);
        actions.push(...sound.moment(a.moment));
      } else if (a.sound !== undefined) {
        if (sound.volume > 0) actions.push(sound.scale(a));
      } else if ((a.shake !== undefined && !feel.shake) || (a.particles !== undefined && !feel.particles) || (a.haptic !== undefined && !feel.haptics)) {
        // turned off by the game's feel section
      } else actions.push(a);
    });
    if (actions.length) out.push({ ...f, item: { ...f.item, do: actions } });
  }
  return out;
}

function collectAssetNames(node, into) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.asset === 'string') {
    if (node.asset.startsWith('=')) for (const m of node.asset.matchAll(/'([a-z][a-z0-9_]*)'/g)) into.add(m[1]);
    else into.add(node.asset);
  }
  for (const k of NODE_CHILD_KEYS) (node[k] || []).forEach((c) => collectAssetNames(c, into));
  for (const k of NODE_TEMPLATE_KEYS) if (node[k] && typeof node[k] === 'object') collectAssetNames(node[k], into);
}

function spriteHint(uses) {
  const roles = [...new Set(uses.flatMap((u) => Object.keys(u.frag.art || {}).map((r) => `${r} (${u.frag.fragment})`)))];
  return roles.length ? `the fragments in this game draw: ${roles.join(', ')}; name a sprite after a role, map it with a use's "art", or draw it with your own image node` : 'none of the fragments in this game draw sprites; draw it with your own image node';
}

// ---------- source map ----------

// Moves an engine diagnostic's `at` (and span, for joined objectives) back to where it came from.
// Diagnostics from fragments or looks are library bugs: they go to our log, not to the model.
export function translate(diag, sourceMap) {
  if (!diag.at) return { ...diag, origin: 'game', audience: 'model' };
  let best = null;
  for (const e of sourceMap) {
    if ((diag.at === e.out || diag.at.startsWith(e.out + '/')) && (!best || e.out.length > best.out.length)) best = e;
  }
  if (!best) return { ...diag, origin: 'unknown', audience: 'library' };
  const rest = diag.at.slice(best.out.length);
  if (best.origin === 'mixed') {
    const span = diag.span || [0, 0];
    const seg = best.segments.find((s) => span[0] >= s.start && span[0] <= s.end) || best.segments[0];
    return {
      ...diag,
      at: seg.pointer,
      span: diag.span ? [span[0] - seg.start, span[1] - seg.start] : undefined,
      engine_at: diag.at,
      origin: seg.origin,
      audience: seg.origin === 'game' ? 'model' : 'library',
    };
  }
  return {
    ...diag,
    at: best.pointer + rest,
    engine_at: diag.at,
    origin: best.origin,
    ...(best.fragment ? { fragment: best.fragment, version: best.version } : {}),
    audience: best.origin === 'game' ? 'model' : 'library',
  };
}
