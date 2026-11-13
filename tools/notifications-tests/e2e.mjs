#!/usr/bin/env node
// End-to-end check of game notifications against a running API (backend/README.md, "Notifications").
// It creates accounts, a Group and games, so point it ONLY at a local or test server, never Prod:
//
//   API=http://127.0.0.1:8099 node tools/notifications-tests/e2e.mjs
//
// Run the API with the viral trigger turned down so it can fire in a test:
//   VIRAL_MIN_PLAYERS=2 VIRAL_MIN_PAGES=1 VIRAL_COSINE=0 VIRAL_INTERVAL=5s
// Checks: group_game (and retry dedupe), friend_challenge (challenge and series), leaderboard_lost (only
// the displaced #1), viral_match, inbox paging and read state, account isolation, push devices and
// logout with installationId.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

const API = process.env.API;
if (!API || /ol4ol\.com/.test(API)) {
  console.error('Set API to a local or test server (this creates accounts and games). Never Prod.');
  process.exit(2);
}
let passed = 0, failed = 0;
const ok = (cond, name, detail) => {
  if (cond) passed++;
  else { failed++; console.log('  FAIL ' + name + (detail ? ': ' + detail : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = Math.random().toString(36).slice(2, 8);

async function call(method, path, { token, body, type = 'application/json', raw } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = type;
  const res = await fetch(API + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

async function user(name) {
  const r = await call('POST', '/v1/auth/register', { body: { email: `${name}-${run}@test.invalid`, username: `${name}${run}`, displayName: name, password: 'test-password-1234' } });
  if (r.status >= 300) throw new Error(`register ${name}: ${r.status} ${JSON.stringify(r.json)}`);
  return { name, id: r.json.user.id, token: r.json.accessToken, refresh: r.json.refreshToken };
}

// ---- a minimal stored zip (no npm packages) ----
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), packed = deflateRawSync(data), nameBuf = Buffer.from(name), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const fixture = JSON.parse(readFileSync(new URL('../game-fixtures/bubble-seed-mg-ferry-call.json', import.meta.url), 'utf8'));
async function game(owner, title, description) {
  const m = { ...fixture, id: `notif-${run}-${title.toLowerCase().replace(/\W+/g, '-')}`, title, one_line_rule: description };
  const r = await call('POST', '/v1/creations', { token: owner.token, type: 'application/zip', raw: zip({ 'manifest.json': JSON.stringify(m) }), body: null });
  if (r.status >= 300) throw new Error(`upload ${title}: ${r.status} ${JSON.stringify(r.json)}`);
  const g = r.json.game ?? r.json;
  if (g.unlisted) await call('POST', `/v1/creations/${g.id}/publish`, { token: owner.token });
  return g.id;
}

const inbox = async (u, q = '') => (await call('GET', '/v1/me/notifications' + q, { token: u.token })).json;
const kinds = async (u) => (await inbox(u, '?limit=50')).items.map((n) => n.kind);
const count = (list, kind) => list.filter((k) => k === kind).length;
const score = (u, gameId, value) => call('POST', `/v1/games/${gameId}/scores`, { token: u.token, body: { score: value } });

console.log(`Notifications end to end against ${API} (run ${run})`);
const [ana, ben, cal, dee] = [await user('Ana'), await user('Ben'), await user('Cal'), await user('Dee')];
for (const u of [ben, cal]) await call('PUT', `/v1/me/friends/${u.id}`, { token: ana.token });

// ---- group_game, with retry dedupe ----
const group = (await call('POST', '/v1/groups', { token: ana.token, body: { name: `Notif test ${run}`, kind: 'group' } })).json;
for (const u of [ben, cal]) await call('PUT', `/v1/groups/${group.id}/members/me`, { token: u.token });
const g1 = await game(ana, 'Ferry Words', 'Type the word on the ferry sign before it sails.');
const share = () => call('POST', `/v1/groups/${group.id}/game-shares`, { token: ana.token, body: { gameId: g1, eventId: `post-${run}-1` } });
const s1 = await share(), s2 = await share();
ok(s1.status < 300 && s2.status < 300, 'a Group share and its retry are accepted', `${s1.status} ${s2.status}`);
{
  const b = await kinds(ben), c = await kinds(cal);
  ok(count(b, 'group_game') === 1 && count(c, 'group_game') === 1, 'each other member gets one group_game (the retry adds none)', `ben [${b}] cal [${c}] share ${JSON.stringify(s1.json)}`);
}
ok(count(await kinds(ana), 'group_game') === 0, 'the sharer gets no group_game');
ok(count(await kinds(dee), 'group_game') === 0, 'a non-member gets no group_game');
const notMember = await call('POST', `/v1/groups/${group.id}/game-shares`, { token: dee.token, body: { gameId: g1, eventId: `post-${run}-2` } });
ok(notMember.status >= 400, 'a non-member cannot share into the Group', String(notMember.status));

// ---- friend_challenge: a challenge and a series ----
await score(ana, g1, 40);
const ch = await call('POST', '/v1/challenges', { token: ana.token, body: { gameId: g1, toUserIds: [ben.id] } });
ok(ch.status < 300, 'a challenge is sent', `${ch.status} ${JSON.stringify(ch.json)}`);
const series = await call('POST', '/v1/series', { token: ana.token, body: { opponentId: cal.id, games: [g1] } });
ok(series.status < 300, 'a series is started', `${series.status} ${JSON.stringify(series.json)}`);
const benK = await kinds(ben), calK = await kinds(cal);
ok(count(benK, 'friend_challenge') === 1, 'the challenged friend gets friend_challenge', benK.join(','));
ok(count(calK, 'friend_challenge') === 1, 'the series opponent gets friend_challenge', calK.join(','));
const calSeries = (await inbox(cal, '?limit=50')).items.find((n) => n.kind === 'friend_challenge');
ok(calSeries && calSeries.seriesId, 'the series notification carries seriesId (for tap routing)', JSON.stringify(calSeries));
const benCh = (await inbox(ben, '?limit=50')).items.find((n) => n.kind === 'friend_challenge');
ok(benCh && benCh.challengeId && benCh.gameId, 'the challenge notification carries challengeId and gameId', JSON.stringify(benCh));

// ---- leaderboard_lost: only the displaced #1 ----
const g2 = await game(dee, 'Lighthouse Letters', 'Spell the word the lighthouse flashes.');
await score(ben, g2, 100);
await score(cal, g2, 200);
ok(count(await kinds(ben), 'leaderboard_lost') === 1, 'the displaced first place gets leaderboard_lost');
await score(cal, g2, 300);
ok(count(await kinds(cal), 'leaderboard_lost') === 0, 'improving your own first place makes nothing');
await score(ana, g2, 50);
ok(count(await kinds(cal), 'leaderboard_lost') === 0 && count(await kinds(ben), 'leaderboard_lost') === 1, 'a score below first makes nothing');

// ---- viral_match: a game many play, matching your taste, that you haven't played ----
const g3 = await game(dee, 'Harbor Spelling Sprint', 'Type the harbor words before the ferry sails.');
await score(ana, g3, 10);
await score(ben, g3, 20);
const ev = (gameID, i) => ({ eventID: `${run}-${gameID}-${i}`, gameID, position: i, dwellSec: 25, runsFinished: 2, replays: 1, saved: true, liked: true });
await call('POST', '/v1/feed/events', { token: ana.token, body: { events: [ev(g3, 0)] } });
await call('POST', '/v1/feed/events', { token: ben.token, body: { events: [ev(g3, 0)] } });
await call('POST', '/v1/feed/events', { token: dee.token, body: { events: [ev(g1, 0), ev(g2, 1)] } });
let viral = 0;
// The server's first viral scan runs a minute after it starts, then every VIRAL_INTERVAL.
await sleep(7000);
{
  const own = (await inbox(dee, '?limit=50')).items.filter((n) => n.kind === 'viral_match' && [g2, g3].includes(n.gameId));
  ok(own.length === 0, "a game's own creator gets no viral_match for it", JSON.stringify(own.map((n) => n.title)));
}
await call('POST', '/v1/feed/events', { token: cal.token, body: { events: [ev(g1, 0), ev(g2, 1)] } });
const calViral = async () => (await inbox(cal, '?limit=50')).items.filter((n) => n.kind === 'viral_match' && n.gameId === g3);
for (let i = 0; i < 40 && !viral; i++) { await sleep(2500); viral = (await calViral()).length; }
ok(viral === 1, "a player with learned taste who hasn't played it gets a viral_match for the busy game", `${viral} (${(await kinds(cal)).join(',')})`);
await sleep(6000);
ok((await calViral()).length === 1 && count(await kinds(cal), 'viral_match') <= 1, 'viral_match is not repeated (one a day, each game once)', (await kinds(cal)).join(','));
{
  // Ana and Ben played g3 (events); Ana also scored on g2 without a feed event.
  const a = await inbox(ana, '?limit=50'), b = await inbox(ben, '?limit=50');
  const bad = [...a.items.filter((n) => n.kind === 'viral_match' && [g2, g3].includes(n.gameId)),
    ...b.items.filter((n) => n.kind === 'viral_match' && [g2, g3].includes(n.gameId))];
  ok(bad.length === 0, 'people who already played or scored on a game get no viral_match for it', JSON.stringify(bad.map((n) => n.title)));
}

// ---- inbox: paging, read state, isolation ----
const all = await inbox(cal, '?limit=50');
ok(all.unreadCount === all.items.length && all.items.length >= 3, 'every new notification starts unread', `${all.unreadCount}/${all.items.length}`);
const p1 = await inbox(cal, '?limit=1');
ok(p1.items.length === 1 && p1.nextCursor, 'limit=1 returns one item and a cursor');
const p2 = await inbox(cal, `?limit=1&cursor=${encodeURIComponent(p1.nextCursor)}`);
ok(p2.items.length === 1 && p2.items[0].id !== p1.items[0].id, 'the cursor returns the next item, newest first');
const r1 = await call('PUT', `/v1/me/notifications/${p1.items[0].id}/read`, { token: cal.token, body: { read: true } });
ok(r1.json?.unreadCount === all.items.length - 1, 'reading one lowers unreadCount by one', JSON.stringify(r1.json));
const r0 = await call('PUT', `/v1/me/notifications/${p1.items[0].id}/read`, { token: cal.token, body: { read: false } });
ok(r0.json?.unreadCount === all.items.length, 'marking it unread raises it back', JSON.stringify(r0.json));
const other = await call('PUT', `/v1/me/notifications/${p1.items[0].id}/read`, { token: ben.token, body: { read: true } });
ok(other.status >= 400 || other.json?.unreadCount === (await inbox(ben)).unreadCount, "someone else can't read Cal's notification", String(other.status));
const ra = await call('PUT', '/v1/me/notifications/read', { token: cal.token });
ok(ra.json?.unreadCount === 0 && (await inbox(cal)).unreadCount === 0, 'read all clears the count');
ok(!(await inbox(ben, '?limit=50')).items.some((n) => all.items.some((c) => c.id === n.id)), "accounts never see each other's notifications");

// ---- push devices and logout with installationId ----
const inst = `inst-${run}-device`;
const token = 'ab'.repeat(32);
const d1 = await call('PUT', `/v1/me/push-devices/${inst}`, { token: ben.token, body: { token, environment: 'sandbox' } });
ok(d1.status < 300, 'a push device registers', String(d1.status));
const d2 = await call('PUT', `/v1/me/push-devices/${inst}`, { token: cal.token, body: { token, environment: 'sandbox' } });
ok(d2.status < 300, 'the same installation moves to the account that registers it last', String(d2.status));
const out = await call('POST', '/v1/auth/logout', { body: { refreshToken: cal.refresh, installationId: inst } });
ok(out.status < 300, 'logout accepts installationId', String(out.status));
const after = await call('POST', '/v1/auth/refresh', { body: { refreshToken: cal.refresh } });
ok(after.status >= 400, 'the logged-out refresh token no longer works', String(after.status));
const del = await call('DELETE', `/v1/me/push-devices/${inst}`, { token: ben.token });
ok(del.status < 500, 'removing a device that moved away is harmless', String(del.status));

console.log((failed ? 'FAILED: ' : 'ok: ') + `${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
