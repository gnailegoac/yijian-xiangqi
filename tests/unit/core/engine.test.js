import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialBoard, opposite, pieceLabel, getLegalMoves, getPieceLegalMoves, applyMove, isInCheck, getGameStatus, moveToNotation } from '../../../src/core/engine.js';

let nextPieceId = 0;
const piece = (type, color = 'red') => ({ id: `${color}-${type}-${nextPieceId++}`, type, color });
function emptyBoard() {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  board[9][4] = piece('king');
  board[0][4] = piece('king', 'black');
  board[5][4] = piece('pawn');
  return board;
}
const destinations = (board, row, col) => getPieceLegalMoves(board, row, col).map(m => `${m.to.row},${m.to.col}`);
const moveTo = (board, row, col, toRow, toCol) => getPieceLegalMoves(board, row, col).find(m => m.to.row === toRow && m.to.col === toCol);

test('initial board has 32 unique pieces and 44 legal opening moves for either side', () => {
  const board = createInitialBoard();
  const pieces = board.flat().filter(Boolean);
  assert.equal(board.length, 10);
  assert.equal(pieces.length, 32);
  assert.equal(new Set(pieces.map(p => p.id)).size, 32);
  assert.equal(getLegalMoves(board, 'red').length, 44);
  assert.equal(getLegalMoves(board, 'black').length, 44);
  assert.equal(isInCheck(board, 'red'), false);
  assert.equal(isInCheck(board, 'black'), false);
});

test('horse legs block both associated jumps', () => {
  const board = emptyBoard();
  board[7][2] = piece('horse');
  assert(destinations(board, 7, 2).includes('5,1'));
  assert(destinations(board, 7, 2).includes('5,3'));
  board[6][2] = piece('pawn');
  assert(!destinations(board, 7, 2).includes('5,1'));
  assert(!destinations(board, 7, 2).includes('5,3'));
  assert(destinations(board, 7, 2).includes('6,0'));
});

test('elephants cannot cross the river and cannot jump a blocked eye', () => {
  const board = emptyBoard();
  board[5][2] = piece('elephant');
  assert(!destinations(board, 5, 2).includes('3,0'));
  assert(destinations(board, 5, 2).includes('7,0'));
  board[6][1] = piece('pawn');
  assert(!destinations(board, 5, 2).includes('7,0'));
  board[4][6] = piece('elephant', 'black');
  assert(!destinations(board, 4, 6).includes('6,8'));
  assert(destinations(board, 4, 6).includes('2,8'));
});

test('advisor and king remain inside their own palace', () => {
  const board = emptyBoard();
  board[9][3] = piece('advisor');
  assert.deepEqual(destinations(board, 9, 3), ['8,4']);
  board[9][4] = null;
  board[8][3] = piece('king');
  const squares = destinations(board, 8, 3);
  assert(!squares.includes('8,2'));
  assert(squares.includes('7,3'));
  assert(squares.includes('8,4'));
});

test('cannon needs exactly one screen to capture and cannot move past the screen', () => {
  const board = emptyBoard();
  board[7][0] = piece('cannon');
  board[3][0] = piece('rook', 'black');
  assert(!destinations(board, 7, 0).includes('3,0'));
  assert(destinations(board, 7, 0).includes('4,0'));
  board[5][0] = piece('pawn');
  assert(destinations(board, 7, 0).includes('3,0'));
  assert(!destinations(board, 7, 0).includes('5,0'));
  assert(!destinations(board, 7, 0).includes('4,0'));
  board[4][0] = piece('pawn', 'black');
  assert(!destinations(board, 7, 0).includes('3,0'));
  assert(destinations(board, 7, 0).includes('4,0'));
});

test('rook cannot jump and cannot capture its own piece', () => {
  const board = emptyBoard();
  board[7][0] = piece('rook');
  board[5][0] = piece('pawn');
  assert(destinations(board, 7, 0).includes('6,0'));
  assert(!destinations(board, 7, 0).includes('5,0'));
  assert(!destinations(board, 7, 0).includes('4,0'));
  board[7][3] = piece('pawn', 'black');
  assert(destinations(board, 7, 0).includes('7,3'));
  assert(!destinations(board, 7, 0).includes('7,4'));
});

test('red and black pawns move forward and gain sideways moves after crossing', () => {
  const board = emptyBoard();
  board[6][0] = piece('pawn');
  assert.deepEqual(destinations(board, 6, 0), ['5,0']);
  board[4][2] = piece('pawn');
  assert.deepEqual(new Set(destinations(board, 4, 2)), new Set(['3,2', '4,1', '4,3']));
  board[3][8] = piece('pawn', 'black');
  assert.deepEqual(destinations(board, 3, 8), ['4,8']);
  board[5][6] = piece('pawn', 'black');
  assert.deepEqual(new Set(destinations(board, 5, 6)), new Set(['6,6', '5,5', '5,7']));
});

test('generals may not face one another and the intervening piece is pinned', () => {
  const board = emptyBoard();
  board[5][4] = piece('rook');
  assert(!destinations(board, 5, 4).includes('5,3'));
  assert(destinations(board, 5, 4).includes('4,4'));
  board[5][4] = null;
  assert.equal(isInCheck(board, 'red'), true);
  assert.equal(isInCheck(board, 'black'), true);
});

test('a side in check can only make moves that remove the check', () => {
  const board = emptyBoard();
  board[4][4] = piece('rook', 'black');
  board[5][4] = null;
  board[7][0] = piece('rook');
  assert.equal(isInCheck(board, 'red'), true);
  const legal = getLegalMoves(board, 'red');
  assert(legal.length > 0);
  for (const move of legal) assert.equal(isInCheck(applyMove(board, move), 'red'), false);
  assert(!destinations(board, 7, 0).includes('6,0'));
  assert(destinations(board, 7, 0).includes('7,4'));
});

test('applyMove preserves the old board and captures the destination piece', () => {
  const board = createInitialBoard();
  const move = moveTo(board, 7, 1, 0, 1);
  assert(move);
  assert.equal(move.captured.type, 'horse');
  const original = JSON.stringify(board);
  const next = applyMove(board, move);
  assert.equal(JSON.stringify(board), original);
  assert.equal(next[7][1], null);
  assert.equal(next[0][1].type, 'cannon');
  assert.notEqual(next, board);
  assert.notEqual(next[0], board[0]);
});

test('checkmate ends the game with the opponent as winner', () => {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  board[0][4] = piece('king', 'black');
  board[9][4] = piece('king');
  board[1][4] = piece('rook');
  board[1][3] = piece('rook');
  board[1][5] = piece('rook');
  assert.deepEqual(getGameStatus(board, 'black'), { over: true, winner: 'red', reason: 'checkmate', check: true });
});

test('stalemate is a loss in Chinese chess', () => {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  board[0][4] = piece('king', 'black');
  board[9][3] = piece('king');
  board[1][0] = piece('rook');
  board[2][3] = piece('rook');
  board[2][5] = piece('rook');
  assert.equal(isInCheck(board, 'black'), false);
  assert.deepEqual(getGameStatus(board, 'black'), { over: true, winner: 'red', reason: 'stalemate', check: false });
});

test('missing king yields a terminal status', () => {
  const board = createInitialBoard();
  board[0][4] = null;
  assert.deepEqual(getGameStatus(board, 'black'), { over: true, winner: 'red', reason: 'king-captured', check: true });
});

test('notation uses each side’s perspective and Chinese piece labels', () => {
  const board = createInitialBoard();
  assert.equal(moveToNotation(board, moveTo(board, 9, 1, 7, 2)), '马八进七');
  assert.equal(moveToNotation(board, moveTo(board, 7, 1, 7, 4)), '炮八平五');
  assert.equal(moveToNotation(board, moveTo(board, 0, 1, 2, 2)), '马2进3');
  assert.equal(pieceLabel(board[9][4]), '帅');
  assert.equal(pieceLabel(board[0][4]), '将');
  assert.equal(opposite('red'), 'black');
});

// ---- Additions of contract section 4.2 (package B1): FEN, position keys, checkers, repetition and the draw rules. ----
// The 14 tests above are the v1 tests, unchanged. Imports are hoisted, so the extra ones can stand here.
import {
  START_FEN, NO_CAPTURE_DRAW_PLIES, MAX_PLIES, boardToFen, fenToBoard, positionKey, checkers, plyRecord, repetition, judgeMove,
  playableMoves, drawStatus,
} from '../../../src/core/engine.js';
import { playoutPositions } from '../../helpers/playout.js';
import { COACH_EXAMPLE_POSITIONS, V1_COACH_FIXTURES } from '../../helpers/positions.js';

/** A board holding exactly the listed pieces: [type, color, row, col]. */
function boardWith(list) {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const [type, color, row, col] of list) board[row][col] = piece(type, color);
  return board;
}
/** MoveRef from a four-digit code "frfctrtc". */
const ref = code => ({ from: { row: Number(code[0]), col: Number(code[1]) }, to: { row: Number(code[2]), col: Number(code[3]) } });
/** Type and colour of every point, without ids. */
const layout = board => board.map(row => row.map(p => (p ? `${p.color} ${p.type}` : null)));
const sortSquares = squares => squares.map(sq => `${sq.row},${sq.col}`).sort();
const hasMove = (moves, code) => moves.some(m => `${m.from.row}${m.from.col}${m.to.row}${m.to.col}` === code);

/**
 * Plays the coded moves from a position, checking that each one is legal, and keeps what the draw rules need.
 * `verdicts[i]` is judgeMove for move i, asked in the position the move was played in.
 */
function playGame(board, turn, codes) {
  return playOn({ board, turn, startKey: positionKey(board, turn), log: [], verdicts: [] }, codes);
}
function playOn(game, codes) {
  for (const code of codes) {
    assert.ok(hasMove(getLegalMoves(game.board, game.turn), code), `test move ${code} is legal`);
    const move = ref(code);
    game.verdicts.push(judgeMove(game.startKey, game.log, game.board, move));
    game.log.push(plyRecord(game.board, move));
    game.board = applyMove(game.board, move);
    game.turn = opposite(game.turn);
  }
  return game;
}

function perft(board, turn, depth) {
  const moves = getLegalMoves(board, turn);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) nodes += perft(applyMove(board, move), opposite(turn), depth - 1);
  return nodes;
}

test('perft from the start position is 44 / 1920 / 79666 for depth 1-3', () => {
  const board = createInitialBoard();
  assert.equal(perft(board, 'red', 1), 44);
  assert.equal(perft(board, 'red', 2), 1920);
  assert.equal(perft(board, 'red', 3), 79666);
});

test('FEN: boardToFen(createInitialBoard(), \'red\') === START_FEN and fenToBoard round-trips to createInitialBoard()', () => {
  assert.equal(START_FEN, 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w');
  assert.equal(boardToFen(createInitialBoard(), 'red'), START_FEN);
  assert.equal(boardToFen(createInitialBoard(), 'black'), 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b');
  const parsed = fenToBoard(START_FEN);
  assert.deepEqual(parsed.board, createInitialBoard());     // piece ids included
  assert.equal(parsed.turn, 'red');
  assert.equal(parsed.halfmove, 0);
  assert.equal(parsed.fullmove, 1);
});

test('FEN: piece ids are colour-type-column, with -2, -3 appended when the id is already used', () => {
  // Two black rooks and three red pawns on one column each.
  const { board } = fenToBoard('r3k4/r8/9/4P4/4P4/4P4/9/9/9/3K5 w');
  assert.equal(board[0][0].id, 'black-rook-0');
  assert.equal(board[1][0].id, 'black-rook-0-2');
  assert.equal(board[0][4].id, 'black-king-4');
  assert.equal(board[3][4].id, 'red-pawn-4');
  assert.equal(board[4][4].id, 'red-pawn-4-2');
  assert.equal(board[5][4].id, 'red-pawn-4-3');
  assert.equal(board[9][3].id, 'red-king-3');
  assert.deepEqual(board[5][4], { id: 'red-pawn-4-3', type: 'pawn', color: 'red' });
  const all = board.flat().filter(Boolean).map(p => p.id);
  assert.equal(all.length, 7);
  assert.equal(new Set(all).size, 7);
});

test('FEN: round trip on 200 playout positions; accepts r side letter, E/H letters, six-field form', () => {
  const letters = { king: 'k', advisor: 'a', elephant: 'b', horse: 'n', rook: 'r', cannon: 'c', pawn: 'p' };
  const positions = playoutPositions(200, { seed: 4021, stride: 4, plies: 160, pawnBias: 0.2 });
  assert.equal(positions.length, 200);
  for (const { board, turn } of positions) {
    const fen = boardToFen(board, turn);
    const [placement, side, ...rest] = fen.split(' ');
    assert.deepEqual(rest, []);
    assert.equal(side, turn === 'red' ? 'w' : 'b');
    // The placement read back independently: digits are runs of empty points, never two digits in a row.
    assert.ok(!/\d\d/.test(placement), fen);
    const expected = board.map(row => row.map(p => (p ? (p.color === 'red' ? letters[p.type].toUpperCase() : letters[p.type]) : '.')).join('')).join('/');
    assert.equal(placement.replace(/\d/g, d => '.'.repeat(Number(d))), expected);
    const parsed = fenToBoard(fen);
    assert.equal(parsed.turn, turn);
    assert.deepEqual(layout(parsed.board), layout(board));
    assert.equal(boardToFen(parsed.board, parsed.turn), fen);
  }
  // FENs frozen in tests/helpers/positions.js, reached here by play.
  let board = createInitialBoard();
  for (const code of COACH_EXAMPLE_POSITIONS.sameCannons.moves) board = applyMove(board, ref(code));
  assert.equal(boardToFen(board, 'red'), COACH_EXAMPLE_POSITIONS.sameCannons.fen);
  board = createInitialBoard();
  for (const code of COACH_EXAMPLE_POSITIONS.horseReply.moves) board = applyMove(board, ref(code));
  assert.equal(boardToFen(board, 'red'), COACH_EXAMPLE_POSITIONS.horseReply.fen);

  // Side letter: w or r is red, b is black.
  const placement = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';
  assert.equal(fenToBoard(`${placement} r`).turn, 'red');
  assert.equal(fenToBoard(`${placement} w`).turn, 'red');
  assert.equal(fenToBoard(`${placement} b`).turn, 'black');
  assert.deepEqual(fenToBoard(`${placement} r`).board, createInitialBoard());
  // E/e for elephant and H/h for horse.
  const alt = fenToBoard('rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR w');
  assert.deepEqual(alt.board, createInitialBoard());
  assert.equal(boardToFen(alt.board, alt.turn), START_FEN);   // output always uses B and N
  // Six fields: "placement side - - halfmove fullmove".
  const six = fenToBoard(`${placement} b - - 7 12`);
  assert.deepEqual(six.board, createInitialBoard());
  assert.equal(six.turn, 'black');
  assert.equal(six.halfmove, 7);
  assert.equal(six.fullmove, 12);
  assert.equal(boardToFen(six.board, six.turn, { halfmove: 7, fullmove: 12 }), `${placement} b - - 7 12`);
  assert.equal(boardToFen(createInitialBoard(), 'red', { halfmove: 0, fullmove: 1 }), `${START_FEN} - - 0 1`);
  // Missing counters default to halfmove 0, fullmove 1.
  assert.equal(fenToBoard(`${placement} b`).halfmove, 0);
  assert.equal(fenToBoard(`${placement} b`).fullmove, 1);
});

test('FEN: each malformed input throws RangeError', () => {
  const malformed = {
    'nine rows': 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/RNBAKABNR w',
    'eleven rows': 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    'a row that sums to 8': 'rnbakabnr/8/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    'a row that sums to 10': 'rnbakabnr/9/1c5c2/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    'a row of ten pieces': 'rnbakabnrr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    'an empty row': 'rnbakabnr//1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    'an unknown letter': 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBQKABNR w',
    'an unknown symbol': 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4*4/RNBAKABNR w',
    'a digit 0 after a full row': 'rnbakabnr/90/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    'a digit 0 between pieces': 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBA0KABNR w',
    'a full-width digit': 'rnbakabnr/９/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    'no red king': 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBA1ABNR w',
    'two red kings': 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBKKABNR w',
    'no black king': 'rnba1abnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    'two black kings': 'rnbakkbnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
    'an unknown side letter': 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR x',
    'an upper-case side letter': 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR W',
    'no side letter': 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR',
    'an empty string': '',
  };
  for (const [what, fen] of Object.entries(malformed)) {
    assert.throws(() => fenToBoard(fen), RangeError, what);
  }
  // Anything that is not a string is malformed too (a RangeError, never a TypeError).
  for (const notText of [null, undefined, 42, {}, [START_FEN]]) {
    assert.throws(() => fenToBoard(notText), RangeError, String(notText));
  }
});

test('positionKey differs when only the side to move differs', () => {
  const board = createInitialBoard();
  assert.notEqual(positionKey(board, 'red'), positionKey(board, 'black'));
  assert.equal(positionKey(board, 'red'), boardToFen(board, 'red'));       // no counters
  assert.equal(positionKey(board, 'black'), boardToFen(board, 'black'));
  // The same placement reached by two move orders has the same key; piece ids do not matter.
  let a = createInitialBoard();
  for (const code of ['9172', '0122', '9776', '0726']) a = applyMove(a, ref(code));
  let b = createInitialBoard();
  for (const code of ['9776', '0726', '9172', '0122']) b = applyMove(b, ref(code));
  assert.equal(positionKey(a, 'red'), positionKey(b, 'red'));
  assert.equal(positionKey(fenToBoard(positionKey(a, 'red')).board, 'red'), positionKey(a, 'red'));
  assert.notEqual(positionKey(a, 'red'), positionKey(createInitialBoard(), 'red'));
});

test('checkers lists every checking piece, including a double check and a facing king', () => {
  const start = createInitialBoard();
  assert.deepEqual(checkers(start, 'red'), []);
  assert.deepEqual(checkers(start, 'black'), []);

  // One checker: the rook on the back rank.
  const single = boardWith([['king', 'black', 0, 4], ['king', 'red', 9, 3], ['rook', 'red', 0, 0], ['pawn', 'red', 5, 4]]);
  assert.deepEqual(checkers(single, 'black'), [{ row: 0, col: 0 }]);
  assert.deepEqual(checkers(single, 'red'), []);

  // Double check: a rook on the king's file and a horse whose leg is free.
  const double = boardWith([['king', 'black', 0, 4], ['king', 'red', 9, 3], ['rook', 'red', 5, 4], ['horse', 'red', 2, 3]]);
  assert.deepEqual(sortSquares(checkers(double, 'black')), ['2,3', '5,4']);
  // Blocking the horse's leg removes that checker only.
  double[1][3] = piece('advisor', 'black');
  assert.deepEqual(sortSquares(checkers(double, 'black')), ['5,4']);

  // A cannon checks over exactly one screen; here the screen is a rook on the same file, which checks too.
  const battery = boardWith([['king', 'black', 0, 4], ['king', 'red', 9, 3], ['rook', 'red', 5, 4], ['cannon', 'red', 7, 4]]);
  assert.deepEqual(sortSquares(checkers(battery, 'black')), ['5,4', '7,4']);
  // With a second piece on the file the rook is blocked and the cannon has two screens.
  const screened = boardWith([['king', 'black', 0, 4], ['king', 'red', 9, 3], ['advisor', 'black', 1, 4], ['cannon', 'red', 7, 4], ['rook', 'red', 5, 4]]);
  assert.deepEqual(checkers(screened, 'black'), []);

  // A pawn beside the black king, and a crossed black pawn in front of the red king.
  const pawns = boardWith([['king', 'black', 0, 4], ['king', 'red', 9, 3], ['pawn', 'red', 0, 5], ['pawn', 'black', 8, 3]]);
  assert.deepEqual(checkers(pawns, 'black'), [{ row: 0, col: 5 }]);
  assert.deepEqual(checkers(pawns, 'red'), [{ row: 8, col: 3 }]);

  // Facing kings: each king is the other's checker.
  const facing = boardWith([['king', 'black', 0, 4], ['king', 'red', 9, 4]]);
  assert.deepEqual(checkers(facing, 'red'), [{ row: 0, col: 4 }]);
  assert.deepEqual(checkers(facing, 'black'), [{ row: 9, col: 4 }]);
  facing[5][4] = piece('pawn', 'red');
  assert.deepEqual(checkers(facing, 'red'), []);
  assert.deepEqual(checkers(facing, 'black'), []);

  // Agrees with isInCheck on playout positions, and every listed square holds an enemy piece.
  let inCheck = 0;
  for (const { board, turn } of playoutPositions(150, { seed: 77, stride: 3, plies: 150 })) {
    for (const color of ['red', 'black']) {
      const list = checkers(board, color);
      assert.equal(list.length > 0, isInCheck(board, color));
      for (const sq of list) assert.equal(board[sq.row][sq.col].color, opposite(color));
      if (color === turn && list.length > 0) inCheck++;
    }
  }
  assert.ok(inCheck > 0, 'the sample contains positions with the side to move in check');
});

test('plyRecord holds the key after the move, the mover, and whether the move checks or captures', () => {
  const start = createInitialBoard();
  assert.deepEqual(plyRecord(start, ref('7774')), {              // 炮二平五
    key: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b', mover: 'red', check: false, capture: false,
  });
  assert.deepEqual(plyRecord(start, ref('7707')), {              // 炮二进七 takes the horse
    key: 'rnbakabCr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C7/9/RNBAKABNR b', mover: 'red', check: false, capture: true,
  });
  const fixture = V1_COACH_FIXTURES.find(f => f.name === 'rook-check');
  assert.equal(fixture.fen, '4k4/9/9/9/R8/4P4/9/9/9/4K4 w');
  assert.deepEqual(plyRecord(fenToBoard(fixture.fen).board, ref(fixture.move)), {     // 车九进四, check
    key: 'R3k4/9/9/9/9/4P4/9/9/9/4K4 b', mover: 'red', check: true, capture: false,
  });
  const black = fenToBoard('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b').board;
  assert.deepEqual(plyRecord(black, ref('0726')), {              // 马8进7
    key: 'rnbakab1r/9/1c4nc1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR w', mover: 'black', check: false, capture: false,
  });
  assert.equal(JSON.stringify(start), JSON.stringify(createInitialBoard()));          // the board is not mutated
  // Like the v1 functions, the additions take an empty point that is undefined instead of null (a sparse hand-built board).
  const sparse = start.map(row => row.map(p => p ?? undefined));
  assert.deepEqual(plyRecord(sparse, ref('7774')), plyRecord(start, ref('7774')));
  assert.deepEqual(plyRecord(sparse, ref('7707')), plyRecord(start, ref('7707')));
  assert.equal(boardToFen(sparse, 'red'), START_FEN);
  assert.deepEqual(checkers(sparse, 'red'), []);
  assert.deepEqual(drawStatus(START_FEN, [], sparse, 0), { draw: false, reason: null });
});

test('repetition: second occurrence is \'repeat\', third is \'draw\', drawStatus reports \'repetition\'', () => {
  // Both sides move a horse out and back: 马八进七 马2进3 马七退八 马3退2, twice.
  const cycle = ['9172', '0122', '7291', '2201'];
  const game = playGame(createInitialBoard(), 'red', cycle);
  // The fourth ply brings back the start position: its second occurrence.
  assert.deepEqual(game.verdicts, ['ok', 'ok', 'ok', 'repeat']);
  assert.deepEqual(repetition(game.startKey, game.log.slice(0, 3), game.log[3]), { count: 2, checkingSide: null });
  assert.deepEqual(drawStatus(game.startKey, game.log, game.board, 4), { draw: false, reason: null });
  playOn(game, cycle.slice(0, 3));
  assert.deepEqual(game.verdicts.slice(4), ['repeat', 'repeat', 'repeat']);
  assert.deepEqual(drawStatus(game.startKey, game.log, game.board, 7), { draw: false, reason: null });
  // The eighth ply would be the third occurrence of the start position.
  assert.equal(judgeMove(game.startKey, game.log, game.board, ref('2201')), 'draw');
  assert.ok(hasMove(playableMoves(game.startKey, game.log, game.board, 'black'), '2201'), 'a drawing repetition stays playable');
  playOn(game, ['2201']);
  assert.deepEqual(repetition(game.startKey, game.log.slice(0, 7), game.log[7]), { count: 3, checkingSide: null });
  assert.equal(game.log[7].key, game.startKey);
  assert.deepEqual(drawStatus(game.startKey, game.log, game.board, 8), { draw: true, reason: 'repetition' });
});

test('repetition: a perpetual check is \'forbidden\' and missing from playableMoves; with one quiet move in the cycle it is \'draw\'', () => {
  // The red rook on row 4 checks the black king on its file again and again; the king steps between (0,3) and (0,4).
  const pieces = [['king', 'black', 0, 3], ['king', 'red', 9, 5], ['rook', 'red', 4, 0]];
  const checks = ['4043', '0304', '4344', '0403'];      // 车九平六+ 将4平5 车六平五+ 将5平4
  const perpetual = playGame(boardWith(pieces), 'red', [...checks, '4443', '0304', '4344', '0403']);
  assert.deepEqual(perpetual.log.map(r => r.check), [true, false, true, false, true, false, true, false]);
  assert.deepEqual(perpetual.verdicts, ['ok', 'ok', 'ok', 'ok', 'repeat', 'repeat', 'repeat', 'repeat']);
  // 车五平六+ would now bring its position about for the third time, and red has checked with every move since the second.
  const again = ref('4443');
  assert.deepEqual(repetition(perpetual.startKey, perpetual.log, plyRecord(perpetual.board, again)), { count: 3, checkingSide: 'red' });
  assert.equal(judgeMove(perpetual.startKey, perpetual.log, perpetual.board, again), 'forbidden');
  const legal = getLegalMoves(perpetual.board, 'red');
  const playable = playableMoves(perpetual.startKey, perpetual.log, perpetual.board, 'red');
  assert.ok(hasMove(legal, '4443'));
  assert.ok(!hasMove(playable, '4443'));
  assert.equal(playable.length, legal.length - 1);
  assert.deepEqual(playable, legal.filter(m => !(m.to.row === 4 && m.to.col === 3)));       // the other moves, same objects and order

  // Only the checking side must deviate. Started with the rook already on (4,4), the side being checked is the first
  // to complete a third occurrence: its move is a 'draw' (red has checked throughout), not 'forbidden'.
  const checked = playGame(boardWith([['king', 'black', 0, 3], ['king', 'red', 9, 5], ['rook', 'red', 4, 4]]), 'red',
    ['4443', '0304', '4344', '0403', '4443', '0304', '4344']);
  assert.deepEqual(checked.verdicts, ['ok', 'ok', 'ok', 'repeat', 'repeat', 'repeat', 'repeat']);
  assert.deepEqual(repetition(checked.startKey, checked.log, plyRecord(checked.board, ref('0403'))), { count: 3, checkingSide: 'red' });
  assert.equal(judgeMove(checked.startKey, checked.log, checked.board, ref('0403')), 'draw');
  assert.ok(hasMove(playableMoves(checked.startKey, checked.log, checked.board, 'black'), '0403'));

  // The same dance with a quiet rook move in each cycle: 车九平六+ 将4平5 车六平九 将5平4.
  const mixedCycle = ['4043', '0304', '4340', '0403'];
  const mixed = playGame(boardWith(pieces), 'red', [...mixedCycle, ...mixedCycle.slice(0, 3)]);
  assert.deepEqual(mixed.log.map(r => r.check), [true, false, false, false, true, false, false]);
  // Black's 将5平4 completes the third occurrence of the start position: a draw, since neither side checked throughout.
  assert.deepEqual(repetition(mixed.startKey, mixed.log, plyRecord(mixed.board, ref('0403'))), { count: 3, checkingSide: null });
  assert.equal(judgeMove(mixed.startKey, mixed.log, mixed.board, ref('0403')), 'draw');
  playOn(mixed, ['0403']);
  // Red's checking move 车九平六+ is a third occurrence too, but red's cycle holds the quiet 车六平九: 'draw', and playable.
  assert.equal(plyRecord(mixed.board, ref('4043')).check, true);
  assert.deepEqual(repetition(mixed.startKey, mixed.log, plyRecord(mixed.board, ref('4043'))), { count: 3, checkingSide: null });
  assert.equal(judgeMove(mixed.startKey, mixed.log, mixed.board, ref('4043')), 'draw');
  assert.ok(hasMove(playableMoves(mixed.startKey, mixed.log, mixed.board, 'red'), '4043'));
  assert.equal(playableMoves(mixed.startKey, mixed.log, mixed.board, 'red').length, getLegalMoves(mixed.board, 'red').length);
  // One ply on, black's 将4平5 repeats a position for the third time; red's moves since the second were the quiet
  // 车六平九 and the check 车九平六+, so no side has checked throughout.
  playOn(mixed, ['4043']);
  assert.deepEqual(repetition(mixed.startKey, mixed.log, plyRecord(mixed.board, ref('0304'))), { count: 3, checkingSide: null });

  // "Since the previous occurrence" means since the most recent one. Red checks, withdraws quietly (车六平九), and only
  // then starts to check without a break: 车九平六+ 将4平5 车六平九 将5平4 | 车九平六+ 将4平5 车六平五+ 将5平4.
  const late = playGame(boardWith(pieces), 'red', ['4043', '0304', '4340', '0403', '4043', '0304', '4344', '0403']);
  assert.deepEqual(late.verdicts, ['ok', 'ok', 'ok', 'repeat', 'repeat', 'repeat', 'ok', 'ok']);
  assert.deepEqual(late.log.map(r => r.check), [true, false, false, false, true, false, true, false]);
  // 车五平六+ now creates the position after ply 1 and ply 5 for the third time. The quiet 车六平九 (ply 3) lies before
  // its second occurrence, so it does not excuse red: every red move since then was a check.
  assert.equal(plyRecord(late.board, again).key, late.log[0].key);
  assert.equal(late.log[4].key, late.log[0].key);
  assert.deepEqual(repetition(late.startKey, late.log, plyRecord(late.board, again)), { count: 3, checkingSide: 'red' });
  assert.equal(judgeMove(late.startKey, late.log, late.board, again), 'forbidden');
  assert.ok(!hasMove(playableMoves(late.startKey, late.log, late.board, 'red'), '4443'));
  assert.equal(playableMoves(late.startKey, late.log, late.board, 'red').length, getLegalMoves(late.board, 'red').length - 1);

  // The cycle is exactly the moves played since the previous occurrence, plus the candidate (bare records).
  const rec = (key, mover, check) => ({ key, mover, check, capture: false });
  // Q occurred twice before; red's quiet move lies between those two occurrences and does not count.
  const twice = [rec('Q', 'red', true), rec('R', 'black', false), rec('S', 'red', false), rec('T', 'black', false), rec('Q', 'red', true), rec('U', 'black', false)];
  assert.deepEqual(repetition('P', twice, rec('Q', 'red', true)), { count: 3, checkingSide: 'red' });
  // Red's quiet first move lies before the previous occurrence of Q and does not count: red checked ever since.
  assert.deepEqual(repetition('P', [rec('Q', 'red', false), rec('P', 'black', false)], rec('Q', 'red', true)), { count: 2, checkingSide: 'red' });
  // Black's quiet move right after the previous occurrence of Q does count: black did not check throughout.
  const answered = [rec('Q', 'red', false), rec('R', 'black', false), rec('S', 'red', false), rec('T', 'black', true)];
  assert.deepEqual(repetition('P', answered, rec('Q', 'red', false)), { count: 2, checkingSide: null });
  // When both sides checked with every move, the mover is named.
  const both = [rec('Q', 'red', true), rec('R', 'black', true), rec('S', 'red', true), rec('T', 'black', true)];
  assert.deepEqual(repetition('P', both, rec('Q', 'red', true)), { count: 2, checkingSide: 'red' });
  assert.deepEqual(repetition('P', both.slice(0, 3), rec('R', 'black', true)), { count: 2, checkingSide: 'black' });
  // The opponent checked throughout, the mover did not: the opponent is named.
  const chased = [rec('Q', 'red', false), rec('R', 'black', true), rec('S', 'red', false), rec('T', 'black', true)];
  assert.deepEqual(repetition('P', chased, rec('Q', 'red', false)), { count: 2, checkingSide: 'black' });
  // A new position has no checking side, whatever the checks.
  assert.deepEqual(repetition('P', both, rec('Z', 'red', true)), { count: 1, checkingSide: null });
});

test('repetition: a capture resets the count', () => {
  // The start position twice (plies 1-4), then 炮二进七 takes a horse, then the horses dance again.
  const game = playGame(createInitialBoard(), 'red', ['9172', '0122', '7291', '2201', '7707']);
  assert.deepEqual(game.verdicts, ['ok', 'ok', 'ok', 'repeat', 'ok']);
  assert.equal(game.log[4].capture, true);
  // After the capture the earlier records no longer count: the position after it is a first occurrence again.
  playOn(game, ['0122', '9172', '2201', '7291']);
  assert.deepEqual(game.verdicts.slice(5), ['ok', 'ok', 'ok', 'repeat']);
  assert.equal(game.log[8].key, game.log[4].key);
  assert.deepEqual(drawStatus(game.startKey, game.log, game.board, 9), { draw: false, reason: null });
  playOn(game, ['0122', '9172', '2201']);
  assert.equal(judgeMove(game.startKey, game.log, game.board, ref('7291')), 'draw');
  playOn(game, ['7291']);
  assert.deepEqual(drawStatus(game.startKey, game.log, game.board, 13), { draw: true, reason: 'repetition' });

  // The rule on bare records: keys from before the last capture are not counted, the capture record's own key is.
  const quiet = (key, mover) => ({ key, mover, check: false, capture: false });
  const log = [quiet('B', 'red'), quiet('A', 'black'), quiet('B', 'red'), { key: 'X', mover: 'black', check: false, capture: true }, quiet('B', 'red')];
  assert.deepEqual(repetition('A', log, quiet('A', 'black')), { count: 1, checkingSide: null });
  assert.deepEqual(repetition('A', log.slice(0, 3), quiet('A', 'black')), { count: 3, checkingSide: null });
  assert.deepEqual(repetition('A', log, quiet('X', 'black')), { count: 2, checkingSide: null });
  assert.deepEqual(repetition('A', log, quiet('B', 'black')), { count: 2, checkingSide: null });
  // A capturing move is always a first occurrence.
  assert.deepEqual(repetition('A', log.slice(0, 3), { key: 'A', mover: 'black', check: true, capture: true }), { count: 1, checkingSide: null });
  // drawStatus counts the same way: B occurs three times in the whole log, but only once since the capture.
  assert.deepEqual(drawStatus('A', log, createInitialBoard(), 5), { draw: false, reason: null });
  assert.deepEqual(drawStatus('A', log.slice(0, 3), createInitialBoard(), 3), { draw: false, reason: null });
  assert.deepEqual(drawStatus('B', log.slice(0, 3), createInitialBoard(), 3), { draw: true, reason: 'repetition' });
});

test('drawStatus: 120 quiet plies -> \'no_capture\'; kings and advisors only -> \'no_attackers\'; 600 plies -> \'move_limit\'', () => {
  assert.equal(NO_CAPTURE_DRAW_PLIES, 120);
  assert.equal(MAX_PLIES, 600);

  // 120 quiet plies without any repetition: a red rook visits 61 different points while a black advisor steps out and back.
  const columns = [0, 1, 2, 3, 5, 6, 7, 8];             // the rook never stops on the black king's file
  const stops = [[1, 0]];
  for (let row = 2; row <= 8; row++) {
    for (const col of row % 2 === 0 ? columns : [...columns].reverse()) stops.push([row, col]);
  }
  stops.push([9, 8], [9, 7], [9, 6], [9, 5]);
  assert.equal(stops.length, 61);
  const codes = [];
  for (let i = 1; i < stops.length; i++) {
    codes.push(`${stops[i - 1][0]}${stops[i - 1][1]}${stops[i][0]}${stops[i][1]}`);
    codes.push(i % 2 === 1 ? '0314' : '1403');
  }
  assert.equal(codes.length, 120);
  const start = boardWith([['king', 'black', 0, 4], ['advisor', 'black', 0, 3], ['king', 'red', 9, 3], ['rook', 'red', 1, 0]]);
  const game = playGame(start, 'red', codes.slice(0, 119));
  assert.ok(game.verdicts.every(v => v === 'ok'));
  assert.ok(game.log.every(r => !r.capture && !r.check));
  assert.deepEqual(drawStatus(game.startKey, game.log, game.board, 119), { draw: false, reason: null });
  playOn(game, codes.slice(119));
  assert.equal(game.log.length, 120);
  assert.equal(new Set(game.log.map(r => r.key)).size, 120);
  assert.deepEqual(drawStatus(game.startKey, game.log, game.board, 120), { draw: true, reason: 'no_capture' });
  // Only the plies since the last capture count.
  const withCapture = game.log.map((r, i) => (i === 10 ? { ...r, capture: true } : r));
  assert.deepEqual(drawStatus(game.startKey, withCapture, game.board, 120), { draw: false, reason: null });
  const later = Array.from({ length: 11 }, (_, i) => ({ key: `later-${i}`, mover: i % 2 ? 'black' : 'red', check: false, capture: false }));
  assert.deepEqual(drawStatus(game.startKey, [...withCapture, ...later.slice(0, 10)], game.board, 130), { draw: false, reason: null });
  assert.deepEqual(drawStatus(game.startKey, [...withCapture, ...later], game.board, 131), { draw: true, reason: 'no_capture' });

  // Neither side has a rook, cannon, horse or pawn.
  const bare = [['king', 'black', 0, 4], ['advisor', 'black', 0, 3], ['advisor', 'black', 0, 5], ['king', 'red', 9, 3], ['advisor', 'red', 8, 4]];
  assert.deepEqual(drawStatus('k', [], boardWith(bare), 40), { draw: true, reason: 'no_attackers' });
  assert.deepEqual(drawStatus('k', [], boardWith([...bare, ['elephant', 'red', 9, 2], ['elephant', 'black', 2, 4]]), 40), { draw: true, reason: 'no_attackers' });
  for (const type of ['rook', 'cannon', 'horse', 'pawn']) {
    assert.deepEqual(drawStatus('k', [], boardWith([...bare, [type, 'black', 5, 0]]), 40), { draw: false, reason: null }, type);
    assert.deepEqual(drawStatus('k', [], boardWith([...bare, [type, 'red', 5, 0]]), 40), { draw: false, reason: null }, type);
  }

  // The move limit.
  assert.deepEqual(drawStatus(START_FEN, [], createInitialBoard(), 0), { draw: false, reason: null });
  assert.deepEqual(drawStatus(START_FEN, [], createInitialBoard(), 599), { draw: false, reason: null });
  assert.deepEqual(drawStatus(START_FEN, [], createInitialBoard(), 600), { draw: true, reason: 'move_limit' });
});

test('drawStatus: when several rules hold, the reason is the first of repetition, no_capture, no_attackers, move_limit', () => {
  const quiet = (key, i) => ({ key, mover: i % 2 ? 'black' : 'red', check: false, capture: false });
  const kingsOnly = boardWith([['king', 'black', 0, 4], ['king', 'red', 9, 3]]);
  // 120 quiet plies whose last position has occurred three times, on a board without attackers, at ply 600: every rule holds.
  const repeated = Array.from({ length: 120 }, (_, i) => quiet(i >= 116 ? `k${i % 4}` : `k${i}`, i));
  assert.equal(repeated.filter(r => r.key === repeated[119].key).length, 2);
  assert.deepEqual(drawStatus('k3', repeated, kingsOnly, 600), { draw: true, reason: 'repetition' });
  // The same without the repetition.
  const distinct = Array.from({ length: 120 }, (_, i) => quiet(`k${i}`, i));
  assert.deepEqual(drawStatus('start', distinct, kingsOnly, 600), { draw: true, reason: 'no_capture' });
  assert.deepEqual(drawStatus('start', distinct, createInitialBoard(), 600), { draw: true, reason: 'no_capture' });
  // Without the 120 quiet plies.
  assert.deepEqual(drawStatus('start', distinct.slice(0, 119), kingsOnly, 600), { draw: true, reason: 'no_attackers' });
  assert.deepEqual(drawStatus('start', distinct.slice(0, 119), createInitialBoard(), 600), { draw: true, reason: 'move_limit' });
  assert.deepEqual(drawStatus('start', distinct.slice(0, 119), createInitialBoard(), 599), { draw: false, reason: null });
});

test('playableMoves returns every legal move when all of them are forbidden', () => {
  // The red king cannot move: the black rook holds row 8, and (9,4) is either barred by the black king on that file or
  // taken by the red rook. The red rook is tied to row 9: if it left the row or took the pawn, exactly one piece would
  // stand between the black cannon and the red king. Its only move shuttles between (9,4) and (9,5), each time with check.
  const start = boardWith([
    ['king', 'black', 0, 5], ['king', 'red', 9, 3], ['rook', 'red', 9, 5],
    ['pawn', 'black', 9, 6], ['cannon', 'black', 9, 7], ['rook', 'black', 8, 8],
  ]);
  const game = playGame(start, 'black', ['0504', '9594', '0405', '9495', '0504', '9594', '0405']);   // 将6平5 车四平五+ 将5平6 车五平四+ ...
  assert.deepEqual(game.verdicts, ['ok', 'ok', 'ok', 'repeat', 'repeat', 'repeat', 'repeat']);
  const legal = getLegalMoves(game.board, 'red');
  assert.equal(legal.length, 1);
  assert.ok(hasMove(legal, '9495'));
  assert.equal(judgeMove(game.startKey, game.log, game.board, legal[0]), 'forbidden');
  assert.deepEqual(playableMoves(game.startKey, game.log, game.board, 'red'), legal);
  // Earlier in the same game the move was only a repetition, and playable as such.
  const earlier = playGame(start, 'black', ['0504', '9594', '0405']);
  assert.equal(judgeMove(earlier.startKey, earlier.log, earlier.board, ref('9495')), 'repeat');
  assert.deepEqual(playableMoves(earlier.startKey, earlier.log, earlier.board, 'red'), getLegalMoves(earlier.board, 'red'));
  // With no history at all, playableMoves is getLegalMoves.
  const board = createInitialBoard();
  assert.deepEqual(playableMoves(START_FEN, [], board, 'red'), getLegalMoves(board, 'red'));
  assert.deepEqual(playableMoves(START_FEN, [], board, 'black'), getLegalMoves(board, 'black'));
});
