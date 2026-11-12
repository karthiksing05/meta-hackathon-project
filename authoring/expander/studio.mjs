// The authoring layer as Muse Studio uses it in the app: catalog, expand + validate, the bot gate
// and the Bubble wrapper, each taking and returning JSON strings (the gate returns a Promise).
//
// Pure: no disk, no network, no Node APIs. authoring/tools/make-studio-bundle.mjs packs this file
// and its imports into FacebookClone/Bubbles/Studio/web/microgame-studio.js, with the fragment and
// look library, the engine's `catalog --json`, the format rules from SPEC.md and a few example
// manifests as data, and the page installs it as `window.MicrogameStudio`
// (docs/BUBBLES.md 7.12). The Swift side is MicrogameStudio.swift.

import { expand as expandManifest, translate } from './expand.mjs';
import { wrapBubble } from './bubble.mjs';
import { playtestAsync, DEFAULT_BOTS } from '../playtest/gate-async.mjs';
import { sortSafe } from './stable.mjs';

export const STUDIO_API_VERSION = 1;

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const round1 = (x) => Math.round(x * 10) / 10;

// ---------- catalog and prompt text ----------

const SECTIONS = ['types', 'state', 'functions', 'events', 'inputs'];

function paramText(name, p) {
  let t = `${name}: ${p.type}`;
  if (p.type === 'enum' && Array.isArray(p.values)) t += ` (${p.values.join(' | ')})`;
  const range = [];
  if (p.min !== undefined || p.max !== undefined) range.push(`${p.min ?? ''}..${p.max ?? ''}${p.type === 'duration' ? ' ms' : ''}`);
  if (p.max_len !== undefined) range.push(`max ${p.max_len} chars`);
  if (range.length) t += ` [${range.join(', ')}]`;
  if (p.default !== undefined) t += ` = ${JSON.stringify(p.default)}`;
  if (p.describe) t += `: ${p.describe}`;
  return t;
}

function signature(kind, name, decl) {
  if (kind === 'state') return `${name}: ${decl?.type ?? '?'}`;
  if (kind === 'functions') {
    const params = Object.entries(decl?.params ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ');
    return `${name}(${params}) -> ${decl?.returns ?? '?'}`;
  }
  if (kind === 'events' || kind === 'inputs') {
    const payload = decl?.payload ?? (kind === 'events' || kind === 'inputs' ? decl : null);
    const fields = Object.entries(payload ?? {}).filter(([k]) => !['payload', 'from', 'when'].includes(k)).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    return fields.length ? `${name} {${fields.join(', ')}}` : name;
  }
  return name;
}

/** Public names a fragment declares (SPEC 1.2: everything without a leading underscore). */
function provides(frag) {
  const out = {};
  for (const s of SECTIONS) {
    const names = Object.keys(frag[s] || {}).filter((n) => !n.startsWith('_'));
    if (names.length) out[s] = names.map((n) => signature(s, n, frag[s][n]));
  }
  return out;
}

function requires(frag) {
  const out = {};
  for (const [s, decls] of Object.entries(frag.requires || {})) {
    const names = Object.keys(decls || {});
    if (names.length) out[s] = names.map((n) => signature(s, n, s === 'events' || s === 'inputs' ? { payload: decls[n] } : decls[n]));
  }
  return out;
}

function fragmentSummary(frag) {
  const slots = [...new Set((frag.presentation?.slots || []).map((e) => e.slot))];
  return {
    id: frag.fragment,
    version: frag.version ?? 1,
    describe: frag.describe ?? '',
    params: Object.fromEntries(Object.entries(frag.params || {}).map(([k, p]) => [k, p])),
    requires: requires(frag),
    provides: provides(frag),
    slots,
    conflicts: frag.conflicts || [],
    tags: frag.tags || {},
  };
}

function fragmentText(f) {
  const lines = [`- ${f.id} (v${f.version}): ${f.describe}`];
  const params = Object.entries(f.params);
  if (params.length) lines.push(`  params: ${params.map(([k, p]) => paramText(k, p)).join('; ')}`);
  const req = Object.entries(f.requires);
  if (req.length) lines.push(`  requires: ${req.map(([s, v]) => `${s} ${v.join(', ')}`).join('; ')}`);
  const prov = Object.entries(f.provides);
  if (prov.length) lines.push(`  provides: ${prov.map(([s, v]) => `${s} ${v.join(', ')}`).join('; ')}`);
  if (f.slots.length) lines.push(`  draws in: ${f.slots.join(', ')}`);
  if (f.conflicts.length) lines.push(`  conflicts with: ${f.conflicts.join(', ')}`);
  return lines.join('\n');
}

function lookSummary(look) {
  return { id: look.look, version: look.version ?? 1, describe: look.describe ?? '', font: look.font ?? null, tokens: look.tokens || {} };
}

function lookText(l) {
  const tokens = Object.entries(l.tokens).map(([k, v]) => `${k} ${v}`).join(', ');
  return `- ${l.id}: ${l.describe}${l.font ? ` Font ${l.font}.` : ''} Tokens: ${tokens}.`;
}

/** Drops what a game of `format` can't use (entries marked `since` a later version). */
function forFormat(value, version) {
  const newer = (v) => v && typeof v === 'object' && typeof v.since === 'string' && v.since > version;
  if (Array.isArray(value)) return value.filter((v) => !newer(v)).map((v) => forFormat(v, version));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!newer(v)) out[k] = forFormat(v, version);
    return out;
  }
  return value;
}

function engineText(cat, format) {
  const version = String(format || 'microgame/0.1').split('/')[1] || '0.1';
  const c = forFormat(cat, version);
  const j = (v) => JSON.stringify(v);
  const lines = [`Engine ${c.engine_version ?? '?'}; this layer writes ${format}. Only what's listed here is available.`];
  lines.push(`Types: ${(c.types || []).join(', ')}`);
  lines.push(`Operators: ${(c.operators || []).join('  ')}`);
  if (c.constants?.length) lines.push(`Constants: ${c.constants.map((k) => `${k.name}: ${k.type} = ${k.doc}`).join('; ')}`);
  lines.push(`Rule triggers: ${(c.rule_triggers || []).map((t) => `${j(t.on)} (event: ${t.event})`).join('; ')}`);
  lines.push('Builtins:');
  const byCat = new Map();
  for (const b of c.builtins || []) {
    if (!byCat.has(b.category)) byCat.set(b.category, []);
    byCat.get(b.category).push(`${b.doc || b.name}${b.random ? ' [random]' : ''}`);
  }
  for (const [k, docs] of byCat) lines.push(`  ${k}: ${docs.join(' · ')}`);
  lines.push(`Effects: ${(c.effects || []).map((e) => `${j(e.form)}${e.notes ? ` (${e.notes})` : ''}`).join('; ')}`);
  lines.push(`Input sources: ${(c.input_sources || []).map((s) => `${j(s.source)} fires ${s.fires}${s.record ? `, ${s.record}` : ''}`).join('; ')}`);
  if (c.objectives) lines.push(`Objectives: ${j(c.objectives)}`);
  if (c.nodes) lines.push(`Nodes: ${j(c.nodes)}`);
  if (c.feedback) lines.push(`Feedback: ${j(c.feedback)}`);
  if (c.limits?.length) lines.push(`Limits: ${c.limits.map((l) => `${l.name}=${l.value}`).join(', ')}`);
  return lines.join('\n');
}

// ---------- diagnostics ----------

/** A library diagnostic's use (origin `use:<id>`), so the model can be told which fragment can't take its params. */
function useOf(d, manifest) {
  const origin = typeof d.origin === 'string' ? d.origin : '';
  const uses = Array.isArray(manifest?.uses) ? manifest.uses : [];
  if (origin.startsWith('use:')) {
    const id = origin.slice(4);
    // Use ids as the expander assigns them: `id`, else the fragment name, then `<name>_2` and so on.
    const taken = new Set();
    const ids = uses.map((u) => {
      let uid = u?.id ?? u?.fragment;
      if (taken.has(uid)) { let n = 2; while (taken.has(`${uid}_${n}`)) n++; uid = `${uid}_${n}`; }
      taken.add(uid);
      return uid;
    });
    const index = ids.indexOf(id);
    return { id, index, fragment: d.fragment ?? uses[index]?.fragment ?? id.replace(/_\d+$/, '') };
  }
  return null;
}

function finish(d, manifest) {
  const out = {
    severity: d.severity ?? 'error',
    code: d.code ?? 'E_UNKNOWN',
    at: d.at ?? null,
    message: d.message ?? '',
    hint: d.hint ?? null,
    audience: d.audience ?? (d.library ? 'library' : 'model'),
    origin: d.origin ?? (d.library ? 'library' : 'game'),
  };
  if (d.span) out.span = d.span;
  if (d.engine_at) out.engine_at = d.engine_at;
  if (d.fragment) out.fragment = d.fragment;
  if (out.audience === 'library') {
    // SPEC 3: the model only learns that the fragment can't be used with those params.
    const use = useOf(d, manifest);
    if (use) {
      out.use = use.id;
      out.fragment = use.fragment;
      out.model_note = `The fragment '${use.fragment}'${use.index >= 0 ? ` (uses[${use.index}])` : ''} can't be used with these params. Change its params or drop it.`;
    } else {
      out.model_note = out.origin.startsWith('look:')
        ? `The look '${out.origin.slice(5)}' doesn't work for this game. Pick another look.id.`
        : 'Part of the fragment library failed for this combination of fragments and params. Change the params or the fragments.';
    }
  }
  return out;
}

// ---------- input ----------

/** The JSON object in a model reply, tolerating code fences and prose around it; undefined if none. */
function parseLoose(text) {
  const tryParse = (t) => { try { const v = JSON.parse(t); return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined; } catch { return undefined; } };
  const trimmed = String(text).trim();
  let v = tryParse(trimmed);
  if (v !== undefined) return v;
  const fenced = /^```[^\n]*\n([\s\S]*?)```\s*$/.exec(trimmed);
  if (fenced && (v = tryParse(fenced[1])) !== undefined) return v;
  const a = trimmed.indexOf('{'), b = trimmed.lastIndexOf('}');
  return a >= 0 && b > a ? tryParse(trimmed.slice(a, b + 1)) : undefined;
}

/** The authoring manifest inside a Bubble wrapper (SPEC 2.7) or a reply that nests it ({"manifest": {...}}). */
function unwrap(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  if (v.formula === 'microgame') return v.content?.authoring ?? v.game ?? v;
  if (v.uses !== undefined || v.authoring !== undefined) return v;
  for (const k of ['manifest', 'authoring_manifest', 'microgame', 'game']) {
    if (v[k] && typeof v[k] === 'object' && v[k].uses !== undefined) return v[k];
  }
  const vals = Object.values(v);
  if (vals.length === 1 && vals[0] && typeof vals[0] === 'object' && vals[0].uses !== undefined) return vals[0];
  return v;
}

// ---------- the API ----------

/**
 * data: {library: {fragments, looks}, engineCatalog, formatRules, examples: [{name, manifest}], build}
 * getEngine(): the engine (`BubbleMicrogame.getEngine()`), or null with engineError() saying why.
 */
export function createStudio(data, { getEngine, engineError = () => null } = {}) {
  const { library, engineCatalog = {}, formatRules = '', examples = [], build = {} } = data;
  let catalogCache = null;
  const randomBuiltins = new Set((engineCatalog.builtins || []).filter((b) => b.random).map((b) => b.name));
  const safe = (doc) => sortSafe(doc, { isRandom: (n) => randomBuiltins.has(n) });

  const engine = () => {
    const e = getEngine ? getEngine() : null;
    if (!e) throw new Error(`microgame engine unavailable: ${engineError() || 'not loaded'}`);
    return e;
  };

  function writtenFormat() {
    try {
      const m = examples[0]?.manifest;
      if (m) return expandManifest(m, library).game?.format ?? 'microgame/0.1';
    } catch { /* fall through */ }
    return 'microgame/0.1';
  }

  function catalog() {
    if (catalogCache) return catalogCache;
    const fragments = Object.values(library.fragments).map(fragmentSummary).sort((a, b) => a.id.localeCompare(b.id));
    const looks = Object.values(library.looks).map(lookSummary).sort((a, b) => a.id.localeCompare(b.id));
    const format = writtenFormat();
    const value = {
      api_version: STUDIO_API_VERSION,
      authoring_format: 'microgame-authoring/0.1',
      game_format: format,
      build,
      fragments,
      looks,
      engine: engineCatalog,
      format_rules: formatRules,
      examples,
      bots: DEFAULT_BOTS,
      prompt: {
        fragments: fragments.map(fragmentText).join('\n'),
        looks: looks.map(lookText).join('\n'),
        engine: engineText(engineCatalog, format),
        format: formatRules,
        examples: examples.map((e) => `### ${e.name}\n${JSON.stringify(e.manifest)}`).join('\n\n'),
      },
    };
    catalogCache = JSON.stringify(value);
    return catalogCache;
  }

  /**
   * Mirrors cli.mjs expandAndValidate: expander diagnostics, then engine diagnostics mapped to the
   * manifest. Takes the manifest as JSON text (a model reply: code fences and stray prose around the
   * object are fine) or as an object. The manifest and the games it returns are sort-safe
   * (stable.mjs), because the app re-encodes JSON with sorted keys.
   */
  function expand(manifestJSON) {
    const t0 = now();
    const fail = (code, message) => JSON.stringify({ ok: false, authoring: null, game: null, playtest_game: null, diagnostics: [finish({ code, at: '', message })], ms: { expand: round1(now() - t0), validate: 0 } });
    let input = manifestJSON;
    if (typeof manifestJSON === 'string') {
      input = parseLoose(manifestJSON);
      if (input === undefined) return fail('A_JSON', 'the reply is not a JSON object');
    }
    let manifest = unwrap(input);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return fail('A_MALFORMED', 'the authoring manifest must be a JSON object');
    manifest = safe(manifest).doc;
    let result;
    try {
      result = expandManifest(manifest, library);
    } catch (e) {
      // The expander assumes the manifest's basic shape; anything it trips over is the model's to fix.
      return fail('A_MALFORMED', `the manifest has the wrong shape somewhere (${e?.message ?? e}). Check that uses is a list of {fragment, params, bind}, that rules is a list, and that every section matches the format.`);
    }
    const t1 = now();
    const diagnostics = result.diagnostics.map((d) => finish({ ...d, audience: d.library ? 'library' : 'model', origin: d.origin ?? (d.library ? 'library' : 'game') }, manifest));
    let game = result.game;
    let playtestGame = result.playtestGame ?? null;
    let validateMs = 0;
    if (!diagnostics.some((d) => d.severity === 'error')) {
      const e = engine();
      diagnostics.push(...e.validate(JSON.stringify(game)).map((d) => finish(translate(d, result.sourceMap), manifest)));
      // The playtest copy adds the model's own `playtest.progress` expression: check it too.
      if (playtestGame && !diagnostics.some((d) => d.severity === 'error')) {
        const rules = playtestGame.rules?.length ?? 0;
        for (const d of e.validate(JSON.stringify(playtestGame))) {
          if (d.at && (d.at.startsWith(`/rules/${rules - 1}`) || d.at.startsWith('/state/__progress'))) {
            diagnostics.push(finish({ ...d, at: '/playtest/progress', engine_at: d.at, span: undefined, origin: 'game', audience: 'model' }, manifest));
          }
        }
      }
      // Games travel as JSON text (game_json below, content.game_json in the Bubble), so key order
      // survives the app's sorted-key JSONValue. Sort-safety (stable.mjs) stays as a second line of
      // defense for anything that still handles the game as an object.
      if (!diagnostics.some((d) => d.severity === 'error')) {
        game = safe(game).doc;
        if (playtestGame) playtestGame = safe(playtestGame).doc;
      }
      validateMs = now() - t1;
    }
    const ok = !diagnostics.some((d) => d.severity === 'error');
    return JSON.stringify({
      ok,
      authoring: manifest,
      game,
      playtest_game: playtestGame,
      // Exact text, for callers whose JSON types reorder keys (Swift): pass these back to gate/wrap.
      authoring_json: JSON.stringify(manifest),
      game_json: game ? JSON.stringify(game) : null,
      playtest_game_json: playtestGame ? JSON.stringify(playtestGame) : game ? JSON.stringify(game) : null,
      diagnostics,
      ms: { expand: round1(t1 - t0), validate: round1(validateMs) },
    });
  }

  /** Plays the (playtest) game with the five bots, one after another. Resolves to a JSON string. */
  async function gate(gameJSON, seed = 1, optionsJSON) {
    const options = optionsJSON ? (typeof optionsJSON === 'string' ? JSON.parse(optionsJSON) : optionsJSON) : {};
    const e = engine();
    const json = typeof gameJSON === 'string' ? gameJSON : JSON.stringify(gameJSON);
    const maxSeconds = options.max_seconds ?? 180;
    const res = await playtestAsync(e, json, { seed: Number(seed) || 1, maxSeconds, ...(options.slice_ms ? { sliceMs: options.slice_ms } : {}) });
    return JSON.stringify({
      passed: res.passed,
      summary: res.summary,
      max_seconds: maxSeconds,
      ms: res.ms,
      flags: res.flags,
      runs: res.runs.map((r) => ({
        bot: { label: r.bot.label, skill: r.bot.skill, bot_seed: r.bot.botSeed, seed_offset: r.bot.seedOffset },
        ok: r.ok,
        error: r.error,
        outcome: r.outcome,
        score: r.score,
        seconds: round1(r.seconds),
        ms: r.ms,
        seed: r.replay.seed,
        inputs: r.replay.actions.length,
      })),
    });
  }

  /**
   * opts: {id, game, authoring?, title?, oneLineRule?, emoji?, brief?, style?, seed?, lineage?} (bubble.mjs).
   * Pins each use's fragment version in the stored authoring manifest (SPEC 2.1), so the Bubble
   * expands the same way after the library moves on.
   */
  function wrap(optsJSON) {
    const opts = typeof optsJSON === 'string' ? JSON.parse(optsJSON) : { ...optsJSON };
    // game_json / authoring_json (exact text from expand) win over objects, whose key order a
    // caller may have changed.
    if (typeof opts.game_json === 'string') { opts.game = JSON.parse(opts.game_json); delete opts.game_json; }
    if (typeof opts.authoring_json === 'string') { opts.authoring = JSON.parse(opts.authoring_json); delete opts.authoring_json; }
    if (opts.authoring && Array.isArray(opts.authoring.uses)) {
      opts.authoring = {
        ...opts.authoring,
        uses: opts.authoring.uses.map((u) => (u && u.version === undefined && library.fragments[u.fragment]
          ? { ...u, version: library.fragments[u.fragment].version ?? 1 } : u)),
      };
    }
    for (const k of ['oneLineRule', 'title', 'emoji']) if (opts[k] === null) delete opts[k];
    if (opts.one_line_rule && !opts.oneLineRule) opts.oneLineRule = opts.one_line_rule;
    return JSON.stringify(wrapBubble(opts));
  }

  return Object.freeze({ version: STUDIO_API_VERSION, build, catalog, expand, gate, wrap });
}
