import { areaShot, sleep, ev } from './rlib.mjs';
export default async ({ page }) => {
  await sleep(page, 300);
  await ev(page, () => { document.querySelector('.board-cell[tabindex="0"]').focus(); });
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(page, 500);
  const info = await ev(page, () => {
    const a = document.activeElement;
    return { cell: `${a.dataset.row},${a.dataset.col}`, fv: a.matches(':focus-visible'), ring: getComputedStyle(a, '::after').outlineStyle, radius: getComputedStyle(a).borderRadius, last: document.getElementById('st-event').textContent };
  });
  console.log('focus', JSON.stringify(info));
  await areaShot(page, 'ring', 0.3, 0.78, 0.5, 0.22);
};
