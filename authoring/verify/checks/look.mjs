// S_* look checks ("does this look nice"): a game against its own look, not a house style
// (authoring/kit/README.md). The look is the game's `art.type` (vibe, pairing, seed) when it has
// one, else the one its words and id pick (kit/look.mjs chooseLook). Static, on the game's tree.
//
//   S_FONT_FAMILIES   block  more families than the pairing (2, or 3 with numerals), or one from outside it
//   S_TYPE_SCALE      block  a size off the game's own modular scale
//   S_TEXT_COLORS     block  a literal text colour instead of a palette token
//   S_NEON_TEXT       block  big or long text in a glowing colour
//   S_WEIGHT_MIX      warn   more than two weights of one family
//   S_ALIGNMENT       warn   static text on too many edges and centres
//   S_PALETTE_CLASH   warn   primary and accent off the backdrop's hues
//   S_THEME_MISMATCH  warn   the headline font isn't one of the vibe's fonts
//
// Blocking codes block only for a game with `art.type`; without one every finding is a warning.
// The fix is kit/look.mjs lookFix (presentation only: fonts, sizes, weights, text colours and case,
// display outlines); verify.mjs's flow runs it as the "look" stage when wired (see the README).

import { finding } from '../registry.mjs';
import { LOOK_CODES, lookCheck, lookForBuilt } from '../../kit/look.mjs';

export const check = {
  id: 'look',
  family: 'S',
  needs: ['game'],
  codes: LOOK_CODES,
  async run(ctx) {
    const { spec, words, explicit } = lookForBuilt({ manifest: ctx.built?.manifest ?? null, authoring: ctx.built?.authoring ?? null, game: ctx.game });
    // A game that carries its look (art.type) is held to it; one without (built before the look
    // kit) gets the same findings as warnings, and the look fix sets it on the look its words pick.
    return lookCheck(ctx.game, spec, { words, explicit }).map((f) => finding(f.code, { ...(explicit ? {} : { severity: 'warn' }), node: f.node, frame: null, message: `${f.message} [look ${spec.vibe}/${spec.pairing}${explicit ? '' : ', picked from its words'}]`, hint: f.hint }));
  },
};
