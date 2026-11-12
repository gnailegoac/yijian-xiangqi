// Reviewer: one theme, bubble with links + sheet.
export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  await page.waitForSelector('html[data-ready="1"]');
  await w(600);
  await page.evaluate(() => { const d = window.__dev; d.run.oppLine(); });
  await w(5200);
  await page.evaluate(() => { const d = window.__dev; d.run.planLine(); });
  await w(6200);
  await page.evaluate(() => { const d = window.__dev; d.chat.setChips(d.CHIPS.takeback); });
  await page.locator('#buddy .move-link[data-move]').nth(1).click();
  await w(500);
  await shot('1-bubble');
  await page.evaluate(() => { const d = window.__dev; d.run.heldLine(); });
  await w(700);
  await page.locator('.chip').nth(1).click();
  await w(1300);
  await shot('2-held-used');
  await page.evaluate(() => { const d = window.__dev; d.run.abortRetract(); });
  await w(3000);
  await page.evaluate(() => { window.__dev.chat.setSheet(true, { focusInput: true }); });
  await w(600);
  await shot('3-sheet');
};
