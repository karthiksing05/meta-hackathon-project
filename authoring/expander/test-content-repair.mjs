#!/usr/bin/env node
// Tests for content-repair.mjs: A_UNKNOWN_CONTENT fixed in code before Muse is asked (Prod 2026-11-13: Muse repeated
// "reads content_words, but content has no 'words'" for three repair rounds in two jobs).
//
//   node authoring/expander/test-content-repair.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, loadLibrary } from './expand.mjs';
import { missingContentKeys, repairContent, similarKey } from './content-repair.mjs';
import { diagnosticLine } from './prompts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = loadLibrary(root);
let failed = 0, passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log(`FAIL ${msg}`); } };

const gold = JSON.parse(readFileSync(join(root, 'games', 'gold_the_podium.authoring.json'), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const errorsOf = (m) => expand(m, lib).diagnostics.filter((d) => d.severity === 'error');
const fixAndExpand = (m, opts) => {
  const keys = missingContentKeys(errorsOf(m));
  const r = repairContent(m, keys, opts);
  return { ...r, keys, errors: errorsOf(r.manifest) };
};

ok(errorsOf(gold).length === 0, 'the gold story quiz expands');

// The diagnostics name the missing keys.
{
  const m = clone(gold);
  delete m.content.lines;
  const keys = missingContentKeys(errorsOf(m));
  ok(keys.length === 1 && keys[0] === 'lines', `the missing key is read from A_UNKNOWN_CONTENT (${keys})`);
  const line = diagnosticLine(errorsOf(m).find((d) => d.code === 'A_UNKNOWN_CONTENT'));
  ok(/top level of "content"/.test(line) && /without the content_ prefix/.test(line), 'the repair line carries the A_UNKNOWN_CONTENT hint');
}

// moved: the prefix written into the key.
{
  const m = clone(gold);
  m.content.content_lines = m.content.lines;
  delete m.content.lines;
  const r = fixAndExpand(m);
  ok(r.fixes[0]?.kind === 'moved' && r.errors.length === 0 && Array.isArray(r.manifest.content.lines) && !r.manifest.content.content_lines, `moved: content.content_lines becomes content.lines (${JSON.stringify(r.fixes)})`);
}

// hoisted: one level down.
{
  const m = clone(gold);
  m.content.lists = { lines: m.content.lines };
  delete m.content.lines;
  const r = fixAndExpand(m);
  ok(r.fixes[0]?.kind === 'hoisted' && r.errors.length === 0, `hoisted: content.lists.lines moves up (${JSON.stringify(r.fixes)})`);
}

// renamed: the same name in another spelling (singular, case); the expressions follow it, the content stays.
{
  const m = clone(gold);
  m.content.line = m.content.lines;
  delete m.content.lines;
  const r = fixAndExpand(m);
  ok(r.fixes[0]?.kind === 'renamed' && r.fixes[0].from === 'line' && r.errors.length === 0 && r.manifest.functions.sq_lines.body === 'content_line', `renamed: content_lines reads content_line (${JSON.stringify(r.fixes)})`);
  ok(JSON.stringify(r.manifest.content) === JSON.stringify(m.content), 'renamed: content itself is untouched');
}
{
  const m = clone(gold);
  m.functions.sq_lines.body = 'content_Line';
  const r = fixAndExpand(m);
  ok(r.fixes[0]?.kind === 'renamed' && r.errors.length === 0 && r.manifest.functions.sq_lines.body === 'content_lines', `renamed: content_Line reads content_lines (${JSON.stringify(r.fixes)})`);
}
ok(similarKey('words', ['Word', 'word']) === null, 'no rename when two keys fit equally');
ok(similarKey('end_lines', ['endings', 'ranks', 'lines']) === null, 'no rename to a key with a word more or less (end_lines is not lines)');
ok(similarKey('words', ['theme_words']) === null, 'words is not theme_words');
ok(similarKey('lines', ['lives']) === null, 'no typo match on a short name (lines / lives)');
ok(similarKey('check_options', ['check_option', 'questions']) === 'check_option', 'check_options → check_option');
ok(similarKey('twist_sentence', ['twist_sentnce']) === 'twist_sentnce', 'a typo in a long name');

// derived: the words are elsewhere in the manifest.
{
  const m = clone(gold);
  m.design = { ...(m.design ?? {}), lines: m.content.lines };
  delete m.content.lines;
  const r = fixAndExpand(m);
  ok(r.fixes[0]?.kind === 'derived' && r.errors.length === 0 && r.manifest.content.lines.length === gold.content.lines.length, `derived: design.lines is copied into content (${JSON.stringify(r.fixes)})`);
}

// defaulted: only when allowed (Muse already asked, or the last round), typed from the usage.
{
  const m = clone(gold);
  m.functions.sq_end = { params: {}, returns: 'list<string>', body: 'content_end_lines' };
  m.functions.sq_twist = { params: {}, returns: 'string', body: "upper(content_twist_sentence)" };
  const none = fixAndExpand(m);
  ok(none.fixes.length === 0 && none.errors.some((d) => d.code === 'A_UNKNOWN_CONTENT'), 'nothing is made up without fill');
  const some = fixAndExpand(m, { fill: new Set(['end_lines']) });
  ok(some.fixes.length === 1 && some.fixes[0].key === 'end_lines' && some.errors.some((d) => /twist_sentence/.test(d.message)), `fill as a Set fills only those keys (${JSON.stringify(some.fixes)})`);
  const all = fixAndExpand(m, { fill: true });
  ok(all.errors.length === 0, `fill: the build continues (${all.errors.map((d) => d.message).join('; ')})`);
  ok(Array.isArray(all.manifest.content.end_lines) && all.manifest.content.end_lines.length === 0 && all.manifest.content.twist_sentence === '', `fill: an empty list and an empty string, by usage (${JSON.stringify({ e: all.manifest.content.end_lines, t: all.manifest.content.twist_sentence })})`);
  ok(all.fixes.every((f) => f.kind === 'defaulted' && /empty/.test(f.detail)), 'fill: each default is reported');
}

// The C2 shape: four keys at once, read in rules and presentation, words left in state.
{
  const m = clone(gold);
  m.state = { ...(m.state ?? {}), words: { type: 'list<string>', init: "['the', 'butler', 'did', 'it']" } };
  m.functions.sq_words = { params: {}, returns: 'list<string>', body: 'content_words' };
  m.content.check_option = ['a', 'b'];
  m.functions.sq_opts = { params: {}, returns: 'list<string>', body: 'content_check_options' };
  const r = fixAndExpand(m, { fill: true });
  const kinds = Object.fromEntries(r.fixes.map((f) => [f.key, f.kind]));
  ok(kinds.words === 'derived' && kinds.check_options === 'renamed' && r.errors.length === 0, `several keys at once (${JSON.stringify(r.fixes)}; ${r.errors.map((d) => d.message).join('; ')})`);
  ok(JSON.stringify(r.manifest.content.words) === JSON.stringify(['the', 'butler', 'did', 'it']), 'derived from a literal state list');
}

// Renaming leaves strings, @params, fields and record keys alone.
{
  const m = clone(gold);
  m.content.line = m.content.lines;
  delete m.content.lines;
  m.functions.sq_lines.body = "if len(content_lines) > 0 then content_lines else ['content_lines', x.content_lines]";
  const r = repairContent(m, ['lines']);
  ok(r.manifest.functions.sq_lines.body === "if len(content_line) > 0 then content_line else ['content_lines', x.content_lines]", `rename is token-level (${r.manifest.functions.sq_lines.body})`);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
