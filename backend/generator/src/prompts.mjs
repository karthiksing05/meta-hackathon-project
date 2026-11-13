// Prompts for Muse's microgame path: a port of MicrogamePrompts.swift (docs/BUBBLES.md 7.12).
// Everything about the library, the engine and the format comes from the catalog the Studio bundle
// generates, so the prompt can't drift from what the expander accepts.

export function system(catalog) {
  const format = catalog.game_format ?? 'microgame/0.1';
  const p = catalog.prompt ?? {};
  return `You design microgames for Bubbles: tiny, original games people make and play inside Facebook on a phone.
A microgame is written as an authoring manifest (JSON). An expander combines it with a library of tested fragments into a ${format} game for a deterministic engine, the engine validates it, and five bots playtest it before it ships.

Reply with exactly one JSON object: the complete authoring manifest, with "authoring": "microgame-authoring/0.1". No markdown, no comments, no text around it.

How to write a good one
- Build from fragments first (uses + params + bind). Add your own types, state, events, inputs and rules only for what's new in this game; the game's rules run after the fragments' rules.
- It's played by touch on a phone: taps, drags and swipes. Never rely on a physical keyboard.
- A run lasts 10–120 seconds, can be lost, and can be won or scored. Make it ramp up so good play shows: a typical player shouldn't still be going after 2 minutes, and nobody should lose in the first 10 seconds.
- The canvas is 360 × 640 (portrait); the HUD sits at the top (hud_top holds 3 nodes, hud_bottom 2).
- meta.title is short (at most 40 characters) and original; meta.instructions is one or two plain sentences that say how to play and how to win or lose. meta.duration_s is the expected run length.
- Put the game's words and lists in content (read them as content_<key>), not inside expressions.
- Use the standard color tokens ($primary $secondary $accent $ink $bg $danger $surface); define extra tokens in look.tokens if you need them. Pick a look.id from the list below.
- When score alone doesn't show progress (lights switched off, distance to a goal, lives kept), add "playtest": {"progress": "<expr>"} so the bots know what doing better means.
- Expressions use single-quoted strings, and floats are written with a decimal point (1.0, not 1) where a float is expected.
- Everything is synthetic and original: no real people, brands, businesses or copies of existing games.

## The authoring format

${p.format ?? ''}

## Fragments (the library)

${p.fragments ?? ''}

## Looks

${p.looks ?? ''}

## Engine reference (for your own sections)

${p.engine ?? ''}

## Complete examples that validate and pass the bots

${p.examples ?? ''}`;
}

export function briefText(brief) {
  const parts = [`Brief: ${brief.intent}`];
  parts.push(`Audience: ${brief.audience}. Mood: ${(brief.mood ?? []).join(', ')}. Energy: ${brief.energy}. Competition: ${brief.competition}.`);
  if (brief.occasion) parts.push(`Occasion: ${brief.occasion}.`);
  if (brief.notes) parts.push(`Notes: ${brief.notes}`);
  return parts.join('\n');
}

export function compose(request, brief) {
  return ['Make a microgame for this request:', request.trim(), '', briefText(brief), '', 'Reply with the complete authoring manifest.'].join('\n');
}

/** `authoring` is the manifest's JSON text exactly as stored: key order matters. */
export function revise(authoring, request, brief) {
  const lines = ["Here is a microgame's authoring manifest:", authoring, '', 'Change it as asked:', request.trim()];
  if (brief) lines.push('', briefText(brief));
  lines.push('', "Keep everything the request doesn't touch. Reply with the complete authoring manifest.");
  return lines.join('\n');
}

export function repair(request, manifest, issues, round) {
  return `Request: ${request}

Your authoring manifest:
${manifest}

It doesn't validate yet (repair round ${round}). The pointers (\`at\`) are JSON Pointers into your manifest:
${issues.map((i) => `- ${i}`).join('\n')}

Fix every problem and reply with the complete corrected authoring manifest.`;
}

export function playtestRepair(request, manifest, report) {
  const runs = report.runs.map((run) => {
    const bot = run.bot ?? {};
    return `- ${bot.label ?? 'bot'} (skill ${Number(bot.skill ?? 0).toFixed(2)}): ${run.outcome}, score ${run.score}, ${Math.round(run.seconds ?? 0)} s${run.error ? ` · ${run.error}` : ''}`;
  });
  const blocking = (report.flags ?? []).filter((f) => f.blocking);
  return `Request: ${request}

Your authoring manifest:
${manifest}

It validates, but the playtest bots found problems that block it from shipping:
${blocking.map((f) => `- ${f.code}: ${f.message}`).join('\n')}

The bot runs:
${runs.join('\n')}

Change the params, fragments or rules so a run lasts 10–120 s, can be lost, and can be won or scored. Reply with the complete corrected authoring manifest.`;
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
