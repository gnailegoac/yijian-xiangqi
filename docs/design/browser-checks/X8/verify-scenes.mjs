import { pathToFileURL } from 'node:url';
const E = await import(pathToFileURL('C:/Users/USERNAME/git/yijian-xiangqi/src/core/engine.js').href);
const { fenToBoard, createInitialBoard, getLegalMoves, getPieceLegalMoves, applyMove, moveToNotation, isInCheck, getGameStatus, checkers } = E;
const find = (board, color, fr, fc, tr, tc) => getLegalMoves(board, color).find(m => m.from.row === fr && m.from.col === fc && m.to.row === tr && m.to.col === tc);
function play(board, color, fr, fc, tr, tc) {
  const m = find(board, color, fr, fc, tr, tc);
  if (!m) throw new Error(`illegal ${color} ${fr}${fc}->${tr}${tc}`);
  const n = moveToNotation(board, m);
  const after = applyMove(board, m);
  const other = color === 'red' ? 'black' : 'red';
  const st = getGameStatus(after, other);
  console.log(color, n, m.captured ? `x${m.captured.type}` : '', 'check:', st.check, 'over:', st.over, st.reason ?? '', 'replies:', getLegalMoves(after, other).length);
  return after;
}
console.log('--- scene 1');
let b = createInitialBoard();
b = play(b, 'red', 7,7, 7,4);
b = play(b, 'black', 0,7, 2,6);
{ const t = play(b, 'red', 7,4, 3,4); play(t, 'black', 2,6, 3,4); }
b = play(b, 'red', 9,7, 7,6);
{ const t = play(b, 'black', 0,8, 0,7); }
b = play(b, 'black', 0,0, 1,0);
b = play(b, 'red', 7,1, 0,1);
console.log('black replies capturing (0,1):', getLegalMoves(b, 'black').filter(m => m.to.row === 0 && m.to.col === 1).map(m => moveToNotation(b, m)));
b = play(b, 'black', 1,0, 1,1);
console.log('--- scene 2');
let s2 = fenToBoard('2bakab2/9/7c1/1r4p1p/2N6/9/P3P3P/1C7/9/R1BAKAB2 w').board;
console.log('red in check', isInCheck(s2, 'red'), 'black in check', isInCheck(s2, 'black'));
s2 = play(s2, 'red', 4,2, 2,3);
console.log('black replies:', getLegalMoves(s2, 'black').map(m => moveToNotation(s2, m)));
s2 = play(s2, 'black', 0,4, 1,4);
s2 = play(s2, 'red', 2,3, 3,1);
s2 = play(s2, 'black', 2,7, 2,4);
console.log('checkers on red', checkers(s2, 'red'));
console.log('red replies:', getLegalMoves(s2, 'red').map(m => moveToNotation(s2, m)));
s2 = play(s2, 'red', 9,5, 8,4);
console.log('--- scene 3');
let s3 = fenToBoard('2bakab2/9/7n1/p1p3p1p/4C4/9/P1P3P1P/1C4N2/8r/2BAKAB2 w').board;
console.log('red in check', isInCheck(s3, 'red'), 'black in check', isInCheck(s3, 'black'));
s3 = play(s3, 'red', 7,1, 7,4);
console.log('--- scene 4');
let s4 = fenToBoard('2bakab2/9/7c1/p1p3p1p/9/4c4/P1P3P1P/2N6/9/R1BAKAB2 w').board;
console.log('red in check', isInCheck(s4, 'red'), 'black in check', isInCheck(s4, 'black'));
s4 = play(s4, 'red', 6,8, 5,8);
s4 = play(s4, 'black', 2,7, 2,4);
