// Reviewer's scenarios against scripts/serve.js --mock.
// Usage: node rv-mock.mjs <base url> [name ...]
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { sleep, phase, ply, waitFor, waitPhase, tapSel, tapCell, bubble, chips, pieces, start } from '../lib.mjs';
import { createBot, readBoard, playMove, waitTurn } from '../bot.mjs';

const REPO = 'C:\\Users\\USERNAME\\git\\yijian-xiangqi';
const OUT = 'C:\\Users\\USERNA~1\\AppData\\Local\\Temp\\claude\\5884157893c5b410\\a051714c-de36-47da-b3cc-cfc754f60ac3\\scratchpad\\work\\A1\\review\\sc';
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const require = createRequire(`${REPO}\\package.json`);
const { chromium } = require('@playwright/test');

const BASE = process.argv[2];
const wanted = process.argv.slice(3);
const results = [];
const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });

async function scenario(name, opts, body) {
  if (wanted.length && !wanted.includes(name)) return;
  const context = await browser.newContext({
    viewport: { width: opts.w ?? 1180, height: opts.h ?? 820 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: 'zh-CN',
    reducedMotion: opts.reduced === false ? 'no-preference' : 'reduce',
  });
  const page = await context.newPage();
  const consoleErrors = [], pageErrors = [], requests = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on('request', (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`));
  const checks = [];
  const check = (ok, what) => { checks.push({ ok: !!ok, what }); console.log(`  ${ok ? 'ok ' : 'FAIL'} ${what}`); };
  const shot = (n) => page.screenshot({ path: `${OUT}\\mock-${name}-${n}.png` });
  console.log(`\n== ${name}`);
  let error = null;
  const limit = new Promise((_, reject) => setTimeout(() => reject(new Error('scenario time limit')), opts.limit ?? 90000));
  try {
    await Promise.race([body({ page, context, check, shot, requests, consoleErrors }), limit]);
  } catch (e) {
    error = String(e && e.stack ? e.stack : e).slice(0, 600);
    console.log('  ERROR', error);
    await shot('ERROR').catch(() => {});
  }
  check(pageErrors.length === 0, `no page error (${pageErrors.join(' | ')})`);
  const unexpected = consoleErrors.filter((t) => !(opts.allowConsole ?? []).some((re) => re.test(t)));
  check(unexpected.length === 0, `no console error (${unexpected.join(' | ')})`);
  results.push({ name, ok: !error && checks.every((c) => c.ok), failed: checks.filter((c) => !c.ok).map((c) => c.what), error });
  await context.close();
}

const go = (page, path) => page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 20000 });
const ready = (page) => waitFor(page, () => document.documentElement.dataset.ready === '1', null, 15000, 'data-ready');
const coachAttr = (page) => page.evaluate(() => document.querySelector('#app').dataset.coach);
const api = (requests, path) => requests.filter((r) => r.endsWith(path)).length;
const toastText = (page) => page.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent.trim() : ''; });
const waitBubble = (page, re, ms = 8000) => waitFor(page, (src) => {
  const b = document.querySelector('.bubble');
  return !!b && b.getAttribute('data-state') === 'done' && new RegExp(src).test(b.textContent);
}, re.source, ms, `a finished bubble line matching ${re}`);
const clickInSettings = (page, label) => page.evaluate((text) => {
  const sheet = document.querySelector('dialog[data-dialog="settings"]');
  const b = [...sheet.querySelectorAll('button')].find((el) => el.textContent.trim() === text);
  if (!b) return false;
  b.scrollIntoView({ block: 'center' });
  b.click();
  return true;
}, label);

await scenario('start-card-coach-local', {}, async ({ page, check, shot, requests }) => {
  // the child (or a parent) switches the strategist to "this device only" on the start card, before any game
  await go(page, '/index.html');
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-action="settings"]'), null, 8000, 'start card');
  await tapSel(page, 'dialog[data-dialog="start"] [data-action="settings"]');
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="settings"]'), null, 4000, 'the settings sheet');
  await sleep(300);
  check(await clickInSettings(page, '只用本机'), 'coach mode set to local on the start card');
  await sleep(300); await shot('a-settings');
  const text = await page.evaluate(() => document.querySelector('dialog[data-dialog="settings"]').textContent);
  check(/已在设置中选择只用本机/.test(text), 'the sheet gives the reason at once');
  await page.keyboard.press('Escape'); await sleep(450);
  await start(page);
  await waitTurn(page, 0); await sleep(1500);
  check((await coachAttr(page)) === 'local', 'data-coach is local in the game that starts');
  const b = await bubble(page);
  check(b && b.source === 'local', `the greeting is local (${JSON.stringify(b)})`);
  check(api(requests, '/api/health') === 0 && api(requests, '/api/coach') === 0, `the proxy is never asked (${requests.filter((r) => r.includes('/api/')).join(',')})`);
  check(await page.evaluate(() => { const t = document.querySelector('#chat-toggle'); return !t || t.getBoundingClientRect().width === 0; }), 'no free-text button');
});

await scenario('online-event-probes', {}, async ({ page, check, requests }) => {
  await go(page, '/index.html?test=1');
  await ready(page); await waitPhase(page, 'childTurn', 8000);
  await waitBubble(page, /kind=start/);
  const before = api(requests, '/api/health');
  check(before === 1, `one probe at boot (${before})`);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await sleep(800);
  check(api(requests, '/api/health') === before + 1, `the online event probes again (${api(requests, '/api/health')})`);
  check((await coachAttr(page)) === 'llm', 'still llm');
});

await scenario('relative-api-base', {}, async ({ page, check, requests }) => {
  await page.route('**/config.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ apiBase: './api/', build: 'x', coach: { mode: 'mock', reason: null } }) }));
  await go(page, '/index.html?test=1');
  await ready(page); await waitPhase(page, 'childTurn', 8000);
  await waitBubble(page, /kind=start/);
  check(api(requests, '/api/health') === 1 && api(requests, '/api/coach') === 1, `./api/ reaches /api/health and /api/coach (${requests.filter((r) => r.includes('/api/')).join(',')})`);
  check((await coachAttr(page)) === 'llm', 'llm');
});

await scenario('ready-does-not-wait-for-probe', {}, async ({ page, check, requests }) => {
  await page.route('**/api/health', async (r) => { await sleep(2500); await r.continue().catch(() => {}); });
  const t0 = Date.now();
  await go(page, '/index.html?test=1');
  await ready(page);
  const dt = Date.now() - t0;
  check(dt < 2000, `data-ready is set while the health probe is still out (${dt} ms)`);
  await waitPhase(page, 'childTurn', 8000);
  await waitFor(page, () => { const b = document.querySelector('.bubble'); return !!b && b.getAttribute('data-state') === 'done' && b.textContent.length > 0; }, null, 8000, 'a greeting');
  const b = await bubble(page);
  console.log('  greeting', JSON.stringify(b));
  check(b && b.text.length > 0, 'the child is greeted although the probe is slow');
});

await scenario('abort-streams-no-fault', { reduced: false, limit: 120000 }, async ({ page, check, shot, requests }) => {
  // slow streams, then retract / confirm / undo / new game while they run: no toast, no console error
  await page.route('**/api/coach', (r) => r.continue({ url: r.request().url() + '?chunkMs=300' }));
  await go(page, '/index.html');
  await start(page);
  await waitTurn(page, 0); await sleep(800);
  for (let round = 0; round < 3; round++) {
    await waitTurn(page, 0); await sleep(300);
    const before = await ply(page);
    await tapCell(page, 7, 7 - round * 0 ); await sleep(200);
    if ((await phase(page)) !== 'selected') { await tapCell(page, 7, 1); await sleep(200); }
    const bot = createBot({ style: 'strong', seed: round + 1 });
    await page.keyboard.press('Escape'); await sleep(150);
    const move = bot.choose(await readBoard(page));
    await tapCell(page, move.from.row, move.from.col); await waitPhase(page, 'selected', 4000);
    await tapCell(page, move.to.row, move.to.col); await waitPhase(page, 'tentative', 4000);
    await sleep(500);
    await tapSel(page, '.chip[data-ask="reply"]').catch(() => {});      // a question starts streaming ...
    await sleep(500);
    await tapSel(page, '#retract-button');                             // ... and is cut by a retract
    await sleep(300);
    await page.keyboard.press('Escape'); await sleep(150);
    await tapCell(page, move.from.row, move.from.col); await waitPhase(page, 'selected', 4000);
    await tapCell(page, move.to.row, move.to.col); await waitPhase(page, 'tentative', 4000);
    await sleep(350);
    await tapSel(page, '.chip[data-ask="good"]').catch(() => {});
    await sleep(350);
    for (let i = 0; i < 12 && (await phase(page)) === 'tentative'; i++) { await tapSel(page, '#confirm-button'); await sleep(200); }
    await waitTurn(page, before + 2, 30000);
    await sleep(400);
    await tapSel(page, '#undo-button');                                // undo while the rival's line streams
    await waitFor(page, (n) => Number(document.querySelector('#app').dataset.ply) === n, before, 8000, 'undo');
    await sleep(400);
  }
  check((await toastText(page)) === '', `no toast after retract / confirm / undo during streams (${await toastText(page)})`);
  await shot('a');
  const stats = await page.evaluate(async () => (await fetch('/api/mock/stats')).json());
  console.log('  mock stats', JSON.stringify(stats), 'coach requests', api(requests, '/api/coach'));
  check(stats.aborted >= 1, `some requests were really aborted (${JSON.stringify(stats)})`);
});

await browser.close();
console.log('\n' + JSON.stringify(results.map((r) => ({ name: r.name, ok: r.ok, failed: r.failed, error: r.error ? r.error.slice(0, 200) : null })), null, 1));
