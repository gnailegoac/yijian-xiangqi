export default async ({ page, shot }) => {
  const run = async (name, wait = 2500) => { await page.evaluate((n) => document.querySelector(`[data-run="${n}"]`).click(), name); await page.waitForTimeout(wait); };
  const snap = async (name) => { await page.screenshot({ path: process.env.RV_OUT + `/c640c-${name}.png`, clip: { x: 0, y: 500, width: 360, height: 140 } }); };
  await page.waitForTimeout(600);
  await run('planLine', 5000); await snap('plan');
  await run('askLine', 5000); await snap('ask');
  await run('captionLine', 600); await snap('caption');
  await run('heldLine', 1500); await snap('held');
  await run('localLine', 2500); await snap('local');
};
