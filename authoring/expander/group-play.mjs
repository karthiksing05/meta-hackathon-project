// Group play (docs/harness-gaps/group-play.md): no live multiplayer. Every game is a single-player run that
// people play on the same seed, each on their own turn, in a chat thread or a Group, and the results are
// compared afterwards. The planner writes it as the spec's `social` part (Go: backend/internal/harness/
// social.go); compose follows the rules below, and the pipeline puts the checked block on the manifest as
// `group_play`, next to `score`, for the server and the app.
//
// Pure: no disk, no network.

export const MODES = ['same_seed_async', 'series', 'group_round', 'weekly_board', 'opinion_compare'];
export const RESULT_KINDS = ['score', 'ending', 'picks', 'creation'];
export const COMPARES = ['score', 'ending', 'agreement', 'none'];
export const DEFAULT_SHARE_LINE = '{name}: {result} on {title}. Your turn.';
const ROUND = { min: 30, max: 90 };

const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : '');
const names = (v, n = 8) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, n) : []);

/** The modes a result supports: any comparable result works in every async mode. */
export function modesFor(compare) {
  if (compare === 'agreement') return ['opinion_compare', 'group_round'];
  if (compare === 'none') return ['same_seed_async'];
  return ['same_seed_async', 'series', 'group_round', 'weekly_board'];
}

/**
 * The manifest's `group_play` block from the spec's social part and the game's score model, or null when
 * there is no social part. Go has already validated the spec; this repeats the rules that keep the block
 * consistent with the score the game actually ships (an unranked board can't be compared as a score).
 */
export function groupPlayBlock(social, score = null) {
  if (!social || typeof social !== 'object' || Array.isArray(social)) return null;
  const r = social.result && typeof social.result === 'object' ? social.result : {};
  const unranked = score?.ranked === false;
  let compare = COMPARES.includes(r.compare) ? r.compare : r.kind === 'picks' ? 'agreement' : r.kind === 'ending' ? 'ending' : r.kind === 'creation' || unranked ? 'none' : 'score';
  if (compare === 'score' && unranked) compare = 'none';
  const kind = compare === 'agreement' ? 'picks' : compare === 'ending' ? 'ending' : RESULT_KINDS.includes(r.kind) && r.kind !== 'picks' ? r.kind : compare === 'none' ? 'creation' : 'score';
  const modes = modesFor(compare);
  const mode = modes.includes(social.mode) ? social.mode : modes[0];
  const result = { kind, compare, display: str(r.display, 80) || { score: '{score}', ending: '{ending}', agreement: '{agreement}% in sync', none: '{result}' }[compare] };
  const endings = names(r.endings);
  if (compare === 'ending' && endings.length) result.endings = endings;
  const state = names(r.state, 6);
  if (state.length) result.state = state;
  let line = str(social.share_line, 140) || str(social.share, 140);
  if (!/\{(result|score)\}/.test(line) || line.includes('\n')) line = DEFAULT_SHARE_LINE;
  const round = Number.isFinite(social.round_seconds) && social.round_seconds > 0 ? Math.round(social.round_seconds) : ROUND.max;
  const out = { mode, modes, round_seconds: round, result, share_line: line, same_seed: true };
  if (mode === 'series') out.best_of = social.best_of === 5 ? 5 : 3;
  const board = str(social.board, 160);
  if (board) out.board = board;
  return out;
}

/** The compose rules for a game played as a group (prompt lines). */
export function groupPlayRules(social) {
  const b = groupPlayBlock(social);
  if (!b) return [];
  const lines = [
    'Group play: friends each play this same single-player run on the same seed, on their own turn, in a chat or a Group, and compare results after. So:',
    '- Fair on a shared seed: every random choice (content order, spawns, which prompts) comes from the run seed through the engine. Nothing depends on the device, the clock, the locale or the player\'s name.',
    `- A round fits a chat: one run takes about ${b.round_seconds} s or less, and it always ends on its own (a timer, a last prompt or an ending).`,
    `- One clear result at the end, shown on the end screen: ${b.result.display}.`,
  ];
  if (b.result.compare === 'ending') {
    lines.push(`- Story result: each ending sets state \`ending\` to its name${b.result.endings ? ` (${b.result.endings.join(', ')}, best first)` : ''}, and state \`choices_used\` counts choices. Never show the other endings' names before the run ends.`);
  } else if (b.result.compare === 'agreement') {
    lines.push('- No right answer: the player\'s picks (ratings, ranks, tiers or this-or-that) are the result. Keep each pick in state (`picks`, in prompt order) so friends\' runs can be compared. Never call a pick right or wrong, and don\'t score how many picks were made.');
  }
  if (b.result.state) lines.push(`- Keep the result in state named ${b.result.state.map((s) => `\`${s}\``).join(', ')} at the end of the run.`);
  lines.push(`- The line posted back to the thread is "${b.share_line}": it never names an answer or an ending.`);
  return lines;
}

/** Fills a share line or display for one player: {name}, {title}, {result}, {score}, {ending}, {choices}, {agreement}. */
export function fillLine(template, values = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (m, k) => (values[k] === undefined || values[k] === null ? m : String(values[k])));
}

/**
 * Agreement between two players' picks, in whole percent (the stand-in for the server aggregate: two
 * friends in a chat need no aggregate). picks are arrays in prompt order: a rank list compares positions
 * (100 when identical, less the further apart), ratings and tiers compare value by value.
 */
export function agreement(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return null;
  const numeric = a.every((x) => typeof x === 'number') && b.every((x) => typeof x === 'number');
  if (numeric) {
    const span = Math.max(1, ...a, ...b) - Math.min(0, ...a, ...b);
    const off = a.reduce((s, x, i) => s + Math.abs(x - b[i]) / span, 0);
    return Math.round(100 * (1 - off / a.length));
  }
  const same = a.filter((x, i) => x === b[i]).length;
  return Math.round((100 * same) / a.length);
}
