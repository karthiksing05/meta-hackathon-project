#!/usr/bin/env node
// Tests the story branch of compose (expander/story-compose.mjs) through the Studio bundle, with a fake
// Muse that returns the saved story graphs: a plan with branching_story builds from the graph, the
// story gate plays it, the score check reads the story bots, and group_play compares endings. A graph
// that stays broken falls back to the normal compose. Needs the engine (MG_ENGINE_DIR).
// Usage: node authoring/tools/test-story-compose.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { wantsStory, storyCast } from '../expander/story-compose.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const authoringDir = join(here, '..');
const root = join(authoringDir, '..');
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log(`FAIL ${msg}`); } };

// ---- pure ----
const storyType = { id: 'branching_story_endings', family: 'story_choice', tools: ['choice_story', 'branching_story'] };
ok(wantsStory({ types: [storyType], plan: { type_ids: ['branching_story_endings'] } }), 'a chosen story type');
ok(wantsStory({ types: [], plan: { tool_ids: ['branching_story'] } }), 'a planned branching_story tool');
ok(!wantsStory({ types: [storyType, { id: 'x', tools: [] }], plan: { type_ids: ['x'] } }), 'a story type retrieved but not chosen');
ok(!wantsStory(null) && !wantsStory({}), 'no context');
ok(storyCast({ group: { name: 'Pickle crew', members: [{ name: 'Ana' }] } })?.name === 'Pickle crew' && storyCast({ cast: [{ name: 'B' }] }).members.length === 1 && storyCast({}) === null, 'the cast from the context');

// ---- through the bundle ----
const context = vm.createContext({ console, setTimeout, clearTimeout, performance });
for (const f of ['FacebookClone/Bubbles/Runtime/web/bubble-kit-microgame-engine.js', 'FacebookClone/Bubbles/Studio/web/microgame-studio.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), context, { filename: f });
}
const S = context.MicrogameStudio;
ok(S.version >= 4 && typeof S.storyGate === 'function', `bundle API ${S.version} has storyGate`);
const graphText = (name) => readFileSync(join(authoringDir, 'stories', `${name}.story.json`), 'utf8');
const request = "Choose your own adventure where I'm a medieval peasant trying to become king in 10 choices or less";
const ctx = {
  version: 'harness-context/1', types: [storyType], tools: [], gold_ids: [],
  group: { name: 'Pickle crew', members: [{ name: 'Ana' }, { name: 'Ben' }] },
  plan: { type_ids: ['branching_story_endings'], tool_ids: ['branching_story'], gaps: [],
    spec: { spec: 'game-spec/1', social: { mode: 'same_seed_async', share_line: '{name}: {result} on {title}. Your turn.', result: { kind: 'ending', compare: 'ending', display: '{ending} in {choices} choices' } } } },
};

async function run(replies, c = ctx, media = undefined) {
  const asked = [];
  const ask = async (system, user, purpose) => {
    asked.push({ purpose, user });
    const r = replies[purpose];
    if (r === undefined) throw new Error(`unexpected Muse call: ${purpose}`);
    return typeof r === 'function' ? r(user) : r;
  };
  const events = [];
  const out = JSON.parse(await S.compose(JSON.stringify({ request, brief: { intent: 'become king' }, context: c, polish: false }), ask, (e) => events.push(e), media));
  return { out, asked, events };
}

{ // a valid graph: built from the graph, gated by the story bots, compared by ending
  const { out, asked } = await run({ 'story graph': graphText('kevin_17_peasant_king'), 'score review': '{"ok": true, "issues": []}' });
  const m = out.manifest;
  const authoring = JSON.parse(m.content?.authoring_json ?? '{}');
  ok(asked[0].purpose === 'story graph' && /Pickle crew/.test(asked[0].user) && /Ana/.test(asked[0].user), 'the story ask carries the Group cast');
  ok(!asked.some((a) => a.purpose.startsWith('microgame')), `no microgame draft (${asked.map((a) => a.purpose).join(', ')})`);
  ok((authoring.uses ?? []).some((u) => u.fragment === 'story_vars') && (authoring.uses ?? []).some((u) => u.fragment === 'choice_story'), 'compiled to choice_story + story_vars');
  ok(out.stats.story?.used === true && out.gate.passed === true, `story gate passed: ${out.gate.summary}`);
  ok(/endings 6\/6/.test(out.gate.summary), 'every ending reached by a bot');
  ok(m.group_play?.result?.compare === 'ending' && m.group_play.result.endings?.length === 6 && m.group_play.result.state?.includes('choices_used') && m.group_play.share_line.includes('{result}') && m.group_play.result.display === '{ending} in {choices} choices', `group_play compares endings: ${JSON.stringify(m.group_play?.result)}`);
  ok(m.score?.kind === 'points' && Array.isArray(m.score.events) && m.score.events.includes('ending_reached'), `the story's score model: ${JSON.stringify(m.score)}`);
  ok(out.score && out.score.checks.some((c) => c.id === 'skill_order' && c.status === 'pass'), `score check on the story bots: ${(out.score?.checks ?? []).map((c) => `${c.id} ${c.status}`).join(', ')}`);
  ok(out.score.ranked === true, `ranked: ${out.score.reason}`);
  ok(out.bots.length >= 10, `the story bots are the reported runs (${out.bots.length})`);
}

{ // a graph with a same-button warning gets one repair round; a valid repair is kept
  const { asked, out } = await run({ 'story graph': graphText('kevin_29_office_escape'), 'story repair': graphText('kevin_29_office_escape'), 'score review': '{"ok": true, "issues": []}' });
  ok(asked.filter((a) => a.purpose === 'story repair').length === 1 && /S_SAME_BUTTON/.test(asked.find((a) => a.purpose === 'story repair').user), 'S_SAME_BUTTON triggers one story repair');
  ok(out.stats.story?.used === true, 'still built from the story');
}

{ // a broken graph, still broken after the repair: the normal compose takes over
  const broken = JSON.stringify({ format: 'story-graph/1', title: 'Broken', start: 'a', nodes: [{ id: 'a', text: 'Hi', choices: [{ label: 'Go', to: 'nowhere' }] }] });
  const tide = readFileSync(join(authoringDir, 'games', 'tide_taps.authoring.json'), 'utf8');
  const { asked, out } = await run({ 'story graph': broken, 'story repair': broken, 'microgame draft': tide, 'score review': '{"ok": true, "issues": []}' });
  ok(asked.map((a) => a.purpose).slice(0, 3).join(',') === 'story graph,story repair,microgame draft', `fallback order: ${asked.map((a) => a.purpose).join(', ')}`);
  ok(out.stats.story?.used === false && /fell back/.test(out.stats.story.notes.at(-1)), `fallback noted: ${JSON.stringify(out.stats.story)}`);
  ok(!out.manifest.group_play?.result?.endings, 'a fallback game has no compiled endings');
}

{ // no story in the plan: the normal compose, untouched
  const tide = readFileSync(join(authoringDir, 'games', 'tide_taps.authoring.json'), 'utf8');
  const { asked } = await run({ 'microgame draft': tide, 'score review': '{"ok": true, "issues": []}' }, { ...ctx, types: [{ id: 'tap_game', tools: ['tap_targets'] }], plan: { ...ctx.plan, type_ids: ['tap_game'], tool_ids: [] } });
  ok(asked[0].purpose === 'microgame draft', 'a non-story plan never asks for a story graph');
}

{ // picture art for a story: portraits and stills from muse-image, re-expanded within the 512 KB budget
  const zlib = (await import('node:zlib')).default;
  const C = await import('../expander/image-codec.mjs');
  const deflate = (b) => new Uint8Array(zlib.deflateSync(b, { level: 9 }));
  const decode = (b) => C.decodePNG(b, (x) => new Uint8Array(zlib.inflateSync(x)));
  const calls = [];
  const image = async ({ prompt, purpose }) => {
    calls.push(purpose);
    const lineup = /(\d+) head-and-shoulders portrait busts side by side/.exec(prompt);
    const key = /pure green/.test(prompt) ? [2, 250, 4] : /pure blue/.test(prompt) ? [3, 2, 250] : [250, 3, 248];
    const w = 960, h = lineup ? 480 : 640, data = new Uint8Array(w * h * 4), n = lineup ? Number(lineup[1]) : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = Math.floor(x / (w / Math.max(1, n)));
      const inside = n && Math.hypot(x - (k + 0.5) * (w / n), y - h / 2) < 90;
      data.set(n ? (inside ? [60 + 25 * k, 90, 180, 255] : [...key, 255]) : [x % 256, y % 256, 140, 255], (y * w + x) * 4);
    }
    return { bytes: C.encodePNG({ w, h, data }, deflate) };
  };
  const pctx = { ...ctx, plan: { ...ctx.plan, art: 'image', spec: { ...ctx.plan.spec, theme: { art_style: 'illuminated storybook' } } } };
  const { out } = await run({ 'story graph': graphText('kevin_17_peasant_king'), 'score review': '{"ok": true, "issues": []}', 'story art direction': '{}' }, pctx, { image, decode, deflate });
  const authoring = JSON.parse(out.manifest.content.authoring_json);
  const sv = (authoring.uses ?? []).find((u) => u.fragment === 'story_vars');
  ok(calls.length >= 1 && out.manifest.art_record?.license === 'generated' && out.stats.image_art?.kind === 'story', `story pictures: ${calls.length} image calls, ${JSON.stringify(out.stats.image_art)}`);
  ok(sv?.params?.stills !== undefined && authoring.art?.sprites?.portrait?.image?.startsWith('data:image/'), 'the story carries portraits and stills');
  ok(out.gate.passed && out.manifest.group_play?.result?.compare === 'ending', 'the story still plays and compares endings');
}

console.log(`story compose: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
