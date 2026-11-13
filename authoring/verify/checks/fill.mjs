// F_* fill checks: an adapter for playtest/fill-check.mjs (canvas aspect, background coverage, the
// HUD's band, key content in the phone's bleed bands, who draws the score). The static checks read
// the game; the frame checks read a spread of the verifier's dense frames. "error" blocks.

import { checkFillStatic, checkFillFrames, CODES, HINTS } from '../../playtest/fill-check.mjs';
import { finding } from '../registry.mjs';

const SEV = { F_ASPECT: 'warn', F_BG_GAP: 'block', F_BACKDROP_SHORT: 'block', F_HUD_OUT_OF_BAND: 'warn', F_KEY_IN_BLEED: 'block', F_DOUBLE_HUD: 'block', F_SCORE_HIDDEN: 'warn' };

export const check = {
  id: 'fill',
  family: 'F',
  needs: ['frames'],
  codes: Object.fromEntries(Object.keys(CODES).map((k) => [k, { severity: SEV[k] ?? 'warn', title: CODES[k], hint: HINTS[k] }])),
  run(ctx) {
    const manifest = ctx.built?.manifest ?? null;
    const input = manifest ?? ctx.game;
    const frames = ctx.sample.frames;
    const step = Math.max(1, Math.floor(frames.length / 60));
    const picked = frames.filter((f, i) => f.label !== 'play' || i % step === 0);
    const targets = picked.flatMap((f) => f.targets ?? []);
    const list = [...checkFillStatic(input), ...checkFillFrames(picked.map((f) => f.frame), { manifest, targets })];
    const seen = new Set();
    return list.filter((f) => { const k = `${f.code}|${f.at}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((f) => finding(f.code, { severity: f.severity === 'error' ? 'block' : 'warn', node: f.at ?? null, frame: null, message: f.detail ? `${f.message}: ${f.detail}` : f.message, hint: f.hint }));
  },
};
