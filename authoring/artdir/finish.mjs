// Finishing a game built on its art direction: the five-bot gate, the verifier's fix flow, and two
// proofs against the game on Prod. Writes nothing; returns the new manifest and a record.
//
//   const {manifest, record} = await finish(prodManifest, newGame, {kit, seeded, profile, notes})
//
// - rules hash (testbed/rebuild.mjs rulesHash: everything but `presentation`): a seeded game (Daily,
//   Group or board runs on Prod) must keep it exactly; finish refuses otherwise (record.ok false).
// - replays: every gate run, recorded on the Prod game, replayed on the new one with each tap moved to
//   the same hit target (and a tap on nothing to a spot with nothing, unless an input reads raw pointer
//   positions), gives the same state hash at every input and at the end. This holds for unseeded games too, so new art never changes how a run plays.
// - verifier: verifyAndFix (look, readability, layout fixes, solver) with its own proof; 0 blocking.

import { loadEngine } from '../expander/engine.mjs';
import { playtest } from '../playtest/gate.mjs';
import { verifyAndFix } from '../verify/verify.mjs';
import { hitIndex, remapTap } from '../verify/frames.mjs';
import { apply } from '../playtest/bots.mjs';
import { styleColors } from '../expander/wrap.mjs';
import { rulesHash } from '../testbed/rebuild.mjs';
import { DT } from '../playtest/bots.mjs';

const STD_ROLES = ['bg', 'surface', 'primary', 'secondary', 'accent', 'ink', 'danger'];

/** Does any input read raw pointer positions (`from: {pointer: ...}`)? Then a missed tap matters. */
const readsPointer = (g) => Object.values(g.inputs ?? {}).some((i) => [].concat(i.from ?? []).some((f) => f && typeof f === 'object' && 'pointer' in f));

/** A point no target covers (a missed tap stays a miss after a relayout). */
function emptyPoint(targets, w, h) {
  for (let y = h - 4; y > 0; y -= 12) for (let x = 4; x < w; x += 12) if (hitIndex(targets, x, y) < 0) return { x, y };
  return null;
}

/**
 * One recorded run on the Prod game and on the new one in lockstep: taps that hit a target go to the
 * same target (same relative spot); taps that hit nothing go to an empty spot (only when no input reads
 * raw pointer positions); every other input as recorded. {equal, steps, at}.
 */
export function replayEqual(eng, jsonA, jsonB, { seed, actions = [], maxSteps }) {
  const a = eng.load(jsonA, seed), b = eng.load(jsonB, seed);
  const missesMatter = readsPointer(JSON.parse(jsonA));
  const canvas = JSON.parse(jsonB).presentation?.canvas ?? { w: 360, h: 780 };
  let step = 0, k = 0;
  try {
    while (step < maxSteps && a.phase() === 'playing') {
      let acted = false;
      while (k < actions.length && actions[k].step === step) {
        const act = actions[k].action;
        let mapped = act;
        if (act.kind === 'tap') {
          a.frame(); b.frame();
          const ta = a.hitTargets(), tb = b.hitTargets();
          if (hitIndex(ta, act.x, act.y) < 0 && !missesMatter) { const p = emptyPoint(tb, canvas.w, canvas.h); if (p) mapped = { ...act, ...p }; }
          else mapped = remapTap(act, ta, tb);
        }
        apply(a, act); apply(b, mapped); k++; acted = true;
      }
      a.step(DT); b.step(DT); step++;
      if ((acted || step % 60 === 0) && a.stateHash() !== b.stateHash()) return { equal: false, steps: step, at: step };
      if (a.phase() !== b.phase()) return { equal: false, steps: step, at: step };
    }
    return { equal: a.stateHash() === b.stateHash() && a.phase() === b.phase(), steps: step };
  } finally { a.dispose(); b.dispose(); }
}

export async function finish(prod, game, { kit = null, seeded = false, profile = null, notes = {}, engine = null, budgetMs = 240000 } = {}) {
  const eng = engine ?? (await loadEngine()).engine;
  const old = JSON.parse(prod.content.game_json);
  const record = { ok: true, seeded, rulesHash: { prod: rulesHash(old), built: null, same: null } };
  // The authoring manifest carries the kit's type and palette, so the look checks hold the game to it
  // and a remix starts from the same art direction.
  let authoring = prod.content.authoring_json ? JSON.parse(prod.content.authoring_json) : null;
  if (authoring && kit) authoring = { ...authoring, art: { ...(authoring.art ?? {}), type: kit.type, palette: Object.fromEntries(STD_ROLES.map((r) => [r, kit.palette[r]])) } };
  const base = { ...prod, content: { ...prod.content, ...(authoring ? { authoring_json: JSON.stringify(authoring) } : {}), game_json: JSON.stringify(game) } };

  // The gate (five bots) on the new game.
  const gate = await playtest(JSON.stringify(game), { seed: 1, maxSeconds: 120, profile });
  record.gate = { passed: gate.passed, profile: gate.profile, blocking: gate.flags.filter((f) => f.blocking).map((f) => f.code), bots: gate.runs.map((r) => ({ bot: r.bot?.label, score: r.score, end: r.phase ?? r.end })) };

  // The verifier's whole flow.
  const res = await verifyAndFix(base, { runs: gate.runs, engine: eng, budgetMs });
  const built = res.game;
  record.verifier = { blocking: res.report.blocking, warnings: res.report.warnings, byCode: res.report.byCode, stages: res.stages.map((s) => `${s.stage} ${s.blocking ?? s.error}`), fixes: res.fixes.length, proof: { rules: res.proof?.rules, replays: res.proof?.replays } };
  record.findings = res.report.findings.map((f) => ({ code: f.code, severity: f.severity, node: f.node, message: String(f.message ?? '').slice(0, 160) }));

  // Rules hash and replays against Prod.
  record.rulesHash.built = rulesHash(built);
  record.rulesHash.same = record.rulesHash.built === record.rulesHash.prod;
  if (seeded && !record.rulesHash.same) { record.ok = false; record.why = 'seeded game: rules hash changed'; }
  const prodGate = await playtest(JSON.stringify(old), { seed: 1, maxSeconds: 120, profile });
  const maxSteps = Math.round((120 * 1000) / DT);
  const runs = [...prodGate.runs.map((r) => ({ from: 'prod', ...r })), { from: 'idle', replay: { seed: 1, actions: [] }, bot: { label: 'idle' } }];
  const replays = runs.filter((r) => r.replay).map((r) => ({ label: `${r.from}:${r.bot?.label ?? 'run'}`, ...replayEqual(eng, JSON.stringify(old), JSON.stringify(built), { seed: r.replay.seed, actions: r.replay.actions ?? [], maxSteps }) }));
  record.replays = { equal: replays.every((r) => r.equal), runs: replays.map((r) => ({ label: r.label, equal: r.equal, steps: r.steps, ...(r.blockedTap ? { blockedTap: true } : {}) })) };
  if (!record.replays.equal) { record.ok = false; record.why = (record.why ? record.why + '; ' : '') + 'a Prod run plays differently'; }
  if (!gate.passed) { record.ok = false; record.why = (record.why ? record.why + '; ' : '') + 'gate failed'; }
  if (res.report.blocking > 0) { record.ok = false; record.why = (record.why ? record.why + '; ' : '') + `${res.report.blocking} blocking findings`; }

  const manifest = {
    ...base,
    style: { ...(prod.style ?? {}), colors: styleColors(built) },
    content: { ...base.content, game_json: JSON.stringify(built) },
    ...(notes.artRecord ? { art_record: notes.artRecord } : {}),
  };
  return { manifest, record };
}
