/**
 * Move <-> notation and the tolerant parser (contract section 4.3; rules in Appendix A5).
 *
 * Round-trip property (tested): for every legal move m of every position,
 * parseNotation(moveToNotation(board, m), board, turn) succeeds and returns m, and the string matches NOTATION_RE.
 */

/** @import { Board, Color, Line, Move, MoveCode, MoveInfo, MoveRef, Piece, PieceRef, PieceType, Square } from './types.js' */

import { PT_OF } from './codes.js';
import { RED, opposite, pieceLabel, applyMove, isInCheck, getPieceLegalMoves, getLegalMoves, moveToNotation, boardToFen } from './engine.js';

export { moveToNotation } from './engine.js';

// ---- Shared pieces of Appendix A5.1 (the same quantities engine.moveToNotation writes) ----

const NUMERALS = '一二三四五六七八九';

/** File of a column in the owner's numbering, 1..9, counted from the owner's right. @param {Color} color @param {number} col @returns {number} */
function fileOf(color, col) {
  return color === RED ? 9 - col : col + 1;
}

/** A file or step count as its owner writes it: 一..九 for red, half-width digits for black. @param {Color} color @param {number} n @returns {string} */
function numeral(color, n) {
  return color === RED ? NUMERALS[n - 1] : String(n);
}

/**
 * Rows on column `col` holding `piece`'s side's pieces of the same type, front first
 * (front = nearer the enemy: ascending row for red, descending row for black).
 * @param {Board} board @param {number} col @param {{type:PieceType, color:Color}} piece @returns {number[]}
 */
function fileMates(board, col, piece) {
  const rows = [];
  for (let row = 0; row < 10; row++) {
    const other = board[row][col];
    if (other && other.type === piece.type && other.color === piece.color) rows.push(row);
  }
  if (piece.color !== RED) rows.reverse();
  return rows;
}

/**
 * The action half of a notation: 进 / 退 / 平 and its number (a file for a sideways move and for horse, elephant
 * and advisor; a step count otherwise).
 * @param {{type:PieceType, color:Color}} piece @param {Square} from @param {Square} to
 * @returns {{act:string, arg:number}}
 */
function actionOf(piece, from, to) {
  if (to.row === from.row) return { act: '平', arg: fileOf(piece.color, to.col) };
  const forward = piece.color === RED ? to.row < from.row : to.row > from.row;
  const byFile = piece.type === 'horse' || piece.type === 'elephant' || piece.type === 'advisor';
  return { act: forward ? '进' : '退', arg: byFile ? fileOf(piece.color, to.col) : Math.abs(to.row - from.row) };
}

/** @param {unknown} sq @returns {sq is Square} */
function isSquare(sq) {
  if (typeof sq !== 'object' || sq === null) return false;
  const { row, col } = /** @type {{row?:unknown, col?:unknown}} */ (sq);
  return typeof row === 'number' && typeof col === 'number'
    && Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < 10 && col >= 0 && col < 9;
}

// ---- Outward move shapes ----

/** @param {Board} board @param {MoveRef} move legal @returns {MoveInfo} @throws {RangeError} when the origin square is empty */
export function describeMove(board, move) {
  const piece = isSquare(move.from) && isSquare(move.to) ? board[move.from.row][move.from.col] : null;
  if (!piece) throw new RangeError('describeMove needs a move between two points of the board that starts on a piece.');
  const captured = board[move.to.row][move.to.col];
  return {
    from: { row: move.from.row, col: move.from.col },
    to: { row: move.to.row, col: move.to.col },
    notation: moveToNotation(board, move),
    piece: piece.type,
    color: piece.color,
    captured: captured ? captured.type : null,
  };
}

/**
 * Replay moves from a position, attaching notation; stops at the first illegal move.
 * end: 'mate' if the last replayed move mates, 'check' if it gives check, else 'quiet' (callers that know better set 'cut').
 * "Mates" means that the side to move after it has no legal move: checkmate, or 困毙 (no legal move without being in
 * check), which is a loss as well. A line with no replayed move is 'quiet'.
 * @param {Board} board
 * @param {Color} turn
 * @param {MoveRef[]} moves
 * @returns {Line}
 */
export function toLine(board, turn, moves) {
  const start = boardToFen(board, turn);
  /** @type {MoveInfo[]} */
  const played = [];
  let current = board;
  let side = turn;
  for (const move of moves) {
    if (!move || !isSquare(move.from) || !isSquare(move.to)) break;
    const { from, to } = move;
    if (current[from.row][from.col]?.color !== side) break;
    if (!getPieceLegalMoves(current, from.row, from.col).some(legal => legal.to.row === to.row && legal.to.col === to.col)) break;
    played.push(describeMove(current, move));
    current = applyMove(current, move);
    side = opposite(side);
  }
  /** @type {Line['end']} */
  let end = 'quiet';
  if (played.length > 0) {
    if (getLegalMoves(current, side).length === 0) end = 'mate';
    else if (isInCheck(current, side)) end = 'check';
  }
  return { start, moves: played, end };
}

// ---- Notation -> move (Appendix A5.2) ----

const STRIP_RE = /[\s【】[\]()（）「」『』“”‘’"']/g;
const TRAILING_RE = /[。，！？!?.,;；:：]+$/;
const FULL_WIDTH_DIGIT_RE = /[０-９]/g;
const VARIANT_RE = /[車俥馬傌砲包帥將進後]/g;
/** @type {Readonly<Record<string, string>>} */
const VARIANT = { 車: '车', 俥: '车', 馬: '马', 傌: '马', 砲: '炮', 包: '炮', 帥: '帅', 將: '将', 進: '进', 後: '后' };
/** PIECE tokens; which colour's glyph is used does not matter. @type {Readonly<Record<string, PieceType>>} */
const PIECE_OF_GLYPH = {
  车: 'rook', 马: 'horse', 炮: 'cannon', 相: 'elephant', 象: 'elephant', 仕: 'advisor', 士: 'advisor',
  帅: 'king', 将: 'king', 兵: 'pawn', 卒: 'pawn',
};
const ACTS = '进退平';
const RANKS = '前中后二三四';

/**
 * Trim, strip brackets and trailing punctuation, full-width digits to ASCII, variant glyphs to standard ones. Does not change numeral script.
 * Removes all whitespace and any of 【】[]()（）「」『』“”‘’"' wherever they stand, then trailing 。，！？!?.,;；:：.
 * @param {string} text
 * @returns {string}
 */
export function normalizeNotation(text) {
  return String(text ?? '')
    .replace(STRIP_RE, '')
    .replace(TRAILING_RE, '')
    .replace(FULL_WIDTH_DIGIT_RE, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30))
    .replace(VARIANT_RE, ch => VARIANT[ch]);
}

/** NUM token: 一..九 or 1..9, as a number 1..9; 0 when `ch` is not a numeral. @param {string} ch @returns {number} */
function numberOf(ch) {
  const index = NUMERALS.indexOf(ch);
  if (index >= 0) return index + 1;
  return ch >= '1' && ch <= '9' ? Number(ch) : 0;
}

/**
 * One notation split by grammar: G1 = PIECE NUM ACT NUM, G2 = RANK PIECE ACT NUM, G3 = RANK PIECE NUM ACT NUM.
 * rank is the RANK token (前 中 后 二 三 四; null in G1), fromFile 1..9 (null in G2), act 进 | 退 | 平, arg 1..9.
 * @param {string} normalized the output of normalizeNotation
 * @returns {{rank:string|null, type:PieceType, fromFile:number|null, act:string, arg:number}|null} null when no grammar fits
 */
function shapeOf(normalized) {
  const chars = [...normalized];
  if (chars.length !== 4 && chars.length !== 5) return null;
  const act = chars[chars.length - 2];
  const arg = numberOf(chars[chars.length - 1]);
  if (act.length !== 1 || !ACTS.includes(act) || arg === 0) return null;
  /** @param {string} ch @returns {PieceType|null} */
  const pieceOf = ch => Object.hasOwn(PIECE_OF_GLYPH, ch) ? PIECE_OF_GLYPH[ch] : null;
  /** @param {string} ch */
  const isRank = ch => ch.length === 1 && RANKS.includes(ch);
  if (chars.length === 4) {
    const type = pieceOf(chars[0]);
    const fromFile = numberOf(chars[1]);
    if (type && fromFile > 0) return { rank: null, type, fromFile, act, arg };                 // G1
    const ranked = pieceOf(chars[1]);
    if (isRank(chars[0]) && ranked) return { rank: chars[0], type: ranked, fromFile: null, act, arg };   // G2
    return null;
  }
  const type = pieceOf(chars[1]);
  const fromFile = numberOf(chars[2]);
  if (isRank(chars[0]) && type && fromFile > 0) return { rank: chars[0], type, fromFile, act, arg };      // G3
  return null;
}

/**
 * 前 index 0; 后 last index; 中 index 1 of 3; 二 / 三 / 四 index 1 / 2 / 3.
 * @param {string} rank @param {number} index position in the file, front first @param {number} count pieces of the type on the file
 * @returns {boolean}
 */
function rankMatches(rank, index, count) {
  switch (rank) {
    case '前': return index === 0;
    case '后': return index === count - 1;
    case '中': return count === 3 && index === 1;
    case '二': return index === 1;
    case '三': return index === 2;
    case '四': return index === 3;
    default: return false;
  }
}

/** @typedef {{ok:true, move:MoveInfo} | {ok:false, reason:'syntax'|'no_such_move'|'ambiguous', candidates:MoveInfo[]}} ParseResult */

/**
 * The only notation parser in the product.
 * Both numeral scripts are accepted for both sides, and either colour's glyph for a piece type. A text that fits a
 * grammar is matched against the legal moves of `turn`: exactly one match succeeds; none is 'no_such_move' with up to
 * three legal moves of the same piece type as candidates (same action first, then same origin file); several are
 * 'ambiguous' with those moves. Text that fits no grammar is 'syntax'.
 * @param {string} text @param {Board} board @param {Color} turn @returns {ParseResult}
 */
export function parseNotation(text, board, turn) {
  const shape = shapeOf(normalizeNotation(text));
  if (!shape) return { ok: false, reason: 'syntax', candidates: [] };
  /** @param {Piece} piece @param {Move} move */
  const actionFits = (piece, move) => {
    const { act, arg } = actionOf(piece, move.from, move.to);
    return act === shape.act && arg === shape.arg;
  };
  // The pieces of the named type that the side to move has, in board order (the order of getLegalMoves), each with
  // whether its origin file and its rank on that file fit the text (the quantities of Appendix A5.1).
  /** @type {{row:number, col:number, piece:Piece, fromFile:number, fits:boolean}[]} */
  const pieces = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      const piece = board[row][col];
      if (!piece || piece.color !== turn || piece.type !== shape.type) continue;
      const fromFile = fileOf(piece.color, col);
      let fits = shape.fromFile === null || shape.fromFile === fromFile;
      if (fits && shape.rank !== null) {
        const same = fileMates(board, col, piece);
        fits = same.length >= 2 && rankMatches(shape.rank, same.indexOf(row), same.length);
      }
      pieces.push({ row, col, piece, fromFile, fits });
    }
  }
  /** @type {Move[]} */
  const hits = [];
  for (const { row, col, piece, fits } of pieces) {
    if (!fits) continue;
    for (const move of getPieceLegalMoves(board, row, col)) {
      if (actionFits(piece, move)) hits.push(move);
    }
  }
  if (hits.length === 1) return { ok: true, move: describeMove(board, hits[0]) };
  if (hits.length > 1) return { ok: false, reason: 'ambiguous', candidates: hits.map(move => describeMove(board, move)) };
  // No such move: up to three legal moves of the same piece type, same act and arg first, then same origin file.
  /** @type {Move[][]} */
  const tiers = [[], [], []];
  for (const { row, col, piece, fromFile } of pieces) {
    for (const move of getPieceLegalMoves(board, row, col)) {
      tiers[actionFits(piece, move) ? 0 : shape.fromFile === fromFile ? 1 : 2].push(move);
    }
  }
  return { ok: false, reason: 'no_such_move', candidates: tiers.flat().slice(0, 3).map(move => describeMove(board, move)) };
}

/**
 * Canonical comparison key (numerals as ASCII digits, glyphs as type letters); null if no grammar fits.
 * The normalised text with every NUM written as a digit and the piece glyph as its type letter (K A E H R C P), so
 * 炮二平五 and 炮2平5 are both "C2平5", 相七进五 and 象7进5 both "E7进5"; 前车进一 is "前R进1", 前兵七进一 "前P7进1".
 * @param {string} text
 * @returns {string|null}
 */
export function notationKey(text) {
  const shape = shapeOf(normalizeNotation(text));
  if (!shape) return null;
  return `${shape.rank ?? ''}${PT_OF[shape.type]}${shape.fromFile ?? ''}${shape.act}${shape.arg}`;
}

// ---- Move codes ----

/** @param {MoveRef} ref @returns {MoveCode} */
export function moveCode(ref) {
  return `${ref.from.row}${ref.from.col}${ref.to.row}${ref.to.col}`;
}

/** @param {string} code @returns {MoveRef|null} null unless /^[0-9][0-8][0-9][0-8]$/ */
export function fromMoveCode(code) {
  if (typeof code !== 'string' || !/^[0-9][0-8][0-9][0-8]$/.test(code)) return null;
  return {
    from: { row: Number(code[0]), col: Number(code[1]) },
    to: { row: Number(code[2]), col: Number(code[3]) },
  };
}

// ---- Piece references ----

/**
 * The 前 / 中 / 后 word of a piece among `count` pieces of its type on one file (index 0 = front). With four or five the
 * middle ones are 二 三 四, and the last one is always 后.
 * @param {number} index @param {number} count @returns {string}
 */
function rankWord(index, count) {
  if (index === 0) return '前';
  if (index === count - 1) return '后';
  return count === 3 ? '中' : NUMERALS[index];
}

/**
 * Unique name of a piece within its side: the label alone when the side has one piece of that type; 前 / 后 + label
 * when it shares its file with another piece of that type (中 with three; the file numeral is appended, as in the
 * notation 前兵七, when two or more files hold such a group, which only pawns can do); else "<file>路<label>".
 * @param {Board} board @param {Square} at @param {Piece} piece @param {string} label @returns {string}
 */
function nameOf(board, at, piece, label) {
  let total = 0;
  let groupedFiles = 0;
  for (let col = 0; col < 9; col++) {
    const count = fileMates(board, col, piece).length;
    total += count;
    if (count >= 2) groupedFiles++;
  }
  if (total === 1) return label;
  const file = numeral(piece.color, fileOf(piece.color, at.col));
  const same = fileMates(board, at.col, piece);
  if (same.length < 2) return `${file}路${label}`;
  return `${rankWord(same.indexOf(at.row), same.length)}${label}${groupedFiles >= 2 ? file : ''}`;
}

/** PieceRef for the piece on `at` (label + unique name). @param {Board} board @param {Square} at @returns {PieceRef} @throws {RangeError} when `at` is empty */
export function pieceRef(board, at) {
  const piece = isSquare(at) ? board[at.row][at.col] : null;
  if (!piece) throw new RangeError('pieceRef needs a square that holds a piece.');
  const label = pieceLabel(piece);
  return { type: piece.type, color: piece.color, at: { row: at.row, col: at.col }, label, name: nameOf(board, at, piece, label) };
}
