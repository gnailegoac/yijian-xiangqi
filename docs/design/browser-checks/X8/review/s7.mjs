export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  await page.click('#dev-toggle');
  await w(300);
  await page.locator('#dev button', { hasText: 'rival 受惊→思考' }).click();
  await w(300);
  const a = await page.evaluate(() => document.querySelector('.rival').dataset.mood);
  await page.click('#dev-toggle');
  await shot('rattled');
  await w(2600);
  const b = await page.evaluate(() => document.querySelector('.rival').dataset.mood);
  await page.click('#dev-toggle');
  await w(200);
  await page.locator('#dev button', { hasText: /^4连好棋！$/ }).click();
  await w(900);
  const popup = await page.evaluate(() => [...document.querySelectorAll('.fx-popup')].map((p) => p.textContent));
  console.error(JSON.stringify({ a, b, popup }));
};
