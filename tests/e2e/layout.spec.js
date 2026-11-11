// tests/e2e/layout.spec.js (E1): SPEC 14.7 flow 10, in all three projects (SPEC 12).
import { expect, test } from '@playwright/test';
import { explainProxyLimit, openSheet, ready, tap } from './helpers.js';

test.describe.configure({ timeout: 90000 });
explainProxyLimit(test);

/** What each project must show: the layout mode and the height that is left when the on-screen keyboard is up. */
const PROJECTS = /** @type {Record<string, {mode: string, keyboardLeaves: number}>} */ ({
  'ipad-landscape': { mode: 'landscape', keyboardLeaves: 420 },
  'ipad-portrait': { mode: 'portrait', keyboardLeaves: 780 },
  'phone-360': { mode: 'compact', keyboardLeaves: 440 },
});

/**
 * The box of the first element that matches, in viewport pixels.
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @returns {Promise<{x:number, y:number, width:number, height:number, right:number, bottom:number}>}
 */
async function box(page, selector) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  return { ...b, right: b.x + b.width, bottom: b.y + b.height };
}

/**
 * What holds in every mode and every phase: the page does not scroll, and Undo is directly under the board.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function frame(page) {
  const view = await page.evaluate(() => {
    window.scrollTo(0, 200);                                 // a page that could scroll would move now
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight, innerWidth, innerHeight, scrollX, scrollY };
  });
  expect(view.scrollWidth).toBeLessThanOrEqual(view.innerWidth);
  expect(view.scrollHeight).toBeLessThanOrEqual(view.innerHeight);
  expect([view.scrollX, view.scrollY]).toEqual([0, 0]);
  const board = await box(page, '.bv');
  const undo = await box(page, '#undo-button');
  await expect(page.locator('#undo-button')).toBeVisible();
  const gap = undo.y - board.bottom;
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(16);
  expect(undo.height).toBeGreaterThanOrEqual(44);
  expect(board.x).toBeGreaterThanOrEqual(0);
  expect(board.right).toBeLessThanOrEqual(view.innerWidth);
}

test.describe('flow 10', () => {
  test('layout @layout', async ({ page }, testInfo) => {
    const expected = PROJECTS[testInfo.project.name];
    expect(expected, `no layout expectations for the project ${testInfo.project.name}`).toBeTruthy();
    const app = page.locator('#app');
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('the project has no viewport');

    await ready(page);
    await expect(app).toHaveAttribute('data-layout', expected.mode);
    await frame(page);
    if (expected.mode === 'portrait') {
      expect((await box(page, '.bv')).width).toBeGreaterThanOrEqual(0.85 * viewport.width);
    }

    // ---- a trial: where 确定落子 is ---------------------------------------------------------------------------------------
    await tap(page, 7, 7);
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await frame(page);
    await tap(page, 7, 4);
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    await expect(page.locator('#confirm-button')).toBeVisible();
    await frame(page);
    const confirm = await box(page, '#confirm-button');
    const undo = await box(page, '#undo-button');
    const board = await box(page, '.bv');
    expect(confirm.height).toBeGreaterThanOrEqual(44);
    if (expected.mode === 'landscape') {
      // the right column's bottom band: beside the board, under the coach, at the bottom edge of the screen
      const coach = await box(page, '#coach');
      const actions = await box(page, '#actions');
      expect(coach.x).toBeGreaterThanOrEqual(board.right);
      expect(Math.abs(actions.x - coach.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(actions.right - coach.right)).toBeLessThanOrEqual(1);
      expect(actions.y).toBeGreaterThanOrEqual(coach.bottom - 1);
      expect(viewport.height - actions.bottom).toBeLessThanOrEqual(1);
      expect(confirm.x).toBeGreaterThanOrEqual(actions.x);
      expect(confirm.right).toBeLessThanOrEqual(actions.right);
      expect(confirm.y).toBeGreaterThanOrEqual(actions.y);
      expect(confirm.bottom).toBeLessThanOrEqual(actions.bottom);
      // 诸葛亮 is a figure, not an icon
      expect((await box(page, '#buddy .buddy')).height).toBeGreaterThanOrEqual(240);
    } else if (expected.mode === 'portrait') {
      // the bottom edge of the screen, under the coach
      const coach = await box(page, '#coach');
      expect(confirm.y).toBeGreaterThanOrEqual(coach.bottom - 1);
      expect(viewport.height - confirm.bottom).toBeLessThanOrEqual(16);
    } else {
      // on a phone it shares the row of Undo, under the board
      expect(Math.abs(confirm.y - undo.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(confirm.bottom - undo.bottom)).toBeLessThanOrEqual(2);
      expect(confirm.x).toBeGreaterThanOrEqual(undo.right);
      expect(confirm.right).toBeLessThanOrEqual(viewport.width);
    }

    // ---- a full move pair can be played ------------------------------------------------------------------------------------
    await page.locator('#confirm-button').tap();
    await expect(app).toHaveAttribute('data-ply', '2', { timeout: 15000 });
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
    await frame(page);

    // ---- the input focused, the on-screen keyboard up --------------------------------------------------------------------
    await expect(page.locator('.bubble')).toHaveAttribute('data-state', 'done', { timeout: 8000 });
    if (expected.mode === 'compact') {                       // on a phone the ✎ button is inside the sheet; the bubble opens it
      await openSheet(page);
      await frame(page);
    }
    await page.locator('#chat-toggle').tap();
    const input = page.locator('#chat-input');
    await expect(input).toBeVisible();
    await input.tap();
    await expect(input).toBeFocused();
    // The emulation has no on-screen keyboard. What a keyboard does to the page (interactive-widget=resizes-visual) is to
    // shrink the visual viewport, so that is what the test does.
    await page.evaluate((visible) => {
      const vv = window.visualViewport;
      if (!vv) throw new Error('no visualViewport');
      Object.defineProperty(vv, 'height', { configurable: true, get: () => visible });
      Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
      vv.dispatchEvent(new Event('resize'));
    }, expected.keyboardLeaves);
    await expect(app).toHaveAttribute('data-kb', '1');
    await expect(app).toHaveAttribute('data-layout', expected.mode);
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(page.locator('.bv')).toBeVisible();
    for (const selector of ['.bv', '#chat-input']) {
      await expect(async () => {
        const b = await box(page, selector);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.bottom).toBeLessThanOrEqual(expected.keyboardLeaves);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.right).toBeLessThanOrEqual(viewport.width);
        expect(b.width).toBeGreaterThan(40);
        expect(b.height).toBeGreaterThan(20);
      }).toPass({ timeout: 4000 });
    }
    await frame(page);
  });
});
