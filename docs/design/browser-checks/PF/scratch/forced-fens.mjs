import { fenToBoard, getLegalMoves, isInCheck } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/core/engine.js';
import { assessMove, moveFacts } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/core/facts.js';
import { MATE } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/src/core/search.js';
const code = (m) => `${m.from.row}${m.from.col}${m.to.row}${m.to.col}`;
const ref = (c) => ({ from: { row: +c[0], col: +c[1] }, to: { row: +c[2], col: +c[3] } });
function rootLine(moveCode, score, extra = {}) {
  const depth = extra.depth ?? 3;
  return { move: ref(moveCode), score, depth, upper: null, mate: null, pv: [ref(moveCode)], byDepth: Array(depth).fill(score), naive: score, repeats: 1, ...extra };
}
function tableOf(fen, lines, extra = {}) {
  const depth = extra.depth ?? Math.max(...lines.map(l => l.depth));
  return { fen, turn: fenToBoard(fen).turn, depth, allDepth: depth, lines, nodes: 0, timeMs: 0, stopped: 'depth', ...extra };
}
const fens = {
  two: '3k5/9/5r3/3r5/9/4r4/9/2N6/9/4K4 w',
  three: '3k5/9/5r3/3r5/9/4r4/9/2N6/9/4KA3 w',
};
for (const [name, fen] of Object.entries(fens)) {
  const { board, turn } = fenToBoard(fen);
  const legal = getLegalMoves(board, turn).map(code);
  console.log(name, fen, 'check', isInCheck(board, turn), 'legal', legal.join(' '));
  const verdict = (moveCode, { score = 300, byDepth = [0, 0, score, score], second = score - 400, pv = [moveCode], table = true } = {}) => {
    const move = ref(moveCode);
    const rest = legal.find(c => c !== moveCode);
    const line = rootLine(moveCode, score, { depth: byDepth.length, byDepth, pv: pv.map(ref) });
    const all = tableOf(fen, [line, rootLine(rest, second, { depth: byDepth.length })]);
    const a = assessMove({ fen, move, pair: tableOf(fen, [line]), table: table ? all : null, level: 5, compare: move });
    return [a.cat, a.flags.onlyMove, a.revealBest, a.flags.sacrifice, a.flags.givesMate, a.patterns.map(p => p.id).join()];
  };
  console.log(' only  ', JSON.stringify(verdict('7284')));
  console.log(' sac   ', JSON.stringify(verdict('7284', { byDepth: [300, 300, 300, 300], pv: ['7284', '5484', '9484'], table: false })));
  console.log(' mate  ', JSON.stringify(verdict('7284', { score: MATE - 3, table: false })));
}
