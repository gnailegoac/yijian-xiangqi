// src/coach/book.js (C2) — MoveBook: every notation put on the wire, with its coordinates (contract section 4.13).
// Every packet builder registers each notation it sends, so any 【notation】 the model copies from a packet resolves.

/**
 * @import { Board, Color, Line, MoveInfo, MoveRef, Square } from '../core/types.js'
 * @import { MoveLink } from './types.js'
 */

import { applyMove, boardToFen, getPieceLegalMoves, opposite } from '../core/engine.js';
import { moveCode, normalizeNotation, parseNotation } from '../core/notation.js';

/**
 * @typedef {Object} MoveBook
 * @property {{board:Board, turn:Color}} base
 * @property {(src:MoveLink['src'], line:Line|{start:{board:Board, turn:Color}, moves:MoveInfo[]}) => string[]} add
 *           registers every move of a line with coordinates, colour, its predecessors (`pre`) and `playable`; returns the notations
 * @property {(notation:string) => MoveLink|null} lookup
 * @property {(notation:string, tryMove?:MoveRef) => MoveLink|null} resolveLoose
 * @property {() => number} size
 */

const HANZI_NUMERALS = '一二三四五六七八九';

/** @param {unknown} sq @returns {sq is Square} */
function isSquare(sq) {
  if (typeof sq !== 'object' || sq === null) return false;
  const { row, col } = /** @type {{row?:unknown, col?:unknown}} */ (sq);
  return typeof row === 'number' && typeof col === 'number'
    && Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < 10 && col >= 0 && col < 9;
}

/** @param {unknown} move @returns {move is MoveRef} */
function isMoveRef(move) {
  if (typeof move !== 'object' || move === null) return false;
  const { from, to } = /** @type {{from?:unknown, to?:unknown}} */ (move);
  return isSquare(from) && isSquare(to);
}

/** @param {Square} sq @returns {Square} */
const copySquare = (sq) => ({ row: sq.row, col: sq.col });

/**
 * Placement and side to move of a line's start, in the form boardToFen writes them ("placement w|b"); null when it cannot be read.
 * Counters after the side letter are ignored, and `r` is read as red like fenToBoard does.
 * @param {unknown} start a FEN, or {board, turn}
 * @returns {string|null}
 */
function startKey(start) {
  if (typeof start === 'string') {
    const fields = start.trim().split(/\s+/);
    const side = fields[1] === 'b' ? 'b' : fields[1] === 'w' || fields[1] === 'r' ? 'w' : null;
    return side === null ? null : `${fields[0]} ${side}`;
  }
  if (typeof start !== 'object' || start === null) return null;
  const { board, turn } = /** @type {{board?:unknown, turn?:unknown}} */ (start);
  if (!Array.isArray(board) || (turn !== 'red' && turn !== 'black')) return null;
  return boardToFen(/** @type {Board} */ (board), turn);
}

/**
 * Whose numerals a notation is written in: 汉字 are red's, digits are black's. Null when its numerals disagree.
 * The numerals of a notation are its last character and, when the origin file is written, the character before the action.
 * @param {string} text a normalised notation
 * @returns {Color|null}
 */
function writerOf(text) {
  const chars = [...text];
  /** @type {Color|null} */
  let writer = null;
  for (const ch of [chars[chars.length - 1], chars[chars.length - 3]]) {
    if (ch === undefined) continue;
    /** @type {Color|null} */
    const side = HANZI_NUMERALS.includes(ch) ? 'red' : ch >= '1' && ch <= '9' ? 'black' : null;
    if (side === null) continue;
    if (writer !== null && writer !== side) return null;
    writer = side;
  }
  return writer;
}

/**
 * A MoveBook for one position. A `MoveLink` it hands out is shared with every later lookup of the same entry: treat it as
 * immutable.
 *
 * - `add(src, line)` registers the moves of one line in order and returns their notations (what the caller puts on the wire).
 *   A move is `playable` when it is the first move of a line that starts in the base position and it is a legal move of the side
 *   to move there (the child). A move that is not a well-formed MoveInfo ends the registration: it and what follows are left out.
 * - `lookup(notation)` normalises the text (brackets, full-width digits, variant glyphs; the numeral script is not changed) and
 *   answers with one entry by the priority of contract section 4.12 rule 2: a playable entry; else the entry of the most recent
 *   `add` call; inside one line the earliest occurrence.
 * - `resolveLoose(notation, tryMove)` parses a text that is not in the book against the legal moves of the child in the base
 *   position and of the rival in the position after the active try. The active try is `tryMove` when given, else the move most
 *   recently registered with `src: 'try'` (the markup stream passes none). One match is the answer. When both positions offer a
 *   match the numerals decide (汉字 are red's, digits are black's, as in the notation itself), and a text that is ambiguous for
 *   the side its numerals name is not resolved through the other side. A move of the child resolves to its playable entry when
 *   the book holds one, otherwise to a link built on the spot with `src: 'tool'`, playable, no predecessors. A rival's answer to
 *   the try resolves to a link with `src: 'reply'` and no predecessors: like the moves of a reply line it starts from the
 *   position after the try. A link built on the spot is not added to the book (it would go stale with the next try).
 * - `size()` is the number of distinct notations the book can look up.
 *
 * @param {{board:Board, turn:Color}} base  the position the child faces (before any tentative move)
 * @returns {MoveBook}
 */
export function createMoveBook(base) {
  /**
   * Registered moves by normalised notation: the link, the number of the `add` call that brought it, its place in that call's line.
   * @type {Map<string, {link:MoveLink, packet:number, index:number}[]>}
   */
  const byNotation = new Map();
  let packets = 0;
  /** @type {MoveRef|null} the move most recently registered as the child's try */
  let lastTry = null;
  /** @type {string|undefined} */
  let baseKey;

  /** @param {unknown} start @returns {boolean} */
  function startsAtBase(start) {
    if (typeof start === 'object' && start !== null) {
      const at = /** @type {{board?:unknown, turn?:unknown}} */ (start);
      if (at.board === base.board && at.turn === base.turn) return true;
    }
    const key = startKey(start);
    if (key === null) return false;
    baseKey ??= boardToFen(base.board, base.turn);
    return key === baseKey;
  }

  /** @param {MoveRef} move @returns {boolean} a legal move of the side to move in the base position */
  function legalInBase(move) {
    const { from, to } = move;
    if (base.board[from.row]?.[from.col]?.color !== base.turn) return false;
    return getPieceLegalMoves(base.board, from.row, from.col).some((legal) => legal.to.row === to.row && legal.to.col === to.col);
  }

  /**
   * The playable entry of a move of the child, when the book holds one (the most recently added).
   * @param {string} code
   * @returns {MoveLink|null}
   */
  function playableEntry(code) {
    /** @type {{link:MoveLink, packet:number}|null} */
    let best = null;
    for (const list of byNotation.values()) {
      for (const entry of list) {
        if (!entry.link.playable || entry.link.code !== code) continue;
        if (best === null || entry.packet > best.packet) best = entry;
      }
    }
    return best === null ? null : best.link;
  }

  /** @type {MoveBook['add']} */
  function add(src, line) {
    packets += 1;
    /** @type {string[]} */
    const notations = [];
    const moves = Array.isArray(line?.moves) ? line.moves : [];
    const atBase = moves.length > 0 && startsAtBase(line.start);
    /** @type {MoveLink['pre']} */
    const pre = [];
    for (let index = 0; index < moves.length; index++) {
      const move = moves[index];
      if (!isMoveRef(move) || (move.color !== 'red' && move.color !== 'black') || typeof move.notation !== 'string') break;
      const notation = normalizeNotation(move.notation);
      if (notation === '') break;
      const playable = index === 0 && atBase && move.color === base.turn && legalInBase(move);
      /** @type {MoveLink} */
      const link = {
        from: copySquare(move.from),
        to: copySquare(move.to),
        color: move.color,
        code: moveCode(move),
        pre: pre.map((step) => ({ from: copySquare(step.from), to: copySquare(step.to), color: step.color })),
        playable,
        src,
      };
      const list = byNotation.get(notation);
      if (list) list.push({ link, packet: packets, index });
      else byNotation.set(notation, [{ link, packet: packets, index }]);
      if (src === 'try' && playable) lastTry = { from: link.from, to: link.to };
      pre.push({ from: link.from, to: link.to, color: link.color });
      notations.push(notation);
    }
    return notations;
  }

  /** @type {MoveBook['lookup']} */
  function lookup(notation) {
    const list = byNotation.get(normalizeNotation(notation));
    if (!list) return null;
    let best = list[0];
    for (const entry of list) {
      if (entry.link.playable !== best.link.playable) {
        if (entry.link.playable) best = entry;
      } else if (entry.packet !== best.packet) {
        if (entry.packet > best.packet) best = entry;
      } else if (entry.index < best.index) {
        best = entry;
      }
    }
    return best.link;
  }

  /** @type {MoveBook['resolveLoose']} */
  function resolveLoose(notation, tryMove) {
    const text = normalizeNotation(notation);
    if (text === '') return null;
    const child = base.turn;
    const rival = opposite(child);

    const own = parseNotation(text, base.board, child);
    const tried = tryMove !== undefined ? tryMove : lastTry;
    const active = tried !== null && isMoveRef(tried) && legalInBase(tried) ? tried : null;
    const answer = active ? parseNotation(text, applyMove(base.board, active), rival) : null;

    const ownHit = own.ok ? own.move : null;
    const answerHit = answer !== null && answer.ok ? answer.move : null;
    const ownAmbiguous = !own.ok && own.reason === 'ambiguous';
    const answerAmbiguous = answer !== null && !answer.ok && answer.reason === 'ambiguous';
    const writer = writerOf(text);

    /** @type {MoveInfo|null} */
    let mine = null;
    /** @type {MoveInfo|null} */
    let theirs = null;
    if (ownHit && answerHit) {
      if (writer === child) mine = ownHit;
      else if (writer === rival) theirs = answerHit;
    } else if (ownHit) {
      if (!(answerAmbiguous && writer === rival)) mine = ownHit;
    } else if (answerHit) {
      if (!(ownAmbiguous && writer === child)) theirs = answerHit;
    }

    if (mine) {
      const code = moveCode(mine);
      return playableEntry(code)
        ?? { from: copySquare(mine.from), to: copySquare(mine.to), color: child, code, pre: [], playable: true, src: 'tool' };
    }
    if (theirs) {
      return { from: copySquare(theirs.from), to: copySquare(theirs.to), color: rival, code: moveCode(theirs), pre: [], playable: false, src: 'reply' };
    }
    return null;
  }

  return { base, add, lookup, resolveLoose, size: () => byNotation.size };
}
