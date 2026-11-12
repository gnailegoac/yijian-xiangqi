// Real-time frames in dev/board.html (the real board-view + real fx)
export default async ({ page }) => {
  const dir = process.env.RT_OUT, prefix = process.env.RT_PREFIX, n = Number(process.env.RT_N ?? 10), gap = Number(process.env.RT_GAP ?? 0), skip = Number(process.env.RT_SKIP ?? 0);
  const m = 30;
  const clip = await page.evaluate(m => { const r = document.querySelector('.bv').getBoundingClientRect(); const x = Math.max(0, r.left - m), y = Math.max(0, r.top - m);
    return { x, y, width: Math.min(innerWidth, r.right + m) - x, height: Math.min(innerHeight, r.bottom + m) - y }; }, m);
  await page.addStyleTag({ url: '/styles/fx.css' }); await page.waitForTimeout(150);
  await page.evaluate(`void (window.__t0 = performance.now(), ${process.env.RT_JS})`);
  if (skip) await page.waitForTimeout(skip);
  for (let i = 0; i < n; i++) {
    const t = Math.round(await page.evaluate(() => performance.now() - window.__t0));
    await page.screenshot({ path: `${dir}/${prefix}-${String(i).padStart(2, '0')}-${String(t).padStart(4, '0')}.png`, clip, scale: 'css' });
    if (gap) await page.waitForTimeout(gap);
  }
  console.error('LOG live', await page.evaluate(() => window.lab.fx.live));
};
