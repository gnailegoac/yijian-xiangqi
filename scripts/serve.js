// scripts/serve.js (T1) — the dev and home server (contract section 4.30.1).
//
//   node scripts/serve.js [--port 5173] [--host 127.0.0.1] [--dist] [--mock] [--api-only]
//
// It answers, in this order: /api/* (the coach proxy, through a Node http -> fetch adapter), GET /config.json
// (generated), GET /icons/<name>.png (generated in memory) and static files from an ALLOWLIST. This process holds
// the gateway key in memory and is opened from an iPad over the home network, so everything that is not on the
// allowlist is 404: any dot-segment (.env.local, .git), server/, scripts/, tests/, node_modules/, legacy/,
// package.json, package-lock.json, every path-traversal form and every extension outside the list below.
// The root is the current directory (dist/ under it with --dist), as `npm start` and the launcher set it.
// /api/* is answered only when the Host header names this machine (a loopback, private or link-local address
// literal, `localhost`, the machine's host name, or a name of COACH_ALLOWED_HOSTS); anything else is 403 before
// the handler runs, so a page reached through DNS rebinding cannot use the coach.
import { once } from 'node:events';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { makeIcon } from './make-icons.js';

/** @import { IncomingMessage, IncomingHttpHeaders, ServerResponse } from 'node:http' */
/** @import { AddressInfo } from 'node:net' */
/** @import { handleRequest } from '../server/coach-handler.js' */

const DEFAULT_PORT = 5173;
const DEFAULT_HOST = '127.0.0.1';
const BODY_LIMIT = 64 * 1024;

const USAGE = 'node scripts/serve.js [--port 5173] [--host 127.0.0.1] [--dist] [--mock] [--api-only]';
const ADVICE = '在 iPad 上用同一个地址打开，并“添加到主屏幕”';

/** The only extensions that are ever served, with their content types. */
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

/** Without --dist: the files of the repo root and the trees under it that may be served. Nothing else is. */
const ROOT_FILES = new Set(['index.html', 'favicon.svg', 'manifest.webmanifest']);
const ROOT_TREES = new Set(['src', 'styles', 'dev']);

/** Names that are 404 wherever they appear in a path, with or without --dist. */
const DENIED = new Set(['server', 'scripts', 'tests', 'node_modules', 'legacy', 'package.json', 'package-lock.json']);

/**
 * A path segment that may be served: ASCII letters, digits, `_`, `-`, `.`; it neither starts nor ends with a dot.
 * This alone rejects `.`, `..`, dot-files, empty segments, `%`, `:`, `\`, spaces, NUL and every non-ASCII look-alike.
 */
const SEGMENT = /^[A-Za-z0-9_-](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/;

/** GET /icons/<name>.png without --dist: name -> edge length. */
const ICON_SIZES = new Map([['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]);

const BASE_HEADERS = { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };

/** Set by the CLI only: servers started by tests print no banner. */
let announce = false;
let processGuarded = false;

// ---------------------------------------------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------------------------------------------

/**
 * The decoded segments of a request path when every one of them may be served, else null.
 * The path is the raw request target up to `?` or `#`; it is never normalised, so a traversal form is refused
 * instead of being resolved.
 * @param {string} path
 * @param {boolean} dist
 * @returns {string[]|null}
 */
function allowedSegments(path, dist) {
  if (path === '/') return ['index.html'];
  if (!path.startsWith('/')) return null;                       // absolute-form targets, `*`
  /** @type {string[]} */
  const segments = [];
  for (const raw of path.slice(1).split('/')) {
    let name;
    try { name = decodeURIComponent(raw); } catch { return null; }
    if (!SEGMENT.test(name) || DENIED.has(name.toLowerCase())) return null;
    segments.push(name);
  }
  if (!MIME.has(extname(segments[segments.length - 1]))) return null;
  if (dist) return segments[0] === 'dev' ? null : segments;     // dist/: whatever the build put there, never dev/
  if (segments.length === 1) return ROOT_FILES.has(segments[0]) ? segments : null;
  return ROOT_TREES.has(segments[0]) ? segments : null;
}

/**
 * The file a request path stands for, or null. Each segment must be the exact name of a directory entry of the
 * right kind, found by listing the directory: nothing is opened that a listing does not show, so device names,
 * short names, other letter case, alternate data streams and symbolic links are all "not found".
 * @param {string} root
 * @param {string} path
 * @param {boolean} dist
 * @returns {Promise<string|null>}
 */
async function locate(root, path, dist) {
  const segments = allowedSegments(path, dist);
  if (!segments) return null;
  let at = root;
  for (let i = 0; i < segments.length; i++) {
    let entries;
    try { entries = await readdir(at, { withFileTypes: true }); } catch { return null; }
    const entry = entries.find((e) => e.name === segments[i]);
    if (!entry) return null;
    if (i === segments.length - 1 ? !entry.isFile() : !entry.isDirectory()) return null;
    at = join(at, entry.name);
  }
  return at;
}

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {number} status
 * @param {string} type
 * @param {string|Uint8Array} body
 * @param {Record<string, string>} [extra]
 */
function send(req, res, status, type, body, extra) {
  const data = typeof body === 'string' ? Buffer.from(body) : body;
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': data.length, ...extra });
  res.end(req.method === 'HEAD' ? undefined : data);
}

/** @param {IncomingMessage} req @param {ServerResponse} res */
function notFound(req, res) {
  send(req, res, 404, 'text/plain; charset=utf-8', 'Not found');
}

// ---------------------------------------------------------------------------------------------------------------
// The coach: environment, handler, mode
// ---------------------------------------------------------------------------------------------------------------

/**
 * What the handler receives as `env`: every entry whose name starts with COACH_.
 * @param {Record<string, string|undefined>} source
 * @returns {Record<string, string|undefined>}
 */
function coachEnv(source) {
  /** @type {Record<string, string|undefined>} */
  const env = {};
  for (const [name, value] of Object.entries(source)) if (name.startsWith('COACH_')) env[name] = value;
  return env;
}

/**
 * Loads `.env` and `.env.local` of the current directory into process.env. `.env.local` wins over `.env`, and a
 * variable that is already set in the real environment wins over both: a variable that exists is never replaced, so
 * the file that must win is read first. Values are never logged.
 * The files are read as scripts/build.js reads them, not with `process.loadEnvFile` (CONTRACT-NOTES 150): that one keeps
 * a byte order mark as part of the first name, so a file saved as "UTF-8 with BOM" lost its first variable without a
 * word and the strategist stayed off. A file that is not UTF-8 text at all (UTF-16, which Windows PowerShell 5.1 writes
 * with `>`) is not used, and one line says so.
 */
function loadEnvFiles() {
  for (const name of ['.env.local', '.env']) {
    try {
      const text = readFileSync(name, 'utf8');
      if (text.includes('\0')) {
        console.error(`[env] ${name} is not UTF-8 text (it looks like UTF-16): save it as UTF-8. It was not used.`);
        continue;
      }
      for (const [key, value] of Object.entries(parseEnv(text.replace(/^\uFEFF/, '')))) {
        if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
      }
    } catch (e) {
      const code = /** @type {{code?: unknown}|null|undefined} */ (e)?.code;
      if (code !== 'ENOENT') console.error(`[env] ${name} could not be read (${String(code ?? 'error')})`);
    }
  }
}

/**
 * The handler and the coach mode: `mock` when COACH_MOCK is 1 (`--mock` sets it), else `live` when configured,
 * else `off`. The handler module is imported once; when the import or `isConfigured` fails, one line is logged,
 * the mode is `off` and the page is served without a proxy.
 * @param {typeof handleRequest|undefined} injected
 * @param {Record<string, string|undefined>} env
 * @returns {Promise<{handle: typeof handleRequest|null, mode: 'live'|'mock'|'off', reason: 'no_key'|'no_proxy'|null}>}
 */
async function loadCoach(injected, env) {
  const mock = env.COACH_MOCK === '1';
  if (injected) {
    // A handler passed by the caller: server/coach-handler.js is not loaded at all, so its isConfigured() is not
    // available; "configured" is read from env by the rule that function documents (key and base URL present).
    const mode = mock ? 'mock' : (env.COACH_API_KEY && env.COACH_BASE_URL) ? 'live' : 'off';
    return { handle: injected, mode, reason: mode === 'off' ? 'no_key' : null };
  }
  try {
    const coach = await import('../server/coach-handler.js');
    if (typeof coach.handleRequest !== 'function') throw new Error('server/coach-handler.js exports no handleRequest');
    const mode = mock ? 'mock' : coach.isConfigured(env) ? 'live' : 'off';
    return { handle: coach.handleRequest, mode, reason: mode === 'off' ? 'no_key' : null };
  } catch (e) {
    const message = /** @type {{message?: unknown}|null|undefined} */ (e)?.message;
    console.error(`[coach] the proxy is not available, the page is served without it: ${String(message)}`);
    return { handle: null, mode: 'off', reason: 'no_proxy' };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The Host allowlist of /api/*
// ---------------------------------------------------------------------------------------------------------------

/** Address literals that can only be this machine as the home network sees it: loopback, private, link-local. */
const HOME_NETWORKS = new BlockList();
HOME_NETWORKS.addSubnet('127.0.0.0', 8, 'ipv4');
HOME_NETWORKS.addSubnet('10.0.0.0', 8, 'ipv4');
HOME_NETWORKS.addSubnet('172.16.0.0', 12, 'ipv4');
HOME_NETWORKS.addSubnet('192.168.0.0', 16, 'ipv4');
HOME_NETWORKS.addSubnet('169.254.0.0', 16, 'ipv4');
HOME_NETWORKS.addAddress('::1', 'ipv6');
HOME_NETWORKS.addSubnet('fc00::', 7, 'ipv6');
HOME_NETWORKS.addSubnet('fe80::', 10, 'ipv6');

/** A Host header: a bracketed IPv6 literal (1), or a name or an IPv4 literal (2), then an optional port. */
const HOST_HEADER = /^(?:\[([0-9A-Fa-f:.]+)\]|([A-Za-z0-9._-]+))(?::\d{1,5})?$/;
/** A page that tries many names must not flood the log: this many refused Host values are logged per server run. */
const REFUSED_HOSTS_LOGGED = 3;

/**
 * The names (lower case) under which /api/* answers besides address literals: `localhost`, this machine's host name
 * (also in its mDNS form `<name>.local`, which is how an iPad finds a Windows PC by name) and the entries of
 * COACH_ALLOWED_HOSTS (comma separated; a name, or a name with its port).
 * @param {string|undefined} extra the value of COACH_ALLOWED_HOSTS
 * @returns {Set<string>}
 */
function allowedHostNames(extra) {
  const names = new Set(['localhost']);
  const own = hostname().toLowerCase();
  if (own) {
    names.add(own);
    if (!own.includes('.')) names.add(`${own}.local`);
  }
  for (const entry of (extra ?? '').split(',')) {
    const name = entry.trim().toLowerCase();
    if (name) names.add(name);
  }
  return names;
}

/**
 * True when the Host header of a request names this machine. A page reached through DNS rebinding passes the
 * same-origin rule of the handler, because its Origin and its Host both carry the attacker's name; that name is
 * not on this list, so the request never reaches the handler. Allowed: a loopback, private or link-local address
 * literal (an iPad on the home network uses the PC's LAN address) and the names of `allowedHostNames`, compared
 * exactly and without regard to letter case; a listed entry may also be the whole header value (`name:port`).
 * @param {string|undefined} header
 * @param {Set<string>} names
 * @returns {boolean}
 */
function hostAllowed(header, names) {
  const match = HOST_HEADER.exec(header ?? '');
  if (!match) return false;
  const whole = match[0].toLowerCase();
  if (match[1] !== undefined) {
    if (isIP(match[1]) === 6 && HOME_NETWORKS.check(match[1], 'ipv6')) return true;
    return names.has(`[${match[1].toLowerCase()}]`) || names.has(whole);
  }
  const name = match[2].toLowerCase().replace(/\.$/, '');
  if (isIP(name) === 4 && HOME_NETWORKS.check(name, 'ipv4')) return true;
  return names.has(name) || names.has(whole);
}

// ---------------------------------------------------------------------------------------------------------------
// Node http -> fetch adapter
// ---------------------------------------------------------------------------------------------------------------

/**
 * What a log line says about an error: the name of its class, never its message. The message of an SDK error can
 * carry the bearer token when a gateway echoes the request back.
 * @param {unknown} e
 * @returns {string}
 */
function errorName(e) {
  const name = /** @type {{constructor?: {name?: unknown}}|null|undefined} */ (e)?.constructor?.name;
  return typeof name === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(name) ? name : 'Error';
}

/**
 * @param {IncomingHttpHeaders} headers
 * @returns {[string, string][]}
 */
function flat(headers) {
  /** @type {[string, string][]} */
  const pairs = [];
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) pairs.push([name, Array.isArray(value) ? value.join(', ') : value]);
  }
  return pairs;
}

/**
 * The request body, at most `limit` bytes. Rejects with `code: 413` as soon as the body is known to be larger;
 * the rest of the upload is then read and thrown away so the client can still receive the answer.
 * @param {IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Buffer<ArrayBuffer>>}
 */
function readBody(req, limit) {
  return new Promise((done, fail) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    const detach = () => {
      req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('close', onClose);
    };
    const tooLarge = () => {
      detach();
      req.resume();
      fail(Object.assign(new Error('the request body is over the limit'), { code: 413 }));
    };
    /** @param {Buffer} part */
    const onData = (part) => {
      size += part.length;
      if (size > limit) tooLarge(); else chunks.push(part);
    };
    const onEnd = () => { detach(); done(Buffer.concat(chunks, size)); };
    /** @param {Error} e */
    const onError = (e) => { detach(); fail(e); };
    const onClose = () => { detach(); fail(new Error('the request was closed before its body ended')); };
    if (Number(req.headers['content-length']) > limit) { tooLarge(); return; }
    req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('close', onClose);
  });
}

/**
 * Hands one /api request to the fetch-style handler and streams its answer back. The whole request is inside
 * try / catch, and a client that goes away aborts the handler's signal: this is what makes "undo cancels LLM
 * work" true end to end (D-24).
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {typeof handleRequest} handle
 * @param {Record<string, string|undefined>} env
 * @param {{ip?: string, loopbackListen?: boolean}} ctx
 */
async function serveApi(req, res, handle, env, ctx) {
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const body = (req.method === 'GET' || req.method === 'HEAD') ? undefined : await readBody(req, BODY_LIMIT);
    const request = new Request(url, { method: req.method, headers: new Headers(flat(req.headers)), body, signal: ac.signal });
    const response = await handle(request, env, ctx);
    if (ac.signal.aborted) {                                    // the client left while the handler was working
      if (response.body) response.body.cancel().catch(() => {});
      return;
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) { res.end(); return; }
    res.flushHeaders();
    const reader = response.body.getReader();
    // A handler whose stream ignores the signal must not keep a read pending for ever.
    ac.signal.addEventListener('abort', () => { reader.cancel().catch(() => {}); }, { once: true });
    for (;;) {
      const { done, value } = await reader.read();
      if (done || ac.signal.aborted) break;
      if (!res.write(value)) await once(res, 'drain', { signal: ac.signal });
    }
    res.end();
  } catch (e) {
    const err = /** @type {{code?: unknown}|null|undefined} */ (e);
    if (!ac.signal.aborted) console.error('[api]', errorName(e));
    if (res.headersSent) { res.end(); return; }
    const status = err?.code === 413 ? 413 : 500;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: status === 413 ? 'too_large' : 'internal' } }));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------------------------------------------

/** @param {string} host */
function isLoopbackHost(host) {
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** The IPv4 addresses of this machine that other devices on the network can reach. */
function lanAddresses() {
  /** @type {string[]} */
  const addresses = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) if (info.family === 'IPv4' && !info.internal) addresses.push(info.address);
  }
  return addresses;
}

/**
 * The lines printed at start: the local URL, every LAN URL when the host is not loopback, the coach mode and
 * the advice for the iPad. No value of any variable is printed.
 * @param {{host: string, port: number, dist: boolean, apiOnly: boolean, root: string,
 *          mode: 'live'|'mock'|'off', reason: 'no_key'|'no_proxy'|null}} s
 * @returns {string[]}
 */
function bannerLines(s) {
  /** @param {string} name */
  const url = (name) => `http://${name.includes(':') ? `[${name}]` : name}:${s.port}`;
  const everyInterface = s.host === '0.0.0.0' || s.host === '::';
  const loopback = isLoopbackHost(s.host);
  const lines = ['弈间已启动'];
  lines.push(`  本机地址：${url(everyInterface ? '127.0.0.1' : s.host)}`);
  if (!loopback) {
    const names = everyInterface ? [...lanAddresses(), hostname()] : [hostname()];
    for (const name of names) lines.push(`  局域网地址：${url(name)}`);
  }
  const note = s.mode === 'live' ? 'live（大模型军师已接通）'
    : s.mode === 'mock' ? 'mock（模拟回复，不访问大模型，测试用）'
    : s.reason === 'no_proxy' ? 'off（军师服务没有加载成功，由本地军师讲解）'
    : 'off（没有配置 COACH_BASE_URL 和 COACH_API_KEY，由本地军师讲解）';
  lines.push(`  军师模式：${note}`);
  if (s.apiOnly) lines.push('  只提供 /api（--api-only），不提供页面');
  if (s.dist && !s.apiOnly && !existsSync(join(s.root, 'index.html'))) {
    lines.push('  注意：dist/ 里还没有构建结果，请先运行 npm run build');
  }
  if (loopback) {
    lines.push('  想让 iPad 也能打开：用 npm start -- --host 0.0.0.0 启动，或者双击“启动象棋.cmd”');
  } else {
    lines.push(`  ${ADVICE}`);
    lines.push('  请一直用同一个地址（电脑名打得开就用电脑名，否则在路由器里给电脑固定 IP）：存档跟着地址走，换地址前先在设置里“导出存档”');
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------------------------------------------

/** Rejections nobody handled are logged, never fatal (D-24). Installed once, with the first server. */
function guardProcess() {
  if (processGuarded) return;
  processGuarded = true;
  process.on('unhandledRejection', (e) => {
    console.error('[unhandledRejection]', errorName(e));
  });
}

/**
 * Starts the server. `handler` defaults to `handleRequest` of server/coach-handler.js; `env` defaults to the
 * COACH_ entries of process.env. `mock` sets COACH_MOCK=1 in the handler's env.
 * @param {{port?: number, host?: string, dist?: boolean, mock?: boolean, apiOnly?: boolean,
 *          handler?: typeof handleRequest, env?: Record<string, string|undefined>}} [options]
 * @returns {Promise<{port: number, close(): Promise<void>}>}
 */
export async function startServer(options = {}) {
  const { port = DEFAULT_PORT, host = DEFAULT_HOST, dist = false, mock = false, apiOnly = false } = options;
  const root = resolve(dist ? 'dist' : '.');
  const env = options.env ? { ...options.env } : coachEnv(process.env);
  if (mock) env.COACH_MOCK = '1';
  const coach = await loadCoach(options.handler, env);
  const loopbackListen = isLoopbackHost(host);
  const apiHosts = allowedHostNames(env.COACH_ALLOWED_HOSTS);
  /** The refused Host values that were logged: one line each, and only the first few of a server run. @type {Set<string>} */
  const refusedHosts = new Set();
  const config = JSON.stringify(coach.mode === 'off'
    ? { apiBase: null, build: 'dev', coach: { mode: 'off', reason: coach.reason } }
    : { apiBase: '/api', build: 'dev', coach: { mode: coach.mode, reason: null } });
  /** @type {Map<string, Buffer>} */
  const icons = new Map();

  /** @param {IncomingMessage} req @param {ServerResponse} res */
  async function route(req, res) {
    const path = (req.url ?? '/').split(/[?#]/, 1)[0];
    // 1. the coach proxy, only under a Host that names this machine (static files are not restricted)
    if (path.startsWith('/api/')) {
      if (!hostAllowed(req.headers.host, apiHosts)) {
        const header = req.headers.host ?? '';
        const shown = header.length <= 80 && HOST_HEADER.test(header) ? `"${header}"` : 'that is missing or malformed';
        if (refusedHosts.size < REFUSED_HOSTS_LOGGED && !refusedHosts.has(shown)) {
          refusedHosts.add(shown);
          console.error(`[api] 403: a request with a Host header ${shown} was refused, because it does not name this machine; `
            + 'to use the coach under another name, list that name in COACH_ALLOWED_HOSTS');
        }
        send(req, res, 403, 'application/json', JSON.stringify({ error: { code: 'origin' } }));
        return;
      }
      if (!coach.handle) {
        send(req, res, 404, 'application/json', JSON.stringify({ error: { code: 'no_proxy' } }));
        return;
      }
      await serveApi(req, res, coach.handle, env, { ip: req.socket.remoteAddress, loopbackListen });
      return;
    }
    if (apiOnly) { notFound(req, res); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(req, res, 405, 'text/plain; charset=utf-8', 'Method not allowed', { Allow: 'GET, HEAD' });
      return;
    }
    // 2. the generated config (with --dist the built file is served below, unless a coach mode is active)
    if (path === '/config.json' && (!dist || coach.mode !== 'off')) {
      send(req, res, 200, 'application/json; charset=utf-8', config);
      return;
    }
    // 3. the generated icons (with --dist: the built files, below)
    if (!dist && path.startsWith('/icons/')) {
      const name = path.slice('/icons/'.length);
      const size = ICON_SIZES.get(name);
      if (size === undefined) { notFound(req, res); return; }
      let png = icons.get(name);
      if (!png) { png = makeIcon(size); icons.set(name, png); }
      send(req, res, 200, 'image/png', png);
      return;
    }
    // 4. static files from the allowlist
    const file = await locate(root, path, dist);
    if (!file) { notFound(req, res); return; }
    let data;
    try { data = await readFile(file); } catch { notFound(req, res); return; }       // gone since it was listed
    send(req, res, 200, MIME.get(extname(file)) ?? 'application/octet-stream', data);
  }

  guardProcess();
  const server = createServer((req, res) => {
    res.on('error', () => {});                                  // a reset connection must never be an uncaught error
    route(req, res).catch((e) => {
      console.error('[http]', /** @type {{message?: unknown}|null|undefined} */ (e)?.message);
      try {
        if (!res.headersSent) res.writeHead(500, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end();
      } catch { /* the connection is gone */ }
    });
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => { server.off('error', fail); done(undefined); });
  });
  const listening = /** @type {AddressInfo} */ (server.address()).port;
  if (announce) {
    console.log(bannerLines({ host, port: listening, dist, apiOnly, root, mode: coach.mode, reason: coach.reason }).join('\n'));
  }
  return {
    port: listening,
    close: () => new Promise((done, fail) => {
      server.close((e) => (e ? fail(e) : done()));
      server.closeAllConnections();                             // open streams and keep-alive sockets end now
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {string[]} argv
 * @returns {{port: number, host: string, dist: boolean, mock: boolean, apiOnly: boolean}}
 */
function parseArgs(argv) {
  const options = { port: DEFAULT_PORT, host: DEFAULT_HOST, dist: false, mock: false, apiOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    if (flag === '--dist' && inline === undefined) options.dist = true;
    else if (flag === '--mock' && inline === undefined) options.mock = true;
    else if (flag === '--api-only' && inline === undefined) options.apiOnly = true;
    else if (flag === '--port' || flag === '--host') {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') throw new Error(`${flag} needs a value`);
      if (flag === '--host') options.host = value;
      else if (/^\d{1,5}$/.test(value) && Number(value) <= 65535) options.port = Number(value);
      else throw new Error(`--port must be a number from 0 to 65535`);
    } else throw new Error(`unknown option ${argv[i]}`);
  }
  return options;
}

/** @param {string[]} argv */
async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); return; }
  let options;
  try {
    options = parseArgs(argv);
  } catch (e) {
    console.error(`${/** @type {Error} */ (e).message}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  loadEnvFiles();
  announce = true;
  try {
    await startServer(options);
  } catch (e) {
    const err = /** @type {{message?: unknown, code?: unknown}|null|undefined} */ (e);
    console.error(err?.code === 'EADDRINUSE'
      ? `弈间没能启动：端口 ${options.port} 已被占用（可能已经开着一个弈间），换一个端口：npm start -- --port 5174`
      : `弈间没能启动：${String(err?.message)}`);
    process.exitCode = 1;
  }
}

/** True when this file is the program Node was started with (not when a test imports it). */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    const norm = (/** @type {string} */ p) => (process.platform === 'win32' ? realpathSync(p).toLowerCase() : realpathSync(p));
    return norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) await main(process.argv.slice(2));
