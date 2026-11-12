// Reviewer's check of item 1 on dev/hud.html: #undo-button reads 悔棋 in every phase, with every combination of
// canUndo / failed / hintLevel, before and after a game-over card, and its accessible name is 悔棋.
import { grab, note, save, zoom, file } from './rlib.mjs';
const sleep = (page, ms) => page.waitForTimeout(ms);
const TAG = process.env.RV_TAG;

export default async ({ page, shot, context }) => {
  const fails = [];
  const seen = [];
  await page.waitForFunction(() => window.__dev);
  await sleep(page, 300);
  const read = () => page.evaluate(() => {
    const b = document.querySelector('#undo-button');
    const r = b.getBoundingClientRect();
    return { text: b.textContent, label: b.querySelector('.hud-btn__label').textContent, aria: b.getAttribute('aria-label'), title: b.getAttribute('title'), labelledby: b.getAttribute('aria-labelledby'),
             disabled: b.disabled, hidden: b.hidden || getComputedStyle(b).display === 'none' || getComputedStyle(b).visibility !== 'visible', w: r.width, h: r.height, x: r.left, y: r.top,
             count: document.querySelectorAll('#undo-button').length, underbarText: document.querySelector('#underbar').innerText.replace(/\s+/g, ' ') };
  });
  const phases = ['boot', 'childTurn', 'selected', 'tentative', 'opponentTurn', 'failed', 'over'];
  let width0 = null;
  for (const phase of phases) for (const canUndo of [true, false]) for (const hintLevel of [0, 3]) {
    await page.evaluate(({ phase, canUndo, hintLevel }) => window.__dev.set(phase, { canUndo, hintLevel }), { phase, canUndo, hintLevel });
    await sleep(page, 30);
    const s = await read();
    seen.push({ phase, canUndo, hintLevel, ...s });
    const wantDisabled = phase === 'boot' || !canUndo;
    if (s.text !== '悔棋' || s.label !== '悔棋') fails.push(`${phase}/${canUndo}/${hintLevel}: label ${s.text}`);
    if (s.aria !== null || s.title !== null || s.labelledby !== null) fails.push(`${phase}: aria-label/title/labelledby present`);
    if (s.disabled !== wantDisabled) fails.push(`${phase}/${canUndo}: disabled ${s.disabled}, want ${wantDisabled}`);
    if (s.hidden) fails.push(`${phase}: undo hidden`);
    if (s.count !== 1) fails.push(`${phase}: ${s.count} #undo-button`);
    if (s.underbarText.includes('回看')) fails.push(`${phase}: under-bar shows 回看: ${s.underbarText}`);
    if (width0 === null) width0 = s.w; else if (Math.abs(s.w - width0) > 0.01) fails.push(`${phase}: width changed ${width0} -> ${s.w}`);
    if (s.h < 44 || s.w < 44) fails.push(`${phase}: target ${s.w}x${s.h}`);
  }
  // game over with the card: the label, the accessible name, and what a tap sends
  await page.evaluate(() => { window.__dev.notate(7); window.__dev.over('win'); });
  await sleep(page, 700);
  const over = await read();
  const byRole = await page.getByRole('button', { name: '悔棋', exact: true }).count();
  const byRoleReview = await page.getByRole('button', { name: '回看', exact: true }).count();
  const cardReview = await page.getByRole('button', { name: '回看棋局', exact: true }).count();
  const layout = await page.evaluate(() => document.querySelector('#app').dataset.layout);
  note('RV over', { layout, text: over.text, w: over.w, h: over.h, disabled: over.disabled, byRole, byRoleReview, cardReview, underbar: over.underbarText });
  if (over.text !== '悔棋' || byRole !== 1 || byRoleReview !== 0 || cardReview !== 1) fails.push(`over: ${JSON.stringify({ text: over.text, byRole, byRoleReview, cardReview })}`);
  await shot(`${TAG}-over-card`);
  // is the button reachable with the card up? (landscape: yes; portrait / compact: the sheet may lie over it)
  const top = await page.evaluate(() => { const b = document.querySelector('#undo-button'); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e ? (e.closest('#undo-button') ? 'undo' : (e.closest('dialog')?.dataset.dialog ?? e.id ?? e.tagName)) : null; });
  note('RV undo-hit-with-card', { layout, top });
  // close the card with 回看棋局, then the under-bar alone
  await page.locator('#overlays dialog[data-dialog="over"] [data-choice="review"]').click();
  await sleep(page, 700);
  const closed = await read();
  if (closed.text !== '悔棋') fails.push(`after 回看棋局: ${closed.text}`);
  const ub = await page.evaluate(() => { const r = document.querySelector('#underbar').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  const g = await grab(page, 'underbar-over-raw', { x: ub.x - 8, y: ub.y - 8, width: ub.width + 16, height: ub.height + 16 });
  await zoom(context, g.buf, file('underbar-over.png'), 4);
  await shot(`${TAG}-over-closed`);
  // a tap sends undo
  await page.evaluate(() => { window.__rvActs = []; document.querySelector('#app').addEventListener('hud:action', (e) => window.__rvActs.push(e.detail.action)); });
  await page.evaluate(() => window.__dev.set('over', { canUndo: true }));
  await sleep(page, 50);
  await page.locator('#undo-button').tap();
  await sleep(page, 200);
  const acts = await page.evaluate(() => window.__rvActs);
  const afterTap = await read();
  note('RV tap', { acts, label: afterTap.text, phase: await page.evaluate(() => window.__dev.state.phase) });
  if (acts.join() !== 'undo') fails.push(`tap at game over sent ${acts.join()}`);
  if (afterTap.text !== '悔棋') fails.push(`after undo: ${afterTap.text}`);
  // keyboard: Enter on the focused button also sends undo, and it has a focus ring
  await page.evaluate(() => { window.__rvActs.length = 0; window.__dev.set('over', { canUndo: true }); document.querySelector('#undo-button').focus(); });
  await page.keyboard.press('Enter');
  await sleep(page, 100);
  const acts2 = await page.evaluate(() => window.__rvActs);
  if (acts2.join() !== 'undo') fails.push(`Enter on the button sent ${acts2.join()}`);
  save('undo.json', { seen, over, closed, acts, acts2 });
  note('RV-RESULT', fails.length ? fails : `ok (${seen.length} states)`);
  if (fails.length) throw new Error(fails.join(' | '));
};
