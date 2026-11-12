import { sleep, ev } from './rlib.mjs';
import { magnify } from './mag.mjs';
export default async ({ page }) => {
  await ev(page, () => { document.getElementById('lab').dataset.phase = 'childTurn'; });
  await sleep(page, 1650);                       // 400 ms in + 1250 ms: near the peak of the breath
  await magnify(page, 'bl-glow', 0, 0.9, 0.5, 0.1, 2.4);
  await ev(page, () => { document.getElementById('lab').dataset.phase = 'opponentTurn'; });
  await sleep(page, 1650);
  await magnify(page, 'tl-glow', 0, 0, 0.5, 0.1, 2.4);
};
