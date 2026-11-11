// tests/e2e/coach.spec.js (E1): SPEC 14.7 flows 4, 5, 9 and 14: the strategist's text against the mock proxy.
import { expect, test } from '@playwright/test';
import { centreOf, explainProxyLimit, idle, laps, mockOptions, mockReset, mockStats, openSheet, pieces, ready, savedMoves, stopwatch, tap, tryAnyMove, watch } from './helpers.js';

test.describe.configure({ timeout: 90000 });
explainProxyLimit(test);

/** Two questions are at least 800 ms apart (D-21); a question asked sooner is not taken. The tests wait a little longer. */
const ASK_GAP_MS = 900;
/** The kind fixed line of a refused free question (SPEC 7.7). */
const REFUSED = '这件事亮帮不上忙。要是心里有事，记得找爸爸妈妈或老师说说。咱们接着看棋？';

/**
 * The visible text of the newest log line of one kind ('' when there is none).
 * @param {import('@playwright/test').Page} page
 * @param {string} kind
 * @returns {Promise<string>}
 */
function lineText(page, kind) {
  return page.evaluate((k) => {
    const all = document.querySelectorAll(`.msg[data-role="buddy"][data-kind="${k}"] .msg__text`);
    const last = all[all.length - 1];
    return last ? (last.textContent ?? '') : '';
  }, kind);
}

test.describe('flow 4', () => {
  test('confirm before the comment finishes', async ({ page }) => {
    const app = page.locator('#app');
    await mockOptions(page, 'chunkMs=400');
    await mockReset(page);
    await ready(page);
    await expect(page.locator('.bubble')).toHaveAttribute('data-state', 'done', { timeout: 15000 });      // the greeting, four characters every 400 ms
    expect((await mockStats(page)).aborted).toBe(0);

    await tap(page, 7, 7);
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await tap(page, 7, 4);
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    const comment = page.locator('.msg[data-role="buddy"][data-kind="try"]');
    await expect(comment).toHaveAttribute('data-state', 'streaming', { timeout: 8000 });
    await expect(comment.locator('.msg__text')).toHaveText(/\S/, { timeout: 8000 });                   // its first characters are there, the rest is 400 ms per chunk away

    await page.locator('#confirm-button').tap();
    await expect(app).toHaveAttribute('data-ply', /^[12]$/);
    await expect(comment).toHaveAttribute('data-state', 'stale');
    const cut = await lineText(page, 'try');
    expect(cut.length).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    expect(await lineText(page, 'try')).toBe(cut);
    await expect(comment).toHaveAttribute('data-state', 'stale');
    await expect(page.locator('.msg[data-kind="try"]')).toHaveCount(1);

    expect((await mockStats(page)).aborted).toBeGreaterThanOrEqual(1);
    // a caption for the rival's move
    await expect(app).toHaveAttribute('data-ply', '2', { timeout: 15000 });
    const caption = page.locator('.msg[data-kind="caption"]');
    await expect(caption).toHaveCount(1);
    await expect(caption).toHaveText(/\p{Script=Han}/u);
    await expect(page.locator('.bubble .bubble__caption')).toBeVisible();
  });
});

test.describe('flow 5', () => {
  test('undo mid-stream', async ({ page }) => {
    const app = page.locator('#app');
    await mockOptions(page, 'chunkMs=400');
    await ready(page);
    await expect(page.locator('.bubble')).toHaveAttribute('data-state', 'done', { timeout: 15000 });
    const start = await pieces(page);

    await tap(page, 7, 7);
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await tap(page, 7, 4);
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    await page.locator('#confirm-button').tap();
    await expect(app).toHaveAttribute('data-ply', '2', { timeout: 15000 });
    // the line about the rival's move is streaming
    const line = page.locator('.msg[data-role="buddy"][data-kind="opp"]');
    await expect(line).toHaveAttribute('data-state', 'streaming', { timeout: 10000 });
    await expect(line.locator('.msg__text')).toHaveText(/\S/, { timeout: 8000 });

    await page.locator('#undo-button').tap();
    await expect(app).toHaveAttribute('data-ply', '0');
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
    await expect(page.locator('.piece[data-id]')).toHaveCount(32);
    expect(await pieces(page)).toBe(start);
    expect(await savedMoves(page)).toEqual([]);

    const cut = await lineText(page, 'opp');
    await page.waitForTimeout(1500);
    expect(await lineText(page, 'opp')).toBe(cut);            // nothing was added to the interrupted line
    await expect(page.locator('.msg[data-kind="opp"][data-state="streaming"]')).toHaveCount(0);
    await expect(page.locator('.bubble')).not.toContainText('kind=opp');
    expect(await pieces(page)).toBe(start);
    await expect(app).toHaveAttribute('data-ply', '0');
  });
});

test.describe('flow 9', () => {
  test('chips and free text', async ({ page }) => {
    const app = page.locator('#app');
    const bubble = page.locator('.bubble');
    await ready(page);
    await expect(bubble).toHaveAttribute('data-state', 'done');
    await tap(page, 7, 7);
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await tap(page, 7, 4);
    await expect(page.locator('.bubble[data-state="done"]')).toContainText('kind=try', { timeout: 8000 });

    await test.step('the reply chip: ghosts play, then a line kind=ask', async () => {
      await stopwatch(page, { ghosts: '#board.is-previewing', line: '.msg[data-role="buddy"][data-kind="ask"]' });
      await page.locator('.chip[data-ask="reply"]').tap();
      await expect(page.locator('.bubble[data-state="done"]')).toContainText('kind=ask', { timeout: 8000 });
      const times = await laps(page);
      expect(times.first.ghosts).toBeGreaterThan(0);
      expect(times.first.ghosts).toBeLessThanOrEqual(times.first.line);
      await expect(page.locator('.msg[data-role="me"]')).toHaveText(['对方会怎么应？']);
      await expect(app).toHaveAttribute('data-phase', 'tentative');
    });

    await test.step('✎ opens the input; a question with a notation runs the tool and is answered kind=tool', async () => {
      const input = page.locator('#chat-input');
      await expect(input).toBeHidden();
      await page.locator('#chat-toggle').tap();
      await expect(input).toBeVisible();
      await input.fill('炮二平五好不好？');
      await page.waitForTimeout(ASK_GAP_MS);                 // a child needs longer than that to type a question
      await stopwatch(page, { tool: '.chat-tool' });
      await page.locator('#chat-send').tap();
      await expect(page.locator('.bubble[data-state="done"]')).toContainText('kind=tool', { timeout: 12000 });
      expect((await laps(page)).first.tool).toBeGreaterThan(0);                           // the tool indicator was shown meanwhile
      await expect(page.locator('.chat-tool')).toHaveCount(0);
      await expect(page.locator('.msg[data-role="me"]').last()).toHaveText('炮二平五好不好？');
    });

    await test.step('#refusal: the kind fixed line, and the strategist stays on', async () => {
      const input = page.locator('#chat-input');
      await expect(input).toBeVisible();
      await input.fill('#refusal');
      await page.waitForTimeout(ASK_GAP_MS);
      await page.locator('#chat-send').tap();
      await expect(bubble.locator('.bubble__text')).toHaveText(REFUSED, { timeout: 8000 });
      await expect(bubble).toHaveAttribute('data-state', 'done');
      await expect(page.locator('.chip').first()).toBeVisible();
      await page.waitForTimeout(500);
      await expect(app).toHaveAttribute('data-coach', 'llm');
      await expect(bubble.locator('.bubble__text')).toHaveText(REFUSED);
    });
  });
});

test.describe('flow 14', () => {
  test('proxy fails mid-session', async ({ page }) => {
    const app = page.locator('#app');
    const bubble = page.locator('.bubble');
    const seen = watch(page);
    await ready(page);
    await expect(page.locator('.bubble[data-state="done"]')).toContainText('kind=start');
    await expect(app).toHaveAttribute('data-coach', 'llm');
    expect(seen.coach()).toBe(1);

    await page.route('**/api/coach', (route) => route.abort());

    // the next event (a capturing trial is always commented on) is answered locally
    await tap(page, 7, 7);
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await tap(page, 0, 7);
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    const first = page.locator('.msg[data-role="buddy"][data-kind="try"]');
    await expect(first).toHaveAttribute('data-state', 'done', { timeout: 8000 });
    await expect(first).toHaveAttribute('data-source', 'local');
    await expect(first.locator('.msg__text')).toHaveText(/\p{Script=Han}/u);
    await expect(first.locator('.msg__text')).not.toContainText('kind=');
    expect(seen.coach()).toBe(2);
    await expect(app).toHaveAttribute('data-coach', 'llm');                             // one failure does not switch him off

    // the second failure
    await page.locator('.chip[data-ask]').first().tap();
    const second = page.locator('.msg[data-role="buddy"][data-kind="ask"]');
    await expect(second).toHaveAttribute('data-state', 'done', { timeout: 8000 });
    await expect(second).toHaveAttribute('data-source', 'local');
    await expect(second.locator('.msg__text')).toHaveText(/\p{Script=Han}/u);
    expect(seen.coach()).toBe(3);
    await expect(app).toHaveAttribute('data-coach', 'local');

    // the following turn: a trial, the confirmed move, the rival's answer and a pouch cause no further request
    await page.locator('#retract-button').tap();
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await tap(page, 7, 4);
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    await page.locator('#confirm-button').tap();
    await expect(app).toHaveAttribute('data-ply', '2', { timeout: 15000 });
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
    await page.locator('#hint-button').tap();
    await expect(page.locator('#hint-button')).toHaveAttribute('data-level', '1');
    await expect(bubble).toHaveAttribute('data-source', 'local');
    await expect(bubble.locator('.bubble__text')).toHaveText(/\p{Script=Han}/u);
    await page.waitForTimeout(800);
    expect(seen.coach()).toBe(3);
    await expect(app).toHaveAttribute('data-coach', 'local');
  });
});

test.describe('lines and links when the game moves on (CONTRACT-NOTES 150)', () => {
  test('a line that is cut keeps whole sentences only; the links of an earlier position are retired', async ({ page }) => {
    const app = page.locator('#app');
    /** A sentence end, with the closing marks that may follow it. */
    const WHOLE = /[。！？][」』”’）》]*$/u;
    await mockOptions(page, 'chunkMs=250');
    await ready(page);
    await expect(page.locator('.bubble')).toHaveAttribute('data-state', 'done', { timeout: 15000 });      // the greeting, four characters every 250 ms

    await test.step('a first trial while the read of his move is still typed: no half sentence stays behind', async () => {
      await tap(page, 7, 7);
      await expect(app).toHaveAttribute('data-phase', 'selected');
      await tap(page, 7, 4);
      await expect(app).toHaveAttribute('data-phase', 'tentative');
      await page.locator('#confirm-button').tap();
      await expect(app).toHaveAttribute('data-ply', '2', { timeout: 15000 });
      const read = page.locator('.msg[data-role="buddy"][data-kind="opp"]');
      await expect(read).toHaveAttribute('data-state', 'streaming', { timeout: 10000 });
      await expect(read.locator('.msg__text')).toHaveText(/\S/, { timeout: 8000 });                  // its first characters are on screen
      await tryAnyMove(page);
      await expect(page.locator('.msg[data-kind="opp"][data-state="streaming"]')).toHaveCount(0);
      // what is left of the line, in the log and in the bubble, is whole sentences, or nothing
      const left = await page.locator('.msg[data-role="buddy"][data-kind="opp"] .msg__text').allTextContents();
      for (const text of left) expect(text).toMatch(WHOLE);
      const spoken = page.locator('.bubble .bubble__text');
      if (await spoken.count() > 0 && (await spoken.textContent() ?? '').includes('kind=opp')) expect(await spoken.textContent()).toMatch(WHOLE);
      await page.waitForTimeout(700);
      for (const text of await page.locator('.msg[data-role="buddy"][data-kind="opp"] .msg__text').allTextContents()) expect(text).toMatch(WHOLE);
    });

    await test.step('one round later: the link of the earlier round is a plain word, the one of this round still draws its arrow', async () => {
      const first = page.locator('.chat__log .move-link').first();                                // the caption of his first move: its notation is a link
      await expect(first).toBeEnabled();
      // the trial is played with the second tap on its square; he answers
      const to = await page.locator('.board-cell.is-trial-to').first().evaluate((cell) => [Number(/** @type {HTMLElement} */ (cell).dataset.row), Number(/** @type {HTMLElement} */ (cell).dataset.col)]);
      await expect(async () => {
        if (await app.getAttribute('data-phase') === 'tentative') await tap(page, to[0], to[1]);
        expect(await app.getAttribute('data-phase')).not.toBe('tentative');
      }).toPass({ intervals: [350, 250, 250, 250], timeout: 6000 });
      await expect(app).toHaveAttribute('data-ply', '4', { timeout: 15000 });
      await expect(page.locator('.msg[data-kind="caption"]')).toHaveCount(2, { timeout: 10000 });
      await idle(page);
      await expect(first).toBeDisabled();
      await openSheet(page);
      await first.scrollIntoViewIfNeeded();
      const old = await centreOf(first);
      await page.touchscreen.tap(old.x, old.y);
      await page.waitForTimeout(400);
      await expect(page.locator('#board .arrow')).toHaveCount(0);
      await expect(first).not.toHaveClass(/is-active/);
      // the caption of the move he has just made is about the board of now
      const fresh = page.locator('.chat__log .msg[data-kind="caption"]').last().locator('.move-link');
      await expect(fresh).toBeEnabled();
      await fresh.scrollIntoViewIfNeeded();
      await fresh.tap();
      await expect(page.locator('#board .arrow')).toHaveCount(1);
      await expect(fresh).toHaveClass(/is-active/);
    });
  });
});
