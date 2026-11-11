// Test doubles for the task manager (SPEC 6 and 14.4). Owner: G2.
//
//   createVirtualTimers()   a clock whose setTimer / clearTimer / now fit the `deps` of createTasks and createDirector;
//                           time moves only when a test calls advance()
//   createFakeWorkers()     a `createWorker` factory for createTasks; every FakeWorker records what the main thread
//                           posts and speaks the worker protocol of SPEC 4.9, by hand or automatically
//   tick()                  lets every pending promise callback run
//
// By default a FakeWorker answers nothing: the test decides what the worker says and when (ready(), progress(),
// done(), cancelled(), error(), crash(), or the raw emit()). The options make it answer like the real worker.
// This module imports nothing.

/**
 * @typedef {{perftNps:number, speedClass:'fast'|'mid'|'slow'}} FakeSpeed
 * @typedef {{t:'job', id:number, kind:string, payload:unknown}} FakeJobMessage
 * @typedef {{t:'hello', ttBits?:number} | FakeJobMessage | {t:'cancel', id?:number}} FakeMainMessage     main -> worker (SPEC 4.9)
 *
 * @typedef {Object} FakeWorkerOptions
 * @property {boolean} [autoReady]     answer `hello` with `ready` (default false)
 * @property {boolean} [autoAck]       answer a `cancel` of the running job, and a `job` that arrives while another
 *                                     runs, with `{t:'cancelled'}` for the running job, as SPEC 4.9 requires (default false)
 * @property {(job:FakeJobMessage, worker:FakeWorker) => unknown} [respond]
 *                                     called for every job that is still running when its turn comes; a return value
 *                                     other than undefined is sent as the job's `done` data
 * @property {FakeSpeed} [speed]       the calibration reported by `ready` (default mid, 2 000 000 nodes/s)
 * @property {(deliver:() => void) => void} [defer]
 *                                     how an automatic answer is delivered (default queueMicrotask: never inside
 *                                     postMessage, like a real worker; `await tick()` lets it arrive)
 */

/** @type {FakeSpeed} */
const DEFAULT_SPEED = Object.freeze({ perftNps: 2_000_000, speedClass: 'mid' });

/**
 * A stand-in for a module Worker running `src/core/search-worker.js`.
 * Messages are structured-cloned in both directions, as between real threads, so posting something that cannot be
 * cloned throws a DataCloneError here too.
 */
export class FakeWorker {
  /** @type {((event:{data:unknown}) => void)|null} */
  onmessage = null;
  /** @type {((event:{message:string}) => void)|null} */
  onerror = null;
  /** @type {((event:{data:unknown}) => void)|null} */
  onmessageerror = null;

  /** Every message the main thread posted, in order (also after terminate()). @type {FakeMainMessage[]} */
  posted = [];
  /** terminate() was called. */
  terminated = false;
  /** Id of the job this worker considers running: the last job posted that has no terminal message yet. @type {number|null} */
  running = null;

  /** @type {FakeWorkerOptions} */
  #options;

  /** @param {FakeWorkerOptions} [options] */
  constructor(options = {}) {
    this.#options = options;
  }

  // ---- the Worker surface used by tasks.js --------------------------------------------------------------------

  /** @param {FakeMainMessage} message */
  postMessage(message) {
    /** @type {FakeMainMessage} */
    const copy = structuredClone(message);
    this.posted.push(copy);
    if (this.terminated) return;
    if (copy.t === 'hello') {
      if (this.#options.autoReady) this.#auto(() => this.ready());
    } else if (copy.t === 'job') {
      const previous = this.running;
      this.running = copy.id;
      if (previous !== null && this.#options.autoAck) this.#auto(() => this.cancelled(previous));     // latest wins
      const respond = this.#options.respond;
      if (respond) {
        this.#auto(() => {
          if (this.running !== copy.id) return;                // cancelled or superseded meanwhile
          const data = respond(copy, this);
          if (data !== undefined) this.done(copy.id, data);
        });
      }
    } else if (copy.t === 'cancel') {
      const target = this.running;
      if (target !== null && (copy.id === undefined || copy.id === target)) {
        this.running = null;
        if (this.#options.autoAck) this.#auto(() => this.cancelled(target));
      }
    }
  }

  terminate() {
    this.terminated = true;
    this.running = null;
  }

  // ---- what the test makes the worker say ---------------------------------------------------------------------

  /**
   * Delivers one worker -> main message. It is delivered even after terminate(), so a test can check that the
   * task manager drops whatever a terminated worker still says (a real browser delivers nothing then).
   * @param {unknown} data
   */
  emit(data) {
    this.onmessage?.({ data: structuredClone(data) });
  }

  /** @param {FakeSpeed} [speed] */
  ready(speed = this.#options.speed ?? DEFAULT_SPEED) {
    this.emit({ t: 'ready', protocol: 1, speed });
  }

  /** @param {number} id @param {'facts'|'table'|'threat'} stage @param {unknown} [data] */
  progress(id, stage, data = null) {
    this.emit({ t: 'progress', id, kind: this.#kindOf(id), stage, data });
  }

  /** @param {number} id @param {unknown} [data] */
  done(id, data = null) {
    if (this.running === id) this.running = null;
    this.emit({ t: 'done', id, kind: this.#kindOf(id), data });
  }

  /** @param {number} id */
  cancelled(id) {
    if (this.running === id) this.running = null;
    this.emit({ t: 'cancelled', id });
  }

  /** The job failed inside the worker; the worker lives on. @param {number} id @param {string} [message] */
  error(id, message = 'job failed') {
    if (this.running === id) this.running = null;
    this.emit({ t: 'error', id, message });
  }

  /** The worker itself broke: fires `onerror`. @param {string} [message] */
  crash(message = 'worker crashed') {
    this.onerror?.({ message });
  }

  /** A message that could not be deserialized: fires `onmessageerror`. */
  garble() {
    this.onmessageerror?.({ data: null });
  }

  // ---- reading what was posted --------------------------------------------------------------------------------

  /** Every `job` message posted to this worker, in order. @returns {FakeJobMessage[]} */
  get jobs() {
    /** @type {FakeJobMessage[]} */
    const list = [];
    for (const message of this.posted) if (message.t === 'job') list.push(message);
    return list;
  }

  /** The last `job` message posted to this worker, or null. @returns {FakeJobMessage|null} */
  get lastJob() {
    return this.jobs.at(-1) ?? null;
  }

  /** The ids of the `cancel` messages posted to this worker, in order (undefined = "whatever is running"). @returns {(number|undefined)[]} */
  get cancels() {
    /** @type {(number|undefined)[]} */
    const list = [];
    for (const message of this.posted) if (message.t === 'cancel') list.push(message.id);
    return list;
  }

  // ---- internals ----------------------------------------------------------------------------------------------

  /** An automatic answer: delivered later, and never by a terminated worker. @param {() => void} answer */
  #auto(answer) {
    const defer = this.#options.defer ?? queueMicrotask;
    defer(() => {
      if (!this.terminated) answer();
    });
  }

  /** @param {number} id */
  #kindOf(id) {
    return this.jobs.find((job) => job.id === id)?.kind ?? 'analyze';
  }
}

/**
 * The `createWorker` dependency of createTasks, with a record of every worker it made.
 *
 *   const host = createFakeWorkers();
 *   const tasks = createTasks({ getScope, createWorker: host.createWorker, ...clock });
 *   host.current.ready();                         // the worker answers `hello`
 *   const job = host.current.lastJob;             // { t:'job', id, kind, payload }
 *   host.current.done(job.id, result);
 *
 * @param {FakeWorkerOptions} [options] given to every worker it creates
 */
export function createFakeWorkers(options = {}) {
  /** @type {FakeWorker[]} */
  const workers = [];
  const host = {
    /** Every worker created so far, oldest first (terminated ones included). */
    workers,
    /** Number of createWorker calls, the throwing ones included. */
    attempts: 0,
    /** The next `failSpawns` createWorker calls throw (Infinity: every call), like a blocked worker script. */
    failSpawns: 0,
    /** @returns {FakeWorker} */
    createWorker() {
      host.attempts++;
      if (host.failSpawns > 0) {
        host.failSpawns--;
        throw new Error('worker could not be created');
      }
      const worker = new FakeWorker(options);
      workers.push(worker);
      return worker;
    },
    /** The newest worker if it has not been terminated, else null. @returns {FakeWorker|null} */
    get current() {
      const last = workers.at(-1);
      return last && !last.terminated ? last : null;
    },
  };
  return host;
}

/** Resolves after every promise callback that is pending now (and those they queue) has run. @returns {Promise<void>} */
export function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Virtual timers. `setTimer`, `clearTimer` and `now` do not depend on `this`, so they can be passed on their own.
 * Timers fire in order of their due time, then in the order they were set.
 * @param {number} [start] the clock's first reading in ms
 */
export function createVirtualTimers(start = 0) {
  let time = start;
  let lastId = 0;
  /** @type {Map<number, {due:number, run:() => void}>} */
  const queue = new Map();

  /** The timer to fire next among those due at or before `limit`, or null. @param {number} limit */
  const nextDue = (limit) => {
    /** @type {{id:number, due:number, run:() => void}|null} */
    let best = null;
    for (const [id, timer] of queue) {                       // Map order = the order the timers were set
      if (timer.due <= limit && (best === null || timer.due < best.due)) best = { id, due: timer.due, run: timer.run };
    }
    return best;
  };

  /** Fires one timer; false when none is due by `limit`. @param {number} limit */
  const fireNext = (limit) => {
    const timer = nextDue(limit);
    if (!timer) return false;
    queue.delete(timer.id);
    time = Math.max(time, timer.due);
    timer.run();
    return true;
  };

  return {
    /** @returns {number} */
    now: () => time,
    /**
     * @param {(...args:unknown[]) => void} callback
     * @param {number} [ms]
     * @param {...unknown} args
     * @returns {number} the timer id (never 0)
     */
    setTimer(callback, ms = 0, ...args) {
      const id = ++lastId;
      const delay = Number.isFinite(ms) && ms > 0 ? ms : 0;
      queue.set(id, { due: time + delay, run: () => callback(...args) });
      return id;
    },
    /** @param {number} [id] */
    clearTimer(id) {
      if (id !== undefined) queue.delete(id);
    },
    /** Number of timers that are set and have not fired. @returns {number} */
    pending: () => queue.size,
    /**
     * Moves the clock forward by `ms` and fires, synchronously, every timer that falls due on the way (a timer
     * set by a firing timer included). advance(0) fires the timers that are due now.
     * @param {number} [ms]
     */
    advance(ms = 0) {
      const end = time + ms;
      while (fireNext(end)) { /* keep firing */ }
      time = end;
    },
    /**
     * Like advance(), but promise callbacks run after every fired timer and at the end, so code that sets its next
     * timer in an `await` continuation keeps up with the clock.
     * @param {number} [ms]
     * @returns {Promise<void>}
     */
    async advanceAsync(ms = 0) {
      const end = time + ms;
      await tick();
      while (fireNext(end)) await tick();
      time = end;
      await tick();
    },
  };
}
