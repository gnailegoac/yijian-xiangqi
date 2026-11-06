import { applyMove, getGameStatus, getLegalMoves, getPieceLegalMoves, isInCheck, opposite, pieceLabel } from './engine.js';

const VALUES = { king: 100000, rook: 900, cannon: 450, horse: 420, elephant: 210, advisor: 210, pawn: 95 };
const sameSquare = (a, b) => a.row === b.row && a.col === b.col;
const captures = (board, color) => getLegalMoves(board, color).filter(move => board[move.to.row][move.to.col]);
const highestValue = pieces => [...pieces].sort((a, b) => VALUES[b.type] - VALUES[a.type])[0];
const NUMBERS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function pieceName(board, piece) {
  const peers = board.flat().filter(candidate => candidate?.color === piece.color && candidate.type === piece.type);
  if (peers.length <= 1) return pieceLabel(piece);
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    if (board[row][col]?.id === piece.id) {
      const filePeers = [];
      for (let r = 0; r < 10; r++) if (board[r][col]?.color === piece.color && board[r][col]?.type === piece.type) filePeers.push(r);
      filePeers.sort((a, b) => piece.color === 'red' ? a - b : b - a);
      const index = filePeers.indexOf(row);
      const prefix = filePeers.length <= 1 ? '' : index === 0 ? '前' : index === filePeers.length - 1 ? '后' : filePeers.length === 3 ? '中' : NUMBERS[index + 1];
      return `${piece.color === 'red' ? NUMBERS[9 - col] : col + 1}路${prefix}${pieceLabel(piece)}`;
    }
  }
  return pieceLabel(piece);
}

// Merely being controlled is not necessarily a threat: a cannon trading for a
// protected opening horse, for example, should not be described as winning it.
function meaningfulThreat(board, move) {
  const victim = board[move.to.row][move.to.col];
  if (VALUES[victim.type] > VALUES[move.piece.type]) return true;
  const afterCapture = applyMove(board, move);
  return !getLegalMoves(afterCapture, victim.color).some(reply => sameSquare(reply.to, move.to));
}

/** Explain observable effects of a legal move, rather than guessing a player's intent. */
export function describeMove(board, requestedMove) {
  const from = requestedMove?.from, to = requestedMove?.to;
  if (!from || !to) throw new RangeError('A move needs an origin and destination.');
  const move = getPieceLegalMoves(board, from.row, from.col).find(candidate => sameSquare(candidate.to, to));
  if (!move) throw new RangeError('Only legal moves can be explained.');

  const piece = board[from.row][from.col], captured = board[to.row][to.col];
  const color = piece.color, enemy = opposite(color), label = pieceLabel(piece);
  const side = color === 'red' ? '红方' : '黑方', otherSide = color === 'red' ? '黑方' : '红方';
  const next = applyMove(board, move);
  const wasChecked = isInCheck(board, color);
  const outcome = getGameStatus(next, enemy);
  const enemyCaptures = captures(next, enemy);
  const recapture = enemyCaptures.find(candidate => sameSquare(candidate.to, to));
  const caution = recapture
    ? `${otherSide}下一步可以用${pieceName(next, recapture.piece)}${captured ? '吃回' : '吃掉'}${side}${pieceName(next, piece)}，需要留意交换。`
    : (() => {
      const threatened = highestValue(enemyCaptures.filter(candidate => meaningfulThreat(next, candidate)).map(candidate => candidate.captured).filter(target => target?.color === color && VALUES[target.type] >= VALUES.horse));
      return threatened ? `同时留意：${otherSide}下一步仍有直接吃到${side}${pieceName(next, threatened)}的走法。` : null;
    })();

  if (outcome.over && outcome.winner === color) {
    if (outcome.reason === 'checkmate') return { headline: `${side}将死${otherSide}`, reasons: [`这步将军后，${otherSide}已经没有任何合法的解将走法。`], caution: null };
    if (outcome.reason === 'stalemate') return { headline: `${otherSide}困毙，无棋可走`, reasons: [`${otherSide}虽然没有被将军，但已没有合法走法；象棋中困毙的一方判负。`], caution: null };
    return { headline: `${otherSide}将帅被吃，棋局结束`, reasons: [`${otherSide}将帅已被吃掉，本局结束。`], caution: null };
  }

  const tacticalReasons = [];
  let headline = '';
  if (wasChecked) {
    headline = `${side}应将，解除将帅威胁`;
    tacticalReasons.push(`行棋前${side}${color === 'red' ? '帅' : '将'}正在被将军；这一步走完后已解除将军。`);
  }
  if (captured) {
    headline ||= `${side}吃掉${otherSide}${pieceName(board, captured)}`;
    tacticalReasons.push(`${wasChecked ? '同时' : '这一步直接'}吃掉了${otherSide}的${pieceName(board, captured)}；是否划算还要看后续交换。`);
  }
  if (outcome.check) {
    headline ||= `${side}将军，要求${otherSide}应将`;
    tacticalReasons.push(`${tacticalReasons.length ? '走后还形成了将军' : '这一步形成了将军'}，${otherSide}下一步必须先解除将帅受到的威胁。`);
  }
  if (tacticalReasons.length) return { headline, reasons: tacticalReasons.slice(0, 2), caution };

  const beforeEnemyCaptures = captures(board, enemy).filter(candidate => meaningfulThreat(board, candidate));
  const stillAttacked = new Set(enemyCaptures.map(candidate => candidate.captured?.id));
  const saved = highestValue(beforeEnemyCaptures.map(candidate => candidate.captured)
    .filter(target => target?.color === color && !stillAttacked.has(target.id)
      && next.flat().some(remaining => remaining?.id === target.id)));
  if (saved) {
    const moved = saved.id === piece.id;
    return {
      headline: moved ? `${side}撤开受攻击的${pieceName(board, piece)}` : `减少${side}${pieceName(board, saved)}受到的直接威胁`,
      reasons: [moved
        ? `原位置上的${side}${pieceName(board, piece)}正被${otherSide}攻击；走后，${otherSide}下一步已没有直接吃这枚${label}的合法着法。`
        : `走前${otherSide}可以直接吃到${side}${pieceName(board, saved)}；走后，这种直接吃子的合法着法已被消除。`],
      caution,
    };
  }

  const oldTargets = new Set(captures(board, color).map(candidate => candidate.captured?.id));
  const newTarget = highestValue(captures(next, color).map(candidate => candidate.captured)
    .filter(target => target?.type !== 'king' && !oldTargets.has(target.id)));
  if (newTarget) return {
    headline: `形成对${otherSide}${pieceName(next, newTarget)}的攻击`,
    reasons: [`这一步让${side}出现了直接攻击${otherSide}${pieceName(next, newTarget)}的走法；这只说明它受到攻击，不等于一定能白吃。`],
    caution,
  };

  const homeRow = color === 'red' ? 9 : 0;
  const forward = color === 'red' ? to.row < from.row : to.row > from.row;
  if ((piece.type === 'horse' || piece.type === 'rook') && from.row === homeRow && forward) {
    const beforeCount = getPieceLegalMoves(board, from.row, from.col).length;
    const afterCount = getPieceLegalMoves(next, to.row, to.col).length;
    if (afterCount > beforeCount) return {
      headline: `${side}调出${label}，增加活动空间`,
      reasons: [`把${side}底线的${label}调到前方；它目前可走的位置由${beforeCount}处增加到${afterCount}处，方便后续调动。`],
      caution,
    };
    if (piece.type === 'horse') {
      let rookMobilityGain = 0;
      for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
        if (board[row][col]?.type === 'rook' && board[row][col]?.color === color) {
          rookMobilityGain += Math.max(0, getPieceLegalMoves(next, row, col).length - getPieceLegalMoves(board, row, col).length);
        }
      }
      if (rookMobilityGain > 0) return {
        headline: `${side}出马，给车腾出通道`,
        reasons: [`把${side}底线的${pieceName(board, piece)}调到前方，原位置空出后，${side}车多了${rookMobilityGain}个可走落点。`],
        caution,
      };
    }
  }
  if (piece.type === 'pawn') {
    const crossedBefore = color === 'red' ? from.row <= 4 : from.row >= 5;
    const crossedAfter = color === 'red' ? to.row <= 4 : to.row >= 5;
    if (!crossedBefore && crossedAfter) return {
      headline: `${side}${label}过河，获得横走能力`,
      reasons: [`${side}这枚${label}刚刚过河，之后除了向前，也能向左或向右走一步，但仍不能后退。`],
      caution,
    };
    if (forward) return {
      headline: crossedBefore ? `${side}推进过河${label}` : `${side}进${label}，向河界靠近`,
      reasons: [crossedBefore ? `把${side}过河的${label}向前推进一格，离${otherSide}底线更近；它仍可在之后选择横走。` : `把${side}${label}向前推进一格，为后续过河做准备；现在还不能横走。`],
      caution,
    };
  }
  if (piece.type === 'cannon' && from.col !== 4 && to.col === 4) return {
    headline: `${side}调炮到中路`,
    reasons: [`把${side}炮移到中路，改变了中线上的炮架关系；当前还没有形成将军。`],
    caution,
  };

  return {
    headline: `${side}调整子力位置`,
    reasons: [`这一步调整了${side}${label}的位置，没有立即吃子或将军；后续作用仍要结合双方接下来的走法判断。`],
    caution,
  };
}
