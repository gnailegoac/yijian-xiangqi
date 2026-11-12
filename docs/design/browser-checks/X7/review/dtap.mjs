// Double taps: does the second tap reach a control that replaced the one under the finger?
export default async ({ page }) => {
  await page.evaluate(() => { window.__ev = []; document.querySelector('#app').addEventListener('hud:action', (e) => window.__ev.push(e.detail.action), true); });
  const ev = () => page.evaluate(() => window.__ev.splice(0));
  const centre = async (sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, sel);
  const dtap = async (sel, gap = 120) => { const [x, y] = await centre(sel); await page.mouse.click(x, y); await page.waitForTimeout(gap); await page.mouse.click(x, y); await page.waitForTimeout(500); };
  await page.evaluate(() => { __dev.notate(12); __dev.set('tentative', { canUndo: true, hintLevel: 0 }); }); await page.waitForTimeout(600); await ev();
  await dtap('#retract-button');
  console.log('RETRACT x2 -> ' + JSON.stringify(await ev()) + ' level=' + await page.getAttribute('#hint-button', 'data-level'));
  // the game ends on the child's confirm: the harness goes straight to `over`, as the director does for a mate
  await page.evaluate(() => { __dev.set('tentative', { canUndo: true, hintLevel: 0 }); document.querySelector('#app').addEventListener('hud:action', (e) => { if (e.detail.action === 'confirm') __dev.set('over', { canUndo: true }); }, { capture: true, once: true }); });
  await page.waitForTimeout(600); await ev();
  await dtap('#confirm-button');
  console.log('CONFIRM(mate) x2 -> ' + JSON.stringify(await ev()) + ' phase=' + await page.evaluate(() => __dev.state.phase));
  await page.evaluate(() => { __dev.set('over', { canUndo: true }); }); await page.waitForTimeout(600); await ev();
  await dtap('#newgame-button');
  console.log('NEWGAME x2 -> ' + JSON.stringify(await ev()) + ' level=' + await page.getAttribute('#hint-button', 'data-level'));
  await page.evaluate(() => { __dev.set('childTurn', { canUndo: true, hintLevel: 0 }); }); await page.waitForTimeout(600); await ev();
  await dtap('#menu-button');
  console.log('MENU x2 -> menu open: ' + await page.evaluate(() => !!document.querySelector('.hud-layer:not(.is-closing) > .hud-menu')));
  await page.evaluate(() => __dev.hud.closeAll()); await page.waitForTimeout(400);
  await page.click('#menu-button'); await page.waitForTimeout(400);
  await dtap('.hud-menu__item[data-menu="rules"]');
  console.log('MENU ITEM x2 -> sheet open: ' + await page.evaluate(() => !!document.querySelector('.hud-layer:not(.is-closing) > dialog[data-dialog="rules"]')));
  await page.evaluate(() => __dev.hud.closeAll()); await page.waitForTimeout(400);
  await page.evaluate(() => { __dev.set('over', { canUndo: true }); __dev.over('win', { type: false }); }); await page.waitForTimeout(700); await ev();
  await dtap('dialog[data-dialog="over"] [data-choice="again"]');
  console.log('CARD AGAIN x2 -> ' + JSON.stringify(await ev()) + ' level=' + await page.getAttribute('#hint-button', 'data-level'));
};
