// Seeds the games side of the demo world on a games API: the synthetic New in SF cast as accounts, their friendships,
// the "New in SF" Group and the newcomers' picnic Event (with the same ids the app's demo world and the /v1/fb seed
// use: group-newinsf, event-newcomers-picnic), copies of real Muse-made games scoped to them, verified scores from
// the cast (bot runs replayed by the server from their real input logs), and today's Daily, which notifies the
// Group's members ("Today's Daily in New in SF is ready").
//
//   node tools/demo-seed/seed.mjs                      # local API (http://127.0.0.1:8080)
//   node tools/demo-seed/seed.mjs --api https://api.ol4ol.com
//   options: --date YYYY-MM-DD (the Daily's day; default today in San Francisco), --daily-source <Prod game id>
//            (the game the Daily copies; default Spinning Cat Crossing), --no-scores, --dry (plan and play the
//            bots, send nothing)
//
// Re-runnable: accounts, friendships, memberships, uploads and scores that already exist are kept (a score that
// isn't better is not counted). Run it again on a later day (or with --date) for that day's Daily: a fresh copy with
// that day's scores, and a new "Today's Daily" notification.
//
// People are synthetic (FacebookClone/Bubbles/Seeds/bubble-demo-world.json); emails are @example.com. Passwords are
// stored only in game-backups/demo-world/accounts.private.json (chmod 600) and never printed. Ids that aren't
// secret (accounts, games, scores) go to game-backups/demo-world/state-<host>.json.

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { playRun, gameTextOf } from './bots.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes(name);

const API = (opt('--api', process.env.DEMO_API || 'http://127.0.0.1:8080')).replace(/\/$/, '');
const SOURCE_API = 'https://api.ol4ol.com'; // where the original games live (public reads)
const SOURCE_GAMES = 'https://games.ol4ol.com';
const OUT = process.env.DEMO_SEED_DIR || join(repo, '..', '..', 'game-backups', 'demo-world');
const DRY = flag('--dry');
const sfToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const DATE = opt('--date', sfToday());
const host = new URL(API).host.replace(/[^a-z0-9.-]/gi, '_');

const world = JSON.parse(readFileSync(join(repo, 'FacebookClone/Bubbles/Seeds/bubble-demo-world.json'), 'utf8'));
const GROUP_ID = 'group-newinsf'; // = world.group.id and the /v1/fb seed's Group posts
const EVENT_ID = 'event-newcomers-picnic'; // = world.event.id

// ---- the cast ----
// The phone signs in as Alex (the app's "me"). The ten newcomers come from the demo world; Diego hosts the Group.
const cast = [
  { key: 'me-alex', first: 'Alex', last: 'Rivera', username: 'alex_rivera', picnic: true },
  ...world.people.map((p) => ({
    key: p.id, first: p.first_name, last: p.last_name, picnic: p.going_to_picnic, friendOfAlex: p.is_friend,
    username: `${p.first_name}_${p.last_name}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9_]/g, ''),
  })),
];
const HOST = 'sf-diego-ramirez';
// Friendships besides Alex's (Alex's come from the world file: Diego, Aiko and Theo). Maya stays a stranger to
// Alex, so "Add friend" on her board row is the demo's move.
const extraFriends = [
  ['sf-maya-okafor', 'sf-lena-fischer'], ['sf-maya-okafor', 'sf-priya-natarajan'], ['sf-diego-ramirez', 'sf-jordan-brooks'],
  ['sf-diego-ramirez', 'sf-maya-okafor'], ['sf-omar-haddad', 'sf-chloe-nguyen'], ['sf-sam-whitfield', 'sf-aiko-tanaka'],
  ['sf-theo-adeyemi', 'sf-chloe-nguyen'], ['sf-lena-fischer', 'sf-jordan-brooks'], ['sf-priya-natarajan', 'sf-chloe-nguyen'],
];

// ---- the games: copies of real Muse-made games (Kevin's harness-v2 set on Prod), scoped to the Group or the Event ----
// order: who has played, best first. Maya sits just above Alex on the Daily ("Maya's just above you").
// Each date gets its own copy of the Daily, played that day, so the Group card's "Today's top 3" is today's.
const games = [
  { key: `daily-${DATE}`, source: opt('--daily-source', '2e4c4961391461a869d3b210'), scope: 'group', daily: true, by: HOST,
    order: ['sf-lena-fischer', 'sf-diego-ramirez', 'sf-priya-natarajan', 'sf-maya-okafor', 'me-alex', 'sf-omar-haddad', 'sf-chloe-nguyen', 'sf-jordan-brooks'] },
  { key: 'group-brainrot-trivia', source: 'aab77e45a0122c0326134be9', scope: 'group', by: 'sf-theo-adeyemi',
    order: ['sf-theo-adeyemi', 'sf-maya-okafor', 'sf-sam-whitfield', 'sf-chloe-nguyen', 'sf-diego-ramirez', 'sf-aiko-tanaka'] },
  { key: 'group-rizz-or-flop', source: 'dda6c535e2a45f7b2d67f63e', scope: 'group', by: 'sf-chloe-nguyen',
    order: ['sf-jordan-brooks', 'sf-chloe-nguyen', 'sf-omar-haddad', 'sf-maya-okafor', 'sf-theo-adeyemi'] },
  { key: 'event-guess-the-decade', source: 'dca2283a1b53cd83a57173d0', scope: 'event', by: HOST,
    order: ['sf-priya-natarajan', 'sf-maya-okafor', 'sf-lena-fischer', 'sf-omar-haddad', 'sf-jordan-brooks', 'sf-chloe-nguyen'] },
];
const DAILY_KEY = games.find((g) => g.daily).key;

// ---- files ----
mkdirSync(OUT, { recursive: true });
const credFile = join(OUT, 'accounts.private.json');
const stateFile = join(OUT, `state-${host}.json`);
const creds = existsSync(credFile) ? JSON.parse(readFileSync(credFile, 'utf8')) : {};
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
creds[host] ??= {};
Object.assign(state, { api: API, groupId: GROUP_ID, eventId: EVENT_ID, accounts: state.accounts ?? {}, games: state.games ?? {}, scores: state.scores ?? {} });
const saveCreds = () => { if (DRY) return; writeFileSync(credFile, JSON.stringify(creds, null, 2)); chmodSync(credFile, 0o600); };
const saveState = () => { if (DRY) return; state.updatedAt = new Date().toISOString(); writeFileSync(stateFile, JSON.stringify(state, null, 2)); };

// ---- HTTP ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, { token, json, zip, base = API } = {}) {
  for (let i = 0; i < 6; i++) {
    try {
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      let body;
      if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
      if (zip) { headers['Content-Type'] = 'application/zip'; body = zip; }
      const r = await fetch(base + path, { method, headers, body });
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

// Auth routes allow 10 a minute per address, so accounts sign in slowly; a token is reused while it's fresh.
let lastAuth = 0;
async function authCall(path, json) {
  const wait = lastAuth + 6500 - Date.now();
  if (wait > 0) await sleep(wait);
  lastAuth = Date.now();
  return call('POST', path, { json });
}

async function signIn(person) {
  const c = creds[host][person.key];
  if (c?.accessToken && c.tokenUntil > Date.now() + 60_000) return c.accessToken;
  const keep = (data) => {
    Object.assign(creds[host][person.key], { userId: data.user.id, accessToken: data.accessToken, tokenUntil: Date.now() + 14 * 60_000 });
    saveCreds();
    state.accounts[person.key] = { id: data.user.id, username: data.user.username, displayName: data.user.displayName };
    saveState();
    return data.accessToken;
  };
  if (c) return keep(must(await authCall('/v1/auth/login', { email: c.email, password: c.password }), `login ${person.key}`));
  for (const suffix of ['', '_sf', '_nsf']) {
    const username = (person.username + suffix).slice(0, 24);
    const email = `${username.replace(/_/g, '.')}.demo@example.com`;
    const password = crypto.randomBytes(18).toString('base64url');
    const r = await authCall('/v1/auth/register', { email, username, displayName: `${person.first} ${person.last}`, password });
    if (r.status === 201) {
      creds[host][person.key] = { email, username, password, created: new Date().toISOString() };
      return keep(r.data);
    }
    if (r.status !== 409) must(r, `register ${person.key}`);
  }
  throw new Error(`no free username for ${person.key}`);
}

// ---- a package zip (stored, no compression): manifest.json only ----
function zipOne(name, data) {
  const nameBuf = Buffer.from(name), crc = zlib.crc32(data) >>> 0, n = data.length;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(n, 18); local.writeUInt32LE(n, 22); local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0x21, 12); // a fixed DOS date (1980-01-01) keeps the zip stable
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(n, 20); central.writeUInt32LE(n, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBuf.length, 12); end.writeUInt32LE(30 + nameBuf.length + n, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
}

// ---- bots: a pool of finished, in-bounds runs per game, with their logs ----
function runPool(manifest, want) {
  const text = gameTextOf(manifest);
  const sm = manifest.score ?? {};
  const finishedOnly = sm.counts_when === 'finished';
  const rate = sm.bounds?.max_rate_per_s;
  const seed = Number(manifest.seed) || 1;
  const byScore = new Map();
  for (let i = 0; i < Math.max(24, want * 4) && byScore.size < want * 3; i++) {
    const r = playRun(text, { seed, skill: [0.15, 0.35, 0.55, 0.75, 0.9, 0.97][i % 6], botSeed: 1000 + i * 13 });
    if (!r || (r.phase !== 'won' && r.phase !== 'lost') || (finishedOnly && r.phase !== 'won')) continue;
    if (sm.bounds && (r.score < (sm.bounds.min ?? 0) || (sm.bounds.max != null && r.score > sm.bounds.max))) continue;
    if (rate && r.seconds > 0 && r.score / r.seconds > rate) continue;
    if (r.score <= 0) continue;
    if (!byScore.has(r.score)) byScore.set(r.score, r);
  }
  const lower = sm.direction === 'lower';
  return [...byScore.values()].sort((a, b) => (lower ? a.score - b.score : b.score - a.score));
}

/** Picks one run per person, best first, spread over the pool, keeping the last two places (Maya, Alex) close. */
function assign(pool, order) {
  if (pool.length < order.length) return null;
  const picks = [];
  const step = (pool.length - 1) / Math.max(1, order.length - 1);
  let last = -1;
  for (let i = 0; i < order.length; i++) {
    let j = Math.max(last + 1, Math.round(i * step));
    j = Math.min(j, pool.length - (order.length - i));
    picks.push(pool[j]);
    last = j;
  }
  return picks;
}

// ---- main ----
const people = Object.fromEntries(cast.map((p) => [p.key, p]));
const tokens = {};
const tok = async (key) => (tokens[key] ??= await signIn(people[key]));
let serverHasDaily = false;

console.log(`demo-seed → ${API}${DRY ? ' (dry run)' : ''}, Daily date ${DATE}`);

if (!DRY) {
  // accounts
  for (const p of cast) tokens[p.key] = await signIn(p);
  console.log(`accounts: ${cast.length} (${cast.map((p) => p.first).join(', ')})`);

  // friendships
  const pairs = [...cast.filter((p) => p.friendOfAlex).map((p) => ['me-alex', p.key]), ...extraFriends];
  for (const [a, b] of pairs) must(await call('PUT', `/v1/me/friends/${state.accounts[b].id}`, { token: await tok(a) }), `friend ${a} ${b}`);
  console.log(`friendships: ${pairs.length}`);

  // An API without the Daily routes also ignores a Group's stable id: then make no Group (it would get a random
  // id), and seed only what it supports (accounts, friendships, games, scores). Run again after the deploy.
  const probe = await call('GET', `/v1/groups/${GROUP_ID}/daily`);
  serverHasDaily = probe.status === 200 || (probe.status === 404 && typeof probe.data?.error === 'string');
  if (!serverHasDaily) console.log('this API has no Group Daily routes yet: skipping the Group, the Event and the Daily');
}
if (!DRY && serverHasDaily) {
  // the Group and the Event, with the demo world's ids
  const g = world.group, e = world.event;
  const ensureGroup = async (body) => {
    const r = await call('POST', '/v1/groups', { token: await tok(HOST), json: body });
    if (r.status === 201 && r.data.id !== body.id) throw new Error(`the API gave ${body.id} the id ${r.data.id}`);
    if (r.status !== 201 && r.status !== 409) must(r, `create ${body.id}`);
  };
  await ensureGroup({ id: GROUP_ID, kind: 'group', name: g.name, category: g.category, about: g.about, coverSeed: g.cover_seed });
  const when = 'Saturday, 1 to 4 PM';
  await ensureGroup({ id: EVENT_ID, kind: 'event', name: e.title, category: e.category,
    about: `${when} · ${e.location_name}, ${e.address}. ${e.details}`.slice(0, 500), coverSeed: e.cover_seed });
  for (const p of cast) {
    must(await call('PUT', `/v1/groups/${GROUP_ID}/members/me`, { token: await tok(p.key) }), `join ${p.key}`);
    if (p.picnic) must(await call('PUT', `/v1/groups/${EVENT_ID}/members/me`, { token: await tok(p.key) }), `rsvp ${p.key}`);
  }
  const detail = must(await call('GET', `/v1/groups/${GROUP_ID}`, { token: await tok('me-alex') }), 'group');
  const evDetail = must(await call('GET', `/v1/groups/${EVENT_ID}`, { token: await tok('me-alex') }), 'event');
  console.log(`Group ${GROUP_ID}: ${detail.members.length} members (owner ${detail.group.ownerId}); Event ${EVENT_ID}: ${evDetail.members.length} going`);
}

// games: upload a scoped copy once, then post the cast's verified runs
for (const spec of games) {
  const src = await (await fetch(`${SOURCE_GAMES}/${spec.source}/manifest.json`)).json();
  const m = structuredClone(src);
  m.id = spec.daily ? `${src.id}-newinsf-${DATE}` : `${src.id}-newinsf`;
  const scopeId = spec.scope === 'group' ? GROUP_ID : EVENT_ID;
  m.structure = { ...(src.structure ?? {}), scope: `${spec.scope}:${scopeId}`, ...(spec.scope === 'group' ? { group_id: scopeId } : { event_id: scopeId }) };
  if (spec.daily) m.structure.cadence = 'daily';
  const pool = runPool(m, spec.order.length);
  m.bots = pool.slice(0, 20).map((r, i) => ({ skill: [0.35, 0.7, 0.95][i % 3], score: r.score, sec: Math.round(r.seconds * 10) / 10 }));
  const picks = assign(pool, spec.order);
  console.log(`${spec.key}: "${src.title}" pool ${pool.length} runs ${pool.slice(0, 12).map((r) => r.score).join(' ')}${pool.length > 12 ? ' …' : ''}`);
  if (!picks) { console.log(`  not enough distinct finished runs for ${spec.order.length} people; skipped scores`); }
  if (DRY) { if (picks) console.log('  ' + spec.order.map((k, i) => `${people[k].first} ${picks[i].score}`).join(', ')); continue; }

  let gameId = state.games[spec.key]?.id;
  if (gameId) {
    const r = await call('GET', `/v1/games/${gameId}`);
    if (r.status !== 200) gameId = undefined;
  }
  if (!gameId) {
    const r = await call('POST', '/v1/creations', { token: await tok(spec.by), zip: zipOne('manifest.json', Buffer.from(JSON.stringify(m))) });
    if (r.status === 422 && /slug|already/i.test(JSON.stringify(r.data))) {
      const found = await call('GET', `/v1/games/${m.id}`);
      gameId = must(found, `find ${m.id}`).id;
    } else {
      gameId = must(r, `upload ${spec.key}`).id;
    }
    if (r.data?.unlisted) must(await call('POST', `/v1/creations/${gameId}/publish`, { token: await tok(spec.by) }), `publish ${spec.key}`);
  }
  state.games[spec.key] = { id: gameId, title: src.title, source: spec.source, scope: `${spec.scope}:${scopeId}`, by: spec.by };
  saveState();

  if (picks && !flag('--no-scores')) {
    state.scores[spec.key] ??= {};
    for (let i = 0; i < spec.order.length; i++) {
      const who = spec.order[i], run = picks[i];
      if (state.scores[spec.key][who] === run.score) continue;
      const r = await call('POST', `/v1/games/${gameId}/scores`, { token: await tok(who), json: m.score ? { log: run.log } : { score: run.score } });
      const d = must(r, `score ${spec.key} ${who}`);
      state.scores[spec.key][who] = d.score ?? run.score;
      saveState();
    }
    const board = must(await call('GET', `/v1/games/${gameId}/leaderboard`, { token: await tok('me-alex') }), 'board');
    const name = Object.fromEntries(Object.entries(state.accounts).map(([k, a]) => [a.id, people[k]?.first ?? k]));
    console.log(`  board: ${(board.items ?? []).map((x) => `${name[x.userId] ?? x.username} ${x.display ?? x.score}`).join(', ')}`);
  }
}

// today's Daily: set by the host, so everyone else (Alex included) gets "Today's Daily in New in SF is ready"
if (!DRY && !serverHasDaily) console.log(`state: ${stateFile}`);
if (!DRY && serverHasDaily) {
  const daily = state.games[DAILY_KEY];
  if (!daily) throw new Error(`no game ${DAILY_KEY} to make the Daily`);
  const r = must(await call('POST', `/v1/groups/${GROUP_ID}/daily`, { token: await tok(HOST), json: { gameId: daily.id, date: DATE } }), 'set the Daily');
  state.daily = { date: r.date, gameId: r.gameId, title: daily.title };
  saveState();
  const inbox = must(await call('GET', '/v1/me/notifications?limit=5', { token: await tok('me-alex') }), 'inbox');
  const hit = (inbox.items ?? []).find((n) => n.kind === 'daily_ready');
  console.log(`Daily ${r.date}: ${daily.title} (${r.gameId}), ${r.recipients} notified; Alex's inbox: ${hit ? `"${hit.title}"` : 'no daily_ready yet'}`);
  console.log(`state: ${stateFile}`);
}
