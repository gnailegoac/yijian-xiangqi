// Scenario checks of the composition root in a real browser (headless Chrome through the repo's Playwright).
// Usage: node scenarios.mjs <base url> [name ...]      e.g. node scenarios.mjs http://127.0.0.1:5331 side storage
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
const KEYS = { game: 'yijian.xiangqi.v2.game', settings: 'yijian.xiangqi.v2.settings', profile: 'yijian.xiangqi.v2.profile', v1: 'yijian.xiangqi.v1',
               migrated: 'yijian.xiangqi.v2.migrated', quarantine: 'yijian.xiangqi.quarantine' };

const browser = await chromium.launch({
  headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--host-resolver-rules=MAP yijian.test 127.0.0.1'],
});

/** One scenario in a fresh context. */
async function scenario(name, opts, body) {
  if (wanted.length && !wanted.includes(name)) return;
  const context = await browser.newContext({
    viewport: { width: opts.w ?? 1180, height: opts.h ?? 820 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: 'zh-CN',
    reducedMotion: opts.reduced === false ? 'no-preference' : 'reduce', acceptDownloads: true,
  });
  const page = await context.newPage();
  const consoleErrors = [], pageErrors = [], requests = [], bad = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on('request', (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`));
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  const checks = [];
  const check = (ok, what) => { checks.push({ ok: !!ok, what }); console.log(`  ${ok ? 'ok ' : 'FAIL'} ${what}`); };
  const shot = (n) => page.screenshot({ path: `${OUT}\\${name}-${n}.png` });
  console.log(`\n== ${name}`);
  let error = null;
  const limit = new Promise((_, reject) => setTimeout(() => reject(new Error('scenario time limit')), opts.limit ?? 90000));
  try {
    await Promise.race([body({ page, context, check, shot, requests, consoleErrors, pageErrors, bad }), limit]);
  } catch (e) {
    error = String(e && e.stack ? e.stack : e).slice(0, 600);
    console.log('  ERROR', error);
    await shot('ERROR').catch(() => {});
  }
  if (!opts.expectErrors) {
    check(pageErrors.length === 0, `no page error (${pageErrors.join(' | ')})`);
    const unexpected = consoleErrors.filter((t) => !(opts.allowConsole ?? []).some((re) => re.test(t)));
    check(unexpected.length === 0, `no console error (${unexpected.join(' | ')})`);
  }
  results.push({ name, ok: !error && checks.every((c) => c.ok), failed: checks.filter((c) => !c.ok).map((c) => c.what), error, consoleErrors, pageErrors, bad });
  await context.close();
}

const go = (page, path) => page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 20000 });
const ready = (page) => waitFor(page, () => document.documentElement.dataset.ready === '1', null, 15000, 'data-ready');
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const toastText = (page) => page.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent.trim() : ''; });
const NOT_FOUND = [/404 \(Not Found\)/];
const fixture = (name) => readFileSync(`${REPO}\\tests\\fixtures\\saves\\${name}`, 'utf8');

// ---------------------------------------------------------------------------------------------------------------

await scenario('test-hook', {}, async ({ page, check, shot }) => {
  await go(page, '/index.html?test=1&coach=off&seed=7');
  await ready(page);
  await waitPhase(page, 'childTurn', 8000);
  check(await page.evaluate(() => document.querySelector('dialog[data-dialog="start"]') === null), '?test=1 shows no start card');
  check(await page.evaluate(() => document.querySelectorAll('.piece[data-id]').length) === 32, '32 pieces');
  const y = await page.evaluate(() => Object.keys(window.__yijian ?? {}).sort().join(','));
  check(y === 'coach,director,session,store,tasks', `window.__yijian has the five members (${y})`);
  await waitFor(page, () => window.__yijian.tasks.stats().speedClass !== null, null, 8000, 'the speed class');
  const stats = await page.evaluate(() => window.__yijian.tasks.stats());
  check(['fast', 'mid', 'slow'].includes(stats.speedClass) && typeof stats.spawned === 'number' && typeof stats.lateDrops === 'number' && stats.dead === false,
        `tasks.stats() carries the counters and the speed class (${JSON.stringify(stats)})`);
  check(await page.evaluate(() => typeof window.__ui?.idle === 'function'), 'the stage set window.__ui');
  check(await page.evaluate(() => document.querySelector('#app').dataset.coach) === 'local', '?coach=off: data-coach is local');
  const seedA = await page.evaluate(() => JSON.parse(localStorage.getItem('yijian.xiangqi.v2.game')).seed);
  await page.evaluate(() => localStorage.clear());
  await go(page, '/index.html?test=1&coach=off&seed=7');
  await ready(page); await waitPhase(page, 'childTurn', 8000);
  const seedB = await page.evaluate(() => JSON.parse(localStorage.getItem('yijian.xiangqi.v2.game')).seed);
  check(seedA === seedB && Number.isInteger(seedA), `?seed=7 gives the same game seed twice (${seedA}, ${seedB})`);
  await page.evaluate(() => localStorage.clear());
  await go(page, '/index.html?test=1&coach=off');
  await ready(page); await waitPhase(page, 'childTurn', 8000);
  const seedC = await page.evaluate(() => JSON.parse(localStorage.getItem('yijian.xiangqi.v2.game')).seed);
  check(seedC !== seedA, `without ?seed the seed is drawn at random (${seedC})`);
  await shot('a');
});

await scenario('side-on-start-card', {}, async ({ page, check, shot }) => {
  await go(page, '/index.html?coach=off');
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-action="settings"]'), null, 8000, 'start card');
  check(await page.evaluate(() => document.documentElement.dataset.ready !== '1'), 'data-ready is not set while the start card waits');
  check(await page.evaluate(() => document.querySelector('dialog[data-dialog="start"] [data-choice="import"]') === null), 'loopback origin: no 导入存档 on the start card');
  await tapSel(page, 'dialog[data-dialog="start"] [data-action="settings"]');
  await sleep(500); await shot('a-settings');
  // pick the black side in the settings sheet
  const picked = await page.evaluate(() => {
    const sheet = document.querySelector('dialog[data-dialog="settings"]');
    if (!sheet) return 'no sheet';
    const b = [...sheet.querySelectorAll('button, [role="radio"], input')].find((el) => /黑方后行/.test(el.textContent ?? '') || /黑方后行/.test(el.getAttribute('aria-label') ?? ''));
    if (!b) return 'no black button';
    b.scrollIntoView({ block: 'center' });
    b.click();
    return 'clicked';
  });
  check(picked === 'clicked', `the settings sheet of the start card lets the side be picked (${picked})`);
  await sleep(300);
  check(JSON.parse(await stored(page, KEYS.settings) ?? '{}').side === 'black', 'the side setting is stored as black');
  await shot('b-black-picked');
  await page.keyboard.press('Escape'); await sleep(400);
  if (await page.evaluate(() => !!document.querySelector('dialog[data-dialog="settings"]'))) {
    await page.evaluate(() => { const c = document.querySelector('dialog[data-dialog="settings"] [data-action="close"], dialog[data-dialog="settings"] .hud-sheet__close'); c?.click(); });
    await sleep(400);
  }
  await start(page);
  await waitFor(page, () => document.querySelector('#app').dataset.phase === 'childTurn' && Number(document.querySelector('#app').dataset.ply) === 1, null, 15000, 'the rival opened');
  await sleep(600); await shot('c-black-game');
  const save = JSON.parse(await stored(page, KEYS.game));
  check(save.humanColor === 'black' && save.moves.length === 1, `the game that starts is played as black (${save.humanColor}, ${save.moves.length} move)`);
  const bottomKing = await page.evaluate(() => {
    const kings = [...document.querySelectorAll('.piece[data-type="king"]')].map((k) => ({ color: k.dataset.color, y: k.getBoundingClientRect().top }));
    kings.sort((a, b) => b.y - a.y);
    return kings[0].color;
  });
  check(bottomKing === 'black', 'black is at the bottom');
});

await scenario('storage-unavailable-after-boot', {}, async ({ page, check, shot }) => {
  await page.addInitScript(() => {
    const real = Storage.prototype.setItem;
    window.__failWrites = false;
    Storage.prototype.setItem = function (k, v) { if (window.__failWrites) throw new DOMException('quota', 'QuotaExceededError'); return real.call(this, k, v); };
  });
  await go(page, '/index.html?coach=off');
  await start(page);
  await waitTurn(page, 0); await sleep(300);
  check((await toastText(page)) === '', 'no toast while storage works');
  await page.evaluate(() => { window.__failWrites = true; });
  const bot = createBot({ style: 'strong' });
  let toasts = 0;
  for (let n = 1; n <= 3; n++) {
    await waitTurn(page, 0); await sleep(200);
    const before = await ply(page);
    await playMove(page, bot.choose(await readBoard(page)), {});
    await sleep(250);
    const t = await toastText(page);
    if (t) { toasts += 1; if (n === 1) { check(t === '这个浏览器不让存档，关掉页面后棋局不会保留。', `the storage toast is shown (${t})`); await shot('a-toast'); } }
    await waitTurn(page, before + 2);
    await sleep(3200);                                     // the toast goes away
  }
  check(toasts === 1, `the storage toast is told once (${toasts} times in three moves)`);
  check((await ply(page)) === 6, 'the game goes on in memory');
});

await scenario('storage-unreachable-at-boot', {}, async ({ page, check, shot }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = function () { throw new DOMException('denied', 'SecurityError'); };
    Storage.prototype.setItem = function () { throw new DOMException('denied', 'SecurityError'); };
  });
  await go(page, '/index.html?coach=off');
  await start(page);
  await waitTurn(page, 0);
  await sleep(400);
  check((await toastText(page)) === '这个浏览器不让存档，关掉页面后棋局不会保留。', `the storage toast is shown at the start (${await toastText(page)})`);
  await shot('a');
  const bot = createBot({ style: 'strong' });
  const before = await ply(page);
  await playMove(page, bot.choose(await readBoard(page)), {});
  await waitTurn(page, before + 2);
  check((await ply(page)) === 2, 'a move pair can be played without storage');
});

await scenario('v1-finished-not-counted', {}, async ({ page, check, shot }) => {
  const v1 = fixture('v1-resigned.json');
  await page.addInitScript(([key, text]) => { if (!localStorage.getItem('yijian.xiangqi.v2.migrated')) localStorage.setItem(key, text); }, [KEYS.v1, v1]);
  await go(page, '/index.html?coach=off');
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice="continue"]'), null, 8000, 'continue');
  await shot('a-start');
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
  await waitPhase(page, 'over', 10000);
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="over"]'), null, 15000, 'the card');
  await sleep(1500); await shot('b-over');
  const game = JSON.parse(await stored(page, KEYS.game)), profile = JSON.parse(await stored(page, KEYS.profile));
  check(game.counted === true, 'the migrated finished game is stored as counted');
  check(profile.games.played === 0 && profile.games.lost === 0 && profile.games.won === 0, `it did not enter the statistics (${JSON.stringify(profile.games)})`);
  check((await stored(page, KEYS.v1)) === v1, 'the v1 key is untouched');
  check((await stored(page, KEYS.migrated)) === '1', 'migrated is set');
  check(await page.evaluate(() => document.documentElement.dataset.ready === '1'), 'data-ready');
});

await scenario('v1-finished-closed-on-start-card', {}, async ({ page, check }) => {
  // the child leaves on the start card of the importing load and comes back later: still not counted
  const v1 = fixture('v1-resigned.json');
  await page.addInitScript(([key, text]) => { if (!localStorage.getItem('yijian.xiangqi.v2.migrated')) localStorage.setItem(key, text); }, [KEYS.v1, v1]);
  await go(page, '/index.html?coach=off');
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice="continue"]'), null, 8000, 'continue');
  const first = JSON.parse(await stored(page, KEYS.game));
  check(first.counted === false && first.skill === null, 'the import wrote an uncounted game without a game-skill record');
  await go(page, '/index.html?coach=off');                 // second load: no migration notice any more
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice="continue"]'), null, 8000, 'continue');
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
  await waitPhase(page, 'over', 10000);
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="over"]'), null, 15000, 'the card');
  await sleep(800);
  const game = JSON.parse(await stored(page, KEYS.game)), profile = JSON.parse(await stored(page, KEYS.profile));
  check(game.counted === true && profile.games.played === 0, `still not counted on the later load (${JSON.stringify(profile.games)}, counted ${game.counted})`);
});

await scenario('v1-midgame', {}, async ({ page, check, shot }) => {
  const v1 = fixture('v1-ai-black-hard.json');
  await page.addInitScript(([key, text]) => { if (!localStorage.getItem('yijian.xiangqi.v2.migrated')) localStorage.setItem(key, text); }, [KEYS.v1, v1]);
  await go(page, '/index.html?coach=off');
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice="continue"]'), null, 8000, 'continue');
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
  await waitFor(page, () => document.querySelector('#app').dataset.phase === 'childTurn', null, 15000, 'child turn');
  await sleep(1500); await shot('a');
  check((await ply(page)) === 3, `the migrated game stands at ply 3 (${await ply(page)})`);
  const game = JSON.parse(await stored(page, KEYS.game));
  check(game.humanColor === 'black' && game.counted === false, 'black, not counted (it is still running)');
  console.log('  bubble', JSON.stringify(await bubble(page)));
});

await scenario('truncated-save', {}, async ({ page, check, shot }) => {
  const v1 = fixture('v1-illegal-third-move.json');
  await page.addInitScript(([key, text]) => { if (!localStorage.getItem('yijian.xiangqi.v2.migrated')) localStorage.setItem(key, text); }, [KEYS.v1, v1]);
  await go(page, '/index.html?coach=off');
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice="continue"]'), null, 8000, 'continue');
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
  await waitFor(page, () => ['childTurn', 'opponentTurn'].includes(document.querySelector('#app').dataset.phase), null, 15000, 'a turn');
  await waitFor(page, () => /恢复到第/.test([...document.querySelectorAll('.msg, .bubble')].map((m) => m.textContent).join(' ')), null, 12000, 'the truncation line').catch(() => {});
  await sleep(300); await shot('a');
  check((await ply(page)) >= 2 && (await ply(page)) <= 3, `the legal prefix is kept (ply ${await ply(page)})`);
  check(!!(await stored(page, KEYS.quarantine)), 'the quarantine slot is filled');
  const texts = await page.evaluate(() => [...document.querySelectorAll('.msg, .bubble')].map((m) => m.textContent.trim()).join(' | '));
  check(/恢复到第 2 手/.test(texts), `the truncation is told (${texts.slice(0, 200)})`);
});

await scenario('engine-dead', { allowConsole: [/./] }, async ({ page, check, shot }) => {
  await page.addInitScript(() => {
    const Real = window.Worker;
    window.__workerBroken = true;
    window.Worker = function (...args) { if (window.__workerBroken) throw new Error('no worker today'); return new Real(...args); };
  });
  await go(page, '/index.html?coach=off');
  await start(page);
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="blocking"]'), null, 15000, 'the blocking notice');
  await sleep(300); await shot('a-blocking');
  const text = await page.evaluate(() => document.querySelector('dialog[data-dialog="blocking"]').textContent.trim());
  check(/棋局的算力没能启动/.test(text), `the blocking notice is shown (${text.slice(0, 60)})`);
  await page.evaluate(() => { window.__workerBroken = false; });
  await tapSel(page, 'dialog[data-dialog="blocking"] [data-choice="retry"]');
  await waitFor(page, () => document.querySelector('dialog[data-dialog="blocking"]') === null, null, 8000, 'the notice goes');
  const bot = createBot({ style: 'strong' });
  await waitTurn(page, 0); await sleep(300);
  await playMove(page, bot.choose(await readBoard(page)), {});
  await waitTurn(page, 2, 20000);
  await shot('b-recovered');
  check((await ply(page)) === 2, 'after the retry the rival answers');
});

await scenario('fault-toast', { expectErrors: true }, async ({ page, check, shot, consoleErrors }) => {
  await go(page, '/index.html?coach=off');
  await start(page);
  await waitTurn(page, 0); await sleep(3500);
  await page.evaluate(() => { setTimeout(() => { throw new Error('boom one'); }, 0); });
  await sleep(300);
  const first = await toastText(page);
  check(first === '出了点小状况。要是棋局不动了，刷新一下页面，棋局还在。', `an uncaught error is told with one toast (${first})`);
  await shot('a-toast');
  await sleep(3500);
  await page.evaluate(() => { Promise.reject(new Error('boom two')); });
  await sleep(400);
  check((await toastText(page)) === '', 'a second fault is not told again');
  check(consoleErrors.filter((t) => t.includes('[app]')).length === 2, `both faults are logged (${consoleErrors.length} console errors)`);
  await page.evaluate(() => { window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' })); });
  await sleep(100);
  check(consoleErrors.filter((t) => t.includes('[app]')).length === 2, 'the ResizeObserver notice is not treated as a fault');
});

await scenario('no-key-reason', {}, async ({ page, check, shot, requests }) => {
  await page.route('**/config.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ apiBase: null, build: 'dev', coach: { mode: 'off', reason: 'no_key' } }) }));
  await go(page, '/index.html');
  await start(page);
  await waitTurn(page, 0);
  check(await page.evaluate(() => document.querySelector('#app').dataset.coach) === 'local', 'data-coach is local');
  await tapSel(page, '#menu-button'); await sleep(400);
  await page.evaluate(() => { [...document.querySelectorAll('.hud-menu__item')].find((b) => b.dataset.menu === 'settings')?.click(); });
  await sleep(600); await shot('a-settings');
  const text = await page.evaluate(() => document.querySelector('dialog[data-dialog="settings"]')?.textContent ?? '');
  check(/服务器没有配置密钥/.test(text), 'the settings sheet says the server has no key');
  check(!requests.some((r) => r.includes('/api/')), 'no request to /api');
});

await scenario('import-on-start-card', { allowConsole: NOT_FOUND }, async ({ page, check, shot }) => {
  const lan = BASE.replace('127.0.0.1', 'yijian.test');
  await page.goto(`${lan}/index.html?coach=off`, { waitUntil: 'load' });
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice="import"]'), null, 8000, '导入存档 on the start card');
  check(true, 'first visit from a non-loopback origin: the start card offers 导入存档');
  await shot('a-start');
  // a bad file: told, nothing changes, the start card is there again
  writeFileSync(`${OUT}\\bad.json`, fixture('backup-bad.json'));
  await page.setInputFiles('#overlays input[type=file]', `${OUT}\\bad.json`);
  await sleep(700);
  check((await toastText(page)) === '这个文件亮认不出来，存档没有变。', `a bad file is told (${await toastText(page)})`);
  check(await page.evaluate(() => !!document.querySelector('dialog[data-dialog="start"] [data-choice="import"]')), 'the start card is shown again after a bad file');
  check((await stored(page, KEYS.game)) === null, 'nothing was stored');
  check(await page.evaluate(() => document.querySelector('#app').dataset.phase) === 'boot', 'no game was started behind the card');
  await shot('b-after-bad');
  // a good file: the page reloads with it
  writeFileSync(`${OUT}\\ok.json`, fixture('backup-ok.json'));
  const expected = JSON.parse(fixture('backup-ok.json'));
  const loaded = page.waitForEvent('load', { timeout: 10000 });
  await page.setInputFiles('#overlays input[type=file]', `${OUT}\\ok.json`);
  await loaded;
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice="continue"]'), null, 8000, 'continue after the import');
  const game = JSON.parse(await stored(page, KEYS.game));
  check(JSON.stringify(game.moves) === JSON.stringify(expected.game.moves), `the imported game is on disk untouched (${game.moves.length} moves)`);
  check(game.id === expected.game.id, 'no new game was written over the imported one');
  await shot('c-after-import');
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
  await waitFor(page, () => ['childTurn', 'over'].includes(document.querySelector('#app').dataset.phase), null, 15000, 'the imported game');
  await sleep(2500); await shot('d-imported-game');
  check((await ply(page)) === expected.game.moves.length, `the imported game is on the board (ply ${await ply(page)})`);
  const texts = await page.evaluate(() => [...document.querySelectorAll('.msg, .bubble')].map((m) => m.textContent.trim()).join(' | '));
  check(/存档导入好了/.test(texts), `the import is told (${texts.slice(0, 160)})`);
});

await scenario('import-in-game', {}, async ({ page, check, shot }) => {
  // an import from the settings sheet while the rival is thinking: nothing may write over the imported records
  await go(page, '/index.html?coach=off');
  await start(page);
  const bot = createBot({ style: 'strong' });
  await waitTurn(page, 0); await sleep(300);
  const move = bot.choose(await readBoard(page));
  await tapCell(page, move.from.row, move.from.col); await waitPhase(page, 'selected', 4000);
  await tapCell(page, move.to.row, move.to.col); await waitPhase(page, 'tentative', 4000);
  await sleep(500);
  writeFileSync(`${OUT}\\ok.json`, fixture('backup-ok.json'));
  const expected = JSON.parse(fixture('backup-ok.json'));
  const loaded = page.waitForEvent('load', { timeout: 10000 });
  await tapSel(page, '#confirm-button');                    // the rival starts to think ...
  await page.setInputFiles('#overlays input[type=file]', `${OUT}\\ok.json`);     // ... and the import arrives
  await loaded;
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice="continue"]'), null, 8000, 'continue after the import');
  await sleep(1200);
  const game = JSON.parse(await stored(page, KEYS.game)), profile = JSON.parse(await stored(page, KEYS.profile));
  check(game.id === expected.game.id && JSON.stringify(game.moves) === JSON.stringify(expected.game.moves), 'the imported game survived the reload');
  check(JSON.stringify(profile.games) === JSON.stringify(expected.profile.games), 'the imported profile survived the reload');
  await shot('a');
});

await scenario('restore-failure', { allowConsole: [/could not be restored/] }, async ({ page, check, shot }) => {
  // a record that passes the store but makes the session throw cannot be produced through localStorage (the store
  // sanitises it), so the session's restore is made to throw once from outside
  await page.addInitScript(() => { localStorage.setItem('yijian.xiangqi.v2.game', JSON.stringify({ schema: 2, id: 'g-abcdef12', humanColor: 'red', moves: ['7774', '0726'], result: null,
    startedAt: 1790000000000, endedAt: null, activeMs: 1000, counted: false, drawFrom: 0, seed: 5, skill: null, memory: null, start: null })); });
  await page.route('**/src/game/session.js', async (route) => {
    const res = await route.fetch();
    const text = (await res.text()).replace('function restore(saved) {', 'function restore(saved) {\n    if (!globalThis.__restoreThrown) { globalThis.__restoreThrown = true; throw new TypeError("session.restore needs a SavedGame with a moves array"); }');
    await route.fulfill({ response: res, body: text });
  });
  await go(page, '/index.html?coach=off');
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice="continue"]'), null, 8000, 'continue');
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
  await waitFor(page, () => document.querySelector('#app').dataset.phase === 'childTurn', null, 15000, 'a fresh game');
  await sleep(2500); await shot('a');
  check((await ply(page)) === 0, 'a fresh game starts when the save cannot be restored');
  check(/"why":"corrupt"/.test(await stored(page, KEYS.quarantine) ?? ''), 'the record was copied to the quarantine slot');
  check(await page.evaluate(() => document.documentElement.dataset.ready === '1'), 'the game still boots');
  const texts = await page.evaluate(() => [...document.querySelectorAll('.msg, .bubble')].map((m) => m.textContent.trim()).join(' | '));
  check(/存档亮没能认出来/.test(texts), `the child is told (${texts.slice(0, 200)})`);
});

await scenario('v1-new-game', {}, async ({ page, check, shot }) => {
  // the child does not continue the migrated game: the line about the old game going on is not said
  const v1 = fixture('v1-ai-black-hard.json');
  await page.addInitScript(([key, text]) => { if (!localStorage.getItem('yijian.xiangqi.v2.migrated')) localStorage.setItem(key, text); }, [KEYS.v1, v1]);
  await go(page, '/index.html?coach=off');
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice="new"]'), null, 8000, 'start card');
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="new"]');
  await waitFor(page, () => document.querySelector('#app').dataset.phase === 'childTurn', null, 15000, 'child turn');
  await sleep(6000); await shot('a');
  const texts = await page.evaluate(() => [...document.querySelectorAll('.msg, .bubble')].map((m) => m.textContent.trim()).join(' | '));
  check(!/上次的棋局|两个人对弈/.test(texts), `no line about the old game going on (${texts.slice(0, 160)})`);
  check((await ply(page)) === 0 && JSON.parse(await stored(page, KEYS.game)).moves.length === 0, 'a new game runs');
  check((await stored(page, KEYS.v1)) === v1, 'the v1 key is untouched');
});

await scenario('export', {}, async ({ page, check, shot }) => {
  await go(page, '/index.html?coach=off');
  await start(page);
  const bot = createBot({ style: 'strong' });
  for (let n = 1; n <= 2; n++) {
    await waitTurn(page, 0); await sleep(300);
    const before = await ply(page);
    await playMove(page, bot.choose(await readBoard(page)), {});
    await waitTurn(page, before + 2);
  }
  await sleep(500);
  const openMenu = async (item) => {
    await tapSel(page, '#menu-button'); await sleep(450);
    await page.evaluate((m) => { [...document.querySelectorAll('.hud-menu__item')].find((b) => b.dataset.menu === m)?.click(); }, item);
    await sleep(500);
  };
  // 导出存档 in the settings sheet
  await openMenu('settings');
  const backupDownload = page.waitForEvent('download', { timeout: 8000 });
  await page.evaluate(() => { const b = document.querySelector('dialog[data-dialog="settings"] [data-action="export-backup"]'); b.scrollIntoView({ block: 'center' }); b.click(); });
  const backup = await backupDownload;
  const backupPath = `${OUT}\\export-backup.json`;
  await backup.saveAs(backupPath);
  const parsed = JSON.parse(readFileSync(backupPath, 'utf8'));
  check(/^弈间存档-\d{4}-\d{2}-\d{2}\.json$/.test(backup.suggestedFilename()), `the backup file is named 弈间存档-YYYY-MM-DD.json (${backup.suggestedFilename()})`);
  check(parsed.kind === 'yijian-backup' && parsed.v === 1 && parsed.game && parsed.game.moves.length === 4 && parsed.profile && parsed.settings,
        `the backup holds the game with its 4 moves, the profile and the settings (${parsed.game?.moves.length} moves)`);
  check(parsed.game.skill !== null && typeof parsed.game.seed === 'number', 'the game record carries the director\'s extras (seed, skill)');
  await page.keyboard.press('Escape'); await sleep(450);
  // 下载棋谱 in the notation sheet
  await openMenu('notation');
  await shot('a-notation');
  const recordDownload = page.waitForEvent('download', { timeout: 8000 });
  await page.evaluate(() => { const b = document.querySelector('dialog[data-dialog="notation"] [data-action="export"]'); b.scrollIntoView({ block: 'center' }); b.click(); });
  const record = await recordDownload;
  const recordPath = `${OUT}\\export-record.txt`;
  await record.saveAs(recordPath);
  const text = readFileSync(recordPath, 'utf8');
  check(/^弈间棋谱-\d{4}-\d{2}-\d{2}\.txt$/.test(record.suggestedFilename()), `the record file is named 弈间棋谱-YYYY-MM-DD.txt (${record.suggestedFilename()})`);
  check(/弈间 · 中国象棋棋谱/.test(text) && /对手：司马懿（指导棋）/.test(text) && /结果：进行中/.test(text) && /\n1\. /.test(text) && /\n2\. /.test(text),
        `the record lists the two rounds (${text.replace(/\s+/g, ' ').slice(0, 140)})`);
  // the exported backup comes back through the import
  await page.keyboard.press('Escape'); await sleep(450);
  await page.evaluate(() => localStorage.clear());
  const loaded = page.waitForEvent('load', { timeout: 10000 });
  await page.setInputFiles('#overlays input[type=file]', backupPath);
  await loaded;
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice="continue"]'), null, 8000, 'continue after the import');
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
  await waitTurn(page, 0); await sleep(800);
  check((await ply(page)) === 4, `clearing the storage and importing the backup brings the game back (ply ${await ply(page)})`);
});

await scenario('import-storage-full', {}, async ({ page, check, shot }) => {
  await page.addInitScript(() => {
    const real = Storage.prototype.setItem;
    window.__failWrites = false;
    Storage.prototype.setItem = function (k, v) { if (window.__failWrites) throw new DOMException('quota', 'QuotaExceededError'); return real.call(this, k, v); };
  });
  await go(page, '/index.html?coach=off');
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice="new"]'), null, 8000, 'start card');
  await page.evaluate(() => { window.__failWrites = true; });
  writeFileSync(`${OUT}\\ok.json`, fixture('backup-ok.json'));
  await page.setInputFiles('#overlays input[type=file]', `${OUT}\\ok.json`);
  await sleep(700);
  check((await toastText(page)) === '存储空间满了，这份存档放不进来。', `a full storage is told with its own line (${await toastText(page)})`);
  await shot('a-toast');
  check(await page.evaluate(() => !!document.querySelector('dialog[data-dialog="start"] [data-choice="new"]')), 'the start card is shown again');
  check((await stored(page, KEYS.game)) === null, 'nothing was stored');
});

// Not a check of the app as it is: the same import with the three guard lines of `reload` removed from app.js (served
// through a route, the file on disk is not touched). It shows what the guard is for.
await scenario('MUTANT-import-in-game-unguarded', { expectErrors: true }, async ({ page, check }) => {
  await page.route('**/src/app.js', async (route) => {
    const res = await route.fetch();
    const text = await res.text();
    const cut = text.replace(/leaving = true;\s*director\.dispose\(\);\s*tasks\.dispose\(\);/, '');
    if (cut === text) throw new Error('the mutant could not be made');
    await route.fulfill({ response: res, body: cut });
  });
  let lost = 0;
  for (let round = 0; round < 3 && lost === 0; round++) {
    await page.evaluate(() => { try { localStorage.clear(); } catch {} }).catch(() => {});
    await go(page, '/index.html?coach=off');
    await page.evaluate(() => localStorage.clear());
    await go(page, '/index.html?coach=off');
    await start(page);
    const bot = createBot({ style: 'strong' });
    await waitTurn(page, 0); await sleep(300);
    const move = bot.choose(await readBoard(page));
    await tapCell(page, move.from.row, move.from.col); await waitPhase(page, 'selected', 4000);
    await tapCell(page, move.to.row, move.to.col); await waitPhase(page, 'tentative', 4000);
    await sleep(500);
    writeFileSync(`${OUT}\\ok.json`, fixture('backup-ok.json'));
    const expected = JSON.parse(fixture('backup-ok.json'));
    const loaded = page.waitForEvent('load', { timeout: 10000 });
    await tapSel(page, '#confirm-button');
    await page.setInputFiles('#overlays input[type=file]', `${OUT}\\ok.json`);
    await loaded;
    await sleep(800);
    const game = JSON.parse(await stored(page, KEYS.game));
    if (game.id !== expected.game.id) lost += 1;
  }
  console.log(`  without the guard the imported game was overwritten in ${lost} of up to 3 rounds`);
  check(true, 'mutant run finished');
});

await browser.close();
console.log('\n' + JSON.stringify(results.map((r) => ({ name: r.name, ok: r.ok, failed: r.failed, error: r.error ? r.error.slice(0, 200) : null })), null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
