import { areaShot, sleep, ev } from './rlib.mjs';
export default async ({ page }) => {
  await sleep(page, 300);
  for (const ph of ['over', 'childTurn', 'opponentTurn']) {
    await ev(page, (p) => { document.getElementById('lab').dataset.phase = p; }, ph);
    await sleep(page, 1700);   // breathing: 400 in, then 2.4 s loop; 1700 ms => 400 + 1300 ≈ peak of the breath (.7)
    await areaShot(page, `bot-${ph}`, 0, 0.88, 1, 0.12);
    await areaShot(page, `top-${ph}`, 0, 0, 1, 0.12);
  }
};
