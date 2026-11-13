#!/usr/bin/env node
// Checks the game catalog: authoring/catalog/{types,tools,eval}/*.json against schema/*.schema.json.
// No npm dependencies. Usage: node authoring/catalog/check.mjs [--family X] [--json] [--root DIR]
// Exit 1 when there are errors. Warnings never fail the check.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
// --root DIR checks another catalog folder (types/, tools/, eval/) with these schemas, e.g. sample/.
const ROOT = opt('--root') ? path.resolve(opt('--root')) : HERE;
const ONLY_FAMILY = opt('--family');
const AS_JSON = flag('--json');
const DUP_WARN = 0.6;
const DUP_ERROR = 0.8;

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push({ where, msg });
const warn = (where, msg) => warnings.push({ where, msg });

// ---------- a small JSON Schema validator (the subset our schemas use) ----------
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
function validate(schema, value, at, out) {
  if (schema.type) {
    const t = typeOf(value);
    const ok = schema.type === t || (schema.type === 'number' && t === 'integer');
    if (!ok) { out.push(`${at || '(root)'}: expected ${schema.type}, got ${t}`); return; }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    out.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) out.push(`${at}: shorter than ${schema.minLength} characters`);
    if (schema.maxLength != null && value.length > schema.maxLength) out.push(`${at}: longer than ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) out.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) out.push(`${at}: below ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) out.push(`${at}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) out.push(`${at}: needs at least ${schema.minItems} items, has ${value.length}`);
    if (schema.maxItems != null && value.length > schema.maxItems) out.push(`${at}: allows at most ${schema.maxItems} items, has ${value.length}`);
    if (schema.items) value.forEach((v, i) => validate(schema.items, v, `${at}[${i}]`, out));
  }
  if (typeOf(value) === 'object') {
    for (const r of schema.required || []) if (!(r in value)) out.push(`${at ? at + '.' : ''}${r}: required`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      const key = at ? `${at}.${k}` : k;
      if (props[k]) validate(props[k], v, key, out);
      else if (schema.additionalProperties === false) out.push(`${key}: unknown field`);
      else if (typeof schema.additionalProperties === 'object') validate(schema.additionalProperties, v, key, out);
    }
  }
}

// ---------- load ----------
const loadSchema = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'schema', f), 'utf8'));
const TYPE_SCHEMA = loadSchema('game_type.schema.json');
const TOOL_SCHEMA = loadSchema('game_tool.schema.json');
const EVAL_SCHEMA = loadSchema('eval.schema.json');
const CHECKLIST_SCHEMA = loadSchema('checklist.schema.json');
const FAMILIES = TYPE_SCHEMA.properties.family.enum;
const TOOL_STATUSES = TOOL_SCHEMA.properties.status.enum;

if (ONLY_FAMILY && !FAMILIES.includes(ONLY_FAMILY)) {
  console.error(`--family ${ONLY_FAMILY}: not a family. Families: ${FAMILIES.join(', ')}`);
  process.exit(2);
}

function readArrayFiles(dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  const out = [];
  for (const f of fs.readdirSync(full).filter((f) => f.endsWith('.json')).sort()) {
    const rel = `${dir}/${f}`;
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(full, f), 'utf8')); }
    catch (e) { err(rel, `not valid JSON: ${e.message}`); continue; }
    if (!Array.isArray(data)) { err(rel, 'must hold a JSON array'); continue; }
    out.push({ file: rel, stem: f.replace(/\.json$/, ''), items: data });
  }
  return out;
}

const typeFiles = readArrayFiles('types');
const toolFiles = readArrayFiles('tools');
const evalFiles = readArrayFiles('eval');

// ---------- schema + ids ----------
const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const idOwner = new Map(); // id -> "file#index"
const types = [];
const tools = [];

function register(entry, where) {
  if (typeof entry?.id !== 'string') return;
  if (!SNAKE.test(entry.id)) return; // the schema reports it
  const prev = idOwner.get(entry.id);
  if (prev) err(where, `id "${entry.id}" is already used at ${prev}`);
  else idOwner.set(entry.id, where);
}

for (const { file, stem, items } of typeFiles) {
  const stemIsFamily = FAMILIES.includes(stem);
  items.forEach((t, i) => {
    const where = `${file}#${i}${t?.id ? ` (${t.id})` : ''}`;
    const problems = [];
    validate(TYPE_SCHEMA, t, '', problems);
    problems.forEach((p) => err(where, p));
    register(t, where);
    if (stemIsFamily && t?.family && t.family !== stem) err(where, `family "${t.family}" in ${stem}.json; a family file holds only its own family`);
    types.push({ ...t, _where: where, _file: file });
  });
  if (!stemIsFamily && !/^(seed|learned)_/.test(stem)) warn(file, `file name is not a family; family files are types/<family>.json, mixed files start with seed_ or learned_`);
}
for (const { file, items } of toolFiles) {
  items.forEach((t, i) => {
    const where = `${file}#${i}${t?.id ? ` (${t.id})` : ''}`;
    const problems = [];
    validate(TOOL_SCHEMA, t, '', problems);
    problems.forEach((p) => err(where, p));
    register(t, where);
    tools.push({ ...t, _where: where });
  });
}

const typeIds = new Set(types.filter((t) => typeof t.id === 'string').map((t) => t.id));
const toolById = new Map(tools.filter((t) => typeof t.id === 'string').map((t) => [t.id, t]));
const inScope = (t) => !ONLY_FAMILY || t.family === ONLY_FAMILY;

// ---------- per-type checks ----------
const missing = new Map(); // tool id -> [type ids]
for (const t of types) {
  if (Array.isArray(t.example_prompts)) {
    const seen = new Set();
    for (const p of t.example_prompts) {
      const k = String(p).toLowerCase().trim();
      if (seen.has(k)) warn(t._where, `example prompt repeated: "${p}"`);
      seen.add(k);
    }
  }
  if (Array.isArray(t.session_seconds) && t.session_seconds.length === 2 && t.session_seconds[0] > t.session_seconds[1]) {
    err(t._where, 'session_seconds: [min, max] with min <= max');
  }
  if (t.variant_of && !typeIds.has(t.variant_of)) err(t._where, `variant_of "${t.variant_of}" is not a type id`);
  if (t.variant_of === t.id) err(t._where, 'variant_of points at itself');
  for (const field of ['tools', 'engine_gaps']) {
    for (const id of Array.isArray(t[field]) ? t[field] : []) {
      if (typeof id !== 'string') continue;
      if (typeIds.has(id) && !toolById.has(id)) { err(t._where, `${field}: "${id}" is a type id, not a tool id`); continue; }
      if (!toolById.has(id)) {
        if (!missing.has(id)) missing.set(id, new Set());
        if (inScope(t)) missing.get(id).add(t.id);
      }
    }
  }
}

// ---------- eval ----------
let evalCases = 0;
for (const { file, stem, items } of evalFiles) {
  if (ONLY_FAMILY && stem !== ONLY_FAMILY) continue;
  items.forEach((c, i) => {
    const where = `${file}#${i}`;
    const problems = [];
    validate(EVAL_SCHEMA, c, '', problems);
    problems.forEach((p) => err(where, p));
    evalCases++;
    for (const id of Array.isArray(c?.expect) ? c.expect : []) {
      if (!typeIds.has(id)) err(where, `expect "${id}" is not a type id`);
    }
  });
}

// ---------- clarification checklists: checklists/<family>.json, one object per file ----------
const checklistFamilies = new Set();
let checklistCount = 0, checklistSlots = 0;
const checklistDir = path.join(ROOT, 'checklists');
const familyOfType = new Map(types.filter((t) => typeof t.id === 'string').map((t) => [t.id, t.family]));
for (const f of fs.existsSync(checklistDir) ? fs.readdirSync(checklistDir).filter((f) => f.endsWith('.json')).sort() : []) {
  const rel = `checklists/${f}`;
  const stem = f.replace(/\.json$/, '');
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(checklistDir, f), 'utf8')); }
  catch (e) { err(rel, `not valid JSON: ${e.message}`); continue; }
  if (typeOf(data) !== 'object') { err(rel, 'must hold one JSON object {family, checklists}'); continue; }
  const fam = data.family;
  if (typeof fam === 'string') {
    if (!FAMILIES.includes(fam)) err(rel, `family "${fam}" is not a family`);
    else checklistFamilies.add(fam);
    if (fam !== stem) err(rel, `family "${fam}" in ${stem}.json; the file name must be the family`);
  }
  if (ONLY_FAMILY && fam !== ONLY_FAMILY) continue;
  const problems = [];
  validate(CHECKLIST_SCHEMA, data, '', problems);
  problems.forEach((p) => err(rel, p));
  const claimed = new Map(); // applies_to id -> checklist index
  (Array.isArray(data.checklists) ? data.checklists : []).forEach((cl, ci) => {
    const where = `${rel}#${ci}`;
    checklistCount++;
    const applies = Array.isArray(cl?.applies_to) ? cl.applies_to : [];
    if (applies.includes('*') && applies.length > 1) err(where, 'applies_to: "*" stands alone (the family default)');
    for (const id of applies) {
      if (typeof id !== 'string') continue;
      if (claimed.has(id)) err(where, `applies_to "${id}" is already covered by checklist #${claimed.get(id)}`);
      else claimed.set(id, ci);
      if (id === '*') continue;
      if (!familyOfType.has(id)) err(where, `applies_to "${id}" is not a type id`);
      else if (familyOfType.get(id) !== fam) err(where, `applies_to "${id}" is in family ${familyOfType.get(id)}, not ${fam}`);
    }
    const seen = new Set();
    for (const s of Array.isArray(cl?.slots) ? cl.slots : []) {
      checklistSlots++;
      if (typeof s?.id !== 'string') continue;
      if (seen.has(s.id)) err(where, `slot id "${s.id}" is used twice in this checklist`);
      seen.add(s.id);
      if (typeof s.default === 'string' && Array.isArray(s.choices) && !s.choices.some((c) => String(c).toLowerCase() === s.default.toLowerCase())) {
        warn(where, `slot "${s.id}": default "${s.default}" is not one of its choices`);
      }
    }
  });
  if (!claimed.has('*')) warn(rel, 'no family default checklist (applies_to ["*"])');
}
const familiesWithTypes = [...new Set(types.map((t) => t.family).filter((f) => FAMILIES.includes(f)))].sort();
for (const fam of familiesWithTypes) {
  if (ONLY_FAMILY && fam !== ONLY_FAMILY) continue;
  if (!checklistFamilies.has(fam)) warn('checklists', `family ${fam} has types but no checklists/${fam}.json`);
}

// ---------- near-duplicates: character-trigram Jaccard on name + summary + core_loop ----------
const gramIndex = new Map();
function grams(text) {
  const s = ` ${String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const set = new Set();
  for (let i = 0; i + 3 <= s.length; i++) {
    const g = s.slice(i, i + 3);
    let n = gramIndex.get(g);
    if (n === undefined) { n = gramIndex.size; gramIndex.set(g, n); }
    set.add(n);
  }
  return Uint32Array.from(set).sort();
}
function jaccard(a, b) {
  let i = 0, j = 0, inter = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { inter++; i++; j++; }
    else if (a[i] < b[j]) i++;
    else j++;
  }
  return inter / (a.length + b.length - inter || 1);
}
const dupTypes = types.filter((t) => typeof t.id === 'string');
const sigs = dupTypes.map((t) => grams(`${t.name || ''} ${t.summary || ''} ${t.core_loop || ''}`));
const dupPairs = [];
for (let i = 0; i < dupTypes.length; i++) {
  for (let j = i + 1; j < dupTypes.length; j++) {
    const a = dupTypes[i], b = dupTypes[j];
    if (!inScope(a) && !inScope(b)) continue;
    const la = sigs[i].length, lb = sigs[j].length;
    if (Math.min(la, lb) < DUP_WARN * Math.max(la, lb)) continue; // Jaccard can't reach the threshold
    const s = jaccard(sigs[i], sigs[j]);
    if (s < DUP_WARN) continue;
    const variant = a.family === b.family && (a.variant_of === b.id || b.variant_of === a.id);
    const pair = { a: a.id, b: b.id, score: Math.round(s * 1000) / 1000, variant };
    dupPairs.push(pair);
    const msg = `near-duplicate of ${b.id} (${b._where}), trigram Jaccard ${pair.score}`;
    if (s >= DUP_ERROR && !variant) err(a._where, `${msg}; merge them, or mark one "variant_of" the other in the same family`);
    else warn(a._where, msg + (variant ? ' (flagged variant)' : ''));
  }
}

// ---------- summary ----------
const scopedTypes = types.filter(inScope);
const perFamily = {};
for (const t of scopedTypes) if (t.family) perFamily[t.family] = (perFamily[t.family] || 0) + 1;
const toolsByStatus = Object.fromEntries(TOOL_STATUSES.map((s) => [s, 0]));
const toolsByKind = {};
for (const t of tools) {
  if (t.status in toolsByStatus) toolsByStatus[t.status]++;
  if (t.kind) toolsByKind[t.kind] = (toolsByKind[t.kind] || 0) + 1;
}
const missingRanked = [...missing.entries()]
  .filter(([, s]) => s.size > 0)
  .map(([id, s]) => ({ id, wanted_by: s.size, types: [...s].sort() }))
  .sort((x, y) => y.wanted_by - x.wanted_by || x.id.localeCompare(y.id));
for (const m of missingRanked) warn('missing tool', `"${m.id}" wanted by ${m.wanted_by} type(s): ${m.types.slice(0, 6).join(', ')}${m.types.length > 6 ? ', …' : ''}`);
const undefinedExampleTypes = tools.reduce((n, t) => n + (t.example_types || []).filter((id) => !typeIds.has(id)).length, 0);

const summary = {
  scope: ONLY_FAMILY || 'all',
  types_total: scopedTypes.length,
  types_per_family: Object.fromEntries(Object.entries(perFamily).sort()),
  families_with_types: Object.keys(perFamily).length,
  families_total: FAMILIES.length,
  tools_total: tools.length,
  tools_by_status: toolsByStatus,
  tools_by_kind: toolsByKind,
  missing_tools: missingRanked,
  eval_cases: evalCases,
  checklist_families: checklistFamilies.size,
  checklists: checklistCount,
  checklist_slots: checklistSlots,
  near_duplicate_pairs: dupPairs.length,
  tool_example_types_not_defined: undefinedExampleTypes,
  errors: errors.length,
  warnings: warnings.length,
};

if (AS_JSON) {
  process.stdout.write(JSON.stringify({ summary, errors, warnings, near_duplicates: dupPairs }, null, 2) + '\n');
} else {
  for (const e of errors) console.log(`ERROR ${e.where}: ${e.msg}`);
  for (const w of warnings) console.log(`warn  ${w.where}: ${w.msg}`);
  if (errors.length || warnings.length) console.log('');
  const fam = Object.entries(summary.types_per_family).map(([f, n]) => `${f} ${n}`).join(', ') || 'none';
  console.log(`types per family: ${fam}`);
  console.log(`types ${summary.types_total} in ${summary.families_with_types}/${summary.families_total} families · tools ${summary.tools_total} (${TOOL_STATUSES.map((s) => `${s} ${toolsByStatus[s]}`).join(', ')}) · eval cases ${evalCases} · checklists ${checklistCount} (${checklistSlots} slots) in ${checklistFamilies.size} families`);
  const top = missingRanked.slice(0, 15).map((m) => `${m.id} ×${m.wanted_by}`).join(', ');
  console.log(`missing tools: ${missingRanked.length}${top ? ` (${top}${missingRanked.length > 15 ? ', …' : ''})` : ''}`);
  console.log(`near-duplicate pairs ≥ ${DUP_WARN}: ${dupPairs.length} · ${errors.length} error(s), ${warnings.length} warning(s)`);
  console.log(errors.length ? 'FAIL' : 'OK');
}
process.exit(errors.length ? 1 : 0);
