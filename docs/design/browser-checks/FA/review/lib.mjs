// Review of package FA: shared helpers of my own browser scripts (headless Chrome through the repo's Playwright).
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';

const require = createRequire('C:/Users/USERNAME/git/yijian-xiangqi/package.json');
const { chromium } = require('@playwright/test');

export const BASE = 'http://127.0.0.1:5173';
export const SIZES = { landscape: { width: 1180, height: 820 }, portrait: { width: 820, height: 1180 }, phone: { width: 360, height: 740 } };
export const KEYS = { game: 'yijian.xiangqi.v2.game', profile: 'yijian.xiangqi.v2.profile', settings: 'yijian.xiangqi.v2.settings' };
export const SHOTS = 'C:/Users/USERNA~1/AppData/Local/Temp/claude/5884157893c5b410/a051714c-de36-47da-b3cc-cfc754f60ac3/scratchpad/work/FA/review/shots';
if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export async function launch() {
  return chromium.launch({ headless: true, executablePath: existsSync(CHROME) ? CHROME : undefined });
}

/** The recorder that runs inside the page before the game: phase changes, the game-over card, clicks, with times. */
function recorder() {
  const rv = { events: [], mark: 0 };
  Object.assign(window, { __rv: rv });
  const describe = (el) => {
    if (!(el instanceof Element)) return String(el);
    const parts = [];
    for (let node = el, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
      let name = node.tagName.toLowerCase();
      if (node.id) name += `#${node.id}`;
      else if (node.classList.length) name += `.${[...node.classList].slice(0, 2).join('.')}`;
      if (node instanceof HTMLElement && node.dataset.choice) name += `[choice=${node.dataset.choice}]`;
      if (node instanceof HTMLElement && node.dataset.menu) name += `[menu=${node.dataset.menu}]`;
      if (node instanceof HTMLElement && node.dataset.ask) name += `[ask=${node.dataset.ask}]`;
      parts.push(name);
      if (node.id) break;
    }
    return parts.join(' < ');
  };
  const log = (kind, extra) => rv.events.push({ t: Math.round(performance.now()), kind, ...extra });
  Object.assign(rv, { log, describe });
  const arm = () => {
    const app = document.getElementById('app');
    const overlays = document.getElementById('overlays');
    if (!app || !overlays) return;
    let phase = app.dataset.phase, ply = app.dataset.ply;
    new MutationObserver(() => {
      if (app.dataset.phase === phase && app.dataset.ply === ply) return;
      phase = app.dataset.phase;
      ply = app.dataset.ply;
      log('phase', { phase, ply });
    }).observe(app, { attributes: true, attributeFilter: ['data-phase', 'data-ply'] });
    let card = false;
    new MutationObserver(() => {
      const up = overlays.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="over"]') !== null;
      if (up === card) return;
      card = up;
      log(up ? 'card-up' : 'card-gone', {});
    }).observe(overlays, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm);
  else arm();
  document.addEventListener('click', (event) => log('click', { on: describe(event.target) }), true);
  document.addEventListener('pointerdown', (event) => log('down', { on: describe(event.target) }), true);
}

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {{size:keyof typeof SIZES, motion:'full'|'reduced', storage?:Record<string,string>, init?:Function, initArg?:unknown}} o
 */
export async function open(browser, o) {
  const context = await browser.newContext({ viewport: SIZES[o.size], hasTouch: true, isMobile: true, baseURL: BASE });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: o.motion === 'reduced' ? 'reduce' : 'no-preference' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 200)}`); });
  // storage is prepared on a blank same-origin page
  await page.route('**/rv-blank.html', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>blank</title>' }));
  await page.goto('/rv-blank.html', { waitUntil: 'load' });
  await page.unroute('**/rv-blank.html');
  await page.evaluate((records) => {
    localStorage.clear();
    for (const [key, text] of Object.entries(records)) localStorage.setItem(key, text);
  }, o.storage ?? {});
  await page.addInitScript(recorder);
  if (o.init) await page.addInitScript(/** @type {any} */ (o.init), o.initArg);
  return { context, page, errors };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {import('@playwright/test').Page} page */
export async function waitReady(page, ms = 15000) {
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1' && document.getElementById('app')?.dataset.phase !== 'boot', null, { timeout: ms });
}

/** @param {import('@playwright/test').Page} page */
export function idle(page, ms = 8000) {
  return page.evaluate((limit) => {
    const ui = /** @type {any} */ (window).__ui;
    if (!ui) return true;
    return Promise.race([ui.idle().then(() => true), new Promise((resolve) => { setTimeout(() => resolve(false), limit); })]);
  }, ms);
}

/** @param {import('@playwright/test').Page} page */
export const phaseOf = (page) => page.evaluate(() => document.getElementById('app')?.dataset.phase ?? '');
/** @param {import('@playwright/test').Page} page */
export const plyOf = (page) => page.evaluate(() => Number(document.getElementById('app')?.dataset.ply ?? '-1'));

/** @param {import('@playwright/test').Page} page @param {string} phase */
export async function waitPhase(page, phase, ms = 10000) {
  await page.waitForFunction((p) => document.getElementById('app')?.dataset.phase === p, phase, { timeout: ms, polling: 20 });
}

/** @param {import('@playwright/test').Page} page @param {string} selector */
export async function centre(page, selector) {
  // never waits: null at once when the element is not there or has no box
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return null;
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, selector);
}

/** @param {import('@playwright/test').Page} page */
export async function tapCell(page, row, col) {
  const at = await centre(page, `.board-cell[data-row="${row}"][data-col="${col}"]`);
  if (!at) throw new Error(`no cell ${row},${col}`);
  await page.touchscreen.tap(at.x, at.y);
}

/** @param {import('@playwright/test').Page} page */
export async function facts(page) {
  return page.evaluate((keys) => {
    const parse = (key) => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } };
    const profile = parse(keys.profile);
    const game = parse(keys.game);
    const y = /** @type {any} */ (window).__yijian;
    const app = document.getElementById('app');
    return {
      now: Math.round(performance.now()),
      phase: app?.dataset.phase, ply: app?.dataset.ply,
      games: profile ? profile.games : null,
      gameId: game ? game.id : null, moves: game ? game.moves.length : null, counted: game ? game.counted : null,
      sessionGame: y ? y.session.getState().gameId : null,
      cardUp: document.querySelector('#overlays .hud-layer:not(.is-closing) > dialog[data-dialog="over"]') !== null,
      me: [...document.querySelectorAll('.msg[data-role="me"]')].map((el) => el.textContent),
    };
  }, KEYS);
}

/** @param {import('@playwright/test').Page} page */
export const events = (page) => page.evaluate(() => /** @type {any} */ (window).__rv.events);
/** @param {import('@playwright/test').Page} page @param {string} kind */
export const mark = (page, kind) => page.evaluate((k) => { const rv = /** @type {any} */ (window).__rv; rv.log(k, {}); return Math.round(performance.now()); }, kind);

export const MATE_FOR_RED = ['7774', '0010', '7434', '1000', '7151', '0010'];
export const MATE_FOR_BLACK = ['9888', '2124', '8898', '2464', '9888', '2747', '8898'];
export const savedGame = (moves, extra = {}) => JSON.stringify({ schema: 2, id: 'g-rvreview01', humanColor: 'red', moves, result: null, startedAt: 1790000000000,
  endedAt: null, activeMs: 1000, counted: false, drawFrom: 0, seed: 7, skill: null, memory: null, start: null, ...extra });

/** A Worker around the real one whose answer to the rival's job carries the move that is forced (his mating move). */
export function forceRivalMove(move) {
  const Real = window.Worker;
  const state = { forced: 0 };
  Object.assign(window, { __rvForce: state });
  class Wrapped {
    constructor(url, options) {
      this.onmessage = null; this.onerror = null; this.onmessageerror = null;
      this.kinds = new Map();
      this.real = new Real(url, options);
      this.real.onmessage = (event) => {
        let data = event.data;
        if (data && data.t === 'done' && this.kinds.get(data.id) === 'opponent' && data.data && data.data.move) {
          data = { ...data, data: { ...data.data, move } };
          state.forced += 1;
        }
        if (this.onmessage) this.onmessage(/** @type {any} */ ({ data }));
      };
      this.real.onerror = (event) => { if (this.onerror) this.onerror(event); };
    }
    postMessage(message) {
      if (message && message.t === 'job') this.kinds.set(message.id, message.kind);
      this.real.postMessage(message);
    }
    terminate() { this.real.terminate(); }
    addEventListener() {}
    removeEventListener() {}
  }
  Object.assign(window, { Worker: Wrapped });
}
