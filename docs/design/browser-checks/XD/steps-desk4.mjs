// XD: dev/audio.html after the first tap: the readout of what the tap cost (the 动静 card), by eye and as text.
export default async ({ page, shot }) => {
  await page.waitForTimeout(900);
  await shot('idle');
  const pad = page.locator('[data-sfx="place"]').first();
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(900);
  const log = await page.evaluate(() => [...document.querySelectorAll('#log li')].map(li => li.textContent));
  console.log('XDLOG ' + JSON.stringify(log));
  const card = page.locator('#log');
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await shot('tapped');
  // the smallest touch target of the card, and whether a line of the log is cut off
  const fit = await page.evaluate(() => {
    const ul = document.querySelector('#log');
    const rows = [...ul.children].map(li => ({ w: Math.round(li.getBoundingClientRect().width), sw: li.scrollWidth, cw: li.clientWidth, h: Math.round(li.getBoundingClientRect().height) }));
    return { ulW: Math.round(ul.getBoundingClientRect().width), rows };
  });
  console.log('XDFIT ' + JSON.stringify(fit));
  // a second engine: 拆台重搭, then the next tap is timed again
  await page.locator('#rebuild').scrollIntoViewIfNeeded();
  await page.locator('#rebuild').tap();
  await page.waitForTimeout(500);
  await pad.scrollIntoViewIfNeeded();
  const box2 = await pad.boundingBox();
  await page.touchscreen.tap(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.waitForTimeout(900);
  const log2 = await page.evaluate(() => [...document.querySelectorAll('#log li')].map(li => li.textContent));
  console.log('XDLOG2 ' + JSON.stringify(log2));
};
