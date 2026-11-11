/** Chinese chess rules. Rows run from black (0) to red (9). */

/** @import { Board, Color, GameStatus, Move, MoveRef, Piece, PieceType, PlyRecord, Square } from './types.js' */

export const RED = 'red';
export const BLACK = 'black';

/** @type {(row:number, col:number) => boolean} */
const INSIDE = (row, col) => row >= 0 && row < 10 && col >= 0 && col < 9;
const ORTHOGONAL = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAGONAL = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const CHINESE_NUMBERS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** @param {Color} color @returns {Color} */
export function opposite(color) {
  return color === RED ? BLACK : RED;
}

/** Board character of a piece ('' for an empty point). @param {{type:PieceType, color:Color}|null|undefined} piece @returns {string} */
export function pieceLabel(piece) {
  if (!piece) return '';
  const labels = {
    king: piece.color === RED ? '帅' : '将',
    advisor: piece.color === RED ? '仕' : '士',
    elephant: piece.color === RED ? '相' : '象',
    horse: '马', rook: '车', cannon: '炮',
    pawn: piece.color === RED ? '兵' : '卒',
  };
  return labels[piece.type] ?? '';
}

/** @returns {Board} */
export function createInitialBoard() {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  const backRank = ['rook', 'horse', 'elephant', 'advisor', 'king', 'advisor', 'elephant', 'horse', 'rook'];
  for (const color of [BLACK, RED]) {
    const row = color === BLACK ? 0 : 9;
    for (let col = 0; col < 9; col++) {
      board[row][col] = { id: `${color}-${backRank[col]}-${col}`, type: backRank[col], color };
    }
    const cannonRow = color === BLACK ? 2 : 7;
    for (const col of [1, 7]) {
      board[cannonRow][col] = { id: `${color}-cannon-${col}`, type: 'cannon', color };
    }
    const pawnRow = color === BLACK ? 3 : 6;
    for (const col of [0, 2, 4, 6, 8]) {
      board[pawnRow][col] = { id: `${color}-pawn-${col}`, type: 'pawn', color };
    }
  }
  return board;
}

/** @param {number} row @param {number} col @param {Color} color @returns {boolean} */
function inPalace(row, col, color) {
  return col >= 3 && col <= 5 && (color === RED ? row >= 7 && row <= 9 : row >= 0 && row <= 2);
}

/** @param {Board} board @param {Color} color @returns {Square|null} */
function findKing(board, color) {
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      if (board[row][col]?.type === 'king' && /** @type {Piece} */ (board[row][col]).color === color) return { row, col };
    }
  }
  return null;
}

/**
 * Pseudo-legal moves deliberately do not test the moving side's king.
 * @param {Board} board @param {number} row @param {number} col @returns {Move[]}
 */
function pseudoMoves(board, row, col) {
  const piece = board[row]?.[col];
  if (!piece) return [];
  /** @type {Move[]} */
  const moves = [];
  /** @param {number} toRow @param {number} toCol */
  const add = (toRow, toCol) => {
    if (!INSIDE(toRow, toCol) || board[toRow][toCol]?.color === piece.color) return;
    moves.push({ from: { row, col }, to: { row: toRow, col: toCol }, piece, captured: board[toRow][toCol] });
  };

  if (piece.type === 'rook' || piece.type === 'cannon') {
    for (const [dr, dc] of ORTHOGONAL) {
      let screened = false;
      for (let r = row + dr, c = col + dc; INSIDE(r, c); r += dr, c += dc) {
        const occupant = board[r][c];
        if (piece.type === 'rook') {
          add(r, c);
          if (occupant) break;
        } else if (!screened) {
          if (occupant) screened = true;
          else add(r, c);
        } else if (occupant) {
          add(r, c);
          break;
        }
      }
    }
  } else if (piece.type === 'horse') {
    for (const [dr, dc] of [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]]) {
      const legRow = row + (Math.abs(dr) === 2 ? Math.sign(dr) : 0);
      const legCol = col + (Math.abs(dc) === 2 ? Math.sign(dc) : 0);
      if (INSIDE(legRow, legCol) && !board[legRow][legCol]) add(row + dr, col + dc);
    }
  } else if (piece.type === 'elephant') {
    for (const [dr, dc] of DIAGONAL) {
      const r = row + dr * 2, c = col + dc * 2;
      if (!INSIDE(r, c) || (piece.color === RED ? r < 5 : r > 4)) continue;
      if (!board[row + dr][col + dc]) add(r, c);
    }
  } else if (piece.type === 'advisor') {
    for (const [dr, dc] of DIAGONAL) {
      if (inPalace(row + dr, col + dc, piece.color)) add(row + dr, col + dc);
    }
  } else if (piece.type === 'king') {
    for (const [dr, dc] of ORTHOGONAL) {
      if (inPalace(row + dr, col + dc, piece.color)) add(row + dr, col + dc);
    }
    // The flying-general rule is also used for attack detection.
    for (const dr of [-1, 1]) {
      for (let r = row + dr; INSIDE(r, col); r += dr) {
        const occupant = board[r][col];
        if (!occupant) continue;
        if (occupant.type === 'king' && occupant.color !== piece.color) add(r, col);
        break;
      }
    }
  } else if (piece.type === 'pawn') {
    add(row + (piece.color === RED ? -1 : 1), col);
    if (piece.color === RED ? row <= 4 : row >= 5) {
      add(row, col - 1);
      add(row, col + 1);
    }
  }
  return moves;
}

/**
 * Apply an already validated move; the source board and pieces are not mutated.
 * @param {Board} board @param {MoveRef} move @returns {Board} @throws {RangeError}
 */
export function applyMove(board, move) {
  const { from, to } = move;
  if (!INSIDE(from.row, from.col) || !INSIDE(to.row, to.col) || !board[from.row][from.col]) {
    throw new RangeError('Move has an invalid origin or destination.');
  }
  const next = board.map(row => row.slice());
  next[to.row][to.col] = next[from.row][from.col];
  next[from.row][from.col] = null;
  return next;
}

/** @param {Board} board @param {Color} color @returns {boolean} */
export function isInCheck(board, color) {
  const king = findKing(board, color);
  if (!king) return true;
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      if (board[row][col]?.color !== opposite(color)) continue;
      if (pseudoMoves(board, row, col).some(move => move.to.row === king.row && move.to.col === king.col)) return true;
    }
  }
  return false;
}

/** @param {Board} board @param {number} row @param {number} col @returns {Move[]} */
export function getPieceLegalMoves(board, row, col) {
  if (!INSIDE(row, col) || !board[row][col]) return [];
  const color = board[row][col].color;
  return pseudoMoves(board, row, col).filter(move => !isInCheck(applyMove(board, move), color));
}

/** @param {Board} board @param {Color} color @returns {Move[]} */
export function getLegalMoves(board, color) {
  if (!findKing(board, color)) return [];
  const moves = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      if (board[row][col]?.color === color) moves.push(...getPieceLegalMoves(board, row, col));
    }
  }
  return moves;
}

/** @param {Board} board @param {Color} turn the side to move @returns {GameStatus} */
export function getGameStatus(board, turn) {
  const check = isInCheck(board, turn);
  if (!findKing(board, turn)) return { over: true, winner: opposite(turn), reason: 'king-captured', check };
  if (!findKing(board, opposite(turn))) return { over: true, winner: turn, reason: 'king-captured', check };
  if (getLegalMoves(board, turn).length === 0) {
    return { over: true, winner: opposite(turn), reason: check ? 'checkmate' : 'stalemate', check };
  }
  return { over: false, winner: null, reason: null, check };
}

/**
 * Canonical notation of a move (contract Appendix A5.1). Files are counted from the mover's right; red writes
 * numerals as 一..九, black as half-width digits. The result always matches NOTATION_RE (codes.js).
 * @param {Board} board position before the move @param {MoveRef} move @returns {string}
 */
export function moveToNotation(board, move) {
  const { from, to } = move;
  const piece = board[from.row]?.[from.col] ?? /** @type {Partial<Move>} */ (move).piece;
  if (!piece) return '';
  const red = piece.color === RED;
  /** @param {number} value */
  const number = value => red ? CHINESE_NUMBERS[value] : String(value);
  /** @param {number} col */
  const file = col => red ? 9 - col : col + 1;
  /** The mover's pieces of the moved type; the origin always counts as one. @param {number} row @param {number} col */
  const peer = (row, col) => (row === from.row && col === from.col)
    || (board[row]?.[col]?.type === piece.type && board[row]?.[col]?.color === piece.color);
  // Rows of the origin file holding such pieces, front first (front = nearer the enemy).
  const same = [];
  for (let row = 0; row < 10; row++) {
    if (peer(row, from.col)) same.push(row);
  }
  if (!red) same.reverse();
  const label = pieceLabel(piece);
  let subject = `${label}${number(file(from.col))}`;
  if (same.length > 1 && (piece.type === 'rook' || piece.type === 'cannon' || piece.type === 'horse')) {
    subject = `${same[0] === from.row ? '前' : '后'}${label}`;
  } else if (same.length > 1 && piece.type === 'pawn') {
    const index = same.indexOf(from.row);
    const rank = index === 0 ? '前' : index === same.length - 1 ? '后' : same.length === 3 ? '中' : CHINESE_NUMBERS[index + 1];
    // Crowded: two or more files each hold two or more of the mover's pawns; the file is then written as well (前兵七进一).
    let doubledFiles = 0;
    for (let col = 0; col < 9; col++) {
      let count = 0;
      for (let row = 0; row < 10; row++) {
        if (peer(row, col)) count++;
      }
      if (count > 1) doubledFiles++;
    }
    subject = `${rank}${label}${doubledFiles > 1 ? number(file(from.col)) : ''}`;
  }
  // King, advisor and elephant never take 前/后: the direction already tells two of them on one file apart.
  if (from.row === to.row) return `${subject}平${number(file(to.col))}`;
  const forward = red ? to.row < from.row : to.row > from.row;
  const destination = ['horse', 'elephant', 'advisor'].includes(piece.type) ? file(to.col) : Math.abs(to.row - from.row);
  return `${subject}${forward ? '进' : '退'}${number(destination)}`;
}

// ---- Additions of contract section 4.2 (FEN, position keys, checkers, repetition and draw rules; algorithms in Appendix A4). ----

export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
export const NO_CAPTURE_DRAW_PLIES = 120, MAX_PLIES = 600;

/** FEN letters as written for black; red uses the upper-case letter. @type {Readonly<Record<PieceType, string>>} */
const FEN_LETTER = { king: 'k', advisor: 'a', elephant: 'b', horse: 'n', rook: 'r', cannon: 'c', pawn: 'p' };
/** Letters accepted on input, lower-cased: e = elephant and h = horse are accepted as well. @type {Readonly<Record<string, PieceType>>} */
const FEN_TYPE = { k: 'king', a: 'advisor', b: 'elephant', e: 'elephant', n: 'horse', h: 'horse', r: 'rook', c: 'cannon', p: 'pawn' };

/**
 * Rows are written from row 0 (black back rank) to row 9, separated by '/'; digits are runs of empty points.
 * @param {Board} board
 * @param {Color} turn the side to move
 * @param {{halfmove:number, fullmove:number}} [counters]
 * @returns {string} "placement w|b" (+ " - - halfmove fullmove" when counters are given)
 */
export function boardToFen(board, turn, counters) {
  const rows = [];
  for (let row = 0; row < 10; row++) {
    let text = '';
    let empty = 0;
    for (let col = 0; col < 9; col++) {
      const piece = board[row][col];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty > 0) text += String(empty);
      empty = 0;
      text += piece.color === RED ? FEN_LETTER[piece.type].toUpperCase() : FEN_LETTER[piece.type];
    }
    if (empty > 0) text += String(empty);
    rows.push(text);
  }
  const fen = `${rows.join('/')} ${turn === RED ? 'w' : 'b'}`;
  return counters ? `${fen} - - ${counters.halfmove} ${counters.fullmove}` : fen;
}

/**
 * Rejects: not 10 rows, a row that does not sum to 9, unknown letters, more or fewer than one king per side, an unknown
 * side letter. Side letter w or r = red to move, b = black. Missing counters default to halfmove 0, fullmove 1.
 * Piece ids are `${color}-${type}-${col}`, with -2, -3, ... appended when that id is already used, so
 * fenToBoard(START_FEN).board deep-equals createInitialBoard().
 * @param {string} fen @returns {{board:Board, turn:Color, halfmove:number, fullmove:number}} @throws {RangeError}
 */
export function fenToBoard(fen) {
  if (typeof fen !== 'string') throw new RangeError('FEN must be a string.');
  const fields = fen.trim().split(/\s+/);
  const rows = fields[0].split('/');
  if (rows.length !== 10) throw new RangeError(`FEN must have 10 rows, found ${rows.length}.`);
  /** @type {Board} */
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  /** @type {Set<string>} */
  const ids = new Set();
  const kings = { red: 0, black: 0 };
  for (let row = 0; row < 10; row++) {
    let col = 0;
    for (const ch of rows[row]) {
      if (ch >= '1' && ch <= '9') {
        col += Number(ch);
        continue;
      }
      const lower = ch.toLowerCase();
      const type = /^[A-Za-z]$/.test(ch) && Object.hasOwn(FEN_TYPE, lower) ? FEN_TYPE[lower] : undefined;
      if (!type) throw new RangeError(`FEN row ${row} has an unknown character "${ch}".`);
      if (col > 8) throw new RangeError(`FEN row ${row} does not sum to 9.`);
      /** @type {Color} */
      const color = ch === ch.toUpperCase() ? RED : BLACK;
      let id = `${color}-${type}-${col}`;
      for (let n = 2; ids.has(id); n++) id = `${color}-${type}-${col}-${n}`;
      ids.add(id);
      board[row][col] = { id, type, color };
      if (type === 'king') kings[color]++;
      col++;
    }
    if (col !== 9) throw new RangeError(`FEN row ${row} does not sum to 9.`);
  }
  if (kings.red !== 1 || kings.black !== 1) throw new RangeError('FEN must have exactly one king per side.');
  const side = fields[1];
  if (side !== 'w' && side !== 'r' && side !== 'b') throw new RangeError(`FEN has an unknown side letter "${side ?? ''}".`);
  /** @param {string|undefined} text @param {number} fallback */
  const counter = (text, fallback) => text !== undefined && /^\d+$/.test(text) ? Number(text) : fallback;
  return { board, turn: side === 'b' ? BLACK : RED, halfmove: counter(fields[4], 0), fullmove: counter(fields[5], 1) };
}

/** Identity of a position for repetition: boardToFen(board, turn) without counters. @param {Board} board @param {Color} turn @returns {string} */
export function positionKey(board, turn) {
  return boardToFen(board, turn);
}

/**
 * Squares of the pieces giving check to `color`'s king ([] when not in check). Includes a facing king.
 * Row-major order. A side without a king has no checkers.
 * @param {Board} board @param {Color} color @returns {Square[]}
 */
export function checkers(board, color) {
  const king = findKing(board, color);
  /** @type {Square[]} */
  const squares = [];
  if (!king) return squares;
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      if (board[row][col]?.color !== opposite(color)) continue;
      if (pseudoMoves(board, row, col).some(move => move.to.row === king.row && move.to.col === king.col)) squares.push({ row, col });
    }
  }
  return squares;
}

/** @param {Board} board position before the move @param {MoveRef} move a legal move @returns {PlyRecord} */
export function plyRecord(board, move) {
  const after = applyMove(board, move);
  const mover = /** @type {Piece} */ (board[move.from.row][move.from.col]).color;
  const next = opposite(mover);
  return {
    key: positionKey(after, next),
    mover,
    check: isInCheck(after, next),
    capture: Boolean(board[move.to.row][move.to.col]),
  };
}

/**
 * The records that count since the last capture, with the keys of the positions they connect.
 * keys[i] is the position before tail[i]; keys[i + 1] is the position after it.
 * @param {string} startKey
 * @param {PlyRecord[]} log
 * @returns {{tail:PlyRecord[], keys:string[]}}
 */
function quietTail(startKey, log) {
  let last = log.length - 1;
  while (last >= 0 && !log[last].capture) last--;
  const tail = log.slice(last + 1);
  return { tail, keys: [last >= 0 ? log[last].key : startKey, ...tail.map(record => record.key)] };
}

/**
 * How often the position after `candidate` has occurred since the last capture (1 = new), and the side, if any,
 * that has given check with every one of its moves since the previous occurrence (the candidate included).
 * `log` is the list of PlyRecords that count for the draw rules; `startKey` is the key of the position before log[0].
 * @param {string} startKey
 * @param {PlyRecord[]} log
 * @param {PlyRecord} candidate the record of the move being judged
 * @returns {{count:number, checkingSide:Color|null}}
 */
export function repetition(startKey, log, candidate) {
  if (candidate.capture) return { count: 1, checkingSide: null };
  const { tail, keys } = quietTail(startKey, log);
  let count = 1;
  let previous = -1;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== candidate.key) continue;
    count++;
    previous = i;
  }
  if (count === 1) return { count, checkingSide: null };
  // The moves played since the most recent earlier occurrence, plus the candidate.
  const cycle = [...tail.slice(previous), candidate];
  for (const side of [candidate.mover, opposite(candidate.mover)]) {
    const moves = cycle.filter(record => record.mover === side);
    if (moves.length > 0 && moves.every(record => record.check)) return { count, checkingSide: side };
  }
  return { count, checkingSide: null };
}

/**
 * 'ok' a new position; 'repeat' its second occurrence (legal); at the third occurrence 'forbidden' when the mover
 * has checked with every move since the previous occurrence, else 'draw'.
 * @param {string} startKey
 * @param {PlyRecord[]} log
 * @param {Board} board position before the move
 * @param {MoveRef} move a legal move
 * @returns {'ok'|'repeat'|'draw'|'forbidden'}
 */
export function judgeMove(startKey, log, board, move) {
  const candidate = plyRecord(board, move);
  const { count, checkingSide } = repetition(startKey, log, candidate);
  if (count === 1) return 'ok';
  if (count === 2) return 'repeat';
  return checkingSide === candidate.mover ? 'forbidden' : 'draw';
}

/**
 * Legal moves minus 'forbidden' ones; if that would leave none, all legal moves. Same move objects as getLegalMoves.
 * @param {string} startKey
 * @param {PlyRecord[]} log
 * @param {Board} board
 * @param {Color} color the side to move
 * @returns {Move[]}
 */
export function playableMoves(startKey, log, board, color) {
  const legal = getLegalMoves(board, color);
  const allowed = legal.filter(move => judgeMove(startKey, log, board, move) !== 'forbidden');
  return allowed.length > 0 ? allowed : legal;
}

/**
 * Draw rules for the position reached by the last record of `log`; the first rule that holds gives the reason.
 * @param {string} startKey
 * @param {PlyRecord[]} log
 * @param {Board} board
 * @param {number} totalPlies plies played in the whole game (for the move limit)
 * @returns {{draw:boolean, reason:'repetition'|'no_capture'|'no_attackers'|'move_limit'|null}}
 */
export function drawStatus(startKey, log, board, totalPlies) {
  const { tail, keys } = quietTail(startKey, log);
  if (log.length > 0) {
    const lastKey = log[log.length - 1].key;
    if (keys.filter(key => key === lastKey).length >= 3) return { draw: true, reason: 'repetition' };
  }
  if (tail.length >= NO_CAPTURE_DRAW_PLIES) return { draw: true, reason: 'no_capture' };
  // Neither side has a rook, cannon, horse or pawn.
  const attacker = board.some(row => row.some(piece => !!piece && piece.type !== 'king' && piece.type !== 'advisor' && piece.type !== 'elephant'));
  if (!attacker) return { draw: true, reason: 'no_attackers' };
  if (totalPlies >= MAX_PLIES) return { draw: true, reason: 'move_limit' };
  return { draw: false, reason: null };
}
