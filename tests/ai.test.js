import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseMove } from '../src/ai.js';
import { createInitialBoard, getLegalMoves } from '../src/engine.js';

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
