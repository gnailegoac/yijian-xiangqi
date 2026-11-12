// Review of FA items 1 and 2 in the real page: a game ends (the child mates / 司马懿 mates) and a finger keeps tapping on
// every place where a new game can be started, every 120 to 400 ms, for six seconds from the last move on.
// Usage: node rv-over.mjs [child|rival|all] [bar|menu|cardspot|all] [size|all] [full|reduced|all]
import { launch, open, sleep, waitReady, idle, waitPhase, centre, tapCell, facts, events, mark, savedGame, forceRivalMove,
         MATE_FOR_RED, MATE_FOR_BLACK, SIZES, SHOTS } from './lib.mjs';

const [whoArg = 'all', placeArg = 'all', sizeArg = 'all', motionArg = 'all'] = process.argv.slice(2);
const pick = (arg, all) => (arg === 'all' ? all : [arg]);
const GAPS = [120, 400, 250, 150, 330, 200, 280, 130];
const TAP_MS = 6000;

/** Where the card's 再来一局 lies in each layout: measured once on a finished game. */
async function cardSpot(browser, size, motion) {
  const finished = savedGame(MATE_FOR_RED, { result: { winner: 'black', reason: 'resign' }, counted: true, endedAt: 1790000060000 });
  const { context, page } = await open(browser, { size, motion, storage: { 'yijian.xiangqi.v2.game': finished } });
  await page.goto('/?test=1', { waitUntil: 'load' });
  await waitReady(page);
  await page.waitForSelector('dialog[data-dialog="over"] [data-choice="again"]', { timeout: 10000 });
  await sleep(800);
  const at = await centre(page, 'dialog[data-dialog="over"] [data-choice="again"]');
  await context.close();
  return at;
}

async function scenario(browser, who, place, size, motion, spotOfCard) {
  const storage = { 'yijian.xiangqi.v2.game': savedGame(who === 'child' ? MATE_FOR_RED : MATE_FOR_BLACK) };
  const { context, page, errors } = await open(browser, {
    size, motion, storage,
    init: who === 'rival' ? forceRivalMove : undefined, initArg: { from: { row: 4, col: 7 }, to: { row: 4, col: 4 } },
  });
  if (process.env.RV_UNFIX === '1') {
    await page.route('**/src/ui/hud.js', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (!body.includes('    cardGuard = held;')) throw new Error('unfix: text not found');
      await route.fulfill({ response, body: body.replace('    cardGuard = held;', '    cardGuard = null;') });
    });
  }
  await page.goto('/?test=1', { waitUntil: 'load' });
  await waitReady(page);
  let spot;
  if (who === 'child') {
    await idle(page);
    await tapCell(page, 5, 1);
    await waitPhase(page, 'selected');
    await tapCell(page, 5, 4);
    await waitPhase(page, 'tentative');
    await sleep(500);
    spot = await centre(page, '#confirm-button');
    await page.touchscreen.tap(spot.x, spot.y);              // the mating move
    await waitPhase(page, 'over', 5000);
  } else {
    spot = await centre(page, '#actions');
    await waitPhase(page, 'over', 15000);                    // his mating move has been committed
  }
  const t0 = await mark(page, 'last-move');
  const started = Date.now();
  let n = 0;
  let taps = 0;
  let extra = 5;
  const untilCard = process.env.RV_UNTIL_CARD === '1';
  const cardIsUp = () => page.evaluate(() => document.querySelector('#overlays .hud-layer:not(.is-closing) > dialog[data-dialog="over"]') !== null);
  while (untilCard ? (Date.now() - started < 20000 && (!(await cardIsUp()) || extra-- > 0)) : Date.now() - started < TAP_MS) {
    if (place === 'bar') {
      const button = await centre(page, '#newgame-button');  // where 再来一局 of the action bar is (or where 确定落子 was)
      const at = n % 2 === 0 || !button ? spot : button;
      await page.touchscreen.tap(at.x, at.y);
    } else if (place === 'menu') {
      const item = await centre(page, '.hud-menu__item[data-menu="new-game"]');
      const at = item ?? await centre(page, '#menu-button');
      if (at) await page.touchscreen.tap(at.x, at.y);
    } else {
      await page.touchscreen.tap(spotOfCard.x, spotOfCard.y);
    }
    taps += 1;
    await sleep(untilCard ? 150 : GAPS[n % GAPS.length]);
    n += 1;
  }
  await mark(page, 'taps-end');
  await page.screenshot({ path: `${SHOTS}/over-${who}-${place}-${size}-${motion}-after-taps.png` }).catch(() => {});
  // the card: wait for it (it may be up already), at most 16 s more
  let cardSeen = true;
  try {
    await page.waitForFunction(() => /** @type {any} */ (window).__rv.events.some((e) => e.kind === 'card-up'), null, { timeout: 16000, polling: 50 });
  } catch { cardSeen = false; }
  const log = await events(page);
  const cardAt = log.find((e) => e.kind === 'card-up');
  const newGames = log.filter((e) => e.t >= t0 && e.kind === 'phase' && e.phase !== 'over');
  const firstNew = newGames[0];
  const afterTaps = await facts(page);
  // a menu that the taps left open is closed by a tap beside it, as a child would
  if (await page.locator('.hud-menu__item').count() > 0) { await page.keyboard.press('Escape'); await sleep(300); }
  // one meant tap on the card's 再来一局 starts exactly one new game
  let oneTap = 'card not up';
  if (afterTaps.cardUp && afterTaps.phase === 'over') {
    await sleep(4300);                                       // past any burst hold
    const again = await centre(page, 'dialog[data-dialog="over"] [data-choice="again"]');
    const before = await facts(page);
    if (again) await page.touchscreen.tap(again.x, again.y);
    await sleep(1500);
    const after = await facts(page);
    oneTap = `phase ${after.phase} ply ${after.ply} session game ${before.sessionGame}->${after.sessionGame} games ${JSON.stringify(after.games)}`;
  }
  const clicks = log.filter((e) => e.t >= t0 && e.kind === 'click').map((e) => e.on);
  const clickKinds = [...new Set(clicks.map((c) => c.split(' < ')[0]))].slice(0, 6);
  const verdict = {
    who, place, size, motion, taps,
    countedOnce: JSON.stringify(afterTaps.games),
    cardAt: cardAt ? cardAt.t - t0 : null, cardSeen,
    newGameBeforeCard: firstNew ? (cardAt ? firstNew.t < cardAt.t : true) : false,
    newGameAt: firstNew ? firstNew.t - t0 : null,
    newGameAfterCardBy: firstNew && cardAt && firstNew.t >= cardAt.t ? firstNew.t - cardAt.t : null,
    phaseAfterTaps: afterTaps.phase, savedGame: `${afterTaps.gameId} moves ${afterTaps.moves} counted ${afterTaps.counted}`,
    oneTap, clickKinds, errors: errors.slice(0, 3),
  };
  await context.close();
  return verdict;
}

const browser = await launch();
try {
  for (const size of pick(sizeArg, Object.keys(SIZES))) {
    for (const motion of pick(motionArg, ['full', 'reduced'])) {
      const spotOfCard = await cardSpot(browser, size, motion);
      for (const who of pick(whoArg, ['child', 'rival'])) {
        for (const place of pick(placeArg, ['bar', 'menu', 'cardspot'])) {
          try {
            const v = await scenario(browser, who, place, size, motion, spotOfCard);
            const expected = who === 'child' ? '{"played":1,"won":1,"lost":0,"drawn":0}' : '{"played":1,"won":0,"lost":1,"drawn":0}';
            const ok = v.countedOnce === expected && v.cardSeen && !v.newGameBeforeCard;
            console.log(`${ok ? 'OK  ' : 'FAIL'} ${JSON.stringify(v)}`);
          } catch (error) {
            console.log(`ERR  ${who} ${place} ${size} ${motion}: ${error && error.message ? error.message.split('\n')[0] : error}`);
          }
        }
      }
    }
  }
} finally {
  await browser.close();
}
