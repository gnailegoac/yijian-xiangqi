// tests/e2e/noproxy.spec.js (E1): SPEC 14.7 flow 13, in all three projects: the whole game with the local strategist
// (`?coach=off`), without one request to the proxy.
import { expect, test } from '@playwright/test';
import { explainProxyLimit, KEYS, openSheet, ready, savedMoves, saveFixture, seedStorage, tap, watch } from './helpers.js';

test.describe.configure({ timeout: 180000 });
explainProxyLimit(test);

/** Two questions are at least 800 ms apart (D-21); a question asked sooner is not taken. */
const ASK_GAP_MS = 900;
const CJK = /\p{Script=Han}/u;

/** One move before a hanging piece (flow 7): after 1. 炮二平五 马8进7, 炮五进四 gives the cannon away for a pawn. */
const HELD_GAME = { schema: 2, id: 'g-e2eheld01', humanColor: 'red', moves: ['7774', '0726'], result: null, startedAt: 1790000000000, endedAt: null,
                    activeMs: 20000, counted: false, drawFrom: 0, seed: 123456789, skill: null, memory: null, start: null };

/**
 * The lines of one kind 诸葛亮 has said so far (the log keeps every one of them). Lines are counted by kind, because a
 * line of another kind (about the rival's move, say) may arrive at any moment.
 * @param {import('@playwright/test').Page} page
 * @param {string} kind data-kind: 'ask', 'hint', 'try', 'system', ...
 */
const said = (page, kind) => page.locator(`.msg[data-role="buddy"][data-kind="${kind}"]`);

/**
 * Checks that one more line of this kind was said, that it is a finished local line in Chinese, and that the bubble
 * shows a local line.
 * @param {import('@playwright/test').Page} page
 * @param {number} before the number of lines of this kind before the action that should have caused one
 * @param {string} kind the data-kind of the new line
 * @returns {Promise<void>}
 */
async function expectLocalLine(page, before, kind) {
  await expect(said(page, kind)).toHaveCount(before + 1, { timeout: 8000 });
  const line = said(page, kind).last();
  await expect(line).toHaveAttribute('data-state', 'done', { timeout: 8000 });
  await expect(line).toHaveAttribute('data-source', 'local');
  await expect(line.locator('.msg__text')).toHaveText(CJK);
  await expect(line.locator('.msg__text')).not.toContainText('kind=');
  await expect(page.locator('.bubble')).toHaveAttribute('data-source', 'local');
}

/**
 * Taps the chips with these ask codes one after the other; each must be answered with a local line.
 * @param {import('@playwright/test').Page} page
 * @param {string[]} codes
 * @returns {Promise<void>}
 */
async function askAll(page, codes) {
  for (const code of codes) {
    await page.waitForTimeout(ASK_GAP_MS);
    const before = await said(page, 'ask').count();
    await page.locator(`.chip[data-ask="${code}"]`).tap();
    await expectLocalLine(page, before, 'ask');
  }
}

/**
 * Nothing a child can read says 离线 (D-40).
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function expectNoOfflineWord(page) {
  expect(await page.evaluate(() => (document.body.textContent ?? '').includes('离线'))).toBe(false);
}

test.describe('flow 13', () => {
  test('no proxy @smoke', async ({ page }) => {
    const app = page.locator('#app');
    const hint = page.locator('#hint-button');
    const seen = watch(page);

    await test.step('a new game: the turn chips, the pouches, a trial and its chips, a capture trial', async () => {
      await ready(page, { query: 'coach=off' });
      await expect(app).toHaveAttribute('data-coach', 'local');
      await expect(page.locator('#chat-toggle')).toHaveCount(0);
      await expect(page.locator('.msg[data-role="buddy"]').first()).toHaveAttribute('data-source', 'local');      // the greeting is his own

      // the turn set
      await expect(page.locator('.chip[data-ask="danger"]')).toBeVisible();
      await askAll(page, ['danger', 'score']);

      // pouches 1 to 3, each with its local line
      for (const level of [1, 2, 3]) {
        const before = await said(page, 'hint').count();
        await hint.tap();
        await expect(hint).toHaveAttribute('data-level', String(level));
        await expectLocalLine(page, before, 'hint');
      }
      await expect(page.locator('.arrow[data-style="hint"]')).toHaveCount(1);
      await expect(page.locator('.bubble .move-link[data-move]').first()).toBeVisible();

      // pouch 3 offers 试试这步: the hinted move becomes the trial, and the trial chips are answered
      await page.locator('.chip[data-action]', { hasText: '试试这步' }).tap();
      await expect(app).toHaveAttribute('data-phase', 'tentative');
      await expect(page.locator('.chip[data-ask="good"]')).toBeVisible();
      await askAll(page, ['good', 'reply', 'better', 'why']);
      await page.locator('#retract-button').tap();
      await expect(app).toHaveAttribute('data-phase', 'selected');

      // a capturing trial (炮二进七 takes the horse) is commented on by the local strategist
      await tap(page, 7, 7);
      await expect(page.locator('.board-cell.is-selected[data-row="7"][data-col="7"]')).toHaveCount(1);
      const before = await said(page, 'try').count();
      await tap(page, 0, 7);
      await expect(app).toHaveAttribute('data-phase', 'tentative');
      await expectLocalLine(page, before, 'try');
      await page.locator('#retract-button').tap();
      await expect(app).toHaveAttribute('data-phase', 'selected');

      // a move pair; the next turn's chips ask about the rival's move and about the child's own
      await tap(page, 7, 4);
      await expect(app).toHaveAttribute('data-phase', 'tentative');
      await page.waitForTimeout(600);                        // he looks at the move before it is confirmed
      await page.locator('#confirm-button').tap();
      await expect(app).toHaveAttribute('data-ply', '2', { timeout: 15000 });
      await expect(app).toHaveAttribute('data-phase', 'childTurn');
      await expect(page.locator('.chip[data-ask="intent"]')).toBeVisible();
      await askAll(page, ['intent', 'last']);

      // no ✎ button and no input, also with the conversation sheet open (on a phone that is where the button would be)
      await expect(page.locator('#chat-toggle')).toHaveCount(0);
      await openSheet(page);
      await expect(page.locator('#chat-toggle')).toHaveCount(0);
      await expect(page.locator('#chat-input')).toBeHidden();
      await page.keyboard.press('Escape');
      await expect(app).toHaveAttribute('data-sheet', '0');
      expect(seen.api).toEqual([]);
      await expectNoOfflineWord(page);
    });

    await test.step('a held trial and its chips; a punished move and 悔一步重想', async () => {
      await seedStorage(page, { [KEYS.game]: JSON.stringify(HELD_GAME) }, { clear: true });
      await ready(page, { query: 'coach=off' });
      await expect(app).toHaveAttribute('data-ply', '2');
      await tap(page, 7, 4);
      await expect(app).toHaveAttribute('data-phase', 'selected');
      let before = await said(page, 'try').count();
      await tap(page, 3, 4);
      await expect(app).toHaveAttribute('data-phase', 'tentative');
      await expectLocalLine(page, before, 'try');             // the guiding question
      await expect(page.locator('.chip')).toHaveText(['我看出来了', '指给我看', '就走这步']);

      // 指给我看: the rival's answer on the board and a line that names it
      before = await said(page, 'ask').count();
      await page.locator('.chip', { hasText: '指给我看' }).tap();
      await expectLocalLine(page, before, 'ask');
      await expect(page.locator('.bubble .move-link[data-move]').first()).toBeVisible();

      // 我看出来了 takes the move back
      before = await said(page, 'system').count();
      await page.locator('.chip', { hasText: '我看出来了' }).tap();
      await expect(app).toHaveAttribute('data-phase', /^(selected|childTurn)$/);
      await expect(app).toHaveAttribute('data-ply', '2');
      await expectLocalLine(page, before, 'system');

      // The same move again: one guiding question per four moves, so this time he only looks worried. It is played,
      // 司马懿 takes the cannon, and the next turn offers to take the move back.
      if (await app.getAttribute('data-phase') === 'childTurn') {
        await tap(page, 7, 4);
        await expect(app).toHaveAttribute('data-phase', 'selected');
      }
      await tap(page, 3, 4);
      await expect(app).toHaveAttribute('data-phase', 'tentative');
      await expect(page.locator('.chip[data-ask="good"]')).toBeVisible();
      await expect(page.locator('.chip', { hasText: '就走这步' })).toHaveCount(0);
      await page.locator('#confirm-button').tap();
      await expect(app).toHaveAttribute('data-ply', '4', { timeout: 15000 });
      await expect(app).toHaveAttribute('data-phase', 'childTurn');
      const takeback = page.locator('.chip[data-action]', { hasText: '悔一步重想' });
      await expect(takeback).toBeVisible({ timeout: 8000 });
      await takeback.tap();
      await expect(app).toHaveAttribute('data-ply', '2');
      await expect(app).toHaveAttribute('data-phase', 'childTurn');
      await expect(takeback).toHaveCount(0);

      expect(seen.api).toEqual([]);
      await expectNoOfflineWord(page);
    });

    await test.step('the third held chip: 就走这步 plays the move as it stands', async () => {
      await seedStorage(page, { [KEYS.game]: JSON.stringify(HELD_GAME) }, { clear: true });
      await ready(page, { query: 'coach=off' });
      await expect(app).toHaveAttribute('data-ply', '2');
      await tap(page, 7, 4);
      await expect(app).toHaveAttribute('data-phase', 'selected');
      const before = await said(page, 'try').count();
      await tap(page, 3, 4);
      await expect(app).toHaveAttribute('data-phase', 'tentative');
      await expectLocalLine(page, before, 'try');             // the guiding question again: it is a new visit
      const go = page.locator('.chip', { hasText: '就走这步' });
      await expect(go).toHaveCount(1);
      await go.tap();                                         // the 小主公 decides: no second question, no extra tap
      await expect(app).toHaveAttribute('data-ply', '4', { timeout: 15000 });        // the move, then the rival's answer
      await expect(app).toHaveAttribute('data-phase', 'childTurn');
      expect((await savedMoves(page)).slice(0, 3)).toEqual(['7774', '0726', '7434']);
      expect(seen.api).toEqual([]);
    });

    await test.step('game over: the takeaway on the card and the chips after it', async () => {
      await seedStorage(page, { [KEYS.game]: saveFixture('v2-one-before-mate.json') }, { clear: true });
      await ready(page, { query: 'coach=off' });
      await expect(app).toHaveAttribute('data-ply', '6');
      await tap(page, 5, 1);
      await expect(app).toHaveAttribute('data-phase', 'selected');
      await tap(page, 5, 4);
      await expect(app).toHaveAttribute('data-phase', 'tentative');
      await page.locator('#confirm-button').tap();
      await expect(app).toHaveAttribute('data-phase', 'over');
      const card = page.locator('dialog[data-dialog="over"]');
      await expect(card).toBeVisible({ timeout: 20000 });
      const takeaway = card.locator('.hud-over__takeaway');
      await expect(takeaway).toHaveText(CJK, { timeout: 8000 });
      await expect(takeaway).not.toContainText('kind=');
      expect(seen.api).toEqual([]);
      await expectNoOfflineWord(page);

      // the over chips come out when the card is closed
      await card.locator('[data-choice="review"]').tap();
      await expect(card).toHaveCount(0);
      const chips = page.locator('.chip[data-ask]');
      await expect(chips.first()).toBeVisible();
      const codes = await chips.evaluateAll((list) => list.map((chip) => /** @type {HTMLElement} */ (chip).dataset.ask ?? ''));
      expect(codes.length).toBeGreaterThanOrEqual(1);
      expect(codes.every((code) => ['proud', 'improve', 'next'].includes(code))).toBe(true);
      await askAll(page, codes);
      await askAll(page, ['why']);                           // 为什么？ after the game is always answered

      // the settings sheet is the one place that says why the strategist is local; it does not say 离线 either
      await page.locator('#menu-button').tap();
      await page.locator('.hud-menu__item[data-menu="settings"]').tap();
      await expect(page.locator('dialog[data-dialog="settings"]')).toBeVisible();
      await expect(page.locator('dialog[data-dialog="settings"]')).toContainText('本机');
      await expectNoOfflineWord(page);
      expect(seen.api).toEqual([]);
      await expect(app).toHaveAttribute('data-coach', 'local');
    });
  });
});
