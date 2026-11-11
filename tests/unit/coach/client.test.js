// tests/unit/coach/client.test.js (C4) — the conversation with the strategist in the browser: contract sections 4.17, 7.2, 7.3, 7.5–7.7.
//
// The proxy is tests/helpers/fake-fetch.js: real Response objects with scripted SSE bodies, signed with the real signer, and
// in strict mode a check of every POST body the way the proxy checks it (C1's validator, signatures, resume token). Time is a
// virtual clock. A local sentence is never compared with a literal: the expected text is what composeLocal / localLine /
// composeToolReply of fallback.js give for the events the proxy would see, so a change of wording there does not touch
// these tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createCoachClient } from '../../../src/coach/client.js';
import { createMoveBook } from '../../../src/coach/book.js';
import { composeLocal, composeToolReply, localLine } from '../../../src/coach/fallback.js';
import { CAPS, LIMITS, canonicalJson, plainLength, sanitizeSay, validateCoachRequest } from '../../../src/coach/protocol.js';
import { ASK_CODES, CUE } from '../../../src/core/codes.js';
import { applyMove, createInitialBoard, fenToBoard } from '../../../src/core/engine.js';
import { fromMoveCode, toLine } from '../../../src/core/notation.js';
import { sha256Hex } from '../../../server/sign.js';
import { createFakeFetch } from '../../helpers/fake-fetch.js';
import { createVirtualTimers, tick } from '../../helpers/fake-worker.js';
import { mulberry32 } from '../../helpers/playout.js';
import { COACH_EXAMPLE_POSITIONS } from '../../helpers/positions.js';

// ---------------------------------------------------------------------------------------------------------------------
// Packets: the worked example of section 9.5 (after 1. 炮二平五 马8进7 the child, red, tries 炮五进四)
// ---------------------------------------------------------------------------------------------------------------------

const fixture = (name) => JSON.parse(readFileSync(new URL(`../../fixtures/coach/${name}`, import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const F = {
  held: fixture('try-held-ask.json'), plain: fixture('try.json'), hint: fixture('hint.json'), over: fixture('over.json'),
  resume: fixture('ask-free-resume.json'), failed: fixture('ask-free-resume-failed.json'),
};
const TURN = F.held.turn;
/** The held trial 炮五进四 and what its first packet withholds. */
const HELD = F.held.events[1].try;
const MORE = F.held.events[2].more;
/** An ordinary trial, 马二进三 (section 9.6); nothing better exists. */
const PLAIN = F.plain.events[1].try;
const NO_BETTER = { better: [] };
const HINTS = F.hint.events.slice(1).map((ev) => ev.hint);
/** The tool exchange of section 9.7. */
const TOOL_INPUT = { notation: '炮2平5', after: ['马二进三'] };
const VERDICT = F.resume.resume.results[0].verdict;
const FREE_SAY = '如果我走马二进三，对方走炮2平5呢？';

const EXAMPLE = COACH_EXAMPLE_POSITIONS.horseReply;
const BASE = fenToBoard(EXAMPLE.fen);
/** A book that holds every notation of the packets above, as the packet builders register them. */
function newBook() {
  const book = createMoveBook({ board: BASE.board, turn: BASE.turn });
  const afterTrial = applyMove(BASE.board, fromMoveCode(EXAMPLE.trial));
  const start = createInitialBoard();
  book.add('mine', toLine(start, 'red', [fromMoveCode(EXAMPLE.moves[0])]));                                              // 炮二平五
  book.add('opp', toLine(applyMove(start, fromMoveCode(EXAMPLE.moves[0])), 'black', [fromMoveCode(EXAMPLE.moves[1])]));   // 马8进7
  book.add('try', toLine(BASE.board, 'red', [fromMoveCode(EXAMPLE.trial)]));                                             // 炮五进四
  book.add('reply', toLine(afterTrial, 'black', [fromMoveCode(EXAMPLE.refutation), fromMoveCode('9172'), fromMoveCode('0122')]));   // 马7进5 马八进七 马2进3
  book.add('better', toLine(BASE.board, 'red', [fromMoveCode(EXAMPLE.best), fromMoveCode('0807'), fromMoveCode('9897')]));          // 马二进三 车9平8 车一平二
  return book;
}
/** What the tool executor of ports.js does with the call of section 9.7: it registers the analysed line. */
function registerToolLine(book) {
  book.add('tool', toLine(BASE.board, 'red', [fromMoveCode('9776'), fromMoveCode('2124')]));                           // 马二进三 炮2平5
}

// ---------------------------------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------------------------------

/** Lets every pending promise callback run, also chains that cross several turns of the event loop. */
async function settle() {
  await tick();
  await tick();
  await tick();
}

/** Real time one test may take. Time in the tests is virtual: a test that waits this long waits for a reply that never ends. */
const LIMIT = { timeout: 30_000 };

/** Unhandled rejections of the whole file: there must be none. */
const unhandled = [];
process.on('unhandledRejection', (err) => { unhandled.push(err); });

/**
 * A client on a virtual clock with a fake proxy. `forceLocal` of the options is a getter over `s.force` (CONTRACT-NOTES item 83).
 * @param {{apiBase?: string|null, timeouts?: object}} [opts]
 */
function setup(opts = {}) {
  const timers = createVirtualTimers(1_800_000_000_000);
  const fake = createFakeFetch({ setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  const tool = { calls: [], impl: async () => ({ ok: false, error: 'busy' }) };
  const s = {
    timers, fake, tool, force: false, modes: [],
    advance: async (ms = 0) => {
      await timers.advanceAsync(ms);
      await settle();
    },
  };
  const options = {
    apiBase: 'apiBase' in opts ? opts.apiBase : '/api',
    get forceLocal() { return s.force; },
    fetch: fake.fetch,
    tools: {
      analyzeMove(input, ctx) {
        tool.calls.push({ input, ctx });
        return tool.impl(input, ctx);
      },
    },
    timeouts: opts.timeouts,
    now: timers.now, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  };
  s.client = createCoachClient(options);
  s.client.onMode((m) => s.modes.push(m));
  /** Probes the fake proxy. The mode changes recorded up to here (the proxy reporting that free text is on) are dropped. */
  s.online = async () => {
    await s.client.probe();
    await settle();
    assert.equal(s.client.status(), 'online');
    s.modes.length = 0;
  };
  return s;
}

/** Handlers that record every call. `shown()` is what is on screen: the segments since the last reset, in coach markup. */
function recorder() {
  const log = [];
  return {
    log,
    handlers: {
      onStart: (x) => log.push(['start', x.cue]),
      onSegment: (seg) => log.push(['segment', seg]),
      onSentence: (text) => log.push(['sentence', text]),
      onReset: () => log.push(['reset']),
      onTool: (t) => log.push(['tool', t]),
      onEnd: (r) => log.push(['end', r]),
    },
    names: () => log.map((entry) => entry[0]),
    count: (name) => log.filter((entry) => entry[0] === name).length,
    shown() {
      let text = '';
      for (const [name, x] of log) {
        if (name === 'reset') text = '';
        else if (name === 'segment') text += x.type === 'move' ? `【${x.notation}】` : x.text;
      }
      return text;
    },
    sentences: () => log.filter((entry) => entry[0] === 'sentence').map((entry) => entry[1]),
  };
}

/**
 * The test's own record of the last three local lines (section 4.17), so that the expected sentence is chosen by localLine
 * with the same `recent` list the client must be using.
 */
function narrator() {
  const recent = [];
  return {
    /** The local line for the last event of `events`; counts as spoken. */
    line(turn, events) {
      const line = localLine(turn, events, recent);
      if (line.text !== '') {
        recent.push(`${line.row}:${line.v}`);
        while (recent.length > 3) recent.shift();
      }
      return line;
    },
    /** A local line that was spoken without localLine (the refusal line). */
    note(key) {
      recent.push(key);
      while (recent.length > 3) recent.shift();
    },
  };
}

/** Runs `fn` with console.error and console.warn recorded instead of printed. */
async function quiet(fn) {
  const { error, warn } = console;
  const said = { errors: [], warnings: [] };
  console.error = (...args) => { said.errors.push(args.map(String).join(' ')); };
  console.warn = (...args) => { said.warnings.push(args.map(String).join(' ')); };
  try {
    await fn(said);
  } finally {
    console.error = error;
    console.warn = warn;
  }
  return said;
}

const lastBody = (s) => s.fake.coachCalls().at(-1).json;
const OPP_SILENT = { i: 0, kind: 'opp', said: 'none' };
/** An SSE delta step. */
const delta = (t) => ({ event: 'delta', data: { t } });
/** One tool call as the proxy announces it. */
const toolCall = (id, input = TOOL_INPUT) => ({ id, name: 'analyze_move', input });
/** A leg that ends with a tool event. */
const toolLeg = (fake, calls, before = []) => (call) => ({ steps: [fake.OPEN, ...before, { event: 'tool', data: fake.toolData(call, calls) }] });

// ---------------------------------------------------------------------------------------------------------------------
// The tests of section 14.2
// ---------------------------------------------------------------------------------------------------------------------

test("streams segments and resolves with source 'llm'; event.reply is stored with its signature", LIMIT, async () => {
  const s = setup();
  await s.online();
  const book = newBook();
  const thread = s.client.beginTurn(TURN, book);
  assert.equal(thread.kind, 'turn');
  assert.equal(s.fake.coachCalls().length, 0, 'beginTurn sends no request');

  const text = '对方跳马出动，顺手护住了中卒。';
  s.fake.enqueue(s.fake.say(text, { size: 5, gap: 100 }));
  const rec = recorder();
  const reply = thread.open({ kind: 'opp' }, 'auto', rec.handlers);
  assert.deepEqual(rec.log, [['start', null]], 'onStart fires at once, before any network');
  assert.equal(thread.busy(), true);

  await s.advance(0);
  assert.equal(rec.shown(), '对方跳马出', 'text is handed over as it arrives');
  await s.advance(100);
  assert.equal(rec.shown(), '对方跳马出动，顺手护');
  assert.equal(rec.count('end'), 0);
  await s.advance(100);
  const result = await reply.done;
  assert.equal(result.aborted, false);
  assert.equal(result.source, 'llm');
  assert.equal(result.text, text);
  assert.equal(result.cut, false);
  assert.equal(result.refused, false);
  assert.deepEqual(result.usage, { in: 0, cached: 0, out: 15 });
  assert.equal(rec.shown(), text);
  assert.deepEqual(result.segments, rec.log.filter((entry) => entry[0] === 'segment').map((entry) => entry[1]));
  assert.deepEqual(rec.sentences(), [text]);
  assert.deepEqual(rec.log.at(-1), ['end', result]);
  assert.equal(rec.count('end'), 1);
  assert.equal(thread.busy(), false);

  // the request: the turn and the thread, nothing else
  const first = s.fake.coachCalls()[0];
  assert.equal(first.url, '/api/coach');
  assert.equal(first.headers['content-type'], 'application/json');
  assert.deepEqual(first.json, { v: 1, turn: TURN, events: [{ i: 0, kind: 'opp' }] });
  assert.equal(first.state, 'closed');

  // a bracket that arrives in two deltas is one move segment, resolved through the book
  s.fake.enqueue(s.fake.say('对方会走【马7进5】吃炮。', { size: 6 }));
  const rec2 = recorder();
  thread.tryMove(HELD, MORE, 'silent', {});
  const second = await (async () => {
    const r = thread.ask('reply', undefined, rec2.handlers);
    await s.advance(0);
    return r.done;
  })();
  assert.equal(second.source, 'llm');
  assert.equal(second.text, '对方会走【马7进5】吃炮。');
  assert.deepEqual(second.segments.slice(0, 2).map((seg) => seg.type), ['text', 'move']);
  assert.equal(second.segments.filter((seg) => seg.type === 'move').length, 1);
  assert.deepEqual(second.segments[1], { type: 'move', notation: '马7进5', link: book.lookup('马7进5') });
  assert.equal(rec2.shown(), second.text);

  // the earlier event travels with the reply and the signature the proxy gave for it
  const events = lastBody(s).events;
  assert.equal(events[0].said, 'llm');
  assert.deepEqual(events[0].reply, {
    text,
    sig: s.fake.signer.signReply({ turnHash: sha256Hex(canonicalJson(TURN)), i: 0, kind: 'opp' }, text),
  });
  assert.deepEqual(s.fake.violations, []);
  assert.deepEqual(s.client.stats(), { requests: 2, llm: 2, local: 0, ungrounded: 0, overCap: 0, refused: 0, failures: 0 });
});

test("mode 'silent' records the event with said 'none' and calls no handler", LIMIT, async () => {
  const s = setup();
  await s.online();
  const thread = s.client.beginTurn(TURN, newBook());
  const rec = recorder();
  const reply = thread.open({ kind: 'opp' }, 'silent', rec.handlers);
  assert.deepEqual(await reply.done, { aborted: false, text: '', segments: [], source: 'none', cut: false, refused: false });
  assert.equal(thread.busy(), false);
  const tried = thread.tryMove(PLAIN, NO_BETTER, 'silent', rec.handlers);
  assert.equal((await tried.done).source, 'none');
  assert.deepEqual(thread.activeTry(), PLAIN);
  await s.advance(5000);
  assert.deepEqual(rec.log, [], 'no handler is called');
  assert.equal(s.fake.coachCalls().length, 0, 'nothing is sent');

  thread.ask('good', undefined, {});
  await s.advance(0);
  assert.deepEqual(lastBody(s).events, [
    { i: 0, kind: 'opp', said: 'none' },                                   // no cue: the field is left out, never null
    { i: 1, kind: 'try', n: 1, try: PLAIN, said: 'none' },
    { i: 2, kind: 'ask', ask: 'good' },
  ]);
  assert.deepEqual(s.fake.violations, []);
});

test("mode 'local' shows the cue, emits the local line and stores v", LIMIT, async () => {
  const s = setup();
  await s.online();
  const book = newBook();
  const thread = s.client.beginTurn(TURN, book);
  const tell = narrator();
  thread.open({ kind: 'opp' }, 'silent', {});

  const rec = recorder();
  const reply = thread.tryMove(HELD, MORE, 'local', rec.handlers, { flags: { voiced: true } });
  // everything happened inside the call: the local narrator answers at once
  const expected = tell.line(TURN, [OPP_SILENT, { i: 1, kind: 'try', n: 1, try: HELD, cue: 'wait' }]);
  assert.notEqual(expected.text, '');
  assert.deepEqual(rec.names().slice(0, 2), ['start', 'segment']);
  assert.deepEqual(rec.log[0], ['start', CUE.wait]);
  assert.equal(rec.shown(), expected.text);
  assert.equal(rec.names().at(-1), 'end');
  assert.equal(rec.count('sentence') >= 1, true, 'onSentence fires for a local line too');
  assert.equal(thread.busy(), false);
  const result = await reply.done;
  assert.deepEqual(result, { aborted: false, text: expected.text, segments: result.segments, source: 'local', cut: false, refused: false });
  assert.equal(s.fake.coachCalls().length, 0);

  // a question with nothing to say: said 'none', no v
  s.force = true;
  const rec3 = recorder();
  const silent = await thread.ask('next', undefined, rec3.handlers).done;
  assert.equal(composeLocal(TURN, [OPP_SILENT, { i: 1, kind: 'try', n: 1, try: HELD, cue: 'wait' }, { i: 2, kind: 'ask', ask: 'next' }], 0), '',
    'the local narrator has nothing to say about `next` during a game');
  assert.deepEqual(silent, { aborted: false, text: '', segments: [], source: 'none', cut: false, refused: false });
  assert.deepEqual(rec3.names(), ['start', 'end']);
  s.force = false;

  // what the proxy receives: the cue, said 'local' and the variant, from which it re-creates the sentence
  thread.ask('reply', undefined, {});
  await s.advance(0);
  const events = lastBody(s).events;
  assert.deepEqual(events[1], { i: 1, kind: 'try', n: 1, try: HELD, cue: 'wait', said: 'local', v: expected.v });
  assert.equal(composeLocal(TURN, events.slice(0, 2), events[1].v), expected.text);
  assert.deepEqual(events[2], { i: 2, kind: 'ask', ask: 'next', said: 'none' }, 'no v unless said is local');
  assert.deepEqual(events[3], { i: 3, kind: 'ask', ask: 'reply', more: MORE });
  assert.deepEqual(s.fake.violations, []);

  // the cue is set before the local line is composed (the draw sentence of the narrator depends on it)
  const overTurn = F.over.turn;
  const draw = { ...clone(F.over.events[0].over), result: 'draw', reason: 'repetition' };
  const over = s.client.beginOver(overTurn, newBook());
  assert.equal(over.kind, 'over');
  const rec4 = recorder();
  await quiet(async () => {
    await over.open({ kind: 'over', over: draw }, 'local', rec4.handlers).done;
  });
  const drawLine = tell.line(overTurn, [{ i: 0, kind: 'over', over: draw, cue: 'draw' }]);
  assert.deepEqual(rec4.log[0], ['start', CUE.draw]);
  assert.equal(rec4.shown(), drawLine.text.replace(/[【】]/g, ''), 'notations of another position are shown without brackets');
});

test('no first text within 2000 ms on a try gives the local line; within 3500 ms on an ask', LIMIT, async () => {
  // a try: the proxy opens the stream and then says nothing
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    s.fake.enqueue({ steps: [s.fake.OPEN, { hang: true }] });
    const rec = recorder();
    const reply = thread.tryMove(PLAIN, NO_BETTER, 'auto', rec.handlers);
    await s.advance(1999);
    assert.deepEqual(rec.names(), ['start'], 'typing dots only, up to 2.0 s');
    await s.advance(1);
    const result = await reply.done;
    const expected = localLine(TURN, [OPP_SILENT, { i: 1, kind: 'try', n: 1, try: PLAIN }], []);
    assert.notEqual(expected.text, '');
    assert.equal(result.source, 'local');
    assert.equal(result.text, expected.text);
    assert.deepEqual(rec.names().slice(0, 2), ['start', 'reset']);
    assert.equal(rec.shown(), expected.text);
    assert.equal(rec.names().at(-1), 'end');
    const call = s.fake.coachCalls()[0];
    assert.equal(call.aborted, true, 'the request is aborted');
    assert.equal(s.fake.openStreams(), 0);
    assert.equal(s.timers.pending(), 0, 'no timer is left');
    await s.advance(30000);
    assert.equal(rec.count('end'), 1, 'one event, one visible reply');
    assert.equal(s.fake.coachCalls().length, 1, 'no retry');
    assert.equal(s.client.status(), 'online', 'one time-out does not trip the breaker');
  }
  // a try whose response never comes at all: the limit counts from the POST
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    s.fake.enqueue({ hang: true });
    const rec = recorder();
    const reply = thread.open({ kind: 'opp' }, 'auto', rec.handlers);
    await s.advance(1999);
    assert.deepEqual(rec.names(), ['start']);
    await s.advance(1);
    assert.equal((await reply.done).source, 'local');
    assert.equal(s.fake.pendingRequests(), 0);
  }
  // a question gets 3500 ms
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    s.fake.enqueue({ steps: [s.fake.OPEN, { wait: 60000 }, delta('太晚了。')] });
    const rec = recorder();
    const reply = thread.ask('intent', undefined, rec.handlers);
    await s.advance(3499);
    assert.deepEqual(rec.names(), ['start']);
    await s.advance(1);
    const result = await reply.done;
    const expected = localLine(TURN, [OPP_SILENT, { i: 1, kind: 'ask', ask: 'intent' }], []);
    assert.equal(result.source, 'local');
    assert.equal(result.text, expected.text);
    assert.equal(rec.shown(), expected.text);
    await s.advance(60000);
    assert.equal(rec.count('end'), 1);
    assert.equal(s.fake.pendingTimers(), 0, 'the abandoned stream is gone');
  }
  // text that starts in time is not cut off: 1900 ms on a try, 3400 ms on a pouch
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    s.fake.enqueue(s.fake.say('走得稳。', { first: 1900 }), s.fake.say('看看右翼。', { first: 3400 }));
    const tried = thread.tryMove(PLAIN, NO_BETTER, 'auto', {});
    await s.advance(1900);
    assert.equal((await tried.done).source, 'llm');
    const hinted = thread.hint(1, HINTS[0], 'auto', {});
    await s.advance(3400);
    assert.equal((await hinted.done).source, 'llm');
  }
});

test("#cut after a full sentence keeps the sentence (source 'mixed'); #cut before any sentence gives the local line after onReset", LIMIT, async () => {
  const s = setup();
  await s.online();
  const thread = s.client.beginTurn(TURN, newBook());
  thread.open({ kind: 'opp' }, 'silent', {});

  // two whole sentences, then the stream closes in the middle of the third, without a terminal event
  s.fake.enqueue({ steps: [s.fake.OPEN, delta('中卒看着好吃，'), delta('可它有马保着。'), delta('吃子前先'), { close: true }] });
  const rec = recorder();
  const reply = thread.ask('intent', undefined, rec.handlers);
  await s.advance(0);
  const result = await reply.done;
  assert.equal(result.source, 'mixed');
  assert.equal(result.cut, true);
  assert.equal(result.text, '中卒看着好吃，可它有马保着。');
  assert.equal(rec.shown(), '中卒看着好吃，可它有马保着。', 'whole sentences stay, the tail is dropped, nothing is appended');
  assert.equal(rec.count('reset'), 0);
  assert.equal(rec.count('end'), 1);

  // (a reply that succeeds between the failures keeps the breaker out of this test)
  const fine = async (code) => {
    const ok = thread.ask(code, undefined, {});
    await s.advance(0);
    assert.equal((await ok.done).source, 'llm');
  };
  await fine('last');

  // the stream closes before any sentence is complete
  s.fake.enqueue({ steps: [s.fake.OPEN, delta('中卒看着'), { close: true }] });
  const rec2 = recorder();
  const reply2 = thread.ask('score', undefined, rec2.handlers);
  await s.advance(0);
  const result2 = await reply2.done;
  const before = lastBody(s).events;                                           // the thread as the proxy saw it, the question last
  const expected = localLine(TURN, before, []);
  assert.notEqual(expected.text, '');
  assert.equal(result2.source, 'local');
  assert.equal(result2.cut, false);
  assert.equal(result2.text, expected.text);
  assert.deepEqual(rec2.names().slice(0, 3), ['start', 'segment', 'reset'], 'the half sentence is taken back');
  assert.equal(rec2.shown(), expected.text);
  await fine('danger');

  // the same when the connection breaks instead of closing
  s.fake.enqueue({ steps: [s.fake.OPEN, delta('中卒看着好吃。'), delta('可它'), { wait: 300 }, { drop: true }] });
  const rec3 = recorder();
  const reply3 = thread.ask('intent', undefined, rec3.handlers);
  await s.advance(300);
  assert.equal((await reply3.done).source, 'mixed');
  assert.equal(rec3.shown(), '中卒看着好吃。');
  assert.equal(rec3.count('reset'), 0);

  // the cut replies are recorded as said 'none'; the local one with its variant
  await fine('last');
  const events = lastBody(s).events;
  assert.deepEqual(events[1], { i: 1, kind: 'ask', ask: 'intent', said: 'none' });
  assert.deepEqual(events[3], { i: 3, kind: 'ask', ask: 'score', said: 'local', v: expected.v });
  assert.deepEqual(events[5], { i: 5, kind: 'ask', ask: 'intent', said: 'none' });
  assert.deepEqual(s.fake.violations, []);
});

test('refused: onReset, the kind fixed line for a free ask, and the breaker does not move', LIMIT, async () => {
  const s = setup();
  await s.online();
  const thread = s.client.beginTurn(TURN, newBook());
  const tell = narrator();
  thread.open({ kind: 'opp' }, 'silent', {});
  const refusal = { steps: [s.fake.OPEN, delta('这个'), delta('问题'), delta('嘛，'), { event: 'error', data: { code: 'refused' } }] };

  // a free question: the kind fixed line (variant 1 of the free row)
  s.fake.enqueue(refusal);
  const rec = recorder();
  const reply = thread.ask('free', '你几岁了', rec.handlers);
  await s.advance(0);
  const result = await reply.done;
  const kind = composeLocal(TURN, [OPP_SILENT, { i: 1, kind: 'ask', ask: 'free', say: '你几岁了' }], 1);
  assert.notEqual(kind, '');
  assert.notEqual(kind, composeLocal(TURN, [OPP_SILENT, { i: 1, kind: 'ask', ask: 'free', say: '你几岁了' }], 0), 'not the "model failed" line');
  assert.equal(result.refused, true);
  assert.equal(result.source, 'local');
  assert.equal(result.text, kind);
  assert.deepEqual(rec.names().slice(0, 5), ['start', 'segment', 'segment', 'segment', 'reset'], 'the message is reset');
  assert.equal(rec.shown(), kind);
  assert.equal(rec.count('end'), 1);
  tell.note('ask.free:1');

  // anything else gets its local line
  s.fake.enqueue(refusal);
  const rec2 = recorder();
  const reply2 = thread.tryMove(PLAIN, NO_BETTER, 'auto', rec2.handlers);
  await s.advance(0);
  const result2 = await reply2.done;
  const line = tell.line(TURN, [OPP_SILENT, { i: 1, kind: 'ask', ask: 'free', said: 'local', v: 1 }, { i: 2, kind: 'try', n: 1, try: PLAIN }]);
  assert.equal(result2.refused, true);
  assert.equal(result2.source, 'local');
  assert.equal(result2.text, line.text);
  assert.equal(rec2.count('reset'), 1);
  assert.equal(rec2.shown(), line.text);

  // a third refusal in a row: the strategist is still switched on
  s.fake.enqueue({ steps: [s.fake.OPEN, { event: 'error', data: { code: 'refused' } }] });
  const reply3 = thread.ask('free', '再问一次', {});
  await s.advance(0);
  assert.equal((await reply3.done).refused, true);
  assert.equal(s.client.status(), 'online');
  assert.equal(s.client.mode(), 'llm');
  assert.deepEqual(s.modes, [], 'no mode change');
  assert.equal(s.client.stats().refused, 3);
  assert.equal(s.fake.coachCalls().length, 3, 'no retry');

  // the refused question is recorded as answered locally with variant 1, and travels without its say
  thread.ask('score', undefined, {});
  await s.advance(0);
  const events = lastBody(s).events;
  assert.deepEqual(events[1], { i: 1, kind: 'ask', ask: 'free', said: 'local', v: 1 });
  assert.deepEqual(events[2], { i: 2, kind: 'try', n: 1, try: PLAIN, said: 'local', v: line.v });
  assert.deepEqual(s.fake.violations, []);
});

test('two counted failures switch to offline for 60 s, then a probe', LIMIT, async () => {
  const s = setup();
  await s.online();
  const thread = s.client.beginTurn(TURN, newBook());
  thread.open({ kind: 'opp' }, 'silent', {});
  const ask = async (code) => {
    const rec = recorder();
    const reply = thread.ask(code, undefined, rec.handlers);
    await s.advance(0);
    return { result: await reply.done, rec };
  };
  const fail = { status: 500, error: 'mock_fail' };

  s.fake.enqueue(fail);
  const one = await ask('intent');
  assert.equal(one.result.source, 'local', 'a failure before any text: one seamless local reply');
  assert.deepEqual(one.rec.names().slice(0, 2), ['start', 'reset']);
  assert.equal(s.client.status(), 'online');

  s.fake.enqueue({ steps: [s.fake.OPEN, { event: 'error', data: { code: 'upstream_error' } }] });
  await ask('score');
  assert.equal(s.client.status(), 'offline');
  assert.equal(s.client.offReason(), 'unreachable');
  assert.equal(s.client.mode(), 'local');
  assert.deepEqual(s.client.capabilities(), { freeText: false });
  assert.deepEqual(s.modes, [{ mode: 'local', reason: 'unreachable' }]);

  // local for 60 s: no request at all
  const posts = s.fake.coachCalls().length;
  const probes = s.fake.healthCalls().length;
  const three = await ask('danger');
  assert.equal(three.result.source, 'local');
  assert.deepEqual(three.rec.names().includes('reset'), false);
  await s.advance(59_999 - 0);
  assert.equal(s.client.status(), 'offline');
  assert.equal(s.fake.coachCalls().length, posts);
  assert.equal(s.fake.healthCalls().length, probes);

  // then a probe
  await s.advance(1);
  assert.equal(s.fake.healthCalls().length, probes + 1);
  assert.equal(s.client.status(), 'online');
  assert.deepEqual(s.modes.slice(1), [{ mode: 'llm', reason: null }]);
  assert.equal((await ask('last')).result.source, 'llm');

  // a success between two failures: the count starts again
  s.fake.enqueue(fail);
  await ask('intent');
  assert.equal((await ask('score')).result.source, 'llm');
  s.fake.enqueue(fail);
  await ask('danger');
  assert.equal(s.client.status(), 'online');

  // 60 s again after a reply that succeeded …
  s.fake.enqueue(fail);
  await ask('last');
  assert.equal(s.client.status(), 'offline');
  await s.advance(59_999);
  assert.equal(s.client.status(), 'offline');
  await s.advance(1);
  assert.equal(s.client.status(), 'online');

  // … and twice as long when none did: 120 s, then 240 s after a probe that failed
  s.fake.enqueue(fail, fail);
  await ask('intent');
  await ask('score');
  assert.equal(s.client.status(), 'offline');
  let probed = s.fake.healthCalls().length;
  s.fake.health = { status: 502, text: 'Bad Gateway' };
  await s.advance(119_999);
  assert.equal(s.fake.healthCalls().length, probed, 'no probe before 120 s');
  await s.advance(1);
  assert.equal(s.fake.healthCalls().length, probed + 1);
  assert.equal(s.client.status(), 'offline', 'a failed probe is offline as well');
  assert.equal(s.client.offReason(), 'unreachable');
  probed += 1;
  s.fake.health = { json: { ok: true, v: 1, mode: 'mock', model: 'mock', freeText: true } };
  await s.advance(239_999);
  assert.equal(s.fake.healthCalls().length, probed, 'no probe before 240 s');
  await s.advance(1);
  assert.equal(s.fake.healthCalls().length, probed + 1);
  assert.equal(s.client.status(), 'online');
  assert.equal(s.timers.pending(), 0);
  assert.deepEqual(s.fake.violations, []);
});

test('rate with retry_after pauses and does not count as a failure', LIMIT, async () => {
  const s = setup();
  await s.online();
  const thread = s.client.beginTurn(TURN, newBook());
  thread.open({ kind: 'opp' }, 'silent', {});
  const ask = async (code) => {
    const reply = thread.ask(code, undefined, {});
    await s.advance(0);
    return reply.done;
  };

  s.fake.enqueue({ status: 429, error: 'rate', retryAfter: 7 });
  assert.equal((await ask('intent')).source, 'local');
  assert.equal(s.client.status(), 'paused');
  assert.equal(s.client.offReason(), 'paused');
  assert.equal(s.client.mode(), 'local');
  assert.deepEqual(s.modes, [{ mode: 'local', reason: 'paused' }]);

  // local until then
  const posts = s.fake.coachCalls().length;
  const probes = s.fake.healthCalls().length;
  assert.equal((await ask('score')).source, 'local');
  await s.advance(6999);
  assert.equal(s.client.status(), 'paused');
  assert.equal(s.fake.coachCalls().length, posts);

  // then online without a probe
  await s.advance(1);
  assert.equal(s.client.status(), 'online');
  assert.equal(s.fake.healthCalls().length, probes);
  assert.deepEqual(s.modes.slice(1), [{ mode: 'llm', reason: null }]);

  // it did not count: one real failure after it is the first, not the second
  s.fake.enqueue({ status: 500, error: 'mock_fail' });
  assert.equal((await ask('danger')).source, 'local');
  assert.equal(s.client.status(), 'online');
  assert.equal((await ask('last')).source, 'llm');

  // without retry_after: 60 s
  s.fake.enqueue({ status: 429, error: 'rate' });
  await ask('intent');
  assert.equal(s.client.status(), 'paused');
  await s.advance(59_999);
  assert.equal(s.client.status(), 'paused');
  await s.advance(1);
  assert.equal(s.client.status(), 'online');
});

test("403 origin switches off for the session with reason 'origin'", LIMIT, async () => {
  const s = setup();
  await s.online();
  const thread = s.client.beginTurn(TURN, newBook());
  thread.open({ kind: 'opp' }, 'silent', {});
  s.fake.enqueue({ status: 403, error: 'origin' });
  const rec = recorder();
  const reply = thread.ask('intent', undefined, rec.handlers);
  await s.advance(0);
  assert.equal((await reply.done).source, 'local', 'this event is answered locally');
  assert.equal(s.client.status(), 'offline');
  assert.equal(s.client.offReason(), 'origin');
  assert.equal(s.client.mode(), 'local');
  assert.deepEqual(s.modes, [{ mode: 'local', reason: 'origin' }]);

  // for the session: no request, no probe, whatever time passes
  const total = s.fake.calls.length;
  const again = thread.ask('score', undefined, {});
  assert.equal((await again.done).source, 'local');
  await s.advance(3_600_000);
  await s.client.probe();
  await s.advance(0);
  assert.equal(s.fake.calls.length, total);
  assert.equal(s.client.offReason(), 'origin');
  assert.equal(s.timers.pending(), 0);
});

test('apiBase null never calls fetch', LIMIT, async () => {
  const s = setup({ apiBase: null });
  assert.equal(s.client.status(), 'offline');
  assert.equal(s.client.offReason(), 'no_proxy');
  assert.equal(s.client.mode(), 'local');
  assert.deepEqual(s.client.capabilities(), { freeText: false });
  await s.client.probe();

  const tell = narrator();
  const thread = s.client.beginTurn(TURN, newBook());
  const rec = recorder();
  const opened = await thread.open({ kind: 'opp' }, 'auto', rec.handlers).done;
  const oppLine = tell.line(TURN, [{ i: 0, kind: 'opp' }]);
  assert.equal(opened.text, oppLine.text);
  assert.equal(opened.source, oppLine.text === '' ? 'none' : 'local');
  await thread.hint(1, HINTS[0], 'auto', {}).done;
  await thread.tryMove(HELD, MORE, 'auto', {}).done;
  const asked = await thread.ask('reply', undefined, {}).done;
  assert.equal(asked.source, 'local');
  const free = await thread.ask('free', FREE_SAY, {}).done;
  assert.equal(free.source, 'local');
  thread.end();
  const over = s.client.beginOver(F.over.turn, newBook());
  await quiet(async () => {
    assert.equal((await over.open({ kind: 'over', over: F.over.events[0].over }, 'auto', {}).done).source, 'local');
    await over.ask('proud', undefined, {}).done;
  });
  await s.advance(700_000);
  assert.equal(s.fake.calls.length, 0);
  assert.equal(s.timers.pending(), 0);
  assert.deepEqual(s.modes, []);
});

test("tool loop: the resume POST body minus resume is byte-identical to the first leg's body", LIMIT, async () => {
  const s = setup();
  await s.online();
  const book = newBook();
  const thread = s.client.beginTurn(TURN, book);
  thread.open({ kind: 'opp' }, 'silent', {});
  s.tool.impl = async (input, ctx) => {
    registerToolLine(ctx.book);
    return { ok: true, verdict: VERDICT };
  };
  const answer = '对方走【炮2平5】也不怕，咱们【车一平二】出车，阵形照样稳。';
  s.fake.enqueue(toolLeg(s.fake, [toolCall('call_7Qm2')]), s.fake.say(answer));
  const rec = recorder();
  const reply = thread.ask('free', FREE_SAY, rec.handlers);
  await s.advance(0);
  const result = await reply.done;
  assert.equal(result.source, 'llm');
  assert.equal(result.text, answer);

  const [first, second] = s.fake.coachCalls();
  assert.equal(s.fake.coachCalls().length, 2);
  assert.equal(first.json.resume, undefined);
  // byte for byte: the second body is the first with `resume` added before the closing brace
  const marker = ',"resume":';
  assert.equal(second.body.slice(0, first.body.length - 1), first.body.slice(0, -1));
  assert.equal(second.body.slice(first.body.length - 1, first.body.length - 1 + marker.length), marker);
  const { resume, ...rest } = JSON.parse(second.body);
  assert.equal(JSON.stringify(rest), first.body);
  assert.deepEqual(resume.results, [{ id: 'call_7Qm2', ok: true, verdict: VERDICT }]);
  assert.equal(typeof resume.token, 'string');
  assert.deepEqual(first.json.events.at(-1), { i: 1, kind: 'ask', ask: 'free', say: sanitizeSay(FREE_SAY) }, 'no tools on the event before `done`');

  // the executor got the call, the thread, the book and a live signal
  assert.equal(s.tool.calls.length, 1);
  assert.deepEqual(s.tool.calls[0].input, TOOL_INPUT);
  assert.equal(s.tool.calls[0].ctx.thread, thread);
  assert.equal(s.tool.calls[0].ctx.book, book);
  assert.equal(s.tool.calls[0].ctx.signal.aborted, false);

  // the tool indicator: the notation, and where the move is for the ghost pieces
  const tools = rec.log.filter((entry) => entry[0] === 'tool').map((entry) => entry[1]);
  assert.deepEqual(tools, [
    { phase: 'start', notation: '炮2平5', link: {
      from: { row: 2, col: 1 }, to: { row: 2, col: 4 }, color: 'black', code: '2124',
      pre: [{ from: { row: 9, col: 7 }, to: { row: 7, col: 6 }, color: 'red' }], playable: false, src: 'tool',
    } },
    { phase: 'end' },
  ]);

  // after `done` the exchange is stored on the event and travels with later requests
  thread.ask('why', undefined, {});
  await s.advance(0);
  const stored = lastBody(s).events[1];
  assert.equal(stored.said, 'llm');
  assert.equal(stored.reply.text, answer);
  assert.equal('say' in stored, false);
  assert.deepEqual(stored.tools, [{ notation: '炮2平5', after: ['马二进三'], result: { id: 'call_7Qm2', ok: true, verdict: VERDICT } }]);
  assert.deepEqual(s.fake.violations, []);
  assert.equal(s.client.stats().requests, 3);
});

test("tool calls of one round run sequentially; a tool timeout is 'busy'", LIMIT, async () => {
  const s = setup();
  await s.online();
  const thread = s.client.beginTurn(TURN, newBook());
  thread.open({ kind: 'opp' }, 'silent', {});
  const started = [];
  s.tool.impl = (input, ctx) => new Promise((resolve) => { started.push({ input, ctx, resolve }); });
  const second = { notation: '马二进三', after: [] };
  s.fake.enqueue(toolLeg(s.fake, [toolCall('c1'), toolCall('c2', second)]), s.fake.say('两步都摆过了。'));
  const rec = recorder();
  const reply = thread.ask('free', FREE_SAY, rec.handlers);
  await s.advance(0);

  assert.equal(started.length, 1, 'the second call waits for the first');
  assert.deepEqual(started[0].input, TOOL_INPUT);
  await s.advance(1500);
  assert.equal(started.length, 1);
  started[0].resolve({ ok: true, verdict: VERDICT });
  await s.advance(0);
  assert.equal(started.length, 2);
  assert.deepEqual(started[1].input, second);
  assert.equal(s.fake.coachCalls().length, 1);

  // the second call never answers: 2000 ms, then `busy`, and its signal fires so the sandbox stops
  await s.advance(1999);
  assert.equal(s.fake.coachCalls().length, 1);
  assert.equal(started[1].ctx.signal.aborted, false);
  await s.advance(1);
  assert.equal(started[1].ctx.signal.aborted, true);
  assert.equal(started[0].ctx.signal.aborted, false, 'a call that answered is left alone');
  assert.equal(s.fake.coachCalls().length, 2);
  assert.deepEqual(lastBody(s).resume.results, [
    { id: 'c1', ok: true, verdict: VERDICT },
    { id: 'c2', ok: false, error: 'busy' },
  ]);
  const result = await reply.done;
  assert.equal(result.source, 'llm');
  assert.equal(rec.count('tool'), 2, 'one indicator for the round');
  started[1].resolve({ ok: true, verdict: VERDICT });                          // a late answer changes nothing
  await s.advance(0);
  assert.equal(s.fake.coachCalls().length, 2);
  assert.deepEqual(s.fake.violations, []);

  // an executor that throws, one that returns something unusable, and a call the client cannot run: `busy`, `busy`, `syntax`
  s.tool.impl = async (input) => {
    if (input.notation === '炮2平5') throw new Error('sandbox crashed');
    return { ok: true };
  };
  s.fake.enqueue(toolLeg(s.fake, [toolCall('d1'), toolCall('d2', second)]), toolLeg(s.fake, [{ id: 'd3', name: 'other_tool', input: {} }]), s.fake.say('摆不出来。'));
  const said = await quiet(async () => {
    const again = thread.ask('free', FREE_SAY, {});
    await s.advance(0);
    assert.equal((await again.done).source, 'llm');
  });
  assert.equal(said.errors.length, 1);
  assert.deepEqual(lastBody(s).resume.results, [
    { id: 'd1', ok: false, error: 'busy' },
    { id: 'd2', ok: false, error: 'busy' },
    { id: 'd3', ok: false, error: 'syntax' },
  ]);
  assert.deepEqual(s.fake.violations, []);

  // two rounds of two calls: the last leg carries all four results; the event keeps the three most recent exchanges;
  // a third call in one round is the proxy's to answer and is not run
  {
    const t = setup();
    await t.online();
    const thread2 = t.client.beginTurn(TURN, newBook());
    thread2.open({ kind: 'opp' }, 'silent', {});
    t.tool.impl = async () => ({ ok: true, verdict: VERDICT });
    t.fake.enqueue(
      toolLeg(t.fake, [toolCall('e1'), toolCall('e2', second), toolCall('e9')]),
      toolLeg(t.fake, [toolCall('e3'), toolCall('e4', second)]),
      t.fake.say('四步都摆过了。'),
    );
    await quiet(async () => {
      const reply = thread2.ask('free', FREE_SAY, {});
      await t.advance(0);
      assert.equal((await reply.done).source, 'llm');
    });
    assert.deepEqual(t.tool.calls.map((call) => call.input), [TOOL_INPUT, second, TOOL_INPUT, second]);
    assert.deepEqual(lastBody(t).resume.results.map((r) => r.id), ['e1', 'e2', 'e3', 'e4']);
    const next = thread2.ask('score', undefined, {});
    await t.advance(0);
    await next.done;
    assert.deepEqual(lastBody(t).events[1].tools.map((record) => [record.result.id, record.notation, record.after]), [
      ['e2', '马二进三', []], ['e3', '炮2平5', ['马二进三']], ['e4', '马二进三', []],
    ]);
    assert.deepEqual(t.fake.violations, []);
  }
});

test('abort invariants: after interrupt(), retract(), end() or reset() late chunks call no handler and the tool signal is aborted', LIMIT, async () => {
  const long = '中卒看着好吃，可它有马保着。吃子前先看一眼，谁在给它撑腰。';
  for (const how of ['interrupt', 'retract', 'end', 'reset']) {
    // while text is streaming
    {
      const s = setup();
      await s.online();
      const thread = s.client.beginTurn(TURN, newBook());
      thread.open({ kind: 'opp' }, 'silent', {});
      s.fake.enqueue(s.fake.say(long, { size: 4, gap: 200 }));
      const rec = recorder();
      const reply = thread.tryMove(HELD, MORE, 'auto', rec.handlers);
      await s.advance(250);
      assert.equal(rec.shown(), '中卒看着好吃，可', how);
      const before = rec.log.length;

      if (how === 'reset') s.client.reset();
      else thread[how]();
      assert.equal(thread.busy(), false, how);
      assert.deepEqual(await reply.done, { aborted: true }, how);
      await s.advance(30_000);
      assert.equal(rec.log.length, before, `${how}: no handler after the abort, not even onEnd`);
      const call = s.fake.coachCalls()[0];
      assert.equal(call.aborted, true, `${how}: the fetch is aborted`);
      assert.equal(s.fake.openStreams(), 0, `${how}: the reader is gone`);
      assert.equal(s.fake.pendingTimers(), 0, how);
      assert.equal(s.timers.pending(), 0, `${how}: no timer is left`);
      assert.deepEqual(thread.activeTry(), how === 'retract' ? null : HELD, how);

      const rec2 = recorder();
      const next = thread.ask('intent', undefined, rec2.handlers);
      await s.advance(0);
      if (how === 'interrupt' || how === 'retract') {
        // the event stays in the thread, said 'none'
        assert.equal((await next.done).source, 'llm', how);
        assert.deepEqual(lastBody(s).events[1], { i: 1, kind: 'try', n: 1, try: HELD, said: 'none' }, how);
      } else {
        // the thread is closed (end) or belongs to an earlier epoch (reset)
        assert.deepEqual(await next.done, { aborted: true }, how);
        assert.deepEqual(rec2.log, [], how);
        assert.equal(s.fake.coachCalls().length, 1, how);
        const fresh = s.client.beginTurn(TURN, newBook()).open({ kind: 'opp' }, 'auto', {});
        await s.advance(0);
        assert.equal((await fresh.done).source, 'llm', `${how}: a new thread works`);
      }
      assert.deepEqual(s.fake.violations, [], how);
    }
    // during a tool round
    {
      const s = setup();
      await s.online();
      const thread = s.client.beginTurn(TURN, newBook());
      thread.open({ kind: 'opp' }, 'silent', {});
      const started = [];
      s.tool.impl = (input, ctx) => new Promise((resolve) => { started.push({ ctx, resolve }); });
      s.fake.enqueue(toolLeg(s.fake, [toolCall('c1')], [delta('亮来摆一摆。')]));
      const rec = recorder();
      const reply = thread.ask('free', FREE_SAY, rec.handlers);
      await s.advance(500);
      assert.equal(started.length, 1, how);
      assert.equal(started[0].ctx.signal.aborted, false, how);
      const before = rec.log.length;

      if (how === 'reset') s.client.reset();
      else thread[how]();
      assert.equal(started[0].ctx.signal.aborted, true, `${how}: the tool signal is aborted`);
      assert.deepEqual(await reply.done, { aborted: true }, how);
      started[0].resolve({ ok: true, verdict: VERDICT });
      await s.advance(30_000);
      assert.equal(rec.log.length, before, how);
      assert.equal(s.fake.coachCalls().length, 1, `${how}: no resume request`);
      assert.equal(s.timers.pending(), 0, how);
    }
  }

  // the signals of the reply and of the thread abort in the same way
  for (const which of ['reply', 'thread']) {
    const s = setup();
    await s.online();
    const ctl = new AbortController();
    const thread = s.client.beginTurn(TURN, newBook(), which === 'thread' ? { signal: ctl.signal } : undefined);
    s.fake.enqueue(s.fake.say(long, { size: 4, gap: 200 }));
    const rec = recorder();
    const reply = thread.open({ kind: 'opp' }, 'auto', rec.handlers, which === 'reply' ? { signal: ctl.signal } : undefined);
    await s.advance(250);
    const before = rec.log.length;
    ctl.abort();
    assert.deepEqual(await reply.done, { aborted: true }, which);
    await s.advance(30_000);
    assert.equal(rec.log.length, before, which);
    assert.equal(s.fake.openStreams(), 0, which);
    // a signal that has already fired: the event is recorded, nothing is said
    const late = thread.ask('intent', undefined, rec.handlers, { signal: ctl.signal });
    assert.deepEqual(await late.done, { aborted: true }, which);
    assert.equal(rec.log.length, before, which);
  }

  // Reply.abort() is the same as interrupt()
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    s.fake.enqueue(s.fake.say(long, { size: 4, gap: 200 }));
    const rec = recorder();
    const reply = thread.open({ kind: 'opp' }, 'auto', rec.handlers);
    await s.advance(250);
    const before = rec.log.length;
    reply.abort();
    assert.deepEqual(await reply.done, { aborted: true });
    await s.advance(30_000);
    assert.equal(rec.log.length, before);
    reply.abort();                                                              // again: nothing happens
  }
});

test('a new send aborts the previous reply', LIMIT, async () => {
  const s = setup();
  await s.online();
  const thread = s.client.beginTurn(TURN, newBook());
  s.fake.enqueue(s.fake.say('对方跳马出动，顺手护住了中卒。', { size: 3, gap: 300 }), s.fake.say('眼下没有危险。'));
  const rec1 = recorder();
  const first = thread.open({ kind: 'opp' }, 'auto', rec1.handlers);
  await s.advance(350);
  const before = rec1.log.length;
  assert.equal(first.id + 1, thread.ask('danger', undefined, recorder().handlers).id, 'reply ids count up');

  assert.deepEqual(await first.done, { aborted: true });
  assert.equal(s.fake.coachCalls()[0].aborted, true);
  await s.advance(10_000);
  assert.equal(rec1.log.length, before, 'the stale reply calls no handler');
  // the interrupted event is in the thread as said 'none'
  assert.deepEqual(lastBody(s).events, [{ i: 0, kind: 'opp', said: 'none' }, { i: 1, kind: 'ask', ask: 'danger' }]);
  assert.equal(s.fake.openStreams(), 0);

  // a local reply is replaced in the same way
  const rec3 = recorder();
  s.fake.enqueue({ steps: [s.fake.OPEN, { hang: true }] });
  const slow = thread.ask('score', undefined, rec3.handlers);
  await s.advance(100);
  const quick = thread.tryMove(HELD, MORE, 'local', recorder().handlers, { flags: { voiced: true } });
  assert.deepEqual(await slow.done, { aborted: true });
  assert.equal((await quick.done).source, 'local');
  await s.advance(10_000);
  assert.deepEqual(rec3.names(), ['start']);
  assert.equal(s.timers.pending(), 0);
});

test('compaction at 11 events keeps the last six with their original i', LIMIT, async () => {
  const s = setup();
  await s.online();
  const thread = s.client.beginTurn(TURN, newBook());
  const tell = narrator();
  /** The thread as the test expects it on the wire. */
  let wire = [];
  const said = (line) => (line.text === '' ? { said: 'none' } : { said: 'local', v: line.v });
  /** Asks a chip while the strategist is forced local and records what the thread must hold afterwards. */
  const askLocal = async (i, code, extra = {}) => {
    const rec = recorder();
    const result = await thread.ask(code, undefined, rec.handlers).done;
    const event = { i, kind: 'ask', ask: code, ...extra };
    const line = tell.line(TURN, [...wire, event]);
    assert.equal(result.text, line.text, `ask ${code} at ${i}`);
    wire.push({ ...event, ...said(line) });
    return line;
  };

  s.force = true;                                                              // ten events without the network
  thread.open({ kind: 'opp' }, 'silent', {});                                  // i 0
  wire.push({ i: 0, kind: 'opp', said: 'none' });
  await thread.tryMove(HELD, MORE, 'local', {}, { flags: { voiced: true } }).done;      // i 1
  wire.push({ i: 1, kind: 'try', n: 1, try: HELD, cue: 'wait', ...said(tell.line(TURN, [...wire, { i: 1, kind: 'try', n: 1, try: HELD, cue: 'wait' }])) });
  await askLocal(2, 'why', { more: MORE });                                    // the first follow-up carries the withheld packet
  const hinted = await thread.hint(1, HINTS[0], 'auto', {}).done;              // i 3
  const hintLine = tell.line(TURN, [...wire, { i: 3, kind: 'hint', level: 1, hint: HINTS[0] }]);
  assert.equal(hinted.text, hintLine.text);
  wire.push({ i: 3, kind: 'hint', level: 1, hint: HINTS[0], ...said(hintLine) });
  await askLocal(4, 'reply');                                                  // `more` travels once
  thread.tryMove(PLAIN, NO_BETTER, 'silent', {});                              // i 5: a second try
  wire.push({ i: 5, kind: 'try', n: 2, try: PLAIN, said: 'none' });
  await askLocal(6, 'good');
  await askLocal(7, 'better', { more: NO_BETTER });
  await askLocal(8, 'score');
  await askLocal(9, 'danger');
  assert.equal(s.fake.coachCalls().length, 0);

  // the eleventh event: all but the last six become one recap, which takes the index of the first replaced event
  s.force = false;
  const eleventh = thread.ask('reply', undefined, {});
  await s.advance(0);
  assert.equal((await eleventh.done).source, 'llm');
  let events = lastBody(s).events;
  assert.equal(events.length, 7);
  assert.deepEqual(events.map((ev) => ev.i), [0, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(events[0], { i: 0, kind: 'recap', recap: { tries: [{ move: HELD.move, cat: HELD.cat }], hint: 1 }, said: 'none' });
  assert.deepEqual(events.slice(1, 6), wire.slice(5), 'the kept events are unchanged');
  assert.deepEqual(events[6], { i: 10, kind: 'ask', ask: 'reply' }, 'the withheld packet is still in the window: not sent twice');
  assert.equal(validateCoachRequest(lastBody(s)).ok, true);
  wire = [events[0], ...wire.slice(5), { ...events[6], said: 'llm' }];

  // four more events: the second compaction folds the first recap in; the current try fell out of the window, so the recap
  // carries it, and the packet it withheld moves to the first question left that may carry it (i 10)
  s.force = true;
  await askLocal(11, 'intent');
  await askLocal(12, 'last');
  await askLocal(13, 'danger');
  const rec = recorder();
  const fifteenth = await thread.ask('reply', undefined, rec.handlers).done;   // i 14: the thread reaches 11 events again
  const recap = { i: 0, kind: 'recap', recap: { tries: [{ move: HELD.move, cat: HELD.cat }, { move: PLAIN.move, cat: PLAIN.cat }], hint: 1, cur: PLAIN }, said: 'none' };
  const compacted = [recap, ...wire.slice(-5).map((ev) => (ev.i === 10 ? { ...ev, more: NO_BETTER } : ev))];
  const replyLine = tell.line(TURN, [...compacted, { i: 14, kind: 'ask', ask: 'reply' }]);
  assert.notEqual(replyLine.text, '', 'the narrator still knows the try and the rival\'s answer');
  assert.equal(fifteenth.text, replyLine.text);

  s.force = false;
  const last = thread.ask('score', undefined, {});
  await s.advance(0);
  await last.done;
  events = lastBody(s).events;
  assert.deepEqual(events.map((ev) => ev.i), [0, 9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual(events[0], recap);
  assert.deepEqual(events[6], { i: 14, kind: 'ask', ask: 'reply', said: 'local', v: replyLine.v }, 'the packet is in the window: not sent twice');
  // the proxy re-creates the local answer from the compacted thread
  assert.equal(composeLocal(TURN, events.slice(0, 7), events[6].v), replyLine.text);
  assert.equal(events[2].said, 'llm', 'a signed reply keeps its index and stays valid');
  assert.deepEqual(events[2].more, NO_BETTER);
  assert.deepEqual(events.filter((ev) => ev.more).map((ev) => ev.i), [10]);
  assert.deepEqual(s.fake.violations, []);

  // a game-over thread keeps its `over` event: every later question is about that packet
  const over = s.client.beginOver(F.over.turn, newBook());
  const packet = F.over.events[0].over;
  s.force = true;
  await quiet(async () => {
    await over.open({ kind: 'over', over: packet }, 'auto', {}).done;
    for (const code of ['proud', 'improve', 'next', 'why', 'proud', 'improve', 'next', 'why', 'proud']) await over.ask(code, undefined, {}).done;
    s.force = false;
    const asked = over.ask('improve', undefined, {});
    await s.advance(0);
    await asked.done;
  });
  events = lastBody(s).events;
  assert.deepEqual(events.map((ev) => ev.i), [0, 5, 6, 7, 8, 9, 10]);
  assert.equal(events[0].kind, 'over');
  assert.deepEqual(events[0].over, packet);
  assert.deepEqual(events.slice(1).map((ev) => ev.ask), ['proud', 'improve', 'next', 'why', 'proud', 'improve']);
  assert.deepEqual(s.fake.violations, []);
});

test('an earlier free ask is sent without its say', LIMIT, async () => {
  const s = setup();
  await s.online();
  const thread = s.client.beginTurn(TURN, newBook());
  thread.open({ kind: 'opp' }, 'silent', {});
  const ask = async (code, say) => {
    const reply = thread.ask(code, say, {});
    await s.advance(0);
    return reply.done;
  };

  await ask('free', '军师，「中炮」是什么？');
  // the child's sentence is sanitised before it is stored or sent, and only the event to answer carries it
  assert.deepEqual(lastBody(s).events[1], { i: 1, kind: 'ask', ask: 'free', say: sanitizeSay('军师，「中炮」是什么？') });
  assert.equal(lastBody(s).events[1].say.includes('「'), false);

  await ask('free', '那马呢？');
  let events = lastBody(s).events;
  assert.equal('say' in events[1], false);
  assert.equal(events[1].said, 'llm');
  assert.deepEqual(events[2], { i: 2, kind: 'ask', ask: 'free', say: sanitizeSay('那马呢？') });

  await ask('score');
  events = lastBody(s).events;
  assert.equal('say' in events[1], false);
  assert.equal('say' in events[2], false);

  // a say on a chip is ignored
  await ask('danger', '不该有的话');
  assert.deepEqual(lastBody(s).events.at(-1), { i: 4, kind: 'ask', ask: 'danger' });

  // a sentence that is empty after sanitising is not sent: the local free line (variant 0)
  const posts = s.fake.coachCalls().length;
  for (const empty of ['   ', '', undefined, '\u0000\u0007']) {
    const rec = recorder();
    const result = await thread.ask('free', empty, rec.handlers).done;
    assert.equal(result.source, 'local');
    assert.equal(result.text, composeLocal(TURN, [{ i: 0, kind: 'opp' }, { i: 1, kind: 'ask', ask: 'free' }], 0));
  }
  assert.equal(s.fake.coachCalls().length, posts);
  await ask('last');
  assert.deepEqual(lastBody(s).events.slice(5, 9).map((ev) => [ev.ask, ev.said, ev.v, 'say' in ev]), [
    ['free', 'local', 0, false], ['free', 'local', 0, false], ['free', 'local', 0, false], ['free', 'local', 0, false],
  ]);
  assert.deepEqual(s.fake.violations, []);
});

test('the 20 s event deadline ends a three-leg exchange', LIMIT, async () => {
  const s = setup();
  await s.online();
  const thread = s.client.beginTurn(TURN, newBook());
  thread.open({ kind: 'opp' }, 'silent', {});
  s.tool.impl = async (input, ctx) => {
    registerToolLine(ctx.book);
    return { ok: true, verdict: VERDICT };
  };
  // Each leg stays inside its own limits (first text within 3.5 s, no gap of 4 s, 12 s per leg): text at 3.0 s, the tool call
  // at 6.9 s. The third leg would finish at 20.7 s.
  const slow = [{ wait: 3000 }, delta('亮在沙盘上'), { wait: 3900 }];
  s.fake.enqueue(
    toolLeg(s.fake, [toolCall('t1')], slow),
    toolLeg(s.fake, [toolCall('t2', { notation: '马二进三', after: [] })], slow),
    (call) => ({ steps: [s.fake.OPEN, ...slow, delta('摆'), { event: 'done', data: s.fake.doneData(call, '亮在沙盘上摆好了。') }] }),
  );
  const rec = recorder();
  const reply = thread.ask('free', FREE_SAY, rec.handlers);
  await s.advance(6900);
  assert.equal(s.fake.coachCalls().length, 2);
  await s.advance(6900);
  assert.equal(s.fake.coachCalls().length, 3, 'three legs');
  assert.deepEqual(lastBody(s).resume.results.map((r) => r.id), ['t1', 't2'], 'the results of both rounds travel with the third leg');
  await s.advance(20_000 - 13_800 - 1);
  assert.equal(rec.count('end'), 0, 'still inside the deadline at 19 999 ms');
  assert.equal(thread.busy(), true);
  await s.advance(1);

  // 20 s: the exchange is over. The sandbox had an answer, so the local narrator gives it.
  const result = await reply.done;
  const expected = composeToolReply(TURN, VERDICT);
  assert.notEqual(expected, '');
  assert.equal(result.source, 'local');
  assert.equal(result.aborted, false);
  assert.equal(result.text, expected);
  assert.equal(rec.shown(), result.text);
  assert.equal(rec.count('reset'), 1, 'what the model had begun is taken back');
  assert.equal(rec.count('end'), 1);
  assert.equal(s.fake.coachCalls()[2].aborted, true);
  assert.equal(s.fake.openStreams(), 0);
  assert.equal(s.timers.pending(), 0);
  assert.equal(s.fake.coachCalls().length, 3, 'no fourth request');
  assert.equal(s.client.status(), 'online', 'counted once');
  assert.equal(s.client.stats().failures, 1);

  // the event is recorded as said 'none': no template row re-creates that answer
  thread.ask('score', undefined, {});
  await s.advance(0);
  assert.deepEqual(lastBody(s).events[1], { i: 1, kind: 'ask', ask: 'free', said: 'none' });
  assert.deepEqual(s.fake.violations, []);
});

// ---------------------------------------------------------------------------------------------------------------------
// More of sections 7.3, 7.5 and 7.6, and the requests of the earlier waves
// ---------------------------------------------------------------------------------------------------------------------

const HEALTH_OK = { json: { ok: true, v: 1, mode: 'mock', model: 'mock', freeText: true } };

test('availability: an event waits at most 800 ms for the probe; forceLocal is read at the start of every event', LIMIT, async () => {
  // boot: unknown, llm mode, no request until someone asks
  {
    const s = setup();
    assert.equal(s.client.status(), 'unknown');
    assert.equal(s.client.mode(), 'llm');
    assert.equal(s.client.offReason(), null);
    assert.deepEqual(s.client.capabilities(), { freeText: false }, 'free text only once the proxy reported it');
    assert.equal(s.fake.calls.length, 0);

    // the probe answers after 300 ms: the event waits for it and goes to the model
    s.fake.health = { ...HEALTH_OK, delay: 300 };
    const thread = s.client.beginTurn(TURN, newBook());
    const rec = recorder();
    const reply = thread.open({ kind: 'opp' }, 'auto', rec.handlers);
    assert.deepEqual(rec.names(), ['start']);
    await s.advance(0);
    assert.equal(s.fake.healthCalls().length, 1, 'the event starts the probe');
    assert.equal(s.fake.coachCalls().length, 0);
    await s.advance(299);
    assert.equal(s.fake.coachCalls().length, 0);
    await s.advance(1);
    assert.equal(s.client.status(), 'online');
    assert.equal(s.fake.coachCalls().length, 1);
    assert.equal((await reply.done).source, 'llm');
    assert.deepEqual(s.client.capabilities(), { freeText: true });
    assert.deepEqual(s.modes, [{ mode: 'llm', reason: null }], 'the new capability is pushed to the listeners');
  }
  // the probe is slow: the local line after 800 ms, and the proxy counts as unreachable when the probe times out at 2500 ms
  {
    const s = setup();
    s.fake.health = { ...HEALTH_OK, delay: 5000 };
    const thread = s.client.beginTurn(TURN, newBook());
    const rec = recorder();
    const reply = thread.open({ kind: 'opp' }, 'auto', rec.handlers);
    await s.advance(799);
    assert.deepEqual(rec.names(), ['start']);
    await s.advance(1);
    const result = await reply.done;
    assert.equal(result.source, 'local');
    assert.equal(result.text, localLine(TURN, [{ i: 0, kind: 'opp' }], []).text);
    assert.equal(rec.count('reset'), 0, 'nothing was shown before: no reset');
    assert.equal(s.fake.coachCalls().length, 0);
    assert.equal(s.client.status(), 'unknown');
    await s.advance(1700);
    assert.equal(s.client.status(), 'offline');
    assert.equal(s.client.offReason(), 'unreachable');
    assert.equal(s.fake.healthCalls()[0].aborted, true);
    // an interrupted wait leaves nothing behind
    await s.advance(60_000);
    assert.equal(s.client.status(), 'unknown');
    const waiting = thread.ask('intent', undefined, rec.handlers);
    await s.advance(100);
    thread.interrupt();
    assert.deepEqual(await waiting.done, { aborted: true });
  }
  // forceLocal is a live getter (CONTRACT-NOTES item 83)
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    s.force = true;
    assert.equal(s.client.status(), 'offline');
    assert.equal(s.client.offReason(), 'setting');
    assert.equal(s.client.mode(), 'local');
    assert.deepEqual(s.client.capabilities(), { freeText: false });
    const before = s.fake.calls.length;
    const forced = await thread.ask('intent', undefined, {}).done;
    assert.equal(forced.source, 'local');
    assert.deepEqual(s.modes, [{ mode: 'local', reason: 'setting' }], 'noticed at the start of the event');
    await s.client.probe();
    await s.advance(700_000);
    assert.equal(s.fake.calls.length, before, 'never touches the network');

    s.force = false;
    assert.equal(s.client.status(), 'online');
    const free = thread.ask('score', undefined, {});
    await s.advance(0);
    assert.equal((await free.done).source, 'llm');
    assert.deepEqual(s.modes.slice(1), [{ mode: 'llm', reason: null }]);

    // switched off by the child's setting (or by ?coach=off) and no proxy either: the reason shown is the setting
    const off = setup({ apiBase: null });
    assert.equal(off.client.offReason(), 'no_proxy');
    off.force = true;
    assert.equal(off.client.offReason(), 'setting');
    assert.equal(off.client.status(), 'offline');

    // a listener can be removed
    const seen = [];
    const remove = s.client.onMode((m) => seen.push(m));
    remove();
    s.force = true;
    await thread.ask('danger', undefined, {}).done;
    assert.deepEqual(seen, []);
  }
});

test('availability: not configured, wrong version, a busy gateway, free text turned off', LIMIT, async () => {
  const ask = async (s, thread, code, say) => {
    const reply = thread.ask(code, say, {});
    await s.advance(0);
    return reply.done;
  };
  const begin = async (s) => {
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    return thread;
  };

  // health says the proxy has no key: off, asked again every 10 minutes
  {
    const s = setup();
    s.fake.health = { json: { ok: false, v: 1, mode: 'off', reason: 'no_key' } };
    await s.client.probe();
    assert.equal(s.client.status(), 'offline');
    assert.equal(s.client.offReason(), 'no_key');
    assert.deepEqual(s.modes, [{ mode: 'local', reason: 'no_key' }]);
    const thread = s.client.beginTurn(TURN, newBook());
    assert.equal((await thread.open({ kind: 'opp' }, 'auto', {}).done).source, 'local');
    assert.equal(s.fake.coachCalls().length, 0);
    await s.advance(599_999);
    assert.equal(s.fake.healthCalls().length, 1);
    await s.advance(1);
    assert.equal(s.fake.healthCalls().length, 2);
    assert.equal(s.client.offReason(), 'no_key');
    assert.deepEqual(s.modes, [{ mode: 'local', reason: 'no_key' }], 'the status does not flicker while it asks again');
    // while the child's setting keeps the strategist local nothing is asked; the question is not lost, only put off
    s.force = true;
    await s.advance(1_200_000);
    assert.equal(s.fake.healthCalls().length, 2, 'no request while forceLocal is on');
    s.force = false;
    assert.equal(s.client.offReason(), 'no_key');
    s.fake.health = HEALTH_OK;
    await s.advance(600_000);
    assert.equal(s.fake.healthCalls().length, 3);
    assert.equal(s.client.status(), 'online');
  }
  // the same from a request: HTTP 503 no_key, and a bad key or an unknown model reported by the gateway
  for (const failure of [{ status: 503, error: 'no_key' }, { steps: [{ event: 'error', data: { code: 'upstream_auth' } }] },
    { steps: [{ event: 'open', data: {} }, { event: 'error', data: { code: 'upstream_model' } }] }]) {
    const s = setup();
    const thread = await begin(s);
    s.fake.enqueue(failure);
    assert.equal((await ask(s, thread, 'intent')).source, 'local');
    assert.equal(s.client.status(), 'offline');
    assert.equal(s.client.offReason(), 'no_key');
    const probes = s.fake.healthCalls().length;
    await s.advance(600_000);
    assert.equal(s.fake.healthCalls().length, probes + 1);
    assert.equal(s.client.status(), 'online');
  }
  // a protocol mismatch: off for the session
  for (const how of ['request', 'health']) {
    const s = setup();
    if (how === 'health') {
      s.fake.health = { json: { ok: true, v: 2, mode: 'live', freeText: true } };
      await s.client.probe();
    } else {
      const thread = await begin(s);
      s.fake.enqueue({ status: 400, error: 'bad_version' });
      assert.equal((await ask(s, thread, 'intent')).source, 'local');
    }
    assert.equal(s.client.status(), 'offline', how);
    assert.equal(s.client.offReason(), 'version', how);
    const total = s.fake.calls.length;
    await s.advance(3_600_000);
    await s.client.probe();
    assert.equal(s.fake.calls.length, total, how);
  }
  // a busy gateway: paused for retry_after (at most 60 s) and counted
  {
    const s = setup();
    const thread = await begin(s);
    s.fake.enqueue({ steps: [s.fake.OPEN, { event: 'error', data: { code: 'upstream_busy', retry_after: 20 } }] });
    assert.equal((await ask(s, thread, 'intent')).source, 'local');
    assert.equal(s.client.status(), 'paused');
    await s.advance(19_999);
    assert.equal(s.client.status(), 'paused');
    await s.advance(1);
    assert.equal(s.client.status(), 'online');
    s.fake.enqueue({ status: 500, error: 'mock_fail' });
    await ask(s, thread, 'score');
    assert.equal(s.client.status(), 'offline', 'the busy answer counted: this failure is the second in a row');
    assert.equal(s.client.offReason(), 'unreachable');
    await s.advance(60_000);
    assert.equal(s.client.status(), 'online');
    s.fake.enqueue({ steps: [s.fake.OPEN, { event: 'error', data: { code: 'upstream_busy', retry_after: 900 } }] });
    await ask(s, thread, 'danger');
    assert.equal(s.client.status(), 'paused');
    await s.advance(60_000);
    assert.equal(s.client.status(), 'online', 'never more than 60 s');
  }
  // errors that only cost this one reply: local, not counted
  {
    const s = setup();
    const thread = await begin(s);
    for (const code of ['upstream_rejected', 'truncated', 'empty', 'upstream_rejected', 'truncated']) {
      s.fake.enqueue({ steps: [s.fake.OPEN, { event: 'error', data: { code } }] });
      assert.equal((await ask(s, thread, 'intent')).source, 'local', code);
      assert.equal(s.client.status(), 'online', code);
    }
    assert.equal(s.client.stats().failures, 5);
  }
  // the deployer turned free text off: the input goes away, the question gets the local line
  {
    const s = setup();
    const thread = await begin(s);
    assert.deepEqual(s.client.capabilities(), { freeText: true });
    s.fake.enqueue({ status: 403, error: 'free_text_off' });
    const result = await ask(s, thread, 'free', '军师你好');
    assert.equal(result.source, 'local');
    assert.equal(result.text, composeLocal(TURN, [OPP_SILENT, { i: 1, kind: 'ask', ask: 'free' }], 0));
    assert.equal(s.client.status(), 'online');
    assert.deepEqual(s.client.capabilities(), { freeText: false });
    assert.deepEqual(s.modes, [{ mode: 'llm', reason: null }], 'the listeners hear of the lost capability');
    const posts = s.fake.coachCalls().length;
    assert.equal((await ask(s, thread, 'free', '再问一句')).source, 'local');
    assert.equal(s.fake.coachCalls().length, posts, 'a free question is not sent any more');
    assert.equal((await ask(s, thread, 'score')).source, 'llm', 'chips still go to the model');
    // a health answer without freeText: the same
    const t = setup();
    t.fake.health = { json: { ok: true, v: 1, mode: 'live', model: 'm', freeText: false } };
    await t.online();
    assert.deepEqual(t.client.capabilities(), { freeText: false });
  }
});

test('a rejected thread: invalid and bad_signature drop the signed history; too_large compacts and does not retry', LIMIT, async () => {
  const ask = async (s, thread, code) => {
    const reply = thread.ask(code, undefined, {});
    await s.advance(0);
    return reply.done;
  };
  // invalid: console.error, earlier model replies become said 'none'; a second rejection keeps the thread local
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    const opened = thread.open({ kind: 'opp' }, 'auto', {});
    await s.advance(0);
    assert.equal((await opened.done).source, 'llm');
    await ask(s, thread, 'intent');
    assert.equal(lastBody(s).events[0].said, 'llm');

    s.fake.enqueue({ status: 400, error: 'invalid' });
    const said = await quiet(async () => {
      assert.equal((await ask(s, thread, 'score')).source, 'local');
    });
    assert.equal(said.errors.length, 1);
    assert.equal(s.client.status(), 'online', 'not counted by the breaker');
    await ask(s, thread, 'danger');
    assert.deepEqual(lastBody(s).events.slice(0, 2), [{ i: 0, kind: 'opp', said: 'none' }, { i: 1, kind: 'ask', ask: 'intent', said: 'none' }]);
    assert.equal(lastBody(s).events[2].said, 'local');

    s.fake.enqueue({ status: 400, error: 'invalid' });
    await quiet(async () => {
      await ask(s, thread, 'last');
    });
    const posts = s.fake.coachCalls().length;
    assert.equal((await ask(s, thread, 'intent')).source, 'local');
    assert.equal(s.fake.coachCalls().length, posts, 'a thread the proxy rejected twice stays local');
    const fresh = s.client.beginTurn(TURN, newBook()).open({ kind: 'opp' }, 'auto', {});
    await s.advance(0);
    assert.equal((await fresh.done).source, 'llm', 'the next thread travels again');
    assert.deepEqual(s.fake.violations, []);
  }
  // a signature that does not verify: the proxy answers bad_signature once, the history goes, the thread recovers
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    s.fake.enqueue((call) => ({ steps: [s.fake.OPEN, delta('好。'), { event: 'done', data: { ...s.fake.doneData(call, '好。'), sig: 'A'.repeat(43) } }] }));
    const opened = thread.open({ kind: 'opp' }, 'auto', {});
    await s.advance(0);
    assert.equal((await opened.done).source, 'llm');
    await quiet(async () => {
      assert.equal((await ask(s, thread, 'intent')).source, 'local');
    });
    assert.equal(s.fake.violations.length, 1);
    assert.match(s.fake.violations[0], /does not verify/);
    assert.equal((await ask(s, thread, 'score')).source, 'llm');
    assert.deepEqual(lastBody(s).events[0], { i: 0, kind: 'opp', said: 'none' });
    assert.equal(s.fake.violations.length, 1);
  }
  // a reply the next request could not carry is shown but recorded as said 'none': over 400 characters, or without a signature
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    const long = '好。'.repeat(201);                                           // 402 characters
    s.fake.enqueue(s.fake.say(long, { size: 100 }));
    const rec = recorder();
    const opened = thread.open({ kind: 'opp' }, 'auto', rec.handlers);
    await s.advance(0);
    const result = await opened.done;
    assert.equal(result.source, 'llm');
    assert.equal(result.cut, true);
    assert.equal(plainLength(result.text) <= Math.ceil(1.5 * CAPS.opp), true);
    s.fake.enqueue({ steps: [s.fake.OPEN, delta('没签名。'), { event: 'done', data: { text: '没签名。' } }] });
    assert.equal((await ask(s, thread, 'intent')).source, 'llm');
    await ask(s, thread, 'score');
    assert.deepEqual(lastBody(s).events.slice(0, 2), [{ i: 0, kind: 'opp', said: 'none' }, { i: 1, kind: 'ask', ask: 'intent', said: 'none' }]);
    assert.deepEqual(s.fake.violations, []);
  }
  // an expired resume token: the proxy calls the resumed leg invalid. The thread itself was fine (the first leg was taken),
  // so its signed history stays; the sandbox had an answer, which the local narrator gives
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    const opened = thread.open({ kind: 'opp' }, 'auto', {});
    await s.advance(0);
    assert.equal((await opened.done).source, 'llm');
    s.tool.impl = async (input, ctx) => {
      registerToolLine(ctx.book);
      return { ok: true, verdict: VERDICT };
    };
    for (const round of [1, 2, 3]) {
      s.fake.enqueue(toolLeg(s.fake, [toolCall(`c${round}`)]), { status: 400, error: 'invalid' });
      const rec = recorder();
      const said = await quiet(async () => {
        const reply = thread.ask('free', FREE_SAY, rec.handlers);
        await s.advance(0);
        const result = await reply.done;
        assert.equal(result.source, 'local', `round ${round}`);
        assert.equal(result.text, composeToolReply(TURN, VERDICT), `round ${round}`);
      });
      assert.equal(said.errors.length, 1, `round ${round}`);
      assert.equal(s.client.status(), 'online', `round ${round}`);
    }
    const posts = s.fake.coachCalls().length;
    assert.equal((await ask(s, thread, 'score')).source, 'llm', 'the thread still travels');
    assert.equal(s.fake.coachCalls().length, posts + 1);
    assert.equal(lastBody(s).events[0].said, 'llm', 'and keeps its signed history');
    assert.deepEqual(lastBody(s).events.slice(1, 4).map((ev) => [ev.ask, ev.said, 'say' in ev]), [['free', 'none', false], ['free', 'none', false], ['free', 'none', false]]);
    assert.deepEqual(s.fake.violations, []);
  }
  // too_large: the thread is compacted at once and the event is answered locally, with no second request
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    thread.tryMove(HELD, MORE, 'silent', {});
    for (const code of ['good', 'why', 'score', 'danger']) await ask(s, thread, code);
    assert.equal(lastBody(s).events.length, 6);
    s.fake.enqueue({ status: 413, error: 'too_large' });
    const posts = s.fake.coachCalls().length;
    assert.equal((await ask(s, thread, 'last')).source, 'local');
    assert.equal(s.fake.coachCalls().length, posts + 1, 'no retry');
    assert.equal(s.client.status(), 'online');
    await ask(s, thread, 'intent');
    const events = lastBody(s).events;
    assert.deepEqual(events.map((ev) => ev.i), [0, 4, 5, 6, 7]);
    assert.deepEqual(events[0], { i: 0, kind: 'recap', recap: { tries: [{ move: HELD.move, cat: HELD.cat }], hint: 0, cur: HELD }, said: 'none' });
    assert.deepEqual(s.fake.violations, []);
  }
});

test('stream limits: a stall of 4 s, 12 s per leg, 4 s to the open event; pings do not count', LIMIT, async () => {
  const begin = async (opts) => {
    const s = setup(opts);
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    return { s, thread };
  };
  // the gap between stream events once text has started
  {
    const { s, thread } = await begin();
    s.fake.enqueue({ steps: [s.fake.OPEN, delta('第一句。'), { wait: 3999 }, delta('第二句。'), { wait: 2000 }, { ping: true }, { wait: 2500 }, delta('第三句。')] });
    const rec = recorder();
    const reply = thread.ask('intent', undefined, rec.handlers);
    await s.advance(3999);
    assert.equal(rec.shown(), '第一句。第二句。');
    await s.advance(3999);
    assert.equal(rec.count('end'), 0, 'a ping 2 s ago is not an event');
    await s.advance(1);
    const result = await reply.done;
    assert.equal(result.source, 'mixed');
    assert.equal(result.text, '第一句。第二句。');
    assert.equal(s.fake.openStreams(), 0);
    assert.equal(s.timers.pending(), 0);
  }
  // one leg may take 12 s, however lively the stream
  {
    const { s, thread } = await begin();
    const steps = [s.fake.OPEN];
    for (let k = 0; k < 10; k++) steps.push(delta(`第${k}句。`), { wait: 1400 });
    s.fake.enqueue({ steps });
    const rec = recorder();
    const reply = thread.ask('why', undefined, rec.handlers);
    await s.advance(11_999);
    assert.equal(rec.count('end'), 0);
    await s.advance(1);
    const result = await reply.done;
    assert.equal(result.source, 'mixed');
    assert.equal(result.text, '第0句。第1句。第2句。第3句。第4句。第5句。第6句。第7句。第8句。', 'the sentence due at 12.6 s is not shown');
  }
  // the open event is due after 4 s (seen here with a longer limit for the first text)
  {
    const { s, thread } = await begin({ timeouts: { firstTextAskMs: 9000 } });
    s.fake.enqueue({ delay: 5000, steps: [s.fake.OPEN, delta('来了。')] });
    const rec = recorder();
    const reply = thread.ask('intent', undefined, rec.handlers);
    await s.advance(3999);
    assert.deepEqual(rec.names(), ['start']);
    await s.advance(1);
    assert.equal((await reply.done).source, 'local');
    assert.equal(s.fake.pendingTimers(), 0);
  }
});

test('display cap, ungrounded notations and the counters of stats()', LIMIT, async () => {
  const s = setup();
  await s.online();
  const thread = s.client.beginTurn(TURN, newBook());

  // the read of a rival move: 18 characters in the prompt, 27 on screen, cut at a sentence end
  const long = '对方跳马出动护住中卒。这是屏风马的起手式。接下来它多半要出车抢占要道。';
  s.fake.enqueue(s.fake.say(long, { size: 7 }));
  const rec = recorder();
  const reply = thread.open({ kind: 'opp' }, 'auto', rec.handlers);
  await s.advance(0);
  const result = await reply.done;
  assert.equal(result.source, 'llm');
  assert.equal(result.cut, true);
  assert.equal(result.text, '对方跳马出动护住中卒。这是屏风马的起手式。');
  assert.equal(plainLength(result.text) <= Math.ceil(1.5 * CAPS.opp), true);
  assert.equal(rec.shown(), result.text);
  assert.equal(s.client.stats().overCap, 1);

  // the whole reply is what was signed and what travels
  const next = thread.ask('intent', undefined, {});
  await s.advance(0);
  await next.done;
  assert.equal(lastBody(s).events[0].reply.text, long);

  // a move that is in no book is shown as plain text, never as a move, and counted
  const said = await quiet(async () => {
    s.fake.enqueue(s.fake.say('可以走【车五进九】，也可以走【马二进三】。'));
    const rec2 = recorder();
    const invented = thread.ask('score', undefined, rec2.handlers);
    await s.advance(0);
    const answer = await invented.done;
    assert.equal(answer.text, '可以走车五进九，也可以走【马二进三】。');
    assert.deepEqual(answer.segments.filter((seg) => seg.type === 'move').map((seg) => seg.notation), ['马二进三']);
  });
  assert.equal(said.warnings.length, 1);
  const stats = s.client.stats();
  assert.deepEqual(stats, { requests: 3, llm: 3, local: 0, ungrounded: 1, overCap: 1, refused: 0, failures: 0 });
  stats.requests = 99;
  assert.equal(s.client.stats().requests, 3, 'stats() hands out a copy');

  // text that is only markup has nothing to show: the local line
  s.fake.enqueue(s.fake.say('***'));
  const rec3 = recorder();
  const empty = thread.ask('danger', undefined, rec3.handlers);
  await s.advance(0);
  assert.equal((await empty.done).source, 'local');
  assert.equal(s.client.stats().local, 1);
});

test('SSE framing: bytes cut anywhere, CRLF, comments, unknown events; malformed streams fall back', LIMIT, async () => {
  const text = '对方会走【马7进5】把炮吃掉，咱们只换到一个卒，亏了👍。';
  for (const chunkBytes of [1, 2, 3, 5, 7, 4096]) {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    s.fake.enqueue((call) => ({ ...s.fake.say(text, { size: 3 })(call), chunkBytes }));
    const rec = recorder();
    const reply = thread.open({ kind: 'over', over: F.over.events[0].over }, 'auto', rec.handlers);
    await s.advance(0);
    const result = await reply.done;
    assert.equal(result.source, 'llm', `chunks of ${chunkBytes}`);
    assert.equal(result.text, text, `chunks of ${chunkBytes}`);
    assert.equal(rec.shown(), text);
  }
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    const ask = async (reply, code = 'intent') => {
      s.fake.enqueue(reply);
      const rec = recorder();
      const r = thread.ask(code, undefined, rec.handlers);
      await s.advance(0);
      return { result: await r.done, rec };
    };
    // CRLF line ends, comment lines, an event the client does not know, a data line without a space
    const crlf = await ask((call) => ({ steps: [
      { raw: ': hello\r\nevent: open\r\ndata: {"v":1}\r\n\r\n' },
      { raw: 'event: usage\r\ndata: {"n":1}\r\n\r\n: ping\r\n\r\n' },
      { raw: 'event: delta\r\ndata:{"t":"好，"}\r\n\r\nevent: delta\r\ndata: {"t":"稳。"}\r\n\r\n' },
      { event: 'done', data: s.fake.doneData(call, '好，稳。') },
    ] }));
    assert.equal(crlf.result.source, 'llm');
    assert.equal(crlf.result.text, '好，稳。');

    // what follows the terminal event is ignored
    const tail = await ask((call) => ({ steps: [s.fake.OPEN, delta('好。'), { event: 'done', data: s.fake.doneData(call, '好。') }, delta('多余的话。')] }));
    assert.equal(tail.result.text, '好。');
    assert.equal(tail.rec.shown(), '好。');

    // malformed: each is one failed exchange, answered locally, with nothing of it on screen
    const expected = () => localLine(TURN, lastBody(s).events, []).text;
    const bad = [
      { steps: [s.fake.OPEN, { raw: 'event: delta\ndata: {"t": "半\n\n' }] },
      { steps: [s.fake.OPEN, { raw: 'event: delta\ndata: {"x":1}\n\n' }] },
      { steps: [s.fake.OPEN, { raw: 'event: done\ndata: {}\n\n' }] },
      { steps: [s.fake.OPEN, { raw: 'event: tool\ndata: {"calls":"x","resume":"a.b"}\n\n' }] },
      { steps: [s.fake.OPEN, { raw: 'event: tool\ndata: {"calls":[],"resume":"no token"}\n\n' }] },
      { steps: [{ raw: new Uint8Array([0xff, 0xfe, 0x80, 0x0a, 0x0a]) }] },
      { steps: [{ raw: '<html>captive portal</html>' }] },
      { status: 200, text: 'OK' },
      { steps: [s.fake.OPEN, { raw: 'x'.repeat(300_000) }, { hang: true }] },
      { reject: new TypeError('fetch failed') },
    ];
    for (const [k, reply] of bad.entries()) {
      const one = await ask(reply);
      assert.equal(one.result.source, 'local', `malformed stream ${k}`);
      assert.equal(one.result.text, expected(), `malformed stream ${k}`);
      assert.equal(one.rec.shown(), one.result.text, `malformed stream ${k}`);
      assert.equal(s.fake.openStreams(), 0, `malformed stream ${k}`);
      const ok = await ask(s.fake.say('好。'), 'score');                       // keeps the breaker out of it
      assert.equal(ok.result.source, 'llm', `after malformed stream ${k}`);
    }
    assert.equal(s.timers.pending(), 0);
    assert.deepEqual(s.fake.violations, []);
  }
});

test('wire limits: the try number, the event index, questions without a try, pouch levels, a withdrawn try', LIMIT, async () => {
  // questions about a try before any try, and a pouch below the last one, would break the thread: answered locally, not recorded
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    for (const code of ['good', 'reply', 'better', 'show']) {
      const rec = recorder();
      const result = await thread.ask(code, undefined, rec.handlers).done;
      assert.equal(result.source, 'none', code);
      assert.deepEqual(rec.names(), ['start', 'end'], code);
    }
    await thread.hint(2, HINTS[1], 'local', {}).done;
    const lower = await thread.hint(1, HINTS[0], 'auto', {}).done;
    assert.equal(lower.source, 'local');
    assert.equal(lower.text, composeLocal(TURN, [{ i: 0, kind: 'hint', level: 1, hint: HINTS[0] }], 0));
    const second = await thread.open({ kind: 'opp' }, 'auto', {}).done;        // a thread has one first event
    assert.equal(second.aborted, false);
    assert.equal(s.fake.coachCalls().length, 0);
    const asked = thread.ask('intent', undefined, {});
    await s.advance(0);
    await asked.done;
    assert.deepEqual(lastBody(s).events.map((ev) => [ev.i, ev.kind]), [[0, 'opp'], [1, 'hint'], [2, 'ask']]);
    assert.deepEqual(s.fake.violations, []);
  }
  // after `over` only proud / improve / next / why / free are part of the thread
  {
    const s = setup();
    await s.online();
    const over = s.client.beginOver(F.over.turn, newBook());
    over.open({ kind: 'over', over: F.over.events[0].over }, 'silent', {});
    await over.ask('score', undefined, {}).done;
    await over.tryMove(PLAIN, NO_BETTER, 'auto', {}).done;
    assert.equal(over.activeTry(), null);
    await over.hint(1, HINTS[0], 'auto', {}).done;
    assert.equal(s.fake.coachCalls().length, 0);
    await quiet(async () => {
      const asked = over.ask('proud', undefined, {});
      await s.advance(0);
      assert.equal((await asked.done).source, 'llm');
    });
    assert.deepEqual(lastBody(s).events.map((ev) => [ev.i, ev.kind]), [[0, 'over'], [1, 'ask']]);
    assert.equal(lastBody(s).events[0].cue, 'win');
    assert.deepEqual(s.fake.violations, []);
  }
  // n is clamped to 40; once the index would pass 63 the thread stays local
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    for (let k = 0; k < 45; k++) thread.tryMove(PLAIN, NO_BETTER, 'silent', {});
    let asked = thread.ask('good', undefined, {});
    await s.advance(0);
    assert.equal((await asked.done).source, 'llm');
    let events = lastBody(s).events;
    assert.equal(events.at(-1).i, 46);
    assert.deepEqual(events.at(-2), { i: 45, kind: 'try', n: 40, try: PLAIN, said: 'none' });
    assert.equal(events[0].recap.tries.length, 8, 'a recap lists the eight most recent tries');
    for (let k = 0; k < 16; k++) thread.tryMove(PLAIN, NO_BETTER, 'silent', {});      // i 47 .. 62
    asked = thread.ask('good', undefined, {});                                 // i 63: the last index
    await s.advance(0);
    assert.equal((await asked.done).source, 'llm');
    events = lastBody(s).events;
    assert.equal(events.at(-1).i, 63);
    const posts = s.fake.coachCalls().length;
    const rec = recorder();
    const past = await thread.ask('reply', undefined, rec.handlers).done;      // i 64
    assert.equal(past.source, 'local');
    assert.equal(rec.count('reset'), 0);
    assert.equal((await thread.ask('score', undefined, {}).done).source, 'local');
    assert.equal(s.fake.coachCalls().length, posts, 'nothing is sent once the index passed 63');
    assert.deepEqual(s.fake.violations, []);
  }
  // 换一步: the try is withdrawn; what it withheld does not travel any more
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    thread.tryMove(HELD, MORE, 'silent', {});
    assert.deepEqual(thread.activeTry(), HELD);
    thread.retract();
    assert.equal(thread.activeTry(), null);
    const asked = thread.ask('why', undefined, {});
    await s.advance(0);
    await asked.done;
    assert.deepEqual(lastBody(s).events.at(-1), { i: 2, kind: 'ask', ask: 'why' });
    // the next try starts fresh, and its packet travels with the first follow-up
    thread.tryMove(PLAIN, { reply: null, better: [] }, 'silent', {});
    const again = thread.ask('better', undefined, {});
    await s.advance(0);
    await again.done;
    assert.deepEqual(lastBody(s).events.slice(-2), [
      { i: 3, kind: 'try', n: 2, try: PLAIN, said: 'none' },
      { i: 4, kind: 'ask', ask: 'better', more: { better: [] } },
    ]);
    assert.deepEqual(s.fake.violations, []);
  }
  // an event without the parts of its kind (a code that does not exist, a missing packet) never joins the thread
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    const said = await quiet(async () => {
      assert.equal((await thread.ask('nonsense', undefined, {}).done).source, 'none');
      assert.equal((await thread.tryMove(null, null, 'auto', {}).done).source, 'none');
      assert.equal((await thread.hint(4, HINTS[2], 'auto', {}).done).aborted, false);
      assert.equal((await thread.hint(1, undefined, 'auto', {}).done).aborted, false);
    });
    assert.equal(said.errors.length > 0, true, 'the narrator could not read them, and says so on the console');
    assert.equal(thread.activeTry(), null);
    assert.equal(s.fake.coachCalls().length, 0);
    const asked = thread.ask('intent', undefined, {});
    await s.advance(0);
    assert.equal((await asked.done).source, 'llm');
    assert.deepEqual(lastBody(s).events, [{ i: 0, kind: 'opp', said: 'none' }, { i: 1, kind: 'ask', ask: 'intent' }]);
    assert.deepEqual(s.fake.violations, []);
    // a brief that is not one: the thread still answers, with nothing
    const broken = s.client.beginTurn(undefined, newBook());
    const nothing = await quiet(async () => {
      assert.deepEqual(await broken.open({ kind: 'opp' }, 'local', {}).done, { aborted: false, text: '', segments: [], source: 'none', cut: false, refused: false });
    });
    assert.equal(nothing.errors.length > 0, true);
  }
  // a handler that throws does not break the reply
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    const boom = () => { throw new Error('ui bug'); };
    const said = await quiet(async () => {
      const reply = thread.open({ kind: 'opp' }, 'auto', { onStart: boom, onSegment: boom, onSentence: boom, onEnd: boom });
      await s.advance(0);
      assert.equal((await reply.done).source, 'llm');
    });
    assert.equal(said.errors.length >= 4, true);
  }
});

test('re-entrancy: a handler or a mode listener that aborts the reply it is told about ends it there', LIMIT, async () => {
  // a handler interrupts while one delta is being handed over as several segments: the rest is dropped, onEnd never comes
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    thread.tryMove(HELD, MORE, 'silent', {});
    s.fake.enqueue(s.fake.say('对方会走【马7进5】吃炮。然后再出车。', { size: 40 }));
    const rec = recorder();
    rec.handlers.onSegment = (seg) => {
      rec.log.push(['segment', seg]);
      thread.interrupt();
    };
    const reply = thread.ask('reply', undefined, rec.handlers);
    await s.advance(0);
    assert.deepEqual(await reply.done, { aborted: true });
    assert.deepEqual(rec.names(), ['start', 'segment']);
    assert.equal(s.fake.openStreams(), 0);
    assert.equal(s.timers.pending(), 0);
  }
  // the same inside a local line, which is handed over within the call
  {
    const s = setup({ apiBase: null });
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    const rec = recorder();
    rec.handlers.onSegment = (seg) => {
      rec.log.push(['segment', seg]);
      thread.interrupt();
    };
    const reply = thread.tryMove(HELD, MORE, 'local', rec.handlers, { flags: { voiced: true } });
    assert.deepEqual(rec.names(), ['start', 'segment']);
    assert.deepEqual(await reply.done, { aborted: true });
    assert.equal(thread.busy(), false);
    // the interrupted line does not count as spoken: the same event in a new thread gets the same variant, not the next one
    const events = [OPP_SILENT, { i: 1, kind: 'try', n: 1, try: HELD, cue: 'wait' }];
    const first = localLine(TURN, events, []);
    assert.equal(rec.shown(), first.text);
    assert.notEqual(localLine(TURN, events, [`${first.row}:${first.v}`]).text, first.text, 'a line that was spoken is not repeated at once');
    const other = s.client.beginTurn(TURN, newBook());
    other.open({ kind: 'opp' }, 'silent', {});
    const again = await other.tryMove(HELD, MORE, 'local', {}, { flags: { voiced: true } }).done;
    assert.equal(again.text, first.text);
    // … and now it was spoken: the third time the next variant comes
    const third = s.client.beginTurn(TURN, newBook());
    third.open({ kind: 'opp' }, 'silent', {});
    const varied = await third.tryMove(HELD, MORE, 'local', {}, { flags: { voiced: true } }).done;
    assert.equal(varied.text, localLine(TURN, events, [`${first.row}:${first.v}`]).text);
  }
  // a handler interrupts when the tool indicator comes up: the sandbox is not started
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    s.fake.enqueue(toolLeg(s.fake, [toolCall('c1'), toolCall('c2')]));
    const rec = recorder();
    rec.handlers.onTool = (t) => {
      rec.log.push(['tool', t]);
      thread.interrupt();
    };
    const reply = thread.ask('free', FREE_SAY, rec.handlers);
    await s.advance(0);
    assert.deepEqual(await reply.done, { aborted: true });
    await s.advance(5000);
    assert.deepEqual(rec.names(), ['start', 'tool']);
    assert.equal(s.tool.calls.length, 0);
    assert.equal(s.fake.coachCalls().length, 1);
  }
  // onEnd may send the next event at once: the thread is free by then
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    const rec = recorder();
    let next = null;
    const busyInside = [];
    const reply = thread.open({ kind: 'opp' }, 'auto', {
      onEnd: () => {
        busyInside.push(thread.busy());
        next = thread.ask('intent', undefined, rec.handlers);
      },
    });
    await s.advance(0);
    assert.equal((await reply.done).source, 'llm');
    assert.deepEqual(busyInside, [false]);
    assert.equal((await next.done).source, 'llm');
    assert.equal(rec.count('end'), 1);
    assert.deepEqual(lastBody(s).events.map((ev) => [ev.i, ev.said]), [[0, 'llm'], [1, undefined]]);
  }
  // a mode listener resets the client while a failed reply is being wound up: that reply ends as aborted, with no onEnd
  for (const tail of ['whole sentence', 'half sentence']) {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    s.client.onMode(() => s.client.reset());
    s.fake.enqueue({ steps: [s.fake.OPEN, delta(tail === 'whole sentence' ? '中卒看着好吃。' : '中卒看着'), { event: 'error', data: { code: 'upstream_auth' } }] });
    const rec = recorder();
    const reply = thread.ask('intent', undefined, rec.handlers);
    await s.advance(0);
    assert.deepEqual(await reply.done, { aborted: true }, tail);
    assert.deepEqual(rec.names(), tail === 'whole sentence' ? ['start', 'segment', 'sentence'] : ['start', 'segment'], tail);
    assert.equal(s.client.offReason(), 'no_key', tail);
  }
});

test('a withdrawn try is no longer what the local narrator talks about', LIMIT, async () => {
  const s = setup();
  await s.online();
  const thread = s.client.beginTurn(TURN, newBook());
  thread.open({ kind: 'opp' }, 'silent', {});
  s.force = true;
  const held = await thread.tryMove(HELD, MORE, 'local', {}, { flags: { voiced: true } }).done;
  assert.equal(held.source, 'local');
  const tried = [OPP_SILENT, { i: 1, kind: 'try', n: 1, try: HELD, cue: 'wait', said: 'local', v: 0 }];
  // while the try is on the board, 为什么？ is about it
  const aboutTry = composeLocal(TURN, [...tried, { i: 2, kind: 'ask', ask: 'why', more: MORE }], 0);
  assert.notEqual(aboutTry, '');

  // 换一步, then 「对方想干什么？」 and 「为什么？」: the answer is not about the move that was taken back
  thread.retract();
  const intent = await thread.ask('intent', undefined, {}).done;
  const why = await thread.ask('why', undefined, {}).done;
  const bare = [OPP_SILENT, { i: 2, kind: 'ask', ask: 'intent', said: 'local', v: 0 }, { i: 3, kind: 'ask', ask: 'why' }];
  assert.notEqual(intent.text, '');
  assert.equal(intent.text, composeLocal(TURN, bare.slice(0, 2), 0));
  assert.equal(why.text, composeLocal(TURN, bare, 0), 'answered as in a turn without a try');
  assert.notEqual(why.text, aboutTry);
  assert.notEqual(why.text, composeLocal(TURN, [...tried, bare[1], bare[2]], 0), 'not what the thread with the try in it would give');
  // questions about a try have no subject now: nothing is said
  for (const code of ['good', 'reply', 'better', 'show']) {
    const rec = recorder();
    assert.equal((await thread.ask(code, undefined, rec.handlers).done).source, 'none', code);
    assert.deepEqual(rec.names(), ['start', 'end'], code);
  }

  // … also when the model is there: such a question does not travel, the model would take it for one about the old move
  s.force = false;
  const stale = await thread.ask('good', undefined, {}).done;
  assert.equal(stale.source, 'none');
  assert.equal(s.fake.coachCalls().length, 0);

  // on the wire the try is still part of the thread. The answers the proxy can re-create from it are said 'local'; the
  // 为什么？ it would re-create as a sentence about the try is recorded as said 'none'; the questions about the try never joined
  const asked = thread.ask('score', undefined, {});
  await s.advance(0);
  assert.equal((await asked.done).source, 'llm');
  let events = lastBody(s).events;
  assert.deepEqual(events, [
    OPP_SILENT,
    { i: 1, kind: 'try', n: 1, try: HELD, cue: 'wait', said: 'local', v: events[1].v },
    { i: 2, kind: 'ask', ask: 'intent', said: 'local', v: events[2].v },
    { i: 3, kind: 'ask', ask: 'why', said: 'none' },
    { i: 4, kind: 'ask', ask: 'score' },
  ]);
  assert.equal(composeLocal(TURN, events.slice(0, 3), events[2].v), intent.text);
  assert.deepEqual(s.fake.violations, []);

  // a long turn: the recap lists the withdrawn try, but not as the current one
  s.force = true;
  for (const code of ['danger', 'last', 'intent', 'score', 'danger']) await thread.ask(code, undefined, {}).done;      // i 5 .. 9
  const again = await thread.ask('why', undefined, {}).done;                   // i 10: the thread reaches 11 events
  assert.notEqual(again.text, '');
  assert.notEqual(again.text, aboutTry);
  s.force = false;
  const next = thread.ask('score', undefined, {});
  await s.advance(0);
  await next.done;
  events = lastBody(s).events;
  assert.deepEqual(events[0], { i: 0, kind: 'recap', recap: { tries: [{ move: HELD.move, cat: HELD.cat }], hint: 0 }, said: 'none' });
  assert.deepEqual(s.fake.violations, []);

  // the next try is on the board again: 为什么？ is about it, and the proxy re-creates that answer
  s.force = true;
  await thread.tryMove(HELD, MORE, 'local', {}, { flags: { voiced: true } }).done;
  const about = await thread.ask('why', undefined, {}).done;
  assert.equal(about.text, aboutTry);
  s.force = false;
  const last = thread.ask('score', undefined, {});
  await s.advance(0);
  await last.done;
  events = lastBody(s).events;
  const k = events.findIndex((ev) => ev.ask === 'why' && ev.more);
  assert.equal(events[k].said, 'local');
  assert.equal(composeLocal(TURN, events.slice(0, k + 1), events[k].v), about.text);
  assert.deepEqual(s.fake.violations, []);

  // the same when the try had moved into a recap before it was withdrawn
  {
    const off = setup({ apiBase: null });
    const long = off.client.beginTurn(TURN, newBook());
    long.open({ kind: 'opp' }, 'silent', {});
    await long.tryMove(HELD, MORE, 'local', {}, { flags: { voiced: true } }).done;
    for (const code of ['why', 'score', 'danger', 'intent', 'last', 'score', 'danger', 'intent', 'last']) await long.ask(code, undefined, {}).done;      // i 2 .. 10
    assert.equal((await long.ask('why', undefined, {}).done).text, aboutTry, 'the recap carries the try while it is on the board');
    long.retract();
    const after = await long.ask('why', undefined, {}).done;
    assert.notEqual(after.text, '');
    assert.notEqual(after.text, aboutTry);
  }
});

test('after a compaction the proxy re-creates the local sentences the child saw, and no other', LIMIT, async () => {
  /** Every said-'local' event of the last request, re-created the way the proxy does it, against what the child saw. */
  const recreated = (s, seen) => {
    const { turn, events } = lastBody(s);
    const out = [];
    events.forEach((ev, k) => {
      if (ev.said !== 'local') return;
      assert.equal(composeLocal(turn, events.slice(0, k + 1), ev.v), seen.get(ev.i), `event ${ev.i}`);
      out.push(ev.i);
    });
    return out;
  };
  const begin = async () => {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, newBook());
    thread.open({ kind: 'opp' }, 'silent', {});
    s.force = true;
    const seen = new Map();
    let i = 1;
    const say = async (start) => {
      const result = await start().done;
      assert.equal(result.source, 'local', `event ${i}`);
      seen.set(i++, result.text);
    };
    const ask = (code) => say(() => thread.ask(code, undefined, {}));
    await say(() => thread.tryMove(HELD, MORE, 'local', {}, { flags: { voiced: true } }));     // i 1
    await ask('why');                                                          // i 2: carries what the try withheld
    return { s, thread, seen, ask };
  };
  const online = async (s, thread) => {
    s.force = false;
    const asked = thread.ask('score', undefined, {});
    await s.advance(0);
    assert.equal((await asked.done).source, 'llm');
  };

  // The question that carried the withheld packet is replaced by the recap while answers that were given with it in view
  // stay: the packet moves to the first of them, so the proxy still re-creates every one.
  {
    const { s, thread, seen, ask } = await begin();
    for (const code of ['good', 'score', 'danger', 'reply', 'better', 'show', 'intent', 'last']) await ask(code);      // i 3 .. 10
    await online(s, thread);
    const events = lastBody(s).events;
    assert.deepEqual(events.map((ev) => ev.i), [0, 5, 6, 7, 8, 9, 10, 11]);
    assert.deepEqual(events[0].recap, { tries: [{ move: HELD.move, cat: HELD.cat }], hint: 0, cur: HELD });
    assert.deepEqual(events.filter((ev) => ev.more).map((ev) => [ev.i, ev.more]), [[6, MORE]], 'on the first kept question that may carry it');
    assert.deepEqual(recreated(s, seen), [5, 6, 7, 8, 9, 10]);
    assert.notEqual(seen.get(6), '');
    assert.notEqual(seen.get(7), '');
    assert.deepEqual(s.fake.violations, []);
  }
  // The try was withdrawn before the compaction: what it withheld is gone with it, and the answers that needed it can no
  // longer be re-created. They are recorded as said 'none' rather than as a sentence the child did not hear.
  {
    const { s, thread, seen, ask } = await begin();
    for (const code of ['score', 'danger', 'reply', 'better', 'show']) await ask(code);      // i 3 .. 7
    thread.retract();
    for (const code of ['intent', 'last', 'danger']) await ask(code);          // i 8 .. 10
    await online(s, thread);
    const events = lastBody(s).events;
    assert.deepEqual(events.map((ev) => [ev.i, ev.said]), [[0, 'none'], [5, 'none'], [6, 'none'], [7, 'none'], [8, 'local'], [9, 'local'], [10, 'local'], [11, undefined]]);
    assert.deepEqual(events[0].recap, { tries: [{ move: HELD.move, cat: HELD.cat }], hint: 0 });
    assert.equal(events.some((ev) => 'more' in ev), false);
    assert.equal(events.slice(1, 4).some((ev) => 'v' in ev), false);
    assert.deepEqual(recreated(s, seen), [8, 9, 10]);
    assert.deepEqual(s.fake.violations, []);
  }
});

test('off for the session stays off when another request answers late', LIMIT, async () => {
  for (const [first, late, reason] of [
    [{ status: 403, error: 'origin' }, { status: 429, error: 'rate', retryAfter: 5 }, 'origin'],
    [{ status: 400, error: 'bad_version' }, { steps: [{ event: 'open', data: {} }, { event: 'error', data: { code: 'upstream_auth' } }] }, 'version'],
    [{ status: 403, error: 'peer' }, { status: 500, error: 'mock_fail' }, 'origin'],
  ]) {
    const s = setup();
    await s.online();
    const one = s.client.beginTurn(TURN, newBook());
    const two = s.client.beginOver(F.over.turn, newBook());
    s.fake.enqueue({ ...first, delay: 100 }, { ...late, delay: 200 });
    const a = one.open({ kind: 'opp' }, 'auto', {});
    const b = two.open({ kind: 'over', over: F.over.events[0].over }, 'auto', {});
    await quiet(async () => {
      await s.advance(100);
      assert.equal((await a.done).source, 'local', reason);
      assert.equal(s.client.offReason(), reason);
      await s.advance(100);
      assert.equal((await b.done).aborted, false, reason);
    });
    assert.equal(s.client.status(), 'offline', reason);
    assert.equal(s.client.offReason(), reason);
    const total = s.fake.calls.length;
    await s.advance(3_600_000);
    await s.client.probe();
    assert.equal(s.client.status(), 'offline', reason);
    assert.equal(s.client.offReason(), reason);
    assert.equal(s.fake.calls.length, total, `${reason}: no request, no probe`);
    assert.deepEqual(s.modes, [{ mode: 'local', reason }], reason);
    assert.equal(s.timers.pending(), 0, reason);
  }
});

test('a reply always ends with onEnd, also when the book cannot be read', LIMIT, async () => {
  const broken = () => { throw new Error('book'); };
  const book = { base: null, add: broken, lookup: broken, resolveLoose: broken, size: () => 0 };
  // a local line with a move in it: nothing is said, the call does not throw, the thread is free again
  {
    const s = setup({ apiBase: null });
    const thread = s.client.beginTurn(TURN, book);
    thread.open({ kind: 'opp' }, 'silent', {});
    thread.tryMove(HELD, MORE, 'silent', {});
    const rec = recorder();
    const said = await quiet(async () => {
      const result = await thread.ask('reply', undefined, rec.handlers).done;
      assert.deepEqual(result, { aborted: false, text: '', segments: [], source: 'none', cut: false, refused: false });
    });
    assert.equal(said.errors.length, 1);
    assert.equal(rec.shown(), '');
    assert.deepEqual(rec.names().at(-1), 'end');
    assert.equal(rec.count('end'), 1);
    assert.equal(thread.busy(), false);
  }
  // the same in the middle of a streamed reply: what was shown is taken back, the request is given up, onEnd comes once
  {
    const s = setup();
    await s.online();
    const thread = s.client.beginTurn(TURN, book);
    thread.open({ kind: 'opp' }, 'silent', {});
    thread.tryMove(HELD, MORE, 'silent', {});
    s.fake.enqueue(s.fake.say('对方会走【马7进5】吃炮。', { size: 3, gap: 100 }));
    const rec = recorder();
    await quiet(async () => {
      const reply = thread.ask('reply', undefined, rec.handlers);
      await s.advance(1000);
      const result = await reply.done;
      assert.equal(result.aborted, false);
      assert.equal(result.source, 'none');
      assert.equal(result.text, '');
    });
    assert.equal(rec.shown(), '');
    assert.equal(rec.count('end'), 1);
    assert.equal(rec.names().at(-1), 'end');
    assert.equal(thread.busy(), false);
    assert.equal(s.fake.openStreams(), 0);
    assert.equal(s.timers.pending(), 0);
    // the event is in the thread as said 'none'
    const fine = s.client.beginTurn(TURN, newBook());
    const next = fine.open({ kind: 'opp' }, 'auto', {});
    await s.advance(0);
    assert.equal((await next.done).source, 'llm', 'the client itself is unharmed');
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Fuzz: random sequences of asks, tries, pouches, turn changes, undo and dispose, against a proxy that fails in every way
// ---------------------------------------------------------------------------------------------------------------------
//
// COACH_FUZZ=<n> runs n sequences (default 100); COACH_FUZZ_SEED=<int> sets the first seed; COACH_FUZZ_LOG=1 prints what the
// sequences covered; COACH_FUZZ_TRACE=1 prints every step as it happens. A failure names its seed.
// Checked after every step:
//   - every reply ends exactly once: onEnd with source llm / local / mixed / none, or, when the test aborted it, no handler at
//     all and `done` = {aborted: true}; no reply is still pending 21 s after it began; `done` never rejects
//   - what the handlers were given since the last onReset is exactly result.text: no half bracket, no text of a stale answer,
//     and a cut reply ('mixed') ends at a sentence end (or with the …… of the display cap)
//   - every POST body passes the proxy's checks (C1's validator, 64 KB, signatures, the resume token): fake.violations is empty
//   - every event a POST carries as said 'local' re-creates, the way the proxy does it, a sentence the child was given
//   - after interrupt / retract / end / reset no stream is open, no request is pending and no timer of the reply is left;
//     the signal handed to the tool executor has fired
//   - nothing is logged with console.error but a request the proxy rejected or a tool executor that threw, and there is no
//     unhandled rejection

const FUZZ_RUNS = Math.max(1, Number(process.env.COACH_FUZZ) || 100);
const FUZZ_SEED = Number(process.env.COACH_FUZZ_SEED) || 20261110;

const TRIES = [
  HELD, PLAIN,
  { ...PLAIN, cat: 'ok', loss: 40, toward: { area: 'left' } },
  { ...PLAIN, cat: 'good', only: true, vsPrev: 'better' },
  { ...HELD, cat: 'blunder', loss: 900, eval: { b: 'lost', mate: -2 }, flaws: [{ k: 'allow_mate' }] },
];
const MORES = [MORE, NO_BETTER, { reply: MORE.reply }, { better: MORE.better }, {}, null];
const SAYS = ['军师你好', FREE_SAY, '   ', '', undefined, '看 https://x.y/z', '「」【】〔〕', 'a'.repeat(300), '我的电话 13800138000', '\u0000', '为什么不能走【车五进九】？'];
const LONG_SENTENCE = '亮以为，此时不必急于进攻，先把车马炮都调到好位置上，再找对方阵形里的破绽，一举拿下才是上策。';
const PIECES = [
  '对方跳马出动，顺手护住了中卒。', '可以走【马二进三】。', '对方会走【马7进5】把炮吃掉！', '小心【车五进九】？', '这步不错', '先看【马7进', '5】再说。',
  '**好棋**，稳。', '详见 https://example.com/a?b=1 。', '👍走得好。', '第一行\n第二行。', '_', '……', '。', '【】', '【', '】', LONG_SENTENCE,
];
const GARBAGE = [
  'data: {oops\n\n', 'event: delta\ndata: {"x":1}\n\n', 'event: delta\ndata: "t"\n\n', 'event: done\ndata: {}\n\n', 'event: done\ndata: {"text": 5}\n\n',
  'event: done\ndata: {"text":"","sig":"x"}\n\n', 'event: done\ndata: {"text":"***","sig":"x"}\n\n', 'event: done\ndata: {"text":"没签名的话。"}\n\n',
  'event: tool\ndata: {"calls":"x","resume":"a.b"}\n\n', 'event: tool\ndata: {"calls":[],"resume":"not a token"}\n\n', 'event: tool\ndata: null\n\n',
  'event: error\ndata: {}\n\n', 'event: error\n\n', 'event: mystery\ndata: {"a":1}\n\n', 'event: delta\r\ndata: {"t":"好。"}\r\n\r\n', '\n\n\n', ': only a comment\n\n',
  '<html>captive portal</html>', new Uint8Array([0xff, 0xfe, 0x80, 0x0a, 0x0a]), new Uint8Array([0xe4, 0xb8]), 'x'.repeat(300_000),
];
const SSE_ERRORS = [
  { code: 'refused' }, { code: 'refused' }, { code: 'upstream_busy', retry_after: 2 }, { code: 'upstream_busy' }, { code: 'upstream_error' },
  { code: 'upstream_unreachable' }, { code: 'internal' }, { code: 'truncated' }, { code: 'empty' }, { code: 'upstream_rejected' }, { code: 'brand_new_code' }, {},
];
const HTTP_FAILURES = [
  { status: 429, error: 'rate', retryAfter: 1 }, { status: 429, error: 'rate', retryAfter: 30 }, { status: 429, error: 'rate' },
  { status: 429, text: 'Too Many Requests', headers: { 'retry-after': '3' } }, { status: 500, error: 'mock_fail' }, { status: 503, error: 'mock_fail' },
  { status: 502, text: '<html>Bad Gateway</html>' }, { status: 503, error: 'no_key' }, { status: 400, error: 'invalid' }, { status: 400, error: 'bad_signature' },
  { status: 413, error: 'too_large' }, { status: 403, error: 'free_text_off' }, { status: 404, error: 'not_found' },
];
const SESSION_ENDERS = [{ status: 403, error: 'origin' }, { status: 400, error: 'bad_version' }, { steps: [{ event: 'error', data: { code: 'upstream_auth' } }] }];
const TOOL_CALLS = [
  toolCall('c1'), toolCall('c2', { notation: '马二进三', after: [] }), toolCall('c3', { notation: '车五进九', after: [] }), { id: 'c4', name: 'other_tool', input: {} },
  { id: 'bad id!', name: 'analyze_move', input: TOOL_INPUT }, toolCall('c5', { notation: '马 二 进 三', after: [] }), toolCall('c6', { notation: '馬二進三', after: [] }),
  toolCall('c7', { notation: '炮２平５', after: ['马二进三'] }), toolCall('c8', { notation: '马二进三', after: ['a', 'b', 'c', 'd'] }), null, 'x', { id: 7 },
];
const TOOL_ANSWERS = [
  null, 42, 'x', { ok: true }, { ok: true, verdict: null }, { ok: false, error: 'weird' },
  { ok: false, error: 'no_such_move', at: 9, candidates: ['x', 5, '马二进三'] },
];
const ACTIONS = [
  ['ask', 26], ['try', 14], ['hint', 7], ['turn', 6], ['over', 2], ['advance', 24], ['interrupt', 4], ['retract', 4], ['end', 2], ['reset', 3],
  ['probe', 2], ['force', 2], ['burst', 4],
];
const EXPECTED_ERRORS = ['[coach] the proxy rejected the request', '[coach] the proxy rejected the resumed request', '[coach] the tool executor failed'];
/** How a reply that was cut may end: at a sentence end, or with the mark of a first sentence cut at the display cap (section 4.12 rule 7). */
const WHOLE_END_RE = /(?:[。！？][。！？”’」』）)》]*|……)$/;

test('the packets of the fuzz are valid on the wire', LIMIT, () => {
  for (const [k, packet] of TRIES.entries()) {
    const body = { v: 1, turn: TURN, events: [{ i: 0, kind: 'opp', said: 'none' }, { i: 1, kind: 'try', n: 1, try: packet }] };
    assert.deepEqual(validateCoachRequest(body), { ok: true, value: body }, `try ${k}`);
  }
  const over = { v: 1, turn: F.over.turn, events: [{ i: 0, kind: 'over', over: F.over.events[0].over, cue: 'win' }] };
  assert.equal(validateCoachRequest(over).ok, true);
  const resume = { v: 1, turn: TURN, events: [{ i: 0, kind: 'ask', ask: 'free', say: '问' }], resume: { token: 'a.b', results: [{ id: 'c1', ok: true, verdict: VERDICT }] } };
  assert.equal(validateCoachRequest(resume).ok, true);
});

/** What the fake proxy answers to one POST in a fuzz sequence. */
function randomReply(r, call) {
  const { rnd, pick, chance, fake } = r;
  const text = () => {
    if (chance(0.04)) return LONG_SENTENCE.repeat(10);                         // over 400 characters
    let out = '';
    for (let n = Math.floor(rnd() * 6); n > 0; n--) out += pick(PIECES);
    return out;
  };
  const pace = () => ({
    size: pick([1, 2, 3, 4, 8, 20]),
    gap: pick(r.calm ? [0] : [0, 0, 0, 0, 30, 300, 1200, 3900, 4100]),
    first: pick(r.calm ? [0, 0, 100] : [0, 0, 0, 0, 200, 1900, 2100, 3400, 3600, 7000]),
  });
  const stream = (t) => fake.say(t, pace())(call);
  const chunkBytes = pick([0, 0, 0, 1, 2, 3, 5, 7, 64]) || undefined;
  const legs = call.json && call.json.resume ? fake.signer.open(call.json.resume.token).legs.length : 0;
  const toolLegReply = () => {
    const calls = [];
    for (let n = 1 + Math.floor(rnd() * 3); n > 0; n--) calls.push(r.calm ? pick(TOOL_CALLS.slice(0, 3)) : pick(TOOL_CALLS));
    const real = calls.filter((c) => c && typeof c === 'object' && typeof c.id === 'string');
    const data = fake.toolData(call, real.map((c) => ({ id: c.id, name: String(c.name), input: c.input })), chance(0.4) ? '亮来摆一摆。' : '');
    data.calls = calls;
    const steps = [fake.OPEN];
    if (data.text) steps.push(delta(data.text));
    if (!r.calm && chance(0.3)) steps.push({ wait: pick([100, 1500, 3000]) });
    steps.push({ event: 'tool', data });
    return { steps, chunkBytes };
  };

  if (r.calm) return chance(0.8) ? { ...stream(text()), chunkBytes } : toolLegReply();
  if (legs > 0 && chance(0.1)) return { status: 400, error: 'invalid' };       // an expired resume token
  const roll = rnd();
  if (roll < 0.34) {
    const reply = stream(text());
    if (chance(0.3)) reply.steps.splice(1 + Math.floor(rnd() * reply.steps.length), 0, { ping: true });
    return { ...reply, chunkBytes };
  }
  if (roll < 0.44) {                                                           // cut anywhere: in a token, a character, a bracket
    const reply = stream(text() || '好。');
    let total = 0;
    for (const step of reply.steps) if ('event' in step) total += new TextEncoder().encode(`event: ${step.event}\ndata: ${JSON.stringify(step.data)}\n\n`).length;
    return { ...reply, chunkBytes, cutAt: Math.floor(rnd() * (total + 1)), cutHow: pick(['close', 'close', 'drop', 'hang']) };
  }
  if (roll < 0.54) return chance(0.03) ? pick(SESSION_ENDERS) : pick(HTTP_FAILURES);
  if (roll < 0.64) {
    const steps = [fake.OPEN];
    for (let n = Math.floor(rnd() * 4); n > 0; n--) steps.push(delta(pick(PIECES)));
    steps.push({ event: 'error', data: pick(SSE_ERRORS) });
    return { steps, chunkBytes };
  }
  if (roll < 0.69) return chance(0.5) ? { hang: true } : { ...stream('好。'), delay: pick([500, 3000, 5000, 25_000]) };
  if (roll < 0.75) {
    const steps = [fake.OPEN];
    for (let n = Math.floor(rnd() * 3); n > 0; n--) steps.push(delta(pick(PIECES)));
    steps.push({ hang: true });
    return { steps, chunkBytes };
  }
  if (roll < 0.82) {
    const steps = chance(0.5) ? [fake.OPEN] : [];
    if (chance(0.5)) steps.push(delta(pick(PIECES)));
    const raw = pick(GARBAGE);
    steps.push({ raw });
    if (chance(0.5)) steps.push({ hang: true });
    // (a very long body is not cut into single bytes: a stream with 300 000 queued chunks is slow in Node itself)
    return { steps, chunkBytes: raw.length > 4096 ? undefined : chunkBytes };
  }
  if (roll < 0.97) return toolLegReply();
  return { reject: new TypeError('fetch failed') };
}

/**
 * One random sequence.
 * @param {number} seed
 * @param {Record<string, number>} tally counts what happened, over all sequences
 * @returns {Promise<string[]>} what went wrong (empty: nothing)
 */
async function fuzzSequence(seed, tally) {
  const count = (key, n = 1) => { tally[key] = (tally[key] ?? 0) + n; };
  const rnd = mulberry32(seed);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const chance = (p) => rnd() < p;
  const problems = [];
  const trace = [];
  if (process.env.COACH_FUZZ_TRACE) {                                          // every step as it happens, for a sequence that hangs
    trace.push = (what) => {
      process.stderr.write(`${what}\n`);
      return Array.prototype.push.call(trace, what);
    };
  }
  const problem = (what) => { problems.push(`${what} [after: ${trace.slice(-6).join(' > ')}]`); };

  const s = setup();
  const { timers, fake, client } = s;
  const book = newBook();
  const flaky = chance(0.25);
  const calm = chance(0.3);
  if (flaky) {
    fake.health = () => pick([HEALTH_OK, HEALTH_OK, HEALTH_OK, HEALTH_OK, { status: 500, error: 'x' }, { json: { ok: false, v: 1, mode: 'off', reason: 'no_key' } },
      { ...HEALTH_OK, delay: 1000 }, { hang: true }, { status: 200, text: 'nonsense' }, { reject: new TypeError('fetch failed') }]);
  }
  fake.coach = (call) => randomReply({ rnd, pick, chance, fake, calm }, call);

  const trackers = [];
  const state = { thread: null, dead: true, current: null, aborted: null, lastId: 0 };
  const toolTimers = new Set();
  /** Every local sentence the child was given, without brackets (a move that is in no book is shown without them). */
  const heard = new Set();
  const bare = (text) => text.replace(/[【】]/g, '');
  let audited = 0;

  /** One call of the sandbox. A call that has not answered when its reply is aborted must see its signal fire. */
  s.tool.impl = (input, ctx) => {
    const running = { signal: ctx.signal, answered: false };
    if (state.current) state.current.tools.push(running);
    if (ctx.thread !== state.thread) problem('the tool executor got another thread');
    if (ctx.signal.aborted) problem('the tool executor was started for a reply that had been aborted');
    let answer;
    try {
      answer = sandbox(ctx);
    } catch (err) {
      running.answered = true;
      throw err;
    }
    const mark = () => { running.answered = true; };
    answer.then(mark, mark);
    return answer;
  };
  const sandbox = (ctx) => {
    const roll = calm ? rnd() * 0.5 : rnd();
    if (roll < 0.45) return Promise.resolve({ ok: true, verdict: VERDICT });
    if (roll < 0.55) {
      return new Promise((resolve) => {
        const id = timers.setTimer(() => {
          toolTimers.delete(id);
          resolve({ ok: true, verdict: VERDICT });
        }, pick([100, 1500, 2500]));
        toolTimers.add(id);
        ctx.signal.addEventListener('abort', () => { if (toolTimers.delete(id)) timers.clearTimer(id); });
      });
    }
    if (roll < 0.70) return Promise.resolve({ ok: false, error: pick(['no_such_move', 'ambiguous', 'syntax', 'game_over', 'busy', 'limit']), at: pick([0, 1]), candidates: ['炮2平5', '炮8平9'] });
    if (roll < 0.78) return new Promise(() => {});
    if (roll < 0.86) {
      if (chance(0.5)) throw new Error('sandbox crashed');
      return Promise.reject(new Error('sandbox rejected'));
    }
    return Promise.resolve(pick(TOOL_ANSWERS));
  };

  /** Starts one reply through `start(handlers)` and follows it. */
  function send(what, start, how = {}) {
    trace.push(what);
    const prev = state.current;
    if (prev && !prev.ended && !prev.settled) prev.stale = true;               // a new send aborts the reply in flight
    const thread = state.thread;
    const tr = {
      what, stale: false, ended: false, settled: false, started: false, checked: false, result: undefined, endResult: undefined,
      shown: '', startedAt: timers.now(), tools: [], silent: how.silent === true, dead: state.dead,
    };
    // Now and then a handler itself interrupts the reply (a tap on 停 while a segment is drawn), or asks the next question
    // from onEnd: nothing more may be delivered to this reply, and the thread must be free for the next one.
    const bomb = chance(0.04) ? pick(['onStart', 'onSegment', 'onSegment', 'onSentence', 'onReset', 'onTool']) : null;
    const chain = chance(0.03);
    const called = (name) => {
      if (tr.silent) problem(`${what}: ${name} on a silent event`);
      if (tr.dead) problem(`${what}: ${name} on a dead thread`);
      if (tr.stale) problem(`${what}: ${name} after the reply was aborted`);
      if (tr.ended) problem(`${what}: ${name} after onEnd`);
      if (name !== 'onStart' && !tr.started) problem(`${what}: ${name} before onStart`);
      if (name === 'onStart') tr.started = true;
      if (bomb === name && !tr.stale && thread === state.thread && !state.dead) {
        trace.push(`interrupt inside ${name}`);
        tr.stale = true;
        thread.interrupt();
      }
    };
    const handlers = {
      onStart() { called('onStart'); },
      onSegment(seg) {
        called('onSegment');
        if (seg.type === 'move') {
          if (!seg.link || typeof seg.link.code !== 'string') problem(`${what}: a move segment without a link`);
          tr.shown += `【${seg.notation}】`;
        } else {
          if (/[【】]/.test(seg.text)) problem(`${what}: a bracket reached the screen: ${JSON.stringify(seg.text)}`);
          tr.shown += seg.text;
        }
      },
      onSentence() { called('onSentence'); },
      onReset() { called('onReset'); tr.shown = ''; },
      onTool() { called('onTool'); },
      onEnd(result) {
        called('onEnd');
        tr.ended = true;
        tr.endResult = result;
        if (result.source === 'local') heard.add(bare(result.text));
        if (thread.busy()) problem(`${what}: the thread is still busy inside onEnd`);
        if (chain && thread === state.thread && !state.dead) send('ask(score) inside onEnd', (h) => thread.ask('score', undefined, h));
      },
    };
    state.current = tr;
    state.aborted = null;                                                      // a new reply is under way: "nothing is left" is checked elsewhere
    trackers.push(tr);
    const before = state.lastId;
    const reply = start(handlers);                                             // (a handler may have sent the next event already)
    if (!tr.dead && !(reply.id > before)) problem(`${what}: reply ids do not count up`);
    if (!tr.dead) state.lastId = Math.max(state.lastId, reply.id);
    reply.done.then((result) => { tr.settled = true; tr.result = result; }, () => { problem(`${what}: done rejected`); });
  }

  function abortBy(how) {
    trace.push(how);
    const cur = state.current;
    if (cur && !cur.ended && !cur.settled) cur.stale = true;
    if (how === 'reset') client.reset();
    else if (state.thread) state.thread[how]();
    if (how === 'reset' || how === 'end') state.dead = true;
    state.aborted = how;
  }

  function begin(kind) {
    if (state.thread && !state.dead) abortBy(pick(['end', 'end', 'reset', 'interrupt']));
    state.dead = false;
    state.lastId = 0;
    if (kind === 'over') {
      state.thread = client.beginOver(F.over.turn, book);
      const mode = pick(['auto', 'auto', 'local', 'silent']);
      const thread = state.thread;
      send(`over(${mode})`, (h) => thread.open({ kind: 'over', over: F.over.events[0].over }, mode, h), { silent: mode === 'silent' });
    } else {
      state.thread = client.beginTurn(TURN, book);
      const mode = pick(['auto', 'auto', 'local', 'silent', 'silent']);
      const first = pick([{ kind: 'opp' }, { kind: 'opp' }, { kind: 'start', first: true }, { kind: 'start' }]);
      const thread = state.thread;
      send(`open(${first.kind},${mode})`, (h) => thread.open(first, mode, h), { silent: mode === 'silent' });
    }
  }

  function act(name) {
    const thread = state.thread;
    if (['ask', 'try', 'hint', 'burst'].includes(name) && (!thread || (state.dead && !chance(0.08)))) {
      begin('turn');
      return;
    }
    switch (name) {
      case 'ask': {
        const code = pick(ASK_CODES);
        const say = code === 'free' || chance(0.05) ? pick(SAYS) : undefined;
        send(`ask(${code})`, (h) => thread.ask(code, say, h));
        break;
      }
      case 'try': {
        const mode = pick(['auto', 'auto', 'local', 'silent']);
        const flags = pick([undefined, {}, { voiced: true }, { earned: true }, { earned: true, lord: true }]);
        send(`try(${mode})`, (h) => thread.tryMove(pick(TRIES), pick(MORES), mode, h, flags ? { flags } : undefined), { silent: mode === 'silent' });
        break;
      }
      case 'hint': {
        const level = pick([1, 2, 3]);
        const mode = pick(['auto', 'local']);
        send(`hint(${level},${mode})`, (h) => thread.hint(level, HINTS[level - 1], mode, h));
        break;
      }
      case 'burst':
        send('ask(score)', (h) => thread.ask('score', undefined, h));
        send('ask(why)', (h) => thread.ask('why', undefined, h));
        break;
      case 'turn':
      case 'over':
        begin(name);
        break;
      case 'interrupt':
      case 'retract':
      case 'end':
        if (thread && !state.dead) abortBy(name);
        break;
      case 'reset':
        abortBy('reset');
        break;
      case 'probe':
        trace.push('probe');
        client.probe();
        break;
      case 'force':
        trace.push('force');
        s.force = !s.force;
        break;
      default:
        break;
    }
  }

  /** The invariants. `final`: every reply must have ended by now. */
  function audit(final) {
    let pending = 0;
    for (const tr of trackers) {
      if (tr.checked) continue;
      if (tr.ended) {
        tr.checked = true;
        const r = tr.result;
        if (!tr.settled) problem(`${tr.what}: onEnd, but done is not resolved`);
        else if (r !== tr.endResult) problem(`${tr.what}: done and onEnd disagree`);
        else if (r.aborted !== false) problem(`${tr.what}: onEnd with an aborted result`);
        else {
          if (!['llm', 'local', 'mixed', 'none'].includes(r.source)) problem(`${tr.what}: source ${r.source}`);
          if ((r.text === '') !== (r.source === 'none')) problem(`${tr.what}: source ${r.source} with text ${JSON.stringify(r.text)}`);
          if (tr.shown !== r.text) problem(`${tr.what}: the screen shows ${JSON.stringify(tr.shown)}, the result says ${JSON.stringify(r.text)}`);
          const joined = r.segments.map((seg) => (seg.type === 'move' ? `【${seg.notation}】` : seg.text)).join('');
          if (joined !== r.text) problem(`${tr.what}: segments and text disagree`);
          if (r.source === 'mixed' && (!r.cut || !WHOLE_END_RE.test(r.text))) problem(`${tr.what}: half a sentence kept: ${JSON.stringify(r.text)}`);
          if (typeof r.cut !== 'boolean' || typeof r.refused !== 'boolean') problem(`${tr.what}: result shape`);
        }
      } else if (tr.stale || tr.dead) {
        tr.checked = true;
        if (!tr.settled) problem(`${tr.what}: aborted, but done is not resolved`);
        else if (tr.result.aborted !== true) problem(`${tr.what}: aborted, but done has a result`);
        if (tr.started && tr.dead) problem(`${tr.what}: a dead thread spoke`);
        for (const tool of tr.tools) if (!tool.answered && !tool.signal.aborted) problem(`${tr.what}: the tool signal did not fire`);
      } else if (tr.settled) {
        tr.checked = true;
        if (!tr.silent) problem(`${tr.what}: done resolved without onEnd`);
        else if (tr.result.aborted !== false || tr.result.source !== 'none' || tr.result.text !== '') problem(`${tr.what}: a silent event with a result`);
      } else {
        pending += 1;
        if (final || timers.now() - tr.startedAt > 21_000) problem(`${tr.what}: still pending after ${timers.now() - tr.startedAt} ms`);
      }
    }
    if (pending > 1) problem(`${pending} replies in flight`);
    if (state.thread && !state.dead && state.thread.busy() !== (pending === 1)) problem(`busy() is ${state.thread.busy()} with ${pending} replies in flight`);
    if (fake.violations.length > 0) {
      problem(`the proxy would reject: ${fake.violations.join('; ')}`);
      fake.violations.length = 0;
    }
    // what the proxy re-creates for an event that was answered locally (section 7.2) is a sentence the child was given
    const posts = fake.coachCalls();
    for (; audited < posts.length; audited++) {
      const body = posts[audited].json;
      if (!body || !Array.isArray(body.events)) continue;
      body.events.forEach((ev, k) => {
        if (ev.said !== 'local') return;
        const again = composeLocal(body.turn, body.events.slice(0, k + 1), ev.v);
        if (again === '' || !heard.has(bare(again))) problem(`request ${posts[audited].n}: event ${ev.i} was never answered with ${JSON.stringify(again)}`);
      });
    }
    if (state.aborted) {                                                       // after interrupt / retract / end / reset: nothing of the reply is left
      const how = state.aborted;
      state.aborted = null;
      const waitingHealth = fake.healthCalls().filter((call) => call.state === 'pending').length;
      const busyPosts = fake.coachCalls().filter((call) => call.state === 'pending' || call.state === 'open').length;
      if (busyPosts > 0 || fake.openStreams() > 0) problem(`${how}: ${busyPosts} requests and ${fake.openStreams()} streams are still open`);
      if (fake.pendingTimers() > waitingHealth) problem(`${how}: the fake proxy still has ${fake.pendingTimers()} timers`);
      if (toolTimers.size > 0) problem(`${how}: the tool executor still runs`);
      const ofClient = timers.pending() - fake.pendingTimers() - toolTimers.size;
      if (ofClient > 1 + waitingHealth) problem(`${how}: ${ofClient} timers of the client are left`);
    }
  }

  const said = await quiet(async () => {
    const total = ACTIONS.reduce((sum, [, weight]) => sum + weight, 0);
    if (chance(0.7)) {
      client.probe();
      await s.advance(0);
    }
    const steps = 12 + Math.floor(rnd() * 30);
    for (let k = 0; k < steps && problems.length === 0; k++) {
      let roll = rnd() * total;
      let name = ACTIONS[0][0];
      for (const [action, weight] of ACTIONS) {
        name = action;
        roll -= weight;
        if (roll < 0) break;
      }
      if (name === 'advance') {
        const ms = pick([0, 1, 50, 300, 800, 2000, 3500, 4000, 12_000, 20_000, 61_000]);
        trace.push(`+${ms}`);
        await s.advance(ms);
      } else {
        act(name);
        await s.advance(0);
      }
      audit(false);
    }
    if (problems.length > 0) return;

    // Whatever happened: with a working proxy the thread can still travel, and is still valid.
    trace.push('recover');
    s.force = false;
    fake.health = HEALTH_OK;
    fake.coach = fake.say('眼下双方大致相当。');
    await s.advance(25_000);
    audit(true);
    await s.advance(1_300_000);
    client.probe();
    await s.advance(3000);
    if (client.status() !== 'online' && !['origin', 'version'].includes(client.offReason())) problem(`did not recover: ${client.status()} / ${client.offReason()}`);
    if (!state.thread || state.dead) begin('turn');
    await s.advance(25_000);
    const thread = state.thread;
    send('ask(score)', (h) => thread.ask('score', undefined, h));
    await s.advance(25_000);
    audit(true);

    // Dispose in mid-flight: nothing is left behind.
    fake.coach = fake.say(LONG_SENTENCE, { size: 2, gap: 500 });
    send('ask(danger)', (h) => thread.ask('danger', undefined, h));
    await s.advance(pick([0, 300, 700, 1600]));
    abortBy(pick(['end', 'reset']));
    await s.advance(0);
    audit(false);
    await s.advance(30_000);
    audit(true);
    if (timers.pending() !== 0) problem(`${timers.pending()} timers are left at the end`);
    if (fake.openStreams() !== 0 || fake.pendingRequests() !== 0) problem('a request or a stream is left at the end');
  });
  for (const line of said.errors) {
    if (!EXPECTED_ERRORS.some((start) => line.startsWith(start))) problems.push(`console.error: ${line.slice(0, 300)}`);
  }
  for (const tr of trackers) count(tr.result?.aborted === false ? `reply:${tr.result.source}` : tr.dead ? 'reply:dead thread' : 'reply:aborted');
  for (const [key, n] of Object.entries(client.stats())) count(`stats.${key}`, n);
  count('posts', fake.coachCalls().length);
  count('posts with resume', fake.coachCalls().filter((call) => call.json?.resume).length);
  count('posts aborted', fake.coachCalls().filter((call) => call.aborted).length);
  count('posts with a recap', fake.coachCalls().filter((call) => call.json?.events?.[0]?.kind === 'recap').length);
  count('probes', fake.healthCalls().length);
  count('tool calls', s.tool.calls.length);
  return problems;
}

test(`fuzz: ${FUZZ_RUNS} random conversations against a failing proxy keep every invariant`, { timeout: 60_000 + FUZZ_RUNS * 300 }, async () => {
  const failures = [];
  const tally = {};
  for (let k = 0; k < FUZZ_RUNS && failures.length < 5; k++) {
    const seed = FUZZ_SEED + k;
    const began = Date.now();
    const problems = await fuzzSequence(seed, tally);
    if (process.env.COACH_FUZZ_LOG && Date.now() - began > 1000) console.log(`fuzz seed ${seed}: ${Date.now() - began} ms`);
    if (problems.length > 0) failures.push(`seed ${seed}: ${problems.slice(0, 4).join('\n    ')}`);
  }
  if (process.env.COACH_FUZZ_LOG) console.log(`fuzz tally: ${JSON.stringify(tally)}`);
  assert.deepEqual(failures, []);
  // the sequences did reach every way a reply can end
  for (const key of ['reply:llm', 'reply:local', 'reply:mixed', 'reply:none', 'reply:aborted', 'posts with resume', 'posts with a recap']) {
    assert.equal(tally[key] > 0, true, `the fuzz never produced: ${key}`);
  }
  await settle();
  assert.deepEqual(unhandled, [], 'no unhandled rejection in the whole file');
});
