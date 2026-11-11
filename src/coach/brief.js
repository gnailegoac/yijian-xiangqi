// src/coach/brief.js (C3) — turns brain results into packets (contract section 4.14).
// Pure; browser only. The ONLY module that reads Survey, Assessed, OpponentTurn, Hint and FinishResult.
//
// The rule of the product is "the engine computes, the language model only narrates": every code that leaves this module
// stands for a fact that core/facts.js (or the rules engine) established. The mapping "facts -> codes" of section 4.14.3
// lives in `effectsOf` and `flawsOf` and nowhere else.
//
// Readings of points the contract leaves open (each is reported with the package):
//
// - Order of effects: the numbered rows of section 4.14.3, top to bottom. (The examples of section 9 put `develop` in front
//   of `defend` and `open_rook`; the table is the mapping.)
// - `defend {on}` for the tag 保 (row 11, CONTRACT-NOTES 108): the most valuable piece of the mover that the moved piece
//   defends from its new square, did not defend from its old one, and that had an attacker before the move (the rule of the
//   tag itself). When no such piece is found the row gives no effect.
// - Moves for which no MoveFacts reach this module (the comparison move and the other alternatives of an assessment, the
//   first move of the rival's pending chance): their effects are needed by `more.better[].does`, `toward.theme` and
//   `chance.theme`, but `Assessed` and `TeachingChoice` carry facts for the tried move only and src/coach may not import
//   core/facts.js. `sketchFacts` therefore derives, with the rules engine alone, the part of the move facts that can be
//   established exactly on the board (mate, a mate threatened in one, check, the capture and its exchange, new attacks,
//   pieces brought to safety, blocked horse legs and elephant eyes, the enemy king's flights, an opened rook, a crossed
//   pawn) and leaves out what cannot (pins, sacrifices, deeper mate threats, the attacks of a checking move). Nothing is
//   guessed: a row whose fact is not established gives no effect.
// - The rival's opening name (`opp.name`): the report carries no opening names, so the rows of Appendix A6.4 are applied
//   to the board before and after the rival's move (`openingChange`).
// - `Eval.mate` of a trial is the distance after the move ("走后形势"): the child's own moves still to play, or the
//   rival's moves until mate with a minus sign. It is left out beyond 9 moves and for repetition verdicts.
// - `held` also holds for a mistake that allows a forced mate whose distance is not known.
// - `only` is set for the only move itself (the tried move is the best move), never for another move of that position, and
//   only when it is a rescue ("the only move that avoids a serious loss"): the one move that wins material or mates is a
//   find, not a rescue.
// - `mat.cp` counts every pawn as 100 (no bonus for a crossed pawn), so that "you are a pawn up" always agrees with the
//   piece counts printed next to it.
// - Flaws are sentences about the board, and a row is used only where its sentence is true (see `flawsOf`): `unguard` only
//   for a piece that lost the moved piece as its guard, `hang` only when nothing can take back, `bad_trade` only when the
//   capturing piece is taken back, `waste` only for a move without any effect; a line that loses a piece which could
//   already be taken is an ignored threat.
//   A move that is judged brilliant, best or good has no flaw at all, also when its capture loses the exchange on that
//   square (the piece is won back elsewhere, or everything else is worse): 「为什么？」 after a good verdict is answered
//   from `does`. A missed win names the piece the best line wins, not a piece it only trades; a losing capture that is not
//   taken back and left nothing en prise is told as the win it passed over, when the assessment flags one.
//   `walk_fork` names the forking piece only when one piece attacks both targets after the reply.
// - The first flaw names a rival piece (its `by`, the guard of `greedy`) only when that piece plays the reply: the local
//   narrator's 「指给我看」 says of it 是…在威胁。它会走【reply】.
// - `defend` for a parry `defended` (row 10) is said only when a guard is what keeps the piece safe (an enemy piece can still
//   take it, or the moved piece guards it now). The facts use `defended` for every other way a piece became safe; a piece
//   that is safe because the attack is gone (the moved piece was the cannon's screen) got no guard, and no code says that.
// - A move that answers a check says so (row 10 for the king): `escape` when the king steps away, `block` when the moved
//   piece stands between the checker and the king. The facts list no parry for a king.
// - `punishes` needs a previous move that had something wrong with it (ok, mistake or blunder): a best or sound move is
//   not blamed for a piece that was lost whatever was played (这步是在利用小主公上一步的疏漏 would be untrue and unkind).
// - The pass search adds a threat only when its first move is a threat in itself (a mate, a check, a capture, a fork, a
//   discovered attack, a pin, an attack); a deeper plan is not listed. Its `by` is the piece that acts (the cannon that
//   aims once a pawn has stepped aside), named where it stands now; an attack is told in preference to a pin or a
//   discovered attack, whose clause would need the `on2` a Threat does not have.
// - A tool verdict's `cost` and `reply.net` are measured from the base position (section 3.6): they include what the
//   moves that lead to the assessed position took.
// - `chance.theme`: when the first move of the chance line shows no threat of its own, the theme is the capture the line
//   goes on to make.
// - `toward` points at the comparison move exactly when `more.better` lists it (not best, and better by 60 cp or more), so
//   that "there is a more active idea over there" and "nothing better was found" are never said of the same trial.
// - A pin on a pawn that has not crossed the river, from a point on its own file, is not put into words (row 7, `walk_pin`):
//   the pawn cannot leave that file, so "once it moves the piece behind is lost" would be false.
// - `vsPrev` compares the losses of the two tries (a TryPacket carries no score); 30 cp or less is `same`.
// - Threats from hanging pieces: `net` is the settled exchange on that square (what the rival takes and what is taken
//   back), so a guarded rook attacked by a cannon reads as a rook for a cannon, not as a rook lost for nothing. A mate
//   threat and a threatened check carry an empty `net`: the narrators add "and then you lose …" only for a listed piece.
// - With no legal move for the child (the game is over) the brief lists no threat and no chance.
// - `mine.try.cost` is what the child's previous move and the rival's answer really took (null when nothing was taken, or
//   while the child can still take back): the balance the best reply line predicted is not stated as a fact about a move
//   that was answered differently, or whose predicted losses have not happened. The line itself stays in `mine.try.reply`.
// - Pouch theme of `save_piece`: the way the piece is saved (escape, block, defend, or the capture of the attacker), not
//   always `escape`: the piece to move is often not the piece in danger.

/**
 * @import { Board, Color, Square, Piece, PieceRef, MoveRef, MoveInfo, Line, PositionFacts, MoveFacts, MaterialOutcome, Pattern,
 *           NewThreat, Parry, Block, Open, ThreatInfo, OpponentTurn, Assessed, Hint, FinishResult, GameSkill, MoveSample } from '../core/types.js'
 * @import { Cat, HabitCode, EndReason, MotifCode, PatternCode } from '../core/codes.js'
 * @import { Ply } from '../game/types.js'
 * @import { N, Side, PT, WPiece, Net, WLine, Eval, Effect, Area, Threat, OppMove, Moment, TurnBrief, TryPacket, MorePacket, Alt, Hint1, Hint2,
 *           Hint3, OverPacket, WTakeaway, ToolVerdict, RecapPacket, CoachEvent } from './types.js'
 * @import { MoveBook } from './book.js'
 * @import { GameMemory } from './memory.js'
 */

import { CATS, CROSSED_PAWN_VALUE, HABIT_OF_DANGER, MOTIF_TERM, NOTABLE_MOTIFS, PATTERN_NAME, PIECE_VALUE, PT_OF, TACTIC_MOTIFS } from '../core/codes.js';
import { applyMove, boardToFen, checkers, fenToBoard, getLegalMoves, getPieceLegalMoves, isInCheck, opposite } from '../core/engine.js';
import { describeMove, parseNotation, pieceRef, toLine } from '../core/notation.js';
import { AREA } from './lexicon.js';
import { LIMITS } from './protocol.js';

/**
 * @typedef {Object} TurnReport                  everything known about the position the child faces
 * @property {number} ply
 * @property {Color} me
 * @property {Board} board
 * @property {PositionFacts} facts               REQUIRED (computed synchronously on the main thread)
 * @property {number} legalCount
 * @property {ThreatInfo|null|undefined} threat  undefined = the pass search has not answered yet
 * @property {number|null} evalCp                child's view; from the latest table, else from lastOpp.evalAfter, else null
 * @property {number|null} mate
 * @property {OpponentTurn|null} lastOpp
 * @property {{move:MoveInfo, cat:Cat, waited:boolean, self:boolean, packet:TryPacket|null, more:MorePacket|null,
 *             assessed:Assessed|null}|null} prev            the child's previous move
 * @property {number} level                      effectiveLevel
 * @property {boolean} announceChance            policy decision (§4.22)
 * @property {null|'undo'|'reload'} back
 */

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------------

/** Net lists hold at most this many pieces (section 3.6). */
const NET_PIECES = 6;
const CP_MAX = 9999;
/** `Eval.mate` carries a distance only up to this many moves (CONTRACT-NOTES 88). */
const MATE_MAX = 9;
/** A difference of this many centipawns or less between two tries is "the same". */
const SAME_CP = 30;
/** An alternative is "better" from this gain on (section 4.14.2). */
const BETTER_GAIN = 60;
/** The opening names of Appendix A6.4 are read from the first eight plies. */
const OPENING_PLIES = 8;
/** `develop` is said of a move in the first 24 plies (section 4.14.3, row 16). */
const DEVELOP_PLIES = 24;

/** @param {number} x @param {number} lo @param {number} hi @returns {number} an integer in [lo, hi]; never -0 */
function clampInt(x, lo, hi) {
  const v = Math.round(Number.isFinite(x) ? x : 0);
  return v < lo ? lo : v > hi ? hi : v === 0 ? 0 : v;
}

/** @param {Square} a @param {Square} b @returns {boolean} */
const sameSquare = (a, b) => a.row === b.row && a.col === b.col;
/** @param {MoveRef} a @param {MoveRef} b @returns {boolean} */
const sameMove = (a, b) => sameSquare(a.from, b.from) && sameSquare(a.to, b.to);
/** @param {Square} sq @returns {number} */
const keyOf = (sq) => sq.row * 9 + sq.col;
/** @param {readonly string[]} list @param {string|undefined} code @returns {boolean} */
const has = (list, code) => code !== undefined && list.includes(code);
/** @template T @param {T} value @returns {T} a deep copy of plain JSON data */
const clone = (value) => JSON.parse(JSON.stringify(value));

/** @param {unknown} sq @returns {sq is Square} */
function isSquare(sq) {
  if (typeof sq !== 'object' || sq === null) return false;
  const { row, col } = /** @type {{row?:unknown, col?:unknown}} */ (sq);
  return typeof row === 'number' && typeof col === 'number'
    && Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < 10 && col >= 0 && col < 9;
}

/** @param {Square} sq @param {Color} color @returns {boolean} `sq` lies in the palace of `color` */
function inPalace(sq, color) {
  return sq.col >= 3 && sq.col <= 5 && (color === 'red' ? sq.row >= 7 : sq.row <= 2);
}

/** @param {Square} sq @param {Color} color @returns {boolean} `sq` lies beyond the river as `color` sees it */
function acrossRiver(sq, color) {
  return color === 'red' ? sq.row <= 4 : sq.row >= 5;
}

/** Material of a piece in centipawns; a pawn across the river counts CROSSED_PAWN_VALUE. @param {Piece} piece @param {Square} sq @returns {number} */
function valueOf(piece, sq) {
  return piece.type === 'pawn' && acrossRiver(sq, piece.color) ? CROSSED_PAWN_VALUE : PIECE_VALUE[piece.type];
}

/** @param {Board} board @param {(piece:Piece, sq:Square) => void} visit called for every piece, row-major */
function eachPiece(board, visit) {
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      const piece = board[row][col];
      if (piece) visit(piece, { row, col });
    }
  }
}

/** @param {Board} board @param {Color} color @returns {Square|null} */
function kingSquare(board, color) {
  /** @type {Square|null} */
  let at = null;
  eachPiece(board, (piece, sq) => {
    if (piece.type === 'king' && piece.color === color) at = sq;
  });
  return at;
}

/** A FEN as a board, or null when it cannot be read. @param {unknown} fen @returns {Board|null} */
function boardOf(fen) {
  try {
    return fenToBoard(/** @type {string} */ (fen)).board;
  } catch {
    return null;
  }
}

/** Do two FENs show the same placement with the same side to move (counters ignored)? @param {unknown} a @param {unknown} b @returns {boolean} */
function samePosition(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const [placeA, sideA] = a.trim().split(/\s+/), [placeB, sideB] = b.trim().split(/\s+/);
  return placeA !== '' && placeA === placeB && sideA !== undefined && sideA === sideB;
}

/** PieceRef of the piece on `sq`, or null when the square is empty. @param {Board} board @param {Square} sq @returns {PieceRef|null} */
function refAt(board, sq) {
  return isSquare(sq) && board[sq.row][sq.col] ? pieceRef(board, sq) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Wire shapes: pieces, areas, evaluations, balances, lines
// ---------------------------------------------------------------------------------------------------------------------

/** The 前 / 中 / 后 prefix of a PieceRef name (names with 二 / 三 / 四 give no `q`). @type {Readonly<Record<string, WPiece['q']>>} */
const RANK_OF = { 前: 'front', 中: 'mid', 后: 'back' };

/**
 * PieceRef -> WPiece: `s` by colour against `me`, `f` the file in the owner's numbering, `q` from the 前 / 中 / 后 prefix of the name.
 * @param {PieceRef} ref @param {Color} me @returns {WPiece}
 */
function wpiece(ref, me) {
  /** @type {WPiece} */
  const out = { s: ref.color === me ? 'me' : 'opp', t: PT_OF[ref.type], f: ref.color === 'red' ? 9 - ref.at.col : ref.at.col + 1 };
  const first = typeof ref.name === 'string' ? ref.name[0] : undefined;
  const q = first !== undefined && Object.hasOwn(RANK_OF, first) ? RANK_OF[first] : undefined;
  if (q) out.q = q;
  return out;
}

/** @param {WPiece} a @param {WPiece} b @returns {boolean} the two name the same piece */
const sameWPiece = (a, b) => a.s === b.s && a.t === b.t && a.f === b.f && a.q === b.q;

/**
 * The square of the piece a WPiece names on `board`; null when no piece or more than one fits.
 * @param {Board} board @param {WPiece} wp @param {Color} me @returns {Square|null}
 */
function squareOfPiece(board, wp, me) {
  const color = wp.s === 'me' ? me : opposite(me);
  /** @type {Square[]} */
  const found = [];
  eachPiece(board, (piece, sq) => {
    if (piece.color !== color || PT_OF[piece.type] !== wp.t) return;
    const named = wpiece(pieceRef(board, sq), me);
    if (named.f === wp.f && named.q === wp.q) found.push(sq);
  });
  return found.length === 1 ? found[0] : null;
}

/**
 * An effect without absent members.
 * @param {MotifCode} k @param {WPiece|null|undefined} [by] @param {WPiece|null|undefined} [on] @param {WPiece|null|undefined} [on2]
 * @param {PatternCode|null|undefined} [name]
 * @returns {Effect}
 */
function effect(k, by, on, on2, name) {
  /** @type {Effect} */
  const out = { k };
  if (by) out.by = by;
  if (on) out.on = on;
  if (on2) out.on2 = on2;
  if (name) out.name = name;
  return out;
}

/**
 * Area of a square as the child sees the board (section 4.14.1).
 * @param {Square} sq @param {Color} me @returns {Area}
 */
function areaOf(sq, me) {
  if (inPalace(sq, opposite(me))) return 'their_palace';
  if (inPalace(sq, me)) return 'my_palace';
  const depth = me === 'red' ? 9 - sq.row : sq.row;                 // 0 = the child's back rank
  if (depth >= 8) return 'their_back';
  if (depth <= 1) return 'my_back';
  if (sq.row === 4 || sq.row === 5) return 'river';
  const col = me === 'red' ? sq.col : 8 - sq.col;
  return col <= 2 ? 'left' : col <= 5 ? 'center' : 'right';
}

/**
 * The bands of section 3.6. `mate` is kept only as a real distance of 1..9 moves.
 * @param {number|null} cp child's view @param {number|null} mate @returns {Eval}
 */
function evalOf(cp, mate) {
  const v = typeof cp === 'number' && Number.isFinite(cp) ? cp : 0;
  /** @type {Eval} */
  const out = { b: v >= 600 ? 'won' : v >= 150 ? 'better' : v > -150 ? 'even' : v > -600 ? 'worse' : 'lost' };
  if (typeof mate === 'number' && Number.isInteger(mate) && mate !== 0 && Math.abs(mate) <= MATE_MAX) out.mate = mate;
  return out;
}

/** @returns {Net} */
const emptyNet = () => ({ gain: [], lose: [], cp: 0 });

/**
 * A settled outcome as a Net in the child's view.
 * @param {MaterialOutcome} outcome @param {boolean} mine the outcome is the child's (false: the rival's, and is turned round)
 * @returns {Net}
 */
function netOf(outcome, mine) {
  const won = outcome.won.map((p) => PT_OF[p.piece]).slice(0, NET_PIECES);
  const lost = outcome.lost.map((p) => PT_OF[p.piece]).slice(0, NET_PIECES);
  const cp = clampInt(outcome.net * 100, -CP_MAX, CP_MAX);
  return mine ? { gain: won, lose: lost, cp } : { gain: lost, lose: won, cp: clampInt(-cp, -CP_MAX, CP_MAX) };
}

/**
 * `cost` of section 4.14.2: the Net when anything changes hands or the balance is a point or more, else null.
 * @param {MaterialOutcome} outcome @param {boolean} mine @returns {Net|null}
 */
function costOf(outcome, mine) {
  if (outcome.won.length === 0 && outcome.lost.length === 0 && Math.abs(outcome.net) < 1) return null;
  return netOf(outcome, mine);
}

/**
 * The continuation of a line after its first move, as it goes on the wire (at most six moves), with the moves it lists.
 * `end` describes the last listed move: a truncated or cut line reads 'quiet' (its balance is settled in `net`).
 * @param {Line} line the move followed by its continuation @param {Side} first who plays the first listed move @param {Net} net
 * @returns {{wire:WLine, moves:MoveInfo[]}|null} null when the line has no continuation
 */
function continuation(line, first, net) {
  const rest = line.moves.slice(1);
  if (rest.length === 0) return null;
  const moves = rest.slice(0, LIMITS.LINE_MOVES);
  /** @type {WLine['end']} */
  const end = moves.length < rest.length || line.end === 'cut' ? 'quiet' : line.end;
  return { wire: { first, moves: moves.map((m) => m.notation), net, end }, moves };
}

/**
 * A line that may still be a bare list of moves (teacher.js returns principal variations, brain.js converts them): as a Line.
 * @param {unknown} line @param {Board} board @param {Color} turn the position the line starts in
 * @returns {Line|null}
 */
function asLine(line, board, turn) {
  if (Array.isArray(line)) return toLine(board, turn, line);
  if (typeof line === 'object' && line !== null && Array.isArray(/** @type {{moves?:unknown}} */ (line).moves)) return /** @type {Line} */ (line);
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The board as the rules engine sees it: attacks, legal captures, the exchange on one square
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The occupied squares strictly between two squares of one rank or file, nearest to `a` first; null when they are not on one line.
 * @param {Board} board @param {Square} a @param {Square} b @returns {Square[]|null}
 */
function between(board, a, b) {
  if (sameSquare(a, b) || (a.row !== b.row && a.col !== b.col)) return null;
  const dr = Math.sign(b.row - a.row), dc = Math.sign(b.col - a.col);
  /** @type {Square[]} */
  const out = [];
  for (let row = a.row + dr, col = a.col + dc; row !== b.row || col !== b.col; row += dr, col += dc) {
    if (board[row][col]) out.push({ row, col });
  }
  return out;
}

/**
 * Does the piece on `from` attack the point `to`, i.e. could it capture there whatever stands on it? The move rules of the
 * engine without the test of the mover's own king (a guard that is pinned still counts as a guard, as in the position facts).
 * @param {Board} board @param {Square} from @param {Square} to @returns {boolean}
 */
function attacksSquare(board, from, to) {
  const piece = board[from.row][from.col];
  if (!piece || sameSquare(from, to)) return false;
  const dr = to.row - from.row, dc = to.col - from.col;
  switch (piece.type) {
    case 'rook':
      return between(board, from, to)?.length === 0;
    case 'cannon':
      return between(board, from, to)?.length === 1;
    case 'horse': {
      if (!((Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2))) return false;
      return Math.abs(dr) === 2 ? !board[from.row + Math.sign(dr)][from.col] : !board[from.row][from.col + Math.sign(dc)];
    }
    case 'elephant':
      return Math.abs(dr) === 2 && Math.abs(dc) === 2 && !acrossRiver(to, piece.color) && !board[from.row + dr / 2][from.col + dc / 2];
    case 'advisor':
      return Math.abs(dr) === 1 && Math.abs(dc) === 1 && inPalace(to, piece.color);
    case 'king':
      return Math.abs(dr) + Math.abs(dc) === 1 && inPalace(to, piece.color);
    case 'pawn':
      if (dc === 0 && dr === (piece.color === 'red' ? -1 : 1)) return true;
      return dr === 0 && Math.abs(dc) === 1 && acrossRiver(from, piece.color);
    default:
      return false;
  }
}

/**
 * Does a piece on `mid` cut the attack of the piece on `attacker` against `target`? Rook, cannon and king: `mid` lies between
 * them; horse: `mid` is the leg; elephant: `mid` is the eye.
 * @param {Board} board @param {Square} attacker @param {Square} target @param {Square} mid @returns {boolean}
 */
function cutsAttack(board, attacker, target, mid) {
  const piece = board[attacker.row][attacker.col];
  if (!piece) return false;
  const dr = target.row - attacker.row, dc = target.col - attacker.col;
  if (piece.type === 'rook' || piece.type === 'cannon' || piece.type === 'king') {
    if (dr !== 0 && dc !== 0) return false;
    if (dr === 0) return mid.row === attacker.row && (mid.col - attacker.col) * (mid.col - target.col) < 0;
    return mid.col === attacker.col && (mid.row - attacker.row) * (mid.row - target.row) < 0;
  }
  if (piece.type === 'horse') {
    if (Math.abs(dr) === 2 && Math.abs(dc) === 1) return mid.row === attacker.row + Math.sign(dr) && mid.col === attacker.col;
    if (Math.abs(dr) === 1 && Math.abs(dc) === 2) return mid.row === attacker.row && mid.col === attacker.col + Math.sign(dc);
    return false;
  }
  if (piece.type === 'elephant') {
    return Math.abs(dr) === 2 && Math.abs(dc) === 2 && mid.row === attacker.row + dr / 2 && mid.col === attacker.col + dc / 2;
  }
  return false;
}

/**
 * The squares of the pieces of `side` that can legally capture on `sq`, cheapest piece first (equal pieces row-major).
 * @param {Board} board @param {Color} side @param {Square} sq @returns {Square[]}
 */
function legalCapturers(board, side, sq) {
  /** @type {{from:Square, value:number}[]} */
  const found = [];
  eachPiece(board, (piece, from) => {
    if (piece.color !== side || !attacksSquare(board, from, sq)) return;
    if (isInCheck(applyMove(board, { from, to: sq }), side)) return;
    found.push({ from, value: valueOf(piece, from) });
  });
  return found.sort((a, b) => a.value - b.value).map((entry) => entry.from);
}

/**
 * The best `side` can win by capturing on `sq` (0 when it declines) and the pieces taken along that line: the exact minimax
 * over the legal captures on that square, as core/facts.js computes its exchange values.
 * @param {Board} board @param {Color} side @param {Square} sq
 * @returns {{value:number, taken:{piece:Piece, by:Color}[]}}
 */
function bestExchange(board, side, sq) {
  /** @type {{value:number, taken:{piece:Piece, by:Color}[]}} */
  let best = { value: 0, taken: [] };
  const victim = board[sq.row][sq.col];
  if (!victim || victim.type === 'king') return best;
  const worth = valueOf(victim, sq);
  for (const from of legalCapturers(board, side, sq)) {
    const sub = bestExchange(applyMove(board, { from, to: sq }), opposite(side), sq);
    const value = worth - sub.value;
    if (value > best.value) best = { value, taken: [{ piece: victim, by: side }, ...sub.taken] };
  }
  return best;
}

/**
 * Value for the mover of playing `move` and then the best sequence of captures on its destination, with the pieces taken.
 * @param {Board} board @param {MoveRef} move a legal move
 * @returns {{value:number, taken:{piece:Piece, by:Color}[]}}
 */
function exchangeOf(board, move) {
  const mover = /** @type {Piece} */ (board[move.from.row][move.from.col]);
  const victim = board[move.to.row][move.to.col];
  const sub = bestExchange(applyMove(board, move), opposite(mover.color), move.to);
  const taken = victim ? [{ piece: victim, by: mover.color }, ...sub.taken] : sub.taken;
  return { value: (victim ? valueOf(victim, move.to) : 0) - sub.value, taken };
}

/**
 * The pieces of the other side that `side` could take with a profit of a pawn or more if it were on move, each with its
 * best capturer (the cheapest among equals) and the profit; biggest profit first. Kings are never listed.
 * @param {Board} board @param {Color} side @returns {{sq:Square, by:Square, gain:number}[]}
 */
function hangingTo(board, side) {
  /** @type {{sq:Square, by:Square, gain:number, worth:number}[]} */
  const out = [];
  eachPiece(board, (piece, sq) => {
    if (piece.color === side || piece.type === 'king') return;
    /** @type {Square|null} */
    let by = null;
    let gain = -Infinity;
    for (const from of legalCapturers(board, side, sq)) {
      const value = exchangeOf(board, { from, to: sq }).value;
      if (value > gain) {
        gain = value;
        by = from;
      }
    }
    if (by !== null && gain >= 100) out.push({ sq, by, gain, worth: valueOf(piece, sq) });
  });
  return out.sort((a, b) => b.gain - a.gain || b.worth - a.worth);
}

/** Number of moves a rook on `sq` has along its lines (captures of a king left out). @param {Board} board @param {Square} sq @returns {number} */
function rookReach(board, sq) {
  const rook = board[sq.row][sq.col];
  if (!rook) return 0;
  let count = 0;
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    for (let row = sq.row + dr, col = sq.col + dc; row >= 0 && row < 10 && col >= 0 && col < 9; row += dr, col += dc) {
      const occupant = board[row][col];
      if (!occupant) {
        count++;
        continue;
      }
      if (occupant.color !== rook.color && occupant.type !== 'king') count++;
      break;
    }
  }
  return count;
}

/**
 * A move with which `side` would give checkmate at once if it were on move, or null.
 * @param {Board} board @param {Color} side @returns {MoveRef|null}
 */
function mateInOne(board, side) {
  const foe = opposite(side);
  for (const move of getLegalMoves(board, side)) {
    if (move.captured && move.captured.type === 'king') continue;
    const next = applyMove(board, move);
    if (isInCheck(next, foe) && getLegalMoves(next, foe).length === 0) return { from: move.from, to: move.to };
  }
  return null;
}

/** Free flights of the king of `color`: its legal steps inside the palace. @param {Board} board @param {Color} color @returns {number} */
function kingFlights(board, color) {
  const at = kingSquare(board, color);
  if (!at) return 0;
  return getPieceLegalMoves(board, at.row, at.col).filter((m) => Math.abs(m.to.row - at.row) + Math.abs(m.to.col - at.col) === 1).length;
}

// ---------------------------------------------------------------------------------------------------------------------
// Facts -> codes (section 4.14.3, the only mapping)
// ---------------------------------------------------------------------------------------------------------------------

/** Starting squares of rook, horse and cannon, as row * 9 + col. @type {Readonly<Record<Color, Readonly<Record<string, readonly number[]>>>>} */
const START_SQUARES = {
  red: { rook: [81, 89], horse: [82, 88], cannon: [64, 70] },
  black: { rook: [0, 8], horse: [1, 7], cannon: [19, 25] },
};
/** The named checks of row 8. @type {readonly string[]} */
const CHECK_NAMES = ['double_cannon', 'horse_cannon', 'trough_horse', 'corner_horse', 'discovered_check', 'double_check'];

/**
 * @typedef {Object} EffectContext
 * @property {Color} me                        the child's colour (pieces are worded against it)
 * @property {number|null} ply                 plies played before the move; null = unknown (no `develop` row)
 * @property {number|null} [givesMate]         assessment.flags.givesMate, when the move was assessed
 * @property {boolean} [sacrifice]             assessment.flags.sacrifice
 * @property {Pattern[]} [patterns]            the patterns of the move with the search-backed ones; default: those of the facts
 * @property {(() => PieceRef|null)} [defended] names the piece of the tag 保 (row 11)
 */

/**
 * The effects of a move, most important first, uncut (callers cut at LIMITS.EFFECTS). Always at least one (`quiet`).
 * Pieces are named where they stand after the move (a captured piece: where it stood).
 * @param {MoveFacts} mf @param {EffectContext} ctx @returns {Effect[]}
 */
function effectsOf(mf, ctx) {
  const { me } = ctx;
  /** @param {PieceRef|null|undefined} ref @returns {WPiece|undefined} */
  const w = (ref) => (ref ? wpiece(ref, me) : undefined);
  const after = boardOf(mf.fenAfter);
  const moved = after ? refAt(after, mf.move.to) : null;
  const played = (ctx.patterns ?? mf.patterns ?? []).filter((p) => p.stage === 'played');
  /** @type {Effect[]} */
  const out = [];

  const check = mf.check;
  const checker = check ? check.checkers.find((c) => sameSquare(c.at, mf.move.to)) ?? check.checkers[0] : undefined;
  // 1. mate; 2. the move starts a forced mate, or threatens one
  if (check && check.mate) {
    out.push(effect('mate', w(checker), null, null, played.find((p) => p.mate)?.id));
  } else if ((ctx.givesMate ?? 0) >= 2 || mf.mateThreat) {
    out.push(effect('mate_threat', w(moved)));
  }
  // 3. a sound sacrifice
  if (ctx.sacrifice) out.push(effect('sacrifice', w(moved)));
  // 4. the capture
  if (mf.capture) {
    const k = mf.capture.free ? 'capture_free' : mf.capture.exchange === 'even' ? 'trade' : 'capture';
    out.push(effect(k, w(moved), w(mf.capture.piece)));
  }
  // 5. fork
  /** @type {Set<number>} targets already named by the fork */
  const named = new Set();
  if (mf.fork && mf.fork.targets.length >= 2) {
    const [first, second] = mf.fork.targets;
    named.add(keyOf(first.at)).add(keyOf(second.at));
    out.push(effect('fork', w(mf.fork.by), w(first), w(second), mf.fork.withCheck ? 'check_fork' : 'fork_two'));
  }
  // 6. discovered attacks
  for (const t of mf.threats) {
    if (t.discovered && !named.has(keyOf(t.target.at))) out.push(effect('discovered', w(moved), w(t.target), w(t.by)));
  }
  // 7. a pin
  const pin = mf.pins.created.find((p) => !pinnedOnItsWay(p.pinned, p.by.at));
  if (pin) out.push(effect('pin', w(pin.by), w(pin.pinned), w(pin.shield)));
  // 8. check
  if (check && !check.mate) out.push(effect('check', w(checker), null, null, played.find((p) => has(CHECK_NAMES, p.id))?.id));
  // 9. other new attacks
  for (const t of mf.threats) {
    if (t.discovered || named.has(keyOf(t.target.at))) continue;
    out.push(t.viaScreen ? effect('cannon_mount', w(t.by), w(t.target), w(t.viaScreen)) : effect('attack', w(t.by), w(t.target)));
  }
  // 10. pieces brought to safety. The king is one of them when the move answers a check: it steps away, or the moved piece
  //     stands between it and the checker (the facts list no parry for a king, but they do say that the move escapes check
  //     and whether it interposes).
  let defends = false;
  if (mf.escapesCheck && after) {
    const king = kingSquare(after, mf.move.color);
    if (mf.move.piece === 'king') out.push(effect('escape', w(moved)));
    else if (king && mf.blocks.some((b) => b.kind === 'line' && cutsAttack(after, b.piece.at, king, mf.move.to))) {
      out.push(effect('block', w(moved), w(refAt(after, king))));
    }
  }
  for (const p of mf.parried) {
    if (p.how === 'moved') out.push(effect('escape', w(p.piece)));
    else if (p.how === 'blocked') out.push(effect('block', w(moved), w(p.piece)));
    else if (p.how === 'defended' && after && gotGuard(boardOf(mf.fenBefore), after, mf.move, p.piece.at)) {
      out.push(effect('defend', null, w(p.piece)));
      defends = true;
    }
  }
  // 11. the tag 保 without a parry
  if (!defends && mf.tags.includes('保') && ctx.defended) {
    const on = ctx.defended();
    if (on) out.push(effect('defend', null, w(on)));
  }
  // 12. a blocked horse leg or elephant eye
  for (const b of mf.blocks) {
    if (b.kind === 'horse-leg') out.push(effect('block_leg', w(moved), w(b.piece)));
    else if (b.kind === 'elephant-eye') out.push(effect('block_eye', w(moved), w(b.piece)));
  }
  // 13. the enemy king lost a flight
  if (mf.kingSqueeze.after < mf.kingSqueeze.before && after) {
    const at = kingSquare(after, opposite(mf.move.color));
    if (at) out.push(effect('restrict_king', null, w(refAt(after, at))));
  }
  // 14. a rook got its line
  for (const o of mf.opens) {
    if (o.piece.type === 'rook') out.push(effect('open_rook', null, w(o.piece)));
  }
  // 15. a pawn crossed the river
  if (mf.pawnCrossed) out.push(effect('cross_river', w(moved)));
  // 16. development
  if (ctx.ply !== null && ctx.ply <= DEVELOP_PLIES
    && (START_SQUARES[mf.move.color][mf.move.piece] ?? []).includes(keyOf(mf.move.from))) out.push(effect('develop', w(moved)));
  // 17. nothing above
  if (out.length === 0) out.push(effect('quiet'));
  return out;
}

/**
 * A pawn that has not crossed the river and is "pinned" from a point on its own file: it can only step forward along that
 * file and never leaves the line, so 它一动后面的子就丢 / 动不了 would not be true of it. Such a pin is not put into words.
 * @param {PieceRef} pinned @param {Square} by the pinning piece's square @returns {boolean}
 */
function pinnedOnItsWay(pinned, by) {
  return pinned.type === 'pawn' && !acrossRiver(pinned.at, pinned.color) && by.col === pinned.at.col;
}

/**
 * Is 给…补上保护 true of a piece the move made safe (a parry `defended` of the facts, which covers every way a piece
 * becomes safe other than stepping away, a real interposition or the capture of its attacker)? It is when a guard is what
 * keeps the piece safe: an enemy piece can still take it and the capture just does not pay any more, or the moved piece
 * guards it from its new square and did not before. A piece that is safe because the attack itself is gone (the moved piece
 * was the cannon's screen, say) got no guard.
 * @param {Board|null} before @param {Board} after @param {MoveRef} move @param {Square} sq the piece, where it stands after the move
 * @returns {boolean}
 */
function gotGuard(before, after, move, sq) {
  const piece = after[sq.row][sq.col];
  if (!piece) return false;
  if (legalCapturers(after, opposite(piece.color), sq).length > 0) return true;
  return attacksSquare(after, move.to, sq) && !(before !== null && attacksSquare(before, move.from, sq));
}

/**
 * The piece of the tag 保 (CONTRACT-NOTES 108): the most valuable piece of the mover that the moved piece guards from its new
 * square, did not guard from its old one, and that an enemy piece could take before the move.
 * @param {Board} before @param {Board} after @param {MoveRef} move @returns {PieceRef|null}
 */
function defendedPiece(before, after, move) {
  const mover = after[move.to.row][move.to.col];
  if (!mover) return null;
  /** @type {Square|null} */
  let best = null;
  let bestValue = -1;
  eachPiece(after, (piece, sq) => {
    if (piece.color !== mover.color || piece.type === 'king' || sameSquare(sq, move.to)) return;
    const value = valueOf(piece, sq);
    if (value <= bestValue || !attacksSquare(after, move.to, sq) || attacksSquare(before, move.from, sq)) return;
    if (legalCapturers(before, opposite(mover.color), sq).length === 0) return;
    best = sq;
    bestValue = value;
  });
  return best ? refAt(after, best) : null;
}

/**
 * The context of `effectsOf` for a move whose real facts are held.
 * @param {MoveFacts} mf @param {Color} me @param {number|null} ply @param {Partial<EffectContext>} [more]
 * @returns {EffectContext}
 */
function contextOf(mf, me, ply, more) {
  return {
    me,
    ply,
    defended: () => {
      const before = boardOf(mf.fenBefore), after = boardOf(mf.fenAfter);
      return before && after ? defendedPiece(before, after, mf.move) : null;
    },
    ...more,
  };
}

/**
 * The threat a move ignored: a piece of the mover that could already be taken with profit before the move, that the move left
 * where it stood (and whose attacker it did not take), and that the opponent takes in the line of the move.
 * @param {Assessed} assessed @param {PositionFacts|null} before the position facts before the move, when they are held
 * @returns {{piece:Square, by:Square}|null} the squares of the piece and of the piece that attacked it
 */
function ignoredThreat(assessed, before) {
  const { assessment: a, facts: mf } = assessed;
  if (!before || before.fen !== mf.fenBefore) return null;
  const mover = mf.move.color;
  const hung = before.hanging.filter((h) => h.piece.color === mover && !sameSquare(h.piece.at, mf.move.from) && !sameSquare(h.by.at, mf.move.to));
  if (hung.length === 0) return null;
  /** @type {Set<number>} squares the mover's pieces left in the line */
  const left = new Set();
  for (let k = 1; k < a.line.moves.length; k++) {
    const move = a.line.moves[k];
    if (move.color === mover) {
      left.add(keyOf(move.from));
    } else if (move.captured !== null && !left.has(keyOf(move.to))) {
      const h = hung.find((x) => sameSquare(x.piece.at, move.to));
      if (h) return { piece: h.piece.at, by: h.by.at };
    }
  }
  return null;
}

/**
 * The flaws of an assessed move (section 4.14.3), at most LIMITS.FLAWS: the danger of the refutation for a mistake or a blunder,
 * and `greedy` whenever the capture loses the exchange (a sound sacrifice excepted). Pieces are named where they stand after
 * the tried move, before the reply.
 *
 * A flaw is a sentence about the board, so a row is used only where its sentence is true:
 * - `unguard` (X一走，Y就没人保护了) when the moved piece was the guard; a piece the move merely uncovered is worded as `hang`;
 * - `hang` (没有保护，会被白吃) when nothing can take back; a guarded piece that is still lost is left under a threat (`ignore_threat`);
 * - `bad_trade` (用X去换Y) when the capturing piece is itself taken in the line;
 * - `waste` (这步没有实际作用) when the move has no effect at all;
 * - where the line loses a piece that could already be taken before the move, the flaw is the ignored threat.
 * @param {Assessed} assessed @param {Color} me @param {PositionFacts|null} before position facts before the move, when held
 * @param {boolean} quiet the move has no effect (its only effect is `quiet`)
 * @returns {Effect[]}
 */
function flawsOf(assessed, me, before, quiet) {
  const { assessment: a, facts: mf } = assessed;
  /** @param {PieceRef|null|undefined} ref @returns {WPiece|undefined} */
  const w = (ref) => (ref ? wpiece(ref, me) : undefined);
  const after = boardOf(mf.fenAfter);
  /** @param {Square} sq @returns {PieceRef|null} */
  const at = (sq) => (after ? refAt(after, sq) : null);
  const moved = at(mf.move.to);
  /** @type {Effect[]} */
  const flaws = [];
  /**
   * The ignored threat as a flaw. `by` is named only when that piece also plays the reply: every flaw of the table has the
   * piece of the reply as its rival piece, and the narrators say "it will play <the reply>" of it.
   * @returns {Effect|null}
   */
  const ignored = () => {
    const h = ignoredThreat(assessed, before);
    if (!h) return null;
    const reply = a.refutation?.reply;
    return effect('ignore_threat', reply && sameSquare(reply.from, h.by) ? w(at(h.by)) : null, w(at(h.piece)));
  };
  /** The win the move passed over, as a flaw: the piece the best line wins (null when that line only trades). @returns {Effect|null} */
  const missed = () => {
    const won = wonPiece(a.bestLine);
    return won ? effect('miss_capture', null, w(won)) : null;
  };

  const r = a.refutation;
  if ((a.cat === 'mistake' || a.cat === 'blunder') && r) {
    const reply = r.reply;
    /** A piece of the position after the reply, named where it stands before it. @param {Square|undefined} sq @returns {PieceRef|null} */
    const beforeReply = (sq) => (sq === undefined ? null : sameSquare(sq, reply.to) ? at(reply.from) : at(sq));
    /**
     * A piece the reply takes: `hang` (没有保护，会被白吃) when nothing can take back, else the threat it was left under.
     * @param {PieceRef|null} piece @returns {Effect}
     */
    const exposedTo = (piece) => {
      const free = !after || legalCapturers(applyMove(after, reply), mf.move.color, reply.to).length === 0;
      return effect(free ? 'hang' : 'ignore_threat', w(at(reply.from)), w(piece));
    };
    /** @type {Effect|null} */
    let flaw = null;
    switch (r.danger) {
      case 'allows_mate':
        flaw = effect('allow_mate');
        break;
      case 'misses_mate':
        flaw = effect('miss_mate');
        break;
      case 'hangs_moved_piece':
        flaw = mf.capture ? effect('greedy', w(moved), w(mf.capture.piece), w(at(reply.from))) : exposedTo(moved);
        break;
      case 'leaves_hanging':
        flaw = effect('ignore_threat', w(at(reply.from)), w(at(reply.to)));
        break;
      case 'unguards': {
        const cause = mf.exposed.find((e) => sameSquare(e.piece.at, reply.to))?.cause;
        flaw = cause === 'uncovered' ? exposedTo(at(reply.to)) : effect('unguard', w(moved), w(at(reply.to)));
        break;
      }
      case 'bad_trade': {
        // is the capturing piece itself taken where it landed, before it moves on?
        let traded = false;
        for (let k = 1; k < a.line.moves.length; k++) {
          const move = a.line.moves[k];
          if (k % 2 === 0 && sameSquare(move.from, mf.move.to)) break;
          if (k % 2 === 1 && sameSquare(move.to, mf.move.to)) {
            traded = true;
            break;
          }
        }
        // not traded: the loss lies elsewhere. A piece that was left en prise; else the win the capture passed over, by
        // the rule of the danger `misses_win` (Appendix A6.3: 200 cp worse than a best line that wins two points or more),
        // which the danger `bad_trade` stands in front of.
        flaw = traded && mf.capture ? effect('bad_trade', w(moved), w(mf.capture.piece))
          : ignored() ?? (!a.isBest && a.loss >= 200 && a.bestOutcome.net >= 2 ? missed() : null);
        break;
      }
      case 'walks_into_fork': {
        // The forking piece is named when it is one piece that attacks both targets once the reply is played. The facts
        // give the piece of the reply also when the targets have different attackers (a check that leaves two pieces en
        // prise to other pieces): X一步就能同时捉住… would then be said of a piece that attacks neither.
        const next = after ? applyMove(after, reply) : null;
        const [forker, first, second] = r.focus;
        const single = next !== null && forker !== undefined && first !== undefined && second !== undefined
          && attacksSquare(next, forker, first) && attacksSquare(next, forker, second);
        flaw = effect('walk_fork', single ? w(beforeReply(forker)) : null, w(beforeReply(first)), w(beforeReply(second)));
        break;
      }
      case 'walks_into_pin': {
        const pinned = beforeReply(r.focus[0]);
        if (pinned && r.focus[1] && !pinnedOnItsWay(pinned, r.focus[1])) flaw = effect('walk_pin', w(beforeReply(r.focus[1])), w(pinned));
        break;
      }
      case 'misses_win':
        flaw = missed();
        break;
      default:
        flaw = ignored() ?? (quiet ? effect('waste') : null);
    }
    if (flaw) flaws.push(flaw);
  }
  // 贪吃 whenever the capture loses the exchange: a flaw of a move that has something wrong with it. A move that is judged
  // sound all the same (the piece is won back by a discovered attack, say, or everything else loses more) has no flaw:
  // "why is this the best move?" must not be answered with a flaw. The guard that is named is the piece that takes back in
  // the line, when the line takes back.
  const sound = a.cat === 'brilliant' || a.cat === 'best' || a.cat === 'good';
  if (mf.capture && mf.capture.exchange === 'loses' && !sound && !a.flags.sacrifice && !flaws.some((f) => f.k === 'greedy' || f.k === 'bad_trade')) {
    const answer = a.line.moves[1];
    const guard = answer && sameSquare(answer.to, mf.move.to) ? answer.from : mf.capture.recapture ? mf.capture.recapture.from : null;
    flaws.push(effect('greedy', w(moved), w(mf.capture.piece), w(guard ? at(guard) : null)));
  }
  // The local narrator says of the rival piece of the first flaw that it plays the reply (是…在威胁。它会走【…】). The first
  // flaw therefore names a rival piece (its `by`, or the guard of a greedy capture) only when that piece does play the reply:
  // a guard that stays where it is while the rival plays something stronger, or a piece that pins without moving, is left
  // out, and the clause reads as its bare term.
  const lead = flaws[0];
  if (lead) {
    const answer = r ? r.reply : a.line.moves[1];
    const mover = answer ? w(at(answer.from)) : undefined;
    const rivalSide = mf.move.color === me ? 'opp' : 'me';
    for (const key of /** @type {const} */ (['by', 'on2'])) {
      const named = lead[key];
      if (named && named.s === rivalSide && !(mover && sameWPiece(named, mover))) delete lead[key];
    }
  }
  return flaws.slice(0, LIMITS.FLAWS);
}

/**
 * What the mover of a line wins in it: the most valuable piece it takes that is not paid for with a piece of the same type
 * (the rook of an exchange of rooks is not what the line wins), named where it stands at the start of the line (the board
 * the child sees). Null when the line takes nothing beyond such exchanges.
 * @param {Line} line @returns {PieceRef|null}
 */
function wonPiece(line) {
  const start = boardOf(line.start);
  if (!start) return null;
  /** @type {{piece:Piece, value:number}[]} */
  const won = [];
  /** @type {string[]} */
  const lost = [];
  let board = start;
  for (let k = 0; k < line.moves.length; k++) {
    const move = line.moves[k];
    if (!isSquare(move.from) || !isSquare(move.to) || !board[move.from.row][move.from.col]) break;
    const victim = board[move.to.row][move.to.col];
    if (victim && k % 2 === 0) won.push({ piece: victim, value: valueOf(victim, move.to) });
    else if (victim) lost.push(victim.type);
    board = applyMove(board, move);
  }
  for (const type of lost) {
    const paid = won.findIndex((entry) => entry.piece.type === type);
    if (paid >= 0) won.splice(paid, 1);
  }
  /** @type {{piece:Piece, value:number}|null} */
  let best = null;
  for (const entry of won) {
    if (best === null || entry.value > best.value) best = entry;
  }
  if (best === null) return null;
  const prize = best.piece;
  /** @type {Square|null} */
  let at = null;
  eachPiece(start, (piece, sq) => {
    if (piece === prize) at = sq;
  });
  return at ? refAt(start, at) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// A move without facts: what the rules engine alone establishes
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Move facts of a legal move, as far as the rules engine alone establishes them (see the header). The fields the effect table
 * reads are filled by the definitions of core/facts.js; `pins`, `exposed`, `allowsMate` and `patterns` are left empty (never
 * read from a sketch), `mateThreat` knows a mate in one only, and a move that gives or answers a check claims no new attack.
 * @param {Board} board @param {MoveRef} move a legal move of the side that owns the piece on `move.from`
 * @param {PositionFacts|null} facts the position facts of `board` with the mover to move, when they are held
 * @returns {MoveFacts}
 */
function sketchFacts(board, move, facts) {
  const info = describeMove(board, move);
  const me = info.color, foe = opposite(me);
  const { from, to } = info;
  const after = applyMove(board, move);
  const fenBefore = boardToFen(board, me);
  const known = facts && facts.turn === me && facts.fen === fenBefore ? facts : null;
  /** @param {Square} sq @returns {PieceRef} */
  const ref = (sq) => pieceRef(after, sq);

  const replies = getLegalMoves(after, foe);
  const givesCheck = isInCheck(after, foe);
  const wasInCheck = known ? known.check !== null : isInCheck(board, me);
  const victim = board[to.row][to.col];

  /** @type {MoveFacts['capture']} */
  let capture = null;
  if (victim) {
    const see = exchangeOf(board, move).value;
    capture = {
      piece: pieceRef(board, to),
      see,
      exchange: see >= 50 ? 'wins' : see <= -50 ? 'loses' : 'even',
      free: !replies.some((reply) => sameSquare(reply.to, to)),
      recapture: null,
    };
  }

  /** @type {MoveFacts['check']} */
  let check = null;
  if (givesCheck) {
    const squares = checkers(after, foe);
    check = {
      checkers: squares.map(ref),
      discovered: squares.some((sq) => !sameSquare(sq, to)),
      double: squares.length >= 2,
      replies: replies.length,
      mate: replies.length === 0,
    };
  }

  // New attacks: enemy pieces that can be taken with profit now and could not before (or by 200 more).
  /** @type {NewThreat[]} */
  const threats = [];
  if (!givesCheck && !wasInCheck && replies.length > 0) {
    /** @type {Map<number, number>} */
    const before = new Map();
    if (known) {
      for (const h of known.hanging) if (h.piece.color === foe) before.set(keyOf(h.piece.at), h.gain);
    } else {
      for (const h of hangingTo(board, me)) before.set(keyOf(h.sq), h.gain);
    }
    const lifted = board.map((row) => row.slice());
    lifted[from.row][from.col] = null;
    for (const h of hangingTo(after, me)) {
      const prev = before.get(keyOf(h.sq));
      if (prev !== undefined && h.gain - prev < 200) continue;
      const attacker = /** @type {Piece} */ (after[h.by.row][h.by.col]);
      const screen = attacker.type === 'cannon' ? between(after, h.by, h.sq) : null;
      threats.push({
        target: ref(h.sq),
        by: ref(h.by),
        capture: describeMove(after, { from: h.by, to: h.sq }),
        gain: h.gain,
        discovered: !sameSquare(h.by, to) && !attacksSquare(board, h.by, h.sq) && attacksSquare(lifted, h.by, h.sq),
        viaScreen: screen && screen.length === 1 ? ref(screen[0]) : null,
      });
    }
  }

  /** @type {MoveFacts['fork']} */
  let fork = null;
  if (threats.length >= 2) {
    const attackers = new Set(threats.map((t) => keyOf(t.by.at)));
    fork = { by: attackers.size === 1 ? threats[0].by : null, targets: threats.map((t) => t.target), withCheck: false };
  }

  // Parried: own pieces that could be taken with profit before and cannot now.
  /** @type {Parry[]} */
  const parried = [];
  if (!givesCheck) {
    const hungBefore = known
      ? known.hanging.filter((h) => h.piece.color === me).map((h) => ({ sq: h.piece.at, by: h.by.at }))
      : hangingTo(board, foe).map((h) => ({ sq: h.sq, by: h.by }));
    if (hungBefore.length > 0) {
      const hangsNow = new Set(hangingTo(after, foe).map((h) => keyOf(h.sq)));
      for (const h of hungBefore) {
        const at = sameSquare(h.sq, from) ? to : h.sq;
        if (hangsNow.has(keyOf(at))) continue;
        /** @type {Parry['how']} */
        let how = 'defended';
        if (sameSquare(h.sq, from)) how = 'moved';
        else if (sameSquare(h.by, to)) how = 'captured-attacker';
        else if (!replies.some((reply) => sameSquare(reply.to, at)) && cutsAttack(board, h.by, at, to)) how = 'blocked';
        parried.push({ piece: ref(at), how });
      }
    }
  }

  // A blocked horse leg or elephant eye (a move to an empty point only).
  /** @type {Block[]} */
  const blocks = [];
  if (!victim) {
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const horse = { row: to.row - dr, col: to.col - dc };
      if (!isSquare(horse)) continue;
      const piece = board[horse.row][horse.col];
      if (!piece || piece.color !== foe || piece.type !== 'horse') continue;
      const jumps = dr !== 0
        ? [{ row: horse.row + 2 * dr, col: horse.col - 1 }, { row: horse.row + 2 * dr, col: horse.col + 1 }]
        : [{ row: horse.row - 1, col: horse.col + 2 * dc }, { row: horse.row + 1, col: horse.col + 2 * dc }];
      if (jumps.some((sq) => isSquare(sq) && board[sq.row][sq.col]?.color !== foe)) blocks.push({ kind: 'horse-leg', piece: ref(horse) });
    }
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const elephant = { row: to.row + dr, col: to.col + dc }, far = { row: to.row - dr, col: to.col - dc };
      if (!isSquare(elephant) || !isSquare(far)) continue;
      const piece = board[elephant.row][elephant.col];
      if (!piece || piece.color !== foe || piece.type !== 'elephant' || acrossRiver(far, foe)) continue;
      blocks.push({ kind: 'elephant-eye', piece: ref(elephant) });
    }
  }

  // An answer to a check by standing between the checker and the king.
  if (wasInCheck && info.piece !== 'king') {
    const king = kingSquare(board, me);
    for (const checker of king ? checkers(board, me) : []) {
      if (king && !sameSquare(checker, to) && cutsAttack(board, checker, king, to)) blocks.push({ kind: 'line', piece: ref(checker) });
    }
  }

  // Own rooks (not the moved piece) that gained two or more moves. Not judged across a check.
  /** @type {Open[]} */
  const opens = [];
  if (!wasInCheck) {
    eachPiece(after, (piece, sq) => {
      if (piece.color !== me || piece.type !== 'rook' || sameSquare(sq, to)) return;
      const gained = rookReach(after, sq) - rookReach(board, sq);
      if (gained >= 2) opens.push({ piece: ref(sq), kind: 'line', gained });
    });
  }

  // 叫杀: the mover would mate at once if it could move again (a mate in one only; deeper mates need the facts' search).
  /** @type {MoveFacts['mateThreat']} */
  let mateThreat = null;
  if (!givesCheck && replies.length > 0) {
    const mating = mateInOne(after, me);
    if (mating) mateThreat = { in: 1, line: toLine(after, me, [mating]), pattern: null };
  }

  const guarded = defendedPiece(board, after, move);
  return {
    move: info,
    fenBefore,
    fenAfter: boardToFen(after, foe),
    tags: guarded ? ['保'] : [],
    capture,
    check,
    escapesCheck: wasInCheck,
    threats,
    parried,
    exposed: [],
    fork,
    pins: { created: [], released: [], suffered: [] },
    blocks,
    opens,
    kingSqueeze: { before: known ? known.kings[foe].free : kingFlights(board, foe), after: kingFlights(after, foe) },
    mateThreat,
    allowsMate: null,
    patterns: [],
    pawnCrossed: info.piece === 'pawn' && !acrossRiver(from, me) && acrossRiver(to, me),
  };
}

/**
 * The effects of a move for which no facts are held (uncut), from `sketchFacts`.
 * @param {Board} board @param {MoveRef} move @param {PositionFacts|null} facts @param {Color} me @param {number|null} ply
 * @param {boolean} startsMate the line of the move is known to end in a mate the mover gives, two or more moves away
 * @returns {Effect[]}
 */
function sketchEffects(board, move, facts, me, ply, startsMate) {
  const piece = isSquare(move.from) && isSquare(move.to) ? board[move.from.row][move.from.col] : null;
  if (!piece || !getPieceLegalMoves(board, move.from.row, move.from.col).some((legal) => sameSquare(legal.to, move.to))) return [effect('quiet')];
  const mf = sketchFacts(board, move, facts);
  return effectsOf(mf, contextOf(mf, me, ply, { givesMate: startsMate ? 2 : null }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Opening names (Appendix A6.4), as far as the two boards around a move show them
// ---------------------------------------------------------------------------------------------------------------------

/** @param {Color} color @returns {number} row 7 for red, row 2 for black */
const cannonRow = (color) => (color === 'red' ? 7 : 2);

/**
 * The opening rows that are read from the board alone: 顺炮 / 列炮 (black only), 当头炮, 屏风马.
 * @param {Board} board @param {Color} color @returns {PatternCode|null}
 */
function boardOpening(board, color) {
  /** @param {Color} side @param {number} col @param {string} type @returns {boolean} */
  const holds = (side, col, type) => {
    const piece = board[cannonRow(side)][col];
    return piece !== null && piece.color === side && piece.type === type;
  };
  /** @param {Color} side @param {number} col @returns {boolean} */
  const left = (side, col) => board[cannonRow(side)][col] === null;
  if (color === 'black' && holds('red', 4, 'cannon') && holds('black', 4, 'cannon')) {
    if ((left('red', 1) && left('black', 1)) || (left('red', 7) && left('black', 7))) return 'same_cannons';
    if ((left('red', 1) && left('black', 7)) || (left('red', 7) && left('black', 1))) return 'opposite_cannons';
  }
  if (holds(color, 4, 'cannon')) return 'central_cannon';
  if (holds(color, 2, 'horse') && holds(color, 6, 'horse')) return 'screen_horses';
  return null;
}

/** The opening rows that are read from a side's first move. @param {MoveInfo} move @returns {PatternCode|null} */
function firstMoveOpening(move) {
  const row = cannonRow(move.color);
  if (move.piece === 'elephant' && move.to.row === row && move.to.col === 4) return 'elephant_open';
  const forward = move.color === 'red' ? move.to.row < move.from.row : move.to.row > move.from.row;
  if (move.piece === 'pawn' && forward && (move.from.col === 2 || move.from.col === 6)) return 'pawn_lead';
  if (move.piece === 'horse' && forward && (move.to.col === 2 || move.to.col === 6)) return 'horse_open';
  if (move.piece === 'cannon' && move.to.row === move.from.row && (move.to.col === 3 || move.to.col === 5)) {
    return (move.from.col - 4) * (move.to.col - 4) < 0 ? 'palace_cannon' : 'corner_cannon';
  }
  return null;
}

/**
 * The opening code of the mover when it changed with this move, else null. A code read from the board changed when the board
 * before the move did not show it; a code read from the side's first move is new on that first move only.
 * @param {Board} before @param {Board} after @param {MoveInfo} move @param {number} ply plies played after the move
 * @returns {PatternCode|null}
 */
function openingChange(before, after, move, ply) {
  if (ply > OPENING_PLIES) return null;
  const now = boardOpening(after, move.color);
  if (now !== null) return now !== boardOpening(before, move.color) ? now : null;
  return ply === (move.color === 'red' ? 1 : 2) ? firstMoveOpening(move) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// buildTurnBrief
// ---------------------------------------------------------------------------------------------------------------------

/** Order of the material string. @type {readonly PT[]} */
const MAT_ORDER = ['R', 'H', 'C', 'P', 'A', 'E'];
/** @type {Readonly<Record<Threat['sev'], number>>} */
const SEV_RANK = { mate: 4, rook: 3, piece: 2, pawn: 1 };
/** Effects of a rival move that are a threat in themselves. @type {readonly string[]} */
const THREAT_MOTIFS = ['mate_threat', 'fork', 'discovered', 'pin', 'check', 'attack', 'cannon_mount'];
/** Threat codes whose clause needs no more than `by` and `on` (a Threat has no `on2`). @type {readonly string[]} */
const SPOKEN_THREATS = ['mate_threat', 'check', 'attack', 'cannon_mount'];
/** Effects that say what a chance is about. @type {readonly string[]} */
const CHANCE_MOTIFS = ['mate', 'mate_threat', 'capture', 'capture_free', 'trade', 'fork', 'discovered', 'pin', 'check', 'attack', 'cannon_mount'];

/** @param {number} gain centipawns @returns {Threat['sev']} */
const sevOf = (gain) => (gain >= 800 ? 'rook' : gain >= 300 ? 'piece' : 'pawn');

/**
 * Material of both sides: the string form of section 3.6 and the difference in centipawns, child's view.
 * @param {Board} board @param {Color} me @returns {TurnBrief['mat']}
 */
function materialOf(board, me) {
  /** @type {Record<Color, Record<string, number>>} */
  const counts = { red: {}, black: {} };
  const value = { red: 0, black: 0 };
  eachPiece(board, (piece, sq) => {
    if (piece.type === 'king') return;
    const t = PT_OF[piece.type];
    counts[piece.color][t] = (counts[piece.color][t] ?? 0) + 1;
    value[piece.color] += PIECE_VALUE[piece.type];
  });
  /** @param {Color} color @returns {string} */
  const text = (color) => MAT_ORDER.filter((t) => counts[color][t] > 0).map((t) => t + Math.min(9, counts[color][t])).join('');
  const rival = opposite(me);
  return { me: text(me), opp: text(rival), cp: clampInt(value[me] - value[rival], -CP_MAX, CP_MAX) };
}

/** `material.phase` of the position facts (Appendix A6.1), from the board. @param {Board} board @returns {number} */
function phaseOf(board) {
  let heavy = 0;
  eachPiece(board, (piece) => {
    if (piece.type === 'rook' || piece.type === 'cannon' || piece.type === 'horse') heavy += PIECE_VALUE[piece.type];
  });
  return 1 - Math.min(1, Math.max(0, (heavy - 1500) / 5500));
}

/**
 * The balance of a line that is walked move by move (a mating line of the position facts): what each side takes in it.
 * @param {MoveInfo[]} moves @param {Color} me @returns {Net}
 */
function netOfMoves(moves, me) {
  const net = emptyNet();
  let cp = 0;
  for (const move of moves) {
    if (move.captured === null) continue;
    const taken = { id: '', type: move.captured, color: opposite(move.color) };
    const list = move.color === me ? net.gain : net.lose;
    if (list.length < NET_PIECES) list.push(PT_OF[move.captured]);
    cp += (move.color === me ? 1 : -1) * valueOf(taken, move.to);
  }
  net.cp = clampInt(cp, -CP_MAX, CP_MAX);
  return net;
}

/**
 * The previous move's packet with nothing withheld (section 4.14.1): `held` false and the reply filled in.
 * @param {TryPacket} packet @param {MorePacket|null|undefined} more @returns {TryPacket}
 */
function unwithheld(packet, more) {
  return clone({ ...packet, held: false, reply: packet.reply ?? more?.reply ?? null });
}

/**
 * The rival's pending chance as the teaching choice reports it: the child's winning line, its first move, and whether the line
 * ends in a mate the child gives. Null when there is none.
 * @param {TurnReport} report @returns {{gain:number, line:Line, first:MoveInfo, mates:boolean}|null}
 */
function pendingChance(report) {
  const chance = report?.lastOpp?.choice?.chance;
  if (!chance || !report.board) return null;
  const line = asLine(chance.line, report.board, report.me);
  const first = line?.moves[0];
  if (!line || !first || !isSquare(first.from) || !isSquare(first.to)) return null;
  return { gain: chance.gain, line, first, mates: line.end === 'mate' && line.moves.length % 2 === 1 };
}

/**
 * The child's pending chance for the brief: its size, the leading effect of its first move and where that move lands. Never the
 * move, never the piece.
 * @param {TurnReport} report @returns {NonNullable<TurnBrief['chance']>|null}
 */
function chanceOf(report) {
  const pending = pendingChance(report);
  if (!pending) return null;
  const { gain, line, first, mates } = pending;
  /** @type {NonNullable<TurnBrief['chance']>['size']} */
  const size = mates ? 'mate' : gain >= 800 ? 'rook' : gain >= 300 ? 'piece' : gain >= 100 ? 'pawn' : 'position';
  let theme = sketchEffects(report.board, first, report.facts ?? null, report.me, report.ply, mates && line.moves.length >= 3)[0].k;
  // A first move that prepares the gain without a threat of its own (as far as the board shows): the chance is the capture
  // the line goes on to make.
  if (!has(CHANCE_MOTIFS, theme) && line.moves.some((move, k) => k % 2 === 0 && move.captured !== null)) theme = 'capture';
  return { size, theme, area: areaOf(first.to, report.me) };
}

/**
 * The threats of the position (section 4.14.1): the rival's forced mate, the child's pieces that can be taken with profit,
 * and what the pass search found beyond those; most severe first, at most LIMITS.THREATS. Each comes with the move to register.
 * @param {TurnReport} report @returns {{threat:Threat, move:MoveInfo}[]}
 */
function threatsOf(report) {
  const { me, board } = report;
  const facts = report.facts ?? null;
  const rival = opposite(me);
  /** @param {PieceRef|null} ref @returns {WPiece|undefined} */
  const w = (ref) => (ref ? wpiece(ref, me) : undefined);
  /** @type {{threat:Threat, move:MoveInfo, gain:number}[]} */
  const found = [];
  /** @param {Threat} threat @param {MoveInfo} move @param {number} gain */
  const add = (threat, move, gain) => {
    if (!found.some((entry) => entry.threat.move === threat.move)) found.push({ threat, move, gain });
  };

  if (facts) {
    // (a) the rival's forced mate
    const mate = facts.mates[rival];
    const first = mate?.line.moves[0];
    const by = first ? w(refAt(board, first.from)) : undefined;
    if (mate && first && by) {
      // a mate carries no balance: what the mating line takes on its way does not matter once the game is lost, and the
      // narrators add "and after that you lose …" to a threat only when its `net` lists a piece
      /** @type {Threat} */
      const threat = { k: 'mate_threat', by, move: first.notation, net: emptyNet(), sev: 'mate' };
      if (mate.pattern) threat.name = mate.pattern.id;
      add(threat, first, Infinity);
    }
    // (b) the child's pieces that can be taken with profit. `k` words them as attacked (捉 / 瞄着), also while the child is in
    //     check, when such a piece may still be saved by the answer to the check.
    for (const h of facts.hanging) {
      if (h.piece.color !== me) continue;
      const attacker = w(h.by), target = w(h.piece);
      if (!attacker || !target) continue;
      add({ k: h.by.type === 'cannon' ? 'cannon_mount' : 'attack', by: attacker, on: target, move: h.capture.notation,
        net: hangingNet(board, h.capture, h.gain, me, PT_OF[h.piece.type]), sev: sevOf(h.gain) }, h.capture, h.gain);
    }
  }
  // (c) the pass search, when it found more
  const t = report.threat;
  const lead = t && (t.kind === 'mate' || t.kind === 'wins-material' || t.kind === 'check') ? t.line.moves[0] : undefined;
  const by = lead ? w(refAt(board, lead.from)) : undefined;
  if (t && lead && by) {
    const net = netOf(t.outcome, false);
    const gain = Math.max(0, -net.cp);
    if (t.kind === 'mate') {
      add({ k: 'mate_threat', by, move: lead.notation, net: emptyNet(), sev: 'mate' }, lead, Infinity);
    } else if (t.kind === 'check') {
      // a check that wins less than a point (the pass search calls a line that wins more `wins-material`): the threat is
      // the check, and what either side takes in the line that follows is no part of it (对方下一步想走…，那样你白吃一个象
      // would be an odd intent)
      add({ k: 'check', by, move: lead.notation, net: emptyNet(), sev: sevOf(gain) }, lead, gain);
    } else if (lead.captured !== null) {
      const on = w(refAt(board, lead.to));
      add({ k: by.t === 'C' ? 'cannon_mount' : 'attack', by, ...(on ? { on } : {}), move: lead.notation, net, sev: sevOf(gain) }, lead, gain);
    } else {
      // the first move of a line that wins material without taking at once: its leading effect, when that is a threat
      // (a fork, a check, an attack ...); a deeper plan is not a direct threat and is not listed. A threat carries no `on2`,
      // so a pin or a discovered attack reads as its bare term: when the move also attacks a piece of the child outright,
      // that attack is the threat that is told.
      const effects = effectsOf(t.facts, { me, ply: null });
      const told = has(SPOKEN_THREATS, effects[0].k) ? effects[0]
        : effects.find((e) => (e.k === 'attack' || e.k === 'cannon_mount') && e.on?.s === 'me') ?? effects[0];
      if (has(THREAT_MOTIFS, told.k)) {
        const on = told.on && told.on.s === 'me' ? told.on : undefined;
        // the piece that acts is not always the piece that moves (a pawn steps aside and a cannon aims): it is named where
        // it stands now
        const after = boardOf(t.facts.fenAfter);
        const at = told.by && told.by.s === 'opp' && after ? squareOfPiece(after, told.by, me) : null;
        const actor = at && !sameSquare(at, lead.to) && board[at.row][at.col]?.color === rival ? w(refAt(board, at)) : undefined;
        add({ k: told.k, by: actor ?? by, ...(on ? { on } : {}), move: lead.notation, net, sev: sevOf(gain) }, lead, gain);
      }
    }
  }
  found.sort((a, b) => SEV_RANK[b.threat.sev] - SEV_RANK[a.threat.sev] || b.gain - a.gain);
  return found.slice(0, LIMITS.THREATS).map(({ threat, move }) => ({ threat, move }));
}

/**
 * The balance of a capture of a hanging piece of the child: the exchange on that square as the rules engine plays it, when
 * its value is the gain the position facts report; else the piece alone (the reading of section 4.14.1).
 * @param {Board} board @param {MoveInfo} capture the rival's capture @param {number} gain @param {Color} me @param {PT} lost
 * @returns {Net}
 */
function hangingNet(board, capture, gain, me, lost) {
  /** @type {Net} */
  const plain = { gain: [], lose: [lost], cp: clampInt(-gain, -CP_MAX, CP_MAX) };
  const victim = isSquare(capture.from) && isSquare(capture.to) ? board[capture.to.row][capture.to.col] : null;
  const mover = victim ? board[capture.from.row][capture.from.col] : null;
  if (!victim || !mover || victim.color !== me || mover.color === me) return plain;
  let exchange = exchangeOf(board, capture);
  if (exchange.value !== gain && isInCheck(board, me)) {
    // The child is in check: the facts give the profit that is left once the check is answered. Find an answer after which
    // the same capture has that value, and take its exchange.
    for (const answer of getLegalMoves(board, me)) {
      const next = applyMove(board, answer);
      if (next[capture.from.row][capture.from.col] !== mover || next[capture.to.row][capture.to.col] !== victim) continue;
      if (!legalCapturers(next, mover.color, capture.to).some((sq) => sameSquare(sq, capture.from))) continue;
      const settled = exchangeOf(next, capture);
      if (settled.value === gain) {
        exchange = settled;
        break;
      }
    }
  }
  if (exchange.value !== gain) return plain;
  const net = emptyNet();
  for (const { piece, by } of exchange.taken) {
    const list = by === me ? net.gain : net.lose;
    if (list.length < NET_PIECES) list.push(PT_OF[piece.type]);
  }
  net.cp = plain.cp;
  return net;
}

/**
 * The rival's last move as an OppMove (section 4.14.1), with the moves to register.
 * @param {TurnReport} report
 * @returns {{opp:OppMove, lines:{start:string, moves:MoveInfo[]}[]}|null}
 */
function oppOf(report) {
  const last = report.lastOpp;
  if (!last || !last.move || !last.facts) return null;
  const { me, board } = report;
  const mf = last.facts;
  const move = last.move;
  const choice = last.choice ?? null;                               // absent after an undo or a reload (CONTRACT-NOTES 28)
  /** @type {{start:string, moves:MoveInfo[]}[]} */
  const lines = [{ start: mf.fenBefore, moves: [move] }];
  const before = boardOf(mf.fenBefore), after = boardOf(mf.fenAfter);

  /** @type {OppMove['quality']} */
  let quality = 'normal';
  const loss = last.quality?.loss ?? choice?.loss ?? 0;
  if (choice) {
    if (choice.kind === 'chance' || choice.kind === 'finisher') quality = 'slip';
    else if (choice.kind === 'concession' && loss > 15) quality = 'soft';                 // CONTRACT-NOTES 107
    else if ((choice.kind === 'honest' || choice.kind === 'variety' || choice.kind === 'concession') && loss <= 15) quality = 'strong';
  }

  // name: the rival's opening when this move changed it, else the first pattern the move played
  const name = (before && after ? openingChange(before, after, move, report.ply) : null) ?? mf.patterns.find((p) => p.stage === 'played')?.id;

  // punishes: the rival's move is the refutation of the child's previous move, or takes a piece that move exposed. Only a
  // move that had something wrong with it left a hole (这步是在利用小主公上一步的疏漏): a move that was the best there was,
  // or sound, is not blamed for a piece that was lost whatever was played.
  let punishes = false;
  const prev = report.prev?.assessed;
  if (prev && (prev.assessment.cat === 'ok' || prev.assessment.cat === 'mistake' || prev.assessment.cat === 'blunder')) {
    const reply = prev.assessment.refutation?.reply;
    const exposed = move.captured !== null && prev.facts.exposed.some((e) => sameSquare(e.piece.at, move.to));
    punishes = (reply !== undefined && sameMove(reply, move)) || exposed;
  }

  // overlooked: what the rival could have taken and did not (never a mate he spared)
  /** @type {OppMove['overlooked']} */
  let overlooked;
  const missed = choice?.overlooked;
  if (missed && !missed.mate && before) {
    const first = asLine(missed.line, before, move.color)?.moves[0];
    if (first && first.captured !== null && isSquare(first.to) && !sameSquare(first.to, move.to)) {
      const target = board[first.to.row][first.to.col];
      const on = target && target.color === me && target.type === first.captured ? refAt(board, first.to) : null;
      if (on) {
        overlooked = { on: wpiece(on, me), move: first.notation };
        lines.push({ start: mf.fenBefore, moves: [first] });
      }
    }
  }

  /** @type {OppMove} */
  const opp = {
    move: move.notation,
    check: mf.check !== null,
    ...(move.captured !== null ? { captured: PT_OF[move.captured] } : {}),
    does: effectsOf(mf, contextOf(mf, me, report.ply - 1)).slice(0, LIMITS.EFFECTS),
    ...(name ? { name } : {}),
    quality,
    ...(punishes ? { punishes: true } : {}),
    ...(overlooked ? { overlooked } : {}),
  };
  return { opp, lines };
}

/**
 * The base brief of a thread. Registers in `book` the rival's move (and the capture he overlooked), every threat move, and the
 * child's previous move with the reply line of its packet. A moment of the memory is registered when it is one of those two
 * last moves: the memory keeps notations only, so the squares of an older moment are not known here.
 * @param {TurnReport} report
 * @param {GameMemory} memory
 * @param {MoveBook} book
 * @returns {TurnBrief}
 */
export function buildTurnBrief(report, memory, book) {
  const { me, board } = report;
  const rival = opposite(me);
  const facts = report.facts ?? null;
  const ply = clampInt(report.ply, 0, 600);
  const snapshot = memory && typeof memory.snapshot === 'function' ? memory.snapshot() : { moments: [], taught: [], mine: null };

  // The number of legal moves is the true count (CONTRACT-NOTES 69 d); none when it is not the child's move.
  const toMove = facts ? facts.turn === me : true;
  const n = !toMove ? 0 : report.legalCount > 0 ? clampInt(report.legalCount, 0, 120) : clampInt(getLegalMoves(board, me).length, 0, 120);
  const playing = n > 0;

  const material = facts ? facts.material.phase : phaseOf(board);
  /** @type {TurnBrief['phase']} */
  const phase = ply < 20 && material < 0.15 ? 'opening' : material >= 0.6 ? 'endgame' : 'middle';

  // mine: the memory's record of the child's previous move; the report fills in what the memory does not hold.
  let mine = snapshot.mine ? clone(snapshot.mine) : null;
  const prev = report.prev;
  if (prev && prev.move && has(CATS, prev.cat)) {
    if (mine === null || mine.move !== prev.move.notation) {
      mine = { move: prev.move.notation, cat: prev.cat, waited: prev.waited === true, self: prev.self === true };
    }
    if (prev.packet) mine = { ...mine, try: unwithheld(prev.packet, prev.more) };
  }

  const rivalMove = oppOf(report);
  // `cost` was the balance the best reply line predicted. Once the rival has answered, the price of the move is what the two
  // moves really took (the line stays in `reply`, as what he could have played): a predicted loss that did not happen, or
  // has not happened yet, is not reported as a fact. While the child can still take back on the square the rival took on,
  // the exchange is not over and no price is named.
  if (mine && mine.try && rivalMove && report.lastOpp) {
    /** @type {Net|null} */
    let cost = null;
    const answer = report.lastOpp.move;
    if (prev && prev.move && mine.move === prev.move.notation && !(answer.captured !== null && legalCapturers(board, me, answer.to).length > 0)) {
      const net = emptyNet();
      if (prev.move.captured !== null) net.gain.push(PT_OF[prev.move.captured]);
      if (answer.captured !== null) net.lose.push(PT_OF[answer.captured]);
      net.cp = (prev.move.captured !== null ? PIECE_VALUE[prev.move.captured] : 0) - (answer.captured !== null ? PIECE_VALUE[answer.captured] : 0);
      if (net.gain.length > 0 || net.lose.length > 0) cost = net;
    }
    mine = { ...mine, try: { ...mine.try, cost } };
  }
  const threats = playing ? threatsOf(report) : [];
  const chance = playing && report.announceChance === true ? chanceOf(report) : null;

  // The book: what stood before first, so that a notation that is also a move of the present position resolves to that move.
  if (book) {
    if (prev && prev.move && mine && mine.move === prev.move.notation) {
      const start = prev.assessed?.facts.fenBefore ?? '';
      const reply = prev.assessed && mine.try?.reply ? prev.assessed.assessment.line.moves.slice(1, 1 + mine.try.reply.moves.length) : [];
      book.add('mine', { start, moves: [prev.move, ...reply], end: 'quiet' });
    }
    for (const line of rivalMove?.lines ?? []) book.add('opp', { start: line.start, moves: line.moves, end: 'quiet' });
    for (const { move } of threats) book.add('threat', { start: { board, turn: rival }, moves: [move] });
  }

  return {
    ply,
    me,
    phase,
    check: isInCheck(board, me),
    n,
    back: report.back === 'undo' || report.back === 'reload' ? report.back : null,
    eval: evalOf(report.evalCp, report.mate),
    mat: materialOf(board, me),
    level: clampInt(report.level, 1, 9),
    moments: snapshot.moments.slice(-LIMITS.MOMENTS),
    taught: snapshot.taught.slice(-LIMITS.TAUGHT),
    mine,
    opp: rivalMove ? rivalMove.opp : null,
    threats: threats.map((entry) => entry.threat),
    chance,
    known: { threats: facts !== null, chance: report.announceChance === true },
  };
}

/**
 * The quiet caption of a rival move, e.g. "【马8进7】出子": the notation and a word of at most four characters, the name of the
 * opening or pattern the move played, else the term of its leading effect.
 * @param {TurnBrief} turn
 * @returns {string}
 */
export function oppCaption(turn) {
  const opp = turn?.opp;
  if (!opp) return '';
  const lead = opp.does[0]?.k;
  const word = opp.name ? PATTERN_NAME[opp.name] : lead ? MOTIF_TERM[lead] : '';
  return `【${opp.move}】${word ?? ''}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// buildTryPacket, buildToolVerdict
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Mate distance after an assessed move, in the mover's view: the mover's own moves still to play (0 when the move itself
 * mates), a negative number of the opponent's moves when the move allows a forced mate; null when there is no mate or its
 * distance is not known.
 * @param {Assessed} assessed @returns {number|null}
 */
function mateAfter(assessed) {
  const { assessment: a, facts: mf } = assessed;
  if (a.flags.givesMate !== null && a.flags.givesMate > 0) return a.flags.givesMate - 1;
  if (!a.flags.allowsMate) return null;
  if (a.line.end === 'mate' && a.line.moves.length % 2 === 0) return -(a.line.moves.length / 2);
  return mf.allowsMate ? -mf.allowsMate.in : null;
}

/**
 * What every verdict on a move carries (TryPacket and ToolVerdict): verdict, evaluation, effects, flaws, cost and the reply line.
 * @param {Assessed} assessed @param {Color} me the child's colour @param {number|null} ply plies played before the move
 * @param {PositionFacts|null} before position facts before the move, when they are held
 * @returns {{cat:Cat, loss:number, eval:Eval, does:Effect[], flaws:Effect[], cost:Net|null, reply:WLine|null, replyMoves:MoveInfo[]}}
 */
function verdictOf(assessed, me, ply, before) {
  const { assessment: a, facts: mf } = assessed;
  const mine = a.move.color === me;
  const sign = mine ? 1 : -1;
  const mate = mateAfter(assessed);
  const rest = continuation(a.line, mine ? 'opp' : 'me', netOf(a.outcome, mine));
  const does = effectsOf(mf, contextOf(mf, me, ply, { givesMate: a.flags.givesMate, sacrifice: a.flags.sacrifice, patterns: a.patterns }));
  return {
    cat: a.cat,
    loss: clampInt(a.loss, 0, CP_MAX),
    eval: evalOf(sign * a.moveCp, mate === null ? null : sign * mate),
    does: does.slice(0, LIMITS.EFFECTS),
    flaws: flawsOf(assessed, me, before, does[0].k === 'quiet'),
    cost: costOf(a.outcome, mine),
    reply: rest ? rest.wire : null,
    replyMoves: rest ? rest.moves : [],
  };
}

/**
 * The packet of a trial. `held` is computed here, once. `more` is what the first packet withholds.
 * @param {Assessed} assessed
 * @param {{turn:TurnBrief, report:TurnReport, prev:TryPacket|null, self:boolean, habit:HabitCode|null, avoided:HabitCode|null, repeat:boolean}} ctx
 * @param {MoveBook} book
 * @returns {{packet:TryPacket, more:MorePacket}}
 */
export function buildTryPacket(assessed, ctx, book) {
  const { assessment: a, facts: mf } = assessed;
  const { turn, report } = ctx;
  const me = turn.me;
  const base = book ? book.base : { board: report.board, turn: me };
  const facts = report.facts ?? null;
  const v = verdictOf(assessed, me, turn.ply, facts);
  const bad = v.cat === 'mistake' || v.cat === 'blunder';

  // held: a mistake with a concrete loss against the best reply, or one that allows a forced mate
  const held = bad && ((v.cost !== null && v.cost.cp <= -150) || (v.eval.mate ?? 0) < 0 || a.flags.allowsMate === true);

  // better: the comparison move first (the pinned move of the position), then the other alternatives of the table
  /** @type {Alt[]} */
  const better = [];
  /** @type {MoveInfo[][]} */
  const betterLines = [];
  if (!a.isBest && v.loss >= BETTER_GAIN) {
    const rest = continuation(a.bestLine, 'opp', netOf(a.bestOutcome, true));
    const startsMate = a.bestOutcome.mate === 'gives' && a.bestLine.moves.length >= 3;
    better.push({
      move: a.best.notation,
      gain: clampInt(v.loss, 1, CP_MAX),
      does: sketchEffects(base.board, a.best, facts, me, turn.ply, startsMate).slice(0, LIMITS.EFFECTS),
      line: rest ? rest.wire : null,
    });
    betterLines.push([a.best, ...(rest ? rest.moves : [])]);
  }
  for (const alt of a.alternatives) {
    if (better.length >= LIMITS.ALTS) break;
    const gain = Math.round(a.loss - alt.loss);
    if (gain < BETTER_GAIN || sameMove(alt.move, a.best) || sameMove(alt.move, a.move)) continue;
    better.push({
      move: alt.move.notation,
      gain: clampInt(gain, 1, CP_MAX),
      does: sketchEffects(base.board, alt.move, facts, me, turn.ply, false).slice(0, LIMITS.EFFECTS),
      line: null,
    });
    betterLines.push([alt.move]);
  }

  // toward: an abstract pointer to the better idea (the comparison move, when it is better by BETTER_GAIN), never the move
  /** @type {TryPacket['toward']} */
  const toward = better[0] && better[0].move === a.best.notation ? { area: areaOf(a.best.to, me), theme: better[0].does[0].k } : null;

  // chance: the rival's pending chance, taken or missed
  /** @type {TryPacket['chance']} */
  let chance = 'none';
  if (report.lastOpp?.choice?.chance) {
    const first = pendingChance(report)?.first;
    if ((first && sameMove(first, a.move)) || a.loss <= 60) chance = 'taken';
    else if (a.loss >= 150) chance = 'missed';
  }

  // only: the tried move is the one move that avoids a serious loss (the only move that wins something is a find, not a rescue)
  const only = a.flags.onlyMove === true && (a.isBest || v.cat === 'best' || v.cat === 'brilliant')
    && a.outcome.net < 1 && a.flags.givesMate === null;

  /** @type {TryPacket['vsPrev']} */
  let vsPrev;
  if (ctx.prev) {
    const diff = ctx.prev.loss - v.loss;
    vsPrev = diff > SAME_CP ? 'better' : diff < -SAME_CP ? 'worse' : 'same';
  }

  /** @type {TryPacket} */
  const packet = {
    move: a.move.notation,
    cat: v.cat,
    loss: v.loss,
    held,
    ...(only ? { only: true } : {}),
    ...(a.flags.sacrifice ? { sac: true } : {}),
    ...(ctx.self === true ? { self: true } : {}),
    ...(ctx.repeat === true ? { repeat: true } : {}),
    eval: v.eval,
    does: v.does,
    flaws: v.flaws,
    cost: v.cost,
    reply: held ? null : v.reply,
    toward,
    chance,
    ...(ctx.habit ? { habit: ctx.habit } : {}),
    ...(ctx.avoided ? { avoided: ctx.avoided } : {}),
    ...(vsPrev ? { vsPrev } : {}),
  };

  /** @type {MorePacket} */
  const more = held && v.reply ? { reply: v.reply, better } : { better };

  // The book: the try as the first move of a line from the base position, its reply line from the position after it,
  // the alternatives with their lines from the base position.
  if (book) {
    book.add('try', { start: base, moves: [a.move] });
    if (v.replyMoves.length > 0) book.add('reply', { start: mf.fenAfter, moves: v.replyMoves, end: 'quiet' });
    for (const moves of betterLines) book.add('better', { start: base, moves });
  }
  return { packet, more };
}

/**
 * The verdict of an `analyze_move` tool call, from the assess job on the position reached.
 * @param {Assessed} assessed
 * @param {{seq:N[], who:Side, activeTry:TryPacket|null, base:{board:Board, turn:Color}}} ctx
 * @param {MoveBook} book
 * @returns {ToolVerdict}
 */
export function buildToolVerdict(assessed, ctx, book) {
  const { assessment: a } = assessed;
  const base = ctx.base;
  const me = base.turn;
  const v = verdictOf(assessed, me, null, null);

  // The moves that lead to the assessed position, replayed from the base position (their notations as the engine writes them).
  /** @type {MoveInfo[]} */
  const played = [];
  let board = base.board;
  let turn = base.turn;
  /** The position the last replayed move was played in. @type {string} */
  let reached = '';
  const texts = Array.isArray(ctx.seq) ? ctx.seq : [];
  for (const text of texts) {
    const parsed = parseNotation(text, board, turn);
    if (!parsed.ok) break;
    played.push(parsed.move);
    reached = boardToFen(board, turn);
    board = applyMove(board, parsed.move);
    turn = opposite(turn);
  }
  // A sequence that does not replay from the base position down to the assessed move in the assessed position is not put
  // on the wire (its texts would be neither registered in the book nor known to be notations): the verdict then names the
  // assessed move alone.
  const whole = played.length === texts.length && played.length > 0 && played.length <= LIMITS.TOOL_AFTER + 1
    && sameMove(played[played.length - 1], a.move) && samePosition(reached, assessed.facts.fenBefore);
  const seq = whole ? played.map((m) => m.notation) : [a.move.notation];

  // A Net is measured from the thread's base position (section 3.6): what the moves that lead to the assessed position took
  // belongs to the balance of the line ("if I take the horse and he takes back" is a horse for a cannon, not a cannon lost).
  const before = netOfMoves(whole ? played.slice(0, -1) : [], me);
  /** @param {Net|null} net @returns {Net|null} */
  const fromBase = (net) => {
    if (before.gain.length === 0 && before.lose.length === 0) return net;
    return {
      gain: [...before.gain, ...(net ? net.gain : [])].slice(0, NET_PIECES),
      lose: [...before.lose, ...(net ? net.lose : [])].slice(0, NET_PIECES),
      cp: clampInt(before.cp + (net ? net.cp : 0), -CP_MAX, CP_MAX),
    };
  };

  /** @type {ToolVerdict} */
  const verdict = { seq, who: a.move.color === me ? 'me' : 'opp', cat: v.cat, loss: v.loss, eval: v.eval, does: v.does, flaws: v.flaws,
    cost: fromBase(v.cost), reply: v.reply ? { ...v.reply, net: /** @type {Net} */ (fromBase(v.reply.net)) } : null };
  const active = ctx.activeTry;
  if (whole && verdict.who === 'me' && active && seq.length === 1) {
    const diff = active.loss - v.loss;
    verdict.vsTry = diff > SAME_CP ? 'better' : diff < -SAME_CP ? 'worse' : 'same';
  }

  if (book) {
    if (whole) book.add('tool', { start: base, moves: [...played, ...v.replyMoves] });
    else book.add('tool', { start: assessed.facts.fenBefore, moves: [a.move, ...v.replyMoves], end: 'quiet' });
  }
  return verdict;
}

// ---------------------------------------------------------------------------------------------------------------------
// buildHintPacket
// ---------------------------------------------------------------------------------------------------------------------

/** HintTheme -> focus and theme (section 4.14.4); `tactic` takes its theme from the move. @type {Readonly<Record<Hint['theme'], [Hint1['focus'], MotifCode]>>} */
const HINT_IDEA = {
  mate: ['finish', 'mate'],
  escape_check: ['danger', 'check'],
  stop_mate: ['danger', 'mate_threat'],
  win_material: ['chance', 'capture_free'],
  tactic: ['chance', 'fork'],
  save_piece: ['danger', 'escape'],
  trade: ['improve', 'trade'],
  attack: ['chance', 'attack'],
  develop: ['develop', 'develop'],
  defend: ['danger', 'defend'],
  improve: ['improve', 'quiet'],
};

/**
 * The packet of one pouch. Levels 1 and 2 contain no notation; level 3 registers its move and line in `book`.
 * @param {1|2|3} level
 * @param {Hint} hint
 * @param {{turn:TurnBrief, report:TurnReport}} ctx
 * @param {MoveBook} book
 * @returns {Hint1|Hint2|Hint3}
 */
export function buildHintPacket(level, hint, ctx, book) {
  const me = ctx?.turn?.me ?? hint.move.color;
  const mf = hint.facts;
  const ply = ctx?.turn ? ctx.turn.ply : null;
  const startsMate = hint.theme === 'mate' && !(mf.check && mf.check.mate);
  const does = effectsOf(mf, contextOf(mf, me, ply, { givesMate: startsMate ? 2 : null }));
  const idea = HINT_IDEA[hint.theme] ?? HINT_IDEA.improve;
  const focus = idea[0];
  let theme = idea[1];
  if (hint.theme === 'tactic') {
    // the leading effect of the move among fork, discovered attack and pin (a discovered check counts as a discovered attack)
    const lead = does.find((e) => e.k === 'fork' || e.k === 'discovered' || e.k === 'pin');
    theme = lead ? lead.k : mf.check?.discovered ? 'discovered' : does[0].k;
  } else if (hint.theme === 'save_piece') {
    // how the piece is saved: it steps away, the move stands in the way, guards it, or takes the attacker
    const lead = does.find((e) => e.k === 'escape' || e.k === 'block' || e.k === 'defend')
      ?? does.find((e) => e.k === 'capture_free' || e.k === 'capture' || e.k === 'trade');
    if (lead) theme = lead.k;
  }
  if (level === 1) return { focus, theme };
  if (level === 2) return { piece: wpiece(hint.piece, me), area: areaOf(hint.move.to, me), theme };

  const rest = continuation(hint.line, 'opp', netOf(hint.outcome, true));
  const alt = hint.alternatives[0];
  /** @type {Hint3} */
  const packet = {
    move: hint.move.notation,
    does: does.slice(0, LIMITS.EFFECTS),
    line: rest ? rest.wire : null,
  };
  if (alt) packet.alt = alt.notation;
  if (book) {
    book.add('hint', { start: book.base, moves: [hint.move, ...(rest ? rest.moves : [])] });
    if (alt) book.add('hint', { start: book.base, moves: [alt] });
  }
  return packet;
}

// ---------------------------------------------------------------------------------------------------------------------
// buildOverPacket
// ---------------------------------------------------------------------------------------------------------------------

/**
 * What a named pattern is an instance of, for the motif of the proudest move (`Moment.k` is a motif code).
 * @type {Readonly<Partial<Record<PatternCode, MotifCode>>>}
 */
const MOTIF_OF_PATTERN = {
  fork_two: 'fork', check_fork: 'fork', discovered_check: 'discovered', discovered_win: 'discovered', double_check: 'check',
  double_cannon: 'check', horse_cannon: 'check', trough_horse: 'check', corner_horse: 'check',
  iron_bolt: 'mate', smother: 'mate', double_rooks: 'mate', face_off: 'mate', heart_strike: 'mate', sacrifice_play: 'sacrifice',
};

/** @param {number} ply plies played before the move @returns {number} its move number */
const moveNumber = (ply) => clampInt(Math.floor(ply / 2) + 1, 1, 301);

/**
 * The game-over packet; owns the mapping from the brain's takeaways.
 * @param {{result:'win'|'loss'|'draw', reason:EndReason, finish:FinishResult, game:GameSkill, rankBefore:number, rankAfter:number,
 *          goalPrev:HabitCode|null, history:Ply[], humanColor:Color}} input
 * @param {MoveBook} book
 * @returns {{packet:OverPacket, goal:HabitCode|null, kept:boolean|null, proudPly:number|null}}
 */
export function buildOverPacket(input, book) {
  const { result, reason, game } = input;
  const samples = Array.isArray(game?.samples) ? game.samples : [];
  const takeaways = Array.isArray(input.finish?.takeaways) ? input.finish.takeaways : [];
  const history = Array.isArray(input.history) ? input.history : [];
  /** @param {number|undefined} ply @returns {MoveSample|undefined} */
  const sampleAt = (ply) => samples.find((s) => s.ply === ply);
  const foundTests = (/** @type {'win'|'save'} */ kind) => samples.filter((s) => s.test !== null && s.test.found && s.test.kind === kind).length;
  /** Moves to register: each with the ply it was played (or tried) at. @type {{ply:number, move:MoveInfo}[]} */
  const cited = [];

  // stats: only good things
  const stats = {
    good: samples.filter((s) => s.final.cat === 'brilliant' || s.final.cat === 'best' || s.final.cat === 'good').length,
    taken: foundTests('win'),
    captures: samples.filter((s) => s.captured !== null && s.captured !== undefined).length,
    brilliant: samples.filter((s) => s.final.cat === 'brilliant').length,
  };

  // proud: the highlight
  /** @type {Moment|null} */
  let proud = null;
  /** @type {number|null} */
  let proudPly = null;
  const highlight = takeaways.find((t) => t.kind === 'highlight');
  if (highlight && highlight.move && typeof highlight.ply === 'number') {
    proudPly = highlight.ply;
    proud = { n: moveNumber(highlight.ply), s: 'me', move: highlight.move.notation, tag: 'great' };
    // its motif, from what the game recorded about the move: a mate, the pattern it played, a capture, a check
    const flags = history[highlight.ply]?.flags;
    const pattern = highlight.pattern ?? sampleAt(highlight.ply)?.patterns[0];
    /** @type {MotifCode|undefined} */
    let k = flags?.mate ? 'mate' : pattern ? MOTIF_OF_PATTERN[pattern] : undefined;
    if (!k && highlight.move.captured !== null) k = 'capture';
    if (!k && flags?.check) k = 'check';
    if (k) proud.k = k;
    cited.push({ ply: highlight.ply, move: highlight.move });
  }

  // takeaway: exactly one, the first that exists
  /** @type {WTakeaway|null} */
  let takeaway = null;
  /** @type {HabitCode|null} */
  let goal = null;
  const lesson = takeaways.find((t) => t.kind === 'lesson');
  if (lesson && lesson.danger) {
    const code = lesson.danger === 'hangs_moved_piece' && lesson.move && lesson.move.captured !== null ? 'greedy' : HABIT_OF_DANGER[lesson.danger];
    if (code) {
      takeaway = { kind: 'habit', code, n: clampInt(lesson.count ?? 1, 0, 300) };
      goal = code;
      if (lesson.move && typeof lesson.ply === 'number') {
        /** @type {NonNullable<WTakeaway['ex']>} */
        const ex = { n: moveNumber(lesson.ply), move: lesson.move.notation };
        cited.push({ ply: lesson.ply, move: lesson.move });
        // the move the child went on to play instead, when it was a sound one
        const final = sampleAt(lesson.ply)?.final;
        if (final && !sameMove(final.move, lesson.move) && (final.cat === 'brilliant' || final.cat === 'best' || final.cat === 'good')) {
          ex.better = final.move.notation;
          cited.push({ ply: lesson.ply, move: final.move });
        }
        takeaway.ex = ex;
      }
    }
  }
  if (takeaway === null) {
    const pattern = takeaways.find((t) => t.kind === 'pattern');
    if (pattern && pattern.pattern) takeaway = { kind: 'idea', code: pattern.pattern };
    else if (result === 'win' && reason === 'checkmate') takeaway = { kind: 'strength', code: 'S_finish' };
    else if (foundTests('win') >= 2) takeaway = { kind: 'strength', code: 'S_tactics' };
    else if (foundTests('save') >= 2) takeaway = { kind: 'strength', code: 'S_defense' };
    else if (samples.length >= 15 && !samples.some((s) => s.final.cat === 'blunder')) takeaway = { kind: 'strength', code: 'S_steady' };
  }

  // kept: last game's goal
  /** @type {boolean|null} */
  const kept = !input.goalPrev || samples.length < 10 ? null : !samples.some((s) => s.habit === input.goalPrev);
  const rank = input.rankAfter > input.rankBefore ? { to: clampInt(input.rankAfter, 1, 9) } : null;

  if (book) {
    for (const { ply, move } of cited) {
      const before = history[ply]?.before;
      book.add('moment', { start: before ? boardToFen(before, move.color) : '', moves: [move], end: 'quiet' });
    }
  }

  /** @type {OverPacket} */
  const packet = { result, reason, moves: clampInt(samples.length, 0, 300), stats, takeaway, proud, goal, kept, rank };
  return { packet, goal, kept, proudPly };
}

// ---------------------------------------------------------------------------------------------------------------------
// buildRecap, isEarned, worthSpeaking, chanceAreaWord
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Local compaction of a long thread: the tries of the turn in order (the eight most recent), the highest pouch opened, and the
 * packet of the most recent try (the trial the questions that follow are about), whose move is always the last entry of the
 * tries. An earlier recap among the events is folded in.
 * @param {CoachEvent[]} events
 * @returns {RecapPacket}
 */
export function buildRecap(events) {
  /** @type {RecapPacket['tries']} */
  const tries = [];
  /** @type {0|1|2|3} */
  let hint = 0;
  /** @type {TryPacket|undefined} */
  let cur;
  for (const ev of Array.isArray(events) ? events : []) {
    if (ev.kind === 'recap') {
      for (const t of ev.recap.tries) tries.push({ move: t.move, cat: t.cat });
      if (ev.recap.hint > hint) hint = ev.recap.hint;
      if (ev.recap.cur) cur = ev.recap.cur;
    } else if (ev.kind === 'try') {
      tries.push({ move: ev.try.move, cat: ev.try.cat });
      cur = ev.try;
    } else if (ev.kind === 'hint' && ev.level > hint) {
      hint = ev.level;
    }
  }
  // the list of tries ends with the move of `cur`: the rendered block of the current trial does not name its move
  if (cur && tries[tries.length - 1]?.move !== cur.move) tries.push({ move: cur.move, cat: cur.cat });
  /** @type {RecapPacket} */
  const recap = { tries: tries.slice(-LIMITS.RECAP_TRIES), hint };
  if (cur) recap.cur = clone(cur);
  return recap;
}

/**
 * Praise is earned by difficulty or consequence, never by centipawns alone.
 * @param {Assessed} assessed
 * @param {{found:boolean, avoided:HabitCode|null}} info
 * @returns {boolean}
 */
export function isEarned(assessed, info) {
  const a = assessed.assessment;
  if (a.cat !== 'brilliant' && a.cat !== 'best') return false;
  if (info?.found === true || a.flags.onlyMove === true || a.revealBest >= 3 || (info?.avoided ?? null) !== null) return true;
  // the leading effect of the move: the tactic motifs all sit in the rows that need neither the ply nor the board
  const mf = assessed.facts;
  const lead = effectsOf(mf, { me: mf.move.color, ply: null, givesMate: a.flags.givesMate, sacrifice: a.flags.sacrifice, patterns: a.patterns })[0];
  return has(TACTIC_MOTIFS, lead.k);
}

/**
 * Whether a non-held trial deserves a spoken sentence under talk: 'smart'.
 * @param {TryPacket} packet
 * @param {boolean} earned
 * @returns {boolean}
 */
export function worthSpeaking(packet, earned) {
  return earned === true || packet.only === true || packet.sac === true || packet.repeat === true || packet.chance !== 'none'
    || packet.avoided !== undefined || has(NOTABLE_MOTIFS, packet.does[0]?.k)
    || ((packet.cat === 'mistake' || packet.cat === 'blunder') && !packet.held);
}

/**
 * The Chinese area word (lexicon AREA) of the rival's pending chance, for the director's 20 s nudge; null when there is none.
 * @param {TurnReport} report
 * @returns {string|null}
 */
export function chanceAreaWord(report) {
  const pending = report ? pendingChance(report) : null;
  return pending ? AREA[areaOf(pending.first.to, report.me)] : null;
}
