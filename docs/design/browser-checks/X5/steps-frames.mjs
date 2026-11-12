// Captures a short frame sequence of the live figure after a trigger.
// Env: X5_OUT, X5_TAG, X5_DO (js evaluated in the page: uses window.buddy / window.rival), X5_N (frames), X5_DT (ms), X5_SEL (element)
import path from 'node:path';

export default async ({ page }) => {
  const out = process.env.X5_OUT;
  const tag = process.env.X5_TAG ?? 'f';
  const n = Number(process.env.X5_N ?? 8);
  const dt = Number(process.env.X5_DT ?? 80);
  const sel = process.env.X5_SEL ?? '#buddy .buddy-fig';
  await page.addStyleTag({ content: '.bar { position: static !important; }' });
  const pre = process.env.X5_PRE;
  if (pre) { await page.evaluate(pre); await page.waitForTimeout(500); }
  const loc = page.locator(sel).first();
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await loc.boundingBox();
  const pad = Number(process.env.X5_PAD ?? 40);
  const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad };
  await page.evaluate(process.env.X5_DO);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await page.screenshot({ path: path.join(out, `${tag}-${String(i).padStart(2, '0')}.png`), clip });
    const next = t0 + (i + 1) * dt;
    const wait = next - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
  }
};
