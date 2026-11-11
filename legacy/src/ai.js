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
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
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
  if (!kings[color]) return -MATE;
  if (!kings[opposite(color)]) return MATE;
  return score;
}

function positionKey(board, color) {
  let key = color === 'red' ? 'r' : 'b';
  for (const row of board) for (const piece of row) {
    const code = piece ? PIECE_CODES[piece.type] : '.';
    key += piece?.color === 'red' ? code.toUpperCase() : code;
  }
  return key;
}

const sameMove = (a, b) => !!a && !!b && a.from.row === b.from.row && a.from.col === b.from.col
  && a.to.row === b.to.row && a.to.col === b.to.col;
const sameSquare = (a, b) => a.row === b.row && a.col === b.col;

function orderedMoves(board, moves, preferred) {
  return moves.map(move => {
    const attacker = move.piece ?? board[move.from.row][move.from.col];
    const victim = move.captured ?? board[move.to.row][move.to.col];
    const priority = sameMove(move, preferred) ? 10000000
      : (victim ? VALUES[victim.type] * 12 - VALUES[attacker.type] : 0) + 4 - Math.abs(4 - move.to.col);
    return { move, priority };
  }).sort((a, b) => b.priority - a.priority).map(item => item.move);
}

// Capture ordering is not an evaluation: when the search times out immediately,
// check recaptures before choosing a fallback rather than grabbing a defended man.
function fallbackMove(board, color, moves) {
  const candidates = moves.map(move => ({ move, board: applyMove(board, move) }));
  for (const item of candidates) item.score = evaluate(item.board, color);
  candidates.sort((a, b) => b.score - a.score);
  let best = null;
  // Include quiet candidates even if captures occupy the initial shortlist.
  const shortlist = [...new Set([...candidates.slice(0, 8), ...candidates.filter(item => !item.move.captured).slice(0, 4)])];
  for (const item of shortlist) {
    const replies = getLegalMoves(item.board, opposite(color));
    if (replies.some(reply => sameSquare(reply.to, item.move.to))) item.score -= VALUES[item.move.piece.type];
    if (!best || item.score > best.score) best = item;
  }
  return { move: best.move, score: best.score, pv: [] };
}

/** One search implementation serves play and exact-root comparative analysis. */
function runSearch(board, color, { budget, maxDepth, topN, rootMoves, compareRoots }) {
  const deadline = now() + budget;
  const table = new Map();
  let nodes = 0;
  let depth = 0;
  let timedOut = false;
  let moves = getLegalMoves(board, color);
  if (rootMoves !== undefined) {
    moves = Array.isArray(rootMoves) ? moves.filter(move => rootMoves.some(requested => sameMove(move, requested))) : [];
  }
  if (!moves.length) return { move: null, score: -MATE, depth: 0, nodes, pv: [], variations: [], partial: false };
  const fallback = fallbackMove(board, color, moves);
  let best = fallback;
  let variations = [];

  function checkTime() { if (now() >= deadline) throw TIMEOUT; }
  function visit() { nodes++; if ((nodes & 7) === 0) checkTime(); }
  const terminalScore = (value, ply) => value > 0 ? MATE - ply : -MATE + ply;

  function quiescence(position, side, alpha, beta, ply, remaining) {
    visit();
    const value = evaluate(position, side);
    if (Math.abs(value) >= MATE) return { score: terminalScore(value, ply), pv: [] };
    const checked = isInCheck(position, side);
    const legal = getLegalMoves(position, side);
    if (!legal.length) return { score: -MATE + ply, pv: [] };
    if (remaining <= 0) return { score: value, pv: [] };
    let bestResult = { score: checked ? -Infinity : value, pv: [] };
    if (!checked) {
      if (value >= beta) return bestResult;
      alpha = Math.max(alpha, value);
    }
    const tactical = checked ? legal : legal.filter(move => move.captured);
    for (const move of orderedMoves(position, tactical)) {
      const child = quiescence(applyMove(position, move), opposite(side), -beta, -alpha, ply + 1, remaining - 1);
      const score = -child.score;
      if (score > bestResult.score) bestResult = { score, pv: [move, ...child.pv] };
      if (score >= beta) return bestResult;
      alpha = Math.max(alpha, score);
    }
    return bestResult;
  }

  function search(position, side, remaining, alpha, beta, ply) {
    visit();
    const value = evaluate(position, side);
    if (Math.abs(value) >= MATE) return { score: terminalScore(value, ply), pv: [] };
    if (remaining <= 0) return quiescence(position, side, alpha, beta, ply, 3);
    const key = positionKey(position, side);
    const cached = table.get(key);
    const originalAlpha = alpha;
    const originalBeta = beta;
    if (cached && cached.depth >= remaining && Math.abs(cached.score) < MATE - 100) {
      if (cached.flag === 'exact') return { score: cached.score, pv: cached.pv };
      // Analysis roots use full windows. Cached bounds only order moves so the
      // reported root score never accidentally becomes a fail-high/low bound.
      if (!compareRoots) {
        if (cached.flag === 'lower') alpha = Math.max(alpha, cached.score);
        if (cached.flag === 'upper') beta = Math.min(beta, cached.score);
        if (alpha >= beta) return { score: cached.score, pv: cached.pv };
      }
    }
    const legal = getLegalMoves(position, side);
    if (!legal.length) return { score: -MATE + ply, pv: [] };
    let result = { score: -Infinity, pv: [] };
    for (const move of orderedMoves(position, legal, cached?.move)) {
      const child = search(applyMove(position, move), opposite(side), remaining - 1, -beta, -alpha, ply + 1);
      const score = -child.score;
      if (score > result.score) result = { score, pv: [move, ...child.pv] };
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    table.set(key, { depth: remaining, ...result, move: result.pv[0], flag: result.score <= originalAlpha ? 'upper' : result.score >= originalBeta ? 'lower' : 'exact' });
    return result;
  }

  for (let iteration = 1; iteration <= maxDepth; iteration++) {
    const current = [];
    let alpha = -Infinity;
    try {
      checkTime();
      for (const move of orderedMoves(board, moves, best.move)) {
        checkTime();
        const child = search(applyMove(board, move), opposite(color), iteration - 1, -Infinity, compareRoots ? Infinity : -alpha, 1);
        const score = -child.score;
        current.push({ move, score, depth: iteration, pv: [move, ...child.pv].slice(0, 10) });
        alpha = Math.max(alpha, score);
      }
      current.sort((a, b) => b.score - a.score);
      best = current[0];
      depth = iteration;
      // A partially visited root set cannot enter same-depth comparisons.
      variations = compareRoots ? current.slice(0, topN) : [best];
      if (Math.abs(best.score) >= MATE - 100) break;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      timedOut = true;
      break;
    }
  }
  function legalLine(line) {
    const result = [];
    let position = board;
    let side = color;
    for (const requested of line) {
      const move = getLegalMoves(position, side).find(candidate => sameMove(candidate, requested));
      if (!move) break;
      result.push(move);
      position = applyMove(position, move);
      side = opposite(side);
    }
    return result;
  }
  variations = variations.map(variation => ({ ...variation, pv: legalLine(variation.pv) }));
  return { move: best.move, score: best.score, depth, nodes, pv: legalLine(best.pv), variations, partial: timedOut || depth === 0 };
}

/** Runs synchronously inside ai-worker.js. The original play API stays valid. */
export function chooseMove(board, color, { difficulty = 'normal', timeLimitMs } = {}) {
  const level = LEVELS[difficulty] ?? LEVELS.normal;
  const supplied = Number(timeLimitMs);
  const budget = Number.isFinite(supplied) && supplied > 0 ? Math.min(supplied, level.milliseconds) : level.milliseconds;
  return runSearch(board, color, { budget, maxDepth: level.depth, topN: 1, compareRoots: false });
}

/** Every reported root candidate shares a completed depth and a searched PV. */
export function analyzePosition(board, color, { timeLimitMs = 1600, maxDepth = 4, topN = 2, rootMoves } = {}) {
  const supplied = Number(timeLimitMs);
  const budget = Number.isFinite(supplied) && supplied > 0 ? Math.min(supplied, 5000) : 1600;
  return runSearch(board, color, {
    budget, maxDepth: Math.max(1, Math.min(8, Math.floor(maxDepth) || 4)),
    topN: Math.max(1, Math.min(20, Math.floor(topN) || 2)), rootMoves, compareRoots: true,
  });
}
