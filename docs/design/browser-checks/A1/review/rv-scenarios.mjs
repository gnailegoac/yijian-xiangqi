// Reviewer's adversarial scenarios for the composition root (static server; headless Chrome).
// Usage: node rv-scenarios.mjs <base url> [name ...]
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
const KEYS = { game: 'yijian.xiangqi.v2.game', settings: 'yijian.xiangqi.v2.settings', profile: 'yijian.xiangqi.v2.profile', v1: 'yijian.xiangqi.v1',
               migrated: 'yijian.xiangqi.v2.migrated', quarantine: 'yijian.xiangqi.quarantine' };

const browser = await chromium.launch({
  headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--host-resolver-rules=MAP yijian.test 127.0.0.1'],
});

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
    const unexpected = consoleErrors.filter((t) => !(opts.allowConsole ?? [/404 \(Not Found\)/]).some((re) => re.test(t)));
    check(unexpected.length === 0, `no console error (${unexpected.join(' | ')})`);
  }
  results.push({ name, ok: !error && checks.every((c) => c.ok), failed: checks.filter((c) => !c.ok).map((c) => c.what), error });
  await context.close();
}

const go = (page, path) => page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 20000 });
const ready = (page) => waitFor(page, () => document.documentElement.dataset.ready === '1', null, 15000, 'data-ready');
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const toastText = (page) => page.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent.trim() : ''; });
const fixture = (name) => readFileSync(`${REPO}\\tests\\fixtures\\saves\\${name}`, 'utf8');
const texts = (page) => page.evaluate(() => [...document.querySelectorAll('.msg, .bubble')].map((m) => m.textContent.trim()).join(' | '));
const startCard = (page, sel = '[data-choice]') => waitFor(page, (s) => !!document.querySelector(`dialog[data-dialog="start"] ${s}`), sel, 8000, 'start card');
const openMenu = async (page, item) => {
  await tapSel(page, '#menu-button'); await sleep(450);
  await page.evaluate((m) => { [...document.querySelectorAll('.hud-menu__item')].find((b) => b.dataset.menu === m)?.click(); }, item);
  await sleep(500);
};
const code = (m) => `${m.from.row}${m.from.col}${m.to.row}${m.to.col}`;
const v2 = (over) => ({ schema: 2, id: 'g-review001', humanColor: 'red', moves: [], result: null, startedAt: 1790000000000, endedAt: null, activeMs: 1000,
                        counted: false, drawFrom: 0, seed: 77, skill: null, memory: null, start: null, ...over });

// ---------------------------------------------------------------------------------------------------------------

await scenario('slow-config', {}, async ({ page, check, shot, requests }) => {
  // config.json answers after 4 s: the boot waits 1.5 s at most, then plays with the local strategist
  await page.route('**/config.json', async (r) => {
    await sleep(4000);
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ apiBase: '/api', build: 'dev', coach: { mode: 'live', reason: null } }) }).catch(() => {});
  });
  const t0 = Date.now();
  await go(page, '/index.html');
  await startCard(page);
  const dt = Date.now() - t0;
  check(dt >= 1300 && dt < 3200, `the start card comes about 1.5 s after navigation when config.json hangs (${dt} ms)`);
  await start(page);
  await waitTurn(page, 0);
  await sleep(4500);
  check(await page.evaluate(() => document.querySelector('#app').dataset.coach) === 'local', 'data-coach stays local after the late answer');
  check(!requests.some((r) => r.includes('/api/')), 'no /api request');
  check(await page.evaluate(() => document.documentElement.dataset.ready === '1'), 'ready');
});

await scenario('double-tap-start', { reduced: false }, async ({ page, check, shot }) => {
  await go(page, '/index.html?coach=off');
  await startCard(page);
  const box = await page.evaluate(() => { const b = document.querySelector('dialog[data-dialog="start"] .hud-start__go').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.touchscreen.tap(box.x, box.y);
  await sleep(60);
  await page.touchscreen.tap(box.x, box.y);
  await sleep(120);
  await page.touchscreen.tap(box.x, box.y);
  await waitPhase(page, ['childTurn', 'selected'], 15000);
  await sleep(1500);
  console.log(`  phase after three taps: ${await phase(page)} (selected = the last tap fell through to the board)`);
  const game = JSON.parse(await stored(page, KEYS.game));
  check(game.moves.length === 0 && (await ply(page)) === 0, `three quick taps on the start button start one game at ply 0 (${game.moves.length})`);
  check(await page.evaluate(() => document.querySelectorAll('.piece[data-id]').length) === 32, '32 pieces');
  check(await page.evaluate(() => document.querySelector('dialog[data-dialog="start"]') === null), 'the start card is gone');
  await shot('a');
});

await scenario('no-test-hook-without-param', {}, async ({ page, check }) => {
  await go(page, '/index.html?coach=off&seed=abc');
  await start(page);
  await waitTurn(page, 0);
  check(await page.evaluate(() => typeof window.__yijian === 'undefined'), 'window.__yijian is absent without ?test=1');
  const seed = JSON.parse(await stored(page, KEYS.game)).seed;
  check(Number.isInteger(seed) && seed >= 0 && seed <= 0xFFFFFFFF, `a non-numeric ?seed falls back to a random uint32 game seed (${seed})`);
});

await scenario('test-continue', {}, async ({ page, check }) => {
  await page.addInitScript((g) => { if (!localStorage.getItem('yijian.xiangqi.v2.game')) localStorage.setItem('yijian.xiangqi.v2.game', g); }, JSON.stringify(v2({ moves: ['7774', '0726'] })));
  await go(page, '/index.html?test=1&coach=off');
  await ready(page);
  await waitPhase(page, 'childTurn', 8000);
  check((await ply(page)) === 2, `?test=1 with a save continues it without a start card (ply ${await ply(page)})`);
  check(await page.evaluate(() => document.querySelector('dialog[data-dialog="start"]') === null), 'no start card');
  const y = await page.evaluate(() => {
    const y = window.__yijian;
    return { same: y.session.getState().history.length, stats: y.tasks.stats(), hasJob: typeof y.tasks.job === 'function' && typeof y.tasks.liveJob === 'function',
             coachMode: y.coach.mode(), dir: typeof y.director.extras === 'function', store: typeof y.store.load === 'function' };
  });
  check(y.same === 2 && y.hasJob && y.coachMode === 'local' && y.dir && y.store, `__yijian members are usable (${JSON.stringify(y)})`);
});

await scenario('storage-getter-throws', {}, async ({ page, check, shot }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); }, configurable: true }); });
  await go(page, '/index.html?coach=off');
  await start(page);
  await waitTurn(page, 0);
  await sleep(500);
  check((await toastText(page)) === '这个浏览器不让存档，关掉页面后棋局不会保留。', `one storage toast when the localStorage getter throws (${await toastText(page)})`);
  const bot = createBot({ style: 'strong' });
  await playMove(page, bot.choose(await readBoard(page)), {});
  await waitTurn(page, 2);
  check((await ply(page)) === 2, 'the game plays in memory');
  await shot('a');
});

await scenario('black-reload-undo', { reduced: true, limit: 150000 }, async ({ page, check, shot }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('yijian.xiangqi.v2.settings')) localStorage.setItem('yijian.xiangqi.v2.settings', JSON.stringify({ schema: 2, side: 'black' })); });
  await go(page, '/index.html?coach=off');
  await start(page);
  await waitFor(page, () => document.querySelector('#app').dataset.phase === 'childTurn' && Number(document.querySelector('#app').dataset.ply) === 1, null, 15000, 'the rival opened');
  const bot = createBot({ style: 'strong', color: 'black' });
  for (let n = 0; n < 3; n++) {
    const before = await ply(page);
    await sleep(300);
    await playMove(page, bot.choose(await readBoard(page)), {});
    await waitTurn(page, before + 2, 30000);
  }
  check((await ply(page)) === 7, `three move pairs as black (ply ${await ply(page)})`);
  await sleep(600); await shot('a-black-ply7');
  const before = await pieces(page);
  const saveBefore = JSON.parse(await stored(page, KEYS.game));
  check(saveBefore.humanColor === 'black' && saveBefore.moves.length === 7, 'the save holds 7 moves as black');
  await go(page, '/index.html?coach=off');
  await startCard(page, '[data-choice="continue"]');
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
  await waitTurn(page, 7, 15000); await sleep(1200);
  check((await pieces(page)) === before, 'the position after the reload is the same');
  const bottomKing = await page.evaluate(() => {
    const kings = [...document.querySelectorAll('.piece[data-type="king"]')].map((k) => ({ color: k.dataset.color, y: k.getBoundingClientRect().top }));
    kings.sort((a, b) => b.y - a.y);
    return kings[0].color;
  });
  check(bottomKing === 'black', 'black is at the bottom after the reload');
  check(/小主公回来了/.test(await texts(page)), `welcome back is said (${(await texts(page)).slice(0, 80)})`);
  await shot('b-restored');
  await tapSel(page, '#undo-button');
  await waitFor(page, () => Number(document.querySelector('#app').dataset.ply) === 5, null, 8000, 'undo to ply 5');
  await sleep(500);
  const saveAfter = JSON.parse(await stored(page, KEYS.game));
  check(saveAfter.moves.length === 5 && saveAfter.id === saveBefore.id && saveAfter.seed === saveBefore.seed, `undo after a reload is saved (${saveAfter.moves.length} moves, same id and seed)`);
  check(Array.isArray(saveAfter.skill?.samples) && saveAfter.skill.samples.every((s) => s.ply < 5), 'the game-skill record was rewound with it');
});

await scenario('reload-in-rival-turn', { reduced: false }, async ({ page, check, shot }) => {
  await go(page, '/index.html?coach=off');
  await start(page);
  await waitTurn(page, 0); await sleep(300);
  const bot = createBot({ style: 'strong' });
  const move = bot.choose(await readBoard(page));
  await tapCell(page, move.from.row, move.from.col); await waitPhase(page, 'selected', 4000);
  await tapCell(page, move.to.row, move.to.col); await waitPhase(page, 'tentative', 4000);
  await sleep(500);
  await tapSel(page, '#confirm-button');
  await waitPhase(page, 'opponentTurn', 4000);
  const saved = JSON.parse(await stored(page, KEYS.game));
  check(saved.moves.length === 1, `the move of the child is on disk while the rival thinks (${saved.moves.length})`);
  await go(page, '/index.html?coach=off');
  await startCard(page, '[data-choice="continue"]');
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
  await waitTurn(page, 2, 20000);
  check((await ply(page)) === 2, 'after a reload in the turn of the rival he answers');
  await sleep(800); await shot('a');
  const again = JSON.parse(await stored(page, KEYS.game));
  check(again.id === saved.id && again.moves.length === 2 && again.moves[0] === saved.moves[0], 'same game, two moves');
});

await scenario('resign-count-reload-again', { reduced: true, limit: 120000 }, async ({ page, check, shot }) => {
  await go(page, '/index.html?coach=off');
  await start(page);
  await waitTurn(page, 0); await sleep(300);
  const bot = createBot({ style: 'strong' });
  await playMove(page, bot.choose(await readBoard(page)), {});
  await waitTurn(page, 2);
  await openMenu(page, 'resign');
  await sleep(300); await shot('a-resign-dialog');
  await tapSel(page, 'dialog[data-dialog="resign"] [data-choice="go"]');
  await waitPhase(page, 'over', 8000);
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="over"]'), null, 20000, 'the card');
  await sleep(800); await shot('b-over');
  let game = JSON.parse(await stored(page, KEYS.game)), profile = JSON.parse(await stored(page, KEYS.profile));
  check(game.counted === true && game.result && game.result.reason === 'resign' && game.result.winner === 'black', `the resignation is stored and counted (${JSON.stringify(game.result)})`);
  check(profile.games.played === 1 && profile.games.lost === 1, `one loss (${JSON.stringify(profile.games)})`);
  // reload: the finished game comes back quietly and is not counted again
  await go(page, '/index.html?coach=off');
  await startCard(page, '[data-choice="continue"]');
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
  await waitPhase(page, 'over', 8000);
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="over"]'), null, 20000, 'the card again');
  await sleep(800); await shot('c-over-restored');
  profile = JSON.parse(await stored(page, KEYS.profile));
  check(profile.games.played === 1 && profile.games.lost === 1, `not counted twice (${JSON.stringify(profile.games)})`);
  check(await page.evaluate(() => document.documentElement.dataset.ready === '1'), 'ready after a finished game was restored');
  await tapSel(page, 'dialog[data-dialog="over"] [data-choice="again"]');
  await waitTurn(page, 0, 15000); await sleep(500);
  game = JSON.parse(await stored(page, KEYS.game));
  check(game.moves.length === 0 && game.counted === false && game.result === null, 'the again button starts a fresh, uncounted game');
  await shot('d-new');
});

await scenario('draw-live', { reduced: true, limit: 120000 }, async ({ page, check, shot }) => {
  // 119 quiet plies on disk, the child (black) plays the 120th: a draw, counted as a draw
  const v1 = JSON.parse(fixture('v1-121-quiet-plies.json'));
  const moves = v1.moves.map(code);
  const save = v2({ humanColor: 'black', moves: moves.slice(0, 119) });
  await page.addInitScript((g) => { if (!localStorage.getItem('yijian.xiangqi.v2.game')) localStorage.setItem('yijian.xiangqi.v2.game', g); }, JSON.stringify(save));
  await go(page, '/index.html?coach=off');
  await startCard(page, '[data-choice="continue"]');
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
  await waitTurn(page, 119, 15000);
  check((await phase(page)) === 'childTurn' && (await ply(page)) === 119, `119 plies restored, the child to move (${await phase(page)}, ${await ply(page)})`);
  await sleep(500);
  const m = v1.moves[119];
  await playMove(page, m, {});
  await waitPhase(page, 'over', 10000);
  await sleep(600); await shot('a-banner');
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="over"]'), null, 20000, 'the card');
  await sleep(1200); await shot('b-card');
  const card = await page.evaluate(() => document.querySelector('dialog[data-dialog="over"]').dataset.result + ' ' + document.querySelector('dialog[data-dialog="over"]').textContent.trim().slice(0, 120));
  check(/^draw /.test(card), `the card shows a draw (${card})`);
  const profile = JSON.parse(await stored(page, KEYS.profile)), game = JSON.parse(await stored(page, KEYS.game));
  check(profile.games.played === 1 && profile.games.drawn === 1 && game.counted === true, `counted as one draw (${JSON.stringify(profile.games)})`);
});

await scenario('draw-on-restore', { reduced: true }, async ({ page, check, shot }) => {
  const v1 = JSON.parse(fixture('v1-121-quiet-plies.json'));
  const save = v2({ humanColor: 'black', moves: v1.moves.map(code).slice(0, 120), skill: { seed: 77 } });
  await page.addInitScript((g) => { if (!localStorage.getItem('yijian.xiangqi.v2.game')) localStorage.setItem('yijian.xiangqi.v2.game', g); }, JSON.stringify(save));
  await go(page, '/index.html?coach=off');
  await startCard(page, '[data-choice="continue"]');
  await tapSel(page, 'dialog[data-dialog="start"] [data-choice="continue"]');
  await waitPhase(page, 'over', 10000);
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="over"]'), null, 20000, 'the card');
  await sleep(800); await shot('a');
  const profile = JSON.parse(await stored(page, KEYS.profile)), game = JSON.parse(await stored(page, KEYS.game));
  check(profile.games.played === 1 && profile.games.drawn === 1 && game.counted === true,
        `a v2 game found drawn at restore (page closed before the count) is counted once (${JSON.stringify(profile.games)})`);
});

await scenario('start-settings-import', { }, async ({ page, check, shot }) => {
  // the import inside the settings sheet that was opened from the start card
  await go(page, '/index.html?coach=off');
  await startCard(page, '[data-action="settings"]');
  await tapSel(page, 'dialog[data-dialog="start"] [data-action="settings"]');
  await sleep(500);
  check(await page.evaluate(() => !!document.querySelector('dialog[data-dialog="settings"]')), 'the settings sheet opens from the start card');
  writeFileSync(`${OUT}\\bad.json`, fixture('backup-bad.json'));
  await page.setInputFiles('#overlays input[type=file]', `${OUT}\\bad.json`);
  await sleep(900);
  check((await toastText(page)) === '这个文件亮认不出来，存档没有变。', `bad file: told (${await toastText(page)})`);
  check(await page.evaluate(() => !!document.querySelector('dialog[data-dialog="start"] [data-choice="new"]')), 'the start card is there again');
  check(await page.evaluate(() => document.querySelectorAll('dialog[data-dialog="start"]').length) === 1, 'exactly one start card');
  check((await phase(page)) === 'boot' && (await stored(page, KEYS.game)) === null, 'no game started behind it');
  await shot('a-after-bad');
  await start(page);
  await waitTurn(page, 0, 15000);
  check((await ply(page)) === 0 && await page.evaluate(() => document.documentElement.dataset.ready === '1'), 'the game starts after the failed import');
  await sleep(500); await shot('b-game');
});

await scenario('visibility-clock', { reduced: true }, async ({ page, check }) => {
  await go(page, '/index.html?test=1&coach=off');
  await ready(page); await waitPhase(page, 'childTurn', 8000);
  await sleep(700);
  const a0 = await page.evaluate(() => window.__yijian.director.extras().activeMs);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const a1 = await page.evaluate(() => window.__yijian.director.extras().activeMs);
  await sleep(1500);
  const a2 = await page.evaluate(() => window.__yijian.director.extras().activeMs);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(600);
  const a3 = await page.evaluate(() => window.__yijian.director.extras().activeMs);
  check(a0 >= 500 && a2 === a1 && a3 >= a2 + 400, `the active-time clock stops while hidden and runs again after (${a0}, ${a1}, ${a2}, ${a3})`);
});

await scenario('boot-fault-told', { expectErrors: true }, async ({ page, check, shot, consoleErrors }) => {
  // a module of the composition throws while the game is being put together: told once, logged
  await page.route('**/src/game/ports.js', async (route) => {
    const res = await route.fetch();
    const text = (await res.text()).replace('export function createCoachPort(deps) {', 'export function createCoachPort(deps) {\n  throw new Error("ports are broken");');
    await route.fulfill({ response: res, body: text });
  });
  await go(page, '/index.html?coach=off');
  await sleep(1500);
  check((await toastText(page)) === '出了点小状况。要是棋局不动了，刷新一下页面，棋局还在。', `a fault during boot is told (${await toastText(page)})`);
  check(consoleErrors.some((t) => t.includes('[app]')), 'and logged');
  check(await page.evaluate(() => document.documentElement.dataset.ready !== '1'), 'data-ready is not set');
  await shot('a');
});

await browser.close();
console.log('\n' + JSON.stringify(results.map((r) => ({ name: r.name, ok: r.ok, failed: r.failed, error: r.error ? r.error.slice(0, 200) : null })), null, 1));
