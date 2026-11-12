// scratch (item 9): a long typed answer (#long of the mock) is being typed; a first trial cuts it. usage: node probe-cut3.mjs <label>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/USERNAME/git/yijian-xiangqi/package.json');
const { chromium } = require('@playwright/test');
const label = process.argv[2] ?? 'after';
mkdirSync(new URL(`./shots/${label}/`, import.meta.url), { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => process.exit(3), 150000);
for (const [name, width, height] of [['landscape', 1180, 820], ['portrait', 820, 1180], ['phone', 360, 740]]) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.route('**/api/coach', (route) => route.continue({ url: `${route.request().url()}?chunkMs=120` }));
  await page.goto('http://127.0.0.1:5173/?test=1', { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready="1"]');
  await page.waitForSelector('.bubble[data-state="done"]', { timeout: 20000 });
  // open the sheet with the input, type #long and send it
  await page.evaluate(() => document.querySelector('.bubble').dispatchEvent(new CustomEvent('bubble:expand', { bubbles: true })));
  await sleep(500);
  await page.locator('#chat-toggle').tap();
  await page.locator('#chat-input').fill('#long');
  await sleep(900);
  await page.locator('#chat-send').tap();
  const read = () => page.evaluate(() => { const all = document.querySelectorAll('.chat__log .msg[data-kind="ask"]'); const m = all[all.length - 1]; return m ? { state: m.dataset.state, text: m.querySelector('.msg__text').textContent } : null; });
  let seen = null;
  for (let i = 0; i < 300; i++) { seen = await read(); if (seen && seen.state === 'streaming' && /[。！？].+/.test(seen.text)) break; await sleep(30); }
  console.log(`CUT3 ${label} ${name}: before the trial: ${seen ? `${seen.state} ${seen.text.length} chars "${seen.text.slice(0, 60)}…"` : 'no line'}`);
  // close the sheet (a tap on its head), then a first trial
  await page.evaluate(() => document.querySelector('.chat__head').click());
  const tapCell = async (r, c) => { const b = await page.locator(`.board-cell[data-row="${r}"][data-col="${c}"]`).boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
  await tapCell(7, 7); await sleep(150); await tapCell(7, 4); await sleep(400);
  const after = await read();
  const phase = await page.evaluate(() => document.querySelector('#app').dataset.phase);
  console.log(`   after the trial (phase ${phase}): ${after ? `${after.state} ${after.text.length} chars, ends "${after.text.slice(-12)}"` : 'the line is gone'}`);
  await page.evaluate(() => document.querySelector('.bubble').dispatchEvent(new CustomEvent('bubble:expand', { bubbles: true })));
  await sleep(600);
  await page.screenshot({ path: new URL(`./shots/${label}/item9-cut3-${name}.png`, import.meta.url).pathname.slice(1) });
  await context.close();
}
await browser.close();
process.exit(0);
