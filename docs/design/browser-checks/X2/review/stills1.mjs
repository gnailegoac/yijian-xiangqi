import { boardShot, areaShot, sleep, ev } from './rlib.mjs';
export default async ({ page }) => {
  await sleep(page, 300);
  await boardShot(page, 'start');
  // selection with forbidden dots
  await ev(page, () => window.demo.select());
  await sleep(page, 700);
  await boardShot(page, 'select');
  // hover trial of a cannon
  await ev(page, () => window.demo.trial('cannon'));
  await sleep(page, 900);
  await boardShot(page, 'trial');
  await ev(page, () => window.demo.aim('cannon'));
  await sleep(page, 900);
  await boardShot(page, 'aimcannon');
  await ev(page, () => window.demo.aim('horse'));
  await sleep(page, 900);
  await boardShot(page, 'aimhorse');
  await ev(page, () => window.demo.checked());
  await sleep(page, 1800);
  await boardShot(page, 'checked');
};
