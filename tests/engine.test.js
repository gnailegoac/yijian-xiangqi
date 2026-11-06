import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialBoard, opposite, pieceLabel, getLegalMoves, getPieceLegalMoves, applyMove, isInCheck, getGameStatus, moveToNotation } from '../src/engine.js';

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
