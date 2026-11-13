// Shared pieces for the harness eval: the suite loader, the Muse client for the judge, and the
// text a game shows (for the keyword pre-check and the judge's evidence). Node only, no packages.
// Never prints or stores the Muse key.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');

// MARK: - Arguments

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) out[k] = v;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

// MARK: - Suite

const SPECIFICITY = new Set(['vague', 'some', 'specific']);

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'entry';
}

/// Loads every suite/*.json (an entry or an array of entries) in the ground-truth shape
/// {request, specificity, must_have, nice_to_have, must_not, feel, who_with}, filling the optional
/// fields: id (from the request), source (from the file name), category, theme_terms, custom_rule.
export function loadSuite(dir = path.join(here, 'suite')) {
  const entries = [];
  const seen = new Set();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const e of Array.isArray(raw) ? raw : [raw]) {
      if (typeof e.request !== 'string' || !e.request.trim()) throw new Error(`${file}: an entry has no request`);
      const entry = {
        id: e.id || slug(e.request),
        source: e.source || path.basename(file, '.json'),
        category: e.category || (e.specificity === 'vague' ? 'vague' : 'uncategorised'),
        request: e.request.trim(),
        specificity: SPECIFICITY.has(e.specificity) ? e.specificity : 'some',
        must_have: e.must_have || [],
        nice_to_have: e.nice_to_have || [],
        must_not: e.must_not || [],
        feel: e.feel || '',
        who_with: e.who_with || '',
        theme_terms: e.theme_terms || [],
        // null = the request has no rule of its own (scored n/a); left out = the judge decides.
        custom_rule: 'custom_rule' in e ? e.custom_rule : undefined,
      };
      if (seen.has(entry.id)) throw new Error(`${file}: duplicate id ${entry.id}`);
      seen.add(entry.id);
      entries.push(entry);
    }
  }
  return entries;
}

export function selectEntries(entries, only) {
  if (!only) return entries;
  const ids = new Set(String(only).split(','));
  return entries.filter((e) => ids.has(e.id) || ids.has(e.category) || ids.has(e.specificity) || ids.has(e.source));
}

// MARK: - Muse (the same API and config file the CLI uses)

export function defaultConfigPath() {
  return process.env.MUSE_CONFIG || path.join(repoRoot, 'FacebookClone/Bubbles/Studio/MuseConfig.json');
}

export function loadMuseConfig(file = defaultConfigPath()) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* fall through to env */ }
  const apiKey = cfg.api_key || process.env.MUSE_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseURL: (cfg.base_url || 'https://api.meta.ai/v1').replace(/\/$/, ''),
    planner: cfg.planner_model || 'muse-wonder-1.0',
    fast: cfg.fast_model || 'muse-ember-1.0',
  };
}

/// One chat call that must return a JSON object. Errors carry the server's message only.
export async function museJSON(config, { model, system, user, maxTokens = 8000, effort = 'medium', timeoutMs = 180000 }) {
  const body = {
    model: model || config.planner,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    max_tokens: maxTokens,
    reasoning_effort: effort,
  };
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`Muse ${res.status}: ${text.slice(0, 200)}`);
        await new Promise((r) => setTimeout(r, 4000 * attempt));
        continue;
      }
      if (!res.ok) throw new Error(`Muse ${res.status}: ${text.slice(0, 300)}`);
      const value = JSON.parse(text);
      const content = value.choices?.[0]?.message?.content || '';
      return { value: extractJSON(content), model: value.model || body.model, usage: value.usage || null };
    } catch (e) {
      lastError = e;
      if (e.name === 'AbortError') continue;
      if (!/^Muse 4/.test(e.message)) continue;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export function extractJSON(text) {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch { /* look for the outer object */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('the judge reply had no JSON object');
}

// MARK: - What a game says and shows

/// Walks an authoring manifest and gathers its text by where it shows up:
/// visible (title, instructions, content, text and emoji on nodes) and internal (art roles,
/// state/event/rule names, fragments, look).
export function gameText(authoring) {
  const visible = [], roles = [], internal = [];
  const meta = authoring.meta || {};
  if (meta.title) visible.push(meta.title);
  if (meta.instructions) visible.push(meta.instructions);
  const walkContent = (v) => {
    if (typeof v === 'string') visible.push(v);
    else if (Array.isArray(v)) v.forEach(walkContent);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { internal.push(k); walkContent(x); });
  };
  walkContent(authoring.content || {});
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, key));
    if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => walk(x, k));
    if (typeof v !== 'string') return;
    if (key === 'role' || key === 'slot') roles.push(v);
    else if (v.startsWith('=')) visible.push(...[...v.matchAll(/'([^']*[A-Za-z][^']*)'/g)].map((m) => m[1]));
    else if (['text', 'emoji', 'label', 'glyph', 'title', 'caption', 'name'].includes(key)) visible.push(v);
  };
  walk(authoring.presentation || {});
  for (const u of authoring.uses || []) {
    internal.push(u.fragment);
    for (const [k, v] of Object.entries(u.params || {})) if (typeof v === 'string' && !/^[$=]/.test(v)) visible.push(v);
  }
  for (const k of ['state', 'events', 'inputs', 'objectives']) internal.push(...Object.keys(authoring[k] || {}));
  for (const r of authoring.rules || []) if (r.id) internal.push(r.id);
  if (authoring.look?.id) internal.push(`look:${authoring.look.id}`);
  internal.push(...Object.keys(authoring.look?.tokens || {}));
  return { visible, roles, internal };
}

/// Keyword hits for an entry's theme terms (words split on _ and - too, so "blaster_bolt" counts).
export function keywordHits(terms, text) {
  const norm = (s) => ` ${String(s).toLowerCase().replace(/[_\-]+/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `;
  const bucket = (list) => norm(list.join(' | '));
  const where = { visible: bucket(text.visible), roles: bucket(text.roles), internal: bucket(text.internal) };
  const hits = {};
  for (const term of terms) {
    const t = norm(term).trim();
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`);
    const found = Object.entries(where).filter(([, s]) => re.test(s)).map(([k]) => k);
    if (found.length) hits[term] = found;
  }
  return hits;
}

export function median(xs) {
  const v = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function mean(xs) {
  const v = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function readJSONIf(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
