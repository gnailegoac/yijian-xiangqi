// Element screenshots of parts of dev/buddy.html.
// Env: RV_OUT folder, RV_TAG prefix, RV_ONLY comma list of selectors, RV_PRE optional JS to eval before shots
import path from 'node:path';
export default async ({ page }) => {
  const out = process.env.RV_OUT;
  const tag = process.env.RV_TAG ?? 'sec';
  const only = (process.env.RV_ONLY ?? '#sheet').split(',');
  await page.addStyleTag({ content: '.bar { position: static !important; }' });
  if (process.env.RV_PRE) { await page.evaluate(process.env.RV_PRE); }
  await page.waitForTimeout(Number(process.env.RV_WAIT ?? 300));
  for (const sel of only) {
    const loc = page.locator(sel).first();
    await loc.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const name = sel.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
    await loc.screenshot({ path: path.join(out, `${tag}-${name}.png`) });
  }
};
