// The live stage of dev/buddy.html in its four mock layouts with several bubble states.
import path from 'node:path';
export default async ({ page }) => {
  const out = process.env.RV_OUT, tag = process.env.RV_TAG ?? 'st';
  await page.addStyleTag({ content: '.bar { position: static !important; }' });
  const click = async (sel) => { await page.evaluate((s) => document.querySelector(s).click(), sel); };
  const snap = async (name) => { const loc = page.locator('#mock'); await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(120); await loc.screenshot({ path: path.join(out, `${tag}-${name}.png`) }); };
  for (const layout of (process.env.RV_LAYOUTS ?? 'landscape,landscape-kb,portrait,compact').split(',')) {
    await click(`[data-mock="${layout}"]`);
    await click('[data-b="long"]'); await page.waitForTimeout(6500); await snap(`${layout}-long`);
    await click('[data-b="stale-commit"]'); await page.waitForTimeout(300); await snap(`${layout}-longstale`);
    await click('[data-scene="ask"]'); await page.waitForTimeout(4200); await snap(`${layout}-ask`);
    await click('[data-b="stale-retract"]'); await page.waitForTimeout(300); await snap(`${layout}-stale`);
    await click('[data-scene="rival"]'); await page.waitForTimeout(600); await snap(`${layout}-status`);
    await page.waitForTimeout(3200); await snap(`${layout}-caption`);
    await click('[data-scene="held"]'); await page.waitForTimeout(1500); await snap(`${layout}-held`);
  }
};
