// Seeded random playouts on the rules engine (F0, frozen).
// Uses the v1 engine API only (createInitialBoard, getLegalMoves, applyMove), so every position is reached by legal play.
// Deterministic: the same options give the same positions as long as getLegalMoves keeps its move order.
import { createInitialBoard, getLegalMoves, applyMove } from '../../src/core/engine.js';

/** @typedef {import('../../src/core/types.js').Board} Board */
/** @typedef {import('../../src/core/types.js').Color} Color */
/** @typedef {import('../../src/core/types.js').Move} Move */

/**
 * @typedef {Object} PlayoutPosition
 * @property {Board} board
 * @property {Color} turn          the side to move
 * @property {number} ply          plies played since the start position of the playout (0 = the start position itself)
 * @property {Move|null} move      the move that led here; null at ply 0
 * @property {Move[]} moves        getLegalMoves(board, turn); empty when the playout ended here by mate or stalemate
 *
 * @typedef {Object} PlayoutOptions
 * @property {number} [seed=1]     uint32 seed of the generator
 * @property {number} [plies=200]  maximum number of plies; the playout stops earlier when the side to move has no legal move
 * @property {number} [pawnBias=0] probability 0..1 that a ply is forced to be a pawn move when one is legal
 *                                 (Appendix A3.11 uses 0.35 so that pawns reach the palaces)
 * @property {Board} [board]       start position; default createInitialBoard()
 * @property {Color} [turn='red']  side to move in the start position
 */

/**
 * mulberry32: a small seeded generator, uniform in [0, 1).
 * @param {number} seed uint32
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One random game: every position from the start position to the last one reached, in order.
 * The result has at most `plies + 1` entries; its first entry is the start position.
 * @param {PlayoutOptions} [options]
 * @returns {PlayoutPosition[]}
 */
export function playout(options = {}) {
  const { seed = 1, plies = 200, pawnBias = 0 } = options;
  const rng = mulberry32(seed);
  /** @type {Board} */
  let board = options.board ?? createInitialBoard();
  /** @type {Color} */
  let turn = options.turn ?? 'red';
  /** @type {Move|null} */
  let last = null;
  /** @type {PlayoutPosition[]} */
  const positions = [];
  for (let ply = 0; ; ply++) {
    /** @type {Move[]} */
    const moves = getLegalMoves(board, turn);
    positions.push({ board, turn, ply, move: last, moves });
    if (ply >= plies || moves.length === 0) break;
    let pool = moves;
    if (pawnBias > 0 && rng() < pawnBias) {
      const pawnMoves = moves.filter(m => m.piece.type === 'pawn');
      if (pawnMoves.length > 0) pool = pawnMoves;
    }
    const move = pool[Math.floor(rng() * pool.length)];
    board = applyMove(board, move);
    turn = turn === 'red' ? 'black' : 'red';
    last = move;
  }
  return positions;
}

/**
 * `count` positions drawn from consecutive playouts (seeds seed, seed + 1, …).
 * The start position comes first and only once; after it every `stride`-th ply of each playout is taken, in order.
 * @param {number} count
 * @param {PlayoutOptions & {stride?: number}} [options]  stride default 1 (every position)
 * @returns {PlayoutPosition[]}
 */
export function playoutPositions(count, options = {}) {
  const { seed = 1, stride = 1, ...rest } = options;
  if (!Number.isInteger(stride) || stride < 1) throw new RangeError('stride must be a positive integer');
  /** @type {PlayoutPosition[]} */
  const out = [];
  let barren = 0;
  for (let game = 0; out.length < count; game++) {
    const positions = playout({ ...rest, seed: (seed + game) >>> 0 });
    const before = out.length;
    if (game === 0) out.push(positions[0]);
    for (let i = stride; i < positions.length && out.length < count; i += stride) out.push(positions[i]);
    barren = out.length === before ? barren + 1 : 0;
    if (barren >= 100) throw new RangeError('playouts yield no positions (stride exceeds their length)');
  }
  return out;
}
