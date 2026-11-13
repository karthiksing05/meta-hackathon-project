#!/usr/bin/env node
// Tests the harness context in compose (docs/HARNESS_V2.md "The context the generator receives"), with no
// network: the menu is trimmed to the plan's tools, the types and spec go in, gold_ids come first, the
// gate gets gate_profile, and a compose without context sends exactly what it did before. Prints the
// system prompt size with and without context for three sample contexts built from authoring/catalog.
// Usage: node authoring/tools/test-context.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as P from '../expander/prompts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const authoringDir = join(here, '..');
const root = join(authoringDir, '..');
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log(`FAIL ${msg}`); } };

const context = vm.createContext({ console, setTimeout, clearTimeout, performance });
for (const f of ['FacebookClone/Bubbles/Runtime/web/bubble-kit-microgame-engine.js', 'FacebookClone/Bubbles/Studio/web/microgame-studio.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), context, { filename: f });
}
const B = context.MicrogameStudio;
const catalog = JSON.parse(B.catalog());
const read = (p) => JSON.parse(readFileSync(join(authoringDir, 'catalog', p), 'utf8'));
const tools = Object.fromEntries(['fragments', 'builtins', 'composed', 'engine', 'planned'].flatMap((f) => read(`tools/${f}.json`)).map((t) => [t.id, t]));
const typeOf = (family, id) => read(`types/${family}.json`).find((t) => t.id === id);

/** A context like Go sends: the matched types, the union of their tools, a spec with a score, gold ids. */
function sample(family, ids, extraTools, spec, gold, profile) {
  const types = ids.map((id) => typeOf(family, id));
  const toolIds = [...new Set([...types.flatMap((t) => t.tools ?? []), ...extraTools])].slice(0, 24);
  return {
    version: 'harness-context/1',
    types,
    tools: toolIds.map((id) => tools[id] ?? { id, kind: 'planned', status: 'planned', summary: '' }),
    plan: { spec, tool_ids: toolIds, gaps: [] },
    gold_ids: gold,
    gate_profile: profile,
  };
}
const SAMPLES = {
  trivia: sample('knowledge_quiz', ['periodic_table_fill', 'capital_match'], ['keyboard', 'score'], {
    spec: 'game-spec/1', goal: { text: 'name rare answers', target: 'find the rarest answer in each of 7 prompts', measure: 'rarity points' },
    score: { kind: 'tiered_points', measures: 'rarity points per answer', unit: 'points', direction: 'higher', counts_when: 'any', aggregate: 'best', tie_break: 'less time', format: '{n} points', events: ['answer_scored'] },
  }, ['gold_who_posted'], 'trivia'),
  dodge: sample('dodge_survive', ['dodge_falling_objects', 'bullet_dodge_arena'], ['score'], {
    spec: 'game-spec/1', goal: { text: 'survive the storm', target: 'survive as long as you can', measure: 'time alive' },
    score: { kind: 'survival_time', measures: 'ms alive', unit: 'ms', direction: 'higher', counts_when: 'any', aggregate: 'best', tie_break: 'earlier', format: 'm:ss.t' },
  }, ['gold_rift_run'], 'runner'),
  puzzle: sample('logic_puzzle', ['queens_placement', 'mini_number_grid'], [], {
    spec: 'game-spec/1', goal: { text: 'place every crown', target: 'solve the board', measure: 'time to solve' },
    score: { kind: 'time_to_complete', measures: 'ms to solve', unit: 'ms', direction: 'lower', counts_when: 'finished', aggregate: 'best', tie_break: 'earlier', format: 'm:ss.t' },
  }, ['gold_driftwood_cipher'], 'puzzle'),
};

// ---- sizes ----
const ex = JSON.parse(B.examples('a game', 2));
const before = P.system(catalog, { examples: ex.text });
ok(before === B.prompt('system', JSON.stringify({ examples: ex.text })), 'no context: the bundle\'s system prompt is unchanged');
ok(P.system(catalog, { examples: ex.text, context: { version: 'harness-context/1', notes: ['x'] } }) === before, 'a context without tools or types changes nothing');
console.log('system prompt, characters (same gold examples in both, so the difference is the menu):');
for (const [name, ctx] of Object.entries(SAMPLES)) {
  const after = P.system(catalog, { examples: ex.text, context: ctx });
  const fragIn = ctx.tools.filter((t) => catalog.prompt.fragment_specs[t.id]).map((t) => t.id);
  const menuBefore = catalog.prompt.fragments.length;
  const menuAfter = P.planMenu(catalog, ctx);
  console.log(`  ${name.padEnd(7)} ${String(before.length).padStart(7)} → ${String(after.length).padStart(7)} (${after.length - before.length >= 0 ? '+' : ''}${after.length - before.length}); fragment menu ${menuBefore} → ${menuAfter.fragments.length}, types +${menuAfter.types.length}, spec +${menuAfter.spec.length}; ${fragIn.length} fragments of ${ctx.tools.length} tools`);
  ok(after.includes('## Fragments for this game (from the plan)') && !after.includes('## Fragments (the library)'), `${name}: the plan replaces the library`);
  for (const id of fragIn) ok(after.includes(catalog.prompt.fragment_specs[id]), `${name}: ${id}'s full spec is in`);
  const notPicked = catalog.fragments.map((f) => f.id).filter((id) => !fragIn.includes(id));
  ok(notPicked.every((id) => !after.includes(catalog.prompt.fragment_specs[id])), `${name}: unpicked fragments are named, not specified`);
  ok(after.includes('## What this game is') && after.includes(ctx.types[0].name), `${name}: the types are in`);
  ok(after.includes('## The spec to follow') && after.includes('top-level "score" block'), `${name}: the spec and its score are in`);
  ok(menuAfter.fragments.length < menuBefore, `${name}: the fragment menu is smaller`);
}

// ---- gold ids first ----
{
  const g = JSON.parse(B.examples('a cozy lantern game', 2, ['gold_rift_run']));
  ok(g.ids[0] === 'gold_rift_run' && g.ids.length === 2, `gold_ids first, then words (${g.ids.join(', ')})`);
  const g2 = JSON.parse(B.examples('a cozy lantern game', 2, ['gold_rift_run', 'gold_who_posted', 'gold_cake_tower']));
  ok(g2.ids.join() === 'gold_rift_run,gold_who_posted', 'gold_ids beyond k are cut');
  ok(JSON.parse(B.examples('a cozy lantern game', 2, ['nope'])).ids.length === 2, 'unknown gold ids fall back to words');
  ok(JSON.stringify(JSON.parse(B.examples('a cozy lantern game', 2)).ids) === JSON.stringify(JSON.parse(B.examples('a cozy lantern game', 2, null)).ids), 'no ids: unchanged');
}

// ---- compose with a context (fake Muse) ----
const tide = JSON.parse(readFileSync(join(authoringDir, 'games', 'tide_taps.authoring.json'), 'utf8'));
async function compose(args, reply) {
  const calls = [], events = [];
  const ask = async (system, user, purpose, options) => { calls.push({ system, user, purpose, options }); return { content: JSON.stringify(reply(purpose)), model: 'fake' }; };
  const out = JSON.parse(await B.compose(JSON.stringify({ request: 'tap the shells', brief: { intent: 'x' }, polish: false, ...args }), ask, (e) => events.push(e)));
  return { out, calls, events };
}
{
  const ctx = { ...SAMPLES.dodge, gold_ids: ['gold_rift_run'], gate_profile: 'arcade',
    plan: { ...SAMPLES.dodge.plan, spec: { ...SAMPLES.dodge.plan.spec, score: { kind: 'points', measures: 'shells tapped', unit: 'shells', direction: 'higher', counts_when: 'any', aggregate: 'best', tie_break: 'earlier', format: '{n} shells', events: ['point', 'not_an_event'] } } } };
  const r = await compose({ context: ctx }, (p) => (/score review/.test(p) ? { ok: true, issues: [] } : tide));
  const draft = r.calls.find((c) => c.purpose === 'microgame draft');
  ok(draft.system.includes('## Fragments for this game (from the plan)'), 'compose: the draft prompt uses the plan menu');
  ok(r.out.stats.examples[0] === 'gold_rift_run', `compose: gold_ids first (${r.out.stats.examples.join(', ')})`);
  ok(r.out.stats.systemChars === draft.system.length, 'compose: stats.systemChars records the prompt size');
  ok(r.out.manifest.score?.format === '{n} shells' && r.out.manifest.score.events.join() === 'point', 'compose: a manifest without a score block adopts the spec\'s score (unknown events dropped)');
  ok(JSON.parse(r.out.manifest.content.authoring_json).score?.unit === 'shells', 'compose: the adopted score is kept in authoring_json');
  ok(r.events.some((e) => e.kind === 'score_checked'), 'compose: the adopted score is checked');
  ok(r.calls.find((c) => c.purpose === 'score review')?.user.includes('shells tapped') ?? false, 'compose: the review reads the spec\'s parts');

  const none = await compose({}, () => tide);
  const d0 = none.calls.find((c) => c.purpose === 'microgame draft');
  ok(d0.system.includes('## Fragments (the library)') && !('score' in none.out.manifest), 'compose without context: unchanged');
  const g = JSON.parse(await B.gate(JSON.parse(B.expand(JSON.stringify(tide))).playtest_game_json, 1, JSON.stringify({ gate_profile: 'calm' })));
  ok(g.gate_profile === 'calm', 'gate: gate_profile passes through');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
