// Prompts that ask Muse for a story graph (story-graph/1, expander/story-graph.mjs) and repair one
// from the validator's errors. Muse writes only the story: the structure, the engine wiring and the
// score come from the compiler, so Muse never has to invent them.
//
// Pure strings, no I/O. Not wired into pipeline.mjs yet (docs/harness-gaps/story.md, "Requests").

import { STORY_LIMITS as L } from './story-graph.mjs';

export const STORY_MUSE_OPTIONS = Object.freeze({ model: 'muse-wonder-1.0', effort: 'low', max_tokens: 14000 });
export const STORY_REPAIR_OPTIONS = Object.freeze({ model: 'muse-wonder-1.0', effort: 'low', max_tokens: 14000 });

export const STORY_GRAPH_SYSTEM = `You write short branching stories for a phone game: choose-your-own-adventures, light RPGs, mysteries, survival days. A friend group each plays the same story, then compares which ending they got, how many choices it took and their stats. Reply with one JSON object in the story-graph/1 format below, and nothing else.

FORMAT
{
  "format": "story-graph/1",
  "title": "≤ 40 chars",
  "premise": "one sentence: who you are and what you want",
  "start": "<node id>",
  "max_choices": 10,                 // only if the request sets a limit ("in 10 choices or less"); else omit
  "on_limit": "<ending node id>",    // with max_choices: where a run goes when the choices run out
  "vars": [                          // 0–${L.maxVars} variables; every one must matter somewhere
    {"id": "coin", "label": "Coin", "kind": "stat", "init": 0, "min": 0, "max": 6},   // shown in the HUD, label ≤ ${L.varLabel} chars
    {"id": "sword", "label": "Sword", "kind": "item"},                                 // 0 or 1, shown in the bag
    {"id": "lied", "kind": "flag"}                                                     // 0 or 1, hidden memory
  ],
  "nodes": [
    {"id": "field", "place": "The turnip field", "text": "You're a turnip farmer. The old king has no heir.",
     "enter": "",                      // optional effects when you arrive
     "choices": [
       {"label": "Sell turnips", "to": "market", "do": "coin+2", "note": "+2 coin"},
       {"label": "Buy the sword", "to": "tourney", "if": "coin>=2", "do": "coin-2 sword"},
       {"label": "Storm the castle", "to": "dungeon", "routes": [{"if": "sword & coin>=1", "to": "hall"}]}
     ]},
    {"id": "hall", "text": "The king hands you his crown.",
     "ending": {"title": "Long Live the King", "tone": "good", "rank": 1, "share": "I became king in {choices} choices"}}
  ]
}

SEMANTICS (exact; a checker walks every path)
- A choice shows only if its "if" holds. Conditions: name (more than 0), !name (0), name>=2, name<3, name==1; join with & (and) or | (or).
- Effects ("do", "enter"): +name or name (add 1), -name (minus 1), name+2, name-2, name=0. Values clamp to min–max; items and flags are 0–1.
- On a choice: its "do" applies, then its "routes" are checked in order (first that holds wins), else it goes "to".
- With max_choices: the max_choices-th choice that doesn't reach an ending goes to on_limit.
- A node with "ending" has no choices. Endings: tone good | secret | neutral | bad; rank 1 is the best. Good and secret endings win.
- "share" is the line friends see: {choices}, {limit}, {ending} and {<var id>} fill in. No spoilers beyond the ending's title.

HARD LIMITS (the checker rejects the story otherwise)
- ${L.minNodes}–${L.maxNodes} nodes; aim for 14–30. ${L.minEndings}–${L.maxEndings} endings; aim for 4–6 with exactly one rank 1, at least one bad ending and one secret ending behind an item or flag.
- 1–${L.maxChoices} choices per scene; prefer 2–3. Every reachable scene must show at least one choice whatever the stats are (always leave one choice with no "if").
- Scene "text": at most ${L.lines * L.lineChars - 10} characters (${L.lines} lines of ${L.lineChars} on a phone). Second person, present tense, concrete. No walls of text.
- Choice "label": at most ${L.label} characters, verb first. "note": at most ${L.note}. "place": at most ${L.place}. Ending "title": at most ${L.endingTitle}. "share": at most ${L.share}.
- Every node reachable, every ending reachable, every path ends (loops must spend something or hit max_choices), and the best ending must be reachable within max_choices.
- Ids: lowercase letters, digits and _.

WHAT MAKES IT GOOD
- Choices are real decisions with consequences: stats and items change later options, not just text.
- Light RPG: 1–3 stats that rise and fall (coin, gang, suspicion, energy), 1–3 items that unlock a choice later, a flag that remembers a betrayal or a kindness.
- The best ending takes judgment, not luck; a reader tapping at random should reach it about 5–20% of the time.
- Don't let the first button always be the best choice; vary where good choices sit.
- Tell the player early when a path is doomed; don't drag a lost run on for many scenes.
- Real franchise names, places and characters are fine when the person asks for them. Write all text yourself: no quotes, dialogue or scenes copied from films, books or games. Never describe a real private person; for a friend group, use only the names and details the request gives.`;

/** The first ask: the request, plus the plan's theme and goal when the harness has them. */
export function storyGraphUser(request, { spec = null, group = null } = {}) {
  const lines = [`REQUEST: ${request}`];
  if (spec?.theme) lines.push(`THEME (from the plan): ${typeof spec.theme === 'string' ? spec.theme : JSON.stringify(spec.theme)}`);
  if (spec?.goal) lines.push(`GOAL (from the plan): ${typeof spec.goal === 'string' ? spec.goal : JSON.stringify(spec.goal)}`);
  if (group) lines.push(`GROUP: the story stars these people (use only what's here): ${JSON.stringify(group)}`);
  lines.push('Write the story graph now. One JSON object.');
  return lines.join('\n');
}

/** A repair ask: the graph and the checker's problems. Muse returns the whole fixed graph. */
export function storyRepairUser(request, graph, report) {
  const errors = report.errors.map((e) => `- ${e.code} at ${e.at || '/'}: ${e.message}`);
  const warnings = report.warnings.slice(0, 8).map((w) => `- ${w.code} at ${w.at || '/'}: ${w.message}`);
  return [
    `REQUEST: ${request}`,
    'The checker walked every path of your story graph and found these problems. Fix every error; fix warnings when it is cheap. Keep everything else the same.',
    'ERRORS:', ...(errors.length ? errors : ['- none']),
    'WARNINGS:', ...(warnings.length ? warnings : ['- none']),
    'GRAPH:', JSON.stringify(graph),
    'Reply with the whole fixed story graph. One JSON object.',
  ].join('\n');
}
