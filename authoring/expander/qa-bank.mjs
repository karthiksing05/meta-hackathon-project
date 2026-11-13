// qa-bank/1: the build-time content for games where the player asks free yes/no questions
// (lateral-thinking puzzles, twenty questions, interrogate a suspect). docs/harness-gaps/open-text.md.
//
// Muse writes the bank once, when the game is made. At play time the qa_bank fragment matches each
// typed question to one of the bank's facts with intent.mjs (no LLM), so a replay of the same inputs
// gives the same answers and the same score.
//
//   {
//     "bank": "qa-bank/1",
//     "cases": [{
//       "title": "Water at the bar",
//       "setup": "A man walks into a bar and asks for a glass of water. The bartender ...",   (<= 240 chars)
//       "solution": "The man had hiccups. The bartender scared them away ...",                  (<= 400 chars)
//       "facts": [
//         {"ask": "Did he have hiccups?", "reply": "yes", "key": true,
//          "match": [["hiccup", "hiccough"]],
//          "also_ask": ["was he hiccuping", "did he have the hiccups"]},
//         ...                                  (12-60 facts, most specific first)
//       ],
//       "solve": [[["hiccup", "hiccough"], ["scare", "fright", "startle", "shock", "surprise"]]],
//       "hints": ["Think about why someone might want water other than thirst."]
//     }]
//   }
//
// - `reply`: yes | no | irrelevant | partly. `key`: true for the facts that crack the case (they score
//   and count as clues found).
// - `match`: concept groups; every group must be hit by the question; any word in a group hits it.
//   Words are lower case; phrases are fine ("gun shot"); inflections and typos are folded for you, so
//   list synonyms and the other words players use, not spellings.
// - `solve`: one or more alternative solutions, each a list of groups, in the same format.
// - `also_ask`: paraphrases a player might type; the checker requires each to land on its own fact.
//
// `toContent(bank)` turns it into the fragment's content lists; `checkBank(bank)` lists problems;
// `bankPrompt()` is the Muse prompt that writes one.

import { matchIntent, roots } from './intent.mjs';

export const REPLIES = { yes: 'y', no: 'n', irrelevant: 'i', partly: 'p' };
const REPLY_OF = Object.fromEntries(Object.entries(REPLIES).map(([k, v]) => [v, k]));
const STOP = new Set(['a', 'an', 'the', 'he', 'she', 'it', 'they', 'him', 'her', 'his', 'was', 'is', 'are', 'did', 'do',
  'doe', 'does', 'had', 'has', 'have', 'be', 'to', 'of', 'in', 'on', 'at', 'and', 'or', 'not', 'no', 'yes', 'any', 'some',
  'someone', 'something', 'thing', 'that', 'this', 'there', 'what', 'who', 'why', 'how', 'with', 'for', 'by', 'from',
  'man', 'woman', 'person', 'people', 'happen', 'happened']);

// Content text: ASCII apostrophes as ’ (engine string literals can't hold "'"; matching deletes both,
// so nothing changes for the matcher), and no separators inside a field.
const text = (s) => String(s ?? '').replace(/'/g, '’').replace(/\s+/g, ' ').trim();
const field = (s) => text(s).replace(/[|=;]/g, ' ').replace(/\s+/g, ' ').trim();
const safe = (s) => field(s).toLowerCase();
const groupsToString = (groups) => (groups ?? []).map((g) => (Array.isArray(g) ? g : [g]).map(safe).filter(Boolean).join('=')).filter(Boolean).join('|');

/** One fact as an intent string (no reply), e.g. "hiccup=hiccough|scare=fright". */
export const factIntent = (fact) => groupsToString(fact.match);

/** A fact's engine string: "<reply code>[*]|<ask, shown to the player>|<groups>". */
export const factString = (fact) => `${REPLIES[fact.reply] ?? 'i'}${fact.key ? '*' : ''}|${field(fact.ask)}|${factIntent(fact)}`;

/** Engine string back to {reply, key, ask, intent}. */
export function parseFact(s) {
  const [head, ask, ...rest] = String(s).split('|');
  return { reply: REPLY_OF[head.replace('*', '')] ?? 'irrelevant', key: head.includes('*'), ask: ask ?? '', intent: rest.join('|') };
}

/** The phrase a bot (or a hint) can type to ask a fact: the first word of each group. */
export const keyPhrase = (intent) => String(intent).split('|').map((g) => g.split('=')[0].trim()).filter(Boolean).join(' ');

/**
 * The qa_bank fragment's content lists, one entry per case:
 *   qa_titles[c], qa_setups[c], qa_reveals[c], qa_facts[c] (fact strings joined by ';'),
 *   qa_solves[c] (solution intents joined by ';').
 */
export function toContent(bank) {
  const cases = bank?.cases ?? [];
  return {
    qa_titles: cases.map((c) => text(c.title)),
    qa_setups: cases.map((c) => text(c.setup)),
    qa_reveals: cases.map((c) => text(c.solution)),
    qa_facts: cases.map((c) => (c.facts ?? []).map(factString).join(';')),
    qa_solves: cases.map((c) => (c.solve ?? []).map(groupsToString).filter(Boolean).join(';')),
  };
}

/**
 * Problems with a bank, as strings (empty = fine). Hard problems first word "error:", soft "warn:".
 * Checks shape, sizes, reply values, that each fact's `ask` and `also_ask` land on that fact (or on a
 * fact with the same reply), that the solution phrase solves, that no fact alone solves the case, and
 * stop words used as whole groups.
 */
export function checkBank(bank) {
  const out = [];
  if (bank?.bank !== 'qa-bank/1') out.push('error: bank must be "qa-bank/1"');
  const cases = bank?.cases ?? [];
  if (!cases.length) out.push('error: no cases');
  cases.forEach((c, ci) => {
    const at = `case ${ci + 1}`;
    if (!c.setup || String(c.setup).length > 240) out.push(`error: ${at}: setup missing or over 240 chars`);
    if (!c.solution || String(c.solution).length > 400) out.push(`error: ${at}: solution missing or over 400 chars`);
    const facts = c.facts ?? [];
    if (facts.length < 12) out.push(`error: ${at}: ${facts.length} facts, need at least 12`);
    if (facts.length > 60) out.push(`error: ${at}: ${facts.length} facts, at most 60`);
    if (!facts.some((f) => f.key)) out.push(`error: ${at}: no key facts`);
    const intents = facts.map(factIntent);
    facts.forEach((f, fi) => {
      if (!(f.reply in REPLIES)) out.push(`error: ${at} fact ${fi + 1}: reply "${f.reply}" is not yes, no, irrelevant or partly`);
      if (!intents[fi]) { out.push(`error: ${at} fact ${fi + 1}: no match groups`); return; }
      for (const g of String(intents[fi]).split('|')) {
        if (g.split('=').every((w) => roots(w).every((r) => STOP.has(r)))) out.push(`warn: ${at} fact ${fi + 1}: group "${g}" is only common words, it will match almost anything`);
      }
      for (const q of [f.ask, ...(f.also_ask ?? [])].filter(Boolean)) {
        const m = matchIntent(q, intents);
        if (m.index < 0) out.push(`warn: ${at} fact ${fi + 1}: "${q}" matches no fact`);
        else if (m.index !== fi && facts[m.index].reply !== f.reply) out.push(`warn: ${at} fact ${fi + 1}: "${q}" lands on fact ${m.index + 1} ("${facts[m.index].ask}", ${facts[m.index].reply}), not ${f.reply}`);
      }
    });
    const solves = (c.solve ?? []).map(groupsToString).filter(Boolean);
    if (!solves.length) out.push(`error: ${at}: no solve groups`);
    for (const s of solves) {
      if (matchIntent(keyPhrase(s), [s]).index !== 0) out.push(`warn: ${at}: solve "${s}" doesn't match its own key phrase`);
    }
    // A single yes/no question shouldn't also count as the solution unless it really is the whole story.
    facts.forEach((f, fi) => {
      if (f.ask && matchIntent(f.ask, solves).index >= 0) out.push(`warn: ${at} fact ${fi + 1}: asking "${f.ask}" would also solve the case`);
    });
  });
  return out;
}

/**
 * The Muse prompt that writes a bank. `request` is the person's idea; `count` cases. `puzzle`
 * ({setup, solution}) fixes the case, so only the facts are written.
 */
export function bankPrompt({ request, count = 1, theme = '', puzzle = null } = {}) {
  const system = [
    'You write content for a deterministic yes/no question game. The player reads a short mystery setup and types',
    'free yes/no questions. A matcher with NO language model maps each typed question to one of your facts by',
    'keyword groups, and answers with that fact\'s reply. So your keyword groups ARE the game\'s understanding.',
    '',
    'Return one JSON object, nothing else:',
    '{"bank":"qa-bank/1","cases":[{"title":str,"setup":str (<=240 chars, what the player sees),',
    '"solution":str (<=400 chars, the hidden full story),',
    '"facts":[{"ask":str (a natural yes/no question),"reply":"yes"|"no"|"irrelevant"|"partly","key":bool,',
    '"match":[[str,...],...] (concept groups),"also_ask":[str,str] (two other ways a player would ask it)}],',
    '"solve":[[[str,...],...]] (1-3 alternative solutions, each a list of concept groups),',
    '"hints":[str,str,str]}]}',
    '',
    'Rules for facts (30-50 per case):',
    '- First, one plain 1-group fact for EVERY person, animal, place and object named in the setup or the',
    '  solution ("Is the neighbour involved?" [["neighbour","neighbor","next door"]], "Is the water important?"),',
    '  so a vague question about it still gets an answer. Then the specific facts.',
    '- Cover what players actually ask: the people (who, age, relationship), motives (thirsty, angry, joke,',
    '  revenge, money), the place, time, objects in the setup, health and body, danger and weapons, crime,',
    '  death, emotions, whether others were involved, whether it was planned, and every element of the solution,',
    '  including the senses and signals in it (who hears, sees or notices what) and the purpose of each object.',
    '- Include facts whose answer is "no" for the common wrong theories, and "irrelevant" for details that',
    '  don\'t matter. Key facts (key: true) are the 2-5 facts on the path to the solution.',
    '- match: each group is ONE concept; list 3-10 words a player might use for it (synonyms, related nouns and',
    '  verbs, everyday words: "scare, fright, startle, shock, surprise, frighten, spook, jump"). Use 1 group for',
    '  a simple concept, 2 groups only when the question needs both (e.g. [["bartender","barman","barkeep"],',
    '  ["angry","mad","annoyed","upset"]]). Never put common words (he, was, did, man, the, someone) in a group.',
    '  Words are lower case; spelling variants and -s/-ed/-ing forms are handled for you.',
    '- Order facts most specific first: a 2-group fact before a 1-group fact on the same concept.',
    '- solve: the concepts a correct explanation must mention (usually 2 groups), generous with synonyms.',
    '- Write original puzzles. A well-known folk riddle the person names is fine; never copy text from a book',
    '  or site. Use real brand, franchise, creator and character names exactly as the person wrote them.',
  ].join('\n');
  const fixed = puzzle ? `Use exactly this case (copy setup and solution):\nSetup: ${puzzle.setup}\nSolution: ${puzzle.solution}\n` : '';
  const user = `Request: ${request}\n${theme ? `Theme: ${theme}\n` : ''}${fixed}Write ${puzzle ? 1 : count} case${!puzzle && count > 1 ? 's' : ''}.`;
  return { system, user };
}

// ---------- refine: a build-time playtest of the bank (probe, then one repair) ----------
// Muse plays the player: from the setup it writes the questions people ask, and (knowing the
// solution) the true reply of each. The matcher answers them with the bank; every question it gets
// wrong or can't place goes back to Muse once, to fix the bank's words. All of this happens when the
// game is made, so play stays deterministic.

/** Muse writes `count` player questions for one case, each with its true reply. */
export function probePrompt(c, count = 40) {
  const system = [
    'You test a yes/no mystery game. Write the questions real players type on a phone, from the setup alone:',
    'short, casual, often lower case, sometimes vague ("is the water important"), sometimes a theory',
    '("did he want to rob the bar"), a few with typos. Mix early broad questions, wrong theories and questions',
    'close to the answer. Then, knowing the solution, give the true reply of each.',
    'Return one JSON object: {"questions":[{"q":str,"reply":"yes"|"no"|"irrelevant"|"partly"}]}',
  ].join('\n');
  const user = `Setup: ${c.setup}\nSolution: ${c.solution}\nWrite ${count} questions.`;
  return { system, user };
}

/** Run the probe questions through the bank: the ones it answers wrongly or can't place. */
export function probeFailures(c, questions) {
  const facts = c.facts ?? [];
  const intents = facts.map(factIntent);
  const out = [];
  for (const { q, reply } of questions ?? []) {
    const m = matchIntent(q, intents);
    const got = m.index < 0 ? null : facts[m.index];
    if (!got || got.reply !== reply) out.push({ q, want: reply, got: got ? `${got.reply} (fact "${got.ask}")` : 'no fact matched' });
  }
  return out;
}

/** Muse fixes the bank's facts for the failures; returns the whole bank again. */
export function repairPrompt(bank, failures) {
  const { system } = bankPrompt({ request: '' });
  const user = [
    'Here is a bank and the player questions the matcher got wrong. Fix the facts so each of these questions',
    'lands on a fact with the right reply: add missing facts, add the player\'s words to the right groups, take',
    'over-broad words out of groups that steal questions, and split facts when one concept has two answers.',
    'Keep setup, solution and solve. Return the whole bank as one JSON object.',
    '',
    `Failures (${failures.length}):`,
    ...failures.map((f) => `- "${f.q}": want ${f.want}, got ${f.got}`),
    '',
    'Bank:',
    JSON.stringify(bank),
  ].join('\n');
  return { system, user };
}
