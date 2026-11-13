// The blocking layout verifier as a compose hook (authoring/verify/verify.mjs verifyAndFix). Node only: the
// verifier reads its checks from disk and can measure with Chrome, so studio.mjs never imports this file and
// it stays out of the Studio bundle. Callers pass it to compose as hooks.verifyLayout (the generator's
// src/hooks.mjs does); compose's local studio then has studio.verifyLayout, and the pipeline runs it after
// expand and before the gate.

/**
 * verifyLayout(gameJSON, opts) → {game_json, report, fixes, proof, reverted, stages, ms}.
 * opts: verifyAndFix's ({engine, pixels, runs, maxSeconds, ...}). pixels: false with measures: null runs
 * without Chrome at all (the structural path the generator image uses).
 * report is the verifier's JSON report with findings trimmed to {code, severity, node, frame, message, hint}.
 */
export async function verifyLayout(gameJSON, opts = {}) {
  const t0 = Date.now();
  const { verifyAndFix } = await import('../verify/verify.mjs');
  const game = typeof gameJSON === 'string' ? JSON.parse(gameJSON) : gameJSON;
  const res = await verifyAndFix(game, opts);
  const { findings = [], ...rest } = res.report ?? {};
  return {
    game_json: JSON.stringify(res.game),
    report: { ...rest, findings: findings.map((f) => ({ code: f.code, severity: f.severity, node: f.node ?? null, frame: f.frame ?? null, message: f.message, hint: f.hint ?? null })) },
    fixes: res.fixes ?? [],
    proof: res.proof ?? null,
    reverted: !!res.reverted,
    stages: res.stages ?? [],
    ms: Date.now() - t0,
  };
}
