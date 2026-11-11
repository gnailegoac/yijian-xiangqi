// tests/unit/coach/markup.test.js (C1) — contract section 4.12, tested against a fake book.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMarkupStream, parseCoachText, plainText, sanitizeModelText } from '../../../src/coach/markup.js';
import { plainLength } from '../../../src/coach/protocol.js';

/** @returns {import('../../../src/coach/types.js').MoveLink} */
function link(code, extra = {}) {
  return {
    from: { row: Number(code[0]), col: Number(code[1]) }, to: { row: Number(code[2]), col: Number(code[3]) },
    color: 'black', code, pre: [], playable: false, src: 'reply', ...extra,
  };
}

/**
 * A stand-in for the MoveBook of book.js (C2).
 * `entries` are the registered moves in the order they were added: {notation, link, packet} with `packet` the number of the packet
 * that registered it. `lookup` applies the priority of section 4.12 rule 2: a playable entry; else the most recent packet; else any.
 * `loose` maps a notation to the link `resolveLoose` finds for it. Every call is recorded in `calls`.
 */
function fakeBook(entries = [], loose = {}) {
  const calls = [];
  return {
    calls,
    base: { board: [], turn: 'red' },
    add() { return []; },
    lookup(notation) {
      calls.push(['lookup', notation]);
      const hits = entries.filter((e) => e.notation === notation);
      if (hits.length === 0) return null;
      const playable = hits.find((e) => e.link.playable);
      if (playable) return playable.link;
      return hits.reduce((a, b) => (b.packet >= a.packet ? b : a)).link;
    },
    resolveLoose(notation, tryMove) {
      calls.push(['resolveLoose', notation, tryMove]);
      return loose[notation] ?? null;
    },
    size() { return entries.length; },
    /** How often a notation was found neither by lookup nor by resolveLoose: what a client counts as `ungrounded`. */
    misses() { return calls.filter((c) => c[0] === 'resolveLoose' && (loose[c[1]] ?? null) === null).length; },
  };
}

const REPLY_LINK = link('2143');
const BOOK = () => fakeBook([{ notation: '马7进5', link: REPLY_LINK, packet: 1 }]);

/** Feeds `deltas` to a stream and collects what it emits. */
function run(book, deltas, opts, full) {
  const segments = [];
  const sentences = [];
  const stream = createMarkupStream(book, (seg) => segments.push(seg), (text) => sentences.push(text), opts);
  for (const delta of deltas) stream.push(delta);
  const beforeFinish = segments.length;
  if (full === undefined) stream.finish(); else stream.finish(full);
  return { segments, sentences, stream, beforeFinish };
}

/** Splits a string into pieces of `n` UTF-16 units. */
const chunks = (text, n) => text.match(new RegExp(`[^]{1,${n}}`, 'g')) ?? [];

/** Runs `fn` with console.warn replaced by a recorder. */
function withWarnings(fn) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try { fn(warnings); } finally { console.warn = original; }
  return warnings;
}

test('a bracket split across deltas resolves to one move segment', () => {
  const book = BOOK();
  const segments = [];
  const stream = createMarkupStream(book, (seg) => segments.push(seg));

  stream.push('对方会走【马7');
  // text before the bracket is out already; nothing of the unfinished bracket is
  assert.deepEqual(segments, [{ type: 'text', text: '对方会走' }]);
  assert.equal(stream.shown(), '对方会走');
  assert.deepEqual(book.calls, []);

  stream.push('进5】把炮吃掉。');
  assert.deepEqual(segments, [
    { type: 'text', text: '对方会走' },
    { type: 'move', notation: '马7进5', link: REPLY_LINK },
    { type: 'text', text: '把炮吃掉。' },
  ]);
  assert.equal(segments[1].link, REPLY_LINK, 'the link is the book entry itself');
  assert.equal(stream.shown(), '对方会走【马7进5】把炮吃掉。');
  stream.finish();
  assert.equal(segments.length, 3, 'finish() has nothing left to emit');

  // wherever the text is split, the result is the same text with exactly one move segment
  const text = '对方会走【马7进5】把炮吃掉。';
  for (const size of [1, 2, 3, 5, 7, 100]) {
    const r = run(BOOK(), chunks(text, size));
    assert.equal(plainText(r.segments), '对方会走马7进5把炮吃掉。', `chunks of ${size}`);
    const moves = r.segments.filter((s) => s.type === 'move');
    assert.equal(moves.length, 1);
    assert.equal(moves[0].notation, '马7进5');
    assert.equal(moves[0].link, REPLY_LINK);
    assert.ok(r.segments.every((s) => s.type === 'move' || !/[【】]/.test(s.text)), 'no bracket reaches the screen');
    assert.equal(r.stream.shown(), text);
  }

  // the delta may end right after 【 or right before 】
  assert.equal(run(BOOK(), ['走【', '马7进5', '】。']).segments.filter((s) => s.type === 'move').length, 1);
  // two moves in one reply, the same move twice
  const twice = run(BOOK(), ['先【马7进5】，再【马7', '进5】。']);
  assert.deepEqual(twice.segments.map((s) => s.type), ['text', 'move', 'text', 'move', 'text']);
});

test('an unresolved notation becomes plain text without brackets and counts as ungrounded', () => {
  const book = BOOK();
  let result;
  const warnings = withWarnings(() => { result = run(book, ['不如走【车五', '进九】吧。']); });

  // plain text, no brackets, no move segment: an invented move is never drawn on the board
  assert.deepEqual(result.segments, [{ type: 'text', text: '不如走' }, { type: 'text', text: '车五进九吧。' }]);
  assert.equal(plainText(result.segments), '不如走车五进九吧。');
  assert.equal(result.stream.shown(), '不如走车五进九吧。');
  // it was looked up in the book and then against the legal moves, in that order, and found in neither
  assert.deepEqual(book.calls, [['lookup', '车五进九'], ['resolveLoose', '车五进九', undefined]]);
  assert.equal(book.misses(), 1);
  // and reported
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /车五进九/);

  // a grounded reply reports nothing
  const clean = BOOK();
  assert.deepEqual(withWarnings(() => run(clean, ['对方会走【马7进5】。'])), []);
  assert.equal(clean.misses(), 0);
  assert.deepEqual(clean.calls, [['lookup', '马7进5']]);

  // rule 3: a notation that is not in the book but is a unique legal move becomes a move segment
  const LOOSE = link('9070', { color: 'red', playable: true, src: 'tool' });
  const loose = fakeBook([], { 车一平二: LOOSE });
  const found = [];
  assert.deepEqual(withWarnings(() => { found.push(...run(loose, ['可以【车一平二】。']).segments); }), []);
  assert.deepEqual(found, [{ type: 'text', text: '可以' }, { type: 'move', notation: '车一平二', link: LOOSE }, { type: 'text', text: '。' }]);
  assert.equal(loose.misses(), 0);

  // words in brackets that are no move at all are shown as words
  const words = fakeBook();
  withWarnings(() => { assert.equal(plainText(run(words, ['【注意】对方的炮。']).segments), '注意对方的炮。'); });
  assert.equal(words.misses(), 1);
  // empty brackets show nothing and are not a notation
  const empty = fakeBook();
  assert.deepEqual(withWarnings(() => { assert.equal(plainText(run(empty, ['好【】棋。']).segments), '好棋。'); }), []);
  assert.deepEqual(empty.calls, []);

  // every occurrence is asked for again and counts; the report is made once per notation
  const again = fakeBook();
  const repeated = withWarnings(() => run(again, ['【车五进九】或者【车五进九】，还是【车五进九】？']));
  assert.equal(again.misses(), 3);
  assert.equal(repeated.length, 1);
});

test('a notation the book learns during the reply resolves from then on', () => {
  // The tool loop (section 7.12): the first leg mentions a move the book does not know yet, the tool verdict registers it, and the
  // second leg, parsed by the same stream, mentions it again.
  const TOOL_LINK = link('2724', { src: 'tool' });
  const entries = [];
  const book = fakeBook(entries);
  const segments = [];
  const stream = createMarkupStream(book, (seg) => segments.push(seg), undefined, { cap: 105 });
  const warnings = withWarnings(() => {
    stream.push('亮摆一摆【炮2平5】。');
    entries.push({ notation: '炮2平5', link: TOOL_LINK, packet: 2 });          // buildToolVerdict registers the tool's moves
    stream.push('对方走【炮2平5】也不怕，');
    stream.push('【炮2平5】之后阵形照样稳。');
    stream.finish('亮摆一摆【炮2平5】。\n对方走【炮2平5】也不怕，【炮2平5】之后阵形照样稳。');
  });
  assert.deepEqual(segments.map((s) => (s.type === 'move' ? s.link : s.text)),
    ['亮摆一摆炮2平5。', '对方走', TOOL_LINK, '也不怕，', TOOL_LINK, '之后阵形照样稳。']);
  assert.equal(stream.shown(), '亮摆一摆炮2平5。对方走【炮2平5】也不怕，【炮2平5】之后阵形照样稳。');
  assert.equal(warnings.length, 1, 'the first mention was ungrounded');
  assert.equal(book.misses(), 1);
  // once resolved, a notation keeps its link for the rest of the reply
  assert.equal(book.calls.filter((c) => c[0] === 'lookup').length, 2);
});

test('playable entries are preferred; then the most recent packet', () => {
  const OLD = link('7062', { color: 'red', src: 'hint' });
  const PLAYABLE = link('7062', { color: 'red', src: 'better', playable: true });
  const RECENT = link('7062', { color: 'red', src: 'tool' });

  // one notation in three lines: the playable entry wins although a later packet also has it
  const withPlayable = fakeBook([
    { notation: '马二进三', link: OLD, packet: 1 },
    { notation: '马二进三', link: PLAYABLE, packet: 2 },
    { notation: '马二进三', link: RECENT, packet: 3 },
  ]);
  let r = run(withPlayable, ['更好的是【马二', '进三】。']);
  assert.equal(r.segments[1].type, 'move');
  assert.equal(r.segments[1].link, PLAYABLE);

  // no playable entry: the most recently added packet
  const noPlayable = fakeBook([
    { notation: '马二进三', link: RECENT, packet: 3 },
    { notation: '马二进三', link: OLD, packet: 1 },
  ]);
  r = run(noPlayable, ['更好的是【马二进三】。']);
  assert.equal(r.segments[1].link, RECENT);

  // else any
  const single = fakeBook([{ notation: '马二进三', link: OLD, packet: 1 }]);
  assert.equal(run(single, ['【马二进三】']).segments[0].link, OLD);

  // the stream asks the book once, with the normalised notation, and takes its answer: it never falls through to resolveLoose
  for (const book of [withPlayable, noPlayable, single]) assert.deepEqual(book.calls, [['lookup', '马二进三']]);

  // rule 2: the content is normalised before the lookup (full-width digits, variant glyphs, stray spaces and punctuation)
  const variants = fakeBook([{ notation: '马8进7', link: REPLY_LINK, packet: 1 }, { notation: '车二平五', link: OLD, packet: 1 }]);
  r = run(variants, ['【馬８進７】、【 马8进7。】和【車二平五】']);
  assert.deepEqual(r.segments.filter((s) => s.type === 'move').map((s) => [s.notation, s.link]),
    [['马8进7', REPLY_LINK], ['马8进7', REPLY_LINK], ['车二平五', OLD]]);
  assert.deepEqual([...new Set(variants.calls.map((c) => c.join(':')))], ['lookup:马8进7', 'lookup:车二平五']);
  // the numeral script is not changed: 马八进七 is another string than 马8进7
  const other = fakeBook([{ notation: '马8进7', link: REPLY_LINK, packet: 1 }]);
  withWarnings(() => { assert.equal(run(other, ['【马八进七】']).segments[0].type, 'text'); });
  assert.deepEqual(other.calls[0], ['lookup', '马八进七']);
});

test('URL and markdown stripping', () => {
  // `*`, `#`, backticks
  assert.equal(sanitizeModelText('**好棋**'), '好棋');
  assert.equal(sanitizeModelText('# 要点'), ' 要点');
  assert.equal(sanitizeModelText('走`马8进7`吧'), '走马8进7吧');
  // `_` used as markup goes; an underscore inside an identifier stays
  assert.equal(sanitizeModelText('_强调_和__加粗__'), '强调和加粗');
  assert.equal(sanitizeModelText('analyze_move'), 'analyze_move');
  // URLs: https?://\S+ and www.\S+
  assert.equal(sanitizeModelText('见 https://example.com/x?y=1 这里'), '见  这里');
  assert.equal(sanitizeModelText('见 http://example.com 或 www.example.com 。'), '见  或  。');
  assert.equal(sanitizeModelText('WWW.Example.com'), '');
  // control characters; the line break stays (stream-text renders it)
  assert.equal(sanitizeModelText('好\u0000棋\u0007！\t\r\n再来'), '好棋！\n再来');
  assert.equal(sanitizeModelText('好\u009f棋'), '好棋');
  // everything else is untouched, the move brackets included
  assert.equal(sanitizeModelText('对方会走【马7进5】，咱们亏了。'), '对方会走【马7进5】，咱们亏了。');
  assert.equal(sanitizeModelText(''), '');

  // rule 5: it runs on every delta before parsing
  const r = run(BOOK(), ['**妙哉**！见 https://example.com/a ', '对方会走`【马7进5】`，# 先看_保镖_。']);
  assert.equal(plainText(r.segments), '妙哉！见  对方会走马7进5， 先看保镖。');
  assert.equal(r.segments.filter((s) => s.type === 'move').length, 1);
  assert.ok(r.segments.every((s) => s.type === 'move' || !/[*#`_]|https?:|www\./.test(s.text)));

  // and on the whole string in parseCoachText
  const parsed = parseCoachText('**【马7进5】**走得好！', BOOK());
  assert.deepEqual(parsed, [{ type: 'move', notation: '马7进5', link: REPLY_LINK }, { type: 'text', text: '走得好！' }]);

  // a URL that only appears once a mark or a control character inside it is gone is removed too
  assert.equal(sanitizeModelText('见 ht*tp://example.com 这里'), '见  这里');
  assert.equal(sanitizeModelText('见 w`ww.exam\u0000ple.com 这里'), '见  这里');
  assert.equal(sanitizeModelText('见 https://example.com/#top 这里'), '见  这里');
});

test('a URL written across several deltas never reaches the screen', () => {
  // a model streams tokens: the scheme, the separator and the host arrive as separate deltas, and what was shown cannot be taken back
  const deltas = ['看这里 ', 'https', '://', 'evil', '.example', '/x', ' 好的。'];
  const seen = [];
  const stream = createMarkupStream(fakeBook(), (seg) => seen.push(seg), undefined, { cap: 105 });
  for (const delta of deltas) {
    stream.push(delta);
    assert.doesNotMatch(plainText(seen), /h|:|\/|evil|example/, `after ${JSON.stringify(delta)}`);
  }
  assert.equal(plainText(seen), '看这里  好的。');
  stream.finish(deltas.join(''));
  assert.equal(plainText(seen), '看这里  好的。');
  assert.equal(stream.shown(), '看这里  好的。');

  // however the text is cut, the result is the text sanitised as a whole
  const text = '先看 HTTP://Example.com/a?b=1 ，再去www.example.cn/x 。好棋！';
  const expected = '先看  ，再去 。好棋！';
  assert.equal(sanitizeModelText(text), expected);
  for (const size of [1, 2, 3, 4, 5, 7, 100]) {
    assert.equal(plainText(run(fakeBook(), chunks(text, size)).segments), expected, `chunks of ${size}`);
    assert.equal(plainText(run(fakeBook(), chunks(text, size), { cap: 60 }).segments), expected, `chunks of ${size}, with a cap`);
    assert.equal(plainText(run(fakeBook(), chunks(text.slice(0, 9), size), undefined, text).segments), expected, `chunks of ${size}, then finish(text)`);
  }

  // a URL with no white space after it runs to the end of the reply (\S+), streamed or not
  assert.equal(plainText(run(fakeBook(), ['去w', 'ww.', 'evil.cn看看。']).segments), '去');
  assert.equal(sanitizeModelText('去www.evil.cn看看。'), '去');

  // letters that could have begun a URL and did not are shown, a delta later at most
  const plain = [];
  const s2 = createMarkupStream(fakeBook(), (seg) => plain.push(seg));
  s2.push('这步棋很 ht');
  assert.equal(plainText(plain), '这步棋很 ');
  s2.push('tp');
  assert.equal(plainText(plain), '这步棋很 ');
  s2.push('，对吧');
  assert.equal(plainText(plain), '这步棋很 http，对吧');
  s2.push('。www');
  s2.finish();
  assert.equal(plainText(plain), '这步棋很 http，对吧。www');
  // `http://` followed by white space is not a URL (the pattern needs one more character)
  assert.equal(plainText(run(fakeBook(), ['写作 http://', ' 就行。']).segments), '写作 http:// 就行。');
});

test('a surrogate pair split across deltas stays one character', () => {
  const r = run(fakeBook(), ['好\ud83d', '\ude00棋。'], { cap: 4 });
  assert.deepEqual(r.segments, [{ type: 'text', text: '好' }, { type: 'text', text: '😀棋。' }]);
  assert.equal(r.stream.shown(), '好😀棋。');                 // four characters: the cap of 4 does not cut it
  assert.ok(r.segments.every((s) => !/[\ud800-\udbff]$|^[\udc00-\udfff]/.test(s.text)), 'no segment holds half a pair');
});

test('the same result however the text is split: URLs, marks, brackets (1500 seeded replies)', () => {
  // mulberry32, fixed seed
  let state = 41200;
  const rnd = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ATOMS = ['走', '得', '稳', '对', '方', '吃', '炮', '，', '。', '！', '？', '。', '【马7进5】', '【车五进九】', '【', '】', '**', '#', '`', ' ', '\n',
    'h', 'ht', 'http', 'https', 'http://', 'https://', 'www', 'www.', 'w', 'x.cn', '/a', ':', '/', '😀', '𠀀', '”', '“', '\u0000', '\t', 'abc', '7'];
  /** Pieces of 1..6 UTF-16 units: a cut may fall inside a bracket, a URL or a surrogate pair. */
  const split = (text) => {
    const out = [];
    for (let i = 0; i < text.length;) { const n = 1 + Math.floor(rnd() * 6); out.push(text.slice(i, i + n)); i += n; }
    return out;
  };

  /** The uncapped result computed on the whole text, by hand: sanitise, then resolve the brackets (only 马7进5 is in the book). */
  const reference = (text) => {
    const t = sanitizeModelText(text);
    let out = '';
    for (let i = 0; i < t.length;) {
      if (t[i] === '【') {
        const close = t.indexOf('】', i + 1);
        const next = t.indexOf('【', i + 1);
        if (close !== -1 && close - i <= 10 && (next === -1 || close < next)) {
          const inner = t.slice(i + 1, close);
          const notation = inner.replace(/[\s“”]/g, '').replace(/[。，！？!?.,;；:：]+$/, '');
          out += notation === '' ? '' : notation === '马7进5' ? '【马7进5】' : inner;
          i = close + 1;
        } else i += 1;
      } else if (t[i] === '】') i += 1;
      else out += t[i++];
    }
    return out.replace(/^\s+/, '');
  };

  withWarnings(() => {
    for (let n = 0; n < 1500; n++) {
      let text = '';
      const atoms = 1 + Math.floor(rnd() * 20);
      for (let k = 0; k < atoms; k++) text += ATOMS[Math.floor(rnd() * ATOMS.length)];
      const where = `reply ${n}: ${JSON.stringify(text)}`;

      assert.equal(run(BOOK(), [text]).stream.shown(), reference(text), where);
      for (const opts of [undefined, { cap: 1 + Math.floor(rnd() * 25) }]) {
        const whole = run(BOOK(), [text], opts);
        const seen = Math.floor(rnd() * (text.length + 1));
        for (const r of [run(BOOK(), split(text), opts), run(BOOK(), split(text.slice(0, seen)), opts, text)]) {
          assert.equal(r.stream.shown(), whole.stream.shown(), where);
          assert.deepEqual(r.sentences, whole.sentences, where);
          assert.equal(plainText(r.segments), r.stream.shown().replace(/[【】]/g, ''), where);
          assert.equal(r.stream.sentences(), r.sentences.length, where);
          assert.doesNotMatch(plainText(r.segments).replace(/……$/, ''), /https?:\/\/\S|www\.\S|[*#`\u0000\t]/, where);
          assert.ok(r.segments.every((s) => s.type === 'move' || (s.text !== '' && !/[\ud800-\udbff]$/.test(s.text))), where);
          if (opts) assert.ok(plainLength(r.stream.shown().replace(/……$/, '')) <= opts.cap, where);
        }
      }
    }
  });
});

test('display cap: stops at the last sentence end before the cap; finish() respects the cap', () => {
  // three sentences of 5, 5 and 8 characters; the cap of 12 falls inside the third
  const text = '第一句话。第二句话。第三句话太长了。';
  const kept = '第一句话。第二句话。';
  assert.equal(plainLength(kept), 10);

  // however the text arrives, the stream stops at the last sentence end before the cap
  for (const size of [1, 2, 3, 4, 7, 100]) {
    const r = run(fakeBook(), chunks(text, size), { cap: 12 });
    assert.equal(plainText(r.segments), kept, `chunks of ${size}`);
    assert.equal(r.stream.shown(), kept);
    assert.ok(plainLength(r.stream.shown()) <= 12);
    assert.deepEqual(r.sentences, ['第一句话。', '第二句话。']);
    assert.equal(r.stream.sentences(), 2);
  }

  // a sentence that ends exactly at the cap is shown; one character more and it is not
  assert.equal(plainText(run(fakeBook(), chunks(text, 2), { cap: 18 }).segments), text);
  assert.equal(plainText(run(fakeBook(), chunks(text, 2), { cap: 17 }).segments), kept);
  assert.equal(plainText(run(fakeBook(), chunks(text, 2), { cap: 10 }).segments), kept);
  assert.equal(plainText(run(fakeBook(), chunks(text, 2), { cap: 9 }).segments), '第一句话。');

  // once stopped, nothing more is emitted
  const segments = [];
  const stream = createMarkupStream(fakeBook(), (seg) => segments.push(seg), undefined, { cap: 12 });
  for (const delta of chunks(text, 3)) stream.push(delta);
  const count = segments.length;
  stream.push('短句。');
  stream.finish(text + '短句。');
  assert.equal(segments.length, count);
  assert.equal(stream.shown(), kept);

  // no sentence end before the cap: cut at the cap, followed by ……
  const long = '这一句话特别特别长没有句号也不停下来';
  for (const size of [1, 4, 100]) {
    const r = run(fakeBook(), chunks(long, size), { cap: 6 });
    assert.equal(plainText(r.segments), '这一句话特别……', `chunks of ${size}`);
    assert.equal(r.stream.shown(), '这一句话特别……');
  }
  // a text within the cap is shown whole, with no mark, whether or not it ends with a full stop
  assert.equal(plainText(run(fakeBook(), chunks(long, 4), { cap: 18 }).segments), long);
  assert.equal(plainText(run(fakeBook(), ['走得稳。还可以'], { cap: 7 }).segments), '走得稳。还可以');
  assert.equal(plainText(run(fakeBook(), ['走得稳。还可以再想'], { cap: 7 }).segments), '走得稳。');

  // brackets do not count; a move counts as its notation and is never split
  const withMove = '【马7进5】吃炮。先看保镖。';                                  // 4 + 3 = 7, then 5 more
  assert.equal(run(BOOK(), chunks(withMove, 3), { cap: 7 }).stream.shown(), '【马7进5】吃炮。');
  assert.equal(run(BOOK(), chunks(withMove, 3), { cap: 12 }).stream.shown(), withMove);
  assert.equal(run(BOOK(), chunks(withMove, 3), { cap: 11 }).stream.shown(), '【马7进5】吃炮。');
  assert.equal(run(BOOK(), chunks('走【马7进5】吃炮。', 3), { cap: 3 }).stream.shown(), '走……');
  const held = run(BOOK(), chunks('好。再走【马7进5】吃掉它的炮。', 2), { cap: 9 });      // the second sentence is 2 + 4 + 6 = 12
  assert.equal(held.stream.shown(), '好。');
  assert.equal(held.segments.filter((s) => s.type === 'move').length, 0);
  // a later sentence that ends on a move exactly at the cap is shown; one character less room and it is not
  assert.equal(run(BOOK(), chunks('好。走【马7进5】', 2), { cap: 7 }).stream.shown(), '好。走【马7进5】');
  assert.equal(run(BOOK(), chunks('好。走【马7进5】', 2), { cap: 6 }).stream.shown(), '好。');

  // finish(fullText) replaces the buffer by the authoritative text and emits what is still due under the same cap
  let r = run(fakeBook(), [], { cap: 12 }, text);
  assert.equal(plainText(r.segments), kept);
  r = run(fakeBook(), ['第一句'], { cap: 12 }, text);
  assert.equal(plainText(r.segments), kept);
  assert.equal(plainText(r.segments.slice(0, r.beforeFinish)), '第一句', 'the first sentence streams as it arrives');
  r = run(fakeBook(), ['第一句话。第二'], { cap: 12 }, text);
  assert.equal(plainText(r.segments), kept);
  r = run(fakeBook(), [], { cap: 6 }, long);
  assert.equal(plainText(r.segments), '这一句话特别……');
  r = run(fakeBook(), [], { cap: 100 }, text);
  assert.equal(plainText(r.segments), text);

  // with a cap, the first sentence is emitted as it arrives and a later one when it is complete
  const live = [];
  const s2 = createMarkupStream(fakeBook(), (seg) => live.push(seg), undefined, { cap: 30 });
  s2.push('第一');
  assert.equal(plainText(live), '第一');
  s2.push('句话。第二');
  assert.equal(plainText(live), '第一句话。');
  s2.push('句话。');
  assert.equal(plainText(live), '第一句话。第二句话。');
  s2.push('尾巴');
  assert.equal(plainText(live), '第一句话。第二句话。');
  s2.finish();
  assert.equal(plainText(live), '第一句话。第二句话。尾巴');

  // without a cap everything is emitted as it arrives
  const eager = [];
  const s3 = createMarkupStream(fakeBook(), (seg) => eager.push(seg));
  s3.push('第一句话。第二');
  assert.equal(plainText(eager), '第一句话。第二');
  s3.push('句');
  assert.equal(plainText(eager), '第一句话。第二句');
});

test('onSentence fires once per sentence with brackets stripped', () => {
  const text = '对方会走【马7进5】把炮吃掉！你看到了吗？吃子前先看保镖。';
  const expected = ['对方会走马7进5把炮吃掉！', '你看到了吗？', '吃子前先看保镖。'];
  for (const opts of [undefined, { cap: 100 }]) {
    for (const size of [1, 3, 8, 100]) {
      const r = run(BOOK(), chunks(text, size), opts);
      assert.deepEqual(r.sentences, expected, `chunks of ${size}`);
      assert.equal(r.stream.sentences(), 3);
      assert.ok(r.sentences.every((s) => !/[【】]/.test(s)));
    }
  }

  // it fires when the sentence end arrives, not before
  const sentences = [];
  const stream = createMarkupStream(BOOK(), () => {}, (s) => sentences.push(s));
  stream.push('好棋');
  assert.deepEqual(sentences, []);
  assert.equal(stream.sentences(), 0);
  stream.push('！对方');
  assert.deepEqual(sentences, ['好棋！']);
  assert.equal(stream.sentences(), 1);
  stream.push('难受了');
  // a last sentence without an end mark is delivered by finish()
  stream.finish();
  assert.deepEqual(sentences, ['好棋！', '对方难受了']);
  assert.equal(stream.sentences(), 2);

  // the sentence ends are 。！？ (section 4.12 rule 6): half-width marks end nothing
  assert.deepEqual(run(fakeBook(), ['好棋! 对吧? 嗯.', '再来。']).sentences, ['好棋! 对吧? 嗯.再来。']);

  // repeated end marks and a closing quote belong to the sentence they follow: no empty sentence
  let r = run(fakeBook(), ['真的吗？！他说：“好棋！”就这样。']);
  assert.deepEqual(r.sentences, ['真的吗？', '他说：“好棋！', '就这样。']);
  assert.equal(plainText(r.segments), '真的吗？！他说：“好棋！”就这样。');
  // an unresolved notation is part of its sentence as plain text
  withWarnings(() => { r = run(fakeBook(), ['走【车五进九】吧。']); });
  assert.deepEqual(r.sentences, ['走车五进九吧。']);
  // the callback is optional
  const quiet = createMarkupStream(BOOK(), () => {});
  quiet.push('好棋。');
  quiet.finish();
  assert.equal(quiet.sentences(), 1);
  // the sentence cut at the cap is delivered too, without the mark
  r = run(fakeBook(), ['这一句话特别特别长没有句号'], { cap: 6 });
  assert.deepEqual(r.sentences, ['这一句话特别']);

  // a sentence is announced after its segments were handed over: a listener never hears of text that is not on its way to the screen
  for (const opts of [undefined, { cap: 100 }]) {
    const order = [];
    const ordered = createMarkupStream(BOOK(), (seg) => order.push(seg.type === 'move' ? `<${seg.notation}>` : seg.text),
      (s) => order.push(`sentence: ${s}`), opts);
    ordered.push('好棋。对方会走【马7进5】吃炮！然后');
    ordered.finish();
    assert.deepEqual(order, ['好棋。', 'sentence: 好棋。', '对方会走', '<马7进5>', '吃炮！', 'sentence: 对方会走马7进5吃炮！', '然后', 'sentence: 然后']);
  }
});

test('an unmatched bracket is held for ten characters, then flushed as plain text without the bracket', () => {
  const segments = [];
  const stream = createMarkupStream(fakeBook(), (seg) => segments.push(seg));
  stream.push('看【这里没有右括号');                   // seven characters after the bracket
  assert.equal(plainText(segments), '看');
  stream.push('啊呀');                               // nine: still held, the closing bracket may yet arrive
  assert.equal(plainText(segments), '看');
  assert.equal(stream.shown(), '看');
  stream.push('一');                                 // the tenth: flushed, the bracket dropped
  assert.equal(plainText(segments), '看这里没有右括号啊呀一');
  stream.push('二三。');
  stream.finish();
  assert.equal(plainText(segments), '看这里没有右括号啊呀一二三。');
  assert.ok(segments.every((s) => s.type === 'text'));

  // a bracket that is still open when the text ends
  assert.equal(plainText(run(fakeBook(), ['走【马7']).segments), '走马7');
  // a closing bracket that comes too late is not a match: both brackets go, the words stay
  withWarnings(() => { assert.equal(plainText(run(fakeBook(), ['走【这一步棋实在是太长太长了】吧']).segments), '走这一步棋实在是太长太长了吧'); });
  // a second 【 before any 】: the first one was never closed
  const r = run(BOOK(), ['先【看，再【马7进5】。']);
  assert.deepEqual(r.segments.map((s) => (s.type === 'move' ? `<${s.notation}>` : s.text)), ['先看，再', '<马7进5>', '。']);
  // a 】 with no 【
  assert.equal(plainText(run(fakeBook(), ['好棋】。']).segments), '好棋。');
  // nine characters between the brackets are still a bracket (and no notation)
  const nine = fakeBook();
  withWarnings(() => run(nine, ['【一二三四五六七八九】']));
  assert.deepEqual(nine.calls[0], ['lookup', '一二三四五六七八九']);
});

test('finish(fullText) continues from what was shown: no character twice, none lost', () => {
  const full = '对方会走【马7进5】把炮吃掉。吃子前先看保镖。';
  const plain = '对方会走马7进5把炮吃掉。吃子前先看保镖。';
  for (const seen of [0, 1, 4, 6, 9, 12, 16, full.length]) {
    for (const opts of [undefined, { cap: 60 }]) {
      const r = run(BOOK(), chunks(full.slice(0, seen), 3), opts, full);
      assert.equal(plainText(r.segments), plain, `after ${seen} characters`);
      assert.equal(r.segments.filter((s) => s.type === 'move').length, 1);
      assert.equal(r.stream.shown(), full);
    }
  }
  // the legs of a tool exchange arrive one after the other; the authoritative text joins them with a line break (section 7.3)
  let r = run(BOOK(), ['让亮摆一摆。', '对方会走【马7进5】。'], undefined, '让亮摆一摆。\n对方会走【马7进5】。');
  assert.equal(plainText(r.segments), '让亮摆一摆。对方会走马7进5。');
  assert.equal(r.segments.filter((s) => s.type === 'move').length, 1);
  r = run(BOOK(), ['让亮摆一摆。'], undefined, '让亮摆一摆。\n对方会走【马7进5】。');
  assert.equal(plainText(r.segments), '让亮摆一摆。\n对方会走马7进5。');
  // finish() without text flushes what the deltas brought; a second finish and a late push do nothing
  const segments = [];
  const stream = createMarkupStream(BOOK(), (seg) => segments.push(seg));
  stream.push('走【马7进5】');
  stream.finish();
  stream.finish('别的话。');
  stream.push('更多。');
  assert.equal(plainText(segments), '走马7进5');
  assert.equal(stream.shown(), '走【马7进5】');
});

test('parseCoachText parses a whole string and plainText removes the brackets', () => {
  const book = BOOK();
  const segments = parseCoachText('对方多半走【马7进5】，你吃到一个卒，丢掉一个炮，算下来亏了。', book);
  assert.deepEqual(segments, [
    { type: 'text', text: '对方多半走' },
    { type: 'move', notation: '马7进5', link: REPLY_LINK },
    { type: 'text', text: '，你吃到一个卒，丢掉一个炮，算下来亏了。' },
  ]);
  assert.equal(plainText(segments), '对方多半走马7进5，你吃到一个卒，丢掉一个炮，算下来亏了。');
  assert.equal(plainText(segments).length, plainLength('对方多半走【马7进5】，你吃到一个卒，丢掉一个炮，算下来亏了。'));

  assert.deepEqual(parseCoachText('', book), []);
  assert.deepEqual(parseCoachText('这步扎实。', book), [{ type: 'text', text: '这步扎实。' }]);
  assert.deepEqual(parseCoachText('【马7进5】', book), [{ type: 'move', notation: '马7进5', link: REPLY_LINK }]);
  assert.equal(plainText([]), '');
  // a local line is not cut: there is no cap
  const long = '好。'.repeat(80);
  assert.equal(plainText(parseCoachText(long, book)), long);
});

test('display cap: the same cut however the text is split (300 seeded replies)', () => {
  // mulberry32, fixed seed
  let state = 20261110;
  const rnd = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const WORDS = ['走', '得', '稳', '对', '方', '想', '吃', '炮', '先', '看', '保', '镖', '，', '、'];
  const ENDS = ['。', '！', '？'];
  const len = (tokens) => tokens.reduce((n, tk) => n + [...tk.plain].length, 0);

  /** Section 4.12 rule 7, computed on the whole reply. */
  const reference = (tokens, cap) => {
    if (len(tokens) <= cap) return tokens.map((tk) => tk.markup).join('');
    let lastEnd = -1;
    tokens.forEach((tk, k) => { if (tk.end && len(tokens.slice(0, k + 1)) <= cap) lastEnd = k; });
    if (lastEnd >= 0) return tokens.slice(0, lastEnd + 1).map((tk) => tk.markup).join('');
    let fit = 0;
    while (len(tokens.slice(0, fit + 1)) <= cap) fit++;
    return tokens.slice(0, fit).map((tk) => tk.markup).join('') + '……';
  };

  let cuts = 0;
  let marks = 0;
  for (let n = 0; n < 300; n++) {
    const tokens = [];
    const sentences = 1 + Math.floor(rnd() * 4);
    for (let s = 0; s < sentences; s++) {
      const words = 1 + Math.floor(rnd() * 9);
      for (let w = 0; w < words; w++) {
        if (rnd() < 0.12) tokens.push({ plain: '马7进5', markup: '【马7进5】', end: false });
        else { const ch = pick(WORDS); tokens.push({ plain: ch, markup: ch, end: false }); }
      }
      if (s < sentences - 1 || rnd() < 0.7) { const ch = pick(ENDS); tokens.push({ plain: ch, markup: ch, end: true }); }
    }
    const text = tokens.map((tk) => tk.markup).join('');
    const cap = 1 + Math.floor(rnd() * 30);
    const expected = reference(tokens, cap);
    if (expected !== text) cuts++;
    if (expected.endsWith('……')) marks++;
    assert.ok(plainLength(expected.replace(/……$/, '')) <= cap);

    for (const size of [1, 2, 3, 5, 8, 1000]) {
      const r = run(BOOK(), chunks(text, size), { cap });
      assert.equal(r.stream.shown(), expected, `reply ${n}, cap ${cap}, chunks of ${size}: ${text}`);
      assert.equal(plainText(r.segments), expected.replace(/[【】]/g, ''));
    }
    // and when only a part was streamed before the authoritative text arrived
    const seen = Math.floor(rnd() * (text.length + 1));
    const r = run(BOOK(), chunks(text.slice(0, seen), 3), { cap }, text);
    assert.equal(r.stream.shown(), expected, `reply ${n}, cap ${cap}, finish after ${seen}: ${text}`);
    // without a cap nothing is ever cut
    assert.equal(run(BOOK(), chunks(text, 3)).stream.shown(), text);
  }
  assert.ok(cuts > 60 && marks > 15 && cuts < 290, `the sample exercises both kinds of cut (${cuts} cut, ${marks} with the mark)`);
});
