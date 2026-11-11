/**
 * Message adapter around brain.js (contract section 4.9). This file is the entry of the one persistent engine worker.
 *
 * main -> worker
 *   { t: 'hello', ttBits?: number }
 *   { t: 'job', id: number, kind: 'survey'|'assess'|'opponent'|'analyze', payload: object }
 *   { t: 'cancel', id?: number }                       // without id: cancel whatever is running
 *
 * worker -> main
 *   { t: 'ready', protocol: 1, speed: { perftNps: number, speedClass: 'fast'|'mid'|'slow' } }
 *   { t: 'progress', id, kind, stage: 'facts'|'threat'|'table', data }
 *   { t: 'done', id, kind, data }
 *   { t: 'cancelled', id }
 *   { t: 'error', id, message: string }
 *
 * - One job at a time. A `job` message that arrives while another job runs cancels the running one (latest wins);
 *   the new job starts when the old one has unwound.
 * - Every job id gets exactly one terminal message: `done`, `cancelled` or `error`.
 * - All payloads and results are plain JSON. The worker keeps no game state; the only thing that survives between jobs
 *   is the transposition table.
 * - `hello` builds the brain, runs the calibration and answers `ready`. Jobs posted before `ready` are queued (the last one wins).
 * - The yield used by the search is a MessageChannel round trip, so `job` and `cancel` messages are handled between root moves.
 *
 * Points the contract leaves open, as implemented here:
 * - At most one job waits (for `ready`, or for the running job to unwind). A job that is replaced while it waits never
 *   starts and gets `cancelled` at once. A waiting job is not running: `{t:'cancel', id}` with its id removes it,
 *   `{t:'cancel'}` without an id cancels the running job and removes the waiting one, and a cancel for any other id
 *   is ignored.
 * - The terminal message of a running job is sent when the job has unwound, never earlier. A job that was cancelled
 *   answers `cancelled` even if it had just finished or failed, and sends no progress after the cancel: nothing of a
 *   cancelled job reaches the main thread except that one message.
 * - A `job` message without a numeric id cannot be addressed and is answered with `error` (carrying the id as it came)
 *   without disturbing the running job; a job whose id is that of the running or the waiting job is ignored; an
 *   unknown kind is a job like any other and ends with `error`.
 * - A second `hello` answers `ready` again and keeps the brain (and its transposition table).
 * - Where `setImmediate` exists (Node) the yield uses it: in worker_threads a MessageChannel round trip does not let
 *   the parent's messages in (WAVE1-NOTES, B2 review). In the browser worker it is the MessageChannel round trip.
 * - Besides a dedicated browser worker, the file wires itself inside a Node worker thread (the smoke test of
 *   brain.test.js, tools), where the parent port speaks the same protocol. Importing it anywhere else has no side effect.
 */

import { createBrain } from './brain.js';

/** @import { Brain, JobControl } from './brain.js' */
/** @import { AnalyzeRequest, AssessPayload, OpponentPayload, SurveyPayload } from './types.js' */

/** Version of the message protocol, reported by `ready`. */
const PROTOCOL = 1;

/**
 * The global scope, with the members this file reads from it. It is read through `globalThis` and described here, so that
 * the file type-checks with and without the WebWorker lib: a dedicated browser worker has WorkerGlobalScope, postMessage,
 * onmessage and MessageChannel; a Node worker thread has setImmediate and process.getBuiltinModule.
 */
const scope = /** @type {{
  WorkerGlobalScope?: Function,
  postMessage?: (message:object) => void,
  onmessage?: ((event:MessageEvent) => void)|null,
  setImmediate?: (callback:() => void) => unknown,
  MessageChannel?: new () => {port1:{onmessage:(() => void)|null}, port2:{postMessage:(message:number) => void}},
  process?: {getBuiltinModule?: (id:string) => {isMainThread?:boolean,
    parentPort?:{postMessage:(message:object) => void, on:(event:'message', listener:(data:unknown) => void) => void}|null}|undefined}|null,
}} */ (/** @type {unknown} */ (globalThis));

/** Built by `hello` with createBrain. @type {Brain|null} */
let brain = null;
/** Sends one message to the main thread; set by the wiring at the end of this file. @type {(message:object) => void} */
let post = () => {};
/** The job that is executing. @type {{id:number, ctl:JobControl}|null} */
let running = null;
/** The job that waits for `ready` or for the running job to unwind. @type {{id:number, kind:unknown, payload:unknown}|null} */
let waiting = null;
/** Resolves in a later task of the event loop, after the messages that are already queued. @type {(() => Promise<void>)|null} */
let nextTask = null;

/** @returns {() => Promise<void>} */
function createYield() {
  const immediate = scope.setImmediate;
  if (typeof immediate === 'function') {
    return () => new Promise(resolve => {
      immediate(resolve);
    });
  }
  const Channel = scope.MessageChannel;
  if (typeof Channel === 'function') {
    const channel = new Channel();
    /** @type {(() => void)[]} */
    const resolvers = [];
    channel.port1.onmessage = () => {
      const resolve = resolvers.shift();
      if (resolve !== undefined) resolve();
    };
    return () => new Promise(resolve => {
      resolvers.push(resolve);
      channel.port2.postMessage(0);
    });
  }
  return () => new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

/** @returns {Promise<void>} */
function yieldToMessages() {
  if (nextTask === null) nextTask = createYield();
  return nextTask();
}

/** @param {unknown} error @returns {boolean} the rejection of a cancelled brain job */
function isCancellation(error) {
  return typeof error === 'object' && error !== null && /** @type {{cancelled?:unknown}} */ (error).cancelled === true;
}

/** @param {unknown} error @returns {string} */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The job of a `job` message. The payload is what the main thread posted for that kind (sections 3.2 and 3.4); a payload
 * of another shape makes the job fail, which is answered with `error`.
 * @param {Brain} engine @param {unknown} kind @param {unknown} payload @param {JobControl} ctl
 * @returns {Promise<unknown>}
 */
function execute(engine, kind, payload, ctl) {
  switch (kind) {
    case 'survey': return engine.survey(/** @type {SurveyPayload} */ (payload), ctl);
    case 'assess': return engine.assess(/** @type {AssessPayload} */ (payload), ctl);
    case 'opponent': return engine.opponent(/** @type {OpponentPayload} */ (payload), ctl);
    case 'analyze': return engine.analyze(/** @type {AnalyzeRequest} */ (payload), ctl);
    default: return Promise.reject(new Error(`unknown job kind: ${String(kind)}`));
  }
}

/** Start the waiting job, if the brain is ready and nothing runs. @returns {void} */
function startWaiting() {
  if (brain === null || running !== null || waiting === null) return;
  const engine = brain;
  const { id, kind, payload } = waiting;
  waiting = null;
  /** @type {JobControl} */
  const ctl = {
    cancelled: false,
    yield: yieldToMessages,
    onProgress(stage, data) {
      if (!ctl.cancelled) post({ t: 'progress', id, kind, stage, data });
    },
  };
  running = { id, ctl };
  /** The job has unwound: its one terminal message, then the next job. @param {object} message */
  const settle = message => {
    running = null;
    try {
      post(message);
    } catch (error) {
      post({ t: 'error', id, message: `the result could not be sent: ${messageOf(error)}` });
    }
    startWaiting();
  };
  /** @type {Promise<unknown>} */
  let work;
  try {
    work = execute(engine, kind, payload, ctl);
  } catch (error) {
    work = Promise.reject(error);
  }
  work.then(
    data => settle(ctl.cancelled ? { t: 'cancelled', id } : { t: 'done', id, kind, data }),
    error => settle(ctl.cancelled || isCancellation(error) ? { t: 'cancelled', id } : { t: 'error', id, message: messageOf(error) }),
  );
}

/** A job that waited is given up before it started. @returns {void} */
function dropWaiting() {
  if (waiting === null) return;
  const { id } = waiting;
  waiting = null;
  post({ t: 'cancelled', id });
}

/**
 * Handle one message from the main thread.
 * @param {unknown} data
 * @returns {void}
 */
function handle(data) {
  if (typeof data !== 'object' || data === null) return;
  const message = /** @type {{t?:unknown, id?:unknown, kind?:unknown, payload?:unknown, ttBits?:unknown}} */ (data);
  if (message.t === 'hello') {
    if (brain === null) brain = createBrain(typeof message.ttBits === 'number' ? { ttBits: message.ttBits } : undefined);
    post({ t: 'ready', protocol: PROTOCOL, speed: { perftNps: brain.speed.perftNps, speedClass: brain.speed.speedClass } });
    startWaiting();
  } else if (message.t === 'job') {
    const id = message.id;
    if (typeof id !== 'number' || Number.isNaN(id)) {
      post({ t: 'error', id, message: 'a job needs a numeric id' });
      return;
    }
    if ((running !== null && running.id === id) || (waiting !== null && waiting.id === id)) return;
    dropWaiting();                                              // the last one wins
    waiting = { id, kind: message.kind, payload: message.payload };
    if (running !== null) running.ctl.cancelled = true;         // latest wins: the new job starts when this one has unwound
    else startWaiting();
  } else if (message.t === 'cancel') {
    const id = message.id;
    if (id === undefined || id === null) {
      dropWaiting();
      if (running !== null) running.ctl.cancelled = true;
    } else if (waiting !== null && waiting.id === id) {
      dropWaiting();
    } else if (running !== null && running.id === id) {
      running.ctl.cancelled = true;
    }
  }
}

/**
 * The `onmessage` handler of the dedicated worker.
 * @param {MessageEvent} event
 * @returns {void}
 */
function onMessage(event) {
  handle(event.data);
}

// Wire the protocol only inside a dedicated worker. Importing this file anywhere else (Node tests, the build's import crawl)
// has no side effect.
if (typeof scope.WorkerGlobalScope === 'function' && scope instanceof scope.WorkerGlobalScope) {
  post = message => {
    scope.postMessage?.(message);                               // a worker scope always has it
  };
  scope.onmessage = onMessage;
} else if (typeof scope.process === 'object' && scope.process !== null && typeof scope.process.getBuiltinModule === 'function') {
  // A Node worker thread: the parent port carries the same messages (the data itself, not an event).
  const threads = scope.process.getBuiltinModule('node:worker_threads');
  if (threads && threads.isMainThread === false && threads.parentPort) {
    const port = threads.parentPort;
    post = message => port.postMessage(message);
    port.on('message', handle);
  }
}
