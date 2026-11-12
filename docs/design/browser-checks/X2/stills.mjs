// Still screenshots of board states: STILLS env = "name|call|waitMs;..."; saves the board area as st-<name>.png
import { DIR } from './lib.mjs';
export default async ({ page }) => {
  const list = (process.env.STILLS ?? '').split(';').filter(Boolean).map((s) => { const [name, call, ms] = s.split('|'); return { name, call, ms: Number(ms || 1500) }; });
  const b = await page.locator('#board').boundingBox();
  const clip = { x: Math.max(0, b.x - 6), y: Math.max(0, b.y - 6), width: b.width + 12, height: b.height + 12 };
  for (const s of list) {
    await page.evaluate((call) => { new Function(`return window.demo.${call}`)(); }, s.call);
    await page.waitForTimeout(s.ms);
    await page.screenshot({ path: `${DIR}st-${process.env.TAG ?? ''}${s.name}.png`, clip });
  }
  console.log(JSON.stringify(await page.evaluate(() => ({ busy: document.documentElement.dataset.uiBusy ?? null, nodes: document.querySelectorAll('.bv *').length, log: window.__log.slice(-6) }))));
};
