#!/usr/bin/env node
// Unit tests for gate profiles in bots.mjs (`gateProfile`, `analyze` with `profile`, `pickState`).
// Plain Node, no packages, no engine: node authoring/playtest/test-profiles.mjs (exit 1 on any failure).

import { analyze, skillSpread, gateProfile, decisionBase, pickState, GATE_PROFILES, FAST_WIN_SECONDS } from './bots.mjs';

let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL ${name}${detail !== undefined ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}

const LABELS = ['new player', 'regular', 'pro', 'regular, seed 2', 'regular, seed 3'];
const runs = (outcome, seconds, extra = () => ({})) => LABELS.map((label, i) => ({
  bot: { label }, ok: true, outcome: typeof outcome === 'function' ? outcome(i) : outcome,
  score: 10 + i, seconds: typeof seconds === 'function' ? seconds(i) : seconds, ...extra(i),
}));
const find = (flags, code) => flags.find((f) => f.code === code);
const blocks = (flags) => flags.some((f) => f.blocking);

// --- gateProfile ---
ok(gateProfile(null).name === 'arcade' && gateProfile(null).known, 'no profile is arcade');
ok(gateProfile('Trivia').name === 'trivia', 'names are case-insensitive');
ok(gateProfile('bogus').name === 'arcade' && !gateProfile('bogus').known, 'unknown names fall back to arcade');
for (const name of ['arcade', 'puzzle', 'calm', 'trivia', 'runner', 'opinion', 'story', 'search']) ok(Object.hasOwn(GATE_PROFILES, name), `profile ${name} exists`);
ok(decisionBase({ skill: 0.7 }, gateProfile('arcade')) === 27, 'arcade pace unchanged');
ok(decisionBase({ skill: 0.7 }, gateProfile('search')) === 108, 'search waits 4x longer between taps');
ok(decisionBase({ skill: 0.95 }, gateProfile('trivia')) === 36, 'trivia waits 2x longer');

// --- can't be lost ---
const allWin = runs('success', (i) => 20 + i);
ok(find(analyze(allWin), 'cant_lose')?.blocking === true, "arcade: can't be lost blocks");
for (const name of ['trivia', 'calm', 'puzzle', 'search']) {
  const f = find(analyze(allWin, { profile: name }), 'cant_lose');
  ok(f && !f.blocking, `${name}: can't be lost is a warning`, f);
}
ok(!blocks(analyze(allWin, { profile: 'trivia' })), 'trivia: an unlosable 20 s quiz passes');

// --- every bot wins fast ---
const fast = runs('success', (i) => 11 + i * 0.5);
ok(!find(analyze(fast), 'too_easy'), 'no profile: fast wins are not judged (as before profiles)');
const fastArcade = analyze(fast, { profile: 'arcade' }).filter((f) => f.code === 'too_easy');
ok(fastArcade.length === 1 && fastArcade[0].blocking && fastArcade[0].message.includes('every bot won'), 'arcade: every bot wins under 15 s blocks', fastArcade);
ok(find(analyze(fast, { profile: 'puzzle' }), 'too_easy')?.blocking === true, 'puzzle: fast wins block');
ok(find(analyze(fast, { profile: 'trivia' }), 'too_easy')?.blocking === false, 'trivia: fast wins warn');
ok(!find(analyze(runs('success', (i) => FAST_WIN_SECONDS + i), { profile: 'arcade' }), 'too_easy'), 'wins at 15 s and over are fine');
ok(!find(analyze(runs((i) => (i === 0 ? 'fail' : 'success'), 12), { profile: 'arcade' }), 'too_easy'), 'one loss means not every bot won');
const tiny = analyze(runs('success', 4), { profile: 'arcade' });
ok(find(tiny, 'too_short') && tiny.filter((f) => f.code === 'too_easy').length === 0, 'very short runs say too_short, not both');

// --- calm: endless is a warning ---
const endless = runs((i) => (i === 0 ? 'fail' : 'timeout'), (i) => (i === 0 ? 40 : 180));
ok(find(analyze(endless), 'too_easy')?.blocking === true, 'arcade: still going at the limit blocks');
ok(find(analyze(endless, { profile: 'calm' }), 'too_easy')?.blocking === false, 'calm: still going at the limit warns');

// --- opinion ---
const picks = (i) => ({ picks: { picks: [['a', 'b'], ['b', 'a'], ['a', 'a'], ['b', 'b'], ['a', 'b']][i] } });
const good = runs('success', 3, picks);
ok(!blocks(analyze(good, { profile: 'opinion' })), 'opinion: different picks in 3 s pass', analyze(good, { profile: 'opinion' }));
ok(!find(analyze(runs('fail', 3, picks), { profile: 'opinion' }), 'cant_lose'), 'opinion: no loss/skill/score flags');
ok(!find(analyze(runs('success', 3, picks), { profile: 'opinion' }), 'too_short'), 'opinion: pace is not judged');
const same = analyze(runs('success', 5, () => ({ picks: { picks: ['a', 'a'] } })), { profile: 'opinion' });
ok(find(same, 'same_picks')?.blocking, 'opinion: identical picks block', same);
const none = analyze(runs('success', 5, () => ({ picks: {} })), { profile: 'opinion' });
ok(find(none, 'no_pick_state')?.blocking, 'opinion: no pick state blocks', none);
const blank = analyze(runs('success', 5, (i) => ({ picks: { vote: i < 2 ? [] : ['x', String(i)] } })), { profile: 'opinion' });
ok(find(blank, 'no_picks')?.blocking && find(blank, 'no_picks').message.includes('2 of 5'), 'opinion: runs with empty picks block', blank);
const stuck = analyze(runs((i) => (i === 4 ? 'timeout' : 'success'), 5, picks), { profile: 'opinion' });
ok(find(stuck, 'must_finish')?.blocking && find(stuck, 'must_finish').message.includes('regular, seed 3'), 'opinion: a stuck bot blocks', stuck);
const uneven = analyze(runs('success', 5, (i) => ({ picks: { picks: i ? ['a', String(i)] : ['a'] } })), { profile: 'opinion' });
ok(find(uneven, 'uneven_picks') && !find(uneven, 'uneven_picks').blocking, 'opinion: different pick counts warn', uneven);

// --- story ---
const story = analyze(runs((i) => (i % 2 ? 'fail' : 'success'), 6), { profile: 'story' });
ok(!blocks(story), 'story: short random runs that end pass', story);
ok(find(analyze(runs('timeout', 180), { profile: 'story' }), 'never_ends')?.blocking, 'story: no ending blocks');
ok(!find(story, 'same_picks') && !find(story, 'no_pick_state'), 'story: picks are not checked');

// --- unknown profile ---
const unk = analyze(allWin, { profile: 'speedrun' });
ok(find(unk, 'unknown_profile') && !find(unk, 'unknown_profile').blocking, 'unknown profile warns');
ok(find(unk, 'cant_lose')?.blocking, 'unknown profile uses arcade rules');

// --- pickState ---
const fake = (state) => ({ state: () => JSON.stringify(state) });
const st = { tier_picks: ['a'], my_rating: 3, score_total: 9, __progress: 1, ending: 'king' };
ok(JSON.stringify(Object.keys(pickState(fake(st)))) === JSON.stringify(['tier_picks', 'my_rating', 'ending']), 'pick keys found by name', pickState(fake(st)));
ok(JSON.stringify(pickState(fake(st), ['score_total'])) === '{"score_total":9}', 'named keys win');
ok(JSON.stringify(pickState({ state: () => { throw new Error('x'); } })) === '{}', 'no state, no picks');

// --- skill spread (the twist step's check) ---
const sp = (scores, outcomes = () => 'fail') => LABELS.map((label, i) => ({ bot: { label }, ok: true, outcome: outcomes(i), score: scores[i], seconds: 30 }));
ok(skillSpread(sp([10, 30, 60, 30, 30])).ok, 'pro 60 vs new player 10 is a clear spread');
ok(!skillSpread(sp([55, 58, 60, 57, 58])).clear, 'pro 60 vs 55 is narrow');
ok(skillSpread(sp([50, 50, 50, 50, 50], () => 'success')).maxed, 'all bots maxed without losing');
ok(skillSpread(sp([50, 50, 50, 50, 50], (i) => (i === 2 ? 'success' : 'fail'))).clear, 'expert wins where the novice loses');
ok(skillSpread(sp([9000, 6000, 3000, 6000, 6000]), { direction: 'lower' }).ok, 'lower is better: a faster pro is a spread');
ok(find(analyze(sp([55, 58, 60, 57, 58]).map((r) => ({ ...r, seconds: 30 }))), 'narrow_spread')?.blocking === false, 'narrow spread is a warning');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
