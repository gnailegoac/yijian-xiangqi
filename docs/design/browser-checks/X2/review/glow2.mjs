import { areaShot, boardShot, sleep, ev } from './rlib.mjs';
import { readFileSync, existsSync } from 'node:fs';
const CSS_FILE = new URL('./try.css', import.meta.url);
export default async ({ page }) => {
  if (existsSync(CSS_FILE)) await page.addStyleTag({ content: readFileSync(CSS_FILE, 'utf8') });
  await sleep(page, 300);
  for (const ph of ['over', 'childTurn', 'opponentTurn']) {
    await ev(page, (p) => { document.getElementById('lab').dataset.phase = p; }, ph);
    await sleep(page, 1650);
    await areaShot(page, `bot-${ph}`, 0, 0.84, 1, 0.16);
    await areaShot(page, `top-${ph}`, 0, 0, 1, 0.16);
  }
  await ev(page, () => { document.getElementById('lab').dataset.phase = 'childTurn'; });
  await sleep(page, 1650);
  await boardShot(page, 'board-mine');
  await ev(page, () => { document.getElementById('lab').dataset.phase = 'opponentTurn'; });
  await sleep(page, 1650);
  await boardShot(page, 'board-rival');
};
