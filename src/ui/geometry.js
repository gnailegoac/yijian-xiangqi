// Board geometry (SPEC §10.1 "Board geometry"). Package X1.
//
// One cell pitch is c. The board frame is 9.2 c wide and 10.6 c high: 8 c x 9 c of grid, 0.6 c side margins,
// 0.8 c top and bottom margins (the file labels sit in those). The SVG layers use a fixed
// viewBox="0 0 920 1060" (100 units per cell).
//
// Board squares are {row, col} with row 0 = black's back rank and row 9 = red's back rank, col 0..8 left to
// right as red sees the board. View coordinates (vx, vy) count columns and rows as they appear on screen,
// from the top-left corner; they differ from the board's only when black is shown at the bottom.

/** @import { Color, MoveRef, PieceType, Square } from '../core/types.js' */

export const VIEW_W = 920, VIEW_H = 1060, PITCH = 100, X0 = 60, Y0 = 80;

/** Red's file numerals, indexed by file number - 1. */
const HAN_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/**
 * View row/col for an orientation. bottom = the colour shown at the bottom edge.
 * @param {Square} sq
 * @param {Color} bottom
 * @returns {{vx:number, vy:number}}
 */
export function toView(sq, bottom) {
  return bottom === 'red' ? { vx: sq.col, vy: sq.row } : { vx: 8 - sq.col, vy: 9 - sq.row };
}

/**
 * @param {number} vx
 * @param {number} vy
 * @param {Color} bottom
 * @returns {Square}
 */
export function fromView(vx, vy, bottom) {
  return bottom === 'red' ? { row: vy, col: vx } : { row: 9 - vy, col: 8 - vx };
}

/**
 * Centre of a square in viewBox units.
 * @param {Square} sq
 * @param {Color} bottom
 * @returns {{x:number, y:number}}
 */
export function viewPoint(sq, bottom) {
  const { vx, vy } = toView(sq, bottom);
  return { x: X0 + PITCH * vx, y: Y0 + PITCH * vy };
}

/**
 * Centre of a square in CSS px relative to the .bv element. c = cell pitch in px.
 * @param {Square} sq
 * @param {Color} bottom
 * @param {number} c
 * @returns {{x:number, y:number}}
 */
export function pxPoint(sq, bottom, c) {
  const { vx, vy } = toView(sq, bottom);
  return { x: (0.6 + vx) * c, y: (0.8 + vy) * c };
}

/**
 * The leg (blocking) square of a horse move, or null if the vector is not a horse move.
 * @param {Square} from
 * @param {Square} to
 * @returns {Square|null}
 */
export function horseLeg(from, to) {
  const dr = to.row - from.row, dc = to.col - from.col;
  if (Math.abs(dr) === 2 && Math.abs(dc) === 1) return { row: from.row + Math.sign(dr), col: from.col };
  if (Math.abs(dr) === 1 && Math.abs(dc) === 2) return { row: from.row, col: from.col + Math.sign(dc) };
  return null;
}

/**
 * True when `move` takes a pawn of `piece.color` across the river.
 * @param {MoveRef} move
 * @param {{type:PieceType, color:Color}} piece
 * @returns {boolean}
 */
export function crossesRiver(move, piece) {
  return piece.type === 'pawn'
    && (piece.color === 'red' ? move.from.row === 5 && move.to.row === 4 : move.from.row === 4 && move.to.row === 5);
}

/**
 * The nine file labels of each board edge, left to right on screen (SPEC §10.2.1 item 8; CONTRACT-NOTES item 80).
 * Each label is the file number of `fromView(vx, vy, bottom).col` in the numbering and numerals of the side whose
 * back rank is on that edge: red `9 - col` in 汉字 (一…九), black `col + 1` in digits (1…9).
 * @param {Color} bottom  the side shown at the bottom of the screen
 * @returns {{top: string[], bottom: string[]}}
 */
export function fileLabels(bottom) {
  /** @param {number} vy  the view row of the edge: 0 = top, 9 = bottom */
  const edge = (vy) => {
    const labels = [];
    for (let vx = 0; vx < 9; vx++) {
      const { row, col } = fromView(vx, vy, bottom);
      // Row 0 is black's back rank (digits, counted from black's right); row 9 is red's (汉字, counted from red's right).
      labels.push(row === 0 ? String(col + 1) : HAN_DIGITS[8 - col]);
    }
    return labels;
  };
  return { top: edge(0), bottom: edge(9) };
}
