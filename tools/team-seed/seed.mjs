// Seeds a team world on a games API from a team file kept outside the repository: real accounts for the people in it
// (display names, cartoon avatars, cover colors, bios), all friends; their Groups with join policies (open, request,
// invite) and recruiting flags; Group-scoped copies of published games with verified scores (bot runs with real input
// logs, replayed by the server); a challenge; today's Daily in one Group; /v1/fb posts and comments; a Messenger group
// chat; and the "me" person joining the demo world's New in SF Group (friends with some of its cast, on its Daily just
// below one of them). The file names nobody here: everything personal is in the team file.
//
//   node tools/team-seed/seed.mjs --team <dir with team.json>              # local API (http://127.0.0.1:8080)
//   node tools/team-seed/seed.mjs --team <dir> --api https://api.ol4ol.com
//   options: --date YYYY-MM-DD (the Daily's day; default today in San Francisco), --demo-state <demo-world dir>
//            (default: the team dir's sibling demo-world), --dry (plan and play the bots, send nothing)
//
// team.json: { me, people: [{key, first, last, username, bio, avatarUrl, coverColor}], groups: [{id, name, category,
// about, coverColor, coverSeed, joinPolicy, recruiting, owner, members, daily?: {source, by, order}, games: [{key,
// source, by, order, challenge?: {from, to}}]}], posts: [{key, by, text, groupId?, background?}], comments: [{post, by,
// text}], chat: {name, by, members, messages: [{by, text}]}, newInSF: {groupId, friends, dailyBelow} }.
// `source` is a published game id; `order` lists who played, best first.
//
// Re-runnable: what exists is kept (accounts, friendships, memberships, games, scores, posts, the chat). Passwords go
// only to <team dir>/accounts.private.json (chmod 600) and are never printed; ids go to <team dir>/state-<host>.json.
// On an API without PATCH /v1/me/profile and Group join policies, it seeds the rest (people join their Groups
// themselves) and a later run, after the deploy, sets avatars, bios and policies.

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { playRun, gameTextOf } from '../demo-seed/bots.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes(name);

const API = (opt('--api', process.env.DEMO_API || 'http://127.0.0.1:8080')).replace(/\/$/, '');
const SOURCE_GAMES = 'https://games.ol4ol.com'; // where the original games' packages live (public reads)
const TEAM_DIR = resolve(opt('--team', process.env.TEAM_WORLD_DIR || ''));
if (!opt('--team', process.env.TEAM_WORLD_DIR)) throw new Error('pass --team <dir with team.json> (or TEAM_WORLD_DIR)');
const DEMO_DIR = resolve(opt('--demo-state', join(dirname(TEAM_DIR), 'demo-world')));
const DRY = flag('--dry');
const sfToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const DATE = opt('--date', sfToday());
const host = new URL(API).host.replace(/[^a-z0-9.-]/gi, '_');

const team = JSON.parse(readFileSync(join(TEAM_DIR, 'team.json'), 'utf8'));
const people = Object.fromEntries(team.people.map((p) => [p.key, p]));
const ME = team.me;
const nameOf = (key) => people[key]?.first ?? key;

// ---- files ----
mkdirSync(TEAM_DIR, { recursive: true });
const credFile = join(TEAM_DIR, 'accounts.private.json');
const stateFile = join(TEAM_DIR, `state-${host}.json`);
const creds = existsSync(credFile) ? JSON.parse(readFileSync(credFile, 'utf8')) : {};
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
creds[host] ??= {};
for (const k of ['accounts', 'games', 'scores', 'posts', 'comments', 'challenges', 'groups']) state[k] ??= {};
state.api = API;
const saveCreds = () => { if (DRY) return; writeFileSync(credFile, JSON.stringify(creds, null, 2)); chmodSync(credFile, 0o600); };
const saveState = () => { if (DRY) return; state.updatedAt = new Date().toISOString(); writeFileSync(stateFile, JSON.stringify(state, null, 2)); };

// ---- HTTP ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, { token, json, zip } = {}) {
  for (let i = 0; i < 6; i++) {
    try {
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      let body;
      if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
      if (zip) { headers['Content-Type'] = 'application/zip'; body = zip; }
      const r = await fetch(API + path, { method, headers, body });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
      if (r.status === 429) { await sleep(15000); continue; }
      if (r.status >= 502) { await sleep(4000 * (i + 1)); continue; }
      return { status: r.status, data };
    } catch (e) {
      if (i === 5) throw e;
      await sleep(3000 * (i + 1));
    }
  }
  return { status: 0, data: { error: 'retries exhausted' } };
}
const must = (r, what, ok = [200, 201]) => {
  if (!ok.includes(r.status)) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
};
// a route the server doesn't have answers chi's plain-text 404
const missingRoute = (r) => r.status === 404 && typeof r.data?.error !== 'string';

// Auth routes allow 10 a minute per address, so accounts sign in slowly; a token is reused while it's fresh.
let lastAuth = 0;
async function authCall(path, json) {
  const wait = lastAuth + 6500 - Date.now();
  if (wait > 0) await sleep(wait);
  lastAuth = Date.now();
  return call('POST', path, { json });
}
const displayName = (p) => [p.first, p.last].filter(Boolean).join(' ');

async function signIn(p) {
  const c = creds[host][p.key];
  if (c?.accessToken && c.tokenUntil > Date.now() + 60_000) return c.accessToken;
  const keep = (data) => {
    Object.assign(creds[host][p.key], { userId: data.user.id, accessToken: data.accessToken, tokenUntil: Date.now() + 14 * 60_000 });
    saveCreds();
    state.accounts[p.key] = { id: data.user.id, username: data.user.username, displayName: data.user.displayName };
    saveState();
    return data.accessToken;
  };
  if (c) return keep(must(await authCall('/v1/auth/login', { email: c.email, password: c.password }), `login ${p.key}`));
  for (const suffix of ['', '_ct', '_26', '_ct26']) {
    const username = (p.username + suffix).slice(0, 24);
    const email = `${username.replace(/_/g, '.')}.team@example.com`;
    const password = crypto.randomBytes(18).toString('base64url');
    const r = await authCall('/v1/auth/register', { email, username, displayName: displayName(p), password });
    if (r.status === 201) {
      creds[host][p.key] = { email, username, password, created: new Date().toISOString() };
      return keep(r.data);
    }
    if (r.status !== 409) must(r, `register ${p.key}`);
  }
  throw new Error(`no free username for ${p.key}`);
}
const tokens = {};
const tok = async (key) => (tokens[key] ??= await signIn(people[key]));
const idOf = (key) => state.accounts[key].id;

// ---- a package zip (stored, no compression): manifest.json only ----
function zipOne(name, data) {
  const nameBuf = Buffer.from(name), crc = zlib.crc32(data) >>> 0, n = data.length;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(n, 18); local.writeUInt32LE(n, 22); local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0x21, 12);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(n, 20); central.writeUInt32LE(n, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBuf.length, 12); end.writeUInt32LE(30 + nameBuf.length + n, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
}

// ---- bots: finished, in-bounds runs with their logs, best first ----
function runPool(manifest, want) {
  const text = gameTextOf(manifest);
  const sm = manifest.score ?? {};
  const finishedOnly = sm.counts_when === 'finished';
  const rate = sm.bounds?.max_rate_per_s;
  const seed = Number(manifest.seed) || 1;
  const byScore = new Map();
  for (let i = 0; i < Math.max(24, want * 4) && byScore.size < want * 3; i++) {
    const r = playRun(text, { seed, skill: [0.15, 0.35, 0.55, 0.75, 0.9, 0.97][i % 6], botSeed: 2000 + i * 17 });
    if (!r || (r.phase !== 'won' && r.phase !== 'lost') || (finishedOnly && r.phase !== 'won')) continue;
    if (sm.bounds && (r.score < (sm.bounds.min ?? 0) || (sm.bounds.max != null && r.score > sm.bounds.max))) continue;
    if (rate && r.seconds > 0 && r.score / r.seconds > rate) continue;
    if (r.score <= 0) continue;
    if (!byScore.has(r.score)) byScore.set(r.score, r);
  }
  const lower = sm.direction === 'lower';
  return [...byScore.values()].sort((a, b) => (lower ? a.score - b.score : b.score - a.score));
}

function assign(pool, n) {
  if (pool.length < n) return null;
  const picks = [];
  const step = (pool.length - 1) / Math.max(1, n - 1);
  let last = -1;
  for (let i = 0; i < n; i++) {
    let j = Math.max(last + 1, Math.round(i * step));
    j = Math.min(j, pool.length - (n - i));
    picks.push(pool[j]);
    last = j;
  }
  return picks;
}

const sourceCache = {};
async function sourceManifest(id) {
  for (let i = 0; !sourceCache[id]; i++) {
    try {
      sourceCache[id] = await (await fetch(`${SOURCE_GAMES}/${id}/manifest.json`)).json();
    } catch (e) {
      if (i === 4) throw e;
      await sleep(3000 * (i + 1));
    }
  }
  return sourceCache[id];
}

// a Group-scoped copy's manifest id: the source's, shortened, plus a suffix (slugs are up to 64 characters)
const copyID = (src, suffix) => `${String(src.id).slice(0, 63 - suffix.length).replace(/-+$/, '')}-${suffix}`;

async function scopedCopy(spec, group, suffix, daily) {
  const src = await sourceManifest(spec.source);
  const m = structuredClone(src);
  m.id = copyID(src, suffix);
  m.structure = { ...(src.structure ?? {}), scope: `group:${group.id}`, group_id: group.id };
  if (daily) m.structure.cadence = 'daily';
  const pool = runPool(m, spec.order.length);
  m.bots = pool.slice(0, 20).map((r, i) => ({ skill: [0.35, 0.7, 0.95][i % 3], score: r.score, sec: Math.round(r.seconds * 10) / 10 }));
  return { src, m, pool };
}

async function uploadCopy(key, spec, { src, m }) {
  let gameId = state.games[key]?.source === spec.source ? state.games[key].id : undefined; // a changed source is a new copy  if (gameId && (await call('GET', `/v1/games/${gameId}`)).status !== 200) gameId = undefined;
  if (!gameId) {
    const r = await call('POST', '/v1/creations', { token: await tok(spec.by), zip: zipOne('manifest.json', Buffer.from(JSON.stringify(m))) });
    if (r.status === 422 && /slug|already/i.test(JSON.stringify(r.data))) {
      gameId = must(await call('GET', `/v1/games/${m.id}`), `find ${m.id}`).id;
    } else {
      gameId = must(r, `upload ${key}`).id;
    }
    if (r.data?.unlisted) must(await call('POST', `/v1/creations/${gameId}/publish`, { token: await tok(spec.by) }), `publish ${key}`);
  }
  state.games[key] = { id: gameId, title: src.title, source: spec.source, scope: m.structure.scope, by: spec.by };
  saveState();
  return gameId;
}

async function postScores(game, gameId, m, order, picks) {
  const key = `${game}:${gameId}`; // a new copy starts a new board
  state.scores[key] ??= {};
  for (let i = 0; i < order.length; i++) {
    const who = order[i], run = picks[i];
    if (state.scores[key][who] === run.score) continue;
    const r = await call('POST', `/v1/games/${gameId}/scores`, { token: await tok(who), json: m.score ? { log: run.log } : { score: run.score } });
    if (r.status !== 200 && r.status !== 201) { // a run the server's replay disagrees with: leave that person off
      console.log(`  ${nameOf(who)}'s run was refused: ${r.status} ${String(r.data?.error ?? '').slice(0, 120)}`);
      continue;
    }
    state.scores[key][who] = r.data.score ?? run.score;
    saveState();
  }
  const board = must(await call('GET', `/v1/games/${gameId}/leaderboard`, { token: await tok(ME) }), 'board');
  const name = Object.fromEntries(Object.entries(state.accounts).map(([k, a]) => [a.id, nameOf(k)]));
  return (board.items ?? []).map((x) => `${name[x.userId] ?? x.username} ${x.display ?? x.score}`).join(', ');
}

// ---- main ----
console.log(`team-seed → ${API}${DRY ? ' (dry run)' : ''}, Daily date ${DATE}, ${team.people.length} people, ${team.groups.length} Groups`);
const report = { groups: [], games: [] };
let hasPolicies = false, hasDaily = false;

if (!DRY) {
  for (const p of team.people) tokens[p.key] = await signIn(p);
  console.log(`accounts: ${team.people.map((p) => `${p.first} (${state.accounts[p.key].username})`).join(', ')}`);

  // profiles: name, bio, avatar, cover color
  const probe = await call('PATCH', '/v1/me/profile', { token: await tok(ME), json: {} });
  hasPolicies = !missingRoute(probe);
  if (hasPolicies) {
    for (const p of team.people) {
      must(await call('PATCH', '/v1/me/profile', { token: await tok(p.key), json: { displayName: displayName(p), bio: p.bio ?? '', avatarUrl: p.avatarUrl ?? '', coverColor: p.coverColor ?? '' } }), `profile ${p.key}`);
    }
    console.log('profiles: bios, avatars and cover colors set');
  } else {
    console.log('this API has no PATCH /v1/me/profile or Group join policies yet: skipping avatars, bios and policies (run again after the deploy)');
  }

  // everyone is friends with everyone
  let pairs = 0;
  for (let i = 0; i < team.people.length; i++) {
    for (let j = i + 1; j < team.people.length; j++) {
      must(await call('PUT', `/v1/me/friends/${idOf(team.people[j].key)}`, { token: await tok(team.people[i].key) }), 'friend');
      pairs++;
    }
  }
  console.log(`friendships: ${pairs}`);

  const dprobe = await call('GET', `/v1/groups/${team.groups[0].id}/daily`);
  hasDaily = dprobe.status === 200 || (dprobe.status === 404 && typeof dprobe.data?.error === 'string');
  if (!hasDaily) console.log('this API has no Group Daily routes (and no stable Group ids): skipping Groups, games and the Daily');
}

// Groups and their members
if (!DRY && hasDaily) {
  for (const g of team.groups) {
    const settings = { name: g.name, category: g.category, about: g.about, coverSeed: g.coverSeed, coverColor: g.coverColor, joinPolicy: g.joinPolicy, recruiting: !!g.recruiting };
    const r = await call('POST', '/v1/groups', { token: await tok(g.owner), json: { id: g.id, kind: 'group', ...settings } });
    if (r.status === 201 && r.data.id !== g.id) throw new Error(`the API gave ${g.id} the id ${r.data.id}`);
    if (r.status !== 201 && r.status !== 409) must(r, `create ${g.id}`);
    if (hasPolicies) must(await call('PATCH', `/v1/groups/${g.id}`, { token: await tok(g.owner), json: settings }), `settings ${g.id}`);
    const have = new Set(must(await call('GET', `/v1/groups/${g.id}`, { token: await tok(g.owner) }), `group ${g.id}`).members.map((m) => m.id));
    for (const key of g.members) {
      if (have.has(idOf(key))) continue;
      if (!hasPolicies || g.joinPolicy === 'open') {
        must(await call('PUT', `/v1/groups/${g.id}/members/me`, { token: await tok(key) }), `join ${g.id} ${key}`);
      } else {
        // a request Group: they ask, the owner approves; an invite Group: the owner adds them
        if (g.joinPolicy === 'request') must(await call('PUT', `/v1/groups/${g.id}/members/me`, { token: await tok(key) }), `ask ${g.id} ${key}`, [202, 200]);
        must(await call('PUT', `/v1/groups/${g.id}/members/${idOf(key)}`, { token: await tok(g.owner) }), `add ${g.id} ${key}`);
      }
    }
    const detail = must(await call('GET', `/v1/groups/${g.id}`, { token: await tok(ME) }), `group ${g.id}`);
    state.groups[g.id] = { name: g.name, joinPolicy: detail.group.joinPolicy ?? '(not on this API)', recruiting: detail.group.recruiting ?? false, members: detail.members.map((m) => m.displayName) };
    saveState();
    console.log(`Group ${g.id}: ${detail.members.length} members, ${state.groups[g.id].joinPolicy}${state.groups[g.id].recruiting ? ', recruiting' : ''}`);
  }
}

// games, scores and the challenge
for (const g of (DRY || hasDaily) ? team.groups : []) {
  const short = g.id.replace(/^group-/, '');
  const specs = g.games.map((s) => ({ ...s, suffix: `${short}` }));
  if (g.daily) specs.unshift({ ...g.daily, key: `daily-${short}-${DATE}`, suffix: `${short}-${DATE.replace(/-/g, '')}`, daily: true });
  for (const spec of specs) {
    const key = spec.daily ? spec.key : `${short}-${spec.key}`;
    const copy = await scopedCopy(spec, g, spec.suffix, spec.daily);
    const picks = assign(copy.pool, spec.order.length);
    console.log(`${key}: "${copy.src.title}" (${copy.m.id}) pool ${copy.pool.length}: ${copy.pool.slice(0, 10).map((r) => r.score).join(' ')}`);
    if (!picks) console.log(`  not enough distinct finished runs for ${spec.order.length} people; no scores`);
    if (DRY) { if (picks) console.log('  ' + spec.order.map((k, i) => `${nameOf(k)} ${picks[i].score}`).join(', ')); continue; }
    const gameId = await uploadCopy(key, spec, copy);
    if (picks) console.log(`  board: ${await postScores(key, gameId, copy.m, spec.order, picks)}`);
    if (spec.daily) state.dailyKey = { group: g.id, key, by: spec.by };
    if (spec.challenge) {
      const ck = `${key}:${gameId}:${spec.challenge.from}`;
      if (!state.challenges[ck]) {
        const c = must(await call('POST', '/v1/challenges', { token: await tok(spec.challenge.from), json: { gameId, toUserIds: spec.challenge.to.map(idOf) } }), `challenge ${ck}`);
        state.challenges[ck] = { id: c.id ?? c.challenge?.id ?? true, gameId, to: spec.challenge.to };
        saveState();
      }
      console.log(`  challenge from ${nameOf(spec.challenge.from)} to ${spec.challenge.to.map(nameOf).join(', ')}`);
    }
  }
}

// today's Daily
if (!DRY && hasDaily && state.dailyKey) {
  const { group, key, by } = state.dailyKey;
  const r = must(await call('POST', `/v1/groups/${group}/daily`, { token: await tok(by), json: { gameId: state.games[key].id, date: DATE } }), 'set the Daily');
  state.daily = { group, date: r.date, gameId: r.gameId, title: state.games[key].title };
  saveState();
  console.log(`Daily ${r.date} in ${group}: ${state.daily.title} (${r.gameId}), ${r.recipients} notified`);
}

// Facebook posts, comments and the group chat
if (!DRY) {
  for (const p of team.posts ?? []) {
    const known = state.posts[p.key];
    if (known && (await call('GET', `/v1/fb/posts/${known}`)).status === 200) continue;
    if (p.groupId && !hasDaily) continue;
    const body = { text: p.text, ...(p.groupId ? { groupId: p.groupId } : {}), ...(p.background != null ? { background: p.background } : {}) };
    state.posts[p.key] = must(await call('POST', '/v1/fb/posts', { token: await tok(p.by), json: body }), `post ${p.key}`).id;
    saveState();
    await sleep(1100); // keeps the posts in order on the feed
  }
  for (const c of team.comments ?? []) {
    const ck = `${c.post}:${c.by}`;
    if (state.comments[ck] || !state.posts[c.post]) continue;
    state.comments[ck] = must(await call('POST', `/v1/fb/posts/${state.posts[c.post]}/comments`, { token: await tok(c.by), json: { text: c.text } }), `comment ${ck}`).id;
    saveState();
  }
  console.log(`posts: ${Object.keys(state.posts).length}, comments: ${Object.keys(state.comments).length}`);

  if (team.chat) {
    const ch = team.chat;
    const mine = must(await call('GET', '/v1/fb/threads?messages=0', { token: await tok(ch.by) }), 'threads').items ?? [];
    if (!state.chat || !mine.some((t) => t.id === state.chat.id)) {
      const t = must(await call('POST', '/v1/fb/threads', { token: await tok(ch.by), json: { name: ch.name, memberIds: ch.members.filter((k) => k !== ch.by).map(idOf) } }), 'chat');
      state.chat = { id: t.id, sent: 0 };
      saveState();
    }
    for (let i = state.chat.sent; i < ch.messages.length; i++) {
      const msg = ch.messages[i];
      must(await call('POST', `/v1/fb/threads/${state.chat.id}/messages`, { token: await tok(msg.by), json: { text: msg.text } }), `message ${i}`);
      state.chat.sent = i + 1;
      saveState();
      await sleep(600);
    }
    console.log(`chat "${ch.name}" (${state.chat.id}): ${state.chat.sent} messages`);
  }
}

// "me" in the demo world's New in SF: a member, friends with some of the cast, and on today's Daily just below one of them
const sf = team.newInSF;
const demoStateFile = join(DEMO_DIR, `state-${host}.json`);
if (!DRY && hasDaily && sf && existsSync(demoStateFile)) {
  const demo = JSON.parse(readFileSync(demoStateFile, 'utf8'));
  must(await call('PUT', `/v1/groups/${sf.groupId}/members/me`, { token: await tok(ME) }), 'join New in SF');
  for (const k of sf.friends ?? []) {
    if (demo.accounts?.[k]) must(await call('PUT', `/v1/me/friends/${demo.accounts[k].id}`, { token: await tok(ME) }), `friend ${k}`);
  }
  const daily = demo.games?.[`daily-${DATE}`];
  const above = demo.accounts?.[sf.dailyBelow]?.id;
  if (daily && above) {
    const src = await sourceManifest(daily.source);
    const lower = src.score?.direction === 'lower';
    const board = must(await call('GET', `/v1/games/${daily.id}/leaderboard?limit=50`, { token: await tok(ME) }), 'New in SF board').items ?? [];
    const meNow = board.find((x) => x.userId === idOf(ME));
    const i = board.findIndex((x) => x.userId === above);
    if (meNow) {
      console.log(`New in SF Daily: ${nameOf(ME)} already on the board (${meNow.display ?? meNow.score})`);
    } else if (i >= 0) {
      const hi = board[i].score, next = board.slice(i + 1).find((x) => x.score !== hi)?.score;
      const between = (s) => (lower ? s > hi && (next == null || s < next) : s < hi && (next == null || s > next));
      const run = runPool(src, 12).find((r) => between(r.score));
      if (run) {
        must(await call('POST', `/v1/games/${daily.id}/scores`, { token: await tok(ME), json: { log: run.log } }), 'New in SF score');
        console.log(`New in SF Daily: ${nameOf(ME)} ${run.score}, just below ${sf.dailyBelow} (${hi})`);
      } else {
        console.log(`New in SF Daily: no bot run between ${hi} and ${next}; ${nameOf(ME)} left off the board`);
      }
    }
  } else {
    console.log(`New in SF: no Daily for ${DATE} in ${demoStateFile} (run tools/demo-seed first)`);
  }
  state.newInSF = { joined: true, date: DATE };
  saveState();
} else if (!DRY && sf) {
  console.log(`New in SF: skipped (${hasDaily ? `no demo-world state at ${demoStateFile}` : 'no Group routes'})`);
}

if (!DRY) console.log(`state: ${stateFile}`);
