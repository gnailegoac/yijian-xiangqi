import { DIR } from './lib.mjs';
export default async ({ page }) => {
  const b = await page.locator('#board').boundingBox();
  const clip = { x: Math.max(0, b.x - 6), y: Math.max(0, b.y - 6), width: b.width + 12, height: b.height + 12 };
  await page.evaluate(() => window.demo.mid());
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${DIR}st-glow-mine.png`, clip });
  await page.evaluate(() => { document.getElementById('lab').dataset.phase = 'opponentTurn'; });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${DIR}st-glow-rival.png`, clip });
};
