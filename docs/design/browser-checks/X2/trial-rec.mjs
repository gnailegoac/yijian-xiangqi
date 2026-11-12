import { record, sheet, cell, clipOf } from './lib.mjs';
export default async ({ page }) => {
  const clip = await clipOf(page, [[6, 3], [8, 8]], 0.9);
  const a = await record(page, () => cell(page, 7, 7).tap(), 450);
  const b = await record(page, () => cell(page, 7, 4).tap(), 650);
  await page.waitForTimeout(300);
  const c = await record(page, () => cell(page, 7, 4).tap(), 600);
  console.log(JSON.stringify(await page.evaluate(() => ({ last: document.querySelector('.bv-g-last')?.innerHTML.slice(0, 200), scroll: [scrollX, scrollY] }))));
  await sheet(page, 'rec-select', a, { clip, cols: 8, scale: 0.7, max: 16 });
  await sheet(page, 'rec-trial', b, { clip, cols: 8, scale: 0.7, max: 16 });
  await sheet(page, 'rec-commit', c, { clip, cols: 8, scale: 0.7, max: 16 });
};
