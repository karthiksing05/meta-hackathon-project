#!/usr/bin/env node
// Rebuilds a made game from its stored authoring manifest with no Muse calls: re-expand
// content.authoring_json with the current fragments and expander (deterministic), run the bot gate,
// then the verifier's fix flow (layout-fix.mjs code fixes, the solver, the proof). Picture art comes
// along for free: image-art writes its pictures into the authoring manifest's `art`, so the re-expand
// draws them again.
//
//   node authoring/testbed/rebuild.mjs <manifest.json> --out <dir> [--tall] [--edits <edits.json>] [--no-fix]
//
// --tall sets look.canvas "tall" (360 × 780). --edits applies a JSON merge patch to the authoring
// manifest first (content only: fonts, palette tokens; never rules). Writes <dir>/manifest.json and
// <dir>/rebuild.json (gate, verifier stages, proof). Needs MG_ENGINE_DIR.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandAndValidate } from '../expander/cli.mjs';
import { playtest } from '../playtest/gate.mjs';
import { verifyAndFix } from '../verify/verify.mjs';
import { loadEngine } from '../expander/engine.mjs';
import { liftToTall, proveLift } from './legacy-tall.mjs';

/** RFC 7386 merge patch (null deletes). */
export function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

/** A hash of everything in a game but its presentation: equal hashes, the same rules (seeded runs still verify). */
export function rulesHash(game) {
  const g = typeof game === 'string' ? JSON.parse(game) : game;
  const { presentation: _p, ...rules } = g ?? {};
  return createHash('sha256').update(JSON.stringify(rules)).digest('hex').slice(0, 16);
}

/**
 * manifest: a built game (content.authoring_json). opts: {tall, edits, fix (default true), engine}.
 * Returns {manifest, record}.
 */
export async function rebuild(manifest, { tall = false, edits = null, fix = true, engine = null, maxSeconds = 120, profile = null } = {}) {
  const eng = engine ?? (await loadEngine()).engine;
  // edits: a merge patch, plus `__replace: [[from, to], ...]` for words inside lists (the patch
  // can't reach into arrays). Content only: never rules.
  let text = manifest.content.authoring_json;
  for (const [from, to] of edits?.__replace ?? []) text = text.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1));
  let authoring = JSON.parse(text);
  if (edits) { const { __replace: _r, ...patch } = edits; authoring = mergePatch(authoring, patch); }
  // A manifest written for 360 × 640 (no look.canvas) keeps its coordinates and is lifted onto the
  // tall canvas as a whole (legacy-tall.mjs); one written for the tall canvas expands as it is.
  let r = await expandAndValidate({ formula: 'microgame', content: { authoring_json: JSON.stringify(authoring) } });
  let asBuilt = false;
  if (r.errors.length) {
    // A game made with fragments the library has since moved past (an older version): keep its
    // stored game as built and fix only its presentation.
    if (!r.errors.some((e) => e.code === 'A_FRAGMENT_VERSION') || !manifest.content.game_json) return { manifest: null, record: { ok: false, errors: r.errors.slice(0, 8) } };
    const built = JSON.parse(manifest.content.game_json);
    r = { game: built, playtestGame: built, errors: [] };
    asBuilt = true;
  }
  // The gate plays the playtest copy (the model's progress and text candidates), as the pipeline does.
  const gate = await playtest(JSON.stringify(r.playtestGame ?? r.game), { seed: 1, maxSeconds, profile });
  const record = { ok: true, asBuilt, gate: { passed: gate.passed, profile: gate.profile, flags: gate.flags.filter((f) => f.blocking).map((f) => f.code) } };
  let game = r.game;
  if (tall) {
    const lifted = liftToTall(game);
    if (lifted) {
      const proof = await proveLift(game, lifted, { runs: gate.runs, engine: eng });
      record.lift = { rules: proof.rules, replays: proof.replays, diff: proof.diff, failed: proof.runs.filter((x) => !x.equal).map((x) => x.label) };
      if (proof.rules && proof.replays) game = lifted;
    }
  }
  // Bot runs for the verifier, in the game's own coordinates.
  const runs = game === r.game ? gate.runs : gate.runs.map((run) => ({ ...run, replay: run.replay && { ...run.replay, actions: (run.replay.actions ?? []).map((a) => (a.action.kind === 'tap' ? { ...a, action: { ...a.action, y: a.action.y + 70 } } : a)) } }));
  if (fix) {
    // As a manifest, so the look stage and the look checks read the game's own art.type, id and words.
    const res = await verifyAndFix({ ...manifest, content: { ...manifest.content, authoring_json: JSON.stringify(authoring), game_json: JSON.stringify(game) } }, { runs, engine: eng });
    record.runs = runs;
    game = res.game;
    record.stages = res.stages.map((s) => `${s.stage} ${s.blocking}`);
    record.fixes = res.fixes.map((f) => `${f.stage}:${f.kind} ${f.node ?? ''} ${f.detail ?? ''}`.trim());
    record.proof = { rules: res.proof.rules, replays: res.proof.replays, blockedTaps: res.proof.blockedTaps ?? 0, reverted: !!res.reverted };
    record.blocking = res.report.blocking;
    record.byCode = res.report.byCode;
  }
  // Against the game on Prod: the same rules hash means its seeded runs and boards still verify.
  if (manifest.content.game_json) record.sameRules = rulesHash(manifest.content.game_json) === rulesHash(game);
  const out = { ...manifest, content: { ...manifest.content, authoring_json: JSON.stringify(authoring), game_json: JSON.stringify(game) } };
  return { manifest: out, record };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const file = args[0];
  const out = resolve(opt('--out') ?? 'rebuild-out');
  mkdirSync(out, { recursive: true });
  const m = JSON.parse(readFileSync(file, 'utf8'));
  const edits = opt('--edits') ? JSON.parse(readFileSync(opt('--edits'), 'utf8')) : null;
  const { manifest, record } = await rebuild(m, { tall: args.includes('--tall'), edits, fix: !args.includes('--no-fix'), profile: opt('--profile') });
  if (manifest) writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(out, 'rebuild.json'), JSON.stringify(record, null, 2));
  console.log(`${file}: ${record.ok ? `gate ${record.gate.passed ? 'pass' : 'FAIL ' + record.gate.flags.join(',')}; ${record.stages?.join(' → ') ?? ''}; proof ${JSON.stringify(record.proof ?? {})}` : 'expand errors ' + JSON.stringify(record.errors)}`);
}
