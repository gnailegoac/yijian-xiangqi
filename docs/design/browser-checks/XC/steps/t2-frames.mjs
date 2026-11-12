// Task 2, the motion: frames of the coach column while the game-over card comes in (the figure fades out with it)
// and while it goes with 回看棋局 (he fades back in). Full motion, dev/stage.html. Frames are taken back to back.
import { clip, note } from './lib.mjs';
export default async ({ page }) => {
  await page.waitForFunction(() => window.__dev && document.querySelectorAll('.piece').length === 32);
  await page.waitForTimeout(600);
  const scene = process.env.XC_SCENE ?? 'win';
  await page.evaluate((s) => window.__dev.moment[s === 'win' ? 'mate' : 'loss'](), scene);
  await page.waitForTimeout(1300);
  const coach = await page.evaluate(() => { const r = document.querySelector('#coach').getBoundingClientRect(); return { x: r.left - 60, y: r.top, width: r.width + 76, height: r.height }; });
  await clip(page, `${scene}-f-before`, coach);
  await page.evaluate(() => window.__dev.act.confirm());
  await page.waitForSelector('#overlays .hud-layer--over', { state: 'attached', timeout: 30000 });
  const t0 = Date.now();
  const read = () => page.evaluate(() => { const f = document.querySelector('#buddy .buddy-fig'); const c = document.querySelector('#overlays .hud-over'); return { fig: Number(getComputedStyle(f).opacity).toFixed(2), card: c ? Number(getComputedStyle(c).opacity).toFixed(2) : null }; });
  const rows = [];
  for (let i = 0; i < 7; i++) { const o = await read(); const t = Date.now() - t0; await clip(page, `${scene}-f-in${i}`, coach); rows.push(`in${i} t=${t}ms fig=${o.fig} card=${o.card}`); }
  await page.waitForTimeout(2600);
  await clip(page, `${scene}-f-up`, coach);
  await page.locator('#overlays dialog[data-dialog="over"] [data-choice="review"]').click();
  const t1 = Date.now();
  for (let i = 0; i < 7; i++) { const o = await read(); const t = Date.now() - t1; await clip(page, `${scene}-f-out${i}`, coach); rows.push(`out${i} t=${t}ms fig=${o.fig} card=${o.card}`); }
  await page.waitForTimeout(700);
  await clip(page, `${scene}-f-after`, coach);
  note('FRAMES', rows);
};
