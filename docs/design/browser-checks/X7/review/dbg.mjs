export default async ({ page }) => {
  await page.evaluate(() => { __dev.hud.closeAll(); __dev.hud.blocking({ kind: 'engine-dead' }); __dev.hud.showStart({ hasSave: true, firstVisit: false, canImport: false }); });
  await page.waitForTimeout(450);
  await page.evaluate(() => __dev.hud.blocking(null)); await page.waitForTimeout(900);
  await page.evaluate(() => { __dev.hud.showStart({ hasSave: false, firstVisit: true, canImport: true }); });
  await page.waitForTimeout(450);
  const go = page.locator('.hud-layer:not(.is-closing) > dialog[data-dialog="start"] [data-choice="new"]');
  await go.dblclick().catch((e) => console.log('DBL ' + String(e).slice(0, 200)));
  for (const ms of [50, 450, 1000]) {
    await page.waitForTimeout(ms);
    console.log('LAYERS@' + ms + ' ' + await page.evaluate(() => JSON.stringify([...document.querySelectorAll('#overlays > *')].map((e) => e.className + (e.hidden ? '[hidden]' : '') + (e.inert ? '[inert]' : '')))));
  }
  console.log('STATE ' + await page.evaluate(() => JSON.stringify(__dev.state)));
};
