// Variants: one request, 2–3 versions of the game, the person keeps one (Karthik: "have multiple options
// for games"). The plan (harness-context/1) is shared; each version differs on one axis only, so the pick
// is a clean preference that feeds the next plan.
//
//   axes    look   the art style (when the request didn't name one)
//           twist  the custom rule (when the request is vague and Muse invented the twist)
//           arc    the difficulty arc (when nobody said how hard)
//           type   the game type (when the top two retrieved types score close and play differently)
//
// Every version keeps the plan's goal, score and group play (`spec.goal`, `spec.score`, `spec.social`).
//
// Two ways to make a version (measured in docs/harness-gaps/variants.md):
//   separate  a full compose per version, in parallel: wall time is the slowest one, cost is N composes;
//   shared    one full compose, then a cheap pass per other version: a restyle of the art section only
//             (look), or a revision of the drafted game (twist, arc). The type axis is always separate.
//
// Pure like pipeline.mjs: Muse is `ask(system, user, purpose, options)`, and `studio` is the Studio API the
// generator loads (backend/generator/src/studio.mjs): compose(args, ask, onEvent), expand(text),
// gate(gameJSON, seed), wrap(options). Nothing here edits the pipeline; it calls its entry points.

export const AXES = Object.freeze(['look', 'twist', 'arc', 'type']);
export const MAX_VARIANTS = 3;
export const PICK_EVENT = 'variant_pick';

/** The Muse call that writes the alternatives: small, fast, JSON. */
export const ALTERNATIVES_OPTIONS = Object.freeze({ model: 'muse-spark-1.3', effort: 'minimal', max_tokens: 4000 });
/** The restyle pass redraws only the art section. */
export const RESTYLE_OPTIONS = Object.freeze({ model: 'muse-wonder-1.0', effort: 'low', max_tokens: 16000 });

const IDS = ['a', 'b', 'c'];
const LOOKS = {
  neon: 'Neon arcade: glowing outlines on a deep night backdrop, bright cyan and violet, rounded type',
  paper: 'Paper cut-out: layered paper shapes with soft drop shadows, warm off-white backdrop, hand-made feel',
  pixel: 'Chunky pixel art: hard square edges, a small retro palette, a bitmap font',
  riso: 'Risograph print: two or three overprinted inks, grainy halftone texture, slightly misregistered edges',
};

// Words that name an art style. "X style game" or "X-like" names a game, not a look, so "style" alone
// doesn't count.
const STYLE_WORDS = /\b(pixel|8[- ]?bit|16[- ]?bit|retro|neon|synthwave|vaporwave|watercolou?r|cartoon|anime|manga|chibi|kawaii|cute|minimal(ist)?|flat|low[- ]?poly|3d|clay|claymation|noir|sketch|hand[- ]?drawn|doodle|crayon|paper|cut[- ]?out|comic|pastel|ukiyo|art deco|cyberpunk|steampunk|gothic|realistic|photo|monochrome|black and white|lego|isometric|storybook|riso|halftone|glitch|y2k|cozy|spooky|art style|drawn like|looks like|aesthetic|vibe)\b/i;
const DIFFICULTY_WORDS = /\b(easy|easier|hard|harder|hardest|difficult|chill|relax(ing|ed)?|casual|brutal|intense|insane|beginner|expert|kids?|toddler|gentle|punishing|ramp|speeds? up|gets? faster)\b/i;
const MECHANIC_CUES = /\b(where|but|and (must|try|avoid)|without|before|until|while|unless|when|every|each|if)\b/i;
const STOP = new Set('a an the and or but of to in on at for with as is are be by it its this that i me my you your game games style like play make where so into from out up any some'.split(' '));

const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const round1 = (n) => Math.round(n * 10) / 10;
const short = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/** The person's earlier picks, oldest first: [{axis, chosen, rejected, at}]. */
export function preferencesOf(context) {
  return Array.isArray(context?.preferences) ? context.preferences.filter((p) => p && AXES.includes(p.axis)) : [];
}

function clarifyGuessed(plan, re) {
  return (plan?.clarify ?? []).some((c) => c && c.guessed && re.test(String(c.slot ?? '')));
}

function toolSet(t) { return new Set(Array.isArray(t?.tools) ? t.tools : []); }
function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** The type the plan builds: its first type id, else the best retrieved. */
export function topType(context) {
  const types = Array.isArray(context?.types) ? context.types : [];
  const first = (context?.plan?.type_ids ?? [])[0];
  return types.find((t) => t.id === first) ?? types[0] ?? null;
}

/**
 * The other of the two best-matched types when the plan builds one of them, the two score within `gap`, and
 * they play differently (another family, or tools that barely overlap); else null.
 */
export function closeType(context, { gap = 0.05 } = {}) {
  const types = (Array.isArray(context?.types) ? context.types : []).filter((t, i, all) => t?.id && all.findIndex((x) => x.id === t.id) === i);
  const top = topType(context);
  if (!top || types.length < 2) return null;
  const two = [...types].sort((x, y) => Number(y.match?.score ?? 0) - Number(x.match?.score ?? 0)).slice(0, 2);
  if (!two.some((t) => t.id === top.id)) return null;
  const other = two.find((t) => t.id !== top.id);
  if (Math.abs(Number(two[0].match?.score ?? 0) - Number(two[1].match?.score ?? 0)) > gap) return null;
  if ((context?.plan?.type_ids ?? []).includes(other.id)) return null; // already blended in
  // The same mechanic under another name (rare_answer_daily vs rare_answer_trivia) isn't a choice.
  const overlap = jaccard(toolSet(other), toolSet(top));
  if (other.family === top.family ? overlap >= 0.3 : overlap >= 0.6) return null;
  return other;
}

/**
 * Which axes are open for this request, best first: [{axis, score, why}]. A score near 1 means the plan
 * guessed that part; near 0 means the person said it. Earlier picks on an axis settle it (score × 0.3),
 * so the next round explores something else.
 */
export function pickAxes(context, request = '') {
  const plan = context?.plan ?? {};
  const spec = plan.spec ?? {};
  const req = String(request ?? '');
  const out = [];

  // look
  if (STYLE_WORDS.test(req)) out.push({ axis: 'look', score: 0.1, why: 'the request names a style' });
  else if (clarifyGuessed(plan, /look|style|art|vibe|visual/i)) out.push({ axis: 'look', score: 0.9, why: 'the plan guessed the look' });
  else out.push({ axis: 'look', score: 0.75, why: 'the request names no art style' });

  // twist: guessed when the request has few content words or the plan's twist shares little with it
  const reqWords = new Set(words(req));
  const twistWords = words(plan.design?.twist ?? '');
  const overlap = twistWords.length ? twistWords.filter((w) => reqWords.has(w)).length / twistWords.length : 0;
  const vague = reqWords.size <= 5 || !MECHANIC_CUES.test(req);
  if (!plan.design?.twist) out.push({ axis: 'twist', score: 0.2, why: 'the plan has no twist to vary' });
  else if (vague && overlap < 0.35) out.push({ axis: 'twist', score: 0.8, why: 'a vague request; Muse invented the twist' });
  else if (overlap < 0.2) out.push({ axis: 'twist', score: 0.5, why: 'the twist is mostly Muse\'s' });
  else out.push({ axis: 'twist', score: 0.2, why: 'the request sets the rules' });

  // arc
  const steps = spec.progression?.steps;
  if (!Array.isArray(steps) || !steps.length) out.push({ axis: 'arc', score: 0.1, why: 'the plan has no difficulty arc' });
  else if (DIFFICULTY_WORDS.test(req)) out.push({ axis: 'arc', score: 0.15, why: 'the request says how hard' });
  else if (clarifyGuessed(plan, /difficult|pace|speed|hard|level/i)) out.push({ axis: 'arc', score: 0.6, why: 'the plan guessed the difficulty' });
  else out.push({ axis: 'arc', score: 0.45, why: 'nobody said how hard' });

  // type
  const alt = closeType(context);
  out.push(alt
    ? { axis: 'type', score: 0.85, why: `two types are close: ${topType(context)?.id} and ${alt.id}`, type: alt.id }
    : { axis: 'type', score: 0, why: 'one type is a clear match' });

  const settled = new Set(preferencesOf(context).map((p) => p.axis));
  for (const a of out) if (settled.has(a.axis)) { a.score = Math.round(a.score * 30) / 100; a.why += '; settled by an earlier pick'; }
  return out.sort((x, y) => y.score - x.score || AXES.indexOf(x.axis) - AXES.indexOf(y.axis));
}

/** What the plan says today on an axis, as a short value. */
export function currentValue(context, axis) {
  const plan = context?.plan ?? {};
  const spec = plan.spec ?? {};
  switch (axis) {
    case 'look': return spec.theme?.look || spec.feel?.look || 'the plan\'s look';
    case 'twist': return plan.design?.twist || '';
    case 'arc': return (spec.progression?.steps ?? []).map((s) => `${s.at}: ${s.change}`).join('; ');
    case 'type': return (plan.type_ids ?? [])[0] ?? context?.types?.[0]?.id ?? '';
    default: return '';
  }
}

export const ALTERNATIVES_SYSTEM = `You help make tiny phone games. A plan for a game is settled except for one part, and the person will see two or three versions side by side and keep one. You write the other versions of that one part.
Every version keeps the plan's goal, its score and how friends compare results; only the named part changes. Make each alternative clearly different from the current one and from each other, still true to the request and its theme (keep any franchise, brand or character names the person used), and buildable as a 2-minute single-player game.
Reply with one JSON object: {"current_label": "...", "alternatives": [{"label": "...", "value": "..."}]}.
- label: 2-4 plain words a player would pick from, like "Pixel arcade" or "Steady climb". No brand words of ours.
- look: value is one art direction sentence: medium, palette mood, line and shading, how the player stands out.
- twist: value is one sentence: the custom rule that makes this version different, measurable by the same score.
- arc: value is three steps, "at: change" separated by "; ", easy to hard, using the plan's difficulty levers.`;

/** The user turn for the alternatives call. */
export function alternativesUser(context, request, axis, k) {
  const plan = context?.plan ?? {};
  const spec = plan.spec ?? {};
  const prefs = preferencesOf(context).map((p) => `- ${p.axis}: chose "${p.chosen?.label ?? p.chosen?.value ?? p.chosen}" over ${(p.rejected ?? []).map((r) => `"${r.label ?? r.value ?? r}"`).join(', ')}`);
  return [
    `Request: ${request}`,
    `Goal: ${spec.goal?.text ?? plan.design?.pitch ?? ''}`,
    `Theme: ${short(spec.theme?.world, 200)}${spec.theme?.named?.length ? ` (names: ${spec.theme.named.join(', ')})` : ''}`,
    `Loop: ${short(spec.loop?.verb, 40)}; ${short(spec.loop?.sees, 160)}`,
    `Levers: ${(spec.progression?.levers ?? []).join(', ')}`,
    '',
    `The part to vary: ${axis}.`,
    `Current ${axis}: ${currentValue(context, axis)}`,
    ...(prefs.length ? ['', 'The person\'s earlier picks (lean toward them):', ...prefs] : []),
    '',
    `Write ${k} alternative${k === 1 ? '' : 's'} for "${axis}", and a 2-4 word label for the current one.`,
  ].join('\n');
}

/** Alternatives that need no Muse: the looks we ship, and the runner-up type. */
export function fallbackAlternatives(context, axis, k) {
  if (axis === 'type') {
    const t = closeType(context);
    return t ? { current_label: topType(context)?.name ?? 'This game', alternatives: [{ label: t.name ?? t.id, value: t.id }] } : null;
  }
  if (axis === 'look') {
    const cur = String(currentValue(context, 'look')).toLowerCase();
    const picks = Object.entries(LOOKS).filter(([id]) => !cur.includes(id)).slice(0, k);
    return { current_label: 'Planned look', alternatives: picks.map(([id, value]) => ({ label: id[0].toUpperCase() + id.slice(1), value, look: id })) };
  }
  if (axis === 'arc') {
    const levers = context?.plan?.spec?.progression?.levers ?? [];
    const lever = levers[0] ?? 'speed';
    const options = [
      { label: 'Gentle climb', value: `start: generous ${lever}, lots of room; middle: a little tighter; end: only the last stretch is tense` },
      { label: 'Fast and hard', value: `start: already brisk ${lever}; middle: tight; end: right at the edge of possible` },
    ];
    return { current_label: 'Planned arc', alternatives: options.slice(0, k) };
  }
  return null;
}

function parseObject(text) {
  if (text && typeof text === 'object') return text;
  const s = String(text ?? '');
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; }
}

function cleanAlternatives(obj, k) {
  const list = Array.isArray(obj?.alternatives) ? obj.alternatives : [];
  const seen = new Set();
  const out = [];
  for (const a of list) {
    const label = short(a?.label, 32);
    const value = short(Array.isArray(a?.value) ? a.value.join('; ') : a?.value, 400);
    if (!label || !value || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push({ label, value });
    if (out.length >= k) break;
  }
  return out;
}

/** Turns an arc value ("at: change; at: change; …") into progression steps. */
export function arcSteps(value) {
  return String(value ?? '').split(/;\s*/).map((part) => {
    const m = part.match(/^\s*([^:]{1,40}):\s*(.+)$/);
    return m ? { at: m[1].trim(), change: m[2].trim() } : (part.trim() ? { at: '', change: part.trim() } : null);
  }).filter(Boolean).slice(0, 4);
}

/**
 * The plan and brief for one version. Version a is the plan as written; the others change only `axis`.
 * Returns {id, axis, label, value, context, brief, note}.
 */
export function variantBrief(context, brief, { id, axis, label, value, look }) {
  const ctx = clone(context ?? {});
  ctx.plan ??= {};
  ctx.plan.spec ??= {};
  const plan = ctx.plan;
  const spec = plan.spec;
  let note = '';
  if (axis === 'look') {
    spec.theme = { ...(spec.theme ?? {}), look: value };
    spec.feel = { ...(spec.feel ?? {}), look: value };
    note = `Art direction for this version: ${value} Draw the backdrop and every sprite in that style; keep the theme's names and words.`;
    if (look) note += ` Use the "${look}" look.`;
  } else if (axis === 'twist') {
    plan.design = { ...(plan.design ?? {}), twist: value };
    // Compose shows the spec, not the design, when there is a spec: the twist rides on the loop.
    spec.loop = { ...(spec.loop ?? {}), twist: value };
    note = `The twist for this version: ${value} Keep the goal, the score and how friends compare results.`;
  } else if (axis === 'arc') {
    const steps = arcSteps(value);
    if (steps.length) spec.progression = { ...(spec.progression ?? {}), steps };
    if (plan.design) plan.design.arc = steps.map((s) => (s.at ? `${s.at}: ${s.change}` : s.change));
    note = `The difficulty arc for this version: ${value}`;
  } else if (axis === 'type') {
    const t = (ctx.types ?? []).find((x) => x.id === value);
    if (t) {
      ctx.types = [t, ...ctx.types.filter((x) => x !== t)];
      plan.type_ids = [t.id];
      plan.blend = `${t.name ?? t.id}: ${t.core_loop ?? t.summary ?? ''}`;
      if (t.gate_profile) ctx.gate_profile = t.gate_profile;
      note = `Build this version as ${t.name ?? t.id}: ${short(t.core_loop ?? t.summary, 240)} Keep the plan's goal, theme and how friends compare results.`;
    }
  }
  ctx.notes = [...(Array.isArray(ctx.notes) ? ctx.notes : []), ...(note ? [`variant ${id}: ${note}`] : [])];
  const b = { ...(brief ?? {}) };
  if (note) b.notes = [b.notes, note].filter(Boolean).join(' ');
  return { id, axis: axis ?? null, label, value, ...(look ? { look } : {}), context: ctx, brief: b, note };
}

/**
 * The version briefs for a request: [a (the plan), b, c?]. With one axis, every version varies it; with
 * `axes` of two and n = 3, b varies the first axis and c the second. Calls Muse once for the
 * alternatives (spark, minimal); falls back to built-in ones when that fails.
 */
export async function planVariants({ request, brief = {}, context, n = 2, axes = null }, { ask = null, onEvent = () => {} } = {}) {
  n = Math.max(2, Math.min(MAX_VARIANTS, Number(n) || 2));
  ({ context, brief } = withPreferences(context, brief, request));
  const ranked = pickAxes(context, request);
  let chosen = (axes?.length ? axes : [ranked[0].axis]).filter((a) => AXES.includes(a));
  if (!chosen.length) chosen = [ranked[0].axis];
  if (chosen.includes('type') && !closeType(context)) chosen = chosen.filter((a) => a !== 'type').concat(chosen.length === 1 ? [ranked.find((r) => r.axis !== 'type').axis] : []);
  chosen = chosen.slice(0, n - 1);
  const perAxis = chosen.length === 1 ? n - 1 : 1;
  const calls = [];
  const variants = [];
  let currentLabel = null;
  // An axis that yields nothing (no alternatives from Muse or built in) hands over to the next best one.
  const backups = ranked.map((r) => r.axis).filter((a) => !chosen.includes(a) && (a !== 'type' || closeType(context)));
  const queue = [...chosen, ...backups];
  for (const axis of queue) {
    if (variants.length >= n - 1) break;
    if (!chosen.includes(axis) && variants.length) break;
    const want = chosen.includes(axis) ? perAxis : n - 1 - variants.length;
    let alts = null;
    let source = 'muse';
    if (axis !== 'type' && ask) {
      const t0 = Date.now();
      try {
        const r = await ask(ALTERNATIVES_SYSTEM, alternativesUser(context, request, axis, want), `variant alternatives (${axis})`, ALTERNATIVES_OPTIONS);
        const obj = parseObject(typeof r === 'string' ? r : r?.content);
        calls.push({ purpose: `variant alternatives (${axis})`, ms: Date.now() - t0, ...(r?.usage ? { usage: r.usage } : {}), ...(r?.model ? { model: r.model } : {}) });
        const list = cleanAlternatives(obj, want);
        if (list.length) alts = { current_label: short(obj.current_label, 32) || null, alternatives: list };
      } catch (e) {
        calls.push({ purpose: `variant alternatives (${axis})`, ms: Date.now() - t0, error: short(e?.message ?? e, 120) });
      }
    }
    if (!alts) { alts = fallbackAlternatives(context, axis, want); source = 'built-in'; }
    if (!alts?.alternatives?.length) continue;
    currentLabel ??= alts.current_label;
    for (const a of alts.alternatives) {
      if (variants.length >= n - 1) break;
      variants.push({ axis, ...a, source });
    }
  }
  const axis0 = variants[0]?.axis ?? chosen[0];
  const a = variantBrief(context, brief, { id: 'a', axis: null, label: currentLabel || 'As planned', value: currentValue(context, axis0) });
  a.axis = axis0;
  a.note = '';
  const out = [a, ...variants.map((v, i) => ({ ...variantBrief(context, brief, { id: IDS[i + 1], axis: v.axis, label: v.label, value: v.value, look: v.look }), source: v.source }))];
  onEvent({ kind: 'variants_planned', axes: [...new Set(out.slice(1).map((v) => v.axis))], labels: out.map((v) => v.label), summary: `Making ${out.length} versions: ${out.map((v) => v.label).join(' · ')}` });
  return { variants: out, axes: ranked, calls };
}

// MARK: - The cheap passes (shared mode)

export const RESTYLE_SYSTEM = `You are the art director of a tiny phone game. You get the game's "art" section (palette, font, backdrop and sprites drawn as SVG), its "look" and a new art direction. Redraw the art in the new direction.
Rules:
- Keep every sprite name, and each sprite's w, h, frames and cols. Draw every sprite again in the new style: silhouette, shading and a highlight, readable at 40 px. The player stands out from hazards by shape and color.
- palette uses only these roles: primary, secondary, accent, ink, bg, danger, surface, each #RRGGBB. ink must read on bg; danger stays a warning color.
- font is one of: system, Inter, Fraunces, Space Grotesk, Silkscreen, Avenir Next, Futura, Gill Sans, Optima, Georgia, Baskerville, American Typewriter, Chalkboard SE, Marker Felt, Noteworthy, Menlo, Courier New.
- The backdrop keeps its viewBox, draws the setting with depth and a few details at the edges, and keeps the middle quiet for play.
- SVG only with shapes, paths, gradients and text: no scripts, links, images, foreignObject or SMIL animation. A sprite stays under 24 KB, the backdrop under 64 KB.
- look.id is one of neon, paper, pixel, riso: pick the closest to the new direction.
- Keep the theme's names and words. Write "style" as one sentence describing the new direction.
Reply with one JSON object: {"art": {...}, "look": {"id": "...", "tokens": {}}}. No text around it.`;

export function restyleUser(authoring, direction) {
  const art = authoring?.art ?? {};
  return [
    `Theme: ${(authoring?.design?.theme ?? []).slice(0, 12).join(', ')}`,
    `New art direction: ${direction}`,
    '',
    'Current look:', JSON.stringify(authoring?.look ?? {}),
    '',
    'Current art:', JSON.stringify(art),
  ].join('\n');
}

function authoringOf(manifest) {
  const c = manifest?.content ?? {};
  if (typeof c.authoring_json === 'string') return JSON.parse(c.authoring_json);
  return c.authoring ?? null;
}

/**
 * A look version made from a finished game: Muse redraws only `art` (and picks the look), then the game is
 * expanded, validated and gated again. The rules are untouched, so the score model and group play carry over.
 */
export async function restyle(base, direction, studio, { ask, id = 'b' } = {}) {
  const authoring = authoringOf(base.manifest);
  if (!authoring) throw new Error('the base game has no authoring manifest');
  const t0 = Date.now();
  const r = await ask(RESTYLE_SYSTEM, restyleUser(authoring, direction), `variant restyle (${id})`, RESTYLE_OPTIONS);
  const call = { purpose: `variant restyle (${id})`, ms: Date.now() - t0, ...(r?.usage ? { usage: r.usage } : {}), ...(r?.model ? { model: r.model } : {}) };
  const reply = parseObject(typeof r === 'string' ? r : r?.content);
  if (!reply?.art || typeof reply.art !== 'object') throw Object.assign(new Error('the restyle reply had no art'), { calls: [call] });
  // Sprites Muse dropped keep their old drawing, so the game never loses a piece.
  const art = { ...reply.art, sprites: { ...(authoring.art?.sprites ?? {}), ...(reply.art.sprites ?? {}) } };
  const next = { ...authoring, art, ...(reply.look && typeof reply.look === 'object' && reply.look.id ? { look: { id: String(reply.look.id), tokens: reply.look.tokens ?? {} } } : {}) };
  let expansion = studio.expand(JSON.stringify(next));
  let usedArt = 'new';
  if (!expansion.ok) {
    // Art that doesn't validate: keep the new palette, font and look over the old drawings.
    const fallback = { ...next, art: { ...authoring.art, ...(reply.art.palette ? { palette: reply.art.palette } : {}), ...(reply.art.font ? { font: reply.art.font } : {}), ...(reply.art.style ? { style: reply.art.style } : {}) } };
    expansion = studio.expand(JSON.stringify(fallback));
    usedArt = 'palette only';
  }
  if (!expansion.ok) throw Object.assign(new Error('the restyled game does not validate'), { calls: [call] });
  const report = await studio.gate(expansion.playtest_game_json || expansion.game_json, 1);
  const manifest = studio.wrap({
    id: `${String(base.manifest.id ?? 'mg-game').replace(/-[a-z0-9]{4}$/, '')}-${id}${Math.random().toString(36).slice(2, 5)}`,
    game_json: expansion.game_json,
    authoring_json: expansion.authoring_json ?? JSON.stringify(next),
    brief: base.manifest.brief,
    seed: base.manifest.seed,
    ...(base.manifest.score ? { score: base.manifest.score } : {}),
  });
  if (base.manifest.group_play) manifest.group_play = base.manifest.group_play;
  if (base.manifest.studio) manifest.studio = { ...base.manifest.studio, restyled_from: base.manifest.id };
  return { manifest, gate: { passed: !!report.passed, summary: report.summary ?? '' }, quality: base.quality ?? null, score: base.score ?? null, stats: { museCalls: 1, calls: [call], art: usedArt, seconds: round1((Date.now() - t0) / 1000) } };
}

/** The request text for a revision pass that turns version a into another twist or arc. */
export function revisionRequest(v) {
  if (v.axis === 'twist') return `Change the twist only: ${v.value} Keep the theme, the goal, the score, the art and how friends compare results.`;
  if (v.axis === 'arc') return `Change only the difficulty arc: ${v.value} Keep the theme, the goal, the score, the art and the rules otherwise.`;
  return v.note || v.value;
}

// MARK: - Posters and picking

/** What the picker shows for a version before anyone plays it: the app draws the card from this. */
export function posterOf(manifest, v) {
  const a = (() => { try { return authoringOf(manifest); } catch { return null; } })();
  return {
    title: manifest?.title ?? a?.meta?.title ?? '',
    line: manifest?.one_line_rule ?? '',
    label: v.label,
    axis: v.axis,
    emoji: manifest?.style?.emoji ?? null,
    colors: manifest?.style?.colors ?? null,
    font: manifest?.style?.font ?? null,
    look: a?.look?.id ?? manifest?.style?.look ?? null,
    art_style: a?.art?.style ?? null,
    twist: a?.design?.twist ?? null,
  };
}

function rankable(r) {
  return [r.gate?.passed ? 1 : 0, Number(r.quality?.score ?? 0), r.score?.ranked ? 1 : 0];
}

/** The version to put first: passed the gate, best quality score, ranked board; ties go to the plan (a). */
export function recommend(variants) {
  let best = null;
  for (const v of variants) {
    if (!best) { best = v; continue; }
    const x = rankable(v);
    const y = rankable(best);
    for (let i = 0; i < x.length; i++) { if (x[i] !== y[i]) { if (x[i] > y[i]) best = v; break; } }
  }
  return best?.id ?? null;
}

function tokensOf(calls) {
  return (calls ?? []).reduce((t, c) => {
    const u = c.usage ?? {};
    t.prompt += u.prompt_tokens ?? 0;
    t.completion += u.completion_tokens ?? 0;
    return t;
  }, { prompt: 0, completion: 0 });
}

/**
 * The whole step. args: {request, brief, context, n = 2, axes?, mode = 'auto' | 'separate' | 'shared'}.
 * 'auto' restyles for a look axis and composes separately otherwise. Returns
 * {variants: [{id, axis, label, value, manifest, poster, gate, quality, score, stats, how}], recommended,
 *  dropped: [{id, axis, label, reason}], axes, stats: {wall_s, muse_calls, tokens, calls}}.
 * Only versions that built and passed the gate are kept; a request where none passed throws.
 */
export async function makeVariants(args, studio, { ask, onEvent = () => {} } = {}) {
  const started = Date.now();
  const { request, brief = {}, context = null } = args;
  const mode = args.mode ?? 'auto';
  const planned = await planVariants({ request, brief, context, n: args.n ?? 2, axes: args.axes ?? null }, { ask, onEvent });
  const calls = [...planned.calls];
  const dropped = [];
  const done = new Map();
  const tag = (id) => (e) => onEvent({ ...e, variant: id });

  const composeOne = async (v) => {
    const t0 = Date.now();
    const r = await studio.compose({ request, brief: v.brief, context: v.context }, ask, tag(v.id));
    return { ...r, how: 'compose', wall_ms: Date.now() - t0 };
  };
  const cheapOne = async (v, base) => {
    const t0 = Date.now();
    if (v.axis === 'look') {
      const r = await restyle(base, v.value, studio, { ask, id: v.id });
      return { ...r, how: 'restyle', wall_ms: Date.now() - t0 };
    }
    const r = await studio.compose({ request: revisionRequest(v), brief: v.brief, context: v.context, base: base.manifest }, ask, tag(v.id));
    return { ...r, how: 'revise', wall_ms: Date.now() - t0 };
  };
  const settle = (v, p) => p.then((r) => { done.set(v.id, r); return r; }, (e) => {
    calls.push(...(e?.calls ?? e?.stats?.calls ?? []));
    dropped.push({ id: v.id, axis: v.axis, label: v.label, reason: short(e?.message ?? e, 200) });
    onEvent({ kind: 'variant_dropped', variant: v.id, reason: short(e?.message ?? e, 200), summary: `${v.label} didn't make it` });
    return null;
  });

  const [first, ...rest] = planned.variants;
  const cheap = (v) => mode === 'shared' ? v.axis !== 'type' : mode === 'auto' ? v.axis === 'look' : false;
  const sep = rest.filter((v) => !cheap(v));
  const shared = rest.filter(cheap);
  const firstP = settle(first, composeOne(first));
  const sepP = sep.map((v) => settle(v, composeOne(v)));
  const base = await firstP;
  const sharedP = shared.map((v) => (base ? settle(v, cheapOne(v, base)) : Promise.resolve(dropped.push({ id: v.id, axis: v.axis, label: v.label, reason: 'version a failed, so there was nothing to restyle' }) && null)));
  await Promise.all([...sepP, ...sharedP]);

  const variants = [];
  for (const v of planned.variants) {
    const r = done.get(v.id);
    if (!r) continue;
    calls.push(...(r.stats?.calls ?? []));
    if (!r.gate?.passed) {
      dropped.push({ id: v.id, axis: v.axis, label: v.label, reason: `the playtest flagged it: ${short(r.gate?.summary, 160)}` });
      onEvent({ kind: 'variant_dropped', variant: v.id, reason: 'playtest', summary: `${v.label} didn't pass the playtest` });
      continue;
    }
    r.manifest.variant = { id: v.id, axis: v.axis, label: v.label, of: planned.variants.length };
    const out = { id: v.id, axis: v.axis, label: v.label, value: v.value, manifest: r.manifest, poster: posterOf(r.manifest, v), gate: r.gate, quality: r.quality ?? null, score: r.score ?? null, how: r.how, stats: { seconds: round1(r.wall_ms / 1000), muse_calls: r.stats?.museCalls ?? null, tokens: tokensOf(r.stats?.calls) } };
    variants.push(out);
    onEvent({ kind: 'variant_ready', variant: v.id, label: v.label, summary: `${v.label} is ready` });
  }
  if (!variants.length) {
    const e = new Error(`no version passed: ${dropped.map((d) => `${d.id} ${d.reason}`).join('; ')}`);
    e.dropped = dropped;
    throw e;
  }
  return {
    variants,
    recommended: recommend(variants),
    dropped,
    axes: planned.axes,
    stats: { wall_s: round1((Date.now() - started) / 1000), muse_calls: calls.filter((c) => !c.error).length, tokens: tokensOf(calls), calls },
  };
}

// MARK: - Learning from the pick

/**
 * The event the app sends when the person keeps one version (POST /v1/games/{id}/pick):
 * {kind: 'variant_pick', group, axis, chosen: {id, game_id, label, value}, rejected: [...], played: [ids], at}.
 */
export function pickEvent(result, chosenId, { played = [], at = new Date().toISOString(), group = null } = {}) {
  const list = result?.variants ?? [];
  const chosen = list.find((v) => v.id === chosenId);
  if (!chosen) throw new Error(`no version '${chosenId}'`);
  const brief = (v) => ({ id: v.id, game_id: v.manifest?.id ?? v.game_id ?? null, label: v.label, value: short(v.value, 300) });
  return {
    kind: PICK_EVENT,
    group: group ?? list.map((v) => v.manifest?.id ?? v.game_id).filter(Boolean).join('+'),
    axis: chosen.axis,
    chosen: brief(chosen),
    rejected: list.filter((v) => v !== chosen).map(brief),
    played: played.filter((id) => list.some((v) => v.id === id)),
    at,
  };
}

/** Checks a pick event's shape; returns a list of problems (empty when it is fine). */
export function pickProblems(e) {
  const p = [];
  if (e?.kind !== PICK_EVENT) p.push(`kind must be ${PICK_EVENT}`);
  if (!AXES.includes(e?.axis)) p.push(`axis must be one of ${AXES.join(', ')}`);
  if (!e?.chosen?.label) p.push('chosen needs a label');
  if (!Array.isArray(e?.rejected) || !e.rejected.length) p.push('rejected needs at least one version');
  return p;
}

/**
 * Folds a pick into the next plan's context: a `preferences` entry {axis, chosen, rejected, at} and a line in
 * `notes` the planner and compose read. A later pick on the same axis replaces the earlier one.
 */
export function applyPick(context, e) {
  const problems = pickProblems(e);
  if (problems.length) throw new Error(`bad pick: ${problems.join('; ')}`);
  const ctx = clone(context ?? {});
  const pref = { axis: e.axis, chosen: { label: e.chosen.label, value: e.chosen.value ?? '' }, rejected: e.rejected.map((r) => ({ label: r.label, value: r.value ?? '' })), at: e.at ?? null };
  ctx.preferences = [...preferencesOf(ctx).filter((p) => p.axis !== e.axis), pref];
  const line = preferenceNote(pref);
  ctx.notes = [...(Array.isArray(ctx.notes) ? ctx.notes : []).filter((n) => !String(n).startsWith(`preference (${e.axis}):`)), line];
  return ctx;
}

/**
 * Earlier picks applied to a new plan. Every preference becomes a line in the brief's notes (compose reads
 * those). A look preference also sets the spec's look when the request names no style of its own; twist and
 * arc picks belong to one game, so they only lean.
 */
export function withPreferences(context, brief = {}, request = '') {
  const prefs = preferencesOf(context);
  if (!prefs.length) return { context, brief };
  const ctx = clone(context);
  const lines = [];
  for (const p of prefs) {
    if (p.axis === 'look' && !STYLE_WORDS.test(String(request ?? '')) && p.chosen?.value && ctx.plan?.spec) {
      ctx.plan.spec.theme = { ...(ctx.plan.spec.theme ?? {}), look: p.chosen.value };
      ctx.plan.spec.feel = { ...(ctx.plan.spec.feel ?? {}), look: p.chosen.value };
    }
    lines.push(`Earlier, ${preferenceNote(p).replace(/^preference \([a-z]+\): /, '')}`);
  }
  const notes = [brief?.notes, ...lines].filter(Boolean).join(' ');
  return { context: ctx, brief: { ...(brief ?? {}), notes } };
}

export function preferenceNote(p) {
  return `preference (${p.axis}): the person chose "${p.chosen.label}"${p.chosen.value ? ` (${short(p.chosen.value, 160)})` : ''} over ${p.rejected.map((r) => `"${r.label}"`).join(', ')}; lean that way.`;
}
