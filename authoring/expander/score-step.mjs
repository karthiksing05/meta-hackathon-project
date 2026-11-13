// The score step of the pipeline (docs/HARNESS_V2.md "Score verification"), after the gate and polish,
// for games whose manifest has a `score` block:
//   1. the code checks (playtest/score-check.mjs, through studio.scoreCheck on the gate's runs);
//   2. the Muse review (prompts.mjs scoreReview, muse-wonder-1.0, high effort), only when the code
//      checks pass or are unsure;
//   3. at most one repair of the score part (prompts.mjs repairPart: the part plus goal, constraints
//      and end), then the checks and the review again;
//   4. still failing: the game ships with `ranked: false` (an honest unranked board).
// The game itself never changes here: a score repair changes only the model.
//
// Pure: Muse comes in as `call(system, user, purpose, options) → text`.

import * as P from './prompts.mjs';
import { normalizeScore, unknownScoreEvents, scoreParts, PART_DEPENDS } from './score.mjs';

export const MAX_SCORE_REPAIRS = 1;
/** The review gives up after this many ms and the code checks decide (P.SCORE_REVIEW_OPTIONS.timeout_s). */
export const REVIEW_TIMEOUT_MS = 60000;
/** The reason an unranked board gives when no bot could finish a finished-only run. */
export const BOTS_CANT_JUDGE = "the test bots couldn't finish a run, so they can't judge this score";

/** Resolves to the promise's value, or rejects with a TimeoutError after ms. */
function withTimeout(promise, ms) {
  let timer;
  const t = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`no answer in ${Math.round(ms / 1000)} s`), { name: 'TimeoutError' })), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

const failsOf = (check) => (check?.checks ?? []).filter((c) => c.status === 'fail');

/** "highest first" / "fastest first" for event summaries. */
export function orderText(model) {
  if (model?.direction === 'lower') return model.source === 'time' ? 'fastest first' : 'lowest first';
  return model?.source === 'time' ? 'longest first' : 'highest first';
}

/**
 * expansion: the chosen expansion (studio.expand's object: authoring, score, score_declared, ...).
 * gameJson: the game text the gate played (its runs are what the check replays).
 * Returns {model, ranked, check, review, repaired, authoring_json} or null when there is no score block
 * (the board keeps the old default, and the manifest gets no `score`).
 */
export async function verifyScore({ expansion, gameJson, request = '', spec = null }, studio, { call, emit = () => {}, review: doReview = true, maxRepairs = MAX_SCORE_REPAIRS, reviewTimeoutMs = REVIEW_TIMEOUT_MS } = {}) {
  if (!expansion?.score_declared || typeof studio.scoreCheck !== 'function') return null;
  let model = expansion.score;
  // The planner's spec parts (game-spec/1), when there is one, are what the review and repair read.
  const authoring = spec ? { ...(expansion.authoring ?? {}), spec } : (expansion.authoring ?? {});
  if (model.ranked === false) {
    emit({ kind: 'score_checked', ranked: false, reason: 'the game keeps an unranked board' });
    return { model, ranked: false, check: null, review: null, repaired: false, authoring_json: null };
  }

  const out = { model, ranked: false, check: null, review: null, reviews: 0, repaired: false, authoring_json: null, reason: '' };
  const runReview = async (check, m) => {
    emit({ kind: 'score_reviewing' });
    out.reviews++;
    try {
      const text = await withTimeout(call(P.SCORE_REVIEW_SYSTEM, P.scoreReview(scoreParts(authoring, m), check.lines ?? [], check.checks ?? [], request), 'score review', P.SCORE_REVIEW_OPTIONS), reviewTimeoutMs);
      return P.parseScoreReview(text) ?? { ok: null, issues: [], error: 'the review reply was not a verdict' };
    } catch (e) {
      if (e?.name === 'GenerationError') throw e; // cancelled
      return { ok: null, issues: [], error: String(e?.message ?? e) };
    }
  };
  // One round: code checks, then the review when they pass or are unsure. Returns the issues, or [] when ranked.
  const round = async (m) => {
    emit({ kind: 'score_checking' });
    const check = await studio.scoreCheck(gameJson, m);
    out.check = check;
    if (!check.ok) return failsOf(check).map((c) => ({ part: 'score', problem: c.message, fix: '' }));
    if (!doReview) return [];
    const r = await runReview(check, m);
    out.review = r;
    if (r.ok === true) return [];
    // No verdict (Muse unreachable or unreadable): the code checks decide, and unsure isn't enough.
    if (r.ok === null) return check.ambiguous ? (check.checks ?? []).filter((c) => c.status === 'warn').map((c) => ({ part: 'score', problem: c.message, fix: '' })) : [];
    return r.issues.length ? r.issues : [{ part: 'score', problem: 'The review found the score unfair.', fix: '' }];
  };

  let issues = await round(model);
  // No bot finished a finished-only run: the bots can't judge the score, which is not the score's fault.
  // No repair (it used to move points games to counts_when "finished" and make it worse); an honest
  // unranked board with that reason.
  const fails = failsOf(out.check);
  if (fails.length && fails.every((c) => c.id === 'finish')) {
    out.ranked = false;
    out.reason = BOTS_CANT_JUDGE;
    out.botsCantJudge = true;
    const { ranked: _r0, ...plain0 } = model;
    out.model = { ...plain0, ranked: false };
    emit({ kind: 'score_checked', ranked: false, order: orderText(model), reason: out.reason });
    return out;
  }
  for (let n = 0; issues.length && n < maxRepairs; n++) {
    emit({ kind: 'score_repairing', issues: issues.map((i) => i.problem) });
    const parts = scoreParts(authoring, model);
    const deps = Object.fromEntries(PART_DEPENDS.score.map((p) => [p, parts[p]]));
    let fixed = null;
    try {
      const text = await call(P.REPAIR_PART_SYSTEM, P.repairPart('score', model, issues, deps), 'score repair', P.REPAIR_PART_OPTIONS);
      const obj = P.replyObject(text);
      fixed = obj?.score ?? (obj && obj.kind ? obj : null);
    } catch (e) {
      if (e?.name === 'GenerationError') throw e;
    }
    if (!fixed) break;
    const { bounds: _drop, ...rest } = fixed;
    const n2 = normalizeScore(rest);
    let game = null;
    try { game = JSON.parse(gameJson); } catch { /* checked by the engine anyway */ }
    if (n2.diagnostics.some((d) => d.severity === 'error') || (game && unknownScoreEvents(n2.score, game).length)) break;
    // The plan's score wins here too: a repair that moves a score of the plan's kind to another kind is the
    // drift compose just undid (Kevin32 #17 rerun: a story's points score repaired into time_to_complete).
    if (spec?.score?.kind && model.kind === spec.score.kind && n2.score.kind !== model.kind) { out.repairRejected = `kept the plan's ${model.kind} (the repair wanted ${n2.score.kind})`; break; }
    model = n2.score;
    out.repaired = true;
    out.authoring_json = JSON.stringify({ ...(expansion.authoring ?? {}), score: rest });
    if (model.ranked === false) { issues = [{ part: 'score', problem: 'The repair marked the board unranked.', fix: '' }]; break; }
    issues = await round(model);
  }

  out.ranked = !issues.length;
  out.reason = issues[0]?.problem ?? '';
  const { ranked: _r, ...plain } = model;
  out.model = { ...plain, ...(out.check?.bounds ? { bounds: out.check.bounds } : {}), ranked: out.ranked };
  emit({ kind: 'score_checked', ranked: out.ranked, order: orderText(model), reason: out.reason });
  return out;
}
