// Visual critique loop, for what code can't fix. Renders a game's frames (intro, mid, end) with the
// engine's renderer, asks a vision judge to grade them against a fixed checklist, then runs one
// targeted repair that may change layout parameters only (never rules, state or inputs), re-renders
// and re-checks. At most 2 rounds; a round is kept only if the layout lint doesn't get worse and the
// critique's failures go down.
//
// Pure: the judge and the repairer are functions the caller passes in, so the pipeline can use Muse
// (museVision below, muse-wonder-1.0 with image input) and an experiment can use another judge.
//   judge(system, userText, pngs: Buffer[]) → Promise<text (JSON)>
//   repair(system, userText) → Promise<text (JSON)>
// Not wired into the pipeline: the integrator calls critiqueLoop (see the hook request).

import { layoutCheck, walkNodes } from './layout-check.mjs';
import { loadEngine } from '../expander/engine.mjs';

/** The fixed checklist. ids are stable: findings and stats key on them. */
export const CHECKLIST = [
  { id: 'V_OVERLAP', ask: 'Nothing overlaps that shouldn\'t: no text over text, no sprite over the score, timer or buttons, no button over another.' },
  { id: 'V_LEGIBLE', ask: 'Every word is readable at phone size: big enough, high contrast against what is behind it, not cut off at an edge or a tile border.' },
  { id: 'V_HIERARCHY', ask: 'The eye goes first to the play area, then the main action, then the HUD; one thing is clearly the most important; the HUD is calm and consistent.' },
  { id: 'V_SUBJECT', ask: 'The main subject (the player, the pieces, the cards) reads at play size: a clear silhouette, distinct from hazards and from the backdrop.' },
  { id: 'V_STYLE', ask: 'The art style matches what the person asked for (theme, mood, named style), and sprites, backdrop and UI share one style.' },
  { id: 'V_CONSISTENT', ask: 'The same component looks the same everywhere: buttons, tiles, labels and HUD items keep one size, shape, font and color treatment across the frames.' },
];

/** Keys a layout repair may change on a presentation node. Everything else is refused. */
export const LAYOUT_KEYS = new Set(['x', 'y', 'w', 'h', 'r', 'size', 'gap', 'cell_size', 'anchor', 'align', 'valign', 'wrap', 'radius', 'opacity', 'stroke', 'stroke_width', 'color', 'fill', 'line_height', 'scale', 'weight']);

export function judgePrompt({ request = '', style = '', lint = [] } = {}) {
  const system = [
    'You review screenshots of a small mobile game, drawn on a 360 × 640 canvas and shown on a phone. You grade them against a fixed checklist and answer in JSON only.',
    'Be strict and concrete. Only report what you can see in the images. Name where it is (frame label and a short place such as "top bar", "tile row 2", "left button").',
    'Checklist:',
    ...CHECKLIST.map((c) => `- ${c.id}: ${c.ask}`),
    'Answer: {"checks": [{"id": "V_…", "pass": true|false, "severity": "minor"|"major", "where": "intro: top bar", "issue": "what is wrong", "fix": "a layout change that would fix it (position, size, gap, text size, wrap, a solid panel or plate, color)"}], "overall": 1-10, "summary": "one sentence"}.',
    'Every checklist id appears exactly once. pass:true needs no issue or fix.',
  ].join('\n');
  const user = [
    request && `The person asked for: ${request}`,
    style && `Requested style: ${style}`,
    lint.length ? `A code check already found these (confirm or reject them visually): ${lint.slice(0, 12).map((f) => `${f.code} at ${f.frame}: ${f.detail}`).join('; ')}` : '',
    'The images are, in order: the intro frame, a mid-play frame and the end frame.',
  ].filter(Boolean).join('\n');
  return { system, user };
}

export function parseJudge(text) {
  const raw = typeof text === 'string' ? text : text?.content ?? '';
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return { checks: [], overall: null, error: 'no JSON' };
  let v;
  try { v = JSON.parse(m[0]); } catch (e) { return { checks: [], overall: null, error: e.message }; }
  const ids = new Set(CHECKLIST.map((c) => c.id));
  const checks = (Array.isArray(v.checks) ? v.checks : []).filter((c) => ids.has(c?.id)).map((c) => ({ id: c.id, pass: c.pass === true, severity: c.severity === 'major' ? 'major' : 'minor', where: String(c.where ?? ''), issue: String(c.issue ?? ''), fix: String(c.fix ?? '') }));
  return { checks, overall: Number.isFinite(+v.overall) ? +v.overall : null, summary: String(v.summary ?? '') };
}

export const failures = (j) => j.checks.filter((c) => !c.pass).length;

// ---------------------------------------------------------------- repair ----

/** The presentation, trimmed for the repair prompt: every node with its pointer, without long strings. */
export function presentationOutline(game, max = 14000) {
  const lines = [];
  walkNodes(game.presentation?.root, (node, ptr) => {
    const props = Object.entries(node).filter(([k, v]) => !['children', 'template', 'item', 'cell', 'animate_on', 'transition', 'on_tap', 'on_press', 'on_release', 'on_drag'].includes(k) && !(k === 'node' && typeof v === 'object'))
      .map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 60 ? JSON.stringify(v.slice(0, 57) + '…') : JSON.stringify(v)}`);
    lines.push(`${ptr} ${props.join(' ')}`);
  });
  const s = lines.join('\n');
  return s.length > max ? s.slice(0, max) + '\n…' : s;
}

export function repairPrompt(game, judged, lint = []) {
  const system = [
    'You fix the layout of a small mobile game (360 × 640 canvas). You may change only these node props:',
    [...LAYOUT_KEYS].join(', ') + '.',
    'You may also insert a solid "rect" node (a panel or plate) into a children list. Never change rules, state, inputs, functions, text content or assets.',
    'Answer JSON only: {"ops": [{"op": "set", "path": "/presentation/root/children/2/size", "value": 14}, {"op": "insert", "path": "/presentation/root/children/3", "value": {"node": "rect", ...}}], "why": "one sentence"}.',
    'Paths are JSON pointers into the game. Keep it to the fewest changes that fix the problems; at most 12 ops.',
  ].join('\n');
  const problems = [
    ...judged.checks.filter((c) => !c.pass).map((c) => `${c.id} (${c.severity}) at ${c.where}: ${c.issue}. Suggested: ${c.fix}`),
    ...lint.filter((f) => f.severity === 'error').slice(0, 10).map((f) => `${f.code} ${f.node ?? ''}: ${f.detail}. Hint: ${f.hint}`),
  ];
  const user = `Problems:\n- ${problems.join('\n- ')}\n\nThe presentation nodes (pointer, then props):\n${presentationOutline(game)}`;
  return { system, user };
}

/** Applies layout-only ops; returns {game, applied, refused}. Never touches anything outside presentation. */
export function applyLayoutOps(game, ops) {
  const g = JSON.parse(JSON.stringify(game));
  const applied = [], refused = [];
  const unesc = (p) => p.replace(/~1/g, '/').replace(/~0/g, '~');
  for (const op of Array.isArray(ops) ? ops.slice(0, 12) : []) {
    const path = String(op?.path ?? '');
    if (!path.startsWith('/presentation/root')) { refused.push({ op, why: 'outside the presentation tree' }); continue; }
    const parts = path.split('/').slice(1).map(unesc);
    const last = parts.pop();
    let parent = g;
    for (const p of parts) parent = parent?.[p];
    if (op.op === 'set') {
      if (!parent || typeof parent !== 'object' || Array.isArray(parent) || !LAYOUT_KEYS.has(last)) { refused.push({ op, why: `not a layout prop: ${last}` }); continue; }
      if (last === 'wrap' && op.value === true && parent.w === undefined) { refused.push({ op, why: 'wrap needs w' }); continue; }
      parent[last] = op.value; applied.push(op);
    } else if (op.op === 'insert') {
      const v = op.value;
      if (!Array.isArray(parent) || !/^\d+$/.test(last) || v?.node !== 'rect' || Object.keys(v).some((k) => k !== 'node' && !LAYOUT_KEYS.has(k) && k !== 'visible')) { refused.push({ op, why: 'only a plain rect may be inserted into a children list' }); continue; }
      parent.splice(Math.min(+last, parent.length), 0, v); applied.push(op);
    } else refused.push({ op, why: 'unknown op' });
  }
  return { game: g, applied, refused };
}

// ---------------------------------------------------------------- the loop ----

async function render(game, engine) {
  const r = await layoutCheck(game, { pngs: true, engine });
  const pick = (label) => r.frames.find((f) => f.label === label && f.seed === 1 && !f.idle)?.png;
  return { lint: r.findings, counts: r.counts, pngs: ['intro', 'mid', 'end'].map(pick).filter(Boolean) };
}

/**
 * game: microgame game object. judge/repair: model functions (see the header). rounds: max repairs (≤ 2).
 * Returns {game, rounds: [{judged, counts, ops, applied, refused, kept}], final: {judged, counts}}.
 */
export async function critiqueLoop(game, { judge, repair, request = '', style = '', rounds = 2, engine = null, onEvent = () => {} } = {}) {
  const eng = engine ?? (await loadEngine()).engine;
  let cur = game;
  let shot = await render(cur, eng);
  // No frames (Chrome missing or failed): a judge shown nothing grades nothing, so don't ask.
  if (shot.pngs.length < 3) return { game: cur, rounds: [], final: { judged: null, counts: shot.counts }, pngs: shot.pngs, skipped: 'no frames rendered' };
  const ask = async (s) => { const p = judgePrompt({ request, style, lint: s.lint }); return parseJudge(await judge(p.system, p.user, s.pngs)); };
  let judged = await ask(shot);
  onEvent({ kind: 'critiqued', round: 0, failures: failures(judged), lint: shot.counts });
  const log = [];
  for (let round = 1; round <= Math.min(2, rounds); round++) {
    if (!failures(judged)) break; // the lint's errors are the code fixes' job
    const { system, user } = repairPrompt(cur, judged, shot.lint);
    let parsed;
    try {
      const out = await repair(system, user);
      const text = typeof out === 'string' ? out : out?.content ?? '';
      parsed = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? '{}');
    } catch { parsed = {}; }
    const { game: next, applied, refused } = applyLayoutOps(cur, parsed.ops);
    let ok = applied.length > 0;
    if (ok) { try { eng.load(JSON.stringify(next), 1).dispose(); } catch { ok = false; } }
    let nshot = null, njudged = null;
    if (ok) {
      nshot = await render(next, eng);
      if (nshot.pngs.length < 3) { ok = false; nshot = null; }
    }
    if (ok) {
      njudged = await ask(nshot);
      ok = nshot.counts.errors <= shot.counts.errors && failures(njudged) < failures(judged);
    }
    log.push({ round, judged, counts: shot.counts, ops: parsed.ops ?? [], applied, refused, kept: ok, after: njudged && { judged: njudged, counts: nshot.counts } });
    onEvent({ kind: 'repaired', round, kept: ok, applied: applied.length, refused: refused.length });
    if (!ok) break;
    cur = next; shot = nshot; judged = njudged;
  }
  return { game: cur, rounds: log, final: { judged, counts: shot.counts }, pngs: shot.pngs };
}

// ---------------------------------------------------------------- Muse ----

/**
 * A judge (and repairer) on Muse: OpenAI-compatible chat completions with image input. The key is
 * passed in by the caller (read in process memory only; never logged).
 */
export function museVision({ key, model = 'muse-wonder-1.0', effort = 'low', maxTokens = 6000, base = 'https://api.meta.ai/v1' } = {}) {
  const call = async (messages) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(240000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens, reasoning_effort: effort, response_format: { type: 'json_object' } }),
        });
        if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { retry: true });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const j = await res.json();
        return { content: j.choices?.[0]?.message?.content ?? '', usage: j.usage, model };
      } catch (e) {
        if (attempt === 4 || (!e.retry && e.name !== 'TimeoutError' && !/fetch failed|ECONN|socket/i.test(String(e.message)))) throw e;
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      }
    }
  };
  return {
    judge: (system, user, pngs) => call([{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: user }, ...pngs.map((p) => ({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + p.toString('base64') } }))] }]),
    repair: (system, user) => call([{ role: 'system', content: system }, { role: 'user', content: user }]),
  };
}
