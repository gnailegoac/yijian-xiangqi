// Unit tests of src/core/search.js (contract section 14.1; algorithms in Appendix A3; tactical suite in Appendix A7).
// No test depends on wall-clock speed: searches are bounded by maxDepth or maxNodes, and the time-control tests run on a
// virtual clock. Expected values come from the contract, from the v1 rules engine, or from an independent computation here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getLegalMoves, applyMove } from '../../../src/core/engine.js';
import { Position, mvTo } from '../../../src/core/position.js';
import {
  MATE, WIN, scoreToCp, mateIn, createSearcher, perft, lineOf, revealDepth, revealTier, separationDepth,
} from '../../../src/core/search.js';
import { mulberry32, playoutPositions } from '../../helpers/playout.js';
import { TACTICAL_SUITE, REFERENCE_POSITIONS } from '../../helpers/positions.js';

const START = REFERENCE_POSITIONS.opening;
/** A time budget that never binds. */
const FOREVER = 3_600_000;
const code = ref => `${ref.from.row}${ref.from.col}${ref.to.row}${ref.to.col}`;
const ref = moveCode => ({
  from: { row: Number(moveCode[0]), col: Number(moveCode[1]) },
  to: { row: Number(moveCode[2]), col: Number(moveCode[3]) },
});
const other = color => (color === 'red' ? 'black' : 'red');

/** A 10x9 engine board from a FEN, written without position.js. */
function boardOfFen(fen) {
  const types = { k: 'king', a: 'advisor', b: 'elephant', n: 'horse', r: 'rook', c: 'cannon', p: 'pawn' };
  const [placement, side] = fen.split(' ');
  const board = placement.split('/').map((line, row) => {
    const cells = [];
    for (const ch of line) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) cells.push(null);
      } else {
        const color = ch === ch.toUpperCase() ? 'red' : 'black';
        const type = types[ch.toLowerCase()];
        cells.push({ id: `${color}-${type}-${row}-${cells.length}`, type, color });
      }
    }
    return cells;
  });
  return { board, turn: side === 'b' ? 'black' : 'red' };
}

/** Replay a line with the v1 rules engine; fails on the first move that is not legal. Returns the final board and side. */
function replayWithEngine(fen, moves, firstTurn) {
  let { board, turn } = boardOfFen(fen);
  if (firstTurn) turn = firstTurn;
  for (const move of moves) {
    const legal = getLegalMoves(board, turn).find(m => code(m) === code(move));
    assert.ok(legal, `${code(move)} is not legal at ply ${moves.indexOf(move)} of ${moves.map(code).join(' ')} from ${fen}`);
    board = applyMove(board, legal);
    turn = other(turn);
  }
  return { board, turn };
}

const fenOf = p => Position.fromBoard(p.board, p.turn).toFen();

/** `count` FENs of playout positions that have at least two legal moves. */
function sampleFens(count, options) {
  const out = [];
  for (const p of playoutPositions(count * 2, options)) {
    if (p.moves.length >= 2 && out.length < count) out.push(fenOf(p));
  }
  assert.equal(out.length, count);
  return out;
}

/** The fields of a result that must be identical between two deterministic runs. */
const essence = result => ({
  depth: result.depth,
  allDepth: result.allDepth,
  turn: result.turn,
  lines: result.lines,
});

test('tactical suite: the eleven positions of Appendix A7 give the expected first move and mate distance', () => {
  assert.equal(TACTICAL_SUITE.length, 11);
  const modes = [{}, { allDepth: 4, multiPV: 6 }, { allDepth: 6 }];
  for (const t of TACTICAL_SUITE) {
    for (const mode of modes) {
      const searcher = createSearcher();
      const result = searcher.analyzeSync({ fen: t.fen, timeMs: FOREVER, maxDepth: 6, ...mode });
      const best = result.lines[0];
      const label = `${t.name} ${JSON.stringify(mode)}`;
      if (t.move !== null) assert.equal(code(best.move), t.move, `${label}: first move`);
      assert.equal(best.mate, t.mateIn, `${label}: mate distance`);
      if (t.mateIn === null) {
        assert.equal(result.depth, 6, label);
        assert.equal(result.stopped, 'depth', label);
        assert.ok(Math.abs(best.score) < WIN, label);
      } else {
        // Mate in n moves is MATE - (2n - 1); the loop stops deepening on a mate from depth 3 on.
        assert.equal(best.score, MATE - (2 * t.mateIn - 1), label);
        assert.equal(result.stopped, 'mate', label);
        assert.equal(result.depth, 3, label);
        // The principal variation is the win itself: after it the defender has no legal move.
        assert.equal(best.pv.length, 2 * t.mateIn - 1, label);
        const end = replayWithEngine(t.fen, best.pv);
        assert.equal(getLegalMoves(end.board, end.turn).length, 0, `${label}: the PV must end with no legal move`);
      }
    }
  }
});

test('returns a legal move without mutating the board; takes a hanging rook; declines a cannon for a protected horse', () => {
  const searcher = createSearcher();
  // A legal move, and a request that is left exactly as it was.
  const request = Object.freeze({ fen: START.replace(' w', ' b'), timeMs: FOREVER, maxDepth: 3, history: Object.freeze([]) });
  const before = JSON.stringify(request);
  const opening = searcher.analyzeSync(request);
  assert.equal(JSON.stringify(request), before);
  assert.equal(opening.fen, request.fen);
  assert.equal(opening.turn, 'black');
  assert.equal(opening.depth, 3);
  const { board, turn } = boardOfFen(request.fen);
  const legal = getLegalMoves(board, turn).map(code).sort();
  assert.equal(legal.length, 44);
  assert.ok(legal.includes(code(opening.lines[0].move)));
  assert.deepEqual(opening.lines.map(l => code(l.move)).sort(), legal);
  assert.ok(opening.nodes > 0);

  // The black rook takes the undefended red rook (the v1 test position).
  const hanging = searcher.analyzeSync({ fen: '4k4/9/9/9/r2R5/4P4/9/9/9/4K4 b', timeMs: FOREVER, maxDepth: 4 });
  assert.equal(code(hanging.lines[0].move), '4043');
  assert.ok(scoreToCp(hanging.lines[0].score) >= 800, 'a rook up');

  // The black cannon does not take the protected horse (the v1 test position; the rook and the pawn behind the horse
  // both protect it). The line of the capture shows the recapture on the same square, at every depth.
  const fen = '4k4/9/9/9/c1P1N3R/4P4/9/9/9/4K4 b';
  for (const depth of [1, 2, 3, 4, 5]) {
    searcher.clear();
    const table = searcher.analyzeSync({ fen, timeMs: FOREVER, maxDepth: depth, allDepth: depth });
    assert.notEqual(code(table.lines[0].move), '4044', `depth ${depth}`);
    const trade = lineOf(table, ref('4044'));
    assert.ok(trade !== null);
    assert.ok(['4844', '5444'].includes(code(trade.pv[1])), `depth ${depth}: the cannon is taken back, got ${trade.pv.map(code).join(' ')}`);
    assert.ok(table.lines[0].score > trade.score, `depth ${depth}`);
  }
});

test("no legal move: depth 0, no lines, stopped 'no-moves'", () => {
  const searcher = createSearcher();
  // Checkmate (重炮 delivered) and stalemate (困毙: the black king has no safe step).
  for (const fen of ['3aka3/9/9/4C4/9/9/9/4C4/9/4K4 b', '3k5/8R/9/9/9/9/9/9/4R4/5K3 b']) {
    const { board, turn } = boardOfFen(fen);
    assert.equal(getLegalMoves(board, turn).length, 0, 'the fixture has no legal move');
    const result = searcher.analyzeSync({ fen, timeMs: FOREVER });
    assert.equal(result.depth, 0);
    assert.equal(result.allDepth, 0);
    assert.deepEqual(result.lines, []);
    assert.equal(result.stopped, 'no-moves');
    assert.equal(result.turn, 'black');
    assert.equal(result.fen, fen);
  }
  // A root restricted to moves that are not legal has no lines either.
  const none = searcher.analyzeSync({ fen: START, timeMs: FOREVER, rootMoves: [ref('6061')] });
  assert.equal(none.stopped, 'no-moves');
  assert.deepEqual(none.lines, []);
});

/** Structural invariants of a result (guarantees 1, 2, 4, 5 of A3.1 and the shape of 3). */
function checkTable(fen, result, { multiPV = 1, allDepth = 0, pvLength = 8 }) {
  const { board, turn } = boardOfFen(fen);
  // Every root move is exact while the iteration is within allDepth, or when there are no more than multiPV moves.
  const all = result.depth <= allDepth || result.lines.length <= multiPV;
  const label = `${fen} multiPV ${multiPV} allDepth ${allDepth}`;
  // 1. every legal root move exactly once
  assert.deepEqual(result.lines.map(l => code(l.move)).sort(), getLegalMoves(board, turn).map(code).sort(), label);
  assert.ok(result.depth >= 1 && result.allDepth <= result.depth, label);
  assert.equal(result.turn, turn, label);
  // 2. lines[0] is exact at result.depth and best; exact lines first, best first, then the rest by min(score, upper)
  const exact = result.lines.filter(l => l.depth === result.depth);
  const rest = result.lines.filter(l => l.depth !== result.depth);
  assert.ok(exact.length >= 1, label);
  assert.deepEqual(result.lines, [...exact, ...rest], `${label}: exact lines come first`);
  for (let i = 1; i < exact.length; i++) assert.ok(exact[i - 1].score >= exact[i].score, `${label}: exact lines sorted`);
  for (let i = 1; i < rest.length; i++) {
    assert.ok(Math.min(rest[i - 1].score, rest[i - 1].upper) >= Math.min(rest[i].score, rest[i].upper), `${label}: bounded lines sorted`);
  }
  // 3. shape: an exact line has no bound; a bounded line is older and its bound is not above the K-th best exact score
  for (const line of exact) assert.equal(line.upper, null, label);
  if (all) {
    assert.equal(rest.length, 0, label);
    assert.equal(result.allDepth, result.depth, label);
  } else {
    assert.equal(result.allDepth, allDepth, label);
    assert.ok(exact.length >= Math.min(multiPV, result.lines.length), label);
    for (const line of rest) {
      assert.ok(line.depth < result.depth, label);
      assert.ok(Number.isInteger(line.upper) && line.upper <= exact[multiPV - 1].score, `${label}: bound above the K-th best`);
    }
  }
  const pos = Position.fromFen(fen);
  for (const line of result.lines) {
    // 4. byDepth covers every all-exact iteration, and only exact iterations
    assert.ok(line.byDepth.length >= result.allDepth && line.byDepth.length <= line.depth, label);
    if (line.byDepth.length === line.depth && line.depth > 0) assert.equal(line.byDepth[line.depth - 1], line.score, label);
    assert.equal(line.mate, mateIn(line.score), label);
    assert.equal(line.repeats, 1, label);
    // naive is the static evaluation right after the move
    const move = pos.fromRef(line.move);
    assert.equal(pos.make(move), true, label);
    assert.equal(line.naive, 0 - pos.evaluate(), label);
    // 5. the PV starts with the move and is legal
    assert.ok(line.pv.length >= 1 && line.pv.length <= pvLength, label);
    assert.equal(code(line.pv[0]), code(line.move), label);
    let made = 1;
    for (const next of line.pv.slice(1)) {
      assert.equal(pos.isLegal(pos.fromRef(next)), true, `${label}: illegal PV ${line.pv.map(code).join(' ')}`);
      pos.make(pos.fromRef(next));
      made++;
    }
    while (made-- > 0) pos.unmake();
  }
  replayWithEngine(fen, result.lines[0].pv);
}

test('result invariants 1-6 hold on 50 positions for multiPV 1, 6 and all-exact', () => {
  const fens = [...Object.values(REFERENCE_POSITIONS), ...sampleFens(47, { seed: 101, stride: 11, plies: 150, pawnBias: 0.2 })];
  assert.equal(fens.length, 50);
  const searcher = createSearcher(), plain = createSearcher({ plain: true });
  const modes = [
    { maxDepth: 4, req: {} },                                 // best move only
    { maxDepth: 4, req: { multiPV: 6 } },                     // top 6 exact
    { maxDepth: 3, req: { allDepth: 3 } },                    // every root move exact
    { maxDepth: 4, req: { allDepth: 2, multiPV: 6 } },        // the survey's shape: all exact first, then top 6
  ];
  let bounded = 0, cut = 0;
  for (const [index, fen] of fens.entries()) {
    for (const [modeIndex, mode] of modes.entries()) {
      searcher.clear();
      const full = searcher.analyzeSync({ fen, timeMs: FOREVER, maxDepth: mode.maxDepth, ...mode.req });
      checkTable(fen, full, mode.req);
      assert.ok(full.stopped === 'depth' || full.stopped === 'mate', fen);
      if (full.stopped === 'depth') assert.equal(full.depth, mode.maxDepth);
      bounded += full.lines.filter(l => l.upper !== null).length;

      // 6. A call stopped inside an iteration returns the last completed iteration, exactly as a call that ended there
      // (one root mode per position, in turn).
      if (modeIndex !== index % modes.length) continue;
      searcher.clear();
      const stoppedEarly = searcher.analyzeSync({ fen, timeMs: FOREVER, maxDepth: mode.maxDepth, maxNodes: Math.floor(full.nodes * 0.6), ...mode.req });
      if (full.stopped === 'depth') {
        assert.equal(stoppedEarly.stopped, 'nodes', fen);
        assert.ok(stoppedEarly.depth >= 2 && stoppedEarly.depth < mode.maxDepth, fen);
      }
      if (stoppedEarly.stopped === 'nodes') {
        cut++;
        searcher.clear();
        const reference = searcher.analyzeSync({ fen, timeMs: FOREVER, maxDepth: stoppedEarly.depth, ...mode.req });
        assert.deepEqual(essence(stoppedEarly), essence(reference), `${fen}: a partly searched iteration leaked into the result`);
        checkTable(fen, stoppedEarly, mode.req);
      }
    }

    if (index >= 25) continue;
    // 4. byDepth values are the scores of the earlier iterations: an all-exact run to depth d reproduces column d.
    searcher.clear();
    const table = searcher.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 3, allDepth: 3 });
    for (let d = 1; d <= table.depth; d++) {
      searcher.clear();
      const shallow = searcher.analyzeSync({ fen, timeMs: FOREVER, maxDepth: d, allDepth: d });
      for (const line of shallow.lines) {
        assert.equal(lineOf(table, line.move).byDepth[d - 1], line.score, `${fen}: byDepth[${d - 1}] of ${code(line.move)}`);
      }
    }

    // 3. With an exact search (plain mode) the bounds can be checked against the true scores.
    plain.clear();
    const truth = plain.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 3, allDepth: 3 });
    for (const multiPV of [1, 6]) {
      plain.clear();
      const result = plain.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 3, multiPV });
      assert.equal(result.depth, truth.depth, fen);
      assert.equal(result.lines[0].score, truth.lines[0].score, `${fen}: best score, multiPV ${multiPV}`);
      const exact = result.lines.filter(l => l.depth === result.depth);
      for (const line of result.lines) {
        const real = lineOf(truth, line.move).score;
        if (line.depth === result.depth) assert.equal(line.score, real, `${fen}: exact line ${code(line.move)}`);
        else {
          assert.ok(real <= line.upper, `${fen}: true score ${real} above the bound ${line.upper} of ${code(line.move)}`);
          assert.ok(line.upper <= exact[multiPV - 1].score, fen);
        }
      }
    }
  }
  assert.ok(bounded > 500, 'the sample must contain bounded lines');
  assert.ok(cut >= 40, 'the sample must contain cut iterations');
});

test('plain mode: best-only, top-K and all-exact agree at depths 1-4', () => {
  const fens = [REFERENCE_POSITIONS.middlegameB, ...sampleFens(13, { seed: 11, stride: 13, plies: 140, pawnBias: 0.2 })];
  const plain = createSearcher({ plain: true });
  for (const fen of fens) {
    for (let depth = 1; depth <= 4; depth++) {
      plain.clear();
      const all = plain.analyzeSync({ fen, timeMs: FOREVER, maxDepth: depth, allDepth: depth });
      plain.clear();
      const topK = plain.analyzeSync({ fen, timeMs: FOREVER, maxDepth: depth, multiPV: 4 });
      plain.clear();
      const best = plain.analyzeSync({ fen, timeMs: FOREVER, maxDepth: depth });
      assert.equal(best.depth, all.depth, fen);
      assert.equal(topK.depth, all.depth, fen);
      assert.equal(best.lines[0].score, all.lines[0].score, `${fen} depth ${depth}: best-only vs all-exact`);
      assert.equal(topK.lines[0].score, all.lines[0].score, `${fen} depth ${depth}: top-K vs all-exact`);
      // The K best scores of the all-exact root are the scores of the first K lines of the top-K root.
      const k = Math.min(4, all.lines.length);
      assert.deepEqual(topK.lines.slice(0, k).map(l => l.score), all.lines.slice(0, k).map(l => l.score), `${fen} depth ${depth}`);
      for (const line of topK.lines) {
        const same = lineOf(all, line.move);
        if (line.depth === topK.depth) assert.equal(line.score, same.score, `${fen} depth ${depth}: ${code(line.move)}`);
        else assert.ok(same.score <= line.upper, `${fen} depth ${depth}: ${code(line.move)}`);
      }
    }
  }
});

/**
 * Reference for plain mode: a textbook fail-soft alpha-beta following the rules of A3.2 (repetition, ply limit, check
 * extension, mate scores, quiescence with evasions), with no table, no PVS, no aspiration; captures are tried first.
 * Returns the exact score of every root move at `rootDepth`.
 */
function referenceTable(fen, rootDepth) {
  const BAN = MATE - 100;
  const pos = Position.fromFen(fen);
  const bufs = Array.from({ length: 70 }, () => new Int32Array(128));
  const repValue = (rep, ply) => {
    let v = 0;
    if (rep & 2) v += ply - BAN;
    if (rep & 4) v += BAN - ply;
    return v !== 0 ? v : (ply & 1) === 0 ? -20 : 20;
  };
  const generate = (ply, capturesOnly) => {
    const buf = bufs[ply];
    const n = pos.generate(buf, capturesOnly);
    let front = 0;
    for (let i = 0; i < n; i++) {
      if (pos.squares[mvTo(buf[i])] === 0) continue;
      const t = buf[front];
      buf[front] = buf[i];
      buf[i] = t;
      front++;
    }
    return n;
  };
  const quiesce = (alpha, beta, ply, qply) => {
    const rep = pos.repStatus();
    if (rep) return repValue(rep, ply);
    if (ply >= 63) return pos.evaluate();
    const standPat = qply >= 8 || !pos.inCheck();
    let best = -Infinity;
    if (standPat) {
      best = pos.evaluate();
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
    }
    const buf = bufs[ply];
    const n = generate(ply, standPat);
    let legal = 0;
    for (let i = 0; i < n; i++) {
      if (!pos.make(buf[i])) continue;
      legal++;
      const s = -quiesce(-beta, -alpha, ply + 1, qply + 1);
      pos.unmake();
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    if (!standPat && legal === 0) return ply - MATE;
    return best;
  };
  const search = (depth, alpha, beta, ply) => {
    if (depth <= 0) return quiesce(alpha, beta, ply, 0);
    const rep = pos.repStatus();
    if (rep) return repValue(rep, ply);
    if (ply >= 63) return pos.evaluate();
    if (pos.inCheck() && ply < 2 * rootDepth + 4) depth += 1;
    const buf = bufs[ply];
    const n = generate(ply, false);
    let best = -Infinity, legal = 0;
    for (let i = 0; i < n; i++) {
      if (!pos.make(buf[i])) continue;
      legal++;
      const s = -search(depth - 1, -beta, -alpha, ply + 1);
      pos.unmake();
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return legal === 0 ? ply - MATE : best;
  };
  const table = new Map();
  for (const move of pos.legalMoves()) {
    pos.make(move);
    table.set(code(pos.toRef(move)), 0 - search(rootDepth - 1, -40000, 40000, 1));
    pos.unmake();
  }
  return table;
}

test('plain mode equals a textbook alpha-beta reference for every root move at depths 1-3', () => {
  const fens = [
    ...TACTICAL_SUITE.slice(7).map(t => t.fen),             // mates, a stalemate win and material wins
    ...sampleFens(10, { seed: 57, stride: 17, plies: 160, pawnBias: 0.3 }),
  ];
  const plain = createSearcher({ plain: true });
  let mates = 0;
  for (const fen of fens) {
    for (let depth = 1; depth <= 3; depth++) {
      const expected = referenceTable(fen, depth);
      plain.clear();
      const table = plain.analyzeSync({ fen, timeMs: FOREVER, maxDepth: depth, allDepth: depth });
      assert.equal(table.depth, depth, fen);
      assert.equal(table.lines.length, expected.size, fen);
      for (const line of table.lines) {
        assert.equal(line.score, expected.get(code(line.move)), `${fen} depth ${depth}: ${code(line.move)}`);
        if (line.mate !== null) mates++;
      }
    }
  }
  assert.ok(mates > 0, 'the sample must contain mate scores');
});

test("single root move equals minus the child's best-only score at depth - 1 (plain mode)", () => {
  const fens = [START, REFERENCE_POSITIONS.middlegameA, REFERENCE_POSITIONS.middlegameB,
    ...sampleFens(5, { seed: 77, stride: 19, plies: 150, pawnBias: 0.2 })];
  const plain = createSearcher({ plain: true });
  const D = 4;
  let compared = 0, checking = 0;
  for (const fen of fens) {
    const { board, turn } = boardOfFen(fen);
    const legal = getLegalMoves(board, turn);
    // A few moves of each kind: captures, checks (found on the board), and the first quiet ones.
    const pos = Position.fromFen(fen);
    const givesCheck = m => {
      pos.make(pos.fromRef(m));
      const check = pos.inCheck();
      pos.unmake();
      return check;
    };
    const picks = [...legal.filter(m => m.captured).slice(0, 2), ...legal.filter(givesCheck).slice(0, 2), ...legal.filter(m => !m.captured).slice(0, 2)];
    plain.clear();
    const glance = plain.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 1, allDepth: 1 });
    for (const move of picks) {
      const moveRef = { from: move.from, to: move.to };
      plain.clear();
      const single = plain.analyzeSync({ fen, timeMs: FOREVER, maxDepth: D, rootMoves: [moveRef] });
      assert.equal(single.lines.length, 1);
      const line = single.lines[0];
      assert.equal(code(line.move), code(move));
      assert.equal(line.depth, single.depth);
      assert.equal(single.allDepth, single.depth, 'a single move is exact at every iteration');
      assert.equal(line.byDepth.length, single.depth, 'byDepth has an entry for every iteration');
      assert.equal(line.upper, null);
      assert.equal(line.score, line.byDepth[single.depth - 1]);
      assert.equal(code(line.pv[0]), code(move));
      replayWithEngine(fen, line.pv);
      // d = 1 is the child's quiescence value: the same number the all-exact root gives the move at depth 1.
      assert.equal(line.byDepth[0], lineOf(glance, moveRef).score, `${fen} ${code(move)} depth 1`);
      // d >= 2: minus the best-only score of the child position at depth d - 1.
      const childFen = Position.fromBoard(applyMove(board, move), other(turn)).toFen();
      if (givesCheck(move)) checking++;
      for (let d = 2; d <= single.depth; d++) {
        plain.clear();
        const child = plain.analyzeSync({ fen: childFen, timeMs: FOREVER, maxDepth: d - 1 });
        if (child.depth !== d - 1) continue;                 // the child's own loop stopped on a mate
        const s = child.lines[0].score;
        // A mate (or repetition ban) is one ply further away when seen from the root.
        const expected = Math.abs(s) >= WIN ? -(s - Math.sign(s)) : -s;
        assert.equal(line.byDepth[d - 1], expected, `${fen} ${code(move)} depth ${d}`);
        compared++;
      }
    }
  }
  assert.ok(compared >= 60 && checking >= 2, `compared ${compared}, checking moves ${checking}`);

  // A single legal move behaves the same without rootMoves; a move that mates is MATE - 1 at every depth.
  const forced = plain.analyzeSync({ fen: '3k5/9/9/9/9/9/9/9/3p5/4K4 w', timeMs: FOREVER, maxDepth: 3 });
  assert.equal(forced.lines.length, 1);
  assert.equal(code(forced.lines[0].move), '9495');
  assert.equal(forced.lines[0].byDepth.length, 3);
  const mating = plain.analyzeSync({ fen: TACTICAL_SUITE[0].fen, timeMs: FOREVER, maxDepth: 6, rootMoves: [ref(TACTICAL_SUITE[0].move)] });
  assert.deepEqual(mating.lines[0].byDepth, [MATE - 1, MATE - 1, MATE - 1]);
  assert.equal(mating.lines[0].mate, 1);
  assert.equal(mating.stopped, 'mate');
  assert.deepEqual(mating.lines[0].pv.map(code), [TACTICAL_SUITE[0].move]);
});

test('maxNodes: a tiny node budget still returns depth >= minDepth with a legal best move', () => {
  const searcher = createSearcher();
  for (const fen of Object.values(REFERENCE_POSITIONS)) {
    const { board, turn } = boardOfFen(fen);
    const legal = getLegalMoves(board, turn).map(code);
    for (const [minDepth, expected] of [[undefined, 2], [1, 1], [3, 3], [4, 4]]) {
      searcher.clear();
      const result = searcher.analyzeSync({ fen, timeMs: FOREVER, maxNodes: 1, minDepth });
      assert.equal(result.depth, expected, `${fen} minDepth ${minDepth}`);
      assert.equal(result.stopped, 'nodes');
      assert.ok(legal.includes(code(result.lines[0].move)));
      assert.equal(result.lines.length, legal.length);
      assert.equal(result.lines[0].depth, result.depth);
      // The result is the same table as an unbounded call to that depth.
      searcher.clear();
      const reference = searcher.analyzeSync({ fen, timeMs: FOREVER, maxDepth: expected });
      assert.deepEqual(essence(result), essence(reference));
    }
  }
  // minDepth is capped by maxDepth, and a budget that is never reached changes nothing.
  searcher.clear();
  const capped = searcher.analyzeSync({ fen: START, timeMs: FOREVER, maxNodes: 1, minDepth: 9, maxDepth: 3 });
  assert.equal(capped.depth, 3);
  assert.equal(capped.stopped, 'depth');
  searcher.clear();
  const roomy = searcher.analyzeSync({ fen: START, timeMs: FOREVER, maxNodes: 1e9, maxDepth: 3 });
  assert.deepEqual(essence(roomy), essence(capped));
});

test("cancellation: a yield hook that sets ctl.cancelled returns the last completed iteration with stopped 'cancel'", async () => {
  const searcher = createSearcher();
  // The search is unbounded (depth 30, all root moves exact); only the cancel can end it.
  const snapshots = [];
  let yields = 0;
  const ctl = {
    cancelled: false,
    onDepth: r => snapshots.push(r),
    yield: async () => {
      yields++;
      if (snapshots.length >= 3) ctl.cancelled = true;
    },
  };
  const result = await searcher.analyze({ fen: START, timeMs: FOREVER, maxDepth: 30, allDepth: 30 }, ctl);
  assert.equal(result.stopped, 'cancel');
  assert.ok(yields >= 1);
  const last = snapshots.at(-1);
  assert.ok(result.depth >= 3);
  assert.equal(result.depth, last.depth);
  assert.deepEqual(essence(result), essence(last), 'the result is the last completed iteration');
  assert.deepEqual(snapshots.map(s => s.depth), snapshots.map((_, i) => i + 1), 'onDepth reports every iteration once, in order');

  // Without a yield hook the node search sees the flag at its clock check: iteration 5 is discarded.
  searcher.clear();
  const flag = { cancelled: false, onDepth: r => { if (r.depth === 4) flag.cancelled = true; } };
  const polled = await searcher.analyze({ fen: START, timeMs: FOREVER, maxDepth: 30, allDepth: 30 }, flag);
  assert.equal(polled.stopped, 'cancel');
  assert.equal(polled.depth, 4);
  searcher.clear();
  const reference = searcher.analyzeSync({ fen: START, timeMs: FOREVER, maxDepth: 4, allDepth: 4 });
  assert.deepEqual(essence(polled), essence(reference));

  // A call that is already cancelled returns at once.
  const dead = await searcher.analyze({ fen: START, timeMs: FOREVER }, { cancelled: true });
  assert.equal(dead.stopped, 'cancel');
  assert.equal(dead.depth, 0);
  assert.equal(dead.nodes, 0);

  // analyze without a control object is the same search as analyzeSync.
  searcher.clear();
  const plainCall = await searcher.analyze({ fen: START, timeMs: FOREVER, maxDepth: 4, allDepth: 4 });
  assert.deepEqual(essence(plainCall), essence(reference));
});

test("a call that is overtaken by another call on the same searcher ends with stopped 'cancel'", async () => {
  const searcher = createSearcher();
  /** @type {(value?: unknown) => void} */
  let release = () => {};
  let waiting = () => {};
  const firstYield = new Promise(resolve => { waiting = resolve; });
  const snapshots = [];
  const ctl = {
    cancelled: false,
    onDepth: r => snapshots.push(r),
    yield: () => new Promise(resolve => {
      release = resolve;
      waiting();
    }),
  };
  const first = searcher.analyze({ fen: START, timeMs: FOREVER, maxDepth: 30, allDepth: 30 }, ctl);
  await firstYield;                                           // the first call is parked in its yield
  const second = searcher.analyzeSync({ fen: REFERENCE_POSITIONS.middlegameA, timeMs: FOREVER, maxDepth: 4 });
  assert.equal(second.depth, 4);
  assert.equal(second.stopped, 'depth');
  replayWithEngine(REFERENCE_POSITIONS.middlegameA, second.lines[0].pv);
  release();
  const overtaken = await first;
  assert.equal(overtaken.stopped, 'cancel');
  assert.equal(overtaken.fen, START);
  assert.equal(overtaken.depth, snapshots.length);
  if (snapshots.length > 0) assert.deepEqual(essence(overtaken), essence(snapshots.at(-1)));
  // The searcher is still usable.
  const third = searcher.analyzeSync({ fen: START, timeMs: FOREVER, maxDepth: 3 });
  assert.equal(third.depth, 3);
});

test("pass: returns the opponent's mate threat; in check returns stopped 'in-check'", () => {
  const searcher = createSearcher();
  // Black to move; if black passes, red mates with 炮八平五 (重炮).
  const fen = '3aka3/9/9/4C4/9/9/9/1C7/9/4K4 b';
  const threat = searcher.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 5, pass: true });
  assert.equal(threat.turn, 'red', 'the result belongs to the opponent');
  assert.equal(threat.fen, fen);
  assert.equal(code(threat.lines[0].move), '7174');
  assert.equal(threat.lines[0].mate, 1);
  assert.equal(threat.lines[0].score, MATE - 1, "scores are from the opponent's point of view");
  assert.equal(threat.stopped, 'mate');
  const { board } = boardOfFen(fen);
  assert.deepEqual(threat.lines.map(l => code(l.move)).sort(), getLegalMoves(board, 'red').map(code).sort());
  const end = replayWithEngine(fen, threat.lines[0].pv, 'red');
  assert.equal(getLegalMoves(end.board, end.turn).length, 0);

  // A material threat: if red passes, the black rook takes the red rook.
  const material = searcher.analyzeSync({ fen: '4k4/9/9/9/r2R5/4P4/9/9/9/4K4 w', timeMs: FOREVER, maxDepth: 4, pass: true });
  assert.equal(material.turn, 'black');
  assert.equal(code(material.lines[0].move), '4043');
  assert.ok(scoreToCp(material.lines[0].score) >= 800);
  assert.equal(material.depth, 4);
  // rootMoves restrict the opponent's moves.
  const only = searcher.analyzeSync({ fen: '4k4/9/9/9/r2R5/4P4/9/9/9/4K4 w', timeMs: FOREVER, maxDepth: 3, pass: true, rootMoves: [ref('4030')] });
  assert.deepEqual(only.lines.map(l => code(l.move)), ['4030']);

  // The side to move is in check: no pass is possible.
  const checked = '3aka3/9/9/4C4/9/9/9/4C4/9/4K4 b';
  const inCheck = searcher.analyzeSync({ fen: checked, timeMs: FOREVER, pass: true });
  assert.equal(inCheck.stopped, 'in-check');
  assert.deepEqual(inCheck.lines, []);
  assert.equal(inCheck.depth, 0);
  const alsoChecked = searcher.analyzeSync({ fen: '4k4/9/9/9/4r4/9/9/R8/9/4K4 w', timeMs: FOREVER, pass: true });
  assert.equal(alsoChecked.stopped, 'in-check');
});

test('repetition in search: a forced repetition scores -20; a perpetual check scores as a loss for the checker', () => {
  const searcher = createSearcher();
  // Red's only legal move is 帅五平六, which repeats the position two plies after F0 in the game history.
  // The game: F0 (red) K(9,4)-(9,3), F1 (black) a(0,3)-(1,4), F2 (red) K(9,3)-(9,4), F3 (black) a(1,4)-(0,3), back to F0.
  const cycle = [
    '3a1k3/9/5r3/9/9/9/9/9/r8/4K4 w',
    '3a1k3/9/5r3/9/9/9/9/9/r8/3K5 b',
    '5k3/4a4/5r3/9/9/9/9/9/r8/3K5 w',
    '5k3/4a4/5r3/9/9/9/9/9/r8/4K4 b',
  ];
  {
    // The history is a real game: each position follows from the one before by the stated move.
    const steps = ['9493', '0314', '9394', '1403'];
    for (let i = 0; i < 4; i++) {
      const end = replayWithEngine(cycle[i], [ref(steps[i])]);
      assert.equal(Position.fromBoard(end.board, end.turn).toFen(), cycle[(i + 1) % 4]);
    }
  }
  const forced = searcher.analyzeSync({ fen: cycle[0], history: cycle, timeMs: FOREVER, maxDepth: 4 });
  assert.equal(forced.lines.length, 1);
  assert.equal(code(forced.lines[0].move), '9493');
  assert.equal(forced.lines[0].score, -20);
  assert.deepEqual(forced.lines[0].byDepth, [-20, -20, -20, -20]);
  assert.equal(forced.lines[0].repeats, 2, 'the position after the move occurred once in the game');
  assert.equal(forced.lines[0].mate, null);
  // Without the history the same move is simply a lost position for red (two rooks down), and it is new.
  searcher.clear();
  const fresh = searcher.analyzeSync({ fen: cycle[0], timeMs: FOREVER, maxDepth: 4 });
  assert.ok(scoreToCp(fresh.lines[0].score) < -1000);
  assert.equal(fresh.lines[0].repeats, 1);
  // With a second legal move (a pawn) the root loop is the ordinary one: the repeating move still scores -20 and is best.
  const withPawn = cycle.map(f => f.replace('/9/r8/', '/P8/r8/'));
  searcher.clear();
  const choice = searcher.analyzeSync({ fen: withPawn[0], history: withPawn, timeMs: FOREVER, maxDepth: 3, allDepth: 3 });
  assert.equal(choice.lines.length, 2);
  assert.equal(code(choice.lines[0].move), '9493');
  assert.equal(choice.lines[0].score, -20);
  assert.equal(choice.lines[0].repeats, 2);
  assert.equal(choice.lines[1].repeats, 1);
  assert.ok(scoreToCp(choice.lines[1].score) < -1000);

  // Perpetual check: red has checked on each of its moves, rook (1,8) <-> (0,8), king (0,4) <-> (1,4).
  const checks = [
    '4k4/8R/9/9/9/9/9/9/9/3K5 w',
    '4k3R/9/9/9/9/9/9/9/9/3K5 b',
    '8R/4k4/9/9/9/9/9/9/9/3K5 w',
    '9/4k3R/9/9/9/9/9/9/9/3K5 b',
  ];
  searcher.clear();
  const perpetual = searcher.analyzeSync({ fen: checks[0], history: checks, timeMs: FOREVER, maxDepth: 2, allDepth: 2 });
  const again = lineOf(perpetual, ref('1808'));
  assert.ok(again !== null);
  assert.ok(again.score <= -WIN, `the third check in a row must be a loss, got ${again.score}`);
  assert.equal(again.score, -(MATE - 100 - 1), 'BAN - ply, seen from the checker');
  assert.equal(again.repeats, 2);
  assert.notEqual(code(perpetual.lines[0].move), '1808');
  assert.ok(perpetual.lines[0].score > 0, 'red is a rook up and has other moves');
  // The same move without the history is an ordinary check.
  searcher.clear();
  const first = searcher.analyzeSync({ fen: checks[0], timeMs: FOREVER, maxDepth: 2, allDepth: 2 });
  assert.ok(lineOf(first, ref('1808')).score > 0);

  // Inside the tree: after 车一进一 将5进1 the checker may not return with a third check while the king shuttles, so the
  // perpetual line is never the principal variation of a deeper search, and no line is scored as a draw by repetition.
  searcher.clear();
  const deep = searcher.analyzeSync({ fen: checks[0], timeMs: FOREVER, maxDepth: 7 });
  const pos = Position.fromFen(checks[0]);
  const seen = new Set([pos.key]);
  for (const move of deep.lines[0].pv) {
    pos.make(pos.fromRef(move));
    assert.ok(!seen.has(pos.key), 'the principal variation repeats a position');
    seen.add(pos.key);
  }
});

test('repetition in search: a game position re-created by the side that was being checked is a plain repetition; inside the tree the checker loses', () => {
  // The game rule (Appendix A4) forbids only the checker's own move that re-creates a position. When the checks were
  // really played and the checked side steps back, nobody has lost: the search must not report a win or a loss there.
  // The same game as above: the red rook checks on alternating ranks, the black king steps away and back (F0 F1 F2 F3 F0 ...).
  const game = [
    '4k4/8R/9/9/9/9/9/9/9/3K5 w',
    '4k3R/9/9/9/9/9/9/9/9/3K5 b',
    '8R/4k4/9/9/9/9/9/9/9/3K5 w',
    '9/4k3R/9/9/9/9/9/9/9/3K5 b',
  ];
  const searcher = createSearcher();
  // Black to move in F3 (in check) after F0 F1 F2. 将5退1 returns to F0. Nothing is forbidden there: red has not yet
  // repeated a check (that is the case of the test above), so the step back is a repetition and never a "win" for the
  // lone king, which is in fact mated next move.
  for (const mode of [{ allDepth: 4 }, {}, { rootMoves: [ref('1404')] }]) {
    searcher.clear();
    const evader = searcher.analyzeSync({ fen: game[3], history: game.slice(0, 3), timeMs: FOREVER, maxDepth: 4, ...mode });
    const back = lineOf(evader, ref('1404'));
    const label = JSON.stringify(mode);
    assert.equal(back.repeats, 2, label);
    assert.equal(back.score, -20, label);
    assert.equal(back.mate, null, label);
    assert.deepEqual(back.pv.map(code), ['1404'], label);
    assert.equal(evader.stopped, 'depth', `${label}: no mate is claimed`);
    for (const line of evader.lines) assert.ok(line.score < WIN, `${label}: ${code(line.move)} claims a win for the lone king`);
  }
  // Red to move in F2 after F0 F1. The second check 车一退一 (0818) lets the king step back to F0: again a repetition,
  // not a forced loss for red, whose king is nowhere near danger. Red's real mate is found next to it.
  for (const mode of [{ allDepth: 4 }, { rootMoves: [ref('0818')] }]) {
    searcher.clear();
    const checker = searcher.analyzeSync({ fen: game[2], history: game.slice(0, 2), timeMs: FOREVER, maxDepth: 4, ...mode });
    const second = lineOf(checker, ref('0818'));
    const label = JSON.stringify(mode);
    assert.equal(second.repeats, 1, label);
    assert.equal(second.score, -20, label);
    assert.equal(second.mate, null, label);
    assert.deepEqual(second.pv.map(code), ['0818', '1404'], label);
    if (mode.allDepth) assert.equal(checker.lines[0].mate, 2, 'red mates in two with another move');
  }
  // Without the game history F0 is not a repetition at all: the same check is simply a winning move.
  searcher.clear();
  const fresh = searcher.analyzeSync({ fen: game[2], timeMs: FOREVER, maxDepth: 4, allDepth: 4 });
  assert.ok(lineOf(fresh, ref('0818')).score > 900);

  // Inside the tree the rule of A3.4 stands: a line in which one side checks on every move and the other side steps
  // back into a position of the line counts as the checker's loss. The tactical suite relies on it: in 卧槽马 the horse
  // could also check from (2,5), return to its square with a second check and win the rook two moves later, but the king
  // would step back into the root position, so that route is closed and 马六进七 (3312) is the only move that wins the rook.
  searcher.clear();
  const trough = searcher.analyzeSync({ fen: 'r1bakab2/9/9/3N5/9/9/9/9/9/5K3 w', timeMs: FOREVER, maxDepth: 6, allDepth: 6 });
  assert.equal(code(trough.lines[0].move), '3312');
  assert.ok(lineOf(trough, ref('3312')).score > lineOf(trough, ref('3325')).score + 500,
    `3312 ${lineOf(trough, ref('3312')).score}, 3325 ${lineOf(trough, ref('3325')).score}`);
});

test('quiescence PV: the PV of a capture line ends in a position with no winning capture', () => {
  const searcher = createSearcher();
  /** Replay a PV and return the position at its end. */
  const endOf = (fen, pv) => {
    const pos = Position.fromFen(fen);
    for (const move of pv) assert.equal(pos.make(pos.fromRef(move)), true);
    return pos;
  };
  /** The largest static exchange value among the legal captures of the side to move. */
  const bestCapture = pos => {
    let best = 0;
    for (const move of pos.legalMoves()) {
      if (pos.squares[mvTo(move)] !== 0) best = Math.max(best, pos.see(move));
    }
    return best;
  };
  const cases = [
    // [fen, move, the capture sequence the PV must start with (a list of alternatives where two recaptures are equal)]
    ['4k4/9/9/9/c1P1N3R/4P4/9/9/9/4K4 b', '4044', [['4044'], ['4844', '5444']]],            // cannon takes horse, rook or pawn takes cannon
    ['4k4/9/3r1r3/9/4N4/9/4P4/9/9/4K4 w', '4423', [['4423'], ['2523']]],                    // horse takes rook, rook takes horse
    // The pawn takes a pawn; taking back at once with the rook would lose it to the rook on (9,0), so the PV is longer.
    ['rnbakabnr/9/1c5c1/2p1p1p1p/p8/P8/2P1P1P1P/1C5C1/9/RNBAKABNR w', '5040', [['5040']]],
  ];
  for (const [fen, move, start] of cases) {
    // Depth 1 is the quiescence value of the move: the whole PV is the capture sequence.
    searcher.clear();
    const table = searcher.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 1, allDepth: 1, pvLength: 32 });
    const line = lineOf(table, ref(move));
    assert.ok(line.pv.length >= start.length, `${fen}: the PV stops before the exchange is over: ${line.pv.map(code).join(' ')}`);
    start.forEach((options, i) => assert.ok(options.includes(code(line.pv[i])), `${fen}: PV ${line.pv.map(code).join(' ')}`));
    const end = endOf(fen, line.pv);
    assert.ok(bestCapture(end) < 100, `${fen}: a winning capture is left at the end of ${line.pv.map(code).join(' ')}`);
    // The score is the static evaluation of that final position, seen from the root side.
    const sign = line.pv.length % 2 === 0 ? 1 : -1;
    assert.equal(line.score, (sign * end.evaluate()) | 0, fen);
    // The same holds when the move is searched alone.
    searcher.clear();
    const single = searcher.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 1, rootMoves: [ref(move)], pvLength: 32 });
    assert.deepEqual(single.lines[0].pv, line.pv);
    assert.equal(single.lines[0].score, line.score);
  }

  // In general: an untruncated PV ends where its score comes from. Unless the line ends in mate or in a repetition,
  // that is a position in which the side to move stands pat, so the score is its static evaluation.
  let checked = 0, longer = 0;
  for (const fen of sampleFens(30, { seed: 303, stride: 9, plies: 150, pawnBias: 0.2 })) {
    for (const depth of [1, 2, 3, 4]) {
      searcher.clear();
      const table = searcher.analyzeSync({ fen, timeMs: FOREVER, maxDepth: depth, allDepth: depth, pvLength: 60 });
      for (const line of table.lines) {
        if (line.mate !== null || Math.abs(line.score) === 20 || line.pv.length >= 60) continue;
        const end = endOf(fen, line.pv);
        const sign = line.pv.length % 2 === 0 ? 1 : -1;
        assert.equal(line.score, (sign * end.evaluate()) | 0, `${fen} depth ${depth}: ${line.pv.map(code).join(' ')}`);
        checked++;
        if (line.pv.length > depth) longer++;
      }
    }
  }
  assert.ok(checked > 3000 && longer > 500, `checked ${checked}, with quiescence moves ${longer}`);
});

test('analyze throws on a position where the side not on move is in check', async () => {
  const searcher = createSearcher();
  const illegal = [
    '4k4/9/9/9/9/9/9/9/4R4/3K5 w',     // red to move while its rook already attacks the black king
    '4k4/9/9/9/9/9/9/9/9/4K4 w',       // the kings face each other
    '4k4/9/9/9/9/9/9/9/9/4K4 b',
  ];
  for (const fen of illegal) {
    assert.throws(() => searcher.analyzeSync({ fen, timeMs: FOREVER }), { name: 'RangeError', message: 'illegal position' });
    await assert.rejects(searcher.analyze({ fen, timeMs: FOREVER }, { cancelled: false }), { name: 'RangeError', message: 'illegal position' });
    assert.throws(() => searcher.analyzeSync({ fen, timeMs: FOREVER, pass: true }), RangeError);
  }
  // A malformed FEN is a RangeError as well, also inside the history.
  assert.throws(() => searcher.analyzeSync({ fen: 'nonsense', timeMs: FOREVER }), RangeError);
  assert.throws(() => searcher.analyzeSync({ fen: START, history: ['nonsense'], timeMs: FOREVER }), RangeError);
  // The searcher is still usable afterwards.
  assert.equal(searcher.analyzeSync({ fen: START, timeMs: FOREVER, maxDepth: 2 }).depth, 2);
});

test('revealDepth / revealTier / separationDepth on hand-built tables', () => {
  // revealDepth, sense 'bad': 1 + the last depth at which the move still looked more than 60 cp better than it is.
  assert.equal(revealDepth([120, 110, -300, -310], -310, 'bad'), 3);
  assert.equal(revealDepth([-300, -310], -310, 'bad'), 1);
  assert.equal(revealDepth([100, 100, 100, -400], -400, 'bad'), 4);
  assert.equal(revealDepth([-250, -310], -310, 'bad'), 1, 'exactly 60 above is within 60');
  assert.equal(revealDepth([-249, -310], -310, 'bad'), 2);
  assert.equal(revealDepth([-400, 0, -400, -310], -310, 'bad'), 3, 'the largest such depth counts');
  assert.equal(revealDepth([], 50, 'bad'), 1);
  assert.equal(revealDepth([30, -(MATE - 2)], -(MATE - 2), 'bad'), 2, 'a mate against the mover is -2000 cp');
  // sense 'good': 1 + the last depth at which the move still looked more than 60 cp worse than it is.
  assert.equal(revealDepth([-50, 0, 300, 320], 320, 'good'), 3);
  assert.equal(revealDepth([260, 320], 320, 'good'), 1);
  assert.equal(revealDepth([259, 320], 320, 'good'), 2);
  assert.equal(revealDepth([320, 330, 320], 320, 'good'), 1);
  assert.equal(revealDepth([150, 200, MATE - 3], MATE - 3, 'good'), 3);
  assert.equal(revealDepth([MATE - 5, MATE - 3], MATE - 3, 'good'), 1, 'mates of different length are the same 2000 cp');

  // revealTier: 1 = reveal 1-2, 2 = reveal 3-4, 3 = deeper.
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(revealTier), [1, 1, 2, 2, 3, 3, 3]);

  // separationDepth: first all-exact depth at which every line of the group beats every other line by >= 100 cp.
  const line = (moveCode, byDepth) => ({
    move: ref(moveCode), score: byDepth.at(-1), depth: byDepth.length, upper: null, mate: null, pv: [ref(moveCode)], byDepth, naive: 0, repeats: 1,
  });
  const a = line('7774', [10, 50, 200, 210]), b = line('9776', [20, 40, 60, 80]), c = line('6454', [0, -30, 90, 100]);
  const table = { fen: START, turn: 'red', depth: 4, allDepth: 4, lines: [a, c, b], nodes: 1, timeMs: 1, stopped: 'depth' };
  assert.equal(separationDepth(table, [a]), 3, '200 against 90 and 60');
  assert.equal(separationDepth(table, [a, c]), 5, 'never: allDepth + 1');
  assert.equal(separationDepth(table, [b]), 5);
  assert.equal(separationDepth(table, [line('7774', [10, 50, 200, 210])]), 3, 'a group is matched by move, not by identity');
  // Exactly 100 separates; 99 does not.
  const edge = d2 => ({ ...table, depth: 2, allDepth: 2, lines: [line('7774', [0, 150]), line('9776', [0, d2])] });
  assert.equal(separationDepth(edge(50), [edge(50).lines[0]]), 2);
  assert.equal(separationDepth(edge(51), [edge(51).lines[0]]), 3);
  // Only all-exact iterations count, even when a line has deeper exact scores.
  const partial = { ...table, depth: 3, allDepth: 2, lines: [line('7774', [0, 0, 500]), line('9776', [0, 0])] };
  assert.equal(separationDepth(partial, [partial.lines[0]]), 3);
  // A win is 2000 cp: it separates from any ordinary score.
  const mating = { ...table, depth: 3, allDepth: 3, lines: [line('7774', [100, 100, MATE - 3]), line('9776', [100, 100, 1850])] };
  assert.equal(separationDepth(mating, [mating.lines[0]]), 3);

  // lineOf
  assert.equal(lineOf(table, ref('9776')), b);
  assert.equal(lineOf(table, { from: { row: 7, col: 7 }, to: { row: 7, col: 4 } }), a);
  assert.equal(lineOf(table, ref('7770')), null);
});

test('scoreToCp and mateIn follow the conventions of section 3', () => {
  assert.equal(MATE, 30000);
  assert.equal(WIN, 29800);
  assert.deepEqual([0, 137, -137, 1900, 1901, 29799, -1900, -1901, -29799].map(scoreToCp), [0, 137, -137, 1900, 1900, 1900, -1900, -1900, -1900]);
  assert.deepEqual([29800, 29999, 30000, -29800, -29999, -30000].map(scoreToCp), [2000, 2000, 2000, -2000, -2000, -2000]);
  assert.deepEqual([0, 500, -500, 29799, -29799].map(mateIn), [null, null, null, null, null]);
  // MATE - n is a win in n plies: ceil(n / 2) moves of the winner.
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(n => mateIn(MATE - n)), [1, 1, 2, 2, 3, 3]);
  // -(MATE - n): the mover is mated after floor(n / 2) of its own moves.
  assert.deepEqual([2, 3, 4, 5, 6].map(n => mateIn(-(MATE - n))), [-1, -1, -2, -2, -3]);
  assert.equal(mateIn(WIN), 100);
  assert.equal(mateIn(-WIN), -100);
  assert.ok(Object.is(mateIn(-MATE), 0), 'no negative zero');
});

test('perft and calibrate: perft(start) = 44 / 1920 / 79666 for depth 1-3; calibrate classifies the speed', () => {
  assert.equal(perft(START, 0), 1);
  assert.equal(perft(START, 1), 44);
  assert.equal(perft(START, 2), 1920);
  assert.equal(perft(START, 3), 79666);
  assert.equal(perft(START.replace(' w', ' b'), 2), 1920);
  assert.equal(perft('3aka3/9/9/4C4/9/9/9/4C4/9/4K4 b', 3), 0, 'a mated side has no line');
  assert.throws(() => perft('nonsense', 1), RangeError);
  const speed = createSearcher({ ttBits: 8 }).calibrate();
  assert.ok(Number.isInteger(speed.perftNps) && speed.perftNps > 0);
  assert.equal(speed.speedClass, speed.perftNps >= 3e6 ? 'fast' : speed.perftNps >= 1e6 ? 'mid' : 'slow');
});

/** The colour-swapped, vertically mirrored FEN. */
function swapFen(fen) {
  const [placement, side] = fen.split(' ');
  const swapCase = ch => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase());
  const rows = placement.split('/').reverse().map(row => [...row].map(swapCase).join(''));
  return `${rows.join('/')} ${side === 'w' ? 'b' : 'w'}`;
}

test('symmetry: the colour-swapped mirrored position has the same plain depth-3 score on 100 positions', () => {
  assert.equal(swapFen(START), START.replace(' w', ' b'));
  const plain = createSearcher({ plain: true });
  const mirror = m => ({ from: { row: 9 - m.from.row, col: m.from.col }, to: { row: 9 - m.to.row, col: m.to.col } });
  let decided = 0;
  for (const [index, fen] of sampleFens(100, { seed: 404, stride: 7, plies: 150, pawnBias: 0.25 }).entries()) {
    // The first 20 positions with every root move exact, the rest best move only.
    const mode = index < 20 ? { allDepth: 3 } : {};
    plain.clear();
    const a = plain.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 3, ...mode });
    plain.clear();
    const b = plain.analyzeSync({ fen: swapFen(fen), timeMs: FOREVER, maxDepth: 3, ...mode });
    assert.equal(a.depth, b.depth, fen);
    assert.equal(a.lines[0].score, b.lines[0].score, fen);
    if (index < 20) {
      // Every root move has the same score as its mirror image, at every depth.
      for (const line of a.lines) {
        const twin = lineOf(b, mirror(line.move));
        assert.ok(twin !== null, fen);
        assert.deepEqual(twin.byDepth, line.byDepth, `${fen}: ${code(line.move)}`);
        assert.equal(twin.naive, line.naive);
      }
    }
    if (Math.abs(a.lines[0].score) > 100) decided++;
  }
  assert.ok(decided > 25, 'the sample must contain unbalanced positions');
});

/** Positions reached by seeded random play on the compact board (fast), each with the list of its moves that win at once. */
function winsInOne(games, plies) {
  const found = [];
  const buf = new Int32Array(128);
  /** Does the side to move have a legal move? Stops at the first one. */
  const canMove = pos => {
    const n = pos.generate(buf, false);
    for (let i = 0; i < n; i++) {
      if (pos.make(buf[i])) {
        pos.unmake();
        return true;
      }
    }
    return false;
  };
  for (let game = 0; game < games; game++) {
    const rng = mulberry32(9000 + game);
    const pos = Position.fromFen(START);
    for (let ply = 0; ply < plies; ply++) {
      const moves = pos.legalMoves();
      if (moves.length === 0) break;
      const winning = moves.filter(move => {
        pos.make(move);
        const over = !canMove(pos);
        pos.unmake();
        return over;
      });
      if (winning.length > 0) found.push({ fen: pos.toFen(), winning: winning.map(m => code(pos.toRef(m))) });
      pos.make(moves[Math.floor(rng() * moves.length)]);
    }
  }
  return found;
}

test('a win in one move is never missed: with the smallest budget every such position reports mate 1', () => {
  const positions = winsInOne(60, 220);
  assert.ok(positions.length >= 40, `only ${positions.length} positions with a win in one`);
  assert.ok(positions.some(p => p.winning.length > 1), 'some positions have several winning moves');
  const searcher = createSearcher();
  for (const { fen, winning } of positions) {
    // maxNodes 1: only the iterations up to the default minDepth (2) run.
    const result = searcher.analyzeSync({ fen, timeMs: FOREVER, maxNodes: 1 });
    assert.equal(result.depth, 2, fen);
    const best = result.lines[0];
    assert.equal(best.mate, 1, `${fen}: missed ${winning.join(' ')}`);
    assert.equal(best.score, MATE - 1, fen);
    assert.ok(winning.includes(code(best.move)), `${fen}: ${code(best.move)} does not win at once`);
    // Every other winning move is scored as a win too when all root moves are exact.
    searcher.clear();
    const table = searcher.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 2, allDepth: 2 });
    for (const line of table.lines) assert.equal(line.score === MATE - 1, winning.includes(code(line.move)), `${fen}: ${code(line.move)}`);
  }
});

/** Brute force, no pruning: can the side to move leave the other side without a legal move within `n` of its own moves? */
function forcedWin(pos, n) {
  for (const move of pos.legalMoves()) {
    pos.make(move);
    const won = forcedLoss(pos, n - 1);
    pos.unmake();
    if (won) return true;
  }
  return false;
}
/** Brute force: the side to move has no legal move, or every move it has allows forcedWin(k) for the other side. */
function forcedLoss(pos, k) {
  const moves = pos.legalMoves();
  if (moves.length === 0) return true;
  if (k === 0) return false;
  for (const move of moves) {
    pos.make(move);
    const lost = forcedWin(pos, k);
    pos.unmake();
    if (!lost) return false;
  }
  return true;
}

test('mate claims are sound: a win or loss within two moves that a table reports is forced, and a move that allows a win in one is always reported', () => {
  // Late positions of seeded random games: kings are exposed, so quick wins for either side are common.
  const fens = [];
  for (let game = 0; game < 8; game++) {
    const rng = mulberry32(9100 + game);
    const pos = Position.fromFen(START);
    for (let ply = 0; ply < 220; ply++) {
      const moves = pos.legalMoves();
      if (moves.length === 0) break;
      if (ply >= 110 && ply % 8 === 0) fens.push(pos.toFen());
      pos.make(moves[Math.floor(rng() * moves.length)]);
    }
  }
  const searcher = createSearcher();
  let wins = 0, losses = 0, allowed = 0;
  for (const fen of fens) {
    searcher.clear();
    // Pruning on, every root move exact. The loop ends at depth 3 or 4 (it stops on a mate from depth 3 on).
    const table = searcher.analyzeSync({ fen, timeMs: FOREVER, maxDepth: 4, allDepth: 4 });
    assert.ok(table.depth >= 3, fen);
    const pos = Position.fromFen(fen);
    for (const line of table.lines) {
      const label = `${fen} ${code(line.move)} (score ${line.score})`;
      pos.make(pos.fromRef(line.move));
      // Completeness: the reply that ends the game at once (checkmate or 困毙) is never overlooked.
      const allowsWinInOne = forcedWin(pos, 1);
      assert.equal(line.mate === -1, allowsWinInOne, `${label}: the opponent ${allowsWinInOne ? 'wins' : 'does not win'} in one`);
      if (allowsWinInOne) allowed++;
      // Soundness: a reported distance of one or two moves is a forced win (for the mover or against it).
      // (A repetition-ban score is not a distance; its `mate` is 50 or more, so it is not looked at here.)
      if (line.mate !== null && Math.abs(line.mate) <= 2) {
        assert.ok(Math.abs(line.score) >= MATE - 4, label);
        if (line.mate > 0) {
          assert.equal(forcedLoss(pos, line.mate - 1), true, `${label}: claimed a win in ${line.mate} that is not forced`);
          wins++;
        } else {
          assert.equal(forcedWin(pos, -line.mate), true, `${label}: claimed a loss in ${-line.mate} that is not forced`);
          losses++;
        }
      }
      pos.unmake();
    }
  }
  assert.ok(fens.length >= 80 && wins >= 10 && losses >= 60 && allowed >= 50, `positions ${fens.length}, wins ${wins}, losses ${losses}, allowed ${allowed}`);
});

test('a quicker mate is found in the iteration that reaches it, in every root mode (the table keeps the depth a node was asked for)', () => {
  // Each position has a mate in two (checkmate) and a longer forced mate that iteration 3 also reaches through check
  // extensions. The best-only root searches the longer one first and then tests the other moves with null-window
  // searches; a table entry left by iteration 2 must not answer for the deeper search of iteration 3.
  const fens = [
    '9/4a4/4k4/6R2/P8/6PR1/4N4/B8/9/3A1K3 w',
    '2b3r2/4k4/9/9/9/1p7/9/9/7C1/3K5 b',
    '9/5k3/9/P3C4/9/9/9/9/4A1R2/3K5 w',
    '2b1k4/9/4b4/9/9/3r5/p4pp2/4K4/3n5/9 b',
  ];
  for (const fen of fens) {
    const pos = Position.fromFen(fen);
    assert.equal(forcedWin(pos, 1), false, `${fen}: the fixture has no win in one`);
    assert.equal(forcedWin(pos, 2), true, `${fen}: the fixture has a win in two`);
    for (const mode of [{}, { multiPV: 3 }, { allDepth: 4, multiPV: 6 }, { allDepth: 6 }]) {
      const result = createSearcher().analyzeSync({ fen, timeMs: FOREVER, maxDepth: 6, ...mode });
      const best = result.lines[0];
      const label = `${fen} ${JSON.stringify(mode)}`;
      assert.equal(best.mate, 2, `${label}: mate distance`);
      assert.equal(best.score, MATE - 3, label);
      assert.equal(result.depth, 3, label);
      assert.equal(result.stopped, 'mate', label);
      assert.equal(best.pv.length, 3, label);
      const end = replayWithEngine(fen, best.pv);
      assert.equal(getLegalMoves(end.board, end.turn).length, 0, `${label}: the PV must end with no legal move`);
    }
  }
});

/**
 * Start `searcher.analyze(request, {onDepth})` on a virtual clock: performance.now() returns clock.t, and every read adds
 * clock.step and counts in clock.reads. Without a yield hook the whole search runs inside the call, so the real clock is
 * back before anything else runs. The search reads the clock once at the start of a call, once before each iteration
 * beyond minDepth, once per 2048 nodes, and once per report.
 */
function analyzeOnClock(searcher, clock, request, onDepth) {
  const original = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', {
    configurable: true,
    writable: true,
    value: () => {
      clock.reads = (clock.reads ?? 0) + 1;
      clock.t += clock.step;
      return clock.t;
    },
  });
  try {
    return searcher.analyze(request, { cancelled: false, onDepth });
  } finally {
    if (original) Object.defineProperty(performance, 'now', original);
    else delete performance.now;
  }
}

test('time control on a virtual clock: soft deadline, hard deadline, minDepth with its safety stop', async () => {
  const searcher = createSearcher();
  const fen = REFERENCE_POSITIONS.middlegameA;
  const request = { fen, allDepth: 30, maxDepth: 30 };
  const real = performance.now();

  // The clock stands still: no deadline ever arrives, the call runs to maxDepth.
  searcher.clear();
  const still = await analyzeOnClock(searcher, { t: 1000, step: 0 }, { ...request, timeMs: 50, maxDepth: 4 });
  assert.equal(still.depth, 4);
  assert.equal(still.stopped, 'depth');
  assert.equal(still.timeMs, 0);
  assert.ok(performance.now() >= real, 'the real clock is back');

  // Soft deadline: no iteration starts once 0.5 * timeMs has passed. Time jumps when iteration 3 is reported.
  for (const [elapsed, expectedDepth, expectedStop] of [[50, 3, 'time'], [49, 5, 'depth']]) {
    searcher.clear();
    const clock = { t: 0, step: 0 };
    const result = await analyzeOnClock(searcher, clock, { ...request, timeMs: 100, maxDepth: 5 }, r => {
      if (r.depth === 3) clock.t = elapsed;
    });
    assert.equal(result.depth, expectedDepth, `elapsed ${elapsed}`);
    assert.equal(result.stopped, expectedStop, `elapsed ${elapsed}`);
  }

  // Hard deadline: one virtual millisecond per clock read. With timeMs 40 the deadline falls inside an iteration,
  // and that iteration is discarded.
  searcher.clear();
  const hard = await analyzeOnClock(searcher, { t: 0, step: 1 }, { ...request, timeMs: 40 });
  assert.equal(hard.stopped, 'time');
  assert.ok(hard.depth >= 2 && hard.depth < 30);
  assert.ok(hard.timeMs >= 40, `virtual time ${hard.timeMs}`);
  searcher.clear();
  const reference = searcher.analyzeSync({ ...request, timeMs: FOREVER, maxDepth: hard.depth });
  assert.deepEqual(essence(hard), essence(reference), 'the unfinished iteration must not leak');

  // minDepth: iterations up to it ignore the deadline. With timeMs 0 the call stops right after them.
  for (const minDepth of [1, 2, 3, 4]) {
    searcher.clear();
    const result = await analyzeOnClock(searcher, { t: 0, step: 1 }, { ...request, timeMs: 0, minDepth });
    assert.equal(result.depth, minDepth);
    assert.equal(result.stopped, 'time');
  }
  // Safety stop: even those iterations end at max(4 * timeMs, 1000 ms). One read is 400 virtual ms here.
  searcher.clear();
  const safety = await analyzeOnClock(searcher, { t: 0, step: 400 }, { ...request, timeMs: 0, minDepth: 12 });
  assert.equal(safety.stopped, 'time');
  assert.ok(safety.depth >= 1 && safety.depth < 12);
  searcher.clear();
  const safetyReference = searcher.analyzeSync({ ...request, timeMs: FOREVER, maxDepth: safety.depth });
  assert.deepEqual(essence(safety), essence(safetyReference));
  // With timeMs 1000 the bound is 4000 ms: more polls fit, so more nodes are searched before the stop.
  searcher.clear();
  const longer = await analyzeOnClock(searcher, { t: 0, step: 400 }, { ...request, timeMs: 1000, minDepth: 12 });
  assert.equal(longer.stopped, 'time');
  assert.ok(longer.nodes > safety.nodes, `${longer.nodes} vs ${safety.nodes}`);
});

test('panic extension: after the previous best move dropped by 100 cp the hard deadline moves to 2 x timeMs, once per call', async () => {
  // In this position the best move of iteration 5 loses more than 100 cp in iteration 6; nothing drops in iteration 5.
  const fen = '4ka1nr/4a1r2/b1n6/p1P1p1p1p/P5b2/2B3P2/1CR1P2cc/B4A2C/3N1N3/4KA2R b';
  const request = { fen, allDepth: 30, maxDepth: 30, timeMs: 1000 };
  const searcher = createSearcher();
  const snapshots = [];
  await searcher.analyze({ ...request, timeMs: FOREVER, maxDepth: 6 }, { cancelled: false, onDepth: r => snapshots.push(r) });
  const dropAt = d => {
    const previousBest = snapshots[d - 2].lines[0];
    return scoreToCp(previousBest.score) - scoreToCp(lineOf(snapshots[d - 1], previousBest.move).score);
  };
  assert.ok(dropAt(6) >= 100, `the fixture needs a drop in iteration 6, got ${dropAt(6)}`);
  assert.ok(dropAt(5) < 100, `the fixture needs a steady iteration 5, got ${dropAt(5)}`);

  /**
   * The clock stands still until iteration d - 1 is reported; then 400 ms have passed (below the soft deadline of 500)
   * and every read adds `step` ms. Returns the result and the number of reads from that point on.
   */
  const run = async (d, step, maxDepth) => {
    searcher.clear();
    const clock = { t: 0, step: 0, reads: 0 };
    let readsBefore = 0;
    const result = await analyzeOnClock(searcher, clock, { ...request, maxDepth: maxDepth ?? 30 }, r => {
      if (r.depth === d - 1) {
        clock.t = 400;
        clock.step = step;
        readsBefore = clock.reads;
      }
    });
    return { result, reads: clock.reads - readsBefore };
  };

  for (const [d, expectPanic] of [[6, true], [5, false]]) {
    // Calibration: how many clock reads iteration d takes when no deadline interferes (the clock stays at 400).
    const calibration = await run(d, 0, d);
    assert.equal(calibration.result.depth, d);
    const reads = calibration.reads;
    assert.ok(reads >= 40, `iteration ${d} is too short for this test: ${reads} reads`);

    // The hard deadline (1000) arrives half way through iteration d; 2 x timeMs would be enough to finish it.
    const half = await run(d, 1200 / reads);
    assert.equal(half.result.stopped, 'time');
    if (expectPanic) {
      assert.equal(half.result.depth, d, 'the extension lets iteration 6 finish');
      assert.ok(half.result.timeMs > 1000 && half.result.timeMs < 2000, `virtual time ${half.result.timeMs}`);
      assert.deepEqual(essence(half.result), essence(snapshots[d - 1]));
    } else {
      assert.equal(half.result.depth, d - 1, 'no drop, no extension: iteration 5 is discarded at the deadline');
      assert.ok(half.result.timeMs >= 1000 && half.result.timeMs < 1100, `virtual time ${half.result.timeMs}`);
      assert.deepEqual(essence(half.result), essence(snapshots[d - 2]));
    }

    // A slower machine: the deadline arrives after 15 % of iteration d and even 2 x timeMs is not enough.
    const slow = await run(d, 4000 / reads);
    assert.equal(slow.result.stopped, 'time');
    assert.equal(slow.result.depth, d - 1);
    assert.deepEqual(essence(slow.result), essence(snapshots[d - 2]));
    if (expectPanic) assert.ok(slow.result.timeMs >= 2000 && slow.result.timeMs < 2200, `extended once: ${slow.result.timeMs}`);
    else assert.ok(slow.result.timeMs >= 1000 && slow.result.timeMs < 1200, `not extended: ${slow.result.timeMs}`);
  }
});

test('exports: exactly the names of section 4.5, and a Searcher has its four members', async () => {
  const module = await import('../../../src/core/search.js');
  assert.deepEqual(Object.keys(module).sort(), [
    'MATE', 'WIN', 'createSearcher', 'lineOf', 'mateIn', 'perft', 'revealDepth', 'revealTier', 'scoreToCp', 'separationDepth',
  ]);
  const searcher = createSearcher({ ttBits: 10 });
  assert.deepEqual(Object.keys(searcher).sort(), ['analyze', 'analyzeSync', 'calibrate', 'clear']);
  // A small table still searches correctly; clear() empties it.
  const first = searcher.analyzeSync({ fen: TACTICAL_SUITE[8].fen, timeMs: FOREVER, maxDepth: 6 });
  assert.equal(first.lines[0].mate, 2);
  searcher.clear();
  const again = searcher.analyzeSync({ fen: TACTICAL_SUITE[8].fen, timeMs: FOREVER, maxDepth: 6 });
  assert.deepEqual(essence(again), essence(first), 'after clear() the same request gives the same table');
  assert.equal(again.nodes, first.nodes);
});
