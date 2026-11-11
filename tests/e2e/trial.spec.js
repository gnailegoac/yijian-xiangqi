// tests/e2e/trial.spec.js (E1): SPEC 14.7 flows 2, 3, 7 and 8: the tentative move, the second tap, a held trial, the pouches.
import { expect, test } from '@playwright/test';
import { bubble, explainProxyLimit, KEYS, laps, pieces, ply, ready, savedMoves, seedStorage, stopwatch, tap, watch } from './helpers.js';

test.describe.configure({ timeout: 60000 });
explainProxyLimit(test);

/** The cannon of 炮二平五 and its target (SPEC 3.1: row 0 is black's back rank). */
const CANNON = /** @type {const} */ ([7, 7]);
const CENTRE = /** @type {const} */ ([7, 4]);

test.describe('flow 2', () => {
  test('trial, comment, retract', async ({ page }) => {
    const app = page.locator('#app');
    await ready(page);
    await expect(page.locator('.bubble')).toHaveAttribute('data-state', 'done');        // the greeting has been said
    await expect(page.locator('#buddy .buddy')).toHaveAttribute('data-mood', 'idle');
    const start = await pieces(page);
    expect(await savedMoves(page)).toEqual([]);

    await tap(page, ...CANNON);
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await stopwatch(page, { mood: '#buddy .buddy:not([data-mood="idle"])' });
    await tap(page, ...CENTRE);
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    await expect(app).toHaveAttribute('data-ply', '0');
    const trial = page.locator('.piece.is-trial');
    await expect(trial).toHaveCount(1);
    await expect(trial).toHaveAttribute('data-type', 'cannon');
    await expect(trial).toHaveAttribute('data-color', 'red');

    // 诸葛亮's face before his words: within 150 ms of the tap that made the trial
    await expect(page.locator('#buddy .buddy')).not.toHaveAttribute('data-mood', 'idle');
    const times = await laps(page);
    expect(times.ups).toHaveLength(1);
    expect(times.first.mood - times.ups[0]).toBeLessThanOrEqual(150);
    expect(await savedMoves(page)).toEqual([]);

    const line = page.locator('.bubble[data-state="done"]');
    await expect(line).toContainText('kind=try', { timeout: 8000 });
    const comment = await bubble(page);
    expect(comment?.state).toBe('done');
    expect(comment?.source).toBe('llm');                      // the mock proxy stands in for the model
    expect(comment?.text.startsWith('〔kind=try〕')).toBe(true);
    expect(await savedMoves(page)).toEqual([]);

    await expect(page.locator('#retract-button')).toHaveText('换一步');
    await page.locator('#retract-button').tap();
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await expect(app).toHaveAttribute('data-ply', '0');
    await expect(page.locator('.piece.is-trial')).toHaveCount(0);
    await expect(page.locator(`.piece[data-type="cannon"][data-color="red"][data-row="${CANNON[0]}"][data-col="${CANNON[1]}"]`)).toHaveCount(1);
    expect(await pieces(page)).toBe(start);
    expect(await savedMoves(page)).toEqual([]);
  });
});

test.describe('flow 3', () => {
  test('second tap confirms', async ({ page }) => {
    const app = page.locator('#app');
    await ready(page);
    await expect(page.locator('.bubble')).toHaveAttribute('data-state', 'done');
    // every change of #app[data-ply] from here on
    await page.evaluate(() => {
      const el = /** @type {HTMLElement} */ (document.querySelector('#app'));
      /** @type {string[]} */ const seen = [];
      let last = el.dataset.ply ?? '';
      Object.assign(window, { __plies: seen });
      new MutationObserver(() => {
        const value = el.dataset.ply ?? '';
        if (value === last) return;
        last = value;
        seen.push(value);
      }).observe(el, { attributes: true, attributeFilter: ['data-ply'] });
    });
    const pliesSeen = () => page.evaluate(() => /** @type {{__plies: string[]}} */ (/** @type {unknown} */ (window)).__plies);

    await tap(page, ...CANNON);
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await stopwatch(page, {});
    await tap(page, ...CENTRE);
    const tried = Date.now();

    // a tap 50 ms later is inside the guard (200 ms from landing): nothing happens
    await page.waitForTimeout(50);
    await tap(page, ...CENTRE);
    const early = await laps(page);
    expect(early.ups).toHaveLength(2);
    expect(early.ups[1] - early.ups[0]).toBeLessThan(250);                              // the tap did arrive inside the guard (it ends 320 ms after the first tap)
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    await page.waitForTimeout(150);
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    expect(await ply(page)).toBe(0);
    expect(await pliesSeen()).toEqual([]);
    expect(await savedMoves(page)).toEqual([]);

    // 250 ms after the piece has landed (with reduced motion it travels for 120 ms) the same tap confirms
    await page.waitForTimeout(Math.max(0, 120 + 250 - (Date.now() - tried)));
    await tap(page, ...CENTRE);
    await expect(app).toHaveAttribute('data-ply', '2', { timeout: 15000 });
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
    expect(await pliesSeen()).toEqual(['1', '2']);                                      // the child's move, then the rival's
    expect((await savedMoves(page))[0]).toBe('7774');
  });
});

test.describe('flow 7', () => {
  test('held trial', async ({ page }) => {
    // One move before a hanging piece: after 1. 炮二平五 马8进7 the centre pawn is guarded by the horse, so
    // 炮五进四 (7,4) -> (3,4) wins a pawn and loses the cannon.
    const game = { schema: 2, id: 'g-e2eheld01', humanColor: 'red', moves: ['7774', '0726'], result: null, startedAt: 1790000000000, endedAt: null,
                   activeMs: 20000, counted: false, drawFrom: 0, seed: 123456789, skill: null, memory: null, start: null };
    const seen = watch(page);
    await seedStorage(page, { [KEYS.game]: JSON.stringify(game) });
    await ready(page);
    const app = page.locator('#app');
    await expect(app).toHaveAttribute('data-ply', '2');
    await expect(app).toHaveAttribute('data-phase', 'childTurn');

    await tap(page, 7, 4);
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await stopwatch(page, { question: '.msg[data-role="buddy"][data-kind="try"]' });
    await tap(page, 3, 4);
    await expect(app).toHaveAttribute('data-phase', 'tentative');

    // the guiding question: local, at once, and it does not give the answer away
    const speech = page.locator('.bubble');
    await expect(page.locator('.msg[data-role="buddy"][data-kind="try"]')).toHaveCount(1);
    const times = await laps(page);
    expect(times.first.question - times.ups[0]).toBeLessThanOrEqual(300);
    await expect(speech).toHaveAttribute('data-source', 'local');
    await expect(speech).toHaveAttribute('data-state', 'done');
    const question = await bubble(page);
    expect(question?.source).toBe('local');
    expect(question?.text.length).toBeGreaterThan(0);
    expect(question?.text).not.toContain('kind=');
    await expect(speech.locator('.move-link')).toHaveCount(0);
    await expect(page.locator('.msg[data-kind="try"]')).toHaveAttribute('data-source', 'local');
    await expect(page.locator('.msg[data-kind="try"] .move-link')).toHaveCount(0);
    await expect(page.locator('.chip')).toHaveText(['我看出来了', '指给我看', '就走这步']);
    await page.waitForTimeout(600);                          // nothing is sent later either: the model enters with the first follow-up
    expect(seen.coach()).toBe(0);

    // 指给我看: the board acts first (ghost play), the text is the caption
    await stopwatch(page, { ghost: '.piece.is-ghost', link: '.bubble .move-link[data-move]' });
    await page.locator('.chip', { hasText: '指给我看' }).tap();
    await expect(page.locator('.piece.is-ghost').first()).toBeAttached();
    await expect(speech.locator('.move-link[data-move]').first()).toBeVisible({ timeout: 8000 });
    const after = await laps(page);
    expect(after.first.ghost).toBeLessThanOrEqual(after.first.link);
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    expect(seen.coach()).toBeGreaterThanOrEqual(1);
  });
});

test.describe('flow 8', () => {
  test('pouches', async ({ page }) => {
    const app = page.locator('#app');
    const hint = page.locator('#hint-button');
    await ready(page);
    await expect(page.locator('.bubble')).toHaveAttribute('data-state', 'done');
    await expect(hint).toHaveAttribute('data-level', '0');
    await expect(page.locator('#board .bv-hlring, #board .bv-hlarea')).toHaveCount(0);

    await hint.tap();
    await expect(hint).toHaveAttribute('data-level', '1');
    await expect(page.locator('.arrow[data-style="hint"]')).toHaveCount(0);

    await hint.tap();
    await expect(hint).toHaveAttribute('data-level', '2');
    await expect(page.locator('#board .bv-hlring, #board .bv-hlarea').first()).toBeAttached();       // the piece or the area is lit
    await expect(page.locator('.arrow[data-style="hint"]')).toHaveCount(0);

    await hint.tap();
    await expect(hint).toHaveAttribute('data-level', '3');
    const arrow = page.locator('.arrow[data-style="hint"]');
    await expect(arrow).toHaveCount(1);
    const from = await arrow.getAttribute('data-from') ?? '';
    const to = await arrow.getAttribute('data-to') ?? '';
    expect(from).toMatch(/^\d\d$/);
    expect(to).toMatch(/^\d\d$/);
    await expect(page.locator('.bubble .move-link[data-move]').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator(`.bubble .move-link[data-move="${from}${to}"]`)).toHaveCount(1);      // the line names the move of the arrow
    // the hinted piece is selected
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await expect(page.locator(`.board-cell.is-selected[data-row="${from[0]}"][data-col="${from[1]}"]`)).toHaveCount(1);
    await expect(page.locator(`.piece.is-selected[data-row="${from[0]}"][data-col="${from[1]}"]`)).toHaveCount(1);

    const chip = page.locator('.chip[data-action]', { hasText: '试试这步' });
    await expect(chip).toHaveCount(1);
    await chip.tap();
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    await expect(page.locator(`.board-cell.is-trial-from[data-row="${from[0]}"][data-col="${from[1]}"]`)).toHaveCount(1);
    await expect(page.locator(`.board-cell.is-trial-to[data-row="${to[0]}"][data-col="${to[1]}"]`)).toHaveCount(1);
    await expect(page.locator('.piece.is-trial')).toHaveCount(1);
    await expect(app).toHaveAttribute('data-ply', '0');
  });
});
