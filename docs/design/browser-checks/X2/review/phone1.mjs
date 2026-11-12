import { boardShot, sleep, ev } from './rlib.mjs';
export default async ({ page }) => {
  await sleep(page, 300);
  await ev(page, () => window.demo.select());
  await sleep(page, 700);
  await boardShot(page, 'select', 2);
  await ev(page, () => window.demo.trial('horse'));
  await sleep(page, 1100);
  await boardShot(page, 'trial', 2);
  await ev(page, () => window.demo.aim('cannon'));
  await sleep(page, 1000);
  await boardShot(page, 'aim', 2);
};
