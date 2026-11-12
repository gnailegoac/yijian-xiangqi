// Does an absurd particle count block the main thread?
export default async ({ page }) => {
  const out = await page.evaluate(() => {
    const fx = __lab.fx, T = __lab.pt(3, 4), r = {};
    for (const n of [1e6, 1e8]) { fx.clear(); const t0 = performance.now(); fx.burst('capture', T, { n }); r[n] = [Math.round(performance.now() - t0), fx.live]; }
    fx.clear(); const t0 = performance.now(); fx.burst('stars', T, { n: 1e8 }); r.stars = [Math.round(performance.now() - t0), fx.live];
    fx.clear(); return r;
  });
  console.error('LOG', JSON.stringify(out));
};
