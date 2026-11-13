// Muse makes a microgame, start to finish, in one place for every caller (docs/BUBBLES.md 7.12):
//   gold examples → Muse drafts (design first) → expand + validate → repair (up to 3 rounds)
//   → five-bot gate (one repair for blocking flags) → quality check → one polish round
//   → score check (games with a score block: code checks, Muse review, one score repair) → wrap.
// The server's generator calls it through the Studio bundle (MicrogameStudio.compose); the app's
// MicrogameComposer.swift runs the same steps with the same prompts (MicrogameStudio.prompt).
//
// Pure: Muse is a function the caller passes in, `ask(system, user, purpose, options) → Promise<text>`
// (or {content, model, usage}). options, when given, is {model, effort, max_tokens}: the score review
// asks for muse-wonder-1.0 at high effort; callers that ignore it still work.

import * as P from './prompts.mjs';
import { verifyScore } from './score-step.mjs';
import { normalizeScore, unknownScoreEvents } from './score.mjs';

/** The spec's score as a manifest block: bounds dropped (the bots set them), unknown events dropped. */
export function adoptSpecScore(specScore, game) {
  const { bounds: _b, reason: _r, ...block } = specScore;
  const unknown = new Set(unknownScoreEvents({ events: Array.isArray(block.events) ? block.events : [] }, game ?? {}));
  if (Array.isArray(block.events)) {
    block.events = block.events.filter((e) => !unknown.has(e));
    if (!block.events.length) delete block.events;
  }
  const n = normalizeScore(block);
  if (n.diagnostics.some((d) => d.severity === 'error')) return null;
  return { score: n.score, block };
}

export const MAX_REPAIR_ROUNDS = 3;
export const BOT_COUNT = 5;

/** One short, human-readable line for "Muse at work" screens, so apps never word events themselves. */
export function summarize(e) {
  switch (e.kind) {
    case 'drafting': return e.attempt === 1 ? 'Muse is drafting the game' : 'Muse is drafting it again';
    case 'expanding': return 'Building and checking the game';
    case 'repairing': {
      const n = e.issues.length;
      return `Fixing ${n} ${n === 1 ? 'issue' : 'issues'}` + (e.round > 1 ? ` (round ${e.round})` : '');
    }
    case 'polishing': {
      const n = e.issues.length;
      return `Polishing ${n} ${n === 1 ? 'detail' : 'details'}`;
    }
    case 'playtesting': return `${e.bots} test players are trying it`;
    case 'playtested': return e.passed ? `Playtested: ${e.headline}` : `Playtest flagged: ${e.headline}`;
    case 'score_checking': return 'Checking the score is fair…';
    case 'score_reviewing': return 'Muse is reviewing the score';
    case 'score_repairing': return 'Fixing the score';
    case 'score_checked': return e.ranked ? `Score checked: ranked board, ${e.order}` : `Unranked board${e.reason ? `: ${e.reason}` : ''}`;
    case 'done': return `${e.title} is ready`;
    case 'failed': return `Couldn't finish: ${e.reason}`;
    default: return '';
  }
}

export class GenerationError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'GenerationError';
    this.issues = issues;
  }
}

function slug(text) {
  let out = String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (out.length > 32) out = out.slice(0, 32).replace(/-+$/, '');
  return out;
}

function randomSuffix() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/** The app's brief uses snake_case on the wire; accept camelCase too. */
export function normalizeBrief(b = {}) {
  const brief = {
    intent: String(b.intent ?? '').trim(),
    audience: String(b.audience ?? 'everyone').trim() || 'everyone',
    mood: Array.isArray(b.mood) && b.mood.length ? b.mood.map(String) : ['playful'],
    energy: String(b.energy ?? 'medium'),
    competition: String(b.competition ?? 'light'),
  };
  if (b.occasion) brief.occasion = String(b.occasion);
  const sources = b.content_sources ?? b.contentSources;
  if (Array.isArray(sources) && sources.length) brief.content_sources = sources.map(String);
  if (b.notes) brief.notes = String(b.notes);
  return brief;
}

const blockingOf = (report) => (report.flags ?? []).filter((f) => f.blocking);

/**
 * studio: { catalog(), examples(request, k), expand(text), gate(gameJSON, seed), quality(text, request), wrap(opts) },
 * each returning a parsed object (gate a Promise). opts: { ask, onEvent, signal, maxRepairRounds, polish }.
 * Returns { manifest, stats, bots, gate, quality }. Throws GenerationError when the game never validates.
 */
export async function composeGame({ request, brief, base = null, context = null }, studio, { ask, onEvent = () => {}, signal, maxRepairRounds = MAX_REPAIR_ROUNDS, polish = true, scoreCheck = true, scoreReview = true } = {}) {
  const started = Date.now();
  const stats = { firstDraftValid: null, repairRounds: 0, playtestRepair: false, passedGate: false, polished: false, museCalls: 0, models: [], examples: [], seconds: 0, calls: [] };
  const emit = (e) => onEvent({ ...e, summary: summarize(e) });
  const live = () => { if (signal?.aborted) throw new GenerationError('The job was cancelled or ran out of time.'); };
  // Every Muse call is logged with its wall time and, when the caller returns it, its token usage.
  const call = async (system, user, purpose, options) => {
    live();
    const t0 = Date.now();
    const r = await (options ? ask(system, user, purpose, options) : ask(system, user, purpose));
    stats.museCalls++;
    const text = typeof r === 'string' ? r : r?.content ?? '';
    const model = typeof r === 'object' && r?.model;
    if (model && !stats.models.includes(model)) stats.models.push(model);
    stats.calls.push({ purpose, ms: Date.now() - t0, chars: { system: system.length, user: user.length }, ...(model ? { model } : {}), ...(typeof r === 'object' && r?.usage ? { usage: r.usage } : {}) });
    return text;
  };
  request = String(request ?? '').trim();

  try {
    brief = normalizeBrief(brief ?? base?.brief ?? {});
    const catalog = studio.catalog();
    // A revision is matched on what the game is, plus what's being asked.
    const lookup = base ? `${base.title ?? ''}. ${base.one_line_rule ?? ''} ${request}` : request;
    let examples = null;
    try {
      const ex = studio.examples(lookup, 2, Array.isArray(context?.gold_ids) ? context.gold_ids : null);
      examples = ex.text;
      stats.examples = ex.ids ?? [];
    } catch { /* fall back to the catalog's examples */ }
    // A harness context trims the menu to the plan's tools and adds the spec (prompts.mjs planMenu).
    const system = P.system(catalog, { examples, context });
    stats.systemChars = system.length;
    const gateOptions = context?.gate_profile ? { gate_profile: String(context.gate_profile) } : undefined;
    const first = base ? P.revise(base.authoring_json, request, brief) : P.compose(request, brief);

    let reply;
    let lastError;
    for (let attempt = 1; attempt <= 2 && reply === undefined; attempt++) {
      emit({ kind: 'drafting', attempt });
      try { reply = await call(system, first, 'microgame draft'); } catch (e) { lastError = e; }
    }
    if (reply === undefined) throw lastError ?? new GenerationError('Muse returned no manifest.');

    // Expand, repair, gate (one more repair for blocking flags). Keeps the best valid version.
    let repairs = 0;
    let playtestRepairUsed = false;
    let best = null;
    let chosen = null;
    while (!chosen) {
      live();
      emit({ kind: 'expanding' });
      const expansion = studio.expand(reply);
      const shown = expansion.authoring_json ?? reply;
      if (stats.firstDraftValid === null) stats.firstDraftValid = !!expansion.ok;
      if (!expansion.ok) {
        const issues = P.issues(expansion);
        if (repairs >= maxRepairRounds) {
          if (best) { chosen = best; break; }
          throw new GenerationError(`Muse's microgame still doesn't validate: ${issues[0] ?? 'unknown error'}`, issues);
        }
        repairs++;
        stats.repairRounds = repairs;
        emit({ kind: 'repairing', round: repairs, issues });
        reply = await call(system, P.repair(request, shown, issues, repairs), `microgame repair ${repairs}`);
        continue;
      }
      emit({ kind: 'playtesting', bots: BOT_COUNT });
      const report = await studio.gate(expansion.playtest_game_json || expansion.game_json, 1, gateOptions);
      const blocking = blockingOf(report);
      emit({ kind: 'playtested', passed: !!report.passed, headline: report.summary ?? '', blocking: blocking.map((f) => `${f.code}: ${f.message}`) });
      if (report.passed) {
        stats.passedGate = true;
        chosen = { expansion, report };
        break;
      }
      if (!best || blocking.length < blockingOf(best.report).length) best = { expansion, report };
      if (playtestRepairUsed) { chosen = best; break; }
      playtestRepairUsed = true;
      stats.playtestRepair = true;
      emit({ kind: 'repairing', round: repairs + 1, issues: blocking.map((f) => `${f.code}: ${f.message}`) });
      reply = await call(system, P.playtestRepair(request, shown, report), 'microgame playtest repair');
    }

    // Polish: a new game that passed the bots but reads as unfinished gets one more round. The
    // polished version ships only if it validates, passes the bots and scores higher.
    let quality = studio.quality(chosen.expansion.authoring_json, base ? '' : request);
    if (polish && !base && chosen.report.passed && P.needsPolish(quality)) {
      try {
        emit({ kind: 'polishing', issues: quality.lines });
        const text = await call(system, P.polish(request, chosen.expansion.authoring_json, quality.lines), 'microgame polish');
        emit({ kind: 'expanding' });
        const expansion = studio.expand(text);
        if (expansion.ok) {
          const q2 = studio.quality(expansion.authoring_json, request);
          if (q2.score > quality.score) {
            emit({ kind: 'playtesting', bots: BOT_COUNT });
            const report = await studio.gate(expansion.playtest_game_json || expansion.game_json, 1, gateOptions);
            emit({ kind: 'playtested', passed: !!report.passed, headline: report.summary ?? '', blocking: blockingOf(report).map((f) => `${f.code}: ${f.message}`) });
            if (report.passed) {
              chosen = { expansion, report };
              quality = q2;
              stats.polished = true;
            }
          }
        }
      } catch (e) {
        if (e instanceof GenerationError) throw e;
        // Polish is a bonus: a failed Muse call keeps the game that already passed.
      }
    }

    let { expansion } = chosen;
    // The score step: games with a score block get a checked model (bounds, ranked) on the manifest.
    let score = null;
    // A plan whose spec has a score, and a manifest without one: the spec's score, with events this game has.
    const specScore = context?.plan?.spec?.score;
    if (!expansion.score_declared && specScore && typeof specScore === 'object') {
      const adopted = adoptSpecScore(specScore, expansion.game);
      if (adopted) expansion = { ...expansion, score: adopted.score, score_declared: true, authoring: { ...expansion.authoring, score: adopted.block }, authoring_json: JSON.stringify({ ...expansion.authoring, score: adopted.block }) };
    }
    if (scoreCheck && expansion.score_declared && typeof studio.scoreCheck === 'function') {
      score = await verifyScore({ expansion, gameJson: expansion.playtest_game_json || expansion.game_json, request, spec: context?.plan?.spec ?? null }, studio, { call, emit, review: scoreReview });
      if (score?.authoring_json) expansion = { ...expansion, authoring_json: score.authoring_json };
      stats.score = score ? { ranked: score.ranked, repaired: score.repaired, reviews: score.reviews ?? 0, review: score.review?.ok ?? null } : null;
    }
    const title = expansion.game?.meta?.title ?? 'microgame';
    const manifest = studio.wrap({
      id: base?.id ?? `mg-${slug(title) || 'game'}-${randomSuffix()}`,
      game_json: expansion.game_json,
      authoring_json: expansion.authoring_json,
      brief,
      seed: base?.seed ?? 1 + Math.floor(Math.random() * 999999),
      ...(base?.emoji ? { emoji: base.emoji } : {}),
      ...(score?.model ? { score: score.model } : {}),
    });
    stats.seconds = Math.round((Date.now() - started) / 100) / 10;
    stats.quality = quality.score;
    manifest.studio = { models: stats.models, created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), duration_sec: stats.seconds, offline: false };
    emit({ kind: 'done', title: manifest.title ?? title });
    const bots = (chosen.report.runs ?? []).map((r) => ({ skill: Number(r.bot?.skill ?? 0), score: Math.round(Number(r.score ?? 0)), sec: Math.round(Number(r.seconds ?? 0) * 10) / 10 }));
    const scoreReport = score ? { ranked: score.ranked, repaired: score.repaired, reason: score.reason || null, checks: score.check?.checks ?? [], review: score.review ?? null, bounds: score.check?.bounds ?? null } : null;
    return { manifest, stats, bots, gate: { passed: !!chosen.report.passed, summary: chosen.report.summary ?? '' }, quality, score: scoreReport };
  } catch (e) {
    stats.seconds = Math.round((Date.now() - started) / 100) / 10;
    emit({ kind: 'failed', reason: e?.message ?? String(e), issues: e?.issues });
    if (e && typeof e === 'object') e.stats = stats;
    throw e;
  }
}
