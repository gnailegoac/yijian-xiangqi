import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeIcon } from '../../../scripts/make-icons.js';
import { startServer } from '../../../scripts/serve.js';

// Contract section 4.30.1 (and D-24, D-26, section 14.6). The server is started on port 0 inside a made-up project
// in a temporary directory: the decoys below stand for the files that must never leave the owner's PC. The real
// .env.local of the repo is never touched, and the real coach handler is never loaded: every server here gets a
// fake fetch-style handler, and the CLI tests run a copy of the scripts next to a fake server/coach-handler.js.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts');
const MARK = 'DECOY-CONTENT-THAT-MUST-NEVER-BE-SERVED';
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 0, 255]);

/** The project as the server sees it: what may be served, and decoys for everything that may not. */
const FIXTURE = {
  'index.html': '<!doctype html><title>fixture</title><script type="module" src="./src/app.js"></script>\n',
  'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
  'manifest.webmanifest': '{"name":"fixture"}\n',
  'src/app.js': "import './core/codes.js';\n",
  'src/core/codes.js': 'export const CATS = [];\n',
  'src/notes.txt': 'plain text\n',
  'src/data.json': '{"a":1}\n',
  'src/pic.png': PNG_BYTES,
  'styles/tokens.css': ':root { --page: #0b0f1d; }\n',
  'dev/board.html': '<!doctype html><title>dev harness</title>\n',

  '.env': `COACH_API_KEY=${MARK}\n`,
  '.env.local': `COACH_API_KEY=${MARK}\n`,
  '.git/HEAD': `ref: ${MARK}\n`,
  '.github/workflows/deploy.yml': `# ${MARK}\n`,
  'server/coach-handler.js': `// ${MARK}\n`,
  'scripts/serve.js': `// ${MARK}\n`,
  'tests/unit/core/codes.test.js': `// ${MARK}\n`,
  'tests/fixtures/saves/v1.json': `{"mark":"${MARK}"}\n`,
  'node_modules/openai/index.js': `// ${MARK}\n`,
  'node_modules/openai/package.json': `{"mark":"${MARK}"}\n`,
  'legacy/index.html': `<!-- ${MARK} -->\n`,
  'legacy/src/app.js': `// ${MARK}\n`,
  'package.json': `{"type":"module","mark":"${MARK}"}\n`,
  'package-lock.json': `{"mark":"${MARK}"}\n`,
  'tsconfig.json': `{"mark":"${MARK}"}\n`,
  'playwright.config.js': `// ${MARK}\n`,
  'README.md': `${MARK}\n`,
  'notes.txt': `${MARK}\n`,
  'app.js': `// ${MARK}\n`,
  'src/.hidden.js': `// ${MARK}\n`,
  'src/.env.local': `COACH_API_KEY=${MARK}\n`,
  'src/secret.env': `COACH_API_KEY=${MARK}\n`,
  'src/app.js.map': `{"mark":"${MARK}"}\n`,
  'src/README.md': `${MARK}\n`,
  'src/data.bin': `${MARK}\n`,
  'src/noext': `${MARK}\n`,
  'src/server/inner.js': `// ${MARK}\n`,
  'src/tests/inner.js': `// ${MARK}\n`,
  'styles/.git/HEAD': `ref: ${MARK}\n`,

  'dist/index.html': '<!doctype html><title>built</title>\n',
  'dist/config.json': '{"apiBase":null,"build":"abc123","coach":{"mode":"off","reason":"no_proxy"}}\n',
  'dist/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg" id="built"></svg>\n',
  'dist/manifest.webmanifest': '{"name":"built"}\n',
  'dist/icons/apple-touch-icon.png': Buffer.concat([PNG_BYTES, Buffer.from('built')]),
  'dist/a/abc123/src/app.js': '// built app\n',
  'dist/a/abc123/styles/tokens.css': ':root { --built: 1; }\n',
  'dist/dev/board.html': `<!-- ${MARK} -->\n`,
  'dist/.env': `COACH_API_KEY=${MARK}\n`,
  'dist/server/inner.js': `// ${MARK}\n`,
  'dist/package.json': `{"mark":"${MARK}"}\n`,
};

/** @type {string} */ let tmp;
/** @type {string} */ let project;
const startDir = process.cwd();
/** @type {Record<string, string|undefined>} */ const savedEnv = {};
/** @type {import('node:child_process').ChildProcess[]} */ const children = [];

async function writeTree(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, ...name.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}

before(async () => {
  tmp = await mkdtemp(join(os.tmpdir(), 'yijian-serve-'));
  project = join(tmp, 'project');
  await writeTree(project, FIXTURE);
  await writeTree(join(tmp, 'outside'), { 'secret.js': `// ${MARK}\n` });
  // The developer's shell may carry COACH_ variables; these tests decide them alone.
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('COACH_')) { savedEnv[name] = process.env[name]; delete process.env[name]; }
  }
  process.chdir(project);                 // the server's root is the current directory
});

after(async () => {
  for (const child of children) child.kill();
  process.chdir(startDir);
  Object.assign(process.env, savedEnv);
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// ---------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `check()` is true; the deadline only bounds a failing test. */
async function until(check, what, deadline = 5000) {
  const end = Date.now() + deadline;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

/** One request on its own connection. `path` is sent as written (http.request does not normalise it). */
function request(port, { path = '/', method = 'GET', headers = {}, body, onChunk } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => { chunks.push(chunk); onChunk?.(chunk); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), chunks }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (typeof body === 'function') body(req); else req.end(body);
  });
}

/** A request line written byte for byte, for targets that no HTTP client would send. */
function raw(port, target, method = 'GET') {
  return new Promise((resolve, reject) => {
    const parts = [];
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`${method} ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`, 'latin1');
    });
    socket.on('data', (part) => parts.push(part));
    socket.on('error', reject);
    socket.on('close', () => {
      const text = Buffer.concat(parts).toString('latin1');
      resolve({ status: Number(/^HTTP\/1\.1 (\d{3})/.exec(text)?.[1] ?? 0), text });
    });
  });
}

/**
 * The fake fetch-style handler of section 14.6: it streams three chunks 50 ms apart and records every call and
 * every abort. Other paths give the behaviours the adapter must survive.
 */
function fakeCoach() {
  const calls = [];
  const shared = { firstChunkSeen: false, stopped: false };
  /** Ends every stream that is still running, so that a failing test fails instead of hanging. */
  let stop = () => {};
  const stopped = new Promise((resolve) => { stop = () => { shared.stopped = true; resolve(undefined); }; });
  const encoder = new TextEncoder();
  const handler = async (request, env, ctx) => {
    const url = new URL(request.url);
    const call = {
      method: request.method, path: url.pathname, query: url.search, headers: Object.fromEntries(request.headers),
      body: '', env, ctx, aborted: false, cancelled: false, enqueued: 0, firstSeenBeforeLast: null,
    };
    calls.push(call);
    const gone = new Promise((resolve) => {
      request.signal.addEventListener('abort', () => { call.aborted = true; resolve(undefined); }, { once: true });
    });
    if (request.method !== 'GET' && request.method !== 'HEAD') call.body = await request.text();

    if (url.pathname.endsWith('/throw')) throw new Error('boom from the fake handler');
    if (url.pathname.endsWith('/empty')) return new Response(null, { status: 204, headers: { 'x-fake': 'empty' } });
    if (url.pathname.endsWith('/json')) return Response.json({ ok: true }, { status: 503 });
    if (url.pathname.endsWith('/wait')) { await Promise.race([gone, stopped]); throw new Error('the client left before any answer'); }
    if (url.pathname.endsWith('/deaf')) {
      // a stream that never ends and never looks at the signal
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(encoder.encode('data: first\n\n')); call.enqueued++; },
        cancel() { call.cancelled = true; },
      }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
    }
    if (url.pathname.endsWith('/broken')) {
      return new Response(new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode('data: first\n\n'));
          await sleep(20);
          controller.error(new Error('the upstream broke mid-stream'));
        },
      }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
    }
    const endless = url.pathname.endsWith('/endless');
    const stream = new ReadableStream({
      async start(controller) {
        for (let n = 0; (endless || n < 3) && !request.signal.aborted && !shared.stopped; n++) {
          if (n === 2) call.firstSeenBeforeLast = shared.firstChunkSeen;
          controller.enqueue(encoder.encode(`event: delta\ndata: {"n":${n}}\n\n`));
          call.enqueued++;
          await Promise.race([sleep(50), gone, stopped]);
        }
        try { controller.close(); } catch { /* cancelled by the adapter */ }
      },
      cancel() { call.cancelled = true; },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
    });
  };
  return { handler, calls, shared, stop };
}

/** Starts a server on an ephemeral loopback port for the duration of `run`. */
async function withServer(options, run) {
  const coach = fakeCoach();
  const server = await startServer({ port: 0, host: '127.0.0.1', handler: coach.handler, env: {}, ...options });
  try {
    return await run(server.port, coach);
  } finally {
    coach.stop();
    await server.close();
  }
}

function assertNoLeak(response, what) {
  const text = Buffer.isBuffer(response.body) ? response.body.toString('latin1') : response.text;
  assert.ok(!text.includes(MARK), `${what}: the answer carries decoy content`);
}

// ---------------------------------------------------------------------------------------------------------------
// the static allowlist
// ---------------------------------------------------------------------------------------------------------------

const REFUSED = [
  '/.env.local', '/.env', '/.git/HEAD', '/.github/workflows/deploy.yml',
  '/server/coach-handler.js', '/scripts/serve.js', '/package.json', '/package-lock.json',
  '/tests/unit/core/codes.test.js', '/tests/fixtures/saves/v1.json',
  '/node_modules/openai/index.js', '/node_modules/openai/package.json',
  '/legacy/index.html', '/legacy/src/app.js',
  // files of the root that are not on the list, even with an allowed extension
  '/tsconfig.json', '/playwright.config.js', '/README.md', '/notes.txt', '/app.js',
  // inside an allowed tree: dot-files, extensions off the list, refused names
  '/src/.hidden.js', '/src/.env.local', '/src/secret.env', '/src/app.js.map', '/src/README.md', '/src/data.bin',
  '/src/noext', '/src/server/inner.js', '/src/tests/inner.js', '/styles/.git/HEAD',
  // directories and things that do not exist
  '/src', '/src/', '/src/core', '/src/core/', '/dev/', '/styles/', '/src/missing.js', '/missing.html', '/dist/index.html',
];

test('serves index.html and a module; GET /.env.local, /.git/HEAD, /server/coach-handler.js, /scripts/serve.js, /package.json, /tests/…, /node_modules/… are 404', async () => {
  await withServer({}, async (port) => {
    const expectOk = async (path, type, content) => {
      const res = await request(port, { path });
      assert.equal(res.status, 200, path);
      assert.equal(res.headers['content-type'], type, path);
      assert.equal(res.headers['cache-control'], 'no-cache', path);
      assert.equal(res.headers['x-content-type-options'], 'nosniff', path);
      assert.deepEqual(res.body, Buffer.from(content), path);
    };
    await expectOk('/index.html', 'text/html; charset=utf-8', FIXTURE['index.html']);
    await expectOk('/', 'text/html; charset=utf-8', FIXTURE['index.html']);
    await expectOk('/src/app.js', 'text/javascript; charset=utf-8', FIXTURE['src/app.js']);
    await expectOk('/src/core/codes.js', 'text/javascript; charset=utf-8', FIXTURE['src/core/codes.js']);
    await expectOk('/src/app.js?v=1', 'text/javascript; charset=utf-8', FIXTURE['src/app.js']);
    await expectOk('/styles/tokens.css', 'text/css; charset=utf-8', FIXTURE['styles/tokens.css']);
    await expectOk('/favicon.svg', 'image/svg+xml', FIXTURE['favicon.svg']);
    await expectOk('/manifest.webmanifest', 'application/manifest+json; charset=utf-8', FIXTURE['manifest.webmanifest']);
    await expectOk('/dev/board.html', 'text/html; charset=utf-8', FIXTURE['dev/board.html']);
    await expectOk('/src/notes.txt', 'text/plain; charset=utf-8', FIXTURE['src/notes.txt']);
    await expectOk('/src/data.json', 'application/json; charset=utf-8', FIXTURE['src/data.json']);
    await expectOk('/src/pic.png', 'image/png', PNG_BYTES);

    for (const path of REFUSED) {
      const res = await request(port, { path });
      assert.equal(res.status, 404, path);
      assert.equal(res.headers['x-content-type-options'], 'nosniff', path);
      assertNoLeak(res, path);
    }
    // the decoys are really there: a 404 above is a refusal, not an absence
    for (const name of ['.env.local', '.git/HEAD', 'server/coach-handler.js', 'scripts/serve.js', 'package.json',
      'tests/unit/core/codes.test.js', 'node_modules/openai/index.js', 'src/.hidden.js', 'src/data.bin']) {
      assert.ok((await readFile(join(project, ...name.split('/')), 'utf8')).includes(MARK), name);
    }
  });
});

test('HEAD answers like GET without a body; other methods are 405 and say nothing about the path', async () => {
  await withServer({}, async (port) => {
    const head = await request(port, { path: '/src/app.js', method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-length'], String(Buffer.byteLength(FIXTURE['src/app.js'])));
    assert.equal(head.body.length, 0);
    assert.equal((await request(port, { path: '/.env.local', method: 'HEAD' })).status, 404);

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const there = await request(port, { path: '/index.html', method, body: 'x' });
      const secret = await request(port, { path: '/.env.local', method, body: 'x' });
      const absent = await request(port, { path: '/nothing-here.html', method, body: 'x' });
      assert.deepEqual([there.status, secret.status, absent.status], [405, 405, 405], method);
      assert.equal(there.headers.allow, 'GET, HEAD');
      assertNoLeak(secret, `${method} /.env.local`);
    }
  });
});

test('path traversal is 404', async () => {
  await withServer({}, async (port) => {
    assert.equal((await raw(port, '/src/app.js')).status, 200, 'the raw client reaches the server');
    const targets = [
      // plain dot segments
      '/../.env.local', '/..', '/.', '/./.env.local', '/./index.html', '/src/../.env.local', '/src/../index.html',
      '/src/../../.env.local', '/src/../package.json', '/src/./app.js', '/src/core/../../.env.local',
      '/src/core/../app.js', '/styles/../server/coach-handler.js', '/index.html/../.env.local', '/dev/../.git/HEAD',
      '/src/../../../../../../../../etc/passwd', '/src/..', '/src/.',
      // encoded dots and separators
      '/%2e%2e/.env.local', '/%2E%2E/%2Eenv.local', '/%2e/.env.local', '/%2eenv.local', '/.env%2elocal', '/%2eenv%2elocal',
      '/%2egit/HEAD', '/src/%2e%2e/.env.local', '/src/%2e%2e/index.html', '/src/.%2e/.env.local', '/src/%2e./.env.local',
      '/src/%2e%2e%2f.env.local', '/src/..%2f.env.local', '/src/..%2F..%2Fpackage.json', '/src%2f..%2f.env.local',
      '/src%2fapp.js', '/src/core%2fcodes.js', '/src/%2e%2e%5c.env.local', '/src/..%5c.env.local', '/src%5capp.js',
      // double encoding, overlong and look-alike forms
      '/%252e%252e/.env.local', '/src/%252e%252e/.env.local', '/%252eenv.local', '/src/%252e%252e%252f.env.local',
      '/..%c0%af.env.local', '/%c0%ae%c0%ae/.env.local', '/src/%c0%ae%c0%ae/package.json',
      '/src/%ef%bc%8e%ef%bc%8e/.env.local', '/src/%e2%80%a5/.env.local', '/%ef%bc%8eenv.local',
      // raw backslashes
      '/src\\..\\.env.local', '/src/..\\.env.local', '/..\\.env.local', '/\\.env.local', '/src\\app.js', '/\\src\\app.js',
      // NUL, suffixes and separators after the name
      '/.env.local%00', '/.env.local%00.js', '/src/app.js%00', '/index.html%00.env.local', '/src/%00/app.js',
      '/.env.local/', '/.env.local/.', '/.env.local/index.html', '/.env.local;.js', '/.env.local?x=.js', '/.env.local?/src/app.js',
      '/.env.local#index.html', '/package.json?.html', '/package.json#/src/app.js',
      // empty segments
      '//.env.local', '///.env.local', '//package.json', '//src/app.js', '/src//app.js', '/src/app.js/',
      // letter case, trailing dots and spaces, alternate data streams, short names, drives (Windows file-system tricks)
      '/.ENV.LOCAL', '/.Env.Local', '/.env.local.', '/.env.local%20', '/.env.local::$DATA', '/.env.local:$DATA',
      '/src/app.js::$DATA', '/src/app.js:x', '/src/app.js.', '/src/app.js%20', '/src/app.js..', '/SRC/app.js', '/Src/App.js',
      '/src/APP.JS', '/src/App.js', '/src/core/Codes.js', '/src/CORE/codes.js', '/dev/Board.html', '/styles/Tokens.css',
      '/Index.html', '/Favicon.svg', '/index.HTML', '/INDEX.HTML', '/PACKAGE.JSON', '/Package.json', '/package.json.', '/package.json%20',
      '/package.json::$DATA', '/SERVER/coach-handler.js', '/Server/coach-handler.js', '/SERVER~1/coach-handler.js',
      '/NODE_M~1/openai/index.js', '/PACKAG~1.JSO', '/C:/Windows/win.ini', '/c:%5cwindows%5cwin.ini', '/src/C:/x.js',
      '/src/con', '/src/nul.js', '/src/aux.txt', '/src/con.js', '/%5c%5c.%5cC:%5cx.js', '/%3f%3f/C:/x.js',
      // not origin-form at all
      'http://127.0.0.1/.env.local', `http://127.0.0.1:${port}/.env.local`, 'http://evil.invalid/package.json',
      'file:///etc/passwd', '/file:///etc/passwd', '*',
    ];
    for (const target of targets) {
      const res = await raw(port, target);
      assert.equal(res.status, 404, target);
      assertNoLeak(res, target);
    }
    // Request lines the HTTP parser itself refuses (400) never reach a file either.
    for (const target of ['/.env.local\x00', '/src/app.js\x00.env.local', '/.env local', '/src/..\t/.env.local',
      '.env.local', 'src/app.js', '\\.env.local', '\\src\\app.js', '/src/\xef\xbc\x8e\xef\xbc\x8e/.env.local']) {
      const res = await raw(port, target);
      assert.ok(res.status === 400 || res.status === 404, `${JSON.stringify(target)} -> ${res.status}`);
      assertNoLeak(res, target);
    }
    // /api is not a way around either: the adapter hands the request to the handler and reads no file.
    const viaApi = await raw(port, '/api/../.env.local');
    assert.notEqual(viaApi.status, 0);
    assertNoLeak(viaApi, '/api/../.env.local');
    assert.equal((await raw(port, '/index.html')).status, 200, 'the server still serves after all of that');
  });
});

test('a symbolic link inside an allowed tree is not followed', async (t) => {
  try {
    await symlink(join(tmp, 'outside'), join(project, 'src', 'link'), 'junction');
  } catch {
    t.skip('this file system cannot create a link');
    return;
  }
  try {
    await withServer({}, async (port) => {
      assert.ok((await readFile(join(project, 'src', 'link', 'secret.js'), 'utf8')).includes(MARK), 'the link works on disk');
      const res = await request(port, { path: '/src/link/secret.js' });
      assert.equal(res.status, 404);
      assertNoLeak(res, '/src/link/secret.js');
    });
  } finally {
    await rm(join(project, 'src', 'link'), { recursive: false, force: true }).catch(() => {});
  }
});

test('--dist serves dist/ only: the hashed tree and the built icons, never dev/ or a refused name', async () => {
  await withServer({ dist: true }, async (port) => {
    const ok = async (path, content) => {
      const res = await request(port, { path });
      assert.equal(res.status, 200, path);
      assert.deepEqual(res.body, Buffer.from(content), path);
    };
    await ok('/', FIXTURE['dist/index.html']);
    await ok('/index.html', FIXTURE['dist/index.html']);
    await ok('/a/abc123/src/app.js', FIXTURE['dist/a/abc123/src/app.js']);
    await ok('/a/abc123/styles/tokens.css', FIXTURE['dist/a/abc123/styles/tokens.css']);
    await ok('/favicon.svg', FIXTURE['dist/favicon.svg']);
    await ok('/manifest.webmanifest', FIXTURE['dist/manifest.webmanifest']);
    await ok('/icons/apple-touch-icon.png', FIXTURE['dist/icons/apple-touch-icon.png']);      // the built file, not a generated one
    for (const path of ['/dev/board.html', '/.env', '/server/inner.js', '/package.json', '/src/app.js', '/styles/tokens.css',
      '/icons/icon-192.png', '/../index.html', '/../.env.local', '/../package.json', '/a/abc123/../../.env', '/a/%2e%2e/.env']) {
      const res = await raw(port, path);
      assert.equal(res.status, 404, path);
      assertNoLeak(res, path);
    }
  });
});

test('--api-only serves no static file, no config and no icon', async () => {
  await withServer({ apiOnly: true }, async (port, coach) => {
    for (const path of ['/', '/index.html', '/src/app.js', '/config.json', '/icons/apple-touch-icon.png', '/favicon.svg']) {
      assert.equal((await request(port, { path })).status, 404, path);
    }
    const res = await request(port, { path: '/api/coach', method: 'POST', body: '{}' });
    assert.equal(res.status, 200);
    assert.equal(coach.calls.length, 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// /config.json and the icons
// ---------------------------------------------------------------------------------------------------------------

test('/config.json in mock, live and off mode', async () => {
  const MOCK = '{"apiBase":"/api","build":"dev","coach":{"mode":"mock","reason":null}}';
  const LIVE = '{"apiBase":"/api","build":"dev","coach":{"mode":"live","reason":null}}';
  const OFF = '{"apiBase":null,"build":"dev","coach":{"mode":"off","reason":"no_key"}}';
  const config = async (options) => withServer(options, async (port, coach) => {
    const res = await request(port, { path: '/config.json' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-cache');
    await request(port, { path: '/api/json' });
    return { text: res.body.toString('utf8'), env: coach.calls[0].env };
  });

  // mock: the flag, or COACH_MOCK=1; no key is needed
  const flag = await config({ mock: true, env: {} });
  assert.equal(flag.text, MOCK);
  assert.equal(flag.env.COACH_MOCK, '1', '--mock reaches the handler as COACH_MOCK=1');
  assert.equal((await config({ env: { COACH_MOCK: '1' } })).text, MOCK);
  assert.equal((await config({ mock: true, env: { COACH_API_KEY: 'k-0123456789', COACH_BASE_URL: 'https://gateway.invalid/v1' } })).text, MOCK);

  // live: configured (key and base URL), mock off
  const given = { COACH_API_KEY: 'k-0123456789', COACH_BASE_URL: 'https://gateway.invalid/v1', COACH_MODEL: 'some/model' };
  const live = await config({ env: given });
  assert.equal(live.text, LIVE);
  assert.ok(!live.text.includes('k-0123456789'), 'the key is never served');
  assert.deepEqual(live.env, given, 'the handler receives the env it was given');
  assert.deepEqual(given, { COACH_API_KEY: 'k-0123456789', COACH_BASE_URL: 'https://gateway.invalid/v1', COACH_MODEL: 'some/model' });
  assert.equal((await config({ env: { ...given, COACH_MOCK: '0' } })).text, LIVE);

  // off: nothing configured, or only half of it
  assert.equal((await config({ env: {} })).text, OFF);
  assert.equal((await config({ env: { COACH_API_KEY: 'k-0123456789' } })).text, OFF);
  assert.equal((await config({ env: { COACH_BASE_URL: 'https://gateway.invalid/v1' } })).text, OFF);
  assert.equal((await config({ env: { COACH_MOCK: '0' } })).text, OFF);
});

test('with --dist the built config.json is served unless a coach mode is active', async () => {
  await withServer({ dist: true, env: {} }, async (port) => {
    assert.equal((await request(port, { path: '/config.json' })).body.toString('utf8'), FIXTURE['dist/config.json']);
  });
  await withServer({ dist: true, mock: true }, async (port) => {
    assert.equal((await request(port, { path: '/config.json' })).body.toString('utf8'),
      '{"apiBase":"/api","build":"dev","coach":{"mode":"mock","reason":null}}');
  });
});

test('startServer does not read .env files, and without `env` passes only the COACH_ variables of the process', async () => {
  process.env.COACH_MODEL = 'from-the-process';
  process.env.T1_UNRELATED_SECRET = 'not-for-the-handler';
  const coach = fakeCoach();
  const server = await startServer({ port: 0, handler: coach.handler });
  try {
    await request(server.port, { path: '/api/json' });
    assert.deepEqual(coach.calls[0].env, { COACH_MODEL: 'from-the-process' });      // .env and .env.local of the fixture set COACH_API_KEY
    assert.equal(process.env.COACH_API_KEY, undefined);
    assert.equal((await request(server.port, { path: '/config.json' })).body.toString('utf8'),
      '{"apiBase":null,"build":"dev","coach":{"mode":"off","reason":"no_key"}}');
  } finally {
    coach.stop();
    await server.close();
    delete process.env.COACH_MODEL;
    delete process.env.T1_UNRELATED_SECRET;
  }
});

test('/icons/apple-touch-icon.png is a valid PNG', async () => {
  await withServer({}, async (port) => {
    const dimensions = { 'apple-touch-icon.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 };
    for (const [name, size] of Object.entries(dimensions)) {
      const res = await request(port, { path: `/icons/${name}` });
      assert.equal(res.status, 200, name);
      assert.equal(res.headers['content-type'], 'image/png', name);
      assert.equal(res.headers['x-content-type-options'], 'nosniff', name);
      const png = res.body;
      assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${name}: signature`);
      assert.equal(png.readUInt32BE(8), 13, `${name}: IHDR length`);
      assert.equal(png.toString('latin1', 12, 16), 'IHDR', name);
      assert.equal(png.readUInt32BE(16), size, `${name}: width`);
      assert.equal(png.readUInt32BE(20), size, `${name}: height`);
      assert.deepEqual([...png.subarray(24, 29)], [8, 6, 0, 0, 0], `${name}: 8-bit RGBA, not interlaced`);
      assert.equal(png.toString('latin1', png.length - 8, png.length - 4), 'IEND', name);
      assert.ok(png.equals(makeIcon(size)), `${name} is what make-icons.js draws for ${size}`);
    }
    for (const path of ['/icons/other.png', '/icons/', '/icons/icon-64.png', '/icons/constructor', '/icons/../.env.local']) {
      const res = await raw(port, path);
      assert.equal(res.status, 404, path);
      assertNoLeak(res, path);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// the Node http -> fetch adapter
// ---------------------------------------------------------------------------------------------------------------

test('a streamed /api reply arrives in more than one chunk; request method, headers and body reach the handler', async () => {
  const env = { COACH_API_KEY: 'k-0123456789', COACH_BASE_URL: 'https://gateway.invalid/v1' };
  await withServer({ env }, async (port, coach) => {
    const sent = JSON.stringify({ v: 1, say: '小主公问：这步棋好吗？' });
    const res = await request(port, {
      path: '/api/coach?chunkMs=50',
      method: 'POST',
      headers: {
        Host: '192.168.1.50:5173', Origin: 'http://192.168.1.50:5173', 'Content-Type': 'application/json',
        'X-Test': 'one, two', 'Content-Length': Buffer.byteLength(sent),
      },
      body: sent,
      onChunk: () => { coach.shared.firstChunkSeen = true; },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['x-accel-buffering'], 'no');
    assert.equal(res.body.toString('utf8'), [0, 1, 2].map((n) => `event: delta\ndata: {"n":${n}}\n\n`).join(''));
    assert.ok(res.chunks.length > 1, `the reply arrived in ${res.chunks.length} chunk(s)`);

    assert.equal(coach.calls.length, 1);
    const call = coach.calls[0];
    assert.equal(call.firstSeenBeforeLast, true, 'the first chunk reached the client before the last one was produced');
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/api/coach');
    assert.equal(call.query, '?chunkMs=50');
    assert.equal(call.headers.host, '192.168.1.50:5173');
    assert.equal(call.headers.origin, 'http://192.168.1.50:5173');
    assert.equal(call.headers['content-type'], 'application/json');
    assert.equal(call.headers['x-test'], 'one, two');
    assert.equal(call.body, sent);
    assert.deepEqual(call.env, env);
    assert.equal(call.ctx.loopbackListen, true);
    assert.ok(['127.0.0.1', '::ffff:127.0.0.1'].includes(call.ctx.ip), `ctx.ip is ${call.ctx.ip}`);
    assert.equal(call.aborted, false, 'a reply that ran to its end is not an abort');

    // GET and HEAD carry no body; a reply without a body and a plain JSON reply pass through with status and headers
    const empty = await request(port, { path: '/api/empty' });
    assert.equal(empty.status, 204);
    assert.equal(empty.headers['x-fake'], 'empty');
    const json = await request(port, { path: '/api/json' });
    assert.equal(json.status, 503);
    assert.deepEqual(JSON.parse(json.body.toString('utf8')), { ok: true });
    const options = await request(port, { path: '/api/empty', method: 'OPTIONS' });
    assert.equal(options.status, 204);
    assert.deepEqual(coach.calls.slice(1).map((c) => [c.method, c.path, c.body]),
      [['GET', '/api/empty', ''], ['GET', '/api/json', ''], ['OPTIONS', '/api/empty', '']]);
  });
});

test("a client abort reaches the handler's signal", async () => {
  await withServer({}, async (port, coach) => {
    // mid-stream
    await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/api/endless', method: 'POST', agent: false }, (res) => {
        res.on('error', () => {});
        res.once('data', () => req.destroy());
      });
      req.on('error', () => {});
      req.on('close', resolve);
      req.end('{}');
    });
    await until(() => coach.calls[0]?.aborted, 'the abort of the streamed request');
    assert.ok(coach.calls[0].enqueued >= 1);

    // before the handler has answered anything
    const waiting = http.request({ host: '127.0.0.1', port, path: '/api/wait', method: 'POST', agent: false });
    waiting.on('error', () => {});
    waiting.end('{}');
    await until(() => coach.calls.length === 2, 'the second call');
    assert.equal(coach.calls[1].aborted, false);
    waiting.destroy();
    await until(() => coach.calls[1].aborted, 'the abort of the waiting request');

    // a stream that ignores the signal is cancelled by the adapter
    await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/api/deaf', agent: false }, (res) => {
        res.on('error', () => {});
        res.once('data', () => req.destroy());
      });
      req.on('error', () => {});
      req.on('close', resolve);
      req.end();
    });
    await until(() => coach.calls[2]?.aborted && coach.calls[2].cancelled, 'the cancel of the deaf stream');

    assert.equal((await request(port, { path: '/index.html' })).status, 200);
  });
});

test('a throwing handler gives 500 and the server keeps serving', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  await withServer({}, async (port) => {
    for (let n = 0; n < 3; n++) {
      const res = await request(port, { path: '/api/throw', method: 'POST', body: '{}' });
      assert.equal(res.status, 500);
      assert.equal(res.headers['content-type'], 'application/json');
      assert.deepEqual(JSON.parse(res.body.toString('utf8')), { error: { code: 'internal' } });
      assert.ok(!res.body.toString('utf8').includes('boom'), 'the error text stays on the server');
    }
    assert.equal(logged.mock.callCount(), 3);
    assert.deepEqual(logged.mock.calls[0].arguments, ['[api]', 'Error'], 'the log line names the class of the error, never its message');
    const page = await request(port, { path: '/index.html' });
    assert.equal(page.status, 200);
    assert.equal(page.body.toString('utf8'), FIXTURE['index.html']);

    // a stream that breaks after the headers were sent: the reply just ends, the server lives
    const broken = await request(port, { path: '/api/broken' }).catch((e) => e);
    assert.ok(broken instanceof Error || broken.status === 200);
    assert.equal((await request(port, { path: '/src/app.js' })).status, 200);
  });

  // a handler that throws before it returns a promise, and one that returns no Response
  for (const handler of [() => { throw new Error('thrown synchronously'); }, async () => ({ not: 'a response' }), async () => undefined]) {
    await withServer({ handler }, async (port) => {
      const res = await request(port, { path: '/api/coach', method: 'POST', body: '{}' });
      assert.equal(res.status, 500);
      assert.deepEqual(JSON.parse(res.body.toString('utf8')), { error: { code: 'internal' } });
      assert.equal((await request(port, { path: '/index.html' })).status, 200);
    });
  }
});

test('the [api] log line carries the class name of an error and nothing of its message', async (t) => {
  // What an SDK error looks like when a gateway echoes the request: the bearer token is in the message.
  const TOKEN = 'made-up-bearer-token-0123456789';
  class AuthenticationError extends Error {}
  const thrown = [
    [new AuthenticationError(`401 Incorrect API key provided: Bearer ${TOKEN}`), 'AuthenticationError'],
    [Object.assign(new TypeError(`fetch failed for a request with the header authorization: Bearer ${TOKEN}`), { code: TOKEN }), 'TypeError'],
    [`a thrown string with ${TOKEN}`, 'String'],
    [{ message: `a plain object with ${TOKEN}`, name: TOKEN }, 'Object'],
    [Object.assign(Object.create(null), { message: TOKEN }), 'Error'],                    // no constructor at all
    [Object.assign(new Error(TOKEN), { constructor: { name: `Bearer ${TOKEN}` } }), 'Error'],      // a class "name" that is no identifier
    [null, 'Error'],
  ];
  const logged = t.mock.method(console, 'error', () => {});
  for (const [error, name] of thrown) {
    logged.mock.resetCalls();
    await withServer({ handler: async () => { throw error; } }, async (port) => {
      const res = await request(port, { path: '/api/coach', method: 'POST', body: '{}' });
      assert.equal(res.status, 500);
      assert.ok(!res.body.toString('utf8').includes(TOKEN));
    });
    assert.deepEqual(logged.mock.calls.map((call) => call.arguments), [['[api]', name]]);
  }
});

test('abort 50 streamed requests mid-flight, then GET /index.html still answers 200', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const uncaught = [];
  const note = (e) => uncaught.push(e);
  process.on('uncaughtException', note);
  try {
    await withServer({}, async (port, coach) => {
      await Promise.all(Array.from({ length: 50 }, () => new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port, path: '/api/endless', method: 'POST', agent: false }, (res) => {
          res.on('error', () => {});
          res.once('data', () => req.destroy());          // the stream has started: leave in the middle of it
        });
        req.on('error', () => {});
        req.on('close', resolve);
        req.end('{"v":1}');
      })));
      await until(() => coach.calls.length === 50 && coach.calls.every((c) => c.aborted), 'all 50 aborts to reach the handler', 10000);
      assert.ok(coach.calls.every((c) => c.enqueued >= 1), 'every request was aborted after its stream had started');

      const page = await request(port, { path: '/index.html' });
      assert.equal(page.status, 200);
      assert.equal(page.body.toString('utf8'), FIXTURE['index.html']);
      const again = await request(port, { path: '/api/coach', method: 'POST', body: '{}' });
      assert.equal(again.status, 200, 'and the proxy still streams');
      assert.equal(again.chunks.length > 1, true);
    });
    await sleep(20);
    assert.deepEqual(uncaught, []);
    assert.equal(logged.mock.callCount(), 0, 'an abort is not an error: nothing is logged');
  } finally {
    process.off('uncaughtException', note);
  }
});

test('a body over 64 KB is 413', async (t) => {
  t.mock.method(console, 'error', () => {});
  await withServer({}, async (port, coach) => {
    const limit = 64 * 1024;
    const over = await request(port, { path: '/api/coach', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: Buffer.alloc(limit + 1, 0x61) });
    assert.equal(over.status, 413);
    assert.equal(over.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(over.body.toString('utf8')), { error: { code: 'too_large' } });
    assert.equal(coach.calls.length, 0, 'the handler never sees the request');

    // the same without a Content-Length header (chunked upload)
    const chunked = await request(port, {
      path: '/api/coach', method: 'POST',
      body: (req) => { for (let n = 0; n < 9; n++) req.write(Buffer.alloc(8 * 1024, 0x62)); req.end(); },
    });
    assert.equal(chunked.status, 413);
    assert.deepEqual(JSON.parse(chunked.body.toString('utf8')), { error: { code: 'too_large' } });
    assert.equal(coach.calls.length, 0);

    // exactly 64 KB is allowed
    const exact = await request(port, { path: '/api/json', method: 'POST', body: Buffer.alloc(limit, 0x63) });
    assert.equal(exact.status, 503);
    assert.equal(coach.calls.length, 1);
    assert.equal(coach.calls[0].body.length, limit);

    // A refused upload does not poison a keep-alive connection: the next request on it is still understood.
    const upload = 'a'.repeat(limit + 10);
    const answers = await new Promise((resolve, reject) => {
      const parts = [];
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(`POST /api/coach HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Length: ${upload.length}\r\n\r\n${upload}`);
        socket.write(`GET /index.html HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
      });
      socket.setTimeout(5000, () => socket.destroy());        // only bounds a failing test
      socket.on('data', (part) => parts.push(part));
      socket.on('error', reject);
      socket.on('close', () => resolve(Buffer.concat(parts).toString('latin1')));
    });
    assert.deepEqual([...answers.matchAll(/^HTTP\/1\.1 (\d{3})/gm)].map((m) => m[1]), ['413', '200']);
    assert.ok(answers.endsWith(FIXTURE['index.html']), 'the second answer on the connection is the page');
    assert.equal(coach.calls.length, 1, 'the handler never saw the refused upload');

    assert.equal((await request(port, { path: '/index.html' })).status, 200);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// the Host allowlist of /api/*
// ---------------------------------------------------------------------------------------------------------------

test('/api answers only under a Host that names this machine; a rebinding name is 403 before the handler runs, static files are not affected', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const own = os.hostname();
  const env = { COACH_ALLOWED_HOSTS: ' chess.home.example , Other.Example:8080,203.0.113.7,[2001:db8::7]' };
  await withServer({ env }, async (port, coach) => {
    const api = (host, method = 'GET') => request(port, { path: '/api/empty', method, headers: { Host: host } });

    const allowed = [
      `127.0.0.1:${port}`, '127.0.0.1', '127.8.9.10:5173', `localhost:${port}`, 'localhost', 'LOCALHOST:5173', 'localhost.:5173',
      `[::1]:${port}`, '[::1]', '[0:0:0:0:0:0:0:1]:5173',
      // the iPad on the home network opens the PC's LAN address
      '192.168.1.50:5173', '192.168.0.2', '10.0.0.7:5173', '10.255.255.254', '172.16.0.9:5173', '172.31.255.255', '169.254.10.20:5173',
      '[fd12:3456:789a::1]:5173', '[fc00::1]', '[fe80::1c2d:3e4f:5a6b:7c8d]:5173', '[::ffff:192.168.1.50]:5173',
      // the machine's own name, in any letter case, and its mDNS form
      own, `${own}:${port}`, own.toUpperCase(), `${own.toLowerCase()}:5173`,
      ...(own.includes('.') ? [] : [`${own}.local`, `${own}.local:5173`, `${own.toUpperCase()}.LOCAL`]),
      // COACH_ALLOWED_HOSTS: exact names, a name with its port, an address literal
      'chess.home.example', 'chess.home.example:5173', 'CHESS.Home.Example', 'other.example:8080', '203.0.113.7:5173', '[2001:db8::7]', '[2001:DB8::7]:5173',
    ];
    for (const host of allowed) {
      const before = coach.calls.length;
      const res = await api(host);
      assert.equal(res.status, 204, `${host} is answered`);
      assert.equal(res.headers['x-fake'], 'empty', host);
      assert.equal(coach.calls.length, before + 1, `${host} reaches the handler`);
      assert.equal(coach.calls[before].headers.host, host, 'the Host header is passed on unchanged');
    }
    assert.equal(logged.mock.callCount(), 0, 'nothing is logged for an allowed Host');

    const refused = [
      'evil.example', `evil.example:${port}`, 'attacker.invalid:5173', 'rebind.127.0.0.1.attacker.invalid',
      // names that only look like this machine
      'localhost.evil.example', '127.0.0.1.evil.example', '192.168.1.50.nip.io', 'xlocalhost', 'localhost.localdomain',
      `${own}.evil.example`, `x${own}`, `${own}.local.evil.example`, 'chess.home.example.evil.example', 'xchess.home.example',
      // a listed name with another port than the one it was listed with, an address next to a listed one
      'other.example', 'other.example:9090', '203.0.113.8', '[2001:db8::8]',
      // public address literals
      '8.8.8.8', '8.8.8.8:5173', '11.0.0.1', '172.15.255.255', '172.32.0.1', '192.167.1.1', '192.169.1.1', '169.253.1.1', '169.255.0.1', '126.0.0.1', '128.0.0.1',
      '[2001:db8::1]', '[2001:db8::1]:5173', '[fec0::1]', '[::ffff:8.8.8.8]', '[::2]',
      // not a host at all
      '127.0.0.1:999999', 'evil.example:80@127.0.0.1', '127.0.0.1@evil.example', 'http://127.0.0.1', '127.0.0.1/evil', '[::1', '::1', '127.0.0.1 evil.example', 'a,b',
    ];
    for (const method of ['GET', 'POST', 'OPTIONS']) {
      for (const host of refused) {
        const before = coach.calls.length;
        const res = await api(host, method);
        assert.equal(res.status, 403, `${method} with Host ${host}`);
        assert.equal(res.headers['content-type'], 'application/json', host);
        assert.deepEqual(JSON.parse(res.body.toString('utf8')), { error: { code: 'origin' } }, host);
        assert.equal(coach.calls.length, before, `${host} never reaches the handler`);
      }
    }
    // a streamed coach POST as a rebinding page would send it: Origin and Host agree, and both carry the attacker's name
    const before = coach.calls.length;
    const rebound = await request(port, {
      path: '/api/coach', method: 'POST', body: '{"v":1}',
      headers: { Host: `evil.example:${port}`, Origin: `http://evil.example:${port}`, 'Content-Type': 'application/json' },
    });
    assert.equal(rebound.status, 403);
    assert.equal(coach.calls.length, before);

    // an empty Host header, and none at all (HTTP/1.0)
    const bare = (head) => new Promise((resolve, reject) => {
      const parts = [];
      const socket = net.connect(port, '127.0.0.1', () => socket.write(head, 'latin1'));
      socket.setTimeout(5000, () => socket.destroy());        // only bounds a failing test
      socket.on('data', (part) => parts.push(part));
      socket.on('error', reject);
      socket.on('close', () => resolve(Buffer.concat(parts).toString('latin1')));
    });
    assert.match(await bare('GET /api/empty HTTP/1.1\r\nHost:\r\nConnection: close\r\n\r\n'), /^HTTP\/1\.1 403 /);
    assert.match(await bare('GET /api/empty HTTP/1.0\r\n\r\n'), /^HTTP\/1\.1 403 /);
    assert.match(await bare('GET /index.html HTTP/1.0\r\n\r\n'), /^HTTP\/1\.1 200 /);
    assert.equal(coach.calls.length, before);

    // the page itself is served under any name: only the coach is restricted
    for (const path of ['/index.html', '/src/app.js', '/config.json', '/icons/icon-192.png']) {
      assert.equal((await request(port, { path, headers: { Host: 'evil.example' } })).status, 200, path);
    }
    assert.equal((await request(port, { path: '/.env.local', headers: { Host: 'evil.example' } })).status, 404);

    // refused names are logged so that the owner can find out why the coach is off: one line each, the first three only
    assert.equal(logged.mock.callCount(), 3);
    const lines = logged.mock.calls.map((call) => call.arguments.join(' '));
    assert.match(lines[0], /^\[api\] 403: .*"evil\.example".*COACH_ALLOWED_HOSTS/);
    assert.equal(new Set(lines).size, 3);
  });

  // without COACH_ALLOWED_HOSTS the listed names are strangers too, and the handler of an `off` server is as unreachable as any
  await withServer({ env: {} }, async (port, coach) => {
    for (const host of ['chess.home.example', 'other.example:8080', '203.0.113.7', '[2001:db8::7]']) {
      assert.equal((await request(port, { path: '/api/empty', headers: { Host: host } })).status, 403, host);
    }
    assert.equal(coach.calls.length, 0);
    assert.equal((await request(port, { path: '/api/empty', headers: { Host: '192.168.1.50:5173' } })).status, 204);
    // every LAN address the banner would print is answered (when the network is a private one, as at home)
    for (const list of Object.values(os.networkInterfaces())) {
      for (const info of list ?? []) {
        if (info.family !== 'IPv4' || info.internal) continue;
        const isHome = /^(?:10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(info.address);
        assert.equal((await request(port, { path: '/api/empty', headers: { Host: `${info.address}:${port}` } })).status, isHome ? 204 : 403, info.address);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// the command line: .env files, the default handler, the banner
// ---------------------------------------------------------------------------------------------------------------

const ECHO_HANDLER = `
export function isConfigured(env) { return Boolean(env.COACH_API_KEY && env.COACH_BASE_URL); }
export async function handleRequest(request, env, ctx) {
  return new Response(JSON.stringify({ env, ctx }), { headers: { 'content-type': 'application/json' } });
}
`;
const STUB_HANDLER = `
export function isConfigured(env) { throw new Error('not implemented'); }
export async function handleRequest(request, env, ctx) { throw new Error('not implemented'); }
`;
const FORCE_LOOPBACK = `
import net from 'node:net';
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (port, host, ...rest) {
  return listen.call(this, port, typeof host === 'string' ? '127.0.0.1' : host, ...rest);
};
`;
const FAKE_KEY = 'fake-key-0123456789-never-printed';

/** A copy of the two scripts next to a fake server/coach-handler.js (null: no handler file at all). */
async function cliProject(name, handlerSource, files = {}) {
  const dir = join(tmp, name);
  await writeTree(dir, {
    'package.json': '{"type":"module"}\n',
    'index.html': '<!doctype html><title>cli fixture</title>\n',
    'force-loopback.mjs': FORCE_LOOPBACK,
    ...(handlerSource === null ? {} : { 'server/coach-handler.js': handlerSource }),
    ...files,
  });
  await mkdir(join(dir, 'scripts'), { recursive: true });
  for (const script of ['serve.js', 'make-icons.js']) await copyFile(join(SCRIPTS, script), join(dir, 'scripts', script));
  return dir;
}

/** Runs `node [nodeArgs] scripts/serve.js --port 0 [args]` in `dir` and waits for the banner. */
async function runCli(dir, args = [], { env = {}, nodeArgs = [] } = {}) {
  const base = {};
  for (const [name, value] of Object.entries(process.env)) if (!name.startsWith('COACH_')) base[name] = value;
  const child = spawn(process.execPath, [...nodeArgs, join('scripts', 'serve.js'), '--port', '0', ...args], {
    cwd: dir, env: { ...base, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const out = { stdout: '', stderr: '', code: null };
  child.stdout.setEncoding('utf8').on('data', (text) => { out.stdout += text; });
  child.stderr.setEncoding('utf8').on('data', (text) => { out.stderr += text; });
  const exited = new Promise((resolve) => child.on('close', (code) => { out.code = code; resolve(code); }));
  const port = () => Number(/本机地址：http:\/\/[^\s:]+:(\d+)/.exec(out.stdout)?.[1] ?? 0);
  await until(() => port() > 0 || out.code !== null, 'the server banner', 15000);
  // the banner is printed in one piece; give the pipe a moment to deliver all of it
  if (out.code === null) await until(() => /iPad/.test(out.stdout), 'the end of the banner', 5000);
  return { port: port(), out, exited, stop: async () => { child.kill(); await exited; } };
}

const getJson = async (port, path) => JSON.parse((await request(port, { path })).body.toString('utf8'));

test('the CLI loads .env and .env.local (.env.local wins, the real environment wins over both) and hands only COACH_ variables to the handler', async () => {
  const dir = await cliProject('cli-env', ECHO_HANDLER, {
    '.env': 'COACH_MODEL=from-env\nCOACH_BASE_URL=https://gateway.invalid/v1\nCOACH_RATE_BURST=7\nT1_UNRELATED_SECRET=not-for-the-handler\n',
    '.env.local': `COACH_MODEL=from-env-local\nCOACH_API_KEY=${FAKE_KEY}\n`,
  });
  const cli = await runCli(dir, [], { env: { COACH_RATE_BURST: '99' } });
  try {
    const { env, ctx } = await getJson(cli.port, '/api/echo');
    assert.deepEqual(env, {
      COACH_MODEL: 'from-env-local',                       // both files set it: .env.local wins
      COACH_BASE_URL: 'https://gateway.invalid/v1',        // only .env sets it
      COACH_API_KEY: FAKE_KEY,                             // only .env.local sets it
      COACH_RATE_BURST: '99',                              // the shell set it: neither file replaces it
    });
    assert.equal(ctx.loopbackListen, true);
    assert.ok(['127.0.0.1', '::ffff:127.0.0.1'].includes(ctx.ip));
    assert.deepEqual(await getJson(cli.port, '/config.json'), { apiBase: '/api', build: 'dev', coach: { mode: 'live', reason: null } });
    for (const path of ['/.env.local', '/.env', '/package.json', '/server/coach-handler.js', '/scripts/serve.js']) {
      const res = await request(cli.port, { path });
      assert.equal(res.status, 404, path);
      assert.ok(!res.body.toString('utf8').includes(FAKE_KEY), path);
    }
    assert.equal((await request(cli.port, { path: '/index.html' })).status, 200);
  } finally {
    await cli.stop();
  }
  assert.match(cli.out.stdout, /军师模式：live/);
  assert.match(cli.out.stdout, new RegExp(`本机地址：http://127\\.0\\.0\\.1:${cli.port}\\b`));
  assert.ok(!cli.out.stdout.includes('局域网地址'), 'a loopback server lists no LAN address');
  for (const value of [FAKE_KEY, 'gateway.invalid', 'from-env-local', 'not-for-the-handler']) {
    assert.ok(!(cli.out.stdout + cli.out.stderr).includes(value), `the value ${value} is never logged`);
  }
});

test('the CLI reads a .env.local that starts with a byte order mark, and says so when the file is UTF-16 (CONTRACT-NOTES 150)', async () => {
  // "UTF-8 with BOM" and a variable on the first line: process.loadEnvFile kept the mark as part of the name, the
  // variable never reached the handler and the banner said off
  const marked = await cliProject('cli-env-bom', ECHO_HANDLER, {
    '.env.local': `\uFEFFCOACH_BASE_URL=https://gateway.invalid/v1\r\nCOACH_API_KEY=${FAKE_KEY}\r\n`,
    '.env': 'COACH_BASE_URL=https://other.invalid/v1\nCOACH_MODEL=from-env\n',
  });
  const cli = await runCli(marked, [], { env: { COACH_MODEL: 'from-the-shell' } });
  try {
    assert.deepEqual((await getJson(cli.port, '/api/echo')).env, {
      COACH_BASE_URL: 'https://gateway.invalid/v1',        // .env.local wins over .env, with or without the mark
      COACH_API_KEY: FAKE_KEY,
      COACH_MODEL: 'from-the-shell',                       // the real environment wins over both files
    });
    assert.equal((await getJson(cli.port, '/config.json')).coach.mode, 'live');
  } finally {
    await cli.stop();
  }
  assert.match(cli.out.stdout, /军师模式：live/);
  assert.ok(!cli.out.stderr.includes('[env]'), cli.out.stderr);

  // UTF-16 LE (Windows PowerShell 5.1 writes it with `>`): the file cannot be used, and one line says why
  const wide = await cliProject('cli-env-utf16', ECHO_HANDLER, {
    '.env.local': Buffer.from(`\uFEFFCOACH_BASE_URL=https://gateway.invalid/v1\r\nCOACH_API_KEY=${FAKE_KEY}\r\n`, 'utf16le'),
  });
  const off = await runCli(wide);
  try {
    assert.deepEqual((await getJson(off.port, '/api/echo')).env, {});
  } finally {
    await off.stop();
  }
  assert.match(off.out.stderr, /\[env\] \.env\.local is not UTF-8 text/);
  assert.match(off.out.stdout, /军师模式：off/);
  assert.ok(!(off.out.stdout + off.out.stderr).includes(FAKE_KEY));
});

test('the CLI: --mock sets COACH_MOCK=1 for the handler; without key or mock the mode is off (no_key) and the handler still answers', async () => {
  const dir = await cliProject('cli-mock', ECHO_HANDLER);
  const mock = await runCli(dir, ['--mock']);
  try {
    assert.deepEqual((await getJson(mock.port, '/api/echo')).env, { COACH_MOCK: '1' });
    assert.deepEqual(await getJson(mock.port, '/config.json'), { apiBase: '/api', build: 'dev', coach: { mode: 'mock', reason: null } });
  } finally {
    await mock.stop();
  }
  assert.match(mock.out.stdout, /军师模式：mock/);

  const off = await runCli(dir);
  try {
    assert.deepEqual(await getJson(off.port, '/config.json'), { apiBase: null, build: 'dev', coach: { mode: 'off', reason: 'no_key' } });
    assert.deepEqual((await getJson(off.port, '/api/health')).env, {});
  } finally {
    await off.stop();
  }
  assert.match(off.out.stdout, /军师模式：off/);
});

test('the CLI keeps serving the page when the handler cannot be loaded or isConfigured throws: /api is 404 no_proxy', async () => {
  const cases = [
    ['cli-broken', "throw new Error('this module cannot be loaded');\n"],
    ['cli-missing', null],
    ['cli-stub', STUB_HANDLER],
  ];
  for (const [name, source] of cases) {
    const cli = await runCli(await cliProject(name, source));
    try {
      assert.equal((await request(cli.port, { path: '/index.html' })).status, 200, name);
      assert.deepEqual(await getJson(cli.port, '/config.json'), { apiBase: null, build: 'dev', coach: { mode: 'off', reason: 'no_proxy' } }, name);
      for (const [path, method] of [['/api/health', 'GET'], ['/api/coach', 'POST']]) {
        const res = await request(cli.port, { path, method, body: method === 'POST' ? '{}' : undefined });
        assert.equal(res.status, 404, `${name} ${path}`);
        assert.deepEqual(JSON.parse(res.body.toString('utf8')), { error: { code: 'no_proxy' } }, `${name} ${path}`);
      }
    } finally {
      await cli.stop();
    }
    assert.equal(cli.out.stderr.trim().split('\n').length, 1, `${name}: exactly one line is logged: ${cli.out.stderr}`);
    assert.match(cli.out.stderr, /^\[coach\]/, name);
    assert.match(cli.out.stdout, /军师模式：off/, name);
  }

  // The stub with --mock: the mode does not ask isConfigured, a request fails inside the adapter, the page is served.
  const cli = await runCli(await cliProject('cli-stub-mock', STUB_HANDLER), ['--mock']);
  try {
    assert.deepEqual(await getJson(cli.port, '/config.json'), { apiBase: '/api', build: 'dev', coach: { mode: 'mock', reason: null } });
    const res = await request(cli.port, { path: '/api/health' });
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(res.body.toString('utf8')), { error: { code: 'internal' } });
    assert.equal((await request(cli.port, { path: '/index.html' })).status, 200);
  } finally {
    await cli.stop();
  }
});

test('the CLI logs an error of the handler and a rejection nobody handled by their class name only, and keeps serving', async () => {
  // What an SDK error looks like when a gateway echoes the request: its message carries the bearer token.
  const leaky = `
class GatewayAuthError extends Error {}
export function isConfigured() { return true; }
export async function handleRequest(request) {
  const error = new GatewayAuthError('401 Incorrect API key provided: Bearer ' + process.env.COACH_API_KEY);
  const path = new URL(request.url).pathname;
  if (path.endsWith('/reject')) { Promise.reject(error); return new Response('answered'); }
  if (path.endsWith('/throw')) throw error;
  return new Response('ok');
}
`;
  const cli = await runCli(await cliProject('cli-leaky', leaky), [], { env: { COACH_API_KEY: FAKE_KEY, COACH_BASE_URL: 'https://gateway.invalid/v1' } });
  try {
    assert.equal((await request(cli.port, { path: '/api/reject' })).body.toString('utf8'), 'answered');
    await until(() => cli.out.stderr.includes('[unhandledRejection]'), 'the line of the rejection');
    const thrown = await request(cli.port, { path: '/api/throw' });
    assert.equal(thrown.status, 500);
    assert.ok(!thrown.body.toString('utf8').includes(FAKE_KEY));
    await until(() => cli.out.stderr.includes('[api]'), 'the line of the error');
    assert.equal((await request(cli.port, { path: '/index.html' })).status, 200, 'the server lives on');
    assert.equal((await request(cli.port, { path: '/api/fine' })).body.toString('utf8'), 'ok');
  } finally {
    await cli.stop();
  }
  assert.deepEqual(cli.out.stderr.trim().split(/\r?\n/), ['[unhandledRejection] GatewayAuthError', '[api] GatewayAuthError']);
  assert.ok(!(cli.out.stdout + cli.out.stderr).includes(FAKE_KEY), 'the token is in no log line');
});

test('the banner of a server that is not on loopback lists every LAN URL, the coach mode and the iPad advice', async () => {
  // The host is 0.0.0.0 as far as serve.js knows; the preloaded module makes the socket itself bind to loopback,
  // so the test opens no port to the network.
  const dir = await cliProject('cli-lan', ECHO_HANDLER);
  const cli = await runCli(dir, ['--host', '0.0.0.0', '--mock'], { nodeArgs: ['--import', './force-loopback.mjs'] });
  try {
    assert.equal((await getJson(cli.port, '/api/echo')).ctx.loopbackListen, false);
  } finally {
    await cli.stop();
  }
  const text = cli.out.stdout;
  assert.ok(text.includes(`本机地址：http://127.0.0.1:${cli.port}`), text);
  assert.ok(text.includes(`http://${os.hostname()}:${cli.port}`), text);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) assert.ok(text.includes(`http://${info.address}:${cli.port}`), `${info.address} in ${text}`);
      if (info.internal && info.family === 'IPv4') assert.ok(!text.includes(`局域网地址：http://${info.address}:`), 'an internal address is not a LAN URL');
    }
  }
  assert.match(text, /军师模式：mock/);
  assert.ok(text.includes('在 iPad 上用同一个地址打开，并“添加到主屏幕”'), text);
});

test('the CLI refuses an unknown option, and reports a port that is taken', async () => {
  const dir = await cliProject('cli-args', ECHO_HANDLER);
  const bad = await runCli(dir, ['--serve-everything']);
  assert.equal(await bad.exited, 2);
  assert.match(bad.out.stderr, /unknown option --serve-everything/);
  assert.match(bad.out.stderr, /--port 5173/);

  const first = await runCli(dir, ['--mock']);
  try {
    const second = await runCli(dir, ['--port', String(first.port)]);
    assert.equal(await second.exited, 1);
    assert.match(second.out.stderr, /已被占用/);
    assert.equal((await request(first.port, { path: '/index.html' })).status, 200, 'the first server is unharmed');
  } finally {
    await first.stop();
  }
});
