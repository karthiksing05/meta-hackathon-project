// Remix (docs/REMIX.md): a change to a published game makes a NEW game that keeps what the person didn't ask to
// change and changes exactly what they asked.
//
//   baseSummary     what the base game is, read from its manifest: title, rule, theme, its sprites (painted or
//                   SVG), its art style and palette
//   planRemix       before compose and the painting: which of the base's sprites the change repaints (a new main
//                   character, new side characters, a restyle) and what each now shows, plus a new backdrop when
//                   the setting changes. One small Muse call when the request touches the look; a word match when
//                   that call fails; nothing at all for a rules-only change (no Muse call, every painting kept).
//   rebuildRequest  a base with no authoring source (hand-built or older games): the published game described as
//                   a request, so Muse rebuilds it as a new game with the change applied, instead of failing.
//   remixReport     after the art step: which repaints landed and which kept the base's painting (stats.remix).
//
// The repainted sprites keep their base ids, so every figure that drew the old picture now draws the new one.

const clip = (v, n) => { const s = typeof v === 'string' ? v : JSON.stringify(v ?? ''); return s.length > n ? s.slice(0, n) + '...' : s; };
const RASTER = /^data:image\/(png|jpe?g|webp|gif)/;
const isRaster = (s) => typeof s?.image === 'string' && RASTER.test(s.image);
const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

const CHARACTERISH = /\b(avatar|player|hero|heroine|main|char|character|host|chaser|enemy|enemies|boss|villain|rival|npc|mascot|pet|monster|creature|ghost|cat|dog|bird|owl|pigeon|person|kid|runner|driver|pilot|knight|wizard|chef|robot|alien|friend|buddy|sidekick|opponent|guard|cop|zombie)\b/i;
const UIISH = /\b(life|lives|heart|hud|meter|bar|button|btn|panel|frame|ring|dot|grid|cell|tile|slot|badge|banner|bg|backdrop|background|icon|arrow|cursor|ui|particle|spark|glow|fx|label|score|timer|board|card)\b/i;

/** Does the request touch the look (characters, sprites, art, setting)? A rules-only change does not. */
export const ART_CHANGE = /\b(sprites?|characters?|main|hero|heroine|player|avatar|protagonist|enemy|enemies|villain|chaser|side|npcs?|cast|mascot|look|looks|art|style|restyle|reskin|skin|theme|themed|setting|world|background|backdrop|scene|picture|pictures|draw|paint|repaint|replace|swap|instead of|turn (?:it|them|him|her) into|make (?:it|them|him|her|the \w+) (?:a|an|into)|as (?:a|an) )\b/i;

/**
 * baseSummary(base) -> {title, rule, theme, sprites: [{id, painted, character}], style, palette, backdrop, authoring}
 * Works on a manifest with content.authoring_json, else on its game_json (assets), else on its top-level fields.
 */
export function baseSummary(base) {
  const out = { title: String(base?.title ?? 'the game'), rule: String(base?.one_line_rule ?? base?.oneLineRule ?? ''), theme: [], pitch: '', sprites: [], style: '', palette: [], backdrop: false, authoring: false };
  let A = null, G = null;
  try { A = JSON.parse(base?.content?.authoring_json ?? 'null'); } catch { A = null; }
  try { G = JSON.parse(base?.content?.game_json ?? 'null'); } catch { G = null; }
  out.authoring = !!A;
  const design = A?.design ?? null;
  if (design) {
    out.theme = (Array.isArray(design.theme) ? design.theme : typeof design.theme === 'string' ? [design.theme] : []).map(String).slice(0, 16);
    out.pitch = String(design.pitch ?? '');
  }
  const art = A?.art ?? null;
  const sprites = art?.sprites ?? G?.assets ?? {};
  for (const [id, s] of Object.entries(sprites)) {
    if (id === 'backdrop' || !s || typeof s !== 'object' || s.sound) continue;
    out.sprites.push({ id, painted: isRaster(s), character: CHARACTERISH.test(id.replace(/_/g, ' ')) && !UIISH.test(id.replace(/_/g, ' ')) });
  }
  out.style = String(art?.style ?? '');
  out.palette = [...new Set((JSON.stringify(art?.palette ?? '').match(/#[0-9a-fA-F]{6}\b/g) ?? []))].slice(0, 7);
  out.backdrop = isRaster(art?.backdrop) || isRaster(G?.assets?.backdrop);
  return out;
}

/** The planner's prompt: the base's sprites and theme, the change, and the JSON shape to answer in. */
export function remixPlanPrompt(summary, request) {
  const system = 'You plan the art for a remix of a small mobile game. The remix keeps every picture the change does not touch. Reply with JSON only.';
  const user = [
    `The game: "${clip(summary.title, 80)}". ${clip(summary.rule, 200)}`,
    summary.pitch ? `Pitch: ${clip(summary.pitch, 400)}` : '',
    summary.theme.length ? `Theme words: ${clip(summary.theme.join(', '), 400)}` : '',
    summary.style ? `Current art direction: ${clip(summary.style, 300)}` : '',
    'Its sprites (id: what kind):',
    ...summary.sprites.map((s) => `- ${s.id}${s.character ? ' (a character)' : ''}${s.painted ? ', painted' : ''}`),
    '',
    `The change the person asked for: ${clip(request, 800)}`,
    '',
    'Decide which sprites must show something new because of the change. Keep a sprite (leave it out of "repaint") unless the change names it, its role (main character, side characters, enemies, items...) or a restyle of the whole game. Keep real names exactly as the person wrote them.',
    'Answer with this JSON:',
    '{"repaint": [{"id": "<one of the sprite ids above>", "depicts": "<what it shows now, a short noun phrase>", "kind": "character" | "object"}],',
    ' "restyle": <true only if the person asked for a different art style for the whole game>,',
    ' "style": "<the art style in a few words, subjects left out: the current one unless restyle>",',
    ' "backdrop": "<a new background scene, only if the setting changes, else null>"}',
  ].filter(Boolean).join('\n');
  return { system, user };
}

/** Pulls the noun phrase after "main character/sprite ... (to be | a | into)" and after "side characters ...". */
function phraseAfter(text, re) {
  const m = String(text).match(re);
  if (!m) return null;
  return m[1].replace(/^(?:be|is|are|to be|into|to|become|becomes|now)\s+/i, '').replace(/^(?:a|an|the|some)\s+/i, '').replace(/[.!?;]+$/, '').trim().slice(0, 80) || null;
}

/**
 * heuristicRemixPlan(summary, request) -> plan
 * The word-match plan when Muse can't plan: "main character/sprite/player X" repaints the main character sprite,
 * "side characters/enemies Y" the other character sprites, a sprite named in the request with "into/as/to" too.
 */
export function heuristicRemixPlan(summary, request) {
  const text = String(request ?? '');
  const plan = { repaint: [], restyle: /\b(restyle|art style|style|look)\b/i.test(text) && /\b(pixel|8-bit|watercolou?r|anime|cartoon|clay|paper|realistic|retro|neon|noir|sketch|crayon|style)\b/i.test(text), style: '', backdrop: null, source: 'words' };
  const chars = summary.sprites.filter((s) => s.character);
  const MAIN = /\b(avatar|player|hero|heroine|main|runner|protagonist)\b/i;
  const main = chars.find((s) => MAIN.test(s.id.replace(/_/g, ' '))) ?? chars[0] ?? null;
  const mainWant = phraseAfter(text, /\b(?:main|lead|player|hero|protagonist)\s*(?:character|sprite|player)?s?\s+(?:to be|be|is|into|to|become|as|now)?\s*([^,.;]+?)(?=\s+and\s+(?:the\s+)?(?:side|other|enemies|enemy|chaser|villain)|[,.;]|$)/i);
  const sideWant = phraseAfter(text, /\b(?:side|other|supporting|secondary)\s*(?:characters?|sprites?|cast)\s+(?:to be|be|are|into|to|become|as|now)?\s*([^,.;]+)/i)
    ?? phraseAfter(text, /\b(?:enemies|enemy|chasers?|villains?)\s+(?:to be|be|are|into|to|become|as|now)?\s*([^,.;]+)/i);
  if (main && mainWant) plan.repaint.push({ id: main.id, depicts: mainWant, kind: 'character' });
  if (sideWant) for (const s of chars) if (s !== main || !mainWant) if (!plan.repaint.some((r) => r.id === s.id)) plan.repaint.push({ id: s.id, depicts: sideWant, kind: 'character' });
  // "make the coin a donut", "swap the train for a pipe": a sprite named in the request
  for (const s of summary.sprites) {
    if (plan.repaint.some((r) => r.id === s.id)) continue;
    const name = s.id.replace(/_/g, ' ');
    const want = phraseAfter(text, new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\s+(?:(?:to be|be|into|to|become|as|now|with|for)\\s+)+([^,.;]+?)(?=\\s+and\\s|[,.;]|$)`, 'i'));
    if (want) plan.repaint.push({ id: s.id, depicts: want, kind: s.character ? 'character' : 'object' });
  }
  if (plan.restyle) for (const s of summary.sprites) if (s.painted && !plan.repaint.some((r) => r.id === s.id)) plan.repaint.push({ id: s.id, depicts: s.id.replace(/_/g, ' '), kind: s.character ? 'character' : 'object' });
  return plan;
}

/** A Muse answer made safe: only base sprite ids, short strings, at most 16 repaints. */
export function cleanPlan(raw, summary) {
  const ids = new Set(summary.sprites.map((s) => s.id));
  const plan = { repaint: [], restyle: raw?.restyle === true, style: typeof raw?.style === 'string' ? raw.style.slice(0, 200) : '', backdrop: typeof raw?.backdrop === 'string' && raw.backdrop.trim() && !/^null$/i.test(raw.backdrop.trim()) ? raw.backdrop.trim().slice(0, 300) : null, source: 'muse' };
  for (const r of Array.isArray(raw?.repaint) ? raw.repaint : []) {
    if (!r || !ids.has(r.id) || plan.repaint.some((x) => x.id === r.id)) continue;
    const depicts = String(r.depicts ?? '').trim().slice(0, 120);
    if (!depicts) continue;
    plan.repaint.push({ id: r.id, depicts, kind: r.kind === 'object' ? 'object' : 'character' });
    if (plan.repaint.length >= 16) break;
  }
  return plan;
}

/**
 * planRemix({summary, request, muse, signal}) -> {repaint, restyle, style, backdrop, source: 'none'|'muse'|'words', error?}
 * A rules-only change (no ART_CHANGE words) keeps every picture and calls nothing.
 */
export async function planRemix({ summary, request, muse, signal = null, model = 'muse-wonder-1.0' }) {
  if (!ART_CHANGE.test(String(request ?? '')) || !summary.sprites.length) return { repaint: [], restyle: false, style: '', backdrop: null, source: 'none' };
  const words = heuristicRemixPlan(summary, request);
  if (typeof muse?.chatJSON !== 'function' || signal?.aborted) return words;
  try {
    const { system, user } = remixPlanPrompt(summary, request);
    const r = await muse.chatJSON({ model, system, user, maxTokens: 4000, reasoningEffort: 'low', timeout: 60, maxAttempts: 1 }, 'remix_plan');
    const text = typeof r?.content === 'string' ? r.content : JSON.stringify(r?.content ?? null);
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    const raw = JSON.parse(text.slice(start, end + 1));
    const plan = cleanPlan(raw, summary);
    // Muse said nothing changes but the words clearly name a swap: trust the words.
    if (!plan.repaint.length && words.repaint.length) return { ...words, source: 'words', error: 'Muse planned no repaint' };
    return plan;
  } catch (e) {
    return { ...words, error: String(e?.message ?? e).slice(0, 160) };
  }
}

/** The cast cells for the repaint (no poses: the base ids are single pictures that the game already draws). */
export function repaintCast(plan) {
  return plan.repaint.map((r) => ({ id: r.id, name: r.depicts, text: r.depicts, kind: r.kind, pose: null, of: r.id, repaint: true }));
}

/** The compose steering for a remix's pictures: what each repainted id now shows, and that every other picture stays. */
export function remixBrief(plan, kept) {
  if (!plan.repaint.length && !plan.backdrop) return '';
  const lines = ['', 'REMIX PICTURES: this is a remix of the game above. Keep every sprite id. These ids get NEW paintings that show:'];
  for (const r of plan.repaint) lines.push(`- ${r.id}: ${r.depicts}`);
  if (kept.length) lines.push(`These keep the original paintings: ${kept.join(', ')}.`);
  if (plan.backdrop) lines.push(`The background is repainted as: ${plan.backdrop}.`);
  lines.push('Rename the game, its words, design.theme and design.pitch to match the new cast; keep the rules, controls, scoring and difficulty unless the change asks otherwise.');
  return lines.join('\n');
}

/**
 * rebuildRequest(base, request) -> string
 * A base without content.authoring_json: the published game as a request (title, rule, brief, its game rules
 * with the pictures and sounds left out), with the change to apply.
 */
export function rebuildRequest(base, request) {
  let G = null;
  try { G = JSON.parse(base?.content?.game_json ?? 'null'); } catch { G = null; }
  const slim = G ? JSON.stringify({ ...G, assets: Object.keys(G.assets ?? {}) }).replace(/"data:[^"]{40,}"/g, '"(media)"') : '';
  const brief = base?.brief ? clip(base.brief, 600) : '';
  return [
    `Remake this published game as a new game with the same rules, controls, scoring, genre and feel: "${clip(base?.title ?? 'the game', 80)}". ${clip(base?.one_line_rule ?? '', 300)}`,
    brief ? `Its brief: ${brief}` : '',
    slim ? `Its built game (rules and layout; pictures left out): ${clip(slim, 9000)}` : '',
    '',
    `Then apply this change: ${clip(request, 800)}`,
  ].filter(Boolean).join('\n');
}

/**
 * remixReport({plan, manifest, basePool}) -> {source, repaint: [{id, depicts, painted}], kept, backdrop, failed: [ids]}
 * painted: the remix's picture for that id is a new painting (not the base's); failed lists the ones that are not.
 */
export function remixReport({ plan, manifest, basePool = {} }) {
  let G = null;
  try { G = JSON.parse(manifest?.content?.game_json ?? 'null'); } catch { G = null; }
  const assets = G?.assets ?? {};
  const repaint = plan.repaint.map((r) => {
    const s = assets[r.id];
    const painted = isRaster(s) && s.image !== basePool[r.id]?.image;
    return { id: r.id, depicts: r.depicts, painted };
  });
  return {
    source: plan.source, restyle: !!plan.restyle, repaint,
    kept: Object.keys(basePool).filter((id) => !plan.repaint.some((r) => r.id === id)),
    backdrop: plan.backdrop ? 'repainted' : 'kept',
    failed: repaint.filter((r) => !r.painted).map((r) => r.id),
    ...(plan.error ? { plan_error: plan.error } : {}),
  };
}

// ---------------------------------------------------------------------------------------------- the loop
//
// What a remix may and may not change (Karthik, 2026-11-13): it never changes the essential goal of the game. The
// core loop and goal are locked: the formula, the win and lose shape, what the player is trying to do and how the
// score works. Everything else is free: the content (questions, topics, words, levels, characters, sprites), the
// answering format (multiple choice to type-in, swipe or tap-the-picture) as long as the loop stays the same, the
// visual style, palette and backdrop, special effects and juice, sound, copy and theme.

/** The compose steering every remix gets, in place of "keep it nearly identical". */
export function remixRules() {
  return [
    '',
    'REMIX RULES: this is a remix of the game above, a new game made from it.',
    'LOCKED (never change): the essential goal and the core loop. Keep the genre, what the player is trying to do, how a run is won or lost or ends on time (objectives win, lose, time_limit, on_timeout), and how the score works (the score expression still exists and higher or lower is still better, as in the original). A trivia game stays a trivia game, a runner stays a runner.',
    'FREE (change what the request asks): the content (questions, topics, words, levels, characters and sprites), the answering format (multiple choice, type-in, swipe, tap-the-picture) as long as the loop stays the same, the visual style, palette and backdrop, special effects and juice (add or remove them), sound, the copy and the theme. Rename the game when its theme changes.',
    'Change exactly what the request asks; keep everything else as it is.',
  ].join('\n');
}

const GENRES = ['endless runner', 'runner', 'platformer', 'shooter', 'puzzle', 'trivia', 'quiz', 'racing game', 'racer', 'rhythm game', 'memory game', 'match-3', 'word game', 'typing game', 'fighting game', 'strategy game', 'tower defense', 'card game', 'clicker', 'idle game', 'maze', 'dodger', 'dodge game', 'story', 'visual novel', 'sports game', 'golf game', 'pinball', 'snake', 'tetris'];

/**
 * genreChange(request, summary) -> null | {genre, text}
 * "turn this trivia game into a runner": a request to change the genre, which a remix declines.
 */
export function genreChange(request, summary = null) {
  const text = String(request ?? '');
  const alt = GENRES.map((g) => g.replace(/[-]/g, '[- ]?').replace(/\s+/g, '\\s+')).join('|');
  const m = text.match(new RegExp(`\\b(?:turn|make|change|convert|transform|switch|rebuild|remake)\\b[^.;!?]{0,60}?\\b(?:into|to|as)\\s+(?:a|an)?\\s*(?:[\\w'-]+\\s+){0,2}?(${alt})s?\\b`, 'i'));
  if (!m) return null;
  const genre = m[1].toLowerCase().replace(/\s+/g, ' ');
  const about = summary ? `${summary.title} ${summary.rule} ${summary.pitch} ${(summary.theme ?? []).join(' ')}`.toLowerCase() : '';
  const root = genre.split(' ')[0].replace(/(?:er|game)$/, '');
  if (about && (about.includes(genre) || (root.length > 3 && about.includes(root)))) return null; // already that kind of game
  return { genre, text: m[0] };
}

/** The steering for a declined genre change: keep the loop, apply what fits. */
export function genreNote(change) {
  return `\nThe request also asks to turn the game into a ${change.genre}. A remix keeps the core loop and goal, so do not change the genre: keep the loop and apply what fits (the theme, characters, content and style that request implies).`;
}

const parse = (t) => { try { return typeof t === 'string' ? JSON.parse(t) : t && typeof t === 'object' ? t : null; } catch { return null; } };

/**
 * loopSignature(manifest) -> {formula, ends: ['lost', 'timeout', 'won'], score: bool, direction}
 * What a remix keeps, read deterministically from the manifest and its authoring source.
 */
export function loopSignature(manifest) {
  const A = parse(manifest?.content?.authoring_json) ?? {};
  const o = A.objectives ?? {};
  const ends = new Set();
  if (o.win) ends.add('won');
  if (o.lose) ends.add('lost');
  if (o.time_limit) { ends.add('timeout'); if (o.on_timeout === 'win') ends.add('won'); if (o.on_timeout === 'lose') ends.add('lost'); }
  const score = A.score ?? manifest?.score ?? null;
  return { formula: manifest?.formula ?? null, ends: [...ends].sort(), score: !!(o.score || score), direction: score?.direction ?? (o.score ? 'higher' : null) };
}

/**
 * loopCheck(base, remix) -> {ok, hard: [...], soft: [...]}
 * hard: the formula changed, the score is gone, or it points the other way. soft: the end states differ.
 */
export function loopCheck(base, remix) {
  const a = loopSignature(base), b = loopSignature(remix);
  const hard = [], soft = [];
  if (a.formula && b.formula && a.formula !== b.formula) hard.push(`the formula changed from ${a.formula} to ${b.formula}`);
  if (a.score && !b.score) hard.push('the score is gone');
  if (a.direction && b.direction && a.direction !== b.direction) hard.push(`the score now counts ${b.direction} as better instead of ${a.direction}`);
  if (a.ends.join() !== b.ends.join()) soft.push(`the end states changed from ${a.ends.join('/') || 'none'} to ${b.ends.join('/') || 'none'}`);
  return { ok: !hard.length && !soft.length, hard, soft, base: a, remix: b };
}
