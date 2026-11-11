// tests/e2e/gameover.spec.js (E1): SPEC 14.7 flows 15 and 16: delivering mate, the card, resigning and taking it back,
// a new game as black.
import { expect, test } from '@playwright/test';
import { centreOf, doubleTap, explainProxyLimit, KEYS, laps, playMove, ready, savedMoves, saveFixture, seedStorage, settled, stopwatch, stored, tap } from './helpers.js';

test.describe.configure({ timeout: 120000 });
explainProxyLimit(test);

/**
 * The file labels of the board's top and bottom edge as the child sees them (the two text rows of the board art).
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{top:string, bottom:string}>}
 */
async function fileLabels(page) {
  const rows = await page.evaluate(() => [...document.querySelectorAll('#board .bv-label')]
    .map((el) => ({ text: el.textContent ?? '', y: el.getBoundingClientRect().top }))
    .sort((a, b) => a.y - b.y));
  expect(rows).toHaveLength(2);
  return { top: rows[0].text, bottom: rows[1].text };
}

/**
 * The games record of the stored profile (a profile that was never written has no game).
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{played:number, won:number, lost:number, drawn:number}>}
 */
async function gamesOf(page) {
  const text = await stored(page, KEYS.profile);
  return text === null ? { played: 0, won: 0, lost: 0, drawn: 0 } : JSON.parse(text).games;
}

test.describe('flow 15', () => {
  test('game over', async ({ page }) => {
    const app = page.locator('#app');
    const card = page.locator('dialog[data-dialog="over"]');
    // red (the child) to move after six plies; the only mating move is 炮八平五, (5,1) -> (5,4)
    await seedStorage(page, { [KEYS.game]: saveFixture('v2-one-before-mate.json') });
    await ready(page);
    await expect(app).toHaveAttribute('data-ply', '6');
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
    expect((await gamesOf(page)).won).toBe(0);

    /** Where the finger is when it confirms: 再来一局 of the action bar comes up on the same spot. @type {{x:number, y:number}} */
    let spot = { x: 0, y: 0 };
    /** Tries the mating move and confirms it; the stopwatch records what the stage shows from then on. */
    const mate = async () => {
      await tap(page, 5, 1);
      await expect(app).toHaveAttribute('data-phase', 'selected');
      await tap(page, 5, 4);
      await expect(app).toHaveAttribute('data-phase', 'tentative');
      await stopwatch(page, { banner: '.fx-banner[data-kind="mate"]', ribbon: '.stage-ribbon', card: 'dialog[data-dialog="over"]' });
      spot = await centreOf(page.locator('#confirm-button'));
      await page.locator('#confirm-button').tap();
    };

    await mate();
    await expect(app).toHaveAttribute('data-phase', 'over');
    await expect(app).toHaveAttribute('data-ply', '7');
    // A game that ends is counted with the move that ends it (CONTRACT-NOTES 150), not when the celebration is over
    expect(await gamesOf(page)).toMatchObject({ played: 1, won: 1, lost: 0, drawn: 0 });
    // the 绝杀 banner
    const banner = page.locator('.fx-banner[data-kind="mate"]');
    await expect(banner).toBeAttached();
    await expect(banner).toHaveText('绝杀！');
    // The card is not lost to a stray tap: from here on the finger keeps tapping where 确定落子 was, every 150 ms, through
    // the celebration and for a second after the card has come up. 再来一局 of the action bar lies on that spot.
    /** @param {() => Promise<boolean>} done @param {number} [limit] taps at most */
    const strayTaps = async (done, limit = 80) => {
      for (let n = 0; n < limit && !(await done()); n++) {
        await page.touchscreen.tap(spot.x, spot.y);
        await page.waitForTimeout(150);
      }
    };
    // the replay of the child's best move under the 本局最佳 ribbon, then the card
    const ribbon = page.locator('.stage-ribbon');
    await strayTaps(async () => await ribbon.count() > 0);
    await expect(ribbon).toBeAttached({ timeout: 15000 });
    await expect(ribbon).toHaveText('本局最佳');
    await strayTaps(() => card.isVisible());
    await strayTaps(async () => false, 7);
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(ribbon).toHaveCount(0);
    // nothing started a new game: the won game is still the one on the board and in the store
    await expect(app).toHaveAttribute('data-phase', 'over');
    await expect(app).toHaveAttribute('data-ply', '7');
    expect(JSON.parse(await stored(page, KEYS.game) ?? 'null').id).toBe(JSON.parse(saveFixture('v2-one-before-mate.json')).id);
    const order = (await laps(page)).first;
    expect(order.banner).toBeLessThan(order.ribbon);
    expect(order.ribbon).toBeLessThan(order.card);
    expect(order.card - order.ribbon).toBeGreaterThanOrEqual(2500);                    // the replay takes its three seconds
    await expect(card.locator('.hud-over__best')).toContainText('本局最佳');
    await expect(card.locator('.hud-over__best')).toContainText('炮八平五');
    await expect(card).toContainText('kind=over', { timeout: 10000 });
    await expect(card.locator('[data-choice="again"]')).toHaveText('再来一局');
    // in landscape the figure of the coach column is gone while the card is up (CONTRACT-NOTES 126)
    await expect(page.locator('#buddy .buddy-fig')).toBeHidden();
    await expect(page.locator('#undo-button')).toHaveText('悔棋');
    expect(await gamesOf(page)).toMatchObject({ played: 1, won: 1, lost: 0, drawn: 0 });

    // undo and mate again: the game is counted once. 回看棋局 is tapped twice, as children do: the second tap reaches nothing
    // of what the card covered (the chip 我哪步下得最好？ lies under the button in this layout)
    await doubleTap(page, card.locator('[data-choice="review"]'));
    await expect(card).toHaveCount(0);
    await expect(page.locator('#buddy .buddy-fig')).toBeVisible();
    await expect(page.locator('.chip').first()).toBeVisible();
    await expect(page.locator('.msg[data-role="me"]')).toHaveCount(0);
    await expect(app).toHaveAttribute('data-phase', 'over');
    await page.locator('#undo-button').tap();
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
    await expect(app).toHaveAttribute('data-ply', '6');
    await mate();
    await expect(app).toHaveAttribute('data-phase', 'over');
    // 新对局 of the menu is no way round the card either. The menu is opened during the celebration and the finger stays on
    // 新对局 until the card has been up for most of a second: no new game. The item is held with the card's own buttons
    // (it must not come alive under a finger the moment the card shows) and is there again once the taps have stopped.
    await page.locator('#menu-button').tap();
    const fresh = page.locator('.hud-menu__item[data-menu="new-game"]');
    await expect(fresh).toBeDisabled();
    const item = await centreOf(fresh);
    for (let n = 0, after = 5; n < 100 && (!(await card.isVisible()) || after-- > 0); n++) {
      await page.touchscreen.tap(item.x, item.y);
      await page.waitForTimeout(150);
    }
    await expect(card).toBeVisible({ timeout: 20000 });
    await expect(app).toHaveAttribute('data-phase', 'over');
    await expect(app).toHaveAttribute('data-ply', '7');
    await expect(fresh).toBeEnabled({ timeout: 6000 });
    await page.keyboard.press('Escape');                     // the menu goes, the card stays
    await expect(fresh).toHaveCount(0);
    await expect(card).toBeVisible();
    await expect(card).toContainText('kind=over', { timeout: 10000 });
    expect(await gamesOf(page)).toMatchObject({ played: 1, won: 1, lost: 0, drawn: 0 });

    // 再来一局, tapped twice: one new game, and no chip of it is pressed by the second tap
    await doubleTap(page, card.locator('[data-choice="again"]'));
    await expect(app).toHaveAttribute('data-phase', 'childTurn', { timeout: 10000 });
    await expect(app).toHaveAttribute('data-ply', '0');
    await expect(card).toHaveCount(0);
    await expect(page.locator('.piece[data-id]')).toHaveCount(32);
    expect(await savedMoves(page)).toEqual([]);
    expect(await gamesOf(page)).toMatchObject({ played: 1, won: 1 });
    await expect(page.locator('.chip').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.msg[data-role="me"]')).toHaveCount(0);
  });
});

test.describe('the game-over card and a finger that taps twice (CONTRACT-NOTES 150)', () => {
  test('a double tap on a button of the game-over card reaches nothing under it', async ({ page }) => {
    const app = page.locator('#app');
    const card = page.locator('dialog[data-dialog="over"]');
    // a finished game that was counted; upright, 回看棋局 of the card lies over 再来一局 of the action bar
    const game = JSON.parse(saveFixture('v2-midgame.json'));
    const finished = { ...game, result: { winner: 'black', reason: 'resign' }, counted: true, endedAt: game.startedAt + 60000 };
    await page.setViewportSize({ width: 820, height: 1180 });
    await seedStorage(page, { [KEYS.game]: JSON.stringify(finished) }, { clear: true });
    await ready(page, { query: 'coach=off' });
    await expect(app).toHaveAttribute('data-phase', 'over');
    await expect(card).toBeVisible();
    const review = await centreOf(card.locator('[data-choice="review"]'));
    const under = await page.locator('#newgame-button').boundingBox();
    if (!under) throw new Error('再来一局 of the action bar has no box');
    expect(review.x).toBeGreaterThan(under.x);
    expect(review.x).toBeLessThan(under.x + under.width);
    expect(review.y).toBeGreaterThan(under.y);
    expect(review.y).toBeLessThan(under.y + under.height);

    await doubleTap(page, card.locator('[data-choice="review"]'));
    await expect(card).toHaveCount(0);
    await page.waitForTimeout(600);                          // what a second tap would have started has had its time
    await expect(app).toHaveAttribute('data-phase', 'over');
    await expect(app).toHaveAttribute('data-ply', String(game.moves.length));
    expect(JSON.parse(await stored(page, KEYS.game) ?? 'null').id).toBe(game.id);
    expect(await savedMoves(page)).toEqual(game.moves);
    // ... and 再来一局 of the action bar is there for the tap that is meant
    await page.locator('#newgame-button').tap();
    await expect(app).toHaveAttribute('data-ply', '0', { timeout: 10000 });
  });
});

test.describe('flow 16', () => {
  test('resign, un-resign, choose black', async ({ page }) => {
    const app = page.locator('#app');
    const board = page.locator('#board');
    const card = page.locator('dialog[data-dialog="over"]');
    const dialog = page.locator('dialog[data-dialog="resign"]');
    /** @param {string} item the menu entry */
    const menu = async (item) => {
      await page.locator('#menu-button').tap();
      await page.locator(`.hud-menu__item[data-menu="${item}"]`).tap();
    };
    const savedResult = async () => JSON.parse(await stored(page, KEYS.game) ?? 'null').result;

    await ready(page);
    await expect(board).toHaveAttribute('data-bottom', 'red');
    expect(await fileLabels(page)).toEqual({ top: '123456789', bottom: '九八七六五四三二一' });
    await playMove(page, [7, 7], [7, 4]);
    await expect(app).toHaveAttribute('data-ply', '2');

    // the resign dialog asks first
    await menu('resign');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-choice="keep"]').tap();
    await expect(dialog).toHaveCount(0);
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
    expect(await savedResult()).toBeNull();
    await menu('resign');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-choice="go"]').tap();
    await expect(app).toHaveAttribute('data-phase', 'over');
    await expect(app).toHaveAttribute('data-ply', '2');
    await expect(card).toBeVisible({ timeout: 15000 });
    expect(await savedResult()).toEqual({ winner: 'black', reason: 'resign' });

    // a reload keeps the result
    await page.reload({ waitUntil: 'load' });
    await settled(page);
    await expect(app).toHaveAttribute('data-phase', 'over');
    await expect(app).toHaveAttribute('data-ply', '2');
    await expect(card).toBeVisible();
    expect(await savedResult()).toEqual({ winner: 'black', reason: 'resign' });

    // undo takes the resignation back: the child is to move again, no ply is removed
    await card.locator('[data-choice="review"]').tap();
    await expect(card).toHaveCount(0);
    await expect(page.locator('#undo-button')).toHaveText('悔棋');
    await page.locator('#undo-button').tap();
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
    await expect(app).toHaveAttribute('data-ply', '2');
    expect(await savedResult()).toBeNull();
    expect(await savedMoves(page)).toHaveLength(2);

    // a new game as black: the rival opens, the board is seen from black's side
    await menu('new-game');
    const fresh = page.locator('dialog[data-dialog="new-game"]');
    await expect(fresh).toBeVisible();
    await fresh.locator('[data-choice="black"]').tap();
    await fresh.locator('[data-choice="go"]').tap();
    await expect(app).toHaveAttribute('data-ply', '1', { timeout: 15000 });
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
    await expect(board).toHaveAttribute('data-bottom', 'black');
    const mine = await page.locator('.piece[data-type="king"][data-color="black"]').boundingBox();
    const his = await page.locator('.piece[data-type="king"][data-color="red"]').boundingBox();
    if (!mine || !his) throw new Error('a king has no box');
    expect(mine.y).toBeGreaterThan(his.y);
    expect(await fileLabels(page)).toEqual({ top: '一二三四五六七八九', bottom: '987654321' });
    const game = JSON.parse(await stored(page, KEYS.game) ?? 'null');
    expect(game.humanColor).toBe('black');
    expect(game.moves).toHaveLength(1);
  });
});
