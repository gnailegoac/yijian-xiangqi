// tests/e2e/helpers.js (E1): shared by the end-to-end flows of SPEC 14.7.
//
// The six helpers the contract names are ready, tap, phase, ply, bubble and pieces. The rest is what more than one
// spec file needs: the storage keys and save fixtures, playing a move, a stopwatch inside the page, a watch on
// console errors and proxy requests, the mock proxy's counters and the Worker doubles of flows 6 and 19.
//
// How the flows are written:
// - Every flow is one test named as in SPEC 14.7, inside test.describe('flow N'). Flows tagged @smoke or @layout
//   also run in the projects ipad-portrait and phone-360 (playwright.config.js).
// - Taps are finger taps (page.touchscreen, locator.tap); the game is loaded with `?test=1` and reduced motion
//   unless a flow says otherwise. The rival's answers differ from run to run, so no flow relies on one: a flow that
//   needs "a move" asks the board for a legal one (tryAnyMove), and positions that must be exact come from a save.
// - Times the contract bounds (150 ms, 300 ms, the guard) are measured inside the page (stopwatch), not by the runner.
// - Expected Chinese text is the contract's where 14.7 names it; notices are compared with src/game/strings.js.
//
// Memory safety (CONTRACT-NOTES 125, 128): every wait here has a bound and nothing bulky is compared.
//
// The test server: playwright.config.js starts `scripts/serve.js --mock` with placeholder gateway variables. The
// proxy's rate limits count in mock mode too; see explainProxyLimit below before keeping one server for many runs.
import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';

/** @import { Page } from '@playwright/test' */

/** The localStorage keys of SPEC 4.20. */
export const KEYS = Object.freeze({
  game: 'yijian.xiangqi.v2.game',
  settings: 'yijian.xiangqi.v2.settings',
  profile: 'yijian.xiangqi.v2.profile',
  migrated: 'yijian.xiangqi.v2.migrated',
  quarantine: 'yijian.xiangqi.quarantine',
  v1: 'yijian.xiangqi.v1',
});

/** A same-origin address that the test answers itself with an empty page: storage is prepared there before the game is loaded. */
const BLANK = '/e2e-blank.html';
const BLANK_PAGE = '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>blank</title>';

/**
 * The raw text of a save fixture of SPEC 13.6 (tests/fixtures/saves).
 * @param {string} name file name, for example 'v2-one-before-mate.json'
 * @returns {string}
 */
export function saveFixture(name) {
  return readFileSync(new URL(`../fixtures/saves/${name}`, import.meta.url), 'utf8');
}

/**
 * Writes records into the origin's localStorage before the game is loaded (the page is left on a blank address).
 * @param {Page} page
 * @param {Record<string, string>} records key -> raw text
 * @param {{clear?: boolean}} [options] clear = empty the storage first
 * @returns {Promise<void>}
 */
export async function seedStorage(page, records, options = {}) {
  await page.route(`**${BLANK}`, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: BLANK_PAGE }));
  await page.goto(BLANK, { waitUntil: 'load' });
  await page.unroute(`**${BLANK}`);
  await page.evaluate(([entries, clear]) => {
    if (clear) localStorage.clear();
    for (const [key, text] of Object.entries(entries)) localStorage.setItem(key, text);
  }, /** @type {[Record<string, string>, boolean]} */ ([records, options.clear === true]));
}

/**
 * One record of the origin's localStorage, or null.
 * @param {Page} page
 * @param {string} key
 * @returns {Promise<string|null>}
 */
export function stored(page, key) {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

/**
 * The move list of the saved game record ([] when there is none).
 * @param {Page} page
 * @returns {Promise<string[]>}
 */
export async function savedMoves(page) {
  const text = await stored(page, KEYS.game);
  if (text === null) return [];
  const moves = JSON.parse(text).moves;
  return Array.isArray(moves) ? moves : [];
}

/**
 * Loads the game with `?test=1` (no start overlay) and waits until it can be played: html[data-ready="1"], a phase
 * other than boot, the stage idle (the deal has landed) and, on the child's turn, the board taking taps.
 * @param {Page} page
 * @param {{query?: string, motion?: 'reduce'|'no-preference'}} [options] query = further URL parameters ('coach=off')
 * @returns {Promise<void>}
 */
export async function ready(page, options = {}) {
  await page.emulateMedia({ reducedMotion: options.motion ?? 'reduce' });
  await page.goto(`/?test=1${options.query ? `&${options.query}` : ''}`, { waitUntil: 'load' });
  await settled(page);
}

/**
 * The second half of `ready`, for a page that was loaded or reloaded by the test itself.
 * @param {Page} page
 * @returns {Promise<void>}
 */
export async function settled(page) {
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1', { timeout: 15000 });
  await expect(page.locator('#app')).not.toHaveAttribute('data-phase', 'boot', { timeout: 10000 });
  await idle(page);
  if (await phase(page) === 'childTurn') await expect(page.locator('#board')).toHaveClass(/is-interactive/);
}

/**
 * Waits until no stage cue is in flight and no local line is waiting (window.__ui.idle of `?test=1`), at most `ms`.
 * @param {Page} page
 * @param {number} [ms]
 * @returns {Promise<boolean>} false when the stage was still busy after `ms`
 */
export function idle(page, ms = 8000) {
  return page.evaluate((limit) => {
    const ui = /** @type {{__ui?: {idle: () => Promise<void>}}} */ (/** @type {unknown} */ (window)).__ui;
    if (!ui) return true;
    return Promise.race([
      ui.idle().then(() => true),
      new Promise((resolve) => { setTimeout(() => resolve(false), limit); }),
    ]);
  }, ms);
}

/**
 * The centre of a board cell in viewport pixels.
 * @param {Page} page @param {number} row @param {number} col
 * @returns {Promise<{x:number, y:number}>}
 */
export async function cellCentre(page, row, col) {
  const box = await page.locator(`.board-cell[data-row="${row}"][data-col="${col}"]`).boundingBox();
  if (!box) throw new Error(`no board cell at ${row},${col}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A finger tap on the board cell (row, col); rows and columns as in SPEC 3.1 (row 0 is black's back rank).
 * @param {Page} page @param {number} row @param {number} col
 * @returns {Promise<void>}
 */
export async function tap(page, row, col) {
  const at = await cellCentre(page, row, col);
  await page.touchscreen.tap(at.x, at.y);
}

/**
 * The centre of an element in viewport pixels.
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<{x:number, y:number}>}
 */
export async function centreOf(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('the element has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Two finger taps on the centre of an element, `gap` ms apart: what children do. The element must be able to take
 * the first tap (a button that has just come up is held for a moment, and the helper waits for it like a finger
 * that sees the button); the second tap goes to the same point, whatever lies there by then.
 * @param {Page} page
 * @param {import('@playwright/test').Locator} locator
 * @param {number} [gap]
 * @returns {Promise<void>}
 */
export async function doubleTap(page, locator, gap = 200) {
  await locator.tap({ trial: true });
  const at = await centreOf(locator);
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForTimeout(gap);
  await page.touchscreen.tap(at.x, at.y);
}

/**
 * Opens the conversation sheet the way a child does on every layout: a tap on the speech bubble. The tap lands on a
 * point of the bubble that is not a move link (a link keeps its own tap, and its touch area is larger than its text).
 * @param {Page} page
 * @returns {Promise<void>}
 */
export async function openSheet(page) {
  // The browser moves a finger tap to a button close by (touch adjustment), so the point is the one of the bubble
  // that lies farthest from every button of the page.
  const point = await page.evaluate(() => {
    const el = document.querySelector('.bubble');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const controls = [...document.querySelectorAll('button, a, input, textarea, select')]
      .map((control) => control.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    /** @type {{x:number, y:number, clear:number}|null} */
    let best = null;
    for (let iy = 1; iy < 8; iy++) {
      for (let ix = 1; ix < 24; ix++) {
        const x = b.left + (b.width * ix) / 24;
        const y = b.top + (b.height * iy) / 8;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !el.contains(hit) || hit.closest('button, a, input, textarea, select')) continue;
        let clear = Infinity;
        for (const r of controls) {
          const dx = Math.max(r.left - x, 0, x - r.right);
          const dy = Math.max(r.top - y, 0, y - r.bottom);
          clear = Math.min(clear, Math.hypot(dx, dy));
        }
        if (!best || clear > best.clear) best = { x, y, clear };
      }
    }
    return best;
  });
  if (!point) throw new Error('the bubble has no free point to tap');
  await page.touchscreen.tap(point.x, point.y);
  await expect(page.locator('#app')).toHaveAttribute('data-sheet', '1');
}

/**
 * #app[data-phase].
 * @param {Page} page
 * @returns {Promise<string|null>}
 */
export function phase(page) {
  return page.locator('#app').getAttribute('data-phase');
}

/**
 * #app[data-ply] as a number.
 * @param {Page} page
 * @returns {Promise<number>}
 */
export async function ply(page) {
  return Number(await page.locator('#app').getAttribute('data-ply'));
}

/**
 * The speech bubble: its state, source, interjection tag and text; null when there is none.
 * @param {Page} page
 * @returns {Promise<{state:string|null, source:string|null, tag:string, text:string}|null>}
 */
export function bubble(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.bubble');
    if (!el) return null;
    const part = (/** @type {string} */ sel) => {
      const node = /** @type {HTMLElement|null} */ (el.querySelector(sel));
      return node && !node.hidden ? (node.textContent ?? '').trim() : '';
    };
    return { state: el.getAttribute('data-state'), source: el.getAttribute('data-source'), tag: part('.bubble__tag'), text: part('.bubble__text') };
  });
}

/**
 * The position as the board shows it: every real piece (ghost copies have no data-id) as `<colour initial><type>@<row><col>`,
 * sorted and joined with spaces. Two equal strings are the same position.
 * @param {Page} page
 * @returns {Promise<string>}
 */
export function pieces(page) {
  return page.evaluate(() => [...document.querySelectorAll('.board-cell[data-piece]')]
    .map((cell) => {
      const c = /** @type {HTMLElement} */ (cell);
      if (!c.dataset.piece) return '';
      const p = /** @type {HTMLElement|null} */ (document.querySelector(`.piece[data-id="${c.dataset.piece}"]`));
      return p ? `${(p.dataset.color ?? '?')[0]}${p.dataset.type}@${c.dataset.row}${c.dataset.col}` : `?@${c.dataset.row}${c.dataset.col}`;
    })
    .filter((s) => s !== '')
    .sort()
    .join(' '));
}

/**
 * Confirms the trial on the board with the second tap on its destination (D-32), then waits for the rival's answer.
 * @param {Page} page
 * @param {[number, number]} to the trial's destination [row, col]
 * @param {number} before plies played before the move
 * @returns {Promise<void>} resolves on the child's next turn (or at game over)
 */
async function confirmTrial(page, to, before) {
  const app = page.locator('#app');
  // the guard on the destination is 200 ms from landing, 700 ms for a blunder: tap until the move is taken
  await expect(async () => {
    if (await phase(page) === 'tentative') await tap(page, to[0], to[1]);
    expect(await phase(page)).not.toBe('tentative');
  }).toPass({ intervals: [350, 250, 250, 250, 250], timeout: 6000 });
  await expect(app).toHaveAttribute('data-phase', /^(childTurn|over)$/, { timeout: 15000 });
  if (await phase(page) === 'childTurn') expect(await ply(page)).toBe(before + 2);
  await idle(page);
}

/**
 * Plays one child move: the piece, the target, then the second tap on the target; waits for the rival's answer.
 * @param {Page} page
 * @param {[number, number]} from [row, col]
 * @param {[number, number]} to [row, col]
 * @returns {Promise<void>} resolves on the child's next turn (or at game over)
 */
export async function playMove(page, from, to) {
  const app = page.locator('#app');
  const before = await ply(page);
  await tap(page, from[0], from[1]);
  await expect(app).toHaveAttribute('data-phase', 'selected');
  await tap(page, to[0], to[1]);
  await expect(app).toHaveAttribute('data-phase', 'tentative');
  await confirmTrial(page, to, before);
}

/**
 * Puts some legal move of the child on the board as a trial, whatever the position is: the first own piece (pawns
 * first) that shows a marked target, and its first target. The rival's answers differ from run to run, so a flow
 * that only needs "a move" asks the board which ones there are.
 * @param {Page} page
 * @returns {Promise<{from: [number, number], to: [number, number], code: string}>} code = the MoveCode of SPEC 3.1
 */
export async function tryAnyMove(page) {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-phase', 'childTurn');
  const mine = await page.evaluate(() => {
    const bottom = /** @type {HTMLElement} */ (document.querySelector('#board')).dataset.bottom;
    /** @type {[number, number, string][]} */ const list = [];
    for (const cell of document.querySelectorAll('.board-cell[data-piece]')) {
      const c = /** @type {HTMLElement} */ (cell);
      if (!c.dataset.piece) continue;
      const p = /** @type {HTMLElement|null} */ (document.querySelector(`.piece[data-id="${c.dataset.piece}"]`));
      if (p && p.dataset.color === bottom) list.push([Number(c.dataset.row), Number(c.dataset.col), p.dataset.type ?? '']);
    }
    return list.sort((a, b) => Number(b[2] === 'pawn') - Number(a[2] === 'pawn'));
  });
  for (const [row, col] of mine) {
    await tap(page, row, col);
    if (await phase(page) !== 'selected') continue;          // a piece without a legal move is refused
    const target = page.locator('.board-cell.is-legal, .board-cell.is-capture').first();
    if (await target.count() === 0) {                        // only forbidden targets: put it down again
      await tap(page, row, col);
      await expect(app).toHaveAttribute('data-phase', 'childTurn');
      continue;
    }
    /** @type {[number, number]} */
    const to = [Number(await target.getAttribute('data-row')), Number(await target.getAttribute('data-col'))];
    await tap(page, to[0], to[1]);
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    return { from: [row, col], to, code: `${row}${col}${to[0]}${to[1]}` };
  }
  throw new Error('the child has no legal move in this position');
}

/**
 * Plays some legal move of the child (see tryAnyMove) and waits for the rival's answer.
 * @param {Page} page
 * @returns {Promise<string>} the MoveCode that was played
 */
export async function playAnyMove(page) {
  const before = await ply(page);
  const move = await tryAnyMove(page);
  await confirmTrial(page, move.to, before);
  return move.code;
}

/**
 * Starts a stopwatch inside the page: the time of every finger lift (pointerup) and, for each named CSS selector,
 * the first moment an element matches it. All times are performance.now() of the page, so they do not include the
 * round trip of the test runner. Starting it again forgets the earlier times.
 * @param {Page} page
 * @param {Record<string, string>} selectors name -> CSS selector
 * @returns {Promise<void>}
 */
export function stopwatch(page, selectors) {
  return page.evaluate((list) => {
    const host = /** @type {{__watch?: {ups: number[], first: Record<string, number>, stop: () => void}}} */ (/** @type {unknown} */ (window));
    host.__watch?.stop();
    /** @type {number[]} */ const ups = [];
    /** @type {Record<string, number>} */ const first = {};
    const onUp = () => { ups.push(performance.now()); };
    const check = () => {
      for (const [name, selector] of Object.entries(list)) {
        if (!(name in first) && document.querySelector(selector)) first[name] = performance.now();
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    window.addEventListener('pointerup', onUp, true);
    host.__watch = { ups, first, stop: () => { observer.disconnect(); window.removeEventListener('pointerup', onUp, true); } };
  }, selectors);
}

/**
 * What the stopwatch has seen so far.
 * @param {Page} page
 * @returns {Promise<{ups: number[], first: Record<string, number>}>}
 */
export function laps(page) {
  return page.evaluate(() => {
    const watch = /** @type {{__watch: {ups: number[], first: Record<string, number>}}} */ (/** @type {unknown} */ (window)).__watch;
    return { ups: [...watch.ups], first: { ...watch.first } };
  });
}

/**
 * Collects what a flow asserts on afterwards: console errors, uncaught page errors and the requests to the proxy.
 * @param {Page} page
 * @returns {{errors: string[], api: string[], coach: () => number}} api = `METHOD /api/...` in order; coach() = POSTs to /api/coach
 */
export function watch(page) {
  /** @type {string[]} */ const errors = [];
  /** @type {string[]} */ const api = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().slice(0, 300)); });
  page.on('pageerror', (error) => { errors.push(String(error).slice(0, 300)); });
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) api.push(`${request.method()} ${path}`);
  });
  return { errors, api, coach: () => api.filter((line) => line === 'POST /api/coach').length };
}

/**
 * GET /api/mock/stats of the mock proxy (SPEC 7.8).
 * @param {Page} page
 * @returns {Promise<{started:number, completed:number, aborted:number}>}
 */
export async function mockStats(page) {
  const response = await page.request.get('/api/mock/stats', { timeout: 5000 });
  expect(response.status()).toBe(200);
  return response.json();
}

/**
 * POST /api/mock/reset.
 * @param {Page} page
 * @returns {Promise<void>}
 */
export async function mockReset(page) {
  const response = await page.request.post('/api/mock/reset', { timeout: 5000 });
  expect(response.ok()).toBe(true);
}

/**
 * Sends every coach request with further mock options (SPEC 7.8), for example 'chunkMs=400'.
 * @param {Page} page
 * @param {string} query
 * @returns {Promise<void>}
 */
export async function mockOptions(page, query) {
  await page.route('**/api/coach', (route) => route.continue({ url: `${route.request().url()}?${query}` }));
}

/**
 * Registers a hook that explains one way a flow can fail for a reason outside the game: the proxy's limits also count
 * in mock mode (30 requests a minute with a burst of 20, and COACH_IP_DAILY, 600 a day, for one address). One run of
 * the suite makes about 70 coach requests, so a test server that is kept running refuses them (HTTP 429) after about
 * eight runs in one UTC day, and every flow that expects the mock's text fails. The hook runs only after a failed test
 * and makes one request of its own.
 * @param {typeof import('@playwright/test').test} test
 * @returns {void}
 */
export function explainProxyLimit(test) {
  test.afterEach(async ({ request }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    const origin = testInfo.project.use.baseURL ?? '';
    const response = await request.post('/api/coach', { data: {}, headers: { origin }, timeout: 5000, failOnStatusCode: false }).catch(() => null);
    if (!response || response.status() !== 429) return;
    const text = `The test server on ${origin} refuses coach requests (HTTP 429, retry-after `
      + `${response.headers()['retry-after'] ?? '?'} s): its rate limit or its daily cap is used up, so the strategist went local. `
      + 'Stop that server and run again (Playwright starts a fresh one), or start it with a larger COACH_IP_DAILY.';
    testInfo.annotations.push({ type: 'proxy limit', description: text });
    console.error(`[e2e] ${text}`);
  });
}

/**
 * Replaces window.Worker by a double around the real engine worker, before the game loads (flows 6 and 19).
 *
 * mode 'late':  the answer to an `opponent` job is held back for `lateMs` and is delivered even after the job was
 *               cancelled and the worker terminated; the cancel is never acknowledged.
 * mode 'error': while `window.__workerDouble.failing` is true an `opponent` job is answered with {t:'error'};
 *               setting it to false restores the real worker's behaviour.
 *
 * `window.__workerDouble` = {made, failing, errors, lateSent, lateDelivered}: workers created, the switch of mode
 * 'error', error answers given, late answers scheduled and delivered.
 * @param {Page} page
 * @param {'late'|'error'} mode
 * @param {number} [lateMs]
 * @returns {Promise<void>}
 */
export async function installWorkerDouble(page, mode, lateMs = 650) {
  await page.addInitScript(([kind, holdMs]) => {
    const RealWorker = window.Worker;
    const state = { made: 0, failing: kind === 'error', errors: 0, lateSent: 0, lateDelivered: 0 };
    Object.assign(window, { __workerDouble: state });
    /** How long a terminated double keeps its real worker so that the late answer can still be computed. */
    const KEEP_MS = 5000;

    class WorkerDouble {
      /** @param {string|URL} url @param {WorkerOptions} [options] */
      constructor(url, options) {
        state.made += 1;
        /** @type {((event: MessageEvent) => void)|null} */ this.onmessage = null;
        /** @type {((event: ErrorEvent) => void)|null} */ this.onerror = null;
        /** @type {((event: MessageEvent) => void)|null} */ this.onmessageerror = null;
        this.terminated = false;
        /** Ids of the `opponent` jobs whose answer is held back. @type {Set<number>} */
        this.late = new Set();
        this.real = new RealWorker(url, options);
        this.real.onmessage = (event) => this.fromReal(event.data);
        this.real.onerror = (event) => { if (!this.terminated && this.onerror) this.onerror(event); };
      }

      /** @param {{t?: string, id?: number, message?: string}} data */
      deliver(data) {
        if (this.onmessage) this.onmessage(/** @type {MessageEvent} */ ({ data }));
      }

      /** @param {{t?: string, id?: number}} data */
      fromReal(data) {
        const id = typeof data.id === 'number' ? data.id : -1;
        if (this.late.has(id)) {
          if (data.t === 'progress') return;                 // a worker that is stuck reports nothing meanwhile
          this.late.delete(id);
          state.lateSent += 1;
          setTimeout(() => {                                 // delivered whatever happened to the job meanwhile
            state.lateDelivered += 1;
            this.deliver(data);
            if (this.terminated && this.late.size === 0) this.real.terminate();
          }, holdMs);
          return;
        }
        if (!this.terminated) this.deliver(data);
      }

      /** @param {{t?: string, id?: number, kind?: string}} message */
      postMessage(message) {
        if (this.terminated) return;
        if (message.t === 'job' && message.kind === 'opponent' && typeof message.id === 'number') {
          if (kind === 'error' && state.failing) {
            const id = message.id;
            setTimeout(() => {
              if (this.terminated) return;
              state.errors += 1;
              this.deliver({ t: 'error', id, message: 'worker double: the opponent job failed' });
            }, 0);
            return;
          }
          if (kind === 'late') this.late.add(message.id);
        }
        if (message.t === 'cancel' && typeof message.id === 'number' && this.late.has(message.id)) return;      // deaf to the cancel
        this.real.postMessage(message);
      }

      terminate() {
        if (this.terminated) return;
        this.terminated = true;
        if (this.late.size === 0) this.real.terminate();
        else setTimeout(() => this.real.terminate(), KEEP_MS);
      }

      /** @returns {void} */
      addEventListener() {}
      /** @returns {void} */
      removeEventListener() {}
    }
    Object.assign(window, { Worker: WorkerDouble });
  }, /** @type {[string, number]} */ ([mode, lateMs]));
}

/**
 * window.__yijian.tasks.stats() of `?test=1` (SPEC 4.19, 14.9).
 * @param {Page} page
 * @returns {Promise<{spawned:number, terminated:number, lateDrops:number, live:number, dead:boolean, speedClass:string|null}>}
 */
export function taskStats(page) {
  return page.evaluate(() => {
    /** @typedef {{spawned:number, terminated:number, lateDrops:number, live:number, dead:boolean, speedClass:string|null}} Stats */
    const game = /** @type {{__yijian: {tasks: {stats: () => Stats}}}} */ (/** @type {unknown} */ (window)).__yijian;
    return game.tasks.stats();
  });
}
