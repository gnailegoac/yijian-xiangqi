export default async ({ page }) => {
  const out = process.argv[process.argv.indexOf('--out') + 1].replace(/\.png$/i, '');
  const top = await page.evaluate(() => { const b = document.querySelector('#topbar').getBoundingClientRect(); return { x: 0, y: 0, width: innerWidth, height: Math.round(b.bottom + 14) }; });
  await page.evaluate(() => { __dev.state.mine = 9; __dev.state.lost = 7; __dev.trophies(); __dev.hud.setRound(128); });
  for (const [name, r] of [['say', { mood: 'smug', line: '这一步，你可看懂了？' }], ['think', { mood: 'thinking' }], ['calm', { mood: 'calm' }]]) {
    await page.evaluate((x) => __dev.rival.set(x), r); await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}-${name}.png`, clip: top });
    const m = await page.evaluate(() => { const q = (s) => document.querySelector(s)?.getBoundingClientRect(); const say = q('.rival__say'), info = q('.hud-top__info'), mute = q('#mute-button'), plate = q('.rival__plate'), slot = q('.hud-top__rival');
      return { sayRight: say && Math.round(say.right), sayW: say && Math.round(say.width), infoLeft: Math.round(info.left), plateRight: Math.round(plate.right), slotRight: Math.round(slot.right), muteLeft: Math.round(mute.left), over: document.documentElement.scrollWidth - innerWidth }; });
    console.log(`RIVAL ${name} ` + JSON.stringify(m));
  }
};
