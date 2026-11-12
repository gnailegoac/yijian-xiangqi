// scratch: what the mock answers to the turn chips (to find a line of two sentences for the cut scene)
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/USERNAME/git/yijian-xiangqi/package.json');
const { chromium } = require('@playwright/test');
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
const page = await context.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => process.exit(3), 90000);
await page.goto('http://127.0.0.1:5173/?test=1', { waitUntil: 'load' });
await page.waitForSelector('html[data-ready="1"]');
await page.waitForSelector('.bubble[data-state="done"]');
const tapCell = async (r, c) => { const b = await page.locator(`.board-cell[data-row="${r}"][data-col="${c}"]`).boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
await tapCell(7, 7); await sleep(200); await tapCell(7, 4); await sleep(500); await tapCell(7, 4);
await page.waitForSelector('#app[data-ply="2"]', { timeout: 15000 });
await sleep(2500);
for (let i = 0; i < 4; i++) {
  const chips = await page.locator('.chip:not([disabled])').all();
  if (!chips.length) break;
  const label = await chips[0].textContent();
  await chips[0].tap();
  await sleep(2500);
  const text = await page.evaluate(() => { const all = document.querySelectorAll('.chat__log .msg[data-kind="ask"] .msg__text'); return all.length ? all[all.length - 1].textContent : ''; });
  console.log(`${label} -> ${text}`);
}
await browser.close();
process.exit(0);
