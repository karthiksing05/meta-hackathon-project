// Fixes for the motion findings (motion.mjs). Presentation only: feedback actions, animate_on,
// transitions, text widths. Rules, handlers and hit targets are never touched, so the proof
// (prove.mjs) and the rules hash hold, and seeded runs still verify.
//
//   feedback-shake  keep one shake, on the fail moment that causes the others (pickShakeKeeper),
//                   at most 3 units for 150 ms; drop every other shake
//   element-shake   drop x/y/rotation swings on text, HUD and buttons
//   pulse           clamp scale keys to 1.08× (text) or 1.15× (icons)
//   reflow          fixed HUD slots: every text in the row gets a fixed width (its widest words seen,
//                   plus room for two more characters), centered in it, so the row never re-centres
//   slide           drop x/y transitions and animations on the text; it fades instead (fade-in)
//   fade-in         a short fade (the look's) on the events that change the words or show the panel
//   carry-over      drop the colour transition that carries the old state's colours onto the next
//                   state's labels: the reveal clears before the new labels show
//   particles       bursts last at most 300 ms, at most 14 particles
//   style           one state change, one style: every fade on an event takes the look's length and
//                   ease; pulses 120 to 240 ms
//
// motionFix(game, findings, {msample, lookId}) → {game, fixes: [{code, cause, node, what}]}.

import { walkNodes, approxWidth } from '../playtest/layout-check.mjs';
import { MOTION, fadeSpec, feedbackActions, pickShakeKeeper } from './motion.mjs';
import { tracksOf, nodeIndex } from './motion-track.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));

/** The node at a JSON pointer under the game, or null. */
function at(game, ptr) {
  let v = game;
  for (const k of ptr.split('/').slice(1)) { if (v == null) return null; v = v[k]; }
  return v ?? null;
}
const parentPtr = (ptr) => ptr.split('/').slice(0, -1).join('/');

export function motionFix(input, findings, { msample = null, lookId = null } = {}) {
  const game = clone(input);
  const fixes = [];
  const spec = fadeSpec(lookId);
  const causes = new Set(findings.map((f) => f.cause));
  const note = (f, what) => fixes.push({ code: f.code, cause: f.cause, node: f.node, what });

  // Shake: one, subtle, on the cause of the fail.
  if (causes.has('feedback-shake')) {
    const keeper = pickShakeKeeper(game);
    for (const s of feedbackActions(game, 'shake').reverse()) {
      const list = game.presentation.feedback[s.fi].do;
      if (keeper && s.ptr === keeper.ptr) {
        const px = typeof s.action.px === 'number' ? s.action.px : 8, ms = typeof s.action.ms === 'number' ? s.action.ms : 300;
        list[s.ai] = { shake: { ...s.action, px: Math.min(px, MOTION.shakeMaxPx), ms: Math.min(ms, MOTION.shakeMaxMs) } };
        fixes.push({ code: 'M_SHAKE', cause: 'feedback-shake', node: s.ptr, what: `kept one shake on '${s.on}': ${Math.min(px, MOTION.shakeMaxPx)} units, ${Math.min(ms, MOTION.shakeMaxMs)} ms` });
      } else {
        list.splice(s.ai, 1);
        fixes.push({ code: 'M_SHAKE', cause: 'feedback-shake', node: s.ptr, what: `dropped the shake on '${s.on}'` });
      }
    }
    game.presentation.feedback = game.presentation.feedback.filter((fb) => (fb.do ?? []).length);
  }

  for (const f of findings) {
    if (f.cause === 'element-shake' && f.remove) {
      const host = at(game, parentPtr(parentPtr(f.node)));
      const ev = f.node.split('/').at(-1);
      if (host?.animate_on?.[ev]) { delete host.animate_on[ev]; if (!Object.keys(host.animate_on).length) delete host.animate_on; note(f, 'dropped the shake'); }
    }
    if (f.cause === 'pulse') {
      const a = at(game, f.node);
      if (a?.keys) {
        const c = f.cap - 1;
        a.keys = a.keys.map((k) => (typeof k === 'number' ? +(1 + Math.max(-c, Math.min(c, k - 1))).toFixed(3) : k));
        note(f, `pulse capped at ${f.cap}×`);
      }
    }
    if (f.cause === 'carry-over') {
      const n = at(game, f.node);
      if (n?.transition) {
        for (const p of f.props) delete n.transition[p];
        if (!Object.keys(n.transition).length) delete n.transition;
        note(f, `dropped the ${f.props.join('/')} transition: the reveal clears before the next labels show`);
      }
    }
  }

  // Fixed HUD slots: rows whose texts reflow.
  const rows = new Set();
  const idx = nodeIndex(game);
  for (const f of findings.filter((x) => x.cause === 'reflow')) {
    const ent = idx.get(f.node);
    const stack = [...(ent?.parents ?? [])].reverse().find((p) => p.node.node === 'stack');
    if (stack && !rows.has(stack.ptr)) { rows.add(stack.ptr); fixRow(game, stack.ptr, msample, fixes, f); }
  }

  // Slides: the text stops moving (a fade follows below).
  for (const f of findings.filter((x) => x.cause === 'slide')) {
    const n = at(game, f.node);
    if (!n) continue;
    for (const k of ['x', 'y']) if (n.transition?.[k] != null) delete n.transition[k];
    if (n.transition && !Object.keys(n.transition).length) delete n.transition;
    for (const [ev, a] of Object.entries(n.animate_on ?? {})) if (['x', 'y'].includes(a?.prop)) delete n.animate_on[ev];
    if (n.animate_on && !Object.keys(n.animate_on).length) delete n.animate_on;
    note(f, 'anchored: no slide');
  }

  // Fades for pops (and slides), on the events that change the node.
  const faded = new Set();
  for (const f of findings.filter((x) => x.cause === 'fade-in' && (x.events ?? []).length)) {
    if (faded.has(f.node)) continue;
    faded.add(f.node);
    let n = at(game, f.node);
    if (!n) continue;
    const evs = f.events.slice(0, 6);
    // One animation per event per node: where the node already animates on one of these events,
    // the fade goes on a group wrapped around it (same place: a group's box is its child's).
    if (evs.some((e) => n.animate_on?.[e])) {
      const par = at(game, parentPtr(f.node));
      const key = f.node.split('/').at(-1);
      const wrap = { node: 'group', children: [n] };
      if (n.visible !== undefined) { wrap.visible = n.visible; delete n.visible; }
      if (Array.isArray(par)) par[+key] = wrap; else if (par) par[key] = wrap;
      n = wrap;
    }
    n.animate_on ??= {};
    for (const e of evs) n.animate_on[e] = { prop: 'opacity', keys: [0, 1], ms: spec.ms, ease: spec.ease };
    note(f, `fades in over ${spec.ms} ms on ${evs.map((e) => `'${e}'`).join(', ')}`);
  }

  if (causes.has('particles')) {
    for (const p of feedbackActions(game, 'particles')) {
      const a = game.presentation.feedback[p.fi].do[p.ai].particles;
      const before = JSON.stringify(a);
      if (typeof a.ms !== 'number' || a.ms > 300) a.ms = 300;
      if (typeof a.count !== 'number' || a.count > 14) a.count = Math.min(14, typeof a.count === 'number' ? a.count : 14);
      if (JSON.stringify(a) !== before) fixes.push({ code: 'M_TRANSITION_OVERLAP', cause: 'particles', node: p.ptr, what: `burst on '${p.on}': ${a.count} particles, ${a.ms} ms` });
    }
  }

  // One state change, one style (after the fades above, so they're normalized with the rest).
  if (causes.has('style') || faded.size) {
    const pulses = new Map(); // event → its scale pulses: one length (their median, 120 to 240 ms) and one ease each
    walkNodes(game.presentation?.root, (node, ptr) => {
      for (const [ev, a] of Object.entries(node.animate_on ?? {})) {
        if (a?.prop === 'opacity' && (a.ms !== spec.ms || (a.ease ?? 'linear') !== spec.ease) && !(a.keys?.length > 2 && a.ms >= 1000)) {
          a.ms = spec.ms; a.ease = spec.ease;
          fixes.push({ code: 'M_TRANSITION_STYLE', cause: 'style', node: `${ptr}/animate_on/${ev}`, what: `fade ${spec.ms} ms ${spec.ease}` });
        }
        if (a?.prop === 'scale') { if (!pulses.has(ev)) pulses.set(ev, []); pulses.get(ev).push({ a, ptr: `${ptr}/animate_on/${ev}` }); }
      }
      const t = node.transition?.opacity;
      if (t != null && (typeof t === 'number' ? t : t.ms) !== spec.ms) {
        node.transition.opacity = { ms: spec.ms, ease: spec.ease };
        fixes.push({ code: 'M_TRANSITION_STYLE', cause: 'style', node: `${ptr}/transition/opacity`, what: `fade ${spec.ms} ms ${spec.ease}` });
      }
    });
    for (const [, list] of pulses) {
      const ms = list.map((x) => x.a.ms ?? 200).sort((p, q) => p - q);
      const want = Math.max(120, Math.min(240, ms[Math.floor(ms.length / 2)]));
      for (const { a, ptr } of list) {
        if ((a.ms ?? 200) === want && a.ease === 'out') continue;
        a.ms = want; a.ease = 'out';
        fixes.push({ code: 'M_TRANSITION_STYLE', cause: 'style', node: ptr, what: `pulse ${want} ms out` });
      }
    }
  }
  return { game, fixes };
}

/**
 * Fixed slots for a row stack: each text child gets `w` = the widest words it showed (from the
 * motion sample, else its current text) plus two characters, `align: center`, so the row's width
 * never changes and nothing in it re-centres.
 */
function fixRow(game, stackPtr, msample, fixes, f) {
  const stack = at(game, stackPtr);
  if (!stack || !Array.isArray(stack.children)) return;
  const seen = new Map(); // ptr → longest text seen
  for (const run of msample?.runs ?? []) for (const [, tr] of tracksOf(run)) {
    const n = msample.nodes[tr[0].id];
    if (!n?.ptr?.startsWith(stackPtr + '/children/')) continue;
    for (const s of tr) if (s.text != null && s.text.length > (seen.get(n.ptr)?.length ?? -1)) seen.set(n.ptr, s.text);
  }
  stack.children.forEach((c, i) => {
    if (c?.node !== 'text') return;
    const ptr = `${stackPtr}/children/${i}`;
    const longest = seen.get(ptr) ?? (typeof c.text === 'string' && !c.text.startsWith('=') ? c.text : null);
    if (longest == null) return;
    const size = typeof c.size === 'number' ? c.size : 16, weight = typeof c.weight === 'number' ? c.weight : 400;
    const w = Math.ceil(approxWidth(longest + '00', size, weight));
    if (typeof c.w === 'number' && c.w >= w) return;
    c.w = w;
    c.align = 'center';
    fixes.push({ code: 'M_TEXT_UNSTABLE', cause: 'reflow', node: ptr, what: `fixed HUD slot ${w} units wide` });
  });
}
