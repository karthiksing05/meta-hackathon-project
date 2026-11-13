// Loads the same two bundles the app's hidden web view loads (the engine, and the Studio API:
// catalog, expand + validate, the bot gate and the wrapper) into a bare Node vm context. They are
// plain classic scripts with the WebAssembly engine embedded, so nothing is built here.
// Mirrors MicrogameStudio.swift: JSON text in, JSON text out.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// There is one copy of each bundle, in the app's folders. The Docker image copies both into /app/vendor
// (GENERATOR_VENDOR_DIR); in development they are read from the repository.
const BUNDLES = [
  ['bubble-kit-microgame-engine.js', 'FacebookClone/Bubbles/Runtime/web/bubble-kit-microgame-engine.js'],
  ['microgame-studio.js', 'FacebookClone/Bubbles/Studio/web/microgame-studio.js'],
];

/** The two bundle files: from GENERATOR_VENDOR_DIR (or ./vendor next to the server) when both are there, else the repo. */
export function findBundles(env = process.env) {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const dir of [env.GENERATOR_VENDOR_DIR, join(here, '..', 'vendor')].filter(Boolean)) {
    const files = BUNDLES.map(([name]) => join(dir, name));
    if (files.every(existsSync)) return files;
  }
  for (let dir = here; ; dir = dirname(dir)) {
    const files = BUNDLES.map(([, rel]) => join(dir, rel));
    if (files.every(existsSync)) return files;
    if (dir === parse(dir).root) break;
  }
  throw new Error('Cannot find the engine and Studio bundles. Set GENERATOR_VENDOR_DIR, or run inside the repository (' + BUNDLES.map(([, r]) => r).join(', ') + ').');
}

export function loadStudio(files = findBundles()) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, performance });
  for (const file of files) {
    vm.runInContext(readFileSync(file, 'utf8'), context, { filename: file });
  }
  const S = context.MicrogameStudio;
  if (!S) throw new Error('microgame-studio.js did not define MicrogameStudio');
  let catalog;
  return {
    /** Fragments, looks, the engine catalog and ready-made prompt text. Cached. */
    catalog() {
      catalog ??= JSON.parse(S.catalog());
      return catalog;
    },
    /** Muse's reply text (fences and prose around the object are fine) -> the expansion. */
    expand(text) {
      const r = JSON.parse(S.expand(text));
      if (typeof r.ok !== 'boolean') throw new Error("expand didn't return a result");
      return r;
    },
    /** The five-bot playtest on the playtest copy of the game (exact JSON text). */
    async gate(gameJSON, seed = 1) {
      const g = JSON.parse(await S.gate(gameJSON, seed));
      if (!Array.isArray(g.runs)) throw new Error("gate didn't return runs");
      return g;
    },
    /** The game and its authoring manifest, as exact text, wrapped as a microgame manifest. */
    wrap(options) {
      return JSON.parse(S.wrap(JSON.stringify(options)));
    },
    /**
     * Replays a run's input log (microgame-log/1) against the exact game text and checks what it claims:
     * {ok, game_hash_ok, steps, recomputed: {state_hash, phase, score, time_ms}, claimed, problems}.
     */
    /** The Studio bundle's API version (3 and up take the harness context and Muse call options themselves). */
    version: Number(S.version) || 0,
    /** The engine bundle's global, for tests that play a game to make a log. */
    engine: () => context.MicrogameEngine,
    verify(gameText, log, names) {
      const E = context.MicrogameEngine;
      if (!E?.verify) throw new Error('the engine bundle has no verify(); update bubble-kit-microgame-engine.js');
      const text = typeof log === 'string' ? log : JSON.stringify(log);
      // names (optional): the end-state variables to report as `result`; without them the engine reports every one
      const r = Array.isArray(names) && names.length ? E.verify(String(gameText), text, names) : E.verify(String(gameText), text);
      return JSON.parse(JSON.stringify(r));
    },
    /**
     * The whole pipeline (draft, repair, gate, quality check, polish, wrap), from the bundle.
     * args: {request, brief, base?}; ask(system, user, purpose) -> {content, model}; onEvent gets progress events.
     * hooks (optional, src/hooks.mjs): {image, decode, deflate, fixLayout, layoutCheck}, server-side functions.
     * Resolves to {manifest, stats, bots, gate, quality}.
     */
    async compose(args, ask, onEvent, hooks = null) {
      if (typeof S.compose !== 'function') throw new Error('microgame-studio.js has no compose(); update the Studio bundle');
      return JSON.parse(await (hooks ? S.compose(JSON.stringify(args), ask, onEvent, hooks) : S.compose(JSON.stringify(args), ask, onEvent)));
    },
  };
}
