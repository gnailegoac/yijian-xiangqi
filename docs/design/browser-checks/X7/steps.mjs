// Captures named states of dev/hud.html. X7_SET = comma-separated state names (default: all phases).
const ALL = {
  child0: async (p) => { await p.evaluate(() => { __dev.state.mine = 3; __dev.state.lost = 1; __dev.trophies(); __dev.hud.setRound(7); __dev.notate(12); __dev.set('childTurn', { hintLevel: 0, canUndo: true }); }); },
  child2: async (p) => { await p.evaluate(() => { __dev.state.mine = 9; __dev.state.lost = 7; __dev.trophies(); __dev.hud.setRound(23); __dev.notate(44); __dev.set('selected', { hintLevel: 2, canUndo: true }); }); },
  child3: async (p) => { await p.evaluate(() => { __dev.set('childTurn', { hintLevel: 3, canUndo: true }); }); },
  tentative: async (p) => { await p.evaluate(() => { __dev.set('tentative', { hintLevel: 1, canUndo: true }); }); },
  opponent: async (p) => { await p.evaluate(() => { __dev.set('opponentTurn', { hintLevel: 0, canUndo: true }); }); },
  failed: async (p) => { await p.evaluate(() => { __dev.set('failed', { hintLevel: 0, canUndo: true }); }); },
  over: async (p) => { await p.evaluate(() => { __dev.hud.setMuted(true); __dev.set('over', { canUndo: true }); }); },
  boot: async (p) => { await p.evaluate(() => { __dev.hud.setMuted(false); __dev.state.mine = 0; __dev.state.lost = 0; __dev.trophies(); __dev.hud.setRound(0); __dev.notate(0); __dev.set('boot', { canUndo: false }); }); },
  menu: async (p) => { await p.evaluate(() => { __dev.set('childTurn', { canUndo: true }); document.querySelector('#menu-button').click(); }); },
  settings: async (p) => { await p.evaluate(() => { document.querySelector('#dev-rank').value = '初露锋芒'; __dev.syncStatus(); __dev.sheet('settings'); }); },
  settings2: async (p) => { await p.evaluate(() => { document.querySelector('#dev-coach').value = 'local:unreachable'; __dev.syncStatus(); const b = document.querySelector('.hud-sheet__body'); b.scrollTop = b.scrollHeight; }); },
  notation: async (p) => { await p.evaluate(() => { __dev.notate(41); __dev.sheet('notation'); }); },
  notation0: async (p) => { await p.evaluate(() => { __dev.notate(0); __dev.sheet('notation'); }); },
  rules: async (p) => { await p.evaluate(() => { __dev.sheet('rules'); }); },
  about: async (p) => { await p.evaluate(() => { __dev.sheet('about'); }); },
  resign: async (p) => { await p.evaluate(() => { __dev.hud.closeAll(); __dev.hud.confirm('resign'); }); },
  newgame: async (p) => { await p.evaluate(() => { __dev.hud.closeAll(); __dev.hud.newGameDialog(); }); },
  toast: async (p) => { await p.evaluate(() => { __dev.hud.closeAll(); __dev.hud.toast('已经回到开局啦，没有可以悔的棋。', { ms: 5000 }); }); },
  blocking: async (p) => { await p.evaluate(() => { __dev.hud.closeAll(); __dev.hud.blocking({ kind: 'engine-dead' }); }); },
  unblock: async (p) => { await p.evaluate(() => { __dev.hud.blocking(null); }); },
  startFirst: async (p) => { await p.evaluate(() => { __dev.hud.closeAll(); __dev.start('first-import'); }); },
  startResume: async (p) => { await p.evaluate(() => { __dev.start('resume'); }); },
  startAgain: async (p) => { await p.evaluate(() => { __dev.start('again'); }); },
  startGo: async (p) => { await p.click('[data-dialog="start"] [data-choice="new"]'); },
  overWin: async (p) => { await p.evaluate(() => { __dev.hud.closeAll(); __dev.over('win'); }); await p.waitForTimeout(3600); },
  overWinEarly: async (p) => { await p.evaluate(() => { __dev.hud.closeAll(); __dev.over('win', { type: false }); }); },
  overLoss: async (p) => { await p.evaluate(() => { __dev.over('loss'); }); await p.waitForTimeout(3600); },
  overDraw: async (p) => { await p.evaluate(() => { __dev.over('draw'); }); await p.waitForTimeout(3600); },
  overPlain: async (p) => { await p.evaluate(() => { __dev.over('plain'); }); await p.waitForTimeout(3600); },
  overStale: async (p) => { await p.evaluate(() => { __dev.over('stalemate'); }); await p.waitForTimeout(3600); },
  overClose: async (p) => { await p.evaluate(() => { __dev.hud.closeAll(); }); },
};
export default async ({ page, shot }) => {
  const out = process.argv[process.argv.indexOf('--out') + 1].replace(/\.png$/i, '');
  const clip = process.env.X7_CLIP;
  const names = (process.env.X7_SET ?? 'child0,child2,child3,tentative,opponent,failed,over,boot').split(',');
  const wait = Number(process.env.X7_WAIT ?? 450);
  for (const name of names) {
    if (!ALL[name]) throw new Error(`unknown state ${name}`);
    await ALL[name](page);
    await page.waitForTimeout(wait);
    if (name.startsWith('un') || name === 'overClose') continue;
    if (clip) await page.locator(clip).first().screenshot({ path: `${out}-${name}-clip.png` });
    else await shot(name);
  }
};
