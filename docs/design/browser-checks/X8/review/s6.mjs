export default async ({ page, shot }) => {
  const w = (ms) => page.waitForTimeout(ms);
  await page.click('#dev-toggle');
  await w(400); await shot('panel');
  // press a few buttons of the panel: theme, motion, a raw method
  const press = async (label) => { await page.locator('#dev button', { hasText: new RegExp(`^${label}$`) }).first().click(); await w(300); };
  await press('隆中'); await press('精简'); await press('妙计！');
  await w(1200);
  await page.click('#dev-toggle');
  await w(300); await shot('after');
  console.error(JSON.stringify(await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, motion: document.documentElement.dataset.motion, ply: document.querySelector('#app').dataset.ply,
    log: window.__dev.logLines.slice(-6) }))));
};
