export default async ({ page }) => {
  const out = process.argv[process.argv.indexOf('--out') + 1].replace(/\.png$/i, '');
  const top = await page.evaluate(() => { const b = document.querySelector('#topbar').getBoundingClientRect(); return { x: 0, y: 0, width: innerWidth, height: Math.round(b.bottom + 14) }; });
  const geo = () => page.evaluate(() => { const q = (s) => document.querySelector(s)?.getBoundingClientRect(); const say = q('.rival__say'), info = q('.hud-top__info');
    const vis = [...document.querySelectorAll('.hud-tray--mine > *')].filter((e) => e.getClientRects().length).map((e) => e.textContent).join('');
    return { say: say && say.width ? [Math.round(say.left), Math.round(say.right)] : null, infoLeft: Math.round(info.left), infoVis: getComputedStyle(document.querySelector('.hud-top__info')).visibility, tray: vis }; });
  for (const n of [0, 3, 4, 5, 6, 9]) {
    await page.evaluate((k) => { __dev.state.mine = k; __dev.state.lost = 7; __dev.trophies(); __dev.hud.setRound(128); __dev.rival.set({ mood: 'thinking' }); }, n);
    await page.waitForTimeout(150);
    console.log(`N=${n} ` + JSON.stringify(await geo()));
    if (n === 9 || n === 5) await page.screenshot({ path: `${out}-think${n}.png`, clip: top });
  }
  await page.evaluate(() => { __dev.rival.set({ mood: 'smug', line: '这一步，你可看懂了？' }); }); await page.waitForTimeout(250);
  console.log('LINE ' + JSON.stringify(await geo()));
  await page.screenshot({ path: `${out}-say.png`, clip: top });
  await page.waitForTimeout(2600);
  console.log('AFTER ' + JSON.stringify(await geo()));
  await page.screenshot({ path: `${out}-after.png`, clip: top });
};
