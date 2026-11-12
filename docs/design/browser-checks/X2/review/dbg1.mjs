import { OUT, sleep, ev } from './rlib.mjs';
export default async ({ page }) => {
  await sleep(page, 400);
  const cell = (r, c) => page.locator(`.board-cell[data-row="${r}"][data-col="${c}"]`);
  await cell(7, 7).tap();
  await sleep(page, 400);
  console.log(JSON.stringify(await ev(page, () => ({ sy: scrollY, sx: scrollX, vv: [visualViewport.offsetLeft, visualViewport.offsetTop, visualViewport.scale], b: document.querySelector('#board').getBoundingClientRect().toJSON(), st: document.querySelector('#stage').scrollTop, lab: document.querySelector('#lab').scrollTop, de: document.documentElement.scrollTop, body: document.body.scrollTop }))));
  await cell(7, 4).tap();
  await sleep(page, 600);
  console.log(JSON.stringify(await ev(page, () => ({ sy: scrollY, sx: scrollX, vv: [visualViewport.offsetLeft, visualViewport.offsetTop, visualViewport.scale], b: document.querySelector('#board').getBoundingClientRect().toJSON(), st: document.querySelector('#stage').scrollTop, lab: document.querySelector('#lab').scrollTop, de: document.documentElement.scrollTop, body: document.body.scrollTop }))));
  await page.screenshot({ path: `${OUT}-after.png` });
};
