// Scenario checks against the project's server in mock mode (scripts/serve.js --mock).
// Usage: node scenarios-mock.mjs <base url> [name ...]
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { sleep, phase, ply, waitFor, waitPhase, tapSel, tapCell, bubble, chips, pieces, start } from './lib.mjs';
import { createBot, readBoard, playMove, waitTurn } from './bot.mjs';

const REPO = 'C:\\Users\\USERNAME\\git\\yijian-xiangqi';
const OUT = 'C:\\Users\\USERNA~1\\AppData\\Local\\Temp\\claude\\5884157893c5b410\\a051714c-de36-47da-b3cc-cfc754f60ac3\\scratchpad\\work\\A1\\sc';
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
    await Promise.race([body({ page, check, shot, requests, consoleErrors }), limit]);
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
const coachAttr = (page) => page.evaluate(() => document.querySelector('#app').dataset.coach);
const api = (requests, path) => requests.filter((r) => r.endsWith(path)).length;
const waitBubble = (page, re, ms = 8000) => waitFor(page, (src) => {
  const b = document.querySelector('.bubble');
  return !!b && b.getAttribute('data-state') === 'done' && new RegExp(src).test(b.textContent);
}, re.source, ms, `a finished bubble line matching ${re}`);
const openSettings = async (page) => {
  await tapSel(page, '#menu-button'); await sleep(450);
  await page.evaluate(() => { [...document.querySelectorAll('.hud-menu__item')].find((b) => b.dataset.menu === 'settings')?.click(); });
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="settings"]'), null, 4000, 'the settings sheet');
  await sleep(300);
};
const clickInSettings = (page, label) => page.evaluate((text) => {
  const sheet = document.querySelector('dialog[data-dialog="settings"]');
  const b = [...sheet.querySelectorAll('button')].find((el) => el.textContent.trim() === text);
  if (!b) return false;
  b.scrollIntoView({ block: 'center' });
  b.click();
  return true;
}, label);
const closeSettings = async (page) => { await page.keyboard.press('Escape'); await sleep(450); };

await scenario('llm-boot', {}, async ({ page, check, shot, requests }) => {
  await go(page, '/index.html');
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice]'), null, 8000, 'start card');
  check(api(requests, '/config.json') === 1, 'config.json was asked once');
  check(api(requests, '/api/health') === 0 && api(requests, '/api/coach') === 0, 'nothing asks the proxy before the start choice');
  await start(page);
  await waitTurn(page, 0);
  await waitBubble(page, /kind=start/);
  check((await coachAttr(page)) === 'llm', 'data-coach is llm');
  const b = await bubble(page);
  check(b.source === 'llm' && /kind=start/.test(b.text), `the greeting is streamed from the proxy (${b.text})`);
  check(api(requests, '/api/health') === 1, `one health probe (${api(requests, '/api/health')})`);
  check(api(requests, '/api/coach') === 1, `one coach request for the start event (${api(requests, '/api/coach')})`);
  check(await page.evaluate(() => { const t = document.querySelector('#chat-toggle'); return !!t && t.getBoundingClientRect().width > 0; }), 'the ✎ button is offered');
  await shot('a');
});

await scenario('coach-off-param', {}, async ({ page, check, shot, requests }) => {
  await go(page, '/index.html?coach=off');
  await start(page);
  await waitTurn(page, 0); await sleep(600);
  check((await coachAttr(page)) === 'local', 'data-coach is local');
  const bot = createBot({ style: 'strong' });
  for (let n = 1; n <= 2; n++) {
    await waitTurn(page, 0); await sleep(300);
    const before = await ply(page);
    await playMove(page, bot.choose(await readBoard(page)), { think: 600 });
    await waitTurn(page, before + 2);
  }
  await tapSel(page, '#hint-button'); await sleep(900);
  check(requests.filter((r) => r.includes('/api/')).length === 0 && api(requests, '/config.json') === 0,
        `no request to /api and none for config.json (${requests.filter((r) => r.includes('/api/') || r.includes('config')).join(',')})`);
  check(await page.evaluate(() => { const t = document.querySelector('#chat-toggle'); return !t || t.getBoundingClientRect().width === 0; }), 'no ✎ button');
  check(await page.evaluate(() => !document.body.innerText.includes('离线')), 'nothing on the page says 离线');
  await openSettings(page);
  const text = await page.evaluate(() => document.querySelector('dialog[data-dialog="settings"]').textContent);
  check(/已在设置中选择只用本机/.test(text), 'the settings sheet gives the reason "setting"');
  await shot('a-settings');
});

await scenario('coach-setting-live', {}, async ({ page, check, shot, requests }) => {
  await go(page, '/index.html');
  await start(page);
  await waitTurn(page, 0);
  await waitBubble(page, /kind=start/);
  check((await coachAttr(page)) === 'llm', 'starts in llm mode');
  await openSettings(page);
  check(await clickInSettings(page, '只用本机'), 'the setting 军师模式 can be set to 只用本机');
  await sleep(400);
  check((await coachAttr(page)) === 'local', 'data-coach flips to local at once');
  await shot('a-local');
  await closeSettings(page);
  const before = api(requests, '/api/coach');
  // a capture trial is always spoken
  const bot = createBot({ style: 'strong' });
  await waitTurn(page, 0); await sleep(300);
  await tapCell(page, 7, 7); await waitPhase(page, 'selected', 4000);
  await tapCell(page, 0, 7); await waitPhase(page, 'tentative', 4000);      // the cannon takes the horse
  await sleep(1500);
  const local = await bubble(page);
  check(local && local.source === 'local' && local.text.length > 0, `the trial is answered by the local strategist (${JSON.stringify(local)})`);
  check(api(requests, '/api/coach') === before, 'no coach request while the setting is local');
  await tapSel(page, '#retract-button'); await waitPhase(page, 'selected', 4000);
  await tapCell(page, 7, 7); await sleep(300);
  await openSettings(page);
  check(await clickInSettings(page, '自动'), 'back to 自动');
  await waitFor(page, () => document.querySelector('#app').dataset.coach === 'llm', null, 6000, 'llm again').catch(() => {});
  check((await coachAttr(page)) === 'llm', 'data-coach is llm again');
  await closeSettings(page);
  await tapCell(page, 7, 7); await waitPhase(page, 'selected', 4000);
  await tapCell(page, 0, 7); await waitPhase(page, 'tentative', 4000);
  await sleep(1800);
  // the same move was assessed before; a retried move may be answered from the thread's record, so only the mode is asserted
  console.log('  bubble after switching back', JSON.stringify(await bubble(page)), 'coach requests', api(requests, '/api/coach') - before);
  void bot;
});

await scenario('free-text-tool', {}, async ({ page, check, shot, requests }) => {
  await go(page, '/index.html');
  await start(page);
  await waitTurn(page, 0);
  await waitBubble(page, /kind=start/);
  await sleep(400);
  await tapSel(page, '#chat-toggle');
  await waitFor(page, () => { const i = document.querySelector('#chat-input'); return !!i && i.getBoundingClientRect().width > 0; }, null, 4000, 'the input');
  await sleep(300); await shot('a-input');
  await page.fill('#chat-input', '炮二平五好不好？');
  await tapSel(page, '#chat-send');
  await sleep(250); await shot('b-asked');
  let sawTool = false;
  for (let i = 0; i < 60 && !sawTool; i++) { sawTool = await page.evaluate(() => !!document.querySelector('.chat-tool')); if (!sawTool) await sleep(50); }
  const done = await waitFor(page, () => {
    const msgs = [...document.querySelectorAll('.msg[data-role="buddy"]')];
    const last = msgs[msgs.length - 1];
    return last && last.dataset.state === 'done' && /kind=(tool|ask)/.test(last.textContent) ? last.textContent.trim() : null;
  }, null, 12000, 'the answer to the typed question');
  await sleep(300); await shot('c-answer');
  check(/kind=tool/.test(done), `a typed question with a move is answered through the tool (${done.slice(0, 120)})`);
  console.log('  tool indicator seen:', sawTool, '| coach requests', api(requests, '/api/coach'));
  check(api(requests, '/api/coach') >= 3, `the start event, the question and the resumed leg went to the proxy (${api(requests, '/api/coach')})`);
});

await scenario('proxy-fails', { allowConsole: [/net::ERR|Failed to load resource/] }, async ({ page, check, shot, requests }) => {
  await go(page, '/index.html');
  await start(page);
  await waitTurn(page, 0);
  await waitBubble(page, /kind=start/);
  await page.route('**/api/coach', (r) => r.abort());
  const tryCapture = async () => {
    await tapCell(page, 7, 7); await waitPhase(page, 'selected', 4000);
    await tapCell(page, 0, 7); await waitPhase(page, 'tentative', 4000);
    await sleep(2600);
    const b = await bubble(page);
    await tapSel(page, '#retract-button'); await waitPhase(page, 'selected', 4000);
    await tapCell(page, 7, 7); await sleep(300);
    return b;
  };
  const first = await tryCapture();
  check(first && first.text.length > 0 && first.source !== 'llm', `the first failed event is answered locally (${JSON.stringify(first)})`);
  await tapSel(page, '.chip[data-ask="score"]'); await sleep(2600);
  const second = await bubble(page);
  check(second && second.text.length > 0, `the second failed event is answered too (${JSON.stringify(second)})`);
  await waitFor(page, () => document.querySelector('#app').dataset.coach === 'local', null, 5000, 'local after two failures').catch(() => {});
  check((await coachAttr(page)) === 'local', 'after the second failure data-coach is local');
  const before = api(requests, '/api/coach');
  await tapSel(page, '#hint-button'); await sleep(1200);
  check(api(requests, '/api/coach') === before, 'no further coach request while the proxy is taken for unreachable');
  check(await page.evaluate(() => !document.body.innerText.includes('离线')), 'nothing on the page says 离线');
  await shot('a');
});

await scenario('reload-restores-quietly', {}, async ({ page, check, shot, requests }) => {
  await go(page, '/index.html');
  await start(page);
  const bot = createBot({ style: 'strong' });
  for (let n = 1; n <= 3; n++) {
    await waitTurn(page, 0); await sleep(300);
    const before = await ply(page);
    await playMove(page, bot.choose(await readBoard(page)), { think: 500 });
    await waitTurn(page, before + 2);
  }
  await sleep(1200);
  const snapshot = await pieces(page);
  const before = requests.length;
  await page.reload({ waitUntil: 'load' });
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice="continue"]'), null, 8000, 'continue');
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
  await waitTurn(page, 0); await sleep(1500);
  check((await ply(page)) === 6 && (await pieces(page)) === snapshot, 'the game is back as it was');
  check((await coachAttr(page)) === 'llm', 'data-coach is llm after the reload');
  const after = requests.slice(before);
  check(api(after, '/api/coach') === 0, `a restored position opens silently: no coach request (${api(after, '/api/coach')})`);
  check(api(after, '/api/health') === 1, `one health probe after the reload (${api(after, '/api/health')})`);
  await shot('a');
});

await browser.close();
console.log('\n' + JSON.stringify(results.map((r) => ({ name: r.name, ok: r.ok, failed: r.failed, error: r.error ? r.error.slice(0, 200) : null })), null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
