#!/usr/bin/env node
// Tests for the chess_board fragment (a playable chess board with legal-move generation in the rules).
//
//   node authoring/tools/test-chess.mjs        (engine checks need MG_ENGINE_DIR)
//
// 1. The fragment expands with no errors on the tall and the classic canvas, alone and in One Move.
// 2. With the engine, against fixtures/chess-positions.json (88 positions with their legal moves from a
//    reference move generator, castling and en passant cleared): the same legal moves, check, mate,
//    stalemate and move names, for every position.
// 3. Input: tap a piece (dots and rings), switch to another piece, deselect on an empty square, tap-tap
//    move, drag and drop, a drop on an illegal square slides back (chess_snap), chess_undo takes a move
//    back, chess_locked ignores the player, a move from the game is applied only when legal, and a run
//    verifies from its input log.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, loadLibrary } from '../expander/expand.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = loadLibrary(root);
let failed = 0, passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log(`FAIL ${msg}`); } };

const SQ = (name) => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);
const X0 = 4, Y0 = 260, S = 44;
const centre = (sq) => [X0 + (sq % 8) * S + S / 2, Y0 + Math.floor(sq / 8) * S + S / 2];

/** A small game around the board: names of every legal move, and an undo after any move that isn't mate. */
function testManifest(fen, extra = {}) {
  return {
    authoring: 'microgame-authoring/0.1',
    meta: { title: 'Board test', instructions: 'Move.', duration_s: 60 },
    uses: [{ fragment: 'chess_board', params: { fen, ...extra } }],
    state: {
      names: { type: 'list<string>', init: '[]' },
      undo_after: { type: 'bool', init: 'false' },
      snaps: { type: 'int', init: '0' },
      moved: { type: 'list<string>', init: '[]' },
    },
    inputs: {},
    rules: [
      { id: 'names', on: 'chess_load', do: [{ set: 'names', to: "map(chess_moves, m => chess_move_name(chess_board, m / 64, m % 64))" }] },
      { id: 'log', on: 'chess_moved', do: [{ set: 'moved', to: 'push(moved, event.name)' }, { if: 'undo_after and not event.mate', then: [{ after: '300ms', emit: 'chess_undo', id: 'undo' }] }] },
      { id: 'snap', on: 'chess_snap', do: [{ incr: 'snaps' }] },
    ],
    objectives: { time_limit: '60s', on_timeout: 'win' },
    look: { id: 'paper', canvas: 'tall' },
  };
}

// ---------- 1. expansion ----------
for (const canvas of ['tall', 'legacy']) {
  const m = testManifest('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1');
  const r = expand({ ...m, look: { ...m.look, canvas } }, lib);
  const errors = r.diagnostics.filter((d) => d.severity === 'error');
  ok(errors.length === 0, `chess_board (${canvas}) expands: ${errors.map((e) => `${e.code} ${e.message}`).join('; ')}`);
}
{
  const one = JSON.parse(readFileSync(join(root, 'games', 'gold_one_move.authoring.json'), 'utf8'));
  const r = expand(one, lib);
  const errors = r.diagnostics.filter((d) => d.severity === 'error');
  ok(errors.length === 0, `One Move expands: ${errors.map((e) => `${e.code} ${e.message}`).join('; ')}`);
  ok(Boolean(r.playtestGame?.state?.__tap_pairs), 'One Move playtest copy has __tap_pairs');
}

// ---------- 2 and 3. the engine ----------
let engine = null;
try {
  ({ engine } = await (await import('../expander/engine.mjs')).loadEngine());
} catch (e) {
  console.log(`skip engine checks: ${String(e.message).split('.')[0]}`);
}

function load(fen, extra = {}, setup = null) {
  const m = testManifest(fen, extra);
  if (setup) setup(m);
  const r = expand(m, lib);
  const json = JSON.stringify(r.game);
  const errs = engine.validate(json).filter((d) => d.severity === 'error');
  if (errs.length) throw new Error(`${fen}: ${errs.map((e) => `${e.code} ${e.at} ${e.message}`).join('; ')}`);
  const g = engine.load(json, 1);
  g.step(16);
  return { g, json };
}

if (engine) {
  const positions = JSON.parse(readFileSync(join(root, 'tools', 'fixtures', 'chess-positions.json'), 'utf8'));
  let moveCount = 0, nameCount = 0;
  const t0 = Date.now();
  for (const p of positions) {
    const { g } = load(p.fen);
    const st = g.state();
    const got = [...st.chess_moves].sort((a, b) => a - b);
    const same = got.length === p.moves.length && got.every((v, i) => v === p.moves[i]);
    ok(same, `${p.tag}: legal moves ${got.length} vs ${p.moves.length} (missing ${p.moves.filter((m) => !got.includes(m)).slice(0, 5)}, extra ${got.filter((m) => !p.moves.includes(m)).slice(0, 5)})`);
    ok(st.chess_turn === p.turn, `${p.tag}: turn ${st.chess_turn}`);
    ok((st.chess_check >= 0) === p.check, `${p.tag}: check ${st.chess_check}`);
    ok(st.chess_mate === p.mate && st.chess_stalemate === p.stalemate, `${p.tag}: mate ${st.chess_mate} stalemate ${st.chess_stalemate}`);
    moveCount += got.length;
    // Names: the reference's SAN, except where it disambiguates by rank (not supported) or names an
    // under-promotion (the board always queens).
    st.chess_moves.forEach((mv, i) => {
      const want = p.names[String(mv)];
      if (!want || /^[NBRQK][1-8]x?[a-h]/.test(want) || /^[NBRQK][a-h][1-8]/.test(want)) return;
      nameCount++;
      ok(st.names[i] === want, `${p.tag}: move ${mv} named ${st.names[i]}, want ${want}`);
    });
    g.dispose();
  }
  console.log(`  ${positions.length} positions, ${moveCount} legal moves, ${nameCount} names checked in ${Date.now() - t0} ms`);

  // ---------- 3. input ----------
  const tap = (g, sq) => { const [x, y] = centre(sq); g.frame(); g.pointer('down', x, y); g.pointer('up', x, y); g.step(16); };
  const drag = (g, from, to) => {
    const [x0, y0] = centre(from), [x1, y1] = centre(to);
    g.frame(); g.pointer('down', x0, y0); g.step(16);
    for (let k = 1; k <= 4; k++) { g.pointer('move', x0 + ((x1 - x0) * k) / 4, y0 + ((y1 - y0) * k) / 4); g.step(16); }
    const mid = g.state();
    g.pointer('up', x1, y1); g.step(16);
    return mid;
  };
  {
    const { g, json } = load('6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1');
    tap(g, SQ('e1'));
    let st = g.state();
    ok(st.chess_sel === SQ('e1'), `tap selects the rook (${st.chess_sel})`);
    ok(st.chess_targets.includes(SQ('e8')) && st.chess_targets.includes(SQ('a1')) && !st.chess_targets.includes(SQ('g1')), `rook targets ${st.chess_targets}`);
    const fj = g.frameJSON(); const ops = (typeof fj === 'string' ? JSON.parse(fj) : fj).ops;
    ok(ops.filter((o) => o.op === 'circle').length === st.chess_targets.length, 'a dot for every target');
    tap(g, SQ('g2'));
    st = g.state();
    ok(st.chess_sel === SQ('g2') && st.chess_targets.length === 2, `tapping another own piece switches (${st.chess_sel}, ${st.chess_targets})`);
    tap(g, SQ('c4'));
    st = g.state();
    ok(st.chess_sel === -1 && st.chess_targets.length === 0, 'tapping an empty non-legal square deselects');
    tap(g, SQ('g8'));
    ok(g.state().chess_sel === -1, 'an opponent piece cannot be selected');
    tap(g, SQ('e1')); tap(g, SQ('e1'));
    ok(g.state().chess_sel === -1, 'tapping the selected piece again deselects');
    tap(g, SQ('e1')); tap(g, SQ('e8'));
    st = g.state();
    ok(st.chess_board[SQ('e8')] === 'R' && st.chess_board[SQ('e1')] === '' && st.chess_mate && st.chess_turn === 'b', 'tap-tap Re8 mates');
    ok(st.moved.at(-1) === 'Re8#', `the move is named Re8# (${st.moved.at(-1)})`);
    ok(st.chess_check === SQ('g8') && st.chess_last_from === SQ('e1') && st.chess_last_to === SQ('e8'), 'check square and last move');
    // The rook slides: a frame right after the move draws it between e1 and e8.
    const v = engine.verify(json, g.log());
    ok(v.ok, `the run verifies from its input log (${JSON.stringify(v.problems ?? [])})`);
    g.dispose();
  }
  {
    const { g } = load('6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', {}, (m) => { m.state.undo_after.init = 'true'; });
    const mid = drag(g, SQ('e1'), SQ('e7'));
    ok(mid.chess_dragging && mid.chess_sel === SQ('e1'), 'a drag lifts the piece');
    let st = g.state();
    ok(st.chess_board[SQ('e7')] === 'R' && !st.chess_dragging && st.moved.at(-1) === 'Re7', `drag and drop moves (${st.moved})`);
    for (let i = 0; i < 30; i++) g.step(16);
    st = g.state();
    ok(st.chess_board[SQ('e1')] === 'R' && st.chess_board[SQ('e7')] === '' && st.chess_turn === 'w' && st.chess_last_to === -1, 'chess_undo takes the move back');
    drag(g, SQ('e1'), SQ('f2'));
    st = g.state();
    ok(st.chess_board[SQ('e1')] === 'R' && st.snaps === 1 && !st.chess_dragging, 'a drop on an illegal square slides back');
    // A pawn can't be dragged through a piece, and a drop back on its own square keeps it selected.
    drag(g, SQ('h2'), SQ('h2'));
    ok(g.state().chess_sel === SQ('h2'), 'a drop on its own square keeps the selection');
    g.dispose();
  }
  {
    const { g } = load('6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', {}, (m) => {
      m.state.lock = { type: 'bool', init: 'false' };
      m.rules.push({ id: 'lock', on: 'start', do: [{ set: 'chess_locked', to: 'true' }] });
    });
    tap(g, SQ('e1')); tap(g, SQ('e8'));
    ok(g.state().chess_board[SQ('e1')] === 'R' && g.state().chess_sel === -1, 'chess_locked ignores the player');
    g.dispose();
  }
  {
    // A move the game emits: applied only when legal.
    const { g } = load('6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', {}, (m) => {
      m.rules.push({ id: 'script', on: 'start', do: [{ after: '50ms', emit: 'chess_move', with: { from: "chess_sq('e1')", to: "chess_sq('e9')" }, id: 'bad' }, { after: '100ms', emit: 'chess_move', with: { from: "chess_sq('g2')", to: "chess_sq('g5')" }, id: 'bad2' }, { after: '150ms', emit: 'chess_move', with: { from: "chess_sq('g2')", to: "chess_sq('g4')" }, id: 'good' }] });
    });
    for (let i = 0; i < 15; i++) g.step(16);
    const st = g.state();
    ok(st.moved.length === 1 && st.moved[0] === 'g4' && st.chess_turn === 'b', `only the legal scripted move is applied (${st.moved})`);
    g.dispose();
  }
  {
    // Black to move turns the board; promotion queens.
    const { g } = load('8/8/8/8/8/2k5/p7/2K5 b - - 0 1');
    let st = g.state();
    ok(st.chess_flip, 'black to move turns the board');
    const a2 = SQ('a2'), a1 = SQ('a1');
    const c = (sq) => [X0 + (7 - (sq % 8)) * S + S / 2, Y0 + (7 - Math.floor(sq / 8)) * S + S / 2];
    const tapf = (sq) => { const [x, y] = c(sq); g.frame(); g.pointer('down', x, y); g.pointer('up', x, y); g.step(16); };
    tapf(a2); tapf(a1);
    st = g.state();
    ok(st.chess_board[a1] === 'q' && st.moved.at(-1).startsWith('a1=Q'), `a pawn on the last rank queens (${st.moved})`);
    g.dispose();
  }
  {
    // side: 'white' ignores taps on black's turn.
    const { g } = load('8/8/8/8/8/2k5/p7/2K5 b - - 0 1', { side: 'white', orient: 'white' });
    tap(g, SQ('a2'));
    ok(g.state().chess_sel === -1, "side 'white' can't move black");
    g.dispose();
  }

  // ---------- 4. bots (tap_pairs) on One Move ----------
  {
    const { playtestAsync } = await import('../playtest/gate-async.mjs');
    const one = JSON.parse(readFileSync(join(root, 'games', 'gold_one_move.authoring.json'), 'utf8'));
    const r = expand(one, lib);
    const t1 = Date.now();
    const gate = await playtestAsync(engine, JSON.stringify(r.playtestGame), { profile: 'puzzle', sliceMs: 1e9 });
    const byLabel = Object.fromEntries(gate.runs.map((x) => [x.bot.label, x]));
    ok(gate.passed, `One Move passes the puzzle gate: ${gate.flags.filter((f) => f.blocking).map((f) => f.code ?? f.message).join('; ')}`);
    ok(byLabel.pro.outcome === 'success' && byLabel.pro.score >= 900, `the pro bot finds the mates (${byLabel.pro.score})`);
    ok(byLabel.pro.score > byLabel['new player'].score, `the pro outscores the new player (${byLabel.pro.score} vs ${byLabel['new player'].score})`);
    ok(gate.runs.every((x) => x.replay.actions.every((a) => a.action.kind === 'tap' || a.action.kind === 'key' || a.action.kind === 'swipe')), 'two-tap moves are logged as taps');
    // A bot's run replays: the same taps on the shipped game give the same score.
    const g = engine.load(JSON.stringify(r.game), byLabel.pro.replay.seed);
    let step = 0;
    for (const a of byLabel.pro.replay.actions) {
      while (step < a.step) { g.step(byLabel.pro.replay.dt); step++; }
      g.frame(); g.pointer('down', a.action.x, a.action.y); g.pointer('up', a.action.x, a.action.y);
    }
    for (let i = 0; i < 600 && g.phase() === 'playing'; i++) g.step(byLabel.pro.replay.dt);
    ok(Math.round(g.status().score) === byLabel.pro.score, `the pro's run replays on the shipped game (${g.status().score} vs ${byLabel.pro.score})`);
    g.dispose();
    console.log(`  gate: ${gate.summary} (${Date.now() - t1} ms)`);
  }
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
