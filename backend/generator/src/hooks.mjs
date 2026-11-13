// The server-side hooks the Studio's compose takes as its 4th argument (docs/HARNESS_V2.md, "Picture art" and
// "Layout"). They are functions, so they can't ride in the bundle or in the JSON arguments.
//
//   image, decode, deflate   picture art: muse-image-1.0 draws the pictures behind the same asset ids
//                            (authoring/expander/image-art.mjs inside the bundle). Only with GENERATOR_IMAGE_ART=1.
//   fixLayout, layoutCheck   presentation-only layout fixes before each gate, and the layout lint after
//                            (authoring/expander/layout-fix.mjs, authoring/playtest/layout-check.mjs). Without
//                            Chrome (the image has none; GENERATOR_LAYOUT_PIXELS=1 asks for it) only the structural
//                            fixes run. GENERATOR_LAYOUT=0 turns both off.
//
// The authoring modules are not copied twice: the image copies them into /app/authoring (GENERATOR_AUTHORING_DIR),
// and in development they are read from the repository.

import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const MODULES = { codec: 'expander/image-codec.mjs', fix: 'expander/layout-fix.mjs', check: 'playtest/layout-check.mjs' };
// Everything those import (layout-check loads frame-render.mjs even when Chrome is off). The Dockerfile copies this list.
export const AUTHORING_FILES = ['expander/image-codec.mjs', 'expander/layout-fix.mjs', 'expander/engine.mjs', 'playtest/layout-check.mjs', 'playtest/bots.mjs', 'playtest/frame-render.mjs'];

const off = (v) => ['0', 'off', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase());
const on = (v) => ['1', 'on', 'true', 'yes'].includes(String(v ?? '').trim().toLowerCase());

/** Picture art through compose's hooks: on only when GENERATOR_IMAGE_ART is 1. */
export const pictureArtOn = (env = process.env) => on(env.GENERATOR_IMAGE_ART);
/** Layout fixes and lint: on unless GENERATOR_LAYOUT is 0. */
export const layoutOn = (env = process.env) => !off(env.GENERATOR_LAYOUT);

/** The authoring folder: GENERATOR_AUTHORING_DIR, ./authoring next to the server (the image), else the repository's. */
export function findAuthoring(env = process.env) {
  const here = dirname(fileURLToPath(import.meta.url));
  const has = (dir) => Object.values(MODULES).every((m) => existsSync(join(dir, m)));
  for (const dir of [env.GENERATOR_AUTHORING_DIR, join(here, '..', 'authoring')].filter(Boolean)) if (has(dir)) return dir;
  for (let dir = here; ; dir = dirname(dir)) {
    if (has(join(dir, 'authoring'))) return join(dir, 'authoring');
    if (dir === parse(dir).root) return null;
  }
}

const inflate = (b) => new Uint8Array(zlib.inflateSync(b));
const deflate = (b) => new Uint8Array(zlib.deflateSync(b, { level: 9 }));

/**
 * The hooks for one compose call. muse: the MuseClient (its image() returns PNG, so decode needs no WebP).
 * Returns {hooks, notes}: hooks is null when nothing is on; notes say what was left out and why (for the log).
 */
export async function composeHooks({ muse, env = process.env, signal } = {}) {
  const hooks = {};
  const notes = [];
  const dir = findAuthoring(env);
  const load = async (key) => import(pathToFileURL(join(dir, MODULES[key])).href);
  if (pictureArtOn(env) && typeof muse?.image === 'function') {
    if (!dir) notes.push('picture art off: the authoring modules are missing');
    else {
      const { decodePNG, isPNG } = await load('codec');
      hooks.image = async ({ prompt, reference = null }) => {
        if (signal?.aborted) throw new Error('cancelled');
        const r = await muse.image({ prompt, size: '1024x1024', guide: reference ?? null });
        return { bytes: new Uint8Array(r.png) };
      };
      hooks.decode = (bytes) => {
        if (!isPNG(bytes)) throw new Error('not a PNG (the generator asks Muse for PNG)');
        return decodePNG(bytes, inflate);
      };
      hooks.deflate = deflate;
    }
  }
  if (layoutOn(env)) {
    if (!dir) notes.push('layout off: the authoring modules are missing');
    else {
      try {
        const [{ fixLayout }, { layoutCheck }] = await Promise.all([load('fix'), load('check')]);
        // Chrome measures only on request: a crashed Chrome backs off with a blocking wait, which would stall the server.
        const pixels = on(env.GENERATOR_LAYOUT_PIXELS) ? null : false;
        hooks.fixLayout = (game, opts = {}) => fixLayout(game, { ...opts, pixels });
        hooks.layoutCheck = (gameJson, opts = {}) => layoutCheck(gameJson, { ...opts, pixels });
      } catch (e) {
        notes.push('layout off: ' + String(e?.message ?? e).slice(0, 200));
      }
    }
  }
  return { hooks: Object.keys(hooks).length ? hooks : null, notes };
}
