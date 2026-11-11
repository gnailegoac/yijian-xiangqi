import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, createInitialBoard, getPieceLegalMoves, isInCheck } from '../src/engine.js';
import { describeMove, explainAnalysis } from '../src/coach.js';

let nextId = 0;
const piece = (type, color = 'red') => ({ id: `coach-${nextId++}`, type, color });
function emptyBoard() {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  board[9][4] = piece('king');
  board[0][4] = piece('king', 'black');
  board[5][4] = piece('pawn');
  return board;
}
function moveTo(board, row, col, toRow, toCol) {
  const move = getPieceLegalMoves(board, row, col).find(candidate => candidate.to.row === toRow && candidate.to.col === toCol);
  assert(move, `Fixture move ${row},${col} to ${toRow},${toCol} must be legal`);
  return move;
}
const explanationText = result => [result.headline, ...result.reasons, result.caution].filter(Boolean).join(' ');

test('opening horse development explains the exact rook route it opens', () => {
  const board = createInitialBoard();
  const explanation = describeMove(board, moveTo(board, 9, 1, 7, 2));
  assert.match(explanation.headline, /给车腾出通道/);
  assert.match(explanation.reasons[0], /马八进七.*车九平八/);
  assert.match(explanation.reasons[0], /走棋前被挡住/);
});

test('the mirrored opening horse also opens the rook route toward the left', () => {
  const board = createInitialBoard();
  const explanation = describeMove(board, moveTo(board, 9, 7, 7, 6));
  assert.match(explanation.headline, /给车腾出通道/);
  assert.match(explanation.reasons[0], /马二进三.*车一平二/);
});

test('unrelated variation exchanges stay outside the explanation of the selected move', () => {
  const board = createInitialBoard();
  const move = moveTo(board, 7, 1, 7, 2), after = applyMove(board, move);
  const reply = moveTo(after, 2, 7, 9, 7), afterReply = applyMove(after, reply);
  const recapture = moveTo(afterReply, 9, 8, 9, 7);
  const explanation = explainAnalysis(board, move, { pv: [move, reply, recapture], depth: 2, score: 30, partial: true });
  assert.match(explanation.reasons.join(''), /炮七进四.*炮架是红方七路兵/);
  assert.doesNotMatch(explanation.reasons.join(''), /拿到|交出|一枚马|一枚炮/);
  assert.match(explanation.lineSummary, /红方拿到黑方一枚炮.*交出一枚马/);
});

test('coach explains a capture and warns about a legal recapture', () => {
  const board = createInitialBoard();
  const explanation = describeMove(board, moveTo(board, 7, 1, 0, 1));
  assert.match(explanation.headline, /吃掉黑方.*马/);
  assert.match(explanation.caution, /车吃回红方.*炮/);
  assert.doesNotMatch(explanationText(explanation), /白赚|稳赚|必胜|绝对安全/);
});

test('the opening pawn capture explains the third-move rook recapture instead of stopping at pawn for pawn', () => {
  let board = createInitialBoard();
  board = applyMove(board, moveTo(board, 6, 0, 5, 0));
  board = applyMove(board, moveTo(board, 3, 0, 4, 0));
  const capture = moveTo(board, 5, 0, 4, 0);
  const result = describeMove(board, capture);
  assert.match(result.reasons[0], /车1进4.*车九进五.*再吃黑方1路车/);
  assert.match(result.caution, /车1进4.*车九进五.*再吃黑方1路车/);
  assert.doesNotMatch(explanationText(result), /这两步是.*兵换.*卒|稳赚|必胜|一定能赚/);
  const afterCapture = applyMove(board, capture), reply = moveTo(afterCapture, 0, 0, 4, 0);
  const afterReply = applyMove(afterCapture, reply), follow = moveTo(afterReply, 9, 0, 4, 0);
  assert.equal(follow.captured.id, reply.piece.id);
});

test('losing a piece after a quiet move is called being captured, not being recaptured', () => {
  const board = emptyBoard();
  board[5][1] = piece('rook');
  board[3][0] = piece('rook', 'black');
  const move = moveTo(board, 5, 1, 5, 0), after = applyMove(board, move);
  const reply = moveTo(after, 3, 0, 5, 0);
  const result = explainAnalysis(board, move, { pv: [move, reply], depth: 2, score: -900 });
  assert.match(result.caution, /会被吃掉/);
  assert.doesNotMatch(result.caution, /吃回|第一步吃到了/);
});

test('coach gives evading check priority over positional explanations', () => {
  const board = emptyBoard();
  board[5][4] = null;
  board[4][4] = piece('rook', 'black');
  board[7][0] = piece('rook');
  assert(isInCheck(board, 'red'));
  const explanation = describeMove(board, moveTo(board, 7, 0, 7, 4));
  assert.match(explanation.headline, /应将/);
  assert.match(explanation.reasons[0], /黑方车正在将军.*攻击被解除/);
});

test('coach identifies a check without promising a win', () => {
  const board = emptyBoard();
  board[4][0] = piece('rook');
  const explanation = describeMove(board, moveTo(board, 4, 0, 0, 0));
  assert.match(explanation.headline, /将军/);
  assert.match(explanation.reasons[0], /下一步必须先解除/);
  assert.doesNotMatch(explanationText(explanation), /必胜|将死/);
});

test('coach only announces checkmate when the rules engine verifies it', () => {
  const board = emptyBoard();
  board[1][3] = piece('rook');
  board[1][5] = piece('rook');
  board[2][0] = piece('rook');
  assert(!isInCheck(board, 'black'));
  const explanation = describeMove(board, moveTo(board, 2, 0, 2, 4));
  assert.match(explanation.headline, /将死/);
  assert.equal(explanation.caution, null);
});

test('coach explains a threatened piece retreat using legal reply analysis', () => {
  const board = emptyBoard();
  board[3][0] = piece('rook', 'black');
  board[5][0] = piece('rook');
  const explanation = describeMove(board, moveTo(board, 5, 0, 5, 1));
  assert.match(explanation.headline, /撤开受攻击的车/);
  assert.match(explanation.reasons[0], /车1进2.*车九平八.*直接吃子的走法已不存在/);
  assert.doesNotMatch(explanationText(explanation), /绝对安全/);
});

test('coach notices protection of another piece and warns if the blocker can be taken', () => {
  const board = emptyBoard();
  board[3][0] = piece('rook', 'black');
  board[7][0] = piece('horse');
  board[5][2] = piece('rook');
  const explanation = describeMove(board, moveTo(board, 5, 2, 5, 0));
  assert.match(explanation.headline, /挡住对红方马的直接攻击/);
  assert.match(explanation.caution, /吃掉红方车/);
});

test('coach describes new attacks without claiming a free capture', () => {
  const board = emptyBoard();
  board[6][2] = piece('horse');
  board[2][4] = piece('rook', 'black');
  const explanation = describeMove(board, moveTo(board, 6, 2, 4, 3));
  assert.match(explanation.headline, /黑方车的攻击/);
  assert.match(explanation.reasons[0], /若没有化解.*马六进五.*黑方车/);
});

test('red pawn crossing explanation identifies its new sideways ability', () => {
  const board = emptyBoard();
  board[5][0] = piece('pawn');
  const explanation = describeMove(board, moveTo(board, 5, 0, 4, 0));
  assert.match(explanation.headline, /兵过河/);
  assert.match(explanation.reasons[0], /不能后退/);
});

test('black pawn explanations use the black side direction and piece label', () => {
  const board = emptyBoard();
  board[4][0] = piece('pawn', 'black');
  const explanation = describeMove(board, moveTo(board, 4, 0, 5, 0));
  assert.match(explanation.headline, /卒过河/);
});

test('a move without identified benefits gets no filler explanation', () => {
  const board = createInitialBoard();
  const explanation = describeMove(board, moveTo(board, 9, 3, 8, 4));
  assert.equal(explanation.headline, '暂未识别明确收益');
  assert.deepEqual(explanation.reasons, []);
  assert.doesNotMatch(explanationText(explanation), /优势|必胜|安全|保护/);
});

test('a quiet cannon move explains the exact horizontal rook route it vacates', () => {
  const board = emptyBoard();
  board[7][0] = piece('rook');
  board[7][1] = piece('cannon');
  const result = describeMove(board, moveTo(board, 7, 1, 6, 1));
  assert.match(result.headline, /红方车.*横向通道/);
  assert.match(result.reasons[0], /炮八进一.*原先占的位置.*车九平八/);
});

test('cannon alignment names the actual screen and the legal threat', () => {
  const board = emptyBoard();
  board[7][1] = piece('cannon');
  board[5][0] = piece('pawn');
  board[2][0] = piece('rook', 'black');
  const result = describeMove(board, moveTo(board, 7, 1, 7, 0));
  assert.match(result.headline, /黑方车/);
  assert.match(result.reasons[0], /炮九进五/);
  assert.match(result.reasons[0], /炮架是红方.*兵/);
});

test('new legal rook moves from releasing a pin are not falsely described as vacating its route', () => {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  board[9][4] = piece('king');
  board[0][3] = piece('king', 'black');
  board[0][4] = piece('rook', 'black');
  board[5][4] = piece('rook');
  board[7][1] = piece('cannon');
  const cannon = moveTo(board, 7, 1, 7, 4);
  const after = applyMove(board, cannon);
  assert(!getPieceLegalMoves(board, 5, 4).some(move => move.to.row === 5 && move.to.col === 5));
  assert(getPieceLegalMoves(after, 5, 4).some(move => move.to.row === 5 && move.to.col === 5));
  const result = describeMove(board, cannon);
  assert.doesNotMatch(explanationText(result), /原先占的位置|走棋前被挡住|炮架车。/);
});

test('a quiet cannon retreat can withdraw a real attack rather than earn praise', () => {
  const board = emptyBoard();
  board[7][1] = piece('cannon');
  board[4][1] = piece('pawn', 'black');
  board[2][1] = piece('rook', 'black');
  const result = describeMove(board, moveTo(board, 7, 1, 7, 2));
  assert.match(result.headline, /撤掉了对黑方车的攻击/);
  assert.match(result.reasons[0], /炮八进五.*吃子线路不再成立/);
});

test('a protected horse exchange is explained as cannon for horse using the whole legal line', () => {
  const board = createInitialBoard();
  const capture = moveTo(board, 7, 1, 0, 1);
  const after = applyMove(board, capture);
  const reply = moveTo(after, 0, 0, 0, 1);
  const result = explainAnalysis(board, capture, { pv: [capture, reply], depth: 2, score: -30, partial: false });
  assert.equal(result.continuation.length, 2);
  assert.deepEqual(result.continuation.map(step => step.color), ['red', 'black']);
  assert.deepEqual(result.continuation[1].from, { row: 0, col: 0 });
  assert.match(result.lineSummary, /红方拿到黑方一枚马.*交出一枚炮/);
  assert.match(result.reasons[0], /用炮换黑方马/);
  assert.match(result.caution, /交换对红方不利/);
  assert.doesNotMatch(explanationText(result), /后续作用仍要|是否划算还要|调整子力位置/);
});

test('an illegal continuation is rejected as a whole instead of narrated as evidence', () => {
  const board = createInitialBoard(), move = moveTo(board, 6, 0, 5, 0);
  const result = explainAnalysis(board, move, { pv: [move, { from: { row: 0, col: 0 }, to: { row: 8, col: 8 } }], depth: 2 });
  assert.deepEqual(result.continuation, []);
  assert.equal(result.comparison, null);
  assert.doesNotMatch(explanationText(result), /按这条应对线|拿到|交出/);
});

test('a variation starting with another move is not attached to the requested explanation', () => {
  const board = createInitialBoard();
  const move = moveTo(board, 6, 0, 5, 0), other = moveTo(board, 6, 2, 5, 2);
  assert.deepEqual(explainAnalysis(board, move, { pv: [other], depth: 1 }).continuation, []);
});

test('same-depth alternatives compare the actual rook loss, including a completed iteration before timeout', () => {
  const board = emptyBoard();
  board[5][0] = piece('rook');
  board[3][0] = piece('rook', 'black');
  const safe = moveTo(board, 5, 0, 5, 1), afterSafe = applyMove(board, safe);
  const safeReply = moveTo(afterSafe, 3, 0, 3, 1);
  const other = moveTo(board, 5, 4, 4, 4), afterOther = applyMove(board, other);
  const captureReply = moveTo(afterOther, 3, 0, 5, 0);
  const analysis = { pv: [safe, safeReply], depth: 2, score: 0, partial: true, variations: [{ move: other, score: -900, depth: 2, pv: [other, captureReply] }] };
  const result = explainAnalysis(board, safe, analysis);
  assert.match(result.comparison, /另一个候选.*红方多损失一枚车/);
  assert.doesNotMatch(result.comparison, /评分|必胜|一定/);
  assert.equal(explainAnalysis(board, safe, { ...analysis, depth: 0 }).comparison, null);
  assert.equal(explainAnalysis(board, safe, { ...analysis, variations: [{ ...analysis.variations[0], depth: 1 }] }).comparison, null);
});

test('equivalent material variations do not receive a fabricated score-based explanation', () => {
  const board = createInitialBoard();
  const move = moveTo(board, 6, 0, 5, 0), other = moveTo(board, 6, 2, 5, 2);
  const result = explainAnalysis(board, move, { pv: [move], depth: 1, score: 100, variations: [{ move: other, score: 0, depth: 1, pv: [other] }] });
  assert.equal(result.comparison, null);
});

test('describing a move preserves the historical board and caps reasons', () => {
  const board = createInitialBoard();
  const snapshot = JSON.stringify(board);
  for (const row of board) { for (const occupant of row) if (occupant) Object.freeze(occupant); Object.freeze(row); }
  Object.freeze(board);
  const explanation = describeMove(board, moveTo(board, 9, 1, 7, 2));
  assert.equal(JSON.stringify(board), snapshot);
  assert(explanation.reasons.length >= 1 && explanation.reasons.length <= 2);
});

test('invalid moves are rejected instead of receiving a plausible explanation', () => {
  const board = createInitialBoard();
  assert.throws(() => describeMove(board, { from: { row: 6, col: 0 }, to: { row: 6, col: 1 } }), RangeError);
});

test('explanations name red and black explicitly so opponent commentary cannot reverse the player perspective', () => {
  const board = createInitialBoard();
  const explanation = describeMove(board, moveTo(board, 3, 0, 4, 0));
  assert.match(explanationText(explanation), /黑方/);
  assert.doesNotMatch(explanationText(explanation), /己方|对方/);
});
