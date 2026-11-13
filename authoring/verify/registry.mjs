// The verifier's registry: every check and every finding code it can emit.
//
// A check is {id, family, codes: {CODE: {severity: 'block' | 'warn', title, hint}}, needs: [...],
// run(ctx) → findings}. `needs` names what the check reads from the context: 'frames' (the dense
// sample and its Chrome measures), 'game' (the flat game object), 'built' (manifest, authoring,
// game), 'requirements'. A check whose needs aren't met is skipped and listed in the report.
//
// Built-in checks live in ./checks/. Any other module dropped into ./checks/ that exports `check`
// (one) or `checks` (a list) is loaded too, so a new check plugs in without touching verify.mjs.
//
// Code families (prefix → owner):
//   L_  layout, measured on drawn frames        (checks/layout.mjs, checks/targets.mjs)
//   S_  style tokens and the tree, before play  (the UI kit's style-check.mjs, via checks/style.mjs)
//   R_  the person's requirements               (requirements-check.mjs, via checks/requirements.mjs)
//   F_  fill: bleed bands, background, HUD band (fill-check.mjs, via checks/fill.mjs)
//   V_  visual identity (V_SPRITE_DUP: two different things drawn with the same sprite)
//                                               (reserved for the sprite-distinctness check)

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Code prefixes held for checks other agents are adding; a check must use its own family's prefix. */
export const FAMILIES = {
  L: 'layout on drawn frames',
  S: 'style tokens and tree',
  R: 'requirements',
  F: 'fill (checks/fill.mjs → playtest/fill-check.mjs)',
  V: 'visual identity (reserved: V_SPRITE_DUP)',
};

const checks = new Map();
const codes = new Map();

/** Adds a check. Re-registering an id replaces it (tests swap checks in). */
export function register(check) {
  if (!check?.id || typeof check.run !== 'function') throw new Error('a check needs an id and run()');
  for (const [code, info] of Object.entries(check.codes ?? {})) {
    if (!/^[A-Z]+_[A-Z0-9_]+$/.test(code)) throw new Error(`bad code name ${code}`);
    if (!['block', 'warn'].includes(info.severity)) throw new Error(`${code}: severity must be block or warn`);
    const prev = codes.get(code);
    if (prev && prev.check !== check.id) throw new Error(`${code} is already owned by check ${prev.check}`);
    codes.set(code, { ...info, check: check.id });
  }
  checks.set(check.id, { needs: [], family: check.id, ...check });
  return check;
}

export function unregister(id) {
  checks.delete(id);
  for (const [code, info] of codes) if (info.check === id) codes.delete(code);
}

export const allChecks = () => [...checks.values()].sort((a, b) => a.id.localeCompare(b.id));
export const codeInfo = (code) => codes.get(code) ?? null;
export const allCodes = () => Object.fromEntries([...codes.entries()].sort(([a], [b]) => a.localeCompare(b)));

let loaded = null;
/** Loads ./checks/*.mjs once (built-ins and plug-ins). */
export async function loadChecks() {
  if (loaded) return loaded;
  loaded = (async () => {
    const dir = join(here, 'checks');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs') && !x.startsWith('test-')).sort()) {
      const mod = await import(pathToFileURL(join(dir, f)).href);
      for (const c of [mod.check, ...(mod.checks ?? [])].filter(Boolean)) register(c);
    }
    return allChecks();
  })();
  return loaded;
}

/**
 * A finding in the one shape every check returns:
 * {code, severity, node (JSON pointer or null), frame (frame key or null), message, hint, ...extra}.
 * Severity defaults to the code's registered severity.
 */
export function finding(code, { severity, node = null, frame = null, message, hint, ...extra }) {
  const info = codes.get(code);
  return { code, severity: severity ?? info?.severity ?? 'warn', node, frame, message, hint: hint ?? info?.hint ?? null, ...extra };
}
