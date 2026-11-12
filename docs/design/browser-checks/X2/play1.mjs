// Zero-wait touch: select, hover trial with the 试 tag, second tap stamps it down; then the rival answers.
const dir = 'C:/Users/USERNA~1/AppData/Local/Temp/claude/5884157893c5b410/a051714c-de36-47da-b3cc-cfc754f60ac3/scratchpad/work/X2/';
export default async ({ page }) => {
  const board = page.locator('#board');
  const box = await board.boundingBox();
  const snap = (name) => page.screenshot({ path: `${dir}${name}.png`, clip: { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 } });
  const cell = (r, c) => page.locator(`.board-cell[data-row="${r}"][data-col="${c}"]`);
  await cell(7, 7).tap();
  await page.waitForTimeout(60); await snap('p1-select-060');
  await page.waitForTimeout(300); await snap('p1-select-360');
  await cell(7, 4).tap();
  await page.waitForTimeout(70); await snap('p1-trial-070');
  await page.waitForTimeout(90); await snap('p1-trial-160');
  await page.waitForTimeout(120); await snap('p1-trial-280');
  await page.waitForTimeout(500); await snap('p1-trial-780');
  await cell(7, 4).tap();
  await page.waitForTimeout(60); await snap('p1-commit-060');
  await page.waitForTimeout(80); await snap('p1-commit-140');
  await page.waitForTimeout(160); await snap('p1-commit-300');
  await page.waitForTimeout(900); await snap('p1-rival');
  await page.waitForTimeout(900); await snap('p1-after');
  console.log(JSON.stringify(await page.evaluate(() => ({ log: window.__log.slice(-30), busy: document.documentElement.dataset.uiBusy ?? null }))));
};
