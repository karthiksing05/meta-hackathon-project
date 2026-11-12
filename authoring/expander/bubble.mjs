// Wraps an expanded game.json into a Bubble manifest with `formula: "microgame"` (SPEC.md 2.7):
// the expanded game as JSON text in `content.game_json`, the authoring manifest it came from as
// text in `content.authoring_json`. Text, not objects: key order is part of a game's meaning
// (positional function params, state init order), and the app's Swift JSONValue re-encodes
// objects with sorted keys. The text reaches the engine exactly as it was validated and gated.
// The player runs `content.game_json` directly, so it never needs the expander;
// `content.authoring_json` is kept for remixing and lineage.
//
// Pure: no disk or network, so the app (Studio) can bundle it with the expander.

const HEX = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;

/** Resolves a presentation color: a literal "#RRGGBB" or a "$token" from presentation.tokens. */
function color(game, v) {
  const tokens = game?.presentation?.tokens || {};
  for (let i = 0; i < 4 && typeof v === 'string' && v.startsWith('$'); i++) v = tokens[v.slice(1)];
  return typeof v === 'string' && HEX.test(v) ? v.slice(0, 7).toUpperCase() : null;
}

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * Bubble style colors that match the game, so the runtime's frame (intro card, HUD, letterbox
 * around the 360×640 playfield) blends with it. Ink is black or white, whichever reads on the
 * background (≥ 4.5:1 is guaranteed for one of them).
 */
export function styleColors(game) {
  const bg = color(game, game?.presentation?.canvas?.background) || '#14123A';
  const tokens = game?.presentation?.tokens || {};
  // Only token colors that stand out from the background (≥ 2:1) are used as the frame's accents.
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const picks = [...new Set(Object.values(tokens).map((v) => color(game, v)))].filter((c) => c && contrast(c, bg) >= 2);
  const dark = luminance(bg) < 0.18;
  const ink = dark ? '#FFFFFF' : '#141414';
  const [primary = dark ? '#8EC5FF' : '#3B5BDB', secondary = dark ? '#C3A6FF' : '#7048E8', accent = '#FFD166'] = picks;
  return { bg_top: bg, bg_bottom: bg, ink, primary, secondary, accent, danger: '#FF6B6B' };
}

/**
 * opts: {id, game, authoring?, title?, oneLineRule?, emoji?, brief?, style?, seed?, lineage?}
 * Title and rule default to the game's meta.
 */
export function wrapBubble(opts) {
  const { id, game } = opts;
  if (!id || !game) throw new Error('wrapBubble needs id and game');
  const meta = game.meta || {};
  const rule = opts.oneLineRule || firstSentence(meta.instructions) || 'Play!';
  return {
    id,
    version: 1,
    engine_version: 1,
    title: (opts.title || meta.title || 'Microgame').slice(0, 60),
    one_line_rule: rule.slice(0, 120),
    formula: 'microgame',
    brief: opts.brief || { intent: rule, audience: 'everyone', mood: ['playful'], energy: 'medium', competition: 'friendly' },
    structure: { cadence: 'endless', scope: 'everyone', setter: 'ai' },
    lineage: opts.lineage || { parent: null, operators: [], remix_of: null },
    chain: null,
    style: {
      look: 'glow',
      palette: 'custom',
      colors: styleColors(game),
      font: 'rounded',
      motif: 'none',
      emoji: opts.emoji || '🎮',
      mood_preset: 'playful',
      ...(opts.style || {}),
    },
    concepts: [
      { use: 'space.microgame' },
      { use: 'input.microgame' },
      { use: 'score.microgame', params: { label: 'points' } },
    ],
    glue: {},
    content: opts.authoring
      ? { game_json: JSON.stringify(game), authoring_json: JSON.stringify(opts.authoring) }
      : { game_json: JSON.stringify(game) },
    seed: opts.seed ?? 1,
  };
}

function firstSentence(s) {
  if (typeof s !== 'string') return '';
  const m = /^(.+?[.!?])(\s|$)/.exec(s.trim());
  return (m ? m[1] : s.trim());
}
