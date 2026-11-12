import { record, sheet, clipOf, boardClip, DIR } from './lib.mjs';
export default async ({ page }) => {
  const b = await page.locator('#board').boundingBox();
  const clip = { x: Math.max(0, b.x - 6), y: Math.max(0, b.y - 6), width: b.width + 12, height: b.height + 12 };
  // tension 1 + rival's turn glow
  await page.evaluate(() => { window.view.setTension(1); document.getElementById('lab').dataset.phase = 'opponentTurn'; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${DIR}st-tension.png`, clip });
  await page.evaluate(() => { window.view.setTension(0.1); document.getElementById('lab').dataset.phase = 'childTurn'; window.view.setPosition(window.lab.fenToBoard('4k4/9/9/9/9/9/9/9/9/4K4 w').board); });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${DIR}st-myturn.png`, clip });
  // rival moves: anticipation + horse leap; rival cannon; D3 switch; undo
  const r1 = await record(page, () => page.evaluate(() => { window.demo.rivalMove('horse'); }), 1500);
  const c1 = await clipOf(page, [[2, 6], [4, 5]], 1.3);
  await page.waitForTimeout(300);
  const r2 = await record(page, () => page.evaluate(() => { window.demo.switchTrial(); }), 3300);
  const c2 = await clipOf(page, [[2, 3], [7, 8]], 0.9);
  await page.waitForTimeout(300);
  const r3 = await record(page, () => page.evaluate(() => { window.demo.undo(2); }), 2700);
  const c3 = await clipOf(page, [[5, 2], [7, 5]], 1.0);
  await sheet(page, 'sc-rivalhorse', r1.filter((f) => f.t >= 200), { clip: c1, cols: 9, scale: 0.75, max: 18 });
  await sheet(page, 'sc-switch', r2.filter((f) => f.t >= 250), { clip: c2, cols: 8, scale: 0.42, max: 24 });
  await sheet(page, 'sc-undo2', r3.filter((f) => f.t >= 1500), { clip: c3, cols: 9, scale: 0.65, max: 18 });
};
