// Parallel lanes for one compose job: a bounded limiter on Muse calls (about 4 at once), a per-call timeout, and a
// timeline of every stage (lane, stage, start and end in ms from the job's start) for stats.timeline, so the
// pitch can show which work ran side by side. Also the content merge for the harness's answer bank and the
// art lane that starts the plan's pictures as soon as the job starts.

import { backdropPrompt, spritePrompt } from './art.mjs';

export const MUSE_CONCURRENCY = 4;

/** limiter(n)(fn): runs at most n fns at once, in arrival order. */
export function limiter(n = MUSE_CONCURRENCY) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

/** withTimeout(promise, ms, what): rejects after ms (0 = no cap). */
export function withTimeout(p, ms, what = 'call') {
  if (!(ms > 0)) return p;
  let t;
  return Promise.race([p, new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms); })]).finally(() => clearTimeout(t));
}

/** A job's timeline. */
export class Timeline {
  constructor(t0 = Date.now()) { this.t0 = t0; this.lanes = []; }
  now() { return Date.now() - this.t0; }
  add(lane, stage, startMs, endMs, note) { this.lanes.push({ lane, stage, start_ms: startMs, end_ms: endMs, ...(note ? { note: String(note).slice(0, 160) } : {}) }); }
  async run(lane, stage, fn) {
    const s = this.now();
    try { return await fn(); } finally { this.add(lane, stage, s, this.now()); }
  }
}

/**
 * The Muse client the job uses: every text and image call goes through the limiter and onto the timeline (text
 * calls on the compose lane, pictures on the art lane). prestarted image calls (art lane, below) are handed back
 * instead of asking twice.
 */
export function laneMuse(muse, timeline, { limit = limiter(), prestarted = null } = {}) {
  const m = Object.create(muse);
  if (typeof muse.chatJSON === 'function') {
    m.chatJSON = (body, purpose = '') => timeline.run('compose', purpose || 'muse ' + String(body?.model ?? 'text'), () => limit(() => muse.chatJSON(body)));
  }
  if (typeof muse.image === 'function') {
    m.image = (body) => {
      const key = imageKey(body);
      const early = prestarted?.get(key);
      if (early) { prestarted.delete(key); return early; }
      return timeline.run('art', 'picture', () => limit(() => muse.image(body)));
    };
  }
  return m;
}

const imageKey = (b) => `${b?.size ?? '1024x1024'}\n${b?.guide ? 'guided' : ''}\n${b?.prompt ?? ''}`;

/**
 * The art lane: start the plan's pictures (spec.visual, render "image") right away, alongside compose, with the
 * same prompts the art step (art.mjs paintArt) will ask for; paintArt then gets them without waiting. The backdrop
 * (the biggest picture, always used) starts at once unless it is drawn over the game's layout frame; sprites only
 * with sprites: true, since paintArt paints only the names the game has.
 */
export function startArt(visual, muse, timeline, { limit, guided = false, sprites = false, timeoutMs = 150000 } = {}) {
  const early = new Map();
  if (!visual || typeof visual !== 'object' || typeof muse?.image !== 'function') return early;
  const jobs = [];
  if (!guided && visual.backdrop?.render === 'image' && String(visual.backdrop.prompt ?? '').trim()) {
    jobs.push({ id: 'backdrop', body: { prompt: backdropPrompt(visual, false), size: '1024x1536', guide: null } });
  }
  // Sprites (opt-in, sprites: true) are painted only for names the game really has, so by default they wait for it.
  if (sprites) {
    for (const a of Array.isArray(visual.assets) ? visual.assets : []) {
      if (a?.render === 'image' && a.id) jobs.push({ id: a.id, body: { prompt: spritePrompt(visual, a), size: '1024x1024', guide: null } });
    }
  }
  for (const j of jobs) {
    const p = timeline.run('art', 'picture ' + j.id, () => limit(() => withTimeout(muse.image(j.body), timeoutMs, 'picture ' + j.id)));
    p.catch(() => {}); // a failure is reported when paintArt asks for it
    early.set(imageKey(j.body), p);
  }
  return early;
}

export const BANK_MARK = '@answer_bank';

/**
 * The content merge for the harness's answer bank (context.content): Muse writes "@answer_bank" where the bank
 * goes, and the reply gets the whole bank in its place; a prompt that shows Muse its own game gets the mark back,
 * so the bank is never copied through Muse.
 */
export function bankMerge(context) {
  const line = typeof context?.content?.ta_answers === 'string' ? context.content.ta_answers : '';
  if (!line) return null;
  const quoted = JSON.stringify(line);
  const markQ = JSON.stringify(BANK_MARK);
  // the bank as it appears inside a JSON string (once or twice escaped)
  const escaped = JSON.stringify(quoted).slice(1, -1);
  const markE = JSON.stringify(markQ).slice(1, -1);
  let merged = 0;
  return {
    get merged() { return merged; },
    toMuse: (text) => (typeof text === 'string' ? text.split(quoted).join(markQ).split(escaped).join(markE) : text),
    fromMuse: (text) => {
      if (typeof text !== 'string' || !text.includes(BANK_MARK)) return text;
      const n = text.split(markQ).length - 1;
      merged += n;
      return text.split(markQ).join(quoted);
    },
  };
}
