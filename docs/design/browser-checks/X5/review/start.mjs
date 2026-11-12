export default async ({ page, shot }) => {
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-start="resume"]').click());
  await page.waitForTimeout(500);
  await shot('cheer');
  await page.waitForTimeout(1600);
  await shot('idle');
};
