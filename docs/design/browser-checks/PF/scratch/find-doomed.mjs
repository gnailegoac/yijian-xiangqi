// Finds a legal game after which red (the child) is to move and every red move allows a mate in one (red not yet in mate).
import { createInitialBoard, getLegalMoves, applyMove, isInCheck } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/core/engine.js';
import { createSearcher } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/core/search.js';
import { boardToFen } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/core/engine.js';

const code = (m) => `${m.from.row}${m.from.col}${m.to.row}${m.to.col}`;
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const matesInOne = (board, color) => getLegalMoves(board, color).some((m) => { const b = applyMove(board, m); const foe = color === 'red' ? 'black' : 'red'; return isInCheck(b, foe) && getLegalMoves(b, foe).length === 0; });

const searcher = createSearcher();
const deadline = Date.now() + 45000;
let found = null;
for (let seed = 1; seed < 400 && Date.now() < deadline && !found; seed++) {
  const rnd = mulberry32(seed);
  let b = createInitialBoard();
  let t = 'red';
  const moves = [];
  for (let ply = 0; ply < 70; ply++) {
    const legal = getLegalMoves(b, t);
    if (legal.length === 0) break;
    if (t === 'red' && ply >= 4 && !matesInOne(b, 'red') && legal.length >= 3) {
      const doomed = legal.every((m) => matesInOne(applyMove(b, m), 'black'));
      if (doomed) { found = { moves: moves.slice(), legal: legal.length, check: isInCheck(b, 'red'), fen: boardToFen(b, 'red') }; break; }
    }
    let pick;
    if (t === 'black') {
      const table = searcher.analyzeSync({ fen: boardToFen(b, t), timeMs: 40, maxDepth: 3 });
      // black plays well but never mates at once (the game must go on until red is doomed)
      const lines = table.lines.filter((l) => { const nb = applyMove(b, l.move); return !(isInCheck(nb, 'red') && getLegalMoves(nb, 'red').length === 0); });
      if (lines.length === 0) break;
      const m = lines[0].move;
      pick = legal.find((x) => code(x) === code(m));
    } else pick = legal[Math.floor(rnd() * legal.length)];
    moves.push(code(pick));
    b = applyMove(b, pick);
    t = t === 'red' ? 'black' : 'red';
  }
}
console.log(JSON.stringify(found));
