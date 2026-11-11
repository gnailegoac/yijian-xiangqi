import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AVOIDED_WORDS, BANNED_WORDS, BARS, KINDS, SCRIPT, barLines, countLines, createObserver, createSseParser, failedBars, gameLines,
  judgeBars, judgeReply, knownNotations, lastEvent, median, parseArgs, percentile, prepareFixture, replayFixtures, runBench, summarize,
  tableLines,
} from '../../../scripts/coach-bench.js';
import { startServer } from '../../../scripts/serve.js';
import { handleRequest } from '../../../server/coach-handler.js';

// scripts/coach-bench.js, the live acceptance of contract section 14.8. Nobody here has a key or a network, so the
// bench is proven in two ways. Its rules are pure functions (which fixture replays, what a reply is measured by,
// the numbers of a run, every bar at its edge, the printed lines) and are tested on hand-built data. Its plumbing
// (the observing fetch, the replay with its tool round, the scripted game on the game's own modules) runs against
// the real handler in mock mode: called directly, and once through scripts/serve.js on an ephemeral loopback port.
//
// Memory safety (CONTRACT-NOTES 125, 128): every test has a time limit, every awaited run is bounded, and the game
// of the smoke test has deadlines of its own; bulky results are compared field by field.

const BENCH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'coach-bench.js');
const FIXTURE_DIR = new URL('../../fixtures/coach/', import.meta.url);
const FIXTURE_NAMES = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json')).sort();
const fixture = (name) => JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), 'utf8'));

/** The handler's environment: mock mode, limits no test can reach. */
const MOCK_ENV = {
  COACH_MOCK: '1', COACH_MOCK_CHUNK_MS: '1',
  COACH_RATE_BURST: '100000', COACH_RATE_PER_MIN: '100000', COACH_IP_DAILY: '100000', COACH_GLOBAL_DAILY: '100000',
};
const BASE = 'http://127.0.0.1:5173/api';

/** A fetch that is the real handler in mock mode: no socket, no server. */
const handlerFetch = (input, init) => handleRequest(new Request(input, init), MOCK_ENV, { ip: '127.0.0.1', loopbackListen: true });

let overdue = false;
/** Waits for `promise` at most `ms`. */
function within(promise, ms, what) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => { overdue = true; reject(new Error(`${what} did not finish within ${ms} ms`)); }, ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
// A run that never ended may still own a worker thread or a server, which would keep this process alive: end it.
after(() => {
  if (overdue) setTimeout(() => process.exit(1), 200).unref();
});

/** Silences the handler's one log line per request for the duration of a test. */
const hush = (t) => { t.mock.method(console, 'log', () => {}); };

// ---------------------------------------------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------------------------------------------

test('parseArgs: the defaults are the dev server, 5 runs, 30 moves, seed 1, both parts', { timeout: 5000 }, () => {
  assert.deepEqual(parseArgs([]), { base: 'http://127.0.0.1:5173/api', runs: 5, moves: 30, seed: 1, pace: null, only: null, json: null, help: false });
});

test('parseArgs: every option, with the value as the next argument or after =', { timeout: 5000 }, () => {
  const spaced = parseArgs(['--base', 'http://192.168.1.50:5173/api/', '--runs', '2', '--moves', '12', '--seed', '77', '--pace', '0', '--only', 'game', '--json', 'out.json']);
  assert.deepEqual(spaced, { base: 'http://192.168.1.50:5173/api', runs: 2, moves: 12, seed: 77, pace: 0, only: 'game', json: 'out.json', help: false });
  const inline = parseArgs(['--base=https://chess.example.org/api', '--runs=1', '--only=fixtures', '--pace=2500']);
  assert.equal(inline.base, 'https://chess.example.org/api');
  assert.equal(inline.runs, 1);
  assert.equal(inline.only, 'fixtures');
  assert.equal(inline.pace, 2500);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('parseArgs: an unknown option, a missing value and a value out of range throw', { timeout: 5000 }, () => {
  assert.throws(() => parseArgs(['--fast']), /unknown option --fast/);
  assert.throws(() => parseArgs(['--runs']), /--runs needs a value/);
  assert.throws(() => parseArgs(['--runs', '0']), /--runs must be a whole number from 1 to 50/);
  assert.throws(() => parseArgs(['--runs', '2.5']), /--runs must be a whole number/);
  assert.throws(() => parseArgs(['--moves', '0']), /--moves must be a whole number from 1 to 200/);
  assert.throws(() => parseArgs(['--pace', '-1']), /--pace must be a whole number/);
  assert.throws(() => parseArgs(['--only', 'both']), /--only takes fixtures or game/);
  assert.throws(() => parseArgs(['--base', '127.0.0.1:5173']), /--base must be an http or https URL/);
  assert.throws(() => parseArgs(['--base', 'file:///etc/passwd']), /--base must be an http or https URL/);
  assert.throws(() => parseArgs(['--help=1']), /unknown option/);
});

test('the command line: an unknown option prints the usage line and exits with 2; --help exits with 0; no proxy exits with 2', { timeout: 60000 }, () => {
  const run = (...args) => spawnSync(process.execPath, [BENCH, ...args], { encoding: 'utf8', timeout: 30000 });
  const bad = run('--fast');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown option --fast/);
  assert.match(bad.stderr, /node scripts\/coach-bench\.js \[--base/);
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /node scripts\/coach-bench\.js \[--base/);
  // nothing listens on the discard port of this machine: the bench says how to start a proxy and measures nothing
  const none = run('--base', 'http://127.0.0.1:9/api', '--runs', '1');
  assert.equal(none.status, 2, none.stdout + none.stderr);
  assert.match(none.stdout, /连不上 http:\/\/127\.0\.0\.1:9\/api\/health/);
  assert.match(none.stdout, /npm start/);
});

// ---------------------------------------------------------------------------------------------------------------
// which fixtures replay
// ---------------------------------------------------------------------------------------------------------------

test('prepareFixture: start, opp, try, over and recap replay as stored; a signed earlier reply is sent as said none; a resume leg is skipped', { timeout: 5000 }, () => {
  assert.equal(FIXTURE_NAMES.length, 13);
  const asStored = [], changed = [], skipped = [];
  for (const name of FIXTURE_NAMES) {
    const stored = fixture(name);
    const live = prepareFixture(stored, 'live');
    if (live === null) { skipped.push(name); continue; }
    (live.changed === 0 ? asStored : changed).push(name);
    assert.deepEqual(stored, fixture(name), `${name}: the stored object is not touched`);
    // nothing with a signature travels, and the event to answer is the stored one
    for (const event of live.body.events) {
      assert.notEqual(event.said, 'llm', name);
      assert.equal('reply' in event, false, name);
      assert.equal('tools' in event, false, name);
    }
    assert.deepEqual(live.body.events.at(-1), stored.events.at(-1), name);
    assert.deepEqual(live.body.turn, stored.turn, name);
    assert.equal(live.body.events.length, stored.events.length, name);
    assert.equal(live.changed, stored.events.filter((e) => e.said === 'llm').length, name);
    if (live.changed === 0) assert.deepEqual(live.body, stored, name);
    // a mock proxy gets the same body: the placeholder signature verifies under no key
    assert.deepEqual(prepareFixture(stored, 'mock'), live, name);
  }
  assert.deepEqual(asStored, ['opp.json', 'over.json', 'recap.json', 'start.json', 'try.json']);
  assert.deepEqual(changed, ['ask-chip.json', 'ask-free.json', 'ask-tools.json', 'hint.json', 'try-held-ask.json', 'try-held.json']);
  assert.deepEqual(skipped, ['ask-free-resume-failed.json', 'ask-free-resume.json']);
  assert.equal(prepareFixture(fixture('ask-free-resume.json'), 'mock'), null, 'its first event carries a placeholder signature: the token would not fit the changed body');

  // an event of the model that used the tool loses the tool record with the reply
  const tools = prepareFixture(fixture('ask-tools.json'), 'live');
  assert.deepEqual(tools.body.events[2], { i: 2, kind: 'ask', ask: 'free', said: 'none' });
  assert.equal(tools.changed, 2);

  // a resume leg whose body needs no change replays against a mock proxy as stored, and never against a live one
  const clean = fixture('ask-free-resume.json');
  clean.events[0] = { i: 0, kind: 'opp', said: 'none' };
  assert.deepEqual(prepareFixture(clean, 'mock'), { body: clean, changed: 0 });
  assert.equal(prepareFixture(clean, 'live'), null);
});

test('every fixture prepared for a proxy is accepted by the real handler in mock mode', { timeout: 20000 }, async (t) => {
  hush(t);
  for (const name of FIXTURE_NAMES) {
    const prepared = prepareFixture(fixture(name), 'live');
    if (!prepared) continue;
    const response = await handlerFetch(`${BASE}/coach`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' }, body: JSON.stringify(prepared.body),
    });
    const text = await response.text();
    assert.equal(response.status, 200, `${name}: ${text}`);
    assert.match(text, /\nevent: (?:done|tool)\n/, `${name}: the stream ends with a reply or a tool call`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// the stream parser
// ---------------------------------------------------------------------------------------------------------------

test('createSseParser: events in order whatever the chunk boundaries; pings and broken blocks are dropped', { timeout: 5000 }, () => {
  const text = 'event: open\ndata: {"v":1,"mode":"live"}\n\n'
    + ': ping\n\n'
    + 'event: delta\ndata: {"t":"中卒看着好吃，"}\n\n'
    + 'event: delta\ndata: not json\n\n'
    + 'data: {"orphan":true}\n\n'
    + 'event: done\r\ndata: {"text":"中卒看着好吃，","stop":"end"}\r\n\r\n';
  const expected = [['open', { v: 1, mode: 'live' }], ['delta', { t: '中卒看着好吃，' }], ['done', { text: '中卒看着好吃，', stop: 'end' }]];
  const bytes = new TextEncoder().encode(text);
  // every way of cutting the stream into two pieces (also in the middle of a character), and byte by byte
  const cuts = [...Array(bytes.length + 1).keys()].map((at) => [bytes.subarray(0, at), bytes.subarray(at)]);
  cuts.push([...bytes].map((byte) => Uint8Array.of(byte)));
  for (const pieces of cuts) {
    const seen = [];
    const parser = createSseParser((event, data) => seen.push([event, data]));
    for (const piece of pieces) parser.push(piece);
    parser.end();
    assert.deepEqual(seen, expected);
  }
  // a block is delivered as soon as its blank line has arrived, not at the end
  const seen = [];
  const parser = createSseParser((event) => seen.push(event));
  parser.push(new TextEncoder().encode('event: open\ndata: {}\n\nevent: delta\ndata: {"t":"a"}'));
  assert.deepEqual(seen, ['open']);
  parser.push(new TextEncoder().encode('\n\n'));
  assert.deepEqual(seen, ['open', 'delta']);
  // also when the line breaks are CR LF and a chunk ends between the two
  for (const piece of ['event: done\r', '\ndata: {"text":"好"}\r', '\n\r']) parser.push(new TextEncoder().encode(piece));
  assert.deepEqual(seen, ['open', 'delta']);
  parser.push(new TextEncoder().encode('\n'));
  assert.deepEqual(seen, ['open', 'delta', 'done']);
});

// ---------------------------------------------------------------------------------------------------------------
// one reply against its request
// ---------------------------------------------------------------------------------------------------------------

test('lastEvent: the kind of the event to answer, with the ask code or the pouch number', { timeout: 5000 }, () => {
  const kinds = Object.fromEntries(FIXTURE_NAMES.map((name) => {
    const { kind, detail } = lastEvent(fixture(name));
    return [name, detail ? `${kind}:${detail}` : kind];
  }));
  assert.deepEqual(kinds, {
    'ask-chip.json': 'ask:intent', 'ask-free-resume-failed.json': 'ask:free', 'ask-free-resume.json': 'ask:free', 'ask-free.json': 'ask:free',
    'ask-tools.json': 'ask:why', 'hint.json': 'hint:3', 'opp.json': 'opp', 'over.json': 'over', 'recap.json': 'ask:better', 'start.json': 'start',
    'try-held-ask.json': 'ask:reply', 'try-held.json': 'try', 'try.json': 'try',
  });
  assert.deepEqual([...KINDS], ['start', 'opp', 'try', 'hint', 'ask', 'over']);
});

test('knownNotations: what the prompt of a request holds, both forms of the threat line, tool results, the child\'s own words; never the examples of the system prompt', { timeout: 5000 }, () => {
  // the brief of try.json: the two moves played and the line of the trial
  assert.deepEqual([...knownNotations(fixture('try.json'))].sort(), ['炮二平五', '车9平8', '车一平二', '马8进7', '马二进三'].sort());
  // the system prompt shows 【炮二平五】 and 【马8进7】 as examples of the writing: they are no moves of a new game
  assert.deepEqual([...knownNotations(fixture('start.json'))], []);

  // a threat that stands and one that needs its move first (the second form of the threat line): the move is known in both
  const stands = fixture('opp.json');
  assert.ok(knownNotations(stands).has('炮5进4'));
  const later = fixture('opp.json');
  later.turn.threats[0].prep = true;
  assert.ok(knownNotations(later).has('炮5进4'));
  assert.deepEqual([...knownNotations(later)].sort(), [...knownNotations(stands)].sort());

  // a typed question names its moves without brackets; the result of the tool round brings the reply to them
  const asked = prepareFixture(fixture('ask-free.json'), 'live').body;
  assert.ok(knownNotations(asked).has('炮2平5') && knownNotations(asked).has('马二进三'));
  assert.equal(knownNotations(asked).has('车一平二'), false);
  const resumed = fixture('ask-free-resume.json');
  assert.ok(knownNotations(resumed).has('车一平二'), 'the line of the tool verdict');
  const failed = fixture('ask-free-resume-failed.json');
  for (const candidate of failed.resume.results[0].candidates ?? []) assert.ok(knownNotations(failed).has(candidate), candidate);
});

test('judgeReply: characters as the child sees them against the prompt cap and the display cap', { timeout: 5000 }, () => {
  const opp = fixture('opp.json');                            // cap 18, display cap 27
  const fill = (n) => '好'.repeat(n);
  const at = (text, mode = 'live') => judgeReply(opp, text, mode);
  assert.deepEqual(at(fill(18)), { chars: 18, cap: 18, displayCap: 27, overPrompt: false, overDisplay: false, ungrounded: [], banned: [], avoided: [] });
  assert.equal(at(fill(19)).overPrompt, true);
  assert.equal(at(fill(27)).overDisplay, false);
  assert.equal(at(fill(28)).overDisplay, true);
  // brackets are not counted, and what the page strips (markup marks, links) is not either
  assert.equal(at(`${fill(12)}【炮5进4】`).chars, 16);
  assert.equal(at(`**${fill(18)}** https://example.org/x`).chars, 18 + 1);       // the space before the link stays
  // the caps of the other kinds (section 8.3), each at its edge
  const caps = { 'start.json': [20, 30], 'try.json': [24, 36], 'hint.json': [36, 54], 'ask-chip.json': [50, 75], 'ask-tools.json': [90, 135], 'ask-free.json': [70, 105], 'over.json': [80, 120] };
  for (const [name, [cap, display]] of Object.entries(caps)) {
    const body = fixture(name);
    const edge = judgeReply(body, fill(cap), 'live');
    assert.deepEqual([edge.cap, edge.displayCap, edge.overPrompt], [cap, display, false], name);
    assert.deepEqual([judgeReply(body, fill(cap + 1), 'live').overPrompt, judgeReply(body, fill(display), 'live').overDisplay, judgeReply(body, fill(display + 1), 'live').overDisplay],
      [true, false, true], name);
  }
  // pouch 1 and 2 have the cap 20
  const pouch = fixture('hint.json');
  pouch.events = [pouch.events[0], { ...pouch.events[1], said: undefined, v: undefined }];
  assert.equal(judgeReply(JSON.parse(JSON.stringify(pouch)), fill(20), 'live').cap, 20);

  // the mock's marker is taken off in mock mode only
  assert.equal(at(`〔kind=opp〕${fill(18)}`, 'mock').chars, 18);
  assert.equal(at(`〔kind=opp〕${fill(18)}`, 'live').chars, 28);
});

test('judgeReply: a 【】 whose notation is not in the prompt is ungrounded; banned words fail, avoided words are listed', { timeout: 5000 }, () => {
  const body = fixture('try.json');
  const at = (text) => judgeReply(body, text, 'live');
  assert.deepEqual(at('这步出马，对方多半【车9平8】，咱们再【车一平二】。').ungrounded, []);
  assert.deepEqual(at('对方走【车９平８】也不怕。').ungrounded, [], 'full-width digits are the same move');
  assert.deepEqual(at('对方走【 车9平8 】。').ungrounded, []);
  assert.deepEqual(at('不如走【车五进九】。').ungrounded, ['车五进九']);
  assert.deepEqual(at('先【炮八平五】，再【车9平8】，再【兵三进一】。').ungrounded, ['炮八平五', '兵三进一']);
  assert.deepEqual(at('【注意】这步有危险。').ungrounded, ['注意'], 'a bracket that holds no move at all');
  assert.deepEqual(at('车9平8 是对方的应法。').ungrounded, [], 'a move without brackets is not a claim the page draws');
  // the two examples of the system prompt are grounded only where the brief holds them (try.json does: both were played)
  assert.deepEqual(judgeReply(fixture('start.json'), '先走【炮二平五】。', 'live').ungrounded, ['炮二平五']);

  for (const word of BANNED_WORDS) assert.deepEqual(at(`这步${word}。`).banned, [word]);
  assert.deepEqual(at('这步稳赚，引擎也这么看。').banned, ['稳赚', '引擎']);
  for (const word of AVOIDED_WORDS) assert.deepEqual(at(`按${word}看，这步不错。`).avoided, [word]);
  assert.deepEqual(at('这步出马，阵形舒展。'), { chars: 10, cap: 24, displayCap: 36, overPrompt: false, overDisplay: false, ungrounded: [], banned: [], avoided: [] });
  assert.deepEqual([...BANNED_WORDS], ['白赚', '稳赚', '必胜', '引擎', '程序', '分数', '离线', '主帅', '又是', '总是', '老是']);
});

// ---------------------------------------------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------------------------------------------

test('median and percentile', { timeout: 5000 }, () => {
  assert.equal(median([]), null);
  assert.equal(median([7]), 7);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(percentile([], 0.9), null);
  assert.equal(percentile([5], 0.9), 5);
  assert.equal(percentile([2, 1], 0.9), 2);
  assert.equal(percentile([10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 0.9), 9);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.9), 5);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
});

const OK = { chars: 10, cap: 18, displayCap: 27, overPrompt: false, overDisplay: false, ungrounded: [], banned: [], avoided: [] };
/** A sample with every field; `over` replaces what a test is about. */
const sample = (over) => ({
  source: 'fixture', name: 'opp.json', run: 1, kind: 'opp', detail: '', end: 'done', openMs: 100, firstMs: 400, doneMs: 900, endMs: 900,
  legs: 1, usage: { in: 1000, cached: 0, out: 20 }, text: '好', judged: OK, ...over,
});

test('summarize: hand-built exchanges give the numbers of the table, the failures and the cache check', { timeout: 5000 }, () => {
  const samples = [
    sample({}),
    sample({ run: 2, openMs: 120, firstMs: 600, doneMs: 1100, endMs: 1100, usage: { in: 200, cached: 800, out: 30 } }),
    sample({ name: 'try.json', kind: 'try', firstMs: 1000, judged: { ...OK, cap: 24, displayCap: 36, overPrompt: true, ungrounded: ['车五进九'] } }),
    sample({ name: 'try.json', run: 2, kind: 'try', end: 'error:upstream_busy', firstMs: null, doneMs: null, usage: null, text: '', judged: null }),
    // the game: the child moved on, the client gave up waiting and answered locally (neither is a failure; the second is
    // a late first text), a reply with a banned word, a request the proxy refused for its rate (a failure)
    sample({ source: 'game', name: 'game-1', kind: 'try', end: 'aborted', openMs: 90, firstMs: null, doneMs: null, endMs: 500, usage: null, text: '', judged: null }),
    sample({ source: 'game', name: 'game-1', kind: 'try', end: 'aborted', openMs: 90, firstMs: null, doneMs: null, endMs: 2010, usage: null, text: '', judged: null }),
    sample({ source: 'game', name: 'game-1', kind: 'ask', detail: 'good', firstMs: 700, doneMs: 1500, usage: { in: 300, cached: 0, out: 40 },
      judged: { ...OK, cap: 50, displayCap: 75, overDisplay: true, overPrompt: true, banned: ['必胜'], avoided: ['工具'], ungrounded: ['兵三进一'] } }),
    sample({ source: 'game', name: 'game-1', kind: 'ask', detail: 'free', end: 'http:429:rate', firstMs: null, doneMs: null, usage: null, text: '', judged: null }),
  ];
  const s = summarize(samples);
  assert.deepEqual(s.kinds.map((k) => k.kind), ['start', 'opp', 'try', 'hint', 'ask', 'over']);
  const [start, opp, tried, , ask] = s.kinds;
  assert.deepEqual(start, { kind: 'start', n: 0, lateFirst: 0, open: { p50: null, p90: null }, first: { p50: null, p90: null }, done: { p50: null, p90: null },
    usage: null, cachedShare: null, overPrompt: 0, overDisplay: 0, ungrounded: 0 });
  assert.deepEqual(opp, { kind: 'opp', n: 2, lateFirst: 0, open: { p50: 110, p90: 120 }, first: { p50: 500, p90: 600 }, done: { p50: 1000, p90: 1100 },
    usage: { in: 600, cached: 400, out: 25 }, cachedShare: 0.4, overPrompt: 0, overDisplay: 0, ungrounded: 0 });
  // the try the client gave up at 2010 ms counts in the first-text numbers with that time
  assert.deepEqual(tried, { kind: 'try', n: 1, lateFirst: 1, open: { p50: 100, p90: 100 }, first: { p50: 1505, p90: 2010 }, done: { p50: 900, p90: 900 },
    usage: { in: 1000, cached: 0, out: 20 }, cachedShare: 0, overPrompt: 1, overDisplay: 0, ungrounded: 1 });
  assert.deepEqual([ask.n, ask.overPrompt, ask.overDisplay, ask.ungrounded], [1, 1, 1, 1]);

  assert.deepEqual([s.replies, s.overPrompt, s.overDisplay, s.aborted, s.late, s.cachedSeen], [4, 2, 1, 1, 1, true]);
  assert.deepEqual(s.ungroundedFixtures, [{ name: 'try.json', kind: 'try', notation: '车五进九' }]);
  assert.deepEqual(s.ungroundedGame, [{ name: 'game-1', kind: 'ask', notation: '兵三进一' }]);
  assert.deepEqual(s.banned, [{ name: 'game-1', kind: 'ask', word: '必胜' }]);
  assert.deepEqual(s.avoided, [{ name: 'game-1', kind: 'ask', word: '工具' }]);
  assert.deepEqual(s.failures, [
    { name: 'try.json', run: 2, kind: 'try', end: 'error:upstream_busy' },
    { name: 'game-1', run: 1, kind: 'ask', end: 'http:429:rate' },
  ]);
  // the limit of a question is 3.5 s: given up at 3 400 ms or later it is a late first text, before that the child moved on;
  // an exchange that already had text, or a second leg, was not given up for its first text
  const late = (over) => summarize([sample({ source: 'game', name: 'game-1', kind: 'ask', end: 'aborted', firstMs: null, doneMs: null, judged: null, ...over })]);
  assert.deepEqual([late({ endMs: 3400 }).late, late({ endMs: 3400 }).aborted, late({ endMs: 3400 }).kinds[4].first.p50], [1, 0, 3400]);
  assert.deepEqual([late({ endMs: 3399 }).late, late({ endMs: 3399 }).aborted, late({ endMs: 3399 }).kinds[4].first.p50], [0, 1, null]);
  assert.deepEqual([late({ endMs: 9000, firstMs: 800 }).late, late({ endMs: 9000, legs: 2 }).late], [0, 0]);
  assert.deepEqual(late({ endMs: 9000 }).failures, []);
  // opp.json was repeated once and that run was cached; try.json has no second reply to judge by
  assert.deepEqual(s.repeated, [{ name: 'opp.json', repeats: 1, cached: true }]);
  // one repeat that hit the cache is enough (a gateway does not promise a hit every time); the first run never counts
  const hit = { in: 200, cached: 800, out: 30 }, miss = { in: 1000, cached: 0, out: 30 };
  const runs = (...usages) => summarize(usages.map((usage, k) => sample({ run: k + 1, usage }))).repeated;
  assert.deepEqual(runs(miss, miss, hit, miss), [{ name: 'opp.json', repeats: 3, cached: true }]);
  assert.deepEqual(runs(hit, miss, miss), [{ name: 'opp.json', repeats: 2, cached: false }]);
  assert.deepEqual(runs(miss), []);

  // a fixture exchange that was cut short is a failure whatever its timing; an exchange that never ended is one too
  const cut = summarize([sample({ end: 'aborted', firstMs: null, endMs: 100, judged: null }), sample({ run: 2, end: '', judged: null })]);
  assert.deepEqual(cut.failures.map((f) => f.end), ['aborted', 'unfinished']);
  assert.deepEqual([cut.replies, cut.aborted, cut.late], [0, 0, 0]);
});

test('countLines: captions, rival reads, trial comments and game-over lines are the unsolicited text; interjections count with their line', { timeout: 5000 }, () => {
  const line = (cat, text, cue = '') => ({ id: 'x', cat, cue, text, ended: true });
  const lines = [
    line('start', '小主公，今日亮陪你下这一盘。', '出师！'),             // 14 + 3
    line('caption', '马8进7 出子'),                                        // 7
    line('opp', '对方跳马，护住中卒。'),                                   // 10
    line('opp', ''),                                                       // begun, never spoken: not a spoken read
    line('try', '这步出马，阵形舒展。', '好棋！'),                         // 10 + 3
    line('try', '这一步走完，哪个子没人保护了？', '且慢……'),               // 15 + 4 (a guiding question)
    line('hint', '先看看对方的炮瞄着谁。'),                                // 11
    line('ask', '对方多半车9平8出车。'),                                   // 11
    line('system', '想不出来的话，可以开一个锦囊。'),                      // 15
    line('over', '这盘下得稳，下一盘小目标——走完先看一眼。', '惜败，再战！'),   // 21 + 6
  ];
  const counted = countLines(lines, 'live');
  assert.deepEqual(counted.chars, { caption: 7, start: 17, opp: 10, try: 32, hint: 11, ask: 11, over: 27, system: 15 });
  assert.equal(counted.unsolicited, 7 + 10 + 32 + 27);
  assert.equal(counted.cues, 3 + 4 + 6);
  assert.equal(counted.spokenOpp, 1);
  // a move link counts by its notation, without brackets; the mock's marker counts in live mode only
  assert.equal(countLines([line('opp', '【马8进7】出子')], 'live').unsolicited, 6);
  assert.equal(countLines([line('opp', '〔kind=opp〕对方跳马。')], 'mock').unsolicited, 5);
  assert.equal(countLines([line('opp', '〔kind=opp〕对方跳马。')], 'live').unsolicited, 15);
  assert.deepEqual(countLines([], 'live'), { chars: { caption: 0, start: 0, opp: 0, try: 0, hint: 0, ask: 0, over: 0, system: 0 }, unsolicited: 0, cues: 0, spokenOpp: 0 });
});

// ---------------------------------------------------------------------------------------------------------------
// the bars
// ---------------------------------------------------------------------------------------------------------------

/** A summary in which everything was measured and nothing is wrong; `first` gives the median first text per kind. */
function goodSummary(first = { start: 900, opp: 1200, try: 1300, hint: 2000, ask: 2100, over: 2500 }) {
  return {
    kinds: KINDS.map((kind) => ({ kind, n: 5, lateFirst: 0, open: { p50: 100, p90: 200 }, first: { p50: first[kind], p90: first[kind] + 500 }, done: { p50: 3000, p90: 4000 },
      usage: { in: 400, cached: 3600, out: 40 }, cachedShare: 0.9, overPrompt: 0, overDisplay: 0, ungrounded: 0 })),
    replies: 100, overPrompt: 0, overDisplay: 0, ungroundedFixtures: [], ungroundedGame: [], banned: [], avoided: [], failures: [], aborted: 3, late: 0,
    cachedSeen: true, repeated: [{ name: 'opp.json', repeats: 4, cached: true }, { name: 'try.json', repeats: 4, cached: true }],
  };
}
const goodGame = (over = {}) => ({
  run: 1, moves: 30, wanted: 30, games: 1, rivalMoves: 30, spokenOpp: 12, unsolicited: 1200, cues: 100,
  chars: { caption: 180, start: 20, opp: 300, try: 640, hint: 60, ask: 300, over: 80, system: 30 }, unresolved: [], errors: [], ...over,
});
const statusOf = (bars) => Object.fromEntries(bars.map((bar) => [bar.id, bar.status]));

test('judgeBars: every bar of section 14.8 is met at its edge and missed just beyond it', { timeout: 5000 }, () => {
  assert.deepEqual({ ...BARS }, { firstAutoMs: 2000, firstAskMs: 3500, overPromptShare: 0.2, unsolicitedChars: 1200, spokenShare: 0.4 });

  // at the edge of every bar at once: 20 % over the prompt cap, 1 200 characters, 12 of 30 rival moves, 2.0 s and 3.5 s
  const edge = goodSummary({ start: 5000, opp: 2000, try: 2000, hint: 3500, ask: 3500, over: 9000 });
  edge.overPrompt = 20;
  const bars = judgeBars(edge, [goodGame()]);
  assert.deepEqual(statusOf(bars), {
    ungrounded: 'pass', 'ungrounded-game-brief': 'info', 'over-display': 'pass', 'over-prompt': 'pass', banned: 'pass', avoided: 'info',
    unsolicited: 'pass', 'spoken-share': 'pass', 'first-start': 'info', 'first-opp': 'pass', 'first-try': 'pass', 'first-hint': 'pass', 'first-ask': 'pass',
    'first-over': 'info', cached: 'pass', complete: 'pass',
  });
  assert.equal(failedBars(bars), 0);

  /** The one bar that fails when `change` is applied to a good run. */
  const fails = (change, games = [goodGame()]) => {
    const summary = goodSummary();
    change(summary);
    return judgeBars(summary, games).filter((bar) => bar.status === 'fail').map((bar) => bar.id);
  };
  assert.deepEqual(fails(() => {}), []);
  assert.deepEqual(fails((s) => { s.ungroundedFixtures.push({ name: 'try.json', kind: 'try', notation: '车五进九' }); }), ['ungrounded']);
  assert.deepEqual(fails(() => {}, [goodGame({ unresolved: ['车五进九'] })]), ['ungrounded']);
  assert.deepEqual(fails((s) => { s.overDisplay = 1; }), ['over-display']);
  assert.deepEqual(fails((s) => { s.overPrompt = 21; }), ['over-prompt']);
  assert.deepEqual(fails((s) => { s.banned.push({ name: 'opp.json', kind: 'opp', word: '必胜' }); }), ['banned']);
  assert.deepEqual(fails(() => {}, [goodGame(), goodGame({ run: 2, unsolicited: 1201 })]), ['unsolicited'], 'the worst game decides');
  assert.deepEqual(fails((s) => { s.kinds[1].first.p50 = 2001; }), ['first-opp']);
  assert.deepEqual(fails((s) => { s.kinds[2].first.p50 = 2001; }), ['first-try']);
  assert.deepEqual(fails((s) => { s.kinds[3].first.p50 = 3501; }), ['first-hint']);
  assert.deepEqual(fails((s) => { s.kinds[4].first.p50 = 3501; }), ['first-ask']);
  assert.deepEqual(fails((s) => { s.repeated[1].cached = false; }), ['cached']);
  assert.deepEqual(fails((s) => { s.failures.push({ name: 'opp.json', run: 3, kind: 'opp', end: 'error:upstream_busy' }); }), ['complete']);
  assert.deepEqual(fails(() => {}, [goodGame({ errors: ['[director] TypeError: x'] })]), ['complete']);
  assert.deepEqual(fails(() => {}, [goodGame({ moves: 29 })]), ['complete']);

  // never a failure: a slow greeting or game-over line, a legal move outside the brief, a word the prompt avoids
  assert.deepEqual(fails((s) => {
    s.kinds[0].first.p50 = 60000;
    s.kinds[5].first.p50 = 60000;
    s.ungroundedGame.push({ name: 'game-1', kind: 'ask', notation: '兵三进一' });
    s.avoided.push({ name: 'opp.json', kind: 'opp', word: '军情' });
  }), []);

  // the second budget of section 8.3 (a spoken read on at most 40 % of the rival's moves) is not a failure condition of
  // section 14.8: a game over it is marked 超预算, the worst game decides, and the exit code stays what the other bars make it
  const talkative = judgeBars(goodSummary(), [goodGame(), goodGame({ run: 2, spokenOpp: 13 })]);
  assert.equal(statusOf(talkative)['spoken-share'], 'warn');
  assert.equal(failedBars(talkative), 0);
  assert.ok(barLines(talkative).some((l) => /^ {2}超预算\s+司马懿的着法里军师开口讲解的比例（最多的一局）：43%（线：≤ 40%）$/.test(l)), barLines(talkative).join('\n'));
  assert.equal(statusOf(judgeBars(goodSummary(), [goodGame({ rivalMoves: 0, spokenOpp: 0 })]))['spoken-share'], 'none');
});

test('judgeBars: a gateway that reports no cached tokens is not judged on them; what was not measured has no verdict', { timeout: 5000 }, () => {
  const silent = goodSummary();
  silent.cachedSeen = false;
  for (const r of silent.repeated) r.cached = false;
  const cached = judgeBars(silent, [goodGame()]).find((bar) => bar.id === 'cached');
  assert.equal(cached.status, 'info');
  assert.match(cached.value, /网关没有报告缓存/);

  // the fixtures alone: the two bars of the game have nothing to judge
  const fixturesOnly = statusOf(judgeBars(goodSummary(), []));
  assert.deepEqual([fixturesOnly.unsolicited, fixturesOnly['spoken-share'], fixturesOnly.ungrounded, fixturesOnly.complete], ['none', 'none', 'pass', 'pass']);

  // nothing at all
  const nothing = summarize([]);
  const empty = judgeBars(nothing, []);
  assert.equal(failedBars(empty), 0);
  assert.deepEqual(statusOf(empty), {
    ungrounded: 'none', 'ungrounded-game-brief': 'info', 'over-display': 'none', 'over-prompt': 'none', banned: 'none', avoided: 'info',
    unsolicited: 'none', 'spoken-share': 'none', 'first-start': 'info', 'first-opp': 'none', 'first-try': 'none', 'first-hint': 'none', 'first-ask': 'none',
    'first-over': 'info', cached: 'none', complete: 'none',
  });

  // a game that was played without any reply of the model still reports what it could not do
  const dead = judgeBars(summarize([sample({ source: 'game', name: 'game-1', end: 'http:403:origin', judged: null })]), [goodGame({ moves: 3, errors: ['bench: the coach client is not online'] })]);
  assert.equal(statusOf(dead).complete, 'fail');
});

test('tableLines, gameLines and barLines: a header and one line per kind; one line per game; one line per bar with 通过 / 未达标', { timeout: 5000 }, () => {
  const table = tableLines(summarize([sample({}), sample({ run: 2, openMs: 120, firstMs: 600, doneMs: 1100, usage: { in: 200, cached: 800, out: 30 } })]));
  assert.equal(table.length, 7);
  assert.match(table[0], /^事件 .*回复.*open中位.*首字中位.*done九成.*缓存占比.*超提示.*超显示.*无据$/);
  assert.match(table[2], /^opp 对手着法\s+2\s+110\s+120\s+500\s+600\s+1000\s+1100\s+600\s+400\s+25\s+40%\s+0\s+0\s+0$/);
  assert.match(table[1], /^start 开局\s+0(\s+-){10}\s+0\s+0\s+0$/);

  const games = gameLines([goodGame(), goodGame({ run: 2, games: 2, moves: 28 })]);
  assert.equal(games.length, 2);
  assert.match(games[0], /第 1 局：孩子 30\/30 手，没人问就说的 1200 字（着法字幕 180，讲对手 300，试走点评 640，终局 80；其中开口的语气词 100 字）/);
  assert.match(games[0], /司马懿 30 手里讲了 12 手（40%）/);
  assert.match(games[1], /第 2 局：孩子 28\/30 手（提前终局，共开了 2 盘）/);

  const summary = goodSummary();
  summary.overDisplay = 2;
  const lines = barLines(judgeBars(summary, [goodGame()]));
  assert.equal(lines.length, 16);
  assert.ok(lines.some((l) => /^ {2}未达标\s+超过显示上限（提示字数的 1\.5 倍）的回复：2 \/ 100（线：0）$/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /^ {2}通过\s+对手着法：首字时间的中位数：1\.20 秒（线：≤ 2\.00 秒）$/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /^ {2}通过\s+一局里没人问就说的字数（最多的一局）：1200 字（线：≤ 1200 字）$/.test(l)));
  assert.ok(lines.some((l) => /^ {2}只打印\s+开局：首字时间的中位数：0\.90 秒/.test(l)));
});

test('the script of the child covers every kind of event inside 30 moves', { timeout: 5000 }, () => {
  const inGame = (n) => Number.isInteger(n) && n >= 1 && n <= 30;
  for (const list of [SCRIPT.weakTry, SCRIPT.second, SCRIPT.pouches, SCRIPT.free, Object.keys(SCRIPT.trialAsk).map(Number), Object.keys(SCRIPT.turnAsk).map(Number)]) {
    assert.ok(list.length > 0 && list.every(inGame), String(list));
  }
  // a move does one special thing at most: no weak try on a move with pouches, no question on either
  const special = [...SCRIPT.weakTry, ...SCRIPT.pouches, ...SCRIPT.free, ...Object.keys(SCRIPT.trialAsk).map(Number), ...Object.keys(SCRIPT.turnAsk).map(Number)];
  assert.equal(new Set(special).size, special.length);
});

// ---------------------------------------------------------------------------------------------------------------
// the plumbing against the real handler in mock mode
// ---------------------------------------------------------------------------------------------------------------

test('the observer and the replay: timings, the tool round as one exchange, the Origin header, and the mock\'s failure triggers measured as what they are', { timeout: 30000 }, async (t) => {
  hush(t);
  const origins = [];
  const observer = createObserver({
    fetch: (input, init) => { origins.push(new Headers(init.headers).get('origin')); return handlerFetch(input, init); },
    origin: 'http://127.0.0.1:5173', mode: 'mock', source: 'fixture',
  });
  /** ask-free.json with another sentence of the child. */
  const say = (text) => {
    const body = prepareFixture(fixture('ask-free.json'), 'mock').body;
    body.events[2].say = text;
    return body;
  };
  const fixtures = {
    'try.json': fixture('try.json'),
    'ask-free.json': fixture('ask-free.json'),                 // names a move: the mock asks for the tool, the bench answers `busy`
    'bad-move.json': say('#badmove'),                          // a reply with 【车五进九】, which is in no brief
    'long.json': say('#long'),                                 // a reply of 600 characters
    'error.json': say('#error'),                               // an `error` event
    'cut.json': say('#cut'),                                   // the stream closes without a terminal event
    'refusal.json': say('#refusal'),
    'ask-free-resume.json': fixture('ask-free-resume.json'),   // skipped
  };
  const log = [];
  const { sent, skipped } = await within(replayFixtures({ base: BASE, mode: 'mock', runs: 2, pace: 0, observer, log: (line) => log.push(line), fixtures }), 20000, 'the replay');
  assert.deepEqual(sent, ['try.json', 'ask-free.json', 'bad-move.json', 'long.json', 'error.json', 'cut.json', 'refusal.json']);
  assert.deepEqual(skipped, ['ask-free-resume.json']);
  assert.ok(origins.length >= 16 && origins.every((origin) => origin === 'http://127.0.0.1:5173'), 'every request carries the proxy\'s own origin');
  assert.equal(observer.inflight(), 0);

  const of = (name) => observer.samples.filter((s) => s.name === name);
  assert.equal(observer.samples.length, 14, 'two runs of seven fixtures: a tool round is no exchange of its own');
  assert.deepEqual(observer.samples.map((s) => `${s.name}#${s.run}`).slice(0, 4), ['try.json#1', 'try.json#2', 'ask-free.json#1', 'ask-free.json#2']);

  for (const s of of('try.json')) {
    assert.deepEqual([s.source, s.kind, s.detail, s.end, s.legs], ['fixture', 'try', '', 'done', 1]);
    assert.ok(s.text.startsWith('〔kind=try〕'), s.text);
    assert.ok(s.openMs >= 0 && s.openMs <= s.firstMs && s.firstMs <= s.doneMs && s.doneMs <= s.endMs, JSON.stringify(s));
    assert.deepEqual(s.usage, { in: 0, cached: 0, out: Array.from(s.text).length });
    assert.deepEqual([s.judged.overPrompt, s.judged.overDisplay, s.judged.ungrounded.length, s.judged.banned.length], [false, false, 0, 0]);
    assert.equal(s.judged.chars, Array.from(s.text.replace('〔kind=try〕', '').replace(/[【】]/g, '')).length);
  }
  for (const s of of('ask-free.json')) {
    assert.deepEqual([s.kind, s.detail, s.end, s.legs], ['ask', 'free', 'done', 2]);
    assert.equal(s.text, '这步棋亮没摆明白，小主公在棋盘上走一下？', 'the answer to a tool call that came back busy');
    assert.ok(s.firstMs !== null && s.firstMs <= s.doneMs, 'the first text of a tool exchange is the tool call');
  }
  for (const s of of('bad-move.json')) assert.deepEqual([s.end, s.judged.ungrounded], ['done', ['车五进九']]);
  for (const s of of('long.json')) assert.deepEqual([s.end, s.judged.chars, s.judged.overPrompt, s.judged.overDisplay], ['done', 590, true, true]);
  for (const s of of('error.json')) assert.deepEqual([s.end, s.judged, s.doneMs], ['error:upstream_busy', null, null]);
  for (const s of of('cut.json')) assert.deepEqual([s.end, s.judged], ['eof', null]);
  for (const s of of('refusal.json')) assert.equal(s.end, 'error:refused');

  // and the verdict on such a run: the three kinds of fault, each under its own bar
  const summary = summarize(observer.samples);
  assert.deepEqual([summary.replies, summary.overPrompt, summary.overDisplay, summary.ungroundedFixtures.length, summary.failures.length, summary.cachedSeen], [8, 2, 2, 2, 6, false]);
  const failed = judgeBars(summary, []).filter((bar) => bar.status === 'fail').map((bar) => bar.id);
  assert.deepEqual(failed, ['ungrounded', 'over-display', 'over-prompt', 'complete']);
  assert.ok(log.some((line) => /try\.json\s+2\/2 次有回复/.test(line)), log.join('\n'));
  assert.ok(log.some((line) => /error\.json\s+0\/2 次有回复/.test(line)), log.join('\n'));
});

test('the observer: an HTTP refusal, a request the caller aborts, and requests that are not the coach\'s', { timeout: 20000 }, async (t) => {
  hush(t);
  let passed = 0;
  const observer = createObserver({ fetch: (input, init) => { passed++; return handlerFetch(input, init); }, origin: 'http://127.0.0.1:5173', mode: 'mock', source: 'game' });
  observer.label.name = 'game-1';
  observer.label.run = 1;
  const post = (body, init = {}) => observer.fetch(`${BASE}/coach${init.query ?? ''}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: init.signal });

  // the health probe passes through and is no sample
  const health = await observer.fetch(`${BASE}/health`);
  assert.equal((await health.json()).mode, 'mock');
  assert.equal(observer.samples.length, 0);
  assert.equal(passed, 1);

  // a refusal before the stream opens (the mock's ?fail=503)
  const refused = await post(fixture('try.json'), { query: '?fail=503' });
  assert.equal(refused.status, 503);
  assert.deepEqual(await refused.json(), { error: { code: 'mock_fail' } }, 'the caller still reads the body');
  assert.deepEqual([observer.samples[0].end, observer.samples[0].kind, observer.samples[0].name], ['http:503:mock_fail', 'try', 'game-1']);

  // the caller reads the whole stream exactly as the proxy sent it
  const whole = await post(fixture('try.json'));
  const text = await whole.text();
  assert.match(text, /^event: open\ndata: \{"v":1,"mode":"mock","model":"mock"\}\n\nevent: delta\n/);
  assert.match(text, /event: done\ndata: \{"text":"〔kind=try〕/);
  assert.equal(observer.samples[1].end, 'done');

  // the caller leaves in the middle of a slow reply
  const ac = new AbortController();
  const slow = await post(fixture('try.json'), { query: '?chunkMs=300', signal: ac.signal });
  const reader = slow.body.getReader();
  for (;;) {
    const { value } = await within(reader.read(), 5000, 'the first chunks');
    if (new TextDecoder().decode(value).includes('event: delta')) break;
  }
  assert.equal(observer.inflight(), 1);
  ac.abort();
  await within(reader.read().catch(() => {}), 5000, 'the end of the aborted stream');
  assert.equal(observer.inflight(), 0);
  const aborted = observer.samples[2];
  assert.deepEqual([aborted.end, aborted.judged, aborted.doneMs], ['aborted', null, null]);
  assert.ok(aborted.firstMs !== null && aborted.endMs >= aborted.firstMs);

  // the game's verdict on these three: one failure (the refusal); the abort after text is the child moving on
  const summary = summarize(observer.samples);
  assert.deepEqual([summary.replies, summary.aborted, summary.failures.map((f) => f.end)], [1, 1, ['http:503:mock_fail']]);
});

test('smoke: two moves of the scripted game against scripts/serve.js in mock mode, with the game\'s own modules', { timeout: 120000 }, async (t) => {
  hush(t);
  const realFetch = globalThis.fetch, realWarn = console.warn, realError = console.error;
  const server = await startServer({ port: 0, host: '127.0.0.1', mock: true, env: MOCK_ENV });
  try {
    const log = [];
    // no pace: this server's limits are raised (MOCK_ENV)
    const options = { ...parseArgs([]), base: `http://127.0.0.1:${server.port}/api`, runs: 1, moves: 2, only: 'game', pace: 0 };
    const out = await within(runBench(options, { log: (line) => log.push(line) }), 100000, 'the scripted game');
    const report = log.join('\n');

    assert.equal(out.games.length, 1);
    const game = out.games[0];
    assert.deepEqual(game.errors, [], report);
    assert.deepEqual([game.run, game.moves, game.wanted, game.games, game.rivalMoves], [1, 2, 2, 1, 2], report);
    assert.deepEqual(game.unresolved, []);
    assert.ok(game.chars.caption > 0, 'every rival move has its caption');
    assert.ok(game.chars.over > 0, 'the run ends with a game-over line');
    assert.ok(game.unsolicited > 0 && game.unsolicited < 400, `unsolicited: ${game.unsolicited}`);
    assert.equal(game.unsolicited, game.chars.caption + game.chars.opp + game.chars.try + game.chars.over);

    // the client of the game talked to the proxy: a greeting, a turn question (move 2 taps 对方想干什么), a game-over line
    const ended = (kind) => out.samples.filter((s) => s.kind === kind).map((s) => s.end);
    assert.deepEqual(ended('start'), ['done'], report);
    assert.deepEqual(ended('over'), ['done'], report);
    assert.ok(ended('ask').includes('done'), report);
    assert.ok(out.samples.every((s) => s.source === 'game' && s.name === 'game-1' && (s.end === 'done' || s.end === 'aborted')), JSON.stringify(out.samples.map((s) => [s.kind, s.end])));
    for (const s of out.samples.filter((x) => x.end === 'done')) {
      assert.ok(s.text.startsWith(`〔kind=${s.kind}〕`) || s.text.startsWith('〔kind=tool〕'), s.text);
      assert.deepEqual(s.judged.ungrounded, [], s.text);
      assert.equal(s.judged.overDisplay, false, s.text);
    }
    const status = statusOf(out.bars);
    assert.deepEqual([status.ungrounded, status['over-display'], status['over-prompt'], status.banned, status.unsolicited, status.complete],
      ['pass', 'pass', 'pass', 'pass', 'pass', 'pass'], report);
    assert.match(report, /模式 mock/);
    assert.match(report, /这是模拟回复（mock）/);
    assert.match(report, /第 1 局：孩子 2\/2 手/);
    assert.match(report, /不是完整的一轮/);
  } finally {
    await server.close();
  }
  // the run put back what it replaced
  assert.equal(globalThis.fetch, realFetch);
  assert.equal(console.warn, realWarn);
  assert.equal(console.error, realError);
});
