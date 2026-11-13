#!/usr/bin/env node
// Tests variants (authoring/expander/variants.mjs) with no network: which axes a plan leaves open, the
// version briefs, makeVariants with a stub Studio and stub Muse (separate, shared and auto), dropping versions
// that fail the gate, the restyle pass, the variant_pick event and folding the pick into the next plan.
// Usage: node authoring/tools/test-variants.mjs

import * as V from '../expander/variants.mjs';

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log(`FAIL ${msg}`); } };
const clone = (v) => JSON.parse(JSON.stringify(v));

// A small harness-context/1, shaped like the planner's.
const base = {
  version: 'harness-context/1',
  types: [
    { id: 'slice_swipe', name: 'Slice swipe', family: 'arcade', tools: ['swipe', 'spawn', 'lives', 'combo'], match: { score: 0.88 } },
    { id: 'falling_catch', name: 'Falling catch', family: 'catch_collect', tools: ['tap', 'spawn', 'lives'], match: { score: 0.79 } },
  ],
  plan: {
    type_ids: ['slice_swipe'],
    design: { pitch: 'Slice flying spam.', twist: 'One glowing boss email must be left alone.', arc: ['slow', 'pairs', 'crossing'] },
    clarify: [],
    spec: {
      goal: { text: 'Slice as much spam as you can without cutting the boss email.' },
      theme: { world: 'A night inbox', look: 'Dark inbox, bright envelopes', named: ['Fruit Ninja'] },
      loop: { verb: 'slice', sees: 'emails arcing up' },
      progression: { steps: [{ at: '0 points', change: 'slow' }, { at: '20 points', change: 'pairs' }, { at: '40 points', change: 'crossing' }], levers: ['toss rate', 'boss frequency'] },
      feel: { look: 'Dark inbox' },
      score: { kind: 'points' },
      social: { mode: 'series' },
    },
  },
  notes: ['lookup skipped'],
};

// MARK: axes
let axes = V.pickAxes(base, 'Fruit Ninja but I slice spam emails and must avoid the one email from my evil corporate boss');
ok(axes[0].axis === 'look', `no style named -> look first: ${JSON.stringify(axes.map((a) => a.axis))}`);
ok(axes.find((a) => a.axis === 'twist').score <= 0.5, 'a specific request keeps its twist');
ok(axes.find((a) => a.axis === 'type').score === 0, 'a clear type match is no type axis');
axes = V.pickAxes(base, 'pixel art fruit ninja with emails');
ok(axes.find((a) => a.axis === 'look').score < 0.2, 'a named style closes the look axis');
const vague = clone(base);
vague.plan.design.twist = 'Combos chain lightning between gods for bonus legends';
axes = V.pickAxes(vague, 'Krillion-like game but centered on Greek mythology');
ok(axes[0].axis === 'twist', `a vague request opens the twist: ${axes[0].axis}`);
ok(V.pickAxes(base, 'a really hard fruit ninja').find((a) => a.axis === 'arc').score < 0.2, 'difficulty words close the arc');

// type: two close types that play differently
const close = clone(base);
close.types[1].match.score = 0.86;
ok(V.closeType(close)?.id === 'falling_catch', 'a close type from another family');
ok(V.pickAxes(close, 'x')[0].axis === 'type', 'a close type goes first');
const same = clone(close);
same.types[1] = { ...same.types[1], family: 'arcade', tools: ['swipe', 'spawn', 'lives', 'combo'] };
ok(V.closeType(same) === null, 'the same mechanic under another name is not a type choice');
const dup = clone(close);
dup.types.unshift(clone(dup.types[0]));
ok(V.closeType(dup)?.id === 'falling_catch', 'duplicate ids are ignored');
const planned2 = clone(close);
planned2.plan.type_ids = ['slice_swipe', 'falling_catch'];
ok(V.closeType(planned2) === null, 'a type the plan already blends is not a choice');

// settled axes drop
const settled = { ...clone(base), preferences: [{ axis: 'look', chosen: { label: 'Pixel', value: 'pixel art' }, rejected: [{ label: 'Paper' }] }] };
axes = V.pickAxes(settled, 'Fruit Ninja but I slice spam emails and must avoid the boss');
ok(axes[0].axis !== 'look' && axes.find((a) => a.axis === 'look').why.includes('settled'), `an earlier look pick settles look: ${axes[0].axis}`);

// MARK: version briefs
let vb = V.variantBrief(base, { intent: 'x' }, { id: 'b', axis: 'look', label: 'Paper', value: 'Paper cut-out, warm.', look: 'paper' });
ok(vb.context.plan.spec.theme.look === 'Paper cut-out, warm.' && vb.context.plan.spec.feel.look === 'Paper cut-out, warm.', 'look goes into the spec');
ok(vb.brief.notes.includes('Paper cut-out') && vb.brief.notes.includes('"paper" look'), 'look goes into the brief notes');
ok(base.plan.spec.theme.look === 'Dark inbox, bright envelopes', 'the plan is not mutated');
ok(JSON.stringify(vb.context.plan.spec.score) === JSON.stringify(base.plan.spec.score) && JSON.stringify(vb.context.plan.spec.social) === JSON.stringify(base.plan.spec.social) && vb.context.plan.spec.goal.text === base.plan.spec.goal.text, 'goal, score and group play are shared');
vb = V.variantBrief(base, {}, { id: 'b', axis: 'twist', label: 'Reply-all', value: 'Reply-all chains split into three.' });
ok(vb.context.plan.design.twist.startsWith('Reply-all') && vb.context.plan.spec.loop.twist.startsWith('Reply-all'), 'twist in design and in the spec loop');
vb = V.variantBrief(base, {}, { id: 'c', axis: 'arc', label: 'Gentle', value: 'start: slow; middle: pairs; end: triples' });
ok(vb.context.plan.spec.progression.steps.length === 3 && vb.context.plan.spec.progression.steps[2].at === 'end' && vb.context.plan.spec.progression.levers.length === 2, 'arc steps parsed, levers kept');
vb = V.variantBrief(close, {}, { id: 'b', axis: 'type', label: 'Falling catch', value: 'falling_catch' });
ok(vb.context.plan.type_ids[0] === 'falling_catch' && vb.context.types[0].id === 'falling_catch', 'type version builds the other type');
ok(V.arcSteps('a: b; c: d; e: f; g: h; i: j').length === 4, 'arc steps are capped');

// MARK: planVariants
const stubAsk = (replies) => {
  const seen = [];
  const fn = async (system, user, purpose, options) => {
    seen.push({ purpose, options });
    const r = replies(purpose, user);
    if (r instanceof Error) throw r;
    return { content: typeof r === 'string' ? r : JSON.stringify(r), model: options?.model ?? 'stub', usage: { prompt_tokens: 100, completion_tokens: 50 } };
  };
  fn.seen = seen;
  return fn;
};
let ask = stubAsk((p) => (p.startsWith('variant alternatives') ? { current_label: 'Night inbox', alternatives: [{ label: 'Pixel office', value: 'Chunky pixel art office.' }, { label: 'Pixel office', value: 'dup' }, { label: 'Paper desk', value: 'Paper cut-out desk.' }] } : {}));
let events = [];
let pv = await V.planVariants({ request: 'Fruit Ninja but I slice spam emails and must avoid the boss', context: base, n: 3 }, { ask, onEvent: (e) => events.push(e) });
ok(pv.variants.length === 3 && pv.variants[0].label === 'Night inbox' && pv.variants[1].label === 'Pixel office' && pv.variants[2].label === 'Paper desk', `three versions, duplicates dropped: ${pv.variants.map((v) => v.label)}`);
ok(pv.variants.every((v) => v.axis === 'look'), 'one axis for all versions');
ok(ask.seen[0].options.model === 'muse-spark-1.3' && ask.seen.length === 1, 'one spark call');
ok(events[0]?.kind === 'variants_planned' && events[0].summary.includes('3 versions'), 'variants_planned event');

ask = stubAsk(() => new Error('Muse 503'));
pv = await V.planVariants({ request: 'Fruit Ninja but I slice spam emails and must avoid the boss', context: base, n: 2 }, { ask });
ok(pv.variants.length === 2 && pv.variants[1].source === 'built-in' && pv.calls[0].error, 'Muse down: built-in looks');

ask = stubAsk(() => ({ alternatives: [] }));
pv = await V.planVariants({ request: 'Krillion-like game but centered on Greek mythology', context: vague, n: 2 }, { ask });
ok(pv.variants.length === 2 && pv.variants[1].axis === 'look', `an empty twist hands over to look: ${pv.variants[1]?.axis}`);

ask = stubAsk((p) => ({ alternatives: [{ label: p.includes('look') ? 'Riso' : 'Steep', value: p.includes('look') ? 'risograph' : 'start: fast; middle: faster; end: wild' }] }));
pv = await V.planVariants({ request: 'x', context: base, n: 3, axes: ['look', 'arc'] }, { ask });
ok(pv.variants[1].axis === 'look' && pv.variants[2].axis === 'arc', 'two axes: b and c each vary one');

pv = await V.planVariants({ request: 'x', context: base, n: 2, axes: ['type'] }, { ask: null });
ok(pv.variants.length === 2 && pv.variants[1].axis !== 'type', 'no close type: the type axis is skipped');
pv = await V.planVariants({ request: 'x', context: close, n: 2, axes: ['type'] }, { ask: null });
ok(pv.variants[1].axis === 'type' && pv.variants[1].value === 'falling_catch', 'type alternative needs no Muse');

// MARK: makeVariants with a stub Studio
function authoring(title, art) {
  return { design: { theme: ['inbox'], twist: 't' }, meta: { title }, look: { id: 'neon' }, art: art ?? { style: 'night', palette: { bg: '#000000' }, sprites: { mail: { svg: '<svg/>' } } }, rules: [] };
}
function stubStudio({ failGate = () => false, failCompose = () => false } = {}) {
  const log = [];
  return {
    log,
    async compose(a, askFn, onEvent) {
      log.push({ kind: a.base ? 'revise' : 'compose', notes: a.brief?.notes ?? '', look: a.context?.plan?.spec?.theme?.look });
      onEvent({ kind: 'drafting', attempt: 1 });
      await askFn('sys', 'user', 'microgame draft');
      const which = a.base ? 'rev' : (a.brief?.notes || 'plan');
      if (failCompose(which)) throw Object.assign(new Error('never validated'), { stats: { calls: [] } });
      const auth = authoring(`Game ${log.length}`);
      return {
        manifest: { id: `mg-game-${log.length}abc`, title: `Game ${log.length}`, one_line_rule: 'Slice spam.', style: { emoji: '✉️', colors: { primary: '#00E5FF' } }, content: { authoring_json: JSON.stringify(auth) }, score: { kind: 'points', ranked: true }, group_play: { mode: 'series' }, brief: a.brief, seed: 7 },
        stats: { museCalls: 1, calls: [{ purpose: 'microgame draft', usage: { prompt_tokens: 40000, completion_tokens: 9000 } }] },
        gate: { passed: !failGate(which), summary: failGate(which) ? 'bots never lose' : 'ok' },
        quality: { score: a.brief?.notes ? 70 : 80 },
        score: { ranked: true },
      };
    },
    expand(text) { const j = JSON.parse(text); return { ok: !!j.art, authoring_json: text, game_json: '{}', game: {} }; },
    async gate() { return { passed: true, summary: 'ok', runs: [] }; },
    wrap(o) { const a = JSON.parse(o.authoring_json); return { id: o.id, title: a.meta.title, style: { colors: a.art.palette }, content: { authoring_json: o.authoring_json }, ...(o.score ? { score: o.score } : {}), seed: o.seed }; },
  };
}
const altLook = (p) => (p.startsWith('variant alternatives') ? { current_label: 'Night inbox', alternatives: [{ label: 'Pixel office', value: 'Chunky pixel art office.' }, { label: 'Paper desk', value: 'Paper cut-out desk.' }] }
  : p.startsWith('variant restyle') ? { art: { style: 'pixel', palette: { bg: '#112233' }, sprites: { mail: { svg: '<svg>p</svg>' } } }, look: { id: 'pixel' } } : {});

let studio = stubStudio();
ask = stubAsk(altLook);
events = [];
let r = await V.makeVariants({ request: 'Fruit Ninja but I slice spam emails and must avoid the boss', context: base, n: 3, mode: 'separate' }, studio, { ask, onEvent: (e) => events.push(e) });
ok(r.variants.length === 3 && studio.log.filter((l) => l.kind === 'compose').length === 3, 'separate: three composes');
ok(studio.log.some((l) => l.look === 'Chunky pixel art office.') && studio.log.some((l) => l.notes.includes('Paper cut-out')), 'each compose gets its own look');
ok(r.recommended === 'a', `recommended goes to the best quality: ${r.recommended}`);
ok(r.variants.every((v) => v.poster.title && v.poster.label && v.manifest.variant?.of === 3), 'posters and manifest.variant');
ok(r.stats.tokens.prompt >= 120000 && r.stats.muse_calls >= 4, `stats add up: ${JSON.stringify(r.stats.tokens)}`);
ok(events.some((e) => e.kind === 'drafting' && e.variant === 'b') && events.filter((e) => e.kind === 'variant_ready').length === 3, 'events are tagged by version');

studio = stubStudio();
ask = stubAsk(altLook);
r = await V.makeVariants({ request: 'Fruit Ninja but I slice spam emails and must avoid the boss', context: base, n: 2, mode: 'auto' }, studio, { ask });
ok(studio.log.length === 1 && r.variants.length === 2 && r.variants[1].how === 'restyle', 'auto + look: one compose and one restyle');
const restyled = JSON.parse(r.variants[1].manifest.content.authoring_json);
ok(restyled.look.id === 'pixel' && restyled.art.palette.bg === '#112233' && restyled.rules && r.variants[1].manifest.score?.kind === 'points' && r.variants[1].manifest.group_play?.mode === 'series', 'restyle keeps rules, score and group play');
ok(ask.seen.find((s) => s.purpose.startsWith('variant restyle'))?.options.model === 'muse-wonder-1.0', 'restyle on wonder');

studio = stubStudio();
ask = stubAsk((p) => (p.startsWith('variant alternatives') ? { alternatives: [{ label: 'Gentle', value: 'start: slow; middle: slow; end: medium' }] } : {}));
r = await V.makeVariants({ request: 'x', context: base, n: 2, axes: ['arc'], mode: 'shared' }, studio, { ask });
ok(studio.log.map((l) => l.kind).join() === 'compose,revise' && r.variants[1].how === 'revise', 'shared + arc: a revision of a');

studio = stubStudio({ failGate: (w) => w !== 'plan' });
ask = stubAsk(altLook);
events = [];
r = await V.makeVariants({ request: 'Fruit Ninja but I slice spam emails and must avoid the boss', context: base, n: 3, mode: 'separate' }, studio, { ask, onEvent: (e) => events.push(e) });
ok(r.variants.length === 1 && r.dropped.length === 2 && r.dropped.every((d) => d.reason.includes('playtest')), 'versions that fail the gate are dropped');
ok(events.filter((e) => e.kind === 'variant_dropped').length === 2, 'dropped events');

studio = stubStudio({ failCompose: () => true });
let threw = null;
try { await V.makeVariants({ request: 'x', context: base, n: 2, mode: 'separate' }, studio, { ask: stubAsk(altLook) }); } catch (e) { threw = e; }
ok(threw && threw.dropped?.length === 2, 'no version passed: throws with the reasons');

studio = stubStudio({ failCompose: (w) => w === 'plan' });
r = await V.makeVariants({ request: 'Fruit Ninja but I slice spam emails and must avoid the boss', context: base, n: 3, mode: 'separate' }, studio, { ask: stubAsk(altLook) });
ok(r.variants.length === 2 && r.dropped[0].id === 'a', 'a failed compose drops only that version');

// restyle: art that doesn't validate falls back to the palette over the old drawings
studio = stubStudio();
studio.expand = (text) => { const j = JSON.parse(text); return { ok: !j.art.sprites.mail.svg.includes('bad'), authoring_json: text, game_json: '{}' }; };
const baseGame = await studio.compose({ request: 'x', brief: {}, context: base }, stubAsk(() => ({})), () => {});
const rs = await V.restyle(baseGame, 'pixel', studio, { ask: stubAsk(() => ({ art: { palette: { bg: '#445566' }, sprites: { mail: { svg: '<svg>bad</svg>' } } } })), id: 'b' });
const rsA = JSON.parse(rs.manifest.content.authoring_json);
ok(rs.stats.art === 'palette only' && rsA.art.palette.bg === '#445566' && rsA.art.sprites.mail.svg === '<svg/>', 'restyle falls back to palette only');
threw = null;
try { await V.restyle(baseGame, 'pixel', studio, { ask: stubAsk(() => ({ nope: 1 })) }); } catch (e) { threw = e; }
ok(threw?.message.includes('no art'), 'a restyle reply without art fails');

// MARK: picks
r = await V.makeVariants({ request: 'Fruit Ninja but I slice spam emails and must avoid the boss', context: base, n: 3, mode: 'separate' }, stubStudio(), { ask: stubAsk(altLook) });
const e = V.pickEvent(r, 'b', { played: ['a', 'b', 'zz'], at: '2026-11-13T00:00:00Z' });
ok(e.kind === 'variant_pick' && e.axis === 'look' && e.chosen.label === 'Pixel office' && e.rejected.length === 2 && e.played.join() === 'a,b', `pick event ${JSON.stringify(e)}`);
ok(e.chosen.game_id && e.group.split('+').length === 3, 'pick names the games');
ok(V.pickProblems(e).length === 0 && V.pickProblems({ kind: 'x' }).length === 4, 'pick shape check');
let next = V.applyPick(base, e);
ok(next.preferences.length === 1 && next.preferences[0].axis === 'look' && next.notes.at(-1).startsWith('preference (look): the person chose "Pixel office"'), 'pick goes into preferences and notes');
ok(next.notes.includes('lookup skipped') && !base.preferences, 'earlier notes kept, plan not mutated');
next = V.applyPick(next, { ...e, chosen: { ...e.chosen, label: 'Paper desk', value: 'paper' } });
ok(next.preferences.length === 1 && next.notes.filter((n) => n.startsWith('preference (look)')).length === 1 && next.preferences[0].chosen.label === 'Paper desk', 'a later pick on the same axis replaces the earlier one');

// the next plan uses it
const wp = V.withPreferences(next, { intent: 'x' }, 'a cooking game');
ok(wp.context.plan.spec.theme.look === 'paper' && wp.brief.notes.includes('Paper desk'), 'a look preference sets the next look');
const wp2 = V.withPreferences(next, {}, 'a neon cooking game');
ok(wp2.context.plan.spec.theme.look === base.plan.spec.theme.look && wp2.brief.notes.includes('Paper desk'), 'a named style beats the preference');
ask = stubAsk((p, user) => ({ alternatives: [{ label: 'Steep', value: user.includes('Paper desk') ? 'start: a; mid: b; end: c' : 'missing' }] }));
pv = await V.planVariants({ request: 'Fruit Ninja but I slice spam emails and must avoid the boss', context: next, n: 2 }, { ask });
ok(pv.variants[1].axis !== 'look' && pv.variants[1].value.startsWith('start'), `the next round explores another axis and sees the pick: ${pv.variants[1].axis}`);

console.log(`variants: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
