// Frame sequences of the hud's animations (clipped regions), for the reviewer's eyes.
export default async ({ page }) => {
  const out = process.argv[process.argv.indexOf('--out') + 1].replace(/\.png$/i, '');
  const vp = page.viewportSize();
  const clipOf = async (sel, pad = 12) => page.evaluate(([s, p]) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: Math.max(0, b.x - p), y: Math.max(0, b.y - p), width: Math.min(innerWidth, b.width + 2 * p), height: Math.min(innerHeight - Math.max(0, b.y - p), b.height + 2 * p) }; }, [sel, pad]);
  const seq = async (name, trigger, clip, n = 5, gap = 70) => {
    await trigger();
    for (let i = 0; i < n; i++) { await page.screenshot({ path: `${out}-${name}-${i}.png`, clip }); await page.waitForTimeout(gap); }
  };
  await page.evaluate(() => { __dev.notate(12); __dev.set('childTurn', { canUndo: true, hintLevel: 0 }); }); await page.waitForTimeout(300);
  const actions = await clipOf('#actions');
  await seq('d7', () => page.evaluate(() => __dev.set('tentative', { canUndo: true })), actions, 4, 30);
  await page.waitForTimeout(300);
  await seq('beacon', () => page.evaluate(() => __dev.hud.beaconConfirm()), actions, 5, 60);
  await page.evaluate(() => __dev.set('childTurn', { canUndo: true, hintLevel: 0 })); await page.waitForTimeout(300);
  await seq('pop', () => page.evaluate(() => __dev.set('childTurn', { canUndo: true, hintLevel: 1 })), actions, 4, 40);
  await page.waitForTimeout(300);
  await seq('nudge', () => page.evaluate(() => __dev.hud.nudgeHint()), actions, 7, 80);
  const full = { x: 0, y: 0, width: vp.width, height: vp.height };
  await seq('sheet', () => page.evaluate(() => __dev.sheet('rules')), full, 4, 60);
  await page.evaluate(() => __dev.hud.closeAll()); await page.waitForTimeout(400);
  await seq('over', () => page.evaluate(() => { __dev.over('win', { type: false }); }), full, 5, 80);
  await page.evaluate(() => { __dev.hud.closeAll(); __dev.set('boot', {}); }); await page.waitForTimeout(400);
  await seq('start', () => page.evaluate(() => { __dev.start('first'); }), full, 6, 110);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${out}-start-idle.png`, clip: full });
  await seq('startout', () => page.click('dialog[data-dialog="start"] [data-choice="new"]'), full, 3, 80);
};
