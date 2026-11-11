/**
 * Position facts, move facts, patterns, assessment and hints (contract section 4.6; rules in Appendix A6).
 * Facts are data; no sentence is built here. Everything returned is plain JSON.
 *
 * This module is the factual ground of what the strategist says, so every rule below is computed on the board with real
 * make / unmake (static exchange, legality, mates) and nothing is guessed. Points the contract leaves open, as implemented here:
 *
 * - FENs in results (`fen`, `fenBefore`, `fenAfter`) are normalised to "placement w|b", the form of `Line.start`.
 * - Hanging while the side to move is in check (A6.1). A piece of the checked side that an enemy piece attacks is
 *   hanging when the other side can take it with profit (>= 100) once the check is answered: after every legal answer
 *   (the gain is then the smallest such profit), or else after every answer that leaves the piece where it is with the
 *   attackers and defenders it has now (the gain is the smallest profit over those answers), provided there is such an
 *   answer. The second case is the piece that is attacked together with the king and can still be saved by the right
 *   answer (taking the attacker, covering the piece, moving it): it is en prise, and the child must be told so.
 *   The null-move computation of the appendix alone would also report a guarded piece that merely stands attacked
 *   while its king is in check, although the recapture is legal again as soon as the check is answered, and it
 *   would miss a piece whose only guard is the king that has to step away. Relative pins of the checked side are not
 *   reported for the same reason; absolute pins need "side not in check" by the appendix.
 * - Exchange values (hanging, capture.see, cannon aims, pins, the capture that is pending at the end of a line) are the
 *   exact minimax of the captures on the square. Position.see (A2.4) tries only the least valuable recapture and is off in rare cases; see
 *   exchangeValue.
 * - Relative pin (A6.1): the capture on the shielded piece must be one that lifting the pinned piece makes possible
 *   (the attacker did not attack it before) and the attacker is a rook, cannon or horse, which is what `Pin.kind` can name.
 * - `capture.exchange` (A6.2): 'wins' from +50, 'even' inside +-50, 'loses' from -50 (the three ranges cover every value).
 * - `threats[].discovered` (A6.2): the attacker is not the moved piece and the moved piece stood in its way before the
 *   move. A threat that another piece gains because the moved piece now supports it, serves as its cannon screen or took
 *   a defender away is not a discovered attack.
 * - `parried.how` (A6.2): 'blocked' only when the moved piece really stands between an attacker and the piece (or on the
 *   horse's leg / the elephant's eye); a piece that is safe for another reason (the attacker's screen left, the attacker is
 *   pinned, the king cannot take a guarded piece) is 'defended'. When the move gives check and the piece is still attacked,
 *   the capture is only postponed and no parry is reported.
 * - A move that ends the game (no legal reply) has no `threats` and no `fork`: there is no next turn.
 * - Moves around a check (A6.2 diffs the facts of two positions, and the facts of a position in check are narrower: only
 *   captures that answer the check are legal, and no relative pin can be used). A move that answers a check is not
 *   credited with what stood before it: an attack with the same attackers and guards as before is no new `threat` (so no
 *   `fork` either), and a pin whose line stood before is neither `created` nor `suffered`. A move that gives check
 *   does not release a relative pin whose line still stands.
 * - `materialOutcome` (4.6.3, as CONTRACT-NOTES item 150 overrules it): the balance of a line is what the line does.
 *   Without an explicit `maxPlies` the whole line is walked (not six plies of a line that has seven or eight). The static
 *   tail adds material only where the line ends cut (or where an explicit `maxPlies` stopped the walk), and never what
 *   the other side takes back: it is the main line of a minimax over the captures from there on, material only, in
 *   which each side may also stop (`settleCaptures`). That is what the search's own quiescence did behind the cut, so
 *   a capture that is answered by an equal or better capture elsewhere is not counted, and one that is answered by a
 *   smaller one is counted with the answer. A line with no move at all is asked only by brain.js, to learn whether a
 *   capture is pending at the end of a principal variation (it marks the line 'cut' then): there the answer stays the
 *   best pending capture and the exchange on its square.
 * - A line with |mate| >= 50 carries a repetition verdict and is never treated as a mate (CONTRACT-NOTES item 88).
 * - `Line.end` 'mate' means "the side to move has no legal move" (item 89); the mates reported by `positionFacts` are
 *   checkmates only (the checks-only search of A6.1), and each is replayed by the rules engine before it is reported.
 * - `flags.sacrifice` (4.6.1, A6.4): the piece that is given is the moved piece (the reply takes it), and there must be
 *   compensation (a mate, or an evaluation within a pawn of the static one before the move); a piece that is left to be
 *   taken elsewhere, or material that is lost whatever the mover plays, is not a sacrifice.
 * - `refutation.reply` is `line.moves[1]`; when the search line stops at the move (it runs into a repeated position) the
 *   reply is the opponent's best capture, else its best move by static evaluation.
 * - `threatInfo`: `outcome` is the rival's (the mover of the line). When the checks-only scan knows a mate that the pass
 *   search does not (or only a slower one), `line` is that mate. A threat is a mate only when it is proven (search score
 *   or scan), not when a line merely ends without a legal move at the horizon.
 * - The formation `central_cannon` needs `opts.ply` (it is reported only while ply <= 30).
 * - Played patterns are listed most specific first: the four named checking shapes, then (on a checkmate) the four mating
 *   patterns, then discovered check, double check and the forks; a threatened mate-in-one adds its pattern with stage 'threat'.
 * - The search-backed `double_rooks` (A6.4) needs a line that ends in checkmate; a line whose last rook move leaves the
 *   king without a legal move but not in check (困毙, which `Line.end` also calls 'mate') is not the pattern.
 * - Differences between two moves (CONTRACT-NOTES item 147). `scoreToCp` clamps every score that is no mate to +-1900, so
 *   beyond that every move reads the same and a move that gave a rook away would cost nothing. Wherever two scores are
 *   compared to decide what the child is told (the loss and the category of a move, `isBest`, the sacrifice's
 *   compensation, `onlyMove`, `missedWin`, the alternatives of an assessment and of a hint, the group and the tier of a
 *   tactical test, the greedy trap), the difference is that of the search scores themselves; only when one of the two is
 *   a mate score (a mate or a repetition verdict) is it the difference of their centipawn values, as section 4.6.1 has
 *   it (`scoreGap`). What is stored and shown (`bestCp`, `moveCp`) stays clamped; `loss` is the true difference.
 * - Two cases in which the score of a move is not what the move costs (CONTRACT-NOTES item 150). (1) The better move
 *   mates and the tried one does not: the difference to a mate score is 100 for every move that stays above +1900, so
 *   the loss is at least what the tried move's own line gives away (`assessMove`), and `quickVerdict`, which has no
 *   line, also measures the move against the static evaluation of the position: what the mover holds when nothing is
 *   given away. (Measured against the best line of the table that is no mate, the first face was 失误 or 漏着 for half
 *   of the moves that lose nothing wherever that line wins a piece, and the assessment 稳健 a moment later.)
 *   (2) The tried move's line only
 *   re-creates the position before it within four plies: the search scores the first return as a repetition, but the
 *   mover has lost a turn and nothing else. The loss is then at most the smallest one that is 缓着 at the level and
 *   `moveCp` is `bestCp` (the mover stands as before); `quickVerdict` gives no verdict for such a line. A return that
 *   is the best there is, and a mate score, are left as they are.
 */

import { CROSSED_PAWN_VALUE, PATTERN_NAME, PIECE_POINTS, PIECE_VALUE } from './codes.js';
import { applyMove, boardToFen, fenToBoard } from './engine.js';
import { describeMove, pieceRef, toLine } from './notation.js';
import { Position, KING, ELEPHANT, HORSE, ROOK, CANNON, PAWN, TYPE_NAME, sqOf, rowOf, colOf, mkMove, mvFrom, mvTo } from './position.js';
import { WIN, lineOf, mateIn, revealDepth, revealTier, scoreToCp } from './search.js';

/** @import { Cat, DangerCode, HabitCode, HintTheme, PatternCode } from './codes.js' */
/** @import { Analysis, Block, Board, CannonAim, Color, Exposed, Flight, Hanging, Hint, KingFacts, Line, MateThreat, MaterialOutcome, MoveAssessment, MoveFacts, MoveInfo, MoveRef, MoveTag, NewThreat, Open, Parry, Pattern, PieceRef, PieceStatus, PieceType, Pin, PositionFacts, Quick, Refutation, RootLine, Square, TacticalTest, ThreatInfo } from './types.js' */

// ---------------------------------------------------------------------------------------------------------------
// small helpers on the compact board
// ---------------------------------------------------------------------------------------------------------------

/** Colour of a side index of position.js (0 red, 1 black). @type {readonly Color[]} */
const COLOR = ['red', 'black'];
const ORTHO = [-16, -1, 1, 16];
const DIAG = [-17, -15, 15, 17];
/** Horse jumps, two per leg: the leg of HORSE_JUMP[2 * i] and HORSE_JUMP[2 * i + 1] is ORTHO[i]. */
const HORSE_JUMP = [-33, -31, -18, 14, -14, 18, 31, 33];
/** 1 on the 90 board squares. */
const ON_BOARD = new Uint8Array(256);
for (let row = 0; row < 10; row++) {
  for (let col = 0; col < 9; col++) ON_BOARD[sqOf(row, col)] = 1;
}
/** `Pin.kind` by the type of the pinning piece. @type {Readonly<Record<number, Pin['kind']>>} */
const PIN_KIND = { [ROOK]: 'rook', [CANNON]: 'cannon', [HORSE]: 'horse', [KING]: 'kings' };
/** Default `pvLength` of an AnalyzeRequest (section 3.2); brain.js never overrides it. A PV of this length may be truncated. */
const PV_LENGTH = 8;
/** mateIn() of a repetition-ban score is 50 or more (CONTRACT-NOTES item 88). */
const REPETITION_MATE = 50;
/** A move made when the side to move had at most this many legal moves is forced (CONTRACT-NOTES item 138). */
const FORCED_MOVES = 2;

/** @param {Color} color @returns {number} side index of position.js */
const sideOf = color => (color === 'red' ? 0 : 1);
/** @param {Color} color @returns {Color} */
const otherColor = color => (color === 'red' ? 'black' : 'red');
/** @param {number} sq @returns {Square} */
const squareOf = sq => ({ row: rowOf(sq), col: colOf(sq) });
/** @param {Square} s @returns {number} */
const sqAt = s => sqOf(s.row, s.col);
/** @param {Square} a @param {Square} b @returns {boolean} */
const sameSquare = (a, b) => a.row === b.row && a.col === b.col;
/** @param {MoveRef} a @param {MoveRef} b @returns {boolean} */
const sameMove = (a, b) => sameSquare(a.from, b.from) && sameSquare(a.to, b.to);

/** @param {unknown} s @returns {s is Square} */
function isSquare(s) {
  if (typeof s !== 'object' || s === null) return false;
  const { row, col } = /** @type {{row?:unknown, col?:unknown}} */ (s);
  return typeof row === 'number' && typeof col === 'number' && Number.isInteger(row) && Number.isInteger(col)
    && row >= 0 && row < 10 && col >= 0 && col < 9;
}

/** Material of a piece in centipawns; a pawn across the river counts CROSSED_PAWN_VALUE. @param {number} pc @param {number} sq @returns {number} */
function valueAt(pc, sq) {
  const type = pc & 7;
  if (type !== PAWN) return PIECE_VALUE[TYPE_NAME[type]];
  return (pc < 16 ? sq < 0x80 : sq >= 0x80) ? CROSSED_PAWN_VALUE : PIECE_VALUE.pawn;
}

/** Material of a piece in points. @param {number} pc @param {number} sq @returns {number} */
function pointsAt(pc, sq) {
  const type = pc & 7;
  if (type !== PAWN) return PIECE_POINTS[TYPE_NAME[type]];
  return (pc < 16 ? sq < 0x80 : sq >= 0x80) ? CROSSED_PAWN_VALUE / 100 : PIECE_POINTS.pawn;
}

/** @param {number} sq @param {number} side @returns {boolean} `sq` lies in the palace of `side` */
function inPalace(sq, side) {
  const row = rowOf(sq), col = colOf(sq);
  return col >= 3 && col <= 5 && (side === 0 ? row >= 7 && row <= 9 : row >= 0 && row <= 2);
}

/**
 * The occupied squares strictly between two squares of one rank or file, nearest to `a` first; null when the squares
 * are not on one line.
 * @param {Uint8Array} b @param {number} a @param {number} c @returns {number[]|null}
 */
function between(b, a, c) {
  let d;
  if (a === c) return null;
  if ((a >> 4) === (c >> 4)) d = c > a ? 1 : -1;
  else if ((a & 15) === (c & 15)) d = c > a ? 16 : -16;
  else return null;
  const out = [];
  for (let s = a + d; s !== c; s += d) {
    if (b[s] !== 0) out.push(s);
  }
  return out;
}

/** @param {number} a @param {number} mid @param {number} c @returns {boolean} `mid` lies strictly between `a` and `c` on one rank or file */
function liesBetween(a, mid, c) {
  if ((a >> 4) === (c >> 4) && (mid >> 4) === (a >> 4)) return (mid > a && mid < c) || (mid < a && mid > c);
  if ((a & 15) === (c & 15) && (mid & 15) === (a & 15)) return (mid > a && mid < c) || (mid < a && mid > c);
  return false;
}

/** The leg square of a horse jump from `horse` to `target`, or -1 when that is not a horse jump. @param {number} horse @param {number} target @returns {number} */
function legOf(horse, target) {
  const j = HORSE_JUMP.indexOf(target - horse);
  return j < 0 ? -1 : horse + ORTHO[j >> 1];
}

/**
 * Does a piece standing on `mid` cut the attack of the piece of type `type` on `attacker` against `target`?
 * Rook, cannon and king: `mid` lies between them; horse: `mid` is the leg; elephant: `mid` is the eye.
 * @param {number} type @param {number} attacker @param {number} target @param {number} mid @returns {boolean}
 */
function cutsAttack(type, attacker, target, mid) {
  if (type === ROOK || type === CANNON || type === KING) return liesBetween(attacker, mid, target);
  if (type === HORSE) return legOf(attacker, target) === mid;
  if (type === ELEPHANT) return Math.abs(target - attacker) === 2 * Math.abs(mid - attacker) && attacker + (target - attacker) / 2 === mid
    && DIAG.includes(mid - attacker);
  return false;
}

/**
 * Where a piece stands as its owner sees the board: rows counted from the owner's far side, then the column. Ties are
 * broken by this number, so that a position and its colour-swapped mirror image give the same facts.
 * @param {number} pc @param {number} sq @returns {number}
 */
function ownView(pc, sq) {
  return (pc < 16 ? rowOf(sq) : 9 - rowOf(sq)) * 9 + colOf(sq);
}

/** Squares sorted by the value of the piece on them, cheapest first; equal pieces in the order of ownView. @param {Uint8Array} b @param {number[]} list @returns {number[]} */
function cheapestFirst(b, list) {
  return list.slice().sort((x, y) => valueAt(b[x], x) - valueAt(b[y], y) || ownView(b[x], x) - ownView(b[y], y));
}

/** @template T @param {T[]} list @returns {T[]} the list without repeated members, first occurrences kept */
function unique(list) {
  return list.filter((item, i) => list.indexOf(item) === i);
}

/** @param {number[]} a @param {number[]} c two lists without repetitions @returns {boolean} they hold the same members */
function sameMembers(a, c) {
  return a.length === c.length && a.every(item => c.includes(item));
}

/** @param {Square[]} list @returns {Square[]} the squares without repetitions */
function uniqueSquares(list) {
  return list.filter((s, i) => list.findIndex(t => sameSquare(s, t)) === i);
}

/** A memo of pieceRef() for one board. @param {Board} board @returns {(sq:number) => PieceRef} */
function refCache(board) {
  /** @type {Map<number, PieceRef>} */
  const cache = new Map();
  return sq => {
    let r = cache.get(sq);
    if (r === undefined) {
      r = pieceRef(board, squareOf(sq));
      cache.set(sq, r);
    }
    return r;
  };
}

/** A real mate distance of a score, or null: mateIn() without the repetition verdicts. @param {number} score @returns {number|null} */
function realMate(score) {
  const m = mateIn(score);
  return m !== null && Math.abs(m) < REPETITION_MATE ? m : null;
}

// ---------------------------------------------------------------------------------------------------------------
// static exchange on one square
// ---------------------------------------------------------------------------------------------------------------

/**
 * The best the side to move can win by capturing on `target`, or 0 when it declines: the exact minimax over the
 * captures on that square, every legal capturer tried.
 * @param {Position} pos @param {number} target @returns {number} >= 0
 */
function bestCaptureExact(pos, target) {
  const b = pos.squares;
  const victim = valueAt(b[target], target);
  let best = 0;
  for (const from of pos.attackers(target, pos.side)) {
    if (!pos.make(mkMove(from, target))) continue;
    const v = victim - bestCaptureExact(pos, target);
    pos.unmake();
    if (v > best) best = v;
  }
  return best;
}

/**
 * Value for the mover of playing `mv` and then the best sequence of captures on its destination: the static exchange
 * value of Appendix A2.4, computed exactly. Position.see lets each side recapture with its least valuable piece only;
 * where a side has a better capture (say the king instead of a rook that would be lost in turn) its value is off, and
 * a fact built on it would call a piece winnable that is not. The two agree in all but about one capture in two thousand.
 * @param {Position} pos @param {number} mv a pseudo-legal move of the side to move
 * @returns {number} cp for the mover (-Infinity for an illegal move)
 */
function exchangeValue(pos, mv) {
  const b = pos.squares;
  const from = mvFrom(mv), target = mvTo(mv);
  const self = 8 << pos.side;
  if ((b[from] & self) === 0 || (b[target] & self) !== 0) return -Infinity;
  const gain = b[target] !== 0 ? valueAt(b[target], target) : 0;
  if (!pos.make(mv)) return -Infinity;
  const value = gain - bestCaptureExact(pos, target);
  pos.unmake();
  return value;
}

/**
 * Play the exchange that starts with `mv` and report every capture of it: `mv` itself, then for each side its best
 * recapture on that square for as long as it gains by it (the minimax line of bestCaptureExact). The position is restored.
 * @param {Position} pos @param {number} mv a legal capture of the side to move
 * @param {(victim:number, sq:number, capturer:number) => void} record called with the captured piece code, its square and the capturing side
 * @returns {void}
 */
function playExchange(pos, mv, record) {
  const b = pos.squares;
  const target = mvTo(mv);
  let made = 0;
  let next = mv;
  while (next !== 0) {
    const victim = b[target], capturer = pos.side;
    if (!pos.make(next)) break;
    made++;
    record(victim, target, capturer);
    next = 0;
    const value = valueAt(b[target], target);
    let bestGain = 0;
    for (const from of cheapestFirst(b, pos.attackers(target, pos.side))) {
      const reply = mkMove(from, target);
      if (!pos.make(reply)) continue;
      const v = value - bestCaptureExact(pos, target);
      pos.unmake();
      if (v > bestGain) {
        bestGain = v;
        next = reply;
      }
    }
  }
  while (made-- > 0) pos.unmake();
}

/**
 * The legal capture of the side to move with the largest exchange value, when that value is at least 100.
 * Captures of a king are ignored.
 * @param {Position} pos @returns {{mv:number, see:number}|null}
 */
function bestPendingCapture(pos) {
  const b = pos.squares;
  const buf = new Int32Array(128);
  const n = pos.generate(buf, true);
  let best = 0, bestSee = 99;
  for (let i = 0; i < n; i++) {
    const mv = buf[i];
    if ((b[mvTo(mv)] & 7) === KING) continue;
    const see = exchangeValue(pos, mv);
    if (see > bestSee) {
      bestSee = see;
      best = mv;
    }
  }
  return best === 0 ? null : { mv: best, see: bestSee };
}

/** The static tail of materialOutcome looks at most this many captures ahead. */
const SETTLE_PLIES = 6;
/** ... and counts nothing when the captures from the end of a line make more positions than this (never seen above 100). */
const SETTLE_NODES = 2000;

/**
 * What the side to move wins from here on by captures alone, when both sides capture or stop as suits them: the minimax
 * of the material over the legal captures (a king is never taken), with the right to stop at every turn. It is the
 * quiescence of the search with material in the place of the evaluation, and so it settles a line that was cut the way
 * the search itself went on: a capture that the other side answers by taking as much or more elsewhere is not made, a
 * piece that is taken back is counted with what took it. At the last ply of the horizon a capture counts only when
 * nothing can profitably take back on its square.
 * @param {Position} pos @param {number} depth captures still to look ahead
 * @param {number} alpha @param {number} beta the window, in cp for the side to move
 * @param {{left:number}} budget positions that may still be visited; the result is void once it is used up
 * @returns {{value:number, pv:number[]}} cp >= 0 for the side to move, and the captures of the main line
 */
function settleCaptures(pos, depth, alpha, beta, budget) {
  /** @type {{value:number, pv:number[]}} */
  let best = { value: 0, pv: [] };                         // stopping here
  if (depth <= 0 || best.value >= beta) return best;
  if (best.value > alpha) alpha = best.value;
  const b = pos.squares;
  const buf = new Int32Array(128);
  const n = pos.generate(buf, true);
  /** Captures, the most valuable victim first, then the cheapest capturer; equal ones as the mover sees the board. @type {{mv:number, gain:number, order:number}[]} */
  const captures = [];
  for (let i = 0; i < n; i++) {
    const mv = buf[i], from = mvFrom(mv), to = mvTo(mv);
    if ((b[to] & 7) === KING) continue;
    const gain = valueAt(b[to], to);
    captures.push({ mv, gain, order: (valueAt(b[from], from) * 128 + ownView(b[from], from)) * 128 + ownView(b[from], to) });
  }
  captures.sort((x, y) => y.gain - x.gain || x.order - y.order);
  for (const capture of captures) {
    if (budget.left <= 0) break;
    if (!pos.make(capture.mv)) continue;
    budget.left--;
    /** @type {{value:number, pv:number[]}} */
    let answer;
    if (depth > 1) answer = settleCaptures(pos, depth - 1, capture.gain - beta, capture.gain - alpha, budget);
    else answer = { value: bestCaptureExact(pos, mvTo(capture.mv)) > 0 ? Infinity : 0, pv: [] };
    pos.unmake();
    const value = capture.gain - answer.value;
    if (value > best.value) {
      best = { value, pv: [capture.mv, ...answer.pv] };
      if (value > alpha) alpha = value;
      if (value >= beta) break;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// king flights
// ---------------------------------------------------------------------------------------------------------------

/**
 * The king-adjacent palace squares of the king of `side`, which must be the side to move (A6.1 "kings").
 * `by` is a square or -1.
 * @param {Position} pos @param {number} side
 * @returns {{to:number, state:Flight['state'], by:number}[]}
 */
function flightsOf(pos, side) {
  const b = pos.squares;
  const king = pos.kingSq[side], kingPc = b[king];
  const enemy = side ^ 1, ownTag = 8 << side;
  /** @type {{to:number, state:Flight['state'], by:number}[]} */
  const out = [];
  for (const d of ORTHO) {
    const to = king + d;
    if (!inPalace(to, side)) continue;
    const occupant = b[to];
    if ((occupant & ownTag) !== 0) {
      out.push({ to, state: 'own', by: -1 });
      continue;
    }
    if (pos.make(mkMove(king, to))) {
      pos.unmake();
      out.push({ to, state: 'free', by: -1 });
      continue;
    }
    // Illegal: who attacks the square with the king placed there?
    b[king] = 0;
    b[to] = kingPc;
    const attackers = pos.attackers(to, enemy);
    b[to] = occupant;
    b[king] = kingPc;
    if (attackers.length === 1 && attackers[0] === pos.kingSq[enemy]) {
      out.push({ to, state: 'facing', by: attackers[0] });
    } else {
      const others = attackers.filter(s => s !== pos.kingSq[enemy]);
      out.push({ to, state: 'attacked', by: others.length > 0 ? cheapestFirst(b, others)[0] : -1 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// mate by checks (A6.1 "mates")
// ---------------------------------------------------------------------------------------------------------------

/**
 * Can this move give check to the king on `king`? A cheap necessary condition (never wrong the other way): the move
 * starts or ends on the king's rank or file (rook, cannon, a screen or a blocker), ends within two points of the king
 * (horse, pawn), or starts next to the king (a horse's leg).
 * @param {number} mv @param {number} king @returns {boolean}
 */
function mayCheck(mv, king) {
  const from = mv & 255, to = (mv >> 8) & 255;
  const kr = king >> 4, kc = king & 15;
  const fr = from >> 4, fc = from & 15, tr = to >> 4, tc = to & 15;
  if (tr === kr || tc === kc || fr === kr || fc === kc) return true;
  if (Math.abs(tr - kr) <= 2 && Math.abs(tc - kc) <= 2) return true;
  return Math.abs(fr - kr) <= 1 && Math.abs(fc - kc) <= 1;
}

/**
 * Forced checkmate for the side to move within `maxMoves` of its moves: mate in one is a legal move after which the
 * opponent is in check with no legal reply; deeper, the attacker plays checking moves only and the defender tries every
 * reply, depth-first. The shortest mate is found first and the line keeps the defender's longest defence.
 * A node is a position reached by a candidate checking move or by a reply; past `nodeCap` nodes nothing is reported.
 * @param {Position} pos @param {number} [maxMoves=3] @param {number} [nodeCap=4000]
 * @returns {number[]|null} the mating line as move integers (odd length), or null
 */
function mateSearch(pos, maxMoves = 3, nodeCap = 4000) {
  const b = pos.squares;
  let nodes = 0;
  let capped = false;
  /** @type {Int32Array[]} */
  const bufs = [];
  /** @param {number} ply @returns {Int32Array} */
  const buffer = ply => bufs[ply] ?? (bufs[ply] = new Int32Array(128));

  /** Moves in an order that does not depend on how the position lists its pieces: by origin, then destination, as the mover sees the board. @param {number[]} moves @returns {number[]} */
  const ordered = moves => {
    for (let i = 0; i < moves.length; i++) {
      const mv = moves[i], from = mvFrom(mv), pc = b[from];
      moves[i] = (ownView(pc, from) * 128 + ownView(pc, mvTo(mv))) * 65536 + mv;      // the sort key in front of the 16-bit move
    }
    moves.sort((x, y) => x - y);
    for (let i = 0; i < moves.length; i++) moves[i] &= 0xffff;
    return moves;
  };

  /** @param {number} ply @returns {number[]} every legal move of the side to move */
  const replies = ply => {
    const buf = buffer(ply);
    const n = pos.generate(buf, false);
    /** @type {number[]} */
    const out = [];
    for (let i = 0; i < n; i++) {
      if (pos.make(buf[i])) {
        pos.unmake();
        out.push(buf[i]);
      }
    }
    return ordered(out);
  };

  /** @param {number} n @param {number} ply @returns {number[]|null} a mate within n attacker moves, found depth-first */
  const attack = (n, ply) => {
    const buf = buffer(ply);
    const count = pos.generate(buf, false);
    const king = pos.kingSq[pos.side ^ 1];
    /** @type {number[]} */
    const candidates = [];
    for (let i = 0; i < count; i++) {
      const mv = buf[i];
      if (mayCheck(mv, king) && !(b[mvTo(mv)] !== 0 && (b[mvTo(mv)] & 7) === KING)) candidates.push(mv);
    }
    for (const mv of ordered(candidates)) {
      if (!pos.make(mv)) continue;
      if (++nodes > nodeCap) {
        capped = true;
        pos.unmake();
        return null;
      }
      if (!pos.inCheck()) {
        pos.unmake();
        continue;
      }
      const answers = replies(ply + 1);
      if (answers.length === 0) {
        pos.unmake();
        return [mv];
      }
      if (n > 1) {
        /** @type {number[]|null} */
        let longest = null;
        let forced = true;
        for (const reply of answers) {
          pos.make(reply);
          if (++nodes > nodeCap) capped = true;
          const sub = capped ? null : solve(n - 1, ply + 2);
          pos.unmake();
          if (sub === null) {
            forced = false;
            break;
          }
          if (longest === null || sub.length + 1 > longest.length) longest = [reply, ...sub];
        }
        if (capped) {
          pos.unmake();
          return null;
        }
        if (forced && longest !== null) {
          pos.unmake();
          return [mv, ...longest];
        }
      }
      pos.unmake();
    }
    return null;
  };

  /** @param {number} n @param {number} ply @returns {number[]|null} the shortest mate within n attacker moves */
  const solve = (n, ply) => {
    for (let k = 1; k <= n; k++) {
      const line = attack(k, ply);
      if (capped) return null;
      if (line !== null) return line;
    }
    return null;
  };

  const line = solve(maxMoves, 0);
  return capped ? null : line;
}

// ---------------------------------------------------------------------------------------------------------------
// named patterns (A6.4)
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} PlayedInfo           what the pattern rules read about the position after a move by X
 * @property {number} x                   side index of X
 * @property {number} movedTo             the square the moved piece stands on
 * @property {number[]} checkers          squares of the pieces giving check
 * @property {boolean} mate               the move is checkmate
 * @property {{to:number, state:Flight['state']}[]} flights   the flights of the enemy king
 * @property {{withCheck:boolean, squares:number[]}|null} fork
 * @property {boolean} winsMaterial       the move captures with see >= 100, or the moved piece creates a threat with gain >= 100
 */

/**
 * The patterns of the two tables "checked by moveFacts" on the position after a move by X.
 * Rows of the appendix are given for red attacking the black king at the top; they are mirrored for black.
 * @param {Position} pos the position after the move (the defender is to move)
 * @param {PlayedInfo} info
 * @param {'played'|'threat'} stage
 * @returns {Pattern[]} most specific first
 */
function playedPatterns(pos, info, stage) {
  const { x, movedTo, checkers, mate, flights, fork } = info;
  const b = pos.squares;
  const d = x ^ 1;
  const K = pos.kingSq[d];
  const xTag = 8 << x, dTag = 8 << d;
  /** @param {number} row a row of the appendix @returns {number} the row on the board for this X */
  const rowX = row => (x === 0 ? row : 9 - row);
  /** @type {Pattern[]} */
  const out = [];
  /** @param {PatternCode} id @param {number[]} squares */
  const add = (id, squares) => {
    out.push({ id, name: PATTERN_NAME[id], side: COLOR[x], squares: unique(squares).map(squareOf), stage, mate });
  };
  const check = checkers.length > 0;

  if (check) {
    for (const c of checkers) {
      if (b[c] !== xTag + CANNON) continue;
      const mid = between(b, c, K);
      if (mid !== null && mid.length === 1 && b[mid[0]] === xTag + CANNON) {
        add('double_cannon', [c, mid[0], K]);
        break;
      }
    }
    for (const c of checkers) {
      if (b[c] !== xTag + CANNON) continue;
      const mid = between(b, c, K);
      if (mid !== null && mid.length === 1 && b[mid[0]] === xTag + HORSE && (Math.abs(mid[0] - K) === 2 || Math.abs(mid[0] - K) === 32)) {
        add('horse_cannon', [c, mid[0], K]);
        break;
      }
    }
    const trough = checkers.find(c => b[c] === xTag + HORSE && rowOf(c) === rowX(1) && (colOf(c) === 2 || colOf(c) === 6));
    if (trough !== undefined) add('trough_horse', [trough, K]);
    const corner = checkers.find(c => b[c] === xTag + HORSE && rowOf(c) === rowX(2) && (colOf(c) === 3 || colOf(c) === 5));
    if (corner !== undefined) add('corner_horse', [corner, K]);
  }

  if (mate) {
    // 铁门栓
    if (K === sqOf(rowX(0), 4)) {
      const bolt = checkers.find(c => (b[c] === xTag + ROOK || b[c] === xTag + PAWN) && rowOf(c) === rowX(0) && (colOf(c) === 3 || colOf(c) === 5));
      const guard = sqOf(rowX(1), 4);
      if (bolt !== undefined && (b[guard] & dTag) !== 0) {
        for (let row = 0; row < 10; row++) {
          const cannon = sqOf(row, 4);
          if (b[cannon] !== xTag + CANNON) continue;
          const mid = between(b, cannon, K);
          if (mid !== null && mid.length === 2 && mid.includes(guard)) {
            add('iron_bolt', [bolt, cannon, guard, K]);
            break;
          }
        }
      }
    }
    // 闷宫
    if (checkers.length === 1 && b[checkers[0]] === xTag + CANNON) {
      const c = checkers[0];
      const mid = between(b, c, K);
      if (mid !== null && mid.length === 1 && (b[mid[0]] & dTag) !== 0) {
        const sameRow = (c >> 4) === (K >> 4);
        const onLine = /** @param {number} sq */ sq => (sameRow ? (sq >> 4) === (K >> 4) : (sq & 15) === (K & 15));
        if (flights.every(f => f.state === 'own' || onLine(f.to))) add('smother', [c, mid[0], K]);
      }
    }
    // 双车错
    rooks:
    for (const c of checkers) {
      if (b[c] !== xTag + ROOK) continue;
      const sameRow = (c >> 4) === (K >> 4), sameCol = (c & 15) === (K & 15);
      if (!sameRow && !sameCol) continue;
      for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 9; col++) {
          const second = sqOf(row, col);
          if (second === c || b[second] !== xTag + ROOK) continue;
          const adjacent = sameRow ? Math.abs(row - rowOf(K)) === 1 : Math.abs(col - colOf(K)) === 1;
          if (!adjacent) continue;
          if (flights.some(f => pos.attackers(f.to, x).includes(second))) {
            add('double_rooks', [c, second, K]);
            break rooks;
          }
        }
      }
    }
    // 白脸将
    const facing = flights.filter(f => f.state === 'facing');
    if (facing.length > 0) add('face_off', [pos.kingSq[x], ...facing.map(f => f.to), K]);
  }

  if (check) {
    const discovered = checkers.some(c => c !== movedTo);
    if (discovered) add(info.winsMaterial ? 'discovered_win' : 'discovered_check', [movedTo, ...checkers, K]);
    if (checkers.length >= 2) add('double_check', [...checkers, K]);
    if (fork !== null && fork.withCheck && !discovered) add('check_fork', fork.squares);
  } else if (fork !== null) {
    add('fork_two', fork.squares);
  }
  return out;
}

/**
 * The pattern of a mate in one that X threatens: the first pattern of the position after the mating move.
 * @param {Position} pos X to move @param {number} mv the mating move @returns {Pattern|null}
 */
function threatPattern(pos, mv) {
  const b = pos.squares;
  const x = pos.side;
  const to = mvTo(mv);
  const winsMaterial = b[to] !== 0 && exchangeValue(pos, mv) >= 100;
  if (!pos.make(mv)) return null;
  const info = {
    x, movedTo: to, checkers: pos.attackers(pos.kingSq[x ^ 1], x), mate: true, flights: flightsOf(pos, x ^ 1), fork: null, winsMaterial,
  };
  const found = playedPatterns(pos, info, 'threat');
  pos.unmake();
  return found.length > 0 ? found[0] : null;
}

// ---------------------------------------------------------------------------------------------------------------
// position facts (A6.1)
// ---------------------------------------------------------------------------------------------------------------

/** @typedef {{sq:number, by:number, gain:number, now:boolean}} HangRec   a hanging piece, its best capturer and the profit */

/**
 * The most profitable of the captures `from -> sq`, cheapest capturer first among equals.
 * @param {Position} pos the capturing side is to move @param {number} sq @param {number[]} froms @returns {{by:number, gain:number}}
 */
function bestCaptureOf(pos, sq, froms) {
  let by = -1, gain = -Infinity;
  for (const from of cheapestFirst(pos.squares, froms)) {
    const see = exchangeValue(pos, mkMove(from, sq));
    if (see > gain) {
      gain = see;
      by = from;
    }
  }
  return { by, gain };
}

/** @param {Uint8Array} b @param {number} p @param {number} tag @returns {boolean} a rook or cannon of `tag` stands on p's rank or file, or one of its horses next to p */
function lineThreat(b, p, tag) {
  for (const d of ORTHO) {
    if (b[p + d] === tag + HORSE) return true;
    for (let s = p + d; ON_BOARD[s] !== 0; s += d) {
      if (b[s] === tag + ROOK || b[s] === tag + CANNON) return true;
    }
  }
  return false;
}

/** @param {string} fen @param {{ply?:number}} [opts] @returns {PositionFacts} */
export function positionFacts(fen, opts) {
  const pos = Position.fromFen(fen);
  const { board, turn } = fenToBoard(fen);
  const side = pos.side, other = side ^ 1;
  if (pos.attacked(pos.kingSq[other], side)) throw new RangeError('illegal position: the side that is not on move is in check');
  const b = pos.squares;
  const ref = refCache(board);
  const inCheck = pos.inCheck();
  const ply = opts?.ply;

  /** Occupied squares in row-major order. @type {number[]} */
  const occupied = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      if (b[sqOf(row, col)] !== 0) occupied.push(sqOf(row, col));
    }
  }

  /** Legal capturers of every piece. @type {Map<number, number[]>} */
  const capturers = new Map();
  /** @type {HangRec[]} */
  let hangRecs = [];
  /** @type {Pin[]} */
  const pins = [];
  /** @type {CannonAim[]} */
  const cannons = [];
  /** @type {KingFacts[]} */
  const kings = [];
  /** @type {(MateThreat|null)[]} */
  const mates = [null, null];
  const buf = new Int32Array(128);

  /**
   * Everything that needs `m` to be on move: its captures (the hanging pieces of the other side), its king's flights,
   * its mate, the absolute pins on its pieces, its cannons, and the relative pins it holds on the other side.
   * @param {number} m the side to move in `pos` @param {boolean} now `m` is really on move
   */
  const pass = (m, now) => {
    const v = m ^ 1;
    const mTag = 8 << m, vTag = 8 << v;

    // Moves of m: legal captures per target, and the pieces that own a pseudo-legal move which make rejects.
    const rejected = new Uint8Array(256);
    const n = pos.generate(buf, false);
    for (let i = 0; i < n; i++) {
      const mv = buf[i], from = mvFrom(mv), to = mvTo(mv);
      const target = b[to];
      if (target !== 0 && (target & 7) === KING) continue;        // captures of a king are ignored everywhere
      if (!pos.make(mv)) {
        rejected[from] = 1;
        continue;
      }
      pos.unmake();
      if (target !== 0) {
        const list = capturers.get(to);
        if (list === undefined) capturers.set(to, [from]);
        else list.push(from);
      }
    }

    // Hanging pieces of v.
    /** @type {Set<number>} */
    const hangingHere = new Set();
    for (const sq of occupied) {
      const pc = b[sq];
      if ((pc & vTag) === 0 || (pc & 7) === KING) continue;
      const froms = capturers.get(sq);
      if (froms === undefined) continue;
      const { by, gain } = bestCaptureOf(pos, sq, froms);
      if (gain >= 100) {
        hangRecs.push({ sq, by, gain, now });
        hangingHere.add(sq);
      }
    }

    // King of m.
    const king = pos.kingSq[m];
    const flights = flightsOf(pos, m).map(f => /** @type {Flight} */ ({ to: squareOf(f.to), state: f.state, by: f.by < 0 ? null : ref(f.by) }));
    let weight = 0;
    for (const sq of occupied) {
      const pc = b[sq];
      if ((pc & vTag) === 0) continue;
      const row = rowOf(sq), col = colOf(sq);
      if (col < 2 || col > 6 || (m === 0 ? row < 6 : row > 3)) continue;
      const type = pc & 7;
      weight += type === ROOK ? 2 : type === CANNON || type === HORSE || type === PAWN ? 1 : 0;
    }
    kings[m] = { at: squareOf(king), flights, free: flights.filter(f => f.state === 'free').length, pressure: Math.min(1, weight / 6) };

    // Forced mate of m. For the side that is not on move it is not searched while the side on move is in check.
    if (now || !inCheck) {
      const found = mateSearch(pos);
      if (found !== null) {
        const line = toLine(board, COLOR[m], found.map(mv => pos.toRef(mv)));
        // The rules engine replays the line: a mate is reported only when it confirms it.
        if (line.end === 'mate' && line.moves.length === found.length) {
          const moves = /** @type {1|2|3} */ ((found.length + 1) >> 1);
          mates[m] = { in: moves, line, pattern: moves === 1 ? threatPattern(pos, found[0]) : null };
        }
      }
    }

    // Absolute pins on the pieces of m (side not in check).
    if (!(now && inCheck)) {
      for (const sq of occupied) {
        const pc = b[sq];
        if ((pc & mTag) === 0 || (pc & 7) === KING || rejected[sq] === 0) continue;
        b[sq] = 0;
        const through = pos.attackers(king, v);
        b[sq] = pc;
        if (through.length === 0) continue;                       // the rejected move walked into an attack; nothing pins the piece
        const kind = PIN_KIND[b[through[0]] & 7];
        if (kind !== undefined) pins.push({ pinned: ref(sq), by: ref(through[0]), shield: ref(king), absolute: true, kind });
      }
    }

    // Cannons of m: screen and target on each ray.
    for (const sq of occupied) {
      if (b[sq] !== mTag + CANNON) continue;
      for (const d of ORTHO) {
        let s = sq + d;
        while (ON_BOARD[s] !== 0 && b[s] === 0) s += d;
        if (ON_BOARD[s] === 0) continue;
        const screen = s;
        s += d;
        while (ON_BOARD[s] !== 0 && b[s] === 0) s += d;
        if (ON_BOARD[s] === 0 || (b[s] & vTag) === 0 || (b[s] & 7) === KING) continue;
        const gain = exchangeValue(pos, mkMove(sq, s));
        if (gain === -Infinity) continue;                         // the capture is not legal now
        cannons.push({ cannon: ref(sq), screen: ref(screen), target: ref(s), gain });
      }
    }

    // Relative pins that m holds on the pieces of v (not while v is in check: recaptures are distorted then).
    if (now || !inCheck) {
      const vKing = pos.kingSq[v];
      const kingAttackers = pos.attackers(vKing, m).length;
      /** Pseudo-attackers of each piece of v with nothing lifted. @type {Map<number, number[]>|null} */
      let base = null;
      for (const p of occupied) {
        const pc = b[p];
        if ((pc & vTag) === 0 || (pc & 7) === KING || !lineThreat(b, p, mTag)) continue;
        if (base === null) {
          base = new Map();
          for (const y of occupied) {
            if ((b[y] & vTag) !== 0 && (b[y] & 7) !== KING) base.set(y, pos.attackers(y, m));
          }
        }
        /** @type {{by:number, shield:number, gain:number}|null} */
        let best = null;
        b[p] = 0;
        if (pos.attackers(vKing, m).length === kingAttackers) {   // otherwise the piece shields its king: absolute pins only
          for (const [y, before] of base) {
            if (y === p || hangingHere.has(y)) continue;
            const yc = b[y];
            for (const a of pos.attackers(y, m)) {
              if (before.includes(a)) continue;                    // not an attack that the lift opened
              if (PIN_KIND[b[a] & 7] === undefined || (b[a] & 7) === KING) continue;
              const gain = exchangeValue(pos, mkMove(a, y));
              if (gain < 200) continue;
              if (!(valueAt(yc, y) > valueAt(pc, p) || pos.attackers(y, v).length === 0)) continue;
              if (best === null || gain > best.gain
                || (gain === best.gain && (ownView(yc, y) - ownView(b[best.shield], best.shield) || ownView(b[a], a) - ownView(b[best.by], best.by)) < 0)) {
                best = { by: a, shield: y, gain };
              }
            }
          }
        }
        b[p] = pc;
        if (best !== null) {
          pins.push({ pinned: ref(p), by: ref(best.by), shield: ref(best.shield), absolute: false, kind: PIN_KIND[b[best.by] & 7] });
        }
      }
    }
  };

  pass(side, true);
  pos.makeNull();
  pass(other, false);
  pos.unmakeNull();

  // In check: a piece of the checked side is hanging when it can be taken with profit once the check is answered (see
  // the header): after every answer, or else after every answer that changes nothing around the piece.
  // The null-move entries of that side are replaced by this test; with no legal answer (the game is over) they stay.
  if (inCheck) {
    const answers = pos.legalMoves();
    if (answers.length > 0) {
      /** @type {Map<number, HangRec>} */
      const passed = new Map(hangRecs.filter(rec => !rec.now).map(rec => [rec.sq, rec]));
      hangRecs = hangRecs.filter(rec => rec.now);
      const sideTag = 8 << side;
      for (const sq of occupied) {
        if ((b[sq] & sideTag) === 0 || (b[sq] & 7) === KING) continue;
        const attacking = pos.attackers(sq, other);
        if (attacking.length === 0) continue;                     // a piece that nothing attacks yet is not listed
        const guarding = pos.attackers(sq, side);
        // worst: the least the other side wins on the piece over every answer. calm: the same over the answers that
        // leave the piece where it is with the attackers and defenders it has now (Infinity when there is none).
        let worst = Infinity, calm = Infinity;
        for (const answer of answers) {
          const stays = mvFrom(answer) !== sq;
          pos.make(answer);
          const at = stays ? sq : mvTo(answer);
          const attackers = pos.attackers(at, other);
          let gain = -Infinity;
          for (const a of attackers) gain = Math.max(gain, exchangeValue(pos, mkMove(a, at)));
          const untouched = stays && sameMembers(attackers, attacking) && sameMembers(pos.attackers(sq, side), guarding);
          pos.unmake();
          if (gain < worst) worst = gain;
          if (untouched && gain < calm) calm = gain;
          if (worst < 100 && calm < 100) break;
        }
        const gain = worst >= 100 ? worst : calm === Infinity ? -Infinity : calm;
        if (gain < 100) continue;
        // The capturer that is reported attacks the piece on the board as it stands: the one of the null-move pass, else
        // the cheapest attacker.
        const known = passed.get(sq);
        hangRecs.push({ sq, by: known !== undefined ? known.by : cheapestFirst(b, attacking)[0], gain, now: false });
      }
    }
  }

  hangRecs.sort((p, q) => q.gain - p.gain || valueAt(b[q.sq], q.sq) - valueAt(b[p.sq], p.sq) || Number(q.now) - Number(p.now)
    || ownView(b[p.sq], p.sq) - ownView(b[q.sq], q.sq));
  /** @type {Hanging[]} */
  const hanging = hangRecs.map(rec => ({
    piece: ref(rec.sq),
    by: ref(rec.by),
    capture: describeMove(board, { from: squareOf(rec.by), to: squareOf(rec.sq) }),
    gain: rec.gain,
    points: rec.gain / 100,
    free: rec.gain === valueAt(b[rec.sq], rec.sq),
    now: rec.now,
  }));
  const hangingSquares = new Set(hangRecs.map(rec => rec.sq));

  /** @type {PieceStatus[]} */
  const pieces = [];
  const points = [0, 0];
  let heavy = 0;
  for (const sq of occupied) {
    const pc = b[sq], type = pc & 7, owner = pc >> 4;
    const attackers = cheapestFirst(b, capturers.get(sq) ?? []);
    const defenders = type === KING ? [] : cheapestFirst(b, pos.attackers(sq, owner));
    /** @type {PieceStatus['status']} */
    let status = 'safe';
    if (hangingSquares.has(sq)) status = 'hanging';
    else if (attackers.length > 0) status = 'guarded';
    else if (defenders.length === 0 && (type === ROOK || type === CANNON || type === HORSE)) status = 'loose';
    pieces.push({ piece: ref(sq), attackers: attackers.map(ref), defenders: defenders.map(ref), status });
    if (type !== KING) points[owner] += pointsAt(pc, sq);
    if (type === ROOK || type === CANNON || type === HORSE) heavy += PIECE_VALUE[TYPE_NAME[type]];
  }
  pins.sort((p, q) => sqAt(p.pinned.at) - sqAt(q.pinned.at));

  // Formations, for both sides.
  /** @type {Pattern[]} */
  const patterns = [];
  for (let x = 0; x < 2; x++) {
    const d = x ^ 1;
    const K = pos.kingSq[d];
    const xTag = 8 << x;
    /** @param {PatternCode} id @param {number[]} squares */
    const add = (id, squares) => {
      patterns.push({ id, name: PATTERN_NAME[id], side: COLOR[x], squares: unique(squares).map(squareOf), stage: 'formation', mate: false });
    };
    for (const sq of occupied) {
      if (b[sq] !== xTag + CANNON || (sq & 15) !== (K & 15) || Math.abs(rowOf(sq) - rowOf(K)) < 2 || hangingSquares.has(sq)) continue;
      const mid = between(b, sq, K);
      if (mid !== null && mid.length === 0) {
        add('empty_cannon', [sq, K]);
        break;
      }
    }
    const facing = kings[d].flights.filter(f => f.state === 'facing');
    if (facing.length > 0) add('face_off', [pos.kingSq[x], ...facing.map(f => sqAt(f.to))]);
    if (typeof ply === 'number' && ply <= 30 && colOf(K) === 4) {
      for (const sq of occupied) {
        if (b[sq] !== xTag + CANNON || colOf(sq) !== 4 || (x === 0 ? sq < 0x80 : sq >= 0x80)) continue;
        const mid = between(b, sq, K);
        if (mid !== null && mid.length >= 1) {
          add('central_cannon', [sq, K]);
          break;
        }
      }
    }
    const centre = sqOf(d === 0 ? 8 : 1, 4);
    if (b[centre] === (8 << d) + HORSE) add('heart_horse', [centre]);
  }

  const phase = 1 - Math.min(1, Math.max(0, (heavy - 1500) / 5500));
  return {
    fen: boardToFen(board, turn),
    turn,
    check: inCheck ? { checkers: pos.attackers(pos.kingSq[side], other).sort((p, q) => p - q).map(ref) } : null,
    material: { red: points[0], black: points[1], phase },
    pieces,
    hanging,
    pins,
    cannons,
    kings: { red: kings[0], black: kings[1] },
    mates: { red: mates[0], black: mates[1] },
    patterns,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// move facts (A6.2)
// ---------------------------------------------------------------------------------------------------------------

/** Number of pseudo-legal moves of each piece of the side to move, by origin square (captures of a king left out). @param {Position} pos @returns {Uint8Array} */
function pseudoCounts(pos) {
  const b = pos.squares;
  const counts = new Uint8Array(256);
  const buf = new Int32Array(128);
  const n = pos.generate(buf, false);
  for (let i = 0; i < n; i++) {
    const target = b[mvTo(buf[i])];
    if (target !== 0 && (target & 7) === KING) continue;
    counts[mvFrom(buf[i])]++;
  }
  return counts;
}

/**
 * Does the line of a pin stand on the board as it is: the piece of `bySide` on `by` attacks the piece on `shield`
 * once the piece on `pinned` is lifted, and does not while it is there? Geometry only (no exchange value).
 * @param {Position} pos @param {number} pinned @param {number} by @param {number} shield @param {number} bySide
 * @returns {boolean}
 */
function pinLineStands(pos, pinned, by, shield, bySide) {
  const b = pos.squares;
  const byTag = 8 << bySide, ownTag = 24 - byTag;
  const pc = b[pinned];
  if ((b[by] & byTag) === 0 || (pc & ownTag) === 0 || (b[shield] & ownTag) === 0) return false;
  if (pos.attackers(shield, bySide).includes(by)) return false;
  b[pinned] = 0;
  const open = pos.attackers(shield, bySide).includes(by);
  b[pinned] = pc;
  return open;
}

/** @param {string} fen @param {MoveRef} move legal @param {{ply?:number, before?:PositionFacts}} [opts] @returns {MoveFacts} */
export function moveFacts(fen, move, opts) {
  const pos = Position.fromFen(fen);
  const { board, turn } = fenToBoard(fen);
  if (!move || !isSquare(move.from) || !isSquare(move.to)) throw new RangeError('moveFacts needs a move between two points of the board');
  const mv = pos.fromRef(move);
  if (!pos.isLegal(mv)) throw new RangeError('moveFacts needs a legal move');
  const b = pos.squares;
  const me = pos.side, foe = me ^ 1;
  const mine = COLOR[me], theirs = COLOR[foe];
  const foeTag = 8 << foe;
  const from = mvFrom(mv), to = mvTo(mv);
  const moverPc = b[from], moverType = moverPc & 7, victimPc = b[to];
  const ply = opts?.ply;

  const fenBefore = boardToFen(board, turn);
  const B = opts?.before !== undefined && opts.before.fen === fenBefore ? opts.before : positionFacts(fenBefore, { ply });
  const info = describeMove(board, move);
  const boardAfter = applyMove(board, move);
  const fenAfter = boardToFen(boardAfter, theirs);
  const A = positionFacts(fenAfter, { ply: ply === undefined ? undefined : ply + 1 });
  const refBefore = refCache(board), ref = refCache(boardAfter);

  /** @type {Map<number, Hanging>} */
  const hangB = new Map(B.hanging.map(h => [sqAt(h.piece.at), h]));
  /** @type {Map<number, Hanging>} */
  const hangA = new Map(A.hanging.map(h => [sqAt(h.piece.at), h]));
  /** @type {Map<number, PieceStatus>} */
  const statusB = new Map(B.pieces.map(s => [sqAt(s.piece.at), s]));
  /** @type {Map<number, PieceStatus>} */
  const statusA = new Map(A.pieces.map(s => [sqAt(s.piece.at), s]));

  // ---- read from the position before the move ----
  const see = victimPc !== 0 ? exchangeValue(pos, mv) : 0;
  const countsB = pseudoCounts(pos);
  /** Pseudo-attackers before the move of each piece of the mover that was hanging. @type {Map<number, number[]>} */
  const pseudoB = new Map();
  for (const h of B.hanging) {
    if (h.piece.color === mine) pseudoB.set(sqAt(h.piece.at), pos.attackers(sqAt(h.piece.at), foe));
  }
  /**
   * Enemy pieces that hang after the move, each with the mover's pieces that attack it before the move and with the
   * moved piece lifted, and with the enemy pieces that guard it before the move.
   * @type {Map<number, {before:number[], lifted:number[], guards:number[]}>}
   */
  const reachB = new Map();
  for (const h of A.hanging) {
    if (h.piece.color !== theirs) continue;
    const target = sqAt(h.piece.at);
    const attackersBefore = pos.attackers(target, me);
    b[from] = 0;
    const lifted = pos.attackers(target, me);
    b[from] = moverPc;
    reachB.set(target, { before: attackersBefore, lifted, guards: pos.attackers(target, foe) });
  }
  /**
   * Pinned squares of A whose pin line already stood before the move. While the mover is in check, B lists no pin on
   * its pieces and no relative pin at all (see positionFacts), so the set difference alone would credit a move that
   * answers a check with every pin that merely becomes visible again.
   * @type {Set<number>}
   */
  const stoodBefore = new Set();
  if (B.check !== null) {
    /** @param {number} sq a square of the position after the move @returns {number} where the piece on it stood before */
    const was = sq => (sq === to ? from : sq);
    for (const p of A.pins) {
      const by = sqAt(p.by.at);
      if (by === to) continue;                                   // the moved piece is the one that pins: that is new
      if (pinLineStands(pos, was(sqAt(p.pinned.at)), by, was(sqAt(p.shield.at)), sideOf(p.by.color))) stoodBefore.add(sqAt(p.pinned.at));
    }
  }
  /** @type {Block[]} */
  const blocks = [];
  if (victimPc === 0) {
    // 蹩马腿: an enemy horse next to `to` loses a jump that was pseudo-legal.
    for (let i = 0; i < 4; i++) {
      const horse = to - ORTHO[i];                               // `to` is the leg of the jumps HORSE_JUMP[2i], [2i + 1] of this horse
      if (b[horse] !== foeTag + HORSE) continue;
      const open = [horse + HORSE_JUMP[2 * i], horse + HORSE_JUMP[2 * i + 1]].some(t => ON_BOARD[t] !== 0 && (b[t] & foeTag) === 0);
      if (open) blocks.push({ kind: 'horse-leg', piece: ref(horse) });
    }
    // 塞象眼: an enemy elephant diagonally next to `to` whose far square is on its own half.
    for (const d of DIAG) {
      const elephant = to + d, far = to - d;
      if (b[elephant] !== foeTag + ELEPHANT || ON_BOARD[far] === 0 || ((elephant ^ far) & 0x80) !== 0) continue;
      blocks.push({ kind: 'elephant-eye', piece: ref(elephant) });
    }
  }
  /** Checkers before the move that the moved piece now stands in front of (an escape from check by interposing). @type {number[]} */
  const interposed = [];
  if (B.check !== null && moverType !== KING) {
    const king = pos.kingSq[me];
    for (const checker of B.check.checkers) {
      const c = sqAt(checker.at);
      if (c !== to && cutsAttack(b[c] & 7, c, king, to)) interposed.push(c);
    }
  }

  // ---- make the move ----
  pos.make(mv);
  const replies = pos.legalMoves().length;

  /** @type {MoveFacts['capture']} */
  let capture = null;
  if (victimPc !== 0) {
    /** @type {MoveInfo|null} */
    let recapture = null;
    for (const a of cheapestFirst(b, pos.attackers(to, foe))) {
      if (!pos.make(mkMove(a, to))) continue;
      pos.unmake();
      recapture = describeMove(boardAfter, { from: squareOf(a), to: squareOf(to) });
      break;
    }
    capture = {
      piece: refBefore(to),
      see,
      exchange: see >= 50 ? 'wins' : see <= -50 ? 'loses' : 'even',
      free: recapture === null,
      recapture,
    };
  }

  /** @type {MoveFacts['check']} */
  let check = null;
  if (A.check !== null) {
    const checkers = A.check.checkers;
    check = { checkers, discovered: checkers.some(c => sqAt(c.at) !== to), double: checkers.length >= 2, replies, mate: replies === 0 };
  }

  // Threats: enemy pieces that hang now and did not before, or by 200 more. A move that ends the game threatens nothing:
  // there is no next turn. A move that answers a check does not make the threats that stood already: while the mover
  // was in check those captures were not legal, so B.hanging does not list them, but an attack with the same attackers
  // and the same guards as before the move is nothing this move did.
  /** @type {NewThreat[]} */
  const threats = [];
  for (const h of A.hanging) {
    if (h.piece.color !== theirs || replies === 0) continue;
    const prev = hangB.get(sqAt(h.piece.at));
    if (prev !== undefined && prev.piece.color === theirs && h.gain - prev.gain < 200) continue;
    const by = sqAt(h.by.at), target = sqAt(h.piece.at);
    if (B.check !== null) {
      const stood = reachB.get(target);
      const guards = pos.attackers(target, foe);
      if (stood !== undefined && pos.attackers(target, me).every(a => stood.before.includes(a === to ? from : a))
        && stood.guards.every(g => guards.includes(g))) continue;
    }
    /** @type {PieceRef|null} */
    let viaScreen = null;
    if (h.by.type === 'cannon') {
      const mid = between(b, by, target);
      if (mid !== null && mid.length === 1) viaScreen = ref(mid[0]);
    }
    // discovered: another piece attacks, and it could not before because the moved piece stood in its way
    const reach = reachB.get(target);
    const discovered = by !== to && reach !== undefined && !reach.before.includes(by) && reach.lifted.includes(by);
    threats.push({ target: h.piece, by: h.by, capture: h.capture, gain: h.gain, discovered, viaScreen });
  }

  // Parried: pieces of the mover that hung before and do not now.
  /** @type {Parry[]} */
  const parried = [];
  /** @type {number[]} */
  const blockedAttackers = [];
  for (const h of B.hanging) {
    if (h.piece.color !== mine) continue;
    const before = sqAt(h.piece.at);
    const at = before === from ? to : before;
    if (hangA.has(at)) continue;
    /** @type {Parry['how']} */
    let how;
    if (before === from) how = 'moved';
    else if (sqAt(h.by.at) === to) how = 'captured-attacker';
    else if ((statusA.get(at)?.attackers.length ?? 0) > 0) how = 'defended';
    else {
      const still = pos.attackers(at, foe);
      const cut = (pseudoB.get(before) ?? []).filter(w => w !== to && !still.includes(w) && cutsAttack(b[w] & 7, w, at, to));
      if (cut.length > 0) {
        how = 'blocked';
        for (const w of cut) blockedAttackers.push(w);
      } else if (still.length > 0 && A.check !== null) {
        continue;                                                // only the check postpones the capture: no parry is claimed
      } else {
        how = 'defended';
      }
    }
    parried.push({ piece: ref(at), how });
  }
  for (const w of unique([...blockedAttackers, ...interposed])) blocks.push({ kind: 'line', piece: ref(w) });

  // Exposed: pieces of the mover that hang now.
  /** @type {Exposed[]} */
  const exposed = [];
  for (const h of A.hanging) {
    if (h.piece.color !== mine) continue;
    const at = sqAt(h.piece.at);
    /** @type {Exposed['cause']} */
    let cause;
    if (at === to) cause = 'moved-into-attack';
    else if (hangB.get(at)?.piece.color === mine) cause = 'left-hanging';
    else if (statusB.get(at)?.defenders.some(d => sqAt(d.at) === from)) cause = 'unguarded';
    else cause = 'uncovered';
    exposed.push({ piece: h.piece, by: h.by, capture: h.capture, gain: h.gain, cause });
  }

  // Fork: two or more targets (new threats, plus the king when the move gives check).
  /** @type {MoveFacts['fork']} */
  let fork = null;
  const targets = threats.filter(t => t.gain >= 100).map(t => t.target);
  if (check !== null) targets.push(ref(pos.kingSq[foe]));
  if (targets.length >= 2) {
    const attackers = unique(threats.filter(t => t.gain >= 100).map(t => sqAt(t.by.at)));
    const shared = attackers.length === 1 && (check === null || check.checkers.some(c => sqAt(c.at) === attackers[0]));
    fork = { by: shared ? ref(attackers[0]) : null, targets, withCheck: check !== null };
  }

  // Pins: set differences by pinned square. A released pin names its pieces where they stand after the move (a pinning
  // piece that was captured: where it stood). Across a check the lists of A and B are not comparable (a side in check
  // cannot use a relative pin, so none is listed): a pin whose line stood before the move is not new, and a relative
  // pin whose line still stands while the enemy answers the check is not released.
  /** @param {Pin[]} list @param {number} sq @returns {boolean} */
  const pinnedOn = (list, sq) => list.some(p => sqAt(p.pinned.at) === sq);
  /** @param {number} sq a square of the position before the move @returns {number} where a piece of the mover on it stands now */
  const now = sq => (sq === from ? to : sq);
  /** @param {PieceRef} piece a piece of the position before the move @returns {PieceRef} */
  const after = piece => {
    const at = sqAt(piece.at);
    if (piece.color === mine) return ref(now(at));
    return at === to ? piece : ref(at);
  };
  /** @param {Pin} p a pin of B on a piece of the mover @returns {boolean} the enemy is in check and the line of this relative pin still stands */
  const heldThroughCheck = p => A.check !== null && !p.absolute
    && pinLineStands(pos, now(sqAt(p.pinned.at)), sqAt(p.by.at), now(sqAt(p.shield.at)), foe);
  const pins = {
    created: A.pins.filter(p => p.pinned.color === theirs && !pinnedOn(B.pins, sqAt(p.pinned.at)) && !stoodBefore.has(sqAt(p.pinned.at))),
    released: B.pins.filter(p => p.pinned.color === mine && !pinnedOn(A.pins, now(sqAt(p.pinned.at))) && !heldThroughCheck(p))
      .map(p => ({ ...p, pinned: after(p.pinned), by: after(p.by), shield: after(p.shield) })),
    suffered: A.pins.filter(p => p.pinned.color === mine && !pinnedOn(B.pins, sqAt(p.pinned.at) === to ? from : sqAt(p.pinned.at))
      && !stoodBefore.has(sqAt(p.pinned.at))),
  };

  // 兑: the moved piece can be taken by an enemy piece of its own type in an even exchange.
  let offersTrade = false;
  for (const attacker of statusA.get(to)?.attackers ?? []) {
    if (attacker.type === info.piece && Math.abs(exchangeValue(pos, mkMove(sqAt(attacker.at), to))) < 50) offersTrade = true;
  }

  // 保: an own piece that had attackers gained the moved piece as a defender.
  let guards = false;
  for (const status of A.pieces) {
    const at = sqAt(status.piece.at);
    if (status.piece.color !== mine || at === to || status.piece.type === 'king') continue;
    if (!status.defenders.some(d => sqAt(d.at) === to)) continue;
    const before = statusB.get(at);
    if (before !== undefined && before.attackers.length > 0 && !before.defenders.some(d => sqAt(d.at) === from)) guards = true;
  }

  // Opens: own pieces (not the moved one) whose pseudo-legal move count grew.
  pos.makeNull();
  const countsA = pseudoCounts(pos);
  pos.unmakeNull();
  /** @type {Open[]} */
  const opens = [];
  for (const status of A.pieces) {
    const at = sqAt(status.piece.at);
    if (status.piece.color !== mine || at === to) continue;
    const gained = countsA[at] - countsB[at];
    const type = status.piece.type;
    if ((type === 'rook' || type === 'cannon') && gained >= 2) opens.push({ piece: status.piece, kind: 'line', gained });
    else if (type === 'horse' && gained >= 1) opens.push({ piece: status.piece, kind: 'leg', gained });
    else if (type === 'elephant' && gained >= 1) opens.push({ piece: status.piece, kind: 'eye', gained });
  }

  // Patterns the move plays, then the pattern of a mate in one it threatens.
  const forkSquares = fork === null ? [] : [fork.by !== null ? sqAt(fork.by.at) : to, ...fork.targets.map(t => sqAt(t.at))];
  const patterns = playedPatterns(pos, {
    x: me,
    movedTo: to,
    checkers: check === null ? [] : check.checkers.map(c => sqAt(c.at)),
    mate: check !== null && check.mate,
    flights: A.kings[theirs].flights.map(f => ({ to: sqAt(f.to), state: f.state })),
    fork: fork === null ? null : { withCheck: fork.withCheck, squares: forkSquares },
    winsMaterial: (victimPc !== 0 && see >= 100) || threats.some(t => sqAt(t.by.at) === to && t.gain >= 100),
  }, 'played');
  pos.unmake();

  const mateThreat = A.mates[mine];
  const allowsMate = A.mates[theirs];
  if (mateThreat !== null && mateThreat.pattern !== null) patterns.push(mateThreat.pattern);

  /** @type {MoveTag[]} */
  const tags = [];
  if (check !== null) tags.push('将');
  if (replies === 0 || mateThreat !== null) tags.push('杀');
  if (capture !== null) tags.push('吃');
  if (threats.length > 0) tags.push('捉');
  if ((capture !== null && capture.exchange === 'even') || offersTrade) tags.push('兑');
  if (exposed.some(e => sqAt(e.piece.at) === to)) tags.push('献');
  if (guards) tags.push('保');
  if (blocks.length > 0) tags.push('拦');
  if (threats.some(t => t.discovered) || (check !== null && check.discovered)) tags.push('闪');
  if (tags.length === 0) tags.push('闲');

  return {
    move: info,
    fenBefore,
    fenAfter,
    tags,
    capture,
    check,
    escapesCheck: B.check !== null,
    threats,
    parried,
    exposed,
    fork,
    pins,
    blocks,
    opens,
    kingSqueeze: { before: B.kings[theirs].free, after: A.kings[theirs].free },
    mateThreat,
    allowsMate,
    patterns,
    pawnCrossed: moverType === PAWN && ((from ^ to) & 0x80) !== 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// settled material (section 4.6.3)
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {Line} line @param {Color} pov
 * @param {number} [maxPlies] plies to walk before the tail is settled; without it the whole line is walked
 * @returns {MaterialOutcome}
 */
export function materialOutcome(line, pov, maxPlies) {
  const limit = maxPlies === undefined || Number.isNaN(maxPlies) ? line.moves.length : Math.max(0, Math.floor(maxPlies));
  const pos = Position.fromFen(line.start);
  const b = pos.squares;
  const povSide = sideOf(pov);
  /** @type {MaterialOutcome['won']} */
  const won = [];
  /** @type {MaterialOutcome['lost']} */
  const lost = [];
  /** @param {number} victim @param {number} sq @param {number} capturer */
  const record = (victim, sq, capturer) => {
    (capturer === povSide ? won : lost).push({ piece: TYPE_NAME[victim & 7], points: pointsAt(victim, sq) });
  };

  // Walk the line: all of it, or maxPlies plies and then on while an exchange is running (at most four more plies).
  const n = line.moves.length;
  let walked = 0, extra = 0;
  let lastWasCapture = false;
  while (walked < n) {
    const move = line.moves[walked];
    if (!move || !isSquare(move.from) || !isSquare(move.to)) break;
    const mv = pos.fromRef(move);
    const victim = b[mvTo(mv)];
    if (walked >= limit) {
      if (!lastWasCapture || victim === 0 || extra >= 4) break;
      extra++;
    }
    if (!pos.isLegal(mv)) break;
    if (victim !== 0) record(victim, mvTo(mv), pos.side);
    pos.make(mv);
    walked++;
    lastWasCapture = victim !== 0;
  }

  // The line ends in mate inside the walked part: the fact is the mate.
  /** @type {MaterialOutcome['mate']} */
  let mate = null;
  if (walked === n && n > 0 && pos.legalMoves().length === 0) mate = (pos.side ^ 1) === povSide ? 'gives' : 'suffers';

  // Settle the tail, where the line ends cut or the walk was stopped: what the captures from here on leave the side to
  // move, each side free to take or to stop. Counted from a pawn on, with every capture of that main line.
  if (mate === null && (line.end === 'cut' || walked < n)) {
    if (n === 0) {
      // No line at all: the question of brain.js, "is a capture pending here?". The best one and the exchange on its square.
      const pending = bestPendingCapture(pos);
      if (pending !== null) playExchange(pos, pending.mv, record);
    } else {
      const budget = { left: SETTLE_NODES };
      const settled = settleCaptures(pos, SETTLE_PLIES, -Infinity, Infinity, budget);
      if (settled.value >= 100 && budget.left > 0) {
        for (const mv of settled.pv) {
          record(b[mvTo(mv)], mvTo(mv), pos.side);
          pos.make(mv);
        }
      }
    }
  }

  const sum = /** @param {{points:number}[]} list */ list => list.reduce((total, item) => total + item.points, 0);
  const net = sum(won) - sum(lost);
  /** @type {MaterialOutcome['kind']} */
  let kind;
  if (won.length === 0 && lost.length === 0) kind = 'none';
  else if (lost.length === 0) kind = 'wins';
  else if (won.length === 0) kind = 'loses';
  else kind = net >= 1 ? 'good-trade' : net <= -1 ? 'bad-trade' : 'even-trade';
  return { net, won, lost, kind, mate, plies: walked, settled: true };
}

/**
 * A search PV as a Line. `end` is 'cut' when the PV may have been truncated at pvLength and a capture is pending in
 * its last position (materialOutcome then settles it by static exchange).
 * @param {Board} board @param {Color} turn @param {MoveRef[]} pv @returns {Line}
 */
function searchLine(board, turn, pv) {
  const line = toLine(board, turn, pv);
  if (line.end === 'mate' || pv.length < PV_LENGTH || line.moves.length !== pv.length) return line;
  const pos = Position.fromFen(line.start);
  for (const move of line.moves) {
    if (!pos.make(pos.fromRef(move))) return line;
  }
  if (bestPendingCapture(pos) !== null) line.end = 'cut';
  return line;
}

/**
 * Does the last move of a line give check? With `Line.end` 'mate' that tells a checkmate from 困毙 (no legal move
 * without a check), which toLine reports as 'mate' as well.
 * @param {Line} line @returns {boolean}
 */
function endsInCheck(line) {
  const pos = Position.fromFen(line.start);
  for (const move of line.moves) {
    if (!pos.make(pos.fromRef(move))) return false;
  }
  return line.moves.length > 0 && pos.inCheck();
}

// ---------------------------------------------------------------------------------------------------------------
// verdict (section 4.6.1)
// ---------------------------------------------------------------------------------------------------------------

/** 1.5 at level 1, 1.25 at 3, 1.0 at 5, 0.9 at 7, 0.8 at 9, linear in between. @param {number} level @returns {number} */
export function verdictScale(level) {
  const anchors = [[1, 1.5], [3, 1.25], [5, 1.0], [7, 0.9], [9, 0.8]];
  if (Number.isNaN(level)) return 1.0;
  if (level <= 1) return 1.5;
  if (level >= 9) return 0.8;
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    if (level > x1) continue;
    const [x0, y0] = anchors[i - 1];
    return y0 + (y1 - y0) * (level - x0) / (x1 - x0);
  }
  return 0.8;
}

/**
 * How much better the search score `a` is than the search score `b` (same position, same side's view). It is the
 * difference of the scores themselves: `scoreToCp` clamps every score that is no mate to +-1900, and a difference of two
 * clamped scores vanishes where the scale has run out (far behind or far ahead, a move that gives a rook away would
 * cost nothing; CONTRACT-NOTES item 147). A mate score (a mate or a repetition verdict) has no such distance to another
 * score: with one on either side the result is the difference of the two centipawn values, as section 4.6.1 has it.
 * @param {number} a @param {number} b @returns {number}
 */
function scoreGap(a, b) {
  const mate = Math.abs(a) >= WIN || Math.abs(b) >= WIN;
  return mate ? scoreToCp(a) - scoreToCp(b) : a - b;
}

/**
 * The thresholds of section 4.6.1 without the brilliant test.
 * @param {number} raw what the move loses against the best move: the true difference of the two scores (scoreGap), not below 0
 * @param {number} bestCp @param {number} moveCp centipawn values of the two; they decide only whether the position is decided
 * @param {number} level
 * @param {boolean} forcedBlunder the move allows a forced mate and the best move did not
 * @returns {{cat:Exclude<Cat, 'brilliant'>, eff:number}}
 */
function verdictOf(raw, bestCp, moveCp, level, forcedBlunder) {
  let eff = raw;
  if (Math.min(bestCp, moveCp) >= 500) eff = 0.4 * raw;
  else if (Math.max(bestCp, moveCp) <= -500) eff = 0.5 * raw;
  const k = verdictScale(level);
  /** @type {Exclude<Cat, 'brilliant'>} */
  let cat;
  if (eff > 300 * k || forcedBlunder) cat = 'blunder';
  else if (eff > 120 * k) cat = 'mistake';
  else if (eff > 50 * k) cat = 'ok';
  else if (eff > 15) cat = 'good';
  else cat = 'best';
  return { cat, eff };
}

/** Value of a table line that may not be exact at the table's depth: min(score, upper), as a search score. @param {RootLine} line @returns {number} */
function boundedScore(line) {
  return line.upper === null ? line.score : Math.min(line.score, line.upper);
}

/** @param {number} score @returns {boolean} the score is a real mate against the side it belongs to */
function isMated(score) {
  const m = realMate(score);
  return m !== null && m < 0;
}

/** @param {number} score @returns {boolean} the score is a real mate for the side it belongs to */
function isMating(score) {
  const m = realMate(score);
  return m !== null && m > 0;
}

/**
 * Does a line re-create the position it starts from, with the same side to move, within its first four plies (the mover
 * steps out, the opponent forces the piece back and returns himself)? The search scores that first return as a
 * repetition (Appendix A3.4), which is not what the move is worth (CONTRACT-NOTES item 150).
 * @param {string} start FEN before the first move @param {MoveRef[]} moves @returns {boolean}
 */
function comesBack(start, moves) {
  if (typeof start !== 'string' || !Array.isArray(moves) || moves.length < 4) return false;
  const pos = Position.fromFen(start);
  const before = pos.squares.slice();
  for (let i = 0; i < 4; i++) {
    const move = moves[i];
    if (!move || !isSquare(move.from) || !isSquare(move.to) || !pos.make(pos.fromRef(move))) return false;
  }
  return pos.squares.every((piece, sq) => piece === before[sq]);
}

/**
 * The smallest loss that is judged 缓着 (`ok`) at a level when both moves are worth `cp`: what a move costs that only
 * loses a turn. @param {number} level @param {number} cp @returns {number}
 */
function tempoLoss(level, cp) {
  let loss = 0;
  while (loss < 1000 && verdictOf(loss, cp, cp, level, false).cat !== 'ok') loss++;
  return loss;
}

/**
 * @param {Analysis|null} table
 * @param {MoveRef} move
 * @param {number} level
 * @returns {Quick|null} null when table is null or table.depth < 2
 */
export function quickVerdict(table, move, level) {
  if (table === null || table === undefined || table.depth < 2 || table.lines.length === 0) return null;
  const m = lineOf(table, move);
  if (m === null) return null;
  const best = table.lines[0];
  const bestCp = scoreToCp(best.score);
  // A line that only lets the position come back is scored as a repetition, which is not what the move is worth: the
  // face waits for the assessment (CONTRACT-NOTES item 150). Not when that return is the best there is.
  if (m !== best && Math.abs(m.score) < WIN && scoreGap(best.score, m.score) > 0 && comesBack(table.fen, m.pv)) return null;
  // Every loss below is a difference of search scores (scoreGap), so that it does not vanish beyond the clamp of scoreToCp.
  // The distance to a mate score has no such difference: it reads 100 for every move that stays above +1900, also for one
  // that leaves a rook to be taken. When the best line mates, a move that does not mate is therefore measured as well
  // against what the mover holds when nothing is given away, the static evaluation of the position (item 150). That is
  // what assessMove does with the balance of the move's own line, which is not known here, and so the first face agrees
  // with the assessment: a move that gives a rook away is behind by the rook, a quiet move by the 100 of the missed mate.
  // (The best line of the table that is no mate is no measure for it: where that line wins a piece, every move that
  // merely keeps everything would be a mistake at first sight and 稳健 a moment later.)
  const still = isMating(best.score) && typeof table.fen === 'string' ? Position.fromFen(table.fen).evaluate() : null;
  /** @param {number} score a value of the tried move @returns {number} how far it is behind */
  const behindOf = score => {
    const gap = scoreGap(best.score, score);
    return still !== null && !isMating(score) ? Math.max(gap, scoreGap(still, score)) : gap;
  };
  if (m.depth === table.depth) {
    const moveCp = scoreToCp(m.score);
    const behind = behindOf(m.score);
    const loss = Math.max(0, behind);
    const { cat } = verdictOf(loss, Math.max(bestCp, moveCp), moveCp, level, isMated(m.score) && !isMated(best.score));
    return { cat, loss: Math.min(9999, loss), depth: table.depth, isBest: m === best || behind <= 0 };
  }
  // Not exact at the table's depth: the last all-exact iteration and the proven upper bound, whichever is worse.
  const d = table.allDepth;
  let loss = -Infinity;
  if (d >= 1 && m.byDepth.length >= d) {
    const at = m.byDepth[d - 1];
    let bestAt = -Infinity;
    for (const line of table.lines) {
      if (line.byDepth.length >= d) bestAt = Math.max(bestAt, line.byDepth[d - 1]);
    }
    loss = Math.max(loss, scoreGap(bestAt, at));
    if (still !== null && !isMating(at)) loss = Math.max(loss, scoreGap(still, at));
  }
  if (m.upper !== null) loss = Math.max(loss, behindOf(m.upper));
  if (loss === -Infinity) loss = behindOf(m.score);
  loss = Math.max(0, loss);
  // what the move is worth, for the test "is the position decided": that much below the best move
  const moveCp = Math.abs(best.score) >= WIN ? bestCp - loss : scoreToCp(best.score - loss);
  // The forced-mate rule of 4.6.1 holds here too: a proven bound, or the score of the last all-exact iteration, that is a
  // mate against the mover is a forced mate. Beyond -1900 its distance to the best move reads as 100 only, and the move
  // would be "good" (CONTRACT-NOTES 148).
  const mated = (m.upper !== null && isMated(m.upper)) || (d >= 1 && m.byDepth.length >= d && isMated(m.byDepth[d - 1]));
  const { cat } = verdictOf(loss, bestCp, moveCp, level, mated && !isMated(best.score));
  return { cat, loss: Math.min(9999, loss), depth: d, isBest: false };
}

/**
 * The opponent's reply when the search line has none (a line that ends in a repeated position): its most profitable
 * capture, else the move with the best static evaluation.
 * @param {Position} pos the position after the tried move @returns {number} a legal move, or 0 when there is none
 */
function glanceReply(pos) {
  const pending = bestPendingCapture(pos);
  if (pending !== null) return pending.mv;
  let best = 0, bestScore = -Infinity;
  for (const mv of pos.legalMoves()) {
    pos.make(mv);
    const score = -pos.evaluate();
    pos.unmake();
    if (score > bestScore) {
      bestScore = score;
      best = mv;
    }
  }
  return best;
}

/**
 * Why a move is bad (A6.3): the first rule that matches, with the squares to point at.
 * @param {Object} c
 * @param {Board} c.board the position before the move
 * @param {Color} c.turn the mover
 * @param {PositionFacts} c.before
 * @param {MoveFacts} c.facts
 * @param {Line} c.line
 * @param {MaterialOutcome} c.outcome
 * @param {RootLine} c.tried
 * @param {Line} c.bestLine
 * @param {MaterialOutcome} c.bestOutcome
 * @param {MoveInfo} c.best
 * @param {boolean} c.isBest
 * @param {number} c.raw
 * @param {boolean} c.allowsMate
 * @param {boolean} c.missesMate
 * @returns {Refutation|null} null only when the opponent has no legal reply (which never goes with a mistake or a blunder)
 */
function refute(c) {
  const { board, turn, before, facts, line, outcome, tried, bestLine, bestOutcome, best, isBest, raw } = c;
  const move = facts.move;
  /** @type {MoveInfo|null} */
  let reply = line.moves.length >= 2 ? line.moves[1] : null;
  if (reply === null) {
    // The search line stops at the move (it runs into a repeated position): take the opponent's reply at a glance.
    const pos = Position.fromFen(facts.fenAfter);
    const mv = glanceReply(pos);
    if (mv === 0) return null;
    reply = describeMove(applyMove(board, move), pos.toRef(mv));
  }
  const answer = reply;
  const moverPieceAt = /** @param {Square} at */ at => (sameSquare(at, move.from) ? move.to : at);

  /** @type {DangerCode} */
  let danger = 'slow';
  /** @type {Square[]} */
  let focus = [];
  /** @returns {MoveFacts|null} facts of the reply, when it is legal after the move */
  const replyFacts = () => {
    try {
      return moveFacts(facts.fenAfter, answer);
    } catch {
      return null;
    }
  };

  if (c.allowsMate) {
    danger = 'allows_mate';
    for (let i = 1; i < line.moves.length; i += 2) focus.push(line.moves[i].from, line.moves[i].to);
    if (focus.length === 0) focus = [answer.from, answer.to];
  } else if (c.missesMate) {
    danger = 'misses_mate';
    focus = [best.from, best.to];
  } else if (sameSquare(answer.to, move.to) && outcome.net <= -1) {
    danger = 'hangs_moved_piece';
    focus = [move.to, answer.from];
  } else if (answer.captured !== null && before.hanging.some(h => h.piece.color === turn && sameSquare(moverPieceAt(h.piece.at), answer.to))) {
    danger = 'leaves_hanging';
    focus = [answer.to, answer.from];
  } else if (answer.captured !== null && facts.exposed.some(e => (e.cause === 'unguarded' || e.cause === 'uncovered') && sameSquare(e.piece.at, answer.to))) {
    danger = 'unguards';
    focus = [answer.to, answer.from, move.from];
  } else if (move.captured !== null && outcome.kind === 'bad-trade') {
    danger = 'bad_trade';
    focus = [move.to, answer.from];
  } else {
    const after = outcome.net <= -1 ? replyFacts() : null;
    if (after !== null && after.fork !== null) {
      danger = 'walks_into_fork';
      focus = [after.fork.by !== null ? after.fork.by.at : answer.to, ...after.fork.targets.map(t => t.at)];
    } else if (after !== null && after.pins.created.length > 0) {
      danger = 'walks_into_pin';
      focus = [after.pins.created[0].pinned.at, after.pins.created[0].by.at];
    } else if (!isBest && raw >= 200 && bestOutcome.net >= 2) {
      danger = 'misses_win';
      focus = [best.from, best.to];
      for (let i = 0; i < bestLine.moves.length; i += 2) {
        if (bestLine.moves[i].captured !== null) focus.push(bestLine.moves[i].to);
      }
    }
  }

  return {
    reply: answer,
    line,
    outcome,
    revealDepth: revealDepth(tried.byDepth, tried.score, 'bad'),
    danger,
    focus: uniqueSquares(focus.map(s => ({ row: s.row, col: s.col }))),
  };
}

/** @param {{fen:string, move:MoveRef, pair:Analysis, table:Analysis|null, level:number, compare:MoveRef}} input @returns {MoveAssessment} */
export function assessMove(input) {
  const { fen, move, pair, table, level, compare } = input;
  const { board, turn } = fenToBoard(fen);
  const tried = lineOf(pair, move);
  const compared = lineOf(pair, compare);
  if (tried === null || compared === null) throw new RangeError('assessMove needs a pair analysis that contains the move and the comparison move');

  const before = positionFacts(fen);
  const facts = moveFacts(fen, move, { before });
  const info = facts.move;

  const moveCp = scoreToCp(tried.score);
  const compareCp = scoreToCp(compared.score);
  // What the move loses against the comparison move is the difference of the two search scores (scoreGap), not of their
  // clamped centipawns: in a position beyond +-1900 a move that gives a rook away is not "as good as the best".
  const behind = scoreGap(compared.score, tried.score);
  const isBest = behind <= 0;
  const bestRoot = isBest ? tried : compared;
  const bestCp = Math.max(moveCp, compareCp);
  let raw = Math.max(0, behind);
  const best = isBest ? info : describeMove(board, compare);

  const line = searchLine(board, turn, tried.pv);
  const outcome = materialOutcome(line, turn);
  const bestLine = isBest ? line : searchLine(board, turn, compared.pv);
  const bestOutcome = isBest ? outcome : materialOutcome(bestLine, turn);

  const moveMate = realMate(tried.score), bestMate = realMate(bestRoot.score);
  const allowsMate = moveMate !== null && moveMate < 0;
  const givesMate = moveMate !== null && moveMate > 0 ? moveMate : null;
  const bestMates = bestMate !== null && bestMate > 0;

  // The better move mates and this one does not (CONTRACT-NOTES item 150). The distance to a mate score is that of the
  // centipawn values, 100 for every move that stays above +1900, so a move that leaves a rook to be taken would be 稳健.
  // The loss is then at least what the move's own line gives away.
  if (!isBest && bestMates && givesMate === null && outcome.net < 0) raw = Math.max(raw, Math.round(-100 * outcome.net));

  // A move whose line only re-creates the position before it (item 150): the opponent forces the piece back and returns
  // himself. The search scores that first return as a repetition, on purpose (Appendix A3.4), but the game goes on from
  // the same position: the mover has lost a turn and nothing else. The loss is at most the smallest one that is 缓着 at
  // this level, and the mover stands as before. Not when the return is the best there is (a side that is behind and
  // finds the repetition), and not for a mate score.
  const returns = !isBest && Math.abs(tried.score) < WIN && comesBack(line.start, line.moves);
  if (returns) raw = Math.min(raw, tempoLoss(level, bestCp));
  /** What the mover stands at after the move, as it is stored and shown. */
  const standsCp = returns ? bestCp : moveCp;

  // A forced move (CONTRACT-NOTES item 138): with at most two legal moves there was nothing to find and nothing to give
  // up by choice. It is never 妙手 and never 弃子, whatever the search says about it.
  const forced = Position.fromFen(fen).legalMoves().length <= FORCED_MOVES;

  // 弃子: after the opponent's reply the mover is two points or more down on the exchange so far, yet loses at most 15 cp.
  // It is the moved piece that is given: the reply takes it. And material that is lost whatever the mover plays is not
  // given up for anything: the move must also mate, or keep the evaluation within a pawn of what the position was worth.
  // A move after which the mover is mated or loses by the repetition rule keeps nothing: beyond -1900 its -2000 would read
  // as "within a pawn" of a static evaluation that reads -1900 (CONTRACT-NOTES 147).
  const sacrifice = !forced && raw <= 15 && line.moves.length >= 2 && sameSquare(line.moves[1].to, info.to)
    && materialOutcome({ start: line.start, moves: line.moves.slice(0, 2), end: 'quiet' }, turn, 2).net <= -2
    && (givesMate !== null || (tried.score > -WIN && scoreGap(tried.score, Position.fromFen(fen).evaluate()) >= -100));

  let onlyMove = false;
  /** @type {MoveAssessment['alternatives']} */
  const alternatives = [];
  if (table !== null && table !== undefined && table.lines.length > 0) {
    const top = table.lines[0].score;
    if (table.lines.length >= 2) onlyMove = scoreGap(top, boundedScore(table.lines[1])) >= 150;
    for (const other of table.lines) {
      if (alternatives.length >= 3) break;
      if (sameMove(other.move, move)) continue;
      alternatives.push({ move: describeMove(board, other.move), loss: Math.min(9999, Math.max(0, scoreGap(top, boundedScore(other)))) });
    }
  }

  const flags = {
    onlyMove,
    missedWin: !isBest && raw >= 200 && bestCp >= 150 && (bestOutcome.net >= 2 || bestMates),
    missedMate: bestMates && givesMate === null,
    allowsMate,
    givesMate,
    sacrifice,
  };

  const revealBest = revealDepth(bestRoot.byDepth, bestRoot.score, 'good');
  /** @type {Cat} */
  let cat = verdictOf(raw, bestCp, standsCp, level, allowsMate && !isMated(bestRoot.score)).cat;
  // 妙手 is not for a plain winning capture (CONTRACT-NOTES item 106): the only-move clause does not count when the move
  // itself takes material with profit at once; such a move is `best`. The sacrifice and the forced-mate clauses are as in 4.6.1.
  const winsAtOnce = facts.capture !== null && facts.capture.exchange === 'wins';
  // ... and not for a forced move either (CONTRACT-NOTES item 138).
  if (cat === 'best' && !forced
    && (flags.sacrifice || (flags.onlyMove && revealBest >= 3 && !winsAtOnce) || (givesMate !== null && givesMate >= 2))) cat = 'brilliant';

  // Patterns: those of the move, plus the search-backed ones.
  const patterns = facts.patterns.slice();
  /** @param {PatternCode} id @param {Square[]} squares */
  const addPattern = (id, squares) => {
    if (patterns.some(p => p.id === id && p.stage === 'played')) return;
    patterns.push({ id, name: PATTERN_NAME[id], side: turn, squares: uniqueSquares(squares.map(s => ({ row: s.row, col: s.col }))), stage: 'played', mate: false });
  };
  const centre = { row: turn === 'red' ? 1 : 8, col: 4 };
  if (info.piece === 'rook' && info.captured === 'advisor' && sameSquare(info.to, centre) && facts.check !== null
    && facts.capture !== null && facts.capture.recapture !== null && givesMate !== null) {
    addPattern('heart_strike', [info.from, info.to, before.kings[otherColor(turn)].at]);
  }
  if (givesMate === 2 && line.moves.length === 3 && line.end === 'mate' && info.piece === 'rook' && facts.check !== null
    && line.moves[1].piece === 'king' && line.moves[2].piece === 'rook' && !sameSquare(line.moves[2].from, info.to)
    && endsInCheck(line)) {
    addPattern('double_rooks', [info.to, line.moves[2].to, line.moves[1].to]);
  }
  if (flags.sacrifice) addPattern('sacrifice_play', [info.to, line.moves[1].to]);

  /** @type {Refutation|null} */
  let refutation = null;
  if (cat === 'mistake' || cat === 'blunder') {
    refutation = refute({ board, turn, before, facts, line, outcome, tried, bestLine, bestOutcome, best, isBest, raw, allowsMate, missesMate: flags.missedMate });
  }

  return {
    move: info,
    depth: pair.depth,
    moveCp: standsCp,
    bestCp,
    loss: Math.min(9999, Math.max(0, raw)),
    cat,
    best,
    isBest,
    alternatives,
    flags,
    line,
    outcome,
    refutation,
    bestLine,
    bestOutcome,
    revealBest,
    patterns,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// hints (section 4.6.2)
// ---------------------------------------------------------------------------------------------------------------

/** Starting squares of rook, horse and cannon, as "row,col" per colour. @type {Readonly<Record<Color, Readonly<Record<string, readonly string[]>>>>} */
const START_SQUARES = {
  red: { rook: ['9,0', '9,8'], horse: ['9,1', '9,7'], cannon: ['7,1', '7,7'] },
  black: { rook: ['0,0', '0,8'], horse: ['0,1', '0,7'], cannon: ['2,1', '2,7'] },
};

/** @param {{fen:string, ply:number, table:Analysis, move:MoveRef, facts:PositionFacts, threat:ThreatInfo|null}} input @returns {Hint} */
export function hintFor(input) {
  const { fen, ply, table, move, threat } = input;
  const { board, turn } = fenToBoard(fen);
  const root = lineOf(table, move);
  if (root === null) throw new RangeError('hintFor needs a table that contains the move');
  const facts = moveFacts(fen, move, { ply, before: input.facts });
  const info = facts.move;
  const line = searchLine(board, turn, root.pv);
  const outcome = materialOutcome(line, turn);
  const mate = realMate(root.score);

  /** @type {HintTheme} */
  let theme;
  if (mate !== null && mate > 0) theme = 'mate';
  else if (facts.escapesCheck) theme = 'escape_check';
  else if (threat !== null && threat.kind === 'mate') theme = 'stop_mate';
  else if (facts.capture !== null && facts.capture.exchange === 'wins') theme = 'win_material';
  else if ((facts.fork !== null || facts.threats.some(t => t.discovered) || (facts.check !== null && facts.check.discovered) || facts.pins.created.length > 0)
    && outcome.net >= 1) theme = 'tactic';
  else if (facts.parried.length > 0 && input.facts.hanging.some(h => h.piece.color === turn)) theme = 'save_piece';
  else if (facts.tags.includes('兑')) theme = 'trade';
  else if (facts.check !== null || facts.threats.length > 0 || facts.mateThreat !== null) theme = 'attack';
  else if (ply <= 24 && (START_SQUARES[turn][info.piece] ?? []).includes(`${info.from.row},${info.from.col}`)) theme = 'develop';
  else if (facts.tags.includes('保') || facts.tags.includes('拦')) theme = 'defend';
  else theme = 'improve';

  // Where the move lands, as the child sees the board.
  const col = turn === 'red' ? info.to.col : 8 - info.to.col;
  const depth = turn === 'red' ? 9 - info.to.row : info.to.row;       // 0 = the child's back rank
  /** @type {Hint['area']} */
  const area = {
    side: col <= 2 ? 'left' : col <= 5 ? 'center' : 'right',
    zone: depth <= 2 ? 'home' : depth >= 7 ? 'enemy' : 'river',
  };

  const value = boundedScore(root);
  /** @type {MoveInfo[]} */
  const alternatives = [];
  for (const other of table.lines) {
    if (alternatives.length >= 2) break;
    if (other === root || Math.abs(scoreGap(boundedScore(other), value)) > 30) continue;
    alternatives.push(describeMove(board, other.move));
  }

  return { theme, piece: pieceRef(board, info.from), area, move: info, line, outcome, facts, alternatives };
}

// ---------------------------------------------------------------------------------------------------------------
// threat, tactical test, habit traps (section 4.6.4)
// ---------------------------------------------------------------------------------------------------------------

/** @param {string} fen @param {Analysis} pass result of a `pass: true` search @param {PositionFacts} facts @returns {ThreatInfo|null} */
export function threatInfo(fen, pass, facts) {
  if (pass.stopped === 'in-check' || pass.lines.length === 0 || facts.check !== null) return null;
  const { board, turn } = fenToBoard(fen);
  const rival = otherColor(turn);
  const root = pass.lines[0];
  let line = searchLine(board, rival, root.pv);
  const searched = realMate(root.score);
  /** @type {number|null} */
  let mate = searched !== null && searched > 0 ? searched : null;
  // A mate that the checks-only scan knows and the pass search does not (or only a slower one): that is the threat.
  const known = facts.mates[rival];
  if (known !== null && (mate === null || known.in < mate)) {
    line = known.line;
    mate = known.in;
  }
  if (line.moves.length === 0) return null;
  const outcome = materialOutcome(line, rival);
  const first = moveFacts(boardToFen(board, rival), line.moves[0]);
  /** @type {ThreatInfo['kind']} */
  let kind;
  if (mate !== null) kind = 'mate';
  else if (outcome.net >= 1) kind = 'wins-material';
  else if (first.check !== null) kind = 'check';
  else kind = 'plan';
  return { kind, line, outcome, mate, facts: first };
}

/** @param {string} fen @param {Analysis} table @param {PositionFacts} facts @returns {TacticalTest|null} */
export function tacticalTest(fen, table, facts) {
  if (table === null || table === undefined || table.depth < 4 || table.lines.length === 0) return null;
  // The group, the gap below it and the depth at which it stands out are measured on the search scores (scoreGap): beyond
  // the clamp of scoreToCp every move would be "within 60 cp of the best", or a move far below the best would join the group.
  const best = table.lines[0].score;
  const W = table.lines.filter(line => line.depth === table.depth && scoreGap(best, line.score) <= 60);
  if (W.length === 0 || W.length > 3) return null;
  let outside = -Infinity;
  for (const line of table.lines) {
    if (!W.includes(line)) outside = Math.max(outside, boundedScore(line));
  }
  if (outside === -Infinity || scoreGap(best, outside) < 150) return null;
  const child = facts.turn, rival = otherColor(child);
  const save = facts.check !== null || facts.mates[rival] !== null
    || facts.hanging.some(h => h.piece.color === child && !h.now && h.gain >= 300);
  const { board } = fenToBoard(fen);
  return { tier: revealTier(standsOutAt(table, W)), kind: save ? 'save' : 'win', group: W.map(line => describeMove(board, line.move)) };
}

/**
 * search.separationDepth on the search scores: the first all-exact depth d at which every line of `group` beats every
 * other line by 100 cp or more; table.allDepth + 1 if never. (separationDepth compares clamped centipawns, so beyond
 * +-1900 a group would never stand out and every test there would be of the deepest tier.)
 * @param {Analysis} table @param {RootLine[]} group lines of the table @returns {number}
 */
function standsOutAt(table, group) {
  for (let d = 1; d <= table.allDepth; d++) {
    let weakest = Infinity, strongestOther = -Infinity;
    for (const line of table.lines) {
      const score = line.byDepth[d - 1];
      if (group.includes(line)) weakest = Math.min(weakest, score);
      else strongestOther = Math.max(strongestOther, score);
    }
    if (scoreGap(weakest, strongestOther) >= 100) return d;
  }
  return table.allDepth + 1;
}

/**
 * @param {string} fen
 * @param {Analysis} table
 * @param {PositionFacts} facts
 * @param {ThreatInfo|null} threat
 * @returns {HabitCode[]} subset of ['greedy', 'miss_threat']
 */
export function habitTraps(fen, table, facts, threat) {
  /** @type {HabitCode[]} */
  const traps = [];
  if (table !== null && table !== undefined && table.lines.length > 0) {
    const pos = Position.fromFen(fen);
    const b = pos.squares;
    const top = table.lines[0].score;
    for (const line of table.lines) {
      const mv = pos.fromRef(line.move);
      // A capture that loses the exchange (moveFacts(...).capture.exchange === 'loses') and costs 150 cp or more.
      if (b[mvTo(mv)] === 0 || scoreGap(top, boundedScore(line)) < 150 || exchangeValue(pos, mv) > -50) continue;
      traps.push('greedy');
      break;
    }
  }
  if (threat !== null && threat !== undefined && (threat.kind === 'mate' || threat.kind === 'wins-material')) traps.push('miss_threat');
  return traps;
}

// ---------------------------------------------------------------------------------------------------------------
// opening names (A6.4)
// ---------------------------------------------------------------------------------------------------------------

/** @param {string} startFen @param {MoveRef[]} moves @returns {{red:PatternCode|null, black:PatternCode|null}} */
export function openingName(startFen, moves) {
  const start = fenToBoard(startFen);
  let board = start.board;
  /** @type {Color} */
  let side = start.turn;
  /** Each side's first move, described on the board it was played on. @type {Record<Color, MoveInfo|null>} */
  const first = { red: null, black: null };
  const plies = Math.min(moves.length, 8);
  for (let i = 0; i < plies; i++) {
    const move = moves[i];
    if (!move || !isSquare(move.from) || !isSquare(move.to) || board[move.from.row][move.from.col]?.color !== side) break;
    if (first[side] === null) first[side] = describeMove(board, move);
    board = applyMove(board, move);
    side = otherColor(side);
  }

  /** @param {Color} color @returns {number} the cannon row: row 7 for red, row 2 for black */
  const cannonRow = color => (color === 'red' ? 7 : 2);
  /** @param {number} row @param {number} col @param {Color} color @param {PieceType} type @returns {boolean} */
  const has = (row, col, color, type) => board[row][col]?.color === color && board[row][col]?.type === type;
  /** @param {Color} color @returns {boolean} */
  const central = color => has(cannonRow(color), 4, color, 'cannon');
  /** @param {Color} color @param {number} col @returns {boolean} that cannon square of the side is empty */
  const left = (color, col) => board[cannonRow(color)][col] === null;

  /** @param {Color} color @returns {PatternCode|null} */
  const nameOf = color => {
    const row = cannonRow(color);
    if (color === 'black' && central('red') && central('black')) {
      if ((left('red', 1) && left('black', 1)) || (left('red', 7) && left('black', 7))) return 'same_cannons';
      if ((left('red', 1) && left('black', 7)) || (left('red', 7) && left('black', 1))) return 'opposite_cannons';
    }
    if (central(color)) return 'central_cannon';
    if (has(row, 2, color, 'horse') && has(row, 6, color, 'horse')) return 'screen_horses';
    const move = first[color];
    if (move === null) return null;
    if (move.piece === 'elephant' && move.to.row === row && move.to.col === 4) return 'elephant_open';
    const forward = color === 'red' ? move.to.row < move.from.row : move.to.row > move.from.row;
    if (move.piece === 'pawn' && forward && (move.from.col === 2 || move.from.col === 6)) return 'pawn_lead';
    if (move.piece === 'horse' && forward && (move.to.col === 2 || move.to.col === 6)) return 'horse_open';
    if (move.piece === 'cannon' && move.to.row === move.from.row && (move.to.col === 3 || move.to.col === 5)) {
      return (move.from.col - 4) * (move.to.col - 4) < 0 ? 'palace_cannon' : 'corner_cannon';
    }
    return null;
  };
  return { red: nameOf('red'), black: nameOf('black') };
}
