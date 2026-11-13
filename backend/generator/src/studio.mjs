// Loads the same two bundles the app's hidden web view loads (the engine, and the Studio API:
// catalog, expand + validate, the bot gate and the wrapper) into a bare Node vm context. They are
// plain classic scripts with the WebAssembly engine embedded, so nothing is built here.
// Mirrors MicrogameStudio.swift: JSON text in, JSON text out.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const FILES = ['bubble-kit-microgame-engine.js', 'microgame-studio.js'];

export function loadStudio(dir) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, performance });
  for (const f of FILES) {
    const file = join(dir, f);
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
  };
}
