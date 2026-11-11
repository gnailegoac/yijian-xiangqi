// Task manager tests (SPEC 14.4; rules in section 6; worker messages in 4.9). Fake Worker, virtual timers.
// The first eleven tests carry the titles of 14.4. The rest prove the remaining rules of section 6 and the helpers.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createTasks } from '../../../src/game/tasks.js';
import { createFakeWorkers, createVirtualTimers, tick } from '../../helpers/fake-worker.js';

const SPEED = { perftNps: 3_400_000, speedClass: 'fast' };

// Job timeouts as SPEC 4.8.1 gives them for the `mid` plan: 2 * budget + 500.
const SURVEY_MS = 2 * 1500 + 500;
const ASSESS_MS = 2 * 400 + 500;
const OPPONENT_MS = 2 * (700 + 350) + 500;

/**
 * A task manager on a fake worker and a virtual clock. `scope` is the object getScope() returns: a test changes it
 * the way a session command would and then calls tasks.sync(scope). `watch(e)` is called inside every onWorker call.
 */
function rig({ ready = true, failSpawns = 0, workers = {}, watch = null } = {}) {
  const clock = createVirtualTimers();
  const host = createFakeWorkers({ speed: SPEED, ...workers });
  host.failSpawns = failSpawns;
  const scope = { game: 1, position: 1, trial: 0 };
  const events = [];
  const tasks = createTasks({
    getScope: () => scope,
    createWorker: host.createWorker,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
    onWorker: (e, info) => {
      events.push(info === undefined ? e : [e, info]);
      watch?.(e);
    },
  });
  if (ready && host.current) host.current.ready();
  return { clock, host, scope, events, tasks };
}

const job = (over = {}) => ({ kind: 'survey', payload: { fen: 'start' }, lifetime: 'position', timeoutMs: SURVEY_MS, ...over });
const never = () => new Promise(() => {});

/** 'pending', or the outcome the handle has resolved with. */
async function outcome(handle) {
  let seen = 'pending';
  handle.done.then((o) => { seen = o; });
  await tick();
  return seen;
}

/** 'live', 'ok' or the fail reason, for each handle. */
async function fates(...handles) {
  const list = [];
  for (const handle of handles) {
    const o = await outcome(handle);
    list.push(o === 'pending' ? 'live' : o.ok ? 'ok' : o.reason);
  }
  return list;
}

// -----------------------------------------------------------------------------------------------------------------
// SPEC 14.4
// -----------------------------------------------------------------------------------------------------------------

test('a done or progress for a cancelled id is dropped and counted', async () => {
  const { tasks, host, scope, clock } = rig();
  const seen = [];
  const rival = tasks.job(job({ kind: 'opponent', timeoutMs: OPPONENT_MS, onProgress: (stage, data) => seen.push([stage, data]) }));
  const w = host.current;
  const id = w.lastJob.id;
  assert.equal(id, rival.id);

  w.progress(id, 'table', 'depth 2');
  assert.deepEqual(seen, [['table', 'depth 2']], 'progress is delivered while the job runs');
  assert.equal(tasks.stats().lateDrops, 0);

  scope.position = 2;                                     // undo while the rival thinks
  tasks.sync(scope);
  assert.equal(rival.alive(), false);
  assert.deepEqual(w.cancels, [id]);

  w.progress(id, 'table', 'depth 3');                     // both were already queued in the event loop
  w.done(id, { move: 'LATE' });
  assert.deepEqual(seen, [['table', 'depth 2']], 'nothing reaches the callback after the cancel');
  assert.deepEqual(await outcome(rival), { ok: false, reason: 'cancelled' });
  assert.equal(tasks.stats().lateDrops, 2);

  // The same for a superseded id while a newer job runs: the old messages reach neither job.
  const seenNew = [];
  const survey = tasks.job(job({ onProgress: (stage, data) => seenNew.push([stage, data]) }));
  const assess = tasks.job(job({ kind: 'assess', lifetime: 'trial', timeoutMs: ASSESS_MS, onProgress: (stage, data) => seenNew.push([stage, data]) }));
  w.progress(survey.id, 'table', 'old table');
  w.done(survey.id, 'old survey');
  assert.deepEqual(seenNew, []);
  assert.equal(await outcome(assess), 'pending', "the old job's done does not resolve the newer job");
  assert.equal(tasks.stats().lateDrops, 4);

  // Both late `done`s were the terminal messages of their jobs, so the worker is kept.
  clock.advance(1000);
  assert.equal(w.terminated, false);
  assert.equal(tasks.stats().terminated, 0);
});

test("posting a job supersedes the live one; the old handle resolves with 'superseded'", async () => {
  const { tasks, host, clock } = rig();
  const seenOld = [];
  const seenNew = [];
  const survey = tasks.job(job({ kind: 'survey', onProgress: (...args) => seenOld.push(args) }));
  const assess = tasks.job(job({ kind: 'assess', payload: { move: '7747' }, lifetime: 'trial', timeoutMs: ASSESS_MS, onProgress: (...args) => seenNew.push(args) }));
  const w = host.current;

  assert.equal(survey.alive(), false, 'synchronously');
  assert.equal(assess.alive(), true);
  assert.deepEqual(await outcome(survey), { ok: false, reason: 'superseded' });

  // The newer job is the cancellation: the worker is latest-wins, no cancel message is sent.
  assert.deepEqual(w.posted, [
    { t: 'hello' },
    { t: 'job', id: survey.id, kind: 'survey', payload: { fen: 'start' } },
    { t: 'job', id: assess.id, kind: 'assess', payload: { move: '7747' } },
  ]);
  assert.deepEqual(tasks.liveJob(), { kind: 'assess', lifetime: 'trial', tool: false });
  assert.equal(tasks.stats().live, 1);

  w.cancelled(survey.id);                                 // the worker unwound the old job
  w.progress(assess.id, 'facts', 'new');
  w.done(assess.id, 'assessed');
  assert.deepEqual(seenOld, []);
  assert.deepEqual(seenNew, [['facts', 'new']]);
  assert.deepEqual(await outcome(assess), { ok: true, value: 'assessed' });
  assert.equal(tasks.liveJob(), null);
  assert.equal(tasks.stats().live, 0);

  clock.advance(1000);
  assert.equal(w.terminated, false, 'acknowledged in time: no backstop');
});

test('no terminal message within 150 ms terminates and respawns the worker; the pending job is re-posted after ready', async () => {
  // Without a pending job.
  {
    const { tasks, host, clock, events } = rig();
    const survey = tasks.job(job());
    const w1 = host.current;
    survey.cancel();
    assert.deepEqual(w1.cancels, [survey.id]);
    clock.advance(149);
    assert.equal(w1.terminated, false);
    clock.advance(1);
    assert.equal(w1.terminated, true);
    assert.equal(host.workers.length, 2);
    assert.deepEqual(host.current.posted, [{ t: 'hello' }], 'the new worker is greeted');
    assert.deepEqual(tasks.stats(), { spawned: 2, terminated: 1, lateDrops: 0, live: 0, dead: false });
    assert.deepEqual(events, [['ready', SPEED], 'respawn']);
  }

  // With a pending job: the worker never acknowledges the superseded survey.
  {
    const { tasks, host, clock } = rig();
    const survey = tasks.job(job());
    const assess = tasks.job(job({ kind: 'assess', payload: { move: '7747' }, lifetime: 'trial', timeoutMs: ASSESS_MS }));
    const w1 = host.current;
    assert.deepEqual(w1.cancels, []);
    clock.advance(149);
    assert.equal(w1.terminated, false);
    clock.advance(1);
    assert.equal(w1.terminated, true);
    const w2 = host.current;
    assert.notEqual(w2, w1);
    assert.deepEqual(w2.posted, [{ t: 'hello' }], 'the pending job waits for ready');
    assert.equal(assess.alive(), true);
    assert.deepEqual(tasks.liveJob(), { kind: 'assess', lifetime: 'trial', tool: false });

    w1.done(assess.id, 'from the terminated worker');     // any message of a terminated worker is dropped
    assert.equal(await outcome(assess), 'pending');
    assert.equal(tasks.stats().lateDrops, 1);
    w2.done(assess.id, 'for a job the worker was never given');     // the live job, but it is not running yet
    assert.equal(await outcome(assess), 'pending');
    assert.equal(tasks.stats().lateDrops, 2);

    w2.ready();
    assert.deepEqual(w2.posted, [{ t: 'hello' }, { t: 'job', id: assess.id, kind: 'assess', payload: { move: '7747' } }]);
    w2.done(assess.id, 'assessed');
    assert.deepEqual(await outcome(assess), { ok: true, value: 'assessed' });
    assert.deepEqual(await outcome(survey), { ok: false, reason: 'superseded' });
  }

  // Each of the three terminal messages stops the backstop.
  for (const answer of ['cancelled', 'done', 'error']) {
    const { tasks, host, clock } = rig();
    const survey = tasks.job(job());
    const w = host.current;
    survey.cancel();
    clock.advance(149);
    w[answer](survey.id);
    assert.equal(clock.pending(), 0, `${answer}: the backstop timer is gone`);
    clock.advance(10_000);
    assert.equal(w.terminated, false, answer);
    assert.equal(tasks.stats().terminated, 0, answer);
  }

  // A progress message is not a terminal message.
  {
    const { tasks, host, clock } = rig();
    const survey = tasks.job(job());
    const w = host.current;
    survey.cancel();
    clock.advance(100);
    w.progress(survey.id, 'table', 'still searching');
    clock.advance(50);
    assert.equal(w.terminated, true);
  }
});

test('sync: retract cancels trial-lifetime work only; confirm and undo cancel position- and trial-lifetime work; new game cancels everything; game-lifetime work survives undo', async () => {
  const { tasks, host, scope } = rig();
  const w = host.current;

  // The child's turn at position 1 with trial 7 on the board.
  scope.trial = 7;
  const game = tasks.run({ lifetime: 'game' }, never);
  const position = tasks.run({ lifetime: 'position' }, never);
  const reply7 = tasks.run({ lifetime: 'trial', channel: 'coach' }, never);
  const assess7 = tasks.job(job({ kind: 'assess', lifetime: 'trial', timeoutMs: ASSESS_MS }));

  tasks.sync(scope);                                      // a scope event that changes nothing cancels nothing
  assert.deepEqual(await fates(game, position, reply7, assess7), ['live', 'live', 'live', 'live']);

  // retract: trial -> 0
  scope.trial = 0;
  tasks.sync(scope);
  assert.deepEqual([reply7.alive(), assess7.alive()], [false, false], 'synchronously');
  assert.deepEqual(await fates(game, position, reply7, assess7), ['live', 'live', 'cancelled', 'cancelled']);
  assert.deepEqual(w.cancels, [assess7.id]);
  assert.equal(reply7.signal.aborted, true);
  assert.equal(position.signal.aborted, false);

  // tryMove replacing a trial: trial 8 -> 9
  scope.trial = 8;
  const reply8 = tasks.run({ lifetime: 'trial', channel: 'coach' }, never);
  const assess8 = tasks.job(job({ kind: 'assess', lifetime: 'trial', timeoutMs: ASSESS_MS }));
  scope.trial = 9;
  tasks.sync(scope);
  assert.deepEqual(await fates(game, position, reply8, assess8), ['live', 'live', 'cancelled', 'cancelled']);

  // confirm: position + 1, trial -> 0. Everything bound to P goes: survey, coach reply, position-lifetime work.
  const reply9 = tasks.run({ lifetime: 'trial', channel: 'coach' }, never);
  const survey = tasks.job(job({ kind: 'survey', lifetime: 'position' }));
  scope.position = 2;
  scope.trial = 0;
  tasks.sync(scope);
  assert.deepEqual(await fates(game, position, reply9, survey), ['live', 'cancelled', 'cancelled', 'cancelled']);
  assert.equal(position.signal.aborted, true);

  // undo while the rival thinks: position + 1. Called without an argument: sync reads getScope().
  const rival = tasks.job(job({ kind: 'opponent', lifetime: 'position', timeoutMs: OPPONENT_MS }));
  const trialBound = tasks.run({ lifetime: 'trial' }, never);
  const positionBound = tasks.run({ lifetime: 'position' }, never);
  scope.position = 3;
  tasks.sync();
  assert.deepEqual(await fates(game, rival, trialBound, positionBound), ['live', 'cancelled', 'cancelled', 'cancelled']);
  assert.equal(game.signal.aborted, false, 'game-lifetime work survives undo');
  assert.equal(tasks.stats().live, 1);

  // new game: game + 1
  const position3 = tasks.run({ lifetime: 'position' }, never);
  const survey3 = tasks.job(job());
  scope.game = 2;
  scope.position = 4;
  tasks.sync(scope);
  assert.deepEqual(await fates(game, position3, survey3), ['cancelled', 'cancelled', 'cancelled']);
  assert.equal(game.signal.aborted, true);
  assert.equal(tasks.stats().live, 0);
  assert.equal(tasks.liveJob(), null);

  // The game id alone decides: a restore that lands on the same position and trial numbers still cancels everything.
  const game2 = tasks.run({ lifetime: 'game' }, never);
  const trial2 = tasks.run({ lifetime: 'trial' }, never);
  scope.game = 3;
  tasks.sync(scope);
  assert.deepEqual(await fates(game2, trial2), ['cancelled', 'cancelled']);
});

test('job timeout stops the job and respawns', async () => {
  const aliveAtRespawn = [];
  let assess = null;
  const { tasks, host, clock, events } = rig({ watch: (e) => { if (e === 'respawn') aliveAtRespawn.push(assess.alive()); } });
  assess = tasks.job(job({ kind: 'assess', lifetime: 'trial', timeoutMs: ASSESS_MS }));
  const w1 = host.current;
  clock.advance(ASSESS_MS - 1);
  assert.equal(assess.alive(), true);
  assert.equal(w1.terminated, false);
  clock.advance(1);
  assert.equal(assess.alive(), false);
  assert.deepEqual(aliveAtRespawn, [false], 'the job is stopped first, then the worker is replaced');
  assert.deepEqual(await outcome(assess), { ok: false, reason: 'timeout' });
  assert.equal(w1.terminated, true, 'terminated at once, not after the backstop');
  assert.equal(host.workers.length, 2);
  assert.deepEqual(host.current.posted, [{ t: 'hello' }]);
  assert.equal(tasks.liveJob(), null);
  assert.deepEqual(tasks.stats(), { spawned: 2, terminated: 1, lateDrops: 0, live: 0, dead: false });

  w1.done(assess.id, 'LATE');                             // the answer that came too late
  assert.equal(tasks.stats().lateDrops, 1);
  assert.deepEqual(await outcome(assess), { ok: false, reason: 'timeout' });

  // The new worker serves the next job.
  const w2 = host.current;
  const survey = tasks.job(job());
  w2.ready();
  assert.deepEqual(w2.jobs.map((m) => m.id), [survey.id]);
  w2.done(survey.id, 'survey');
  assert.deepEqual(await outcome(survey), { ok: true, value: 'survey' });
  assert.deepEqual(events, [['ready', SPEED], 'respawn', ['ready', SPEED]]);

  // A job that finished in time leaves no timer behind.
  clock.advance(60_000);
  assert.equal(w2.terminated, false);
  assert.equal(tasks.stats().terminated, 1);
});

test('run: channel supersede; idle timeout with touch; gate() callbacks are silent after cancel; the signal aborts', async () => {
  // channel supersede
  {
    const { tasks } = rig();
    const first = tasks.run({ lifetime: 'position', channel: 'coach', timeoutMs: 21000 }, never);
    const elsewhere = tasks.run({ lifetime: 'position', channel: 'other' }, never);
    const unnamed = tasks.run({ lifetime: 'position' }, never);
    const second = tasks.run({ lifetime: 'trial', channel: 'coach', timeoutMs: 21000 }, never);
    assert.equal(first.alive(), false, 'synchronously');
    assert.equal(first.signal.aborted, true);
    assert.deepEqual(await outcome(first), { ok: false, reason: 'superseded' });
    assert.deepEqual(await fates(elsewhere, unnamed, second), ['live', 'live', 'live']);
    const third = tasks.run({ lifetime: 'position', channel: 'coach' }, async () => 'reply');
    assert.deepEqual(await outcome(second), { ok: false, reason: 'superseded' });
    assert.deepEqual(await outcome(third), { ok: true, value: 'reply' });

    // Worker jobs are their own channel: a job leaves run tasks alone, and a run task leaves the job alone.
    const survey = tasks.job(job());
    const fourth = tasks.run({ lifetime: 'position', channel: 'coach' }, never);
    assert.deepEqual(await fates(survey, fourth, elsewhere, unnamed), ['live', 'live', 'live', 'live']);
  }

  // idle timeout with touch
  {
    const { tasks, clock } = rig();
    let ctx = null;
    const reply = tasks.run({ lifetime: 'position', idleMs: 12000, timeoutMs: 45000 }, (c) => { ctx = c; return never(); });
    clock.advance(11000);
    ctx.touch();                                          // a chunk arrived at 11 s
    clock.advance(11000);                                 // 22 s: past the first idle limit of 12 s
    assert.equal(reply.alive(), true);
    clock.advance(999);
    assert.equal(reply.alive(), true);
    clock.advance(1);                                     // 23 s = 11 s + 12 s of silence
    assert.equal(reply.alive(), false);
    assert.deepEqual(await outcome(reply), { ok: false, reason: 'timeout' });
    assert.equal(reply.signal.aborted, true);

    // No touch at all: idle after idleMs.
    const silent = tasks.run({ lifetime: 'position', idleMs: 12000 }, never);
    clock.advance(11999);
    assert.equal(silent.alive(), true);
    clock.advance(1);
    assert.deepEqual(await outcome(silent), { ok: false, reason: 'timeout' });

    // The overall timeout holds however often the task is touched.
    const chatty = tasks.run({ lifetime: 'position', idleMs: 12000, timeoutMs: 45000 }, (c) => { ctx = c; return never(); });
    for (let i = 0; i < 4; i++) {
      clock.advance(10000);
      ctx.touch();
    }
    clock.advance(4999);
    assert.equal(chatty.alive(), true);
    clock.advance(1);                                     // 45 s
    assert.deepEqual(await outcome(chatty), { ok: false, reason: 'timeout' });
  }

  // gate() callbacks are silent after cancel
  {
    const { tasks, clock } = rig();
    const seen = [];
    let ctx = null;
    const reply = tasks.run({ lifetime: 'trial', channel: 'coach', idleMs: 12000 }, (c) => { ctx = c; return never(); });
    const onText = ctx.gate((text) => { seen.push(text); return text.length; });
    assert.equal(onText('亮以为'), 3, 'a gated callback passes its arguments and its result while the task lives');
    assert.equal(ctx.alive(), true);
    reply.cancel();
    assert.equal(ctx.alive(), false);
    assert.equal(reply.alive(), false);
    assert.equal(onText('a chunk the reader had already buffered'), undefined);
    assert.deepEqual(seen, ['亮以为']);
    const timers = clock.pending();
    ctx.touch();                                          // a dead task arms nothing
    assert.equal(clock.pending(), timers);

    // A stream that keeps producing after the cancel, and even completes, changes nothing.
    const heard = [];
    const stream = tasks.run({ lifetime: 'trial', channel: 'coach' }, async ({ gate }) => {
      const say = gate((text) => heard.push(text));
      say('first');
      await tick();
      say('second');
      return 'the whole reply';
    });
    stream.cancel();
    await tick();
    await tick();
    assert.deepEqual(heard, ['first']);
    assert.deepEqual(await outcome(stream), { ok: false, reason: 'cancelled' });
  }

  // the signal aborts
  {
    const { tasks, scope } = rig();
    const log = [];
    const order = [];
    let ctx = null;
    const reply = tasks.run({ lifetime: 'position', channel: 'coach' }, (c) => {
      ctx = c;
      c.signal.addEventListener('abort', () => {
        log.push(['abort', c.alive()]);
        Promise.resolve().then(() => order.push('abort listener'));
      });
      return never();
    });
    reply.done.then(() => order.push('done'));
    assert.equal(reply.signal, ctx.signal);
    assert.equal(reply.signal.aborted, false);
    scope.position = 2;
    tasks.sync(scope);
    assert.equal(reply.signal.aborted, true);
    assert.deepEqual(log, [['abort', false]], 'the task is settled before the transport is aborted');
    assert.deepEqual(await outcome(reply), { ok: false, reason: 'cancelled' });
    assert.deepEqual(order, ['abort listener', 'done'], 'the transport is aborted before done resolves');
  }
});

test('done never rejects', async () => {
  const handles = {};

  {
    const { tasks, host, clock } = rig();
    const w = host.current;
    handles.jobSuperseded = tasks.job(job());
    handles.jobCancelled = tasks.job(job());
    w.cancelled(handles.jobSuperseded.id);
    handles.jobCancelled.cancel();
    w.cancelled(handles.jobCancelled.id);
    handles.jobTwiceCancelled = tasks.job(job());
    handles.jobTwiceCancelled.cancel();
    handles.jobTwiceCancelled.cancel();
    w.cancelled(handles.jobTwiceCancelled.id);
    handles.jobError = tasks.job(job());
    w.error(handles.jobError.id, 'search failed');
    handles.jobUncloneable = tasks.job(job({ payload: { callback() {} } }));
    handles.jobOk = tasks.job(job());
    w.done(handles.jobOk.id, 'value');
    handles.jobTimeout = tasks.job(job({ timeoutMs: ASSESS_MS }));
    clock.advance(ASSESS_MS);                             // the worker is replaced
    host.current.ready();
    handles.jobCrash = tasks.job(job());
    host.current.crash('out of memory');                  // and replaced again
    host.current.ready();

    handles.runOk = tasks.run({ lifetime: 'game' }, async () => 'value');
    handles.runThrows = tasks.run({ lifetime: 'game' }, () => { throw new Error('sync throw'); });
    handles.runRejects = tasks.run({ lifetime: 'game' }, () => Promise.reject(new Error('rejected')));
    handles.runRejectsWithText = tasks.run({ lifetime: 'game' }, () => Promise.reject('just a string'));
    await tick();                                         // let the four settle before the rest is torn down
    handles.runCancelled = tasks.run({ lifetime: 'game' }, never);
    handles.runCancelled.cancel();
    handles.runTimeout = tasks.run({ lifetime: 'game', timeoutMs: 21000 }, never);
    clock.advance(21000);
    handles.runAbortError = tasks.run({ lifetime: 'game' }, ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    handles.runAbortError.cancel();

    handles.runDisposed = tasks.run({ lifetime: 'game' }, never);
    tasks.dispose();
    handles.jobAfterDispose = tasks.job(job());
    handles.runAfterDispose = tasks.run({ lifetime: 'game' }, never);
  }
  {
    const { tasks, clock } = rig({ ready: false, failSpawns: Infinity });
    handles.jobHeldAtDeath = tasks.job(job());
    clock.advance(250);
    handles.jobOnDeadEngine = tasks.job(job());
  }

  const names = Object.keys(handles);
  const outcomes = await Promise.all(names.map((name) => handles[name].done));     // a rejection would fail here
  const reasons = Object.fromEntries(names.map((name, i) => [name, outcomes[i].ok ? 'ok' : outcomes[i].reason]));
  assert.deepEqual(reasons, {
    jobSuperseded: 'superseded',
    jobCancelled: 'cancelled',
    jobTwiceCancelled: 'cancelled',
    jobError: 'error',
    jobUncloneable: 'error',
    jobOk: 'ok',
    jobTimeout: 'timeout',
    jobCrash: 'error',
    runOk: 'ok',
    runThrows: 'error',
    runRejects: 'error',
    runRejectsWithText: 'error',
    runCancelled: 'cancelled',
    runTimeout: 'timeout',
    runAbortError: 'cancelled',
    runDisposed: 'cancelled',
    jobAfterDispose: 'cancelled',
    runAfterDispose: 'cancelled',
    jobHeldAtDeath: 'error',
    jobOnDeadEngine: 'error',
  });
  for (const [i, name] of names.entries()) {
    assert.equal(handles[name].alive(), false, name);
    const o = outcomes[i];
    if (o.ok) assert.deepEqual(o, { ok: true, value: 'value' }, name);
    else if ('error' in o) assert.ok(o.error instanceof Error, name);
  }
  assert.equal(outcomes[names.indexOf('jobError')].error.message, 'search failed');
  assert.equal(outcomes[names.indexOf('jobCrash')].error.message, 'out of memory');
  assert.equal(outcomes[names.indexOf('jobUncloneable')].error.name, 'DataCloneError');
  assert.equal(outcomes[names.indexOf('runThrows')].error.message, 'sync throw');
  assert.equal(outcomes[names.indexOf('runRejects')].error.message, 'rejected');
  assert.equal(outcomes[names.indexOf('runRejectsWithText')].error.message, 'just a string');
});

test('job ids are never reused', async () => {
  const { tasks, host, clock, scope } = rig({ ready: false });
  const handles = [];
  const add = (handle) => { handles.push(handle); return handle; };

  add(tasks.job(job()));                                  // held, superseded before ready
  add(tasks.run({ lifetime: 'trial', channel: 'coach' }, never));
  const first = add(tasks.job(job()));
  host.current.ready();
  host.current.done(first.id, 'done');
  add(tasks.job(job()));                                  // superseded while running; the worker never says so
  const carried = add(tasks.job(job({ kind: 'assess' })));
  clock.advance(150);                                     // backstop: worker 2
  host.current.ready();                                   // the pending job is posted again, under its own id
  host.current.done(carried.id, 'assessed');
  const pending = add(tasks.job(job()));
  scope.position = 2;
  tasks.sync(scope);                                      // cancels it and the coach reply
  host.current.cancelled(pending.id);
  const failing = add(tasks.job(job()));
  host.current.error(failing.id);
  add(tasks.run({ lifetime: 'position', channel: 'coach' }, async () => 1));
  const crashing = add(tasks.job(job()));
  host.current.crash();                                   // worker 3
  add(tasks.job(job()));                                  // held, never posted
  scope.game = 2;
  tasks.sync(scope);                                      // new game
  const expiring = add(tasks.job(job()));
  host.current.ready();
  clock.advance(SURVEY_MS);                               // timeout: worker 4
  const last = add(tasks.job(job({ kind: 'opponent' })));
  host.current.ready();
  host.current.done(last.id, 'move');
  await tick();
  assert.equal(host.workers.length, 4);
  assert.deepEqual(await fates(carried, pending, failing, crashing, expiring, last), ['ok', 'cancelled', 'error', 'error', 'timeout', 'ok']);

  const ids = handles.map((handle) => handle.id);
  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, ids.length, 'every handle has its own id');
  assert.ok(ids.every((id) => Number.isInteger(id) && id > 0));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), 'ids only grow, across workers, games and task kinds');

  // On the wire: every posted id is the id of one job handle, and no worker is given an id twice.
  const jobIds = new Set(handles.filter((handle) => handle.signal === undefined).map((handle) => handle.id));
  const wire = host.workers.map((worker) => worker.jobs.map((m) => m.id));
  for (const posted of wire) {
    assert.equal(new Set(posted).size, posted.length);
    for (const id of posted) assert.ok(jobIds.has(id), `job ${id} belongs to a handle`);
  }
  // The only id seen by two workers is the job that was pending at the backstop: the same job, posted again.
  const everywhere = wire.flat();
  const repeated = [...new Set(everywhere.filter((id, i) => everywhere.indexOf(id) !== i))];
  assert.deepEqual(repeated, [carried.id]);
  assert.ok(wire[0].includes(carried.id) && wire[1].includes(carried.id));
  assert.deepEqual(host.workers[1].cancels, [pending.id]);
  assert.ok(wire[2].includes(expiring.id));
});

test("an {t:'error'} message keeps the worker; onerror replaces it", async () => {
  const aliveAtRespawn = [];
  let watched = null;
  const { tasks, host, clock, events } = rig({ watch: (e) => { if (e === 'respawn' && watched) aliveAtRespawn.push(watched.alive()); } });
  const w1 = host.current;

  const failing = tasks.job(job());
  w1.error(failing.id, 'illegal position');
  const failed = await outcome(failing);
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'error');
  assert.equal(failed.error.message, 'illegal position');
  assert.equal(w1.terminated, false);
  assert.equal(tasks.liveJob(), null);
  assert.equal(host.workers.length, 1);

  const next = tasks.job(job({ kind: 'assess' }));        // the same worker serves the next job; nothing was retried
  assert.deepEqual(w1.jobs.map((m) => m.id), [failing.id, next.id]);
  w1.done(next.id, 'assessed');
  assert.deepEqual(await outcome(next), { ok: true, value: 'assessed' });

  const crashing = tasks.job(job({ kind: 'opponent', timeoutMs: OPPONENT_MS }));
  watched = crashing;
  w1.crash('worker ran out of memory');
  watched = null;
  assert.deepEqual(aliveAtRespawn, [false], 'the job fails first, then the worker is replaced');
  const crashed = await outcome(crashing);
  assert.equal(crashed.ok, false);
  assert.equal(crashed.reason, 'error');
  assert.equal(crashed.error.message, 'worker ran out of memory');
  assert.equal(w1.terminated, true);
  assert.equal(host.workers.length, 2);
  const w2 = host.current;
  assert.deepEqual(w2.posted, [{ t: 'hello' }], 'the failed job is not retried');
  assert.deepEqual(events, [['ready', SPEED], 'respawn']);
  assert.deepEqual(tasks.stats(), { spawned: 2, terminated: 1, lateDrops: 0, live: 0, dead: false });

  // onmessageerror is treated like onerror.
  w2.ready();
  const garbled = tasks.job(job());
  w2.garble();
  assert.equal((await outcome(garbled)).reason, 'error');
  assert.equal(w2.terminated, true);
  assert.equal(host.workers.length, 3);

  // An idle worker that breaks is replaced too, and the next job runs on the new one.
  const w3 = host.current;
  w3.ready();
  w3.crash();
  assert.equal(w3.terminated, true);
  const w4 = host.current;
  const after = tasks.job(job());
  w4.ready();
  w4.done(after.id, 'survey');
  assert.deepEqual(await outcome(after), { ok: true, value: 'survey' });
  clock.advance(60_000);
  assert.equal(w4.terminated, false);
});

test('three failed spawns mark the engine dead; restart() recovers', async () => {
  // A throwing constructor: retries after 0 ms and 250 ms; the third consecutive failure is final.
  {
    const aliveAtDeath = [];
    let waiting = null;
    const { tasks, host, clock, events } = rig({ ready: false, failSpawns: Infinity, watch: (e) => { if (e === 'dead') aliveAtDeath.push(waiting.alive()); } });
    assert.equal(host.attempts, 1);
    waiting = tasks.job(job());                           // posted while the engine is still trying
    assert.equal(waiting.alive(), true);
    clock.advance(0);
    assert.equal(host.attempts, 2);
    clock.advance(249);
    assert.equal(host.attempts, 2);
    assert.deepEqual(events, []);
    assert.equal(tasks.stats().dead, false);
    clock.advance(1);
    assert.equal(host.attempts, 3);
    assert.deepEqual(events, ['dead']);
    assert.deepEqual(aliveAtDeath, [false], 'the live job is resolved before the engine is reported dead');
    assert.deepEqual(tasks.stats(), { spawned: 0, terminated: 0, lateDrops: 0, live: 0, dead: true });

    assert.equal(waiting.alive(), false, 'live jobs resolve at once');
    assert.deepEqual(await outcome(waiting), { ok: false, reason: 'error' });
    const refused = tasks.job(job());
    assert.equal(refused.alive(), false, 'future jobs resolve at once');
    assert.deepEqual(await outcome(refused), { ok: false, reason: 'error' });
    assert.equal(tasks.liveJob(), null);
    const reply = tasks.run({ lifetime: 'position', channel: 'coach' }, async () => 'text');
    assert.deepEqual(await outcome(reply), { ok: true, value: 'text' }, 'run tasks do not need the engine');

    clock.advance(600_000);
    assert.equal(host.attempts, 3, 'no further attempt on its own');
    assert.deepEqual(events, ['dead']);

    host.failSpawns = 0;
    tasks.restart();
    assert.equal(host.attempts, 4);
    assert.equal(tasks.stats().dead, false);
    const w = host.current;
    assert.deepEqual(w.posted, [{ t: 'hello' }]);
    const again = tasks.job(job({ kind: 'opponent', timeoutMs: OPPONENT_MS }));     // the script re-run right after restart()
    assert.equal(again.alive(), true);
    w.ready();
    assert.deepEqual(events, ['dead', ['ready', SPEED]]);
    assert.deepEqual(w.jobs.map((m) => m.id), [again.id]);
    w.done(again.id, 'move');
    assert.deepEqual(await outcome(again), { ok: true, value: 'move' });
    assert.deepEqual(tasks.stats(), { spawned: 1, terminated: 0, lateDrops: 0, live: 0, dead: false });

    tasks.restart();                                      // only meaningful after 'dead'
    assert.equal(host.attempts, 4);
    assert.equal(w.terminated, false);
  }

  // restart() on an engine that still cannot start: three more attempts, then dead again.
  {
    const { tasks, host, clock, events } = rig({ ready: false, failSpawns: Infinity });
    clock.advance(250);
    assert.deepEqual(events, ['dead']);
    tasks.restart();
    assert.equal(host.attempts, 4);
    assert.equal(tasks.stats().dead, false, 'the flag is cleared');
    const waiting = tasks.job(job());
    assert.equal(waiting.alive(), true);
    clock.advance(0);
    assert.equal(host.attempts, 5);
    clock.advance(249);
    assert.deepEqual(events, ['dead']);
    clock.advance(1);
    assert.equal(host.attempts, 6);
    assert.deepEqual(events, ['dead', 'dead']);
    assert.equal(tasks.stats().dead, true);
    assert.deepEqual(await outcome(waiting), { ok: false, reason: 'error' });
  }

  // No `ready` within 5000 ms, three times: dead at 5000 + 0 + 5000 + 250 + 5000 ms.
  {
    const { tasks, host, clock, events } = rig({ ready: false });
    clock.advance(4999);
    assert.equal(host.workers[0].terminated, false);
    clock.advance(1);                                     // 5000: first failure, retry after 0 ms
    assert.equal(host.workers[0].terminated, true);
    assert.equal(host.workers.length, 2);
    clock.advance(5000);                                  // 10000: second failure, retry after 250 ms
    assert.equal(host.workers[1].terminated, true);
    clock.advance(249);
    assert.equal(host.workers.length, 2);
    clock.advance(1);                                     // 10250: the third worker
    assert.equal(host.workers.length, 3);
    clock.advance(4999);
    assert.deepEqual(events, []);
    clock.advance(1);                                     // 15250: third failure
    assert.deepEqual(events, ['dead']);
    assert.deepEqual(tasks.stats(), { spawned: 3, terminated: 3, lateDrops: 0, live: 0, dead: true });

    host.workers[2].ready();                              // too late, from a terminated worker
    assert.equal(tasks.stats().dead, true);
    assert.equal(tasks.stats().lateDrops, 1);
    assert.deepEqual(events, ['dead']);

    tasks.restart();
    assert.equal(host.workers.length, 4);
    host.current.ready();
    assert.deepEqual(events, ['dead', ['ready', SPEED]]);
    clock.advance(600_000);
    assert.equal(host.current.terminated, false, 'a greeted worker has no spawn limit left');
  }

  // An error before `ready` is a spawn failure; a `ready` starts the count again.
  {
    const { tasks, host, clock, events } = rig({ ready: false });
    host.workers[0].crash('the worker script failed to load');       // failure 1
    assert.equal(host.workers[0].terminated, true);
    clock.advance(0);
    host.workers[1].crash();                                         // failure 2
    clock.advance(249);
    assert.equal(host.workers.length, 2);
    clock.advance(1);
    host.workers[2].ready();                                         // success
    assert.deepEqual(events, [['ready', SPEED]]);

    host.failSpawns = 2;
    host.workers[2].crash();                                         // a working worker breaks: replaced, and the
    clock.advance(0);                                                // replacement fails twice more (failures 1 and 2,
    clock.advance(250);                                              // not 3 and 4)
    assert.equal(tasks.stats().dead, false);
    assert.equal(host.attempts, 6);
    host.current.ready();
    assert.deepEqual(events, [['ready', SPEED], 'respawn', ['ready', SPEED]]);
  }
});

test('jobs posted before ready are held and the last one wins', async () => {
  const { tasks, host, clock } = rig({ ready: false });
  const w = host.current;
  const first = tasks.job(job({ kind: 'survey', payload: 'first' }));
  assert.deepEqual(tasks.liveJob(), { kind: 'survey', lifetime: 'position', tool: false });
  const second = tasks.job(job({ kind: 'assess', payload: 'second', lifetime: 'trial', timeoutMs: ASSESS_MS, tool: true }));
  assert.deepEqual(w.posted, [{ t: 'hello' }], 'nothing reaches the worker before ready');
  assert.equal(first.alive(), false);
  assert.deepEqual(await outcome(first), { ok: false, reason: 'superseded' });
  assert.equal(second.alive(), true);
  assert.deepEqual(tasks.liveJob(), { kind: 'assess', lifetime: 'trial', tool: true });

  w.done(second.id, 'an answer to a job that was never posted');     // a held job is not running: the gate drops it
  assert.equal(await outcome(second), 'pending');
  assert.equal(tasks.stats().lateDrops, 1);

  clock.advance(4000);                                    // a held job has no timeout running and no backstop
  assert.equal(second.alive(), true);
  assert.equal(w.terminated, false);

  w.ready();
  assert.deepEqual(w.posted, [{ t: 'hello' }, { t: 'job', id: second.id, kind: 'assess', payload: 'second' }]);
  w.done(second.id, 'assessed');
  assert.deepEqual(await outcome(second), { ok: true, value: 'assessed' });

  // A held job that is cancelled never reaches the worker, and needs no cancel message.
  const other = rig({ ready: false });
  const dropped = other.tasks.job(job());
  dropped.cancel();
  other.host.current.ready();
  assert.deepEqual(other.host.current.posted, [{ t: 'hello' }]);
  assert.deepEqual(await outcome(dropped), { ok: false, reason: 'cancelled' });
  other.clock.advance(1000);
  assert.equal(other.host.current.terminated, false);
});

// -----------------------------------------------------------------------------------------------------------------
// Further rules of section 6
// -----------------------------------------------------------------------------------------------------------------

test('the worker is created with createTasks and greeted with hello; ready reports the calibration', () => {
  const { tasks, host, events } = rig({ ready: false });
  assert.equal(host.workers.length, 1);
  assert.deepEqual(host.current.posted, [{ t: 'hello' }]);
  assert.deepEqual(events, []);
  assert.deepEqual(tasks.stats(), { spawned: 1, terminated: 0, lateDrops: 0, live: 0, dead: false });
  host.current.ready({ perftNps: 1_200_000, speedClass: 'mid' });
  assert.deepEqual(events, [['ready', { speedClass: 'mid', perftNps: 1_200_000 }]]);
  host.current.ready();                                   // a worker greets once
  assert.equal(events.length, 1);
  assert.equal(tasks.stats().lateDrops, 0, 'a repeated ready is not a late job message');
});

test('stats() and liveJob() report the live work', async () => {
  const { tasks, host } = rig();
  assert.deepEqual(Object.keys(tasks.stats()).sort(), ['dead', 'lateDrops', 'live', 'spawned', 'terminated']);
  assert.equal(tasks.liveJob(), null);

  const reply = tasks.run({ lifetime: 'trial', channel: 'coach' }, never);
  assert.equal(tasks.stats().live, 1);
  assert.equal(tasks.liveJob(), null, 'a run task is not a worker job');

  const tool = tasks.job(job({ kind: 'assess', lifetime: 'trial', timeoutMs: ASSESS_MS, tool: true }));
  assert.deepEqual(tasks.liveJob(), { kind: 'assess', lifetime: 'trial', tool: true });
  assert.equal(tasks.stats().live, 2);

  const rival = tasks.job(job({ kind: 'opponent', lifetime: 'position', timeoutMs: OPPONENT_MS }));     // a UI job wins
  assert.deepEqual(tasks.liveJob(), { kind: 'opponent', lifetime: 'position', tool: false });
  assert.deepEqual(await outcome(tool), { ok: false, reason: 'superseded' });
  assert.equal(tasks.stats().live, 2);

  host.current.done(rival.id, 'move');
  assert.equal(tasks.liveJob(), null, 'the worker is idle as soon as the result is in');
  assert.equal(tasks.stats().live, 1);
  reply.cancel();
  assert.equal(tasks.stats().live, 0);
});

test('stop settles the task before the transport is touched, and sends one cancel', () => {
  const { tasks, host } = rig();
  const w = host.current;
  const survey = tasks.job(job());
  const aliveAtCancel = [];
  const post = w.postMessage.bind(w);
  w.postMessage = (message) => {
    if (message.t === 'cancel') aliveAtCancel.push(survey.alive());
    post(message);
  };
  survey.cancel();
  survey.cancel();
  tasks.cancelAll();
  assert.deepEqual(aliveAtCancel, [false]);
  assert.deepEqual(w.cancels, [survey.id]);
});

test("a job's timeout runs only while the worker has the job", async () => {
  const { tasks, host, clock } = rig({ ready: false });
  const held = tasks.job(job({ kind: 'assess', timeoutMs: ASSESS_MS }));
  clock.advance(ASSESS_MS + 1000);                        // the worker is still starting up
  assert.equal(held.alive(), true);
  host.current.ready();                                   // posted now
  clock.advance(ASSESS_MS - 1);
  assert.equal(held.alive(), true);
  clock.advance(1);
  assert.deepEqual(await outcome(held), { ok: false, reason: 'timeout' });

  // The same with a short wait: the time is counted from the post, not from job().
  const short = rig({ ready: false });
  const brief = short.tasks.job(job({ kind: 'assess', timeoutMs: ASSESS_MS }));
  short.clock.advance(500);
  short.host.current.ready();
  short.clock.advance(ASSESS_MS - 1);                     // 500 ms + timeoutMs - 1 after job()
  assert.equal(brief.alive(), true);
  short.clock.advance(1);
  assert.deepEqual(await outcome(brief), { ok: false, reason: 'timeout' });

  // A job posted again after a respawn gets its full time on the new worker, however long the respawn took.
  for (const respawnMs of [50, ASSESS_MS]) {
    const { tasks, host, clock } = rig();
    const survey = tasks.job(job());
    const assess = tasks.job(job({ kind: 'assess', timeoutMs: ASSESS_MS }));
    clock.advance(150);                                   // the survey was never acknowledged: respawn
    assert.equal(host.workers.length, 2);
    clock.advance(respawnMs);                             // waiting for the new worker
    assert.equal(assess.alive(), true);
    host.current.ready();
    clock.advance(ASSESS_MS - 1);
    assert.equal(assess.alive(), true, `respawn ${respawnMs} ms`);
    clock.advance(1);
    assert.deepEqual(await outcome(assess), { ok: false, reason: 'timeout' });
    assert.deepEqual(await outcome(survey), { ok: false, reason: 'superseded' });
  }
});

test('a payload that cannot be cloned fails that job only; the job it superseded is cancelled by message', async () => {
  const { tasks, host } = rig();
  const w = host.current;
  const survey = tasks.job(job());
  const broken = tasks.job(job({ kind: 'assess', payload: { onProgress() {} } }));
  const failed = await outcome(broken);
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'error');
  assert.equal(failed.error.name, 'DataCloneError');
  assert.deepEqual(await outcome(survey), { ok: false, reason: 'superseded' });
  assert.deepEqual(w.jobs.map((m) => m.id), [survey.id], 'the worker never saw the broken job');
  assert.deepEqual(w.cancels, [survey.id], 'so the old job is cancelled the ordinary way');
  assert.equal(tasks.liveJob(), null);
  assert.equal(tasks.stats().live, 0);

  w.cancelled(survey.id);
  const next = tasks.job(job());
  w.done(next.id, 'survey');
  assert.deepEqual(await outcome(next), { ok: true, value: 'survey' });
});

test("a 'cancelled' message for the running job settles it as cancelled", async () => {
  const { tasks, host, clock } = rig();
  const survey = tasks.job(job());
  host.current.cancelled(survey.id);                      // the worker gave the job up on its own
  assert.equal(survey.alive(), false);
  assert.deepEqual(await outcome(survey), { ok: false, reason: 'cancelled' });
  assert.equal(tasks.liveJob(), null);
  clock.advance(60_000);
  assert.equal(host.current.terminated, false);
});

test('cancelChannel stops the run task of that channel only; cancelAll stops everything', async () => {
  const { tasks, host } = rig();
  const coach = tasks.run({ lifetime: 'game', channel: 'coach' }, never);
  const other = tasks.run({ lifetime: 'game', channel: 'probe' }, never);
  const unnamed = tasks.run({ lifetime: 'game' }, never);
  const survey = tasks.job(job());

  tasks.cancelChannel('coach');
  assert.equal(coach.signal.aborted, true);
  assert.deepEqual(await fates(coach, other, unnamed, survey), ['cancelled', 'live', 'live', 'live']);
  tasks.cancelChannel('no such channel');
  assert.equal(tasks.stats().live, 3);

  tasks.cancelAll();
  assert.deepEqual(await fates(other, unnamed, survey), ['cancelled', 'cancelled', 'cancelled']);
  assert.deepEqual(host.current.cancels, [survey.id]);
  assert.equal(tasks.stats().live, 0);
  assert.equal(tasks.liveJob(), null);
});

test('run: the function is called at once with signal, alive, gate and touch; a finished task leaves its signal alone', async () => {
  const { tasks, clock } = rig();
  let ctx = null;
  const reply = tasks.run({ lifetime: 'position', channel: 'coach', timeoutMs: 21000 }, (c) => {
    ctx = c;
    return Promise.resolve('whole reply');
  });
  assert.notEqual(ctx, null, 'called before run() returns: the request leaves immediately');
  assert.deepEqual(Object.keys(ctx).sort(), ['alive', 'gate', 'signal', 'touch']);
  assert.equal(typeof reply.id, 'number');
  assert.equal(reply.alive(), true);
  assert.deepEqual(await outcome(reply), { ok: true, value: 'whole reply' });
  assert.equal(reply.alive(), false);
  assert.equal(ctx.alive(), false);
  assert.equal(reply.signal.aborted, false);
  reply.cancel();                                         // cancelling a settled task does nothing
  assert.equal(reply.signal.aborted, false);
  assert.equal(clock.pending(), 0, 'its timeout was cleared');

  // A gated callback keeps its `this`.
  const receiver = { hits: 0, onChunk: null };
  tasks.run({ lifetime: 'position' }, (c) => {
    receiver.onChunk = c.gate(function () { this.hits++; });
    return never();
  });
  receiver.onChunk();
  assert.equal(receiver.hits, 1);
});

test('dispose terminates the worker, cancels everything and refuses new work', async () => {
  const { tasks, host, clock, events } = rig();
  const w = host.current;
  const survey = tasks.job(job());
  const reply = tasks.run({ lifetime: 'game', channel: 'coach', timeoutMs: 21000, idleMs: 12000 }, never);
  tasks.dispose();
  assert.equal(w.terminated, true);
  assert.equal(reply.signal.aborted, true);
  assert.deepEqual(await fates(survey, reply), ['cancelled', 'cancelled']);
  assert.equal(clock.pending(), 0, 'no timer is left behind');
  assert.equal(host.workers.length, 1, 'no replacement');

  let called = false;
  const late = tasks.run({ lifetime: 'game' }, async () => { called = true; });
  assert.equal(called, false);
  assert.equal(late.signal.aborted, true);
  assert.deepEqual(await fates(late, tasks.job(job())), ['cancelled', 'cancelled']);
  tasks.restart();
  tasks.dispose();
  clock.advance(600_000);
  assert.equal(host.attempts, 1);
  assert.deepEqual(events, [['ready', SPEED]]);
  assert.deepEqual(tasks.stats(), { spawned: 1, terminated: 1, lateDrops: 0, live: 0, dead: false });

  // Disposed while the worker is still starting, and while a spawn retry is waiting.
  const starting = rig({ ready: false });
  const held = starting.tasks.job(job());
  starting.tasks.dispose();
  assert.equal(starting.host.workers[0].terminated, true);
  assert.equal(starting.clock.pending(), 0);
  assert.deepEqual(await outcome(held), { ok: false, reason: 'cancelled' });

  const retrying = rig({ ready: false, failSpawns: Infinity });
  retrying.clock.advance(0);                              // the second failure: a retry is due in 250 ms
  retrying.tasks.dispose();
  assert.equal(retrying.clock.pending(), 0);
  retrying.clock.advance(600_000);
  assert.equal(retrying.host.attempts, 2);
  assert.deepEqual(retrying.events, []);
});

test('without injected timers and without onWorker the global timers are used', async () => {
  const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const host = createFakeWorkers();
  const scope = { game: 1, position: 1, trial: 0 };
  const tasks = createTasks({ getScope: () => scope, createWorker: host.createWorker });     // as src/app.js creates it
  try {
    const w1 = host.current;
    w1.ready();
    const survey = tasks.job(job());
    survey.cancel();
    assert.equal(w1.terminated, false);
    await realSleep(250);                                 // well past the 150 ms backstop
    assert.equal(w1.terminated, true);
    assert.equal(host.workers.length, 2);

    const w2 = host.current;
    w2.ready();
    const again = tasks.job(job());
    again.cancel();
    w2.cancelled(again.id);                               // acknowledged: the real timer is cleared
    await realSleep(250);
    assert.equal(w2.terminated, false);
    assert.deepEqual(tasks.stats(), { spawned: 2, terminated: 1, lateDrops: 1, live: 0, dead: false });
  } finally {
    tasks.dispose();                                      // leaves no real timer behind
  }
});

test('callbacks may call back into the task manager', async () => {
  const { tasks, host } = rig();
  const w = host.current;

  // A new job posted from onProgress supersedes the job that reported.
  let follow = null;
  const survey = tasks.job(job({ onProgress: () => { follow ??= tasks.job(job({ kind: 'assess', lifetime: 'game', timeoutMs: ASSESS_MS })); } }));
  w.progress(survey.id, 'table', 1);
  w.progress(survey.id, 'table', 2);                      // dropped: the survey is no longer the live job
  assert.deepEqual(await outcome(survey), { ok: false, reason: 'superseded' });
  assert.deepEqual(w.jobs.map((m) => m.id), [survey.id, follow.id]);
  assert.equal(tasks.stats().lateDrops, 1);

  // A throwing onWorker callback does not leave the manager without a worker.
  {
    const clock = createVirtualTimers();
    const workers = createFakeWorkers();
    const loud = createTasks({
      getScope: () => ({ game: 1, position: 1, trial: 0 }),
      createWorker: workers.createWorker,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      onWorker: (e) => { if (e === 'respawn') throw new Error('callback failed'); },
    });
    workers.current.ready();
    const pending = loud.job(job());
    loud.job(job()).cancel();
    assert.throws(() => clock.advance(150), /callback failed/);
    assert.equal(workers.workers.length, 2);
    assert.deepEqual(workers.current.posted, [{ t: 'hello' }]);
    assert.deepEqual(loud.stats(), { spawned: 2, terminated: 1, lateDrops: 0, live: 0, dead: false });
    assert.deepEqual(await outcome(pending), { ok: false, reason: 'superseded' });
  }

  // An abort listener that cancels another task during sync (the tool executor's `signal -> job.cancel`).
  const reply = tasks.run({ lifetime: 'position', channel: 'coach' }, ({ signal }) => {
    signal.addEventListener('abort', () => follow.cancel());
    return never();
  });
  tasks.sync({ game: 1, position: 2, trial: 0 });         // stops the reply; the game-lifetime job goes with it
  assert.deepEqual(await fates(reply, follow), ['cancelled', 'cancelled']);
  assert.deepEqual(w.cancels, [follow.id]);
  assert.equal(tasks.stats().live, 0);
});

test('a channel keeps one live task when an abort listener starts the next one', async () => {
  const { tasks } = rig();
  const calls = [];
  let inner = null;
  const first = tasks.run({ lifetime: 'game', channel: 'coach' }, ({ signal }) => {
    signal.addEventListener('abort', () => {
      inner ??= tasks.run({ lifetime: 'game', channel: 'coach' }, () => { calls.push('inner'); return never(); });
    });
    return never();
  });
  const second = tasks.run({ lifetime: 'game', channel: 'coach', timeoutMs: 21000, idleMs: 12000 }, () => { calls.push('second'); return never(); });

  // The run() made inside the listener is the later call: it wins, and the outer task ends before its function runs.
  assert.deepEqual([first.alive(), inner.alive(), second.alive()], [false, true, false]);
  assert.deepEqual(calls, ['inner']);
  assert.equal(second.signal.aborted, true);
  assert.deepEqual(await fates(first, inner, second), ['superseded', 'live', 'superseded']);
  assert.equal(tasks.stats().live, 1);

  // A listener that cancels everything ends the new task too.
  const clear = rig();
  let ran = false;
  clear.tasks.run({ lifetime: 'game', channel: 'coach' }, ({ signal }) => {
    signal.addEventListener('abort', () => clear.tasks.cancelAll());
    return never();
  });
  const next = clear.tasks.run({ lifetime: 'game', channel: 'coach', timeoutMs: 21000 }, () => { ran = true; return never(); });
  assert.equal(ran, false);
  assert.deepEqual(await outcome(next), { ok: false, reason: 'cancelled' });
  assert.equal(clear.tasks.stats().live, 0);
  assert.equal(clear.clock.pending(), 0, 'no timer was armed for it');
});

test('every stopped job has its own backstop', () => {
  const { tasks, host, clock } = rig();
  const w = host.current;
  const first = tasks.job(job());
  first.cancel();                                         // 0 ms
  clock.advance(100);
  const second = tasks.job(job({ kind: 'assess' }));
  clock.advance(20);
  second.cancel();                                        // 120 ms
  clock.advance(20);
  w.cancelled(first.id);                                  // 140 ms: acknowledges the first job only
  clock.advance(129);
  assert.equal(w.terminated, false, 'the backstop of the first job is gone');
  clock.advance(1);                                       // 270 ms = 120 ms + 150 ms
  assert.equal(w.terminated, true, 'the second job was never acknowledged');
  assert.deepEqual(tasks.stats(), { spawned: 2, terminated: 1, lateDrops: 1, live: 0, dead: false });
});

test('a job posted from onWorker during a respawn replaces the pending job', async () => {
  const clock = createVirtualTimers();
  const host = createFakeWorkers();
  let extra = null;
  const tasks = createTasks({
    getScope: () => ({ game: 1, position: 1, trial: 0 }),
    createWorker: host.createWorker,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onWorker: (e) => { if (e === 'respawn') extra = tasks.job(job({ kind: 'opponent', timeoutMs: OPPONENT_MS })); },
  });
  host.current.ready();
  const survey = tasks.job(job());
  const assess = tasks.job(job({ kind: 'assess', timeoutMs: ASSESS_MS }));
  clock.advance(150);                                     // the survey was never acknowledged
  assert.equal(host.workers.length, 2);
  assert.deepEqual(await fates(survey, assess, extra), ['superseded', 'superseded', 'live']);
  host.current.ready();
  assert.deepEqual(host.current.jobs.map((m) => m.id), [extra.id], 'only the newest job reaches the new worker');
  host.current.done(extra.id, 'move');
  assert.deepEqual(await outcome(extra), { ok: true, value: 'move' });
  clock.advance(60_000);
  assert.equal(host.workers.length, 2);
  assert.equal(clock.pending(), 0);
});

test('a worker that cannot be greeted is a spawn failure; one that cannot be terminated is abandoned', async () => {
  // postMessage throws on `hello`, three times.
  {
    const clock = createVirtualTimers();
    const made = [];
    const events = [];
    const tasks = createTasks({
      getScope: () => ({ game: 1, position: 1, trial: 0 }),
      createWorker: () => {
        const worker = createFakeWorkers().createWorker();
        worker.postMessage = () => { throw new Error('the worker is gone'); };
        made.push(worker);
        return worker;
      },
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      onWorker: (e) => events.push(e),
    });
    const held = tasks.job(job());
    assert.equal(made[0].terminated, true, 'terminated at once, not after the 5000 ms limit');
    clock.advance(0);
    clock.advance(249);
    assert.equal(made.length, 2);
    clock.advance(1);
    assert.equal(made.length, 3);
    assert.deepEqual(events, ['dead']);
    assert.deepEqual(await outcome(held), { ok: false, reason: 'error' });
    assert.deepEqual(tasks.stats(), { spawned: 3, terminated: 3, lateDrops: 0, live: 0, dead: true });
    assert.equal(clock.pending(), 0);
  }

  // terminate() throws: the worker is dropped all the same and its messages no longer count.
  {
    const { tasks, host, clock, events } = rig();
    const w1 = host.current;
    w1.terminate = () => { throw new Error('cannot terminate'); };
    const survey = tasks.job(job());
    survey.cancel();
    clock.advance(150);
    assert.equal(host.workers.length, 2);
    assert.deepEqual(events, [['ready', SPEED], 'respawn']);
    const next = tasks.job(job());
    w1.done(next.id, 'from the abandoned worker');
    assert.equal(await outcome(next), 'pending');
    host.workers[1].ready();
    host.workers[1].done(next.id, 'survey');
    assert.deepEqual(await outcome(next), { ok: true, value: 'survey' });
    assert.deepEqual(tasks.stats(), { spawned: 2, terminated: 1, lateDrops: 1, live: 0, dead: false });
  }
});

// -----------------------------------------------------------------------------------------------------------------
// The helpers of tests/helpers/fake-worker.js
// -----------------------------------------------------------------------------------------------------------------

test('helper: virtual timers fire in due order, then in the order they were set', async () => {
  const clock = createVirtualTimers(1000);
  const log = [];
  assert.equal(clock.now(), 1000);
  clock.setTimer(() => log.push('b@200'), 200);
  const dropped = clock.setTimer(() => log.push('dropped'), 150);
  clock.setTimer((x, y) => log.push(`a@100 ${x}${y}`), 100, 'x', 'y');
  clock.setTimer(() => { log.push('c@200'); clock.setTimer(() => log.push(`nested@${clock.now()}`), 50); }, 200);
  clock.setTimer(() => log.push('zero'));
  clock.clearTimer(dropped);
  clock.clearTimer(undefined);
  assert.equal(clock.pending(), 4);

  clock.advance(0);
  assert.deepEqual(log, ['zero']);
  clock.advance(199);
  assert.deepEqual(log, ['zero', 'a@100 xy']);
  assert.equal(clock.now(), 1199);
  clock.advance(100);
  assert.deepEqual(log, ['zero', 'a@100 xy', 'b@200', 'c@200', 'nested@1250']);
  assert.equal(clock.now(), 1299);
  assert.equal(clock.pending(), 0);

  // advanceAsync lets `await` continuations set the next timer in time.
  const steps = [];
  const sleep = (ms) => new Promise((resolve) => clock.setTimer(resolve, ms));
  const script = (async () => {
    await sleep(100);
    steps.push(clock.now());
    await sleep(100);
    steps.push(clock.now());
  })();
  await clock.advanceAsync(250);
  await script;
  assert.deepEqual(steps, [1399, 1499]);
  assert.equal(clock.now(), 1549);
});

test('helper: a fake worker with autoReady, autoAck and respond speaks the protocol of SPEC 4.9', async () => {
  const clock = createVirtualTimers();
  const host = createFakeWorkers({
    autoReady: true,
    autoAck: true,
    respond: (message) => (message.kind === 'assess' ? { assessed: message.payload } : undefined),
  });
  const scope = { game: 1, position: 1, trial: 0 };
  const events = [];
  const tasks = createTasks({
    getScope: () => scope,
    createWorker: host.createWorker,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onWorker: (e, info) => events.push([e, info]),
  });
  assert.deepEqual(events, [], 'an automatic answer never arrives inside postMessage');
  await tick();
  assert.deepEqual(events, [['ready', { speedClass: 'mid', perftNps: 2_000_000 }]]);
  const w = host.current;

  const survey = tasks.job(job());                        // not answered by `respond`: stays running
  await tick();
  assert.equal(w.running, survey.id);
  assert.equal(await outcome(survey), 'pending');

  const assess = tasks.job(job({ kind: 'assess', payload: 'M', lifetime: 'trial', timeoutMs: ASSESS_MS }));
  assert.deepEqual(await outcome(assess), { ok: true, value: { assessed: 'M' } });
  assert.equal(w.running, null);
  assert.equal(tasks.stats().lateDrops, 1, 'the acknowledgement of the superseded survey');

  const cancelled = tasks.job(job({ kind: 'assess', payload: 'N', lifetime: 'trial', timeoutMs: ASSESS_MS }));
  cancelled.cancel();                                     // before the worker got to it
  assert.deepEqual(await outcome(cancelled), { ok: false, reason: 'cancelled' });
  assert.deepEqual(w.cancels, [cancelled.id]);
  clock.advance(10_000);
  assert.equal(w.terminated, false, 'every stopped job was acknowledged: no backstop');
  assert.equal(host.workers.length, 1);

  // The raw messages carry the fields of SPEC 4.9.
  const raw = [];
  const deliver = w.onmessage;
  w.onmessage = (event) => { raw.push(event.data); deliver(event); };
  const last = tasks.job(job({ kind: 'opponent', timeoutMs: OPPONENT_MS }));
  w.progress(last.id, 'threat', null);
  w.done(last.id, { move: 'm' });
  w.error(last.id, 'x');
  w.cancelled(last.id);
  w.ready();
  assert.deepEqual(raw, [
    { t: 'progress', id: last.id, kind: 'opponent', stage: 'threat', data: null },
    { t: 'done', id: last.id, kind: 'opponent', data: { move: 'm' } },
    { t: 'error', id: last.id, message: 'x' },
    { t: 'cancelled', id: last.id },
    { t: 'ready', protocol: 1, speed: { perftNps: 2_000_000, speedClass: 'mid' } },
  ]);

  // Answers that would arrive inside postMessage (defer: run at once) are handled as well.
  const eager = createFakeWorkers({ autoReady: true, autoAck: true, respond: () => 'now', defer: (deliver) => deliver() });
  const eagerClock = createVirtualTimers();
  const eagerEvents = [];
  const eagerTasks = createTasks({
    getScope: () => scope,
    createWorker: eager.createWorker,
    setTimer: eagerClock.setTimer,
    clearTimer: eagerClock.clearTimer,
    onWorker: (e) => eagerEvents.push(e),
  });
  assert.deepEqual(eagerEvents, ['ready']);
  const instant = eagerTasks.job(job());
  assert.equal(instant.alive(), false);
  assert.deepEqual(await outcome(instant), { ok: true, value: 'now' });
  eagerClock.advance(600_000);
  assert.equal(eager.current.terminated, false);
  assert.equal(eagerClock.pending(), 0);
  eager.current.crash();
  assert.deepEqual(eagerEvents, ['ready', 'respawn', 'ready'], 'the respawn is reported before the new worker greets');
  assert.equal(eager.workers.length, 2);
  assert.equal(eagerClock.pending(), 0);

  // An acknowledgement that arrives inside the cancel's postMessage still stops the backstop.
  const prompt = createFakeWorkers({ autoReady: true, autoAck: true, defer: (deliver) => deliver() });
  const promptClock = createVirtualTimers();
  const promptTasks = createTasks({ getScope: () => scope, createWorker: prompt.createWorker, setTimer: promptClock.setTimer, clearTimer: promptClock.clearTimer });
  const running = promptTasks.job(job());
  running.cancel();
  const next = promptTasks.job(job());
  promptTasks.job(job());                                 // supersedes `next`: acknowledged inside the post of the new job
  assert.deepEqual(await fates(running, next), ['cancelled', 'superseded']);
  promptTasks.cancelAll();
  assert.equal(promptClock.pending(), 0);
  promptClock.advance(600_000);
  assert.equal(prompt.current.terminated, false);
  assert.equal(prompt.workers.length, 1);
});
