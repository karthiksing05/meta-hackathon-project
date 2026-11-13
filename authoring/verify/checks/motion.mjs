// Motion and transitions (docs/games/FAILURE_CLASSES.md, "Motion", FC-40 to FC-46): shake, text that
// moves or rescales while it is read, pops and flicker, old and new states overlapping mid-change,
// inconsistent transition styles. Judged over a contiguous replay (a frame every 50 ms, no repeats
// dropped) of the same bot runs the layout checks use (motion-track.mjs); the rules are in
// motion.mjs, the fixes in motion-fix.mjs (verifyAndFix's motion stage).

import { finding } from '../registry.mjs';
import { sampleMotion } from '../motion-track.mjs';
import { motionFindings, MOTION } from '../motion.mjs';

const cache = new Map(); // instrumented game JSON → motion sample (the solver re-verifies often)

export async function motionSampleFor(ctx) {
  const key = ctx.sample?.replayCtx?.json;
  if (key && cache.has(key)) return cache.get(key);
  const ms = await sampleMotion(ctx.game, { replayCtx: ctx.sample?.replayCtx ?? null, nodes: ctx.sample?.replayCtx ? ctx.sample.nodes : null, engine: ctx.engine, maxSeconds: 60 });
  if (key) { if (cache.size > 24) cache.delete(cache.keys().next().value); cache.set(key, ms); }
  return ms;
}

export const check = {
  id: 'motion',
  family: 'M',
  needs: ['frames'],
  codes: {
    M_SHAKE: { severity: 'block', title: `a shake over ${MOTION.shakeMaxPx} units or ${MOTION.shakeMaxMs} ms, on a non-fail moment, stacked on one moment, or on text, HUD or buttons`, hint: 'keep one subtle shake (3 units, 150 ms) on the fail moment; motion-fix.mjs does this' },
    M_TEXT_UNSTABLE: { severity: 'block', title: 'text that jumps, slides or rescales while it is read (a row re-centring, a slide, a pulse over 1.08×)', hint: 'fixed HUD slots, anchored text that fades instead of moving, pulses capped at 1.08×' },
    M_PULSE: { severity: 'block', title: `an icon or sprite pulsing past ${MOTION.iconScaleMax}×`, hint: `cap the scale keys at ${MOTION.iconScaleMax}×` },
    M_POP: { severity: 'block', title: 'words or a panel that appear or swap at once with no fade, or flicker for 100 ms or less', hint: "a short fade (the look's) on the events that change it" },
    M_TRANSITION_OVERLAP: { severity: 'block', title: "old and new states overlapping mid-change: next labels on the last state's colours, particles over readable text", hint: 'clear the reveal before the next labels show; short, sparse particle bursts' },
    M_TRANSITION_STYLE: { severity: 'block', title: 'one kind of state change animated in different lengths or eases, or a text fade or pulse that lingers', hint: "every fade on an event in the look's length and ease" },
    M_TEXT_HOLD: { severity: 'warn', title: 'words on screen for less time than it takes to read them', hint: 'a rules change (the reveal time): show it longer, or say less' },
  },
  async run(ctx) {
    const ms = await motionSampleFor(ctx);
    return motionFindings(ctx.game, ms).map(({ code, severity, node, frame, message, ...rest }) =>
      finding(code, { severity, node, frame, message, cause: rest.cause ?? null }));
  },
};
