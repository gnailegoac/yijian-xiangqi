// Task manager (SPEC 4.19, rules in section 6): the only module that touches Worker objects and the only place
// asynchronous work is registered. Events: none (callbacks only: onProgress, onWorker). Owner: G2.
//
// The invariant of section 6: undo / restart / retract / confirm cancel in-flight worker and LLM work, and a stale
// result can never touch a newer position. Three structural rules give it, whatever the callers do:
//   - a stopped task is settled first (alive() false, every gate closed), before any transport is touched (6.3);
//   - a worker message is delivered only to the live job, only while it runs, only from the live worker (6.4);
//   - ids are never reused, so a late message can never be taken for a newer job's.

/** @import { Scope, Lifetime, Outcome, JobSpec, RunSpec, RunContext, TaskHandle } from './types.js' */

const BACKSTOP_MS = 150;                 // 6.3: a stopped job's terminal message must arrive within this time
const SPAWN_LIMIT_MS = 5000;             // 6.5: `ready` must arrive within this time
const SPAWN_RETRY_MS = [0, 250, 1000];   // 6.5: wait before the retry that follows the n-th consecutive failure
const SPAWN_FAILURES_DEAD = 3;           // 6.5: the third consecutive failure marks the engine dead

/**
 * One registered piece of asynchronous work. `job` is the spec of a worker job and null for a `run` task.
 * States: held (a worker job that waits for the worker's `ready`), running, settled.
 *
 * @param {number} id
 * @param {Lifetime} lifetime
 * @param {Scope} scope             the session scope at creation (copied)
 * @param {JobSpec|null} job
 * @param {string|undefined} channel
 */
function createRecord(id, lifetime, scope, job, channel) {
  /** @type {(outcome: Outcome<unknown>) => void} */
  let resolve = () => {};
  /** @type {Promise<Outcome<unknown>>} */
  const done = new Promise((settle) => { resolve = settle; });
  return {
    id,
    lifetime,
    job,
    channel,
    scope: { game: scope.game, position: scope.position, trial: scope.trial },
    state: /** @type {'held'|'running'|'settled'} */ ('held'),
    controller: /** @type {AbortController|null} */ (null),
    timer: /** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined),
    idleTimer: /** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined),
    done,
    resolve,
  };
}

/** @param {unknown} thrown @returns {Error} */
function toError(thrown) {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/**
 * The returned object:
 *   job        posts a worker job (one live job at a time, latest wins)
 *   run        registers any other asynchronous work (an LLM reply, a fetch)
 *   sync       called on every session `scope` event, before anything else reacts
 *   liveJob    the live worker job; tool = it was started by the LLM tool executor (JobSpec.tool)
 *   restart    after 'dead': try to spawn again
 *
 * @param {{ getScope: () => Scope,
 *           createWorker: () => Worker,
 *           setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout, now?: () => number,
 *           onWorker?: (e:'ready'|'respawn'|'dead', info?:{speedClass:'fast'|'mid'|'slow', perftNps:number}) => void }} deps
 * @returns {{ job<T>(spec:JobSpec): TaskHandle<T>,
 *             run<T>(spec:RunSpec, fn:(ctx:RunContext) => Promise<T>): TaskHandle<T>,
 *             sync(scope?:Scope): void,
 *             cancelChannel(name:string): void,
 *             cancelAll(): void,
 *             liveJob(): {kind:JobSpec['kind'], lifetime:Lifetime, tool:boolean}|null,
 *             restart(): void,
 *             stats(): {spawned:number, terminated:number, lateDrops:number, live:number, dead:boolean},
 *             dispose(): void }}
 */
export function createTasks(deps) {
  const getScope = deps.getScope;
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const report = deps.onWorker ?? (() => {});

  const counters = { spawned: 0, terminated: 0, lateDrops: 0 };
  let nextId = 1;                       // one counter for jobs and run tasks; never reset, so no id is ever reused

  /** Every task that is not settled, by id. @type {Map<number, ReturnType<typeof createRecord>>} */
  const live = new Map();
  /** The live worker job (held or running): all worker jobs form one channel. @type {ReturnType<typeof createRecord>|null} */
  let current = null;

  /** The live worker. A new object per spawn: its identity tells a message of a terminated worker apart. @type {{worker: Worker}|null} */
  let slot = null;
  let ready = false;                    // the live worker has answered `hello`
  let failures = 0;                     // consecutive spawn failures
  let dead = false;
  let disposed = false;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let readyTimer;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let retryTimer;
  /** Backstop timers of the jobs that were stopped while the live worker ran them, by job id. @type {Map<number, ReturnType<typeof setTimeout>>} */
  const unacked = new Map();

  // -------------------------------------------------------------------------------------------------------------
  // Settling
  // -------------------------------------------------------------------------------------------------------------

  /** 6.3 step 1: from here on alive() is false and every gate()d callback is a no-op. @param {ReturnType<typeof createRecord>} task */
  function retire(task) {
    task.state = 'settled';
    live.delete(task.id);
    if (current === task) current = null;
  }

  /** 6.3 step 4. @param {ReturnType<typeof createRecord>} task @param {Outcome<unknown>} outcome */
  function finish(task, outcome) {
    clearTimer(task.timer);
    clearTimer(task.idleTimer);
    task.timer = undefined;
    task.idleTimer = undefined;
    task.resolve(outcome);
  }

  /**
   * 6.3, synchronous and in the contract's order. (A job that is superseded by a newer job does not come through
   * here: `job()` posts the newer job instead of the cancel message.)
   * @param {ReturnType<typeof createRecord>} task
   * @param {'cancelled'|'superseded'|'timeout'} reason
   */
  function stop(task, reason) {
    if (task.state === 'settled') return;
    const posted = task.job !== null && task.state === 'running';
    retire(task);
    if (posted) {
      expectAck(task.id);               // armed before the message leaves
      send({ t: 'cancel', id: task.id });
    }
    task.controller?.abort();
    finish(task, { ok: false, reason });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Worker transport
  // -------------------------------------------------------------------------------------------------------------

  /**
   * @param {{t:'hello'} | {t:'cancel', id:number} | {t:'job', id:number, kind:JobSpec['kind'], payload:unknown}} message
   * @returns {Error|null} null when the message left
   */
  function send(message) {
    if (!slot) return new Error('no worker');
    try {
      slot.worker.postMessage(message);
      return null;
    } catch (thrown) {
      return toError(thrown);
    }
  }

  /**
   * Hands a job to the live worker and starts its timeout. False when the message could not be posted (a payload
   * that cannot be cloned): the worker never saw the job and the job has failed with reason 'error'.
   * @param {ReturnType<typeof createRecord>} task
   */
  function post(task) {
    const spec = task.job;
    if (!spec) return false;
    task.state = 'running';
    task.timer = setTimer(() => expire(task), spec.timeoutMs);
    const failure = send({ t: 'job', id: task.id, kind: spec.kind, payload: spec.payload });
    if (!failure) return true;
    retire(task);
    finish(task, { ok: false, reason: 'error', error: failure });
    return false;
  }

  /** A job exceeded its timeoutMs: stop it first, then terminate and respawn (6.3). @param {ReturnType<typeof createRecord>} task */
  function expire(task) {
    if (task.state !== 'running') return;
    stop(task, 'timeout');
    replaceWorker();
  }

  /** Starts the backstop for a job the live worker must still acknowledge with a terminal message. @param {number} id */
  function expectAck(id) {
    unacked.set(id, setTimer(() => {
      if (!unacked.has(id)) return;
      unacked.delete(id);
      replaceWorker();
    }, BACKSTOP_MS));
  }

  /** The terminal message of a stopped job arrived in time. @param {number} id */
  function acknowledge(id) {
    const timer = unacked.get(id);
    if (timer === undefined) return;
    clearTimer(timer);
    unacked.delete(id);
  }

  /**
   * Every message of every worker comes through here.
   * @param {{worker: Worker}} from
   * @param {{t?:string, id?:number, stage?:'facts'|'table'|'threat', data?:unknown, message?:string,
   *          speed?:{perftNps:number, speedClass:'fast'|'mid'|'slow'}}|null|undefined} msg
   */
  function receive(from, msg) {
    if (from !== slot) {                // any message of a terminated worker
      counters.lateDrops++;
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'ready') {
      greeted(msg.speed);
      return;
    }
    const task = current;
    if (!task || task.state !== 'running' || msg.id !== task.id) {        // 6.4 layer 2: the dispatch gate
      counters.lateDrops++;
      if ((msg.t === 'done' || msg.t === 'cancelled' || msg.t === 'error') && typeof msg.id === 'number') acknowledge(msg.id);
      return;
    }
    if (msg.t === 'progress') {
      if (msg.stage) task.job?.onProgress?.(msg.stage, msg.data);
    } else if (msg.t === 'done') {
      retire(task);
      finish(task, { ok: true, value: msg.data });
    } else if (msg.t === 'error') {     // fails the job, keeps the worker (6.5)
      retire(task);
      finish(task, { ok: false, reason: 'error', error: new Error(msg.message || 'worker error') });
    } else if (msg.t === 'cancelled') { // the worker gave the job up on its own
      retire(task);
      finish(task, { ok: false, reason: 'cancelled' });
    }
  }

  /** The live worker answered `hello`. @param {{perftNps:number, speedClass:'fast'|'mid'|'slow'}|undefined} speed */
  function greeted(speed) {
    if (ready) return;
    ready = true;
    clearTimer(readyTimer);
    readyTimer = undefined;
    failures = 0;
    if (current) post(current);         // the job that was held (the last one posted before `ready`)
    if (speed) report('ready', { speedClass: speed.speedClass, perftNps: speed.perftNps });
    else report('ready');
  }

  /** worker.onerror / onmessageerror. @param {{worker: Worker}} from @param {string} message */
  function crashed(from, message) {
    if (from !== slot) return;
    if (!ready) {                       // an error before `ready` is a spawn failure
      terminate();
      spawnFailed();
      return;
    }
    const task = current;
    if (task) {
      retire(task);
      finish(task, { ok: false, reason: 'error', error: new Error(message || 'worker error') });
    }
    replaceWorker();
  }

  // -------------------------------------------------------------------------------------------------------------
  // Worker lifecycle
  // -------------------------------------------------------------------------------------------------------------

  function spawn() {
    retryTimer = undefined;
    if (disposed || dead || slot) return;
    /** @type {Worker} */
    let worker;
    try {
      worker = deps.createWorker();
    } catch {
      spawnFailed();
      return;
    }
    counters.spawned++;
    const mine = { worker };
    slot = mine;
    ready = false;
    worker.onmessage = (event) => receive(mine, event.data);
    worker.onerror = (event) => crashed(mine, event.message);
    worker.onmessageerror = () => crashed(mine, 'worker message could not be read');
    readyTimer = setTimer(() => {
      if (slot !== mine || ready) return;
      terminate();
      spawnFailed();
    }, SPAWN_LIMIT_MS);
    if (send({ t: 'hello' }) && slot === mine) {
      terminate();
      spawnFailed();
    }
  }

  function spawnFailed() {
    failures++;
    if (failures >= SPAWN_FAILURES_DEAD) {
      dead = true;
      const task = current;             // live jobs resolve at once; future ones do in job()
      if (task) {
        retire(task);
        finish(task, { ok: false, reason: 'error' });
      }
      report('dead');
      return;
    }
    retryTimer = setTimer(spawn, SPAWN_RETRY_MS[failures - 1]);
  }

  /** Ends the live worker, if any. Whatever it still says is dropped by the dispatch gate. */
  function terminate() {
    clearTimer(readyTimer);
    readyTimer = undefined;
    for (const timer of unacked.values()) clearTimer(timer);
    unacked.clear();
    const old = slot;
    if (!old) return;
    slot = null;
    ready = false;
    counters.terminated++;
    try {
      old.worker.terminate();
    } catch {
      // a worker that cannot be terminated is abandoned all the same
    }
  }

  /** Terminate and respawn; the pending job (if any) is posted again after `ready` (6.3). */
  function replaceWorker() {
    terminate();
    const pending = current;
    if (pending) {
      clearTimer(pending.timer);
      pending.timer = undefined;
      pending.state = 'held';
    }
    try {
      report('respawn');
    } finally {
      spawn();                          // also when the callback throws: the engine must come back
    }
  }

  spawn();                              // 6.5: created at createTasks(), so the module graph is compiled before the first move

  // -------------------------------------------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------------------------------------------

  return {
    /** @template T @param {JobSpec} spec @returns {TaskHandle<T>} */
    job(spec) {
      const task = createRecord(nextId++, spec.lifetime, getScope(), spec, undefined);
      /** @type {TaskHandle<T>} */
      const handle = {
        id: task.id,
        done: /** @type {Promise<Outcome<T>>} */ (task.done),
        cancel: () => stop(task, 'cancelled'),
        alive: () => task.state !== 'settled',
      };
      if (dead || disposed) {           // 6.5: on a dead engine a job resolves at once
        task.state = 'settled';
        task.resolve({ ok: false, reason: disposed ? 'cancelled' : 'error' });
        return handle;
      }
      const old = current;              // latest wins: 6.3 for the superseded job, with the newer job as the cancel
      const oldPosted = old !== null && old.state === 'running';
      if (old) {
        retire(old);
        if (oldPosted) expectAck(old.id);
      }
      live.set(task.id, task);
      current = task;
      const sent = ready && post(task); // not ready: held until `ready`
      if (old) {
        if (oldPosted && !sent) send({ t: 'cancel', id: old.id });
        finish(old, { ok: false, reason: 'superseded' });
      }
      return handle;
    },

    /** @template T @param {RunSpec} spec @param {(ctx:RunContext) => Promise<T>} fn @returns {TaskHandle<T>} */
    run(spec, fn) {
      const task = createRecord(nextId++, spec.lifetime, getScope(), null, spec.channel);
      const controller = new AbortController();
      task.controller = controller;
      const alive = () => task.state === 'running';
      /** @type {TaskHandle<T>} */
      const handle = {
        id: task.id,
        done: /** @type {Promise<Outcome<T>>} */ (task.done),
        cancel: () => stop(task, 'cancelled'),
        alive,
        signal: controller.signal,
      };
      if (disposed) {
        task.state = 'settled';
        controller.abort();
        task.resolve({ ok: false, reason: 'cancelled' });
        return handle;
      }
      task.state = 'running';
      live.set(task.id, task);
      if (spec.channel !== undefined) {   // at most one live task per channel
        for (const other of [...live.values()]) {
          if (other !== task && other.job === null && other.channel === spec.channel) stop(other, 'superseded');
        }
        // An abort listener of a superseded task may itself have started a task on this channel (that call is the
        // later one, so it has superseded this task) or cancelled everything: then `fn` is never called.
        if (!alive()) return handle;
      }

      /** @type {RunContext['gate']} */
      const gate = (callback) => {
        /** @this {unknown} @param {unknown[]} args */
        const gated = function (...args) {
          return alive() ? callback.apply(this, args) : undefined;
        };
        return /** @type {typeof callback} */ (/** @type {unknown} */ (gated));
      };
      const idleMs = spec.idleMs ?? 0;
      const touch = () => {
        if (!alive() || !(idleMs > 0)) return;
        clearTimer(task.idleTimer);
        task.idleTimer = setTimer(() => stop(task, 'timeout'), idleMs);
      };
      /** @param {Outcome<unknown>} outcome */
      const settle = (outcome) => {
        if (task.state === 'settled') return;
        retire(task);
        if (!outcome.ok) controller.abort();
        finish(task, outcome);
      };

      const timeoutMs = spec.timeoutMs ?? 0;
      if (timeoutMs > 0) task.timer = setTimer(() => stop(task, 'timeout'), timeoutMs);
      touch();
      /** @type {Promise<T>} */
      let work;
      try {
        work = Promise.resolve(fn({ signal: controller.signal, alive, gate, touch }));
      } catch (thrown) {
        work = Promise.reject(thrown);
      }
      work.then(
        (value) => settle({ ok: true, value }),
        (thrown) => settle({ ok: false, reason: 'error', error: toError(thrown) }),
      );
      return handle;
    },

    sync(scope = getScope()) {
      for (const task of [...live.values()]) {
        if (task.scope.game !== scope.game) stop(task, 'cancelled');                                  // new game, restore
        else if (task.lifetime === 'game') continue;
        else if (task.scope.position !== scope.position) stop(task, 'cancelled');                     // confirm, rival moved, undo, resign
        else if (task.lifetime === 'trial' && task.scope.trial !== scope.trial) stop(task, 'cancelled');   // retract, trial replaced
      }
    },

    cancelChannel(name) {
      for (const task of [...live.values()]) {
        if (task.job === null && task.channel === name) stop(task, 'cancelled');
      }
    },

    cancelAll() {
      for (const task of [...live.values()]) stop(task, 'cancelled');
    },

    liveJob() {
      const task = current;
      const spec = task ? task.job : null;
      return task && spec ? { kind: spec.kind, lifetime: task.lifetime, tool: spec.tool === true } : null;
    },

    restart() {
      if (!dead || disposed) return;
      dead = false;
      failures = 0;
      spawn();
    },

    stats() {
      return { spawned: counters.spawned, terminated: counters.terminated, lateDrops: counters.lateDrops, live: live.size, dead };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const task of [...live.values()]) stop(task, 'cancelled');
      clearTimer(retryTimer);
      retryTimer = undefined;
      terminate();
    },
  };
}
