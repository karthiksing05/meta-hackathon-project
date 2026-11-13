// The story branch of compose (docs/harness-gaps/story.md): when the plan uses `branching_story`, Muse
// writes a story-graph/1 instead of a microgame manifest. Our checker walks every path, one repair
// round fixes what it finds, the compiler turns the graph into choice_story + story_vars with a score
// model, and the story bots (which follow the graph move by move) are the gate. Their runs feed the
// score check, so it measures choosing well, not tapping fast.
//
// Pure: Muse comes in as `call(system, user, purpose, options) → text`; the engine work goes through
// studio.expand and studio.storyGate.

import { validateStoryGraph, compileStoryGraph, storyIssueLines } from './story-graph.mjs';
import { STORY_GRAPH_SYSTEM, STORY_MUSE_OPTIONS, STORY_REPAIR_OPTIONS, storyGraphUser, storyRepairUser } from './story-prompt.mjs';
import { replyObject } from './prompts.mjs';

export const STORY_TOOL = 'branching_story';

/** Whether the plan makes this game a story: the tool is planned, or a chosen type uses it. */
export function wantsStory(context) {
  if (!context || typeof context !== 'object') return false;
  const plan = context.plan && typeof context.plan === 'object' ? context.plan : {};
  if (Array.isArray(plan.tool_ids) && plan.tool_ids.includes(STORY_TOOL)) return true;
  const types = Array.isArray(context.types) ? context.types : [];
  const chosen = Array.isArray(plan.type_ids) && plan.type_ids.length ? types.filter((t) => plan.type_ids.includes(t?.id)) : types.slice(0, 1);
  return chosen.some((t) => Array.isArray(t?.tools) && t.tools.includes(STORY_TOOL));
}

/**
 * The cast when the game is made for a group of people: context.group ({name, members: [{name, …}]})
 * or context.cast (a list), as the generator passes it. Only names and what the person gave.
 */
export function storyCast(context, brief = {}) {
  const g = context?.group ?? context?.cast ?? brief?.cast ?? null;
  if (!g) return null;
  if (Array.isArray(g)) return g.length ? { members: g.slice(0, 12) } : null;
  if (typeof g === 'object' && (Array.isArray(g.members) ? g.members.length : g.name)) return g;
  return null;
}

// A valid graph is still sent back once when always tapping one button reaches a better ending than a
// typical reader: the score check would read that as farming (story agent, Kevin32 #24 and #29).
const REPAIR_WARNINGS = ['S_SAME_BUTTON'];
const needsRepair = (r) => !r.ok || r.warnings.some((w) => REPAIR_WARNINGS.includes(w.code));

/**
 * Makes a story game. Returns {expansion, report: gate, graphReport, groupResult, notes} when the graph is
 * valid, compiles, validates in the engine and passes the story gate; otherwise {fallback: reason, notes}
 * and the caller composes the normal way.
 */
export async function composeStory({ request, context, brief }, studio, { call, emit = () => {} }) {
  const notes = [];
  const spec = context?.plan?.spec ?? null;
  const group = storyCast(context, brief);
  const ask = async (user, purpose, options) => {
    const text = await call(STORY_GRAPH_SYSTEM, user, purpose, options);
    return replyObject(text);
  };
  emit({ kind: 'drafting', attempt: 1 });
  let graph = await ask(storyGraphUser(request, { spec, group }), 'story graph', STORY_MUSE_OPTIONS);
  if (!graph) return { fallback: 'Muse returned no story graph', notes };
  let report = validateStoryGraph(graph);
  notes.push(`story draft: ${report.ok ? 'valid' : `${report.errors.length} errors`}, ${report.warnings.length} warnings`);
  if (needsRepair(report)) {
    const issues = storyIssueLines(report, { warnings: report.ok });
    emit({ kind: 'repairing', round: 1, issues: issues.slice(0, 6) });
    const fixed = await ask(storyRepairUser(request, graph, report), 'story repair', STORY_REPAIR_OPTIONS);
    const r2 = fixed ? validateStoryGraph(fixed) : null;
    // A repair of a valid graph is kept only if it is still valid.
    if (r2 && (r2.ok || !report.ok)) { graph = fixed; report = r2; }
    notes.push(`story repair: ${r2 ? (r2.ok ? 'valid' : `${r2.errors.length} errors`) : 'no graph'}`);
  }
  if (!report.ok) return { fallback: `the story graph still has errors: ${storyIssueLines(report, { warnings: false }).slice(0, 3).join('; ')}`, notes };

  const compiled = compileStoryGraph(graph, { report });
  emit({ kind: 'expanding' });
  const expansion = studio.expand(compiled.manifest);
  if (!expansion.ok) return { fallback: `the compiled story doesn't validate: ${(expansion.diagnostics ?? []).filter((d) => d.severity === 'error').map((d) => d.message).slice(0, 2).join('; ')}`, notes };
  if (typeof studio.storyGate !== 'function') return { fallback: 'this Studio build has no story gate', notes };
  const plans = 8;
  emit({ kind: 'playtesting', bots: plans });
  const gameJson = expansion.playtest_game_json || expansion.game_json;
  const gate = await studio.storyGate(gameJson, graph, compiled.manifest);
  emit({ kind: 'playtested', passed: !!gate.passed, headline: gate.summary ?? '', blocking: (gate.flags ?? []).filter((f) => f.blocking).map((f) => `${f.code}: ${f.message}`) });
  if (!gate.passed) return { fallback: `the story gate failed: ${(gate.flags ?? []).filter((f) => f.blocking).map((f) => f.message).slice(0, 2).join('; ')}`, notes };
  return { expansion, report: gate, graphReport: report, groupResult: compiled.groupResult, notes };
}
