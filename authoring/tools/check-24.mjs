#!/usr/bin/env node
// Make-24 solvability check: every hand a "make a target from four numbers" game can deal must have
// an answer. No Muse calls, no engine needed.
//
//   node authoring/tools/check-24.mjs <manifest-or-authoring.json>... [--target=24] [--json]
//   node authoring/tools/check-24.mjs --hand=3,3,8,8
//
// It reads every content list whose items look like hands ("a,b,c,d") from the authoring
// `content` (or the expanded game's `content_*` state), solves each one exactly, and, when the
// content has a parallel `solutions` list ("i,j,op;i,j,op;i,j,op": tile indices as the game's
// combine rule orders them, the result appended last), replays each stored solution to check it
// really makes the target. Exit 1 when any hand has no answer or a stored solution is wrong.
//
// The solver: every ordered pair, all four operators, every bracketing (pairwise reduction covers
// them all), exact rational arithmetic in BigInt, division by zero excluded.
//
// A game that deals with a random generator in its rules (rather than from a list) needs a seed
// sweep through the engine as well; this tool says so when a hand list isn't found.
import { readFileSync } from 'node:fs';

const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
const Q = (n, d = 1n) => { if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d) || 1n; return { n: n / g, d: d / g }; };
const OPS = {
  '+': (a, b) => Q(a.n * b.d + b.n * a.d, a.d * b.d),
  '-': (a, b) => Q(a.n * b.d - b.n * a.d, a.d * b.d),
  '*': (a, b) => Q(a.n * b.n, a.d * b.d),
  '/': (a, b) => (b.n === 0n ? null : Q(a.n * b.d, a.d * b.n)),
};
const SYM = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/** {solvable, count, integerOnly, fractionsNeeded, example} for a hand of numbers. */
export function solve24(nums, target = 24, limit = Infinity) {
  const goal = Q(BigInt(target));
  const found = new Set();
  let integerPath = false;
  let example = null;
  const rec = (items) => {
    if (found.size >= limit) return;
    if (items.length === 1) {
      const [x] = items;
      if (x.v.n === goal.n && x.v.d === goal.d) { found.add(x.e); if (!x.frac) integerPath = true; example ??= x.e; }
      return;
    }
    for (let i = 0; i < items.length; i++) for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const rest = items.filter((_, k) => k !== i && k !== j);
      for (const op of Object.keys(OPS)) {
        if ((op === '+' || op === '*') && i > j) continue;
        const v = OPS[op](items[i].v, items[j].v);
        if (!v) continue;
        rec([...rest, { v, e: `(${items[i].e} ${SYM[op]} ${items[j].e})`, frac: items[i].frac || items[j].frac || v.d !== 1n }]);
      }
    }
  };
  rec(nums.map((x) => ({ v: Q(BigInt(x)), e: String(x), frac: false })));
  return { solvable: found.size > 0, count: found.size, integerOnly: integerPath, fractionsNeeded: found.size > 0 && !integerPath, example: example?.slice(1, -1) ?? null };
}

/** Replays a stored "i,j,op;..." solution on a hand the way the game combines tiles. */
export function replaySolution(hand, steps, target = 24) {
  let tiles = hand.map((x) => Q(BigInt(x)));
  for (const s of String(steps).split(';').filter(Boolean)) {
    const [i, j, op] = s.split(',');
    const a = tiles[+i], b = tiles[+j];
    if (!a || !b || +i === +j || !OPS[op]) return false;
    const v = OPS[op](a, b);
    if (!v) return false;
    tiles = tiles.filter((_, k) => k !== +i && k !== +j).concat([v]);
  }
  return tiles.length === 1 && tiles[0].d === 1n && tiles[0].n === BigInt(target);
}

const HAND = /^\s*\d+(\s*,\s*\d+){3}\s*$/;
const parseList = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { return JSON.parse(v.replace(/'/g, '"')); } catch { return null; } }
  return null;
};

/** Every hand list in a manifest, authoring manifest or game: [{key, hands, solutions}]. */
export function handLists(doc) {
  const out = [];
  const authoring = doc?.content?.authoring_json ? JSON.parse(doc.content.authoring_json) : doc?.content && !doc.content.game_json ? doc : null;
  const game = doc?.content?.game_json ? JSON.parse(doc.content.game_json) : doc?.state ? doc : null;
  const content = authoring?.content ?? (game ? Object.fromEntries(Object.entries(game.state ?? {}).filter(([k]) => k.startsWith('content_')).map(([k, s]) => [k.slice(8), parseList(s.init)])) : {});
  for (const [key, list] of Object.entries(content ?? {})) {
    if (!Array.isArray(list) || !list.length || !list.every((x) => typeof x === 'string' && HAND.test(x))) continue;
    const sols = Array.isArray(content.solutions) && content.solutions.length === list.length ? content.solutions : null;
    out.push({ key, hands: list.map((h) => h.split(',').map((x) => Number(x.trim()))), solutions: sols });
  }
  return out;
}

/** {ok, lists: [{key, total, unsolvable: [...], badSolutions: [...], fractionsNeeded}]} */
export function check24(doc, { target = 24 } = {}) {
  const lists = handLists(doc).map(({ key, hands, solutions }) => {
    const res = hands.map((h, i) => ({ hand: h.join(','), ...solve24(h, target), storedOk: solutions ? replaySolution(h, solutions[i], target) : null }));
    return {
      key, total: hands.length,
      unsolvable: res.filter((r) => !r.solvable).map((r) => r.hand),
      badSolutions: res.filter((r) => r.storedOk === false).map((r) => r.hand),
      fractionsNeeded: res.filter((r) => r.fractionsNeeded).map((r) => r.hand),
      hands: res,
    };
  });
  return { ok: lists.length > 0 && lists.every((l) => !l.unsolvable.length && !l.badSolutions.length), found: lists.length > 0, lists };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
  const target = Number(opt('target') ?? 24);
  if (opt('hand')) { console.log(JSON.stringify(solve24(opt('hand').split(',').map(Number), target))); process.exit(0); }
  let failed = 0;
  for (const file of args.filter((a) => !a.startsWith('--'))) {
    const r = check24(JSON.parse(readFileSync(file, 'utf8')), { target });
    if (args.includes('--json')) { console.log(JSON.stringify({ file, ...r })); if (!r.ok) failed++; continue; }
    if (!r.found) { console.log(`${file}: no hand list found (a game that deals from a generator needs an engine seed sweep)`); failed++; continue; }
    for (const l of r.lists) {
      console.log(`${file} content.${l.key}: ${l.total} hands, ${l.unsolvable.length} unsolvable, ${l.fractionsNeeded.length} need fractions${l.badSolutions.length ? `, ${l.badSolutions.length} wrong stored solutions` : ''}`);
      if (l.unsolvable.length) console.log(`  unsolvable: ${l.unsolvable.join(' | ')}`);
      if (l.badSolutions.length) console.log(`  wrong stored solution: ${l.badSolutions.join(' | ')}`);
    }
    if (!r.ok) failed++;
  }
  process.exit(failed ? 1 : 0);
}
