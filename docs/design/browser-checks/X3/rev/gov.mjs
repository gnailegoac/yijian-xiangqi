// The forced slow-frame switch as a child of the harness would use it: click 慢帧, fire scenes, watch q step down.
export default async ({ page, shot }) => {
  await page.click('#slow');
  const steps = [];
  const t0 = Date.now();
  let q = 1;
  while (Date.now() - t0 < 14000 && q > 0.35) {
    await page.evaluate(() => { if (__lab.fx.live < 30) __lab.run['more:彩带'](); });
    await page.waitForTimeout(120);
    const now = await page.evaluate(() => __lab.q());
    if (now !== q) { q = now; steps.push([q, Date.now() - t0]); if (q === 0.6) await shot('q06'); }
  }
  await shot('q035');
  console.error('LOG steps', JSON.stringify(steps), 'meter', await page.evaluate(() => document.getElementById('m-q').textContent), 'gap', await page.evaluate(() => document.getElementById('m-gap').textContent));
  await page.click('#slow');
  await page.evaluate(() => __lab.fx.clear());
  await page.waitForTimeout(600);
  // counts at q = .35, and it never recovers
  const out = await page.evaluate(async () => {
    const fx = __lab.fx, T = __lab.pt(3, 4), r = {};
    fx.confetti(); r.confetti = fx.live; fx.clear();
    fx.burst('explosion', T); r.explosion = fx.live; fx.clear();
    fx.burst('capture', T, { n: 24 }); r.capture = fx.live; fx.clear();
    fx.burst('dust', T, { n: 4 }); r.dust4 = fx.live; fx.clear();
    fx.burst('ring', T); r.ring = fx.live; fx.clear();
    fx.wind(); r.wind = fx.live; fx.clear();
    fx.trail(__lab.pt(7, 4), T); r.trail = fx.live; fx.clear();
    fx.slash(T); r.slash = fx.live; fx.clear();
    fx.confetti(); await new Promise(res => setTimeout(res, 1200)); r.qAfter = __lab.q(); fx.clear();
    return r;
  });
  console.error('LOG counts', JSON.stringify(out));
};
