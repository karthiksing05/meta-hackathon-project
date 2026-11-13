// Muse makes a microgame: a port of MicrogameComposer.compose (MicrogameComposer.swift).
// Muse writes an authoring manifest, the expander and the engine check it, errors go back to Muse
// for repair, five bots playtest it, and it's wrapped as a `formula: "microgame"` manifest whose
// `content.game_json` is byte for byte what passed the gate.

import * as P from './prompts.mjs';

export const MAX_REPAIR_ROUNDS = 3;
export const BOT_COUNT = 5;

/** One short, human-readable line for "Muse at work" screens, so the app never words events itself. */
export function summarize(e) {
  switch (e.kind) {
    case 'drafting': return e.attempt === 1 ? 'Muse is drafting the game' : 'Muse is drafting it again';
    case 'expanding': return 'Building and checking the game';
    case 'repairing': {
      const n = e.issues.length;
      return `Fixing ${n} ${n === 1 ? 'issue' : 'issues'}` + (e.round > 1 ? ` (round ${e.round})` : '');
    }
    case 'playtesting': return `${e.bots} test players are trying it`;
    case 'playtested': return e.passed ? `Playtested: ${e.headline}` : `Playtest flagged: ${e.headline}`;
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

/** The app's BubbleBrief uses snake_case on the wire; accept camelCase from callers too. */
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

/**
 * compose({request, brief}, {muse, studio, model, onEvent, signal}) -> {manifest, stats}
 * Throws GenerationError when the game never validates, or whatever Muse or the page threw.
 */
export async function compose({ request, brief }, { muse, studio, model = 'muse-wonder-1.0', onEvent = () => {}, signal, maxRepairRounds = MAX_REPAIR_ROUNDS }) {
  const started = Date.now();
  const stats = { firstDraftValid: null, repairRounds: 0, playtestRepair: false, passedGate: false, museCalls: 0, models: [], seconds: 0 };
  const emit = (e) => onEvent({ ...e, summary: summarize(e) });
  const live = () => {
    if (signal?.aborted) throw new GenerationError('The job was cancelled or ran out of time.');
  };

  const ask = async (system, user) => {
    live();
    const r = await muse.chatJSON({ model, system, user });
    stats.museCalls++;
    if (!stats.models.includes(r.model)) stats.models.push(r.model);
    return r.content;
  };

  try {
    brief = normalizeBrief(brief);
    const catalog = studio.catalog();
    const system = P.system(catalog);

    // Muse's first manifest. A reply that fails is asked for once more.
    let reply, lastError;
    for (let attempt = 1; attempt <= 2 && reply === undefined; attempt++) {
      emit({ kind: 'drafting', attempt });
      try {
        reply = await ask(system, P.compose(request, brief));
      } catch (e) {
        lastError = e;
      }
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
      const shown = expansion.authoring_json ?? (typeof expansion.authoring === 'string' ? expansion.authoring : JSON.stringify(expansion.authoring));
      if (stats.firstDraftValid === null) stats.firstDraftValid = expansion.ok;

      if (!expansion.ok) {
        const issues = P.issues(expansion);
        if (repairs >= maxRepairRounds) {
          if (best) { chosen = best; break; }
          throw new GenerationError(`Muse's microgame still doesn't validate: ${issues[0] ?? 'unknown error'}`, issues);
        }
        repairs++;
        stats.repairRounds = repairs;
        emit({ kind: 'repairing', round: repairs, issues });
        reply = await ask(system, P.repair(request, shown, issues, repairs));
        continue;
      }

      emit({ kind: 'playtesting', bots: BOT_COUNT });
      const report = await studio.gate(expansion.playtest_game_json || expansion.game_json, 1);
      const blocking = (report.flags ?? []).filter((f) => f.blocking);
      emit({ kind: 'playtested', passed: !!report.passed, headline: report.summary ?? '', blocking: blocking.map((f) => `${f.code}: ${f.message}`) });
      if (report.passed) {
        stats.passedGate = true;
        chosen = { expansion, report };
        break;
      }
      // Neither passed: keep whichever version has fewer blocking flags.
      if (!best || blocking.length < (best.report.flags ?? []).filter((f) => f.blocking).length) best = { expansion, report };
      if (playtestRepairUsed) { chosen = best; break; }
      playtestRepairUsed = true;
      stats.playtestRepair = true;
      emit({ kind: 'repairing', round: repairs + 1, issues: blocking.map((f) => `${f.code}: ${f.message}`) });
      reply = await ask(system, P.playtestRepair(request, shown, report));
    }

    const { expansion } = chosen;
    const title = expansion.game?.meta?.title ?? 'microgame';
    const id = `mg-${slug(title) || 'game'}-${randomSuffix()}`;
    const manifest = studio.wrap({
      id,
      game_json: expansion.game_json,
      authoring_json: expansion.authoring_json,
      brief,
      seed: 1 + Math.floor(Math.random() * 999999),
    });
    stats.seconds = Math.round((Date.now() - started) / 100) / 10;
    manifest.studio = { models: stats.models, created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), duration_sec: stats.seconds, offline: false };
    emit({ kind: 'done', title: manifest.title ?? title });
    return { manifest, stats, gate: { passed: !!chosen.report.passed, summary: chosen.report.summary ?? '' } };
  } catch (e) {
    stats.seconds = Math.round((Date.now() - started) / 100) / 10;
    emit({ kind: 'failed', reason: e?.message ?? String(e), issues: e?.issues });
    e.stats = stats;
    throw e;
  }
}
