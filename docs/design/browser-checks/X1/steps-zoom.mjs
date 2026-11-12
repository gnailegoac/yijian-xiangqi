export default async ({ page }) => {
  const out = process.argv[process.argv.indexOf('--out') + 1].replace(/\.png$/i, '');
  const r = await page.evaluate(() => { const b = document.getElementById('board').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const k = r.w / 9.2;
  await page.screenshot({ path: `${out}-bl.png`, clip: { x: r.x, y: r.y + r.h - 2.2 * k, width: 2.6 * k, height: 2.2 * k }, scale: 'device' });
  await page.screenshot({ path: `${out}-tr.png`, clip: { x: r.x + r.w - 2.6 * k, y: r.y, width: 2.6 * k, height: 2.2 * k } });
  await page.screenshot({ path: `${out}-river.png`, clip: { x: r.x, y: r.y + 4.2 * k, width: 4.6 * k, height: 2.2 * k } });
  console.log(JSON.stringify(await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('board'), '::after');
    return { w: cs.width, h: cs.height, pad: cs.paddingTop, bw: cs.borderTopWidth, k: cs.getPropertyValue('--k'), size: cs.backgroundSize, pos: cs.backgroundPosition };
  })));
};
