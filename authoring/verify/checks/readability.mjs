// S_READABILITY: every word legible against what is actually behind it, on every sampled frame.
// Deterministic and Chrome-free (kit/readability.mjs composites the frames in JS), so it runs on the
// generator's server too. Blocking. The fix is kit/readability.mjs readabilityFix: a palette text
// colour, then the look's outline or soft plate, then a solid plate (presentation only).

import { inflateSync } from 'node:zlib';
import { finding } from '../registry.mjs';
import { readabilityFindings, READABILITY_CODE } from '../../kit/readability.mjs';

const inflate = (b) => new Uint8Array(inflateSync(b));

export const check = {
  id: 'readability',
  family: 'S',
  needs: ['frames'],
  codes: {
    [READABILITY_CODE]: {
      severity: 'block',
      title: 'text that is hard to read against the pixels behind it',
      hint: 'use a palette text colour that contrasts with the background, or an outline (display) or a plate (body); kit/readability.mjs readabilityFix does this',
    },
  },
  async run(ctx) {
    const list = readabilityFindings(ctx.game, ctx.sample, { measures: ctx.measures ?? null, inflate });
    return list.map((f) => finding(READABILITY_CODE, { node: f.node, frame: f.frame, frames: f.frames, message: f.message, p10: +f.p10.toFixed(2), need: f.need }));
  },
};
