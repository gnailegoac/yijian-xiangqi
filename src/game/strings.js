// Strings (SPEC 4.23): director-originated Chinese strings. UI-owned strings (buttons, banners, popups, sheets)
// are in src/ui/texts.js. Owner: G5.
//
// The wording is SPEC 4.23 as the owner corrected it (CONTRACT-NOTES 113 to 115): the rival is 司马懿 by name or 对方,
// never 对面 or 它; the saved game is 存档, and 棋谱 is only the list of moves.

export const STR = {
  // 诸葛亮's local system lines (never sent to the model)
  firstTrial: '亮替你看一眼。想好了，再点一下就落子。',
  seenIt: ['好眼力！再挑一步。', '看出来就好，换一步。'],
  rightPiece: '对，就是它！',
  ownWay: '好，听小主公的，亮不多问了。',
  repeatWarn: '再回到这个局面，就要算和棋了。',
  perpetual: '不能一直将军，得换一招。',
  sparedMate: '好险！司马懿没看见那步杀棋。',
  takebackOffer: '刚才那步被抓住了。要不要悔一步重想？',
  /** @param {string} areaWord */
  chanceNudge: (areaWord) => `${areaWord}好像有破绽，小主公找找看？`,
  idleOffer: '要不要亮递个锦囊？',
  avoided: { greedy: '这回没去吃有人保护的子，上次的坑躲过去了！', miss_threat: '先防住了对方这一手，稳！' },
  hintWait: '容亮再看一眼……',
  hintUnavailable: '亮一时没算清楚，小主公先凭感觉走一步试试。',
  /** @param {string} notation */
  toolBusy: (notation) => `亮在沙盘上摆一摆【${notation}】……`,
  refusedFree: '这件事亮帮不上忙。要是心里有事，记得找爸爸妈妈或老师说说。咱们接着看棋？',
  undoDone: '好，退回小主公上一步之前。再想想！',
  undoResign: '好，这盘接着下！',                           // a resignation was taken back: no move went back
  undoNone: '已经回到开局啦，没有可以悔的棋。',
  undoOpening: '司马懿刚走第一步，还轮不到悔棋呢。',
  tapOver: '这盘已经下完了——可以悔棋回看，或者再来一盘。',
  noMoves: '这枚棋子现在动不了。',
  welcomeBack: '小主公回来了！棋局还在，轮到你了。',
  welcomeBackRival: '小主公回来了！司马懿正要落子。',
  migrated: '小主公，上次的棋局亮替你留着呢，咱们接着下。',
  migratedLocal: '上次是两个人对弈的棋局，这回由司马懿陪你接着下。',
  saveCorrupt: '上一盘的存档亮没能认出来，已经替你另存了一份，咱们重开一局！',
  saveNewer: '这份存档来自更新的版本，亮先替你收好，咱们另开一局。',
  /** @param {number} n */
  saveTruncated: (n) => `棋谱后半段看不清了，亮帮你恢复到第 ${n} 手。`,
  storageOff: '这个浏览器不让存档，关掉页面后棋局不会保留。',
  imported: '存档导入好了，接着下！',
  importFailed: '这个文件亮认不出来，存档没有变。',
  importFull: '存储空间满了，这份存档放不进来。',
  // The goal text (HABIT_FIX) may carry a colon of its own, so the two goal lines introduce it with a dash.
  /** @param {string} fix */
  goalRecall: (fix) => `上盘说好的小目标——${fix}。`,
  goalKept: '上盘说好的，做到了！',
  /** @param {string} fix */
  goalNext: (fix) => `下一盘小目标——${fix}。`,
  /** @param {string} name */
  rankUp: (name) => `小主公的兵法到了「${name}」！`,
  /** @param {number} n */
  streakPopup: (n) => `${n}连好棋！`,
  announce: {
    /** @param {string} n */
    trial: (n) => `试走 ${n}，还没落子。`,
    retract: '已取消试走。',
    /** @param {string} n */
    mine: (n) => `你走了 ${n}。`,
    /** @param {string} n  @param {boolean} check */
    rival: (n, check) => `对方走了 ${n}${check ? '，将军！' : '。'}`,
    thinking: '对方正在思考。',
  },
  chips: { seenIt: '我看出来了', goThisWay: '就走这步', takeback: '悔一步重想', write: '✎ 我来问', tryIt: '试试这步' },
  // m10: the first turn chip's label is built from facts (<= 8 characters); the ask code does not change.
  /** @param {string} pieceChar */
  intentLabel: (pieceChar) => `他的${pieceChar}想干什么？`,
  /** @param {string} pieceChar */
  dangerLabel: (pieceChar) => `我的${pieceChar}危险吗？`,
};
