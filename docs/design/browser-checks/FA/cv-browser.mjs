// browser.mjs (verifier's own): headless Chrome on the real page served by the project's mock server on 127.0.0.1:5347.
import { chromium } from 'file:///C:/Users/USERNAME/git/yijian-xiangqi/node_modules/playwright-core/index.mjs';

export const BASE = 'http://127.0.0.1:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(limitMs) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const kill = setTimeout(() => { console.log('TIME LIMIT'); browser.close().finally(() => process.exit(3)); }, limitMs);
  return { browser, stop: async () => { clearTimeout(kill); await browser.close(); } };
}

/** A fresh page on a new game (?test=1: no start card), with the mock stream slowed to `chunkMs` per 4 characters. */
export async function openGame(browser, { chunkMs = 300, motion = 'no-preference', query = '' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true, reducedMotion: motion });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.route('**/api/coach', (route) => {
    try {
      const body = JSON.parse(route.request().postData() ?? '{}');
      requests.push({ at: Date.now(), kinds: (body.events ?? []).map((e) => e.kind + (e.kind === 'ask' ? `(${e.ask})` : '')).join(',') });
    } catch { /* not ours */ }
    route.continue({ url: route.request().url() + `?chunkMs=${chunkMs}` });
  });
  await page.goto(`${BASE}/?test=1${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.__yijian && window.__yijian.session.getState().phase === 'childTurn', null, { timeout: 20000 });
  return { context, page, requests, errors };
}

export async function centre(page, row, col) {
  const box = await page.locator(`.board-cell[data-row="${row}"][data-col="${col}"]`).boundingBox();
  if (!box) throw new Error(`no board cell at ${row},${col}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
export async function finger(page, row, col) { const at = await centre(page, row, col); await page.touchscreen.tap(at.x, at.y); }

export const game = (page) => page.evaluate(() => {
  const s = window.__yijian.session.getState();
  return { phase: s.phase, ply: s.history.length, trial: s.trial ? s.trial.notation : null, last: s.history.length ? s.history[s.history.length - 1].notation : null };
});

/** What the child can see of the strategist: the bubble, the 回看 log, the send button. */
export const look = (page) => page.evaluate(() => {
  const b = document.querySelector('.bubble');
  const part = (sel) => { const n = b && b.querySelector(sel); return n && !n.hidden ? (n.textContent ?? '').trim() : ''; };
  const dots = b && b.querySelector('.bubble__dots');
  const shown = (n) => !!n && !n.hidden && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden';
  const log = [...document.querySelectorAll('.chat__log .msg')].map((m) => ({
    role: m.dataset.role, kind: m.dataset.kind ?? '', state: m.dataset.state ?? '', typing: m.dataset.typing === '1',
    text: (m.querySelector('.msg__text')?.textContent ?? '').trim(), tag: (m.querySelector('.msg__tag')?.textContent ?? '').trim(),
    links: [...m.querySelectorAll('button')].map((x) => (x.textContent ?? '').trim()),
  }));
  const send = document.querySelector('#chat-send');
  return {
    bubble: b ? { state: b.getAttribute('data-state'), question: part('.bubble__question'), caption: part('.bubble__caption'), text: part('.bubble__text'),
                  dots: shown(dots), stale: part('.bubble__stale'), opacity: getComputedStyle(b).opacity } : null,
    log, send: send ? send.dataset.mode ?? null : null,
    mood: document.querySelector('[data-mood]')?.getAttribute('data-mood') ?? null,
  };
});
export const bubbleStr = (v) => (v.bubble ? `bubble[state=${v.bubble.state} q=${JSON.stringify(v.bubble.question)} caption=${JSON.stringify(v.bubble.caption)} text=${JSON.stringify(v.bubble.text)} dots=${v.bubble.dots} stale=${JSON.stringify(v.bubble.stale)}]` : 'bubble[none]');
export const logStr = (v, n = 4) => v.log.slice(-n).map((m) => `${m.role === 'me' ? 'me' : m.kind}:${m.state}${m.typing ? '+typing' : ''}${m.tag ? '(' + m.tag + ')' : ''}:${JSON.stringify(m.text)}`).join(' ; ');

/** 炮二平五, confirmed by a second tap on the destination; resolves when the move is in the history. */
export async function playCannon(page) {
  await finger(page, 7, 7); await sleep(250); await finger(page, 7, 4);
  await page.waitForFunction(() => window.__yijian.session.getState().phase === 'tentative', null, { timeout: 5000 });
  await sleep(1500);
  await finger(page, 7, 4);
  await page.waitForFunction(() => window.__yijian.session.getState().history.length >= 1, null, { timeout: 5000 });
}
