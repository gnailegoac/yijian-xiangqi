import test, { after, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import { dirname, join } from 'node:path';

import { startServer } from '../../../scripts/serve.js';

// Contract section 14.6, the T2 row: scripts/serve.js with the REAL handler of server/coach-handler.js in mock mode.
// The server is started on port 0 of the loopback interface, inside a made-up project in a temporary directory, and
// with an explicit `env`: nothing of the developer's shell and nothing of the repo's .env.local reaches the handler,
// no key exists and no request leaves this machine. Every test has a time limit and every wait has a deadline.

const FIXTURES = new URL('../../fixtures/coach/', import.meta.url);
const MARK = 'DECOY-CONTENT-THAT-MUST-NEVER-BE-SERVED';
const LIMIT = { timeout: 30000 };

/** The whole environment of the handler: mock mode by the `mock` option, nothing else that could matter. */
const ENV = { COACH_MOCK_CHUNK_MS: '5' };

const PROJECT = {
  'index.html': '<!doctype html><title>fixture</title><script type="module" src="./src/app.js"></script>\n',
  'src/app.js': 'export {};\n',
  '.env': `COACH_API_KEY=${MARK}\n`,
  '.env.local': `COACH_API_KEY=${MARK}\nCOACH_BASE_URL=https://gateway.invalid/${MARK}\n`,
  'server/coach-handler.js': `// ${MARK}\n`,
  'package.json': `{"type":"module","mark":"${MARK}"}\n`,
};

/** @type {string} */ let tmp;
/** @type {{port: number, close(): Promise<void>}} */ let server;
const startDir = process.cwd();
/** What the server and the handler logged (one line per coach request, and the refusals): kept out of the test report. */
const logged = /** @type {string[]} */ ([]);

before(async () => {
  mock.method(console, 'log', (...args) => { logged.push(args.join(' ')); });
  mock.method(console, 'error', (...args) => { logged.push(args.join(' ')); });
  tmp = await mkdtemp(join(os.tmpdir(), 'yijian-serve-coach-'));
  for (const [name, content] of Object.entries(PROJECT)) {
    const file = join(tmp, ...name.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  process.chdir(tmp);                     // the server's root is the current directory
  server = await startServer({ port: 0, host: '127.0.0.1', mock: true, env: ENV });
});

after(async () => {
  await server?.close();
  mock.restoreAll();
  process.chdir(startDir);
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// ---------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `check()` resolves true; the deadline only bounds a failing test. */
async function until(check, what, deadline = 5000) {
  const end = Date.now() + deadline;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

/** One request on its own connection; a server that does not answer within 10 s fails the test instead of hanging it. */
function request({ path = '/', method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, path, method, headers, agent: false, timeout: 10000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`no answer to ${method} ${path} within 10 s`)));
    req.on('error', reject);
    req.end(body);
  });
}

const fixture = async (name) => readFile(new URL(name, FIXTURES), 'utf8');

/** A coach POST as the page sends it from `origin` to the server it knows as `host`. */
const coach = (body, { host, origin, query = '' }) => request({
  path: `/api/coach${query}`, method: 'POST', body,
  headers: { Host: host, 'Content-Type': 'application/json', ...(origin === undefined ? {} : { Origin: origin }) },
});

/** The events of an SSE body, in order (comment lines dropped). */
function sseEvents(text) {
  const events = [];
  for (const block of text.split('\n\n')) {
    const name = /^event: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (name !== undefined && data !== undefined) events.push({ event: name, data: JSON.parse(data) });
  }
  return events;
}

const getJson = async (path) => {
  const res = await request({ path });
  assert.equal(res.status, 200, path);
  return JSON.parse(res.text);
};

// ---------------------------------------------------------------------------------------------------------------

test('/api/health', LIMIT, async () => {
  const res = await request({ path: '/api/health' });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^application\/json\b/);
  assert.deepEqual(JSON.parse(res.text), { ok: true, v: 1, mode: 'mock', model: 'mock', freeText: true });
  // the page learns the same from the generated config
  assert.deepEqual(await getJson('/config.json'), { apiBase: '/api', build: 'dev', coach: { mode: 'mock', reason: null } });
  // the health probe of an iPad, which knows the server by its LAN address
  const lan = await request({ path: '/api/health', headers: { Host: '192.168.1.50:5173', Origin: 'http://192.168.1.50:5173' } });
  assert.equal(lan.status, 200);
  assert.equal(JSON.parse(lan.text).mode, 'mock');
});

test('POST /api/coach with Host 192.168.1.50:5173 and Origin http://192.168.1.50:5173 is 200; a foreign Origin is 403', LIMIT, async () => {
  const body = await fixture('try.json');
  const lan = { host: '192.168.1.50:5173', origin: 'http://192.168.1.50:5173' };

  const res = await coach(body, lan);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-accel-buffering'], 'no');
  const events = sseEvents(res.text);
  assert.deepEqual(events[0], { event: 'open', data: { v: 1, mode: 'mock', model: 'mock' } });
  assert.ok(events.length >= 3, `open, delta+, done: ${events.map((e) => e.event).join(' ')}`);
  assert.ok(events.slice(1, -1).every((e) => e.event === 'delta'));
  const done = events[events.length - 1];
  assert.equal(done.event, 'done');
  assert.ok(done.data.text.startsWith('〔kind=try〕'), done.data.text);
  assert.equal(events.slice(1, -1).map((e) => e.data.t).join(''), done.data.text, 'the deltas add up to the signed text');
  assert.match(done.data.sig, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(done.data.model, 'mock');

  // the same request from the PC itself, by its loopback address and by name
  for (const local of [`127.0.0.1:${server.port}`, `localhost:${server.port}`]) {
    assert.equal((await coach(body, { host: local, origin: `http://${local}` })).status, 200, local);
  }

  // a page of another site that talks to the LAN address (the rule compares host and port: contract section 7.10)
  for (const origin of ['http://evil.example', 'http://evil.example:5173', 'http://192.168.1.51:5173', 'http://192.168.1.50:5174', 'http://192.168.1.50', 'null']) {
    const foreign = await coach(body, { host: lan.host, origin });
    assert.equal(foreign.status, 403, origin);
    assert.deepEqual(JSON.parse(foreign.text), { error: { code: 'origin' } }, origin);
  }
  // no Origin at all (curl) is refused unless COACH_ALLOW_NO_ORIGIN=1, which this server does not have
  const bare = await coach(body, { host: lan.host });
  assert.equal(bare.status, 403);
  assert.deepEqual(JSON.parse(bare.text), { error: { code: 'origin' } });

  // DNS rebinding: Origin and Host agree, and both carry a name that is not this machine's
  const before = await getJson('/api/mock/stats');
  const rebound = await coach(body, { host: 'evil.example:5173', origin: 'http://evil.example:5173' });
  assert.equal(rebound.status, 403);
  assert.deepEqual(JSON.parse(rebound.text), { error: { code: 'origin' } });
  assert.equal((await request({ path: '/api/health', headers: { Host: 'evil.example:5173' } })).status, 403, 'not even the health probe');
  assert.deepEqual(await getJson('/api/mock/stats'), before, 'no reply was started for it');
  assert.ok(logged.some((line) => /^\[api\] 403: .*"evil\.example:5173".*COACH_ALLOWED_HOSTS/.test(line)), 'the refused name is logged once, with the way to allow it');

  // nothing of a request body and no decoy value is in any log line
  for (const line of logged) assert.ok(!line.includes('马二进三') && !line.includes(MARK), line);
  assert.ok(logged.some((line) => /^\[coach\] mode=mock status=200 end=done /.test(line)), 'one line per coach request');
});

test('a client abort is counted in /api/mock/stats', LIMIT, async () => {
  const reset = await request({ path: '/api/mock/reset', method: 'POST' });
  assert.equal(reset.status, 200);
  assert.deepEqual(JSON.parse(reset.text), { started: 0, completed: 0, aborted: 0 });

  // a reply that would take seconds (one piece every 400 ms); the client leaves after the first piece
  const body = await fixture('try.json');
  await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: server.port, path: '/api/coach?chunkMs=400', method: 'POST', agent: false, timeout: 10000,
      headers: { Host: '192.168.1.50:5173', Origin: 'http://192.168.1.50:5173', 'Content-Type': 'application/json' },
    }, (res) => {
      res.on('error', () => {});
      if (res.statusCode !== 200) { reject(new Error(`status ${res.statusCode}`)); return; }
      let seen = '';
      res.on('data', (chunk) => {
        seen += chunk.toString('utf8');
        if (seen.includes('event: delta')) req.destroy();
      });
    });
    req.on('timeout', () => req.destroy(new Error('the stream did not start within 10 s')));
    req.on('error', (e) => { if (/** @type {{code?: string}} */ (e).code !== 'ECONNRESET') reject(e); });
    req.on('close', resolve);
    req.end(body);
  });
  await until(async () => (await getJson('/api/mock/stats')).aborted >= 1, 'the abort to be counted');
  assert.deepEqual(await getJson('/api/mock/stats'), { started: 1, completed: 0, aborted: 1 });

  // a reply that runs to its end is counted as completed, not as aborted
  assert.equal((await coach(body, { host: '192.168.1.50:5173', origin: 'http://192.168.1.50:5173' })).status, 200);
  await until(async () => (await getJson('/api/mock/stats')).completed >= 1, 'the completed reply to be counted');
  assert.deepEqual(await getJson('/api/mock/stats'), { started: 2, completed: 1, aborted: 1 });
});

test('GET /.env.local is still 404 with the coach mounted', LIMIT, async () => {
  for (const path of ['/.env.local', '/.env', '/server/coach-handler.js', '/package.json', '/api/../.env.local', '/api/%2e%2e/.env.local']) {
    const res = await request({ path });
    assert.ok(res.status === 404 || res.status === 403, `${path} -> ${res.status}`);
    assert.ok(!res.text.includes(MARK), `${path}: the answer carries decoy content`);
  }
  assert.equal((await request({ path: '/.env.local' })).status, 404);
  assert.ok((await readFile(join(tmp, '.env.local'), 'utf8')).includes(MARK), 'the decoy is there: the 404 is a refusal');
  // the handler never saw the decoy key either: the server was started with an explicit env, and it is still a mock
  assert.equal((await getJson('/api/health')).mode, 'mock');
  assert.equal((await request({ path: '/index.html' })).status, 200);
});
