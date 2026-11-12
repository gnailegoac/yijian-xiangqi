// opening: start overlay -> deal -> trial + comment -> retract -> commit (stamp) -> rival move
export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  await page.click('[data-choice="new"]');
  await w(500); await shot('01-deal');
  await w(1400); await shot('02-dealt-banner');
  await w(2600); await shot('03-greeting');
  await w(3500); await shot('04-goal-line');
  await page.evaluate(() => window.__dev.act.tap(7, 7));
  await w(350); await shot('05-selected');
  await page.evaluate(() => window.__dev.act.tap(7, 4));
  await w(140); await shot('06-trial-140ms');
  await w(700); await shot('07-trial-landed');
  await w(1800); await shot('08-trial-comment');
  await page.evaluate(() => window.__dev.act.retract());
  await w(600); await shot('09-retracted');
  await page.evaluate(() => window.__dev.act.tap(7, 4));
  await w(900);
  await page.evaluate(() => window.__dev.act.confirm());
  await w(350); await shot('10-commit-stamp');
  await w(900); await shot('11-stamp-hold');
  await w(1200); await shot('12-rival-moving');
  await w(1500); await shot('13-rival-caption-line');
  await w(2500); await shot('14-rival-line-done');
};
