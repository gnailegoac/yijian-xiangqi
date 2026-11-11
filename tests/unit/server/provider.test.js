// tests/unit/server/provider.test.js (S2) — the live path: contract sections 7.3, 7.10–7.12, 14.3.
//
// No model is called. The real `openai` package (the only SDK the proxy uses) talks to a fake gateway: a node:http server
// on 127.0.0.1 (ephemeral port, closed at the end) that speaks the OpenAI chat-completions streaming format. So the SDK
// calls of server/provider.js are exercised for real: request shape, streaming, retries, aborts, every error class.
// The scenario a request gets is chosen by its `model` id, which each test sets through the proxy config.
// The second half runs the real handler in live mode against the same gateway, and the last test searches everything the
// proxy wrote, through every failure case, for the key.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

import { loadConfig } from '../../../server/config.js';
import { createCoachHandler } from '../../../server/coach-handler.js';
import { TOOLS, buildMessages } from '../../../server/prompt.js';
import { mapError, streamChat } from '../../../server/provider.js';
import { LIMITS, canonicalJson, validateCoachRequest } from '../../../src/coach/protocol.js';

// ---------------------------------------------------------------------------------------------------------------------
// The fake gateway
// ---------------------------------------------------------------------------------------------------------------------

/** A key that is easy to find again. It must reach the gateway and nothing else. */
const KEY = 'FAKE-KEY-s3cr3t-0123456789-do-not-leak';
const SERVED = 'gateway/served-model-v9';

const frame = (data) => `data: ${JSON.stringify(data)}\n\n`;
/** One streamed chunk of a chat completion. */
const chunk = (delta, finish = null, extra = {}) => frame({
  id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1700000000, model: SERVED,
  choices: [{ index: 0, delta, finish_reason: finish }], ...extra,
});
/** The last chunk of a stream with `stream_options.include_usage`: no choices, the token usage. */
const usageChunk = (prompt, cached, completion) => frame({
  id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1700000000, model: SERVED, choices: [],
  usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, prompt_tokens_details: { cached_tokens: cached } },
});
const DONE = 'data: [DONE]\n\n';
const toolDelta = (index, part) => ({ tool_calls: [{ index, ...part }] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Open gates of the `gated` scenarios: a test opens one to let the gateway send the rest of a stream. */
const gates = new Map();
const gate = (name) => {
  if (!gates.has(name)) {
    let open;
    const promise = new Promise((resolve) => { open = resolve; });
    gates.set(name, { promise, open });
  }
  return gates.get(name);
};

const errorBody = (message, extra = {}) => JSON.stringify({ error: { message, type: 'invalid_request_error', param: null, code: null, ...extra } });
const fail = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', 'x-should-retry': 'false', ...headers });
  res.end(body);
};
const stream = (res, parts) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const part of parts) res.write(part);
  res.end();
};
const TEXT_PARTS = ['对方会走', '【马7进5】', '把炮吃掉，咱们只换到一个卒，亏了。'];
const TEXT = TEXT_PARTS.join('');
const textStream = (res) => stream(res, [chunk({ role: 'assistant', content: '' }), ...TEXT_PARTS.map((t) => chunk({ content: t })),
  chunk({}, 'stop'), usageChunk(4022, 3610, 188), DONE]);
const call = (id, notation, after = []) => ({ id, name: 'analyze_move', arguments: JSON.stringify({ notation, after }) });
/** A stream that ends with tool calls (each sent whole in one chunk). */
const toolStream = (res, calls, { text = '', finish = 'tool_calls' } = {}) => stream(res, [
  chunk({ role: 'assistant', content: text || null }),
  ...calls.map((c, index) => chunk(toolDelta(index, { id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }))),
  chunk({}, finish), usageChunk(900, 0, 40), DONE]);

/**
 * The scenarios, by model id. `entry.attempt` counts the requests of one model (1-based).
 * @type {Record<string, (res:import('node:http').ServerResponse, entry:any) => unknown>}
 */
const SCENARIOS = {
  'm/text': (res) => textStream(res),
  'm/quick': (res) => stream(res, [chunk({ role: 'assistant', content: '顺炮对阵！' }), chunk({}, 'stop'), usageChunk(300, 0, 6), DONE]),
  // fragments of two tool calls, interleaved, with text before them
  'm/tools': (res) => stream(res, [
    chunk({ role: 'assistant', content: '亮摆' }), chunk({ content: '一摆。' }),
    chunk(toolDelta(0, { id: 'call_a', type: 'function', function: { name: 'analyze_move', arguments: '' } })),
    chunk(toolDelta(0, { function: { arguments: '{"nota' } })),
    chunk(toolDelta(1, { id: 'call_b', type: 'function', function: { name: 'analyze_move', arguments: '{"notation":"炮8平5",' } })),
    chunk(toolDelta(0, { function: { arguments: 'tion":"马八进七",' } })),
    chunk(toolDelta(1, { function: { arguments: '"after":["马八进七"]}' } })),
    chunk(toolDelta(0, { function: { arguments: '"after":[]}' } })),
    chunk({}, 'tool_calls'), usageChunk(1000, 200, 30), DONE]),
  'm/length': (res) => stream(res, [chunk({ role: 'assistant', content: '说到一半' }), chunk({}, 'length'), usageChunk(10, 0, 1200), DONE]),
  'm/filter': (res) => stream(res, [chunk({ role: 'assistant', content: '这个' }), chunk({}, 'content_filter'), usageChunk(10, 0, 2), DONE]),
  'm/refusal': (res) => stream(res, [chunk({ role: 'assistant', content: '' }), chunk({ refusal: '抱歉，这个我不能回答。' }), chunk({}, 'stop'),
    usageChunk(10, 0, 9), DONE]),
  'm/empty': (res) => stream(res, [chunk({ role: 'assistant', content: '' }), chunk({}, 'stop'), usageChunk(10, 0, 0), DONE]),
  'm/blank': (res) => stream(res, [chunk({ role: 'assistant', content: ' \n ' }), chunk({}, 'stop'), DONE]),
  'm/odd-finish': (res) => stream(res, [chunk({ role: 'assistant', content: '好。' }), chunk({}, 'end_turn'), DONE]),
  'm/function-call': (res) => stream(res, [chunk({ role: 'assistant', content: '好。' }), chunk({}, 'function_call'), DONE]),
  'm/no-usage': (res) => stream(res, [chunk({ role: 'assistant', content: '好。' }), chunk({}, 'stop'), DONE]),
  'm/usage-twice': (res) => stream(res, [chunk({ role: 'assistant', content: '好。' }, null, { usage: null }),
    chunk({}, 'stop', { usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }), usageChunk(50, 20, 7), DONE]),
  // rejects reasoning_effort, accepts the same request without it
  'm/no-effort': (res, entry) => ('reasoning_effort' in entry.body
    ? fail(res, 400, errorBody("Unsupported parameter: 'reasoning_effort' is not supported with this model.", { param: 'reasoning_effort', code: 'unsupported_parameter' }))
    : textStream(res)),
  'm/effort-kept': (res) => textStream(res),
  'm/400': (res) => fail(res, 400, errorBody("Invalid 'messages[1].content': string too long.")),
  'm/400-filter': (res) => fail(res, 400, errorBody('The response was filtered due to the prompt triggering our content management policy.', { code: 'content_filter' })),
  'm/401': (res, entry) => fail(res, 401, errorBody(`Incorrect API key provided: ${entry.auth}. You can find your API key at the gateway.`, { code: 'invalid_api_key' })),
  'm/403': (res) => fail(res, 403, errorBody('You are not allowed to use this model.')),
  'm/404': (res) => fail(res, 404, errorBody('The model `m/404` does not exist.', { code: 'model_not_found' })),
  'm/429': (res) => fail(res, 429, errorBody('Rate limit reached.', { code: 'rate_limit_exceeded' }), { 'retry-after': '7' }),
  // the SDK retries once (maxRetries: 1): the first attempt is refused, the second answers
  'm/429-once': (res, entry) => (entry.attempt === 1
    ? fail(res, 429, errorBody('Rate limit reached.'), { 'retry-after-ms': '5', 'x-should-retry': 'true' })
    : textStream(res)),
  // ... and gives up after that one retry
  'm/500-always': (res) => fail(res, 500, errorBody('The server had an error.'), { 'retry-after-ms': '5', 'x-should-retry': 'true' }),
  'm/500': (res) => fail(res, 500, errorBody('The server had an error.')),
  'm/503': (res, entry) => fail(res, 503, errorBody(`Upstream overloaded while serving ${entry.auth}.`)),
  // an error object inside the stream, after text
  'm/inband': (res, entry) => stream(res, [chunk({ role: 'assistant', content: '对方' }),
    frame({ error: { message: `stream failed for ${entry.auth}`, type: 'server_error', code: 'server_error' } })]),
  // the stream is cut in the middle of a chunk: the connection is reset ...
  'm/cut-reset': (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(chunk({ role: 'assistant', content: '对方会' }));
    res.write('data: {"id":"chatcmpl-test","choices":[{"index":0,"delta":{"content":"走');
    setTimeout(() => res.destroy(), 30);
  },
  // ... or the response ends cleanly in the middle of a JSON chunk
  'm/cut-clean': (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(chunk({ role: 'assistant', content: '对方会' }));
    res.end('data: {"id":"chatcmpl-test","choices":[{"index":0,"delta":{"content":"走');
  },
  // ... or between two chunks, with no finish reason and no [DONE]
  'm/cut-between': (res) => stream(res, [chunk({ role: 'assistant', content: '对方会' })]),
  // a slow stream: the first chunk at once, the rest only when the test opens the gate (or the client leaves)
  'm/gated': async (res, entry) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(chunk({ role: 'assistant', content: '第一句。' }));
    await Promise.race([gate(`gated-${entry.attempt}`).promise, entry.closed]);
    if (res.destroyed) return;
    res.write(chunk({ content: '第二句。' }));
    await sleep(40);
    res.end(chunk({}, 'stop') + usageChunk(20, 0, 8) + DONE);
  },
  // never answers
  'm/hang': () => {},
  // the tool loop of the handler tests: three legs
  'm/loop': (res, entry) => {
    if (entry.attempt === 1) {
      return toolStream(res, [call('call_a', '马八进七'), { id: 'call_b', name: 'analyze_move', arguments: '{"notation":"not a move!","after":[]}' },
        call('call_c', '炮8平5', ['马八进七'])], { text: '亮摆一摆。' });
    }
    if (entry.attempt === 2) return toolStream(res, [call('call_d', '车一平二')]);
    return stream(res, [chunk({ role: 'assistant', content: '【马八进七】稳，' }), chunk({ content: '可以走。' }), chunk({}, 'stop'), usageChunk(1500, 1200, 12), DONE]);
  },
  // tool calls again on the capped third leg
  'm/loop-forever': (res, entry) => toolStream(res, [call(`call_${entry.attempt}`, '车一平二')]),
  // tool calls, but the stream stopped for another reason (the token limit hit inside a call)
  'm/tools-cut': (res) => toolStream(res, [{ id: 'call_a', name: 'analyze_move', arguments: '{"notation":"马八' }], { finish: 'length' }),
  // so much text before a call that the resume token would pass its 4096 bytes
  'm/tools-long': (res) => toolStream(res, [call('call_a', '马八进七')], { text: '说'.repeat(1500) }),
  // ids a client could not send back: empty, odd characters, twice the same; and a tool that does not exist
  'm/odd-ids': (res) => toolStream(res, [{ id: '', name: 'analyze_move', arguments: '{"notation":"马八进七","after":[]}' },
    { id: 'call 1/β', name: 'look_at_board', arguments: '{}' }]),
  'm/same-ids': (res) => toolStream(res, [call('dup', '马八进七'), call('dup', '车一平二')]),
  // a gateway that leaves `index` out of its tool-call fragments: two whole calls, told apart by their ids ...
  'm/no-index': (res) => stream(res, [chunk({ role: 'assistant', content: null }),
    chunk({ tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'analyze_move', arguments: '{"notation":"马八进七","after":[]}' } }] }),
    chunk({ tool_calls: [{ id: 'call_b', type: 'function', function: { name: 'analyze_move', arguments: '{"notation":"车一平二","after":[]}' } }] }),
    chunk({}, 'tool_calls'), usageChunk(900, 0, 40), DONE]),
  // ... one call in fragments (the id comes once, or with every fragment) ...
  'm/no-index-fragments': (res) => stream(res, [chunk({ role: 'assistant', content: null }),
    chunk({ tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'analyze_move', arguments: '' } }] }),
    chunk({ tool_calls: [{ function: { arguments: '{"notation":"马八进七",' } }] }),
    chunk({ tool_calls: [{ id: 'call_a', function: { arguments: '"after":[]}' } }] }),
    chunk({}, 'tool_calls'), DONE]),
  // ... and two calls without ids: the function name of the second one starts it
  'm/no-index-no-id': (res) => stream(res, [chunk({ role: 'assistant', content: null }),
    chunk({ tool_calls: [{ type: 'function', function: { name: 'analyze_move', arguments: '{"notation":"马八进七",' } }] }),
    chunk({ tool_calls: [{ function: { arguments: '"after":[]}' } }] }),
    chunk({ tool_calls: [{ type: 'function', function: { name: 'analyze_move', arguments: '{"notation":"车一平二","after":[]}' } }] }),
    chunk({}, 'tool_calls'), DONE]),
  // an index no list should be asked to hold, an index as text, fragments that are not objects; then a call at index 1
  'm/wild-index': (res) => stream(res, [chunk({ role: 'assistant', content: null }),
    chunk(toolDelta(4294967294, { id: 'call_far', type: 'function', function: { name: 'analyze_move', arguments: '{"notation":"炮8平5","after":[]}' } })),
    chunk({ tool_calls: [null, 'x', 7] }),
    chunk(toolDelta('1', { id: 'call_b', type: 'function', function: { name: 'analyze_move', arguments: '{"notation":"车一平二",' } })),
    chunk(toolDelta(1, { function: { arguments: '"after":[]}' } })),
    chunk({}, 'tool_calls'), DONE]),
  // content, ids, names, arguments and a model name that are not strings
  'm/odd-types': (res) => stream(res, [
    frame({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1700000000, model: { name: 'x' },
      choices: [{ index: 0, delta: { role: 'assistant', content: [{ type: 'text', text: '不该出现' }] }, finish_reason: null }] }),
    chunk({ content: 42 }), chunk({ content: { text: '不该出现' } }), chunk({ content: '好。' }), chunk({}, 'stop'), DONE]),
  'm/odd-call': (res) => stream(res, [chunk({ role: 'assistant', content: null }),
    chunk(toolDelta(0, { id: 7, type: 'function', function: { name: { x: 1 }, arguments: { notation: '马八进七', after: [] } } })),
    chunk({}, 'tool_calls'), DONE]),
};

/** Every request the gateway received, in order. */
const received = [];
let gateway;
let BASE_URL;

before(async () => {
  const attempts = new Map();
  gateway = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    let body;
    try { body = JSON.parse(raw); } catch { body = {}; }
    const model = String(body.model);
    attempts.set(model, (attempts.get(model) ?? 0) + 1);
    let markClosed;
    const entry = {
      method: req.method, path: req.url, auth: req.headers.authorization, headers: req.headers, model, body, attempt: attempts.get(model),
      closedEarly: false, closed: new Promise((resolve) => { markClosed = resolve; }),
    };
    res.on('close', () => { entry.closedEarly = !res.writableFinished; markClosed(); });
    received.push(entry);
    const scenario = SCENARIOS[model];
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions' || !scenario) return fail(res, 404, errorBody('no such route or model'));
    return scenario(res, entry);
  });
  await new Promise((resolve, reject) => {
    gateway.once('error', reject);
    gateway.listen(0, '127.0.0.1', resolve);
  });
  BASE_URL = `http://127.0.0.1:${gateway.address().port}/v1`;
});

after(async () => {
  for (const g of gates.values()) g.open();
  await new Promise((resolve) => {
    gateway.close(() => resolve());
    gateway.closeAllConnections();
  });
});

const requestsOf = (model) => received.filter((entry) => entry.model === model);

/** A base URL on 127.0.0.1 where nothing listens: the port of a server that was opened and closed again. */
async function deadBaseUrl() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}/v1`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------

/** A live config for the fake gateway. */
const configOf = (overrides = {}) => loadConfig({}, { mode: 'live', apiKey: KEY, baseUrl: BASE_URL, upstreamTimeoutMs: 5000, ...overrides });
const MESSAGES = [{ role: 'system', content: '系统提示' }, { role: 'user', content: '〔事件〕测试。' }];

/** Runs one streamChat call to its end. @returns {Promise<{parts:any[], text:string, end:any, error:any}>} */
async function chat(model, { config = configOf(), signal = new AbortController().signal, onPart, toolChoice = 'auto', maxTokens = 1200 } = {}) {
  const parts = [];
  let error = null;
  try {
    for await (const part of streamChat(config, { model, messages: MESSAGES, tools: TOOLS, toolChoice, maxTokens, signal })) {
      parts.push(part);
      await onPart?.(part, parts);
    }
  } catch (err) {
    error = err;
  }
  const texts = parts.filter((p) => p.type === 'text');
  return { parts, text: texts.map((p) => p.text).join(''), end: parts.find((p) => p.type === 'end') ?? null, error };
}

const FIXTURE_DIR = new URL('../../fixtures/coach/', import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
/** Section 7.4: the signing key the proxy derives from the gateway key, and the reply signature. */
const SIGNING_KEY = sha256('yijian-coach:' + KEY);
function replySig(turn, i, kind, text) {
  const input = `reply:v2:${sha256(canonicalJson(turn))}:${i}:${kind}:${text}`;
  return createHmac('sha256', SIGNING_KEY).update(input, 'utf8').digest('base64url').slice(0, 43);
}
const validated = (body) => {
  const v = validateCoachRequest(clone(body));
  assert.equal(v.ok, true, JSON.stringify(v));
  return v.value;
};

const HOST = '127.0.0.1:5173';
/** A live-mode handler whose model is the scenario. */
const liveHandler = (model, overrides = {}) => createCoachHandler({
  mode: 'live', apiKey: KEY, baseUrl: BASE_URL, model, quickModel: model, upstreamTimeoutMs: 5000, rateBurst: 1000, ...overrides });
function post(handler, body, { signal, query = '' } = {}) {
  return handler(new Request(`http://${HOST}/api/coach${query}`, {
    method: 'POST', headers: { 'content-type': 'application/json', host: HOST, origin: `http://${HOST}` }, body: JSON.stringify(body), signal,
  }), undefined, { ip: '127.0.0.1' });
}
function parseSse(text) {
  const items = [];
  for (const block of text.split('\n\n')) {
    if (block === '' || block.startsWith(':')) continue;
    const [first, second] = block.split('\n');
    items.push({ event: first.slice(7), data: JSON.parse(second.slice(6)) });
  }
  return items;
}
async function sseOf(res) {
  assert.equal(res.status, 200, `status ${res.status}`);
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  return parseSse(await res.text());
}
const names = (items) => items.map((x) => x.event);
const deltaText = (items) => items.filter((x) => x.event === 'delta').map((x) => x.data.t).join('');
const tokenPayload = (token) => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));

/** The thread of 9.7 with nothing signed in it: a silent rival move, then a free question. */
function freeThread(say = '如果我走马八进七呢？') {
  const body = fixture('ask-free.json');
  body.events = [{ i: 0, kind: 'opp', said: 'none' }, { i: 1, kind: 'ask', ask: 'free', say }];
  return body;
}
const VERDICT = fixture('ask-free-resume.json').resume.results[0].verdict;

// The handler's one log line per request goes to console.log; it is collected, not printed among the test results.
const logged = [];
const consoleLog = console.log;
console.log = (...args) => { logged.push(args.map(String).join(' ')); };
after(() => { console.log = consoleLog; });

// ---------------------------------------------------------------------------------------------------------------------
// streamChat and mapError (the tests of section 14.3)
// ---------------------------------------------------------------------------------------------------------------------

test('text deltas are yielded in order; tool-call argument fragments are accumulated per index', async () => {
  const plain = await chat('m/text');
  assert.equal(plain.error, null);
  assert.deepEqual(plain.parts.slice(0, -1), TEXT_PARTS.map((text) => ({ type: 'text', text })), 'one part per content delta, in order');
  assert.deepEqual(plain.end, { type: 'end', finish: 'stop', toolCalls: [], model: SERVED, usage: { in: 412, cached: 3610, out: 188 } });
  assert.equal(plain.parts.filter((p) => p.type === 'end').length, 1, 'exactly one end part, the last');
  assert.equal(plain.parts.at(-1).type, 'end');

  const tools = await chat('m/tools');
  assert.equal(tools.error, null);
  assert.equal(tools.text, '亮摆一摆。', 'text that precedes the calls is still yielded');
  assert.deepEqual(tools.end.toolCalls, [
    { id: 'call_a', name: 'analyze_move', arguments: '{"notation":"马八进七","after":[]}' },
    { id: 'call_b', name: 'analyze_move', arguments: '{"notation":"炮8平5","after":["马八进七"]}' },
  ]);
  assert.equal(tools.end.finish, 'tool_calls');
  for (const c of tools.end.toolCalls) assert.doesNotThrow(() => JSON.parse(c.arguments));

  // a slow stream is passed on as it arrives: the first part is here while the gateway still holds the rest back
  const n = requestsOf('m/gated').length + 1;
  let early = null;
  const slow = await chat('m/gated', {
    onPart: (part, parts) => {
      if (parts.length === 1) {
        early = part;
        gate(`gated-${n}`).open();                              // only now does the gateway send the rest
      }
    },
  });
  assert.deepEqual(early, { type: 'text', text: '第一句。' });
  assert.equal(slow.error, null);
  assert.equal(slow.text, '第一句。第二句。');
  assert.equal(slow.end.finish, 'stop');
});

test('finish reasons map: stop, tool_calls, length, content_filter; a delta.refusal is content_filter', async () => {
  assert.equal((await chat('m/text')).end.finish, 'stop');
  assert.equal((await chat('m/tools')).end.finish, 'tool_calls');
  const length = await chat('m/length');
  assert.equal(length.end.finish, 'length');
  assert.equal(length.text, '说到一半');
  assert.equal((await chat('m/filter')).end.finish, 'content_filter');
  const refusal = await chat('m/refusal');
  assert.equal(refusal.error, null);
  assert.equal(refusal.end.finish, 'content_filter', 'a refusal reads as a filtered answer, whatever finish reason came with it');
  assert.equal(refusal.text, '', 'the text of a refusal is not passed on as reply text');
  // an empty answer is an answer without text; a finish reason no caller knows reads as stop
  const empty = await chat('m/empty');
  assert.deepEqual([empty.text, empty.end.finish, empty.end.toolCalls], ['', 'stop', []]);
  assert.equal((await chat('m/odd-finish')).end.finish, 'stop');
  assert.equal((await chat('m/function-call')).end.finish, 'tool_calls');
});

test('a BadRequestError mentioning reasoning_effort retries once without it and never sends it again', async () => {
  const config = configOf({ reasoningEffort: 'low' });
  const first = await chat('m/no-effort', { config });
  assert.equal(first.error, null);
  assert.equal(first.text, TEXT, 'the retry without the parameter answers');
  let seen = requestsOf('m/no-effort');
  assert.equal(seen.length, 2, 'exactly one retry');
  assert.equal(seen[0].body.reasoning_effort, 'low');
  assert.ok(!('reasoning_effort' in seen[1].body));
  const { reasoning_effort: _dropped, ...rest } = seen[0].body;
  assert.deepEqual(seen[1].body, rest, 'the retry is the same request without the parameter');

  // never again for that model: not in a later call, not with another config object
  await chat('m/no-effort', { config });
  await chat('m/no-effort', { config: configOf({ reasoningEffort: 'high' }) });
  seen = requestsOf('m/no-effort');
  assert.equal(seen.length, 4, 'one request per call from now on');
  assert.ok(!('reasoning_effort' in seen[2].body) && !('reasoning_effort' in seen[3].body));

  // a model that accepts it keeps getting it; an empty or 'none' effort (null in the config) is never sent
  await chat('m/effort-kept', { config });
  await chat('m/effort-kept', { config: configOf({ reasoningEffort: 'high' }) });
  await chat('m/effort-kept', { config: configOf({ reasoningEffort: null }) });
  assert.deepEqual(requestsOf('m/effort-kept').map((r) => r.body.reasoning_effort), ['low', 'high', undefined]);
  assert.ok(!('reasoning_effort' in requestsOf('m/effort-kept')[2].body));

  // another 400 is not retried
  const before400 = requestsOf('m/400').length;
  const other = await chat('m/400', { config });
  assert.deepEqual(mapError(other.error), { code: 'upstream_rejected' });
  assert.equal(requestsOf('m/400').length, before400 + 1);
});

test("mapError: each error class maps to its code, most specific first; a filtered-input 400 is 'refused'", async () => {
  await chat('m/text');                                        // the SDK is loaded by the first live call
  const { default: OpenAI } = await import('openai');
  const headers = (h = {}) => new Headers(h);
  const status = (code, error = { message: 'x' }, h = {}) => OpenAI.APIError.generate(code, { error }, undefined, headers(h));

  // the client went away
  assert.equal(mapError(new OpenAI.APIUserAbortError()), null);
  assert.equal(mapError(new DOMException('This operation was aborted', 'AbortError')), null);
  assert.equal(mapError(Object.assign(new Error('aborted'), { name: 'AbortError' })), null);
  assert.equal(mapError({ name: 'APIUserAbortError' }), null);

  // most specific first: every class below is also an APIError, a timeout is also a connection error
  const timeout = new OpenAI.APIConnectionTimeoutError();
  assert.ok(timeout instanceof OpenAI.APIConnectionError && timeout instanceof OpenAI.APIError);
  assert.deepEqual(mapError(timeout), { code: 'upstream_unreachable' });
  assert.deepEqual(mapError(new OpenAI.APIConnectionError({ message: 'Connection error.' })), { code: 'upstream_unreachable' });
  assert.ok(status(401) instanceof OpenAI.AuthenticationError);
  assert.deepEqual(mapError(status(401)), { code: 'upstream_auth' });
  assert.deepEqual(mapError(status(403)), { code: 'upstream_auth' });
  assert.deepEqual(mapError(status(404)), { code: 'upstream_model' });
  assert.deepEqual(mapError(status(429, { message: 'slow down' }, { 'retry-after': '7' })), { code: 'upstream_busy', retry_after: 7 });
  assert.deepEqual(mapError(status(429)), { code: 'upstream_busy', retry_after: 20 }, 'no header: 20 s');
  assert.deepEqual(mapError(status(429, { message: 'x' }, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' })), { code: 'upstream_busy', retry_after: 20 });
  assert.deepEqual(mapError(status(429, { message: 'x' }, { 'retry-after': '0' })), { code: 'upstream_busy', retry_after: 20 });
  for (const code of [500, 502, 503, 529]) assert.deepEqual(mapError(status(code)), { code: 'upstream_busy', retry_after: 10 }, String(code));

  // a 400 that speaks of the content filter is a refusal; any other 400 is a rejected request
  const filtered = [
    { message: 'x', code: 'content_filter' },
    { message: 'The response was filtered due to the prompt triggering our content management policy.' },
    { message: 'Your request was rejected by the Content Policy.' },
    { message: 'Request blocked by the safety system.' },
    { message: 'x', code: 'content_policy_violation' },
  ];
  for (const error of filtered) assert.deepEqual(mapError(status(400, error)), { code: 'refused' }, JSON.stringify(error));
  assert.deepEqual(mapError(status(400, { message: "Invalid 'messages'." })), { code: 'upstream_rejected' });
  assert.deepEqual(mapError(status(400, { message: 'Unsupported parameter: reasoning_effort' })), { code: 'upstream_rejected' });

  // the other API errors, and whatever is not an SDK error at all
  for (const code of [409, 422, 418]) assert.deepEqual(mapError(status(code)), { code: 'upstream_error' }, String(code));
  assert.deepEqual(mapError(new OpenAI.APIError(undefined, { message: 'stream error' }, undefined, undefined)), { code: 'upstream_error' });
  for (const err of [new Error('boom'), new TypeError('terminated'), new SyntaxError('bad json'), new RangeError('seal'), 'text', 42, null, undefined, {}]) {
    assert.deepEqual(mapError(err), { code: 'internal' });
  }
  // a code is all that leaves: no message, no status, no header
  for (const err of [status(401, { message: `Incorrect API key provided: ${KEY}` }), status(500, { message: KEY })]) {
    assert.ok(!JSON.stringify(mapError(err)).includes(KEY));
    assert.deepEqual(Object.keys(mapError(err)).filter((k) => k !== 'code' && k !== 'retry_after'), []);
  }
});

test('usage is read from the last chunk', async () => {
  // in = uncached prompt tokens, cached = cached prompt tokens, out = completion tokens (section 7.3)
  assert.deepEqual((await chat('m/text')).end.usage, { in: 412, cached: 3610, out: 188 });
  assert.deepEqual((await chat('m/usage-twice')).end.usage, { in: 30, cached: 20, out: 7 }, 'the usage of the last chunk wins');
  assert.deepEqual((await chat('m/no-usage')).end.usage, { in: 0, cached: 0, out: 0 }, 'a gateway that sends none');
  assert.deepEqual((await chat('m/tools')).end.usage, { in: 800, cached: 200, out: 30 });
  // the model that served the request is the one the chunks name
  assert.equal((await chat('m/text')).end.model, SERVED);
});

// ---------------------------------------------------------------------------------------------------------------------
// streamChat end to end: what is sent, and every way the gateway can fail
// ---------------------------------------------------------------------------------------------------------------------

test('the request the gateway receives: the key as bearer, and exactly the parameters of section 7.11', async () => {
  await chat('m/text', { config: configOf({ reasoningEffort: 'low' }), toolChoice: 'none', maxTokens: 1600 });
  const entry = requestsOf('m/text').at(-1);
  assert.equal(entry.method, 'POST');
  assert.equal(entry.path, '/v1/chat/completions');
  assert.equal(entry.auth, `Bearer ${KEY}`);
  assert.deepEqual(entry.body, {
    model: 'm/text', stream: true, stream_options: { include_usage: true }, max_completion_tokens: 1600,
    messages: MESSAGES, tools: TOOLS, tool_choice: 'none', reasoning_effort: 'low',
  });
  for (const absent of ['parallel_tool_calls', 'user', 'temperature', 'max_tokens', 'store', 'metadata']) assert.ok(!(absent in entry.body), absent);

  // A hand-made live config without a gateway URL, or without a key, is not handed to the SDK at all: the SDK would
  // fall back to its own default endpoint (and the key would travel there).
  const sent = received.length;
  for (const config of [configOf({ baseUrl: '' }), configOf({ apiKey: '' })]) {
    const none = await chat('m/text', { config });
    assert.equal(none.parts.length, 0);
    assert.equal(none.error?.message, 'the provider is not configured');
    assert.deepEqual(mapError(none.error), { code: 'internal' });
  }
  assert.equal(received.length, sent, 'nothing was sent anywhere');
});

test('error statuses 401 / 403 / 404 / 429 / 500, a timeout and an unreachable gateway, end to end', async () => {
  const outcome = async (model, options) => {
    const result = await chat(model, options);
    assert.ok(result.error, `${model} throws`);
    assert.equal(result.end, null, `${model}: no end part`);
    return mapError(result.error);
  };
  assert.deepEqual(await outcome('m/400'), { code: 'upstream_rejected' });
  assert.deepEqual(await outcome('m/400-filter'), { code: 'refused' });
  assert.deepEqual(await outcome('m/401'), { code: 'upstream_auth' });
  assert.deepEqual(await outcome('m/403'), { code: 'upstream_auth' });
  assert.deepEqual(await outcome('m/404'), { code: 'upstream_model' });
  assert.deepEqual(await outcome('m/429'), { code: 'upstream_busy', retry_after: 7 });
  assert.deepEqual(await outcome('m/500'), { code: 'upstream_busy', retry_after: 10 });
  assert.deepEqual(await outcome('m/503'), { code: 'upstream_busy', retry_after: 10 });
  assert.deepEqual(await outcome('no/such-model'), { code: 'upstream_model' });

  // maxRetries is 1: one retry after a retryable status, and no more
  const once = await chat('m/429-once');
  assert.equal(once.error, null);
  assert.equal(once.text, TEXT);
  assert.equal(requestsOf('m/429-once').length, 2);
  const before500 = requestsOf('m/500-always').length;
  assert.deepEqual(await outcome('m/500-always'), { code: 'upstream_busy', retry_after: 10 });
  assert.equal(requestsOf('m/500-always').length, before500 + 2);

  // the gateway accepts the connection and never answers: the SDK timeout (COACH_UPSTREAM_TIMEOUT_MS) ends the wait
  const started = Date.now();
  const hangBefore = requestsOf('m/hang').length;
  assert.deepEqual(await outcome('m/hang', { config: configOf({ upstreamTimeoutMs: 150 }) }), { code: 'upstream_unreachable' });
  assert.ok(Date.now() - started < 10000, 'two attempts of 150 ms and one back-off, not the default of ten minutes');
  assert.equal(requestsOf('m/hang').length, hangBefore + 2, 'the timed-out request was retried once');

  // nothing listens at the base URL
  assert.deepEqual(await outcome('m/text', { config: configOf({ baseUrl: await deadBaseUrl() }) }), { code: 'upstream_unreachable' });

  // an error object inside the stream, after text was passed on
  const inband = await chat('m/inband');
  assert.equal(inband.text, '对方');
  assert.deepEqual(mapError(inband.error), { code: 'upstream_error' });
});

test('a stream cut in mid-chunk is an error, not an answer', async () => {
  const errors = [];
  const consoleError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); };       // left to itself the SDK reports a broken chunk here
  try {
    for (const model of ['m/cut-reset', 'm/cut-clean']) {
      const cut = await chat(model);
      assert.ok(cut.error, `${model} throws`);
      assert.equal(cut.end, null, `${model}: no end part, so nothing is signed`);
      assert.equal(cut.text, '对方会', 'the text of the whole chunks was passed on before the cut');
      assert.deepEqual(mapError(cut.error), { code: 'internal' }, model);
    }
  } finally {
    console.error = consoleError;
  }
  assert.deepEqual(errors, [], "the SDK writes nothing to the console: the one log line of a request is the handler's");

  // A stream that ends between two chunks, with no finish reason, cannot be told from a short answer: it reads as `stop`.
  const between = await chat('m/cut-between');
  assert.equal(between.error, null);
  assert.deepEqual([between.text, between.end.finish], ['对方会', 'stop']);
});

test('a client abort stops the provider call', async () => {
  // while the stream is running
  const ac = new AbortController();
  const result = await chat('m/gated', { signal: ac.signal, onPart: () => ac.abort() });
  assert.equal(result.text, '第一句。');
  assert.equal(result.end, null, 'no end part: what was read so far is not an answer');
  assert.equal(result.error?.name, 'AbortError');
  assert.equal(mapError(result.error), null, 'null = the client went away');
  const entry = requestsOf('m/gated').at(-1);
  await Promise.race([entry.closed, sleep(3000)]);
  assert.equal(entry.closedEarly, true, 'the gateway sees the connection close before its stream ended');

  // before the gateway answered
  const waiting = new AbortController();
  const hung = chat('m/hang', { signal: waiting.signal });
  const before = requestsOf('m/hang').length;
  for (let k = 0; k < 100 && requestsOf('m/hang').length === before; k++) await sleep(20);
  waiting.abort();
  const gone = await hung;
  assert.equal(gone.parts.length, 0);
  assert.equal(mapError(gone.error), null);

  // a request that is already gone is not sent at all
  const sent = received.length;
  const early = await chat('m/text', { signal: AbortSignal.abort() });
  assert.equal(mapError(early.error), null);
  assert.equal(received.length, sent, 'the gateway was not called');
});

test('a gateway that strays from the format: tool calls without an index, a wild index, values that are not strings', async () => {
  const callA = { id: 'call_a', name: 'analyze_move', arguments: '{"notation":"马八进七","after":[]}' };
  const callB = { id: 'call_b', name: 'analyze_move', arguments: '{"notation":"车一平二","after":[]}' };

  // no index: a fragment with a new id starts the next call, any other one continues the last call
  const whole = await chat('m/no-index');
  assert.equal(whole.error, null);
  assert.deepEqual(whole.end.toolCalls, [callA, callB], 'the calls are not lost');
  assert.equal(whole.end.finish, 'tool_calls');
  assert.deepEqual((await chat('m/no-index-fragments')).end.toolCalls, [callA], 'fragments of one call are joined');
  // no index and no id: a function name starts the next call
  assert.deepEqual((await chat('m/no-index-no-id')).end.toolCalls, [{ ...callA, id: '' }, { ...callB, id: '' }]);

  // An index far outside any list is dropped instead of stretching the list (which would stall the whole server while
  // it is walked); an index written as text counts; fragments that are not objects are skipped.
  const started = Date.now();
  const wild = await chat('m/wild-index');
  assert.equal(wild.error, null);
  assert.deepEqual(wild.end.toolCalls, [callB]);
  assert.ok(Date.now() - started < 5000, `answered in ${Date.now() - started} ms`);

  // only strings are text, ids, names and arguments
  const odd = await chat('m/odd-types');
  assert.equal(odd.error, null);
  assert.deepEqual(odd.parts.filter((p) => p.type === 'text'), [{ type: 'text', text: '好。' }], 'nothing but the string content is reply text');
  assert.equal(odd.end.model, SERVED);
  const oddCall = await chat('m/odd-call');
  assert.equal(oddCall.error, null);
  for (const c of oddCall.end.toolCalls) assert.deepEqual([typeof c.id, typeof c.name, typeof c.arguments], ['string', 'string', 'string']);
  assert.ok(!JSON.stringify(oddCall.end.toolCalls).includes('[object'));

  // through the handler: both calls of the index-less answer reach the client; the odd content is one clean reply
  const tool = (await sseOf(await post(liveHandler('m/no-index'), freeThread()))).at(-1);
  assert.equal(tool.event, 'tool');
  assert.deepEqual(tool.data.calls, [{ id: 'call_a', name: 'analyze_move', input: { notation: '马八进七', after: [] } },
    { id: 'call_b', name: 'analyze_move', input: { notation: '车一平二', after: [] } }]);
  const reply = await sseOf(await post(liveHandler('m/odd-types'), fixture('try.json')));
  assert.deepEqual(names(reply), ['open', 'delta', 'done']);
  assert.equal(reply.at(-1).data.text, '好。');
  assert.ok(!JSON.stringify(reply).includes('不该出现') && !JSON.stringify(reply).includes('[object'));
});

test('only the proxy config reaches the SDK: OPENAI_* variables of the machine add no header and no logging', async () => {
  // The SDK reads OPENAI_ORG_ID, OPENAI_PROJECT_ID and OPENAI_LOG from the environment unless the client is told otherwise.
  // The proxy is configured by COACH_* variables alone (section 7.9), sends no identifier to the gateway and logs no
  // request content (section 7.13), so a machine on which such variables happen to be set must not change either.
  const machine = { OPENAI_ORG_ID: 'org-of-the-machine', OPENAI_PROJECT_ID: 'proj_of_the_machine', OPENAI_LOG: 'debug',
    OPENAI_API_KEY: 'sk-of-the-machine', OPENAI_BASE_URL: 'http://127.0.0.1:9/v1' };
  const saved = Object.keys(machine).map((name) => [name, process.env[name]]);
  Object.assign(process.env, machine);
  const written = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const savedConsole = methods.map((m) => console[m]);
  methods.forEach((m) => { console[m] = (...args) => { written.push(`${m}: ${args.map(String).join(' ')}`); }; });
  let ok;
  let failed;
  try {
    // a fresh config object, so the SDK client is built now, with these variables in place
    ok = await chat('m/text', { config: configOf() });
    failed = await chat('m/cut-clean', { config: configOf() });  // a failure the SDK would report on the console
  } finally {
    methods.forEach((m, k) => { console[m] = savedConsole[k]; });
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assert.equal(ok.error, null);
  assert.equal(ok.text, TEXT, 'the request went to the configured gateway');
  assert.deepEqual(mapError(failed.error), { code: 'internal' });
  for (const entry of [requestsOf('m/text').at(-1), requestsOf('m/cut-clean').at(-1)]) {
    assert.equal(entry.auth, `Bearer ${KEY}`, 'the key of the config, not the one of the machine');
    assert.equal(entry.headers['openai-organization'], undefined);
    assert.equal(entry.headers['openai-project'], undefined);
    assert.ok(!JSON.stringify(entry.headers).includes('of-the-machine') && !JSON.stringify(entry.headers).includes('of_the_machine'));
  }
  assert.deepEqual(written, [], 'the SDK logs nothing, whatever OPENAI_LOG says');
});

// ---------------------------------------------------------------------------------------------------------------------
// The handler in live mode
// ---------------------------------------------------------------------------------------------------------------------

test('live handler: open before the provider call, delta per text part, done with the signed text of the leg', async () => {
  const handler = liveHandler('m/text', { quickModel: 'm/quick' });
  const body = fixture('try.json');
  const items = await sseOf(await post(handler, body));
  assert.deepEqual(names(items), ['open', 'delta', 'delta', 'delta', 'done']);
  assert.deepEqual(items[0].data, { v: 1, mode: 'live', model: 'm/text' });
  assert.deepEqual(items.slice(1, 4).map((x) => x.data), TEXT_PARTS.map((t) => ({ t })));
  const done = items.at(-1).data;
  assert.deepEqual(done, {
    text: TEXT,
    sig: replySig(body.turn, 1, 'try', TEXT),
    stop: 'end',
    model: SERVED,
    usage: { in: 412, cached: 3610, out: 188 },
  });

  // what the gateway was asked: the messages of section 8.4 for this request, the one tool, the fixed parameters
  const entry = requestsOf('m/text').at(-1);
  assert.deepEqual(entry.body, {
    model: 'm/text', stream: true, stream_options: { include_usage: true }, max_completion_tokens: 1200,
    messages: buildMessages(validated(body), []), tools: TOOLS, tool_choice: 'auto', reasoning_effort: 'low',
  });
  assert.equal(entry.auth, `Bearer ${KEY}`);

  // the quick model answers `start` and `opp`; `over` gets the larger token limit; everything else the main model
  for (const [name, model, tokens] of [['start.json', 'm/quick', 1200], ['opp.json', 'm/quick', 1200], ['over.json', 'm/text', 1600],
    ['recap.json', 'm/text', 1200]]) {
    const before = received.length;
    const stream = await sseOf(await post(handler, fixture(name)));
    assert.equal(stream[0].data.model, model, name);
    assert.equal(names(stream).at(-1), 'done', name);
    assert.equal(received.length, before + 1, `${name}: one provider call`);
    assert.equal(received.at(-1).body.model, model, name);
    assert.equal(received.at(-1).body.max_completion_tokens, tokens, name);
    assert.deepEqual(received.at(-1).body.messages, buildMessages(validated(fixture(name)), []), name);
  }

  // the reply signed here is accepted as history by the same proxy, and only there
  const next = clone(body);
  next.events[1].said = 'llm';
  next.events[1].reply = { text: done.text, sig: done.sig };
  next.events.push({ i: 2, kind: 'ask', ask: 'why' });
  assert.equal(names(await sseOf(await post(handler, next))).at(-1), 'done');
  assert.deepEqual(received.at(-1).body.messages.at(-2), { role: 'assistant', content: TEXT }, 'the model sees its own earlier reply');
  const mock = createCoachHandler({ mode: 'mock', mockChunkMs: 0 });
  const refused = await post(mock, next);
  assert.equal(refused.status, 400);
  assert.deepEqual(await refused.json(), { error: { code: 'bad_signature' } });

  // a stop at the token limit is told to the client; the text so far is still signed
  const cut = (await sseOf(await post(liveHandler('m/length'), body))).at(-1);
  assert.deepEqual([cut.event, cut.data.stop, cut.data.text], ['done', 'length', '说到一半']);
  // an unknown finish reason is an ordinary end
  assert.equal((await sseOf(await post(liveHandler('m/odd-finish'), body))).at(-1).data.stop, 'end');

  // health names the mode and the configured model, and never calls the provider
  const sent = received.length;
  const health = await handler(new Request(`http://${HOST}/api/health`, { headers: { host: HOST } }));
  assert.deepEqual(await health.json(), { ok: true, v: 1, mode: 'live', model: 'm/text', freeText: true });
  await sleep(50);
  assert.equal(received.length, sent);
});

test('live handler, the tool loop: calls are validated and capped, the resume token carries the legs, the third leg cannot call', async () => {
  const handler = liveHandler('m/loop');
  const body = freeThread();
  const req = validated(body);
  const first = requestsOf('m/loop').length;

  // leg 1: three calls. The first is valid; the second is not a notation; the third is one too many for a round.
  const leg1 = await sseOf(await post(handler, body));
  assert.deepEqual(names(leg1), ['open', 'delta', 'tool']);
  const tool1 = leg1.at(-1).data;
  assert.deepEqual(Object.keys(tool1), ['calls', 'resume', 'text']);
  assert.deepEqual(tool1.calls, [{ id: 'call_a', name: 'analyze_move', input: { notation: '马八进七', after: [] } }], 'only the valid call is forwarded');
  assert.equal(tool1.text, '亮摆一摆。');
  assert.equal(requestsOf('m/loop')[first].body.tool_choice, 'auto');

  // the token: signed with the proxy's key, bound to this request, carrying the leg as the model produced it
  const [payload64, mac] = tool1.resume.split('.');
  const json = Buffer.from(payload64, 'base64url').toString('utf8');
  assert.equal(mac, createHmac('sha256', SIGNING_KEY).update('resume:v1:' + json, 'utf8').digest('base64url'));
  const legA = {
    text: '亮摆一摆。',
    calls: [call('call_a', '马八进七'), { id: 'call_b', name: 'analyze_move', arguments: '{"notation":"not a move!","after":[]}' },
      call('call_c', '炮8平5', ['马八进七'])],
    x: [{ id: 'call_b', error: 'syntax' }, { id: 'call_c', error: 'limit' }],
  };
  assert.deepEqual(JSON.parse(json), { v: 1, h: sha256(canonicalJson(req)), legs: [legA] });
  assert.ok(Buffer.byteLength(tool1.resume) <= LIMITS.RESUME_TOKEN_BYTES);

  // leg 2: the same body plus resume. The model sees its calls and one result per call: the client's, or the proxy's own.
  const resultA = { id: 'call_a', ok: true, verdict: VERDICT };
  const body2 = { ...clone(body), resume: { token: tool1.resume, results: [resultA] } };
  const leg2 = await sseOf(await post(handler, body2));
  assert.deepEqual(names(leg2), ['open', 'tool']);
  const tool2 = leg2.at(-1).data;
  assert.deepEqual(tool2.calls, [{ id: 'call_d', name: 'analyze_move', input: { notation: '车一平二', after: [] } }]);
  assert.equal(tool2.text, '');
  const sent2 = requestsOf('m/loop')[first + 1].body;
  assert.equal(sent2.tool_choice, 'auto', 'the second leg may still call');
  assert.deepEqual(sent2.messages, buildMessages(validated(body2), [legA]));
  const tail2 = sent2.messages.slice(-4);
  assert.deepEqual(tail2.map((m) => m.role), ['assistant', 'tool', 'tool', 'tool']);
  assert.deepEqual(tail2[0].tool_calls.map((c) => c.id), ['call_a', 'call_b', 'call_c']);
  assert.ok(tail2[1].content.startsWith('〔推演结果〕走法：'));
  assert.equal(tail2[2].content, '〔推演失败〕这不是一步合乎记谱的棋。', 'the proxy answers the invalid call itself');
  assert.equal(tail2[3].content, '〔推演失败〕本轮推演次数已用完。', 'and the call beyond two per round');
  const legB = { text: '', calls: [call('call_d', '车一平二')], x: [] };
  assert.deepEqual(tokenPayload(tool2.resume), { v: 1, h: sha256(canonicalJson(req)), legs: [legA, legB] });

  // leg 3 (the last): tool_choice is none, and the reply is the text of all legs
  const resultD = { id: 'call_d', ok: false, error: 'ambiguous', candidates: ['车一平二', '车九平八'] };
  const body3 = { ...clone(body), resume: { token: tool2.resume, results: [resultA, resultD] } };
  const leg3 = await sseOf(await post(handler, body3));
  assert.deepEqual(names(leg3), ['open', 'delta', 'delta', 'done']);
  const sent3 = requestsOf('m/loop')[first + 2].body;
  assert.equal(sent3.tool_choice, 'none', 'at most two tool rounds');
  assert.deepEqual(sent3.tools, TOOLS, 'the tool list stays in the request: the prefix does not change');
  assert.deepEqual(sent3.messages, buildMessages(validated(body3), [legA, legB]));
  assert.equal(sent3.messages.at(-1).content, '〔推演失败〕这个写法对应不止一步棋。可能是：【车一平二】、【车九平八】。');
  const done = leg3.at(-1).data;
  assert.equal(done.text, '亮摆一摆。\n【马八进七】稳，可以走。', 'the texts of the legs, joined by a line break where both are non-empty');
  assert.equal(done.sig, replySig(body.turn, 1, 'ask', done.text));
  assert.deepEqual(done.usage, { in: 300, cached: 1200, out: 12 });
  assert.equal(requestsOf('m/loop').length, first + 3, 'three model requests for one child message, never more');

  // a result the client did not send reads as "busy" to the model
  await sseOf(await post(liveHandler('m/text'), { ...clone(body), resume: { token: tool2.resume, results: [resultA] } }));
  assert.equal(requestsOf('m/text').at(-1).body.messages.at(-1).content, '〔推演失败〕沙盘正忙，没推演出来。');

  // what is not acceptable on resume: another body, a tampered token, a result for a call the proxy refused or never saw
  const invalid = async (b, what) => {
    const res = await post(handler, b);
    assert.equal(res.status, 400, what);
    assert.deepEqual(await res.json(), { error: { code: 'invalid', path: 'resume' } }, what);
  };
  await invalid({ ...freeThread('如果我走车一平二呢？'), resume: body2.resume }, 'a token of another request');
  await invalid({ ...clone(body), resume: { token: `${payload64}.${mac.slice(0, -1)}${mac.at(-1) === 'A' ? 'B' : 'A'}`, results: [resultA] } }, 'a tampered token');
  await invalid({ ...clone(body), resume: { token: tool1.resume, results: [{ ...resultA, id: 'call_b' }] } }, 'a result for a refused call');
  await invalid({ ...clone(body), resume: { token: tool1.resume, results: [{ ...resultA, id: 'call_z' }] } }, 'a result for an unknown call');
  assert.equal(requestsOf('m/loop').length, first + 3, 'none of them reached the model');

  // the model calls again on the capped leg, or the stream stopped for another reason inside a call: truncated
  const forever = liveHandler('m/loop-forever');
  const f1 = (await sseOf(await post(forever, body))).at(-1).data;
  const f2 = (await sseOf(await post(forever, { ...clone(body), resume: { token: f1.resume, results: [] } }))).at(-1).data;
  assert.equal(tokenPayload(f2.resume).legs.length, 2);
  const f3 = await sseOf(await post(forever, { ...clone(body), resume: { token: f2.resume, results: [] } }));
  assert.deepEqual(f3.at(-1), { event: 'error', data: { code: 'truncated' } });
  assert.deepEqual((await sseOf(await post(liveHandler('m/tools-cut'), body))).at(-1), { event: 'error', data: { code: 'truncated' } });

  // ids the client could not send back are replaced, in the event and in the token alike; an unknown tool is not forwarded
  const odd = (await sseOf(await post(liveHandler('m/odd-ids'), body))).at(-1).data;
  assert.deepEqual(odd.calls, [{ id: 'call_1_1', name: 'analyze_move', input: { notation: '马八进七', after: [] } }]);
  const oddLeg = tokenPayload(odd.resume).legs[0];
  assert.deepEqual(oddLeg.calls.map((c) => [c.id, c.name]), [['call_1_1', 'analyze_move'], ['call_1_2', 'look_at_board']]);
  assert.deepEqual(oddLeg.x, [{ id: 'call_1_2', error: 'syntax' }]);
  const same = (await sseOf(await post(liveHandler('m/same-ids'), body))).at(-1).data;
  assert.deepEqual(same.calls.map((c) => c.id), ['dup', 'call_1_2']);
  const resumedOdd = await sseOf(await post(liveHandler('m/text'), { ...clone(body), resume: { token: odd.resume,
    results: [{ id: 'call_1_1', ok: true, verdict: VERDICT }] } }));
  assert.equal(names(resumedOdd).at(-1), 'done');
});

test('live handler: a refusal, an empty answer and every upstream failure end the stream with one error event', async () => {
  const body = fixture('try.json');
  const errors = [];
  const consoleError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); };
  const expectations = [
    ['m/filter', 'refused', 1],                                  // text, then the filter
    ['m/refusal', 'refused', 0],
    ['m/400-filter', 'refused', 0],
    ['m/empty', 'empty', 0],
    ['m/blank', 'empty', 1],                                     // white space is not an answer
    ['m/400', 'upstream_rejected', 0],
    ['m/401', 'upstream_auth', 0],
    ['m/403', 'upstream_auth', 0],
    ['m/404', 'upstream_model', 0],
    ['m/500', 'upstream_busy', 0],
    ['m/inband', 'upstream_error', 1],
    ['m/cut-reset', 'internal', 1],
    ['m/cut-clean', 'internal', 1],
    ['m/tools-long', 'internal', 1],                             // the token cannot be sealed: no tool event, no half answer
  ];
  try {
    for (const [model, code, deltas] of expectations) {
      const items = await sseOf(await post(liveHandler(model), body));
      assert.deepEqual(names(items), ['open', ...Array(deltas).fill('delta'), 'error'], model);
      assert.equal(items.at(-1).data.code, code, model);
      assert.deepEqual(Object.keys(items.at(-1).data).filter((k) => k !== 'code' && k !== 'retry_after'), [], `${model}: a code and nothing else`);
    }
    assert.deepEqual((await sseOf(await post(liveHandler('m/429'), body))).at(-1), { event: 'error', data: { code: 'upstream_busy', retry_after: 7 } });
    assert.deepEqual((await sseOf(await post(liveHandler('m/500'), body))).at(-1), { event: 'error', data: { code: 'upstream_busy', retry_after: 10 } });
    const hung = await sseOf(await post(liveHandler('m/hang', { upstreamTimeoutMs: 150 }), body));
    assert.deepEqual(hung, [{ event: 'open', data: { v: 1, mode: 'live', model: 'm/hang' } }, { event: 'error', data: { code: 'upstream_unreachable' } }]);
  } finally {
    console.error = consoleError;
  }

  // a client that goes away: the stream closes, the provider call is aborted, nothing is signed
  const ac = new AbortController();
  const res = await post(liveHandler('m/gated'), body, { signal: ac.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('event: delta')) text += decoder.decode((await reader.read()).value, { stream: true });
  ac.abort();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  assert.deepEqual(names(parseSse(text)), ['open', 'delta'], 'no terminal event for a client that is gone');
  const entry = requestsOf('m/gated').at(-1);
  await Promise.race([entry.closed, sleep(3000)]);
  assert.equal(entry.closedEarly, true, 'the proxy aborted the provider call');
  for (let k = 0; k < 100 && !/end=aborted/.test(logged.at(-1) ?? ''); k++) await sleep(10);
  assert.match(logged.at(-1),/^\[coach\] mode=live status=200 end=aborted ms=\d+$/);
});

test('the key never appears in anything the proxy writes', async () => {
  // The hazard is real: this gateway repeats the bearer token in its 401 text (as real gateways do), and the SDK puts
  // that text into the message of the error it throws. So no error message may ever be logged or passed on.
  const hazard = await chat('m/401');
  assert.ok(String(hazard.error.message).includes(KEY), 'the SDK error message carries the key');

  // Everything written while the handler runs through the normal case and every failure case: console output, raw stdout
  // and stderr, response status lines, headers and bodies (SSE events and resume tokens decoded).
  const written = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir'];
  const savedConsole = methods.map((m) => console[m]);
  methods.forEach((m) => { console[m] = (...args) => { written.push(`console.${m}: ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`); }; });
  const savedOut = process.stdout.write;
  const savedErr = process.stderr.write;
  process.stdout.write = function write(data, ...rest) { written.push(`stdout: ${String(data)}`); return savedOut.call(this, data, ...rest); };
  process.stderr.write = function write(data, ...rest) { written.push(`stderr: ${String(data)}`); return savedErr.call(this, data, ...rest); };

  const record = async (label, res) => {
    const text = await res.text().catch((err) => `unreadable (${err?.name})`);
    written.push(`${label}: ${res.status} ${JSON.stringify([...res.headers])} ${text}`);
    for (const item of text.startsWith('event:') ? parseSse(text) : []) {
      if (item.data.resume) written.push(`${label} token: ${Buffer.from(item.data.resume.split('.')[0], 'base64url').toString('utf8')}`);
    }
    return text;
  };

  const sentBefore = received.length;
  const body = fixture('try.json');
  let cases = 0;
  try {
    const run = async (label, handler, b = body, options) => { cases++; return record(label, await post(handler, b, options)); };
    // a normal stream, a slow stream, the quick model, a tool leg and its resume
    await run('normal', liveHandler('m/text'));
    const n = requestsOf('m/gated').length + 1;
    setTimeout(() => gate(`gated-${n}`).open(), 60);
    await run('slow', liveHandler('m/gated'));
    await run('quick', liveHandler('m/text', { quickModel: 'm/quick' }), fixture('opp.json'));
    const toolText = await run('tool', liveHandler('m/loop-forever'), freeThread());
    const token = parseSse(toolText).at(-1).data.resume;
    await run('resume', liveHandler('m/text'), { ...freeThread(), resume: { token, results: [] } });
    // error statuses (the fake gateway repeats the bearer token in its 401 and 503 messages, as real gateways do)
    for (const model of ['m/400', 'm/400-filter', 'm/401', 'm/403', 'm/404', 'm/429', 'm/500', 'm/500-always', 'm/503', 'no/such-model']) {
      await run(`status ${model}`, liveHandler(model));
    }
    // a stream cut in mid-chunk (both ways) and between chunks, an error inside the stream
    for (const model of ['m/cut-reset', 'm/cut-clean', 'm/cut-between', 'm/inband']) await run(`cut ${model}`, liveHandler(model));
    // a refusal, a filtered answer, an empty answer, a truncated tool call, a stop at the token limit
    for (const model of ['m/refusal', 'm/filter', 'm/empty', 'm/blank', 'm/tools-cut', 'm/length']) await run(`answer ${model}`, liveHandler(model));
    // a timeout, an unreachable gateway
    await run('timeout', liveHandler('m/hang', { upstreamTimeoutMs: 120 }));
    await run('unreachable', liveHandler('m/text', { baseUrl: await deadBaseUrl(), upstreamTimeoutMs: 500 }));
    // a client abort in mid-stream
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 80);
    await run('abort', liveHandler('m/gated'), body, { signal: ac.signal });
    // requests that are refused before the stream opens, and the other routes
    const tampered = clone(fixture('ask-chip.json'));
    await run('bad signature', liveHandler('m/text'), tampered);
    await run('invalid', liveHandler('m/text'), { ...body, apiKey: 'please' });
    await run('bad version', liveHandler('m/text'), { ...body, v: 7 });
    await run('bad resume', liveHandler('m/text'), { ...freeThread(), resume: { token: 'e30.c2ln', results: [] } });
    await run('rate', liveHandler('m/text', { rateBurst: 0 }));
    await run('free text off', liveHandler('m/text', { freeText: false }), freeThread());
    const handler = liveHandler('m/text');
    for (const [method, path] of [['GET', '/api/health'], ['OPTIONS', '/api/coach'], ['GET', '/api/coach'], ['GET', '/api/mock/stats'], ['POST', '/api/nowhere']]) {
      cases++;
      await record(`${method} ${path}`, await handler(new Request(`http://${HOST}${path}`, { method, headers: { host: HOST, origin: `http://${HOST}` } }), undefined, {}));
    }
    // let the aborted call unwind and write its log line
    for (let k = 0; k < 300 && !written.some((w) => w.includes('end=aborted')); k++) await sleep(10);
  } finally {
    methods.forEach((m, k) => { console[m] = savedConsole[k]; });
    process.stdout.write = savedOut;
    process.stderr.write = savedErr;
  }

  // the key did travel: to the gateway, as the bearer token, and nowhere else
  const sent = received.slice(sentBefore);
  assert.ok(sent.length >= 25, `the gateway was called ${sent.length} times`);
  assert.ok(sent.every((entry) => entry.auth === `Bearer ${KEY}`));
  assert.ok(sent.every((entry) => !JSON.stringify(entry.body).includes(KEY)), 'never inside a request body');

  const everything = written.join('\n');
  assert.ok(cases >= 35 && written.length >= cases, `${cases} cases, ${written.length} things written`);
  assert.ok(everything.includes('"code":"upstream_auth"') && everything.includes('"code":"refused"') && everything.includes('event: done')
    && everything.includes('end=aborted') && everything.includes('"code":"upstream_unreachable"') && everything.includes('"code":"internal"'),
    'the capture really holds the responses and the log lines');
  const needles = [
    KEY, KEY.toLowerCase(), 'FAKE-KEY', 's3cr3t', 'Bearer ',
    Buffer.from(KEY).toString('base64'), Buffer.from(KEY).toString('base64url'), Buffer.from(KEY).toString('hex'), encodeURIComponent(KEY),
    SIGNING_KEY,                                                // the signing key derived from it stays inside as well
  ];
  for (const needle of needles) {
    const at = everything.indexOf(needle);
    assert.equal(at, -1, `found ${JSON.stringify(needle)} in: ${everything.slice(Math.max(0, at - 120), at + 60)}`);
  }
  // nor does a config show it in any string form (it is what createCoachHandler holds)
  const config = configOf();
  assert.equal(config.apiKey, KEY);
  for (const form of [JSON.stringify(config), String(config), JSON.stringify({ ...config }), Object.keys(config).join()]) {
    assert.ok(!form.includes(KEY) && !form.includes(SIGNING_KEY));
  }
  // every log line of the proxy is one of the two fixed shapes
  const lines = written.filter((w) => w.startsWith('console.log: [coach]')).map((w) => w.slice('console.log: '.length));
  assert.ok(lines.length >= 30);
  for (const line of lines) {
    assert.match(line, /^\[coach\] mode=live status=\d{3} (code=[a-z_]+|end=(done|tool|aborted|none|error:[a-z_]+))( in=\d+ cached=\d+ out=\d+)? ms=\d+$/);
  }
});
