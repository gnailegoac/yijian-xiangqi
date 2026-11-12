// A real touch drag (CDP touch events) through the tiny game of the harness: drag the cannon to the centre file, then a second tap confirms.
import { record, sheet, cell, clipOf, DIR } from './lib.mjs';
export default async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const center = async (r, c) => { const b = await cell(page, r, c).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  await page.evaluate(() => { window.__ev = []; for (const t of ['board:pick', 'board:dragcancel']) document.body.addEventListener(t, (e) => window.__ev.push([t.slice(6), e.detail.row, e.detail.col, e.detail.via ?? ''])); });
  const [fx, fy] = await center(7, 7), [tx, ty] = await center(7, 4);
  const clip = await clipOf(page, [[6, 3], [8, 8]], 1.0);
  const frames = await record(page, async () => {
    await touch('touchStart', fx, fy + 6);
    for (let i = 1; i <= 12; i++) { await touch('touchMove', fx + (tx - fx) * i / 12, fy + 6 + 40 * Math.sin(Math.PI * i / 12) + (i === 12 ? 36 : 0)); await page.waitForTimeout(25); }
    await page.waitForTimeout(150);
    await touch('touchEnd');
  }, 1300);
  const state = await page.evaluate(() => ({ ev: window.__ev.splice(0), phase: document.getElementById('lab').dataset.phase, trial: document.querySelectorAll('.piece.is-trial').length, at: [document.querySelector('.piece[data-id="red-cannon-7"]').dataset.row, document.querySelector('.piece[data-id="red-cannon-7"]').dataset.col],
    translate: document.querySelector('.piece[data-id="red-cannon-7"]').style.translate, dragging: document.querySelectorAll('.is-dragging, .bv-magnet').length }));
  console.log('DRAG', JSON.stringify(state));
  // drag again and drop on nothing: board:dragcancel
  await page.evaluate(() => window.demo.start());
  await page.waitForTimeout(200);
  await touch('touchStart', fx, fy);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', fx - 20 * i, fy - 22 * i); await page.waitForTimeout(20); }
  await touch('touchEnd');
  await page.waitForTimeout(300);
  console.log('CANCEL', JSON.stringify(await page.evaluate(() => ({ ev: window.__ev.splice(0), translate: document.querySelector('.piece[data-id="red-cannon-7"]').style.translate, sel: document.querySelectorAll('.piece.is-selected').length }))));
  await sheet(page, 'sc-touchdrag', frames, { clip, cols: 8, scale: 0.7, max: 16 });
};
