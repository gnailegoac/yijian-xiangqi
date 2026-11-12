export default async ({ page, shot }) => { await page.waitForTimeout(9000); await page.evaluate(() => window.scrollTo(0, 420)); await page.waitForTimeout(200); await shot('q'); };
