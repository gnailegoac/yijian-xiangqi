// tests/e2e/settings.spec.js (E1): SPEC 14.7 flows 17 and 18: mute, motion and the three themes; playing with the keyboard.
import { expect, test } from '@playwright/test';
import { explainProxyLimit, KEYS, ready, savedMoves, settled, stored } from './helpers.js';

test.describe.configure({ timeout: 90000 });
explainProxyLimit(test);

test.describe('flow 17', () => {
  test('mute, motion, theme', async ({ page }) => {
    const html = page.locator('html');
    const mute = page.locator('#mute-button');
    const settings = async () => JSON.parse(await stored(page, KEYS.settings) ?? '{}');

    await test.step('mute persists', async () => {
      await ready(page);
      await expect(mute).toHaveAttribute('aria-pressed', 'false');
      await mute.tap();
      await expect(mute).toHaveAttribute('aria-pressed', 'true');
      expect(await settings()).toMatchObject({ sfx: false, music: false });
      await page.reload({ waitUntil: 'load' });
      await settled(page);
      await expect(mute).toHaveAttribute('aria-pressed', 'true');
      expect(await settings()).toMatchObject({ sfx: false, music: false });
      // and back
      await mute.tap();
      await expect(mute).toHaveAttribute('aria-pressed', 'false');
      expect(await settings()).toMatchObject({ sfx: true, music: true });
      await page.reload({ waitUntil: 'load' });
      await settled(page);
      await expect(mute).toHaveAttribute('aria-pressed', 'false');
    });

    await test.step('reduced motion gives data-motion="reduced"', async () => {
      await expect(html).toHaveAttribute('data-motion', 'reduced');          // ready() emulates prefers-reduced-motion: reduce
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expect(html).toHaveAttribute('data-motion', 'full');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(html).toHaveAttribute('data-motion', 'reduced');
    });

    await test.step('each theme sets html[data-theme] and keeps the 32 pieces legible', async () => {
      await page.locator('#menu-button').tap();
      await page.locator('.hud-menu__item[data-menu="settings"]').tap();
      const sheet = page.locator('dialog[data-dialog="settings"]');
      await expect(sheet).toBeVisible();
      await expect(sheet.locator('.hud-theme')).toHaveCount(3);
      for (const theme of ['longzhong', 'shachang', 'chibi']) {
        await sheet.locator(`.hud-theme[data-value="${theme}"]`).tap();
        await expect(html).toHaveAttribute('data-theme', theme);
        expect((await settings()).theme).toBe(theme);
        await expect(page.locator('.piece[data-id]')).toHaveCount(32);
        const glyphs = await page.evaluate(() => [...document.querySelectorAll('.piece[data-id]')].map((piece) => {
          const glyph = piece.querySelector('.piece__glyph');
          return { side: /** @type {HTMLElement} */ (piece).dataset.color, text: (glyph?.textContent ?? '').trim(), ink: glyph ? getComputedStyle(glyph).color : '' };
        }));
        expect(glyphs.every((g) => g.text.length === 1 && g.ink !== '')).toBe(true);
        const red = new Set(glyphs.filter((g) => g.side === 'red').map((g) => g.ink));
        const black = new Set(glyphs.filter((g) => g.side === 'black').map((g) => g.ink));
        expect(red.size).toBe(1);                              // one ink per side ...
        expect(black.size).toBe(1);
        expect([...red][0]).not.toBe([...black][0]);           // ... and the two sides differ
      }
    });
  });
});

test.describe('flow 18', () => {
  test('keyboard', async ({ page }) => {
    const app = page.locator('#app');
    /** The board cell that has the keyboard focus, as "row,col" ('' when the focus is elsewhere). */
    const focused = () => page.evaluate(() => {
      const el = document.activeElement;
      return el instanceof HTMLElement && el.classList.contains('board-cell') ? `${el.dataset.row},${el.dataset.col}` : '';
    });
    /** @param {string} key @param {number} times */
    const press = async (key, times) => {
      for (let i = 0; i < times; i++) await page.keyboard.press(key);
    };

    await ready(page);
    await expect(page.locator('.bubble')).toHaveAttribute('data-state', 'done');
    // the board's tab stop is the child's king
    const stop = page.locator('.board-cell[tabindex="0"]');
    await expect(stop).toHaveCount(1);
    await stop.focus();
    expect(await focused()).toBe('9,4');

    // arrows move the focus
    await press('ArrowUp', 1);
    expect(await focused()).toBe('8,4');
    await press('ArrowUp', 1);
    await press('ArrowRight', 3);
    expect(await focused()).toBe('7,7');
    await press('ArrowDown', 1);
    await press('ArrowLeft', 1);
    expect(await focused()).toBe('8,6');
    await press('ArrowUp', 1);
    await press('ArrowRight', 1);
    expect(await focused()).toBe('7,7');
    await expect(app).toHaveAttribute('data-phase', 'childTurn');

    // Enter selects, Enter on a marked target tries
    await press('Enter', 1);
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await expect(page.locator('.board-cell.is-selected[data-row="7"][data-col="7"]')).toHaveCount(1);
    await press('ArrowLeft', 3);
    expect(await focused()).toBe('7,4');
    await press('Enter', 1);
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    await expect(page.locator('.board-cell.is-trial-to[data-row="7"][data-col="4"]')).toHaveCount(1);

    // Esc retracts
    await press('Escape', 1);
    await expect(app).toHaveAttribute('data-phase', 'selected');
    await expect(page.locator('.piece.is-trial')).toHaveCount(0);
    expect(await savedMoves(page)).toEqual([]);

    // Enter tries again, and after the guard Enter confirms
    await press('Enter', 1);
    await expect(app).toHaveAttribute('data-phase', 'tentative');
    await page.waitForTimeout(450);
    await press('Enter', 1);
    await expect(app).toHaveAttribute('data-ply', '2', { timeout: 15000 });
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
    expect((await savedMoves(page))[0]).toBe('7774');

    // U undoes
    await press('u', 1);
    await expect(app).toHaveAttribute('data-ply', '0');
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
    expect(await savedMoves(page)).toEqual([]);

    // H opens a pouch
    const hint = page.locator('#hint-button');
    await expect(hint).toHaveAttribute('data-level', '0');
    await press('h', 1);
    await expect(hint).toHaveAttribute('data-level', '1');
  });
});
