import { analyzePosition } from './ai.js';
import { explainAnalysis } from './coach.js';
import { moveToNotation } from './engine.js';

self.addEventListener('message', ({ data }) => {
  const { id, board, color, opponentMove } = data;
  try {
    let analysis = analyzePosition(board, color, { timeLimitMs: 1600, maxDepth: 4, topN: 2 });
    if (analysis.move && analysis.pv.length < 2) {
      const focused = analyzePosition(board, color, { rootMoves: [analysis.move], timeLimitMs: 800, maxDepth: 3, topN: 1 });
      if (focused.pv.length >= 2) analysis = { ...focused, variations: [] };
    }
    const opponentAnalysis = opponentMove ? {
      pv: [opponentMove.move, ...analysis.pv],
      score: -analysis.score,
      depth: analysis.depth > 0 ? analysis.depth + 1 : 0,
      partial: analysis.partial,
      variations: [],
    } : null;
    const opponent = opponentMove ? {
      notation: moveToNotation(opponentMove.board, opponentMove.move),
      ...explainAnalysis(opponentMove.board, opponentMove.move, opponentAnalysis),
    } : null;
    const { move } = analysis;
    const recommendation = move ? { move, notation: moveToNotation(board, move), ...explainAnalysis(board, move, analysis) } : null;
    self.postMessage({ id, recommendation, opponent });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
