// intent matching: which pre-written question does a typed question ask? (docs/harness-gaps/open-text.md)
//
// Games where the player types a free question (lateral-thinking yes/no puzzles, twenty questions,
// interrogate a suspect) can't call Muse while someone plays and still replay deterministically. So
// Muse writes, at build time, a bank of *intents*: each one a short list of concept groups, each group
// the words a player might use for that concept, plus the answer. At play time this matcher maps the
// typed question to an intent with no LLM, the same on the phone, in the bots and in replay checks.
//
// Like fuzzy.mjs, the algorithm exists twice, generated from this file:
//   - `matchIntent()` and friends below: the JS reference, for tests, bank checks and the server;
//   - `engineFunctions()`: the same steps as engine expressions, written into the qa_bank fragment
//     by authoring/tools/make-qa-fragment.mjs.
// authoring/tools/test-qa.mjs checks the two agree through the real engine when one is built.
//
// The encoding (one string per intent, so it fits a content list<string>):
//   "<groups>"  where groups are split by '|', and the words for one concept by '='.
//   e.g. "hiccup=hiccough|scare=fright=startle=shock=surprise" asks about hiccups AND a scare.
// A word may be a phrase ("gun shot"): all its words must appear, in any order.
//
// Matching a question against one intent:
//   1. the question's words: fuzzy.mjs `words()` (case, accents, punctuation, number words, a leading
//      article and plurals folded), then `root()` per word (drop -ing, -ed, -ly, a final e and a
//      doubled final consonant, on both sides, so "scared", "scaring" and "scare" agree);
//   2. a word hits a bank word when the roots are equal, or when both roots have 5+ letters and are
//      one edit apart (two edits from 9 letters), so phone typos still count ("than" never hits "thank");
//   3. a group is hit when any of its words hits; the intent fits when every group is hit.
// The best intent is the fitting one with the most groups (the most specific), then the one whose
// words explain more of the question's words; ties go to the earlier entry, so a bank lists its
// specific intents first. No fit returns -1: the game says "ask another
// way" rather than guess, because a wrong yes/no is worse than no answer.

import { words, distance } from './fuzzy.mjs';
import { engineFunctions as fuzzyEngineFunctions } from './fuzzy.mjs';

const cps = (s) => Array.from(s);
const clen = (s) => cps(s).length;
const csub = (s, a, b) => cps(s).slice(a, b).join('');
const VOWELS = 'aeiou';

/** A word's root: drop -ing, -ed, -ly, then a final e, then a doubled final consonant. */
export function root(w) {
  let a = w;
  let n = clen(a);
  if (n > 5 && a.endsWith('ing')) a = csub(a, 0, n - 3);
  else if (n > 4 && a.endsWith('ed')) a = csub(a, 0, n - 2);
  else if (n > 5 && a.endsWith('ly')) a = csub(a, 0, n - 2);
  n = clen(a);
  if (n > 4 && a.endsWith('e')) a = csub(a, 0, n - 1);
  n = clen(a);
  const c = cps(a);
  if (n > 3 && c[n - 1] === c[n - 2] && !VOWELS.includes(c[n - 1])) a = csub(a, 0, n - 1);
  return a;
}

/** A text's roots, in order, duplicates kept (cheap; matching only asks "is it there"). */
export const roots = (s) => words(s).map(root);

/** Does a question root hit a bank root? Equal, or a small typo on a long enough word. */
export function wordHit(q, b) {
  if (q === b) return true;
  const n = clen(b);
  if (n < 5 || clen(q) < 5 || Math.abs(clen(q) - n) > 2) return false;
  return distance(q, b) <= (n >= 9 ? 2 : 1);
}

/** Every word of one bank phrase is in the question. */
export const phraseHit = (qr, phrase) => {
  const pr = roots(phrase);
  return pr.length > 0 && pr.every((p) => qr.some((q) => wordHit(q, p)));
};

export const groupsOf = (intent) => String(intent).split('|').map((g) => g.split('=').map((x) => x.trim()).filter(Boolean)).filter((g) => g.length);

/** How many of the question's words some word of the intent hits. */
export function covered(qr, intent) {
  const br = groupsOf(intent).flat().flatMap(roots);
  return qr.filter((q) => br.some((b) => wordHit(q, b))).length;
}

/**
 * 0 when the question doesn't fit the intent; otherwise groups * 100 + covered words, so the most
 * specific intent wins, then the one that explains more of the question.
 */
export function fits(question, intent, qr = roots(question)) {
  const gs = groupsOf(intent);
  if (!gs.length) return 0;
  return gs.every((g) => g.some((p) => phraseHit(qr, p))) ? gs.length * 100 + covered(qr, intent) : 0;
}

/**
 * matchIntent(question, intents[]) -> {index, groups, hits}
 * index: the best fitting intent (most groups, then most question words explained, earlier on ties),
 * or -1. groups: the winner's fit score. hits: for each group of the winner, the bank word that
 * matched (for tests and bank tuning).
 */
export function matchIntent(question, intents) {
  const qr = roots(question);
  let best = -1, bestG = 0;
  (intents ?? []).forEach((it, i) => {
    const g = fits(question, it, qr);
    if (g > bestG) { best = i; bestG = g; }
  });
  const hits = best < 0 ? [] : groupsOf(intents[best]).map((g) => g.find((p) => phraseHit(qr, p)));
  return { index: best, groups: bestG, hits };
}

// ---------- the engine version ----------
// `n(key)` names each function. The qa_bank fragment keeps them private (`_qz_<key>`) except
// `match`, which it exposes as `qa_match`. The fuzzy helpers it needs come from fuzzy.mjs under the
// same namer, so there is one implementation of `words` and `distance`.

const FUZZY_KEYS = ['apos', 'clean', 'fold', 'stem', 'words', 'num', 'row', 'dist'];

export function engineFunctions(n) {
  const fz = fuzzyEngineFunctions(n);
  const out = Object.fromEntries(FUZZY_KEYS.map((k) => [n(k), fz[n(k)]]));
  const f = (params, returns, body) => ({ params, returns, body });
  const S = 'string', LS = 'list<string>';
  Object.assign(out, {
    [n('root')]: f({ qz_w: S }, S,
      `let qz_a = if len(qz_w) > 5 and ends_with(qz_w, 'ing') then substr(qz_w, 0, len(qz_w) - 3) ` +
      `else if len(qz_w) > 4 and ends_with(qz_w, 'ed') then substr(qz_w, 0, len(qz_w) - 2) ` +
      `else if len(qz_w) > 5 and ends_with(qz_w, 'ly') then substr(qz_w, 0, len(qz_w) - 2) else qz_w in ` +
      `let qz_b = if len(qz_a) > 4 and ends_with(qz_a, 'e') then substr(qz_a, 0, len(qz_a) - 1) else qz_a in ` +
      `let qz_n = len(qz_b) in ` +
      `if qz_n > 3 and substr(qz_b, qz_n - 1, qz_n) == substr(qz_b, qz_n - 2, qz_n - 1) and not contains('${VOWELS}', substr(qz_b, qz_n - 1, qz_n)) ` +
      `then substr(qz_b, 0, qz_n - 1) else qz_b`),
    [n('roots')]: f({ qz_s: S }, LS, `map(${n('words')}(qz_s), qz_x => ${n('root')}(qz_x))`),
    [n('whit')]: f({ qz_q: S, qz_b: S }, 'bool',
      `if qz_q == qz_b then true else let qz_n = len(qz_b) in ` +
      `if qz_n < 5 or len(qz_q) < 5 or abs(len(qz_q) - qz_n) > 2 then false else ${n('dist')}(qz_q, qz_b) <= (if qz_n >= 9 then 2 else 1)`),
    [n('phit')]: f({ qz_qr: LS, qz_p: S }, 'bool',
      `let qz_pr = ${n('roots')}(qz_p) in len(qz_pr) > 0 and all(qz_pr, qz_x => any(qz_qr, qz_y => ${n('whit')}(qz_y, qz_x)))`),
    [n('cover')]: f({ qz_qr: LS, qz_it: S }, 'int',
      `let qz_br = fold(split(replace(qz_it, '|', '='), '='), [], (qz_acc, qz_p) => concat(qz_acc, ${n('roots')}(qz_p))) in ` +
      `count(qz_qr, qz_y => any(qz_br, qz_x => ${n('whit')}(qz_y, qz_x)))`),
    [n('fits')]: f({ qz_qr: LS, qz_it: S }, 'int',
      `let qz_gs = filter(split(qz_it, '|'), qz_g => trim(qz_g) != '') in ` +
      `if len(qz_gs) == 0 then 0 else if all(qz_gs, qz_g => any(split(qz_g, '='), qz_p => trim(qz_p) != '' and ${n('phit')}(qz_qr, qz_p))) ` +
      `then len(qz_gs) * 100 + ${n('cover')}(qz_qr, qz_it) else 0`),
    // Index of the best fitting intent (highest fit score, earlier on ties), or -1.
    [n('match')]: f({ qz_q: S, qz_its: LS }, 'int',
      `let qz_qr = ${n('roots')}(qz_q) in ` +
      `fold(range(len(qz_its)), {i: -1, g: 0}, (qz_st, qz_k) => let qz_v = ${n('fits')}(qz_qr, get_or(qz_its, qz_k, '')) in if qz_v > qz_st.g then {i: qz_k, g: qz_v} else qz_st).i`),
  });
  return out;
}
