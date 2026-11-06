import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialBoard, getPieceLegalMoves, isInCheck } from '../src/engine.js';
import { describeMove } from '../src/coach.js';

let nextId = 0;
const piece = (type, color = 'red') => ({ id: `coach-${nextId++}`, type, color });
function emptyBoard() {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  board[9][4] = piece('king');
  board[0][4] = piece('king', 'black');
  board[5][4] = piece('pawn');
  return board;
}
function moveTo(board, row, col, toRow, toCol) {
  const move = getPieceLegalMoves(board, row, col).find(candidate => candidate.to.row === toRow && candidate.to.col === toCol);
  assert(move, `Fixture move ${row},${col} to ${toRow},${toCol} must be legal`);
  return move;
}
const explanationText = result => [result.headline, ...result.reasons, result.caution].filter(Boolean).join(' ');

test('coach identifies opening horse development with measured rook mobility', () => {
  const board = createInitialBoard();
  const explanation = describeMove(board, moveTo(board, 9, 1, 7, 2));
  assert.match(explanation.headline, /给车腾出通道/);
  assert.match(explanation.reasons[0], /车多了\d+个可走落点/);
});

test('coach explains a capture and warns about a legal recapture', () => {
  const board = createInitialBoard();
  const explanation = describeMove(board, moveTo(board, 7, 1, 0, 1));
  assert.match(explanation.headline, /吃掉黑方.*马/);
  assert.match(explanation.caution, /车吃回红方.*炮/);
  assert.doesNotMatch(explanationText(explanation), /白赚|稳赚|必胜|绝对安全/);
});

test('coach gives evading check priority over positional explanations', () => {
  const board = emptyBoard();
  board[5][4] = null;
  board[4][4] = piece('rook', 'black');
  board[7][0] = piece('rook');
  assert(isInCheck(board, 'red'));
  const explanation = describeMove(board, moveTo(board, 7, 0, 7, 4));
  assert.match(explanation.headline, /应将/);
  assert.match(explanation.reasons[0], /解除将军/);
});

test('coach identifies a check without promising a win', () => {
  const board = emptyBoard();
  board[4][0] = piece('rook');
  const explanation = describeMove(board, moveTo(board, 4, 0, 0, 0));
  assert.match(explanation.headline, /将军/);
  assert.match(explanation.reasons[0], /下一步必须先解除/);
  assert.doesNotMatch(explanationText(explanation), /必胜|将死/);
});

test('coach only announces checkmate when the rules engine verifies it', () => {
  const board = emptyBoard();
  board[1][3] = piece('rook');
  board[1][5] = piece('rook');
  board[2][0] = piece('rook');
  assert(!isInCheck(board, 'black'));
  const explanation = describeMove(board, moveTo(board, 2, 0, 2, 4));
  assert.match(explanation.headline, /将死/);
  assert.equal(explanation.caution, null);
});

test('coach explains a threatened piece retreat using legal reply analysis', () => {
  const board = emptyBoard();
  board[3][0] = piece('rook', 'black');
  board[5][0] = piece('rook');
  const explanation = describeMove(board, moveTo(board, 5, 0, 5, 1));
  assert.match(explanation.headline, /撤开受攻击的车/);
  assert.match(explanation.reasons[0], /下一步已没有直接吃/);
  assert.doesNotMatch(explanationText(explanation), /绝对安全/);
});

test('coach notices protection of another piece and warns if the blocker can be taken', () => {
  const board = emptyBoard();
  board[3][0] = piece('rook', 'black');
  board[7][0] = piece('horse');
  board[5][2] = piece('rook');
  const explanation = describeMove(board, moveTo(board, 5, 2, 5, 0));
  assert.match(explanation.headline, /马受到的直接威胁/);
  assert.match(explanation.caution, /吃掉红方车/);
});

test('coach describes new attacks without claiming a free capture', () => {
  const board = emptyBoard();
  board[6][2] = piece('horse');
  board[2][4] = piece('rook', 'black');
  const explanation = describeMove(board, moveTo(board, 6, 2, 4, 3));
  assert.match(explanation.headline, /黑方车的攻击/);
  assert.match(explanation.reasons[0], /不等于一定能白吃/);
});

test('red pawn crossing explanation identifies its new sideways ability', () => {
  const board = emptyBoard();
  board[5][0] = piece('pawn');
  const explanation = describeMove(board, moveTo(board, 5, 0, 4, 0));
  assert.match(explanation.headline, /兵过河/);
  assert.match(explanation.reasons[0], /不能后退/);
});

test('black pawn explanations use the black side direction and piece label', () => {
  const board = emptyBoard();
  board[4][0] = piece('pawn', 'black');
  const explanation = describeMove(board, moveTo(board, 4, 0, 5, 0));
  assert.match(explanation.headline, /卒过河/);
});

test('quiet adjustments use a limited explanation rather than an invented advantage', () => {
  const board = createInitialBoard();
  const explanation = describeMove(board, moveTo(board, 9, 3, 8, 4));
  assert.match(explanation.headline, /调整子力位置/);
  assert.match(explanation.reasons[0], /仍要结合/);
  assert.doesNotMatch(explanationText(explanation), /优势|必胜|安全|保护/);
});

test('describing a move preserves the historical board and caps reasons', () => {
  const board = createInitialBoard();
  const snapshot = JSON.stringify(board);
  for (const row of board) { for (const occupant of row) if (occupant) Object.freeze(occupant); Object.freeze(row); }
  Object.freeze(board);
  const explanation = describeMove(board, moveTo(board, 9, 1, 7, 2));
  assert.equal(JSON.stringify(board), snapshot);
  assert(explanation.reasons.length >= 1 && explanation.reasons.length <= 2);
});

test('invalid moves are rejected instead of receiving a plausible explanation', () => {
  const board = createInitialBoard();
  assert.throws(() => describeMove(board, { from: { row: 6, col: 0 }, to: { row: 6, col: 1 } }), RangeError);
});

test('explanations name red and black explicitly so opponent commentary cannot reverse the player perspective', () => {
  const board = createInitialBoard();
  const explanation = describeMove(board, moveTo(board, 3, 0, 4, 0));
  assert.match(explanationText(explanation), /黑方/);
  assert.doesNotMatch(explanationText(explanation), /己方|对方/);
});
