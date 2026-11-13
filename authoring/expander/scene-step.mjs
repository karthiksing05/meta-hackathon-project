// The spot-the-difference step (docs/harness-gaps/images.md): a manifest that uses `diff_spots` and
// carries `content.scene` (the scene format in spot-diff.mjs) gets its two pictures and the answer key
// made here, before the expander runs. The scene stays in the stored authoring manifest, so the pair is
// rebuilt the same way every time (same scene + same seed = the same pictures and key; replays verify).
//
// Pure: no disk, no network.

import { makeSpotDifference, toAuthoring } from './spot-diff.mjs';

export const SCENE_DEFAULTS = Object.freeze({ count: 5, seed: 7 });

/**
 * Returns {manifest, diagnostics, report}. Without a scene, or without diff_spots, the manifest comes back
 * unchanged. `content.scene_count` is how many differences (default 5, at most 9) and
 * `content.scene_seed` picks them.
 */
export function applyScene(manifest) {
  const scene = manifest?.content?.scene;
  const use = Array.isArray(manifest?.uses) ? manifest.uses.find((u) => u?.fragment === 'diff_spots') : null;
  if (!scene || typeof scene !== 'object' || !use) return { manifest, diagnostics: [], report: null };
  const out = JSON.parse(JSON.stringify(manifest));
  const count = Number.isInteger(out.content.scene_count) ? out.content.scene_count : SCENE_DEFAULTS.count;
  const seed = Number.isInteger(out.content.scene_seed) ? out.content.scene_seed : SCENE_DEFAULTS.seed;
  const pair = makeSpotDifference(scene, { count, seed });
  delete out.content.scene;
  delete out.content.scene_seed;
  delete out.content.scene_count;
  if (pair.problems.length) {
    return {
      manifest: out,
      diagnostics: pair.problems.map((p) => ({ code: 'A_SCENE', severity: 'error', at: '/content/scene', message: `spot-the-difference scene: ${p}`, hint: 'objects need unique ids, a known shape and its geometry; give at least count+2 small, separate objects that aren\'t fixed' })),
      report: null,
    };
  }
  const pieces = toAuthoring(pair);
  out.art = { ...(out.art ?? {}), sprites: { ...(out.art?.sprites ?? {}), ...pieces.art.sprites } };
  out.functions = { ...(out.functions ?? {}), ...pieces.functions };
  const u = out.uses.find((x) => x?.fragment === 'diff_spots');
  u.params = { ...(u.params ?? {}) };
  if (u.params.scene_w === undefined) u.params.scene_w = pair.w;
  if (u.params.w === undefined) u.params.w = 320;
  if (u.params.h === undefined) u.params.h = Math.min(320, Math.round((u.params.w * pair.h) / pair.w));
  return { manifest: out, diagnostics: [], report: { diffs: pair.diffs.map((d) => `${d.id} ${d.kind}`), seed } };
}
