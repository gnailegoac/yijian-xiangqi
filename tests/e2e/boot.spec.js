// tests/e2e/boot.spec.js (E1): SPEC 14.7 flow 1, in all three projects.
import { expect, test } from '@playwright/test';
import { explainProxyLimit, phase, ready, seedStorage, settled, watch } from './helpers.js';

test.describe.configure({ timeout: 60000 });
explainProxyLimit(test);

test.describe('flow 1', () => {
  test('boot @smoke', async ({ page }) => {
    const seen = watch(page);
    const app = page.locator('#app');

    await test.step('without ?test=1: the start overlay, no AudioContext before the first tap, 开战！ starts a game', async () => {
      // every AudioContext the page constructs is counted, before any script of the game runs
      await page.addInitScript(() => {
        const made = { count: 0 };
        Object.assign(window, { __audioContexts: made });
        const host = /** @type {Record<string, typeof AudioContext|undefined>} */ (/** @type {unknown} */ (window));
        for (const name of ['AudioContext', 'webkitAudioContext']) {
          const Real = host[name];
          if (typeof Real !== 'function') continue;
          host[name] = class extends Real {
            /** @param {AudioContextOptions} [options] */
            constructor(options) {
              super(options);
              made.count += 1;
            }
          };
        }
      });
      const contexts = () => page.evaluate(() => /** @type {{__audioContexts: {count: number}}} */ (/** @type {unknown} */ (window)).__audioContexts.count);

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/', { waitUntil: 'load' });
      const card = page.locator('dialog[data-dialog="start"]');
      await expect(card).toBeVisible();
      const go = card.locator('[data-choice="new"]');
      await expect(go).toHaveText('开战！');
      // the card is the title card: no game exists behind it and the page is not "ready" yet (CONTRACT-NOTES 135)
      await expect(app).toHaveAttribute('data-phase', 'boot');
      await expect(page.locator('html')).not.toHaveAttribute('data-ready', '1');
      await page.waitForTimeout(600);                        // long enough for anything that would start by itself
      expect(await contexts()).toBe(0);

      await go.tap();
      await settled(page);
      await expect(card).toHaveCount(0);
      expect(await phase(page)).toBe('childTurn');
      await expect(app).toHaveAttribute('data-ply', '0');
      await expect(page.locator('.piece[data-id]')).toHaveCount(32);
      expect(await contexts()).toBeGreaterThanOrEqual(1);    // the tap was the audio-unlock gesture: the counter does count
    });

    await test.step('with ?test=1: 32 pieces, childTurn, coach llm, undo disabled', async () => {
      await seedStorage(page, {}, { clear: true });           // a first visit again, not the game of the step before
      await ready(page);
      await expect(page.locator('dialog[data-dialog="start"]')).toHaveCount(0);
      await expect(page.locator('.piece')).toHaveCount(32);
      await expect(app).toHaveAttribute('data-phase', 'childTurn');
      await expect(app).toHaveAttribute('data-coach', 'llm');
      await expect(page.locator('#undo-button')).toBeDisabled();
    });

    expect(seen.errors).toEqual([]);
  });
});

test.describe('a start that fails says so (CONTRACT-NOTES 150)', () => {
  test('a module that does not load is told with a reload button', async ({ page }) => {
    const line = page.locator('.boot-fail');
    const reload = line.locator('button');
    const start = page.locator('dialog[data-dialog="start"]');
    const script = { contentType: 'text/javascript; charset=utf-8' };
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await test.step('one module request fails: the line is there, and a tap on it loads the page again', async () => {
      await page.route('**/src/ui/hud.js', (route) => route.abort('connectionfailed'));
      await page.goto('/', { waitUntil: 'load' });
      await expect(reload).toBeVisible();
      await expect(reload).toHaveText('棋局没能打开，点这里重新加载');
      await expect(start).toHaveCount(0);
      await expect(page.locator('html')).not.toHaveAttribute('data-ready', '1');
      // a finger can read and reach it: inside the window, a full tap target
      const box = await reload.boundingBox();
      const view = page.viewportSize();
      if (!box || !view) throw new Error('the reload line has no box');
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(view.width);
      await page.unroute('**/src/ui/hud.js');
      await reload.tap();
      await expect(start).toBeVisible({ timeout: 15000 });
      await expect(line).toHaveCount(0);
    });

    await test.step('the start throws before the stage exists: the same line (src/app.js)', async () => {
      await page.route('**/src/ui/stage.js', (route) => route.fulfill({ ...script, body: 'export function createStage() { throw new Error("e2e: the stage cannot be built"); }\n' }));
      await page.goto('/', { waitUntil: 'load' });
      await expect(reload).toBeVisible();
      await expect(start).toHaveCount(0);
      await page.unroute('**/src/ui/stage.js');
    });

    await test.step('nothing fails and nothing is drawn: told eight seconds after the load; a healthy page is left alone', async () => {
      await page.clock.install();
      await page.route('**/src/app.js', (route) => route.fulfill({ ...script, body: '// e2e: a module that loads and draws nothing\n' }));
      await page.goto('/', { waitUntil: 'load' });
      await page.clock.fastForward(7000);
      await expect(line).toHaveCount(0);
      await page.clock.fastForward(1500);
      await expect(reload).toBeVisible();
      await page.unroute('**/src/app.js');
      // the game itself: the start card is up, the same eight seconds pass and no line comes
      await page.goto('/', { waitUntil: 'load' });
      await expect(start).toBeVisible({ timeout: 15000 });
      await page.clock.fastForward(9000);
      await expect(start).toBeVisible();
      await expect(line).toHaveCount(0);
    });
  });
});
