// S_HUD_READABILITY (FC-02 in docs/games/FAILURE_CLASSES.md): timers, scores, lives and other HUD
// readouts must read at 4.5:1 at any size, on every sampled frame, values that change included. A
// HUD number is read in a glance mid-play, so the large-text allowance (3:1 at 22+) doesn't apply.
// The fix is the readability fixer (kit/readability.mjs), held to the HUD bar: a palette ink, a
// plate, then a solid plate.

import { inflateSync } from 'node:zlib';
import { finding } from '../registry.mjs';
import { readabilityFindings, HUD_READABILITY_CODE, HUD_NEED } from '../../kit/readability.mjs';

const inflate = (b) => new Uint8Array(inflateSync(b));

/** HUD readouts: text the layout lint tags as HUD (a counter, "Label: n", a timer, and what's grouped with it). */
export const isHudText = (it) => it.op?.op === 'text' && it.role === 'hud'; // a HUD-tagged text in the top or bottom band

export function hudReadabilityFindings(game, sample, opts = {}) {
  return readabilityFindings(game, sample, { ...opts, inflate: opts.inflate ?? inflate, only: isHudText, minNeed: HUD_NEED, code: HUD_READABILITY_CODE });
}

export const check = {
  id: 'hud-readability',
  family: 'S',
  needs: ['frames'],
  codes: {
    [HUD_READABILITY_CODE]: {
      severity: 'block',
      title: `a timer, score or other HUD readout under ${HUD_NEED}:1 against what is behind it, at any size, on any frame`,
      hint: 'put the readout on the HUD panel or a plate, or use the palette ink that reads on it; kit/readability.mjs readabilityFix does this',
    },
  },
  async run(ctx) {
    return hudReadabilityFindings(ctx.game, ctx.sample, { measures: ctx.measures ?? null })
      .map((f) => finding(HUD_READABILITY_CODE, { node: f.node, frame: f.frame, frames: f.frames, message: `HUD ${f.message}`, p10: +f.p10.toFixed(2), need: f.need }));
  },
};
