// tests/unit/coach/book.test.js (C2) — contract section 4.13 (and the lookup rules 2 and 3 of section 4.12).
// The positions and lines are the worked example of contract section 9.5: after 1. 炮二平五 马8进7 the child (red) tries 炮五进四,
// which loses the cannon to 马7进5; the better move is 马二进三.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMoveBook } from '../../../src/coach/book.js';
import { parseCoachText, plainText } from '../../../src/coach/markup.js';
import { NOTATION_RE } from '../../../src/core/codes.js';
import { applyMove, createInitialBoard, fenToBoard, getLegalMoves, moveToNotation, opposite } from '../../../src/core/engine.js';
import { describeMove, fromMoveCode, moveCode, parseNotation, toLine } from '../../../src/core/notation.js';
import { COACH_EXAMPLE_POSITIONS } from '../../helpers/positions.js';
import { playout } from '../../helpers/playout.js';

const EXAMPLE = COACH_EXAMPLE_POSITIONS.horseReply;
const BASE = (() => {
  const { board, turn } = fenToBoard(EXAMPLE.fen);
  return { board, turn };
})();
const sq = (row, col) => ({ row, col });
const ref = (code) => fromMoveCode(code);

const TRIAL = ref(EXAMPLE.trial);             // 炮五进四
const REFUTATION = ref(EXAMPLE.refutation);   // 马7进5
const BEST = ref(EXAMPLE.best);               // 马二进三
const AFTER_TRIAL = applyMove(BASE.board, TRIAL);

/** The lines of the packets of section 9.5, replayed on the board. */
const tryLine = () => toLine(BASE.board, 'red', [TRIAL]);
const replyLine = () => toLine(AFTER_TRIAL, 'black', [REFUTATION, ref('9172'), ref('0122')]);
const betterLine = () => toLine(BASE.board, 'red', [BEST, ref('0807'), ref('9897')]);

const newBook = () => createMoveBook(BASE);
/** The move a text names for `color` on a board by the tolerant parser, or null. */
const fromText = (text, board, color) => {
  const parsed = parseNotation(text, board, color);
  return parsed.ok ? parsed.move : null;
};

/** Runs `fn` with console.warn replaced by a recorder. */
function withWarnings(fn) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try { fn(); } finally { console.warn = original; }
  return warnings;
}

test('add registers every move of a line with its predecessors', () => {
  const book = newBook();
  assert.equal(book.base, BASE);
  assert.equal(book.size(), 0);

  // add returns the notations of the line, in order: what a packet builder puts on the wire
  assert.deepEqual(book.add('try', tryLine()), ['炮五进四']);
  assert.deepEqual(book.add('reply', replyLine()), ['马7进5', '马八进七', '马2进3']);
  assert.deepEqual(book.add('better', betterLine()), ['马二进三', '车9平8', '车一平二']);
  assert.equal(book.size(), 7);
  for (const n of ['炮五进四', '马7进5', '马八进七', '马2进3', '马二进三', '车9平8', '车一平二']) assert.match(n, NOTATION_RE);

  // coordinates, colour, code, predecessors inside the line, playable, source
  assert.deepEqual(book.lookup('炮五进四'),
    { from: sq(7, 4), to: sq(3, 4), color: 'red', code: '7434', pre: [], playable: true, src: 'try' });
  assert.deepEqual(book.lookup('马7进5'),
    { from: sq(2, 6), to: sq(3, 4), color: 'black', code: '2634', pre: [], playable: false, src: 'reply' });
  assert.deepEqual(book.lookup('马八进七'), {
    from: sq(9, 1), to: sq(7, 2), color: 'red', code: '9172',
    pre: [{ from: sq(2, 6), to: sq(3, 4), color: 'black' }], playable: false, src: 'reply',
  });
  assert.deepEqual(book.lookup('马2进3'), {
    from: sq(0, 1), to: sq(2, 2), color: 'black', code: '0122',
    pre: [{ from: sq(2, 6), to: sq(3, 4), color: 'black' }, { from: sq(9, 1), to: sq(7, 2), color: 'red' }], playable: false, src: 'reply',
  });
  assert.deepEqual(book.lookup('马二进三'),
    { from: sq(9, 7), to: sq(7, 6), color: 'red', code: '9776', pre: [], playable: true, src: 'better' });
  assert.deepEqual(book.lookup('车9平8'), {
    from: sq(0, 8), to: sq(0, 7), color: 'black', code: '0807',
    pre: [{ from: sq(9, 7), to: sq(7, 6), color: 'red' }], playable: false, src: 'better',
  });
  assert.deepEqual(book.lookup('车一平二'), {
    from: sq(9, 8), to: sq(9, 7), color: 'red', code: '9897',
    pre: [{ from: sq(9, 7), to: sq(7, 6), color: 'red' }, { from: sq(0, 8), to: sq(0, 7), color: 'black' }], playable: false, src: 'better',
  });
  assert.equal(book.lookup('兵三进一'), null, 'a notation nobody registered is not in the book');

  // the same entry is handed out every time, and the book keeps no reference to the caller's objects
  assert.equal(book.lookup('马7进5'), book.lookup('马7进5'));
  const line = replyLine();
  const fresh = newBook();
  fresh.add('reply', line);
  line.moves[0].from.row = 0;
  assert.deepEqual(fresh.lookup('马7进5').from, sq(2, 6));
});

test('playable means: the first move of a line from the base position, legal for the child there', () => {
  // the other start shape of the signature: {start: {board, turn}, moves}
  const byBoard = newBook();
  assert.deepEqual(byBoard.add('hint', { start: { board: BASE.board, turn: 'red' }, moves: [describeMove(BASE.board, BEST)] }), ['马二进三']);
  assert.equal(byBoard.lookup('马二进三').playable, true);
  assert.equal(byBoard.lookup('马二进三').src, 'hint');

  // a FEN start with counters is still the base position
  const counted = newBook();
  counted.add('hint', { ...betterLine(), start: `${EXAMPLE.fen} - - 2 2` });
  assert.equal(counted.lookup('马二进三').playable, true);

  // the same squares in a line that starts somewhere else (a moment of an earlier position) are not playable,
  // although the move would be legal on the board now
  const moment = newBook();
  assert.deepEqual(moment.add('moment', toLine(createInitialBoard(), 'red', [BEST])), ['马二进三']);
  assert.equal(moment.lookup('马二进三').playable, false);
  assert.deepEqual(moment.lookup('马二进三').pre, []);

  // the rival's first move of a line is never playable; neither is a later move of the child
  const reply = newBook();
  reply.add('reply', replyLine());
  assert.equal(reply.lookup('马7进5').playable, false);
  assert.equal(reply.lookup('马八进七').playable, false);

  // a move that is not a well-formed MoveInfo ends the registration: it and what follows are left out
  const broken = newBook();
  const good = describeMove(BASE.board, BEST);
  assert.deepEqual(broken.add('tool', { start: BASE, moves: [good, { from: sq(0, 8), to: sq(0, 7) }, good] }), ['马二进三']);
  assert.equal(broken.size(), 1);
  assert.deepEqual(broken.add('tool', { start: BASE, moves: [] }), []);
});

test('resolveLoose finds a unique legal move in the base position and after the try', () => {
  const book = newBook();

  // not in the book, but a legal move of the child in the base position
  assert.equal(book.lookup('马八进七'), null);
  assert.deepEqual(book.resolveLoose('马八进七'),
    { from: sq(9, 1), to: sq(7, 2), color: 'red', code: '9172', pre: [], playable: true, src: 'tool' });

  // the rival's answer needs a try: none is active yet
  assert.equal(book.resolveLoose('马7进5'), null);
  // with the try passed in, the text is read against the position after it (rival to move)
  const answer = { from: sq(2, 6), to: sq(3, 4), color: 'black', code: '2634', pre: [], playable: false, src: 'reply' };
  assert.deepEqual(book.resolveLoose('马7进5', TRIAL), answer);

  // the markup stream passes no try: the active try is the one registered last with src 'try'
  book.add('try', tryLine());
  assert.deepEqual(book.resolveLoose('马7进5'), answer);
  assert.deepEqual(book.resolveLoose('【马7进5】'), answer, 'brackets are stripped');
  assert.deepEqual(book.resolveLoose('馬７進５'), answer, 'glyph and digit variants are normalised');

  // after 炮五进四 the text 马二进三 fits a move of each side (red 马二进三, black 马2进3): the numerals say whose it is
  assert.equal(book.resolveLoose('马二进三').code, '9776');
  assert.equal(book.resolveLoose('马二进三').color, 'red');
  assert.equal(book.resolveLoose('马2进3').code, '0122');
  assert.equal(book.resolveLoose('马2进3').color, 'black');
  assert.equal(book.resolveLoose('马二进3'), null, 'mixed numerals cannot decide between two matches');

  // a move nobody can play, a text that is no notation, nothing at all
  assert.equal(book.resolveLoose('车一平二'), null);
  assert.equal(book.resolveLoose('好棋'), null);
  assert.equal(book.resolveLoose(''), null);

  // what was resolved loosely is not added to the book
  assert.equal(book.size(), 1);
  assert.equal(book.lookup('马7进5'), null);

  // an explicit try replaces the registered one: after 马二进三 the black horse has nothing to take on file 5
  assert.equal(book.resolveLoose('马7进5', BEST), null);
  assert.deepEqual(book.resolveLoose('车9平8', BEST),
    { from: sq(0, 8), to: sq(0, 7), color: 'black', code: '0807', pre: [], playable: false, src: 'reply' });
  assert.equal(book.resolveLoose('车9平8', { from: sq(5, 5), to: sq(4, 5) }), null, 'a try that is not a legal move opens no second position');

  // a text that is ambiguous for the side its numerals name is not resolved through the other side:
  // two red pawns on file 五 can both play 兵五进一; after 帅五进一 the black pawn's 卒5进1 would fit the same text
  const doubled = fenToBoard('3k5/4p4/9/4P4/9/4P4/9/9/9/4K4 w');
  const pawns = createMoveBook({ board: doubled.board, turn: doubled.turn });
  const kingStep = { from: sq(9, 4), to: sq(8, 4) };
  assert.equal(pawns.resolveLoose('兵五进一'), null, 'ambiguous in the base position');
  assert.equal(pawns.resolveLoose('兵五进一', kingStep), null, 'still the child\'s ambiguous move, not the rival\'s pawn');
  assert.deepEqual(pawns.resolveLoose('卒5进1', kingStep),
    { from: sq(1, 4), to: sq(2, 4), color: 'black', code: '1424', pre: [], playable: false, src: 'reply' });
  assert.equal(pawns.resolveLoose('前兵进一').code, '3424');

  // a loose spelling of a move the book holds as playable resolves to that entry (and keeps its source)
  const hinted = newBook();
  hinted.add('hint', toLine(BASE.board, 'red', [ref('7170')]));          // 炮八平九
  assert.equal(hinted.lookup('炮8平9'), null);
  assert.equal(hinted.resolveLoose('炮8平9'), hinted.lookup('炮八平九'));
});

test('resolveLoose never links a notation to another move: every move of both sides, in positions of random games', () => {
  // The child is red in some positions and black in others. With a try on the board one text often fits a move of each
  // side (马二进三 / 马2进3); the canonical notation of a move must still resolve to that move and to no other.
  let own = 0;
  let replies = 0;
  let shared = 0;
  const swapNumerals = (n) => [...n].map((ch) => {
    const i = '一二三四五六七八九'.indexOf(ch);
    if (i >= 0) return String(i + 1);
    return ch >= '1' && ch <= '9' ? '一二三四五六七八九'[Number(ch) - 1] : ch;
  }).join('');
  for (const seed of [3, 4, 5]) {
    const game = playout({ seed, plies: 90, pawnBias: 0.2 });
    for (let k = 1; k < game.length; k += 7) {
      const { board, turn, moves } = game[k];
      if (moves.length === 0) continue;
      const rival = opposite(turn);
      const book = createMoveBook({ board, turn });
      const trial = moves[(k * 5) % moves.length];
      const after = applyMove(board, trial);
      const answers = getLegalMoves(after, rival);
      const answerTexts = new Set(answers.map((m) => moveToNotation(after, m)));
      for (const active of [false, true]) {
        if (active) book.add('try', toLine(board, turn, [trial]));
        for (const move of moves) {
          const notation = moveToNotation(board, move);
          const link = book.resolveLoose(notation);
          assert.ok(link, `${notation} is a move of the child`);
          assert.deepEqual([link.code, link.color, link.playable], [moveCode(move), turn, true], notation);
          own++;
          if (active && answerTexts.has(swapNumerals(notation))) shared++;
        }
      }
      for (const move of answers) {
        const notation = moveToNotation(after, move);
        for (const link of [book.resolveLoose(notation), book.resolveLoose(notation, trial)]) {
          assert.ok(link, `${notation} answers the try`);
          assert.deepEqual([link.code, link.color, link.playable, link.src], [moveCode(move), rival, false, 'reply'], notation);
        }
        replies++;
      }
    }
  }
  assert.ok(own > 2000 && replies > 1000, `moves checked: ${own} + ${replies}`);
  assert.ok(shared > 50, `texts that fit a move of each side: ${shared}`);
});

test('resolveLoose does not draw a move of the rival, or a move of an earlier position, as a move of the child (CONTRACT-NOTES 150)', () => {
  // The parser reads both numeral scripts for both sides, so a notation of the rival (马8进7) fits the child's move on the
  // mirrored file (马八进七) whenever that one is legal. Positions of random games, the child to move, no try on the board:
  // every earlier move of the rival and every move he could play next, as the engine writes them.
  let rivalTexts = 0, wouldFit = 0, ownEarlier = 0, ownFit = 0, ownNow = 0;
  for (const seed of [3, 4, 5]) {
    const game = playout({ seed, plies: 90, pawnBias: 0.2 });
    /** The notation of the move that led to position i, by the side that played it. */
    const played = game.slice(1).map((p, i) => ({ notation: moveToNotation(game[i].board, p.move), color: game[i].turn, code: moveCode(p.move) }));
    for (let k = 2; k < game.length; k += 7) {
      const { board, turn, moves } = game[k];
      if (moves.length === 0) continue;
      const rival = opposite(turn);
      const book = createMoveBook({ board, turn });
      const fits = (text) => fromText(text, board, turn) !== null;
      const earlier = played.slice(0, k);
      const his = [...earlier.filter((m) => m.color === rival).map((m) => m.notation), ...getLegalMoves(board, rival).map((m) => moveToNotation(board, m))];
      for (const notation of his) {
        rivalTexts++;
        if (fits(notation)) wouldFit++;
        assert.equal(book.resolveLoose(notation), null, `${notation} is a move of the rival (seed ${seed}, ply ${k})`);
      }
      // An earlier move of the child, read in this position, is whatever move of the child has that notation now (often
      // on other squares). Told to the book as history it is no move of this position at all.
      const mine = earlier.filter((m) => m.color === turn);
      for (const m of mine) {
        ownEarlier++;
        const link = book.resolveLoose(m.notation);
        if (link !== null) {
          ownFit++;
          assert.deepEqual([link.color, link.playable], [turn, true], m.notation);
        }
      }
      book.past(mine.map((m) => m.notation));
      for (const m of mine) assert.equal(book.resolveLoose(m.notation), null, `${m.notation} is history (seed ${seed}, ply ${k})`);
      // every other move of the child still resolves to itself
      const told = new Set(mine.map((m) => m.notation));
      for (const move of moves) {
        const notation = moveToNotation(board, move);
        if (told.has(notation)) continue;
        const link = book.resolveLoose(notation);
        assert.ok(link, `${notation} is a move of the child`);
        assert.deepEqual([link.code, link.color, link.playable], [moveCode(move), turn, true], notation);
        ownNow++;
      }
    }
  }
  assert.ok(rivalTexts > 2000 && wouldFit > 500, `texts of the rival: ${rivalTexts}, of which ${wouldFit} fit a move of the child`);
  assert.ok(ownEarlier > 500 && ownFit > 100 && ownNow > 1000, `earlier moves of the child: ${ownEarlier} (${ownFit} fit a move now); moves now: ${ownNow}`);

  // The example of the finding: after 1. 炮二平五 马8进7 2. 马二进三 车9平8 3. 车一平二 卒7进1 the model says of round 1 that
  // 【马8进7】 eyed the central pawn. The button moved the child's own horse (马八进七).
  let board = createInitialBoard();
  for (const code of ['7774', '0726', '9776', '0807', '9897', '3646']) board = applyMove(board, ref(code));
  const book = createMoveBook({ board, turn: 'red' });
  assert.ok(fromText('马8进7', board, 'red'), 'the text fits the child\'s horse on the mirrored file');
  let segments = [];
  const warnings = withWarnings(() => {
    segments = parseCoachText('第1回合对方【马8进7】就盯上了中兵。对方下一步想走【炮8平9】。', book);
  });
  assert.deepEqual(segments.map((s) => s.type), ['text'], 'no button');
  assert.equal(plainText(segments), '第1回合对方马8进7就盯上了中兵。对方下一步想走炮8平9。');
  assert.equal(warnings.length, 2, 'both are reported as ungrounded');
  // the child's own moves are untouched, in either spelling of the action and with full-width digits
  assert.equal(book.resolveLoose('马八进七').code, '9172');
  assert.equal(book.resolveLoose('傌八進七').code, '9172');
  // ... and a sloppy spelling of a move the book offers still finds that move, while one of a move it does not offer does not
  book.add('hint', toLine(board, 'red', [ref('9172')]));
  assert.equal(book.resolveLoose('马8进7'), book.lookup('马八进七'));
  assert.equal(book.resolveLoose('炮8平9'), null);

  // past(): history is not resolved loosely; a notation that is registered is still found by lookup, which is asked first
  // (the position of section 9.5: 马二进三 is a legal move of the child, and after the try 炮五进四 so is the rival's 马2进3)
  const told = newBook();
  assert.equal(told.resolveLoose('马二进三').code, '9776');
  assert.equal(told.resolveLoose('马2进3', TRIAL).code, '0122');
  told.past(['炮二平五', '【马二进三】', '马２进３', '', '好棋', 7]);
  assert.equal(told.resolveLoose('马二进三'), null);
  assert.equal(told.resolveLoose('马二进三', TRIAL), null);
  assert.equal(told.resolveLoose('马2进3', TRIAL), null, 'nor as an answer of the rival');
  assert.equal(told.resolveLoose('马八进七').code, '9172', 'what was not told still resolves');
  assert.equal(told.size(), 0, 'history is not in the book');
  assert.equal(told.lookup('马二进三'), null);
  withWarnings(() => { segments = parseCoachText('第2回合我方【马二进三】。', told); });
  assert.deepEqual(segments.map((s) => s.type), ['text']);
  told.add('hint', betterLine());
  assert.equal(told.lookup('马二进三').playable, true);
  withWarnings(() => { segments = parseCoachText('可以走【马二进三】。', told); });
  assert.deepEqual(segments.map((s) => s.type), ['text', 'move', 'text']);
  assert.equal(segments[1].link, told.lookup('马二进三'));
});

test('lookup normalises glyph and digit variants', () => {
  const book = newBook();
  book.add('reply', replyLine());
  const link = book.lookup('马7进5');
  assert.ok(link);

  assert.equal(book.lookup('馬7進5'), link, 'traditional glyphs');
  assert.equal(book.lookup('马７进５'), link, 'full-width digits');
  assert.equal(book.lookup('【马7进5】'), link, 'brackets');
  assert.equal(book.lookup(' 马7进5。'), link, 'white space and trailing punctuation');
  assert.equal(book.lookup('傌八進七'), book.lookup('马八进七'));

  // the numeral script is not changed: 马七进五 would be a red move, and none is registered
  assert.equal(book.lookup('马七进五'), null);
  assert.equal(book.lookup('马八进7'), null);
  assert.equal(book.lookup(''), null);
  assert.equal(book.lookup('好棋'), null);
});

test('lookup prefers a playable entry, then the most recent line, then the earliest move of that line', () => {
  // 马二进三 as a later move of one line and as a playable first move of another
  const later = toLine(BASE.board, 'red', [TRIAL, REFUTATION, BEST]);
  assert.deepEqual(later.moves.map((m) => m.notation), ['炮五进四', '马7进5', '马二进三']);
  const a = newBook();
  a.add('better', betterLine());
  a.add('tool', later);                                   // more recent, but not playable
  assert.equal(a.lookup('马二进三').playable, true);
  assert.equal(a.lookup('马二进三').src, 'better');
  const b = newBook();
  b.add('tool', later);
  b.add('better', betterLine());
  assert.equal(b.lookup('马二进三').src, 'better');

  // 马2进3 in two lines, playable in neither: the line added last wins
  const other = toLine(BASE.board, 'red', [BEST, ref('0122')]);
  assert.deepEqual(other.moves.map((m) => m.notation), ['马二进三', '马2进3']);
  const c = newBook();
  c.add('reply', replyLine());
  c.add('tool', other);
  assert.equal(c.lookup('马2进3').src, 'tool');
  assert.equal(c.lookup('马2进3').pre.length, 1);
  const d = newBook();
  d.add('tool', other);
  d.add('reply', replyLine());
  assert.equal(d.lookup('马2进3').src, 'reply');
  assert.equal(d.lookup('马2进3').pre.length, 2);
  assert.equal(c.size(), 4, 'size counts distinct notations, not registrations');

  // one line that plays the same move twice: the first time it is played
  const shuffle = toLine(BASE.board, 'red', [ref('9888'), ref('0818'), ref('8898'), ref('1808'), ref('9888'), ref('0818')]);
  assert.deepEqual(shuffle.moves.map((m) => m.notation), ['车一进一', '车9进1', '车一退一', '车9退1', '车一进一', '车9进1']);
  const e = newBook();
  e.add('tool', shuffle);
  assert.equal(e.size(), 4);
  assert.equal(e.lookup('车9进1').pre.length, 1);
  assert.equal(e.lookup('车一进一').pre.length, 0);
  assert.equal(e.lookup('车一进一').playable, true);
});

test('coach text is grounded through the book: copied notations, loose ones, and invented ones', () => {
  const book = newBook();
  book.add('try', tryLine());
  book.add('reply', replyLine());

  let segments = [];
  const warnings = withWarnings(() => {
    segments = parseCoachText('对方会走【马7进5】吃炮。不如改走【马二进三】，别走【车一进九】。', book);
  });
  assert.deepEqual(segments.map((s) => s.type), ['text', 'move', 'text', 'move', 'text']);
  assert.equal(segments[1].link, book.lookup('马7进5'), 'a notation copied from a packet is the book entry');
  assert.deepEqual(segments[3].link, { from: sq(9, 7), to: sq(7, 6), color: 'red', code: '9776', pre: [], playable: true, src: 'tool' });
  assert.equal(plainText(segments), '对方会走马7进5吃炮。不如改走马二进三，别走车一进九。');
  assert.equal(warnings.length, 1, 'the invented move is reported and stays plain text');
  assert.match(warnings[0], /车一进九/);
});
