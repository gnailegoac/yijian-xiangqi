// Captures parts of dev/buddy.html as their own PNGs (element screenshots).
// Env: X5_OUT = folder, X5_TAG = file prefix, X5_ONLY = comma list of CSS selectors (optional)
import path from 'node:path';

export default async ({ page }) => {
  const out = process.env.X5_OUT;
  const tag = process.env.X5_TAG ?? 'sec';
  const only = (process.env.X5_ONLY ?? '#sheet,#bust-strip,#sheet-small,#stage-section,#rival-section').split(',');
  await page.addStyleTag({ content: '.bar { position: static !important; }' });
  await page.waitForTimeout(300);
  for (const sel of only) {
    const loc = page.locator(sel).first();
    await loc.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const name = sel.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
    await loc.screenshot({ path: path.join(out, `${tag}-${name}.png`) });
  }
};
