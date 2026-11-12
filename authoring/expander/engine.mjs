// Loads Artem's microgame engine (Rust → WASM) for validation and playtests.
// The engine lives in `engine/` (branch `rust-engine` until it lands on beta-version). Point at a
// built copy with MG_ENGINE_DIR=<path to engine/>; build it there with `engine/build-wasm.sh`.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function engineDir() {
  const candidates = [process.env.MG_ENGINE_DIR, resolve(here, '../../engine')].filter(Boolean);
  for (const c of candidates) if (existsSync(join(c, 'web/pkg/microgame.wasm'))) return c;
  throw new Error(
    `Can't find a built microgame engine. Set MG_ENGINE_DIR to an engine/ folder that has web/pkg/microgame.wasm (run engine/build-wasm.sh there). Looked in: ${candidates.join(', ')}`,
  );
}

let cached;
export async function loadEngine() {
  if (cached) return cached;
  const dir = engineDir();
  const mod = await import(pathToFileURL(join(dir, 'web/microgame.js')).href);
  const engine = await mod.Microgame.init(readFileSync(join(dir, 'web/pkg/microgame.wasm')));
  cached = { engine, mod, dir };
  return cached;
}
