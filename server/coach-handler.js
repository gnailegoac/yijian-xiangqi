// server/coach-handler.js (S2) — the fetch-style request handler of the proxy (contract sections 4.29, 7.1, 7.10–7.12).
// Routes are matched on the path suffix, so the handler can be mounted under any prefix (`/api` on the dev server).
//
// The proxy is the only place that holds the gateway key and the only place that talks to the language model. It is
// not a relay: the request carries data (a turn brief and typed events), never a model, a prompt, a tool or a token
// limit. One request is one leg of one coaching exchange: validate, build the messages of section 8, call the gateway
// (or the mock), stream the answer as SSE and end with exactly one of `tool`, `done`, `error`.
//
// Nothing from a request body, and no error message, is ever logged: one line per coach request holds the mode, the
// status, how the stream ended, the token usage and the duration. The key appears in no log line, no error and no
// response.

/**
 * @import { CoachEvent, CoachRequest } from '../src/coach/types.js'
 * @import { CoachConfig } from './config.js'
 */

import { LIMITS, PROTOCOL_VERSION, canonicalJson, validateCoachRequest, validateToolInput } from '../src/coach/protocol.js';
import { loadConfig } from './config.js';
import { createGuard } from './guard.js';
import { mockReply, mockStats } from './mock.js';
import { TOOLS, buildMessages } from './prompt.js';
import { mapError, streamChat } from './provider.js';
import { createSigner, sha256Hex } from './sign.js';

/** @typedef {{cfg:CoachConfig, guard:ReturnType<typeof createGuard>, signer:ReturnType<typeof createSigner>}} Proxy
 *    what one environment needs: its config, ONE guard (the rate-limit store lives inside it) and its signer */
/** @typedef {Parameters<typeof buildMessages>[1]} Legs   the completed legs of an event, as the resume token carries them */
/** @typedef {(event:string, data:object) => void} Send */
/** @typedef {{in:number, cached:number, out:number}} Usage */

/** A comment line is sent after this long without any event, so a silent model does not look like a dead proxy. */
const PING_MS = 10000;
const PING = ': ping\n\n';
/** The events that end a stream; exactly one of them is sent. */
const TERMINAL = ['tool', 'done', 'error'];
/** A tool-call id the client can send back (the shape validateCoachRequest accepts for `resume.results[].id`). */
const CALL_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MOCK_MODEL = 'mock';
/** Stands for a caller whose environment is not an object. */
const NO_ENV = Object.freeze({});

/** One proxy per environment object: cached per env identity. @type {WeakMap<object, Proxy>} */
const proxies = new WeakMap();

/**
 * @param {CoachConfig} cfg
 * @returns {Proxy}
 */
function makeProxy(cfg) {
  return { cfg, guard: createGuard(cfg), signer: createSigner(cfg.signingKey) };
}

/**
 * @param {Record<string, string|undefined>} env
 * @returns {Proxy}
 */
function proxyFor(env) {
  const key = env !== null && typeof env === 'object' ? env : NO_ENV;
  let proxy = proxies.get(key);
  if (!proxy) {
    proxy = makeProxy(loadConfig(key));
    proxies.set(key, proxy);
  }
  return proxy;
}

/** Live configs whose SDK import has been started. @type {WeakSet<CoachConfig>} */
const warmed = new WeakSet();

/**
 * Starts loading the provider SDK in the background, once per live config, when the page's health probe arrives.
 * Loading it takes seconds on a slow disk; without this the first coach request of a server run would pay for it
 * and the child's first reply would time out into the local line. No request is made: `streamChat` loads the SDK
 * and stops at once, because the signal it is given has already fired. Mock and off mode never load the SDK.
 * @param {CoachConfig} cfg
 */
function warmUp(cfg) {
  if (cfg.mode !== 'live' || warmed.has(cfg)) return;
  warmed.add(cfg);
  streamChat(cfg, { model: cfg.model, messages: [], tools: [], toolChoice: 'none', maxTokens: 1, signal: AbortSignal.abort() })
    .next().catch(() => {});
}

// ---------------------------------------------------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {number} status
 * @param {object} body
 * @param {Record<string, string>} [headers]
 * @returns {Response}
 */
function json(status, body, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * The one log line of a coach request. It holds numbers and fixed words only.
 * @param {CoachConfig} cfg
 * @param {number} status
 * @param {number} started  Date.now() when the request arrived
 * @param {string} outcome  `code=<error code>` before the stream opens, `end=<done|tool|error:code|aborted|none>` after
 * @param {Usage} [usage]
 */
function logRequest(cfg, status, started, outcome, usage) {
  const tokens = usage ? ` in=${usage.in} cached=${usage.cached} out=${usage.out}` : '';
  console.log(`[coach] mode=${cfg.mode} status=${status} ${outcome}${tokens} ms=${Date.now() - started}`);
}

/**
 * @param {CoachConfig} cfg
 * @returns {object} the body of GET /health; it never calls the provider
 */
function health(cfg) {
  if (cfg.mode === 'off') return { ok: false, v: PROTOCOL_VERSION, mode: 'off', reason: 'no_key' };
  return { ok: true, v: PROTOCOL_VERSION, mode: cfg.mode, model: cfg.mode === 'mock' ? MOCK_MODEL : cfg.model, freeText: cfg.freeText };
}

/**
 * The address the rate limits count: the first `x-forwarded-for` hop when the deployer trusts the proxy in front
 * (COACH_TRUST_PROXY=1), else the peer address of the connection.
 * @param {Request} request
 * @param {CoachConfig} cfg
 * @param {{ip?:string}} ctx
 * @returns {string|undefined}
 */
function clientIp(request, cfg, ctx) {
  if (cfg.trustProxy) {
    const hop = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    if (hop) return hop;
  }
  return ctx.ip;
}

/**
 * The request body as text; `tooLarge` when it has more than `max` bytes, `unreadable` when it is not UTF-8 text.
 * @param {Request} request
 * @param {number} max
 * @returns {Promise<{text:string}|{tooLarge:true}|{unreadable:true}>}
 */
async function readCapped(request, max) {
  if (Number(request.headers.get('content-length')) > max) return { tooLarge: true };
  if (!request.body) return { text: '' };
  const reader = request.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { unreadable: true };
  }
}

/** @param {string} raw @returns {unknown} the parsed body; undefined when it is not JSON */
function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * The hash a resume token carries: the validated request without `resume` (contract section 7.4).
 * @param {CoachRequest} req
 * @returns {string}
 */
function bodyHash(req) {
  const { resume: _resume, ...rest } = req;
  return sha256Hex(canonicalJson(rest));
}

/**
 * Rule 3 of validateCoachRequest: the signature of every earlier reply of the model must verify for this thread
 * (same turn), this event index and this event kind.
 * @param {CoachRequest} req
 * @param {Proxy['signer']} signer
 * @returns {boolean}
 */
function verifyReplies(req, signer) {
  const turnHash = sha256Hex(canonicalJson(req.turn));
  return req.events.every((event) => event.said !== 'llm' || (event.reply !== undefined
    && signer.verifyReply({ turnHash, i: event.i, kind: event.kind }, event.reply.text, event.reply.sig)));
}

/**
 * Rule 7: the resume token must verify, belong to this very request (its hash is the hash of the request without
 * `resume`) and carry 1..TOOL_ROUNDS legs; every result must answer a call that was forwarded to the client, once.
 * @param {CoachRequest} req
 * @param {Proxy['signer']} signer
 * @returns {Legs|null}  the completed legs; null when the resume is not acceptable
 */
function openResume(req, signer) {
  if (!req.resume) return [];
  const payload = /** @type {{v?:unknown, h?:unknown, legs?:unknown}|null} */ (signer.open(req.resume.token));
  if (!payload || payload.v !== 1 || payload.h !== bodyHash(req)) return null;
  const { legs } = payload;
  if (!Array.isArray(legs) || legs.length < 1 || legs.length > LIMITS.TOOL_ROUNDS) return null;
  /** @type {Set<string>} */
  const forwarded = new Set();
  for (const leg of legs) {
    if (!isLeg(leg)) return null;
    for (const call of leg.calls) if (!leg.x.some((x) => x.id === call.id)) forwarded.add(call.id);
  }
  /** @type {Set<string>} */
  const answered = new Set();
  for (const result of req.resume.results) {
    if (!forwarded.has(result.id) || answered.has(result.id)) return null;      // an unknown id, or one answered twice
    answered.add(result.id);
  }
  return legs;
}

/**
 * @param {unknown} leg
 * @returns {leg is Legs[number]} the shape the proxy seals into a token (contract section 7.4)
 */
function isLeg(leg) {
  if (leg === null || typeof leg !== 'object') return false;
  const { text, calls, x } = /** @type {Record<string, unknown>} */ (leg);
  return typeof text === 'string'
    && Array.isArray(calls) && calls.every((c) => c !== null && typeof c === 'object'
      && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.arguments === 'string')
    && Array.isArray(x) && x.every((r) => r !== null && typeof r === 'object'
      && typeof r.id === 'string' && (r.error === 'syntax' || r.error === 'limit'));
}

/**
 * Rule 8: the characters of the rendered prompt (turn + events, the assistant turns of earlier events included).
 * @param {CoachRequest} req
 * @returns {number}
 */
function renderedLength(req) {
  let length = 0;
  for (const message of buildMessages(req, [])) {
    if (message.role !== 'system' && typeof message.content === 'string') length += message.content.length;
  }
  return length;
}

/**
 * @param {CoachConfig} cfg
 * @param {CoachEvent} last  the event to answer
 * @returns {string} the model of this exchange: the quick model for the `start` and `opp` one-liners
 */
function modelFor(cfg, last) {
  if (cfg.mode === 'mock') return MOCK_MODEL;
  return last.kind === 'opp' || last.kind === 'start' ? cfg.quickModel : cfg.model;
}

/**
 * Resolves after `ms` milliseconds, or as soon as `signal` fires. `ms` may be Infinity (wait for the signal only).
 * @param {number} ms
 * @param {AbortSignal} signal
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const wake = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', wake);
      resolve();
    };
    const timer = Number.isFinite(ms) ? setTimeout(wake, ms) : undefined;
    signal.addEventListener('abort', wake, { once: true });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The stream
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The SSE response of one leg. Sends `open` before anything else (so the client can tell "proxy reachable" from
 * "model slow"), a ping comment after every 10 s of silence, and whatever `run` sends. `request.signal` and the
 * stream's `cancel()` fire one AbortController, which is the signal `run` receives. An error `run` throws becomes an
 * `error` event through `mapError`; when the client went away nothing more is sent. Then the stream closes.
 *
 * The Request itself is held here until the stream closes, not only its signal: `request.signal` follows the
 * signal the caller gave the Request only while the Request object is alive (the runtime links the two weakly), so
 * a handler that kept the signal alone would miss the abort once the Request had been garbage-collected.
 * @param {Record<string, string>} cors
 * @param {Request} request
 * @param {object} open  the data of the `open` event
 * @param {(send:Send, signal:AbortSignal, note:(usage:Usage) => void) => Promise<unknown>} run
 * @param {(outcome:string, usage:Usage|undefined) => void} log  called once, when the leg is over
 * @returns {Response}
 */
function sse(cors, request, open, run, log) {
  /** @type {Request|null} */
  let held = request;                                           // released in close()
  const requestSignal = request.signal;
  const ac = new AbortController();
  const encoder = new TextEncoder();
  /** @type {ReadableStreamDefaultController<Uint8Array>} */
  let controller;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let pingTimer;
  let closed = false;
  let ended = '';                                               // how the stream ended: the terminal event that was sent
  /** @type {Usage|undefined} */
  let usage;

  /** @param {string} text */
  const write = (text) => {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(text));
    } catch {
      abandon();                                                // the runtime closed the stream under us: the client is gone
      return;
    }
    clearTimeout(pingTimer);
    pingTimer = setTimeout(() => write(PING), PING_MS);
  };
  /** @type {Send} */
  const send = (event, data) => {
    if (closed || ended) return;                                // exactly one terminal event, and nothing after it
    if (TERMINAL.includes(event)) {
      const { code, usage: counted } = /** @type {{code?:unknown, usage?:Usage}} */ (data);
      ended = event === 'error' ? `error:${typeof code === 'string' ? code : 'internal'}` : event;
      if (event === 'done' && counted) usage = counted;
    }
    write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  /** @param {boolean} cancelled  the consumer cancelled the stream: it must not be closed again */
  const close = (cancelled) => {
    if (closed) return;
    closed = true;
    clearTimeout(pingTimer);
    held?.signal.removeEventListener('abort', onAbort);
    held = null;
    if (!cancelled) {
      try { controller.close(); } catch { /* already closed by the runtime */ }
    }
  };
  const onAbort = () => {
    ac.abort();
    close(false);
  };
  /** The stream can take no more data: stop the work behind it. */
  const abandon = () => {
    ac.abort();
    close(true);
  };

  const stream = new ReadableStream({
    start(c) {
      controller = c;
      send('open', open);
      if (requestSignal.aborted) onAbort();
      else requestSignal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve()
        .then(() => run(send, ac.signal, (u) => { usage = u; }))
        .catch((err) => {
          const mapped = ac.signal.aborted ? null : mapError(err);
          if (mapped) send('error', mapped);
        })
        .then(() => {
          try {
            log(`end=${ended || (ac.signal.aborted ? 'aborted' : 'none')}`, usage);
          } finally {
            close(false);
          }
        })
        .catch(() => {});                                       // a log sink that throws must not become an unhandled rejection
    },
    cancel() {
      abandon();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { ...cors, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  });
}

/**
 * Mock mode: sends what `mockReply` yields and does its waiting (the `wait` pairs) on the abort signal.
 * Counts the request in `mockStats`: started; completed when a terminal event went out; aborted when the signal fired
 * before one did.
 * @param {AsyncGenerator<[string, object]>} reply
 * @param {Send} send
 * @param {AbortSignal} signal
 */
async function pump(reply, send, signal) {
  mockStats.started++;
  let terminal = false;
  try {
    while (!signal.aborted) {
      const step = await reply.next();
      if (step.done) break;
      const [event, data] = step.value;
      if (event === 'wait') {
        await sleep(Number(/** @type {{ms?:unknown}} */ (data).ms), signal);
        continue;
      }
      if (signal.aborted) break;
      send(event, data);
      if (TERMINAL.includes(event)) {
        terminal = true;
        break;
      }
    }
  } finally {
    await reply.return(undefined);
    if (terminal) mockStats.completed++;
    else if (signal.aborted) mockStats.aborted++;
  }
}

/**
 * Live mode: one provider call (contract section 7.11). Text is passed on as `delta` events; the leg ends with `done`
 * (the text of all legs, signed), with `tool` (the calls the client must run, and the sealed resume token) or with
 * an `error`. A call that is not a valid `analyze_move` call, and every call beyond two, is not forwarded: the proxy
 * answers it itself when the client resumes.
 * @param {CoachConfig} cfg
 * @param {CoachRequest} req
 * @param {Legs} legs
 * @param {Proxy['signer']} signer
 * @param {Send} send
 * @param {AbortSignal} signal
 * @param {(usage:Usage) => void} note
 */
async function runLive(cfg, req, legs, signer, send, signal, note) {
  const last = req.events[req.events.length - 1];
  const lastLeg = legs.length >= LIMITS.TOOL_ROUNDS;
  let legText = '';
  let end = null;
  const parts = streamChat(cfg, {
    model: modelFor(cfg, last),
    messages: buildMessages(req, legs),
    tools: TOOLS,
    toolChoice: lastLeg ? 'none' : 'auto',
    maxTokens: last.kind === 'over' ? cfg.maxTokensOver : cfg.maxTokens,
    signal,
  });
  for await (const part of parts) {
    if (part.type === 'text') {
      legText += part.text;
      send('delta', { t: part.text });
    } else {
      end = part;
    }
  }
  if (!end) return send('error', { code: 'upstream_error' });
  note(end.usage);
  if (end.finish === 'content_filter') return send('error', { code: 'refused' });

  if (end.toolCalls.length > 0) {
    if (end.finish !== 'tool_calls' || lastLeg) return send('error', { code: 'truncated' });
    // An id the client could not send back (empty, odd characters, or used before in this event) is replaced; the
    // token and the replayed assistant message carry the same id, which is all a provider needs.
    const used = new Set(legs.flatMap((leg) => leg.calls.map((c) => c.id)));
    const made = end.toolCalls.map((c, k) => {
      let id = c.id;
      for (let n = 0; !CALL_ID_RE.test(id) || used.has(id); n++) id = `call_${legs.length + 1}_${k + 1}${n ? `_${n}` : ''}`;
      used.add(id);
      return { id, name: c.name, arguments: c.arguments };
    });
    /** @type {{id:string, name:string, input:{notation:string, after:string[]}}[]} */
    const calls = [];
    /** @type {Legs[number]['x']} */
    const x = [];
    made.forEach((c, k) => {
      let input = null;
      if (k < LIMITS.TOOL_CALLS_PER_ROUND) {
        try { input = validateToolInput(c.name, JSON.parse(c.arguments)); } catch { input = null; }
      }
      if (input) calls.push({ id: c.id, name: c.name, input });
      else x.push({ id: c.id, error: k < LIMITS.TOOL_CALLS_PER_ROUND ? 'syntax' : 'limit' });
    });
    const token = signer.seal({ v: 1, h: bodyHash(req), legs: [...legs, { text: legText, calls: made, x }] });
    return send('tool', { calls, resume: token, text: legText });
  }

  const text = [...legs.map((leg) => leg.text), legText].filter(Boolean).join('\n');
  if (!text.trim()) return send('error', { code: 'empty' });
  return send('done', {
    text,
    sig: signer.signReply({ turnHash: sha256Hex(canonicalJson(req.turn)), i: last.i, kind: last.kind }, text),
    stop: end.finish === 'length' ? 'length' : 'end',
    model: end.model,
    usage: end.usage,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {Proxy} proxy
 * @param {Request} request
 * @param {{ip?:string, loopbackListen?:boolean}} ctx
 * @returns {Promise<Response>}
 */
async function handle(proxy, request, ctx) {
  const started = Date.now();
  const { cfg, guard, signer } = proxy;
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') ?? url.host;
  const cors = guard.corsHeaders(origin, host);                // Allow-Origin only for allowed origins, Vary: Origin
  const path = url.pathname;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method === 'GET' && path.endsWith('/health')) {
    warmUp(cfg);
    return json(200, health(cfg), cors);
  }
  if (cfg.mode === 'mock' && path.endsWith('/mock/stats')) return json(200, mockStats, cors);
  if (cfg.mode === 'mock' && path.endsWith('/mock/reset') && request.method === 'POST') {
    mockStats.started = 0;
    mockStats.completed = 0;
    mockStats.aborted = 0;
    return json(200, mockStats, cors);
  }
  if (!path.endsWith('/coach')) return json(404, { error: { code: 'not_found' } }, cors);
  if (request.method !== 'POST') return json(405, { error: { code: 'method' } }, cors);

  /**
   * An answer before the stream opens: plain JSON with an HTTP status, and the log line of this request.
   * @param {number} status @param {string} code @param {Record<string, string>} [headers] @param {object} [more]
   */
  const refuse = (status, code, headers, more) => {
    logRequest(cfg, status, started, `code=${code}`);
    return json(status, { error: { code, ...more } }, headers);
  };

  // private-range rule, unless COACH_PUBLIC=1 or the listener is loopback
  if (!(ctx.loopbackListen || guard.checkPeer(ctx.ip))) return refuse(403, 'peer');
  if (!guard.checkOrigin(origin, host)) return refuse(403, 'origin');
  if (cfg.mode === 'off') return refuse(503, 'no_key', cors);

  if (cfg.mode === 'mock') {                                    // ?fail=<status>: answer that HTTP status
    const fail = url.searchParams.get('fail');
    if (fail !== null && /^[45][0-9]{2}$/.test(fail)) return refuse(Number(fail), 'mock_fail', cors);
  }

  const limit = await guard.take(clientIp(request, cfg, ctx) ?? 'unknown');
  if (!limit.ok) {
    return refuse(429, 'rate', { ...cors, 'retry-after': String(limit.retryAfter) }, { retry_after: limit.retryAfter });
  }
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return refuse(415, 'invalid', cors);

  const raw = await readCapped(request, LIMITS.BODY_BYTES);
  if ('tooLarge' in raw) return refuse(413, 'too_large', cors);
  const v = validateCoachRequest('text' in raw ? safeJson(raw.text) : undefined);
  if (!v.ok) {
    if (v.path === 'v' && v.why === 'version') return refuse(400, 'bad_version', cors);
    return refuse(400, 'invalid', cors, { path: v.path });      // the path names a field, never its content
  }
  const req = v.value;
  const last = req.events[req.events.length - 1];
  if (!cfg.freeText && last.kind === 'ask' && last.ask === 'free') return refuse(403, 'free_text_off', cors);
  if (!verifyReplies(req, signer)) return refuse(400, 'bad_signature', cors);
  const legs = openResume(req, signer);                         // verifies HMAC, hash and ids
  if (!legs) return refuse(400, 'invalid', cors, { path: 'resume' });
  if (renderedLength(req) > LIMITS.PROMPT_CHARS) return refuse(413, 'too_large', cors);

  return sse(cors, request, { v: PROTOCOL_VERSION, mode: cfg.mode, model: modelFor(cfg, last) },
    (send, signal, note) => (cfg.mode === 'mock'
      ? pump(mockReply(req, legs, signer, cfg, url.searchParams), send, signal)
      : runLive(cfg, req, legs, signer, send, signal, note)),
    (outcome, usage) => logRequest(cfg, 200, started, outcome, usage));
}

/**
 * Runs `handle` and turns anything it throws into a plain 500: the handler never rejects.
 * @param {() => Proxy} proxy
 * @param {Request} request
 * @param {{ip?:string, loopbackListen?:boolean}} ctx
 * @returns {Promise<Response>}
 */
async function guarded(proxy, request, ctx) {
  try {
    return await handle(proxy(), request, ctx);
  } catch (err) {
    const name = /** @type {{constructor?:{name?:unknown}}|null|undefined} */ (err)?.constructor?.name;
    console.error(`[coach] internal error (${typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name) ? name : 'Error'})`);
    return json(500, { error: { code: 'internal' } });
  }
}

/**
 * True when the live path has what it needs (COACH_API_KEY and COACH_BASE_URL) or mock mode is on.
 * @param {Record<string, string|undefined>} env
 * @returns {boolean}
 */
export function isConfigured(env) {
  return loadConfig(env).mode !== 'off';
}

/**
 * @param {Request} request
 * @param {Record<string, string|undefined>} env
 * @param {{ip?:string, loopbackListen?:boolean}} [ctx]
 * @returns {Promise<Response>}
 */
export async function handleRequest(request, env, ctx) {
  return guarded(() => proxyFor(env), request, ctx ?? {});
}

/**
 * Test helper: a handler with a fixed config.
 * @param {Partial<CoachConfig>} [overrides]
 * @returns {(request:Request, env?:Record<string, string|undefined>, ctx?:{ip?:string, loopbackListen?:boolean}) => Promise<Response>}
 */
export function createCoachHandler(overrides) {
  const proxy = makeProxy(loadConfig({}, overrides));
  return (request, _env, ctx) => guarded(() => proxy, request, ctx ?? {});
}
