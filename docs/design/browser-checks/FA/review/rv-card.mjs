// Review of FA item 3 in the real page: double and triple taps on both buttons of the game-over card, at the three
// sizes, full and reduced motion. Nothing under the card may be pressed and exactly one action may happen.
// Usage: node rv-card.mjs [size|all] [full|reduced|all] [restored|live]
import { launch, open, sleep, waitReady, idle, waitPhase, centre, tapCell, facts, events, mark, savedGame, MATE_FOR_RED, SIZES } from './lib.mjs';

const [sizeArg = 'all', motionArg = 'all', how = 'restored'] = process.argv.slice(2);
const pick = (arg, all) => (arg === 'all' ? all : [arg]);
const PATTERNS = { double200: [200], double350: [350], double450: [450], triple150: [150, 150], triple300: [300, 300] };

async function scenario(browser, size, motion, button, pattern) {
  const finished = savedGame(MATE_FOR_RED, { result: { winner: 'black', reason: 'resign' }, counted: true, endedAt: 1790000060000 });
  const storage = { 'yijian.xiangqi.v2.game': how === 'live' ? savedGame(MATE_FOR_RED) : finished };
  const { context, page, errors } = await open(browser, { size, motion, storage });
  await page.goto('/?test=1', { waitUntil: 'load' });
  await waitReady(page);
  if (how === 'live') {
    await idle(page);
    await tapCell(page, 5, 1);
    await waitPhase(page, 'selected');
    await tapCell(page, 5, 4);
    await waitPhase(page, 'tentative');
    await sleep(500);
    await page.locator('#confirm-button').tap();
  }
  await page.waitForSelector(`dialog[data-dialog="over"] [data-choice="${button}"]`, { timeout: 20000 });
  await sleep(how === 'live' ? 5000 : 1500);                 // the card is in place, its buttons are live, the takeaway is written
  const before = await facts(page);
  const at = await centre(page, `dialog[data-dialog="over"] [data-choice="${button}"]`);
  const t0 = await mark(page, 'taps');
  await page.touchscreen.tap(at.x, at.y);
  for (const gap of PATTERNS[pattern]) {
    await sleep(gap);
    await page.touchscreen.tap(at.x, at.y);
  }
  await sleep(1800);
  const after = await facts(page);
  const extra = await page.evaluate(() => ({
    sheet: document.getElementById('app')?.dataset.sheet,
    hint: document.getElementById('hint-button')?.dataset.level,
    dialogs: [...document.querySelectorAll('#overlays .hud-layer:not(.is-closing) > dialog[open], #overlays .hud-menu')].map((el) => el.getAttribute('data-dialog') ?? el.className),
    arrows: document.querySelectorAll('#board .arrow').length,
    selected: document.querySelectorAll('.board-cell.is-selected').length,
  }));
  const log = (await events(page)).filter((e) => e.t >= t0);
  const clicks = log.filter((e) => e.kind === 'click').map((e) => `${e.t - t0}:${e.on.split(' < ').slice(0, 2).join('<')}`);
  const newGames = after.sessionGame - before.sessionGame;
  let ok;
  if (button === 'review') {
    ok = after.phase === 'over' && newGames === 0 && after.gameId === before.gameId && after.moves === before.moves && after.me.length === 0
      && !after.cardUp && extra.sheet === '0' && extra.dialogs.length === 0;
  } else {
    ok = after.phase === 'childTurn' && after.ply === '0' && newGames === 1 && after.me.length === 0 && !after.cardUp && extra.sheet === '0'
      && extra.hint === '0' && extra.dialogs.length === 0 && extra.selected === 0;
  }
  await context.close();
  return { ok, size, motion, button, pattern, how, phase: after.phase, ply: after.ply, newGames, me: after.me, extra, clicks, errors: errors.slice(0, 2) };
}

const browser = await launch();
let bad = 0, n = 0;
try {
  for (const size of pick(sizeArg, Object.keys(SIZES))) {
    for (const motion of pick(motionArg, ['full', 'reduced'])) {
      for (const button of ['review', 'again']) {
        for (const pattern of Object.keys(PATTERNS)) {
          n += 1;
          try {
            const v = await scenario(browser, size, motion, button, pattern);
            if (!v.ok) bad += 1;
            console.log(`${v.ok ? 'OK  ' : 'FAIL'} ${JSON.stringify(v)}`);
          } catch (error) {
            bad += 1;
            console.log(`ERR  ${size} ${motion} ${button} ${pattern}: ${error && error.message ? error.message.split('\n')[0] : error}`);
          }
        }
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`${n - bad}/${n} scenarios: nothing under the card pressed, exactly one action`);
