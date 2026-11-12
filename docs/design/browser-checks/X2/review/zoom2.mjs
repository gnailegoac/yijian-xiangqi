import { OUT, sleep, ev } from './rlib.mjs';
export default async ({ page }) => {
  await ev(page, () => { document.getElementById('lab').dataset.phase = 'over'; const b = document.querySelector('#board'); b.style.cssText += ';position:fixed;right:0;bottom:0;width:3000px;z-index:99'; });
  await sleep(page, 500);
  await page.screenshot({ path: `${OUT}-br.png` });
};
