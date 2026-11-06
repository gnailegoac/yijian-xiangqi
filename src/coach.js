import { applyMove, getGameStatus, getLegalMoves, getPieceLegalMoves, isInCheck, moveToNotation, opposite, pieceLabel } from './engine.js';

const VALUES = { king: 100000, rook: 900, cannon: 450, horse: 420, elephant: 210, advisor: 210, pawn: 95 };
const NUMBERS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const sameSquare = (a, b) => a?.row === b?.row && a?.col === b?.col;
const sameMove = (a, b) => sameSquare(a?.from, b?.from) && sameSquare(a?.to, b?.to);
const sideName = color => color === 'red' ? '红方' : '黑方';
const captures = (board, color) => getLegalMoves(board, color).filter(move => board[move.to.row][move.to.col]);
const quotedMove = (board, move) => `“${moveToNotation(board, move)}”`;
function locate(board, id) {
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) if (board[row][col]?.id === id) return { row, col };
  return null;
}
function pieceName(board, piece) {
  const peers = board.flat().filter(candidate => candidate?.color === piece.color && candidate.type === piece.type);
  if (peers.length <= 1) return pieceLabel(piece);
  const point = locate(board, piece.id);
  if (!point) return pieceLabel(piece);
  const filePeers = [];
  for (let row = 0; row < 10; row++) if (board[row][point.col]?.color === piece.color && board[row][point.col]?.type === piece.type) filePeers.push(row);
  filePeers.sort((a, b) => piece.color === 'red' ? a - b : b - a);
  const index = filePeers.indexOf(point.row);
  const prefix = filePeers.length <= 1 ? '' : index === 0 ? '前' : index === filePeers.length - 1 ? '后' : filePeers.length === 3 ? '中' : NUMBERS[index + 1];
  return `${piece.color === 'red' ? NUMBERS[9 - point.col] : point.col + 1}路${prefix}${pieceLabel(piece)}`;
}
const namedPiece = (board, piece) => sideName(piece.color) + pieceName(board, piece);
function validatedMove(board, requestedMove) {
  const { from, to } = requestedMove || {};
  if (!from || !to) throw new RangeError('A move needs an origin and destination.');
  const move = getPieceLegalMoves(board, from.row, from.col).find(candidate => sameSquare(candidate.to, to));
  if (!move) throw new RangeError('Only legal moves can be explained.');
  return move;
}
function recaptures(board, capture) {
  const next = applyMove(board, capture);
  return getLegalMoves(next, opposite(capture.piece.color)).filter(reply => sameSquare(reply.to, capture.to));
}
// A cannon offered for a defended horse is not the same threat as a hanging rook.
function meaningfulThreat(board, move) {
  const victim = board[move.to.row][move.to.col];
  return VALUES[victim.type] > VALUES[move.piece.type] || recaptures(board, move).length === 0;
}
function between(board, from, to) {
  if (from.row !== to.row && from.col !== to.col) return null;
  const dr = Math.sign(to.row - from.row), dc = Math.sign(to.col - from.col), result = [];
  if (!dr && !dc) return result;
  for (let row = from.row + dr, col = from.col + dc; row !== to.row || col !== to.col; row += dr, col += dc) if (board[row][col]) result.push(board[row][col]);
  return result;
}
function openedByVacatedSquare(helper, candidate, vacated) {
  const from = candidate.from, to = candidate.to;
  if (helper.type === 'horse') {
    const dr = to.row - from.row, dc = to.col - from.col;
    return sameSquare(vacated, { row: from.row + (Math.abs(dr) === 2 ? Math.sign(dr) : 0), col: from.col + (Math.abs(dc) === 2 ? Math.sign(dc) : 0) });
  }
  if (from.row === to.row && vacated.row === from.row) return vacated.col >= Math.min(from.col, to.col) && vacated.col <= Math.max(from.col, to.col) && vacated.col !== from.col;
  if (from.col === to.col && vacated.col === from.col) return vacated.row >= Math.min(from.row, to.row) && vacated.row <= Math.max(from.row, to.row) && vacated.row !== from.row;
  return false;
}
function answerAfterRecapture(afterFirst, reply) {
  const board = applyMove(afterFirst, reply);
  const move = getLegalMoves(board, opposite(reply.piece.color))
    .filter(candidate => candidate.captured && sameSquare(candidate.to, reply.to))
    .sort((a, b) => VALUES[a.piece.type] - VALUES[b.piece.type])[0];
  return move ? { board, move } : null;
}
function recaptureCaution(afterFirst, firstMove, reply, captured) {
  const follow = answerAfterRecapture(afterFirst, reply);
  const first = `${sideName(reply.piece.color)}可接${quotedMove(afterFirst, reply)}，用${pieceName(afterFirst, reply.piece)}${captured ? '吃回' : '吃掉'}${namedPiece(afterFirst, firstMove.piece)}。`;
  return follow ? `${first}但${sideName(firstMove.piece.color)}还能接${quotedMove(follow.board, follow.move)}，再吃${namedPiece(follow.board, reply.piece)}；回吃并非这条交换的终点。` : first;
}
function exchangeSentence(board, move, reply) {
  const after = applyMove(board, move), gain = board[move.to.row][move.to.col];
  const follow = answerAfterRecapture(after, reply);
  if (follow) return `${sideName(reply.piece.color)}若接${quotedMove(after, reply)}吃回${namedPiece(after, move.piece)}，${sideName(move.piece.color)}还能接${quotedMove(follow.board, follow.move)}，再吃${namedPiece(follow.board, reply.piece)}；不能只把前两步看成${pieceLabel(move.piece)}换${pieceLabel(gain)}。`;
  return `${sideName(reply.piece.color)}可以接${quotedMove(after, reply)}吃回${namedPiece(after, move.piece)}；这两步是${sideName(move.piece.color)}用${pieceLabel(move.piece)}换${sideName(gain.color)}${pieceLabel(gain)}，不是白得一子。`;
}

/** Describe verified effects. Absence of a concrete benefit stays empty. */
export function describeMove(board, requestedMove) {
  const move = validatedMove(board, requestedMove), { piece, from, to } = move;
  const captured = board[to.row][to.col], color = piece.color, enemy = opposite(color);
  const side = sideName(color), otherSide = sideName(enemy), next = applyMove(board, move);
  const outcome = getGameStatus(next, enemy), wasChecked = isInCheck(board, color);
  const enemyCaptures = captures(next, enemy), recapture = enemyCaptures.find(candidate => sameSquare(candidate.to, to));
  const caution = recapture
    ? recaptureCaution(next, move, recapture, captured)
    : (() => {
      const attack = enemyCaptures.filter(candidate => meaningfulThreat(next, candidate)).sort((a, b) => VALUES[b.captured.type] - VALUES[a.captured.type])[0];
      return attack && VALUES[attack.captured.type] >= VALUES.horse ? `${otherSide}仍可接${quotedMove(next, attack)}，吃到${namedPiece(next, attack.captured)}。` : null;
    })();
  if (outcome.over && outcome.winner === color) {
    if (outcome.reason === 'checkmate') return { headline: `${side}将死${otherSide}`, reasons: [`${quotedMove(board, move)}将军后，${otherSide}的所有合法解将走法均被排除。`], caution: null };
    if (outcome.reason === 'stalemate') return { headline: `${otherSide}困毙，无棋可走`, reasons: [`${otherSide}虽然没有被将军，但已没有合法走法；象棋中困毙的一方判负。`], caution: null };
    return { headline: `${otherSide}将帅被吃，棋局结束`, reasons: [`${otherSide}将帅已被吃掉，本局结束。`], caution: null };
  }
  const reasons = [];
  let headline = '';
  if (wasChecked) {
    headline = `${side}应将，解除将帅威胁`;
    const checker = captures(board, enemy).find(attack => attack.captured?.type === 'king');
    reasons.push(checker ? `${namedPiece(board, checker.piece)}正在将军；${quotedMove(board, move)}后，这条对将帅的攻击被解除。` : `${quotedMove(board, move)}后，${side}将帅不再被将军。`);
  }
  if (captured) {
    headline ||= `${side}吃掉${otherSide}${pieceName(board, captured)}`;
    reasons.push(recapture ? exchangeSentence(board, move, recapture) : `${quotedMove(board, move)}直接吃掉${namedPiece(board, captured)}；在这一局面下，${otherSide}下一步没有合法走法能在落点吃回${side}${pieceLabel(piece)}。`);
  }
  if (outcome.check) {
    headline ||= `${side}将军，要求${otherSide}应将`;
    const replies = getLegalMoves(next, enemy), example = replies[0];
    reasons.push(`${otherSide}下一步必须先解除将军；当前有${replies.length}种合法应将${example ? `，例如${quotedMove(next, example)}` : ''}。`);
  }
  if (reasons.length) return { headline, reasons: reasons.slice(0, 2), caution };

  const oldThreats = captures(board, enemy).filter(attack => meaningfulThreat(board, attack));
  for (const oldAttack of oldThreats.sort((a, b) => VALUES[b.captured.type] - VALUES[a.captured.type])) {
    const target = oldAttack.captured;
    if (!locate(next, target.id)) continue;
    const nextAttack = enemyCaptures.find(attack => attack.captured?.id === target.id);
    if (!nextAttack) return {
      headline: target.id === piece.id ? `${side}撤开受攻击的${pieceName(board, piece)}` : `挡住对${namedPiece(board, target)}的直接攻击`,
      reasons: [`走前${otherSide}可用${quotedMove(board, oldAttack)}吃${namedPiece(board, target)}；${quotedMove(board, move)}后，这条直接吃子的走法已不存在。`], caution,
    };
    if (!meaningfulThreat(next, nextAttack)) {
      const afterAttack = applyMove(next, nextAttack), reply = recaptures(next, nextAttack)[0];
      if (reply) return { headline: `给${namedPiece(next, target)}补上保护`, reasons: [`${otherSide}若仍用${quotedMove(next, nextAttack)}吃${pieceLabel(target)}，${side}现在能接${quotedMove(afterAttack, reply)}，用${pieceName(afterAttack, reply.piece)}吃回；这步补上了原先缺少的回吃。`], caution };
    }
  }

  const beforeCaptures = captures(board, color), afterCaptures = captures(next, color);
  const oldTargets = new Set(beforeCaptures.map(attack => attack.captured?.id));
  const newAttacks = afterCaptures.filter(attack => attack.captured?.type !== 'king' && !oldTargets.has(attack.captured?.id));
  newAttacks.sort((a, b) => Number(meaningfulThreat(next, b)) - Number(meaningfulThreat(next, a)) || VALUES[b.captured.type] - VALUES[a.captured.type]);
  if (newAttacks.length) {
    const attack = newAttacks[0], victim = attack.captured;
    const screens = attack.piece.type === 'cannon' ? between(next, attack.from, attack.to) : null;
    const reply = recaptures(next, attack)[0], afterAttack = applyMove(next, attack);
    let reason = `${otherSide}若没有化解这个攻击，${side}接下来可走${quotedMove(next, attack)}，吃${namedPiece(next, victim)}`;
    if (screens?.length === 1) reason += `，炮架是${namedPiece(next, screens[0])}`;
    reason += '。';
    if (reply) reason += `但${otherSide}也能接${quotedMove(afterAttack, reply)}回吃，不能把这枚${pieceLabel(victim)}当作白得。`;
    return { headline: `形成对${namedPiece(next, victim)}的攻击`, reasons: [reason], caution };
  }
  const stillTargets = new Set(afterCaptures.map(attack => attack.captured?.id));
  const lostAttack = beforeCaptures.filter(attack => attack.captured?.type !== 'king' && meaningfulThreat(board, attack) && !stillTargets.has(attack.captured.id))
    .sort((a, b) => VALUES[b.captured.type] - VALUES[a.captured.type])[0];
  if (lostAttack) return { headline: `撤掉了对${namedPiece(board, lostAttack.captured)}的攻击`, reasons: [`走前${side}可以接${quotedMove(board, lostAttack)}，吃${namedPiece(board, lostAttack.captured)}；这次${pieceLabel(piece)}移开后，这条吃子线路不再成立。`], caution };

  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const horse = board[row][col];
    if (horse?.color !== enemy || horse.type !== 'horse' || next[row][col]?.id !== horse.id) continue;
    const afterMoves = getPieceLegalMoves(next, row, col);
    const lost = getPieceLegalMoves(board, row, col).find(candidate => {
      const dr = candidate.to.row - row, dc = candidate.to.col - col;
      const leg = { row: row + (Math.abs(dr) === 2 ? Math.sign(dr) : 0), col: col + (Math.abs(dc) === 2 ? Math.sign(dc) : 0) };
      return sameSquare(leg, to) && !afterMoves.some(after => sameSquare(after.to, candidate.to));
    });
    if (lost) return { headline: `卡住${namedPiece(board, horse)}的马腿`, reasons: [`${side}${pieceLabel(piece)}占住了这匹马的马腿位置，${otherSide}原本可走的${quotedMove(board, lost)}现在走不通。`], caution };
  }
  for (const type of ['rook', 'cannon', 'horse']) for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const helper = board[row][col];
    if (helper?.color !== color || helper.type !== type || helper.id === piece.id) continue;
    const beforeMoves = getPieceLegalMoves(board, row, col), afterMoves = getPieceLegalMoves(next, row, col);
    const opened = afterMoves.filter(candidate => !beforeMoves.some(old => sameSquare(old.to, candidate.to)) && !candidate.captured && openedByVacatedSquare(helper, candidate, from));
    if (!opened.length) continue;
    const first = opened.find(candidate => sameSquare(candidate.to, from)) || opened[0];
    const route = first.to.row === row ? '横向通道' : first.to.col === col ? '直线通道' : '被堵住的马腿';
    return {
      headline: piece.type === 'horse' && type === 'rook' ? `${side}出马，给车腾出通道` : `为${namedPiece(board, helper)}打开${route}`,
      reasons: [`${quotedMove(board, move)}腾开了${namedPiece(board, piece)}原先占的位置，${side}${pieceLabel(helper)}现在可以接${quotedMove(next, first)}${sameSquare(first.to, from) ? '走到这个空位' : `沿${route}出动`}；这个走法在走棋前被挡住。`], caution,
    };
  }
  if (piece.type === 'cannon') {
    const enemyTargets = next.flat().filter(target => target?.color === enemy && ['king', 'rook'].includes(target.type));
    for (const target of enemyTargets) {
      const targetSquare = locate(next, target.id), screens = between(next, to, targetSquare), previous = between(board, from, targetSquare);
      if (!screens || screens.length > 2 || (previous && screens.length === previous.length)) continue;
      const screenNames = screens.map(screen => namedPiece(next, screen)).join('、');
      const relationship = screens.length === 0 ? `中间没有炮架，现在不能直接用炮吃${pieceLabel(target)}；需要在这条线上建立一枚炮架。`
        : screens.length === 2 ? `中间隔着${screenNames}两枚棋子；须将中间棋子从两枚减成一枚，炮才有吃${pieceLabel(target)}的炮架条件。`
          : `炮架是${screenNames}，其后沿这条直线就是${namedPiece(next, target)}。`;
      return { headline: `把炮对准${namedPiece(next, target)}所在直线`, reasons: [`走后红黑这两枚棋子处于同一${to.col === targetSquare.col ? '路' : '横线'}；${relationship}`], caution };
    }
  }
  const enemyKing = next.flat().find(target => target?.color === enemy && target.type === 'king');
  if (enemyKing) {
    const kingSquare = locate(next, enemyKing.id), beforeEscapes = getPieceLegalMoves(board, kingSquare.row, kingSquare.col), afterEscapes = getPieceLegalMoves(next, kingSquare.row, kingSquare.col);
    const removed = beforeEscapes.find(candidate => !afterEscapes.some(after => sameSquare(after.to, candidate.to)));
    if (removed) return { headline: `限制${otherSide}将帅的退路`, reasons: [`${otherSide}原本可以走${quotedMove(board, removed)}；走后这个落点已不能合法进入，${otherSide}少了这一条将帅退路。`], caution };
  }
  if (piece.type === 'pawn') {
    const crossedBefore = color === 'red' ? from.row <= 4 : from.row >= 5, crossedAfter = color === 'red' ? to.row <= 4 : to.row >= 5;
    if (!crossedBefore && crossedAfter) return { headline: `${side}${pieceLabel(piece)}过河，获得横走能力`, reasons: [`${namedPiece(next, piece)}刚刚过河，下一步起可横走；它仍不能后退。`], caution };
  }
  return { headline: '暂未识别明确收益', reasons: [], caution };
}

function validateLine(board, move, pv) {
  if (!Array.isArray(pv) || !pv.length || !sameMove(pv[0], move)) return null;
  let position = board, color = move.piece.color;
  const steps = [], taken = [];
  for (const requested of pv.slice(0, 8)) {
    if (getGameStatus(position, color).over) return null;
    const candidate = getLegalMoves(position, color).find(legal => sameMove(legal, requested));
    if (!candidate) return null;
    const victim = position[candidate.to.row][candidate.to.col];
    steps.push({ notation: moveToNotation(position, candidate), color, from: { ...candidate.from }, to: { ...candidate.to }, move: candidate, board: position });
    if (victim) taken.push({ victim, captor: color });
    position = applyMove(position, candidate); color = opposite(color);
  }
  return { steps, taken, board: position };
}
function countPieces(pieces) {
  const counts = new Map();
  for (const piece of pieces) counts.set(pieceLabel(piece), (counts.get(pieceLabel(piece)) || 0) + 1);
  return [...counts].map(([name, count]) => `${NUMBERS[count] || count}枚${name}`).join('、');
}
function materialNet(line, color) {
  return line.taken.reduce((sum, { victim }) => sum + (victim.color === color ? -1 : 1) * VALUES[victim.type], 0);
}

/** Add legally replayed continuations and compare actual material consequences. */
export function explainAnalysis(board, requestedMove, analysis = {}) {
  const move = validatedMove(board, requestedMove), result = describeMove(board, move);
  const line = validateLine(board, move, analysis.pv);
  const continuation = line ? line.steps.map(({ notation, color, from, to }) => ({ notation, color, from, to })) : [];
  let comparison = null, lineSummary = null;
  if (!line) return { ...result, continuation, comparison, lineSummary };
  const color = move.piece.color, side = sideName(color), enemy = opposite(color), otherSide = sideName(enemy);
  const ownLosses = line.taken.filter(({ victim }) => victim.color === color).map(({ victim }) => victim);
  const enemyLosses = line.taken.filter(({ victim }) => victim.color === enemy).map(({ victim }) => victim);
  if (line.steps.length >= 2 && line.taken.length) {
    lineSummary = ownLosses.length && enemyLosses.length
      ? `按这条应对线走到此处，${side}拿到${otherSide}${countPieces(enemyLosses)}，同时交出${countPieces(ownLosses)}；这不是白得棋子。`
      : ownLosses.length ? `按这条应对线走到此处，${side}损失${countPieces(ownLosses)}，没有吃到${otherSide}棋子补偿。`
        : `按这条应对线走到此处，${side}吃到${otherSide}${countPieces(enemyLosses)}，尚未损失棋子。`;
    if (ownLosses.some(lost => lost.id === move.piece.id) && materialNet(line, color) < 0) result.caution = move.captured
      ? `这条变例中，${side}这枚${pieceLabel(move.piece)}会被吃回，交换对${side}不利；不能只看第一步吃到了什么。`
      : `这条变例中，${side}这枚${pieceLabel(move.piece)}会被吃掉，这段子力变化对${side}不利。`;
  }
  if (!result.reasons.length && line.steps.length >= 3) {
    const follow = line.steps.slice(2).find(step => step.color === color && step.move.piece.id === move.piece.id && (step.move.captured || isInCheck(applyMove(step.board, step.move), enemy)));
    if (follow) {
      result.headline = `先调${pieceLabel(move.piece)}，再形成具体威胁`;
      const reply = line.steps[1];
      result.reasons = [`这条变例是${side}先走“${line.steps[0].notation}”，${otherSide}用“${reply.notation}”应对后，同一枚${pieceLabel(move.piece)}再走“${follow.notation}”${follow.move.captured ? `吃${namedPiece(follow.board, follow.move.captured)}` : '形成将军'}。`];
    }
  }
  // partial may mean a deeper iteration timed out; depth>0 variations still belong to a completed equal-depth iteration.
  if (Number.isInteger(analysis.depth) && analysis.depth > 0 && Number.isFinite(analysis.score)) {
    const alternatives = Array.isArray(analysis.variations) ? analysis.variations : [];
    for (const alternative of alternatives) {
      if (!alternative.move || sameMove(alternative.move, move) || alternative.depth !== analysis.depth || alternative.partial || !Number.isFinite(alternative.score) || Math.abs(analysis.score - alternative.score) < 60) continue;
      let alternateMove;
      try { alternateMove = validatedMove(board, alternative.move); } catch { continue; }
      const alternateLine = validateLine(board, alternateMove, alternative.pv);
      if (!alternateLine || Math.abs(materialNet(line, color) - materialNet(alternateLine, color)) < VALUES.pawn) continue;
      const extraLosses = alternateLine.taken.filter(({ victim }) => victim.color === color && !ownLosses.some(own => own.id === victim.id));
      if (analysis.score > alternative.score && materialNet(line, color) > materialNet(alternateLine, color) && extraLosses.length) {
        comparison = `同样推演${analysis.depth}步，另一个候选${quotedMove(board, alternateMove)}的应对线会让${side}多损失${countPieces(extraLosses.map(({ victim }) => victim))}；当前推荐的这条应对线没有发生这笔损失。`;
        break;
      }
    }
  }
  return { ...result, continuation, comparison, lineSummary };
}
