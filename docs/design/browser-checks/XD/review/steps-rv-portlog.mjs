// XD review: the 动静 card in portrait (the meter is sticky there, so the card is scrolled below it)
export default async ({ page, shot }) => {
  await page.goto(page.url().split('?')[0] + `?theme=${process.env.RV_THEME ?? 'longzhong'}`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const pad = page.locator('[data-sfx="win"]').first();
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const card = document.querySelector('#log').closest('.card'); window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 470); });
  await page.waitForTimeout(200);
  await shot('card');
};
