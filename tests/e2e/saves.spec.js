// tests/e2e/saves.spec.js (E1): SPEC 14.7 flows 11, 12 and 20: the v1 migration, v2 persistence and quarantine, the backup.
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { STR } from '../../src/game/strings.js';
import { explainProxyLimit, KEYS, pieces, playAnyMove, playMove, ready, savedMoves, saveFixture, seedStorage, settled, stored, tryAnyMove } from './helpers.js';

test.describe.configure({ timeout: 120000 });
explainProxyLimit(test);

/**
 * The log lines 诸葛亮 said by himself (notices are told as local lines).
 * @param {import('@playwright/test').Page} page
 */
const notices = (page) => page.locator('.msg[data-role="buddy"][data-kind="system"] .msg__text');

/**
 * Loads the game over a storage that holds only this v1 record.
 * @param {import('@playwright/test').Page} page
 * @param {string} text the raw v1 record
 * @returns {Promise<void>}
 */
async function loadV1(page, text) {
  await seedStorage(page, { [KEYS.v1]: text }, { clear: true });
  await ready(page);
}

/**
 * The quarantine slot, parsed.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{kind:string, why:string, raw:string}|null>}
 */
async function quarantine(page) {
  const text = await stored(page, KEYS.quarantine);
  return text === null ? null : JSON.parse(text);
}

test.describe('flow 11', () => {
  test('v1 migration', async ({ page }) => {
    const app = page.locator('#app');
    const board = page.locator('#board');

    await test.step('(a) ai / hard / black / 3 plies', async () => {
      const text = saveFixture('v1-ai-black-hard.json');
      await loadV1(page, text);
      await expect(app).toHaveAttribute('data-ply', '3');
      await expect(app).toHaveAttribute('data-phase', 'childTurn');
      // black at the bottom: the board is seen from the child's side, the black king stands in the bottom rows
      await expect(board).toHaveAttribute('data-bottom', 'black');
      const king = await page.locator('.piece[data-type="king"][data-color="black"]').boundingBox();
      const red = await page.locator('.piece[data-type="king"][data-color="red"]').boundingBox();
      if (!king || !red) throw new Error('a king has no box');
      expect(king.y).toBeGreaterThan(red.y);
      // the v2 records exist, the v1 record is untouched, the import is marked as done
      const game = JSON.parse(await stored(page, KEYS.game) ?? 'null');
      expect(game.schema).toBe(2);
      expect(game.humanColor).toBe('black');
      expect(game.moves).toEqual(['7774', '0726', '9776']);
      const profile = JSON.parse(await stored(page, KEYS.profile) ?? 'null');
      expect(profile.schema).toBe(2);
      expect(profile.skill.level).toBe(6);                    // difficulty hard seeds level 6 (SPEC 13.3)
      expect(await stored(page, KEYS.v1)).toBe(text);
      expect(await stored(page, KEYS.migrated)).toBe('1');
      await expect(notices(page).filter({ hasText: STR.migrated })).toHaveCount(1);
    });

    await test.step('(b) a local two-player game loads; the notice is shown', async () => {
      const text = saveFixture('v1-local.json');
      await loadV1(page, text);
      // five plies were played and red is the child: 司马懿 takes over black and moves
      await expect(app).toHaveAttribute('data-ply', '6', { timeout: 15000 });
      await expect(app).toHaveAttribute('data-phase', 'childTurn');
      await expect(board).toHaveAttribute('data-bottom', 'red');
      await expect(notices(page).filter({ hasText: STR.migratedLocal })).toHaveCount(1);
      expect((await savedMoves(page)).slice(0, 5)).toEqual(['7774', '0726', '9776', '0807', '9897']);
      expect(await stored(page, KEYS.v1)).toBe(text);
    });

    await test.step('(c) a resigned game is over', async () => {
      await loadV1(page, saveFixture('v1-resigned.json'));
      await expect(app).toHaveAttribute('data-phase', 'over');
      await expect(app).toHaveAttribute('data-ply', '4');
      await expect(page.locator('dialog[data-dialog="over"]')).toBeVisible();
      // a game that is over is not announced as going on (CONTRACT-NOTES 150): neither migration line says 接着下 here
      await expect(notices(page).filter({ hasText: STR.migrated })).toHaveCount(0);
      await expect(notices(page).filter({ hasText: STR.migratedLocal })).toHaveCount(0);
      const game = JSON.parse(await stored(page, KEYS.game) ?? 'null');
      expect(game.result).toEqual({ winner: 'black', reason: 'resign' });
      // an old finished game does not enter the new statistics
      const profile = JSON.parse(await stored(page, KEYS.profile) ?? 'null');
      expect(profile.games.played).toBe(0);
      expect(profile.games.lost).toBe(0);
    });

    await test.step('(d) a corrupt record gives a fresh game', async () => {
      const text = saveFixture('v2-corrupt.txt');             // not JSON at all
      await loadV1(page, text);
      await expect(app).toHaveAttribute('data-ply', '0');
      await expect(app).toHaveAttribute('data-phase', 'childTurn');
      await expect(page.locator('.piece[data-id]')).toHaveCount(32);
      expect(await savedMoves(page)).toEqual([]);
      expect(await stored(page, KEYS.v1)).toBe(text);
      expect(await stored(page, KEYS.migrated)).toBe('1');
    });

    await test.step('(e) an illegal third move: two plies are kept, the notice, the quarantine slot', async () => {
      await loadV1(page, saveFixture('v1-illegal-third-move.json'));
      await expect(app).toHaveAttribute('data-ply', '2');
      await expect(app).toHaveAttribute('data-phase', 'childTurn');
      await expect(notices(page).filter({ hasText: STR.saveTruncated(2) })).toHaveCount(1);
      expect(await savedMoves(page)).toEqual(['7774', '0726']);
      const slot = await quarantine(page);
      expect(slot?.kind).toBe('game');
      expect(slot?.why).toBe('truncated');
      expect(JSON.parse(slot?.raw ?? 'null').moves).toHaveLength(4);       // the copy still has the bad tail
    });

    await test.step('(f) v1-repetition loads in progress at ply 13', async () => {
      await loadV1(page, saveFixture('v1-repetition.json'));
      await expect(app).toHaveAttribute('data-ply', '13');
      await expect(app).toHaveAttribute('data-phase', 'childTurn');        // not a draw: the old plies do not count
      await expect(board).toHaveAttribute('data-bottom', 'black');
      await expect(page.locator('dialog[data-dialog="over"]')).toHaveCount(0);
      const game = JSON.parse(await stored(page, KEYS.game) ?? 'null');
      expect(game.result).toBeNull();
      expect(game.moves).toHaveLength(13);
    });
  });
});

test.describe('flow 12', () => {
  test('v2 persistence', async ({ page }) => {
    const app = page.locator('#app');

    await test.step('two move pairs, reload: the same position', async () => {
      await ready(page);
      await playMove(page, [7, 7], [7, 4]);                   // 炮二平五
      const second = await playAnyMove(page);                 // whatever is legal after the rival's answer
      await expect(app).toHaveAttribute('data-ply', '4');
      const position = await pieces(page);
      const moves = await savedMoves(page);
      expect(moves).toHaveLength(4);
      expect([moves[0], moves[2]]).toEqual(['7774', second]);

      await page.reload({ waitUntil: 'load' });
      await settled(page);
      await expect(app).toHaveAttribute('data-ply', '4');
      await expect(app).toHaveAttribute('data-phase', 'childTurn');
      expect(await pieces(page)).toBe(position);
      expect(await savedMoves(page)).toEqual(moves);

      // a trial is never persisted
      await tryAnyMove(page);
      await expect(page.locator('.piece.is-trial')).toHaveCount(1);
      expect(await savedMoves(page)).toEqual(moves);
      await page.reload({ waitUntil: 'load' });
      await settled(page);
      await expect(app).toHaveAttribute('data-ply', '4');
      await expect(app).toHaveAttribute('data-phase', 'childTurn');
      await expect(page.locator('.piece.is-trial')).toHaveCount(0);
      expect(await pieces(page)).toBe(position);
      expect(await savedMoves(page)).toEqual(moves);
    });

    await test.step('a corrupt game record is quarantined, not overwritten', async () => {
      const text = saveFixture('v2-corrupt.txt');
      await seedStorage(page, { [KEYS.game]: text }, { clear: true });
      await ready(page);
      await expect(app).toHaveAttribute('data-ply', '0');
      await expect(app).toHaveAttribute('data-phase', 'childTurn');
      await expect(notices(page).filter({ hasText: STR.saveCorrupt })).toHaveCount(1);
      expect(await quarantine(page)).toMatchObject({ kind: 'game', why: 'corrupt', raw: text });
      // the new game is saved beside it
      await playMove(page, [7, 7], [7, 4]);
      expect(await savedMoves(page)).toHaveLength(2);
      expect(await quarantine(page)).toMatchObject({ kind: 'game', why: 'corrupt', raw: text });
    });

    await test.step('a game record of schema 3 is quarantined, not overwritten', async () => {
      const text = saveFixture('v2-schema-3.json');
      await seedStorage(page, { [KEYS.game]: text }, { clear: true });
      await ready(page);
      await expect(app).toHaveAttribute('data-ply', '0');
      await expect(app).toHaveAttribute('data-phase', 'childTurn');
      await expect(notices(page).filter({ hasText: STR.saveNewer })).toHaveCount(1);
      expect(await quarantine(page)).toMatchObject({ kind: 'game', why: 'newer', raw: text });
      await playMove(page, [7, 7], [7, 4]);
      expect(await savedMoves(page)).toHaveLength(2);
      expect(await quarantine(page)).toMatchObject({ kind: 'game', why: 'newer', raw: text });
    });
  });
});

test.describe('flow 20', () => {
  test('backup', async ({ page }) => {
    const app = page.locator('#app');
    /** Opens the settings sheet through the menu. */
    const openSettings = async () => {
      await page.locator('#menu-button').tap();
      await page.locator('.hud-menu__item[data-menu="settings"]').tap();
      await expect(page.locator('dialog[data-dialog="settings"]')).toBeVisible();
    };

    await ready(page);
    await playMove(page, [7, 7], [7, 4]);
    await expect(app).toHaveAttribute('data-ply', '2');
    const moves = await savedMoves(page);
    const position = await pieces(page);

    // 导出存档 downloads a JSON file
    await openSettings();
    const exportButton = page.locator('dialog[data-dialog="settings"] [data-action="export-backup"]');
    await expect(exportButton).toHaveText('导出存档');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), exportButton.tap()]);
    expect(download.suggestedFilename()).toMatch(/^弈间存档-\d{4}-\d{2}-\d{2}\.json$/);
    const file = await download.path();
    const text = await readFile(file, 'utf8');
    const backup = JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
    expect(backup.kind).toBe('yijian-backup');
    expect(backup.v).toBe(1);
    expect(backup.game.moves).toEqual(moves);
    expect(backup.profile.schema).toBe(2);
    expect(backup.settings.schema).toBe(2);

    // an empty storage: a fresh game
    await seedStorage(page, {}, { clear: true });
    await ready(page);
    await expect(app).toHaveAttribute('data-ply', '0');
    expect(await savedMoves(page)).toEqual([]);

    // 导入存档 restores the game (the page reloads itself)
    await openSettings();
    await expect(page.locator('dialog[data-dialog="settings"] [data-action="import-backup"]')).toHaveText('导入存档');
    await page.locator('#overlays input[type="file"]').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') });
    await expect(app).toHaveAttribute('data-ply', '2', { timeout: 15000 });
    await settled(page);
    await expect(app).toHaveAttribute('data-phase', 'childTurn');
    expect(await pieces(page)).toBe(position);
    expect(await savedMoves(page)).toEqual(moves);
  });
});
