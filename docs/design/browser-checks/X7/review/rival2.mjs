export default async ({ page }) => {
  const out = process.argv[process.argv.indexOf('--out') + 1].replace(/\.png$/i, '');
  const top = await page.evaluate(() => { const b = document.querySelector('#topbar').getBoundingClientRect(); return { x: 0, y: 0, width: innerWidth, height: Math.round(b.bottom + 14) }; });
  await page.evaluate(() => { __dev.state.mine = 9; __dev.state.lost = 7; __dev.trophies(); __dev.hud.setRound(128); __dev.rival.set({ mood: 'thinking' }); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}-think.png`, clip: top });
  console.log('THINK ' + JSON.stringify(await page.evaluate(() => { const q = (s) => document.querySelector(s)?.getBoundingClientRect(); const say = q('.rival__say'), info = q('.hud-top__info'), plate = q('.rival__plate'); return { say: [Math.round(say.left), Math.round(say.right)], plate: [Math.round(plate.left), Math.round(plate.right)], infoLeft: Math.round(info.left) }; })));
  await page.evaluate(() => { __dev.state.mine = 2; __dev.trophies(); __dev.hud.setRound(7); __dev.rival.set({ mood: 'smug', line: '这一步，你可看懂了？' }); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}-say2.png`, clip: top });
};
