// The gold set (authoring/gold/): hand-made example games, each paired with the request a person
// would type to get it. pickGold() chooses the closest few for a new request, so Muse sees worked
// examples of the same kind of game (a story for a story, a quiz for a quiz) in its prompt.
// Pure: no disk or network, so Studio (in the app) and the server can both bundle it.

const STOP = new Set(('a an and are as at be but by for from game games i if in into is it its me my of on or our so ' +
  'that the their them then there they this to up we where which while who will with you your can like make about ' +
  'want some just get one all has have more most very really').split(' '));

/** Signals for each group, so a short request still lands on the right kind of game. */
const GROUP_HINTS = {
  story: 'story adventure choose choices choice path ending endings mystery detective narrative drama plot ' +
    'heist scandal rebellion journey quest interactive fiction branching decide',
  party: 'brainrot brain rot meme memes aura rizz sigma npc delulu goblin chaotic stupid funny silly absurd ' +
    'chaos cringe vibe vibes skit party unhinged',
  arcade: 'dodge run runner race racing jump jumping shoot shooter fly flying avoid catch stack stacking ' +
    'endless arcade speed reflex action platformer collect dash swerve',
  social: 'quiz trivia which personality sort sorting house puzzle riddle cipher word guess daily friends ' +
    'group chat pass phone turns together challenge sleepover party team',
};

function words(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => (w.length > 5 ? w.replace(/(ing|ers|er|es|s)$/, '') : w));
}

function entryText(e) {
  const b = e.brief || {};
  return [e.request, e.genre, b.intent, (b.mood || []).join(' '), b.energy, b.competition, e.title].join(' ');
}

/**
 * Scores gold entries against a request: shared content words (weighted by rarity across the set)
 * plus a bonus for the group the request sounds like. Returns the top `k`, best first, at most one
 * per group unless `k` exceeds the number of groups, so the examples stay varied.
 */
export function pickGold(request, gold, k = 2) {
  if (!Array.isArray(gold) || !gold.length) return [];
  const req = new Set(words(request));
  const docs = gold.map((e) => new Set(words(entryText(e))));
  const df = new Map();
  for (const d of docs) for (const w of d) df.set(w, (df.get(w) || 0) + 1);
  const groupScore = {};
  for (const [g, hint] of Object.entries(GROUP_HINTS)) {
    const h = new Set(words(hint));
    groupScore[g] = [...req].filter((w) => h.has(w)).length;
  }
  const scored = gold.map((e, i) => {
    let s = 0;
    for (const w of req) if (docs[i].has(w)) s += Math.log(1 + gold.length / df.get(w));
    s += 1.5 * (groupScore[e.group] || 0);
    return { e, s };
  }).sort((a, b) => b.s - a.s || a.e.id.localeCompare(b.e.id));
  const out = [];
  const used = new Set();
  for (const { e } of scored) {
    if (out.length >= k) break;
    if (used.has(e.group) && k <= Object.keys(GROUP_HINTS).length) continue;
    out.push(e);
    used.add(e.group);
  }
  return out;
}

/** Replaces inline SVG and data: URIs longer than `max` with a short placeholder (keeps one of each). */
export function compactArt(manifest, max = 400) {
  let keptSvg = false;
  const walk = (v) => {
    if (typeof v === 'string') {
      const svg = v.startsWith('<svg');
      if ((svg || v.startsWith('data:')) && v.length > max) {
        if (svg && !keptSvg) { keptSvg = true; return v; }
        return `${v.slice(0, 60)}… (${v.length} characters elided)`;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(manifest);
}

/**
 * Prompt text for the chosen examples: each one's request, why it works, the mistakes it avoids,
 * and its complete manifest. The first keeps its full art; later ones have their art compacted
 * when the total would pass `budget` characters.
 */
export function goldPromptText(entries, budget = 90000) {
  let used = 0;
  return entries.map((e, i) => {
    let manifest = JSON.stringify(e.manifest);
    if (i > 0 && used + manifest.length > budget) manifest = JSON.stringify(compactArt(e.manifest));
    used += manifest.length;
    return [
      `### Example ${i + 1}: ${e.title || e.id} (${e.genre})`,
      `Request: "${e.request}"`,
      `Why it works: ${(e.why_its_good || []).join(' ')}`,
      `Mistakes it avoids: ${(e.pitfalls_avoided || []).join(' ')}`,
      'Manifest:',
      manifest,
    ].join('\n');
  }).join('\n\n');
}
