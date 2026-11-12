// Finds a short legal game from the start position after which red (the child) has one or two legal moves and is not mated.
import { createInitialBoard, getLegalMoves, applyMove, isInCheck } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/core/engine.js';

const code = (m) => `${m.from.row}${m.from.col}${m.to.row}${m.to.col}`;
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// the known line one move before black's mate, to look at first
const MATE_FOR_BLACK = ['9888', '2124', '8898', '2464', '9888', '2747', '8898'];
let board = createInitialBoard();
let turn = 'red';
const ref = (c) => ({ from: { row: +c[0], col: +c[1] }, to: { row: +c[2], col: +c[3] } });
for (const [i, c] of MATE_FOR_BLACK.entries()) {
  const n = getLegalMoves(board, turn).length;
  if (turn === 'red') console.log('ply', i, 'red legal', n, 'check', isInCheck(board, 'red'));
  board = applyMove(board, ref(c));
  turn = turn === 'red' ? 'black' : 'red';
}

let best = null;
const deadline = Date.now() + 20000;
for (let seed = 1; seed < 200000 && Date.now() < deadline; seed++) {
  const rnd = mulberry32(seed);
  let b = createInitialBoard();
  let t = 'red';
  const moves = [];
  for (let ply = 0; ply < 14; ply++) {
    const legal = getLegalMoves(b, t);
    if (legal.length === 0) break;
    if (t === 'red' && ply >= 2 && legal.length <= 2) {
      if (!best || moves.length < best.moves.length) { best = { moves: moves.slice(), legal: legal.map(code), check: isInCheck(b, 'red') }; console.log(JSON.stringify(best)); }
      break;
    }
    // black prefers checks and captures to get there quickly
    let pick;
    if (t === 'black') {
      const checks = legal.filter((m) => isInCheck(applyMove(b, m), 'red'));
      pick = checks.length && rnd() < 0.9 ? checks[Math.floor(rnd() * checks.length)] : legal[Math.floor(rnd() * legal.length)];
    } else pick = legal[Math.floor(rnd() * legal.length)];
    moves.push(code(pick));
    b = applyMove(b, pick);
    t = t === 'red' ? 'black' : 'red';
  }
  if (best && best.moves.length <= 6) break;
}
console.log('best', JSON.stringify(best));
