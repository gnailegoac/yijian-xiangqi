import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePosition, chooseMove } from '../src/ai.js';
import { applyMove, createInitialBoard, getLegalMoves, opposite } from '../src/engine.js';

const emptyBoard = () => Array.from({ length: 10 }, () => Array(9).fill(null));
const piece = (type, color, id = `${color}-${type}`) => ({ type, color, id });
const coordinates = (move) => [move.from.row, move.from.col, move.to.row, move.to.col];

test('AI returns a legal opening move without mutating the board', () => {
  const board = createInitialBoard();
  const original = JSON.stringify(board);
  const result = chooseMove(board, 'black', { difficulty: 'easy', timeLimitMs: 80 });
  assert.ok(result.move);
  assert.ok(getLegalMoves(board, 'black').some((move) =>
    JSON.stringify(coordinates(move)) === JSON.stringify(coordinates(result.move))));
  assert.equal(JSON.stringify(board), original);
  assert.ok(result.nodes > 0);
});

test('AI takes an undefended rook rather than making a quiet move', () => {
  const board = emptyBoard();
  board[0][4] = piece('king', 'black');
  board[9][4] = piece('king', 'red');
  board[5][4] = piece('pawn', 'red');
  board[4][0] = piece('rook', 'black');
  board[4][3] = piece('rook', 'red');
  const result = chooseMove(board, 'black', { difficulty: 'easy', timeLimitMs: 160 });
  assert.deepEqual(coordinates(result.move), [4, 0, 4, 3]);
});

test('AI returns null when its king is missing and no legal moves exist', () => {
  const board = emptyBoard();
  board[9][4] = piece('king', 'red');
  const result = chooseMove(board, 'black', { difficulty: 'easy' });
  assert.equal(result.move, null);
  assert.equal(result.depth, 0);
});

test('capture search avoids trading a cannon for a protected horse', () => {
  const board = emptyBoard();
  board[0][4] = piece('king', 'black');
  board[9][4] = piece('king', 'red');
  board[5][4] = piece('pawn', 'red', 'king-screen');
  board[4][0] = piece('cannon', 'black');
  board[4][2] = piece('pawn', 'red', 'cannon-screen');
  board[4][4] = piece('horse', 'red');
  board[4][8] = piece('rook', 'red');
  const result = chooseMove(board, 'black', { difficulty: 'easy' });
  assert.notDeepEqual(coordinates(result.move), [4, 0, 4, 4]);
});

test('unknown difficulty and a very short budget still return a legal fallback', () => {
  const board = createInitialBoard();
  const result = chooseMove(board, 'red', { difficulty: 'unknown', timeLimitMs: 1 });
  assert.ok(result.move);
  assert.ok(getLegalMoves(board, 'red').some((move) =>
    JSON.stringify(coordinates(move)) === JSON.stringify(coordinates(result.move))));
});

function assertLegalLine(board, color, line) {
  let position = board;
  for (const move of line) {
    const actual = getLegalMoves(position, color).find(candidate =>
      JSON.stringify(coordinates(candidate)) === JSON.stringify(coordinates(move)));
    assert.ok(actual, 'Every continuation move must be legal in its own position');
    assert.equal(move.piece.id, position[move.from.row][move.from.col].id);
    position = applyMove(position, actual);
    color = opposite(color);
  }
}

test('position analysis returns searched replies and comparable same-depth candidates', () => {
  const board = createInitialBoard();
  const before = JSON.stringify(board);
  const result = analyzePosition(board, 'red', { timeLimitMs: 1600, maxDepth: 2, topN: 3 });
  assert.equal(result.depth, 2);
  assert.equal(result.partial, false);
  assert.ok(result.pv.length >= 2, 'The line includes an actual opponent reply');
  assert.equal(result.variations.length, 3);
  assert.deepEqual(coordinates(result.pv[0]), coordinates(result.move));
  assertLegalLine(board, 'red', result.pv);
  for (const variation of result.variations) {
    assert.equal(variation.depth, result.depth);
    assertLegalLine(board, 'red', variation.pv);
  }
  assert.ok(result.variations.every((variation, index, list) => index === 0 || list[index - 1].score >= variation.score));
  assert.equal(JSON.stringify(board), before);
});

test('analysis rootMoves evaluates only the requested legal move and still searches its reply', () => {
  const board = createInitialBoard();
  const requested = { from: { row: 9, col: 1 }, to: { row: 7, col: 2 } };
  const result = analyzePosition(board, 'red', { timeLimitMs: 700, maxDepth: 2, rootMoves: [requested], topN: 2 });
  assert.equal(result.variations.length, 1);
  assert.equal(result.depth, 2);
  assert.deepEqual(coordinates(result.move), coordinates(requested));
  assert.ok(result.pv.length >= 2);
  assertLegalLine(board, 'red', result.pv);
  const absent = analyzePosition(board, 'red', { rootMoves: [] });
  assert.equal(absent.move, null);
  assert.deepEqual(absent.variations, []);
  assert.deepEqual(absent.pv, []);
});

test('an immediate timeout reports depth zero without inventing a searched continuation', () => {
  const board = createInitialBoard();
  const result = analyzePosition(board, 'red', { timeLimitMs: 0.001 });
  assert.ok(result.move);
  assert.equal(result.depth, 0);
  assert.equal(result.partial, true);
  assert.deepEqual(result.pv, []);
  assert.deepEqual(result.variations, []);
  assert.ok(!result.move.captured, 'Fallback should not blindly grab a protected opening horse');
});

test('complete capture variations include the recapture and disclose the losing exchange', () => {
  const board = emptyBoard();
  board[0][4] = piece('king', 'black');
  board[9][4] = piece('king', 'red');
  board[5][4] = piece('pawn', 'red', 'king-screen');
  board[4][0] = piece('cannon', 'black');
  board[4][2] = piece('pawn', 'red', 'cannon-screen');
  board[4][4] = piece('horse', 'red');
  board[4][8] = piece('rook', 'red');
  const badCapture = { from: { row: 4, col: 0 }, to: { row: 4, col: 4 } };
  const result = analyzePosition(board, 'black', { timeLimitMs: 500, maxDepth: 2, rootMoves: [badCapture] });
  assert.ok(result.pv.length >= 2);
  assert.deepEqual(result.pv[1].to, badCapture.to);
  assert.equal(result.pv[1].piece.color, 'red');
  assert.equal(result.pv[1].captured.type, 'cannon');
  assertLegalLine(board, 'black', result.pv);
});
