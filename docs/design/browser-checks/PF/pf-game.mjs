// PF: one whole game by script; every line the strategist and the rival say is written to the log.
// Usage: node pf-game.mjs <base url> <out prefix> [query] [maxMoves] [style: mixed|weak|strong]
import { createRequire } from 'node:module';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { sleep, phase, ply, waitFor, waitPhase, tapSel, tapCell, chips } from '../A1/lib.mjs';
import { createBot, readBoard, waitTurn } from '../A1/bot.mjs';

const REPO = 'C:\\Users\\USERNAME\\git\\yijian-xiangqi';
const DIR = 'C:\\Users\\USERNA~1\\AppData\\Local\\Temp\\claude\\5884157893c5b410\\a051714c-de36-47da-b3cc-cfc754f60ac3\\scratchpad\\work\\PF\\game';
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const require = createRequire(`${REPO}\\package.json`);
const { chromium } = require('@playwright/test');
mkdirSync(DIR, { recursive: true });

const BASE = process.argv[2];
const NAME = process.argv[3] ?? 'g';
const QUERY = process.argv[4] ?? 'coach=off&seed=11';
const MAX = Number(process.argv[5] ?? 40);
const STYLE = process.argv[6] ?? 'mixed';
const lines = [];
const log = (text) => { lines.push(text); console.log(text); };
const hardLimit = setTimeout(() => { log('HARD LIMIT'); writeFileSync(`${DIR}\\${NAME}.log`, lines.join('\n')); process.exit(3); }, 9.3 * 60 * 1000);

const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: 'zh-CN', reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });

// everything that is said is caught where it appears: the bubble (strategist, with its caption) and the rival's plate
await page.addInitScript(() => {
  window.__said = [];
  const seen = { bubble: '', rival: '' };
  const tick = () => {
    const b = document.querySelector('.bubble');
    const state = b?.getAttribute('data-state');
    const text = b ? b.textContent.replace(/\s+/g, ' ').trim() : '';
    if (b && (state === 'done' || state === 'stale') && text && text !== seen.bubble) { seen.bubble = text; window.__said.push(`诸葛亮 [${b.getAttribute('data-source') ?? ''}] ${text}`); }
    const r = document.querySelector('.rival');
    const line = r && r.getAttribute('data-say') === 'line' ? (r.querySelector('.rival__line')?.textContent.trim() ?? '') : '';
    const key = `${r?.getAttribute('data-mood')}|${line}`;
    if (r && line && key !== seen.rival) { seen.rival = key; window.__said.push(`司马懿 (${r.getAttribute('data-mood')}) ${line}`); }
    if (!line) seen.rival = '';
  };
  setInterval(tick, 40);
});
const drain = async (label) => {
  const got = await page.evaluate(() => window.__said.splice(0));
  for (const text of got) log(`    ${label ? `[${label}] ` : ''}${text}`);
};
const settle = async (ms = 900) => { await sleep(ms); for (let i = 0; i < 30; i++) { const s = await page.evaluate(() => document.querySelector('.bubble')?.getAttribute('data-state')); if (s !== 'streaming') break; await sleep(150); } await sleep(350); };
const askChip = async (code) => {
  const there = await page.evaluate((c) => { const el = document.querySelector(`.chip[data-ask="${c}"]`); return !!el && el.getBoundingClientRect().width > 0; }, code);
  if (!there) return false;
  await tapSel(page, `.chip[data-ask="${code}"]`);
  await settle(1500);
  await drain(`问 ${code}`);
  await sleep(700);                                     // the 800 ms between two questions
  return true;
};

try {
  await page.goto(`${BASE}/index.html?${QUERY}`, { waitUntil: 'load', timeout: 20000 });
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice]'), null, 10000, 'start card');
  await tapSel(page, 'dialog[data-dialog="start"] .hud-start__go');
  await waitTurn(page, 0, 15000);
  await settle(1500);
  await drain('开局');
  const strong = createBot({ style: 'strong', timeMs: 150 });
  const weak = createBot({ style: 'weak', seed: 7 });
  const TURN_CHIPS = ['intent', 'danger', 'last', 'score'];
  const TRIAL_CHIPS = ['good', 'reply', 'better', 'why', 'show'];
  for (let n = 0; n < MAX; n++) {
    if ((await phase(page)) === 'over') break;
    const p = await ply(page);
    const round = Math.floor(p / 2) + 1;
    log(`-- 第${round}回合 (ply ${p}) chips: ${(await chips(page)).join(' / ')}`);
    await settle(700);
    await drain('对方走后');
    // a question about the position
    if (n % 2 === 0) await askChip(TURN_CHIPS[(n / 2) % TURN_CHIPS.length]);
    // the pouches, now and then
    if (n % 7 === 3) {
      for (let k = 1; k <= 3; k++) { await tapSel(page, '#hint-button').catch(() => {}); await settle(1300); await drain(`锦囊${k}`); }
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(200);
    }
    const board = await readBoard(page);
    const useWeak = STYLE === 'weak' || (STYLE === 'mixed' && (n % 3 === 2 || n > 14));
    const move = (useWeak ? weak : strong).choose(board);
    if (!move) break;
    if ((await phase(page)) === 'selected') await page.keyboard.press('Escape');
    await tapCell(page, move.from.row, move.from.col);
    await sleep(200);
    await tapCell(page, move.to.row, move.to.col);
    await waitPhase(page, 'tentative', 4000).catch(() => {});
    if ((await phase(page)) !== 'tentative') { log(`   the trial ${JSON.stringify(move)} was not taken (phase ${await phase(page)})`); await page.keyboard.press('Escape'); continue; }
    await settle(1700);
    log(`   试走 ${await page.evaluate(() => document.querySelector('.piece.is-trial')?.dataset.type ?? '')} ${move.from.row}${move.from.col}-${move.to.row}${move.to.col}${useWeak ? ' (weak)' : ''} chips: ${(await chips(page)).join(' / ')}`);
    await drain('试走');
    if (n % 2 === 1 || useWeak) { await askChip(TRIAL_CHIPS[n % TRIAL_CHIPS.length]) || await askChip('good'); await askChip('why'); }
    for (let i = 0; i < 12 && (await phase(page)) === 'tentative'; i++) { await tapSel(page, '#confirm-button').catch(() => {}); await sleep(250); }
    await drain('落子');
    await waitTurn(page, p + 2, 30000);
  }
  if ((await phase(page)) !== 'over') {
    log('-- the game is not over after the scripted moves: the child resigns');
    await tapSel(page, '#menu-button'); await sleep(450);
    await page.evaluate(() => { [...document.querySelectorAll('.hud-menu__item')].find((b) => b.dataset.menu === 'resign')?.click(); });
    await sleep(500);
    await tapSel(page, 'dialog[data-dialog="resign"] [data-choice="go"]');
    await waitPhase(page, 'over', 8000);
  }
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="over"]'), null, 25000, 'the card');
  await settle(2500);
  await drain('终局');
  const card = await page.evaluate(() => {
    const q = (s) => document.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() ?? '';
    return { title: q('.hud-over__title'), sub: q('.hud-over__sub'), best: q('.hud-over__best'), takeaway: q('.hud-over__takeaway'), stats: q('.hud-over__stats'), goal: q('.hud-over__goal'), rank: q('.hud-over__rank'),
             round: (document.querySelector('.hud-round')?.textContent ?? '').replace(/\s+/g, ' ').trim() };
  });
  log(`-- 战报卡: ${JSON.stringify(card)}`);
  await page.screenshot({ path: `${DIR}\\${NAME}-card.png` });
  await tapSel(page, 'dialog[data-dialog="over"] [data-choice="review"]');
  await sleep(900);
  log(`-- 终局 chips: ${(await chips(page)).join(' / ')}`);
  for (const code of ['proud', 'why', 'improve', 'why', 'next', 'why']) await askChip(code);
  const logText = await page.evaluate(() => [...document.querySelectorAll('.msg')].map((m) => `${m.dataset.role ?? ''}/${m.dataset.kind ?? ''}: ${m.textContent.replace(/\s+/g, ' ').trim()}`));
  log(`-- 回看 log: ${logText.length} entries`);
  for (const entry of logText) lines.push(`    ${entry}`);
} catch (e) {
  log('ERROR ' + String(e && e.stack ? e.stack : e).slice(0, 600));
  await page.screenshot({ path: `${DIR}\\${NAME}-ERROR.png` }).catch(() => {});
}
log(`-- page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
writeFileSync(`${DIR}\\${NAME}.log`, lines.join('\n'));
clearTimeout(hardLimit);
await browser.close();
