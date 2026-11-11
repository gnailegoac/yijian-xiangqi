import test from 'node:test';
import assert from 'node:assert/strict';
import {
  moveToNotation, describeMove, toLine, parseNotation, normalizeNotation, notationKey, moveCode, fromMoveCode, pieceRef,
} from '../../../src/core/notation.js';
import * as engine from '../../../src/core/engine.js';
import { START_FEN, createInitialBoard, getLegalMoves, applyMove, fenToBoard, boardToFen } from '../../../src/core/engine.js';
import { NOTATION_RE } from '../../../src/core/codes.js';
import { playoutPositions } from '../../helpers/playout.js';
import { TACTICAL_SUITE, PATTERN_EXAMPLES, V1_COACH_FIXTURES } from '../../helpers/positions.js';

let nextId = 0;
/** A board holding exactly the listed pieces: [type, color, row, col]. */
function boardWith(list) {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const [type, color, row, col] of list) board[row][col] = { id: `${color}-${type}-n${nextId++}`, type, color };
  return board;
}
/** MoveRef from a four-digit code "frfctrtc". */
const ref = code => ({ from: { row: Number(code[0]), col: Number(code[1]) }, to: { row: Number(code[2]), col: Number(code[3]) } });
const codeOf = move => `${move.from.row}${move.from.col}${move.to.row}${move.to.col}`;
const isLegal = (board, turn, code) => getLegalMoves(board, turn).some(m => codeOf(m) === code);

/**
 * Checks a table of { code: notation } on one position: each move is legal, has that canonical notation, the notation
 * matches NOTATION_RE and parses back to the same move.
 */
function expectNotations(board, turn, table) {
  for (const [code, notation] of Object.entries(table)) {
    assert.ok(isLegal(board, turn, code), `${code} is legal`);
    assert.equal(moveToNotation(board, ref(code)), notation, code);
    assert.match(notation, NOTATION_RE);
    const parsed = parseNotation(notation, board, turn);
    assert.equal(parsed.ok, true, `${notation} parses`);
    assert.equal(codeOf(parsed.move), code, `${notation} parses back to ${code}`);
    assert.equal(parsed.move.notation, notation);
  }
}
/** The move a text resolves to, as a code; fails the test when it does not parse. */
function parsedCode(text, board, turn) {
  const result = parseNotation(text, board, turn);
  assert.equal(result.ok, true, `${JSON.stringify(text)} parses`);
  return codeOf(result.move);
}

// Kings stand on different files in every constructed position, so they never face each other.
const RED_PAIRS = [
  ['king', 'red', 9, 4], ['king', 'black', 0, 3],
  ['rook', 'red', 5, 0], ['rook', 'red', 7, 0],
  ['cannon', 'red', 2, 7], ['cannon', 'red', 7, 7],
  ['horse', 'red', 4, 2], ['horse', 'red', 6, 2],
];
const BLACK_PAIRS = [
  ['king', 'black', 0, 4], ['king', 'red', 9, 3],
  ['rook', 'black', 2, 8], ['rook', 'black', 4, 8],
  ['cannon', 'black', 1, 1], ['cannon', 'black', 6, 1],
  ['horse', 'black', 3, 6], ['horse', 'black', 5, 6],
];
const RED_DOUBLED_PAWNS = [
  ['king', 'red', 9, 3], ['king', 'black', 0, 5],
  ['pawn', 'red', 3, 2], ['pawn', 'red', 4, 2], ['pawn', 'red', 3, 6], ['pawn', 'red', 4, 6], ['pawn', 'red', 6, 4],
];

test('the three v1 expectations: 马八进七, 炮八平五, 马2进3', () => {
  const board = createInitialBoard();
  assert.equal(moveToNotation(board, ref('9172')), '马八进七');
  assert.equal(moveToNotation(board, ref('7174')), '炮八平五');
  assert.equal(moveToNotation(board, ref('0122')), '马2进3');
  // notation.js re-exports the engine's function.
  assert.equal(moveToNotation, engine.moveToNotation);
  // Files are counted from the mover's right; red writes 一..九, black writes digits.
  assert.equal(moveToNotation(board, ref('7774')), '炮二平五');
  assert.equal(moveToNotation(board, ref('0726')), '马8进7');
  assert.equal(moveToNotation(board, ref('9080')), '车九进一');
  assert.equal(moveToNotation(board, ref('6454')), '兵五进一');
  assert.equal(moveToNotation(board, ref('3848')), '卒9进1');
  assert.equal(moveToNotation(board, ref('9484')), '帅五进一');
  assert.equal(moveToNotation(board, ref('0314')), '士4进5');
  assert.equal(moveToNotation(board, ref('9274')), '相七进五');
  // A full Move object from getLegalMoves is accepted as well.
  const move = getLegalMoves(board, 'red').find(m => codeOf(m) === '7774');
  assert.equal(moveToNotation(board, move), '炮二平五');
});

test('canonical: 前/后 for rooks, cannons, horses of both colours', () => {
  // Red: front = the smaller row.
  expectNotations(boardWith(RED_PAIRS), 'red', {
    5040: '前车进一', 5053: '前车平六', 7060: '后车进一', 7080: '后车退一', 7073: '后车平六',
    2717: '前炮进一', 2724: '前炮平五', 7767: '后炮进一', 7797: '后炮退二', 7774: '后炮平五',
    4223: '前马进六', 4254: '前马退五', 6281: '后马退八', 6241: '后马进八', 6243: '后马进六',
  });
  // Black: front = the larger row; numbers are digits.
  expectNotations(boardWith(BLACK_PAIRS), 'black', {
    4858: '前车进1', 4845: '前车平6', 2818: '后车退1', 2838: '后车进1', 2825: '后车平6',
    6171: '前炮进1', 6164: '前炮平5', 1131: '后炮进2', 1110: '后炮平1',
    5675: '前马进6', 5677: '前马进8', 5644: '前马退5', 3617: '后马退8', 3615: '后马退6',
  });
  // Two of a kind on different files keep the plain form.
  const apart = boardWith([['king', 'red', 9, 4], ['king', 'black', 0, 3], ['rook', 'red', 5, 0], ['rook', 'red', 7, 1],
    ['horse', 'black', 2, 2], ['horse', 'black', 2, 6]]);
  expectNotations(apart, 'red', { 5040: '车九进一', 7161: '车八进一' });
  expectNotations(apart, 'black', { 2243: '马3进4', 2645: '马7进6' });
  // The other side's piece of the same type on the file does not count.
  const mixed = boardWith([['king', 'red', 9, 4], ['king', 'black', 0, 3], ['rook', 'red', 7, 0], ['rook', 'black', 2, 0]]);
  expectNotations(mixed, 'red', { 7060: '车九进一' });
  expectNotations(mixed, 'black', { 2030: '车1进1' });
});

test('canonical: three pawns on a file are 前兵 / 中兵 / 后兵', () => {
  const red = boardWith([['king', 'red', 9, 3], ['king', 'black', 0, 5], ['pawn', 'red', 2, 4], ['pawn', 'red', 3, 4], ['pawn', 'red', 4, 4]]);
  expectNotations(red, 'red', {
    2414: '前兵进一', 2423: '前兵平六', 2425: '前兵平四', 3433: '中兵平六', 3435: '中兵平四', 4443: '后兵平六', 4445: '后兵平四',
  });
  const black = boardWith([['king', 'black', 0, 3], ['king', 'red', 9, 5], ['pawn', 'black', 5, 4], ['pawn', 'black', 6, 4], ['pawn', 'black', 7, 4]]);
  expectNotations(black, 'black', {
    7484: '前卒进1', 7473: '前卒平4', 6465: '中卒平6', 6463: '中卒平4', 5453: '后卒平4', 5455: '后卒平6',
  });
  // Two on a file: 前 / 后. One on a file: the plain form with the file number.
  const two = boardWith([['king', 'red', 9, 3], ['king', 'black', 0, 5], ['pawn', 'red', 3, 4], ['pawn', 'red', 4, 4], ['pawn', 'red', 4, 0]]);
  expectNotations(two, 'red', { 3424: '前兵进一', 3433: '前兵平六', 4443: '后兵平六', 4030: '兵九进一', 4041: '兵九平八' });
});

test('canonical: four or five pawns on a file are 前 二 三 (四) 后 for both colours', () => {
  const kings = [['king', 'red', 9, 3], ['king', 'black', 0, 5]];
  const five = boardWith([...kings, ...[0, 1, 2, 3, 4].map(row => ['pawn', 'red', row, 7])]);
  expectNotations(five, 'red', { '0708': '前兵平一', 1716: '二兵平三', 2728: '三兵平一', 3736: '四兵平三', 4746: '后兵平三' });
  const four = boardWith([...kings, ...[1, 2, 3, 4].map(row => ['pawn', 'red', row, 7])]);
  expectNotations(four, 'red', { 1707: '前兵进一', 2726: '二兵平三', 3738: '三兵平一', 4748: '后兵平一' });
  // Black writes the rank words 二 三 四 too; only files and steps are digits.
  const blackKings = [['king', 'black', 0, 3], ['king', 'red', 9, 5]];
  const blackFive = boardWith([...blackKings, ...[5, 6, 7, 8, 9].map(row => ['pawn', 'black', row, 1])]);
  expectNotations(blackFive, 'black', { 9190: '前卒平1', 8182: '二卒平3', 7170: '三卒平1', 6162: '四卒平3', 5150: '后卒平1' });
  const blackFour = boardWith([...blackKings, ...[5, 6, 7, 8].map(row => ['pawn', 'black', row, 1])]);
  expectNotations(blackFour, 'black', { 8191: '前卒进1', 7172: '二卒平3', 6160: '三卒平1', 5152: '后卒平3' });
});

test('canonical: pawns doubled on two files use the five-character form', () => {
  expectNotations(boardWith(RED_DOUBLED_PAWNS), 'red', {
    3222: '前兵七进一', 3231: '前兵七平八', 4243: '后兵七平六', 3626: '前兵三进一', 4647: '后兵三平二', 4645: '后兵三平四',
    6454: '兵五进一',                                  // a pawn alone on its file keeps the plain form
  });
  const black = boardWith([['king', 'black', 0, 3], ['king', 'red', 9, 5],
    ['pawn', 'black', 5, 1], ['pawn', 'black', 6, 1], ['pawn', 'black', 5, 7], ['pawn', 'black', 6, 7]]);
  expectNotations(black, 'black', { 6171: '前卒2进1', 5150: '后卒2平1', 6777: '前卒8进1', 6766: '前卒8平7', 5758: '后卒8平9' });
  // Three on one file and two on another: still crowded, the middle pawn is 中兵 + file.
  const threeTwo = boardWith([['king', 'red', 9, 3], ['king', 'black', 0, 5],
    ['pawn', 'red', 2, 2], ['pawn', 'red', 3, 2], ['pawn', 'red', 4, 2], ['pawn', 'red', 3, 6], ['pawn', 'red', 4, 6]]);
  expectNotations(threeTwo, 'red', { 2212: '前兵七进一', 3233: '中兵七平六', 4241: '后兵七平八', 3626: '前兵三进一', 4645: '后兵三平四' });
  // Only one file is doubled: the four-character form. The other side's doubled pawns do not count.
  const oneFile = boardWith([['king', 'red', 9, 3], ['king', 'black', 0, 5],
    ['pawn', 'red', 3, 2], ['pawn', 'red', 4, 2], ['pawn', 'red', 4, 6],
    ['pawn', 'black', 5, 1], ['pawn', 'black', 6, 1], ['pawn', 'black', 5, 7], ['pawn', 'black', 6, 7]]);
  expectNotations(oneFile, 'red', { 3222: '前兵进一', 4243: '后兵平六', 4636: '兵三进一' });
  expectNotations(oneFile, 'black', { 6171: '前卒2进1', 5758: '后卒8平9' });
});

test('canonical: two advisors or two elephants on one file use the plain form', () => {
  // Never 前/后: the direction already tells them apart.
  const red = boardWith([['king', 'red', 9, 4], ['king', 'black', 0, 3],
    ['advisor', 'red', 7, 3], ['advisor', 'red', 9, 3], ['elephant', 'red', 5, 2], ['elephant', 'red', 9, 2]]);
  expectNotations(red, 'red', {
    9384: '仕六进五', 7384: '仕六退五', 9270: '相七进九', 9274: '相七进五', 5270: '相七退九', 5274: '相七退五',
  });
  const black = boardWith([['king', 'black', 0, 4], ['king', 'red', 9, 3],
    ['advisor', 'black', 0, 5], ['advisor', 'black', 2, 5], ['elephant', 'black', 0, 2], ['elephant', 'black', 4, 2]]);
  expectNotations(black, 'black', {
    '0514': '士6进5', 2514: '士6退5', '0220': '象3进1', '0224': '象3进5', 4220: '象3退1', 4224: '象3退5',
  });
});

test('parser tolerance: full-width digits, other numeral script, traditional glyphs, other colour\'s glyph, brackets, trailing punctuation', () => {
  const start = createInitialBoard();
  const red = text => parsedCode(text, start, 'red');
  const black = text => parsedCode(text, start, 'black');
  assert.equal(red('炮二平五'), '7774');
  assert.equal(black('马8进7'), '0726');
  // Full-width digits.
  assert.equal(black('马８进７'), '0726');
  assert.equal(red('炮２平５'), '7774');
  // The other numeral script, for both sides.
  assert.equal(red('炮2平5'), '7774');
  assert.equal(red('马8进7'), '9172');
  assert.equal(black('马八进七'), '0726');
  assert.equal(black('炮二平五'), '2124');
  assert.equal(red('炮二平5'), '7774');
  // Traditional and variant glyphs: 車 俥 馬 傌 砲 包 帥 將 進 後.
  assert.equal(red('馬八進七'), '9172');
  assert.equal(red('傌八進七'), '9172');
  assert.equal(red('車九進一'), '9080');
  assert.equal(red('俥九進一'), '9080');
  assert.equal(red('砲二平五'), '7774');
  assert.equal(red('包二平五'), '7774');
  assert.equal(red('帥五進一'), '9484');
  assert.equal(black('將5進1'), '0414');
  assert.equal(black('馬８進７'), '0726');
  const pairs = boardWith(RED_PAIRS);
  assert.equal(parsedCode('後炮平五', pairs, 'red'), '7774');
  assert.equal(parsedCode('后炮平5', pairs, 'red'), '7774');
  assert.equal(parsedCode('前車進一', pairs, 'red'), '5040');
  // The other colour's glyph.
  assert.equal(red('象七进五'), '9274');
  assert.equal(red('士四进五'), '9584');
  assert.equal(red('卒三进一'), '6656');
  assert.equal(red('将五进一'), '9484');
  assert.equal(black('相3进5'), '0224');
  assert.equal(black('仕4进5'), '0314');
  assert.equal(black('兵3进1'), '3242');
  assert.equal(black('帅5进1'), '0414');
  // Brackets and quotes.
  for (const text of ['【炮二平五】', '「炮二平五」', '『炮二平五』', '（炮二平五）', '(炮二平五)', '[炮二平五]', '“炮二平五”', '‘炮二平五’', '"炮二平五"', '\'炮二平五\'']) {
    assert.equal(red(text), '7774', text);
  }
  // Trailing punctuation.
  for (const mark of ['。', '，', '！', '？', '!', '?', '.', ',', ';', '；', ':', '：', '！！。']) {
    assert.equal(red(`炮二平五${mark}`), '7774', mark);
  }
  // Whitespace anywhere, and everything at once.
  assert.equal(red(' 炮二 平五\n'), '7774');
  assert.equal(red('炮二平五　'), '7774');
  assert.equal(black(' 【馬８進７】。 '), '0726');
  assert.equal(black('【马8进7。】'), '0726');
  // The five-character form and the rank words, in either numeral script.
  const doubled = boardWith(RED_DOUBLED_PAWNS);
  assert.equal(parsedCode('前兵七进一', doubled, 'red'), '3222');
  assert.equal(parsedCode('前兵7进1', doubled, 'red'), '3222');
  assert.equal(parsedCode('后卒三平四', doubled, 'red'), '4645');
  const three = boardWith([['king', 'red', 9, 3], ['king', 'black', 0, 5], ['pawn', 'red', 2, 4], ['pawn', 'red', 3, 4], ['pawn', 'red', 4, 4]]);
  assert.equal(parsedCode('中兵平四', three, 'red'), '3435');
  assert.equal(parsedCode('二兵平四', three, 'red'), '3435');        // 二 = second from the front
  // A successful parse reports the move with its canonical notation.
  assert.deepEqual(parseNotation(' 【馬８進７】。 ', start, 'black'), {
    ok: true,
    move: { from: { row: 0, col: 7 }, to: { row: 2, col: 6 }, notation: '马8进7', piece: 'horse', color: 'black', captured: null },
  });
});

test('parser failures: syntax, no_such_move with candidates, ambiguous', () => {
  const start = createInitialBoard();
  // Text that fits no grammar.
  for (const text of ['', '   ', '炮二平', '炮十平五', '马8进0', '五兵进一', '炮二平五五', '平五', '炮二飞五', '炮〇平五', '中炮', '前前兵进一', 'C2=5', '好棋',
    '前兵七七进一', '走炮二平五', '炮二平五吧', '兵七进一兵三进一', '炮二，平五']) {
    assert.deepEqual(parseNotation(text, start, 'red'), { ok: false, reason: 'syntax', candidates: [] }, JSON.stringify(text));
  }
  // Not a string at all: no grammar fits (never an exception).
  for (const text of [null, undefined, 7774, {}]) {
    assert.deepEqual(parseNotation(text, start, 'red'), { ok: false, reason: 'syntax', candidates: [] });
  }

  // Well-formed, but no legal move fits: up to three legal moves of the same piece type, same act and arg first, then same file.
  const notations = result => result.candidates.map(m => m.notation);
  const blocked = parseNotation('车九平八', start, 'red');          // the horse stands on 八
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'no_such_move');
  assert.equal(blocked.candidates.length, 3);
  assert.deepEqual(notations(blocked).slice(0, 2).sort(), ['车九进一', '车九进二'].sort());      // same file 九
  assert.ok(['车一进一', '车一进二'].includes(notations(blocked)[2]));
  for (const candidate of blocked.candidates) {
    assert.equal(candidate.piece, 'rook');
    assert.equal(candidate.color, 'red');
    assert.ok(getLegalMoves(start, 'red').some(m => codeOf(m) === codeOf(candidate)));
  }
  const wrongFile = parseNotation('马二进七', start, 'red');        // 进七 is the other horse's move
  assert.equal(wrongFile.reason, 'no_such_move');
  assert.equal(notations(wrongFile)[0], '马八进七');                 // same act and arg first
  assert.deepEqual(notations(wrongFile).slice(1).sort(), ['马二进一', '马二进三'].sort());       // then same file 二
  const noRank = parseNotation('前车进一', start, 'red');           // the rooks do not share a file
  assert.equal(noRank.reason, 'no_such_move');
  assert.equal(noRank.candidates.length, 3);
  assert.deepEqual(notations(noRank).slice(0, 2).sort(), ['车一进一', '车九进一'].sort());
  // A move that exists on the board but is illegal: the rook between the two kings may not leave the file.
  const pinned = boardWith([['king', 'red', 9, 4], ['king', 'black', 0, 4], ['rook', 'red', 5, 4]]);
  const leaves = parseNotation('车五平六', pinned, 'red');
  assert.equal(leaves.reason, 'no_such_move');
  assert.equal(leaves.candidates.length, 3);
  for (const candidate of leaves.candidates) assert.equal(candidate.to.col, 4);
  // A rank word for a piece type that is alone on its file, and a piece type the side does not have.
  assert.equal(parseNotation('前兵进一', start, 'red').reason, 'no_such_move');
  assert.equal(parseNotation('中兵平四', start, 'red').reason, 'no_such_move');
  assert.deepEqual(parseNotation('车九进一', pinned, 'black'), { ok: false, reason: 'no_such_move', candidates: [] });
  // 中 is the second of exactly three: with two or four pawns on the file there is no 中兵.
  const twoPawns = boardWith([['king', 'red', 9, 3], ['king', 'black', 0, 5], ['pawn', 'red', 3, 4], ['pawn', 'red', 4, 4]]);
  assert.equal(parsedCode('后兵平六', twoPawns, 'red'), '4443');
  assert.equal(parseNotation('中兵平六', twoPawns, 'red').reason, 'no_such_move');
  const fourPawns = boardWith([['king', 'red', 9, 3], ['king', 'black', 0, 5], ...[1, 2, 3, 4].map(row => ['pawn', 'red', row, 7])]);
  assert.equal(parsedCode('二兵平三', fourPawns, 'red'), '2726');
  assert.equal(parseNotation('中兵平三', fourPawns, 'red').reason, 'no_such_move');
  assert.equal(parseNotation('四兵平三', twoPawns, 'red').reason, 'no_such_move');          // there is no fourth pawn

  // More than one legal move fits.
  const pairs = boardWith(RED_PAIRS);
  const twoRooks = parseNotation('车九进一', pairs, 'red');         // both rooks on file 九 can advance one
  assert.equal(twoRooks.ok, false);
  assert.equal(twoRooks.reason, 'ambiguous');
  assert.deepEqual(notations(twoRooks).sort(), ['前车进一', '后车进一'].sort());
  assert.deepEqual(twoRooks.candidates.map(codeOf).sort(), ['5040', '7060']);
  const doubled = boardWith(RED_DOUBLED_PAWNS);
  const twoFiles = parseNotation('前兵进一', doubled, 'red');       // a front pawn on file 七 and on file 三
  assert.equal(twoFiles.reason, 'ambiguous');
  assert.deepEqual(notations(twoFiles).sort(), ['前兵七进一', '前兵三进一'].sort());
});

test('round trip: every legal move of 2000 playout positions parses back to itself and matches NOTATION_RE', () => {
  // 1400 positions of games from the start position (half of them with forced pawn moves, so that pawns cross and pile up),
  // and 600 from short playouts that start in positions holding the rare forms.
  const rare = [
    '5k3/9/9/2P3P2/2P3P2/1p5p1/1p5p1/9/R8/3K4r w',                       // pawns doubled on two files, both colours
    '3k5/9/4P4/4P4/4P4/4p4/4p4/4p4/9/5K3 w',                             // three pawns on a file
    '4kab2/9/5a3/4p4/6b2/2B6/4P4/3A5/9/2BAK4 w',                         // two advisors / two elephants on one file
    '3k5/7P1/7P1/7P1/5P1P1/1p7/1p7/1p7/1p7/1p3K3 b',                     // four and five pawns on a file
    '3k5/r4c3/6n2/r4c3/6n2/2N6/R4C3/2N6/R4C3/4K4 w',                     // two rooks, cannons, horses on one file
    '3k5/9/9/2P3P2/2P3P2/1p5p1/1p5p1/9/9/R3K3r b',
  ];
  const positions = [
    ...playoutPositions(700, { seed: 101, stride: 3, plies: 150 }),
    ...playoutPositions(700, { seed: 9001, stride: 3, plies: 240, pawnBias: 0.35 }),
    ...rare.flatMap((fen, i) => playoutPositions(100, { ...fenToBoard(fen), seed: 500 + 50 * i, plies: 12 })),
  ];
  assert.equal(positions.length, 2000);
  const seen = { moves: 0, plain: 0, frontBack: 0, pawnRank: 0, middle: 0, numbered: 0, five: 0, black: 0 };
  for (const { board, turn, moves } of positions) {
    const inPosition = new Set();
    for (const move of moves) {
      const notation = moveToNotation(board, move);
      const where = `${notation} in ${boardToFen(board, turn)}`;
      assert.match(notation, NOTATION_RE, where);
      const result = parseNotation(notation, board, turn);
      assert.equal(result.ok, true, where);
      assert.deepEqual(result.move.from, move.from, where);
      assert.deepEqual(result.move.to, move.to, where);
      assert.equal(result.move.notation, notation, where);
      assert.equal(result.move.piece, move.piece.type, where);
      assert.equal(result.move.color, turn, where);
      assert.equal(result.move.captured, move.captured ? move.captured.type : null, where);
      inPosition.add(notation);
      // Which forms the sample covers.
      const chars = [...notation];
      seen.moves++;
      if (turn === 'black') seen.black++;
      if (chars.length === 5) seen.five++;
      if ('前后'.includes(chars[0]) && '车马炮'.includes(chars[1])) seen.frontBack++;
      else if ('前后'.includes(chars[0])) seen.pawnRank++;
      else if (chars[0] === '中') seen.middle++;
      else if ('二三四'.includes(chars[0])) seen.numbered++;
      else seen.plain++;
    }
    assert.equal(inPosition.size, moves.length, `two legal moves share a notation in ${boardToFen(board, turn)}`);
  }
  assert.ok(seen.moves > 50000, `${seen.moves} moves checked`);
  for (const [form, count] of Object.entries(seen)) assert.ok(count > 0, `the sample has no ${form} notation`);
});

test('moveCode / fromMoveCode round trip; fromMoveCode rejects malformed codes', () => {
  assert.equal(moveCode({ from: { row: 7, col: 7 }, to: { row: 7, col: 4 } }), '7774');       // 炮二平五 from the start
  assert.equal(moveCode({ from: { row: 0, col: 1 }, to: { row: 2, col: 2 } }), '0122');
  assert.deepEqual(fromMoveCode('7774'), { from: { row: 7, col: 7 }, to: { row: 7, col: 4 } });
  assert.deepEqual(fromMoveCode('0122'), { from: { row: 0, col: 1 }, to: { row: 2, col: 2 } });
  assert.deepEqual(fromMoveCode('9808'), { from: { row: 9, col: 8 }, to: { row: 0, col: 8 } });
  for (const { board, turn, moves } of playoutPositions(40, { seed: 31, stride: 7, plies: 140 })) {
    for (const move of moves) {
      const code = moveCode(move);                      // a full Move is accepted
      assert.match(code, /^[0-9][0-8][0-9][0-8]$/);
      assert.deepEqual(fromMoveCode(code), { from: move.from, to: move.to });
      assert.equal(moveCode(fromMoveCode(code)), code);
      assert.ok(isLegal(board, turn, code));
    }
  }
  assert.deepEqual(fromMoveCode('0989'), null);         // column 9 does not exist
  for (const bad of ['', '777', '77745', '7779', '7974', 'a774', '77-4', ' 7774', '7774 ', '７７７４', '77.4', '炮二平五']) {
    assert.equal(fromMoveCode(bad), null, JSON.stringify(bad));
  }
  for (const bad of [null, undefined, 7774, ['7', '7', '7', '4'], {}]) assert.equal(fromMoveCode(bad), null);
});

test('toLine sets end to mate / check / quiet and stops at the first illegal move', () => {
  const start = createInitialBoard();
  // Quiet: 1. 炮二平五 马8进7.
  const quiet = toLine(start, 'red', [ref('7774'), ref('0726')]);
  assert.deepEqual(quiet, {
    start: START_FEN,
    moves: [
      { from: { row: 7, col: 7 }, to: { row: 7, col: 4 }, notation: '炮二平五', piece: 'cannon', color: 'red', captured: null },
      { from: { row: 0, col: 7 }, to: { row: 2, col: 6 }, notation: '马8进7', piece: 'horse', color: 'black', captured: null },
    ],
    end: 'quiet',
  });
  assert.deepEqual(start, createInitialBoard());            // the board is not mutated
  // Each notation is relative to the position it is played in; a capture names the captured type.
  const trade = toLine(start, 'red', [ref('7707'), ref('0807')]);
  assert.deepEqual(trade.moves.map(m => [m.notation, m.captured]), [['炮二进七', 'horse'], ['车9平8', 'cannon']]);
  assert.equal(trade.end, 'quiet');

  // Check: 车九进四 (not mate).
  const checkFixture = V1_COACH_FIXTURES.find(f => f.name === 'rook-check');
  const checkPosition = fenToBoard(checkFixture.fen);
  const check = toLine(checkPosition.board, checkPosition.turn, [ref(checkFixture.move)]);
  assert.equal(check.start, checkFixture.fen);
  assert.deepEqual(check.moves.map(m => m.notation), ['车九进四']);
  assert.equal(check.end, 'check');
  // The end describes the last replayed move: after the king steps aside the line is quiet again.
  assert.equal(toLine(checkPosition.board, 'red', [ref('4000'), ref('0414')]).end, 'quiet');

  // Mate: 重炮, and the black 重炮.
  for (const name of ['重炮', '重炮 (black)', '马后炮', '铁门栓']) {
    const entry = TACTICAL_SUITE.find(p => p.name === name);
    assert.equal(entry.mateIn, 1);
    const position = fenToBoard(entry.fen);
    const line = toLine(position.board, position.turn, [ref(entry.move)]);
    assert.equal(line.start, entry.fen);
    assert.deepEqual(line.moves.map(m => m.notation), [entry.first]);
    assert.equal(line.end, 'mate', name);
  }
  // A last move that leaves the opponent without any legal move also ends the line as 'mate' (困毙: lost, though not in check).
  // 抽将: 马五进四 将5平6 车五进五.
  const drawn = TACTICAL_SUITE.find(p => p.name === '抽将');
  const drawnPosition = fenToBoard(drawn.fen);
  const smother = toLine(drawnPosition.board, drawnPosition.turn, [ref('4425'), ref('0405'), ref('6414')]);
  assert.deepEqual(smother.moves.map(m => m.notation), ['马五进四', '将5平6', '车五进五']);
  assert.equal(smother.moves[0].captured, 'rook');
  assert.equal(smother.end, 'mate');
  assert.equal(toLine(drawnPosition.board, drawnPosition.turn, [ref('4425')]).end, 'check');
  assert.equal(toLine(drawnPosition.board, drawnPosition.turn, [ref('4425'), ref('0405')]).end, 'quiet');

  // Stops at the first illegal move and keeps what came before it.
  const wrongSide = toLine(start, 'red', [ref('7774'), ref('6050'), ref('0726')]);      // 兵九进一 is not black's move
  assert.deepEqual(wrongSide.moves.map(m => m.notation), ['炮二平五']);
  assert.equal(wrongSide.end, 'quiet');
  const sideways = toLine(start, 'red', [ref('6061'), ref('7774')]);                    // an uncrossed pawn cannot move sideways
  assert.deepEqual(sideways, { start: START_FEN, moves: [], end: 'quiet' });
  const ignoresCheck = toLine(checkPosition.board, 'red', [ref('4000'), ref('0010')]);  // black must answer the check
  assert.deepEqual(ignoresCheck.moves.map(m => m.notation), ['车九进四']);
  assert.equal(ignoresCheck.end, 'check');
  const emptyOrigin = toLine(start, 'red', [ref('7774'), ref('4454')]);
  assert.equal(emptyOrigin.moves.length, 1);
  const offBoard = toLine(start, 'red', [{ from: { row: 9, col: 0 }, to: { row: 10, col: 0 } }]);
  assert.deepEqual(offBoard.moves, []);
  assert.deepEqual(toLine(start, 'black', []), { start: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b', moves: [], end: 'quiet' });
  // The end speaks about the last replayed move only: with no replayed move it is 'quiet', even from a position in check.
  const inCheck = V1_COACH_FIXTURES.find(f => f.name === 'block-check');
  const checked = fenToBoard(inCheck.fen);
  assert.equal(engine.isInCheck(checked.board, checked.turn), true);
  assert.deepEqual(toLine(checked.board, checked.turn, []), { start: inCheck.fen, moves: [], end: 'quiet' });
  assert.deepEqual(toLine(checked.board, checked.turn, [ref('7071')]), { start: inCheck.fen, moves: [], end: 'quiet' });   // ignores the check
  assert.deepEqual(toLine(checked.board, checked.turn, [ref(inCheck.move)]).moves.map(m => m.notation), [inCheck.notation]);
  // Entries that are not moves end the replay like an illegal move.
  assert.deepEqual(toLine(start, 'red', [ref('7774'), null, ref('0726')]).moves.map(m => m.notation), ['炮二平五']);
  assert.deepEqual(toLine(start, 'red', [{ from: { row: 7, col: 7 } }]).moves, []);
});

test('describeMove gives coordinates, canonical notation, piece type, colour and the captured type', () => {
  const start = createInitialBoard();
  assert.deepEqual(describeMove(start, ref('7774')), {
    from: { row: 7, col: 7 }, to: { row: 7, col: 4 }, notation: '炮二平五', piece: 'cannon', color: 'red', captured: null,
  });
  assert.deepEqual(describeMove(start, ref('7707')), {
    from: { row: 7, col: 7 }, to: { row: 0, col: 7 }, notation: '炮二进七', piece: 'cannon', color: 'red', captured: 'horse',
  });
  assert.deepEqual(describeMove(start, ref('3040')), {
    from: { row: 3, col: 0 }, to: { row: 4, col: 0 }, notation: '卒1进1', piece: 'pawn', color: 'black', captured: null,
  });
  // A Move object is reduced to the outward shape: plain JSON, fresh squares, no piece objects.
  const move = getLegalMoves(start, 'red').find(m => codeOf(m) === '7707');
  const info = describeMove(start, move);
  assert.deepEqual(Object.keys(info).sort(), ['captured', 'color', 'from', 'notation', 'piece', 'to']);
  assert.notEqual(info.from, move.from);
  assert.notEqual(info.to, move.to);
  assert.deepEqual(JSON.parse(JSON.stringify(info)), info);
  assert.throws(() => describeMove(start, ref('4454')), RangeError);       // nothing stands on the origin
  assert.throws(() => describeMove(start, { from: { row: 9, col: 0 }, to: { row: 10, col: 0 } }), RangeError);     // off the board
});

test('normalizeNotation strips whitespace, brackets and trailing punctuation, maps full-width digits and variant glyphs, keeps the numeral script', () => {
  assert.equal(normalizeNotation('炮二平五'), '炮二平五');
  assert.equal(normalizeNotation('马8进7'), '马8进7');                    // digits stay digits
  assert.equal(normalizeNotation('马８进７'), '马8进7');
  assert.equal(normalizeNotation('０１２３４５６７８９'), '0123456789');
  assert.equal(normalizeNotation('  【馬八進七】。 '), '马八进七');
  assert.equal(normalizeNotation('車俥馬傌砲包帥將進後'), '车车马马炮炮帅将进后');
  assert.equal(normalizeNotation('「前車進一」！？'), '前车进一');
  assert.equal(normalizeNotation('【】[]()（）「」『』“”‘’"\''), '');
  assert.equal(normalizeNotation('炮 二\t平\n五　'), '炮二平五');
  assert.equal(normalizeNotation('炮二平五。，！？!?.,;；:：'), '炮二平五');
  assert.equal(normalizeNotation('炮二，平五'), '炮二，平五');             // only trailing punctuation is removed
  assert.equal(normalizeNotation('象七进五'), '象七进五');                 // the colour of a glyph is not changed
  assert.equal(normalizeNotation(''), '');
});

test('notationKey: numerals as digits, piece glyphs as type letters; null when no grammar fits', () => {
  assert.equal(notationKey('炮二平五'), 'C2平5');
  assert.equal(notationKey('炮2平5'), 'C2平5');
  assert.equal(notationKey('【砲２平５】。'), 'C2平5');
  assert.equal(notationKey('马8进7'), 'H8进7');
  assert.equal(notationKey('馬八進七'), 'H8进7');
  assert.equal(notationKey('相七进五'), 'E7进5');
  assert.equal(notationKey('象7进5'), 'E7进5');
  assert.equal(notationKey('仕四进五'), notationKey('士4进5'));
  assert.equal(notationKey('帅五平四'), 'K5平4');
  assert.equal(notationKey('将5平4'), 'K5平4');
  assert.equal(notationKey('车九退一'), 'R9退1');
  assert.equal(notationKey('兵七进一'), 'P7进1');
  assert.equal(notationKey('卒7进1'), 'P7进1');
  assert.equal(notationKey('前车进一'), '前R进1');
  assert.equal(notationKey('後炮平4'), '后C平4');
  assert.equal(notationKey('中兵平四'), '中P平4');
  assert.equal(notationKey('二兵平五'), '二P平5');
  assert.equal(notationKey('前兵七进一'), '前P7进1');
  assert.equal(notationKey('前卒7进1'), '前P7进1');
  assert.notEqual(notationKey('炮二平五'), notationKey('炮八平五'));
  assert.notEqual(notationKey('前车进一'), notationKey('后车进一'));
  assert.notEqual(notationKey('车九进一'), notationKey('车九退一'));
  for (const text of ['', '炮二平', '炮十平五', '马8进0', '五兵进一', '炮二平五五', '好棋', 'C2平5']) assert.equal(notationKey(text), null, JSON.stringify(text));
  // Every canonical notation has a key, and within one position different moves have different keys.
  for (const { board, moves } of playoutPositions(60, { seed: 5, stride: 5, plies: 140 })) {
    const keys = new Set(moves.map(m => notationKey(moveToNotation(board, m))));
    assert.ok(!keys.has(null));
    assert.equal(keys.size, moves.length);
  }
});

test('pieceRef: label, and a name that is unique within the side', () => {
  const start = createInitialBoard();
  const at = (board, row, col) => pieceRef(board, { row, col });
  assert.deepEqual(at(start, 9, 4), { type: 'king', color: 'red', at: { row: 9, col: 4 }, label: '帅', name: '帅' });
  assert.deepEqual(at(start, 0, 4), { type: 'king', color: 'black', at: { row: 0, col: 4 }, label: '将', name: '将' });
  // Several of a type on different files: "<file>路<label>", the file in the owner's numbering and numerals.
  assert.deepEqual(at(start, 9, 1), { type: 'horse', color: 'red', at: { row: 9, col: 1 }, label: '马', name: '八路马' });
  assert.equal(at(start, 9, 7).name, '二路马');
  assert.equal(at(start, 9, 0).name, '九路车');
  assert.equal(at(start, 7, 7).name, '二路炮');
  assert.equal(at(start, 6, 4).name, '五路兵');
  assert.equal(at(start, 9, 3).name, '六路仕');
  assert.equal(at(start, 9, 2).name, '七路相');
  assert.deepEqual(at(start, 0, 0), { type: 'rook', color: 'black', at: { row: 0, col: 0 }, label: '车', name: '1路车' });
  assert.equal(at(start, 0, 8).name, '9路车');
  assert.equal(at(start, 0, 7).name, '8路马');
  assert.equal(at(start, 2, 1).name, '2路炮');
  assert.equal(at(start, 3, 0).name, '1路卒');
  assert.equal(at(start, 0, 3).name, '4路士');
  assert.equal(at(start, 0, 2).name, '3路象');
  assert.deepEqual([at(start, 9, 3).label, at(start, 9, 2).label, at(start, 0, 3).label, at(start, 0, 2).label, at(start, 6, 4).label, at(start, 3, 0).label],
    ['仕', '相', '士', '象', '兵', '卒']);

  // The only piece of its type on its side: the label alone.
  const lone = boardWith([['king', 'red', 9, 4], ['king', 'black', 0, 3], ['rook', 'red', 5, 0], ['rook', 'black', 2, 0], ['rook', 'black', 2, 5], ['pawn', 'red', 6, 2]]);
  assert.equal(at(lone, 5, 0).name, '车');
  assert.equal(at(lone, 6, 2).name, '兵');
  assert.equal(at(lone, 2, 0).name, '1路车');
  assert.equal(at(lone, 2, 5).name, '6路车');

  // Two on one file: 前 / 后 + label (front = nearer the enemy).
  const redPairs = boardWith(RED_PAIRS);
  assert.equal(at(redPairs, 5, 0).name, '前车');
  assert.equal(at(redPairs, 7, 0).name, '后车');
  assert.equal(at(redPairs, 2, 7).name, '前炮');
  assert.equal(at(redPairs, 6, 2).name, '后马');
  const blackPairs = boardWith(BLACK_PAIRS);
  assert.equal(at(blackPairs, 4, 8).name, '前车');
  assert.equal(at(blackPairs, 2, 8).name, '后车');
  assert.equal(at(blackPairs, 6, 1).name, '前炮');
  assert.equal(at(blackPairs, 3, 6).name, '后马');
  const guards = boardWith([['king', 'red', 9, 4], ['king', 'black', 0, 3], ['advisor', 'red', 7, 3], ['advisor', 'red', 9, 3]]);
  assert.equal(at(guards, 7, 3).name, '前仕');
  assert.equal(at(guards, 9, 3).name, '后仕');

  // Three on one file: 前 / 中 / 后; a pawn elsewhere is named by its file.
  const three = boardWith([['king', 'red', 9, 3], ['king', 'black', 0, 5], ['pawn', 'red', 2, 4], ['pawn', 'red', 3, 4], ['pawn', 'red', 4, 4], ['pawn', 'red', 6, 0]]);
  assert.deepEqual([at(three, 2, 4).name, at(three, 3, 4).name, at(three, 4, 4).name, at(three, 6, 0).name], ['前兵', '中兵', '后兵', '九路兵']);
  // Four or five on one file: the rank words of the notation, 前 二 三 (四) 后, for both colours.
  const four = boardWith([['king', 'red', 9, 3], ['king', 'black', 0, 5], ...[1, 2, 3, 4].map(row => ['pawn', 'red', row, 7])]);
  assert.deepEqual([1, 2, 3, 4].map(row => at(four, row, 7).name), ['前兵', '二兵', '三兵', '后兵']);
  const five = boardWith([['king', 'black', 0, 3], ['king', 'red', 9, 5], ...[5, 6, 7, 8, 9].map(row => ['pawn', 'black', row, 1])]);
  assert.deepEqual([9, 8, 7, 6, 5].map(row => at(five, row, 1).name), ['前卒', '二卒', '三卒', '四卒', '后卒']);

  // Names are unique within a side; a piece that shares its file is named by its rank (no 路), any other by its file
  // (with 路) or, when it is the only one of its type, by the label alone.
  const uniqueNames = board => {
    for (const color of ['red', 'black']) {
      const names = [];
      for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 9; col++) {
          if (board[row][col]?.color !== color) continue;
          const piece = pieceRef(board, { row, col });
          assert.equal(piece.type, board[row][col].type);
          assert.equal(piece.color, color);
          assert.deepEqual(piece.at, { row, col });
          const shares = board.some((line, r) => r !== row && line[col]?.color === color && line[col].type === piece.type);
          assert.equal(/^[前中后二三四]/.test(piece.name) && !piece.name.includes('路'), shares, `${piece.name} in ${boardToFen(board, 'red')}`);
          assert.equal(piece.name.endsWith(`路${piece.label}`) || piece.name === piece.label, !shares);
          names.push(piece.name);
        }
      }
      assert.equal(new Set(names).size, names.length, `${names.join(' ')} in ${boardToFen(board, 'red')}`);
    }
  };
  // Pawns doubled on two files would share 前兵 / 后兵, so the file is appended as in the notation: 前兵七.
  const doubled = boardWith(RED_DOUBLED_PAWNS);
  assert.deepEqual([at(doubled, 3, 2).name, at(doubled, 4, 2).name, at(doubled, 3, 6).name, at(doubled, 4, 6).name, at(doubled, 6, 4).name],
    ['前兵七', '后兵七', '前兵三', '后兵三', '五路兵']);
  for (const board of [start, lone, redPairs, blackPairs, guards, three, four, five, doubled]) uniqueNames(board);
  for (const { board } of playoutPositions(200, { seed: 61, stride: 4, plies: 240, pawnBias: 0.35 })) uniqueNames(board);

  assert.throws(() => pieceRef(start, { row: 4, col: 4 }), RangeError);        // an empty point
  assert.throws(() => pieceRef(start, { row: 10, col: 0 }), RangeError);
});

test('the notations frozen in tests/helpers/positions.js are canonical and parse back', () => {
  let checked = 0;
  for (const entry of [...TACTICAL_SUITE, ...PATTERN_EXAMPLES]) {
    if (entry.move === null) continue;
    const { board, turn } = fenToBoard(entry.fen);
    assert.ok(isLegal(board, turn, entry.move), entry.name);
    assert.equal(moveToNotation(board, ref(entry.move)), entry.first, entry.name);
    assert.equal(parsedCode(entry.first, board, turn), entry.move, entry.name);
    checked++;
  }
  for (const fixture of V1_COACH_FIXTURES) {
    const { board, turn } = fenToBoard(fixture.fen);
    assert.equal(isLegal(board, turn, fixture.move), fixture.legal, fixture.name);
    if (!fixture.legal) {
      assert.deepEqual(toLine(board, turn, [ref(fixture.move)]).moves, [], fixture.name);
      continue;
    }
    assert.equal(moveToNotation(board, ref(fixture.move)), fixture.notation, fixture.name);
    assert.equal(parsedCode(fixture.notation, board, turn), fixture.move, fixture.name);
    // The move and its supplied continuation replay as one legal line, and so does the alternative variation.
    const line = toLine(board, turn, [fixture.move, ...fixture.line].map(ref));
    assert.equal(line.start, fixture.fen, fixture.name);
    assert.deepEqual(line.moves.map(moveCode), [fixture.move, ...fixture.line], fixture.name);
    for (const info of line.moves) assert.match(info.notation, NOTATION_RE);
    if (fixture.alt) assert.deepEqual(toLine(board, turn, fixture.alt.map(ref)).moves.map(moveCode), fixture.alt, fixture.name);
    checked++;
  }
  assert.equal(checked, 10 + 9 + 21);
  // The three rooks of the constructed 'rook-mate' board stand on three files, so each keeps the plain form.
  const mate = V1_COACH_FIXTURES.find(f => f.name === 'rook-mate');
  assert.equal(toLine(fenToBoard(mate.fen).board, 'red', [ref(mate.move)]).end, 'mate');
});

test('parser: every canonical notation written in the other numeral script and with the glyph of the other colour is the same move', () => {
  const numerals = '一二三四五六七八九';
  const otherScript = ch => (numerals.includes(ch) ? String(numerals.indexOf(ch) + 1) : numerals[Number(ch) - 1]);
  const otherGlyph = { 帅: '将', 将: '帅', 仕: '士', 士: '仕', 相: '象', 象: '相', 兵: '卒', 卒: '兵' };
  /** The same notation with its file and its last number in the other script (a rank word 二 三 四 is not a number). */
  const rewrite = notation => {
    const chars = [...notation];
    const ranked = '前中后二三四'.includes(chars[0]);
    const pieceAt = ranked ? 1 : 0;
    chars[pieceAt] = otherGlyph[chars[pieceAt]] ?? chars[pieceAt];
    chars[chars.length - 1] = otherScript(chars[chars.length - 1]);
    if (!ranked) chars[1] = otherScript(chars[1]);
    else if (chars.length === 5) chars[2] = otherScript(chars[2]);
    return chars.join('');
  };
  assert.equal(rewrite('炮二平五'), '炮2平5');
  assert.equal(rewrite('象7进5'), '相七进五');
  assert.equal(rewrite('前兵七进一'), '前卒7进1');
  assert.equal(rewrite('二卒平3'), '二兵平三');
  const rare = [
    '5k3/9/9/2P3P2/2P3P2/1p5p1/1p5p1/9/R8/3K4r w',
    '3k5/7P1/7P1/7P1/5P1P1/1p7/1p7/1p7/1p7/1p3K3 b',
    '3k5/r4c3/6n2/r4c3/6n2/2N6/R4C3/2N6/R4C3/4K4 w',
    '4kab2/9/5a3/4p4/6b2/2B6/4P4/3A5/9/2BAK4 w',
  ];
  const positions = [
    ...playoutPositions(120, { seed: 2027, stride: 5, plies: 220, pawnBias: 0.3 }),
    ...rare.flatMap((fen, i) => playoutPositions(20, { ...fenToBoard(fen), seed: 900 + i, plies: 10 })),
  ];
  let moves = 0;
  for (const { board, turn, moves: legal } of positions) {
    for (const move of legal) {
      const notation = moveToNotation(board, move);
      const text = rewrite(notation);
      assert.notEqual(text, notation);
      const result = parseNotation(`【${text}】`, board, turn);
      const where = `${text} for ${notation} in ${boardToFen(board, turn)}`;
      assert.equal(result.ok, true, where);
      assert.equal(codeOf(result.move), codeOf(move), where);
      assert.equal(result.move.notation, notation, where);          // the answer is always canonical
      assert.equal(notationKey(text), notationKey(notation), where);
      moves++;
    }
  }
  assert.ok(moves > 5000, `${moves} moves checked`);
});
