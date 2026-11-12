// Reviewer: do burst taps on the start card's buttons fall through to the pouch button (phone) or anything else?
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const REPO = 'C:/Users/USERNAME/git/yijian-xiangqi';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const require = createRequire(REPO + '/package.json');
const { chromium } = require('@playwright/test');
const BASE = process.argv[2];
const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) ? { executablePath: CHROME } : {}) });
const hard = setTimeout(() => { console.log('HARD LIMIT'); process.exit(3); }, 560000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const save = JSON.stringify({ schema: 2, id: 'g-pfproof001', humanColor: 'red', moves: ['7774', '0726'], result: null, startedAt: 1790000000000, endedAt: null, activeMs: 1000,
  counted: false, drawFrom: 0, seed: 77, skill: null, memory: null, start: null });
const rhythms = { a: [60, 120], b: [150, 150], c: [250, 250], d: [120, 380], e: [300, 300], f: [200, 340], g: [400, 400], h: [350] };
for (const [w, h] of [[360, 740], [1180, 820]]) {
  for (const [mode, sel] of [['continue', '[data-choice="continue"]'], ['new', '.hud-start__go']]) {
    for (const [name, gaps] of Object.entries(rhythms)) {
      const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'zh-CN' });
      const page = await context.newPage();
      if (mode !== 'new') await page.addInitScript((g) => { if (!localStorage.getItem('yijian.xiangqi.v2.game')) localStorage.setItem('yijian.xiangqi.v2.game', g); }, save);
      await page.goto(`${BASE}/index.html?coach=off&seed=5`, { waitUntil: 'load' });
      await page.waitForSelector(`dialog[data-dialog="start"] ${sel}`, { timeout: 10000 });
      await sleep(700);
      const box = await page.evaluate((s) => { const b = document.querySelector(`dialog[data-dialog="start"] ${s}`).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
      await page.touchscreen.tap(box.x, box.y);
      for (const gap of gaps) { await sleep(gap); await page.touchscreen.tap(box.x, box.y); }
      await sleep(2500);
      const state = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        const app = document.querySelector('#app');
        return {
          under: el ? (el.id || el.className || el.tagName) : null,
          phase: app.dataset.phase, ply: app.dataset.ply,
          selected: !!document.querySelector('.piece.is-selected'),
          hintLevel: document.querySelector('#hint-button')?.dataset.level ?? null,
          dialogs: [...document.querySelectorAll('#overlays dialog[open]')].map((d) => d.dataset.dialog),
          sheet: document.querySelector('#app').dataset.sheet ?? null,
          inert: ['topbar', 'underbar', 'coach', 'actions'].filter((id) => document.getElementById(id).inert).join(','),
        };
      }, [box.x, box.y]);
      // a deliberate tap afterwards is taken: the pouches button on the phone, the centre pawn elsewhere
      if (w < 500) {
        const hb = await page.evaluate(() => { const b = document.querySelector('#hint-button').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
        const before = state.hintLevel;
        await page.touchscreen.tap(hb.x, hb.y);
        await sleep(500);
        state.afterDeliberate = `hint ${before}->${await page.evaluate(() => document.querySelector('#hint-button')?.dataset.level)}`;
      }
      if (state.inert) state.STUCK = true;
      const clean = !state.inert && state.phase === 'childTurn' && !state.selected && (state.hintLevel === '0' || state.hintLevel === null) && state.dialogs.length === 0;
      console.log(`${clean ? 'ok  ' : 'FELL'} ${w}x${h} ${mode.padEnd(8)} ${name} ${gaps.join('+')}: ${JSON.stringify(state)}`);
      await context.close();
    }
  }
}
clearTimeout(hard);
await browser.close();
