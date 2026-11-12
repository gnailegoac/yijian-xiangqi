// Review of FA item 2, the way out: the game is over and its card never comes (stage.over fails, hangs, or the hud
// cannot build the card). Can the child still start a new game, and when? The page's own files are patched on the way
// to the browser (a private rig: nothing in the repository changes).
// Usage: node rv-wayout.mjs [size] [motion]
import { launch, open, sleep, waitReady, idle, waitPhase, centre, tapCell, facts, mark, savedGame, MATE_FOR_RED } from './lib.mjs';

const [sizeArg = 'landscape', motionArg = 'reduced'] = process.argv.slice(2);

const PATCHES = {
  'stage.over throws': { file: '**/src/ui/stage.js', from: '    over(info) {\n      return cue(async (running) => {',
                         to: '    over(info) {\n      throw new Error("rv: stage.over fails");\n      return cue(async (running) => {' },
  'stage.over never ends and shows nothing': { file: '**/src/ui/stage.js', from: '    over(info) {\n      return cue(async (running) => {',
                         to: '    over(info) {\n      return new Promise(() => {});\n      return cue(async (running) => {' },
  'hud.showOver throws': { file: '**/src/ui/hud.js', from: '  function showOver(view) {\n    over?.close();',
                         to: '  function showOver(view) {\n    throw new Error("rv: the card cannot be built");\n    over?.close();' },
};

async function scenario(browser, name, way) {
  const patch = PATCHES[name];
  const { context, page, errors } = await open(browser, { size: sizeArg, motion: motionArg, storage: { 'yijian.xiangqi.v2.game': savedGame(MATE_FOR_RED) } });
  let patched = false;
  await page.route(patch.file, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/\r\n/g, '\n');
    if (!body.includes(patch.from)) throw new Error(`patch text not found in ${patch.file}`);
    patched = true;
    await route.fulfill({ response, body: body.replace(patch.from, patch.to) });
  });
  await page.goto('/?test=1', { waitUntil: 'load' });
  await waitReady(page);
  await idle(page);
  await tapCell(page, 5, 1);
  await waitPhase(page, 'selected');
  await tapCell(page, 5, 4);
  await waitPhase(page, 'tentative');
  await sleep(500);
  await page.locator('#confirm-button').tap();
  await waitPhase(page, 'over', 5000);
  const t0 = await mark(page, 'mate');
  // when can a new game be started? the button of the action bar is looked at every 100 ms, for at most 20 s
  let freeAt = -1;
  const started = Date.now();
  while (Date.now() - started < 20000) {
    const state = await page.evaluate(() => {
      const b = /** @type {HTMLButtonElement|null} */ (document.getElementById('newgame-button'));
      return b ? { disabled: b.disabled, inert: !!b.closest('[inert]'), now: Math.round(performance.now()) } : null;
    });
    if (state && !state.disabled && !state.inert) { freeAt = state.now - t0; break; }
    await sleep(100);
  }
  const before = await facts(page);
  let outcome = 'never free';
  if (freeAt >= 0) {
    if (way === 'menu') {
      const m = await centre(page, '#menu-button');
      await page.touchscreen.tap(m.x, m.y);
      await sleep(500);
      const item = await centre(page, '.hud-menu__item[data-menu="new-game"]');
      const disabled = await page.evaluate(() => /** @type {HTMLButtonElement|null} */ (document.querySelector('.hud-menu__item[data-menu="new-game"]'))?.disabled);
      if (item) await page.touchscreen.tap(item.x, item.y);
      outcome = `menu item disabled=${disabled}`;
    } else {
      const b = await centre(page, '#newgame-button');
      await page.touchscreen.tap(b.x, b.y);
      outcome = 'action bar tapped';
    }
    await sleep(1500);
  }
  const after = await facts(page);
  await context.close();
  const ok = patched && freeAt >= 0 && after.phase === 'childTurn' && after.ply === '0' && after.sessionGame === before.sessionGame + 1
    && JSON.stringify(after.games) === '{"played":1,"won":1,"lost":0,"drawn":0}';
  return { ok, name, way, size: sizeArg, motion: motionArg, patched, newGameFreeAfterMs: freeAt, cardEverUp: before.cardUp, outcome,
           after: `phase ${after.phase} ply ${after.ply} session game ${before.sessionGame}->${after.sessionGame} games ${JSON.stringify(after.games)}`,
           errors: errors.slice(0, 2).map((e) => e.slice(0, 90)) };
}

const browser = await launch();
try {
  for (const name of Object.keys(PATCHES)) {
    for (const way of ['bar', 'menu']) {
      try {
        const v = await scenario(browser, name, way);
        console.log(`${v.ok ? 'OK  ' : 'FAIL'} ${JSON.stringify(v)}`);
      } catch (error) {
        console.log(`ERR  ${name} ${way}: ${error && error.message ? error.message.split('\n')[0] : error}`);
      }
    }
  }
} finally {
  await browser.close();
}
