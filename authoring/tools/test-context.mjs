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

{ // one gold example when the top type is a confident catalog match (Kevin32: median system prompt 126k chars)
  const { goldCount } = await import('../expander/pipeline.mjs');
  ok(goldCount({ types: [{ source: 'seed', match: { score: 0.97 } }] }) === 1 && goldCount({ types: [{ source: 'learned', match: { score: 1 } }] }) === 2 && goldCount({ types: [{ match: { score: 0.6 } }] }) === 2 && goldCount(null) === 2, 'goldCount: 1 when confident, else 2');
  const base = { ...SAMPLES.dodge, gold_ids: ['gold_rift_run', 'gold_cake_tower'] };
  const typesAt = (score) => base.types.map((t, i) => (i === 0 ? { ...t, source: 'seed', match: { score, reasons: [] } } : t));
  const sure = await compose({ context: { ...base, types: typesAt(0.95) } }, (p) => (/score review/.test(p) ? { ok: true, issues: [] } : tide));
  const unsure = await compose({ context: { ...base, types: typesAt(0.5) } }, (p) => (/score review/.test(p) ? { ok: true, issues: [] } : tide));
  ok(sure.out.stats.examples.length === 1 && unsure.out.stats.examples.length === 2, `examples: ${sure.out.stats.examples.length} confident, ${unsure.out.stats.examples.length} not`);
  console.log(`  system prompt: ${unsure.out.stats.systemChars} chars with 2 gold examples, ${sure.out.stats.systemChars} with 1 (${Math.round((100 * (unsure.out.stats.systemChars - sure.out.stats.systemChars)) / unsure.out.stats.systemChars)}% less)`);
  ok(sure.out.stats.systemChars < unsure.out.stats.systemChars, 'one example makes the prompt smaller');
}

{ // the bundle's variants entry point (Studio API 5): versions of one plan through the same local Studio
  ok(B.version === 5 && typeof B.variants === 'function', `bundle API ${B.version} has variants`);
  const ask = async (system, user, purpose) => ({ content: JSON.stringify(/score review/.test(purpose) ? { ok: true, issues: [] } : /alternatives|variant/.test(purpose) && !/draft|repair|polish/.test(purpose) ? { alternatives: [] } : tide), model: 'fake' });
  const v = JSON.parse(await B.variants(JSON.stringify({ request: 'tap the shells', brief: { intent: 'x' }, context: { ...SAMPLES.dodge, gold_ids: ['gold_rift_run'] }, n: 2, mode: 'separate' }), ask, () => {}));
  ok(Array.isArray(v.variants) && v.variants.length >= 1 && v.variants.every((x) => x.manifest?.variant?.id) && v.stats?.muse_calls >= 1, `variants through the bundle: ${v.variants?.map((x) => `${x.id} ${x.axis}`).join(', ')}; dropped ${v.dropped?.length}`);
  // planMenu: the twist of a twist version is a rule, and earlier picks are listed
  const menu = P.planMenu(catalog, { ...SAMPLES.dodge, preferences: [{ axis: 'look', chosen: { label: 'Cozy Watercolor', value: 'soft washes' }, rejected: [{ label: 'Flat Cute' }] }], plan: { ...SAMPLES.dodge.plan, spec: { ...SAMPLES.dodge.plan.spec, loop: { verb: 'dodge', twist: 'Sacrifice 5 s for 2x points' } } } });
  const text = String(menu.spec);
  ok(/This version's twist .*Sacrifice 5 s/.test(text), 'planMenu calls out the twist');
  ok(/earlier picks/.test(text) && /Cozy Watercolor/.test(text) && /Flat Cute/.test(text), 'planMenu lists the earlier picks');
  ok(!/earlier picks/.test(String(P.planMenu(catalog, SAMPLES.dodge).spec)), 'no picks, no section');
}

{ // picture art: plan.art "image" plus the caller's image/decode/deflate → muse-image pictures behind the same ids
  const zlib = (await import('node:zlib')).default;
  const C = await import('../expander/image-codec.mjs');
  const deflate = (b) => new Uint8Array(zlib.deflateSync(b, { level: 9 }));
  const decode = (b) => C.decodePNG(b, (x) => new Uint8Array(zlib.inflateSync(x)));
  const keyOf = (p) => (/pure green/.test(p) ? [2, 250, 4] : /pure blue/.test(p) ? [3, 2, 250] : [250, 3, 248]);
  const imageCalls = [];
  const image = async ({ prompt, purpose }) => {
    imageCalls.push(purpose);
    const grid = /(\d+) separate subjects arranged in a (\d+) columns x (\d+) rows/.exec(prompt);
    const [n, cols, rows] = grid ? grid.slice(1).map(Number) : [1, 1, 1];
    const w = 960, h = 640, data = new Uint8Array(w * h * 4), key = keyOf(prompt);
    const cw = w / cols, ch = h / rows, r = Math.min(cw, ch) * 0.3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = Math.floor(y / ch) * cols + Math.floor(x / cw);
      const inside = grid && k < n && Math.hypot(x - ((k % cols) + 0.5) * cw, y - (Math.floor(k / cols) + 0.5) * ch) < r;
      data.set(grid ? (inside ? [40 + 30 * k, 120, 200, 255] : [...key, 255]) : [x % 256, y % 256, 128, 255], (y * w + x) * 4);
    }
    return { bytes: C.encodePNG({ w, h, data }, deflate) };
  };
  const ctx = { ...SAMPLES.dodge, gold_ids: ['gold_rift_run'], plan: { ...SAMPLES.dodge.plan, art: 'image', spec: { ...SAMPLES.dodge.plan.spec, theme: { art_style: 'pixel art' } } } };
  const rift = JSON.parse(readFileSync(join(authoringDir, 'games', 'gold_rift_run.authoring.json'), 'utf8'));
  const reply = (purpose) => (/score review/.test(purpose) ? { ok: true, issues: [] } : /direction/.test(purpose) ? {} : rift);
  const events = [];
  const ask = async (s, u, purpose) => ({ content: JSON.stringify(reply(purpose)), model: 'fake' });
  const out = JSON.parse(await B.compose(JSON.stringify({ request: 'tap the shells', brief: { intent: 'x' }, polish: false, context: ctx }), ask, (e) => events.push(e), { image, decode, deflate }));
  const game = JSON.parse(out.manifest.content.game_json);
  const pictures = Object.values(game.assets ?? {}).filter((a) => typeof a.image === 'string' && a.image.startsWith('data:image/'));
  ok(pictures.length >= 1 && out.manifest.art_record?.license === 'generated' && out.stats.image_art?.image_calls >= 1 && out.stats.image_art.style === 'pixel art', `image art: ${pictures.length} pictures, ${JSON.stringify(out.stats.image_art)}`);
  ok(events.some((e) => e.kind === 'drawing' && e.summary === 'Muse is drawing the pictures'), 'image art: the drawing event');
  ok(out.gate.passed && JSON.stringify(game.rules) === JSON.stringify(JSON.parse(JSON.parse(B.expand(JSON.stringify(rift))).game_json).rules), 'image art: same rules, gate result kept');
  // a failing image model keeps the SVG art; no art "image" draws nothing
  const failing = JSON.parse(await B.compose(JSON.stringify({ request: 'tap the shells', brief: { intent: 'x' }, polish: false, context: ctx }), ask, () => {}, { image: async () => { throw new Error('429 busy'); }, decode, deflate }));
  ok(!failing.manifest.art_record && /429|no picture|busy/.test(failing.stats.image_art?.failed ?? '') && failing.gate.passed, `image art failure keeps the SVG art (${failing.stats.image_art?.failed})`);
  const before = imageCalls.length;
  const plain = JSON.parse(await B.compose(JSON.stringify({ request: 'tap the shells', brief: { intent: 'x' }, polish: false, context: SAMPLES.dodge }), ask, () => {}, { image, decode, deflate }));
  ok(imageCalls.length === before && !plain.stats.image_art && !plain.manifest.art_record, 'no plan.art: no pictures drawn');
}

{ // requirements: quoted in the prompt once, checked in every built game with no Muse call; judge + repair opt-in
  const reqs = [
    { id: 'r1', quote: '12 questions', kind: 'count', target: { measure: 'questions', op: '==', value: 12 }, must: true, verify: 'code' },
    { id: 'r2', quote: 'cozy', kind: 'tone', target: null, must: false, verify: 'judge' },
  ];
  const ctx = { ...SAMPLES.dodge, plan: { ...SAMPLES.dodge.plan, spec: { ...SAMPLES.dodge.plan.spec, requirements: reqs } } };
  const menu = String(P.planMenu(catalog, ctx).spec);
  ok(/Requirements you must meet, quoted/.test(menu) && menu.split('"12 questions"').length === 2 && !/"requirements":/.test(menu), 'planMenu quotes the requirements once, outside the spec JSON');
  const run = async (c) => {
    const purposes = [], events = [];
    const ask = async (s, u, purpose) => { purposes.push(purpose); return { content: JSON.stringify(/score review/.test(purpose) ? { ok: true, issues: [] } : /judge/.test(purpose) ? { results: [{ id: 'r1', met: false, evidence: 'no questions' }, { id: 'r2', met: true, evidence: 'soft colors' }] } : tide), model: 'fake' }; };
    const out = JSON.parse(await B.compose(JSON.stringify({ request: 'cozy trivia with 12 questions', brief: { intent: 'x' }, polish: false, context: c }), ask, (e) => events.push(e)));
    return { out, purposes, events };
  };
  const plain = await run(ctx);
  const r = plain.out.stats.requirements;
  ok(r && r.must_total === 1 && typeof r.must_passed === 'number' && Array.isArray(r.gaps) && typeof r.note === 'string', `stats.requirements: ${JSON.stringify(r)}`);
  ok(r.must_passed === 0 && r.gaps.length === 1 && r.note === '', 'a must code can\'t confirm is a gap, with no note (not a known miss)');
  const missing = await run({ ...ctx, plan: { ...ctx.plan, spec: { ...ctx.plan.spec, requirements: [{ id: 'r1', quote: 'Zanzibar', kind: 'content', target: { text: ['Zanzibar'] }, must: true, verify: 'code' }] } } });
  ok(missing.out.stats.requirements.must_passed === 0 && /Zanzibar/.test(missing.out.stats.requirements.note) && missing.out.stats.requirements.gaps[0]?.quote === 'Zanzibar', `a missed must gets a gap entry and an honest note: ${missing.out.stats.requirements.note}`);
  ok(!plain.purposes.some((p) => /judge|requirements/.test(p)), `no judge or repair by default (${plain.purposes.join(', ')})`);
  ok(plain.events.some((e) => e.kind === 'requirements_checked' && /0 of 1/.test(e.summary)), 'requirements_checked event');
  const opted = await run({ ...ctx, requirements_repair: true });
  ok(opted.purposes.includes('requirements judge') && opted.purposes.filter((p) => /microgame (draft|revision)/.test(p)).length >= 2 && opted.out.stats.requirements?.judged === true, `requirements_repair: judge and one revise (${opted.purposes.join(', ')})`);
  const none = await run(SAMPLES.dodge);
  ok(none.out.stats.requirements?.must_total === 0, 'no requirements: zeros');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
