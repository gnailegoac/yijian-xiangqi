// tests/e2e/engine.spec.js (E1): SPEC 14.7 flows 6, 19 and 21: the engine worker, its cancellation and its failures.
import { expect, test } from '@playwright/test';
import { explainProxyLimit, installWorkerDouble, pieces, ready, savedMoves, tap, taskStats } from './helpers.js';

test.describe.configure({ timeout: 90000 });
explainProxyLimit(test);

/** The status line under the board when the rival's reply failed (SPEC 4.28.8, TXT.status.rivalFailed). */
const RIVAL_FAILED = '司马懿走神了——点一下，让他再想想。';
/** The opening position (Appendix A4). */
const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

/**
 * The counters of the Worker double (helpers.js, installWorkerDouble).
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{made:number, failing:boolean, errors:number, lateSent:number, lateDelivered:number}>}
 */
function double(page) {
  return page.evaluate(() => {
    const state = /** @type {{__workerDouble: {made:number, failing:boolean, errors:number, lateSent:number, lateDelivered:number}}} */ (/** @type {unknown} */ (window)).__workerDouble;
    return { ...state };
  });
}

/**
 * 炮二平五 as a trial, then 确定落子.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function confirmCentreCannon(page) {
  const app = page.locator('#app');
  await tap(page, 7, 7);
  await expect(app).toHaveAttribute('data-phase', 'selected');
  await tap(page, 7, 4);
  await expect(app).toHaveAttribute('data-phase', 'tentative');
  await page.locator('#confirm-button').tap();
}

test.describe('flow 6', () => {
  test('undo while the rival thinks, late worker result', async ({ page }) => {
    const app = page.locator('#app');
    // the double is deaf to the cancel of an `opponent` job and delivers its answer 650 ms late, whatever happened meanwhile
    await installWorkerDouble(page, 'late', 650);
    await ready(page);
    await expect(page.locator('.bubble')).toHaveAttribute('data-state', 'done');
    const start = await pieces(page);
    const before = await taskStats(page);
    expect(before.terminated).toBe(0);

    await confirmCentreCannon(page);
    await expect(app).toHaveAttribute('data-ply', '1');
    await expect(app).toHaveAttribute('data-phase', 'opponentTurn');
    await page.locator('#undo-button').tap();                 // while the rival thinks
    await expect(app).toHaveAttribute('data-ply', '0');
    await expect(app).toHaveAttribute('data-phase', 'childTurn');

    // the late answer arrives, and nothing follows from it
    await expect.poll(async () => (await double(page)).lateDelivered, { timeout: 15000 }).toBe(1);
    await page.waitForTimeout(400);
    await expect(app).toHaveAttribute('data-ply', '0');
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
    expect(await pieces(page)).toBe(start);
    expect(await savedMoves(page)).toEqual([]);

    const after = await taskStats(page);
    expect(after.lateDrops + after.terminated).toBeGreaterThan(0);
    // which of the layers of SPEC 6.4 rejected it: the cancel was never acknowledged, so the 150 ms backstop ended the
    // worker, and the answer of the ended worker was dropped at the dispatch gate
    expect(after.terminated).toBe(before.terminated + 1);
    expect(after.lateDrops).toBeGreaterThan(before.lateDrops);
    expect(after.dead).toBe(false);
    expect((await double(page)).made).toBe(2);                 // one replacement worker

    // the replacement worker plays on: a move pair goes through (its answer is merely late)
    await confirmCentreCannon(page);
    await expect(app).toHaveAttribute('data-ply', '2', { timeout: 15000 });
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
  });
});

test.describe('flow 19', () => {
  test('rival failure', async ({ page }) => {
    const app = page.locator('#app');
    await installWorkerDouble(page, 'error');
    await ready(page);
    await expect(page.locator('.bubble')).toHaveAttribute('data-state', 'done');

    await confirmCentreCannon(page);
    await expect(app).toHaveAttribute('data-ply', '1');
    const retry = page.locator('#retry-opponent');
    const status = page.locator('#underbar [role="status"]');
    await expect(retry).toBeVisible({ timeout: 10000 });
    await expect(status).toBeVisible();
    await expect(status).toHaveText(RIVAL_FAILED);
    await expect(app).toHaveAttribute('data-phase', 'opponentTurn');
    await expect(app).toHaveAttribute('data-ply', '1');
    expect((await double(page)).errors).toBe(2);               // the director retried once before it asked the child (SPEC 6.5)
    // both are under the board
    const board = await page.locator('#board').boundingBox();
    const button = await retry.boundingBox();
    const line = await status.boundingBox();
    if (!board || !button || !line) throw new Error('the board, the retry button or the status line has no box');
    expect(button.y).toBeGreaterThanOrEqual(board.y + board.height);
    expect(line.y).toBeGreaterThanOrEqual(board.y + board.height);

    // the real worker is back: one tap and the game goes on
    await page.evaluate(() => { /** @type {{__workerDouble: {failing: boolean}}} */ (/** @type {unknown} */ (window)).__workerDouble.failing = false; });
    await retry.tap();
    await expect(app).toHaveAttribute('data-ply', '2', { timeout: 15000 });
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
    await expect(retry).toBeHidden();
    await expect(status).toBeHidden();
    const stats = await taskStats(page);
    expect(stats.dead).toBe(false);
    expect(stats.terminated).toBe(0);                          // an {t:'error'} answer fails the job and keeps the worker
    expect((await double(page)).errors).toBe(2);
  });
});

test.describe('flow 21', () => {
  test('worker protocol', async ({ page }) => {
    const app = page.locator('#app');
    await ready(page);
    await expect(page.locator('.bubble')).toHaveAttribute('data-state', 'done');

    // ---- the protocol of SPEC 4.9, spoken to a worker of the test's own ------------------------------------------------
    const run = await page.evaluate(async (fen) => {
      const worker = new Worker('/src/core/search-worker.js', { type: 'module' });
      /** Every message, without its bulky data. @type {{t:string, id:number|null, kind:string|null, stage:string|null, at:number, hasData:boolean}[]} */
      const log = [];
      /** What `ready` said. */
      const greeting = { protocol: 0, speedClass: '', perftNps: 0 };
      /** @type {string[]} */ const faults = [];
      worker.onerror = (event) => { faults.push(String(event.message)); };
      worker.onmessage = (event) => {
        const m = event.data;
        if (m.t === 'ready') Object.assign(greeting, { protocol: m.protocol, speedClass: m.speed?.speedClass, perftNps: m.speed?.perftNps });
        log.push({ t: m.t, id: typeof m.id === 'number' ? m.id : null, kind: m.kind ?? null, stage: m.stage ?? null, at: performance.now(), hasData: m.data !== undefined && m.data !== null });
      };
      /** Waits for a message; fails after `ms` instead of waiting for ever. */
      const until = (/** @type {(m: {t:string, id:number|null}) => boolean} */ match, /** @type {number} */ ms, /** @type {string} */ what) =>
        new Promise((resolve, reject) => {
          const t0 = performance.now();
          const tick = () => {
            const found = log.find(match);
            if (found) resolve(found);
            else if (performance.now() - t0 > ms) reject(new Error(`worker protocol: no ${what} within ${ms} ms`));
            else setTimeout(tick, 5);
          };
          tick();
        });
      const job = (/** @type {number} */ id) => ({ t: 'job', id, kind: 'survey', payload: { fen, history: [], ply: 0, level: 2, tensionPrev: 0, evalTwoPliesAgo: null } });
      try {
        worker.postMessage({ t: 'hello' });
        await until((m) => m.t === 'ready', 8000, 'ready');
        // job 1 runs to its end
        worker.postMessage(job(1));
        await until((m) => m.t === 'done' && m.id === 1, 12000, 'done of job 1');
        // job 2 is running (it has reported progress) when job 3 arrives
        worker.postMessage(job(2));
        await until((m) => m.t === 'progress' && m.id === 2, 8000, 'progress of job 2');
        const supersededAt = performance.now();
        worker.postMessage(job(3));
        await until((m) => m.t === 'done' && m.id === 3, 12000, 'done of job 3');
        // job 4 is cancelled while it runs
        worker.postMessage(job(4));
        await until((m) => m.t === 'progress' && m.id === 4, 8000, 'progress of job 4');
        const cancelledAt = performance.now();
        worker.postMessage({ t: 'cancel', id: 4 });
        await until((m) => m.t === 'cancelled' && m.id === 4, 8000, 'cancelled of job 4');
        await new Promise((resolve) => { setTimeout(resolve, 300); });          // anything that would still follow
        return { greeting, log, faults, supersededAt, cancelledAt };
      } finally {
        worker.terminate();
      }
    }, START_FEN);

    expect(run.faults).toEqual([]);
    // hello -> ready with a speedClass
    expect(run.log[0].t).toBe('ready');
    expect(run.greeting.protocol).toBe(1);
    expect(['fast', 'mid', 'slow']).toContain(run.greeting.speedClass);
    expect(run.greeting.perftNps).toBeGreaterThan(0);
    expect(run.log.filter((m) => m.t === 'ready')).toHaveLength(1);

    const of = (/** @type {number} */ id) => run.log.filter((m) => m.id === id);
    const terminal = (/** @type {{t:string}} */ m) => m.t === 'done' || m.t === 'cancelled' || m.t === 'error';
    // job -> progress* -> done
    const first = of(1);
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(first.slice(0, -1).every((m) => m.t === 'progress' && m.kind === 'survey' && ['facts', 'table', 'threat'].includes(m.stage ?? ''))).toBe(true);
    expect(first[first.length - 1].t).toBe('done');
    expect(first[first.length - 1].kind).toBe('survey');
    expect(first[first.length - 1].hasData).toBe(true);
    // a second job during the first: cancelled, then done
    const second = of(2);
    const third = of(3);
    expect(second[second.length - 1].t).toBe('cancelled');
    expect(third[third.length - 1].t).toBe('done');
    expect(second[second.length - 1].at).toBeLessThan(third[third.length - 1].at);
    expect(third.every((m) => m.at > second[second.length - 1].at)).toBe(true);        // the new job starts when the old one has unwound
    // exactly one terminal message per id, and nothing after it
    for (const id of [1, 2, 3, 4]) {
      const messages = of(id);
      expect(messages.filter(terminal)).toHaveLength(1);
      expect(terminal(messages[messages.length - 1])).toBe(true);
    }
    expect(run.log.every((m) => m.t === 'ready' || [1, 2, 3, 4].includes(m.id ?? -1))).toBe(true);
    // a superseded and a cancelled job are given up promptly: well inside the 150 ms backstop of the task manager
    expect(second[second.length - 1].at - run.supersededAt).toBeLessThan(150);
    const fourth = of(4);
    expect(fourth[fourth.length - 1].t).toBe('cancelled');
    expect(fourth[fourth.length - 1].at - run.cancelledAt).toBeLessThan(150);

    // ---- the same in the game: superseding jobs and cancels never cost the worker (WAVE3-NOTES, B5) -----------------------
    const before = await taskStats(page);
    expect(['fast', 'mid', 'slow']).toContain(before.speedClass);
    await tap(page, 7, 7);
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await tap(page, 7, 4);                                    // an assess job supersedes the survey
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    await tap(page, 7, 5);                                    // the trial is replaced: a job supersedes a job
    await expect(page.locator('.board-cell.is-trial-to[data-row="7"][data-col="5"]')).toHaveCount(1);
    await page.locator('#retract-button').tap();              // a cancel
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await tap(page, 7, 4);
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    await page.locator('#confirm-button').tap();
    await expect(app).toHaveAttribute('data-ply', '1');
    await page.locator('#undo-button').tap();                 // the rival's job is cancelled while it runs
    await expect(app).toHaveAttribute('data-ply', '0');
    await page.waitForTimeout(500);                           // longer than the backstop
    const after = await taskStats(page);
    expect(after.spawned).toBe(before.spawned);
    expect(after.terminated).toBe(before.terminated);
    expect(after.dead).toBe(false);
  });
});
