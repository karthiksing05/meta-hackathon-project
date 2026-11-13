// The quality check: what separates a game that feels made from one that feels like slop, read from
// the authoring manifest alone (no model, no engine). It runs after a game validates and passes the
// bots, and its issues go back to Muse for one polish round (docs/BUBBLES.md 7.12).
//
// Calibrated on authoring/games/: the 16 gold games pass with no major issues; the plain games
// (no art, no sound, no writing) don't. Pure, so the Studio bundle and the server can both use it.
//
//   qualityReport(manifest, { request, library }) → { score, major, issues: [{code, severity, at, message}] }
//
// score is 0–100 (each major issue costs 15, each minor 5). major counts the major issues.

const GENERIC_TITLE = /^(the\s+)?(super\s+|mega\s+|ultra\s+|crazy\s+)?(space|star|sky|color|colour|fruit|ball|speed|tap|quick|fun|word|block|shape|candy|bubble|jump|neon|pixel|galaxy|cosmic|magic|ocean|jungle)\s+(dash|rush|frenzy|blitz|mania|madness|challenge|game|quest|adventure|master|hero|run|runner|tap|tapper|catch|catcher|dodge|dodger|clicker|drop|pop|smash|match)$/i;
const GENERIC_ONLY = new Set(['dodge', 'catch', 'tap', 'quiz', 'game', 'puzzle', 'runner', 'match', 'memory', 'sort', 'story']);
const PLACEHOLDER = /\b(item|option|choice|question|answer|level|word|scene|thing|enemy|player|object)\s*#?\d+\b|lorem|ipsum|placeholder|\btodo\b|\btbd\b|\bfoo\b|\bxxx\b|example text|sample text/i;

// Words in a request that say what kind of game, not what it's about.
const NOT_THEME = new Set((
  'a an and are as at be but by for from game games i if in into is it its me my of on or our so that the their ' +
  'them then there they this to up we where which while who will with you your can like make about want some just ' +
  'get one all has have more most very really where when what how let lets play player players playing fun ' +
  'cute cozy calm chill fast quick simple easy hard tiny little mini short long new kind sort style themed theme vibe ' +
  'microgame tap taps tapping swipe swiping drag dragging dodge dodging catch catching collect collecting avoid ' +
  'score scores point points win lose lives level levels round rounds time timer seconds minute minutes ' +
  'friend friends group chat everyone together party people someone something thing things way ways try ' +
  'should would could maybe also each every other another them him her his hers using use set made gets get got ' +
  'find found real before after over under out off down back first last next big small good bad best worst ' +
  'quiz trivia post posts result results build building pass phone sleepover daily puzzle story stories ' +
  'beat high highest low lowest keep keeps start end ending endings hit hits miss misses go goes going ' +
  'different than figure same similar instead rather else whatever anything sort kinda pls please feature ' +
  'featuring featured centered based around version'
).split(/\s+/));

// Fragments that make a run harder over time.
const RAMP_FRAGMENTS = new Set(['speed_ramp', 'difficulty_curve', 'waves', 'rounds']);
// Fragments whose games are about moving things, where a flat difficulty shows.
const ACTION_FRAGMENTS = new Set(['spawn_wave', 'lanes', 'player_drag', 'gravity_jump', 'collide', 'pickups', 'endless']);
// How much content a content-driven fragment needs before it stops feeling thin.
const CONTENT_MIN = { quiz: 8, sort_bins: 12, word_check: 10, keyboard: 8, choice_story: 8 };

function words(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, '').replace(/'s$/, ''))
    .filter((w) => w.length >= 3);
}

const stem = (w) => (w.length > 4 ? w.replace(/(ing|ers|er|es|s|ed)$/, '') : w);

/** Every string in a value, depth-first. */
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** Strings a player reads: meta, content, text in the game's own nodes and feedback, art.style. */
function playerText(m) {
  const texts = [m.meta?.title, m.meta?.instructions, m.art?.style];
  texts.push(...strings(m.content || {}).filter((s) => !s.startsWith('<svg') && !s.startsWith('data:')));
  for (const node of strings(m.presentation || {})) {
    // Expression strings hold quoted text: 'Nice!'
    for (const q of node.matchAll(/'([^']{2,})'/g)) texts.push(q[1]);
  }
  for (const u of m.uses || []) texts.push(...strings(u.params || {}).filter((s) => /[a-z]{3,}\s+[a-z]{2,}/i.test(s)));
  return texts.filter(Boolean).join(' \n ');
}

/** The request's theme words: nouns and names that say what the game is about. */
export function themeWords(request) {
  const seen = new Set();
  const out = [];
  for (const w of words(request)) {
    if (NOT_THEME.has(w) || /^\d+$/.test(w)) continue;
    const s = stem(w);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(w);
  }
  return out;
}

function svgList(sprite) {
  if (!sprite || typeof sprite !== 'object') return [];
  if (Array.isArray(sprite.svg)) return sprite.svg.filter((s) => typeof s === 'string');
  return typeof sprite.svg === 'string' ? [sprite.svg] : [];
}

/** Whether the game's own presentation draws sprites (image nodes), not just shapes. */
function ownNodeKinds(m) {
  const kinds = { image: 0, shape: 0, text: 0 };
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    if (typeof v.node === 'string') {
      if (v.node === 'image' || v.node === 'sprite') kinds.image++;
      else if (v.node === 'text') kinds.text++;
      else kinds.shape++;
    }
    Object.values(v).forEach(walk);
  };
  walk(m.presentation || {});
  return kinds;
}

export function qualityReport(manifest, { request = '', library = null } = {}) {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const issues = [];
  const add = (severity, code, at, message) => issues.push({ code, severity, at, message });
  const art = m.art && typeof m.art === 'object' ? m.art : {};
  const sprites = art.sprites && typeof art.sprites === 'object' ? art.sprites : {};
  const uses = Array.isArray(m.uses) ? m.uses : [];
  const used = new Set(uses.map((u) => u && u.fragment));

  // ---- art
  if (!art.palette) add('major', 'Q_NO_PALETTE', '/art', 'There is no art.palette, so the game uses the default colors. Pick 7 colors that fit the theme (ink must read on bg and surface).');
  if (!art.backdrop) add('major', 'Q_NO_BACKDROP', '/art', 'There is no art.backdrop. Draw the setting as one 360 × 640 SVG, quiet in the middle and detailed at the edges.');
  if (!art.font) add('minor', 'Q_NO_FONT', '/art', 'Pick an art.font that fits the mood (Baskerville for mysteries, Marker Felt for silly games, Futura for sci-fi, and so on).');
  if (library) {
    const missing = [];
    uses.forEach((u, i) => {
      const frag = u && library.fragments?.[u.fragment];
      for (const role of Object.keys(frag?.art || {})) {
        const mapped = u.art?.[role];
        if (mapped === false) continue;
        if (typeof mapped === 'string' ? sprites[mapped] : sprites[role]) continue;
        // A story can draw its own scene pictures instead.
        if (role === 'scene' && ownNodeKinds(m).image > 0) continue;
        missing.push(`${u.fragment}'s ${role} (/uses/${i})`);
      }
    });
    if (missing.length) add('major', 'Q_ROLE_UNDRAWN', '/art/sprites', `These are drawn as plain fallback shapes: ${missing.join(', ')}. Add a sprite for each (named after the role, or mapped with "art" on the use).`);
  }
  const thin = Object.entries(sprites).filter(([, s]) => svgList(s).some((svg) => svg.length < 120)).map(([k]) => k);
  if (thin.length) add('minor', 'Q_THIN_SPRITE', '/art/sprites', `These sprites are one or two bare shapes: ${thin.join(', ')}. Give them a silhouette, a highlight and a darker edge, like the examples.`);
  const kinds = ownNodeKinds(m);
  const ownTypes = m.types && typeof m.types === 'object' ? Object.keys(m.types).length : 0;
  if (ownTypes > 0 && kinds.image === 0 && kinds.shape > 0) add('major', 'Q_OWN_SHAPES', '/presentation', 'Your own pieces are drawn as plain rectangles and circles. Draw them with sprites: {"node": "image", "asset": "<sprite>", ...}, and add the sprites to art.sprites.');

  // ---- sound
  if (!m.sound || typeof m.sound !== 'object' || !m.sound.set) add('major', 'Q_NO_SOUND', '/sound', 'There is no sound section. Pick a set that fits the mood (soft or cozy for calm, arcade or retro for fast, chime for puzzles) and override one or two moments.');

  // ---- words
  const title = String(m.meta?.title || '').trim();
  const titleWords = words(title);
  if (!title) add('major', 'Q_NO_TITLE', '/meta/title', 'The game has no title.');
  else if (GENERIC_TITLE.test(title) || titleWords.every((w) => GENERIC_ONLY.has(w))) {
    add('minor', 'Q_GENERIC_TITLE', '/meta/title', `"${title}" sounds like any game. Name it after something specific in this one (a character, a place, the stakes).`);
  }
  const instructions = String(m.meta?.instructions || '');
  if (instructions.length < 25) add('minor', 'Q_INSTRUCTIONS', '/meta/instructions', 'meta.instructions should say in one or two sentences what you do and how you win or lose.');
  const text = playerText(m);
  const ph = text.match(PLACEHOLDER);
  if (ph) add('major', 'Q_PLACEHOLDER', '/content', `Placeholder text ("${ph[0]}"). Write the real words.`);
  const own = text.replace(title, '').replace(instructions, '');
  const ownWords = words(own).length;
  if (ownWords < 25) add('minor', 'Q_NO_VOICE', '/content', 'The game has almost no writing of its own. Add a few lines with personality in content: what happens on a hit or a miss, ranks or end lines that depend on the score, names for waves or levels.');

  // ---- theme
  const theme = themeWords(request);
  if (theme.length >= 2) {
    const have = new Set(words(text + ' ' + strings(m.content || {}).join(' ')).map(stem));
    const hit = theme.filter((w) => have.has(stem(w)));
    if (hit.length / theme.length < 0.3) {
      const missingTheme = theme.filter((w) => !have.has(stem(w)));
      add('major', 'Q_THEME_MISSING', '/meta', `The request is about ${theme.join(', ')}, but the game never says ${missingTheme.slice(0, 6).join(', ')}. Keep the request's world in the title, names, words and art.`);
    }
  }

  // ---- shape of a run
  const action = [...used].some((f) => ACTION_FRAGMENTS.has(f));
  const ramps = [...used].some((f) => RAMP_FRAGMENTS.has(f)) || /elapsed|\bt_ms\b|\btime\b|\bwave\b|\blevel\b|speed|faster|ramp/.test(JSON.stringify(m.rules || []) + JSON.stringify(m.functions || {}) + JSON.stringify(m.state || {}));
  if (action && !ramps) add('major', 'Q_FLAT', '/uses', 'Nothing gets harder during a run. Add speed_ramp or difficulty_curve, or waves, so a good player gets further than a new one.');
  for (const [frag, min] of Object.entries(CONTENT_MIN)) {
    if (!used.has(frag)) continue;
    const lists = Object.values(m.content || {}).filter(Array.isArray);
    const longest = lists.reduce((n, l) => Math.max(n, l.length), 0);
    if (longest < min) add('minor', 'Q_THIN_CONTENT', '/content', `${frag} has only ${longest} entries. Write at least ${min}, so a second run isn't a repeat.`);
  }
  const events = m.events && typeof m.events === 'object' ? Object.keys(m.events) : [];
  const feedback = Array.isArray(m.presentation?.feedback) ? m.presentation.feedback : [];
  if (events.length && !feedback.length) add('minor', 'Q_NO_JUICE', '/presentation/feedback', `Your own events (${events.slice(0, 4).join(', ')}) have no feedback. Add a sound, particles or a shake on the important ones.`);

  const major = issues.filter((i) => i.severity === 'major').length;
  const minor = issues.length - major;
  return { score: Math.max(0, 100 - 15 * major - 5 * minor), major, issues };
}

/** Lines for Muse, most important first. */
export function qualityLines(report) {
  return [...report.issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'major' ? -1 : 1))
    .map((i) => `${i.code} (${i.severity}) at ${i.at}: ${i.message}`);
}
