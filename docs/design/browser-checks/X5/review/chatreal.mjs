export default async ({ page, shot }) => {
  const run = async (name, wait = 2500) => { await page.evaluate((n) => document.querySelector(`[data-run="${n}"]`).click(), name); await page.waitForTimeout(wait); };
  await page.waitForTimeout(600);
  await run('planLine', 4500); await shot('plan');
  await run('askLine', 4500); await shot('ask');
  await run('oppLine', 3500); await shot('opp');
  await run('tryLine', 800); await run('abortRetract', 500); await shot('stale');
  await run('heldLine', 1500); await shot('held');
  const info = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    return { buddy: r('#buddy'), fig: r('.buddy-fig'), svg: r('svg.buddy'), bubble: r('.bubble'), chat: r('#chat'), coach: r('#coach'), state: document.querySelector('.bubble').dataset.state };
  });
  console.log(JSON.stringify(info));
};
