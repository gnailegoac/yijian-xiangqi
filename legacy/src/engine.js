/** Chinese chess rules. Rows run from black (0) to red (9). */
export const RED = 'red';
export const BLACK = 'black';

const INSIDE = (row, col) => row >= 0 && row < 10 && col >= 0 && col < 9;
const ORTHOGONAL = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAGONAL = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const CHINESE_NUMBERS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function opposite(color) {
  return color === RED ? BLACK : RED;
}

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

function inPalace(row, col, color) {
  return col >= 3 && col <= 5 && (color === RED ? row >= 7 && row <= 9 : row >= 0 && row <= 2);
}

function findKing(board, color) {
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      if (board[row][col]?.type === 'king' && board[row][col].color === color) return { row, col };
    }
  }
  return null;
}

/** Pseudo-legal moves deliberately do not test the moving side's king. */
function pseudoMoves(board, row, col) {
  const piece = board[row]?.[col];
  if (!piece) return [];
  const moves = [];
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

/** Apply an already validated move; the source board and pieces are not mutated. */
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

export function getPieceLegalMoves(board, row, col) {
  if (!INSIDE(row, col) || !board[row][col]) return [];
  const color = board[row][col].color;
  return pseudoMoves(board, row, col).filter(move => !isInCheck(applyMove(board, move), color));
}

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

export function getGameStatus(board, turn) {
  const check = isInCheck(board, turn);
  if (!findKing(board, turn)) return { over: true, winner: opposite(turn), reason: 'king-captured', check };
  if (!findKing(board, opposite(turn))) return { over: true, winner: turn, reason: 'king-captured', check };
  if (getLegalMoves(board, turn).length === 0) {
    return { over: true, winner: opposite(turn), reason: check ? 'checkmate' : 'stalemate', check };
  }
  return { over: false, winner: null, reason: null, check };
}

export function moveToNotation(board, move) {
  const { from, to } = move;
  const piece = board[from.row]?.[from.col] ?? move.piece;
  if (!piece) return '';
  const red = piece.color === RED;
  const number = value => red ? CHINESE_NUMBERS[value] : String(value);
  const file = col => red ? 9 - col : col + 1;
  const peers = [];
  for (let row = 0; row < 10; row++) {
    if (board[row][from.col]?.type === piece.type && board[row][from.col]?.color === piece.color) peers.push(row);
  }
  let prefix = `${pieceLabel(piece)}${number(file(from.col))}`;
  if (peers.length > 1) {
    peers.sort((a, b) => red ? a - b : b - a);
    const index = peers.indexOf(from.row);
    const position = index === 0 ? '前' : index === peers.length - 1 ? '后' : peers.length === 3 ? '中' : number(index + 1);
    prefix = `${position}${pieceLabel(piece)}`;
  }
  if (from.row === to.row) return `${prefix}平${number(file(to.col))}`;
  const forward = red ? to.row < from.row : to.row > from.row;
  const destination = ['horse', 'elephant', 'advisor'].includes(piece.type) ? file(to.col) : Math.abs(to.row - from.row);
  return `${prefix}${forward ? '进' : '退'}${number(destination)}`;
}
