// The engine dies while the start card is still up: what the child sees, and whether the retry leads into a game.
// Usage: node rv-dead.mjs <base url>
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { sleep, phase, ply, waitFor, waitPhase, tapSel, tapCell } from '../lib.mjs';
import { createBot, readBoard, playMove, waitTurn } from '../bot.mjs';

const REPO = 'C:\\Users\\USERNAME\\git\\yijian-xiangqi';
const OUT = 'C:\\Users\\USERNA~1\\AppData\\Local\\Temp\\claude\\5884157893c5b410\\a051714c-de36-47da-b3cc-cfc754f60ac3\\scratchpad\\work\\A1\\review\\sc';
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const require = createRequire(`${REPO}\\package.json`);
const { chromium } = require('@playwright/test');
const BASE = process.argv[2];

const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
const check = (ok, what) => console.log(`  ${ok ? 'ok ' : 'FAIL'} ${what}`);
try {
  await page.addInitScript(() => {
    const Real = window.Worker;
    window.__workerBroken = true;
    window.Worker = function (...args) { if (window.__workerBroken) throw new Error('no worker today'); return new Real(...args); };
  });
  await page.goto(`${BASE}/index.html?coach=off`, { waitUntil: 'load' });
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice]'), null, 8000, 'start card');
  const t0 = Date.now();
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="blocking"]'), null, 20000, 'the blocking notice while the start card waits');
  console.log(`  the notice came ${Date.now() - t0} ms after the start card`);
  await sleep(400);
  await page.screenshot({ path: `${OUT}\\dead-on-start-a.png` });
  const state = await page.evaluate(() => {
    const b = document.querySelector('dialog[data-dialog="blocking"]');
    const s = document.querySelector('dialog[data-dialog="start"]');
    const r = b.querySelector('[data-choice="retry"]').getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { startStillThere: !!s, retryOnTop: !!top && !!top.closest('dialog[data-dialog="blocking"]') };
  });
  check(state.retryOnTop, `the retry button is on top and can be tapped (${JSON.stringify(state)})`);
  await page.evaluate(() => { window.__workerBroken = false; });
  await tapSel(page, 'dialog[data-dialog="blocking"] [data-choice="retry"]');
  await waitFor(page, () => document.querySelector('dialog[data-dialog="blocking"]') === null, null, 8000, 'the notice goes');
  await sleep(500);
  await page.screenshot({ path: `${OUT}\\dead-on-start-b.png` });
  check(await page.evaluate(() => !!document.querySelector('dialog[data-dialog="start"] [data-choice]')), 'the start card is still there after the retry');
  check((await phase(page)) === 'boot', 'no game yet');
  await tapSel(page, 'dialog[data-dialog="start"] .hud-start__go');
  await waitTurn(page, 0, 15000); await sleep(300);
  const bot = createBot({ style: 'strong' });
  await playMove(page, bot.choose(await readBoard(page)), {});
  await waitTurn(page, 2, 20000);
  check((await ply(page)) === 2, 'the game starts and the rival answers');
  check(pageErrors.length === 0, `no page error (${pageErrors.join(' | ')})`);
} catch (e) {
  console.log('  ERROR', String(e && e.stack ? e.stack : e).slice(0, 500));
  await page.screenshot({ path: `${OUT}\\dead-on-start-ERROR.png` }).catch(() => {});
}
await browser.close();
