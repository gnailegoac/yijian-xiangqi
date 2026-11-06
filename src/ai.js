import { applyMove, getLegalMoves, isInCheck, opposite } from './engine.js';

const VALUES = { king: 100000, rook: 900, cannon: 450, horse: 420, elephant: 210, advisor: 210, pawn: 95 };
const PIECE_CODES = { king: 'k', rook: 'r', cannon: 'c', horse: 'h', elephant: 'e', advisor: 'a', pawn: 'p' };
const LEVELS = {
  easy: { milliseconds: 180, depth: 2 },
  normal: { milliseconds: 900, depth: 5 },
  hard: { milliseconds: 1900, depth: 7 },
};
const MATE = 1000000;
const TIMEOUT = Symbol('search timeout');
const now = () => globalThis.performance?.now() ?? Date.now();

function evaluate(board, color) {
  let score = 0;
  const kings = { red: false, black: false };
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = board[row][col];
      if (!piece) continue;
      const forward = piece.color === 'red' ? 9 - row : row;
      const centrality = 4 - Math.abs(4 - col);
      let value = VALUES[piece.type];
      if (piece.type === 'king') kings[piece.color] = true;
      if (piece.type === 'pawn') value += forward * 7 + (forward >= 5 ? 45 + centrality * 6 : 0);
      if (piece.type === 'horse') value += centrality * 10 + Math.min(forward, 6) * 6;
      if (piece.type === 'cannon') value += centrality * 5 + Math.min(forward, 5) * 2;
      if (piece.type === 'rook') value += centrality * 3 + forward * 2;
      score += piece.color === color ? value : -value;
    }
  }
  if (!kings[color]) return -MATE;
  if (!kings[opposite(color)]) return MATE;
  return score;
}

function positionKey(board, color) {
  let key = color === 'red' ? 'r' : 'b';
  for (const row of board) {
    for (const piece of row) {
      if (!piece) key += '.';
      else {
        const code = PIECE_CODES[piece.type];
        key += piece.color === 'red' ? code.toUpperCase() : code;
      }
    }
  }
  return key;
}

const sameMove = (a, b) => a && b && a.from.row === b.from.row && a.from.col === b.from.col
  && a.to.row === b.to.row && a.to.col === b.to.col;

function orderedMoves(board, moves, preferred) {
  const priority = (move) => {
    if (sameMove(move, preferred)) return 10000000;
    const attacker = move.piece ?? board[move.from.row][move.from.col];
    const victim = move.captured ?? board[move.to.row][move.to.col];
    return (victim ? VALUES[victim.type] * 12 - VALUES[attacker.type] : 0)
      + 4 - Math.abs(4 - move.to.col);
  };
  return moves.map((move) => ({ move, priority: priority(move) }))
    .sort((a, b) => b.priority - a.priority).map((item) => item.move);
}

/** Search runs synchronously; the browser calls it inside ai-worker.js. */
export function chooseMove(board, color, { difficulty = 'normal', timeLimitMs } = {}) {
  const level = LEVELS[difficulty] ?? LEVELS.normal;
  const suppliedLimit = Number(timeLimitMs);
  const budget = Number.isFinite(suppliedLimit) && suppliedLimit > 0
    ? Math.min(suppliedLimit, level.milliseconds) : level.milliseconds;
  const deadline = now() + budget;
  const table = new Map();
  let nodes = 0;
  let completedDepth = 0;
  const initialMoves = getLegalMoves(board, color);
  if (!initialMoves.length) return { move: null, depth: 0, nodes, score: -MATE };
  let bestMove = orderedMoves(board, initialMoves)[0];
  let bestScore = evaluate(applyMove(board, bestMove), color);

  function checkTime() {
    if (now() >= deadline) throw TIMEOUT;
  }

  function quiescence(position, side, alpha, beta, ply, remaining) {
    nodes += 1;
    if ((nodes & 7) === 0) checkTime();
    const staticScore = evaluate(position, side);
    if (Math.abs(staticScore) >= MATE) return staticScore > 0 ? MATE - ply : -MATE + ply;
    if (remaining <= 0) return staticScore;
    const checked = isInCheck(position, side);
    if (!checked) {
      if (staticScore >= beta) return staticScore;
      alpha = Math.max(alpha, staticScore);
    }
    const legal = getLegalMoves(position, side);
    if (!legal.length) return -MATE + ply;
    const tactical = checked ? legal : legal.filter((move) => position[move.to.row][move.to.col]);
    for (const move of orderedMoves(position, tactical)) {
      const score = -quiescence(applyMove(position, move), opposite(side), -beta, -alpha, ply + 1, remaining - 1);
      if (score >= beta) return score;
      alpha = Math.max(alpha, score);
    }
    return alpha;
  }

  function search(position, side, depth, alpha, beta, ply) {
    nodes += 1;
    if ((nodes & 15) === 0) checkTime();
    const staticScore = evaluate(position, side);
    if (Math.abs(staticScore) >= MATE) return staticScore > 0 ? MATE - ply : -MATE + ply;
    if (depth <= 0) return quiescence(position, side, alpha, beta, ply, 3);

    const key = positionKey(position, side);
    const cached = table.get(key);
    const originalAlpha = alpha;
    if (cached && cached.depth >= depth && Math.abs(cached.score) < MATE - 100) {
      if (cached.flag === 'exact') return cached.score;
      if (cached.flag === 'lower') alpha = Math.max(alpha, cached.score);
      if (cached.flag === 'upper') beta = Math.min(beta, cached.score);
      if (alpha >= beta) return cached.score;
    }
    const moves = getLegalMoves(position, side);
    if (!moves.length) return -MATE + ply;
    let score = -Infinity;
    let localBest = null;
    for (const move of orderedMoves(position, moves, cached?.move)) {
      const value = -search(applyMove(position, move), opposite(side), depth - 1, -beta, -alpha, ply + 1);
      if (value > score) { score = value; localBest = move; }
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    table.set(key, {
      depth, score, move: localBest,
      flag: score <= originalAlpha ? 'upper' : score >= beta ? 'lower' : 'exact',
    });
    return score;
  }

  for (let depth = 1; depth <= level.depth; depth += 1) {
    let iterationMove = bestMove;
    let iterationScore = -Infinity;
    let alpha = -Infinity;
    try {
      checkTime();
      for (const move of orderedMoves(board, initialMoves, bestMove)) {
        checkTime();
        const score = -search(applyMove(board, move), opposite(color), depth - 1, -Infinity, -alpha, 1);
        if (score > iterationScore) { iterationScore = score; iterationMove = move; }
        alpha = Math.max(alpha, score);
      }
      bestMove = iterationMove;
      bestScore = iterationScore;
      completedDepth = depth;
      if (Math.abs(bestScore) >= MATE - 100) break;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      break;
    }
  }
  return { move: bestMove, depth: completedDepth, nodes, score: bestScore };
}
