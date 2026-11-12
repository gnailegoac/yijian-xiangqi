// Reviewer: timeline after the tap on the start button. Usage: node rv-timeline.mjs <base>
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const REPO = 'C:/Users/USERNAME/git/yijian-xiangqi';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const require = createRequire(REPO + '/package.json');
const { chromium } = require('@playwright/test');
const BASE = process.argv[2];
const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });
const hard = setTimeout(() => { console.log('HARD LIMIT'); process.exit(3); }, 120000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [w, h, reduced] of [[1180, 820, false], [1180, 820, true], [360, 740, false]]) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'zh-CN', reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  await page.goto(`${BASE}/index.html?coach=off&seed=5`, { waitUntil: 'load' });
  await page.waitForSelector('dialog[data-dialog="start"] .hud-start__go', { timeout: 10000 });
  await sleep(700);
  await page.evaluate(() => {
    window.__log = [];
    const t = () => Math.round(performance.now() - window.__t0);
    window.addEventListener('pointerdown', () => { if (window.__t0 === undefined) window.__t0 = performance.now(); window.__log.push(`tap@${t()}`); }, true);
    const board = document.querySelector('#board');
    let was = board.classList.contains('is-interactive');
    new MutationObserver(() => { const now = board.classList.contains('is-interactive'); if (now !== was) { was = now; window.__log.push(`${now ? 'INTERACTIVE' : 'held'}@${t()}`); } }).observe(board, { attributes: true, attributeFilter: ['class'] });
    const overlays = document.querySelector('#overlays');
    new MutationObserver(() => { if (!overlays.querySelector('dialog[data-dialog="start"]') && !window.__gone) { window.__gone = true; window.__log.push(`overlay-gone@${t()}`); } }).observe(overlays, { childList: true, subtree: true });
    let pieces = 0;
    new MutationObserver(() => { const n = board.querySelectorAll('.piece').length; if (n !== pieces) { pieces = n; if (n === 32) window.__log.push(`32-pieces@${t()}`); } }).observe(board, { childList: true, subtree: true });
    const poll = () => { const anims = board.getAnimations ? board.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length : 0; const last = window.__anim; if (last !== anims) { window.__anim = anims; if (window.__t0 !== undefined) window.__log.push(`anims=${anims}@${t()}`); } requestAnimationFrame(poll); };
    poll();
  });
  const box = await page.evaluate(() => { const b = document.querySelector('dialog[data-dialog="start"] .hud-start__go').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.touchscreen.tap(box.x, box.y);
  await sleep(2500);
  console.log(`${w}x${h} ${reduced ? 'reduced' : 'full'}: ${(await page.evaluate(() => window.__log)).join('  ')}`);
  await context.close();
}
clearTimeout(hard);
await browser.close();
