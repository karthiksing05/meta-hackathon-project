// Seeds Karthik's friend world on a games API for the Muse Curios demo: his four teammates (the team-world accounts,
// reused, never duplicated on an API where they exist) plus a few synthetic people; friendships; two shared Groups
// (Harry Potter fans, Tech News) with Group copies of real Prod games and verified scores (bot runs whose input logs
// the server replays) arranged so the Harry Potter fans weekly board puts a non-friend just above and one just below
// Karthik; a pending challenge and a Group round from Max on a game Karthik hasn't played; friends' scores and likes on
// public Curios (one with a melody, and a library sound on a Group copy); a few posts, comments and reactions.
//
//   node tools/friend-world/seed.mjs --dry                                  # plan and play the bots, send nothing
//   node tools/friend-world/seed.mjs --api http://127.0.0.1:8090 --mirror-public   # local test (see below)
//   node tools/friend-world/seed.mjs --api https://api.ol4ol.com
//   options: --out <dir>   (default <repo>/../../game-backups/friend-world; creds and state go here)
//            --team <dir>  (default the out dir's sibling team-world: team.json, accounts.private.json, state-*.json)
//            --mirror-public  local APIs only: upload unchanged copies of the Prod public games and a placeholder
//                             sound the world refers to, so a fresh memory-store API has them
//
// Re-runnable: what exists is kept (accounts, friendships, memberships, games, scores, the challenge, the round, posts).
// Synthetic people's passwords go only to <out>/accounts.private.json (chmod 600) and are never printed. Teammates sign
// in with team-world's credentials; on an API where those are missing the tool registers them only if --mirror-public
// is set (a local test), and refuses otherwise. Auth allows 10 calls a minute: sign-ins are spaced 6.5 s and tokens are
// cached (14 minutes) in the creds file. Muse is never called.

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { playRun, gameTextOf } from '../demo-seed/bots.mjs';
import { textRun } from './textbot.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes(name);

const API = opt('--api', process.env.FRIEND_WORLD_API || 'http://127.0.0.1:8080').replace(/\/$/, '');
const SOURCE_GAMES = 'https://games.ol4ol.com'; // the Prod games' packages (public reads)
const DRY = flag('--dry');
const MIRROR = flag('--mirror-public');
const host = new URL(API).host.replace(/[^a-z0-9.-]/gi, '_');
const isProd = /(^|\.)ol4ol\.com$/.test(new URL(API).hostname);
if (MIRROR && isProd) throw new Error('--mirror-public is for local test APIs only');
const OUT = resolve(opt('--out', process.env.FRIEND_WORLD_DIR || join(here, '..', '..', '..', 'game-backups', 'friend-world')));
const TEAM_DIR = resolve(opt('--team', join(dirname(OUT), 'team-world')));

const world = JSON.parse(readFileSync(join(here, 'world.json'), 'utf8'));
const WARM = opt('--warm'); // --warm <Prod game id>: play only that game's bots into the run cache, then stop
if (WARM) {
  for (const g of world.groups) g.games = g.games.filter((x) => x.source === WARM);
  world.publicGames = world.publicGames.filter((x) => x.source === WARM);
}
const team = JSON.parse(readFileSync(join(TEAM_DIR, 'team.json'), 'utf8'));
const teamCreds = existsSync(join(TEAM_DIR, 'accounts.private.json')) ? JSON.parse(readFileSync(join(TEAM_DIR, 'accounts.private.json'), 'utf8')) : {};
const people = {};
for (const p of team.people) people[p.key] = { ...p, team: true };
for (const p of world.people) people[p.key] = { ...p, team: false };
const ME = world.me;
const nameOf = (k) => people[k]?.first ?? k;
const displayName = (p) => [p.first, p.last].filter(Boolean).join(' ');

// ---- files ----
mkdirSync(OUT, { recursive: true });
const credFile = join(OUT, 'accounts.private.json');
const stateFile = join(OUT, `state-${host}.json`);
const creds = existsSync(credFile) ? JSON.parse(readFileSync(credFile, 'utf8')) : {};
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
creds[host] ??= {};
creds.tokens ??= {};
creds.tokens[host] ??= {};
for (const k of ['accounts', 'games', 'publicGames', 'scores', 'likes', 'posts', 'comments', 'reactions', 'challenges', 'rounds', 'groups', 'friendships']) state[k] ??= {};
state.api = API;
const saveCreds = () => { if (DRY) return; writeFileSync(credFile, JSON.stringify(creds, null, 2)); chmodSync(credFile, 0o600); };
const saveState = () => { if (DRY) return; state.updatedAt = new Date().toISOString(); writeFileSync(stateFile, JSON.stringify(state, null, 2)); };

// ---- HTTP ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, { token, json, zip, ctype } = {}) {
  for (let i = 0; i < 6; i++) {
    try {
      const headers = { 'User-Agent': 'friend-world-seed' };
      if (token) headers.Authorization = `Bearer ${token}`;
      let body;
      if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
      if (zip) { headers['Content-Type'] = ctype ?? 'application/zip'; body = zip; }
      const r = await fetch(API + path, { method, headers, body });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
      if (r.status === 429) { console.log(`  429 on ${method} ${path}; waiting 20 s`); await sleep(20000); continue; }
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

// ---- accounts (auth: 10 a minute per address, so space calls and cache tokens) ----
let lastAuth = 0;
async function authCall(path, json) {
  const wait = lastAuth + 6500 - Date.now();
  if (wait > 0) await sleep(wait);
  lastAuth = Date.now();
  return call('POST', path, { json });
}
function keep(key, data) {
  creds.tokens[host][key] = { userId: data.user.id, accessToken: data.accessToken, tokenUntil: Date.now() + 14 * 60_000 };
  saveCreds();
  state.accounts[key] = { id: data.user.id, username: data.user.username, displayName: data.user.displayName, team: people[key].team };
  saveState();
  return data.accessToken;
}
async function signIn(key) {
  const p = people[key];
  const t = creds.tokens[host][key];
  if (t?.accessToken && t.tokenUntil > Date.now() + 60_000) {
    const me = await call('GET', '/v1/auth/me', { token: t.accessToken });
    if (me.status === 200) return t.accessToken;
  }
  const c = creds[host][key] ?? (p.team ? teamCreds[host]?.[key] : undefined);
  if (c) return keep(key, must(await authCall('/v1/auth/login', { email: c.email, password: c.password }), `login ${key}`));
  if (p.team && !MIRROR) throw new Error(`no team-world login for ${key} on ${host}; refusing to make a second account`);
  for (const suffix of ['', '_fw', '_cc', '_26']) {
    const username = (p.username + suffix).slice(0, 24);
    const email = `${username.replace(/_/g, '.')}.${p.team ? 'team' : 'fw'}@example.com`;
    const password = crypto.randomBytes(18).toString('base64url');
    const r = await authCall('/v1/auth/register', { email, username, displayName: displayName(p), password });
    if (r.status === 201) {
      creds[host][key] = { email, username, password, created: new Date().toISOString() };
      return keep(key, r.data);
    }
    if (r.status !== 409) must(r, `register ${key}`);
  }
  throw new Error(`no free username for ${key}`);
}
const tokens = {};
const tok = async (key) => (tokens[key] ??= await signIn(key));
const idOf = (key) => state.accounts[key].id;

// ---- zips (stored, no compression) ----
function zipFiles(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name), crc = zlib.crc32(data) >>> 0, n = data.length;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(n, 18); local.writeUInt32LE(n, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(n, 20); central.writeUInt32LE(n, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + n;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---- bots: finished, in-bounds runs with their logs, best first ----
// Runs are cached per game text and seed in <out>/runs/ (input logs only; nothing secret), so --dry warms the cache
// and a later run (or a re-run) doesn't replay the bots. FW_RUNS=n caps the bot runs per game (default want*2+6).
function runPool(manifest, want, seedOverride) {
  const text = gameTextOf(manifest);
  const seed0 = seedOverride ?? (Number(manifest.seed) || 1);
  const ck = crypto.createHash('sha256').update(text + '|' + seed0 + '|' + JSON.stringify(manifest.score ?? {})).digest('hex').slice(0, 20);
  const cacheFile = join(OUT, 'runs', `${ck}.json`);
  if (existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (cached.length >= want) return cached;
  }
  // shards from parallel warmups (FW_SHARD=k/n): merged, distinct by score, best first
  const shardFiles = existsSync(join(OUT, 'runs')) ? readdirSync(join(OUT, 'runs')).filter((f) => f.startsWith(`${ck}.shard-`)) : [];
  if (shardFiles.length && !process.env.FW_SHARD) {
    const by = new Map();
    for (const f of shardFiles) for (const r of JSON.parse(readFileSync(join(OUT, 'runs', f), 'utf8'))) if (!by.has(r.score)) by.set(r.score, r);
    const lower = manifest.score?.direction === 'lower';
    const merged = [...by.values()].sort((a, b) => (lower ? a.score - b.score : b.score - a.score));
    if (merged.length >= want) { writeFileSync(cacheFile, JSON.stringify(merged)); return merged; }
  }
  const t0 = Date.now();
  const pool = runPoolFresh(manifest, want, seedOverride);
  console.log(`  bots: ${manifest.title}: ${pool.length} distinct runs in ${Math.round((Date.now() - t0) / 1000)} s`);
  mkdirSync(join(OUT, 'runs'), { recursive: true });
  writeFileSync(process.env.FW_SHARD ? cacheFile.replace(/\.json$/, `.shard-${process.env.FW_SHARD.replace('/', 'of')}.json`) : cacheFile, JSON.stringify(pool));
  return pool;
}
function runPoolFresh(manifest, want, seedOverride) {
  const text = gameTextOf(manifest);
  const sm = manifest.score ?? {};
  const finishedOnly = sm.counts_when === 'finished';
  const rate = sm.bounds?.max_rate_per_s;
  const seed = seedOverride ?? (Number(manifest.seed) || 1);
  const byScore = new Map();
  const tries = Number(process.env.FW_RUNS) || want * 3 + 6;
  const [shardK, shardN] = (process.env.FW_SHARD ?? '0/1').split('/').map(Number);
  for (let i = shardK; i < tries && byScore.size < want + 3; i += shardN) {
    const typed = /"text"\s*:\s*"submit"/.test(text); // a typed-answer game: the answer bot, not the tap bots
    const r = (typed ? textRun : playRun)(text, { seed, skill: [0.15, 0.35, 0.55, 0.75, 0.9, 0.97][i % 6], botSeed: 3000 + i * 13 });
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
      const r = await fetch(`${SOURCE_GAMES}/${id}/manifest.json`, { headers: { 'User-Agent': 'friend-world-seed' } });
      if (!r.ok) throw new Error(`manifest ${id}: ${r.status}`);
      sourceCache[id] = await r.json();
    } catch (e) {
      if (i === 4) throw e;
      await sleep(3000 * (i + 1));
    }
  }
  return sourceCache[id];
}
const copyID = (src, suffix) => `${String(src.id).slice(0, 63 - suffix.length).replace(/-+$/, '')}-${suffix}`;

// a public Prod game on this API: by id, then by its manifest slug, then (local tests) an unchanged upload
async function publicGame(source) {
  if (state.publicGames[source]) return state.publicGames[source];
  const src = await sourceManifest(source);
  let r = await call('GET', `/v1/games/${source}`);
  if (r.status !== 200) r = await call('GET', `/v1/games/${encodeURIComponent(src.id)}`);
  let id = r.status === 200 ? r.data.id : undefined;
  if (!id && MIRROR) {
    const up = must(await call('POST', '/v1/creations', { token: await tok('mirror'), zip: zipFiles([['manifest.json', Buffer.from(JSON.stringify(src))]]) }), `mirror ${source}`);
    id = up.id;
    if (up.unlisted) must(await call('POST', `/v1/creations/${id}/publish`, { token: await tok('mirror') }), `publish mirror ${source}`);
  }
  if (!id) { console.log(`  ${src.title} (${source}) isn't on ${API}; skipped`); return undefined; }
  state.publicGames[source] = { id, title: src.title };
  saveState();
  return state.publicGames[source];
}

async function postScores(boardKey, gameId, m, order, picks) {
  state.scores[boardKey] ??= {};
  for (let i = 0; i < order.length; i++) {
    const who = order[i], run = picks[i];
    if (state.scores[boardKey][who] != null) continue;
    const r = await call('POST', `/v1/games/${gameId}/scores`, { token: await tok(who), json: m.score ? { log: run.log } : { score: run.score } });
    if (r.status !== 200 && r.status !== 201) {
      console.log(`  ${nameOf(who)}'s run was refused: ${r.status} ${String(r.data?.error ?? '').slice(0, 120)}`);
      continue;
    }
    if (r.data.counted === false) console.log(`  ${nameOf(who)}'s run not counted: ${r.data.reason ?? ''}`);
    state.scores[boardKey][who] = { score: r.data.score ?? run.score, display: r.data.display ?? String(run.score) };
    saveState();
  }
}
const boardLine = async (gameId) => {
  const board = must(await call('GET', `/v1/games/${gameId}/leaderboard?limit=20`, { token: await tok(ME) }), 'board');
  const name = Object.fromEntries(Object.entries(state.accounts).map(([k, a]) => [a.id, nameOf(k)]));
  return (board.items ?? []).map((x) => `${name[x.userId] ?? x.username} ${x.display ?? x.score}`).join(', ');
};

// ---- plan: copies and bot runs (also what --dry shows) ----
console.log(`friend-world → ${API}${DRY ? ' (dry run)' : ''}${MIRROR ? ' (mirroring public games)' : ''}; out ${OUT}`);
const plan = [];
for (const g of world.groups) {
  const short = g.id.replace(/^group-/, '');
  for (const spec of g.games) {
    const src = await sourceManifest(spec.source);
    const m = structuredClone(src);
    m.id = copyID(src, short.replace(/-/g, '').slice(0, 12));
    m.structure = { ...(src.structure ?? {}), scope: `group:${g.id}`, group_id: g.id };
    const pool = runPool(m, spec.order.length);
    m.bots = pool.slice(0, 20).map((r, i) => ({ skill: [0.35, 0.7, 0.95][i % 3], score: r.score, sec: Math.round(r.seconds * 10) / 10 }));
    const picks = assign(pool, spec.order.length);
    const key = `${short}-${spec.key}`;
    console.log(`${key}: "${src.title}" → ${m.id}; pool ${pool.length}: ${pool.slice(0, 12).map((r) => r.score).join(' ')}`);
    if (picks) console.log('  ' + spec.order.map((k, i) => `${nameOf(k)} ${picks[i].score}`).join(', '));
    else console.log(`  not enough distinct finished runs for ${spec.order.length} people`);
    plan.push({ g, spec, src, m, pool, picks, key });
  }
}
const publicPlan = [];
for (const pg of world.publicGames) {
  const src = await sourceManifest(pg.source);
  const pool = runPool(src, pg.players.length);
  const picks = assign(pool, pg.players.length);
  console.log(`public ${src.title}: pool ${pool.length}${picks ? '; ' + pg.players.map((k, i) => `${nameOf(k)} ${picks[i].score}`).join(', ') : '; no scores'}`);
  publicPlan.push({ pg, src, picks });
}
if (DRY || WARM) { console.log('dry run: nothing sent'); process.exit(0); }

// ---- accounts and profiles ----
if (MIRROR) people.mirror = { key: 'mirror', first: 'Prod', last: 'Mirror', username: 'prod_mirror', team: false };
const everyone = [...new Set([ME, ...world.friends, ...world.people.map((p) => p.key)])];
for (const k of everyone) tokens[k] = await signIn(k);
console.log(`accounts: ${everyone.map((k) => `${nameOf(k)} (${state.accounts[k].username})`).join(', ')}`);
for (const p of world.people) {
  if (state.accounts[p.key].profiled) continue;
  must(await call('PATCH', '/v1/me/profile', { token: await tok(p.key), json: { displayName: displayName(p), bio: p.bio, avatarUrl: p.avatarUrl } }), `profile ${p.key}`);
  state.accounts[p.key].profiled = true;
  saveState();
}
if (MIRROR) { // local: teammates get their team-world look too
  for (const k of [ME, ...world.friends]) {
    const p = people[k];
    must(await call('PATCH', '/v1/me/profile', { token: await tok(k), json: { displayName: displayName(p), bio: p.bio ?? '', avatarUrl: p.avatarUrl ?? '', coverColor: p.coverColor ?? '' } }), `profile ${k}`);
  }
}

// ---- friendships: me with the four, the four with each other, synthetic friends; never me with notFriendsOfMe ----
const pairs = [];
const circle = [ME, ...world.friends];
for (let i = 0; i < circle.length; i++) for (let j = i + 1; j < circle.length; j++) pairs.push([circle[i], circle[j]]);
pairs.push(...world.friendships);
for (const [a, b] of pairs) {
  if (a === ME && world.notFriendsOfMe.includes(b)) throw new Error(`world.json makes ${b} my friend`);
  const k = `${a}:${b}`;
  if (state.friendships[k]) continue;
  must(await call('PUT', `/v1/me/friends/${idOf(b)}`, { token: await tok(a) }), `friend ${k}`);
  state.friendships[k] = true;
  saveState();
}
const myFriends = new Set((must(await call('GET', '/v1/me/friends', { token: await tok(ME) }), 'my friends').items ?? []).map((f) => f.id));
for (const k of world.notFriendsOfMe) if (myFriends.has(idOf(k))) console.log(`WARNING: ${nameOf(k)} is already ${nameOf(ME)}'s friend; the Add friend beat won't show for them`);
console.log(`friendships: ${pairs.length}; ${nameOf(ME)} has ${myFriends.size} friends`);

// ---- Groups ----
for (const g of world.groups) {
  const settings = { name: g.name, category: g.category, about: g.about, coverSeed: g.coverSeed, coverColor: g.coverColor, joinPolicy: g.joinPolicy, recruiting: !!g.recruiting };
  const r = await call('POST', '/v1/groups', { token: await tok(g.owner), json: { id: g.id, kind: 'group', ...settings } });
  if (r.status === 201 && r.data.id !== g.id) throw new Error(`the API gave ${g.id} the id ${r.data.id}`);
  if (r.status === 409) {
    const ex = must(await call('GET', `/v1/groups/${g.id}`, { token: await tok(g.owner) }), `group ${g.id}`);
    if (ex.group?.name !== g.name) throw new Error(`${g.id} exists with another name (${ex.group?.name}); not touching it`);
  } else if (r.status !== 201) must(r, `create ${g.id}`);
  const have = new Set(must(await call('GET', `/v1/groups/${g.id}`, { token: await tok(g.owner) }), `group ${g.id}`).members.map((m) => m.id));
  for (const key of g.members) {
    if (have.has(idOf(key))) continue;
    must(await call('PUT', `/v1/groups/${g.id}/members/me`, { token: await tok(key) }), `join ${g.id} ${key}`);
  }
  const detail = must(await call('GET', `/v1/groups/${g.id}`, { token: await tok(ME) }), `group ${g.id}`);
  state.groups[g.id] = { name: g.name, members: detail.members.map((m) => m.displayName) };
  saveState();
  console.log(`Group ${g.id} "${g.name}": ${detail.members.length} members`);
}

// ---- Group copies, scores, sound, challenge, round (in world order, so the last copy is the Group's newest) ----
let sounds;
async function soundId(title) {
  sounds ??= (must(await call('GET', `/v1/sounds?q=${encodeURIComponent(title)}&limit=20`), 'sounds').items ?? []);
  let s = sounds.find((x) => x.title === title);
  if (!s && MIRROR) { // local: a short silent placeholder under the same title
    const n = 8000, wav = Buffer.alloc(44 + n);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + n, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
    wav.write('data', 36); wav.writeUInt32LE(n, 40); wav.fill(128, 44);
    const zip = zipFiles([['manifest.json', Buffer.from(JSON.stringify({ title, audio: 'loop.wav', kind: 'library' }))], ['loop.wav', wav]]);
    s = must(await call('POST', '/v1/sounds', { token: await tok('mirror'), zip }), 'mirror sound');
  }
  return s?.id;
}
for (const { g, spec, src, m, picks, key } of plan) {
  let gameId = state.games[key]?.id;
  if (gameId && (await call('GET', `/v1/games/${gameId}`)).status !== 200) gameId = undefined;
  if (!gameId) {
    const r = await call('POST', '/v1/creations', { token: await tok(spec.by), zip: zipFiles([['manifest.json', Buffer.from(JSON.stringify(m))]]) });
    if (r.status === 422 && /slug|already/i.test(JSON.stringify(r.data))) gameId = must(await call('GET', `/v1/games/${m.id}`), `find ${m.id}`).id;
    else gameId = must(r, `upload ${key}`).id;
    if (r.data?.unlisted) must(await call('POST', `/v1/creations/${gameId}/publish`, { token: await tok(spec.by) }), `publish ${key}`);
  }
  // the source got a new build on Prod since the copy was made (an art do-over): a new build of the copy, same id and scores
  const hash = crypto.createHash('sha256').update(JSON.stringify(src)).digest('hex').slice(0, 16);
  if (state.games[key]?.id === gameId && state.games[key].srcHash && state.games[key].srcHash !== hash) {
    const u = await call('PUT', `/v1/creations/${gameId}`, { token: await tok(spec.by), zip: zipFiles([['manifest.json', Buffer.from(JSON.stringify(m))]]) });
    console.log(`  ${key}: source changed on Prod; new build of the copy: ${u.status}`);
  }
  state.games[key] = { ...(state.games[key] ?? {}), id: gameId, title: src.title, source: spec.source, slug: m.id, group: g.id, by: spec.by, srcHash: hash };
  saveState();
  if (picks) await postScores(`${key}:${gameId}`, gameId, m, spec.order, picks);
  console.log(`${key}: "${src.title}" ${gameId} by ${nameOf(spec.by)}; board: ${await boardLine(gameId)}`);

  if (spec.sound && !state.games[key].sound) {
    const sid = await soundId(spec.sound);
    if (sid) {
      must(await call('PUT', `/v1/games/${gameId}/sound`, { token: await tok(spec.by), json: { soundId: sid } }), `sound ${key}`);
      state.games[key].sound = { id: sid, title: spec.sound };
      saveState();
      console.log(`  sound: ${spec.sound} (${sid})`);
    } else console.log(`  sound "${spec.sound}" not found on this API; none set`);
  }
  if (spec.challenge) {
    const ck = `${key}:${gameId}`;
    const from = spec.challenge.from;
    if (!state.challenges[ck]) {
      const c = must(await call('POST', '/v1/challenges', { token: await tok(from), json: { gameId, toUserIds: spec.challenge.to.map(idOf) } }), `challenge ${ck}`);
      state.challenges[ck] = { id: c.id ?? c.challenge?.id ?? true, gameId, from, to: spec.challenge.to, score: state.scores[`${key}:${gameId}`]?.[from] };
      saveState();
    }
    console.log(`  challenge from ${nameOf(from)} (${state.challenges[ck].score?.display}) to ${spec.challenge.to.map(nameOf).join(', ')}`);
  }
  if (spec.round) {
    const rk = `${key}:${gameId}`;
    const from = spec.round.from;
    let round = state.rounds[rk];
    if (round && (await call('GET', `/v1/rounds/${round.id}`, { token: await tok(from) })).status !== 200) round = undefined;
    if (!round) {
      const r = must(await call('POST', '/v1/rounds', { token: await tok(from), json: { gameId, target: { kind: 'group', id: g.id } } }), `round ${rk}`);
      const rr = r.round ?? r;
      round = state.rounds[rk] = { id: rr.id, seed: rr.seed, gameId, from, played: false };
      saveState();
    }
    if (!round.played) {
      // the round's seed: the player's run must be on it; pick a run near the board score
      const rpool = runPool(m, 2, Number(round.seed) || undefined);
      const want = state.scores[`${key}:${gameId}`]?.[from]?.score;
      const run = rpool.slice().sort((a, b) => Math.abs(a.score - (want ?? 0)) - Math.abs(b.score - (want ?? 0)))[0];
      if (run) {
        const p = await call('POST', `/v1/rounds/${round.id}/plays`, { token: await tok(from), json: { log: run.log } });
        if (p.status === 200 || p.status === 201) { round.played = true; round.score = run.score; saveState(); }
        else console.log(`  round play refused: ${p.status} ${JSON.stringify(p.data).slice(0, 200)}`);
      }
    }
    const view = must(await call('GET', `/v1/rounds/${round.id}`, { token: await tok(ME) }), 'round view');
    const rv = view.round ?? view;
    console.log(`  Group round ${round.id} from ${nameOf(from)}: ${(rv.lines ?? []).map((l) => (typeof l === 'string' ? l : l.text ?? JSON.stringify(l))).join(' | ') || '(no lines)'}; closes ${rv.closesAt ?? '?'}`);
  }
}

// ---- public Curios: friends' scores and likes ----
for (const { pg, src, picks } of publicPlan) {
  const pub = await publicGame(pg.source);
  if (!pub) continue;
  if (picks) await postScores(`public:${pub.id}`, pub.id, src, pg.players, picks);
  for (const k of pg.likes) {
    const lk = `${pub.id}:${k}`;
    if (state.likes[lk]) continue;
    must(await call('PUT', `/v1/games/${pub.id}/like`, { token: await tok(k) }), `like ${lk}`, [200, 201, 204]);
    state.likes[lk] = true; saveState();
  }
  console.log(`public ${src.title} (${pub.id}): ${await boardLine(pub.id)}`);
}
for (const [key, who] of Object.entries(world.copyLikes)) {
  const game = Object.entries(state.games).find(([k]) => k.endsWith(`-${key}`))?.[1];
  if (!game) continue;
  for (const k of who) {
    const lk = `${game.id}:${k}`;
    if (state.likes[lk]) continue;
    must(await call('PUT', `/v1/games/${game.id}/like`, { token: await tok(k) }), `like ${lk}`, [200, 201, 204]);
    state.likes[lk] = true; saveState();
  }
}

// ---- posts, comments, reactions ----
const fill = (text) => text.replace(/\{([a-z-]+):([a-z]+)\}/g, (_, gk, who) => {
  const e = Object.entries(state.games).find(([k]) => k.endsWith(`-${gk}`));
  return String(e ? state.scores[`${e[0]}:${e[1].id}`]?.[who]?.display ?? '' : '');
});
for (const p of world.posts) {
  const known = state.posts[p.key];
  if (known && (await call('GET', `/v1/fb/posts/${known}`)).status === 200) continue;
  const body = { text: fill(p.text), ...(p.group ? { groupId: p.group } : {}) };
  state.posts[p.key] = must(await call('POST', '/v1/fb/posts', { token: await tok(p.by), json: body }), `post ${p.key}`).id;
  saveState();
  await sleep(1100);
}
for (const c of world.comments) {
  const ck = `${c.post}:${c.by}`;
  if (state.comments[ck] || !state.posts[c.post]) continue;
  state.comments[ck] = must(await call('POST', `/v1/fb/posts/${state.posts[c.post]}/comments`, { token: await tok(c.by), json: { text: c.text } }), `comment ${ck}`).id;
  saveState();
}
for (const x of world.reactions) {
  const xk = `${x.post}:${x.by}`;
  if (state.reactions[xk] || !state.posts[x.post]) continue;
  must(await call('PUT', `/v1/fb/posts/${state.posts[x.post]}/reaction`, { token: await tok(x.by), json: { type: x.type } }), `reaction ${xk}`);
  state.reactions[xk] = x.type; saveState();
}
console.log(`posts: ${Object.keys(state.posts).length}, comments: ${Object.keys(state.comments).length}, reactions: ${Object.keys(state.reactions).length}`);

// ---- what Karthik sees ----
const name = Object.fromEntries(Object.entries(state.accounts).map(([k, a]) => [a.id, nameOf(k)]));
for (const g of world.groups) {
  const wb = must(await call('GET', `/v1/groups/${g.id}/leaderboard`, { token: await tok(ME) }), `weekly ${g.id}`);
  console.log(`${g.name} weekly board ${wb.week}: ${(wb.items ?? []).map((x) => `${x.rank}. ${name[x.user?.id] ?? x.user?.username} ${x.points}${myFriends.has(x.user?.id) || x.user?.id === idOf(ME) ? '' : ' (not a friend)'}`).join(', ')}`);
  const gg = must(await call('GET', `/v1/groups/${g.id}/games`, { token: await tok(ME) }), `games ${g.id}`);
  console.log(`  ${g.name} games: ${(gg.items ?? gg.games ?? []).map((x) => x.title).join(' | ')}`);
}
const ch = must(await call('GET', '/v1/challenges', { token: await tok(ME) }), 'challenges');
const recv = ch.received ?? ch.items ?? [];
console.log(`challenges received by ${nameOf(ME)}: ${recv.length} ${JSON.stringify(recv.map((c) => ({ game: c.game?.title ?? c.gameId, from: c.from?.username ?? c.fromUsername, score: c.display ?? c.score, beaten: c.beaten }))).slice(0, 400)}`);
const feed = must(await call('GET', `/v1/feed?limit=10&sessionID=fw-check-${Date.now()}`, { token: await tok(ME) }), 'feed');
console.log(`${nameOf(ME)}'s feed top 10: ${(feed.items ?? []).map((x) => `${x.title}${x.sound ? ' [sound]' : ''} (${x.reason})`).join(' | ')}`);
console.log(`state: ${stateFile}`);
