import { writeFileSync } from 'node:fs';
export default async ({ page, shot }) => {
  const t0 = Date.now();
  await page.waitForFunction(() => window.__measure && typeof window.__measure.ok === 'boolean', null, { timeout: 280000 });
  const result = await page.evaluate(() => window.__measure);
  result.wallMs = Date.now() - t0;
  writeFileSync(process.env.X4_OUT, JSON.stringify(result, null, 1));
  await shot('bench');
};
