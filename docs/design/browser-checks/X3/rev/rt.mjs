// Real-time frame capture of a scene: RT_JS (page expression), RT_PREFIX, RT_N frames, RT_GAP ms between, RT_PRE (page expression before)
export default async ({ page }) => {
  const dir = process.env.RT_OUT, prefix = process.env.RT_PREFIX, n = Number(process.env.RT_N ?? 10), gap = Number(process.env.RT_GAP ?? 0);
  const m = 30;
  const clip = await page.evaluate(m => { const r = document.getElementById('board').getBoundingClientRect(); const x = Math.max(0, r.left - m), y = Math.max(0, r.top - m);
    return { x, y, width: Math.min(innerWidth, r.right + m) - x, height: Math.min(innerHeight, r.bottom + m) - y }; }, m);
  if (process.env.RT_PRE) await page.evaluate(`void (${process.env.RT_PRE})`);
  await page.waitForTimeout(200);
  await page.evaluate(`void (window.__t0 = performance.now(), ${process.env.RT_JS})`);
  for (let i = 0; i < n; i++) {
    const t = Math.round(await page.evaluate(() => performance.now() - window.__t0));
    await page.screenshot({ path: `${dir}/${prefix}-${String(i).padStart(2, '0')}-${String(t).padStart(4, '0')}.png`, clip, scale: 'css' });
    if (gap) await page.waitForTimeout(gap);
  }
  console.error('LOG peak', await page.evaluate(() => __lab.peak()), 'q', await page.evaluate(() => __lab.q()));
};
