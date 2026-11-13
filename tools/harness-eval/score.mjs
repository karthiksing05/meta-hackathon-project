#!/usr/bin/env node
// Scores a run folder (from run.mjs). Writes <run>/<id>/score.json with three parts:
//   precheck  keyword/synonym hits for the entry's theme terms in the title, instructions, content,
//             node text and art roles (deterministic, free)
//   logic     from the gate report: can be lost, can be won/scored, run length 10–120 s, bot spread
//   judge     one Muse call per game with a strict rubric (must_have present/absent with quoted
//             evidence, must_not violated, theme 0–2, custom rule 0–2 or n/a); quotes are checked
//             against the game's text so made-up evidence is caught
//
//   node tools/harness-eval/score.mjs RUN_DIR [--only ids] [--no-judge] [--rejudge] [--config FILE] [--model M]
//
// The judge uses the same API and config file as the CLI (MuseConfig.json, then MUSE_API_KEY) and
// never prints the key.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, loadMuseConfig, museJSON, gameText, keywordHits, median, readJSONIf, defaultConfigPath } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const runDir = args._[0] && path.resolve(args._[0]);
if (!runDir || !fs.existsSync(runDir)) { console.error('usage: score.mjs RUN_DIR [--no-judge]'); process.exit(64); }
const only = args.only ? new Set(String(args.only).split(',')) : null;
const config = args['no-judge'] ? null : loadMuseConfig(path.resolve(args.config || defaultConfigPath()));
if (!args['no-judge'] && !config) { console.error('no Muse key for the judge (pass --no-judge to skip it)'); process.exit(1); }

// MARK: - Logic sanity (gate report)

function logic(run, entry) {
  const g = run.gate;
  if (!g) return { available: false };
  const runs = g.runs || [];
  const scores = runs.map((r) => r.score);
  const secs = runs.map((r) => r.seconds);
  const med = median(secs);
  const canLose = runs.some((r) => r.outcome === 'fail');
  const canWinOrScore = runs.some((r) => r.outcome === 'success' || r.score > 0);
  const lengthOK = med !== null && med >= 10 && med <= 120;
  const pro = runs.find((r) => r.bot === 'pro'), weak = runs.find((r) => r.bot === 'new player');
  const noFail = entry.category === 'calm' || /no[- ]fail|never (ever )?lose|can'?t lose/i.test(entry.request);
  const spreadOK = scores.length > 1 && Math.max(...scores) > Math.min(...scores) && (!pro || !weak || pro.score >= weak.score);
  return {
    available: true,
    gatePassed: g.passed,
    canLose, canWinOrScore, lengthOK, spreadOK,
    medianSeconds: med,
    scoreRange: scores.length ? [Math.min(...scores), Math.max(...scores)] : null,
    blocking: (g.flags || []).filter((f) => f.blocking).map((f) => f.code),
    notes: (g.flags || []).filter((f) => !f.blocking).map((f) => f.code),
    // A calm, no-fail request asks for the opposite of "can be lost"; the gate still demands it.
    noFailRequested: noFail,
    noFailHonored: noFail ? !canLose : null,
    allOK: g.passed && (noFail ? true : canLose) && canWinOrScore && lengthOK && spreadOK,
  };
}

// MARK: - Judge

const JUDGE_SYSTEM = `You are a strict evaluator of tiny phone games generated from a person's request.
You get the request, a checklist written by the team, and the generated game: its title, instructions,
content, and the full authoring manifest (the game's rules, state, inputs and the shapes it draws, with
their art roles). Judge only what the game actually contains. Names in state or rules count as evidence
only if they drive what the player sees or does. Do not give credit for intent the game doesn't carry out.
When the request names a franchise, character, place or object (a film series, "lightsaber", "snitch"), an
item about it is present only if the game uses that name or its own well-known terms; a renamed stand-in
("glowblade", "golden Swift", "energy blade") is absent for that item, however evocative the art is.

For every evidence field quote a short exact snippet copied from the game (title, instructions, content,
a node's text/role, a rule id or expression). If something is absent, say "absent" and why in a few words.

Scores:
- theme (0-2): 0 = the requested theme/setting/franchise is missing; 1 = partly there (a word or two, or
  only in the title); 2 = the words and the art both carry it. For a vague request, judge whether the game
  commits to a clear, fitting theme of its own.
- custom_rule (0-2 or null): if the request describes a rule of its own (given as custom_rule, or clearly
  in the request), 0 = not implemented, 1 = partly or loosely, 2 = implemented as described. null if the
  request describes no rule of its own.
- feel (0-2): how well the game matches the requested feel and who it's for.

Reply with one JSON object and nothing else:
{"must_have":[{"item":"...","present":true|false,"evidence":"..."}],
 "nice_to_have":[{"item":"...","present":true|false,"evidence":"..."}],
 "must_not":[{"item":"...","violated":true|false,"evidence":"..."}],
 "theme":{"score":0|1|2,"reason":"..."},
 "custom_rule":{"score":0|1|2|null,"reason":"..."},
 "feel":{"score":0|1|2,"reason":"..."},
 "missing":"one sentence: the biggest thing the request asked for that the game lacks, or 'nothing'"}`;

function judgeUser(entry, run, authoring) {
  const meta = authoring.meta || {};
  return [
    `Request: ${entry.request}`,
    `Specificity: ${entry.specificity}. Feel: ${entry.feel || '-'}. Who it's for: ${entry.who_with || '-'}.`,
    entry.custom_rule ? `custom_rule: ${entry.custom_rule}` : entry.custom_rule === null ? 'custom_rule: none (score it null)' : 'custom_rule: (not given; decide from the request)',
    '',
    'Checklist',
    `must_have:\n${entry.must_have.map((x) => `- ${x}`).join('\n') || '- (none)'}`,
    `nice_to_have:\n${entry.nice_to_have.map((x) => `- ${x}`).join('\n') || '- (none)'}`,
    `must_not:\n${entry.must_not.map((x) => `- ${x}`).join('\n') || '- (none)'}`,
    '',
    'The game',
    `Title: ${meta.title || run.title || ''}`,
    `Instructions: ${meta.instructions || ''}`,
    `One-line rule: ${run.oneLineRule || ''}`,
    `Duration: ${meta.duration_s ?? '?'} s`,
    `Content: ${JSON.stringify(authoring.content || {})}`,
    'Authoring manifest:',
    JSON.stringify(authoring),
  ].join('\n');
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/// Whether a judge's quote really appears in the game (any 4+ word run of it, or the whole quote
/// when it's short). Catches evidence the judge made up.
function quoteFound(quote, haystack) {
  const q = norm(quote);
  if (!q || /^absent\b/.test(q)) return false;
  if (haystack.includes(q)) return true;
  const words = q.split(' ');
  if (words.length < 4) return words.every((w) => haystack.includes(w));
  for (let i = 0; i + 4 <= words.length; i++) if (haystack.includes(words.slice(i, i + 4).join(' '))) return true;
  return false;
}

async function judge(entry, run, authoring) {
  const started = Date.now();
  const { value, model } = await museJSON(config, { model: args.model, system: JUDGE_SYSTEM, user: judgeUser(entry, run, authoring) });
  const hay = norm(JSON.stringify(authoring) + ' ' + (run.title || '') + ' ' + (run.oneLineRule || ''));
  const mh = (value.must_have || []).map((x) => ({ ...x, evidenceFound: x.present ? quoteFound(x.evidence, hay) : null }));
  const nh = (value.nice_to_have || []).map((x) => ({ ...x, evidenceFound: x.present ? quoteFound(x.evidence, hay) : null }));
  const mn = value.must_not || [];
  const present = mh.filter((x) => x.present === true).length;
  const verified = mh.filter((x) => x.present === true && x.evidenceFound).length;
  const total = entry.must_have.length || mh.length;
  return {
    model, seconds: (Date.now() - started) / 1000,
    mustHave: mh, niceToHave: nh, mustNot: mn,
    mustHaveCoverage: total ? present / total : null,
    mustHaveVerifiedCoverage: total ? verified / total : null,
    niceToHaveCoverage: nh.length ? nh.filter((x) => x.present).length / nh.length : null,
    mustNotViolations: mn.filter((x) => x.violated === true).length,
    theme: value.theme?.score ?? null, themeReason: value.theme?.reason || '',
    customRule: entry.custom_rule === null ? null : (value.custom_rule?.score ?? null),
    customRuleReason: value.custom_rule?.reason || '',
    feel: value.feel?.score ?? null, feelReason: value.feel?.reason || '',
    missing: value.missing || '',
  };
}

// MARK: - Main

const ids = fs.readdirSync(runDir).filter((d) => fs.existsSync(path.join(runDir, d, 'run.json'))).filter((d) => !only || only.has(d)).sort();
for (const id of ids) {
  const dir = path.join(runDir, id);
  const entry = readJSONIf(path.join(dir, 'entry.json'));
  const run = readJSONIf(path.join(dir, 'run.json'));
  const authoring = readJSONIf(path.join(dir, 'authoring.json'));
  const prev = readJSONIf(path.join(dir, 'score.json'));
  const score = { id, produced: !!authoring, logic: logic(run, entry), precheck: null, judge: prev?.judge || null };
  if (authoring) {
    const text = gameText(authoring);
    const hits = keywordHits(entry.theme_terms, text);
    const visibleHits = Object.values(hits).filter((w) => w.includes('visible') || w.includes('roles')).length;
    score.precheck = {
      terms: entry.theme_terms.length,
      hits, hitCount: Object.keys(hits).length, visibleOrArtHits: visibleHits,
      hitRate: entry.theme_terms.length ? Object.keys(hits).length / entry.theme_terms.length : null,
      title: authoring.meta?.title || null, instructions: authoring.meta?.instructions || null, roles: [...new Set(text.roles)],
    };
    if (config && (!score.judge || args.rejudge)) {
      try {
        score.judge = await judge(entry, run, authoring);
      } catch (e) {
        score.judge = { error: e.message };
      }
    }
  } else if (config) {
    score.judge = null;
  }
  fs.writeFileSync(path.join(dir, 'score.json'), JSON.stringify(score, null, 2));
  const j = score.judge;
  console.log(`${id.padEnd(24)} ${authoring ? `"${score.precheck.title}"`.padEnd(28) : 'NO GAME'.padEnd(28)} ` +
    `kw ${score.precheck ? `${score.precheck.hitCount}/${score.precheck.terms}` : '-'}  ` +
    (j && !j.error ? `must ${Math.round(j.mustHaveCoverage * 100)}% theme ${j.theme} rule ${j.customRule ?? 'n/a'} feel ${j.feel}` : j?.error ? `judge error: ${j.error}` : 'judge -') +
    `  logic ${score.logic.available ? (score.logic.allOK ? 'ok' : 'FLAG') : '-'}`);
}
