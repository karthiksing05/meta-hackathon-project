// Muse makes a microgame. The whole pipeline (Muse's prompts, gold examples, expand and validate, repair,
// the five-bot gate, the quality check and one polish round) lives in the Studio bundle, so the app and
// the server run the same code and prompt work happens once (docs/BUBBLES.md 7.12). This file only
// connects it to Muse and to the job: it passes Muse in as a function, stops when the job is cancelled,
// and stamps a revision's lineage.

export { summarize } from './events.mjs';

export class GenerationError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'GenerationError';
    this.issues = issues;
  }
}

const slug = (text) => {
  let out = String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (out.length > 32) out = out.slice(0, 32).replace(/-+$/, '');
  return out;
};
const suffix = () => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
};

/**
 * compose({request, brief, base?, remixOf?, level?}, {muse, studio, model, onEvent, signal})
 *   -> {manifest, stats, bots, gate, quality}
 * base: the stored manifest of the game being changed (it must carry content.authoring_json). The result is
 * always a new game: a fresh id, `lineage.remix_of` set to remixOf, and `chain.index` set to level.
 * Throws GenerationError when the game never validates, or whatever Muse or the page threw.
 */
export async function compose({ request, brief, base = null, remixOf = null, level = null }, { muse, studio, model = 'muse-wonder-1.0', onEvent = () => {}, signal }) {
  const ask = async (system, user) => {
    if (signal?.aborted) throw new GenerationError('The job was cancelled or ran out of time.');
    const r = await muse.chatJSON({ model, system, user });
    return { content: r.content, model: r.model };
  };
  const out = await studio.compose({ request, brief, base }, ask, (e) => onEvent(JSON.parse(JSON.stringify(e))));
  const m = out.manifest;
  if (base) {
    m.id = `mg-${slug(m.title ?? base.title ?? 'game') || 'game'}-${suffix()}`; // never the base game's own id
    if (remixOf) m.lineage = { ...(m.lineage ?? {}), remix_of: String(remixOf) };
    if (level && level > 1) {
      const was = base.chain ?? {};
      m.chain = {
        id: was.id ?? `chain-${slug(was.title ?? base.title ?? 'game') || 'game'}`,
        index: level,
        title: was.title ?? base.title ?? m.title ?? 'Game',
        prev: base.id ?? null, // the manifest id of the level it follows
        next: null,
      };
    }
  }
  return out;
}
