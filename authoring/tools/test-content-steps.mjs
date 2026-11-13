#!/usr/bin/env node
// Tests the build-time content steps in the Studio bundle's expand (maps: docs/harness-gaps/maps.md;
// spot-the-difference scenes: images.md) and the compose rules for the planned content tools
// (prompts.mjs toolRules: maps, melody clips, scenes, zoom pictures). Needs the engine (MG_ENGINE_DIR).
// Usage: node authoring/tools/test-content-steps.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as P from '../expander/prompts.mjs';
import { applyScene } from '../expander/scene-step.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const authoringDir = join(here, '..');
const root = join(authoringDir, '..');
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log(`FAIL ${msg}`); } };
const read = (p) => JSON.parse(readFileSync(join(authoringDir, p), 'utf8'));

// ---- compose rules ----
const ctx = (tools, typeTools = []) => ({ types: [{ id: 't', tools: typeTools }], tools: [], plan: { type_ids: ['t'], tool_ids: tools } });
ok(P.toolRules(ctx([])).length === 0, 'no content tools, no rules');
ok(/"geo" section/.test(P.toolRules(ctx(['map_pin_guess'])).join('\n')), 'maps rule from a planned tool');
const audio = P.toolRules(ctx([], ['melody_clip', 'quiz'])).join('\n');
ok(/one clip per question/.test(audio) && /2-bar/.test(audio) && /straight eighths/.test(audio) && /\(replays \+ 1\) x the longest clip \+ 3600 ms/.test(audio), 'audio rule from a chosen type\'s tools');
ok(/"scene"/.test(P.toolRules(ctx(['diff_spots'])).join('\n')) && /zoom_reveal first/.test(P.toolRules(ctx(['zoom_reveal'])).join('\n')), 'scene and zoom rules');
ok(/drawn as SVG/.test(P.toolRules(ctx(['generated_image'])).join('\n')), 'generated pictures stand in as drawn SVG');
const menu = P.planMenu({ prompt: { fragment_specs: {} } }, { ...ctx(['melody_clip']), plan: { ...ctx(['melody_clip']).plan, spec: { spec: 'game-spec/1' } } });
ok(menu.spec.includes('How to use the planned content tools') && menu.spec.includes('one clip per question'), 'the plan menu carries the tool rules');
const sys = P.system({ prompt: {}, game_format: 'microgame/0.1' });
ok(/never draw maps or write coordinates yourself/.test(sys), 'the system prompt has the maps line');
ok(/keep their real names/.test(sys) && /never photorealistic/.test(sys) && /recorded songs/.test(sys) && !/and no real people\./.test(sys), 'names: real names allowed; no photoreal people; no copied recordings');

// ---- the scene step, pure ----
const scene = read('examples/group_chat_scene.json');
const diffGame = read('examples/group_chat_diff.authoring.json');
const withScene = { ...diffGame, functions: {}, art: { ...diffGame.art, sprites: {} }, content: { ...diffGame.content, scene, scene_count: 5, scene_seed: 3 } };
const s1 = applyScene(withScene), s2 = applyScene(withScene);
ok(s1.diagnostics.length === 0 && s1.manifest.art.sprites.picture_a && s1.manifest.functions.diff_points && !('scene' in s1.manifest.content), 'a scene becomes two sprites and the answer key');
ok(JSON.stringify(s1.manifest) === JSON.stringify(s2.manifest) && s1.report.diffs.length === 5, 'the same scene and seed give the same pair');
ok(applyScene({ ...withScene, content: { scene: { objects: [{ id: 'a', shape: 'blob' }] } } }).diagnostics.some((d) => d.code === 'A_SCENE'), 'a broken scene is an A_SCENE error');
ok(applyScene(diffGame).manifest === diffGame, 'no scene: unchanged');

// ---- through the bundle ----
const context = vm.createContext({ console, setTimeout, clearTimeout, performance });
for (const f of ['FacebookClone/Bubbles/Runtime/web/bubble-kit-microgame-engine.js', 'FacebookClone/Bubbles/Studio/web/microgame-studio.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), context, { filename: f });
}
const S = context.MicrogameStudio;
for (const name of ['map_spotter', 'pin_the_capital', 'state_shapes']) {
  const m = read(`content/geo/examples/${name}.json`);
  const x = JSON.parse(S.expand(JSON.stringify(m)));
  ok(x.ok, `${name}: a geo manifest expands in the bundle (${(x.diagnostics ?? []).filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message}`).join('; ')})`);
  ok(x.ok && x.authoring.geo && !x.game_json.includes('"geo"'), `${name}: the stored authoring keeps geo; the game has the map`);
}
{
  const m = read('content/geo/examples/map_spotter.json');
  const bad = JSON.parse(S.expand(JSON.stringify({ ...m, geo: { ...m.geo, places: ['France', 'Atlantis'], pick: undefined } })));
  const d = bad.diagnostics.find((x) => x.code === 'A_GEO_PLACE');
  ok(!bad.ok && d && d.at === '/geo/places/1' && d.audience === 'model', `an unknown place goes back to Muse: ${JSON.stringify(d)}`);
}
{
  const x = JSON.parse(S.expand(JSON.stringify(withScene)));
  ok(x.ok && x.authoring.content.scene && /diff_points|picture_a/.test(x.game_json), `a scene manifest expands in the bundle (${(x.diagnostics ?? []).filter((d) => d.severity === 'error').map((d) => d.message).join('; ')})`);
  const gate = JSON.parse(await S.gate(x.playtest_game_json, 1));
  ok(gate.runs.length >= 5 && gate.runs.every((r) => r.ok), `the scene game plays: ${gate.summary}`);
}

console.log(`content steps: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
