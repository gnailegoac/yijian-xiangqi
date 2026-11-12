// XD: the 动静 card of dev/audio.html after the first tap, as an element screenshot (XD_CARD = png path).
export default async ({ page }) => {
  await page.waitForTimeout(900);
  const pad = page.locator('[data-sfx="place"]').first();
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  // wait for the readout (the first context of a browser process can take a second)
  await page.waitForFunction(() => [...document.querySelectorAll('#log li')].some(li => li.textContent.includes('首次触碰')), null, { timeout: 8000 });
  const log = await page.evaluate(() => [...document.querySelectorAll('#log li')].map(li => li.textContent));
  console.log('XDLOG ' + JSON.stringify(log));
  const card = page.locator('section.card', { has: page.locator('#log') });
  await card.screenshot({ path: process.env.XD_CARD });
  const fit = await page.evaluate(() => {
    const li = [...document.querySelectorAll('#log li')].find(x => x.textContent.includes('首次触碰'));
    const span = li.querySelector('span');
    const a = li.getBoundingClientRect(), b = span.getBoundingClientRect(), c = li.closest('section').getBoundingClientRect();
    return { liH: Math.round(a.height), spanH: Math.round(b.height), spanRight: Math.round(b.right), cardRight: Math.round(c.right), lineH: parseFloat(getComputedStyle(li).lineHeight) };
  });
  console.log('XDFIT ' + JSON.stringify(fit));
};
