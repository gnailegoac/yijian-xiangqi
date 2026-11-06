import { chooseMove } from './ai.js';

self.addEventListener('message', ({ data }) => {
  const { id, board, color, difficulty } = data;
  try {
    self.postMessage({ id, ...chooseMove(board, color, { difficulty }) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
