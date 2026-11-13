// Game anatomy (docs/BUBBLES.md 7.13): Muse takes a person's idea apart into its working parts before it builds,
// and maps later changes onto those parts. The app asks the server for it (POST /v1/anatomy and
// /v1/anatomy/revise); the app keeps the screens, decodes the reply and calibrates it on the phone.
// Prompts are ported from the app's former MuseAnatomyPrompts.swift (the app no longer holds any Muse prompts).
// One JSON turn each, on the fast model: about 5 s a call.

export const ANATOMY_VERSION = 'game-anatomy/0.1';

const ENGINE_GAPS = [
  ['share_grid', 'a custom shared result such as a colored-square grid of your guesses (a microgame shares its score text only)'],
  ['segment_collision', 'lines, ropes or beams hitting things (physics and overlaps cover circles and axis-aligned boxes only)'],
  ['joints', 'ropes, chains, hinges or springs linking bodies (no joints; a swing can only be drawn with angle math)'],
  ['rotated_shapes', 'rotated boxes or polygons that collide'],
  ['device_sensors', 'camera, microphone, voice, location or tilt'],
  ['live_multiplayer', 'real-time play between phones (turns on one phone are fine)'],
  ['3d', '3D scenes or perspective'],
];

const BUILTINS = [
  'cells', 'coords', 'neighbors4', 'neighbors8', 'in_grid', 'in_bounds', 'grid_map', 'set_at', 'count', 'filter', 'fold',
  'map_of', 'set_of', 'sum', 'min_of', 'max_of', 'sort_by', 'shuffle', 'pick', 'random_int', 'random_float', 'chance',
  'weighted', 'hash', 'in_dictionary', 'chars', 'split', 'join', 'contains', 'index_of', 'dist', 'overlaps_circle',
  'overlaps_rect', 'clamp', 'lerp', 'range', 'zip',
];

const SCHEMA = `{"anatomy": "game-anatomy/0.1", "title": string, "genre": "word"|"puzzle"|"action"|"story"|"party",
 "parts": {
  "core_loop":  {"text": string, META},
  "verbs":      {"items": [string], META},
  "pieces":     {"items": [{"name": string, "has": [string]}], META},
  "state":      {"items": [{"name": string, "type": string}], META},
  "rules":      [{"n": number, "text": string, "check": string, META}],
  "end":        {"win": string|null, "lose": string|null, "score": string|null, META},
  "structure":  {"turns": string, "timing": string, "length_s": [number, number], META},
  "randomness": {"seed": string, META},
  "share":      {"grid": string, META},
  "theme":      {"text": string, META}
 }}
META is: "source": "you"|"guess", "familiarity": "known"|"approximate"|"unfamiliar", "plan": "fragment:<id>"|"custom:<builtin>, <builtin> - <what they do>"|"gate:<playtest check>"|"engine-gap:<name>", "question": string|null, "options": [string]`;

/** The engine's fragment list for the prompt, "- id: what it does" per line, from the live catalog. */
export function fragmentLines(catalog) {
  return (catalog?.fragments ?? [])
    .map((f) => `- ${f.id}: ${String(f.describe ?? '').split('.')[0].trim()}`)
    .join('\n');
}

export function fragmentIds(catalog) {
  return new Set((catalog?.fragments ?? []).map((f) => f.id));
}

export function system(fragments) {
  return `You are Muse Studio's game designer. Before Muse builds a tiny phone game, you take the person's idea apart into its working parts, so the game follows their mechanics and not just their style. Great games are often new rules rather than new art (a daily five-letter guess, a grid where each row holds one piece): capture the rules exactly as the person means them.

Reply with one JSON object only, in this shape:
${SCHEMA}

How to fill it
- source: "you" when the person's words say it (even loosely), "guess" when you chose it.
- familiarity is mechanical, not a feeling. Decide it from the plan:
  "known": it maps to a fragment listed below (plan "fragment:<id>", tuned by params is fine).
  "approximate": no fragment, but custom rules built from the engine builtins below do it (plan "custom:<builtin>, <builtin> - <what they do>", e.g. "custom:grid, neighbors8, count - two crowns may not touch").
  "unfamiliar": it needs something the engine doesn't have (plan "engine-gap:<name>", see the list below), or you have no clear plan from the builtins. Most parts are known or approximate; a part is new to you when it touches a known gap or you can't name the builtins that build it.
- Known engine gaps. Whenever a part needs one of these, mark it "unfamiliar" with plan "engine-gap:<name>", even if you could fake it, and say in the text what you'd do instead:
${ENGINE_GAPS.map(([n, d]) => `  - ${n}: ${d}`).join('\n')}
- Use "gate:<check>" for a rule that a playtest must confirm (e.g. every daily puzzle is solvable).
- question: only on parts that are a guess AND not known. When there are such parts, ask 1 to 3 questions in total, on the guesses that most change how the game plays (a board size, a number of tries, what happens on a mistake). One short question each, with 2–4 short "options" (your pick first). Every other question is null.
- Vague requests: pick concrete values yourself (grid size, word length, number of tries, speed, run length), mark them "guess", and say what you picked in the text ("6 tries, picked by Muse").
- rules: numbered, one testable sentence each. "check" says how a scripted playtest confirms it ("placing a second crown in a row is refused").
- end: say how a run is won, how it's lost, and how it scores. Use null for one that doesn't apply.
- structure.length_s: the expected run length in seconds, 10 to 120.
- theme: a short phrase (at most 6 words) for the setting and feel, never the whole request. When the person names a theme, franchise or brand (for example "Star Wars"), copy just those words verbatim into theme.text with source "you"; otherwise pick one that fits and mark it "guess". Requested themes are honored in names, art and words so the game keeps their feel; the mechanics stay original to the person's idea, and you never copy a specific existing game's levels, layouts or art.
- Played by touch on a phone: taps, drags and swipes, never a physical keyboard.
- Plain words a player understands, sentence case, at most about 20 words per text. No engine jargon.
- Synthetic people only: use first names only when the request gives them.

Fragment library (what the engine already knows):
${fragments}
Engine builtins for custom rules (beyond fragments): custom state as int, float, string, list, set, map, grid and vec; events, timers (every, after) and typed input (tap, drag, swipe, tap_cell, key presses); and the functions ${BUILTINS.join(', ')}.`;
}

export function userCreate(request, audience) {
  const lines = ['Mode: create', `Request: “${String(request).trim()}”`];
  if (audience && String(audience).trim()) lines.push(`For: ${String(audience).trim()}`);
  lines.push('Take this game apart into its anatomy.');
  return lines.join('\n');
}

/** The question/answer pairs the person has already given, read from the anatomy itself. */
export function answersOf(anatomy) {
  const out = [];
  const take = (node) => {
    if (node && typeof node === 'object' && typeof node.question === 'string' && node.question && typeof node.answer === 'string' && node.answer) {
      out.push([node.question, node.answer]);
    }
  };
  const parts = anatomy?.parts ?? {};
  for (const v of Object.values(parts)) {
    if (Array.isArray(v)) v.forEach(take);
    else take(v);
  }
  return out;
}

/** A change to an agreed anatomy: a correction before the build, or a change after trying the game. */
export function userRevise({ anatomy, request, change, afterPlaying }) {
  const lines = [`The person's original request: “${String(request ?? '').trim()}”`];
  lines.push(afterPlaying
    ? 'They have played the game built from this anatomy:'
    : 'This is the anatomy you proposed, with the person\'s edits (parts marked source "you"):');
  lines.push(JSON.stringify(anatomy));
  const answers = answersOf(anatomy);
  if (answers.length) {
    lines.push('', 'Their answers to your questions:');
    for (const [q, a] of answers) lines.push(`- ${q} → ${a}`);
  }
  const text = String(change ?? '').trim();
  if (text) lines.push('', `They now say: “${text}”`);
  lines.push('', `Reply with the complete updated anatomy in the same JSON shape. Change only what their words and answers touch; keep every other part and rule exactly as it is (same text, same numbering, a new rule goes at the end). Fold each answer into its part (set source "you", clear its question). Mark what you changed as source "you" and judge its familiarity again. Add two top-level fields:
- "changed": the parts you changed, as keys ("core_loop", "verbs", "pieces", "state", "end", "structure", "randomness", "share", "theme") or "rules.<n>" for a rule.
- "reply": one plain sentence to the person naming what this changes, e.g. "This changes rule 2 and how the game ends." If any changed part is new to you, say so in the reply and how you'll build it.`);
  return lines.join('\n');
}

/** A reply is an anatomy when it names the format and has the parts the app reads. Throws otherwise. */
export function validate(value) {
  const ok = value && typeof value === 'object' && value.anatomy === ANATOMY_VERSION && value.parts && typeof value.parts === 'object' && !Array.isArray(value.parts);
  if (!ok) throw new Error(`Muse didn't return a ${ANATOMY_VERSION} anatomy`);
  return value;
}
