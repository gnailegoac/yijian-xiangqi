// Tests of src/config.js (SPEC 4.26, 14.4). The eight titles of 14.4 come first, verbatim; the rest prove the same rules
// from other sides. No test touches the network: fetch is always a script, and a test that would wait for ever fails
// after a bounded real-time wait instead (CONTRACT-NOTES 125).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../../../src/config.js';

/** The real timer, taken before any test mocks the global one. */
const realSetTimeout = globalThis.setTimeout;

/** The page as the iPad opens it on the LAN (plain http, not loopback). */
const PAGE = 'http://192.168.1.50:5173/index.html';
const NO_PROXY = { apiBase: null, build: 'unknown', coach: { mode: 'off', reason: 'no_proxy' } };

/** @template T @param {Promise<T>} promise @param {number} [ms] @returns {Promise<T>} fails instead of hanging */
function within(promise, ms = 3000) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  const limit = new Promise((_, reject) => {
    timer = realSetTimeout(() => reject(new Error(`still pending after ${ms} ms`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** Lets every pending promise reaction run. */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** @param {unknown} body @param {number} [status] */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * A scripted fetch that records what it was asked.
 * @param {(url:string, init:RequestInit|undefined) => Response|Promise<Response>} answer
 */
function scriptedFetch(answer) {
  /** @type {{url:string, init:RequestInit|undefined}[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fn = async (input, init) => {
    calls.push({ url: String(input), init });
    return answer(String(input), init);
  };
  return { fn, calls };
}

/** @param {unknown} file the parsed content of config.json @param {{page?:string, search?:string}} [opts] */
async function loadWith(file, opts) {
  const fetch = scriptedFetch(() => jsonResponse(file));
  const location = /** @type {Location} */ (/** @type {unknown} */ ({ search: opts?.search ?? '' }));
  const config = await within(loadConfig({ fetch: fetch.fn, location, baseURI: opts?.page ?? PAGE }));
  return { config, calls: fetch.calls };
}

/** Silences console.warn for one test and counts the calls. @param {import('node:test').TestContext} t */
function quietWarnings(t) {
  return t.mock.method(console, 'warn', () => {});
}

// ---------------------------------------------------------------------------------------------------------------
// The titles of SPEC 14.4
// ---------------------------------------------------------------------------------------------------------------

test('404', async () => {
  const fetch = scriptedFetch(() => new Response('Not found', { status: 404 }));
  const config = await within(loadConfig({ fetch: fetch.fn, baseURI: PAGE }));
  assert.deepEqual(config, NO_PROXY);

  // one GET of ./config.json next to the page, never from the HTTP cache, with an abort signal
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, 'http://192.168.1.50:5173/config.json');
  const init = fetch.calls[0].init;
  assert.equal(init?.cache, 'no-store');
  assert.ok(init?.method === undefined || init.method === 'GET');
  assert.ok(init?.signal instanceof AbortSignal);
  assert.equal(init?.body, undefined);

  // "not 200" is literal: a valid file under another status is not used either
  for (const status of [201, 203, 500, 503]) {
    const other = scriptedFetch(() => jsonResponse({ apiBase: '/api', build: 'dev', coach: { mode: 'live', reason: null } }, status));
    assert.deepEqual(await within(loadConfig({ fetch: other.fn, baseURI: PAGE })), NO_PROXY, `status ${status}`);
  }
});

test('bad JSON', async () => {
  // a static host that answers every path with its index page
  const html = scriptedFetch(() => new Response('<!doctype html><title>弈间</title>', { status: 200, headers: { 'content-type': 'text/html' } }));
  assert.deepEqual(await within(loadConfig({ fetch: html.fn, baseURI: PAGE })), NO_PROXY);

  const cut = scriptedFetch(() => new Response('{"apiBase":"/api","build":', { status: 200 }));
  assert.deepEqual(await within(loadConfig({ fetch: cut.fn, baseURI: PAGE })), NO_PROXY);

  const empty = scriptedFetch(() => new Response('', { status: 200 }));
  assert.deepEqual(await within(loadConfig({ fetch: empty.fn, baseURI: PAGE })), NO_PROXY);

  // JSON, but not a config object
  for (const text of ['null', '[]', '"/api"', '42', 'true', '[{"apiBase":"/api"}]']) {
    const other = scriptedFetch(() => new Response(text, { status: 200 }));
    assert.deepEqual(await within(loadConfig({ fetch: other.fn, baseURI: PAGE })), NO_PROXY, text);
  }
});

test('timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  // a server that never answers; like the browser's fetch, the script rejects when its signal aborts
  /** @type {AbortSignal|undefined} */
  let signal;
  /** @type {typeof fetch} */
  const hanging = (input, init) => new Promise((_, reject) => {
    signal = init?.signal ?? undefined;
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  let settled = false;
  const pending = loadConfig({ fetch: hanging, baseURI: PAGE }).then((config) => {
    settled = true;
    return config;
  });
  await flush();
  t.mock.timers.tick(1499);
  await flush();
  assert.equal(settled, false, 'still waiting just before 1500 ms');
  assert.equal(signal?.aborted, false);
  t.mock.timers.tick(1);
  assert.deepEqual(await within(pending), NO_PROXY);
  assert.equal(signal?.aborted, true, 'the request is aborted at 1500 ms');

  // a fetch that ignores its signal cannot hold the boot up either
  /** @type {typeof fetch} */
  const deaf = () => new Promise(() => {});
  const second = loadConfig({ fetch: deaf, baseURI: PAGE });
  await flush();
  t.mock.timers.tick(1500);
  assert.deepEqual(await within(second), NO_PROXY);

  // the limit covers the body as well: headers arrive, the body never does
  /** @type {typeof fetch} */
  const stalled = async () => /** @type {Response} */ (/** @type {unknown} */ ({ status: 200, json: () => new Promise(() => {}) }));
  const third = loadConfig({ fetch: stalled, baseURI: PAGE });
  await flush();
  t.mock.timers.tick(1500);
  assert.deepEqual(await within(third), NO_PROXY);

  // an answer in time leaves no timer behind: nothing is aborted later
  const quick = scriptedFetch(() => jsonResponse({ apiBase: '/api', build: 'dev', coach: { mode: 'mock', reason: null } }));
  const fourth = await within(loadConfig({ fetch: quick.fn, baseURI: PAGE }));
  assert.equal(fourth.apiBase, '/api');
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(quick.calls[0].init?.signal?.aborted, false);
});

test('relative /api', async () => {
  // what scripts/serve.js generates (SPEC 4.30.1)
  const { config } = await loadWith({ apiBase: '/api', build: 'dev', coach: { mode: 'live', reason: null } });
  assert.deepEqual(config, { apiBase: '/api', build: 'dev', coach: { mode: 'live', reason: null } });

  // step 4: a trailing '/' is stripped, so the endpoints are `${apiBase}/coach` and `${apiBase}/health`
  assert.equal((await loadWith({ apiBase: '/api/' })).config.apiBase, '/api');
  assert.equal((await loadWith({ apiBase: './api' })).config.apiBase, './api');
  assert.equal((await loadWith({ apiBase: 'coach/api/' })).config.apiBase, 'coach/api');

  // the page's own origin written out in full is the same origin
  assert.equal((await loadWith({ apiBase: 'http://192.168.1.50:5173/api' })).config.apiBase, 'http://192.168.1.50:5173/api');

  // a page in a sub-folder (a static host): the file is looked for next to the page
  const sub = await loadWith({ apiBase: 'api' }, { page: 'https://example.github.io/yijian/' });
  assert.equal(sub.calls[0].url, 'https://example.github.io/yijian/config.json');
  assert.equal(sub.config.apiBase, 'api');
});

test('https URL', async () => {
  // what scripts/build.js writes when COACH_API_BASE is set (SPEC 4.30.2 step 6): another origin, allowed because it is https
  const { config } = await loadWith({ apiBase: 'https://coach.example.com/v1', build: 'a1b2c3d', coach: { mode: 'live', reason: null } },
                                    { page: 'https://example.github.io/yijian/' });
  assert.deepEqual(config, { apiBase: 'https://coach.example.com/v1', build: 'a1b2c3d', coach: { mode: 'live', reason: null } });

  // also from a plain-http page, and with the trailing '/' stripped
  assert.equal((await loadWith({ apiBase: 'https://coach.example.com/v1/' })).config.apiBase, 'https://coach.example.com/v1');
});

test('rejects http://evil.example and javascript:', async (t) => {
  const warn = quietWarnings(t);
  for (const apiBase of ['http://evil.example', 'http://evil.example/api', 'javascript:alert(1)']) {
    const before = warn.mock.callCount();
    const { config } = await loadWith({ apiBase, build: 'dev', coach: { mode: 'live', reason: null } });
    assert.deepEqual(config, { apiBase: null, build: 'dev', coach: { mode: 'off', reason: 'no_proxy' } }, apiBase);
    assert.equal(warn.mock.callCount(), before + 1, `one console.warn for ${apiBase}`);
  }

  // everything else that is neither the page's origin, nor https, nor http on localhost / 127.0.0.1
  const others = ['//evil.example/api', 'http://localhost.evil.example/api', 'http://127.0.0.1.evil.example/api', 'http://192.168.1.51:5173/api',
                  'http://192.168.1.50:5174/api', 'ftp://192.168.1.50/api', 'ws://localhost:5173/api', 'data:text/plain,api', 'file:///api',
                  'http://[::1]:5173/api', 'http://'];
  for (const apiBase of others) {
    const { config } = await loadWith({ apiBase, build: 'dev', coach: { mode: 'live', reason: null } });
    assert.equal(config.apiBase, null, apiBase);
    assert.equal(config.coach.mode, 'off', apiBase);
  }

  // not a string at all
  for (const apiBase of [42, true, {}, ['/api']]) {
    assert.equal((await loadWith({ apiBase })).config.apiBase, null, JSON.stringify(apiBase));
  }
});

test('?coach=off', async () => {
  const off = { apiBase: null, build: 'unknown', coach: { mode: 'off', reason: 'setting' } };
  for (const search of ['?coach=off', '?test=1&coach=off', '?coach=off&seed=7', '?coach=auto&coach=off']) {
    const { config, calls } = await loadWith({ apiBase: '/api', build: 'dev', coach: { mode: 'live', reason: null } }, { search });
    assert.deepEqual(config, off, search);
    assert.equal(calls.length, 0, `no request with ${search}`);
  }

  // anything else in the URL changes nothing: it can only disable, never set an endpoint
  const file = { apiBase: '/api', build: 'dev', coach: { mode: 'live', reason: null } };
  for (const search of ['', '?coach=on', '?coach=offline', '?coach=OFF', '?coach=https://evil.example/api', '?apiBase=https://evil.example/api',
                        '?coachoff', '?test=1']) {
    const { config, calls } = await loadWith(file, { search });
    assert.deepEqual(config, file, search);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://192.168.1.50:5173/config.json', search);
  }
});

test('carries coach.reason', async () => {
  // the dev server without a key (SPEC 4.30.1 route 2)
  const noKey = await loadWith({ apiBase: null, build: 'dev', coach: { mode: 'off', reason: 'no_key' } });
  assert.deepEqual(noKey.config, { apiBase: null, build: 'dev', coach: { mode: 'off', reason: 'no_key' } });

  // the static build without a proxy (SPEC 4.30.2 step 6)
  const built = await loadWith({ apiBase: null, build: '0ee3a29', coach: { mode: 'off', reason: 'no_proxy' } });
  assert.deepEqual(built.config, { apiBase: null, build: '0ee3a29', coach: { mode: 'off', reason: 'no_proxy' } });

  // mock mode keeps its name
  const mock = await loadWith({ apiBase: '/api', build: 'dev', coach: { mode: 'mock', reason: null } });
  assert.deepEqual(mock.config, { apiBase: '/api', build: 'dev', coach: { mode: 'mock', reason: null } });
});

// ---------------------------------------------------------------------------------------------------------------
// More of the same rules
// ---------------------------------------------------------------------------------------------------------------

test('http on localhost and 127.0.0.1 is allowed from another origin', async () => {
  assert.equal((await loadWith({ apiBase: 'http://localhost:8787/api' })).config.apiBase, 'http://localhost:8787/api');
  assert.equal((await loadWith({ apiBase: 'http://127.0.0.1:8787/api/' })).config.apiBase, 'http://127.0.0.1:8787/api');
  assert.equal((await loadWith({ apiBase: 'http://localhost/api' }, { page: 'https://example.github.io/yijian/' })).config.apiBase,
               'http://localhost/api');
});

test('the result always has the three fields and coach agrees with apiBase', async (t) => {
  quietWarnings(t);
  // the older file shape without a coach block
  assert.deepEqual((await loadWith({ apiBase: '/api', build: 'dev' })).config, { apiBase: '/api', build: 'dev', coach: { mode: 'live', reason: null } });
  assert.deepEqual((await loadWith({ apiBase: null })).config, NO_PROXY);
  assert.deepEqual((await loadWith({})).config, NO_PROXY);
  assert.deepEqual((await loadWith({ apiBase: '' , build: '' })).config, NO_PROXY);

  // a coach block that contradicts the endpoint does not survive
  assert.deepEqual((await loadWith({ apiBase: '/api', build: 'dev', coach: { mode: 'off', reason: 'no_key' } })).config,
                   { apiBase: '/api', build: 'dev', coach: { mode: 'live', reason: null } });
  assert.deepEqual((await loadWith({ apiBase: null, build: 'dev', coach: { mode: 'live', reason: null } })).config,
                   { apiBase: null, build: 'dev', coach: { mode: 'off', reason: 'no_proxy' } });
  assert.deepEqual((await loadWith({ apiBase: 'http://evil.example', build: 'dev', coach: { mode: 'mock', reason: null } })).config,
                   { apiBase: null, build: 'dev', coach: { mode: 'off', reason: 'no_proxy' } });

  // values the typedef does not know are not passed on
  assert.deepEqual((await loadWith({ apiBase: null, build: 7, coach: { mode: 'off', reason: 'because' } })).config, NO_PROXY);
  assert.deepEqual((await loadWith({ apiBase: '/api', build: 'dev', coach: 'live' })).config,
                   { apiBase: '/api', build: 'dev', coach: { mode: 'live', reason: null } });
});

test('never rejects', async (t) => {
  quietWarnings(t);
  /** @type {typeof fetch} */
  const throwing = () => { throw new TypeError('fetch is broken'); };
  assert.deepEqual(await within(loadConfig({ fetch: throwing, baseURI: PAGE })), NO_PROXY);

  /** @type {typeof fetch} */
  const offline = () => Promise.reject(new TypeError('Failed to fetch'));
  assert.deepEqual(await within(loadConfig({ fetch: offline, baseURI: PAGE })), NO_PROXY);

  /** @type {typeof fetch} */
  const badBody = async () => /** @type {Response} */ (/** @type {unknown} */ ({ status: 200, json: () => Promise.reject(new Error('stream error')) }));
  assert.deepEqual(await within(loadConfig({ fetch: badBody, baseURI: PAGE })), NO_PROXY);

  // a base address that is no URL
  const fine = scriptedFetch(() => jsonResponse({ apiBase: '/api' }));
  assert.deepEqual(await within(loadConfig({ fetch: fine.fn, baseURI: 'not a url' })), NO_PROXY);

  // a location that throws when it is read (the last net of loadConfig: whatever goes wrong, the game plays without a proxy)
  const hostile = /** @type {Location} */ (/** @type {unknown} */ ({ get search() { throw new Error('denied'); } }));
  assert.deepEqual(await within(loadConfig({ fetch: fine.fn, location: hostile, baseURI: PAGE })), NO_PROXY);

  // outside a page (no document, no location) and with nothing injected: no request is attempted
  assert.equal(typeof globalThis.document, 'undefined');
  assert.deepEqual(await within(loadConfig()), NO_PROXY);
  assert.deepEqual(await within(loadConfig({})), NO_PROXY);
});

test('an address that only looks local or same-origin is refused', async (t) => {
  quietWarnings(t);
  // the host is what the URL parser says it is, not what the text starts with
  const disguised = ['http://localhost@evil.example/api', 'http://127.0.0.1@evil.example/api', 'http://localhost:80@evil.example/api',
                     'http://192.168.1.50:5173@evil.example/api', 'http:\\\\evil.example\\api', '\\\\evil.example\\api', '/\\evil.example/api',
                     'http://127.0.0.2/api', 'http://localhost.:5173.evil.example/api', 'HTTP://EVIL.EXAMPLE/api', ' http://evil.example/api '];
  for (const apiBase of disguised) {
    const { config } = await loadWith({ apiBase, build: 'dev', coach: { mode: 'live', reason: null } });
    assert.deepEqual(config, { apiBase: null, build: 'dev', coach: { mode: 'off', reason: 'no_proxy' } }, apiBase);
  }

  // a page opened from a file has no origin of its own: nothing is "the same origin" there, https still is allowed
  const filePage = 'file:///C:/games/yijian/index.html';
  assert.equal((await loadWith({ apiBase: '/api' }, { page: filePage })).config.apiBase, null);
  assert.equal((await loadWith({ apiBase: 'api' }, { page: filePage })).config.apiBase, null);
  assert.equal((await loadWith({ apiBase: 'https://coach.example.com/v1' }, { page: filePage })).config.apiBase, 'https://coach.example.com/v1');

  // spelling that the URL parser normalises to an allowed address stays allowed, and is returned as the file wrote it
  assert.equal((await loadWith({ apiBase: 'HTTP://LOCALHOST:8787/api' })).config.apiBase, 'HTTP://LOCALHOST:8787/api');
  assert.equal((await loadWith({ apiBase: '  /api/  ' })).config.apiBase, '/api');
});

test('a handler mounted at the root: "/" gives the endpoints /coach and /health', async () => {
  const { config } = await loadWith({ apiBase: '/', build: 'dev', coach: { mode: 'live', reason: null } });
  assert.deepEqual(config, { apiBase: '', build: 'dev', coach: { mode: 'live', reason: null } });
  assert.equal(`${config.apiBase}/coach`, '/coach');
  assert.equal(`${config.apiBase}/health`, '/health');
});

test('with no env it reads the page itself: location.search, document.baseURI and the global fetch', async (t) => {
  // this is how src/app.js calls it; the globals are put back whatever happens
  const g = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis));
  const had = { location: Object.getOwnPropertyDescriptor(g, 'location'), document: Object.getOwnPropertyDescriptor(g, 'document') };
  t.after(() => {
    for (const key of /** @type {const} */ (['location', 'document'])) {
      const before = had[key];
      if (before) Object.defineProperty(g, key, before);
      else delete g[key];
    }
  });
  /** @type {string[]} */
  const asked = [];
  t.mock.method(globalThis, 'fetch', async (/** @type {unknown} */ input, /** @type {RequestInit|undefined} */ init) => {
    asked.push(`${String(input)} ${init?.cache}`);
    return jsonResponse({ apiBase: '/api', build: 'dev', coach: { mode: 'mock', reason: null } });
  });
  const page = (/** @type {string} */ search) => {
    Object.defineProperty(g, 'location', { value: { search }, configurable: true, writable: true });
    Object.defineProperty(g, 'document', { value: { baseURI: 'http://192.168.1.50:5173/sub/index.html' }, configurable: true, writable: true });
  };

  page('');
  assert.deepEqual(await within(loadConfig()), { apiBase: '/api', build: 'dev', coach: { mode: 'mock', reason: null } });
  assert.deepEqual(asked, ['http://192.168.1.50:5173/sub/config.json no-store']);

  page('?seed=7&coach=off');
  assert.deepEqual(await within(loadConfig()), { apiBase: null, build: 'unknown', coach: { mode: 'off', reason: 'setting' } });
  assert.equal(asked.length, 1, 'no request with ?coach=off in the address of the page');

  // what is injected wins over the page
  const own = scriptedFetch(() => jsonResponse({ apiBase: null, build: 'x', coach: { mode: 'off', reason: 'no_key' } }));
  const location = /** @type {Location} */ (/** @type {unknown} */ ({ search: '' }));
  assert.deepEqual(await within(loadConfig({ fetch: own.fn, location, baseURI: PAGE })), { apiBase: null, build: 'x', coach: { mode: 'off', reason: 'no_key' } });
  assert.equal(own.calls[0].url, 'http://192.168.1.50:5173/config.json');
  assert.equal(asked.length, 1);
});
