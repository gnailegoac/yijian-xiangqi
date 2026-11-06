import { test, expect } from '@playwright/test';

const cell = (page, row, col) => page.locator(`.board-cell[data-row="${row}"][data-col="${col}"]`);
const recommendation = page => page.locator('#coach-recommendation');

async function waitForRecommendation(page) {
  await expect(recommendation(page)).toBeVisible();
  await expect(page.locator('#coach-use-button')).toBeEnabled();
  await expect(recommendation(page)).toContainText(/[进退平]/);
}

async function movePawn(page) {
  await page.keyboard.press('Escape');
  await cell(page, 6, 0).click();
  await cell(page, 5, 0).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.board-cell')).toHaveCount(90);
});

test('a fresh human turn automatically shows a move and a plain-language reason', async ({ page }) => {
  await waitForRecommendation(page);
  const text = await recommendation(page).innerText();
  expect(text.trim().length).toBeGreaterThan(20);
  expect(text).not.toMatch(/必胜|绝对安全|肯定获胜/);
  await expect(page.locator('#move-count')).toHaveText('0');
  await expect(page.locator('#coach-opponent')).toBeHidden();
});

test('showing the recommendation selects a legal piece without playing the move', async ({ page }) => {
  await waitForRecommendation(page);
  await page.locator('#coach-use-button').click();
  await expect(page.locator('.board-cell.selected')).toHaveCount(1);
  await expect(page.locator('.board-cell.selected .piece.red')).toBeVisible();
  expect(await page.locator('.board-cell.legal').count()).toBeGreaterThan(0);
  await expect(page.locator('#move-count')).toHaveText('0');
  await expect(page.locator('#status-title')).toHaveText('红方行棋');
});

test('a real computer reply is explained and the next recommendation survives refresh', async ({ page }) => {
  await page.locator('[data-difficulty="easy"]').click();
  await movePawn(page);
  await expect(page.locator('#move-count')).toHaveText('2');
  await waitForRecommendation(page);
  const notation = (await page.locator('.history-move.black').last().innerText()).trim();
  await expect(page.locator('#coach-opponent')).toBeVisible();
  await expect(page.locator('#coach-opponent')).toContainText(notation);
  expect((await page.locator('#coach-opponent').innerText()).trim().length).toBeGreaterThan(20);

  await page.reload();
  await expect(page.locator('#move-count')).toHaveText('2');
  await waitForRecommendation(page);
  await expect(page.locator('#coach-opponent')).toContainText(notation);
  await page.locator('#coach-use-button').click();
  await expect(page.locator('.board-cell.selected .piece.red')).toBeVisible();
});

test('mobile coaching fits the viewport and keeps undo directly beneath the board', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForRecommendation(page);
  const metrics = await page.evaluate(() => {
    const board = document.querySelector('.board-wrap').getBoundingClientRect();
    const undo = document.querySelector('#undo-button').getBoundingClientRect();
    const coach = document.querySelector('#coach-panel').getBoundingClientRect();
    return { width: document.documentElement.scrollWidth, gap: undo.top - board.bottom, undoHeight: undo.height, coachLeft: coach.left, coachRight: coach.right };
  });
  expect(metrics.width).toBeLessThanOrEqual(390);
  expect(metrics.gap).toBe(12);
  expect(metrics.undoHeight).toBeGreaterThanOrEqual(44);
  expect(metrics.coachLeft).toBeGreaterThanOrEqual(0);
  expect(metrics.coachRight).toBeLessThanOrEqual(390);
  await page.locator('#coach-use-button').click();
  await expect(page.locator('.board-cell.selected .piece.red')).toBeVisible();
  await expect(page.locator('#move-count')).toHaveText('0');
});

test('undo and a new game replace old-turn recommendations with the current side', async ({ page }) => {
  await page.locator('[data-mode="local"]').click();
  await movePawn(page);
  await expect(page.locator('#status-title')).toHaveText('黑方行棋');
  await page.locator('#undo-button').click();
  await expect(page.locator('#move-count')).toHaveText('0');
  await waitForRecommendation(page);
  await page.locator('#coach-use-button').click();
  await expect(page.locator('.board-cell.selected .piece.red')).toBeVisible();

  // Start another analysis for black, then replace the position before it ends.
  await movePawn(page);
  await page.locator('[data-action="new"]').click();
  await page.locator('#modal-actions').getByRole('button', { name: '开始新对局', exact: true }).click();
  await expect(page.locator('#move-count')).toHaveText('0');
  await waitForRecommendation(page);
  await page.locator('#coach-use-button').click();
  await expect(page.locator('.board-cell.selected .piece.red')).toBeVisible();
  await expect(page.locator('#coach-opponent')).toBeHidden();
  await expect(page.locator('#move-count')).toHaveText('0');
});
