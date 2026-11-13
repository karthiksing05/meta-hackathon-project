// The art step (draft, Bayan): after a game passes the gate, Muse Image paints the assets the planner's visual
// stage marked "image" (spec.visual, backend/internal/harness/visual.go), and they replace the stand-in SVGs
// compose drew under the same sprite names.
//
//   backdrop  one 1024x1536 painting from the visual stage's prompt (+ the game's real layout when a renderer
//             is passed in) -> centre-cropped to 360x640 -> JPEG
//   sprites   one 1024x1024 painting per asset, the subject alone on flat green -> keyed out, cropped to the
//             subject -> at most 128 px -> PNG with alpha
//
// Gameplay isn't touched, so the gate isn't rerun; the game is expanded and validated again. Any failure keeps
// that asset's SVG, and a failed expansion keeps the whole game as compose made it. GENERATOR_IMAGE_ART=0 is the
// kill switch.

import { decodePNG, cover, cutOut, fit, encodeJPEG, encodePNG, dataURI } from './pixels.mjs';

export const SPRITE_MAX_PX = 128;
export const ART_BUDGET = 192 * 1024 * 0.95; // authoring/expander/svg.mjs SVG_LIMITS.art_bytes, with headroom

export const imageArtOn = (env = process.env) => !['0', 'off', 'false'].includes(String(env.GENERATOR_IMAGE_ART ?? '').trim().toLowerCase());

/** The image-model prompt for one sprite: the visual stage's description plus what the cut-out needs. */
export function spritePrompt(visual, a) {
  return [
    String(a.prompt ?? '').trim(),
    visual.style ? `Style: ${visual.style}` : '',
    `Exactly one ${a.depicts || a.id}, whole and centred, filling most of the square, seen straight on like a game sprite, with a clear silhouette that still reads at ${Math.max(24, Number(a.play_px) || 64)} pixels.`,
    'Paint it on a perfectly flat, pure green (#00FF00) background so it can be cut out, and keep green out of the subject itself.',
    'No cast shadow, no ground, no other objects, no scenery, no text, letters or numbers, no border or frame.',
  ].filter(Boolean).join('\n');
}

/** The image-model prompt for the backdrop. */
export function backdropPrompt(visual, withGuide) {
  const l = visual.layout ?? {};
  const quiet = Array.isArray(l.quiet) && l.quiet.length ? l.quiet.join('; ') : 'the middle of the screen';
  return [
    String(visual.backdrop?.prompt ?? '').trim(),
    visual.style ? `Style: ${visual.style}` : '',
    visual.scene ? `Scene: ${visual.scene}` : '',
    'This is the full-screen background of a portrait phone game, about 9:16 (the sides get cropped, so keep anything important in the middle 85% of the width).',
    `Keep these areas plain and low in detail: ${quiet}.${l.hud ? ` The score and timer sit ${l.hud}.` : ''}${l.controls ? ` The controls sit ${l.controls}.` : ''}`,
    'Only the setting: no characters, creatures, game pieces, pickups, text, letters, numbers, buttons, frames or UI.',
    withGuide ? "The attached image is this game's actual screen with placeholder shapes. Compose around it: keep detail away from where its pieces, text and buttons are, and leave its shapes and text out of the painting." : '',
  ].filter(Boolean).join('\n');
}

const bytesOf = (s) => (typeof s === 'string' ? Buffer.byteLength(s) : 0);
function otherArtBytes(art, replaced) {
  let n = 0;
  if (!replaced.has('backdrop')) n += bytesOf(art.backdrop?.svg ?? art.backdrop?.image);
  for (const [k, s] of Object.entries(art.sprites ?? {})) {
    if (replaced.has(k)) continue;
    n += Array.isArray(s?.svg) ? s.svg.reduce((t, x) => t + bytesOf(x), 0) : bytesOf(s?.svg ?? s?.image);
  }
  return n;
}

/**
 * paintArt({manifest, visual, muse, studio, renderFrame?, onEvent?, signal?}) -> {manifest, report}
 * renderFrame(manifest) -> PNG Buffer | null: the game's layout with placeholder shapes, given to the backdrop
 * painter as a guide. The server has no renderer yet, so it passes none.
 */
export async function paintArt({ manifest, visual, muse, studio, renderFrame = null, onEvent = () => {}, signal } = {}) {
  const started = Date.now();
  const report = { applied: false, painted: [], kept: [], seconds: 0, bytes: 0, calls: [] };
  const done = (m) => { report.seconds = Math.round((Date.now() - started) / 100) / 10; return { manifest: m, report }; };
  if (!visual || typeof visual !== 'object' || typeof muse?.image !== 'function') return done(manifest);
  let authoring;
  try { authoring = JSON.parse(manifest.content.authoring_json); } catch { report.error = 'no authoring manifest'; return done(manifest); }
  const art = authoring.art ?? {};
  const sprites = art.sprites ?? {};

  // What to paint: the backdrop, and every "image" asset the game draws under that name.
  const jobs = [];
  if (visual.backdrop?.render === 'image' && String(visual.backdrop.prompt ?? '').trim()) jobs.push({ id: 'backdrop', kind: 'backdrop' });
  for (const a of Array.isArray(visual.assets) ? visual.assets : []) {
    if (a?.render !== 'image') continue;
    if (!sprites[a.id]) { report.kept.push({ id: a.id, why: 'the game has no sprite by that name' }); continue; }
    jobs.push({ id: a.id, kind: 'sprite', asset: a });
  }
  if (!jobs.length) return done(manifest);

  let guide = null;
  if (renderFrame && jobs.some((j) => j.kind === 'backdrop')) {
    try { guide = await renderFrame(manifest); } catch (e) { report.kept.push({ id: 'layout', why: 'no layout frame: ' + (e?.message ?? e) }); }
  }
  report.guided = !!guide;
  onEvent({ kind: 'painting', count: jobs.length, summary: `Muse is painting ${jobs.length} ${jobs.length === 1 ? 'piece' : 'pieces'}` });

  // Paint everything at once; each result is decoded and cut out on arrival.
  const results = await Promise.allSettled(jobs.map(async (j) => {
    if (signal?.aborted) throw new Error('cancelled');
    const prompt = j.kind === 'backdrop' ? backdropPrompt(visual, !!guide) : spritePrompt(visual, j.asset);
    const r = await muse.image({ prompt, size: j.kind === 'backdrop' ? '1024x1536' : '1024x1024', guide: j.kind === 'backdrop' ? guide : null });
    report.calls.push({ id: j.id, model: r.model, seconds: Math.round(r.seconds * 10) / 10 });
    const img = decodePNG(r.png);
    if (j.kind === 'backdrop') return { ...j, img: cover(img, 360, 640) };
    return { ...j, img: cutOut(img).img };
  }));

  const got = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') got.push(r.value);
    else report.kept.push({ id: jobs[i].id, why: String(r.reason?.message ?? r.reason).slice(0, 200) });
  });
  if (!got.length) return done(manifest);

  // Encode within the art budget: shrink sprites, then lower the backdrop quality, then drop the largest sprites.
  const replaced = new Set(got.map((g) => g.id));
  const budget = ART_BUDGET - otherArtBytes(art, replaced);
  const encode = (spritePx, quality) => got.map((g) => {
    if (g.kind === 'backdrop') return { ...g, uri: dataURI('image/jpeg', encodeJPEG(g.img, quality)), w: 360, h: 640 };
    const s = fit(g.img, spritePx);
    return { ...g, uri: dataURI('image/png', encodePNG(s)), w: s.w, h: s.h };
  });
  let enc;
  for (const [px, q] of [[SPRITE_MAX_PX, 74], [96, 66], [80, 58], [64, 50]]) {
    enc = encode(px, q);
    if (enc.reduce((t, e) => t + e.uri.length, 0) <= budget) break;
  }
  enc.sort((a, b) => (a.kind === 'backdrop' ? -1 : b.kind === 'backdrop' ? 1 : a.uri.length - b.uri.length));
  let total = 0;
  const fits = [];
  for (const e of enc) {
    if (total + e.uri.length > budget) { report.kept.push({ id: e.id, why: 'over the art budget' }); continue; }
    total += e.uri.length;
    fits.push(e);
  }
  if (!fits.length) return done(manifest);

  // Into the authoring manifest (key order kept), then expanded and validated again.
  const nextArt = { ...art, sprites: { ...sprites } };
  for (const e of fits) {
    if (e.kind === 'backdrop') nextArt.backdrop = { image: e.uri };
    else {
      const was = sprites[e.id] ?? {};
      nextArt.sprites[e.id] = { image: e.uri, w: e.w, h: e.h, ...(was.color ? { color: was.color } : {}) };
    }
  }
  const nextAuthoring = { ...authoring, art: nextArt };
  const expansion = studio.expand(JSON.stringify(nextAuthoring));
  if (!expansion.ok) {
    report.error = 'the painted art did not validate: ' + JSON.stringify((expansion.diagnostics ?? []).filter((d) => d.severity === 'error').slice(0, 2));
    return done(manifest);
  }
  const rewrapped = studio.wrap({ id: manifest.id, game_json: expansion.game_json, authoring_json: expansion.authoring_json, brief: manifest.brief, seed: manifest.seed, ...(manifest.style?.emoji ? { emoji: manifest.style.emoji } : {}) });
  const next = {
    ...manifest,
    content: rewrapped.content,
    style: { ...manifest.style, colors: rewrapped.style?.colors ?? manifest.style?.colors },
    studio: { ...(manifest.studio ?? {}), models: [...new Set([...(manifest.studio?.models ?? []), ...report.calls.map((c) => c.model)])] },
  };
  report.applied = true;
  report.painted = fits.map((e) => e.id);
  report.bytes = total;
  onEvent({ kind: 'painted', count: fits.length, summary: `Painted ${fits.length} ${fits.length === 1 ? 'piece' : 'pieces'}` });
  return done(next);
}
