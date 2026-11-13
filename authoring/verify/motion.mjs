// Motion and transition checks (docs/games/FAILURE_CLASSES.md, "Motion"): how a game changes between
// states, judged over contiguous frames (motion-track.mjs), not still frames. Pure: the check module
// (checks/motion.mjs) and the fixer (motion-fix.mjs) both read these findings.
//
// Each finding: {code, severity, node (JSON pointer), frame, message, cause, ...}. `cause` names the
// fix motion-fix.mjs applies.
//
// What the shell already does (FacebookClone/Bubbles/Runtime/web/bubble-kit-microgame.js, since
// motion-verify): toasts in a free lane, fading in place; one capped shake per moment, art only;
// text drawn at no more than 1.08×. The game is still held to the same limits in its own JSON, so
// older builds and the Studio preview show it the same way.

import { walkNodes } from '../playtest/layout-check.mjs';
import { tracksOf, center, nodeIndex } from './motion-track.mjs';

/** Preregistered thresholds (docs/games/FAILURE_CLASSES.md, Motion). */
export const MOTION = {
  shakeMaxPx: 3,          // a shake is at most this many canvas units...
  shakeMaxMs: 150,        // ...for at most this long, and only on a fail moment
  shakeBlockPx: 4,        // over this (or shakeBlockMs) it blocks
  shakeBlockMs: 250,
  textScaleMax: 1.08,     // text pulses
  iconScaleMax: 1.15,     // other pulses
  moveEps: 1.5,           // a still text moving more than this (units) between frames moved
  movingShare: 0.3,       // a text that moves in more than this share of its frames rides a sprite (not judged)
  popPanelArea: 0.06,     // a non-text element this share of the canvas or more appearing at once is a pop
  flickerMs: 100,         // shown (or hidden) for this long or less, then back: flicker
  liveTextPerS: 1.5,      // a text whose words change more often than this is live (a counter, a timer): not judged for pops
  fadeMs: { default: 160, pixel: 100 },
  fadeEase: { default: 'out', pixel: 'linear' },
  fadeMaxMs: 400,         // a text fade or pulse longer than this lingers
  styleRatio: 1.5,        // one kind of state change: durations further apart than this are inconsistent
  particleOverTextMs: 300,
  holdBaseMs: 300, holdPerWordMs: 220, holdMaxMs: 2000, // reading time
};

export const FAIL_RE = /wrong|miss|hit|lose|lost|life|lives|fail|crash|damage|hurt|bad|die|dead|death|over|error|bump|collid|strike|mistake|timeout|explod|boom|spill|drop|broke|break|splat/i;
export const SUCCESS_RE = /right|correct|win|won|point|score|pickup|collect|combo|level|match|good|perfect|clear|bonus|star|coin|tap|start|ask|round|next|spawn|place|land|jump/i;
export const isFailEvent = (name) => FAIL_RE.test(name) && !/^(win|won)$/i.test(name) && !/correct|right/i.test(name);

const isExpr = (v) => typeof v === 'string' && v.trim().startsWith('=');
const identsOf = (s) => (typeof s === 'string' ? s.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [] : []);
const KIND_TEXTY = new Set(['text']);

export const fadeSpec = (lookId) => (lookId === 'pixel' ? { ms: MOTION.fadeMs.pixel, ease: MOTION.fadeEase.pixel } : { ms: MOTION.fadeMs.default, ease: MOTION.fadeEase.default });
export const holdMs = (text) => {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  return Math.min(MOTION.holdMaxMs, MOTION.holdBaseMs + MOTION.holdPerWordMs * words);
};

// ---------------------------------------------------------------- the game's structure ----

/** Every feedback action of a kind: [{fi, ai, ptr, on, when, action}]. */
export function feedbackActions(game, kind) {
  const out = [];
  (game?.presentation?.feedback ?? []).forEach((fb, fi) => (fb?.do ?? []).forEach((a, ai) => {
    if (a && typeof a === 'object' && a[kind] !== undefined) out.push({ fi, ai, ptr: `/presentation/feedback/${fi}/do/${ai}`, on: fb.on, when: fb.when ?? null, action: a[kind] });
  }));
  return out;
}

/** Events each rule emits (directly, in `do`, nested): Map event → Set(emitted). */
export function emitGraph(game) {
  const g = new Map();
  const walk = (v, on) => {
    if (Array.isArray(v)) { v.forEach((x) => walk(x, on)); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.emit === 'string') { if (!g.has(on)) g.set(on, new Set()); g.get(on).add(v.emit); }
    for (const x of Object.values(v)) if (x && typeof x === 'object') walk(x, on);
  };
  for (const r of game?.rules ?? []) if (r?.on) walk(r.do, r.on);
  return g;
}

/** State variables a rule writes: Map var → Set(events of the rules that write it). */
export function writers(game) {
  const out = new Map();
  const add = (v, on) => { const k = identsOf(v)[0]; if (!k) return; if (!out.has(k)) out.set(k, new Set()); out.get(k).add(on); };
  const walk = (v, on) => {
    if (Array.isArray(v)) { v.forEach((x) => walk(x, on)); return; }
    if (!v || typeof v !== 'object') return;
    for (const key of ['set', 'incr', 'decr', 'push', 'remove', 'append', 'toggle', 'clear', 'insert', 'pop', 'spawn', 'despawn', 'destroy', 'update']) if (typeof v[key] === 'string') add(v[key], on);
    for (const x of Object.values(v)) if (x && typeof x === 'object') walk(x, on);
  };
  for (const r of game?.rules ?? []) if (r?.on) walk(r.do, r.on);
  return out;
}

/** State variables an expression reads, through the game's functions. */
export function readsOf(game, exprs) {
  const fns = game?.functions ?? {};
  const state = new Set(Object.keys(game?.state ?? {}));
  const vars = new Set(), seen = new Set();
  const visit = (s) => {
    for (const id of identsOf(s)) {
      if (state.has(id)) vars.add(id);
      else if (id === 'status' || id === 'phase') vars.add('$status');
      else if (fns[id] && !seen.has(id)) { seen.add(id); visit(typeof fns[id] === 'string' ? fns[id] : fns[id].body); }
    }
  };
  for (const e of exprs) if (isExpr(e)) visit(e.slice(1));
  return vars;
}

/**
 * The events that change what a node shows (its text, `visible`, and its ancestors' `visible`):
 * the `on` of every rule writing a state variable those read. `tick` and `start` aren't events a
 * fade can follow; `status` maps to `win` and `lose`.
 */
export function triggerEvents(game, ptr, idx = nodeIndex(game), w = writers(game)) {
  const ent = idx.get(ptr);
  if (!ent) return [];
  const exprs = [ent.node.text, ent.node.visible, ...ent.parents.map((p) => p.node.visible)];
  const vars = readsOf(game, exprs);
  const ev = new Set();
  for (const v of vars) {
    if (v === '$status') { ev.add('win'); ev.add('lose'); continue; }
    // Only named events and inputs (a rule's `on` may also be a timer object, or tick/start).
    for (const on of w.get(v) ?? []) if (typeof on === 'string' && (game.events?.[on] || game.inputs?.[on])) ev.add(on);
  }
  return [...ev];
}

const keysAmp = (keys) => Math.max(0, ...(keys ?? []).filter((k) => typeof k === 'number').map((k) => Math.abs(k - 1)));
const reversals = (keys) => {
  const k = (keys ?? []).filter((x) => typeof x === 'number');
  let n = 0;
  for (let i = 2; i < k.length; i++) if (Math.sign(k[i] - k[i - 1]) * Math.sign(k[i - 1] - k[i - 2]) < 0) n++;
  return n;
};
const subtree = (node, pred) => { let hit = false; walkNodes(node, (n) => { if (pred(n)) hit = true; }); return hit; };
const hasText = (node) => subtree(node, (n) => KIND_TEXTY.has(n.node));
const hasHandler = (node) => subtree(node, (n) => n.on_tap || n.on_press || n.on_release || n.on_drag || n.draggable);

// ---------------------------------------------------------------- findings ----

function push(out, code, severity, node, message, extra = {}) { out.push({ code, severity, node, frame: extra.frame ?? null, message, ...extra }); }

/** M_SHAKE: shake actions over the limit, on a non-fail moment, or stacked on one moment; element shakes on text, HUD or targets. */
export function shakeFindings(game, msample) {
  const out = [];
  const shakes = feedbackActions(game, 'shake');
  const em = emitGraph(game);
  const chained = (a, b) => { const seen = new Set([a]); const q = [a]; while (q.length) { const x = q.shift(); for (const y of em.get(x) ?? []) { if (y === b) return true; if (!seen.has(y)) { seen.add(y); q.push(y); } } } return false; };
  const keeper = pickShakeKeeper(game);
  for (const s of shakes) {
    const px = typeof s.action?.px === 'number' ? s.action.px : 8, ms = typeof s.action?.ms === 'number' ? s.action.ms : 300;
    const why = [];
    if (px > MOTION.shakeBlockPx || ms > MOTION.shakeBlockMs) why.push(`${px} units for ${ms} ms (limit ${MOTION.shakeBlockPx} units, ${MOTION.shakeBlockMs} ms)`);
    else if (px > MOTION.shakeMaxPx || ms > MOTION.shakeMaxMs) why.push(`${px} units for ${ms} ms (the look's subtle shake is ${MOTION.shakeMaxPx} units, ${MOTION.shakeMaxMs} ms)`);
    if (!isFailEvent(String(s.on))) why.push(`on '${s.on}', not a fail moment`);
    if (keeper && keeper.ptr !== s.ptr && (keeper.on === s.on || chained(keeper.on, s.on) || chained(s.on, keeper.on))) why.push(`a second shake on the same moment as '${keeper.on}'`);
    if (why.length) push(out, 'M_SHAKE', 'block', s.ptr, `shake ${why.join('; ')}`, { cause: 'feedback-shake' });
  }
  // Shake on most inputs (dynamic).
  for (const run of msample?.runs ?? []) {
    if (run.idle || run.inputs.length < 4) continue;
    let eps = 0, on = false;
    for (const f of run.frames) { if (f.shake > 0.05 && !on) eps++; on = f.shake > 0.05; }
    if (eps > Math.max(2, run.inputs.length * 0.5) && shakes.length) {
      push(out, 'M_SHAKE', 'block', shakes[0].ptr, `shakes ${eps} times in ${run.inputs.length} inputs (${run.label}): shake should be rare`, { cause: 'feedback-shake' });
      break;
    }
  }
  // Element shakes: animate_on x/y/rotation keys that swing back and forth.
  walkNodes(game?.presentation?.root, (node, ptr) => {
    for (const [ev, a] of Object.entries(node.animate_on ?? {})) {
      if (!['x', 'y', 'rotation'].includes(a?.prop) || reversals(a.keys) < 2) continue;
      const sensitive = hasText(node) || hasHandler(node) || KIND_TEXTY.has(node.node);
      push(out, 'M_SHAKE', sensitive ? 'block' : 'warn', `${ptr}/animate_on/${ev}`, `${node.node} shakes its ${a.prop} on '${ev}'${sensitive ? ' (text or a button: never)' : ''}`, { cause: 'element-shake', remove: sensitive });
    }
  });
  return out;
}

/** The one shake kept: the first on a fail moment that no other shaking moment emits (the cause, not its echo). */
export function pickShakeKeeper(game) {
  const shakes = feedbackActions(game, 'shake').filter((s) => isFailEvent(String(s.on)));
  if (!shakes.length) return null;
  const em = emitGraph(game);
  const emitted = new Set();
  for (const s of shakes) for (const y of em.get(s.on) ?? []) emitted.add(y);
  return shakes.find((s) => !emitted.has(s.on)) ?? shakes[0];
}

/** Pulses over the cap (static: animate_on scale keys on text, or on anything else). */
export function pulseFindings(game) {
  const out = [];
  walkNodes(game?.presentation?.root, (node, ptr) => {
    for (const [ev, a] of Object.entries(node.animate_on ?? {})) {
      if (a?.prop !== 'scale') continue;
      const amp = keysAmp(a.keys);
      const texty = hasText(node);
      const cap = (texty ? MOTION.textScaleMax : MOTION.iconScaleMax) - 1;
      if (amp > cap + 1e-9) push(out, texty ? 'M_TEXT_UNSTABLE' : 'M_PULSE', 'block', `${ptr}/animate_on/${ev}`, `${texty ? 'text' : node.node} pulses to ${(1 + amp).toFixed(2)}× on '${ev}' (cap ${(1 + cap).toFixed(2)}×)`, { cause: 'pulse', cap: 1 + cap });
      if (texty && (a.ms ?? 200) > MOTION.fadeMaxMs) push(out, 'M_TRANSITION_STYLE', 'block', `${ptr}/animate_on/${ev}`, `text pulse on '${ev}' lasts ${a.ms} ms (at most ${MOTION.fadeMaxMs})`, { cause: 'style' });
    }
  });
  return out;
}

/** Text that moves while it should be read: stack reflow, slides; text that flickers or pops in; text shown too briefly. */
export function textFindings(game, msample) {
  const out = [];
  const idx = nodeIndex(game);
  const w = writers(game);
  const seen = new Set();
  const once = (code, ptr, fn) => { const k = `${code}|${ptr}`; if (seen.has(k)) return; seen.add(k); fn(); };
  const W = msample?.runs?.[0]?.frames?.[0]?.W ?? 360, H = msample?.runs?.[0]?.frames?.[0]?.H ?? 640;
  for (const run of msample?.runs ?? []) {
    const tracks = tracksOf(run);
    const frameCount = run.frames.length;
    for (const [key, tr] of tracks) {
      const first = tr[0];
      if (first.virtual) continue;
      const n = msample.nodes[first.id];
      if (!n) continue;
      const ptr = n.ptr;
      const ent = idx.get(ptr);
      if (first.op === 'text') {
        // Moves while the words stay the same.
        let pairs = 0, moves = 0, worst = null;
        for (let i = 1; i < tr.length; i++) {
          const a = tr[i - 1], b = tr[i];
          if (b.fi !== a.fi + 1 || a.text !== b.text) continue;
          pairs++;
          const ca = center(a.box), cb = center(b.box);
          const d = Math.hypot(cb.x - ca.x, cb.y - ca.y);
          if (d > MOTION.moveEps) { moves++; if (!worst || d > worst.d) worst = { d, t: b.t }; }
        }
        if (moves && pairs && moves / pairs <= MOTION.movingShare) {
          const inStack0 = ent?.parents?.some((p) => p.node.node === 'stack');
          // Instances of a list or grid can swap places as items come and go: only the row reflow is judged there.
          if (n.inTemplate && !inStack0) continue;
          const inStack = ent?.parents?.some((p) => p.node.node === 'stack');
          const slides = [ent?.node, ...(ent?.parents ?? []).map((p) => p.node)].some((x) => x && (['x', 'y'].some((k) => x.transition?.[k] != null) || Object.values(x.animate_on ?? {}).some((a) => ['x', 'y'].includes(a?.prop))));
          const cause = slides ? 'slide' : inStack ? 'reflow' : 'jump';
          once('M_TEXT_UNSTABLE', ptr, () => push(out, 'M_TEXT_UNSTABLE', 'block', ptr, `"${clip(first.text)}" ${cause === 'reflow' ? 'jumps sideways when a neighbour in its row changes' : cause === 'slide' ? 'slides while it is read' : 'jumps'} (${worst.d.toFixed(1)} units, ${moves} times in ${run.label})`, { cause, frame: `${run.label}@${(worst.t / 1000).toFixed(2)}s` }));
        }
        // Words that change too often are live (counters, timers): not judged for pops or holding.
        const segs = segments(tr);
        const changes = segs.filter((s, i) => i > 0 && s.text && segs[i - 1].text && s.start === segs[i - 1].end + 1).length;
        const span = (tr.at(-1).t - tr[0].t) / 1000 || 1;
        const live = changes / span > MOTION.liveTextPerS || n.hud || /^[\d\s:.,%/+\-×x]*$/.test(first.text);
        if (live) continue;
        const masked = (t) => String(t).replace(/\d+/g, '#');
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          if (!s.text.trim()) continue;
          // Only numbers changed by a small step, or in a tally or a clock (a countdown, "3/60"): a counter
          // ticking, not new words. A label like "1990s" → "1980s" is new words.
          const ticks = (a, b) => {
            if (masked(a) !== masked(b)) return false;
            if (/[\/:]/.test(a)) return true;
            const na = a.match(/\d+/g) ?? [], nb = b.match(/\d+/g) ?? [];
            return na.every((x, j) => Math.abs(+x - +nb[j]) < 10);
          };
          const prev = segs[i - 1], next = segs[i + 1];
          const tick = (prev && prev.end === s.start - 1 && ticks(prev.text, s.text)) || (next && next.start === s.end + 1 && ticks(s.text, next.text));
          if (tick) continue;
          const dur = (s.end - s.start + 1) * msample.dtMs;
          const bounded = s.start > 0 && s.end < frameCount - 1;
          if (bounded && dur <= MOTION.flickerMs && i > 0 && i < segs.length - 1 && !n.inTemplate) once('M_POP', ptr + '#flicker', () => push(out, 'M_POP', 'block', ptr, `"${clip(s.text)}" shows for ${Math.round(dur)} ms and is gone (flicker)`, { cause: 'flicker', frame: `${run.label}@${(run.frames[s.start].t / 1000).toFixed(2)}s` }));
          else if (bounded && dur < holdMs(s.text) && run.frames[s.end + 1]?.phase === 'playing') once('M_TEXT_HOLD', ptr, () => push(out, 'M_TEXT_HOLD', 'warn', ptr, `"${clip(s.text)}" is up for ${Math.round(dur)} ms; reading it takes about ${holdMs(s.text)} ms (the rules set how long it shows)`, { frame: `${run.label}@${(run.frames[s.start].t / 1000).toFixed(2)}s` }));
          // Pop: new words (or a new text) at full opacity in their first frame.
          if (s.start > 0 && s.opacity0 >= 0.9) {
            const ev = triggerEvents(game, ptr, idx, w);
            once('M_POP', ptr, () => push(out, 'M_POP', 'block', ptr, `"${clip(s.text)}" ${i > 0 && segs[i - 1].end === s.start - 1 ? 'swaps in' : 'appears'} at once, with no fade`, { cause: 'fade-in', events: ev, frame: `${run.label}@${(run.frames[s.start].t / 1000).toFixed(2)}s` }));
          }
        }
      } else if (!n.interactive && ['rect', 'image'].includes(first.op)) {
        // A panel appearing at once.
        const area = (first.box.x1 - first.box.x0) * (first.box.y1 - first.box.y0);
        if (area < MOTION.popPanelArea * W * H || area >= 0.7 * W * H) continue;
        for (let i = 1; i < tr.length; i++) {
          if (tr[i].fi === tr[i - 1].fi + 1 || tr[i].opacity < 0.9) continue;
          const target = fadeTarget(game, ptr, idx);
          once('M_POP', target, () => push(out, 'M_POP', 'block', target, `a ${first.op} panel (${Math.round((100 * area) / (W * H))}% of the screen) appears at once, with no fade`, { cause: 'fade-in', events: triggerEvents(game, target, idx, w), frame: `${run.label}@${(tr[i].t / 1000).toFixed(2)}s` }));
          break;
        }
        if (tr[0].fi > 0 && tr[0].opacity >= 0.9 && run.frames[tr[0].fi - 1]) {
          const target = fadeTarget(game, ptr, idx);
          once('M_POP', target, () => push(out, 'M_POP', 'block', target, `a ${first.op} panel (${Math.round((100 * area) / (W * H))}% of the screen) appears at once, with no fade`, { cause: 'fade-in', events: triggerEvents(game, target, idx, w), frame: `${run.label}@${(tr[0].t / 1000).toFixed(2)}s` }));
        }
      }
    }
  }
  return out;
}

/** The node to fade for a panel: the nearest ancestor (or itself) with a `visible` condition, without handlers. */
export function fadeTarget(game, ptr, idx = nodeIndex(game)) {
  const ent = idx.get(ptr);
  if (!ent) return ptr;
  if (ent.node.visible !== undefined) return ptr;
  for (const p of [...ent.parents].reverse()) if (p.node.visible !== undefined && !hasHandler(p.node)) return p.ptr;
  return ptr;
}

/** Runs of one text in consecutive frames: [{text, start, end (frame indexes), opacity0}]. */
function segments(tr) {
  const out = [];
  for (const s of tr) {
    const last = out.at(-1);
    if (last && last.text === s.text && s.fi === last.end + 1) last.end = s.fi;
    else out.push({ text: s.text, start: s.fi, end: s.fi, opacity0: s.opacity });
  }
  return out;
}

/** Mid-transition overlap: a state change that shows new words on the old state's colours; particles over text. */
export function overlapFindings(game, msample) {
  const out = [];
  const idx = nodeIndex(game);
  const seen = new Set();
  for (const run of msample?.runs ?? []) {
    const tracks = tracksOf(run);
    const byFrame = run.frames;
    for (const [, tr] of tracks) {
      if (tr[0].op !== 'text' || tr[0].virtual) continue;
      for (let i = 1; i < tr.length; i++) {
        const a = tr[i - 1], b = tr[i];
        if (b.fi !== a.fi + 1 || a.text === b.text || !a.text.trim() || !b.text.trim()) continue;
        const c = center(b.box);
        // Containers under the new words whose colour is still on its way (tweening) when they show.
        for (const it of byFrame[b.fi].items) {
          if (it.op === 'text' || it.key === b.key) continue;
          if (!(c.x >= it.box.x0 && c.x <= it.box.x1 && c.y >= it.box.y0 && c.y <= it.box.y1)) continue;
          const later = byFrame[b.fi + 3]?.items.find((x) => x.key === it.key);
          const before = byFrame[a.fi]?.items.find((x) => x.key === it.key);
          if (!later || !before || it.fill === later.fill || before.fill === later.fill) continue;
          const n = msample.nodes[it.id];
          const node = idx.get(n?.ptr)?.node;
          const tprops = ['fill', 'stroke', 'color', 'opacity'].filter((p) => node?.transition?.[p] != null);
          if (!n || !tprops.length || seen.has(n.ptr)) continue;
          seen.add(n.ptr);
          push(out, 'M_TRANSITION_OVERLAP', 'block', n.ptr, `new words ("${clip(b.text)}") show on the old state's colour: the ${it.op}'s ${tprops.join('/')} transition is still running when the next state's labels appear`, { cause: 'carry-over', props: tprops, frame: `${run.label}@${(b.t / 1000).toFixed(2)}s` });
        }
      }
    }
    // Particles (untagged circles the engine adds for feedback bursts) over readable text.
    // The longest unbroken stretch of frames with three or more particles on readable text.
    let over = 0, cur = 0, worstT = null;
    for (const f of run.frames) {
      const texts = f.items.filter((it) => it.op === 'text' && it.opacity > 0.5 && (it.size ?? 0) >= 13 && it.text?.trim());
      const hits = (f.particleBoxes ?? []).filter((p) => texts.some((t) => p.x >= t.box.x0 && p.x <= t.box.x1 && p.y >= t.box.y0 && p.y <= t.box.y1)).length;
      if (hits >= 3) { cur += msample.dtMs; if (cur > over) { over = cur; worstT = f.t; } } else cur = 0;
    }
    if (over > MOTION.particleOverTextMs && !seen.has('#particles')) {
      seen.add('#particles');
      push(out, 'M_TRANSITION_OVERLAP', 'block', '/presentation/feedback', `particles cross readable text for ${Math.round(over)} ms on end (${run.label})`, { cause: 'particles', frame: `${run.label}@${(worstT / 1000).toFixed(2)}s` });
    }
  }
  return out;
}

/** One kind of state change, one style: fades and pulses on one event with different lengths or eases; fades that linger. */
export function styleFindings(game) {
  const out = [];
  const byEvent = new Map();
  const trans = [];
  walkNodes(game?.presentation?.root, (node, ptr) => {
    for (const [ev, a] of Object.entries(node.animate_on ?? {})) {
      if (!a || !['opacity', 'scale'].includes(a.prop)) continue;
      const k = `${ev}|${a.prop}`;
      if (!byEvent.has(k)) byEvent.set(k, []);
      // A long many-key opacity animation (fade in, hold, fade out) is a caption's life, not a fade.
      const hold = a.prop === 'opacity' && (a.keys?.length ?? 0) > 2 && (a.ms ?? 200) >= 1000;
      if (hold) continue;
      byEvent.get(k).push({ ptr: `${ptr}/animate_on/${ev}`, ms: a.ms ?? 200, ease: a.ease ?? 'linear', texty: hasText(node), hold });
    }
    if (node.transition?.opacity != null) {
      const t = node.transition.opacity;
      trans.push({ ptr: `${ptr}/transition/opacity`, ms: typeof t === 'number' ? t : t.ms ?? 150, texty: hasText(node) });
    }
  });
  for (const [k, list] of byEvent) {
    const [ev, prop] = k.split('|');
    const ms = list.map((x) => x.ms);
    const eases = new Set(list.map((x) => x.ease));
    if (list.length > 1 && (Math.max(...ms) / Math.max(1, Math.min(...ms)) > MOTION.styleRatio || eases.size > 1)) {
      push(out, 'M_TRANSITION_STYLE', 'block', list[0].ptr, `'${ev}' ${prop === 'opacity' ? 'fades' : 'pulses'} ${list.length} things in ${[...new Set(ms)].join(', ')} ms (${[...eases].join(', ')}): one state change, one style`, { cause: 'style', event: ev, prop });
    }
    for (const x of list) if (prop === 'opacity' && x.texty && x.ms > MOTION.fadeMaxMs && !x.hold) push(out, 'M_TRANSITION_STYLE', 'block', x.ptr, `a text fade of ${x.ms} ms on '${ev}' lingers (at most ${MOTION.fadeMaxMs})`, { cause: 'style', event: ev, prop });
  }
  const tms = trans.map((t) => t.ms);
  if (trans.length > 1 && Math.max(...tms) / Math.max(1, Math.min(...tms)) > 2 * MOTION.styleRatio) {
    push(out, 'M_TRANSITION_STYLE', 'block', trans[0].ptr, `opacity transitions run ${[...new Set(tms)].join(', ')} ms: one look, one fade`, { cause: 'style', prop: 'transition' });
  }
  return out;
}

const clip = (s) => { s = String(s ?? '').replace(/\n/g, ' '); return s.length > 28 ? s.slice(0, 27) + '…' : s; };

/** Every motion finding for a game and its motion sample. */
export function motionFindings(game, msample) {
  return [...shakeFindings(game, msample), ...pulseFindings(game), ...textFindings(game, msample), ...overlapFindings(game, msample), ...styleFindings(game)];
}
