// Unit tests of src/core/position.js (contract section 14.1; algorithms in Appendix A2).
// Every expected value comes from the contract text, from the v1 rules engine or from a brute-force computation in this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getLegalMoves, isInCheck } from '../../../src/core/engine.js';
import {
  Position, RED, BLACK, KING, ADVISOR, ELEPHANT, HORSE, ROOK, CANNON, PAWN, TYPE_NAME,
  sqOf, rowOf, colOf, mkMove, mvFrom, mvTo,
} from '../../../src/core/position.js';
import { mulberry32, playout, playoutPositions } from '../../helpers/playout.js';
import { REFERENCE_POSITIONS } from '../../helpers/positions.js';

const START = REFERENCE_POSITIONS.opening;
const code = ref => `${ref.from.row}${ref.from.col}${ref.to.row}${ref.to.col}`;
/** Move integer from four coordinates. */
const mv = (fr, fc, tr, tc) => mkMove(sqOf(fr, fc), sqOf(tr, tc));

/** Leaf count by generate / make / unmake. */
function perftOf(pos, depth, bufs = []) {
  const buf = bufs[depth] ?? (bufs[depth] = new Int32Array(128));
  const n = pos.generate(buf, false);
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (!pos.make(buf[i])) continue;
    total += depth === 1 ? 1 : perftOf(pos, depth - 1, bufs);
    pos.unmake();
  }
  return total;
}

/** Leaf count by the v1 rules engine. */
function enginePerft(board, turn, depth) {
  let total = 0;
  for (const move of getLegalMoves(board, turn)) {
    if (depth === 1) {
      total++;
      continue;
    }
    const next = board.map(row => row.slice());
    next[move.to.row][move.to.col] = next[move.from.row][move.from.col];
    next[move.from.row][move.from.col] = null;
    total += enginePerft(next, turn === 'red' ? 'black' : 'red', depth - 1);
  }
  return total;
}

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

/** Everything the incremental bookkeeping maintains, as plain data. */
function snapshot(pos) {
  return {
    side: pos.side,
    key: pos.key,
    lock: pos.lock,
    vl: Array.from(pos.vl),
    count: pos.count.map(c => Array.from(c)),
    kingSq: Array.from(pos.kingSq),
    fen: pos.toFen(),
  };
}

/** The piece lists in slot order (internal state that unmake must restore exactly: it fixes the order of generated moves). */
function pieceLists(pos) {
  return [0, 1].map(side => Array.from(pos.pieceSq.subarray(side * 90, side * 90 + pos.pieceN[side])));
}

/** The piece lists hold exactly the pieces on the board, each side in its own range, and slotOf points back. */
function assertPieceLists(pos, label) {
  for (const side of [0, 1]) {
    const tag = 8 << side;
    const onBoard = [];
    for (let sq = 0; sq < 256; sq++) if ((pos.squares[sq] & tag) !== 0) onBoard.push(sq);
    const listed = pieceLists(pos)[side];
    assert.deepEqual(listed.slice().sort((a, b) => a - b), onBoard, `piece list of side ${side} ${label}`);
    listed.forEach((sq, i) => assert.equal(pos.slotOf[sq], side * 90 + i, `slotOf ${label}`));
  }
}

test('perft start position depth 1-4 = 44 / 1920 / 79666 / 3290240', () => {
  const pos = Position.fromFen(START);
  assert.equal(perftOf(pos, 1), 44);
  assert.equal(perftOf(pos, 2), 1920);
  assert.equal(perftOf(pos, 3), 79666);
  assert.equal(perftOf(pos, 4), 3290240);
  assert.equal(pos.toFen(), START, 'perft leaves the position unchanged');
});

test('perft equals engine.js at depths 1-3 on the three reference positions', () => {
  for (const [name, fen] of Object.entries(REFERENCE_POSITIONS)) {
    const { board, turn } = boardOfFen(fen);
    const pos = Position.fromFen(fen);
    for (let depth = 1; depth <= 3; depth++) {
      assert.equal(perftOf(pos, depth), enginePerft(board, turn, depth), `${name} depth ${depth}`);
    }
  }
});

test('differential: legal moves and inCheck equal engine.js on every position of 100 seeded playouts', () => {
  let positions = 0, checks = 0, pawnBesideKing = 0;
  for (let seed = 1; seed <= 100; seed++) {
    // `game` plays the whole playout with make(), so every position is also checked after incremental updates.
    const game = Position.fromFen(START);
    for (const p of playout({ seed, plies: 200, pawnBias: 0.35 })) {
      const pos = Position.fromBoard(p.board, p.turn);
      const expected = p.moves.map(code).sort();
      const actual = pos.legalMoves().map(m => code(pos.toRef(m))).sort();
      assert.deepEqual(actual, expected, `legal moves differ at ${pos.toFen()}`);
      const inCheck = isInCheck(p.board, p.turn);
      assert.equal(pos.inCheck(), inCheck, `inCheck differs at ${pos.toFen()}`);
      if (p.move) assert.equal(game.make(game.fromRef(p.move)), true, `make refused a legal move before ${pos.toFen()}`);
      assert.equal(game.toFen(), pos.toFen());
      assert.equal(game.key, pos.key);
      assert.equal(game.lock, pos.lock);
      assert.deepEqual(game.legalMoves().map(m => code(game.toRef(m))).sort(), expected, `legal moves differ after make at ${pos.toFen()}`);
      assert.equal(game.inCheck(), inCheck, `inCheck differs after make at ${pos.toFen()}`);
      positions++;
      if (inCheck) checks++;
      // Count the positions that exercise the sideways pawn attack next to a king (the case perft from the start never reaches).
      const king = pos.kingSq[pos.side];
      const enemyPawn = (pos.side === RED ? 16 : 8) + PAWN;
      if (pos.squares[king - 1] === enemyPawn || pos.squares[king + 1] === enemyPawn) pawnBesideKing++;
    }
  }
  assert.ok(positions > 10000, `only ${positions} positions`);
  assert.ok(checks > 100, `only ${checks} positions in check`);
  assert.ok(pawnBesideKing > 20, `only ${pawnBesideKing} positions with an enemy pawn beside the king`);
});

test('make / unmake restore key, lock, vl, count, kingSq for every legal move of 500 positions', () => {
  const positions = playoutPositions(500, { seed: 7, stride: 3, plies: 150, pawnBias: 0.35 });
  assert.equal(positions.length, 500);
  const buf = new Int32Array(128);
  let made = 0, refused = 0;
  for (const p of positions) {
    const pos = Position.fromBoard(p.board, p.turn);
    const before = snapshot(pos);
    const squaresBefore = Array.from(pos.squares);
    const listsBefore = pieceLists(pos);
    assertPieceLists(pos, `at ${before.fen}`);
    const n = pos.generate(buf, false);
    for (let i = 0; i < n; i++) {
      const move = buf[i];
      if (!pos.make(move)) {
        // A refused move must leave nothing behind.
        refused++;
        assert.deepEqual(snapshot(pos), before, `refused move changed the position at ${before.fen}`);
        assert.deepEqual(pieceLists(pos), listsBefore, `refused move changed the piece lists at ${before.fen}`);
        continue;
      }
      made++;
      // The incremental state after the move equals the state of the same position built from scratch.
      const fresh = snapshot(Position.fromFen(pos.toFen()));
      assert.deepEqual(snapshot(pos), fresh, `incremental state is wrong after ${code(pos.toRef(move))} at ${before.fen}`);
      assertPieceLists(pos, `after ${code(pos.toRef(move))} at ${before.fen}`);
      pos.unmake();
      assert.deepEqual(snapshot(pos), before, `unmake did not restore ${before.fen}`);
      assert.deepEqual(pieceLists(pos), listsBefore, `unmake did not restore the piece lists at ${before.fen}`);
    }
    assert.deepEqual(Array.from(pos.squares), squaresBefore);
    // A null move flips the side and the hashes and nothing else.
    pos.makeNull();
    assert.equal(pos.side, before.side ^ 1);
    assert.notEqual(pos.key, before.key);
    assert.notEqual(pos.lock, before.lock);
    pos.unmakeNull();
    assert.deepEqual(snapshot(pos), before);
  }
  assert.ok(made > 10000 && refused > 100, `made ${made}, refused ${refused}`);
});

/**
 * Brute force for attackers(): the pieces of `by` that could capture a piece standing on (row, col), from the movement
 * rules on the 10x9 board, piece by piece. The flying general counts only when the square holds the other king.
 */
function bruteAttackers(board, row, col, by) {
  const out = [];
  const empty = (r, c) => board[r][c] === null;
  const between = (r1, c1, r2, c2) => {
    let count = 0;
    const dr = Math.sign(r2 - r1), dc = Math.sign(c2 - c1);
    for (let r = r1 + dr, c = c1 + dc; r !== r2 || c !== c2; r += dr, c += dc) if (!empty(r, c)) count++;
    return count;
  };
  const inPalace = (r, c, color) => c >= 3 && c <= 5 && (color === 'red' ? r >= 7 : r <= 2);
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== by || (r === row && c === col)) continue;
      const dr = row - r, dc = col - c;
      const straight = (dr === 0) !== (dc === 0);
      let hits = false;
      switch (piece.type) {
        case 'rook':
          hits = straight && between(r, c, row, col) === 0;
          break;
        case 'cannon':
          hits = straight && between(r, c, row, col) === 1;
          break;
        case 'horse':
          if (Math.abs(dr) === 2 && Math.abs(dc) === 1) hits = empty(r + Math.sign(dr), c);
          else if (Math.abs(dr) === 1 && Math.abs(dc) === 2) hits = empty(r, c + Math.sign(dc));
          break;
        case 'elephant':
          hits = Math.abs(dr) === 2 && Math.abs(dc) === 2 && empty(r + dr / 2, c + dc / 2) && (by === 'red' ? row >= 5 : row <= 4);
          break;
        case 'advisor':
          hits = Math.abs(dr) === 1 && Math.abs(dc) === 1 && inPalace(row, col, by);
          break;
        case 'king': {
          const target = board[row][col];
          hits = (Math.abs(dr) + Math.abs(dc) === 1 && inPalace(row, col, by))
            || (dc === 0 && target !== null && target.type === 'king' && target.color !== by && between(r, c, row, col) === 0);
          break;
        }
        default: {                                     // pawn
          const forward = by === 'red' ? -1 : 1;
          const crossed = by === 'red' ? r <= 4 : r >= 5;
          hits = (dc === 0 && dr === forward) || (crossed && dr === 0 && Math.abs(dc) === 1);
        }
      }
      if (hits) out.push(`${r},${c}`);
    }
  }
  return out.sort();
}

test('attackers(sq, side) equals a brute-force list on all squares of 100 positions', () => {
  const positions = playoutPositions(100, { seed: 21, stride: 7, plies: 180, pawnBias: 0.35 });
  let nonEmpty = 0;
  for (const p of positions) {
    const pos = Position.fromBoard(p.board, p.turn);
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 9; col++) {
        for (const [side, color] of [[RED, 'red'], [BLACK, 'black']]) {
          const actual = pos.attackers(sqOf(row, col), side).map(s => `${rowOf(s)},${colOf(s)}`).sort();
          const expected = bruteAttackers(p.board, row, col, color);
          assert.deepEqual(actual, expected, `attackers of (${row},${col}) by ${color} at ${pos.toFen()}`);
          if (expected.length > 0) nonEmpty++;
        }
      }
    }
  }
  assert.ok(nonEmpty > 5000);
});

test('attackers: advisor, elephant, adjacent king and the flying general on constructed boards', () => {
  // Black advisor on (1,4), black elephant on (2,4), black king on (0,4); red king on (9,4) with a red rook between the kings.
  const pos = Position.fromFen('4k4/4a4/4b4/9/9/4R4/9/9/9/4K4 w');
  const names = (sq, side) => pos.attackers(sq, side).map(s => TYPE_NAME[pos.squares[s] & 7]).sort();
  assert.deepEqual(names(sqOf(0, 3), BLACK), ['advisor', 'king']);        // palace corner: advisor diagonal, king beside it
  assert.deepEqual(names(sqOf(4, 2), BLACK), ['elephant']);               // two diagonal steps, eye (3,3) empty
  assert.deepEqual(names(sqOf(4, 6), BLACK), ['elephant']);
  assert.deepEqual(names(sqOf(2, 4), RED), ['rook']);                     // the rook reaches the elephant
  assert.deepEqual(names(sqOf(9, 4), BLACK), []);                         // the red rook blocks the kings' file
  // Open file between the kings: the flying general attacks the king's square only.
  const open = Position.fromFen('4k4/9/9/9/9/9/9/9/9/4K4 w');
  assert.deepEqual(open.attackers(sqOf(9, 4), BLACK), [sqOf(0, 4)]);
  assert.deepEqual(open.attackers(sqOf(0, 4), RED), [sqOf(9, 4)]);
  assert.deepEqual(open.attackers(sqOf(5, 4), BLACK), [], 'an empty square on the open file is not attacked by the king');
  assert.equal(open.attacked(sqOf(9, 4), BLACK), true, 'attacked() sees the facing king');
  // An elephant never attacks across the river, and a blocked eye stops it.
  const river = Position.fromFen('4k4/9/9/9/2b6/9/9/9/9/3K5 w');
  assert.deepEqual(river.attackers(sqOf(6, 4), BLACK), [], 'row 6 is across the river for a black elephant');
  assert.deepEqual(river.attackers(sqOf(2, 4), BLACK), [sqOf(4, 2)]);
  const blocked = Position.fromFen('4k4/9/9/3p5/2b6/9/9/9/9/3K5 w');
  assert.deepEqual(blocked.attackers(sqOf(2, 4), BLACK), [], 'the eye (3,3) is occupied');
});

test('attacked: a pawn attacks sideways only after it has crossed the river', () => {
  // (The advisor in front of each king keeps the king off the tested files: attacked() is the fast test for king squares
  // and also reports the attacker's king on an open file, see the last assertions.)
  // Red pawn on its own side of the river (row 5): forward only.
  const home = Position.fromFen('3k5/9/9/9/9/4P4/9/9/4A4/4K4 w');
  assert.equal(home.attacked(sqOf(4, 4), RED), true);
  assert.equal(home.attacked(sqOf(5, 3), RED), false);
  assert.equal(home.attacked(sqOf(5, 5), RED), false);
  assert.deepEqual(home.attackers(sqOf(5, 3), RED), []);
  // The same pawn one step further (row 4, across): forward and sideways, never backward.
  const across = Position.fromFen('3k5/9/9/9/4P4/9/9/9/4A4/4K4 w');
  assert.equal(across.attacked(sqOf(3, 4), RED), true);
  assert.equal(across.attacked(sqOf(4, 3), RED), true);
  assert.equal(across.attacked(sqOf(4, 5), RED), true);
  assert.equal(across.attacked(sqOf(5, 4), RED), false);
  assert.deepEqual(across.attackers(sqOf(4, 3), RED), [sqOf(4, 4)]);
  assert.deepEqual(across.attackers(sqOf(5, 4), RED), []);
  // Black pawns mirror this: (4,4) is at home, (5,4) is across.
  const blackHome = Position.fromFen('4k4/4a4/9/9/4p4/9/9/9/9/3K5 w');
  assert.equal(blackHome.attacked(sqOf(5, 4), BLACK), true);
  assert.equal(blackHome.attacked(sqOf(4, 3), BLACK), false);
  assert.equal(blackHome.attacked(sqOf(4, 5), BLACK), false);
  const blackAcross = Position.fromFen('4k4/4a4/9/9/9/4p4/9/9/9/3K5 w');
  assert.equal(blackAcross.attacked(sqOf(6, 4), BLACK), true);
  assert.equal(blackAcross.attacked(sqOf(5, 3), BLACK), true);
  assert.equal(blackAcross.attacked(sqOf(5, 5), BLACK), true);
  assert.equal(blackAcross.attacked(sqOf(4, 4), BLACK), false);
  // The fast test counts the attacker's king on an open file for any square; attackers() does so only for the other king.
  const lone = Position.fromFen('3k5/9/9/9/9/9/9/9/9/4K4 w');
  assert.equal(lone.attacked(sqOf(5, 4), RED), true);
  assert.deepEqual(lone.attackers(sqOf(5, 4), RED), []);
  // A king may not step beside a crossed enemy pawn: the black pawn on (8,3) attacks (9,3) forward and (8,4) sideways,
  // so the red king on (9,4) has only (9,5). The v1 engine agrees.
  const fen = '3k5/9/9/9/9/9/9/9/3p5/4K4 w';
  const palace = Position.fromFen(fen);
  assert.deepEqual(palace.legalMoves().map(m => code(palace.toRef(m))), ['9495']);
  const { board, turn } = boardOfFen(fen);
  assert.deepEqual(getLegalMoves(board, turn).map(code), ['9495']);
});

test('see: cannon takes a rook-protected horse is -50', () => {
  // The old test position: the black cannon takes a horse that the red rook protects.
  const old = Position.fromFen('4k4/9/9/9/c1P1N3R/4P4/9/9/9/4K4 b');
  assert.equal(old.see(mv(4, 0, 4, 4)), 400 - 450);
  // The opening: 炮八进七 takes the horse on (0,1), the rook on (0,0) takes back.
  const opening = Position.fromFen(START);
  assert.equal(opening.see(mv(7, 1, 0, 1)), -50);
  // Two rooks forked by a horse while defending each other: +500 for each capture.
  const fork = Position.fromFen('4k4/9/3r1r3/9/4N4/9/4P4/9/9/4K4 w');
  assert.equal(fork.see(mv(4, 4, 2, 3)), 900 - 400);
  assert.equal(fork.see(mv(4, 4, 2, 5)), 900 - 400);
  assert.equal(fork.toFen(), '4k4/9/3r1r3/9/4N4/9/4P4/9/9/4K4 w', 'see leaves the position unchanged');
});

test('see: free capture, pinned defender, two attackers vs one defender, flying-general recapture, illegal capture is -Infinity', () => {
  // Free capture: nothing defends the horse.
  assert.equal(Position.fromFen('4k4/9/9/9/4n4/9/9/9/4R4/3K5 w').see(mv(8, 4, 4, 4)), 400);
  // A crossed pawn is worth 200, an uncrossed one 100.
  assert.equal(Position.fromFen('3k5/9/9/9/9/4p4/9/9/4R4/4K4 w').see(mv(8, 4, 5, 4)), 200);
  assert.equal(Position.fromFen('3k5/9/9/9/4p4/9/9/9/4R4/4K4 w').see(mv(8, 4, 4, 4)), 100);

  // Defended horse: the rook on (1,4) takes back, 400 - 900.
  assert.equal(Position.fromFen('4k4/4r1n2/9/9/9/9/6R2/9/9/3K5 w').see(mv(6, 6, 1, 6)), 400 - 900);
  // Pinned defender: the same rook is pinned on the king's file by the red rook on (5,4), so the horse is free.
  assert.equal(Position.fromFen('4k4/4r1n2/9/9/9/4R4/6R2/9/9/3K5 w').see(mv(6, 6, 1, 6)), 400);

  // Two attackers (horse, rook) against one defender (horse) of a cannon.
  const two = Position.fromFen('3k5/9/3n5/9/R3c4/9/3N5/9/9/5K3 w');
  assert.equal(two.see(mv(6, 3, 4, 4)), 450, 'horse first: black gains nothing by taking back (400 - 400)');
  assert.equal(two.see(mv(4, 0, 4, 4)), 450 - (900 - 400), 'rook first: horse takes rook, horse takes horse');
  // One attacker against the same defender.
  assert.equal(Position.fromFen('3k5/9/3n5/9/R3c4/9/9/9/9/5K3 w').see(mv(4, 0, 4, 4)), 450 - 900);

  // Flying general: the defending horse is the only piece between the kings, so it cannot take back.
  assert.equal(Position.fromFen('4k4/9/9/4n4/9/5c2R/9/9/9/4K4 w').see(mv(5, 8, 5, 5)), 450);
  // With the red king off the file the horse does take back.
  assert.equal(Position.fromFen('4k4/9/9/4n4/9/5c2R/9/9/9/3K5 w').see(mv(5, 8, 5, 5)), 450 - 900);

  // Illegal capture: the red rook is pinned on its king's file by the black rook.
  const pinned = Position.fromFen('3k5/9/9/4r4/9/9/9/4R2n1/9/4K4 w');
  assert.equal(pinned.see(mv(7, 4, 7, 7)), -Infinity);
  assert.equal(pinned.see(mv(7, 4, 3, 4)), 900, 'along the pin line the capture is legal and free');
  // Not a move of the side to move at all.
  assert.equal(pinned.see(mv(3, 4, 7, 4)), -Infinity);
  assert.equal(pinned.see(mv(5, 5, 5, 6)), -Infinity);
  // A quiet move to an attacked square loses the piece that moved.
  assert.equal(Position.fromFen('4k4/4r1n2/9/9/9/9/6R2/9/9/3K5 w').see(mv(6, 6, 6, 4)), -900);
});

/** The colour-swapped, vertically mirrored board and side. */
function swapColours(board, turn) {
  const out = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      const piece = board[row][col];
      if (piece) out[9 - row][col] = { ...piece, color: piece.color === 'red' ? 'black' : 'red' };
    }
  }
  return { board: out, turn: turn === 'red' ? 'black' : 'red' };
}
/** The left-right mirrored board. */
const mirrorFiles = board => board.map(row => row.slice().reverse());

test('evaluate is symmetric under colour swap and mirror on 100 positions', () => {
  const positions = playoutPositions(100, { seed: 31, stride: 5, plies: 160, pawnBias: 0.25 });
  let nonTrivial = 0;
  for (const p of positions) {
    const pos = Position.fromBoard(p.board, p.turn);
    const value = pos.evaluate();
    const swapped = swapColours(p.board, p.turn);
    assert.equal(Position.fromBoard(swapped.board, swapped.turn).evaluate(), value, `colour swap at ${pos.toFen()}`);
    assert.equal(Position.fromBoard(mirrorFiles(p.board), p.turn).evaluate(), value, `file mirror at ${pos.toFen()}`);
    // The same position with the other side to move: the score changes sign around the tempo bonus of 3.
    const other = Position.fromBoard(p.board, p.turn === 'red' ? 'black' : 'red');
    assert.equal(other.evaluate() + value, 6);
    if (Math.abs(value - 3) > 50) nonTrivial++;
  }
  assert.ok(nonTrivial > 30, 'the sample must contain unbalanced positions');
});

test('evaluate: piece-square values of A2.3 at sample squares, and the guard term', () => {
  // vl[side] = sum of the piece-square values; a bare king on its start square is worth 10.
  const bare = Position.fromFen('4k4/9/9/9/9/9/9/9/9/4K4 w');
  assert.deepEqual(Array.from(bare.vl), [10, 10]);
  assert.equal(bare.evaluate(), 3);
  /**
   * Piece-square value of one red piece (FEN letter) on (row, col), read from vl[RED] on a board that holds only that piece,
   * the red king on (9,4) (worth 10) and the black king on (0,3).
   */
  const red = (letter, row, col) => {
    const cells = Array.from({ length: 10 }, () => Array(9).fill(''));
    cells[0][3] = 'k';
    cells[9][4] = 'K';
    assert.equal(cells[row][col], '', 'the sample square must be free');
    cells[row][col] = letter;
    const placement = cells.map(line => line.map(cell => cell || '1').join('').replace(/1+/g, run => String(run.length))).join('/');
    return Position.fromFen(`${placement} w`).vl[RED] - 10;
  };
  // king: 10 on (9,4), 4 elsewhere on row 9, -8 on row 8, -20 on row 7
  assert.equal(Position.fromFen('4k4/9/9/9/9/9/9/9/9/3K5 w').vl[RED], 4);
  assert.equal(Position.fromFen('3k5/9/9/9/9/9/9/9/4K4/9 w').vl[RED], -8);
  assert.equal(Position.fromFen('3k5/9/9/9/9/9/9/4K4/9/9 w').vl[RED], -20);
  // advisor and elephant
  assert.equal(red('A', 8, 4), 206);
  assert.equal(red('A', 9, 3), 200);
  assert.equal(red('B', 7, 4), 208);
  assert.equal(red('B', 7, 0), 194);
  assert.equal(red('B', 9, 2), 200);
  // horse: 400 + cen*8 + min(adv,7)*6 - edge 16 - back rank 14 - 窝心马 40 + outpost 16
  assert.equal(red('N', 9, 1), 400 + 8 - 14);
  assert.equal(red('N', 8, 4), 400 + 32 + 6 - 40);
  assert.equal(red('N', 2, 4), 400 + 32 + 42 + 16);
  assert.equal(red('N', 5, 0), 400 + 0 + 24 - 16);
  assert.equal(red('N', 0, 2), 400 + 16 + 42);
  // rook: 900 + cen*3 + adv*2 - back rank 10 + 10 on adv 4..8
  assert.equal(red('R', 9, 0), 900 - 10);
  assert.equal(red('R', 4, 4), 900 + 12 + 10 + 10);
  assert.equal(red('R', 0, 8), 900 + 18);
  // cannon: 450 + (central file, adv 2..4: 18, else cen*3) + corner 12 + min(adv,5)*2
  assert.equal(red('C', 7, 1), 450 + 3 + 4);
  assert.equal(red('C', 7, 4), 450 + 18 + 4);
  assert.equal(red('C', 0, 0), 450 + 0 + 12 + 10);
  assert.equal(red('C', 2, 4), 450 + 12 + 10);
  // pawn: 100 + central 6 from adv 3 + (adv >= 5: 70 + cen*8 + (adv-5)*10) + 30 on adv >= 7, files 2..6 - 80 on the last rank
  assert.equal(red('P', 6, 0), 100);
  assert.equal(red('P', 6, 4), 106);
  assert.equal(red('P', 4, 4), 100 + 6 + 70 + 32);
  assert.equal(red('P', 4, 0), 100 + 70);
  assert.equal(red('P', 2, 4), 100 + 6 + 70 + 32 + 20 + 30);
  assert.equal(red('P', 0, 4), 100 + 6 + 70 + 32 + 40 + 30 - 80);
  // Black uses the vertically mirrored square.
  assert.equal(Position.fromFen('4k4/9/1c7/9/9/9/9/9/9/4K4 w').vl[BLACK], 10 + 457);

  // guard(s) = -4 * missing(s) * pressure(s); evaluate = vl[side] - vl[other] + guard(side) - guard(other) + 3.
  // Red: king, rook, cannon, horse and no guards. Black: king, two advisors, one elephant.
  const pos = Position.fromFen('3aka3/9/4b4/9/9/9/9/1C7/9/RN2K4 w');
  const vlRed = 10 + 890 + 457 + 394, vlBlack = 10 + 200 + 200 + 208;
  assert.deepEqual(Array.from(pos.vl), [vlRed, vlBlack]);
  const guardRed = -4 * 4 * 0;                       // four guards missing, but black has no rook, cannon or horse
  const guardBlack = -4 * 1 * (2 * 1 + 1 + 1);       // one elephant missing against a rook, a cannon and a horse
  assert.equal(pos.evaluate(), vlRed - vlBlack + guardRed - guardBlack + 3);
  assert.equal(Position.fromFen('3aka3/9/4b4/9/9/9/9/1C7/9/RN2K4 b').evaluate(), vlBlack - vlRed + guardBlack - guardRed + 3);
  // The start position is balanced.
  assert.equal(Position.fromFen(START).evaluate(), 3);
});

test('FEN: reads and writes placement and side; malformed input throws RangeError', () => {
  const pos = Position.fromFen(START);
  assert.equal(pos.side, RED);
  assert.equal(pos.toFen(), START);
  assert.deepEqual(Array.from(pos.kingSq), [sqOf(9, 4), sqOf(0, 4)]);
  assert.deepEqual(Array.from(pos.count[RED]), [1, 2, 2, 2, 2, 2, 5]);
  assert.deepEqual(Array.from(pos.count[BLACK]), [1, 2, 2, 2, 2, 2, 5]);
  assert.equal(pos.squares[sqOf(9, 0)], 8 + ROOK);
  assert.equal(pos.squares[sqOf(0, 1)], 16 + HORSE);
  assert.equal(pos.squares[sqOf(7, 7)], 8 + CANNON);
  assert.equal(pos.squares[sqOf(3, 4)], 16 + PAWN);
  assert.equal(pos.squares[sqOf(9, 3)], 8 + ADVISOR);
  assert.equal(pos.squares[sqOf(0, 2)], 16 + ELEPHANT);
  assert.equal(pos.squares[sqOf(9, 4)], 8 + KING);
  // Extra fields are ignored; E / H letters and the side letter r are accepted.
  const six = Position.fromFen(`${START} - - 0 1`);
  assert.equal(six.toFen(), START);
  assert.equal(six.key, pos.key);
  const letters = Position.fromFen('rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR r');
  assert.equal(letters.toFen(), START);
  assert.equal(letters.lock, pos.lock);
  // The side to move is part of the hash.
  const black = Position.fromFen(START.replace(' w', ' b'));
  assert.equal(black.side, BLACK);
  assert.notEqual(black.key, pos.key);
  assert.notEqual(black.lock, pos.lock);
  // Round trip through fromBoard on playout positions.
  for (const p of playoutPositions(200, { seed: 3, stride: 4, plies: 120 })) {
    const a = Position.fromBoard(p.board, p.turn);
    const b = Position.fromFen(a.toFen());
    assert.deepEqual(snapshot(b), snapshot(a));
    assert.deepEqual(Array.from(b.squares), Array.from(a.squares));
  }
  const malformed = [
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9 w',                  // nine rows
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR/9 w',      // eleven rows
    'rnbakabnr/8/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',        // a row that sums to 8
    'rnbakabnr/9/1c5c2/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',        // a row that sums to 10
    'rnbakabnrr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',       // ten pieces in a row
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBQKABNR w',        // unknown letter
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBA1ABNR w',        // no red king
    'rnbakabnr/9/1c5c1/p1p1p1p1p/4k4/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',      // two black kings
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR x',        // unknown side letter
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR',          // no side letter
    '',
  ];
  for (const fen of malformed) assert.throws(() => Position.fromFen(fen), RangeError, `accepted "${fen}"`);
  // fromBoard applies the same king rule.
  const { board } = boardOfFen(START);
  board[9][4] = null;
  assert.throws(() => Position.fromBoard(board, 'red'), RangeError);
});

test('moves: the helpers and toRef / fromRef are inverse; generate with capturesOnly lists exactly the captures', () => {
  assert.equal(sqOf(0, 0), 0x33);
  assert.equal(sqOf(9, 8), 0xcb);
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      const sq = sqOf(row, col);
      assert.equal(rowOf(sq), row);
      assert.equal(colOf(sq), col);
      assert.equal(sq < 0x80, row <= 4, 'the river test of A2.1');
    }
  }
  const move = mkMove(sqOf(7, 7), sqOf(7, 4));
  assert.equal(mvFrom(move), sqOf(7, 7));
  assert.equal(mvTo(move), sqOf(7, 4));
  assert.ok(move > 0 && move < 65536, 'a move fits 16 bits');
  const pos = Position.fromFen(START);
  assert.deepEqual(pos.toRef(move), { from: { row: 7, col: 7 }, to: { row: 7, col: 4 } });
  assert.equal(pos.fromRef({ from: { row: 7, col: 7 }, to: { row: 7, col: 4 } }), move);
  assert.deepEqual(TYPE_NAME, ['king', 'advisor', 'elephant', 'horse', 'rook', 'cannon', 'pawn']);

  const all = new Int32Array(128), captures = new Int32Array(128);
  for (const p of playoutPositions(60, { seed: 5, stride: 6, plies: 150 })) {
    const position = Position.fromBoard(p.board, p.turn);
    const n = position.generate(all, false), k = position.generate(captures, true);
    const expected = Array.from(all.subarray(0, n)).filter(m => position.squares[mvTo(m)] !== 0).sort((a, b) => a - b);
    assert.deepEqual(Array.from(captures.subarray(0, k)).sort((a, b) => a - b), expected);
    assert.ok(n < 128);
    // isLegal agrees with legalMoves for every generated move, and refuses anything that was not generated.
    const legal = new Set(position.legalMoves());
    for (let i = 0; i < n; i++) assert.equal(position.isLegal(all[i]), legal.has(all[i]));
    assert.equal(position.isLegal(0), false);
    assert.equal(position.isLegal(mkMove(sqOf(4, 4), sqOf(4, 4))), false);
  }
  // No flying-general capture is generated: with the kings facing, the king has only its palace steps.
  const facing = Position.fromFen('4k4/9/9/9/9/9/9/9/9/4K4 w');
  const n = facing.generate(all, false);
  assert.deepEqual(Array.from(all.subarray(0, n)).map(m => code(facing.toRef(m))).sort(), ['9484', '9493', '9495']);
});

test('repStatus: 0 without a repetition, 1 on a cycle, +2 / +4 for a perpetual check, stopped by a capture or a null move', () => {
  // Rook and king shuffle without check: after four plies the start position recurs.
  const quiet = Position.fromFen('4k4/9/9/9/9/9/9/9/R8/3K5 w');
  const cycle = [mv(8, 0, 7, 0), mv(0, 4, 1, 4), mv(7, 0, 8, 0), mv(1, 4, 0, 4)];
  for (let i = 0; i < 3; i++) {
    assert.equal(quiet.make(cycle[i]), true);
    assert.equal(quiet.repStatus(), 0, `no repetition after ply ${i + 1}`);
  }
  assert.equal(quiet.make(cycle[3]), true);
  assert.equal(quiet.repStatus(), 1);
  // A null move in between hides the cycle.
  quiet.makeNull();
  quiet.makeNull();
  assert.equal(quiet.repStatus(), 0);
  quiet.unmakeNull();
  quiet.unmakeNull();
  assert.equal(quiet.repStatus(), 1);
  for (let i = 0; i < 4; i++) quiet.unmake();
  assert.equal(quiet.repStatus(), 0);
  assert.equal(quiet.toFen(), '4k4/9/9/9/9/9/9/9/R8/3K5 w');

  // Red checks on every move: rook (1,8) <-> (0,8), king (0,4) <-> (1,4).
  const perpetual = Position.fromFen('4k4/8R/9/9/9/9/9/9/9/3K5 w');
  const checks = [mv(1, 8, 0, 8), mv(0, 4, 1, 4), mv(0, 8, 1, 8), mv(1, 4, 0, 4)];
  for (const m of checks) assert.equal(perpetual.make(m), true);
  assert.equal(perpetual.repStatus(), 3, 'red to move, and red checked on each of its moves');
  assert.equal(perpetual.make(checks[0]), true);
  assert.equal(perpetual.inCheck(), true);
  assert.equal(perpetual.repStatus(), 5, 'black to move, and its opponent checked on each of its moves');

  // A capture inside the cycle resets the scan: the position after the capture has not occurred before.
  const capture = Position.fromFen('4k4/9/9/9/9/9/9/p8/R8/3K5 w');
  for (const m of [mv(8, 0, 7, 0), mv(0, 4, 1, 4), mv(7, 0, 8, 0), mv(1, 4, 0, 4)]) assert.equal(capture.make(m), true);
  assert.equal(capture.repStatus(), 0, 'the pawn is gone, so the start position did not recur');
  for (const m of [mv(8, 0, 7, 0), mv(0, 4, 1, 4), mv(7, 0, 8, 0), mv(1, 4, 0, 4)]) assert.equal(capture.make(m), true);
  assert.equal(capture.repStatus(), 1, 'the cycle after the capture is seen');
});

test('repStatus equals a FEN-history model on random walks with take-backs, shuffles, captures and null moves', () => {
  // The model keeps its own stack of FENs and knows nothing about hashes or the undo stacks: walking back over plain
  // moves (a capture or a null move ends the walk), the current FEN recurs at a position with the same side to move.
  const rng = mulberry32(77);
  const seen = { 0: 0, 1: 0, 3: 0, 5: 0, 7: 0 };
  for (let walk = 0; walk < 150; walk++) {
    const pos = Position.fromFen(START);
    /** @type {{kind: 'move'|'capture'|'null', move: number, gaveCheck: boolean}[]} */
    const stack = [];
    const fens = [pos.toFen()];                       // fens[i] = position before stack[i]; the last one is the current position
    const takeBack = () => {
      const top = stack.pop();
      if (top.kind === 'null') pos.unmakeNull();
      else pos.unmake();
      fens.pop();
    };
    for (let step = 0; step < 300; step++) {
      const r = rng();
      // The legal moves come from a copy, so that `pos` sees exactly the makes and unmakes of the walk and nothing else.
      const moves = Position.fromFen(fens[fens.length - 1]).legalMoves();
      if (stack.length > 0 && (r < 0.12 || moves.length === 0)) takeBack();
      else if (moves.length === 0) break;
      else if (r < 0.16 && !pos.inCheck()) {
        pos.makeNull();
        stack.push({ kind: 'null', move: 0, gaveCheck: false });
        fens.push(pos.toFen());
      } else {
        // Often take the piece moved two plies ago back to where it came from, so that positions recur.
        let move = moves[Math.floor(rng() * moves.length)];
        if (rng() < 0.6 && stack.length >= 2 && stack[stack.length - 2].kind === 'move') {
          const earlier = stack[stack.length - 2].move;
          const back = mkMove(mvTo(earlier), mvFrom(earlier));
          if (moves.includes(back)) move = back;
        }
        const capture = pos.squares[mvTo(move)] !== 0;
        assert.equal(pos.make(move), true);
        stack.push({ kind: capture ? 'capture' : 'move', move, gaveCheck: pos.inCheck() });
        fens.push(pos.toFen());
      }
      let expected = 0;
      const current = fens[fens.length - 1];
      let selfChecks = true, otherChecks = true;
      for (let i = stack.length - 1, own = false; i >= 0 && stack[i].kind === 'move'; i--, own = !own) {
        if (!own) otherChecks = otherChecks && stack[i].gaveCheck;
        else {
          selfChecks = selfChecks && stack[i].gaveCheck;
          if (fens[i] === current) {
            expected = 1 + (selfChecks ? 2 : 0) + (otherChecks ? 4 : 0);
            break;
          }
        }
      }
      assert.equal(pos.repStatus(), expected, `walk ${walk} step ${step} at ${current}`);
      seen[expected]++;
    }
    while (stack.length > 0) takeBack();
    assert.equal(pos.repStatus(), 0);
    assert.equal(pos.toFen(), START);
  }
  assert.ok(seen[0] > 20000 && seen[1] > 5000 && seen[3] + seen[5] >= 4, `sample: ${JSON.stringify(seen)}`);
});

test('seedHistory: game positions count for repetition exactly like moves made on the board', () => {
  const fens = [
    '4k4/8R/9/9/9/9/9/9/9/3K5 w',
    '4k3R/9/9/9/9/9/9/9/9/3K5 b',
    '8R/4k4/9/9/9/9/9/9/9/3K5 w',
    '9/4k3R/9/9/9/9/9/9/9/3K5 b',
  ];
  const moves = [mv(1, 8, 0, 8), mv(0, 4, 1, 4), mv(0, 8, 1, 8), mv(1, 4, 0, 4)];
  // Played on the board.
  const played = Position.fromFen(fens[0]);
  for (let i = 0; i < 4; i++) {
    assert.equal(played.toFen(), fens[i], 'the FEN list is the game');
    played.make(moves[i]);
  }
  assert.equal(played.toFen(), fens[0]);
  // Seeded from the FENs.
  const seeded = Position.fromFen(fens[0]);
  assert.equal(seeded.repStatus(), 0);
  seeded.seedHistory(fens);
  assert.equal(seeded.repStatus(), played.repStatus());
  assert.equal(seeded.repStatus(), 3);
  assert.equal(seeded.inCheck(), false);
  assert.equal(seeded.key, played.key, 'seeding does not change the position');
  assert.equal(seeded.toFen(), fens[0]);
  // repAt (internal, read by search.js) tells where the earlier occurrence is: in the game history or on the path made here.
  assert.equal(seeded.repAt, 0);
  assert.ok(seeded.repAt < seeded.seeded, 'the earlier occurrence is a game position');
  assert.equal(played.repAt, 0);
  assert.ok(played.repAt >= played.seeded, 'the earlier occurrence was reached with make()');
  // One more move on both.
  played.make(moves[0]);
  seeded.make(moves[0]);
  assert.equal(seeded.repStatus(), 5);
  assert.equal(seeded.repStatus(), played.repStatus());
  assert.equal(seeded.inCheck(), true);
  assert.equal(seeded.repAt, 1, 'the position after the first check, still inside the history');
  assert.ok(seeded.repAt < seeded.seeded);
  seeded.unmake();
  // A second call replaces the first; an empty history clears it.
  seeded.seedHistory(fens.slice(2));
  assert.equal(seeded.repStatus(), 0, 'the start position is no longer in the history');
  seeded.seedHistory([]);
  assert.equal(seeded.repStatus(), 0);
  seeded.seedHistory(fens);
  assert.equal(seeded.repStatus(), 3);
  // Not allowed once a move has been made; a malformed FEN is a RangeError.
  seeded.make(moves[0]);
  assert.throws(() => seeded.seedHistory(fens), Error);
  seeded.unmake();
  assert.throws(() => seeded.seedHistory(['not a fen']), RangeError);
  assert.equal(seeded.repStatus(), 3, 'a failed call leaves the earlier history in place');
});

test('hashing: transpositions give equal key and lock; different positions differ', () => {
  const a = Position.fromFen(START), b = Position.fromFen(START);
  // 炮二平五 马8进7 马八进七 and 马八进七 马8进7 炮二平五 reach the same position.
  for (const m of [mv(7, 7, 7, 4), mv(0, 7, 2, 6), mv(9, 1, 7, 2)]) assert.equal(a.make(m), true);
  for (const m of [mv(9, 1, 7, 2), mv(0, 7, 2, 6), mv(7, 7, 7, 4)]) assert.equal(b.make(m), true);
  assert.equal(a.toFen(), b.toFen());
  assert.equal(a.key, b.key);
  assert.equal(a.lock, b.lock);
  assert.deepEqual(Array.from(a.vl), Array.from(b.vl));
  // Keys of the positions of one playout are all different (side to move included).
  const seen = new Map();
  for (const p of playout({ seed: 9, plies: 150 })) {
    const pos = Position.fromBoard(p.board, p.turn);
    const fen = pos.toFen();
    const id = `${pos.key}:${pos.lock}`;
    if (seen.has(id)) assert.equal(seen.get(id), fen, 'two different positions share key and lock');
    seen.set(id, fen);
  }
  assert.ok(seen.size > 100);
});

test('exports: exactly the names of Appendix A2.6, and every Position member it lists', async () => {
  const module = await import('../../../src/core/position.js');
  assert.deepEqual(Object.keys(module).sort(), [
    'ADVISOR', 'BLACK', 'CANNON', 'ELEPHANT', 'HORSE', 'KING', 'PAWN', 'Position', 'RED', 'ROOK', 'TYPE_NAME',
    'colOf', 'mkMove', 'mvFrom', 'mvTo', 'rowOf', 'sqOf',
  ]);
  assert.deepEqual([RED, BLACK], [0, 1]);
  assert.deepEqual([KING, ADVISOR, ELEPHANT, HORSE, ROOK, CANNON, PAWN], [0, 1, 2, 3, 4, 5, 6]);
  for (const name of ['fromFen', 'fromBoard']) assert.equal(typeof Position[name], 'function', name);
  const methods = ['toFen', 'seedHistory', 'generate', 'make', 'unmake', 'makeNull', 'unmakeNull', 'legalMoves', 'isLegal', 'inCheck',
    'attacked', 'attackers', 'see', 'evaluate', 'repStatus', 'toRef', 'fromRef'];
  for (const name of methods) assert.equal(typeof Position.prototype[name], 'function', name);
  const pos = Position.fromFen(START);
  for (const field of ['side', 'squares', 'key', 'lock', 'kingSq', 'count']) assert.ok(pos[field] !== undefined, field);
  assert.ok(pos.squares instanceof Uint8Array && pos.squares.length === 256);
});
