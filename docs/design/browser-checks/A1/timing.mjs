// Timing of the boot and of the main thread while the rival thinks (headless Chrome, the build machine).
// Usage: node timing.mjs <url> [runs] [moves]
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { sleep, ply, waitFor, tapSel } from './lib.mjs';
import { createBot, readBoard, playMove, waitTurn } from './bot.mjs';

const REPO = 'C:\\Users\\USERNAME\\git\\yijian-xiangqi';
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const require = createRequire(`${REPO}\\package.json`);
const { chromium } = require('@playwright/test');

const url = process.argv[2];
const runs = Number(process.argv[3] ?? 3);
const moves = Number(process.argv[4] ?? 8);
const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });
const rows = [];
const median = (list) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

for (let run = 1; run <= runs; run++) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'zh-CN' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.addInitScript(() => {
    const m = { startCard: null, tapDown: null, tapUp: null, click: null, pieces32: null, childTurn: null, ready: null, long: [], gaps: [], phaseLog: [] };
    window.__m = m;
    const now = () => Math.round(performance.now() * 10) / 10;
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) m.long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration), phase: document.querySelector('#app')?.dataset.phase }); })
        .observe({ entryTypes: ['longtask'] });
    } catch {}
    new MutationObserver(() => {
      if (m.startCard === null && document.querySelector('dialog[data-dialog="start"] [data-choice]')) m.startCard = now();
      if (m.pieces32 === null && document.querySelectorAll('.piece[data-id]').length === 32) m.pieces32 = now();
      const app = document.querySelector('#app');
      if (app) {
        const p = app.dataset.phase;
        if (m.phaseLog.length === 0 || m.phaseLog[m.phaseLog.length - 1][0] !== p) m.phaseLog.push([p, now()]);
        if (m.childTurn === null && p === 'childTurn') m.childTurn = now();
      }
      if (m.ready === null && document.documentElement.dataset.ready === '1') m.ready = now();
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase', 'data-ready', 'data-dialog'] });
    window.addEventListener('pointerdown', () => { if (m.startCard !== null && m.tapDown === null) m.tapDown = now(); }, true);
    window.addEventListener('pointerup', () => { if (m.tapDown !== null && m.tapUp === null) m.tapUp = now(); }, true);
    window.addEventListener('click', () => { if (m.tapDown !== null && m.click === null) m.click = now(); }, true);
    // the main thread's longest stall, sampled with a message-channel ping (finer than the 50 ms floor of longtask)
    const ch = new MessageChannel();
    let last = performance.now();
    ch.port1.onmessage = () => {
      const t = performance.now();
      const gap = t - last;
      last = t;
      const p = document.querySelector('#app')?.dataset.phase;
      if (gap > 8) m.gaps.push({ at: Math.round(t), ms: Math.round(gap * 10) / 10, phase: p });
      setTimeout(() => ch.port2.postMessage(0), 0);
    };
    ch.port2.postMessage(0);
  });
  await page.goto(url, { waitUntil: 'load', timeout: 20000 });
  await waitFor(page, () => window.__m.startCard !== null, null, 10000, 'start card');
  await sleep(700);
  await tapSel(page, 'dialog[data-dialog="start"] .hud-start__go');
  await waitTurn(page, 0, 15000);
  const bot = createBot({ style: 'strong', timeMs: 150 });
  for (let n = 1; n <= moves; n++) {
    const st = await waitTurn(page, 0, 30000);
    if (st === 'over') break;
    await sleep(350);
    const before = await ply(page);
    await playMove(page, bot.choose(await readBoard(page)), { think: 450 });
    await waitTurn(page, before + 2, 30000);
  }
  const m = await page.evaluate(() => window.__m);
  const speed = await page.evaluate(() => window.__yijian?.tasks.stats() ?? null);
  const rivalGaps = m.gaps.filter((g) => g.phase === 'opponentTurn');
  const rivalLong = m.long.filter((l) => l.phase === 'opponentTurn');
  // the spans of the rival's turns, for the count
  const spans = [];
  for (let i = 0; i < m.phaseLog.length - 1; i++) if (m.phaseLog[i][0] === 'opponentTurn') spans.push(Math.round(m.phaseLog[i + 1][1] - m.phaseLog[i][1]));
  const row = {
    run,
    navToStartCard: m.startCard,
    tapToPieces: m.pieces32 !== null && m.tapDown !== null ? Math.round(m.pieces32 - m.tapDown) : null,
    tapToChildTurn: m.childTurn !== null && m.tapDown !== null ? Math.round(m.childTurn - m.tapDown) : null,
    tapToReady: m.ready !== null && m.tapDown !== null ? Math.round(m.ready - m.tapDown) : null,
    tapDownToUp: m.tapUp !== null ? Math.round(m.tapUp - m.tapDown) : null,
    longAroundTap: m.long.filter((l) => m.tapDown !== null && l.at >= m.tapDown - 50 && l.at <= m.tapDown + 1500),
    longAll: m.long.length, longList: m.long, childGaps: m.gaps.filter((g) => g.ms > 30),
    longMax: m.long.reduce((a, l) => Math.max(a, l.ms), 0),
    rivalTurns: spans.length,
    rivalTurnMs: median(spans),
    rivalLongTasks: rivalLong,
    rivalMaxGap: rivalGaps.reduce((a, g) => Math.max(a, g.ms), 0),
    rivalGapsOver16: rivalGaps.filter((g) => g.ms > 16).length,
    rivalGapsOver50: rivalGaps.filter((g) => g.ms > 50).length,
    childMaxGap: m.gaps.filter((g) => g.phase === 'childTurn' || g.phase === 'selected' || g.phase === 'tentative').reduce((a, g) => Math.max(a, g.ms), 0),
    errors,
    speed,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
  await context.close();
}
await browser.close();
console.log('SUMMARY', JSON.stringify({
  navToStartCard: rows.map((r) => r.navToStartCard), tapToPieces: rows.map((r) => r.tapToPieces), tapToChildTurn: rows.map((r) => r.tapToChildTurn),
  rivalMaxGap: rows.map((r) => r.rivalMaxGap), rivalLongTasks: rows.map((r) => r.rivalLongTasks.map((l) => l.ms)), longMax: rows.map((r) => r.longMax),
}));
