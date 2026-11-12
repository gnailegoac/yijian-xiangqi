// Captures short frame sequences of the hud's animations (full motion). X7_SEQ picks the sequences.
const SEQ = {
  // [name, setup, trigger, clip selector or null, frames, gap ms]
  slot: [async (p) => p.evaluate(() => __dev.set('childTurn', { canUndo: true, hintLevel: 1 })), (p) => p.evaluate(() => __dev.set('tentative', { canUndo: true })), '#actions', 5, 40],
  pouch: [async (p) => p.evaluate(() => __dev.set('childTurn', { canUndo: true, hintLevel: 0 })), (p) => p.evaluate(() => __dev.set('childTurn', { canUndo: true, hintLevel: 1 })), '#actions', 5, 45],
  nudge: [async (p) => p.evaluate(() => __dev.set('childTurn', { canUndo: true, hintLevel: 0 })), (p) => p.evaluate(() => __dev.hud.nudgeHint()), '#actions', 7, 80],
  beacon: [async (p) => p.evaluate(() => __dev.set('tentative', { canUndo: true })), (p) => p.evaluate(() => __dev.hud.beaconConfirm()), '#actions', 5, 70],
  menu: [async (p) => p.evaluate(() => __dev.set('childTurn', { canUndo: true })), (p) => p.evaluate(() => document.querySelector('#menu-button').click()), null, 4, 50],
  sheet: [async (p) => p.evaluate(() => __dev.hud.closeAll()), (p) => p.evaluate(() => __dev.sheet('rules')), null, 5, 70],
  sheetOut: [async (p) => { await p.evaluate(() => __dev.sheet('rules')); await p.waitForTimeout(500); }, (p) => p.keyboard.press('Escape'), null, 5, 70],
  dialog: [async (p) => p.evaluate(() => __dev.hud.closeAll()), (p) => p.evaluate(() => { __dev.hud.confirm('resign'); }), null, 4, 60],
  over: [async (p) => p.evaluate(() => __dev.hud.closeAll()), (p) => p.evaluate(() => { __dev.over('win'); }), null, 6, 90],
  start: [async (p) => p.evaluate(() => __dev.hud.closeAll()), (p) => p.evaluate(() => { __dev.start('first'); }), null, 7, 110],
  startOut: [async (p) => { await p.evaluate(() => { __dev.start('first'); }); await p.waitForTimeout(900); }, (p) => p.evaluate(() => document.querySelector('[data-dialog="start"] [data-choice="new"]').click()), null, 4, 70],
  toast: [async (p) => p.evaluate(() => __dev.hud.closeAll()), (p) => p.evaluate(() => __dev.hud.toast('已经回到开局啦，没有可以悔的棋。', { ms: 600 })), null, 8, 120],
  trophy: [async (p) => p.evaluate(() => { __dev.state.mine = 2; __dev.trophies(); }), (p) => p.evaluate(() => { __dev.state.mine = 3; __dev.trophies(); }), '#topbar', 4, 70],
};
export default async ({ page }) => {
  const out = process.argv[process.argv.indexOf('--out') + 1].replace(/\.png$/i, '');
  for (const name of (process.env.X7_SEQ ?? Object.keys(SEQ).join(',')).split(',')) {
    const [setup, trigger, clip, n, gap] = SEQ[name];
    await setup(page);
    await page.waitForTimeout(500);
    await trigger(page);
    for (let i = 0; i < n; i++) {
      const path = `${out}-${name}-${i}.png`;
      if (clip) await page.locator(clip).first().screenshot({ path, animations: 'allow' });
      else await page.screenshot({ path, animations: 'allow' });
      await page.waitForTimeout(gap);
    }
    await page.waitForTimeout(700);
    await page.evaluate(() => { __dev.hud.closeAll(); document.querySelector('[data-dialog="start"] [data-choice="new"]')?.click(); });
    await page.waitForTimeout(400);
  }
};
