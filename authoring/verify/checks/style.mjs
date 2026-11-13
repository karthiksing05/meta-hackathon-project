// S_* style checks: an adapter for the UI kit's static style check (style-check.mjs), loaded from
// wherever it lands. It checks tokens and the tree before anything runs (type scale, target size,
// token contrast); the measured L_* codes are the drawn result. Findings with severity "error" or
// "block" block; the rest warn. Skipped (and listed as skipped) until the module exists.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { finding } from '../registry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const CANDIDATES = ['playtest/style-check.mjs', 'expander/style-check.mjs', 'harness/style-check.mjs', 'kit/style-check.mjs', 'ui-kit/style-check.mjs'];

let mod;
async function load() {
  if (mod !== undefined) return mod;
  const file = CANDIDATES.map((c) => join(root, c)).find((f) => existsSync(f));
  mod = file ? await import(pathToFileURL(file).href) : null;
  return mod;
}

export const check = {
  id: 'style',
  family: 'S',
  needs: ['game'],
  codes: {},
  async available() { return !!(await load()); },
  async run(ctx) {
    const m = await load();
    if (!m) return [];
    const fn = m.styleCheck ?? m.checkStyle ?? m.check?.run ?? m.default;
    if (typeof fn !== 'function') return [];
    const res = await fn(ctx.game, { authoring: ctx.built?.authoring, manifest: ctx.built?.manifest });
    const list = Array.isArray(res) ? res : res?.findings ?? [];
    return list.filter((f) => /^S_/.test(f?.code ?? '')).map((f) => finding(f.code, {
      severity: ['error', 'block'].includes(f.severity) ? 'block' : 'warn',
      node: f.node ?? f.path ?? null, frame: null, message: f.message ?? f.detail ?? f.code, hint: f.hint ?? f.fix ?? null,
    }));
  },
};
