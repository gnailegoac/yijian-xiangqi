import { test, expect } from '@playwright/test';
import { createInitialBoard, getLegalMoves, applyMove, moveToNotation, opposite } from '../src/engine.js';

test.setTimeout(45_000);

const cell = (page, row, col) => page.locator(`.board-cell[data-row="${row}"][data-col="${col}"]`);
const recommendation = page => page.locator('#coach-recommendation');
const moveKey = move => `${move.from.row},${move.from.col}-${move.to.row},${move.to.col}`;
const emptyCommentary = /后续作用仍要结合|调整了[红黑]方.+的位置，没有立即|方便后续调动/;

async function waitForRecommendation(page) {
  await expect(recommendation(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#coach-use-button')).toBeEnabled();
  await expect(recommendation(page)).toContainText(/[进退平]/);
  await expect(recommendation(page)).not.toContainText(emptyCommentary);
}

async function currentPosition(page) {
  const requested = await page.evaluate(() => JSON.parse(localStorage.getItem('yijian.xiangqi.v1') || 'null')?.moves || []);
  let board = createInitialBoard(), color = 'red';
  for (const item of requested) {
    const move = getLegalMoves(board, color).find(candidate => moveKey(candidate) === moveKey(item));
    expect(move, 'The persisted game itself must remain legal').toBeTruthy();
    board = applyMove(board, move);
    color = opposite(color);
  }
  return { board, color };
}

async function assertLegalContinuation(page, container, minimumLength = 2) {
  const line = container.locator('.coach-continuation');
  await expect(line).toBeVisible();
  const pv = JSON.parse(await line.getAttribute('data-pv'));
  expect(pv.length, 'Useful commentary must include an actual continuation and reply').toBeGreaterThanOrEqual(minimumLength);
  let { board, color } = await currentPosition(page);
  expect(await line.getAttribute('data-start-color')).toBe(color);
  const plies = line.locator('.coach-ply');
  await expect(plies).toHaveCount(pv.length);
  for (let index = 0; index < pv.length; index++) {
    const move = getLegalMoves(board, color).find(candidate => moveKey(candidate) === moveKey(pv[index]));
    expect(move, `Continuation ply ${index + 1} must be legal for ${color}`).toBeTruthy();
    const notation = moveToNotation(board, move);
    expect(await plies.nth(index).getAttribute('data-color')).toBe(color);
    expect(await plies.nth(index).getAttribute('data-notation')).toBe(notation);
    await expect(plies.nth(index)).toContainText(notation);
    board = applyMove(board, move);
    color = opposite(color);
  }
  return pv;
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

test('a fresh human turn explains a concrete candidate with a legal follow-up and reply', async ({ page }) => {
  await waitForRecommendation(page);
  const text = await recommendation(page).innerText();
  await assertLegalContinuation(page, recommendation(page));
  expect(text).not.toMatch(/必胜|绝对安全|肯定获胜/);
  expect(text).not.toMatch(emptyCommentary);
  await expect(page.locator('#move-count')).toHaveText('0');
  await expect(page.locator('#coach-opponent')).toBeHidden();
});

test('showing the recommendation selects a legal piece without playing the move', async ({ page }) => {
  await waitForRecommendation(page);
  const [first] = await assertLegalContinuation(page, recommendation(page));
  await page.locator('#coach-use-button').click();
  await expect(page.locator('.board-cell.selected')).toHaveCount(1);
  await expect(page.locator('.board-cell.selected .piece.red')).toBeVisible();
  await expect(cell(page, first.from.row, first.from.col)).toHaveClass(/selected/);
  await expect(cell(page, first.to.row, first.to.col)).toHaveClass(/legal/);
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
  await expect(page.locator('#coach-opponent')).not.toContainText(emptyCommentary);
  await assertLegalContinuation(page, page.locator('#coach-opponent'));
  await assertLegalContinuation(page, recommendation(page));

  await page.reload();
  await expect(page.locator('#move-count')).toHaveText('2');
  await waitForRecommendation(page);
  await expect(page.locator('#coach-opponent')).toContainText(notation);
  await assertLegalContinuation(page, page.locator('#coach-opponent'));
  const [first] = await assertLegalContinuation(page, recommendation(page));
  await page.locator('#coach-use-button').click();
  await expect(cell(page, first.from.row, first.from.col)).toHaveClass(/selected/);
  await expect(cell(page, first.to.row, first.to.col)).toHaveClass(/legal/);
});

for (const width of [360, 390]) test(`mobile coaching at ${width}px fits and keeps undo directly beneath the board`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await waitForRecommendation(page);
  const [first] = await assertLegalContinuation(page, recommendation(page));
  const metrics = await page.evaluate(() => {
    const board = document.querySelector('.board-wrap').getBoundingClientRect();
    const undo = document.querySelector('#undo-button').getBoundingClientRect();
    const coach = document.querySelector('#coach-panel').getBoundingClientRect();
    return { width: document.documentElement.scrollWidth, gap: undo.top - board.bottom, undoHeight: undo.height, coachLeft: coach.left, coachRight: coach.right };
  });
  expect(metrics.width).toBeLessThanOrEqual(width);
  expect(metrics.gap).toBe(12);
  expect(metrics.undoHeight).toBeGreaterThanOrEqual(44);
  expect(metrics.coachLeft).toBeGreaterThanOrEqual(0);
  expect(metrics.coachRight).toBeLessThanOrEqual(width);
  await page.locator('#coach-use-button').click();
  await expect(page.locator('.board-cell.selected .piece.red')).toBeVisible();
  await expect(page.locator('#move-count')).toHaveText('0');
  await cell(page, first.to.row, first.to.col).click();
  await expect(page.locator('#move-count')).toHaveText('2', { timeout: 12_000 });
  await page.locator('#undo-button').click();
  await expect(page.locator('#move-count')).toHaveText('0');
  await expect(page.locator('#mobile-board-actions #undo-button')).toBeDisabled();
});

test('undo and a new game replace old-turn recommendations with the current side', async ({ page }) => {
  await page.locator('[data-mode="local"]').click();
  await movePawn(page);
  await expect(page.locator('#status-title')).toHaveText('黑方行棋');
  await page.locator('#undo-button').click();
  await expect(page.locator('#move-count')).toHaveText('0');
  await waitForRecommendation(page);
  await assertLegalContinuation(page, recommendation(page));
  await page.locator('#coach-use-button').click();
  await expect(page.locator('.board-cell.selected .piece.red')).toBeVisible();

  // Start another analysis for black, then replace the position before it ends.
  await movePawn(page);
  await page.locator('[data-action="new"]').click();
  await page.locator('#modal-actions').getByRole('button', { name: '开始新对局', exact: true }).click();
  await expect(page.locator('#move-count')).toHaveText('0');
  await waitForRecommendation(page);
  await assertLegalContinuation(page, recommendation(page));
  await page.locator('#coach-use-button').click();
  await expect(page.locator('.board-cell.selected .piece.red')).toBeVisible();
  await expect(page.locator('#coach-opponent')).toBeHidden();
  await expect(page.locator('#move-count')).toHaveText('0');
});
