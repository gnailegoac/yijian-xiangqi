// Task 1 on dev/hud.html: the label and the accessible name of #undo-button in every phase, and a picture of the
// under-bar at game over. XC_EXPECT=1 turns the readings into assertions (the label must be 悔棋 everywhere).
import { clip, note, save, zoomClip } from './lib.mjs';

export default async ({ page, shot, context }) => {
  await page.waitForFunction(() => window.__dev);
  await page.evaluate(() => { window.__dev.notate(41); window.__dev.hud.setRound(21); });
  const phases = ['boot', 'childTurn', 'selected', 'tentative', 'opponentTurn', 'failed', 'over'];
  const rows = [];
  for (const phase of phases) {
    await page.evaluate((p) => window.__dev.set(p, { canUndo: true }), phase);
    await page.waitForTimeout(160);
    const row = await page.evaluate(() => {
      const b = document.querySelector('#undo-button');
      const r = b.getBoundingClientRect();
      return { text: b.textContent, label: b.querySelector('.hud-btn__label').textContent, ariaLabel: b.getAttribute('aria-label'), title: b.getAttribute('title'),
               disabled: b.disabled, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    });
    row.phase = phase;
    row.aria = (await page.locator('#undo-button').ariaSnapshot()).trim();
    row.byRole = await page.getByRole('button', { name: '悔棋', exact: true }).count();
    row.byRoleReview = await page.getByRole('button', { name: '回看', exact: true }).count();
    rows.push(row);
  }
  note('UNDO', rows);
  save('undo.json', rows);

  // game over: the under-bar as the child sees it
  await page.evaluate(() => window.__dev.set('over', { canUndo: true }));
  await page.waitForTimeout(500);
  await shot(`${process.env.XC_TAG}-over`);
  const bar = await page.evaluate(() => { const r = document.querySelector('#underbar').getBoundingClientRect(); return { x: r.left - 8, y: r.top - 8, width: r.width + 16, height: r.height + 16 }; });
  await zoomClip(page, context, 'underbar-over', bar, 4);
  // the tap still asks for an undo at game over
  const sent = await page.evaluate(() => new Promise((resolve) => {
    const got = [];
    const on = (e) => got.push(e.detail.action);
    document.querySelector('#app').addEventListener('hud:action', on);
    document.querySelector('#undo-button').click();
    setTimeout(() => { document.querySelector('#app').removeEventListener('hud:action', on); resolve(got); }, 50);
  }));
  note('TAP', sent);

  if (process.env.XC_EXPECT === '1') {
    const bad = rows.filter((r) => r.label !== '悔棋' || r.text !== '悔棋' || r.ariaLabel !== null || r.title !== null || r.aria !== '- button "悔棋"' && r.aria !== '- button "悔棋" [disabled]' || r.byRole !== 1 || r.byRoleReview !== 0);
    if (bad.length) throw new Error(`undo label wrong in: ${JSON.stringify(bad)}`);
    if (JSON.stringify(sent) !== '["undo"]') throw new Error(`tap at game over sent ${JSON.stringify(sent)}`);
    note('EXPECT', 'ok: 悔棋 in 7 phases, accessible name 悔棋, tap sends undo');
  }
};
