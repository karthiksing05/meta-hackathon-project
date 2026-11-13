// Plays a microgame with the Studio's playtest bots and keeps each run's real input log (microgame-log/1), so the
// server can replay it and rank the replayed score. Same engine bundle, bot roster logic and action space as the gate
// (FacebookClone/Bubbles/Studio/web/microgame-studio.js, playtest/bots.mjs); only the run loop is here, because the
// gate keeps its logs to itself.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { findBundles } from '../../backend/generator/src/studio.mjs';

let cached;

/** The engine and the bots module, loaded once into a bare vm context. */
export function loadBots() {
  if (cached) return cached;
  const context = vm.createContext({ console, setTimeout, clearTimeout, performance });
  for (const file of findBundles()) {
    let text = readFileSync(file, 'utf8');
    // expose the bundle's module table (read-only use) so the bot helpers can be called directly
    if (file.endsWith('microgame-studio.js')) text = text.replace('const __m = Object.create(null);', 'const __m = Object.create(null); root.__demoSeedModules = __m;');
    vm.runInContext(text, context, { filename: file });
  }
  const engine = context.MicrogameEngine.getEngine();
  const bots = context.__demoSeedModules?.['playtest/bots.mjs'];
  if (!engine || !bots) throw new Error('could not load the engine or the playtest bots from the bundles');
  cached = { engine, bots, verify: (text, log) => JSON.parse(JSON.stringify(context.MicrogameEngine.verify(text, log))) };
  return cached;
}

/**
 * One bot run on the exact game text. skill 0-1 (how often it looks ahead), botSeed picks its random choices.
 * Returns {phase, score, timeMs, seconds, log (text)} or null when the run errored.
 */
export function playRun(gameText, { seed, skill, botSeed, maxSeconds = 150 }) {
  const { engine, bots: B } = loadBots();
  const profile = B.gateProfile(null);
  const sources = B.inputSources(B.gameObject(gameText));
  const bot = { label: 'demo', skill, botSeed, seedOffset: 0 };
  const rng = B.mulberry32(botSeed);
  const base = B.decisionBase(bot, profile);
  const maxSteps = Math.round((maxSeconds * 1000) / B.DT);
  const value = (p) => {
    const st = p.status();
    if (st.phase === 'won') return 1e9 - st.time_ms;
    if (st.phase === 'lost') return -1e9 + st.time_ms;
    let progress;
    try { progress = B.asObject(p.state()).__progress; } catch { /* no state */ }
    return typeof progress === 'number' ? progress : st.score;
  };
  let g;
  try {
    g = engine.load(gameText, seed);
    let steps = 0, next = 0;
    while (steps < maxSteps && g.phase() === 'playing') {
      if (steps >= next) {
        const cands = B.candidatesFor(B.asObject(g.frameJSON()), sources, rng, typeof g.hitTargets === 'function' ? g.hitTargets() : null, sources.text ? B.textCandidates(g, rng) : null);
        let choice;
        if (rng() < skill) {
          let best = -Infinity;
          for (const c of cands) {
            const probe = g.fork();
            try {
              B.apply(probe, c);
              for (let i = 0; i < B.LOOKAHEAD_STEPS && probe.phase() === 'playing'; i++) probe.step(B.DT);
              const v = value(probe);
              if (v > best) { best = v; choice = c; }
            } finally {
              probe.dispose();
            }
          }
        } else {
          choice = cands[Math.floor(rng() * cands.length)];
        }
        if (choice && choice.kind !== 'noop') B.apply(g, choice);
        next = steps + Math.max(1, base + Math.round((rng() * 2 - 1) * base * 0.15)) + B.typingSteps(choice ?? { kind: 'noop' });
      }
      g.step(B.DT);
      steps++;
    }
    const st = g.status();
    const log = JSON.stringify(g.log());
    return { phase: st.phase, score: Math.round(st.score ?? 0), timeMs: Math.round(st.time_ms ?? 0), seconds: (st.time_ms ?? 0) / 1000, log };
  } catch (e) {
    return null;
  } finally {
    try { g?.dispose(); } catch { /* ignore */ }
  }
}

/** The game text inside a microgame manifest (what the server replays logs against). */
export function gameTextOf(manifest) {
  const t = manifest?.content?.game_json;
  if (typeof t !== 'string' || !t) throw new Error('not a microgame manifest (no content.game_json)');
  return t;
}
