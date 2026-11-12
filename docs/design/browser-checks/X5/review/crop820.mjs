export default async ({ page }) => {
  const run = async (name, wait = 2500) => { await page.evaluate((n) => document.querySelector(`[data-run="${n}"]`).click(), name); await page.waitForTimeout(wait); };
  const snap = async (name) => { await page.screenshot({ path: process.env.RV_OUT + `/c820-${name}.png`, clip: { x: 0, y: 925, width: 820, height: 195 } }); };
  await page.waitForTimeout(600);
  await run('planLine', 5000); await snap('plan');
  await run('askLine', 5000); await snap('ask');
  await run('oppLine', 4000); await snap('opp');
  await run('heldLine', 1500); await snap('held');
  await run('tryLine', 5000); await run('staleLast', 400); await snap('stale');
};
