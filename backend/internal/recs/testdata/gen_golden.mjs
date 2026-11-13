// Regenerates golden.json: a fixed sequence of calls to game-recs.js run by Node. The Go test replays
// the same calls inside the embedded JavaScript engine (goja) and compares, so a difference between
// the two engines (or a bad edit to the vendored file) shows up as a failing test.
//
//   node internal/recs/testdata/gen_golden.mjs   (from backend/)

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// The one copy of the recommender lives in the app's folders (backend/internal/recs/recs.go, scriptRel).
const R = require(join(here, '..', '..', '..', '..', 'FacebookClone', 'Bubbles', 'Recommend', 'game-recs.js'));
const app = R.app;

const formulas = ['dodge', 'time', 'merge', 'guess', 'group', 'answer', 'make'];
const moods = [['calm'], ['cozy'], ['playful'], ['hype'], ['calm', 'cozy'], ['playful', 'hype']];
const looks = ['glow', 'paper', 'pixel', 'neon', 'ink', 'clay', 'riso', 'chalk'];
const summaries = [];
for (let i = 0; i < 14; i++) {
  summaries.push({
    id: `g${String(i).padStart(2, '0')}`,
    formula: formulas[i % formulas.length],
    mood: moods[i % moods.length],
    energy: ['low', 'medium', 'high'][i % 3],
    competition: ['light', 'friendly', 'high'][i % 3],
    look: looks[i % looks.length],
    scope: ['everyone', 'group', 'event'][i % 3],
    isDaily: i % 5 === 0,
    bots: i % 2 === 0 ? [0.2, 0.4, 0.6, 0.8, 0.95].map((skill, k) => ({ skill, score: Math.round(10 + skill * 80 + k), sec: 25 + i })) : [],
    creatorID: `u${i % 4}`,
    groupID: i % 3 === 1 ? 'grp1' : null,
  });
}
const candidates = summaries.map((s, i) => ({ gameID: s.id, reason: i % 4 === 0 ? 'new' : 'popular', runUserID: null, weight: 1 + (i % 3) * 0.25 }));
const day = 20800;

const steps = [];
const call = (method, input) => {
  const arg = input === undefined ? [] : [JSON.stringify(input)];
  const out = app[method](...arg);
  steps.push({ method, input: input ?? null, output: JSON.parse(out) });
  return JSON.parse(out);
};

steps.push({ method: 'load', input: null, output: JSON.parse(app.load('', '')) });
let feed = [];
const rank = (seed, count) => {
  const r = call('rank', { candidates, summaries, feed, feedKeys: feed.map((id) => `${id}|popular|-`), count, seed, day, now: 1794000000000 });
  feed = feed.concat(r.picks.map((p) => p.gameID));
  return r;
};
rank(11, 6);
// a run of pages: loved one game, skipped another, saved a third
for (const [id, imp] of [
  ['g02', { dwellSec: 20, tookOver: true, runsFinished: 2, replays: 1, saved: true }],
  ['g05', { dwellSec: 0.6, tookOver: false }],
  ['g04', { dwellSec: 12, tookOver: true, runsFinished: 1, liked: true, social: ['challenge_sent'], with: ['u7'] }],
  ['g07', { dwellSec: 9, tookOver: true, quitMidRun: true }],
  ['g02', { dwellSec: 18, tookOver: true, runsFinished: 1, replays: 2, floated: true, endedSession: true }],
]) {
  call('observe', { id, dwellSec: 0, tookOver: false, runsFinished: 0, replays: 0, saved: false, liked: false, floated: false, openedBoard: false, addedFriend: false, remixed: false, social: [], with: [], quitMidRun: false, endedSession: false, day, ...imp });
}
call('signal', { id: 'g09', kind: 'challenge_accepted', with: ['u3'], day });
call('signal', { id: 'g11', kind: 'saved', with: [], day });
rank(12, 5);
rank(13, 5);
call('groupBlend', {
  group: { id: 'grp1', name: 'New in SF' },
  members: [
    { id: 'me', name: 'You', isMe: true, isFriend: true, skill: { overall: 0.6, byFormula: {} } },
    { id: 'u1', name: 'Maya', isMe: false, isFriend: true, skill: { overall: 0.62, byFormula: { dodge: 0.7 } }, hints: { bio: 'coffee walks and trivia' } },
    { id: 'u2', name: 'Diego', isMe: false, isFriend: false, skill: { overall: 0.4, byFormula: {} } },
  ],
  summaries, feed: [], count: 4, day,
});
steps.push({ method: 'profile', input: null, output: JSON.parse(app.profile()) });
steps.push({ method: 'debugSummary', input: null, output: JSON.parse(app.debugSummary()) });

writeFileSync(join(here, 'golden.json'), JSON.stringify({ version: R.version, steps }, null, 1));
console.log(`wrote golden.json: recs ${R.version}, ${steps.length} steps`);
