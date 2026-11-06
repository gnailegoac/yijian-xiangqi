import { chooseMove } from './ai.js';
import { describeMove } from './coach.js';
import { moveToNotation } from './engine.js';

self.addEventListener('message', ({ data }) => {
  const { id, board, color, opponentMove } = data;
  try {
    const opponent = opponentMove ? {
      notation: moveToNotation(opponentMove.board, opponentMove.move),
      ...describeMove(opponentMove.board, opponentMove.move),
    } : null;
    const { move } = chooseMove(board, color, { difficulty: 'normal', timeLimitMs: 650 });
    const recommendation = move ? { move, notation: moveToNotation(board, move), ...describeMove(board, move) } : null;
    self.postMessage({ id, recommendation, opponent });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
