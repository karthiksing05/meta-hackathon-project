// Requirements: every explicit number, name and rule in a request, kept as a checkable list
// (game-spec/1 `spec.requirements[]`, docs/HARNESS_V2.md "Requirements").
//
// "The Office trivia with 12 questions, a 15-second timer" must come back with 12 questions and a
// 15-second timer, not "about 10" and "8 s". The planner extracts the requirements, compose gets them
// quoted, and authoring/playtest/requirements-check.mjs checks the built game against them.
//
// Each requirement:
//   {id: "r1", quote: "<exact words from the request>", kind, target: {...} | null, must: true|false,
//    verify: "code" | "playtest" | "judge"}
// kind ∈ REQUIREMENT_KINDS. target is the machine-checkable part (TARGET_VOCABULARY); null means a judge
// reads the game for it.
//
// Pure: no disk, no network. Muse is a function the caller passes in (`ask`, as in pipeline.mjs).

export const REQUIREMENT_KINDS = ['count', 'timer', 'content', 'rule', 'win', 'lose', 'control', 'style', 'tone', 'structure', 'social'];
export const VERIFY_BY = ['code', 'playtest', 'judge'];
export const OPS = ['==', '>=', '<=', '>', '<'];

/**
 * What a target may say. requirements-check.mjs knows how to check each one.
 * - {measure, op, value}: a number the game has. measure ∈ MEASURES.
 * - {text: [words], match: "all" | "any"}: words players see (title, instructions, content, labels).
 * - {palette: {only: [color names]}} or {palette: {include: [...]}}: the game's colors.
 * - {input: "swipe" | "drag" | "tap" | "type" | "choice"} and {input_not: ...}: the controls.
 * - {no: "timer" | "lose"}: something the person ruled out.
 * - {timeout_is: "win" | "lose"}: what running out the clock means.
 * - {numbers: [n, ...]}: numbers that must appear in the game's rules, content or params (prices, costs).
 * - {state_reaches: {name: "<regex on state names>", op, value}}: a state value some bot run reaches.
 * - {path: "content.questions.length", op, value}: a JSON path into the authoring manifest.
 */
export const MEASURES = {
  questions: 'questions, prompts, rounds of play, orders, items to finish (how many the player gets in one run)',
  rounds: 'rounds in a match (best of N)',
  choices: 'answer choices per question',
  choices_made: 'decisions a player makes in one run (stories)',
  run_seconds: 'how long one run lasts, in seconds',
  per_question_seconds: 'time per question or per round, in seconds',
  lives: 'lives, strikes, hearts or mistakes allowed before the run ends (1 = one hit ends it)',
  lanes: 'lanes',
  waves: 'waves',
  pairs: 'card pairs',
  holes: 'holes, slots or cells on the board',
  columns: 'board columns',
  rows: 'rows (of bricks, of the board)',
  pads: 'pads or buttons in a memory game',
  budget: 'money or points to spend',
  bpm: 'beats per minute',
  win_at: 'the score or count that wins the run',
};
export const COLOR_NAMES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'black', 'white', 'gray', 'gold', 'teal'];
export const INPUTS = ['swipe', 'drag', 'tap', 'type', 'choice'];

// ---------- the deterministic pass: numbers, names, quoted words, colors, controls ----------

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, hundred: 100 };
const NUM = `(?:\\$?\\d+(?:,\\d{3})*(?:\\.\\d+)?|${Object.keys(NUMBER_WORDS).join('|')})`;

/** A number token as a number: "1,000" → 1000, "$100" → 100, "three" → 3. */
export function toNumber(token) {
  const t = String(token).toLowerCase().replace(/[$,]/g, '');
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t];
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Noun after a number → which measure, and which kind of requirement it is.
const NOUNS = [
  [/^(?:-|\s)*(?:seconds?|secs?|s)\b(?!\w)/i, 'seconds'],
  [/^(?:-|\s)*(?:minutes?|mins?)\b/i, 'minutes'],
  [/^\s*(?:lives|life|hearts?|strikes?|hits?|mistakes?|wrong (?:guesses|answers)|misses|stars?)\b/i, 'lives'],
  [/^\s*lanes?\b/i, 'lanes'],
  [/^\s*waves?\b/i, 'waves'],
  [/^\s*pairs?\b/i, 'pairs'],
  [/^\s*(?:holes?|slots?|cells?)\b/i, 'holes'],
  [/^\s*columns?\b/i, 'columns'],
  [/^\s*rows?\b/i, 'rows'],
  [/^\s*(?:\w+\s+)?pads?\b/i, 'pads'],
  [/^\s*(?:answer\s+)?choices?\b/i, 'choices'],
  [/^\s*rounds?\b/i, 'rounds'],
  [/^\s*bpm\b/i, 'bpm'],
  [/^\s*(?:\w+\s+){0,2}(?:questions?|problems?|prompts?|flags?|words?|pizzas?|orders?|plants?|kicks?|levels?|puzzles?|riddles?|clues?|cards?|songs?|items?)\b/i, 'questions'],
];

const GENERIC_LEADS = new Set(['a', 'an', 'the', 'my', 'trivia', 'snake', 'endless', 'word', 'space', 'memory', 'whack', 'whack-a-mole', 'best', 'book', 'choose', 'flappy', 'flappy-style', 'math', 'typing', 'quiz', 'block', 'geography', 'pizza', 'calm', 'dodge', 'emoji', 'pirate', 'simon', 'simon-says', 'rhythm', 'penalty', 'cookie', 'breakout', 'tetris', 'make', 'game', 'i', 'retro', 'survival', 'rating', 'spot', 'guess', 'rank', 'puzzle', 'lateral', 'galaga', 'pong', 'jeopardy', 'connections', 'wordle', 'minesweeper', 'crossword', 'sudoku']);

// Commas inside "1,000" and inside a number list ("10, 50 and 200") don't end a clause.
function masked(text) {
  let out = text.replace(/\d,\d{3}\b/g, (s) => s.replace(',', '\u0001'));
  out = out.replace(/\d+(?:,\s*\d+)+,?\s*(?:and|or)\s*\d+/g, (s) => s.replace(/,/g, '\u0001'));
  return out;
}

function spans(text, splitter, base = /[^,;:.!?()]+/g) {
  const m = masked(text);
  const out = [];
  const re = new RegExp(base.source, 'g');
  let x;
  while ((x = re.exec(m))) {
    if (!splitter) { out.push([x.index, x.index + x[0].length]); continue; }
    const part = x[0];
    let last = 0;
    let s;
    splitter.lastIndex = 0;
    while ((s = splitter.exec(part))) {
      out.push([x.index + last, x.index + s.index]);
      last = s.index + s[0].length;
    }
    out.push([x.index + last, x.index + part.length]);
  }
  return out.map(([a, b]) => {
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    return [a, b];
  }).filter(([a, b]) => b - a > 1);
}

/** Clauses of the request, each an exact substring, split on punctuation and joining words. */
export function clauses(request) {
  const text = String(request ?? '');
  return spans(text, /\s(?:and|where|but|while|so)\s/gi).map(([a, b]) => text.slice(a, b));
}

function spanAt(text, index, splitter) {
  for (const [a, b] of spans(text, splitter)) if (a <= index && index < b) return text.slice(a, b);
  return null;
}
const clauseOf = (text, index) => spanAt(text, index, /\s(?:and|where|but|while|so)\s/gi);
const sentenceOf = (text, index) => {
  for (const [a, b] of spans(text, null, /[^.;!?]+/g)) if (a <= index && index < b) return text.slice(a, b);
  return null;
};

/** Proper names in the request: runs of capitalized words (with "of", "and", "to" inside), minus generic leads. */
export function namesIn(request) {
  const text = String(request ?? '');
  const names = [];
  const re = /\b([A-Z][\w'’.-]*(?:\s+(?:of|and|to|the|de|la)\s+[A-Z][\w'’.-]*|\s+[A-Z0-9][\w'’.-]*)*)/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1].replace(/[.'’]+$/, '');
    const words = name.split(/\s+/);
    const first = words[0].toLowerCase();
    const atStart = m.index === 0 || /[.:;!?]\s*$/.test(text.slice(0, m.index));
    // "Snake game" at the start is a genre, not a name; "HeyTea" (inner capital) and "The Office" (two words) are names.
    if (atStart && words.length === 1 && !/[a-z][A-Z]/.test(name) && GENERIC_LEADS.has(first.replace(/[-’']s$/, ''))) continue;
    if (/^(I|I'm|I’m|I've|I'll)$/.test(name)) continue;
    if (atStart && words.length === 2 && GENERIC_LEADS.has(first) && GENERIC_LEADS.has(words[1].toLowerCase())) continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Words the person put in quotes: 'DOUBLE!', "Perfect". */
export function quotedIn(request) {
  const text = String(request ?? '');
  const out = [];
  const re = /['"‘“]([^'"’”]{1,40})['"’”]/g;
  let m;
  while ((m = re.exec(text))) {
    // An apostrophe inside a word ("I'm", "you're") is not a quote.
    const before = text[m.index - 1];
    if (before && /\w/.test(before)) { re.lastIndex = m.index + 1; continue; }
    out.push({ word: m[1], index: m.index, raw: m[0] });
  }
  return out;
}

const LEAD_INS = /(?:\b(?:a|an|exactly|only|at most|at least|under|over|best of|have|just|after|before|in|within|for|lasts)\s+)+$/i;
const TRAILERS = /^(?:\s+(?:each|per (?:question|round|turn|level|order)|or (?:less|fewer|more)|allowed|wide|tall|long|in total|timer|clock|countdown|left))+/i;

/** The short quote for a number: "a 15-second timer per question", "12 questions", "$100". */
function numberQuote(text, start, nounEnd) {
  const lead = LEAD_INS.exec(text.slice(Math.max(0, start - 24), start));
  const a = lead ? start - lead[0].length : start;
  const trail = TRAILERS.exec(text.slice(nounEnd));
  const b = nounEnd + (trail ? trail[0].length : 0);
  return text.slice(a, b).trim();
}

/**
 * The deterministic pass. It never misses an explicit number, quoted word, color, control or "no X",
 * which is what the coverage check holds Muse's list to. Kinds and targets are best guesses; Muse's
 * list wins where both speak to the same words.
 */
export function seedRequirements(request) {
  const text = String(request ?? '');
  const reqs = [];
  const add = (r) => {
    if (!r.quote || !text.includes(r.quote)) return;
    if (reqs.some((x) => x.quote === r.quote && JSON.stringify(x.target) === JSON.stringify(r.target))) return;
    reqs.push({ id: `r${reqs.length + 1}`, must: true, ...r });
  };
  const inQuote = (start, end) => reqs.some((r) => {
    const at = text.indexOf(r.quote);
    return at >= 0 && at <= start && end <= at + r.quote.length;
  });
  let m;

  // Social: who it's for, and against whom.
  const social = /\bfor my [\w' ]+? of \d+\b|\bfor my (?:book club|family|friends|team|class|group chat|crew|squad)\b|\bagainst my \w+\b|\bwith my (?:friends|family|brother|sister|mom|dad|team|crew)\b|\bmy friend group(?:'s|’s)? [\w ]+?(?=[,;.:]|\swith\b|$)/gi;
  while ((m = social.exec(text))) add({ quote: m[0].trim(), kind: 'social', target: null, verify: 'judge', must: !/inside jokes/i.test(m[0]) });

  // Number lists: "upgrades cost 10, 50 and 200 cookies".
  const listRe = /\d[\d,]*(?:,\s*\d[\d,]*)+,?\s*(?:and|or)\s*\d[\d,]*(?:\s+[a-z]+)?/g;
  while ((m = listRe.exec(text))) {
    const nums = [...m[0].matchAll(/\d[\d,]*/g)].map((x) => toNumber(x[0].replace(/,$/, ''))).filter((n) => n !== null);
    const clause = clauseOf(text, m.index) ?? m[0];
    const quote = clause.includes(m[0]) ? clause : m[0];
    add({ quote, kind: 'rule', target: { numbers: nums }, verify: 'code' });
  }

  // Numbers with their nouns.
  let held = null;
  const numRe = new RegExp(`(?<![\\w,])(best of\\s+)?(${NUM})(?![\\w])`, 'gi');
  while ((m = numRe.exec(text))) {
    const start = m.index + (m[1] ? m[1].length : 0);
    const value = toNumber(m[2]);
    if (value === null) continue;
    const end = m.index + m[0].length;
    if (inQuote(start, end)) continue;
    const after = text.slice(end, end + 40);
    if (/^x\d/i.test(after) || /\dx$/i.test(text.slice(0, start))) continue; // "3x3" comes with its cell count
    if (/^\s+of\s+(?:my|the|your)\b/i.test(after)) { held = start; continue; } // "1 of my 3 stars": the 3 carries it
    if (/[A-Z][\w'’]*\s+$/.test(text.slice(Math.max(0, start - 20), start)) && !/^\s*[a-z]/i.test(after)) continue; // "Season 3": part of a name
    const from = held !== null && start - held < 16 ? held : start;
    held = null;
    const clause = clauseOf(text, m.index) ?? m[0];
    const local = text.slice(Math.max(0, start - 30), Math.min(text.length, end + 30));
    if (m[1]) { add({ quote: `${m[1]}${m[2]}${(TRAILERS.exec(after) ?? [''])[0]}`.trim(), kind: 'structure', target: { measure: 'rounds', op: '==', value }, verify: 'code' }); continue; }
    let noun = null;
    let nounLen = 0;
    for (const [re, n] of NOUNS) { const x = re.exec(after); if (x) { noun = n; nounLen = x[0].length; break; } }
    const near = text.slice(Math.max(0, start - 10), end + nounLen + 12);
    const op = /\bor (?:less|fewer)\b|\bat most\b|\bwithin\b/i.test(near) ? '<=' : /\bor more\b|\bat least\b/i.test(near) ? '>=' : '==';
    const ruleish = new RegExp(`\\bevery\\s+${m[2]}\\b|\\bin a row\\b|\\bworth\\b|\\bcosts?\\b|\\btakes?\\b[^,;]*\\boff\\b|\\bgrows? by\\b|\\bby ${m[2]}\\b|\\bat once\\b|\\bearns?\\b|\\bdouble\\b|\\bper (?:tap|hit|kill)\\b`, 'i');
    if (noun === 'seconds' || noun === 'minutes') {
      const secs = noun === 'minutes' ? value * 60 : value;
      if (ruleish.test(clause) || /\bpenalt|\bminus\b/i.test(clause)) { add({ quote: clause, kind: 'rule', target: null, verify: 'judge' }); continue; }
      const per = /\bper (?:question|round|turn)\b|\beach (?:question|round|turn)\b/i.test(clause);
      add({ quote: numberQuote(text, start, end + nounLen), kind: 'timer', target: { measure: per ? 'per_question_seconds' : 'run_seconds', op: '==', value: secs }, verify: /\bends? after\b|\blasts?\b/i.test(clause) ? 'playtest' : 'code' });
      continue;
    }
    if ((ruleish.test(local) || /\beach \w+ (?:lists|has|shows|reveals|gets|needs)\b/i.test(clause)) && noun !== 'lives') { add({ quote: clause, kind: 'rule', target: null, verify: 'judge' }); continue; }
    if (noun === 'lives') { add({ quote: numberQuote(text, from, end + nounLen), kind: 'lose', target: { measure: 'lives', op: '==', value }, verify: 'playtest' }); continue; }
    if (noun === 'bpm') { add({ quote: numberQuote(text, start, end + nounLen), kind: 'rule', target: { measure: 'bpm', op: '==', value }, verify: 'code' }); continue; }
    if (noun === 'choices' && /\bin\s+$/i.test(text.slice(0, start))) { add({ quote: numberQuote(text, start, end + nounLen), kind: 'count', target: { measure: 'choices_made', op, value }, verify: 'playtest' }); continue; }
    if (noun) { add({ quote: numberQuote(text, start, end + nounLen), kind: noun === 'rounds' || noun === 'waves' ? 'structure' : 'count', target: { measure: noun, op, value }, verify: 'code' }); continue; }
    if (/^\$/.test(m[2]) || /\bbudget\b/i.test(clause)) { add({ quote: numberQuote(text, start, end), kind: 'count', target: { measure: 'budget', op: '==', value }, verify: 'code' }); continue; }
    if (/\bwins?\b|\breach\b/i.test(clause)) { const x = /^\s+[a-z]+/i.exec(after); add({ quote: numberQuote(text, start, end + (x ? x[0].length : 0)), kind: 'win', target: { measure: 'win_at', op: '==', value }, verify: 'code' }); continue; }
    const plural = /^\s+(?:[a-z-]+\s+)?[a-z]+s\b/i.exec(after);
    if (plural && /\d/.test(m[2])) { add({ quote: numberQuote(text, start, end + plural[0].length), kind: 'count', target: { measure: 'questions', op, value }, verify: 'code' }); continue; }
    // A bare number with no noun ("numbers under 50"): the few words around it, for the judge.
    if (/\d/.test(m[2])) { const w = /(?:\S+\s+){0,3}$/.exec(text.slice(0, start)); add({ quote: text.slice(start - (w ? w[0].length : 0), end).trim(), kind: 'rule', target: null, verify: 'judge' }); }
  }

  // Lists the person gave: "these 5 words: a, b, c".
  const list = /\b(?:these|the following|use|using)\b[^:.;]*:\s*([^.;]+)/i.exec(text);
  if (list) {
    const items = list[1].split(/,|\band\b/).map((s) => s.trim()).filter((s) => s && s.length <= 40);
    if (items.length >= 2) add({ quote: list[0].trim(), kind: 'content', target: { text: items, match: 'all' }, verify: 'code' });
  }

  // Quoted words must show up as written.
  for (const q of quotedIn(text)) add({ quote: q.raw, kind: 'tone', target: { text: [q.word], match: 'all' }, verify: 'code' });

  // Colors, grouped per sentence: "only greens and black", "(red, blue, yellow, green)".
  const colorRe = new RegExp(`\\b(${[...COLOR_NAMES, 'greens', 'blues', 'reds', 'grey'].join('|')})\\b`, 'gi');
  const groups = new Map();
  while ((m = colorRe.exec(text))) {
    const sentence = sentenceOf(text, m.index) ?? m[0];
    if (!groups.has(sentence)) groups.set(sentence, { first: m.index, last: m.index + m[0].length, colors: [] });
    const g = groups.get(sentence);
    g.last = m.index + m[0].length;
    const name = m[1].toLowerCase().replace(/s$/, '').replace('grey', 'gray');
    if (!g.colors.includes(name)) g.colors.push(name);
  }
  for (const g of groups.values()) {
    let a = g.first;
    let b = g.last;
    const lead = /(?:\b(?:only|just|in|all)\s+)?(?:\b(?:pastel|neon|soft|bright|dark|light)\s+)?$/i.exec(text.slice(Math.max(0, a - 20), a));
    if (lead) a -= lead[0].length;
    const tail = /^\s+colou?rs?\b/i.exec(text.slice(b));
    if (tail) b += tail[0].length;
    if (text[a - 1] === '(' && text[b] === ')') { a--; b++; }
    const quote = text.slice(a, b).trim();
    const only = /\bonly\b|\bjust\b/i.test(text.slice(Math.max(0, a - 6), b));
    add({ quote, kind: 'style', target: { palette: only ? { only: g.colors } : { include: g.colors } }, verify: 'code' });
  }

  // Art styles.
  const style = /\b(pixel art|8-bit|watercolou?r(?: style)?|hand-drawn|retro|minimalist|claymation|cartoon|paper cut-?out|low-poly|sketchy|comic book)\b/i.exec(text);
  if (style) add({ quote: style[0], kind: 'style', target: null, verify: 'judge' });

  // Controls.
  for (const [re, input] of [[/\bswip(?:e|es|ing)\b/i, 'swipe'], [/\bdrag(?:s|ging)?\b/i, 'drag'], [/\bI type\b|\btyped\b|\btype (?:the|in|out)\b|\btyping\b/i, 'type'], [/\bmultiple[- ]choice\b/i, 'choice'], [/\btap(?:s|ping)?\b/i, 'tap']]) {
    const hit = re.exec(text);
    if (!hit) continue;
    const before = text.slice(Math.max(0, hit.index - 5), hit.index);
    const negated = /\bnot\s+$|\bno\s+$/i.test(before);
    if (input === 'tap' && !negated) continue; // "tap" alone is the default, and often a rule ("each tap earns")
    add({ quote: negated ? `${before.trim().split(/\s+/).pop()} ${hit[0]}` : hit[0], kind: 'control', target: negated ? { input_not: input } : { input }, verify: 'code' });
  }

  // Things ruled out.
  const noTimer = /\bno (?:timer|clock|time limit)\b/i.exec(text);
  if (noTimer) add({ quote: noTimer[0], kind: 'rule', target: { no: 'timer' }, verify: 'code' });
  const noLose = /\bno way to lose\b|\bcan(?:'|’)?t lose\b|\bno losing\b|\bno game over\b/i.exec(text);
  if (noLose) add({ quote: noLose[0], kind: 'lose', target: { no: 'lose' }, verify: 'playtest' });

  // Tone, for the judge.
  const tone = /\b(?:roasts?|talks? like|trash[- ]talks?|sarcastic|narrat(?:or|es)|voice[sd]?|in [\w ]*slang)\b/i.exec(text);
  if (tone) add({ quote: clauseOf(text, tone.index) ?? tone[0], kind: 'tone', target: null, verify: 'judge' });

  // Win and lose sentences without a number.
  for (const re of [/\b(?:surviving|survive)[^,;.]*\bwins?\b/i, /\bthe winner gets [^,;.]+/i, /\bwins? (?:if|when|by)\b[^,;.]*/i, /\b(?:trying to |to )?become (?:the )?[\w ]+?(?=\s+in\b|[,;.]|$)/i, /\btells me [^,;.]+/i]) {
    const w = re.exec(text);
    if (!w || inQuote(w.index, w.index + w[0].length)) continue;
    const surv = /surviv/i.test(w[0]);
    add({ quote: w[0].trim(), kind: 'win', target: surv ? { timeout_is: 'win' } : null, verify: surv ? 'code' : 'judge' });
  }
  for (const re of [/\bends? at your first mistake\b/i, /\bone hit ends\b[^,;.]*/i, /\bwithout\s+[^,;.]+/i]) {
    const l = re.exec(text);
    if (!l || inQuote(l.index, l.index + l[0].length)) continue;
    if (/first mistake|one hit/i.test(l[0])) add({ quote: l[0].trim(), kind: 'lose', target: { measure: 'lives', op: '==', value: 1 }, verify: 'playtest' });
    else add({ quote: l[0].trim(), kind: 'lose', target: null, verify: 'judge' });
  }

  // Names, unless another requirement already quotes them.
  for (const name of namesIn(text)) {
    const at = text.indexOf(name);
    if (inQuote(at, at + name.length)) continue;
    if (/^\d/.test(name)) continue;
    add({ quote: name, kind: 'content', target: { text: [name], match: 'all' }, verify: 'code' });
  }

  reqs.forEach((r, i) => { r.id = `r${i + 1}`; });
  return reqs;
}

// ---------- checking a list ----------

function validTarget(t) {
  if (t === null || t === undefined) return null;
  if (typeof t !== 'object') return null;
  if (t.measure !== undefined) {
    const value = typeof t.value === 'number' ? t.value : toNumber(t.value);
    if (!(t.measure in MEASURES) || value === null) return null;
    return { measure: t.measure, op: OPS.includes(t.op) ? t.op : '==', value };
  }
  if (t.path !== undefined) {
    const value = typeof t.value === 'number' ? t.value : t.value;
    return typeof t.path === 'string' ? { path: t.path, op: OPS.includes(t.op) ? t.op : '==', value } : null;
  }
  if (Array.isArray(t.text)) {
    const words = t.text.filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim()).slice(0, 20);
    return words.length ? { text: words, match: t.match === 'any' ? 'any' : 'all' } : null;
  }
  if (t.palette && typeof t.palette === 'object') {
    const clean = (l) => (Array.isArray(l) ? l.map((c) => String(c).toLowerCase().replace(/s$/, '').replace('grey', 'gray')).filter((c) => COLOR_NAMES.includes(c)) : []);
    const only = clean(t.palette.only);
    const include = clean(t.palette.include);
    if (only.length) return { palette: { only } };
    if (include.length) return { palette: { include } };
    return null;
  }
  if (INPUTS.includes(t.input)) return { input: t.input };
  if (INPUTS.includes(t.input_not)) return { input_not: t.input_not };
  if (t.no === 'timer' || t.no === 'lose') return { no: t.no };
  if (t.timeout_is === 'win' || t.timeout_is === 'lose') return { timeout_is: t.timeout_is };
  if (Array.isArray(t.numbers)) {
    const nums = t.numbers.map((n) => (typeof n === 'number' ? n : toNumber(n))).filter((n) => n !== null);
    return nums.length ? { numbers: nums } : null;
  }
  if (t.state_reaches && typeof t.state_reaches === 'object' && typeof t.state_reaches.name === 'string') {
    try { new RegExp(t.state_reaches.name, 'i'); } catch { return null; }
    const value = typeof t.state_reaches.value === 'number' ? t.state_reaches.value : toNumber(t.state_reaches.value);
    if (value === null) return null;
    return { state_reaches: { name: t.state_reaches.name, op: OPS.includes(t.state_reaches.op) ? t.state_reaches.op : '>=', value } };
  }
  return null;
}

/** The quote as it appears in the request: exact, else the request's own words matched without case and spacing. */
export function exactQuote(request, quote) {
  const text = String(request ?? '');
  const q = String(quote ?? '').trim();
  if (!q) return null;
  if (text.includes(q)) return q;
  const lower = text.toLowerCase();
  const at = lower.indexOf(q.toLowerCase());
  if (at >= 0) return text.slice(at, at + q.length);
  const squash = (s) => s.replace(/\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();
  const sq = squash(q).replace(/^["']|["']$/g, '');
  const st = squash(text);
  const i = st.indexOf(sq);
  return i >= 0 ? text.slice(i, i + sq.length) : null;
}

/**
 * Cleans a requirement list (Muse's, or a stored one): known kinds, exact quotes, valid targets,
 * verify set to what the target allows, ids r1..rN. Returns {requirements, issues}.
 */
export function normalizeRequirements(list, request) {
  const issues = [];
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue;
    const quote = exactQuote(request, raw.quote);
    if (!quote) { issues.push({ code: 'R_QUOTE_NOT_IN_REQUEST', message: `"${String(raw.quote ?? '').slice(0, 80)}" is not in the request` }); continue; }
    const kind = REQUIREMENT_KINDS.includes(raw.kind) ? raw.kind : 'rule';
    const target = validTarget(raw.target);
    let verify = VERIFY_BY.includes(raw.verify) ? raw.verify : null;
    if (!target) verify = 'judge';
    else if (!verify || verify === 'judge') verify = target.state_reaches || target.no === 'lose' || target.measure === 'lives' || target.measure === 'choices_made' ? 'playtest' : 'code';
    const r = { id: '', quote, kind, target, must: raw.must !== false && raw.must !== 'nice', verify };
    if (raw.note) r.note = String(raw.note).slice(0, 200);
    if (out.some((x) => x.quote === r.quote && JSON.stringify(x.target) === JSON.stringify(r.target))) continue;
    out.push(r);
  }
  out.forEach((r, i) => { r.id = `r${i + 1}`; });
  return { requirements: out, issues };
}

/** Every explicit number, quoted word and name in the request must sit inside some requirement's quote. */
export function coverageIssues(request, requirements) {
  const text = String(request ?? '');
  const quotes = requirements.map((r) => r.quote);
  const covered = (start, end) => quotes.some((q) => {
    let at = text.indexOf(q);
    while (at >= 0) {
      if (at <= start && end <= at + q.length) return true;
      at = text.indexOf(q, at + 1);
    }
    return false;
  });
  const issues = [];
  const numRe = new RegExp(`\\b${NUM}\\b`, 'gi');
  let m;
  while ((m = numRe.exec(text))) {
    if (toNumber(m[0]) === null) continue;
    if (/^(one|a)$/i.test(m[0]) && !/\bone (?:hit|life|mistake|try)\b/i.test(text.slice(m.index, m.index + 14))) continue;
    if (!covered(m.index, m.index + m[0].length)) issues.push({ code: 'R_UNCOVERED_NUMBER', message: `"${m[0]}" in the request has no requirement`, at: m.index });
  }
  for (const q of quotedIn(text)) if (!covered(q.index + 1, q.index + 1 + q.word.length)) issues.push({ code: 'R_UNCOVERED_QUOTE', message: `'${q.word}' in the request has no requirement`, at: q.index });
  for (const name of namesIn(text)) {
    const at = text.indexOf(name);
    if (!covered(at, at + name.length)) issues.push({ code: 'R_UNCOVERED_NAME', message: `"${name}" in the request has no requirement`, at });
  }
  return issues;
}

/**
 * Muse's list first; then any seed whose words Muse's quotes don't cover (numbers, names, quoted words
 * are never dropped). Returns {requirements, issues, added}.
 */
export function mergeRequirements(request, museList, seeds = seedRequirements(request)) {
  const { requirements: fromMuse, issues } = normalizeRequirements(museList, request);
  const merged = fromMuse.slice();
  const added = [];
  for (const s of seeds) {
    const same = merged.find((r) => r.quote === s.quote || (r.quote.includes(s.quote) && sameTargetKind(r.target, s.target)));
    if (same) {
      // Muse may leave a target out where the seed has a checkable one; keep the checkable one.
      if (!same.target && s.target) { same.target = s.target; same.verify = s.verify; }
      continue;
    }
    const coveredBy = merged.find((r) => r.quote.includes(s.quote) || s.quote.includes(r.quote));
    if (coveredBy && (!s.target || sameTargetKind(coveredBy.target, s.target))) continue;
    merged.push({ ...s });
    added.push(s.quote);
  }
  merged.forEach((r, i) => { r.id = `r${i + 1}`; });
  return { requirements: merged, issues: [...issues, ...coverageIssues(request, merged)], added };
}

function sameTargetKind(a, b) {
  if (!a || !b) return false;
  const k = (t) => (t.measure ? `m:${t.measure}` : Object.keys(t)[0]);
  return k(a) === k(b);
}

// ---------- the plan may not contradict a requirement ----------

const MEASURE_WORDS = {
  questions: /questions?|problems?|prompts?|flags?|words?|pizzas?|orders?|plants?|kicks?|rounds?|items?|cards?/,
  rounds: /rounds?|games?|matches?/,
  choices: /choices?|options?|answers?/,
  lives: /lives|life|hearts?|strikes?|mistakes?|misses|stars?|hits?/,
  lanes: /lanes?/, waves: /waves?/, pairs: /pairs?/, holes: /holes?|cells?/, columns: /columns?|cols?/, rows: /rows?/, pads: /pads?/,
};

function compare(a, op, b) {
  switch (op) {
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '<': return a < b;
    default: return a === b;
  }
}
export { compare };

/**
 * Spots a plan (game-spec/1) that says a different number than a requirement: "10 questions" where the
 * person asked for 12, a 20 s run where they asked for 45. Returns [{code, requirement, quote, message}].
 */
export function planContradictions(requirements, spec) {
  if (!spec || typeof spec !== 'object') return [];
  const out = [];
  const strings = [];
  const walk = (v, path) => {
    if (typeof v === 'string') strings.push({ s: v, path });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}/${i}`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'requirements') walk(x, `${path}/${k}`);
  };
  walk(spec, '');
  for (const r of requirements) {
    const t = r.target;
    if (!t?.measure) continue;
    if (t.measure === 'run_seconds' || t.measure === 'per_question_seconds') {
      // A time constraint that names seconds, none of which is the asked-for value.
      const items = Array.isArray(spec.constraints?.items) ? spec.constraints.items.filter((c) => /time|timer|clock/i.test(`${c.kind ?? ''}`)) : [];
      const secs = items.flatMap((c) => [...String(`${c.value ?? ''}`).matchAll(/(\d+(?:\.\d+)?)\s*(ms|s\b|sec|seconds?|min|minutes?)/gi)].map((x) => (/^ms/i.test(x[2]) ? Number(x[1]) / 1000 : /^min/i.test(x[2]) ? Number(x[1]) * 60 : Number(x[1]))));
      if (secs.length && !secs.some((v) => compare(v, t.op, t.value))) out.push({ code: 'R_PLAN_CONTRADICTS', requirement: r.id, quote: r.quote, message: `the plan's time limit says ${secs.join(' / ')} s; the person asked for ${t.value} s` });
      continue;
    }
    const words = MEASURE_WORDS[t.measure];
    if (!words) continue;
    const re = new RegExp(`\\b(\\d+)\\s+(?:[a-z-]+\\s+){0,2}(?:${words.source})\\b`, 'gi');
    const found = [];
    for (const { s, path } of strings) for (const x of s.matchAll(re)) found.push({ n: Number(x[1]), path, text: x[0] });
    const wrong = found.filter((f) => !compare(f.n, t.op, t.value));
    const right = found.filter((f) => compare(f.n, t.op, t.value));
    if (wrong.length && !right.length) out.push({ code: 'R_PLAN_CONTRADICTS', requirement: r.id, quote: r.quote, message: `the plan says "${wrong[0].text}" (${wrong[0].path}); the person asked for "${r.quote}"` });
  }
  return out;
}

// ---------- prompts ----------

export const REQUIREMENTS_SYSTEM = `You read a request for a tiny phone game and list every requirement the person stated, so the built game can be checked against each one. Reply with one JSON object {"requirements": [...]}, nothing else.

Rules:
- Every explicit number, name, quoted word, rule, win or lose condition, control, art style, color, tone and social detail in the request becomes a requirement. Never add one the person didn't say, and never merge two numbers into one requirement.
- "quote" is the exact words from the request (copy them character for character, the shortest span that states the requirement).
- "kind" is one of: ${REQUIREMENT_KINDS.join(', ')}.
- "must": true for anything stated plainly; false only for soft wishes ("maybe", "if possible", "something like").
- "target" is the machine-checkable part, or null when only a reader can judge it (a tone, an art style, a rule like "speeds up every 5 apples"). Use exactly one of these shapes:
  {"measure": "<${Object.keys(MEASURES).join(' | ')}>", "op": "== | >= | <=", "value": <number>}
${Object.entries(MEASURES).map(([k, v]) => `    ${k}: ${v}`).join('\n')}
  {"text": ["<words players must see>"], "match": "all" | "any"}   (names, quoted words, listed words)
  {"palette": {"only": ["<color>"]}} or {"palette": {"include": ["<color>"]}}   (colors: ${COLOR_NAMES.join(', ')})
  {"input": "swipe | drag | tap | type | choice"} or {"input_not": "..."}   ("type" = typed answers, "choice" = multiple choice)
  {"no": "timer" | "lose"}   (the person ruled it out)
  {"timeout_is": "win" | "lose"}   ("survive to the end wins")
  {"numbers": [<n>, ...]}   (prices, costs, point values that must appear in the rules)
  {"state_reaches": {"name": "<regex for the state name>", "op": ">=", "value": <n>}}   (a multiplier or level some player reaches)
- "verify": "code" when the target can be read from the game, "playtest" when it shows only when someone plays (lives running out, a run lasting 45 s, a multiplier firing), "judge" when target is null.

Example: "Snake in pixel art, only greens and black, speeds up every 5 apples, 3 lives" →
{"requirements": [
 {"quote": "pixel art", "kind": "style", "target": null, "must": true, "verify": "judge"},
 {"quote": "only greens and black", "kind": "style", "target": {"palette": {"only": ["green", "black"]}}, "must": true, "verify": "code"},
 {"quote": "speeds up every 5 apples", "kind": "rule", "target": null, "must": true, "verify": "judge"},
 {"quote": "3 lives", "kind": "lose", "target": {"measure": "lives", "op": "==", "value": 3}, "must": true, "verify": "playtest"}
]}`;

/** The user turn: the request, plus what the code pass already found (Muse refines it and adds the rest). */
export function requirementsPrompt(request, seeds = seedRequirements(request)) {
  return [
    'The request:', String(request ?? ''),
    '',
    'A code pass already found these (keep them unless they misread the request, fix their kind or target, and add everything they missed):',
    JSON.stringify(seeds.map(({ id: _id, ...r }) => r)),
    '',
    'Reply with {"requirements": [...]}.',
  ].join('\n');
}

function parseJSONObject(text) {
  const s = String(text ?? '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/**
 * The extraction: the code pass, then (with `ask`) one Muse call, merged so nothing explicit is lost.
 * ask(system, user, purpose, options) → text or {content}. Returns {requirements, issues, by, added}.
 */
export async function extractRequirements(request, ask = null, { model = 'muse-spark-1.3', effort = 'low' } = {}) {
  const seeds = seedRequirements(request);
  if (!ask) {
    const { requirements, issues } = normalizeRequirements(seeds, request);
    return { requirements, issues: [...issues, ...coverageIssues(request, requirements)], by: 'code', added: [] };
  }
  try {
    const r = await ask(REQUIREMENTS_SYSTEM, requirementsPrompt(request, seeds), 'requirements', { model, effort, max_tokens: 6000 });
    const parsed = parseJSONObject(typeof r === 'string' ? r : r?.content);
    if (!parsed || !Array.isArray(parsed.requirements)) throw new Error('no requirements list in the reply');
    const merged = mergeRequirements(request, parsed.requirements, seeds);
    return { ...merged, by: 'muse' };
  } catch (e) {
    const { requirements, issues } = normalizeRequirements(seeds, request);
    return { requirements, issues: [...issues, ...coverageIssues(request, requirements)], by: `code (muse failed: ${String(e?.message ?? e).slice(0, 120)})`, added: [] };
  }
}

/** One line describing a target, for prompts and reports. */
export function describeTarget(t) {
  if (!t) return 'a reader checks it';
  if (t.measure) return `${t.measure} ${t.op} ${t.value}`;
  if (t.path) return `${t.path} ${t.op} ${JSON.stringify(t.value)}`;
  if (t.text) return `players see ${t.match === 'any' ? 'one of' : 'all of'}: ${t.text.map((w) => `"${w}"`).join(', ')}`;
  if (t.palette?.only) return `colors only ${t.palette.only.join(', ')} (plus shades of them)`;
  if (t.palette?.include) return `colors include ${t.palette.include.join(', ')}`;
  if (t.input) return `controls: ${t.input}`;
  if (t.input_not) return `controls: no ${t.input_not}`;
  if (t.no) return `no ${t.no}`;
  if (t.timeout_is) return `running out the clock means ${t.timeout_is}`;
  if (t.numbers) return `uses the numbers ${t.numbers.join(', ')}`;
  if (t.state_reaches) return `a player can reach ${t.state_reaches.name} ${t.state_reaches.op} ${t.state_reaches.value}`;
  return JSON.stringify(t);
}

/**
 * The compose prompt section (integrator hook: prompts.mjs planMenu, after "The spec to follow").
 * Quotes win over the spec where they differ.
 */
export function requirementsSection(requirements) {
  const list = Array.isArray(requirements) ? requirements : [];
  if (!list.length) return '';
  const lines = [
    '## Requirements you must meet, quoted',
    'The person asked for these in their own words. Each one is checked in the built game, by code, by playtest bots or by a reader. Where the spec or an example says something else, the quote wins. Build each one exactly (the exact count, the exact seconds, the exact names and words), and make it visible to the player where it can be (the HUD, the instructions, the end screen).',
  ];
  for (const r of list) lines.push(`- ${r.id} (${r.must ? 'must' : 'nice'}, ${r.kind}): "${r.quote}" → ${describeTarget(r.target)}`);
  return lines.join('\n');
}

/**
 * The text of one targeted repair: the failed must-haves, each with its quote and what the check saw.
 * failures: [{id, quote, kind, target, code, evidence}]. Used as the revise request (compose with base).
 */
export function repairRequest(failures) {
  const lines = ['Fix only these. The person asked for them in their own words, and the built game misses them:'];
  for (const f of failures) lines.push(`- ${f.id} "${f.quote}" (${f.code}): ${f.evidence ?? 'not found'}. Make it hold: ${describeTarget(f.target)}.`);
  lines.push('Keep everything else as it is: the theme, art, sound, writing and every rule that already works.');
  return lines.join('\n');
}
