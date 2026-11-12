import { sleep, ev } from './rlib.mjs';
import { magnify } from './mag.mjs';
export default async ({ page }) => {
  await ev(page, () => { document.getElementById('lab').dataset.phase = 'over'; });
  await sleep(page, 500);
  await magnify(page, 'tl', 0, 0, 0.5, 0.1);
  await magnify(page, 'tr', 0.5, 0, 0.5, 0.1);
  await magnify(page, 'bl', 0, 0.9, 0.5, 0.1);
  await magnify(page, 'br', 0.5, 0.9, 0.5, 0.1);
};
