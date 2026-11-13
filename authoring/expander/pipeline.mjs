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
import { groupPlayBlock, structureFor } from './group-play.mjs';
import { wantsStory, composeStory } from './story-compose.mjs';
import { makeImageArt, applyImageArt, makeStoryArt, applyStoryArt } from './image-art.mjs';
import { repairRequest } from './requirements.mjs';
import { judgeRequirements, needsJudge, readBuilt, repairTargets, gapEntries, honestNote } from '../playtest/requirements-check.mjs';

/** The art budget for games drawn by muse-image (svg.mjs SVG_LIMITS.image_art_bytes). */
export const IMAGE_ART_BUDGET = 512 * 1024;

/** Whether this job draws its pictures with muse-image: the plan asks for it and the caller can make images. */
export function wantsImageArt(context, media) {
  return context?.plan?.art === 'image' && typeof media?.image === 'function' && typeof media?.decode === 'function' && typeof media?.deflate === 'function';
}

/**
 * The spec's score as a manifest block: bounds dropped (the bots set them), unknown events dropped.
 * fallbackEvents: the game's own score events, used when none of the spec's events exist in the game.
 */
export function adoptSpecScore(specScore, game, fallbackEvents = null) {
  const { bounds: _b, reason: _r, ...block } = specScore;
  const unknown = new Set(unknownScoreEvents({ events: Array.isArray(block.events) ? block.events : [] }, game ?? {}));
  if (Array.isArray(block.events)) {
    block.events = block.events.filter((e) => !unknown.has(e));
    if (!block.events.length) delete block.events;
  }
  if (!block.events && Array.isArray(fallbackEvents) && fallbackEvents.length) block.events = [...fallbackEvents];
  const n = normalizeScore(block);
  if (n.diagnostics.some((d) => d.severity === 'error')) return null;
  return { score: n.score, block };
}

/** The top type's match score above which one gold example is enough (the examples are most of the prompt). */
export const CONFIDENT_MATCH = 0.85;

/**
 * How many gold examples compose shows: 1 when the plan's top type is a confident catalog match (not
 * learned from the web), else 2. Gold examples are about 45k characters each (Kevin32: a median system
 * prompt of 126k characters).
 */
export function goldCount(context) {
  const top = Array.isArray(context?.types) ? context.types[0] : null;
  const confident = !!top && top.source !== 'learned' && Number(top.match?.score) >= CONFIDENT_MATCH;
  return confident ? 1 : 2;
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
    case 'drawing': return 'Muse is drawing the pictures';
    case 'verifying': return 'Checking the layout';
    case 'verified': return e.pass ? `Layout checked${e.fixes ? ` (${e.fixes} ${e.fixes === 1 ? 'fix' : 'fixes'})` : ''}` : `Layout: ${e.blocking} blocking ${e.blocking === 1 ? 'problem' : 'problems'}`;
    case 'layout_fixed': return `Tidied the layout (${e.count} ${e.count === 1 ? 'fix' : 'fixes'})`;
    case 'requirements_checked': return e.must_total ? `Checked what you asked for: ${e.must_passed} of ${e.must_total} must-haves` : 'Checked what you asked for';
    case 'drawn': return e.ok ? `Drew ${e.pictures} pictures` : `Kept the drawn-in art: ${e.reason}`;
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
export async function composeGame({ request, brief, base = null, context = null }, studio, { ask, onEvent = () => {}, signal, maxRepairRounds = MAX_REPAIR_ROUNDS, polish = true, scoreCheck = true, scoreReview = true, media = null, hooks = null } = {}) {
  // Server-side hooks the caller passes in (functions, so not bundled or sent as JSON): image/decode/deflate
  // for picture art, fixLayout/layoutCheck (expander/layout-fix.mjs, playtest/layout-check.mjs) for layout.
  const H = hooks ?? media ?? {};
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
  // The canvas (context.canvas, the generator's GENERATOR_CANVAS): "tall" builds 360 × 780 games (canvas.mjs),
  // anything else the classic 360 × 640. Every expand in this compose (stories too) gets it; a manifest's own
  // look.canvas still wins.
  const canvas = context?.canvas === 'tall' ? 'tall' : 'classic';
  if (canvas === 'tall') {
    const inner = studio;
    studio = { ...inner, expand: (text, options) => inner.expand(text, { canvas: 'tall', ...(options ?? {}) }) };
  }
  stats.canvas = canvas;
  // Fonts and vibe (the UI kit, pending its hook requests): the plan's context.plan.spec.theme.type and the vibe's
  // font pairing get read here and passed to expand next to the canvas, the same way.
  const engineOf = () => { try { return typeof studio.engine === 'function' ? studio.engine() : null; } catch { return null; } };
  // Layout fixes in code (layout-fix.mjs), after expand and before the gate: presentation only, so rules
  // and replays don't change. On unless context.layout_fix is false; without Chrome only the structural
  // fixes run. Any failure keeps the game as it was.
  const layoutPass = async (expansion) => {
    if (context?.layout_fix === false || typeof H.fixLayout !== 'function' || !expansion?.game_json) return expansion;
    try {
      const engine = engineOf();
      const r = await H.fixLayout(JSON.parse(expansion.game_json), { engine });
      const count = r?.fixes?.length ?? 0;
      stats.layoutFixes = (stats.layoutFixes ?? 0) + count;
      if (!count || !r.game) return expansion;
      let playtest = expansion.playtest_game_json;
      if (playtest) {
        const r2 = await H.fixLayout(JSON.parse(playtest), { engine });
        playtest = JSON.stringify(r2?.game ?? JSON.parse(playtest));
      }
      emit({ kind: 'layout_fixed', count });
      return { ...expansion, game: r.game, game_json: JSON.stringify(r.game), ...(playtest ? { playtest_game_json: playtest } : {}) };
    } catch (e) {
      stats.layoutFixError = String(e?.message ?? e).slice(0, 200);
      return expansion;
    }
  };

  // The blocking verifier (verify/verify.mjs through studio.verifyLayout, a Node-only hook) replaces the
  // fixLayout pass above when it's there: verify, code fixes, solver, re-verify, and a proof that rules and
  // replays are unchanged. Its fixed presentation goes into both game_json and playtest_game_json (the playtest
  // copy adds only hidden state and rules), and only when it fixed something and reverted nothing.
  // Returns {expansion, report, reverted}, or null without the hook or when it fails.
  const verifying = () => typeof studio.verifyLayout === 'function' && context?.layout_fix !== false;
  const verifyPass = async (expansion) => {
    if (!verifying() || !expansion?.game_json) return null;
    emit({ kind: 'verifying' });
    const t0 = Date.now();
    let v;
    try {
      v = await studio.verifyLayout(expansion.game_json, { engine: engineOf() });
    } catch (e) {
      if (e?.name === 'GenerationError') throw e;
      stats.layoutVerifyError = String(e?.message ?? e).slice(0, 200);
      return null;
    } finally {
      stats.layoutVerifyMs = (stats.layoutVerifyMs ?? 0) + (Date.now() - t0);
    }
    let out = expansion;
    const fixes = v?.fixes?.length ?? 0;
    if (fixes && !v.reverted && v.game_json) {
      const fixed = JSON.parse(v.game_json);
      let playtest = expansion.playtest_game_json;
      if (playtest) {
        const pt = JSON.parse(playtest);
        pt.presentation = fixed.presentation;
        playtest = JSON.stringify(pt);
      }
      out = { ...expansion, game: fixed, game_json: v.game_json, ...(playtest ? { playtest_game_json: playtest } : {}) };
      stats.layoutFixes = (stats.layoutFixes ?? 0) + fixes;
    }
    const report = v?.report ?? { pass: true, blocking: 0, warnings: 0, findings: [] };
    emit({ kind: 'verified', pass: !!report.pass, blocking: report.blocking ?? 0, fixes: out === expansion ? 0 : fixes });
    return { expansion: out, report, reverted: !!v?.reverted };
  };
  const blockingIssues = (report) => (report.findings ?? []).filter((f) => f.severity === 'block').map((f) => `${f.code}${f.node ? ` at ${f.node}` : ''}: ${f.message}${f.hint ? ` Fix: ${f.hint}` : ''}`);
  const layoutStats = (verified) => {
    const r = verified.report;
    stats.layoutBlocking = r.blocking ?? 0;
    stats.layout = { verifier: true, pass: !!r.pass, blocking: r.blocking ?? 0, warnings: r.warnings ?? 0, byCode: r.byCode ?? null, reverted: verified.reverted, ms: r.ms ?? null, findings: (r.findings ?? []).slice(0, 30) };
  };

  try {
    brief = normalizeBrief(brief ?? base?.brief ?? {});
    const catalog = studio.catalog();
    // A revision is matched on what the game is, plus what's being asked.
    const lookup = base ? `${base.title ?? ''}. ${base.one_line_rule ?? ''} ${request}` : request;
    let examples = null;
    try {
      const ex = studio.examples(lookup, goldCount(context), Array.isArray(context?.gold_ids) ? context.gold_ids : null);
      stats.goldExamples = ex.ids?.length ?? null;
      examples = ex.text;
      stats.examples = ex.ids ?? [];
    } catch { /* fall back to the catalog's examples */ }
    // A harness context trims the menu to the plan's tools and adds the spec (prompts.mjs planMenu).
    const system = P.system(catalog, { examples, context });
    stats.systemChars = system.length;
    // trace keeps each run's replay for the requirements check.
    const gateOptions = { trace: true, ...(context?.gate_profile ? { gate_profile: String(context.gate_profile) } : {}) };
    const first = base ? P.revise(base.authoring_json, request, brief) : P.compose(request, brief);

    // Stories (the plan uses branching_story): Muse writes a story graph that our checker walks, the
    // compiler builds and the story bots gate. Anything that fails falls back to the normal compose.
    let chosen = null;
    let story = null;
    if (!base && wantsStory(context) && typeof studio.storyGate === 'function') {
      try {
        story = await composeStory({ request, context, brief }, studio, { call, emit });
      } catch (e) {
        if (e instanceof GenerationError) throw e;
        story = { fallback: String(e?.message ?? e), notes: [] };
      }
      stats.story = { used: !!story.expansion, notes: story.notes ?? [], ...(story.fallback ? { fallback: story.fallback } : {}) };
      if (story.expansion) {
        chosen = { expansion: story.expansion, report: story.report };
        stats.firstDraftValid = true;
        stats.passedGate = true;
      } else stats.story.notes.push(`fell back to the normal compose: ${story.fallback}`);
    }

    if (!chosen) {
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
      // While layout repair rounds run: the valid build with the fewest blocking layout findings, so a repair
      // that breaks the manifest or makes the layout worse never costs the game it started from.
      let layoutBest = null;
      while (!chosen) {
        live();
        emit({ kind: 'expanding' });
        let expansion = studio.expand(reply);
        const shown = expansion.authoring_json ?? reply;
        if (stats.firstDraftValid === null) stats.firstDraftValid = !!expansion.ok;
        let verified = null;
        if (!expansion.ok) {
          const issues = P.issues(expansion);
          if (repairs >= maxRepairRounds) {
            if (best) { chosen = best; break; }
            if (!layoutBest) throw new GenerationError(`Muse's microgame still doesn't validate: ${issues[0] ?? 'unknown error'}`, issues);
            verified = layoutBest;
          } else {
            repairs++;
            stats.repairRounds = repairs;
            emit({ kind: 'repairing', round: repairs, issues });
            reply = await call(system, P.repair(request, shown, issues, repairs), `microgame repair ${repairs}`);
            continue;
          }
        } else verified = await verifyPass(expansion);
        if (verified) {
          if (!verified.report.pass) {
            if (!layoutBest || (verified.report.blocking ?? 0) < (layoutBest.report.blocking ?? 0)) layoutBest = verified;
            if (repairs < maxRepairRounds) {
              // A layout repair round: Muse fixes what the verifier still blocks on, with each finding's hint.
              const issues = blockingIssues(verified.report);
              repairs++;
              stats.repairRounds = repairs;
              stats.layoutRepairs = (stats.layoutRepairs ?? 0) + 1;
              emit({ kind: 'repairing', round: repairs, issues });
              reply = await call(system, P.repair(request, shown, issues, repairs), `microgame layout repair ${repairs}`);
              continue;
            }
            verified = layoutBest;
          }
          expansion = verified.expansion;
          layoutStats(verified);
        } else expansion = await layoutPass(expansion);
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
        layoutBest = null;
        stats.playtestRepair = true;
        emit({ kind: 'repairing', round: repairs + 1, issues: blocking.map((f) => `${f.code}: ${f.message}`) });
        reply = await call(system, P.playtestRepair(request, shown, report), 'microgame playtest repair');
      }
    }

    // Polish: a new game that passed the bots but reads as unfinished gets one more round. The
    // polished version ships only if it validates, passes the bots and scores higher.
    let quality = studio.quality(chosen.expansion.authoring_json, base ? '' : request);
    // A story is checked path by path against its graph; a polish rewrite would skip that, so stories keep their build.
    if (polish && !base && !story?.expansion && chosen.report.passed && P.needsPolish(quality)) {
      try {
        emit({ kind: 'polishing', issues: quality.lines });
        const text = await call(system, P.polish(request, chosen.expansion.authoring_json, quality.lines), 'microgame polish');
        emit({ kind: 'expanding' });
        let expansion = studio.expand(text);
        let polishLayout = null;
        if (expansion.ok) {
          polishLayout = await verifyPass(expansion);
          if (polishLayout) expansion = polishLayout.expansion;
          else expansion = await layoutPass(expansion);
        }
        // The polish ships only if it doesn't block on more layout findings than the build it replaces.
        const layoutWorse = !!polishLayout && (polishLayout.report.blocking ?? 0) > (stats.layoutBlocking ?? 0);
        if (expansion.ok && !layoutWorse) {
          const q2 = studio.quality(expansion.authoring_json, request);
          if (q2.score > quality.score) {
            emit({ kind: 'playtesting', bots: BOT_COUNT });
            const report = await studio.gate(expansion.playtest_game_json || expansion.game_json, 1, gateOptions);
            emit({ kind: 'playtested', passed: !!report.passed, headline: report.summary ?? '', blocking: blockingOf(report).map((f) => `${f.code}: ${f.message}`) });
            if (report.passed) {
              chosen = { expansion, report };
              quality = q2;
              stats.polished = true;
              if (polishLayout) layoutStats(polishLayout);
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
    // The plan's score wins: a manifest without one, or one whose kind drifted from the plan's (Kevin32: 5 of
    // 31 games, e.g. make-24 drifting to a farmable count of combines), takes the spec's score with the
    // events this game has. A spec score that doesn't validate leaves the manifest's as it is.
    const specScore = context?.plan?.spec?.score;
    if (specScore && typeof specScore === 'object' && specScore.kind && (!expansion.score_declared || expansion.score?.kind !== specScore.kind)) {
      const drifted = expansion.score_declared ? expansion.score?.kind : null;
      const adopted = adoptSpecScore(specScore, expansion.game, drifted ? expansion.score?.events : null);
      if (adopted) {
        expansion = { ...expansion, score: adopted.score, score_declared: true, authoring: { ...expansion.authoring, score: adopted.block }, authoring_json: JSON.stringify({ ...expansion.authoring, score: adopted.block }) };
        if (drifted) stats.scoreDrift = { from: drifted, to: adopted.score.kind };
      }
    }
    if (scoreCheck && expansion.score_declared && typeof studio.scoreCheck === 'function') {
      score = await verifyScore({ expansion, gameJson: expansion.playtest_game_json || expansion.game_json, request, spec: context?.plan?.spec ?? null }, studio, { call, emit, review: scoreReview });
      if (score?.authoring_json) expansion = { ...expansion, authoring_json: score.authoring_json };
      stats.score = score ? { ranked: score.ranked, repaired: score.repaired, reviews: score.reviews ?? 0, review: score.review?.ok ?? null } : null;
    }
    // Picture art (docs/harness-gaps/images.md): when the plan says art "image" and the caller can make
    // images, muse-image redraws the pictures behind the same asset ids, so rules and replays don't change
    // and no re-gate is needed. Any failure keeps the SVG art.
    let imageArt = null;
    if (wantsImageArt(context, H)) {
      emit({ kind: 'drawing' });
      const spec = context.plan.spec ?? null;
      const style = spec?.theme?.art_style ?? null;
      const deps = { image: H.image, decode: H.decode, deflate: H.deflate, ask: call };
      const t0 = Date.now();
      try {
        let authoring = expansion.authoring;
        try { authoring = JSON.parse(expansion.authoring_json); } catch { /* keep the expansion's */ }
        if (story?.expansion) {
          const art = await makeStoryArt({ authoring, request, spec, style }, deps, { budget: IMAGE_ART_BUDGET });
          const again = studio.expand(JSON.stringify(applyStoryArt(authoring, art)));
          if (!again?.ok) throw new Error(`the story with pictures doesn't build: ${(again?.diagnostics ?? []).filter((d) => d.severity === 'error').map((d) => d.code).join(', ') || 'unknown'}`);
          expansion = { ...expansion, game_json: again.game_json, authoring_json: again.authoring_json ?? JSON.stringify(applyStoryArt(authoring, art)) };
          imageArt = { kind: 'story', record: art.record, stats: art.stats };
        } else {
          const art = await makeImageArt({ game: expansion.game, authoring, request, spec, style }, deps, { budget: IMAGE_ART_BUDGET });
          if (!Object.keys(art.assets ?? {}).length) throw new Error('no pictures to draw (the game has no sprite or backdrop assets)');
          imageArt = { kind: 'game', art, record: art.record, stats: art.stats };
        }
        stats.image_art = { kind: imageArt.kind, image_calls: imageArt.stats?.image_calls ?? null, text_calls: imageArt.stats?.text_calls ?? null, tokens: imageArt.stats?.tokens ?? null, budget: imageArt.stats?.budget ?? null, seconds: Math.round((Date.now() - t0) / 100) / 10, style: style ?? null };
        emit({ kind: 'drawn', ok: true, pictures: imageArt.record?.pictures?.length ?? Object.keys(imageArt.art?.assets ?? {}).length });
      } catch (e) {
        if (e?.name === 'GenerationError') throw e;
        imageArt = null;
        stats.image_art = { failed: String(e?.message ?? e).slice(0, 300), seconds: Math.round((Date.now() - t0) / 100) / 10 };
        emit({ kind: 'drawn', ok: false, reason: stats.image_art.failed });
      }
    }
    const title = expansion.game?.meta?.title ?? 'microgame';
    let manifest = studio.wrap({
      id: base?.id ?? `mg-${slug(title) || 'game'}-${randomSuffix()}`,
      game_json: expansion.game_json,
      authoring_json: expansion.authoring_json,
      brief,
      seed: base?.seed ?? 1 + Math.floor(Math.random() * 999999),
      ...(base?.emoji ? { emoji: base.emoji } : {}),
      ...(score?.model ? { score: score.model } : {}),
    });
    if (imageArt?.kind === 'game') manifest = applyImageArt(manifest, imageArt.art);
    else if (imageArt?.kind === 'story') manifest.art_record = imageArt.record;
    // Requirements (docs/HARNESS_V2.md "Requirements"): the person's own words checked in the built game, by
    // code and by the gate's runs replayed with a trace; no Muse call. The judge and one targeted repair
    // cost Muse calls on every game, so they run only when context.requirements_repair is true.
    const requirements = Array.isArray(context?.plan?.spec?.requirements) ? context.plan.spec.requirements : [];
    let reqRepaired = null;
    if (requirements.length && typeof studio.requirementsCheck === 'function') {
      const gameForTrace = expansion.playtest_game_json || expansion.game_json;
      try {
        let report = await studio.requirementsCheck(gameForTrace, manifest, requirements, null);
        let judged = false;
        if (context?.requirements_repair === true) {
          const built = readBuilt(manifest);
          const toJudge = needsJudge(requirements, built);
          if (toJudge.length) {
            try {
              const judge = await judgeRequirements(toJudge, built, (s, u, purpose, o) => call(s, typeof u === 'string' ? u : JSON.stringify(u), purpose, o));
              report = await studio.requirementsCheck(gameForTrace, manifest, requirements, judge);
              judged = true;
            } catch (e) { if (e?.name === 'GenerationError') throw e; }
          }
          const failures = repairTargets(report);
          if (failures.length && !base) {
            try {
              const revised = await composeGame({ request: repairRequest(failures), brief, base: { id: manifest.id, title: manifest.title, one_line_rule: manifest.one_line_rule, brief, seed: manifest.seed, authoring_json: manifest.content.authoring_json }, context: { ...context, requirements_repair: false } }, studio, { ask, onEvent, signal, maxRepairRounds, polish: false, scoreCheck, scoreReview, hooks: { fixLayout: H.fixLayout, layoutCheck: H.layoutCheck, verifyLayout: H.verifyLayout } });
              const after = revised.stats?.requirements;
              if (revised.gate?.passed && after && after.must_passed > report.summary.must_passed) reqRepaired = revised;
            } catch (e) { if (e?.name === 'GenerationError') throw e; }
          }
        }
        stats.requirements = { must_passed: report.summary.must_passed, must_total: report.summary.must_total, note: honestNote(report), gaps: gapEntries(report), passed: report.summary.passed, total: report.summary.total, unknown: report.summary.unknown, traced: report.traced ?? 0, judged };
      } catch (e) {
        if (e?.name === 'GenerationError') throw e;
        stats.requirements = { must_passed: null, must_total: requirements.filter((r) => r.must).length, note: '', gaps: [], error: String(e?.message ?? e).slice(0, 200) };
      }
    } else {
      stats.requirements = { must_passed: 0, must_total: 0, note: '', gaps: [] };
    }
    // Layout lint (layout-check.mjs): findings are warnings in stats.layout and never block. The verifier,
    // when it ran, already put its report there.
    if (typeof H.layoutCheck === 'function' && !stats.layout?.verifier) {
      try {
        const lint = await H.layoutCheck(expansion.playtest_game_json || expansion.game_json, { engine: engineOf() });
        const findings = Array.isArray(lint?.findings) ? lint.findings : [];
        stats.layout = { counts: lint?.counts ?? null, pixels: !!lint?.pixels, warnings: findings.slice(0, 20).map((f) => ({ code: f.code, node: f.node, message: f.message })) };
      } catch (e) {
        stats.layout = { error: String(e?.message ?? e).slice(0, 200) };
      }
    }
    emit({ kind: 'requirements_checked', must_passed: stats.requirements.must_passed, must_total: stats.requirements.must_total });
    if (reqRepaired) {
      reqRepaired.stats = { ...reqRepaired.stats, museCalls: stats.museCalls + (reqRepaired.stats?.museCalls ?? 0), requirementsRepair: { before: stats.requirements, after: reqRepaired.stats.requirements } };
      return reqRepaired;
    }
    // Group play: how friends compare this game's runs (the spec's social part, kept consistent with the score).
    // A story compares by ending (best first) with the endings the compiled graph really has.
    // The plan's display line is kept when it shows the ending ("{ending} in {choices} choices").
    const planned = context?.plan?.spec?.social;
    const display = /\{ending\}/.test(String(planned?.result?.display ?? '')) ? planned.result.display : story?.groupResult?.display;
    const social = story?.groupResult ? { ...(planned ?? {}), result: { ...story.groupResult, display } } : planned;
    const together = groupPlayBlock(social, score?.model ?? expansion.score ?? null);
    if (together) manifest.group_play = together;
    manifest.structure = structureFor({ groupPlay: together, authoring: expansion.authoring, context });
    // Refuse to publish a game the verifier still blocks on, only when context.layout_block is true (off by
    // default while most builds still have findings). Off, the findings ride in stats.layout and it ships.
    if (context?.layout_block === true && (stats.layoutBlocking ?? 0) > 0) {
      const issues = (stats.layout?.findings ?? []).filter((f) => f.severity === 'block').map((f) => `${f.code}${f.node ? ` at ${f.node}` : ''}: ${f.message}`);
      throw new GenerationError(`The layout still has ${stats.layoutBlocking} blocking ${stats.layoutBlocking === 1 ? 'problem' : 'problems'}: ${issues[0] ?? 'see the layout report'}`, issues);
    }
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
