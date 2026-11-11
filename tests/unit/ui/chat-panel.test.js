// chat-panel.js, its pure part (the panel itself needs a document and is tested in the browser): what stays of a line
// that is cut while it is still coming in (SPEC 7.7; CONTRACT-NOTES 150).
import test from 'node:test';
import assert from 'node:assert/strict';

import { shownSentences } from '../../../src/ui/chat-panel.js';

const text = (t) => ({ type: 'text', text: t });
/** A move segment; the link is whatever the book made of it (the helper never looks inside). */
const move = (notation) => ({ type: 'move', notation, link: { code: '7774', notation, color: 'red', from: { row: 7, col: 7 }, to: { row: 7, col: 4 },
                                                             pre: [], playable: true, src: 'try' } });
/** What a list of segments shows. */
const shown = (segments) => segments.map((seg) => (seg.type === 'move' ? `【${seg.notation}】` : seg.text)).join('');

test('a line that is cut keeps the whole sentences of what has been shown, and nothing when none is complete', () => {
  // the two cases of the closing review: seven characters were on screen
  assert.deepEqual(shownSentences([text('对方跳马，盯着')], 7), []);
  assert.equal(shown(shownSentences([text('他架炮了。盯着')], 7)), '他架炮了。');

  // only what has been shown counts: a sentence that ends in the backlog is not kept
  assert.equal(shown(shownSentences([text('他架炮了。盯着你的马。')], 7)), '他架炮了。');
  assert.equal(shown(shownSentences([text('他架炮了。盯着你的马。')], 10)), '他架炮了。');
  assert.equal(shown(shownSentences([text('他架炮了。盯着你的马。')], 11)), '他架炮了。盯着你的马。');
  assert.deepEqual(shownSentences([text('他架炮了。盯着你的马。')], 4), [], 'the full stop itself was not on screen yet');
  assert.equal(shown(shownSentences([text('他架炮了。盯着你的马。')], 5)), '他架炮了。');

  // nothing shown, nothing kept; more shown than there is, everything that is whole
  assert.deepEqual(shownSentences([text('他架炮了。')], 0), []);
  assert.deepEqual(shownSentences([text('他架炮了。')], -3), []);
  assert.deepEqual(shownSentences([text('他架炮了。')], Number.NaN), []);
  assert.deepEqual(shownSentences([], 12), []);
  assert.equal(shown(shownSentences([text('好棋！再看看？嗯')], 99)), '好棋！再看看？');
});

test('the three sentence ends, and the closing marks that belong to them', () => {
  assert.equal(shown(shownSentences([text('小心！他想')], 5)), '小心！');
  assert.equal(shown(shownSentences([text('怎么办？先')], 5)), '怎么办？');
  assert.equal(shown(shownSentences([text('他说「将军！」然后')], 9)), '他说「将军！」');
  assert.equal(shown(shownSentences([text('他说「将军！」然后')], 7)), '他说「将军！」');
  assert.equal(shown(shownSentences([text('他说「将军！」然后')], 6)), '他说「将军！', 'the closing mark was not shown yet: the sentence end was');
  // a comma, a dash or an ellipsis ends no sentence
  assert.deepEqual(shownSentences([text('先出车，再跳马——然后……')], 13), []);
});

test('a move counts as its notation and is kept whole; what follows the last sentence end is dropped', () => {
  const line = [text('先走'), move('炮二平五'), text('。再出车，'), move('车一平二'), text('也不错。')];
  // 2 + 4 + 1 = 7 characters reach the first full stop
  assert.deepEqual(shownSentences(line, 6), [], 'the move is on screen, its sentence is not complete');
  let kept = shownSentences(line, 7);
  assert.equal(shown(kept), '先走【炮二平五】。');
  assert.equal(kept[1], line[1], 'the move segment itself, link and all');
  // the second move was shown, the end of its sentence was not: the move goes with its sentence
  kept = shownSentences(line, 17);
  assert.equal(shown(kept), '先走【炮二平五】。');
  assert.equal(kept.length, 3);
  // a move that is only partly inside the count has not been shown at all
  assert.equal(shown(shownSentences(line, 13)), '先走【炮二平五】。');
  // everything shown
  kept = shownSentences(line, 19);
  assert.equal(shown(kept), '先走【炮二平五】。再出车，【车一平二】也不错。');
  assert.equal(kept[4], line[4], 'an untouched segment is passed on as it is');
  // a line of moves only has no sentence
  assert.deepEqual(shownSentences([move('炮二平五'), move('马8进7')], 8), []);
});

test('characters are counted as stream-text counts them, and the input is left alone', () => {
  // one astral character is one character
  assert.equal(shown(shownSentences([text('𠮷好。后面')], 3)), '𠮷好。');
  assert.deepEqual(shownSentences([text('𠮷好。后面')], 2), []);
  // empty segments take no room
  assert.equal(shown(shownSentences([text(''), text('好。'), text(''), text('再')], 3)), '好。');
  const line = [text('他架炮了。盯着')];
  const copy = JSON.stringify(line);
  const kept = shownSentences(line, 7);
  assert.equal(JSON.stringify(line), copy);
  assert.notEqual(kept[0], line[0], 'a shortened segment is a new one');
});
