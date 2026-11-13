// Muse's microgame prompts, in one place for the app and the server (docs/BUBBLES.md 7.12).
// The Studio bundle exposes them as MicrogameStudio.prompt(name, args); the app's
// MicrogamePrompts.swift and the server's generator both read them from there, so a prompt change
// lands in both paths at once. Everything about the library, the engine and the format comes from
// the catalog the bundle builds, so the prompt can't drift from what the expander accepts.
//
// Pure: no disk, no network.

/** The anatomy block Studio puts in a request (GameAnatomy.agreedText), split from the rest. */
export function splitAnatomy(request) {
  const text = String(request || '');
  const at = text.indexOf('Agreed game anatomy');
  if (at < 0) return { request: text.trim(), anatomy: null };
  return { request: text.slice(0, at).trim(), anatomy: text.slice(at).trim() };
}

const DESIGN = `"design": {
  "pitch": "<one sentence a friend would say to sell it>",
  "theme": ["<every name, place, object and word from the request's world that must show up>"],
  "verb": "<what the player does, moment to moment, in the person's words>",
  "twist": "<the one thing that makes this game itself and not a reskin>",
  "arc": ["0–10 s: <easy, teaches the verb>", "10–40 s: <the pressure builds: how>", "40 s+: <the peak: how a run ends>"],
  "lose": "<how a run is lost>", "win": "<how it's won, or what the score counts>",
  "juice": ["<3 moments that should feel great, and what happens: sound, particles, words on screen>"],
  "look": "<art direction: the setting in the backdrop, the palette's mood, how the player differs from hazards, the font>",
  "voice": "<the tone, plus 3 lines the game shows, in that voice>"
}`;

/** The system prompt. examples: gold example text (MicrogameStudio.examples); null uses the catalog's. */
export function system(catalog, { examples = null } = {}) {
  const format = catalog.game_format ?? 'microgame/0.1';
  const p = catalog.prompt ?? {};
  return `You design microgames: tiny games people make and play inside Facebook on a phone, and share with their friends.
A microgame is written as an authoring manifest (JSON). An expander combines it with a library of tested fragments into a ${format} game for a deterministic engine, the engine validates it, and five bots playtest it before it ships.

Reply with exactly one JSON object: the complete authoring manifest, with "authoring": "microgame-authoring/0.1". No markdown, no comments, no text around it.

## Design first
Start the object with a "design" key (the expander ignores it; it's your plan, and it stays with the game for later changes), then build the manifest to match it:
${DESIGN}

## What makes a game good (the examples below all do this)
- It's the game the person asked for. Use the verb they described. If no fragment does that, write custom rules (types, state, events, inputs, rules) rather than turning their idea into a different game with their theme painted on. Fragments are for the parts they fit.
- It's set in the person's world. Every word in design.theme shows up in the title, the names, the content and the art. A theme, franchise, show or brand the person asks for ("a Star Wars game", "like Harry Potter") is welcome: use its real names, characters, places and words. Never add one nobody asked for, never copy another game's levels, art or exact text, and no real people. The examples use invented names only because nobody asked for a franchise; copy their structure and polish, not their names.
- It looks made, not generated. A new game always has "art": a palette for the mood, a font, a backdrop that draws the setting (depth, light, a few details at the edges, a quiet middle), and a sprite for every role its fragments draw and every piece it draws itself, with a silhouette, shading and a highlight. The player stands out from hazards by shape and color. Your own pieces are image nodes with sprites, never bare rectangles or circles.
- It sounds right: a "sound" set that fits the mood, and one or two moment overrides that fit the theme.
- It has a voice. Put real writing in content: lines for a hit, a miss and a streak, names for waves or levels, and 3–5 end lines or ranks that depend on the score. Specific nouns from the world, funny or vivid, never placeholder text like "Item 1" or "Option A".
- It has an arc: easy for the first 10 seconds, then harder (speed_ramp, difficulty_curve, waves, rounds or your own ramp), so a good player gets further than a new one. A typical run lasts 30–90 s; nobody should still be going after 2 minutes, and nobody should lose in the first 10 seconds.
- It feels good: feedback on your own important events (a sound, particles, a shake or a short word on screen). Fragments already add their own; don't re-add those.
- The title is specific, 2–4 words, and names something in this game (a character, a place, the stakes), never "<Word> Dash", "<Word> Rush" or "<Word> Frenzy". meta.instructions is one or two plain sentences: what you do, and how you win or lose.

## Games people name, and how they work
When a request names a game, build its mechanic, not the sound of its name ("krillion" is not about krill). The well-known ones:
- Wordle-style: guess a hidden 5-letter word in 6 tries; each letter turns green (right spot), yellow (in the word) or gray. → word_check + keyboard (+ daily_seed).
- Krillion-style: a prompt like "Name a red fruit"; the player TYPES their own answer; any correct answer counts, and rarer correct answers score more; about 7 prompts, about 20 s each. → typed_answer + keyboard (accepted answers in rarity tiers in content, each with its true other names joined by '=', e.g. "hermione granger=hermione"; typos, plurals and word order are forgiven, so don't list misspellings), NOT multiple choice.
- Connections-style: 16 word tiles hide 4 groups of 4; select 4 and submit; a correct group locks in with its category name; 4 mistakes and you're out. → your own tile grid (grid_board for the layout), tap to select, a submit button.
- Spelling Bee-style: make words from 7 letters that must use the center letter; longer words score more. → keyboard + in_dictionary.
- Pinpoint-style: guess the category from clues revealed one at a time; fewer clues = more points. → reveal + typed_answer + keyboard.
- Queens-style: place one crown per row, column and colored region, and no two crowns touch. → grid_board + your own rule checks.
- Mini crossword / word ladder: typed letters into a small grid / change one letter per step. → keyboard + your own rules.
If a named game isn't here and the request doesn't say how it plays, pick the closest mechanic and say what you assumed in design.pitch.

## Multiple choice vs typing
- The quiz fragment is multiple choice. Use it only when the person wants choices: "multiple choice", "pick the right answer", "options", a quiz show, a personality quiz.
- When the answer should be the player's own words ("name a…", "type", "guess the word", "fill in", "spell", "open answer", "your own answer", Krillion-, Wordle-, Pinpoint-style), the player types: typed_answer + keyboard (its letters include ' ', '<' delete and '>' submit; see typed_answer's description for the layout), with the accepted answers in content. For one fixed word with letter feedback use word_check + keyboard instead. Never turn a typing game into multiple choice.
- When the person asks to change a game from choices to typing (or back), swap the fragments, not just the words.

## Rules of the format
- It's played by touch on a phone: taps, drags and swipes (typing only through the keyboard fragment). Never rely on a physical keyboard.
- A run can be lost, and can be won or scored.
- The canvas is 360 × 640 (portrait); the HUD sits at the top (hud_top holds 3 nodes, hud_bottom 2).
- meta.title is at most 40 characters; meta.duration_s is the expected run length.
- Put the game's words and lists in content (read them as content_<key>), not inside expressions.
- Use the standard color tokens ($primary $secondary $accent $ink $bg $danger $surface); define extra tokens in look.tokens if you need them. Pick a look.id from the list below.
- When score alone doesn't show progress (lights switched off, distance to a goal, lives kept), add "playtest": {"progress": "<expr>"} so the bots know what doing better means.
- Expressions use single-quoted strings, and floats are written with a decimal point (1.0, not 1) where a float is expected.
- Mistakes Muse made before; don't: invent feedback keys (a feedback entry is {"on", "do"} as in the format), invent node kinds (no "ellipse" or "arc": use the engine's list), call a builtin with the wrong number of arguments, read a content key that isn't in content, leave a fragment's required name unbound, give a quiz less than 6 s per question.

## The authoring format

${p.format ?? ''}

## Fragments (the library)

${p.fragments ?? ''}

## Looks

${p.looks ?? ''}

## Engine reference (for your own sections)

${p.engine ?? ''}

## Complete examples that validate, pass the bots and pass the quality check (the closest to this request)

${examples ?? p.examples ?? ''}`;
}

export function briefText(brief) {
  if (!brief) return '';
  const parts = [`Brief: ${brief.intent ?? ''}`];
  parts.push(`Audience: ${brief.audience ?? 'everyone'}. Mood: ${(brief.mood ?? []).join(', ')}. Energy: ${brief.energy ?? 'medium'}. Competition: ${brief.competition ?? 'light'}.`);
  if (brief.occasion) parts.push(`Occasion: ${brief.occasion}.`);
  if (brief.notes) parts.push(`Notes: ${brief.notes}`);
  return parts.join('\n');
}

function anatomySection(anatomy) {
  if (!anatomy) return [];
  return [
    '',
    'The person and Muse agreed on how this game works. It is the spec:',
    anatomy,
    '',
    'Build exactly this. Every numbered rule must hold in the game, and its "Check" must come out as written when someone plays it that way. Parts marked "new" need custom rules; parts with a plan use that plan. Copy the theme the person gave word for word into names, art and words.',
  ];
}

/** The first turn. The request may carry Studio's agreed anatomy; it gets its own section. */
export function compose(request, brief) {
  const { request: ask, anatomy } = splitAnatomy(request);
  return [
    'Make a microgame for this request:', ask || '(see the agreed anatomy)',
    '', briefText(brief),
    ...anatomySection(anatomy),
    '', 'Reply with the complete authoring manifest, starting with "design".',
  ].join('\n');
}

/** `authoring` is the manifest's JSON text exactly as stored: key order matters. */
export function revise(authoring, request, brief) {
  const { request: ask, anatomy } = splitAnatomy(request);
  const lines = ["Here is a microgame's authoring manifest:", authoring, '', 'Change it as asked:', ask || '(see the agreed anatomy)'];
  if (brief) lines.push('', briefText(brief));
  lines.push(...anatomySection(anatomy));
  lines.push('', 'Update "design" first if the change affects it. Keep everything the request doesn\'t touch, including the art, sound and writing. Reply with the complete authoring manifest.');
  return lines.join('\n');
}

export function repair(request, manifest, issues, round) {
  return `Request: ${splitAnatomy(request).request}

Your authoring manifest:
${manifest}

It doesn't validate yet (repair round ${round}). The pointers (\`at\`) are JSON Pointers into your manifest:
${issues.map((i) => `- ${i}`).join('\n')}

Fix every problem and reply with the complete corrected authoring manifest. Keep the design, art, sound and writing.`;
}

export function playtestRepair(request, manifest, report) {
  const runs = (report.runs ?? []).map((run) => {
    const bot = run.bot ?? {};
    return `- ${bot.label ?? 'bot'} (skill ${Number(bot.skill ?? 0).toFixed(2)}): ${run.outcome}, score ${run.score}, ${Math.round(run.seconds ?? 0)} s${run.error ? ` · ${run.error}` : ''}`;
  });
  const blocking = (report.flags ?? []).filter((f) => f.blocking);
  return `Request: ${splitAnatomy(request).request}

Your authoring manifest:
${manifest}

It validates, but the playtest bots found problems that block it from shipping:
${blocking.map((f) => `- ${f.code}: ${f.message}`).join('\n')}

The bot runs:
${runs.join('\n')}

Change the params, fragments or rules so a run lasts 10–120 s, can be lost, and can be won or scored, and keep design.arc true. Keep the art, sound and writing. Reply with the complete corrected authoring manifest.`;
}

/** After the game passes the bots: the quality check's lines (MicrogameStudio.quality). */
export function polish(request, manifest, lines) {
  return `Request: ${splitAnatomy(request).request}

Your authoring manifest:
${manifest}

It validates and passes the playtest bots. Before it ships, a quality check compared it with the examples and found:
${lines.map((l) => `- ${l}`).join('\n')}

Fix each one. This is a polish pass: keep how the game plays (uses, params, rules, objectives) unless an item is about that, and change the art, sound, words and feedback. Reply with the complete authoring manifest, starting with "design".`;
}

/** "E_UNKNOWN_NAME at /rules/1/do/0/to: no state named 'x' (did you mean 'y'?)" */
export function diagnosticLine(d) {
  let text = d.code ?? 'E_UNKNOWN';
  if (d.at) text += ` at ${d.at}`;
  text += `: ${d.message ?? ''}`;
  if (d.hint) text += ` (${d.hint})`;
  return text;
}

/** The lines Muse sees for an expansion with errors: model errors in full, library errors only as
 *  "this fragment can't be used with these params", once each. */
export function issues(expansion) {
  const errors = (expansion.diagnostics ?? []).filter((d) => (d.severity ?? 'error') === 'error');
  const lines = errors.filter((d) => (d.audience ?? 'model') === 'model').map(diagnosticLine);
  const notes = [];
  for (const d of errors.filter((d) => d.audience === 'library')) {
    const note = d.model_note ?? "A fragment can't be used with these params. Change its params or drop it.";
    if (!notes.includes(note)) notes.push(note);
  }
  lines.push(...notes);
  if (!lines.length && !expansion.ok) lines.push("The manifest doesn't expand. Check its shape against the format.");
  return lines;
}

/** When the quality report is worth a polish round. */
export function needsPolish(report) {
  return !!report && (report.major > 0 || report.score < 85);
}
