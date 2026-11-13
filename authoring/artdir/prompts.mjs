// Image prompts for the art-direction pipeline (ARTDIR.md). One direction file per game (written by
// the agent, see `directionErrors`) gives every prompt the same style words, palette and material, so
// the style frame, the backdrop, the sprite sheet and the UI kit sheet read as one art direction.
//
// Pure: strings in, strings out.

export const TALL = Object.freeze({ w: 360, h: 780, safeTop: 110, safeBottom: 684 });

const KEY_TEXT = { magenta: 'pure magenta (#FF00FF)', green: 'pure green (#00FF00)', blue: 'pure blue (#0000FF)' };
export const KEY_RGB = { magenta: [255, 0, 255], green: [0, 255, 0], blue: [0, 0, 255] };

const NO_TEXT = 'No letters, no numbers, no words, no writing of any kind, no logos, no watermark, no signature.';

/** Problems with a direction file, as messages (empty when it's fine). */
export function directionErrors(d) {
  const errs = [];
  const need = (path, v) => { if (typeof v !== 'string' || !v.trim()) errs.push(`${path} is required (a sentence)`); };
  need('title', d?.title);
  need('style', d?.style);
  need('frame.scene', d?.frame?.scene);
  need('frame.focal', d?.frame?.focal);
  // A seeded game may take new pictures too (images don't change the simulation; the proof is that its
  // seeded run logs still replay to the same score, finish.mjs). Only a presentation-only direction
  // that draws everything as shapes may leave the backdrop out.
  if (!d?.presentationOnly || d?.backdrop) need('backdrop.scene', d?.backdrop?.scene);
  if (d?.wordmark !== undefined) {
    if (d.wordmark.key && !KEY_TEXT[d.wordmark.key]) errs.push(`wordmark.key is one of ${Object.keys(KEY_TEXT).join(', ')}`);
    if (d.wordmark.text !== undefined && (typeof d.wordmark.text !== 'string' || !d.wordmark.text.trim() || d.wordmark.text.length > 40)) errs.push('wordmark.text is the title as lettered (1 to 40 characters)');
  }
  if (d?.sprites !== undefined) {
    if (!Array.isArray(d.sprites?.items) || !d.sprites.items.length) errs.push('sprites.items must list the items to draw');
    else d.sprites.items.forEach((it, i) => { if (!/^[a-z][a-z0-9_]{0,23}$/.test(it?.id ?? '')) errs.push(`sprites.items[${i}].id must be a lowercase asset id`); need(`sprites.items[${i}].text`, it?.text); });
    if (d.sprites.key && !KEY_TEXT[d.sprites.key]) errs.push(`sprites.key is one of ${Object.keys(KEY_TEXT).join(', ')}`);
  }
  if (d?.ui !== undefined) { need('ui.material', d.ui?.material); if (d.ui.key && !KEY_TEXT[d.ui.key]) errs.push(`ui.key is one of ${Object.keys(KEY_TEXT).join(', ')}`); }
  return errs;
}

const palText = (d) => (d.palette?.length ? ` Palette: ${d.palette.join(', ')}.` : '');

/**
 * The style frame: one picture of the playing screen as it should look, tall like a phone, with calm
 * zones behind the HUD (top band) and behind the play area, so the kit read from it fits the game.
 */
export function framePrompt(d) {
  return [
    `Vertical full-screen mobile game screenshot mock-up, tall 9:19.5 phone portrait, for the game "${d.title}".`,
    `Scene: ${d.frame.scene}.`,
    `Focal point, large and centered in the middle of the screen: ${d.frame.focal}.`,
    `Top 18% of the image: a calm, low-detail band holding ${d.frame.hud ?? 'one small blank rounded score plaque'}, drawn as blank plaques.`,
    d.frame.controls ? `Lower part of the screen: ${d.frame.controls}.` : '',
    d.ui?.material ? `Panels, plaques and buttons are made of ${d.ui.material}.` : '',
    `Art style for everything: ${d.style}.${palText(d)}`,
    `Full-bleed art reaching every edge, one cohesive art direction, generous empty space, clear hierarchy. No phone frame, no status bar, no app chrome. ${NO_TEXT}`,
  ].filter(Boolean).join(' ');
}

/**
 * The backdrop, as an edit of the style frame (the frame is the reference picture): the same place
 * with every UI piece, character and item removed, so the background matches the frame exactly.
 */
export function backdropPrompt(d, { edit = true } = {}) {
  const calm = d.backdrop.calm ?? 'the middle of the screen, where the game is played, is calm, soft and low in detail';
  if (edit) return `Redraw this exact picture as an empty game background: the same place, art style, palette, lighting and camera, but remove every plaque, panel, button, badge, character and loose item, and paint the scenery through where they were. ${d.backdrop.scene}. Keep it calm: ${calm}; the top 18% is quiet and simple. Tall 9:19.5 phone portrait, full bleed to every edge. ${NO_TEXT}`;
  return `Full-screen vertical mobile game background, tall 9:19.5 phone portrait, for "${d.title}": ${d.backdrop.scene}. Keep it calm: ${calm}; the top 18% is quiet and simple. No characters, no UI. Art style: ${d.style}.${palText(d)} ${NO_TEXT}`;
}

/** Columns and rows for `n` sheet cells: as square as possible, never more than 4 columns. */
export function gridFor(n) {
  const cols = Math.min(4, Math.ceil(Math.sqrt(n)));
  return { cols, rows: Math.ceil(n / cols) };
}

/** One sprite sheet with every item of the game, on a flat chroma key, in a fixed grid. */
export function spriteSheetPrompt(d) {
  const items = d.sprites.items;
  const { cols, rows } = gridFor(items.length);
  const key = d.sprites.key ?? 'magenta';
  const list = items.map((it, i) => `(${i + 1}) ${it.text}`).join('; ');
  const set = d.sprites.set ? ` ${d.sprites.set}` : '';
  return `Game sprite sheet for "${d.title}": exactly ${items.length} separate subjects arranged in a grid of ${cols} columns and ${rows} rows, reading order left to right then top to bottom, each subject centered in its own equal cell with wide empty margins, nothing touching, nothing crossing a cell edge${items.length < cols * rows ? `, the last ${cols * rows - items.length} cell(s) left empty` : ''}. ${list}.${set} Every subject: front view, whole and uncropped, with a clean silhouette, soft form shading, no cast shadow, no ground. Art style: ${d.style}.${palText(d)} Background: one flat solid ${KEY_TEXT[key]} everywhere, no gradient, no floor, no grid lines, no frames, no borders. ${NO_TEXT}`;
}

/** The UI kit sheet: a 2 × 2 grid of empty frames to 9-slice (panel, button, badge, banner). */
export const UI_PIECES = Object.freeze(['panel', 'button', 'badge', 'banner']);
export function uiSheetPrompt(d) {
  const key = d.ui.key ?? 'magenta';
  const m = d.ui.material;
  return `Game UI kit sheet for "${d.title}": exactly 4 separate empty interface frames in a grid of 2 columns and 2 rows, each centered in its own cell with wide empty margins, nothing touching: (1) top left, a large empty portrait card panel, ${m}, rounded corners, a clear even border all round and a plain flat empty middle; (2) top right, a wide empty pill-shaped button, ${m}, ${d.ui.button ?? 'a slightly raised edge'}, flat empty middle; (3) bottom left, a small empty rounded-square badge plaque, ${m}; (4) bottom right, a wide empty horizontal banner plaque with a flat middle, ${m}. Every frame is seen straight on, flat lit, perfectly symmetrical, with straight even sides and the same border thickness all round, no perspective, no tilt, no icons, no ornaments in the middle. Art style: ${d.style}.${palText(d)} Background: one flat solid ${KEY_TEXT[key]} everywhere, no gradient, no shadows on the background. ${NO_TEXT}`;
}

/** The words a wordmark spells: the direction's `wordmark.text`, else the title. */
export const wordmarkText = (d) => (d.wordmark?.text ?? d.title).trim();

/**
 * The title wordmark: one image call, the game's title lettered in the game's own style on a flat
 * chroma key (keyed and trimmed by sheets.finishWordmark). The only prompt that asks for letters: exactly
 * the title, spelled as written, and nothing else.
 */
export function wordmarkPrompt(d) {
  const w = d.wordmark ?? {};
  const key = w.key ?? 'green';
  const words = (w.text ?? d.title).trim();
  return `Game title logo lettering, the wordmark for a mobile game: the exact words "${words}" and nothing else, spelled exactly like that, every letter clearly readable. ${w.lettering ?? 'Chunky, characterful display lettering with a bold outline and a little depth, like a toy-box or arcade title'}, in the same art style as the game: ${d.style}.${palText(d)} ${w.layout ?? 'Set on one or two lines, centered, as wide as it is readable'}, filling most of the picture with wide empty margins all round, nothing cropped. No characters, no mascot, no icons, no scenery, no frame, no badge behind it, no tagline, no other words. Background: one flat solid ${KEY_TEXT[key]} everywhere, no gradient, no glow onto the background, no shadow on the background, and no ${key} anywhere in the lettering.`;
}
