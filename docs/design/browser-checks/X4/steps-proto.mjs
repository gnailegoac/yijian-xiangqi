import { writeFileSync } from 'node:fs';
export default async ({ page }) => {
  await page.waitForFunction(() => window.__r, null, { timeout: 120000 });
  writeFileSync(process.env.X4_OUT, JSON.stringify(await page.evaluate(() => window.__r), null, 1));
};
