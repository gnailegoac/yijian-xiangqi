/**
 * Iterative deepening search, the root table of all moves, perft and the table helpers (contract section 4.5; specification in Appendix A3).
 *
 * The node search is a negamax principal variation search over the compact Position: transposition table, null move, late-move
 * reductions, check extension, quiescence that records its principal variation. The root is a plain loop that keeps one record
 * per root move ("the table") and can yield between root moves.
 *
 * Points the appendix leaves open, as implemented here:
 * - One root move (A3.6): the child position is searched by the same loop with its moves at ply 2, so mate distances and
 *   the repetition sign are those of the real root; the check-extension bound counts from the child (child iteration + 4 plies).
 * - Table cutoffs (A3.5, A3.3): a stored score needs stored depth >= depth, except a proven win as a lower bound and a
 *   proven loss as an upper bound, which hold at any depth. Scores in the repetition-ban band (WIN, BAN] depend on the
 *   path and never cut. The stored depth is the depth the node was asked for, before its check extension (A3.2 items 6, 7, 14).
 * - Repetition (A3.4 against the game rule of A4): a game position that the checked side re-creates by stepping back
 *   is a plain repetition, not the checker's loss; inside the tree the perpetual-check rule is as A3.4 writes it (see repValue).
 * - A `pass` result echoes the request's `fen`; its lines are the opponent's moves (`turn`).
 * - minDepth is at least 1: the first iteration always completes, so depth 0 with lines occurs only after a cancel.
 */

import { Position, HORSE, ROOK, CANNON, rowOf, colOf } from './position.js';

/** @import { Analysis, AnalyzeRequest, Color, MoveRef, RootLine } from './types.js' */

export const MATE = 30000, WIN = 29800;

/** A perpetual check is forbidden: it counts as the checker's loss (A3.4). */
const BAN = MATE - 100;
/** Window bound; larger than any score. */
const INF = 32000;
/** A node at this ply returns its static evaluation. */
const MAX_PLY = 63;
/** Largest iteration depth (the ply limit makes deeper iterations meaningless). */
const MAX_DEPTH = 60;
/** The clock and the cancel flag are read once per this many nodes. */
const POLL_NODES = 2048;
/** The root loop yields when more than this many milliseconds passed since the last yield. */
const YIELD_MS = 8;
const TT_LOWER = 1, TT_UPPER = 2, TT_EXACT = 3;
/** Move-ordering values by piece type; the king counts 2000. */
const ORDER_VALUE = [2000, 200, 200, 400, 900, 450, 100];
const HASH_SCORE = 1 << 30, CAPTURE_SCORE = 1 << 28, KILLER_SCORE = 1 << 27;
/** History counters stay below the killer score. */
const HISTORY_CAP = KILLER_SCORE - 1;
const START_POSITION = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

const now = () => performance.now();

/**
 * The only way to do arithmetic on scores: s >= WIN -> 2000, s <= -WIN -> -2000, else clamp(s, -1900, 1900).
 * @param {number} score
 * @returns {number} in [-2000, 2000]
 */
export function scoreToCp(score) {
  if (score >= WIN) return 2000;
  if (score <= -WIN) return -2000;
  return score > 1900 ? 1900 : score < -1900 ? -1900 : score;
}

/**
 * s >= WIN -> ceil((MATE - s) / 2), s <= -WIN -> -floor((MATE + s) / 2), else null.
 * The distance counts a side with no legal move as lost, in check or not (A3.2 item 13).
 * @param {number} score
 * @returns {number|null}
 */
export function mateIn(score) {
  if (score >= WIN) return Math.ceil((MATE - score) / 2);
  if (score <= -WIN) {
    const moves = Math.floor((MATE + score) / 2);
    return moves === 0 ? 0 : -moves;                  // never -0
  }
  return null;
}

/**
 * Value of a repeated position for the side to move at `ply` (A3.4).
 *
 * A score in the band (WIN, BAN] is a verdict of the perpetual-check rule and not a mate distance (mateIn gives 50 or
 * more for it).
 *
 * One case is read against the game rule of A4: `played` says that the earlier occurrence is a position of the game
 * history, so the checks of the cycle were (at least in part) really played. When the side to move is the one that
 * checked (rep 3), the position was re-created by the *other* side stepping back. In the game that step is a legal
 * repeat (A4 rule 2 forbids only the checker's own move that re-creates a position), so it is scored as a plain
 * repetition. Scored as the checker's loss, the step back of a king that is about to be mated would be reported as a
 * forced win, and a child's second check as a forced loss. Inside the tree (`played` false) the appendix's rule stands.
 * @param {number} rep a non-zero Position.repStatus()
 * @param {number} ply
 * @param {boolean} played the earlier occurrence lies in the seeded game history (Position.repAt < Position.seeded)
 * @returns {number}
 */
function repValue(rep, ply, played) {
  if (!(played && rep === 3)) {
    let v = 0;
    if (rep & 2) v += ply - BAN;     // the side to move has been checking every move: forbidden, counts as its loss
    if (rep & 4) v += BAN - ply;     // the opponent has been checking every move: counts as our win
    if (v !== 0) return v;
  }
  return (ply & 1) === 0 ? -20 : 20; // plain repetition: a draw the root side slightly dislikes
}

/** @param {number} mv @returns {MoveRef} */
function refOf(mv) {
  const from = mv & 255, to = (mv >> 8) & 255;
  return { from: { row: rowOf(from), col: colOf(from) }, to: { row: rowOf(to), col: colOf(to) } };
}

/** @param {number|undefined} value @param {number} fallback @param {number} lo @param {number} hi @returns {number} */
function intOption(value, fallback, lo, hi) {
  const v = value === undefined || Number.isNaN(value) ? fallback : Math.floor(value);
  return v < lo ? lo : v > hi ? hi : v;
}

/** @typedef {{cancelled:boolean, onDepth?:(r:Analysis) => void, yield?:() => Promise<void>}} SearchControl
 *  @typedef {Object} Searcher
 *  @property {(req:AnalyzeRequest, ctl?:SearchControl) => Promise<Analysis>} analyze
 *  @property {(req:AnalyzeRequest) => Analysis} analyzeSync
 *  @property {() => void} clear
 *  @property {() => {perftNps:number, speedClass:'fast'|'mid'|'slow'}} calibrate */

/** @param {{ttBits?:number, plain?:boolean}} [opts]  plain = no null move, no reductions, no table cutoffs (tests only) @returns {Searcher} */
export function createSearcher(opts) {
  /**
   * One root move while a search runs (local to this function: the module's type names are those of section 4.5).
   * @typedef {Object} Rec
   * @property {number} mv
   * @property {number} score       last exact score (the static glance before the first exact search)
   * @property {number} depth       last iteration in which the move was exact (0 = never)
   * @property {number|null} upper  bound from the last iteration in which the move was not exact
   * @property {number[]} pv        move integers, starting with mv
   * @property {number[]} byDepth
   * @property {number} naive
   * @property {number} repeats
   */
  const plain = opts?.plain === true;
  const ttSize = 1 << intOption(opts?.ttBits, 18, 4, 24);
  const ttMask = ttSize - 1;
  // Transposition table (A3.5): parallel typed arrays, 11 bytes per entry.
  const ttLock = new Int32Array(ttSize), ttMove = new Uint16Array(ttSize), ttScore = new Int16Array(ttSize);
  const ttDepth = new Int8Array(ttSize), ttFlag = new Uint8Array(ttSize), ttGen = new Uint8Array(ttSize);
  const history = new Int32Array(65536);
  const killers = new Int32Array(2 * (MAX_PLY + 2));
  const moveBuf = Array.from({ length: MAX_PLY + 2 }, () => new Int32Array(128));
  const scoreBuf = Array.from({ length: MAX_PLY + 2 }, () => new Int32Array(128));
  // Triangular principal variation table: pvTable[ply] holds the line from `ply` on, pvLen[ply] its length.
  const pvTable = Array.from({ length: MAX_PLY + 2 }, () => new Int32Array(MAX_PLY + 2));
  const pvLen = new Int32Array(MAX_PLY + 2);

  /** The position being searched; replaced by every analyze call. */
  let pos = Position.fromFen(START_POSITION);
  /** @type {SearchControl|undefined} */
  let control;
  let nodes = 0, nextPoll = POLL_NODES;
  let stop = false;
  /** @type {'time'|'nodes'|'cancel'} */
  let stopReason = 'time';
  /** False while an iteration <= minDepth runs: such iterations ignore the deadlines and the node budget. */
  let bounded = true;
  let hardDeadline = Infinity, panicDeadline = Infinity, safetyDeadline = Infinity, nodeLimit = Infinity;
  let panicArmed = false, panicUsed = false;
  /** Check extensions stop at this ply (A3.2 item 7). */
  let extLimit = 0;
  let generation = 0;
  /** Identifies the running analyze call; a call that finds another id after a yield has been superseded. */
  let runId = 0;

  /** The clock check of visit(): called once per POLL_NODES nodes, and exactly when the node budget is reached. */
  function poll() {
    nextPoll = nodes + POLL_NODES;
    if (control !== undefined && control.cancelled) {
      stop = true;
      stopReason = 'cancel';
      return;
    }
    const t = now();
    if (!bounded) {
      if (t >= safetyDeadline) {
        stop = true;
        stopReason = 'time';
      }
      return;
    }
    if (nodes >= nodeLimit) {
      stop = true;
      stopReason = 'nodes';
      return;
    }
    if (nodeLimit < nextPoll) nextPoll = nodeLimit;
    if (t >= hardDeadline) {
      if (panicArmed && !panicUsed) {                 // panic extension, once per call (A3.7)
        panicUsed = true;
        hardDeadline = panicDeadline;
        if (t < hardDeadline) return;
      }
      stop = true;
      stopReason = 'time';
    }
  }

  /** @param {number} ply @param {number} mv */
  function savePv(ply, mv) {
    const row = pvTable[ply], child = pvTable[ply + 1], n = pvLen[ply + 1];
    row[0] = mv;
    for (let i = 0; i < n; i++) row[i + 1] = child[i];
    pvLen[ply] = n + 1;
  }

  /**
   * Quiescence (A3.2): captures only, all evasions while in check (up to 8 quiescence plies). Records its PV.
   * @param {number} alpha @param {number} beta @param {number} ply @param {number} qply
   * @returns {number}
   */
  function quiesce(alpha, beta, ply, qply) {
    if (++nodes >= nextPoll) poll();
    if (stop) return 0;
    pvLen[ply] = 0;
    const p = pos;
    const rep = p.repStatus();
    if (rep !== 0) return repValue(rep, ply, p.repAt < p.seeded);
    if (ply >= MAX_PLY) return p.evaluate();
    const pvNode = beta - alpha !== 1;
    const standPat = qply >= 8 || !p.inCheck();
    let best = -INF;
    if (standPat) {
      best = p.evaluate();
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
    }
    const moves = moveBuf[ply], scores = scoreBuf[ply];
    const n = p.generate(moves, standPat);
    const sq = p.squares;
    for (let i = 0; i < n; i++) {
      const mv = moves[i], victim = sq[mv >> 8];
      scores[i] = victim !== 0 ? CAPTURE_SCORE + ORDER_VALUE[victim & 7] * 16 - ORDER_VALUE[sq[mv & 255] & 7] : 0;
    }
    let legal = 0;
    for (let i = 0; i < n; i++) {
      let bi = i, bs = scores[i];
      for (let j = i + 1; j < n; j++) {
        if (scores[j] > bs) {
          bs = scores[j];
          bi = j;
        }
      }
      const mv = moves[bi];
      if (bi !== i) {
        moves[bi] = moves[i];
        moves[i] = mv;
        scores[bi] = scores[i];
        scores[i] = bs;
      }
      if (!p.make(mv)) continue;
      legal++;
      const s = -quiesce(-beta, -alpha, ply + 1, qply + 1);
      p.unmake();
      if (stop) return 0;
      if (s > best) {
        best = s;
        if (s > alpha) {
          alpha = s;
          if (pvNode) savePv(ply, mv);
          if (s >= beta) break;
        }
      }
    }
    if (!standPat && legal === 0) return ply - MATE;   // in check with no legal move
    return best;
  }

  /**
   * The node search (A3.2).
   * @param {number} depth @param {number} alpha @param {number} beta @param {number} ply @param {boolean} allowNull
   * @returns {number}
   */
  function search(depth, alpha, beta, ply, allowNull) {
    if (depth <= 0) return quiesce(alpha, beta, ply, 0);
    if (++nodes >= nextPoll) poll();
    if (stop) return 0;
    pvLen[ply] = 0;
    const p = pos;
    const rep = p.repStatus();
    if (rep !== 0) return repValue(rep, ply, p.repAt < p.seeded);
    if (ply >= MAX_PLY) return p.evaluate();
    // Mate-distance pruning.
    if (alpha < ply - MATE) alpha = ply - MATE;
    if (beta > MATE - ply - 1) beta = MATE - ply - 1;
    if (alpha >= beta) return alpha;
    const pvNode = beta - alpha !== 1;

    // Transposition probe: the stored move always orders; the stored score cuts only at non-PV nodes.
    const slot = p.key & ttMask;
    const lock = p.lock;
    let hashMove = 0;
    if (ttFlag[slot] !== 0 && ttLock[slot] === lock) {
      hashMove = ttMove[slot];
      if (!pvNode && !plain) {
        let s = ttScore[slot];
        const flag = ttFlag[slot];
        const deep = ttDepth[slot] >= depth;
        let exactOk = deep, lowerOk = deep, upperOk = deep;
        if (s > WIN) {
          if (s <= BAN) exactOk = lowerOk = upperOk = false;   // a repetition ban depends on the path: never trusted
          else {
            s -= ply;                                          // back from "distance from this node"
            lowerOk = true;                                    // a proven win stays a win at any depth
          }
        } else if (s < -WIN) {
          if (s >= -BAN) exactOk = lowerOk = upperOk = false;
          else {
            s += ply;
            upperOk = true;                                    // a proven loss stays a loss at any depth
          }
        }
        if (flag === TT_EXACT) {
          if (exactOk || (lowerOk && s >= beta) || (upperOk && s <= alpha)) return s;
        } else if (flag === TT_LOWER) {
          if (lowerOk && s >= beta) return s;
        } else if (upperOk && s <= alpha) return s;
      }
    }

    // Check extension. The table keeps the depth the node was asked for (`asked`), which is what the probe above compares
    // with: storing the extended depth would let the entry of iteration d - 1 cut off this node in iteration d.
    const asked = depth;
    const inCheck = p.inCheck();
    if (inCheck && ply < extLimit) depth += 1;

    // Null move.
    if (!plain && !pvNode && !inCheck && allowNull && depth >= 2) {
      const own = p.count[p.side];
      if (own[ROOK] + own[CANNON] + own[HORSE] > 0 && p.evaluate() >= beta) {
        const R = depth >= 6 ? 3 : 2;
        p.makeNull();
        const s = -search(depth - 1 - R, -beta, -beta + 1, ply + 1, false);
        p.unmakeNull();
        if (stop) return 0;
        if (s >= beta && s < WIN) return s;
      }
    }

    const moves = moveBuf[ply], scores = scoreBuf[ply];
    const n = p.generate(moves, false);
    const sq = p.squares;
    const killer1 = killers[2 * ply], killer2 = killers[2 * ply + 1];
    for (let i = 0; i < n; i++) {
      const mv = moves[i];
      if (mv === hashMove) scores[i] = HASH_SCORE;
      else {
        const victim = sq[mv >> 8];
        if (victim !== 0) scores[i] = CAPTURE_SCORE + ORDER_VALUE[victim & 7] * 16 - ORDER_VALUE[sq[mv & 255] & 7];
        else if (mv === killer1) scores[i] = KILLER_SCORE + 1;
        else if (mv === killer2) scores[i] = KILLER_SCORE;
        else scores[i] = history[mv];
      }
    }

    let best = -INF, bestMove = 0, flag = TT_UPPER, legal = 0;
    for (let i = 0; i < n; i++) {
      // Lazy selection: swap the best remaining move to the front.
      let bi = i, bs = scores[i];
      for (let j = i + 1; j < n; j++) {
        if (scores[j] > bs) {
          bs = scores[j];
          bi = j;
        }
      }
      const mv = moves[bi];
      if (bi !== i) {
        moves[bi] = moves[i];
        moves[i] = mv;
        scores[bi] = scores[i];
        scores[i] = bs;
      }
      const capture = sq[mv >> 8] !== 0;
      if (!p.make(mv)) continue;
      legal++;
      let s;
      if (legal === 1) {
        s = -search(depth - 1, -beta, -alpha, ply + 1, true);
      } else {
        let r = 0;
        if (!plain && depth >= 3 && legal >= 5 && !capture && !inCheck && !p.inCheck()) r = legal >= 13 ? 2 : 1;
        s = -search(depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
        if (r > 0 && s > alpha) s = -search(depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (s > alpha && s < beta) s = -search(depth - 1, -beta, -alpha, ply + 1, true);
      }
      p.unmake();
      if (stop) return 0;
      if (s > best) {
        best = s;
        if (s > alpha) {
          alpha = s;
          bestMove = mv;
          flag = TT_EXACT;
          if (pvNode) savePv(ply, mv);
          if (s >= beta) {
            flag = TT_LOWER;
            if (!capture) {
              const h = history[mv] + depth * depth;
              history[mv] = h < HISTORY_CAP ? h : HISTORY_CAP;
              if (killers[2 * ply] !== mv) {
                killers[2 * ply + 1] = killers[2 * ply];
                killers[2 * ply] = mv;
              }
            }
            break;
          }
        }
      }
    }
    if (legal === 0) return ply - MATE;                 // checkmate and stalemate are both losses

    // Store; keep a deeper entry of the same position from this generation.
    if (!(ttFlag[slot] !== 0 && ttLock[slot] === lock && ttGen[slot] === generation && ttDepth[slot] > asked)) {
      if (bestMove === 0 && ttFlag[slot] !== 0 && ttLock[slot] === lock) bestMove = ttMove[slot];
      ttLock[slot] = lock;
      ttMove[slot] = bestMove;
      ttScore[slot] = best > WIN ? best + ply : best < -WIN ? best - ply : best;   // mate scores: distance from this node
      ttDepth[slot] = asked > 127 ? 127 : asked;
      ttFlag[slot] = flag;
      ttGen[slot] = generation;
    }
    return best;
  }

  /**
   * Exact score of the root move that was just made, searched to `depth`, if it is strictly above `floor`;
   * otherwise a value <= floor (A3.6).
   * @param {number} guess the move's last exact score (centre of the aspiration window)
   * @param {number} depth @param {number} floor @param {number} base ply of the position the move was made in
   * @returns {number}
   */
  function exactSearch(guess, depth, floor, base) {
    let lo = depth <= 2 ? floor : Math.max(guess - 40, floor);
    let hi = depth <= 2 ? INF : Math.min(guess + 40, INF);
    if (lo >= hi) hi = INF;
    for (;;) {
      const s = -search(depth - 1, -hi, -lo, base + 1, true);
      if (stop) return s;
      if (s <= lo && lo > floor) {      // failed low: reopen downwards
        lo = floor;
        continue;
      }
      if (s >= hi && hi < INF) {        // failed high: reopen upwards
        hi = INF;
        continue;
      }
      return s;                         // s <= floor here means "not above floor"
    }
  }

  /**
   * The analysis as a generator: it yields where the caller may let other tasks run (never when ctl has no yield hook).
   * @param {AnalyzeRequest} req
   * @param {SearchControl|undefined} ctl
   * @returns {Generator<void, Analysis, void>}
   */
  function* run(req, ctl) {
    const t0 = now();
    const timeMs = Math.max(0, Number(req.timeMs));
    if (Number.isNaN(timeMs)) throw new RangeError('timeMs is required');
    const maxDepth = intOption(req.maxDepth, 12, 1, MAX_DEPTH);
    // Iteration 1 always completes, so a result has depth 0 only when there is no legal move (or the call was cancelled at once).
    const minDepth = intOption(req.minDepth, 2, 1, maxDepth);
    const allDepth = intOption(req.allDepth, 0, 0, MAX_DEPTH);
    const multiPV = intOption(req.multiPV, 1, 1, 1024);
    const pvLength = intOption(req.pvLength, 8, 1, MAX_PLY);
    const maxNodes = req.maxNodes === undefined || Number.isNaN(req.maxNodes) ? Infinity : Math.max(0, req.maxNodes);

    const p = Position.fromFen(req.fen);
    if (p.attacked(p.kingSq[p.side ^ 1], p.side)) throw new RangeError('illegal position');
    const earlier = (req.history ?? []).map(fen => Position.fromFen(fen));
    if (req.history !== undefined && req.history.length > 0) p.seedHistory(req.history);

    // From here on this call owns the searcher's shared state.
    const myRun = ++runId;
    pos = p;
    control = ctl;
    nodes = 0;
    nextPoll = POLL_NODES;
    stop = false;
    bounded = true;
    panicArmed = false;
    panicUsed = false;
    hardDeadline = t0 + timeMs;
    panicDeadline = t0 + 2 * timeMs;
    safetyDeadline = t0 + Math.max(4 * timeMs, 1000);
    nodeLimit = maxNodes;
    generation = (generation + 1) & 255;
    killers.fill(0);
    for (let i = 0; i < history.length; i++) history[i] >>= 2;

    /** @type {Rec[]} */
    let order = [];
    let depthDone = 0, allDone = 0;
    let superseded = false;
    let nodesAtYield = 0;
    let lastYield = t0;
    /** @type {Color} */
    let turn = p.side === 0 ? 'red' : 'black';

    /** @param {Rec} rec @returns {RootLine} */
    const toRootLine = rec => ({
      move: refOf(rec.mv),
      score: rec.score,
      depth: rec.depth,
      upper: rec.depth < depthDone ? rec.upper : null,
      mate: mateIn(rec.score),
      pv: rec.pv.map(refOf),
      byDepth: rec.byDepth.slice(),
      naive: rec.naive,
      repeats: rec.repeats,
    });
    /** @param {Analysis['stopped']} stopped @returns {Analysis} */
    const report = stopped => ({
      fen: req.fen,
      turn,
      depth: depthDone,
      allDepth: allDone,
      lines: order.map(toRootLine),
      nodes: superseded ? nodesAtYield : nodes,
      timeMs: now() - t0,
      stopped,
    });

    if (ctl !== undefined && ctl.cancelled) return report('cancel');
    if (req.pass === true) {
      if (p.inCheck()) return report('in-check');
      p.makeNull();
      turn = p.side === 0 ? 'red' : 'black';
    }

    let rootMoves = p.legalMoves();
    if (req.rootMoves !== undefined) {
      const wanted = new Set(req.rootMoves.map(ref => p.fromRef(ref)));
      rootMoves = rootMoves.filter(mv => wanted.has(mv));
    }
    if (rootMoves.length === 0) return report('no-moves');

    /** @param {number} mv @returns {Rec} a record with the static glance and the repetition count of the move */
    const newRec = mv => {
      p.make(mv);
      const naive = 0 - p.evaluate();
      let repeats = 1;
      for (const e of earlier) if (e.key === p.key && e.lock === p.lock) repeats++;
      p.unmake();
      return { mv, score: naive, depth: 0, upper: null, pv: [mv], byDepth: [], naive, repeats };
    };
    order = rootMoves.map(newRec).sort((a, b) => b.naive - a.naive);

    /**
     * The principal variation behind a move that is made on the board: `first`, then the line of pvTable[row],
     * cut at the first move that is not legal (which must never happen) and at maxLen.
     * @param {number} first @param {number} row @param {number} maxLen @returns {number[]}
     */
    const readPv = (first, row, maxLen) => {
      const out = [first];
      const line = pvTable[row], len = pvLen[row];
      let made = 0;
      for (let k = 0; k < len && out.length < maxLen; k++) {
        const mv = line[k];
        if (!p.isLegal(mv)) break;
        p.make(mv);
        made++;
        out.push(mv);
      }
      while (made-- > 0) p.unmake();
      return out;
    };

    /**
     * One iteration of the root loop (A3.6) over `lines`, which are moves of the position at ply `base`.
     * Results are committed (and `lines` re-sorted) only when the iteration completes.
     * @param {Rec[]} lines in search order
     * @param {number} depth @param {number} base @param {boolean} all @param {number} K @param {number} pvMax
     * @returns {Generator<void, boolean, void>} false when the iteration was stopped and must be discarded
     */
    function* iterate(lines, depth, base, all, K, pvMax) {
      extLimit = 2 * depth + 4 + base;
      panicArmed = false;
      const n = lines.length;
      const exact = new Uint8Array(n);
      const value = new Int32Array(n);
      /** @type {number[][]} */
      const pvs = new Array(n);
      /** @type {number[]} */
      const exactScores = [];                                  // sorted descending
      for (let i = 0; i < n; i++) {
        const line = lines[i];
        if (ctl !== undefined && ctl.yield !== undefined && now() - lastYield > YIELD_MS) {
          nodesAtYield = nodes;
          yield;
          lastYield = now();
          if (runId !== myRun) {                               // another call took the searcher over while this one waited
            superseded = true;
            return false;
          }
          if (ctl.cancelled) {
            stop = true;
            stopReason = 'cancel';
            return false;
          }
        }
        p.make(line.mv);
        const kth = !all && exactScores.length >= K ? exactScores[K - 1] : -INF;
        let s;
        let isExact = true;
        if (kth > -INF) {
          s = -search(depth - 1, -kth - 1, -kth, base + 1, true);     // can this move enter the top K?
          if (!stop && s > kth) {
            s = exactSearch(line.score, depth, kth, base);
            isExact = s > kth;
          } else {
            isExact = false;
          }
        } else {
          s = exactSearch(line.score, depth, -INF, base);
        }
        if (!stop && isExact) pvs[i] = readPv(line.mv, base + 1, pvMax);
        p.unmake();
        if (stop) return false;
        if (isExact) {
          exact[i] = 1;
          value[i] = s;
          let at = exactScores.length;
          while (at > 0 && exactScores[at - 1] < s) at--;
          exactScores.splice(at, 0, s);
          // Panic extension: the previous best move was searched exactly and dropped by 100 cp or more.
          if (i === 0 && line.depth === depth - 1 && depth > 1 && scoreToCp(line.score) - scoreToCp(s) >= 100) panicArmed = true;
        } else {
          value[i] = Math.min(s, kth);                         // proven: the move is not above the K-th best
        }
      }
      for (let i = 0; i < n; i++) {
        const line = lines[i];
        if (exact[i] === 1) {
          line.score = value[i];
          line.depth = depth;
          line.upper = null;
          line.pv = pvs[i];
          if (line.byDepth.length === depth - 1) line.byDepth.push(value[i]);
        } else {
          line.upper = value[i];
        }
      }
      // Lines exact at this depth by score, then the rest by min(score, upper).
      lines.sort((a, b) => {
        const ea = a.depth === depth, eb = b.depth === depth;
        if (ea !== eb) return ea ? -1 : 1;
        if (ea) return b.score - a.score;
        return Math.min(b.score, b.upper ?? INF) - Math.min(a.score, a.upper ?? INF);
      });
      return true;
    }

    // One root move (A3.6): the move stays on the board and the child position is searched in best-only mode;
    // root iteration d is child iteration d - 1 and d = 1 is the child's quiescence value.
    const single = order.length === 1;
    /** @type {Rec[]} */
    let replies = [];
    let childRep = 0, childRepPlayed = false;
    if (single) {
      p.make(order[0].mv);
      childRep = p.repStatus();
      childRepPlayed = childRep !== 0 && p.repAt < p.seeded;
      replies = p.legalMoves().map(newRec).sort((a, b) => b.naive - a.naive);
    }
    /** @param {number} depth @returns {Generator<void, boolean, void>} */
    function* iterateSingle(depth) {
      const rec = order[0];
      let s;
      /** @type {number[]} */
      let pv;
      if (depth === 1) {
        extLimit = 2 * depth + 4;
        panicArmed = false;
        s = -search(0, -INF, INF, 1, true);
        if (stop) return false;
        pv = readPv(rec.mv, 1, pvLength);
      } else if (childRep !== 0) {
        s = -repValue(childRep, 1, childRepPlayed);
        pv = [rec.mv];
      } else if (replies.length === 0) {
        s = MATE - 1;
        pv = [rec.mv];
      } else {
        if (!(yield* iterate(replies, depth - 1, 1, false, 1, pvLength - 1))) return false;
        s = -replies[0].score;
        pv = [rec.mv, ...replies[0].pv].slice(0, pvLength);
      }
      const score = s | 0;                                     // an integer, and never -0
      rec.score = score;
      rec.depth = depth;
      rec.upper = null;
      rec.pv = pv;
      rec.byDepth.push(score);
      return true;
    }

    /** @type {Analysis['stopped']} */
    let stopped = 'depth';
    for (let depth = 1; depth <= maxDepth; depth++) {
      const mustFinish = depth <= minDepth;
      if (!mustFinish) {
        if (now() - t0 >= 0.5 * timeMs) {                      // do not start an iteration we cannot finish
          stopped = 'time';
          break;
        }
        if (nodes >= maxNodes) {
          stopped = 'nodes';
          break;
        }
      }
      bounded = !mustFinish;
      nextPoll = nodes + POLL_NODES;
      if (bounded && nodeLimit < nextPoll) nextPoll = nodeLimit;
      const all = single || depth <= allDepth || order.length <= multiPV;
      const completed = single ? yield* iterateSingle(depth) : yield* iterate(order, depth, 0, all, multiPV, pvLength);
      if (!completed) {
        stopped = superseded ? 'cancel' : stopReason;
        break;
      }
      depthDone = depth;
      if (all) allDone = depth;
      if (ctl !== undefined && ctl.onDepth !== undefined) ctl.onDepth(report('depth'));
      if (depth >= 3 && mateIn(order[0].score) !== null) {
        stopped = 'mate';
        break;
      }
    }
    return report(stopped);
  }

  /** @param {AnalyzeRequest} req @param {SearchControl} [ctl] @returns {Promise<Analysis>} */
  async function analyze(req, ctl) {
    const steps = run(req, ctl);
    let step = steps.next();
    while (!step.done) {
      if (ctl !== undefined && ctl.yield !== undefined) await ctl.yield();
      step = steps.next();
    }
    return step.value;
  }

  /** @param {AnalyzeRequest} req @returns {Analysis} */
  function analyzeSync(req) {
    const steps = run(req, undefined);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
  }

  /** Empty the transposition table and the move-ordering memory. */
  function clear() {
    ttLock.fill(0);
    ttMove.fill(0);
    ttScore.fill(0);
    ttDepth.fill(0);
    ttFlag.fill(0);
    ttGen.fill(0);
    history.fill(0);
    killers.fill(0);
  }

  /** @returns {{perftNps:number, speedClass:'fast'|'mid'|'slow'}} */
  function calibrate() {
    let best = 0;
    for (let run = 0; run < 3; run++) {
      const t0 = now();
      const leaves = perft(START_POSITION, 3);
      const ms = Math.max(now() - t0, 0.05);
      best = Math.max(best, leaves / ms * 1000);
    }
    return { perftNps: Math.round(best), speedClass: best >= 3e6 ? 'fast' : best >= 1e6 ? 'mid' : 'slow' };
  }

  return { analyze, analyzeSync, clear, calibrate };
}

/** @param {string} fen @param {number} depth @returns {number} leaf count */
export function perft(fen, depth) {
  const pos = Position.fromFen(fen);
  /** @type {Int32Array[]} */
  const bufs = [];
  /** @param {number} d @returns {number} */
  const walk = d => {
    const buf = bufs[d] ?? (bufs[d] = new Int32Array(128));
    const n = pos.generate(buf, false);
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (!pos.make(buf[i])) continue;
      total += d === 1 ? 1 : walk(d - 1);
      pos.unmake();
    }
    return total;
  };
  return depth <= 0 ? 1 : walk(Math.floor(depth));
}

// table helpers (pure; used by facts.js and teacher.js)

/** The line of `move` in the table, or null. @param {Analysis} table @param {MoveRef} move @returns {RootLine|null} */
export function lineOf(table, move) {
  for (const line of table.lines) {
    const m = line.move;
    if (m.from.row === move.from.row && m.from.col === move.from.col && m.to.row === move.to.row && m.to.col === move.to.col) return line;
  }
  return null;
}

/**
 * How deep one must look for the score to stay within 60 cp of `final`.
 *  sense 'bad':  1 + (largest d with byDepth[d-1] > final + 60, or 0)      (how far ahead the punishment lies)
 *  sense 'good': 1 + (largest d with byDepth[d-1] < final - 60, or 0)      (how deep to see why it is good)
 * Scores are compared as centipawns (scoreToCp).
 * @param {number[]} byDepth
 * @param {number} final
 * @param {'bad'|'good'} sense
 * @returns {number}
 */
export function revealDepth(byDepth, final, sense) {
  const target = scoreToCp(final);
  for (let d = byDepth.length; d >= 1; d--) {
    const cp = scoreToCp(byDepth[d - 1]);
    if (sense === 'bad' ? cp > target + 60 : cp < target - 60) return d + 1;
  }
  return 1;
}

/** 1 = reveal 1-2, 2 = reveal 3-4, 3 = deeper. @param {number} depth @returns {1|2|3} */
export function revealTier(depth) {
  return depth <= 2 ? 1 : depth <= 4 ? 2 : 3;
}

/**
 * First all-exact depth d at which every line of `group` beats every other line by >= 100 cp; table.allDepth + 1 if never.
 * Scores are compared as centipawns (scoreToCp).
 * @param {Analysis} table
 * @param {RootLine[]} group
 * @returns {number}
 */
export function separationDepth(table, group) {
  const inGroup = new Set(group.map(line => lineOf(table, line.move)));
  for (let d = 1; d <= table.allDepth; d++) {
    let weakest = Infinity, strongestOther = -Infinity;
    for (const line of table.lines) {
      const cp = scoreToCp(line.byDepth[d - 1]);
      if (inGroup.has(line)) weakest = Math.min(weakest, cp);
      else strongestOther = Math.max(strongestOther, cp);
    }
    if (weakest - strongestOther >= 100) return d;
  }
  return table.allDepth + 1;
}
