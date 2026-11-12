// Screenshot only the .mock__coach element (plus 30px margins) for the four layouts and states; faster to read.
import path from 'node:path';
export default async ({ page }) => {
  const out = process.env.RV_OUT, tag = process.env.RV_TAG ?? 'cr';
  await page.addStyleTag({ content: '.bar { position: static !important; }' });
  const click = async (sel) => { await page.evaluate((s) => document.querySelector(s).click(), sel); };
  const snap = async (name) => {
    const loc = page.locator('.mock__coach'); await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(120);
    const b = await loc.boundingBox();
    await page.screenshot({ path: path.join(out, `${tag}-${name}.png`), clip: { x: Math.max(0, b.x - 40), y: Math.max(0, b.y - 8), width: Math.min(b.width + 60, 1180 - Math.max(0, b.x - 40)), height: b.height + 16 } });
  };
  for (const layout of (process.env.RV_LAYOUTS ?? 'landscape-kb,portrait,compact').split(',')) {
    await click(`[data-mock="${layout}"]`);
    await click('[data-b="long"]'); await page.waitForTimeout(6500); await snap(`${layout}-long`);
    await click('[data-b="stale-commit"]'); await page.waitForTimeout(300); await snap(`${layout}-longstale`);
    await click('[data-scene="ask"]'); await page.waitForTimeout(4200); await snap(`${layout}-ask`);
    await click('[data-b="stale-retract"]'); await page.waitForTimeout(300); await snap(`${layout}-stale`);
    await click('[data-scene="rival"]'); await page.waitForTimeout(600); await snap(`${layout}-status`);
    await page.waitForTimeout(3200); await snap(`${layout}-caption`);
    await click('[data-scene="held"]'); await page.waitForTimeout(1500); await snap(`${layout}-held`);
    await click('[data-b="begin-wait"]'); await page.waitForTimeout(700); await snap(`${layout}-dots`);
  }
};
