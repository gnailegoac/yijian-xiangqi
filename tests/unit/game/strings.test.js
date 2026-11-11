// Strings (SPEC 4.23, 14.4): the director-originated Chinese of the game layer.
import test from 'node:test';
import assert from 'node:assert/strict';

import { STR } from '../../../src/game/strings.js';
import { HABIT_FIX, RANK_NAMES, ASK_LABEL, CAT_LABEL, NOTATION_RE } from '../../../src/core/codes.js';

/** Characters as a child counts them (code points). */
const len = text => [...text].length;

const BANNED = ['主帅', '阿策', '阿弈', '离线', '引擎', '程序'];

/** Notations in each form the game emits: red, black, front / back pieces, the five-character doubled pawn. */
const NOTATIONS = ['炮二平五', '马8进7', '车9平8', '前炮进三', '后马退4', '前兵七进一', '二卒5平6'];
/** The eight area words the coach's lexicon has for a chance. */
const AREAS = ['左翼', '中路', '右翼', '河口', '对方九宫', '己方九宫', '对方底线', '己方底线'];
/** One character per piece, both colours. */
const PIECE_CHARS = ['帅', '仕', '相', '马', '车', '炮', '兵', '将', '士', '象', '卒'];

/** Sample inputs for every function in STR, keyed by its path. Each entry is a list of argument lists. */
const SAMPLES = {
  chanceNudge: AREAS.map(a => [a]),
  toolBusy: NOTATIONS.map(n => [n]),
  saveTruncated: [[1], [37], [600], [2000]],
  goalRecall: Object.values(HABIT_FIX).map(fix => [fix]),
  goalNext: Object.values(HABIT_FIX).map(fix => [fix]),
  rankUp: RANK_NAMES.map(name => [name]),
  streakPopup: [[3], [4], [10], [300]],
  'announce.trial': NOTATIONS.map(n => [n]),
  'announce.mine': NOTATIONS.map(n => [n]),
  'announce.rival': NOTATIONS.flatMap(n => [[n, true], [n, false]]),
  intentLabel: PIECE_CHARS.map(c => [c]),
  dangerLabel: PIECE_CHARS.map(c => [c]),
};

/**
 * Every text STR can put in front of the child: the fixed strings, and each function called with each of its samples.
 * @returns {{path:string, text:string, args?:unknown[]}[]}
 */
function everyText() {
  const out = [];
  const walk = (value, path) => {
    if (typeof value === 'string') {
      out.push({ path, text: value });
    } else if (typeof value === 'function') {
      const samples = SAMPLES[path];
      assert.ok(samples && samples.length > 0, `STR.${path} is a function with no sample input in this test`);
      for (const args of samples) out.push({ path, text: value(...args), args });
    } else if (Array.isArray(value)) {
      assert.ok(value.length > 0, `STR.${path} is empty`);
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
    } else {
      assert.equal(typeof value, 'object', `STR.${path} is neither text, list, table nor function`);
      assert.notEqual(value, null, `STR.${path} is null`);
      for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key);
    }
  };
  walk(STR, '');
  return out;
}

/** The texts that are 诸葛亮's own lines (not chip labels in the child's voice, not screen-reader announcements). */
const strategistLines = () => everyText().filter(({ path }) => !/^(chips|announce|intentLabel|dangerLabel)\b/.test(path));

test('no string contains 主帅, 阿策, 阿弈, 离线, 引擎, 程序', () => {
  const texts = everyText();
  assert.ok(texts.length >= 120, `${texts.length} texts checked`);
  for (const { path, text } of texts) {
    for (const word of BANNED) assert.ok(!text.includes(word), `STR.${path} contains ${word}: 「${text}」`);
  }
  // D-40: nothing a child reads talks about being offline, in any wording; and no Latin letters (no "AI", no "LLM")
  for (const { path, text } of texts) {
    for (const word of ['断网', '联网', '掉线', '电脑', '人工智能']) assert.ok(!text.includes(word), `STR.${path} contains ${word}: 「${text}」`);
    assert.doesNotMatch(text, /[A-Za-z]/, `STR.${path} contains Latin letters: 「${text}」`);
  }
});

test('functions return short strings', () => {
  const functions = everyText().filter(t => t.args);
  assert.deepEqual([...new Set(functions.map(t => t.path))].sort(), Object.keys(SAMPLES).sort(), 'every function of STR is sampled, and nothing else');

  for (const { path, text, args } of functions) {
    assert.equal(typeof text, 'string', `STR.${path}`);
    assert.ok(len(text) > 0 && len(text) <= 40, `STR.${path}(${args}) has ${len(text)} characters: 「${text}」`);
    assert.doesNotMatch(text, /undefined|null|NaN|\[object|\$\{/, `STR.${path}(${args}): 「${text}」`);
    // what goes in comes out: the notation, the area word, the number, the goal ...
    const [first] = args;
    assert.ok(text.includes(String(first)), `STR.${path}(${args}) lost its argument: 「${text}」`);
  }

  // m10: a chip label built from facts is at most 8 characters
  for (const c of PIECE_CHARS) {
    assert.ok(len(STR.intentLabel(c)) <= 8, STR.intentLabel(c));
    assert.ok(len(STR.dangerLabel(c)) <= 8, STR.dangerLabel(c));
  }
  // the sample notations are real notations
  for (const n of NOTATIONS) assert.match(n, NOTATION_RE);
});

test('the keys of 4.23, each with text behind it', () => {
  // importFull is a key added to 4.23 (CONTRACT-NOTES 115); it sits next to importFailed. undoResign is the other one
  // (CONTRACT-NOTES 150): what is said when a resignation is taken back, next to undoDone
  assert.deepEqual(Object.keys(STR), [
    'firstTrial', 'seenIt', 'rightPiece', 'ownWay', 'repeatWarn', 'perpetual', 'sparedMate', 'takebackOffer', 'chanceNudge', 'idleOffer', 'avoided',
    'hintWait', 'hintUnavailable', 'toolBusy', 'refusedFree', 'undoDone', 'undoResign', 'undoNone', 'undoOpening', 'tapOver', 'noMoves', 'welcomeBack',
    'welcomeBackRival', 'migrated', 'migratedLocal', 'saveCorrupt', 'saveNewer', 'saveTruncated', 'storageOff', 'imported', 'importFailed', 'importFull',
    'goalRecall', 'goalKept', 'goalNext', 'rankUp', 'streakPopup', 'announce', 'chips', 'intentLabel', 'dangerLabel',
  ]);
  assert.deepEqual(Object.keys(STR.avoided), ['greedy', 'miss_threat']);
  assert.deepEqual(Object.keys(STR.announce), ['trial', 'retract', 'mine', 'rival', 'thinking']);
  assert.deepEqual(Object.keys(STR.chips), ['seenIt', 'goThisWay', 'takeback', 'write', 'tryIt']);
  assert.equal(STR.seenIt.length, 2);

  for (const { path, text } of everyText()) {
    assert.ok(text.trim().length > 0, `STR.${path} is blank`);
    assert.equal(text, text.trim(), `STR.${path} has stray spaces`);
    assert.doesNotMatch(text, /[!?,.;:()"']/, `STR.${path} uses half-width punctuation: 「${text}」`);
  }
  // spoken lines end like sentences; chip labels do not
  for (const { path, text } of strategistLines()) assert.match(text, /[。！？…]$/u, `STR.${path}: 「${text}」`);
  for (const label of Object.values(STR.chips)) assert.ok(len(label) <= 8, label);
});

// The literal texts below are 4.23 in the owner's wording (CONTRACT-NOTES 113 to 115).
test('the lines the contract quotes elsewhere are these, character for character', () => {
  // 14.4: `tapping the focused attacker after a guiding question answers 对，就是它！`
  assert.equal(STR.rightPiece, '对，就是它！');
  // D-33 and 4.25.6: the held chips 我看出来了 / 指给我看 / 就走这步, and the other action chips
  assert.equal(STR.chips.seenIt, '我看出来了');
  assert.equal(ASK_LABEL.show, '指给我看');
  assert.equal(STR.chips.goThisWay, '就走这步');
  assert.equal(STR.chips.takeback, '悔一步重想');
  assert.equal(STR.chips.tryIt, '试试这步');
  assert.equal(STR.chips.write, '✎ 我来问');
  // the first trial of the first game; repetition and perpetual check; the spared mate and the take-back offer
  assert.equal(STR.firstTrial, '亮替你看一眼。想好了，再点一下就落子。');
  assert.equal(STR.repeatWarn, '再回到这个局面，就要算和棋了。');
  assert.equal(STR.perpetual, '不能一直将军，得换一招。');
  assert.equal(STR.sparedMate, '好险！司马懿没看见那步杀棋。');
  assert.equal(STR.takebackOffer, '刚才那步被抓住了。要不要悔一步重想？');
  assert.equal(STR.ownWay, '好，听小主公的，亮不多问了。');      // CONTRACT-NOTES 152: 亮放心 was said one move before a mate
  assert.equal(STR.idleOffer, '要不要亮递个锦囊？');
  // the goal lines of the game-over card and of the next start
  assert.equal(STR.goalKept, '上盘说好的，做到了！');
  assert.equal(STR.goalNext(HABIT_FIX.greedy), '下一盘小目标——吃子之前，先看它有没有保镖。');
  assert.equal(STR.goalNext(HABIT_FIX.miss_threat), '下一盘小目标——对方走完，先问自己：他想干什么。');
  assert.equal(STR.goalRecall(HABIT_FIX.greedy), '上盘说好的小目标——吃子之前，先看它有没有保镖。');
  assert.equal(STR.goalRecall(HABIT_FIX.miss_threat), '上盘说好的小目标——对方走完，先问自己：他想干什么。');
  // built from facts
  assert.equal(STR.chanceNudge('中路'), '中路好像有破绽，小主公找找看？');
  assert.equal(STR.toolBusy('马二进三'), '亮在沙盘上摆一摆【马二进三】……');
  assert.equal(STR.saveTruncated(37), '棋谱后半段看不清了，亮帮你恢复到第 37 手。');
  assert.equal(STR.rankUp(RANK_NAMES[2]), '小主公的兵法到了「渐入佳境」！');
  assert.equal(STR.streakPopup(3), '3连好棋！');
  assert.equal(STR.intentLabel('炮'), '他的炮想干什么？');
  assert.equal(STR.dangerLabel('马'), '我的马危险吗？');
  // screen-reader announcements
  assert.equal(STR.announce.trial('炮二平五'), '试走 炮二平五，还没落子。');
  assert.equal(STR.announce.retract, '已取消试走。');
  assert.equal(STR.announce.mine('炮二平五'), '你走了 炮二平五。');
  assert.equal(STR.announce.rival('马8进7', true), '对方走了 马8进7，将军！');
  assert.equal(STR.announce.rival('马8进7', false), '对方走了 马8进7。');
  assert.equal(STR.announce.thinking, '对方正在思考。');
});

test('every other fixed line of 4.23, character for character', () => {
  const fixed = Object.fromEntries(everyText().filter(t => !t.args).map(t => [t.path, t.text]));
  const rest = {
    'seenIt[0]': '好眼力！再挑一步。',
    'seenIt[1]': '看出来就好，换一步。',
    'avoided.greedy': '这回没去吃有人保护的子，上次的坑躲过去了！',
    'avoided.miss_threat': '先防住了对方这一手，稳！',
    hintWait: '容亮再看一眼……',
    hintUnavailable: '亮一时没算清楚，小主公先凭感觉走一步试试。',
    refusedFree: '这件事亮帮不上忙。要是心里有事，记得找爸爸妈妈或老师说说。咱们接着看棋？',
    undoDone: '好，退回小主公上一步之前。再想想！',
    undoResign: '好，这盘接着下！',
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
    storageOff: '这个浏览器不让存档，关掉页面后棋局不会保留。',
    imported: '存档导入好了，接着下！',
    importFailed: '这个文件亮认不出来，存档没有变。',
    importFull: '存储空间满了，这份存档放不进来。',
  };
  for (const [path, text] of Object.entries(rest)) assert.equal(fixed[path], text, `STR.${path}`);

  // together with the test above, no fixed text of STR is left unchecked
  const above = ['rightPiece', 'chips.seenIt', 'chips.goThisWay', 'chips.takeback', 'chips.tryIt', 'chips.write', 'firstTrial', 'repeatWarn', 'perpetual',
                 'sparedMate', 'takebackOffer', 'ownWay', 'idleOffer', 'goalKept', 'announce.retract', 'announce.thinking'];
  assert.deepEqual(Object.keys(fixed).sort(), [...Object.keys(rest), ...above].sort());
});

test('a habit is never mentioned with 又 (D-41)', () => {
  const habitLines = everyText().filter(({ path }) => /^(avoided|goalRecall|goalKept|goalNext)\b/.test(path));
  // the two avoided lines, the kept line, and a recall and a next-goal line for every habit
  assert.equal(habitLines.length, 2 + 1 + 2 * Object.keys(HABIT_FIX).length);
  for (const { path, text } of habitLines) assert.ok(!text.includes('又'), `STR.${path} says 又: 「${text}」`);
});

test('one name per person: 诸葛亮 says 亮, the child is 小主公, the rival is 司马懿', () => {
  for (const { path, text } of everyText()) {
    // the child is never plain 主公 here and never 主帅; no older name of the cast survives
    assert.equal(text.split('主公').length, text.split('小主公').length, `STR.${path} says 主公 without 小: 「${text}」`);
    for (const word of ['诸葛亮', '孔明', '仲达', '司马老贼', '敌人', '敌军', '小朋友', '同学', '玩家', '用户']) {
      assert.ok(!text.includes(word), `STR.${path} contains ${word}: 「${text}」`);
    }
    // the rival by name is always the full 司马懿
    assert.equal(text.split('司马').length, text.split('司马懿').length, `STR.${path}: 「${text}」`);
  }
  // in his own lines the strategist is 亮, never 我 (咱们 for the two of them together)
  for (const { path, text } of strategistLines()) {
    assert.ok(!text.includes('我'), `STR.${path} has the strategist say 我: 「${text}」`);
  }
  const all = everyText().map(t => t.text).join('\n');
  assert.ok(all.includes('小主公'));
  assert.ok(all.includes('亮'));
  assert.ok(all.includes('司马懿'));
});

test('the wording rules of CONTRACT-NOTES 113 to 115', () => {
  const texts = everyText();
  /** A text without the argument that was put into it (a goal text or a notation is not STR's own wording). */
  const own = ({ text, args }) => (args ? text.replace(String(args[0]), '') : text);

  // 113: the rival is 司马懿 by name or 对方 in a neutral description, never 对面
  for (const { path, text } of texts) assert.ok(!text.includes('对面'), `STR.${path} says 对面: 「${text}」`);
  // ... and never 它: a piece is 它 (对，就是它！), he is 他
  assert.deepEqual([...new Set(texts.filter(t => own(t).includes('它')).map(t => t.path))], ['rightPiece']);
  for (const c of PIECE_CHARS) assert.equal(STR.intentLabel(c), `他的${c}想干什么？`);
  // the first turn chip asks the way the chip it replaces does
  assert.equal(ASK_LABEL.intent, '对方想干什么？');

  // 113: a goal line has at most one colon in a sentence, whichever goal text is put in
  assert.ok(Object.values(HABIT_FIX).some(fix => fix.includes('：')), 'a goal text with a colon of its own is among the samples');
  for (const fix of Object.values(HABIT_FIX)) {
    for (const line of [STR.goalRecall(fix), STR.goalNext(fix)]) {
      for (const sentence of line.split(/[。！？]/u)) assert.ok(sentence.split('：').length <= 2, `two colons in one sentence: 「${line}」`);
    }
  }
  assert.ok(!STR.goalRecall('').includes('：') && !STR.goalNext('').includes('：'));
  // ... and it stays one clean sentence: the goal follows one full-width dash (two U+2014) and ends with one full stop
  for (const fix of Object.values(HABIT_FIX)) {
    assert.doesNotMatch(fix, /[，。：；、！？—]$/u, `the goal text 「${fix}」 ends with a mark of its own`);
    for (const line of [STR.goalRecall(fix), STR.goalNext(fix)]) {
      assert.deepEqual(line.split('——').map(part => part.includes('—')), [false, false], line);
      assert.ok(line.endsWith(`——${fix}。`), line);
    }
  }
  // no text of STR runs two marks together (…… and —— are single marks written double)
  for (const { path, text } of texts) assert.doesNotMatch(text, /[，。：；、！？][，。：；、！？]/u, `STR.${path} doubles a mark: 「${text}」`);

  // 113: the take-back offer comes right after the rival's move, so it points back at the child's own move
  assert.ok(STR.takebackOffer.startsWith('刚才那步'));
  assert.ok(STR.takebackOffer.endsWith('要不要悔一步重想？'));
  // 113: the 保镖 picture is not used where nothing explains it
  assert.ok(!STR.avoided.greedy.includes('保镖'));

  // 113: the saved game is 存档; 棋谱 is the list of moves (here: the half-read one of a damaged save)
  assert.deepEqual([...new Set(texts.filter(t => t.text.includes('棋谱')).map(t => t.path))], ['saveTruncated']);
  for (const key of ['saveCorrupt', 'saveNewer', 'imported', 'importFailed', 'importFull']) assert.ok(STR[key].includes('存档'), `STR.${key}`);

  // 114: the streak counts earned best and brilliant moves, so it reads 好棋; 妙手 is the label of brilliant alone
  for (const n of [3, 4, 10]) assert.equal(STR.streakPopup(n), `${n}连好棋！`);
  assert.equal(CAT_LABEL.best, '好棋');
  assert.equal(CAT_LABEL.brilliant, '妙手');

  // 150: a resignation that is taken back pops no move, so the line says that the game goes on and not that a move went
  // back; it is a local line of one short sentence (the cap of a local template line is 20 characters, SPEC 8.3)
  assert.equal(STR.undoResign, '好，这盘接着下！');
  assert.ok(len(STR.undoResign) <= 20, STR.undoResign);
  assert.ok(!STR.undoResign.includes('退') && !STR.undoResign.includes('上一步'), 'no move went back');
  assert.ok(STR.undoDone.includes('退回'));

  // 115: a full store is not a bad file
  assert.equal(STR.importFull, '存储空间满了，这份存档放不进来。');
  assert.equal(STR.importFailed, '这个文件亮认不出来，存档没有变。');
});
