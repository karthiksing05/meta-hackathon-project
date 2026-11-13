// Fills a games API with believable synthetic activity across the published Curios, so the feed, boards, Groups
// and the recommender have a crowd to work with: ~150 synthetic people (cartoon DiceBear avatars, @example.com
// emails, made-up names), friendships among them and a few links to the demo-world and team-world accounts, then
// plays, finishes, likes (saves are likes on this API), verified scores (real bot runs whose input logs the server
// replays), interest Groups with posts, comments and shared games, and challenges between friends.
//
//   node tools/fake-seed/seed.mjs --dry                         # plan it and play the bots, send nothing
//   node tools/fake-seed/seed.mjs                               # local API (http://127.0.0.1:8080)
//   node tools/fake-seed/seed.mjs --users 12 --bootstrap 6      # local test: first copy 6 open Prod games in
//   node tools/fake-seed/seed.mjs --api https://api.ol4ol.com --confirm-prod
//   options: --users N (default 150), --seed N (default 26), --bootstrap N (local APIs only), --no-scores,
//            --links <dir,...> (state dirs whose accounts get linked; default game-backups/demo-world,team-world)
//
// The game list is read at run time (GET /v1/games/stats then GET /v1/games/{id}), so it covers whatever is
// published. Only open games are played: Group- and Event-scoped copies (the demo world's boards) are left alone.
//
// Re-runnable and rate-limit aware: everything done is recorded in state-<host>.json and skipped next time; feed
// events carry stable eventIDs (a resend is a no-op); auth calls are spaced to the API's 10 a minute; 429s and 5xx
// back off. Passwords go only to game-backups/fake-seed/accounts.private.json (chmod 600) and are never printed.

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { playRun, gameTextOf } from '../demo-seed/bots.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes(name);

const API = opt('--api', process.env.FAKE_SEED_API || 'http://127.0.0.1:8080').replace(/\/$/, '');
const DRY = flag('--dry');
const USERS = Number(opt('--users', 150));
const SEED = Number(opt('--seed', 26));
const BOOTSTRAP = Number(opt('--bootstrap', 0));
// game-backups sits next to the main checkout (two levels above its .git), also when this runs from a worktree
const gitCommon = (() => { try { return execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim(); } catch { return join(repo, '.git'); } })();
const BACKUPS = process.env.GAME_BACKUPS_DIR || join(dirname(gitCommon), '..', 'game-backups');
const OUT = process.env.FAKE_SEED_DIR || join(BACKUPS, 'fake-seed');
const LINKS = (opt('--links', `${join(BACKUPS, 'demo-world')},${join(BACKUPS, 'team-world')}`)).split(',').filter(Boolean);
const PROD_API = 'https://api.ol4ol.com', PROD_GAMES = 'https://games.ol4ol.com';
const apiURL = new URL(API);
const host = apiURL.host.replace(/[^a-z0-9.-]/gi, '_');
const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(apiURL.hostname);
if (!isLocal && !DRY && !flag('--confirm-prod')) {
  console.error(`${API} is not a local API: pass --confirm-prod to write to it (or --dry to only plan)`);
  process.exit(2);
}
if (BOOTSTRAP && !isLocal) { console.error('--bootstrap copies Prod games and is for local APIs only'); process.exit(2); }

// ---- deterministic randomness ----
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rngFor = (...parts) => mulberry32(crypto.createHash('sha256').update([SEED, ...parts].join('|')).digest().readUInt32LE(0));
const pick = (r, l) => l[Math.floor(r() * l.length)];
const sample = (r, l, n) => { const c = l.slice(); for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c.slice(0, Math.max(0, n)); };
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

// ---- the synthetic people ----
const FIRST = ['Ava', 'Ben', 'Cleo', 'Dev', 'Elena', 'Finn', 'Grace', 'Hugo', 'Isla', 'Jae', 'Kira', 'Leo', 'Mina', 'Noah', 'Olive', 'Pablo',
  'Quinn', 'Rosa', 'Sami', 'Tess', 'Uma', 'Victor', 'Wren', 'Xavi', 'Yara', 'Zane', 'Amara', 'Bodhi', 'Carmen', 'Dario', 'Esme', 'Felix',
  'Gia', 'Hana', 'Ivo', 'June', 'Kai', 'Lila', 'Milo', 'Nia', 'Omar', 'Pia', 'Rafa', 'Sana', 'Theo', 'Vera', 'Wes', 'Zoe'];
const LAST = ['Abara', 'Bianchi', 'Castillo', 'Dubois', 'Eriksen', 'Ferreira', 'Garza', 'Hoang', 'Ibarra', 'Jansen', 'Kowalski', 'Lindqvist',
  'Moreau', 'Nakamura', 'Oduya', 'Petrov', 'Quintero', 'Rahman', 'Sato', 'Torres', 'Ueda', 'Varga', 'Whitlock', 'Yilmaz', 'Zhou',
  'Achebe', 'Brennan', 'Delacroix', 'Esposito', 'Fontaine', 'Halvorsen', 'Iwata', 'Kapoor', 'Laurent', 'Mbeki', 'Novak', 'Okoro', 'Park'];
const BIOS = ['Weekend hiker, weekday spreadsheet wrangler.', 'Coffee first, high scores second.', 'Board games and bad puns.',
  'New to the Bay, saying yes to everything.', 'Trivia night regular.', 'Sourdough in progress.', 'Cycling to work, rain or shine.',
  'Will challenge you to anything.', 'Collecting tiny wins.', 'Plant parent of 14.', 'Retro games forever.', 'Learning the ukulele, slowly.'];
const COLORS = ['#4F7CFF', '#7B61FF', '#5AA9E6', '#8E7CC3', '#6C8EBF', '#9AA5FF', '#5C6BC0', '#7E57C2'];
const AVATAR_STYLES = ['adventurer', 'avataaars', 'big-smile', 'fun-emoji', 'lorelei', 'micah', 'notionists', 'open-peeps'];

const people = [];
for (let i = 0; i < USERS; i++) {
  const r = rngFor('person', i);
  const first = FIRST[(i * 7 + Math.floor(r() * 3)) % FIRST.length], last = LAST[(i * 11 + Math.floor(r() * 5)) % LAST.length];
  const username = `${first}_${last}_${String(i).padStart(3, '0')}`.toLowerCase();
  people.push({
    key: `fake-${String(i).padStart(3, '0')}`, first, last, username,
    bio: pick(r, BIOS), coverColor: pick(r, COLORS),
    avatarUrl: `https://api.dicebear.com/9.x/${pick(r, AVATAR_STYLES)}/png?seed=${encodeURIComponent(username)}&size=256`,
    skill: 0.2 + 0.75 * r(), activity: 0.3 + 0.7 * r(), // how good, how much they play
  });
}

const GROUPS = [
  { id: 'group-curio-board-game-night', name: 'Board Game Night Crew', category: 'Games', about: 'Weekly board games, and Curios between the weeks.' },
  { id: 'group-curio-trivia-tuesdays', name: 'Trivia Tuesdays', category: 'Games', about: 'Pub trivia people. Bring your weirdest facts.' },
  { id: 'group-curio-sunday-runners', name: 'Sunday Morning Runners', category: 'Fitness', about: '5K loops, coffee after, quick games on the cooldown.' },
  { id: 'group-curio-retro-arcade', name: 'Retro Arcade Club', category: 'Games', about: 'Pixel art, high scores and arguing about the best era.' },
  { id: 'group-curio-bay-foodies', name: 'Bay Area Foodies', category: 'Food', about: 'Where to eat next, and who beat whom at the snack games.' },
  { id: 'group-curio-puzzle-people', name: 'Puzzle People', category: 'Hobbies', about: 'Crosswords, jigsaws and every daily puzzle we can find.' },
];
const POSTS = ['Who is beating my score on this one? Tried 6 times already.', 'New personal best tonight, finally.',
  'This one is way harder than it looks.', 'Okay, this Curio is my new favourite.', 'Group challenge: top score by Sunday wins coffee.',
  'Played this on the bus and missed my stop.', 'Anyone else stuck on the last level?', 'Shared a good one, go play it.'];
const COMMENTS = ['Challenge accepted.', 'Haha same', 'You are on.', 'My thumbs hurt.', 'Just beat it!', 'How?!', 'Teach me your ways.',
  'Doing this at lunch.', 'So good.', 'Rematch?', 'Nope, too hard for me.', 'Added it to my saves.'];

// ---- files ----
mkdirSync(OUT, { recursive: true });
const credFile = join(OUT, 'accounts.private.json');
const stateFile = join(OUT, `state-${host}.json`);
const creds = existsSync(credFile) ? JSON.parse(readFileSync(credFile, 'utf8')) : {};
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
creds[host] ??= {};
for (const k of ['accounts', 'profiles', 'friends', 'groups', 'members', 'events', 'likes', 'scores', 'posts', 'comments', 'shares', 'challenges', 'bootstrap']) state[k] ??= {};
state.api = API;
const saveCreds = () => { if (DRY) return; writeFileSync(credFile, JSON.stringify(creds, null, 2)); chmodSync(credFile, 0o600); };
const saveState = () => { if (DRY) return; state.updatedAt = new Date().toISOString(); writeFileSync(stateFile, JSON.stringify(state, null, 2)); };

// ---- HTTP: 429 and 5xx back off; auth calls are spaced to the API's 10 a minute ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, { token, json, zip, base = API } = {}) {
  for (let i = 0; i < 7; i++) {
    try {
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      let body;
      if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
      if (zip) { headers['Content-Type'] = 'application/zip'; body = zip; }
      const r = await fetch(base + path, { method, headers, body });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
      if (r.status === 429 || (r.status >= 502 && !/not set up|not_configured/.test(text))) console.log(`  ${method} ${path.split('?')[0]}: ${r.status}, retrying`);
      if (r.status === 429) { await sleep(Number(r.headers.get('retry-after')) * 1000 || 15000); continue; }
      if (r.status >= 502 && !/not set up|not_configured/.test(text)) { await sleep(3000 * (i + 1)); continue; }
      return { status: r.status, data };
    } catch (e) {
      if (i === 6) throw e;
      await sleep(2000 * (i + 1));
    }
  }
  return { status: 0, data: { error: 'retries exhausted' } };
}
const ok = (r) => r.status >= 200 && r.status < 300;
const must = (r, what) => { if (!ok(r)) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); return r.data; };
const AUTH_GAP = Number(opt('--auth-gap-ms', 6500));
let lastAuth = 0;
async function authCall(path, json) {
  const wait = lastAuth + AUTH_GAP - Date.now();
  if (wait > 0) await sleep(wait);
  lastAuth = Date.now();
  return call('POST', path, { json });
}
const tokens = {};
async function signIn(p) {
  const c = creds[host][p.key];
  if (tokens[p.key] && tokens[p.key].until > Date.now() + 60_000) return tokens[p.key].token;
  const keep = (data) => {
    creds[host][p.key].userId = data.user.id;
    saveCreds();
    state.accounts[p.key] = { id: data.user.id, username: data.user.username };
    saveState();
    tokens[p.key] = { token: data.accessToken, until: Date.now() + 14 * 60_000 };
    return data.accessToken;
  };
  if (c) return keep(must(await authCall('/v1/auth/login', { email: c.email, password: c.password }), `login ${p.key}`));
  for (const suffix of ['', 'x', 'y']) {
    const username = (p.username + suffix).slice(0, 24);
    const email = `${username.replace(/_/g, '.')}.curio@example.com`;
    const password = crypto.randomBytes(18).toString('base64url');
    const r = await authCall('/v1/auth/register', { email, username, displayName: `${p.first} ${p.last}`, password });
    if (r.status === 201) {
      creds[host][p.key] = { email, username, password, created: new Date().toISOString() };
      return keep(r.data);
    }
    if (r.status !== 409) must(r, `register ${p.key}`);
  }
  throw new Error(`no free username for ${p.key}`);
}
const tok = (key) => signIn(people.find((p) => p.key === key) ?? bootstrapMaker);

// ---- a package zip (stored): manifest.json only ----
function zipOne(name, data) {
  const nameBuf = Buffer.from(name), crc = zlib.crc32(data) >>> 0, n = data.length;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(n, 18); local.writeUInt32LE(n, 22); local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(n, 20); central.writeUInt32LE(n, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBuf.length, 12); end.writeUInt32LE(30 + nameBuf.length + n, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
}

// ---- local test: copy some open Prod games in (reads Prod, writes only the local API) ----
const bootstrapMaker = { key: 'fake-maker', first: 'Curio', last: 'Maker', username: 'curio_maker_fake' };
const manifestCache = {};
if (BOOTSTRAP && !DRY) {
  const prod = must(await call('GET', '/v1/games/stats', { base: PROD_API }), 'Prod game list').games ?? [];
  const open = prod.filter((g) => !g.groupID && g.id).sort((a, b) => (b.takeovers ?? 0) - (a.takeovers ?? 0));
  let copied = Object.keys(state.bootstrap).length;
  for (const g of open) {
    if (copied >= BOOTSTRAP) break;
    if (state.bootstrap[g.id]) continue;
    const res = await fetch(`${PROD_GAMES}/${g.id}/manifest.json`);
    if (!res.ok) continue;
    const m = await res.json();
    try { gameTextOf(m); } catch { continue; } // microgames only, so the bots can play them
    if (m.structure?.scope && m.structure.scope !== 'everyone') continue;
    const r = await call('POST', '/v1/creations', { token: await signIn(bootstrapMaker), zip: zipOne('manifest.json', Buffer.from(JSON.stringify(m))) });
    if (!ok(r)) { console.log(`  bootstrap: ${m.title}: ${r.status}`); continue; }
    if (r.data?.unlisted) await call('POST', `/v1/creations/${r.data.id}/publish`, { token: await signIn(bootstrapMaker) });
    state.bootstrap[g.id] = r.data.id;
    manifestCache[r.data.id] = m;
    copied++;
    saveState();
  }
  console.log(`bootstrap: ${copied} Prod games on ${API}`);
}

// ---- the game list, read at run time ----
const stats = must(await call('GET', '/v1/games/stats'), 'game list').games ?? [];
const games = [];
for (const s of stats) {
  if (!s.id || s.groupID) continue; // Group and Event copies are the demo world's boards
  const r = await call('GET', `/v1/games/${s.id}`);
  if (r.status !== 200) continue;
  const g = r.data;
  if (g.scope && g.scope !== 'everyone') continue;
  games.push({ id: g.id, title: g.title, formula: g.formula ?? 'other', manifestUrl: g.manifestUrl, score: g.score, sponsored: !!g.sponsor });
}
console.log(`fake-seed → ${API}${DRY ? ' (dry run)' : ''}: ${people.length} people, ${games.length} open games`);
if (!games.length) { console.log('no open games: nothing to play'); }

// bot run pools per game: distinct finished, in-bounds runs, best first (the same rules the server's replay checks)
async function manifestOf(g) {
  if (manifestCache[g.id]) return manifestCache[g.id];
  for (const url of [g.manifestUrl, `${PROD_GAMES}/${g.id}/manifest.json`]) {
    if (!url) continue;
    try { const r = await fetch(url); if (r.ok) return (manifestCache[g.id] = await r.json()); } catch { /* next */ }
  }
  return null;
}
const pools = {};
async function poolOf(g) {
  if (pools[g.id]) return pools[g.id];
  pools[g.id] = [];
  if (flag('--no-scores')) return pools[g.id];
  const m = await manifestOf(g);
  let text; try { text = gameTextOf(m); } catch { return pools[g.id]; }
  const sm = m.score ?? {}, seed = Number(m.seed) || 1, rate = sm.bounds?.max_rate_per_s;
  const byScore = new Map();
  for (let i = 0; i < 18 && byScore.size < 10; i++) {
    const r = playRun(text, { seed, skill: [0.15, 0.35, 0.55, 0.75, 0.9, 0.97][i % 6], botSeed: 2000 + i * 17 });
    if (!r || (r.phase !== 'won' && r.phase !== 'lost') || (sm.counts_when === 'finished' && r.phase !== 'won')) continue;
    if (sm.bounds && (r.score < (sm.bounds.min ?? 0) || (sm.bounds.max != null && r.score > sm.bounds.max))) continue;
    if (rate && r.seconds > 0 && r.score / r.seconds > rate) continue;
    if (r.score <= 0 || byScore.has(r.score)) continue;
    byScore.set(r.score, r);
  }
  const lower = sm.direction === 'lower';
  pools[g.id] = [...byScore.values()].sort((a, b) => (lower ? a.score - b.score : b.score - a.score));
  pools[g.id].scored = !!m.score;
  return pools[g.id];
}

// ---- the plan: who plays what, who is friends with whom, who is in which Group ----
const formulas = [...new Set(games.map((g) => g.formula))];
const plan = people.map((p, i) => {
  const r = rngFor('plan', p.key);
  const loves = sample(r, formulas, between(r, 1, 2));
  const weighted = games.map((g) => ({ g, w: (loves.includes(g.formula) ? 3 : 1) * (0.5 + r()) })).sort((a, b) => b.w - a.w);
  const n = Math.min(games.length, Math.round(4 + 14 * p.activity));
  return { p, loves, plays: weighted.slice(0, n).map((x) => x.g) };
});
const friendPairs = new Set();
const addPair = (a, b) => { if (a !== b) friendPairs.add([a, b].sort().join('~')); };
people.forEach((p, i) => {
  const r = rngFor('friends', p.key);
  addPair(p.key, people[(i + 1) % people.length].key); // a ring keeps everyone connected
  for (const q of sample(r, people, between(r, 2, 6))) addPair(p.key, q.key);
});
const groupMembers = Object.fromEntries(GROUPS.map((g, gi) => {
  const r = rngFor('group', g.id);
  return [g.id, sample(r, people, Math.min(people.length, between(r, 18, 34)))];
}));
// links to the demo-world and team-world accounts (ids from their state files; ids aren't secret)
const linked = [];
for (const dir of LINKS) {
  const f = join(dir, `state-${host}.json`);
  if (!existsSync(f)) continue;
  try { for (const [k, a] of Object.entries(JSON.parse(readFileSync(f, 'utf8')).accounts ?? {})) if (a?.id) linked.push({ key: `${dir.split('/').pop()}:${k}`, id: a.id }); } catch { /* skip */ }
}
console.log(`plan: ${friendPairs.size} friendships, ${linked.length} linked demo/team accounts, ${GROUPS.length} Groups (${Object.values(groupMembers).reduce((n, l) => n + l.length, 0)} memberships), ${plan.reduce((n, x) => n + x.plays.length, 0)} plays`);

const counts = { accounts: 0, profiles: 0, friends: 0, links: 0, groups: 0, members: 0, plays: 0, likes: 0, scores: 0, posts: 0, comments: 0, shares: 0, challenges: 0, skipped: 0 };
const has = (bucket, key) => !!state[bucket][key];
const mark = (bucket, key, v = true) => { state[bucket][key] = v; saveState(); };

if (DRY) {
  for (const g of games.slice(0, 8)) {
    const pool = await poolOf(g);
    console.log(`  ${g.title} (${g.formula}): ${pool.length} distinct bot runs ${pool.slice(0, 8).map((r) => r.score).join(' ')}`);
  }
  console.log('dry run: nothing sent');
  process.exit(0);
}

// 1. accounts and profiles (auth is the slow part: ~6.5 s per person on a fresh run)
for (const p of people) {
  const fresh = !state.accounts[p.key];
  const t = await signIn(p);
  if (fresh) counts.accounts++;
  if (!has('profiles', p.key)) {
    const r = await call('PATCH', '/v1/me/profile', { token: t, json: { avatarUrl: p.avatarUrl, bio: p.bio, coverColor: p.coverColor } });
    if (ok(r)) { mark('profiles', p.key); counts.profiles++; }
  }
}
const idOf = (key) => state.accounts[key]?.id;
console.log(`accounts: ${Object.keys(state.accounts).length} (${counts.accounts} new)`);

// 2. friendships, then links to the demo and team accounts (a few people each)
for (const pair of friendPairs) {
  if (has('friends', pair)) continue;
  const [a, b] = pair.split('~');
  if (ok(await call('PUT', `/v1/me/friends/${idOf(b)}`, { token: await tok(a) }))) { mark('friends', pair); counts.friends++; }
}
for (const [i, l] of linked.entries()) {
  for (const p of sample(rngFor('link', l.key), people, 3)) {
    const k = `${p.key}~${l.key}`;
    if (has('friends', k)) continue;
    if (ok(await call('PUT', `/v1/me/friends/${l.id}`, { token: await tok(p.key) }))) { mark('friends', k); counts.links++; }
  }
}

// 3. Groups and members
for (const g of GROUPS) {
  const members = groupMembers[g.id];
  if (!members.length) continue;
  const owner = members[0];
  if (!has('groups', g.id)) {
    const r = await call('POST', '/v1/groups', { token: await tok(owner.key), json: { ...g, kind: 'group', coverSeed: g.id } });
    if (r.status === 201 || r.status === 409) { mark('groups', g.id, r.status === 201 ? owner.key : 'existing'); counts.groups += r.status === 201 ? 1 : 0; }
  }
  for (const m of members) {
    const k = `${g.id}~${m.key}`;
    if (has('members', k)) continue;
    if (ok(await call('PUT', `/v1/groups/${g.id}/members/me`, { token: await tok(m.key) }))) { mark('members', k); counts.members++; }
  }
}

// 4. plays, finishes, likes and verified scores
const today = Math.floor(Date.now() / 86400000);
for (const { p, loves, plays } of plan) {
  const t = await tok(p.key);
  const events = [];
  for (const [pos, g] of plays.entries()) {
    const r = rngFor('play', p.key, g.id); // one stream per person and game, so a re-run makes the same choices
    const loved = loves.includes(g.formula);
    const took = loved || r() < 0.55;
    const finished = took ? (r() < (loved ? 0.85 : 0.5) ? between(r, 1, 3) : 0) : 0;
    const liked = took && r() < (loved ? 0.45 : 0.12);
    const ev = { eventID: `fake-${SEED}-${p.key}-${g.id}`, gameID: g.id, sessionID: `fake-${p.key}`, position: pos, day: today - between(r, 0, 6),
      dwellSec: took ? 20 + Math.round(90 * r()) : 1 + Math.round(4 * r()), tookOver: took, runsFinished: finished,
      replays: finished > 1 ? finished - 1 : 0, liked, saved: liked, quitMidRun: took && !finished };
    if (!has('events', ev.eventID)) events.push(ev);
    if (liked && !has('likes', `${p.key}~${g.id}`)) {
      if (ok(await call('PUT', `/v1/games/${g.id}/like`, { token: t }))) { mark('likes', `${p.key}~${g.id}`); counts.likes++; }
    }
    if (finished && !has('scores', `${p.key}~${g.id}`)) {
      const pool = await poolOf(g);
      if (pool.length) {
        // better players get better runs, with some luck either way
        const luck = rngFor('run', p.key, g.id)();
        const idx = Math.max(0, Math.min(pool.length - 1, Math.round((1 - p.skill) * (pool.length - 1) + (luck - 0.5) * 3)));
        const run = pool[idx];
        const s = await call('POST', `/v1/games/${g.id}/scores`, { token: t, json: pool.scored ? { log: run.log } : { score: run.score } });
        if (ok(s)) { mark('scores', `${p.key}~${g.id}`, s.data?.score ?? run.score); counts.scores++; } else counts.skipped++;
      }
    }
  }
  for (let i = 0; i < events.length; i += 100) {
    const batch = events.slice(i, i + 100);
    if (ok(await call('POST', '/v1/feed/events', { token: t, json: { events: batch } }))) {
      for (const e of batch) state.events[e.eventID] = true;
      saveState();
      counts.plays += batch.filter((e) => e.tookOver).length;
    } else counts.skipped++;
  }
  console.log(`  ${p.key}: ${plays.length} games, ${counts.plays} plays, ${counts.likes} likes, ${counts.scores} scores so far`);
}

// 5. Group posts, comments and shared games
for (const g of GROUPS) {
  const members = groupMembers[g.id];
  for (let i = 0; i < Math.min(4, members.length); i++) {
    const r = rngFor('post', g.id, i);
    const k = `${g.id}~${i}`, author = members[(i * 5) % members.length], text = pick(r, POSTS), nComments = between(r, 1, 4);
    let postId = state.posts[k];
    if (!postId) {
      const res = await call('POST', '/v1/fb/posts', { token: await tok(author.key), json: { text, groupId: g.id } });
      if (!ok(res)) { counts.skipped++; continue; }
      postId = res.data.id ?? res.data.post?.id;
      mark('posts', k, postId);
      counts.posts++;
    }
    for (let c = 0; c < nComments; c++) {
      const cr = rngFor('comment', g.id, i, c);
      const ck = `${k}~${c}`, who = pick(cr, members), say = pick(cr, COMMENTS);
      if (has('comments', ck) || !postId) continue;
      if (ok(await call('POST', `/v1/fb/posts/${postId}/comments`, { token: await tok(who.key), json: { text: say } }))) { mark('comments', ck); counts.comments++; }
    }
  }
  for (const game of sample(rngFor('shares', g.id), games, 2)) {
    const k = `${g.id}~${game.id}`, who = pick(rngFor('sharer', g.id, game.id), members);
    if (has('shares', k)) continue;
    if (ok(await call('POST', `/v1/groups/${g.id}/game-shares`, { token: await tok(who.key), json: { gameId: game.id, eventId: `fake-share-${g.id}-${game.id}` } }))) { mark('shares', k); counts.shares++; }
  }
}

// 6. challenges: about one person in six challenges one or two friends on a game they scored
const friendsOf = {};
for (const pair of friendPairs) { const [a, b] = pair.split('~'); (friendsOf[a] ??= []).push(b); (friendsOf[b] ??= []).push(a); }
for (const { p } of plan) {
  const r = rngFor('challenge', p.key);
  if (r() > 0.17 || has('challenges', p.key)) continue;
  const scored = Object.keys(state.scores).filter((k) => k.startsWith(`${p.key}~`)).map((k) => k.split('~')[1]);
  const fs = (friendsOf[p.key] ?? []).filter((k) => idOf(k));
  if (!scored.length || !fs.length) continue;
  const res = await call('POST', '/v1/challenges', { token: await tok(p.key), json: { gameId: pick(r, scored), toUserIds: sample(r, fs, between(r, 1, 2)).map(idOf) } });
  if (ok(res)) { mark('challenges', p.key); counts.challenges++; } else counts.skipped++;
}

console.log(`done: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`state: ${stateFile}`);
