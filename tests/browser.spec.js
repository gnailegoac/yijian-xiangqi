import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const cell = (page, row, col) => page.locator(`.board-cell[data-row="${row}"][data-col="${col}"]`);
const moveCount = page => page.locator('#move-count');
const statusTitle = page => page.locator('#status-title');

async function move(page, fromRow, fromCol, toRow, toCol) {
  await cell(page, fromRow, fromCol).click();
  await cell(page, toRow, toCol).click();
}

async function boardSnapshot(page) {
  return page.locator('.board-cell').evaluateAll(cells => cells.map(cell => ({
    row: cell.dataset.row,
    col: cell.dataset.col,
    piece: cell.querySelector('.piece')?.textContent ?? null,
    color: cell.querySelector('.piece')?.classList.contains('red') ? 'red' : cell.querySelector('.piece') ? 'black' : null,
  })));
}

// Playwright's page fixture creates a fresh browser context, including storage,
// for every test. The refresh test deliberately reuses its own page/context.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.board-cell')).toHaveCount(90);
});

test('initial board renders 32 pieces on 90 intersections', async ({ page }) => {
  await expect(page).toHaveTitle('弈间 · 中国象棋');
  await expect(page.locator('#board .piece')).toHaveCount(32);
  await expect(page.locator('#board .piece.red')).toHaveCount(16);
  await expect(page.locator('#board .piece.black')).toHaveCount(16);
  await expect(moveCount(page)).toHaveText('0');
  await expect(statusTitle(page)).toHaveText('红方行棋');
  await expect(page.locator('#undo-button')).toBeDisabled();
});

test('selection marks legal destinations and rejects an illegal pawn move', async ({ page }) => {
  await page.locator('[data-mode="local"]').click();
  await cell(page, 6, 0).click();
  await expect(cell(page, 6, 0)).toHaveClass(/selected/);
  await expect(cell(page, 5, 0)).toHaveClass(/legal/);
  await expect(cell(page, 6, 1)).not.toHaveClass(/legal/);

  await cell(page, 6, 1).click();
  await expect(moveCount(page)).toHaveText('0');
  await expect(cell(page, 6, 0).locator('.piece.red')).toHaveText('兵');
  await expect(page.locator('#toast')).toContainText('不能落子');

  await cell(page, 5, 0).click();
  await expect(moveCount(page)).toHaveText('1');
  await expect(cell(page, 6, 0).locator('.piece')).toHaveCount(0);
  await expect(cell(page, 5, 0).locator('.piece.red')).toHaveText('兵');
  await expect(statusTitle(page)).toHaveText('黑方行棋');
});

test('local players alternate and undo restores one move at a time', async ({ page }) => {
  await page.locator('[data-mode="local"]').click();
  const initial = await boardSnapshot(page);
  await move(page, 6, 0, 5, 0);
  await expect(statusTitle(page)).toHaveText('黑方行棋');
  await move(page, 3, 0, 4, 0);
  await expect(moveCount(page)).toHaveText('2');
  await expect(statusTitle(page)).toHaveText('红方行棋');
  await expect(page.locator('.history-row')).toHaveCount(1);

  await page.locator('#undo-button').click();
  await expect(moveCount(page)).toHaveText('1');
  await expect(statusTitle(page)).toHaveText('黑方行棋');
  await expect(cell(page, 3, 0).locator('.piece.black')).toHaveText('卒');
  await expect(cell(page, 4, 0).locator('.piece')).toHaveCount(0);

  await page.locator('#undo-button').click();
  await expect(moveCount(page)).toHaveText('0');
  await expect(statusTitle(page)).toHaveText('红方行棋');
  expect(await boardSnapshot(page)).toEqual(initial);
});

test('computer replies with a real worker and undo removes both moves', async ({ page }) => {
  await page.locator('[data-difficulty="easy"]').click();
  const initial = await boardSnapshot(page);
  await move(page, 6, 0, 5, 0);
  await expect(moveCount(page)).toHaveText('2');
  await expect(statusTitle(page)).toHaveText('红方行棋');
  await expect(page.locator('#thinking-indicator')).toBeHidden();

  await page.locator('#undo-button').click();
  await expect(moveCount(page)).toHaveText('0');
  await expect(statusTitle(page)).toHaveText('红方行棋');
  expect(await boardSnapshot(page)).toEqual(initial);
});

test('refresh restores the saved position, history, mode and turn', async ({ page }) => {
  await page.locator('[data-mode="local"]').click();
  await move(page, 6, 0, 5, 0);
  await move(page, 3, 0, 4, 0);
  const saved = await boardSnapshot(page);
  const notation = await page.locator('#move-history').textContent();

  await page.reload();
  await expect(moveCount(page)).toHaveText('2');
  await expect(statusTitle(page)).toHaveText('红方行棋');
  await expect(page.locator('[data-mode="local"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await boardSnapshot(page)).toEqual(saved);
  expect(await page.locator('#move-history').textContent()).toEqual(notation);
});

test('choosing black flips the board and lets the computer open as red', async ({ page }) => {
  await page.locator('[data-difficulty="easy"]').click();
  await page.locator('[data-color="black"]').click();
  await expect(moveCount(page)).toHaveText('1');
  await expect(statusTitle(page)).toHaveText('黑方行棋');
  await expect(page.locator('#self-side')).toHaveText('执黑 · 后手');
  await expect(page.locator('#opponent-side')).toHaveText('执红 · 先手');
  await expect(cell(page, 0, 0)).toHaveCSS('top', /.+/);
  expect(await cell(page, 0, 0).evaluate(el => ({ left: el.style.left, top: el.style.top }))).toEqual({ left: '90%', top: '90%' });
  await expect(page.locator('#thinking-indicator')).toBeHidden();
});

test('undo while thinking ignores an already queued late worker result', async ({ page }) => {
  // This worker double intentionally delivers a queued callback after terminate,
  // exercising the app's request-id guard in addition to real-worker coverage.
  await page.addInitScript(() => {
    window.__lateWorkerResults = 0;
    window.__terminatedWorkers = 0;
    window.Worker = class {
      postMessage(data) {
        setTimeout(() => {
          window.__lateWorkerResults += 1;
          this.onmessage?.({ data: { id: data.id, move: { from: { row: 3, col: 0 }, to: { row: 4, col: 0 } } } });
        }, 650);
      }
      terminate() { window.__terminatedWorkers += 1; }
    };
  });
  await page.reload();
  await move(page, 6, 0, 5, 0);
  await expect(moveCount(page)).toHaveText('1');
  await expect(page.locator('#thinking-indicator')).toBeVisible();
  await page.locator('#undo-button').click();
  await expect(moveCount(page)).toHaveText('0');
  await expect.poll(() => page.evaluate(() => window.__lateWorkerResults)).toBe(1);
  expect(await page.evaluate(() => window.__terminatedWorkers)).toBeGreaterThan(0);
  await expect(moveCount(page)).toHaveText('0');
  await expect(statusTitle(page)).toHaveText('红方行棋');
  await expect(cell(page, 6, 0).locator('.piece.red')).toHaveText('兵');
  await expect(cell(page, 3, 0).locator('.piece.black')).toHaveText('卒');
  await expect(page.locator('#thinking-indicator')).toBeHidden();
});

test('resignation requires confirmation, ends play and persists after refresh', async ({ page }) => {
  await page.locator('[data-mode="local"]').click();
  await move(page, 6, 0, 5, 0);
  await page.locator('#resign-button').click();
  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#modal-title')).toHaveText('确定认输？');
  await page.locator('#modal-actions').getByRole('button', { name: '继续对弈', exact: true }).click();
  await expect(statusTitle(page)).toHaveText('黑方行棋');

  await page.locator('#resign-button').click();
  await page.locator('#modal-actions').getByRole('button', { name: '确认认输', exact: true }).click();
  await expect(statusTitle(page)).toHaveText('红方获胜');
  await expect(page.locator('#resign-button')).toBeDisabled();
  await move(page, 3, 0, 4, 0);
  await expect(moveCount(page)).toHaveText('1');
  await page.reload();
  await expect(statusTitle(page)).toHaveText('红方获胜');
  await expect(page.locator('#status-description')).toContainText('黑方认输');

  await page.locator('[data-action="new"]').click();
  await expect(moveCount(page)).toHaveText('0');
  await expect(statusTitle(page)).toHaveText('红方行棋');
});

test('starting another game protects an active game with a confirmation dialog', async ({ page }) => {
  await page.locator('[data-mode="local"]').click();
  await move(page, 6, 0, 5, 0);
  await page.locator('[data-action="new"]').click();
  await expect(page.locator('#modal-title')).toHaveText('开始新的对局？');
  await page.locator('#modal-actions').getByRole('button', { name: '继续当前棋局', exact: true }).click();
  await expect(moveCount(page)).toHaveText('1');
  await expect(cell(page, 5, 0).locator('.piece.red')).toHaveText('兵');

  await page.locator('[data-action="new"]').click();
  await page.locator('#modal-actions').getByRole('button', { name: '开始新对局', exact: true }).click();
  await expect(page.locator('#modal')).toBeHidden();
  await expect(moveCount(page)).toHaveText('0');
  await expect(statusTitle(page)).toHaveText('红方行棋');
  await expect(page.locator('#board .piece')).toHaveCount(32);
});

test('downloaded notation contains the actual played moves and game mode', async ({ page }) => {
  await page.locator('[data-mode="local"]').click();
  await move(page, 6, 0, 5, 0);
  await move(page, 3, 0, 4, 0);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^弈间棋谱-\d{4}-\d{2}-\d{2}\.txt$/);
  const content = await readFile(await download.path(), 'utf8');
  expect(content).toContain('弈间 · 中国象棋棋谱');
  expect(content).toContain('模式：双人同屏');
  expect(content).toContain('1. 兵九进一    卒1进1');
  expect(content).toContain('结果：进行中');
});

for (const width of [390, 360]) {
  test(`mobile layout at ${width}px fits the viewport and supports a move`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const metrics = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      board: document.querySelector('#board').getBoundingClientRect().toJSON(),
    }));
    expect(metrics.document).toBeLessThanOrEqual(width);
    expect(metrics.body).toBeLessThanOrEqual(width);
    expect(metrics.board.left).toBeGreaterThanOrEqual(0);
    expect(metrics.board.right).toBeLessThanOrEqual(width);

    await page.locator('[data-mode="local"]').click();
    await move(page, 6, 0, 5, 0);
    await expect(moveCount(page)).toHaveText('1');
    await expect(statusTitle(page)).toHaveText('黑方行棋');
    await page.locator('[data-action="rules"]').first().click();
    await expect(page.locator('#modal')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
