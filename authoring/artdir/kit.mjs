// The kit read from a style frame: palette (palette.mjs, from the frame's pixels), a look-kit font
// pairing that fits the vibe (kit/look.mjs), and the shape language for panels and buttons (corner
// radius, stroke, shadow) for anything drawn as vector shapes next to the painted frames.
//
//   kitFromFrame({frame, words, gameId, vibe?, pairing?, mode?, shape?}) → kit (JSON-safe)
//   applyKitTokens(game, kit) → sets presentation.tokens (palette roles + shape tokens), in place
//
// Deterministic: the same frame pixels, words and id give the same kit.

import { chooseLook, lookFromChoice, lookChoice } from '../kit/look.mjs';
import { paletteFromFrame } from './palette.mjs';
import { calmZones } from './sheets.mjs';

// Shape language per vibe family: corner radius, stroke width, drop-shadow offset (canvas units).
const SHAPES = {
  soft: { radius: 22, stroke: 3, shadow: 4 },
  bold: { radius: 14, stroke: 3, shadow: 5 },
  sharp: { radius: 6, stroke: 2, shadow: 0 },
  pixel: { radius: 0, stroke: 3, shadow: 4 },
  calm: { radius: 16, stroke: 1.5, shadow: 3 },
};
const FAMILY = {
  cute_collectible: 'soft', food_fun: 'soft', meme_brainrot: 'bold', cartoon_action: 'bold', game_show: 'bold',
  tropical: 'soft', notebook: 'soft', garden_cozy: 'calm', wild_nature: 'calm', elegant: 'calm', myth_ancient: 'calm',
  jazz_deco: 'calm', midcentury: 'soft', noir_mystery: 'sharp', spooky: 'calm', medieval_quest: 'calm', wild_west: 'bold',
  retro_80s: 'sharp', cyber_tech: 'sharp', space_saga: 'sharp', racing_sport: 'sharp', office_corporate: 'sharp',
  music_party: 'sharp', pixel_arcade: 'pixel', word_puzzle: 'calm', trivia_world: 'calm', clean_modern: 'calm',
};

export function shapeFor(vibe) { return { ...SHAPES[FAMILY[vibe] ?? 'calm'], family: FAMILY[vibe] ?? 'calm' }; }

/**
 * `frame` is the style frame cropped to the tall canvas (sheets.toTall). `words` are the game's
 * title, theme and style words (they pick the vibe unless `vibe` is given); `gameId` picks the
 * pairing and scale inside the vibe unless `pairing` is given.
 */
export function kitFromFrame({ frame, words = '', gameId = '', vibe = null, pairing = null, mode = null, shape = null }) {
  const pal = paletteFromFrame(frame, { mode });
  let spec = chooseLook(words, gameId);
  if (vibe) spec = lookFromChoice({ vibe, pairing: pairing ?? undefined, seed: spec.seed });
  return {
    kit: 'artdir/1',
    mode: pal.mode,
    palette: pal.roles,
    swatches: pal.swatches,
    type: lookChoice(spec),
    fonts: spec.families,
    shape: { ...shapeFor(spec.vibe), ...(shape ?? {}) },
    calm: calmZones(frame),
  };
}

/** Palette roles and the shape tokens onto a built game's presentation tokens (in place). */
export function applyKitTokens(game, kit) {
  const p = game.presentation ?? (game.presentation = {});
  p.tokens = { ...(p.tokens ?? {}), ...kit.palette, plate: kit.palette.surface, plate_solid: kit.palette.surface, shadow: kit.mode === 'dark' ? '#00000066' : '#0000002E', line: kit.palette.ink_muted };
  return game;
}
