// Where does step 10 of app.js run relative to the tap on the start button?
// Case A: the start button is the first gesture of the visit. Case B: the audio context is already running (the child
// opened and closed the settings sheet first), so stage.start() can resolve without waiting.
// Usage: node rv-tap.mjs <base url>
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { sleep, waitFor, tapSel } from '../lib.mjs';

const REPO = 'C:\\Users\\USERNAME\\git\\yijian-xiangqi';
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const require = createRequire(`${REPO}\\package.json`);
const { chromium } = require('@playwright/test');
const BASE = process.argv[2];

const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });

async function run(name, warm) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: 'zh-CN' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__m = { events: [], long: [], phaseAt: null, clickAt: null, clickEnd: null };
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__m.long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__m.events.push({ name: e.name, at: Math.round(e.startTime), proc: Math.round(e.processingEnd - e.processingStart), dur: Math.round(e.duration) });
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    document.addEventListener('click', (ev) => {
      const b = ev.target instanceof Element ? ev.target.closest('.hud-start__go') : null;
      if (!b) return;
      window.__m.clickAt = performance.now();
      // a microtask queued now runs after the handlers of this click and after the microtasks they queued
      Promise.resolve().then(() => Promise.resolve()).then(() => { window.__m.clickEnd = performance.now(); });
      setTimeout(() => { window.__m.taskAfter = performance.now(); }, 0);
    }, true);
    const watch = () => {
      const app = document.querySelector('#app');
      if (!app) { requestAnimationFrame(watch); return; }
      new MutationObserver(() => { if (window.__m.phaseAt === null && app.dataset.phase && app.dataset.phase !== 'boot') window.__m.phaseAt = performance.now(); })
        .observe(app, { attributes: true, attributeFilter: ['data-phase'] });
    };
    watch();
  });
  await page.goto(`${BASE}/index.html?coach=off`, { waitUntil: 'load' });
  await waitFor(page, () => !!document.querySelector('dialog[data-dialog="start"] [data-choice]'), null, 8000, 'start card');
  await sleep(700);
  if (warm) {
    await tapSel(page, 'dialog[data-dialog="start"] [data-action="settings"]');
    await sleep(1200);
    await page.keyboard.press('Escape');
    await sleep(600);
  }
  await tapSel(page, 'dialog[data-dialog="start"] .hud-start__go');
  await waitFor(page, () => window.__m.phaseAt !== null, null, 8000, 'the first position');
  await sleep(1500);
  const m = await page.evaluate(() => window.__m);
  const after = (t) => (t === null || t === undefined ? null : Math.round(t - m.clickAt));
  const out = {
    name,
    gameStartsAfterClickMs: after(m.phaseAt),
    nextTaskAfterClickMs: after(m.taskAfter),
    step10InsideTheClickTask: m.phaseAt !== null && m.taskAfter !== undefined && m.phaseAt < m.taskAfter,
    clickEvents: m.events.filter((e) => ['click', 'pointerup', 'pointerdown', 'touchend'].includes(e.name) && e.at >= m.clickAt - 400),
    longTasksAfterClick: m.long.filter((l) => l.at >= m.clickAt - 300),
    errors,
  };
  console.log(JSON.stringify(out));
  await context.close();
}

for (let i = 0; i < 2; i++) {
  await run('A first gesture', false);
  await run('B audio already running', true);
}
await browser.close();
