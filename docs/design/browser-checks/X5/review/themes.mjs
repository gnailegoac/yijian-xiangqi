import path from 'node:path';
export default async ({ page }) => {
  const out = process.env.RV_OUT, tag = process.env.RV_TAG;
  await page.addStyleTag({ content: '.bar { position: static !important; }' });
  const click = async (sel) => { await page.evaluate((s) => document.querySelector(s).click(), sel); };
  const snap = async (name) => {
    const loc = page.locator('.mock__coach'); await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(120);
    const b = await loc.boundingBox();
    await page.screenshot({ path: path.join(out, `${tag}-${name}.png`), clip: { x: Math.max(0, b.x - 80), y: Math.max(0, b.y + 150), width: b.width + 100, height: b.height - 140 } });
  };
  await click('[data-scene="brilliant"]'); await page.waitForTimeout(3200); await snap('brilliant');
  await click('[data-scene="held"]'); await page.waitForTimeout(600); await snap('held');
  await click('[data-b="stale-retract"]'); await page.waitForTimeout(300); await snap('stale');
  await click('[data-scene="win"]'); await page.waitForTimeout(1900); await snap('win');
  await page.evaluate(() => { window.rival.set({ mood: 'rattled', line: '竟有此着！' }); });
  await page.waitForTimeout(500);
  const r = page.locator('#rival-mock'); await r.scrollIntoViewIfNeeded(); await page.waitForTimeout(100);
  await r.screenshot({ path: path.join(out, `${tag}-rival.png`) });
};
