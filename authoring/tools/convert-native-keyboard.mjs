#!/usr/bin/env node
// Rewrites a built game whose typed answer goes through the drawn on-canvas keyboard (the `keyboard`
// fragment) so the player types on the iPhone keyboard instead: a native text field (engine text
// input) with the same answer check and scoring. Deterministic: same input, same output.
//
//   - typed_answer + keyboard (and qa_bank + keyboard): drop the keyboard; the fragment's version 2
//     brings its own text field.
//   - the game's own `press` rules (keyboard letters, '<' delete, '>' submit): `press` becomes a game
//     event and the original rules stay as they were. A text input mirrors each edit into the typed
//     state (only the characters the keyboard had), and Return sets it and emits `press {'>'}`, so the
//     submit rule, the answer check and the score run unchanged. The field goes over the box that
//     drew the typed text.
//   - Games where the keys are the game (word_check: Wordle-style letter feedback) are left alone.
//
// The run log changes shape (text events instead of taps), so old replays of a converted game don't
// carry over; new runs replay as usual (text inputs are logged).
//
// Usage: node authoring/tools/convert-native-keyboard.mjs <manifest.json> [--out <file>] [--catalog cat.json]
//   The manifest is a built game (content.authoring_json + content.game_json) or a bare authoring
//   manifest. Prints a one-line summary; exit 2 when there is nothing to convert.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary, expand } from '../expander/expand.mjs';
import { sortSafe } from '../expander/stable.mjs';

const authoringDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// Fragments that bring their own native text field from version 2 on.
const NATIVE = { typed_answer: 2, qa_bank: 2 };
// The keys themselves are the game: keep the drawn keyboard.
const KEYS_ARE_THE_GAME = ['word_check'];

const clone = (v) => JSON.parse(JSON.stringify(v));
const sq = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The state the game's press rules type into: `set X` to an expression that appends event.letter to X. */
function typingTarget(rules) {
  for (const r of rules) {
    if (r.on !== 'press') continue;
    const found = [];
    const walk = (effects) => {
      for (const e of effects || []) {
        if (typeof e.set === 'string' && typeof e.to === 'string' && /\bevent\.letter\b/.test(e.to) && new RegExp(`\\b${e.set}\\b`).test(e.to)) found.push(e.set);
        walk(e.then); walk(e.else); walk(e.do);
      }
    };
    walk(r.do);
    if (found.length) return found[0];
  }
  return null;
}

/** Longest typed text the press rules allow (`len(X) < N`), else 24. */
function typingLimit(rules, target) {
  const re = new RegExp(`len\\(${target}\\)\\s*<\\s*(\\d+)`, 'g');
  let best = 0;
  for (const m of JSON.stringify(rules.filter((r) => r.on === 'press')).matchAll(re)) best = Math.max(best, Number(m[1]));
  return best || 24;
}

/** The typing rule's guard with its letter tests dropped (they're about keys, not about typing). */
function typingGuard(rules, target) {
  const r = rules.find((x) => x.on === 'press' && JSON.stringify(x.do).includes(`"set":"${target}"`));
  if (!r?.when) return null;
  const g = r.when.replace(/\s*(and\s+)?event\.letter\s*(==|!=)\s*'[^']*'\s*/g, ' ').replace(/^\s*and\s+/, '').replace(/\s+and\s*$/, '').replace(/\s+/g, ' ').trim();
  return g && !/\bevent\./.test(g) ? g : null;
}

const NODE_KIDS = ['children', 'then', 'else'];

/** Where the typed text is drawn: the box (rect or image) around the first text node that reads it. */
function fieldRect(presentation, target, keyboard) {
  const re = new RegExp(`\\b${target}\\b`);
  let hit = null;
  const visit = (node, ox, oy) => {
    if (hit || !node || typeof node !== 'object') return;
    const x0 = ox + (typeof node.x === 'number' ? node.x : 0), y0 = oy + (typeof node.y === 'number' ? node.y : 0);
    const kids = NODE_KIDS.flatMap((k) => (Array.isArray(node[k]) ? node[k] : []));
    for (const c of kids) {
      if (c?.node === 'text' && typeof c.text === 'string' && re.test(c.text)) {
        const tx = x0 + (c.x ?? 0), ty = y0 + (c.y ?? 0);
        const box = kids.find((b) => (b.node === 'rect' || b.node === 'image') && typeof b.w === 'number' && typeof b.h === 'number'
          && tx >= x0 + (b.x ?? 0) - 2 && tx <= x0 + (b.x ?? 0) + b.w + 2 && ty >= y0 + (b.y ?? 0) - 2 && ty <= y0 + (b.y ?? 0) + b.h + 2);
        const size = Math.max(16, Math.min(24, typeof c.size === 'number' ? c.size : 18));
        if (box) hit = { x: x0 + (box.x ?? 0), y: y0 + (box.y ?? 0), w: box.w, h: Math.max(40, box.h), size };
        else if (typeof c.w === 'number') hit = { x: tx, y: ty - (c.anchor === 'center' ? 22 : 0), w: c.w, h: 44, size };
        else hit = { x: Math.max(12, tx - 150), y: ty - 22, w: 300, h: 44, size };
        return;
      }
    }
    for (const c of kids) visit(c, x0, y0);
    if (node.template) visit({ children: [node.template] }, x0, y0);
  };
  for (const s of presentation?.slots || []) if (s.slot === 'playfield') visit({ children: [s.node] }, 0, 0);
  if (hit) return hit;
  // Nothing draws it: the top of where the keyboard was.
  const cols = keyboard.cols ?? 7, ks = keyboard.key_size ?? 44, gap = keyboard.gap ?? 4;
  return { x: keyboard.x ?? 14, y: keyboard.y ?? 400, w: Math.min(336, cols * (ks + gap) - gap), h: 48, size: 20 };
}

/**
 * Converts one authoring manifest. Returns {manifest, kind, notes} or {skip: reason}.
 */
export function convertAuthoring(input) {
  const a = clone(input);
  const uses = a.uses || [];
  const kbIdx = uses.findIndex((u) => u.fragment === 'keyboard');
  if (kbIdx < 0) return { skip: 'no canvas keyboard' };
  const frags = uses.map((u) => u.fragment);
  const keysGame = KEYS_ARE_THE_GAME.find((f) => frags.includes(f));
  if (keysGame) return { skip: `the keys are the game (${keysGame})` };
  const kb = { ...(uses[kbIdx].params || {}) };
  const letters = kb.letters ?? 'abcdefghijklmnopqrstuvwxyz';
  a.uses = uses.filter((_, i) => i !== kbIdx);
  const notes = [];

  const native = a.uses.filter((u) => NATIVE[u.fragment]);
  if (native.length) {
    for (const u of native) { if (u.version !== undefined) u.version = NATIVE[u.fragment]; }
    // The game may have drawn its own hint about the keyboard's keys; key_state is no longer needed.
    if (a.functions?.key_state) delete a.functions.key_state;
    notes.push(`${native.map((u) => u.fragment).join(', ')} v2 brings the text field`);
    return { manifest: a, kind: 'fragment', notes };
  }

  const rules = a.rules || [];
  const target = typingTarget(rules);
  if (!target) return { skip: 'keyboard presses are not typed into a state (taps on letters, not an answer)' };
  if (!rules.some((r) => r.on === 'press' && JSON.stringify(r).includes("'>'"))) return { skip: "no '>' submit in the press rules" };
  if (a.inputs?.answer_enter || a.inputs?.answer_edit) return { skip: 'already has answer_enter/answer_edit' };
  const maxLen = Math.min(200, typingLimit(rules, target));
  const allowed = [...new Set([...letters].filter((c) => c !== '<' && c !== '>'))].join('');
  // Only what the keyboard could type, lowercase like its keys (spaces only if it had a space key).
  const clean = (v) => `substr(join(filter(chars(lower(${v})), c => contains(${sq(allowed)}, c)), ''), 0, ${maxLen})`;
  const guard = typingGuard(rules, target);
  a.events = { ...(a.events || {}), press: { letter: 'string' } };
  const placeholder = /^[0-9.,<>]+$/.test(letters) ? 'Type a number' : 'Type your answer';
  a.inputs = {
    answer_enter: { payload: { value: 'string' }, from: [{ text: 'submit', placeholder, max_len: maxLen, with: { value: 'text.value' } }] },
    answer_edit: { payload: { value: 'string' }, from: [{ text: 'change', with: { value: 'text.value' } }] },
    ...(a.inputs || {}),
  };
  a.rules = [
    // Each edit shows in the typed state (the app clears the field after Return with an empty edit,
    // which is ignored so the submitted answer stays until the game's own rules clear it).
    { id: 'answer_edit', on: 'answer_edit', when: guard ? `(${guard}) and event.value != ''` : "event.value != ''", do: [{ set: target, to: clean('event.value') }] },
    // Return: the typed state becomes the submitted text, then the old submit key runs the game's own check.
    { id: 'answer_enter', on: 'answer_enter', do: [{ set: target, to: clean('event.value') }, { emit: 'press', with: { letter: "'>'" } }] },
    ...rules,
  ];
  a.presentation = { ...(a.presentation || {}), text_field: fieldRect(a.presentation, target, kb) };
  notes.push(`press rules kept; types into ${target} (max ${maxLen}, keys ${JSON.stringify(allowed)})`);
  return { manifest: a, kind: 'rules', notes };
}

/** Converts a built game (content.authoring_json + content.game_json): new authoring and game JSON. */
export function convertBuilt(built, lib, { isRandom } = {}) {
  const a = JSON.parse(built.content.authoring_json);
  const res = convertAuthoring(a);
  if (res.skip) return res;
  const out = expand(res.manifest, lib);
  const errors = out.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) return { skip: `expand failed: ${errors.map((d) => `${d.code} ${d.at ?? ''} ${d.message}`).join('; ')}` };
  const safe = (doc) => sortSafe(doc, isRandom ? { isRandom } : {}).doc;
  const next = clone(built);
  next.content = { ...next.content, game_json: JSON.stringify(safe(out.game)), authoring_json: JSON.stringify(safe(res.manifest)) };
  return { built: next, out, kind: res.kind, notes: res.notes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const file = args.find((x, i) => !x.startsWith('--') && !['--out', '--catalog'].includes(args[i - 1]));
  if (!file) { console.error('usage: convert-native-keyboard.mjs <manifest.json> [--out file] [--catalog cat.json]'); process.exit(64); }
  const lib = loadLibrary(authoringDir);
  const cat = opt('--catalog') ? JSON.parse(readFileSync(opt('--catalog'), 'utf8')) : null;
  const random = cat ? new Set((cat.builtins || []).filter((b) => b.random).map((b) => b.name)) : null;
  const isRandom = random ? (n) => random.has(n) : (n) => /^(random|pick|shuffle|chance|roll|sample|weighted)/.test(n);
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const res = doc.content?.authoring_json ? convertBuilt(doc, lib, { isRandom }) : convertAuthoring(doc);
  if (res.skip) { console.log(`${file}: skipped (${res.skip})`); process.exit(2); }
  const result = res.built ?? res.manifest;
  const outFile = opt('--out');
  if (outFile) { mkdirSync(dirname(outFile), { recursive: true }); writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n'); }
  else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  console.error(`${file}: converted (${res.kind}): ${res.notes.join('; ')}`);
}
