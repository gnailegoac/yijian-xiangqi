// tests/helpers/fake-fetch.js (C4) — a scripted stand-in for `fetch` against the coach proxy (contract sections 7.1–7.4).
//
//   createFakeFetch()   a `fetch` that answers `GET …/health` and `POST …/coach` from scripts: real `Response` objects whose
//                       bodies are real byte streams, so the client's reader, decoder and abort paths run as in a browser
//   sseEvent()          one event in the wire format of section 7.3
//
// A script decides what the proxy says and when: SSE events, raw bytes, pauses, a body cut after any number of bytes, an HTTP
// error, a response that never comes. Replies and resume tokens are signed with the real signer (key 'mock'), and in strict
// mode (the default) every `POST …/coach` body is checked the way the proxy checks it — C1's validator, the 64 KB limit,
// the signatures of earlier replies, the resume token — so a thread that a real proxy would reject shows up in `violations`.
// Time is the caller's: pass the setTimer / clearTimer of a virtual clock and nothing happens until the test advances it.

/**
 * @import { CoachRequest } from '../../src/coach/types.js'
 */

import { canonicalJson, LIMITS, validateCoachRequest } from '../../src/coach/protocol.js';
import { createSigner, sha256Hex } from '../../server/sign.js';

/**
 * One step of a scripted SSE body. After the last step the stream closes.
 *   {wait}          nothing for that many ms
 *   {event, data}   one SSE event; `data` may be a function of the call (to sign a reply for the request that was sent)
 *   {raw}           these bytes as they are (malformed SSE, half events)
 *   {ping}          the comment line `: ping`
 *   {hang}          the stream stays open and silent until the client goes away
 *   {drop}          the connection breaks: the stream errors (on the next turn of the clock, so that what was written before
 *                   can still be read, as on a real connection)
 *   {close}         the stream closes here (the steps after it are not sent)
 * @typedef {{wait:number} | {event:string, data:unknown} | {raw:string|Uint8Array} | {ping:true} | {hang:true} | {drop:true} | {close:true}} SseStep
 *
 * What the proxy answers to one request.
 * @typedef {Object} FakeReply
 * @property {number} [status]              HTTP status (default 200)
 * @property {string} [error]               with a status: the body `{"error":{"code": error, "retry_after": retryAfter}}`
 * @property {number} [retryAfter]
 * @property {unknown} [json]               a JSON body
 * @property {string} [text]                a body that is not JSON
 * @property {Record<string, string>} [headers]
 * @property {number} [delay]               ms before the response (its headers) arrives
 * @property {boolean} [hang]               the response never arrives
 * @property {unknown} [reject]             fetch rejects with this (a network failure)
 * @property {SseStep[]} [steps]            an SSE body
 * @property {number} [chunkBytes]          every write is split into pieces of at most this many bytes
 * @property {number} [cutAt]               the body ends after this many bytes
 * @property {'close'|'drop'|'hang'} [cutHow]   how it ends there: by closing (default), by breaking, or by going silent
 *
 * @typedef {FakeReply | ((call:FakeCall) => FakeReply)} Responder
 *
 * One request the client made.
 * @typedef {Object} FakeCall
 * @property {number} n                     0-based index among all requests
 * @property {string} url
 * @property {string} method
 * @property {Record<string, string>} headers
 * @property {string|null} body
 * @property {unknown} json                 the parsed body (undefined when there is none or it is not JSON)
 * @property {'pending'|'answered'|'open'|'closed'|'cancelled'|'aborted'|'failed'} state
 *           pending: no response yet; answered: a response without a stream; open: its stream is being written;
 *           closed: the stream ended by itself; cancelled: the reader cancelled it; aborted: the request's signal fired;
 *           failed: the request was rejected or the stream broke
 * @property {boolean} aborted              the request's signal fired at some point
 * @property {(() => void)|null} abortBody  (internal) breaks the stream when the signal fires
 *
 * The payload of a resume token (section 7.4).
 * @typedef {{h:string, legs:{text:string, calls:{id:string, name:string, arguments:string}[], x:unknown[]}[]}} Sealed
 */

/**
 * One event in the wire format of section 7.3.
 * @param {string} event @param {unknown} data
 * @returns {string}
 */
export function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const encoder = new TextEncoder();

/** What `fetch` rejects with, and what a body stream errors with, when the request is aborted. @returns {Error} */
function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * @param {{
 *   setTimer?: (fn:() => void, ms:number) => unknown,
 *   clearTimer?: (id:unknown) => void,
 *   key?: string,
 *   strict?: boolean,
 * }} [options]  key: the signing key (default 'mock', as in mock mode); strict: check every POST like the proxy (default true)
 */
export function createFakeFetch(options = {}) {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (id)));
  const strict = options.strict !== false;
  const signer = createSigner(options.key ?? 'mock');

  /** @type {FakeCall[]} */
  const calls = [];
  /** @type {string[]} */
  const violations = [];
  /** @type {Responder[]} */
  const queue = [];
  /** Calls whose stream is being written. @type {Set<FakeCall>} */
  const open = new Set();
  /** Timers of the fake proxy that are set and have not fired. @type {Set<unknown>} */
  const timers = new Set();

  /** @param {() => void} fn @param {number} ms @returns {unknown} the timer */
  function later(fn, ms) {
    /** @type {unknown} */
    const id = setTimer(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }
  /** @param {unknown} id */
  function cancel(id) {
    if (!timers.delete(id)) return;
    clearTimer(id);
  }

  // ---- signing, as server/coach-handler.js does it ----

  /** The body of a call as the request it is (the scripts that sign are written for requests the proxy accepts). @param {FakeCall} call */
  const requestOf = (call) => /** @type {CoachRequest} */ (call.json);
  /** @param {string} token @returns {Sealed|null} */
  const unseal = (token) => /** @type {Sealed|null} */ (signer.open(token));
  /** The hash a resume token binds: the request without `resume`. @param {CoachRequest} request @returns {string} */
  const hashOf = (request) => {
    const { resume: _resume, ...bare } = request;
    return sha256Hex(canonicalJson(bare));
  };

  /**
   * The data of a `done` event for the request of `call`: the text signed for that thread, index and kind.
   * @param {FakeCall} call @param {string} text @param {Record<string, unknown>} [extra]
   */
  function doneData(call, text, extra = {}) {
    const request = requestOf(call);
    const last = request.events[request.events.length - 1];
    const sig = signer.signReply({ turnHash: sha256Hex(canonicalJson(request.turn)), i: last.i, kind: last.kind }, text);
    return { text, sig, stop: 'end', model: 'mock', usage: { in: 0, cached: 0, out: [...text].length }, ...extra };
  }

  /**
   * The data of a `tool` event for the request of `call`, with a real resume token (the legs so far plus this one).
   * @param {FakeCall} call @param {{id:string, name:string, input:unknown}[]} toolCalls @param {string} [text] text of this leg
   */
  function toolData(call, toolCalls, text = '') {
    const request = requestOf(call);
    const earlier = request.resume ? unseal(request.resume.token) : null;
    const legs = earlier && Array.isArray(earlier.legs) ? earlier.legs : [];
    const leg = { text, calls: toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: JSON.stringify(c.input) })), x: [] };
    /** @type {{calls:unknown[], resume:string, text:string}} */
    const data = { calls: toolCalls, resume: signer.seal({ v: 1, h: hashOf(request), legs: [...legs, leg] }), text };
    return data;
  }

  /** @type {SseStep} */
  const OPEN = { event: 'open', data: { v: 1, mode: 'mock', model: 'mock' } };

  /**
   * A whole streamed reply: `open`, the text as deltas, a signed `done`.
   * @param {string} text
   * @param {{size?:number, gap?:number, first?:number, done?:Record<string, unknown>}} [how]
   *        size: characters per delta (default 4); gap: ms between deltas (default 0); first: ms before the first delta (default 0);
   *        done: extra members of the `done` data
   * @returns {Responder}
   */
  function say(text, how = {}) {
    const size = how.size ?? 4;
    return (call) => {
      /** @type {SseStep[]} */
      const steps = [OPEN];
      if (how.first) steps.push({ wait: how.first });
      const chars = [...text];
      for (let k = 0; k < chars.length; k += size) {
        if (k > 0 && how.gap) steps.push({ wait: how.gap });
        steps.push({ event: 'delta', data: { t: chars.slice(k, k + size).join('') } });
      }
      steps.push({ event: 'done', data: doneData(call, text, how.done) });
      return { steps };
    };
  }

  // ---- what a real proxy would reject (sections 4.10, 7.4, 7.10) ----

  /**
   * @param {FakeCall} call
   * @returns {FakeReply|null} the proxy's refusal, or null when the request is acceptable
   */
  function refusal(call) {
    /** @param {string} why @param {number} status @param {string} code @returns {FakeReply} */
    const refuse = (why, status, code) => {
      violations.push(`request ${call.n}: ${why}`);
      return { status, error: code };
    };
    if (call.headers['content-type'] !== 'application/json') return refuse('content-type is not application/json', 415, 'invalid');
    if (call.body === null) return refuse('no body', 400, 'invalid');
    if (encoder.encode(call.body).length > LIMITS.BODY_BYTES) return refuse('body over 64 KB', 413, 'too_large');
    if (call.json === undefined) return refuse('body is not JSON', 400, 'invalid');
    const checked = validateCoachRequest(call.json);
    if (!checked.ok) return refuse(`invalid at ${checked.path} (${checked.why})`, 400, checked.why === 'version' ? 'bad_version' : 'invalid');
    /** @type {CoachRequest} */
    const request = checked.value;
    const turnHash = sha256Hex(canonicalJson(request.turn));
    for (const ev of request.events) {
      if (ev.said === 'llm' && ev.reply && !signer.verifyReply({ turnHash, i: ev.i, kind: ev.kind }, ev.reply.text, ev.reply.sig)) {
        return refuse(`the reply of event ${ev.i} does not verify`, 400, 'bad_signature');
      }
    }
    if (request.resume) {
      const sealed = unseal(request.resume.token);
      if (!sealed) return refuse('the resume token does not verify', 400, 'invalid');
      if (sealed.h !== hashOf(requestOf(call))) return refuse('the resume body differs from the first leg', 400, 'invalid');
      /** @type {string[]} */
      const ids = [];
      for (const leg of sealed.legs) for (const c of leg.calls) ids.push(c.id);
      for (const result of request.resume.results) {
        if (!ids.includes(result.id)) return refuse(`a tool result for an unknown call ${result.id}`, 400, 'invalid');
      }
    }
    return null;
  }

  // ---- responses ----

  /**
   * @param {FakeCall} call @param {FakeReply} reply
   * @returns {Response}
   */
  function streamResponse(call, reply) {
    const steps = reply.steps ?? [];
    const limit = reply.cutAt ?? Infinity;
    let written = 0;
    let over = false;
    /** @type {unknown} */
    let timer = null;
    /** @type {ReadableStreamDefaultController<Uint8Array>} */
    let controller;

    /** @param {FakeCall['state']} state */
    const end = (state) => {
      over = true;
      call.state = state;
      call.abortBody = null;
      open.delete(call);
      if (timer !== null) cancel(timer);
      timer = null;
    };
    /** @param {Uint8Array} bytes @returns {boolean} false when the body ended here */
    const write = (bytes) => {
      const room = limit - written;
      const part = bytes.length > room ? bytes.subarray(0, room) : bytes;
      const piece = reply.chunkBytes && reply.chunkBytes > 0 ? reply.chunkBytes : part.length;
      for (let at = 0; at < part.length; at += piece) controller.enqueue(part.slice(at, at + piece));
      written += part.length;
      if (written < limit) return true;
      if (reply.cutHow === 'hang') return false;
      if (reply.cutHow === 'drop') {
        drop();
      } else {
        end('closed');
        controller.close();
      }
      return false;
    };
    /** The connection breaks. A stream that errors forgets what it has queued, so the break comes one timer later. */
    const drop = () => {
      timer = later(() => {
        timer = null;
        end('failed');
        controller.error(new TypeError('network error'));
      }, 0);
    };
    /** @param {number} k */
    const run = (k) => {
      for (; k < steps.length && !over; k++) {
        const step = steps[k];
        if ('wait' in step) {
          const next = k + 1;
          timer = later(() => {
            timer = null;
            run(next);
          }, step.wait);
          return;
        }
        if ('hang' in step) return;
        if ('drop' in step) {
          drop();
          return;
        }
        if ('close' in step) break;
        let bytes;
        if ('raw' in step) bytes = typeof step.raw === 'string' ? encoder.encode(step.raw) : step.raw;
        else if ('ping' in step) bytes = encoder.encode(': ping\n\n');
        else bytes = encoder.encode(sseEvent(step.event, typeof step.data === 'function' ? step.data(call) : step.data));
        if (!write(bytes)) return;
      }
      if (over) return;
      end('closed');
      controller.close();
    };

    const body = new ReadableStream({
      start(c) {
        controller = c;
        call.state = 'open';
        open.add(call);
        call.abortBody = () => {
          if (over) return;
          end('aborted');
          controller.error(abortError());
        };
        run(0);
      },
      cancel() {
        if (!over) end('cancelled');
      },
    });
    return new Response(body, {
      status: reply.status ?? 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', ...reply.headers },
    });
  }

  /**
   * @param {FakeCall} call @param {FakeReply} reply
   * @returns {Response}
   */
  function responseFor(call, reply) {
    if (reply.steps) return streamResponse(call, reply);
    call.state = 'answered';
    const status = reply.status ?? 200;
    /** @type {Record<string, string>} */
    const headers = { 'content-type': 'application/json', ...reply.headers };
    if (reply.text !== undefined) return new Response(reply.text, { status, headers });
    let payload = reply.json;
    if (payload === undefined) {
      /** @type {Record<string, unknown>} */
      const error = { code: reply.error ?? (status === 200 ? 'none' : 'internal') };
      if (reply.retryAfter !== undefined) error.retry_after = reply.retryAfter;
      payload = { error };
    }
    return new Response(JSON.stringify(payload), { status, headers });
  }

  /** @param {Responder} responder @param {FakeCall} call @returns {FakeReply} */
  const resolveReply = (responder, call) => (typeof responder === 'function' ? responder(call) : responder);

  const fake = {
    /** Every request, in order. */
    calls,
    /** What a real proxy would have rejected, one line each (strict mode). */
    violations,
    signer,
    /** What `GET …/health` answers. @type {Responder} */
    health: { json: { ok: true, v: 1, mode: 'mock', model: 'mock', freeText: true } },
    /** What `POST …/coach` answers when nothing is queued. @type {Responder} */
    coach: say('嗯。'),
    /** One-shot answers for the next `POST …/coach` requests, in order. @param {...Responder} replies */
    enqueue(...replies) {
      queue.push(...replies);
    },
    /** Queued answers not used yet. @returns {number} */
    queued: () => queue.length,
    say,
    doneData,
    toolData,
    /** The `open` event. */
    OPEN,
    /** @returns {FakeCall[]} */
    coachCalls: () => calls.filter((call) => call.method === 'POST' && /\/coach(?:\?.*)?$/.test(call.url)),
    /** @returns {FakeCall[]} */
    healthCalls: () => calls.filter((call) => call.method === 'GET' && /\/health(?:\?.*)?$/.test(call.url)),
    /** Response streams that are still being written (neither ended, cancelled nor aborted). @returns {number} */
    openStreams: () => open.size,
    /** Requests that have not been answered and were not aborted. @returns {number} */
    pendingRequests: () => calls.filter((call) => call.state === 'pending').length,
    /** Timers of the fake proxy that are still set. @returns {number} */
    pendingTimers: () => timers.size,

    fetch: /** @type {typeof fetch} */ ((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = String(init?.method ?? 'GET').toUpperCase();
      /** @type {Record<string, string>} */
      const headers = {};
      new Headers(init?.headers ?? undefined).forEach((value, name) => { headers[name] = value; });
      const body = typeof init?.body === 'string' ? init.body : null;
      /** @type {unknown} */
      let json;
      if (body !== null) {
        try {
          json = JSON.parse(body);
        } catch { /* not JSON */ }
      }
      /** @type {FakeCall} */
      const call = { n: calls.length, url, method, headers, body, json, state: 'pending', aborted: false, abortBody: null };
      calls.push(call);
      const signal = init?.signal ?? undefined;

      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          call.aborted = true;
          call.state = 'aborted';
          reject(abortError());
          return;
        }
        /** @type {unknown} */
        let timer = null;
        signal?.addEventListener('abort', () => {
          call.aborted = true;
          if (call.state === 'pending') {
            if (timer !== null) cancel(timer);
            timer = null;
            call.state = 'aborted';
            reject(abortError());
          } else if (call.abortBody) {
            call.abortBody();
          }
        }, { once: true });

        /** @type {FakeReply} */
        let reply;
        const path = url.replace(/\?.*$/, '');
        if (method === 'GET' && path.endsWith('/health')) {
          reply = resolveReply(fake.health, call);
        } else if (method === 'POST' && path.endsWith('/coach')) {
          const next = queue.shift() ?? fake.coach;
          reply = (strict ? refusal(call) : null) ?? resolveReply(next, call);
        } else {
          reply = { status: 404, error: 'not_found' };
        }

        if (reply.reject !== undefined) {
          call.state = 'failed';
          reject(reply.reject);
          return;
        }
        if (reply.hang) return;
        const deliver = () => {
          timer = null;
          resolve(responseFor(call, reply));
        };
        if (reply.delay) timer = later(deliver, reply.delay);
        else deliver();
      });
    }),
  };
  return fake;
}
