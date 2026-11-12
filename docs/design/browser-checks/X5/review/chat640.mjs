export default async ({ page, shot }) => {
  const run = async (name, wait = 2500) => { await page.evaluate((n) => document.querySelector(`[data-run="${n}"]`).click(), name); await page.waitForTimeout(wait); };
  await page.waitForTimeout(600);
  await run('planLine', 5000); await shot('plan');
  await run('tryLine', 5000); await run('staleLast', 400); await shot('stale');
  await run('toolLine', 1500); await shot('tool');
  await page.waitForTimeout(1300); await shot('tool2');
  await page.waitForTimeout(4000); await shot('tool3');
  const info = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    return { buddy: r('#buddy'), fig: r('.buddy-fig'), bubble: r('.bubble'), chat: r('#chat'), coach: r('#coach') };
  });
  console.log(JSON.stringify(info));
};
