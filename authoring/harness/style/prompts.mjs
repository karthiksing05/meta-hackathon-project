// Prompts for the three Muse steps. The style can be anything the player typed; the vocabulary
// and the compiler make it consistent, so Muse only decides look and silhouettes.

import { describeVocabulary, LIGHT_NAMES } from './vocabulary.mjs';


export function directorMessages(game, stylePrompt) {
  const system = [
    'You are the art director for a tiny phone game. Turn the player\'s style words into a style spec that a compiler applies to every asset. Return one JSON object only.',
    'Shape: {"name", "summary", "palette": {role: "#RRGGBB"}, "light", "sprite": {treatment: {...}}, "backdrop": {treatment: {...}}, "drawing": {"shape_language", "detail": "low|medium|high", "rules": [3–6 short drawing rules]}}',
    `Palette: 5–8 roles with short lowercase names. Always include ink (the darkest; used for lines, text and the button), surface (the lightest; text on ink), and accent (the hero color). Also use: ${game.paletteRoles.filter((r) => !['ink', 'surface', 'accent'].includes(r)).join(', ')}. ink on surface must be very high contrast. The illustrator can also use role-dark and role-light shades of every role.`,
    `light is one of ${LIGHT_NAMES.join(', ')}.`,
    'Treatments (pick one style per treatment, with params; omit a treatment to leave it off):',
    describeVocabulary(),
    'Sprites carry the style most strongly. Keep the backdrop quieter than the sprites: weaker texture and shading, no outline, and lower contrast, so the game\'s HUD, labels and button stay readable. Sizes are screen pixels at play size.',
    'Interpret the player\'s words faithfully, whatever style they name; mix treatments freely and leave off any that would fight the style. Where the vocabulary cannot express part of the style, carry it through the palette, the shape language and the drawing rules.',
    'drawing.rules tell the illustrator how to shape things in this style (e.g. "chamfer every corner", "chunky shapes, no part thinner than 4 px at play size"). Do not ask for outlines, shadows, gradients or texture there; the treatments add those.',
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: `Game: ${game.brief}\nPlayer's style: ${stylePrompt}` }];
}

function tokenList(spec) {
  return Object.keys(spec.palette).flatMap((r) => [r, r + '-dark', r + '-light']).join(', ');
}

function contract(game, spec) {
  return [
    `Return one JSON object mapping ${game.roles.map((r) => r.id).join(', ')} to standalone SVG strings (each starts with <svg and has xmlns and the exact viewBox).`,
    ...game.roles.map((r) => `${r.id}: viewBox "0 0 ${r.width} ${r.height}", ${r.kind === 'backdrop' ? 'opaque, full bleed' : `transparent, shown ${r.play} px wide, keep ${r.gutter ?? 4} units clear on every side${r.baseline ? `, resting on y=${r.baseline}` : ''}`}. ${r.purpose ?? ''}`),
    'Draw FLAT SHAPES ONLY: path, rect, circle, ellipse, polygon, grouped with <g>. The style compiler adds outlines, shading, highlights, texture and shadows, so do not draw any of those, and use no gradients, filters, opacity tricks, text, images or style tags.',
    `Colors: every fill is a palette role name, never a hex value. Allowed fills: ${tokenList(spec)}. Use the -dark and -light shades for planes and depth.`,
    'The game draws the HUD, score, labels, the cable, the rail, the timing beam and the tap button on top of your art. Never draw any of them, or anything that looks like a panel, box, button or text bar.',
    'The backdrop is a stack of top-level <g> layers from back to front (sky, far, mid, near, ground); each layer is one depth plane. Sprites are a few bold parts with clear silhouettes that read at play size.',
    `Composition: ${game.composition}`,
    `Style: ${spec.name}. ${spec.summary}`,
    `Shape language: ${spec.drawing?.shape_language ?? 'bold and simple'}. Detail: ${spec.drawing?.detail ?? 'low'}.`,
    ...(spec.drawing?.rules ?? []).map((r) => '- ' + r),
    'Keep each sprite under 4 KB and the backdrop under 10 KB.',
  ].join('\n');
}

export function illustratorMessages(game, spec) {
  return [{ role: 'system', content: contract(game, spec) }, { role: 'user', content: game.brief }];
}

export function criticMessages(game, spec, pack, findings, pngBase64) {
  const text = [
    'This is your art pack compiled in the style and rendered into a real gameplay frame at actual phone size (left), with each sprite at play size and 2× (below). Labels, track, beam, HUD and the button are drawn by the game.',
    'Check: does every sprite read instantly at play size; do the car and marker stand out from the backdrop; are the HUD band, the timing band behind the track and the button area calm; does it look like one coherent set in the requested style; anything off-model or clumsy.',
    findings.length ? 'Automatic checks found:\n' + findings.map((f) => `- ${f.role}: ${f.check}: ${f.message}`).join('\n') : 'Automatic checks found nothing.',
    'Return JSON {"notes": [what you are changing and why], ...only the roles you redraw}. Redraw a role completely, in the same flat-shape format; leave a role out to keep it. Return {"notes": []} if nothing needs to change.',
  ].join('\n\n');
  return [
    { role: 'system', content: contract(game, spec) },
    { role: 'user', content: game.brief },
    { role: 'assistant', content: JSON.stringify(pack) },
    { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + pngBase64 } }] },
  ];
}

// Baseline without the kit: Muse draws finished art straight from the player's words, with any SVG
// feature the app's sanitizer allows. Used to test whether the vocabulary limits arbitrary styles.
export function freeDrawMessages(game, stylePrompt) {
  const system = [
    `Art-direct and draw a small phone game in the player's style. Return one JSON object: ${game.roles.map((r) => r.id).join(', ')} as standalone SVG strings (each starts with <svg and has xmlns and the exact viewBox), plus "palette": {"ink": darkest color for text and the button, "surface": lightest color, "accent", "tertiary"} as #RRGGBB.`,
    ...game.roles.map((r) => `${r.id}: viewBox "0 0 ${r.width} ${r.height}", ${r.kind === 'backdrop' ? 'opaque, full bleed' : `transparent, shown ${r.play} px wide, keep ${r.gutter ?? 4} units clear on every side${r.baseline ? `, resting on y=${r.baseline}` : ''}`}. ${r.purpose ?? ''}`),
    'Carry the style fully: palette, line, shading, texture, lighting and shape language. You may use any SVG drawing feature: paths and shapes, gradients, patterns, clip paths, masks and filters with local url(#id) references. No text, scripts, images, external references, links or animation.',
    'The game draws the HUD, score, labels, the cable, the rail, the timing beam and the tap button on top of your art. Never draw any of them, or anything that looks like a panel, box, button or text bar.',
    `Composition: ${game.composition}`,
    'Sprites must read instantly at play size and stand out from the backdrop. Keep each sprite under 16 KB and the backdrop under 40 KB.',
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: `Game: ${game.brief}\nPlayer's style: ${stylePrompt}` }];
}
