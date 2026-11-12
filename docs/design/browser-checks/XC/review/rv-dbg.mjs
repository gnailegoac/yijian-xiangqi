// Debug: where does the focus go when the mood changes while the card is up?
import { note } from './rlib.mjs';
const sleep = (page, ms) => page.waitForTimeout(ms);
export default async ({ page }) => {
  await page.waitForFunction(() => window.__dev && document.querySelector('#buddy .buddy-fig'));
  await sleep(page, 400);
  const active = () => page.evaluate(() => { const e = document.activeElement; return e ? (e.id || String(e.className).split(' ')[0] || e.tagName) + (e.matches(':focus-visible') ? ' (focus-visible)' : '') : null; });
  await page.evaluate(() => window.__dev.over('win'));
  await sleep(page, 900);
  note('RV a0', await active());
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  note('RV a1 after 6 tabs', await active());
  const p = await page.evaluate(() => { const f = document.querySelector('#buddy .buddy-fig').getBoundingClientRect(); return { x: f.left + f.width / 2, y: f.bottom - 5 }; });
  await page.touchscreen.tap(p.x, p.y);
  await sleep(page, 150);
  note('RV a2 after tap', await active());
  for (const mood of ['idle', 'listening', 'thinking']) {
    await page.evaluate((m) => window.__dev.coachFigure(m), mood);
    await sleep(page, 250);
    note(`RV a3 ${mood}`, await active());
  }
};
