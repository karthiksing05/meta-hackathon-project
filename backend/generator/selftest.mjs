// Self-test, no network and no Muse key: composes games with a scripted Muse, first in-process, then
// through the real server and the real MuseClient talking to a fake OpenAI-compatible Muse.
//
//   node selftest.mjs

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose } from './src/composer.mjs';
import { ScriptedMuse, extractObject } from './src/muse.mjs';
import { loadStudio } from './src/studio.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '   -> ' + String(detail).slice(0, 300)}`);
};

const studio = loadStudio();
const catalog = studio.catalog();
check('catalog has the fragment library', catalog.fragments.length >= 30 && catalog.looks.length >= 4, `${catalog.fragments.length} fragments`);
const example = () => structuredClone(catalog.examples[0].manifest);
const brief = { intent: 'a calm game about fog over the bay', audience: 'friends', mood: ['cozy'], energy: 'low', competition: 'light' };

// ---- in-process: a first draft with a typo, repaired in one round ----
{
  const bad = example();
  const use = bad.uses.find((u) => u.params && Object.keys(u.params).length) ?? bad.uses[0];
  use.params = { ...(use.params ?? {}), zzz_not_a_param: 1 };
  const muse = new ScriptedMuse([bad, example()]);
  const events = [];
  const out = await compose({ request: 'a calm fog game', brief }, { studio, muse, onEvent: (e) => events.push(e) });
  const kinds = events.map((e) => e.kind);
  check('a typo is repaired, then gated and wrapped', kinds.includes('repairing') && kinds.includes('playtested') && kinds.at(-1) === 'done', kinds.join(','));
  check('events carry readable summaries', events.every((e) => typeof e.summary === 'string' && e.summary.length > 0), JSON.stringify(events.map((e) => e.summary)));
  check('the repair prompt names the problem', muse.prompts.length >= 2 && /[AE]_[A-Z_]+/.test(muse.prompts[1]), muse.prompts[1]?.slice(-300));
  const m = out.manifest;
  check('the manifest is a microgame with its game stored as text', m.formula === 'microgame' && typeof m.content?.game_json === 'string' && typeof m.content?.authoring_json === 'string', Object.keys(m));
  check('the game passed the five-bot gate', out.stats.passedGate === true && out.gate.passed === true, JSON.stringify(out.gate));
  check('stats count the calls and the repair', out.stats.museCalls >= 2 && out.stats.repairRounds === 1 && out.stats.firstDraftValid === false, JSON.stringify(out.stats));
  check('the id is mg-<slug>-<suffix>', /^mg-[a-z0-9-]+-[a-z0-9]{4}$/.test(m.id), m.id);
  check('the studio stamp is on the manifest', Array.isArray(m.studio?.models) && m.studio.created_at && m.studio.offline === false, JSON.stringify(m.studio));
}

// ---- in-process: a fenced reply with prose around it expands as is ----
{
  const fenced = 'Here you go:\n```json\n' + JSON.stringify(example(), null, 2) + '\n```\nEnjoy!';
  const out = await compose({ request: 'x', brief }, { studio, muse: new ScriptedMuse([fenced]) });
  check('a fenced reply with prose is accepted', out.stats.firstDraftValid === true && out.stats.museCalls >= 1, JSON.stringify(out.stats));
}

// ---- in-process: Muse never produces a valid game ----
{
  const events = [];
  let err;
  try {
    await compose({ request: 'x', brief }, { studio, muse: new ScriptedMuse([{ uses: 7 }]), onEvent: (e) => events.push(e) });
  } catch (e) {
    err = e;
  }
  check('a game that never validates fails after the repair rounds', err?.name === 'GenerationError' && events.filter((e) => e.kind === 'repairing').length === 3 && events.at(-1).kind === 'failed', err?.message);
}

// ---- in-process: changing a game makes a new game that points back at it ----
{
  const first = await compose({ request: 'a calm fog game', brief }, { studio, muse: new ScriptedMuse([example()]) });
  const muse = new ScriptedMuse([example()]);
  const out = await compose({ request: 'make it faster', brief, base: first.manifest, remixOf: 'aaaaaaaaaaaaaaaaaaaaaaaa', level: 2 }, { studio, muse });
  const m = out.manifest;
  check('the prompt for a change carries the game being changed', /make it faster/.test(muse.prompts[0]) && muse.prompts[0].includes('Change it as asked'), muse.prompts[0]?.slice(0, 200));
  check('a change is a new game with a new id, lineage and level', m.id !== first.manifest.id && /^mg-[a-z0-9-]+-[a-z0-9]{4}$/.test(m.id) && m.lineage?.remix_of === 'aaaaaaaaaaaaaaaaaaaaaaaa' && m.chain?.index === 2 && m.chain.prev === first.manifest.id && m.chain.next === null && /^chain-/.test(m.chain.id) && m.chain.title, JSON.stringify({ id: m.id, lineage: m.lineage, chain: m.chain }));
  const grouped = { ...first.manifest, group_play: { mode: 'group_round', same_seed: true, result: { kind: 'score', compare: 'score' } }, structure: { cadence: 'daily', scope: 'group:g123', setter: 'ai' } };
  const kept = (await compose({ request: 'make it faster', brief, base: grouped, remixOf: 'bbbbbbbbbbbbbbbbbbbbbbbb' }, { studio, muse: new ScriptedMuse([example()]) })).manifest;
  check('a change keeps the base game\'s group_play and its Group scope', kept.group_play?.mode === 'group_round' && kept.structure?.scope === 'group:g123', JSON.stringify({ gp: kept.group_play, st: kept.structure }));
  const forGroup = (await compose({ request: 'a calm fog game', brief, context: { group: { id: 'grp_fog', kind: 'group' } } }, { studio, muse: new ScriptedMuse([example()]) })).manifest;
  check('context.group alone (no plan) scopes the game to that Group', forGroup.structure?.scope === 'group:grp_fog', JSON.stringify(forGroup.structure));
  let err;
  try { await compose({ request: 'x', brief, base: { title: 'x', content: {} } }, { studio, muse: new ScriptedMuse([example()]) }); } catch (e) { err = e; }
  check("a game without its authoring source can't be changed", !!err && /authoring_json/.test(err.message), err?.message);
}

// ---- in-process: Muse call options, usage, and the section an older bundle still needs ----
{
  const seen = [];
  const muse = { isConfigured: true, async chatJSON(body) { seen.push(body); return { content: '{}', model: body.model, usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12, calls: 1 } }; } };
  const old = { version: 2, async compose(args, ask) {
    const draft = await ask('SYSTEM', 'USER', 'microgame draft');
    const review = await ask('SYSTEM', 'REVIEW', 'score review', { model: 'muse-wonder-1.0', effort: 'high', max_tokens: 12000, timeout_s: 60 });
    return { manifest: { title: 'x' }, draft, review };
  } };
  const ctx = { types: [{ id: 't', name: 'A kind of game', summary: 's' }], tools: [{ id: 'lives', summary: 'N lives' }] };
  const out = await compose({ request: 'x', brief, context: ctx }, { studio: old, muse, model: 'muse-ember-1.0' });
  check('an older bundle gets the planned section on compose calls only', /Planned for this request/.test(seen[0].system) && !/Planned for this request/.test(seen[1].system), seen.map((b) => b.system.length).join(','));
  check('ask honours the model, effort and token budget it is given', seen[1].model === 'muse-wonder-1.0' && seen[1].reasoningEffort === 'high' && seen[1].maxTokens === 12000 && seen[0].model === 'muse-ember-1.0', JSON.stringify(seen.map((b) => [b.model, b.reasoningEffort, b.maxTokens])));
  check('a capped call (timeout_s) gets that timeout and one attempt', seen[1].timeout === 60 && seen[1].maxAttempts === 1 && seen[0].timeout === undefined, JSON.stringify(seen.map((b) => [b.timeout, b.maxAttempts])));
  check('ask returns the tokens used with the reply', out.draft.usage?.total_tokens === 12 && out.review.model === 'muse-wonder-1.0', JSON.stringify(out.draft));
  const v3 = [];
  const modern = { version: 3, async compose(args, ask) { v3.push(args.context); await ask('SYSTEM', 'USER', 'microgame draft'); return { manifest: { title: 'x' } }; } };
  seen.length = 0;
  await compose({ request: 'x', brief, context: ctx }, { studio: modern, muse });
  check('a version-3 bundle gets the context as an argument and no extra section', v3[0]?.types?.[0]?.id === 't' && !/Planned for this request/.test(seen[0].system), JSON.stringify(v3[0]));
}

// ---- the art step: the plan's visual stage marks assets "image", and Muse Image paints them after the gate ----
{
  const { encodePNG, decodePNG } = await import('./src/pixels.mjs');
  const painting = (w, h, sprite) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = Math.hypot(x - w / 2, y - h / 2) < w / 4;
      if (sprite && !inside) { data[i] = 0; data[i + 1] = 255; data[i + 2] = 0; } else { data[i] = 200; data[i + 1] = (x * 3) & 255; data[i + 2] = (y * 5) & 255; }
      data[i + 3] = 255;
    }
    return encodePNG({ w, h, data });
  };
  class PaintingMuse extends ScriptedMuse {
    constructor(replies, { fail = [] } = {}) { super(replies); this.images = []; this.fail = fail; }
    async image({ prompt, size }) {
      this.images.push({ prompt, size });
      if (this.fail.some((f) => prompt.includes(f))) throw new Error('image call failed');
      const [w, h] = size.split('x').map((n) => Math.round(Number(n) / 4));
      return { png: painting(w, h, size === '1024x1024'), model: 'muse-image-1.0', seconds: 0.1 };
    }
  }
  const withSprites = () => structuredClone(catalog.examples.find((e) => e.manifest?.art?.sprites?.avatar).manifest);
  const sprite = 'avatar';
  check('an example game has an avatar sprite to paint', !!withSprites());
  const visual = {
    style: 'cut paper', scene: 'a foggy bay at dawn', palette: { colors: { bg: '#E8EEF2', ink: '#1B2430' } },
    layout: { hud: 'top bar', play: 'middle', controls: 'bottom', quiet: ['the top 80 px', 'the middle'] },
    backdrop: { id: 'backdrop', render: 'image', prompt: 'A misty bay with piers at the edges.' },
    assets: [
      { id: sprite, piece: 'player', depicts: 'small boat', play_px: 48, render: 'image', prompt: 'A small wooden boat, three-quarter view.' },
      { id: 'not_in_game', piece: 'x', depicts: 'gull', render: 'image', prompt: 'A gull.' },
      { id: 'cell', piece: 'board cell', depicts: 'tile', render: 'svg', reads_as: 'a pale square' },
    ],
    readability: ['the HUD sits on a solid surface'],
  };
  const context = { version: 'harness-context/1', types: [], tools: [], plan: { spec: { spec: 'game-spec/1', theme: { world: 'a foggy bay' }, visual } } };

  const muse = new PaintingMuse([withSprites()]);
  const events = [];
  const out = await compose({ request: 'a calm fog game', brief, context }, { studio, muse, onEvent: (e) => events.push(e), env: {} });
  const a = JSON.parse(out.manifest.content.authoring_json);
  check('the art step paints the backdrop and the named sprite', out.stats.art?.applied === true && out.stats.art.painted.includes('backdrop') && out.stats.art.painted.includes(sprite), JSON.stringify(out.stats.art));
  check('the backdrop is a 360x640 JPEG and the sprite a PNG with alpha', a.art.backdrop?.image?.startsWith('data:image/jpeg;base64,') && a.art.sprites[sprite]?.image?.startsWith('data:image/png;base64,') && a.art.sprites[sprite].w <= 128,
    JSON.stringify({ b: a.art.backdrop?.image?.slice(0, 30), s: a.art.sprites[sprite] && { ...a.art.sprites[sprite], image: a.art.sprites[sprite].image?.slice(0, 30) } }));
  const cut = decodePNG(Buffer.from(a.art.sprites[sprite].image.split(',')[1], 'base64'));
  check('the green background is keyed out', cut.data[3] === 0 && cut.data[((cut.h >> 1) * cut.w + (cut.w >> 1)) * 4 + 3] === 255);
  check('the game still validates and is rewrapped', studio.expand(out.manifest.content.authoring_json).ok && out.manifest.content.game_json.includes('data:image/jpeg'));
  check('an asset the game never named is skipped, not painted', out.stats.art.kept.some((k) => k.id === 'not_in_game') && !muse.images.some((i) => i.prompt.includes('A gull')), JSON.stringify(out.stats.art.kept));
  check('sprite prompts ask for one subject on flat green', muse.images.some((i) => i.size === '1024x1024' && /pure green \(#00FF00\)/.test(i.prompt) && i.prompt.includes('A small wooden boat')));
  check('the backdrop prompt carries the quiet areas and no pieces', muse.images.some((i) => i.size === '1024x1536' && i.prompt.includes('the top 80 px') && /no characters/.test(i.prompt)));
  check('painting events have summaries', events.some((e) => e.kind === 'painting' && /painting 2 pieces/.test(e.summary)));
  check('the art is within the budget', out.stats.art.bytes <= 192 * 1024, out.stats.art.bytes);
  // The re-expand with the painted art keeps the verifier's fixed presentation, and the verifier runs again on the painted game.
  // A painted sprite changes its node's size (its aspect), so the new presentation stands and the verifier runs on it.
  check('the art step verifies the painted game again', out.stats.art.keptLayout === false && out.stats.layoutAfterArt?.ran === true && !out.stats.layoutAfterArt.error, JSON.stringify({ kept: out.stats.art.keptLayout, after: out.stats.layoutAfterArt }));
  const backdropOnly = { ...context, plan: { ...context.plan, spec: { ...context.plan.spec, visual: { ...visual, assets: [] } } } };
  const bOut = await compose({ request: 'a calm fog game', brief, context: backdropOnly }, { studio, muse: new PaintingMuse([withSprites()]), env: {} });
  check('a painted backdrop alone keeps the verified presentation', bOut.stats.art?.painted?.includes('backdrop') && bOut.stats.art.keptLayout === true && bOut.stats.layoutAfterArt?.ran === true, JSON.stringify({ art: bOut.stats.art?.painted, kept: bOut.stats.art?.keptLayout, after: bOut.stats.layoutAfterArt }));
  check('a painted tall game stays tall (the re-expand gets the canvas compose used)', JSON.parse(out.manifest.content.game_json).presentation?.canvas?.h === 780 && out.stats.canvas === 'tall', JSON.parse(out.manifest.content.game_json).presentation?.canvas);

  const failing = new PaintingMuse([withSprites()], { fail: ['A misty bay'] });
  const half = await compose({ request: 'a calm fog game', brief, context }, { studio, muse: failing, env: {} });
  const ha = JSON.parse(half.manifest.content.authoring_json);
  check('a failed painting keeps that asset\'s own art', half.stats.art.applied && !half.stats.art.painted.includes('backdrop') && half.stats.art.kept.some((k) => k.id === 'backdrop') && !String(ha.art.backdrop?.image ?? '').startsWith('data:image/jpeg'), JSON.stringify(half.stats.art));

  const off = new PaintingMuse([withSprites()]);
  const offOut = await compose({ request: 'a calm fog game', brief, context }, { studio, muse: off, env: { GENERATOR_IMAGE_ART: '0' } });
  check('GENERATOR_IMAGE_ART=0 turns the art step off', off.images.length === 0 && !offOut.stats.art);

  const rev = new PaintingMuse([withSprites()]);
  await compose({ request: 'make it faster', brief, base: out.manifest, context }, { studio, muse: rev, env: {} });
  check('a revision is not repainted', rev.images.length === 0);

  // GENERATOR_IMAGE_ART=1: the bundle's picture art draws through compose's hooks (image, decode, deflate) instead
  const pictures = new PaintingMuse([withSprites()]);
  const picEvents = [];
  const picCtx = { ...context, plan: { ...context.plan, art: 'image' } };
  const pic = await compose({ request: 'a calm fog game', brief, context: picCtx }, { studio, muse: pictures, onEvent: (e) => picEvents.push(e), env: { GENERATOR_IMAGE_ART: '1' } });
  check('GENERATOR_IMAGE_ART=1 draws pictures through the hooks', pic.stats.image_art?.image_calls > 0 && pictures.images.length > 0 && !pic.stats.art && /data:image\/png;base64,/.test(pic.manifest.content.game_json), JSON.stringify({ image_art: pic.stats.image_art, art: pic.stats.art, calls: pictures.images.length }));
  check('picture art emits drawing and drawn events', picEvents.some((e) => e.kind === 'drawing') && picEvents.some((e) => e.kind === 'drawn' && e.ok === true), JSON.stringify(picEvents.filter((e) => /draw/.test(e.kind))));
  check('the game with pictures still validates', studio.expand(pic.manifest.content.authoring_json).ok);
  const unset = new PaintingMuse([withSprites()]);
  const unsetOut = await compose({ request: 'a calm fog game', brief, context: picCtx }, { studio, muse: unset, env: {} });
  check('without GENERATOR_IMAGE_ART=1 the hooks draw nothing', !unsetOut.stats.image_art, JSON.stringify(unsetOut.stats.image_art));
}

// ---- the layout hooks: fixes before the gate and the lint after, no Chrome ----
{
  const { composeHooks, AUTHORING_FILES } = await import('./src/hooks.mjs');
  const made = await composeHooks({ muse: new ScriptedMuse([]), env: {} });
  check('layout hooks load from the authoring modules, picture art stays off by default', typeof made.hooks?.fixLayout === 'function' && typeof made.hooks?.layoutCheck === 'function' && typeof made.hooks?.verifyLayout === 'function' && !made.hooks.image, JSON.stringify(made));
  check('GENERATOR_LAYOUT=0 turns the layout hooks off', (await composeHooks({ muse: new ScriptedMuse([]), env: { GENERATOR_LAYOUT: '0' } })).hooks === null);
  const noVerify = await composeHooks({ muse: new ScriptedMuse([]), env: { GENERATOR_LAYOUT_VERIFY: '0' } });
  check('GENERATOR_LAYOUT_VERIFY=0 keeps fixLayout and drops the verifier', typeof noVerify.hooks?.fixLayout === 'function' && !noVerify.hooks.verifyLayout);
  const events = [];
  const t0 = Date.now();
  const out = await compose({ request: 'a calm fog game', brief }, { studio, muse: new ScriptedMuse([example()]), env: {}, onEvent: (e) => events.push(e) });
  const verifyMs = out.stats.layoutVerifyMs;
  console.log(`  (verifier without pixels: ${verifyMs} ms of a ${Date.now() - t0} ms compose)`);
  check('the verifier runs before the gate, without Chrome, and its report is stats.layout', out.stats.layout?.verifier === true && typeof out.stats.layout.blocking === 'number' && Array.isArray(out.stats.layout.findings) && out.stats.layoutBlocking === out.stats.layout.blocking && typeof verifyMs === 'number' && !out.stats.layoutVerifyError
    && events.findIndex((e) => e.kind === 'verifying') >= 0 && events.findIndex((e) => e.kind === 'verified') < events.findIndex((e) => e.kind === 'playtesting') && out.stats.requirements && 'must_passed' in out.stats.requirements, JSON.stringify({ layout: out.stats.layout, ms: verifyMs, err: out.stats.layoutVerifyError, kinds: events.map((e) => e.kind) }));
  const legacy = await compose({ request: 'a calm fog game', brief }, { studio, muse: new ScriptedMuse([example()]), env: { GENERATOR_LAYOUT_VERIFY: '0' } });
  check('without the verifier: fixLayout before the gate and the lint in stats.layout', legacy.stats.layout && typeof legacy.stats.layout.counts?.score === 'number' && legacy.stats.layout.pixels === false && Array.isArray(legacy.stats.layout.warnings) && typeof legacy.stats.layoutFixes === 'number', JSON.stringify({ layout: legacy.stats.layout, fixes: legacy.stats.layoutFixes }));
  // A verifier that always blocks: a layout repair round with the hints, then layout_block decides.
  const blocker = { verifyLayout: async (gameJson) => ({ game_json: gameJson, fixes: [], reverted: false, report: { pass: false, blocking: 1, warnings: 0, findings: [{ code: 'L_OVERLAP_TEXT', severity: 'block', node: '/presentation/x', message: 'text over text', hint: 'move it' }] } }) };
  const blockMuse = new ScriptedMuse([example()]);
  const shipped = await compose({ request: 'a calm fog game', brief, context: { canvas: 'classic' } }, { studio, muse: blockMuse, env: {}, hooks: blocker });
  check('a blocking layout gets a repair round with the hints, then ships with its findings (layout_block off)', shipped.stats.layoutRepairs >= 1 && shipped.stats.layoutBlocking === 1 && shipped.stats.layout.findings[0]?.code === 'L_OVERLAP_TEXT' && blockMuse.prompts.some((p) => p.includes('L_OVERLAP_TEXT') && p.includes('move it')), JSON.stringify({ repairs: shipped.stats.layoutRepairs, blocking: shipped.stats.layoutBlocking }));
  let refused = null;
  try { await compose({ request: 'a calm fog game', brief, context: { layout_block: true } }, { studio, muse: new ScriptedMuse([example()]), env: {}, hooks: blocker }); } catch (e) { refused = e; }
  check('context.layout_block refuses to publish while the layout blocks', refused?.name === 'GenerationError' && /blocking/.test(refused.message), String(refused?.message));
  let refusedEnv = null;
  try { await compose({ request: 'a calm fog game', brief }, { studio, muse: new ScriptedMuse([example()]), env: { GENERATOR_LAYOUT_BLOCK: '1' }, hooks: blocker }); } catch (e) { refusedEnv = e; }
  check('GENERATOR_LAYOUT_BLOCK=1 does the same', refusedEnv?.name === 'GenerationError', String(refusedEnv?.message));
  // The canvas switch: tall (360 × 780) by default; GENERATOR_CANVAS=classic builds 360 × 640; context.canvas wins.
  const heightOf = (o) => JSON.parse(o.manifest.content.game_json).presentation?.canvas?.h;
  const tallMuse = new ScriptedMuse([example()]);
  const tall = await compose({ request: 'a calm fog game', brief }, { studio, muse: tallMuse, env: { GENERATOR_CANVAS: 'tall' }, hooks: null });
  const classic = await compose({ request: 'a calm fog game', brief, context: { canvas: 'classic' } }, { studio, muse: new ScriptedMuse([example()]), env: { GENERATOR_CANVAS: 'tall' }, hooks: null });
  const classicEnv = await compose({ request: 'a calm fog game', brief }, { studio, muse: new ScriptedMuse([example()]), env: { GENERATOR_CANVAS: 'classic' }, hooks: null });
  const tallCtx = await compose({ request: 'a calm fog game', brief, context: { canvas: 'tall' } }, { studio, muse: new ScriptedMuse([example()]), env: { GENERATOR_CANVAS: 'classic' }, hooks: null });
  check('tall by default; GENERATOR_CANVAS=classic builds 360 × 640; context.canvas wins', heightOf(tall) === 780 && tall.stats.canvas === 'tall' && heightOf(out) === 780 && out.stats.canvas === 'tall' && heightOf(classic) === 640 && classic.stats.canvas === 'classic' && heightOf(classicEnv) === 640 && heightOf(tallCtx) === 780, JSON.stringify({ tall: heightOf(tall), classic: heightOf(classic), classicEnv: heightOf(classicEnv), tallCtx: heightOf(tallCtx), plain: heightOf(out) }));
  // AUTHORING_FILES must hold every relative import (static or literal dynamic) of the modules it lists.
  const fsm = await import('node:fs');
  const { findAuthoring } = await import('./src/hooks.mjs');
  const adir = findAuthoring({});
  const missing = [];
  for (const f of AUTHORING_FILES) {
    const src = fsm.readFileSync(join(adir, f), 'utf8');
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|^import\s+)['"](\.[^'"]+)['"]/gm)) {
      const rel = join(dirname(f), m[1]);
      if (!AUTHORING_FILES.includes(rel)) missing.push(`${f} -> ${rel}`);
    }
  }
  const checksDir = join(adir, 'verify', 'checks');
  for (const f of fsm.readdirSync(checksDir).filter((x) => x.endsWith('.mjs') && !x.startsWith('test-'))) if (!AUTHORING_FILES.includes('verify/checks/' + f)) missing.push('verify/checks/' + f);
  check('AUTHORING_FILES holds everything the hooks import (and every verifier check)', !missing.length, missing.join(', '));
  const fs = await import('node:fs');
  const dockerfile = join(here, '..', 'Dockerfile');
  if (fs.existsSync(dockerfile)) { // in the repository; inside the image, the modules simply have to load (above)
    const docker = fs.readFileSync(dockerfile, 'utf8');
    check('the generator image copies every authoring module the hooks import', AUTHORING_FILES.every((f) => docker.includes('authoring/' + f)), AUTHORING_FILES.filter((f) => !docker.includes('authoring/' + f)).join(', '));
    // The build context is an allow-list (Dockerfile.dockerignore): a module the Dockerfile copies but the list leaves
    // out fails the image build. Last matching line wins, as in Docker.
    const ignore = fs.readFileSync(join(here, '..', 'Dockerfile.dockerignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*') + '(?:/.*)?$');
    const allowed = (path) => { let ok = true; for (const l of ignore) { const neg = l.startsWith('!'); if (globRe(neg ? l.slice(1) : l).test(path)) ok = neg; } return ok; };
    const shut = AUTHORING_FILES.filter((f) => !allowed('authoring/' + f));
    check('the build context (Dockerfile.dockerignore) lets in every authoring module the image copies', !shut.length, shut.join(', '));
  }
}

// ---- Prod build B1 (2026-11-13): a "Next" label in the page colour on $primary (2.19:1) that the server passed ----
// The as-shipped game is the fixture. Without Chrome the verifier missed it twice over: the shapes-only contrast gave
// up on any text over a backdrop picture (even on an opaque button), and the readability stage's 36 frames never
// caught the label (up 350 ms of a 30 s run). Both checks must see it now, and verifyAndFix must fix it.
{
  const fs = await import('node:fs');
  const { composeHooks, findAuthoring } = await import('./src/hooks.mjs');
  const { pathToFileURL } = await import('node:url');
  const m = JSON.parse(fs.readFileSync(join(here, 'fixtures', 'story-quiz-next-contrast.manifest.json'), 'utf8'));
  const next = '/presentation/root/children/1/children/5/children/6';
  const engine = studio.engine().getEngine();
  const { verify } = await import(pathToFileURL(join(findAuthoring({}), 'verify/verify.mjs')).href);
  const before = await verify(m, { engine, pixels: false, measures: null });
  const seen = before.findings.filter((f) => f.node === next && f.severity === 'block').map((f) => f.code);
  check('B1: without Chrome the verifier blocks on the "Next" label (L_LOW_CONTRAST and S_READABILITY)', seen.includes('L_LOW_CONTRAST') && seen.includes('S_READABILITY'), JSON.stringify(before.findings.map((f) => [f.code, f.node, f.severity])));
  const { hooks } = await composeHooks({ env: {} });
  const v = await hooks.verifyLayout(m.content.game_json, { engine, authoring: m.content.authoring_json, budgetMs: 60000 });
  const contrastLeft = v.report.findings.filter((f) => f.severity === 'block' && /CONTRAST|READABILITY/.test(f.code));
  check('B1: the server\'s verifyAndFix re-inks the label and ships with no contrast or readability block', !v.reverted && v.fixes.some((f) => f.node === next && f.stage === 'readability') && !contrastLeft.length,
    JSON.stringify({ reverted: v.reverted, fixes: v.fixes.filter((f) => f.node === next), left: contrastLeft }));
  const fixed = JSON.parse(v.game_json).presentation.root.children[1].children[5].children[6];
  check('B1: the label is on a palette ink, not the page colour', fixed.color !== '$bg' && typeof fixed.color === 'string', JSON.stringify(fixed));
}

// ---- the art step re-expands: it keeps the verified presentation only when nothing else changed ----
{
  const { keepVerifiedPresentation } = await import('./src/art.mjs');
  const built = studio.expand(JSON.stringify(example()));
  const verified = JSON.parse(built.game_json);
  verified.presentation = { ...verified.presentation, verified_marker: true };
  const manifest = { content: { authoring_json: built.authoring_json, game_json: JSON.stringify(verified) } };
  const same = keepVerifiedPresentation(studio, manifest, built);
  check('keepVerifiedPresentation puts the verified presentation back when only assets changed', same.kept && JSON.parse(same.game_json).presentation.verified_marker === true);
  const changed = JSON.parse(built.game_json);
  changed.rules = [...(changed.rules ?? []), { id: 'zz_new' }];
  const other = keepVerifiedPresentation(studio, manifest, { ...built, game_json: JSON.stringify(changed) });
  check('...and keeps the new expansion when the rules changed', !other.kept && other.game_json === JSON.stringify(changed));
}

// ---- A_UNKNOWN_CONTENT is fixed in code (authoring/expander/content-repair.mjs), in the bundle's pipeline ----
{
  const withRead = (key, content) => {
    const m = example();
    m.functions = { ...(m.functions ?? {}), zz_list: { params: {}, returns: 'list<string>', body: `content_${key}` } };
    m.content = { ...(m.content ?? {}), ...content };
    return m;
  };
  // The prefix written into the key: moved before Muse is asked, so no repair round.
  const moved = new ScriptedMuse([withRead('zz_words', { content_zz_words: ['fog', 'pier'] })]);
  const a = await compose({ request: 'a calm fog game', brief }, { studio, muse: moved, env: {}, hooks: null });
  check('a misplaced content key is moved in code, with no repair round', a.stats.repairRounds === 0 && a.stats.contentRepairs?.[0]?.kind === 'moved' && JSON.parse(a.manifest.content.authoring_json).content.zz_words?.length === 2, JSON.stringify({ rounds: a.stats.repairRounds, fixes: a.stats.contentRepairs }));
  // Missing for real: Muse gets one round with the hint; when it repeats the error, the code fills an empty list.
  const repeat = new ScriptedMuse([withRead('zz_end_lines', {})]);
  const b = await compose({ request: 'a calm fog game', brief }, { studio, muse: repeat, env: {}, hooks: null });
  check('a content key Muse leaves out twice is filled in code after one repair round', b.stats.repairRounds === 1 && b.stats.contentRepairs?.some((f) => f.key === 'zz_end_lines' && f.kind === 'defaulted') && repeat.prompts.some((p) => p.includes('without the content_ prefix')), JSON.stringify({ rounds: b.stats.repairRounds, fixes: b.stats.contentRepairs }));
}

// ---- a failed job keeps its last manifest ----
{
  const { failureStats, LAST_MANIFEST_MAX } = await import('./src/composer.mjs');
  let err;
  try { await compose({ request: 'x', brief }, { studio, muse: new ScriptedMuse([{ uses: 7 }]), env: {} }); } catch (e) { err = e; }
  const s = failureStats(err);
  check('a failed compose carries its last manifest into the job stats', typeof s?.lastManifest === 'string' && JSON.parse(s.lastManifest).uses === 7 && typeof s.museCalls === 'number', JSON.stringify(s)?.slice(0, 300));
  const pic = failureStats({ stats: {}, lastManifest: JSON.stringify({ art: { backdrop: { image: 'data:image/jpeg;base64,' + 'A'.repeat(1000) } } }) });
  check('pictures in the last manifest are cut to a stub', pic.lastManifest.includes('data:image/jpeg;base64,(left out)') && pic.lastManifest.length < 200, pic.lastManifest);
  const big = failureStats({ stats: {}, lastManifest: JSON.stringify({ text: 'x'.repeat(LAST_MANIFEST_MAX + 10) }) });
  check('an oversized last manifest is left out, with its size', big.lastManifest === undefined && big.lastManifestBytes > LAST_MANIFEST_MAX);
}

{
  const { contextSection } = await import('./src/composer.mjs');
  const text = contextSection({ plan: { spec: { spec: 'game-spec/1', goal: { text: 'catch 20 moths' }, visual: {
    style: 'cut paper', palette: { colors: { bg: '#101826', ink: '#FAFAFA' } }, layout: { hud: 'top', play: 'middle', controls: 'bottom' },
    backdrop: { prompt: 'SECRET BACKDROP PROMPT' }, assets: [{ id: 'moth', piece: 'pickup', depicts: 'pale moth', render: 'image', prompt: 'SECRET SPRITE PROMPT' }, { id: 'cell', depicts: 'tile', render: 'svg' }] } } } });
  check('compose sees the spec and the sprite names, not the image prompts', text.includes('catch 20 moths') && text.includes('- moth (pickup)') && text.includes('#101826') && /cell .*\[svg/.test(text) && !text.includes('SECRET'), text.slice(-600));
}

check('extractObject finds fenced and padded JSON', extractObject('```json\n{"a":1}\n```')?.a === 1 && extractObject('hi {"a":2} bye')?.a === 2 && extractObject('nope') === null);

// ---- end to end: the real server and MuseClient against a fake Muse API ----
{
  const calls = [];
  const replies = [JSON.stringify(example())];
  const fakeMuse = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/v1/responses') { // an image: the image_generation tool's reply
        res.end(JSON.stringify({ model: 'fake-image-1', status: 'completed', output: [{ type: 'image_generation_call', result: Buffer.from('PNGBYTES').toString('base64') }] }));
        return;
      }
      res.end(JSON.stringify({ model: 'fake-muse-1', usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 }, choices: [{ message: { role: 'assistant', content: replies[0] }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise((r) => fakeMuse.listen(0, '127.0.0.1', r));
  const museURL = `http://127.0.0.1:${fakeMuse.address().port}/v1`;
  const port = 18991;
  const child = spawn(process.execPath, [join(here, 'server.mjs')], {
    env: { ...process.env, PORT: String(port), MUSE_API_KEY: 'test-key-not-real', MUSE_BASE_URL: museURL, GENERATOR_MAX_CONCURRENT: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      ready = r.ok && (await r.json()).museConfigured === true;
    } catch {}
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  check('server starts and reports Muse configured', ready);
  if (ready) {
    const res = await fetch(`http://127.0.0.1:${port}/compose`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: 'a calm fog game', brief: { intent: 'fog', mood: ['cozy'] } }),
    });
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    const result = lines.find((l) => l.type === 'result');
    check('POST /compose streams events then a result', res.status === 200 && lines.filter((l) => l.type === 'event').length >= 3 && result?.manifest?.formula === 'microgame', JSON.stringify(lines.map((l) => l.type)));
    check('Muse got a Bearer key, JSON mode and the chat path', calls[0]?.url === '/v1/chat/completions' && calls[0].auth === 'Bearer test-key-not-real' && calls[0].body.response_format?.type === 'json_object' && calls[0].body.max_tokens >= 4000, JSON.stringify(calls[0] && { url: calls[0].url, auth: calls[0].auth }));
    check('the key never appears in the output', !JSON.stringify(lines).includes('test-key-not-real'));
    // the harness's context goes into the system prompt as data, and a Muse JSON turn is available to the Go API
    {
      const ctx = {
        types: [{ id: 'rare_answer_trivia', name: 'Rare-answer trivia', family: 'trivia', summary: 'Name a thing nobody else will.', core_loop: 'Type an answer; rarer scores more.', rules: ['One answer per prompt'], source: 'learned' }],
        tools: [{ id: 'lives', kind: 'fragment', status: 'shipped', summary: 'N lives, one lost per hit.', when_to_use: 'a game you can lose slowly' }],
        plan: { design: 'A fast naming game.', spec: { theme: 'rare things', goal: 'name what nobody else will' }, gaps: [{ tool: 'share_grid', approximation: 'share the score text' }] },
        notes: ['keep it short'],
      };
      const before = calls.length;
      const withCtx = await fetch(`http://127.0.0.1:${port}/compose`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'a rare answer game', brief: { intent: 'x' }, context: ctx }),
      });
      await withCtx.text();
      const sys = calls[before]?.body.messages[0].content ?? '';
      check('the version-3 bundle gets the context and renders it itself, once', studio.version >= 3 && !/## Planned for this request/.test(sys) && /## Fragments for this game \(from the plan\)/.test(sys), sys.slice(-300));
      check('the prompt without context has no planned section', !/## Planned for this request|## Fragments for this game \(from the plan\)/.test(calls[0]?.body.messages[0].content ?? ''));
      const big = await fetch(`http://127.0.0.1:${port}/compose`, { method: 'POST', body: JSON.stringify({ request: 'x', context: { notes: ['y'.repeat(60 * 1024)] } }) });
      check('a context over 48 KB is a 400', big.status === 400, big.status);

      const mj = (body) => fetch(`http://127.0.0.1:${port}/internal/muse/json`, { method: 'POST', body: JSON.stringify(body) });
      replies[0] = JSON.stringify({ understood: true });
      const at = calls.length;
      const ok = await mj({ model: 'muse-spark-1.3', system: 'You are a parser.', user: 'make hexcells', maxTokens: 4000, effort: 'minimal', timeoutSeconds: 25 });
      const okJson = await ok.json();
      check('POST /internal/muse/json returns Muse\'s reply and model', ok.status === 200 && JSON.parse(okJson.content).understood === true && okJson.model === 'fake-muse-1', JSON.stringify(okJson));
      check('it asks Muse for the model, effort and token budget it was given', calls[at]?.body.model === 'muse-spark-1.3' && calls[at].body.reasoning_effort === 'minimal' && calls[at].body.max_tokens === 4000 && calls[at].auth === 'Bearer test-key-not-real', JSON.stringify(calls[at]?.body).slice(0, 200));
      check('the key is never in the reply', !JSON.stringify(okJson).includes('test-key-not-real'));
      check('/internal/muse/json returns the tokens used', okJson.usage?.prompt_tokens === 11 && okJson.usage?.completion_tokens === 22 && okJson.usage?.total_tokens === 33, JSON.stringify(okJson.usage));
      for (const [label, body] of [['a non-Muse model', { model: 'gpt-4', system: 'a', user: 'b' }], ['no user text', { model: 'muse-spark-1.3', system: 'a' }], ['a bad effort', { model: 'muse-spark-1.3', system: 'a', user: 'b', effort: 'max' }]]) {
        check(`the Muse route refuses ${label}`, (await mj(body)).status === 400, label);
      }
      replies[0] = JSON.stringify(example());

      // one picture from Muse Image
      const mi = (body) => fetch(`http://127.0.0.1:${port}/internal/muse/image`, { method: 'POST', body: JSON.stringify(body) });
      const ai = calls.length;
      const img = await mi({ prompt: 'a fox in a scarf, flat colors', size: '1024x1024', guide: Buffer.from('guide-png').toString('base64') });
      const imgJson = await img.json();
      const sent = calls[ai]?.body;
      check('POST /internal/muse/image returns the picture, the model and the time', img.status === 200 && Buffer.from(imgJson.png_base64, 'base64').toString() === 'PNGBYTES' && imgJson.model === 'fake-image-1' && imgJson.seconds >= 0, JSON.stringify(imgJson).slice(0, 160));
      check('the image call carries the prompt, the guide, the size and the key', calls[ai]?.url === '/v1/responses' && sent?.model === 'muse-image-1.0' && sent.input[0].content[0].text.includes('fox') && sent.input[0].content[1]?.type === 'input_image' && sent.tools[0].size === '1024x1024' && calls[ai].auth === 'Bearer test-key-not-real', JSON.stringify(sent).slice(0, 200));
      check('the key is never in the image reply', !JSON.stringify(imgJson).includes('test-key-not-real'));
      for (const [label, body] of [['no prompt', { size: '1024x1024' }], ['a size it does not know', { prompt: 'x', size: '99x99' }], ['a guide that is not base64', { prompt: 'x', guide: 'not base64!!' }]]) {
        check(`the image route refuses ${label}`, (await mi(body)).status === 400, label);
      }
    }

    // replaying a run's log: the server checks a score instead of trusting the phone
    {
      const gameText = studio.expand(JSON.stringify(example())).game_json;
      const game = studio.engine().getEngine().load(gameText, 777);
      for (let i = 0; i < 120; i++) game.step(16.666666666666668);
      game.pointer('down', 100, 200); game.step(16.67); game.pointer('up', 100, 200);
      const log = JSON.stringify(game.log());
      const post = (body) => fetch(`http://127.0.0.1:${port}/verify`, { method: 'POST', body: JSON.stringify(body) });
      const good = await (await post({ game: gameText, log })).json();
      check('POST /verify replays an honest run', good.ok === true && good.game_hash_ok === true && good.recomputed?.score === good.claimed?.score, JSON.stringify(good).slice(0, 200));
      const forged = JSON.parse(log);
      forged.final.score = 99999;
      const bad = await (await post({ game: gameText, log: JSON.stringify(forged) })).json();
      check('POST /verify rejects a forged score', bad.ok === false && bad.problems.length > 0 && bad.recomputed.score !== 99999, JSON.stringify(bad).slice(0, 200));
      const other = await (await post({ game: gameText.replace('"title"', '"title" ').replace(/\s+$/, '') + ' ', log })).json();
      check('POST /verify rejects a different game file', other.ok === false && other.game_hash_ok === false, JSON.stringify(other).slice(0, 200));
      check('POST /verify needs both texts', (await post({ game: gameText })).status === 400);
    }

    // a change sends the stored manifest, which is far bigger than a small request body
    const fat = { ...result.manifest, content: { ...result.manifest.content, padding: 'x'.repeat(400 * 1024) } };
    const rv = await fetch(`http://127.0.0.1:${port}/compose`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: 'make it faster', base: fat, remixOf: 'aaaaaaaaaaaaaaaaaaaaaaaa' }),
    });
    const rvLines = (await rv.text()).trim().split(String.fromCharCode(10)).map((l) => JSON.parse(l));
    check('a change with a 400 KB base manifest is accepted', rv.status === 200 && rvLines.some((l) => l.type === 'result'), rv.status + ' ' + JSON.stringify(rvLines.map((l) => l.type)));
    const bad = await fetch(`http://127.0.0.1:${port}/compose`, { method: 'POST', body: '{"request":""}' });
    check('an empty request is a 400', bad.status === 400, bad.status);

    // anatomy: one JSON turn on the fast model
    const anatomy = { anatomy: 'game-anatomy/0.1', title: 'Fog Garden', genre: 'puzzle', parts: { core_loop: { text: 'Tap fog away', source: 'you', familiarity: 'known', plan: 'fragment:reveal' } } };
    replies[0] = JSON.stringify(anatomy);
    const before = calls.length;
    const a1 = await fetch(`http://127.0.0.1:${port}/anatomy`, { method: 'POST', body: JSON.stringify({ request: 'a calm fog game', audience: 'friends' }) });
    const aj = await a1.json();
    const call = calls[before];
    check('POST /anatomy returns the anatomy', a1.status === 200 && aj.anatomy?.anatomy === 'game-anatomy/0.1' && aj.anatomy.title === 'Fog Garden', JSON.stringify(aj).slice(0, 200));
    check('the anatomy prompt keeps real names the person gives', /keep their real names, as written/.test(call?.body.messages[0].content ?? '') && !/Synthetic people only/.test(call?.body.messages[0].content ?? ''));
    check('anatomy uses the fast model, low effort and the engine fragment list', call?.body.model === 'muse-ember-1.0' && call.body.reasoning_effort === 'low' && /Fragment library/.test(call.body.messages[0].content) && /- reveal:/.test(call.body.messages[0].content), JSON.stringify(call && { model: call.body.model, effort: call.body.reasoning_effort }));
    const withAnswer = structuredClone(anatomy);
    withAnswer.parts.core_loop.question = 'How many tries?';
    withAnswer.parts.core_loop.answer = '6';
    const a2 = await fetch(`http://127.0.0.1:${port}/anatomy/revise`, { method: 'POST', body: JSON.stringify({ anatomy: withAnswer, change: 'also lose if the fog returns', request: 'a calm fog game', afterPlaying: true }) });
    const user = calls.at(-1)?.body.messages[1].content ?? '';
    check('POST /anatomy/revise sends the anatomy, the answers and the change', a2.status === 200 && /How many tries\? → 6/.test(user) && /also lose if the fog returns/.test(user) && /played the game/.test(user), user.slice(0, 300));
    replies[0] = JSON.stringify({ nope: true });
    const a3 = await fetch(`http://127.0.0.1:${port}/anatomy`, { method: 'POST', body: JSON.stringify({ request: 'x' }) });
    check('a reply that is not an anatomy is a 502', a3.status === 502, a3.status);
    check('an empty anatomy request is a 400', (await fetch(`http://127.0.0.1:${port}/anatomy`, { method: 'POST', body: '{"request":""}' })).status === 400);
    check('the key never appears in anatomy output', !JSON.stringify(aj).includes('test-key-not-real'));
  }
  child.kill();
  fakeMuse.close();
}

// ---- the person's photos and video (src/media.mjs): frames, Muse vision with a fake Muse, the brief, the pictures ----
{
  const M = await import('./src/media.mjs');
  const times = M.frameTimes(13000, [8000], { every: 4000, max: 16 });
  check('key frame times: the start, just after each cut, then every 4 s', times[0].t === 300 && times[0].cut && times.some((x) => x.t === 8150 && x.cut) && times.every((x, i) => i === 0 || x.t - times[i - 1].t >= 800), JSON.stringify(times));
  const norm = M.normalizeDescription({ summary: 's', people: 'yes', frames: [{ t: 99999, desc: 'late' }], beats: [{ t: 5000, text: 'b2' }, { t: 0, end: 0, text: 'b1' }], extra: 1 }, { kind: 'video', durationMs: 13000 });
  check('a description is clamped to the clip, ordered, and keeps known fields only', norm.people === false && norm.frames[0].t === 13000 && norm.beats[0].text === 'b1' && norm.beats[0].end === 5000 && norm.beats[1].end === 13000 && !('extra' in norm), JSON.stringify(norm));

  const ffmpeg = await M.hasFFmpeg();
  let probe = null;
  if (!ffmpeg) console.log('SKIP ffmpeg checks: ffmpeg is not installed here (the generator image has it)');
  else {
    const { mkdtemp, readFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'media-test-'));
    const out = join(dir, 'clip.mp4');
    // A synthetic clip: 6 s of dark blue, then a hard cut to 5 s of pale yellow, with a box on top (no real footage).
    await new Promise((res) => spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x101830:s=320x180:d=6:r=25', '-f', 'lavfi', '-i', 'color=c=0xf0e0a0:s=320x180:d=5:r=25',
      '-filter_complex', '[0][1]concat=n=2:v=1:a=0,drawbox=x=120:y=60:w=80:h=100:color=0xf2c9a0:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]).on('close', res));
    probe = await M.videoFrames(await readFile(out));
    check('videoFrames reads the size and length', probe.width === 320 && probe.height === 180 && Math.abs(probe.durationMs - 11000) < 200, JSON.stringify({ w: probe.width, h: probe.height, d: probe.durationMs }));
    check('videoFrames finds the scene cut at 6 s', probe.cuts.some((t) => Math.abs(t - 6000) < 200) && probe.frames.some((f) => f.cut && Math.abs(f.t - 6150) < 200), JSON.stringify(probe.cuts));
    check('videoFrames returns JPEG key frames and a thumbnail', probe.frames.length >= 3 && probe.frames.every((f) => M.jpegSize(Buffer.from(f.jpg, 'base64'))?.w === 320) && M.jpegSize(Buffer.from(probe.thumb, 'base64')), probe.frames.length);
    let bad;
    try { await M.videoFrames(Buffer.from('not a video at all')); } catch (e) { bad = e; }
    check('a file that is not a video is a 422', bad instanceof M.MediaError && bad.status === 422, bad?.message);
    await rm(dir, { recursive: true, force: true });
  }

  // describe(): one vision call with every frame as an image part; the reply is normalized.
  const frames = probe ? probe.frames.map((f) => ({ t: f.t, jpg: f.jpg })) : [{ t: 300, jpg: 'A'.repeat(200) }, { t: 6150, jpg: 'B'.repeat(200) }];
  const vision = new ScriptedMuse([{ summary: 'A mayor promises a bridge on time, then the news says it is late.', people: true, captions: ['BREAKING'],
    frames: frames.map((f, i) => ({ t: f.t, desc: i ? 'red screen' : 'blue screen' })), beats: [{ t: 0, end: 6000, text: 'the promise' }, { t: 6000, end: 11000, text: 'the bad news' }] }]);
  const d = await M.describe({ kind: 'video', durationMs: 11000, note: 'make a quiz', frames }, vision);
  check('describe sends the frames as images in one call', vision.prompts.length === 1 && vision.imageCounts[0] === Math.min(8, frames.length) && /make a quiz/.test(vision.prompts[0]), JSON.stringify(vision.imageCounts));
  check('describe returns the beats', d.description.beats.length === 2 && d.description.people === true, JSON.stringify(d.description));

  // The brief names the pictures; applyMedia swaps them in behind those sprite names.
  const media = [{ id: 'v1', ref: 'm1', kind: 'video', durationMs: 11000, summary: d.description.summary, people: true,
    frames: frames.map((f, i) => ({ t: f.t, desc: 'x', asset: `m1_f${i + 1}` })), beats: [{ t: 0, end: 6000, text: 'the promise', asset: 'm1_beat1' }, { t: 6000, end: 11000, text: 'the bad news', asset: 'm1_beat2' }], assets: { clip: 'm1_clip' }, note: 'make a quiz' }];
  const brief = M.mediaBrief(media);
  check('the brief names the picture sprites and the beats', /m1_beat2/.test(brief) && /m1_f1/.test(brief) && /m1_clip/.test(brief) && /make a quiz/.test(brief) && /never make a rule/.test(brief), brief.slice(0, 300));
  const game = structuredClone(catalog.examples.find((e) => e.manifest?.art?.sprites?.avatar).manifest);
  const stand = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#ccc"/></svg>';
  game.art.sprites.avatar = { svg: stand };
  game.art.sprites.m1_f1 = { svg: stand };
  const fake = new ScriptedMuse([game]);
  const out = await compose({ request: 'make a quiz from this clip', brief: {}, context: { media }, mediaFiles: { v1: { kind: 'video', durationMs: 11000, frames } } }, { studio, muse: fake });
  check('compose puts the media brief in the request Muse sees', /m1_beat1/.test(fake.prompts[0]), fake.prompts[0]?.slice(0, 200));
  const authored = JSON.parse(out.manifest.content.authoring_json);
  if (probe) {
    check('the picture went in behind the sprite name', /^data:image\/jpeg;base64,/.test(authored.art.sprites.m1_f1?.image ?? '') && out.stats.media?.applied === true, JSON.stringify(out.stats.media));
    game.art.sprites = { avatar: { svg: stand } };
    const clip = structuredClone(game);
    clip.art.sprites.avatar = { svg: stand }; // the game draws the avatar role; make it the beat slideshow by name
    const named = await M.applyMedia({ manifest: { ...out.manifest, content: { ...out.manifest.content, authoring_json: JSON.stringify({ ...authored, art: { ...authored.art, sprites: { ...authored.art.sprites, m1_beat2: { svg: stand } } } }) } }, media, files: { v1: { kind: 'video', durationMs: 11000, frames } }, studio });
    const s2 = JSON.parse(named.manifest.content.authoring_json).art.sprites.m1_beat2;
    check('a beat becomes a timed-frame slideshow (a sheet with fps)', s2?.image && s2.frames >= 2 && s2.cols === s2.frames && s2.fps > 0, JSON.stringify({ ...s2, image: s2?.image?.slice(0, 30) }));
    const g = JSON.parse(named.manifest.content.game_json);
    check('the slideshow is an engine image asset with fps (presentation clock only)', JSON.stringify(g.assets ?? g).includes('m1_beat2'), Object.keys(g));
  }
  check('a game with no media sprites is left as compose made it', (await M.applyMedia({ manifest: out.manifest, media, files: {}, studio })).report.applied === false);
  check('a restyle prompt is always a cartoon, never photoreal', /NOT photorealistic/.test(M.restylePrompt({ m: { people: true, subjects: ['a man'] } })) && /caricature/.test(M.restylePrompt({ m: { people: true } })));
}

// ---- without a key the server says so ----
{
  const port = 18992;
  const env = { ...process.env, PORT: String(port) };
  delete env.MUSE_API_KEY;
  const child = spawn(process.execPath, [join(here, 'server.mjs')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${port}/healthz`)).ok; } catch {}
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  const r = up ? await fetch(`http://127.0.0.1:${port}/compose`, { method: 'POST', body: '{"request":"a game"}' }) : null;
  check('without MUSE_API_KEY /compose is a 503', r?.status === 503, r?.status);
  child.kill();
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
